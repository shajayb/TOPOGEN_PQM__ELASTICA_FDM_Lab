import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_READ_LINES = 400;
const MAX_READ_BYTES = 64 * 1024;
const MAX_BATCH_FILES = 12;
const MAX_BATCH_FRAME_BYTES = 180 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_EDIT_BATCH = 20;
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_MATCHES = 200;
const MAX_SEARCH_QUERIES = 8;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SEARCH_DUMP_BYTES = 1024 * 1024;
const SEARCH_CONCURRENCY = 16;
const MAX_COMMAND_OUTPUT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', '__pycache__']);
const ARTIFACT_SKIP_DIRS = new Set(['runs', 'video_build', 'outputs', '.rsi_snapshots']);
const DEFAULT_SEARCH_SKIP_DIRS = new Set([...SKIP_DIRS, ...ARTIFACT_SKIP_DIRS]);
const ALLOWED_COMMANDS = new Set([
  'node', 'npm', 'npx', 'git', 'pwsh', 'powershell', 'clang++', 'python', 'python3'
]);

const CREDENTIAL_NAME_RE = /^(?:api[_-]?keys?(?:\.[a-z0-9]+)?|\.env(?:\..+)?|id_rsa|id_ed25519|agent-session\.json)$/i;
const CREDENTIAL_EXT_RE = /\.(?:pem|key|pfx|p12|jks|keystore)$/i;
const CREDENTIAL_PATH_RE = /(?:^|\/)(?:api[_-]?keys?(?:\.[a-z0-9]+)?|\.env(?:\..+)?|credentials?(?:\.[a-z0-9]+)?|secrets?(?:\.[a-z0-9]+)?|agent-session\.json)(?:$|\/)/i;
const DESTRUCTIVE_GIT_RE = /^(?:push|reset|clean|rebase|filter-branch)$/i;
const ARTIFACT_PATH_RE = /(?:^|\/)(?:runs|video_build|outputs|\.rsi_snapshots)(?:$|\/)/i;
const DUMP_EXT_RE = /\.(?:json|obj)$/i;
const CODE_EXT_RE = /\.(?:mjs|js|cjs|ts|html|htm)$/i;
const AIRGAP_GEN_REF_RE = /(?:['"`][^'"`\r\n]*?(?:verifier[\\/]|verifier_worker\.mjs|fea_solver\.mjs|fabrication_check\.mjs)[^'"`\r\n]*?['"`])/;
const AIRGAP_VER_REF_RE = /(?:['"`][^'"`\r\n]*?(?:index_TOPOGEN_PQM_ELASTICA_FDM\.html|index_WFC\.html|run_generator\.mjs|generator_worker\.mjs|(?:^|[\\/\.])core[\\/])[^'"`\r\n]*?['"`])/;
const AIRGAP_IMPORT_IO_RE = /\b(?:import|export|require|from|readFileSync|readFile|createReadStream|fetch|Worker|spawn|spawnSync|execFile|execFileSync)\b|<script\b/i;

function globToRegex(glob) {
  let norm = String(glob || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm) return null;
  if (!norm.includes('/')) {
    norm = `**/${norm}`;
  }
  let rx = '^';
  let i = 0;
  while (i < norm.length) {
    const ch = norm[i];
    if (ch === '*') {
      if (norm[i + 1] === '*') {
        if (norm[i + 2] === '/') {
          rx += '(?:.+/)?';
          i += 3;
          continue;
        }
        rx += '.*';
        i += 2;
        continue;
      }
      rx += '[^/]*';
      i += 1;
    } else if (ch === '?') {
      rx += '[^/]';
      i += 1;
    } else {
      rx += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  rx += '$';
  return new RegExp(rx, 'i');
}

function compileGlobList(value) {
  if (value === undefined || value === null) return [];
  const rawList = Array.isArray(value) ? value : [value];
  const regexes = [];
  for (const item of rawList) {
    if (typeof item !== 'string' || !item.trim()) continue;
    const rx = globToRegex(item);
    if (rx) regexes.push(rx);
  }
  return regexes;
}

function stripCommentsPreserveLines(source, isHtml = false) {
  let out = '';
  let i = 0;
  const n = source.length;
  let inQuote = null;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (inQuote) {
      out += ch;
      if (ch === '\\' && i + 1 < n) {
        out += source[i + 1];
        i += 2;
        continue;
      }
      if (ch === inQuote) {
        inQuote = null;
      }
      i += 1;
      continue;
    }

    if (isHtml && ch === '<' && source.slice(i, i + 4) === '<!--') {
      const end = source.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = source.indexOf('\n', i + 2);
      const stop = end === -1 ? n : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }

    if (ch === '\'' || ch === '"' || ch === '`') {
      inQuote = ch;
      out += ch;
      i += 1;
      continue;
    }

    out += ch;
    i += 1;
  }

  return out;
}

function assertNoAirGapCrossImport(relativePath, content) {
  const norm = String(relativePath || '').replace(/\\/g, '/').replace(/^TOPOGEN_FDM_Foundry\//i, '');
  if (!CODE_EXT_RE.test(norm)) return;

  const isGeneratorSurface =
    norm.startsWith('core/') ||
    norm.startsWith('ui/') ||
    norm === 'index_TOPOGEN_PQM_ELASTICA_FDM.html' ||
    norm === 'run_generator.mjs' ||
    norm === 'workers/generator_worker.mjs';

  const isVerifierSurface =
    norm.startsWith('verifier/') ||
    norm === 'workers/verifier_worker.mjs';

  if (!isGeneratorSurface && !isVerifierSurface) return;

  const cleaned = stripCommentsPreserveLines(content, /\.html?$/i.test(norm));
  const lines = cleaned.split(/\r?\n/);

  if (isGeneratorSurface) {
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (AIRGAP_GEN_REF_RE.test(line) && (AIRGAP_IMPORT_IO_RE.test(line) || /\bverifier[\\/]/.test(line))) {
        throw Error(`AIR-GAP VIOLATION: generator file "${relativePath}" line ${idx + 1} cannot import or reference verifier surface`);
      }
    }
  }

  if (isVerifierSurface) {
    for (let idx = 0; idx < lines.length; idx++) {
      const line = lines[idx];
      if (AIRGAP_VER_REF_RE.test(line) && AIRGAP_IMPORT_IO_RE.test(line)) {
        throw Error(`AIR-GAP VIOLATION: verifier file "${relativePath}" line ${idx + 1} cannot import or reference generator surface`);
      }
    }
  }
}

export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[credential redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[credential redacted]')
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [credential redacted]')
    .replace(/\b(GEMINI_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|TOPOGEN_FOUNDRY_TOKEN|ALICE_FOUNDRY_TOKEN|API_KEY|PASSWORD|PASSWD|SECRET|TOKEN)\s*[:=]\s*[^\s,;'"`]+/gi, '$1=[credential redacted]')
    .replace(/\b(password|passwd|pwd|token|secret|api[_ -]?key|authorization|credential)s?\s*[:=]\s*[^\s,;'"`]+/gi, '$1=[credential redacted]');
}

function normalizeForCompare(p) {
  const resolved = path.resolve(p);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithinRoot(target, root) {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function isCredentialPath(targetPath) {
  const norm = targetPath.replace(/\\/g, '/');
  const base = path.basename(targetPath);
  return CREDENTIAL_NAME_RE.test(base) || CREDENTIAL_EXT_RE.test(base) || CREDENTIAL_PATH_RE.test(norm);
}

function assertNoSymlinkComponents(targetPath, root) {
  const rel = path.relative(root, targetPath);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return;
  const parts = rel.split(path.sep).filter(Boolean);
  let cursor = root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) break;
    const st = fs.lstatSync(cursor);
    if (st.isSymbolicLink()) throw Error('Symlinks are refused in workspace tools');
  }
}

export function createWorkspaceTools({ projectRoot, scratchDir, ecosystem = 'antigravity' }) {
  if (!projectRoot || !path.isAbsolute(projectRoot)) throw Error('Absolute projectRoot is required');
  const roots = [];
  const realProject = fs.existsSync(projectRoot) ? fs.realpathSync(projectRoot) : path.resolve(projectRoot);
  roots.push(realProject);
  const realScratch = scratchDir
    ? (fs.existsSync(scratchDir) ? fs.realpathSync(scratchDir) : path.resolve(scratchDir))
    : null;
  if (realScratch && normalizeForCompare(realScratch) !== normalizeForCompare(realProject)) {
    roots.push(realScratch);
  }

  function resolveAllowed(inputPath, { allowMissing = false, blockGitInternal = false } = {}) {
    const raw = inputPath === undefined || inputPath === '' ? '.' : String(inputPath);
    if (raw.includes('\0')) throw Error('Invalid path');
    const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(realProject, raw);

    let probe = candidate;
    const tail = [];
    while (!fs.existsSync(probe)) {
      const parent = path.dirname(probe);
      if (parent === probe) throw Error('Path root does not exist');
      tail.unshift(path.basename(probe));
      probe = parent;
    }
    const lstatProbe = fs.lstatSync(probe);
    if (lstatProbe.isSymbolicLink()) throw Error('Symlinks are refused in workspace tools');
    const realAncestor = fs.realpathSync(probe);
    const resolved = tail.length ? path.join(realAncestor, ...tail) : realAncestor;

    const matchedRoot = roots.find(r => isWithinRoot(resolved, r));
    if (!matchedRoot) throw Error('Path is outside allowed workspace roots');
    assertNoSymlinkComponents(resolved, matchedRoot);

    if (!allowMissing && !fs.existsSync(resolved)) throw Error('Path does not exist: ' + raw);
    if (isCredentialPath(resolved)) throw Error('Access to credential or API key files is blocked');
    if (blockGitInternal) {
      const relFromRoot = path.relative(matchedRoot, resolved).replace(/\\/g, '/');
      if (relFromRoot === '.git' || relFromRoot.startsWith('.git/')) {
        throw Error('Editing internal .git files is blocked');
      }
    }
    const relative = path.relative(matchedRoot, resolved).replace(/\\/g, '/') || '.';
    return { resolved, root: matchedRoot, relative };
  }

  function list(args = {}) {
    const { resolved, root, relative } = resolveAllowed(args.path ?? '.', { allowMissing: false });
    const st = fs.lstatSync(resolved);
    if (!st.isDirectory()) throw Error('Target path is not a directory');
    const maxEntries = Math.min(Math.max(1, Number(args.maxEntries ?? 100)), MAX_LIST_ENTRIES);
    const recursive = Boolean(args.recursive);
    const entries = [];
    let truncated = false;

    function walk(dir, depth) {
      const names = fs.readdirSync(dir).sort();
      for (const name of names) {
        if (entries.length >= maxEntries) { truncated = true; return; }
        const full = path.join(dir, name);
        let entryStat;
        try { entryStat = fs.lstatSync(full); } catch { continue; }
        if (entryStat.isSymbolicLink()) continue;
        if (isCredentialPath(full)) continue;
        const rel = path.relative(root, full).replace(/\\/g, '/');
        if (entryStat.isDirectory()) {
          entries.push({ name, path: rel, kind: 'dir' });
          if (recursive && depth < 8 && !SKIP_DIRS.has(name)) walk(full, depth + 1);
        } else if (entryStat.isFile()) {
          entries.push({ name, path: rel, kind: 'file', size: entryStat.size });
        }
      }
    }
    walk(resolved, 0);
    return { path: relative, entries, count: entries.length, truncated };
  }

  function formatReadSlice(relative, rawBuf, args) {
    if (rawBuf.includes(0)) throw Error('Binary files cannot be read as text');
    const text = rawBuf.toString('utf8');
    const lines = text.split(/\r?\n/);
    const totalLines = lines.length;
    const startLine = Math.max(1, Number(args.startLine ?? 1));
    const requestedEnd = args.endLine !== undefined
      ? Number(args.endLine)
      : Math.min(totalLines, startLine + MAX_READ_LINES - 1);
    if (requestedEnd < startLine) throw Error('endLine must be >= startLine');
    const cappedEnd = Math.min(totalLines, requestedEnd, startLine + MAX_READ_LINES - 1);
    const slice = lines.slice(startLine - 1, cappedEnd);
    let content = slice.map((line, idx) => `${startLine + idx}: ${line}`).join('\n');
    let truncated = cappedEnd < totalLines || cappedEnd < requestedEnd;
    if (Buffer.byteLength(content, 'utf8') > MAX_READ_BYTES) {
      content = content.slice(0, MAX_READ_BYTES);
      truncated = true;
    }
    return {
      path: relative,
      totalLines,
      startLine,
      endLine: cappedEnd,
      truncated,
      content: redactSecrets(content)
    };
  }

  function read(args) {
    const { resolved, relative } = resolveAllowed(args.path, { allowMissing: false });
    const st = fs.lstatSync(resolved);
    if (!st.isFile()) throw Error('Target path is not a regular file');
    if (st.size > MAX_SEARCH_FILE_BYTES) throw Error('File exceeds 2 MB read limit; inspect a smaller slice or file');
    const raw = fs.readFileSync(resolved);
    return formatReadSlice(relative, raw, args);
  }

  async function readBatch(args = {}) {
    if (!Array.isArray(args.files) || args.files.length < 1 || args.files.length > MAX_BATCH_FILES) {
      throw Error(`files must be an array of 1..${MAX_BATCH_FILES} file specs`);
    }

    // Validate all paths upfront so security violations (traversal, symlink, credential) fail closed
    const resolvedSpecs = args.files.map((item, idx) => {
      if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !item.path.trim()) {
        throw Error(`files[${idx}].path is required`);
      }
      const { resolved, relative } = resolveAllowed(item.path, { allowMissing: false });
      const st = fs.lstatSync(resolved);
      if (!st.isFile()) throw Error(`Target path is not a regular file: ${relative}`);
      if (st.size > MAX_SEARCH_FILE_BYTES) {
        throw Error(`File exceeds 2 MB read limit: ${relative}`);
      }
      return { item, resolved, relative };
    });

    const files = await Promise.all(
      resolvedSpecs.map(async ({ item, resolved, relative }) => {
        const raw = await fs.promises.readFile(resolved);
        return formatReadSlice(relative, raw, item);
      })
    );

    const totalBytes = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
    const anyTruncated = files.some(f => f.truncated);
    const fullPayload = {
      ok: true,
      count: files.length,
      totalBytes,
      truncated: anyTruncated,
      files
    };

    const serialized = JSON.stringify(fullPayload);
    const frameBytes = Buffer.byteLength(serialized, 'utf8');
    if (frameBytes <= MAX_BATCH_FRAME_BYTES) {
      return fullPayload;
    }

    // Exceeds safe broker frame margin (< 256 KB): stage full JSON to scratchDir if available
    if (realScratch) {
      fs.mkdirSync(realScratch, { recursive: true });
      const stagedPath = path.join(
        realScratch,
        `read_batch_${Date.now()}_${crypto.randomUUID().slice(0, 6)}.json`
      );
      fs.writeFileSync(stagedPath, serialized + '\n', 'utf8');
      const perFilePreview = Math.max(1024, Math.floor((MAX_BATCH_FRAME_BYTES - 8192) / files.length));
      return {
        ok: true,
        count: files.length,
        totalBytes,
        bytes: frameBytes,
        truncated: true,
        stagedPath,
        files: files.map(f => ({
          ...f,
          truncated: true,
          content: f.content.length > perFilePreview ? f.content.slice(0, perFilePreview) : f.content
        }))
      };
    }

    const perFileCap = Math.max(1024, Math.floor((MAX_BATCH_FRAME_BYTES - 8192) / files.length));
    return {
      ok: true,
      count: files.length,
      totalBytes,
      truncated: true,
      files: files.map(f => ({
        ...f,
        truncated: true,
        content: f.content.length > perFileCap ? f.content.slice(0, perFileCap) : f.content
      }))
    };
  }

  async function search(args = {}) {
    const rawQueries = Array.isArray(args.queries)
      ? args.queries
      : (typeof args.query === 'string' && args.query.length ? [args.query] : []);
    if (rawQueries.length < 1 || rawQueries.length > MAX_SEARCH_QUERIES) {
      throw Error(`Provide query or queries (1..${MAX_SEARCH_QUERIES} non-empty strings)`);
    }
    const normalizedQueries = rawQueries.map((q, idx) => {
      if (typeof q !== 'string' || !q.length || q.length > 500) {
        throw Error(`Invalid search query at index ${idx}`);
      }
      return q;
    });

    const { resolved, root, relative } = resolveAllowed(args.path ?? '.', { allowMissing: false });
    const maxMatchesPerQuery = Math.min(Math.max(1, Number(args.maxMatches ?? 50)), MAX_SEARCH_MATCHES);
    const totalMatchCap = normalizedQueries.length > 1
      ? Math.min(maxMatchesPerQuery * normalizedQueries.length, 400)
      : maxMatchesPerQuery;
    const caseSensitive = Boolean(args.caseSensitive);
    const isRegex = Boolean(args.regex);
    const includeRegexes = compileGlobList(args.include);
    const excludeRegexes = compileGlobList(args.exclude);

    const matchers = normalizedQueries.map(q => {
      if (isRegex) {
        try {
          const rx = new RegExp(q, caseSensitive ? '' : 'i');
          return { query: q, test: line => rx.test(line) };
        } catch (e) {
          throw Error(`Invalid search regex "${q}": ${e.message}`);
        }
      }
      const needle = caseSensitive ? q : q.toLowerCase();
      return {
        query: q,
        test: line => (caseSensitive ? line : line.toLowerCase()).includes(needle)
      };
    });

    const rootStat = fs.lstatSync(resolved);
    const explicitArtifactTarget =
      rootStat.isFile() ||
      (args.path !== undefined && args.path !== '' && args.path !== '.' && ARTIFACT_PATH_RE.test(relative));
    const activeSkipDirs = explicitArtifactTarget ? SKIP_DIRS : DEFAULT_SEARCH_SKIP_DIRS;

    const MAX_FILES = 1500;
    const candidates = [];
    let skippedDirs = 0;
    let skippedLargeDumps = 0;
    let truncated = false;

    function maybeEnqueueFile(filePath, st) {
      if (candidates.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      if (isCredentialPath(filePath)) return;
      if (st.isSymbolicLink() || !st.isFile()) return;
      if (st.size > MAX_SEARCH_FILE_BYTES) return;
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      if (!explicitArtifactTarget && DUMP_EXT_RE.test(rel) && st.size > MAX_SEARCH_DUMP_BYTES) {
        skippedLargeDumps++;
        return;
      }
      if (includeRegexes.length > 0 && !includeRegexes.some(rx => rx.test(rel))) return;
      if (excludeRegexes.length > 0 && excludeRegexes.some(rx => rx.test(rel))) return;
      candidates.push({ filePath, rel });
    }

    function collectWalk(dir, depth) {
      if (candidates.length >= MAX_FILES) {
        truncated = true;
        return;
      }
      const st = fs.lstatSync(dir);
      if (st.isFile()) {
        maybeEnqueueFile(dir, st);
        return;
      }
      if (!st.isDirectory()) return;
      for (const name of fs.readdirSync(dir).sort()) {
        if (candidates.length >= MAX_FILES) {
          truncated = true;
          return;
        }
        const full = path.join(dir, name);
        let childStat;
        try { childStat = fs.lstatSync(full); } catch { continue; }
        if (childStat.isSymbolicLink()) continue;
        if (childStat.isDirectory()) {
          if (activeSkipDirs.has(name)) {
            skippedDirs++;
            continue;
          }
          if (depth < 10) collectWalk(full, depth + 1);
        } else if (childStat.isFile()) {
          maybeEnqueueFile(full, childStat);
        }
      }
    }

    collectWalk(resolved, 0);

    // Concurrent bounded async scan over candidate files
    const perFileResults = new Array(candidates.length);
    let nextIndex = 0;
    let filesSearched = 0;

    const worker = async () => {
      while (true) {
        const idx = nextIndex++;
        if (idx >= candidates.length) break;
        const { filePath, rel } = candidates[idx];
        let buf;
        try {
          buf = await fs.promises.readFile(filePath);
        } catch {
          continue;
        }
        if (buf.includes(0)) continue;
        filesSearched++;
        const lines = buf.toString('utf8').split(/\r?\n/);
        const fileHits = [];
        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
          const line = lines[lineIdx];
          for (let qIdx = 0; qIdx < matchers.length; qIdx++) {
            if (matchers[qIdx].test(line)) {
              fileHits.push({
                qIdx,
                query: matchers[qIdx].query,
                file: rel,
                line: lineIdx + 1,
                text: redactSecrets(line.slice(0, 300))
              });
            }
          }
        }
        if (fileHits.length > 0) perFileResults[idx] = fileHits;
      }
    };

    const poolSize = Math.min(SEARCH_CONCURRENCY, Math.max(1, candidates.length));
    await Promise.all(Array.from({ length: poolSize }, () => worker()));

    const matches = [];
    const matchesByQuery = Object.fromEntries(normalizedQueries.map(q => [q, []]));
    const perQueryCounts = new Array(normalizedQueries.length).fill(0);

    for (const fileHits of perFileResults) {
      if (!fileHits) continue;
      for (const hit of fileHits) {
        if (matches.length >= totalMatchCap) {
          truncated = true;
          break;
        }
        if (perQueryCounts[hit.qIdx] >= maxMatchesPerQuery) {
          truncated = true;
          continue;
        }
        perQueryCounts[hit.qIdx]++;
        const matchObj = {
          query: hit.query,
          file: hit.file,
          line: hit.line,
          text: hit.text
        };
        matches.push(matchObj);
        matchesByQuery[hit.query].push(matchObj);
      }
      if (matches.length >= totalMatchCap) break;
    }

    return {
      query: normalizedQueries[0],
      queries: normalizedQueries,
      path: relative,
      matches,
      matchesByQuery,
      filesSearched,
      skippedDirs,
      skippedLargeDumps,
      truncated
    };
  }

  function edit(args = {}) {
    const isBatch = Array.isArray(args.edits);
    const items = isBatch ? args.edits : [args];
    if (isBatch && (items.length < 1 || items.length > MAX_EDIT_BATCH)) {
      throw Error(`edits must be an array of 1..${MAX_EDIT_BATCH} file edits`);
    }

    // Phase 1: Validate ALL edits in memory BEFORE touching disk (atomic all-or-nothing)
    const fileStates = new Map();
    const editPlans = [];

    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item || typeof item !== 'object') {
        throw Error(`edits[${idx}] must be an object`);
      }
      const hasTarget = item.target !== undefined;
      const hasContent = item.content !== undefined;
      if (hasTarget && hasContent) {
        throw Error('Specify either target+replacement or content, not both');
      }
      if (!hasTarget && !hasContent) {
        throw Error('Specify target+replacement for surgical edit or content to write a file');
      }

      const { resolved, relative } = resolveAllowed(item.path, {
        allowMissing: hasContent,
        blockGitInternal: true
      });

      let state = fileStates.get(resolved);
      if (!state) {
        const existed = fs.existsSync(resolved);
        let originalBuf = null;
        if (existed) {
          const st = fs.lstatSync(resolved);
          if (st.isSymbolicLink()) throw Error('Symlinks are refused in workspace tools');
          if (!st.isFile()) throw Error('Target path is not a regular file');
          originalBuf = fs.readFileSync(resolved);
        }
        state = {
          resolved,
          relative,
          existed,
          originalBuf,
          content: existed ? originalBuf.toString('utf8') : null,
          airGapSurfaceWarning: /(?:^|\/)verifier\//i.test(relative)
        };
        fileStates.set(resolved, state);
      }

      let nextContent;
      let mode;
      let replacements = 0;

      if (hasTarget) {
        if (typeof item.target !== 'string' || !item.target.length) {
          throw Error('Non-empty target text is required');
        }
        if (typeof item.replacement !== 'string') {
          throw Error('replacement string is required with target');
        }
        if (state.content === null) {
          throw Error('Path does not exist: ' + relative);
        }
        const current = state.content;
        const count = current.split(item.target).length - 1;
        if (count === 0) {
          throw Error('Target text not found in file: ' + relative);
        }
        if (count > 1 && !item.replaceAll) {
          throw Error(`Target text matched ${count} times in ${relative}; provide more context or set replaceAll: true`);
        }
        nextContent = item.replaceAll
          ? current.split(item.target).join(item.replacement)
          : current.replace(item.target, item.replacement);
        replacements = item.replaceAll ? count : 1;
        mode = 'edit';
      } else {
        if (typeof item.content !== 'string') {
          throw Error('content must be a string');
        }
        if (Buffer.byteLength(item.content, 'utf8') > MAX_WRITE_BYTES) {
          throw Error('File write exceeds 256 KB limit');
        }
        nextContent = item.content;
        mode = 'write';
      }

      const nextBytes = Buffer.byteLength(nextContent, 'utf8');
      if (nextBytes > MAX_WRITE_BYTES) {
        throw Error('Resulting file exceeds 256 KB limit');
      }

      // Enforce Generator <-> Verifier air-gap cross-import rules BEFORE any disk writes
      assertNoAirGapCrossImport(relative, nextContent);

      state.content = nextContent;
      editPlans.push({
        resolved,
        path: relative,
        mode,
        replacements,
        bytes: nextBytes,
        sha256: crypto.createHash('sha256').update(nextContent, 'utf8').digest('hex'),
        airGapSurfaceWarning: state.airGapSurfaceWarning
      });
    }

    // Phase 2: Write per-file .tmp files, then commit renames with rollback on failure
    const uniqueStates = Array.from(fileStates.values());
    const tmpFiles = [];
    const committed = [];

    try {
      for (const state of uniqueStates) {
        fs.mkdirSync(path.dirname(state.resolved), { recursive: true });
        if (fs.existsSync(state.resolved) && fs.lstatSync(state.resolved).isSymbolicLink()) {
          throw Error('Symlinks are refused in workspace tools');
        }
        const tmpPath = `${state.resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
        fs.writeFileSync(tmpPath, state.content, 'utf8');
        tmpFiles.push({ state, tmpPath });
      }

      for (const { state, tmpPath } of tmpFiles) {
        fs.renameSync(tmpPath, state.resolved);
        committed.push(state);
      }
    } catch (commitErr) {
      // Roll back any already-committed files so partial edits never happen
      for (const state of committed) {
        try {
          if (state.existed && state.originalBuf !== null) {
            fs.writeFileSync(state.resolved, state.originalBuf);
          } else if (fs.existsSync(state.resolved)) {
            fs.unlinkSync(state.resolved);
          }
        } catch {}
      }
      throw commitErr;
    } finally {
      for (const { tmpPath } of tmpFiles) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {}
      }
    }

    if (!isBatch) {
      const p = editPlans[0];
      return {
        ok: true,
        path: p.path,
        mode: p.mode,
        replacements: p.replacements,
        bytes: p.bytes,
        sha256: p.sha256,
        ...(p.airGapSurfaceWarning ? { airGapSurfaceWarning: true } : {})
      };
    }

    const totalBytes = uniqueStates.reduce((sum, s) => sum + Buffer.byteLength(s.content, 'utf8'), 0);
    const anyAirGapWarning = uniqueStates.some(s => s.airGapSurfaceWarning);
    return {
      ok: true,
      atomic: true,
      count: editPlans.length,
      filesModified: uniqueStates.length,
      totalBytes,
      edits: editPlans.map(({ resolved: _r, ...rest }) => rest),
      ...(anyAirGapWarning ? { airGapSurfaceWarning: true } : {})
    };
  }

  function runCommand(args) {
    const rawCommand = String(args.command || '').trim();
    if (!rawCommand || /[\r\n\0]/.test(rawCommand)) throw Error('Valid command executable required');
    const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
    const baseName = path.basename(rawCommand).toLowerCase().replace(/\.(exe|cmd|bat)$/i, '');
    if (!ALLOWED_COMMANDS.has(baseName)) {
      throw Error(`Command "${rawCommand}" is not in the bounded Mode B allowlist (${[...ALLOWED_COMMANDS].join(', ')})`);
    }
    if (baseName === 'git' && cmdArgs.length && DESTRUCTIVE_GIT_RE.test(cmdArgs[0])) {
      throw Error(`Destructive git subcommand "${cmdArgs[0]}" is blocked in Mode B tools`);
    }

    const combinedText = [rawCommand, ...cmdArgs].join(' ');
    if (/api[_-]?keys?\.txt/i.test(combinedText) || /(?:^|\s|["'/\\])\.env(?:\.[a-z0-9_-]+)?(?=$|\s|["'])/i.test(combinedText)) {
      throw Error('Commands referencing credential or API key files are blocked');
    }

    const { resolved: cwd, relative: cwdRel } = resolveAllowed(args.cwd ?? '.', { allowMissing: false });
    if (!fs.lstatSync(cwd).isDirectory()) throw Error('cwd must be a directory');

    const timeoutMs = Math.min(Math.max(1000, Number(args.timeoutMs ?? DEFAULT_TIMEOUT_MS)), MAX_TIMEOUT_MS);
    const cleanEnv = { ...process.env, TOPOGEN_ECOSYSTEM: ecosystem, ALICE_ECOSYSTEM: ecosystem };
    for (const key of Object.keys(cleanEnv)) {
      if (/^(?:GEMINI|OPENAI|ANTHROPIC)_API_KEY$|^(?:TOPOGEN|ALICE)_FOUNDRY_TOKEN$|SECRET|PASSWORD/i.test(key)) {
        delete cleanEnv[key];
      }
    }

    const startedAt = Date.now();
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let truncated = false;
      let timedOut = false;
      let settled = false;
      const child = spawn(rawCommand, cmdArgs, {
        cwd,
        env: cleanEnv,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch {}
      }, timeoutMs);

      function append(target, chunk) {
        const text = chunk.toString('utf8');
        const remaining = MAX_COMMAND_OUTPUT - (stdout.length + stderr.length);
        if (remaining <= 0) { truncated = true; return target; }
        if (text.length > remaining) { truncated = true; return target + text.slice(0, remaining); }
        return target + text;
      }

      child.stdout.on('data', chunk => { stdout = append(stdout, chunk); });
      child.stderr.on('data', chunk => { stderr = append(stderr, chunk); });
      child.on('error', err => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        reject(Error('Command launch failed: ' + err.message));
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (settled) return;
        settled = true;
        const ok = code === 0 && !timedOut;
        resolve({
          ok,
          command: rawCommand,
          args: cmdArgs,
          cwd: cwdRel,
          exitCode: code,
          signal: signal || null,
          timedOut,
          durationMs: Math.max(0, Date.now() - startedAt),
          stdout: redactSecrets(stdout),
          stderr: redactSecrets(stderr),
          truncated,
          ...(ok ? {} : { message: timedOut ? `Command timed out after ${timeoutMs}ms` : `Command exited with code ${code}` })
        });
      });
    });
  }

  return {
    roots,
    resolveAllowed,
    list,
    read,
    readBatch,
    search,
    edit,
    runCommand,
    async execute(operation, args = {}) {
      if (operation === 'workspace.list') return list(args);
      if (operation === 'workspace.read') return read(args);
      if (operation === 'workspace.read_batch') return readBatch(args);
      if (operation === 'workspace.search') return search(args);
      if (operation === 'workspace.edit') return edit(args);
      if (operation === 'workspace.run_command') return runCommand(args);
      throw Error('Unknown workspace operation: ' + operation);
    }
  };
}

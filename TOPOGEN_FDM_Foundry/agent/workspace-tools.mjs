import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const MAX_READ_LINES = 400;
const MAX_READ_BYTES = 64 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 200;
const MAX_SEARCH_MATCHES = 100;
const MAX_SEARCH_FILE_BYTES = 2 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 64 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;

const SKIP_DIRS = new Set(['.git', 'node_modules', 'build', 'dist', '__pycache__']);
const ALLOWED_COMMANDS = new Set([
  'node', 'npm', 'npx', 'git', 'pwsh', 'powershell', 'clang++', 'python', 'python3'
]);

const CREDENTIAL_NAME_RE = /^(?:api[_-]?keys?(?:\.[a-z0-9]+)?|\.env(?:\..+)?|id_rsa|id_ed25519|agent-session\.json)$/i;
const CREDENTIAL_EXT_RE = /\.(?:pem|key|pfx|p12|jks|keystore)$/i;
const CREDENTIAL_PATH_RE = /(?:^|\/)(?:api[_-]?keys?(?:\.[a-z0-9]+)?|\.env(?:\..+)?|credentials?(?:\.[a-z0-9]+)?|secrets?(?:\.[a-z0-9]+)?|agent-session\.json)(?:$|\/)/i;
const DESTRUCTIVE_GIT_RE = /^(?:push|reset|clean|rebase|filter-branch)$/i;

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

  function read(args) {
    const { resolved, relative } = resolveAllowed(args.path, { allowMissing: false });
    const st = fs.lstatSync(resolved);
    if (!st.isFile()) throw Error('Target path is not a regular file');
    if (st.size > MAX_SEARCH_FILE_BYTES) throw Error('File exceeds 2 MB read limit; inspect a smaller slice or file');
    const raw = fs.readFileSync(resolved);
    if (raw.includes(0)) throw Error('Binary files cannot be read as text');
    const text = raw.toString('utf8');
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

  function search(args) {
    const { resolved, root, relative } = resolveAllowed(args.path ?? '.', { allowMissing: false });
    const maxMatches = Math.min(Math.max(1, Number(args.maxMatches ?? 50)), MAX_SEARCH_MATCHES);
    const caseSensitive = Boolean(args.caseSensitive);
    let matcher;
    if (args.regex) {
      try { matcher = new RegExp(args.query, caseSensitive ? '' : 'i'); }
      catch (e) { throw Error('Invalid search regex: ' + e.message); }
    } else {
      const needle = caseSensitive ? args.query : args.query.toLowerCase();
      matcher = { test: line => (caseSensitive ? line : line.toLowerCase()).includes(needle) };
    }

    const matches = [];
    let filesSearched = 0;
    let truncated = false;
    const MAX_FILES = 1500;

    function scanFile(filePath) {
      if (filesSearched >= MAX_FILES || matches.length >= maxMatches) { truncated = true; return; }
      if (isCredentialPath(filePath)) return;
      let st;
      try { st = fs.lstatSync(filePath); } catch { return; }
      if (st.isSymbolicLink() || !st.isFile() || st.size > MAX_SEARCH_FILE_BYTES) return;
      let buf;
      try { buf = fs.readFileSync(filePath); } catch { return; }
      if (buf.includes(0)) return;
      filesSearched++;
      const lines = buf.toString('utf8').split(/\r?\n/);
      const rel = path.relative(root, filePath).replace(/\\/g, '/');
      for (let i = 0; i < lines.length; i++) {
        if (matcher.test(lines[i])) {
          matches.push({ file: rel, line: i + 1, text: redactSecrets(lines[i].slice(0, 300)) });
          if (matches.length >= maxMatches) { truncated = true; return; }
        }
      }
    }

    function walk(dir, depth) {
      if (filesSearched >= MAX_FILES || matches.length >= maxMatches) { truncated = true; return; }
      const st = fs.lstatSync(dir);
      if (st.isFile()) { scanFile(dir); return; }
      if (!st.isDirectory()) return;
      for (const name of fs.readdirSync(dir).sort()) {
        if (filesSearched >= MAX_FILES || matches.length >= maxMatches) { truncated = true; return; }
        const full = path.join(dir, name);
        let childStat;
        try { childStat = fs.lstatSync(full); } catch { continue; }
        if (childStat.isSymbolicLink()) continue;
        if (childStat.isDirectory()) {
          if (depth < 10 && !SKIP_DIRS.has(name)) walk(full, depth + 1);
        } else if (childStat.isFile()) {
          scanFile(full);
        }
      }
    }

    walk(resolved, 0);
    return { query: args.query, path: relative, matches, filesSearched, truncated };
  }

  function edit(args) {
    const hasTarget = args.target !== undefined;
    const hasContent = args.content !== undefined;
    if (hasTarget && hasContent) throw Error('Specify either target+replacement or content, not both');
    if (!hasTarget && !hasContent) throw Error('Specify target+replacement for surgical edit or content to write a file');

    const { resolved, relative } = resolveAllowed(args.path, { allowMissing: hasContent, blockGitInternal: true });

    let nextContent;
    let mode;
    let replacements = 0;

    if (hasTarget) {
      if (typeof args.target !== 'string' || !args.target.length) throw Error('Non-empty target text is required');
      if (typeof args.replacement !== 'string') throw Error('replacement string is required with target');
      const st = fs.lstatSync(resolved);
      if (!st.isFile()) throw Error('Target path is not a regular file');
      const current = fs.readFileSync(resolved, 'utf8');
      const count = current.split(args.target).length - 1;
      if (count === 0) throw Error('Target text not found in file: ' + relative);
      if (count > 1 && !args.replaceAll) {
        throw Error(`Target text matched ${count} times in ${relative}; provide more context or set replaceAll: true`);
      }
      nextContent = args.replaceAll
        ? current.split(args.target).join(args.replacement)
        : current.replace(args.target, args.replacement);
      replacements = args.replaceAll ? count : 1;
      mode = 'edit';
    } else {
      if (typeof args.content !== 'string') throw Error('content must be a string');
      if (Buffer.byteLength(args.content, 'utf8') > MAX_WRITE_BYTES) throw Error('File write exceeds 256 KB limit');
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
        throw Error('Symlinks are refused in workspace tools');
      }
      nextContent = args.content;
      mode = 'write';
    }

    if (Buffer.byteLength(nextContent, 'utf8') > MAX_WRITE_BYTES) throw Error('Resulting file exceeds 256 KB limit');
    const tmp = `${resolved}.tmp-${process.pid}-${crypto.randomUUID()}`;
    try {
      fs.writeFileSync(tmp, nextContent, 'utf8');
      fs.renameSync(tmp, resolved);
    } finally {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
    const sha256 = crypto.createHash('sha256').update(nextContent, 'utf8').digest('hex');
    const airGapSurfaceWarning = /(?:^|\/)verifier\//i.test(relative);
    return {
      ok: true,
      path: relative,
      mode,
      replacements,
      bytes: Buffer.byteLength(nextContent, 'utf8'),
      sha256,
      ...(airGapSurfaceWarning ? { airGapSurfaceWarning: true } : {})
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
    search,
    edit,
    runCommand,
    async execute(operation, args = {}) {
      if (operation === 'workspace.list') return list(args);
      if (operation === 'workspace.read') return read(args);
      if (operation === 'workspace.search') return search(args);
      if (operation === 'workspace.edit') return edit(args);
      if (operation === 'workspace.run_command') return runCommand(args);
      throw Error('Unknown workspace operation: ' + operation);
    }
  };
}

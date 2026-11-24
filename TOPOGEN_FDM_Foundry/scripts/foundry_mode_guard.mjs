#!/usr/bin/env node
/**
 * Cryptographic Mode A / Mode B Surface Boundary Verifier & Resealer for TOPOGEN_FDM_Foundry.
 *
 * Zero-dependency Node ESM — runnable as CLI and importable as a library.
 *
 * Enforces the Dual-Mode Governance contract against `foundry_manifest.json`:
 *   - Mode A (`--mode A --verify`): Asserts 0 bytes of sealed generator/runtime code
 *     (`modeB_sealedCodeGlobs`) or air-gapped verifier machinery (`modeB_sealedVerifierGlobs`)
 *     have drifted, AND audits 0 generator <-> verifier cross-imports, while permitting Mode A
 *     tuning on `modeA_mutableGlobs` (`briefs/**`, `runs/**`, `skills/**`, `specs/**`).
 *   - Mode A (`--mode A --reseal`): Strictly forbidden; fails closed with exit code 2
 *     (`MODE LOCK VIOLATION`).
 *   - Mode B (`--mode B --reseal`): Runs `verifier/test_verifier.mjs` (unless `--skip-bench`)
 *     + air-gap cross-import audit, recomputes deterministic `sha256-sorted-path-and-bytes-v1`
 *     aggregate and per-file SHA-256 digests, and atomically updates `foundry_manifest.json`.
 *   - Self-Test (`--self-test`): Executes a non-destructive 4-part adversarial sandbox test.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FOUNDRY_ROOT = path.resolve(__dirname, '..');

export const MANIFEST_PATH = path.join(DEFAULT_FOUNDRY_ROOT, 'foundry_manifest.json');

const SEAL_ALGORITHM = 'sha256-sorted-path-and-bytes-v1';
const ALWAYS_IGNORED_DIRS = new Set(['.git', 'node_modules', 'build', 'outputs', '.rsi_snapshots']);

/**
 * Convert a glob pattern to a RegExp matching POSIX-style relative paths.
 * Mirrors ALICE `Convert-GlobToRegex` semantics (`**\/`, `**`, `*`, `?`).
 */
function globToRegex(glob) {
  const norm = String(glob || '').replace(/\\/g, '/').replace(/^\/+/, '');
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

function collectFilesRecursive(baseDir, currentDir, skipRuns, out) {
  let entries;
  try {
    entries = fs.readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const name = entry.name;
    const fullPath = path.join(currentDir, name);
    const rel = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      if (ALWAYS_IGNORED_DIRS.has(name)) continue;
      if (skipRuns && rel === 'runs') continue;
      if (rel === 'artifacts/repro_run') continue;
      collectFilesRecursive(baseDir, fullPath, skipRuns, out);
    } else if (entry.isFile()) {
      out.push(rel);
    }
  }
}

function computeSurfaceSeal(foundryRoot, globs) {
  const fullBase = path.resolve(foundryRoot);
  const cleanGlobs = (Array.isArray(globs) ? globs : []).filter((g) => typeof g === 'string' && g.trim().length > 0);
  const regexes = cleanGlobs.map(globToRegex);
  const needsRuns = cleanGlobs.some((g) => g.replace(/\\/g, '/').startsWith('runs'));

  const allFiles = [];
  collectFilesRecursive(fullBase, fullBase, !needsRuns, allFiles);

  const matchedSet = new Set();
  for (const rel of allFiles) {
    for (const rx of regexes) {
      if (rx.test(rel)) {
        matchedSet.add(rel);
        break;
      }
    }
  }

  const sortedRel = Array.from(matchedSet).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const surfaceHasher = crypto.createHash('sha256');
  const fileMap = {};

  for (const rel of sortedRel) {
    const abs = path.join(fullBase, rel);
    const fileBytes = fs.readFileSync(abs);
    const fileHex = crypto.createHash('sha256').update(fileBytes).digest('hex');
    fileMap[rel] = fileHex;
    surfaceHasher.update(`${rel}:${fileHex}\n`, 'utf8');
  }

  return {
    sha256: surfaceHasher.digest('hex'),
    fileCount: sortedRel.length,
    fileMap,
  };
}

function compareFileMaps(expectedMap, actualMap, surfaceLabel) {
  const diffs = [];
  if (!expectedMap || typeof expectedMap !== 'object') {
    return [`${surfaceLabel}: aggregate SHA-256 mismatch (run --mode B --reseal to populate per-file index)`];
  }
  const expKeys = Object.keys(expectedMap);
  const actKeys = Object.keys(actualMap);
  const expSet = new Set(expKeys);

  for (const k of expKeys) {
    if (!Object.prototype.hasOwnProperty.call(actualMap, k)) {
      diffs.push(`[DELETED] (${surfaceLabel}) ${k}`);
    } else if (actualMap[k] !== expectedMap[k]) {
      diffs.push(`[MODIFIED] (${surfaceLabel}) ${k} (expected ${expectedMap[k]}, got ${actualMap[k]})`);
    }
  }
  for (const k of actKeys) {
    if (!expSet.has(k)) {
      diffs.push(`[ADDED] (${surfaceLabel}) ${k} (${actualMap[k]})`);
    }
  }
  return diffs;
}

/**
 * Strip JS (`//`, `/* ... *\/`) and HTML (`<!-- ... -->`) comments while preserving
 * line numbers and string literals so comment documentation never triggers false positives.
 */
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
      const chunk = source.slice(i, stop);
      out += chunk.replace(/[^\n]/g, ' ');
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
      const chunk = source.slice(i, stop);
      out += chunk.replace(/[^\n]/g, ' ');
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

/**
 * Audit strict Generator <-> Verifier air-gap across the foundry.
 *
 * Generator surfaces (`core/**`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`,
 * `run_generator.mjs`, `workers/generator_worker.mjs`) must have 0 imports or
 * code references to `verifier/` or `verifier_worker.mjs`.
 *
 * Verifier surfaces (`verifier/**`, `workers/verifier_worker.mjs`) must have
 * 0 imports or code references to generator files (`core/`, `run_generator.mjs`,
 * `generator_worker.mjs`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `index_WFC.html`).
 */
export function auditAirGap(foundryRoot = DEFAULT_FOUNDRY_ROOT) {
  const fullBase = path.resolve(foundryRoot);
  const allFiles = [];
  collectFilesRecursive(fullBase, fullBase, true, allFiles);

  const codeExtRx = /\.(mjs|js|cjs|ts|html|htm)$/i;
  const generatorFiles = [];
  const verifierFiles = [];

  for (const rel of allFiles) {
    if (
      (rel.startsWith('core/') && codeExtRx.test(rel)) ||
      rel === 'index_TOPOGEN_PQM_ELASTICA_FDM.html' ||
      rel === 'run_generator.mjs' ||
      rel === 'workers/generator_worker.mjs'
    ) {
      generatorFiles.push(rel);
    } else if (
      (rel.startsWith('verifier/') && codeExtRx.test(rel)) ||
      rel === 'workers/verifier_worker.mjs'
    ) {
      verifierFiles.push(rel);
    }
  }

  generatorFiles.sort();
  verifierFiles.sort();

  const violations = [];
  let generatorToVerifierCross = 0;
  let verifierToGeneratorCross = 0;

  const genRefPattern = /(?:['"`][^'"`\r\n]*?(?:verifier[\\/]|verifier_worker\.mjs|fea_solver\.mjs|fabrication_check\.mjs)[^'"`\r\n]*?['"`])/;
  const verRefPattern = /(?:['"`][^'"`\r\n]*?(?:index_TOPOGEN_PQM_ELASTICA_FDM\.html|index_WFC\.html|run_generator\.mjs|generator_worker\.mjs|(?:^|[\\/\.])core[\\/])[^'"`\r\n]*?['"`])/;
  const codeImportOrIoPattern = /\b(?:import|export|require|from|readFileSync|readFile|createReadStream|fetch|Worker|spawn|spawnSync|execFile|execFileSync)\b|<script\b/i;

  for (const rel of generatorFiles) {
    const abs = path.join(fullBase, rel);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const cleaned = stripCommentsPreserveLines(raw, /\.html?$/i.test(rel));
    const lines = cleaned.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (genRefPattern.test(line) && (codeImportOrIoPattern.test(line) || /\bverifier[\\/]/.test(line))) {
        generatorToVerifierCross += 1;
        violations.push({
          direction: 'generator->verifier',
          file: rel,
          line: idx + 1,
          excerpt: line.trim().slice(0, 160),
        });
      }
    }
  }

  for (const rel of verifierFiles) {
    const abs = path.join(fullBase, rel);
    if (!fs.existsSync(abs)) continue;
    const raw = fs.readFileSync(abs, 'utf8');
    const cleaned = stripCommentsPreserveLines(raw, /\.html?$/i.test(rel));
    const lines = cleaned.split(/\r?\n/);
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      if (verRefPattern.test(line) && codeImportOrIoPattern.test(line)) {
        verifierToGeneratorCross += 1;
        violations.push({
          direction: 'verifier->generator',
          file: rel,
          line: idx + 1,
          excerpt: line.trim().slice(0, 160),
        });
      }
    }
  }

  const airGapPassed = generatorToVerifierCross === 0 && verifierToGeneratorCross === 0;
  return {
    ok: airGapPassed,
    airGapPassed,
    generatorFileCount: generatorFiles.length,
    verifierFileCount: verifierFiles.length,
    generatorToVerifierCross,
    verifierToGeneratorCross,
    violations,
  };
}

function readManifest(foundryRoot, manifestPath) {
  const targetPath = manifestPath ? path.resolve(manifestPath) : path.join(path.resolve(foundryRoot), 'foundry_manifest.json');
  if (!fs.existsSync(targetPath)) {
    return { ok: false, manifestPath: targetPath, error: `Missing foundry_manifest.json at ${targetPath}` };
  }
  try {
    const raw = fs.readFileSync(targetPath, 'utf8');
    const manifest = JSON.parse(raw);
    return { ok: true, manifestPath: targetPath, manifest };
  } catch (err) {
    return { ok: false, manifestPath: targetPath, error: `Invalid JSON in ${targetPath}: ${err.message}` };
  }
}

function getBoundaryGlobs(manifest) {
  const mb = manifest.modeBoundaries || {};
  const codeGlobs = Array.isArray(mb.modeB_sealedCodeGlobs)
    ? mb.modeB_sealedCodeGlobs
    : (Array.isArray(manifest.modeB_sealedCodeGlobs) ? manifest.modeB_sealedCodeGlobs : []);
  const verifierGlobs = Array.isArray(mb.modeB_sealedVerifierGlobs)
    ? mb.modeB_sealedVerifierGlobs
    : (Array.isArray(manifest.modeB_sealedVerifierGlobs) ? manifest.modeB_sealedVerifierGlobs : []);
  const mutableGlobs = Array.isArray(mb.modeA_mutableGlobs)
    ? mb.modeA_mutableGlobs
    : (Array.isArray(manifest.modeA_mutableGlobs) ? manifest.modeA_mutableGlobs : []);
  return { codeGlobs, verifierGlobs, mutableGlobs };
}

function atomicWriteJson(targetPath, obj) {
  const dir = path.dirname(targetPath);
  const tmpPath = path.join(dir, `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);
  const payload = JSON.stringify(obj, null, 2) + '\n';
  fs.writeFileSync(tmpPath, payload, 'utf8');
  fs.renameSync(tmpPath, targetPath);
}

/**
 * Verify foundry surface seals and air-gap compliance against `foundry_manifest.json`.
 */
export function verifyFoundryMode(options = {}) {
  const mode = String(options.mode || 'A').toUpperCase();
  const foundryRoot = path.resolve(options.foundryRoot || DEFAULT_FOUNDRY_ROOT);
  const loaded = readManifest(foundryRoot, options.manifestPath);

  if (!loaded.ok) {
    return {
      ok: false,
      exitCode: 1,
      foundryId: 'TOPOGEN_FDM_FOUNDRY',
      mode,
      action: 'verify',
      error: loaded.error,
      offendingFiles: [loaded.error],
    };
  }

  const { manifest } = loaded;
  const foundryId = manifest.foundryId || 'TOPOGEN_FDM_FOUNDRY';
  const { codeGlobs, verifierGlobs } = getBoundaryGlobs(manifest);

  const codeCalc = computeSurfaceSeal(foundryRoot, codeGlobs);
  const verCalc = computeSurfaceSeal(foundryRoot, verifierGlobs);
  const airGap = auditAirGap(foundryRoot);

  const sealsObj = manifest.seals && typeof manifest.seals === 'object' ? manifest.seals : null;
  const expCodeSha = sealsObj && sealsObj.codeSurfaceSha256 ? String(sealsObj.codeSurfaceSha256) : 'UNSEALED';
  const expVerSha = sealsObj && sealsObj.verifierSurfaceSha256 ? String(sealsObj.verifierSurfaceSha256) : 'UNSEALED';

  const isUnsealed = (val) => !val || val === 'UNSEALED' || /^PENDING/i.test(val);
  const codeOk = !isUnsealed(expCodeSha) && expCodeSha.toLowerCase() === codeCalc.sha256;
  const verOk = !isUnsealed(expVerSha) && expVerSha.toLowerCase() === verCalc.sha256;

  const offendingFiles = [];
  if (!codeOk) {
    if (isUnsealed(expCodeSha)) {
      offendingFiles.push(`[UNSEALED] (codeSurface) foundry_manifest.json codeSurfaceSha256 is ${expCodeSha}`);
    } else {
      offendingFiles.push(...compareFileMaps(sealsObj.codeFiles, codeCalc.fileMap, 'codeSurface'));
    }
  }
  if (!verOk) {
    if (isUnsealed(expVerSha)) {
      offendingFiles.push(`[UNSEALED] (verifierSurface) foundry_manifest.json verifierSurfaceSha256 is ${expVerSha}`);
    } else {
      offendingFiles.push(...compareFileMaps(sealsObj.verifierFiles, verCalc.fileMap, 'verifierSurface'));
    }
  }
  if (!airGap.airGapPassed) {
    for (const v of airGap.violations) {
      offendingFiles.push(`[AIR-GAP] (${v.direction}) ${v.file}:${v.line} ${v.excerpt}`);
    }
  }

  const ok = codeOk && verOk && airGap.airGapPassed;
  return {
    ok,
    exitCode: ok ? 0 : 1,
    foundryId,
    mode,
    action: 'verify',
    algorithm: SEAL_ALGORITHM,
    expectedCodeSurfaceSha256: expCodeSha,
    actualCodeSurfaceSha256: codeCalc.sha256,
    codeFileCount: codeCalc.fileCount,
    expectedVerifierSurfaceSha256: expVerSha,
    actualVerifierSurfaceSha256: verCalc.sha256,
    verifierFileCount: verCalc.fileCount,
    airGapPassed: airGap.airGapPassed,
    airGap,
    sealedAtUtc: sealsObj ? (sealsObj.sealedAtUtc || null) : null,
    offendingFiles,
  };
}

/**
 * Recompute deterministic surface seals and atomically update `foundry_manifest.json`.
 * Strictly forbidden in Mode A (returns `exitCode: 2` with `MODE LOCK VIOLATION`).
 */
export function resealFoundryManifest(options = {}) {
  const mode = String(options.mode || 'A').toUpperCase();
  const foundryRoot = path.resolve(options.foundryRoot || DEFAULT_FOUNDRY_ROOT);
  const skipBench = Boolean(options.skipBench);

  if (mode !== 'B') {
    return {
      ok: false,
      exitCode: 2,
      foundryId: 'TOPOGEN_FDM_FOUNDRY',
      mode,
      action: 'reseal',
      error: 'MODE LOCK VIOLATION: --reseal is strictly forbidden in Mode A (--mode A). Switch to --mode B only after passing verifier benchmarks and air-gap gates.',
    };
  }

  const loaded = readManifest(foundryRoot, options.manifestPath);
  if (!loaded.ok) {
    return {
      ok: false,
      exitCode: 1,
      foundryId: 'TOPOGEN_FDM_FOUNDRY',
      mode,
      action: 'reseal',
      error: loaded.error,
    };
  }

  const { manifest, manifestPath } = loaded;
  const foundryId = manifest.foundryId || 'TOPOGEN_FDM_FOUNDRY';

  let benchPassed = null;
  let benchDetail = null;
  if (!skipBench) {
    const benchScript = path.join(foundryRoot, 'verifier', 'test_verifier.mjs');
    if (!fs.existsSync(benchScript)) {
      return {
        ok: false,
        exitCode: 1,
        foundryId,
        mode,
        action: 'reseal',
        error: `Verifier benchmark script not found at ${benchScript} (pass --skip-bench only in synthetic tests).`,
      };
    }
    const proc = spawnSync(process.execPath, [benchScript], {
      cwd: foundryRoot,
      encoding: 'utf8',
      timeout: 120000,
    });
    benchPassed = proc.status === 0;
    benchDetail = {
      exitCode: proc.status,
      stdoutTail: (proc.stdout || '').trim().split(/\r?\n/).slice(-5).join('\n'),
      stderrTail: (proc.stderr || '').trim().split(/\r?\n/).slice(-5).join('\n'),
    };
    if (!benchPassed) {
      return {
        ok: false,
        exitCode: 1,
        foundryId,
        mode,
        action: 'reseal',
        error: `Verifier benchmark gate (${benchScript}) failed with exit code ${proc.status}.`,
        benchPassed: false,
        benchDetail,
      };
    }
  }

  const airGap = auditAirGap(foundryRoot);
  if (!airGap.airGapPassed) {
    return {
      ok: false,
      exitCode: 2,
      foundryId,
      mode,
      action: 'reseal',
      error: `AIR-GAP VIOLATION: Cannot reseal with ${airGap.violations.length} cross-domain reference(s).`,
      airGapPassed: false,
      airGap,
    };
  }

  const { codeGlobs, verifierGlobs } = getBoundaryGlobs(manifest);
  const codeCalc = computeSurfaceSeal(foundryRoot, codeGlobs);
  const verCalc = computeSurfaceSeal(foundryRoot, verifierGlobs);
  const sealedAtUtc = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  manifest.seals = {
    algorithm: SEAL_ALGORITHM,
    codeSurfaceSha256: codeCalc.sha256,
    codeFileCount: codeCalc.fileCount,
    codeFiles: codeCalc.fileMap,
    verifierSurfaceSha256: verCalc.sha256,
    verifierFileCount: verCalc.fileCount,
    verifierFiles: verCalc.fileMap,
    airGapPassed: true,
    sealedAtUtc,
  };

  atomicWriteJson(manifestPath, manifest);

  return {
    ok: true,
    exitCode: 0,
    foundryId,
    mode,
    action: 'resealed',
    algorithm: SEAL_ALGORITHM,
    codeSurfaceSha256: codeCalc.sha256,
    codeFileCount: codeCalc.fileCount,
    verifierSurfaceSha256: verCalc.sha256,
    verifierFileCount: verCalc.fileCount,
    airGapPassed: true,
    benchSkipped: skipBench,
    benchPassed: skipBench ? null : benchPassed,
    sealedAtUtc,
  };
}

/**
 * Non-destructive 4-part adversarial sandbox verification.
 */
export function runSelfTest() {
  const sandboxRoot = path.join(
    os.tmpdir(),
    `topogen_foundry_guard_selftest_${process.pid}_${Date.now()}`
  );

  const runCli = (cliArgs) => {
    const proc = spawnSync(process.execPath, [__filename, ...cliArgs], {
      encoding: 'utf8',
      timeout: 30000,
    });
    return {
      status: proc.status,
      stdout: proc.stdout || '',
      stderr: proc.stderr || '',
      combined: `${proc.stdout || ''}\n${proc.stderr || ''}`,
    };
  };

  try {
    fs.mkdirSync(path.join(sandboxRoot, 'core'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'verifier'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'workers'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'briefs'), { recursive: true });
    fs.mkdirSync(path.join(sandboxRoot, 'skills'), { recursive: true });

    fs.writeFileSync(path.join(sandboxRoot, 'core', 'kernel.mjs'), 'export function solveFdm() { return 42; }\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'run_generator.mjs'), 'import { solveFdm } from "./core/kernel.mjs";\nexport const v = solveFdm();\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'workers', 'generator_worker.mjs'), 'import { solveFdm } from "../core/kernel.mjs";\nexport const w = solveFdm();\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'verifier', 'verify.mjs'), 'export function verifyCandidate() { return { passed: true }; }\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'workers', 'verifier_worker.mjs'), 'import { verifyCandidate } from "../verifier/verify.mjs";\nexport const vw = verifyCandidate();\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'briefs', 'pilot.json'), '{"name":"pilot","maxDeflectionRatio":300}\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'skills', 'SKILL.md'), '# TOPOGEN Foundry Skill\n', 'utf8');

    const manifestObj = {
      schemaVersion: '1.0.0',
      foundryId: 'TOPOGEN_FDM_FOUNDRY',
      semanticVersion: '2.0.0',
      modeBoundaries: {
        modeA_mutableGlobs: ['briefs/**', 'runs/**', 'skills/**', 'specs/**'],
        modeB_sealedCodeGlobs: ['core/**', 'run_generator.mjs', 'workers/generator_worker.mjs'],
        modeB_sealedVerifierGlobs: ['verifier/**', 'workers/verifier_worker.mjs'],
      },
      seals: {
        algorithm: SEAL_ALGORITHM,
        codeSurfaceSha256: 'UNSEALED',
        verifierSurfaceSha256: 'UNSEALED',
        airGapPassed: false,
      },
    };
    fs.writeFileSync(
      path.join(sandboxRoot, 'foundry_manifest.json'),
      JSON.stringify(manifestObj, null, 2) + '\n',
      'utf8'
    );

    // Step 0: Mode B --reseal initializes valid seals
    const setup = runCli(['--mode', 'B', '--reseal', '--skip-bench', '--foundry-root', sandboxRoot]);
    if (setup.status !== 0) {
      throw new Error(`SelfTest setup (--mode B --reseal) failed with exit ${setup.status}: ${setup.combined}`);
    }

    // Case D: --mode A --reseal MUST fail closed with exit code 2
    const resD = runCli(['--mode', 'A', '--reseal', '--skip-bench', '--foundry-root', sandboxRoot]);
    const caseD_modeAResealRejected = resD.status === 2 && /MODE LOCK VIOLATION/i.test(resD.combined);

    // Case A: Modifying briefs/ and skills/ MUST pass --mode A --verify
    fs.writeFileSync(path.join(sandboxRoot, 'briefs', 'pilot.json'), '{"name":"pilot","maxDeflectionRatio":250,"tuned":true}\n', 'utf8');
    fs.writeFileSync(path.join(sandboxRoot, 'skills', 'SKILL.md'), '# TOPOGEN Foundry Skill (Mode A tuned)\n', 'utf8');
    const resA = runCli(['--mode', 'A', '--verify', '--foundry-root', sandboxRoot]);
    const caseA_mutablePass = resA.status === 0;

    // Case B: Modifying 1 byte in modeB_sealedCodeGlobs MUST fail --mode A --verify
    const kernelPath = path.join(sandboxRoot, 'core', 'kernel.mjs');
    const origKernel = fs.readFileSync(kernelPath);
    const mutKernel = Buffer.from(origKernel);
    mutKernel[0] ^= 1;
    fs.writeFileSync(kernelPath, mutKernel);
    const resB = runCli(['--mode', 'A', '--verify', '--foundry-root', sandboxRoot]);
    const caseB_codeMutationRejected = resB.status !== 0 && /core\/kernel\.mjs/.test(resB.combined);
    fs.writeFileSync(kernelPath, origKernel);

    // Case C: Modifying 1 byte in modeB_sealedVerifierGlobs MUST fail --mode A --verify
    const verPath = path.join(sandboxRoot, 'verifier', 'verify.mjs');
    const origVer = fs.readFileSync(verPath);
    const mutVer = Buffer.from(origVer);
    mutVer[0] ^= 1;
    fs.writeFileSync(verPath, mutVer);
    const resC = runCli(['--mode', 'A', '--verify', '--foundry-root', sandboxRoot]);
    const caseC_verifierMutationRejected = resC.status !== 0 && /verifier\/verify\.mjs/.test(resC.combined);
    fs.writeFileSync(verPath, origVer);

    // Final sanity check after restoration
    const resClean = runCli(['--mode', 'A', '--verify', '--foundry-root', sandboxRoot]);
    const restoredCleanVerify = resClean.status === 0;

    const ok = Boolean(
      caseA_mutablePass &&
      caseB_codeMutationRejected &&
      caseC_verifierMutationRejected &&
      caseD_modeAResealRejected &&
      restoredCleanVerify
    );

    return {
      ok,
      exitCode: ok ? 0 : 1,
      op: 'foundry_mode_guard_selftest',
      caseA_mutablePass,
      caseB_codeMutationRejected,
      caseC_verifierMutationRejected,
      caseD_modeAResealRejected,
      restoredCleanVerify,
    };
  } finally {
    try {
      fs.rmSync(sandboxRoot, { recursive: true, force: true });
    } catch {
      // ignore cleanup error
    }
  }
}

function parseCliArgs(argv) {
  const opts = {
    mode: 'A',
    verify: false,
    reseal: false,
    skipBench: false,
    selfTest: false,
    foundryRoot: DEFAULT_FOUNDRY_ROOT,
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--mode' && i + 1 < argv.length) {
      opts.mode = String(argv[++i]).toUpperCase();
    } else if (arg.startsWith('--mode=')) {
      opts.mode = arg.slice('--mode='.length).toUpperCase();
    } else if (arg === '--verify') {
      opts.verify = true;
    } else if (arg === '--reseal') {
      opts.reseal = true;
    } else if (arg === '--skip-bench') {
      opts.skipBench = true;
    } else if (arg === '--self-test') {
      opts.selfTest = true;
    } else if (arg === '--foundry-root' && i + 1 < argv.length) {
      opts.foundryRoot = path.resolve(argv[++i]);
    } else if (arg.startsWith('--foundry-root=')) {
      opts.foundryRoot = path.resolve(arg.slice('--foundry-root='.length));
    } else if (arg === '--json') {
      opts.json = true;
    } else {
      throw new Error(`Unknown CLI argument: ${arg}`);
    }
  }

  if (opts.mode !== 'A' && opts.mode !== 'B') {
    throw new Error(`Invalid --mode value "${opts.mode}". Expected "A" or "B".`);
  }
  return opts;
}

function runMain() {
  let opts;
  try {
    opts = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    process.stderr.write(`[FOUNDRY-GUARD-ERROR] ${err.message}\n`);
    process.exit(1);
  }

  if (opts.selfTest) {
    try {
      const report = runSelfTest();
      process.stdout.write(JSON.stringify(report) + '\n');
      process.exit(report.exitCode);
    } catch (err) {
      process.stderr.write(`[FOUNDRY-GUARD-SELFTEST-ERROR] ${err.message}\n`);
      process.exit(1);
    }
  }

  if (!opts.verify && !opts.reseal) {
    opts.verify = true;
  }

  if (opts.reseal && opts.mode === 'A') {
    const violation = resealFoundryManifest({
      mode: 'A',
      foundryRoot: opts.foundryRoot,
      skipBench: opts.skipBench,
    });
    process.stderr.write(`${violation.error}\n`);
    process.stdout.write(JSON.stringify(violation) + '\n');
    process.exit(2);
  }

  const results = [];
  let worstExit = 0;

  if (opts.reseal) {
    const resealRes = resealFoundryManifest({
      mode: opts.mode,
      foundryRoot: opts.foundryRoot,
      skipBench: opts.skipBench,
    });
    results.push(resealRes);
    if (!resealRes.ok) {
      process.stderr.write(`[FOUNDRY-GUARD-FAIL] ${resealRes.error}\n`);
      process.stdout.write(JSON.stringify({
        ok: false,
        mode: opts.mode,
        action: opts.verify ? 'reseal+verify' : 'reseal',
        results,
      }) + '\n');
      process.exit(resealRes.exitCode || 1);
    }
  }

  if (opts.verify) {
    const verifyRes = verifyFoundryMode({
      mode: opts.mode,
      foundryRoot: opts.foundryRoot,
    });
    results.push(verifyRes);
    if (!verifyRes.ok) {
      worstExit = Math.max(worstExit, verifyRes.exitCode || 1);
      for (const line of verifyRes.offendingFiles || []) {
        process.stderr.write(`[FOUNDRY-GUARD-FAIL] ${verifyRes.foundryId} : ${line}\n`);
      }
    }
  }

  const summary = {
    ok: worstExit === 0,
    mode: opts.mode,
    action: opts.reseal && opts.verify ? 'reseal+verify' : (opts.reseal ? 'reseal' : 'verify'),
    results,
  };
  process.stdout.write(JSON.stringify(summary) + '\n');
  process.exit(worstExit);
}

const isDirectEntry = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectEntry) {
  runMain();
}

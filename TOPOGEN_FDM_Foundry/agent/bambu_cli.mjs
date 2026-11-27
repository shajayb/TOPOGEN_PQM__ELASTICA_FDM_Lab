/**
 * TOPOGEN_FDM_Foundry — Server-Side Bambu Studio Desktop CLI Bridge & Optimizer (agent/bambu_cli.mjs)
 *
 * STRICT AIR-GAP: Zero imports from verifier/. Zero external npm dependencies.
 * Auto-discovers Bambu Studio Desktop CLI (`bambu-studio.exe`), flattens official
 * BBL P1S profiles, slices rescaled meshes via real `bambu-studio.exe`, parses
 * `result.json` + `plate_1.gcode`, and orchestrates multi-candidate P1S optimization.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  P1S_SPEC,
  rescaleGeometryForP1S,
  buildBinarySTL,
  analyzePrintability,
  parseBambuGcode,
  scorePrintCandidate,
  generateOptimizationCandidates,
} from '../core/print3dp.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FOUNDRY_ROOT = path.resolve(__dirname, '..');

const CACHE_ROOT = path.join(FOUNDRY_ROOT, 'runs', '_3dp_cache');
const PROFILES_CACHE_DIR = path.join(CACHE_ROOT, 'profiles');
const JOBS_CACHE_DIR = path.join(CACHE_ROOT, 'jobs');
const BUNDLED_BAMBU_DIR = path.join(FOUNDRY_ROOT, 'runs', 'p1s_batwing_opt', 'tools', 'bambu');

const DEFAULT_SLICE_TIMEOUT_MS = 180000;
const PROGRESS_TTL_MS = 10 * 60 * 1000;

// In-memory live progress store keyed by jobId (auto-cleaned after 10 min)
const _jobProgressMap = new Map();

function pruneExpiredJobProgress(now = Date.now()) {
  for (const [id, entry] of _jobProgressMap.entries()) {
    if (now - entry.updatedAt > PROGRESS_TTL_MS) {
      _jobProgressMap.delete(id);
    }
  }
}

function resolveJobId(rawJobId, prefix = 'job') {
  if (typeof rawJobId === 'string') {
    const cleaned = rawJobId.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    if (cleaned.length >= 4) return cleaned;
  }
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`;
}

const SAFE_JOB_ID_RE = /^[a-zA-Z0-9_-]{4,80}$/;

function buildDownloadUrls(jobId, { sliced3mfExists = false, gcodeExists = false, stlExists = false } = {}) {
  const enc = encodeURIComponent(jobId);
  return {
    threemf: sliced3mfExists ? `/api/3dp/artifact?jobId=${enc}&kind=3mf` : null,
    gcode: gcodeExists ? `/api/3dp/artifact?jobId=${enc}&kind=gcode` : null,
    stl: stlExists ? `/api/3dp/artifact?jobId=${enc}&kind=stl` : null,
  };
}

/**
 * Safely resolve a downloadable Bambu CLI job artifact (`3mf`, `gcode`, `stl`).
 * Strictly validates `jobId` against `/^[a-zA-Z0-9_-]{4,80}$/` to block path traversal.
 */
export function resolveJobArtifact(jobId, kind) {
  const rawId = typeof jobId === 'string' ? jobId.trim() : '';
  if (!SAFE_JOB_ID_RE.test(rawId)) {
    return { ok: false, status: 400, error: 'INVALID_JOB_ID' };
  }
  const k = typeof kind === 'string' ? kind.trim().toLowerCase() : '';
  const spec = k === '3mf'
    ? { candidates: ['model_p1s.3mf', 'sliced.3mf'], ext: '3mf', contentType: 'model/3mf' }
    : k === 'gcode'
      ? { candidates: ['plate_1.gcode'], ext: 'gcode', contentType: 'text/plain; charset=utf-8' }
      : k === 'stl'
        ? { candidates: ['model_p1s.stl', 'model.stl'], ext: 'stl', contentType: 'model/stl' }
        : null;
  if (!spec) {
    return { ok: false, status: 400, error: 'INVALID_ARTIFACT_KIND' };
  }

  const jobDir = path.resolve(JOBS_CACHE_DIR, rawId);
  const relDir = path.relative(JOBS_CACHE_DIR, jobDir);
  if (!relDir || relDir.startsWith('..') || path.isAbsolute(relDir)) {
    return { ok: false, status: 400, error: 'INVALID_JOB_ID' };
  }

  for (const name of spec.candidates) {
    const filePath = path.resolve(jobDir, name);
    const relFile = path.relative(jobDir, filePath);
    if (!relFile || relFile.startsWith('..') || path.isAbsolute(relFile)) continue;
    try {
      const stat = fs.statSync(filePath);
      if (stat.isFile()) {
        return {
          ok: true,
          status: 200,
          jobId: rawId,
          kind: k,
          filePath,
          filename: `topogen_p1s_${rawId}.${spec.ext}`,
          contentType: spec.contentType,
          bytes: stat.size,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { ok: false, status: 404, error: 'ARTIFACT_NOT_FOUND' };
}

function initJobProgress(jobId, kind, stage = 'Starting...', detail = '') {
  const now = Date.now();
  pruneExpiredJobProgress(now);
  const entry = {
    jobId,
    kind,
    status: 'running',
    percent: 2,
    stage,
    detail,
    startedAt: now,
    updatedAt: now,
    finishedAt: null,
    candidateIndex: 0,
    candidateTotal: 0,
    completedCandidates: [],
    metrics: null,
    error: null,
  };
  _jobProgressMap.set(jobId, entry);
  return entry;
}

function updateJobProgress(jobId, patch = {}) {
  if (!jobId) return;
  const entry = _jobProgressMap.get(jobId);
  if (!entry) return;
  const now = Date.now();
  if (patch.status !== undefined) entry.status = patch.status;
  if (patch.percent !== undefined) entry.percent = clamp(Math.round(Number(patch.percent) || 0), 0, 100);
  if (patch.stage !== undefined) entry.stage = String(patch.stage);
  if (patch.detail !== undefined) entry.detail = String(patch.detail);
  if (patch.candidateIndex !== undefined) entry.candidateIndex = Number(patch.candidateIndex) || 0;
  if (patch.candidateTotal !== undefined) entry.candidateTotal = Number(patch.candidateTotal) || 0;
  if (patch.metrics !== undefined) entry.metrics = patch.metrics;
  if (patch.error !== undefined) entry.error = patch.error;
  if (patch.appendCandidate) {
    entry.completedCandidates.push(patch.appendCandidate);
  }
  entry.updatedAt = now;
  if (entry.status === 'done' || entry.status === 'error') {
    entry.finishedAt = now;
  }
}

/**
 * Retrieve live progress & telemetry snapshot for a running or recently finished 3DP job.
 */
export function getJobProgress(jobId) {
  if (typeof jobId !== 'string' || !jobId.trim()) return null;
  const now = Date.now();
  pruneExpiredJobProgress(now);
  const entry = _jobProgressMap.get(jobId.trim());
  if (!entry) return null;
  return {
    jobId: entry.jobId,
    kind: entry.kind,
    status: entry.status,
    percent: entry.percent,
    stage: entry.stage,
    detail: entry.detail,
    elapsedMs: (entry.finishedAt || now) - entry.startedAt,
    candidateIndex: entry.candidateIndex,
    candidateTotal: entry.candidateTotal,
    completedCandidates: entry.completedCandidates.slice(),
    metrics: entry.metrics,
    error: entry.error,
  };
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

function round3(v) {
  return Math.round(v * 1000) / 1000;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}h ${m}m ${r}s`;
  return `${m}m ${r}s`;
}

function computeOverflowMm(rescaledParams) {
  if (rescaledParams?.overflowMm && typeof rescaledParams.overflowMm === 'object') {
    return {
      x: Number(rescaledParams.overflowMm.x) || 0,
      y: Number(rescaledParams.overflowMm.y) || 0,
      z: Number(rescaledParams.overflowMm.z) || 0,
    };
  }
  const min = rescaledParams?.bboxMm?.min || [0, 0, 0];
  const max = rescaledParams?.bboxMm?.max || [0, 0, 0];
  const tol = 0.05;
  const axisOverflow = (lo, hi, limit) => {
    const v = Math.max(0, hi - limit, -lo);
    return v > tol ? round2(v) : 0;
  };
  return {
    x: axisOverflow(min[0], max[0], P1S_SPEC.bedX),
    y: axisOverflow(min[1], max[1], P1S_SPEC.bedY),
    z: axisOverflow(min[2], max[2], P1S_SPEC.bedZ),
  };
}

function isWithinP1SBed(rescaledParams) {
  if (!rescaledParams) return false;
  const ov = computeOverflowMm(rescaledParams);
  return Boolean(rescaledParams.fitsBed) && ov.x === 0 && ov.y === 0 && ov.z === 0;
}

// ---------------------------------------------------------------------------
// 1. Auto-Discovery of Bambu Studio Desktop CLI & BBL Profiles
// ---------------------------------------------------------------------------

/**
 * Locate `bambu-studio.exe` across env override, bundled Foundry tools,
 * standard Windows install directories, and PATH.
 */
export function discoverBambuStudioExe() {
  const candidates = [];

  if (process.env.BAMBU_STUDIO_EXE && process.env.BAMBU_STUDIO_EXE.trim()) {
    candidates.push(process.env.BAMBU_STUDIO_EXE.trim());
  }

  candidates.push(
    path.join(BUNDLED_BAMBU_DIR, 'bambu-studio.exe'),
    'C:\\Program Files\\Bambu Studio\\bambu-studio.exe',
    'C:\\Program Files (x86)\\Bambu Studio\\bambu-studio.exe'
  );

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Bambu Studio', 'bambu-studio.exe'));
  }

  // Search PATH
  const pathEnv = process.env.PATH || '';
  const pathDelim = process.platform === 'win32' ? ';' : ':';
  const exeNames = process.platform === 'win32'
    ? ['bambu-studio.exe', 'bambu-studio']
    : ['bambu-studio'];
  for (const dir of pathEnv.split(pathDelim)) {
    const trimmed = dir.trim();
    if (!trimmed) continue;
    for (const exeName of exeNames) {
      candidates.push(path.join(trimmed, exeName));
    }
  }

  const seen = new Set();
  for (const cand of candidates) {
    const resolved = path.resolve(cand);
    const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return resolved;
      }
    } catch {
      // ignore inaccessible paths
    }
  }

  return null;
}

function resolveBblProfilesSourceDir(exePath) {
  const roots = [];
  if (exePath) {
    roots.push(path.join(path.dirname(exePath), 'resources', 'profiles', 'BBL'));
  }
  roots.push(path.join(BUNDLED_BAMBU_DIR, 'resources', 'profiles', 'BBL'));

  for (const dir of roots) {
    if (
      fs.existsSync(path.join(dir, 'machine')) &&
      fs.existsSync(path.join(dir, 'process')) &&
      fs.existsSync(path.join(dir, 'filament'))
    ) {
      return dir;
    }
  }
  return null;
}

/**
 * Flatten Bambu Studio JSON profile inheritance chain (`inherits` + `include`)
 * so CLI `--load-settings` and `--load-filaments` work cleanly without GUI state.
 */
function loadProfileFlat(profilesSrcDir, subDir, fileName) {
  const dir = path.join(profilesSrcDir, subDir);
  const visited = new Set();

  function resolve(nameOrFile) {
    const f = nameOrFile.endsWith('.json') ? nameOrFile : `${nameOrFile}.json`;
    let full = path.join(dir, f);
    if (!fs.existsSync(full)) {
      let files = [];
      try {
        files = fs.readdirSync(dir).filter(x => x.endsWith('.json'));
      } catch {
        return {};
      }
      for (const cand of files) {
        try {
          const j = JSON.parse(fs.readFileSync(path.join(dir, cand), 'utf8'));
          if (j.name === nameOrFile) {
            full = path.join(dir, cand);
            break;
          }
        } catch {
          // ignore malformed json
        }
      }
    }
    if (!fs.existsSync(full) || visited.has(full)) return {};
    visited.add(full);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    let base = {};
    if (data.inherits) base = resolve(data.inherits);
    if (Array.isArray(data.include)) {
      for (const inc of data.include) {
        Object.assign(base, resolve(inc));
      }
    }
    const merged = Object.assign({}, base, data);
    delete merged.inherits;
    delete merged.include;
    return merged;
  }

  return resolve(fileName);
}

/**
 * Ensure flattened official Bambu Lab P1S base profiles exist in
 * `TOPOGEN_FDM_Foundry/runs/_3dp_cache/profiles/`.
 */
export function ensureCachedBaseProfiles(exePath = null) {
  const resolvedExe = exePath || discoverBambuStudioExe();
  const srcDir = resolveBblProfilesSourceDir(resolvedExe);
  if (!srcDir) {
    return { ready: false, srcDir: null, machinePath: null, filamentPath: null, process020Path: null, process016Path: null };
  }

  fs.mkdirSync(PROFILES_CACHE_DIR, { recursive: true });

  const machinePath = path.join(PROFILES_CACHE_DIR, 'p1s_04_machine.json');
  const filamentPath = path.join(PROFILES_CACHE_DIR, 'p1s_pla_basic_filament.json');
  const process020Path = path.join(PROFILES_CACHE_DIR, 'p1s_process_020_standard.json');
  const process016Path = path.join(PROFILES_CACHE_DIR, 'p1s_process_016_optimal.json');

  if (!fs.existsSync(machinePath)) {
    const m = loadProfileFlat(srcDir, 'machine', 'Bambu Lab P1S 0.4 nozzle.json');
    fs.writeFileSync(machinePath, JSON.stringify(m, null, 2), 'utf8');
  }
  if (!fs.existsSync(filamentPath)) {
    const f = loadProfileFlat(srcDir, 'filament', 'Bambu PLA Basic @BBL X1C.json');
    fs.writeFileSync(filamentPath, JSON.stringify(f, null, 2), 'utf8');
  }
  if (!fs.existsSync(process020Path)) {
    const p20 = loadProfileFlat(srcDir, 'process', '0.20mm Standard @BBL X1C.json');
    fs.writeFileSync(process020Path, JSON.stringify(p20, null, 2), 'utf8');
  }
  if (!fs.existsSync(process016Path)) {
    const p16 = loadProfileFlat(srcDir, 'process', '0.16mm Optimal @BBL X1C.json');
    fs.writeFileSync(process016Path, JSON.stringify(p16, null, 2), 'utf8');
  }

  const ready = fs.existsSync(machinePath) && fs.existsSync(filamentPath) && fs.existsSync(process020Path);
  return { ready, srcDir, machinePath, filamentPath, process020Path, process016Path };
}

function buildActiveProcessProfile(baseProfiles, slicerOpts, jobDir) {
  const layerHeightMm = clamp(Number(slicerOpts.layerHeightMm) || 0.20, 0.08, 0.32);
  const use016 = layerHeightMm <= 0.17 && fs.existsSync(baseProfiles.process016Path);
  const basePath = use016 ? baseProfiles.process016Path : baseProfiles.process020Path;
  const proc = JSON.parse(fs.readFileSync(basePath, 'utf8'));

  const supportMode = slicerOpts.support || slicerOpts.supportType || 'tree';
  const supportAngle = clamp(Number(slicerOpts.supportAngle) || 30, 10, 75);
  const wallLoops = clamp(parseInt(slicerOpts.wallLoops, 10) || 2, 1, 8);
  const infillVal = Number.isFinite(Number(slicerOpts.infillPct))
    ? clamp(Number(slicerOpts.infillPct), 0, 100)
    : 15;
  const brim = slicerOpts.brim || 'auto';

  proc.layer_height = String(round2(layerHeightMm));
  if (layerHeightMm < 0.16) {
    proc.initial_layer_print_height = '0.16';
  }

  if (supportMode === 'none') {
    proc.enable_support = '0';
  } else if (supportMode === 'normal') {
    proc.enable_support = '1';
    proc.support_type = 'normal(auto)';
    proc.support_threshold_angle = String(Math.round(supportAngle));
    proc.support_on_build_plate_only = '0';
  } else {
    proc.enable_support = '1';
    proc.support_type = 'tree(auto)';
    proc.support_threshold_angle = String(Math.round(supportAngle));
    proc.support_on_build_plate_only = '0';
  }

  proc.wall_loops = String(wallLoops);
  proc.sparse_infill_density = `${Math.round(infillVal)}%`;

  if (brim === 'none') proc.brim_type = 'no_brim';
  else if (brim === 'outer') proc.brim_type = 'outer_only';
  else proc.brim_type = 'auto_brim';

  const processPath = path.join(jobDir, 'p1s_process_active.json');
  fs.writeFileSync(processPath, JSON.stringify(proc, null, 2), 'utf8');

  return {
    processPath,
    profileMeta: {
      printer: 'Bambu Lab P1S 0.4 nozzle',
      process: use016 ? '0.16mm Optimal @BBL X1C' : '0.20mm Standard @BBL X1C',
      filament: 'Bambu PLA Basic @BBL X1C',
      nozzleMm: P1S_SPEC.nozzleMm,
      layerHeightMm: round2(layerHeightMm),
      wallLoops,
      infillPct: Math.round(infillVal),
      supportMode,
      supportThresholdAngleDeg: Math.round(supportAngle),
      brim,
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Public Status Check
// ---------------------------------------------------------------------------

/**
 * Inspect Bambu Studio Desktop CLI availability and flattened P1S profile readiness.
 */
export function getBambuStatus() {
  const exePath = discoverBambuStudioExe();
  let profilesReady = false;
  let profilesDir = PROFILES_CACHE_DIR;

  if (exePath) {
    try {
      const prof = ensureCachedBaseProfiles(exePath);
      profilesReady = prof.ready;
    } catch {
      profilesReady = false;
    }
  }

  return {
    available: Boolean(exePath && profilesReady),
    exePath: exePath || null,
    profilesReady,
    profilesDir,
    printer: P1S_SPEC.name,
    bedMm: [P1S_SPEC.bedX, P1S_SPEC.bedY, P1S_SPEC.bedZ],
    nozzleMm: P1S_SPEC.nozzleMm,
  };
}

// ---------------------------------------------------------------------------
// 3. Async Process Runner
// ---------------------------------------------------------------------------

function runBambuProcess(exePath, args, timeoutMs = DEFAULT_SLICE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(exePath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 64000) stdout = stdout.slice(-32000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 32000) stderr = stderr.slice(-16000);
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        exitCode: -1,
        timedOut,
        elapsedMs: Date.now() - t0,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code ?? -1,
        timedOut,
        elapsedMs: Date.now() - t0,
        stdout,
        stderr,
      });
    });
  });
}

// ---------------------------------------------------------------------------
// 4. Single-Mesh Bambu Studio CLI Slice & Validate
// ---------------------------------------------------------------------------

/**
 * Rescales meshSnapshot via `core/print3dp.mjs`, exports binary STL, invokes
 * real `bambu-studio.exe`, parses `result.json` + `plate_1.gcode`, and returns
 * structured P1S validation metrics and compact per-layer toolpaths.
 */
export async function sliceWithBambuCLI({ meshSnapshot, dimParams = {}, options = {}, jobId: requestedJobId = null } = {}) {
  const trackProgress = options._suppressProgress !== true;
  const jobId = resolveJobId(requestedJobId || options.jobId, 'slice');

  if (!meshSnapshot || !Array.isArray(meshSnapshot.vertices) || meshSnapshot.vertices.length === 0) {
    if (trackProgress) {
      initJobProgress(jobId, 'slice', 'Validation failed');
      updateJobProgress(jobId, { status: 'error', percent: 100, error: 'Missing or empty meshSnapshot.vertices' });
    }
    return {
      ok: false,
      validated: false,
      jobId,
      error: 'Missing or empty meshSnapshot.vertices',
      warnings: [],
    };
  }

  if (trackProgress) {
    initJobProgress(jobId, 'slice', 'Rescaling & bed-fit check', 'Transforming mesh to Bambu Lab P1S mm coordinates');
    updateJobProgress(jobId, { percent: 10 });
  }

  // 1. Rescale geometry via pure-JS engine (never mutates caller inputs)
  const rescaleOpts = {
    fitMode: options.fitMode || 'fit-bed',
    targetZMm: Number.isFinite(Number(options.targetZMm)) ? Number(options.targetZMm) : undefined,
    customScale: Number.isFinite(Number(options.customScale)) ? Number(options.customScale) : undefined,
    marginMm: Number.isFinite(Number(options.marginMm)) ? Number(options.marginMm) : P1S_SPEC.safeMarginMm,
    rotXDeg: Number(options.rotXDeg ?? options.orientationDeg?.x) || 0,
    rotYDeg: Number(options.rotYDeg ?? options.orientationDeg?.y) || 0,
    rotZDeg: Number(options.rotZDeg ?? options.orientationDeg?.z) || 0,
  };

  const rescaled = rescaleGeometryForP1S(meshSnapshot, dimParams, rescaleOpts);
  const { rescaledParams } = rescaled;

  // Strict P1S bed-fit gate BEFORE touching disk or invoking Bambu Studio CLI
  const overflowMm = computeOverflowMm(rescaledParams);
  if (!isWithinP1SBed(rescaledParams)) {
    const errMsg = 'Geometry exceeds Bambu Lab P1S bed (256x256x256 mm). Only geometry that fits inside the bed can be sliced.';
    if (trackProgress) {
      updateJobProgress(jobId, {
        status: 'error',
        percent: 100,
        stage: 'Blocked: Out of P1S bed bounds',
        detail: `Overflow X=${overflowMm.x} mm, Y=${overflowMm.y} mm, Z=${overflowMm.z} mm`,
        error: 'OUT_OF_BED_BOUNDS',
      });
    }
    return {
      ok: false,
      validated: false,
      jobId,
      error: 'OUT_OF_BED_BOUNDS',
      message: errMsg,
      rescaledParams,
      overflowMm,
      gcodeLayers: [],
      warnings: [
        `Geometry exceeds Bambu Lab P1S bed (256x256x256 mm): overflow X=${overflowMm.x} mm, Y=${overflowMm.y} mm, Z=${overflowMm.z} mm.`,
      ],
    };
  }

  const exePath = discoverBambuStudioExe();
  if (!exePath) {
    if (trackProgress) {
      updateJobProgress(jobId, {
        status: 'error',
        percent: 100,
        stage: 'Bambu Studio CLI not found',
        error: 'Bambu Studio CLI (bambu-studio.exe) not found on this machine.',
      });
    }
    return {
      ok: false,
      validated: false,
      jobId,
      error: 'Bambu Studio CLI (bambu-studio.exe) not found on this machine.',
      warnings: ['Install Bambu Studio Desktop or set BAMBU_STUDIO_EXE environment variable.'],
    };
  }

  const baseProfiles = ensureCachedBaseProfiles(exePath);
  if (!baseProfiles.ready) {
    if (trackProgress) {
      updateJobProgress(jobId, {
        status: 'error',
        percent: 100,
        stage: 'BBL P1S profiles unavailable',
        error: 'Official BBL P1S profiles could not be located or flattened.',
      });
    }
    return {
      ok: false,
      validated: false,
      jobId,
      error: 'Official BBL P1S profiles could not be located or flattened.',
      warnings: [],
    };
  }

  const supportMode = options.support || options.supportType || 'tree';
  const supportAngle = Number.isFinite(Number(options.supportAngle)) ? Number(options.supportAngle) : 30;
  const layerHeightMm = Number.isFinite(Number(options.layerHeightMm)) ? Number(options.layerHeightMm) : 0.20;
  const wallLoops = Number.isFinite(Number(options.wallLoops)) ? Number(options.wallLoops) : 2;
  const infillPct = Number.isFinite(Number(options.infillPct)) ? Number(options.infillPct) : 15;
  const brim = options.brim || 'auto';

  // Analytical geometry diagnostics (overhang area %, bed contact mm^2, etc.)
  const analysis = analyzePrintability(rescaled, {
    overhangAngleDeg: clamp(90 - supportAngle, 15, 75),
    criticalAngleDeg: 60,
    layerHeightMm,
    wallLoops,
    wallThicknessMm: rescaledParams.wallThicknessMm,
    brim,
    supportType: supportMode,
  });

  // 2. Prepare temp job directory & write binary STL
  if (trackProgress) {
    updateJobProgress(jobId, {
      percent: 25,
      stage: 'Writing STL & flattening P1S profiles',
      detail: `${rescaled.triangles.length} tris · ${rescaledParams.bboxMm.size.map(v => v.toFixed(1)).join('×')} mm`,
    });
  }
  const jobDir = path.join(JOBS_CACHE_DIR, jobId);
  fs.mkdirSync(jobDir, { recursive: true });

  const stlPath = path.join(jobDir, 'model_p1s.stl');
  const sliced3mfName = 'model_p1s.3mf';
  const sliced3mfPath = path.join(jobDir, sliced3mfName);
  const gcodePath = path.join(jobDir, 'plate_1.gcode');
  const resultJsonPath = path.join(jobDir, 'result.json');

  const stlBytes = buildBinarySTL(rescaled, `TOPOGEN P1S ${jobId}`);
  fs.writeFileSync(stlPath, stlBytes);

  const { processPath, profileMeta } = buildActiveProcessProfile(
    baseProfiles,
    { support: supportMode, supportAngle, layerHeightMm, wallLoops, infillPct, brim },
    jobDir
  );

  // 3. Invoke real Bambu Studio CLI
  if (trackProgress) {
    updateJobProgress(jobId, {
      percent: 45,
      stage: 'Running Bambu Studio CLI (bambu-studio.exe)',
      detail: `P1S 0.4mm · ${round2(layerHeightMm)}mm · ${supportMode} (${Math.round(supportAngle)}°) · ${wallLoops}W`,
    });
  }
  const cliArgs = [
    '--load-settings', `${baseProfiles.machinePath};${processPath}`,
    '--load-filaments', baseProfiles.filamentPath,
    '--arrange', '1',
    '--slice', '0',
    '--export-3mf', sliced3mfName,
    '--outputdir', jobDir,
    stlPath,
  ];

  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? clamp(Number(options.timeoutMs), 10000, 300000)
    : DEFAULT_SLICE_TIMEOUT_MS;

  const proc = await runBambuProcess(exePath, cliArgs, timeoutMs);

  if (trackProgress) {
    updateJobProgress(jobId, {
      percent: 80,
      stage: 'Parsing plate_1.gcode & result.json',
      detail: `Bambu CLI finished in ${(proc.elapsedMs / 1000).toFixed(1)}s`,
    });
  }

  let resultJson = null;
  if (fs.existsSync(resultJsonPath)) {
    try {
      resultJson = JSON.parse(fs.readFileSync(resultJsonPath, 'utf8'));
    } catch {
      resultJson = null;
    }
  }

  const gcodeExists = fs.existsSync(gcodePath);
  const validated = proc.exitCode === 0 && resultJson?.return_code === 0 && gcodeExists;

  // 4. Parse plate_1.gcode with full-layer island coverage (feature-prioritized in core/print3dp.mjs)
  let parsedGcode = null;
  if (gcodeExists && options.skipGcodeLayers !== true) {
    const gcodeText = fs.readFileSync(gcodePath, 'utf8');
    const estLayers = Math.max(1, Math.ceil((rescaledParams.bboxMm.size[2] || 100) / layerHeightMm));
    const maxSegsPerLayer = Number.isFinite(Number(options.maxSegmentsPerLayer))
      ? clamp(Number(options.maxSegmentsPerLayer), 200, 4000)
      : clamp(Math.floor(450000 / estLayers), 600, 2500);

    parsedGcode = parseBambuGcode(gcodeText, {
      includeTravel: Boolean(options.includeTravel),
      quantizeMm: 0.1,
      minSegmentLengthMm: 0.25,
      maxSegmentsPerLayer: maxSegsPerLayer,
      arcStepMm: 1.2,
    });
  } else if (gcodeExists && options.skipGcodeLayers === true) {
    // Parse summary only (minimal segments)
    const gcodeText = fs.readFileSync(gcodePath, 'utf8');
    parsedGcode = parseBambuGcode(gcodeText, {
      includeTravel: false,
      quantizeMm: 0.2,
      minSegmentLengthMm: 2.0,
      maxSegmentsPerLayer: 1,
    });
  }

  // 5. Merge Bambu result.json + plate_1.gcode + analytical metrics
  const plate = resultJson?.sliced_plates?.[0] || null;
  const gSummary = parsedGcode?.summary || null;

  const totalPredSec = plate?.total_predication ?? ((gSummary?.estimatedTimeMin ?? 0) * 60);
  const mainPredSec = plate?.main_predication ?? ((gSummary?.modelTimeMin ?? 0) * 60);
  const printTimeMin = round2(totalPredSec / 60);
  const modelPrintTimeMin = round2(mainPredSec / 60);

  const totalFilamentG = round3(
    plate?.filaments?.[0]?.total_used_g ?? gSummary?.totalFilamentG ?? 0
  );
  const supportFilamentG = round3(gSummary?.supportFilamentG ?? 0);
  const supportPct = totalFilamentG > 0 ? round2((supportFilamentG / totalFilamentG) * 100) : 0;
  const modelFilamentG = round3(Math.max(0, totalFilamentG - supportFilamentG));
  const layerCount = gSummary?.layerCount ?? 0;

  const warnings = [];
  if (proc.timedOut) {
    warnings.push(`Bambu Studio CLI timed out after ${timeoutMs}ms.`);
  }
  if (plate?.warning_message && plate.warning_message.trim()) {
    warnings.push(plate.warning_message.trim());
  }
  if (resultJson?.error_string && resultJson.error_string !== 'Success.') {
    warnings.push(`Slicer: ${resultJson.error_string}`);
  }
  if (rescaledParams.thinWallWarning) {
    warnings.push(`Thin wall warning: ${rescaledParams.wallThicknessMm} mm < ${P1S_SPEC.minWallMm} mm P1S minimum.`);
  }
  if (analysis.criticalOverhangPct > 5) {
    warnings.push(`Steep overhangs (>60°): ${analysis.criticalOverhangPct}% of surface area.`);
  }
  if (gSummary && gSummary.overhangWallG > 0.5) {
    warnings.push(`Overhang wall extrusion: ${gSummary.overhangWallG} g.`);
  }
  if (gSummary && gSummary.bridgeG > 0.5) {
    warnings.push(`Bridge extrusion: ${gSummary.bridgeG} g.`);
  }

  const scoreDetail = scorePrintCandidate({
    fitsBed: rescaledParams.fitsBed,
    supportPct,
    overhangAreaPct: analysis.overhangAreaPct,
    criticalOverhangPct: analysis.criticalOverhangPct,
    bedContactAreaMm2: analysis.bedContactAreaMm2,
    footprintAreaMm2: Math.max(1, rescaledParams.bboxMm.size[0] * rescaledParams.bboxMm.size[1]),
    printTimeMin: printTimeMin > 0 ? printTimeMin : analysis.estimatedPrintTimeMin,
    thinWallWarning: rescaledParams.thinWallWarning,
    wallLoops,
    brim,
    supportType: supportMode,
  });

  const metrics = {
    validated,
    slicerReturnCode: resultJson?.return_code ?? null,
    slicerError: resultJson?.error_string ?? null,
    slicerElapsedMs: proc.elapsedMs,
    printTimeMin,
    modelPrintTimeMin,
    printTimeFormatted: gSummary?.estimatedTimeStr || formatDuration(totalPredSec),
    modelPrintTimeFormatted: gSummary?.modelTimeStr || formatDuration(mainPredSec),
    totalFilamentG,
    modelFilamentG,
    supportFilamentG,
    supportPct,
    layerCount,
    overhangAreaPct: analysis.overhangAreaPct,
    criticalOverhangPct: analysis.criticalOverhangPct,
    bedContactAreaMm2: analysis.bedContactAreaMm2,
    volumeCm3: analysis.volumeCm3,
    overhangWallG: gSummary?.overhangWallG ?? 0,
    bridgeG: gSummary?.bridgeG ?? 0,
    featureFilamentG: gSummary?.featureFilamentG ?? {},
    featureTimeSec: plate?.feature_type_times ?? {},
    fitsBed: rescaledParams.fitsBed,
    thinWallWarning: rescaledParams.thinWallWarning,
    printabilityScore: scoreDetail.score,
    grade: scoreDetail.grade,
    scoreDetail,
  };

  const combinedOut = `${proc.stdout}\n${proc.stderr}`.trim();
  const stdoutTail = combinedOut.split(/\r?\n/).slice(-25).join('\n');
  const errorStr = validated ? null : (resultJson?.error_string || (proc.timedOut ? 'Bambu CLI timeout' : `Bambu CLI exited with code ${proc.exitCode}`));

  if (trackProgress) {
    updateJobProgress(jobId, {
      status: validated ? 'done' : 'error',
      percent: 100,
      stage: validated ? 'Complete' : 'Bambu CLI slice failed',
      detail: validated
        ? `${layerCount} layers · ${metrics.printTimeFormatted} · ${totalFilamentG}g (${supportPct}% sup) · Score ${scoreDetail.score}`
        : (errorStr || 'Slicer error'),
      metrics: {
        layers: layerCount,
        printTimeMin,
        printTimeFormatted: metrics.printTimeFormatted,
        totalFilamentG,
        supportFilamentG,
        supportPct,
        score: scoreDetail.score,
        grade: scoreDetail.grade,
        slicerElapsedMs: proc.elapsedMs,
      },
      error: errorStr,
    });
  }

  const sliced3mfExists = fs.existsSync(sliced3mfPath);
  const downloadUrls = buildDownloadUrls(jobId, {
    sliced3mfExists,
    gcodeExists,
    stlExists: fs.existsSync(stlPath),
  });

  return {
    ok: validated,
    validated,
    jobId,
    profile: profileMeta,
    metrics,
    rescaledParams,
    gcodeLayers: options.skipGcodeLayers === true ? null : (parsedGcode?.layers || []),
    gcodeSummary: gSummary,
    artifacts: {
      stlPath,
      gcodePath: gcodeExists ? gcodePath : null,
      resultJsonPath: fs.existsSync(resultJsonPath) ? resultJsonPath : null,
      sliced3mfPath: sliced3mfExists ? sliced3mfPath : null,
    },
    downloadUrls,
    stdoutTail,
    warnings,
    error: errorStr,
  };
}

// ---------------------------------------------------------------------------
// 5. Multi-Candidate Bambu CLI Printability Optimizer
// ---------------------------------------------------------------------------

/**
 * Generates analytical orientation & support/slicer candidates via `core/print3dp.mjs`,
 * ranks them analytically, then validates the top N (default 3-4, always including
 * baseline + best diverse candidates) through real `bambu-studio.exe` CLI.
 */
export async function optimizeWithBambuCLI({ meshSnapshot, dimParams = {}, options = {}, jobId: requestedJobId = null } = {}) {
  const jobId = resolveJobId(requestedJobId || options.jobId, 'opt');

  if (!meshSnapshot || !Array.isArray(meshSnapshot.vertices) || meshSnapshot.vertices.length === 0) {
    initJobProgress(jobId, 'optimize', 'Validation failed');
    updateJobProgress(jobId, { status: 'error', percent: 100, error: 'Missing or empty meshSnapshot.vertices' });
    return {
      ok: false,
      jobId,
      error: 'Missing or empty meshSnapshot.vertices',
    };
  }

  initJobProgress(jobId, 'optimize', 'Generating & ranking orientation/support candidates', 'Evaluating P1S orientations & slicer recipes');
  updateJobProgress(jobId, { percent: 8 });

  const maxValidate = clamp(parseInt(options.maxValidate, 10) || 4, 1, 8);
  const plan = generateOptimizationCandidates(meshSnapshot, dimParams, options);
  const status = getBambuStatus();

  // Strict P1S bed-fit filter: only candidates that fit inside 256x256x256 mm may be sliced or win
  const fittingCandidates = (plan.candidates || []).filter(
    (c) => isWithinP1SBed(c?.rescaledParams) && c?.analysis?.fitsBed !== false
  );
  const excludedOutOfBedCount = (plan.candidates || []).length - fittingCandidates.length;

  if (fittingCandidates.length === 0) {
    const baseRescaled = plan.baseline?.rescaledParams || null;
    const overflowMm = computeOverflowMm(baseRescaled);
    updateJobProgress(jobId, {
      status: 'error',
      percent: 100,
      stage: 'Blocked: Out of P1S bed bounds',
      detail: `Overflow X=${overflowMm.x} mm, Y=${overflowMm.y} mm, Z=${overflowMm.z} mm`,
      error: 'OUT_OF_BED_BOUNDS',
    });
    return {
      ok: false,
      validated: false,
      jobId,
      error: 'OUT_OF_BED_BOUNDS',
      message: 'No optimization candidate fits inside the Bambu Lab P1S bed (256x256x256 mm). Only geometry that fits inside the bed can be sliced.',
      rescaledParams: baseRescaled,
      overflowMm,
      bambuAvailable: status.available,
      validatedCount: 0,
      totalCandidates: 0,
      excludedOutOfBedCount,
      baseline: null,
      best: null,
      candidates: [],
      bestGcodeLayers: [],
    };
  }

  // Select diverse top bed-fitting candidates to validate with real Bambu Studio CLI:
  // Always include baseline (when it fits the bed) + #1 analytical winner + diverse runners-up.
  const toValidate = [];
  const pickedIds = new Set();

  const fittingBaseline = fittingCandidates.find(c => c.isBaseline) || null;
  if (fittingBaseline) {
    toValidate.push(fittingBaseline);
    pickedIds.add(fittingBaseline.id);
  }

  const seenOrientSupport = new Set();
  if (fittingBaseline) {
    const r = fittingBaseline.orientationDeg;
    seenOrientSupport.add(`${r.x},${r.y},${r.z}|${fittingBaseline.slicerOpts.support}`);
  }

  // First pass: pick highest-ranked bed-fitting candidates with distinct (orientation, support)
  for (const cand of fittingCandidates) {
    if (toValidate.length >= maxValidate) break;
    if (pickedIds.has(cand.id)) continue;
    const r = cand.orientationDeg;
    const key = `${r.x},${r.y},${r.z}|${cand.slicerOpts.support}`;
    if (!seenOrientSupport.has(key)) {
      seenOrientSupport.add(key);
      pickedIds.add(cand.id);
      toValidate.push(cand);
    }
  }

  // Second pass: fill remaining slots by pure analytical rank
  for (const cand of fittingCandidates) {
    if (toValidate.length >= maxValidate) break;
    if (pickedIds.has(cand.id)) continue;
    pickedIds.add(cand.id);
    toValidate.push(cand);
  }

  const totalToValidate = status.available ? toValidate.length : 0;
  updateJobProgress(jobId, {
    percent: 12,
    stage: `Ranked ${fittingCandidates.length} bed-fitting candidates`,
    detail: status.available
      ? `Validating top ${totalToValidate} candidates via Bambu Studio CLI`
      : 'Bambu CLI offline — returning analytical ranking',
    candidateIndex: 0,
    candidateTotal: totalToValidate,
  });

  const validatedMap = new Map();
  let validatedCount = 0;

  if (status.available) {
    for (let idx = 0; idx < toValidate.length; idx++) {
      const cand = toValidate[idx];
      const k = idx + 1;
      const pctMid = 15 + Math.round(((k - 0.5) / Math.max(1, totalToValidate)) * 75);
      updateJobProgress(jobId, {
        percent: pctMid,
        stage: `CLI Validating ${k}/${totalToValidate}: ${cand.label}`,
        detail: `Rot (${cand.orientationDeg.x}°,${cand.orientationDeg.y}°,${cand.orientationDeg.z}°) · ${cand.slicerOpts.support} ${cand.slicerOpts.supportAngle}° · ${cand.slicerOpts.layerHeightMm}mm`,
        candidateIndex: k,
        candidateTotal: totalToValidate,
      });

      const sliceRes = await sliceWithBambuCLI({
        meshSnapshot,
        dimParams,
        options: {
          fitMode: options.fitMode || 'fit-bed',
          targetZMm: options.targetZMm,
          customScale: options.customScale,
          marginMm: options.marginMm,
          rotXDeg: cand.orientationDeg.x,
          rotYDeg: cand.orientationDeg.y,
          rotZDeg: cand.orientationDeg.z,
          support: cand.slicerOpts.support,
          supportAngle: cand.slicerOpts.supportAngle,
          layerHeightMm: cand.slicerOpts.layerHeightMm,
          wallLoops: cand.slicerOpts.wallLoops,
          infillPct: cand.slicerOpts.infillPct,
          brim: cand.slicerOpts.brim,
          skipGcodeLayers: true, // Keep memory low during sweep; load full layers for winner
          timeoutMs: options.timeoutMs,
          _suppressProgress: true,
        },
      });
      validatedMap.set(cand.id, sliceRes);
      if (sliceRes.validated) validatedCount++;

      const pctDone = 15 + Math.round((k / Math.max(1, totalToValidate)) * 75);
      updateJobProgress(jobId, {
        percent: pctDone,
        stage: `Validated ${k}/${totalToValidate}: ${cand.label}`,
        detail: sliceRes.validated
          ? `Score ${sliceRes.metrics.printabilityScore} (${sliceRes.metrics.grade}) · ${sliceRes.metrics.printTimeFormatted} · ${sliceRes.metrics.supportPct}% sup`
          : `CLI warning: ${sliceRes.error || 'unvalidated'}`,
        candidateIndex: k,
        candidateTotal: totalToValidate,
        appendCandidate: {
          id: cand.id,
          label: cand.label,
          isBaseline: cand.isBaseline,
          validated: Boolean(sliceRes.validated),
          orientationDeg: cand.orientationDeg,
          support: cand.slicerOpts.support,
          supportAngle: cand.slicerOpts.supportAngle,
          layerHeightMm: cand.slicerOpts.layerHeightMm,
          wallLoops: cand.slicerOpts.wallLoops,
          brim: cand.slicerOpts.brim,
          supportPct: sliceRes.validated ? sliceRes.metrics.supportPct : cand.analysis.estimatedSupportRatioPct,
          printTimeMin: sliceRes.validated ? sliceRes.metrics.printTimeMin : cand.analysis.estimatedPrintTimeMin,
          printTimeFormatted: sliceRes.validated ? sliceRes.metrics.printTimeFormatted : null,
          totalFilamentG: sliceRes.validated ? sliceRes.metrics.totalFilamentG : null,
          score: sliceRes.validated ? sliceRes.metrics.printabilityScore : cand.score,
          grade: sliceRes.validated ? sliceRes.metrics.grade : cand.grade,
        },
      });
    }
  }

  // Merge validated Bambu metrics into bed-fitting candidate records
  const mergedCandidates = fittingCandidates.map((cand) => {
    const vRes = validatedMap.get(cand.id);
    if (vRes && vRes.validated) {
      return {
        id: cand.id,
        label: cand.label,
        isBaseline: cand.isBaseline,
        validated: true,
        jobId: vRes.jobId,
        orientationDeg: cand.orientationDeg,
        slicerOpts: cand.slicerOpts,
        rescaledParams: vRes.rescaledParams,
        analyticalScore: cand.score,
        score: vRes.metrics.printabilityScore,
        grade: vRes.metrics.grade,
        scoreDetail: vRes.metrics.scoreDetail,
        metrics: vRes.metrics,
        artifacts: vRes.artifacts,
        downloadUrls: vRes.downloadUrls,
        warnings: vRes.warnings,
      };
    }
    return {
      id: cand.id,
      label: cand.label,
      isBaseline: cand.isBaseline,
      validated: false,
      orientationDeg: cand.orientationDeg,
      slicerOpts: cand.slicerOpts,
      rescaledParams: cand.rescaledParams,
      analyticalScore: cand.score,
      score: cand.score,
      grade: cand.grade,
      scoreDetail: cand.scoreDetail,
      metrics: {
        validated: false,
        printTimeMin: cand.analysis.estimatedPrintTimeMin,
        supportPct: cand.analysis.estimatedSupportRatioPct,
        overhangAreaPct: cand.analysis.overhangAreaPct,
        criticalOverhangPct: cand.analysis.criticalOverhangPct,
        bedContactAreaMm2: cand.analysis.bedContactAreaMm2,
        fitsBed: cand.analysis.fitsBed,
        thinWallWarning: cand.analysis.thinWallWarning,
        printabilityScore: cand.score,
        grade: cand.grade,
      },
      artifacts: null,
      warnings: vRes && vRes.error ? [vRes.error] : [],
    };
  });

  // Sort: validated candidates first by real Bambu score, then analytical-only by analytical score
  mergedCandidates.sort((a, b) => {
    if (a.validated !== b.validated) return a.validated ? -1 : 1;
    return b.score - a.score;
  });

  const baseline = mergedCandidates.find(c => c.isBaseline) || mergedCandidates[0];
  const best = mergedCandidates[0];

  // Parse full compact gcodeLayers for the winning candidate from its already-generated plate_1.gcode
  updateJobProgress(jobId, {
    percent: 95,
    stage: 'Packing best G-code layers',
    detail: `Winner: ${best?.label || 'N/A'} (Score ${best?.score ?? 0})`,
  });

  let bestGcodeLayers = null;
  let bestGcodeSummary = null;
  if (best?.validated && best.artifacts?.gcodePath && fs.existsSync(best.artifacts.gcodePath)) {
    const gcodeText = fs.readFileSync(best.artifacts.gcodePath, 'utf8');
    const lh = best.slicerOpts.layerHeightMm || 0.20;
    const estLayers = Math.max(1, Math.ceil((best.rescaledParams?.bboxMm?.size?.[2] || 100) / lh));
    const maxSegsPerLayer = clamp(Math.floor(450000 / estLayers), 600, 2500);
    const parsedBest = parseBambuGcode(gcodeText, {
      includeTravel: Boolean(options.includeTravel),
      quantizeMm: 0.1,
      minSegmentLengthMm: 0.25,
      maxSegmentsPerLayer: maxSegsPerLayer,
      arcStepMm: 1.2,
    });
    bestGcodeLayers = parsedBest.layers;
    bestGcodeSummary = parsedBest.summary;
  }

  const improvement = {
    scoreDelta: round1((best?.score ?? 0) - (baseline?.score ?? 0)),
    supportPctDelta: round2((best?.metrics?.supportPct ?? 0) - (baseline?.metrics?.supportPct ?? 0)),
    printTimeMinDelta: round2((best?.metrics?.printTimeMin ?? 0) - (baseline?.metrics?.printTimeMin ?? 0)),
    filamentGDelta: (Number.isFinite(best?.metrics?.totalFilamentG) && Number.isFinite(baseline?.metrics?.totalFilamentG))
      ? round3(best.metrics.totalFilamentG - baseline.metrics.totalFilamentG)
      : null,
  };

  updateJobProgress(jobId, {
    status: 'done',
    percent: 100,
    stage: 'Complete',
    detail: `Best: ${best?.label || 'N/A'} · Score ${best?.score ?? 0} (${improvement.scoreDelta >= 0 ? '+' : ''}${improvement.scoreDelta})`,
    metrics: {
      bestLabel: best?.label || null,
      bestScore: best?.score ?? null,
      bestGrade: best?.grade || null,
      layers: bestGcodeSummary?.layerCount ?? best?.metrics?.layerCount ?? 0,
      printTimeFormatted: best?.metrics?.printTimeFormatted || null,
      totalFilamentG: best?.metrics?.totalFilamentG ?? null,
      supportPct: best?.metrics?.supportPct ?? null,
      validatedCount,
      improvement,
    },
  });

  return {
    ok: true,
    jobId,
    bestJobId: best?.jobId || null,
    downloadUrls: best?.downloadUrls || { threemf: null, gcode: null, stl: null },
    bambuAvailable: status.available,
    validatedCount,
    totalCandidates: mergedCandidates.length,
    excludedOutOfBedCount,
    baseline,
    best,
    improvement,
    candidates: mergedCandidates,
    bestGcodeLayers,
    bestGcodeSummary,
    bestRescaledParams: best?.rescaledParams || null,
  };
}

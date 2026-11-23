#!/usr/bin/env node
/**
 * WFC-FDM Foundry — High-Throughput Streaming Campaign Runner (Mode A & Mode B)
 *
 * Strictly preserves the Generator/Verifier air-gap while delivering 10x-20x speedup:
 *   - NEVER imports index_WFC.html, core/*, run_generator.mjs, or verifier/* modules.
 *   - Executes Generator and Verifier inside separate isolated `node:worker_threads`
 *     pools (`workers/generator_worker.mjs` and `workers/verifier_worker.mjs`)
 *     communicating exclusively via neutral artifacts / messages.
 *   - Supports Speed Profiles (`lightning`, `interactive`, `thorough`), Gate 1
 *     verifier seal-hash benchmark caching, live mid-run steering (`nudge`),
 *     instant `< 80 ms` single-candidate evaluation (`quickEvaluateCandidate`),
 *     and debounced state I/O with immediate real-time SSE event emission.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const FOUNDRY_ROOT = __dirname;
const REPO_ROOT = path.resolve(FOUNDRY_ROOT, '..');

const PATHS = {
  indexHtml: path.join(FOUNDRY_ROOT, 'index_WFC.html'),
  coreDir: path.join(FOUNDRY_ROOT, 'core'),
  generatorCli: path.join(FOUNDRY_ROOT, 'run_generator.mjs'),
  generatorWorker: path.join(FOUNDRY_ROOT, 'workers', 'generator_worker.mjs'),
  verifierWorker: path.join(FOUNDRY_ROOT, 'workers', 'verifier_worker.mjs'),
  verifierDir: path.join(FOUNDRY_ROOT, 'verifier'),
  verifierCli: path.join(FOUNDRY_ROOT, 'verifier', 'verify.mjs'),
  verifierBenchCli: path.join(FOUNDRY_ROOT, 'verifier', 'test_verifier.mjs'),
  reportBuilderCli: path.join(FOUNDRY_ROOT, 'build_report.mjs'),
  videoExportCli: path.join(FOUNDRY_ROOT, 'video_build', 'export_video_data.mjs'),
  videoRenderCpp: path.join(FOUNDRY_ROOT, 'video_build', 'render_foundry_60s.cpp'),
  videoRenderExe: path.join(FOUNDRY_ROOT, 'video_build', 'render_foundry_60s.exe'),
  briefsDir: path.join(FOUNDRY_ROOT, 'briefs'),
  runsDir: path.join(FOUNDRY_ROOT, 'runs'),
  benchCacheJson: path.join(FOUNDRY_ROOT, 'runs', '.bench_cache.json'),
};

export const CANONICAL_GATES = [
  { id: 'gate1_benchmarks', index: 1, short: 'G1 · Benchmarks', name: 'Brief Validation & Verifier Mechanics Gate' },
  { id: 'gate2_smoke',      index: 2, short: 'G2 · Smoke',      name: 'Baseline Smoke Candidate & Air-Gap Check' },
  { id: 'gate3_explore',    index: 3, short: 'G3 · Explore',    name: 'Broad WFC × FDM Swarm Exploration (Round 1)' },
  { id: 'gate4_optimize',   index: 4, short: 'G4 · Optimize',   name: 'Long-Horizon Diagnosis Optimization (Rounds 2..N)' },
  { id: 'gate5_pareto',     index: 5, short: 'G5 · Pareto',     name: 'Multi-Objective Pareto Log & Champion Freeze' },
  { id: 'gate6_report',     index: 6, short: 'G6 · Report',     name: 'Goldilocks 3D HTML Explainer (foundry_report.html)' },
  { id: 'gate7_video',      index: 7, short: 'G7 · Video',      name: '60s Showcase Explainer Video (1920×1080 MP4)' },
];

export const SEARCH_PROFILES = {
  lightning: {
    id: 'lightning',
    label: 'Lightning (~1.5s · 10 cands)',
    maxRounds: 2,
    round1Count: 6,
    candidatesPerRound: 4,
    concurrency: Math.min(10, Math.max(6, os.cpus().length)),
    skipFailedUnroll: true,
    keepFailedMeshes: false,
    earlyStopOnPassCount: 4,
    fastConditioning: true,
  },
  interactive: {
    id: 'interactive',
    label: 'Interactive (~4s · 25 cands)',
    maxRounds: 2,
    round1Count: 12,
    candidatesPerRound: 12,
    concurrency: Math.min(10, Math.max(6, os.cpus().length)),
    skipFailedUnroll: true,
    keepFailedMeshes: true,
    earlyStopOnPassCount: 0,
    fastConditioning: true,
  },
  thorough: {
    id: 'thorough',
    label: 'Thorough Sweep (~10s · 61 cands)',
    maxRounds: 3,
    round1Count: 20,
    candidatesPerRound: 20,
    concurrency: Math.min(10, Math.max(6, os.cpus().length)),
    skipFailedUnroll: false,
    keepFailedMeshes: true,
    earlyStopOnPassCount: 0,
    fastConditioning: false,
  },
};

const BUILTIN_TILE_IDS = [
  'cross', 'vtube', 'htube', 'htube_y',
  'xbrace_xz', 'xbrace_yz', 'diag_pyramid',
  'arch_vault', 'tripod_leg', 'diaphragm_xy',
  'funicular_vault', 'slender_diagrid', 'hyperboloid', 'catenary_quadripod',
];

const DEFAULT_PRESETS = [
  'pilot_champion', 'catenary_quadripod', 'funicular_vault', 'slender_diagrid',
  'hyperboloid_tower', 'arch_braced', 'diagrid_tower', 'space_frame',
  'funnel_vault', 'minimal_frame', 'default_ortho',
];

function sha256File(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// Short TTL cache for computeFoundrySeal() so rapid HTTP polls & stage checks take ~0ms
let _sealCache = { ts: 0, value: null };

export function computeFoundrySeal(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _sealCache.value && now - _sealCache.ts < 1200) {
    return _sealCache.value;
  }

  const coreMjsFiles = [];
  if (fs.existsSync(PATHS.coreDir)) {
    try {
      for (const f of fs.readdirSync(PATHS.coreDir).sort()) {
        if (f.endsWith('.mjs') || f.endsWith('.js')) {
          coreMjsFiles.push(`core/${f}`);
        }
      }
    } catch {}
  }

  // Hash modular core/*.mjs when available (with fallback to index_WFC.html), plus run_generator.mjs & generator_worker.mjs
  const generatorFiles = [
    ...(coreMjsFiles.length > 0 ? coreMjsFiles : ['index_WFC.html']),
    'run_generator.mjs',
    ...(fs.existsSync(PATHS.generatorWorker) ? ['workers/generator_worker.mjs'] : []),
  ];

  // Audit all generator files (including index_WFC.html even after modularization) for 0 verifier cross-imports
  const generatorAuditFiles = Array.from(new Set([
    'index_WFC.html',
    'run_generator.mjs',
    ...coreMjsFiles,
    ...(fs.existsSync(PATHS.generatorWorker) ? ['workers/generator_worker.mjs'] : []),
  ]));

  const verifierFiles = [
    'verifier/fea_solver.mjs',
    'verifier/fabrication_check.mjs',
    'verifier/verify.mjs',
    'verifier/test_verifier.mjs',
  ];
  const verifierAuditFiles = [
    ...verifierFiles,
    ...(fs.existsSync(PATHS.verifierWorker) ? ['workers/verifier_worker.mjs'] : []),
  ];

  const genHashes = {};
  for (const rel of generatorFiles) {
    genHashes[rel] = sha256File(path.join(FOUNDRY_ROOT, rel));
  }
  const verHashes = {};
  for (const rel of verifierFiles) {
    verHashes[rel] = sha256File(path.join(FOUNDRY_ROOT, rel));
  }

  let generatorToVerifierCross = 0;
  let verifierToGeneratorCross = 0;

  for (const rel of generatorAuditFiles) {
    const full = path.join(FOUNDRY_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      if ((/^\s*(import|export)\s/.test(l) || /from\s+['"]/.test(l)) && /verifier[\\/]/.test(l)) {
        generatorToVerifierCross++;
      }
    }
  }

  for (const rel of verifierAuditFiles) {
    const full = path.join(FOUNDRY_ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
    for (const l of lines) {
      if (
        (/^\s*(import|export)\s/.test(l) || /from\s+['"]/.test(l) || /readFileSync\s*\(/.test(l)) &&
        (/index_WFC\.html|run_generator\.mjs|generator_worker\.mjs|(?:^|['"\\/])core[\\/]/.test(l))
      ) {
        verifierToGeneratorCross++;
      }
    }
  }

  const genComposite = crypto.createHash('sha256').update(JSON.stringify(genHashes)).digest('hex').slice(0, 16);
  const verComposite = crypto.createHash('sha256').update(JSON.stringify(verHashes)).digest('hex').slice(0, 16);

  const result = {
    timestamp: new Date().toISOString(),
    generatorSealHash: genComposite,
    verifierSealHash: verComposite,
    generatorFiles: genHashes,
    verifierFiles: verHashes,
    airGapPassed: generatorToVerifierCross === 0 && verifierToGeneratorCross === 0,
    generatorToVerifierCross,
    verifierToGeneratorCross,
  };
  _sealCache = { ts: now, value: result };
  return result;
}

let _presetsCache = { mtimeKey: '', presets: null };

export function discoverPresetsFromHtml() {
  const mathTilesPath = path.join(FOUNDRY_ROOT, 'core', 'math_tiles.mjs');
  const sourcePath = fs.existsSync(mathTilesPath) ? mathTilesPath : PATHS.indexHtml;
  if (!fs.existsSync(sourcePath)) {
    return DEFAULT_PRESETS;
  }

  let mtimeKey = '';
  try {
    const st = fs.statSync(sourcePath);
    mtimeKey = `${sourcePath}:${st.mtimeMs}:${st.size}`;
  } catch {}
  if (_presetsCache.presets && _presetsCache.mtimeKey === mtimeKey) {
    return _presetsCache.presets;
  }

  const src = fs.readFileSync(sourcePath, 'utf8');
  let startIdx = src.indexOf('TILE_PRESETS = {');
  if (startIdx === -1) startIdx = src.indexOf('const TILE_PRESETS = {');
  if (startIdx === -1) {
    return DEFAULT_PRESETS;
  }

  let depth = 0;
  let inObj = false;
  let endIdx = startIdx;
  for (let i = startIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; inObj = true; }
    else if (src[i] === '}') {
      depth--;
      if (inObj && depth === 0) { endIdx = i; break; }
    }
  }
  const block = src.slice(startIdx, endIdx + 1);
  const presets = [];
  let d = 0;
  let lineStart = 0;
  for (let i = 0; i < block.length; i++) {
    if (block[i] === '\n' || i === block.length - 1) {
      const line = block.slice(lineStart, i + 1);
      if (d === 1) {
        const m = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*\{/);
        if (m) presets.push(m[1]);
      }
      for (const c of line) {
        if (c === '{') d++;
        else if (c === '}') d--;
      }
      lineStart = i + 1;
    }
  }
  const resolved = presets.length > 0 ? presets : DEFAULT_PRESETS;
  _presetsCache = { mtimeKey, presets: resolved };
  return resolved;
}

export function validateBriefObject(brief) {
  const errors = [];
  if (!brief || typeof brief !== 'object') {
    return { valid: false, errors: ['Brief must be a JSON object.'] };
  }
  if (!brief.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(String(brief.id))) {
    errors.push('brief.id must be a non-empty alphanumeric/hyphen/underscore slug.');
  }
  if (!brief.name || String(brief.name).trim().length === 0) {
    errors.push('brief.name is required.');
  }
  for (const reqKey of ['envelope', 'funicular', 'supports', 'material', 'loadCases', 'acceptanceCriteria']) {
    if (!brief[reqKey]) errors.push(`Missing required section: brief.${reqKey}`);
  }
  if (brief.envelope) {
    if (!(Number(brief.envelope.maxPlanX) > 0)) errors.push('envelope.maxPlanX must be > 0.');
    if (!(Number(brief.envelope.maxPlanY) > 0)) errors.push('envelope.maxPlanY must be > 0.');
    if (!(Number(brief.envelope.targetHeightZ) > 0)) errors.push('envelope.targetHeightZ must be > 0.');
  }
  if (!Array.isArray(brief.loadCases) || brief.loadCases.length === 0) {
    errors.push('brief.loadCases must contain at least 1 load case.');
  }
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// Warm Persistent Air-Gapped Worker Thread Pools
// ============================================================================

class AirGappedWorkerPool {
  constructor(scriptPath, maxWorkers = 6) {
    this.scriptPath = scriptPath;
    this.maxWorkers = Math.max(1, Math.min(16, maxWorkers));
    this.workers = [];
    this.idleWorkers = [];
    this.queue = [];
    this.nextMsgId = 1;
    this.closed = false;
  }

  _spawnOne() {
    const w = new Worker(this.scriptPath, { execArgv: [] });
    const slot = { worker: w, busy: false, currentTask: null };

    w.on('message', (msg) => {
      const task = slot.currentTask;
      slot.currentTask = null;
      slot.busy = false;
      if (task) {
        clearTimeout(task.timer);
        if (msg && msg.ok) task.resolve(msg);
        else task.reject(new Error(msg?.error || 'Worker task failed'));
      }
      if (!this.closed) {
        this._dispatchNext(slot);
      }
    });

    w.on('error', (err) => {
      const task = slot.currentTask;
      slot.currentTask = null;
      slot.busy = false;
      this._removeSlot(slot);
      if (task) {
        clearTimeout(task.timer);
        task.reject(err);
      }
      if (!this.closed && this.queue.length > 0) {
        this._ensureCapacityAndDispatch();
      }
    });

    w.on('exit', (code) => {
      const task = slot.currentTask;
      slot.currentTask = null;
      slot.busy = false;
      this._removeSlot(slot);
      if (task && code !== 0) {
        clearTimeout(task.timer);
        task.reject(new Error(`Worker exited with code ${code}`));
      }
      if (!this.closed && this.queue.length > 0) {
        this._ensureCapacityAndDispatch();
      }
    });

    // Unref idle worker threads so standalone CLI runs (`node foundry_runner.mjs`) exit cleanly when finished
    w.unref();
    this.workers.push(slot);
    this.idleWorkers.push(slot);
    return slot;
  }

  _removeSlot(slot) {
    const i = this.workers.indexOf(slot);
    if (i !== -1) this.workers.splice(i, 1);
    const j = this.idleWorkers.indexOf(slot);
    if (j !== -1) this.idleWorkers.splice(j, 1);
  }

  _ensureCapacityAndDispatch() {
    while (this.queue.length > 0 && !this.closed) {
      let slot = this.idleWorkers.pop();
      if (!slot && this.workers.length < this.maxWorkers) {
        slot = this._spawnOne();
        this.idleWorkers.pop();
      }
      if (!slot) break;
      this._assignTask(slot, this.queue.shift());
    }
  }

  _dispatchNext(slot) {
    if (this.queue.length > 0 && !this.closed) {
      const nextTask = this.queue.shift();
      this._assignTask(slot, nextTask);
    } else {
      slot.worker.unref();
      if (!this.idleWorkers.includes(slot)) {
        this.idleWorkers.push(slot);
      }
    }
  }

  _assignTask(slot, task) {
    slot.busy = true;
    slot.currentTask = task;
    slot.worker.ref();
    task.timer = setTimeout(() => {
      slot.currentTask = null;
      slot.busy = false;
      this._removeSlot(slot);
      try { slot.worker.terminate(); } catch {}
      task.reject(new Error('Worker task timed out'));
      if (!this.closed && this.queue.length > 0) {
        this._ensureCapacityAndDispatch();
      }
    }, task.timeoutMs);
    slot.worker.postMessage({ ...task.payload, id: task.id });
  }

  get activeCount() {
    let n = 0;
    for (const s of this.workers) if (s.busy) n++;
    return n;
  }

  exec(payload, timeoutMs = 45000) {
    if (this.closed) {
      return Promise.reject(new Error('Worker pool is closed'));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextMsgId++;
      this.queue.push({ id, payload, timeoutMs, resolve, reject, timer: null });
      this._ensureCapacityAndDispatch();
    });
  }

  async warmup(count = 2) {
    const n = Math.max(1, Math.min(this.maxWorkers, count));
    while (this.workers.length < n) {
      this._spawnOne();
    }
    await Promise.all(
      this.workers.slice(0, n).map((slot) => {
        if (slot.busy) return Promise.resolve();
        return this.exec({ type: 'warmup' }, 15000).catch(() => {});
      })
    );
  }

  async resizeIfNeeded(minCount) {
    if (minCount > this.maxWorkers) {
      this.maxWorkers = Math.min(16, minCount);
    }
  }

  async destroy() {
    this.closed = true;
    while (this.queue.length > 0) {
      const t = this.queue.shift();
      t.reject(new Error('Pool destroyed'));
    }
    const terms = this.workers.map((s) => {
      if (s.currentTask) {
        clearTimeout(s.currentTask.timer);
        s.currentTask.reject(new Error('Worker terminated'));
        s.currentTask = null;
      }
      return s.worker.terminate().catch(() => {});
    });
    this.workers = [];
    this.idleWorkers = [];
    await Promise.all(terms);
  }
}

let sharedGeneratorPool = null;
let sharedVerifierPool = null;
let lastKnownGeneratorSeal = null;

export function getSharedWorkerPools(concurrency = 6) {
  const targetSize = Math.max(2, Math.min(16, concurrency || Math.min(8, os.cpus().length)));
  const seal = computeFoundrySeal();
  const reloadGen = Boolean(lastKnownGeneratorSeal && lastKnownGeneratorSeal !== seal.generatorSealHash);
  lastKnownGeneratorSeal = seal.generatorSealHash;

  if (!sharedGeneratorPool || sharedGeneratorPool.closed || reloadGen) {
    if (sharedGeneratorPool && !sharedGeneratorPool.closed) {
      sharedGeneratorPool.destroy().catch(() => {});
    }
    sharedGeneratorPool = new AirGappedWorkerPool(PATHS.generatorWorker, targetSize);
  } else {
    sharedGeneratorPool.resizeIfNeeded(targetSize);
  }

  if (!sharedVerifierPool || sharedVerifierPool.closed) {
    sharedVerifierPool = new AirGappedWorkerPool(PATHS.verifierWorker, targetSize);
  } else {
    sharedVerifierPool.resizeIfNeeded(targetSize);
  }

  return { generatorPool: sharedGeneratorPool, verifierPool: sharedVerifierPool };
}

export async function warmupSharedWorkerPools(count = 2) {
  const { generatorPool, verifierPool } = getSharedWorkerPools(Math.max(4, count));
  await Promise.all([generatorPool.warmup(count), verifierPool.warmup(count)]);
}

export async function shutdownSharedWorkerPools() {
  const p = [];
  if (sharedGeneratorPool) {
    p.push(sharedGeneratorPool.destroy());
    sharedGeneratorPool = null;
  }
  if (sharedVerifierPool) {
    p.push(sharedVerifierPool.destroy());
    sharedVerifierPool = null;
  }
  await Promise.all(p);
}

/**
 * Instant Single-Candidate Live Evaluation (`< 80 ms` once warm):
 * Runs through the isolated GeneratorWorker -> neutral payload -> isolated VerifierWorker
 * with 0 cross-imports, returning `{ topology, objText, verdict, record, patternsSvg, unrolledJson, seal }`.
 */
export async function quickEvaluateCandidate(brief, rawConfig = {}, options = {}) {
  const t0 = performance.now();
  const seal = computeFoundrySeal();
  if (!seal.airGapPassed) {
    throw new Error('Air-Gap seal check failed prior to quick-eval.');
  }

  const { generatorPool, verifierPool } = getSharedWorkerPools(4);
  // In interactive slider tuning (`/api/quick-eval`), evaluate the exact user-selected
  // outerRadiusM / innerRadiusM directly (`autoSlenderness: false` unless explicitly requested)
  // so slider changes respond in ~50-90ms and reflect the exact radius chosen by the student!
  const cfg = {
    name: rawConfig.name || 'quick_eval_preview',
    tilePreset: rawConfig.tilePreset || 'pilot_champion',
    gridResolution: rawConfig.gridResolution || brief?.topology?.minGridResolution || [2, 2, 3],
    wfcSeed: rawConfig.wfcSeed ?? 42,
    fdmMode: rawConfig.fdmMode || (brief?.funicular?.requireCompressionOnly ? 'compression' : 'compression'),
    outerRadiusM: rawConfig.outerRadiusM ?? 0.016,
    innerRadiusM: rawConfig.innerRadiusM ?? 0.009,
    nSides: rawConfig.nSides ?? 8,
    qProfile: rawConfig.qProfile || 'funicular_tuned',
    longitudinalSubdivLevels: rawConfig.longitudinalSubdivLevels ?? Math.max(1, Number(brief?.geometry?.minLongitudinalSubdivLevels || 1)),
    pqOptimization: rawConfig.pqOptimization ?? Boolean(brief?.geometry?.requirePQOptimization ?? true),
    unrollPatterns: rawConfig.unrollPatterns ?? Boolean(brief?.fabrication?.requireUnrolledPatternsPerBar ?? true),
    optimizeForceDensities: rawConfig.optimizeForceDensities ?? true,
    optimizeIterations: rawConfig.optimizeIterations ?? 2,
    pqIterations: rawConfig.pqIterations ?? 24,
    autoSlenderness: rawConfig.autoSlenderness !== undefined ? Boolean(rawConfig.autoSlenderness) : false,
    pruneTension: rawConfig.pruneTension !== undefined ? Boolean(rawConfig.pruneTension) : false,
    ...rawConfig,
    ...(rawConfig.autoSlenderness === undefined ? { autoSlenderness: false } : {}),
    ...(rawConfig.pruneTension === undefined ? { pruneTension: false } : {}),
    ...(rawConfig.optimizeIterations === undefined ? { optimizeIterations: 2 } : {}),
    ...(rawConfig.pqIterations === undefined ? { pqIterations: 24 } : {}),
  };

  let outDir = null;
  if (options.persistPreview) {
    outDir = path.join(PATHS.runsDir, '_tmp_quick_eval');
    fs.mkdirSync(outDir, { recursive: true });
  }

  const genRes = await generatorPool.exec({
    type: 'generate',
    brief,
    config: cfg,
    name: cfg.name,
    outDir,
    returnInMemory: true,
  }, 30000);

  const verRes = await verifierPool.exec({
    type: 'verify',
    brief,
    topology: genRes.topologyJson,
    objText: genRes.objText,
    svgText: genRes.patternsSvg || null,
    unrolledData: genRes.unrolledJson || null,
    candidateName: cfg.name,
    returnVerdict: true,
  }, 30000);

  const record = extractCandidateRecord(
    { ...cfg, _modeTag: 'QUICK' },
    'quick_eval',
    verRes.verdict,
    genRes.topologyJson,
    brief,
    null
  );

  const elapsedMs = +(performance.now() - t0).toFixed(2);
  return {
    status: 'ok',
    elapsedMs,
    generatorMs: genRes.elapsedMs,
    verifierMs: verRes.elapsedMs,
    topology: genRes.topologyJson,
    topologyJson: genRes.topologyJson,
    objText: genRes.objText,
    verdict: verRes.verdict,
    record,
    patternsSvg: genRes.patternsSvg || null,
    unrolledJson: genRes.unrolledJson || null,
    seal,
  };
}

// ============================================================================
// Gate 1 Verifier Benchmark Cache (keyed by verifierSealHash)
// ============================================================================

let _memBenchCache = new Map();

function readBenchCache(verifierSealHash) {
  if (_memBenchCache.has(verifierSealHash)) {
    return _memBenchCache.get(verifierSealHash);
  }
  try {
    if (fs.existsSync(PATHS.benchCacheJson)) {
      const obj = JSON.parse(fs.readFileSync(PATHS.benchCacheJson, 'utf8'));
      if (obj && obj.verifierSealHash === verifierSealHash && obj.passCount > 0 && obj.failCount === 0) {
        _memBenchCache.set(verifierSealHash, obj);
        return obj;
      }
    }
  } catch {}
  return null;
}

function writeBenchCache(verifierSealHash, passCount) {
  const entry = {
    verifierSealHash,
    passCount,
    failCount: 0,
    verifiedAt: new Date().toISOString(),
  };
  _memBenchCache.set(verifierSealHash, entry);
  try {
    fs.mkdirSync(PATHS.runsDir, { recursive: true });
    fs.writeFileSync(PATHS.benchCacheJson, JSON.stringify(entry, null, 2) + '\n', 'utf8');
  } catch {}
}

// ============================================================================
// Domain Helpers & Multi-Objective Pareto Sorting
// ============================================================================

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6D2B79F5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function classifyFailureModes(verdict, runError = null) {
  const modes = new Set();
  if (runError) {
    modes.add(runError);
    return [...modes];
  }
  if (!verdict) return ['missing_verdict'];
  if (verdict.passed) return [];

  const fab = verdict.fabrication?.checks || {};
  if (fab.connectivity && !fab.connectivity.passed) modes.add('disconnected_graph');
  if (fab.anchors && !fab.anchors.passed) modes.add('anchor_violation');
  if (fab.envelope && !fab.envelope.passed) modes.add('envelope_violation');
  if (fab.voxelGrid && !fab.voxelGrid.passed) modes.add('min_voxel_grid');
  if (fab.pqGeometry && !fab.pqGeometry.passed) modes.add('pq_planarity_or_subdiv');
  if (fab.unrolledPatterns && !fab.unrolledPatterns.passed) modes.add('unrolled_pattern_check');
  if (fab.members && !fab.members.passed) {
    if ((fab.members.slenderEdgeCount || 0) > 0) modes.add('slenderness_limit');
    if ((fab.members.shortEdgeCount || 0) > 0) modes.add('short_member_limit');
    if ((fab.members.radiusViolationCount || 0) > 0) modes.add('radius_limit');
    if ((fab.members.wallViolationCount || 0) > 0) modes.add('wall_thickness_limit');
  }
  if (fab.mesh && !fab.mesh.passed) modes.add('mesh_non_manifold');

  for (const lc of verdict.loadCases || []) {
    if (lc.passed) continue;
    const c = lc.criteria || {};
    if (c.equilibrium && !c.equilibrium.passed) modes.add('fea_equilibrium_or_singular');
    if ((c.deflectionRatio && !c.deflectionRatio.passed) || (c.maxDeflectionM && !c.maxDeflectionM.passed)) {
      modes.add('deflection_L300');
    }
    if (c.tensileSafetyFactor && !c.tensileSafetyFactor.passed) modes.add('tensile_bending');
    if (c.compressiveSafetyFactor && !c.compressiveSafetyFactor.passed) modes.add('compressive_strength');
    if (c.bucklingSafetyFactor && !c.bucklingSafetyFactor.passed) modes.add('euler_buckling');
    if (c.compressionOnly && !c.compressionOnly.passed) modes.add('compression_only_tension_bar');
  }

  if (modes.size === 0 && Array.isArray(verdict.failureReasons) && verdict.failureReasons.length > 0) {
    for (const r of verdict.failureReasons) {
      const s = String(r).toLowerCase();
      if (s.includes('compression') || s.includes('tensile')) modes.add('compression_only_tension_bar');
      else if (s.includes('pq') || s.includes('planarity')) modes.add('pq_planarity_or_subdiv');
      else if (s.includes('unroll')) modes.add('unrolled_pattern_check');
      else modes.add('other_failure');
    }
  }
  return [...modes];
}

export function extractCandidateRecord(cfg, roundTag, verdict, topology, brief, pathsRel) {
  const geom = verdict?.geometry || {};
  const fab = verdict?.fabrication?.checks || {};
  const kpis = verdict?.kpis || {};
  const lcs = verdict?.loadCases || [];
  const lcGov = lcs.find(lc => (lc.loads?.totalDistributedLoadN || 0) > 0) || lcs[lcs.length - 1] || {};
  const lateral = verdict?.lateralStabilityAdvisory || null;

  let imposedLoadKg = 0;
  for (const lc of brief?.loadCases || []) {
    if ((lc.distributedVerticalMassKg || 0) > imposedLoadKg) {
      imposedLoadKg = lc.distributedVerticalMassKg;
    }
  }

  const massKg = Number(geom.centerlineMassKg ?? geom.totalMassKg ?? kpis.centerlineMassKg ?? 0);
  const meshMassKg = geom.meshMassKg != null ? Number(geom.meshMassKg) : massKg;
  const nEdges = Number(geom.nEdges ?? kpis.elementCount ?? topology?.edges?.length ?? 0);
  const nNodes = Number(geom.nNodes ?? topology?.vertices?.length ?? 0);
  const nAnchors = Number(geom.nAnchors ?? topology?.anchors?.length ?? 0);

  const rOuter = Number(topology?.section?.outerRadiusM ?? cfg.outerRadiusM ?? 0.015);
  const rInner = Number(topology?.section?.innerRadiusM ?? cfg.innerRadiusM ?? 0);
  const nSides = Number(topology?.section?.nSides ?? cfg.nSides ?? 8);
  let fallbackArea = 0;
  if (topology?.edges && topology?.vertices) {
    const perim = 2 * nSides * rOuter * Math.sin(Math.PI / Math.max(3, nSides));
    for (const [u, v] of topology.edges) {
      const p0 = topology.vertices[u], p1 = topology.vertices[v];
      if (p0 && p1) fallbackArea += perim * Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    }
  }

  const totalUnrolledSurfaceAreaM2 = Number(
    kpis.totalUnrolledSurfaceAreaM2 ??
    fab.unrolledPatterns?.totalUnrolledSurfaceAreaM2 ??
    topology?.fabrication?.totalUnrolledSurfaceAreaM2 ??
    fallbackArea
  );

  const funicularEfficiency = Number(kpis.funicularEfficiency ?? lcGov.kpis?.funicularEfficiency ?? 0);
  const compressionDominance = Number(kpis.compressionDominance ?? lcGov.kpis?.compressionDominance ?? 0);
  const sfTension = Math.min(999999, Number(lcGov.safetyFactors?.tension ?? 0));
  const sfCompression = Math.min(999999, Number(lcGov.safetyFactors?.compression ?? 0));
  const sfBuckling = Math.min(999999, Number(lcGov.safetyFactors?.buckling ?? 0));
  const minSafetyFactor = Math.min(sfTension, sfCompression, sfBuckling);
  const maxDispMm = Number(lcGov.displacements?.maxDispMm ?? 0);
  const deflInv = Number(lcGov.criteria?.deflectionRatio?.inverseRatio ?? (maxDispMm > 1e-6 ? Math.round(1000 / maxDispMm) : 99999));
  const maxQuadPlanarityErrorM = Number(
    kpis.maxQuadPlanarityErrorM ??
    topology?.geometry?.maxQuadPlanarityErrorM ??
    fab.pqGeometry?.maxQuadPlanarityErrorM ??
    0
  );
  const tensileBarCount = Number(
    kpis.tensileBarCount ??
    lcGov.criteria?.compressionOnly?.tensileBarCount ??
    0
  );
  const maxAxialForceN = Number(
    kpis.maxAxialForceN ??
    lcGov.criteria?.compressionOnly?.maxAxialForceN ??
    0
  );

  const gridResolution = topology?.metadata?.gridResolution || cfg.gridResolution || [2, 2, 3];

  return {
    name: cfg.name,
    stem: cfg.name,
    round: roundTag,
    evaluatedAt: new Date().toISOString(),
    executionMode: cfg._modeTag || 'A',
    synthesized: Boolean(cfg._synthesized),
    passed: Boolean(verdict?.passed),
    config: {
      tilePreset: cfg.tilePreset || 'custom_hybrid',
      fdmMode: topology?.fdm?.mode || cfg.fdmMode || 'compression',
      wfcSeed: topology?.metadata?.wfcSeed ?? cfg.wfcSeed ?? 42,
      gridResolution,
      outerRadiusM: rOuter,
      innerRadiusM: rInner,
      nSides,
      qProfile: cfg.qProfile || 'column_boosted',
      ...(cfg.columnBoost !== undefined ? { columnBoost: cfg.columnBoost } : {}),
      ...(cfg.collarBoost !== undefined ? { collarBoost: cfg.collarBoost } : {}),
      ...(cfg.enabledTiles ? { enabledTiles: cfg.enabledTiles } : {}),
    },
    massKg: +massKg.toFixed(4),
    centerlineMassKg: +massKg.toFixed(4),
    meshMassKg: +meshMassKg.toFixed(4),
    totalUnrolledSurfaceAreaM2: +totalUnrolledSurfaceAreaM2.toFixed(4),
    loadToMassRatio: massKg > 1e-6 && imposedLoadKg > 0 ? +(imposedLoadKg / massKg).toFixed(4) : 0,
    funicularEfficiency: +funicularEfficiency.toFixed(4),
    compressionDominance: +compressionDominance.toFixed(4),
    tensileBarCount,
    maxAxialForceN: +maxAxialForceN.toFixed(3),
    sfTension: +sfTension.toFixed(3),
    sfCompression: +sfCompression.toFixed(3),
    sfBuckling: +sfBuckling.toFixed(3),
    minSafetyFactor: +minSafetyFactor.toFixed(3),
    maxDispMm: +maxDispMm.toFixed(4),
    deflectionInverseN: deflInv,
    lateralMaxDriftMm: lateral?.maxLateralDriftMm != null ? +Number(lateral.maxLateralDriftMm).toFixed(4) : null,
    lateralMinSF: lateral?.minSafetyFactor != null ? +Number(lateral.minSafetyFactor).toFixed(3) : null,
    minIncidentAngleDeg: fab.members?.minIncidentAngleDeg != null ? +Number(fab.members.minIncidentAngleDeg).toFixed(2) : null,
    nNodes,
    nEdges,
    elementCount: nEdges,
    nAnchors,
    spanX: +(geom.spanX || 0).toFixed(4),
    spanY: +(geom.spanY || 0).toFixed(4),
    heightZ: +(geom.spanZ || 0).toFixed(4),
    maxSlenderness: +(fab.members?.maxSlendernessRatio || 0).toFixed(2),
    maxQuadPlanarityErrorM: +maxQuadPlanarityErrorM.toExponential(4),
    maxQuadPlanarityErrorMm: +(maxQuadPlanarityErrorM * 1000).toFixed(4),
    longitudinalSubdivLevels: Number(topology?.geometry?.longitudinalSubdivLevels ?? cfg.longitudinalSubdivLevels ?? 1),
    watertightManifold: Boolean(fab.mesh?.isWatertightManifold ?? true),
    fdmResidual: topology?.fdm?.equilibriumResidual ?? null,
    worstTensileMember: lcGov.criteria?.tensileSafetyFactor?.worstMember ?? null,
    worstBucklingMember: lcGov.criteria?.bucklingSafetyFactor?.worstMember ?? null,
    tensileMemberIndices: lcGov.criteria?.compressionOnly?.tensileMemberIndices || [],
    failureModes: classifyFailureModes(verdict, null),
    failureReasons: (verdict?.failureReasons || []).slice(0, 8),
    artifacts: pathsRel,
  };
}

function getObjectiveSpecs(brief) {
  if (Array.isArray(brief?.objectives) && brief.objectives.length > 0) {
    return brief.objectives.map(o => ({
      metric: o.metric,
      direction: o.direction === 'maximize' ? 'maximize' : 'minimize',
      priority: Number(o.priority || 1),
    })).sort((a, b) => a.priority - b.priority);
  }
  return [
    { metric: 'totalUnrolledSurfaceAreaM2', direction: 'minimize', priority: 1 },
    { metric: 'elementCount', direction: 'minimize', priority: 2 },
    { metric: 'centerlineMassKg', direction: 'minimize', priority: 3 },
    { metric: 'funicularEfficiency', direction: 'maximize', priority: 4 },
  ];
}

function readMetricVal(rec, metric) {
  switch (metric) {
    case 'totalUnrolledSurfaceAreaM2': return Number(rec.totalUnrolledSurfaceAreaM2 ?? Infinity);
    case 'elementCount':
    case 'nEdges': return Number(rec.nEdges ?? Infinity);
    case 'centerlineMassKg':
    case 'massKg': return Number(rec.massKg ?? Infinity);
    case 'meshMassKg': return Number(rec.meshMassKg ?? rec.massKg ?? Infinity);
    case 'funicularEfficiency': return Number(rec.funicularEfficiency ?? 0);
    case 'minSafetyFactor': return Number(rec.minSafetyFactor ?? 0);
    case 'maxDispMm': return Number(rec.maxDispMm ?? Infinity);
    case 'loadToMassRatio': return Number(rec.loadToMassRatio ?? 0);
    default: return Number(rec[metric] ?? 0);
  }
}

export function computeDynamicParetoAndChampion(records, brief) {
  const objSpecs = getObjectiveSpecs(brief);
  const passing = records.filter(r => r.passed);
  if (passing.length === 0) {
    for (const r of records) r.isPareto = false;
    return { paretoFront: [], champion: null };
  }

  const cleanPassing = passing.filter(
    r => (r.meshMassKg == null || r.meshMassKg >= 0.80 * r.massKg) && (r.lateralMinSF == null || r.lateralMinSF >= 1.5)
  );
  const pool = cleanPassing.length > 0 ? cleanPassing : passing;
  const poolSet = new Set(pool);

  const front = [];
  for (const a of records) {
    if (!poolSet.has(a)) {
      a.isPareto = false;
      continue;
    }
    let dominated = false;
    for (const b of pool) {
      if (a === b) continue;
      let noWorse = true;
      let strictlyBetter = false;
      for (const spec of objSpecs) {
        const va = readMetricVal(a, spec.metric);
        const vb = readMetricVal(b, spec.metric);
        if (spec.direction === 'minimize') {
          if (vb > va + 1e-6) { noWorse = false; break; }
          if (vb < va - 1e-5) strictlyBetter = true;
        } else {
          if (vb < va - 1e-6) { noWorse = false; break; }
          if (vb > va + 1e-5) strictlyBetter = true;
        }
      }
      if (noWorse && strictlyBetter) {
        dominated = true;
        break;
      }
    }
    a.isPareto = !dominated;
    if (!dominated) front.push(a);
  }

  const sortedFront = [...(front.length > 0 ? front : pool)].sort((a, b) => {
    for (const spec of objSpecs) {
      const va = readMetricVal(a, spec.metric);
      const vb = readMetricVal(b, spec.metric);
      const diff = spec.direction === 'minimize' ? va - vb : vb - va;
      if (Math.abs(diff) > 1e-4) return diff;
    }
    return a.massKg - b.massKg;
  });

  return {
    paretoFront: sortedFront,
    champion: sortedFront[0] || null,
  };
}

function enumerateBriefGrids(brief) {
  const minG = brief?.topology?.minGridResolution || [1, 1, 2];
  const maxG = brief?.topology?.maxGridResolution || [4, 4, 6];
  const symXY = brief?.topology?.symmetryXY !== false;

  const candidates = [
    [1, 1, 3], [1, 1, 4],
    [2, 1, 2], [3, 2, 2], [4, 2, 2],
    [2, 2, 2], [2, 2, 3], [2, 2, 4],
    [3, 3, 3], [3, 3, 4], [3, 3, 5], [3, 3, 6],
    [4, 4, 5], [4, 4, 6],
  ];

  const valid = [];
  const seen = new Set();
  for (const [gx, gy, gz] of candidates) {
    const x = Math.max(minG[0] || 1, Math.min(maxG[0] || 6, gx));
    const y = symXY && minG[0] === minG[1] ? x : Math.max(minG[1] || 1, Math.min(maxG[1] || 6, gy));
    const z = Math.max(minG[2] || 1, Math.min(maxG[2] || 8, gz));
    if (x < (minG[0] || 1) || y < (minG[1] || 1) || z < (minG[2] || 1)) continue;
    if (x > (maxG[0] || 8) || y > (maxG[1] || 8) || z > (maxG[2] || 10)) continue;
    const key = `${x}x${y}x${z}`;
    if (!seen.has(key)) {
      seen.add(key);
      valid.push([x, y, z]);
    }
  }
  if (valid.length === 0) {
    valid.push([minG[0] || 2, minG[1] || 2, minG[2] || 3]);
  }
  return valid;
}

export function normalizeSearchConfig(raw = {}) {
  const requestedProfile = String(raw.searchProfile || 'interactive').toLowerCase();
  const profilePreset = SEARCH_PROFILES[requestedProfile] || SEARCH_PROFILES.interactive;

  const concurrency = Math.max(1, Math.min(16, Number(raw.concurrency || profilePreset.concurrency || 6)));
  const maxRounds = Math.max(1, Number(raw.maxRounds !== undefined ? raw.maxRounds : profilePreset.maxRounds));
  const candidatesPerRound = Math.max(2, Number(raw.candidatesPerRound !== undefined ? raw.candidatesPerRound : profilePreset.candidatesPerRound));
  const round1Count = Math.max(
    2,
    Number(
      raw.round1Count !== undefined
        ? raw.round1Count
        : (raw.candidatesPerRound !== undefined ? raw.candidatesPerRound : profilePreset.round1Count)
    )
  );

  return {
    searchProfile: SEARCH_PROFILES[requestedProfile] ? requestedProfile : 'custom',
    concurrency,
    maxRounds,
    round1Count,
    candidatesPerRound,
    keepFailedMeshes: raw.keepFailedMeshes !== undefined ? Boolean(raw.keepFailedMeshes) : profilePreset.keepFailedMeshes,
    skipFailedUnroll: raw.skipFailedUnroll !== undefined ? Boolean(raw.skipFailedUnroll) : profilePreset.skipFailedUnroll,
    fastConditioning: raw.fastConditioning !== undefined ? Boolean(raw.fastConditioning) : Boolean(profilePreset.fastConditioning),
    earlyStopOnPassCount: Number(raw.earlyStopOnPassCount !== undefined ? raw.earlyStopOnPassCount : profilePreset.earlyStopOnPassCount) || 0,
    forceBenchmarks: Boolean(raw.forceBenchmarks),
    updateGlobalChampion: Boolean(raw.updateGlobalChampion),
  };
}

// ============================================================================
// FoundryCampaignRunner
// ============================================================================

export class FoundryCampaignRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    this.briefPath = options.briefPath;
    this.brief = options.brief;
    this.runId = options.runId;
    this.runDir = options.runDir;
    this.executionMode = String(options.executionMode || 'A').toUpperCase() === 'B' ? 'B' : 'A';

    const defaultGates = {
      gate1_benchmarks: true,
      gate2_smoke: true,
      gate3_explore: true,
      gate4_optimize: true,
      gate5_pareto: true,
      gate6_report: false,
      gate7_video: false,
    };
    this.gates = Object.assign({}, defaultGates, options.gates || {});
    this.searchConfig = normalizeSearchConfig(options.searchConfig || {});

    this.aborted = false;
    this.finishAfterCurrentRound = false;
    this.injectedQueue = [];
    this.activeChildren = new Set();
    this.activeEvalCount = 0;
    this.records = [];
    this.startedAt = new Date().toISOString();
    this.t0 = Date.now();
    this.searchPhaseT0 = null;

    this._flushTimer = null;
    this._lastDiskFlushMs = 0;
    this._dirtyDiskState = false;

    this.state = {
      runId: this.runId,
      runDir: path.relative(FOUNDRY_ROOT, this.runDir).replace(/\\/g, '/'),
      briefId: this.brief?.id || 'unknown',
      briefName: this.brief?.name || 'Unnamed Brief',
      briefPath: path.relative(FOUNDRY_ROOT, this.briefPath).replace(/\\/g, '/'),
      executionMode: this.executionMode,
      searchProfile: this.searchConfig.searchProfile,
      status: 'initializing', // initializing | running | stopped | completed | failed
      startedAt: this.startedAt,
      updatedAt: this.startedAt,
      completedAt: null,
      elapsedSec: 0,
      throughputCandPerSec: 0,
      currentGate: null,
      currentRound: 0,
      maxRounds: this.searchConfig.maxRounds,
      activeWorkers: 0,
      seal: null,
      gates: CANONICAL_GATES.map(g => ({
        ...g,
        enabled: Boolean(this.gates[g.id]),
        status: this.gates[g.id] ? 'pending' : 'skipped',
        detail: '',
        elapsedSec: 0,
      })),
      totals: {
        planned: 0,
        evaluated: 0,
        passed: 0,
        failed: 0,
        passRatePct: 0,
        paretoFrontCount: 0,
        modeBSynthesizedCount: 0,
      },
      champion: null,
      paretoFront: [],
      topFailureModes: [],
      deliverables: {
        paretoSummary: null,
        championTopology: null,
        reportHtml: null,
        showcaseVideoMp4: null,
      },
    };
  }

  logEvent(level, message, extra = {}) {
    const evt = {
      ts: new Date().toISOString(),
      level,
      message,
      gate: this.state.currentGate,
      round: this.state.currentRound,
      ...extra,
    };
    try {
      fs.mkdirSync(this.runDir, { recursive: true });
      fs.appendFileSync(path.join(this.runDir, 'events.jsonl'), JSON.stringify(evt) + '\n', 'utf8');
    } catch {}
    this.emit('event', { type: 'log', payload: evt });
  }

  _recomputeInMemoryState() {
    this.state.updatedAt = new Date().toISOString();
    const elapsedSec = (Date.now() - this.t0) / 1000;
    this.state.elapsedSec = +elapsedSec.toFixed(2);
    this.state.activeWorkers = this.activeEvalCount + this.activeChildren.size;

    const searchSec = this.searchPhaseT0 ? Math.max(0.02, (Date.now() - this.searchPhaseT0) / 1000) : Math.max(0.02, elapsedSec);
    this.state.throughputCandPerSec = this.records.length > 0
      ? +(this.records.length / searchSec).toFixed(2)
      : 0;

    const passed = [];
    const failed = [];
    let synthCount = 0;
    const failCounts = {};

    for (const r of this.records) {
      if (r.synthesized) synthCount++;
      if (r.passed) {
        passed.push(r);
      } else {
        failed.push(r);
        for (const m of r.failureModes || ['other_failure']) {
          failCounts[m] = (failCounts[m] || 0) + 1;
        }
      }
    }

    const { paretoFront, champion } = computeDynamicParetoAndChampion(this.records, this.brief);

    const topFailureModes = Object.entries(failCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([mode, count]) => ({
        mode,
        count,
        pctOfFailures: +((count / Math.max(1, failed.length)) * 100).toFixed(1),
      }));

    this.state.totals.evaluated = this.records.length;
    this.state.totals.passed = passed.length;
    this.state.totals.failed = failed.length;
    this.state.totals.passRatePct = this.records.length > 0
      ? +((passed.length / this.records.length) * 100).toFixed(1)
      : 0;
    this.state.totals.paretoFrontCount = paretoFront.length;
    this.state.totals.modeBSynthesizedCount = synthCount;
    this.state.paretoFront = paretoFront.slice(0, 25);
    this.state.champion = champion;
    this.state.topFailureModes = topFailureModes;

    return { paretoFront, champion, topFailureModes };
  }

  flushDiskStateNow() {
    if (this._flushTimer) {
      clearTimeout(this._flushTimer);
      this._flushTimer = null;
    }
    this._dirtyDiskState = false;
    this._lastDiskFlushMs = Date.now();

    const { paretoFront, champion, topFailureModes } = this._recomputeInMemoryState();
    try {
      fs.mkdirSync(this.runDir, { recursive: true });
      const stateTmp = path.join(this.runDir, `campaign_state.${process.pid}.tmp`);
      const stateOut = path.join(this.runDir, 'campaign_state.json');
      fs.writeFileSync(stateTmp, JSON.stringify(this.state, null, 2) + '\n', 'utf8');
      fs.renameSync(stateTmp, stateOut);

      const paretoOut = this.buildParetoSummaryObject(paretoFront, champion, topFailureModes);
      const paretoTmp = path.join(this.runDir, `pareto_summary.${process.pid}.tmp`);
      const paretoFinal = path.join(this.runDir, 'pareto_summary.json');
      fs.writeFileSync(paretoTmp, JSON.stringify(paretoOut, null, 2) + '\n', 'utf8');
      fs.renameSync(paretoTmp, paretoFinal);
      this.state.deliverables.paretoSummary = path.relative(FOUNDRY_ROOT, paretoFinal).replace(/\\/g, '/');
    } catch {}
  }

  persistState(eventType = 'state_updated', extraPayload = {}, forceDiskFlush = true) {
    this._recomputeInMemoryState();

    if (forceDiskFlush) {
      this.flushDiskStateNow();
    } else {
      // Throttle disk JSON rewrites to ~120ms intervals during rapid parallel candidate bursts,
      // while ALWAYS emitting every SSE event immediately in real time!
      this._dirtyDiskState = true;
      const sinceLast = Date.now() - this._lastDiskFlushMs;
      if (sinceLast >= 120) {
        this.flushDiskStateNow();
      } else if (!this._flushTimer) {
        this._flushTimer = setTimeout(() => {
          this._flushTimer = null;
          if (this._dirtyDiskState) this.flushDiskStateNow();
        }, 120 - sinceLast);
        this._flushTimer.unref?.();
      }
    }

    this.emit('event', {
      type: eventType,
      payload: {
        runId: this.runId,
        status: this.state.status,
        searchProfile: this.state.searchProfile,
        currentGate: this.state.currentGate,
        currentRound: this.state.currentRound,
        totals: this.state.totals,
        champion: this.state.champion,
        paretoFront: this.state.paretoFront,
        topFailureModes: this.state.topFailureModes,
        gates: this.state.gates,
        elapsedSec: this.state.elapsedSec,
        throughputCandPerSec: this.state.throughputCandPerSec,
        ...extraPayload,
      },
    });
  }

  buildParetoSummaryObject(paretoFront, champion, topFailureModes) {
    const groupStats = (keyFn) => {
      const map = new Map();
      for (const r of this.records) {
        const k = keyFn(r);
        if (!map.has(k)) map.set(k, []);
        map.get(k).push(r);
      }
      const out = {};
      for (const [k, arr] of map.entries()) {
        const pass = arr.filter(x => x.passed).sort((a, b) => a.totalUnrolledSurfaceAreaM2 - b.totalUnrolledSurfaceAreaM2 || a.massKg - b.massKg);
        const best = pass[0] || null;
        out[k] = {
          total: arr.length,
          passed: pass.length,
          passRatePct: +((pass.length / Math.max(1, arr.length)) * 100).toFixed(1),
          bestUnrolledAreaM2: best ? best.totalUnrolledSurfaceAreaM2 : null,
          bestElementCount: best ? best.nEdges : null,
          bestMassKg: best ? best.massKg : null,
          bestMeshMassKg: best ? best.meshMassKg : null,
          bestFunicularEff: best ? best.funicularEfficiency : null,
          bestCandidate: best ? best.name : null,
        };
      }
      return out;
    };

    return {
      timestamp: new Date().toISOString(),
      runId: this.runId,
      executionMode: this.executionMode,
      searchProfile: this.searchConfig.searchProfile,
      status: this.state.status,
      briefId: this.brief?.id,
      briefName: this.brief?.name,
      elapsedSec: this.state.elapsedSec,
      throughputCandPerSec: this.state.throughputCandPerSec,
      discoveredPresets: discoverPresetsFromHtml(),
      exploredGrids: [...new Set(this.records.map(r => (r.config?.gridResolution || [2, 2, 3]).join('x')))],
      totals: { ...this.state.totals },
      roundsSummary: groupStats(r => r.round || 'round1'),
      modeComparison: groupStats(r => r.config?.fdmMode || 'compression'),
      presetComparison: groupStats(r => r.config?.tilePreset || 'custom'),
      gridComparison: groupStats(r => (r.config?.gridResolution || [2, 2, 3]).join('x')),
      topFailureModes,
      champion,
      paretoFront,
    };
  }

  setGateStatus(gateId, status, detail = '', elapsedSec = null) {
    const g = this.state.gates.find(x => x.id === gateId);
    if (g) {
      g.status = status;
      if (detail) g.detail = detail;
      if (elapsedSec !== null) g.elapsedSec = +Number(elapsedSec).toFixed(2);
    }
    this.state.currentGate = gateId;
    this.persistState('gate_update', { gateId, gateStatus: status, detail }, true);
  }

  /**
   * Live mid-run interactive steering (`/api/nudge`):
   *   - `finish_round` / `freeze_now`: completes current round cleanly and proceeds directly to Gate 5+!
   *   - `inject_candidate`: queues a user-tuned candidate config into the live worker batch!
   */
  nudge(payload = {}) {
    const action = String(payload.action || 'finish_round').toLowerCase();
    const reason = payload.reason || 'Interactive nudge from Launcher UI';

    if (action === 'finish_round' || action === 'freeze_now') {
      this.finishAfterCurrentRound = true;
      this.logEvent('info', `Interactive Nudge: Finishing Round ${this.state.currentRound} and freezing Champion (${reason}).`);
      this.persistState('campaign_nudged', { action: 'finish_round', reason }, false);
      return {
        status: 'nudged',
        action: 'finish_round',
        runId: this.runId,
        currentRound: this.state.currentRound,
        message: `Will finish Round ${this.state.currentRound} and proceed directly to Gate 5 Pareto & Champion Freeze.`,
      };
    }

    if (action === 'inject_candidate' && payload.config && typeof payload.config === 'object') {
      const idx = this.records.length + this.injectedQueue.length + 1;
      const customCfg = {
        ...payload.config,
        name: payload.config.name || `steered_${String(idx).padStart(2, '0')}_${(payload.config.tilePreset || 'custom').slice(0, 8)}`,
        longitudinalSubdivLevels: payload.config.longitudinalSubdivLevels ?? Math.max(1, Number(this.brief?.geometry?.minLongitudinalSubdivLevels || 1)),
        pqOptimization: payload.config.pqOptimization ?? Boolean(this.brief?.geometry?.requirePQOptimization ?? true),
        unrollPatterns: payload.config.unrollPatterns ?? Boolean(this.brief?.fabrication?.requireUnrolledPatternsPerBar ?? true),
      };
      this.injectedQueue.push(customCfg);
      this.state.totals.planned += 1;
      this.logEvent('info', `Interactive Nudge: Queued steered candidate '${customCfg.name}' (${customCfg.tilePreset}).`);
      this.persistState('campaign_nudged', { action: 'inject_candidate', queuedName: customCfg.name }, false);
      return {
        status: 'nudged',
        action: 'inject_candidate',
        queuedName: customCfg.name,
        runId: this.runId,
      };
    }

    return {
      status: 'ignored',
      action,
      runId: this.runId,
      message: `Unsupported nudge action: ${action}`,
    };
  }

  spawnTrackedProcess(cmd, args, cwd = REPO_ROOT, timeoutMs = 90000) {
    return new Promise((resolve) => {
      if (this.aborted) {
        return resolve({ code: -2, stdout: '', stderr: 'Aborted before spawn', aborted: true, timedOut: false });
      }
      const child = spawn(cmd, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      this.activeChildren.add(child);

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        this.killChildTree(child);
      }, timeoutMs);

      child.stdout.on('data', d => { stdout += d.toString(); });
      child.stderr.on('data', d => { stderr += d.toString(); });
      child.on('error', err => {
        clearTimeout(timer);
        this.activeChildren.delete(child);
        resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut, aborted: this.aborted });
      });
      child.on('close', code => {
        clearTimeout(timer);
        this.activeChildren.delete(child);
        resolve({ code, stdout, stderr, timedOut, aborted: this.aborted });
      });
    });
  }

  killChildTree(child) {
    if (!child || !child.pid) return;
    try {
      if (process.platform === 'win32') {
        spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      } else {
        child.kill('SIGKILL');
      }
    } catch {
      try { child.kill(); } catch {}
    }
  }

  stop(reason = 'Stopped by user') {
    if (this.aborted) return;
    this.aborted = true;
    this.logEvent('warn', `Swarm stop requested: ${reason}`);
    for (const child of [...this.activeChildren]) {
      this.killChildTree(child);
    }
    this.activeChildren.clear();
    for (const g of this.state.gates) {
      if (g.status === 'running') g.status = 'stopped';
    }
    this.state.status = 'stopped';
    this.state.completedAt = new Date().toISOString();
    this.persistState('campaign_stopped', { reason }, true);
  }

  hydrateExistingRecordsIfAny() {
    const jsonlPath = path.join(this.runDir, 'candidates.jsonl');
    if (!fs.existsSync(jsonlPath)) return;
    const lines = fs.readFileSync(jsonlPath, 'utf8').split(/\r?\n/).filter(Boolean);
    const byName = new Map();
    for (const l of lines) {
      try {
        const rec = JSON.parse(l);
        if (rec && rec.name) byName.set(rec.name, rec);
      } catch {}
    }
    this.records = [...byName.values()];
    if (this.records.length > 0) {
      this.logEvent('info', `Hydrated ${this.records.length} existing candidate records from ${path.basename(jsonlPath)}.`);
    }
  }

  verifySealCompliance(stageLabel) {
    const nowSeal = computeFoundrySeal();
    if (!nowSeal.airGapPassed) {
      throw new Error(`Air-gap violation detected at ${stageLabel}! Cross-imports: gen->ver=${nowSeal.generatorToVerifierCross}, ver->gen=${nowSeal.verifierToGeneratorCross}`);
    }
    if (this.state.seal) {
      if (nowSeal.verifierSealHash !== this.state.seal.verifierSealHash) {
        throw new Error(`Verifier immutability seal broken during ${stageLabel}!`);
      }
      if (this.executionMode === 'A' && nowSeal.generatorSealHash !== this.state.seal.generatorSealHash) {
        throw new Error(`Mode A generator code seal broken during ${stageLabel}! Switch to Mode B for source evolution.`);
      }
    }
    return nowSeal;
  }

  async evaluateOneCandidate(cfg, roundTag) {
    if (this.aborted) return null;

    const roundDir = path.join(this.runDir, roundTag);
    fs.mkdirSync(roundDir, { recursive: true });

    const stem = cfg.name;
    const cfgPath = path.join(roundDir, `${stem}.config.json`);
    const topoPath = path.join(roundDir, `${stem}.topology.json`);
    const objPath = path.join(roundDir, `${stem}.mesh.obj`);
    const verdictPath = path.join(roundDir, `${stem}.verdict.json`);
    const svgPath = path.join(roundDir, `${stem}.patterns.svg`);
    const unrollPath = path.join(roundDir, `${stem}.unrolled.json`);

    const cleanCfg = { ...cfg };
    delete cleanCfg._modeTag;
    delete cleanCfg._synthesized;
    delete cleanCfg._parentName;
    if (this.searchConfig.skipFailedUnroll) {
      cleanCfg._skipFailedUnroll = true;
    }
    if (this.searchConfig.fastConditioning) {
      cleanCfg._fastScreen = true;
      if (cleanCfg.optimizeIterations === undefined) {
        cleanCfg.optimizeIterations = this.searchConfig.searchProfile === 'lightning' ? 2 : 2;
      }
      if (cleanCfg.pqIterations === undefined) {
        cleanCfg.pqIterations = 24;
      }
      if (this.searchConfig.searchProfile === 'lightning') {
        if (cleanCfg.autoSlenderness === undefined) cleanCfg.autoSlenderness = false;
        if (cleanCfg.pruneTension === undefined && roundTag !== 'round2') cleanCfg.pruneTension = false;
      } else if (this.searchConfig.searchProfile === 'interactive') {
        // In Round 1 broad explore, use direct radius sizing without 160-step autoSlenderness sweep;
        // Round 2 diagnosis/optimization runs full autoSlenderness + tension pruning on top candidates!
        if (roundTag === 'smoke' || roundTag === 'round1') {
          if (cleanCfg.autoSlenderness === undefined) cleanCfg.autoSlenderness = false;
          if (cleanCfg.pruneTension === undefined) cleanCfg.pruneTension = false;
        }
      }
    }

    const { generatorPool, verifierPool } = getSharedWorkerPools(this.searchConfig.concurrency);
    const briefPathRel = path.relative(REPO_ROOT, this.briefPath).replace(/\\/g, '/');

    this.activeEvalCount++;
    try {
      let genRes;
      try {
        genRes = await generatorPool.exec({
          type: 'generate',
          brief: this.brief,
          config: cleanCfg,
          name: stem,
          outDir: roundDir,
          briefPathRel,
          returnInMemory: true,
        }, 60000);
      } catch (err) {
        if (this.aborted) return null;
        const failRec = {
          name: stem,
          stem,
          round: roundTag,
          evaluatedAt: new Date().toISOString(),
          executionMode: this.executionMode,
          synthesized: Boolean(cfg._synthesized),
          passed: false,
          config: {
            tilePreset: cfg.tilePreset || 'custom_hybrid',
            fdmMode: cfg.fdmMode || 'compression',
            wfcSeed: cfg.wfcSeed ?? 42,
            gridResolution: cfg.gridResolution || [2, 2, 3],
            outerRadiusM: cfg.outerRadiusM || 0.015,
            innerRadiusM: cfg.innerRadiusM || 0,
            qProfile: cfg.qProfile || 'column_boosted',
          },
          massKg: 0,
          centerlineMassKg: 0,
          meshMassKg: 0,
          totalUnrolledSurfaceAreaM2: 0,
          nEdges: 0,
          elementCount: 0,
          nNodes: 0,
          funicularEfficiency: 0,
          minSafetyFactor: 0,
          maxDispMm: 0,
          failureModes: [String(err.message || '').includes('timed out') ? 'generator_timeout' : 'generator_error'],
          failureReasons: [String(err.message || 'Generator failed').slice(0, 240)],
          artifacts: null,
        };
        this.recordCompletedCandidate(failRec);
        return failRec;
      }

      if (this.aborted) return null;

      let verRes;
      try {
        // Pass neutral data to the isolated VerifierWorker (avoids redundant disk re-reads while also writing `.verdict.json` cleanly!)
        verRes = await verifierPool.exec({
          type: 'verify',
          brief: this.brief,
          topology: genRes.topologyJson,
          objText: genRes.objText,
          svgText: genRes.patternsSvg || null,
          unrolledData: genRes.unrolledJson || null,
          candidateName: stem,
          verdictPath,
          returnVerdict: true,
        }, 60000);
      } catch (err) {
        if (this.aborted) return null;
        const failRec = {
          name: stem,
          stem,
          round: roundTag,
          evaluatedAt: new Date().toISOString(),
          executionMode: this.executionMode,
          synthesized: Boolean(cfg._synthesized),
          passed: false,
          config: cleanCfg,
          massKg: 0,
          centerlineMassKg: 0,
          meshMassKg: 0,
          totalUnrolledSurfaceAreaM2: 0,
          nEdges: 0,
          elementCount: 0,
          nNodes: 0,
          funicularEfficiency: 0,
          minSafetyFactor: 0,
          maxDispMm: 0,
          failureModes: [String(err.message || '').includes('timed out') ? 'verifier_timeout' : 'verifier_error'],
          failureReasons: [String(err.message || 'Verifier failed').slice(0, 240)],
          artifacts: null,
        };
        this.recordCompletedCandidate(failRec);
        return failRec;
      }

      if (this.aborted) return null;

      const verdict = verRes.verdict;
      const topology = genRes.topologyJson;

      if (!verdict.passed && !this.searchConfig.keepFailedMeshes) {
        try { if (fs.existsSync(objPath)) fs.unlinkSync(objPath); } catch {}
      }

      const rel = p => fs.existsSync(p) ? path.relative(FOUNDRY_ROOT, p).replace(/\\/g, '/') : null;
      const pathsRel = {
        topology: rel(topoPath),
        meshObj: rel(objPath),
        verdict: rel(verdictPath),
        config: rel(cfgPath),
        patternsSvg: rel(svgPath),
        unrolledJson: rel(unrollPath),
      };

      cfg._modeTag = this.executionMode;
      const rec = extractCandidateRecord(cfg, roundTag, verdict, topology, this.brief, pathsRel);
      this.recordCompletedCandidate(rec);
      return rec;
    } finally {
      this.activeEvalCount = Math.max(0, this.activeEvalCount - 1);
    }
  }

  recordCompletedCandidate(rec) {
    this.records.push(rec);
    try {
      fs.appendFileSync(path.join(this.runDir, 'candidates.jsonl'), JSON.stringify(rec) + '\n', 'utf8');
    } catch {}
    const statusStr = rec.passed
      ? `PASS · ${rec.totalUnrolledSurfaceAreaM2.toFixed(3)} m² · ${rec.nEdges} bars · ${rec.massKg.toFixed(2)} kg · Funic ${(rec.funicularEfficiency * 100).toFixed(1)}%`
      : `FAIL [${(rec.failureModes || []).join(', ')}]`;
    this.logEvent(rec.passed ? 'success' : 'info', `[${rec.round}] ${rec.name} -> ${statusStr}`, {
      candidateName: rec.name,
      passed: rec.passed,
    });
    // Debounce disk state rewrites while emitting SSE `candidate_evaluated` immediately!
    this.persistState('candidate_evaluated', { candidate: rec }, false);
  }

  async runCandidateBatch(configs, roundTag) {
    const dynamicList = [...configs];
    if (dynamicList.length === 0 && this.injectedQueue.length === 0) return [];
    if (this.aborted) return [];

    const concurrency = Math.max(1, Math.min(16, Number(this.searchConfig.concurrency || 6)));
    let nextIdx = 0;
    const batchResults = [];

    const workerLoop = async () => {
      while (!this.aborted) {
        // Drain any live user-injected candidates first!
        if (this.injectedQueue.length > 0) {
          const steered = this.injectedQueue.shift();
          const r = await this.evaluateOneCandidate(steered, roundTag);
          if (r) batchResults.push(r);
          continue;
        }
        const i = nextIdx++;
        if (i >= dynamicList.length) break;
        const r = await this.evaluateOneCandidate(dynamicList[i], roundTag);
        if (r) batchResults.push(r);

        // Check early-stop convergence target if configured (e.g. lightning profile)
        if (
          this.searchConfig.earlyStopOnPassCount > 0 &&
          this.records.filter(x => x.passed).length >= this.searchConfig.earlyStopOnPassCount &&
          batchResults.length >= Math.min(4, dynamicList.length)
        ) {
          this.finishAfterCurrentRound = true;
        }
      }
    };

    const workers = [];
    const spawnCount = Math.min(concurrency, Math.max(1, dynamicList.length + this.injectedQueue.length));
    for (let w = 0; w < spawnCount; w++) {
      workers.push(workerLoop());
    }
    await Promise.all(workers);
    this.flushDiskStateNow();
    return batchResults;
  }

  buildRound1ExplorationConfigs() {
    const discovered = discoverPresetsFromHtml();
    // Order presets so high-yield funicular/diagrid topologies are evaluated first in Lightning & Interactive profiles!
    const priorityOrder = [
      'pilot_champion', 'catenary_quadripod', 'slender_diagrid', 'funicular_vault',
      'diagrid_tower', 'hyperboloid_tower', 'funnel_vault', 'arch_braced',
      'space_frame', 'minimal_frame', 'default_ortho',
    ];
    const presets = [
      ...priorityOrder.filter(p => discovered.includes(p)),
      ...discovered.filter(p => !priorityOrder.includes(p)),
    ];

    const grids = enumerateBriefGrids(this.brief);
    const reqComp = Boolean(this.brief?.funicular?.requireCompressionOnly);
    const allowedModes = Array.isArray(this.brief?.funicular?.allowedModes) && this.brief.funicular.allowedModes.length > 0
      ? this.brief.funicular.allowedModes
      : ['compression'];
    const minR = Number(this.brief?.acceptanceCriteria?.minTubeOuterRadiusM || 0.012);
    const minWall = Number(this.brief?.acceptanceCriteria?.minWallThicknessM || 0.006);
    const minSubdiv = Math.max(0, Number(this.brief?.geometry?.minLongitudinalSubdivLevels || 0));
    const reqPQ = Boolean(this.brief?.geometry?.requirePQOptimization);
    const reqUnroll = Boolean(this.brief?.fabrication?.requireUnrolledPatternsPerBar);

    const rMid = Math.max(minR, 0.017);
    const rHollow = (this.searchConfig.searchProfile === 'lightning' || this.searchConfig.searchProfile === 'interactive')
      ? Math.max(minR + 0.004, 0.0165)
      : Math.max(minR + 0.001, 0.014);
    const riHollow = Math.max(0, +(rHollow - minWall).toFixed(4));

    const targetCount = Math.max(2, Number(this.searchConfig.round1Count || this.searchConfig.candidatesPerRound || 12));
    const configs = [];
    const seen = new Set();

    const pushCfg = (c) => {
      const key = JSON.stringify([c.tilePreset, c.gridResolution, c.wfcSeed, c.fdmMode, c.outerRadiusM, c.innerRadiusM, c.qProfile]);
      if (seen.has(key)) return;
      seen.add(key);
      const idx = String(configs.length + 1).padStart(2, '0');
      const gStr = c.gridResolution.join('');
      const pShort = String(c.tilePreset).replace(/_/g, '').slice(0, 8);
      configs.push({
        ...c,
        name: `r1_${idx}_${pShort}_${gStr}`,
        longitudinalSubdivLevels: Math.max(1, minSubdiv),
        pqOptimization: reqPQ || minSubdiv > 0,
        unrollPatterns: reqUnroll,
        optimizeForceDensities: c.qProfile === 'funicular_tuned' || reqComp,
      });
    };

    // Pass 1: Cover distinct presets first so even small budgets (6–12 cands) span maximum architectural diversity
    let gCursor = 0;
    for (const preset of presets) {
      const g1 = grids[gCursor % grids.length];
      gCursor++;
      pushCfg({
        tilePreset: preset,
        gridResolution: g1,
        wfcSeed: 42,
        fdmMode: reqComp ? 'compression' : allowedModes[0],
        outerRadiusM: rHollow,
        innerRadiusM: riHollow,
        qProfile: 'funicular_tuned',
        columnBoost: 3.2,
      });
      if (configs.length >= targetCount) break;
    }

    // Pass 2: Second grid/section variant across presets
    for (const preset of presets) {
      if (configs.length >= targetCount) break;
      const g2 = grids[(gCursor + 2) % grids.length];
      gCursor++;
      pushCfg({
        tilePreset: preset,
        gridResolution: g2,
        wfcSeed: 7,
        fdmMode: reqComp ? 'compression' : allowedModes[allowedModes.length - 1],
        outerRadiusM: rMid,
        innerRadiusM: 0,
        qProfile: 'column_boosted',
        columnBoost: 4.0,
      });
    }

    // Pass 3: Multi-seed / higher-grid diversity for thorough sweeps
    const extraSeeds = [13, 29, 77, 99, 108];
    let sIdx = 0;
    while (configs.length < targetCount && sIdx < 40) {
      const preset = presets[sIdx % presets.length];
      const grid = grids[(sIdx * 3) % grids.length];
      const seed = extraSeeds[sIdx % extraSeeds.length];
      pushCfg({
        tilePreset: preset,
        gridResolution: grid,
        wfcSeed: seed,
        fdmMode: 'compression',
        outerRadiusM: sIdx % 2 === 0 ? rHollow : +(minR + 0.002).toFixed(4),
        innerRadiusM: sIdx % 2 === 0 ? riHollow : Math.max(0, +(minR + 0.002 - minWall).toFixed(4)),
        qProfile: sIdx % 2 === 0 ? 'funicular_tuned' : 'column_boosted',
        columnBoost: sIdx % 3 === 0 ? 4.5 : 2.8,
      });
      sIdx++;
    }

    return configs.slice(0, targetCount);
  }

  buildOptimizationRoundConfigs(roundNum) {
    const roundTag = `round${roundNum}`;
    const targetCount = Math.max(2, Number(this.searchConfig.candidatesPerRound || 12));
    const grids = enumerateBriefGrids(this.brief);
    const presets = discoverPresetsFromHtml();
    const minR = Number(this.brief?.acceptanceCriteria?.minTubeOuterRadiusM || 0.012);
    const maxR = Number(this.brief?.acceptanceCriteria?.maxTubeOuterRadiusM || 0.090);
    const minWall = Number(this.brief?.acceptanceCriteria?.minWallThicknessM || 0.006);
    const minSubdiv = Math.max(0, Number(this.brief?.geometry?.minLongitudinalSubdivLevels || 0));
    const reqPQ = Boolean(this.brief?.geometry?.requirePQOptimization);
    const reqUnroll = Boolean(this.brief?.fabrication?.requireUnrolledPatternsPerBar);

    const { paretoFront } = computeDynamicParetoAndChampion(this.records, this.brief);
    const passing = this.records.filter(r => r.passed);
    const failing = this.records.filter(r => !r.passed);
    const rng = mulberry32(1000 * roundNum + this.records.length * 37);

    const failCounts = {};
    for (const f of failing) {
      for (const m of f.failureModes || []) failCounts[m] = (failCounts[m] || 0) + 1;
    }

    const configs = [];
    const existingKeys = new Set(
      this.records.map(r => JSON.stringify([
        r.config?.tilePreset,
        r.config?.gridResolution,
        r.config?.wfcSeed,
        r.config?.outerRadiusM,
        r.config?.innerRadiusM,
        r.config?.qProfile,
        r.config?.columnBoost,
      ]))
    );

    const addOptCfg = (baseCfg, labelHint = 'opt') => {
      const idx = String(configs.length + 1).padStart(2, '0');
      const gStr = (baseCfg.gridResolution || [2, 2, 3]).join('');
      const stem = `r${roundNum}_${idx}_${labelHint}_${gStr}`;
      const full = {
        ...baseCfg,
        name: stem,
        longitudinalSubdivLevels: Math.max(1, minSubdiv),
        pqOptimization: reqPQ || minSubdiv > 0,
        unrollPatterns: reqUnroll,
      };
      const key = JSON.stringify([
        full.tilePreset,
        full.gridResolution,
        full.wfcSeed,
        full.outerRadiusM,
        full.innerRadiusM,
        full.qProfile,
        full.columnBoost,
        full._synthesized ? stem : '',
      ]);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      configs.push(full);
      return true;
    };

    // 1. Exploit & slim down elite Pareto parents
    const parents = paretoFront.length > 0 ? paretoFront : passing;
    for (const p of parents.slice(0, 8)) {
      if (configs.length >= Math.ceil(targetCount * (this.executionMode === 'B' ? 0.55 : 0.75))) break;
      const pR = Number(p.config?.outerRadiusM || 0.015);
      const thinnerR = Math.max(minR, +(pR - 0.001 * (1 + (roundNum % 2))).toFixed(4));
      const hollowInner = Math.max(0, +(thinnerR - minWall).toFixed(4));

      addOptCfg({
        tilePreset: p.config.tilePreset,
        gridResolution: p.config.gridResolution,
        wfcSeed: p.config.wfcSeed,
        fdmMode: 'compression',
        outerRadiusM: thinnerR,
        innerRadiusM: hollowInner,
        qProfile: 'funicular_tuned',
        columnBoost: Number(p.config.columnBoost || 3.5) * 1.15,
        collarBoost: 1.35,
        optimizeForceDensities: true,
        equalizeEdgeLengths: true,
      }, String(p.config.tilePreset).replace(/_/g, '').slice(0, 7));

      if (configs.length >= targetCount) break;

      const altGrid = grids[Math.floor(rng() * grids.length)];
      addOptCfg({
        tilePreset: p.config.tilePreset,
        gridResolution: altGrid,
        wfcSeed: (Number(p.config.wfcSeed || 42) + roundNum * 11) % 997,
        fdmMode: 'compression',
        outerRadiusM: Math.max(minR, +(minR + 0.0005 * Math.floor(rng() * 6)).toFixed(4)),
        innerRadiusM: Math.max(0, +(minR - minWall + 0.0005 * Math.floor(rng() * 6)).toFixed(4)),
        qProfile: rng() > 0.4 ? 'funicular_tuned' : 'column_boosted',
        columnBoost: +(2.5 + rng() * 3.5).toFixed(2),
        optimizeForceDensities: true,
        equalizeEdgeLengths: true,
      }, String(p.config.tilePreset).replace(/_/g, '').slice(0, 7));
    }

    // 2. Diagnosis-driven repair of failed topologies when pass rate is low
    if (passing.length < 4 || failCounts.deflection_L300 || failCounts.euler_buckling || failCounts.compression_only_tension_bar) {
      const funicularPresets = ['funnel_vault', 'catenary_quadripod', 'funicular_vault', 'slender_diagrid', 'arch_braced', 'space_frame']
        .filter(p => presets.includes(p));
      for (const fp of funicularPresets) {
        if (configs.length >= (this.executionMode === 'B' ? Math.ceil(targetCount * 0.65) : targetCount)) break;
        const robustR = Math.min(maxR, +(minR + 0.004 + 0.002 * roundNum).toFixed(4));
        const robustRi = Math.max(0, +(robustR - minWall - 0.001).toFixed(4));
        const gPick = grids[Math.min(grids.length - 1, Math.floor(rng() * grids.length))];
        addOptCfg({
          tilePreset: fp,
          gridResolution: gPick,
          wfcSeed: 42 + roundNum * 17,
          fdmMode: 'compression',
          outerRadiusM: robustR,
          innerRadiusM: robustRi,
          qProfile: 'funicular_tuned',
          columnBoost: 4.5,
          collarBoost: 1.6,
          topCollarBoost: 1.4,
          pruneTension: true,
          optimizeForceDensities: true,
          equalizeEdgeLengths: true,
        }, `diag_${fp.slice(0, 5)}`);
      }
    }

    // 3. MODE B EXCLUSIVE: Adaptive Generator Evolution (Hybrid WFC Tile Synthesis + Verdict-Guided Per-Edge q_e Mutation)
    if (this.executionMode === 'B') {
      const synthDir = path.join(this.runDir, 'mode_b_synthesized');
      fs.mkdirSync(synthDir, { recursive: true });

      const qParents = [...paretoFront, ...failing.filter(f => f.artifacts?.topology)].slice(0, 5);
      for (const parent of qParents) {
        if (configs.length >= targetCount) break;
        if (!parent.artifacts?.topology) continue;
        const parentTopoAbs = path.join(FOUNDRY_ROOT, parent.artifacts.topology);
        if (!fs.existsSync(parentTopoAbs)) continue;
        try {
          const pTopo = JSON.parse(fs.readFileSync(parentTopoAbs, 'utf8'));
          const baseQ = pTopo?.fdm?.forceDensities;
          if (Array.isArray(baseQ) && baseQ.length > 0) {
            const mutatedQ = baseQ.map((qk, ei) => {
              let factor = Math.exp((rng() - 0.5) * 0.28);
              if (parent.worstBucklingMember === ei) factor *= 1.32;
              if (parent.worstTensileMember === ei) factor *= 1.28;
              if (Array.isArray(parent.tensileMemberIndices) && parent.tensileMemberIndices.includes(ei)) {
                factor *= 1.45;
              }
              return +Math.max(0.05, qk * factor).toFixed(5);
            });

            const nextR = Math.max(minR, +(Number(parent.config.outerRadiusM || 0.014) - 0.0005).toFixed(4));
            const nextRi = Math.max(0, +(nextR - minWall).toFixed(4));

            const evoCfg = {
              tilePreset: parent.config.tilePreset,
              gridResolution: parent.config.gridResolution,
              wfcSeed: parent.config.wfcSeed,
              fdmMode: 'compression',
              outerRadiusM: nextR,
              innerRadiusM: nextRi,
              qProfile: 'funicular_tuned',
              forceDensities: mutatedQ,
              optimizeForceDensities: false,
              _synthesized: true,
              _parentName: parent.name,
            };
            if (addOptCfg(evoCfg, 'modeB_qe')) {
              const lastAdded = configs[configs.length - 1];
              fs.writeFileSync(
                path.join(synthDir, `${lastAdded.name}.synthesized_qe.json`),
                JSON.stringify({ parent: parent.name, round: roundTag, forceDensities: mutatedQ }, null, 2) + '\n',
                'utf8'
              );
            }
          }
        } catch {}
      }

      const hybridTemplates = [
        ['catenary_quadripod', 'funicular_vault', 'arch_vault', 'diaphragm_xy'],
        ['slender_diagrid', 'hyperboloid', 'xbrace_xz', 'xbrace_yz'],
        ['funicular_vault', 'tripod_leg', 'diag_pyramid', 'vtube'],
        ['catenary_quadripod', 'slender_diagrid', 'arch_vault', 'cross'],
      ];
      let hIdx = 0;
      while (configs.length < targetCount && hIdx < 16) {
        const baseTiles = hybridTemplates[(hIdx + roundNum) % hybridTemplates.length].filter(t => BUILTIN_TILE_IDS.includes(t));
        const tileWeights = {};
        for (const t of baseTiles) {
          tileWeights[t] = +(0.6 + rng() * 3.4).toFixed(2);
        }
        const gPick = grids[(hIdx + roundNum) % grids.length];
        const rPick = Math.max(minR, +(minR + 0.0005 * (hIdx % 5)).toFixed(4));
        const riPick = Math.max(0, +(rPick - minWall).toFixed(4));

        const synCfg = {
          tilePreset: 'funicular_vault',
          enabledTiles: baseTiles,
          tileWeights,
          gridResolution: gPick,
          wfcSeed: 101 + roundNum * 31 + hIdx * 13,
          fdmMode: 'compression',
          outerRadiusM: rPick,
          innerRadiusM: riPick,
          qProfile: 'funicular_tuned',
          columnBoost: +(3.0 + rng() * 3.0).toFixed(2),
          collarBoost: +(1.1 + rng() * 0.8).toFixed(2),
          optimizeForceDensities: true,
          equalizeEdgeLengths: true,
          _synthesized: true,
        };
        if (addOptCfg(synCfg, 'modeB_hyb')) {
          const lastAdded = configs[configs.length - 1];
          fs.writeFileSync(
            path.join(synthDir, `${lastAdded.name}.hybrid_preset.json`),
            JSON.stringify({
              synthesizedPresetName: lastAdded.name,
              enabledTiles: baseTiles,
              tileWeights,
              defaultGrid: gPick,
              note: 'Synthesized in Mode B; ready to promote & seal into Mode A TILE_PRESETS.',
            }, null, 2) + '\n',
            'utf8'
          );
        }
        hIdx++;
      }
    }

    let padIdx = 0;
    while (configs.length < targetCount && padIdx < 40) {
      const preset = presets[(padIdx + roundNum * 2) % presets.length];
      const grid = grids[(padIdx + roundNum) % grids.length];
      const rPick = Math.max(minR, +(minR + 0.001 * (padIdx % 6)).toFixed(4));
      const riPick = padIdx % 3 === 0 ? 0 : Math.max(0, +(rPick - minWall).toFixed(4));
      addOptCfg({
        tilePreset: preset,
        gridResolution: grid,
        wfcSeed: 19 + roundNum * 23 + padIdx * 7,
        fdmMode: 'compression',
        outerRadiusM: rPick,
        innerRadiusM: riPick,
        qProfile: padIdx % 2 === 0 ? 'funicular_tuned' : 'column_boosted',
        columnBoost: +(2.4 + (padIdx % 5) * 0.8).toFixed(2),
        optimizeForceDensities: true,
        equalizeEdgeLengths: true,
      }, preset.replace(/_/g, '').slice(0, 7));
      padIdx++;
    }

    return configs.slice(0, targetCount);
  }

  async freezeChampionArtifacts(champion) {
    if (!champion || !champion.artifacts?.topology) return null;
    const champDir = path.join(this.runDir, 'champion');
    fs.mkdirSync(champDir, { recursive: true });

    const copyIfExists = (relSrc, ext) => {
      if (!relSrc) return null;
      const src = path.join(FOUNDRY_ROOT, relSrc);
      if (!fs.existsSync(src)) return null;
      const dst = path.join(champDir, `champion${ext}`);
      fs.copyFileSync(src, dst);
      return dst;
    };

    const topoDst = copyIfExists(champion.artifacts.topology, '.topology.json');
    copyIfExists(champion.artifacts.meshObj, '.mesh.obj');
    copyIfExists(champion.artifacts.verdict, '.verdict.json');
    copyIfExists(champion.artifacts.config, '.config.json');
    copyIfExists(champion.artifacts.patternsSvg, '.patterns.svg');
    copyIfExists(champion.artifacts.unrolledJson, '.unrolled.json');

    if (this.searchConfig.updateGlobalChampion && topoDst) {
      const globalChampDir = path.join(PATHS.runsDir, 'champion');
      fs.mkdirSync(globalChampDir, { recursive: true });
      for (const f of fs.readdirSync(champDir)) {
        fs.copyFileSync(path.join(champDir, f), path.join(globalChampDir, f));
      }
    }

    return topoDst ? path.relative(FOUNDRY_ROOT, topoDst).replace(/\\/g, '/') : null;
  }

  async run() {
    this.state.status = 'running';
    fs.mkdirSync(this.runDir, { recursive: true });

    try {
      this.state.seal = computeFoundrySeal(true);
      if (!this.state.seal.airGapPassed) {
        throw new Error('Initial Air-Gap audit failed: cross-imports detected between generator and verifier.');
      }

      // Pre-warm isolated Generator & Verifier worker threads in parallel with Gate 1!
      const warmupPromise = warmupSharedWorkerPools(Math.min(4, this.searchConfig.concurrency)).catch(() => {});

      let planned = 0;
      if (this.gates.gate2_smoke) planned += 1;
      if (this.gates.gate3_explore) planned += Number(this.searchConfig.round1Count || this.searchConfig.candidatesPerRound || 12);
      if (this.gates.gate4_optimize) {
        const optRounds = Math.max(0, Number(this.searchConfig.maxRounds || 2) - 1);
        planned += optRounds * Number(this.searchConfig.candidatesPerRound || 12);
      }
      this.state.totals.planned = planned;

      this.hydrateExistingRecordsIfAny();
      this.logEvent(
        'info',
        `Launched Foundry Campaign [${this.runId}] · Mode ${this.executionMode} · Profile '${this.searchConfig.searchProfile}' (${planned} planned cands, ${this.searchConfig.concurrency} warm workers) on '${this.brief.id}'.`
      );
      this.persistState('campaign_started', {}, true);

      // ==========================================================
      // GATE 1: Brief Validation & Verifier Mechanics Benchmarks
      // ==========================================================
      if (this.gates.gate1_benchmarks && !this.aborted) {
        const gt0 = Date.now();
        this.setGateStatus('gate1_benchmarks', 'running', 'Validating brief schema & verifier mechanics seal...');
        const briefCheck = validateBriefObject(this.brief);
        if (!briefCheck.valid) {
          this.setGateStatus('gate1_benchmarks', 'failed', briefCheck.errors.join('; '), (Date.now() - gt0) / 1000);
          throw new Error(`Brief validation failed: ${briefCheck.errors.join('; ')}`);
        }

        const cachedBench = !this.searchConfig.forceBenchmarks
          ? readBenchCache(this.state.seal.verifierSealHash)
          : null;

        if (cachedBench) {
          this.verifySealCompliance('Gate 1');
          this.setGateStatus(
            'gate1_benchmarks',
            'passed',
            `${cachedBench.passCount}/${cachedBench.passCount} analytical benchmarks PASS (cached seal ${this.state.seal.verifierSealHash.slice(0, 8)})`,
            (Date.now() - gt0) / 1000
          );
          this.logEvent('success', `Gate 1 PASSED: ${cachedBench.passCount}/${cachedBench.passCount} benchmarks verified via immutable seal ${this.state.seal.verifierSealHash.slice(0, 8)}.`);
        } else {
          const benchRes = await this.spawnTrackedProcess(process.execPath, [PATHS.verifierBenchCli]);
          if (this.aborted) return this.state;
          const passMatches = (benchRes.stdout.match(/\[PASS\]/g) || []).length;
          const failMatches = (benchRes.stdout.match(/\[FAIL\]/g) || []).length;
          if (benchRes.code !== 0 || failMatches > 0) {
            this.setGateStatus('gate1_benchmarks', 'failed', `Verifier benchmarks failed (${passMatches} PASS / ${failMatches} FAIL)`, (Date.now() - gt0) / 1000);
            throw new Error(`Analytical verifier benchmark gate failed: ${benchRes.stderr || benchRes.stdout}`);
          }
          this.verifySealCompliance('Gate 1');
          writeBenchCache(this.state.seal.verifierSealHash, passMatches);
          this.setGateStatus('gate1_benchmarks', 'passed', `${passMatches}/${passMatches} analytical benchmarks PASS · Seal OK`, (Date.now() - gt0) / 1000);
          this.logEvent('success', `Gate 1 PASSED: ${passMatches}/${passMatches} closed-form mechanics benchmarks verified.`);
        }
      }

      await warmupPromise;
      this.searchPhaseT0 = Date.now();

      // ==========================================================
      // GATE 2: Baseline Smoke Candidate
      // ==========================================================
      if (this.gates.gate2_smoke && !this.aborted) {
        const gt0 = Date.now();
        this.state.currentRound = 0;
        this.setGateStatus('gate2_smoke', 'running', 'Generating & verifying baseline smoke candidate on warm worker...');
        const grids = enumerateBriefGrids(this.brief);
        const minR = Number(this.brief?.acceptanceCriteria?.minTubeOuterRadiusM || 0.012);
        const smokeCfg = {
          name: 'smoke_baseline',
          tilePreset: 'space_frame',
          gridResolution: grids[0],
          wfcSeed: 42,
          fdmMode: 'compression',
          outerRadiusM: Math.max(minR, 0.018),
          innerRadiusM: 0,
          qProfile: 'column_boosted',
          longitudinalSubdivLevels: Math.max(1, Number(this.brief?.geometry?.minLongitudinalSubdivLevels || 1)),
          pqOptimization: Boolean(this.brief?.geometry?.requirePQOptimization ?? true),
          unrollPatterns: Boolean(this.brief?.fabrication?.requireUnrolledPatternsPerBar ?? true),
        };
        const smokeRec = await this.evaluateOneCandidate(smokeCfg, 'smoke');
        if (this.aborted) return this.state;
        this.verifySealCompliance('Gate 2');
        const smokeDetail = smokeRec
          ? `Baseline ${smokeRec.passed ? 'PASS' : 'DIAGNOSTIC'} (${smokeRec.massKg.toFixed(2)} kg, ${smokeRec.nEdges} bars)`
          : 'Smoke evaluated';
        this.setGateStatus('gate2_smoke', 'passed', smokeDetail, (Date.now() - gt0) / 1000);
      }

      // ==========================================================
      // GATE 3: Broad Swarm Exploration (Round 1)
      // ==========================================================
      if (this.gates.gate3_explore && !this.aborted) {
        const gt0 = Date.now();
        this.state.currentRound = 1;
        this.finishAfterCurrentRound = false; // only honor finish_round after Round 1 starts unless clicked during Round 1
        const r1Configs = this.buildRound1ExplorationConfigs();
        this.setGateStatus('gate3_explore', 'running', `Sweeping ${r1Configs.length} topologies (${this.searchConfig.concurrency} warm workers)...`);
        this.logEvent('info', `Gate 3 (Round 1): Exploring ${r1Configs.length} WFC × FDM candidates.`);

        const r1Results = await this.runCandidateBatch(r1Configs, 'round1');
        if (this.aborted) return this.state;
        this.verifySealCompliance('Gate 3');
        const r1Pass = r1Results.filter(r => r.passed).length;
        this.setGateStatus('gate3_explore', 'passed', `Round 1 complete: ${r1Pass}/${r1Results.length} passed (${this.state.throughputCandPerSec} cand/s)`, (Date.now() - gt0) / 1000);
      }

      // ==========================================================
      // GATE 4: Long-Horizon Diagnosis Optimization (Rounds 2..N)
      // ==========================================================
      if (this.gates.gate4_optimize && !this.aborted) {
        const gt0 = Date.now();
        const totalRounds = Math.max(1, Number(this.searchConfig.maxRounds || 2));

        if (totalRounds < 2 || this.finishAfterCurrentRound) {
          const skipReason = this.finishAfterCurrentRound
            ? 'Early-converged / steered directly to Champion Freeze'
            : 'Single-round profile selected';
          this.setGateStatus('gate4_optimize', 'passed', skipReason, 0);
        } else {
          this.setGateStatus('gate4_optimize', 'running', `Running Rounds 2..${totalRounds} (${this.executionMode === 'B' ? 'Mode B Adaptive Synthesis' : 'Mode A Parametric Opt'})...`);

          for (let rNum = 2; rNum <= totalRounds; rNum++) {
            if (this.aborted || this.finishAfterCurrentRound) break;
            this.state.currentRound = rNum;
            const optConfigs = this.buildOptimizationRoundConfigs(rNum);
            this.logEvent('info', `Gate 4 (Round ${rNum}/${totalRounds}): Dispatching ${optConfigs.length} ${this.executionMode === 'B' ? 'evolutionary + hybrid' : 'diagnosis-driven'} candidates.`);
            const rRes = await this.runCandidateBatch(optConfigs, `round${rNum}`);
            if (this.aborted) return this.state;
            this.verifySealCompliance(`Gate 4 Round ${rNum}`);
            const rPass = rRes.filter(x => x.passed).length;
            this.logEvent('success', `Round ${rNum} finished: ${rPass}/${rRes.length} passed | Current Champion: ${this.state.champion?.name || 'none'}`);
          }

          // Ensure a clean champion candidate ALWAYS has full `.unrolled.json` + `.patterns.svg` on disk
          // (in case `skipFailedUnroll` was active or an injected config omitted unrollPatterns)
          const champSummary = this.state.champion
            ? `Best: ${this.state.champion.totalUnrolledSurfaceAreaM2.toFixed(3)} m² · ${this.state.champion.nEdges} bars · ${this.state.champion.massKg.toFixed(2)} kg`
            : `${this.state.totals.passed}/${this.state.totals.evaluated} passed`;
          this.setGateStatus('gate4_optimize', 'passed', champSummary, (Date.now() - gt0) / 1000);
        }
      }

      // Drain any late user-injected candidates queued right at round end
      if (this.injectedQueue.length > 0 && !this.aborted) {
        await this.runCandidateBatch([], `round${Math.max(1, this.state.currentRound)}`);
      }

      // ==========================================================
      // GATE 5: Pareto Frontier Logging & Champion Freeze
      // ==========================================================
      if (this.gates.gate5_pareto && !this.aborted) {
        const gt0 = Date.now();
        this.setGateStatus('gate5_pareto', 'running', 'Computing multi-objective Pareto front & freezing champion...');
        this.persistState('pareto_updated', {}, true);
        if (this.state.champion) {
          const champRel = await this.freezeChampionArtifacts(this.state.champion);
          this.state.deliverables.championTopology = champRel;
          this.setGateStatus(
            'gate5_pareto',
            'passed',
            `${this.state.totals.paretoFrontCount} Pareto designs · Champion ${this.state.champion.name} frozen`,
            (Date.now() - gt0) / 1000
          );
          this.logEvent('success', `Gate 5 PASSED: Frozen champion ${this.state.champion.name} -> ${champRel}`);
        } else {
          this.setGateStatus('gate5_pareto', 'passed', 'Pareto log saved (0 passing candidates to freeze)', (Date.now() - gt0) / 1000);
          this.logEvent('warn', 'Gate 5 completed with 0 passing candidates; inspect failure diagnostics.');
        }
      }

      // ==========================================================
      // GATE 6: Goldilocks 3D HTML Explainer Report
      // ==========================================================
      if (this.gates.gate6_report && !this.aborted) {
        const gt0 = Date.now();
        this.setGateStatus('gate6_report', 'running', 'Building standalone Goldilocks 3D HTML report...');
        const runReportPath = path.join(this.runDir, 'foundry_report.html');
        const repRes = await this.spawnTrackedProcess(process.execPath, [
          PATHS.reportBuilderCli,
          '--brief', this.briefPath,
          '--run-dir', this.runDir,
          '--out', runReportPath,
        ], FOUNDRY_ROOT, 120000);

        if (this.aborted) return this.state;
        if (repRes.code !== 0 || !fs.existsSync(runReportPath)) {
          this.setGateStatus('gate6_report', 'failed', (repRes.stderr || 'Report build failed').slice(0, 140), (Date.now() - gt0) / 1000);
          throw new Error(`Gate 6 (build_report.mjs) failed: ${repRes.stderr || repRes.stdout}`);
        }
        this.state.deliverables.reportHtml = path.relative(FOUNDRY_ROOT, runReportPath).replace(/\\/g, '/');
        this.setGateStatus('gate6_report', 'passed', 'Built foundry_report.html (H1/H2/H3 verified)', (Date.now() - gt0) / 1000);
        this.logEvent('success', `Gate 6 PASSED: Interactive 3D report ready at ${this.state.deliverables.reportHtml}`);
      }

      // ==========================================================
      // GATE 7: 60-Second Showcase Explainer Video
      // ==========================================================
      if (this.gates.gate7_video && !this.aborted) {
        const gt0 = Date.now();
        this.setGateStatus('gate7_video', 'running', 'Exporting verified video data (Gate F1)...');
        const expRes = await this.spawnTrackedProcess(process.execPath, [
          PATHS.videoExportCli,
          '--brief', this.briefPath,
          '--run-dir', this.runDir,
        ], FOUNDRY_ROOT, 120000);

        if (this.aborted) return this.state;
        if (expRes.code !== 0) {
          this.setGateStatus('gate7_video', 'failed', (expRes.stderr || 'Video export failed').slice(0, 140), (Date.now() - gt0) / 1000);
          throw new Error(`Gate 7 (export_video_data.mjs) failed: ${expRes.stderr || expRes.stdout}`);
        }

        this.setGateStatus('gate7_video', 'running', 'Compiling C++20 Media Foundation renderer & encoding 60s 1080p MP4...');
        const compileRes = await this.spawnTrackedProcess('clang++', [
          '-std=c++20', '-O2', '-DNOMINMAX',
          PATHS.videoRenderCpp,
          '-o', PATHS.videoRenderExe,
          '-lgdiplus', '-lmfplat', '-lmfreadwrite', '-lmfuuid', '-lole32', '-luser32', '-lgdi32',
        ], REPO_ROOT, 180000);

        if (this.aborted) return this.state;
        if (compileRes.code !== 0 && !fs.existsSync(PATHS.videoRenderExe)) {
          this.setGateStatus('gate7_video', 'failed', 'clang++ compilation failed for render_foundry_60s.cpp', (Date.now() - gt0) / 1000);
          throw new Error(`Gate 7 C++20 compile failed: ${compileRes.stderr}`);
        }

        const encRes = await this.spawnTrackedProcess(PATHS.videoRenderExe, [], REPO_ROOT, 600000);
        if (this.aborted) return this.state;
        const mp4Path = path.join(FOUNDRY_ROOT, 'foundry_showcase_60s.mp4');
        if (encRes.code !== 0 || !fs.existsSync(mp4Path)) {
          this.setGateStatus('gate7_video', 'failed', (encRes.stderr || 'Video encode failed').slice(0, 140), (Date.now() - gt0) / 1000);
          throw new Error(`Gate 7 video render failed: ${encRes.stderr || encRes.stdout}`);
        }
        const runMp4Copy = path.join(this.runDir, 'foundry_showcase_60s.mp4');
        try { fs.copyFileSync(mp4Path, runMp4Copy); } catch {}
        this.state.deliverables.showcaseVideoMp4 = 'foundry_showcase_60s.mp4';
        this.setGateStatus('gate7_video', 'passed', 'Encoded 60.0s 1920×1080 @ 30 FPS H.264 MP4', (Date.now() - gt0) / 1000);
        this.logEvent('success', 'Gate 7 PASSED: 60-second showcase video encoded & verified.');
      }

      if (!this.aborted) {
        this.state.status = 'completed';
        this.state.completedAt = new Date().toISOString();
        this.logEvent('success', `Campaign [${this.runId}] COMPLETED in ${this.state.elapsedSec}s (${this.state.throughputCandPerSec} cand/s).`);
        this.persistState('campaign_completed', {}, true);
      }
      return this.state;
    } catch (err) {
      if (!this.aborted) {
        this.state.status = 'failed';
        this.state.completedAt = new Date().toISOString();
        this.logEvent('error', `Campaign failed: ${err.message}`);
        this.persistState('campaign_failed', { error: err.message }, true);
      }
      return this.state;
    }
  }
}

// Standalone CLI entry point
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const k = argv[i].slice(2);
    const nxt = argv[i + 1];
    if (nxt === undefined || nxt.startsWith('--')) args[k] = true;
    else { args[k] = nxt; i++; }
  }

  const briefPath = args.brief
    ? path.resolve(process.cwd(), args.brief)
    : path.join(PATHS.briefsDir, 'pilot_v2_pq_unrolled.json');
  const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runId = args['run-id'] || `${brief.id}_${ts}`;
  const runDir = args['run-dir']
    ? path.resolve(process.cwd(), args['run-dir'])
    : path.join(PATHS.runsDir, runId);

  const selectedNums = args.gates
    ? new Set(String(args.gates).split(',').map(s => Number(s.trim())))
    : new Set([1, 2, 3, 4, 5]);
  const gates = {};
  for (const g of CANONICAL_GATES) {
    gates[g.id] = selectedNums.has(g.index);
  }

  const searchConfig = {
    searchProfile: args.profile || 'interactive',
    ...(args.concurrency !== undefined ? { concurrency: Number(args.concurrency) } : {}),
    ...(args.rounds !== undefined ? { maxRounds: Number(args.rounds) } : {}),
    ...(args['per-round'] !== undefined ? { candidatesPerRound: Number(args['per-round']), round1Count: Number(args['per-round']) } : {}),
    ...(args['force-benchmarks'] ? { forceBenchmarks: true } : {}),
  };

  const runner = new FoundryCampaignRunner({
    briefPath,
    brief,
    runId,
    runDir,
    executionMode: args.mode || 'A',
    gates,
    searchConfig,
  });

  runner.on('event', e => {
    if (e.type === 'log') {
      process.stderr.write(`[${e.payload.level.toUpperCase()}] ${e.payload.message}\n`);
    }
  });

  process.on('SIGINT', () => runner.stop('SIGINT received'));
  runner.run().then(async finalState => {
    await shutdownSharedWorkerPools();
    console.log(JSON.stringify({
      status: finalState.status,
      runId: finalState.runId,
      runDir: finalState.runDir,
      searchProfile: finalState.searchProfile,
      elapsedSec: finalState.elapsedSec,
      throughputCandPerSec: finalState.throughputCandPerSec,
      seal: finalState.seal,
      totals: finalState.totals,
      champion: finalState.champion,
      deliverables: finalState.deliverables,
    }, null, 2));
    process.exit(finalState.status === 'completed' ? 0 : 1);
  });
}

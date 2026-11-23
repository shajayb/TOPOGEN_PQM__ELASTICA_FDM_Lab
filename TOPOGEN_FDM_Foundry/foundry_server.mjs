#!/usr/bin/env node
/**
 * WFC-FDM Foundry — Control-Plane Daemon & Live SSE Telemetry Server
 *
 * Serves TOPOGEN_FDM_Foundry/foundry_launcher.html (and sibling HTML/MP4/OBJ/SVG
 * artifacts) while providing a zero-dependency REST + SSE control plane to:
 *   - Author, validate, and save new Foundry briefs (briefs/<slug>.json)
 *   - Instant `< 80 ms` single-candidate live evaluation (`POST /api/quick-eval`)
 *     via warm air-gapped GeneratorWorker + VerifierWorker pools
 *   - Launch Foundry campaigns in Mode A (Sealed) or Mode B (Adaptive Evolution)
 *     with Speed Profiles (`lightning`, `interactive`, `thorough`)
 *   - Live mid-run steering (`POST /api/nudge`: `finish_round` / `inject_candidate`)
 *   - Stream live candidate evaluations, Pareto fronts, and 3D meshes in real time
 *   - Sub-2ms TTL-cached `/api/health` & `/api/runs` directory summaries
 *
 * Usage:
 *   node TOPOGEN_FDM_Foundry/foundry_server.mjs [--port 8787]
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
import {
  FOUNDRY_ROOT,
  CANONICAL_GATES,
  SEARCH_PROFILES,
  FoundryCampaignRunner,
  computeFoundrySeal,
  discoverPresetsFromHtml,
  validateBriefObject,
  extractCandidateRecord,
  computeDynamicParetoAndChampion,
  quickEvaluateCandidate,
  warmupSharedWorkerPools,
} from './foundry_runner.mjs';

const __filename = fileURLToPath(import.meta.url);
const BRIEFS_DIR = path.join(FOUNDRY_ROOT, 'briefs');
const RUNS_DIR = path.join(FOUNDRY_ROOT, 'runs');

const PROTECTED_REFERENCE_DIRS = new Set([
  'champion',
  'champion_v1_pilot1',
  'pilot_v2_campaign',
  'sweep',
  'smoke',
  'opt_lab',
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.obj': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mp4': 'video/mp4',
};

let activeRunner = null;
const sseClients = new Set();

// ============================================================================
// Short-TTL Caches for `/api/health`, `/api/runs`, and historical run bundles
// ============================================================================

const CACHE_TTL_MS = 2500;
let _storageCache = { ts: 0, data: null };
let _runsListCache = { ts: 0, data: null };
const _historicalRunBundleCache = new Map();

function invalidateRunsAndStorageCache() {
  _storageCache = { ts: 0, data: null };
  _runsListCache = { ts: 0, data: null };
}

function broadcastSSE(eventObj) {
  const line = `data: ${JSON.stringify(eventObj)}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(line);
    } catch {
      sseClients.delete(res);
    }
  }
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req, maxBytes = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      raw += chunk.toString('utf8');
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

function isSafeSubpath(parentDir, targetFull) {
  const rel = path.relative(parentDir, targetFull);
  return Boolean(rel) && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function computeDirStats(dirPath) {
  let files = 0;
  let bytes = 0;
  if (!fs.existsSync(dirPath)) return { files: 0, bytes: 0 };
  const stack = [dirPath];
  while (stack.length > 0) {
    const cur = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
      } else if (ent.isFile()) {
        files++;
        try { bytes += fs.statSync(full).size; } catch {}
      }
    }
  }
  return { files, bytes };
}

function getStorageSummary(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _storageCache.data && now - _storageCache.ts < CACHE_TTL_MS) {
    // Keep isActive dynamic even when returning cached byte counts
    const activeId = activeRunner && activeRunner.state.status === 'running' ? activeRunner.runId : null;
    for (const f of _storageCache.data.folders) {
      f.isActive = f.name === activeId;
    }
    return _storageCache.data;
  }

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const folders = [];
  let totalBytes = 0;
  let totalFiles = 0;

  for (const ent of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const full = path.join(RUNS_DIR, ent.name);
    const st = computeDirStats(full);
    let mtime = null;
    try { mtime = fs.statSync(full).mtime.toISOString(); } catch {}
    totalBytes += st.bytes;
    totalFiles += st.files;
    folders.push({
      name: ent.name,
      isReference: PROTECTED_REFERENCE_DIRS.has(ent.name),
      isActive: Boolean(activeRunner && activeRunner.runId === ent.name && activeRunner.state.status === 'running'),
      files: st.files,
      bytes: st.bytes,
      sizeMB: +(st.bytes / (1024 * 1024)).toFixed(2),
      updatedAt: mtime,
    });
  }

  folders.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const summary = {
    runsRoot: 'TOPOGEN_FDM_Foundry/runs',
    folderCount: folders.length,
    totalFiles,
    totalBytes,
    totalSizeMB: +(totalBytes / (1024 * 1024)).toFixed(2),
    folders,
  };
  _storageCache = { ts: now, data: summary };
  return summary;
}

function listAllBriefs() {
  fs.mkdirSync(BRIEFS_DIR, { recursive: true });
  const list = [];
  for (const f of fs.readdirSync(BRIEFS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(BRIEFS_DIR, f);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf8'));
      list.push({
        fileName: f,
        relPath: `briefs/${f}`,
        isTemplate: f.toUpperCase().includes('TEMPLATE'),
        id: data.id || f.replace(/\.json$/i, ''),
        name: data.name || f,
        version: data.version || '1.0.0',
        brief: data,
      });
    } catch {}
  }
  list.sort((a, b) => {
    if (a.isTemplate !== b.isTemplate) return a.isTemplate ? 1 : -1;
    return a.fileName.localeCompare(b.fileName);
  });
  return list;
}

function buildBriefMarkdownSummary(brief) {
  const env = brief.envelope || {};
  const topo = brief.topology || {};
  const fun = brief.funicular || {};
  const sup = brief.supports || {};
  const mat = brief.material || {};
  const acc = brief.acceptanceCriteria || {};
  const fab = brief.fabrication || {};
  const minG = (topo.minGridResolution || [2, 2, 2]).join(' × ');
  const maxG = (topo.maxGridResolution || [4, 4, 6]).join(' × ');
  return `# Foundry Brief — ${brief.name} (\`${brief.id}\`)

- **Envelope**: \`${env.maxPlanX} m × ${env.maxPlanY} m × ${env.targetHeightZ} m\` (Z-up, ground \`z = ${env.groundZ ?? 0} m\`)
- **Voxel Grid**: Min \`${minG}\`, Max \`${maxG}\`, XY Symmetry: \`${Boolean(topo.symmetryXY ?? true)}\`
- **Funicular Mode**: \`${fun.mode}\` (\`requireCompressionOnly = ${Boolean(fun.requireCompressionOnly)}\`)
- **Supports**: \`${sup.minAnchors}..${sup.maxAnchors}\` \`${sup.restraintType}\` anchors
- **Material**: ${mat.name} (\`E = ${(Number(mat.youngsModulusPa || 5e9) / 1e9).toFixed(2)} GPa\`, \`ρ = ${mat.densityKgM3} kg/m³\`)
- **Acceptance**: Deflection \`<= ${acc.maxDeflectionMeters} m\`, \`SF_t >= ${acc.minTensileSafetyFactor}\`, \`SF_c >= ${acc.minCompressiveSafetyFactor}\`, \`SF_b >= ${acc.minBucklingSafetyFactor}\`
- **Unrolled Patterns**: \`${Boolean(fab.requireUnrolledPatternsPerBar)}\`
`;
}

function resolveBriefFromPayload(body = {}) {
  if (body.brief && typeof body.brief === 'object') {
    return body.brief;
  }
  if (body.briefData && typeof body.briefData === 'object') {
    return body.briefData;
  }
  const relOrFile = body.briefFile || 'pilot_v2_pq_unrolled.json';
  const candPath = path.resolve(BRIEFS_DIR, path.basename(relOrFile));
  if (fs.existsSync(candPath)) {
    return JSON.parse(fs.readFileSync(candPath, 'utf8'));
  }
  return null;
}

/**
 * Hydrate either a modern campaign folder (with campaign_state.json + candidates.jsonl)
 * OR a historical folder (like pilot_v2_campaign or sweep) by scanning verdict files.
 */
function loadRunStateAndCandidates(runId) {
  if (activeRunner && activeRunner.runId === runId) {
    const evPath = path.join(activeRunner.runDir, 'events.jsonl');
    let events = [];
    if (fs.existsSync(evPath)) {
      events = fs.readFileSync(evPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-120)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }
    return {
      state: activeRunner.state,
      candidates: activeRunner.records,
      events,
    };
  }

  const runDir = path.join(RUNS_DIR, runId);
  if (!isSafeSubpath(RUNS_DIR, runDir) || !fs.existsSync(runDir)) {
    return null;
  }

  const statePath = path.join(runDir, 'campaign_state.json');
  const jsonlPath = path.join(runDir, 'candidates.jsonl');
  const eventsPath = path.join(runDir, 'events.jsonl');

  if (fs.existsSync(statePath)) {
    let mtimeKey = '';
    try { mtimeKey = `${fs.statSync(statePath).mtimeMs}`; } catch {}
    const cached = _historicalRunBundleCache.get(runId);
    if (cached && cached.mtimeKey === mtimeKey) {
      return cached.bundle;
    }

    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    let candidates = [];
    if (fs.existsSync(jsonlPath)) {
      candidates = fs.readFileSync(jsonlPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }
    let events = [];
    if (fs.existsSync(eventsPath)) {
      events = fs.readFileSync(eventsPath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-120)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
    }
    const bundle = { state, candidates, events };
    _historicalRunBundleCache.set(runId, { mtimeKey, bundle });
    return bundle;
  }

  // Check cached legacy hydration
  let dirMtimeKey = '';
  try { dirMtimeKey = `legacy:${fs.statSync(runDir).mtimeMs}`; } catch {}
  const cachedLegacy = _historicalRunBundleCache.get(runId);
  if (cachedLegacy && cachedLegacy.mtimeKey === dirMtimeKey) {
    return cachedLegacy.bundle;
  }

  // Fallback hydration for legacy/reference runs (e.g., pilot_v2_campaign, champion, sweep)
  const paretoPath = path.join(runDir, 'pareto_summary.json');
  const savedPareto = fs.existsSync(paretoPath) ? JSON.parse(fs.readFileSync(paretoPath, 'utf8')) : null;
  const defaultBriefPath = path.join(BRIEFS_DIR, 'pilot_v2_pq_unrolled.json');
  const defaultBrief = fs.existsSync(defaultBriefPath) ? JSON.parse(fs.readFileSync(defaultBriefPath, 'utf8')) : {};

  const verdictFiles = [];
  const walk = (d, depth) => {
    if (depth > 2) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory() && ent.name !== 'champion') walk(full, depth + 1);
      else if (ent.isFile() && ent.name.endsWith('.verdict.json')) verdictFiles.push(full);
    }
  };
  walk(runDir, 0);
  if (verdictFiles.length === 0 && fs.existsSync(path.join(runDir, 'champion.verdict.json'))) {
    verdictFiles.push(path.join(runDir, 'champion.verdict.json'));
  }

  const candidates = [];
  for (const vf of verdictFiles) {
    const dir = path.dirname(vf);
    const stem = path.basename(vf).replace(/\.verdict\.json$/i, '');
    const tp = path.join(dir, `${stem}.topology.json`);
    if (!fs.existsSync(tp)) continue;
    try {
      const verdict = JSON.parse(fs.readFileSync(vf, 'utf8'));
      const topology = JSON.parse(fs.readFileSync(tp, 'utf8'));
      const cfgPath = path.join(dir, `${stem}.config.json`);
      const cfg = fs.existsSync(cfgPath)
        ? JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
        : { name: stem, tilePreset: topology?.metadata?.tilePreset, gridResolution: topology?.metadata?.gridResolution };
      cfg.name = stem;
      const rel = p => fs.existsSync(p) ? path.relative(FOUNDRY_ROOT, p).replace(/\\/g, '/') : null;
      const roundRel = path.relative(runDir, dir).replace(/\\/g, '/') || 'round1';
      const rec = extractCandidateRecord(cfg, roundRel.split('/')[0] || 'round1', verdict, topology, defaultBrief, {
        topology: rel(tp),
        meshObj: rel(path.join(dir, `${stem}.mesh.obj`)),
        verdict: rel(vf),
        config: rel(cfgPath),
        patternsSvg: rel(path.join(dir, `${stem}.patterns.svg`)),
        unrolledJson: rel(path.join(dir, `${stem}.unrolled.json`)),
      });
      candidates.push(rec);
    } catch {}
  }

  const { paretoFront, champion } = computeDynamicParetoAndChampion(candidates, defaultBrief);
  const passedCount = candidates.filter(c => c.passed).length;

  const syntheticState = {
    runId,
    runDir: `runs/${runId}`,
    briefId: savedPareto?.briefId || defaultBrief.id || runId,
    briefName: savedPareto?.briefName || defaultBrief.name || runId,
    executionMode: savedPareto?.executionMode || 'A',
    status: 'completed',
    startedAt: savedPareto?.timestamp || null,
    updatedAt: savedPareto?.timestamp || null,
    elapsedSec: savedPareto?.elapsedSec || 0,
    currentGate: 'gate5_pareto',
    currentRound: 3,
    maxRounds: 3,
    activeWorkers: 0,
    gates: CANONICAL_GATES.map(g => ({
      ...g,
      enabled: true,
      status: 'passed',
      detail: 'Historical verified artifact',
      elapsedSec: 0,
    })),
    totals: {
      planned: savedPareto?.totals?.evaluated || candidates.length,
      evaluated: candidates.length || savedPareto?.totals?.evaluated || 0,
      passed: passedCount || savedPareto?.totals?.passed || 0,
      failed: Math.max(0, candidates.length - passedCount),
      passRatePct: candidates.length > 0 ? +((passedCount / candidates.length) * 100).toFixed(1) : (savedPareto?.totals?.passRatePct || 0),
      paretoFrontCount: paretoFront.length || savedPareto?.totals?.paretoFrontCount || 0,
      modeBSynthesizedCount: 0,
    },
    champion,
    paretoFront: paretoFront.slice(0, 25),
    topFailureModes: savedPareto?.topFailureModes || [],
    deliverables: {
      paretoSummary: fs.existsSync(paretoPath) ? `runs/${runId}/pareto_summary.json` : null,
      championTopology: champion?.artifacts?.topology || null,
      reportHtml: fs.existsSync(path.join(FOUNDRY_ROOT, 'foundry_report.html')) ? 'foundry_report.html' : null,
      showcaseVideoMp4: fs.existsSync(path.join(FOUNDRY_ROOT, 'foundry_showcase_60s.mp4')) ? 'foundry_showcase_60s.mp4' : null,
    },
  };

  const bundle = { state: syntheticState, candidates, events: [] };
  _historicalRunBundleCache.set(runId, { mtimeKey: dirMtimeKey, bundle });
  return bundle;
}

function listAllRuns(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && _runsListCache.data && now - _runsListCache.ts < CACHE_TTL_MS) {
    // Overlay live in-memory activeRunner telemetry onto cached run list in O(N) without disk I/O
    if (activeRunner) {
      const s = activeRunner.state;
      const copy = _runsListCache.data.filter(r => r.runId !== activeRunner.runId);
      copy.unshift({
        runId: activeRunner.runId,
        briefId: s.briefId,
        briefName: s.briefName,
        executionMode: s.executionMode,
        searchProfile: s.searchProfile,
        status: s.status,
        evaluated: s.totals.evaluated,
        passed: s.totals.passed,
        paretoCount: s.totals.paretoFrontCount,
        championName: s.champion?.name || null,
        updatedAt: s.updatedAt,
        isReference: PROTECTED_REFERENCE_DIRS.has(activeRunner.runId),
      });
      return copy;
    }
    return _runsListCache.data;
  }

  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const runs = [];
  for (const ent of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
    if (!ent.isDirectory() || ent.name.startsWith('_tmp')) continue;
    const runId = ent.name;
    const full = path.join(RUNS_DIR, runId);
    const statePath = path.join(full, 'campaign_state.json');
    const paretoPath = path.join(full, 'pareto_summary.json');
    let mtime = null;
    try { mtime = fs.statSync(full).mtime.toISOString(); } catch {}

    if (activeRunner && activeRunner.runId === runId) {
      const s = activeRunner.state;
      runs.push({
        runId,
        briefId: s.briefId,
        briefName: s.briefName,
        executionMode: s.executionMode,
        searchProfile: s.searchProfile,
        status: s.status,
        evaluated: s.totals.evaluated,
        passed: s.totals.passed,
        paretoCount: s.totals.paretoFrontCount,
        championName: s.champion?.name || null,
        updatedAt: s.updatedAt || mtime,
        isReference: PROTECTED_REFERENCE_DIRS.has(runId),
      });
      continue;
    }

    if (fs.existsSync(statePath)) {
      try {
        const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        runs.push({
          runId,
          briefId: s.briefId,
          briefName: s.briefName,
          executionMode: s.executionMode || 'A',
          searchProfile: s.searchProfile || null,
          status: s.status === 'running' ? 'stopped' : s.status,
          evaluated: s.totals?.evaluated || 0,
          passed: s.totals?.passed || 0,
          paretoCount: s.totals?.paretoFrontCount || 0,
          championName: s.champion?.name || null,
          updatedAt: s.updatedAt || mtime,
          isReference: PROTECTED_REFERENCE_DIRS.has(runId),
        });
        continue;
      } catch {}
    }

    if (fs.existsSync(paretoPath) || fs.existsSync(path.join(full, 'champion.verdict.json')) || fs.existsSync(path.join(full, 'baseline.verdict.json'))) {
      let p = null;
      try { if (fs.existsSync(paretoPath)) p = JSON.parse(fs.readFileSync(paretoPath, 'utf8')); } catch {}
      runs.push({
        runId,
        briefId: p?.briefId || runId,
        briefName: p?.briefName || `Reference (${runId})`,
        executionMode: 'A',
        searchProfile: p?.searchProfile || null,
        status: 'completed',
        evaluated: p?.totals?.evaluated || 1,
        passed: p?.totals?.passed || 1,
        paretoCount: p?.totals?.paretoFrontCount || 1,
        championName: p?.champion?.name || null,
        updatedAt: p?.timestamp || mtime,
        isReference: PROTECTED_REFERENCE_DIRS.has(runId),
      });
    }
  }

  runs.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (b.status === 'running' && a.status !== 'running') return 1;
    return (b.updatedAt || '').localeCompare(a.updatedAt || '');
  });

  _runsListCache = { ts: now, data: runs };
  return runs;
}

function serveStaticFile(req, res, pathname) {
  const relClean = pathname === '/' ? 'foundry_launcher.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
  const targetFull = path.resolve(FOUNDRY_ROOT, relClean);
  if (targetFull !== FOUNDRY_ROOT && !isSafeSubpath(FOUNDRY_ROOT, targetFull)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden');
    return;
  }
  if (!fs.existsSync(targetFull) || !fs.statSync(targetFull).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = path.extname(targetFull).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  const stat = fs.statSync(targetFull);

  if (ext === '.mp4' && req.headers.range) {
    const parts = req.headers.range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size) {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
      res.end();
      return;
    }
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': mime,
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(targetFull, { start, end }).pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': mime,
    'Content-Length': stat.size,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(targetFull).pipe(res);
}

async function handleApiRequest(req, res, urlObj) {
  const p = urlObj.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (p === '/api/health' && req.method === 'GET') {
    return sendJson(res, 200, {
      status: 'online',
      serverTime: new Date().toISOString(),
      activeRunId: activeRunner && activeRunner.state.status === 'running' ? activeRunner.runId : null,
      activeStatus: activeRunner ? activeRunner.state.status : 'idle',
      seal: computeFoundrySeal(),
      presets: discoverPresetsFromHtml(),
      searchProfiles: SEARCH_PROFILES,
      canonicalGates: CANONICAL_GATES,
      storage: getStorageSummary(),
    });
  }

  if (p === '/api/briefs' && req.method === 'GET') {
    return sendJson(res, 200, { briefs: listAllBriefs() });
  }

  if (p === '/api/briefs' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const brief = body.brief || body;
    const check = validateBriefObject(brief);
    if (!check.valid) {
      return sendJson(res, 400, { error: check.errors.join(' ') });
    }
    const slug = String(brief.id).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
    brief.id = slug;
    if (!brief.version) brief.version = '1.0.0';
    if (!brief.$schema) brief.$schema = '../schemas/brief.schema.json';

    const jsonOut = path.join(BRIEFS_DIR, `${slug}.json`);
    const mdOut = path.join(BRIEFS_DIR, `${slug}.md`);
    fs.mkdirSync(BRIEFS_DIR, { recursive: true });
    fs.writeFileSync(jsonOut, JSON.stringify(brief, null, 2) + '\n', 'utf8');
    fs.writeFileSync(mdOut, buildBriefMarkdownSummary(brief), 'utf8');

    return sendJson(res, 200, {
      status: 'saved',
      fileName: `${slug}.json`,
      relPath: `briefs/${slug}.json`,
      brief,
      briefs: listAllBriefs(),
    });
  }

  // Instant Single-Candidate Air-Gapped Quick Evaluation (< 80ms on warm worker pool!)
  if (p === '/api/quick-eval' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const brief = resolveBriefFromPayload(body);
    if (!brief) {
      return sendJson(res, 400, { error: 'Missing valid brief object or briefFile for quick-eval.' });
    }
    const check = validateBriefObject(brief);
    if (!check.valid) {
      return sendJson(res, 400, { error: check.errors.join(' ') });
    }
    const evalRes = await quickEvaluateCandidate(brief, body.config || {}, {
      persistPreview: Boolean(body.persistPreview),
    });
    return sendJson(res, 200, evalRes);
  }

  if (p === '/api/runs' && req.method === 'GET') {
    return sendJson(res, 200, {
      activeRunId: activeRunner && activeRunner.state.status === 'running' ? activeRunner.runId : null,
      runs: listAllRuns(),
      storage: getStorageSummary(),
    });
  }

  if (p === '/api/state' && req.method === 'GET') {
    const requestedRunId = urlObj.searchParams.get('runId')
      || (activeRunner ? activeRunner.runId : null)
      || 'pilot_v2_campaign';
    const bundle = loadRunStateAndCandidates(requestedRunId);
    if (!bundle) {
      return sendJson(res, 404, { error: `Run '${requestedRunId}' not found.` });
    }
    return sendJson(res, 200, bundle);
  }

  if (p === '/api/candidate' && req.method === 'GET') {
    const topoRel = urlObj.searchParams.get('topo');
    const runId = urlObj.searchParams.get('runId');
    const stem = urlObj.searchParams.get('stem');

    let topoAbs = null;
    if (topoRel) {
      const candAbs = path.resolve(FOUNDRY_ROOT, topoRel);
      if (isSafeSubpath(FOUNDRY_ROOT, candAbs) && fs.existsSync(candAbs)) {
        topoAbs = candAbs;
      }
    } else if (runId && stem) {
      const bundle = loadRunStateAndCandidates(runId);
      const match = bundle?.candidates?.find(c => c.name === stem || c.stem === stem);
      if (match?.artifacts?.topology) {
        const candAbs = path.resolve(FOUNDRY_ROOT, match.artifacts.topology);
        if (isSafeSubpath(FOUNDRY_ROOT, candAbs) && fs.existsSync(candAbs)) {
          topoAbs = candAbs;
        }
      }
    }

    if (!topoAbs) {
      return sendJson(res, 404, { error: 'Candidate topology artifact not found.' });
    }

    const dir = path.dirname(topoAbs);
    const baseStem = path.basename(topoAbs).replace(/\.topology\.json$/i, '');
    const objAbs = path.join(dir, `${baseStem}.mesh.obj`);
    const verdAbs = path.join(dir, `${baseStem}.verdict.json`);
    const svgAbs = path.join(dir, `${baseStem}.patterns.svg`);
    const unrollAbs = path.join(dir, `${baseStem}.unrolled.json`);

    return sendJson(res, 200, {
      stem: baseStem,
      topology: JSON.parse(fs.readFileSync(topoAbs, 'utf8')),
      verdict: fs.existsSync(verdAbs) ? JSON.parse(fs.readFileSync(verdAbs, 'utf8')) : null,
      objText: fs.existsSync(objAbs) ? fs.readFileSync(objAbs, 'utf8') : null,
      patternsSvg: fs.existsSync(svgAbs) ? fs.readFileSync(svgAbs, 'utf8') : null,
      unrolledJson: fs.existsSync(unrollAbs) ? JSON.parse(fs.readFileSync(unrollAbs, 'utf8')) : null,
    });
  }

  if (p === '/api/stream' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(`data: ${JSON.stringify({
      type: 'connected',
      payload: {
        activeRunId: activeRunner && activeRunner.state.status === 'running' ? activeRunner.runId : null,
        status: activeRunner ? activeRunner.state.status : 'idle',
      },
    })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  if (p === '/api/launch' && req.method === 'POST') {
    if (activeRunner && activeRunner.state.status === 'running') {
      return sendJson(res, 409, {
        error: `Campaign '${activeRunner.runId}' is currently running. Stop or finish it before launching a new campaign.`,
      });
    }

    const body = await readJsonBody(req);
    let brief = body.briefData || body.brief || null;
    let briefPath = null;

    if (brief && typeof brief === 'object') {
      const check = validateBriefObject(brief);
      if (!check.valid) return sendJson(res, 400, { error: check.errors.join(' ') });
      const slug = String(brief.id).trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');
      brief.id = slug;
      if (!brief.version) brief.version = '1.0.0';
      if (!brief.$schema) brief.$schema = '../schemas/brief.schema.json';
      briefPath = path.join(BRIEFS_DIR, `${slug}.json`);
      fs.mkdirSync(BRIEFS_DIR, { recursive: true });
      fs.writeFileSync(briefPath, JSON.stringify(brief, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(BRIEFS_DIR, `${slug}.md`), buildBriefMarkdownSummary(brief), 'utf8');
    } else {
      const relOrFile = body.briefFile || 'pilot_v2_pq_unrolled.json';
      const candPath = path.resolve(BRIEFS_DIR, path.basename(relOrFile));
      if (!fs.existsSync(candPath)) {
        return sendJson(res, 404, { error: `Brief file not found: ${relOrFile}` });
      }
      briefPath = candPath;
      brief = JSON.parse(fs.readFileSync(candPath, 'utf8'));
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const requestedTargetRun = body.targetRunId ? String(body.targetRunId).replace(/[^a-zA-Z0-9-_]/g, '') : null;
    const runId = requestedTargetRun || `${brief.id}_${ts}`;
    const runDir = path.join(RUNS_DIR, runId);
    if (!isSafeSubpath(RUNS_DIR, runDir)) {
      return sendJson(res, 400, { error: 'Invalid run directory name.' });
    }

    invalidateRunsAndStorageCache();

    activeRunner = new FoundryCampaignRunner({
      briefPath,
      brief,
      runId,
      runDir,
      executionMode: body.executionMode || 'A',
      gates: body.gates || {},
      searchConfig: body.searchConfig || {},
    });

    activeRunner.on('event', evt => {
      if (evt.type === 'campaign_completed' || evt.type === 'campaign_stopped' || evt.type === 'campaign_failed') {
        invalidateRunsAndStorageCache();
      }
      broadcastSSE(evt);
    });

    activeRunner.run().catch(err => {
      invalidateRunsAndStorageCache();
      broadcastSSE({ type: 'campaign_failed', payload: { runId, error: err.message } });
    });

    return sendJson(res, 202, {
      status: 'launched',
      runId,
      runDir: `runs/${runId}`,
      executionMode: activeRunner.executionMode,
      searchProfile: activeRunner.searchConfig.searchProfile,
      plannedCandidates: activeRunner.state.totals.planned,
      gates: activeRunner.state.gates,
    });
  }

  // Live mid-run interactive steering (`finish_round` / `inject_candidate`)
  if (p === '/api/nudge' && req.method === 'POST') {
    if (!activeRunner || activeRunner.state.status !== 'running') {
      return sendJson(res, 409, { status: 'idle', error: 'No active campaign running to nudge.' });
    }
    const body = await readJsonBody(req).catch(() => ({}));
    const nudgeRes = activeRunner.nudge(body);
    return sendJson(res, 200, nudgeRes);
  }

  if (p === '/api/stop' && req.method === 'POST') {
    if (!activeRunner || activeRunner.state.status !== 'running') {
      return sendJson(res, 200, { status: 'idle', message: 'No active swarm running.' });
    }
    const body = await readJsonBody(req).catch(() => ({}));
    activeRunner.stop(body.reason || 'Stopped by user from Foundry Launcher UI');
    invalidateRunsAndStorageCache();
    return sendJson(res, 200, {
      status: 'stopped',
      runId: activeRunner.runId,
      totals: activeRunner.state.totals,
      champion: activeRunner.state.champion,
    });
  }

  if (p === '/api/reset' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const scope = body.scope || 'scratch'; // 'run' | 'scratch' | 'all_campaigns'
    const preserveReferences = body.preserveReferences !== false;
    const targetRunId = body.targetRunId ? String(body.targetRunId) : null;
    const removed = [];

    if (activeRunner && activeRunner.state.status === 'running') {
      if (scope === 'all_campaigns' || (scope === 'run' && activeRunner.runId === targetRunId) || body.stopActiveFirst) {
        activeRunner.stop('Stopped prior to storage reset');
      }
    }

    if (scope === 'run' && targetRunId) {
      const targetDir = path.join(RUNS_DIR, path.basename(targetRunId));
      if (isSafeSubpath(RUNS_DIR, targetDir) && fs.existsSync(targetDir)) {
        if (preserveReferences && PROTECTED_REFERENCE_DIRS.has(path.basename(targetDir))) {
          return sendJson(res, 400, {
            error: `'${targetRunId}' is a protected reference folder. Uncheck 'Preserve reference benchmarks' to delete it.`,
          });
        }
        fs.rmSync(targetDir, { recursive: true, force: true });
        _historicalRunBundleCache.delete(targetRunId);
        removed.push(targetRunId);
        if (activeRunner && activeRunner.runId === targetRunId) activeRunner = null;
      }
    } else if (scope === 'scratch') {
      const cleanTmpIn = (dir) => {
        if (!fs.existsSync(dir)) return;
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) {
            if (ent.name === '_tmp_eval' || ent.name.startsWith('_tmp')) {
              fs.rmSync(full, { recursive: true, force: true });
              removed.push(path.relative(RUNS_DIR, full).replace(/\\/g, '/'));
            } else {
              cleanTmpIn(full);
            }
          } else if (ent.isFile() && ent.name.endsWith('.tmp')) {
            fs.unlinkSync(full);
            removed.push(path.relative(RUNS_DIR, full).replace(/\\/g, '/'));
          }
        }
      };
      cleanTmpIn(RUNS_DIR);
    } else if (scope === 'all_campaigns') {
      fs.mkdirSync(RUNS_DIR, { recursive: true });
      for (const ent of fs.readdirSync(RUNS_DIR, { withFileTypes: true })) {
        if (preserveReferences && PROTECTED_REFERENCE_DIRS.has(ent.name)) continue;
        const full = path.join(RUNS_DIR, ent.name);
        if (isSafeSubpath(RUNS_DIR, full)) {
          fs.rmSync(full, { recursive: true, force: true });
          _historicalRunBundleCache.delete(ent.name);
          removed.push(ent.name);
          if (activeRunner && activeRunner.runId === ent.name) activeRunner = null;
        }
      }
    }

    invalidateRunsAndStorageCache();
    const storage = getStorageSummary(true);
    broadcastSSE({ type: 'storage_reset', payload: { scope, removed, storage } });
    return sendJson(res, 200, {
      status: 'reset_complete',
      scope,
      preserveReferences,
      removedCount: removed.length,
      removed,
      runs: listAllRuns(true),
      storage,
    });
  }

  return sendJson(res, 404, { error: `Unknown API route: ${p}` });
}

function startServer() {
  let port = Number(process.env.FOUNDRY_PORT || 8787);
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = Number(argv[i + 1]);
  }

  const server = http.createServer(async (req, res) => {
    try {
      const urlObj = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      if (urlObj.pathname.startsWith('/api/')) {
        await handleApiRequest(req, res, urlObj);
      } else {
        serveStaticFile(req, res, urlObj.pathname);
      }
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Internal Server Error' });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`================================================================`);
    console.log(`  WFC-FDM Foundry Control Daemon ONLINE (Warm Worker Pool Ready)`);
    console.log(`  Launcher UI : http://127.0.0.1:${port}/foundry_launcher.html`);
    console.log(`  Generator   : http://127.0.0.1:${port}/index_WFC.html`);
    console.log(`  3D Report   : http://127.0.0.1:${port}/foundry_report.html`);
    console.log(`  Verifier UI : http://127.0.0.1:${port}/verifier/verifier.html`);
    console.log(`================================================================`);

    // Pre-warm Generator & Verifier worker threads in background so the very first `/api/quick-eval` hits < 80ms!
    warmupSharedWorkerPools(2).catch(() => {});
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  startServer();
}

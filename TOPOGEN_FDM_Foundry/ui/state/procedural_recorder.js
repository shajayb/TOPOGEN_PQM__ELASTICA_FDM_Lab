/**
 * WFC-FDM Foundry — Procedural Chain Recorder & Deterministic Playback / Documentation Engine
 * (ui/state/procedural_recorder.js)
 *
 * Records lightweight procedural chains conforming to `topogen-procedural-chain/v1`,
 * stages local disk assets into `TOPOGEN_FDM_Foundry/assets/inputs/` via `serve_lab.mjs`,
 * replays chains deterministically across the live Workbench, and captures high-fidelity
 * PNG stage documentation via `viewport.captureHighResPNG(...)`.
 */

import {
    CHAIN_SCHEMA_VERSION,
    SUPPORTED_STEP_OPS,
    DEFAULT_CAMERA_BOOKMARKS,
    normalizeRepoRelativePath,
    createProceduralChain,
    appendChainStep,
    registerChainAsset,
    validateProceduralChain,
    serializeProceduralChain,
    parseProceduralChain
} from '../../core/procedural_chain.mjs';
import {
    appState,
    actions,
    CORE,
    TUBE_DEFAULTS,
    $,
    $$,
    setTxt,
    downloadBlob
} from './workbench_state.js';
import {
    viewport,
    recomputeModelBox,
    zoomToBox,
    modelBoxToWorld
} from '../display/viewport_scene.js';
import {
    getDefaultBookmarks,
    getAllBookmarks,
    getBookmarkById,
    mergeChainBookmarks,
    exportBookmarks
} from '../display/camera_bookmarks.js';
import {
    applyOutlinerVisibility,
    refreshOutliner
} from '../display/display_hud.js';

const COALESCE_OPS = new Set(['pq_config', 'grid_config', 'fdm_config', 'elastica_trace']);
const DOWNSTREAM_OPS = new Set([
    'pq_config', 'pq_solidify', 'pq_subdiv_ring', 'pq_subdiv_long', 'pq_subdiv_cc',
    'pq_optimize', 'pq_swap_long_ring', 'fdm_config', 'fdm_solve', 'elastica_trace', 'fea_run'
]);
const BASELINE_TILE_OPS = new Set(['tile_preset', 'tile_toggle', 'tile_import']);
const BASELINE_GRID_OPS = new Set(['grid_config', 'wfc_collapse']);

let _chain = createProceduralChain({
    id: 'live-session',
    name: 'Live Workbench Session',
    bookmarks: exportBookmarks()
});
let _loadedChain = null;
let _loadedSourceLabel = '';
let _loadedAssets = new Map();
let _isReplaying = false;
let _stepCursor = 0;
let _currentStageIndex = -1;
let _playbackCameraMode = 'stage'; // 'active' | 'stage' | 'defaults'
let _lastCaptures = [];
const _listeners = new Set();

function notifyListeners(event = 'update', extra = {}) {
    const snapshot = {
        event,
        chain: _chain,
        loadedChain: _loadedChain,
        activeChain: _loadedChain || _chain,
        loadedSourceLabel: _loadedSourceLabel,
        stepCount: _chain.steps.length,
        loadedStepCount: _loadedChain ? _loadedChain.steps.length : _chain.steps.length,
        stepCursor: _stepCursor,
        activeStageIndex: _currentStageIndex,
        isReplaying: _isReplaying,
        captures: _lastCaptures,
        ...extra
    };
    for (const fn of _listeners) {
        try { fn(snapshot); } catch (err) { console.error('[procedural_recorder listener]', err); }
    }
}

export function onChainChange(listener) {
    if (typeof listener !== 'function') return () => {};
    _listeners.add(listener);
    return () => _listeners.delete(listener);
}

export function isReplaying() {
    return _isReplaying;
}

export function getChain() {
    _chain.bookmarks = exportBookmarks();
    return _chain;
}

export function getLoadedChain() {
    return _loadedChain || getChain();
}

export function getStepCount() {
    return _chain.steps.length;
}

export function getStepCursor() {
    return _stepCursor;
}

export function getActiveStageIndex() {
    return _currentStageIndex;
}

export function getLoadedSourceLabel() {
    return _loadedSourceLabel;
}

export function setPlaybackCameraMode(mode) {
    const m = String(mode || 'stage').toLowerCase();
    _playbackCameraMode = (m === 'active' || m === 'defaults') ? m : 'stage';
    notifyListeners('camera_mode', { playbackCameraMode: _playbackCameraMode });
    return _playbackCameraMode;
}

export function getPlaybackCameraMode() {
    return _playbackCameraMode;
}

export function getLastCaptures() {
    return _lastCaptures.slice();
}

export function clearChain(meta = {}) {
    _chain = createProceduralChain({
        id: meta.id || `session-${Date.now()}`,
        name: meta.name || 'Live Workbench Session',
        notes: meta.notes || '',
        bookmarks: exportBookmarks()
    });
    _loadedChain = null;
    _loadedSourceLabel = '';
    _loadedAssets.clear();
    _stepCursor = 0;
    _currentStageIndex = -1;
    _lastCaptures = [];
    notifyListeners('clear');
    return _chain;
}

function captureCompactVoxelGrid() {
    if (!Array.isArray(appState.voxels) || appState.voxels.length === 0) return [];
    return appState.voxels.map((v) => (v && v.collapsed && Number.isInteger(v.tile)) ? v.tile : CORE.TILE_NULL);
}

function captureEnabledTileIds() {
    return (appState.TILES || []).filter((t) => t && t.enabled).map((t) => t.id);
}

function reindexChainSteps(chain) {
    if (!chain || !Array.isArray(chain.steps)) return;
    chain.steps.forEach((st, idx) => {
        st.index = idx;
        if (!st.id || /^step-\d+-/.test(st.id)) {
            st.id = `step-${String(idx + 1).padStart(2, '0')}-${st.op}`;
        }
    });
}

export function ensureBaselineSteps(chain = _chain) {
    if (!chain || !Array.isArray(chain.steps)) return false;
    const hasTileStep = chain.steps.some((s) => s && BASELINE_TILE_OPS.has(s.op));
    const hasGridStep = chain.steps.some((s) => s && BASELINE_GRID_OPS.has(s.op));
    if (hasTileStep || hasGridStep) return false;

    const enabledIds = captureEnabledTileIds();
    const enabledKeys = (appState.TILES || []).filter((t) => t && t.enabled).map((t) => t.key).filter(Boolean);
    const gx = appState.GRID_X || 3;
    const gy = appState.GRID_Y || 3;
    const gz = appState.GRID_Z || 4;
    const algo = appState.currentAlgorithm || 'wfc';
    const voxelGrid = captureCompactVoxelGrid();

    const baselineSteps = [
        {
            index: 0,
            id: 'step-01-tile_preset',
            op: 'tile_preset',
            label: 'Baseline Tiles',
            params: {
                enabledTileIds: enabledIds,
                enabledTiles: enabledKeys
            }
        },
        {
            index: 1,
            id: 'step-02-grid_config',
            op: 'grid_config',
            label: `Grid ${gx}×${gy}×${gz}`,
            params: {
                x: gx,
                y: gy,
                z: gz,
                voxelSize: Number(appState.VOXEL_SIZE || 1.0),
                algorithm: algo
            }
        },
        {
            index: 2,
            id: 'step-03-wfc_collapse',
            op: 'wfc_collapse',
            label: `WFC Topology (${gx}×${gy}×${gz})`,
            params: {
                algorithm: algo,
                grid: [gx, gy, gz],
                voxelGrid
            }
        }
    ];

    chain.steps = [...baselineSteps, ...chain.steps];
    reindexChainSteps(chain);
    chain.updatedAt = new Date().toISOString();
    return true;
}

export function recordStep(op, params = {}, opts = {}) {
    if (_isReplaying) return null;
    if (!SUPPORTED_STEP_OPS.includes(op)) return null;

    if (DOWNSTREAM_OPS.has(op)) {
        ensureBaselineSteps(_chain);
    }

    const cleanParams = (params && typeof params === 'object') ? { ...params } : {};
    if (op === 'wfc_collapse' && !Array.isArray(cleanParams.voxelGrid)) {
        const vg = captureCompactVoxelGrid();
        if (vg.length > 0) cleanParams.voxelGrid = vg;
    }

    if (opts.coalesce !== false && COALESCE_OPS.has(op) && _chain.steps.length > 0) {
        const prev = _chain.steps[_chain.steps.length - 1];
        if (prev && prev.op === op) {
            const allowCoalesce = op !== 'elastica_trace' || (
                Boolean(prev.params?.showUnrolled3D) === Boolean(cleanParams.showUnrolled3D) &&
                String(prev.params?.stageKind || 'trace') === String(cleanParams.stageKind || 'trace')
            );
            if (allowCoalesce) {
                prev.params = { ...(prev.params || {}), ...cleanParams };
                if (typeof opts.label === 'string' && opts.label.trim()) prev.label = opts.label.trim();
                if (typeof opts.bookmarkId === 'string' && opts.bookmarkId.trim()) prev.bookmarkId = opts.bookmarkId.trim();
                _chain.updatedAt = new Date().toISOString();
                notifyListeners('record');
                return prev;
            }
        }
    }

    const step = appendChainStep(_chain, {
        op,
        label: opts.label,
        params: cleanParams,
        id: opts.id,
        bookmarkId: opts.bookmarkId || viewport.activeBookmarkId || undefined,
        capture: opts.capture
    });
    _chain.bookmarks = exportBookmarks();
    notifyListeners('record');
    return step;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function sanitizeLocalFileName(name) {
    const base = String(name || 'asset.obj').replace(/\\/g, '/').split('/').pop() || 'asset.obj';
    return base.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^\.+/, '') || 'asset.obj';
}

export async function stageAssetToRepo(fileOrInfo) {
    let fileName = 'asset.obj';
    let payload = null;
    let ext = '';

    if (typeof File !== 'undefined' && fileOrInfo instanceof File) {
        fileName = fileOrInfo.name || 'asset.obj';
        ext = fileName.toLowerCase().includes('.') ? `.${fileName.toLowerCase().split('.').pop()}` : '';
        if (ext === '.obj' || ext === '.json' || ext === '.txt' || ext === '.svg') {
            const contentText = await fileOrInfo.text();
            payload = { fileName, contentText };
        } else {
            const buf = await fileOrInfo.arrayBuffer();
            payload = { fileName, contentBase64: arrayBufferToBase64(buf) };
        }
    } else if (fileOrInfo && typeof fileOrInfo === 'object') {
        fileName = fileOrInfo.fileName || fileOrInfo.originalName || 'asset.obj';
        ext = fileName.toLowerCase().includes('.') ? `.${fileName.toLowerCase().split('.').pop()}` : '';
        if (typeof fileOrInfo.contentText === 'string') {
            payload = { fileName, contentText: fileOrInfo.contentText };
        } else if (typeof fileOrInfo.contentBase64 === 'string') {
            payload = { fileName, contentBase64: fileOrInfo.contentBase64 };
        } else if (fileOrInfo.arrayBuffer instanceof ArrayBuffer) {
            payload = { fileName, contentBase64: arrayBufferToBase64(fileOrInfo.arrayBuffer) };
        }
    }

    const fallbackPath = normalizeRepoRelativePath(`TOPOGEN_FDM_Foundry/assets/inputs/${sanitizeLocalFileName(fileName)}`);
    if (!payload) {
        return { ok: false, staged: false, originalName: fileName, repoRelativePath: fallbackPath, ext };
    }

    try {
        const res = await fetch('/api/assets/stage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.ok && data.repoRelativePath) {
                const assetRecord = registerChainAsset(_chain, {
                    repoRelativePath: data.repoRelativePath,
                    originalName: fileName,
                    sha256Short: data.sha256Short || '',
                    bytes: data.bytes || 0,
                    ext: data.ext || ext
                });
                notifyListeners('asset');
                return { ok: true, staged: true, ...data, asset: assetRecord };
            }
        }
    } catch (err) {
        console.warn('[procedural_recorder] /api/assets/stage unavailable, using fallback path:', err?.message || err);
    }

    const assetRecord = registerChainAsset(_chain, {
        repoRelativePath: fallbackPath,
        originalName: fileName,
        ext
    });
    notifyListeners('asset');
    return { ok: false, staged: false, originalName: fileName, repoRelativePath: fallbackPath, ext, asset: assetRecord };
}

export function exportChain(opts = {}) {
    const chain = getChain();
    if (chain.steps.length > 0) {
        ensureBaselineSteps(chain);
    }
    const check = validateProceduralChain(chain);
    if (!check.ok) {
        console.warn('[procedural_recorder] Chain validation warnings/errors:', check.errors);
    }
    return serializeProceduralChain(chain, { pretty: opts.pretty !== false });
}

export function exportChainDownload(fileName = null) {
    const chain = getChain();
    if (chain.steps.length > 0) {
        ensureBaselineSteps(chain);
    }
    const jsonText = exportChain({ pretty: true });
    const safeName = fileName || `${chain.id || 'procedural_chain'}.chain.json`;
    downloadBlob(new Blob([jsonText], { type: 'application/json' }), safeName.endsWith('.json') ? safeName : `${safeName}.chain.json`);
    return { ok: true, fileName: safeName, bytes: jsonText.length };
}

export async function saveChainToRepo(chainObj = null, { fileName = null, target = 'chains' } = {}) {
    const targetChain = chainObj || getChain();
    if (targetChain.steps.length > 0) {
        ensureBaselineSteps(targetChain);
    }
    targetChain.bookmarks = exportBookmarks();
    const res = await fetch('/api/chains/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chain: targetChain,
            fileName: fileName || `${targetChain.id || 'chain'}.chain.json`,
            target
        })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Failed to save chain (${res.status}): ${text}`);
    }
    return await res.json();
}

export async function listRepoChains() {
    try {
        const res = await fetch('/api/chains');
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data?.chains) ? data.chains : [];
    } catch (err) {
        console.warn('[procedural_recorder] GET /api/chains unavailable:', err?.message || err);
        return [];
    }
}

export async function fetchRepoFile(repoRelativePath, { binary = false } = {}) {
    const norm = normalizeRepoRelativePath(repoRelativePath);
    const urls = [
        `/api/repo-file?path=${encodeURIComponent(norm)}`,
        `./${norm.replace(/^TOPOGEN_FDM_Foundry\//i, '')}`,
        `/${norm}`
    ];

    let lastErr = null;
    for (const url of urls) {
        try {
            const res = await fetch(url);
            if (!res.ok) {
                lastErr = new Error(`HTTP ${res.status} for ${url}`);
                continue;
            }
            if (binary) {
                const arrayBuffer = await res.arrayBuffer();
                return { repoRelativePath: norm, arrayBuffer, url };
            }
            const text = await res.text();
            return { repoRelativePath: norm, text, url };
        } catch (err) {
            lastErr = err;
        }
    }
    throw lastErr || new Error(`Could not fetch repo asset: ${norm}`);
}

export async function loadChainFromRepoPath(repoRelativePath) {
    const fetched = await fetchRepoFile(repoRelativePath, { binary: false });
    return await loadChain(fetched.text, { sourceLabel: repoRelativePath });
}

export async function loadChain(chainOrJson, opts = {}) {
    let parsed = null;
    if (typeof chainOrJson === 'string') {
        parsed = parseProceduralChain(chainOrJson);
    } else if (chainOrJson && typeof chainOrJson === 'object') {
        const check = validateProceduralChain(chainOrJson);
        if (!check.ok) {
            throw new Error(`Invalid procedural chain: ${check.errors.join('; ')}`);
        }
        parsed = JSON.parse(JSON.stringify(chainOrJson));
    } else {
        throw new Error('loadChain expects a JSON string or procedural chain object.');
    }

    if (Array.isArray(parsed.bookmarks) && parsed.bookmarks.length > 0) {
        mergeChainBookmarks(parsed.bookmarks);
    }

    _loadedAssets.clear();
    const assetPaths = new Map();
    for (const a of (parsed.assets || [])) {
        if (a && a.repoRelativePath) {
            const norm = normalizeRepoRelativePath(a.repoRelativePath);
            assetPaths.set(norm, {
                originalName: a.originalName || norm.split('/').pop(),
                ext: (a.ext || '').toLowerCase()
            });
        }
    }
    for (const st of (parsed.steps || [])) {
        const p = st?.params?.repoRelativePath;
        if (typeof p === 'string' && p.trim()) {
            const norm = normalizeRepoRelativePath(p);
            if (!assetPaths.has(norm)) {
                const base = norm.split('/').pop() || 'asset';
                const dot = base.lastIndexOf('.');
                assetPaths.set(norm, {
                    originalName: st.params.originalName || base,
                    ext: dot >= 0 ? base.slice(dot).toLowerCase() : ''
                });
            }
        }
    }

    const assetWarnings = [];
    for (const [normPath, info] of assetPaths.entries()) {
        const isBinary = info.ext === '.3dm';
        try {
            const loaded = await fetchRepoFile(normPath, { binary: isBinary });
            _loadedAssets.set(normPath, {
                ...info,
                repoRelativePath: normPath,
                text: loaded.text ?? null,
                arrayBuffer: loaded.arrayBuffer ?? null
            });
        } catch (err) {
            assetWarnings.push(`Could not pre-load ${normPath}: ${err.message}`);
        }
    }

    _loadedChain = parsed;
    _loadedSourceLabel = String(opts.sourceLabel || opts.fileName || parsed.name || parsed.id || '').trim();
    _stepCursor = 0;
    _currentStageIndex = -1;
    _lastCaptures = [];
    notifyListeners('load');

    return {
        ok: true,
        chain: parsed,
        sourceLabel: _loadedSourceLabel,
        stepCount: parsed.steps.length,
        assetCount: _loadedAssets.size,
        warnings: assetWarnings
    };
}

function waitForRenderSettle() {
    if (viewport.requestRender) viewport.requestRender(4);
    if (typeof requestAnimationFrame === 'function') {
        return new Promise((resolve) => {
            requestAnimationFrame(() => {
                if (viewport.requestRender) viewport.requestRender(2);
                requestAnimationFrame(() => resolve());
            });
        });
    }
    return new Promise((resolve) => setTimeout(resolve, 25));
}

function collectStageMetrics() {
    const solid = appState.lastSolidData;
    const graph = appState.lastWeldedGraph;
    const vertices = solid?.vertices?.length || graph?.vertices?.length || 0;
    const quads = solid?.quads?.length || 0;
    const tris = solid?.triangles?.length || 0;
    const edges = graph?.edges?.length || 0;
    const planarity = solid?.planarity || (solid?.vertices?.length && solid?.quads?.length
        ? CORE.computeMeshPlanarityStats(solid.vertices, solid.quads)
        : null);
    const maxPlanarityMm = planarity ? Number(((planarity.maxQuadPlanarityErrorM || 0) * 1000).toFixed(3)) : null;
    const watertight = solid?.verification ? Boolean(solid.verification.isWatertight) : null;
    const loops = appState.faceLoopState?.loops?.length || 0;
    return {
        vertices,
        quads,
        tris,
        edges,
        maxPlanarityMm,
        watertight,
        loops,
        grid: [appState.GRID_X, appState.GRID_Y, appState.GRID_Z]
    };
}

function findTileBySpecifier(spec) {
    if (spec === null || spec === undefined) return null;
    if (typeof spec === 'number') {
        return appState.TILES[Math.round(spec)] || null;
    }
    const raw = String(spec).trim().toLowerCase();
    if (!raw) return null;
    return appState.TILES.find((t) =>
        String(t.key || '').toLowerCase() === raw ||
        String(t.short || '').toLowerCase() === raw ||
        String(t.name || '').toLowerCase() === raw ||
        String(t.id) === raw
    ) || null;
}

function syncPqControlsFromState() {
    const ts = appState.tubeState;
    const setV = (id, v) => { const el = $(id); if (el) el.value = String(v); };
    const setC = (id, c) => { const el = $(id); if (el) el.checked = Boolean(c); };

    setV('rng-tube-radius', ts.radius);
    setV('rng-tube-inner-radius', ts.innerRadiusM);
    setV('rng-tube-sides', ts.nSides);
    setTxt('val-tube-sides', String(ts.nSides));
    setV('rng-tube-subdiv', ts.longitudinalSubdivLevels);
    setTxt('val-tube-subdiv', String(ts.longitudinalSubdivLevels));
    setV('rng-tube-offset', ts.endOffset);
    setTxt('val-tube-offset', `${ts.endOffset}m`);

    setC('chk-tube-bisector', ts.stitchAtBisectors);
    setC('chk-tube-miter-clamp', ts.miterClamp !== false);
    setC('chk-tube-pq', ts.pqOptimization);
    setC('chk-tube-cap-leaves', ts.capLeafEnds);
    setC('chk-tube-show', ts.show);

    $$('.tube-color-btn').forEach((b) => b.classList.toggle('seg-on', b.dataset.tubeColor === ts.colorMode));
    if (actions.syncTubeWallRadiiUI) actions.syncTubeWallRadiiUI();
}

function syncGridControlsFromState() {
    const setV = (id, v) => { const el = $(id); if (el) el.value = String(v); };
    setV('rng-grid-x', appState.GRID_X); setV('num-grid-x', appState.GRID_X);
    setV('rng-grid-y', appState.GRID_Y); setV('num-grid-y', appState.GRID_Y);
    setV('rng-grid-z', appState.GRID_Z); setV('num-grid-z', appState.GRID_Z);
    if (actions.syncVoxelAndEnvelopeUI) actions.syncVoxelAndEnvelopeUI();
}

function syncElasticaControlsFromState() {
    const st = appState.elasticaState;
    if (!st) return;
    const setV = (id, v) => { const el = $(id); if (el) el.value = String(v); };
    const setC = (id, c) => { const el = $(id); if (el) el.checked = Boolean(c); };
    setV('sel-elastica-pair-mode', st.pairMode);
    setV('sel-elastica-smooth-mode', st.smoothMode);
    setV('rng-elastica-subdiv', st.smoothLevel);
    setTxt('val-elastica-subdiv', `${st.smoothLevel} (PgUp)`);
    const tightPct = Math.round((Number(st.tightness) || 0) * 100);
    setV('rng-elastica-tightness', tightPct);
    setTxt('val-elastica-tightness', `${tightPct}%`);
    setV('rng-elastica-radius', st.rodRadius);
    setTxt('val-elastica-radius', `${st.rodRadius}m`);
    setV('rng-elastica-sides', st.rodSides);
    setTxt('val-elastica-sides', String(st.rodSides));
    setC('chk-elastica-show-leaves', st.showLeaves);
    setC('chk-elastica-show-skeletal', st.showSkeletalPaths);
    setC('chk-elastica-show-curves', st.showCurves);
    setC('chk-elastica-show-rods', st.showRods);
    setTxt('elastica-unroll-3d-state', st.showUnrolled3D ? 'ON' : 'OFF');
    const btnUnroll = $('btn-toggle-elastica-unroll-3d');
    if (btnUnroll) btnUnroll.classList.toggle('on', Boolean(st.showUnrolled3D));
    if (actions.updateElasticaSourceSinkUI) actions.updateElasticaSourceSinkUI();
}

export function buildStageUIOverlay(step, stageIndex = 0, stageCount = 1, bookmark = null) {
    const op = step?.op || '';
    const metricsObj = collectStageMetrics();
    const bmName = bookmark?.name || (viewport.activeBookmarkId ? (getBookmarkById(viewport.activeBookmarkId)?.name || viewport.activeBookmarkId) : 'Active View');
    const projection = bookmark?.projection || viewport.projectionMode || 'perspective';

    let tabTitle = 'Workbench';
    const params = [];
    const metrics = [];

    if (op === 'tile_preset' || op === 'tile_toggle' || op === 'tile_import') {
        tabTitle = '1. Tiles';
        const enabledNames = (appState.TILES || []).filter((t) => t.enabled).map((t) => t.short || t.name);
        params.push({ label: 'Active Tiles', value: enabledNames.slice(0, 6).join(', ') || 'None' });
        params.push({ label: 'Voxel Size', value: `${Number(appState.VOXEL_SIZE || 1).toFixed(2)} m` });
        params.push({ label: 'CC Subdiv', value: `n = ${appState.ccSubdivLevel ?? 0}` });
        if (step?.params?.repoRelativePath) {
            params.push({ label: 'Asset', value: step.params.repoRelativePath.split('/').pop() });
        }
        metrics.push(`${enabledNames.length} tiles active`);
    } else if (op === 'grid_config' || op === 'wfc_collapse') {
        tabTitle = '2. Topo Gen';
        params.push({ label: 'Voxel Grid', value: `${appState.GRID_X}×${appState.GRID_Y}×${appState.GRID_Z}` });
        params.push({ label: 'Algorithm', value: String(appState.currentAlgorithm || 'wfc').toUpperCase() });
        params.push({ label: 'Voxel Size', value: `${Number(appState.VOXEL_SIZE || 1).toFixed(2)} m` });
        if (metricsObj.vertices) metrics.push(`V:${metricsObj.vertices}`);
        if (metricsObj.edges) metrics.push(`E:${metricsObj.edges}`);
    } else if (op === 'fdm_config' || op === 'fdm_solve') {
        tabTitle = '3. FDM';
        const fs = appState.fdmState || {};
        params.push({ label: 'Mode', value: String(fs.mode || 'compression') });
        params.push({ label: 'q Profile', value: String(fs.qProfile || 'column_boosted') });
        params.push({ label: 'q Base', value: `${fs.qBase ?? 5}` });
        params.push({ label: 'Load Z', value: `${fs.loadZ ?? 500} N` });
        if (metricsObj.vertices) metrics.push(`V:${metricsObj.vertices}`);
        if (metricsObj.edges) metrics.push(`E:${metricsObj.edges}`);
    } else if (op.startsWith('pq_')) {
        tabTitle = '4. PQ Mesh';
        const ts = appState.tubeState || {};
        params.push({ label: 'Outer / Inner R', value: `${ts.radius}m / ${ts.innerRadiusM}m` });
        params.push({ label: 'Sides / Subdiv', value: `N=${ts.nSides} · L=${ts.longitudinalSubdivLevels}` });
        params.push({ label: 'Bisector', value: Boolean(ts.stitchAtBisectors), kind: 'bool' });
        params.push({ label: 'Miter Clamp', value: ts.miterClamp !== false, kind: 'bool' });
        params.push({ label: 'PQ Planarize', value: Boolean(ts.pqOptimization), kind: 'bool' });
        params.push({ label: 'Color Mode', value: String(ts.colorMode || 'longitudinal') });
        if (metricsObj.vertices) metrics.push(`V:${metricsObj.vertices}`);
        if (metricsObj.quads) metrics.push(`Q:${metricsObj.quads}`);
        if (metricsObj.maxPlanarityMm !== null) metrics.push(`PQ:${metricsObj.maxPlanarityMm}mm`);
        if (metricsObj.watertight) metrics.push('Watertight');
    } else if (op === 'elastica_trace') {
        tabTitle = '5. Elastica';
        const es = appState.elasticaState || {};
        const ed = appState.lastElasticaData;
        params.push({ label: 'Pair Mode', value: String(es.pairMode || 'all_pairs') });
        params.push({ label: 'Solver', value: String(es.smoothMode || 'der_inextensible') });
        params.push({ label: 'Smooth / Tight', value: `L=${es.smoothLevel ?? 2} · ${Math.round((es.tightness ?? 0.5) * 100)}%` });
        params.push({ label: 'Rod R / Sides', value: `${es.rodRadius}m · ${es.rodSides}s` });
        params.push({ label: 'Unroll 3D', value: Boolean(es.showUnrolled3D), kind: 'bool' });
        if (ed && Array.isArray(ed.curves)) {
            const totalL = ed.curves.reduce((acc, c) => acc + (c.totalLength || 0), 0);
            metrics.push(`${ed.curves.length} Rods`);
            metrics.push(`ΣL=${totalL.toFixed(2)}m`);
        }
    } else if (op === 'fea_run') {
        tabTitle = '6. FEA';
        const fe = appState.feaState || {};
        params.push({ label: 'Material', value: String(fe.materialKey || 'plaster') });
        params.push({ label: 'Top Load', value: `${fe.topLoadKg ?? 25} kg` });
        params.push({ label: 'Supports', value: String(fe.restraintType || 'pinned') });
        params.push({ label: 'Elastica', value: Boolean(fe.includeElastica), kind: 'bool' });
        if (metricsObj.vertices) metrics.push(`V:${metricsObj.vertices}`);
    } else {
        tabTitle = 'Viewport Camera';
        params.push({ label: 'Bookmark', value: bmName });
        params.push({ label: 'Projection', value: projection });
        params.push({ label: 'Grid', value: `${appState.GRID_X}×${appState.GRID_Y}×${appState.GRID_Z}` });
        if (metricsObj.quads) metrics.push(`Q:${metricsObj.quads}`);
    }

    return {
        tabTitle,
        stageIndex,
        stageCount,
        stageLabel: step?.label || op || `Stage ${stageIndex + 1}`,
        op,
        params,
        metrics,
        projection,
        cameraName: bmName
    };
}

function resetWorkbenchForReplay() {
    // Reset tiles to clean built-in catalog
    const baseTiles = CORE.createTileTemplates();
    appState.TILES = baseTiles;
    appState.TILES.forEach((t, idx) => { t.id = idx; });
    appState.inspectedTileId = CORE.TILE_CROSS;
    appState.loadedFileNetworkGraph = null;
    appState.currentAlgorithm = 'wfc';
    appState.GRID_X = 3;
    appState.GRID_Y = 3;
    appState.GRID_Z = 4;
    appState.VOXEL_SIZE = 1.0;
    appState.GRID_ORIGIN.set(-1.5, -1.5, 0);
    appState.ccSubdivLevel = 1;
    appState.skeletonizeMeshTile = false;

    if (appState.elasticaSourceSet) appState.elasticaSourceSet.clear();
    if (appState.elasticaSinkSet) appState.elasticaSinkSet.clear();
    appState.lastElasticaData = null;
    if (appState.elasticaState) appState.elasticaState.showUnrolled3D = false;
    if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
    if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;

    if (actions.clearVoxelPins) actions.clearVoxelPins({ redraw: false });
    if (actions.clearUserImportedMeshes) actions.clearUserImportedMeshes();
    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();

    Object.assign(appState.tubeState, TUBE_DEFAULTS);
    appState.faceLoopState.showUnrolled3D = false;
    syncPqControlsFromState();
    syncGridControlsFromState();
    syncElasticaControlsFromState();

    if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
    if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
    if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
}

function restoreActiveTabInPlace(savedTabId) {
    if (!savedTabId) return;
    if (appState.activeTabId !== savedTabId) {
        appState.activeTabId = savedTabId;
    }
    if (typeof document === 'undefined') return;
    $$('.ui-tab').forEach((b) => {
        const active = b.dataset.tab === savedTabId;
        b.classList.toggle('border-pink-500', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('bg-gray-800/70', active);
        b.classList.toggle('border-transparent', !active);
        b.classList.toggle('text-gray-400', !active);
    });
    $$('.tab-pane').forEach((pane) => {
        pane.classList.toggle('hidden', pane.id !== savedTabId);
    });
}

async function executeStep(step, chain, savedTabId = appState.activeTabId, cameraMode = 'stage') {
    const op = step.op;
    const p = step.params || {};

    switch (op) {
        case 'tile_preset': {
            if (Array.isArray(p.enabledTileIds) && p.enabledTileIds.length > 0) {
                const idSet = new Set(p.enabledTileIds.map((v) => Number(v)));
                for (const t of appState.TILES) {
                    t.enabled = idSet.has(t.id);
                }
                if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate();
                if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
                if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            } else if (Array.isArray(p.enabledTiles) || Array.isArray(p.enabledKeys)) {
                const list = (p.enabledTiles || p.enabledKeys).map((v) => String(v).toLowerCase());
                const set = new Set(list);
                for (const t of appState.TILES) {
                    t.enabled = set.has(String(t.key || '').toLowerCase()) ||
                        set.has(String(t.short || '').toLowerCase()) ||
                        set.has(String(t.name || '').toLowerCase()) ||
                        set.has(String(t.id));
                }
                if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate();
                if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
                if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            } else if (p.preset === 'all_on') {
                appState.TILES.forEach((t, idx) => { t.enabled = idx > 0; });
                if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate();
                if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
                if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            } else if (p.preset === 'default_ortho' || p.preset === 'ortho') {
                appState.TILES.forEach((t, idx) => { t.enabled = (idx >= 0 && idx <= 3); });
                if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate();
                if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
                if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            } else if (typeof p.preset === 'string' && actions.applyTilePresetUI) {
                actions.applyTilePresetUI(p.preset, { keepCamera: true });
            }
            if (p.inspectedTile !== undefined) {
                const t = findTileBySpecifier(p.inspectedTile);
                if (t) appState.inspectedTileId = t.id;
            }
            if (actions.draw) actions.draw();
            break;
        }

        case 'tile_toggle': {
            let lastToggled = null;
            if (Array.isArray(p.tiles)) {
                for (const item of p.tiles) {
                    const t = findTileBySpecifier(item.tileKey ?? item.key ?? item.tileId ?? item.id ?? item.tileName ?? item.name);
                    if (t) {
                        t.enabled = item.enabled !== undefined ? Boolean(item.enabled) : !t.enabled;
                        lastToggled = t;
                    }
                }
            } else {
                const spec = p.tileKey ?? p.key ?? p.tileId ?? p.id ?? p.tileName ?? p.name ?? p.tile;
                const t = findTileBySpecifier(spec);
                if (t) {
                    t.enabled = p.enabled !== undefined ? Boolean(p.enabled) : !t.enabled;
                    appState.inspectedTileId = t.id;
                    lastToggled = t;
                }
            }
            if (!appState.TILES.some((t) => t.enabled) && appState.TILES[CORE.TILE_CROSS]) {
                appState.TILES[CORE.TILE_CROSS].enabled = true;
            }
            if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
            if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
            if (actions.collapseFullGridImmediate) {
                const seedId = (lastToggled && lastToggled.enabled && lastToggled.id !== CORE.TILE_NULL) ? lastToggled.id : null;
                actions.collapseFullGridImmediate(seedId);
            }
            if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
            if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            if (actions.draw) actions.draw();
            break;
        }

        case 'tile_import': {
            let repoPath = p.repoRelativePath;
            if (!repoPath && p.assetId && Array.isArray(chain?.assets)) {
                const found = chain.assets.find((a) => a.id === p.assetId);
                if (found) repoPath = found.repoRelativePath;
            }
            if (!repoPath) throw new Error('tile_import step missing repoRelativePath / assetId');
            const normPath = normalizeRepoRelativePath(repoPath);
            const fileName = p.originalName || normPath.split('/').pop() || 'tile.obj';
            const ext = fileName.toLowerCase().split('.').pop();

            let cached = _loadedAssets.get(normPath);
            if (!cached) {
                const fetched = await fetchRepoFile(normPath, { binary: ext === '3dm' });
                cached = {
                    repoRelativePath: normPath,
                    originalName: fileName,
                    ext: `.${ext}`,
                    text: fetched.text ?? null,
                    arrayBuffer: fetched.arrayBuffer ?? null
                };
                _loadedAssets.set(normPath, cached);
            }

            if (ext === '3dm' && appState.rhinoReady) {
                await appState.rhinoReady;
            }

            const ccLevel = p.ccLevel ?? p.subDiv ?? (p.meshOnly || p.target === 'mesh_tile' ? 0 : 1);
            const normalize = p.normalize !== undefined ? Boolean(p.normalize) : (p.fitToVoxel !== false);
            const skeletonize = Boolean(p.skeletonize);
            const meshOnly = Boolean(p.meshOnly || p.target === 'mesh_tile');
            const customOnly = p.customOnly !== undefined ? Boolean(p.customOnly) : (p.disableBuiltins !== false);

            let parsedModules = [];
            let lastImportedTile = null;
            if (ext === 'obj' && cached.text && actions.parseOBJMeshes) {
                parsedModules = actions.parseOBJMeshes(cached.text, fileName);
            } else if (ext === '3dm' && cached.arrayBuffer && actions.parse3dmMeshes) {
                parsedModules = actions.parse3dmMeshes(cached.arrayBuffer, fileName);
                if (parsedModules.length === 0 && actions.parse3dmCurvesAsGraph && actions.importCurveModuleFromData) {
                    const crvMod = actions.parse3dmCurvesAsGraph(cached.arrayBuffer, fileName);
                    if (crvMod) {
                        lastImportedTile = actions.importCurveModuleFromData(crvMod.name, crvMod.verts, crvMod.edges, { normalize });
                    }
                }
            }

            if (actions.importMeshModuleFromData) {
                for (const mod of parsedModules) {
                    const tile = actions.importMeshModuleFromData(mod.name, mod.verts, mod.faces, {
                        ccLevel,
                        normalize,
                        skeletonize,
                        meshOnly
                    });
                    if (tile) lastImportedTile = tile;
                }
            }

            if (lastImportedTile) {
                if (customOnly) {
                    appState.TILES.forEach((t) => { if (!t.isCustomGraph) t.enabled = false; });
                }
                appState.inspectedTileId = lastImportedTile.id;
                appState.showCenterlineGraph = true;
                appState.showQuadMeshes = true;
                appState.groupVis.graph = true;
                appState.groupVis.meshes = true;
                if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(lastImportedTile.id);
                if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
                if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
                if (actions.draw) actions.draw();
            }
            break;
        }

        case 'grid_config': {
            const nx = p.x ?? p.nx ?? p.grid?.[0] ?? appState.GRID_X;
            const ny = p.y ?? p.ny ?? p.grid?.[1] ?? appState.GRID_Y;
            const nz = p.z ?? p.nz ?? p.grid?.[2] ?? appState.GRID_Z;
            const algo = p.algorithm || p.mode;
            if (algo === 'wfc' || algo === 'growth') {
                appState.currentAlgorithm = algo;
            }
            if (Number.isFinite(Number(p.voxelSize ?? p.voxelSizeM))) {
                appState.VOXEL_SIZE = Math.max(0.05, Math.min(20.0, Number(p.voxelSize ?? p.voxelSizeM)));
            }
            if (actions.setGridResolution) {
                actions.setGridResolution(nx, ny, nz, { collapseAll: p.collapseAll !== false, zoom: false });
            } else {
                appState.GRID_X = nx;
                appState.GRID_Y = ny;
                appState.GRID_Z = nz;
                if (actions.setup) actions.setup({ collapseAll: p.collapseAll !== false });
                if (actions.draw) actions.draw();
            }
            syncGridControlsFromState();
            break;
        }

        case 'wfc_collapse': {
            const algo = p.algorithm || p.mode;
            if (algo === 'wfc' || algo === 'growth') {
                appState.currentAlgorithm = algo;
            }
            if (Array.isArray(p.grid) && p.grid.length === 3) {
                const [gx, gy, gz] = p.grid.map((n) => Math.max(1, Math.min(20, Math.round(Number(n) || 1))));
                if (gx !== appState.GRID_X || gy !== appState.GRID_Y || gz !== appState.GRID_Z) {
                    appState.GRID_X = gx;
                    appState.GRID_Y = gy;
                    appState.GRID_Z = gz;
                    appState.GRID_ORIGIN.set(-(gx * appState.VOXEL_SIZE) * 0.5, -(gy * appState.VOXEL_SIZE) * 0.5, 0);
                    syncGridControlsFromState();
                }
            }
            if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
            const expectedCount = appState.GRID_X * appState.GRID_Y * appState.GRID_Z;
            if (Array.isArray(p.voxelGrid) && p.voxelGrid.length === expectedCount) {
                if (actions.setup) actions.setup({ collapseAll: false });
                const nTiles = appState.TILES.length;
                for (let idx = 0; idx < expectedCount; idx++) {
                    const cell = appState.voxels[idx];
                    if (!cell) continue;
                    const rawTile = Number(p.voxelGrid[idx]);
                    const tileId = (Number.isInteger(rawTile) && rawTile >= 0 && rawTile < nTiles) ? rawTile : CORE.TILE_NULL;
                    cell.collapsed = true;
                    cell.tile = tileId;
                    cell.domain = Array(nTiles).fill(false);
                    cell.domain[tileId] = true;
                    cell.inFrontier = false;
                }
                appState.simRunning = false;
                appState.simStepCount = expectedCount;
            } else if (actions.collapseFullGridImmediate) {
                const seedTile = p.seedTile !== undefined ? findTileBySpecifier(p.seedTile)?.id ?? null : null;
                actions.collapseFullGridImmediate(seedTile);
            }
            if (actions.draw) actions.draw();
            if (actions.refreshHostGraph) actions.refreshHostGraph({ preserveFixed: false });
            break;
        }

        case 'pq_config': {
            const ts = appState.tubeState;
            const outerR = p.outerR ?? p.radius ?? p.outerRadiusM;
            const innerR = p.innerR ?? p.innerRadiusM;
            const sides = p.sides ?? p.nSides;
            const subdivL = p.subdivL ?? p.longitudinalSubdivLevels;
            const bisector = p.bisector ?? p.stitchAtBisectors;
            const miterClamp = p.miterClamp;
            const planarize = p.planarize ?? p.pqOptimization;
            const caps = p.caps ?? p.capLeafEnds;

            if (outerR !== undefined) ts.radius = Number(outerR);
            if (innerR !== undefined) ts.innerRadiusM = Number(innerR);
            if (sides !== undefined) ts.nSides = Math.round(Number(sides));
            if (subdivL !== undefined) ts.longitudinalSubdivLevels = Math.round(Number(subdivL));
            if (bisector !== undefined) ts.stitchAtBisectors = Boolean(bisector);
            if (miterClamp !== undefined) ts.miterClamp = Boolean(miterClamp);
            if (planarize !== undefined) ts.pqOptimization = Boolean(planarize);
            if (caps !== undefined) ts.capLeafEnds = Boolean(caps);
            if (p.show !== undefined) ts.show = Boolean(p.show);
            if (typeof p.colorMode === 'string') ts.colorMode = p.colorMode;

            syncPqControlsFromState();
            break;
        }

        case 'pq_solidify': {
            if (actions.solidifyActiveGraph) {
                actions.solidifyActiveGraph({ keepCamera: true });
            }
            if (typeof p.colorMode === 'string' && actions.setTubeColorMode) {
                actions.setTubeColorMode(p.colorMode);
            }
            break;
        }

        case 'pq_subdiv_ring': {
            const levels = Math.max(1, Math.round(Number(p.levels ?? p.iterations ?? 1)));
            for (let k = 0; k < levels; k++) {
                if (actions.applyRingSubdivPQFromUI) actions.applyRingSubdivPQFromUI();
            }
            break;
        }

        case 'pq_subdiv_long': {
            const levels = Math.max(1, Math.round(Number(p.levels ?? p.iterations ?? 1)));
            for (let k = 0; k < levels; k++) {
                if (actions.applyLongitudinalSubdivPQFromUI) actions.applyLongitudinalSubdivPQFromUI();
            }
            break;
        }

        case 'pq_subdiv_cc': {
            const levels = Math.max(1, Math.round(Number(p.levels ?? p.iterations ?? 1)));
            for (let k = 0; k < levels; k++) {
                if (actions.applyCatmullClarkSubdivPQFromUI) actions.applyCatmullClarkSubdivPQFromUI();
            }
            break;
        }

        case 'pq_optimize': {
            if (actions.applyOnlyPQOptimizationFromUI) actions.applyOnlyPQOptimizationFromUI();
            break;
        }

        case 'pq_swap_long_ring': {
            if (actions.swapPqLongRing) actions.swapPqLongRing();
            break;
        }

        case 'fdm_config': {
            const fs = appState.fdmState;
            if (p.mode) fs.mode = p.mode;
            if (p.qProfile) fs.qProfile = p.qProfile;
            if (p.qBase !== undefined) fs.qBase = Number(p.qBase);
            if (p.columnBoost !== undefined) fs.columnBoost = Number(p.columnBoost);
            if (p.loadZ !== undefined) fs.loadZ = Number(p.loadZ);
            if (p.maxAnchors !== undefined) fs.maxAnchors = Math.round(Number(p.maxAnchors));
            if (p.pruneLeaves !== undefined) fs.pruneLeaves = Boolean(p.pruneLeaves);
            if (p.triggerOnHost !== undefined) fs.triggerOnHost = Boolean(p.triggerOnHost);
            break;
        }

        case 'fdm_solve': {
            if (actions.runFDMOnActiveGraph) {
                actions.runFDMOnActiveGraph({ keepCamera: true });
            }
            break;
        }

        case 'elastica_trace': {
            const st = appState.elasticaState;
            if (st) {
                if (p.pairMode) st.pairMode = p.pairMode;
                if (p.smoothMode) st.smoothMode = p.smoothMode;
                if (p.inextensible !== undefined) st.inextensible = Boolean(p.inextensible);
                if (p.smoothLevel !== undefined) st.smoothLevel = Math.round(Number(p.smoothLevel));
                if (p.tightness !== undefined) st.tightness = Number(p.tightness);
                if (p.rodRadius !== undefined) st.rodRadius = Number(p.rodRadius);
                if (p.rodSides !== undefined) st.rodSides = Math.round(Number(p.rodSides));
                if (p.showLeaves !== undefined) st.showLeaves = Boolean(p.showLeaves);
                if (p.showSkeletalPaths !== undefined) st.showSkeletalPaths = Boolean(p.showSkeletalPaths);
                if (p.showCurves !== undefined) st.showCurves = Boolean(p.showCurves);
                if (p.showRods !== undefined) st.showRods = Boolean(p.showRods);
                if (p.showGuideTube !== undefined) st.showGuideTube = Boolean(p.showGuideTube);
                if (p.showUnrolled3D !== undefined) st.showUnrolled3D = Boolean(p.showUnrolled3D);
            }
            if (Array.isArray(p.sourceNodes) && appState.elasticaSourceSet) {
                appState.elasticaSourceSet.clear();
                for (const idx of p.sourceNodes) {
                    const n = Number(idx);
                    if (Number.isInteger(n) && n >= 0) appState.elasticaSourceSet.add(n);
                }
            }
            if (Array.isArray(p.sinkNodes) && appState.elasticaSinkSet) {
                appState.elasticaSinkSet.clear();
                for (const idx of p.sinkNodes) {
                    const n = Number(idx);
                    if (Number.isInteger(n) && n >= 0) appState.elasticaSinkSet.add(n);
                }
            }
            syncElasticaControlsFromState();
            if (!appState.lastHostGraph && !appState.lastFDMResult && actions.refreshHostGraph) {
                actions.refreshHostGraph({ preserveFixed: true });
            }
            if (actions.generateElasticaFromUI) actions.generateElasticaFromUI();
            if (p.showUnrolled3D && actions.toggleElasticaUnroll3DFromUI) {
                actions.toggleElasticaUnroll3DFromUI(true);
            }
            break;
        }

        case 'fea_run': {
            if (p.materialKey) appState.feaState.materialKey = p.materialKey;
            if (p.topLoadKg !== undefined) appState.feaState.topLoadKg = Number(p.topLoadKg);
            if (p.restraintType) appState.feaState.restraintType = p.restraintType;
            if (actions.runSpaceFrameFEAFromUI) actions.runSpaceFrameFEAFromUI({ expandHud: false });
            break;
        }

        case 'camera_bookmark': {
            if (cameraMode === 'active') break;
            const bmSpec = p.bookmarkId || step.bookmarkId || p.bookmark;
            if (bmSpec && viewport.applyCameraBookmark) {
                const resolved = typeof bmSpec === 'string'
                    ? (getBookmarkById(bmSpec) || (chain?.bookmarks || []).find((b) => b.id === bmSpec) || bmSpec)
                    : bmSpec;
                viewport.applyCameraBookmark(resolved, { animate: false });
            }
            break;
        }

        default:
            break;
    }

    // Strictly preserve the user's active tab during replay
    restoreActiveTabInPlace(savedTabId);
    recomputeModelBox();
    applyOutlinerVisibility();
    // Ensure stage-specific groups remain visible even while locked to Tab 7 (I/O)
    if (op === 'elastica_trace') {
        if (viewport.meshGroup) viewport.meshGroup.visible = false;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = true;
        if (viewport.elasticaUnroll3DGroup) {
            viewport.elasticaUnroll3DGroup.visible = Boolean(appState.elasticaState?.showUnrolled3D && viewport.elasticaUnroll3DGroup.children.length > 0);
        }
    } else if (op === 'fea_run' && appState.lastFEAResult) {
        if (viewport.feaGroup) viewport.feaGroup.visible = true;
    }
    refreshOutliner();

    // Respect cameraMode === 'active' override: never move/zoom camera when user chose Active View
    if (cameraMode !== 'active') {
        if (op !== 'camera_bookmark' && step.bookmarkId && viewport.applyCameraBookmark) {
            const bm = getBookmarkById(step.bookmarkId) || (chain?.bookmarks || []).find((b) => b.id === step.bookmarkId);
            if (bm) viewport.applyCameraBookmark(bm, { animate: false });
        } else if (op === 'wfc_collapse' || op === 'tile_import' || op === 'grid_config') {
            zoomToBox(modelBoxToWorld(appState.modelBox));
        }
    }
}

async function saveCaptureToServer({ chainId, stageFile, dataUrl, manifest, manifestFile }) {
    try {
        const res = await fetch('/api/captures/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chainId, stageFile, dataUrl, manifest, manifestFile })
        });
        if (res.ok) {
            const data = await res.json();
            if (data && data.ok) return data;
        }
    } catch (err) {
        console.warn('[procedural_recorder] /api/captures/save unavailable:', err?.message || err);
    }
    return null;
}

function resolveBookmarkForCapture(idOrObj, chain) {
    if (!idOrObj) return null;
    if (typeof idOrObj === 'object') return idOrObj;
    return getBookmarkById(idOrObj) ||
        (chain?.bookmarks || []).find((b) => b.id === idOrObj) ||
        DEFAULT_CAMERA_BOOKMARKS.find((b) => b.id === idOrObj) ||
        null;
}

export async function playChain(chainObj = null, options = {}) {
    const {
        startIndex = 0,
        endIndex = undefined,
        captureStages = false,
        captureWidth = 1920,
        captureHeight = 1080,
        bookmarkIds = [],
        cameraMode = _playbackCameraMode,
        useStageBookmark = undefined,
        includeStageUI = false,
        saveCapturesToRepo = true,
        downloadFallback = false,
        onStage = null
    } = options;

    const effectiveCameraMode = (cameraMode === 'active' || cameraMode === 'defaults') ? cameraMode : 'stage';
    const effectiveUseStageBookmark = useStageBookmark !== undefined
        ? Boolean(useStageBookmark)
        : (effectiveCameraMode !== 'active');

    let activeChain = _loadedChain || getChain();
    if (chainObj) {
        const loaded = await loadChain(chainObj);
        activeChain = loaded.chain;
    }

    const steps = Array.isArray(activeChain?.steps) ? activeChain.steps : [];
    if (steps.length === 0) {
        return { ok: true, chainId: activeChain?.id || 'empty', stepsExecuted: 0, captures: [] };
    }

    const fromIdx = Math.max(0, Math.min(steps.length - 1, Math.round(Number(startIndex) || 0)));
    const toIdx = endIndex === undefined
        ? steps.length - 1
        : Math.max(fromIdx, Math.min(steps.length - 1, Math.round(Number(endIndex))));

    const captures = [];
    const manifestStages = [];
    const savedTabId = appState.activeTabId;
    _isReplaying = true;
    notifyListeners('play_start');

    try {
        if (fromIdx === 0) {
            resetWorkbenchForReplay();
            restoreActiveTabInPlace(savedTabId);
            await waitForRenderSettle();
        }

        for (let i = fromIdx; i <= toIdx; i++) {
            const step = steps[i];
            await executeStep(step, activeChain, savedTabId, effectiveCameraMode);
            await waitForRenderSettle();
            _currentStageIndex = i;
            _stepCursor = i + 1;

            const metrics = collectStageMetrics();
            const stageCaptures = [];

            if (captureStages && typeof viewport.captureHighResPNG === 'function') {
                let targetBookmarks = [];
                if (effectiveCameraMode === 'active') {
                    targetBookmarks = [null];
                } else if (Array.isArray(bookmarkIds) && bookmarkIds.length > 0) {
                    targetBookmarks = bookmarkIds
                        .map((id) => resolveBookmarkForCapture(id, activeChain))
                        .filter(Boolean);
                } else if (effectiveCameraMode === 'defaults') {
                    targetBookmarks = getDefaultBookmarks();
                } else if (effectiveUseStageBookmark && step.bookmarkId) {
                    const bm = resolveBookmarkForCapture(step.bookmarkId, activeChain);
                    targetBookmarks = [bm];
                }
                if (targetBookmarks.length === 0) targetBookmarks = [null];

                for (let bi = 0; bi < targetBookmarks.length; bi++) {
                    const bm = targetBookmarks[bi];
                    const uiOverlay = includeStageUI ? buildStageUIOverlay(step, i, steps.length, bm) : null;
                    const dataUrl = viewport.captureHighResPNG({
                        width: captureWidth,
                        height: captureHeight,
                        bookmark: bm,
                        uiOverlay
                    });
                    const safeOp = String(step.op || 'stage').replace(/[^a-z0-9_-]+/gi, '_');
                    const bmSuffix = bm && bm.id ? `_${String(bm.id).replace(/[^a-z0-9_-]+/gi, '_')}` : '';
                    const stageFile = `${String(i + 1).padStart(2, '0')}_${safeOp}${bmSuffix}.png`;

                    const capEntry = {
                        stepIndex: i,
                        stepId: step.id,
                        op: step.op,
                        label: step.label || step.op,
                        bookmarkId: bm?.id || viewport.activeBookmarkId || 'active',
                        bookmarkName: bm?.name || 'Active View',
                        width: captureWidth,
                        height: captureHeight,
                        stageFile,
                        dataUrl,
                        repoRelativePath: null,
                        metrics,
                        uiState: uiOverlay || undefined
                    };

                    const isLastCaptureOverall = (i === toIdx && bi === targetBookmarks.length - 1);
                    manifestStages.push({
                        stepIndex: i,
                        stepId: step.id,
                        op: step.op,
                        label: capEntry.label,
                        bookmarkId: capEntry.bookmarkId,
                        bookmarkName: capEntry.bookmarkName,
                        stageFile,
                        width: captureWidth,
                        height: captureHeight,
                        metrics,
                        uiState: uiOverlay || undefined
                    });

                    if (saveCapturesToRepo) {
                        const saved = await saveCaptureToServer({
                            chainId: activeChain.id || 'chain',
                            stageFile,
                            dataUrl,
                            manifest: isLastCaptureOverall ? {
                                schema: CHAIN_SCHEMA_VERSION,
                                chainId: activeChain.id || 'chain',
                                chainName: activeChain.name || 'Procedural Chain',
                                capturedAt: new Date().toISOString(),
                                width: captureWidth,
                                height: captureHeight,
                                stageCount: manifestStages.length,
                                stages: manifestStages
                            } : undefined,
                            manifestFile: isLastCaptureOverall ? 'manifest.json' : undefined
                        });
                        if (saved && saved.repoRelativePath) {
                            capEntry.repoRelativePath = saved.repoRelativePath;
                        } else if (downloadFallback && dataUrl) {
                            const a = document.createElement('a');
                            a.href = dataUrl;
                            a.download = stageFile;
                            a.click();
                        }
                    } else if (downloadFallback && dataUrl) {
                        const a = document.createElement('a');
                        a.href = dataUrl;
                        a.download = stageFile;
                        a.click();
                    }

                    stageCaptures.push(capEntry);
                    captures.push(capEntry);
                }
            }

            notifyListeners('stage', { stageIndex: i, step, metrics });
            if (typeof onStage === 'function') {
                onStage({
                    index: i,
                    total: steps.length,
                    step,
                    metrics,
                    captures: stageCaptures
                });
            }
        }
    } finally {
        restoreActiveTabInPlace(savedTabId);
        _isReplaying = false;
    }

    _lastCaptures = captures;
    notifyListeners('play_complete');

    return {
        ok: true,
        chainId: activeChain.id,
        chainName: activeChain.name,
        stepsExecuted: toIdx - fromIdx + 1,
        activeStageIndex: _currentStageIndex,
        captures
    };
}

export async function jumpToStage(targetIndex, options = {}) {
    const activeChain = _loadedChain || getChain();
    const steps = Array.isArray(activeChain?.steps) ? activeChain.steps : [];
    if (steps.length === 0) return { ok: false, message: 'No steps in chain.' };

    const clamped = Math.max(0, Math.min(steps.length - 1, Math.round(Number(targetIndex) || 0)));
    const startIndex = (_currentStageIndex < 0 || clamped <= _currentStageIndex)
        ? 0
        : _currentStageIndex + 1;

    const res = await playChain(null, {
        ...options,
        startIndex,
        endIndex: clamped
    });
    return {
        ...res,
        stepIndex: clamped,
        step: steps[clamped],
        done: clamped >= steps.length - 1
    };
}

export async function stepNextChain(options = {}) {
    const activeChain = _loadedChain || getChain();
    const steps = Array.isArray(activeChain?.steps) ? activeChain.steps : [];
    if (steps.length === 0) return { ok: false, done: true, message: 'No steps in chain.' };

    if (_stepCursor >= steps.length) {
        _stepCursor = 0;
        _currentStageIndex = -1;
    }
    const idx = _stepCursor;
    const res = await playChain(null, {
        ...options,
        startIndex: idx,
        endIndex: idx
    });
    return {
        ...res,
        stepIndex: idx,
        step: steps[idx],
        done: _stepCursor >= steps.length
    };
}

export function initProceduralRecorder() {
    actions.recordChainStep = recordStep;
    actions.stageChainAsset = stageAssetToRepo;
    actions.onCameraBookmarkSelected = (bm) => {
        if (!bm || _isReplaying) return;
        recordStep('camera_bookmark', {
            bookmarkId: bm.id,
            name: bm.name,
            projection: bm.projection
        }, {
            label: `Camera: ${bm.name || bm.id}`,
            bookmarkId: bm.id
        });
    };
    return {
        getChain,
        getLoadedChain,
        getActiveStageIndex,
        getLoadedSourceLabel,
        clearChain,
        recordStep,
        stageAssetToRepo,
        exportChain,
        exportChainDownload,
        saveChainToRepo,
        listRepoChains,
        loadChain,
        loadChainFromRepoPath,
        playChain,
        jumpToStage,
        stepNextChain,
        getLastCaptures,
        onChainChange
    };
}

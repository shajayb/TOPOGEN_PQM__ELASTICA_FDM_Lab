/**
 * WFC·FDM Foundry — Shared Launcher State, Event Bus, rAF Scheduler & Core Loader
 *
 * Inputs / Outputs:
 *   - Exports mutable `appState` shared across Tabs 1–4, 3D Viewport, and Verdict HUD.
 *   - Exports `API_BASE` auto-detected for `foundry_server.mjs` (:8787) or static servers.
 *   - Exports `loadWfcCore()` which dynamically imports `../core/index.mjs` directly
 *     (zero 844 KB HTML regex fetch!).
 *   - Exports `scheduleUIUpdate(flag, renderFn)` using `requestAnimationFrame` coalescing
 *     so 50+ SSE candidate evaluations arriving in <2s render smoothly at 60 FPS.
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

export const API_BASE =
    typeof window !== 'undefined' &&
    window.location.protocol.startsWith('http') &&
    window.location.host
        ? ''
        : 'http://127.0.0.1:8787';

export const DEFAULT_PRESETS = [
    'pilot_champion',
    'catenary_quadripod',
    'funicular_vault',
    'slender_diagrid',
    'hyperboloid_tower',
    'arch_braced',
    'diagrid_tower',
    'space_frame',
    'funnel_vault',
    'minimal_frame',
    'default_ortho',
];

export const MATERIAL_PRESETS = {
    plaster: {
        name: 'Standard Cast Gypsum Plaster (Plaster of Paris / Hydrocal)',
        densityKgM3: 1250,
        youngsModulusPa: 5.0e9,
        poissonsRatio: 0.24,
        compressiveStrengthPa: 12.0e6,
        tensileStrengthPa: 2.0e6,
        shearStrengthPa: 1.5e6,
    },
    gfrg: {
        name: 'Glass-Fiber Reinforced Gypsum (GFRG)',
        densityKgM3: 1450,
        youngsModulusPa: 8.5e9,
        poissonsRatio: 0.23,
        compressiveStrengthPa: 24.0e6,
        tensileStrengthPa: 6.5e6,
        shearStrengthPa: 4.0e6,
    },
    timber: {
        name: 'Structural Birch / Spruce Timber Dowel',
        densityKgM3: 620,
        youngsModulusPa: 11.0e9,
        poissonsRatio: 0.30,
        compressiveStrengthPa: 38.0e6,
        tensileStrengthPa: 45.0e6,
        shearStrengthPa: 6.0e6,
    },
};

export const SPEED_PROFILES = {
    lightning: {
        id: 'lightning',
        label: '⚡ Lightning',
        sub: '~1.5s · 10 cands',
        concurrency: 8,
        maxRounds: 1,
        candidatesPerRound: 10,
    },
    interactive: {
        id: 'interactive',
        label: '🚀 Interactive',
        sub: '~4s · 25 cands',
        concurrency: 8,
        maxRounds: 2,
        candidatesPerRound: 12,
    },
    thorough: {
        id: 'thorough',
        label: '🔬 Deep Sweep',
        sub: '~12s · 60 cands',
        concurrency: 8,
        maxRounds: 3,
        candidatesPerRound: 20,
    },
};

export const appState = {
    daemonOnline: false,
    briefsMap: new Map(),
    presets: [...DEFAULT_PRESETS],
    executionMode: 'A',
    searchProfile: 'interactive',
    activeTab: 'tab-brief',
    rawJsonMode: false,

    currentRunId: null,
    currentRunState: null,
    currentCandidates: [],
    candidateIndexMap: new Map(), // name -> index in currentCandidates for O(1) SSE upserts
    candidateFilter: 'all',
    paretoAxes: 'mass_vs_area', // 'mass_vs_area' | 'bars_vs_funic' | 'mass_vs_disp' | 'area_vs_sfb'
    selectedCandidateStem: null,
    activePatternsSvg: null,

    // Live throughput meter tracking
    evalTimestampsMs: [],
    throughputCandPerSec: 0,

    // SSE handle
    sseSource: null,
};

// Lightweight Event Bus for cross-module decoupling
const listeners = new Map();

export function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => listeners.get(event)?.delete(handler);
}

export function emit(event, detail) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
        try {
            fn(detail);
        } catch (err) {
            console.error(`[LauncherBus:${event}]`, err);
        }
    }
}

// ---------------------------------------------------------------------------
// rAF-Coalesced UI Update Scheduler (60 FPS smooth SSE bursts, zero DOM thrash)
// ---------------------------------------------------------------------------
const dirtyCallbacks = new Map();
let rafScheduled = false;

export function scheduleUIUpdate(key, callback) {
    dirtyCallbacks.set(key, callback);
    if (rafScheduled) return;
    rafScheduled = true;
    const schedule = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 16);

    schedule(() => {
        rafScheduled = false;
        const entries = [...dirtyCallbacks.entries()];
        dirtyCallbacks.clear();
        for (const [, fn] of entries) {
            try {
                fn();
            } catch (err) {
                console.error('[rAF Scheduler]', err);
            }
        }
    });
}

// Upsert candidate in O(1) amortized time & record throughput timestamp
export function upsertCandidate(cand) {
    if (!cand || !cand.name) return;
    const existingIdx = appState.candidateIndexMap.get(cand.name);
    if (existingIdx !== undefined && appState.currentCandidates[existingIdx]?.name === cand.name) {
        appState.currentCandidates[existingIdx] = cand;
    } else {
        const newIdx = appState.currentCandidates.length;
        appState.currentCandidates.push(cand);
        appState.candidateIndexMap.set(cand.name, newIdx);
    }

    const now = performance.now();
    appState.evalTimestampsMs.push(now);
    const cutoff = now - 3000;
    while (appState.evalTimestampsMs.length > 0 && appState.evalTimestampsMs[0] < cutoff) {
        appState.evalTimestampsMs.shift();
    }
    const windowSec = appState.evalTimestampsMs.length > 1
        ? Math.max(0.25, (now - appState.evalTimestampsMs[0]) / 1000)
        : 1.0;
    appState.throughputCandPerSec = +(appState.evalTimestampsMs.length / windowSec).toFixed(1);
}

export function setCandidatesList(list = []) {
    appState.currentCandidates = Array.isArray(list) ? [...list] : [];
    appState.candidateIndexMap.clear();
    appState.currentCandidates.forEach((c, idx) => {
        if (c && c.name) appState.candidateIndexMap.set(c.name, idx);
    });
}

// ---------------------------------------------------------------------------
// Native ES Module Loader for WFC_FDM_CORE (Zero 844 KB HTML regex fetch!)
// ---------------------------------------------------------------------------
let cachedWfcCore = null;
let corePromise = null;

export async function loadWfcCore() {
    if (cachedWfcCore) return cachedWfcCore;
    if (globalThis.WFC_FDM_CORE) {
        cachedWfcCore = globalThis.WFC_FDM_CORE;
        return cachedWfcCore;
    }
    if (corePromise) return corePromise;

    corePromise = (async () => {
        try {
            const mod = await import('../core/index.mjs');
            cachedWfcCore = mod.WFC_FDM_CORE || mod.default || globalThis.WFC_FDM_CORE || null;
            if (cachedWfcCore) {
                globalThis.WFC_FDM_CORE = cachedWfcCore;
                return cachedWfcCore;
            }
        } catch {
            // Graceful fallback if served from a custom origin where relative ESM path differs
            if (API_BASE) {
                try {
                    const mod = await import(`${API_BASE}/core/index.mjs`);
                    cachedWfcCore = mod.WFC_FDM_CORE || mod.default || globalThis.WFC_FDM_CORE || null;
                    if (cachedWfcCore) {
                        globalThis.WFC_FDM_CORE = cachedWfcCore;
                        return cachedWfcCore;
                    }
                } catch {}
            }
        }
        return globalThis.WFC_FDM_CORE || null;
    })();

    const resolved = await corePromise;
    if (!resolved) corePromise = null; // allow retry if core/index.mjs wasn't ready yet
    return resolved;
}

export function switchTab(tabId) {
    appState.activeTab = tabId;
    document.querySelectorAll('.ui-tab').forEach(btn => {
        const active = btn.dataset.tab === tabId;
        btn.classList.toggle('border-pink-500', active);
        btn.classList.toggle('text-white', active);
        btn.classList.toggle('bg-gray-800/70', active);
        btn.classList.toggle('border-transparent', !active);
        btn.classList.toggle('text-gray-400', !active);
    });
    document.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('hidden', pane.id !== tabId);
    });
    emit('tab_changed', tabId);
}

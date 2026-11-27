/**
 * WFC-FDM Foundry — Tab 8: Bambu Lab P1S 3D Printability, Rescaler, Slicer & Optimizer (ui/tabs/tab7_3dp.js)
 *
 * STRICT INSULATION GUARANTEE:
 *   - NEVER mutates `appState.voxels`, `appState.lastWeldedGraph`, `appState.lastSolidData`,
 *     `appState.VOXEL_SIZE`, `appState.GRID_X/Y/Z`, `appState.tubeState`, or any Tab 1..7 DOM/state.
 *   - Snapshots active geometry & dimensional params as deep read-only clones into private `state3dp`.
 *   - Renders all 3DP visuals (P1S 256×256×256 mm build cage, rescaled mesh + overhang heatmap,
 *     and per-layer toolpaths) inside a dedicated `THREE.Group` (`viewport.print3dpGroup`)
 *     attached directly to `viewport.scene`. Leaving Tab 8 hides `print3dpGroup` and restores
 *     `viewport.mainGroup` identically.
 */

import * as THREE from 'three';
import {
    P1S_SPEC,
    rescaleGeometryForP1S,
    buildBinarySTL,
    analyzePrintability,
    sliceMeshLocal,
    generateOptimizationCandidates
} from '../../core/print3dp.mjs';
import { appState, actions, $, setTxt, downloadBlob } from '../state/workbench_state.js';
import { viewport, clearGroup, zoomToBox, updateBoundingBox3D, requestRender, setBusy } from '../display/viewport_scene.js';
import { showToast } from '../display/display_hud.js';
import { emitProcessTelemetry } from '../display/telemetry_hud.js';

const MM_TO_SCENE = 0.01; // 256 mm -> 2.56 scene units for crisp camera framing & OrbitControls
const BED_HALF_X = P1S_SPEC.bedX * 0.5;
const BED_HALF_Y = P1S_SPEC.bedY * 0.5;

const FEATURE_COLORS = Object.freeze({
    outer_wall: 0xea580c,        // Bambu Orange
    inner_wall: 0xf59e0b,        // Amber
    infill: 0x64748b,            // Slate
    support: 0x10b981,           // Emerald
    support_interface: 0x059669, // Deep Emerald
    bridge: 0x2563eb,            // Cobalt
    brim: 0x06b6d4,              // Cyan
    travel: 0x94a3b8             // Light Slate
});

const FEATURE_ORDER = [
    'brim',
    'support',
    'support_interface',
    'infill',
    'inner_wall',
    'outer_wall',
    'bridge',
    'travel'
];

// Strictly private, isolated 3DP state
const state3dp = {
    initialized: false,
    active: false,
    showPreview: true,
    hideOriginalModel: true,
    showOverhangHeatmap: true,
    showLowerLayers: true,
    showTravel: false,

    // Read-only deep snapshot from active Topogen tab
    sourceLabel: 'None',
    meshSnapshot: null,
    dimParams: null,
    lastGeometrySignature: null,

    // Rescaler & orientation controls
    fitMode: 'fit-bed', // 'fit-bed' | 'target-z' | 'custom-scale'
    targetZMm: 180,
    customScale: 0.10,
    marginMm: 8,
    rotXDeg: 0,
    rotYDeg: 0,
    rotZDeg: 0,

    // Slicer controls (Bambu Lab P1S)
    layerHeightMm: 0.20,
    wallLoops: 2,
    infillPct: 15,
    support: 'tree(auto)', // 'tree(auto)' | 'normal(auto)' | 'none'
    overhangAngleDeg: 35,
    brim: 'auto', // 'auto' | 'outer' | 'none'

    // Computed geometry & analysis
    rescaled: null, // { vertices, faces, triangles, rescaledParams }
    analysis: null,

    // Sliced toolpaths (local or Bambu CLI)
    sliceSource: 'none', // 'none' | 'local' | 'bambu_cli'
    layers: [],
    sliceSummary: null,
    bambuArtifacts: null,
    bambuWarnings: [],
    lastValidatedJobId: null,
    downloadUrls: null,

    // Layer scrubber & playback
    currentLayerIdx: 0,
    playing: false,
    playTimer: null,

    // Bambu CLI server availability
    bambuStatus: {
        checked: false,
        available: false,
        exePath: null,
        profilesReady: false
    },

    // Optimizer results
    optResult: null, // { source, baseline, best, candidates, bestGcodeLayers }
    selectedCandidateIdx: -1
};

let print3dpGroup = null;
let bedGroup = null;
let modelGroup = null;
let toolpathGroup = null;

function mapSupportToCore(supportMode) {
    const s = String(supportMode || 'tree(auto)').toLowerCase();
    if (s.startsWith('none')) return 'none';
    if (s.startsWith('normal')) return 'normal';
    return 'tree';
}

function mapCoreSupportToUi(supportType) {
    const s = String(supportType || 'tree').toLowerCase();
    if (s === 'none') return 'none';
    if (s.startsWith('normal')) return 'normal(auto)';
    return 'tree(auto)';
}

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function fmtNum(v, digits = 1) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(digits) : '—';
}

function fmtMinutes(minVal) {
    const m = Number(minVal);
    if (!Number.isFinite(m) || m <= 0) return '—';
    const totalMin = Math.round(m);
    const h = Math.floor(totalMin / 60);
    const rem = totalMin % 60;
    return h > 0 ? `${h}h ${rem}m` : `${rem}m`;
}

function fmtElapsed(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '0 ms';
    return n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;
}

function nextPaintFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
    });
}

function make3dpJobId(prefix = 'dp3') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

const _dp3ProcLog = [];

function update3dpProgressUI({
    title = '3DP Process Telemetry',
    status = 'idle',
    percent = 0,
    stage = '',
    elapsedMs = 0,
    kv = null,
    logLine = null,
    resetLog = false,
    detail = null
} = {}) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const card = $('dp3-proc-card');
    const fill = $('dp3-proc-fill');
    const pctEl = $('dp3-proc-pct');

    if (card) {
        card.classList.remove('is-running', 'is-done', 'is-error');
        if (status === 'running' || status === 'done' || status === 'error') card.classList.add(`is-${status}`);
    }
    if (fill) {
        fill.style.width = `${pct}%`;
        fill.classList.remove('is-running', 'is-done', 'is-error');
        if (status === 'running' || status === 'done' || status === 'error') fill.classList.add(`is-${status}`);
    }
    setTxt('dp3-proc-title', title);
    setTxt('dp3-proc-elapsed', fmtElapsed(elapsedMs));
    setTxt('dp3-proc-stage', stage || '—');

    if (Array.isArray(kv)) {
        for (let i = 0; i < 4; i++) {
            const pair = kv[i];
            if (!pair) continue;
            setTxt(`dp3-pt-k${i + 1}`, pair[0]);
            setTxt(`dp3-pt-v${i + 1}`, pair[1]);
        }
    }

    if (pctEl) {
        pctEl.classList.remove('is-pass', 'is-warn', 'is-fail', 'is-info');
        if (status === 'running') { pctEl.textContent = `${pct}%`; pctEl.classList.add('is-info'); }
        else if (status === 'done') { pctEl.textContent = '100% ✓'; pctEl.classList.add('is-pass'); }
        else if (status === 'error') { pctEl.textContent = 'ERR'; pctEl.classList.add('is-fail'); }
        else { pctEl.textContent = 'Idle'; }
    }

    if (resetLog) _dp3ProcLog.length = 0;
    if (logLine) {
        const line = `[${fmtElapsed(elapsedMs)}] ${logLine}`;
        if (_dp3ProcLog[_dp3ProcLog.length - 1] !== line) {
            _dp3ProcLog.push(line);
            if (_dp3ProcLog.length > 8) _dp3ProcLog.shift();
            setTxt('dp3-proc-log', _dp3ProcLog.join('\n'));
        }
    }

    emitProcessTelemetry({
        domain: '3DP',
        title,
        status,
        percent: pct,
        stage,
        detail: detail || (Array.isArray(kv) ? kv.map(([k, v]) => `${k}: ${v}`).join(' · ') : stage),
        elapsedMs
    });
}

function start3dpProgressPoller(jobId, title, t0, onUpdate) {
    let stopped = false;
    let lastStage = '';

    const tickTimer = setInterval(() => {
        if (stopped) return;
        setTxt('dp3-proc-elapsed', fmtElapsed(performance.now() - t0));
    }, 150);

    const pollOnce = async () => {
        if (stopped) return;
        try {
            const res = await fetch(`/api/3dp/progress?jobId=${encodeURIComponent(jobId)}`, { method: 'GET' });
            if (!res.ok) return;
            const prog = await res.json();
            if (stopped || !prog || !prog.ok) return;
            const stageText = prog.stage || prog.detail || 'Running…';
            const isNewStage = stageText !== lastStage;
            if (isNewStage) lastStage = stageText;
            if (typeof onUpdate === 'function') {
                onUpdate(prog, isNewStage);
            }
        } catch {
            // Ignore transient poll errors while main POST is in flight
        }
    };

    const pollTimer = setInterval(pollOnce, 350);
    return {
        stop() {
            stopped = true;
            clearInterval(tickTimer);
            clearInterval(pollTimer);
        }
    };
}

// ============================================================================
// 1. HTML Template Mounting (Studio-Light Goldilocks UI)
// ============================================================================
export function mountTab3dp() {
    const pane = $('tab-3dp');
    if (!pane) return;
    pane.innerHTML = `
        <!-- Header & Isolated Snapshot Controls -->
        <div class="dp3-card">
            <div class="dp3-header">
                <span class="dp3-title">Bambu Lab P1S · 3DP Sandbox</span>
                <span id="dp3-cli-badge" class="dp3-badge">CLI: Checking…</span>
            </div>
            <div class="text-[9px] text-gray-400 leading-snug">
                Strictly insulated from Tabs 1–7. Syncs a read-only clone of active geometry onto the 256×256×256 mm P1S bed.
            </div>
            <div class="grid grid-cols-4 gap-1">
                <button type="button" id="btn-dp3-sync" class="cad-btn primary text-[9px] py-1" title="Take a fresh read-only snapshot from active Topogen geometry">↻ Sync</button>
                <button type="button" id="btn-dp3-fit-cam" class="cad-btn text-[9px] py-1" title="Frame the Bambu P1S build volume in 3D viewport">⌖ Fit Bed</button>
                <button type="button" id="btn-dp3-export-stl" class="cad-btn cyan text-[9px] py-1" title="Download rescaled binary STL in mm for Bambu Studio">⬇ STL</button>
                <button type="button" id="btn-dp3-export-3mf" class="cad-btn accent text-[9px] py-1" disabled title="Run Validate Bambu CLI first to generate a P1S .3mf">⬇ .3MF</button>
            </div>
            <div class="flex items-center justify-between gap-2 text-[9px] text-gray-300 pt-0.5">
                <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" id="chk-dp3-preview" checked>
                    <span>3DP Preview</span>
                </label>
                <label class="flex items-center gap-1 cursor-pointer">
                    <input type="checkbox" id="chk-dp3-isolate" checked>
                    <span>Hide Orig. Model</span>
                </label>
                <span id="dp3-source-badge" class="dp3-badge">Src: None</span>
            </div>
        </div>

        <!-- Live 3DP Process Telemetry & Progress Bar -->
        <div id="dp3-proc-card" class="proc-progress-card">
            <div class="proc-progress-header">
                <span id="dp3-proc-title" class="proc-progress-title">3DP Process Telemetry</span>
                <span class="proc-progress-meta">
                    <span id="dp3-proc-elapsed">0 ms</span>
                    <span id="dp3-proc-pct" class="dp3-badge">Idle</span>
                </span>
            </div>
            <div class="proc-progress-track">
                <div id="dp3-proc-fill" class="proc-progress-fill" style="width:0%"></div>
            </div>
            <div id="dp3-proc-stage" class="proc-stage-line">Ready — slice, validate via Bambu CLI, or optimize.</div>
            <div class="proc-telemetry-grid">
                <div class="proc-telemetry-kv">
                    <span id="dp3-pt-k1" class="proc-telemetry-k">Triangles</span>
                    <span id="dp3-pt-v1" class="proc-telemetry-v">—</span>
                </div>
                <div class="proc-telemetry-kv">
                    <span id="dp3-pt-k2" class="proc-telemetry-k">Layers</span>
                    <span id="dp3-pt-v2" class="proc-telemetry-v">—</span>
                </div>
                <div class="proc-telemetry-kv">
                    <span id="dp3-pt-k3" class="proc-telemetry-k">Print / Supp</span>
                    <span id="dp3-pt-v3" class="proc-telemetry-v">—</span>
                </div>
                <div class="proc-telemetry-kv">
                    <span id="dp3-pt-k4" class="proc-telemetry-k">Score / Fit</span>
                    <span id="dp3-pt-v4" class="proc-telemetry-v">—</span>
                </div>
            </div>
            <pre id="dp3-proc-log" class="proc-log">Idle — awaiting 3DP process.</pre>
        </div>

        <!-- 1. P1S Bed Rescaler & Dimensional Parameters -->
        <div class="dp3-card">
            <div class="dp3-header">
                <span class="dp3-title">1. P1S Bed Rescaler &amp; Dimensions</span>
                <span id="dp3-bed-fit-badge" class="dp3-badge">—</span>
            </div>

            <div class="grid grid-cols-3 gap-1">
                <button type="button" data-dp3-fit="fit-bed" class="dp3-fit-btn cad-btn seg-on text-[8.5px] py-0.5">Fit Bed</button>
                <button type="button" data-dp3-fit="target-z" class="dp3-fit-btn cad-btn text-[8.5px] py-0.5">Target Z</button>
                <button type="button" data-dp3-fit="custom-scale" class="dp3-fit-btn cad-btn text-[8.5px] py-0.5">Custom Scale</button>
            </div>

            <div id="dp3-target-z-row" class="dp3-row">
                <span class="dp3-lbl">Target Z</span>
                <input type="range" id="rng-dp3-target-z" min="40" max="248" step="2" value="180" class="flex-1 h-1.5 cursor-pointer">
                <span id="val-dp3-target-z" class="dp3-val">180 mm</span>
            </div>

            <div id="dp3-custom-scale-row" class="dp3-row hidden">
                <span class="dp3-lbl">Scale ×</span>
                <input type="range" id="rng-dp3-custom-scale" min="0.01" max="1.00" step="0.01" value="0.10" class="flex-1 h-1.5 cursor-pointer">
                <span id="val-dp3-custom-scale" class="dp3-val">0.10×</span>
            </div>

            <div class="dp3-row">
                <span class="dp3-lbl">Bed Margin</span>
                <input type="range" id="rng-dp3-margin" min="4" max="20" step="1" value="8" class="flex-1 h-1.5 cursor-pointer">
                <span id="val-dp3-margin" class="dp3-val">8 mm</span>
            </div>

            <div class="space-y-1 pt-1 border-t border-gray-800">
                <div class="dp3-row">
                    <span class="dp3-lbl">Rot X</span>
                    <input type="range" id="rng-dp3-rotx" min="0" max="360" step="5" value="0" class="flex-1 h-1.5 cursor-pointer">
                    <span id="val-dp3-rotx" class="dp3-val">0°</span>
                    <button type="button" data-dp3-rot90="x" class="cad-btn text-[8px] px-1.5 py-0">+90°</button>
                </div>
                <div class="dp3-row">
                    <span class="dp3-lbl">Rot Y</span>
                    <input type="range" id="rng-dp3-roty" min="0" max="360" step="5" value="0" class="flex-1 h-1.5 cursor-pointer">
                    <span id="val-dp3-roty" class="dp3-val">0°</span>
                    <button type="button" data-dp3-rot90="y" class="cad-btn text-[8px] px-1.5 py-0">+90°</button>
                </div>
                <div class="dp3-row">
                    <span class="dp3-lbl">Rot Z</span>
                    <input type="range" id="rng-dp3-rotz" min="0" max="360" step="5" value="0" class="flex-1 h-1.5 cursor-pointer">
                    <span id="val-dp3-rotz" class="dp3-val">0°</span>
                    <button type="button" data-dp3-rot90="z" class="cad-btn text-[8px] px-1.5 py-0">+90°</button>
                </div>
            </div>

            <div class="dp3-kv-grid pt-1 border-t border-gray-800">
                <div class="dp3-kv">
                    <span class="dp3-kv-label">Voxel Size</span>
                    <span id="dp3-kv-voxel" class="dp3-kv-val">—</span>
                </div>
                <div class="dp3-kv">
                    <span class="dp3-kv-label">Tube Outer R</span>
                    <span id="dp3-kv-outer-r" class="dp3-kv-val">—</span>
                </div>
                <div class="dp3-kv">
                    <span class="dp3-kv-label">Min Wall</span>
                    <span id="dp3-kv-min-wall" class="dp3-kv-val">—</span>
                </div>
                <div class="dp3-kv">
                    <span class="dp3-kv-label">Scale Factor</span>
                    <span id="dp3-kv-scale" class="dp3-kv-val">—</span>
                </div>
                <div class="dp3-kv col-span-2">
                    <span class="dp3-kv-label">Model BBox (X × Y × Z mm)</span>
                    <span id="dp3-kv-bbox" class="dp3-kv-val">—</span>
                </div>
            </div>

            <div id="dp3-out-of-bed-banner" class="hidden rounded border px-2 py-1.5 space-y-1 text-[9px]" style="background:#fff1f2; border-color:#fda4af; color:#9f1239;">
                <div class="font-bold uppercase tracking-wide">OUT OF BED — Slicing Blocked</div>
                <div id="dp3-out-of-bed-msg" class="font-mono text-[8.5px] leading-snug">Geometry exceeds Bambu Lab P1S bed (256×256×256 mm).</div>
                <button type="button" id="btn-dp3-auto-fit-bed" class="cad-btn primary w-full text-[9px] py-0.5">⌖ Auto Fit to P1S Bed</button>
            </div>
        </div>

        <!-- 2. Slicer & Toolpath Visualizer (Bambu P1S Requirements) -->
        <div class="dp3-card">
            <div class="dp3-header">
                <span class="dp3-title">2. Slicer &amp; Toolpath Visualizer</span>
                <span id="dp3-slice-source-badge" class="dp3-badge">Not Sliced</span>
            </div>

            <div class="grid grid-cols-2 gap-1.5">
                <label class="flex flex-col gap-0.5 text-[8.5px] text-gray-400">
                    <span>Layer Height</span>
                    <select id="sel-dp3-layer-h" class="border rounded px-1 py-0.5 text-[9.5px]">
                        <option value="0.12">0.12 mm (Fine)</option>
                        <option value="0.16">0.16 mm (Optimal)</option>
                        <option value="0.20" selected>0.20 mm (Standard)</option>
                        <option value="0.24">0.24 mm (Draft)</option>
                    </select>
                </label>
                <label class="flex flex-col gap-0.5 text-[8.5px] text-gray-400">
                    <span>Wall Loops</span>
                    <select id="sel-dp3-walls" class="border rounded px-1 py-0.5 text-[9.5px]">
                        <option value="2" selected>2 loops (0.84 mm)</option>
                        <option value="3">3 loops (1.26 mm)</option>
                        <option value="4">4 loops (1.68 mm)</option>
                    </select>
                </label>
                <label class="flex flex-col gap-0.5 text-[8.5px] text-gray-400">
                    <span>Support Type</span>
                    <select id="sel-dp3-support" class="border rounded px-1 py-0.5 text-[9.5px]">
                        <option value="tree(auto)" selected>tree(auto)</option>
                        <option value="normal(auto)">normal(auto)</option>
                        <option value="none">none</option>
                    </select>
                </label>
                <label class="flex flex-col gap-0.5 text-[8.5px] text-gray-400">
                    <span>Brim</span>
                    <select id="sel-dp3-brim" class="border rounded px-1 py-0.5 text-[9.5px]">
                        <option value="auto" selected>auto</option>
                        <option value="outer">outer</option>
                        <option value="none">none</option>
                    </select>
                </label>
            </div>

            <div class="dp3-row">
                <span class="dp3-lbl">Infill %</span>
                <input type="range" id="rng-dp3-infill" min="10" max="25" step="5" value="15" class="flex-1 h-1.5 cursor-pointer">
                <span id="val-dp3-infill" class="dp3-val">15%</span>
            </div>

            <div class="dp3-row">
                <span class="dp3-lbl">Overhang</span>
                <input type="range" id="rng-dp3-overhang" min="25" max="45" step="5" value="35" class="flex-1 h-1.5 cursor-pointer">
                <span id="val-dp3-overhang" class="dp3-val">35°</span>
            </div>

            <div class="grid grid-cols-2 gap-1 pt-0.5">
                <button type="button" id="btn-dp3-slice-local" class="cad-btn text-[9px] py-1" title="Instant pure-JS planar slice preview in browser">⚡ Quick Local Slice</button>
                <button type="button" id="btn-dp3-slice-bambu" class="cad-btn primary text-[9px] py-1" title="Slice &amp; validate via Bambu Studio Desktop CLI (/api/3dp/slice)">✓ Validate Bambu CLI</button>
            </div>

            <!-- Interactive Layer Scrubber -->
            <div class="pt-1 border-t border-gray-800 space-y-1">
                <div class="dp3-header">
                    <span class="text-[9px] font-semibold uppercase text-gray-400">Layer Scrubber</span>
                    <span id="dp3-layer-label" class="font-mono text-[9px] text-gray-200">Layer 0 / 0 · Z 0.0 mm</span>
                </div>
                <div class="dp3-row">
                    <button type="button" id="btn-dp3-play" class="cad-btn text-[9px] px-2 py-0.5" title="Play / Pause layer-by-layer build animation">▶</button>
                    <input type="range" id="rng-dp3-layer" min="1" max="1" step="1" value="1" disabled class="flex-1 h-1.5 cursor-pointer">
                </div>
                <div class="flex flex-wrap items-center justify-between gap-2 text-[9px] text-gray-300">
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" id="chk-dp3-lower" checked>
                        <span>Lower Layers</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" id="chk-dp3-travel">
                        <span>Show Travel</span>
                    </label>
                    <label class="flex items-center gap-1 cursor-pointer">
                        <input type="checkbox" id="chk-dp3-heatmap" checked>
                        <span>Overhang Heatmap</span>
                    </label>
                </div>
                <div class="dp3-legend">
                    <span class="dp3-legend-item"><i class="dp3-swatch" style="background:#ea580c"></i>Outer Wall</span>
                    <span class="dp3-legend-item"><i class="dp3-swatch" style="background:#f59e0b"></i>Inner Wall</span>
                    <span class="dp3-legend-item"><i class="dp3-swatch" style="background:#64748b"></i>Infill</span>
                    <span class="dp3-legend-item"><i class="dp3-swatch" style="background:#10b981"></i>Support</span>
                    <span class="dp3-legend-item"><i class="dp3-swatch" style="background:#2563eb"></i>Bridge</span>
                    <span class="dp3-legend-item"><i class="dp3-swatch" style="background:#06b6d4"></i>Brim</span>
                </div>
            </div>

            <!-- Structured Bambu P1S Validation Scorecard -->
            <div class="pt-1 border-t border-gray-800 space-y-1">
                <div class="dp3-header">
                    <span class="text-[9px] font-semibold uppercase text-gray-400">P1S Validation Scorecard</span>
                    <span id="dp3-score-badge" class="dp3-badge">Score: —</span>
                </div>
                <div class="dp3-kv-grid">
                    <div class="dp3-kv">
                        <span class="dp3-kv-label">Print Time</span>
                        <span id="dp3-sc-time" class="dp3-kv-val">—</span>
                    </div>
                    <div class="dp3-kv">
                        <span class="dp3-kv-label">Filament</span>
                        <span id="dp3-sc-filament" class="dp3-kv-val">—</span>
                    </div>
                    <div class="dp3-kv">
                        <span class="dp3-kv-label">Support (g / %)</span>
                        <span id="dp3-sc-support" class="dp3-kv-val">—</span>
                    </div>
                    <div class="dp3-kv">
                        <span class="dp3-kv-label">Layers</span>
                        <span id="dp3-sc-layers" class="dp3-kv-val">—</span>
                    </div>
                    <div class="dp3-kv">
                        <span class="dp3-kv-label">Overhang Risk</span>
                        <span id="dp3-sc-overhang" class="dp3-kv-val">—</span>
                    </div>
                    <div class="dp3-kv">
                        <span class="dp3-kv-label">Thin-Wall Check</span>
                        <span id="dp3-sc-wall" class="dp3-kv-val">—</span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 3. Printability Optimizer -->
        <div class="dp3-card">
            <div class="dp3-header">
                <span class="dp3-title">3. Printability Optimizer</span>
                <span id="dp3-opt-badge" class="dp3-badge">Idle</span>
            </div>
            <div class="grid grid-cols-2 gap-1">
                <button type="button" id="btn-dp3-optimize" class="cad-btn primary text-[9px] py-1" title="Evaluate orientation, support &amp; path candidates via Bambu CLI (or local fallback)">✦ Optimize Paths</button>
                <button type="button" id="btn-dp3-apply-best" class="cad-btn cyan text-[9px] py-1" disabled title="Apply winning orientation, settings &amp; validated toolpaths to 3D viewport">★ Apply Best Recipe</button>
            </div>
            <div class="dp3-table-wrap">
                <table class="dp3-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Orient</th>
                            <th>Support</th>
                            <th>Supp%</th>
                            <th>Time</th>
                            <th>Score</th>
                        </tr>
                    </thead>
                    <tbody id="dp3-opt-tbody">
                        <tr><td colspan="6" class="text-center text-gray-400 py-2">Run optimizer to rank P1S recipes</td></tr>
                    </tbody>
                </table>
            </div>
            <div id="dp3-status-bar" class="dp3-status-bar">Ready. Click Sync or open Tab 8 with an active PQ / Elastica / WFC model.</div>
        </div>
    `;
}

// ============================================================================
// 2. Deep Read-Only Snapshot Extraction (Zero Mutation of Tabs 1..7)
// ============================================================================
function extractMeshFromThreeGroup(group) {
    if (!group || !group.children || group.children.length === 0) return null;
    const vertices = [];
    const faces = [];
    const vTmp = new THREE.Vector3();

    group.updateWorldMatrix(true, true);
    group.traverse((obj) => {
        if (!obj.isMesh || !obj.geometry || !obj.visible) return;
        const pos = obj.geometry.getAttribute('position');
        if (!pos || pos.count < 3) return;
        const base = vertices.length;
        // Extract in group-local Z-up space (avoiding viewport.mainGroup's -PI/2 rotation)
        const mat = obj.matrix;
        for (let i = 0; i < pos.count; i++) {
            vTmp.fromBufferAttribute(pos, i).applyMatrix4(mat);
            vertices.push([vTmp.x, vTmp.y, vTmp.z]);
        }
        const idx = obj.geometry.getIndex();
        if (idx) {
            for (let i = 0; i + 2 < idx.count; i += 3) {
                faces.push([base + idx.getX(i), base + idx.getX(i + 1), base + idx.getX(i + 2)]);
            }
        } else {
            for (let i = 0; i + 2 < pos.count; i += 3) {
                faces.push([base + i, base + i + 1, base + i + 2]);
            }
        }
    });

    return vertices.length > 0 && faces.length > 0 ? { vertices, faces } : null;
}

function synthesizeGraphTubesSnapshot(graph, radius = 0.04, sides = 6) {
    if (!graph || !Array.isArray(graph.vertices) || !Array.isArray(graph.edges) || graph.edges.length === 0) {
        return null;
    }
    const vertices = [];
    const faces = [];
    const upA = new THREE.Vector3(0, 0, 1);
    const upB = new THREE.Vector3(1, 0, 0);

    for (const e of graph.edges) {
        const aIdx = Array.isArray(e) ? e[0] : e.a;
        const bIdx = Array.isArray(e) ? e[1] : e.b;
        const va = graph.vertices[aIdx];
        const vb = graph.vertices[bIdx];
        if (!va || !vb) continue;
        const pa = new THREE.Vector3(va.x ?? va[0], va.y ?? va[1], va.z ?? va[2]);
        const pb = new THREE.Vector3(vb.x ?? vb[0], vb.y ?? vb[1], vb.z ?? vb[2]);
        const dir = pb.clone().sub(pa);
        const len = dir.length();
        if (len < 1e-6) continue;
        dir.divideScalar(len);
        const ref = Math.abs(dir.dot(upA)) < 0.9 ? upA : upB;
        const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
        const v = new THREE.Vector3().crossVectors(dir, u).normalize();

        const baseA = vertices.length;
        for (let k = 0; k < sides; k++) {
            const ang = (k / sides) * Math.PI * 2;
            const c = Math.cos(ang) * radius;
            const s = Math.sin(ang) * radius;
            vertices.push([
                pa.x + u.x * c + v.x * s,
                pa.y + u.y * c + v.y * s,
                pa.z + u.z * c + v.z * s
            ]);
        }
        const baseB = vertices.length;
        for (let k = 0; k < sides; k++) {
            const ang = (k / sides) * Math.PI * 2;
            const c = Math.cos(ang) * radius;
            const s = Math.sin(ang) * radius;
            vertices.push([
                pb.x + u.x * c + v.x * s,
                pb.y + u.y * c + v.y * s,
                pb.z + u.z * c + v.z * s
            ]);
        }
        for (let k = 0; k < sides; k++) {
            const kn = (k + 1) % sides;
            faces.push([baseA + k, baseA + kn, baseB + kn, baseB + k]);
        }
    }
    return vertices.length > 0 && faces.length > 0 ? { vertices, faces } : null;
}

function _ptKey(v) {
    if (!v) return '0';
    const x = Array.isArray(v) ? v[0] : v.x;
    const y = Array.isArray(v) ? v[1] : v.y;
    const z = Array.isArray(v) ? v[2] : v.z;
    return `${Math.round((Number(x) || 0) * 1e4)},${Math.round((Number(y) || 0) * 1e4)},${Math.round((Number(z) || 0) * 1e4)}`;
}

export function computeWorkbenchGeometrySignature() {
    const solid = appState.lastSolidData;
    const hasSolid = Boolean(
        solid && Array.isArray(solid.vertices) && solid.vertices.length > 0 &&
        ((Array.isArray(solid.quads) && solid.quads.length > 0) ||
         (Array.isArray(solid.triangles) && solid.triangles.length > 0) ||
         (Array.isArray(solid.faces) && solid.faces.length > 0))
    );
    const sV = hasSolid ? solid.vertices.length : 0;
    const sQ = hasSolid && Array.isArray(solid.quads) ? solid.quads.length : 0;
    const sT = hasSolid && Array.isArray(solid.triangles) ? solid.triangles.length : 0;
    const sF = hasSolid && Array.isArray(solid.faces) ? solid.faces.length : 0;
    const sEnds = hasSolid
        ? `${_ptKey(solid.vertices[0])}|${_ptKey(solid.vertices[sV >> 1])}|${_ptKey(solid.vertices[sV - 1])}`
        : '';

    const elC = appState.lastElasticaData?.curves?.length || 0;
    const elG = viewport.elasticaGroup?.children?.length || 0;
    const tubeG = viewport.tubeGroup?.children?.length || 0;
    const meshG = viewport.meshGroup?.children?.length || 0;
    const userG = viewport.userMeshGroup?.children?.length || 0;
    const gV = appState.lastWeldedGraph?.vertices?.length || 0;
    const gE = appState.lastWeldedGraph?.edges?.length || 0;
    const fdmV = appState.lastFDMResult?.vertices?.length || 0;
    const dims = `${appState.VOXEL_SIZE}|${appState.GRID_X}x${appState.GRID_Y}x${appState.GRID_Z}|${appState.tubeState?.radius}|${appState.tubeState?.innerRadiusM}|${appState.tubeState?.nSides}`;

    return `pq:${sV}/${sQ}/${sT}/${sF}/${sEnds}|tb:${tubeG}|el:${elC}/${elG}|wm:${meshG}|um:${userG}|gr:${gV}/${gE}|fdm:${fdmV}|d:${dims}`;
}

export function syncSnapshotFromWorkbench() {
    const sig = computeWorkbenchGeometrySignature();

    // 1. Read-only clone of dimensional parameters
    const dimParams = {
        voxelSize: Number(appState.VOXEL_SIZE) || 1.0,
        grid: {
            nx: Number(appState.GRID_X) || 1,
            ny: Number(appState.GRID_Y) || 1,
            nz: Number(appState.GRID_Z) || 1
        },
        outerR: Number(appState.tubeState?.radius) || 0.06,
        innerR: Number(appState.tubeState?.innerRadiusM) || 0.03,
        sides: Number(appState.tubeState?.nSides) || 8,
        rodRadius: Number(appState.elasticaState?.rodRadius) || 0.015
    };

    let snapshot = null;
    let sourceLabel = 'None';

    // Priority 1: Active PQ Mesh (`appState.lastSolidData`)
    const solid = appState.lastSolidData;
    if (solid && Array.isArray(solid.vertices) && solid.vertices.length > 0 &&
        ((Array.isArray(solid.quads) && solid.quads.length > 0) ||
         (Array.isArray(solid.triangles) && solid.triangles.length > 0) ||
         (Array.isArray(solid.faces) && solid.faces.length > 0))) {
        const vertices = solid.vertices.map((v) => (
            Array.isArray(v)
                ? [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0]
                : [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0]
        ));
        const faces = [];
        if (Array.isArray(solid.quads)) {
            for (const q of solid.quads) {
                if (q && q.length >= 4) faces.push([q[0], q[1], q[2], q[3]]);
            }
        }
        if (Array.isArray(solid.triangles)) {
            for (const t of solid.triangles) {
                if (t && t.length >= 3) faces.push([t[0], t[1], t[2]]);
            }
        }
        if (faces.length === 0 && Array.isArray(solid.faces)) {
            for (const f of solid.faces) {
                if (f && f.length >= 3) faces.push([...f]);
            }
        }
        if (faces.length > 0) {
            snapshot = { vertices, faces };
            sourceLabel = 'PQ Mesh';
        }
    }

    // Priority 1b: PQ Tube Three.js group fallback if rendered without lastSolidData arrays
    if (!snapshot && viewport.tubeGroup && viewport.tubeGroup.children.length > 0) {
        snapshot = extractMeshFromThreeGroup(viewport.tubeGroup);
        if (snapshot) sourceLabel = 'PQ Mesh';
    }

    // Priority 2: Elastica 3D Rods (`viewport.elasticaGroup`)
    if (!snapshot && appState.lastElasticaData && viewport.elasticaGroup) {
        snapshot = extractMeshFromThreeGroup(viewport.elasticaGroup);
        if (snapshot) sourceLabel = 'Elastica Rods';
    }

    // Priority 3: Active Tile / Scene Meshes (`viewport.meshGroup` / `viewport.userMeshGroup`)
    if (!snapshot && viewport.meshGroup) {
        snapshot = extractMeshFromThreeGroup(viewport.meshGroup);
        if (snapshot) sourceLabel = 'WFC Mesh';
    }
    if (!snapshot && viewport.userMeshGroup) {
        snapshot = extractMeshFromThreeGroup(viewport.userMeshGroup);
        if (snapshot) sourceLabel = 'Imported Mesh';
    }

    // Priority 4: Centerline Graph wireframe tubes fallback
    if (!snapshot) {
        const g = appState.lastFDMResult || appState.lastHostGraph || appState.lastWeldedGraph;
        if (g && Array.isArray(g.vertices) && g.vertices.length > 0 && Array.isArray(g.edges) && g.edges.length > 0) {
            snapshot = synthesizeGraphTubesSnapshot(g, Math.max(0.02, dimParams.outerR * 0.65), 6);
            if (snapshot) sourceLabel = 'Graph Tubes';
        }
    }

    state3dp.meshSnapshot = snapshot;
    state3dp.dimParams = dimParams;
    state3dp.sourceLabel = sourceLabel;
    state3dp.lastGeometrySignature = sig;
    state3dp.sliceSource = 'none';
    state3dp.layers = [];
    state3dp.sliceSummary = null;
    state3dp.lastValidatedJobId = null;
    state3dp.downloadUrls = null;
    state3dp.optResult = null;
    state3dp.selectedCandidateIdx = -1;
    stopLayerPlayback();

    recomputeRescaleAndAnalysis();
    renderOptTable();
    update3dpReadouts();

    if (snapshot) {
        setStatus(`Synced ${sourceLabel} (${snapshot.vertices.length} V · ${snapshot.faces.length} F) into isolated 3DP sandbox.`);
        const triCount = state3dp.rescaled?.triangles?.length || snapshot.faces.length;
        const rp = state3dp.rescaled?.rescaledParams;
        const fitInfo = computeBedFitInfo(rp);
        if (appState.activeTabId === 'tab-3dp') {
            update3dpProgressUI({
                title: 'Sync Snapshot',
                status: 'done',
                percent: 100,
                stage: `Synced ${sourceLabel} (${snapshot.vertices.length}V · ${triCount}T)`,
                elapsedMs: 1,
                kv: [
                    ['Triangles', String(triCount)],
                    ['Source', sourceLabel],
                    ['Overhang', state3dp.analysis ? `${fmtNum(state3dp.analysis.overhangAreaPct, 1)}%` : '—'],
                    ['Bed Fit', fitInfo.fitsBed ? 'PASS ✓' : 'OUT OF BED']
                ],
                resetLog: true,
                logLine: `Synced read-only ${sourceLabel} (${snapshot.vertices.length}V, ${triCount}T)`
            });
        }
    } else {
        setStatus('No active geometry found. Generate a WFC/PQ mesh first, then click Sync.');
    }
    return { ok: Boolean(snapshot), sourceLabel, dimParams, signature: sig };
}

export function syncSnapshotIfChanged(opts = {}) {
    const sig = computeWorkbenchGeometrySignature();
    if (!state3dp.meshSnapshot || sig !== state3dp.lastGeometrySignature) {
        const res = syncSnapshotFromWorkbench();
        return { ...res, updated: true, reason: opts.reason || 'changed' };
    }
    return {
        ok: Boolean(state3dp.meshSnapshot),
        sourceLabel: state3dp.sourceLabel,
        dimParams: state3dp.dimParams,
        signature: sig,
        updated: false,
        reason: opts.reason || 'unchanged'
    };
}

// ============================================================================
// 3. Pure-JS Rescale & Printability Analysis
// ============================================================================
function currentRescaleOpts() {
    return {
        fitMode: state3dp.fitMode,
        targetZMm: state3dp.targetZMm,
        customScale: state3dp.customScale,
        marginMm: state3dp.marginMm,
        rotXDeg: state3dp.rotXDeg,
        rotYDeg: state3dp.rotYDeg,
        rotZDeg: state3dp.rotZDeg
    };
}

function currentSlicerOpts() {
    const coreSupport = mapSupportToCore(state3dp.support);
    return {
        layerHeightMm: state3dp.layerHeightMm,
        wallLoops: state3dp.wallLoops,
        infillPct: state3dp.infillPct,
        support: coreSupport,
        supportType: coreSupport,
        supportAngle: state3dp.overhangAngleDeg,
        overhangAngleDeg: state3dp.overhangAngleDeg,
        brim: state3dp.brim,
        includeTravel: state3dp.showTravel
    };
}

function computeBedFitInfo(rescaledParams) {
    if (!rescaledParams || !rescaledParams.bboxMm) {
        return { fitsBed: false, overflowMm: { x: 0, y: 0, z: 0 } };
    }
    const bb = rescaledParams.bboxMm;
    const min = bb.min || [0, 0, 0];
    const max = bb.max || [0, 0, 0];
    const tol = 0.05;
    const ov = rescaledParams.overflowMm || {
        x: Math.max(0, -min[0], max[0] - P1S_SPEC.bedX),
        y: Math.max(0, -min[1], max[1] - P1S_SPEC.bedY),
        z: Math.max(0, -min[2], max[2] - P1S_SPEC.bedZ)
    };
    const inBounds = (
        min[0] >= -tol && max[0] <= P1S_SPEC.bedX + tol &&
        min[1] >= -tol && max[1] <= P1S_SPEC.bedY + tol &&
        min[2] >= -tol && max[2] <= P1S_SPEC.bedZ + tol
    );
    const fitsBed = (rescaledParams.fitsBed !== undefined ? Boolean(rescaledParams.fitsBed) : true) && inBounds;
    return {
        fitsBed,
        overflowMm: {
            x: Number(ov.x) || 0,
            y: Number(ov.y) || 0,
            z: Number(ov.z) || 0
        }
    };
}

function formatOverflowText(overflowMm) {
    const parts = [];
    if (overflowMm.x > 0.05) parts.push(`X +${overflowMm.x.toFixed(1)} mm`);
    if (overflowMm.y > 0.05) parts.push(`Y +${overflowMm.y.toFixed(1)} mm`);
    if (overflowMm.z > 0.05) parts.push(`Z +${overflowMm.z.toFixed(1)} mm`);
    return parts.length > 0 ? parts.join(', ') : 'exceeds 256×256×256 mm';
}

function recomputeRescaleAndAnalysis({ clearToolpaths = true } = {}) {
    if (!state3dp.meshSnapshot) {
        state3dp.rescaled = null;
        state3dp.analysis = null;
        if (clearToolpaths) {
            state3dp.layers = [];
            state3dp.sliceSource = 'none';
            state3dp.sliceSummary = null;
        }
        render3dpScene();
        return;
    }

    const rescaled = rescaleGeometryForP1S(state3dp.meshSnapshot, state3dp.dimParams, currentRescaleOpts());
    const analysis = analyzePrintability(rescaled, {
        overhangAngleDeg: state3dp.overhangAngleDeg,
        wallThicknessMm: rescaled.rescaledParams.wallThicknessMm,
        layerHeightMm: state3dp.layerHeightMm,
        wallLoops: state3dp.wallLoops,
        brim: state3dp.brim,
        supportType: mapSupportToCore(state3dp.support)
    });

    state3dp.rescaled = rescaled;
    state3dp.analysis = analysis;

    const fitInfo = computeBedFitInfo(rescaled.rescaledParams);
    if (clearToolpaths || !fitInfo.fitsBed) {
        state3dp.layers = [];
        state3dp.sliceSource = 'none';
        state3dp.sliceSummary = null;
        state3dp.lastValidatedJobId = null;
        state3dp.downloadUrls = null;
        state3dp.currentLayerIdx = 0;
        stopLayerPlayback();
    }

    render3dpScene();
    update3dpReadouts();
}

// ============================================================================
// 4. Dedicated 3D Scene Builder (`viewport.print3dpGroup`)
// ============================================================================
function ensurePrint3dpGroup() {
    if (print3dpGroup) return print3dpGroup;
    if (!viewport.scene) return null;

    print3dpGroup = new THREE.Group();
    print3dpGroup.name = 'print3dpGroup';
    print3dpGroup.rotation.x = -Math.PI / 2; // Z-up matching viewport.mainGroup
    print3dpGroup.visible = false;

    bedGroup = new THREE.Group();
    bedGroup.name = 'print3dpBedGroup';
    modelGroup = new THREE.Group();
    modelGroup.name = 'print3dpModelGroup';
    toolpathGroup = new THREE.Group();
    toolpathGroup.name = 'print3dpToolpathGroup';

    print3dpGroup.add(bedGroup, modelGroup, toolpathGroup);
    viewport.scene.add(print3dpGroup);
    viewport.print3dpGroup = print3dpGroup;

    buildP1SBedCage();
    return print3dpGroup;
}

function buildP1SBedCage() {
    if (!bedGroup) return;
    clearGroup(bedGroup);

    const bx = P1S_SPEC.bedX * MM_TO_SCENE;
    const by = P1S_SPEC.bedY * MM_TO_SCENE;
    const bz = P1S_SPEC.bedZ * MM_TO_SCENE;
    const hx = bx * 0.5;
    const hy = by * 0.5;

    // 1. Subtle build-plate surface at Z = -0.001
    const plateGeo = new THREE.PlaneGeometry(bx, by);
    const plateMat = new THREE.MeshBasicMaterial({
        color: 0xf1f5f9,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide
    });
    plateMat.userData.disposeOnClear = true;
    const plateMesh = new THREE.Mesh(plateGeo, plateMat);
    plateMesh.position.set(0, 0, -0.002);
    bedGroup.add(plateMesh);

    // 2. Bed grid lines (every 16 mm = 16 cells across 256 mm)
    const minorPos = [];
    const majorPos = [];
    const stepMm = 16;
    for (let mm = 0; mm <= P1S_SPEC.bedX; mm += stepMm) {
        const x = (mm - BED_HALF_X) * MM_TO_SCENE;
        const target = (mm % 64 === 0) ? majorPos : minorPos;
        target.push(x, -hy, 0, x, hy, 0);
    }
    for (let mm = 0; mm <= P1S_SPEC.bedY; mm += stepMm) {
        const y = (mm - BED_HALF_Y) * MM_TO_SCENE;
        const target = (mm % 64 === 0) ? majorPos : minorPos;
        target.push(-hx, y, 0, hx, y, 0);
    }

    const minorGeo = new THREE.BufferGeometry();
    minorGeo.setAttribute('position', new THREE.Float32BufferAttribute(minorPos, 3));
    const minorMat = new THREE.LineBasicMaterial({ color: 0xcbd5e1, transparent: true, opacity: 0.55 });
    minorMat.userData.disposeOnClear = true;
    bedGroup.add(new THREE.LineSegments(minorGeo, minorMat));

    const majorGeo = new THREE.BufferGeometry();
    majorGeo.setAttribute('position', new THREE.Float32BufferAttribute(majorPos, 3));
    const majorMat = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.8 });
    majorMat.userData.disposeOnClear = true;
    bedGroup.add(new THREE.LineSegments(majorGeo, majorMat));

    // 3. 256 × 256 × 256 mm build volume wireframe cage
    const cagePos = new Float32Array([
        // Bottom perimeter
        -hx, -hy, 0,  hx, -hy, 0,
         hx, -hy, 0,  hx,  hy, 0,
         hx,  hy, 0, -hx,  hy, 0,
        -hx,  hy, 0, -hx, -hy, 0,
        // Top perimeter
        -hx, -hy, bz,  hx, -hy, bz,
         hx, -hy, bz,  hx,  hy, bz,
         hx,  hy, bz, -hx,  hy, bz,
        -hx,  hy, bz, -hx, -hy, bz,
        // 4 vertical corner posts
        -hx, -hy, 0, -hx, -hy, bz,
         hx, -hy, 0,  hx, -hy, bz,
         hx,  hy, 0,  hx,  hy, bz,
        -hx,  hy, 0, -hx,  hy, bz
    ]);
    const cageGeo = new THREE.BufferGeometry();
    cageGeo.setAttribute('position', new THREE.BufferAttribute(cagePos, 3));
    const cageMat = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.55 });
    cageMat.userData.disposeOnClear = true;
    bedGroup.add(new THREE.LineSegments(cageGeo, cageMat));

    // 4. Front-edge indicator bar (Y = -hy, Bambu green accent)
    const frontGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-hx * 0.45, -hy - 0.04, 0.002),
        new THREE.Vector3(hx * 0.45, -hy - 0.04, 0.002)
    ]);
    const frontMat = new THREE.LineBasicMaterial({ color: 0x10b981 });
    frontMat.userData.disposeOnClear = true;
    bedGroup.add(new THREE.Line(frontGeo, frontMat));

    // 5. Safe margin rectangle on bed
    const m = (Number(state3dp.marginMm) || 8) * MM_TO_SCENE;
    const sx = Math.max(0.1, hx - m);
    const sy = Math.max(0.1, hy - m);
    const safePos = new Float32Array([
        -sx, -sy, 0.002,  sx, -sy, 0.002,
         sx, -sy, 0.002,  sx,  sy, 0.002,
         sx,  sy, 0.002, -sx,  sy, 0.002,
        -sx,  sy, 0.002, -sx, -sy, 0.002
    ]);
    const safeGeo = new THREE.BufferGeometry();
    safeGeo.setAttribute('position', new THREE.BufferAttribute(safePos, 3));
    const safeMat = new THREE.LineDashedMaterial({ color: 0x2563eb, dashSize: 0.05, gapSize: 0.035, transparent: true, opacity: 0.65 });
    safeMat.userData.disposeOnClear = true;
    const safeLines = new THREE.LineSegments(safeGeo, safeMat);
    safeLines.computeLineDistances();
    bedGroup.add(safeLines);
}

function renderRescaledModelMesh() {
    if (!modelGroup) return;
    clearGroup(modelGroup);

    const rescaled = state3dp.rescaled;
    if (!rescaled || !Array.isArray(rescaled.vertices) || !Array.isArray(rescaled.triangles) || rescaled.triangles.length === 0) {
        return;
    }

    const verts = rescaled.vertices;
    const tris = rescaled.triangles;
    const sev = state3dp.analysis?.faceOverhangSeverity || null;
    const useHeatmap = Boolean(state3dp.showOverhangHeatmap && sev && sev.length === tris.length);
    const hasToolpaths = state3dp.layers.length > 0;

    const positions = new Float32Array(tris.length * 9);
    const colors = new Float32Array(tris.length * 9);

    const cBase = new THREE.Color(0xcbd5e1);
    const cWarn = new THREE.Color(0xf59e0b);
    const cCrit = new THREE.Color(0xef4444);
    const cTmp = new THREE.Color();

    let pPtr = 0;
    let cPtr = 0;
    for (let i = 0; i < tris.length; i++) {
        const tri = tris[i];
        const v0 = verts[tri[0]];
        const v1 = verts[tri[1]];
        const v2 = verts[tri[2]];
        if (!v0 || !v1 || !v2) continue;

        positions[pPtr++] = (v0[0] - BED_HALF_X) * MM_TO_SCENE;
        positions[pPtr++] = (v0[1] - BED_HALF_Y) * MM_TO_SCENE;
        positions[pPtr++] = v0[2] * MM_TO_SCENE;

        positions[pPtr++] = (v1[0] - BED_HALF_X) * MM_TO_SCENE;
        positions[pPtr++] = (v1[1] - BED_HALF_Y) * MM_TO_SCENE;
        positions[pPtr++] = v1[2] * MM_TO_SCENE;

        positions[pPtr++] = (v2[0] - BED_HALF_X) * MM_TO_SCENE;
        positions[pPtr++] = (v2[1] - BED_HALF_Y) * MM_TO_SCENE;
        positions[pPtr++] = v2[2] * MM_TO_SCENE;

        if (useHeatmap) {
            const s = sev[i] || 0;
            if (s <= 0.01) {
                cTmp.copy(cBase);
            } else if (s < 0.5) {
                cTmp.copy(cBase).lerp(cWarn, s * 2);
            } else {
                cTmp.copy(cWarn).lerp(cCrit, (s - 0.5) * 2);
            }
        } else {
            cTmp.copy(cBase);
        }

        for (let k = 0; k < 3; k++) {
            colors[cPtr++] = cTmp.r;
            colors[cPtr++] = cTmp.g;
            colors[cPtr++] = cTmp.b;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, pPtr), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors.subarray(0, cPtr), 3));
    geo.computeVertexNormals();

    const mat = new THREE.MeshPhysicalMaterial({
        vertexColors: true,
        roughness: 0.52,
        metalness: 0.04,
        side: THREE.DoubleSide,
        transparent: hasToolpaths,
        opacity: hasToolpaths ? 0.24 : 0.92,
        depthWrite: !hasToolpaths
    });
    mat.userData.disposeOnClear = true;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = hasToolpaths ? 1 : 2;
    modelGroup.add(mesh);

    // Subtle mm-space bounding wireframe anchored to the rescaled model (emerald/amber if fits, crimson if overflow)
    const bb = rescaled.rescaledParams?.bboxMm;
    if (bb && bb.min && bb.max) {
        const fitInfo = computeBedFitInfo(rescaled.rescaledParams);
        const x0 = (bb.min[0] - BED_HALF_X) * MM_TO_SCENE;
        const y0 = (bb.min[1] - BED_HALF_Y) * MM_TO_SCENE;
        const z0 = bb.min[2] * MM_TO_SCENE;
        const x1 = (bb.max[0] - BED_HALF_X) * MM_TO_SCENE;
        const y1 = (bb.max[1] - BED_HALF_Y) * MM_TO_SCENE;
        const z1 = bb.max[2] * MM_TO_SCENE;
        const bPos = new Float32Array([
            x0, y0, z0,  x1, y0, z0,  x1, y0, z0,  x1, y1, z0,
            x1, y1, z0,  x0, y1, z0,  x0, y1, z0,  x0, y0, z0,
            x0, y0, z1,  x1, y0, z1,  x1, y0, z1,  x1, y1, z1,
            x1, y1, z1,  x0, y1, z1,  x0, y1, z1,  x0, y0, z1,
            x0, y0, z0,  x0, y0, z1,  x1, y0, z0,  x1, y0, z1,
            x1, y1, z0,  x1, y1, z1,  x0, y1, z0,  x0, y1, z1
        ]);
        const bGeo = new THREE.BufferGeometry();
        bGeo.setAttribute('position', new THREE.BufferAttribute(bPos, 3));
        const bMat = new THREE.LineDashedMaterial({
            color: fitInfo.fitsBed ? 0x059669 : 0xe11d48,
            dashSize: 0.04,
            gapSize: 0.03,
            transparent: true,
            opacity: fitInfo.fitsBed ? 0.55 : 0.90
        });
        bMat.userData.disposeOnClear = true;
        const bLines = new THREE.LineSegments(bGeo, bMat);
        bLines.computeLineDistances();
        bLines.renderOrder = 15;
        modelGroup.add(bLines);
    }
}

function renderToolpathLayers() {
    if (!toolpathGroup) return;
    clearGroup(toolpathGroup);

    const layers = state3dp.layers;
    if (!Array.isArray(layers) || layers.length === 0) return;

    const activeIdx = Math.max(0, Math.min(layers.length - 1, state3dp.currentLayerIdx));

    // Accumulate lower layers and active top layer separately per feature for minimal draw calls
    const lowerBuckets = {};
    const topBuckets = {};
    for (const f of FEATURE_ORDER) {
        lowerBuckets[f] = [];
        topBuckets[f] = [];
    }

    // Gentle Z-layer stride on lower layers ONLY if total lower segments exceed 350,000
    // so WebGL stays 60 FPS while preserving 100% of the active scrubbed layer.
    let lowerStride = 1;
    if (state3dp.showLowerLayers && activeIdx > 0) {
        let totalLowerSegs = 0;
        for (let li = 0; li < activeIdx; li++) {
            const segMap = layers[li]?.segments;
            if (!segMap) continue;
            for (const f of FEATURE_ORDER) {
                if (f === 'travel' && !state3dp.showTravel) continue;
                const s = segMap[f];
                if (s && s.length >= 4) totalLowerSegs += (s.length >> 2);
            }
        }
        if (totalLowerSegs > 350000) {
            lowerStride = Math.max(1, Math.ceil(totalLowerSegs / 350000));
        }
    }

    const pushLayerToBuckets = (layer, buckets) => {
        if (!layer || !layer.segments) return;
        const zScene = (Number(layer.z) || 0) * MM_TO_SCENE;
        for (const f of FEATURE_ORDER) {
            if (f === 'travel' && !state3dp.showTravel) continue;
            const segs = layer.segments[f];
            if (!segs || segs.length < 4) continue;
            const arr = buckets[f];
            for (let i = 0; i + 3 < segs.length; i += 4) {
                arr.push(
                    (segs[i] - BED_HALF_X) * MM_TO_SCENE,
                    (segs[i + 1] - BED_HALF_Y) * MM_TO_SCENE,
                    zScene,
                    (segs[i + 2] - BED_HALF_X) * MM_TO_SCENE,
                    (segs[i + 3] - BED_HALF_Y) * MM_TO_SCENE,
                    zScene
                );
            }
        }
    };

    if (state3dp.showLowerLayers && activeIdx > 0) {
        for (let li = 0; li < activeIdx; li += lowerStride) {
            pushLayerToBuckets(layers[li], lowerBuckets);
        }
    }
    // Always render 100% of the active scrubbed layer
    pushLayerToBuckets(layers[activeIdx], topBuckets);

    const addBucket = (buckets, opacity, renderOrder) => {
        for (const f of FEATURE_ORDER) {
            const arr = buckets[f];
            if (!arr || arr.length === 0) continue;
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
            const mat = new THREE.LineBasicMaterial({
                color: FEATURE_COLORS[f] ?? 0x334155,
                transparent: opacity < 1,
                opacity
            });
            mat.userData.disposeOnClear = true;
            const lines = new THREE.LineSegments(geo, mat);
            lines.renderOrder = renderOrder;
            toolpathGroup.add(lines);
        }
    };

    if (state3dp.showLowerLayers && activeIdx > 0) {
        addBucket(lowerBuckets, 0.52, 5);
    }
    addBucket(topBuckets, 1.0, 10);
}

function render3dpScene() {
    ensurePrint3dpGroup();
    if (!print3dpGroup) return;
    buildP1SBedCage();
    renderRescaledModelMesh();
    renderToolpathLayers();
    apply3dpVisibility();
    requestRender(15);
}

export function apply3dpVisibility() {
    ensurePrint3dpGroup();
    const onTab = (appState.activeTabId === 'tab-3dp');
    state3dp.active = onTab;

    if (print3dpGroup) {
        print3dpGroup.visible = onTab && state3dp.showPreview;
    }

    if (viewport.mainGroup) {
        if (onTab && state3dp.showPreview && state3dp.hideOriginalModel) {
            viewport.mainGroup.visible = false;
            if (viewport.gridHelper) viewport.gridHelper.visible = false;
            // Suppress meter-scale W×D×H overlay pills while inspecting the 256 mm P1S bed
            // without mutating appState.showBoundingBox or appState.groupVis.bbox
            if (viewport.bboxGroup) viewport.bboxGroup.visible = false;
            if (appState.structureBBox) appState.structureBBox.makeEmpty();
        } else {
            viewport.mainGroup.visible = true;
            if (viewport.gridHelper) viewport.gridHelper.visible = appState.groupVis.grid;
            if (typeof updateBoundingBox3D === 'function') updateBoundingBox3D();
        }
    }
    requestRender(10);
}

export function fitP1SCamera() {
    ensurePrint3dpGroup();
    const bx = P1S_SPEC.bedX * MM_TO_SCENE;
    const by = P1S_SPEC.bedY * MM_TO_SCENE;
    const bz = P1S_SPEC.bedZ * MM_TO_SCENE;
    // World-space box (Y-up after -PI/2 X rotation: X in [-bx/2, bx/2], Y in [0, bz], Z in [-by/2, by/2])
    const worldBox = new THREE.Box3(
        new THREE.Vector3(-bx * 0.55, 0, -by * 0.55),
        new THREE.Vector3(bx * 0.55, bz * 1.02, by * 0.55)
    );
    zoomToBox(worldBox);
}

// ============================================================================
// 5. Local Slicer, Bambu Studio CLI Bridge & Optimizer
// ============================================================================
export async function checkBambuStatus() {
    try {
        const res = await fetch('/api/3dp/status', { method: 'GET' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        state3dp.bambuStatus = {
            checked: true,
            available: Boolean(data.available),
            exePath: data.exePath || null,
            profilesReady: Boolean(data.profilesReady)
        };
    } catch {
        state3dp.bambuStatus = {
            checked: true,
            available: false,
            exePath: null,
            profilesReady: false
        };
    }
    update3dpReadouts();
    return state3dp.bambuStatus;
}

export async function runLocalSlice() {
    const t0 = performance.now();
    update3dpProgressUI({
        title: 'Quick Local Slice',
        status: 'running',
        percent: 15,
        stage: '1/4 Checking P1S bed fit & rescaled bounds…',
        elapsedMs: 0,
        resetLog: true,
        logLine: 'Stage 1/4: Verifying P1S 256×256×256 mm bed fit'
    });
    await nextPaintFrame();

    if (!state3dp.rescaled) {
        syncSnapshotFromWorkbench();
        if (!state3dp.rescaled) {
            update3dpProgressUI({
                title: 'Quick Local Slice',
                status: 'error',
                percent: 0,
                stage: 'No active mesh to slice.',
                elapsedMs: performance.now() - t0,
                logLine: 'Error: no active mesh snapshot'
            });
            showToast('No active mesh to slice. Generate a PQ or WFC model first.', { tone: 'warn' });
            return { ok: false, error: 'NO_MESH' };
        }
    }

    const fitInfo = computeBedFitInfo(state3dp.rescaled.rescaledParams);
    if (!fitInfo.fitsBed) {
        state3dp.layers = [];
        state3dp.sliceSource = 'none';
        state3dp.sliceSummary = null;
        render3dpScene();
        update3dpReadouts();
        const ovTxt = formatOverflowText(fitInfo.overflowMm);
        update3dpProgressUI({
            title: 'Quick Local Slice',
            status: 'error',
            percent: 0,
            stage: `Blocked: OUT OF BED (${ovTxt})`,
            elapsedMs: performance.now() - t0,
            logLine: `Blocked: OUT_OF_BED_BOUNDS (${ovTxt})`
        });
        setStatus(`OUT OF BED: Cannot slice (${ovTxt}). Click Auto Fit to P1S Bed first.`);
        showToast(`Cannot slice: geometry exceeds P1S bed (${ovTxt})`, { tone: 'error' });
        return { ok: false, error: 'OUT_OF_BED_BOUNDS', overflowMm: fitInfo.overflowMm };
    }

    const triCount = state3dp.rescaled.triangles?.length || 0;
    update3dpProgressUI({
        title: 'Quick Local Slice',
        status: 'running',
        percent: 35,
        stage: `2/4 Overhang & printability analysis (${triCount} tris)…`,
        elapsedMs: performance.now() - t0,
        kv: [
            ['Triangles', String(triCount)],
            ['Layer H', `${state3dp.layerHeightMm.toFixed(2)} mm`],
            ['Overhang', state3dp.analysis ? `${fmtNum(state3dp.analysis.overhangAreaPct, 1)}%` : '—'],
            ['Bed Fit', 'PASS ✓']
        ],
        logLine: `Stage 2/4: Overhang analysis (${triCount} tris)`
    });
    await nextPaintFrame();

    update3dpProgressUI({
        title: 'Quick Local Slice',
        status: 'running',
        percent: 70,
        stage: `3/4 Slicing planar layers @ ${state3dp.layerHeightMm.toFixed(2)} mm…`,
        elapsedMs: performance.now() - t0,
        logLine: `Stage 3/4: Planar slicing @ ${state3dp.layerHeightMm.toFixed(2)} mm`
    });
    await nextPaintFrame();

    const sliced = sliceMeshLocal(state3dp.rescaled, {
        layerHeightMm: state3dp.layerHeightMm,
        overhangAngleDeg: state3dp.overhangAngleDeg,
        wallLoops: state3dp.wallLoops,
        infillPct: state3dp.infillPct,
        supportType: mapSupportToCore(state3dp.support)
    });

    if (sliced && sliced.ok === false) {
        state3dp.layers = [];
        state3dp.sliceSource = 'none';
        state3dp.sliceSummary = null;
        render3dpScene();
        update3dpReadouts();
        update3dpProgressUI({
            title: 'Quick Local Slice',
            status: 'error',
            percent: 0,
            stage: `Slice blocked: ${sliced.error || 'OUT_OF_BED_BOUNDS'}`,
            elapsedMs: performance.now() - t0,
            logLine: `Blocked: ${sliced.error || 'OUT_OF_BED_BOUNDS'}`
        });
        setStatus(`Slice blocked: ${sliced.error || 'OUT_OF_BED_BOUNDS'}.`);
        return sliced;
    }

    update3dpProgressUI({
        title: 'Quick Local Slice',
        status: 'running',
        percent: 95,
        stage: `4/4 Building 3D WebGL toolpaths (${(sliced.layers || []).length} layers)…`,
        elapsedMs: performance.now() - t0,
        logLine: `Stage 4/4: Rendering ${(sliced.layers || []).length} toolpath layers`
    });
    await nextPaintFrame();

    state3dp.sliceSource = 'local';
    state3dp.layers = sliced.layers || [];
    state3dp.sliceSummary = sliced.summary || null;
    state3dp.bambuArtifacts = null;
    state3dp.bambuWarnings = [];
    state3dp.lastValidatedJobId = null;
    state3dp.downloadUrls = null;
    state3dp.currentLayerIdx = Math.max(0, state3dp.layers.length - 1);

    render3dpScene();
    update3dpReadouts();

    const totalMs = performance.now() - t0;
    const ovPct = state3dp.analysis ? `${fmtNum(state3dp.analysis.overhangAreaPct, 1)}%` : '—';
    const scoreStr = state3dp.analysis ? `${Math.round(state3dp.analysis.printabilityScore)}/100` : '—';
    update3dpProgressUI({
        title: 'Quick Local Slice',
        status: 'done',
        percent: 100,
        stage: `Complete — ${state3dp.layers.length} layers in ${fmtElapsed(totalMs)}`,
        elapsedMs: totalMs,
        kv: [
            ['Triangles', String(triCount)],
            ['Layers', String(state3dp.layers.length)],
            ['Overhang', ovPct],
            ['Score', scoreStr]
        ],
        logLine: `Done: ${state3dp.layers.length} layers, ${ovPct} overhang, score ${scoreStr}`
    });
    setStatus(`Local slice complete: ${state3dp.layers.length} layers @ ${state3dp.layerHeightMm.toFixed(2)} mm.`);
    return { ok: true, source: 'local', layerCount: state3dp.layers.length, summary: state3dp.sliceSummary };
}

export async function runBambuCLISlice() {
    const t0 = performance.now();
    if (!state3dp.meshSnapshot) {
        syncSnapshotFromWorkbench();
        if (!state3dp.meshSnapshot) {
            showToast('No active mesh to validate.', { tone: 'warn' });
            return { ok: false, error: 'NO_MESH' };
        }
    }

    const fitInfo = computeBedFitInfo(state3dp.rescaled?.rescaledParams);
    if (!fitInfo.fitsBed) {
        state3dp.layers = [];
        state3dp.sliceSource = 'none';
        state3dp.sliceSummary = null;
        render3dpScene();
        update3dpReadouts();
        const ovTxt = formatOverflowText(fitInfo.overflowMm);
        update3dpProgressUI({
            title: 'Bambu Studio CLI Slice',
            status: 'error',
            percent: 0,
            stage: `Blocked: OUT OF BED (${ovTxt})`,
            elapsedMs: performance.now() - t0,
            resetLog: true,
            logLine: `Blocked: OUT_OF_BED_BOUNDS (${ovTxt})`
        });
        setStatus(`OUT OF BED: Bambu CLI blocked (${ovTxt}). Click Auto Fit to P1S Bed first.`);
        showToast(`Cannot slice: geometry exceeds P1S bed (${ovTxt})`, { tone: 'error' });
        return { ok: false, validated: false, error: 'OUT_OF_BED_BOUNDS', overflowMm: fitInfo.overflowMm };
    }

    const jobId = make3dpJobId('slice');
    const triCount = state3dp.rescaled?.triangles?.length || 0;
    setBusy('Slicing via Bambu Studio CLI…');
    setStatus('Sending rescaled geometry to /api/3dp/slice (Bambu Studio CLI)…');
    update3dpProgressUI({
        title: 'Bambu Studio CLI Slice',
        status: 'running',
        percent: 8,
        stage: 'Submitting job to Bambu Studio CLI…',
        elapsedMs: 0,
        kv: [
            ['Triangles', String(triCount)],
            ['Layer H', `${state3dp.layerHeightMm.toFixed(2)} mm`],
            ['Support', mapSupportToCore(state3dp.support)],
            ['Job ID', jobId.slice(-8)]
        ],
        resetLog: true,
        logLine: `Submitted Bambu CLI job ${jobId}`
    });

    const poller = start3dpProgressPoller(jobId, 'Bambu Studio CLI Slice', t0, (prog, isNewStage) => {
        update3dpProgressUI({
            title: 'Bambu Studio CLI Slice',
            status: prog.status === 'error' ? 'error' : 'running',
            percent: prog.percent ?? 20,
            stage: prog.stage || prog.detail || 'Running Bambu Studio CLI…',
            elapsedMs: prog.elapsedMs ?? (performance.now() - t0),
            logLine: isNewStage ? `${prog.percent ?? 0}% ${prog.stage || prog.detail}` : null
        });
    });

    try {
        const res = await fetch('/api/3dp/slice', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId,
                meshSnapshot: state3dp.meshSnapshot,
                dimParams: state3dp.dimParams,
                options: {
                    ...currentRescaleOpts(),
                    ...currentSlicerOpts()
                }
            })
        });
        const data = await res.json();
        if (data && data.error === 'OUT_OF_BED_BOUNDS') {
            state3dp.layers = [];
            state3dp.sliceSource = 'none';
            state3dp.sliceSummary = null;
            render3dpScene();
            update3dpReadouts();
            update3dpProgressUI({
                title: 'Bambu Studio CLI Slice',
                status: 'error',
                percent: 0,
                stage: 'Blocked: OUT OF BED (256×256×256 mm)',
                elapsedMs: performance.now() - t0,
                logLine: 'Server rejected: OUT_OF_BED_BOUNDS'
            });
            setStatus(data.message || 'OUT OF BED: Only geometry that fits inside the P1S bed can be sliced.');
            showToast('Cannot slice: geometry exceeds P1S bed (256×256×256 mm)', { tone: 'error' });
            return { ok: false, validated: false, error: 'OUT_OF_BED_BOUNDS', overflowMm: data.overflowMm || null };
        }
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }

        const gcodeLayers = data.gcodeLayers || data.layers || [];
        const layersArr = Array.isArray(gcodeLayers) ? gcodeLayers : (gcodeLayers.layers || []);
        const summary = data.metrics || data.gcodeSummary || data.summary || gcodeLayers.summary || null;

        state3dp.sliceSource = data.validated ? 'bambu_cli' : 'local';
        state3dp.layers = layersArr;
        state3dp.sliceSummary = summary;
        state3dp.bambuArtifacts = data.artifacts || null;
        state3dp.bambuWarnings = Array.isArray(data.warnings) ? data.warnings : [];
        state3dp.lastValidatedJobId = data.validated ? (data.jobId || jobId) : null;
        state3dp.downloadUrls = data.downloadUrls || (data.validated && (data.jobId || jobId) ? {
            threemf: `/api/3dp/artifact?jobId=${encodeURIComponent(data.jobId || jobId)}&kind=3mf`,
            gcode: `/api/3dp/artifact?jobId=${encodeURIComponent(data.jobId || jobId)}&kind=gcode`
        } : null);
        state3dp.currentLayerIdx = Math.max(0, state3dp.layers.length - 1);

        if (data.bambuAvailable !== undefined) {
            state3dp.bambuStatus.available = Boolean(data.bambuAvailable);
            state3dp.bambuStatus.checked = true;
        } else if (data.validated) {
            state3dp.bambuStatus.available = true;
            state3dp.bambuStatus.checked = true;
        }

        render3dpScene();
        update3dpReadouts();
        const totalMs = performance.now() - t0;
        const timeDisp = summary?.printTimeFormatted || summary?.estimatedTimeStr || fmtMinutes(summary?.printTimeMin ?? summary?.estimatedTimeMin);
        const filDisp = Number.isFinite(summary?.totalFilamentG) ? `${fmtNum(summary.totalFilamentG, 1)}g` : '—';
        const suppDisp = Number.isFinite(summary?.supportPct) ? `${fmtNum(summary.supportPct, 1)}%` : '—';
        const scoreDisp = Number.isFinite(summary?.printabilityScore) ? `${Math.round(summary.printabilityScore)}/100` : '—';
        update3dpProgressUI({
            title: 'Bambu Studio CLI Slice',
            status: 'done',
            percent: 100,
            stage: `Validated — ${state3dp.layers.length} layers · ${timeDisp}`,
            elapsedMs: totalMs,
            kv: [
                ['Layers', String(state3dp.layers.length)],
                ['Print Time', timeDisp],
                ['Fil / Supp', `${filDisp} · ${suppDisp}`],
                ['P1S Score', scoreDisp]
            ],
            logLine: `Validated: ${state3dp.layers.length}L, ${timeDisp}, ${filDisp}, supp ${suppDisp}, score ${scoreDisp}`
        });
        showToast(`Bambu P1S CLI validated (${state3dp.layers.length} layers)`, { tone: 'success' });
        setStatus(`Bambu Studio CLI validated: ${state3dp.layers.length} layers, ${timeDisp}, ${fmtNum(summary?.totalFilamentG, 1)} g.`);
        return { ok: true, validated: Boolean(data.validated), layerCount: state3dp.layers.length, metrics: summary };
    } catch (err) {
        const msg = err?.message || String(err);
        update3dpProgressUI({
            title: 'Bambu Studio CLI Slice',
            status: 'error',
            percent: 0,
            stage: `CLI unavailable (${msg}) — running local slice…`,
            elapsedMs: performance.now() - t0,
            logLine: `Fallback to local slice: ${msg}`
        });
        setStatus(`Bambu CLI unavailable (${msg}). Falling back to local browser slice.`);
        showToast('Bambu CLI unavailable — ran local preview slice', { tone: 'warn' });
        return runLocalSlice();
    } finally {
        poller.stop();
        setBusy('');
    }
}

export async function runPrintabilityOptimizer() {
    const t0 = performance.now();
    if (!state3dp.meshSnapshot) {
        syncSnapshotFromWorkbench();
        if (!state3dp.meshSnapshot) {
            showToast('No active mesh to optimize.', { tone: 'warn' });
            return { ok: false, error: 'NO_MESH' };
        }
    }

    const fitInfo = computeBedFitInfo(state3dp.rescaled?.rescaledParams);
    if (!fitInfo.fitsBed) {
        const ovTxt = formatOverflowText(fitInfo.overflowMm);
        update3dpProgressUI({
            title: 'P1S Printability Optimizer',
            status: 'error',
            percent: 0,
            stage: `Blocked: OUT OF BED (${ovTxt})`,
            elapsedMs: performance.now() - t0,
            resetLog: true,
            logLine: `Blocked: OUT_OF_BED_BOUNDS (${ovTxt})`
        });
        setStatus(`OUT OF BED: Optimizer blocked (${ovTxt}). Click Auto Fit to P1S Bed first.`);
        showToast(`Cannot optimize: geometry exceeds P1S bed (${ovTxt})`, { tone: 'error' });
        return { ok: false, error: 'OUT_OF_BED_BOUNDS', overflowMm: fitInfo.overflowMm };
    }

    const jobId = make3dpJobId('opt');
    setBusy('Optimizing P1S orientation & supports…');
    setStatus('Evaluating P1S orientation, support & path recipes via /api/3dp/optimize…');
    update3dpProgressUI({
        title: 'P1S Printability Optimizer',
        status: 'running',
        percent: 8,
        stage: 'Generating & ranking orientation/support candidates…',
        elapsedMs: 0,
        kv: [
            ['Candidates', '0 / —'],
            ['Best Score', '—'],
            ['Support %', '—'],
            ['Mode', 'Bambu CLI']
        ],
        resetLog: true,
        logLine: `Started P1S optimization job ${jobId}`
    });

    let lastStreamedCount = 0;
    const poller = start3dpProgressPoller(jobId, 'P1S Printability Optimizer', t0, (prog, isNewStage) => {
        const streamed = Array.isArray(prog.completedCandidates) ? prog.completedCandidates : [];
        if (streamed.length > lastStreamedCount) {
            lastStreamedCount = streamed.length;
            const sortedStream = [...streamed].sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0));
            state3dp.optResult = {
                source: 'bambu_cli',
                baseline: sortedStream.find(c => c.isBaseline) || null,
                best: sortedStream[0] || null,
                candidates: sortedStream,
                bestGcodeLayers: null,
                bestSummary: null
            };
            renderOptTable();
        }
        const candStr = prog.candidateTotal
            ? `${prog.candidateIndex || streamed.length} / ${prog.candidateTotal}`
            : `${streamed.length} done`;
        const topLive = state3dp.optResult?.best;
        update3dpProgressUI({
            title: 'P1S Printability Optimizer',
            status: prog.status === 'error' ? 'error' : 'running',
            percent: prog.percent ?? 15,
            stage: prog.stage || prog.detail || `Validating candidate ${candStr}…`,
            elapsedMs: prog.elapsedMs ?? (performance.now() - t0),
            kv: [
                ['Candidates', candStr],
                ['Best Score', topLive ? `${Math.round(Number(topLive.score) || 0)}/100` : '—'],
                ['Support %', topLive && Number.isFinite(topLive.supportPct) ? `${fmtNum(topLive.supportPct, 1)}%` : '—'],
                ['Mode', 'Bambu CLI']
            ],
            logLine: isNewStage ? `${prog.percent ?? 0}% ${prog.stage || prog.detail}` : null
        });
    });

    try {
        const res = await fetch('/api/3dp/optimize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jobId,
                meshSnapshot: state3dp.meshSnapshot,
                dimParams: state3dp.dimParams,
                options: {
                    ...currentRescaleOpts(),
                    ...currentSlicerOpts()
                }
            })
        });
        const data = await res.json();
        if (data && data.error === 'OUT_OF_BED_BOUNDS') {
            state3dp.layers = [];
            state3dp.sliceSource = 'none';
            state3dp.sliceSummary = null;
            render3dpScene();
            update3dpReadouts();
            update3dpProgressUI({
                title: 'P1S Printability Optimizer',
                status: 'error',
                percent: 0,
                stage: 'Blocked: OUT OF BED (256×256×256 mm)',
                elapsedMs: performance.now() - t0,
                logLine: 'Server rejected: OUT_OF_BED_BOUNDS'
            });
            setStatus(data.message || 'OUT OF BED: Only geometry that fits inside the P1S bed can be sliced.');
            showToast('Cannot slice: geometry exceeds P1S bed (256×256×256 mm)', { tone: 'error' });
            return { ok: false, validated: false, error: 'OUT_OF_BED_BOUNDS', overflowMm: data.overflowMm || null };
        }
        if (!res.ok || !data.ok) {
            throw new Error(data.error || `HTTP ${res.status}`);
        }

        const bestGcode = data.bestGcodeLayers || null;
        const bestLayers = Array.isArray(bestGcode) ? bestGcode : (bestGcode?.layers || null);
        const isCliValidated = Boolean(data.validated || data.validatedCount > 0 || (data.bambuAvailable && bestLayers && bestLayers.length > 0));

        const bestJobId = data.bestJobId || data.best?.jobId || null;
        const bestDownloadUrls = data.downloadUrls || data.best?.downloadUrls || (bestJobId ? {
            threemf: `/api/3dp/artifact?jobId=${encodeURIComponent(bestJobId)}&kind=3mf`,
            gcode: `/api/3dp/artifact?jobId=${encodeURIComponent(bestJobId)}&kind=gcode`
        } : null);

        state3dp.optResult = {
            source: isCliValidated ? 'bambu_cli' : 'server',
            baseline: data.baseline || null,
            best: data.best || (Array.isArray(data.candidates) ? data.candidates[0] : null),
            improvement: data.improvement || null,
            candidates: Array.isArray(data.candidates) ? data.candidates : [],
            bestGcodeLayers: bestLayers,
            bestSummary: data.best?.metrics || data.bestGcodeSummary || bestGcode?.summary || null,
            bestJobId,
            bestDownloadUrls
        };
        if (bestDownloadUrls && !state3dp.downloadUrls) {
            state3dp.lastValidatedJobId = bestJobId;
            state3dp.downloadUrls = bestDownloadUrls;
        }
        state3dp.selectedCandidateIdx = 0;

        renderOptTable();
        update3dpReadouts();
        const totalMs = performance.now() - t0;
        const bestScore = state3dp.optResult.best?.score ?? '—';
        const bestSupp = state3dp.optResult.best?.metrics?.supportPct ?? state3dp.optResult.best?.analysis?.estimatedSupportRatioPct;
        update3dpProgressUI({
            title: 'P1S Printability Optimizer',
            status: 'done',
            percent: 100,
            stage: `Complete — Best: ${state3dp.optResult.best?.label || 'Top'} (${bestScore}/100)`,
            elapsedMs: totalMs,
            kv: [
                ['Candidates', `${data.validatedCount || state3dp.optResult.candidates.length} ranked`],
                ['Best Score', `${Math.round(Number(bestScore) || 0)}/100`],
                ['Support %', Number.isFinite(bestSupp) ? `${fmtNum(bestSupp, 1)}%` : '—'],
                ['Mode', isCliValidated ? 'Bambu CLI ✓' : 'Server']
            ],
            logLine: `Done in ${fmtElapsed(totalMs)}: Best score ${bestScore}/100 (${state3dp.optResult.candidates.length} candidates)`
        });
        showToast(`Optimizer complete — Best P1S Score: ${bestScore}/100`, { tone: 'success' });
        setStatus(`Optimizer ranked ${state3dp.optResult.candidates.length} candidates (Best: ${state3dp.optResult.best?.label || 'Top'} · Score ${bestScore}). Click Apply Best Recipe.`);
        return { ok: true, source: state3dp.optResult.source, best: state3dp.optResult.best, candidateCount: state3dp.optResult.candidates.length };
    } catch (err) {
        // Offline / static-server fallback using pure-JS core optimizer
        const localOpt = generateOptimizationCandidates(state3dp.meshSnapshot, state3dp.dimParams, {
            ...currentRescaleOpts(),
            ...currentSlicerOpts()
        });
        state3dp.optResult = {
            source: 'local',
            baseline: localOpt.baseline || null,
            best: localOpt.best || null,
            candidates: localOpt.candidates || [],
            bestGcodeLayers: null,
            bestSummary: null
        };
        state3dp.selectedCandidateIdx = 0;

        renderOptTable();
        update3dpReadouts();
        const totalMs = performance.now() - t0;
        const bestScore = localOpt.best?.score ?? '—';
        update3dpProgressUI({
            title: 'P1S Printability Optimizer',
            status: 'done',
            percent: 100,
            stage: `Local fallback complete — ${state3dp.optResult.candidates.length} recipes ranked`,
            elapsedMs: totalMs,
            kv: [
                ['Candidates', `${state3dp.optResult.candidates.length} local`],
                ['Best Score', `${Math.round(Number(bestScore) || 0)}/100`],
                ['Support %', localOpt.best?.analysis ? `${fmtNum(localOpt.best.analysis.estimatedSupportRatioPct, 1)}%` : '—'],
                ['Mode', 'Local Core']
            ],
            logLine: `Offline local optimizer done (${state3dp.optResult.candidates.length} recipes, best ${bestScore}/100)`
        });
        showToast(`Local optimizer ranked ${state3dp.optResult.candidates.length} recipes`, { tone: 'info' });
        setStatus(`Offline local optimizer complete (${state3dp.optResult.candidates.length} recipes). Click Apply Best Recipe.`);
        return { ok: true, source: 'local', best: state3dp.optResult.best, candidateCount: state3dp.optResult.candidates.length };
    } finally {
        poller.stop();
        setBusy('');
    }
}

export function applyCandidateRecipe(candidateIndex = 0) {
    const opt = state3dp.optResult;
    if (!opt || !Array.isArray(opt.candidates) || opt.candidates.length === 0) {
        return { ok: false, error: 'NO_OPTIMIZER_RESULTS' };
    }
    const idx = Math.max(0, Math.min(opt.candidates.length - 1, candidateIndex));
    const cand = opt.candidates[idx];
    if (!cand) return { ok: false, error: 'INVALID_CANDIDATE' };

    state3dp.selectedCandidateIdx = idx;
    const rot = cand.orientationDeg || cand.rotationDeg || { x: 0, y: 0, z: 0 };
    state3dp.rotXDeg = Number(rot.x) || 0;
    state3dp.rotYDeg = Number(rot.y) || 0;
    state3dp.rotZDeg = Number(rot.z) || 0;

    const sOpts = cand.slicerOpts || cand.options || {};
    if (sOpts.layerHeightMm) state3dp.layerHeightMm = Number(sOpts.layerHeightMm);
    if (sOpts.wallLoops) state3dp.wallLoops = Number(sOpts.wallLoops);
    if (sOpts.infillPct !== undefined) state3dp.infillPct = Number(sOpts.infillPct);
    if (sOpts.support) state3dp.support = mapCoreSupportToUi(sOpts.support);
    if (sOpts.supportAngle || sOpts.overhangAngleDeg) {
        state3dp.overhangAngleDeg = Number(sOpts.supportAngle || sOpts.overhangAngleDeg);
    }
    if (sOpts.brim) state3dp.brim = String(sOpts.brim);

    syncControlsFromState();

    // If applying the #0 best recipe and we already have Bambu-validated G-code layers, load them directly!
    const isBestWithGcode = (idx === 0 && Array.isArray(opt.bestGcodeLayers) && opt.bestGcodeLayers.length > 0);
    recomputeRescaleAndAnalysis({ clearToolpaths: !isBestWithGcode });

    if (isBestWithGcode) {
        state3dp.sliceSource = 'bambu_cli';
        state3dp.layers = opt.bestGcodeLayers;
        state3dp.sliceSummary = cand.metrics || opt.bestSummary || null;
        state3dp.lastValidatedJobId = opt.bestJobId || cand.jobId || null;
        state3dp.downloadUrls = opt.bestDownloadUrls || cand.downloadUrls || null;
        state3dp.currentLayerIdx = Math.max(0, state3dp.layers.length - 1);
        render3dpScene();
    } else {
        runLocalSlice();
    }

    renderOptTable();
    update3dpReadouts();
    setStatus(`Applied recipe "${cand.label || `#${idx + 1}`}" (Rot ${state3dp.rotXDeg}/${state3dp.rotYDeg}/${state3dp.rotZDeg}°, ${state3dp.support}).`);
    return { ok: true, applied: cand.label || `#${idx + 1}`, score: cand.score };
}

export function exportRescaledSTL() {
    const t0 = performance.now();
    if (!state3dp.rescaled) {
        syncSnapshotFromWorkbench();
        if (!state3dp.rescaled) return { ok: false, error: 'NO_MESH' };
    }
    const bytes = buildBinarySTL(state3dp.rescaled, 'TOPOGEN Bambu Lab P1S mm');
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const name = `topogen_p1s_${Math.round(state3dp.rescaled.rescaledParams?.bboxMm?.size?.[2] || 180)}mm.stl`;
    downloadBlob(blob, name);
    const elapsedMs = performance.now() - t0;
    const kb = (bytes.byteLength / 1024).toFixed(1);
    update3dpProgressUI({
        title: 'Export Binary STL',
        status: 'done',
        percent: 100,
        stage: `Exported ${name} (${kb} KB)`,
        elapsedMs,
        kv: [
            ['File', name],
            ['Size', `${kb} KB`],
            ['Triangles', String(state3dp.rescaled.triangles?.length || 0)],
            ['Units', 'mm (P1S)']
        ],
        resetLog: true,
        logLine: `Exported ${name} (${kb} KB) in ${fmtElapsed(elapsedMs)}`
    });
    showToast(`Exported ${name}`, { tone: 'success' });
    return { ok: true, filename: name, bytes: bytes.byteLength };
}

export function exportBambu3MF() {
    const url = state3dp.downloadUrls?.threemf || null;
    if (!url) {
        showToast('Run Validate Bambu CLI first to generate a P1S .3mf', { tone: 'warn' });
        return { ok: false, error: 'NO_3MF_ARTIFACT' };
    }
    const jobTag = state3dp.lastValidatedJobId || 'p1s';
    const filename = `topogen_p1s_${jobTag}.3mf`;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    update3dpProgressUI({
        title: 'Export Bambu .3MF',
        status: 'done',
        percent: 100,
        stage: `Downloading ${filename}`,
        elapsedMs: 1,
        kv: [
            ['File', filename],
            ['Printer', 'Bambu Lab P1S'],
            ['Layers', String(state3dp.layers.length)],
            ['Format', 'Sliced .3MF']
        ],
        logLine: `Triggered download: ${url}`
    });
    showToast(`Downloading ${filename}`, { tone: 'success' });
    return { ok: true, filename, url };
}

// ============================================================================
// 6. Layer Playback & UI Readout Sync
// ============================================================================
function stopLayerPlayback() {
    state3dp.playing = false;
    if (state3dp.playTimer) {
        clearInterval(state3dp.playTimer);
        state3dp.playTimer = null;
    }
    const btn = $('btn-dp3-play');
    if (btn) btn.textContent = '▶';
}

export function toggleLayerPlayback(forceState = null) {
    const next = forceState === null ? !state3dp.playing : Boolean(forceState);
    if (!next || state3dp.layers.length === 0) {
        stopLayerPlayback();
        return false;
    }
    state3dp.playing = true;
    const btn = $('btn-dp3-play');
    if (btn) btn.textContent = '⏸';
    if (state3dp.currentLayerIdx >= state3dp.layers.length - 1) {
        state3dp.currentLayerIdx = 0;
    }
    state3dp.playTimer = setInterval(() => {
        if (!state3dp.playing || state3dp.layers.length === 0) {
            stopLayerPlayback();
            return;
        }
        state3dp.currentLayerIdx = (state3dp.currentLayerIdx + 1) % state3dp.layers.length;
        renderToolpathLayers();
        updateLayerScrubberUI();
        requestRender(4);
    }, 65);
    return true;
}

export function setCurrentLayer(oneBasedLayer) {
    if (state3dp.layers.length === 0) return;
    const idx = Math.max(0, Math.min(state3dp.layers.length - 1, Math.round(Number(oneBasedLayer) || 1) - 1));
    state3dp.currentLayerIdx = idx;
    renderToolpathLayers();
    updateLayerScrubberUI();
    requestRender(4);
}

function setStatus(msg) {
    setTxt('dp3-status-bar', msg);
}

function setBadge(id, text, tone = '') {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('is-pass', 'is-warn', 'is-fail', 'is-info');
    if (tone) el.classList.add(`is-${tone}`);
}

function syncControlsFromState() {
    document.querySelectorAll('.dp3-fit-btn').forEach((b) => {
        b.classList.toggle('seg-on', b.dataset.dp3Fit === state3dp.fitMode);
    });
    const tzRow = $('dp3-target-z-row');
    const csRow = $('dp3-custom-scale-row');
    if (tzRow) tzRow.classList.toggle('hidden', state3dp.fitMode === 'custom-scale');
    if (csRow) csRow.classList.toggle('hidden', state3dp.fitMode !== 'custom-scale');

    const setVal = (id, v) => { const el = $(id); if (el) el.value = String(v); };
    setVal('rng-dp3-target-z', state3dp.targetZMm);
    setTxt('val-dp3-target-z', `${state3dp.targetZMm} mm`);
    setVal('rng-dp3-custom-scale', state3dp.customScale.toFixed(2));
    setTxt('val-dp3-custom-scale', `${state3dp.customScale.toFixed(2)}×`);
    setVal('rng-dp3-margin', state3dp.marginMm);
    setTxt('val-dp3-margin', `${state3dp.marginMm} mm`);

    setVal('rng-dp3-rotx', state3dp.rotXDeg);
    setTxt('val-dp3-rotx', `${state3dp.rotXDeg}°`);
    setVal('rng-dp3-roty', state3dp.rotYDeg);
    setTxt('val-dp3-roty', `${state3dp.rotYDeg}°`);
    setVal('rng-dp3-rotz', state3dp.rotZDeg);
    setTxt('val-dp3-rotz', `${state3dp.rotZDeg}°`);

    setVal('sel-dp3-layer-h', state3dp.layerHeightMm.toFixed(2));
    setVal('sel-dp3-walls', state3dp.wallLoops);
    setVal('sel-dp3-support', state3dp.support);
    setVal('sel-dp3-brim', state3dp.brim);
    setVal('rng-dp3-infill', state3dp.infillPct);
    setTxt('val-dp3-infill', `${state3dp.infillPct}%`);
    setVal('rng-dp3-overhang', state3dp.overhangAngleDeg);
    setTxt('val-dp3-overhang', `${state3dp.overhangAngleDeg}°`);
}

function updateLayerScrubberUI() {
    const rng = $('rng-dp3-layer');
    const n = state3dp.layers.length;
    if (rng) {
        rng.disabled = n === 0;
        rng.min = '1';
        rng.max = String(Math.max(1, n));
        rng.value = String(n > 0 ? state3dp.currentLayerIdx + 1 : 1);
    }
    const zMm = n > 0 ? (Number(state3dp.layers[state3dp.currentLayerIdx]?.z) || 0) : 0;
    setTxt('dp3-layer-label', `Layer ${n > 0 ? state3dp.currentLayerIdx + 1 : 0} / ${n} · Z ${zMm.toFixed(1)} mm`);
}

function update3dpReadouts() {
    // CLI status pill
    if (!state3dp.bambuStatus.checked) {
        setBadge('dp3-cli-badge', 'CLI: Checking…', '');
    } else if (state3dp.bambuStatus.available) {
        setBadge('dp3-cli-badge', 'Bambu CLI Ready', 'pass');
    } else {
        setBadge('dp3-cli-badge', 'Local Slicer Only', 'warn');
    }

    setBadge('dp3-source-badge', `Src: ${state3dp.sourceLabel}`, state3dp.meshSnapshot ? 'info' : '');

    const btn3mf = $('btn-dp3-export-3mf');
    if (btn3mf) {
        const has3mf = Boolean(state3dp.downloadUrls?.threemf);
        btn3mf.disabled = !has3mf;
        btn3mf.title = has3mf
            ? 'Download Bambu Lab P1S sliced .3mf project'
            : 'Run Validate Bambu CLI first to generate a P1S .3mf';
    }

    // 1. Dimensional readout & strict P1S bed-fit gate
    const rp = state3dp.rescaled?.rescaledParams || null;
    const fitInfo = computeBedFitInfo(rp);
    const outBanner = $('dp3-out-of-bed-banner');
    const btnLocal = $('btn-dp3-slice-local');
    const btnBambu = $('btn-dp3-slice-bambu');
    const btnOpt = $('btn-dp3-optimize');

    if (rp) {
        setTxt('dp3-kv-voxel', `${fmtNum(rp.voxelSizeMm, 1)} mm`);
        setTxt('dp3-kv-outer-r', `${fmtNum(rp.outerRMm, 2)} mm`);
        setTxt('dp3-kv-min-wall', `${fmtNum(rp.wallThicknessMm, 2)} mm`);
        setTxt('dp3-kv-scale', `${fmtNum(rp.scaleFactor, 4)}×`);
        const sz = rp.bboxMm?.size || [0, 0, 0];
        setTxt('dp3-kv-bbox', `${fmtNum(sz[0], 1)} × ${fmtNum(sz[1], 1)} × ${fmtNum(sz[2], 1)} mm`);
        setBadge('dp3-bed-fit-badge', fitInfo.fitsBed ? `P1S FIT (${fmtNum(rp.bedUtilizationPct, 0)}%)` : 'OUT OF BED', fitInfo.fitsBed ? 'pass' : 'fail');
        if (outBanner) outBanner.classList.toggle('hidden', fitInfo.fitsBed);
        if (!fitInfo.fitsBed) {
            setTxt('dp3-out-of-bed-msg', `Exceeds 256×256×256 mm P1S bed (${formatOverflowText(fitInfo.overflowMm)}). Only geometry that fits inside the bed can be sliced.`);
        }
        const blockSlice = !fitInfo.fitsBed;
        if (btnLocal) btnLocal.disabled = blockSlice;
        if (btnBambu) btnBambu.disabled = blockSlice;
        if (btnOpt) btnOpt.disabled = blockSlice;
    } else {
        setTxt('dp3-kv-voxel', '—');
        setTxt('dp3-kv-outer-r', '—');
        setTxt('dp3-kv-min-wall', '—');
        setTxt('dp3-kv-scale', '—');
        setTxt('dp3-kv-bbox', '—');
        setBadge('dp3-bed-fit-badge', 'No Mesh', '');
        if (outBanner) outBanner.classList.add('hidden');
        if (btnLocal) btnLocal.disabled = true;
        if (btnBambu) btnBambu.disabled = true;
        if (btnOpt) btnOpt.disabled = true;
    }

    // 2. Slicer & Scorecard
    if (state3dp.sliceSource === 'bambu_cli') {
        setBadge('dp3-slice-source-badge', 'Bambu CLI Validated', 'pass');
    } else if (state3dp.sliceSource === 'local') {
        setBadge('dp3-slice-source-badge', 'Local Preview', 'info');
    } else {
        setBadge('dp3-slice-source-badge', 'Not Sliced', '');
    }

    const an = state3dp.analysis;
    const sum = state3dp.sliceSummary;
    const timeStr = sum?.printTimeFormatted || sum?.estimatedTimeStr || fmtMinutes(sum?.printTimeMin ?? sum?.estimatedTimeMin ?? an?.estimatedPrintTimeMin);
    const filG = sum?.totalFilamentG;
    const suppG = sum?.supportFilamentG;
    const suppPct = sum?.supportPct ?? an?.estimatedSupportRatioPct;

    setTxt('dp3-sc-time', timeStr || '—');
    setTxt('dp3-sc-filament', Number.isFinite(filG) ? `${fmtNum(filG, 1)} g` : (an ? `${fmtNum(an.volumeCm3 * 1.24, 1)} g est` : '—'));
    setTxt('dp3-sc-support', Number.isFinite(suppG)
        ? `${fmtNum(suppG, 1)} g (${fmtNum(suppPct, 1)}%)`
        : (Number.isFinite(suppPct) ? `${fmtNum(suppPct, 1)}% est` : '—'));
    setTxt('dp3-sc-layers', state3dp.layers.length > 0 ? String(state3dp.layers.length) : (rp ? `${Math.ceil((rp.bboxMm.size[2] || 0) / state3dp.layerHeightMm)} est` : '—'));
    setTxt('dp3-sc-overhang', an ? `${fmtNum(an.overhangAreaPct, 1)}% (${fmtNum(an.criticalOverhangPct, 1)}% crit)` : '—');
    setTxt('dp3-sc-wall', rp ? (rp.thinWallWarning ? 'WARN (<0.84mm)' : 'PASS (≥0.84mm)') : '—');

    const score = sum?.printabilityScore ?? an?.printabilityScore;
    if (Number.isFinite(score)) {
        const tone = score >= 75 ? 'pass' : (score >= 50 ? 'warn' : 'fail');
        setBadge('dp3-score-badge', `Score: ${Math.round(score)}/100`, tone);
    } else {
        setBadge('dp3-score-badge', 'Score: —', '');
    }

    updateLayerScrubberUI();
}

function renderOptTable() {
    const tbody = $('dp3-opt-tbody');
    const btnApply = $('btn-dp3-apply-best');
    if (!tbody) return;

    const opt = state3dp.optResult;
    if (!opt || !Array.isArray(opt.candidates) || opt.candidates.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-gray-400 py-2">Run optimizer to rank P1S recipes</td></tr>';
        if (btnApply) btnApply.disabled = true;
        setBadge('dp3-opt-badge', 'Idle', '');
        return;
    }

    if (btnApply) btnApply.disabled = false;
    setBadge('dp3-opt-badge', opt.source === 'bambu_cli' ? 'CLI Ranked' : 'Ranked', 'pass');

    tbody.innerHTML = opt.candidates.slice(0, 8).map((c, i) => {
        const rot = c.orientationDeg || c.rotationDeg || { x: 0, y: 0, z: 0 };
        const sOpts = c.slicerOpts || c.options || c;
        const suppPct = c.metrics?.supportPct ?? c.supportPct ?? c.analysis?.estimatedSupportRatioPct;
        const timeMin = c.metrics?.printTimeMin ?? c.metrics?.estimatedTimeMin ?? c.printTimeMin ?? c.analysis?.estimatedPrintTimeMin;
        const candScore = c.metrics?.printabilityScore ?? c.score;
        const cls = i === 0 ? 'is-best' : (i === state3dp.selectedCandidateIdx ? 'is-selected' : '');
        const tag = i === 0 ? '★1' : (c.isBaseline ? 'Base' : String(i + 1));
        return `<tr class="${cls}" data-dp3-cand="${i}" title="${escapeHtml(c.label || '')}">` +
            `<td>${tag}</td>` +
            `<td>${rot.x}/${rot.y}/${rot.z}°</td>` +
            `<td>${escapeHtml(sOpts.support || 'tree')} ${sOpts.supportAngle || 35}°</td>` +
            `<td>${fmtNum(suppPct, 1)}%</td>` +
            `<td>${fmtMinutes(timeMin)}</td>` +
            `<td><strong>${Math.round(Number(candScore) || 0)}</strong></td>` +
            `</tr>`;
    }).join('');
}

// ============================================================================
// 7. Lifecycle & Event Wiring
// ============================================================================
export function initTab3dp() {
    if (state3dp.initialized) return;
    state3dp.initialized = true;

    ensurePrint3dpGroup();

    // Register strictly isolated tab-switch hooks for display_hud.js
    actions.onEnter3dpTab = () => {
        syncSnapshotIfChanged({ reason: 'tab-enter' });
        apply3dpVisibility();
        fitP1SCamera();
        if (!state3dp.bambuStatus.checked) {
            checkBambuStatus();
        }
    };

    actions.onLeave3dpTab = () => {
        stopLayerPlayback();
        if (print3dpGroup) print3dpGroup.visible = false;
        if (viewport.mainGroup) viewport.mainGroup.visible = true;
        if (viewport.gridHelper) viewport.gridHelper.visible = appState.groupVis.grid;
        if (typeof updateBoundingBox3D === 'function') updateBoundingBox3D();
        requestRender(10);
    };

    actions.apply3dpVisibility = apply3dpVisibility;

    actions.get3dpOverlayMetrics = () => {
        const rp = state3dp.rescaled?.rescaledParams || null;
        if (!rp || !rp.bboxMm) {
            return {
                sourceLabel: state3dp.sourceLabel,
                fitsBed: false,
                overflowMm: { x: 0, y: 0, z: 0 },
                bboxMm: null,
                sceneBBox: null,
                layerCount: state3dp.layers.length,
                sliceSource: state3dp.sliceSource
            };
        }
        const bb = rp.bboxMm;
        const fitInfo = computeBedFitInfo(rp);
        return {
            sourceLabel: state3dp.sourceLabel,
            fitsBed: fitInfo.fitsBed,
            overflowMm: fitInfo.overflowMm,
            bboxMm: bb,
            sceneBBox: {
                min: [
                    (bb.min[0] - BED_HALF_X) * MM_TO_SCENE,
                    (bb.min[1] - BED_HALF_Y) * MM_TO_SCENE,
                    bb.min[2] * MM_TO_SCENE
                ],
                max: [
                    (bb.max[0] - BED_HALF_X) * MM_TO_SCENE,
                    (bb.max[1] - BED_HALF_Y) * MM_TO_SCENE,
                    bb.max[2] * MM_TO_SCENE
                ]
            },
            layerCount: state3dp.layers.length,
            sliceSource: state3dp.sliceSource
        };
    };

    // Quick Auto-Fit button inside OUT OF BED banner
    $('btn-dp3-auto-fit-bed')?.addEventListener('click', () => {
        state3dp.fitMode = 'fit-bed';
        syncControlsFromState();
        recomputeRescaleAndAnalysis();
        fitP1SCamera();
    });

    // Header actions
    $('btn-dp3-sync')?.addEventListener('click', () => {
        syncSnapshotFromWorkbench();
        fitP1SCamera();
    });
    $('btn-dp3-fit-cam')?.addEventListener('click', () => fitP1SCamera());
    $('btn-dp3-export-stl')?.addEventListener('click', () => exportRescaledSTL());
    $('btn-dp3-export-3mf')?.addEventListener('click', () => exportBambu3MF());

    $('chk-dp3-preview')?.addEventListener('change', (e) => {
        state3dp.showPreview = e.target.checked;
        apply3dpVisibility();
    });
    $('chk-dp3-isolate')?.addEventListener('change', (e) => {
        state3dp.hideOriginalModel = e.target.checked;
        apply3dpVisibility();
    });

    // Fit mode buttons
    document.querySelectorAll('.dp3-fit-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            state3dp.fitMode = btn.dataset.dp3Fit || 'fit-bed';
            syncControlsFromState();
            recomputeRescaleAndAnalysis();
        });
    });

    // Rescaler sliders
    $('rng-dp3-target-z')?.addEventListener('input', (e) => {
        state3dp.targetZMm = Number(e.target.value) || 180;
        if (state3dp.fitMode !== 'target-z') state3dp.fitMode = 'target-z';
        syncControlsFromState();
        recomputeRescaleAndAnalysis();
    });
    $('rng-dp3-custom-scale')?.addEventListener('input', (e) => {
        state3dp.customScale = Number(e.target.value) || 0.1;
        state3dp.fitMode = 'custom-scale';
        syncControlsFromState();
        recomputeRescaleAndAnalysis();
    });
    $('rng-dp3-margin')?.addEventListener('input', (e) => {
        state3dp.marginMm = Number(e.target.value) || 8;
        setTxt('val-dp3-margin', `${state3dp.marginMm} mm`);
        recomputeRescaleAndAnalysis();
    });

    // Rotation sliders & +90° buttons
    const bindRot = (id, valId, key) => {
        $(id)?.addEventListener('input', (e) => {
            state3dp[key] = Number(e.target.value) || 0;
            setTxt(valId, `${state3dp[key]}°`);
            recomputeRescaleAndAnalysis();
        });
    };
    bindRot('rng-dp3-rotx', 'val-dp3-rotx', 'rotXDeg');
    bindRot('rng-dp3-roty', 'val-dp3-roty', 'rotYDeg');
    bindRot('rng-dp3-rotz', 'val-dp3-rotz', 'rotZDeg');

    document.querySelectorAll('[data-dp3-rot90]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const axis = btn.dataset.dp3Rot90;
            const key = axis === 'x' ? 'rotXDeg' : (axis === 'y' ? 'rotYDeg' : 'rotZDeg');
            state3dp[key] = (state3dp[key] + 90) % 360;
            syncControlsFromState();
            recomputeRescaleAndAnalysis();
        });
    });

    // Slicer controls
    $('sel-dp3-layer-h')?.addEventListener('change', (e) => {
        state3dp.layerHeightMm = Number(e.target.value) || 0.20;
        recomputeRescaleAndAnalysis({ clearToolpaths: false });
    });
    $('sel-dp3-walls')?.addEventListener('change', (e) => {
        state3dp.wallLoops = Number(e.target.value) || 2;
        recomputeRescaleAndAnalysis({ clearToolpaths: false });
    });
    $('sel-dp3-support')?.addEventListener('change', (e) => {
        state3dp.support = e.target.value || 'tree(auto)';
        recomputeRescaleAndAnalysis({ clearToolpaths: false });
    });
    $('sel-dp3-brim')?.addEventListener('change', (e) => {
        state3dp.brim = e.target.value || 'auto';
        recomputeRescaleAndAnalysis({ clearToolpaths: false });
    });
    $('rng-dp3-infill')?.addEventListener('input', (e) => {
        state3dp.infillPct = Number(e.target.value) || 15;
        setTxt('val-dp3-infill', `${state3dp.infillPct}%`);
    });
    $('rng-dp3-overhang')?.addEventListener('input', (e) => {
        state3dp.overhangAngleDeg = Number(e.target.value) || 35;
        setTxt('val-dp3-overhang', `${state3dp.overhangAngleDeg}°`);
        recomputeRescaleAndAnalysis({ clearToolpaths: false });
    });

    // Slice actions
    $('btn-dp3-slice-local')?.addEventListener('click', () => runLocalSlice());
    $('btn-dp3-slice-bambu')?.addEventListener('click', () => runBambuCLISlice());

    // Layer scrubber & display toggles
    $('rng-dp3-layer')?.addEventListener('input', (e) => {
        stopLayerPlayback();
        setCurrentLayer(Number(e.target.value));
    });
    $('btn-dp3-play')?.addEventListener('click', () => toggleLayerPlayback());
    $('chk-dp3-lower')?.addEventListener('change', (e) => {
        state3dp.showLowerLayers = e.target.checked;
        renderToolpathLayers();
        requestRender(4);
    });
    $('chk-dp3-travel')?.addEventListener('change', (e) => {
        state3dp.showTravel = e.target.checked;
        renderToolpathLayers();
        requestRender(4);
    });
    $('chk-dp3-heatmap')?.addEventListener('change', (e) => {
        state3dp.showOverhangHeatmap = e.target.checked;
        renderRescaledModelMesh();
        requestRender(4);
    });

    // Optimizer controls
    $('btn-dp3-optimize')?.addEventListener('click', () => runPrintabilityOptimizer());
    $('btn-dp3-apply-best')?.addEventListener('click', () => applyCandidateRecipe(0));
    $('dp3-opt-tbody')?.addEventListener('click', (e) => {
        const tr = e.target.closest('tr[data-dp3-cand]');
        if (!tr) return;
        const idx = Number(tr.dataset.dp3Cand);
        if (Number.isFinite(idx)) applyCandidateRecipe(idx);
    });

    syncControlsFromState();
    update3dpReadouts();
}

// ============================================================================
// 8. Isolated Public API (`window.WFC_WORKBENCH.print3dp`)
// ============================================================================
export const print3dpApi = {
    get spec() { return P1S_SPEC; },
    get group() { return print3dpGroup; },
    getState: () => ({
        active: state3dp.active,
        sourceLabel: state3dp.sourceLabel,
        hasSnapshot: Boolean(state3dp.meshSnapshot),
        showPreview: state3dp.showPreview,
        hideOriginalModel: state3dp.hideOriginalModel,
        fitMode: state3dp.fitMode,
        targetZMm: state3dp.targetZMm,
        marginMm: state3dp.marginMm,
        rotationDeg: { x: state3dp.rotXDeg, y: state3dp.rotYDeg, z: state3dp.rotZDeg },
        slicer: currentSlicerOpts(),
        rescaledParams: state3dp.rescaled?.rescaledParams || null,
        analysis: state3dp.analysis ? {
            printabilityScore: state3dp.analysis.printabilityScore,
            overhangAreaPct: state3dp.analysis.overhangAreaPct,
            criticalOverhangPct: state3dp.analysis.criticalOverhangPct,
            bedContactAreaMm2: state3dp.analysis.bedContactAreaMm2,
            fitsBed: state3dp.analysis.fitsBed
        } : null,
        sliceSource: state3dp.sliceSource,
        layerCount: state3dp.layers.length,
        currentLayer: state3dp.layers.length > 0 ? state3dp.currentLayerIdx + 1 : 0,
        sliceSummary: state3dp.sliceSummary,
        lastValidatedJobId: state3dp.lastValidatedJobId,
        downloadUrls: state3dp.downloadUrls ? { ...state3dp.downloadUrls } : null,
        bambuStatus: { ...state3dp.bambuStatus },
        optimizerCandidates: state3dp.optResult?.candidates?.length || 0
    }),
    syncSnapshot: syncSnapshotFromWorkbench,
    syncIfChanged: syncSnapshotIfChanged,
    getGeometrySignature: computeWorkbenchGeometrySignature,
    configure: (opts = {}) => {
        if (opts.fitMode) state3dp.fitMode = String(opts.fitMode);
        if (opts.targetZMm !== undefined) state3dp.targetZMm = Number(opts.targetZMm);
        if (opts.customScale !== undefined) state3dp.customScale = Number(opts.customScale);
        if (opts.marginMm !== undefined) state3dp.marginMm = Number(opts.marginMm);
        if (opts.rotXDeg !== undefined) state3dp.rotXDeg = Number(opts.rotXDeg);
        if (opts.rotYDeg !== undefined) state3dp.rotYDeg = Number(opts.rotYDeg);
        if (opts.rotZDeg !== undefined) state3dp.rotZDeg = Number(opts.rotZDeg);
        if (opts.layerHeightMm !== undefined) state3dp.layerHeightMm = Number(opts.layerHeightMm);
        if (opts.wallLoops !== undefined) state3dp.wallLoops = Number(opts.wallLoops);
        if (opts.infillPct !== undefined) state3dp.infillPct = Number(opts.infillPct);
        if (opts.support !== undefined) state3dp.support = String(opts.support);
        if (opts.overhangAngleDeg !== undefined) state3dp.overhangAngleDeg = Number(opts.overhangAngleDeg);
        if (opts.brim !== undefined) state3dp.brim = String(opts.brim);
        if (opts.showOverhangHeatmap !== undefined) state3dp.showOverhangHeatmap = Boolean(opts.showOverhangHeatmap);
        if (opts.showLowerLayers !== undefined) state3dp.showLowerLayers = Boolean(opts.showLowerLayers);
        if (opts.showTravel !== undefined) state3dp.showTravel = Boolean(opts.showTravel);
        syncControlsFromState();
        recomputeRescaleAndAnalysis();
        return print3dpApi.getState();
    },
    sliceLocal: runLocalSlice,
    sliceBambuCLI: runBambuCLISlice,
    optimize: runPrintabilityOptimizer,
    applyBestRecipe: () => applyCandidateRecipe(0),
    applyCandidate: applyCandidateRecipe,
    setLayer: setCurrentLayer,
    togglePlayback: toggleLayerPlayback,
    exportSTL: exportRescaledSTL,
    export3MF: exportBambu3MF,
    fitCamera: fitP1SCamera,
    checkBambuStatus
};

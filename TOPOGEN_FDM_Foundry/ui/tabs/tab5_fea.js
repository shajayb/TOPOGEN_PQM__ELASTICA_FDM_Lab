/**
 * WFC-FDM Foundry — Tab 5: 3D Space-Frame FEA Analysis, Contours & Animation (ui/tabs/tab5_fea.js)
 *
 * Student Quick-Map:
 *   - Edit Tab 5 materials, load slider & scorecard layout  -> mountTab5Fea()
 *   - Edit 3D contour colormap (axial / stress / buckling)  -> sampleContourColor()
 *   - Edit 3D deflected struts, support cones & force arrows -> renderFEAResults3D()
 *   - Edit harmonic breathing deflection animation          -> setFEAAnimation(), tickFEAAnimation()
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    FEA_MATERIALS,
    $,
    $$,
    setTxt
} from '../state/workbench_state.js';
import {
    viewport,
    sharedMaterials,
    clearGroup,
    makeFatMaterial,
    makeFatLineSegments,
    recomputeModelBox,
    drawOverlay
} from '../display/viewport_scene.js';
import { applyOutlinerVisibility } from '../display/display_hud.js';
import { expandTelemetryHudForFEA, emitFEATelemetry, emitProcessTelemetry } from '../display/telemetry_hud.js';

const _cCompHi = new THREE.Color(0x1d4ed8);
const _cTensHi = new THREE.Color(0xef4444);
const _cCyan = new THREE.Color(0x06b6d4);
const _cAmber = new THREE.Color(0xf59e0b);
const _feaArrowUp = new THREE.Vector3(0, 1, 0);
const _feaTmpColor = new THREE.Color();
const feaJointMatPool = [];

let feaMaterials3D = null;
function ensureFea3DAssets() {
    if (feaMaterials3D) return feaMaterials3D;
    const unitSphere = new THREE.SphereGeometry(1, 10, 10);
    unitSphere.userData.shared = true;
    const unitCone = new THREE.ConeGeometry(2.1, 3.0, 12);
    unitCone.rotateX(Math.PI * 0.5);
    unitCone.userData.shared = true;
    const arrowCone = new THREE.ConeGeometry(1, 1, 10);
    arrowCone.translate(0, -0.5, 0);
    arrowCone.userData.shared = true;

    feaMaterials3D = {
        strut: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08, side: THREE.DoubleSide }),
        ghost: new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.42 }),
        loadCone: new THREE.MeshBasicMaterial({ color: 0xf43f5e }),
        loadLine: new THREE.LineBasicMaterial({ color: 0xf43f5e }),
        reactCone: new THREE.MeshBasicMaterial({ color: 0x10b981 }),
        reactLine: new THREE.LineBasicMaterial({ color: 0x10b981 }),
        unitSphere,
        unitCone,
        arrowCone
    };
    return feaMaterials3D;
}

export function mountTab5Fea() {
    const pane = $('tab-fea');
    if (!pane) return;
    pane.innerHTML = `
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2.5 space-y-2 text-[10px] font-mono">
            <div class="flex items-center justify-between font-sans">
                <span class="text-[10.5px] font-semibold uppercase tracking-wider text-emerald-300">3D Space-Frame FEA</span>
                <span id="fea-verdict-badge" class="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">Ready</span>
            </div>
            <p class="goldilocks-guide-prose text-[9.5px] font-sans text-gray-400 leading-snug">
                3D Euler-Bernoulli space-frame stiffness solver evaluating self-weight + top load, axial/bending stress &amp; Euler buckling.
            </p>

            <div class="flex items-center justify-between space-x-2">
                <span class="text-gray-400">Material</span>
                <select id="sel-fea-material" class="flex-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-100">
                    <option value="plaster" selected>Cast Gypsum Plaster</option>
                    <option value="gfrg">GFRG Composite</option>
                    <option value="timber">Timber (C24)</option>
                    <option value="steel">Steel (S235)</option>
                </select>
            </div>

            <div class="flex items-center space-x-2">
                <span class="text-gray-400 w-20">Top Load (kg)</span>
                <input type="range" id="rng-fea-load-kg" min="0" max="500" step="5" value="25" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-emerald-400">
                <input type="number" id="num-fea-load-kg" min="0" max="2000" step="5" value="25" class="w-12 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
            </div>

            <div class="flex items-center justify-between space-x-2 font-sans">
                <span class="text-[9.5px] text-gray-400 font-mono">Supports</span>
                <div class="grid grid-cols-2 gap-1 flex-1">
                    <button data-fea-support="pinned" class="fea-support-btn cad-btn seg-on text-[9px] py-0.5">Pinned (3-DOF)</button>
                    <button data-fea-support="fixed"  class="fea-support-btn cad-btn text-[9px] py-0.5">Fixed (6-DOF)</button>
                </div>
            </div>

            <!-- Coupled Elastica Rods: Bracing, Post-Tensioning & Active-Bending -->
            <div class="bg-gray-950/85 border border-gray-800 rounded p-1.5 space-y-1.5 font-sans">
                <div class="flex items-center justify-between">
                    <label class="flex items-center space-x-1.5 cursor-pointer text-[9.5px] font-semibold text-amber-300" title="Exclude Host Graph — Solve 3D FEA on Elastica rods only, omitting space-frame graph members.">
                        <input type="checkbox" id="chk-fea-exclude-graph" class="accent-amber-400 rounded">
                        <span>Exclude Graph from FEA</span>
                    </label>
                    <span id="fea-graph-badge" class="text-[8.5px] font-mono text-gray-400">Included</span>
                </div>
                <div class="flex items-center justify-between">
                    <label class="flex items-center space-x-1.5 cursor-pointer text-[9.5px] font-semibold text-cyan-300" title="Coupled Elastica — Add curved rods and prestress into frame analysis.">
                        <input type="checkbox" id="chk-fea-include-elastica" class="accent-cyan-400 rounded">
                        <span>Include Elastica Rods</span>
                    </label>
                    <span id="fea-elastica-badge" class="text-[8.5px] font-mono text-gray-400">Off</span>
                </div>
                <div id="fea-elastica-controls" class="space-y-1 text-[9px] font-mono">
                    <div class="flex items-center justify-between space-x-1.5">
                        <span class="text-gray-400 flex-shrink-0">Rod Mat</span>
                        <select id="sel-fea-elastica-mat" class="flex-1 bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[9px] text-gray-100">
                            <option value="gfrp_rod" selected>GFRP Elastic Rod (38 GPa)</option>
                            <option value="steel">Steel Tendon/Rod (210 GPa)</option>
                            <option value="timber">Timber Lath/Rod (11 GPa)</option>
                            <option value="same">Same as Host Frame</option>
                        </select>
                    </div>
                    <div class="flex items-center space-x-1.5" title="Post-tensioning (+N pulls &amp; compressively tightens host frame) or pre-compression (-N)">
                        <span class="text-gray-400 w-16 flex-shrink-0">Pre-Tens</span>
                        <input type="range" id="rng-fea-elastica-prestress" min="-100" max="250" step="5" value="15" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-amber-400">
                        <span id="val-fea-elastica-prestress" class="w-12 text-right text-amber-300 flex-shrink-0">+15N</span>
                    </div>
                    <label class="flex items-center space-x-1.5 cursor-pointer text-[8.5px] font-sans text-gray-300" title="Cold-Bent Springback — Include active-bending straightening moments in rods.">
                        <input type="checkbox" id="chk-fea-elastica-activebend" class="accent-pink-500 rounded">
                        <span>Cold-Bent Springback (M₀ = EIκ)</span>
                    </label>
                </div>
            </div>

            <button id="btn-run-fea" class="cad-btn on w-full py-1.5 font-sans">⚡ Run 3D FEA</button>

            <!-- FEA Process Telemetry & Progress Bar -->
            <div id="fea-proc-card" class="proc-progress-card">
                <div class="proc-progress-header">
                    <span id="fea-proc-title" class="proc-progress-title">FEA Solver Telemetry</span>
                    <span class="proc-progress-meta">
                        <span id="fea-proc-elapsed">0 ms</span>
                        <span id="fea-proc-pct" class="dp3-badge">Idle</span>
                    </span>
                </div>
                <div class="proc-progress-track">
                    <div id="fea-proc-fill" class="proc-progress-fill" style="width:0%"></div>
                </div>
                <div id="fea-proc-stage" class="proc-stage-line">Ready to run 3D Euler-Bernoulli space-frame FEA.</div>
                <div class="proc-telemetry-grid">
                    <div class="proc-telemetry-kv">
                        <span class="proc-telemetry-k">Nodes / Elem</span>
                        <span id="fea-pt-model" class="proc-telemetry-v">—</span>
                    </div>
                    <div class="proc-telemetry-kv">
                        <span class="proc-telemetry-k">Active DOFs</span>
                        <span id="fea-pt-dofs" class="proc-telemetry-v">—</span>
                    </div>
                    <div class="proc-telemetry-kv">
                        <span class="proc-telemetry-k">Solve Time</span>
                        <span id="fea-pt-solve" class="proc-telemetry-v">—</span>
                    </div>
                    <div class="proc-telemetry-kv">
                        <span class="proc-telemetry-k">Disp / Min SF</span>
                        <span id="fea-pt-peak" class="proc-telemetry-v">—</span>
                    </div>
                </div>
                <pre id="fea-proc-log" class="proc-log">Idle — awaiting FEA solve or deflection playback.</pre>
            </div>
        </div>

        <div class="bg-gray-900/90 border border-gray-700 rounded p-2.5 space-y-2 text-[10px]">
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-300">3D Contour &amp; Deflection</span>
                <span id="fea-vis-unit-badge" class="text-[9px] font-mono text-cyan-400">N (Comp/Tens)</span>
            </div>
            <div class="grid grid-cols-2 gap-1">
                <button data-fea-vis="axial"      class="fea-vis-btn cad-btn seg-on text-[9px] py-1">Axial Force (C/T)</button>
                <button data-fea-vis="stress"     class="fea-vis-btn cad-btn text-[9px] py-1">Peak Tensile Stress</button>
                <button data-fea-vis="buckling"   class="fea-vis-btn cad-btn text-[9px] py-1">Buckling Util.</button>
                <button data-fea-vis="deflection" class="fea-vis-btn cad-btn text-[9px] py-1">Deflection Mag.</button>
            </div>

            <div class="space-y-0.5 font-mono text-[8.5px]">
                <div id="fea-legend-bar" class="h-2 w-full rounded border border-gray-700" style="background: linear-gradient(90deg, #2563eb 0%, #06b6d4 45%, #f59e0b 75%, #ef4444 100%);"></div>
                <div class="flex justify-between text-gray-400">
                    <span id="fea-legend-min">Comp</span>
                    <span id="fea-legend-mid">0</span>
                    <span id="fea-legend-max">Tens</span>
                </div>
            </div>

            <div class="flex items-center space-x-2 font-mono">
                <span class="text-gray-400 text-[9.5px]">Exaggeration</span>
                <input type="range" id="rng-fea-exag" min="1" max="200" step="1" value="50" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-fea-exag" class="whitespace-nowrap text-right text-pink-300 font-semibold text-[9px]">50×</span>
            </div>

            <div class="flex items-center justify-between gap-2 text-[9.5px] text-gray-300 pt-0.5">
                <button type="button" id="btn-fea-animate" class="cad-btn cyan flex-1 py-1 font-sans flex items-center justify-center gap-1" aria-pressed="false" title="Animate Deflection — Oscillate between undeformed frame and deflected shape.">
                    <span id="lbl-fea-animate">▶ Animate Deflection</span>
                </button>
                <input type="checkbox" id="chk-fea-animate" class="hidden" aria-hidden="true">
                <label class="flex items-center space-x-1 cursor-pointer flex-shrink-0 px-1">
                    <input type="checkbox" id="chk-fea-arrows" checked class="accent-emerald-400 rounded">
                    <span>Force Arrows</span>
                </label>
            </div>
        </div>

        <div class="bg-gray-900/90 border border-gray-700 rounded p-2.5 space-y-1.5 font-mono text-[9.5px]">
            <div class="flex items-center justify-between font-sans">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Structural Scorecard</span>
                <span id="fea-limit-note" class="text-[8.5px] font-mono text-gray-400">L/300 · SFt≥1.5 · SFc/b≥2.0</span>
            </div>
            <div class="grid grid-cols-3 gap-1.5">
                <div class="bg-gray-950/80 border border-gray-800 rounded p-1.5"><div class="text-[8px] text-gray-400 uppercase">SF_t (Tens)</div><div id="fea-kpi-sft" class="text-[11px] font-bold text-gray-200">—</div></div>
                <div class="bg-gray-950/80 border border-gray-800 rounded p-1.5"><div class="text-[8px] text-gray-400 uppercase">SF_c (Comp)</div><div id="fea-kpi-sfc" class="text-[11px] font-bold text-gray-200">—</div></div>
                <div class="bg-gray-950/80 border border-gray-800 rounded p-1.5"><div class="text-[8px] text-gray-400 uppercase">SF_b (Buckl)</div><div id="fea-kpi-sfb" class="text-[11px] font-bold text-gray-200">—</div></div>
                <div class="bg-gray-950/80 border border-gray-800 rounded p-1.5"><div class="text-[8px] text-gray-400 uppercase">Max Disp</div><div id="fea-kpi-disp" class="text-[10px] font-bold text-gray-200 truncate">—</div></div>
                <div class="bg-gray-950/80 border border-gray-800 rounded p-1.5"><div class="text-[8px] text-gray-400 uppercase">Funicular Eff</div><div id="fea-kpi-funi" class="text-[11px] font-bold text-gray-200">—</div></div>
                <div class="bg-gray-950/80 border border-gray-800 rounded p-1.5"><div class="text-[8px] text-gray-400 uppercase">Comp Dom.</div><div id="fea-kpi-comp" class="text-[10px] font-bold text-gray-200 truncate">—</div></div>
            </div>
            <div id="fea-readout" class="text-[8.5px] text-gray-400 pt-0.5 truncate">
                Click ⚡ Run 3D FEA to solve axial forces, bending moments &amp; reactions.
            </div>
        </div>

        <div class="bg-gray-900/90 border border-gray-700 rounded p-2.5 space-y-1.5 font-mono text-[9px]">
            <div class="flex items-center justify-between font-sans">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">FEA Telemetry Console</span>
                <div class="flex items-center space-x-1">
                    <span id="fea-tel-run-badge" class="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">FEA #0</span>
                    <button type="button" id="btn-fea-hud-toggle" class="cad-btn text-[8px] px-1.5 py-0.5" title="Expand / Focus TOPOGEN-PQ-FDM-FEA Telemetry HUD">HUD ↗</button>
                </div>
            </div>
            <pre id="fea-telemetry-console" class="bg-gray-950/95 border border-gray-800 rounded p-2 text-[8.5px] leading-[1.42] text-gray-200 whitespace-pre-wrap break-words max-h-44 overflow-y-auto m-0">Awaiting ⚡ Run 3D FEA — telemetry will stream 12-DOF Euler-Bernoulli solver DOFs, section A/I, material, load cases, reactions &amp; safety factors.</pre>
        </div>
    `;
}

export function sampleContourColor(mode, val, minVal, maxVal, outColor) {
    if (mode === 'axial') {
        if (val <= 0) outColor.setHex(0x67e8f9).lerp(_cCompHi, Math.min(1, Math.abs(val) / Math.max(1e-6, Math.abs(minVal))));
        else outColor.setHex(0xfbbf24).lerp(_cTensHi, Math.min(1, val / Math.max(1e-6, maxVal)));
        return outColor;
    }
    const u = Math.max(0, Math.min(1, (val - minVal) / Math.max(1e-9, maxVal - minVal)));
    if (u < 0.35) outColor.setHex(0x10b981).lerp(_cCyan, u / 0.35);
    else if (u < 0.7) outColor.setHex(0x06b6d4).lerp(_cAmber, (u - 0.35) / 0.35);
    else outColor.setHex(0xf59e0b).lerp(_cTensHi, (u - 0.7) / 0.3);
    return outColor;
}

function getCharacteristicSpanM() {
    let maxVertSpan = 0;
    const activeG = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (activeG && Array.isArray(activeG.vertices) && activeG.vertices.length > 1) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (const p of activeG.vertices) {
            if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
            if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
            if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
        }
        maxVertSpan = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    }
    return Math.max(0.5, maxVertSpan || 0, (appState.lastFEAResult && appState.lastFEAResult.characteristicLengthM) || 2.0);
}

export function computeEffectiveExaggeration(rawExag = appState.feaState.exaggeration) {
    const raw = Math.max(0, Number(rawExag) || 0);
    const { lastFEAResult } = appState;
    if (!lastFEAResult || !(lastFEAResult.maxDispM > 0) || !Number.isFinite(lastFEAResult.maxDispM) || raw <= 0) return raw;
    const minVisualDeflM = getCharacteristicSpanM() * (raw / 1200);
    return (lastFEAResult.maxDispM * raw < minVisualDeflM) ? (minVisualDeflM / lastFEAResult.maxDispM) : raw;
}

export function updateExaggerationBadgeUI() {
    const lbl = $('val-fea-exag');
    if (!lbl) return;
    const raw = Math.round(appState.feaState.exaggeration);
    const eff = computeEffectiveExaggeration(raw);
    const { lastFEAResult } = appState;
    if (lastFEAResult && eff > raw * 1.05) {
        const uMm = Number(lastFEAResult.maxDispMm || 0);
        const uTxt = uMm > 0 && uMm < 0.1 ? uMm.toFixed(3) : uMm.toFixed(2);
        lbl.textContent = `${raw}× (auto-vis)`;
        lbl.title = `Deflection Scale — Peak ${uTxt} mm shown at ${Math.round(eff)}× visual scale.`;
    } else {
        lbl.textContent = `${raw}×`;
        lbl.title = `True deflection exaggeration: ${raw}×`;
    }
}

export function renderFEAResults3D(exagScale = computeEffectiveExaggeration(appState.feaState.exaggeration)) {
    const assets = ensureFea3DAssets();
    clearGroup(viewport.feaGroup);
    const { lastFEAResult, feaState, tubeState, elasticaState } = appState;
    const feaSrc = (lastFEAResult && lastFEAResult._sourceGraph) || (actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null);
    if (!lastFEAResult || !feaSrc) return;

    const verts = feaSrc.vertices, edges = feaSrc.edges;
    const disps = lastFEAResult.nodalDisplacements || verts.map(() => [0, 0, 0]);
    const members = lastFEAResult.members || [];

    const ghostPos = new Float32Array(edges.length * 6);
    for (let i = 0; i < edges.length; i++) {
        const [u, v] = edges[i];
        const pu = verts[u], pv = verts[v], o = i * 6;
        ghostPos[o] = pu[0]; ghostPos[o + 1] = pu[1]; ghostPos[o + 2] = pu[2];
        ghostPos[o + 3] = pv[0]; ghostPos[o + 4] = pv[1]; ghostPos[o + 5] = pv[2];
    }
    const ghostLines = makeFatLineSegments(
        ghostPos,
        makeFatMaterial(0x94a3b8, appState.edgeDisplayWidthPx || 1.5, {
            disposeOnClear: true,
            transparent: true,
            opacity: 0.45
        })
    );
    viewport.feaGroup.add(ghostLines);

    const defVerts = verts.map((p, idx) => {
        const d = disps[idx] || [0, 0, 0];
        return new THREE.Vector3(p[0] + d[0] * exagScale, p[1] + d[1] * exagScale, p[2] + d[2] * exagScale);
    });

    const mode = feaState.visMode;
    let minVal = 0, maxVal = 1, actualMaxStressPa = 0;
    if (mode === 'axial') {
        minVal = -1; maxVal = 1;
        for (const m of members) { if (m.axialForceN < minVal) minVal = m.axialForceN; if (m.axialForceN > maxVal) maxVal = m.axialForceN; }
    } else if (mode === 'stress') {
        for (const m of members) if ((m.sigmaTensilePa || 0) > actualMaxStressPa) actualMaxStressPa = m.sigmaTensilePa;
        maxVal = Math.max(1e3, actualMaxStressPa);
    } else if (mode === 'buckling') {
        maxVal = 0.01;
        for (const m of members) {
            const bu = m.axialForceN < 0 ? Math.abs(m.axialForceN) / Math.max(1e-6, m.bucklingLoadN) : 0;
            if (bu > maxVal) maxVal = bu;
        }
        maxVal = Math.max(maxVal, 0.5);
    } else {
        maxVal = Math.max(1e-6, lastFEAResult.maxDispM || 1e-4);
    }

    const lBar = $('fea-legend-bar');
    if (mode === 'axial') {
        setTxt('fea-vis-unit-badge', 'Axial Force (N)');
        setTxt('fea-legend-min', `${Math.round(minVal)} N (C)`);
        setTxt('fea-legend-mid', '0 N');
        setTxt('fea-legend-max', `+${Math.round(maxVal)} N (T)`);
        if (lBar) lBar.style.background = 'linear-gradient(90deg, #1d4ed8 0%, #67e8f9 50%, #fbbf24 75%, #ef4444 100%)';
    } else if (mode === 'stress' && actualMaxStressPa * 1e-6 < 1e-4) {
        setTxt('fea-vis-unit-badge', '0.00 MPa (Pure Compression)');
        setTxt('fea-legend-min', '0.00 MPa (Pure Compression · 0 Tension)');
        setTxt('fea-legend-mid', '');
        setTxt('fea-legend-max', '✓');
        if (lBar) lBar.style.background = 'linear-gradient(90deg, #10b981 0%, #06b6d4 100%)';
    } else {
        if (lBar) lBar.style.background = 'linear-gradient(90deg, #10b981 0%, #06b6d4 35%, #f59e0b 70%, #ef4444 100%)';
        if (mode === 'stress') {
            setTxt('fea-vis-unit-badge', 'Peak σ_t (MPa)');
            setTxt('fea-legend-min', '0.00 MPa');
            setTxt('fea-legend-mid', `${(actualMaxStressPa * 0.5e-6).toFixed(2)} MPa`);
            setTxt('fea-legend-max', `${(actualMaxStressPa * 1e-6).toFixed(2)} MPa`);
        } else if (mode === 'buckling') {
            setTxt('fea-vis-unit-badge', '|N| / P_cr');
            setTxt('fea-legend-min', '0%');
            setTxt('fea-legend-mid', `${Math.round(maxVal * 50)}%`);
            setTxt('fea-legend-max', `${Math.round(maxVal * 100)}%`);
        } else {
            const mxMm = maxVal * 1000;
            const dec = mxMm > 0 && mxMm < 0.1 ? 3 : 2;
            setTxt('fea-vis-unit-badge', 'Disp |u| (mm)');
            setTxt('fea-legend-min', '0.00 mm');
            setTxt('fea-legend-mid', `${(mxMm * 0.5).toFixed(dec)} mm`);
            setTxt('fea-legend-max', `${mxMm.toFixed(dec)} mm`);
        }
    }

    const nSides = 8;
    const isElasticaOnly = Boolean(feaState.excludeGraph && feaState.includeElastica);
    const rVis = isElasticaOnly
        ? Math.max(0.006, (elasticaState?.rodRadius || 0.015))
        : Math.max(0.014, tubeState.radius);
    const triPos = [], triCol = [];
    const cU = new THREE.Color(), cV = new THREE.Color();
    const upRef = new THREE.Vector3(0, 0, 1), altRef = new THREE.Vector3(1, 0, 0);

    for (let ei = 0; ei < edges.length; ei++) {
        const [u, v] = edges[ei];
        const pA = defVerts[u], pB = defVerts[v];
        const dir = new THREE.Vector3().subVectors(pB, pA);
        const len = dir.length();
        if (len < 1e-6) continue;
        dir.divideScalar(len);
        const ref = Math.abs(dir.dot(upRef)) > 0.92 ? altRef : upRef;
        const e1 = new THREE.Vector3().crossVectors(dir, ref).normalize();
        const e2 = new THREE.Vector3().crossVectors(dir, e1).normalize();

        const m = members[ei] || { axialForceN: 0, sigmaTensilePa: 0, bucklingLoadN: 1 };
        if (mode === 'deflection') {
            sampleContourColor(mode, Math.hypot(disps[u][0], disps[u][1], disps[u][2]), 0, maxVal, cU);
            sampleContourColor(mode, Math.hypot(disps[v][0], disps[v][1], disps[v][2]), 0, maxVal, cV);
        } else {
            let val = m.axialForceN;
            if (mode === 'stress') val = m.sigmaTensilePa || 0;
            else if (mode === 'buckling') val = m.axialForceN < 0 ? Math.abs(m.axialForceN) / Math.max(1e-6, m.bucklingLoadN) : 0;
            sampleContourColor(mode, val, minVal, maxVal, cU);
            cV.copy(cU);
        }

        const rElem = m.isElastica ? Math.max(0.006, m.outerRadiusM || 0.015) : rVis;
        for (let s = 0; s < nSides; s++) {
            const a0 = (2 * Math.PI * s) / nSides, a1 = (2 * Math.PI * ((s + 1) % nSides)) / nSides;
            const off0 = e1.clone().multiplyScalar(Math.cos(a0) * rElem).addScaledVector(e2, Math.sin(a0) * rElem);
            const off1 = e1.clone().multiplyScalar(Math.cos(a1) * rElem).addScaledVector(e2, Math.sin(a1) * rElem);
            const v00 = pA.clone().add(off0), v01 = pA.clone().add(off1);
            const v11 = pB.clone().add(off1), v10 = pB.clone().add(off0);
            triPos.push(v00.x, v00.y, v00.z, v01.x, v01.y, v01.z, v11.x, v11.y, v11.z, v00.x, v00.y, v00.z, v11.x, v11.y, v11.z, v10.x, v10.y, v10.z);
            triCol.push(cU.r, cU.g, cU.b, cU.r, cU.g, cU.b, cV.r, cV.g, cV.b, cU.r, cU.g, cU.b, cV.r, cV.g, cV.b, cV.r, cV.g, cV.b);
        }
    }
    if (triPos.length > 0) {
        const sGeo = new THREE.BufferGeometry();
        sGeo.setAttribute('position', new THREE.Float32BufferAttribute(triPos, 3));
        sGeo.setAttribute('color', new THREE.Float32BufferAttribute(triCol, 3));
        sGeo.computeVertexNormals();
        viewport.feaGroup.add(new THREE.Mesh(sGeo, assets.strut));
    }

    const anchorSet = new Set(feaSrc.anchors || []);
    const nHostNodes = feaSrc.hostNodeCount !== undefined ? feaSrc.hostNodeCount : defVerts.length;
    const nodeMult = appState.nodeDisplayScale || 1.0;
    const jRad = rVis * 1.18 * nodeMult;
    const deg = isElasticaOnly ? new Int32Array(defVerts.length) : null;
    if (deg) {
        for (const [u, v] of edges) { deg[u]++; deg[v]++; }
    }
    const maxDispRef = Math.max(1e-8, lastFEAResult.maxDispM || 1e-4);
    for (let i = 0; i < nHostNodes; i++) {
        if (anchorSet.has(i)) {
            const cone = new THREE.Mesh(assets.unitCone, sharedMaterials.anchorSphere);
            cone.scale.setScalar(rVis * nodeMult);
            cone.position.set(defVerts[i].x, defVerts[i].y, defVerts[i].z - rVis * nodeMult * 1.5);
            viewport.feaGroup.add(cone);
        } else if (!deg || deg[i] !== 2) {
            const dMag = Math.hypot(disps[i][0], disps[i][1], disps[i][2]);
            sampleContourColor('deflection', dMag, 0, maxDispRef, _feaTmpColor);
            let jMat = feaJointMatPool[i];
            if (!jMat) { jMat = new THREE.MeshBasicMaterial({ color: _feaTmpColor.clone() }); feaJointMatPool[i] = jMat; }
            else jMat.color.copy(_feaTmpColor);
            const jm = new THREE.Mesh(assets.unitSphere, jMat);
            jm.scale.setScalar(jRad);
            jm.position.copy(defVerts[i]);
            viewport.feaGroup.add(jm);
        }
    }

    if (feaState.showArrows) {
        const addArrowBatch = (items, offsetMult, baseLen, varLen, lineMat, coneMat) => {
            if (!items || items.length === 0) return;
            let maxMag = 1e-6;
            for (const it of items) {
                const m = Math.hypot(it.force[0], it.force[1], it.force[2]);
                if (m > maxMag) maxMag = m;
            }
            const shaftVerts = [];
            for (const it of items) {
                const f = it.force;
                const mag = Math.hypot(f[0], f[1], f[2]);
                if (mag < 1e-4 || !defVerts[it.nodeIndex]) continue;
                const dir = new THREE.Vector3(f[0] / mag, f[1] / mag, f[2] / mag);
                const len = baseLen + varLen * (mag / maxMag);
                const hLen = len * 0.28, hRad = len * 0.09;
                const origin = defVerts[it.nodeIndex].clone().addScaledVector(dir, -len - rVis * offsetMult);
                const shaftEnd = origin.clone().addScaledVector(dir, len - hLen);
                const tip = origin.clone().addScaledVector(dir, len);
                shaftVerts.push(origin.x, origin.y, origin.z, shaftEnd.x, shaftEnd.y, shaftEnd.z);
                const head = new THREE.Mesh(assets.arrowCone, coneMat);
                head.position.copy(tip);
                head.quaternion.setFromUnitVectors(_feaArrowUp, dir);
                head.scale.set(hRad, hLen, hRad);
                viewport.feaGroup.add(head);
            }
            if (shaftVerts.length > 0) {
                const lGeo = new THREE.BufferGeometry();
                lGeo.setAttribute('position', new THREE.Float32BufferAttribute(shaftVerts, 3));
                viewport.feaGroup.add(new THREE.LineSegments(lGeo, lineMat));
            }
        };
        addArrowBatch(lastFEAResult.appliedLoads || [], 1.3, 0.16, 0.18, assets.loadLine, assets.loadCone);
        addArrowBatch(lastFEAResult.reactions || [], 1.2, 0.18, 0.20, assets.reactLine, assets.reactCone);
    }
}

export function updateFEAScorecardUI(res) {
    if (!res) return;
    const verdictEl = $('fea-verdict-badge');
    if (verdictEl) {
        verdictEl.textContent = res.passed ? 'PASS ✓' : 'CHECK LIMITS';
        verdictEl.className = res.passed
            ? 'text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-bold'
            : 'text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/50 text-amber-300 font-bold';
    }
    const fmtSF = (v) => (!Number.isFinite(v) || v > 99) ? '>99×' : `${v.toFixed(2)}×`;
    const setKpi = (id, text, ok) => {
        const el = $(id);
        if (!el) return;
        el.textContent = text;
        el.className = `text-[10.5px] font-bold truncate ${ok ? 'text-emerald-400' : 'text-rose-400'}`;
    };
    setKpi('fea-kpi-sft', fmtSF(res.minSF_t), res.minSF_t >= 1.5);
    setKpi('fea-kpi-sfc', fmtSF(res.minSF_c), res.minSF_c >= 2.0);
    setKpi('fea-kpi-sfb', fmtSF(res.minSF_b), res.minSF_b >= 2.0);

    const invL = Number.isFinite(res.inverseDeflectionRatio) && res.inverseDeflectionRatio < 99999
        ? `L/${Math.round(res.inverseDeflectionRatio)}` : 'L/>9999';
    const dispVal = Number(res.maxDispMm || 0);
    const dispTxt = dispVal > 0 && dispVal < 0.1 ? dispVal.toFixed(3) : dispVal.toFixed(2);
    setKpi('fea-kpi-disp', `${dispTxt}mm (${invL})`, (res.inverseDeflectionRatio || 0) >= 300);

    const funiPct = Math.round((res.funicularEfficiency !== undefined ? res.funicularEfficiency : 0.9) * 100);
    setKpi('fea-kpi-funi', `${funiPct}%`, funiPct >= 70);
    const compPct = Math.round((res.compressionDominance !== undefined ? res.compressionDominance : 1.0) * 100);
    setKpi('fea-kpi-comp', `${compPct}% (${res.tensileBarCount || 0}T)`, (res.tensileBarCount || 0) === 0);

    const sumRz = (res.reactions || []).reduce((s, r) => s + (r.force ? r.force[2] : 0), 0);
    setTxt('fea-readout', `Eq.Res: ${(res.equilibriumResidual || 0).toExponential(2)} · ΣRz: ${sumRz.toFixed(1)} N · ${(res.members || []).length} bars (${appState.feaState.restraintType})`);
}

const _feaProcLog = [];
let _feaAnimTelemetryAt = 0;

function _fmtMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n < 0) return '—';
    return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`;
}

function _nextFrame() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
        else setTimeout(resolve, 0);
    });
}

function updateFeaProgressUI({
    title = 'FEA Solver Telemetry',
    status = 'idle',
    percent = 0,
    stage = '',
    elapsedMs = 0,
    modelText = null,
    dofsText = null,
    solveText = null,
    peakText = null,
    logLine = null,
    resetLog = false,
    detail = null
} = {}) {
    const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
    const card = $('fea-proc-card');
    const fill = $('fea-proc-fill');
    const pctEl = $('fea-proc-pct');

    if (card) {
        card.classList.remove('is-running', 'is-done', 'is-error');
        if (status === 'running' || status === 'done' || status === 'error') card.classList.add(`is-${status}`);
    }
    if (fill) {
        fill.style.width = `${pct}%`;
        fill.classList.remove('is-running', 'is-done', 'is-error');
        if (status === 'running' || status === 'done' || status === 'error') fill.classList.add(`is-${status}`);
    }
    setTxt('fea-proc-title', title);
    setTxt('fea-proc-elapsed', _fmtMs(elapsedMs));
    setTxt('fea-proc-stage', stage || '—');
    if (modelText !== null) setTxt('fea-pt-model', modelText);
    if (dofsText !== null) setTxt('fea-pt-dofs', dofsText);
    if (solveText !== null) setTxt('fea-pt-solve', solveText);
    if (peakText !== null) setTxt('fea-pt-peak', peakText);

    if (pctEl) {
        pctEl.classList.remove('is-pass', 'is-warn', 'is-fail', 'is-info');
        if (status === 'running') { pctEl.textContent = `${pct}%`; pctEl.classList.add('is-info'); }
        else if (status === 'done') { pctEl.textContent = '100% ✓'; pctEl.classList.add('is-pass'); }
        else if (status === 'error') { pctEl.textContent = 'ERR'; pctEl.classList.add('is-fail'); }
        else { pctEl.textContent = 'Idle'; }
    }

    if (resetLog) _feaProcLog.length = 0;
    if (logLine) {
        _feaProcLog.push(`[${_fmtMs(elapsedMs)}] ${logLine}`);
        if (_feaProcLog.length > 6) _feaProcLog.shift();
        setTxt('fea-proc-log', _feaProcLog.join('\n'));
    }

    emitProcessTelemetry({
        domain: 'FEA',
        title,
        status,
        percent: pct,
        stage,
        detail: detail || [modelText, dofsText, peakText].filter(Boolean).join(' · ') || stage,
        elapsedMs
    });
}

function prepareFEASolveInputs() {
    if (!appState.feaState.excludeGraph && appState.fdmState.triggerOnHost && !appState.lastFDMResult && actions.runFDMOnActiveGraph) {
        actions.runFDMOnActiveGraph({ skipAutoSolidify: true, keepCamera: true });
    }
    let feaSrc = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (!feaSrc && actions.applyTilePresetUI) {
        actions.applyTilePresetUI(appState.currentTilePreset === 'active_topo' ? 'pilot_champion' : (appState.currentTilePreset || 'pilot_champion'), { keepCamera: true });
        feaSrc = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    }
    if (!feaSrc) return null;

    const { feaState, tubeState, elasticaState } = appState;
    const mat = FEA_MATERIALS[feaState.materialKey] || FEA_MATERIALS.plaster;
    const sectionParams = { outerRadiusM: tubeState.radius, innerRadiusM: tubeState.innerRadiusM || 0.0, nSides: tubeState.nSides };

    let solveVerts = feaSrc.vertices;
    let solveEdges = feaSrc.edges;
    let solveAnchors = feaSrc.anchors;
    let edgeSpecs = null;
    let nodalSelfStressPairs = null;
    let hostNodeCount = feaSrc.vertices.length;
    let coupledRods = 0;

    if (feaState.excludeGraph && !feaState.includeElastica) {
        feaState.includeElastica = true;
        const chkEl = $('chk-fea-include-elastica');
        if (chkEl) chkEl.checked = true;
    }

    if (feaState.includeElastica || feaState.excludeGraph) {
        if ((!appState.lastElasticaData || !appState.lastElasticaData.curves?.length) && actions.generateElasticaFromUI) {
            actions.generateElasticaFromUI();
        }
        const curves = appState.lastElasticaData?.curves || [];
        const rodMat = feaState.elasticaMaterialKey === 'same'
            ? mat
            : (FEA_MATERIALS[feaState.elasticaMaterialKey] || FEA_MATERIALS.gfrp_rod);
        const hybrid = CORE.buildHybridGraphWithElastica(feaSrc.vertices, feaSrc.edges, curves, {
            includeHostGraph: !feaState.excludeGraph,
            hostAnchors: feaSrc.anchors,
            maxRods: Math.max(64, curves.length),
            segsPerRod: feaState.excludeGraph ? (curves.length > 300 ? 8 : 12) : (curves.length > 300 ? 6 : 8),
            rodRadiusM: elasticaState ? elasticaState.rodRadius : 0.015,
            rodMaterial: rodMat,
            prestressForceN: Number(feaState.elasticaPrestressN || 0),
            activeBendFactor: feaState.elasticaActiveBend ? 1.0 : 0.0
        });
        solveVerts = hybrid.vertices;
        solveEdges = hybrid.edges;
        edgeSpecs = hybrid.edgeSpecs;
        nodalSelfStressPairs = hybrid.nodalSelfStressPairs;
        hostNodeCount = hybrid.hostNodeCount;
        coupledRods = hybrid.coupledRodCount;
        if (feaState.excludeGraph) {
            if (Array.isArray(hybrid.recommendedAnchors) && hybrid.recommendedAnchors.length > 0) {
                solveAnchors = hybrid.recommendedAnchors;
            } else if (hybrid.hostNodeMap) {
                solveAnchors = (feaSrc.anchors || [])
                    .map(ai => hybrid.hostNodeMap.get(ai))
                    .filter(ni => ni !== undefined && ni >= 0);
            }
        }
    }

    const graphBadge = $('fea-graph-badge');
    if (graphBadge) {
        graphBadge.textContent = feaState.excludeGraph ? 'Excluded (Rods Only · Stabilized)' : 'Included';
        graphBadge.className = `text-[8.5px] font-mono ${feaState.excludeGraph ? 'text-amber-300' : 'text-gray-400'}`;
    }

    const elBadge = $('fea-elastica-badge');
    if (elBadge) {
        elBadge.textContent = feaState.includeElastica
            ? `${coupledRods} rods (${feaState.elasticaPrestressN >= 0 ? '+' : ''}${feaState.elasticaPrestressN}N)`
            : 'Off';
        elBadge.className = `text-[8.5px] font-mono ${feaState.includeElastica ? 'text-cyan-300' : 'text-gray-400'}`;
    }

    const loadConfig = {
        distributedVerticalMassKg: feaState.topLoadKg,
        restraintType: feaState.restraintType,
        ensureComponentFixity: Boolean(feaState.excludeGraph),
        fixAllComponentRotations: Boolean(feaState.excludeGraph),
        topZoneFractionZ: 0.20,
        includeSelfWeight: true,
        edgeSpecs,
        nodalSelfStressPairs,
        hostNodeCount
    };

    const solveGraph = {
        ...feaSrc,
        vertices: solveVerts,
        edges: solveEdges,
        anchors: solveAnchors,
        hostNodeCount
    };

    const nNodes = solveVerts.length;
    const nBars = solveEdges.length;
    const validAnchors = new Set((solveAnchors || []).filter(i => i >= 0 && i < nNodes));
    const isFixed = String(loadConfig.restraintType || 'pinned').toLowerCase() === 'fixed';
    const activeDofs = Math.max(0, 6 * nNodes - (isFixed ? 6 : 3) * validAnchors.size);

    return {
        mat,
        sectionParams,
        solveVerts,
        solveEdges,
        solveAnchors,
        loadConfig,
        solveGraph,
        coupledRods,
        nNodes,
        nBars,
        activeDofs
    };
}

function finalizeFEASolve(prep, res, t0, solveMs, opts = {}) {
    const { feaState } = appState;
    appState.lastFEAResult = res;
    if (appState.lastFEAResult) {
        appState.lastFEAResult._sourceGraph = prep.solveGraph;
        appState.lastFEAResult.coupledRodCount = prep.coupledRods;
    }

    feaState.runCount = (feaState.runCount || 0) + 1;
    updateFEAScorecardUI(appState.lastFEAResult);
    updateExaggerationBadgeUI();
    emitFEATelemetry(appState.lastFEAResult, prep.sectionParams, prep.mat, prep.loadConfig, opts);
    renderFEAResults3D(computeEffectiveExaggeration(feaState.exaggeration));
    applyOutlinerVisibility();
    recomputeModelBox();
    drawOverlay();

    const totalMs = performance.now() - t0;
    const minSF = Math.min(res.minSF_t ?? 99, res.minSF_c ?? 99, res.minSF_b ?? 99);
    const sfTxt = (!Number.isFinite(minSF) || minSF > 99) ? '>99×' : `${minSF.toFixed(2)}×`;
    const dispTxt = Number(res.maxDispMm || 0).toFixed(2);
    const title = prep.coupledRods > 0 ? `Coupled Elastica + Frame FEA (${prep.coupledRods} rods)` : '3D Space-Frame FEA';
    const modelText = prep.coupledRods > 0
        ? `${prep.nNodes}N · ${prep.nBars}E (${prep.coupledRods}R)`
        : `${prep.nNodes}N · ${prep.nBars}E`;

    updateFeaProgressUI({
        title,
        status: 'done',
        percent: 100,
        stage: `Complete — ${res.passed ? 'PASS ✓' : 'CHECK LIMITS'}`,
        elapsedMs: totalMs,
        modelText,
        dofsText: `${prep.activeDofs} DOFs`,
        solveText: _fmtMs(solveMs),
        peakText: `${dispTxt}mm · SF ${sfTxt}`,
        logLine: `Solved ${prep.activeDofs} DOFs in ${_fmtMs(solveMs)} | |u|=${dispTxt}mm | Min SF=${sfTxt} (${res.passed ? 'PASS' : 'CHECK'})`,
        detail: `${modelText} · ${prep.activeDofs} DOFs · |u|=${dispTxt}mm · SF=${sfTxt}`
    });
    return appState.lastFEAResult;
}

export function runSpaceFrameFEAFromUI(opts = {}) {
    const t0 = performance.now();
    const prep = prepareFEASolveInputs();
    if (!prep) return null;

    const title = prep.coupledRods > 0 ? `Coupled Elastica + Frame FEA (${prep.coupledRods} rods)` : '3D Space-Frame FEA';
    const modelText = prep.coupledRods > 0
        ? `${prep.nNodes}N · ${prep.nBars}E (${prep.coupledRods}R)`
        : `${prep.nNodes}N · ${prep.nBars}E`;
    updateFeaProgressUI({
        title,
        status: 'running',
        percent: 55,
        stage: `Solving 6-DOF stiffness system (${prep.activeDofs} DOFs)…`,
        elapsedMs: performance.now() - t0,
        modelText,
        dofsText: `${prep.activeDofs} DOFs`,
        resetLog: true,
        logLine: `Extracted ${modelText} (${prep.activeDofs} active DOFs)`
    });

    const tSolve = performance.now();
    const res = CORE.analyzeSpaceFrameFEA(
        prep.solveVerts, prep.solveEdges, prep.solveAnchors,
        prep.sectionParams, prep.mat, prep.loadConfig
    );
    const solveMs = performance.now() - tSolve;
    return finalizeFEASolve(prep, res, t0, solveMs, opts);
}

export async function runSpaceFrameFEAAsyncFromUI(opts = {}) {
    const t0 = performance.now();
    updateFeaProgressUI({
        title: '3D Space-Frame FEA',
        status: 'running',
        percent: 15,
        stage: '1/4 Extracting Nodes, Members & Supports…',
        elapsedMs: 0,
        resetLog: true,
        logLine: 'Stage 1/4: Extracting nodes, bars & boundary restraints'
    });
    await _nextFrame();

    const prep = prepareFEASolveInputs();
    if (!prep) {
        updateFeaProgressUI({
            title: '3D Space-Frame FEA',
            status: 'error',
            percent: 0,
            stage: 'No active graph available for FEA.',
            elapsedMs: performance.now() - t0,
            logLine: 'Aborted: no active host graph'
        });
        return null;
    }

    const title = prep.coupledRods > 0 ? `Coupled Elastica + Frame FEA (${prep.coupledRods} rods)` : '3D Space-Frame FEA';
    const modelText = prep.coupledRods > 0
        ? `${prep.nNodes}N · ${prep.nBars}E (${prep.coupledRods}R)`
        : `${prep.nNodes}N · ${prep.nBars}E`;

    updateFeaProgressUI({
        title,
        status: 'running',
        percent: 40,
        stage: `2/4 Assembling 6-DOF Global Stiffness Matrix (${prep.activeDofs} DOFs)…`,
        elapsedMs: performance.now() - t0,
        modelText,
        dofsText: `${prep.activeDofs} DOFs`,
        logLine: `Stage 2/4: Assembling ${prep.nNodes}N / ${prep.nBars}E (${prep.activeDofs} DOFs)`
    });
    await _nextFrame();

    updateFeaProgressUI({
        title,
        status: 'running',
        percent: 70,
        stage: '3/4 Solving Linear System K·u = F…',
        elapsedMs: performance.now() - t0,
        modelText,
        dofsText: `${prep.activeDofs} DOFs`,
        logLine: 'Stage 3/4: Solving K·u = F for self-weight & top loads'
    });
    await _nextFrame();

    const tSolve = performance.now();
    const res = CORE.analyzeSpaceFrameFEA(
        prep.solveVerts, prep.solveEdges, prep.solveAnchors,
        prep.sectionParams, prep.mat, prep.loadConfig
    );
    const solveMs = performance.now() - tSolve;

    updateFeaProgressUI({
        title,
        status: 'running',
        percent: 90,
        stage: '4/4 Computing Safety Factors & 3D Stress Contours…',
        elapsedMs: performance.now() - t0,
        modelText,
        dofsText: `${prep.activeDofs} DOFs`,
        solveText: _fmtMs(solveMs),
        logLine: `Stage 4/4: Axial/Bending/Buckling SF & 3D contours (${_fmtMs(solveMs)})`
    });
    await _nextFrame();

    return finalizeFEASolve(prep, res, t0, solveMs, opts);
}

export function setFEAAnimation(on) {
    const wantOn = !!on;
    if (wantOn && !appState.lastFEAResult) runSpaceFrameFEAFromUI();
    appState.feaState.animate = wantOn;
    appState.feaState.animPhase = 0;
    const chkFeaAnim = $('chk-fea-animate');
    const btnFeaAnim = $('btn-fea-animate');
    if (chkFeaAnim && chkFeaAnim.checked !== wantOn) {
        chkFeaAnim.checked = wantOn;
    }
    if (btnFeaAnim) {
        btnFeaAnim.classList.toggle('seg-on', wantOn);
        btnFeaAnim.classList.toggle('cyan', !wantOn);
        btnFeaAnim.setAttribute('aria-pressed', wantOn ? 'true' : 'false');
    }
    setTxt('lbl-fea-animate', wantOn ? '⏸ Animating...' : '▶ Animate Deflection');
    if (!wantOn && appState.lastFEAResult) renderFEAResults3D(computeEffectiveExaggeration(appState.feaState.exaggeration));
    return appState.feaState.animate;
}

export function setFEADeflectionScale(scale) {
    const parsed = Number(scale);
    if (!Number.isFinite(parsed) || parsed <= 0) return appState.feaState.exaggeration;
    const clamped = Math.max(1, Math.min(200, Math.round(parsed)));
    appState.feaState.exaggeration = clamped;
    const rngExag = $('rng-fea-exag');
    if (rngExag) {
        rngExag.value = String(clamped);
    }
    updateExaggerationBadgeUI();
    if (appState.lastFEAResult && !appState.feaState.animate) {
        renderFEAResults3D(computeEffectiveExaggeration(appState.feaState.exaggeration));
    }
    return appState.feaState.exaggeration;
}

export function setFEALoadCase(loadCase) {
    const normalized = String(loadCase || '').trim();
    if (!normalized) return appState.feaState.loadCase || null;
    appState.feaState.loadCase = normalized;
    const lower = normalized.toLowerCase();
    const loadPresets = {
        self_weight: 0,
        dead: 0,
        service: 25,
        standard: 25,
        heavy: 100,
        ultimate: 150,
    };
    if (Object.prototype.hasOwnProperty.call(loadPresets, lower)) {
        const kg = loadPresets[lower];
        appState.feaState.topLoadKg = kg;
        const rngLoad = $('rng-fea-load-kg');
        const numLoad = $('num-fea-load-kg');
        if (rngLoad) rngLoad.value = String(Math.min(500, kg));
        if (numLoad) numLoad.value = String(kg);
    }
    return appState.feaState.loadCase;
}

export function tickFEAAnimation(dt) {
    if (!appState.feaState.animate || !appState.lastFEAResult || appState.activeTabId !== 'tab-fea') return;
    appState.feaState.animPhase += dt * (2 * Math.PI * 0.75);
    const effMax = computeEffectiveExaggeration(appState.feaState.exaggeration);
    const oscFactor = 0.5 - 0.5 * Math.cos(appState.feaState.animPhase);
    renderFEAResults3D(effMax * oscFactor);

    const now = performance.now();
    if (now - _feaAnimTelemetryAt >= 120) {
        _feaAnimTelemetryAt = now;
        const pct = Math.round(oscFactor * 100);
        const peakMm = Number(appState.lastFEAResult.maxDispMm || 0) * oscFactor;
        updateFeaProgressUI({
            title: 'FEA Deflection Playback',
            status: 'running',
            percent: pct,
            stage: `Harmonic deflection cycle · |u(t)| = ${peakMm.toFixed(3)} mm (${pct}%)`,
            elapsedMs: (appState.feaState.animPhase / (2 * Math.PI * 0.75)) * 1000,
            peakText: `${peakMm.toFixed(2)} / ${Number(appState.lastFEAResult.maxDispMm || 0).toFixed(2)} mm`
        });
    }
}

export function initTab5Fea() {
    actions.computeEffectiveExaggeration = computeEffectiveExaggeration;
    actions.runSpaceFrameFEAFromUI = runSpaceFrameFEAFromUI;
    actions.setFEAAnimation = setFEAAnimation;
    actions.tickFEAAnimation = tickFEAAnimation;

    let feaLiveRafId = 0;
    const scheduleLiveFEARun = () => {
        if (feaLiveRafId) return;
        feaLiveRafId = requestAnimationFrame(() => { feaLiveRafId = 0; runSpaceFrameFEAFromUI(); });
    };

    const selMat = $('sel-fea-material');
    if (selMat) selMat.addEventListener('change', () => { appState.feaState.materialKey = selMat.value; runSpaceFrameFEAFromUI(); });

    const rngLoad = $('rng-fea-load-kg'), numLoad = $('num-fea-load-kg');
    const syncFeaLoad = (val, immediate = false) => {
        appState.feaState.topLoadKg = Math.max(0, Number(val) || 0);
        if (rngLoad) rngLoad.value = String(Math.min(500, appState.feaState.topLoadKg));
        if (numLoad && document.activeElement !== numLoad) numLoad.value = String(appState.feaState.topLoadKg);
        if (immediate) {
            if (numLoad) numLoad.value = String(appState.feaState.topLoadKg);
            runSpaceFrameFEAFromUI();
        } else {
            scheduleLiveFEARun();
        }
    };
    if (rngLoad) {
        rngLoad.addEventListener('input', (e) => syncFeaLoad(e.target.value, false));
        rngLoad.addEventListener('change', (e) => syncFeaLoad(e.target.value, true));
    }
    if (numLoad) {
        numLoad.addEventListener('input', (e) => syncFeaLoad(e.target.value, false));
        numLoad.addEventListener('change', (e) => syncFeaLoad(e.target.value, true));
    }

    $$('.fea-support-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            appState.feaState.restraintType = btn.dataset.feaSupport;
            $$('.fea-support-btn').forEach(b => b.classList.toggle('seg-on', b === btn));
            runSpaceFrameFEAFromUI();
        });
    });

    const chkFeaExcludeGraph = $('chk-fea-exclude-graph');
    if (chkFeaExcludeGraph) {
        chkFeaExcludeGraph.addEventListener('change', () => {
            appState.feaState.excludeGraph = chkFeaExcludeGraph.checked;
            if (appState.feaState.excludeGraph && !appState.feaState.includeElastica) {
                appState.feaState.includeElastica = true;
                const chkEl = $('chk-fea-include-elastica');
                if (chkEl) chkEl.checked = true;
            }
            runSpaceFrameFEAFromUI();
        });
    }
    const chkFeaElastica = $('chk-fea-include-elastica');
    if (chkFeaElastica) {
        chkFeaElastica.addEventListener('change', () => {
            appState.feaState.includeElastica = chkFeaElastica.checked;
            runSpaceFrameFEAFromUI();
        });
    }
    const selFeaElasticaMat = $('sel-fea-elastica-mat');
    if (selFeaElasticaMat) {
        selFeaElasticaMat.addEventListener('change', () => {
            appState.feaState.elasticaMaterialKey = selFeaElasticaMat.value;
            if (appState.feaState.includeElastica) runSpaceFrameFEAFromUI();
        });
    }
    const rngFeaPrestress = $('rng-fea-elastica-prestress');
    if (rngFeaPrestress) {
        rngFeaPrestress.addEventListener('input', () => {
            const v = parseFloat(rngFeaPrestress.value) || 0;
            appState.feaState.elasticaPrestressN = v;
            setTxt('val-fea-elastica-prestress', `${v >= 0 ? '+' : ''}${v}N`);
            if (appState.feaState.includeElastica) scheduleLiveFEARun();
        });
    }
    const chkFeaActiveBend = $('chk-fea-elastica-activebend');
    if (chkFeaActiveBend) {
        chkFeaActiveBend.addEventListener('change', () => {
            appState.feaState.elasticaActiveBend = chkFeaActiveBend.checked;
            if (appState.feaState.includeElastica) runSpaceFrameFEAFromUI();
        });
    }

    const btnRunFea = $('btn-run-fea');
    if (btnRunFea) btnRunFea.addEventListener('click', () => { runSpaceFrameFEAAsyncFromUI({ expandHud: false }); });
    const btnHudToggle = $('btn-fea-hud-toggle');
    if (btnHudToggle) btnHudToggle.addEventListener('click', () => expandTelemetryHudForFEA());

    $$('.fea-vis-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            appState.feaState.visMode = btn.dataset.feaVis;
            $$('.fea-vis-btn').forEach(b => b.classList.toggle('seg-on', b === btn));
            if (appState.lastFEAResult && !appState.feaState.animate) renderFEAResults3D(computeEffectiveExaggeration(appState.feaState.exaggeration));
        });
    });

    const rngExag = $('rng-fea-exag');
    if (rngExag) {
        const onExagChange = () => {
            appState.feaState.exaggeration = parseFloat(rngExag.value) || 1;
            updateExaggerationBadgeUI();
            if (appState.lastFEAResult && !appState.feaState.animate) renderFEAResults3D(computeEffectiveExaggeration(appState.feaState.exaggeration));
        };
        rngExag.addEventListener('input', onExagChange);
        rngExag.addEventListener('change', onExagChange);
    }

    const btnFeaAnim = $('btn-fea-animate'), chkFeaAnim = $('chk-fea-animate');
    if (btnFeaAnim) btnFeaAnim.addEventListener('click', () => setFEAAnimation(!appState.feaState.animate));
    if (chkFeaAnim) chkFeaAnim.addEventListener('change', () => setFEAAnimation(chkFeaAnim.checked));

    const chkArrows = $('chk-fea-arrows');
    if (chkArrows) {
        chkArrows.addEventListener('change', () => {
            appState.feaState.showArrows = chkArrows.checked;
            if (appState.lastFEAResult && !appState.feaState.animate) renderFEAResults3D(computeEffectiveExaggeration(appState.feaState.exaggeration));
        });
    }
    actions.renderFEAResults3D = renderFEAResults3D;
    actions.setFEADeflectionScale = setFEADeflectionScale;
    actions.setFEALoadCase = setFEALoadCase;
    appState._feaApi = {
        setFEAAnimation,
        setFEADeflectionScale,
        setFEALoadCase,
        runSpaceFrameFEAFromUI,
    };
}

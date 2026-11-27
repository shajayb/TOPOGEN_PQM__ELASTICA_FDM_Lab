/**
 * WFC-FDM Foundry — Analytical Telemetry HUD Panel (ui/display/telemetry_hud.js)
 *
 * Renders and updates the floating right-hand `#telemetry-panel` (Topo Gen metrics,
 * Welded Centerline Graph stats, 3D Space-Frame FEA solver telemetry, and Sub-Step rule trace).
 *
 * Student Quick-Map:
 *   - Edit Telemetry HUD layout / cards            -> mountTelemetryHud()
 *   - Edit live Topo / Graph / Compact card badges -> updateSimUI()
 *   - Edit 3D FEA solver telemetry & console log   -> emitFEATelemetry()
 */

import { appState, actions, $, $$, setTxt } from '../state/workbench_state.js';
import { refreshPoolUI } from './viewport_scene.js';
import { refreshOutliner } from './display_hud.js';

export function mountTelemetryHud() {
    const bodyEl = $('telemetry-collapsible');
    if (!bodyEl) return;
    bodyEl.innerHTML = `
        <!-- Section 0: Live Process Telemetry & Progress (3DP / FEA) -->
        <div id="telemetry-proc-card" class="proc-progress-card">
            <div class="proc-progress-header">
                <span id="hud-proc-title" class="proc-progress-title">Process Telemetry</span>
                <span class="proc-progress-meta">
                    <span id="hud-proc-elapsed">0 ms</span>
                    <span id="hud-proc-pct" class="dp3-badge">Idle</span>
                </span>
            </div>
            <div class="proc-progress-track">
                <div id="hud-proc-bar-fill" class="proc-progress-fill" style="width:0%"></div>
            </div>
            <div id="hud-proc-stage" class="proc-stage-line">No active 3DP or FEA job.</div>
            <div id="hud-proc-detail" class="text-[8.5px] font-mono text-gray-400 truncate">—</div>
        </div>

        <!-- Section 1: Topo Gen / Growth Simulation Metrics -->
        <div class="bg-gray-900/90 border border-gray-700/80 rounded p-2.5 space-y-1">
            <div class="text-[9.5px] font-sans font-semibold uppercase tracking-wider text-cyan-400 mb-1">Topo Gen &amp; Voxel Metrics</div>
            <div class="flex justify-between text-gray-400">
                <span>Algorithm:</span>
                <span id="sim-algo-val" class="text-gray-100 font-semibold">(b) Topo Collapse</span>
            </div>
            <div class="flex justify-between text-gray-400">
                <span>Step / Collapsed:</span>
                <span id="sim-stat-val" class="text-pink-400 font-semibold">36 / 36</span>
            </div>
            <div class="flex justify-between text-gray-400">
                <span>Active Meshes:</span>
                <span id="sim-mesh-val" class="text-emerald-400 font-semibold">0 quads</span>
            </div>
            <div class="flex justify-between text-gray-400">
                <span>Enabled Tiles:</span>
                <span id="hud-tile-stat" class="text-gray-200 font-semibold">4 / 4</span>
            </div>
        </div>

        <!-- Section 2: Welded Centerline Graph Topology -->
        <div class="bg-gray-900/90 border border-gray-700/80 rounded p-2.5 space-y-1">
            <div class="text-[9.5px] font-sans font-semibold uppercase tracking-wider text-red-400 mb-1">Welded Centerline Graph</div>
            <div class="flex justify-between text-gray-400">
                <span>Welded G(V, E):</span>
                <span id="sim-graph-val" class="text-red-400 font-semibold">0V · 0E</span>
            </div>
            <div class="flex justify-between text-gray-400">
                <span>Raw → Welded:</span>
                <span id="hud-graph-weld-stat" class="text-cyan-400 font-semibold">0V → 0V</span>
            </div>
            <div class="flex justify-between text-gray-400">
                <span>Valence (Mean/Max):</span>
                <span id="hud-graph-val-stat" class="text-gray-200 font-semibold">0.0 / 0</span>
            </div>
            <div class="flex justify-between text-gray-400">
                <span>Graph Extents:</span>
                <span id="hud-graph-bbox-stat" class="text-gray-300">0.0 × 0.0 × 0.0 m</span>
            </div>
        </div>

        <!-- Section 3: 3D Space-Frame FEA Telemetry -->
        <div id="telemetry-fea-card" class="bg-gray-900/90 border border-emerald-500/40 rounded p-2.5 space-y-1">
            <div class="flex items-center justify-between mb-1">
                <span class="text-[9.5px] font-sans font-semibold uppercase tracking-wider text-emerald-400">3D Space-Frame FEA Telemetry</span>
                <span id="hud-fea-verdict" class="text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-gray-800 text-gray-400">Awaiting Run</span>
            </div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Run / Time:</span><span id="hud-fea-run" class="text-gray-200 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Formulation:</span><span id="hud-fea-solver" class="text-cyan-300 font-semibold text-right">12-DOF 3D Euler-Bernoulli</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Nodes/Bars/DOFs:</span><span id="hud-fea-dofs" class="text-gray-100 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Restraint:</span><span id="hud-fea-restraint" class="text-gray-200 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Section (A / I):</span><span id="hud-fea-section" class="text-amber-300 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Material:</span><span id="hud-fea-material" class="text-gray-200 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Loads / Case:</span><span id="hud-fea-loads" class="text-pink-300 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>ΣRz / ||Ku−f||:</span><span id="hud-fea-eq" class="text-emerald-300 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Max |u| @ Node:</span><span id="hud-fea-disp" class="text-gray-100 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>SF (t / c / b):</span><span id="hud-fea-sfs" class="text-gray-100 font-semibold text-right">—</span></div>
            <div class="flex justify-between gap-2 text-gray-400"><span>Funic / Comp:</span><span id="hud-fea-funi" class="text-cyan-300 font-semibold text-right">—</span></div>
        </div>

        <!-- Section 4: Sub-Step Rule Lookup Trace -->
        <div id="substep-hud" class="hidden bg-amber-950/30 border border-amber-500/40 rounded p-2.5 space-y-1 text-[9.5px]">
            <div class="flex justify-between">
                <span class="text-amber-400 font-semibold">Sub-Step Trace:</span>
                <span id="sim-substep-idx" class="text-amber-300">0 / 0</span>
            </div>
            <div id="sim-substep-rule" class="text-gray-200 truncate">Ready to step</div>
            <div id="sim-substep-desc" class="text-gray-400 leading-tight">Toggle Sub-Step Vis &amp; click Step</div>
        </div>

        <div class="text-[9px] text-gray-500 pt-1 border-t border-gray-800 leading-relaxed">
            <div><span class="text-pink-400">setup:</span> tiles, rules, <span id="hud-setup-grid">3×3×4</span> grid</div>
            <div><span class="text-pink-400">topo:</span> collapse / grow welded centerline graph</div>
            <div><span class="text-pink-400">fdm·pq·fea:</span> funicular form, PQ tubes &amp; 3D FEA</div>
        </div>
    `;
}

export function updateSimUI() {
    const { voxels, GRID_X, GRID_Y, GRID_Z, VOXEL_SIZE, activeMeshEntry, currentAlgorithm, simStepCount, simRunning, lastWeldedGraph, TILES, showCenterlineGraph, substepMode, currentSubstep, substepCursor, substepQueue } = appState;
    const totalVoxels = voxels.length || (GRID_X * GRID_Y * GRID_Z);
    const collapsedCount = voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
    const activeQuadCount = activeMeshEntry ? activeMeshEntry.quads.length : 0;
    const gridDimStr = `${GRID_X}×${GRID_Y}×${GRID_Z}`;

    setTxt('sim-frame-badge', `${gridDimStr} grid`);
    setTxt('sim-algo-val', currentAlgorithm === 'growth' ? '(a) Adjacency Growth' : '(b) Topo Collapse');
    setTxt('sim-stat-val', `${simStepCount} / ${collapsedCount} (${totalVoxels} vox)`);
    setTxt('sim-mesh-val', `${activeQuadCount} quads`);

    const gV = lastWeldedGraph ? lastWeldedGraph.vertices.length : 0;
    const gE = lastWeldedGraph ? lastWeldedGraph.edges.length : 0;
    setTxt('sim-graph-val', `${gV}V · ${gE}E`);
    setTxt('active-topo-graph-badge', gE > 0 ? `Active · ${gV}V/${gE}E` : 'Active Graph (0E)');

    const enabledCount = TILES.reduce((acc, t) => acc + (t.enabled ? 1 : 0), 0);
    setTxt('hud-tile-stat', `${enabledCount} / ${TILES.length}`);

    if (lastWeldedGraph) {
        setTxt('hud-graph-weld-stat', `${lastWeldedGraph.rawVertexCount}V → ${gV}V`);
        const vals = lastWeldedGraph.valences || [];
        let maxVal = 0, sumVal = 0;
        for (let i = 0; i < vals.length; i++) {
            if (vals[i] > maxVal) maxVal = vals[i];
            sumVal += vals[i];
        }
        const meanVal = vals.length > 0 ? (sumVal / vals.length) : 0;
        setTxt('hud-graph-val-stat', `${meanVal.toFixed(1)} / ${maxVal}`);
        if (lastWeldedGraph.boundingBox) {
            const mn = lastWeldedGraph.boundingBox.min;
            const mx = lastWeldedGraph.boundingBox.max;
            const sx = gV > 0 ? (mx[0] - mn[0]) : 0;
            const sy = gV > 0 ? (mx[1] - mn[1]) : 0;
            const sz = gV > 0 ? (mx[2] - mn[2]) : 0;
            setTxt('hud-graph-bbox-stat', `${sx.toFixed(1)} × ${sy.toFixed(1)} × ${sz.toFixed(1)} m`);
        }
    }

    // Compact Card live badges
    const algoShort = currentAlgorithm === 'growth' ? 'Growth' : 'Topo';
    const gridShort = (GRID_X === GRID_Y && GRID_Y === GRID_Z) ? `${GRID_X}³` : gridDimStr;
    setTxt('compact-algo-label', `${algoShort} · ${gridShort} ▾`);
    setTxt('compact-run-text', simRunning ? '2. ⏸ Pause' : '2. ▶ Run');
    const btnCompactRun = $('btn-compact-run');
    if (btnCompactRun) btnCompactRun.classList.toggle('on', simRunning);
    setTxt('compact-progress-badge', `${collapsedCount} / ${totalVoxels}`);
    setTxt('compact-graph-badge', `${gV}V · ${gE}E`);
    setTxt('btn-compact-toggle-graph', showCenterlineGraph ? 'Graph: ON' : 'Graph: OFF');

    const { lastSolidData, lastFDMResult, lastFEAResult, lastElasticaData, fdmState, faceLoopState, elasticaState, feaState } = appState;
    setTxt('compact-pqm-badge', lastSolidData ? `${lastSolidData.quads.length}Q · PQ✓` : 'Build');
    const btnCompactUnroll = $('btn-compact-unroll');
    if (btnCompactUnroll) btnCompactUnroll.classList.toggle('on', !!(faceLoopState && faceLoopState.showUnrolled3D));
    setTxt('compact-elastica-badge', (lastElasticaData && lastElasticaData.curves && lastElasticaData.curves.length) ? `${lastElasticaData.curves.length} Rods ✓` : 'Build');
    const btnCompactElasticaUnroll = $('btn-compact-elastica-unroll');
    if (btnCompactElasticaUnroll) btnCompactElasticaUnroll.classList.toggle('on', !!(elasticaState && elasticaState.showUnrolled3D));
    setTxt('compact-fdm-badge', (fdmState && fdmState.triggerOnHost && lastFDMResult) ? `${lastFDMResult.mode} ✓` : 'Off');
    setTxt('compact-fea-badge', lastFEAResult ? (lastFEAResult.passed ? 'PASS ✓' : 'CHECK') : 'Ready');
    const btnCompactFeaAnim = $('btn-compact-fea-anim');
    if (btnCompactFeaAnim) btnCompactFeaAnim.classList.toggle('seg-on', !!(feaState && feaState.animate));

    setTxt('grid-res-label', `${gridDimStr} (${totalVoxels} vox)`);
    const syncInt = (id, v) => {
        const el = $(id);
        if (el && parseInt(el.value, 10) !== v) el.value = String(v);
    };
    syncInt('rng-grid-x', GRID_X); syncInt('rng-grid-y', GRID_Y); syncInt('rng-grid-z', GRID_Z);
    syncInt('num-grid-x', GRID_X); syncInt('num-grid-y', GRID_Y); syncInt('num-grid-z', GRID_Z);

    setTxt('hud-setup-grid', gridDimStr);
    setTxt('outliner-footer', `units: m · voxel ${Number(VOXEL_SIZE.toFixed(2))} m · ${gridDimStr}`);
    if (actions.syncVoxelAndEnvelopeUI) actions.syncVoxelAndEnvelopeUI();

    $$('.res-preset-btn').forEach(b => {
        const match = parseInt(b.dataset.rx, 10) === GRID_X
            && parseInt(b.dataset.ry, 10) === GRID_Y
            && parseInt(b.dataset.rz, 10) === GRID_Z;
        b.classList.toggle('seg-on', match);
    });

    const substepHud = $('substep-hud');
    if (substepHud) {
        substepHud.classList.toggle('hidden', !substepMode);
        if (substepMode) {
            const simSubstepRule = $('sim-substep-rule');
            if (currentSubstep) {
                setTxt('sim-substep-idx', `${substepCursor} / ${substepQueue.length} (${currentSubstep.type})`);
                if (simSubstepRule) {
                    simSubstepRule.textContent = currentSubstep.ruleText || '—';
                    simSubstepRule.className = currentSubstep.allowed ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold';
                }
                setTxt('sim-substep-desc', currentSubstep.desc || '');
            } else {
                setTxt('sim-substep-idx', '0 / 0 (ready — click Sub-Step)');
                if (simSubstepRule) {
                    simSubstepRule.textContent = '—';
                    simSubstepRule.className = 'text-emerald-400 font-semibold';
                }
                setTxt('sim-substep-desc', 'Click ⏭ Sub-Step or ▶ Run to trace each adjacency rule lookup & propagation check.');
            }
        }
    }

    $$('.algo-btn').forEach(b => b.classList.toggle('on', b.dataset.algo === currentAlgorithm));

    const btnSimRun = $('btn-sim-run');
    if (btnSimRun) {
        btnSimRun.textContent = simRunning ? '⏸ Pause' : '▶ Run';
        btnSimRun.classList.toggle('on', simRunning);
    }
    setTxt('btn-sim-step', substepMode ? '⏭ Sub-Step' : '⏭ Step');

    refreshPoolUI();
    refreshOutliner();
}

export function expandTelemetryHudForFEA() {
    const telemetryPanel = $('telemetry-panel');
    const telemetryCollapsible = $('telemetry-collapsible');
    const btnTelemetryMinimize = $('btn-telemetry-minimize');
    const telemetryResizeE = $('telemetry-resize-e');
    const telemetryResizeSE = $('telemetry-resize-se');
    if (!telemetryPanel || !telemetryCollapsible) return;
    if (telemetryPanel.classList.contains('minimized') || telemetryCollapsible.classList.contains('hidden')) {
        if (btnTelemetryMinimize) btnTelemetryMinimize.click();
        telemetryCollapsible.classList.remove('hidden');
        telemetryPanel.classList.remove('minimized');
        if (telemetryResizeE) telemetryResizeE.classList.remove('hidden');
        if (telemetryResizeSE) telemetryResizeSE.classList.remove('hidden');
        if (btnTelemetryMinimize) btnTelemetryMinimize.textContent = '–';
    }
}

export function emitFEATelemetry(res, sectionParams, mat, loadConfig, opts = {}) {
    const feaSrc = (res && res._sourceGraph) || (actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null);
    if (!res || !feaSrc) return;
    const { feaState } = appState;
    const runIdx = feaState.runCount;
    const now = new Date();
    const tsStr = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');

    const nNodes = (feaSrc.vertices || []).length;
    const nBars = (feaSrc.edges || []).length;
    const validAnchors = new Set((feaSrc.anchors || []).filter(i => i >= 0 && i < nNodes));
    const nAnchors = validAnchors.size;
    const isFixed = String(loadConfig.restraintType || 'pinned').toLowerCase() === 'fixed';
    const activeDofs = Math.max(0, 6 * nNodes - (isFixed ? 6 : 3) * nAnchors);
    const restraintLabel = isFixed ? 'Fixed 6-DOF' : 'Pinned 3-DOF';

    const rOutM = Math.max(1e-4, Number(sectionParams.outerRadiusM || 0.018));
    const rInM = Math.max(0, Math.min(rOutM - 1e-4, Number(sectionParams.innerRadiusM || 0)));
    const nSides = Number(sectionParams.nSides || 8);
    const areaMm2 = Math.PI * (rOutM * rOutM - rInM * rInM) * 1e6;
    const inertiaMm4 = 0.25 * Math.PI * (Math.pow(rOutM, 4) - Math.pow(rInM, 4)) * 1e12;

    const eGPa = (Number(mat.youngsModulusPa || 4.5e9) * 1e-9).toFixed(2);
    const sigTMPa = (Number(mat.tensileStrengthPa || 2.0e6) * 1e-6).toFixed(1);
    const sigCMPa = (Number(mat.compressiveStrengthPa || 10.0e6) * 1e-6).toFixed(1);
    const rho = Math.round(Number(mat.densityKgM3 || 1250));

    let swKg = Number(res.centerlineMassKg);
    if (!Number.isFinite(swKg) || swKg <= 0) {
        let totL = 0;
        for (const [u, v] of (feaSrc.edges || [])) {
            const pu = feaSrc.vertices[u], pv = feaSrc.vertices[v];
            if (pu && pv) totL += Math.hypot(pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]);
        }
        swKg = totL * (areaMm2 * 1e-6) * rho;
    }
    const topKg = Number(loadConfig.distributedVerticalMassKg || 0);
    const nLC = Array.isArray(res.loadCaseSummaries) && res.loadCaseSummaries.length > 0 ? res.loadCaseSummaries.length : 1;
    const govCase = res.governingCaseId || 'LC2_self_weight_plus_load';
    const sumRz = (res.reactions || []).reduce((s, r) => s + (r.force ? r.force[2] : 0), 0);
    const eqRes = Number(res.equilibriumResidual || 0).toExponential(2);

    const dispMm = Number(res.maxDispMm || 0);
    const dispTxt = dispMm > 0 && dispMm < 0.1 ? dispMm.toFixed(3) : dispMm.toFixed(2);
    const dispNode = (res.maxDispNode !== undefined && res.maxDispNode >= 0) ? res.maxDispNode : 0;
    const invL = Number.isFinite(res.inverseDeflectionRatio) && res.inverseDeflectionRatio < 99999
        ? `L/${Math.round(res.inverseDeflectionRatio)}`
        : 'L/>9999';

    const fmtSF = (v) => (!Number.isFinite(v) || v > 99) ? '>99×' : `${Number(v).toFixed(2)}×`;
    const sftStr = fmtSF(res.minSF_t);
    const sfcStr = fmtSF(res.minSF_c);
    const sfbStr = fmtSF(res.minSF_b);
    const funiPct = Math.round((res.funicularEfficiency !== undefined ? res.funicularEfficiency : 0.9) * 100);
    const compPct = Math.round((res.compressionDominance !== undefined ? res.compressionDominance : 1.0) * 100);
    const tensBars = res.tensileBarCount || 0;
    const verdictStr = res.passed ? 'PASS ✓' : 'CHECK LIMITS';

    const rawExag = Math.round(feaState.exaggeration);
    const effExag = Math.round(actions.computeEffectiveExaggeration ? actions.computeEffectiveExaggeration(rawExag) : rawExag);
    const visScaleStr = effExag > rawExag * 1.05 ? `${rawExag}× (eff ${effExag}× auto-vis)` : `${rawExag}×`;

    const hudPill = $('telemetry-hud-pill');
    if (hudPill) {
        hudPill.textContent = `FEA #${runIdx} · ${res.passed ? 'PASS ✓' : 'CHECK'}`;
        hudPill.className = res.passed
            ? 'panel-pill bg-emerald-950/90 border-emerald-500/50 text-emerald-300 font-bold'
            : 'panel-pill bg-amber-950/90 border-amber-500/50 text-amber-300 font-bold';
    }

    const hudVerdict = $('hud-fea-verdict');
    if (hudVerdict) {
        hudVerdict.textContent = verdictStr;
        hudVerdict.className = res.passed
            ? 'text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 font-bold'
            : 'text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-amber-950/90 border border-amber-500/50 text-amber-300 font-bold';
    }
    setTxt('hud-fea-run', `FEA #${runIdx} · ${tsStr}`);
    setTxt('hud-fea-solver', '12-DOF 3D Euler-Bernoulli');
    setTxt('hud-fea-dofs', `${nNodes}N / ${nBars}B / ${activeDofs} DOFs`);
    setTxt('hud-fea-restraint', `${restraintLabel} (${nAnchors} anchors)`);
    setTxt('hud-fea-section', `Ro=${(rOutM * 1000).toFixed(1)} Ri=${(rInM * 1000).toFixed(1)}mm N=${nSides} | A=${areaMm2.toFixed(0)}mm² I=${Math.round(inertiaMm4)}mm⁴`);
    setTxt('hud-fea-material', `${mat.name} (${eGPa}GPa, σt=${sigTMPa}/σc=${sigCMPa}MPa, ${rho}kg/m³)`);
    setTxt('hud-fea-loads', `Top ${topKg.toFixed(0)}kg + SW ${swKg.toFixed(1)}kg (${nLC} LC · ${govCase})`);
    setTxt('hud-fea-eq', `ΣRz=${sumRz.toFixed(1)} N · ||Ku−f||=${eqRes}`);
    setTxt('hud-fea-disp', `${dispTxt} mm @ #${dispNode} (${invL})`);
    setTxt('hud-fea-sfs', `SFt=${sftStr} · SFc=${sfcStr} · SFb=${sfbStr}`);
    setTxt('hud-fea-funi', `Funi ${funiPct}% · Comp ${compPct}% (${tensBars}T)`);

    // Update compact & status badges without auto-unfurling the Telemetry HUD

    const telBadge = $('fea-tel-run-badge');
    if (telBadge) {
        telBadge.textContent = `FEA #${runIdx} · ${tsStr}`;
        telBadge.className = res.passed
            ? 'text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/40 text-emerald-300 font-semibold'
            : 'text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-amber-950/80 border border-amber-500/40 text-amber-300 font-semibold';
    }

    const summaryLine = `#${runIdx} ${tsStr} · ${mat.name.split(' ')[0]} · ${topKg.toFixed(0)}kg · ${isFixed ? 'Fixed' : 'Pinned'} · |u|=${dispTxt}mm · SFt=${sftStr} · ${verdictStr}`;
    feaState.historyLog.unshift(summaryLine);
    if (feaState.historyLog.length > 6) feaState.historyLog.length = 6;

    const consoleEl = $('fea-telemetry-console');
    if (consoleEl) {
        const reportLines = [
            `[FEA #${runIdx} · ${tsStr}] VERDICT: ${verdictStr}`,
            `Solver: 12-DOF 3D Euler-Bernoulli Space-Frame`,
            `Model:  ${nNodes} Nodes / ${nBars} Bars / ${activeDofs} Active DOFs`,
            `Restr:  ${restraintLabel} · ${nAnchors} Ground Anchors`,
            `Sect:   Outer R=${(rOutM * 1000).toFixed(1)}mm, Inner R=${(rInM * 1000).toFixed(1)}mm, N=${nSides}`,
            `        Area A=${areaMm2.toFixed(1)} mm² · Inertia I=${Math.round(inertiaMm4)} mm⁴`,
            `Matl:   ${mat.name} (E=${eGPa} GPa, σ_t,allow=${sigTMPa} MPa, σ_c,allow=${sigCMPa} MPa, ρ=${rho} kg/m³)`,
            `Loads:  Top ${topKg.toFixed(1)} kg + Self-Weight ${swKg.toFixed(2)} kg (${nLC} cases)`,
            `GovLC:  ${govCase}`,
            `Equil:  ΣRz = ${sumRz.toFixed(2)} N · ||Ku - f|| = ${eqRes}`,
            `Disp:   Max |u| = ${dispTxt} mm @ Node #${dispNode} (${invL}) · Vis ${visScaleStr}`,
            `Safety: SF_t=${sftStr} · SF_c=${sfcStr} · SF_b=${sfbStr}`,
            `Action: Funicular Eff ${funiPct}% · Comp Dom ${compPct}% (${tensBars} tensile bars)`
        ];
        if (feaState.historyLog.length > 1) {
            reportLines.push('─── Run History ───');
            for (let i = 1; i < feaState.historyLog.length; i++) reportLines.push(feaState.historyLog[i]);
        }
        consoleEl.textContent = reportLines.join('\n');
    }
}

export function emitProcessTelemetry(info = {}) {
    const domain = String(info.domain || 'JOB').toUpperCase();
    const title = String(info.title || `${domain} Process`);
    const status = String(info.status || 'idle').toLowerCase(); // 'idle' | 'running' | 'done' | 'error'
    const pct = Math.max(0, Math.min(100, Math.round(Number(info.percent) || 0)));
    const stage = String(info.stage || (status === 'idle' ? 'Idle' : ''));
    const detail = String(info.detail || '—');
    const elapsedMs = Number(info.elapsedMs);
    const elapsedStr = Number.isFinite(elapsedMs) && elapsedMs >= 0
        ? (elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs)}ms`)
        : '—';

    const card = $('telemetry-proc-card');
    const fill = $('hud-proc-bar-fill');
    const pctEl = $('hud-proc-pct');
    const hudPill = $('telemetry-hud-pill');

    if (card) {
        card.classList.remove('is-running', 'is-done', 'is-error');
        if (status === 'running' || status === 'done' || status === 'error') {
            card.classList.add(`is-${status}`);
        }
    }
    if (fill) {
        fill.style.width = `${pct}%`;
        fill.classList.remove('is-running', 'is-done', 'is-error');
        if (status === 'running' || status === 'done' || status === 'error') {
            fill.classList.add(`is-${status}`);
        }
    }
    setTxt('hud-proc-title', title);
    setTxt('hud-proc-elapsed', elapsedStr);
    setTxt('hud-proc-stage', stage || '—');
    setTxt('hud-proc-detail', detail || '—');

    if (pctEl) {
        pctEl.classList.remove('is-pass', 'is-warn', 'is-fail', 'is-info');
        if (status === 'running') {
            pctEl.textContent = `${pct}%`;
            pctEl.classList.add('is-info');
        } else if (status === 'done') {
            pctEl.textContent = '100% ✓';
            pctEl.classList.add('is-pass');
        } else if (status === 'error') {
            pctEl.textContent = 'ERR';
            pctEl.classList.add('is-fail');
        } else {
            pctEl.textContent = 'Idle';
        }
    }

    if (hudPill) {
        if (status === 'running') {
            hudPill.textContent = `${domain} ${pct}%`;
            hudPill.className = 'panel-pill bg-cyan-950/90 border-cyan-500/50 text-cyan-300 font-bold';
        } else if (status === 'done') {
            hudPill.textContent = `${domain} 100% ✓`;
            hudPill.className = 'panel-pill bg-emerald-950/90 border-emerald-500/50 text-emerald-300 font-bold';
        } else if (status === 'error') {
            hudPill.textContent = `${domain} ERR`;
            hudPill.className = 'panel-pill bg-rose-950/90 border-rose-500/50 text-rose-300 font-bold';
        } else {
            hudPill.textContent = 'Idle';
            hudPill.className = 'panel-pill';
        }
    }
}

export function initTelemetryHud() {
    actions.updateSimUI = updateSimUI;
    actions.expandTelemetryHudForFEA = expandTelemetryHudForFEA;
    actions.emitFEATelemetry = emitFEATelemetry;
    actions.emitProcessTelemetry = emitProcessTelemetry;
}

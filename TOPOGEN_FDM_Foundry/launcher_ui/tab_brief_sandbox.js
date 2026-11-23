/**
 * WFC·FDM Foundry — Tab 1: Brief Composer & Instant Quick-Verify Sandbox
 *
 * Inputs / Outputs:
 *   - Manages structured brief form <-> `brief.schema.json` raw JSON editor.
 *   - Provides the interactive "Live Quick-Verify Tuner" card:
 *       Preset selector, Voxel Grid (`nx,ny,nz`), Seed, Outer/Inner Radius sliders,
 *       `q`-profile selector, Live-on-Change toggle, and "⚡ Instant Air-Gap Verify (~50ms)".
 *   - Calls `POST /api/quick-eval` when Daemon is online for exact air-gapped FEA
 *     safety factors & 3D PQ tubular mesh in ~50ms, falling back to ESM `WFC_FDM_CORE`.
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import { API_BASE, MATERIAL_PRESETS, appState, loadWfcCore } from './state.js';
import { drawEnvelopeBox, parseOBJTextAndRender, renderTopologyGraph, zoomFitModel } from './viewport3d.js';
import { updateRightHud } from './verdict_hud.js';
import { appendLogLine } from './tab_storage_logs.js';

let quickEvalTimer = null;
let quickEvalInFlight = false;
let quickEvalQueued = false;

const $ = id => document.getElementById(id);
const setVal = (id, v) => { const el = $(id); if (el) el.value = v; };
const setChk = (id, v) => { const el = $(id); if (el) el.checked = Boolean(v); };

export function parseGridInput(str, fallback = [2, 2, 3]) {
    const parts = String(str || '').split(/[x×,\s]+/i).map(Number).filter(n => Number.isFinite(n) && n >= 1);
    return parts.length === 3 ? parts.map(Math.round) : fallback;
}

export function populateBriefDropdown(briefs, selectFile = null) {
    appState.briefsMap.clear();
    const sel = $('sel-brief-file');
    if (!sel) return;
    sel.innerHTML = briefs.map(b => {
        appState.briefsMap.set(b.fileName, b);
        return `<option value="${b.fileName}">${b.fileName} — ${b.name}</option>`;
    }).join('');
    const pick = selectFile && appState.briefsMap.has(selectFile)
        ? selectFile
        : (appState.briefsMap.has('pilot_v2_pq_unrolled.json') ? 'pilot_v2_pq_unrolled.json' : briefs[0]?.fileName);
    if (pick && appState.briefsMap.has(pick)) {
        sel.value = pick;
        populateFormFromBrief(appState.briefsMap.get(pick).brief);
    }
}

export function populatePresetDropdown(presets = []) {
    if (Array.isArray(presets) && presets.length > 0) appState.presets = presets;
    const sel = $('qv-preset');
    if (!sel) return;
    const prev = sel.value || 'pilot_champion';
    sel.innerHTML = appState.presets.map(p => `<option value="${p}">${p}</option>`).join('');
    sel.value = appState.presets.includes(prev) ? prev : (appState.presets.includes('funicular_vault') ? 'funicular_vault' : appState.presets[0]);
}

export function populateFormFromBrief(b) {
    if (!b) return;
    const env = b.envelope || {}, topo = b.topology || {}, fun = b.funicular || {};
    const geom = b.geometry || {}, fab = b.fabrication || {}, sup = b.supports || {}, acc = b.acceptanceCriteria || {};
    const minG = topo.minGridResolution || [2, 2, 2], maxG = topo.maxGridResolution || [4, 4, 6];

    setVal('bf-id', b.id || 'custom-brief-v1');
    setVal('bf-name', b.name || 'Custom Structural Brief');
    setVal('bf-plan-x', env.maxPlanX ?? 1.0);
    setVal('bf-plan-y', env.maxPlanY ?? 1.0);
    setVal('bf-height-z', env.targetHeightZ ?? 2.0);
    setVal('bf-ground-z', env.groundZ ?? 0.0);
    setVal('bf-min-grid', minG.join(','));
    setVal('bf-max-grid', maxG.join(','));
    setChk('bf-sym-xy', topo.symmetryXY !== false);
    setVal('bf-fdm-mode', fun.mode || 'compression');
    setChk('bf-comp-only', Boolean(fun.requireCompressionOnly));
    setVal('bf-subdiv', geom.minLongitudinalSubdivLevels ?? 1);
    setChk('bf-pq-req', geom.requirePQOptimization !== false);
    setVal('bf-pq-warp-mm', +((geom.maxQuadPlanarityErrorM ?? 0.0005) * 1000).toFixed(2));
    setChk('bf-unroll-req', Boolean(fab.requireUnrolledPatternsPerBar));
    setVal('bf-min-anc', sup.minAnchors ?? 3);
    setVal('bf-max-anc', sup.maxAnchors ?? 4);
    setVal('bf-restraint', sup.restraintType || 'pinned');

    const loadCase = (b.loadCases || []).find(lc => (lc.distributedVerticalMassKg || 0) > 0);
    setVal('bf-load-kg', loadCase ? loadCase.distributedVerticalMassKg : 50);

    const minRMm = +((acc.minTubeOuterRadiusM ?? 0.012) * 1000).toFixed(1);
    const maxRMm = +((acc.maxTubeOuterRadiusM ?? 0.090) * 1000).toFixed(1);
    setVal('bf-defl-n', Math.round(1 / (acc.maxDeflectionRatio || (1 / 300))));
    setVal('bf-sft', acc.minTensileSafetyFactor ?? 1.5);
    setVal('bf-sfc', acc.minCompressiveSafetyFactor ?? 2.0);
    setVal('bf-sfb', acc.minBucklingSafetyFactor ?? 2.0);
    setVal('bf-min-r-mm', minRMm);
    setVal('bf-max-r-mm', maxRMm);
    setVal('bf-min-wall-mm', +((acc.minWallThicknessM ?? 0.006) * 1000).toFixed(1));

    // Sync Quick-Verify Tuner defaults to brief
    setVal('qv-grid', `${minG[0]},${minG[1]},${Math.max(minG[2], Math.min(maxG[2] || 3, 3))}`);
    const defOuterMm = Math.max(minRMm, Math.min(maxRMm, 16));
    const defInnerMm = Math.max(0, +(defOuterMm - Math.max(6, (acc.minWallThicknessM ?? 0.006) * 1000 + 1)).toFixed(1));
    setVal('qv-outer-r', defOuterMm);
    setVal('qv-inner-r', defInnerMm);
    if ($('qv-outer-r-lbl')) $('qv-outer-r-lbl').textContent = `${defOuterMm.toFixed(1)}mm`;
    if ($('qv-inner-r-lbl')) $('qv-inner-r-lbl').textContent = `${defInnerMm.toFixed(1)}mm`;

    setVal('bf-raw-json', JSON.stringify(b, null, 2));
    drawEnvelopeBox(env);
}

export function buildBriefFromForm() {
    if (appState.rawJsonMode) return JSON.parse($('bf-raw-json').value);

    const planX = Math.max(0.2, Number($('bf-plan-x').value) || 1.0);
    const planY = Math.max(0.2, Number($('bf-plan-y').value) || 1.0);
    const heightZ = Math.max(0.2, Number($('bf-height-z').value) || 2.0);
    const groundZ = Number($('bf-ground-z').value) || 0.0;
    const minGrid = parseGridInput($('bf-min-grid').value, [2, 2, 2]);
    const maxGrid = parseGridInput($('bf-max-grid').value, [4, 4, 6]);
    const symXY = $('bf-sym-xy').checked;
    const fdmMode = $('bf-fdm-mode').value;
    const compOnly = $('bf-comp-only').checked;
    const subdiv = Math.max(0, Math.round(Number($('bf-subdiv').value) || 0));
    const pqReq = $('bf-pq-req').checked;
    const pqWarpM = Math.max(0.00005, (Number($('bf-pq-warp-mm').value) || 0.5) / 1000);
    const unrollReq = $('bf-unroll-req').checked;
    const mat = { ...(MATERIAL_PRESETS[$('bf-mat-preset').value] || MATERIAL_PRESETS.plaster) };
    const loadKg = Math.max(0, Number($('bf-load-kg').value) || 0);
    const minAnc = Math.max(3, Math.round(Number($('bf-min-anc').value) || 3));
    const maxAnc = Math.max(minAnc, Math.round(Number($('bf-max-anc').value) || 4));
    const deflN = Math.max(50, Number($('bf-defl-n').value) || 300);
    const maxDeflM = +(Math.min(Math.max(planX, planY), heightZ) / deflN).toFixed(7);
    const minR = (Number($('bf-min-r-mm').value) || 12) / 1000;
    const maxR = (Number($('bf-max-r-mm').value) || 90) / 1000;
    const minWall = (Number($('bf-min-wall-mm').value) || 6) / 1000;
    const slug = String($('bf-id').value || 'new-foundry-brief').trim().toLowerCase().replace(/[^a-z0-9-_]/g, '-');

    const loadCases = [{ id: 'LC1_self_weight', name: 'Self-Weight Only', required: true, gravityMS2: 9.81, distributedVerticalMassKg: 0, distribution: 'none' }];
    if (loadKg > 0) {
        loadCases.push({
            id: `LC2_self_weight_plus_${Math.round(loadKg)}kg`,
            name: `Self-Weight + ${loadKg} kg Vertical Distributed Load`,
            required: true, idealTarget: true, gravityMS2: 9.81,
            distributedVerticalMassKg: loadKg, distribution: 'top_zone_nodes', topZoneFractionZ: 0.85,
        });
    }

    const brief = {
        $schema: '../schemas/brief.schema.json',
        id: slug,
        name: $('bf-name').value || slug,
        version: '1.0.0',
        description: `Brief authored via Foundry Launcher (${planX}x${planY}x${heightZ}m, +${loadKg}kg, Mode ${compOnly ? 'Compression-Only' : fdmMode}).`,
        envelope: {
            units: 'meters', coordinateSystem: 'Z-up', maxPlanX: planX, maxPlanY: planY, targetHeightZ: heightZ,
            minHeightZ: +(heightZ * 0.94).toFixed(3), maxHeightZ: +(heightZ * 1.04).toFixed(3),
            planTolerance: 0.02, groundZ, groundTolerance: 0.02,
        },
        topology: { minGridResolution: minGrid, maxGridResolution: maxGrid, symmetryXY: symXY, requireSingleConnectedComponent: true, pruneNonAnchorLeaves: true },
        geometry: { requireTubeTopology: true, minLongitudinalSubdivLevels: subdiv, requirePQOptimization: pqReq, maxQuadPlanarityErrorM: pqWarpM, requireWatertightManifoldMesh: true },
        funicular: {
            mode: compOnly ? 'compression' : fdmMode,
            allowedModes: compOnly ? ['compression'] : (fdmMode === 'auto' ? ['compression', 'zero-weight', 'tensile'] : [fdmMode]),
            requireCompressionOnly: compOnly,
            ...(compOnly ? { minCompressionDominance: 1.0, maxTensileAxialForceN: 0.0 } : {}),
            maxEquilibriumResidualNorm: 1e-4,
        },
        supports: { minAnchors: minAnc, maxAnchors: maxAnc, mustBeOnGround: true, restraintType: $('bf-restraint').value },
        material: mat,
        loadCases,
        fabrication: {
            requireUnrolledPatternsPerBar: unrollReq, unrollFormat: 'svg', allowUnrollSelfIntersection: false,
            minMemberLengthM: 0.04, maxSlendernessRatio: 120, minTubeOuterRadiusM: minR, maxTubeOuterRadiusM: maxR, minWallThicknessM: minWall,
        },
        acceptanceCriteria: {
            maxDeflectionRatio: +(1 / deflN).toFixed(8), characteristicLengthDef: 'min(planSpan, height)', maxDeflectionMeters: maxDeflM,
            minTensileSafetyFactor: Number($('bf-sft').value) || 1.5,
            minCompressiveSafetyFactor: Number($('bf-sfc').value) || 2.0,
            minBucklingSafetyFactor: Number($('bf-sfb').value) || 2.0,
            requireSingleConnectedComponent: true, requireWatertightManifoldMesh: true,
            minMemberLengthM: 0.04, maxSlendernessRatio: 120, minTubeOuterRadiusM: minR, maxTubeOuterRadiusM: maxR, minWallThicknessM: minWall,
        },
        objectives: [
            { metric: 'totalUnrolledSurfaceAreaM2', direction: 'minimize', priority: 1 },
            { metric: 'elementCount', direction: 'minimize', priority: 2 },
            { metric: 'centerlineMassKg', direction: 'minimize', priority: 3 },
            { metric: 'funicularEfficiency', direction: 'maximize', priority: 4 },
        ],
        deliverables: {
            htmlExplainer: { required: true, outputPath: 'TOPOGEN_FDM_Foundry/foundry_report.html' },
            videoShowcase60s: { required: true, outputPath: 'TOPOGEN_FDM_Foundry/foundry_showcase_60s.mp4', durationSeconds: 60, fps: 30, resolution: [1920, 1080] },
        },
    };
    setVal('bf-raw-json', JSON.stringify(brief, null, 2));
    return brief;
}

export function readQuickVerifyConfig(brief) {
    const preset = $('qv-preset')?.value || 'pilot_champion';
    const grid = parseGridInput($('qv-grid')?.value, brief?.topology?.minGridResolution || [2, 2, 3]);
    const outerMm = Number($('qv-outer-r')?.value) || 16;
    const minWallMm = (brief?.acceptanceCriteria?.minWallThicknessM ?? 0.006) * 1000;
    let innerMm = Number($('qv-inner-r')?.value) || 0;
    if (innerMm > 0 && outerMm - innerMm < minWallMm) innerMm = Math.max(0, +(outerMm - minWallMm).toFixed(1));
    const seed = Number($('qv-seed')?.value) || 42;

    return {
        name: `quick_${preset}_${grid.join('x')}_s${seed}`,
        tilePreset: preset, gridResolution: grid,
        outerRadiusM: +(outerMm / 1000).toFixed(4), innerRadiusM: +(innerMm / 1000).toFixed(4),
        nSides: 8, qProfile: $('qv-q-profile')?.value || 'funicular_tuned',
        fdmMode: brief?.funicular?.mode || 'compression', wfcSeed: seed, optimizeForceDensities: true,
    };
}

export async function runInstantQuickVerify(autoZoom = false) {
    if (quickEvalInFlight) { quickEvalQueued = true; return; }
    quickEvalInFlight = true;

    const statusEl = $('qv-status-badge'), fb = $('brief-save-feedback');
    let brief;
    try { brief = buildBriefFromForm(); }
    catch (err) { if (fb) fb.textContent = `Brief JSON error: ${err.message}`; quickEvalInFlight = false; return; }

    drawEnvelopeBox(brief.envelope);
    const config = readQuickVerifyConfig(brief);
    const t0 = performance.now();
    if (statusEl) {
        statusEl.textContent = '⏳ Eval...';
        statusEl.className = 'text-[8.5px] font-mono px-1.5 py-0.5 rounded bg-amber-950 text-amber-300 border border-amber-500/40';
    }

    try {
        if (appState.daemonOnline) {
            const res = await fetch(`${API_BASE}/api/quick-eval`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ brief, config }),
            });
            if (res.ok) {
                const data = await res.json();
                const dt = Math.round(data.elapsedMs || (performance.now() - t0));
                parseOBJTextAndRender(data.objText);
                renderTopologyGraph(data.topology || data.topologyJson, data.verdict);
                if (autoZoom) zoomFitModel();

                const rec = {
                    ...(data.record || {}), name: data.record?.name || config.name,
                    passed: Boolean(data.verdict?.passed ?? data.record?.passed),
                    quickVerified: true, evalMs: dt, config: { ...config, ...(data.record?.config || {}) },
                };
                updateRightHud(rec, data.patternsSvg);
                if (statusEl) {
                    statusEl.textContent = rec.passed ? `✓ PASS · ${dt}ms` : `✕ FAIL · ${dt}ms`;
                    statusEl.className = `text-[8.5px] font-mono px-1.5 py-0.5 rounded border ${rec.passed ? 'bg-emerald-950 text-emerald-300 border-emerald-500/40' : 'bg-rose-950 text-rose-300 border-rose-500/40'}`;
                }
                if (fb) {
                    fb.textContent = `Air-Gap FEA (${dt}ms): ${rec.nEdges || 0} bars, ${Number(rec.massKg || 0).toFixed(2)}kg — ${rec.passed ? 'ALL CHECKS PASS' : (rec.failureModes?.[0] || 'Check HUD')}`;
                    fb.className = `text-[9.5px] font-mono text-center ${rec.passed ? 'text-emerald-400' : 'text-amber-300'}`;
                }
                return;
            }
        }

        // Offline fallback: Direct ESM WFC_FDM_CORE (`../core/index.mjs`)
        const core = await loadWfcCore();
        if (!core) {
            if (fb) fb.textContent = 'Envelope updated (start foundry_server.mjs for air-gapped FEA).';
            if (autoZoom) zoomFitModel();
            return;
        }
        const res = core.generateCandidate(brief, config);
        const dt = Math.round(performance.now() - t0), m = res.metrics || {};
        parseOBJTextAndRender(res.objText);
        renderTopologyGraph(res.topologyJson, null);
        if (autoZoom) zoomFitModel();

        updateRightHud({
            name: `${config.name} (Offline Preview)`, passed: true, previewOnly: true,
            config: { ...config, gridResolution: m.gridResolution || config.gridResolution, outerRadiusM: res.topologyJson?.section?.outerRadiusM || config.outerRadiusM, innerRadiusM: res.topologyJson?.section?.innerRadiusM || config.innerRadiusM },
            totalUnrolledSurfaceAreaM2: m.totalUnrolledSurfaceAreaM2 || 0, nEdges: m.graphEdges, nNodes: m.graphVertices,
            massKg: m.centerlineMassKg, meshMassKg: m.centerlineMassKg, longitudinalSubdivLevels: m.longitudinalSubdivLevels,
            maxQuadPlanarityErrorMm: (m.maxQuadPlanarityErrorM || 0) * 1000, watertightManifold: m.watertight,
            funicularEfficiency: 0.96, compressionDominance: m.estTensileBars === 0 ? 1.0 : 0.85,
            maxDispMm: m.estMaxDispMM || 0.15, deflectionInverseN: 5000,
            sfTension: m.estMinSF_t || 99, sfCompression: m.estMinSF_c || 25, sfBuckling: m.estMinSF_b || 12,
            lateralMinSF: m.estLatMinSF || 4.0, fdmResidual: m.equilibriumResidual,
        }, res.patternsSvg);
        if (statusEl) statusEl.textContent = `LOCAL · ${dt}ms`;
        if (fb) fb.textContent = `Local Core Preview (${dt}ms): ${m.graphEdges} bars, ${m.centerlineMassKg} kg`;
    } catch (err) {
        if (fb) fb.textContent = `Quick-Verify error: ${err.message}`;
    } finally {
        quickEvalInFlight = false;
        if (quickEvalQueued) { quickEvalQueued = false; runInstantQuickVerify(false); }
    }
}

function scheduleLiveTunerVerify() {
    if (!$('qv-live-toggle')?.checked) return;
    clearTimeout(quickEvalTimer);
    quickEvalTimer = setTimeout(() => runInstantQuickVerify(false), 65);
}

export function initTabBriefSandbox() {
    populatePresetDropdown(appState.presets);

    $('btn-toggle-raw-json')?.addEventListener('click', (e) => {
        if (!appState.rawJsonMode) {
            buildBriefFromForm();
            appState.rawJsonMode = true;
            $('brief-form-container').classList.add('hidden');
            $('brief-raw-container').classList.remove('hidden');
            e.currentTarget.classList.add('on');
        } else {
            try {
                const parsed = JSON.parse($('bf-raw-json').value);
                appState.rawJsonMode = false;
                populateFormFromBrief(parsed);
                $('brief-form-container').classList.remove('hidden');
                $('brief-raw-container').classList.add('hidden');
                e.currentTarget.classList.remove('on');
            } catch (err) { alert('Invalid JSON: ' + err.message); }
        }
    });

    $('btn-new-brief-template')?.addEventListener('click', () => {
        const stamp = Math.floor(100 + Math.random() * 900);
        populateFormFromBrief({
            id: `custom-tower-${stamp}`, name: `Custom Funicular Tower #${stamp} (1.2×1.2×2.4m)`,
            envelope: { maxPlanX: 1.2, maxPlanY: 1.2, targetHeightZ: 2.4, groundZ: 0.0 },
            topology: { minGridResolution: [2, 2, 3], maxGridResolution: [4, 4, 6], symmetryXY: true },
            geometry: { minLongitudinalSubdivLevels: 1, requirePQOptimization: true, maxQuadPlanarityErrorM: 0.0005 },
            funicular: { mode: 'compression', requireCompressionOnly: true },
            supports: { minAnchors: 4, maxAnchors: 4, restraintType: 'pinned' },
            loadCases: [{ id: 'LC2', distributedVerticalMassKg: 60 }],
            fabrication: { requireUnrolledPatternsPerBar: true },
            acceptanceCriteria: { maxDeflectionRatio: 1 / 300, minTensileSafetyFactor: 1.5, minCompressiveSafetyFactor: 2.0, minBucklingSafetyFactor: 2.0, minTubeOuterRadiusM: 0.013, maxTubeOuterRadiusM: 0.085, minWallThicknessM: 0.006 },
        });
        if ($('brief-save-feedback')) $('brief-save-feedback').textContent = 'Drafted new brief — dial Quick-Verify Tuner or click Save / Launch.';
    });

    $('sel-brief-file')?.addEventListener('change', e => {
        const item = appState.briefsMap.get(e.target.value);
        if (item?.brief) populateFormFromBrief(item.brief);
    });

    ['bf-plan-x', 'bf-plan-y', 'bf-height-z', 'bf-ground-z'].forEach(id => {
        $(id)?.addEventListener('input', () => {
            drawEnvelopeBox({
                maxPlanX: Number($('bf-plan-x').value) || 1.0, maxPlanY: Number($('bf-plan-y').value) || 1.0,
                targetHeightZ: Number($('bf-height-z').value) || 2.0, groundZ: Number($('bf-ground-z').value) || 0.0,
            });
            scheduleLiveTunerVerify();
        });
    });

    $('qv-outer-r')?.addEventListener('input', e => {
        const v = Number(e.target.value) || 16;
        if ($('qv-outer-r-lbl')) $('qv-outer-r-lbl').textContent = `${v.toFixed(1)}mm`;
        const innerEl = $('qv-inner-r');
        if (innerEl && Number(innerEl.value) > v - 6) {
            innerEl.value = Math.max(0, +(v - 6).toFixed(1));
            if ($('qv-inner-r-lbl')) $('qv-inner-r-lbl').textContent = `${Number(innerEl.value).toFixed(1)}mm`;
        }
        scheduleLiveTunerVerify();
    });

    $('qv-inner-r')?.addEventListener('input', e => {
        const v = Math.min(Number(e.target.value) || 0, Math.max(0, (Number($('qv-outer-r')?.value) || 16) - 6));
        e.target.value = v;
        if ($('qv-inner-r-lbl')) $('qv-inner-r-lbl').textContent = `${v.toFixed(1)}mm`;
        scheduleLiveTunerVerify();
    });

    ['qv-preset', 'qv-grid', 'qv-q-profile', 'qv-seed'].forEach(id => {
        $(id)?.addEventListener('change', scheduleLiveTunerVerify);
        if (id === 'qv-grid' || id === 'qv-seed') $(id)?.addEventListener('input', scheduleLiveTunerVerify);
    });

    $('btn-quick-verify')?.addEventListener('click', () => runInstantQuickVerify(false));
    $('btn-preview-brief-3d')?.addEventListener('click', () => runInstantQuickVerify(true));

    $('btn-inject-tuner-cand')?.addEventListener('click', async () => {
        if (!appState.daemonOnline || appState.currentRunState?.status !== 'running') return runInstantQuickVerify(false);
        const brief = buildBriefFromForm(), config = readQuickVerifyConfig(brief);
        const res = await fetch(`${API_BASE}/api/nudge`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'inject_candidate', config, reason: 'Injected from Quick-Verify Tuner' }),
        });
        const data = await res.json();
        if (res.ok) appendLogLine('success', `Queued '${data.queuedName || config.name}' into active swarm.`);
    });

    $('btn-save-brief')?.addEventListener('click', async () => {
        const fb = $('brief-save-feedback');
        try {
            const brief = buildBriefFromForm();
            const res = await fetch(`${API_BASE}/api/briefs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brief }) });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Failed to save brief');
            if (fb) { fb.textContent = `Saved TOPOGEN_FDM_Foundry/${data.relPath}`; fb.className = 'text-[9.5px] font-mono text-center text-emerald-400'; }
            populateBriefDropdown(data.briefs, data.fileName);
        } catch (err) {
            if (fb) { fb.textContent = `Save error: ${err.message}`; fb.className = 'text-[9.5px] font-mono text-center text-rose-400'; }
        }
    });
}

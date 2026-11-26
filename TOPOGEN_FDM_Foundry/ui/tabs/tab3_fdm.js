/**
 * WFC-FDM Foundry — Tab 3: Force Density Method (FDM) & Fixed Anchor Selection (ui/tabs/tab3_fdm.js)
 *
 * Student Quick-Map:
 *   - Edit Tab 3 HTML presets / anchor / q-profile controls -> mountTab3Fdm()
 *   - Edit 3D force-colored network & clickable anchor dots -> renderFDMNetwork()
 *   - Edit interactive 3D node click & valency selection    -> toggleFdmFixedNodesByClick(), selectFdmFixedNodesByValency()
 *   - Edit preset loader & FDM solver execution             -> applyTilePresetUI(), runFDMOnActiveGraph()
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    $,
    $$,
    setTxt,
    bindSlider
} from '../state/workbench_state.js';
import {
    viewport,
    sharedMaterials,
    sharedGeometries,
    clearGroup,
    makeFatMaterial,
    makeFatLineSegments,
    recomputeModelBox,
    zoomToBox,
    modelBoxToWorld
} from '../display/viewport_scene.js';
import { applyOutlinerVisibility } from '../display/display_hud.js';

export function mountTab3Fdm() {
    const pane = $('tab-fdm');
    if (!pane) return;
    pane.innerHTML = `
        <!-- Structural Tile Presets -->
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2 space-y-1.5">
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Host Network Source</span>
                <span id="fdm-preset-badge" class="text-[9.5px] font-mono text-pink-400">active_topo</span>
            </div>
            <p class="goldilocks-guide-prose text-[9.5px] text-gray-400 leading-snug">
                Inspect or form-find your 2. Topo network directly, or load a structural preset below.
            </p>
            <button data-tile-preset="active_topo" class="tile-preset-btn cad-btn cyan seg-on w-full py-1.5 px-2 flex items-center justify-between text-[9.5px]" title="Host Network — Form-find active Topo network without resetting grid.">
                <span class="font-semibold">⬡ Use Topo Gen Network</span>
                <span id="active-topo-graph-badge" class="font-mono text-[8.5px] px-1.5 py-0.5 rounded bg-gray-950/80 border border-cyan-500/30 text-cyan-300">Active Graph</span>
            </button>
            <div class="grid grid-cols-3 gap-1">
                <button data-tile-preset="pilot_champion"     class="tile-preset-btn cad-btn text-[9px] py-1">★ Champion</button>
                <button data-tile-preset="catenary_quadripod" class="tile-preset-btn cad-btn text-[9px] py-1">Catenary Quad</button>
                <button data-tile-preset="funicular_vault"    class="tile-preset-btn cad-btn text-[9px] py-1">Funicular Vault</button>
                <button data-tile-preset="slender_diagrid"    class="tile-preset-btn cad-btn text-[9px] py-1">Slender Diagrid</button>
                <button data-tile-preset="hyperboloid_tower"  class="tile-preset-btn cad-btn text-[9px] py-1">Hyperboloid</button>
                <button data-tile-preset="arch_braced"        class="tile-preset-btn cad-btn text-[9px] py-1">Arch Braced</button>
                <button data-tile-preset="diagrid_tower"      class="tile-preset-btn cad-btn text-[9px] py-1">Diagrid</button>
                <button data-tile-preset="space_frame"        class="tile-preset-btn cad-btn text-[9px] py-1">Space Frame</button>
                <button data-tile-preset="minimal_frame"      class="tile-preset-btn cad-btn text-[9px] py-1">Minimal</button>
            </div>
        </div>

        <!-- Force Density Method (FDM) Engine -->
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2 space-y-1.5 text-[10px] font-mono">
            <div class="flex items-center justify-between font-sans">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Force Density Method (FDM)</span>
                <span id="fdm-status-badge" class="text-[9.5px] font-mono text-gray-400">Host · FDM Off</span>
            </div>

            <!-- Radio Trigger for FDM on Host Network (OFF by default) -->
            <div class="bg-gray-950/85 border border-gray-800 rounded p-1.5 space-y-1 font-sans">
                <div class="text-[8.5px] uppercase tracking-wider text-gray-400 font-semibold">Trigger FDM on Host Network</div>
                <div class="grid grid-cols-2 gap-1.5 text-[9.5px]">
                    <label class="flex items-center space-x-1.5 px-2 py-1 rounded border border-gray-700 bg-gray-900/90 cursor-pointer hover:border-gray-500 text-gray-200">
                        <input type="radio" id="rad-fdm-host-off" name="fdm-host-trigger" value="off" checked class="accent-gray-400">
                        <span>Off (Host Only)</span>
                    </label>
                    <label class="flex items-center space-x-1.5 px-2 py-1 rounded border border-cyan-500/40 bg-cyan-950/30 cursor-pointer hover:border-cyan-400 text-cyan-200">
                        <input type="radio" id="rad-fdm-host-on" name="fdm-host-trigger" value="on" class="accent-cyan-400">
                        <span class="font-semibold">On (Run FDM)</span>
                    </label>
                </div>
            </div>

            <!-- Interactive Fixed Anchor Node Selection (3D Click, Valency, Ctrl+Click Deselect) -->
            <div class="bg-gray-950/85 border border-gray-800 rounded p-1.5 space-y-1 font-sans">
                <div class="flex items-center justify-between">
                    <span class="text-[8.5px] uppercase tracking-wider text-emerald-400 font-semibold">Fixed Nodes (Anchors)</span>
                    <span id="fdm-fixed-nodes-badge" class="text-[8.5px] font-mono text-emerald-300">0 fixed</span>
                </div>
                <div class="text-[8.5px] text-gray-400 leading-tight">
                    Click 3D node = Fix · <span class="text-rose-300 font-mono">Ctrl+Click</span> = De-select
                </div>
                <div class="flex items-center justify-between gap-1 pt-0.5">
                    <span class="text-[8.5px] text-gray-400 flex-shrink-0">Valency:</span>
                    <div class="grid grid-cols-5 gap-0.5 flex-1">
                        <button type="button" data-fix-valency="1" class="fdm-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Fix all valency-1 leaf nodes (Ctrl+Click to de-select v=1)">v=1</button>
                        <button type="button" data-fix-valency="2" class="fdm-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Fix all valency-2 nodes (Ctrl+Click to de-select v=2)">v=2</button>
                        <button type="button" data-fix-valency="3" class="fdm-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Fix all valency-3 nodes (Ctrl+Click to de-select v=3)">v=3</button>
                        <button type="button" data-fix-valency="4" class="fdm-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Fix all valency-4 nodes (Ctrl+Click to de-select v=4)">v=4</button>
                        <button type="button" data-fix-valency="5+" class="fdm-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Fix all nodes with valency >= 5 (Ctrl+Click to de-select v>=5)">v≥5</button>
                    </div>
                </div>
                <div class="grid grid-cols-2 gap-1 pt-0.5">
                    <button type="button" id="btn-fix-ground-nodes" class="cad-btn text-[8.5px] py-0.5" title="Reset fixed nodes to lowest-Z ground support nodes">⏚ Fix Ground (z≈0)</button>
                    <button type="button" id="btn-clear-fixed-nodes" class="cad-btn text-[8.5px] py-0.5" title="De-select all fixed nodes">✕ Clear Fixed</button>
                </div>
                <div id="fdm-fixed-nodes-list" class="text-[8px] font-mono text-gray-400 truncate">IDs: —</div>
            </div>

            <div class="grid grid-cols-3 gap-1">
                <button data-fdm-mode="compression" class="fdm-mode-btn cad-btn seg-on text-[9px] py-0.5" title="Gravity/loaded funicular compression network (upward p_z > 0)">Compression</button>
                <button data-fdm-mode="tensile"     class="fdm-mode-btn cad-btn text-[9px] py-0.5" title="Tensile cable net (q > 0, downward p_z <= 0)">Tensile</button>
                <button data-fdm-mode="zero-weight" class="fdm-mode-btn cad-btn text-[9px] py-0.5" title="Self-equilibrated minimal network (p = 0)">Zero-Weight</button>
            </div>

            <div class="flex items-center justify-between space-x-2">
                <span class="text-gray-400">q Profile</span>
                <select id="sel-fdm-qprofile" class="flex-1 bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-[10px] text-gray-100">
                    <option value="column_boosted" selected>Column-Boosted</option>
                    <option value="funicular_tuned">Funicular Tuned (Iter)</option>
                    <option value="height_graded">Height-Graded</option>
                    <option value="uniform">Uniform q</option>
                </select>
            </div>

            <div class="flex items-center space-x-2">
                <span class="w-18 text-gray-400">q Base</span>
                <input type="range" id="rng-fdm-q" min="0.5" max="40" step="0.5" value="5.0" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-fdm-q" class="w-10 text-right text-gray-200">5.0</span>
            </div>

            <div class="flex items-center space-x-2">
                <span class="w-18 text-gray-400">Load p_z</span>
                <input type="range" id="rng-fdm-load" min="0" max="2000" step="25" value="500" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-fdm-load" class="w-10 text-right text-gray-200">500</span>
            </div>

            <div class="flex items-center space-x-2">
                <span class="w-18 text-gray-400">Max Anch</span>
                <input type="range" id="rng-fdm-anchors" min="3" max="12" step="1" value="4" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-fdm-anchors" class="w-10 text-right text-gray-200">4</span>
            </div>

            <div class="flex items-center justify-between text-[9.5px] font-sans text-gray-300">
                <span class="text-[8.5px] font-mono text-emerald-400">Fixed Anchors Locked · No Post-Topo Rescale</span>
                <label class="flex items-center space-x-1 cursor-pointer">
                    <input type="checkbox" id="chk-fdm-prune" checked class="accent-cyan-400 rounded">
                    <span>Prune Leaves</span>
                </label>
            </div>

            <div class="flex space-x-1 pt-0.5">
                <button id="btn-run-fdm" class="cad-btn cyan flex-1 py-1">⚡ Run FDM</button>
                <button id="btn-reset-fdm" class="cad-btn py-1 px-2" title="Reset deformed FDM graph back to the undeformed host network while staying in 4. FDM">↺ Reset Topo</button>
            </div>

            <div id="fdm-readout" class="bg-gray-950/80 border border-gray-800 rounded px-1.5 py-1 text-[9px] text-gray-300 truncate">
                Host Network · Trigger FDM radio is Off
            </div>
        </div>
    `;
}

export function renderFDMNetwork(fdm, opts = {}) {
    clearGroup(viewport.fdmGroup);
    appState.fdmNodePickMeshes = [];
    if (!fdm || !fdm.edges || fdm.edges.length === 0) return;

    const isHostOnly = !!opts.isHostOnly;
    const nEdges = fdm.edges.length;
    const pos = new Float32Array(nEdges * 6);
    const col = new Float32Array(nEdges * 6);

    let maxF = 1e-6;
    if (!isHostOnly && Array.isArray(fdm.edgeForces)) {
        for (let i = 0; i < nEdges; i++) {
            const af = Math.abs(fdm.edgeForces[i] || 0);
            if (af > maxF) maxF = af;
        }
    }

    const cLow = new THREE.Color(isHostOnly ? 0x94a3b8 : (fdm.mode === 'compression' ? 0x38bdf8 : (fdm.mode === 'tensile' ? 0xf59e0b : 0x94a3b8)));
    const cHigh = new THREE.Color(isHostOnly ? 0x38bdf8 : (fdm.mode === 'compression' ? 0x1d4ed8 : (fdm.mode === 'tensile' ? 0xe11d48 : 0x10b981)));
    const tmpC = new THREE.Color();

    for (let i = 0; i < nEdges; i++) {
        const [u, v] = fdm.edges[i];
        const pu = fdm.vertices[u], pv = fdm.vertices[v];
        if (!pu || !pv) continue;
        const o = i * 6;
        pos[o] = pu[0]; pos[o + 1] = pu[1]; pos[o + 2] = pu[2];
        pos[o + 3] = pv[0]; pos[o + 4] = pv[1]; pos[o + 5] = pv[2];
        const t = isHostOnly ? 0.55 : Math.min(1, Math.abs((fdm.edgeForces && fdm.edgeForces[i]) || 0) / maxF);
        tmpC.copy(cLow).lerp(cHigh, t);
        col[o] = tmpC.r; col[o + 1] = tmpC.g; col[o + 2] = tmpC.b;
        col[o + 3] = tmpC.r; col[o + 4] = tmpC.g; col[o + 5] = tmpC.b;
    }
    const lines = makeFatLineSegments(
        pos,
        makeFatMaterial(0xffffff, appState.edgeDisplayWidthPx || 1.5, {
            disposeOnClear: true,
            vertexColors: true
        }),
        col
    );
    lines.renderOrder = 15;
    viewport.fdmGroup.add(lines);

    const bb = fdm.boundingBox || { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 2] };
    const span = Math.max(0.5, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]));
    const baseR = Math.max(0.018, Math.min(0.055, span * 0.018)) * (appState.nodeDisplayScale || 1.0);
    const fixedSet = new Set(fdm.anchors || []);
    const hostMap = Array.isArray(fdm.hostNodeMap) ? fdm.hostNodeMap : null;

    for (let i = 0; i < fdm.vertices.length; i++) {
        const p = fdm.vertices[i];
        if (!p) continue;
        const isFixed = fixedSet.has(i);
        const sph = new THREE.Mesh(sharedGeometries.fdmPickSphere, isFixed ? sharedMaterials.anchorSphere : sharedMaterials.freeNodeSphere);
        sph.scale.setScalar(isFixed ? baseR * 1.42 : baseR * 0.88);
        sph.position.set(p[0], p[1], p[2]);
        sph.renderOrder = isFixed ? 17 : 16;
        sph.userData.fdmNodeIndex = i;
        sph.userData.fdmHostNodeIndices = (hostMap && Array.isArray(hostMap[i]) && hostMap[i].length > 0) ? hostMap[i] : [i];
        sph.userData.isFixedAnchor = isFixed;
        viewport.fdmGroup.add(sph);
        appState.fdmNodePickMeshes.push(sph);
    }
}

export function setFdmHostTriggerUI(on) {
    appState.fdmState.triggerOnHost = !!on;
    const radOn = $('rad-fdm-host-on'), radOff = $('rad-fdm-host-off');
    if (radOn) radOn.checked = appState.fdmState.triggerOnHost;
    if (radOff) radOff.checked = !appState.fdmState.triggerOnHost;
}

function computeGraphValences(nVerts, edges) {
    const val = new Int32Array(nVerts);
    for (const [u, v] of (edges || [])) {
        if (u >= 0 && u < nVerts) val[u]++;
        if (v >= 0 && v < nVerts) val[v]++;
    }
    return val;
}

export function updateFdmFixedNodesUI() {
    const badge = $('fdm-fixed-nodes-badge');
    const listEl = $('fdm-fixed-nodes-list');
    const { lastHostGraph, fdmFixedNodeSet } = appState;
    const nHost = lastHostGraph && lastHostGraph.vertices ? lastHostGraph.vertices.length : 0;
    const validIds = Array.from(fdmFixedNodeSet).filter(i => i >= 0 && i < nHost).sort((a, b) => a - b);
    if (badge) {
        badge.textContent = `${validIds.length} / ${nHost} fixed`;
        badge.className = validIds.length > 0 ? 'text-[8.5px] font-mono text-emerald-300' : 'text-[8.5px] font-mono text-amber-300';
    }
    if (listEl) {
        if (validIds.length === 0) {
            listEl.textContent = 'IDs: none (click 3D node or Valency button)';
        } else {
            const shown = validIds.slice(0, 12).map(id => `#${id}(v${lastHostGraph && lastHostGraph.valences ? lastHostGraph.valences[id] : '?'})`);
            listEl.textContent = `Fixed: ${shown.join(', ')}${validIds.length > 12 ? ` +${validIds.length - 12} more` : ''}`;
        }
    }
    $$('.fdm-valency-btn').forEach(btn => {
        if (!lastHostGraph || !lastHostGraph.valences) { btn.classList.remove('seg-on'); return; }
        const spec = btn.dataset.fixValency;
        let matching = 0, fixedMatch = 0;
        for (let i = 0; i < nHost; i++) {
            const kv = lastHostGraph.valences[i];
            if (spec === '5+' ? (kv >= 5) : (kv === parseInt(spec, 10))) {
                matching++;
                if (fdmFixedNodeSet.has(i)) fixedMatch++;
            }
        }
        btn.classList.toggle('seg-on', matching > 0 && fixedMatch === matching);
    });
}

export function refreshHostGraph({ preserveFixed = true } = {}) {
    let g = actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : null;
    if (!g || g.edges.length === 0) {
        if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate();
        if (actions.draw) actions.draw();
        g = actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : null;
    }
    if (!g || g.edges.length === 0) {
        appState.lastHostGraph = null;
        updateFdmFixedNodesUI();
        return null;
    }
    const comp = CORE.extractLargestComponent(g.vertices, g.edges);
    const valences = computeGraphValences(comp.vertices.length, comp.edges);
    const defaultAnchors = CORE.selectGroundAnchors(comp.vertices, comp.edges, {
        maxAnchors: appState.fdmState.maxAnchors,
        minAnchors: Math.min(3, comp.vertices.length)
    });
    appState.lastHostGraph = {
        vertices: comp.vertices.map(p => [p[0], p[1], p[2]]),
        edges: comp.edges.map(e => [e[0], e[1]]),
        valences,
        boundingBox: comp.boundingBox,
        defaultAnchors
    };

    if (!preserveFixed || !appState.fdmFixedCustomized) {
        appState.fdmFixedNodeSet = new Set(defaultAnchors);
        appState.fdmFixedCustomized = false;
    } else {
        const nextSet = new Set();
        for (const id of appState.fdmFixedNodeSet) {
            if (id >= 0 && id < appState.lastHostGraph.vertices.length) nextSet.add(id);
        }
        appState.fdmFixedNodeSet = nextSet;
    }
    updateFdmFixedNodesUI();
    return appState.lastHostGraph;
}

export function getActiveFixedAnchorArray(host = appState.lastHostGraph) {
    if (!host || !host.vertices) return [];
    return Array.from(appState.fdmFixedNodeSet).filter(i => i >= 0 && i < host.vertices.length).sort((a, b) => a - b);
}

export function getActiveGraphWithAnchors() {
    if (appState.fdmState.triggerOnHost && appState.lastFDMResult && appState.lastFDMResult.edges && appState.lastFDMResult.edges.length > 0) {
        return appState.lastFDMResult;
    }
    const host = appState.lastHostGraph || refreshHostGraph({ preserveFixed: true });
    if (!host || !host.edges || host.edges.length === 0) return null;
    const anchors = getActiveFixedAnchorArray(host);
    return {
        vertices: host.vertices,
        edges: host.edges,
        anchors: anchors.length > 0 ? anchors : host.defaultAnchors,
        boundingBox: host.boundingBox,
        mode: 'host',
        edgeForces: host.edges.map(() => 0),
        equilibriumResidual: 0,
        hostNodeMap: host.vertices.map((_, idx) => [idx])
    };
}

export function renderHostNetworkInFdmGroup() {
    const host = appState.lastHostGraph || refreshHostGraph({ preserveFixed: true });
    if (!host) {
        clearGroup(viewport.fdmGroup);
        appState.fdmNodePickMeshes = [];
        return null;
    }
    const anchors = getActiveFixedAnchorArray(host);
    renderFDMNetwork({
        vertices: host.vertices,
        edges: host.edges,
        anchors,
        boundingBox: host.boundingBox,
        mode: 'host',
        edgeForces: null,
        hostNodeMap: host.vertices.map((_, idx) => [idx])
    }, { isHostOnly: true });

    const bb = host.boundingBox;
    const badge = $('fdm-status-badge');
    if (badge) { badge.textContent = 'Host · FDM Off'; badge.className = 'text-[9.5px] font-mono text-gray-400'; }
    setTxt('fdm-readout', `Host Graph: ${host.vertices.length}V/${host.edges.length}E · Fixed: ${anchors.length} · ${(bb.max[0] - bb.min[0]).toFixed(3)}×${(bb.max[1] - bb.min[1]).toFixed(3)}×${(bb.max[2] - bb.min[2]).toFixed(3)}m`);
    updateFdmFixedNodesUI();
    applyOutlinerVisibility();
    recomputeModelBox();
    return host;
}

function handleFdmFixedNodesUpdated() {
    updateFdmFixedNodesUI();
    if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
    if (appState.fdmState.triggerOnHost) {
        runFDMOnActiveGraph({ keepCamera: true });
    } else {
        appState.lastSolidData = null;
        renderHostNetworkInFdmGroup();
    }
}

export function toggleFdmFixedNodesByClick(hostIndices, isCtrlDeselect = false) {
    if (!appState.lastHostGraph) refreshHostGraph({ preserveFixed: true });
    if (!appState.lastHostGraph) return;
    for (const hIdx of hostIndices) {
        if (hIdx < 0 || hIdx >= appState.lastHostGraph.vertices.length) continue;
        if (isCtrlDeselect) appState.fdmFixedNodeSet.delete(hIdx);
        else appState.fdmFixedNodeSet.add(hIdx);
    }
    appState.fdmFixedCustomized = true;
    handleFdmFixedNodesUpdated();
}

export function selectFdmFixedNodesByValency(valSpec, isCtrlDeselect = false) {
    const host = appState.lastHostGraph || refreshHostGraph({ preserveFixed: true });
    if (!host || !host.valences) return;
    for (let i = 0; i < host.vertices.length; i++) {
        const kv = host.valences[i];
        if (!(valSpec === '5+' ? (kv >= 5) : (kv === parseInt(valSpec, 10)))) continue;
        if (isCtrlDeselect) appState.fdmFixedNodeSet.delete(i);
        else appState.fdmFixedNodeSet.add(i);
    }
    appState.fdmFixedCustomized = true;
    handleFdmFixedNodesUpdated();
}

function collapseGridForPresetImmediate(presetName, targetGrid) {
    appState.GRID_X = targetGrid[0];
    appState.GRID_Y = targetGrid[1];
    appState.GRID_Z = targetGrid[2];
    appState.GRID_ORIGIN.set(-(appState.GRID_X * appState.VOXEL_SIZE) * 0.5, -(appState.GRID_Y * appState.VOXEL_SIZE) * 0.5, 0);

    let bestWfc = null;
    for (let attempt = 0; attempt < 12; attempt++) {
        const wfcRes = CORE.runWFCSolver({
            gridResolution: [appState.GRID_X, appState.GRID_Y, appState.GRID_Z],
            voxelSize: appState.VOXEL_SIZE,
            algorithm: appState.currentAlgorithm,
            tilePreset: presetName,
            ruleMode: 'socket',
            wfcSeed: 42 + attempt * 7,
            symmetryXY: true
        });
        const wGraph = CORE.buildWeldedGraphFromVoxels(wfcRes.voxels, wfcRes.tiles, [appState.GRID_X, appState.GRID_Y, appState.GRID_Z], appState.VOXEL_SIZE, {
            weldTol: 1e-4,
            mergeCollinear: appState.mergeCollinearNodes
        });
        bestWfc = wfcRes;
        if (wGraph.edges.length >= 4) {
            const comp = CORE.extractLargestComponent(wGraph.vertices, wGraph.edges);
            const ancs = CORE.selectGroundAnchors(comp.vertices, comp.edges, { maxAnchors: appState.fdmState.maxAnchors, minAnchors: 3 });
            if (ancs.length >= 3 && (comp.boundingBox.max[2] - comp.boundingBox.min[2]) > 0.2) break;
        }
    }

    if (bestWfc && bestWfc.voxels) {
        appState.voxels = bestWfc.voxels.map((cv, idx) => ({
            x: cv.x, y: cv.y, z: cv.z, idx,
            collapsed: true,
            tile: cv.tile !== null && cv.tile !== undefined ? cv.tile : CORE.TILE_NULL,
            domain: appState.TILES.map((_, ti) => ti === (cv.tile || 0)),
            inFrontier: false
        }));
        appState.simStepCount = appState.voxels.length;
        appState.simRunning = false;
    } else if (actions.collapseFullGridImmediate) {
        actions.collapseFullGridImmediate();
    }
}

export function applyTilePresetUI(presetName, opts = {}) {
    const targetPreset = presetName || 'active_topo';
    appState.currentTilePreset = targetPreset;
    appState.lastFDMResult = null;
    appState.lastSolidData = null;
    appState.lastFEAResult = null;
    clearGroup(viewport.tubeGroup);
    clearGroup(viewport.unroll3DGroup);
    clearGroup(viewport.feaGroup);

    setTxt('fdm-preset-badge', targetPreset);
    $$('.tile-preset-btn').forEach(b => b.classList.toggle('seg-on', b.dataset.tilePreset === targetPreset));

    const activateFdmTabBarIfNeeded = () => {
        if (appState.activeTabId === 'tab-tiles' || appState.activeTabId === 'tab-topo') {
            appState.activeTabId = 'tab-fdm';
            $$('.ui-tab').forEach(b => {
                const active = b.dataset.tab === 'tab-fdm';
                b.classList.toggle('border-pink-500', active);
                b.classList.toggle('text-white', active);
                b.classList.toggle('bg-gray-800/70', active);
                b.classList.toggle('border-transparent', !active);
                b.classList.toggle('text-gray-400', !active);
            });
            $$('.tab-pane').forEach(pane => pane.classList.toggle('hidden', pane.id !== 'tab-fdm'));
        }
    };

    if (targetPreset === 'active_topo') {
        activateFdmTabBarIfNeeded();
        if (actions.syncTubeWallRadiiUI) actions.syncTubeWallRadiiUI();
        refreshHostGraph({ preserveFixed: false });
        if (appState.fdmState.triggerOnHost) {
            runFDMOnActiveGraph({ skipAutoSolidify: appState.activeTabId !== 'tab-pq', keepCamera: true });
        } else {
            renderHostNetworkInFdmGroup();
        }
        if (appState.activeTabId === 'tab-pq' && appState.tubeState.show && actions.solidifyActiveGraph) {
            actions.solidifyActiveGraph({ keepCamera: true });
        }
        applyOutlinerVisibility();
        recomputeModelBox();
        return;
    }

    const presetDef = CORE.applyTilePresetToTiles(appState.TILES, targetPreset);
    if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();

    const sigTile = appState.TILES.find((t, idx) => idx > 3 && t.enabled) || appState.TILES.find((t, idx) => idx > 0 && t.enabled);
    if (sigTile) appState.inspectedTileId = sigTile.id;

    if (presetDef && presetDef.defaultConfig) {
        const dc = presetDef.defaultConfig;
        if (dc.fdmMode) {
            appState.fdmState.mode = dc.fdmMode;
            $$('.fdm-mode-btn').forEach(b => b.classList.toggle('seg-on', b.dataset.fdmMode === dc.fdmMode));
        }
        if (dc.qProfile) {
            appState.fdmState.qProfile = dc.qProfile;
            const sel = $('sel-fdm-qprofile');
            if (sel) sel.value = dc.qProfile;
        }
        if (dc.qBase !== undefined) {
            appState.fdmState.qBase = dc.qBase;
            const qEl = $('rng-fdm-q');
            if (qEl) qEl.value = String(dc.qBase);
            setTxt('val-fdm-q', String(dc.qBase));
        }
        if (dc.columnBoost !== undefined) appState.fdmState.columnBoost = dc.columnBoost;
        if (dc.outerRadiusM !== undefined) appState.tubeState.radius = dc.outerRadiusM;
        if (dc.innerRadiusM !== undefined) appState.tubeState.innerRadiusM = dc.innerRadiusM;
    }
    if (actions.syncTubeWallRadiiUI) actions.syncTubeWallRadiiUI();

    const rawGrid = (presetDef && Array.isArray(presetDef.defaultGrid) && presetDef.defaultGrid.length === 3)
        ? presetDef.defaultGrid : [2, 2, 3];
    const targetGrid = (rawGrid[0] <= 1 && rawGrid[1] <= 1) ? [2, 2, Math.max(3, rawGrid[2])] : rawGrid;

    collapseGridForPresetImmediate(targetPreset, targetGrid);
    if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
    if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
    if (actions.draw) actions.draw();

    activateFdmTabBarIfNeeded();
    appState.fdmFixedCustomized = false;
    refreshHostGraph({ preserveFixed: false });
    if (appState.fdmState.triggerOnHost) {
        runFDMOnActiveGraph({ skipAutoSolidify: appState.activeTabId !== 'tab-pq', keepCamera: true });
    } else {
        renderHostNetworkInFdmGroup();
    }
    if (appState.activeTabId === 'tab-pq' && appState.tubeState.show && actions.solidifyActiveGraph) {
        actions.solidifyActiveGraph({ keepCamera: true });
    }
    applyOutlinerVisibility();
    recomputeModelBox();
    if (!opts.keepCamera) zoomToBox(modelBoxToWorld(appState.modelBox));
}

export function runFDMOnActiveGraph(opts = {}) {
    if (opts.enableTrigger !== false) setFdmHostTriggerUI(true);
    const host = appState.lastHostGraph || refreshHostGraph({ preserveFixed: true });
    if (!host || !host.edges || host.edges.length === 0) return null;

    let workVerts = host.vertices.map(p => [p[0], p[1], p[2]]);
    let workEdges = host.edges.map(e => [e[0], e[1]]);
    let anchors = appState.fdmFixedCustomized
        ? getActiveFixedAnchorArray(host)
        : CORE.selectGroundAnchors(workVerts, workEdges, { maxAnchors: appState.fdmState.maxAnchors, minAnchors: Math.min(3, workVerts.length) });

    if (!appState.fdmFixedCustomized) {
        appState.fdmFixedNodeSet = new Set(anchors);
        updateFdmFixedNodesUI();
    }
    if (anchors.length === 0) {
        const badge = $('fdm-status-badge');
        if (badge) { badge.textContent = 'Need ≥1 Fixed Node'; badge.className = 'text-[9.5px] font-mono text-amber-400'; }
        setTxt('fdm-readout', 'Select ≥1 fixed node (click 3D node or Valency) to solve FDM.');
        renderHostNetworkInFdmGroup();
        return null;
    }

    let workHostMap = workVerts.map((_, idx) => [idx]);
    if (appState.fdmState.pruneLeaves) {
        const pruned = CORE.pruneNonAnchorLeaves(workVerts, workEdges, anchors);
        if (pruned.edges.length > 0) {
            workHostMap = pruned.vertices.map(pv => {
                let bestH = 0, bestD = Infinity;
                for (let h = 0; h < host.vertices.length; h++) {
                    const hv = host.vertices[h];
                    const d = Math.hypot(pv[0] - hv[0], pv[1] - hv[1], pv[2] - hv[2]);
                    if (d < bestD) { bestD = d; bestH = h; }
                }
                return [bestH];
            });
            workVerts = pruned.vertices;
            workEdges = pruned.edges;
            anchors = pruned.anchors;
        }
    }

    const fdmOpts = {
        mode: appState.fdmState.mode,
        anchors,
        maxAnchors: Math.max(appState.fdmState.maxAnchors, anchors.length),
        qBase: appState.fdmState.qBase,
        qProfile: appState.fdmState.qProfile,
        columnBoost: appState.fdmState.columnBoost !== undefined ? appState.fdmState.columnBoost : 4.0,
        outerRadiusM: appState.tubeState.radius,
        innerRadiusM: appState.tubeState.innerRadiusM || 0.0,
        loadZ: appState.fdmState.loadZ,
        fitEnvelope: false,
        snapAnchorsToGround: false,
        maxPlanX: appState.fdmState.envX,
        maxPlanY: appState.fdmState.envY,
        targetHeightZ: appState.fdmState.envZ
    };

    let fdm = CORE.solveFDM(workVerts, workEdges, fdmOpts);
    let finalHostMap = workHostMap;

    const minMemberLen = Math.min(0.02, appState.VOXEL_SIZE * 0.06);
    const weldTol = Math.min(0.01, appState.VOXEL_SIZE * 0.03);
    const preWeldVerts = fdm.vertices.map(p => [p[0], p[1], p[2]]);
    const cleaned = CORE.cleanAndWeldGraph(fdm.vertices, fdm.edges, fdm.anchors, {
        weldTol,
        minMemberLengthM: minMemberLen,
        tSplitTol: weldTol,
        minIncidentAngleDeg: 5.0
    });
    if (cleaned && cleaned.edges && cleaned.edges.length > 0) {
        const nextMap = Array.from({ length: cleaned.vertices.length }, () => []);
        for (let u = 0; u < preWeldVerts.length; u++) {
            const pu = preWeldVerts[u];
            let bestW = 0, bestD = Infinity;
            for (let w = 0; w < cleaned.vertices.length; w++) {
                const pw = cleaned.vertices[w];
                const d = Math.hypot(pu[0] - pw[0], pu[1] - pw[1], pu[2] - pw[2]);
                if (d < bestD) { bestD = d; bestW = w; }
            }
            for (const hi of (workHostMap[u] || [])) {
                if (!nextMap[bestW].includes(hi)) nextMap[bestW].push(hi);
            }
        }
        fdm = CORE.solveFDM(cleaned.vertices, cleaned.edges, Object.assign({}, fdmOpts, { anchors: cleaned.anchors }));
        finalHostMap = nextMap;
    }

    fdm.hostNodeMap = finalHostMap;
    appState.lastFDMResult = fdm;
    if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
    renderFDMNetwork(appState.lastFDMResult);

    const bb = appState.lastFDMResult.boundingBox;
    const badge = $('fdm-status-badge');
    if (badge) { badge.textContent = `${appState.lastFDMResult.mode} · welded ✓`; badge.className = 'text-[9.5px] font-mono text-emerald-400'; }
    setTxt('fdm-readout', `Res: ${appState.lastFDMResult.equilibriumResidual.toExponential(2)} · Anch: ${appState.lastFDMResult.anchors.length} · ${(bb.max[0] - bb.min[0]).toFixed(3)}×${(bb.max[1] - bb.min[1]).toFixed(3)}×${(bb.max[2] - bb.min[2]).toFixed(3)}m (${appState.lastFDMResult.vertices.length}V/${appState.lastFDMResult.edges.length}E)`);

    if (!opts.skipAutoSolidify && appState.lastSolidData && actions.solidifyActiveGraph) {
        actions.solidifyActiveGraph({ keepCamera: true });
    } else {
        applyOutlinerVisibility();
        recomputeModelBox();
    }
    return appState.lastFDMResult;
}

export function resetFDMView() {
    setFdmHostTriggerUI(false);
    appState.lastFDMResult = null;
    appState.lastSolidData = null;
    appState.lastFEAResult = null;
    appState.faceLoopState.loops = [];
    clearGroup(viewport.tubeGroup);
    clearGroup(viewport.unroll3DGroup);
    clearGroup(viewport.feaGroup);
    appState.fdmFixedCustomized = false;
    refreshHostGraph({ preserveFixed: false });
    renderHostNetworkInFdmGroup();
    if (actions.drawUnrolledLoopCanvas) actions.drawUnrolledLoopCanvas();
}

export function ensureFdmTabReady(opts = {}) {
    const activeG = actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : null;
    if (!activeG || !activeG.edges || activeG.edges.length === 0) {
        applyTilePresetUI('pilot_champion', { keepCamera: opts.keepCamera !== false });
        return;
    }
    if (!appState.lastHostGraph) refreshHostGraph({ preserveFixed: true });
    if (appState.fdmState.triggerOnHost) {
        if (!appState.lastFDMResult) runFDMOnActiveGraph({ keepCamera: opts.keepCamera !== false });
        else renderFDMNetwork(appState.lastFDMResult);
    } else {
        renderHostNetworkInFdmGroup();
    }
}

let pendingLiveFdmPqMask = 0;
let pendingLiveFdmPqRaf = 0;
export function scheduleLiveFdmPqUpdate({ fdm = false, solidify = false } = {}) {
    if (fdm) pendingLiveFdmPqMask |= 1;
    if (solidify) pendingLiveFdmPqMask |= 2;
    if (pendingLiveFdmPqRaf) return;
    pendingLiveFdmPqRaf = requestAnimationFrame(() => {
        const mask = pendingLiveFdmPqMask;
        pendingLiveFdmPqMask = 0;
        pendingLiveFdmPqRaf = 0;
        const doFdm = ((mask & 1) !== 0) && !!appState.fdmState.triggerOnHost;
        const doHostRefresh = ((mask & 1) !== 0) && !appState.fdmState.triggerOnHost;
        const doSolidify = ((mask & 2) !== 0) || (doFdm && !!appState.lastSolidData);
        if (doHostRefresh) {
            if (!appState.fdmFixedCustomized) refreshHostGraph({ preserveFixed: false });
            if (appState.activeTabId === 'tab-fdm') renderHostNetworkInFdmGroup();
        }
        if (doFdm) runFDMOnActiveGraph({ skipAutoSolidify: true, keepCamera: true, enableTrigger: false });
        if (doSolidify && actions.solidifyActiveGraph) actions.solidifyActiveGraph({ keepCamera: true });
    });
}

export function initTab3Fdm() {
    actions.renderFDMNetwork = renderFDMNetwork;
    actions.setFdmHostTriggerUI = setFdmHostTriggerUI;
    actions.refreshHostGraph = refreshHostGraph;
    actions.getActiveFixedAnchorArray = getActiveFixedAnchorArray;
    actions.getActiveGraphWithAnchors = getActiveGraphWithAnchors;
    actions.renderHostNetworkInFdmGroup = renderHostNetworkInFdmGroup;
    actions.toggleFdmFixedNodesByClick = toggleFdmFixedNodesByClick;
    actions.selectFdmFixedNodesByValency = selectFdmFixedNodesByValency;
    actions.applyTilePresetUI = applyTilePresetUI;
    actions.runFDMOnActiveGraph = runFDMOnActiveGraph;
    actions.resetFDMView = resetFDMView;
    actions.ensureFdmTabReady = ensureFdmTabReady;
    actions.scheduleLiveFdmPqUpdate = scheduleLiveFdmPqUpdate;

    const radOff = $('rad-fdm-host-off'), radOn = $('rad-fdm-host-on');
    if (radOff) {
        radOff.addEventListener('change', () => {
            if (!radOff.checked) return;
            appState.fdmState.triggerOnHost = false;
            appState.lastFDMResult = null;
            appState.lastSolidData = null;
            if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
            clearGroup(viewport.tubeGroup);
            clearGroup(viewport.unroll3DGroup);
            renderHostNetworkInFdmGroup();
        });
    }
    if (radOn) {
        radOn.addEventListener('change', () => {
            if (!radOn.checked) return;
            appState.fdmState.triggerOnHost = true;
            runFDMOnActiveGraph({ keepCamera: true });
        });
    }

    $$('.fdm-valency-btn').forEach(btn => {
        btn.addEventListener('click', (e) => selectFdmFixedNodesByValency(btn.dataset.fixValency, !!(e.ctrlKey || e.metaKey)));
    });
    const btnFixGround = $('btn-fix-ground-nodes');
    if (btnFixGround) {
        btnFixGround.addEventListener('click', () => {
            appState.fdmFixedCustomized = false;
            refreshHostGraph({ preserveFixed: false });
            handleFdmFixedNodesUpdated();
        });
    }
    const btnClearFixed = $('btn-clear-fixed-nodes');
    if (btnClearFixed) {
        btnClearFixed.addEventListener('click', () => {
            appState.fdmFixedNodeSet.clear();
            appState.fdmFixedCustomized = true;
            handleFdmFixedNodesUpdated();
        });
    }

    $$('.tile-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = btn.dataset.tilePreset;
            applyTilePresetUI(p, { keepCamera: p === 'active_topo' });
        });
    });
    $$('.fdm-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            appState.fdmState.mode = btn.dataset.fdmMode;
            $$('.fdm-mode-btn').forEach(b => b.classList.toggle('seg-on', b === btn));
            scheduleLiveFdmPqUpdate({ fdm: true });
        });
    });
    const selQ = $('sel-fdm-qprofile');
    if (selQ) selQ.addEventListener('change', () => { appState.fdmState.qProfile = selQ.value; scheduleLiveFdmPqUpdate({ fdm: true }); });

    bindSlider('rng-fdm-q', 'val-fdm-q', '', v => { appState.fdmState.qBase = v; scheduleLiveFdmPqUpdate({ fdm: true }); });
    bindSlider('rng-fdm-load', 'val-fdm-load', '', v => { appState.fdmState.loadZ = v; scheduleLiveFdmPqUpdate({ fdm: true }); });
    bindSlider('rng-fdm-anchors', 'val-fdm-anchors', '', v => { appState.fdmState.maxAnchors = Math.round(v); scheduleLiveFdmPqUpdate({ fdm: true }); });

    const chkPrune = $('chk-fdm-prune');
    if (chkPrune) chkPrune.addEventListener('change', () => { appState.fdmState.pruneLeaves = chkPrune.checked; scheduleLiveFdmPqUpdate({ fdm: true }); });

    const btnRunFdm = $('btn-run-fdm');
    if (btnRunFdm) btnRunFdm.addEventListener('click', () => runFDMOnActiveGraph({ keepCamera: true }));
    const btnResetFdm = $('btn-reset-fdm');
    if (btnResetFdm) btnResetFdm.addEventListener('click', () => resetFDMView());
}

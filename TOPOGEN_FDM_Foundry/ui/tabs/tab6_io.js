/**
 * WFC-FDM Foundry — Tab 6: Foundry & Multi-Layer Rhino .3dm Exports + CAD I/O (ui/tabs/tab6_io.js)
 *
 * Student Quick-Map:
 *   - Edit Tab 6 export panel & layer legend              -> mountTab6Io()
 *   - Edit neutral Foundry JSON / Quad OBJ / Unroll SVG   -> buildFoundryTopologyJSONPayloadFromUI(), export*FromUI()
 *   - Edit 5-layer Rhino `.3dm` scene exporter            -> buildExportDoc()
 *   - Edit Welded Graph `.3dm` + `.json` exporters        -> buildWeldedGraph3dmDoc(), buildWeldedGraphJSON()
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    downloadBlob,
    getUnitScale,
    $
} from '../state/workbench_state.js';
import {
    viewport,
    sharedMaterials,
    clearGroup,
    renderCurves,
    refreshPoolUI,
    recomputeModelBox,
    zoomToBox,
    modelBoxToWorld,
    makeRhinoCurveFromPoints,
    syncGizmo
} from '../display/viewport_scene.js';
import { applyOutlinerVisibility, refreshOutliner } from '../display/display_hud.js';
import { computeUnrolledSheetGridLayout, buildUnrolledPatternsDataForUI } from './tab4_pq_mesh.js';
import {
    getChain,
    getLoadedChain,
    getActiveStageIndex,
    getLoadedSourceLabel,
    setPlaybackCameraMode,
    getPlaybackCameraMode,
    clearChain,
    exportChainDownload,
    saveChainToRepo,
    listRepoChains,
    loadChain,
    loadChainFromRepoPath,
    playChain,
    jumpToStage,
    stepNextChain,
    onChainChange
} from '../state/procedural_recorder.js';
import { getDefaultBookmarks } from '../display/camera_bookmarks.js';

export function mountTab6Io() {
    const pane = $('tab-io');
    if (!pane) return;
    pane.innerHTML = `
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2.5 space-y-2">
            <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-pink-400">Foundry &amp; CAD Exports</label>
            <div class="grid grid-cols-2 gap-1.5">
                <button id="btn-export" class="cad-btn primary py-1.5 text-[9.5px]" title="Export all active pipeline layers in one multi-layer Rhino .3dm file">Export All (.3dm)</button>
                <button id="btn-export-parts" class="cad-btn py-1.5 text-[9.5px]" title="Export individual files: Quad .obj, Foundry .json, Unroll .svg, Welded Graph .3dm &amp; .json">Export Parts (Files)</button>
            </div>
        </div>

        <!-- Procedural Chain & Stage Documentation (BATCH-TOPOGEN-06) -->
        <div class="chain-panel space-y-2 mt-2">
            <div class="chain-header">
                <span class="chain-title">Procedural Chain &amp; Stage Documentation</span>
                <span id="chain-step-count-badge" class="chain-badge">0 steps</span>
            </div>

            <div class="chain-controls-3">
                <button id="btn-chain-clear" class="cad-btn text-[9px] py-1" title="Clear recorded procedural chain">✕ Clear</button>
                <button id="btn-chain-export" class="cad-btn text-[9px] py-1" title="Download current procedural chain as .chain.json">↓ Export .chain.json</button>
                <button id="btn-chain-save-repo" class="cad-btn cyan text-[9px] py-1" title="Save current procedural chain into repository chains/">⇪ Save to Repo</button>
            </div>

            <div class="space-y-1.5 pt-1 border-t border-gray-200">
                <div class="chain-row">
                    <label class="text-[9px] font-semibold uppercase tracking-wider text-gray-500">Load Chain (.chain.json)</label>
                    <span id="chain-loaded-file-badge" class="text-[8.5px] font-mono text-cyan-600 truncate max-w-[165px]" title="Active loaded chain file">Live Session</span>
                </div>
                <input type="file" id="chain-file-input" accept=".json,.chain.json" class="block w-full text-[10px] text-gray-500 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-[9.5px] file:font-semibold file:bg-pink-600/85 file:text-white hover:file:bg-pink-500 cursor-pointer" />

                <div class="chain-row gap-1.5">
                    <select id="sel-chain-corpus" class="chain-select flex-1" title="Quick-load a stored corpus or saved chain from the repository">
                        <option value="">Corpus / Repo Chains…</option>
                    </select>
                    <button id="btn-chain-load-corpus" class="cad-btn text-[9px] py-1 px-2" title="Load selected repository chain">Load</button>
                    <button id="btn-chain-refresh-corpus" class="cad-btn text-[9px] py-1 px-1.5" title="Refresh chain list from GET /api/chains">↻</button>
                </div>
            </div>

            <div class="space-y-1.5 pt-1 border-t border-gray-200">
                <div class="chain-controls">
                    <select id="sel-chain-capture-res" class="chain-select" title="Hi-Fi PNG capture resolution">
                        <option value="1920x1080" selected>1920×1080 (FHD)</option>
                        <option value="2560x1440">2560×1440 (QHD)</option>
                    </select>
                    <select id="sel-chain-capture-views" class="chain-select" title="Camera view mode for Playback &amp; Capture (Active View overrides stored bookmarks)">
                        <option value="active">Active View</option>
                        <option value="stage" selected>Stage Bookmark</option>
                        <option value="defaults">All Default Views</option>
                    </select>
                </div>

                <label class="flex items-center space-x-1.5 text-[9px] text-gray-500 cursor-pointer select-none" title="Composite the relevant tab's live UI parameters &amp; metrics onto each captured PNG">
                    <input type="checkbox" id="chain-capture-include-ui" class="accent-cyan-500 rounded">
                    <span>Capture Stage UI (Overlay + Manifest)</span>
                </label>

                <div class="chain-controls">
                    <button id="btn-chain-play-all" class="cad-btn primary text-[9.5px] py-1" title="Deterministically replay all steps in the active chain">▶ Play All</button>
                    <button id="btn-chain-step-next" class="cad-btn text-[9.5px] py-1" title="Execute the next step in the active chain">⏭ Step Next</button>
                </div>

                <button id="btn-chain-play-capture" class="cad-btn cyan w-full py-1.5 text-[9.5px] font-semibold" title="Replay every stage and capture high-fidelity PNG screenshots + manifest">📷 Play &amp; Capture All Stages (Hi-Fi PNG)</button>

                <div class="chain-progress">
                    <div id="chain-progress-bar" class="chain-progress-bar" style="width: 0%;"></div>
                </div>
                <div id="chain-status-text" class="chain-status">Ready · record live edits or load a corpus chain.</div>
            </div>

            <div id="chain-capture-gallery" class="chain-gallery"></div>
        </div>
    `;
}

// --- User-Imported Scene Meshes & CAD Helpers ---
export function clearUserImportedMeshes() {
    clearGroup(viewport.userMeshGroup);
    appState.userImportedMeshes = [];
    appState.meshPool = appState.meshPool.filter(m => !m.isUserImported);
}

export function addSceneMesh(positions, indices, name = null, quads = null) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, appState.arcticOn ? sharedMaterials.arctic : sharedMaterials.userImportedMesh);
    viewport.userMeshGroup.add(mesh);
    const entry = {
        name: name || `Mesh ${appState.meshPool.length + 1}`,
        mesh,
        positions: new Float32Array(positions),
        indices: new Uint32Array(indices),
        quads: quads || [],
        visible: true,
        isUserImported: true
    };
    appState.userImportedMeshes.push(entry);
    appState.meshPool.push(entry);
    applyOutlinerVisibility();
    recomputeModelBox();
    refreshPoolUI();
    refreshOutliner();
    return appState.meshPool.length - 1;
}

function appendUserMeshEntry(name, verts, faces) {
    const positions = [], indices = [], quads = [], wirePos = [];
    for (const v of verts) positions.push(v[0], v[1], v[2]);
    for (const f of faces) {
        if (f.length === 3) indices.push(f[0], f[1], f[2]);
        else if (f.length === 4) { indices.push(f[0], f[1], f[2], f[0], f[2], f[3]); quads.push([f[0], f[1], f[2], f[3]]); }
        else if (f.length > 4) { for (let k = 1; k < f.length - 1; k++) indices.push(f[0], f[k], f[k + 1]); }
        for (let k = 0; k < f.length; k++) {
            const a = verts[f[k]], b = verts[f[(k + 1) % f.length]];
            if (a && b) wirePos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
        }
    }
    if (positions.length === 0 || indices.length === 0) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, appState.arcticOn ? sharedMaterials.arctic : sharedMaterials.userImportedMesh);
    if (wirePos.length > 0) {
        const wGeo = new THREE.BufferGeometry();
        wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePos), 3));
        mesh.add(new THREE.LineSegments(wGeo, sharedMaterials.quadWire));
    }
    viewport.userMeshGroup.add(mesh);
    const entry = { name, mesh, positions: new Float32Array(positions), indices: new Uint32Array(indices), quads, visible: true, isUserImported: true };
    appState.userImportedMeshes.push(entry);
    appState.meshPool.push(entry);
    return entry;
}

export function importOBJToSceneIO(text, fileName = 'Imported.obj') {
    clearUserImportedMeshes();
    const parsed = actions.parseOBJMeshes ? actions.parseOBJMeshes(text, fileName.replace(/\.obj$/i, '')) : [];
    let meshCount = 0;
    for (const mod of parsed) if (appendUserMeshEntry(mod.name, mod.verts, mod.faces)) meshCount++;

    const objVerts = [];
    let lineCurvesAdded = 0;
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        if (parts[0] === 'v' && parts.length >= 4) {
            objVerts.push(new THREE.Vector3(parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])));
        } else if (parts[0] === 'l' && parts.length >= 3) {
            const pts = [];
            for (let j = 1; j < parts.length; j++) {
                const rIdx = parseInt(parts[j], 10);
                const idx = rIdx < 0 ? objVerts.length + rIdx : rIdx - 1;
                if (objVerts[idx]) pts.push(objVerts[idx].clone());
            }
            if (pts.length >= 2) {
                appState.curvePool.push({
                    name: `${fileName.replace(/\.obj$/i, '')}_Line_${++lineCurvesAdded}`,
                    geom: appState.rhino ? makeRhinoCurveFromPoints(pts) : null,
                    displayPts: pts,
                    source: 'import',
                    visible: true
                });
            }
        }
    }
    appState.groupVis.meshes = true;
    appState.groupVis.curves = true;
    renderCurves();
    applyOutlinerVisibility();
    recomputeModelBox();
    refreshPoolUI();
    refreshOutliner();
    const total = meshCount + lineCurvesAdded;
    if (total > 0 && !appState.modelBox.isEmpty()) zoomToBox(modelBoxToWorld(appState.modelBox));
    return total;
}

export function loadBuffer(arrayBuffer) {
    const rhino = appState.rhino;
    if (!rhino) return [];
    if (appState.currentDoc) appState.currentDoc.delete();
    appState.currentDoc = rhino.File3dm.fromByteArray(new Uint8Array(arrayBuffer));
    if (!appState.currentDoc) return [];
    try { appState.unitScale = getUnitScale(appState.currentDoc.settings().modelUnitSystem); } catch (e) { appState.unitScale = 1.0; }
    const names = [];
    for (let i = 0; i < appState.currentDoc.layers().count; i++) names.push(appState.currentDoc.layers().get(i).name);
    refreshPoolUI();
    return names;
}

export function importCurves() {
    const { currentDoc, rhino, unitScale } = appState;
    if (!currentDoc || !rhino) return 0;
    appState.curvePool = [];
    clearUserImportedMeshes();
    const layerList = $('layer-list');
    const selectedLayers = layerList ? Array.from(layerList.querySelectorAll('input:checked')).map(cb => parseInt(cb.value, 10)) : [];
    const objects = currentDoc.objects();
    let meshCount = 0;

    for (let i = 0; i < objects.count; i++) {
        const obj = objects.get(i);
        const attr = obj.attributes();
        if (selectedLayers.length > 0 && !selectedLayers.includes(attr.layerIndex)) continue;
        const geom = obj.geometry();
        if (!geom) continue;
        if (geom.objectType === rhino.ObjectType.Curve) {
            const nurbs = geom.toNurbsCurve();
            if (!nurbs) continue;
            const dom = nurbs.domain;
            const steps = Math.min(240, Math.max(60, nurbs.points().count * 4));
            const pts = [];
            for (let j = 0; j <= steps; j++) {
                const p = nurbs.pointAt(dom[0] + (dom[1] - dom[0]) * (j / steps));
                pts.push(new THREE.Vector3(p[0] * unitScale, p[1] * unitScale, p[2] * unitScale));
            }
            nurbs.delete();
            if (pts.length > 1) appState.curvePool.push({ name: attr.name || `Curve ${appState.curvePool.length + 1}`, geom, displayPts: pts, source: 'import', visible: true });
        } else if (geom.objectType === rhino.ObjectType.Mesh) {
            const rVerts = geom.vertices(), rFaces = geom.faces();
            const verts = [], faces = [];
            for (let v = 0; v < rVerts.count; v++) { const pt = rVerts.get(v); verts.push([pt[0] * unitScale, pt[1] * unitScale, pt[2] * unitScale]); }
            for (let f = 0; f < rFaces.count; f++) { const fc = rFaces.get(f); faces.push(fc[2] === fc[3] ? [fc[0], fc[1], fc[2]] : [fc[0], fc[1], fc[2], fc[3]]); }
            if (appendUserMeshEntry(attr.name || `RhinoMesh_${meshCount + 1}`, verts, faces)) meshCount++;
        }
    }
    appState.selectedIdx = -1;
    appState.groupVis.curves = true;
    appState.groupVis.meshes = true;
    renderCurves();
    applyOutlinerVisibility();
    recomputeModelBox();
    refreshPoolUI();
    refreshOutliner();
    syncGizmo();
    const total = appState.curvePool.length + meshCount;
    if (total > 0 && !appState.modelBox.isEmpty()) zoomToBox(modelBoxToWorld(appState.modelBox));
    return total;
}

// --- Foundry Neutral JSON / Quad OBJ / Unroll SVG Exports ---
export function exportQuadOBJFromUI() {
    if ((!appState.lastSolidData || appState.lastSolidData.vertices.length === 0) && actions.solidifyActiveGraph) actions.solidifyActiveGraph();
    if (!appState.lastSolidData || appState.lastSolidData.vertices.length === 0) return false;
    const objText = CORE.buildQuadDominantOBJ(appState.lastSolidData, { name: `TopoGen_FDM_${appState.currentTilePreset}` });
    downloadBlob(new Blob([objText], { type: 'text/plain' }), `TopoGen_FDM_${appState.currentTilePreset}_${Date.now()}.mesh.obj`);
    return true;
}

export function exportUnrolledSVGFromUI() {
    const activeG = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if ((!appState.lastSolidData || appState.lastSolidData.vertices.length === 0) && actions.solidifyActiveGraph) actions.solidifyActiveGraph();
    if (!activeG || !appState.lastSolidData) return false;
    const stamp = Date.now();
    const baseName = `TopoGen_FDM_${appState.currentTilePreset}_${stamp}`;
    const { unrolledJson, patternsSvg } = CORE.buildUnrolledPatterns(activeG, appState.lastSolidData, {
        name: baseName,
        outerRadiusM: appState.tubeState.radius,
        nSides: appState.tubeState.nSides,
        longitudinalSubdivLevels: appState.tubeState.longitudinalSubdivLevels
    });
    downloadBlob(new Blob([patternsSvg], { type: 'image/svg+xml' }), `${baseName}.patterns.svg`);
    setTimeout(() => {
        downloadBlob(new Blob([JSON.stringify(unrolledJson, null, 2)], { type: 'application/json' }), `${baseName}.unrolled.json`);
    }, 120);
    return true;
}

export function buildFoundryTopologyJSONPayloadFromUI(stamp = Date.now()) {
    const activeG = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if ((!appState.lastSolidData || appState.lastSolidData.vertices.length === 0) && actions.solidifyActiveGraph) actions.solidifyActiveGraph();
    if (!activeG || !appState.lastSolidData) return null;

    const { tubeState, currentTilePreset, GRID_X, GRID_Y, GRID_Z, currentAlgorithm, fdmState, lastSolidData } = appState;
    const baseName = `TopoGen_FDM_${currentTilePreset}_${stamp}`;
    const { unrolledJson } = CORE.buildUnrolledPatterns(activeG, lastSolidData, {
        name: baseName,
        outerRadiusM: tubeState.radius,
        nSides: tubeState.nSides,
        longitudinalSubdivLevels: tubeState.longitudinalSubdivLevels
    });

    const round8 = v => Math.round((Number(v) || 0) * 1e8) / 1e8;
    const planarity = lastSolidData.planarity || CORE.computeMeshPlanarityStats(lastSolidData.vertices, lastSolidData.quads);
    const extraBlocks = {
        geometry: {
            tubeTopology: true,
            longitudinalSubdivLevels: tubeState.longitudinalSubdivLevels,
            pqOptimizationApplied: !!tubeState.pqOptimization,
            maxQuadPlanarityErrorM: round8(planarity ? planarity.maxQuadPlanarityErrorM : 0),
            meanQuadPlanarityErrorM: round8(planarity ? planarity.meanQuadPlanarityErrorM : 0),
            barTubeQuadCount: lastSolidData.barTubeQuadCount !== undefined ? lastSolidData.barTubeQuadCount : lastSolidData.quads.length
        },
        fabrication: {
            unrolledPatternsFile: `${baseName}.patterns.svg`,
            unrolledDataFile: `${baseName}.unrolled.json`,
            barCount: activeG.edges.length,
            unrolledBarCount: unrolledJson ? unrolledJson.bars.length : activeG.edges.length,
            totalUnrolledSurfaceAreaM2: unrolledJson ? unrolledJson.totalUnrolledSurfaceAreaM2 : 0,
            hasSelfIntersection: unrolledJson ? !!unrolledJson.hasSelfIntersection : false
        }
    };

    return {
        baseName,
        payload: CORE.buildFoundryTopologyJSON(activeG, {
            outerRadiusM: tubeState.radius,
            innerRadiusM: tubeState.innerRadiusM || 0.0,
            nSides: tubeState.nSides
        }, {
            name: baseName,
            source: 'TOPOGEN_FDM_Foundry/index_TOPOGEN_PQM_ELASTICA_FDM.html',
            gridResolution: [GRID_X, GRID_Y, GRID_Z],
            tilePreset: currentTilePreset,
            algorithm: currentAlgorithm,
            qProfile: fdmState.qProfile
        }, extraBlocks)
    };
}

export function exportFoundryTopologyJSONFromUI() {
    const built = buildFoundryTopologyJSONPayloadFromUI();
    if (!built) return false;
    downloadBlob(new Blob([JSON.stringify(built.payload, null, 2)], { type: 'application/json' }), `${built.baseName}.topology.json`);
    return true;
}

// --- Multi-Layer Rhino .3dm Scene & Welded Graph Exporters ---
function addRhinoMesh(doc, attr, positions, indices, quads = null) {
    const rhino = appState.rhino;
    const rMesh = new rhino.Mesh();
    const vl = rMesh.vertices();
    for (let i = 0; i < positions.length; i += 3) {
        vl.add(positions[i] / appState.unitScale, positions[i + 1] / appState.unitScale, positions[i + 2] / appState.unitScale);
    }
    const fl = rMesh.faces();
    if (quads && quads.length > 0) {
        for (const q of quads) fl.addQuadFace(q[0], q[1], q[2], q[3]);
    } else {
        for (let i = 0; i < indices.length; i += 3) fl.addTriFace(indices[i], indices[i + 1], indices[i + 2]);
    }
    try { rMesh.normals().computeNormals(); } catch (e) { try { rMesh.computeNormals(); } catch (e2) {} }
    try { rMesh.compact(); } catch (e) {}
    doc.objects().add(rMesh, attr);
    rMesh.delete();
}

export function buildExportDoc() {
    const { rhino, TILES, VOXEL_SIZE, GRID_Y, activeMeshEntry, voxels, lastHostGraph, lastFDMResult, lastSolidData, tubeState, currentTilePreset } = appState;
    const doc = new rhino.File3dm();
    try { doc.settings().modelUnitSystem = rhino.UnitSystem.Meters; } catch (e) {}

    const mkLayer = (name, color) => {
        const idx = doc.layers().count;
        const layer = new rhino.Layer();
        layer.name = name;
        layer.color = color;
        doc.layers().add(layer);
        layer.delete();
        const attr = new rhino.ObjectAttributes();
        attr.layerIndex = idx;
        return attr;
    };
    const addQuadArrayAsRhinoMesh = (attr, name, quadArr, offset = [0, 0, 0], scale = 1.0) => {
        if (!quadArr || quadArr.length === 0) return;
        const rMesh = new rhino.Mesh();
        const vl = rMesh.vertices(), fl = rMesh.faces();
        for (let qi = 0; qi < quadArr.length; qi++) {
            const q = quadArr[qi], base = qi * 4;
            for (let k = 0; k < 4; k++) vl.add(offset[0] + q[k][0] * scale, offset[1] + q[k][1] * scale, offset[2] + q[k][2] * scale);
            if (q[2][0] === q[3][0] && q[2][1] === q[3][1] && q[2][2] === q[3][2]) fl.addTriFace(base, base + 1, base + 2);
            else fl.addQuadFace(base, base + 1, base + 2, base + 3);
        }
        try { rMesh.normals().computeNormals(); } catch (e) { try { rMesh.computeNormals(); } catch (e2) {} }
        try { rMesh.compact(); } catch (e) {}
        attr.name = name;
        doc.objects().add(rMesh, attr);
        rMesh.delete();
    };
    const addGraphLinesAndNodes = (attr, prefix, verts, edges, anchorIndices = null, offset = [0, 0, 0], scale = 1.0) => {
        if (!verts || !edges || edges.length === 0) return;
        for (let i = 0; i < edges.length; i++) {
            const [u, v] = edges[i];
            const p0 = verts[u], p1 = verts[v];
            if (!p0 || !p1) continue;
            attr.name = `${prefix}_E_${i}`;
            const rLine = new rhino.LineCurve([offset[0] + p0[0] * scale, offset[1] + p0[1] * scale, offset[2] + p0[2] * scale], [offset[0] + p1[0] * scale, offset[1] + p1[1] * scale, offset[2] + p1[2] * scale]);
            doc.objects().add(rLine, attr);
            rLine.delete();
        }
        const ancSet = new Set(anchorIndices || []);
        for (let i = 0; i < verts.length; i++) {
            const p = verts[i];
            if (!p) continue;
            attr.name = ancSet.has(i) ? `${prefix}_Anchor_${i}` : `${prefix}_V_${i}`;
            const rPt = new rhino.Point([offset[0] + p[0] * scale, offset[1] + p[1] * scale, offset[2] + p[2] * scale]);
            doc.objects().add(rPt, attr);
            rPt.delete();
        }
    };

    const attrTiles = mkLayer('01_Tiles', { r: 236, g: 72, b: 153, a: 255 });
    const enabledTiles = TILES.filter((t, idx) => idx > 0 && t.enabled);
    const tileSpacing = Math.max(1.25, VOXEL_SIZE * 1.35);
    const tileRowY = -Math.max(2.0, (GRID_Y * VOXEL_SIZE) * 0.5 + VOXEL_SIZE * 1.5);
    enabledTiles.forEach((t, idx) => {
        const tx = (idx - (enabledTiles.length - 1) * 0.5) * tileSpacing, tz = VOXEL_SIZE * 0.5;
        const faceQuads = (t.quads && t.quads.length > 0) ? t.quads : (t.previewQuads || []);
        if (faceQuads.length > 0) addQuadArrayAsRhinoMesh(attrTiles, `Tile_${t.short}_Mesh`, faceQuads, [tx, tileRowY, tz], VOXEL_SIZE);
        if (t.graph && t.graph.edges && t.graph.edges.length > 0) addGraphLinesAndNodes(attrTiles, `Tile_${t.short}`, t.graph.vertices, t.graph.edges, null, [tx, tileRowY, tz], VOXEL_SIZE);
    });
    attrTiles.delete();

    const attrTopoTiles = mkLayer('02_Generated_Topology_Tiles', { r: 245, g: 158, b: 11, a: 255 });
    if (activeMeshEntry && activeMeshEntry.positions && activeMeshEntry.indices) {
        attrTopoTiles.name = activeMeshEntry.name || 'Generated_Topology_Tiles';
        addRhinoMesh(doc, attrTopoTiles, activeMeshEntry.positions, activeMeshEntry.indices, activeMeshEntry.quads);
    } else {
        for (const v of voxels) {
            if (!v.collapsed || v.tile === null || v.tile === CORE.TILE_NULL) continue;
            const tDef = TILES[v.tile];
            if (!tDef) continue;
            const qList = (tDef.quads && tDef.quads.length > 0) ? tDef.quads : (tDef.previewQuads || []);
            if (qList.length > 0 && actions.voxelCenter) {
                const c = actions.voxelCenter(v.x, v.y, v.z);
                addQuadArrayAsRhinoMesh(attrTopoTiles, `Vox_${v.x}_${v.y}_${v.z}_${tDef.short}`, qList, [c.x, c.y, c.z], VOXEL_SIZE);
            }
        }
    }
    attrTopoTiles.delete();

    const attrTopoNet = mkLayer('02_Generated_Topology_Network', { r: 239, g: 68, b: 68, a: 255 });
    const preFdmGraph = (lastHostGraph && lastHostGraph.edges && lastHostGraph.edges.length > 0)
        ? lastHostGraph : (actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : null);
    if (preFdmGraph && preFdmGraph.edges && preFdmGraph.edges.length > 0) {
        const preAnchors = actions.getActiveFixedAnchorArray ? actions.getActiveFixedAnchorArray(preFdmGraph) : [];
        addGraphLinesAndNodes(attrTopoNet, 'TopoNet', preFdmGraph.vertices, preFdmGraph.edges, preAnchors);
    }
    attrTopoNet.delete();

    const attrPostFdm = mkLayer('03_Post_FDM_Topology', { r: 6, g: 182, b: 212, a: 255 });
    const postFdmGraph = (lastFDMResult && lastFDMResult.edges && lastFDMResult.edges.length > 0)
        ? lastFDMResult : (actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null);
    if (postFdmGraph && postFdmGraph.edges && postFdmGraph.edges.length > 0) {
        addGraphLinesAndNodes(attrPostFdm, 'PostFDM', postFdmGraph.vertices, postFdmGraph.edges, postFdmGraph.anchors);
    }
    attrPostFdm.delete();

    const attrPqMesh = mkLayer('04_PQ_Mesh', { r: 16, g: 185, b: 129, a: 255 });
    const solidForExport = (lastSolidData && lastSolidData.vertices && lastSolidData.vertices.length > 0)
        ? lastSolidData : (actions.solidifyActiveGraph ? actions.solidifyActiveGraph({ keepCamera: true }) : null);
    if (solidForExport && solidForExport.vertices && solidForExport.vertices.length > 0) {
        const rMesh = new rhino.Mesh();
        const vl = rMesh.vertices(), fl = rMesh.faces();
        for (const v of solidForExport.vertices) vl.add(v.x, v.y, v.z);
        for (const q of (solidForExport.quads || [])) fl.addQuadFace(q[0], q[1], q[2], q[3]);
        for (const t of (solidForExport.triangles || [])) fl.addTriFace(t[0], t[1], t[2]);
        try { rMesh.normals().computeNormals(); } catch (e) { try { rMesh.computeNormals(); } catch (e2) {} }
        try { rMesh.compact(); } catch (e) {}
        attrPqMesh.name = `PQ_Tubular_Mesh_${solidForExport.quads.length}Q`;
        doc.objects().add(rMesh, attrPqMesh);
        rMesh.delete();
    }
    attrPqMesh.delete();

    const attrUnrolls = mkLayer('05_Unrolls_Laser_Sheets', { r: 168, g: 85, b: 247, a: 255 });
    if (solidForExport) {
        const unrollPack = buildUnrolledPatternsDataForUI(solidForExport, postFdmGraph);
        const unrolledJson = unrollPack ? unrollPack.unrolledJson : null;
        if (unrolledJson && Array.isArray(unrolledJson.bars) && unrolledJson.bars.length > 0) {
            let tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity;
            for (const v of solidForExport.vertices) {
                if (v.x > tMaxX) tMaxX = v.x;
                if (v.y < tMinY) tMinY = v.y;
                if (v.y > tMaxY) tMaxY = v.y;
            }
            if (!Number.isFinite(tMaxX)) { tMaxX = 0.5; tMinY = -0.5; tMaxY = 0.5; }
            const startX = tMaxX + 0.45;
            const sheets = (unrolledJson.sheets && unrolledJson.sheets.length > 0)
                ? unrolledJson.sheets : [{ sheetIndex: 0, widthM: 0.60, heightM: 0.90, bbox2D: [0, 0, 0.60, 0.90] }];
            const { sheetTransforms } = computeUnrolledSheetGridLayout(sheets, startX, tMinY, tMaxY);
            const zPlane = 0.002;

            for (const bar of unrolledJson.bars) {
                const qs = bar.quads2D || [];
                if (qs.length === 0) continue;
                const st = sheetTransforms[bar.sheetIndex || 0] || sheetTransforms[0];
                const rMesh = new rhino.Mesh();
                const vl = rMesh.vertices(), fl = rMesh.faces();
                for (let qi = 0; qi < qs.length; qi++) {
                    const q = qs[qi], base = qi * 4;
                    for (let k = 0; k < 4; k++) vl.add(q[k][0] + st.dx, q[k][1] + st.dy, zPlane);
                    fl.addQuadFace(base, base + 1, base + 2, base + 3);
                }
                try { rMesh.normals().computeNormals(); } catch (e) {}
                try { rMesh.compact(); } catch (e) {}
                attrUnrolls.name = `Unroll_Strip_${bar.edgeIndex}_Sheet_${(bar.sheetIndex || 0) + 1}`;
                doc.objects().add(rMesh, attrUnrolls);
                rMesh.delete();
            }
            for (const st of sheetTransforms) {
                const { minX: x0, maxX: x1, minY: y0, maxY: y1 } = st;
                const corners = [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]];
                for (let c = 0; c < 4; c++) {
                    attrUnrolls.name = `Laser_Sheet_${st.sheetIndex + 1}_Border`;
                    const rLine = new rhino.LineCurve(corners[c], corners[(c + 1) % 4]);
                    doc.objects().add(rLine, attrUnrolls);
                    rLine.delete();
                }
            }
        }
    }
    attrUnrolls.delete();
    return doc;
}

export function buildExportBytes() {
    const doc = buildExportDoc();
    const bytes = doc.toByteArray();
    doc.delete();
    return bytes;
}

export function buildWeldedGraph3dmDoc(graph = null) {
    const rhino = appState.rhino;
    const g = graph || (actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : { vertices: [], edges: [] });
    const doc = new rhino.File3dm();
    try { doc.settings().modelUnitSystem = rhino.UnitSystem.Meters; } catch (e) {}

    const mkLayer = (name, color) => {
        const idx = doc.layers().count;
        const layer = new rhino.Layer();
        layer.name = name;
        layer.color = color;
        doc.layers().add(layer);
        layer.delete();
        const attr = new rhino.ObjectAttributes();
        attr.layerIndex = idx;
        return attr;
    };
    const attrEdges = mkLayer('Graph_Centerlines', { r: 239, g: 68, b: 68, a: 255 });
    for (let i = 0; i < g.edges.length; i++) {
        const [u, v] = g.edges[i];
        const p0 = g.vertices[u], p1 = g.vertices[v];
        attrEdges.name = `E_${i}`;
        const rLine = new rhino.LineCurve([p0[0], p0[1], p0[2]], [p1[0], p1[1], p1[2]]);
        doc.objects().add(rLine, attrEdges);
        rLine.delete();
    }
    attrEdges.delete();

    const attrNodes = mkLayer('Graph_Nodes', { r: 17, g: 24, b: 39, a: 255 });
    for (let i = 0; i < g.vertices.length; i++) {
        const p = g.vertices[i];
        attrNodes.name = `V_${i}`;
        const rPt = new rhino.Point([p[0], p[1], p[2]]);
        doc.objects().add(rPt, attrNodes);
        rPt.delete();
    }
    attrNodes.delete();
    return doc;
}

export function buildWeldedGraph3dmBytes(graph = null) {
    const doc = buildWeldedGraph3dmDoc(graph);
    const bytes = doc.toByteArray();
    doc.delete();
    return bytes;
}

export function buildWeldedGraphJSON(graph = null) {
    const g = graph || (actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : { vertices: [], edges: [], valences: [], boundingBox: { min: [0, 0, 0], max: [0, 0, 0] } });
    const round6 = v => Math.round(v * 1e6) / 1e6;
    const vertices = g.vertices.map(p => [round6(p[0]), round6(p[1]), round6(p[2])]);
    const edges = g.edges.map(e => [e[0], e[1]]);
    const nodes = vertices.map((pos, id) => ({ id, position: pos, valence: g.valences[id] || 0 }));
    const { GRID_X, GRID_Y, GRID_Z, currentAlgorithm, VOXEL_SIZE } = appState;

    return {
        $schema: 'graph-to-tubular-mesh/v1',
        documentation: {
            description: 'Welded 3D undirected centerline graph exported from the Wave Function Collapse App (index_TOPOGEN_PQM_ELASTICA_FDM.html) for direct import into the Graph-to-Tubular Mesh App (index.html).',
            coordinateSystem: 'Right-handed Z-up (Rhino / Three.js model space)',
            units: 'meters',
            fields: {
                vertices: 'Array of [x, y, z] 3D coordinates in meters (0-indexed). Coincident vertices across adjacent tiles are welded within metadata.weldTolerance.',
                edges: 'Array of [u, v] undirected edge index pairs referencing 0-based indices in vertices (canonical u < v, no duplicate edges or self-loops).',
                nodes: 'Per-vertex metadata array aligned with vertices: { id, position: [x, y, z], valence }.',
                metadata: 'Provenance & topology summary including WFC algorithm, gridResolution [nx, ny, nz], voxelSize, weldTolerance, collinearMerged, raw vs welded counts, and boundingBox.'
            },
            importIntoTubularMeshApp: {
                rhino3dm: 'Load the companion .3dm file in index.html ("Load Rhino File (.3dm)") and click "Import & Solidify". All LineCurves on layer "Graph_Centerlines" are converted to graph edges and solidified.',
                jsonApi: 'window.__app.setGraphFromVerticesAndEdges(data.vertices, data.edges, data.name); window.__app.rebuild();'
            }
        },
        name: `WFC_WeldedGraph_${GRID_X}x${GRID_Y}x${GRID_Z}`,
        units: 'meters',
        coordinateSystem: 'Z-up',
        metadata: {
            source: 'index_TOPOGEN_PQM_ELASTICA_FDM.html',
            exportedAt: new Date().toISOString(),
            algorithm: currentAlgorithm,
            gridResolution: [GRID_X, GRID_Y, GRID_Z],
            voxelSize: VOXEL_SIZE,
            weldTolerance: g.weldTol,
            collinearMerged: g.collinearMerged,
            rawVertexCount: g.rawVertexCount,
            rawEdgeCount: g.rawEdgeCount,
            vertexCount: vertices.length,
            edgeCount: edges.length,
            boundingBox: { min: g.boundingBox.min.map(round6), max: g.boundingBox.max.map(round6) }
        },
        vertices,
        edges,
        nodes
    };
}

export function exportWeldedGraph3dm(stamp = Date.now()) {
    const g = actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : null;
    if (!g || g.edges.length === 0) return false;
    downloadBlob(new Blob([buildWeldedGraph3dmBytes(g)], { type: 'application/octet-stream' }), `WFC_WeldedGraph_${stamp}.3dm`);
    return true;
}

export function exportWeldedGraphJSON(stamp = Date.now()) {
    const g = actions.buildWeldedGraph ? actions.buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes }) : null;
    if (!g || g.edges.length === 0) return false;
    downloadBlob(new Blob([JSON.stringify(buildWeldedGraphJSON(g), null, 2)], { type: 'application/json' }), `WFC_WeldedGraph_${stamp}.json`);
    return true;
}

export function initTab6Io() {
    actions.clearUserImportedMeshes = clearUserImportedMeshes;

    const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bind('btn-export', () => {
        const bytes = buildExportBytes();
        downloadBlob(new Blob([bytes], { type: 'application/octet-stream' }), `WFC_QuadMesh_${Date.now()}.3dm`);
    });
    bind('btn-export-parts', () => {
        const stamp = Date.now();
        exportQuadOBJFromUI();
        setTimeout(() => exportFoundryTopologyJSONFromUI(), 100);
        setTimeout(() => exportUnrolledSVGFromUI(), 200);
        setTimeout(() => exportWeldedGraph3dm(stamp), 300);
        setTimeout(() => exportWeldedGraphJSON(stamp), 400);
    });

    // Footer quick-export strip
    bind('btn-footer-quad-obj', () => exportQuadOBJFromUI());
    bind('btn-footer-foundry-json', () => exportFoundryTopologyJSONFromUI());
    bind('btn-footer-unroll-svg', () => exportUnrolledSVGFromUI());
    bind('btn-footer-graph-3dm', () => exportWeldedGraph3dm());

    // --- Procedural Chain & Stage Documentation UI ---
    const setChainStatus = (msg) => {
        const el = $('chain-status-text');
        if (el) el.textContent = msg;
    };
    const setChainProgress = (pct) => {
        const bar = $('chain-progress-bar');
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    };
    const updateStepBadge = () => {
        const badge = $('chain-step-count-badge');
        if (badge) {
            const active = getLoadedChain();
            const n = active?.steps?.length || 0;
            badge.textContent = `${n} step${n === 1 ? '' : 's'}`;
        }
        const loadedBadge = $('chain-loaded-file-badge');
        if (loadedBadge) {
            const src = getLoadedSourceLabel();
            loadedBadge.textContent = src || 'Live Session';
            loadedBadge.title = src || 'Recording live session';
        }
    };

    const escapeHtml = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

    const renderCaptureGallery = (captures = []) => {
        const gal = $('chain-capture-gallery');
        if (!gal) return;
        if (!captures || captures.length === 0) {
            gal.innerHTML = '';
            return;
        }
        gal.innerHTML = captures.map((cap, idx) => {
            const m = cap.metrics || {};
            const vTxt = m.vertices ? `V:${m.vertices}` : '';
            const qTxt = m.quads ? `Q:${m.quads}` : '';
            const pqTxt = m.maxPlanarityMm !== null && m.maxPlanarityMm !== undefined ? `PQ:${m.maxPlanarityMm}mm` : '';
            const openHref = cap.repoRelativePath
                ? `/api/repo-file?path=${encodeURIComponent(cap.repoRelativePath)}`
                : cap.dataUrl;
            const stageTitle = `${String((cap.stepIndex ?? idx) + 1).padStart(2, '0')} · ${cap.label || cap.op || 'Stage'}`;
            const viewBadge = cap.bookmarkName ? ` (${cap.bookmarkName})` : '';
            return `
                <div class="chain-card">
                    <img class="chain-thumb" src="${cap.dataUrl}" alt="${escapeHtml(stageTitle)}" loading="lazy" />
                    <div class="chain-card-meta">
                        <div class="chain-card-title" title="${escapeHtml(stageTitle + viewBadge)}">${escapeHtml(stageTitle)}${escapeHtml(viewBadge)}</div>
                        <div class="flex flex-wrap gap-1 mt-0.5">
                            ${vTxt ? `<span class="chain-metric-pill">${vTxt}</span>` : ''}
                            ${qTxt ? `<span class="chain-metric-pill">${qTxt}</span>` : ''}
                            ${pqTxt ? `<span class="chain-metric-pill">${pqTxt}</span>` : ''}
                        </div>
                        <div class="chain-card-actions">
                            <a class="chain-card-link" href="${cap.dataUrl}" download="${escapeHtml(cap.stageFile || `stage_${idx + 1}.png`)}">Download PNG</a>
                            <a class="chain-card-link" href="${openHref}" target="_blank" rel="noopener">Open</a>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    };

    const populateCorpusDropdown = async () => {
        const sel = $('sel-chain-corpus');
        if (!sel) return;
        const chains = await listRepoChains();
        const prev = sel.value;
        sel.innerHTML = `<option value="">Corpus / Repo Chains (${chains.length})…</option>` + chains.map((c) => {
            const tag = c.source === 'corpus' ? '[Corpus]' : '[Saved]';
            const label = `${tag} ${c.name || c.fileName} (${c.stepCount || 0} steps)`;
            return `<option value="${escapeHtml(c.repoRelativePath)}">${escapeHtml(label)}</option>`;
        }).join('');
        if (prev && chains.some((c) => c.repoRelativePath === prev)) sel.value = prev;
    };

    const parseCaptureOptions = () => {
        const resVal = ($('sel-chain-capture-res')?.value || '1920x1080').split('x');
        const captureWidth = parseInt(resVal[0], 10) || 1920;
        const captureHeight = parseInt(resVal[1], 10) || 1080;
        const viewMode = $('sel-chain-capture-views')?.value || 'stage';
        const includeStageUI = Boolean($('chain-capture-include-ui')?.checked);
        let bookmarkIds = [];
        if (viewMode === 'defaults') {
            bookmarkIds = getDefaultBookmarks().map((b) => b.id);
        } else if (viewMode === 'active') {
            bookmarkIds = [];
        }
        return { captureWidth, captureHeight, viewMode, bookmarkIds, includeStageUI };
    };

    const selViews = $('sel-chain-capture-views');
    if (selViews) {
        setPlaybackCameraMode(selViews.value || 'stage');
        selViews.addEventListener('change', (e) => {
            setPlaybackCameraMode(e.target.value);
        });
    }

    onChainChange((snap) => {
        updateStepBadge();
        if (snap.event === 'clear') {
            renderCaptureGallery([]);
            setChainProgress(0);
        } else if (snap.event === 'stage' && snap.activeChain?.steps?.length) {
            const total = snap.activeChain.steps.length;
            const idx = snap.activeStageIndex ?? 0;
            setChainProgress(((idx + 1) / total) * 100);
            if (snap.step) {
                setChainStatus(`Stage ${idx + 1}/${total}: ${snap.step.label || snap.step.op}`);
            }
        }
    });
    updateStepBadge();
    populateCorpusDropdown();

    let _selectedLocalFile = null;

    const loadAndReplayLocalFile = async (file) => {
        const text = await file.text();
        const res = await loadChain(text, { fileName: file.name, sourceLabel: file.name });
        setChainProgress(0);
        renderCaptureGallery([]);
        setChainStatus(`Loaded "${res.chain.name}" (${res.stepCount} steps) · Replaying…`);
        if (res.stepCount > 0) {
            const playRes = await playChain(null, {
                captureStages: false,
                cameraMode: getPlaybackCameraMode(),
                onStage: ({ index, total, step }) => {
                    setChainProgress(((index + 1) / Math.max(1, total)) * 100);
                    setChainStatus(`Stage ${index + 1}/${total}: ${step.label || step.op}`);
                }
            });
            setChainProgress(100);
            setChainStatus(`Loaded & replayed "${res.chain.name}" (${playRes.stepsExecuted}/${res.stepCount} stages).`);
        } else {
            setChainStatus(`Loaded "${res.chain.name}" (0 steps).`);
        }
    };

    bind('btn-chain-clear', () => {
        _selectedLocalFile = null;
        const fi = $('chain-file-input');
        if (fi) fi.value = '';
        clearChain();
        setChainStatus('Cleared procedural chain.');
    });

    bind('btn-chain-export', () => {
        const res = exportChainDownload();
        setChainStatus(`Exported ${res.fileName} (${res.bytes} bytes).`);
    });

    bind('btn-chain-save-repo', async () => {
        const chain = getChain();
        if (!chain.steps.length) {
            setChainStatus('Nothing to save — perform actions or load a chain first.');
            return;
        }
        try {
            setChainStatus('Saving chain to repo…');
            const saved = await saveChainToRepo(chain, { fileName: `${chain.id || 'session'}.chain.json`, target: 'chains' });
            setChainStatus(`Saved → ${saved.repoRelativePath}`);
            populateCorpusDropdown();
        } catch (err) {
            setChainStatus(`Save failed: ${err.message}`);
        }
    });

    const chainFileInput = $('chain-file-input');
    if (chainFileInput) {
        chainFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            _selectedLocalFile = file;
            try {
                await loadAndReplayLocalFile(file);
            } catch (err) {
                setChainStatus(`Load error (${file.name}): ${err.message}`);
            }
        });
    }

    bind('btn-chain-refresh-corpus', () => populateCorpusDropdown());

    bind('btn-chain-load-corpus', async () => {
        const sel = $('sel-chain-corpus');
        const repoPath = sel ? sel.value : '';
        if (!repoPath) {
            if (_selectedLocalFile) {
                try {
                    await loadAndReplayLocalFile(_selectedLocalFile);
                } catch (err) {
                    setChainStatus(`Load error (${_selectedLocalFile.name}): ${err.message}`);
                }
                return;
            }
            setChainStatus('Select a corpus/repo chain or choose a local .chain.json file first.');
            return;
        }
        try {
            setChainStatus(`Loading ${repoPath}…`);
            const res = await loadChainFromRepoPath(repoPath);
            setChainProgress(0);
            renderCaptureGallery([]);
            if (res.stepCount > 0) {
                const playRes = await playChain(null, {
                    captureStages: false,
                    cameraMode: getPlaybackCameraMode(),
                    onStage: ({ index, total, step }) => {
                        setChainProgress(((index + 1) / Math.max(1, total)) * 100);
                        setChainStatus(`Stage ${index + 1}/${total}: ${step.label || step.op}`);
                    }
                });
                setChainProgress(100);
                setChainStatus(`Loaded & replayed "${res.chain.name}" (${playRes.stepsExecuted}/${res.stepCount} stages).`);
            } else {
                setChainStatus(`Loaded "${res.chain.name}" (${res.stepCount} steps, ${res.assetCount} assets).`);
            }
        } catch (err) {
            setChainStatus(`Load failed: ${err.message}`);
        }
    });

    bind('btn-chain-play-all', async () => {
        try {
            const { viewMode } = parseCaptureOptions();
            setPlaybackCameraMode(viewMode);
            setChainProgress(0);
            setChainStatus('Replaying procedural chain…');
            const res = await playChain(null, {
                captureStages: false,
                cameraMode: viewMode,
                onStage: ({ index, total, step }) => {
                    setChainProgress(((index + 1) / Math.max(1, total)) * 100);
                    setChainStatus(`Stage ${index + 1}/${total}: ${step.label || step.op}`);
                }
            });
            setChainProgress(100);
            setChainStatus(`Replayed ${res.stepsExecuted} stage(s) of "${res.chainName || res.chainId}".`);
        } catch (err) {
            setChainStatus(`Playback error: ${err.message}`);
        }
    });

    bind('btn-chain-step-next', async () => {
        try {
            const { viewMode } = parseCaptureOptions();
            setPlaybackCameraMode(viewMode);
            const res = await stepNextChain({ captureStages: false, cameraMode: viewMode });
            if (!res.ok) {
                setChainStatus(res.message || 'No steps to execute.');
                return;
            }
            const total = getLoadedChain()?.steps?.length || 1;
            setChainProgress((((res.stepIndex ?? 0) + 1) / total) * 100);
            setChainStatus(`Step ${(res.stepIndex ?? 0) + 1}/${total}: ${res.step?.label || res.step?.op}${res.done ? ' (Complete)' : ''}`);
        } catch (err) {
            setChainStatus(`Step error: ${err.message}`);
        }
    });

    bind('btn-chain-play-capture', async () => {
        try {
            const { captureWidth, captureHeight, viewMode, bookmarkIds, includeStageUI } = parseCaptureOptions();
            setPlaybackCameraMode(viewMode);
            const liveCaptures = [];
            setChainProgress(0);
            renderCaptureGallery([]);
            setChainStatus(`Capturing stages at ${captureWidth}×${captureHeight}${includeStageUI ? ' (+ Stage UI)' : ''}…`);
            const res = await playChain(null, {
                captureStages: true,
                captureWidth,
                captureHeight,
                cameraMode: viewMode,
                bookmarkIds: viewMode === 'defaults' ? bookmarkIds : [],
                useStageBookmark: viewMode !== 'active',
                includeStageUI,
                saveCapturesToRepo: true,
                onStage: ({ index, total, step, captures }) => {
                    setChainProgress(((index + 1) / Math.max(1, total)) * 100);
                    setChainStatus(`Captured ${index + 1}/${total}: ${step.label || step.op}`);
                    if (Array.isArray(captures) && captures.length > 0) {
                        liveCaptures.push(...captures);
                        renderCaptureGallery(liveCaptures);
                    }
                }
            });
            setChainProgress(100);
            renderCaptureGallery(res.captures || liveCaptures);
            const savedCount = (res.captures || []).filter((c) => c.repoRelativePath).length;
            setChainStatus(`Done · ${res.captures.length} PNG(s) captured${savedCount ? ` (${savedCount} saved to repo)` : ''}.`);
        } catch (err) {
            setChainStatus(`Capture error: ${err.message}`);
        }
    });
}

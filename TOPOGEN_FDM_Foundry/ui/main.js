/**
 * WFC-FDM Foundry — Student-Friendly Workbench Orchestrator (ui/main.js)
 *
 * Imports the pure-JS generator core (`../core/index.mjs`), mounts HTML templates
 * for the Telemetry HUD and Tabs 1..6, initializes the 3D Z-up viewport + floating HUDs,
 * and exposes `window.WFC_WORKBENCH` (and legacy `window.__app`) for live student
 * console experimentation and automated verification.
 */

import * as THREE from 'three';
import { appState, actions, CORE, initRhino, $ } from './state/workbench_state.js';
import {
    getDefaultBookmarks,
    getAllBookmarks,
    getBookmarkById,
    saveCustomBookmark,
    deleteCustomBookmark,
    mergeChainBookmarks,
    exportBookmarks
} from './display/camera_bookmarks.js';
import {
    initProceduralRecorder,
    ensureBaselineSteps,
    getChain,
    getLoadedChain,
    getActiveStageIndex,
    setPlaybackCameraMode,
    getPlaybackCameraMode,
    buildStageUIOverlay,
    clearChain,
    recordStep,
    stageAssetToRepo,
    exportChain,
    saveChainToRepo,
    listRepoChains,
    loadChain,
    loadChainFromRepoPath,
    playChain,
    jumpToStage,
    stepNextChain,
    getLastCaptures,
    onChainChange
} from './state/procedural_recorder.js';
import { createChainTimeline } from './display/chain_timeline.js';
import {
    viewport,
    initViewportScene,
    startRenderLoop,
    zoomToBox,
    modelBoxToWorld,
    recomputeModelBox,
    renderFrame,
    drawOverlay,
    updateCamTween,
    setArctic,
    setGizmoMode,
    bakeObjectTransform,
    selectCurve,
    deselect,
    deleteSelectedCurve,
    commitCurveFromPoints,
    refreshPoolUI
} from './display/viewport_scene.js';
import {
    initDisplayHud,
    switchTab,
    setGoldilocksMode,
    setSidebarCompactMode,
    applyOutlinerVisibility,
    refreshOutliner
} from './display/display_hud.js';
import { mountTelemetryHud, initTelemetryHud, updateSimUI } from './display/telemetry_hud.js';
import {
    mountTab1Tiles,
    initTab1Tiles,
    catmullClarkSubdivide,
    extractGraphFromMesh,
    importMeshModuleFromData,
    parseOBJMeshes,
    parse3dmMeshes,
    resubdivideImportedTiles,
    clearCustomGraphTiles,
    setCCSubdivLevel,
    setSkeletonizeMeshTile
} from './tabs/tab1_tiles.js';
import {
    mountTab2Topo,
    initTab2Topo,
    setup,
    update,
    draw,
    stepAlgorithmOnce,
    stepSubstepOnce,
    clearSubstepTrace,
    renderAdjacencyMatrixUI,
    buildWeldedGraph,
    setAlgorithm,
    setGridResolution,
    setVoxelSize,
    parse3dmToWeldedGraph,
    setLoadedNetworkGraph,
    clearLoadedNetworkGraph
} from './tabs/tab2_topo.js';
import {
    mountTab3Fdm,
    initTab3Fdm,
    applyTilePresetUI,
    runFDMOnActiveGraph,
    resetFDMView
} from './tabs/tab3_fdm.js';
import {
    mountTab4PqMesh,
    initTab4PqMesh,
    solidifyActiveGraph,
    applyLongitudinalSubdivPQFromUI,
    applyRingSubdivPQFromUI,
    applyCatmullClarkSubdivPQFromUI,
    applyOnlyPQOptimizationFromUI,
    setTubeColorMode,
    toggleUnroll3DFromUI
} from './tabs/tab4_pq_mesh.js';
import {
    mountTab5Fea,
    initTab5Fea,
    runSpaceFrameFEAFromUI,
    setFEAAnimation,
    computeEffectiveExaggeration
} from './tabs/tab5_fea.js';
import {
    mountTab6Io,
    initTab6Io,
    exportQuadOBJFromUI,
    exportFoundryTopologyJSONFromUI,
    buildFoundryTopologyJSONPayloadFromUI,
    importOBJToSceneIO,
    buildWeldedGraph3dmBytes,
    buildWeldedGraphJSON,
    loadBuffer,
    importCurves,
    buildExportBytes,
    addSceneMesh
} from './tabs/tab6_io.js';
import {
    mountTabElastica,
    initTabElastica,
    generateElasticaFromUI,
    toggleElasticaUnroll3DFromUI
} from './tabs/tab_elastica.js';
import {
    mountTab3dp,
    initTab3dp,
    print3dpApi
} from './tabs/tab7_3dp.js';
import { initMcpUiBridge } from './bridge/mcp_ui_bridge.js';

// 1. Mount dynamic HTML templates into shell containers synchronously before event wiring
mountTelemetryHud();
mountTab1Tiles();
mountTab2Topo();
mountTab3Fdm();
mountTab4PqMesh();
mountTabElastica();
mountTab5Fea();
mountTab6Io();
mountTab3dp();

// 2. Initialize Rhino3dm WASM & Three.js Z-up Viewport
appState.rhinoReady = initRhino();
initViewportScene();

// 3. Wire Display & Telemetry HUDs + Tabs 1..8 + Procedural Recorder
initProceduralRecorder();
initTelemetryHud();
initDisplayHud();
initTab1Tiles();
initTab2Topo();
initTab3Fdm();
initTab4PqMesh();
initTabElastica();
initTab5Fea();
initTab6Io();
initTab3dp();
actions.applyTilePresetUI = applyTilePresetUI;
actions.runFDMOnActiveGraph = runFDMOnActiveGraph;
actions.generateElasticaFromUI = generateElasticaFromUI;
actions.runSpaceFrameFEAFromUI = runSpaceFrameFEAFromUI;

// Preserve 3D Elastica rods & unrolled strips when switching from Elastica tab to Tab 7 (I/O)
function preserveElasticaVisibilityOnIoTab() {
    if (appState.activeTabId !== 'tab-io') return;
    const hasElastica = Boolean(
        appState.lastElasticaData &&
        Array.isArray(appState.lastElasticaData.curves) &&
        appState.lastElasticaData.curves.length > 0
    );
    if (!hasElastica) return;
    if (viewport.meshGroup) viewport.meshGroup.visible = false;
    if (viewport.elasticaGroup) viewport.elasticaGroup.visible = true;
    if (viewport.elasticaUnroll3DGroup) {
        viewport.elasticaUnroll3DGroup.visible = Boolean(
            appState.elasticaState?.showUnrolled3D &&
            viewport.elasticaUnroll3DGroup.children.length > 0
        );
    }
    if (viewport.requestRender) viewport.requestRender(4);
}

const ioTabBtn = typeof document !== 'undefined' ? document.querySelector('.ui-tab[data-tab="tab-io"]') : null;
if (ioTabBtn) {
    ioTabBtn.addEventListener('click', () => preserveElasticaVisibilityOnIoTab());
}

const switchTabWithElasticaPreserved = (targetId) => {
    switchTab(targetId);
    preserveElasticaVisibilityOnIoTab();
};

// Direct-over-viewport clickable stage timeline (BATCH-TOPOGEN-06 follow-up)
const chainTimeline = createChainTimeline({
    container: $('canvas-container') || document.body,
    onSelectStage: async (index) => {
        try {
            await jumpToStage(index, { captureStages: false, cameraMode: getPlaybackCameraMode() });
        } catch (err) {
            console.error('[chainTimeline jumpToStage]', err);
        }
    }
});
actions.chainTimeline = chainTimeline;
onChainChange((snap) => {
    const activeChain = snap.loadedChain;
    if (snap.event === 'clear' || !activeChain || !Array.isArray(activeChain.steps) || activeChain.steps.length === 0) {
        if (snap.event === 'clear') chainTimeline.hide();
    } else if (snap.event === 'load') {
        chainTimeline.setChain(activeChain, -1);
        chainTimeline.show();
    } else if (snap.event === 'play_start') {
        chainTimeline.setChain(activeChain, snap.activeStageIndex ?? -1);
        chainTimeline.setBusy(true);
        chainTimeline.show();
    } else if (snap.event === 'stage') {
        chainTimeline.setActiveStage(snap.activeStageIndex ?? 0, snap.step?.label || snap.step?.op || '');
    } else if (snap.event === 'play_complete') {
        chainTimeline.setBusy(false);
        chainTimeline.setActiveStage(snap.activeStageIndex ?? (activeChain.steps.length - 1));
    }

    // Automatically push/sync latest generated geometry (PQ Mesh > Elastica > WFC) into isolated 8. 3DP tab
    // whenever a procedural chain is stored, played, stepped, or loaded.
    if (snap.event === 'play_complete' || snap.event === 'stage' || snap.event === 'save' || snap.event === 'load' || snap.event === 'record') {
        try {
            print3dpApi.syncIfChanged({ reason: `chain:${snap.event}` });
        } catch (err) {
            console.error('[print3dp syncIfChanged]', err);
        }
    }
});

// 4. Initial Scene & Tab 1 Tiles Showcase Startup
setup({ collapseAll: true });
draw();
zoomToBox(modelBoxToWorld(appState.modelBox));
refreshPoolUI();
refreshOutliner();
startRenderLoop();

// 5. Student Console & Automated Test API (`window.WFC_WORKBENCH` & `window.__app`)
const workbenchApi = {
    state: appState,
    ready: appState.rhinoReady,
    get rhino() { return appState.rhino; },
    get scene() { return viewport.scene; },
    get camera() { return viewport.camera; },
    get renderer() { return viewport.renderer; },
    get controls() { return viewport.controls; },
    get mainGroup() { return viewport.mainGroup; },
    get pointGroup() { return viewport.pointGroup; },
    get curveGroup() { return viewport.curveGroup; },
    get userMeshGroup() { return viewport.userMeshGroup; },
    get meshGroup() { return viewport.meshGroup; },
    get graphGroup() { return viewport.graphGroup; },
    get tilePreviewGroup() { return viewport.tilePreviewGroup; },
    get fdmGroup() { return viewport.fdmGroup; },
    get tubeGroup() { return viewport.tubeGroup; },
    get unroll3DGroup() { return viewport.unroll3DGroup; },
    get feaGroup() { return viewport.feaGroup; },
    get print3dpGroup() { return viewport.print3dpGroup; },
    get voxelGroup() { return viewport.voxelGroup; },
    get substepGroup() { return viewport.substepGroup; },
    core: CORE,
    switchTab: switchTabWithElasticaPreserved,
    get activeTab() { return appState.activeTabId; },
    get inspectedTileId() { return appState.inspectedTileId; },
    applyTilePreset: applyTilePresetUI,
    runFDM: runFDMOnActiveGraph,
    resetFDM: resetFDMView,
    solidifyActiveGraph,
    applyLongitudinalSubdivPQ: applyLongitudinalSubdivPQFromUI,
    applyRingSubdivPQ: applyRingSubdivPQFromUI,
    applyCatmullClarkSubdivPQ: applyCatmullClarkSubdivPQFromUI,
    applyOnlyPQOptimization: applyOnlyPQOptimizationFromUI,
    setTubeColorMode,
    toggleUnroll3D: toggleUnroll3DFromUI,
    runFEA: runSpaceFrameFEAFromUI,
    get feaState() { return appState.feaState; },
    setFEAAnimation,
    computeEffectiveExaggeration,
    exportQuadOBJ: exportQuadOBJFromUI,
    exportFoundryTopologyJSON: exportFoundryTopologyJSONFromUI,
    buildFoundryTopologyJSONPayload: buildFoundryTopologyJSONPayloadFromUI,
    importOBJToSceneIO,
    get fdmResult() { return appState.lastFDMResult; },
    get solidData() { return appState.lastSolidData; },
    get feaResult() { return appState.lastFEAResult; },
    get faceLoopState() { return appState.faceLoopState; },
    get algorithm() { return appState.currentAlgorithm; },
    setAlgorithm,
    get gridResolution() { return { x: appState.GRID_X, y: appState.GRID_Y, z: appState.GRID_Z }; },
    setGridResolution,
    get voxelSize() { return appState.VOXEL_SIZE; },
    setVoxelSize,
    parse3dmToWeldedGraph,
    setLoadedNetworkGraph,
    clearLoadedNetworkGraph,
    get tiles() { return appState.TILES; },
    get adjRules() { return appState.adjRules; },
    get voxels() { return appState.voxels; },
    get weldedGraph() { return appState.lastWeldedGraph; },
    buildWeldedGraph,
    buildWeldedGraph3dmBytes,
    buildWeldedGraphJSON,
    catmullClarkSubdivide,
    extractGraphFromMesh,
    importMeshModuleFromData,
    parseOBJMeshes,
    parse3dmMeshes,
    resubdivideImportedTiles,
    clearCustomGraphTiles,
    get ccSubdivLevel() { return appState.ccSubdivLevel; },
    setCCSubdivLevel,
    get skeletonizeMeshTile() { return appState.skeletonizeMeshTile; },
    setSkeletonizeMeshTile,
    get showCenterlineGraph() { return appState.showCenterlineGraph; },
    setShowCenterlineGraph: (on) => {
        appState.showCenterlineGraph = !!on;
        appState.groupVis.graph = appState.showCenterlineGraph;
        const chkShowGraph = $('chk-show-graph');
        if (chkShowGraph) chkShowGraph.checked = appState.showCenterlineGraph;
        applyOutlinerVisibility();
        refreshOutliner();
        updateSimUI();
    },
    get showBoundingBox() { return appState.showBoundingBox; },
    setShowBoundingBox: (on) => {
        appState.showBoundingBox = !!on;
        appState.groupVis.bbox = appState.showBoundingBox;
        const chkBBox = $('chk-bounding-box');
        if (chkBBox) chkBBox.checked = appState.showBoundingBox;
        applyOutlinerVisibility();
        refreshOutliner();
    },
    get goldilocksMode() { return appState.goldilocksMode; },
    setGoldilocksMode,
    get sidebarCompactMode() { return appState.sidebarCompactMode; },
    setSidebarCompactMode,
    get substepMode() { return appState.substepMode; },
    setSubstepMode: (on) => {
        appState.substepMode = !!on;
        const chkSubstep = $('chk-substep');
        if (chkSubstep) chkSubstep.checked = appState.substepMode;
        if (!appState.substepMode) clearSubstepTrace();
        renderAdjacencyMatrixUI();
        draw();
    },
    get currentSubstep() { return appState.currentSubstep; },
    get substepQueue() { return appState.substepQueue; },
    setup,
    update,
    draw,
    stepAlgorithmOnce,
    stepSubstepOnce,
    pointPool: () => appState.pointPool,
    simLinePool: () => appState.simLinePool,
    loadBuffer,
    importCurves,
    exportBytes: buildExportBytes,
    addCurveFromPoints: (arr, label = null) => {
        const pts = arr.map(a => new THREE.Vector3(a[0], a[1], a[2]));
        appState.drawnCount++;
        return commitCurveFromPoints(pts, label || `Curve ${appState.drawnCount} (drawn)`);
    },
    addSceneMesh,
    curvePool: () => appState.curvePool,
    meshPool: () => appState.meshPool,
    selectCurve,
    deselect,
    deleteSelectedCurve,
    selected: () => appState.selectedIdx,
    setGizmoMode,
    gizmo: () => ({ mode: appState.gizmoMode, attached: !!viewport.tControls.object, cvHandles: appState.cvHandles.length }),
    get tControls() { return viewport.tControls; },
    bakeObjectTransform,
    get groupVis() { return appState.groupVis; },
    refreshOutliner,
    refreshPoolUI,
    setArctic,
    arctic: () => appState.arcticOn,
    zoomFit: () => zoomToBox(modelBoxToWorld(appState.modelBox)),
    step: (dt = 1 / 60) => {
        stepAlgorithmOnce();
        draw();
        updateSimUI();
        updateCamTween(dt);
        viewport.controls.update();
        renderFrame();
        drawOverlay();
    },
    snapshot: (scale = 0.5) => {
        const c = viewport.renderer.domElement;
        const s = document.createElement('canvas');
        s.width = Math.round(c.width * scale);
        s.height = Math.round(c.height * scale);
        const sx = s.getContext('2d');
        sx.fillStyle = '#ffffff';
        sx.fillRect(0, 0, s.width, s.height);
        sx.drawImage(c, 0, 0, s.width, s.height);
        sx.drawImage(viewport.overlay, 0, 0, s.width, s.height);
        return s.toDataURL('image/jpeg', 0.75);
    },
    bookmarks: {
        getDefault: getDefaultBookmarks,
        getAll: getAllBookmarks,
        getById: getBookmarkById,
        save: saveCustomBookmark,
        delete: deleteCustomBookmark,
        merge: mergeChainBookmarks,
        export: exportBookmarks,
        apply: (bm, opts) => viewport.applyCameraBookmark?.(bm, opts),
        captureState: () => viewport.getCameraBookmarkState?.(),
        setProjection: (mode, opts) => viewport.setProjectionMode?.(mode, opts),
        capturePNG: (opts) => viewport.captureHighResPNG?.(opts)
    },
    chain: {
        get: getChain,
        getLoaded: getLoadedChain,
        getActiveStageIndex,
        ensureBaselineSteps,
        setPlaybackCameraMode,
        getPlaybackCameraMode,
        buildStageUIOverlay,
        clear: clearChain,
        record: recordStep,
        stageAsset: stageAssetToRepo,
        export: exportChain,
        saveToRepo: saveChainToRepo,
        listRepo: listRepoChains,
        load: loadChain,
        loadFromRepo: loadChainFromRepoPath,
        play: playChain,
        jumpToStage,
        stepNext: stepNextChain,
        captureStages: (chainObj = null, opts = {}) => playChain(chainObj, { ...opts, captureStages: true }),
        getLastCaptures,
        timeline: chainTimeline
    },
    print3dp: print3dpApi
};

window.WFC_WORKBENCH = workbenchApi;
window.__app = workbenchApi;

// 6. Connect same-origin MCP UI Bridge (silent no-op on static servers)
workbenchApi.mcpUiBridge = initMcpUiBridge();

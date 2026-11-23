/**
 * WFC-FDM Foundry — Viewport Display HUD, Outliner, Goldilocks H1/H2/H3 & Floating Panels (ui/display/display_hud.js)
 *
 * Student Quick-Map:
 *   - Edit layer visibility rules across Tabs 1..6          -> applyOutlinerVisibility()
 *   - Edit Outliner tree rows & gizmo toolbar               -> refreshOutliner()
 *   - Edit Goldilocks H1/H2/H3 progressive disclosure modes -> setGoldilocksMode()
 *   - Edit 6-Tab switching & Compact 3-button mode          -> switchTab(), setSidebarCompactMode()
 *   - Edit floating panel drag / resize / minimize behavior -> wireFloatingPanel()
 */

import { appState, actions, $, $$, setTxt } from '../state/workbench_state.js';
import {
    viewport,
    sharedMaterials,
    recomputeModelBox,
    updateBoundingBox3D,
    zoomToBox,
    modelBoxToWorld,
    setArctic,
    setGizmoMode,
    selectCurve
} from './viewport_scene.js';

const eyeChar = v => (v ? '●' : '○');

export function refreshOutliner() {
    const outlinerTree = $('outliner-tree');
    if (!outlinerTree) return;
    const rows = [];
    const grp = (key, label, on) =>
        rows.push(`<div class="otl-row otl-grp"><span class="otl-eye ${on ? '' : 'off'}" data-eye="g:${key}">${eyeChar(on)}</span><span class="otl-name">${label}</span></div>`);
    const child = (key, label, on, sel, badge) =>
        rows.push(`<div class="otl-row otl-child ${sel ? 'sel' : ''}" data-node="${key}"><span class="otl-eye ${on ? '' : 'off'}" data-eye="${key}">${eyeChar(on)}</span><span class="otl-name">${label}</span>${badge !== undefined ? `<span class="otl-badge">${badge}</span>` : ''}</div>`);

    if (appState.meshPool.length) {
        grp('meshes', `Active Meshes (${appState.meshPool.length})`, appState.groupVis.meshes);
        appState.meshPool.forEach((m, i) => child(`mesh:${i}`, m.name || `Mesh ${i + 1}`, m.visible !== false, false, '▦'));
    }
    const gV = appState.lastWeldedGraph ? appState.lastWeldedGraph.vertices.length : 0;
    const gE = appState.lastWeldedGraph ? appState.lastWeldedGraph.edges.length : 0;
    grp('graph', `Centerline Graph (${gV}V · ${gE}E)`, appState.groupVis.graph);
    grp('voxels', 'Inactive Voxel Grid', appState.groupVis.voxels);
    grp('bbox', 'Bounding Box (W×D×H)', appState.groupVis.bbox !== false && appState.showBoundingBox);
    if (appState.curvePool.length) {
        grp('curves', `Curves (${appState.curvePool.length})`, appState.groupVis.curves);
        appState.curvePool.forEach((c, i) => child(`curve:${i}`, c.name, c.visible !== false, i === appState.selectedIdx));
    }
    grp('grid', 'Ground Grid (1 m)', appState.groupVis.grid);
    outlinerTree.innerHTML = rows.join('');
}

export function applyOutlinerVisibility() {
    const { groupVis, activeTabId, tileViewMode, lastHostGraph, lastFDMResult, lastSolidData, lastFEAResult, tubeState, faceLoopState, userImportedMeshes, showQuadMeshes, showCenterlineGraph, showInactiveVoxels, showSuperposition } = appState;

    appState.pointPool.forEach(p => { if (p.mesh) p.mesh.visible = (p.visible !== false) && groupVis.points; });
    appState.simLinePool.forEach(l => { if (l.line) l.line.visible = (l.visible !== false) && groupVis.simLines; });
    appState.curvePool.forEach(c => { if (c.line) c.line.visible = (c.visible !== false) && groupVis.curves; });
    appState.meshPool.forEach(m => { if (m.mesh) m.mesh.visible = (m.visible !== false) && groupVis.meshes; });
    viewport.userMeshGroup.visible = groupVis.meshes;

    const hasHostOrFdm = !!lastHostGraph || !!lastFDMResult;
    const hasFdmOrTube = hasHostOrFdm || !!lastSolidData;
    const hasFea = !!lastFEAResult;
    const tubeShowOn = tubeState.show;
    const unrollShowOn = !!faceLoopState.showUnrolled3D;

    if (appState.fdmNodePickMeshes && appState.fdmNodePickMeshes.length > 0) {
        const isElastica = (activeTabId === 'tab-elastica');
        for (const sph of appState.fdmNodePickMeshes) {
            if (isElastica) {
                if (sph.userData.fdmOrigScale === undefined) sph.userData.fdmOrigScale = sph.scale.x;
                sph.material = sharedMaterials.pointSphere || sharedMaterials.freeNodeSphere;
                sph.visible = false;
            } else {
                sph.visible = true;
                if (sph.userData.fdmOrigScale !== undefined) sph.scale.setScalar(sph.userData.fdmOrigScale);
                sph.material = sph.userData.isFixedAnchor ? sharedMaterials.anchorSphere : sharedMaterials.freeNodeSphere;
            }
        }
    }

    if (activeTabId === 'tab-fea' && hasFea) {
        viewport.tilePreviewGroup.visible = false;
        viewport.meshGroup.visible = groupVis.meshes && showQuadMeshes;
        viewport.graphGroup.visible = groupVis.graph && showCenterlineGraph;
        viewport.voxelGroup.visible = groupVis.voxels && (showInactiveVoxels || showSuperposition);
        viewport.fdmGroup.visible = false;
        viewport.tubeGroup.visible = !!lastSolidData && tubeShowOn && showQuadMeshes;
        viewport.unroll3DGroup.visible = !!lastSolidData && unrollShowOn;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;
        viewport.feaGroup.visible = true;
    } else if (activeTabId === 'tab-elastica') {
        viewport.tilePreviewGroup.visible = false;
        viewport.meshGroup.visible = false;
        viewport.feaGroup.visible = false;
        viewport.unroll3DGroup.visible = false;
        const showGuideTube = !!appState.elasticaState?.showGuideTube && !!lastSolidData;
        viewport.tubeGroup.visible = showGuideTube;
        const hasFdmGeo = viewport.fdmGroup && viewport.fdmGroup.children.length > 0;
        viewport.fdmGroup.visible = hasFdmGeo && groupVis.graph && showCenterlineGraph;
        viewport.graphGroup.visible = !hasFdmGeo && groupVis.graph && showCenterlineGraph;
        viewport.voxelGroup.visible = groupVis.voxels && (showInactiveVoxels || showSuperposition);
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = true;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = !!appState.elasticaState?.showUnrolled3D && viewport.elasticaUnroll3DGroup.children.length > 0;
    } else if (activeTabId === 'tab-fdm' && hasHostOrFdm) {
        viewport.tilePreviewGroup.visible = false;
        viewport.meshGroup.visible = false;
        viewport.graphGroup.visible = false;
        viewport.voxelGroup.visible = false;
        viewport.feaGroup.visible = false;
        viewport.fdmGroup.visible = true;
        viewport.tubeGroup.visible = false;
        viewport.unroll3DGroup.visible = false;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;
    } else if (activeTabId === 'tab-pq' && hasFdmOrTube) {
        viewport.tilePreviewGroup.visible = false;
        viewport.meshGroup.visible = false;
        viewport.graphGroup.visible = false;
        viewport.feaGroup.visible = false;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;
        const hasSolid = !!lastSolidData;
        const showSolid = hasSolid && tubeShowOn && groupVis.meshes && showQuadMeshes;
        viewport.tubeGroup.visible = showSolid;
        viewport.fdmGroup.visible = groupVis.graph && showCenterlineGraph;
        viewport.voxelGroup.visible = groupVis.voxels && (showInactiveVoxels || showSuperposition);
        viewport.unroll3DGroup.visible = showSolid && unrollShowOn && viewport.unroll3DGroup.children.length > 0;
    } else if (hasFdmOrTube && activeTabId !== 'tab-tiles' && activeTabId !== 'tab-topo') {
        viewport.tilePreviewGroup.visible = false;
        viewport.meshGroup.visible = false;
        viewport.graphGroup.visible = false;
        viewport.feaGroup.visible = false;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;
        const hasSolid = !!lastSolidData;
        const showSolid = hasSolid && tubeShowOn && groupVis.meshes && showQuadMeshes;
        viewport.tubeGroup.visible = showSolid;
        viewport.fdmGroup.visible = !showSolid || (groupVis.graph && showCenterlineGraph);
        viewport.voxelGroup.visible = groupVis.voxels && (showInactiveVoxels || showSuperposition);
        viewport.unroll3DGroup.visible = showSolid && unrollShowOn && viewport.unroll3DGroup.children.length > 0;
    } else if (activeTabId === 'tab-tiles' && tileViewMode === 'inspector' && userImportedMeshes.length === 0) {
        viewport.tilePreviewGroup.visible = true;
        viewport.meshGroup.visible = false;
        viewport.graphGroup.visible = false;
        viewport.voxelGroup.visible = false;
        viewport.fdmGroup.visible = false;
        viewport.tubeGroup.visible = false;
        viewport.unroll3DGroup.visible = false;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;
        viewport.feaGroup.visible = false;
    } else {
        viewport.tilePreviewGroup.visible = false;
        viewport.meshGroup.visible = groupVis.meshes && showQuadMeshes;
        viewport.graphGroup.visible = groupVis.graph && showCenterlineGraph;
        viewport.voxelGroup.visible = groupVis.voxels;
        viewport.fdmGroup.visible = false;
        viewport.tubeGroup.visible = false;
        viewport.unroll3DGroup.visible = false;
        if (viewport.elasticaGroup) viewport.elasticaGroup.visible = false;
        if (viewport.elasticaUnroll3DGroup) viewport.elasticaUnroll3DGroup.visible = false;
        viewport.feaGroup.visible = false;
    }

    viewport.gridHelper.visible = groupVis.grid;
    viewport.axesGroup.visible = groupVis.grid;
    updateBoundingBox3D();
}

export function setGoldilocksMode(mode) {
    const m = (mode || 'H1').toString().toUpperCase();
    if (m === 'H2' || m === 'GUIDE') appState.goldilocksMode = 'H2';
    else if (m === 'H3' || m === 'TELEMETRY' || m === 'DEBUG') appState.goldilocksMode = 'H3';
    else appState.goldilocksMode = 'H1';

    document.body.classList.remove('goldilocks-h1', 'goldilocks-h2', 'goldilocks-h3');
    document.body.classList.add(`goldilocks-${appState.goldilocksMode.toLowerCase()}`);

    const btnGoldilocksMode = $('btn-goldilocks-mode');
    if (btnGoldilocksMode) {
        const labels = { H1: 'H1 · Use', H2: 'H2 · Guide', H3: 'H3 · Telemetry' };
        btnGoldilocksMode.textContent = labels[appState.goldilocksMode];
        btnGoldilocksMode.classList.toggle('text-emerald-300', appState.goldilocksMode === 'H1');
        btnGoldilocksMode.classList.toggle('border-emerald-500/40', appState.goldilocksMode === 'H1');
        btnGoldilocksMode.classList.toggle('text-cyan-300', appState.goldilocksMode === 'H2');
        btnGoldilocksMode.classList.toggle('border-cyan-500/40', appState.goldilocksMode === 'H2');
        btnGoldilocksMode.classList.toggle('text-pink-300', appState.goldilocksMode === 'H3');
        btnGoldilocksMode.classList.toggle('border-pink-500/40', appState.goldilocksMode === 'H3');
    }

    const telemetryPanel = $('telemetry-panel');
    const telemetryCollapsible = $('telemetry-collapsible');
    const btnTelemetryMinimize = $('btn-telemetry-minimize');
    const telemetryResizeE = $('telemetry-resize-e');
    const telemetryResizeSE = $('telemetry-resize-se');
    if (telemetryPanel && telemetryCollapsible && btnTelemetryMinimize) {
        const expandTelemetry = (appState.goldilocksMode === 'H3');
        telemetryCollapsible.classList.toggle('hidden', !expandTelemetry);
        telemetryPanel.classList.toggle('minimized', !expandTelemetry);
        if (telemetryResizeE) telemetryResizeE.classList.toggle('hidden', !expandTelemetry);
        if (telemetryResizeSE) telemetryResizeSE.classList.toggle('hidden', !expandTelemetry);
        btnTelemetryMinimize.textContent = expandTelemetry ? '–' : '+';
    }
    return appState.goldilocksMode;
}

function isTilesInspectorShowcaseTab(tabId) {
    return tabId === 'tab-tiles'
        && appState.tileViewMode === 'inspector'
        && appState.userImportedMeshes.length === 0;
}

export function switchTab(targetId) {
    if (!targetId) return;
    const prevTabId = appState.activeTabId;
    const wasShowcase = isTilesInspectorShowcaseTab(prevTabId);
    appState.activeTabId = targetId;
    const nowShowcase = isTilesInspectorShowcaseTab(targetId);

    $$('.ui-tab').forEach(b => {
        const active = b.dataset.tab === targetId;
        b.classList.toggle('border-pink-500', active);
        b.classList.toggle('text-white', active);
        b.classList.toggle('bg-gray-800/70', active);
        b.classList.toggle('border-transparent', !active);
        b.classList.toggle('text-gray-400', !active);
    });
    $$('.tab-pane').forEach(pane => {
        pane.classList.toggle('hidden', pane.id !== targetId);
    });

    if (targetId === 'tab-fdm' && actions.ensureFdmTabReady) {
        actions.ensureFdmTabReady({ keepCamera: true });
    } else if (targetId === 'tab-pq' && actions.ensurePqTabReady) {
        actions.ensurePqTabReady({ keepCamera: true });
    } else if (targetId === 'tab-elastica' && actions.ensureElasticaTabReady) {
        actions.ensureElasticaTabReady({ keepCamera: true });
    } else if (targetId === 'tab-fea' && !appState.lastFEAResult && actions.runSpaceFrameFEAFromUI) {
        actions.runSpaceFrameFEAFromUI({ trigger: 'tab-switch' });
    }

    applyOutlinerVisibility();
    recomputeModelBox();
    if (wasShowcase !== nowShowcase) {
        zoomToBox(modelBoxToWorld(appState.modelBox));
    }
}

export function setSidebarCompactMode(isCompact) {
    appState.sidebarCompactMode = !!isCompact;
    const sidebarCompactCard = $('sidebar-compact-card');
    const sidebarCollapsible = $('sidebar-collapsible');
    const leftSidebar = $('left-sidebar');
    const btnSidebarCompactToggle = $('btn-sidebar-compact-toggle');
    const btnSidebarMinimize = $('btn-sidebar-minimize');

    if (sidebarCompactCard) sidebarCompactCard.classList.toggle('hidden', !appState.sidebarCompactMode);
    if (sidebarCollapsible) sidebarCollapsible.classList.toggle('hidden', appState.sidebarCompactMode);
    if (leftSidebar) leftSidebar.classList.toggle('minimized', appState.sidebarCompactMode);
    if (btnSidebarCompactToggle) {
        btnSidebarCompactToggle.textContent = appState.sidebarCompactMode ? 'Full UI ▸' : 'Compact';
        btnSidebarCompactToggle.title = appState.sidebarCompactMode ? 'Expand into Full 6-Tab UI View' : 'Switch to 3-Button Compact Card';
    }
    if (btnSidebarMinimize) btnSidebarMinimize.textContent = '–';
}

export function wireFloatingPanel(panelEl, headerEl, minBtnEl, bodyEl, resizeEEl, resizeSEEl, minW, maxW, startMinimized) {
    if (!panelEl || !headerEl) return;
    const leftSidebar = $('left-sidebar');
    const sidebarCompactCard = $('sidebar-compact-card');
    let isMin = !!startMinimized;

    if (minBtnEl && bodyEl) {
        if (isMin) {
            bodyEl.classList.add('hidden');
            panelEl.classList.add('minimized');
            if (resizeEEl) resizeEEl.classList.add('hidden');
            if (resizeSEEl) resizeSEEl.classList.add('hidden');
            minBtnEl.textContent = '+';
        }
        minBtnEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const curMin = (panelEl === leftSidebar && appState.sidebarCompactMode && sidebarCompactCard)
                ? sidebarCompactCard.classList.contains('hidden')
                : bodyEl.classList.contains('hidden');
            isMin = !curMin;
            if (panelEl === leftSidebar && appState.sidebarCompactMode && sidebarCompactCard) {
                sidebarCompactCard.classList.toggle('hidden', isMin);
            } else {
                bodyEl.classList.toggle('hidden', isMin);
            }
            panelEl.classList.toggle('minimized', isMin || (panelEl === leftSidebar && appState.sidebarCompactMode));
            if (resizeEEl) resizeEEl.classList.toggle('hidden', isMin);
            if (resizeSEEl) resizeSEEl.classList.toggle('hidden', isMin);
            minBtnEl.textContent = isMin ? '+' : '–';
        });
    }

    let dragState = null;
    headerEl.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button') || e.target.closest('a') || e.target.closest('#btn-goldilocks-help')) return;
        const rect = panelEl.getBoundingClientRect();
        panelEl.style.bottom = 'auto';
        panelEl.style.right = 'auto';
        panelEl.style.left = `${rect.left}px`;
        panelEl.style.top = `${rect.top}px`;
        dragState = { startX: e.clientX, startY: e.clientY, origLeft: rect.left, origTop: rect.top };
        headerEl.setPointerCapture(e.pointerId);
    });
    headerEl.addEventListener('pointermove', (e) => {
        if (!dragState) return;
        const newLeft = Math.max(4, Math.min(window.innerWidth - 120, dragState.origLeft + (e.clientX - dragState.startX)));
        const newTop = Math.max(4, Math.min(window.innerHeight - 44, dragState.origTop + (e.clientY - dragState.startY)));
        panelEl.style.left = `${newLeft}px`;
        panelEl.style.top = `${newTop}px`;
    });
    headerEl.addEventListener('pointerup', (e) => {
        if (dragState) {
            dragState = null;
            try { headerEl.releasePointerCapture(e.pointerId); } catch (err) {}
        }
    });

    let resizeState = null;
    const onMove = (e) => {
        if (!resizeState) return;
        const newW = Math.max(minW, Math.min(maxW, resizeState.origW + (e.clientX - resizeState.startX)));
        panelEl.style.width = `${Math.round(newW)}px`;
        if (resizeState.mode === 'se') {
            const maxH = window.innerHeight - resizeState.origTop - 8;
            const newH = Math.max(180, Math.min(maxH, resizeState.origH + (e.clientY - resizeState.startY)));
            panelEl.style.height = `${Math.round(newH)}px`;
        }
    };
    const onUp = () => {
        resizeState = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
    };
    const startResize = (e, mode) => {
        e.stopPropagation();
        e.preventDefault();
        const rect = panelEl.getBoundingClientRect();
        resizeState = { mode, startX: e.clientX, startY: e.clientY, origW: rect.width, origH: rect.height, origTop: rect.top };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };
    if (resizeEEl) resizeEEl.addEventListener('pointerdown', (e) => startResize(e, 'e'));
    if (resizeSEEl) resizeSEEl.addEventListener('pointerdown', (e) => startResize(e, 'se'));
}

export function initDisplayHud() {
    actions.refreshOutliner = refreshOutliner;
    actions.applyOutlinerVisibility = applyOutlinerVisibility;
    actions.switchTab = switchTab;
    actions.setGoldilocksMode = setGoldilocksMode;
    actions.setSidebarCompactMode = setSidebarCompactMode;

    // Outliner collapse & tree clicks
    const outlinerCollapse = $('outliner-collapse');
    const outlinerBody = $('outliner-body');
    if (outlinerCollapse && outlinerBody) {
        outlinerCollapse.addEventListener('click', () => {
            const hidden = outlinerBody.classList.toggle('hidden');
            outlinerCollapse.textContent = hidden ? '+' : '–';
        });
    }
    const outlinerTree = $('outliner-tree');
    if (outlinerTree) {
        outlinerTree.addEventListener('click', (e) => {
            const eyeEl = e.target.closest('[data-eye]');
            if (eyeEl) {
                const key = eyeEl.dataset.eye;
                if (key.startsWith('g:')) {
                    const gk = key.slice(2);
                    appState.groupVis[gk] = !appState.groupVis[gk];
                    if (gk === 'bbox') {
                        appState.showBoundingBox = appState.groupVis.bbox;
                        const chkBBox = $('chk-bounding-box');
                        if (chkBBox) chkBBox.checked = appState.showBoundingBox;
                    }
                } else {
                    const [t, is] = key.split(':');
                    const i = parseInt(is, 10);
                    if (t === 'point' && appState.pointPool[i]) appState.pointPool[i].visible = appState.pointPool[i].visible === false;
                    if (t === 'simLine' && appState.simLinePool[i]) appState.simLinePool[i].visible = appState.simLinePool[i].visible === false;
                    if (t === 'curve' && appState.curvePool[i]) appState.curvePool[i].visible = appState.curvePool[i].visible === false;
                    if (t === 'mesh' && appState.meshPool[i]) appState.meshPool[i].visible = appState.meshPool[i].visible === false;
                }
                applyOutlinerVisibility();
                refreshOutliner();
                e.stopPropagation();
                return;
            }
            const row = e.target.closest('[data-node]');
            if (row) {
                const [t, is] = row.dataset.node.split(':');
                if (t === 'curve') selectCurve(parseInt(is, 10));
            }
        });
    }

    $$('.gizbtn').forEach(b => b.addEventListener('click', () => setGizmoMode(b.dataset.gizmo)));

    // Display HUD buttons & toggles
    const btnZoom = $('btn-zoom');
    if (btnZoom) btnZoom.addEventListener('click', () => zoomToBox(modelBoxToWorld(appState.modelBox)));
    const btnArctic = $('btn-arctic');
    if (btnArctic) btnArctic.addEventListener('click', () => setArctic(!appState.arcticOn));
    const btnWireframe = $('btn-wireframe');
    if (btnWireframe) {
        btnWireframe.addEventListener('click', () => {
            appState.wireframeOn = !appState.wireframeOn;
            btnWireframe.classList.toggle('seg-on', appState.wireframeOn);
            viewport.tubeGroup.children.forEach(m => {
                if (m.isMesh && m.userData && m.userData.isTubeSurface) {
                    m.visible = !appState.wireframeOn;
                }
            });
            viewport.meshGroup.children.forEach(m => {
                if (m.isMesh && m.userData && m.userData.isTopoSurface) {
                    m.visible = !appState.wireframeOn;
                }
            });
            if (viewport.elasticaGroup) {
                viewport.elasticaGroup.children.forEach(m => {
                    if (m.isMesh && m.userData && m.userData.baseMaterial) {
                        m.visible = !appState.wireframeOn;
                    }
                });
            }
            if (viewport.elasticaUnroll3DGroup) {
                viewport.elasticaUnroll3DGroup.children.forEach(m => {
                    if (m.isMesh && m.userData && m.userData.baseMaterial) {
                        m.visible = !appState.wireframeOn;
                    }
                });
            }
            if (appState.lastSolidData && actions.renderTubularMesh) {
                actions.renderTubularMesh(appState.lastSolidData);
            }
            if (actions.draw) actions.draw();
        });
    }

    const chkInactiveGrid = $('chk-inactive-grid');
    if (chkInactiveGrid) {
        chkInactiveGrid.addEventListener('change', (e) => {
            appState.showInactiveVoxels = e.target.checked;
            appState.groupVis.voxels = appState.showInactiveVoxels || appState.showSuperposition;
            if (actions.draw) actions.draw();
        });
    }
    const chkSuperposition = $('chk-superposition');
    if (chkSuperposition) {
        chkSuperposition.addEventListener('change', (e) => {
            appState.showSuperposition = e.target.checked;
            appState.groupVis.voxels = appState.showInactiveVoxels || appState.showSuperposition;
            if (actions.draw) actions.draw();
        });
    }
    const chkBoundingBox = $('chk-bounding-box');
    if (chkBoundingBox) {
        chkBoundingBox.checked = appState.showBoundingBox;
        chkBoundingBox.addEventListener('change', (e) => {
            appState.showBoundingBox = e.target.checked;
            appState.groupVis.bbox = appState.showBoundingBox;
            updateBoundingBox3D();
            refreshOutliner();
        });
    }
    const chkShowGraph = $('chk-show-graph');
    if (chkShowGraph) {
        chkShowGraph.addEventListener('change', (e) => {
            appState.showCenterlineGraph = e.target.checked;
            appState.groupVis.graph = appState.showCenterlineGraph;
            if (appState.showCenterlineGraph && appState.activeTabId === 'tab-pq' && viewport.fdmGroup.children.length === 0) {
                if (appState.fdmState.triggerOnHost && appState.lastFDMResult && actions.renderFDMNetwork) {
                    actions.renderFDMNetwork(appState.lastFDMResult);
                } else if (actions.renderHostNetworkInFdmGroup) {
                    actions.renderHostNetworkInFdmGroup();
                }
            }
            applyOutlinerVisibility();
            refreshOutliner();
            if (actions.updateSimUI) actions.updateSimUI();
        });
    }
    const chkShowMeshes = $('chk-show-meshes');
    if (chkShowMeshes) {
        chkShowMeshes.addEventListener('change', (e) => {
            appState.showQuadMeshes = e.target.checked;
            appState.groupVis.meshes = appState.showQuadMeshes;
            appState.tubeState.show = appState.showQuadMeshes;
            const chkTubeShowEl = $('chk-tube-show');
            if (chkTubeShowEl) chkTubeShowEl.checked = appState.showQuadMeshes;
            applyOutlinerVisibility();
            refreshOutliner();
        });
    }

    // Goldilocks mode button, 6-Tab switcher & Compact 3-button card
    const btnGoldilocksMode = $('btn-goldilocks-mode');
    if (btnGoldilocksMode) {
        btnGoldilocksMode.addEventListener('click', (e) => {
            e.stopPropagation();
            const next = appState.goldilocksMode === 'H1' ? 'H2' : (appState.goldilocksMode === 'H2' ? 'H3' : 'H1');
            setGoldilocksMode(next);
        });
    }

    $$('.ui-tab').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => switchTab(tabBtn.dataset.tab));
    });

    const btnCompactOpenTiles = $('btn-compact-open-tiles');
    if (btnCompactOpenTiles) {
        btnCompactOpenTiles.addEventListener('click', () => {
            setSidebarCompactMode(false);
            switchTab('tab-tiles');
        });
    }
    const btnSidebarCompactToggle = $('btn-sidebar-compact-toggle');
    if (btnSidebarCompactToggle) {
        btnSidebarCompactToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            setSidebarCompactMode(!appState.sidebarCompactMode);
        });
    }
    const btnCompactExpandFull = $('btn-compact-expand-full');
    if (btnCompactExpandFull) btnCompactExpandFull.addEventListener('click', () => setSidebarCompactMode(false));
    const btnCompactChooseAlgo = $('btn-compact-choose-algo');
    const compactAlgoMenu = $('compact-algo-menu');
    if (btnCompactChooseAlgo && compactAlgoMenu) {
        btnCompactChooseAlgo.addEventListener('click', () => compactAlgoMenu.classList.toggle('hidden'));
    }
    const clickProxy = (srcId, dstId) => {
        const s = $(srcId);
        if (s) s.addEventListener('click', () => { const d = $(dstId); if (d) d.click(); });
    };
    clickProxy('btn-compact-run', 'btn-sim-run');
    clickProxy('btn-compact-step', 'btn-sim-step');
    clickProxy('btn-compact-burst', 'btn-sim-burst');
    clickProxy('btn-compact-reset', 'btn-sim-reset');

    // Summarized pipeline actions (PQ Mesh, FDM, FEA, I/O) in Compact Mode
    const rngCompactTubeRadius = $('rng-compact-tube-radius');
    if (rngCompactTubeRadius) {
        let compactRadiusTimer = null;
        rngCompactTubeRadius.addEventListener('input', () => {
            const v = parseFloat(rngCompactTubeRadius.value);
            if (!Number.isFinite(v)) return;
            appState.tubeState.radius = v;
            if (actions.syncTubeWallRadiiUI) actions.syncTubeWallRadiiUI();
            if (compactRadiusTimer) clearTimeout(compactRadiusTimer);
            compactRadiusTimer = setTimeout(() => {
                if (actions.solidifyActiveGraph) actions.solidifyActiveGraph({ keepCamera: true });
                if (actions.updateSimUI) actions.updateSimUI();
            }, 35);
        });
    }

    const redrawNodeEdgeDisplay = () => {
        if (actions.draw) actions.draw();
        if (appState.lastFDMResult && actions.renderFDMNetwork) actions.renderFDMNetwork(appState.lastFDMResult);
        if (appState.lastElasticaData && actions.renderElastica3D) actions.renderElastica3D();
        if (appState.lastFEAResult && actions.renderFEAResults3D) actions.renderFEAResults3D();
    };
    const rngDispNodeSize = $('rng-disp-node-size');
    if (rngDispNodeSize) {
        rngDispNodeSize.addEventListener('input', () => {
            const v = parseFloat(rngDispNodeSize.value) || 1.0;
            appState.nodeDisplayScale = v;
            setTxt('val-disp-node-size', `${v.toFixed(1)}×`);
            redrawNodeEdgeDisplay();
        });
    }
    const rngDispEdgeSize = $('rng-disp-edge-size');
    if (rngDispEdgeSize) {
        rngDispEdgeSize.addEventListener('input', () => {
            const v = parseFloat(rngDispEdgeSize.value) || 1.5;
            appState.edgeDisplayWidthPx = v;
            setTxt('val-disp-edge-size', `${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}px`);
            redrawNodeEdgeDisplay();
        });
    }

    const btnCompactPqm = $('btn-compact-pqm');
    if (btnCompactPqm) {
        btnCompactPqm.addEventListener('click', () => {
            switchTab('tab-pq');
            if (actions.solidifyActiveGraph) actions.solidifyActiveGraph({ keepCamera: true });
            if (actions.updateSimUI) actions.updateSimUI();
        });
    }
    const btnCompactUnroll = $('btn-compact-unroll');
    if (btnCompactUnroll) {
        btnCompactUnroll.addEventListener('click', () => {
            switchTab('tab-pq');
            if (actions.toggleUnroll3DFromUI) {
                const on = actions.toggleUnroll3DFromUI();
                btnCompactUnroll.classList.toggle('on', !!on);
            }
        });
    }
    const btnCompactElastica = $('btn-compact-elastica');
    if (btnCompactElastica) {
        btnCompactElastica.addEventListener('click', () => {
            switchTab('tab-elastica');
            if (actions.generateElasticaFromUI) actions.generateElasticaFromUI();
            if (actions.updateSimUI) actions.updateSimUI();
        });
    }
    const btnCompactElasticaUnroll = $('btn-compact-elastica-unroll');
    if (btnCompactElasticaUnroll) {
        btnCompactElasticaUnroll.addEventListener('click', () => {
            switchTab('tab-elastica');
            if (actions.toggleElasticaUnroll3DFromUI) {
                const on = actions.toggleElasticaUnroll3DFromUI();
                btnCompactElasticaUnroll.classList.toggle('on', !!on);
            }
        });
    }
    const btnCompactFdm = $('btn-compact-fdm');
    if (btnCompactFdm) {
        btnCompactFdm.addEventListener('click', () => {
            switchTab('tab-fdm');
            if (actions.runFDMOnActiveGraph) actions.runFDMOnActiveGraph({ keepCamera: true });
            if (actions.updateSimUI) actions.updateSimUI();
        });
    }
    clickProxy('btn-compact-fdm-reset', 'btn-reset-fdm');
    const btnCompactFea = $('btn-compact-fea');
    if (btnCompactFea) {
        btnCompactFea.addEventListener('click', () => {
            switchTab('tab-fea');
            if (actions.runSpaceFrameFEAFromUI) actions.runSpaceFrameFEAFromUI({ expandHud: false });
            if (actions.updateSimUI) actions.updateSimUI();
        });
    }
    clickProxy('btn-compact-fea-anim', 'btn-fea-animate');
    clickProxy('btn-compact-export-3dm', 'btn-export');

    const btnCompactToggleGraph = $('btn-compact-toggle-graph');
    if (btnCompactToggleGraph) {
        btnCompactToggleGraph.addEventListener('click', () => {
            appState.showCenterlineGraph = !appState.showCenterlineGraph;
            appState.groupVis.graph = appState.showCenterlineGraph;
            if (chkShowGraph) chkShowGraph.checked = appState.showCenterlineGraph;
            applyOutlinerVisibility();
            refreshOutliner();
            if (actions.updateSimUI) actions.updateSimUI();
        });
    }

    // Floating panels (Left Sidebar, Telemetry HUD, Display HUD)
    wireFloatingPanel($('left-sidebar'), $('sidebar-drag-header'), $('btn-sidebar-minimize'), $('sidebar-collapsible'), $('sidebar-resize-e'), $('sidebar-resize-se'), 280, 620, false);
    wireFloatingPanel($('telemetry-panel'), $('telemetry-drag-header'), $('btn-telemetry-minimize'), $('telemetry-collapsible'), $('telemetry-resize-e'), $('telemetry-resize-se'), 250, 540, true);
    wireFloatingPanel($('display-hud-panel'), $('display-hud-drag-header'), $('btn-display-hud-minimize'), $('display-hud-collapsible'), $('display-hud-resize-e'), $('display-hud-resize-se'), 240, 520, true);

    setGoldilocksMode('H1');
    setSidebarCompactMode(false);
}

/**
 * WFC-FDM Foundry — Tab 2: 3D Topology Generator & Network File Loader (ui/tabs/tab2_topo.js)
 *
 * Student Quick-Map:
 *   - Edit Tab 2 HTML controls / grid presets           -> mountTab2Topo()
 *   - Edit interactive WFC / Adjacency Growth stepping  -> stepWFC(), stepAdjacencyGrowth(), propagateWFC()
 *   - Edit Sub-Step rule lookup trace & matrix table    -> buildWFCSubsteps(), renderAdjacencyMatrixUI()
 *   - Edit voxel-to-centerline welding & 3D draw pass   -> buildWeldedGraph(), draw()
 *   - Edit .3dm / .json / .obj network file loader      -> parse3dmToWeldedGraph(), parseJSONOrOBJToWeldedGraph()
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    createEmptyAdjRules,
    getUnitScale,
    $,
    $$,
    setValIfNotFocused
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
import { updateSimUI } from '../display/telemetry_hud.js';
import {
    parse3dmToWeldedGraph,
    parseJSONOrOBJToWeldedGraph,
    setLoadedNetworkGraph,
    clearLoadedNetworkGraph
} from './tab2_network_loader.js';

export {
    parse3dmToWeldedGraph,
    parseJSONOrOBJToWeldedGraph,
    setLoadedNetworkGraph,
    clearLoadedNetworkGraph
};

const { DIRS, TILE_NULL, TILE_CROSS } = CORE;

export function mountTab2Topo() {
    const pane = $('tab-topo');
    if (!pane) return;
    pane.innerHTML = `
        <!-- Load Network From File (.3dm / .json / .obj) -->
        <div class="bg-gray-900/90 border border-cyan-500/40 rounded p-2.5 space-y-1.5">
            <div class="flex items-center justify-between">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-cyan-300">Load Network From File</label>
                <span id="topo-file-graph-badge" class="text-[9.5px] font-mono text-gray-400">Voxel Topo</span>
            </div>
            <p class="goldilocks-guide-prose text-[9.5px] text-gray-400 leading-snug">
                Load a Rhino <span class="text-gray-200 font-semibold">.3dm</span> (curves to welded graph), <span class="text-gray-200 font-semibold">.json</span> graph, or <span class="text-gray-200 font-semibold">.obj</span> polyline network.
            </p>
            <input type="file" id="topo-network-file-input" accept=".3dm,.json,.obj" class="block w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[10.5px] file:font-semibold file:bg-cyan-600/80 file:text-white hover:file:bg-cyan-500 cursor-pointer transition-colors" />
            <div class="flex items-center justify-between gap-1.5 pt-0.5 text-[9.5px] font-mono">
                <label class="flex items-center space-x-1 text-gray-400">
                    <span>Weld Tol (m)</span>
                    <input type="number" id="num-topo-file-weld-tol" min="0.0001" max="0.5" step="0.001" value="0.005" class="w-16 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </label>
                <button type="button" id="btn-clear-loaded-network" disabled class="cad-btn text-[8.5px] py-0.5 px-2" title="Clear loaded file network and revert to Voxel Topology Generator">✕ Use Voxel Topo</button>
            </div>
            <div id="topo-network-feedback" class="text-[9.5px] text-center font-mono text-gray-400"></div>
        </div>

        <div class="flex items-center justify-between">
            <label class="block text-[11px] font-semibold uppercase tracking-wider text-gray-200">Topology Generator</label>
            <div class="flex items-center space-x-1.5">
                <span id="topo-voxel-pins-badge" class="text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400" title="Pinned (x,y,z) voxel constraints">0 pins</span>
                <button type="button" id="btn-clear-voxel-pins" class="hidden cad-btn text-[8.5px] py-0.5 px-1.5" title="Clear all pinned voxel constraints">✕ Pins</button>
                <span id="sim-frame-badge" class="text-[10px] font-mono text-pink-400">3×3×4 grid</span>
            </div>
        </div>

        <!-- Algorithm Toggle -->
        <div class="grid grid-cols-2 gap-1">
            <button data-algo="growth" class="algo-btn cad-btn" title="(a) Adjacency-based frontier growth">(a) Adj Growth</button>
            <button data-algo="wfc"    class="algo-btn cad-btn on" title="(b) Minimum-entropy Topology Collapse &amp; constraint propagation">(b) Topo Collapse</button>
        </div>
        <p class="goldilocks-guide-prose text-[9.5px] text-gray-400 leading-snug">
            Minimum-entropy <span class="text-gray-200 font-semibold">Topo Collapse</span> or outward <span class="text-gray-200 font-semibold">Adj Growth</span> across the 3D voxel grid.
        </p>

        <!-- Playback Controls -->
        <div class="grid grid-cols-4 gap-1">
            <button id="btn-sim-run"   class="cad-btn">▶ Run</button>
            <button id="btn-sim-step"  class="cad-btn">⏭ Step</button>
            <button id="btn-sim-burst" class="cad-btn" title="Step 50 iterations">⚡ ×50</button>
            <button id="btn-sim-reset" class="cad-btn">↺ Reset</button>
        </div>
        <button id="btn-sim-collapse-all" class="cad-btn cyan w-full py-1 text-[9.5px]" title="Collapse entire voxel grid immediately and build welded centerline graph">⚡ Collapse Full Grid Now</button>

        <!-- Voxel Grid Resolution Control (Independent X, Y, Z) -->
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2 space-y-1.5">
            <div class="flex items-center justify-between">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Voxel Grid (X×Y×Z)</span>
                <span id="grid-res-label" class="text-[10px] font-mono text-pink-400">3×3×4 (36 vox)</span>
            </div>
            <div class="space-y-1 text-[10px] font-mono">
                <div class="flex items-center space-x-1.5">
                    <span class="w-3 text-red-400 font-bold">X</span>
                    <input type="range" id="rng-grid-x" min="1" max="20" step="1" value="3" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                    <input type="number" id="num-grid-x" min="1" max="20" step="1" value="3" class="w-11 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </div>
                <div class="flex items-center space-x-1.5">
                    <span class="w-3 text-emerald-400 font-bold">Y</span>
                    <input type="range" id="rng-grid-y" min="1" max="20" step="1" value="3" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                    <input type="number" id="num-grid-y" min="1" max="20" step="1" value="3" class="w-11 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </div>
                <div class="flex items-center space-x-1.5">
                    <span class="w-3 text-sky-400 font-bold">Z</span>
                    <input type="range" id="rng-grid-z" min="1" max="20" step="1" value="4" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                    <input type="number" id="num-grid-z" min="1" max="20" step="1" value="4" class="w-11 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </div>
            </div>
            <div class="grid grid-cols-6 gap-1 pt-0.5">
                <button data-rx="3"  data-ry="3"  data-rz="4"  class="res-preset-btn cad-btn seg-on text-[8.5px] py-0.5" title="3×3×4 structural tower">3×3×4</button>
                <button data-rx="4"  data-ry="3"  data-rz="1"  class="res-preset-btn cad-btn text-[8.5px] py-0.5" title="4×3×1 flat slab">4×3×1</button>
                <button data-rx="1"  data-ry="1"  data-rz="3"  class="res-preset-btn cad-btn text-[8.5px] py-0.5" title="1×1×3 tower">1×1×3</button>
                <button data-rx="4"  data-ry="4"  data-rz="8"  class="res-preset-btn cad-btn text-[8.5px] py-0.5" title="4×4×8 vertical tower">4×4×8</button>
                <button data-rx="5"  data-ry="5"  data-rz="5"  class="res-preset-btn cad-btn text-[8.5px] py-0.5" title="5×5×5 cube">5×5×5</button>
                <button data-rx="10" data-ry="10" data-rz="10" class="res-preset-btn cad-btn text-[8.5px] py-0.5" title="10×10×10 dense cube">10³</button>
            </div>
            <div class="pt-1.5 mt-1 border-t border-gray-800 space-y-1.5 text-[9.5px] font-mono">
                <div class="flex items-center justify-between">
                    <span class="text-gray-400">Voxel Size (m)</span>
                    <div class="flex items-center space-x-1.5">
                        <input type="range" id="rng-voxel-size" min="0.1" max="5.0" step="0.05" value="1.0" class="w-24 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                        <input type="number" id="num-voxel-size" min="0.05" max="20.0" step="0.05" value="1.0" class="w-14 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-1">
                    <label class="flex flex-col text-[8.5px] text-gray-400">
                        <span>Span X (m)</span>
                        <input type="number" id="num-topo-env-x" min="0.1" max="200" step="0.1" value="3.0" class="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-[9.5px]">
                    </label>
                    <label class="flex flex-col text-[8.5px] text-gray-400">
                        <span>Span Y (m)</span>
                        <input type="number" id="num-topo-env-y" min="0.1" max="200" step="0.1" value="3.0" class="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-[9.5px]">
                    </label>
                    <label class="flex flex-col text-[8.5px] text-gray-400">
                        <span>Height Z (m)</span>
                        <input type="number" id="num-topo-env-z" min="0.1" max="200" step="0.1" value="4.0" class="px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-100 text-[9.5px]">
                    </label>
                </div>
            </div>
        </div>

        <!-- Welded Graph Settings -->
        <div class="bg-gray-900/90 border border-gray-700 rounded px-2.5 py-2 flex items-center justify-between">
            <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-300">Welded Graph</span>
            <label class="flex items-center space-x-1.5 text-[10px] text-gray-200 cursor-pointer" title="Merge strictly collinear degree-2 vertices at tile boundaries into clean struts">
                <input type="checkbox" id="chk-merge-collinear" checked class="accent-red-500 rounded">
                <span>Merge Collinear</span>
            </label>
        </div>

        <!-- Collapsible Adjacency Rules & Sub-Step Visualisation Accordion -->
        <details id="details-adj-rules" class="bg-gray-900/90 border border-gray-700 rounded">
            <summary class="px-2.5 py-2 cursor-pointer select-none flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-gray-300 hover:text-white">
                <span>Adjacency Rules &amp; Sub-Step Vis</span>
                <span class="text-[9px] font-mono text-pink-400">Matrix ▾</span>
            </summary>
            <div class="p-2.5 pt-1 border-t border-gray-800 space-y-2">
                <label class="flex items-center space-x-1.5 cursor-pointer bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1 text-[10px] text-amber-300 font-medium">
                    <input type="checkbox" id="chk-substep" class="accent-amber-400 rounded">
                    <span>Sub-Step Visualisation (Rule Lookup)</span>
                </label>
                <div>
                    <div class="flex items-center justify-between mb-1.5">
                        <span class="text-[9.5px] font-semibold uppercase tracking-wider text-gray-400">Socket Matrix</span>
                        <div class="flex space-x-1">
                            <button id="btn-rules-socket" class="text-[9px] px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-pink-400 rounded border border-gray-700" title="Reset rules to socket-matching defaults">Socket</button>
                            <button id="btn-rules-all" class="text-[9px] px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700" title="Allow all adjacencies">All</button>
                        </div>
                    </div>
                    <div class="flex space-x-1 mb-1.5">
                        <button data-axis="0" class="axis-btn cad-btn flex-1 seg-on text-[9px] py-0.5">X (+X→-X)</button>
                        <button data-axis="1" class="axis-btn cad-btn flex-1 text-[9px] py-0.5">Y (+Y→-Y)</button>
                        <button data-axis="2" class="axis-btn cad-btn flex-1 text-[9px] py-0.5">Z (+Z→-Z)</button>
                    </div>
                    <div id="adj-matrix-container" class="overflow-x-auto flex justify-center"></div>
                    <p class="goldilocks-guide-prose text-[9px] text-gray-500 mt-1 text-center">Row tile's +Axis face → Column tile's -Axis face</p>
                </div>
            </div>
        </details>
    `;
}

export function syncVoxelAndEnvelopeUI() {
    const { VOXEL_SIZE, GRID_X, GRID_Y, GRID_Z } = appState;
    const vsStr = Number(VOXEL_SIZE.toFixed(3)).toString();
    setValIfNotFocused('rng-tile-voxel-size', vsStr);
    setValIfNotFocused('num-tile-voxel-size', vsStr);
    setValIfNotFocused('rng-voxel-size', vsStr);
    setValIfNotFocused('num-voxel-size', vsStr);
    setValIfNotFocused('num-topo-env-x', Number((GRID_X * VOXEL_SIZE).toFixed(3)).toString());
    setValIfNotFocused('num-topo-env-y', Number((GRID_Y * VOXEL_SIZE).toFixed(3)).toString());
    setValIfNotFocused('num-topo-env-z', Number((GRID_Z * VOXEL_SIZE).toFixed(3)).toString());
}

export function clearActiveAnalysisOverlaysForTopo() {
    if (appState.sidebarCompactMode && appState.activeTabId === 'tab-tiles') {
        appState.activeTabId = 'tab-topo';
        $$('.ui-tab').forEach(b => {
            const active = b.dataset.tab === 'tab-topo';
            b.classList.toggle('border-pink-500', active);
            b.classList.toggle('text-white', active);
            b.classList.toggle('bg-gray-800/70', active);
            b.classList.toggle('border-transparent', !active);
            b.classList.toggle('text-gray-400', !active);
        });
        $$('.tab-pane').forEach(pane => pane.classList.toggle('hidden', pane.id !== 'tab-topo'));
    }
    appState.lastHostGraph = null;
    appState.fdmFixedNodeSet.clear();
    appState.fdmFixedCustomized = false;
    appState.fdmNodePickMeshes = [];
    if (actions.setFdmHostTriggerUI) actions.setFdmHostTriggerUI(false);
    appState.lastFDMResult = null;
    appState.lastSolidData = null;
    appState.lastFEAResult = null;
    clearGroup(viewport.fdmGroup);
    clearGroup(viewport.tubeGroup);
    clearGroup(viewport.unroll3DGroup);
    clearGroup(viewport.feaGroup);
    appState.currentTilePreset = 'active_topo';
    const badge = $('fdm-preset-badge');
    if (badge) badge.textContent = 'active_topo';
    $$('.tile-preset-btn').forEach(b => b.classList.toggle('seg-on', b.dataset.tilePreset === 'active_topo'));
}

let _voxelScaleBase = null;
let _voxelSizeRafId = null;
let _voxelSizeCommitTimer = null;
let _pendingVoxelSize = null;
let _gridResRafId = null;
let _pendingGridRes = null;

function hasActiveAnalysisOverlays() {
    return Boolean(
        appState.lastHostGraph ||
        appState.lastFDMResult ||
        appState.lastSolidData ||
        appState.lastFEAResult ||
        (viewport.fdmGroup && viewport.fdmGroup.children.length > 0) ||
        (viewport.tubeGroup && viewport.tubeGroup.children.length > 0) ||
        (viewport.unroll3DGroup && viewport.unroll3DGroup.children.length > 0) ||
        (viewport.feaGroup && viewport.feaGroup.children.length > 0)
    );
}

export function setVoxelSize(newSizeM, opts = {}) {
    const parsed = Number(newSizeM);
    if (!Number.isFinite(parsed) || parsed <= 0.01) return appState.VOXEL_SIZE;
    const clamped = Math.max(0.05, Math.min(20.0, parsed));
    const unchanged = Math.abs(clamped - appState.VOXEL_SIZE) < 1e-6;
    if (unchanged && opts.zoom === false && !opts.forceRebuild) return appState.VOXEL_SIZE;

    appState.VOXEL_SIZE = clamped;
    appState.GRID_ORIGIN.set(-(appState.GRID_X * appState.VOXEL_SIZE) * 0.5, -(appState.GRID_Y * appState.VOXEL_SIZE) * 0.5, 0);
    syncVoxelAndEnvelopeUI();

    const hasLoadedNet = Boolean(appState.loadedFileNetworkGraph && appState.loadedFileNetworkGraph.edges && appState.loadedFileNetworkGraph.edges.length > 0);
    if (opts.interactive && !hasLoadedNet && _voxelScaleBase > 0 && viewport.meshGroup) {
        if (hasActiveAnalysisOverlays()) clearActiveAnalysisOverlaysForTopo();
        const ratio = appState.VOXEL_SIZE / _voxelScaleBase;
        viewport.meshGroup.scale.setScalar(ratio);
        if (viewport.graphGroup) viewport.graphGroup.scale.setScalar(ratio);
        if (viewport.voxelGroup) viewport.voxelGroup.scale.setScalar(ratio);
        recomputeModelBox();
        const outFooter = $('outliner-footer');
        if (outFooter) outFooter.textContent = `units: m · voxel ${Number(appState.VOXEL_SIZE.toFixed(2))} m · ${appState.GRID_X}×${appState.GRID_Y}×${appState.GRID_Z}`;
        if (viewport.requestRender) viewport.requestRender();
        if (_voxelSizeCommitTimer) clearTimeout(_voxelSizeCommitTimer);
        _voxelSizeCommitTimer = setTimeout(() => {
            _voxelSizeCommitTimer = null;
            if (_voxelScaleBase !== null && Math.abs(appState.VOXEL_SIZE - _voxelScaleBase) > 1e-6) {
                draw({ skipTileInspector: true });
            }
        }, 180);
        return appState.VOXEL_SIZE;
    }

    if (_voxelSizeCommitTimer) {
        clearTimeout(_voxelSizeCommitTimer);
        _voxelSizeCommitTimer = null;
    }
    if (hasActiveAnalysisOverlays()) clearActiveAnalysisOverlaysForTopo();
    draw({ skipTileInspector: true });
    if (opts.zoom !== false) zoomToBox(modelBoxToWorld(appState.modelBox));
    return appState.VOXEL_SIZE;
}

function scheduleVoxelSizeInteractive(newSizeM) {
    _pendingVoxelSize = newSizeM;
    if (_voxelSizeRafId !== null) return;
    _voxelSizeRafId = requestAnimationFrame(() => {
        _voxelSizeRafId = null;
        if (_pendingVoxelSize !== null) {
            const val = _pendingVoxelSize;
            _pendingVoxelSize = null;
            setVoxelSize(val, { zoom: false, interactive: true });
        }
    });
}

function scheduleGridResolution(nx, ny, nz) {
    _pendingGridRes = [nx, ny, nz];
    if (_gridResRafId !== null) return;
    _gridResRafId = requestAnimationFrame(() => {
        _gridResRafId = null;
        if (_pendingGridRes) {
            const [gx, gy, gz] = _pendingGridRes;
            _pendingGridRes = null;
            setGridResolution(gx, gy, gz);
        }
    });
}

export function setGridResolution(nx, ny = nx, nz = nx, opts = {}) {
    const clampDim = v => Math.max(1, Math.min(20, Math.round(Number(v) || 1)));
    appState.GRID_X = clampDim(nx);
    appState.GRID_Y = clampDim(ny);
    appState.GRID_Z = clampDim(nz);
    appState.GRID_ORIGIN.set(-(appState.GRID_X * appState.VOXEL_SIZE) * 0.5, -(appState.GRID_Y * appState.VOXEL_SIZE) * 0.5, 0);
    appState.loadedFileNetworkGraph = null;
    if (appState.voxelPins instanceof Map) {
        for (const [k, pin] of appState.voxelPins.entries()) {
            if (!inGridBounds(pin.x, pin.y, pin.z)) appState.voxelPins.delete(k);
        }
        updateVoxelPinsUI();
    }
    syncVoxelAndEnvelopeUI();
    clearActiveAnalysisOverlaysForTopo();
    setup({ collapseAll: opts.collapseAll !== false, seedTile: opts.seedTile });
    draw();
    if (opts.zoom !== false) zoomToBox(modelBoxToWorld(appState.modelBox));
    if (actions.recordChainStep) {
        actions.recordChainStep('grid_config', {
            x: appState.GRID_X,
            y: appState.GRID_Y,
            z: appState.GRID_Z,
            voxelSize: appState.VOXEL_SIZE,
            algorithm: appState.currentAlgorithm
        }, { label: `Grid ${appState.GRID_X}×${appState.GRID_Y}×${appState.GRID_Z}` });
    }
}

const inGridBounds = (x, y, z) => x >= 0 && x < appState.GRID_X && y >= 0 && y < appState.GRID_Y && z >= 0 && z < appState.GRID_Z;
const voxelIndex = (x, y, z) => x + y * appState.GRID_X + z * appState.GRID_X * appState.GRID_Y;

function ensureVoxelPinsMap() {
    if (!(appState.voxelPins instanceof Map)) {
        appState.voxelPins = new Map();
    }
    return appState.voxelPins;
}

export function resolveVoxelPinTileId(tileSpec) {
    if (tileSpec === null || tileSpec === undefined) return TILE_NULL;
    if (typeof tileSpec === 'number') {
        const idx = Math.round(tileSpec);
        if (idx >= 0 && idx < appState.TILES.length) return idx;
        throw new Error(`Voxel pin tile id ${tileSpec} out of range (0..${appState.TILES.length - 1})`);
    }
    const raw = String(tileSpec).trim();
    const lower = raw.toLowerCase();
    if (!lower || lower === 'null' || lower === 'tile_null' || lower === 'empty' || lower === 'void' || lower === 'none') {
        return TILE_NULL;
    }
    if (/^\d+$/.test(raw)) {
        const idx = parseInt(raw, 10);
        if (idx >= 0 && idx < appState.TILES.length) return idx;
        throw new Error(`Voxel pin tile id ${raw} out of range (0..${appState.TILES.length - 1})`);
    }
    const found = appState.TILES.find(t =>
        String(t.key || '').toLowerCase() === lower ||
        String(t.short || '').toLowerCase() === lower ||
        String(t.name || '').toLowerCase() === lower
    );
    if (found) return found.id;
    throw new Error(`Unknown voxel pin tile specifier: ${tileSpec}`);
}

export function updateVoxelPinsUI() {
    const pinsMap = ensureVoxelPinsMap();
    const count = pinsMap.size;
    const badge = $('topo-voxel-pins-badge');
    if (badge) {
        badge.textContent = count === 1 ? '1 pin' : `${count} pins`;
        badge.className = count > 0
            ? 'text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-amber-950/70 border border-amber-500/50 text-amber-300 font-semibold'
            : 'text-[9.5px] font-mono px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400';
    }
    const btnClear = $('btn-clear-voxel-pins');
    if (btnClear) {
        btnClear.classList.toggle('hidden', count === 0);
    }
}

export function getVoxelPins() {
    const pinsMap = ensureVoxelPinsMap();
    const list = [];
    for (const pin of pinsMap.values()) {
        if (!inGridBounds(pin.x, pin.y, pin.z)) continue;
        list.push({
            x: pin.x,
            y: pin.y,
            z: pin.z,
            tile: pin.tileId === TILE_NULL ? 'null' : pin.tileId,
            tileId: pin.tileId,
            tileName: appState.TILES[pin.tileId]?.name || (pin.tileId === TILE_NULL ? 'Null' : String(pin.tileId)),
        });
    }
    return list;
}

export function setVoxelPins(pins = [], opts = {}) {
    const pinsMap = ensureVoxelPinsMap();
    if (opts.replace) {
        pinsMap.clear();
        for (const v of appState.voxels) v.pinned = false;
    }
    if (!Array.isArray(pins)) {
        throw new Error('voxelPins must be an array of { x, y, z, tile }');
    }
    const appliedIndices = [];
    for (const rawPin of pins) {
        if (!rawPin || typeof rawPin !== 'object') {
            throw new Error('Each voxel pin must be an object { x, y, z, tile }');
        }
        const x = Math.round(Number(rawPin.x));
        const y = Math.round(Number(rawPin.y));
        const z = Math.round(Number(rawPin.z));
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !inGridBounds(x, y, z)) {
            throw new Error(`Voxel pin (${rawPin.x},${rawPin.y},${rawPin.z}) is outside grid ${appState.GRID_X}x${appState.GRID_Y}x${appState.GRID_Z}`);
        }
        const tileId = resolveVoxelPinTileId(rawPin.tile);
        const key = `${x},${y},${z}`;
        pinsMap.set(key, { x, y, z, tileId });
        const idx = voxelIndex(x, y, z);
        if (appState.voxels[idx]) {
            collapseVoxelTo(idx, tileId);
            appState.voxels[idx].pinned = true;
            appliedIndices.push(idx);
        }
    }
    if (appliedIndices.length > 0 && appState.currentAlgorithm === 'wfc') {
        propagateWFC(appliedIndices);
    }
    updateVoxelPinsUI();
    if (opts.redraw !== false) {
        clearActiveAnalysisOverlaysForTopo();
        draw();
    } else {
        updateSimUI();
    }
    return getVoxelPins();
}

export function clearVoxelPins(opts = {}) {
    const pinsMap = ensureVoxelPinsMap();
    pinsMap.clear();
    for (const v of appState.voxels) v.pinned = false;
    updateVoxelPinsUI();
    if (opts.redraw) {
        clearActiveAnalysisOverlaysForTopo();
        draw();
    } else {
        updateSimUI();
    }
    return [];
}
export const voxelCenter = (x, y, z) => new THREE.Vector3(
    appState.GRID_ORIGIN.x + (x + 0.5) * appState.VOXEL_SIZE,
    appState.GRID_ORIGIN.y + (y + 0.5) * appState.VOXEL_SIZE,
    appState.GRID_ORIGIN.z + (z + 0.5) * appState.VOXEL_SIZE
);

export function syncAdjRulesSize() {
    const { TILES, adjRules } = appState;
    const n = TILES.length;
    const prevN = adjRules[0] ? adjRules[0].length : 0;
    if (prevN === n) return;
    const next = createEmptyAdjRules(n);
    const copyN = Math.min(prevN, n);
    for (let axis = 0; axis < 3; axis++) {
        const posDir = axis * 2, negDir = axis * 2 + 1;
        for (let a = 0; a < n; a++) {
            for (let b = 0; b < n; b++) {
                next[axis][a][b] = (a < copyN && b < copyN) ? adjRules[axis][a][b] : (TILES[a].sockets[posDir] === TILES[b].sockets[negDir]);
            }
        }
    }
    appState.adjRules = next;
}

export function resetSocketAdjacencyRules() {
    const { TILES } = appState;
    const n = TILES.length;
    const next = createEmptyAdjRules(n);
    for (let axis = 0; axis < 3; axis++) {
        const posDir = axis * 2, negDir = axis * 2 + 1;
        for (let a = 0; a < n; a++) {
            for (let b = 0; b < n; b++) next[axis][a][b] = (TILES[a].sockets[posDir] === TILES[b].sockets[negDir]);
        }
    }
    appState.adjRules = next;
}

export function allowAllAdjacencyRules() {
    const n = appState.TILES.length;
    const next = createEmptyAdjRules(n);
    for (let axis = 0; axis < 3; axis++) {
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) next[axis][a][b] = true;
    }
    appState.adjRules = next;
}

function isAdjacentAllowed(tileA, tileB, dirIdx) {
    const { TILES, adjRules } = appState;
    if (!TILES[tileA] || !TILES[tileB] || !TILES[tileA].enabled || !TILES[tileB].enabled) return false;
    const d = DIRS[dirIdx];
    return d.sign === 1
        ? !!(adjRules[d.axis][tileA] && adjRules[d.axis][tileA][tileB])
        : !!(adjRules[d.axis][tileB] && adjRules[d.axis][tileB][tileA]);
}

function getRuleLookupInfo(tileA, tileB, dirIdx) {
    const { TILES, adjRules } = appState;
    const d = DIRS[dirIdx];
    const rowA = d.sign === 1 ? tileA : tileB;
    const colB = d.sign === 1 ? tileB : tileA;
    const allowed = !!(TILES[tileA] && TILES[tileB] && TILES[tileA].enabled && TILES[tileB].enabled && adjRules[d.axis][rowA] && adjRules[d.axis][rowA][colB]);
    return { axis: d.axis, rowA, colB, allowed, dirIdx, dirName: d.name };
}

export function clearSubstepTrace() {
    appState.substepQueue = [];
    appState.substepCursor = 0;
    appState.currentSubstep = null;
    clearGroup(viewport.substepGroup);
}

function pickDefaultSeedTile(preferredTileId = null) {
    const { TILES, inspectedTileId } = appState;
    if (preferredTileId !== null && preferredTileId !== undefined && TILES[preferredTileId] && preferredTileId !== TILE_NULL && TILES[preferredTileId].enabled) return preferredTileId;
    const customActive = TILES.find(t => t.isCustomGraph && t.enabled);
    if (customActive) return customActive.id;
    if (TILES[inspectedTileId] && inspectedTileId !== TILE_NULL && TILES[inspectedTileId].enabled) return inspectedTileId;
    const specialActive = TILES.find((t, idx) => idx > 3 && t.enabled);
    if (specialActive) return specialActive.id;
    if (TILES[TILE_CROSS] && TILES[TILE_CROSS].enabled) return TILE_CROSS;
    return TILES.findIndex((t, idx) => idx > 0 && t.enabled);
}

function collapseVoxelTo(idx, tileId) {
    const cell = appState.voxels[idx];
    cell.collapsed = true;
    cell.tile = tileId;
    cell.domain = Array(appState.TILES.length).fill(false);
    cell.domain[tileId] = true;
    cell.inFrontier = false;
    if (tileId !== TILE_NULL) {
        for (let d = 0; d < 6; d++) {
            const nx = cell.x + DIRS[d].dx, ny = cell.y + DIRS[d].dy, nz = cell.z + DIRS[d].dz;
            if (inGridBounds(nx, ny, nz)) {
                const nIdx = voxelIndex(nx, ny, nz);
                const nCell = appState.voxels[nIdx];
                if (!nCell.collapsed && !nCell.inFrontier) {
                    nCell.inFrontier = true;
                    appState.growthFrontier.push(nIdx);
                }
            }
        }
    }
}

function weightedRandomTile(candidates) {
    let totalWeight = 0;
    for (const t of candidates) totalWeight += appState.TILES[t].weight;
    let r = Math.random() * totalWeight;
    for (const t of candidates) {
        r -= appState.TILES[t].weight;
        if (r <= 0) return t;
    }
    return candidates[candidates.length - 1];
}

export function initVoxelGrid(preferredSeedTile = null) {
    const { GRID_X, GRID_Y, GRID_Z, TILES } = appState;
    appState.voxels = [];
    appState.growthFrontier = [];
    appState.simStepCount = 0;
    clearSubstepTrace();
    const enabledDomain = TILES.map(t => t.enabled);
    for (let z = 0; z < GRID_Z; z++) {
        for (let y = 0; y < GRID_Y; y++) {
            for (let x = 0; x < GRID_X; x++) {
                appState.voxels.push({ x, y, z, idx: voxelIndex(x, y, z), collapsed: false, tile: null, domain: [...enabledDomain], inFrontier: false, pinned: false });
            }
        }
    }
    const pinsMap = ensureVoxelPinsMap();
    const pinnedIndices = [];
    let hasNonNullPin = false;
    for (const pin of pinsMap.values()) {
        if (!inGridBounds(pin.x, pin.y, pin.z)) continue;
        const pIdx = voxelIndex(pin.x, pin.y, pin.z);
        const safeTileId = (pin.tileId >= 0 && pin.tileId < TILES.length) ? pin.tileId : TILE_NULL;
        if (appState.voxels[pIdx]) {
            collapseVoxelTo(pIdx, safeTileId);
            appState.voxels[pIdx].pinned = true;
            pinnedIndices.push(pIdx);
            if (safeTileId !== TILE_NULL) hasNonNullPin = true;
        }
    }
    if (pinnedIndices.length > 0) {
        appState.simStepCount += pinnedIndices.length;
        if (appState.currentAlgorithm === 'wfc') propagateWFC(pinnedIndices);
    }
    updateVoxelPinsUI();

    const cx = Math.floor(GRID_X / 2), cy = Math.floor(GRID_Y / 2), cz = Math.floor(GRID_Z / 2);
    let seedIdx = voxelIndex(cx, cy, cz);
    if (appState.voxels[seedIdx] && appState.voxels[seedIdx].pinned) {
        seedIdx = -1;
        if (!hasNonNullPin) {
            let bestDist = Infinity;
            for (const v of appState.voxels) {
                if (v.pinned || v.collapsed) continue;
                const d = Math.hypot(v.x - cx, v.y - cy, v.z - cz);
                if (d < bestDist) {
                    bestDist = d;
                    seedIdx = v.idx;
                }
            }
        }
    }
    const seedTile = pickDefaultSeedTile(preferredSeedTile);
    if (seedIdx !== -1 && seedTile !== -1 && appState.voxels[seedIdx] && !appState.voxels[seedIdx].pinned) {
        collapseVoxelTo(seedIdx, seedTile);
        appState.simStepCount++;
        if (appState.currentAlgorithm === 'wfc') propagateWFC([seedIdx]);
    }
}

export function collapseFullGridImmediate(preferredSeedTile = null) {
    initVoxelGrid(preferredSeedTile);
    const maxIters = appState.voxels.length + 16;
    for (let it = 0; it < maxIters; it++) {
        if (!stepAlgorithmOnce()) break;
    }
    const chosenSeed = pickDefaultSeedTile(preferredSeedTile);
    if (chosenSeed > 0 && !appState.voxels.some(v => v.collapsed && v.tile !== null && v.tile !== TILE_NULL)) {
        const cIdx = voxelIndex(Math.floor(appState.GRID_X / 2), Math.floor(appState.GRID_Y / 2), Math.floor(appState.GRID_Z / 2));
        const fallbackCell = (appState.voxels[cIdx] && !appState.voxels[cIdx].pinned)
            ? appState.voxels[cIdx]
            : appState.voxels.find(v => !v.pinned);
        if (fallbackCell) {
            fallbackCell.collapsed = true;
            fallbackCell.tile = chosenSeed;
        }
    }
    appState.simRunning = false;
}

function stepAdjacencyGrowth() {
    const { voxels, TILES } = appState;
    appState.growthFrontier = appState.growthFrontier.filter(i => !voxels[i].collapsed);
    if (appState.growthFrontier.length === 0) {
        const uncollapsed = voxels.filter(v => !v.collapsed);
        if (uncollapsed.length === 0) return false;
        const pick = uncollapsed[Math.floor(Math.random() * uncollapsed.length)];
        appState.growthFrontier.push(pick.idx);
        pick.inFrontier = true;
    }
    const fPos = Math.floor(Math.random() * appState.growthFrontier.length);
    const cellIdx = appState.growthFrontier.splice(fPos, 1)[0];
    const cell = voxels[cellIdx];
    cell.inFrontier = false;

    const validTiles = [];
    for (let t = 0; t < TILES.length; t++) {
        if (!TILES[t].enabled) continue;
        let ok = true;
        for (let d = 0; d < 6; d++) {
            const nx = cell.x + DIRS[d].dx, ny = cell.y + DIRS[d].dy, nz = cell.z + DIRS[d].dz;
            if (inGridBounds(nx, ny, nz)) {
                const nCell = voxels[voxelIndex(nx, ny, nz)];
                if (nCell.collapsed && nCell.tile !== null && !isAdjacentAllowed(t, nCell.tile, d)) { ok = false; break; }
            }
        }
        if (ok) validTiles.push(t);
    }
    const nonNullValid = validTiles.filter(t => t !== TILE_NULL);
    const pool = (nonNullValid.length > 0 && Math.random() < 0.72) ? nonNullValid : validTiles;
    collapseVoxelTo(cellIdx, pool.length > 0 ? weightedRandomTile(pool) : TILE_NULL);
    appState.simStepCount++;
    return true;
}

function propagateWFC(seedQueue) {
    const { voxels, TILES } = appState;
    const stack = [...seedQueue];
    while (stack.length > 0) {
        const currIdx = stack.pop();
        const curr = voxels[currIdx];
        const currPossible = [];
        for (let t = 0; t < TILES.length; t++) if (curr.domain[t]) currPossible.push(t);
        if (currPossible.length === 0) continue;
        for (let d = 0; d < 6; d++) {
            const nx = curr.x + DIRS[d].dx, ny = curr.y + DIRS[d].dy, nz = curr.z + DIRS[d].dz;
            if (!inGridBounds(nx, ny, nz)) continue;
            const nIdx = voxelIndex(nx, ny, nz);
            const neighbor = voxels[nIdx];
            if (neighbor.collapsed) continue;
            let changed = false;
            for (let nt = 0; nt < TILES.length; nt++) {
                if (!neighbor.domain[nt]) continue;
                let supported = false;
                for (let i = 0; i < currPossible.length; i++) {
                    if (isAdjacentAllowed(currPossible[i], nt, d)) { supported = true; break; }
                }
                if (!supported) { neighbor.domain[nt] = false; changed = true; }
            }
            if (changed) stack.push(nIdx);
        }
    }
}

function stepWFC() {
    const { voxels, TILES } = appState;
    let minEntropy = Infinity, candidates = [];
    for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];
        if (v.collapsed) continue;
        let count = 0;
        for (let t = 0; t < TILES.length; t++) if (v.domain[t] && TILES[t].enabled) count++;
        if (count === 0) { collapseVoxelTo(i, TILE_NULL); appState.simStepCount++; return true; }
        let hasCollapsedNeighbor = false;
        for (let d = 0; d < 6; d++) {
            const nx = v.x + DIRS[d].dx, ny = v.y + DIRS[d].dy, nz = v.z + DIRS[d].dz;
            if (inGridBounds(nx, ny, nz)) {
                const nb = voxels[voxelIndex(nx, ny, nz)];
                if (nb.collapsed && nb.tile !== TILE_NULL) { hasCollapsedNeighbor = true; break; }
            }
        }
        const score = count - (hasCollapsedNeighbor ? 0.35 : 0);
        if (score < minEntropy - 1e-6) { minEntropy = score; candidates = [i]; }
        else if (Math.abs(score - minEntropy) <= 1e-6) candidates.push(i);
    }
    if (candidates.length === 0) return false;
    const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
    const cell = voxels[pickIdx];
    const validTiles = [];
    for (let t = 0; t < TILES.length; t++) if (cell.domain[t] && TILES[t].enabled) validTiles.push(t);
    collapseVoxelTo(pickIdx, validTiles.length > 0 ? weightedRandomTile(validTiles) : TILE_NULL);
    propagateWFC([pickIdx]);
    appState.simStepCount++;
    return true;
}

function buildGrowthSubsteps() {
    const { voxels, TILES, currentRuleAxis } = appState;
    appState.growthFrontier = appState.growthFrontier.filter(i => !voxels[i].collapsed);
    if (appState.growthFrontier.length === 0) {
        const uncollapsed = voxels.filter(v => !v.collapsed);
        if (uncollapsed.length === 0) return [];
        const pick = uncollapsed[Math.floor(Math.random() * uncollapsed.length)];
        appState.growthFrontier.push(pick.idx);
        pick.inFrontier = true;
    }
    const fPos = Math.floor(Math.random() * appState.growthFrontier.length);
    const cellIdx = appState.growthFrontier.splice(fPos, 1)[0];
    const cell = voxels[cellIdx];
    cell.inFrontier = false;

    const events = [], validTiles = [];
    for (let t = 0; t < TILES.length; t++) {
        if (!TILES[t].enabled) continue;
        let ok = true;
        for (let d = 0; d < 6; d++) {
            const nx = cell.x + DIRS[d].dx, ny = cell.y + DIRS[d].dy, nz = cell.z + DIRS[d].dz;
            if (inGridBounds(nx, ny, nz)) {
                const nIdx = voxelIndex(nx, ny, nz);
                const nCell = voxels[nIdx];
                if (nCell.collapsed && nCell.tile !== null) {
                    const lookup = getRuleLookupInfo(t, nCell.tile, d);
                    const axisName = ['X', 'Y', 'Z'][lookup.axis];
                    events.push({
                        type: 'growth_lookup', srcIdx: cellIdx, dstIdx: nIdx, dirIdx: d, candidateTile: t, neighborTile: nCell.tile,
                        axis: lookup.axis, rulesChecked: [{ rowA: lookup.rowA, colB: lookup.colB, allowed: lookup.allowed }],
                        allowed: lookup.allowed,
                        ruleText: `Rule ${axisName}[${TILES[lookup.rowA].short} → ${TILES[lookup.colB].short}] = ${lookup.allowed ? '1 (ALLOW)' : '0 (DENY)'}`,
                        desc: `Test ${TILES[t].short} at (${cell.x},${cell.y},${cell.z}) vs ${DIRS[d].name} neighbor (${nCell.x},${nCell.y},${nCell.z}) [${TILES[nCell.tile].short}]`
                    });
                    if (!lookup.allowed) { ok = false; break; }
                }
            }
        }
        if (ok) validTiles.push(t);
    }
    const nonNullValid = validTiles.filter(t => t !== TILE_NULL);
    const pool = (nonNullValid.length > 0 && Math.random() < 0.72) ? nonNullValid : validTiles;
    const chosenTile = pool.length > 0 ? weightedRandomTile(pool) : TILE_NULL;
    events.push({
        type: 'collapse', srcIdx: cellIdx, dstIdx: null, chosenTile, candidateTile: chosenTile,
        axis: currentRuleAxis, rulesChecked: [], allowed: true,
        ruleText: `Collapse (${cell.x},${cell.y},${cell.z}) → ${TILES[chosenTile].name}`,
        desc: `Compatible tiles: [${validTiles.map(id => TILES[id].short).join(', ') || 'none'}] → Selected ${TILES[chosenTile].short}`
    });
    return events;
}

function buildWFCSubsteps() {
    const { voxels, TILES, currentRuleAxis } = appState;
    let minEntropy = Infinity, candidates = [];
    for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];
        if (v.collapsed) continue;
        let count = 0;
        for (let t = 0; t < TILES.length; t++) if (v.domain[t] && TILES[t].enabled) count++;
        if (count === 0) {
            return [{
                type: 'collapse', srcIdx: i, dstIdx: null, chosenTile: TILE_NULL, candidateTile: TILE_NULL,
                axis: currentRuleAxis, rulesChecked: [], allowed: false,
                ruleText: `Contradiction at (${v.x},${v.y},${v.z}) → Fallback NUL`,
                desc: 'Domain empty (0 valid tiles) → Resolved to Null'
            }];
        }
        let hasCollapsedNeighbor = false;
        for (let d = 0; d < 6; d++) {
            const nx = v.x + DIRS[d].dx, ny = v.y + DIRS[d].dy, nz = v.z + DIRS[d].dz;
            if (inGridBounds(nx, ny, nz)) {
                const nb = voxels[voxelIndex(nx, ny, nz)];
                if (nb.collapsed && nb.tile !== TILE_NULL) { hasCollapsedNeighbor = true; break; }
            }
        }
        const score = count - (hasCollapsedNeighbor ? 0.35 : 0);
        if (score < minEntropy - 1e-6) { minEntropy = score; candidates = [i]; }
        else if (Math.abs(score - minEntropy) <= 1e-6) candidates.push(i);
    }
    if (candidates.length === 0) return [];
    const pickIdx = candidates[Math.floor(Math.random() * candidates.length)];
    const cell = voxels[pickIdx];
    const validTiles = [];
    for (let t = 0; t < TILES.length; t++) if (cell.domain[t] && TILES[t].enabled) validTiles.push(t);
    const chosenTile = validTiles.length > 0 ? weightedRandomTile(validTiles) : TILE_NULL;

    const shadowDomains = voxels.map(v => [...v.domain]);
    const shadowCollapsed = voxels.map(v => v.collapsed);
    shadowCollapsed[pickIdx] = true;
    shadowDomains[pickIdx] = Array(TILES.length).fill(false);
    shadowDomains[pickIdx][chosenTile] = true;

    const events = [{
        type: 'collapse', srcIdx: pickIdx, dstIdx: null, chosenTile, candidateTile: chosenTile,
        axis: currentRuleAxis, rulesChecked: [], allowed: true,
        ruleText: `Min-Entropy Collapse (${cell.x},${cell.y},${cell.z}) → ${TILES[chosenTile].short}`,
        desc: `Superposition [${validTiles.map(id => TILES[id].short).join(', ')}] collapsed to ${TILES[chosenTile].name}`
    }];

    const stack = [pickIdx];
    while (stack.length > 0) {
        const currIdx = stack.pop();
        const curr = voxels[currIdx];
        const currPossible = [];
        for (let t = 0; t < TILES.length; t++) if (shadowDomains[currIdx][t]) currPossible.push(t);
        if (currPossible.length === 0) continue;
        for (let d = 0; d < 6; d++) {
            const nx = curr.x + DIRS[d].dx, ny = curr.y + DIRS[d].dy, nz = curr.z + DIRS[d].dz;
            if (!inGridBounds(nx, ny, nz)) continue;
            const nIdx = voxelIndex(nx, ny, nz);
            if (shadowCollapsed[nIdx]) continue;
            let changed = false;
            for (let nt = 0; nt < TILES.length; nt++) {
                if (!shadowDomains[nIdx][nt]) continue;
                const checks = [];
                let supported = false;
                for (let i = 0; i < currPossible.length; i++) {
                    const lookup = getRuleLookupInfo(currPossible[i], nt, d);
                    checks.push({ rowA: lookup.rowA, colB: lookup.colB, allowed: lookup.allowed });
                    if (lookup.allowed) supported = true;
                }
                const axis = DIRS[d].axis;
                const axisName = ['X', 'Y', 'Z'][axis];
                const firstCheck = checks[0] || { rowA: chosenTile, colB: nt, allowed: supported };
                if (!supported) { shadowDomains[nIdx][nt] = false; changed = true; }
                events.push({
                    type: 'wfc_prop', srcIdx: currIdx, dstIdx: nIdx, dirIdx: d, candidateTile: nt, axis,
                    rulesChecked: checks, allowed: supported, prunedTile: !supported ? nt : null,
                    ruleText: `Rule ${axisName}[${TILES[firstCheck.rowA].short} → ${TILES[firstCheck.colB].short}] = ${supported ? '1 (KEEP ' + TILES[nt].short + ')' : '0 (PRUNE ' + TILES[nt].short + ')'}`,
                    desc: `Propagate ${DIRS[d].name} (${curr.x},${curr.y},${curr.z})→(${nx},${ny},${nz}): test neighbor ${TILES[nt].short} (${supported ? 'supported' : 'eliminated'})`
                });
            }
            if (changed) stack.push(nIdx);
        }
    }
    return events;
}

export function stepSubstepOnce() {
    if (appState.substepQueue.length === 0 || appState.substepCursor >= appState.substepQueue.length) {
        appState.substepQueue = appState.currentAlgorithm === 'growth' ? buildGrowthSubsteps() : buildWFCSubsteps();
        appState.substepCursor = 0;
        if (appState.substepQueue.length === 0) { appState.currentSubstep = null; return false; }
    }
    const ev = appState.substepQueue[appState.substepCursor++];
    appState.currentSubstep = ev;
    if (ev.type === 'collapse') {
        collapseVoxelTo(ev.srcIdx, ev.chosenTile);
        appState.simStepCount++;
    } else if (ev.type === 'wfc_prop' && ev.prunedTile !== null && ev.prunedTile !== undefined) {
        appState.voxels[ev.dstIdx].domain[ev.prunedTile] = false;
    }
    if (ev.axis !== undefined && ev.axis !== appState.currentRuleAxis) {
        appState.currentRuleAxis = ev.axis;
        $$('.axis-btn').forEach(b => b.classList.toggle('seg-on', parseInt(b.dataset.axis, 10) === appState.currentRuleAxis));
    }
    renderAdjacencyMatrixUI();
    return true;
}

export function renderAdjacencyMatrixUI() {
    const containerEl = $('adj-matrix-container');
    if (!containerEl) return;
    syncAdjRulesSize();
    const { TILES, adjRules, currentRuleAxis, substepMode, currentSubstep } = appState;
    const axisNames = ['X', 'Y', 'Z'];
    const ax = currentRuleAxis;

    const activeTileIndices = [];
    for (let i = 0; i < TILES.length; i++) if (TILES[i] && TILES[i].enabled) activeTileIndices.push(i);
    if (activeTileIndices.length === 0 && TILES.length > 0) activeTileIndices.push(0);

    const activeLookups = (substepMode && currentSubstep && currentSubstep.axis === ax && currentSubstep.rulesChecked)
        ? currentSubstep.rulesChecked : [];
    const activeRows = new Set(activeLookups.map(r => r.rowA));
    const activeCols = new Set(activeLookups.map(r => r.colB));

    const useFullNames = activeTileIndices.length <= 5;
    let html = `<table class="border-collapse text-[10px] font-mono"><thead><tr><th class="p-1 text-gray-500 text-[9px]">+${axisNames[ax]}\\-${axisNames[ax]}</th>`;
    for (const b of activeTileIndices) {
        const hdrCls = activeCols.has(b) ? 'adj-hdr-active' : 'text-gray-300 font-semibold';
        const colLabel = useFullNames ? TILES[b].name.split(' ')[0] : TILES[b].short;
        html += `<th class="p-1 ${hdrCls}" title="${TILES[b].name}">${colLabel}</th>`;
    }
    html += `</tr></thead><tbody>`;
    for (const a of activeTileIndices) {
        const rowHdrCls = activeRows.has(a) ? 'adj-hdr-active' : 'text-gray-300 font-semibold';
        const rowLabel = useFullNames ? TILES[a].name : TILES[a].short;
        html += `<tr><td class="pr-1.5 text-right whitespace-nowrap ${rowHdrCls}" title="${TILES[a].name}">${rowLabel}</td>`;
        for (const b of activeTileIndices) {
            const on = adjRules[ax][a][b];
            const match = activeLookups.find(r => r.rowA === a && r.colB === b);
            const hlCls = match ? (match.allowed ? 'substep-ok' : 'substep-fail') : '';
            html += `<td data-a="${a}" data-b="${b}" class="adj-cell ${on ? 'allowed' : 'denied'} ${hlCls}" title="${TILES[a].name} (+${axisNames[ax]}) → ${TILES[b].name} (-${axisNames[ax]})">${on ? '1' : '0'}</td>`;
        }
        html += `</tr>`;
    }
    html += `</tbody></table>`;
    containerEl.innerHTML = html;

    containerEl.querySelectorAll('.adj-cell').forEach(cell => {
        cell.addEventListener('click', () => {
            const a = parseInt(cell.dataset.a, 10), b = parseInt(cell.dataset.b, 10);
            appState.adjRules[appState.currentRuleAxis][a][b] = !appState.adjRules[appState.currentRuleAxis][a][b];
            clearSubstepTrace();
            renderAdjacencyMatrixUI();
        });
    });
}

export function setup(opts = {}) {
    const customTiles = appState.TILES.filter(t => t.isCustomGraph);
    const prevBuiltinEnabled = appState.TILES.filter(t => !t.isCustomGraph).map(t => t.enabled);
    const baseTiles = CORE.createTileTemplates();
    for (let i = 0; i < Math.min(baseTiles.length, prevBuiltinEnabled.length); i++) {
        baseTiles[i].enabled = prevBuiltinEnabled[i];
    }
    appState.TILES = [...baseTiles, ...customTiles];
    appState.TILES.forEach((t, idx) => { t.id = idx; });

    if (!appState.rulesInitialized) {
        resetSocketAdjacencyRules();
        appState.rulesInitialized = true;
    } else {
        syncAdjRulesSize();
    }
    if (opts.collapseAll) collapseFullGridImmediate(opts.seedTile !== undefined ? opts.seedTile : null);
    else initVoxelGrid(opts.seedTile !== undefined ? opts.seedTile : null);

    if (actions.renderTileCatalogUI) actions.renderTileCatalogUI();
    renderAdjacencyMatrixUI();
    updateSimUI();
}

export function stepAlgorithmOnce() {
    clearSubstepTrace();
    return appState.currentAlgorithm === 'growth' ? stepAdjacencyGrowth() : stepWFC();
}

export function update(dt = 1 / 60) {
    if (!appState.simRunning) return;
    if (appState.substepMode) {
        appState.substepAccum += dt;
        if (appState.substepAccum < appState.SUBSTEP_INTERVAL) return;
        appState.substepAccum = 0;
        if (stepSubstepOnce()) draw();
        else { appState.simRunning = false; updateSimUI(); }
    } else {
        if (stepAlgorithmOnce()) draw();
        else { appState.simRunning = false; updateSimUI(); }
    }
}

export function buildWeldedGraph({ weldTol = 1e-4, mergeCollinear = appState.mergeCollinearNodes, ignoreLoadedFile = false } = {}) {
    if (!ignoreLoadedFile && appState.loadedFileNetworkGraph && appState.loadedFileNetworkGraph.edges && appState.loadedFileNetworkGraph.edges.length > 0) {
        return appState.loadedFileNetworkGraph;
    }
    const { voxels, TILES, VOXEL_SIZE } = appState;
    const invTol = 1 / Math.max(weldTol, 1e-8);
    const grid = new Map();
    const verts = [], edgeSet = new Set(), rawEdges = [];
    let rawVertexCount = 0, rawEdgeCount = 0;

    const weldPoint = (x, y, z) => {
        const gx = Math.round(x * invTol), gy = Math.round(y * invTol), gz = Math.round(z * invTol);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = grid.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
                    if (!bucket) continue;
                    for (let k = 0; k < bucket.length; k++) {
                        const idx = bucket[k], q = verts[idx];
                        const ddx = x - q[0], ddy = y - q[1], ddz = z - q[2];
                        if (ddx * ddx + ddy * ddy + ddz * ddz <= weldTol * weldTol) return idx;
                    }
                }
            }
        }
        const idx = verts.length;
        verts.push([x, y, z]);
        const key = `${gx}_${gy}_${gz}`;
        let b = grid.get(key);
        if (!b) { b = []; grid.set(key, b); }
        b.push(idx);
        return idx;
    };

    for (const v of voxels) {
        if (!v.collapsed || v.tile === null || v.tile === TILE_NULL) continue;
        const tileDef = TILES[v.tile];
        if (!tileDef || !tileDef.graph || !tileDef.graph.edges || tileDef.graph.edges.length === 0) continue;
        const center = voxelCenter(v.x, v.y, v.z);
        const tv = tileDef.graph.vertices, te = tileDef.graph.edges;
        rawVertexCount += tv.length; rawEdgeCount += te.length;
        const localMap = new Int32Array(tv.length);
        for (let j = 0; j < tv.length; j++) {
            localMap[j] = weldPoint(center.x + tv[j][0] * VOXEL_SIZE, center.y + tv[j][1] * VOXEL_SIZE, center.z + tv[j][2] * VOXEL_SIZE);
        }
        for (let j = 0; j < te.length; j++) {
            const u = localMap[te[j][0]], w = localMap[te[j][1]];
            if (u === w) continue;
            const a = Math.min(u, w), b = Math.max(u, w), key = `${a}_${b}`;
            if (!edgeSet.has(key)) { edgeSet.add(key); rawEdges.push([a, b]); }
        }
    }

    let finalVerts = verts, finalEdges = rawEdges;
    if (mergeCollinear && finalVerts.length > 0 && finalEdges.length > 0) {
        const adj = Array.from({ length: finalVerts.length }, () => new Set());
        for (const [u, w] of finalEdges) { adj[u].add(w); adj[w].add(u); }
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < finalVerts.length; i++) {
                if (adj[i].size !== 2) continue;
                const [a, b] = Array.from(adj[i]);
                if (a === b || adj[a].has(b)) continue;
                const p = finalVerts[i], pa = finalVerts[a], pb = finalVerts[b];
                const ax = pa[0] - p[0], ay = pa[1] - p[1], az = pa[2] - p[2];
                const bx = pb[0] - p[0], by = pb[1] - p[1], bz = pb[2] - p[2];
                const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
                if (la < 1e-8 || lb < 1e-8) continue;
                if ((ax * bx + ay * by + az * bz) / (la * lb) < -0.9999) {
                    adj[i].clear(); adj[a].delete(i); adj[b].delete(i); adj[a].add(b); adj[b].add(a);
                    changed = true;
                }
            }
        }
        const remap = new Int32Array(finalVerts.length).fill(-1);
        const compVerts = [];
        for (let i = 0; i < finalVerts.length; i++) {
            if (adj[i].size > 0) { remap[i] = compVerts.length; compVerts.push(finalVerts[i]); }
        }
        const compEdgeSet = new Set(), compEdges = [];
        for (let i = 0; i < finalVerts.length; i++) {
            if (remap[i] === -1) continue;
            const u = remap[i];
            for (const nb of adj[i]) {
                const w = remap[nb];
                if (u < w) {
                    const key = `${u}_${w}`;
                    if (!compEdgeSet.has(key)) { compEdgeSet.add(key); compEdges.push([u, w]); }
                }
            }
        }
        finalVerts = compVerts;
        finalEdges = compEdges;
    }

    const valences = new Array(finalVerts.length).fill(0);
    for (const [u, w] of finalEdges) { valences[u]++; valences[w]++; }
    const boundingBox = finalVerts.length > 0 ? CORE.computeBoundingBox(finalVerts) : { min: [0, 0, 0], max: [0, 0, 0] };

    return { vertices: finalVerts, edges: finalEdges, valences, rawVertexCount, rawEdgeCount, weldTol, collinearMerged: mergeCollinear, boundingBox };
}

export function draw(opts = {}) {
    if (!opts.skipTileInspector && appState.activeTabId === 'tab-tiles' && appState.tileViewMode === 'inspector' && actions.renderTileInspector3D) {
        actions.renderTileInspector3D();
    }
    if (viewport.meshGroup) viewport.meshGroup.scale.set(1, 1, 1);
    if (viewport.graphGroup) viewport.graphGroup.scale.set(1, 1, 1);
    if (viewport.voxelGroup) viewport.voxelGroup.scale.set(1, 1, 1);
    _voxelScaleBase = appState.VOXEL_SIZE;
    const { loadedFileNetworkGraph, voxels, TILES, VOXEL_SIZE, GRID_X, GRID_Y, GRID_Z, arcticOn, wireframeOn, showInactiveVoxels, showSuperposition, currentAlgorithm, substepMode, currentSubstep } = appState;
    const hasLoadedNet = !!(loadedFileNetworkGraph && loadedFileNetworkGraph.edges && loadedFileNetworkGraph.edges.length > 0);

    const positions = [], colors = [], indices = [], quadFaces = [], wirePositions = [];
    const customPreviewPos = [], customPreviewCol = [], customPreviewIdx = [], customPreviewWire = [];
    let activeQuadCount = 0;

    for (let i = 0; i < (hasLoadedNet ? 0 : voxels.length); i++) {
        const v = voxels[i];
        if (!v.collapsed || v.tile === null || v.tile === TILE_NULL) continue;
        const tileDef = TILES[v.tile];
        if (!tileDef) continue;
        const center = voxelCenter(v.x, v.y, v.z);
        const [cr, cg, cb] = tileDef.color;

        if (tileDef.quads && tileDef.quads.length > 0) {
            for (const quad of tileDef.quads) {
                const baseVertex = positions.length / 3;
                for (let k = 0; k < 4; k++) {
                    positions.push(center.x + quad[k][0] * VOXEL_SIZE, center.y + quad[k][1] * VOXEL_SIZE, center.z + quad[k][2] * VOXEL_SIZE);
                    colors.push(cr, cg, cb);
                }
                indices.push(baseVertex, baseVertex + 1, baseVertex + 2, baseVertex, baseVertex + 2, baseVertex + 3);
                quadFaces.push([baseVertex, baseVertex + 1, baseVertex + 2, baseVertex + 3]);
                for (let k = 0; k < 4; k++) {
                    const a = quad[k], b = quad[(k + 1) % 4];
                    wirePositions.push(
                        center.x + a[0] * VOXEL_SIZE, center.y + a[1] * VOXEL_SIZE, center.z + a[2] * VOXEL_SIZE,
                        center.x + b[0] * VOXEL_SIZE, center.y + b[1] * VOXEL_SIZE, center.z + b[2] * VOXEL_SIZE
                    );
                }
                activeQuadCount++;
            }
        } else if (tileDef.previewQuads && tileDef.previewQuads.length > 0) {
            for (const quad of tileDef.previewQuads) {
                const baseVertex = customPreviewPos.length / 3;
                for (let k = 0; k < 4; k++) {
                    customPreviewPos.push(center.x + quad[k][0] * VOXEL_SIZE, center.y + quad[k][1] * VOXEL_SIZE, center.z + quad[k][2] * VOXEL_SIZE);
                    customPreviewCol.push(cr, cg, cb);
                }
                customPreviewIdx.push(baseVertex, baseVertex + 1, baseVertex + 2, baseVertex, baseVertex + 2, baseVertex + 3);
                const ringN = (quad[2][0] === quad[3][0] && quad[2][1] === quad[3][1] && quad[2][2] === quad[3][2]) ? 3 : 4;
                for (let k = 0; k < ringN; k++) {
                    const a = quad[k], b = quad[(k + 1) % ringN];
                    customPreviewWire.push(
                        center.x + a[0] * VOXEL_SIZE, center.y + a[1] * VOXEL_SIZE, center.z + a[2] * VOXEL_SIZE,
                        center.x + b[0] * VOXEL_SIZE, center.y + b[1] * VOXEL_SIZE, center.z + b[2] * VOXEL_SIZE
                    );
                }
                activeQuadCount++;
            }
        }
    }

    clearGroup(viewport.meshGroup);
    appState.meshPool = [...appState.userImportedMeshes];
    appState.activeMeshEntry = null;

    if (positions.length > 0) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, arcticOn ? sharedMaterials.arctic : sharedMaterials.surface);
        mesh.userData.isTopoSurface = true;
        mesh.visible = !wireframeOn;
        viewport.meshGroup.add(mesh);
        if (wirePositions.length > 0) {
            const wireGeo = new THREE.BufferGeometry();
            wireGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wirePositions), 3));
            viewport.meshGroup.add(new THREE.LineSegments(wireGeo, sharedMaterials.quadWire));
        }
        appState.activeMeshEntry = {
            name: `Topo Quad Mesh (${activeQuadCount} quads)`,
            mesh,
            positions: new Float32Array(positions),
            indices: new Uint32Array(indices),
            quads: quadFaces,
            visible: true
        };
        appState.meshPool.unshift(appState.activeMeshEntry);
    }

    if (customPreviewPos.length > 0) {
        const cGeo = new THREE.BufferGeometry();
        cGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(customPreviewPos), 3));
        cGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(customPreviewCol), 3));
        cGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(customPreviewIdx), 1));
        cGeo.computeVertexNormals();
        const baseMat = sharedMaterials.customTilePreview || sharedMaterials.surface;
        const cMesh = new THREE.Mesh(cGeo, arcticOn ? sharedMaterials.arctic : baseMat);
        cMesh.userData.baseMaterial = baseMat;
        cMesh.userData.isTopoSurface = true;
        cMesh.visible = !wireframeOn;
        viewport.meshGroup.add(cMesh);
        if (customPreviewWire.length > 0) {
            const cwGeo = new THREE.BufferGeometry();
            cwGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(customPreviewWire), 3));
            viewport.meshGroup.add(new THREE.LineSegments(cwGeo, sharedMaterials.quadWire));
        }
    }

    clearGroup(viewport.graphGroup);
    appState.lastWeldedGraph = buildWeldedGraph({ weldTol: 1e-4, mergeCollinear: appState.mergeCollinearNodes });
    if (appState.lastWeldedGraph.edges.length > 0) {
        const gPos = new Float32Array(appState.lastWeldedGraph.edges.length * 6);
        for (let i = 0; i < appState.lastWeldedGraph.edges.length; i++) {
            const [u, w] = appState.lastWeldedGraph.edges[i];
            const p0 = appState.lastWeldedGraph.vertices[u], p1 = appState.lastWeldedGraph.vertices[w];
            const o = i * 6;
            gPos[o] = p0[0]; gPos[o + 1] = p0[1]; gPos[o + 2] = p0[2];
            gPos[o + 3] = p1[0]; gPos[o + 4] = p1[1]; gPos[o + 5] = p1[2];
        }
        const gLines = makeFatLineSegments(
            gPos,
            makeFatMaterial(0xef4444, appState.edgeDisplayWidthPx || 1.5, {
                disposeOnClear: true,
                transparent: true,
                opacity: 0.92,
                depthTest: false
            })
        );
        gLines.renderOrder = 10;
        viewport.graphGroup.add(gLines);

        if (appState.lastWeldedGraph.vertices.length > 0 && appState.lastWeldedGraph.edges.length <= 600) {
            const nScale = Math.max(0.18, Math.min(0.85, 2.8 / Math.sqrt(Math.max(8, appState.lastWeldedGraph.vertices.length)))) * (appState.nodeDisplayScale || 1.0);
            const instNodes = new THREE.InstancedMesh(sharedGeometries.graphNode, sharedMaterials.graphNode, appState.lastWeldedGraph.vertices.length);
            const dummy = new THREE.Object3D();
            for (let i = 0; i < appState.lastWeldedGraph.vertices.length; i++) {
                const p = appState.lastWeldedGraph.vertices[i];
                dummy.position.set(p[0], p[1], p[2]);
                dummy.scale.setScalar(nScale);
                dummy.updateMatrix();
                instNodes.setMatrixAt(i, dummy.matrix);
            }
            instNodes.instanceMatrix.needsUpdate = true;
            instNodes.renderOrder = 11;
            viewport.graphGroup.add(instNodes);
        }
    }

    clearGroup(viewport.voxelGroup);
    if (showInactiveVoxels && !hasLoadedNet) {
        const inactiveWirePos = [], frontierWirePos = [], superposCenters = [];
        const hs = VOXEL_SIZE * 0.5;
        const boxEdges = [
            [-hs,-hs,-hs,  hs,-hs,-hs], [ hs,-hs,-hs,  hs, hs,-hs], [ hs, hs,-hs, -hs, hs,-hs], [-hs, hs,-hs, -hs,-hs,-hs],
            [-hs,-hs, hs,  hs,-hs, hs], [ hs,-hs, hs,  hs, hs, hs], [ hs, hs, hs, -hs, hs, hs], [-hs, hs, hs, -hs,-hs, hs],
            [-hs,-hs,-hs, -hs,-hs, hs], [ hs,-hs,-hs,  hs,-hs, hs], [ hs, hs,-hs,  hs, hs, hs], [-hs, hs,-hs, -hs, hs, hs]
        ];
        for (const v of voxels) {
            if (v.collapsed && v.tile !== null && v.tile !== TILE_NULL) continue;
            const c = voxelCenter(v.x, v.y, v.z);
            let possibleCount = 0;
            if (!v.collapsed) {
                for (let t = 0; t < TILES.length; t++) if (v.domain[t] && TILES[t].enabled) possibleCount++;
            }
            const isConstrainedWFC = (!v.collapsed && currentAlgorithm === 'wfc' && possibleCount > 0 && possibleCount < TILES.length);
            const isGrowthFrontier = (!v.collapsed && currentAlgorithm === 'growth' && v.inFrontier);
            if (isConstrainedWFC || isGrowthFrontier) {
                for (const ed of boxEdges) frontierWirePos.push(c.x + ed[0], c.y + ed[1], c.z + ed[2], c.x + ed[3], c.y + ed[4], c.z + ed[5]);
                if (showSuperposition && !v.collapsed) superposCenters.push({ center: c, count: possibleCount });
            } else if (!v.collapsed && (v.x === 0 || v.x === GRID_X - 1 || v.y === 0 || v.y === GRID_Y - 1 || v.z === 0 || v.z === GRID_Z - 1)) {
                for (const ed of boxEdges) inactiveWirePos.push(c.x + ed[0], c.y + ed[1], c.z + ed[2], c.x + ed[3], c.y + ed[4], c.z + ed[5]);
            }
        }
        if (inactiveWirePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(inactiveWirePos), 3));
            viewport.voxelGroup.add(new THREE.LineSegments(geo, sharedMaterials.inactiveGrid));
        }
        if (frontierWirePos.length > 0) {
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(frontierWirePos), 3));
            viewport.voxelGroup.add(new THREE.LineSegments(geo, sharedMaterials.frontierGrid));
        }
        if (showSuperposition && superposCenters.length > 0) {
            const baseGeo = new THREE.BoxGeometry(0.32, 0.32, 0.32);
            const instMesh = new THREE.InstancedMesh(baseGeo, sharedMaterials.superpos, superposCenters.length);
            const dummy = new THREE.Object3D();
            for (let i = 0; i < superposCenters.length; i++) {
                const item = superposCenters[i];
                dummy.position.copy(item.center);
                const s = 0.4 + 0.2 * item.count;
                dummy.scale.set(s, s, s);
                dummy.updateMatrix();
                instMesh.setMatrixAt(i, dummy.matrix);
            }
            instMesh.instanceMatrix.needsUpdate = true;
            viewport.voxelGroup.add(instMesh);
        }
    }

    clearGroup(viewport.substepGroup);
    if (substepMode && currentSubstep) {
        const ev = currentSubstep;
        const hs = VOXEL_SIZE * 0.51;
        const boxEdges = [
            [-hs,-hs,-hs,  hs,-hs,-hs], [ hs,-hs,-hs,  hs, hs,-hs], [ hs, hs,-hs, -hs, hs,-hs], [-hs, hs,-hs, -hs,-hs,-hs],
            [-hs,-hs, hs,  hs,-hs, hs], [ hs,-hs, hs,  hs, hs, hs], [ hs, hs, hs, -hs, hs, hs], [-hs, hs, hs, -hs,-hs, hs],
            [-hs,-hs,-hs, -hs,-hs, hs], [ hs,-hs,-hs,  hs,-hs, hs], [ hs, hs,-hs,  hs, hs, hs], [-hs, hs,-hs, -hs, hs, hs]
        ];
        const addVoxelHighlightBox = (vIdx, mat, scale = 1.0) => {
            const v = voxels[vIdx];
            if (!v) return null;
            const c = voxelCenter(v.x, v.y, v.z);
            const pos = [];
            for (const ed of boxEdges) pos.push(c.x + ed[0] * scale, c.y + ed[1] * scale, c.z + ed[2] * scale, c.x + ed[3] * scale, c.y + ed[4] * scale, c.z + ed[5] * scale);
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
            viewport.substepGroup.add(new THREE.LineSegments(geo, mat));
            return c;
        };
        const srcCenter = addVoxelHighlightBox(ev.srcIdx, sharedMaterials.subSrcBox, 1.02);
        if (ev.dstIdx !== null && ev.dstIdx !== undefined) {
            const dstCenter = addVoxelHighlightBox(ev.dstIdx, ev.allowed ? sharedMaterials.subDstOk : sharedMaterials.subDstFail, 0.96);
            if (srcCenter && dstCenter) {
                const dirVec = new THREE.Vector3().subVectors(dstCenter, srcCenter);
                const len = dirVec.length();
                if (len > 1e-4) {
                    dirVec.normalize();
                    viewport.substepGroup.add(new THREE.ArrowHelper(dirVec, srcCenter, len * 0.88, ev.allowed ? 0x10b981 : 0xf43f5e, 0.24, 0.16));
                }
            }
        }
        if (ev.candidateTile !== null && ev.candidateTile !== undefined && ev.candidateTile !== TILE_NULL) {
            const targetIdx = (ev.type === 'wfc_prop') ? ev.dstIdx : ev.srcIdx;
            const tv = voxels[targetIdx], tileDef = TILES[ev.candidateTile];
            if (tv && tileDef && tileDef.quads.length > 0) {
                const tc = voxelCenter(tv.x, tv.y, tv.z);
                const gPos = [], gIdx = [];
                for (const quad of tileDef.quads) {
                    const baseV = gPos.length / 3;
                    for (let k = 0; k < 4; k++) gPos.push(tc.x + quad[k][0] * VOXEL_SIZE, tc.y + quad[k][1] * VOXEL_SIZE, tc.z + quad[k][2] * VOXEL_SIZE);
                    gIdx.push(baseV, baseV + 1, baseV + 2, baseV, baseV + 2, baseV + 3);
                }
                const gGeo = new THREE.BufferGeometry();
                gGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(gPos), 3));
                gGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(gIdx), 1));
                gGeo.computeVertexNormals();
                viewport.substepGroup.add(new THREE.Mesh(gGeo, ev.allowed ? sharedMaterials.subGhostOk : sharedMaterials.subGhostFail));
            } else if (tv && tileDef && tileDef.graph && tileDef.graph.edges.length > 0) {
                const tc = voxelCenter(tv.x, tv.y, tv.z);
                const glPos = [];
                for (const [u, w] of tileDef.graph.edges) {
                    const p0 = tileDef.graph.vertices[u], p1 = tileDef.graph.vertices[w];
                    glPos.push(tc.x + p0[0] * VOXEL_SIZE, tc.y + p0[1] * VOXEL_SIZE, tc.z + p0[2] * VOXEL_SIZE, tc.x + p1[0] * VOXEL_SIZE, tc.y + p1[1] * VOXEL_SIZE, tc.z + p1[2] * VOXEL_SIZE);
                }
                const glGeo = new THREE.BufferGeometry();
                glGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(glPos), 3));
                viewport.substepGroup.add(new THREE.LineSegments(glGeo, ev.allowed ? sharedMaterials.subGhostLineOk : sharedMaterials.subGhostLineFail));
            }
        }
    }

    recomputeModelBox({ skipBBox: true });
    applyOutlinerVisibility();
    updateSimUI();
}

export function setAlgorithm(algo) {
    if (algo !== 'growth' && algo !== 'wfc') return;
    appState.currentAlgorithm = algo;
    clearActiveAnalysisOverlaysForTopo();
    setup({ collapseAll: true });
    draw();
}

export function initTab2Topo() {
    actions.syncVoxelAndEnvelopeUI = syncVoxelAndEnvelopeUI;
    actions.clearActiveAnalysisOverlaysForTopo = clearActiveAnalysisOverlaysForTopo;
    actions.setVoxelSize = setVoxelSize;
    actions.setGridResolution = setGridResolution;
    actions.voxelCenter = voxelCenter;
    actions.syncAdjRulesSize = syncAdjRulesSize;
    actions.resetSocketAdjacencyRules = resetSocketAdjacencyRules;
    actions.clearSubstepTrace = clearSubstepTrace;
    actions.collapseFullGridImmediate = collapseFullGridImmediate;
    actions.renderAdjacencyMatrixUI = renderAdjacencyMatrixUI;
    actions.setup = setup;
    actions.stepAlgorithmOnce = stepAlgorithmOnce;
    actions.stepSubstepOnce = stepSubstepOnce;
    actions.update = update;
    actions.buildWeldedGraph = buildWeldedGraph;
    actions.draw = draw;
    actions.setAlgorithm = setAlgorithm;
    actions.setVoxelPins = setVoxelPins;
    actions.clearVoxelPins = clearVoxelPins;
    actions.getVoxelPins = getVoxelPins;
    actions.updateVoxelPinsUI = updateVoxelPinsUI;
    appState._voxelPinApi = {
        setVoxelPins,
        clearVoxelPins,
        getVoxelPins,
        updateVoxelPinsUI,
    };

    const btnClearPins = $('btn-clear-voxel-pins');
    if (btnClearPins) {
        btnClearPins.addEventListener('click', () => {
            clearVoxelPins({ redraw: true });
            setup({ collapseAll: true });
            draw();
        });
    }
    updateVoxelPinsUI();

    $$('.algo-btn').forEach(btn => btn.addEventListener('click', () => setAlgorithm(btn.dataset.algo)));

    const btnRun = $('btn-sim-run'), btnStep = $('btn-sim-step'), btnBurst = $('btn-sim-burst'), btnReset = $('btn-sim-reset'), btnCollapseAll = $('btn-sim-collapse-all');
    if (btnRun) {
        btnRun.addEventListener('click', () => {
            clearActiveAnalysisOverlaysForTopo();
            const collapsedCount = appState.voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
            if (!appState.simRunning && collapsedCount >= appState.voxels.length) { initVoxelGrid(); draw(); }
            appState.simRunning = !appState.simRunning;
            appState.substepAccum = 0;
            updateSimUI();
        });
    }
    if (btnStep) {
        btnStep.addEventListener('click', () => {
            clearActiveAnalysisOverlaysForTopo();
            appState.simRunning = false;
            const collapsedCount = appState.voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
            if (collapsedCount >= appState.voxels.length && (!appState.substepMode || appState.substepCursor >= appState.substepQueue.length)) initVoxelGrid();
            if (appState.substepMode) stepSubstepOnce(); else stepAlgorithmOnce();
            draw();
        });
    }
    if (btnBurst) {
        btnBurst.addEventListener('click', () => {
            clearActiveAnalysisOverlaysForTopo();
            appState.simRunning = false;
            clearSubstepTrace();
            const collapsedCount = appState.voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
            if (collapsedCount >= appState.voxels.length) initVoxelGrid();
            for (let i = 0; i < 50; i++) if (!stepAlgorithmOnce()) break;
            renderAdjacencyMatrixUI();
            draw();
        });
    }
    if (btnReset) {
        btnReset.addEventListener('click', () => {
            clearActiveAnalysisOverlaysForTopo();
            appState.simRunning = false;
            setup({ collapseAll: false });
            draw();
        });
    }
    if (btnCollapseAll) {
        btnCollapseAll.addEventListener('click', () => {
            clearActiveAnalysisOverlaysForTopo();
            collapseFullGridImmediate();
            draw();
            zoomToBox(modelBoxToWorld(appState.modelBox));
            if (actions.recordChainStep) {
                actions.recordChainStep('wfc_collapse', {
                    algorithm: appState.currentAlgorithm,
                    grid: [appState.GRID_X, appState.GRID_Y, appState.GRID_Z]
                }, { label: `Collapse ${appState.currentAlgorithm.toUpperCase()} (${appState.GRID_X}×${appState.GRID_Y}×${appState.GRID_Z})` });
            }
        });
    }

    const bindGrid = (id, evName, fn) => { const el = $(id); if (el) el.addEventListener(evName, fn); };
    bindGrid('rng-grid-x', 'input', (e) => scheduleGridResolution(parseInt(e.target.value, 10), appState.GRID_Y, appState.GRID_Z));
    bindGrid('rng-grid-y', 'input', (e) => scheduleGridResolution(appState.GRID_X, parseInt(e.target.value, 10), appState.GRID_Z));
    bindGrid('rng-grid-z', 'input', (e) => scheduleGridResolution(appState.GRID_X, appState.GRID_Y, parseInt(e.target.value, 10)));
    bindGrid('num-grid-x', 'change', (e) => setGridResolution(parseInt(e.target.value, 10), appState.GRID_Y, appState.GRID_Z));
    bindGrid('num-grid-y', 'change', (e) => setGridResolution(appState.GRID_X, parseInt(e.target.value, 10), appState.GRID_Z));
    bindGrid('num-grid-z', 'change', (e) => setGridResolution(appState.GRID_X, appState.GRID_Y, parseInt(e.target.value, 10)));

    $$('.res-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            clearActiveAnalysisOverlaysForTopo();
            setGridResolution(parseInt(btn.dataset.rx, 10), parseInt(btn.dataset.ry, 10), parseInt(btn.dataset.rz, 10));
            zoomToBox(modelBoxToWorld(appState.modelBox));
        });
    });

    ['rng-voxel-size', 'num-voxel-size'].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', (e) => scheduleVoxelSizeInteractive(parseFloat(e.target.value)));
        el.addEventListener('change', (e) => setVoxelSize(parseFloat(e.target.value), { zoom: true, forceRebuild: true }));
    });
    [
        { id: 'num-topo-env-x', getGrid: () => appState.GRID_X },
        { id: 'num-topo-env-y', getGrid: () => appState.GRID_Y },
        { id: 'num-topo-env-z', getGrid: () => appState.GRID_Z }
    ].forEach(({ id, getGrid }) => {
        const el = $(id);
        if (!el) return;
        const applySpan = (zoom, interactive) => {
            const span = parseFloat(el.value);
            if (Number.isFinite(span) && span >= 0.05) {
                const nextSize = span / Math.max(1, getGrid());
                if (interactive) scheduleVoxelSizeInteractive(nextSize);
                else setVoxelSize(nextSize, { zoom, forceRebuild: true });
            }
        };
        el.addEventListener('input', () => applySpan(false, true));
        el.addEventListener('change', () => applySpan(true, false));
    });

    const chkMerge = $('chk-merge-collinear');
    if (chkMerge) chkMerge.addEventListener('change', (e) => { appState.mergeCollinearNodes = e.target.checked; draw(); });

    const chkSubstep = $('chk-substep');
    if (chkSubstep) {
        chkSubstep.addEventListener('change', (e) => {
            appState.substepMode = e.target.checked;
            appState.simRunning = false;
            if (!appState.substepMode) clearSubstepTrace();
            else { const det = $('details-adj-rules'); if (det) det.open = true; }
            renderAdjacencyMatrixUI();
            draw();
        });
    }

    $$('.axis-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            appState.currentRuleAxis = parseInt(btn.dataset.axis, 10);
            $$('.axis-btn').forEach(b => b.classList.toggle('seg-on', b === btn));
            renderAdjacencyMatrixUI();
        });
    });
    const btnSocket = $('btn-rules-socket'), btnAll = $('btn-rules-all');
    if (btnSocket) btnSocket.addEventListener('click', () => { resetSocketAdjacencyRules(); clearSubstepTrace(); renderAdjacencyMatrixUI(); draw(); });
    if (btnAll) btnAll.addEventListener('click', () => { allowAllAdjacencyRules(); clearSubstepTrace(); renderAdjacencyMatrixUI(); draw(); });

    const topoNetworkFileInput = $('topo-network-file-input');
    const numTopoFileWeldTol = $('num-topo-file-weld-tol');
    const btnClearLoadedNetwork = $('btn-clear-loaded-network');
    if (btnClearLoadedNetwork) btnClearLoadedNetwork.addEventListener('click', () => clearLoadedNetworkGraph());
    if (topoNetworkFileInput) {
        topoNetworkFileInput.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const ext = file.name.toLowerCase().split('.').pop();
            const weldTol = numTopoFileWeldTol ? (parseFloat(numTopoFileWeldTol.value) || 0.005) : 0.005;
            const fb = $('topo-network-feedback');
            const loadingOverlay = $('loading-overlay');
            if (loadingOverlay) loadingOverlay.classList.remove('hidden');
            try {
                let welded = null;
                if (ext === '3dm') { await appState.rhinoReady; welded = parse3dmToWeldedGraph(await file.arrayBuffer(), weldTol); }
                else if (ext === 'json' || ext === 'obj') welded = parseJSONOrOBJToWeldedGraph(await file.text(), ext, weldTol);
                if (!welded || welded.edges.length === 0) {
                    if (fb) { fb.textContent = `No curves or edges found in ${file.name}`; fb.className = 'text-[9.5px] text-center font-mono text-amber-400'; }
                } else {
                    setLoadedNetworkGraph(welded, file.name);
                }
            } catch (err) {
                console.error('Load network from file error:', err);
                if (fb) { fb.textContent = `Import error: ${err.message || err}`; fb.className = 'text-[9.5px] text-center font-mono text-rose-400'; }
            } finally {
                topoNetworkFileInput.value = '';
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
            }
        });
    }
}

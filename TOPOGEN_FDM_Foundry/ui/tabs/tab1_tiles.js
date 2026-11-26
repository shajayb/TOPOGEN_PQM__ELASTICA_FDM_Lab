/**
 * WFC-FDM Foundry — Tab 1: Module / Tile Catalog & Coarse Mesh Importer (ui/tabs/tab1_tiles.js)
 *
 * Student Quick-Map:
 *   - Edit Tab 1 HTML layout / buttons                   -> mountTab1Tiles()
 *   - Edit 3D Tile Showcase hero pedestal & socket dots  -> appendTileInstance3D(), renderTileInspector3D()
 *   - Edit 2-column tile catalog cards & click behavior  -> renderTileCatalogUI()
 *   - Edit coarse .obj / .3dm Catmull-Clark tile import  -> catmullClarkSubdivide(), importMeshModuleFromData()
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    CUSTOM_TILE_PALETTE,
    getUnitScale,
    $,
    setTxt
} from '../state/workbench_state.js';
import {
    viewport,
    sharedMaterials,
    clearGroup,
    makeFatLineSegments,
    makeFatMaterial,
    recomputeModelBox,
    zoomToBox,
    modelBoxToWorld
} from '../display/viewport_scene.js';
import { applyOutlinerVisibility } from '../display/display_hud.js';

let matCustomTilePreview = null;
let matSocketOpen = null;
let matSocketClosed = null;
let matInspectBox = null;
let matGalleryBox = null;
let matInspectPedestal = null;

function ensureTileMaterials() {
    if (matCustomTilePreview) return;
    matCustomTilePreview = new THREE.MeshPhysicalMaterial({
        vertexColors: true, transparent: true, opacity: 0.42, roughness: 0.45, metalness: 0.05, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, depthWrite: false
    });
    sharedMaterials.customTilePreview = matCustomTilePreview;
    matSocketOpen = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    matSocketClosed = new THREE.MeshBasicMaterial({ color: 0x475569, transparent: true, opacity: 0.55 });
    matInspectBox = new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.85 });
    matGalleryBox = new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.45 });
    matInspectPedestal = new THREE.LineBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.95 });
}

export function mountTab1Tiles() {
    const pane = $('tab-tiles');
    if (!pane) return;
    pane.innerHTML = `
        <!-- Tile Catalog -->
        <div class="space-y-1.5">
            <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-gray-200">Module / Tile Catalog</span>
                <div class="flex items-center space-x-1">
                    <button id="btn-tile-view-inspector" class="cad-btn seg-on text-[8.5px] py-0.5 px-1.5" title="Show Inspected Tile + Enabled Tile Showcase in 3D viewport">Tile Showcase</button>
                    <button id="btn-tile-view-grid" class="cad-btn text-[8.5px] py-0.5 px-1.5" title="Show 3D Voxel Grid Assembly in viewport">Voxel Grid</button>
                </div>
            </div>
            <p class="goldilocks-guide-prose text-[9.5px] text-gray-400 leading-snug">
                Click any tile card to inspect its 3D mesh, red centerline graph &amp; 6-face sockets; click ✓ dot to toggle enabled state.
            </p>
            <div class="flex items-center justify-between bg-gray-900/90 border border-gray-800 rounded px-2 py-1 text-[9.5px] font-mono">
                <span class="truncate text-cyan-300">Inspect: <strong id="inspected-tile-badge" class="text-white">Cross Hub</strong></span>
                <span id="inspected-sockets-badge" class="text-[8.5px] text-gray-400 flex-none ml-1.5">+X1 -X1 +Y1 -Y1 +Z1 -Z1</span>
            </div>
            <div id="tile-catalog" class="grid grid-cols-2 gap-1 text-[10px] font-mono"></div>
            <div class="flex items-center justify-between text-[9px] text-gray-400 pt-0.5">
                <div class="space-x-2">
                    <button id="btn-tiles-all-on" class="hover:text-white underline font-mono">Enable All</button>
                    <button id="btn-tiles-ortho" class="hover:text-cyan-300 underline font-mono">Ortho Set</button>
                </div>
                <span class="font-mono text-gray-500">✓ dot = active · click = inspect</span>
            </div>
            <div class="flex items-center justify-between pt-1 border-t border-gray-800 text-[10px] font-mono">
                <span class="text-gray-400">Tile / Voxel Size (m)</span>
                <div class="flex items-center space-x-1.5">
                    <input type="range" id="rng-tile-voxel-size" min="0.1" max="5.0" step="0.05" value="1.0" class="w-24 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500" title="Physical dimension of each tile / voxel cell in meters">
                    <input type="number" id="num-tile-voxel-size" min="0.05" max="20.0" step="0.05" value="1.0" class="w-14 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </div>
            </div>
        </div>

        <!-- Import Coarse Mesh Modules or 3DM Curves as Graph Tiles -->
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2.5 space-y-2">
            <div class="flex items-center justify-between">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-gray-200">Coarse Mesh / 3DM Curves → Graph Tiles</label>
                <span id="custom-tile-badge" class="text-[10px] font-mono text-cyan-400">0 custom</span>
            </div>
            <p class="goldilocks-guide-prose text-[9.5px] text-gray-400 leading-snug">
                Import .3dm / .obj coarse meshes or .3dm curves, Catmull-Clark subdivide <em>n</em>×, and preview surface + centerline graph.
            </p>
            <input type="file" id="mesh-module-input" accept=".3dm,.obj" multiple class="block w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[10.5px] file:font-semibold file:bg-pink-600/80 file:text-white hover:file:bg-pink-500 cursor-pointer transition-colors" />

            <div class="bg-gray-950/70 border border-gray-800 rounded p-2 space-y-1.5">
                <div class="flex items-center justify-between pb-1.5 border-b border-gray-800 text-[10px]">
                    <label class="flex items-center space-x-1.5 cursor-pointer font-semibold text-gray-200" title="Curve-Skeleton Tile — Extract medial centerline graph instead of surface mesh edges.">
                        <input type="checkbox" id="chk-skeletonize-mesh" autocomplete="off" class="accent-pink-500 rounded">
                        <span>Skeletonize Mesh → Centerline Tile</span>
                    </label>
                    <button type="button" id="skel-mode-badge" class="font-mono text-[8.5px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400 cursor-pointer" title="Toggle Mesh-to-Graph vs Curve-Skeleton mode">Mesh→Graph</button>
                </div>
                <div class="flex items-center justify-between text-[10px] font-mono">
                    <span class="text-gray-300">Catmull-Clark Subdiv (n)</span>
                    <span id="cc-level-label" class="text-pink-400 font-semibold">n = 1</span>
                </div>
                <div class="flex items-center space-x-2 text-[10px] font-mono">
                    <input type="range" id="rng-cc-level" autocomplete="off" min="0" max="4" step="1" value="1" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                    <input type="number" id="num-cc-level" autocomplete="off" min="0" max="4" step="1" value="1" class="w-11 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </div>
                <div class="flex items-center justify-between pt-0.5 text-[10px] text-gray-400">
                    <label class="flex items-center space-x-1.5 cursor-pointer" title="Center and scale each imported mesh uniformly to fit inside the unit tile voxel">
                        <input type="checkbox" id="chk-norm-voxel" autocomplete="off" checked class="accent-pink-500 rounded">
                        <span>Fit to Tile Voxel</span>
                    </label>
                    <label class="flex items-center space-x-1.5 cursor-pointer" title="Disable built-in tiles when importing custom modules">
                        <input type="checkbox" id="chk-disable-builtin" autocomplete="off" checked class="accent-pink-500 rounded">
                        <span>Custom Only</span>
                    </label>
                </div>
            </div>

            <div class="flex space-x-1">
                <button id="btn-reapply-cc" disabled class="cad-btn cyan flex-1" title="Re-subdivide imported coarse mesh modules with current Catmull-Clark level n">↻ Re-Subdiv (n)</button>
                <button id="btn-clear-custom-tiles" disabled class="cad-btn" title="Remove imported custom graph tiles">✕ Clear</button>
            </div>
            <div id="mesh-module-feedback" class="text-[10px] text-center font-mono text-gray-400"></div>
        </div>

        <!-- Import Meshes Directly as 3D Tiles (Without Converting to Graph) -->
        <div class="bg-gray-900/90 border border-cyan-500/40 rounded p-2.5 space-y-2">
            <div class="flex items-center justify-between">
                <label class="block text-[10.5px] font-semibold uppercase tracking-wider text-cyan-300">Mesh → Tiles (No Graph)</label>
                <span id="mesh-only-tile-badge" class="text-[10px] font-mono text-cyan-400">0 mesh</span>
            </div>
            <p class="goldilocks-guide-prose text-[9.5px] text-gray-400 leading-snug">
                Import .3dm / .obj meshes directly as 3D tiles for Topo propagation, without converting to centerline graph.
            </p>
            <input type="file" id="mesh-only-tile-input" accept=".3dm,.obj" multiple class="block w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-md file:border-0 file:text-[10.5px] file:font-semibold file:bg-cyan-600/80 file:text-white hover:file:bg-cyan-500 cursor-pointer transition-colors" />

            <div class="bg-gray-950/70 border border-gray-800 rounded p-2 space-y-1.5">
                <div class="flex items-center justify-between text-[10px] font-mono">
                    <span class="text-gray-300">Catmull-Clark Subdiv (n)</span>
                    <span id="mesh-only-cc-label" class="text-cyan-400 font-semibold">n = 0</span>
                </div>
                <div class="flex items-center space-x-2 text-[10px] font-mono">
                    <input type="range" id="rng-mesh-only-cc" autocomplete="off" min="0" max="4" step="1" value="0" class="flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-500">
                    <input type="number" id="num-mesh-only-cc" autocomplete="off" min="0" max="4" step="1" value="0" class="w-11 px-1 py-0.5 bg-gray-800 border border-gray-700 rounded text-right text-gray-100">
                </div>
                <div class="flex items-center justify-between pt-0.5 text-[10px] text-gray-400">
                    <label class="flex items-center space-x-1.5 cursor-pointer" title="Center and scale each imported mesh uniformly to fit inside the unit tile voxel">
                        <input type="checkbox" id="chk-mesh-only-norm" autocomplete="off" checked class="accent-cyan-500 rounded">
                        <span>Fit to Tile Voxel</span>
                    </label>
                    <label class="flex items-center space-x-1.5 cursor-pointer" title="Disable built-in tiles when importing mesh tiles">
                        <input type="checkbox" id="chk-mesh-only-custom-only" autocomplete="off" checked class="accent-cyan-500 rounded">
                        <span>Custom Only</span>
                    </label>
                </div>
            </div>

            <div class="flex space-x-1">
                <button id="btn-reapply-mesh-only-cc" disabled class="cad-btn cyan flex-1" title="Re-subdivide imported mesh-only tiles with current Catmull-Clark level n">↻ Re-Subdiv (n)</button>
                <button id="btn-clear-mesh-only-tiles" disabled class="cad-btn" title="Remove imported mesh-only tiles">✕ Clear</button>
            </div>
            <div id="mesh-only-tile-feedback" class="text-[10px] text-center font-mono text-gray-400"></div>
        </div>
    `;
}

export function appendTileInstance3D(targetGroup, tileDef, center, scale = 1.0, showSockets = false, isHero = false) {
    if (!tileDef) return;
    ensureTileMaterials();
    const hs = 0.5 * scale;
    const boxEdges = [
        [-hs,-hs,-hs,  hs,-hs,-hs], [ hs,-hs,-hs,  hs, hs,-hs], [ hs, hs,-hs, -hs, hs,-hs], [-hs, hs,-hs, -hs,-hs,-hs],
        [-hs,-hs, hs,  hs,-hs, hs], [ hs,-hs, hs,  hs, hs, hs], [ hs, hs, hs, -hs, hs, hs], [-hs, hs, hs, -hs,-hs, hs],
        [-hs,-hs,-hs, -hs,-hs, hs], [ hs,-hs,-hs,  hs,-hs, hs], [ hs, hs,-hs,  hs, hs, hs], [-hs, hs,-hs, -hs, hs, hs]
    ];
    const bPos = [];
    for (const ed of boxEdges) {
        bPos.push(center.x + ed[0], center.y + ed[1], center.z + ed[2], center.x + ed[3], center.y + ed[4], center.z + ed[5]);
    }
    const nodeMult = appState.nodeDisplayScale || 1.0;
    const edgePx = appState.edgeDisplayWidthPx || 1.5;
    const boxLines = makeFatLineSegments(
        new Float32Array(bPos),
        makeFatMaterial(isHero ? 0x0891b2 : 0x64748b, Math.max(0.75, edgePx * (isHero ? 0.85 : 0.65)), {
            disposeOnClear: true,
            transparent: true,
            opacity: isHero ? 0.55 : 0.30
        })
    );
    boxLines.userData.tileRole = 'voxel';
    targetGroup.add(boxLines);

    if (isHero) {
        const pr = hs * 1.16;
        const pz = center.z - hs - 0.015;
        const pedPos = [
            center.x - pr, center.y - pr, pz,  center.x + pr, center.y - pr, pz,
            center.x + pr, center.y - pr, pz,  center.x + pr, center.y + pr, pz,
            center.x + pr, center.y + pr, pz,  center.x - pr, center.y + pr, pz,
            center.x - pr, center.y + pr, pz,  center.x - pr, center.y - pr, pz
        ];
        const pedLines = makeFatLineSegments(
            new Float32Array(pedPos),
            makeFatMaterial(0xdb2777, Math.max(0.75, edgePx * 0.8), {
                disposeOnClear: true,
                transparent: true,
                opacity: 0.40
            })
        );
        pedLines.userData.tileRole = 'voxel';
        targetGroup.add(pedLines);
    }

    const faceQuads = (tileDef.quads && tileDef.quads.length > 0)
        ? tileDef.quads
        : (tileDef.previewQuads && tileDef.previewQuads.length > 0 ? tileDef.previewQuads : []);
    const isTranslucentCustom = (!tileDef.quads || tileDef.quads.length === 0) && faceQuads.length > 0;

    if (faceQuads.length > 0) {
        const pos = [], col = [], idx = [], wire = [];
        const [cr, cg, cb] = tileDef.color || [0.92, 0.35, 0.6];
        for (let q = 0; q < faceQuads.length; q++) {
            const quad = faceQuads[q];
            const base = pos.length / 3;
            for (let k = 0; k < 4; k++) {
                pos.push(center.x + quad[k][0] * scale, center.y + quad[k][1] * scale, center.z + quad[k][2] * scale);
                col.push(cr, cg, cb);
            }
            idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            const ringCount = (quad[2][0] === quad[3][0] && quad[2][1] === quad[3][1] && quad[2][2] === quad[3][2]) ? 3 : 4;
            for (let k = 0; k < ringCount; k++) {
                const a = quad[k], b = quad[(k + 1) % ringCount];
                wire.push(
                    center.x + a[0] * scale, center.y + a[1] * scale, center.z + a[2] * scale,
                    center.x + b[0] * scale, center.y + b[1] * scale, center.z + b[2] * scale
                );
            }
        }
        const mGeo = new THREE.BufferGeometry();
        mGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
        mGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
        mGeo.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
        mGeo.computeVertexNormals();
        const baseMat = isTranslucentCustom ? matCustomTilePreview : sharedMaterials.surface;
        const tileMesh = new THREE.Mesh(mGeo, appState.arcticOn ? sharedMaterials.arctic : baseMat);
        tileMesh.userData.arcticTarget = true;
        tileMesh.userData.baseMaterial = baseMat;
        tileMesh.userData.tileRole = 'mesh';
        targetGroup.add(tileMesh);

        if (wire.length > 0) {
            let wLines;
            if (wire.length > 600) {
                const wGeo = new THREE.BufferGeometry();
                wGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wire), 3));
                wLines = new THREE.LineSegments(wGeo, sharedMaterials.quadWire);
            } else {
                wLines = makeFatLineSegments(
                    new Float32Array(wire),
                    makeFatMaterial(0x1e293b, Math.max(0.75, edgePx * 0.75), {
                        disposeOnClear: true,
                        transparent: true,
                        opacity: 0.35
                    })
                );
            }
            wLines.userData.tileRole = 'mesh';
            targetGroup.add(wLines);
        }
    }

    if (tileDef.graph && tileDef.graph.edges && tileDef.graph.edges.length > 0) {
        const tv = tileDef.graph.vertices;
        const te = tileDef.graph.edges;
        const gPos = new Float32Array(te.length * 6);
        for (let e = 0; e < te.length; e++) {
            const p0 = tv[te[e][0]], p1 = tv[te[e][1]];
            const o = e * 6;
            gPos[o]     = center.x + p0[0] * scale; gPos[o + 1] = center.y + p0[1] * scale; gPos[o + 2] = center.z + p0[2] * scale;
            gPos[o + 3] = center.x + p1[0] * scale; gPos[o + 4] = center.y + p1[1] * scale; gPos[o + 5] = center.z + p1[2] * scale;
        }
        const gLines = makeFatLineSegments(
            gPos,
            makeFatMaterial(0xef4444, edgePx, { disposeOnClear: true })
        );
        gLines.renderOrder = 14;
        gLines.userData.tileRole = 'graph';
        targetGroup.add(gLines);

        if (te.length <= 64) {
            const nodeR = Math.max(0.005 * scale, Math.min(0.018 * scale, (0.095 * scale) / Math.sqrt(Math.max(6, tv.length)))) * nodeMult;
            const nGeo = new THREE.SphereGeometry(nodeR, 10, 10);
            const inst = new THREE.InstancedMesh(nGeo, sharedMaterials.graphNode, tv.length);
            const dummy = new THREE.Object3D();
            for (let i = 0; i < tv.length; i++) {
                dummy.position.set(center.x + tv[i][0] * scale, center.y + tv[i][1] * scale, center.z + tv[i][2] * scale);
                dummy.updateMatrix();
                inst.setMatrixAt(i, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
            inst.renderOrder = 15;
            inst.userData.tileRole = 'graph';
            targetGroup.add(inst);
        }
    }

    if (showSockets && Array.isArray(tileDef.sockets)) {
        const faceOffsets = [[hs, 0, 0], [-hs, 0, 0], [0, hs, 0], [0, -hs, 0], [0, 0, hs], [0, 0, -hs]];
        const openR = 0.052 * scale * nodeMult;
        const closedR = 0.028 * scale * nodeMult;
        for (let d = 0; d < 6; d++) {
            const isOpen = !!tileDef.sockets[d];
            const sGeo = new THREE.SphereGeometry(isOpen ? openR : closedR, 12, 12);
            const sMesh = new THREE.Mesh(sGeo, isOpen ? matSocketOpen : matSocketClosed);
            sMesh.position.set(center.x + faceOffsets[d][0], center.y + faceOffsets[d][1], center.z + faceOffsets[d][2]);
            sMesh.renderOrder = 18;
            sMesh.userData.tileRole = 'socket';
            targetGroup.add(sMesh);
        }
    }
}

export function renderTileInspector3D() {
    actions.renderTileInspector3D = renderTileInspector3D;
    ensureTileMaterials();
    clearGroup(viewport.tilePreviewGroup);
    appState.tilePreviewBounds.makeEmpty();

    const { TILES } = appState;
    if (!TILES[appState.inspectedTileId]) appState.inspectedTileId = TILES.length > 1 ? 1 : 0;
    const heroTile = TILES[appState.inspectedTileId] || TILES[0];

    if (heroTile) {
        setTxt('inspected-tile-badge', heroTile.name);
        if (Array.isArray(heroTile.sockets)) {
            const s = heroTile.sockets;
            setTxt('inspected-sockets-badge', `+X:${s[0]} -X:${s[1]} +Y:${s[2]} -Y:${s[3]} +Z:${s[4]} -Z:${s[5]}`);
        }
    }

    const heroScale = 1.55;
    const heroCenter = new THREE.Vector3(0, -0.35, heroScale * 0.5 + 0.03);
    appendTileInstance3D(viewport.tilePreviewGroup, heroTile, heroCenter, heroScale, true, true);
    appState.tilePreviewBounds.expandByPoint(new THREE.Vector3(-heroScale * 0.65, heroCenter.y - heroScale * 0.65, 0));
    appState.tilePreviewBounds.expandByPoint(new THREE.Vector3(heroScale * 0.65, heroCenter.y + heroScale * 0.65, heroCenter.z + heroScale * 0.6));

    const enabledNonNull = TILES.filter((t, idx) => idx > 0 && t.enabled);
    if (enabledNonNull.length > 0) {
        const galScale = 0.82;
        const spacing = 1.12;
        const totalW = (enabledNonNull.length - 1) * spacing;
        const rowY = 1.45;
        const rowZ = galScale * 0.5 + 0.02;
        enabledNonNull.forEach((t, idx) => {
            const cx = -totalW * 0.5 + idx * spacing;
            const c = new THREE.Vector3(cx, rowY, rowZ);
            appendTileInstance3D(viewport.tilePreviewGroup, t, c, galScale, false, t.id === heroTile.id);
            appState.tilePreviewBounds.expandByPoint(new THREE.Vector3(cx - galScale * 0.55, rowY - galScale * 0.55, 0));
            appState.tilePreviewBounds.expandByPoint(new THREE.Vector3(cx + galScale * 0.55, rowY + galScale * 0.55, rowZ + galScale * 0.55));
        });
    }
}

export function renderTileCatalogUI() {
    const containerEl = $('tile-catalog');
    if (!containerEl) return;
    const { TILES } = appState;
    if (!TILES[appState.inspectedTileId]) appState.inspectedTileId = TILES.length > 1 ? 1 : 0;

    containerEl.innerHTML = TILES.map(t => {
        const qCount = (t.quads && t.quads.length > 0) ? t.quads.length : (t.previewQuads ? t.previewQuads.length : 0);
        const eCount = (t.graph && t.graph.edges) ? t.graph.edges.length : 0;
        const statStr = qCount > 0 ? `${qCount}q·${eCount}e` : `${eCount}e`;
        const isInsp = t.id === appState.inspectedTileId;
        const ringCls = isInsp
            ? 'ring-1 ring-cyan-400 border-cyan-400 bg-gray-800 text-white'
            : (t.enabled ? 'bg-gray-800/90 border-gray-600 text-gray-100' : 'bg-gray-900/90 border-gray-800 text-gray-400 opacity-65');
        const chkBadge = t.enabled
            ? `<span data-toggle-tile="${t.id}" class="w-3.5 h-3.5 rounded-sm bg-emerald-500/25 border border-emerald-400 text-emerald-300 flex items-center justify-center text-[8.5px] leading-none flex-none hover:bg-emerald-500/40" title="Toggle enabled state in Topo Gen">✓</span>`
            : `<span data-toggle-tile="${t.id}" class="w-3.5 h-3.5 rounded-sm bg-gray-950 border border-gray-600 text-gray-500 flex items-center justify-center text-[8.5px] leading-none flex-none hover:border-gray-400" title="Toggle enabled state in Topo Gen"></span>`;
        const shortTileName = String(t.name || 'Tile').replace(/"/g, '').slice(0, 24);
        return `
        <button data-tile-id="${t.id}" class="tile-toggle-btn flex items-center justify-between px-1.5 py-1 rounded border text-left transition ${ringCls}" title="${shortTileName} — Click to inspect 3D tile; Shift-click toggles active.">
            <span class="flex items-center space-x-1.5 truncate">
                ${chkBadge}
                <span class="w-2 h-2 rounded-sm inline-block flex-none" style="background:${t.hex}"></span>
                <span class="truncate">${t.name}</span>
            </span>
            <span class="text-[8.5px] text-gray-400 ml-1 flex-none">${statStr}</span>
        </button>`;
    }).join('');

    containerEl.querySelectorAll('[data-toggle-tile]').forEach(chkEl => {
        chkEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(chkEl.dataset.toggleTile, 10);
            TILES[id].enabled = !TILES[id].enabled;
            if (!TILES.some(t => t.enabled)) TILES[id].enabled = true;
            appState.inspectedTileId = id;
            if (actions.recordChainStep) {
                actions.recordChainStep('tile_toggle', {
                    tileId: id,
                    tileKey: TILES[id].key,
                    tileName: TILES[id].name,
                    enabled: TILES[id].enabled
                }, { label: `${TILES[id].enabled ? 'Enable' : 'Disable'} ${TILES[id].name}` });
            }
            if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
            if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(TILES[id].enabled && id !== CORE.TILE_NULL ? id : null);
            renderTileCatalogUI();
            if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            if (actions.draw) actions.draw();
            zoomToBox(modelBoxToWorld(appState.modelBox));
        });
    });

    containerEl.querySelectorAll('.tile-toggle-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(btn.dataset.tileId, 10);
            const prevEnabled = TILES[id].enabled;
            appState.inspectedTileId = id;
            if (e.shiftKey) {
                TILES[id].enabled = !TILES[id].enabled;
                if (!TILES.some(t => t.enabled)) TILES[id].enabled = true;
            } else if (id !== CORE.TILE_NULL && !TILES[id].enabled) {
                TILES[id].enabled = true;
            }
            if (TILES[id].enabled !== prevEnabled && actions.recordChainStep) {
                actions.recordChainStep('tile_toggle', {
                    tileId: id,
                    tileKey: TILES[id].key,
                    tileName: TILES[id].name,
                    enabled: TILES[id].enabled
                }, { label: `${TILES[id].enabled ? 'Enable' : 'Disable'} ${TILES[id].name}` });
            }
            if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
            if (actions.clearUserImportedMeshes) actions.clearUserImportedMeshes();
            appState.showQuadMeshes = true;
            appState.showCenterlineGraph = true;
            appState.groupVis.meshes = true;
            appState.groupVis.graph = true;
            const chkShowMeshes = $('chk-show-meshes');
            const chkShowGraph = $('chk-show-graph');
            if (chkShowMeshes) chkShowMeshes.checked = true;
            if (chkShowGraph) chkShowGraph.checked = true;

            if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(id !== CORE.TILE_NULL && TILES[id].enabled ? id : null);
            renderTileCatalogUI();
            if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            if (actions.draw) actions.draw();
            zoomToBox(modelBoxToWorld(appState.modelBox));
        });
    });

    const customCount = TILES.filter(t => t.isCustomGraph && !t.meshOnly).length;
    setTxt('custom-tile-badge', `${customCount} custom`);
    const btnReapplyCC = $('btn-reapply-cc');
    const btnClearCustomTiles = $('btn-clear-custom-tiles');
    if (btnReapplyCC) btnReapplyCC.disabled = customCount === 0;
    if (btnClearCustomTiles) btnClearCustomTiles.disabled = customCount === 0;

    const meshOnlyCount = TILES.filter(t => t.isCustomGraph && t.meshOnly).length;
    setTxt('mesh-only-tile-badge', `${meshOnlyCount} mesh`);
    const btnReapplyMeshOnlyCC = $('btn-reapply-mesh-only-cc');
    const btnClearMeshOnly = $('btn-clear-mesh-only-tiles');
    if (btnReapplyMeshOnlyCC) btnReapplyMeshOnlyCC.disabled = meshOnlyCount === 0;
    if (btnClearMeshOnly) btnClearMeshOnly.disabled = meshOnlyCount === 0;
}

export function setTileViewMode(mode) {
    appState.tileViewMode = mode === 'grid' ? 'grid' : 'inspector';
    const btnInsp = $('btn-tile-view-inspector');
    const btnGrid = $('btn-tile-view-grid');
    if (btnInsp) btnInsp.classList.toggle('seg-on', appState.tileViewMode === 'inspector');
    if (btnGrid) btnGrid.classList.toggle('seg-on', appState.tileViewMode === 'grid');
    applyOutlinerVisibility();
    recomputeModelBox();
    zoomToBox(modelBoxToWorld(appState.modelBox));
}

// --- Coarse Mesh Module -> Graph Tile Importer ---
function weldMeshVertices(rawVerts, rawFaces, tol = 1e-5) {
    const invTol = 1 / Math.max(tol, 1e-9);
    const grid = new Map();
    const verts = [];
    const remap = new Int32Array(rawVerts.length);

    for (let i = 0; i < rawVerts.length; i++) {
        const p = rawVerts[i];
        const gx = Math.round(p[0] * invTol), gy = Math.round(p[1] * invTol), gz = Math.round(p[2] * invTol);
        let found = -1;
        outer: for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = grid.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
                    if (!bucket) continue;
                    for (let k = 0; k < bucket.length; k++) {
                        const idx = bucket[k];
                        const q = verts[idx];
                        const ddx = p[0] - q[0], ddy = p[1] - q[1], ddz = p[2] - q[2];
                        if (ddx * ddx + ddy * ddy + ddz * ddz <= tol * tol) { found = idx; break outer; }
                    }
                }
            }
        }
        if (found === -1) {
            found = verts.length;
            verts.push([p[0], p[1], p[2]]);
            const key = `${gx}_${gy}_${gz}`;
            let b = grid.get(key);
            if (!b) { b = []; grid.set(key, b); }
            b.push(found);
        }
        remap[i] = found;
    }

    const faces = [];
    for (let f = 0; f < rawFaces.length; f++) {
        const rf = rawFaces[f];
        const mapped = [];
        for (let j = 0; j < rf.length; j++) {
            const vi = remap[rf[j]];
            if (mapped.length === 0 || mapped[mapped.length - 1] !== vi) mapped.push(vi);
        }
        if (mapped.length > 1 && mapped[0] === mapped[mapped.length - 1]) mapped.pop();
        if (mapped.length >= 3 && new Set(mapped).size >= 3) faces.push(mapped);
    }
    return { verts, faces };
}

function normalizeMeshToUnitVoxel(verts) {
    if (!verts.length) return [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const v of verts) {
        if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
        if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
        if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
    const cx = (minX + maxX) * 0.5, cy = (minY + maxY) * 0.5, cz = (minZ + maxZ) * 0.5;
    const scale = 1.0 / Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
    return verts.map(v => [(v[0] - cx) * scale, (v[1] - cy) * scale, (v[2] - cz) * scale]);
}

export function catmullClarkSubdivide(inputVerts, inputFaces, iterations = 1) {
    let verts = inputVerts.map(v => [v[0], v[1], v[2]]);
    let faces = inputFaces.map(f => f.slice());
    const iters = Math.max(0, Math.min(4, Math.round(Number(iterations) || 0)));

    for (let iter = 0; iter < iters; iter++) {
        if (verts.length === 0 || faces.length === 0) break;
        const facePoints = faces.map(f => {
            let sx = 0, sy = 0, sz = 0;
            for (let i = 0; i < f.length; i++) {
                const p = verts[f[i]];
                sx += p[0]; sy += p[1]; sz += p[2];
            }
            return [sx / f.length, sy / f.length, sz / f.length];
        });

        const edgeMap = new Map();
        const edgeList = [];
        const vertFaces = Array.from({ length: verts.length }, () => []);
        const vertEdges = Array.from({ length: verts.length }, () => []);
        const getOrCreateEdge = (u, v) => {
            const a = Math.min(u, v), b = Math.max(u, v);
            const key = `${a}_${b}`;
            let e = edgeMap.get(key);
            if (!e) {
                e = { id: edgeList.length, u: a, v: b, faces: [] };
                edgeMap.set(key, e);
                edgeList.push(e);
                vertEdges[a].push(e.id);
                vertEdges[b].push(e.id);
            }
            return e;
        };
        for (let fi = 0; fi < faces.length; fi++) {
            const f = faces[fi];
            for (let j = 0; j < f.length; j++) {
                const u = f[j], v = f[(j + 1) % f.length];
                vertFaces[u].push(fi);
                getOrCreateEdge(u, v).faces.push(fi);
            }
        }

        const edgePoints = edgeList.map(e => {
            const pu = verts[e.u], pv = verts[e.v];
            if (e.faces.length === 2) {
                const f0 = facePoints[e.faces[0]], f1 = facePoints[e.faces[1]];
                return [(pu[0] + pv[0] + f0[0] + f1[0]) * 0.25, (pu[1] + pv[1] + f0[1] + f1[1]) * 0.25, (pu[2] + pv[2] + f0[2] + f1[2]) * 0.25];
            }
            return [(pu[0] + pv[0]) * 0.5, (pu[1] + pv[1]) * 0.5, (pu[2] + pv[2]) * 0.5];
        });

        const updatedVerts = verts.map((p, vi) => {
            const incEdges = vertEdges[vi], incFaces = vertFaces[vi];
            const m = incEdges.length;
            if (m === 0 || incFaces.length === 0) return [p[0], p[1], p[2]];
            const boundaryNeighbors = [];
            for (let k = 0; k < m; k++) {
                const e = edgeList[incEdges[k]];
                if (e.faces.length === 1) boundaryNeighbors.push(e.u === vi ? e.v : e.u);
            }
            if (boundaryNeighbors.length > 0) {
                if (boundaryNeighbors.length === 2) {
                    const pa = verts[boundaryNeighbors[0]], pb = verts[boundaryNeighbors[1]];
                    return [(6 * p[0] + pa[0] + pb[0]) * 0.125, (6 * p[1] + pa[1] + pb[1]) * 0.125, (6 * p[2] + pa[2] + pb[2]) * 0.125];
                }
                return [p[0], p[1], p[2]];
            }
            if (m < 3) return [p[0], p[1], p[2]];
            let fx = 0, fy = 0, fz = 0;
            for (let k = 0; k < incFaces.length; k++) {
                const fp = facePoints[incFaces[k]];
                fx += fp[0]; fy += fp[1]; fz += fp[2];
            }
            fx /= incFaces.length; fy /= incFaces.length; fz /= incFaces.length;
            let rx = 0, ry = 0, rz = 0;
            for (let k = 0; k < m; k++) {
                const e = edgeList[incEdges[k]];
                const pu = verts[e.u], pv = verts[e.v];
                rx += (pu[0] + pv[0]) * 0.5; ry += (pu[1] + pv[1]) * 0.5; rz += (pu[2] + pv[2]) * 0.5;
            }
            rx /= m; ry /= m; rz /= m;
            return [(fx + 2 * rx + (m - 3) * p[0]) / m, (fy + 2 * ry + (m - 3) * p[1]) / m, (fz + 2 * rz + (m - 3) * p[2]) / m];
        });

        const origCount = updatedVerts.length;
        const edgeOffset = origCount;
        const faceOffset = origCount + edgePoints.length;
        const nextVerts = [...updatedVerts, ...edgePoints, ...facePoints];
        const nextFaces = [];
        for (let fi = 0; fi < faces.length; fi++) {
            const f = faces[fi];
            const fPtIdx = faceOffset + fi;
            for (let j = 0; j < f.length; j++) {
                const currV = f[j], nextV = f[(j + 1) % f.length], prevV = f[(j - 1 + f.length) % f.length];
                const eNext = edgeMap.get(`${Math.min(currV, nextV)}_${Math.max(currV, nextV)}`).id;
                const ePrev = edgeMap.get(`${Math.min(prevV, currV)}_${Math.max(prevV, currV)}`).id;
                nextFaces.push([currV, edgeOffset + eNext, fPtIdx, edgeOffset + ePrev]);
            }
        }
        verts = nextVerts;
        faces = nextFaces;
    }
    return { verts, faces };
}

export function extractGraphFromMesh(verts, faces) {
    const seen = new Set();
    const edges = [];
    for (const f of faces) {
        for (let j = 0; j < f.length; j++) {
            const u = f[j], v = f[(j + 1) % f.length];
            if (u === v) continue;
            const a = Math.min(u, v), b = Math.max(u, v);
            const key = `${a}_${b}`;
            if (!seen.has(key)) { seen.add(key); edges.push([a, b]); }
        }
    }
    return { vertices: verts.map(v => [v[0], v[1], v[2]]), edges };
}

function detectTileSocketsFromGraph(vertices, tol = 0.04) {
    const sockets = [0, 0, 0, 0, 0, 0];
    for (const v of vertices) {
        if (v[0] >=  0.5 - tol) sockets[0] = 1;
        if (v[0] <= -0.5 + tol) sockets[1] = 1;
        if (v[1] >=  0.5 - tol) sockets[2] = 1;
        if (v[1] <= -0.5 + tol) sockets[3] = 1;
        if (v[2] >=  0.5 - tol) sockets[4] = 1;
        if (v[2] <= -0.5 + tol) sockets[5] = 1;
    }
    return sockets.some(s => s === 1) ? sockets : [1, 1, 1, 1, 1, 1];
}

export function parseOBJMeshes(text, fallbackName = 'OBJ_Module') {
    const allVerts = [];
    const groups = [];
    let currentGroup = { name: fallbackName, faces: [] };
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        const tag = parts[0];
        if (tag === 'v' && parts.length >= 4) {
            allVerts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if ((tag === 'o' || tag === 'g') && parts.length >= 2) {
            if (currentGroup.faces.length > 0) groups.push(currentGroup);
            currentGroup = { name: parts.slice(1).join('_'), faces: [] };
        } else if (tag === 'f' && parts.length >= 4) {
            const face = [];
            for (let j = 1; j < parts.length; j++) {
                const rawIdx = parseInt(parts[j].split('/')[0], 10);
                if (isNaN(rawIdx)) continue;
                const idx = rawIdx < 0 ? allVerts.length + rawIdx : rawIdx - 1;
                if (idx >= 0 && idx < allVerts.length) face.push(idx);
            }
            if (face.length >= 3) currentGroup.faces.push(face);
        }
    }
    if (currentGroup.faces.length > 0) groups.push(currentGroup);
    return groups.map(g => {
        const localMap = new Map();
        const localVerts = [];
        const localFaces = g.faces.map(f => f.map(vi => {
            let li = localMap.get(vi);
            if (li === undefined) { li = localVerts.length; localVerts.push(allVerts[vi]); localMap.set(vi, li); }
            return li;
        }));
        return { name: g.name, verts: localVerts, faces: localFaces };
    });
}

export function parse3dmMeshes(arrayBuffer, fallbackName = '3DM_Module') {
    const rhino = appState.rhino;
    if (!rhino) return [];
    const doc = rhino.File3dm.fromByteArray(new Uint8Array(arrayBuffer));
    if (!doc) return [];
    let scale = 1.0;
    try { scale = getUnitScale(doc.settings().modelUnitSystem); } catch (e) { scale = 1.0; }
    const modules = [];
    const objects = doc.objects();
    for (let i = 0; i < objects.count; i++) {
        const obj = objects.get(i);
        const geom = obj.geometry();
        if (!geom || geom.objectType !== rhino.ObjectType.Mesh) continue;
        const attr = obj.attributes();
        const rVerts = geom.vertices(), rFaces = geom.faces();
        const verts = [];
        for (let v = 0; v < rVerts.count; v++) {
            const pt = rVerts.get(v);
            verts.push([pt[0] * scale, pt[1] * scale, pt[2] * scale]);
        }
        const faces = [];
        for (let f = 0; f < rFaces.count; f++) {
            const fc = rFaces.get(f);
            faces.push(fc[2] === fc[3] ? [fc[0], fc[1], fc[2]] : [fc[0], fc[1], fc[2], fc[3]]);
        }
        if (verts.length > 0 && faces.length > 0) {
            modules.push({ name: (attr && attr.name) ? attr.name : `${fallbackName}_${modules.length + 1}`, verts, faces });
        }
    }
    doc.delete();
    return modules;
}

export function parse3dmCurvesAsGraph(arrayBuffer, fallbackName = '3DM_Curves') {
    const rhino = appState.rhino;
    if (!rhino) return null;
    const doc = rhino.File3dm.fromByteArray(new Uint8Array(arrayBuffer));
    if (!doc) return null;
    let scale = 1.0;
    try { scale = getUnitScale(doc.settings().modelUnitSystem); } catch (e) { scale = 1.0; }

    const sampleSingleCurve = (crv) => {
        let pts = [];
        if (!crv) return pts;
        try {
            if (typeof crv.pointCount === 'number' && typeof crv.point === 'function' && crv.pointCount >= 2) {
                for (let k = 0; k < crv.pointCount; k++) pts.push(crv.point(k));
                return pts;
            }
            if (typeof crv.isLinear === 'function' && crv.isLinear()) {
                const p0 = crv.pointAtStart;
                const p1 = crv.pointAtEnd;
                if (p0 && p1) return [p0, p1];
            }
            if (typeof crv.toPolyline === 'function') {
                const pl = crv.toPolyline(0, 0, 0.1, 0.1, 0, 0, 0, 0, true);
                if (pl && typeof pl.count === 'number' && pl.count >= 2) {
                    for (let k = 0; k < pl.count; k++) pts.push(pl.get(k));
                } else if (pl && typeof pl.pointCount === 'number' && typeof pl.point === 'function' && pl.pointCount >= 2) {
                    for (let k = 0; k < pl.pointCount; k++) pts.push(pl.point(k));
                }
                if (pl && typeof pl.delete === 'function') pl.delete();
                if (pts.length >= 2) return pts;
            }
        } catch (e) {}

        try {
            if (crv.domain && typeof crv.pointAt === 'function') {
                const dom = crv.domain;
                const d0 = Array.isArray(dom) ? dom[0] : dom.t0;
                const d1 = Array.isArray(dom) ? dom[1] : dom.t1;
                if (Number.isFinite(d0) && Number.isFinite(d1) && Math.abs(d1 - d0) > 1e-12) {
                    const steps = (typeof crv.degree === 'number' && crv.degree === 1 && typeof crv.points === 'function' && crv.points().count >= 2)
                        ? Math.max(1, crv.points().count - 1)
                        : 16;
                    for (let k = 0; k <= steps; k++) {
                        const t = d0 + ((d1 - d0) * k) / steps;
                        pts.push(crv.pointAt(t));
                    }
                }
            }
        } catch (e) {}
        return pts;
    };

    const rawVerts = [];
    const rawEdges = [];
    const appendPts = (pts) => {
        if (!pts || pts.length < 2) return;
        const baseIdx = rawVerts.length;
        for (const p of pts) rawVerts.push([p[0] * scale, p[1] * scale, p[2] * scale]);
        for (let k = 0; k < pts.length - 1; k++) rawEdges.push([baseIdx + k, baseIdx + k + 1]);
    };

    const objects = doc.objects();
    for (let i = 0; i < objects.count; i++) {
        const obj = objects.get(i);
        const geom = obj.geometry();
        if (!geom || geom.objectType !== rhino.ObjectType.Curve) continue;

        if (typeof geom.segmentCount === 'number' && typeof geom.segmentCurve === 'function' && geom.segmentCount > 0) {
            for (let s = 0; s < geom.segmentCount; s++) {
                const seg = geom.segmentCurve(s);
                if (seg) {
                    appendPts(sampleSingleCurve(seg));
                    if (typeof seg.delete === 'function') seg.delete();
                }
            }
        } else {
            appendPts(sampleSingleCurve(geom));
        }
    }
    doc.delete();
    if (rawVerts.length < 2 || rawEdges.length === 0) return null;
    return { name: fallbackName, verts: rawVerts, edges: rawEdges };
}

export function importCurveModuleFromData(name, rawVerts, rawEdges, options = {}) {
    const chkNormVoxel = $('chk-norm-voxel');
    const normalize = options.normalize !== undefined ? options.normalize : (chkNormVoxel ? chkNormVoxel.checked : true);

    // Weld coincident curve endpoints/vertices
    const tol = 1e-4;
    const invTol = 1 / tol;
    const grid = new Map();
    const verts = [];
    const vMap = new Int32Array(rawVerts.length);
    for (let i = 0; i < rawVerts.length; i++) {
        const v = rawVerts[i];
        const key = `${Math.round(v[0] * invTol)}_${Math.round(v[1] * invTol)}_${Math.round(v[2] * invTol)}`;
        let idx = grid.get(key);
        if (idx === undefined) {
            idx = verts.length;
            grid.set(key, idx);
            verts.push([v[0], v[1], v[2]]);
        }
        vMap[i] = idx;
    }

    const seen = new Set();
    const edges = [];
    for (const e of rawEdges) {
        const a = vMap[e[0]], b = vMap[e[1]];
        if (a === b) continue;
        const u = Math.min(a, b), v = Math.max(a, b);
        const key = `${u}_${v}`;
        if (!seen.has(key)) {
            seen.add(key);
            edges.push([u, v]);
        }
    }
    if (verts.length < 2 || edges.length === 0) return null;

    const baseVerts = normalize ? normalizeMeshToUnitVoxel(verts) : verts;
    const graph = { vertices: baseVerts, edges };
    const sockets = detectTileSocketsFromGraph(graph.vertices);
    const quads = CORE.buildQuadsFromGraph(graph);

    const customIdx = appState.TILES.filter(t => t.isCustomGraph).length;
    const pal = CUSTOM_TILE_PALETTE[customIdx % CUSTOM_TILE_PALETTE.length];
    const cleanName = String(name || `CrvMod_${customIdx + 1}`).replace(/\.(3dm|obj)$/i, '').slice(0, 22);
    const shortCode = (`C${customIdx + 1}` + cleanName.replace(/[^A-Za-z0-9]/g, '').slice(0, 1)).toUpperCase().slice(0, 3);

    const tile = {
        id: appState.TILES.length,
        key: `custom_curve_${Date.now()}_${customIdx}`,
        name: cleanName,
        short: shortCode,
        color: pal.color,
        hex: pal.hex,
        enabled: true,
        weight: 1.5,
        sockets,
        quads,
        previewQuads: [],
        graph,
        isCustomGraph: true,
        ccLevel: 0
    };

    appState.TILES.push(tile);
    if (actions.syncAdjRulesSize) actions.syncAdjRulesSize();
    return tile;
}

function buildPreviewQuadsFromSubMesh(verts, faces) {
    const out = [];
    for (const f of faces) {
        if (f.length === 4) out.push([verts[f[0]], verts[f[1]], verts[f[2]], verts[f[3]]]);
        else if (f.length === 3) out.push([verts[f[0]], verts[f[1]], verts[f[2]], verts[f[2]]]);
        else if (f.length > 4) {
            for (let k = 1; k < f.length - 1; k++) out.push([verts[f[0]], verts[f[k]], verts[f[k + 1]], verts[f[k + 1]]]);
        }
    }
    return out;
}

function syncSkeletonModeBadge() {
    const chk = $('chk-skeletonize-mesh');
    if (chk) chk.checked = Boolean(appState.skeletonizeMeshTile);
    const btnReapply = $('btn-reapply-cc');
    if (btnReapply) {
        btnReapply.textContent = appState.skeletonizeMeshTile ? '↻ Re-Skeletonize (n)' : '↻ Re-Subdiv (n)';
    }
    const badge = $('skel-mode-badge');
    if (!badge) return;
    if (appState.skeletonizeMeshTile) {
        badge.textContent = 'Skeleton (S)';
        badge.className = 'font-mono text-[8.5px] px-1.5 py-0.5 rounded bg-emerald-500/20 border border-emerald-500 text-emerald-700 font-bold cursor-pointer';
    } else {
        badge.textContent = 'Mesh→Graph';
        badge.className = 'font-mono text-[8.5px] px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-gray-400 cursor-pointer';
    }
}

export function importMeshModuleFromData(name, rawVerts, rawFaces, options = {}) {
    const meshOnly = Boolean(options.meshOnly);
    const chkNormVoxel = $(meshOnly ? 'chk-mesh-only-norm' : 'chk-norm-voxel');
    const chkSkel = $('chk-skeletonize-mesh');
    const numMeshOnlyCC = $('num-mesh-only-cc');
    const defaultMeshOnlyCC = numMeshOnlyCC ? Math.max(0, Math.min(4, Math.round(Number(numMeshOnlyCC.value) || 0))) : 0;
    const ccIterations = options.ccLevel !== undefined ? options.ccLevel : (meshOnly ? defaultMeshOnlyCC : appState.ccSubdivLevel);
    const normalize = options.normalize !== undefined ? options.normalize : (chkNormVoxel ? chkNormVoxel.checked : true);
    const useSkeleton = !meshOnly && (options.skeletonize !== undefined
        ? Boolean(options.skeletonize)
        : (chkSkel ? chkSkel.checked : Boolean(appState.skeletonizeMeshTile)));
    const welded = weldMeshVertices(rawVerts, rawFaces, 1e-5);
    if (welded.verts.length === 0 || welded.faces.length === 0) return null;

    const baseVerts = normalize ? normalizeMeshToUnitVoxel(welded.verts) : welded.verts;
    const sub = catmullClarkSubdivide(baseVerts, welded.faces, ccIterations);
    let graph;
    if (meshOnly) {
        graph = { vertices: [], edges: [] };
    } else if (useSkeleton && typeof CORE.extractSkeletalGraphFromMesh === 'function') {
        const skel = CORE.extractSkeletalGraphFromMesh(baseVerts, welded.faces);
        graph = (skel && skel.edges && skel.edges.length > 0)
            ? { vertices: skel.vertices, edges: skel.edges }
            : extractGraphFromMesh(sub.verts, sub.faces);
    } else {
        graph = extractGraphFromMesh(sub.verts, sub.faces);
    }
    const sockets = detectTileSocketsFromGraph(meshOnly ? sub.verts : graph.vertices);
    const previewQuads = buildPreviewQuadsFromSubMesh(sub.verts, sub.faces);

    const customIdx = appState.TILES.filter(t => t.isCustomGraph).length;
    const pal = CUSTOM_TILE_PALETTE[customIdx % CUSTOM_TILE_PALETTE.length];
    const cleanName = String(name || `MeshMod_${customIdx + 1}`).replace(/\.(3dm|obj)$/i, '').slice(0, 22);
    const prefix = meshOnly ? 'T' : (useSkeleton ? 'S' : 'M');
    const shortCode = (prefix + `${customIdx + 1}` + cleanName.replace(/[^A-Za-z0-9]/g, '').slice(0, 1)).toUpperCase().slice(0, 3);

    const tile = {
        id: appState.TILES.length,
        key: `${meshOnly ? 'custom_meshtile' : 'custom_mesh'}_${Date.now()}_${customIdx}`,
        name: cleanName,
        short: shortCode,
        color: pal.color,
        hex: pal.hex,
        enabled: true,
        weight: 1.5,
        sockets,
        quads: meshOnly ? previewQuads : [],
        previewQuads: meshOnly ? [] : previewQuads,
        subMesh: { verts: sub.verts, faces: sub.faces },
        graph,
        isCustomGraph: true,
        meshOnly,
        skeletonized: useSkeleton,
        ccLevel: ccIterations,
        rawMesh: { verts: baseVerts, faces: welded.faces }
    };

    appState.TILES.push(tile);
    if (actions.syncAdjRulesSize) actions.syncAdjRulesSize();
    return tile;
}

export function resubdivideImportedTiles(newLevel) {
    if (newLevel !== undefined) {
        appState.ccSubdivLevel = Math.max(0, Math.min(4, Math.round(Number(newLevel) || 0)));
    }
    const rngCC = $('rng-cc-level'), numCC = $('num-cc-level');
    if (rngCC) rngCC.value = String(appState.ccSubdivLevel);
    if (numCC) numCC.value = String(appState.ccSubdivLevel);
    setTxt('cc-level-label', `n = ${appState.ccSubdivLevel}`);
    syncSkeletonModeBadge();

    const useSkeleton = Boolean(appState.skeletonizeMeshTile);
    let updated = 0, totalEdges = 0, lastCustomId = null;
    for (const t of appState.TILES) {
        if (!t.isCustomGraph || t.meshOnly || !t.rawMesh) continue;
        const sub = catmullClarkSubdivide(t.rawMesh.verts, t.rawMesh.faces, appState.ccSubdivLevel);
        t.subMesh = { verts: sub.verts, faces: sub.faces };
        t.previewQuads = buildPreviewQuadsFromSubMesh(sub.verts, sub.faces);
        if (useSkeleton && typeof CORE.extractSkeletalGraphFromMesh === 'function') {
            const skel = CORE.extractSkeletalGraphFromMesh(t.rawMesh.verts, t.rawMesh.faces);
            t.graph = (skel && skel.edges && skel.edges.length > 0)
                ? { vertices: skel.vertices, edges: skel.edges }
                : extractGraphFromMesh(sub.verts, sub.faces);
        } else {
            t.graph = extractGraphFromMesh(sub.verts, sub.faces);
        }
        t.skeletonized = useSkeleton;
        t.sockets = detectTileSocketsFromGraph(t.graph.vertices);
        t.ccLevel = appState.ccSubdivLevel;
        totalEdges += t.graph.edges.length;
        lastCustomId = t.id;
        updated++;
    }
    if (updated > 0) {
        if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
        if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
        if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(lastCustomId);
        renderTileCatalogUI();
        if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
        if (actions.draw) actions.draw();
        const fb = $('mesh-module-feedback');
        if (fb) {
            fb.textContent = useSkeleton
                ? `Skeletonized ${updated} mesh module(s) → ${totalEdges} centerline edges`
                : `Re-subdivided ${updated} custom module(s) (CC n=${appState.ccSubdivLevel}) → ${totalEdges} graph edges`;
            fb.className = 'text-[10px] text-center font-mono text-emerald-400';
        }
    }
    return updated;
}

export function resubdivideMeshOnlyTiles(newLevel) {
    const level = Math.max(0, Math.min(4, Math.round(Number(newLevel) || 0)));
    const rng = $('rng-mesh-only-cc'), num = $('num-mesh-only-cc');
    if (rng) rng.value = String(level);
    if (num) num.value = String(level);
    setTxt('mesh-only-cc-label', `n = ${level}`);

    let updated = 0, totalQuads = 0, lastTileId = null;
    for (const t of appState.TILES) {
        if (!t.isCustomGraph || !t.meshOnly || !t.rawMesh) continue;
        const sub = catmullClarkSubdivide(t.rawMesh.verts, t.rawMesh.faces, level);
        t.subMesh = { verts: sub.verts, faces: sub.faces };
        t.quads = buildPreviewQuadsFromSubMesh(sub.verts, sub.faces);
        t.previewQuads = [];
        t.graph = { vertices: [], edges: [] };
        t.sockets = detectTileSocketsFromGraph(sub.verts);
        t.ccLevel = level;
        totalQuads += t.quads.length;
        lastTileId = t.id;
        updated++;
    }
    if (updated > 0) {
        if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
        if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
        if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(lastTileId);
        renderTileCatalogUI();
        if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
        if (actions.draw) actions.draw();
        const fb = $('mesh-only-tile-feedback');
        if (fb) {
            fb.textContent = `Re-subdivided ${updated} mesh tile(s) (CC n=${level}) → ${totalQuads} quads (no graph)`;
            fb.className = 'text-[10px] text-center font-mono text-emerald-400';
        }
    }
    return updated;
}

export function clearMeshOnlyTiles() {
    appState.TILES = appState.TILES.filter(t => !(t.isCustomGraph && t.meshOnly));
    appState.TILES.forEach((t, idx) => { t.id = idx; });
    if (!appState.TILES.some(t => t.enabled)) appState.TILES.slice(0, 4).forEach(t => { t.enabled = true; });
    if (!appState.TILES[appState.inspectedTileId]) appState.inspectedTileId = CORE.TILE_CROSS;
    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
    if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
    if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(CORE.TILE_CROSS);
    renderTileCatalogUI();
    if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
    if (actions.draw) actions.draw();
    zoomToBox(modelBoxToWorld(appState.modelBox));
    const fb = $('mesh-only-tile-feedback');
    if (fb) {
        fb.textContent = 'Cleared mesh-only tiles.';
        fb.className = 'text-[10px] text-center font-mono text-gray-400';
    }
}

export function setSkeletonizeMeshTile(on, liveReapply = true) {
    appState.skeletonizeMeshTile = Boolean(on);
    syncSkeletonModeBadge();
    if (liveReapply && appState.TILES.some(t => t.isCustomGraph && t.rawMesh)) {
        resubdivideImportedTiles(appState.ccSubdivLevel);
    }
}

export function clearCustomGraphTiles() {
    appState.TILES = appState.TILES.filter(t => !(t.isCustomGraph && !t.meshOnly));
    appState.TILES.forEach((t, idx) => { t.id = idx; });
    if (!appState.TILES.some(t => t.enabled)) appState.TILES.slice(0, 4).forEach(t => { t.enabled = true; });
    if (!appState.TILES[appState.inspectedTileId]) appState.inspectedTileId = CORE.TILE_CROSS;
    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
    if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
    if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(CORE.TILE_CROSS);
    renderTileCatalogUI();
    if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
    if (actions.draw) actions.draw();
    zoomToBox(modelBoxToWorld(appState.modelBox));
    const fb = $('mesh-module-feedback');
    if (fb) {
        fb.textContent = 'Cleared custom graph modules.';
        fb.className = 'text-[10px] text-center font-mono text-gray-400';
    }
}

export function setCCSubdivLevel(val, liveReapply = true) {
    appState.ccSubdivLevel = Math.max(0, Math.min(4, Math.round(Number(val) || 0)));
    const rngCC = $('rng-cc-level'), numCC = $('num-cc-level');
    if (rngCC) rngCC.value = String(appState.ccSubdivLevel);
    if (numCC) numCC.value = String(appState.ccSubdivLevel);
    setTxt('cc-level-label', `n = ${appState.ccSubdivLevel}`);
    if (liveReapply && appState.TILES.some(t => t.isCustomGraph)) {
        resubdivideImportedTiles(appState.ccSubdivLevel);
    }
}

export function initTab1Tiles() {
    actions.renderTileInspector3D = renderTileInspector3D;
    actions.renderTileCatalogUI = renderTileCatalogUI;
    actions.setTileViewMode = setTileViewMode;
    actions.parseOBJMeshes = parseOBJMeshes;
    actions.parse3dmMeshes = parse3dmMeshes;
    actions.parse3dmCurvesAsGraph = parse3dmCurvesAsGraph;
    actions.importMeshModuleFromData = importMeshModuleFromData;
    actions.importCurveModuleFromData = importCurveModuleFromData;
    actions.clearCustomGraphTiles = clearCustomGraphTiles;
    actions.clearMeshOnlyTiles = clearMeshOnlyTiles;
    actions.catmullClarkSubdivide = catmullClarkSubdivide;

    const btnInsp = $('btn-tile-view-inspector');
    const btnGrid = $('btn-tile-view-grid');
    if (btnInsp) btnInsp.addEventListener('click', () => setTileViewMode('inspector'));
    if (btnGrid) btnGrid.addEventListener('click', () => setTileViewMode('grid'));

    const btnAllOn = $('btn-tiles-all-on');
    if (btnAllOn) {
        btnAllOn.addEventListener('click', () => {
            appState.TILES.forEach((t, idx) => { t.enabled = idx > 0; });
            if (actions.recordChainStep) {
                actions.recordChainStep('tile_preset', {
                    preset: 'all_on',
                    enabledTiles: appState.TILES.filter(t => t.enabled).map(t => t.key)
                }, { label: 'Enable All Tiles' });
            }
            if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
            if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(appState.inspectedTileId > 0 ? appState.inspectedTileId : CORE.TILE_CROSS);
            renderTileCatalogUI();
            if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            if (actions.draw) actions.draw();
            zoomToBox(modelBoxToWorld(appState.modelBox));
        });
    }
    const btnOrtho = $('btn-tiles-ortho');
    if (btnOrtho) {
        btnOrtho.addEventListener('click', () => {
            appState.TILES.forEach((t, idx) => { t.enabled = (idx >= 1 && idx <= 3); });
            appState.inspectedTileId = CORE.TILE_CROSS;
            if (actions.recordChainStep) {
                actions.recordChainStep('tile_preset', {
                    preset: 'default_ortho',
                    enabledTiles: appState.TILES.filter(t => t.enabled).map(t => t.key)
                }, { label: 'Tile Preset: Ortho Set' });
            }
            if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
            if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(CORE.TILE_CROSS);
            renderTileCatalogUI();
            if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
            if (actions.draw) actions.draw();
            zoomToBox(modelBoxToWorld(appState.modelBox));
        });
    }

    ['rng-tile-voxel-size', 'num-tile-voxel-size'].forEach(id => {
        const el = $(id);
        if (!el) return;
        el.addEventListener('input', (e) => { if (actions.setVoxelSize) actions.setVoxelSize(parseFloat(e.target.value), { zoom: false, interactive: true }); });
        el.addEventListener('change', (e) => { if (actions.setVoxelSize) actions.setVoxelSize(parseFloat(e.target.value), { zoom: true, forceRebuild: true }); });
    });

    const chkSkelMesh = $('chk-skeletonize-mesh');
    if (chkSkelMesh) {
        chkSkelMesh.checked = Boolean(appState.skeletonizeMeshTile);
        chkSkelMesh.addEventListener('change', (e) => setSkeletonizeMeshTile(e.target.checked, true));
    }
    const skelBadgeBtn = $('skel-mode-badge');
    if (skelBadgeBtn) {
        skelBadgeBtn.addEventListener('click', () => setSkeletonizeMeshTile(!appState.skeletonizeMeshTile, true));
    }
    if (typeof window !== 'undefined') {
        window.addEventListener('pageshow', () => {
            const c = $('chk-skeletonize-mesh');
            if (c && Boolean(c.checked) !== Boolean(appState.skeletonizeMeshTile)) {
                setSkeletonizeMeshTile(c.checked, true);
            }
        });
    }
    syncSkeletonModeBadge();

    const rngCC = $('rng-cc-level'), numCC = $('num-cc-level');
    if (rngCC) rngCC.addEventListener('input', (e) => setCCSubdivLevel(e.target.value, true));
    if (numCC) {
        numCC.addEventListener('input', (e) => setCCSubdivLevel(e.target.value, true));
        numCC.addEventListener('change', (e) => setCCSubdivLevel(e.target.value, true));
    }
    const btnReapplyCC = $('btn-reapply-cc');
    if (btnReapplyCC) {
        btnReapplyCC.addEventListener('click', () => {
            const c = $('chk-skeletonize-mesh');
            if (c) appState.skeletonizeMeshTile = Boolean(c.checked);
            resubdivideImportedTiles(appState.ccSubdivLevel);
        });
    }
    const btnClearCustom = $('btn-clear-custom-tiles');
    if (btnClearCustom) btnClearCustom.addEventListener('click', clearCustomGraphTiles);

    const meshModuleInput = $('mesh-module-input');
    if (meshModuleInput) {
        meshModuleInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            const loadingOverlay = $('loading-overlay');
            const chkDisableBuiltin = $('chk-disable-builtin');
            const chkNormVoxel = $('chk-norm-voxel');
            const chkSkelNow = $('chk-skeletonize-mesh');
            if (chkSkelNow) {
                appState.skeletonizeMeshTile = Boolean(chkSkelNow.checked);
                syncSkeletonModeBadge();
            }
            const fb = $('mesh-module-feedback');
            if (loadingOverlay) loadingOverlay.classList.remove('hidden');
            let importedCount = 0, totalEdges = 0, lastImportedTile = null;
            try {
                await appState.rhinoReady;
                const disableBuiltins = chkDisableBuiltin ? chkDisableBuiltin.checked : true;
                for (const file of files) {
                    const ext = file.name.toLowerCase().split('.').pop();
                    let parsedModules = [];
                    let fileImported = false;
                    if (ext === 'obj') parsedModules = parseOBJMeshes(await file.text(), file.name);
                    else if (ext === '3dm') {
                        const buf = await file.arrayBuffer();
                        parsedModules = parse3dmMeshes(buf, file.name);
                        if (parsedModules.length === 0) {
                            const crvMod = parse3dmCurvesAsGraph(buf, file.name);
                            if (crvMod) {
                                const tile = importCurveModuleFromData(crvMod.name, crvMod.verts, crvMod.edges, {
                                    normalize: chkNormVoxel ? chkNormVoxel.checked : true
                                });
                                if (tile) { importedCount++; totalEdges += tile.graph.edges.length; lastImportedTile = tile; fileImported = true; }
                            }
                        }
                    }
                    for (const mod of parsedModules) {
                        const tile = importMeshModuleFromData(mod.name, mod.verts, mod.faces, {
                            ccLevel: appState.ccSubdivLevel,
                            normalize: chkNormVoxel ? chkNormVoxel.checked : true,
                            skeletonize: appState.skeletonizeMeshTile
                        });
                        if (tile) { importedCount++; totalEdges += tile.graph.edges.length; lastImportedTile = tile; fileImported = true; }
                    }
                    if (fileImported && actions.recordChainStep) {
                        const staged = actions.stageChainAsset ? await actions.stageChainAsset(file) : null;
                        actions.recordChainStep('tile_import', {
                            repoRelativePath: staged?.repoRelativePath || `TOPOGEN_FDM_Foundry/assets/inputs/${file.name}`,
                            originalName: file.name,
                            ccLevel: appState.ccSubdivLevel,
                            normalize: chkNormVoxel ? chkNormVoxel.checked : true,
                            skeletonize: Boolean(appState.skeletonizeMeshTile),
                            meshOnly: false,
                            customOnly: disableBuiltins
                        }, { label: `Import Tile: ${file.name}` });
                    }
                }
                if (importedCount > 0 && lastImportedTile) {
                    if (disableBuiltins) appState.TILES.forEach(t => { if (!t.isCustomGraph) t.enabled = false; });
                    appState.inspectedTileId = lastImportedTile.id;
                    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                    if (actions.clearUserImportedMeshes) actions.clearUserImportedMeshes();
                    appState.showCenterlineGraph = true;
                    appState.showQuadMeshes = true;
                    appState.groupVis.graph = true;
                    appState.groupVis.meshes = true;
                    const chkShowGraph = $('chk-show-graph'), chkShowMeshes = $('chk-show-meshes');
                    if (chkShowGraph) chkShowGraph.checked = true;
                    if (chkShowMeshes) chkShowMeshes.checked = true;
                    if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                    if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(lastImportedTile.id);
                    renderTileCatalogUI();
                    if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
                    if (actions.draw) actions.draw();
                    zoomToBox(modelBoxToWorld(appState.modelBox));
                    if (fb) {
                        const isCurveOnly = !lastImportedTile.rawMesh;
                        fb.textContent = isCurveOnly
                            ? `Imported ${importedCount} curve module(s) → ${totalEdges} graph edges`
                            : (appState.skeletonizeMeshTile
                                ? `Skeletonized ${importedCount} mesh module(s) → ${totalEdges} centerline edges`
                                : `Imported ${importedCount} module(s) (CC n=${appState.ccSubdivLevel}) → ${totalEdges} graph edges`);
                        fb.className = 'text-[10px] text-center font-mono text-emerald-400';
                    }
                } else if (fb) {
                    fb.textContent = 'No meshes or curves found in selected file(s).';
                    fb.className = 'text-[10px] text-center font-mono text-amber-400';
                }
            } catch (err) {
                console.error('Coarse mesh module import error:', err);
                if (fb) {
                    fb.textContent = `Import error: ${err.message || err}`;
                    fb.className = 'text-[10px] text-center font-mono text-rose-400';
                }
            } finally {
                meshModuleInput.value = '';
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
            }
        });
    }

    const getMeshOnlyCC = () => {
        const el = $('num-mesh-only-cc');
        return el ? Math.max(0, Math.min(4, Math.round(Number(el.value) || 0))) : 0;
    };
    const rngMeshOnlyCC = $('rng-mesh-only-cc'), numMeshOnlyCC = $('num-mesh-only-cc');
    const onMeshOnlyCCInput = (val) => {
        const n = Math.max(0, Math.min(4, Math.round(Number(val) || 0)));
        if (rngMeshOnlyCC) rngMeshOnlyCC.value = String(n);
        if (numMeshOnlyCC) numMeshOnlyCC.value = String(n);
        setTxt('mesh-only-cc-label', `n = ${n}`);
        if (appState.TILES.some(t => t.isCustomGraph && t.meshOnly)) {
            resubdivideMeshOnlyTiles(n);
        }
    };
    if (rngMeshOnlyCC) rngMeshOnlyCC.addEventListener('input', (e) => onMeshOnlyCCInput(e.target.value));
    if (numMeshOnlyCC) {
        numMeshOnlyCC.addEventListener('input', (e) => onMeshOnlyCCInput(e.target.value));
        numMeshOnlyCC.addEventListener('change', (e) => onMeshOnlyCCInput(e.target.value));
    }
    const btnReapplyMeshOnlyCC = $('btn-reapply-mesh-only-cc');
    if (btnReapplyMeshOnlyCC) btnReapplyMeshOnlyCC.addEventListener('click', () => resubdivideMeshOnlyTiles(getMeshOnlyCC()));
    const btnClearMeshOnly = $('btn-clear-mesh-only-tiles');
    if (btnClearMeshOnly) btnClearMeshOnly.addEventListener('click', clearMeshOnlyTiles);

    const meshOnlyInput = $('mesh-only-tile-input');
    if (meshOnlyInput) {
        meshOnlyInput.addEventListener('change', async (e) => {
            const files = Array.from(e.target.files || []);
            if (!files.length) return;
            const loadingOverlay = $('loading-overlay');
            const chkCustomOnly = $('chk-mesh-only-custom-only');
            const chkNorm = $('chk-mesh-only-norm');
            const fb = $('mesh-only-tile-feedback');
            if (loadingOverlay) loadingOverlay.classList.remove('hidden');
            let importedCount = 0, totalQuads = 0, lastImportedTile = null;
            try {
                await appState.rhinoReady;
                const ccLevel = getMeshOnlyCC();
                const disableBuiltins = chkCustomOnly ? chkCustomOnly.checked : true;
                for (const file of files) {
                    const ext = file.name.toLowerCase().split('.').pop();
                    let parsedModules = [];
                    let fileImported = false;
                    if (ext === 'obj') parsedModules = parseOBJMeshes(await file.text(), file.name);
                    else if (ext === '3dm') parsedModules = parse3dmMeshes(await file.arrayBuffer(), file.name);
                    for (const mod of parsedModules) {
                        const tile = importMeshModuleFromData(mod.name, mod.verts, mod.faces, {
                            ccLevel,
                            normalize: chkNorm ? chkNorm.checked : true,
                            meshOnly: true
                        });
                        if (tile) { importedCount++; totalQuads += tile.quads.length; lastImportedTile = tile; fileImported = true; }
                    }
                    if (fileImported && actions.recordChainStep) {
                        const staged = actions.stageChainAsset ? await actions.stageChainAsset(file) : null;
                        actions.recordChainStep('tile_import', {
                            repoRelativePath: staged?.repoRelativePath || `TOPOGEN_FDM_Foundry/assets/inputs/${file.name}`,
                            originalName: file.name,
                            ccLevel,
                            normalize: chkNorm ? chkNorm.checked : true,
                            skeletonize: false,
                            meshOnly: true,
                            customOnly: disableBuiltins
                        }, { label: `Import Mesh Tile: ${file.name}` });
                    }
                }
                if (importedCount > 0 && lastImportedTile) {
                    if (disableBuiltins) appState.TILES.forEach(t => { if (!t.isCustomGraph) t.enabled = false; });
                    appState.inspectedTileId = lastImportedTile.id;
                    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
                    if (actions.clearUserImportedMeshes) actions.clearUserImportedMeshes();
                    appState.showQuadMeshes = true;
                    appState.groupVis.meshes = true;
                    const chkShowMeshes = $('chk-show-meshes');
                    if (chkShowMeshes) chkShowMeshes.checked = true;
                    if (actions.resetSocketAdjacencyRules) actions.resetSocketAdjacencyRules();
                    if (actions.collapseFullGridImmediate) actions.collapseFullGridImmediate(lastImportedTile.id);
                    renderTileCatalogUI();
                    if (actions.renderAdjacencyMatrixUI) actions.renderAdjacencyMatrixUI();
                    if (actions.draw) actions.draw();
                    zoomToBox(modelBoxToWorld(appState.modelBox));
                    if (fb) {
                        fb.textContent = `Imported ${importedCount} mesh tile(s) (CC n=${ccLevel}) → ${totalQuads} quads (no graph)`;
                        fb.className = 'text-[10px] text-center font-mono text-emerald-400';
                    }
                } else if (fb) {
                    fb.textContent = 'No meshes found in selected file(s).';
                    fb.className = 'text-[10px] text-center font-mono text-amber-400';
                }
            } catch (err) {
                console.error('Mesh-only tile import error:', err);
                if (fb) {
                    fb.textContent = `Import error: ${err.message || err}`;
                    fb.className = 'text-[10px] text-center font-mono text-rose-400';
                }
            } finally {
                meshOnlyInput.value = '';
                if (loadingOverlay) loadingOverlay.classList.add('hidden');
            }
        });
    }
}

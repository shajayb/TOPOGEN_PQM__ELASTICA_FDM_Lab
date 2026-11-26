/**
 * WFC-FDM Foundry — Tab 4: All-Quad PQ Tubular Mesh Solidifier & Unroll (ui/tabs/tab4_pq_mesh.js)
 *
 * Student Quick-Map:
 *   - Edit Tab 4 sliders, checkboxes & subdiv buttons     -> mountTab4PqMesh()
 *   - Edit 3D tubular mesh shading, wireframe & inner bore -> renderTubularMesh()
 *   - Edit 2D PQ strip preview canvas (PCA-aligned)        -> drawUnrolledLoopCanvas()
 *   - Edit 3D ground-plane laser sheet unroll preview      -> renderUnrolledStrips3D()
 *   - Edit Solidify / Longitudinal / CC / Ring / PQ ops    -> solidifyActiveGraph(), apply*FromUI()
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    TUBE_DEFAULTS,
    UI_LOOP_PALETTE,
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
    recomputeModelBox
} from '../display/viewport_scene.js';
import { applyOutlinerVisibility, refreshOutliner } from '../display/display_hud.js';

let unrollStripMats = null;
function getUnrollStripMats() {
    if (!unrollStripMats) {
        unrollStripMats = UI_LOOP_PALETTE.map(hex => new THREE.MeshBasicMaterial({
            color: hex, transparent: true, opacity: 0.88, side: THREE.DoubleSide
        }));
    }
    return unrollStripMats;
}

export function mountTab4PqMesh() {
    const pane = $('tab-pq');
    if (!pane) return;
    pane.innerHTML = `
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2 space-y-1.5 text-[10px] font-mono">
            <div class="flex items-center justify-between gap-2 min-w-0 h-4 font-sans">
                <span id="pq-panel-title" class="text-[10px] font-semibold uppercase tracking-wider text-pink-400 truncate">PQ Tubular Solidifier</span>
                <span id="tube-manifold-badge" class="text-[9px] font-mono tabular-nums whitespace-nowrap shrink-0 text-gray-400">Not Built</span>
            </div>

            <div id="pq-host-mesh-banner" class="hidden rounded px-2 py-1.5 font-sans text-[9.5px] leading-snug border" style="background:#f0f9ff; border-color:#0284c7; color:#0f172a;">
                <strong style="color:#0369a1;">Host Mesh Mode (Mesh Tiles)</strong> — Graph-to-tube solidification skipped; downstream PQ subdivision, planarization, coloring &amp; unrolling operate directly on the mesh.
            </div>

            <div id="pq-tube-solidifier-controls" class="space-y-1.5">
            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Outer R</span>
                <input type="range" id="rng-tube-radius" min="0.040" max="0.200" step="0.001" value="0.0600" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-tube-radius" class="w-12 text-right tabular-nums text-gray-200 flex-shrink-0">0.060m</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Inner R</span>
                <input type="range" id="rng-tube-inner-radius" min="0.000" max="0.199" step="0.001" value="0.0300" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-tube-inner-radius" class="w-12 text-right tabular-nums text-gray-200 flex-shrink-0">0.030m</span>
            </div>

            <div id="tube-status-badge" class="bg-gray-950/75 border border-gray-800 rounded px-1.5 py-0.5 text-[8.5px] font-mono text-cyan-300 flex items-center justify-between">
                <span>t = 30.0 mm (Ro 60.0 · Ri 30.0 mm)</span>
                <span class="text-gray-400">Miter Clamp: ON</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Sides (N)</span>
                <input type="range" id="rng-tube-sides" min="4" max="16" step="2" value="8" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-tube-sides" class="w-12 text-right text-gray-200 flex-shrink-0">8</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Subdiv (L)</span>
                <input type="range" id="rng-tube-subdiv" min="0" max="4" step="1" value="1" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-tube-subdiv" class="w-12 text-right text-gray-200 flex-shrink-0">1</span>
            </div>
            <input type="range" id="rng-tube-offset" min="0.02" max="0.40" step="0.01" value="0.04" class="hidden">
            <span id="val-tube-offset" class="hidden">0.04m</span>

            <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[9px] font-sans text-gray-300">
                <label class="flex items-center space-x-1 cursor-pointer" title="Stitch tube rings along exact bisector planes at junctions">
                    <input type="checkbox" id="chk-tube-bisector" checked class="accent-pink-500 rounded">
                    <span>Bisector</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Miter Clamp — Limit joint radius at acute angles to prevent overlap.">
                    <input type="checkbox" id="chk-tube-miter-clamp" checked class="accent-amber-400 rounded">
                    <span>Miter Clamp</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Negotiated face-loop Planar Quad (PQ) optimization">
                    <input type="checkbox" id="chk-tube-pq" checked class="accent-cyan-400 rounded">
                    <span>PQ Planarize</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Leaf Caps — Seal open pipe ends with planar quad caps.">
                    <input type="checkbox" id="chk-tube-cap-leaves" checked class="accent-pink-500 rounded">
                    <span>Caps</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Toggle 3D tubular mesh visibility in viewport">
                    <input type="checkbox" id="chk-tube-show" checked class="accent-pink-500 rounded">
                    <span>Show</span>
                </label>
            </div>

            <button id="btn-solidify-tubes" class="cad-btn on w-full py-1.5">⚡ Solidify → All-Quad PQ</button>
            </div>

            <div class="grid grid-cols-2 gap-1 pt-0.5 font-sans">
                <button id="btn-reset-pq-default" class="cad-btn text-[9px] py-1" title="Reset all PQ tube parameters to default values and rebuild default tube on active graph">↺ Reset Tube Default</button>
                <button id="btn-reset-pq-graph" class="cad-btn text-[9px] py-1" title="Clear solidified PQ mesh and revert viewport to centerline graph">↺ Reset to Graph</button>
            </div>

            <div class="grid grid-cols-2 gap-1 pt-0.5 font-sans">
                <button id="btn-long-subdiv-pq" class="cad-btn cyan text-[9px] py-1" title="Apply 1 level of 1D Cubic B-Spline Longitudinal Subdivision + Negotiated PQ Planarization">═ Longitudinal Subdiv + PQ</button>
                <button id="btn-cc-subdiv-pq" class="cad-btn accent text-[9px] py-1" title="Apply 1 level of Catmull-Clark Subdivision + Negotiated PQ Planarization">⊞ Catmull-Clark + PQ</button>
                <button id="btn-ring-subdiv-pq" class="cad-btn cyan text-[9px] py-1" title="Apply 1 level of 1D Cubic B-Spline Ring Subdivision + Negotiated PQ Planarization">◎ Ring Subdiv + PQ</button>
                <button id="btn-only-pq-opt" class="cad-btn accent text-[9px] py-1" title="Run Negotiated Face-Loop PQ Planarization Only without changing mesh topology">✦ Only PQ Optimisation</button>
            </div>
            <button id="btn-swap-long-ring" class="cad-btn w-full text-[9px] py-1 font-sans" title="Swap longitudinal and ring directions on the active PQ mesh (rotates quad winding 90° while keeping outward normals)">⇄ Swap Long ↔ Ring Directions</button>

            <div class="pt-1 border-t border-gray-800 space-y-1 font-sans">
                <div class="flex items-center justify-between text-[9px] text-gray-400">
                    <span class="uppercase font-semibold tracking-wider">Coloring Mode</span>
                    <span id="tube-loop-count-badge" class="font-mono text-pink-400">0 loops</span>
                </div>
                <div class="grid grid-cols-2 gap-1">
                    <button data-tube-color="longitudinal" class="tube-color-btn cad-btn seg-on text-[9px] py-0.5">Longitudinal Strips</button>
                    <button data-tube-color="solid"        class="tube-color-btn cad-btn text-[9px] py-0.5">Solid</button>
                    <button data-tube-color="ring"         class="tube-color-btn cad-btn text-[9px] py-0.5">Ring Loops</button>
                    <button data-tube-color="heatmap"      class="tube-color-btn cad-btn text-[9px] py-0.5">Planarity Heatmap</button>
                </div>
            </div>

            <div class="pt-1 border-t border-gray-800 space-y-1 font-sans">
                <button id="btn-toggle-unroll-3d" class="cad-btn cyan w-full py-1 flex items-center justify-between text-[9.5px]" title="Render flat 2D unrolled PQ face-loop strips on the ground plane alongside the 3D structure">
                    <span>Toggle 3D Unrolled PQ Strips</span>
                    <span id="unroll-3d-state" class="font-mono text-[9px] opacity-90">OFF</span>
                </button>
                <div class="flex items-center justify-between text-[8.5px] font-mono text-gray-400">
                    <span id="unroll-loop-label" class="text-cyan-400 truncate">2D PQ Strip Preview (click to cycle)</span>
                </div>
                <canvas id="unroll-canvas" width="308" height="82" class="w-full bg-gray-950 border border-gray-800 rounded cursor-pointer" title="Click to cycle through unrolled PQ face loops"></canvas>
            </div>

            <div id="tube-readout" class="bg-gray-950/80 border border-gray-800 rounded px-1.5 py-1 min-h-[2.25rem] text-[9px] tabular-nums text-gray-300 leading-snug">
                V: 0 · Quads: 0 · Tris: 0 · Manifold: —
            </div>
        </div>
    `;
}

function buildQuadDominantWireframeGeometry(vertices, quads, triangles) {
    const uniqueEdges = new Set();
    const addEdge = (a, b) => uniqueEdges.add(a < b ? `${a},${b}` : `${b},${a}`);
    for (const q of quads) { addEdge(q[0], q[1]); addEdge(q[1], q[2]); addEdge(q[2], q[3]); addEdge(q[3], q[0]); }
    for (const t of triangles) { addEdge(t[0], t[1]); addEdge(t[1], t[2]); addEdge(t[2], t[0]); }
    const wireframePositions = new Float32Array(uniqueEdges.size * 6);
    let ptr = 0;
    for (const edgeStr of uniqueEdges) {
        const comma = edgeStr.indexOf(',');
        const a = parseInt(edgeStr.slice(0, comma), 10);
        const b = parseInt(edgeStr.slice(comma + 1), 10);
        const va = vertices[a], vb = vertices[b];
        if (!va || !vb) continue;
        wireframePositions[ptr++] = va.x; wireframePositions[ptr++] = va.y; wireframePositions[ptr++] = va.z;
        wireframePositions[ptr++] = vb.x; wireframePositions[ptr++] = vb.y; wireframePositions[ptr++] = vb.z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(wireframePositions.subarray(0, ptr), 3));
    return geo;
}

function localQuadRelPlanarity(vertices, q) {
    const p0 = vertices[q[0]], p1 = vertices[q[1]], p2 = vertices[q[2]], p3 = vertices[q[3]];
    if (!p0 || !p1 || !p2 || !p3) return 0;
    const d1x = p2.x - p0.x, d1y = p2.y - p0.y, d1z = p2.z - p0.z;
    const d2x = p3.x - p1.x, d2y = p3.y - p1.y, d2z = p3.z - p1.z;
    const nx = d1y * d2z - d1z * d2y, ny = d1z * d2x - d1x * d2z, nz = d1x * d2y - d1y * d2x;
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-10) return 0;
    const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y, sz = p0.z - p1.z + p2.z - p3.z;
    const skewDist = Math.abs(sx * nx + sy * ny + sz * nz) / (2 * nLen);
    const avgDiag = 0.5 * (Math.hypot(d1x, d1y, d1z) + Math.hypot(d2x, d2y, d2z));
    return skewDist / Math.max(avgDiag, 1e-6);
}

export function walkAndRefreshFaceLoops(solid, { unrollAll = false } = {}) {
    const { faceLoopState, tubeState } = appState;
    if (!solid || !solid.vertices || !solid.quads || solid.quads.length === 0) {
        faceLoopState.loops = [];
        faceLoopState.quadToLoopId = [];
        drawUnrolledLoopCanvas();
        return;
    }
    const dir = tubeState.colorMode === 'ring' ? 'ring' : 'longitudinal';
    const res = CORE.walkMeshFaceLoops(solid.vertices, solid.quads, dir, {
        inheritedQuadColors: faceLoopState.quadInheritedColors ? faceLoopState.quadInheritedColors[dir] : null,
        quadParentLoopIds: faceLoopState.quadParentLoopIds ? faceLoopState.quadParentLoopIds[dir] : null
    });
    faceLoopState.loops = res.loops || [];
    faceLoopState.quadToLoopId = res.quadToLoopId || new Int32Array(solid.quads.length).fill(-1);
    if (res.quadInheritedColors) faceLoopState.quadInheritedColors = res.quadInheritedColors;
    if (res.quadParentLoopIds) faceLoopState.quadParentLoopIds = res.quadParentLoopIds;
    if (res.parentLoopAdjacency) faceLoopState.parentLoopAdjacency = res.parentLoopAdjacency;
    if (res.pqStats) faceLoopState.pqStats = res.pqStats;

    if (unrollAll || faceLoopState.showUnrolled3D) {
        for (const lp of faceLoopState.loops) {
            if (!lp.unrolled2D) lp.unrolled2D = CORE.unrollFaceLoop2D(solid.vertices, solid.quads, lp);
        }
    }
    if (faceLoopState.selectedLoopIdx >= faceLoopState.loops.length) faceLoopState.selectedLoopIdx = 0;
    setTxt('tube-loop-count-badge', `${faceLoopState.loops.length} loops`);
    drawUnrolledLoopCanvas();
}

export function drawUnrolledLoopCanvas() {
    const unrollCanvas = $('unroll-canvas');
    const unrollLabel = $('unroll-loop-label');
    if (!unrollCanvas) return;
    const ctx = unrollCanvas.getContext('2d');
    const W = unrollCanvas.width, H = unrollCanvas.height;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, W, H);

    const loops = appState.faceLoopState.loops;
    if (!loops || loops.length === 0) {
        if (unrollLabel) {
            unrollLabel.textContent = '2D PQ Strip Preview (solidify first)';
            unrollLabel.style.color = '';
        }
        return;
    }
    const rawSel = appState.faceLoopState.selectedLoopIdx;
    if (rawSel === null || rawSel === undefined || rawSel < 0) {
        if (unrollLabel) {
            unrollLabel.textContent = `No loop selected (${loops.length} loops · click 3D mesh or strip)`;
            unrollLabel.style.color = '';
        }
        return;
    }
    const selIdx = Math.max(0, Math.min(loops.length - 1, rawSel));
    const loop = loops[selIdx];
    if (!loop.unrolled2D && appState.lastSolidData && appState.lastSolidData.vertices && appState.lastSolidData.quads) {
        loop.unrolled2D = CORE.unrollFaceLoop2D(appState.lastSolidData.vertices, appState.lastSolidData.quads, loop);
    }
    const u2d = loop.unrolled2D;
    if (!u2d || !u2d.quads2D || u2d.quads2D.length === 0) return;

    const hexVal = (loop.colorHex !== undefined ? loop.colorHex : 0x38bdf8);
    const hexStr = '#' + hexVal.toString(16).padStart(6, '0');
    if (unrollLabel) {
        const errPct = ((loop.maxPlanarityErr || 0) * 100).toFixed(2);
        unrollLabel.textContent = `Loop #${loop.id + 1}/${loops.length} (${loop.steps.length}Q · warp ${errPct}%) · click cycle`;
        unrollLabel.style.color = hexStr;
    }

    let cx2 = 0, cy2 = 0, nPts = 0;
    u2d.quads2D.forEach(q2 => q2.pts.forEach(p => { cx2 += p.x; cy2 += p.y; nPts++; }));
    cx2 /= Math.max(nPts, 1); cy2 /= Math.max(nPts, 1);
    let covXX = 0, covYY = 0, covXY = 0;
    u2d.quads2D.forEach(q2 => q2.pts.forEach(p => {
        const dx = p.x - cx2, dy = p.y - cy2;
        covXX += dx * dx; covYY += dy * dy; covXY += dx * dy;
    }));
    const ang = -0.5 * Math.atan2(2 * covXY, covXX - covYY);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const rotQuads = u2d.quads2D.map(q2 => q2.pts.map(p => {
        const dx = p.x - cx2, dy = p.y - cy2;
        const rx = dx * ca - dy * sa, ry = dx * sa + dy * ca;
        if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
        if (ry < minY) minY = ry; if (ry > maxY) maxY = ry;
        return { x: rx, y: ry };
    }));

    const pad = 10;
    const scale = Math.min((W - pad * 2) / Math.max(maxX - minX, 1e-4), (H - pad * 2) / Math.max(maxY - minY, 1e-4));
    const ox = W * 0.5 - ((minX + maxX) * 0.5) * scale;
    const oy = H * 0.5 + ((minY + maxY) * 0.5) * scale;

    rotQuads.forEach((pts, idx) => {
        const sp = pts.map(p => ({ x: ox + p.x * scale, y: oy - p.y * scale }));
        ctx.fillStyle = hexStr + '44';
        ctx.strokeStyle = hexStr;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(sp[0].x, sp[0].y);
        ctx.lineTo(sp[1].x, sp[1].y);
        ctx.lineTo(sp[2].x, sp[2].y);
        ctx.lineTo(sp[3].x, sp[3].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        if (idx < rotQuads.length - 1) {
            ctx.save();
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 0.9;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(sp[2].x, sp[2].y);
            ctx.lineTo(sp[3].x, sp[3].y);
            ctx.stroke();
            ctx.restore();
        }
    });
}

export function computeUnrolledSheetGridLayout(sheets, startX, tMinY, tMaxY, gapX = 0.10, gapY = 0.10) {
    const safeSheets = (sheets && sheets.length > 0)
        ? sheets
        : [{ sheetIndex: 0, widthM: 0.60, heightM: 0.90, bbox2D: [0, 0, 0.60, 0.90] }];
    const nSheets = safeSheets.length;
    const nCols = Math.max(1, Math.ceil(Math.sqrt(nSheets)));
    const nRows = Math.ceil(nSheets / nCols);
    const maxSheetW = Math.max(...safeSheets.map(s => s.bbox2D[2] - s.bbox2D[0]), 0.60);
    const maxSheetH = Math.max(...safeSheets.map(s => s.bbox2D[3] - s.bbox2D[1]), 0.90);
    const totalGridH = nRows * maxSheetH + Math.max(0, nRows - 1) * gapY;
    const gridTopY = (tMinY + tMaxY) * 0.5 + totalGridH * 0.5;

    const sheetTransforms = safeSheets.map((sh, sIdx) => {
        const col = sIdx % nCols;
        const row = Math.floor(sIdx / nCols);
        const shW = sh.bbox2D[2] - sh.bbox2D[0];
        const shH = sh.bbox2D[3] - sh.bbox2D[1];
        const targetX0 = startX + col * (maxSheetW + gapX);
        const targetY0 = gridTopY - row * (maxSheetH + gapY) - shH;
        return {
            sheetIndex: sh.sheetIndex ?? sIdx,
            dx: targetX0 - sh.bbox2D[0],
            dy: targetY0 - sh.bbox2D[1],
            minX: targetX0,
            minY: targetY0,
            maxX: targetX0 + shW,
            maxY: targetY0 + shH
        };
    });
    return { nCols, nRows, sheetTransforms };
}

export function buildUnrolledPatternsDataForUI(solid = appState.lastSolidData, graph = null) {
    if (!solid || !solid.vertices || solid.vertices.length === 0) return null;
    const { faceLoopState, tubeState, currentTilePreset } = appState;
    const activeGraph = graph || (actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null);
    const hasGraphEdges = Boolean(activeGraph && Array.isArray(activeGraph.edges) && activeGraph.edges.length > 0);

    if (hasGraphEdges) {
        const res = CORE.buildUnrolledPatterns(activeGraph, solid, {
            name: `unroll3d_${currentTilePreset}`,
            outerRadiusM: tubeState.radius,
            nSides: tubeState.nSides,
            longitudinalSubdivLevels: tubeState.longitudinalSubdivLevels,
            laserBedWidthM: 0.60,
            laserBedHeightM: 0.90,
            laserSheetGapM: 0.08
        });
        if (res && res.unrolledJson && Array.isArray(res.unrolledJson.bars) && res.unrolledJson.bars.length > 0) {
            return { unrolledJson: res.unrolledJson, patternsSvg: res.patternsSvg || null, source: 'graph' };
        }
    }

    if (!faceLoopState.loops || faceLoopState.loops.length === 0) {
        walkAndRefreshFaceLoops(solid);
    } else {
        for (const lp of faceLoopState.loops) {
            if (!lp.unrolled2D) lp.unrolled2D = CORE.unrollFaceLoop2D(solid.vertices, solid.quads, lp);
        }
    }
    if (!faceLoopState.loops || faceLoopState.loops.length === 0) return null;

    // Direct face-loop sheet packing for Host Mesh Mode (mesh tiles without graph edges)
    const bedW = 0.60, bedH = 0.90, gap = 0.06;
    const bars = [];
    const sheets = [{ sheetIndex: 0, widthM: bedW, heightM: bedH, bbox2D: [0, 0, bedW, bedH] }];
    let curX = gap, curY = gap, rowH = 0, sIdx = 0;
    faceLoopState.loops.forEach((lp, lIdx) => {
        const u2d = lp.unrolled2D;
        if (!u2d || !u2d.quads2D || u2d.quads2D.length === 0) return;
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const q2 of u2d.quads2D) {
            for (const p of q2.pts) {
                if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
            }
        }
        const w = Math.max(1e-4, maxX - minX), h = Math.max(1e-4, maxY - minY);
        if (curX + w + gap > bedW && curX > gap) { curX = gap; curY += rowH + gap; rowH = 0; }
        if (curY + h + gap > bedH && curY > gap) {
            sIdx++;
            sheets.push({ sheetIndex: sIdx, widthM: bedW, heightM: bedH, bbox2D: [0, 0, bedW, bedH] });
            curX = gap; curY = gap; rowH = 0;
        }
        const dx = curX - minX, dy = curY - minY;
        const quads2D = u2d.quads2D.map(q2 => q2.pts.map(p => [p.x + dx, p.y + dy]));
        bars.push({ edgeIndex: lIdx, sheetIndex: sIdx, quads2D });
        curX += w + gap;
        if (h > rowH) rowH = h;
    });
    if (bars.length === 0) return null;
    return { unrolledJson: { bars, sheets }, patternsSvg: null, source: 'face_loops' };
}

export function renderUnrolledStrips3D() {
    clearGroup(viewport.unroll3DGroup);
    const { faceLoopState, lastSolidData, arcticOn } = appState;
    if (!faceLoopState.showUnrolled3D || !lastSolidData || !lastSolidData.vertices || lastSolidData.vertices.length === 0) {
        viewport.unroll3DGroup.visible = false;
        return;
    }

    let tMinX = Infinity, tMaxX = -Infinity, tMinY = Infinity, tMaxY = -Infinity;
    for (const v of lastSolidData.vertices) {
        if (v.x < tMinX) tMinX = v.x; if (v.x > tMaxX) tMaxX = v.x;
        if (v.y < tMinY) tMinY = v.y; if (v.y > tMaxY) tMaxY = v.y;
    }
    if (!Number.isFinite(tMaxX)) { tMinX = -0.5; tMaxX = 0.5; tMinY = -0.5; tMaxY = 0.5; }
    const startX = tMaxX + 0.45;
    const zPlane = 0.006;

    const unrollPack = buildUnrolledPatternsDataForUI(lastSolidData);
    if (unrollPack && unrollPack.unrolledJson) {
        const unrolledJson = unrollPack.unrolledJson;
        faceLoopState.unrolledBedLayout = { unrolledJson, startX, tMinY, tMaxY, zPlane };
        const bars = (unrolledJson && unrolledJson.bars) ? unrolledJson.bars : [];
        const sheets = (unrolledJson && unrolledJson.sheets && unrolledJson.sheets.length > 0)
            ? unrolledJson.sheets : [{ sheetIndex: 0, widthM: 0.60, heightM: 0.90, bbox2D: [0, 0, 0.60, 0.90] }];
        if (bars.length > 0) {
            const { nCols, nRows, sheetTransforms } = computeUnrolledSheetGridLayout(sheets, startX, tMinY, tMaxY);

            faceLoopState.unrolledBedLayout.grid = { nCols, nRows, sheetTransforms };
            faceLoopState.stripCentroidsByLoopId = new Map();
            const mats = getUnrollStripMats();

            for (const bar of bars) {
                const qs = bar.quads2D || [];
                if (qs.length === 0) continue;
                const st = sheetTransforms[bar.sheetIndex || 0] || sheetTransforms[0];
                const pos = [], idx = [], wire = [];
                let sumX = 0, sumY = 0, ptCnt = 0;
                for (const q of qs) {
                    const base = pos.length / 3;
                    for (let k = 0; k < 4; k++) {
                        const wx = q[k][0] + st.dx, wy = q[k][1] + st.dy;
                        pos.push(wx, wy, zPlane);
                        sumX += wx; sumY += wy; ptCnt++;
                    }
                    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
                    for (let k = 0; k < 4; k++) {
                        const a = q[k], b = q[(k + 1) % 4];
                        wire.push(a[0] + st.dx, a[1] + st.dy, zPlane + 0.001, b[0] + st.dx, b[1] + st.dy, zPlane + 0.001);
                    }
                }
                const stripCenter = ptCnt > 0 ? new THREE.Vector3(sumX / ptCnt, sumY / ptCnt, zPlane) : new THREE.Vector3(st.dx, st.dy, zPlane);
                faceLoopState.stripCentroidsByLoopId.set(bar.edgeIndex, stripCenter);
                const sGeo = new THREE.BufferGeometry();
                sGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
                sGeo.setIndex(idx);
                sGeo.computeVertexNormals();
                const lp = faceLoopState.loops ? faceLoopState.loops[bar.edgeIndex] : null;
                let sMat;
                if (lp && lp.colorHex !== undefined) {
                    const c = new THREE.Color(lp.colorHex).lerp(new THREE.Color(0xffffff), 0.22);
                    sMat = new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide });
                } else {
                    sMat = mats[bar.edgeIndex % mats.length];
                }
                const sMesh = new THREE.Mesh(sGeo, arcticOn ? sharedMaterials.arctic : sMat);
                sMesh.userData.baseMaterial = sMat;
                sMesh.userData.unrollLoopId = bar.edgeIndex;
                sMesh.userData.stripCentroid = stripCenter;
                viewport.unroll3DGroup.add(sMesh);

                const wGeo = new THREE.BufferGeometry();
                wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
                viewport.unroll3DGroup.add(new THREE.LineSegments(wGeo, sharedMaterials.tubeWire));
            }

            const bCoords = [];
            for (const st of sheetTransforms) {
                const { minX: bMinX, maxX: bMaxX, minY: bMinY, maxY: bMaxY } = st;
                bCoords.push(
                    bMinX, bMinY, zPlane - 0.002,  bMaxX, bMinY, zPlane - 0.002,
                    bMaxX, bMinY, zPlane - 0.002,  bMaxX, bMaxY, zPlane - 0.002,
                    bMaxX, bMaxY, zPlane - 0.002,  bMinX, bMaxY, zPlane - 0.002,
                    bMinX, bMaxY, zPlane - 0.002,  bMinX, bMinY, zPlane - 0.002
                );
            }
            const bGeo = new THREE.BufferGeometry();
            bGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(bCoords), 3));
            viewport.unroll3DGroup.add(new THREE.LineSegments(bGeo, sharedMaterials.bedBorder));
            viewport.unroll3DGroup.visible = true;
            renderLoopCorrespondenceArc();
            return;
        }
    }
    viewport.unroll3DGroup.visible = false;
}

export function renderLoopCorrespondenceArc() {
    const oldArcs = viewport.unroll3DGroup.children.filter(c => c.userData && c.userData.isCorrespondenceArc);
    for (const c of oldArcs) {
        viewport.unroll3DGroup.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
    }
    const { faceLoopState } = appState;
    if (!faceLoopState.showUnrolled3D || !faceLoopState.loops || faceLoopState.loops.length === 0) {
        if (viewport.requestRender) viewport.requestRender();
        return;
    }
    const selIdx = faceLoopState.selectedLoopIdx;
    if (selIdx === null || selIdx === undefined || selIdx < 0) {
        if (viewport.requestRender) viewport.requestRender();
        return;
    }
    const loop = faceLoopState.loops[selIdx];
    const stripEnd = faceLoopState.stripCentroidsByLoopId ? faceLoopState.stripCentroidsByLoopId.get(selIdx) : null;
    if (!loop || !loop.centroid3D || !stripEnd) return;

    const p0 = new THREE.Vector3(loop.centroid3D.x, loop.centroid3D.y, loop.centroid3D.z);
    const p2 = stripEnd.clone();
    const dist = p0.distanceTo(p2);
    const arcLift = Math.max(0.35, dist * 0.45);
    const p1 = new THREE.Vector3(
        0.5 * (p0.x + p2.x),
        0.5 * (p0.y + p2.y),
        Math.max(p0.z, p2.z) + arcLift
    );
    const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
    const colorHex = loop.colorHex !== undefined ? loop.colorHex : 0xf97316;

    const tubeGeo = new THREE.TubeGeometry(curve, 36, 0.012, 8, false);
    const tubeMat = new THREE.MeshBasicMaterial({ color: colorHex });
    const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
    tubeMesh.userData.isCorrespondenceArc = true;
    viewport.unroll3DGroup.add(tubeMesh);

    const endGeo = new THREE.SphereGeometry(0.026, 12, 12);
    for (const pt of [p0, p2]) {
        const endMat = new THREE.MeshBasicMaterial({ color: colorHex });
        const dot = new THREE.Mesh(endGeo.clone(), endMat);
        dot.position.copy(pt);
        dot.userData.isCorrespondenceArc = true;
        viewport.unroll3DGroup.add(dot);
    }
    endGeo.dispose();
    if (viewport.requestRender) viewport.requestRender();
}

export function selectPqLoopById(loopId) {
    const { faceLoopState } = appState;
    if (loopId === null || loopId === undefined || (typeof loopId === 'number' && loopId < 0)) {
        faceLoopState.selectedLoopIdx = null;
        drawUnrolledLoopCanvas();
        renderLoopCorrespondenceArc();
        if (viewport.requestRender) viewport.requestRender();
        return null;
    }
    if (!faceLoopState.loops || faceLoopState.loops.length === 0) return null;
    const numericId = Number(loopId);
    if (!Number.isFinite(numericId)) {
        faceLoopState.selectedLoopIdx = null;
        drawUnrolledLoopCanvas();
        renderLoopCorrespondenceArc();
        if (viewport.requestRender) viewport.requestRender();
        return null;
    }
    const idx = ((Math.trunc(numericId) % faceLoopState.loops.length) + faceLoopState.loops.length) % faceLoopState.loops.length;
    faceLoopState.selectedLoopIdx = idx;
    drawUnrolledLoopCanvas();
    if (faceLoopState.showUnrolled3D) {
        renderLoopCorrespondenceArc();
    } else if (viewport.requestRender) {
        viewport.requestRender();
    }
    return idx;
}

export function renderTubularMesh(solid, opts = {}) {
    clearGroup(viewport.tubeGroup);
    if (!solid || !solid.vertices || solid.vertices.length === 0) return;
    const { tubeState, faceLoopState, arcticOn, wireframeOn } = appState;
    const { vertices, quads, triangles } = solid;
    const totalTris = quads.length * 2 + triangles.length;
    const posArr = new Float32Array(totalTris * 9);
    const colArr = new Float32Array(totalTris * 9);

    const solidIvory = new THREE.Color(0xe2e8f0);
    const triSlate = new THREE.Color(0x94a3b8);
    const heatEmerald = new THREE.Color(0x10b981);
    const heatAmber = new THREE.Color(0xf59e0b);
    const heatCrimson = new THREE.Color(0xf43f5e);
    const tmpC = new THREE.Color();
    let ptr = 0;

    const pushTri = (i0, i1, i2, c) => {
        const v0 = vertices[i0], v1 = vertices[i1], v2 = vertices[i2];
        posArr[ptr]     = v0.x; posArr[ptr + 1] = v0.y; posArr[ptr + 2] = v0.z;
        posArr[ptr + 3] = v1.x; posArr[ptr + 4] = v1.y; posArr[ptr + 5] = v1.z;
        posArr[ptr + 6] = v2.x; posArr[ptr + 7] = v2.y; posArr[ptr + 8] = v2.z;
        colArr[ptr]     = c.r;  colArr[ptr + 1] = c.g;  colArr[ptr + 2] = c.b;
        colArr[ptr + 3] = c.r;  colArr[ptr + 4] = c.g;  colArr[ptr + 5] = c.b;
        colArr[ptr + 6] = c.r;  colArr[ptr + 7] = c.g;  colArr[ptr + 8] = c.b;
        ptr += 9;
    };

    const mode = tubeState.colorMode;
    for (let qi = 0; qi < quads.length; qi++) {
        const q = quads[qi];
        if (mode === 'heatmap') {
            const relErr = localQuadRelPlanarity(vertices, q);
            if (relErr <= 0.005) tmpC.copy(heatEmerald).lerp(heatAmber, Math.min(1, relErr / 0.005));
            else tmpC.copy(heatAmber).lerp(heatCrimson, Math.min(1, (relErr - 0.005) / 0.02));
        } else if ((mode === 'longitudinal' || mode === 'ring') && faceLoopState.quadToLoopId && faceLoopState.quadToLoopId[qi] >= 0) {
            const lid = faceLoopState.quadToLoopId[qi];
            const lp = faceLoopState.loops[lid];
            tmpC.setHex(lp && lp.colorHex !== undefined ? lp.colorHex : UI_LOOP_PALETTE[lid % UI_LOOP_PALETTE.length]);
            tmpC.lerp(new THREE.Color(0xffffff), 0.22);
        } else {
            tmpC.copy(solidIvory);
        }
        pushTri(q[0], q[1], q[2], tmpC);
        pushTri(q[0], q[2], q[3], tmpC);
    }
    for (let ti = 0; ti < triangles.length; ti++) {
        const t = triangles[ti];
        pushTri(t[0], t[1], t[2], mode === 'solid' ? solidIvory : triSlate);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, arcticOn ? sharedMaterials.arctic : sharedMaterials.tubeVertexColored);
    mesh.userData.isTubeSurface = true;
    mesh.userData.baseMaterial = sharedMaterials.tubeVertexColored;
    mesh.visible = !wireframeOn;
    viewport.tubeGroup.add(mesh);

    const wireGeo = buildQuadDominantWireframeGeometry(vertices, quads, triangles);
    viewport.tubeGroup.add(new THREE.LineSegments(wireGeo, sharedMaterials.tubeWire));

    // Viewport-only hollow wall-thickness & inner-bore preview
    const safeOuterR = Math.max(1e-4, Number(tubeState.radius) || 0.018);
    const clampedInnerR = Math.max(0, Math.min(Number(tubeState.innerRadiusM) || 0, Math.max(0, safeOuterR - 0.001)));
    const innerRatio = clampedInnerR > 1e-5 ? Math.min(0.96, clampedInnerR / safeOuterR) : 0;

    if (innerRatio > 0.01) {
        const boreLines = [];
        for (const ms of (Array.isArray(solid.barMidRingSpecs) ? solid.barMidRingSpecs : [])) {
            const N = Math.max(6, ms.nSides || tubeState.nSides || 8);
            const rIn = ms.outerRadiusLocal * innerRatio;
            for (let k = 0; k < N; k++) {
                const a0 = (2 * Math.PI * k) / N, a1 = (2 * Math.PI * ((k + 1) % N)) / N;
                boreLines.push(
                    ms.midPt.x + ms.e1.x * (rIn * Math.cos(a0)) + ms.e2.x * (rIn * Math.sin(a0)),
                    ms.midPt.y + ms.e1.y * (rIn * Math.cos(a0)) + ms.e2.y * (rIn * Math.sin(a0)),
                    ms.midPt.z + ms.e1.z * (rIn * Math.cos(a0)) + ms.e2.z * (rIn * Math.sin(a0)),
                    ms.midPt.x + ms.e1.x * (rIn * Math.cos(a1)) + ms.e2.x * (rIn * Math.sin(a1)),
                    ms.midPt.y + ms.e1.y * (rIn * Math.cos(a1)) + ms.e2.y * (rIn * Math.sin(a1)),
                    ms.midPt.z + ms.e1.z * (rIn * Math.cos(a1)) + ms.e2.z * (rIn * Math.sin(a1))
                );
            }
        }

        const rimPos = [], rimCol = [], rimWire = [];
        const rimColor = new THREE.Color(0x94a3b8);
        const pushRimTri = (ax, ay, az, bx, by, bz, cx, cy, cz) => {
            rimPos.push(ax, ay, az, bx, by, bz, cx, cy, cz);
            rimCol.push(rimColor.r, rimColor.g, rimColor.b, rimColor.r, rimColor.g, rimColor.b, rimColor.r, rimColor.g, rimColor.b);
        };

        for (const ls of (Array.isArray(solid.leafEndSpecs) ? solid.leafEndSpecs : [])) {
            const angs = ls.angles || [];
            const N = angs.length;
            if (N < 3) continue;
            const rOut = ls.outerRadiusLocal, rIn = rOut * innerRatio;
            const sleeveDepth = Math.min(ls.barLength * 0.35, rOut * 1.8);
            const outPts = [], inPts = [], slvPts = [];
            for (let k = 0; k < N; k++) {
                const ca = Math.cos(angs[k]), sa = Math.sin(angs[k]);
                const ix = ls.center.x + ls.e1.x * (rIn * ca) + ls.e2.x * (rIn * sa);
                const iy = ls.center.y + ls.e1.y * (rIn * ca) + ls.e2.y * (rIn * sa);
                const iz = ls.center.z + ls.e1.z * (rIn * ca) + ls.e2.z * (rIn * sa);
                outPts.push([
                    ls.center.x + ls.e1.x * (rOut * ca) + ls.e2.x * (rOut * sa),
                    ls.center.y + ls.e1.y * (rOut * ca) + ls.e2.y * (rOut * sa),
                    ls.center.z + ls.e1.z * (rOut * ca) + ls.e2.z * (rOut * sa)
                ]);
                inPts.push([ix, iy, iz]);
                slvPts.push([ix + ls.inwardDir.x * sleeveDepth, iy + ls.inwardDir.y * sleeveDepth, iz + ls.inwardDir.z * sleeveDepth]);
            }
            for (let k = 0; k < N; k++) {
                const k1 = (k + 1) % N;
                boreLines.push(inPts[k][0], inPts[k][1], inPts[k][2], inPts[k1][0], inPts[k1][1], inPts[k1][2]);
                if (!tubeState.capLeafEnds) {
                    const o0 = outPts[k], o1 = outPts[k1], i0 = inPts[k], i1 = inPts[k1], s0 = slvPts[k], s1 = slvPts[k1];
                    pushRimTri(o0[0], o0[1], o0[2], o1[0], o1[1], o1[2], i1[0], i1[1], i1[2]);
                    pushRimTri(o0[0], o0[1], o0[2], i1[0], i1[1], i1[2], i0[0], i0[1], i0[2]);
                    pushRimTri(i0[0], i0[1], i0[2], i1[0], i1[1], i1[2], s1[0], s1[1], s1[2]);
                    pushRimTri(i0[0], i0[1], i0[2], s1[0], s1[1], s1[2], s0[0], s0[1], s0[2]);
                    rimWire.push(i0[0], i0[1], i0[2], i1[0], i1[1], i1[2], o0[0], o0[1], o0[2], i0[0], i0[1], i0[2]);
                }
            }
        }
        if (rimPos.length > 0) {
            const rGeo = new THREE.BufferGeometry();
            rGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimPos, 3));
            rGeo.setAttribute('color', new THREE.Float32BufferAttribute(rimCol, 3));
            rGeo.computeVertexNormals();
            const rMesh = new THREE.Mesh(rGeo, arcticOn ? sharedMaterials.arctic : sharedMaterials.tubeVertexColored);
            rMesh.userData.isTubeSurface = true;
            rMesh.userData.baseMaterial = sharedMaterials.tubeVertexColored;
            viewport.tubeGroup.add(rMesh);
            if (rimWire.length > 0) {
                const rwGeo = new THREE.BufferGeometry();
                rwGeo.setAttribute('position', new THREE.Float32BufferAttribute(rimWire, 3));
                viewport.tubeGroup.add(new THREE.LineSegments(rwGeo, sharedMaterials.tubeWire));
            }
        }
        if (boreLines.length > 0 && (wireframeOn || !tubeState.capLeafEnds)) {
            const bGeo = new THREE.BufferGeometry();
            bGeo.setAttribute('position', new THREE.Float32BufferAttribute(boreLines, 3));
            const bSegs = new THREE.LineSegments(bGeo, sharedMaterials.innerBoreWire);
            bSegs.userData.isInnerBorePreview = true;
            bSegs.renderOrder = 14;
            viewport.tubeGroup.add(bSegs);
        }
    }

    if (!opts.skipUnroll3D) renderUnrolledStrips3D();
    applyOutlinerVisibility();
}

export function syncTubeWallRadiiUI() {
    const { tubeState } = appState;
    tubeState.radius = Math.max(0.040, Math.min(0.200, Number(tubeState.radius) || 0.060));
    const maxInner = Math.max(0, Math.round((tubeState.radius - 0.001) * 10000) / 10000);
    tubeState.innerRadiusM = Math.max(0, Math.min(Number(tubeState.innerRadiusM) || 0, maxInner));

    const rEl = $('rng-tube-radius'), rcEl = $('rng-compact-tube-radius'), irEl = $('rng-tube-inner-radius');
    const fmtM = (val) => `${Number(val).toFixed(3)}m`;
    if (rEl && Math.abs(parseFloat(rEl.value) - tubeState.radius) > 1e-6) rEl.value = String(tubeState.radius);
    setTxt('val-tube-radius', fmtM(tubeState.radius));
    if (rcEl && Math.abs(parseFloat(rcEl.value) - tubeState.radius) > 1e-6) rcEl.value = String(tubeState.radius);
    setTxt('val-compact-tube-radius', `${tubeState.radius.toFixed(3)}m`);
    if (irEl) {
        irEl.max = String(Math.max(0.0005, maxInner).toFixed(4));
        if (Math.abs(parseFloat(irEl.value) - tubeState.innerRadiusM) > 1e-6) irEl.value = String(tubeState.innerRadiusM);
    }
    setTxt('val-tube-inner-radius', fmtM(tubeState.innerRadiusM));

    const statusEl = $('tube-status-badge');
    if (statusEl) {
        const clampTxt = tubeState.miterClamp !== false ? 'Miter Clamp: ON' : 'Uniform R (No Clamp)';
        statusEl.innerHTML = `<span class="text-gray-400">Joint Mode</span><span class="${tubeState.miterClamp !== false ? 'text-gray-300' : 'text-amber-300'}">${clampTxt}</span>`;
    }
}

export function updateSolidTubeReadout(solid, { interactivePreview = false } = {}) {
    syncTubeWallRadiiUI();
    if (!solid) return;
    const v = solid.verification || { isWatertight: false, isValid: false, boundaryEdges: 0, nonManifoldEdges: 0, genus: 0 };
    const totalFaces = solid.quads.length + solid.triangles.length;
    const quadPct = totalFaces > 0 ? Math.round((100 * solid.quads.length) / totalFaces) : 0;
    if (!solid.planarity) solid.planarity = CORE.computeMeshPlanarityStats(solid.vertices, solid.quads);
    const pqErrMM = ((solid.planarity.maxQuadPlanarityErrorM || 0) * 1000).toFixed(3);
    const tMM = Math.max(0, (appState.tubeState.radius - appState.tubeState.innerRadiusM) * 1000).toFixed(1);

    const badge = $('tube-manifold-badge');
    if (badge) {
        if (v.isWatertight) {
            badge.textContent = interactivePreview ? 'Watertight · Preview' : `Watertight · PQ ${pqErrMM}mm ✓`;
            badge.title = `100% Watertight · ${solid.triangles.length === 0 ? 'Pure Quad' : `${quadPct}%Q`} · PQ ≤ ${pqErrMM}mm`;
        } else if (v.isValid) {
            badge.textContent = `Manifold (${v.boundaryEdges} bnd)`;
            badge.title = `Valid Manifold · ${v.boundaryEdges} open boundary edges · PQ ≤ ${pqErrMM}mm`;
        } else {
            badge.textContent = `Non-Manifold (${v.nonManifoldEdges})`;
            badge.title = `Non-Manifold · ${v.nonManifoldEdges} non-manifold edges`;
        }
        badge.className = `text-[9px] font-mono tabular-nums whitespace-nowrap shrink-0 ${v.isWatertight ? 'text-emerald-400' : (v.isValid ? 'text-amber-400' : 'text-rose-400')}`;
    }
    setTxt('tube-readout', `V: ${solid.vertices.length} · Quads: ${solid.quads.length} (${quadPct}%) · t=${tMM}mm · PQ≤${pqErrMM}mm · Bnd: ${v.boundaryEdges} · g=${v.genus}`);
}

function isHostMeshOnlyActive() {
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (src && Array.isArray(src.edges) && src.edges.length > 0) return false;
    const { voxels, TILES } = appState;
    if (!Array.isArray(voxels)) return false;
    for (const v of voxels) {
        if (!v.collapsed || v.tile === null || v.tile === CORE.TILE_NULL) continue;
        const td = TILES[v.tile];
        if (td && ((td.quads && td.quads.length > 0) || (td.previewQuads && td.previewQuads.length > 0))) {
            return true;
        }
    }
    return false;
}

function syncPqHostModeUI(isHostMesh) {
    const controlsEl = $('pq-tube-solidifier-controls');
    const bannerEl = $('pq-host-mesh-banner');
    const titleEl = $('pq-panel-title');
    const resetDefBtn = $('btn-reset-pq-default');
    const resetGraphBtn = $('btn-reset-pq-graph');
    if (controlsEl) controlsEl.classList.toggle('hidden', isHostMesh);
    if (bannerEl) bannerEl.classList.toggle('hidden', !isHostMesh);
    if (titleEl) titleEl.textContent = isHostMesh ? 'PQ Host Mesh (Mesh Tiles)' : 'PQ Tubular Solidifier';
    if (resetDefBtn) resetDefBtn.textContent = isHostMesh ? '↺ Reset Host Mesh' : '↺ Reset Tube Default';
    if (resetGraphBtn) resetGraphBtn.textContent = isHostMesh ? '↺ Clear PQ Mesh' : '↺ Reset to Graph';
}

function buildHostMeshSolidFromVoxels() {
    const { voxels, TILES, VOXEL_SIZE, GRID_X, GRID_Y, GRID_Z, GRID_ORIGIN } = appState;
    const half = VOXEL_SIZE * 0.5;
    const rawPts = [];
    const rawQuads = [];
    const rawTris = [];
    const samePt = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-6;

    for (const v of voxels) {
        if (!v.collapsed || v.tile === null || v.tile === CORE.TILE_NULL) continue;
        const td = TILES[v.tile];
        if (!td) continue;
        const faceQuads = (td.quads && td.quads.length > 0)
            ? td.quads
            : (td.previewQuads && td.previewQuads.length > 0 ? td.previewQuads : []);
        if (faceQuads.length === 0) continue;

        const cx = GRID_ORIGIN.x + v.x * VOXEL_SIZE + half;
        const cy = GRID_ORIGIN.y + v.y * VOXEL_SIZE + half;
        const cz = GRID_ORIGIN.z + v.z * VOXEL_SIZE + half;

        for (const q of faceQuads) {
            const p0 = new CORE.V3(cx + q[0][0] * VOXEL_SIZE, cy + q[0][1] * VOXEL_SIZE, cz + q[0][2] * VOXEL_SIZE);
            const p1 = new CORE.V3(cx + q[1][0] * VOXEL_SIZE, cy + q[1][1] * VOXEL_SIZE, cz + q[1][2] * VOXEL_SIZE);
            const p2 = new CORE.V3(cx + q[2][0] * VOXEL_SIZE, cy + q[2][1] * VOXEL_SIZE, cz + q[2][2] * VOXEL_SIZE);
            const p3 = new CORE.V3(cx + q[3][0] * VOXEL_SIZE, cy + q[3][1] * VOXEL_SIZE, cz + q[3][2] * VOXEL_SIZE);
            const b = rawPts.length;
            if (samePt(p2, p3)) {
                rawPts.push(p0, p1, p2);
                rawTris.push([b, b + 1, b + 2]);
            } else {
                rawPts.push(p0, p1, p2, p3);
                rawQuads.push([b, b + 1, b + 2, b + 3]);
            }
        }
    }

    if (rawPts.length === 0) return null;
    const { vertices, map } = CORE.weldVertices(rawPts, 1e-4);
    const quads = [];
    for (const q of rawQuads) {
        const mapped = q.map(i => map[i]);
        if (new Set(mapped).size === 4) quads.push(mapped);
    }
    const triangles = [];
    for (const t of rawTris) {
        const mapped = t.map(i => map[i]);
        if (new Set(mapped).size === 3) triangles.push(mapped);
    }

    const verificationTriangles = [];
    for (const q of quads) verificationTriangles.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    for (const t of triangles) verificationTriangles.push(t[0], t[1], t[2]);
    const verification = CORE.verifyManifold(vertices, verificationTriangles);
    const planarity = CORE.computeMeshPlanarityStats(vertices, quads);
    const solid = {
        vertices,
        quads,
        triangles,
        verification,
        planarity,
        quadIsCap: new Uint8Array(quads.length),
        isHostMeshTile: true,
        gridResolution: [GRID_X, GRID_Y, GRID_Z]
    };
    CORE.initSolidFaceLoops(solid, appState.tubeState.colorMode === 'ring' ? 'ring' : 'longitudinal');
    return solid;
}

export function solidifyActiveGraph(opts = {}) {
    const interactivePreview = !!opts.interactivePreview;
    syncTubeWallRadiiUI();
    const isHostMesh = isHostMeshOnlyActive();
    syncPqHostModeUI(isHostMesh);

    if (!interactivePreview && viewport.setBusy) viewport.setBusy(isHostMesh ? 'Building PQ host mesh…' : 'Solidifying PQ tubes…');
    try {
        if (isHostMesh) {
            appState.faceLoopState.quadInheritedColors = null;
            appState.faceLoopState.quadParentLoopIds = null;
            appState.lastSolidData = buildHostMeshSolidFromVoxels();
            if (!appState.lastSolidData) return null;
            walkAndRefreshFaceLoops(appState.lastSolidData);
            if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
            renderTubularMesh(appState.lastSolidData, { skipUnroll3D: interactivePreview });
            updateSolidTubeReadout(appState.lastSolidData);
            if (!interactivePreview) recomputeModelBox();
            return appState.lastSolidData;
        }

        if (appState.fdmState.triggerOnHost && !appState.lastFDMResult && actions.runFDMOnActiveGraph) {
            actions.runFDMOnActiveGraph({ skipAutoSolidify: true, keepCamera: true });
        }
        const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
        if (!src || !src.edges || src.edges.length === 0) return null;

        appState.faceLoopState.quadInheritedColors = null;
        appState.faceLoopState.quadParentLoopIds = null;

        const { tubeState } = appState;
        const previewSubdiv = interactivePreview && src.edges.length > 60 ? 0 : tubeState.longitudinalSubdivLevels;
        appState.lastSolidData = CORE.solidifyGraph(src.vertices, src.edges, {
            nSides: tubeState.nSides,
            radius: tubeState.radius,
            endOffset: tubeState.endOffset,
            longitudinalSubdivLevels: previewSubdiv,
            pqOptimization: interactivePreview ? false : tubeState.pqOptimization,
            stitchAtBisectors: tubeState.stitchAtBisectors,
            miterClamp: tubeState.miterClamp !== false,
            capLeafEnds: tubeState.capLeafEnds
        });

        walkAndRefreshFaceLoops(appState.lastSolidData);
        if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
        renderTubularMesh(appState.lastSolidData, { skipUnroll3D: interactivePreview });
        updateSolidTubeReadout(appState.lastSolidData, { interactivePreview });
        if (!interactivePreview) recomputeModelBox();
        return appState.lastSolidData;
    } finally {
        if (!interactivePreview && viewport.setBusy) viewport.setBusy(null);
    }
}

export function resetPQTubeToDefault() {
    Object.assign(appState.tubeState, TUBE_DEFAULTS);
    appState.faceLoopState.showUnrolled3D = false;
    const { tubeState } = appState;

    const setVal = (id, v) => { const el = $(id); if (el) el.value = String(v); };
    const setChk = (id, c) => { const el = $(id); if (el) el.checked = !!c; };

    setVal('rng-tube-radius', tubeState.radius); setTxt('val-tube-radius', `${tubeState.radius}m`);
    setVal('rng-tube-inner-radius', tubeState.innerRadiusM); setTxt('val-tube-inner-radius', `${tubeState.innerRadiusM}m`);
    setVal('rng-tube-sides', tubeState.nSides); setTxt('val-tube-sides', String(tubeState.nSides));
    setVal('rng-tube-offset', tubeState.endOffset); setTxt('val-tube-offset', `${tubeState.endOffset}m`);
    setVal('rng-tube-subdiv', tubeState.longitudinalSubdivLevels); setTxt('val-tube-subdiv', String(tubeState.longitudinalSubdivLevels));

    setChk('chk-tube-bisector', tubeState.stitchAtBisectors);
    setChk('chk-tube-miter-clamp', tubeState.miterClamp);
    setChk('chk-tube-pq', tubeState.pqOptimization);
    setChk('chk-tube-cap-leaves', tubeState.capLeafEnds);
    setChk('chk-tube-show', tubeState.show);

    $$('.tube-color-btn').forEach(b => b.classList.toggle('seg-on', b.dataset.tubeColor === tubeState.colorMode));
    setTxt('unroll-3d-state', 'OFF');
    const btnUnroll = $('btn-toggle-unroll-3d');
    if (btnUnroll) btnUnroll.classList.remove('on');
    clearGroup(viewport.unroll3DGroup);
    viewport.unroll3DGroup.visible = false;

    syncTubeWallRadiiUI();
    solidifyActiveGraph({ keepCamera: true });
    applyOutlinerVisibility();
}

export function resetPQMeshToGraph() {
    appState.lastSolidData = null;
    if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
    appState.faceLoopState.loops = [];
    appState.faceLoopState.quadToLoopId = [];
    appState.faceLoopState.showUnrolled3D = false;
    clearGroup(viewport.tubeGroup);
    clearGroup(viewport.unroll3DGroup);
    viewport.unroll3DGroup.visible = false;

    setTxt('unroll-3d-state', 'OFF');
    const btnEl = $('btn-toggle-unroll-3d');
    if (btnEl) btnEl.classList.remove('on');
    const isHostMesh = isHostMeshOnlyActive();
    syncPqHostModeUI(isHostMesh);
    const badge = $('tube-manifold-badge');
    if (badge) { badge.textContent = isHostMesh ? 'Host Mesh' : 'Graph Only'; badge.className = 'text-[9px] font-mono text-gray-400'; }
    setTxt('tube-loop-count-badge', '0 loops');
    const gSrc = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    setTxt('tube-readout', isHostMesh
        ? 'Host Mesh Mode (Mesh Tiles) — click any PQ / Subdiv / Unroll tool above.'
        : (gSrc ? `Centerline Graph: ${gSrc.vertices.length}V · ${gSrc.edges.length}E (click Solidify to build PQ tubes)` : 'V: 0 · Quads: 0 · Tris: 0 · Manifold: —'));
    drawUnrolledLoopCanvas();
    if (appState.fdmState.triggerOnHost && appState.lastFDMResult && actions.renderFDMNetwork) {
        actions.renderFDMNetwork(appState.lastFDMResult);
    } else if (actions.renderHostNetworkInFdmGroup) {
        actions.renderHostNetworkInFdmGroup();
    }
    applyOutlinerVisibility();
    recomputeModelBox();
}

function runSubdivMutation(mutatorFn, label = 'Subdividing PQ mesh…') {
    if (viewport.setBusy) viewport.setBusy(label);
    try {
        if (!appState.lastSolidData || !appState.lastSolidData.vertices || appState.lastSolidData.vertices.length === 0) {
            solidifyActiveGraph({ keepCamera: true });
        }
        if (!appState.lastSolidData) return null;
        const prevLeafSpecs = appState.lastSolidData.leafEndSpecs;
        const prevMidSpecs = appState.lastSolidData.barMidRingSpecs;
        appState.lastSolidData = mutatorFn(appState.lastSolidData);
        if (prevLeafSpecs && !appState.lastSolidData.leafEndSpecs) appState.lastSolidData.leafEndSpecs = prevLeafSpecs;
        if (prevMidSpecs && !appState.lastSolidData.barMidRingSpecs) appState.lastSolidData.barMidRingSpecs = prevMidSpecs;
        walkAndRefreshFaceLoops(appState.lastSolidData);
        if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
        renderTubularMesh(appState.lastSolidData);
        updateSolidTubeReadout(appState.lastSolidData);
        recomputeModelBox();
        if (actions.showToast && appState.lastSolidData) {
            actions.showToast(`PQ Mesh updated (${appState.lastSolidData.quads.length} quads)`, { tone: 'success' });
        }
        return appState.lastSolidData;
    } finally {
        if (viewport.setBusy) viewport.setBusy(null);
    }
}

export const applyLongitudinalSubdivPQFromUI = () => runSubdivMutation(s => CORE.applyLongitudinalOnlySubdivisionToPQStrips(s, 1, true), 'Longitudinal Subdiv + PQ…');
export const applyCatmullClarkSubdivPQFromUI = () => runSubdivMutation(s => CORE.applyCatmullClarkToPQStrips(s, 1, true), 'Catmull-Clark Subdiv + PQ…');
export const applyRingSubdivPQFromUI = () => runSubdivMutation(s => CORE.applyRingOnlySubdivisionToPQStrips(s, 1, true), 'Ring Subdiv + PQ…');
export function swapLongRingDirectionsFromUI() {
    if (viewport.setBusy) viewport.setBusy('Swapping Long ↔ Ring…');
    try {
        if (!appState.lastSolidData || !appState.lastSolidData.vertices || appState.lastSolidData.vertices.length === 0) {
            solidifyActiveGraph({ keepCamera: true });
        }
        const solid = appState.lastSolidData;
        if (!solid || !Array.isArray(solid.quads) || solid.quads.length === 0) return null;
        // Align every quad along the current longitudinal loops so its walk axis moves to sides 1 & 3 (ring),
        // guaranteeing a clean global Long <-> Ring swap even on imported OBJ meshes with mixed local winding.
        const curLong = CORE.walkMeshFaceLoops(solid.vertices, solid.quads, 'longitudinal', { computeUnroll: false });
        const rotated = new Uint8Array(solid.quads.length);
        for (const lp of curLong.loops) {
            for (const st of lp.steps) {
                if (rotated[st.qIdx]) continue;
                rotated[st.qIdx] = 1;
                if (st.enterSide % 2 === 0) {
                    const q = solid.quads[st.qIdx];
                    solid.quads[st.qIdx] = [q[1], q[2], q[3], q[0]];
                }
            }
        }
        for (let i = 0; i < solid.quads.length; i++) {
            if (!rotated[i]) {
                const q = solid.quads[i];
                solid.quads[i] = [q[1], q[2], q[3], q[0]];
            }
        }
        const activeDir = appState.tubeState.colorMode === 'ring' ? 'ring' : 'longitudinal';
        CORE.initSolidFaceLoops(solid, activeDir);
        walkAndRefreshFaceLoops(solid);
        renderTubularMesh(solid);
        updateSolidTubeReadout(solid);
        if (actions.showToast) {
            actions.showToast(`Swapped Long ↔ Ring (${appState.faceLoopState.loops.length} loops)`, { tone: 'info' });
        }
        return solid;
    } finally {
        if (viewport.setBusy) viewport.setBusy(null);
    }
}
export function applyOnlyPQOptimizationFromUI() {
    if (viewport.setBusy) viewport.setBusy('Optimizing PQ planarity…');
    try {
        if (!appState.lastSolidData || !appState.lastSolidData.vertices || appState.lastSolidData.vertices.length === 0) {
            solidifyActiveGraph({ keepCamera: true });
        }
        if (!appState.lastSolidData) return null;
        CORE.optimizeFaceLoopsToPQ(appState.lastSolidData, 96, 0.65, { targetErrorM: 1e-6, maxQuadPlanarityErrorM: 0.0005 });
        walkAndRefreshFaceLoops(appState.lastSolidData);
        if (appState.activeTabId !== 'tab-fea') appState.lastFEAResult = null;
        renderTubularMesh(appState.lastSolidData);
        updateSolidTubeReadout(appState.lastSolidData);
        recomputeModelBox();
        if (actions.showToast && appState.lastSolidData?.planarity) {
            const errMm = ((appState.lastSolidData.planarity.maxQuadPlanarityErrorM || 0) * 1000).toFixed(3);
            actions.showToast(`PQ optimized (max warp ${errMm} mm)`, { tone: 'success' });
        }
        return appState.lastSolidData;
    } finally {
        if (viewport.setBusy) viewport.setBusy(null);
    }
}

export function setTubeColorMode(mode) {
    appState.tubeState.colorMode = mode;
    $$('.tube-color-btn').forEach(b => b.classList.toggle('seg-on', b.dataset.tubeColor === mode));
    if (appState.lastSolidData) {
        walkAndRefreshFaceLoops(appState.lastSolidData);
        renderTubularMesh(appState.lastSolidData);
    }
}

export function toggleUnroll3DFromUI(forceState = undefined) {
    const nextState = forceState !== undefined ? !!forceState : !appState.faceLoopState.showUnrolled3D;
    if (nextState && viewport.setBusy) viewport.setBusy('Unrolling 3D PQ strips…');
    try {
        if (!appState.lastSolidData || !appState.lastSolidData.vertices || appState.lastSolidData.vertices.length === 0) {
            solidifyActiveGraph({ keepCamera: true });
        }
        appState.faceLoopState.showUnrolled3D = nextState;
        setTxt('unroll-3d-state', appState.faceLoopState.showUnrolled3D ? 'ON' : 'OFF');
        const btnEl = $('btn-toggle-unroll-3d');
        if (btnEl) btnEl.classList.toggle('on', appState.faceLoopState.showUnrolled3D);
        renderUnrolledStrips3D();
        applyOutlinerVisibility();
        recomputeModelBox();
        if (appState.faceLoopState.showUnrolled3D && actions.showToast) {
            const nSheets = appState.faceLoopState.unrolledBedLayout?.grid?.sheetTransforms?.length || 1;
            actions.showToast(`Unrolled ${appState.faceLoopState.loops.length} strips onto ${nSheets} sheet${nSheets === 1 ? '' : 's'}`, { tone: 'success' });
        }
        return appState.faceLoopState.showUnrolled3D;
    } finally {
        if (viewport.setBusy) viewport.setBusy(null);
    }
}

export function ensurePqTabReady(opts = {}) {
    const isHostMesh = isHostMeshOnlyActive();
    syncPqHostModeUI(isHostMesh);
    if (!isHostMesh && !appState.lastHostGraph && !appState.lastFDMResult && actions.refreshHostGraph) {
        actions.refreshHostGraph({ preserveFixed: true });
    }
    if (!appState.lastSolidData && (appState.tubeState.show || isHostMesh)) {
        solidifyActiveGraph({ keepCamera: opts.keepCamera !== false });
    } else if (!appState.lastSolidData) {
        if (appState.fdmState.triggerOnHost && appState.lastFDMResult && actions.renderFDMNetwork) actions.renderFDMNetwork(appState.lastFDMResult);
        else if (actions.renderHostNetworkInFdmGroup) actions.renderHostNetworkInFdmGroup();
    }
}

function recordPqConfigStep() {
    if (!actions.recordChainStep) return;
    const ts = appState.tubeState;
    actions.recordChainStep('pq_config', {
        outerR: ts.radius,
        innerR: ts.innerRadiusM,
        sides: ts.nSides,
        subdivL: ts.longitudinalSubdivLevels,
        bisector: Boolean(ts.stitchAtBisectors),
        miterClamp: ts.miterClamp !== false,
        planarize: Boolean(ts.pqOptimization),
        caps: Boolean(ts.capLeafEnds),
        colorMode: ts.colorMode
    }, { label: `PQ Config (Ro=${ts.radius}m, N=${ts.nSides})` });
}

export function initTab4PqMesh() {
    actions.syncTubeWallRadiiUI = syncTubeWallRadiiUI;
    actions.renderTubularMesh = renderTubularMesh;
    actions.solidifyActiveGraph = solidifyActiveGraph;
    actions.applyLongitudinalSubdivPQFromUI = applyLongitudinalSubdivPQFromUI;
    actions.applyRingSubdivPQFromUI = applyRingSubdivPQFromUI;
    actions.applyCatmullClarkSubdivPQFromUI = applyCatmullClarkSubdivPQFromUI;
    actions.applyOnlyPQOptimizationFromUI = applyOnlyPQOptimizationFromUI;
    actions.setTubeColorMode = setTubeColorMode;
    actions.toggleUnroll3DFromUI = toggleUnroll3DFromUI;
    actions.drawUnrolledLoopCanvas = drawUnrolledLoopCanvas;
    actions.selectPqLoopById = selectPqLoopById;
    actions.swapPqLongRing = swapLongRingDirectionsFromUI;
    actions.ensurePqTabReady = ensurePqTabReady;

    let tubePreviewTimer = null;
    let tubeCommitTimer = null;
    let lastTubePreviewMs = 24;
    let pendingInnerRenderRaf = 0;

    const scheduleInteractiveTubeSolidify = ({ preview = true, commit = false } = {}) => {
        if (commit) {
            if (tubePreviewTimer) { clearTimeout(tubePreviewTimer); tubePreviewTimer = null; }
            if (tubeCommitTimer) { clearTimeout(tubeCommitTimer); tubeCommitTimer = null; }
            solidifyActiveGraph({ keepCamera: true, interactivePreview: false });
            if (actions.updateSimUI) actions.updateSimUI();
            return;
        }
        if (preview) {
            if (tubePreviewTimer) clearTimeout(tubePreviewTimer);
            const delayMs = Math.min(140, Math.max(20, Math.round(lastTubePreviewMs * 0.55)));
            tubePreviewTimer = setTimeout(() => {
                tubePreviewTimer = null;
                const t0 = performance.now();
                solidifyActiveGraph({ keepCamera: true, interactivePreview: true });
                lastTubePreviewMs = Math.max(12, performance.now() - t0);
            }, delayMs);
        }
        if (tubeCommitTimer) clearTimeout(tubeCommitTimer);
        tubeCommitTimer = setTimeout(() => {
            tubeCommitTimer = null;
            if (tubePreviewTimer) { clearTimeout(tubePreviewTimer); tubePreviewTimer = null; }
            solidifyActiveGraph({ keepCamera: true, interactivePreview: false });
            if (actions.updateSimUI) actions.updateSimUI();
        }, 180);
    };
    actions.scheduleInteractiveTubeSolidify = scheduleInteractiveTubeSolidify;

    const bindTubeCommit = (id) => {
        const el = $(id);
        if (el) el.addEventListener('change', () => scheduleInteractiveTubeSolidify({ commit: true }));
    };

    syncTubeWallRadiiUI();
    const sched = (opts) => { if (actions.scheduleLiveFdmPqUpdate) actions.scheduleLiveFdmPqUpdate(opts); };

    bindSlider('rng-tube-radius', 'val-tube-radius', 'm', v => {
        appState.tubeState.radius = v;
        syncTubeWallRadiiUI();
        recordPqConfigStep();
        scheduleInteractiveTubeSolidify({ preview: true });
    });
    bindTubeCommit('rng-tube-radius');

    bindSlider('rng-tube-inner-radius', 'val-tube-inner-radius', 'm', v => {
        appState.tubeState.innerRadiusM = v;
        syncTubeWallRadiiUI();
        recordPqConfigStep();
        if (!appState.lastSolidData) {
            scheduleInteractiveTubeSolidify({ preview: true });
            return;
        }
        if (pendingInnerRenderRaf) return;
        pendingInnerRenderRaf = requestAnimationFrame(() => {
            pendingInnerRenderRaf = 0;
            if (appState.lastSolidData) {
                renderTubularMesh(appState.lastSolidData, { skipUnroll3D: true });
                updateSolidTubeReadout(appState.lastSolidData);
            }
        });
    });

    bindSlider('rng-tube-sides', 'val-tube-sides', '', v => {
        appState.tubeState.nSides = Math.round(v);
        recordPqConfigStep();
        scheduleInteractiveTubeSolidify({ preview: true });
    });
    bindTubeCommit('rng-tube-sides');

    bindSlider('rng-tube-offset', 'val-tube-offset', 'm', v => {
        appState.tubeState.endOffset = v;
        recordPqConfigStep();
        scheduleInteractiveTubeSolidify({ preview: true });
    });
    bindTubeCommit('rng-tube-offset');

    bindSlider('rng-tube-subdiv', 'val-tube-subdiv', '', v => {
        appState.tubeState.longitudinalSubdivLevels = Math.round(v);
        recordPqConfigStep();
        scheduleInteractiveTubeSolidify({ preview: true });
    });
    bindTubeCommit('rng-tube-subdiv');

    const bindChk = (id, fn) => { const el = $(id); if (el) el.addEventListener('change', () => fn(el.checked)); };
    bindChk('chk-tube-bisector', c => { appState.tubeState.stitchAtBisectors = c; recordPqConfigStep(); sched({ solidify: true }); });
    bindChk('chk-tube-miter-clamp', c => { appState.tubeState.miterClamp = c; syncTubeWallRadiiUI(); recordPqConfigStep(); sched({ solidify: true }); });
    bindChk('chk-tube-pq', c => { appState.tubeState.pqOptimization = c; recordPqConfigStep(); sched({ solidify: true }); });
    bindChk('chk-tube-cap-leaves', c => { appState.tubeState.capLeafEnds = c; recordPqConfigStep(); sched({ solidify: true }); });
    bindChk('chk-tube-show', c => {
        appState.tubeState.show = c;
        appState.showQuadMeshes = c;
        appState.groupVis.meshes = c;
        const chkShowMeshes = $('chk-show-meshes');
        if (chkShowMeshes) chkShowMeshes.checked = c;
        if (appState.elasticaState) {
            appState.elasticaState.showRods = c;
            const chkElasticaRods = $('chk-elastica-show-rods');
            if (chkElasticaRods) chkElasticaRods.checked = c;
        }
        if (c && !appState.lastSolidData) solidifyActiveGraph({ keepCamera: true });
        if (!c && appState.showCenterlineGraph && viewport.fdmGroup.children.length === 0 && actions.renderHostNetworkInFdmGroup) {
            actions.renderHostNetworkInFdmGroup();
        }
        applyOutlinerVisibility();
        refreshOutliner();
    });

    const bindClick = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    bindClick('btn-solidify-tubes', () => {
        const solid = solidifyActiveGraph({ keepCamera: true });
        if (actions.recordChainStep) {
            actions.recordChainStep('pq_solidify', { colorMode: appState.tubeState.colorMode }, { label: 'Solidify → All-Quad PQ' });
        }
        if (solid && actions.showToast) {
            actions.showToast(`Solidified PQ mesh (${solid.quads.length} quads)`, { tone: 'success' });
        }
    });
    bindClick('btn-reset-pq-default', () => resetPQTubeToDefault());
    bindClick('btn-reset-pq-graph', () => resetPQMeshToGraph());
    bindClick('btn-long-subdiv-pq', () => {
        applyLongitudinalSubdivPQFromUI();
        if (actions.recordChainStep) actions.recordChainStep('pq_subdiv_long', { levels: 1 }, { label: 'Longitudinal Subdiv + PQ' });
    });
    bindClick('btn-cc-subdiv-pq', () => {
        applyCatmullClarkSubdivPQFromUI();
        if (actions.recordChainStep) actions.recordChainStep('pq_subdiv_cc', { levels: 1 }, { label: 'Catmull-Clark + PQ' });
    });
    bindClick('btn-ring-subdiv-pq', () => {
        applyRingSubdivPQFromUI();
        if (actions.recordChainStep) actions.recordChainStep('pq_subdiv_ring', { levels: 1 }, { label: 'Ring Subdiv + PQ' });
    });
    bindClick('btn-only-pq-opt', () => {
        applyOnlyPQOptimizationFromUI();
        if (actions.recordChainStep) actions.recordChainStep('pq_optimize', {}, { label: 'Only PQ Optimization' });
    });
    bindClick('btn-swap-long-ring', () => {
        swapLongRingDirectionsFromUI();
        if (actions.recordChainStep) actions.recordChainStep('pq_swap_long_ring', {}, { label: 'Swap Long ↔ Ring' });
    });
    bindClick('btn-toggle-unroll-3d', () => toggleUnroll3DFromUI());

    $$('.tube-color-btn').forEach(btn => btn.addEventListener('click', () => setTubeColorMode(btn.dataset.tubeColor)));

    const unrollCanvasEl = $('unroll-canvas');
    if (unrollCanvasEl) {
        unrollCanvasEl.addEventListener('click', () => {
            if (appState.faceLoopState.loops && appState.faceLoopState.loops.length > 0) {
                const cur = appState.faceLoopState.selectedLoopIdx;
                const nextIdx = (cur === null || cur === undefined || cur < 0)
                    ? 0
                    : (cur + 1) % appState.faceLoopState.loops.length;
                selectPqLoopById(nextIdx);
            }
        });
    }
}

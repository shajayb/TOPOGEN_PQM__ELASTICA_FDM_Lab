/**
 * WFC-FDM Foundry — Skeletal A* Elastica Curves & Unrolled Ribbons Tab (ui/tabs/tab_elastica.js)
 *
 * Uses the skeletal network to trace A* / Dijkstra paths between valence = 1
 * source and sink nodes, optimizes those paths into smooth Euler Elastica curves,
 * creates RMF quad-strip ribbons, and unfolds + packs them in 2D & 3D.
 */

import * as THREE from 'three';
import {
    appState,
    actions,
    CORE,
    UI_LOOP_PALETTE,
    $,
    setTxt,
    bindSlider,
    downloadBlob
} from '../state/workbench_state.js';
import {
    viewport,
    clearGroup,
    recomputeModelBox
} from '../display/viewport_scene.js';
import { applyOutlinerVisibility } from '../display/display_hud.js';

export function mountTabElastica() {
    const pane = $('tab-elastica');
    if (!pane) return;
    pane.innerHTML = `
        <div class="bg-gray-900/90 border border-gray-700 rounded p-2 space-y-1.5 text-[10px] font-mono">
            <div class="flex items-center justify-between font-sans">
                <span class="text-[10px] font-semibold uppercase tracking-wider text-cyan-400">Elastica Curves &amp; Rods</span>
                <span id="elastica-status-badge" class="text-[9px] font-mono text-gray-400">Not Built</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">V1 Pairs</span>
                <select id="sel-elastica-pair-mode" class="min-w-0 flex-1 bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[9.5px] text-gray-200">
                    <option value="all_pairs">All V1 Sources → Sinks (A*)</option>
                    <option value="top_to_bottom">Top V1 → Bottom V1 (A*)</option>
                    <option value="nearest_k">Nearest-2 V1 Sinks (A*)</option>
                </select>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Smooth</span>
                <select id="sel-elastica-smooth-mode" class="min-w-0 flex-1 bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[9.5px] text-gray-200">
                    <option value="catmull_clark_1d">Catmull-Clark 1D (B-Spline)</option>
                    <option value="catmull_rom">Catmull-Rom Spline</option>
                    <option value="elastica">Elastica Biharmonic</option>
                </select>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Subdiv (L)</span>
                <input type="range" id="rng-elastica-subdiv" min="0" max="4" step="1" value="2" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-elastica-subdiv" class="w-12 text-right text-gray-200 flex-shrink-0">2</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Samples</span>
                <input type="range" id="rng-elastica-samples" min="2" max="16" step="1" value="8" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-elastica-samples" class="w-12 text-right text-gray-200 flex-shrink-0">8</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Opt Iters</span>
                <input type="range" id="rng-elastica-iters" min="0" max="250" step="10" value="40" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-elastica-iters" class="w-12 text-right text-gray-200 flex-shrink-0">40</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Bend Wt</span>
                <input type="range" id="rng-elastica-bend" min="0.05" max="1.00" step="0.05" value="0.65" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-elastica-bend" class="w-12 text-right text-gray-200 flex-shrink-0">0.65</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Guide Wt</span>
                <input type="range" id="rng-elastica-guide" min="0.00" max="0.80" step="0.02" value="0.08" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-amber-400">
                <span id="val-elastica-guide" class="w-12 text-right text-gray-200 flex-shrink-0">0.08</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Max Dev</span>
                <input type="range" id="rng-elastica-dev" min="0.05" max="1.50" step="0.05" value="0.45" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-amber-400">
                <span id="val-elastica-dev" class="w-12 text-right text-gray-200 flex-shrink-0">0.45m</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Rod R</span>
                <input type="range" id="rng-elastica-radius" min="0.005" max="0.060" step="0.001" value="0.015" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-elastica-radius" class="w-12 text-right text-gray-200 flex-shrink-0">0.015m</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Rod Sides</span>
                <input type="range" id="rng-elastica-sides" min="4" max="12" step="2" value="6" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-elastica-sides" class="w-12 text-right text-gray-200 flex-shrink-0">6</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Twist (°)</span>
                <input type="range" id="rng-elastica-twist" min="-180" max="180" step="15" value="0" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400">
                <span id="val-elastica-twist" class="w-12 text-right text-gray-200 flex-shrink-0">0°</span>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[9px] font-sans text-gray-300">
                <label class="flex items-center space-x-1 cursor-pointer" title="Highlight valence = 1 source & sink nodes">
                    <input type="checkbox" id="chk-elastica-show-leaves" checked class="accent-rose-500 rounded">
                    <span>V1 Nodes</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Show raw A* skeletal paths before elastica optimization">
                    <input type="checkbox" id="chk-elastica-show-skeletal" class="accent-amber-400 rounded">
                    <span>A* Path</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Show optimized elastica curves">
                    <input type="checkbox" id="chk-elastica-show-curves" checked class="accent-cyan-400 rounded">
                    <span>Elasticas</span>
                </label>
                <label class="flex items-center space-x-1 cursor-pointer" title="Show 3D tubular rods along elastica curves">
                    <input type="checkbox" id="chk-elastica-show-rods" checked class="accent-pink-500 rounded">
                    <span>Rods</span>
                </label>
            </div>

            <button id="btn-generate-elastica" class="cad-btn on w-full py-1.5">⚡ Trace A* V1→V1 &amp; Optimize Elasticas</button>

            <div class="grid grid-cols-2 gap-1 pt-0.5 font-sans">
                <button id="btn-reset-elastica" class="cad-btn text-[9px] py-1" title="Reset elastica parameters to default">↺ Reset Default</button>
                <button id="btn-export-elastica-svg" class="cad-btn cyan text-[9px] py-1" title="Export unrolled & packed elastica rods as .SVG">Export Rods .SVG</button>
            </div>

            <div class="pt-1 border-t border-gray-800 space-y-1 font-sans">
                <button id="btn-toggle-elastica-unroll-3d" class="cad-btn cyan w-full py-1 flex items-center justify-between text-[9.5px]" title="Render flat 2D unrolled & packed elastica rods on the ground plane alongside the 3D structure">
                    <span>Toggle 3D Unrolled Rods</span>
                    <span id="elastica-unroll-3d-state" class="font-mono text-[9px] opacity-90">OFF</span>
                </button>
                <div class="flex items-center justify-between text-[8.5px] font-mono text-gray-400">
                    <span id="elastica-unroll-label" class="text-cyan-400 truncate">2D Unrolled Rod Preview (click to cycle)</span>
                </div>
                <canvas id="elastica-unroll-canvas" width="308" height="82" class="w-full bg-gray-950 border border-gray-800 rounded cursor-pointer" title="Click to cycle through unrolled elastica rods"></canvas>
            </div>

            <div id="elastica-readout" class="bg-gray-950/80 border border-gray-800 rounded px-1.5 py-1 text-[9px] text-gray-300 leading-snug">
                V1 Nodes: 0 · Curves: 0 · Sheets: 0 · Σκ²ds: —
            </div>
        </div>
    `;
}

export function drawElasticaUnrollCanvas() {
    const canvas = $('elastica-unroll-canvas');
    const label = $('elastica-unroll-label');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, W, H);

    const data = appState.lastElasticaData;
    const curves = data && data.curves ? data.curves : [];
    if (curves.length === 0) {
        if (label) label.textContent = '2D Unrolled Ribbon Preview (trace A* paths first)';
        return;
    }

    const selIdx = Math.max(0, Math.min(curves.length - 1, appState.elasticaState.selectedCurveIdx));
    const curve = curves[selIdx];
    const u2d = curve.unrolled2D;
    if (!u2d || !u2d.quads2D || u2d.quads2D.length === 0) return;

    const hexVal = UI_LOOP_PALETTE[selIdx % UI_LOOP_PALETTE.length];
    const hexStr = '#' + hexVal.toString(16).padStart(6, '0');
    if (label) {
        label.textContent = `Rod #${selIdx + 1}/${curves.length} (V1:${curve.startNode}→V1:${curve.endNode} · L=${curve.totalLength.toFixed(2)}m) · click cycle`;
        label.style.color = hexStr;
    }

    let cx = 0, cy = 0, nPts = 0;
    u2d.quads2D.forEach(q => q.pts.forEach(p => { cx += p.x; cy += p.y; nPts++; }));
    cx /= Math.max(nPts, 1); cy /= Math.max(nPts, 1);
    let cxx = 0, cyy = 0, cxy = 0;
    u2d.quads2D.forEach(q => q.pts.forEach(p => {
        const dx = p.x - cx, dy = p.y - cy;
        cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
    }));
    const ang = -0.5 * Math.atan2(2 * cxy, cxx - cyy);
    const ca = Math.cos(ang), sa = Math.sin(ang);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const rotQuads = u2d.quads2D.map(q => q.pts.map(p => {
        const dx = p.x - cx, dy = p.y - cy;
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
        ctx.lineWidth = 1.2;
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
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 0.8;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(sp[2].x, sp[2].y);
            ctx.lineTo(sp[3].x, sp[3].y);
            ctx.stroke();
            ctx.restore();
        }
    });
}

export function renderElasticaUnroll3D() {
    clearGroup(viewport.elasticaUnroll3DGroup);
    const data = appState.lastElasticaData;
    const st = appState.elasticaState;
    if (!st.showUnrolled3D || !data || !data.packed || data.packed.placements.length === 0) {
        viewport.elasticaUnroll3DGroup.visible = false;
        return;
    }

    let tMaxX = 0.5;
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (src && src.vertices) {
        for (const v of src.vertices) {
            if (v.x > tMaxX) tMaxX = v.x;
        }
    }
    const startX = tMaxX + 0.55;
    const startY = -0.5;
    const zPlane = 0.008;
    const packed = data.packed;
    const sheetGap = 0.12;

    for (let s = 0; s < packed.sheetCount; s++) {
        const sx0 = startX + s * (packed.bedW + sheetGap);
        const sy0 = startY;
        const sx1 = sx0 + packed.bedW;
        const sy1 = sy0 + packed.bedH;
        const pts = [
            new THREE.Vector3(sx0, sy0, zPlane - 0.002),
            new THREE.Vector3(sx1, sy0, zPlane - 0.002),
            new THREE.Vector3(sx1, sy1, zPlane - 0.002),
            new THREE.Vector3(sx0, sy1, zPlane - 0.002),
            new THREE.Vector3(sx0, sy0, zPlane - 0.002)
        ];
        const bGeo = new THREE.BufferGeometry().setFromPoints(pts);
        const bMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.55 });
        bMat.userData.disposeOnClear = true;
        viewport.elasticaUnroll3DGroup.add(new THREE.Line(bGeo, bMat));
    }

    for (const pl of packed.placements) {
        const sx0 = startX + pl.sheetIdx * (packed.bedW + sheetGap);
        const sy0 = startY;
        const pos = [];
        const edgePos = [];

        for (const pts of pl.rotQuads) {
            const a = [sx0 + pl.ox + pts[0].x, sy0 + pl.oy + pts[0].y, zPlane];
            const b = [sx0 + pl.ox + pts[1].x, sy0 + pl.oy + pts[1].y, zPlane];
            const d = [sx0 + pl.ox + pts[2].x, sy0 + pl.oy + pts[2].y, zPlane];
            const e = [sx0 + pl.ox + pts[3].x, sy0 + pl.oy + pts[3].y, zPlane];
            pos.push(...a, ...b, ...d, ...a, ...d, ...e);
            edgePos.push(...a, ...b, ...b, ...d, ...d, ...e, ...e, ...a);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        const hex = UI_LOOP_PALETTE[pl.curveIdx % UI_LOOP_PALETTE.length];
        const mat = new THREE.MeshBasicMaterial({
            color: hex, transparent: true, opacity: 0.85, side: THREE.DoubleSide
        });
        mat.userData.disposeOnClear = true;
        viewport.elasticaUnroll3DGroup.add(new THREE.Mesh(geo, mat));

        const wireGeo = new THREE.BufferGeometry();
        wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
        const wireMat = new THREE.LineBasicMaterial({ color: 0xf8fafc, transparent: true, opacity: 0.45 });
        wireMat.userData.disposeOnClear = true;
        viewport.elasticaUnroll3DGroup.add(new THREE.LineSegments(wireGeo, wireMat));
    }

    viewport.elasticaUnroll3DGroup.visible = true;
}

export function renderElastica3D() {
    clearGroup(viewport.elasticaGroup);
    const data = appState.lastElasticaData;
    const st = appState.elasticaState;
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (!data) return;

    // 1. Highlight valence = 1 source/sink nodes
    if (st.showLeaves && src && src.vertices && data.leaves) {
        const leafGeo = new THREE.SphereGeometry(0.024, 12, 10);
        const leafMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        leafMat.userData.disposeOnClear = true;
        for (const idx of data.leaves) {
            const v = src.vertices[idx];
            if (!v) continue;
            const p = CORE.toV3(v);
            const m = new THREE.Mesh(leafGeo, leafMat);
            m.position.set(p.x, p.y, p.z);
            viewport.elasticaGroup.add(m);
        }
    }

    if (!data.curves) return;
    for (let i = 0; i < data.curves.length; i++) {
        const c = data.curves[i];
        const hex = UI_LOOP_PALETTE[i % UI_LOOP_PALETTE.length];

        // Optional raw A* skeletal path reference
        if (st.showSkeletalPaths && c.skeletalPoints && c.skeletalPoints.length >= 2) {
            const skPts = c.skeletalPoints.map(p => new THREE.Vector3(p.x, p.y, p.z));
            const skGeo = new THREE.BufferGeometry().setFromPoints(skPts);
            const skMat = new THREE.LineDashedMaterial({ color: 0xfbbf24, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.65 });
            skMat.userData.disposeOnClear = true;
            const skLine = new THREE.Line(skGeo, skMat);
            skLine.computeLineDistances();
            viewport.elasticaGroup.add(skLine);
        }

        // Optimized Elastica curve
        if (st.showCurves && c.points && c.points.length >= 2) {
            const linePts = c.points.map(p => new THREE.Vector3(p.x, p.y, p.z));
            const lineGeo = new THREE.BufferGeometry().setFromPoints(linePts);
            const lineMat = new THREE.LineBasicMaterial({ color: hex, linewidth: 2 });
            lineMat.userData.disposeOnClear = true;
            viewport.elasticaGroup.add(new THREE.Line(lineGeo, lineMat));
        }

        // 3D Tubular Rod Mesh
        const rodMeshData = c.rod || c.ribbon;
        if (st.showRods && rodMeshData && rodMeshData.vertices.length > 0 && rodMeshData.quads.length > 0) {
            const { vertices, quads } = rodMeshData;
            const pos = [];
            const wire = [];
            for (const q of quads) {
                const p0 = vertices[q[0]], p1 = vertices[q[1]], p2 = vertices[q[2]], p3 = vertices[q[3]];
                pos.push(
                    p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z,
                    p0.x, p0.y, p0.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z
                );
                wire.push(
                    p0.x, p0.y, p0.z, p1.x, p1.y, p1.z,
                    p1.x, p1.y, p1.z, p2.x, p2.y, p2.z,
                    p2.x, p2.y, p2.z, p3.x, p3.y, p3.z,
                    p3.x, p3.y, p3.z, p0.x, p0.y, p0.z
                );
            }
            const rGeo = new THREE.BufferGeometry();
            rGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            rGeo.computeVertexNormals();
            const rMat = new THREE.MeshStandardMaterial({
                color: hex, emissive: hex, emissiveIntensity: 0.18,
                roughness: 0.35, metalness: 0.0,
                side: THREE.DoubleSide, transparent: true, opacity: 0.90
            });
            rMat.userData.disposeOnClear = true;
            viewport.elasticaGroup.add(new THREE.Mesh(rGeo, rMat));

            const wGeo = new THREE.BufferGeometry();
            wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
            const wMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.35 });
            wMat.userData.disposeOnClear = true;
            viewport.elasticaGroup.add(new THREE.LineSegments(wGeo, wMat));
        }
    }
}

export function generateElasticaFromUI() {
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (!src || !src.vertices || !src.edges || src.edges.length === 0) {
        setTxt('elastica-readout', 'No active skeletal network. Run Topo/WFC or FDM first.');
        return null;
    }

    const st = appState.elasticaState;
    const data = CORE.generateElasticaRibbons(src.vertices, src.edges, appState.lastSolidData, {
        pairMode: st.pairMode,
        smoothMode: st.smoothMode,
        smoothLevels: st.smoothLevels,
        samplesPerEdge: st.samplesPerEdge,
        iterations: st.iterations,
        bendingWeight: st.bendingWeight,
        guideWeight: st.guideWeight,
        maxDeviation: st.maxDeviation,
        rodRadius: st.rodRadius,
        rodSides: st.rodSides,
        twistDeg: st.twistDeg
    });

    appState.lastElasticaData = data;
    if (st.selectedCurveIdx >= data.curves.length) st.selectedCurveIdx = 0;

    const totalBend = data.curves.reduce((acc, c) => acc + c.bendingEnergy, 0);
    const sheetCount = data.packed ? data.packed.sheetCount : 0;

    const badge = $('elastica-status-badge');
    if (badge) {
        badge.textContent = data.curves.length > 0
            ? `${data.leaves.length} V1 · ${data.curves.length} Elasticas ✓`
            : `${data.leaves.length} V1 · Need ≥2 V1`;
        badge.className = `text-[9px] font-mono ${data.curves.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`;
    }

    setTxt('elastica-readout', `V1 Nodes: ${data.leaves.length} · Curves: ${data.curves.length} · Sheets: ${sheetCount} · Σκ²ds: ${totalBend.toFixed(2)}`);

    renderElastica3D();
    drawElasticaUnrollCanvas();
    if (st.showUnrolled3D) renderElasticaUnroll3D();
    applyOutlinerVisibility();
    recomputeModelBox();
    return data;
}

export function toggleElasticaUnroll3DFromUI(forceState = undefined) {
    if (!appState.lastElasticaData || !appState.lastElasticaData.curves?.length) {
        generateElasticaFromUI();
    }
    appState.elasticaState.showUnrolled3D = forceState !== undefined ? !!forceState : !appState.elasticaState.showUnrolled3D;
    setTxt('elastica-unroll-3d-state', appState.elasticaState.showUnrolled3D ? 'ON' : 'OFF');
    const btn = $('btn-toggle-elastica-unroll-3d');
    if (btn) btn.classList.toggle('on', appState.elasticaState.showUnrolled3D);
    renderElasticaUnroll3D();
    applyOutlinerVisibility();
    recomputeModelBox();
    return appState.elasticaState.showUnrolled3D;
}

export function ensureElasticaTabReady() {
    if (!appState.lastHostGraph && !appState.lastFDMResult && actions.refreshHostGraph) {
        actions.refreshHostGraph({ preserveFixed: true });
    }
    if (appState.fdmState.triggerOnHost && appState.lastFDMResult && actions.renderFDMNetwork) {
        actions.renderFDMNetwork(appState.lastFDMResult);
    } else if (actions.renderHostNetworkInFdmGroup) {
        actions.renderHostNetworkInFdmGroup();
    }
    if (!appState.lastElasticaData || !appState.lastElasticaData.curves?.length) {
        generateElasticaFromUI();
    } else {
        renderElastica3D();
        drawElasticaUnrollCanvas();
    }
}

export function initTabElastica() {
    actions.generateElasticaFromUI = generateElasticaFromUI;
    actions.ensureElasticaTabReady = ensureElasticaTabReady;

    const st = appState.elasticaState;
    let liveRaf = 0;
    const scheduleLiveUpdate = () => {
        if (liveRaf) return;
        liveRaf = requestAnimationFrame(() => {
            liveRaf = 0;
            generateElasticaFromUI();
        });
    };

    $('sel-elastica-pair-mode')?.addEventListener('change', e => {
        st.pairMode = e.target.value;
        scheduleLiveUpdate();
    });
    $('sel-elastica-smooth-mode')?.addEventListener('change', e => {
        st.smoothMode = e.target.value;
        scheduleLiveUpdate();
    });
    bindSlider('rng-elastica-subdiv', 'val-elastica-subdiv', '', v => { st.smoothLevels = Math.round(v); scheduleLiveUpdate(); });
    bindSlider('rng-elastica-samples', 'val-elastica-samples', '', v => { st.samplesPerEdge = Math.round(v); scheduleLiveUpdate(); });
    bindSlider('rng-elastica-iters', 'val-elastica-iters', '', v => { st.iterations = Math.round(v); scheduleLiveUpdate(); });
    bindSlider('rng-elastica-bend', 'val-elastica-bend', '', v => { st.bendingWeight = v; scheduleLiveUpdate(); });
    bindSlider('rng-elastica-guide', 'val-elastica-guide', '', v => { st.guideWeight = v; scheduleLiveUpdate(); });
    bindSlider('rng-elastica-dev', 'val-elastica-dev', 'm', v => { st.maxDeviation = v; scheduleLiveUpdate(); });
    bindSlider('rng-elastica-radius', 'val-elastica-radius', 'm', v => { st.rodRadius = v; scheduleLiveUpdate(); });
    bindSlider('rng-elastica-sides', 'val-elastica-sides', '', v => { st.rodSides = Math.round(v); scheduleLiveUpdate(); });
    bindSlider('rng-elastica-twist', 'val-elastica-twist', '°', v => { st.twistDeg = v; scheduleLiveUpdate(); });

    $('chk-elastica-show-leaves')?.addEventListener('change', e => {
        st.showLeaves = e.target.checked;
        renderElastica3D();
    });
    $('chk-elastica-show-skeletal')?.addEventListener('change', e => {
        st.showSkeletalPaths = e.target.checked;
        renderElastica3D();
    });
    $('chk-elastica-show-curves')?.addEventListener('change', e => {
        st.showCurves = e.target.checked;
        renderElastica3D();
    });
    $('chk-elastica-show-rods')?.addEventListener('change', e => {
        st.showRods = e.target.checked;
        renderElastica3D();
    });

    $('btn-generate-elastica')?.addEventListener('click', () => generateElasticaFromUI());
    $('btn-toggle-elastica-unroll-3d')?.addEventListener('click', () => toggleElasticaUnroll3DFromUI());

    $('elastica-unroll-canvas')?.addEventListener('click', () => {
        const curves = appState.lastElasticaData?.curves || [];
        if (curves.length > 0) {
            st.selectedCurveIdx = (st.selectedCurveIdx + 1) % curves.length;
            drawElasticaUnrollCanvas();
        }
    });

    $('btn-export-elastica-svg')?.addEventListener('click', () => {
        const curves = appState.lastElasticaData?.curves || [];
        if (curves.length === 0) return;
        const svg = CORE.buildElasticaRibbonsSVG(curves);
        downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), 'elastica_rods_unrolled.svg');
    });

    $('btn-reset-elastica')?.addEventListener('click', () => {
        Object.assign(st, {
            pairMode: 'all_pairs',
            smoothMode: 'catmull_clark_1d',
            smoothLevels: 2,
            samplesPerEdge: 8,
            iterations: 40,
            bendingWeight: 0.65,
            guideWeight: 0.08,
            maxDeviation: 0.45,
            rodRadius: 0.015,
            rodSides: 6,
            twistDeg: 0,
            showLeaves: true,
            showSkeletalPaths: false,
            showCurves: true,
            showRods: true,
            showGuideTube: false,
            showUnrolled3D: false,
            selectedCurveIdx: 0
        });
        const setV = (id, v) => { const el = $(id); if (el) el.value = String(v); };
        setV('sel-elastica-pair-mode', 'all_pairs');
        setV('sel-elastica-smooth-mode', 'catmull_clark_1d');
        setV('rng-elastica-subdiv', 2); setTxt('val-elastica-subdiv', '2');
        setV('rng-elastica-samples', 8); setTxt('val-elastica-samples', '8');
        setV('rng-elastica-iters', 40); setTxt('val-elastica-iters', '40');
        setV('rng-elastica-bend', 0.65); setTxt('val-elastica-bend', '0.65');
        setV('rng-elastica-guide', 0.08); setTxt('val-elastica-guide', '0.08');
        setV('rng-elastica-dev', 0.45); setTxt('val-elastica-dev', '0.45m');
        setV('rng-elastica-radius', 0.015); setTxt('val-elastica-radius', '0.015m');
        setV('rng-elastica-sides', 6); setTxt('val-elastica-sides', '6');
        setV('rng-elastica-twist', 0); setTxt('val-elastica-twist', '0°');
        setTxt('elastica-unroll-3d-state', 'OFF');
        $('btn-toggle-elastica-unroll-3d')?.classList.remove('on');
        clearGroup(viewport.elasticaUnroll3DGroup);
        generateElasticaFromUI();
    });
}

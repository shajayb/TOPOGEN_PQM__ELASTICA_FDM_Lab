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
    sharedMaterials,
    clearGroup,
    makeFatMaterial,
    makeFatLine,
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

            <!-- Interactive Source & Sink Node Selection (3D Click, Valency, Ctrl+Click Deselect) -->
            <div class="bg-gray-950/85 border border-gray-800 rounded p-1.5 space-y-1 font-sans">
                <div class="flex items-center justify-between">
                    <span class="text-[8.5px] uppercase tracking-wider text-emerald-400 font-semibold">Source &amp; Sink Vertices</span>
                    <span id="elastica-ss-badge" class="text-[8.5px] font-mono text-gray-400">Auto V1</span>
                </div>
                <div class="grid grid-cols-2 gap-1">
                    <button type="button" id="btn-elastica-pick-source" class="cad-btn seg-on text-[8.5px] py-0.5" title="Clicking 3D nodes or Valency buttons adds to Source vertices">Pick: Source (Green)</button>
                    <button type="button" id="btn-elastica-pick-sink" class="cad-btn text-[8.5px] py-0.5" title="Clicking 3D nodes or Valency buttons adds to Sink vertices">Pick: Sink (Red)</button>
                </div>
                <div class="text-[8.5px] text-gray-400 leading-tight">
                    Click 3D node = Add · <span class="text-rose-300 font-mono">Ctrl+Click</span> = De-select
                </div>
                <div class="flex items-center justify-between gap-1 pt-0.5">
                    <span class="text-[8px] text-gray-400 flex-shrink-0">Valency:</span>
                    <div class="grid grid-cols-5 gap-0.5 flex-1">
                        <button type="button" data-el-valency="1" class="el-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Select valency-1 nodes (Ctrl+Click to de-select)">v=1</button>
                        <button type="button" data-el-valency="2" class="el-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Select valency-2 nodes (Ctrl+Click to de-select)">v=2</button>
                        <button type="button" data-el-valency="3" class="el-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Select valency-3 nodes (Ctrl+Click to de-select)">v=3</button>
                        <button type="button" data-el-valency="4" class="el-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Select valency-4 nodes (Ctrl+Click to de-select)">v=4</button>
                        <button type="button" data-el-valency="5+" class="el-valency-btn cad-btn text-[8.5px] py-0.5 px-1" title="Select valency >= 5 nodes (Ctrl+Click to de-select)">v≥5</button>
                    </div>
                </div>
                <div class="grid grid-cols-3 gap-1 pt-0.5">
                    <button type="button" id="btn-el-top-sources" class="cad-btn text-[8px] py-0.5" title="Set highest-Z nodes as Sources">↑ Top → Src</button>
                    <button type="button" id="btn-el-ground-sinks" class="cad-btn text-[8px] py-0.5" title="Set lowest-Z ground nodes as Sinks">⏚ Gnd → Sink</button>
                    <button type="button" id="btn-el-clear-ss" class="cad-btn text-[8px] py-0.5" title="Clear custom Source/Sink selection (revert to V1 Pairs)">✕ Clear S/T</button>
                </div>
                <div id="elastica-ss-list" class="text-[8px] font-mono text-gray-400 truncate">Src: Auto · Sink: Auto</div>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Solver</span>
                <select id="sel-elastica-smooth-mode" class="min-w-0 flex-1 bg-gray-950 border border-gray-700 rounded px-1.5 py-0.5 text-[9.5px] text-gray-200">
                    <option value="der_inextensible">Discrete Elastic Rod (Inextensible)</option>
                    <option value="catmull_clark_1d">Catmull-Clark 1D + Arc-Length</option>
                    <option value="catmull_rom">Catmull-Rom + Arc-Length</option>
                </select>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Smooth</span>
                <input type="range" id="rng-elastica-subdiv" min="0" max="4" step="1" value="2" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-cyan-400" title="Maya-style Smooth Level (0..4) — press PageUp / PageDown">
                <span id="val-elastica-subdiv" class="w-14 text-right text-gray-200 flex-shrink-0">2 (PgUp)</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Tightness</span>
                <input type="range" id="rng-elastica-tightness" min="0" max="100" step="5" value="50" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-amber-400" title="0% = wide sweeping arcs, 100% = tight corner bends hugging the skeleton">
                <span id="val-elastica-tightness" class="w-14 text-right text-gray-200 flex-shrink-0">50%</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Rod R</span>
                <input type="range" id="rng-elastica-radius" min="0.005" max="0.060" step="0.001" value="0.015" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-elastica-radius" class="w-14 text-right text-gray-200 flex-shrink-0">0.015m</span>
            </div>

            <div class="flex items-center space-x-2 min-w-0">
                <span class="w-16 text-gray-400 flex-shrink-0">Rod Sides</span>
                <input type="range" id="rng-elastica-sides" min="4" max="12" step="2" value="6" class="min-w-0 flex-1 h-1.5 bg-gray-700 rounded-lg cursor-pointer accent-pink-500">
                <span id="val-elastica-sides" class="w-14 text-right text-gray-200 flex-shrink-0">6</span>
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
                <button id="btn-toggle-elastica-unroll-3d" class="cad-btn cyan w-full py-1 flex items-center justify-between text-[9.5px]" title="3D Unrolled Rods — Lay flat cut sheets beside 3D model.">
                    <span>Toggle 3D Unrolled Rods</span>
                    <span id="elastica-unroll-3d-state" class="font-mono text-[9px] opacity-90">OFF</span>
                </button>
                <div class="flex items-center justify-between text-[8.5px] font-mono text-gray-400">
                    <span id="elastica-unroll-label" class="text-cyan-400 truncate">2D Unrolled Rod Preview</span>
                </div>
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
    const cutMM = (curve.totalLength * 1000).toFixed(1);
    const rMinStr = Number.isFinite(curve.minBendRadius) ? `Rmin=${(curve.minBendRadius * 1000).toFixed(0)}mm` : 'Straight';
    if (label) {
        label.textContent = `Rod #${selIdx + 1}/${curves.length} (${curve.startNode}→${curve.endNode} · Cut=${cutMM}mm · ${rMinStr})`;
        label.style.color = hexStr;
    }

    const minX = u2d.minX, maxX = Math.max(u2d.maxX, u2d.minX + 1e-4);
    const padX = 14;
    const scaleX = (W - padX * 2) / (maxX - minX);
    // Keep straight bar clearly legible vertically in the 82px preview strip
    const barHalfH = Math.max(8, Math.min(18, (u2d.maxY - u2d.minY) * 0.5 * scaleX));
    const cy = H * 0.44;
    const maxK = Math.max(curve.maxCurvature || 0, 1e-4);

    u2d.quads2D.forEach((q, idx) => {
        const x0 = padX + (q.pts[0].x - minX) * scaleX;
        const x1 = padX + (q.pts[2].x - minX) * scaleX;
        const kFrac = Math.min(1, (q.kappa || 0) / maxK);
        const alphaHex = Math.round(45 + kFrac * 145).toString(16).padStart(2, '0');

        ctx.fillStyle = hexStr + alphaHex;
        ctx.strokeStyle = hexStr;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(x0, cy - barHalfH, Math.max(0.5, x1 - x0), barHalfH * 2);
        ctx.fill();
        ctx.stroke();

        if (idx < u2d.quads2D.length - 1) {
            ctx.save();
            ctx.strokeStyle = '#f8fafc';
            ctx.lineWidth = 0.75;
            ctx.setLineDash([2, 2]);
            ctx.beginPath();
            ctx.moveTo(x1, cy - barHalfH);
            ctx.lineTo(x1, cy + barHalfH);
            ctx.stroke();
            ctx.restore();
        }
    });

    // Draw 1:1 Cut-to-Length dimension line underneath the straight bar
    const dimY = H - 11;
    ctx.strokeStyle = '#94a3b8';
    ctx.fillStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, dimY);
    ctx.lineTo(W - padX, dimY);
    ctx.moveTo(padX, dimY - 4);
    ctx.lineTo(padX, dimY + 4);
    ctx.moveTo(W - padX, dimY - 4);
    ctx.lineTo(W - padX, dimY + 4);
    ctx.stroke();
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Straight Stock Cut Length = ${cutMM} mm (Δparity 0.0 mm)`, W * 0.5, dimY - 3);
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
        const uMesh = new THREE.Mesh(geo, appState.arcticOn ? sharedMaterials.arctic : mat);
        uMesh.userData.baseMaterial = mat;
        uMesh.visible = !appState.wireframeOn;
        viewport.elasticaUnroll3DGroup.add(uMesh);

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
    if (!data) {
        if (actions.applyOutlinerVisibility) actions.applyOutlinerVisibility();
        return;
    }

    // 1. Highlight Source / Sink / V=1 nodes (sized relative to fdmNodePickMeshes baseR)
    if (st.showLeaves && src && src.vertices) {
        const bb = src.boundingBox || { min: [-0.5, -0.5, 0], max: [0.5, 0.5, 2] };
        const span = Math.max(0.5, Math.hypot(bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]));
        const baseR = Math.max(0.018, Math.min(0.055, span * 0.018)) * (appState.nodeDisplayScale || 1.0);
        const hasCustom = (appState.elasticaSourceSet.size > 0 || appState.elasticaSinkSet.size > 0);
        const leafGeo = new THREE.SphereGeometry(1.0, 12, 10);
        const srcMat = new THREE.MeshBasicMaterial({ color: 0x10b981 });
        const sinkMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e });
        const bothMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
        srcMat.userData.disposeOnClear = true;
        sinkMat.userData.disposeOnClear = true;
        bothMat.userData.disposeOnClear = true;

        if (hasCustom) {
            const allPicked = new Set([...appState.elasticaSourceSet, ...appState.elasticaSinkSet]);
            for (const idx of allPicked) {
                const v = src.vertices[idx];
                if (!v) continue;
                const inSrc = appState.elasticaSourceSet.has(idx);
                const inSink = appState.elasticaSinkSet.has(idx);
                const mat = (inSrc && inSink) ? bothMat : (inSrc ? srcMat : sinkMat);
                const p = CORE.toV3(v);
                const m = new THREE.Mesh(leafGeo, mat);
                m.position.set(p.x, p.y, p.z);
                m.scale.setScalar(baseR * 1.35);
                viewport.elasticaGroup.add(m);
            }
        } else if (data.leaves) {
            for (const idx of data.leaves) {
                const v = src.vertices[idx];
                if (!v) continue;
                const p = CORE.toV3(v);
                const m = new THREE.Mesh(leafGeo, sinkMat);
                m.position.set(p.x, p.y, p.z);
                m.scale.setScalar(baseR * 1.18);
                viewport.elasticaGroup.add(m);
            }
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
            const lineMat = makeFatMaterial(hex, appState.edgeDisplayWidthPx || 1.5, { disposeOnClear: true });
            viewport.elasticaGroup.add(makeFatLine(linePts, lineMat));
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
            const rodMesh = new THREE.Mesh(rGeo, appState.arcticOn ? sharedMaterials.arctic : rMat);
            rodMesh.userData.baseMaterial = rMat;
            rodMesh.visible = !appState.wireframeOn;
            viewport.elasticaGroup.add(rodMesh);

            const wGeo = new THREE.BufferGeometry();
            wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
            const wMat = new THREE.LineBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.35 });
            wMat.userData.disposeOnClear = true;
            viewport.elasticaGroup.add(new THREE.LineSegments(wGeo, wMat));
        }
    }
}

export function updateElasticaSourceSinkUI() {
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    const nVerts = src && src.vertices ? src.vertices.length : 0;
    const validSrc = Array.from(appState.elasticaSourceSet).filter(i => i >= 0 && i < nVerts).sort((a, b) => a - b);
    const validSink = Array.from(appState.elasticaSinkSet).filter(i => i >= 0 && i < nVerts).sort((a, b) => a - b);

    const badge = $('elastica-ss-badge');
    if (badge) {
        if (validSrc.length === 0 && validSink.length === 0) {
            badge.textContent = 'Auto V1';
            badge.className = 'text-[8.5px] font-mono text-gray-400';
        } else {
            badge.textContent = `Src: ${validSrc.length} · Sink: ${validSink.length}`;
            badge.className = 'text-[8.5px] font-mono text-emerald-300';
        }
    }

    const listEl = $('elastica-ss-list');
    if (listEl) {
        const fmt = (arr) => arr.length === 0 ? 'Auto(V1)' : (arr.length <= 6 ? arr.map(i => `#${i}`).join(',') : `${arr.slice(0, 5).map(i => `#${i}`).join(',')} +${arr.length - 5}`);
        listEl.textContent = `Src: ${fmt(validSrc)} | Sink: ${fmt(validSink)}`;
    }

    const btnPickSrc = $('btn-elastica-pick-source');
    const btnPickSink = $('btn-elastica-pick-sink');
    const isSrc = appState.elasticaState.pickTarget !== 'sink';
    if (btnPickSrc) btnPickSrc.classList.toggle('seg-on', isSrc);
    if (btnPickSink) btnPickSink.classList.toggle('seg-on', !isSrc);
}

export function toggleElasticaNodesByClick(hostIndices, isCtrlDeselect = false) {
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (!src || !src.vertices || !Array.isArray(hostIndices)) return;
    const targetSet = appState.elasticaState.pickTarget === 'sink' ? appState.elasticaSinkSet : appState.elasticaSourceSet;
    for (const hIdx of hostIndices) {
        if (hIdx < 0 || hIdx >= src.vertices.length) continue;
        if (isCtrlDeselect) targetSet.delete(hIdx);
        else targetSet.add(hIdx);
    }
    updateElasticaSourceSinkUI();
    generateElasticaFromUI();
}

export function selectElasticaByValency(valSpec, isCtrlDeselect = false) {
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (!src || !src.vertices || !src.edges) return;
    const deg = new Int32Array(src.vertices.length);
    for (const e of src.edges) {
        if (!e || e.length < 2) continue;
        if (e[0] >= 0 && e[0] < deg.length) deg[e[0]]++;
        if (e[1] >= 0 && e[1] < deg.length) deg[e[1]]++;
    }
    const targetSet = appState.elasticaState.pickTarget === 'sink' ? appState.elasticaSinkSet : appState.elasticaSourceSet;
    for (let i = 0; i < deg.length; i++) {
        const kv = deg[i];
        if (!(valSpec === '5+' ? (kv >= 5) : (kv === parseInt(valSpec, 10)))) continue;
        if (isCtrlDeselect) targetSet.delete(i);
        else targetSet.add(i);
    }
    updateElasticaSourceSinkUI();
    generateElasticaFromUI();
}

export function generateElasticaFromUI() {
    const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
    if (!src || !src.vertices || !src.edges || src.edges.length === 0) {
        setTxt('elastica-readout', 'No active skeletal network. Run Topo/WFC or FDM first.');
        return null;
    }

    const nVerts = src.vertices.length;
    const sourceNodes = Array.from(appState.elasticaSourceSet).filter(i => i >= 0 && i < nVerts);
    const sinkNodes = Array.from(appState.elasticaSinkSet).filter(i => i >= 0 && i < nVerts);
    updateElasticaSourceSinkUI();

    const st = appState.elasticaState;
    const smoothLvl = Math.max(0, Math.min(4, Math.round(st.smoothLevel !== undefined ? st.smoothLevel : 2)));
    const tight = Math.max(0, Math.min(1, st.tightness !== undefined ? st.tightness : 0.50));
    // Map intuitive Tightness (0..1) and Smooth (0..4) to non-faceted DER parameters
    const smoothLevels = smoothLvl === 0 ? 0 : Math.min(3, smoothLvl + 1);
    const samplesPerEdge = smoothLvl === 0 ? 4 : (8 + smoothLvl * 2);
    const iterations = smoothLvl === 0 ? 0 : (30 + smoothLvl * 20);
    const bendingWeight = 0.85 - tight * 0.45;
    const guideWeight = 0.02 + tight * 0.40;
    const maxDeviation = 0.90 - tight * 0.78;

    const data = CORE.generateElasticaRibbons(src.vertices, src.edges, appState.lastSolidData, {
        pairMode: st.pairMode,
        sourceNodes,
        sinkNodes,
        smoothMode: st.smoothMode,
        inextensible: st.inextensible !== false,
        smoothLevels,
        samplesPerEdge,
        iterations,
        bendingWeight,
        guideWeight,
        maxDeviation,
        rodRadius: st.rodRadius,
        rodSides: st.rodSides,
        twistDeg: 0
    });

    appState.lastElasticaData = data;
    if (st.selectedCurveIdx >= data.curves.length) st.selectedCurveIdx = 0;

    const totalStockM = data.curves.reduce((acc, c) => acc + c.totalLength, 0);
    const minBendR = data.curves.reduce((acc, c) => Math.min(acc, Number.isFinite(c.minBendRadius) ? c.minBendRadius : acc), Infinity);
    const rMinTxt = Number.isFinite(minBendR) ? `${(minBendR * 1000).toFixed(0)}mm` : '∞';
    const sheetCount = data.packed ? data.packed.sheetCount : 0;

    const badge = $('elastica-status-badge');
    if (badge) {
        badge.textContent = data.curves.length > 0
            ? `${data.curves.length} Rods · ΣL=${totalStockM.toFixed(1)}m ✓`
            : `${data.leaves.length} V1 · Need ≥2`;
        badge.className = `text-[9px] font-mono ${data.curves.length > 0 ? 'text-emerald-400' : 'text-amber-400'}`;
    }

    setTxt('elastica-readout', `Rods: ${data.curves.length} · Stock ΣL: ${totalStockM.toFixed(2)}m · Min R_bend: ${rMinTxt} · Cut Sheets: ${sheetCount}`);

    renderElastica3D();
    drawElasticaUnrollCanvas();
    if (st.showUnrolled3D) renderElasticaUnroll3D();
    applyOutlinerVisibility();
    recomputeModelBox();
    if (actions.updateSimUI) actions.updateSimUI();
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
    generateElasticaFromUI();
}

export function initTabElastica() {
    actions.generateElasticaFromUI = generateElasticaFromUI;
    actions.toggleElasticaUnroll3DFromUI = toggleElasticaUnroll3DFromUI;
    actions.ensureElasticaTabReady = ensureElasticaTabReady;
    actions.toggleElasticaNodesByClick = toggleElasticaNodesByClick;

    const st = appState.elasticaState;

    $('btn-elastica-pick-source')?.addEventListener('click', () => {
        st.pickTarget = 'source';
        updateElasticaSourceSinkUI();
    });
    $('btn-elastica-pick-sink')?.addEventListener('click', () => {
        st.pickTarget = 'sink';
        updateElasticaSourceSinkUI();
    });
    document.querySelectorAll('.el-valency-btn').forEach(btn => {
        btn.addEventListener('click', e => {
            selectElasticaByValency(btn.dataset.elValency, !!(e.ctrlKey || e.metaKey));
        });
    });
    $('btn-el-top-sources')?.addEventListener('click', () => {
        const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
        if (!src || !src.vertices || src.vertices.length === 0) return;
        let maxZ = -Infinity;
        const zs = src.vertices.map(v => { const z = CORE.toV3(v).z; if (z > maxZ) maxZ = z; return z; });
        appState.elasticaSourceSet.clear();
        zs.forEach((z, i) => { if (z >= maxZ - 0.08) appState.elasticaSourceSet.add(i); });
        updateElasticaSourceSinkUI();
        generateElasticaFromUI();
    });
    $('btn-el-ground-sinks')?.addEventListener('click', () => {
        const src = actions.getActiveGraphWithAnchors ? actions.getActiveGraphWithAnchors() : null;
        if (!src || !src.vertices || src.vertices.length === 0) return;
        let minZ = Infinity;
        const zs = src.vertices.map(v => { const z = CORE.toV3(v).z; if (z < minZ) minZ = z; return z; });
        appState.elasticaSinkSet.clear();
        zs.forEach((z, i) => { if (z <= minZ + 0.08) appState.elasticaSinkSet.add(i); });
        updateElasticaSourceSinkUI();
        generateElasticaFromUI();
    });
    $('btn-el-clear-ss')?.addEventListener('click', () => {
        appState.elasticaSourceSet.clear();
        appState.elasticaSinkSet.clear();
        appState.lastElasticaData = null;
        clearGroup(viewport.elasticaGroup);
        clearGroup(viewport.elasticaUnroll3DGroup);
        viewport.elasticaUnroll3DGroup.visible = false;
        st.showUnrolled3D = false;
        setTxt('elastica-unroll-3d-state', 'OFF');
        $('btn-toggle-elastica-unroll-3d')?.classList.remove('on');
        updateElasticaSourceSinkUI();
        drawElasticaUnrollCanvas();
        const badge = $('elastica-status-badge');
        if (badge) { badge.textContent = 'Cleared'; badge.className = 'text-[9px] font-mono text-gray-400'; }
        setTxt('elastica-readout', 'Cleared — pick Sources/Sinks or click Trace');
        if (actions.updateSimUI) actions.updateSimUI();
    });
    let liveRaf = 0;
    const scheduleLiveUpdate = () => {
        if (liveRaf) return;
        liveRaf = requestAnimationFrame(() => {
            liveRaf = 0;
            generateElasticaFromUI();
        });
    };

    const setSmoothLevel = (lvl) => {
        st.smoothLevel = Math.max(0, Math.min(4, Math.round(lvl)));
        const rng = $('rng-elastica-subdiv');
        if (rng) rng.value = String(st.smoothLevel);
        setTxt('val-elastica-subdiv', `${st.smoothLevel} (PgUp)`);
        scheduleLiveUpdate();
    };

    window.addEventListener('keydown', (e) => {
        if (appState.activeTabId !== 'tab-elastica') return;
        if (e.key === 'PageUp') {
            e.preventDefault();
            setSmoothLevel((st.smoothLevel || 0) + 1);
        } else if (e.key === 'PageDown') {
            e.preventDefault();
            setSmoothLevel((st.smoothLevel || 0) - 1);
        }
    });

    $('sel-elastica-pair-mode')?.addEventListener('change', e => {
        st.pairMode = e.target.value;
        scheduleLiveUpdate();
    });
    $('sel-elastica-smooth-mode')?.addEventListener('change', e => {
        st.smoothMode = e.target.value;
        scheduleLiveUpdate();
    });
    bindSlider('rng-elastica-subdiv', 'val-elastica-subdiv', ' (PgUp)', v => { st.smoothLevel = Math.round(v); scheduleLiveUpdate(); });
    bindSlider('rng-elastica-tightness', 'val-elastica-tightness', '%', v => { st.tightness = v / 100; scheduleLiveUpdate(); });
    bindSlider('rng-elastica-radius', 'val-elastica-radius', 'm', v => { st.rodRadius = v; scheduleLiveUpdate(); });
    bindSlider('rng-elastica-sides', 'val-elastica-sides', '', v => { st.rodSides = Math.round(v); scheduleLiveUpdate(); });

    $('chk-elastica-show-leaves')?.addEventListener('change', e => {
        st.showLeaves = e.target.checked;
        renderElastica3D();
        if (actions.applyOutlinerVisibility) actions.applyOutlinerVisibility();
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
        appState.showQuadMeshes = st.showRods;
        appState.groupVis.meshes = st.showRods;
        appState.tubeState.show = st.showRods;
        const chkShowMeshes = $('chk-show-meshes');
        if (chkShowMeshes) chkShowMeshes.checked = st.showRods;
        const chkTubeShow = $('chk-tube-show');
        if (chkTubeShow) chkTubeShow.checked = st.showRods;
        renderElastica3D();
        if (actions.applyOutlinerVisibility) actions.applyOutlinerVisibility();
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
            smoothMode: 'der_inextensible',
            inextensible: true,
            smoothLevel: 2,
            tightness: 0.50,
            rodRadius: 0.015,
            rodSides: 6,
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
        setV('sel-elastica-smooth-mode', 'der_inextensible');
        setV('rng-elastica-subdiv', 2); setTxt('val-elastica-subdiv', '2 (PgUp)');
        setV('rng-elastica-tightness', 50); setTxt('val-elastica-tightness', '50%');
        setV('rng-elastica-radius', 0.015); setTxt('val-elastica-radius', '0.015m');
        setV('rng-elastica-sides', 6); setTxt('val-elastica-sides', '6');
        setTxt('elastica-unroll-3d-state', 'OFF');
        $('btn-toggle-elastica-unroll-3d')?.classList.remove('on');
        clearGroup(viewport.elasticaUnroll3DGroup);
        generateElasticaFromUI();
    });
    actions.renderElastica3D = renderElastica3D;
}

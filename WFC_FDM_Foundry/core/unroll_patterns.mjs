/**
 * WFC-FDM Foundry — Core Module 5: 2D Unrolled Strip Patterns & Laser-Sheet Nesting
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 *
 * Student Quick-Map:
 *   - Edit interactive single-strip 2D unfolding     -> unrollFaceLoop2D()
 *   - Edit per-bar 2D unfolding & laser bed nesting  -> buildUnrolledPatterns()
 *   - Edit 2D self-intersection & overlap audit      -> verifyUnrolledPatterns()
 *   - Edit laser-ready SVG cut/fold sheet styling    -> buildUnrolledPatternsSVG()
 *
 * Inputs:  FDM network + solidified PQ quad mesh, laser bed dimensions
 * Outputs: .unrolled.json data (wfc-fdm-unrolled/v1) and .patterns.svg vector cut sheets
 */

import { V3, toV3, toArr3 } from './math_tiles.mjs';

function computeQuadPlanarity(vertices, q) {
    const p0 = toV3(vertices[q[0]]);
    const p1 = toV3(vertices[q[1]]);
    const p2 = toV3(vertices[q[2]]);
    const p3 = toV3(vertices[q[3]]);

    const d1 = new V3().subVectors(p2, p0);
    const d2 = new V3().subVectors(p3, p1);
    let n = new V3().crossVectors(d1, d2);
    let nLen = n.length();
    if (nLen < 1e-12) {
        const e01 = new V3().subVectors(p1, p0);
        n = new V3().crossVectors(e01, d1);
        nLen = n.length();
        if (nLen < 1e-12) {
            return { h: 0, err: 0, skewDist: 0, relErr: 0, normal: new V3(0, 0, 1) };
        }
    }
    n.divideScalar(nLen);

    const sx = p0.x - p1.x + p2.x - p3.x;
    const sy = p0.y - p1.y + p2.y - p3.y;
    const sz = p0.z - p1.z + p2.z - p3.z;
    const dot = sx * n.x + sy * n.y + sz * n.z;
    const h = 0.25 * dot;
    const err = Math.abs(h);
    const skewDist = Math.abs(dot) * 0.5;
    const avgDiag = 0.5 * (d1.length() + d2.length());
    const relErr = skewDist / Math.max(avgDiag, 1e-6);

    return { h, err, skewDist, relErr, normal: n };
}

function unrollFaceLoop2D(vertices, quads, loop) {
    if (!loop || !loop.steps || loop.steps.length === 0) {
        return { quads2D: [], minX: 0, maxX: 1, minY: 0, maxY: 1 };
    }
    const quads2D = [];
    let prevTL = null;
    let prevTR = null;

    for (let m = 0; m < loop.steps.length; m++) {
        const { qIdx, enterSide } = loop.steps[m];
        const q = quads[qIdx];
        if (!q) continue;
        const s0 = enterSide;
        const iBL = q[s0];
        const iBR = q[(s0 + 1) % 4];
        const iTR = q[(s0 + 2) % 4];
        const iTL = q[(s0 + 3) % 4];

        const { h, relErr, normal } = computeQuadPlanarity(vertices, q);
        const sign0 = (s0 % 2 === 0) ? -1 : 1;
        const pBL = toV3(vertices[iBL]).addScaledVector(normal,  sign0 * h);
        const pBR = toV3(vertices[iBR]).addScaledVector(normal, -sign0 * h);
        const pTR = toV3(vertices[iTR]).addScaledVector(normal,  sign0 * h);
        const pTL = toV3(vertices[iTL]).addScaledVector(normal, -sign0 * h);

        const baseVec = new V3().subVectors(pBR, pBL);
        const baseLen = Math.max(baseVec.length(), 1e-6);
        const e1 = baseVec.clone().divideScalar(baseLen);
        const e2 = new V3().crossVectors(normal, e1).normalize();
        const toTL = new V3().subVectors(pTL, pBL);
        if (toTL.dot(e2) < 0) e2.negate();

        const toTR = new V3().subVectors(pTR, pBL);
        const localTR = { x: toTR.dot(e1), y: toTR.dot(e2) };
        const localTL = { x: toTL.dot(e1), y: toTL.dot(e2) };

        let U_BL, U_BR, U_TR, U_TL;
        if (m === 0 || !prevTL || !prevTR) {
            U_BL = { x: 0, y: 0 };
            U_BR = { x: baseLen, y: 0 };
            U_TR = { x: localTR.x, y: localTR.y };
            U_TL = { x: localTL.x, y: localTL.y };
        } else {
            U_BL = { x: prevTL.x, y: prevTL.y };
            const hx = prevTR.x - prevTL.x;
            const hy = prevTR.y - prevTL.y;
            const hLen = Math.max(Math.hypot(hx, hy), 1e-6);
            const dirX = hx / hLen;
            const dirY = hy / hLen;
            const perpX = -dirY;
            const perpY =  dirX;

            U_BR = { x: U_BL.x + dirX * baseLen, y: U_BL.y + dirY * baseLen };
            U_TR = {
                x: U_BL.x + localTR.x * dirX + localTR.y * perpX,
                y: U_BL.y + localTR.x * dirY + localTR.y * perpY
            };
            U_TL = {
                x: U_BL.x + localTL.x * dirX + localTL.y * perpX,
                y: U_BL.y + localTL.x * dirY + localTL.y * perpY
            };
        }

        prevTL = U_TL;
        prevTR = U_TR;

        quads2D.push({
            qIdx,
            stepIndex: m,
            relErr,
            pts: [U_BL, U_BR, U_TR, U_TL]
        });
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < quads2D.length; i++) {
        const pts = quads2D[i].pts;
        for (let k = 0; k < 4; k++) {
            const p = pts[k];
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
    }
    if (!Number.isFinite(minX)) { minX = 0; maxX = 1; minY = 0; maxY = 1; }
    return { quads2D, minX, maxX, minY, maxY };
}

// ============================================================
//  2D PER-BAR UNROLLED STRIP PATTERNS (.unrolled.json & .patterns.svg)
// ============================================================

function quadSignedArea2D(q) {
    let s = 0.0;
    for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        s += a[0] * b[1] - b[0] * a[1];
    }
    return 0.5 * s;
}

function isConvexQuad2D(q) {
    for (let i = 0; i < 4; i++) {
        const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
        const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
        if (cross <= 1e-12) return false;
    }
    return true;
}

function segmentsIntersectNonShared2D(p1, p2, p3, p4) {
    const samePt = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-7;
    if (samePt(p1, p3) || samePt(p1, p4) || samePt(p2, p3) || samePt(p2, p4)) return false;
    const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const onSeg = (a, b, c) =>
        c[0] >= Math.min(a[0], b[0]) - 1e-9 && c[0] <= Math.max(a[0], b[0]) + 1e-9 &&
        c[1] >= Math.min(a[1], b[1]) - 1e-9 && c[1] <= Math.max(a[1], b[1]) + 1e-9;
    const o1 = orient(p1, p2, p3);
    const o2 = orient(p1, p2, p4);
    const o3 = orient(p3, p4, p1);
    const o4 = orient(p3, p4, p2);
    if (((o1 > 1e-11 && o2 < -1e-11) || (o1 < -1e-11 && o2 > 1e-11)) &&
        ((o3 > 1e-11 && o4 < -1e-11) || (o3 < -1e-11 && o4 > 1e-11))) {
        return true;
    }
    if (Math.abs(o1) <= 1e-11 && onSeg(p1, p2, p3)) return true;
    if (Math.abs(o2) <= 1e-11 && onSeg(p1, p2, p4)) return true;
    if (Math.abs(o3) <= 1e-11 && onSeg(p3, p4, p1)) return true;
    if (Math.abs(o4) <= 1e-11 && onSeg(p3, p4, p2)) return true;
    return false;
}

function localPlanarQuadCoords2D(vertices, q) {
    const { h, normal } = computeQuadPlanarity(vertices, q);
    const p0 = toV3(vertices[q[0]]).addScaledVector(normal, -h);
    const p1 = toV3(vertices[q[1]]).addScaledVector(normal,  h);
    const p2 = toV3(vertices[q[2]]).addScaledVector(normal, -h);
    const p3 = toV3(vertices[q[3]]).addScaledVector(normal,  h);

    const v01 = new V3().subVectors(p1, p0);
    const L01 = Math.max(1e-6, v01.length());
    const e1 = v01.clone().divideScalar(L01);
    const e2 = new V3().crossVectors(normal, e1).normalize();
    const v03 = new V3().subVectors(p3, p0);
    if (v03.dot(e2) < 0) e2.negate();
    const v02 = new V3().subVectors(p2, p0);
    return [
        [0, 0],
        [L01, 0],
        [v02.dot(e1), v02.dot(e2)],
        [v03.dot(e1), v03.dot(e2)]
    ];
}

function mapLocalQuadByEdge(loc, idxA, idxB, targetA, targetB) {
    const lx = loc[idxB][0] - loc[idxA][0];
    const ly = loc[idxB][1] - loc[idxA][1];
    const lLen = Math.max(1e-7, Math.hypot(lx, ly));
    const luX = lx / lLen, luY = ly / lLen;
    const lvX = -luY, lvY = luX;

    const tx = targetB[0] - targetA[0];
    const ty = targetB[1] - targetA[1];
    const tLen = Math.max(1e-7, Math.hypot(tx, ty));
    const tuX = tx / tLen, tuY = ty / tLen;
    const tvX = -tuY, tvY = tuX;

    const out = new Array(4);
    for (let k = 0; k < 4; k++) {
        if (k === idxA) { out[k] = [targetA[0], targetA[1]]; continue; }
        if (k === idxB) { out[k] = [targetB[0], targetB[1]]; continue; }
        const dx = loc[k][0] - loc[idxA][0];
        const dy = loc[k][1] - loc[idxA][1];
        const uCoord = dx * luX + dy * luY;
        const vCoord = dx * lvX + dy * lvY;
        out[k] = [
            targetA[0] + uCoord * tuX + vCoord * tvX,
            targetA[1] + uCoord * tuY + vCoord * tvY
        ];
    }
    return out;
}

function checkQuads2DValidAndNonIntersecting(qs) {
    if (!qs || qs.length === 0) return false;
    const segs = [];
    for (let qi = 0; qi < qs.length; qi++) {
        const q = qs[qi];
        if (quadSignedArea2D(q) <= 1e-11 || !isConvexQuad2D(q)) return false;
        for (let c = 0; c < 4; c++) segs.push([q[c], q[(c + 1) % 4]]);
    }
    for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
            if (segmentsIntersectNonShared2D(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) return false;
        }
    }
    return true;
}

// Isometric 3D->2D unrolling directly from the bar's planarized pure-quad grid in solidData
function unrollBarQuadGridFromSolidData(vertices, quads, grid) {
    if (!grid || grid.length === 0 || !grid[0] || grid[0].length === 0) return null;
    const nRows = grid.length;
    const nCols = grid[0].length;

    // Attempt 1: Single connected 2D unfolded net hinged along middle row + columns
    const rMid = Math.floor(nRows / 2);
    const placed = Array.from({ length: nRows }, () => new Array(nCols).fill(null));
    for (let c = 0; c < nCols; c++) {
        const q = quads[grid[rMid][c]];
        if (!q) return null;
        const loc = localPlanarQuadCoords2D(vertices, q);
        if (c === 0) {
            placed[rMid][0] = loc;
        } else {
            const prev = placed[rMid][c - 1];
            // Attach left edge (0 -> 3) of current quad to right edge (1 -> 2) of prev quad
            placed[rMid][c] = mapLocalQuadByEdge(loc, 0, 3, prev[1], prev[2]);
        }
    }
    for (let c = 0; c < nCols; c++) {
        for (let r = rMid + 1; r < nRows; r++) {
            const q = quads[grid[r][c]];
            if (!q) return null;
            const loc = localPlanarQuadCoords2D(vertices, q);
            const below = placed[r - 1][c];
            placed[r][c] = mapLocalQuadByEdge(loc, 0, 1, below[3], below[2]);
        }
        for (let r = rMid - 1; r >= 0; r--) {
            const q = quads[grid[r][c]];
            if (!q) return null;
            const loc = localPlanarQuadCoords2D(vertices, q);
            const above = placed[r + 1][c];
            placed[r][c] = mapLocalQuadByEdge(loc, 3, 2, above[0], above[1]);
        }
    }
    const flatConnected = [];
    for (let r = 0; r < nRows; r++) {
        for (let c = 0; c < nCols; c++) flatConnected.push(placed[r][c]);
    }
    if (checkQuads2DValidAndNonIntersecting(flatConnected)) {
        return flatConnected;
    }

    // Attempt 2: Relief-slit longitudinal PQ strips (each 1 x nRows strip is a tree of quads -> 100% isometric & overlap-free)
    const slitQuads = [];
    let curOffsetX = 0.0;
    const slitGap = 0.002;
    for (let c = 0; c < nCols; c++) {
        const colQs = new Array(nRows);
        for (let r = 0; r < nRows; r++) {
            const q = quads[grid[r][c]];
            if (!q) return null;
            const loc = localPlanarQuadCoords2D(vertices, q);
            if (r === 0) {
                colQs[0] = loc;
            } else {
                const below = colQs[r - 1];
                colQs[r] = mapLocalQuadByEdge(loc, 0, 1, below[3], below[2]);
            }
        }
        let cMinX = Infinity, cMaxX = -Infinity, cMinY = Infinity;
        for (let r = 0; r < nRows; r++) {
            for (let k = 0; k < 4; k++) {
                const x = colQs[r][k][0], y = colQs[r][k][1];
                if (x < cMinX) cMinX = x;
                if (x > cMaxX) cMaxX = x;
                if (y < cMinY) cMinY = y;
            }
        }
        for (let r = 0; r < nRows; r++) {
            slitQuads.push(colQs[r].map(p => [p[0] - cMinX + curOffsetX, p[1] - cMinY]));
        }
        curOffsetX += (cMaxX - cMinX) + slitGap;
    }
    return checkQuads2DValidAndNonIntersecting(slitQuads) ? slitQuads : null;
}

function unrollSingleBarLocalQuads(spec, fallbackRadius = 0.015, fallbackSides = 8, fallbackSubdiv = 1) {
    if (!spec) {
        const N = Math.max(3, fallbackSides);
        const nBands = Math.max(1, fallbackSubdiv + 1);
        const w = 2 * fallbackRadius * Math.sin(Math.PI / N);
        const h = 0.1 / nBands;
        const qs = [];
        for (let m = 0; m < nBands; m++) {
            for (let k = 0; k < N; k++) {
                qs.push([[k * w, m * h], [(k + 1) * w, m * h], [(k + 1) * w, (m + 1) * h], [k * w, (m + 1) * h]]);
            }
        }
        return qs;
    }

    if (spec.type === 'cylinder_parallel') {
        const N = spec.nSides;
        const nBands = spec.subdivLevels + 1;
        const wid = spec.radius;
        const angles = spec.angles;
        const U = new Float64Array(N + 1);
        U[0] = 0.0;
        for (let k = 0; k < N; k++) {
            const k1 = (k + 1) % N;
            const w_k = Math.max(1e-4, wid * Math.hypot(
                Math.cos(angles[k1]) - Math.cos(angles[k]),
                Math.sin(angles[k1]) - Math.sin(angles[k])
            ));
            U[k + 1] = U[k] + w_k;
        }
        let minZ = Infinity;
        for (let m = 0; m <= nBands; m++) {
            for (let k = 0; k < N; k++) {
                if (spec.zRings[m][k] < minZ) minZ = spec.zRings[m][k];
            }
        }
        const localQuads = [];
        for (let m = 0; m < nBands; m++) {
            for (let k = 0; k < N; k++) {
                const k1 = (k + 1) % N;
                localQuads.push([
                    [U[k],     spec.zRings[m][k]     - minZ],
                    [U[k + 1], spec.zRings[m][k1]    - minZ],
                    [U[k + 1], spec.zRings[m + 1][k1] - minZ],
                    [U[k],     spec.zRings[m + 1][k] - minZ]
                ]);
            }
        }
        return localQuads;
    }

    // Frustum / regular prism bar
    const N = spec.nSides;
    const nBands = spec.subdivLevels + 1;
    const zRings = spec.zRings;
    const rRings = spec.rRings;
    const dr = rRings[nBands] - rRings[0];
    const dzTotal = Math.max(1e-4, zRings[nBands] - zRings[0]);

    if (Math.abs(dr) <= 1e-6) {
        const r = rRings[0];
        const w = Math.max(1e-4, 2 * r * Math.sin(Math.PI / N));
        const z0 = zRings[0];
        const localQuads = [];
        for (let m = 0; m < nBands; m++) {
            const y0 = zRings[m] - z0;
            const y1 = zRings[m + 1] - z0;
            for (let k = 0; k < N; k++) {
                localQuads.push([
                    [k * w,       y0],
                    [(k + 1) * w, y0],
                    [(k + 1) * w, y1],
                    [k * w,       y1]
                ]);
            }
        }
        return localQuads;
    }

    const edgeSlant = Math.hypot(dzTotal, dr);
    const sinHalfWedge = Math.min(0.98, (Math.abs(dr) / edgeSlant) * Math.sin(Math.PI / N));
    const dTheta = 2.0 * Math.asin(sinHalfWedge);
    const startTheta = -0.5 * N * dTheta;
    const gridPts = Array.from({ length: nBands + 1 }, () => new Array(N + 1));

    for (let m = 0; m <= nBands; m++) {
        const rho = (rRings[m] * edgeSlant) / Math.abs(dr);
        for (let k = 0; k <= N; k++) {
            const th = startTheta + k * dTheta;
            if (dr > 0) gridPts[m][k] = [rho * Math.sin(th), rho * Math.cos(th)];
            else gridPts[m][k] = [-rho * Math.sin(th), -rho * Math.cos(th)];
        }
    }

    const rawQuads = [];
    let minX = Infinity, minY = Infinity;
    for (let m = 0; m < nBands; m++) {
        for (let k = 0; k < N; k++) {
            let q = [
                gridPts[m][k],
                gridPts[m][k + 1],
                gridPts[m + 1][k + 1],
                gridPts[m + 1][k]
            ];
            if (quadSignedArea2D(q) < 0) q = [q[1], q[0], q[3], q[2]];
            for (let c = 0; c < 4; c++) {
                if (q[c][0] < minX) minX = q[c][0];
                if (q[c][1] < minY) minY = q[c][1];
            }
            rawQuads.push(q);
        }
    }
    return rawQuads.map(q => q.map(p => [p[0] - minX, p[1] - minY]));
}

function verifyUnrolledPatterns(unrolledJson) {
    const bars = unrolledJson.bars || [];
    let hasSelfIntersection = false;
    let hasBBoxOverlap = false;
    let nonPositiveAreaCount = 0;

    for (let bi = 0; bi < bars.length; bi++) {
        const qs = bars[bi].quads2D || [];
        const segs = [];
        for (let qi = 0; qi < qs.length; qi++) {
            const q = qs[qi];
            if (quadSignedArea2D(q) <= 1e-11 || !isConvexQuad2D(q)) {
                nonPositiveAreaCount++;
            }
            for (let c = 0; c < 4; c++) {
                segs.push([q[c], q[(c + 1) % 4]]);
            }
        }
        for (let i = 0; i < segs.length && !hasSelfIntersection; i++) {
            for (let j = i + 1; j < segs.length; j++) {
                if (segmentsIntersectNonShared2D(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) {
                    hasSelfIntersection = true;
                    break;
                }
            }
        }
    }

    for (let i = 0; i < bars.length && !hasBBoxOverlap; i++) {
        const a = bars[i].bbox2D;
        for (let j = i + 1; j < bars.length; j++) {
            const b = bars[j].bbox2D;
            const sep = (a[2] <= b[0] - 1e-6) || (b[2] <= a[0] - 1e-6) || (a[3] <= b[1] - 1e-6) || (b[3] <= a[1] - 1e-6);
            if (!sep) { hasBBoxOverlap = true; break; }
        }
    }

    return {
        valid: !hasSelfIntersection && !hasBBoxOverlap && nonPositiveAreaCount === 0,
        hasSelfIntersection,
        hasBBoxOverlap,
        nonPositiveAreaCount
    };
}

function buildUnrolledPatterns(fdmResult, solidData, options = {}) {
    const round6 = (v) => Math.round(v * 1e6) / 1e6;
    const name = options.name || 'wfc_fdm_candidate';
    const nEdges = fdmResult.edges.length;
    const specs = (solidData && solidData.barStripSpecs) ? solidData.barStripSpecs : [];
    const grids = (solidData && solidData.barQuadGrids) ? solidData.barQuadGrids : [];
    const fallbackR = Number(options.outerRadiusM || 0.015);
    const fallbackSides = Math.round(options.nSides || 8);
    const fallbackSubdiv = Math.max(0, Math.round(
        options.longitudinalSubdivLevels !== undefined
            ? options.longitudinalSubdivLevels
            : (solidData && solidData.longitudinalSubdivLevels !== undefined ? solidData.longitudinalSubdivLevels : 0)
    ));

    const localStrips = [];
    for (let e = 0; e < nEdges; e++) {
        const [u, v] = fdmResult.edges[e];
        const pu = toArr3(fdmResult.vertices[u]), pv = toArr3(fdmResult.vertices[v]);
        const cLen = Math.hypot(pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]);
        const spec = specs[e];
        let qs = null;
        let barSides = spec ? spec.nSides : fallbackSides;
        let barSubdiv = fallbackSubdiv;

        if (solidData && solidData.vertices && solidData.quads && grids[e]) {
            qs = unrollBarQuadGridFromSolidData(solidData.vertices, solidData.quads, grids[e]);
            if (qs && grids[e][0]) {
                barSides = grids[e][0].length;
                barSubdiv = Math.max(0, grids[e].length - 1);
            }
        }
        if (!qs) {
            qs = unrollSingleBarLocalQuads(spec, fallbackR, fallbackSides, fallbackSubdiv);
        }

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let qi = 0; qi < qs.length; qi++) {
            for (let c = 0; c < 4; c++) {
                const x = qs[qi][c][0], y = qs[qi][c][1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        }
        const normQs = qs.map(q => q.map(p => [p[0] - minX, p[1] - minY]));
        localStrips.push({
            edgeIndex: e,
            endpoints: [u, v],
            centerlineLengthM: round6(cLen),
            subdivLevels: barSubdiv,
            nSides: barSides,
            width: Math.max(1e-4, maxX - minX),
            height: Math.max(1e-4, maxY - minY),
            localQuads: normQs
        });
    }

    // Shelf-pack strips onto typical laser cutter bed sheets in meters (default 0.60m × 0.90m, i.e., 600×900 mm; automatically expands sheet width/height if a single strip is wider/taller, and adds new sheets when exceeded!)
    const marginM = 0.020;
    const gapXM = 0.018;
    const gapYM = 0.025;
    let maxStripWidthM = 0.0;
    let maxStripHeightM = 0.0;
    for (let i = 0; i < localStrips.length; i++) {
        if (localStrips[i].width > maxStripWidthM) maxStripWidthM = localStrips[i].width;
        if (localStrips[i].height > maxStripHeightM) maxStripHeightM = localStrips[i].height;
    }
    const bedWidthM = Math.max(
        0.30,
        Number(options.laserBedWidthM || 0.60),
        Math.ceil((maxStripWidthM + 2 * marginM + 0.04) * 100) / 100
    );
    const bedHeightM = Math.max(
        0.45,
        Number(options.laserBedHeightM || 0.90),
        Math.ceil((maxStripHeightM + 2 * marginM + 0.04) * 100) / 100
    );
    const sheetGapXM = Math.max(0.06, Number(options.laserSheetGapM || 0.08));
    const usableW = Math.max(0.15, bedWidthM - 2 * marginM);
    const usableH = Math.max(0.20, bedHeightM - 2 * marginM);

    const bars = [];
    let totalArea = 0.0;
    let sheetIdx = 0;
    let cursorX = marginM;
    let cursorY = marginM;
    let rowMaxH = 0.0;

    for (let e = 0; e < nEdges; e++) {
        const st = localStrips[e];
        // Wrap to next row if strip exceeds current row width
        if (cursorX > marginM + 1e-6 && (cursorX + st.width > marginM + usableW + 1e-6)) {
            cursorX = marginM;
            cursorY += rowMaxH + gapYM;
            rowMaxH = 0.0;
        }
        // Advance to next laser bed sheet if strip exceeds current sheet height
        if (cursorY > marginM + 1e-6 && (cursorY + st.height > marginM + usableH + 1e-6)) {
            sheetIdx++;
            cursorX = marginM;
            cursorY = marginM;
            rowMaxH = 0.0;
        }

        const sheetOffsetX = sheetIdx * (bedWidthM + sheetGapXM);
        const offX = sheetOffsetX + cursorX;
        const offY = cursorY;
        const quads2D = st.localQuads.map(q => q.map(p => [round6(offX + p[0]), round6(offY + p[1])]));
        let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
        let barArea = 0.0;
        for (let qi = 0; qi < quads2D.length; qi++) {
            const q = quads2D[qi];
            barArea += Math.max(0, quadSignedArea2D(q));
            for (let c = 0; c < 4; c++) {
                if (q[c][0] < bMinX) bMinX = q[c][0];
                if (q[c][0] > bMaxX) bMaxX = q[c][0];
                if (q[c][1] < bMinY) bMinY = q[c][1];
                if (q[c][1] > bMaxY) bMaxY = q[c][1];
            }
        }
        totalArea += barArea;
        bars.push({
            edgeIndex: st.edgeIndex,
            endpoints: st.endpoints,
            sheetIndex: sheetIdx,
            centerlineLengthM: st.centerlineLengthM,
            subdivLevels: st.subdivLevels,
            nSides: st.nSides,
            areaM2: round6(barArea),
            bbox2D: [round6(bMinX), round6(bMinY), round6(bMaxX), round6(bMaxY)],
            quads2D
        });
        if (st.height > rowMaxH) rowMaxH = st.height;
        cursorX += st.width + gapXM;
    }

    const sheetCount = Math.max(1, sheetIdx + 1);
    const sheets = [];
    for (let s = 0; s < sheetCount; s++) {
        const x0 = round6(s * (bedWidthM + sheetGapXM));
        let sMaxH = bedHeightM;
        for (let bi = 0; bi < bars.length; bi++) {
            if (bars[bi].sheetIndex === s && bars[bi].bbox2D[3] + marginM > sMaxH) {
                sMaxH = round6(bars[bi].bbox2D[3] + marginM);
            }
        }
        sheets.push({
            sheetIndex: s,
            widthM: round6(bedWidthM),
            heightM: round6(sMaxH),
            bbox2D: [x0, 0, round6(x0 + bedWidthM), round6(sMaxH)]
        });
    }

    const unrolledJson = {
        $schema: 'wfc-fdm-unrolled/v1',
        name,
        units: 'meters',
        barCount: nEdges,
        sheetCount,
        laserBedSizeM: [round6(bedWidthM), round6(bedHeightM)],
        sheets,
        totalUnrolledSurfaceAreaM2: round6(totalArea),
        hasSelfIntersection: false,
        bars
    };

    const audit = verifyUnrolledPatterns(unrolledJson);
    unrolledJson.hasSelfIntersection = audit.hasSelfIntersection || audit.hasBBoxOverlap;
    const patternsSvg = buildUnrolledPatternsSVG(unrolledJson, { name });
    return { unrolledJson, patternsSvg, audit };
}

function buildUnrolledPatternsSVG(unrolledJson, options = {}) {
    const bars = unrolledJson.bars || [];
    const sheets = unrolledJson.sheets || [];
    const scaleMM = 1000.0; // 1 SVG user unit = 1 mm
    const headerMM = 32.0;
    const padMM = 24.0;

    let maxSheetX = 0.6, maxSheetY = 0.9;
    for (let s = 0; s < sheets.length; s++) {
        const sb = sheets[s].bbox2D;
        if (sb[2] > maxSheetX) maxSheetX = sb[2];
        if (sb[3] > maxSheetY) maxSheetY = sb[3];
    }
    for (let i = 0; i < bars.length; i++) {
        const bb = bars[i].bbox2D;
        if (bb[2] > maxSheetX) maxSheetX = bb[2];
        if (bb[3] > maxSheetY) maxSheetY = bb[3];
    }
    const widthMM = Math.ceil(maxSheetX * scaleMM + padMM);
    const contentHeightMM = Math.ceil(maxSheetY * scaleMM + padMM);
    const totalHeightMM = contentHeightMM + headerMM;

    // Map right-handed sheet (x, y) in meters -> top-down SVG (X, Y) in mm
    const sx = (xm) => (xm * scaleMM).toFixed(2);
    const sy = (ym) => (headerMM + contentHeightMM - ym * scaleMM).toFixed(2);

    const lines = [];
    lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthMM} ${totalHeightMM}" width="${widthMM}mm" height="${totalHeightMM}mm">`);
    lines.push(`  <rect x="0" y="0" width="${widthMM}" height="${totalHeightMM}" fill="#070A10"/>`);
    const sheetInfoStr = sheets.length > 0 ? ` · ${sheets.length} LASER SHEET(S) (${(sheets[0].widthM * 1000).toFixed(0)}×${(sheets[0].heightM * 1000).toFixed(0)}mm)` : '';
    lines.push(`  <text x="24" y="21" fill="#F8FAFC" font-family="Calibri, system-ui, sans-serif" font-size="11" font-weight="700">WFC-FDM UNROLLED PQ BAR PATTERNS — ${unrolledJson.name} · ${unrolledJson.barCount} BARS${sheetInfoStr} · TOTAL AREA ${unrolledJson.totalUnrolledSurfaceAreaM2.toFixed(4)} m²</text>`);

    for (let s = 0; s < sheets.length; s++) {
        const sb = sheets[s].bbox2D;
        const rx = (sb[0] * scaleMM).toFixed(2);
        const ry = (headerMM + contentHeightMM - sb[3] * scaleMM).toFixed(2);
        const rw = ((sb[2] - sb[0]) * scaleMM).toFixed(2);
        const rh = ((sb[3] - sb[1]) * scaleMM).toFixed(2);
        lines.push(`  <rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="none" stroke="#EC4899" stroke-width="1.2" stroke-dasharray="6,4"/>`);
        lines.push(`  <text x="${(sb[0] * scaleMM + 6).toFixed(2)}" y="${(headerMM + contentHeightMM - sb[3] * scaleMM + 13).toFixed(2)}" fill="#EC4899" font-family="Consolas, monospace" font-size="9" font-weight="700">LASER SHEET #${s + 1} (${((sb[2] - sb[0])).toFixed(2)}m × ${((sb[3] - sb[1])).toFixed(2)}m)</text>`);
    }

    const ptKey = (p) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)}`;

    for (let bi = 0; bi < bars.length; bi++) {
        const bar = bars[bi];
        const qs = bar.quads2D;
        lines.push(`  <g id="bar-${bar.edgeIndex}" data-edge-index="${bar.edgeIndex}" data-endpoints="${bar.endpoints[0]},${bar.endpoints[1]}">`);

        const edgeCount = new Map();
        const edgeSegments = new Map();

        for (let qi = 0; qi < qs.length; qi++) {
            const q = qs[qi];
            const ptsAttr = q.map(p => `${sx(p[0])},${sy(p[1])}`).join(' ');
            lines.push(`    <polygon points="${ptsAttr}" fill="#111927" fill-opacity="0.82" stroke="none"/>`);
            for (let c = 0; c < 4; c++) {
                const pA = q[c], pB = q[(c + 1) % 4];
                const kA = ptKey(pA), kB = ptKey(pB);
                const eKey = kA < kB ? `${kA}|${kB}` : `${kB}|${kA}`;
                edgeCount.set(eKey, (edgeCount.get(eKey) || 0) + 1);
                if (!edgeSegments.has(eKey)) edgeSegments.set(eKey, [pA, pB]);
            }
        }

        // Internal mountain/valley fold lines (count >= 2) and outer laser/knife cut contours (count === 1)
        for (const [eKey, cnt] of edgeCount.entries()) {
            const [pA, pB] = edgeSegments.get(eKey);
            if (cnt === 1) {
                lines.push(`    <line x1="${sx(pA[0])}" y1="${sy(pA[1])}" x2="${sx(pB[0])}" y2="${sy(pB[1])}" stroke="#F8FAFC" stroke-width="1.05" stroke-linecap="round"/>`);
            } else {
                lines.push(`    <line x1="${sx(pA[0])}" y1="${sy(pA[1])}" x2="${sx(pB[0])}" y2="${sy(pB[1])}" stroke="#38BDF8" stroke-width="0.55" stroke-dasharray="2.4,1.8"/>`);
            }
        }

        const bb = bar.bbox2D;
        const lblX = (bb[0] * scaleMM).toFixed(2);
        const lblY = (headerMM + contentHeightMM - bb[1] * scaleMM + 11.0).toFixed(2);
        lines.push(`    <text x="${lblX}" y="${lblY}" fill="#94A3B8" font-family="Consolas, monospace" font-size="7.5">B${bar.edgeIndex} L=${(bar.centerlineLengthM * 1000).toFixed(0)}mm (${(bar.areaM2 * 1e4).toFixed(1)}cm²)</text>`);
        lines.push(`  </g>`);
    }

    lines.push(`</svg>`);
    return lines.join('\n') + '\n';
}

export {
    computeQuadPlanarity,
    unrollFaceLoop2D,
    quadSignedArea2D,
    isConvexQuad2D,
    segmentsIntersectNonShared2D,
    localPlanarQuadCoords2D,
    mapLocalQuadByEdge,
    checkQuads2DValidAndNonIntersecting,
    unrollBarQuadGridFromSolidData,
    unrollSingleBarLocalQuads,
    verifyUnrolledPatterns,
    buildUnrolledPatterns,
    buildUnrolledPatternsSVG
};

/**
 * WFC-FDM Foundry — Core Module 7: Skeletal A* Elastica Curves & Unrolled Ribbons (core/elastica_curves.mjs)
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 *
 * 1. Finds all valence = 1 nodes (sources & sinks) in the skeletal network.
 * 2. Traces A* / Dijkstra shortest paths through the skeletal network between valence-1 nodes.
 * 3. Optimizes each traced path into a smooth Euler Elastica curve (rounding sharp skeletal
 *    corners while staying guided by the skeletal / tubular envelope).
 * 4. Builds Rotation-Minimizing Frame (RMF) all-quad ribbon strips along each elastica.
 * 5. Isometrically unfolds and packs the ribbons into 2D fabrication sheets & SVG.
 */

import { V3, toV3 } from './math_tiles.mjs';

/**
 * Find all valence-1 (degree-1) node indices in a skeletal graph.
 */
export function findValenceOneNodes(vertices, edges) {
    if (!vertices || !edges || vertices.length === 0) return [];
    const deg = new Int32Array(vertices.length);
    for (const e of edges) {
        if (!e || e.length < 2) continue;
        const a = e[0], b = e[1];
        if (a >= 0 && a < vertices.length) deg[a]++;
        if (b >= 0 && b < vertices.length) deg[b]++;
    }
    const leaves = [];
    for (let i = 0; i < deg.length; i++) {
        if (deg[i] === 1) leaves.push(i);
    }
    return leaves;
}

/**
 * A* shortest path between `startIdx` and `goalIdx` on the skeletal graph.
 * Falls back cleanly to Dijkstra when heuristic weight is 0.
 */
function aStarPath(startIdx, goalIdx, pts3, adj) {
    const n = pts3.length;
    const gScore = new Float64Array(n).fill(Infinity);
    const fScore = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new Set([startIdx]);

    const goal = pts3[goalIdx];
    const h = (idx) => {
        const v = pts3[idx];
        return Math.hypot(goal.x - v.x, goal.y - v.y, goal.z - v.z);
    };

    gScore[startIdx] = 0;
    fScore[startIdx] = h(startIdx);

    while (open.size > 0) {
        let u = -1;
        let bestF = Infinity;
        for (const cand of open) {
            if (fScore[cand] < bestF) {
                bestF = fScore[cand];
                u = cand;
            }
        }
        if (u === -1) break;
        if (u === goalIdx) {
            const nodeIndices = [];
            let cur = goalIdx;
            while (cur !== -1) {
                nodeIndices.push(cur);
                if (cur === startIdx) break;
                cur = prev[cur];
            }
            nodeIndices.reverse();
            return { nodeIndices, length: gScore[goalIdx] };
        }

        open.delete(u);
        closed[u] = 1;

        for (const nb of adj[u]) {
            if (closed[nb.to]) continue;
            const tentativeG = gScore[u] + nb.len;
            if (tentativeG < gScore[nb.to]) {
                prev[nb.to] = u;
                gScore[nb.to] = tentativeG;
                fScore[nb.to] = tentativeG + h(nb.to);
                open.add(nb.to);
            }
        }
    }

    return null;
}

/**
 * Trace A* / Dijkstra paths through the skeletal network between valence-1 sources and sinks.
 * @param {Array} vertices
 * @param {Array} edges
 * @param {Object} options - { pairMode: 'all_pairs' | 'nearest_k' | 'top_to_bottom', nearestK: 2, maxCurves: 64 }
 */
export function traceSkeletalPathsAStar(vertices, edges, options = {}) {
    const leaves = findValenceOneNodes(vertices, edges);
    if (leaves.length < 2) return { leaves, paths: [] };

    const pts3 = vertices.map(v => toV3(v));
    const pairMode = options.pairMode || 'all_pairs';
    const nearestK = Math.max(1, Math.round(options.nearestK || 2));
    const maxCurves = Math.max(1, Math.round(options.maxCurves || 64));

    const adj = Array.from({ length: pts3.length }, () => []);
    for (const e of edges) {
        if (!e || e.length < 2) continue;
        const a = e[0], b = e[1];
        const va = pts3[a], vb = pts3[b];
        if (!va || !vb) continue;
        const len = Math.hypot(vb.x - va.x, vb.y - va.y, vb.z - va.z);
        if (len < 1e-9) continue;
        adj[a].push({ to: b, len });
        adj[b].push({ to: a, len });
    }

    // Determine source/sink pairs
    let pairs = [];
    if (pairMode === 'top_to_bottom') {
        let minZ = Infinity, maxZ = -Infinity;
        for (const idx of leaves) {
            const z = pts3[idx].z;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
        const midZ = 0.5 * (minZ + maxZ);
        const sources = leaves.filter(idx => pts3[idx].z >= midZ);
        const sinks = leaves.filter(idx => pts3[idx].z < midZ);
        if (sources.length > 0 && sinks.length > 0) {
            for (const s of sources) {
                for (const t of sinks) {
                    pairs.push([s, t]);
                }
            }
        }
    }

    // Default / fallback to all pairs if top_to_bottom had empty side or all_pairs/nearest_k
    if (pairs.length === 0) {
        for (let i = 0; i < leaves.length; i++) {
            for (let j = i + 1; j < leaves.length; j++) {
                pairs.push([leaves[i], leaves[j]]);
            }
        }
    }

    const traced = [];
    const seenPairs = new Set();

    for (const [s, t] of pairs) {
        const key = s < t ? `${s}-${t}` : `${t}-${s}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);

        const res = aStarPath(s, t, pts3, adj);
        if (!res || res.nodeIndices.length < 2) continue;

        const points = res.nodeIndices.map(idx => pts3[idx].clone());
        traced.push({
            id: traced.length,
            startNode: s,
            endNode: t,
            nodeIndices: res.nodeIndices,
            pathLength: res.length,
            points
        });
    }

    if (pairMode === 'nearest_k') {
        const keepIds = new Set();
        for (const s of leaves) {
            const incident = traced
                .filter(p => p.startNode === s || p.endNode === s)
                .sort((a, b) => a.pathLength - b.pathLength)
                .slice(0, nearestK);
            for (const p of incident) keepIds.add(p.id);
        }
        const filtered = traced.filter(p => keepIds.has(p.id)).slice(0, maxCurves);
        return { leaves, paths: filtered.map((p, idx) => ({ ...p, id: idx })) };
    }

    traced.sort((a, b) => a.pathLength - b.pathLength);
    const paths = traced.slice(0, maxCurves).map((p, idx) => ({ ...p, id: idx }));
    return { leaves, paths };
}

/**
 * 1D Catmull-Clark (Cubic B-Spline) subdivision on an open polyline with pinned endpoints.
 * Each level inserts edge midpoints and smooths interior vertices with [1/8, 6/8, 1/8]
 * (blended by `smoothness` in [0..1]), rounding corners identically to Catmull-Clark.
 */
export function subdivideCatmullClark1D(points, levels = 2, smoothness = 1.0) {
    let pts = points.map(p => p.clone());
    const lvls = Math.max(0, Math.min(5, Math.round(levels)));
    const w = Math.max(0, Math.min(1, smoothness));

    for (let l = 0; l < lvls; l++) {
        if (pts.length < 3) break;
        const next = [pts[0].clone()];
        for (let i = 0; i < pts.length - 1; i++) {
            const a = pts[i];
            const b = pts[i + 1];
            const mid = new V3(0.5 * (a.x + b.x), 0.5 * (a.y + b.y), 0.5 * (a.z + b.z));
            if (i > 0) {
                const prev = pts[i - 1];
                const cc = new V3(
                    0.125 * prev.x + 0.75 * a.x + 0.125 * b.x,
                    0.125 * prev.y + 0.75 * a.y + 0.125 * b.y,
                    0.125 * prev.z + 0.75 * a.z + 0.125 * b.z
                );
                next.push(new V3(
                    a.x + (cc.x - a.x) * w,
                    a.y + (cc.y - a.y) * w,
                    a.z + (cc.z - a.z) * w
                ));
            }
            next.push(mid);
        }
        next.push(pts[pts.length - 1].clone());
        pts = next;
    }
    return pts;
}

/**
 * Centripetal / uniform Catmull-Rom spline evaluation through `points` with `samplesPerEdge` per span.
 */
export function sampleCatmullRom(points, samplesPerEdge = 8, tension = 0.5) {
    if (!points || points.length < 2) return points ? points.map(p => p.clone()) : [];
    if (points.length === 2) return resamplePath(points, samplesPerEdge).pts;

    const sub = Math.max(2, Math.round(samplesPerEdge));
    const tau = Math.max(0.0, Math.min(1.5, tension));
    const pts = [];

    for (let i = 0; i < points.length - 1; i++) {
        const p0 = i > 0 ? points[i - 1] : points[0];
        const p1 = points[i];
        const p2 = points[i + 1];
        const p3 = i + 2 < points.length ? points[i + 2] : points[points.length - 1];

        const count = (i === points.length - 2) ? sub + 1 : sub;
        for (let k = 0; k < count; k++) {
            const t = k / sub;
            const t2 = t * t;
            const t3 = t2 * t;
            const m1x = tau * (p2.x - p0.x), m1y = tau * (p2.y - p0.y), m1z = tau * (p2.z - p0.z);
            const m2x = tau * (p3.x - p1.x), m2y = tau * (p3.y - p1.y), m2z = tau * (p3.z - p1.z);

            const h00 = 2 * t3 - 3 * t2 + 1;
            const h10 = t3 - 2 * t2 + t;
            const h01 = -2 * t3 + 3 * t2;
            const h11 = t3 - t2;

            pts.push(new V3(
                h00 * p1.x + h10 * m1x + h01 * p2.x + h11 * m2x,
                h00 * p1.y + h10 * m1y + h01 * p2.y + h11 * m2y,
                h00 * p1.z + h10 * m1z + h01 * p2.z + h11 * m2z
            ));
        }
    }
    return pts;
}

/**
 * Resample a skeletal polyline with `samplesPerEdge` subdivisions per skeletal segment.
 */
function resamplePath(pathPoints, samplesPerEdge = 8) {
    const pts = [];
    const sub = Math.max(2, Math.round(samplesPerEdge));
    const nSegs = pathPoints.length - 1;

    for (let s = 0; s < nSegs; s++) {
        const a = pathPoints[s];
        const b = pathPoints[s + 1];
        const count = (s === nSegs - 1) ? sub + 1 : sub;
        for (let k = 0; k < count; k++) {
            const t = k / sub;
            pts.push(new V3(
                a.x + (b.x - a.x) * t,
                a.y + (b.y - a.y) * t,
                a.z + (b.z - a.z) * t
            ));
        }
    }
    return { pts, refPoints: pts.map(p => p.clone()) };
}

/**
 * Compute discrete curvature & bending energy integral sum(kappa^2 * ds).
 */
export function computeElasticaMetrics(pts) {
    if (!pts || pts.length < 3) {
        return { totalLength: 0, bendingEnergy: 0, maxCurvature: 0, avgCurvature: 0 };
    }
    let totalLength = 0;
    let bendingEnergy = 0;
    let maxCurvature = 0;
    let curvSum = 0;
    let curvCount = 0;

    for (let i = 0; i < pts.length - 1; i++) {
        totalLength += pts[i].distanceTo(pts[i + 1]);
    }

    for (let i = 1; i < pts.length - 1; i++) {
        const e0 = new V3().subVectors(pts[i], pts[i - 1]);
        const e1 = new V3().subVectors(pts[i + 1], pts[i]);
        const l0 = e0.length();
        const l1 = e1.length();
        const ds = 0.5 * (l0 + l1);
        if (l0 < 1e-8 || l1 < 1e-8 || ds < 1e-8) continue;

        const t0 = e0.clone().divideScalar(l0);
        const t1 = e1.clone().divideScalar(l1);
        const dot = Math.max(-1, Math.min(1, t0.dot(t1)));
        const theta = Math.acos(dot);
        const kappa = (2 * Math.sin(theta * 0.5)) / ds;
        bendingEnergy += kappa * kappa * ds;
        if (kappa > maxCurvature) maxCurvature = kappa;
        curvSum += kappa;
        curvCount++;
    }

    return {
        totalLength,
        bendingEnergy,
        maxCurvature,
        avgCurvature: curvCount > 0 ? curvSum / curvCount : 0
    };
}

/**
 * Optimize a traced skeletal path into a smooth Euler Elastica curve.
 * Pins the valence-1 source and sink endpoints and relaxes interior points
 * to minimize bending energy (rounding sharp skeletal corners) while staying
 * guided by the skeletal path / tubular envelope.
 */
export function optimizeElasticaCurve(pathPoints, solidData = null, options = {}) {
    const smoothMode = options.smoothMode || 'catmull_clark_1d';
    const smoothLevels = options.smoothLevels !== undefined ? Math.round(options.smoothLevels) : 2;
    const samplesPerEdge = Math.max(2, Math.round(options.samplesPerEdge || 8));
    const iterations = Math.max(0, Math.round(options.iterations !== undefined ? options.iterations : 40));
    const bendingWeight = options.bendingWeight !== undefined ? options.bendingWeight : 0.65;
    const tensionWeight = options.tensionWeight !== undefined ? options.tensionWeight : 0.20;
    const guideWeight = options.guideWeight !== undefined ? options.guideWeight : 0.08;
    const maxDeviation = options.maxDeviation !== undefined ? options.maxDeviation : 0.45;

    let pts;
    let refPoints;
    if (smoothMode === 'catmull_clark_1d') {
        pts = subdivideCatmullClark1D(pathPoints, smoothLevels, 1.0);
        refPoints = pts.map(p => p.clone());
    } else if (smoothMode === 'catmull_rom') {
        pts = sampleCatmullRom(pathPoints, samplesPerEdge, bendingWeight);
        refPoints = pts.map(p => p.clone());
    } else {
        const res = resamplePath(pathPoints, samplesPerEdge);
        pts = res.pts;
        refPoints = res.refPoints;
    }

    const n = pts.length;
    if (n < 3) {
        return { points: pts, refPoints, maxDeviation: 0, ...computeElasticaMetrics(pts) };
    }

    const stepSize = 0.28;
    const nextPts = pts.map(p => p.clone());

    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 1; i < n - 1; i++) {
            const prev = pts[i - 1];
            const curr = pts[i];
            const next = pts[i + 1];

            // 1. Arc-length / tension smoothing
            const lapX = 0.5 * (prev.x + next.x) - curr.x;
            const lapY = 0.5 * (prev.y + next.y) - curr.y;
            const lapZ = 0.5 * (prev.z + next.z) - curr.z;

            // 2. Discrete biharmonic (elastica bending energy gradient)
            const pM2 = i >= 2 ? pts[i - 2] : prev;
            const pP2 = i <= n - 3 ? pts[i + 2] : next;
            const bihX = (-pM2.x + 4 * prev.x - 6 * curr.x + 4 * next.x - pP2.x) * 0.125;
            const bihY = (-pM2.y + 4 * prev.y - 6 * curr.y + 4 * next.y - pP2.y) * 0.125;
            const bihZ = (-pM2.z + 4 * prev.z - 6 * curr.z + 4 * next.z - pP2.z) * 0.125;

            // 3. Skeletal path guidance attraction
            const ref = refPoints[i];
            const guideX = ref.x - curr.x;
            const guideY = ref.y - curr.y;
            const guideZ = ref.z - curr.z;

            let nx = curr.x + stepSize * (bendingWeight * bihX + tensionWeight * lapX + guideWeight * guideX);
            let ny = curr.y + stepSize * (bendingWeight * bihY + tensionWeight * lapY + guideWeight * guideY);
            let nz = curr.z + stepSize * (bendingWeight * bihZ + tensionWeight * lapZ + guideWeight * guideZ);

            // Clamp max radial deviation from skeletal centerline
            if (maxDeviation > 1e-5) {
                const ox = nx - ref.x, oy = ny - ref.y, oz = nz - ref.z;
                const offLen = Math.hypot(ox, oy, oz);
                if (offLen > maxDeviation && offLen > 1e-9) {
                    const s = maxDeviation / offLen;
                    nx = ref.x + ox * s;
                    ny = ref.y + oy * s;
                    nz = ref.z + oz * s;
                }
            }

            nextPts[i].set(nx, ny, nz);
        }
        for (let i = 1; i < n - 1; i++) pts[i].copy(nextPts[i]);
    }

    let peakDev = 0;
    for (let i = 0; i < n; i++) {
        const d = pts[i].distanceTo(refPoints[i]);
        if (d > peakDev) peakDev = d;
    }

    return {
        points: pts,
        refPoints,
        maxDeviation: peakDev,
        ...computeElasticaMetrics(pts)
    };
}

/**
 * Compute a Rotation-Minimizing Frame (Bishop Frame) along `curvePoints`
 * and extrude an all-quad 3D tubular rod mesh of `rodRadius` and `rodSides`.
 */
export function buildElasticaRodMesh(curvePoints, options = {}) {
    const radius = Math.max(0.002, options.rodRadius !== undefined ? options.rodRadius : 0.015);
    const nSides = Math.max(3, Math.round(options.rodSides || 6));
    const twistRad = ((options.twistDeg || 0) * Math.PI) / 180;
    const n = curvePoints ? curvePoints.length : 0;
    if (n < 2) return { vertices: [], quads: [], frames: [], radius, nSides, stripVertices: [], stripQuads: [] };

    const tangents = [];
    for (let i = 0; i < n; i++) {
        const t = new V3();
        if (i === 0) t.subVectors(curvePoints[1], curvePoints[0]);
        else if (i === n - 1) t.subVectors(curvePoints[n - 1], curvePoints[n - 2]);
        else t.subVectors(curvePoints[i + 1], curvePoints[i - 1]);
        if (t.lengthSq() < 1e-12) t.set(0, 0, 1);
        else t.normalize();
        tangents.push(t);
    }

    const t0 = tangents[0];
    const up = Math.abs(t0.z) < 0.9 ? new V3(0, 0, 1) : new V3(1, 0, 0);
    let nVec = new V3().crossVectors(t0, up).normalize();
    let bVec = new V3().crossVectors(t0, nVec).normalize();
    const frames = [{ T: t0.clone(), N: nVec.clone(), B: bVec.clone() }];

    for (let i = 1; i < n; i++) {
        const tPrev = tangents[i - 1];
        const tCurr = tangents[i];
        const axis = new V3().crossVectors(tPrev, tCurr);
        const axisLen = axis.length();
        if (axisLen > 1e-8) {
            axis.divideScalar(axisLen);
            const cosA = Math.max(-1, Math.min(1, tPrev.dot(tCurr)));
            const ang = Math.acos(cosA);
            const c = Math.cos(ang), s = Math.sin(ang);
            const dotAN = axis.dot(nVec);
            const crossAN = new V3().crossVectors(axis, nVec);
            nVec = new V3(
                nVec.x * c + crossAN.x * s + axis.x * dotAN * (1 - c),
                nVec.y * c + crossAN.y * s + axis.y * dotAN * (1 - c),
                nVec.z * c + crossAN.z * s + axis.z * dotAN * (1 - c)
            ).normalize();
        }
        nVec.addScaledVector(tCurr, -nVec.dot(tCurr)).normalize();
        bVec = new V3().crossVectors(tCurr, nVec).normalize();
        frames.push({ T: tCurr.clone(), N: nVec.clone(), B: bVec.clone() });
    }

    const vertices = [];
    const quads = [];
    const stripVertices = [];
    const stripQuads = [];

    for (let i = 0; i < n; i++) {
        const p = curvePoints[i];
        const f = frames[i];
        const uFrac = n > 1 ? i / (n - 1) : 0;
        const tw = twistRad * uFrac;

        for (let k = 0; k < nSides; k++) {
            const ang = tw + (2 * Math.PI * k) / nSides;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            vertices.push(new V3(
                p.x + radius * (ca * f.N.x + sa * f.B.x),
                p.y + radius * (ca * f.N.y + sa * f.B.y),
                p.z + radius * (ca * f.N.z + sa * f.B.z)
            ));
        }

        // Diametral reference strip for clean 2D isometric unrolling (width = 2 * radius)
        const ct = Math.cos(tw), st = Math.sin(tw);
        const dirX = f.N.x * ct + f.B.x * st;
        const dirY = f.N.y * ct + f.B.y * st;
        const dirZ = f.N.z * ct + f.B.z * st;
        stripVertices.push(new V3(p.x - dirX * radius, p.y - dirY * radius, p.z - dirZ * radius));
        stripVertices.push(new V3(p.x + dirX * radius, p.y + dirY * radius, p.z + dirZ * radius));
    }

    for (let i = 0; i < n - 1; i++) {
        const ringA = i * nSides;
        const ringB = (i + 1) * nSides;
        for (let k = 0; k < nSides; k++) {
            const kNext = (k + 1) % nSides;
            quads.push([ringA + k, ringA + kNext, ringB + kNext, ringB + k]);
        }
        const s0 = i * 2;
        stripQuads.push([s0, s0 + 1, s0 + 3, s0 + 2]);
    }

    return { vertices, quads, frames, radius, nSides, stripVertices, stripQuads };
}

/**
 * Isometrically unfold an elastica quad-strip ribbon into 2D (preserving edge & diagonal lengths).
 */
export function unrollElasticaRibbon2D(rod) {
    const vertices = rod && (rod.stripVertices || rod.vertices);
    const quads = rod && (rod.stripQuads || rod.quads);
    if (!rod || !vertices || !quads || quads.length === 0) {
        return { quads2D: [], minX: 0, maxX: 1, minY: 0, maxY: 1, totalArea: 0 };
    }
    const quads2D = [];
    let prevTL = null;
    let prevTR = null;
    let totalArea = 0;

    for (let m = 0; m < quads.length; m++) {
        const q = quads[m];
        const pBL = toV3(vertices[q[0]]);
        const pBR = toV3(vertices[q[1]]);
        const pTR = toV3(vertices[q[2]]);
        const pTL = toV3(vertices[q[3]]);

        const d1 = new V3().subVectors(pTR, pBL);
        const d2 = new V3().subVectors(pTL, pBR);
        let normal = new V3().crossVectors(d1, d2);
        const nLen = normal.length();
        if (nLen > 1e-10) normal.divideScalar(nLen);
        else normal.set(0, 0, 1);

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
            U_BL = prevTL;
            U_BR = prevTR;
            const gVec = { x: U_BR.x - U_BL.x, y: U_BR.y - U_BL.y };
            const gLen = Math.max(Math.hypot(gVec.x, gVec.y), 1e-6);
            const g1 = { x: gVec.x / gLen, y: gVec.y / gLen };
            const g2 = { x: -g1.y, y: g1.x };
            U_TR = { x: U_BL.x + localTR.x * g1.x + localTR.y * g2.x, y: U_BL.y + localTR.x * g1.y + localTR.y * g2.y };
            U_TL = { x: U_BL.x + localTL.x * g1.x + localTL.y * g2.x, y: U_BL.y + localTL.x * g1.y + localTL.y * g2.y };
        }

        const pts = [U_BL, U_BR, U_TR, U_TL];
        let area = 0;
        for (let k = 0; k < 4; k++) {
            const a = pts[k], b = pts[(k + 1) % 4];
            area += a.x * b.y - b.x * a.y;
        }
        totalArea += Math.abs(area) * 0.5;

        quads2D.push({ pts });
        prevTL = U_TL;
        prevTR = U_TR;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const q2 of quads2D) {
        for (const p of q2.pts) {
            if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
    }
    if (!Number.isFinite(minX)) return { quads2D: [], minX: 0, maxX: 1, minY: 0, maxY: 1, totalArea: 0 };
    return { quads2D, minX, maxX, minY, maxY, totalArea };
}

/**
 * PCA-align a 2D unrolled strip horizontally and return its rotated quads + bounding box.
 */
function pcaAlignUnroll2D(u2d) {
    let cx = 0, cy = 0, np = 0;
    u2d.quads2D.forEach(q => q.pts.forEach(p => { cx += p.x; cy += p.y; np++; }));
    cx /= Math.max(np, 1); cy /= Math.max(np, 1);
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
    return { rotQuads, minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Shelf-pack unfolded 2D ribbon strips onto laser-sheet beds.
 */
export function packElasticaRibbons2D(curves, options = {}) {
    const bedW = options.bedWidthM || 0.90;
    const bedH = options.bedHeightM || 0.60;
    const gap = options.gapM !== undefined ? options.gapM : 0.025;

    const aligned = [];
    for (let i = 0; i < curves.length; i++) {
        const c = curves[i];
        if (!c.unrolled2D || !c.unrolled2D.quads2D || c.unrolled2D.quads2D.length === 0) continue;
        const a = pcaAlignUnroll2D(c.unrolled2D);
        aligned.push({ curveIdx: i, curve: c, ...a });
    }
    aligned.sort((a, b) => b.w - a.w);

    const placements = [];
    let sheetIdx = 0;
    let curX = gap, curY = gap, rowH = 0;

    for (const item of aligned) {
        if (curX + item.w + gap > bedW && curX > gap) {
            curX = gap;
            curY += rowH + gap;
            rowH = 0;
        }
        if (curY + item.h + gap > bedH && curY > gap) {
            sheetIdx++;
            curX = gap;
            curY = gap;
            rowH = 0;
        }
        placements.push({
            curveIdx: item.curveIdx,
            sheetIdx,
            ox: curX - item.minX,
            oy: curY - item.minY,
            w: item.w,
            h: item.h,
            rotQuads: item.rotQuads
        });
        curX += item.w + gap;
        if (item.h > rowH) rowH = item.h;
    }

    return { sheetCount: placements.length > 0 ? sheetIdx + 1 : 0, bedW, bedH, placements };
}

/**
 * End-to-end generator: trace A* paths between valence-1 sources & sinks on the
 * skeletal network, optimize into elastica curves, build RMF quad ribbons, and unroll + pack.
 */
export function generateElasticaRibbons(vertices, edges, solidData = null, options = {}) {
    const { leaves, paths } = traceSkeletalPathsAStar(vertices, edges, options);
    const curves = [];

    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const opt = optimizeElasticaCurve(path.points, solidData, options);
        const rod = buildElasticaRodMesh(opt.points, options);
        const unrolled2D = unrollElasticaRibbon2D(rod);
        curves.push({
            id: i,
            startNode: path.startNode,
            endNode: path.endNode,
            nodeIndices: path.nodeIndices,
            skeletalLength: path.pathLength,
            skeletalPoints: path.points,
            points: opt.points,
            refPoints: opt.refPoints,
            totalLength: opt.totalLength,
            bendingEnergy: opt.bendingEnergy,
            maxCurvature: opt.maxCurvature,
            avgCurvature: opt.avgCurvature,
            maxDeviation: opt.maxDeviation,
            rod,
            unrolled2D
        });
    }

    const packed = packElasticaRibbons2D(curves, options);
    return { leaves, curves, packed };
}

/**
 * Export packed & unfolded 2D elastica ribbon strips as a clean vector SVG cut sheet.
 */
export function buildElasticaRibbonsSVG(curves, options = {}) {
    const packed = packElasticaRibbons2D(curves, options);
    const scalePx = 300;
    const sheetGapPx = 24;
    const sheetWPx = packed.bedW * scalePx;
    const sheetHPx = packed.bedH * scalePx;

    const groups = [];
    for (let s = 0; s < packed.sheetCount; s++) {
        const sy = s * (sheetHPx + sheetGapPx);
        groups.push(`<rect x="0" y="${sy.toFixed(1)}" width="${sheetWPx.toFixed(1)}" height="${sheetHPx.toFixed(1)}" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 4"/>`);
        groups.push(`<text x="8" y="${(sy + 14).toFixed(1)}" font-family="monospace" font-size="11" fill="#475569">Sheet ${s + 1} (${packed.bedW}m × ${packed.bedH}m)</text>`);
    }

    for (const pl of packed.placements) {
        const sy = pl.sheetIdx * (sheetHPx + sheetGapPx);
        const pathsSvg = pl.rotQuads.map(pts => {
            const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'} ${((pl.ox + p.x) * scalePx).toFixed(2)} ${(sy + (pl.oy + p.y) * scalePx).toFixed(2)}`).join(' ') + ' Z';
            return `<path d="${d}" fill="rgba(56,189,248,0.14)" stroke="#0ea5e9" stroke-width="1"/>`;
        }).join('\n    ');
        groups.push(`<g id="elastica-strip-${pl.curveIdx + 1}">\n    ${pathsSvg}\n  </g>`);
    }

    const totalH = Math.max(120, packed.sheetCount * (sheetHPx + sheetGapPx));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWPx.toFixed(1)}" height="${totalH.toFixed(1)}" viewBox="0 0 ${sheetWPx.toFixed(1)} ${totalH.toFixed(1)}">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  ${groups.join('\n  ')}\n</svg>\n`;
}

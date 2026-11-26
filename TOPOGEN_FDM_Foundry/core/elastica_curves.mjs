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
    const pts3 = vertices.map(v => toV3(v));
    const pairMode = options.pairMode || 'all_pairs';
    const nearestK = Math.max(1, Math.round(options.nearestK || 2));
    const maxCurves = Math.max(1, Math.round(options.maxCurves || 256));

    const customSources = Array.isArray(options.sourceNodes)
        ? options.sourceNodes.filter(i => Number.isInteger(i) && i >= 0 && i < pts3.length)
        : [];
    const customSinks = Array.isArray(options.sinkNodes)
        ? options.sinkNodes.filter(i => Number.isInteger(i) && i >= 0 && i < pts3.length)
        : [];

    if (customSources.length === 0 && customSinks.length === 0 && leaves.length < 2) {
        return { leaves, paths: [] };
    }

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
    if (customSources.length > 0 || customSinks.length > 0) {
        const srcs = customSources.length > 0 ? customSources : leaves;
        const snks = customSinks.length > 0 ? customSinks : leaves;
        for (const s of srcs) {
            for (const t of snks) {
                if (s !== t) pairs.push([s, t]);
            }
        }
    } else if (pairMode === 'top_to_bottom') {
        let minZ = Infinity, maxZ = -Infinity;
        for (const idx of leaves) {
            const z = pts3[idx].z;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }
        const midZ = 0.5 * (minZ + maxZ);
        const sources = leaves.filter(idx => pts3[idx].z >= midZ).sort((a, b) => pts3[b].z - pts3[a].z);
        const sinks = leaves.filter(idx => pts3[idx].z < midZ).sort((a, b) => pts3[a].z - pts3[b].z);
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

    // Round-robin across startNodes so top/extreme sources are never starved by shorter mid-height paths
    const bySource = new Map();
    for (const p of traced) {
        if (!bySource.has(p.startNode)) bySource.set(p.startNode, []);
        bySource.get(p.startNode).push(p);
    }
    for (const list of bySource.values()) {
        list.sort((a, b) => a.pathLength - b.pathLength);
    }

    const selected = [];
    let round = 0;
    while (selected.length < maxCurves) {
        let addedAny = false;
        for (const list of bySource.values()) {
            if (round < list.length) {
                selected.push(list[round]);
                addedAny = true;
                if (selected.length >= maxCurves) break;
            }
        }
        if (!addedAny) break;
        round++;
    }

    return { leaves, paths: selected.map((p, idx) => ({ ...p, id: idx })) };
}

/**
 * 1D Catmull-Clark (Cubic B-Spline) subdivision on an open polyline with pinned endpoints.
 * Each level inserts edge midpoints and smooths interior vertices with [1/8, 6/8, 1/8]
 * (blended by `smoothness` in [0..1]), rounding corners identically to Catmull-Clark.
 */
export function subdivideCatmullClark1D(points, levels = 2, smoothness = 1.0) {
    let pts = points.map(p => toV3(p));
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
export function computeElasticaMetrics(pts, rodRadius = 0.015) {
    if (!pts || pts.length < 3) {
        const len = (pts && pts.length === 2) ? pts[0].distanceTo(pts[1]) : 0;
        return {
            totalLength: len,
            bendingEnergy: 0,
            maxCurvature: 0,
            avgCurvature: 0,
            minBendRadius: Infinity,
            maxBendingStrain: 0,
            stationCurvatures: pts ? new Float64Array(pts.length) : new Float64Array(0)
        };
    }
    let totalLength = 0;
    let bendingEnergy = 0;
    let maxCurvature = 0;
    let curvSum = 0;
    let curvCount = 0;
    const stationCurvatures = new Float64Array(pts.length);

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

        // Discrete Elastic Rod curvature magnitude |kappa * b|_i = 2 |e0 x e1| / (|e0||e1| + e0.e1) / ds
        const cross = new V3().crossVectors(e0, e1).length();
        const denom = l0 * l1 + e0.dot(e1);
        const kappa = denom > 1e-10
            ? (2 * cross / denom) / ds
            : (2 / ds);
        stationCurvatures[i] = kappa;
        bendingEnergy += 0.5 * kappa * kappa * ds;
        if (kappa > maxCurvature) maxCurvature = kappa;
        curvSum += kappa;
        curvCount++;
    }
    stationCurvatures[0] = stationCurvatures[1] || 0;
    stationCurvatures[pts.length - 1] = stationCurvatures[pts.length - 2] || 0;

    return {
        totalLength,
        bendingEnergy,
        maxCurvature,
        avgCurvature: curvCount > 0 ? curvSum / curvCount : 0,
        minBendRadius: maxCurvature > 1e-6 ? (1.0 / maxCurvature) : Infinity,
        maxBendingStrain: maxCurvature * Math.max(0.001, rodRadius),
        stationCurvatures
    };
}

/**
 * Uniformly resample an open polyline by true cumulative arc length so all segments
 * have equal length ds = L_total / (targetCount - 1) without bunching or kinks.
 */
function resampleUniformArcLength(pts, targetCount) {
    const m = pts.length;
    if (m < 2 || targetCount < 2) return pts.map(p => p.clone());
    const cum = new Float64Array(m);
    for (let i = 0; i < m - 1; i++) {
        cum[i + 1] = cum[i] + pts[i].distanceTo(pts[i + 1]);
    }
    const total = cum[m - 1];
    if (total < 1e-8) return pts.map(p => p.clone());

    const out = [pts[0].clone()];
    let seg = 0;
    for (let k = 1; k < targetCount - 1; k++) {
        const sTarget = (total * k) / (targetCount - 1);
        while (seg < m - 2 && cum[seg + 1] < sTarget) seg++;
        const s0 = cum[seg], s1 = cum[seg + 1];
        const t = (s1 - s0) > 1e-9 ? (sTarget - s0) / (s1 - s0) : 0;
        const a = pts[seg], b = pts[seg + 1];
        out.push(new V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t));
    }
    out.push(pts[m - 1].clone());
    return out;
}

/**
 * Optimize a traced skeletal path into an Inextensible Discrete Elastic Rod (DER) curve
 * (Bergou et al. 2008): minimizes discrete bending energy 1/2 sum(kappa_i^2 * ds_i)
 * subject to pinned endpoints, skeletal guidance, and neutral-axis inextensibility
 * so the 3D bent rod has exact 1:1 arc-length parity with its pre-bent straight cut stock.
 */
export function optimizeElasticaCurve(rawPathPoints, solidData = null, options = {}) {
    const pathPoints = rawPathPoints.map(p => toV3(p));
    const smoothMode = options.smoothMode || 'der_inextensible';
    const smoothLevels = options.smoothLevels !== undefined ? Math.round(options.smoothLevels) : 2;
    const samplesPerEdge = Math.max(2, Math.round(options.samplesPerEdge || 8));
    const iterations = Math.max(0, Math.round(options.iterations !== undefined ? options.iterations : 60));
    const bendingWeight = options.bendingWeight !== undefined ? options.bendingWeight : 0.65;
    const tensionWeight = options.tensionWeight !== undefined ? options.tensionWeight : 0.20;
    const guideWeight = options.guideWeight !== undefined ? options.guideWeight : 0.08;
    const maxDeviation = options.maxDeviation !== undefined ? options.maxDeviation : 0.45;
    const rodRadius = Math.max(0.002, options.rodRadius !== undefined ? options.rodRadius : 0.015);
    const enforceInextensible = options.inextensible !== undefined
        ? !!options.inextensible
        : (smoothMode === 'der_inextensible' || smoothMode === 'elastica');

    let pts;
    let refPoints;
    if (smoothMode === 'catmull_clark_1d') {
        pts = subdivideCatmullClark1D(pathPoints, smoothLevels, 1.0);
        refPoints = pts.map(p => p.clone());
    } else if (smoothMode === 'catmull_rom') {
        pts = sampleCatmullRom(pathPoints, samplesPerEdge, bendingWeight);
        refPoints = pts.map(p => p.clone());
    } else {
        // Initialize from mildly corner-rounded skeletal path so DER has clean initial tangents
        const initPts = subdivideCatmullClark1D(pathPoints, Math.max(1, smoothLevels), 0.75);
        const res = resamplePath(pathPoints, samplesPerEdge);
        pts = initPts.length >= 4 ? initPts : res.pts;
        refPoints = pts.map(p => p.clone());
    }

    const n = pts.length;
    if (n < 3) {
        return { points: pts, refPoints, maxDeviation: 0, ...computeElasticaMetrics(pts, rodRadius) };
    }

    // Clamped end-tangent directions & local-plane inward normals (prevents dipping below end tangents)
    const pStart = pathPoints[0];
    const pEnd = pathPoints[pathPoints.length - 1];
    const tStart = new V3().subVectors(pathPoints[1], pStart);
    if (tStart.lengthSq() > 1e-10) tStart.normalize();
    const tEnd = new V3().subVectors(pathPoints[pathPoints.length - 2], pEnd);
    if (tEnd.lengthSq() > 1e-10) tEnd.normalize();

    let nStart = null;
    let nEnd = null;
    if (pathPoints.length >= 3) {
        const toTurnS = new V3().subVectors(pathPoints[2], pStart);
        toTurnS.addScaledVector(tStart, -toTurnS.dot(tStart));
        if (toTurnS.lengthSq() > 1e-10) nStart = toTurnS.normalize();

        const toTurnE = new V3().subVectors(pathPoints[pathPoints.length - 3], pEnd);
        toTurnE.addScaledVector(tEnd, -toTurnE.dot(tEnd));
        if (toTurnE.lengthSq() > 1e-10) nEnd = toTurnE.normalize();
    }

    const enforceLocalPlaneAndTangents = () => {
        // Clamp first & last interior stations onto the skeletal end-tangent rays (C1 socket alignment)
        if (n >= 4) {
            const dS = Math.max(1e-5, pts[1].distanceTo(pts[0]));
            pts[1].copy(pts[0]).addScaledVector(tStart, dS);
            const dE = Math.max(1e-5, pts[n - 2].distanceTo(pts[n - 1]));
            pts[n - 2].copy(pts[n - 1]).addScaledVector(tEnd, dE);
        }
        // Local-plane half-space projection so curve never dips below end tangents
        const midIdx = Math.floor(n * 0.5);
        for (let i = 1; i < n - 1; i++) {
            if (nStart && i <= midIdx) {
                const dotS = (pts[i].x - pStart.x) * nStart.x + (pts[i].y - pStart.y) * nStart.y + (pts[i].z - pStart.z) * nStart.z;
                if (dotS < 0) pts[i].addScaledVector(nStart, -dotS);
            }
            if (nEnd && i >= midIdx) {
                const dotE = (pts[i].x - pEnd.x) * nEnd.x + (pts[i].y - pEnd.y) * nEnd.y + (pts[i].z - pEnd.z) * nEnd.z;
                if (dotE < 0) pts[i].addScaledVector(nEnd, -dotE);
            }
        }
    };

    // Enforce on initial seed as well (covers smoothMode === 'catmull_clark_1d' / 'catmull_rom')
    enforceLocalPlaneAndTangents();

    const stepSize = 0.28;
    const nextPts = pts.map(p => p.clone());

    for (let iter = 0; iter < iterations; iter++) {
        for (let i = 1; i < n - 1; i++) {
            const prev = pts[i - 1];
            const curr = pts[i];
            const next = pts[i + 1];

            // 1. Arc-length equalization term
            const lapX = 0.5 * (prev.x + next.x) - curr.x;
            const lapY = 0.5 * (prev.y + next.y) - curr.y;
            const lapZ = 0.5 * (prev.z + next.z) - curr.z;

            // 2. Discrete Euler-Bernoulli bending gradient (-d/dp sum kappa_i^2 ds_i)
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

            // Clamp max radial deviation from skeletal guide
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
        enforceLocalPlaneAndTangents();
    }

    // Release excess length: resample uniformly along the relaxed, kink-free curve
    // so 3D stations are evenly spaced and 2D straight cut length matches 1:1
    if (iterations > 0) {
        pts = resampleUniformArcLength(pts, n);
        enforceLocalPlaneAndTangents();
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
        ...computeElasticaMetrics(pts, rodRadius)
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
    }

    const arcLengths = new Float64Array(n);
    arcLengths[0] = 0;
    for (let i = 0; i < n - 1; i++) {
        arcLengths[i + 1] = arcLengths[i] + curvePoints[i].distanceTo(curvePoints[i + 1]);
        const ringA = i * nSides;
        const ringB = (i + 1) * nSides;
        for (let k = 0; k < nSides; k++) {
            const kNext = (k + 1) % nSides;
            quads.push([ringA + k, ringA + kNext, ringB + kNext, ringB + k]);
        }
    }

    return { vertices, quads, frames, radius, nSides, centerlinePoints: curvePoints, arcLengths };
}

/**
 * Neutral-axis straight cut-to-length unrolling for an elastic rod (1:1 digital-physical parity):
 * Because an isotropic rod's neutral axis has zero axial strain under pure bending,
 * its pre-bent stock form is a 100% straight bar of exact length L = sum ||p_{m+1} - p_m||
 * with station marks at cumulative arc-lengths s_0 = 0, s_1, ..., s_{n-1} = L.
 */
export function unrollElasticaRibbon2D(rod, stationCurvatures = null) {
    if (!rod || !rod.arcLengths || rod.arcLengths.length < 2) {
        return { quads2D: [], minX: 0, maxX: 1, minY: 0, maxY: 1, totalArea: 0, cutLength: 0 };
    }
    const { arcLengths, radius } = rod;
    const r = Math.max(0.002, radius || 0.015);
    const quads2D = [];

    for (let m = 0; m < arcLengths.length - 1; m++) {
        const s0 = arcLengths[m];
        const s1 = arcLengths[m + 1];
        const kappa = stationCurvatures ? 0.5 * ((stationCurvatures[m] || 0) + (stationCurvatures[m + 1] || 0)) : 0;
        // Winding [BL, BR, TR, TL] with [2]->[3] along the perpendicular station tick at x = s1
        const pts = [
            { x: s0, y: -r },
            { x: s0, y:  r },
            { x: s1, y:  r },
            { x: s1, y: -r }
        ];
        quads2D.push({ pts, s0, s1, kappa });
    }

    const cutLength = arcLengths[arcLengths.length - 1];
    const totalArea = cutLength * (2 * r);
    return {
        quads2D,
        minX: 0,
        maxX: cutLength,
        minY: -r,
        maxY: r,
        totalArea,
        cutLength
    };
}

/**
 * Shelf-pack straight cut-to-length rods onto horizontal cut-list stock sheets.
 */
export function packElasticaRibbons2D(curves, options = {}) {
    const gap = options.gapM !== undefined ? options.gapM : 0.030;
    let maxRodLen = 0;
    const items = [];

    for (let i = 0; i < curves.length; i++) {
        const c = curves[i];
        const u = c.unrolled2D;
        if (!u || !u.quads2D || u.quads2D.length === 0) continue;
        const w = Math.max(0, u.maxX - u.minX);
        const h = Math.max(0.004, u.maxY - u.minY);
        if (w > maxRodLen) maxRodLen = w;
        const rotQuads = u.quads2D.map(q => q.pts.map(p => ({ x: p.x, y: p.y })));
        items.push({
            curveIdx: i,
            curve: c,
            rotQuads,
            minX: u.minX,
            maxX: u.maxX,
            minY: u.minY,
            maxY: u.maxY,
            w,
            h
        });
    }

    // Sort longest cut-to-length stock bars first (standard workshop cut-list order)
    items.sort((a, b) => b.w - a.w);

    const bedW = Math.max(options.bedWidthM || 2.40, maxRodLen + gap * 2);
    const bedH = options.bedHeightM || 1.20;

    const placements = [];
    let sheetIdx = 0;
    let curX = gap, curY = gap, rowH = 0;

    for (const item of items) {
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
            cutLength: item.curve.totalLength,
            minBendRadius: item.curve.minBendRadius,
            startNode: item.curve.startNode,
            endNode: item.curve.endNode,
            rotQuads: item.rotQuads
        });
        curX += item.w + gap;
        if (item.h > rowH) rowH = item.h;
    }

    return { sheetCount: placements.length > 0 ? sheetIdx + 1 : 0, bedW, bedH, placements };
}

/**
 * End-to-end generator: trace A* paths between sources & sinks on the skeletal network,
 * optimize into inextensible Discrete Elastic Rods (DER), build 3D tubular rods,
 * and unroll to straight cut-to-length stock bars with 1:1 digital-physical length parity.
 */
export function generateElasticaRibbons(vertices, edges, solidData = null, options = {}) {
    const { leaves, paths } = traceSkeletalPathsAStar(vertices, edges, options);
    const curves = [];

    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const opt = optimizeElasticaCurve(path.points, solidData, options);
        const rod = buildElasticaRodMesh(opt.points, options);
        const unrolled2D = unrollElasticaRibbon2D(rod, opt.stationCurvatures);
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
            cutLength: unrolled2D.cutLength,
            lengthParityErrorM: Math.abs(opt.totalLength - unrolled2D.cutLength),
            bendingEnergy: opt.bendingEnergy,
            maxCurvature: opt.maxCurvature,
            avgCurvature: opt.avgCurvature,
            minBendRadius: opt.minBendRadius,
            maxBendingStrain: opt.maxBendingStrain,
            maxDeviation: opt.maxDeviation,
            rod,
            unrolled2D
        });
    }

    const packed = packElasticaRibbons2D(curves, options);
    return { leaves, curves, packed };
}

/**
 * Export straight cut-to-length elastica rod schedule & station ticks as a vector SVG cut sheet.
 */
export function buildElasticaRibbonsSVG(curves, options = {}) {
    const packed = packElasticaRibbons2D(curves, options);
    const scalePx = 250;
    const sheetGapPx = 28;
    const sheetWPx = packed.bedW * scalePx;
    const sheetHPx = packed.bedH * scalePx;

    const groups = [];
    for (let s = 0; s < packed.sheetCount; s++) {
        const sy = s * (sheetHPx + sheetGapPx);
        groups.push(`<rect x="0" y="${sy.toFixed(1)}" width="${sheetWPx.toFixed(1)}" height="${sheetHPx.toFixed(1)}" fill="#f8fafc" stroke="#94a3b8" stroke-dasharray="4 4"/>`);
        groups.push(`<text x="8" y="${(sy + 14).toFixed(1)}" font-family="monospace" font-size="11" fill="#475569">Cut-List Sheet ${s + 1} (${packed.bedW.toFixed(2)}m × ${packed.bedH.toFixed(2)}m)</text>`);
    }

    for (const pl of packed.placements) {
        const sy = pl.sheetIdx * (sheetHPx + sheetGapPx);
        const pathsSvg = pl.rotQuads.map(pts => {
            const d = pts.map((p, k) => `${k === 0 ? 'M' : 'L'} ${((pl.ox + p.x) * scalePx).toFixed(2)} ${(sy + (pl.oy + p.y) * scalePx).toFixed(2)}`).join(' ') + ' Z';
            return `<path d="${d}" fill="rgba(56,189,248,0.16)" stroke="#0ea5e9" stroke-width="0.9"/>`;
        }).join('\n    ');
        const labelX = (pl.ox * scalePx + 4).toFixed(1);
        const labelY = (sy + pl.oy * scalePx + 3).toFixed(1);
        const rMinTxt = Number.isFinite(pl.minBendRadius) ? `Rmin=${(pl.minBendRadius * 1000).toFixed(0)}mm` : 'Straight';
        groups.push(`<g id="elastica-rod-${pl.curveIdx + 1}">\n    ${pathsSvg}\n    <text x="${labelX}" y="${labelY}" font-family="monospace" font-size="8.5" fill="#0f172a">#${pl.curveIdx + 1} (${pl.startNode}->${pl.endNode}) Cut=${(pl.cutLength * 1000).toFixed(1)}mm | ${rMinTxt}</text>\n  </g>`);
    }

    const totalH = Math.max(120, packed.sheetCount * (sheetHPx + sheetGapPx));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${sheetWPx.toFixed(1)}" height="${totalH.toFixed(1)}" viewBox="0 0 ${sheetWPx.toFixed(1)} ${totalH.toFixed(1)}">\n  <rect width="100%" height="100%" fill="#ffffff"/>\n  ${groups.join('\n  ')}\n</svg>\n`;
}

/**
 * Assemble a coupled hybrid 3D FEA space-frame combining the primary skeletal network
 * with discretized curved Elastica rod elements, accounting for:
 *   1. Arch / knee-bracing axial + flexural stiffness (EA/L, EI/L^3),
 *   2. Self-equilibrated post-tensioning / compressive tightening preload (prestressForceN),
 *   3. Self-equilibrated active-bending straightening moments M0 = E_rod * I_rod * kappa_0.
 */
export function buildHybridGraphWithElastica(hostVertices, hostEdges, elasticaCurves, options = {}) {
    const includeHostGraph = options.includeHostGraph !== false;
    const rawHostVerts = (hostVertices || []).map(v => {
        const p = toV3(v);
        return [p.x, p.y, p.z];
    });

    if (!includeHostGraph) {
        if (!Array.isArray(elasticaCurves) || elasticaCurves.length === 0) {
            return { vertices: [], edges: [], edgeSpecs: [], nodalSelfStressPairs: [], hostNodeCount: 0, hostEdgeCount: 0, elasticaEdgeCount: 0, coupledRodCount: 0, hostNodeMap: new Map(), recommendedAnchors: [] };
        }
        const maxRods = Math.max(1, Math.round(options.maxRods || elasticaCurves.length));
        const segsPerRod = Math.max(4, Math.round(options.segsPerRod || 12));
        const rodRadiusM = Math.max(0.002, Number(options.rodRadiusM || 0.015));
        const rodMat = options.rodMaterial || {
            youngsModulusPa: 7.5e9,
            shearModulusPa: 3.0e9,
            densityKgM3: 1450,
            tensileStrengthPa: 65.0e6,
            compressiveStrengthPa: 90.0e6
        };
        const prestressForceN = Number(options.prestressForceN || 0);
        const activeBendFactor = Number(options.activeBendFactor !== undefined ? options.activeBendFactor : 1.0);
        const weldTol = options.weldTolM !== undefined ? Math.max(1e-5, Number(options.weldTolM)) : 0.005;
        const weldTolSq = weldTol * weldTol;

        const verts = [];
        const edges = [];
        const edgeSpecs = [];
        const nodalSelfStressPairs = [];
        let coupledRodCount = 0;

        const findOrAddWeldedVert = (pt) => {
            let bestIdx = -1;
            let bestD2 = weldTolSq;
            for (let vi = 0; vi < verts.length; vi++) {
                const vv = verts[vi];
                const dx = vv[0] - pt.x, dy = vv[1] - pt.y, dz = vv[2] - pt.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 <= bestD2) {
                    bestD2 = d2;
                    bestIdx = vi;
                }
            }
            if (bestIdx !== -1) return bestIdx;
            const ni = verts.length;
            verts.push([pt.x, pt.y, pt.z]);
            return ni;
        };

        const curvesToUse = elasticaCurves.slice(0, maxRods);
        for (const c of curvesToUse) {
            if (!c || !c.points || c.points.length < 2) continue;
            const sampled = resampleUniformArcLength(c.points.map(p => toV3(p)), segsPerRod + 1);
            const m = sampled.length;
            if (m < 2) continue;

            const rActual = c.rod && c.rod.radius ? c.rod.radius : rodRadiusM;
            const Irod = 0.25 * Math.PI * Math.pow(rActual, 4);

            const stationKappa = new Float64Array(m);
            let bendEnergy = 0;
            let arcLen = 0;
            for (let i = 0; i < m - 1; i++) arcLen += sampled[i].distanceTo(sampled[i + 1]);
            for (let i = 1; i < m - 1; i++) {
                const e0 = new V3().subVectors(sampled[i], sampled[i - 1]);
                const e1 = new V3().subVectors(sampled[i + 1], sampled[i]);
                const l0 = e0.length(), l1 = e1.length();
                const ds = 0.5 * (l0 + l1);
                const denom = l0 * l1 + e0.dot(e1);
                if (ds > 1e-7 && denom > 1e-10) {
                    const cross = new V3().crossVectors(e0, e1).length();
                    const kap = (2.0 * cross) / (denom * ds);
                    stationKappa[i] = kap;
                    bendEnergy += 0.5 * rodMat.youngsModulusPa * Irod * kap * kap * ds;
                }
            }
            stationKappa[0] = stationKappa[1];
            stationKappa[m - 1] = stationKappa[m - 2];

            const nodeIds = new Int32Array(m);
            for (let i = 0; i < m; i++) {
                nodeIds[i] = findOrAddWeldedVert(sampled[i]);
            }
            if (nodeIds[0] === nodeIds[m - 1]) continue;

            let addedSeg = false;
            for (let i = 0; i < m - 1; i++) {
                const u = nodeIds[i], v = nodeIds[i + 1];
                if (u === v) continue;
                const pu = verts[u], pv = verts[v];
                if (Math.hypot(pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]) < 1e-5) continue;

                const kappaAvg = 0.5 * (stationKappa[i] + stationKappa[i + 1]);
                edges.push([u, v]);
                edgeSpecs.push({
                    isElastica: true,
                    outerRadiusM: rActual,
                    innerRadiusM: 0,
                    youngsModulusPa: rodMat.youngsModulusPa,
                    shearModulusPa: rodMat.shearModulusPa,
                    densityKgM3: rodMat.densityKgM3,
                    tensileStrengthPa: rodMat.tensileStrengthPa,
                    compressiveStrengthPa: rodMat.compressiveStrengthPa,
                    initialBendStressPa: activeBendFactor > 0 ? (activeBendFactor * rodMat.youngsModulusPa * rActual * kappaAvg) : 0
                });
                addedSeg = true;
            }

            if (addedSeg) {
                coupledRodCount++;
                const uEnd = nodeIds[0], vEnd = nodeIds[m - 1];
                const pA = verts[uEnd], pB = verts[vEnd];
                const chordLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]);
                if (chordLen > 1e-5) {
                    const slack = Math.max(0.05 * chordLen, arcLen - chordLen);
                    const eulerChord = (Math.PI * Math.PI * rodMat.youngsModulusPa * Irod) / (chordLen * chordLen);
                    const activeBendThrustN = activeBendFactor > 0
                        ? activeBendFactor * Math.min(0.35 * eulerChord, bendEnergy / Math.max(1e-4, slack))
                        : 0;
                    const netPullN = prestressForceN - activeBendThrustN;
                    if (Math.abs(netPullN) > 1e-6) {
                        nodalSelfStressPairs.push({ u: uEnd, v: vEnd, pullForceN: netPullN });
                    }
                }
            }
        }

        const nVerts = verts.length;
        const parent = Int32Array.from({ length: nVerts }, (_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        for (const [u, v] of edges) {
            const ru = find(u), rv = find(v);
            if (ru !== rv) parent[ru] = rv;
        }
        const hostAnchorPts = (Array.isArray(options.hostAnchors) ? options.hostAnchors : [])
            .filter(ai => ai >= 0 && ai < rawHostVerts.length)
            .map(ai => rawHostVerts[ai]);
        const matchedHostAnchors = new Set();
        for (const hp of hostAnchorPts) {
            for (let vi = 0; vi < nVerts; vi++) {
                const vv = verts[vi];
                const dx = vv[0] - hp[0], dy = vv[1] - hp[1], dz = vv[2] - hp[2];
                if (dx * dx + dy * dy + dz * dz <= 0.02 * 0.02) matchedHostAnchors.add(vi);
            }
        }
        const compNodes = new Map();
        for (let i = 0; i < nVerts; i++) {
            const r = find(i);
            if (!compNodes.has(r)) compNodes.set(r, []);
            compNodes.get(r).push(i);
        }
        const recommendedAnchors = [];
        for (const nodes of compNodes.values()) {
            const existing = nodes.filter(ni => matchedHostAnchors.has(ni));
            if (existing.length >= 3) {
                recommendedAnchors.push(...existing);
                continue;
            }
            let zMin = Infinity, zMax = -Infinity;
            for (const ni of nodes) {
                const z = verts[ni][2];
                if (z < zMin) zMin = z;
                if (z > zMax) zMax = z;
            }
            const tol = Math.max(0.03, 0.03 * (zMax - zMin));
            const sorted = [...nodes].sort((a, b) => verts[a][2] - verts[b][2]);
            const chosen = [...existing];
            for (const ni of sorted) {
                if (chosen.length >= 3 && verts[ni][2] > zMin + tol) break;
                if (!chosen.includes(ni) && (chosen.length === 0 || verts[ni][2] <= zMin + tol || chosen.length < 3)) {
                    chosen.push(ni);
                }
                if (chosen.length >= 6) break;
            }
            recommendedAnchors.push(...chosen);
        }

        return {
            vertices: verts,
            edges,
            edgeSpecs,
            nodalSelfStressPairs,
            hostNodeCount: verts.length,
            hostEdgeCount: 0,
            elasticaEdgeCount: edges.length,
            coupledRodCount,
            hostNodeMap: new Map(),
            recommendedAnchors
        };
    }

    const verts = rawHostVerts;
    const nHostNodes = verts.length;
    const edges = hostEdges.map(e => [e[0], e[1]]);
    const edgeSpecs = edges.map(() => null);

    if (!Array.isArray(elasticaCurves) || elasticaCurves.length === 0) {
        return { vertices: verts, edges, edgeSpecs, hostNodeCount: nHostNodes, hostEdgeCount: edges.length, elasticaEdgeCount: 0, coupledRodCount: 0 };
    }

    const maxRods = Math.max(1, Math.round(options.maxRods || 64));
    const segsPerRod = Math.max(3, Math.round(options.segsPerRod || 8));
    const rodRadiusM = Math.max(0.002, Number(options.rodRadiusM || 0.015));
    const rodMat = options.rodMaterial || {
        youngsModulusPa: 7.5e9,
        shearModulusPa: 3.0e9,
        densityKgM3: 1450,
        tensileStrengthPa: 65.0e6,
        compressiveStrengthPa: 90.0e6
    };
    const prestressForceN = Number(options.prestressForceN || 0);
    const activeBendFactor = Number(options.activeBendFactor !== undefined ? options.activeBendFactor : 1.0);
    const tieTol = options.tieToleranceM !== undefined ? Number(options.tieToleranceM) : 0.035;
    const tieTolSq = tieTol * tieTol;

    let coupledRodCount = 0;
    const nodalSelfStressPairs = [];
    const curvesToUse = elasticaCurves.slice(0, maxRods);

    for (const c of curvesToUse) {
        if (!c || !c.points || c.points.length < 2) continue;
        if (c.startNode < 0 || c.startNode >= nHostNodes || c.endNode < 0 || c.endNode >= nHostNodes) continue;
        if (c.startNode === c.endNode) continue;

        const sampled = resampleUniformArcLength(c.points.map(p => toV3(p)), segsPerRod + 1);
        const m = sampled.length;
        if (m < 2) continue;

        const rActual = c.rod && c.rod.radius ? c.rod.radius : rodRadiusM;
        const Irod = 0.25 * Math.PI * Math.pow(rActual, 4);

        // Compute discrete curvature magnitude kappa_i at stations along the rod
        const stationKappa = new Float64Array(m);
        let bendEnergy = 0;
        let arcLen = 0;
        for (let i = 0; i < m - 1; i++) arcLen += sampled[i].distanceTo(sampled[i + 1]);
        for (let i = 1; i < m - 1; i++) {
            const e0 = new V3().subVectors(sampled[i], sampled[i - 1]);
            const e1 = new V3().subVectors(sampled[i + 1], sampled[i]);
            const l0 = e0.length(), l1 = e1.length();
            const ds = 0.5 * (l0 + l1);
            const denom = l0 * l1 + e0.dot(e1);
            if (ds > 1e-7 && denom > 1e-10) {
                const cross = new V3().crossVectors(e0, e1).length();
                const kap = (2.0 * cross) / (denom * ds);
                stationKappa[i] = kap;
                bendEnergy += 0.5 * rodMat.youngsModulusPa * Irod * kap * kap * ds;
            }
        }
        stationKappa[0] = stationKappa[1];
        stationKappa[m - 1] = stationKappa[m - 2];

        const nodeIds = new Int32Array(m);
        nodeIds[0] = c.startNode;
        nodeIds[m - 1] = c.endNode;

        for (let i = 1; i < m - 1; i++) {
            const pt = sampled[i];
            let tiedHost = -1;
            let bestD2 = tieTolSq;
            for (let hi = 0; hi < nHostNodes; hi++) {
                if (hi === c.startNode || hi === c.endNode) continue;
                const hv = verts[hi];
                const dx = hv[0] - pt.x, dy = hv[1] - pt.y, dz = hv[2] - pt.z;
                const d2 = dx * dx + dy * dy + dz * dz;
                if (d2 <= bestD2) {
                    bestD2 = d2;
                    tiedHost = hi;
                }
            }
            if (tiedHost !== -1) {
                nodeIds[i] = tiedHost;
            } else {
                nodeIds[i] = verts.length;
                verts.push([pt.x, pt.y, pt.z]);
            }
        }

        let addedSeg = false;
        for (let i = 0; i < m - 1; i++) {
            const u = nodeIds[i], v = nodeIds[i + 1];
            if (u === v) continue;
            const pu = verts[u], pv = verts[v];
            if (Math.hypot(pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]) < 1e-5) continue;

            const kappaAvg = 0.5 * (stationKappa[i] + stationKappa[i + 1]);
            edges.push([u, v]);
            edgeSpecs.push({
                isElastica: true,
                outerRadiusM: rActual,
                innerRadiusM: 0,
                youngsModulusPa: rodMat.youngsModulusPa,
                shearModulusPa: rodMat.shearModulusPa,
                densityKgM3: rodMat.densityKgM3,
                tensileStrengthPa: rodMat.tensileStrengthPa,
                compressiveStrengthPa: rodMat.compressiveStrengthPa,
                initialBendStressPa: activeBendFactor > 0 ? (activeBendFactor * rodMat.youngsModulusPa * rActual * kappaAvg) : 0
            });
            addedSeg = true;
        }

        if (addedSeg) {
            coupledRodCount++;
            // Self-equilibrated chord force between (startNode, endNode):
            // +prestressForceN pulls startNode & endNode inward (compressive tightening of host frame);
            // -activeBendThrustN pushes outward from the pre-bent rod's elastica straightening tendency.
            const pA = verts[c.startNode], pB = verts[c.endNode];
            const chordLen = Math.hypot(pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]);
            if (chordLen > 1e-5) {
                const slack = Math.max(0.05 * chordLen, arcLen - chordLen);
                const eulerChord = (Math.PI * Math.PI * rodMat.youngsModulusPa * Irod) / (chordLen * chordLen);
                const activeBendThrustN = activeBendFactor > 0
                    ? activeBendFactor * Math.min(0.35 * eulerChord, bendEnergy / Math.max(1e-4, slack))
                    : 0;
                const netPullN = prestressForceN - activeBendThrustN;
                if (Math.abs(netPullN) > 1e-6) {
                    nodalSelfStressPairs.push({ u: c.startNode, v: c.endNode, pullForceN: netPullN });
                }
            }
        }
    }

    return {
        vertices: verts,
        edges,
        edgeSpecs,
        nodalSelfStressPairs,
        hostNodeCount: nHostNodes,
        hostEdgeCount: hostEdges.length,
        elasticaEdgeCount: edges.length - hostEdges.length,
        coupledRodCount
    };
}

/**
 * WFC-FDM Foundry — Core Module 4: Watertight All-Quad PQ Tubular Mesh Solidifier & OBJ Builder
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 * Also re-exports planarity, face-loop, and subdivision helpers from pq_face_loops.mjs
 * and pq_subdivision.mjs as a unified PQ mesh API.
 *
 * Student Quick-Map:
 *   - Edit node bisector seam stitching & miter clamping -> computeNodeBisectorRings(), solidifyGraphBisectorStitched()
 *   - Edit master graph-to-tubular-mesh pipeline         -> solidifyGraph()
 *   - Edit quad-dominant Wavefront .OBJ serializer       -> buildQuadDominantOBJ()
 *
 * Inputs:  Centerline vertices & edges, tube radius, nSides, longitudinalSubdivLevels, pqOptimization
 * Outputs: Watertight 2-manifold quad mesh { vertices, quads, triangles, verification, planarity } + OBJ text
 */

import { V3, toV3 } from './math_tiles.mjs';
import {
    weldVertices,
    computeQuadPlanarityError,
    isConvexQuad3D,
    computeMeshPlanarityStats,
    computeSignedMeshVolume,
    planarizeQuadMesh,
    mergeTrianglesToQuads,
    verifyManifold,
    computeConvexHull3D,
    LOOP_PALETTE,
    hexToHSL,
    hslToHex,
    computeParentColorShade,
    computeQuadPlanarity,
    walkMeshFaceLoops,
    initSolidFaceLoops,
    optimizeFaceLoopsToPQ
} from './pq_face_loops.mjs';
import {
    applyCatmullClarkToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips,
    applyRingOnlySubdivisionToPQStrips
} from './pq_subdivision.mjs';


function getCanonicalEdgeFrameForNodes(nodes, edge) {
    const v_start = Math.min(edge.u, edge.v);
    const v_end   = Math.max(edge.u, edge.v);
    const diff = new V3().subVectors(nodes[v_end].pt, nodes[v_start].pt);
    const len = diff.length();
    const n_canon = len > 1e-12 ? diff.clone().divideScalar(len) : new V3(0, 0, 1);
    const temp = Math.abs(n_canon.x) > 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
    const e1 = new V3().crossVectors(n_canon, temp).normalize();
    const e2 = new V3().crossVectors(n_canon, e1).normalize();
    return { v_start, v_end, len, n_canon, e1, e2 };
}

// Solve integer seam subdivisions m_s across all paired bisector seams at a multi-branch node
// so EVERY incident bar receives exact circumferential vertex count N_ring (e.g. 8)!
function solveNodeSeamCounts(nBars, seams, targetRingN, nRidges) {
    const S = seams.length;
    const barSeams = Array.from({ length: nBars }, () => []);
    for (let s = 0; s < S; s++) {
        barSeams[seams[s].i].push(s);
        barSeams[seams[s].j].push(s);
    }

    // Order seams so high-constraint bars resolve earliest
    const seamOrder = Array.from({ length: S }, (_, s) => s).sort((a, b) => {
        const dA = Math.min(barSeams[seams[a].i].length, barSeams[seams[a].j].length);
        const dB = Math.min(barSeams[seams[b].i].length, barSeams[seams[b].j].length);
        return (dA - dB) || (seams[a].mu - seams[b].mu);
    });

    const runSearch = (minM) => {
        const rem = new Int32Array(nBars).fill(targetRingN);
        const remDeg = Int32Array.from({ length: nBars }, (_, i) => barSeams[i].length);
        const posSeams = new Int32Array(nBars).fill(0);
        const curM = new Int32Array(S).fill(0);
        let bestM = null;
        let bestCost = Infinity;
        let nodesVisited = 0;

        const ufParent = Int32Array.from({ length: Math.max(1, nRidges) }, (_, i) => i);
        const ufFind = (arr, x) => {
            while (arr[x] !== x) x = arr[x];
            return x;
        };

        const dfs = (idx, costSoFar, ufState) => {
            if (costSoFar >= bestCost || ++nodesVisited > 12000) return;
            if (idx === S) {
                for (let b = 0; b < nBars; b++) {
                    if (rem[b] !== 0 || posSeams[b] < 2) return;
                }
                bestCost = costSoFar;
                bestM = Int32Array.from(curM);
                return;
            }

            const s = seamOrder[idx];
            const bi = seams[s].i, bj = seams[s].j;
            const mu = seams[s].mu;
            const isPointSeam = (seams[s].uRidge === seams[s].vRidge) || (seams[s].maxCap === 0);
            const effMinM = isPointSeam ? 0 : minM;
            const maxSingle = isPointSeam ? 0 : Math.min(seams[s].maxCap !== undefined ? seams[s].maxCap : (targetRingN - 2), Math.max(2, targetRingN - 2));

            let lo = effMinM;
            if (remDeg[bi] === 1) lo = Math.max(lo, rem[bi]);
            if (remDeg[bj] === 1) lo = Math.max(lo, rem[bj]);
            if (minM === 0 && !isPointSeam) {
                if (posSeams[bi] + remDeg[bi] <= 2) lo = Math.max(lo, 1);
                if (posSeams[bj] + remDeg[bj] <= 2) lo = Math.max(lo, 1);
            }

            let hi = Math.min(
                maxSingle,
                rem[bi] - (isPointSeam ? 0 : minM * Math.max(0, remDeg[bi] - 1)),
                rem[bj] - (isPointSeam ? 0 : minM * Math.max(0, remDeg[bj] - 1))
            );
            if (minM > 0) {
                // Still allow remaining seams to include future point-seams with effMinM = 0
                hi = Math.min(maxSingle, rem[bi], rem[bj]);
            }
            if (remDeg[bi] === 1) hi = Math.min(hi, rem[bi]);
            if (remDeg[bj] === 1) hi = Math.min(hi, rem[bj]);
            if (lo > hi) return;

            const cands = [];
            for (let v = lo; v <= hi; v++) cands.push(v);
            cands.sort((a, b) => Math.abs(a - mu) - Math.abs(b - mu));

            remDeg[bi]--;
            remDeg[bj]--;

            for (let ci = 0; ci < cands.length; ci++) {
                const v = cands[ci];
                let nextUf = ufState;
                if (v === 0 && seams[s].uRidge !== seams[s].vRidge) {
                    const ru = ufFind(ufState, seams[s].uRidge);
                    const rv = ufFind(ufState, seams[s].vRidge);
                    if (ru === rv) continue; // prevent cycle of contracted zero-length seams
                    nextUf = Int32Array.from(ufState);
                    nextUf[rv] = ru;
                }
                curM[s] = v;
                rem[bi] -= v;
                rem[bj] -= v;
                if (v > 0) { posSeams[bi]++; posSeams[bj]++; }

                const diff = v - mu;
                const penalty = isPointSeam ? 0.0 : (diff * diff + (v === 0 ? 4.0 : (v === 1 ? 0.35 : 0.0)));
                dfs(idx + 1, costSoFar + penalty, nextUf);

                rem[bi] += v;
                rem[bj] += v;
                if (v > 0) { posSeams[bi]--; posSeams[bj]--; }
            }

            remDeg[bi]++;
            remDeg[bj]++;
        };

        dfs(0, 0, ufParent);
        return bestM;
    };

    // Try >=2 first (ultra-uniform), then >=1, then >=0 (contraction on narrowest sliver seams)
    return runSearch(2) || runSearch(1) || runSearch(0);
}

// Compute consistent, bit-identical 3D seam rings across ALL bars incident to node vv
function computeNodeBisectorRings(nodes, edges, adj, vv, rNode, targetRingN) {
    const V = nodes[vv].pt;
    const inc = adj[vv];
    const outMap = new Map();
    if (!inc || inc.length === 0) return outMap;

    const barInfos = inc.map((eid) => {
        const edge = edges[eid];
        const { v_start, v_end, len, n_canon, e1, e2 } = getCanonicalEdgeFrameForNodes(nodes, edge);
        const isStart = (vv === v_start);
        const u_away = isStart ? n_canon.clone() : n_canon.clone().negate();
        // Right-handed cross-section basis (f1, f2) around u_away: f1 x f2 = u_away
        const f1 = e1.clone();
        const f2 = isStart ? e2.clone() : e2.clone().negate();
        return { eid, edge, isStart, len, n_canon, e1, e2, f1, f2, u_away };
    });

    if (inc.length === 1) {
        const b = barInfos[0];
        outMap.set(b.eid, {
            isLeaf: true,
            V,
            rNode,
            e1: b.e1,
            e2: b.e2,
            n_canon: b.n_canon,
            u_i: b.u_away,
            pts: [],
            angles: [],
            evalMaxVal: () => 0.0
        });
        return outMap;
    }

    // Build bisector plane coefficients for every incident bar in its (f1, f2, u_away) frame
    for (let i = 0; i < barInfos.length; i++) {
        const bi = barInfos[i];
        const planes = [];
        for (let j = 0; j < barInfos.length; j++) {
            if (j === i) continue;
            const bj = barInfos[j];
            const diff = new V3().subVectors(bj.u_away, bi.u_away);
            const n = diff.length() > 1e-6 ? diff.normalize() : bi.u_away.clone().negate();
            const denom = bi.u_away.dot(n);
            if (Math.abs(denom) < 1e-9) continue;
            const A = -bi.f1.dot(n) / denom;
            const B = -bi.f2.dot(n) / denom;
            planes.push({ localJ: j, eid: bj.eid, n, denom, A, B });
        }
        bi.planes = planes;
        bi.evalMaxPsi = (psi) => {
            let bestP = planes[0];
            let bestVal = planes[0].A * Math.cos(psi) + planes[0].B * Math.sin(psi);
            for (let p = 1; p < planes.length; p++) {
                const val = planes[p].A * Math.cos(psi) + planes[p].B * Math.sin(psi);
                if (val > bestVal + 1e-13 || (Math.abs(val - bestVal) <= 1e-13 && planes[p].eid < bestP.eid)) {
                    bestVal = val;
                    bestP = planes[p];
                }
            }
            return { bestP, bestVal };
        };
    }

    const finalizeRingEntry = (bi, ptsCCWAway) => {
        // Convert ring from CCW-around-u_away to CCW-around-n_canon so both ends of every bar match orientation!
        const N = ptsCCWAway.length;
        const ptsCanon = new Array(N);
        if (bi.isStart) {
            for (let k = 0; k < N; k++) ptsCanon[k] = ptsCCWAway[k].clone();
        } else {
            ptsCanon[0] = ptsCCWAway[0].clone();
            for (let k = 1; k < N; k++) ptsCanon[k] = ptsCCWAway[N - k].clone();
        }
        const angles = ptsCanon.map(pt => {
            const rel = new V3().subVectors(pt, V);
            const ang = Math.atan2(rel.dot(bi.e2), rel.dot(bi.e1));
            return ((ang % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        });
        const evalMaxCanon = (angCanon) => {
            const psi = bi.isStart ? angCanon : -angCanon;
            return bi.evalMaxPsi(psi).bestVal;
        };
        outMap.set(bi.eid, {
            isLeaf: false,
            V,
            rNode,
            pts: ptsCanon,
            angles,
            e1: bi.e1,
            e2: bi.e2,
            n_canon: bi.n_canon,
            u_i: bi.u_away,
            evalMaxVal: evalMaxCanon
        });
    };

    // Valence 2: exact single bisector ellipse shared identically by both bars
    if (barInfos.length === 2) {
        const ordered = barInfos[0].eid < barInfos[1].eid ? [barInfos[0], barInfos[1]] : [barInfos[1], barInfos[0]];
        const bA = ordered[0], bB = ordered[1];
        const pA = bA.planes[0];
        const peak = Math.hypot(pA.A, pA.B) > 1e-6 ? Math.atan2(pA.B, pA.A) : 0.0;
        const ptsA = new Array(targetRingN);
        for (let k = 0; k < targetRingN; k++) {
            const psi = peak + (2 * Math.PI * k) / targetRingN;
            const tOverR = pA.A * Math.cos(psi) + pA.B * Math.sin(psi);
            ptsA[k] = V.clone()
                .addScaledVector(bA.f1, rNode * Math.cos(psi))
                .addScaledVector(bA.f2, rNode * Math.sin(psi))
                .addScaledVector(bA.u_away, rNode * tOverR);
        }
        const ptsB = new Array(targetRingN);
        ptsB[0] = ptsA[0].clone();
        for (let k = 1; k < targetRingN; k++) ptsB[k] = ptsA[targetRingN - k].clone();
        finalizeRingEntry(bA, ptsA);
        finalizeRingEntry(bB, ptsB);
        return outMap;
    }

    // Valence >= 3: extract exact cyclic bisector sectors on each bar
    const d = barInfos.length;
    const barSectors = new Array(d);
    const rawRidgePts = [];

    for (let i = 0; i < d; i++) {
        const bi = barInfos[i];
        const planes = bi.planes;
        const evalT = (p, psi) => p.A * Math.cos(psi) + p.B * Math.sin(psi);
        const candAngles = [];

        for (let p1 = 0; p1 < planes.length; p1++) {
            for (let p2 = p1 + 1; p2 < planes.length; p2++) {
                const dA = planes[p1].A - planes[p2].A;
                const dB = planes[p1].B - planes[p2].B;
                if (Math.hypot(dA, dB) < 1e-8) continue;
                const baseAng = Math.atan2(-dA, dB);
                for (let rawAng of [baseAng, baseAng + Math.PI]) {
                    const psi = ((rawAng % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
                    const val = evalT(planes[p1], psi);
                    let isMax = true;
                    for (let p3 = 0; p3 < planes.length; p3++) {
                        if (p3 === p1 || p3 === p2) continue;
                        if (evalT(planes[p3], psi) > val + 1e-5) { isMax = false; break; }
                    }
                    if (isMax) candAngles.push(psi);
                }
            }
        }
        candAngles.sort((a, b) => a - b);

        const dedup = [];
        for (let psi of candAngles) {
            if (dedup.length === 0 || Math.abs(psi - dedup[dedup.length - 1]) > 1.5e-3) {
                if (dedup.length > 0 && Math.abs(psi - (dedup[0] + 2 * Math.PI)) < 1.5e-3) continue;
                dedup.push(psi);
            }
        }

        const ridgeAngles = [];
        for (let k = 0; k < dedup.length; k++) {
            const psi = dedup[k];
            const prevJ = bi.evalMaxPsi(psi - 1e-3).bestP.localJ;
            const nextJ = bi.evalMaxPsi(psi + 1e-3).bestP.localJ;
            if (prevJ !== nextJ) ridgeAngles.push(psi);
        }

        const evalBarPt = (plane, psi) => {
            const tOverR = plane.A * Math.cos(psi) + plane.B * Math.sin(psi);
            return V.clone()
                .addScaledVector(bi.f1, rNode * Math.cos(psi))
                .addScaledVector(bi.f2, rNode * Math.sin(psi))
                .addScaledVector(bi.u_away, rNode * tOverR);
        };

        const sectors = [];
        if (ridgeAngles.length >= 2) {
            for (let k = 0; k < ridgeAngles.length; k++) {
                const psi0 = ridgeAngles[k];
                const psi1 = (k + 1 < ridgeAngles.length) ? ridgeAngles[k + 1] : (ridgeAngles[0] + 2 * Math.PI);
                const psiMid = 0.5 * (psi0 + psi1);
                const activePlane = bi.evalMaxPsi(psiMid).bestP;
                const pt0 = evalBarPt(activePlane, psi0);
                const pt1 = evalBarPt(activePlane, psi1);
                const ptMid = evalBarPt(activePlane, psiMid);
                const rIdx0 = rawRidgePts.length; rawRidgePts.push(pt0);
                const rIdx1 = rawRidgePts.length; rawRidgePts.push(pt1);
                sectors.push({
                    barIdx: i,
                    secIdx: k,
                    nbrIdx: activePlane.localJ,
                    plane: activePlane,
                    psi0,
                    psi1,
                    span: psi1 - psi0,
                    pt0,
                    pt1,
                    ptMid,
                    rawR0: rIdx0,
                    rawR1: rIdx1,
                    evalBarPt: (psi) => evalBarPt(activePlane, psi),
                    seamId: -1,
                    forwardOnSeam: true
                });
            }
        }
        barSectors[i] = sectors;
    }

    // Cluster shared 3D ridge endpoints across all incident bars at node vv
    const nRR = rawRidgePts.length;
    const rParent = Int32Array.from({ length: nRR }, (_, i) => i);
    const rFind = (x) => { while (rParent[x] !== x) { rParent[x] = rParent[rParent[x]]; x = rParent[x]; } return x; };
    const ridgeTol = Math.max(1e-5, rNode * 3e-3);
    for (let a = 0; a < nRR; a++) {
        for (let b = a + 1; b < nRR; b++) {
            if (rawRidgePts[a].distanceTo(rawRidgePts[b]) <= ridgeTol) {
                const ra = rFind(a), rb = rFind(b);
                if (ra !== rb) rParent[rb] = ra;
            }
        }
    }
    const clusterMap = new Int32Array(nRR).fill(-1);
    const ridgeClusters = [];
    for (let a = 0; a < nRR; a++) {
        const r = rFind(a);
        if (clusterMap[r] === -1) {
            clusterMap[r] = ridgeClusters.length;
            ridgeClusters.push({ sum: new V3(), count: 0, pt: new V3() });
        }
        const cid = clusterMap[r];
        ridgeClusters[cid].sum.add(rawRidgePts[a]);
        ridgeClusters[cid].count++;
    }
    for (let c = 0; c < ridgeClusters.length; c++) {
        ridgeClusters[c].pt.copy(ridgeClusters[c].sum).divideScalar(ridgeClusters[c].count);
    }
    for (let i = 0; i < d; i++) {
        for (let sec of barSectors[i]) {
            sec.uRidge = clusterMap[rFind(sec.rawR0)];
            sec.vRidge = clusterMap[rFind(sec.rawR1)];
        }
    }

    // Pair reciprocal half-seams (i -> j) with (j -> i)
    const seams = [];
    let allPaired = true;
    const minStepLen = Math.max(5e-5, rNode * 0.015);
    for (let i = 0; i < d; i++) {
        if (barSectors[i].length < 2) { allPaired = false; break; }
        for (let sec of barSectors[i]) {
            if (sec.seamId !== -1) continue;
            const j = sec.nbrIdx;
            let bestPartner = null, bestDist = Infinity;
            for (let cand of barSectors[j]) {
                if (cand.seamId !== -1 || cand.nbrIdx !== i) continue;
                const dist = sec.ptMid.distanceTo(cand.ptMid);
                if (dist < bestDist) { bestDist = dist; bestPartner = cand; }
            }
            if (!bestPartner) { allPaired = false; break; }
            const sId = seams.length;
            const canonFirst = barInfos[i].eid < barInfos[j].eid;
            const secCanon = canonFirst ? sec : bestPartner;
            const secOther = canonFirst ? bestPartner : sec;
            secCanon.seamId = sId; secCanon.forwardOnSeam = true;
            secOther.seamId = sId; secOther.forwardOnSeam = false;
            const chordLen = ridgeClusters[secCanon.uRidge].pt.distanceTo(ridgeClusters[secCanon.vRidge].pt);
            const maxCap = (secCanon.uRidge === secCanon.vRidge || chordLen < minStepLen)
                ? 0
                : Math.max(1, Math.min(targetRingN - 2, Math.floor(chordLen / minStepLen)));
            seams.push({
                id: sId,
                i: secCanon.barIdx,
                j: secOther.barIdx,
                secCanon,
                secOther,
                uRidge: secCanon.uRidge,
                vRidge: secCanon.vRidge,
                chordLen,
                maxCap,
                mu: 0.5 * ((secCanon.span + secOther.span) / (2 * Math.PI)) * targetRingN
            });
        }
    }

    let seamCounts = null;
    if (allPaired && seams.length > 0) {
        seamCounts = solveNodeSeamCounts(d, seams, targetRingN, ridgeClusters.length);
    }

    // Fallback to even sector counts (2 or 4 per seam) if exact targetRingN wasn't solvable on an extreme valence node
    if (!seamCounts && allPaired && seams.length > 0) {
        let maxSec = 2;
        for (let i = 0; i < d; i++) if (barSectors[i].length > maxSec) maxSec = barSectors[i].length;
        const evenSub = maxSec >= 3 ? 2 : Math.max(2, 2 * Math.round(targetRingN / 4));
        seamCounts = new Int32Array(seams.length).fill(evenSub);
    }

    if (seamCounts) {
        // Merge any ridge vertex pairs contracted by m_s === 0 so all incident bars share the exact merged ridge point
        const cN = ridgeClusters.length;
        const mParent = Int32Array.from({ length: cN }, (_, i) => i);
        const mFind = (x) => { while (mParent[x] !== x) x = mParent[x]; return x; };
        for (let s = 0; s < seams.length; s++) {
            if (seamCounts[s] === 0) {
                const ru = mFind(seams[s].uRidge), rv = mFind(seams[s].vRidge);
                if (ru !== rv) mParent[rv] = ru;
            }
        }
        const mergedRidgePts = new Array(cN);
        for (let r = 0; r < cN; r++) {
            if (mFind(r) !== r) continue;
            const sum = new V3();
            let cnt = 0;
            for (let k = 0; k < cN; k++) {
                if (mFind(k) === r) { sum.add(ridgeClusters[k].pt); cnt++; }
            }
            mergedRidgePts[r] = sum.divideScalar(Math.max(1, cnt));
        }
        const getRidgePt = (cid) => mergedRidgePts[mFind(cid)];

        // Precompute shared 3D point array [0 .. m_s] along every active seam
        const seamPointArrays = new Array(seams.length).fill(null);
        for (let s = 0; s < seams.length; s++) {
            const m = seamCounts[s];
            if (m <= 0) continue;
            const sc = seams[s].secCanon;
            const arr = new Array(m + 1);
            arr[0] = getRidgePt(seams[s].uRidge).clone();
            arr[m] = getRidgePt(seams[s].vRidge).clone();
            for (let t = 1; t < m; t++) {
                const psi = sc.psi0 + (t / m) * (sc.psi1 - sc.psi0);
                arr[t] = sc.evalBarPt(psi);
            }
            seamPointArrays[s] = arr;
        }

        for (let i = 0; i < d; i++) {
            const ptsAway = [];
            for (let sec of barSectors[i]) {
                const m = seamCounts[sec.seamId];
                if (m <= 0) continue;
                const arr = seamPointArrays[sec.seamId];
                if (sec.forwardOnSeam) {
                    for (let t = 0; t < m; t++) ptsAway.push(arr[t]);
                } else {
                    for (let t = m; t > 0; t--) ptsAway.push(arr[t]);
                }
            }
            finalizeRingEntry(barInfos[i], ptsAway);
        }
        return outMap;
    }

    // Ultimate uniform fallback
    for (let i = 0; i < d; i++) {
        const bi = barInfos[i];
        const ptsAway = [];
        for (let k = 0; k < targetRingN; k++) {
            const psi = (2 * Math.PI * k) / targetRingN;
            const tOverR = bi.evalMaxPsi(psi).bestVal;
            ptsAway.push(
                V.clone()
                    .addScaledVector(bi.f1, rNode * Math.cos(psi))
                    .addScaledVector(bi.f2, rNode * Math.sin(psi))
                    .addScaledVector(bi.u_away, rNode * tOverR)
            );
        }
        finalizeRingEntry(bi, ptsAway);
    }
    return outMap;
}

// Kept exported for backward compatibility
function computeEndRingBisectorStitched(nodes, edges, adj, vv, eid, wid, targetSides) {
    const targetEven = Math.max(4, Math.round(targetSides || 8) + (Math.round(targetSides || 8) % 2));
    const map = computeNodeBisectorRings(nodes, edges, adj, vv, wid, targetEven);
    return map.get(eid) || { isLeaf: true, V: nodes[vv].pt, pts: [], angles: [], evalMaxVal: () => 0.0 };
}

function finalizeSolidMesh(rawVertices, quads, triangles, fixedRawIndices, options = {}) {
    const wid = Math.max(1e-4, Number(options.wid || 0.015));
    const weldEps = options.weldEps !== undefined ? Number(options.weldEps) : Math.min(2e-5, Math.max(1e-7, wid * 2e-3));
    const quadIsCapIn = options.quadIsCap || null;
    const barQuadGridsIn = options.barQuadGrids || null;

    const welded = weldVertices(rawVertices, weldEps);
    const map = welded.map;
    const uniqueVertices = welded.vertices;

    const finalQuads = [];
    const finalQuadIsCap = [];
    const finalTriangles = [];
    const oldToNewQuad = new Int32Array(quads.length).fill(-1);

    for (let qi = 0; qi < quads.length; qi++) {
        const q = quads[qi];
        const a = map[q[0]], b = map[q[1]], c = map[q[2]], d = map[q[3]];
        const distinct = new Set([a, b, c, d]);
        if (distinct.size === 4) {
            oldToNewQuad[qi] = finalQuads.length;
            finalQuads.push([a, b, c, d]);
            finalQuadIsCap.push(quadIsCapIn ? (quadIsCapIn[qi] ? 1 : 0) : 0);
        } else if (distinct.size === 3) {
            if (a === b) finalTriangles.push([a, c, d]);
            else if (b === c) finalTriangles.push([a, b, d]);
            else if (c === d) finalTriangles.push([a, b, c]);
            else if (d === a) finalTriangles.push([a, b, c]);
        }
    }
    for (let t of triangles) {
        const a = map[t[0]], b = map[t[1]], c = map[t[2]];
        if (a === b || b === c || c === a) continue;
        finalTriangles.push([a, b, c]);
    }

    let barQuadGrids = null;
    if (barQuadGridsIn) {
        barQuadGrids = barQuadGridsIn.map(grid => {
            if (!grid) return null;
            return grid.map(row => row.map(qi => oldToNewQuad[qi]).filter(ni => ni >= 0));
        });
    }

    const r6 = (v) => Math.round(v * 1e6) / 1e6;
    for (let i = 0; i < uniqueVertices.length; i++) {
        uniqueVertices[i].x = r6(uniqueVertices[i].x);
        uniqueVertices[i].y = r6(uniqueVertices[i].y);
        uniqueVertices[i].z = r6(uniqueVertices[i].z);
    }

    let signedVolume = computeSignedMeshVolume(uniqueVertices, finalQuads, finalTriangles);
    const verificationTriangles = [];
    for (let q of finalQuads) verificationTriangles.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    for (let t of finalTriangles) verificationTriangles.push(t[0], t[1], t[2]);
    const verification = verifyManifold(uniqueVertices, verificationTriangles);

    if (verification.isWatertight && signedVolume < -1e-12) {
        for (let i = 0; i < finalQuads.length; i++) {
            const q = finalQuads[i];
            // Reverse [q0, q1, q2, q3] -> [q1, q0, q3, q2] so sides 0/2 remain circumferential and 1/3 remain longitudinal!
            finalQuads[i] = [q[1], q[0], q[3], q[2]];
        }
        for (let i = 0; i < finalTriangles.length; i++) finalTriangles[i].reverse();
        signedVolume = -signedVolume;
    }

    let barTubeQuadCount = 0;
    for (let i = 0; i < finalQuadIsCap.length; i++) if (!finalQuadIsCap[i]) barTubeQuadCount++;

    const planarity = computeMeshPlanarityStats(uniqueVertices, finalQuads);
    return {
        vertices: uniqueVertices,
        quads: finalQuads,
        triangles: finalTriangles,
        quadIsCap: Uint8Array.from(finalQuadIsCap),
        barQuadGrids,
        verification,
        planarity,
        barTubeQuadCount,
        signedVolume
    };
}

function appendPureQuadLeafCap(addVert, quads, quadIsCap, centerPt, ringIdx, isStartEnd) {
    const N = ringIdx.length;
    if (N < 4) return;
    if (N === 4) {
        if (isStartEnd) quads.push([ringIdx[3], ringIdx[2], ringIdx[1], ringIdx[0]]);
        else quads.push([ringIdx[0], ringIdx[1], ringIdx[2], ringIdx[3]]);
        quadIsCap.push(1);
        return;
    }
    // Even N >= 6: cap around center vertex using N / 2 strictly planar quads (0 triangles!)
    const c = addVert(centerPt);
    const half = Math.floor(N / 2);
    for (let k = 0; k < half; k++) {
        const i0 = ringIdx[(2 * k) % N];
        const i1 = ringIdx[(2 * k + 1) % N];
        const i2 = ringIdx[(2 * k + 2) % N];
        if (isStartEnd) {
            quads.push([c, i2, i1, i0]);
        } else {
            quads.push([c, i0, i1, i2]);
        }
        quadIsCap.push(1);
    }
}

function solidifyGraphBisectorStitched(nSides, wid, nodes, edges, activeEdges, adj, options = {}) {
    const capLeafEnds = options.capLeafEnds !== undefined ? !!options.capLeafEnds : true;
    const miterClamp = options.miterClamp !== false;
    const subdivLevels = Math.max(0, Math.round(options.longitudinalSubdivLevels || 0));
    const applyPQ = !!options.pqOptimization;
    const pqIterations = options.pqIterations !== undefined ? Number(options.pqIterations) : 80;
    const pqCoupling = options.pqCoupling !== undefined ? Number(options.pqCoupling) : 0.65;
    const maxQuadPlanarityErrorM = options.maxQuadPlanarityErrorM !== undefined ? Number(options.maxQuadPlanarityErrorM) : 0.0005;
    const targetRingN = Math.max(4, Math.round(nSides) + (Math.round(nSides) % 2));

    // 1. Compute safe nodal cylinder radius rNode <= wid at each junction so sharp/short bars never miter-overlap (optional via miterClamp)
    const nodeRadius = new Float64Array(nodes.length).fill(wid);
    if (miterClamp) {
        for (let vv = 0; vv < nodes.length; vv++) {
            const inc = adj[vv];
            if (!inc || inc.length < 2) continue;
            let rAllowed = wid;
            const V = nodes[vv].pt;
            const dirs = inc.map(eid => {
                const e = edges[eid];
                const other = (e.u === vv) ? e.v : e.u;
                const vec = new V3().subVectors(nodes[other].pt, V);
                const len = vec.length();
                return { eid, len, dir: len > 1e-12 ? vec.divideScalar(len) : new V3(0, 0, 1) };
            });
            for (let i = 0; i < dirs.length; i++) {
                let maxTanCot = 0;
                for (let j = 0; j < dirs.length; j++) {
                    if (i === j) continue;
                    const cosTh = Math.max(-0.9999, Math.min(0.9999, dirs[i].dir.dot(dirs[j].dir)));
                    // Peak axial projection along cylinder i from bisector plane with j is r * tan((pi - theta)/2) = r * sqrt((1 + cosTh)/(1 - cosTh))
                    const tOverR = Math.sqrt(Math.max(0, (1 + cosTh) / Math.max(1e-6, 1 - cosTh)));
                    if (tOverR > maxTanCot) maxTanCot = tOverR;
                }
                if (maxTanCot > 1e-6) {
                    const lim = (0.40 * dirs[i].len) / maxTanCot;
                    if (lim < rAllowed) rAllowed = lim;
                }
            }
            nodeRadius[vv] = Math.max(1e-4, rAllowed);
        }
    }

    // 2. Compute unified node-level bisector rings across all nodes
    const nodeRingMaps = new Array(nodes.length);
    for (let vv = 0; vv < nodes.length; vv++) {
        nodeRingMaps[vv] = computeNodeBisectorRings(nodes, edges, adj, vv, nodeRadius[vv], targetRingN);
    }

    const rawVertices = [];
    const quads = [];
    const quadIsCap = [];
    const triangles = [];
    const barStripSpecs = new Array(edges.length).fill(null);
    const barQuadGrids = new Array(edges.length).fill(null);
    const leafEndSpecs = [];
    const barMidRingSpecs = [];
    const addVert = (p) => { rawVertices.push(p.clone()); return rawVertices.length - 1; };
    const angleDiff = (a, b) => {
        let d = Math.abs(a - b) % (2 * Math.PI);
        return d > Math.PI ? 2 * Math.PI - d : d;
    };

    // 3. Emit Level-0 pure-quad tube trunks (N1 === N2 === targetRingN) + pure-quad leaf end-caps
    for (let edge of activeEdges) {
        const eIdx = edge.id;
        const v1 = Math.min(edge.u, edge.v);
        const v2 = Math.max(edge.u, edge.v);
        const V1 = nodes[v1].pt, V2 = nodes[v2].pt;
        const len = V1.distanceTo(V2);
        if (len < 1e-5) continue;

        const ring1 = nodeRingMaps[v1].get(eIdx);
        const ring2 = nodeRingMaps[v2].get(eIdx);
        if (!ring1 || !ring2) continue;

        const r1 = nodeRadius[v1], r2 = nodeRadius[v2];
        if (ring1.isLeaf && !ring2.isLeaf) {
            ring1.angles = [...ring2.angles];
            ring1.pts = ring1.angles.map(ang =>
                V1.clone().addScaledVector(ring1.e1, r1 * Math.cos(ang)).addScaledVector(ring1.e2, r1 * Math.sin(ang))
            );
        } else if (ring2.isLeaf && !ring1.isLeaf) {
            ring2.angles = [...ring1.angles];
            ring2.pts = ring2.angles.map(ang =>
                V2.clone().addScaledVector(ring2.e1, r2 * Math.cos(ang)).addScaledVector(ring2.e2, r2 * Math.sin(ang))
            );
        } else if (ring1.isLeaf && ring2.isLeaf) {
            ring1.angles = []; ring2.angles = []; ring1.pts = []; ring2.pts = [];
            for (let k = 0; k < targetRingN; k++) {
                const ang = (2 * Math.PI * k) / targetRingN;
                ring1.angles.push(ang); ring2.angles.push(ang);
                ring1.pts.push(V1.clone().addScaledVector(ring1.e1, r1 * Math.cos(ang)).addScaledVector(ring1.e2, r1 * Math.sin(ang)));
                ring2.pts.push(V2.clone().addScaledVector(ring2.e1, r2 * Math.cos(ang)).addScaledVector(ring2.e2, r2 * Math.sin(ang)));
            }
        }

        const N1 = ring1.pts.length;
        const N2 = ring2.pts.length;
        if (N1 === 0 || N2 === 0) continue;

        // Choose cyclic shift bestS minimizing global angular twist across the whole ring
        let bestS = 0, minCost = Infinity;
        const checkCount = Math.min(N1, N2);
        for (let s = 0; s < N2; s++) {
            let cost = 0;
            for (let k = 0; k < checkCount; k++) {
                const k1 = Math.floor((k * N1) / checkCount);
                const k2 = (Math.floor((k * N2) / checkCount) + s) % N2;
                const d = angleDiff(ring1.angles[k1], ring2.angles[k2]);
                cost += d * d;
            }
            if (cost < minCost) { minCost = cost; bestS = s; }
        }

        const idx1 = ring1.pts.map(p => addVert(p));
        const idx2 = new Array(N2);
        const pts2Aligned = new Array(N2);
        for (let k = 0; k < N2; k++) {
            const p2 = ring2.pts[(k + bestS) % N2];
            pts2Aligned[k] = p2;
            idx2[k] = addVert(p2);
        }

        if (N1 === N2) {
            const rowQuads = [];
            const zStart = new Array(N1);
            const zEnd = new Array(N1);
            for (let k = 0; k < N1; k++) {
                const k1 = (k + 1) % N1;
                rowQuads.push(quads.length);
                quads.push([idx1[k], idx1[k1], idx2[k1], idx2[k]]);
                quadIsCap.push(0);
                zStart[k] = new V3().subVectors(ring1.pts[k], V1).dot(ring1.n_canon);
                zEnd[k] = new V3().subVectors(pts2Aligned[k], V1).dot(ring1.n_canon);
            }
            barQuadGrids[eIdx] = [rowQuads];
            const specBands = 1 << Math.min(8, subdivLevels);
            const specZRings = Array.from({ length: specBands + 1 }, (_, m) => {
                const t = m / specBands;
                return zStart.map((zs, k) => (1 - t) * zs + t * Math.max(zs + 2e-3, zEnd[k]));
            });
            barStripSpecs[eIdx] = {
                type: 'cylinder_parallel',
                edgeIndex: eIdx,
                endpoints: [edge.u, edge.v],
                centerlineLengthM: len,
                subdivLevels: specBands - 1,
                nSides: N1,
                radius: 0.5 * (r1 + r2),
                angles: [...ring1.angles],
                zRings: specZRings
            };
        } else {
            // Even-ring pure-quad step collar backup (for ultra-high-valence nodes where N1 != N2, both even)
            let curIdx = idx1;
            let curPts = ring1.pts;
            const stepToRing = (fromIdx, toIdx, fromIsLarger) => {
                // Reduce by 2 vertices per collar step using exact manifold 4-vertex reduction quad [a0, a1, a2, b0]
                const big = fromIsLarger ? fromIdx : toIdx;
                const sml = fromIsLarger ? toIdx : fromIdx;
                const M = sml.length; // big.length === M + 2
                if (fromIsLarger) {
                    quads.push([big[0], big[1], big[2], sml[0]]);
                    quadIsCap.push(1);
                    for (let m = 0; m < M; m++) {
                        const bA = big[(m + 2) % (M + 2)];
                        const bB = big[(m + 3) % (M + 2)];
                        const sA = sml[m];
                        const sB = sml[(m + 1) % M];
                        quads.push([bA, bB, sB, sA]);
                        quadIsCap.push(1);
                    }
                } else {
                    quads.push([sml[0], big[2], big[1], big[0]]);
                    quadIsCap.push(1);
                    for (let m = 0; m < M; m++) {
                        const bA = big[(m + 2) % (M + 2)];
                        const bB = big[(m + 3) % (M + 2)];
                        const sA = sml[m];
                        const sB = sml[(m + 1) % M];
                        quads.push([sA, sB, bB, bA]);
                        quadIsCap.push(1);
                    }
                }
            };

            const diffSteps = Math.abs(N1 - N2) / 2;
            for (let st = 1; st <= diffSteps; st++) {
                const nextN = N1 > N2 ? (N1 - 2 * st) : (N1 + 2 * st);
                const t = (0.18 * st) / diffSteps;
                const midPts = [];
                for (let k = 0; k < nextN; k++) {
                    const ang = (2 * Math.PI * k) / nextN;
                    const zMid = (1 - t) * 0.12 * len + t * 0.25 * len;
                    midPts.push(V1.clone()
                        .addScaledVector(ring1.e1, wid * Math.cos(ang))
                        .addScaledVector(ring1.e2, wid * Math.sin(ang))
                        .addScaledVector(ring1.n_canon, zMid));
                }
                const midIdx = midPts.map(p => addVert(p));
                stepToRing(curIdx, midIdx, N1 > N2);
                curIdx = midIdx;
                curPts = midPts;
            }
            const rowQuads = [];
            for (let k = 0; k < N2; k++) {
                const k1 = (k + 1) % N2;
                rowQuads.push(quads.length);
                quads.push([curIdx[k], curIdx[k1], idx2[k1], idx2[k]]);
                quadIsCap.push(0);
            }
            barQuadGrids[eIdx] = [rowQuads];
        }

        const barDir = new V3().subVectors(V2, V1).divideScalar(Math.max(len, 1e-9));
        barMidRingSpecs.push({
            midPt: V1.clone().add(V2).multiplyScalar(0.5),
            e1: ring1.e1.clone(),
            e2: ring1.e2.clone(),
            outerRadiusLocal: 0.5 * (r1 + r2),
            nSides: N1
        });
        if (ring1.isLeaf) {
            leafEndSpecs.push({
                center: V1.clone(),
                e1: ring1.e1.clone(),
                e2: ring1.e2.clone(),
                inwardDir: barDir.clone(),
                angles: [...ring1.angles],
                outerRadiusLocal: r1,
                barLength: len
            });
        }
        if (ring2.isLeaf) {
            const alignedAng2 = [];
            for (let k = 0; k < N2; k++) alignedAng2.push(ring2.angles[(k + bestS) % N2]);
            leafEndSpecs.push({
                center: V2.clone(),
                e1: ring2.e1.clone(),
                e2: ring2.e2.clone(),
                inwardDir: barDir.clone().negate(),
                angles: alignedAng2,
                outerRadiusLocal: r2,
                barLength: len
            });
        }

        if (capLeafEnds && ring1.isLeaf) {
            appendPureQuadLeafCap(addVert, quads, quadIsCap, V1, idx1, true);
        }
        if (capLeafEnds && ring2.isLeaf) {
            appendPureQuadLeafCap(addVert, quads, quadIsCap, V2, idx2, false);
        }
    }

    const finalized = finalizeSolidMesh(rawVertices, quads, triangles, null, {
        wid,
        weldEps: Math.min(2e-5, Math.max(1e-7, wid * 2e-3)),
        quadIsCap,
        barQuadGrids
    });

    let minNodeR = wid, maxNodeR = 0;
    for (let vv = 0; vv < nodeRadius.length; vv++) {
        if (nodeRadius[vv] < minNodeR) minNodeR = nodeRadius[vv];
        if (nodeRadius[vv] > maxNodeR) maxNodeR = nodeRadius[vv];
    }
    finalized.hasMiterOverlap = false;
    finalized.miterClampApplied = miterClamp;
    finalized.minNodeRadiusM = nodeRadius.length > 0 ? minNodeR : wid;
    finalized.maxNodeRadiusM = nodeRadius.length > 0 ? maxNodeR : wid;
    finalized.leafEndSpecs = leafEndSpecs;
    finalized.barMidRingSpecs = barMidRingSpecs;
    finalized.barStripSpecs = barStripSpecs;
    finalized.longitudinalSubdivLevels = 0;
    finalized.ccLevel = 0;
    finalized.pqOptimizationApplied = false;

    // Initialize Level-0 face-loop topology & parent colors
    initSolidFaceLoops(finalized, options.directionMode || 'longitudinal');

    // Apply requested longitudinal B-spline subdivision levels
    if (subdivLevels >= 1) {
        applyLongitudinalOnlySubdivisionToPQStrips(finalized, subdivLevels, false, {
            boundaryMode: options.boundaryMode || 'smooth_all'
        });
    }

    // Apply Negotiated Face-Loop PQ Optimization (0 triangles, maxQuadPlanarityErrorM <= 0.0005 m)
    if (applyPQ) {
        optimizeFaceLoopsToPQ(finalized, pqIterations, pqCoupling, {
            targetErrorM: Math.min(1e-6, maxQuadPlanarityErrorM * 0.02),
            maxQuadPlanarityErrorM
        });
    }

    return finalized;
}

function solidifyGraph(graphVertices, graphEdges, options = {}) {
    const rawSides = Math.max(4, Math.round(options.nSides || 8));
    const nSides = rawSides + (rawSides % 2); // even ring count for 100% pure-quad topology
    const wid = Math.max(1e-4, Number(options.radius !== undefined ? options.radius : 0.035));
    const endOffset = Math.max(1e-3, Number(options.endOffset !== undefined ? options.endOffset : wid * 2.2));
    const stitchAtBisectors = options.stitchAtBisectors !== undefined ? !!options.stitchAtBisectors : true;
    const capLeafEnds = options.capLeafEnds !== undefined ? !!options.capLeafEnds : true;
    const miterClamp = options.miterClamp !== false;
    const subdivLevels = Math.max(0, Math.round(options.longitudinalSubdivLevels || 0));
    const applyPQ = !!options.pqOptimization;
    const pqIterations = options.pqIterations !== undefined ? Number(options.pqIterations) : 80;
    const pqCoupling = options.pqCoupling !== undefined ? Number(options.pqCoupling) : 0.65;
    const maxQuadPlanarityErrorM = options.maxQuadPlanarityErrorM !== undefined ? Number(options.maxQuadPlanarityErrorM) : 0.0005;

    const nodes = graphVertices.map((p, id) => ({ id, pt: toV3(p), valence: 0, minSinHalfAngle: 1.0 }));
    const seenEdgeSet = new Set();
    const edges = [];
    for (let id = 0; id < graphEdges.length; id++) {
        const u = graphEdges[id][0], v = graphEdges[id][1];
        if (u === v || u < 0 || v < 0 || u >= nodes.length || v >= nodes.length) {
            edges.push({ id, u: 0, v: 0, active: false });
            continue;
        }
        const a = Math.min(u, v), b = Math.max(u, v);
        const key = `${a}_${b}`;
        const len = nodes[a].pt.distanceTo(nodes[b].pt);
        if (seenEdgeSet.has(key) || len < 1e-5) {
            edges.push({ id, u, v, active: false });
            continue;
        }
        seenEdgeSet.add(key);
        edges.push({ id, u, v, active: true });
    }
    const activeEdges = edges.filter(e => e.active);
    const adj = nodes.map(() => []);
    for (let e of activeEdges) {
        adj[e.u].push(e.id);
        adj[e.v].push(e.id);
    }

    const vertexMinSin = [];
    for (let vv = 0; vv < nodes.length; vv++) {
        const inc = adj[vv];
        nodes[vv].valence = inc.length;
        if (inc.length < 2) { vertexMinSin[vv] = 1.0; continue; }
        let minSin = 1.0;
        const dirs = inc.map(edgeId => {
            const edge = edges[edgeId];
            const other = (edge.u === vv) ? edge.v : edge.u;
            return new V3().subVectors(nodes[other].pt, nodes[vv].pt).normalize();
        });
        for (let i = 0; i < dirs.length; i++) {
            for (let j = i + 1; j < dirs.length; j++) {
                const cosTheta = Math.max(-1, Math.min(1, dirs[i].dot(dirs[j])));
                const sinHalf = Math.sin(Math.acos(cosTheta) / 2);
                if (sinHalf < minSin) minSin = sinHalf;
            }
        }
        vertexMinSin[vv] = Math.max(0.005, minSin);
        nodes[vv].minSinHalfAngle = vertexMinSin[vv];
    }

    if (stitchAtBisectors) {
        const bisected = solidifyGraphBisectorStitched(nSides, wid, nodes, edges, activeEdges, adj, {
            capLeafEnds,
            miterClamp,
            longitudinalSubdivLevels: subdivLevels,
            pqOptimization: applyPQ,
            pqIterations,
            pqCoupling,
            maxQuadPlanarityErrorM,
            directionMode: options.directionMode || 'longitudinal'
        });
        if (bisected.triangles && bisected.triangles.length > 0) {
            applyCatmullClarkToPQStrips(bisected, 1, applyPQ, { pqIterations, pqCoupling, maxQuadPlanarityErrorM });
        }
        if (bisected.verification && bisected.verification.isWatertight && bisected.triangles.length === 0) {
            return bisected;
        }
        const hullFallback = solidifyGraph(graphVertices, graphEdges, Object.assign({}, options, { stitchAtBisectors: false }));
        if (hullFallback.verification && hullFallback.verification.isWatertight) {
            return hullFallback;
        }
        return bisected;
    }

    // Convex-hull joint mode -> quadrangulated via 1 Catmull-Clark pass so 0 triangles remain!
    const rawVertices = [];
    const jointTriangles = [];
    const quads = [];
    const quadIsCap = [];
    const triangles = [];
    const barStripSpecs = new Array(edges.length).fill(null);
    const barQuadGrids = new Array(edges.length).fill(null);
    const addVert = (p) => { rawVertices.push(p.clone()); return rawVertices.length - 1; };

    const nodeSphereR = new Float64Array(nodes.length);
    for (let vv = 0; vv < nodes.length; vv++) {
        const inc = adj[vv];
        if (inc.length < 2) { nodeSphereR[vv] = 0; continue; }
        let minLim = endOffset;
        for (let edgeId of inc) {
            const e = edges[edgeId];
            const len = nodes[e.u].pt.distanceTo(nodes[e.v].pt);
            const lim = len * 0.38;
            if (lim < minLim) minLim = lim;
        }
        const idealR = Math.max(Math.hypot(endOffset, wid), wid / Math.max(0.18, 0.88 * vertexMinSin[vv]));
        nodeSphereR[vv] = Math.max(1e-3, Math.min(idealR, minLim));
    }

    const getLocalParams = (vv) => {
        const R_sph = nodeSphereR[vv];
        const maxR = R_sph * Math.min(0.88, vertexMinSin[vv] * 0.88);
        const r = Math.max(1e-4, Math.min(wid, maxR));
        const d = Math.sqrt(Math.max(1e-8, R_sph * R_sph - r * r));
        return { d, r };
    };
    const edgePhase = (eid) => ((eid * 0.6180339887498949) % 1.0) * (2 * Math.PI / nSides);

    for (let vv = 0; vv < nodes.length; vv++) {
        const inc = adj[vv];
        if (inc.length < 2) continue;
        const profilePoints = [];
        const hullInputPoints = [];
        const profileEdgeIds = [];
        const R_sph = nodeSphereR[vv];
        const Vpt = nodes[vv].pt;
        for (let k = 0; k < inc.length; k++) {
            const edgeId = inc[k];
            const edge = edges[edgeId];
            const { v_start, n_canon, e1, e2 } = getCanonicalEdgeFrameForNodes(nodes, edge);
            const n_away = (vv === v_start) ? n_canon : n_canon.clone().negate();
            const { d, r } = getLocalParams(vv);
            const cen = Vpt.clone().addScaledVector(n_away, d);
            const dUnit = d / R_sph, rUnit = r / R_sph;
            const ph = edgePhase(edgeId);
            for (let j = 0; j < nSides; j++) {
                const theta = (2 * Math.PI * j) / nSides + ph;
                profilePoints.push(cen.clone().addScaledVector(e1, Math.cos(theta) * r).addScaledVector(e2, Math.sin(theta) * r));
                hullInputPoints.push(n_away.clone().multiplyScalar(dUnit).addScaledVector(e1, Math.cos(theta) * rUnit).addScaledVector(e2, Math.sin(theta) * rUnit));
                profileEdgeIds.push(edgeId);
            }
            profilePoints.push(Vpt.clone().addScaledVector(n_away, R_sph));
            hullInputPoints.push(n_away.clone());
            profileEdgeIds.push(edgeId);
        }
        const hullFaces = computeConvexHull3D(hullInputPoints);
        const ptMap = new Map();
        const getIdx = (pi) => {
            if (ptMap.has(pi)) return ptMap.get(pi);
            const idx = addVert(profilePoints[pi]);
            ptMap.set(pi, idx);
            return idx;
        };
        for (let f of hullFaces) {
            if (profileEdgeIds[f.a] === profileEdgeIds[f.b] && profileEdgeIds[f.b] === profileEdgeIds[f.c]) continue;
            jointTriangles.push(getIdx(f.a), getIdx(f.b), getIdx(f.c));
        }
    }

    const coarseSides = Math.max(4, Math.round(nSides / 2) + (Math.round(nSides / 2) % 2));
    for (let edge of activeEdges) {
        const edgeId = edge.id;
        const v1 = Math.min(edge.u, edge.v), v2 = Math.max(edge.u, edge.v);
        const v1_val = adj[v1].length, v2_val = adj[v2].length;
        const { n_canon, len, e1, e2 } = getCanonicalEdgeFrameForNodes(nodes, edge);
        if (len < 1e-5) continue;
        const params1 = getLocalParams(v1), params2 = getLocalParams(v2);
        const d_start = (v1_val >= 2) ? params1.d : 0, r_start = (v1_val >= 2) ? params1.r : wid;
        const d_end   = (v2_val >= 2) ? params2.d : 0, r_end   = (v2_val >= 2) ? params2.r : wid;
        const z_start = d_start;
        const z_end = Math.max(z_start + 1e-4, len - d_end);
        const ph = edgePhase(edgeId);

        const pStart = nodes[v1].pt.clone().addScaledVector(n_canon, z_start);
        const pEnd   = nodes[v1].pt.clone().addScaledVector(n_canon, z_end);
        const idx1 = [], idx2 = [];
        for (let j = 0; j < nSides; j++) {
            const theta = (2 * Math.PI * j) / nSides + ph;
            idx1.push(addVert(pStart.clone().addScaledVector(e1, Math.cos(theta) * r_start).addScaledVector(e2, Math.sin(theta) * r_start)));
        }
        for (let j = 0; j < nSides; j++) {
            const theta = (2 * Math.PI * j) / nSides + ph;
            idx2.push(addVert(pEnd.clone().addScaledVector(e1, Math.cos(theta) * r_end).addScaledVector(e2, Math.sin(theta) * r_end)));
        }

        const rowQuads = [];
        for (let j = 0; j < nSides; j++) {
            const next_j = (j + 1) % nSides;
            rowQuads.push(quads.length);
            quads.push([idx1[j], idx1[next_j], idx2[next_j], idx2[j]]);
            quadIsCap.push(0);
        }
        barQuadGrids[edgeId] = [rowQuads];
        const nBSpec = subdivLevels + 1;
        barStripSpecs[edgeId] = {
            type: 'frustum',
            edgeIndex: edgeId,
            endpoints: [edge.u, edge.v],
            centerlineLengthM: len,
            subdivLevels,
            nSides: coarseSides,
            zRings: Array.from({ length: nBSpec + 1 }, (_, m) => z_start + (m / nBSpec) * (z_end - z_start)),
            rRings: Array.from({ length: nBSpec + 1 }, (_, m) => r_start + (m / nBSpec) * (r_end - r_start))
        };

        if (capLeafEnds && v1_val === 1) appendPureQuadLeafCap(addVert, quads, quadIsCap, pStart, idx1, true);
        if (capLeafEnds && v2_val === 1) appendPureQuadLeafCap(addVert, quads, quadIsCap, pEnd, idx2, false);
    }

    const mergedJoint = mergeTrianglesToQuads(rawVertices, jointTriangles);
    for (let q of mergedJoint.quads) { quads.push(q); quadIsCap.push(1); }
    for (let t of mergedJoint.triangles) triangles.push(t);

    const finalized = finalizeSolidMesh(rawVertices, quads, triangles, null, {
        wid,
        weldEps: Math.min(1e-4, Math.max(1e-6, wid * 0.01)),
        quadIsCap,
        barQuadGrids
    });
    finalized.barStripSpecs = barStripSpecs;
    finalized.longitudinalSubdivLevels = 0;
    finalized.ccLevel = 0;
    initSolidFaceLoops(finalized, options.directionMode || 'longitudinal');

    if (finalized.triangles.length > 0) {
        applyCatmullClarkToPQStrips(finalized, 1, false);
    }
    if (subdivLevels >= 1) {
        applyLongitudinalOnlySubdivisionToPQStrips(finalized, subdivLevels, false);
    }
    if (applyPQ) {
        optimizeFaceLoopsToPQ(finalized, pqIterations, pqCoupling, {
            targetErrorM: Math.min(1e-6, maxQuadPlanarityErrorM * 0.02),
            maxQuadPlanarityErrorM
        });
    }
    return finalized;
}

function buildQuadDominantOBJ(solidData, info = {}) {
    const { vertices, quads, triangles, verification } = solidData;
    let objText = '# OBJ Export from WFC-FDM Foundry (Watertight Quad-Dominant Tubular Mesh)\n';
    objText += `# Name: ${info.name || 'wfc_fdm_candidate'}\n`;
    objText += `# Vertices: ${vertices.length}\n`;
    objText += `# Quads: ${quads.length}\n`;
    objText += `# Triangles: ${triangles.length}\n`;
    objText += `# Manifold: ${verification.isValid} (Watertight: ${verification.isWatertight}, Boundary: ${verification.boundaryEdges}, NonManifold: ${verification.nonManifoldEdges}, Euler: ${verification.euler}, Genus: ${verification.genus})\n\n`;
    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        objText += `v ${v.x.toFixed(6)} ${v.y.toFixed(6)} ${v.z.toFixed(6)}\n`;
    }
    objText += '\n';
    for (let q of quads) objText += `f ${q[0] + 1} ${q[1] + 1} ${q[2] + 1} ${q[3] + 1}\n`;
    for (let t of triangles) objText += `f ${t[0] + 1} ${t[1] + 1} ${t[2] + 1}\n`;
    return objText;
}

export {
    weldVertices,
    LOOP_PALETTE,
    hexToHSL,
    hslToHex,
    computeParentColorShade,
    computeQuadPlanarity,
    computeQuadPlanarityError,
    isConvexQuad3D,
    computeMeshPlanarityStats,
    computeSignedMeshVolume,
    planarizeQuadMesh,
    walkMeshFaceLoops,
    initSolidFaceLoops,
    optimizeFaceLoopsToPQ,
    applyCatmullClarkToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips,
    applyRingOnlySubdivisionToPQStrips,
    mergeTrianglesToQuads,
    verifyManifold,
    computeConvexHull3D,
    getCanonicalEdgeFrameForNodes,
    solveNodeSeamCounts,
    computeNodeBisectorRings,
    computeEndRingBisectorStitched,
    finalizeSolidMesh,
    appendPureQuadLeafCap,
    solidifyGraphBisectorStitched,
    solidifyGraph,
    buildQuadDominantOBJ
};

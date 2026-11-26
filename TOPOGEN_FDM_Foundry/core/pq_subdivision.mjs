/**
 * WFC-FDM Foundry — Core Module 4b: Catmull-Clark, Longitudinal & Ring PQ Strip Subdivision
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 * Re-exported through core/pq_solidifier.mjs and core/index.mjs.
 *
 * Student Quick-Map:
 *   - Edit full Catmull-Clark quad subdivision -> applyCatmullClarkToPQStrips()
 *   - Edit longitudinal-only bar subdivision   -> applyLongitudinalOnlySubdivisionToPQStrips()
 *   - Edit ring-only circumferential subdiv    -> applyRingOnlySubdivisionToPQStrips()
 */

import { V3, toV3, toArr3 } from './math_tiles.mjs';
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

// Exact Catmull-Clark Subdivision on PQ Mesh Strips -> 100% Pure Quads (0 triangles),
// child-quad side alignment (-k shift), optional strip-border crease preservation, and parent loop color inheritance!
function applyCatmullClarkToPQStrips(solidData, levels = 1, reoptimizePQ = false, options = {}) {
    if (!solidData || !solidData.vertices || solidData.vertices.length === 0) return solidData;
    const nLevels = Math.max(0, Math.round(levels));
    if (nLevels === 0) {
        if (reoptimizePQ) optimizeFaceLoopsToPQ(solidData, options.pqIterations || 64, options.pqCoupling || 0.65, options);
        return solidData;
    }

    if (!solidData.quadInheritedColors || !solidData.quadParentLoopIds) {
        initSolidFaceLoops(solidData, solidData.directionMode || 'longitudinal');
    }

    let currVerts = solidData.vertices.map(v => toV3(v));
    let currQuads = (solidData.quads || []).map(q => [...q]);
    let currTris  = (solidData.triangles || []).map(t => [...t]);
    let currLoopIds = solidData.quadToLoopId ? Array.from(solidData.quadToLoopId) : currQuads.map((_, i) => i);
    let currLongColors = (solidData.quadInheritedColors && solidData.quadInheritedColors.longitudinal && solidData.quadInheritedColors.longitudinal.length === currQuads.length)
        ? Array.from(solidData.quadInheritedColors.longitudinal)
        : currQuads.map((_, i) => LOOP_PALETTE[i % LOOP_PALETTE.length]);
    let currRingColors = (solidData.quadInheritedColors && solidData.quadInheritedColors.ring && solidData.quadInheritedColors.ring.length === currQuads.length)
        ? Array.from(solidData.quadInheritedColors.ring)
        : currQuads.map((_, i) => LOOP_PALETTE[i % LOOP_PALETTE.length]);
    let currLongParents = (solidData.quadParentLoopIds && solidData.quadParentLoopIds.longitudinal && solidData.quadParentLoopIds.longitudinal.length === currQuads.length)
        ? Array.from(solidData.quadParentLoopIds.longitudinal)
        : currQuads.map((_, i) => i);
    let currRingParents = (solidData.quadParentLoopIds && solidData.quadParentLoopIds.ring && solidData.quadParentLoopIds.ring.length === currQuads.length)
        ? Array.from(solidData.quadParentLoopIds.ring)
        : currQuads.map((_, i) => i);
    let currIsCap = (solidData.quadIsCap && solidData.quadIsCap.length === currQuads.length)
        ? Array.from(solidData.quadIsCap)
        : new Array(currQuads.length).fill(0);
    let currBarGrids = solidData.barQuadGrids
        ? solidData.barQuadGrids.map(g => g ? g.map(row => [...row]) : null)
        : null;

    const boundaryMode = options.boundaryMode || 'smooth_all';

    for (let lv = 0; lv < nLevels; lv++) {
        const nV = currVerts.length;
        const allFaces = [];
        const faceLoopIds = [];
        const faceLongColors = [];
        const faceRingColors = [];
        const faceLongParents = [];
        const faceRingParents = [];
        const faceIsCap = [];

        for (let i = 0; i < currQuads.length; i++) {
            allFaces.push(currQuads[i]);
            faceLoopIds.push(currLoopIds[i] !== undefined ? currLoopIds[i] : -1);
            faceLongColors.push(currLongColors[i] !== undefined ? currLongColors[i] : LOOP_PALETTE[0]);
            faceRingColors.push(currRingColors[i] !== undefined ? currRingColors[i] : LOOP_PALETTE[0]);
            faceLongParents.push(currLongParents[i] !== undefined ? currLongParents[i] : i);
            faceRingParents.push(currRingParents[i] !== undefined ? currRingParents[i] : i);
            faceIsCap.push(currIsCap[i] ? 1 : 0);
        }
        for (let i = 0; i < currTris.length; i++) {
            allFaces.push(currTris[i]);
            faceLoopIds.push(-1);
            faceLongColors.push(LOOP_PALETTE[0]);
            faceRingColors.push(LOOP_PALETTE[0]);
            faceLongParents.push(-1);
            faceRingParents.push(-1);
            faceIsCap.push(1);
        }

        const nF = allFaces.length;
        const facePoints = new Array(nF);
        for (let fIdx = 0; fIdx < nF; fIdx++) {
            const face = allFaces[fIdx];
            const fp = new V3();
            for (let vIdx of face) fp.add(currVerts[vIdx]);
            fp.divideScalar(face.length);
            facePoints[fIdx] = fp;
        }

        const edgeMap = new Map();
        const edgeList = [];
        const getEdgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
        const vertIncidentFaces = Array.from({ length: nV }, () => []);
        const vertIncidentEdges = Array.from({ length: nV }, () => []);

        for (let fIdx = 0; fIdx < nF; fIdx++) {
            const face = allFaces[fIdx];
            const lid = faceLoopIds[fIdx];
            const m = face.length;
            for (let k = 0; k < m; k++) {
                const a = face[k];
                const b = face[(k + 1) % m];
                vertIncidentFaces[a].push(fIdx);
                const key = getEdgeKey(a, b);
                let eEntry = edgeMap.get(key);
                if (!eEntry) {
                    const u = Math.min(a, b), v = Math.max(a, b);
                    const mid = new V3().addVectors(currVerts[u], currVerts[v]).multiplyScalar(0.5);
                    eEntry = { id: edgeList.length, u, v, mid, faces: [], loopIds: new Set() };
                    edgeMap.set(key, eEntry);
                    edgeList.push(eEntry);
                    vertIncidentEdges[u].push(eEntry.id);
                    vertIncidentEdges[v].push(eEntry.id);
                }
                eEntry.faces.push(fIdx);
                if (lid >= 0) eEntry.loopIds.add(lid);
            }
        }

        const nE = edgeList.length;
        const edgePoints = new Array(nE);
        for (let eIdx = 0; eIdx < nE; eIdx++) {
            const e = edgeList[eIdx];
            const isStripBorder = (boundaryMode === 'preserve_strip_creases') && (e.loopIds.size >= 2);
            if (e.faces.length !== 2 || isStripBorder) {
                edgePoints[eIdx] = e.mid.clone();
            } else {
                edgePoints[eIdx] = new V3()
                    .add(currVerts[e.u])
                    .add(currVerts[e.v])
                    .add(facePoints[e.faces[0]])
                    .add(facePoints[e.faces[1]])
                    .multiplyScalar(0.25);
            }
        }

        const newVerts = new Array(nV + nF + nE);
        for (let vIdx = 0; vIdx < nV; vIdx++) {
            const incF = vertIncidentFaces[vIdx];
            const incE = vertIncidentEdges[vIdx];
            const n = incF.length;
            if (n === 0) {
                newVerts[vIdx] = currVerts[vIdx].clone();
                continue;
            }
            const creaseEdges = (boundaryMode === 'preserve_strip_creases')
                ? incE.filter(eid => edgeList[eid].faces.length !== 2 || edgeList[eid].loopIds.size >= 2)
                : incE.filter(eid => edgeList[eid].faces.length !== 2);

            if (creaseEdges.length === 2) {
                const e1 = edgeList[creaseEdges[0]];
                const e2 = edgeList[creaseEdges[1]];
                const nbr1 = (e1.u === vIdx) ? e1.v : e1.u;
                const nbr2 = (e2.u === vIdx) ? e2.v : e2.u;
                newVerts[vIdx] = currVerts[vIdx].clone().multiplyScalar(0.75)
                    .addScaledVector(currVerts[nbr1], 0.125)
                    .addScaledVector(currVerts[nbr2], 0.125);
            } else if (creaseEdges.length > 2) {
                newVerts[vIdx] = currVerts[vIdx].clone();
            } else {
                const F = new V3();
                for (let fIdx of incF) F.add(facePoints[fIdx]);
                F.divideScalar(n);
                const R = new V3();
                for (let eid of incE) R.add(edgeList[eid].mid);
                R.divideScalar(incE.length);
                newVerts[vIdx] = new V3()
                    .addScaledVector(F, 1 / n)
                    .addScaledVector(R, 2 / n)
                    .addScaledVector(currVerts[vIdx], (n - 3) / n);
            }
        }

        for (let fIdx = 0; fIdx < nF; fIdx++) newVerts[nV + fIdx] = facePoints[fIdx];
        for (let eIdx = 0; eIdx < nE; eIdx++) newVerts[nV + nF + eIdx] = edgePoints[eIdx];

        const nextQuads = [];
        const nextLoopIds = [];
        const nextLongColors = [];
        const nextRingColors = [];
        const nextLongParents = [];
        const nextRingParents = [];
        const nextIsCap = [];
        const quadChildStart = new Int32Array(currQuads.length);

        for (let fIdx = 0; fIdx < nF; fIdx++) {
            if (fIdx < currQuads.length) quadChildStart[fIdx] = nextQuads.length;
            const face = allFaces[fIdx];
            const lid = faceLoopIds[fIdx];
            const lCol = faceLongColors[fIdx];
            const rCol = faceRingColors[fIdx];
            const lPar = faceLongParents[fIdx];
            const rPar = faceRingParents[fIdx];
            const capFlag = faceIsCap[fIdx];
            const m = face.length;
            const fpIdx = nV + fIdx;

            for (let k = 0; k < m; k++) {
                const vPrev = face[(k + m - 1) % m];
                const vCurr = face[k];
                const vNext = face[(k + 1) % m];
                const epPrevIdx = nV + nF + edgeMap.get(getEdgeKey(vPrev, vCurr)).id;
                const epNextIdx = nV + nF + edgeMap.get(getEdgeKey(vCurr, vNext)).id;
                const rawQ = [vCurr, epNextIdx, fpIdx, epPrevIdx];
                if (m === 4) {
                    const shift = (4 - (k % 4)) % 4;
                    nextQuads.push([
                        rawQ[shift],
                        rawQ[(shift + 1) % 4],
                        rawQ[(shift + 2) % 4],
                        rawQ[(shift + 3) % 4]
                    ]);
                } else {
                    nextQuads.push(rawQ);
                }
                nextLoopIds.push(lid);
                nextLongColors.push(lCol);
                nextRingColors.push(rCol);
                nextLongParents.push(lPar);
                nextRingParents.push(rPar);
                nextIsCap.push(capFlag);
            }
        }

        if (currBarGrids) {
            currBarGrids = currBarGrids.map(grid => {
                if (!grid) return null;
                const nextGrid = [];
                for (let r = 0; r < grid.length; r++) {
                    const row = grid[r];
                    const botRow = [];
                    const topRow = [];
                    for (let c = 0; c < row.length; c++) {
                        const base = quadChildStart[row[c]];
                        botRow.push(base + 0, base + 1);
                        topRow.push(base + 3, base + 2);
                    }
                    nextGrid.push(botRow, topRow);
                }
                return nextGrid;
            });
        }

        currVerts = newVerts;
        currQuads = nextQuads;
        currTris  = [];
        currLoopIds = nextLoopIds;
        currLongColors = nextLongColors;
        currRingColors = nextRingColors;
        currLongParents = nextLongParents;
        currRingParents = nextRingParents;
        currIsCap = nextIsCap;
    }

    const r6 = (val) => Math.round(val * 1e6) / 1e6;
    for (let i = 0; i < currVerts.length; i++) {
        currVerts[i].x = r6(currVerts[i].x);
        currVerts[i].y = r6(currVerts[i].y);
        currVerts[i].z = r6(currVerts[i].z);
    }

    const verificationTriangles = [];
    for (let q of currQuads) verificationTriangles.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    const verification = verifyManifold(currVerts, verificationTriangles);

    let trunkCount = 0;
    for (let i = 0; i < currIsCap.length; i++) if (!currIsCap[i]) trunkCount++;

    solidData.vertices = currVerts;
    solidData.quads = currQuads;
    solidData.triangles = [];
    solidData.verification = verification;
    solidData.quadIsCap = Uint8Array.from(currIsCap);
    solidData.barTubeQuadCount = trunkCount;
    if (currBarGrids) solidData.barQuadGrids = currBarGrids;
    solidData.ccLevel = (solidData.ccLevel || 0) + nLevels;
    solidData.quadInheritedColors = {
        longitudinal: Int32Array.from(currLongColors),
        ring: Int32Array.from(currRingColors)
    };
    solidData.quadParentLoopIds = {
        longitudinal: Int32Array.from(currLongParents),
        ring: Int32Array.from(currRingParents)
    };

    walkMeshFaceLoops(currVerts, currQuads, solidData.directionMode || 'longitudinal', { solidData });

    if (reoptimizePQ) {
        optimizeFaceLoopsToPQ(solidData, options.pqIterations || 64, options.pqCoupling || 0.65, options);
    } else {
        solidData.planarity = computeMeshPlanarityStats(currVerts, currQuads);
        solidData.signedVolume = computeSignedMeshVolume(currVerts, currQuads, []);
    }
    return solidData;
}

// Compute a T-junction-free dual-chord edge split set on an arbitrary quad mesh.
// Walks face loops in `directionMode` ('longitudinal' or 'ring'), seeds each non-cap
// quad's lateral edges ((enterSide + 1) % 4 and (enterSide + 3) % 4), and closes under
// opposite-edge propagation across shared quad edges (marking all 4 edges of touched caps).
function computeDualChordSplitMask(currVerts, currQuads, currIsCap, directionMode) {
    const nQ = currQuads.length;
    const getEdgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    const edgeToQuads = new Map();
    for (let qIdx = 0; qIdx < nQ; qIdx++) {
        const q = currQuads[qIdx];
        for (let s = 0; s < 4; s++) {
            const k = getEdgeKey(q[s], q[(s + 1) % 4]);
            let list = edgeToQuads.get(k);
            if (!list) { list = []; edgeToQuads.set(k, list); }
            list.push({ qIdx, side: s });
        }
    }

    const walked = walkMeshFaceLoops(currVerts, currQuads, directionMode, { computeUnroll: false });
    const splitEdgeSet = new Set();
    const queue = [];
    const enqueueEdge = (a, b) => {
        const k = getEdgeKey(a, b);
        if (!splitEdgeSet.has(k)) {
            splitEdgeSet.add(k);
            queue.push(k);
        }
    };

    const seeded = new Uint8Array(nQ);
    for (let lp of walked.loops) {
        for (let st of lp.steps) {
            const qIdx = st.qIdx;
            if (currIsCap[qIdx] || seeded[qIdx]) continue;
            seeded[qIdx] = 1;
            const q = currQuads[qIdx];
            const sA = (st.enterSide + 1) % 4;
            const sB = (st.enterSide + 3) % 4;
            enqueueEdge(q[sA], q[(sA + 1) % 4]);
            enqueueEdge(q[sB], q[(sB + 1) % 4]);
        }
    }
    // Fallback for any unvisited non-cap quad
    const fallbackA = directionMode === 'ring' ? 0 : 1;
    const fallbackB = (fallbackA + 2) % 4;
    for (let qIdx = 0; qIdx < nQ; qIdx++) {
        if (currIsCap[qIdx] || seeded[qIdx]) continue;
        const q = currQuads[qIdx];
        enqueueEdge(q[fallbackA], q[(fallbackA + 1) % 4]);
        enqueueEdge(q[fallbackB], q[(fallbackB + 1) % 4]);
    }

    // Opposite-edge dual-chord closure guarantees 0 T-junctions on any manifold quad mesh
    let head = 0;
    while (head < queue.length) {
        const k = queue[head++];
        const inc = edgeToQuads.get(k);
        if (!inc) continue;
        for (let i = 0; i < inc.length; i++) {
            const { qIdx, side } = inc[i];
            const q = currQuads[qIdx];
            if (currIsCap[qIdx]) {
                for (let s = 0; s < 4; s++) enqueueEdge(q[s], q[(s + 1) % 4]);
            } else {
                const opp = (side + 2) % 4;
                enqueueEdge(q[opp], q[(opp + 1) % 4]);
            }
        }
    }

    // Per-quad split classification: 0 = none, 1 = sides 0&2, 2 = sides 1&3, 3 = all 4 sides
    const quadSplitKind = new Uint8Array(nQ);
    for (let qIdx = 0; qIdx < nQ; qIdx++) {
        const q = currQuads[qIdx];
        const s02 = splitEdgeSet.has(getEdgeKey(q[0], q[1])) && splitEdgeSet.has(getEdgeKey(q[2], q[3]));
        const s13 = splitEdgeSet.has(getEdgeKey(q[1], q[2])) && splitEdgeSet.has(getEdgeKey(q[3], q[0]));
        quadSplitKind[qIdx] = (s02 ? 1 : 0) | (s13 ? 2 : 0);
    }

    return { splitEdgeSet, quadSplitKind, getEdgeKey };
}

// Anisotropic Longitudinal-Only Cubic B-Spline Subdivision:
// Splits each trunk quad along its topological longitudinal edges into 2 quads (with dual-chord
// closure so arbitrary imported quad meshes stay 100% manifold with 0 T-junctions)
// while keeping circumferential ring coarseness & flat leaf end-caps intact!
function applyLongitudinalOnlySubdivisionToPQStrips(solidData, levels = 1, reoptimizePQ = false, options = {}) {
    if (!solidData || !solidData.vertices || solidData.vertices.length === 0 || !solidData.quads || solidData.quads.length === 0) {
        return solidData;
    }
    const nLevels = Math.max(0, Math.round(levels));
    if (nLevels === 0) {
        if (reoptimizePQ) optimizeFaceLoopsToPQ(solidData, options.pqIterations || 64, options.pqCoupling || 0.65, options);
        return solidData;
    }

    if (!solidData.quadInheritedColors || !solidData.quadParentLoopIds) {
        initSolidFaceLoops(solidData, solidData.directionMode || 'longitudinal');
    }

    let currVerts = solidData.vertices.map(v => toV3(v));
    let currQuads = solidData.quads.map(q => [...q]);
    let currTris  = (solidData.triangles || []).map(t => [...t]);
    let currLongColors = (solidData.quadInheritedColors && solidData.quadInheritedColors.longitudinal && solidData.quadInheritedColors.longitudinal.length === currQuads.length)
        ? Array.from(solidData.quadInheritedColors.longitudinal)
        : currQuads.map((_, i) => LOOP_PALETTE[i % LOOP_PALETTE.length]);
    let currRingColors = (solidData.quadInheritedColors && solidData.quadInheritedColors.ring && solidData.quadInheritedColors.ring.length === currQuads.length)
        ? Array.from(solidData.quadInheritedColors.ring)
        : currQuads.map((_, i) => LOOP_PALETTE[i % LOOP_PALETTE.length]);
    let currLongParents = (solidData.quadParentLoopIds && solidData.quadParentLoopIds.longitudinal && solidData.quadParentLoopIds.longitudinal.length === currQuads.length)
        ? Array.from(solidData.quadParentLoopIds.longitudinal)
        : currQuads.map((_, i) => i);
    let currRingParents = (solidData.quadParentLoopIds && solidData.quadParentLoopIds.ring && solidData.quadParentLoopIds.ring.length === currQuads.length)
        ? Array.from(solidData.quadParentLoopIds.ring)
        : currQuads.map((_, i) => i);
    let currIsCap = (solidData.quadIsCap && solidData.quadIsCap.length === currQuads.length)
        ? Array.from(solidData.quadIsCap)
        : new Array(currQuads.length).fill(0);
    let currBarGrids = solidData.barQuadGrids
        ? solidData.barQuadGrids.map(g => g ? g.map(row => [...row]) : null)
        : null;

    const boundaryMode = options.boundaryMode || 'smooth_all';

    for (let lv = 0; lv < nLevels; lv++) {
        const nV = currVerts.length;
        const nQ = currQuads.length;
        const { quadSplitKind, getEdgeKey } = computeDualChordSplitMask(currVerts, currQuads, currIsCap, 'longitudinal');

        const longEdgeMap = new Map();
        const longEdgeList = [];
        const vertLongNeighbors = Array.from({ length: nV }, () => new Set());
        const vertRingCreaseCount = new Int32Array(nV);
        const vertMinCircLen = new Float64Array(nV).fill(Infinity);

        const ringEdgeQuads = new Map();
        const ringEdgeLoops = new Map();
        for (let qIdx = 0; qIdx < nQ; qIdx++) {
            const q = currQuads[qIdx];
            const kind = quadSplitKind[qIdx];
            if (currIsCap[qIdx] || kind === 0 || kind === 3) {
                for (let k = 0; k < 4; k++) vertRingCreaseCount[q[k]]++;
                continue;
            }
            const lid = solidData.quadToLoopId ? (solidData.quadToLoopId[qIdx] ?? -1) : -1;
            const ringSides = (kind === 1) ? [1, 3] : [0, 2];
            for (let s of ringSides) {
                const a = q[s], b = q[(s + 1) % 4];
                const cLen = currVerts[a].distanceTo(currVerts[b]);
                if (cLen < vertMinCircLen[a]) vertMinCircLen[a] = cLen;
                if (cLen < vertMinCircLen[b]) vertMinCircLen[b] = cLen;
                const k = getEdgeKey(a, b);
                ringEdgeQuads.set(k, (ringEdgeQuads.get(k) || 0) + 1);
                if (!ringEdgeLoops.has(k)) ringEdgeLoops.set(k, new Set());
                if (lid >= 0) ringEdgeLoops.get(k).add(lid);
            }
        }

        for (let [k, count] of ringEdgeQuads.entries()) {
            const loopSet = ringEdgeLoops.get(k);
            const isOpenEnd = count === 1;
            const isStripSeam = (boundaryMode === 'preserve_strip_creases') && loopSet && (loopSet.size >= 2);
            if (isOpenEnd || isStripSeam) {
                const comma = k.indexOf(',');
                const u = parseInt(k.slice(0, comma), 10);
                const v = parseInt(k.slice(comma + 1), 10);
                vertRingCreaseCount[u]++;
                vertRingCreaseCount[v]++;
            }
        }

        const vertMinLongLen = new Float64Array(nV).fill(Infinity);
        const registerLongEdge = (a, b, qIdx) => {
            const key = getEdgeKey(a, b);
            let entry = longEdgeMap.get(key);
            if (!entry) {
                const u = Math.min(a, b), v = Math.max(a, b);
                const lLen = currVerts[u].distanceTo(currVerts[v]);
                if (lLen < vertMinLongLen[u]) vertMinLongLen[u] = lLen;
                if (lLen < vertMinLongLen[v]) vertMinLongLen[v] = lLen;
                const mid = new V3().addVectors(currVerts[u], currVerts[v]).multiplyScalar(0.5);
                entry = { id: longEdgeList.length, u, v, mid, quads: [] };
                longEdgeMap.set(key, entry);
                longEdgeList.push(entry);
                vertLongNeighbors[u].add(v);
                vertLongNeighbors[v].add(u);
            }
            entry.quads.push(qIdx);
            return entry.id;
        };

        const quadLongEdges = new Array(nQ).fill(null);
        for (let qIdx = 0; qIdx < nQ; qIdx++) {
            const kind = quadSplitKind[qIdx];
            if (kind === 0) continue;
            const q = currQuads[qIdx];
            if (kind === 2) {
                const e12 = registerLongEdge(q[1], q[2], qIdx);
                const e30 = registerLongEdge(q[3], q[0], qIdx);
                quadLongEdges[qIdx] = { kind: 2, e12, e30 };
            } else if (kind === 1) {
                const e01 = registerLongEdge(q[0], q[1], qIdx);
                const e23 = registerLongEdge(q[2], q[3], qIdx);
                quadLongEdges[qIdx] = { kind: 1, e01, e23 };
            } else {
                const e0 = registerLongEdge(q[0], q[1], qIdx);
                const e1 = registerLongEdge(q[1], q[2], qIdx);
                const e2 = registerLongEdge(q[2], q[3], qIdx);
                const e3 = registerLongEdge(q[3], q[0], qIdx);
                quadLongEdges[qIdx] = { kind: 3, e0, e1, e2, e3 };
            }
        }

        const nLE = longEdgeList.length;
        const newVerts = new Array(nV + nLE);

        // 1D cubic B-spline longitudinal smoothing (1/8, 6/8, 1/8) with cross-section & short-bar midpoint guard
        // so every bar's quads ALWAYS split cleanly into 2 convex child quads without folding short bars!
        for (let vIdx = 0; vIdx < nV; vIdx++) {
            const nbrs = Array.from(vertLongNeighbors[vIdx]);
            const isPinned = vertRingCreaseCount[vIdx] > 0;
            if (isPinned || nbrs.length <= 1) {
                newVerts[vIdx] = currVerts[vIdx].clone();
            } else {
                let target;
                if (nbrs.length === 2) {
                    target = currVerts[vIdx].clone().multiplyScalar(0.75)
                        .addScaledVector(currVerts[nbrs[0]], 0.125)
                        .addScaledVector(currVerts[nbrs[1]], 0.125);
                } else {
                    const avgNbr = new V3();
                    for (let nb of nbrs) avgNbr.add(currVerts[nb]);
                    avgNbr.divideScalar(nbrs.length);
                    target = currVerts[vIdx].clone().multiplyScalar(0.75)
                        .addScaledVector(avgNbr, 0.25);
                }
                const delta = new V3().subVectors(target, currVerts[vIdx]);
                const dLen = delta.length();
                const limCirc = Number.isFinite(vertMinCircLen[vIdx]) ? (0.42 * vertMinCircLen[vIdx]) : Infinity;
                const limLong = Number.isFinite(vertMinLongLen[vIdx]) ? (0.20 * vertMinLongLen[vIdx]) : Infinity;
                const maxStep = Math.min(limCirc, limLong);
                if (dLen > maxStep && dLen > 1e-12) {
                    delta.multiplyScalar(maxStep / dLen);
                    newVerts[vIdx] = currVerts[vIdx].clone().add(delta);
                } else {
                    newVerts[vIdx] = target;
                }
            }
        }

        for (let eIdx = 0; eIdx < nLE; eIdx++) {
            newVerts[nV + eIdx] = longEdgeList[eIdx].mid.clone();
        }

        const nextQuads = [];
        const nextLongColors = [];
        const nextRingColors = [];
        const nextLongParents = [];
        const nextRingParents = [];
        const nextIsCap = [];
        const quadChildPair = new Array(nQ).fill(null);

        for (let qIdx = 0; qIdx < nQ; qIdx++) {
            const q = currQuads[qIdx];
            const lCol = currLongColors[qIdx];
            const rCol = currRingColors[qIdx];
            const lPar = currLongParents[qIdx];
            const rPar = currRingParents[qIdx];
            const capFlag = currIsCap[qIdx] ? 1 : 0;
            const info = quadLongEdges[qIdx];
            if (!info) {
                nextQuads.push([...q]);
                nextLongColors.push(lCol);
                nextRingColors.push(rCol);
                nextLongParents.push(lPar);
                nextRingParents.push(rPar);
                nextIsCap.push(capFlag);
            } else if (info.kind === 2) {
                const ep12Idx = nV + info.e12;
                const ep30Idx = nV + info.e30;
                const cA = nextQuads.length;
                nextQuads.push([q[0], q[1], ep12Idx, ep30Idx]);
                const cB = nextQuads.length;
                nextQuads.push([ep30Idx, ep12Idx, q[2], q[3]]);
                quadChildPair[qIdx] = [cA, cB];
                nextLongColors.push(lCol, lCol);
                nextRingColors.push(rCol, rCol);
                nextLongParents.push(lPar, lPar);
                nextRingParents.push(rPar, rPar);
                nextIsCap.push(capFlag, capFlag);
            } else if (info.kind === 1) {
                // Canonicalize child quads so split longitudinal edges lie on sides 1 & 3
                const ep01Idx = nV + info.e01;
                const ep23Idx = nV + info.e23;
                const cA = nextQuads.length;
                nextQuads.push([q[3], q[0], ep01Idx, ep23Idx]);
                const cB = nextQuads.length;
                nextQuads.push([ep23Idx, ep01Idx, q[1], q[2]]);
                quadChildPair[qIdx] = [cA, cB];
                nextLongColors.push(lCol, lCol);
                nextRingColors.push(rCol, rCol);
                nextLongParents.push(lPar, lPar);
                nextRingParents.push(rPar, rPar);
                nextIsCap.push(capFlag, capFlag);
            } else {
                const fp = new V3()
                    .add(currVerts[q[0]]).add(currVerts[q[1]])
                    .add(currVerts[q[2]]).add(currVerts[q[3]])
                    .multiplyScalar(0.25);
                const fpIdx = newVerts.length;
                newVerts.push(fp);
                const e0 = nV + info.e0, e1 = nV + info.e1, e2 = nV + info.e2, e3 = nV + info.e3;
                nextQuads.push(
                    [q[0], e0, fpIdx, e3],
                    [e0, q[1], e1, fpIdx],
                    [fpIdx, e1, q[2], e2],
                    [e3, fpIdx, e2, q[3]]
                );
                nextLongColors.push(lCol, lCol, lCol, lCol);
                nextRingColors.push(rCol, rCol, rCol, rCol);
                nextLongParents.push(lPar, lPar, lPar, lPar);
                nextRingParents.push(rPar, rPar, rPar, rPar);
                nextIsCap.push(capFlag, capFlag, capFlag, capFlag);
            }
        }

        if (currBarGrids) {
            currBarGrids = currBarGrids.map(grid => {
                if (!grid) return null;
                const nextGrid = [];
                for (let r = 0; r < grid.length; r++) {
                    const row = grid[r];
                    const rowA = [];
                    const rowB = [];
                    for (let c = 0; c < row.length; c++) {
                        const pair = quadChildPair[row[c]];
                        if (pair) {
                            rowA.push(pair[0]);
                            rowB.push(pair[1]);
                        }
                    }
                    if (rowA.length > 0) nextGrid.push(rowA, rowB);
                }
                return nextGrid;
            });
        }

        currVerts = newVerts;
        currQuads = nextQuads;
        currLongColors = nextLongColors;
        currRingColors = nextRingColors;
        currLongParents = nextLongParents;
        currRingParents = nextRingParents;
        currIsCap = nextIsCap;
    }

    const r6 = (val) => Math.round(val * 1e6) / 1e6;
    for (let i = 0; i < currVerts.length; i++) {
        currVerts[i].x = r6(currVerts[i].x);
        currVerts[i].y = r6(currVerts[i].y);
        currVerts[i].z = r6(currVerts[i].z);
    }

    const verificationTriangles = [];
    for (let q of currQuads) verificationTriangles.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    for (let t of currTris) verificationTriangles.push(t[0], t[1], t[2]);
    const verification = verifyManifold(currVerts, verificationTriangles);

    let trunkCount = 0;
    for (let i = 0; i < currIsCap.length; i++) if (!currIsCap[i]) trunkCount++;

    solidData.vertices = currVerts;
    solidData.quads = currQuads;
    solidData.triangles = currTris;
    solidData.verification = verification;
    solidData.quadIsCap = Uint8Array.from(currIsCap);
    solidData.barTubeQuadCount = trunkCount;
    if (currBarGrids) solidData.barQuadGrids = currBarGrids;
    solidData.longitudinalSubdivLevels = (solidData.longitudinalSubdivLevels || 0) + nLevels;
    solidData.ccLevel = (solidData.ccLevel || 0) + nLevels;
    solidData.quadInheritedColors = {
        longitudinal: Int32Array.from(currLongColors),
        ring: Int32Array.from(currRingColors)
    };
    solidData.quadParentLoopIds = {
        longitudinal: Int32Array.from(currLongParents),
        ring: Int32Array.from(currRingParents)
    };

    walkMeshFaceLoops(currVerts, currQuads, solidData.directionMode || 'longitudinal', { solidData });

    if (reoptimizePQ) {
        optimizeFaceLoopsToPQ(solidData, options.pqIterations || 64, options.pqCoupling || 0.65, options);
    } else {
        solidData.planarity = computeMeshPlanarityStats(currVerts, currQuads);
        solidData.signedVolume = computeSignedMeshVolume(currVerts, currQuads, currTris);
    }
    return solidData;
}

// Anisotropic Circumferential Ring-Only Subdivision:
// Splits each trunk quad along its topological circumferential ring edges into 2 quads
// (using dual-chord opposite-edge closure so arbitrary imported quad meshes preserve every ring
// loop with 0 T-junctions), and splits touched cap/junction quads 1->4 cleanly!
function applyRingOnlySubdivisionToPQStrips(solidData, levels = 1, reoptimizePQ = false, options = {}) {
    if (!solidData || !solidData.vertices || solidData.vertices.length === 0 || !solidData.quads || solidData.quads.length === 0) {
        return solidData;
    }
    const nLevels = Math.max(0, Math.round(levels));
    if (nLevels === 0) {
        if (reoptimizePQ) optimizeFaceLoopsToPQ(solidData, options.pqIterations || 64, options.pqCoupling || 0.65, options);
        return solidData;
    }

    if (!solidData.quadInheritedColors || !solidData.quadParentLoopIds) {
        initSolidFaceLoops(solidData, solidData.directionMode || 'longitudinal');
    }

    let currVerts = solidData.vertices.map(v => toV3(v));
    let currQuads = solidData.quads.map(q => [...q]);
    let currTris  = (solidData.triangles || []).map(t => [...t]);
    let currLongColors = (solidData.quadInheritedColors && solidData.quadInheritedColors.longitudinal && solidData.quadInheritedColors.longitudinal.length === currQuads.length)
        ? Array.from(solidData.quadInheritedColors.longitudinal)
        : currQuads.map((_, i) => LOOP_PALETTE[i % LOOP_PALETTE.length]);
    let currRingColors = (solidData.quadInheritedColors && solidData.quadInheritedColors.ring && solidData.quadInheritedColors.ring.length === currQuads.length)
        ? Array.from(solidData.quadInheritedColors.ring)
        : currQuads.map((_, i) => LOOP_PALETTE[i % LOOP_PALETTE.length]);
    let currLongParents = (solidData.quadParentLoopIds && solidData.quadParentLoopIds.longitudinal && solidData.quadParentLoopIds.longitudinal.length === currQuads.length)
        ? Array.from(solidData.quadParentLoopIds.longitudinal)
        : currQuads.map((_, i) => i);
    let currRingParents = (solidData.quadParentLoopIds && solidData.quadParentLoopIds.ring && solidData.quadParentLoopIds.ring.length === currQuads.length)
        ? Array.from(solidData.quadParentLoopIds.ring)
        : currQuads.map((_, i) => i);
    let currIsCap = (solidData.quadIsCap && solidData.quadIsCap.length === currQuads.length)
        ? Array.from(solidData.quadIsCap)
        : new Array(currQuads.length).fill(0);
    let currBarGrids = solidData.barQuadGrids
        ? solidData.barQuadGrids.map(g => g ? g.map(row => [...row]) : null)
        : null;

    const boundaryMode = options.boundaryMode || 'smooth_all';

    for (let lv = 0; lv < nLevels; lv++) {
        const nV = currVerts.length;
        const nQ = currQuads.length;
        const { quadSplitKind, getEdgeKey } = computeDualChordSplitMask(currVerts, currQuads, currIsCap, 'ring');

        // Collect orthogonal (unsplit) edge lengths & crease/cap pins for safe 1D cubic B-spline ring smoothing
        const vertOrthoCreaseCount = new Int32Array(nV);
        const vertMinOrthoLen = new Float64Array(nV).fill(Infinity);
        const orthoEdgeQuads = new Map();
        const orthoEdgeLoops = new Map();
        for (let qIdx = 0; qIdx < nQ; qIdx++) {
            const q = currQuads[qIdx];
            const kind = quadSplitKind[qIdx];
            if (currIsCap[qIdx] || kind === 0 || kind === 3) {
                for (let k = 0; k < 4; k++) vertOrthoCreaseCount[q[k]]++;
                continue;
            }
            const lid = solidData.quadToLoopId ? (solidData.quadToLoopId[qIdx] ?? -1) : -1;
            const orthoSides = (kind === 1) ? [1, 3] : [0, 2];
            for (let s of orthoSides) {
                const a = q[s], b = q[(s + 1) % 4];
                const oLen = currVerts[a].distanceTo(currVerts[b]);
                if (oLen < vertMinOrthoLen[a]) vertMinOrthoLen[a] = oLen;
                if (oLen < vertMinOrthoLen[b]) vertMinOrthoLen[b] = oLen;
                const k = getEdgeKey(a, b);
                orthoEdgeQuads.set(k, (orthoEdgeQuads.get(k) || 0) + 1);
                if (!orthoEdgeLoops.has(k)) orthoEdgeLoops.set(k, new Set());
                if (lid >= 0) orthoEdgeLoops.get(k).add(lid);
            }
        }
        for (let [k, count] of orthoEdgeQuads.entries()) {
            const loopSet = orthoEdgeLoops.get(k);
            const isOpenEnd = count === 1;
            const isStripSeam = (boundaryMode === 'preserve_strip_creases') && loopSet && (loopSet.size >= 2);
            if (isOpenEnd || isStripSeam) {
                const comma = k.indexOf(',');
                const u = parseInt(k.slice(0, comma), 10);
                const v = parseInt(k.slice(comma + 1), 10);
                vertOrthoCreaseCount[u]++;
                vertOrthoCreaseCount[v]++;
            }
        }

        // Register all midpoint vertices & curve neighbors for dual-chord split ring edges
        const splitEdgeMap = new Map();
        const splitEdgeList = [];
        const vertRingNeighbors = Array.from({ length: nV }, () => new Set());
        const vertMinSplitLen = new Float64Array(nV).fill(Infinity);
        const registerSplitEdge = (a, b) => {
            const key = getEdgeKey(a, b);
            let entry = splitEdgeMap.get(key);
            if (!entry) {
                const u = Math.min(a, b), v = Math.max(a, b);
                const sLen = currVerts[u].distanceTo(currVerts[v]);
                if (sLen < vertMinSplitLen[u]) vertMinSplitLen[u] = sLen;
                if (sLen < vertMinSplitLen[v]) vertMinSplitLen[v] = sLen;
                const mid = new V3().addVectors(currVerts[u], currVerts[v]).multiplyScalar(0.5);
                entry = { id: splitEdgeList.length, u, v, mid };
                splitEdgeMap.set(key, entry);
                splitEdgeList.push(entry);
                vertRingNeighbors[u].add(v);
                vertRingNeighbors[v].add(u);
            }
            return entry.id;
        };

        for (let qIdx = 0; qIdx < nQ; qIdx++) {
            const kind = quadSplitKind[qIdx];
            if (kind === 0) continue;
            const q = currQuads[qIdx];
            if (kind === 1 || kind === 3) {
                registerSplitEdge(q[0], q[1]);
                registerSplitEdge(q[2], q[3]);
            }
            if (kind === 2 || kind === 3) {
                registerSplitEdge(q[1], q[2]);
                registerSplitEdge(q[3], q[0]);
            }
        }

        const nSE = splitEdgeList.length;
        const newVerts = new Array(nV + nSE);

        // 1D cubic B-spline ring smoothing (1/8, 6/8, 1/8) with safe step guard matching longitudinal subdiv
        for (let vIdx = 0; vIdx < nV; vIdx++) {
            const nbrs = Array.from(vertRingNeighbors[vIdx]);
            const isPinned = vertOrthoCreaseCount[vIdx] > 0;
            if (isPinned || nbrs.length <= 1) {
                newVerts[vIdx] = currVerts[vIdx].clone();
            } else {
                let target;
                if (nbrs.length === 2) {
                    target = currVerts[vIdx].clone().multiplyScalar(0.75)
                        .addScaledVector(currVerts[nbrs[0]], 0.125)
                        .addScaledVector(currVerts[nbrs[1]], 0.125);
                } else {
                    const avgNbr = new V3();
                    for (let nb of nbrs) avgNbr.add(currVerts[nb]);
                    avgNbr.divideScalar(nbrs.length);
                    target = currVerts[vIdx].clone().multiplyScalar(0.75)
                        .addScaledVector(avgNbr, 0.25);
                }
                const delta = new V3().subVectors(target, currVerts[vIdx]);
                const dLen = delta.length();
                const limOrtho = Number.isFinite(vertMinOrthoLen[vIdx]) ? (0.42 * vertMinOrthoLen[vIdx]) : Infinity;
                const limSplit = Number.isFinite(vertMinSplitLen[vIdx]) ? (0.20 * vertMinSplitLen[vIdx]) : Infinity;
                const maxStep = Math.min(limOrtho, limSplit);
                if (dLen > maxStep && dLen > 1e-12) {
                    delta.multiplyScalar(maxStep / dLen);
                    newVerts[vIdx] = currVerts[vIdx].clone().add(delta);
                } else {
                    newVerts[vIdx] = target;
                }
            }
        }
        for (let eIdx = 0; eIdx < nSE; eIdx++) {
            newVerts[nV + eIdx] = splitEdgeList[eIdx].mid.clone();
        }

        const nextQuads = [];
        const nextLongColors = [];
        const nextRingColors = [];
        const nextLongParents = [];
        const nextRingParents = [];
        const nextIsCap = [];
        const quadChildPair = new Array(nQ).fill(null);

        for (let qIdx = 0; qIdx < nQ; qIdx++) {
            const q = currQuads[qIdx];
            const lCol = currLongColors[qIdx];
            const rCol = currRingColors[qIdx];
            const lPar = currLongParents[qIdx];
            const rPar = currRingParents[qIdx];
            const capFlag = currIsCap[qIdx] ? 1 : 0;
            const kind = quadSplitKind[qIdx];

            if (kind === 1) {
                const e01 = nV + splitEdgeMap.get(getEdgeKey(q[0], q[1])).id;
                const e23 = nV + splitEdgeMap.get(getEdgeKey(q[2], q[3])).id;
                const cA = nextQuads.length;
                nextQuads.push([q[0], e01, e23, q[3]]);
                const cB = nextQuads.length;
                nextQuads.push([e01, q[1], q[2], e23]);
                quadChildPair[qIdx] = [cA, cB];
                nextLongColors.push(lCol, lCol);
                nextRingColors.push(rCol, rCol);
                nextLongParents.push(lPar, lPar);
                nextRingParents.push(rPar, rPar);
                nextIsCap.push(capFlag, capFlag);
            } else if (kind === 2) {
                // Canonicalize child quads so split ring edges lie on sides 0 & 2 and ring-walk edges on sides 1 & 3
                const e12 = nV + splitEdgeMap.get(getEdgeKey(q[1], q[2])).id;
                const e30 = nV + splitEdgeMap.get(getEdgeKey(q[3], q[0])).id;
                const cA = nextQuads.length;
                nextQuads.push([q[1], e12, e30, q[0]]);
                const cB = nextQuads.length;
                nextQuads.push([e12, q[2], q[3], e30]);
                quadChildPair[qIdx] = [cA, cB];
                nextLongColors.push(lCol, lCol);
                nextRingColors.push(rCol, rCol);
                nextLongParents.push(lPar, lPar);
                nextRingParents.push(rPar, rPar);
                nextIsCap.push(capFlag, capFlag);
            } else if (kind === 3) {
                // Subdivide cap / self-crossing junction quad into 4 pure quads around its centroid
                const fp = new V3()
                    .add(currVerts[q[0]]).add(currVerts[q[1]])
                    .add(currVerts[q[2]]).add(currVerts[q[3]])
                    .multiplyScalar(0.25);
                const fpIdx = newVerts.length;
                newVerts.push(fp);
                const e0 = nV + splitEdgeMap.get(getEdgeKey(q[0], q[1])).id;
                const e1 = nV + splitEdgeMap.get(getEdgeKey(q[1], q[2])).id;
                const e2 = nV + splitEdgeMap.get(getEdgeKey(q[2], q[3])).id;
                const e3 = nV + splitEdgeMap.get(getEdgeKey(q[3], q[0])).id;
                nextQuads.push(
                    [q[0], e0, fpIdx, e3],
                    [e0, q[1], e1, fpIdx],
                    [fpIdx, e1, q[2], e2],
                    [e3, fpIdx, e2, q[3]]
                );
                nextLongColors.push(lCol, lCol, lCol, lCol);
                nextRingColors.push(rCol, rCol, rCol, rCol);
                nextLongParents.push(lPar, lPar, lPar, lPar);
                nextRingParents.push(rPar, rPar, rPar, rPar);
                nextIsCap.push(capFlag, capFlag, capFlag, capFlag);
            } else {
                nextQuads.push([...q]);
                nextLongColors.push(lCol);
                nextRingColors.push(rCol);
                nextLongParents.push(lPar);
                nextRingParents.push(rPar);
                nextIsCap.push(capFlag);
            }
        }

        if (currBarGrids) {
            currBarGrids = currBarGrids.map(grid => {
                if (!grid) return null;
                return grid.map(row => {
                    const nextRow = [];
                    for (let c = 0; c < row.length; c++) {
                        const pair = quadChildPair[row[c]];
                        if (pair) nextRow.push(pair[0], pair[1]);
                    }
                    return nextRow;
                });
            });
        }

        currVerts = newVerts;
        currQuads = nextQuads;
        currLongColors = nextLongColors;
        currRingColors = nextRingColors;
        currLongParents = nextLongParents;
        currRingParents = nextRingParents;
        currIsCap = nextIsCap;
    }

    const r6 = (val) => Math.round(val * 1e6) / 1e6;
    for (let i = 0; i < currVerts.length; i++) {
        currVerts[i].x = r6(currVerts[i].x);
        currVerts[i].y = r6(currVerts[i].y);
        currVerts[i].z = r6(currVerts[i].z);
    }

    const verificationTriangles = [];
    for (let q of currQuads) verificationTriangles.push(q[0], q[1], q[2], q[0], q[2], q[3]);
    for (let t of currTris) verificationTriangles.push(t[0], t[1], t[2]);
    const verification = verifyManifold(currVerts, verificationTriangles);

    let trunkCount = 0;
    for (let i = 0; i < currIsCap.length; i++) if (!currIsCap[i]) trunkCount++;

    solidData.vertices = currVerts;
    solidData.quads = currQuads;
    solidData.triangles = currTris;
    solidData.verification = verification;
    solidData.quadIsCap = Uint8Array.from(currIsCap);
    solidData.barTubeQuadCount = trunkCount;
    if (currBarGrids) solidData.barQuadGrids = currBarGrids;
    solidData.ringSubdivLevels = (solidData.ringSubdivLevels || 0) + nLevels;
    solidData.quadInheritedColors = {
        longitudinal: Int32Array.from(currLongColors),
        ring: Int32Array.from(currRingColors)
    };
    solidData.quadParentLoopIds = {
        longitudinal: Int32Array.from(currLongParents),
        ring: Int32Array.from(currRingParents)
    };

    walkMeshFaceLoops(currVerts, currQuads, solidData.directionMode || 'longitudinal', { solidData });

    if (reoptimizePQ) {
        optimizeFaceLoopsToPQ(solidData, options.pqIterations || 64, options.pqCoupling || 0.65, options);
    } else {
        solidData.planarity = computeMeshPlanarityStats(currVerts, currQuads);
        solidData.signedVolume = computeSignedMeshVolume(currVerts, currQuads, currTris);
    }
    return solidData;
}

// ============================================================
//  100% PURE-QUAD BISECTOR-STITCHED NODE & TUBE SOLIDIFIER
// ============================================================

export {
    applyCatmullClarkToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips,
    applyRingOnlySubdivisionToPQStrips
};

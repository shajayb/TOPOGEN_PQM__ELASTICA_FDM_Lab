/**
 * WFC-FDM Foundry — Core Module: 3D Mesh Curve-Skeleton Extraction (core/mesh_skeletonizer.mjs)
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 * STRICT AIR-GAP: Zero imports from verifier/.
 *
 * Literature & Algorithmic Foundation:
 *   1. Au, O. K.-C., Tai, C.-L., Chu, H.-K., Cohen-Or, D., & Lee, T.-Y. (SIGGRAPH 2008).
 *      "Skeleton Extraction by Mesh Contraction" — Iterative constrained Laplacian smoothing
 *      (W_L^2 L^T L + W_H^2) V' = W_H^2 V followed by 1D connectivity surgery & medial centering.
 *   2. Tagliasacchi, A., Alhashim, I., Olson, M., & Zhang, H. (SGP 2012).
 *      "Mean Curvature Skeletons" — Regularized curvature-flow contraction avoiding pinch singularities.
 *   3. Bærentzen, J. A., & Rotenberg, E. (2021).
 *      "Skeletonization via Local Separators" — Graph-theoretic ring / cuff separator condensation,
 *      adapted here with open-boundary cuff loop decomposition for architectural WFC tubular tiles.
 */

import { solveLinearSystem } from './math_tiles.mjs';

function dist3(a, b) {
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
}

function norm3(a) {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function weldInputMesh(rawVerts, rawFaces, tol = 1e-5) {
    const invTol = 1.0 / Math.max(tol, 1e-9);
    const map = new Map();
    const verts = [];
    const remap = new Int32Array(rawVerts.length);
    for (let i = 0; i < rawVerts.length; i++) {
        const p = rawVerts[i];
        const x = Array.isArray(p) ? p[0] : p.x;
        const y = Array.isArray(p) ? p[1] : p.y;
        const z = Array.isArray(p) ? p[2] : p.z;
        const k = `${Math.round(x * invTol)}_${Math.round(y * invTol)}_${Math.round(z * invTol)}`;
        let idx = map.get(k);
        if (idx === undefined) {
            idx = verts.length;
            map.set(k, idx);
            verts.push([Number(x), Number(y), Number(z)]);
        }
        remap[i] = idx;
    }
    const faces = [];
    for (const f of rawFaces) {
        if (!Array.isArray(f) || f.length < 3) continue;
        const mf = [];
        for (let i = 0; i < f.length; i++) {
            const vi = remap[f[i]];
            if (mf.length === 0 || mf[mf.length - 1] !== vi) mf.push(vi);
        }
        if (mf.length > 1 && mf[0] === mf[mf.length - 1]) mf.pop();
        const uniq = new Set(mf);
        if (mf.length >= 3 && uniq.size >= 3) faces.push(mf);
    }
    return { verts, faces };
}

/**
 * Open-boundary-preserving Catmull-Clark subdivision so coarse tubular cages
 * (e.g. 24-vertex quad cages) gain interior cross-sectional vertex rings for contraction.
 */
export function subdivideMeshBoundaryPreserving(inVerts, inFaces, iterations = 1) {
    let verts = inVerts.map(p => [p[0], p[1], p[2]]);
    let faces = inFaces.map(f => f.slice());
    const iters = Math.max(0, Math.min(3, Math.round(iterations)));

    for (let it = 0; it < iters; it++) {
        if (verts.length === 0 || faces.length === 0) break;
        const facePts = faces.map(f => {
            let sx = 0, sy = 0, sz = 0;
            for (const vi of f) { sx += verts[vi][0]; sy += verts[vi][1]; sz += verts[vi][2]; }
            const inv = 1.0 / f.length;
            return [sx * inv, sy * inv, sz * inv];
        });

        const edgeMap = new Map();
        const vFaces = Array.from({ length: verts.length }, () => []);
        for (let fi = 0; fi < faces.length; fi++) {
            const f = faces[fi];
            for (let j = 0; j < f.length; j++) {
                const u = f[j], v = f[(j + 1) % f.length];
                vFaces[u].push(fi);
                const a = Math.min(u, v), b = Math.max(u, v);
                const key = `${a}_${b}`;
                let e = edgeMap.get(key);
                if (!e) { e = { a, b, faces: [], idx: -1, pt: null }; edgeMap.set(key, e); }
                e.faces.push(fi);
            }
        }

        const vBoundaryNbrs = Array.from({ length: verts.length }, () => []);
        const vAllMidpoints = Array.from({ length: verts.length }, () => []);
        for (const e of edgeMap.values()) {
            const pa = verts[e.a], pb = verts[e.b];
            const mid = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5, (pa[2] + pb[2]) * 0.5];
            vAllMidpoints[e.a].push(mid);
            vAllMidpoints[e.b].push(mid);
            if (e.faces.length === 1) {
                e.pt = mid;
                vBoundaryNbrs[e.a].push(e.b);
                vBoundaryNbrs[e.b].push(e.a);
            } else {
                let sx = pa[0] + pb[0], sy = pa[1] + pb[1], sz = pa[2] + pb[2];
                for (const fi of e.faces) {
                    sx += facePts[fi][0]; sy += facePts[fi][1]; sz += facePts[fi][2];
                }
                const denom = 2 + e.faces.length;
                e.pt = [sx / denom, sy / denom, sz / denom];
            }
        }

        const newVerts = new Array(verts.length);
        for (let vi = 0; vi < verts.length; vi++) {
            const p = verts[vi];
            const bNbrs = vBoundaryNbrs[vi];
            if (bNbrs.length >= 2) {
                if (bNbrs.length === 2) {
                    const p0 = verts[bNbrs[0]], p1 = verts[bNbrs[1]];
                    newVerts[vi] = [
                        0.75 * p[0] + 0.125 * (p0[0] + p1[0]),
                        0.75 * p[1] + 0.125 * (p0[1] + p1[1]),
                        0.75 * p[2] + 0.125 * (p0[2] + p1[2])
                    ];
                } else {
                    // Pinch / corner vertex where >= 2 boundary loops kiss: keep exact
                    newVerts[vi] = [p[0], p[1], p[2]];
                }
            } else {
                const incF = vFaces[vi];
                const mids = vAllMidpoints[vi];
                const n = incF.length;
                if (n >= 3 && mids.length >= 3) {
                    let fx = 0, fy = 0, fz = 0;
                    for (const fi of incF) { fx += facePts[fi][0]; fy += facePts[fi][1]; fz += facePts[fi][2]; }
                    fx /= n; fy /= n; fz /= n;
                    let rx = 0, ry = 0, rz = 0;
                    for (const m of mids) { rx += m[0]; ry += m[1]; rz += m[2]; }
                    rx /= mids.length; ry /= mids.length; rz /= mids.length;
                    newVerts[vi] = [
                        (fx + 2 * rx + (n - 3) * p[0]) / n,
                        (fy + 2 * ry + (n - 3) * p[1]) / n,
                        (fz + 2 * rz + (n - 3) * p[2]) / n
                    ];
                } else {
                    newVerts[vi] = [p[0], p[1], p[2]];
                }
            }
        }

        const facePtOffset = newVerts.length;
        for (const fp of facePts) newVerts.push(fp);
        for (const e of edgeMap.values()) {
            e.idx = newVerts.length;
            newVerts.push(e.pt);
        }

        const newFaces = [];
        for (let fi = 0; fi < faces.length; fi++) {
            const f = faces[fi];
            const fpIdx = facePtOffset + fi;
            for (let j = 0; j < f.length; j++) {
                const prev = f[(j + 1 + f.length - 2) % f.length];
                const curr = f[j];
                const next = f[(j + 1) % f.length];
                const ePrev = edgeMap.get(`${Math.min(prev, curr)}_${Math.max(prev, curr)}`).idx;
                const eNext = edgeMap.get(`${Math.min(curr, next)}_${Math.max(curr, next)}`).idx;
                newFaces.push([curr, eNext, fpIdx, ePrev]);
            }
        }

        verts = newVerts;
        faces = newFaces;
    }

    return { verts, faces };
}

/**
 * Extract minimal closed naked-boundary loops (port cuffs), disambiguating figure-8
 * pinch vertices by walking around surface face corners incident to the boundary.
 */
export function extractBoundaryPortLoops(verts, faces, snapFaceTol = 0.03) {
    const undirectedCount = new Map();
    const directedFace = new Map();

    for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        for (let j = 0; j < f.length; j++) {
            const u = f[j], v = f[(j + 1) % f.length];
            const key = `${Math.min(u, v)}_${Math.max(u, v)}`;
            undirectedCount.set(key, (undirectedCount.get(key) || 0) + 1);
            directedFace.set(`${u}_${v}`, { fi, u, v });
        }
    }

    // Build face adjacency across interior edges so we can trace around each vertex fan
    const vIncFaces = Array.from({ length: verts.length }, () => []);
    for (let fi = 0; fi < faces.length; fi++) {
        for (const vi of faces[fi]) vIncFaces[vi].push(fi);
    }

    const boundaryDirected = [];
    const outgoingAtVert = new Map(); // v -> list of boundary edge indices leaving v
    for (let fi = 0; fi < faces.length; fi++) {
        const f = faces[fi];
        for (let j = 0; j < f.length; j++) {
            const u = f[j], v = f[(j + 1) % f.length];
            const key = `${Math.min(u, v)}_${Math.max(u, v)}`;
            if (undirectedCount.get(key) === 1) {
                const idx = boundaryDirected.length;
                boundaryDirected.push({ u, v, fi, used: false });
                if (!outgoingAtVert.has(u)) outgoingAtVert.set(u, []);
                outgoingAtVert.get(u).push(idx);
            }
        }
    }

    if (boundaryDirected.length === 0) return [];

    // Helper: check if two faces belong to the same surface fan around vertex `pivot`
    const sameCornerFan = (pivot, fStart, fEnd) => {
        if (fStart === fEnd) return true;
        const inc = vIncFaces[pivot];
        if (inc.length <= 2) return true;
        const visited = new Set([fStart]);
        const stack = [fStart];
        while (stack.length > 0) {
            const cur = stack.pop();
            if (cur === fEnd) return true;
            const fc = faces[cur];
            // Collect the two edges of `cur` incident to `pivot`
            const idxP = fc.indexOf(pivot);
            if (idxP === -1) continue;
            const nPrev = fc[(idxP - 1 + fc.length) % fc.length];
            const nNext = fc[(idxP + 1) % fc.length];
            for (const otherFi of inc) {
                if (visited.has(otherFi)) continue;
                const fo = faces[otherFi];
                if (fo.includes(nPrev) || fo.includes(nNext)) {
                    visited.add(otherFi);
                    stack.push(otherFi);
                }
            }
        }
        return false;
    };

    const loops = [];
    for (let i = 0; i < boundaryDirected.length; i++) {
        if (boundaryDirected[i].used) continue;
        const loopVerts = [];
        let curIdx = i;
        let guard = 0;
        while (curIdx !== -1 && !boundaryDirected[curIdx].used && guard++ <= boundaryDirected.length + 2) {
            const seg = boundaryDirected[curIdx];
            seg.used = true;
            loopVerts.push(seg.u);
            const nextV = seg.v;
            if (nextV === boundaryDirected[i].u) break;

            const cands = (outgoingAtVert.get(nextV) || []).filter(ci => !boundaryDirected[ci].used);
            if (cands.length === 0) break;
            if (cands.length === 1) {
                curIdx = cands[0];
            } else {
                // Pinch vertex (degree >= 4 on boundary): stay on the same surface fan around nextV!
                const fanMatches = cands.filter(ci => sameCornerFan(nextV, seg.fi, boundaryDirected[ci].fi));
                const pool = fanMatches.length > 0 ? fanMatches : cands;
                const inDir = norm3(sub3(verts[seg.v], verts[seg.u]));
                let bestCi = pool[0], bestDot = -Infinity;
                for (const ci of pool) {
                    const outDir = norm3(sub3(verts[boundaryDirected[ci].v], verts[boundaryDirected[ci].u]));
                    const d = dot3(inDir, outDir);
                    if (d > bestDot) { bestDot = d; bestCi = ci; }
                }
                curIdx = bestCi;
            }
        }
        if (loopVerts.length >= 3) {
            let cx = 0, cy = 0, cz = 0;
            for (const vi of loopVerts) {
                cx += verts[vi][0]; cy += verts[vi][1]; cz += verts[vi][2];
            }
            cx /= loopVerts.length; cy /= loopVerts.length; cz /= loopVerts.length;
            if (Math.abs(cx - 0.5) <= snapFaceTol) cx = 0.5;
            else if (Math.abs(cx + 0.5) <= snapFaceTol) cx = -0.5;
            if (Math.abs(cy - 0.5) <= snapFaceTol) cy = 0.5;
            else if (Math.abs(cy + 0.5) <= snapFaceTol) cy = -0.5;
            if (Math.abs(cz - 0.5) <= snapFaceTol) cz = 0.5;
            else if (Math.abs(cz + 0.5) <= snapFaceTol) cz = -0.5;

            loops.push({
                vertices: loopVerts,
                centroid: [cx, cy, cz]
            });
        }
    }
    return loops;
}

function triangulateFaces(faces) {
    const tris = [];
    for (const f of faces) {
        if (f.length === 3) tris.push([f[0], f[1], f[2]]);
        else if (f.length >= 4) {
            for (let k = 1; k < f.length - 1; k++) tris.push([f[0], f[k], f[k + 1]]);
        }
    }
    return tris;
}

function computeOneRingAreas(verts, tris) {
    const areas = new Float64Array(verts.length);
    for (const [i, j, k] of tris) {
        const ab = sub3(verts[j], verts[i]);
        const ac = sub3(verts[k], verts[i]);
        const c = cross3(ab, ac);
        const triArea = 0.5 * Math.hypot(c[0], c[1], c[2]);
        const third = triArea / 3.0;
        areas[i] += third;
        areas[j] += third;
        areas[k] += third;
    }
    return areas;
}

function buildCotangentLaplacian(verts, tris) {
    const n = verts.length;
    const nbrWeights = Array.from({ length: n }, () => new Map());
    const addW = (u, v, w) => {
        const clamped = Math.max(0.05, Math.min(25.0, w));
        nbrWeights[u].set(v, (nbrWeights[u].get(v) || 0) + clamped);
        nbrWeights[v].set(u, (nbrWeights[v].get(u) || 0) + clamped);
    };

    for (const [i0, i1, i2] of tris) {
        const p0 = verts[i0], p1 = verts[i1], p2 = verts[i2];
        const cotAt = (pa, pb, pc) => {
            const u = sub3(pb, pa), v = sub3(pc, pa);
            const cr = cross3(u, v);
            const sinA = Math.hypot(cr[0], cr[1], cr[2]);
            if (sinA < 1e-9) return 0.5;
            return 0.5 * (dot3(u, v) / sinA);
        };
        addW(i1, i2, cotAt(p0, p1, p2));
        addW(i2, i0, cotAt(p1, p2, p0));
        addW(i0, i1, cotAt(p2, p0, p1));
    }

    // Normalize each row so diagonal is -1 and off-diagonal sums to +1 (scale-invariant umbrella/cotan)
    const rows = Array.from({ length: n }, () => new Map());
    for (let i = 0; i < n; i++) {
        let sum = 0;
        for (const w of nbrWeights[i].values()) sum += w;
        if (sum < 1e-12) continue;
        rows[i].set(i, -1.0);
        for (const [j, w] of nbrWeights[i]) {
            rows[i].set(j, w / sum);
        }
    }
    return rows;
}

/**
 * Stage 1A (Bærentzen & Rotenberg, ACM TOG 2021; Usai et al., SIGGRAPH Asia 2015):
 * Exact Cross-Sectional Quad-Band Separator Condensation for tubular quad meshes
 * (e.g. H-frames with T-junctions, bifurcating Y-columns, 6-way crosses, & solidified PQ tubes).
 * Returns null when < 55% of faces belong to closed circumferential quad bands (e.g. open canopies
 * like scm_pod, minimal surfaces like Batwing, or triangulated meshes), falling through to Laplacian contraction.
 */
function extractTubularBandSkeleton(verts, faces, inUnitCube = false, bboxDiag = 1.0, options = {}) {
    const nV = verts.length;
    const nF = faces.length;
    if (nF < 3) return null;

    const eKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
    const edgeToFaces = new Map();
    for (let fi = 0; fi < nF; fi++) {
        const f = faces[fi];
        for (let j = 0; j < f.length; j++) {
            const k = eKey(f[j], f[(j + 1) % f.length]);
            if (!edgeToFaces.has(k)) edgeToFaces.set(k, []);
            edgeToFaces.get(k).push({ fi, side: j });
        }
    }

    const visited = new Set();
    const candBands = [];
    for (let fi = 0; fi < nF; fi++) {
        if (faces[fi].length !== 4) continue;
        for (let dir = 0; dir < 2; dir++) {
            const startState = `${fi}_${dir}`;
            if (visited.has(startState)) continue;
            const chain = [];
            let curFi = fi, curDir = dir, prevFi = -1;
            let isClosed = false, valid = true;
            const seenFaces = new Set();

            while (true) {
                visited.add(`${curFi}_${curDir}`);
                chain.push({ fi: curFi, dir: curDir });
                seenFaces.add(curFi);
                const f = faces[curFi];
                const stepSides = curDir === 0 ? [1, 3] : [0, 2];
                let nextInfo = null;
                for (const s of stepSides) {
                    const adj = edgeToFaces.get(eKey(f[s], f[(s + 1) % 4])) || [];
                    if (adj.length !== 2) { valid = false; break; }
                    const other = adj[0].fi === curFi ? adj[1] : adj[0];
                    if (other.fi === prevFi && chain.length > 1) continue;
                    if (faces[other.fi].length !== 4) { valid = false; break; }
                    nextInfo = other;
                    break;
                }
                if (!valid || !nextInfo) break;
                if (nextInfo.fi === fi) {
                    if (((nextInfo.side % 2 === 1) ? 0 : 1) === dir) isClosed = true;
                    break;
                }
                if (seenFaces.has(nextInfo.fi)) { valid = false; break; }
                prevFi = curFi;
                curFi = nextInfo.fi;
                curDir = (nextInfo.side % 2 === 1) ? 0 : 1;
            }

            if (valid && isClosed && chain.length >= 3 && chain.length <= 16) {
                let ringPerim = 0, axialWidth = 0;
                let rx0 = Infinity, ry0 = Infinity, rz0 = Infinity;
                let rx1 = -Infinity, ry1 = -Infinity, rz1 = -Infinity;
                for (const { fi: qFi, dir: qDir } of chain) {
                    const fq = faces[qFi];
                    const rS = qDir === 0 ? [0, 2] : [1, 3];
                    const aS = qDir === 0 ? [1, 3] : [0, 2];
                    ringPerim += 0.5 * (
                        dist3(verts[fq[rS[0]]], verts[fq[(rS[0] + 1) % 4]]) +
                        dist3(verts[fq[rS[1]]], verts[fq[(rS[1] + 1) % 4]])
                    );
                    axialWidth += 0.5 * (
                        dist3(verts[fq[aS[0]]], verts[fq[(aS[0] + 1) % 4]]) +
                        dist3(verts[fq[aS[1]]], verts[fq[(aS[1] + 1) % 4]])
                    );
                    // Track span of ring side rS[0] to ensure this is a compact local cross-section separator
                    for (const vi of [fq[rS[0]], fq[(rS[0] + 1) % 4]]) {
                        const pv = verts[vi];
                        if (pv[0] < rx0) rx0 = pv[0]; if (pv[0] > rx1) rx1 = pv[0];
                        if (pv[1] < ry0) ry0 = pv[1]; if (pv[1] > ry1) ry1 = pv[1];
                        if (pv[2] < rz0) rz0 = pv[2]; if (pv[2] > rz1) rz1 = pv[2];
                    }
                }
                axialWidth /= chain.length;
                const ringSpan = Math.hypot(rx1 - rx0, ry1 - ry0, rz1 - rz0);
                if (ringPerim <= 1.85 * bboxDiag && ringSpan <= 0.62 * bboxDiag) {
                    candBands.push({ chain, ringPerim, axialWidth });
                }
            }
        }
    }

    // Sort ascending by circumference so meridian cross-section rings win over longitudinal torus loops
    candBands.sort((a, b) => a.ringPerim - b.ringPerim);
    const faceUsed = new Uint8Array(nF);
    const chosenBands = [];
    let coveredFaces = 0;
    for (const b of candBands) {
        if (b.chain.some(c => faceUsed[c.fi])) continue;
        for (const c of b.chain) faceUsed[c.fi] = 1;
        chosenBands.push(b);
        coveredFaces += b.chain.length;
    }

    if (coveredFaces < 0.55 * nF || (chosenBands.length < 2 && nF <= 6)) return null;

    const parent = Int32Array.from({ length: nV }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; };

    const portVerts = new Set();
    for (const [k, inc] of edgeToFaces) {
        if (inc.length === 1) {
            const [sA, sB] = k.split('_');
            portVerts.add(Number(sA));
            portVerts.add(Number(sB));
        }
    }

    // 1. Condense all circumferential ring edges of each tubular band
    for (const b of chosenBands) {
        for (const { fi, dir } of b.chain) {
            const fq = faces[fi];
            const rS = dir === 0 ? [0, 2] : [1, 3];
            for (const s of rS) union(fq[s], fq[(s + 1) % 4]);
        }
    }

    // 2. Condense interior hub / cap faces (!faceUsed) that contain no open boundary vertices
    for (let fi = 0; fi < nF; fi++) {
        if (faceUsed[fi]) continue;
        const f = faces[fi];
        if (!f.some(vi => portVerts.has(vi))) {
            for (let j = 1; j < f.length; j++) union(f[0], f[j]);
        }
    }

    const compVerts = new Map();
    for (let vi = 0; vi < nV; vi++) {
        const r = find(vi);
        if (!compVerts.has(r)) compVerts.set(r, []);
        compVerts.get(r).push(vi);
    }

    const snapTol = options.snapFaceTol ?? 0.035;
    const repToIdx = new Map();
    const nodes = [];
    const isPortNode = [];
    for (const [r, vList] of compVerts) {
        let x0 = Infinity, y0 = Infinity, z0 = Infinity;
        let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
        let allPort = vList.length >= 2;
        for (const vi of vList) {
            const p = verts[vi];
            if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0];
            if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1];
            if (p[2] < z0) z0 = p[2]; if (p[2] > z1) z1 = p[2];
            if (!portVerts.has(vi)) allPort = false;
        }
        // Mid-box center is exact on symmetric polygonal tubes AND invariant to 1-sided T-junction miter splits
        let cx = 0.5 * (x0 + x1), cy = 0.5 * (y0 + y1), cz = 0.5 * (z0 + z1);
        if (inUnitCube && allPort) {
            if (Math.abs(cx - 0.5) <= snapTol) cx = 0.5; else if (Math.abs(cx + 0.5) <= snapTol) cx = -0.5;
            if (Math.abs(cy - 0.5) <= snapTol) cy = 0.5; else if (Math.abs(cy + 0.5) <= snapTol) cy = -0.5;
            if (Math.abs(cz - 0.5) <= snapTol) cz = 0.5; else if (Math.abs(cz + 0.5) <= snapTol) cz = -0.5;
        }
        repToIdx.set(r, nodes.length);
        nodes.push([cx, cy, cz]);
        isPortNode.push(allPort);
    }

    const skelEdgeSet = new Set();
    let curE = [];
    for (const b of chosenBands) {
        for (const { fi, dir } of b.chain) {
            const fq = faces[fi];
            const aS = dir === 0 ? [1, 3] : [0, 2];
            for (const s of aS) {
                const u = repToIdx.get(find(fq[s])), v = repToIdx.get(find(fq[(s + 1) % 4]));
                if (u !== undefined && v !== undefined && u !== v) {
                    const k = eKey(u, v);
                    if (!skelEdgeSet.has(k)) { skelEdgeSet.add(k); curE.push([Math.min(u, v), Math.max(u, v)]); }
                }
            }
        }
    }
    for (let fi = 0; fi < nF; fi++) {
        if (faceUsed[fi]) continue;
        const f = faces[fi];
        for (let j = 0; j < f.length; j++) {
            const u = repToIdx.get(find(f[j])), v = repToIdx.get(find(f[(j + 1) % f.length]));
            if (u !== undefined && v !== undefined && u !== v) {
                const k = eKey(u, v);
                if (!skelEdgeSet.has(k)) { skelEdgeSet.add(k); curE.push([Math.min(u, v), Math.max(u, v)]); }
            }
        }
    }

    if (curE.length === 0) return null;

    // Simplify collinear degree-2 interior ring nodes while preserving T/Y junctions, ports, & 3-cycles
    const cosThresh = options.collinearCos !== undefined ? options.collinearCos : 0.985;
    const buildAdj = (n, eL) => {
        const a = Array.from({ length: n }, () => new Set());
        for (const [u, v] of eL) { a[u].add(v); a[v].add(u); }
        return a;
    };
    let simplified = true;
    while (simplified && curE.length > 1) {
        simplified = false;
        const adj = buildAdj(nodes.length, curE);
        for (let i = 0; i < nodes.length; i++) {
            if (isPortNode[i] || adj[i].size !== 2) continue;
            const [n0, n1] = [...adj[i]];
            if (adj[n0].has(n1)) continue;
            const d0 = norm3(sub3(nodes[i], nodes[n0]));
            const d1 = norm3(sub3(nodes[n1], nodes[i]));
            if (dot3(d0, d1) >= cosThresh) {
                curE = curE.filter(([u, v]) => u !== i && v !== i);
                curE.push([Math.min(n0, n1), Math.max(n0, n1)]);
                simplified = true;
                break;
            }
        }
    }

    const usedMap = new Int32Array(nodes.length).fill(-1);
    const finalVerts = [];
    const finalPorts = [];
    const finalEdges = [];
    for (const [u, v] of curE) {
        if (usedMap[u] === -1) { usedMap[u] = finalVerts.length; finalVerts.push(nodes[u]); if (isPortNode[u]) finalPorts.push(usedMap[u]); }
        if (usedMap[v] === -1) { usedMap[v] = finalVerts.length; finalVerts.push(nodes[v]); if (isPortNode[v]) finalPorts.push(usedMap[v]); }
        finalEdges.push([usedMap[u], usedMap[v]]);
    }

    return {
        vertices: finalVerts,
        edges: finalEdges,
        ports: finalPorts,
        portCount: finalPorts.length,
        method: 'tubular-band-separators-v2'
    };
}

/**
 * Extract 1D curve-skeleton graph { vertices, edges, ports, method } from an arbitrary
 * coarse or fine 3D tubular/branching/canopy mesh (open-cuff WFC module, H/T-junction pipe, or genus-g pod).
 */
export function extractSkeletalGraphFromMesh(rawVerts, rawFaces, options = {}) {
    const welded = weldInputMesh(rawVerts, rawFaces, options.weldTol || 1e-5);
    if (welded.verts.length === 0 || welded.faces.length === 0) {
        return { vertices: [], edges: [], ports: [], method: 'laplacian-contraction-v2' };
    }

    // Check raw welded bounding box for unit-voxel detection before attempting tubular quad-band condensation
    let wMinX = Infinity, wMinY = Infinity, wMinZ = Infinity;
    let wMaxX = -Infinity, wMaxY = -Infinity, wMaxZ = -Infinity;
    for (const p of welded.verts) {
        if (p[0] < wMinX) wMinX = p[0]; if (p[0] > wMaxX) wMaxX = p[0];
        if (p[1] < wMinY) wMinY = p[1]; if (p[1] > wMaxY) wMaxY = p[1];
        if (p[2] < wMinZ) wMinZ = p[2]; if (p[2] > wMaxZ) wMaxZ = p[2];
    }
    const wMaxSpan = Math.max(1e-4, wMaxX - wMinX, wMaxY - wMinY, wMaxZ - wMinZ);
    const wBboxDiag = Math.max(1e-4, Math.hypot(wMaxX - wMinX, wMaxY - wMinY, wMaxZ - wMinZ));
    const weldedInUnitCube = Math.max(
        Math.abs(wMinX), Math.abs(wMaxX),
        Math.abs(wMinY), Math.abs(wMaxY),
        Math.abs(wMinZ), Math.abs(wMaxZ)
    ) <= 0.56 && wMaxSpan >= 0.70;

    if (options.forceContraction !== true) {
        const bandSkel = extractTubularBandSkeleton(welded.verts, welded.faces, weldedInUnitCube, wBboxDiag, options);
        if (bandSkel && bandSkel.edges.length > 0) {
            return bandSkel;
        }
    }

    // Adaptive boundary-preserving refinement for coarse cages so tubular necks have interior rings
    const targetSubdiv = options.preSubdiv !== undefined
        ? options.preSubdiv
        : (welded.verts.length < 36 ? 2 : (welded.verts.length < 110 ? 1 : 0));
    const refined = targetSubdiv > 0
        ? subdivideMeshBoundaryPreserving(welded.verts, welded.faces, targetSubdiv)
        : welded;

    const surfVerts = refined.verts.map(p => [p[0], p[1], p[2]]);
    const faces = refined.faces;
    const nSurf = surfVerts.length;

    // Bounding box & span analysis
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const p of surfVerts) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
    const spanX = maxX - minX, spanY = maxY - minY, spanZ = maxZ - minZ;
    const maxAxisSpan = Math.max(1e-4, spanX, spanY, spanZ);
    const bboxDiag = Math.max(1e-4, Math.hypot(spanX, spanY, spanZ));
    const inUnitCube = Math.max(
        Math.abs(minX), Math.abs(maxX),
        Math.abs(minY), Math.abs(maxY),
        Math.abs(minZ), Math.abs(maxZ)
    ) <= 0.56 && maxAxisSpan >= 0.70;

    // Stage 1: Open-boundary port detection (handles multi-cuff tubes, minimal surfaces, & arched pods like scm_pod)
    const rawLoops = extractBoundaryPortLoops(surfVerts, faces, inUnitCube ? (options.snapFaceTol ?? 0.035) : 0.0);
    const portLoops = [];

    const loopSpan = (vIdxs) => {
        let lx0 = Infinity, ly0 = Infinity, lz0 = Infinity, lx1 = -Infinity, ly1 = -Infinity, lz1 = -Infinity;
        for (const vi of vIdxs) {
            const p = surfVerts[vi];
            if (p[0] < lx0) lx0 = p[0]; if (p[0] > lx1) lx1 = p[0];
            if (p[1] < ly0) ly0 = p[1]; if (p[1] > ly1) ly1 = p[1];
            if (p[2] < lz0) lz0 = p[2]; if (p[2] > lz1) lz1 = p[2];
        }
        return Math.hypot(lx1 - lx0, ly1 - ly0, lz1 - lz0);
    };

    for (const lp of rawLoops) {
        const span = loopSpan(lp.vertices);
        if (rawLoops.length >= 2 && span < 0.62 * bboxDiag) {
            // Compact tubular cuff opening (e.g. square/circular tube end)
            portLoops.push(lp);
        } else {
            // Single-perimeter shell / minimal surface (e.g. scm_pod, Batwing, Gyroid):
            // Pin ONLY contiguous boundary runs that touch unit-voxel faces (±0.50) or dominant span planes,
            // leaving cantilevered lobes and internal arch loops free to contract onto their medial axis!
            const facePlanes = inUnitCube
                ? [
                    { axis: 0, val:  0.5, snap:  0.5 },
                    { axis: 0, val: -0.5, snap: -0.5 },
                    { axis: 1, val:  0.5, snap:  0.5 },
                    { axis: 1, val: -0.5, snap: -0.5 },
                    { axis: 2, val:  0.5, snap:  0.5 },
                    { axis: 2, val: -0.5, snap: -0.5 }
                ]
                : [
                    { axis: 0, val: maxX, snap: maxX, span: spanX },
                    { axis: 0, val: minX, snap: minX, span: spanX },
                    { axis: 1, val: maxY, snap: maxY, span: spanY },
                    { axis: 1, val: minY, snap: minY, span: spanY },
                    { axis: 2, val: maxZ, snap: maxZ, span: spanZ },
                    { axis: 2, val: minZ, snap: minZ, span: spanZ }
                ].filter(fp => fp.span >= 0.90 * maxAxisSpan);

            const fTol = inUnitCube ? 0.042 : (0.045 * maxAxisSpan);
            const m = lp.vertices.length;
            let extractedFacePorts = 0;
            for (const fp of facePlanes) {
                const onFace = lp.vertices.map(vi => Math.abs(surfVerts[vi][fp.axis] - fp.val) <= fTol);
                const visited = new Uint8Array(m);
                for (let s = 0; s < m; s++) {
                    if (!onFace[s] || visited[s]) continue;
                    let start = s;
                    while (onFace[(start - 1 + m) % m] && !visited[(start - 1 + m) % m]) {
                        start = (start - 1 + m) % m;
                        if (start === s) break;
                    }
                    const run = [];
                    let cur = start;
                    while (onFace[cur] && !visited[cur]) {
                        visited[cur] = 1;
                        run.push(lp.vertices[cur]);
                        cur = (cur + 1) % m;
                    }
                    if (run.length >= 1) {
                        let cx = 0, cy = 0, cz = 0;
                        for (const vi of run) { cx += surfVerts[vi][0]; cy += surfVerts[vi][1]; cz += surfVerts[vi][2]; }
                        const c = [cx / run.length, cy / run.length, cz / run.length];
                        c[fp.axis] = fp.snap;
                        portLoops.push({ vertices: run, centroid: c });
                        extractedFacePorts++;
                    }
                }
            }
            if (extractedFacePorts < 2 && m >= 4) {
                // Fallback for floating patches not touching voxel planes: pin opposite principal-span extrema
                const domAxis = spanX >= spanY && spanX >= spanZ ? 0 : (spanY >= spanZ ? 1 : 2);
                let minVi = lp.vertices[0], maxVi = lp.vertices[0];
                for (const vi of lp.vertices) {
                    if (surfVerts[vi][domAxis] < surfVerts[minVi][domAxis]) minVi = vi;
                    if (surfVerts[vi][domAxis] > surfVerts[maxVi][domAxis]) maxVi = vi;
                }
                if (minVi !== maxVi) {
                    portLoops.push({ vertices: [minVi], centroid: [...surfVerts[minVi]] });
                    portLoops.push({ vertices: [maxVi], centroid: [...surfVerts[maxVi]] });
                }
            }
        }
    }
    const vertPortTag = new Int32Array(nSurf).fill(-1);
    const vertTargetPos = surfVerts.map(p => [p[0], p[1], p[2]]);
    for (let pi = 0; pi < portLoops.length; pi++) {
        const c = portLoops[pi].centroid;
        for (const vi of portLoops[pi].vertices) {
            if (vertPortTag[vi] === -1) {
                vertPortTag[vi] = pi;
                vertTargetPos[vi] = [c[0], c[1], c[2]];
            } else {
                // Pinch vertex shared between two ports: leave free to contract into the crotch saddle!
                vertPortTag[vi] = -2;
                vertTargetPos[vi] = [surfVerts[vi][0], surfVerts[vi][1], surfVerts[vi][2]];
            }
        }
    }

    // Stage 2: Constrained Iterative Laplacian Mesh Contraction (Au et al. 2008)
    const tris = triangulateFaces(faces);
    const initAreas = computeOneRingAreas(surfVerts, tris);
    let curVerts = surfVerts.map((p, i) => (vertPortTag[i] >= 0 ? [vertTargetPos[i][0], vertTargetPos[i][1], vertTargetPos[i][2]] : [p[0], p[1], p[2]]));

    const contractionIters = options.contractionIters !== undefined ? options.contractionIters : 4;
    let wLBase = options.initialWL !== undefined ? options.initialWL : 2.2;
    const wH0 = 1.0;
    const wPort = 40.0;

    // Cap dense solve size if huge mesh
    if (nSurf <= 900) {
        for (let iter = 0; iter < contractionIters; iter++) {
            const Lrows = buildCotangentLaplacian(curVerts, tris);
            const curAreas = computeOneRingAreas(curVerts, tris);
            const A = Array.from({ length: nSurf }, () => new Float64Array(nSurf));
            const B = Array.from({ length: nSurf }, () => new Float64Array(3));

            for (let i = 0; i < nSurf; i++) {
                const isPort = vertPortTag[i] >= 0;
                const areaRatio = initAreas[i] > 1e-10
                    ? Math.min(12.0, Math.sqrt(initAreas[i] / Math.max(1e-5 * initAreas[i], curAreas[i])))
                    : 1.0;
                const wHi = isPort ? wPort : (wH0 * areaRatio);
                const wHi2 = wHi * wHi;
                const targetP = isPort ? vertTargetPos[i] : curVerts[i];
                A[i][i] += wHi2;
                B[i][0] += wHi2 * targetP[0];
                B[i][1] += wHi2 * targetP[1];
                B[i][2] += wHi2 * targetP[2];

                const wLi = isPort ? (0.15 * wLBase) : wLBase;
                const wLi2 = wLi * wLi;
                const row = Lrows[i];
                for (const [j, lij] of row) {
                    const coeff = wLi2 * lij;
                    for (const [k, lik] of row) {
                        A[j][k] += coeff * lik;
                    }
                }
            }

            const nextV = solveLinearSystem(A, B);
            for (let i = 0; i < nSurf; i++) {
                if (Number.isFinite(nextV[i][0]) && Number.isFinite(nextV[i][1]) && Number.isFinite(nextV[i][2])) {
                    curVerts[i] = [nextV[i][0], nextV[i][1], nextV[i][2]];
                }
            }
            wLBase *= 2.1;
        }
    }

    // Stage 3: 1D Connectivity Surgery (Port Condensation + Iterative Shortest-Edge Collapse)
    // Merge all boundary vertices of each port pi into a single canonical port node
    const parent = Int32Array.from({ length: nSurf }, (_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };

    const portRep = new Int32Array(portLoops.length).fill(-1);
    const nodePort = new Int32Array(nSurf).fill(-1);
    const nodePos = curVerts.map(p => [p[0], p[1], p[2]]);
    const witnesses = Array.from({ length: nSurf }, (_, i) => [i]);

    for (let i = 0; i < nSurf; i++) {
        const pi = vertPortTag[i];
        if (pi >= 0) {
            if (portRep[pi] === -1) {
                portRep[pi] = i;
                nodePort[i] = pi;
                nodePos[i] = [portLoops[pi].centroid[0], portLoops[pi].centroid[1], portLoops[pi].centroid[2]];
            } else {
                const rep = portRep[pi];
                parent[i] = rep;
                witnesses[rep].push(i);
            }
        }
    }

    // Build quotient 1D/2D simplicial complex & apply Homotopy-Preserving Thinning
    // (Au et al. 2008 §4.2 + Dey et al. 1999 Link Condition: preserves exact genus / Betti-1 tunnel loops!)
    const eKey = (u, v) => (u < v ? `${u}_${v}` : `${v}_${u}`);
    const tKey = (a, b, c) => {
        let x = a, y = b, z = c;
        if (x > y) { const t = x; x = y; y = t; }
        if (y > z) { const t = y; y = z; z = t; }
        if (x > y) { const t = x; x = y; y = t; }
        return `${x}_${y}_${z}`;
    };

    let activeEdges = new Map();
    let activeTris = new Map();
    for (const [a0, b0, c0] of tris) {
        const a = find(a0), b = find(b0), c = find(c0);
        if (a !== b) activeEdges.set(eKey(a, b), [Math.min(a, b), Math.max(a, b)]);
        if (b !== c) activeEdges.set(eKey(b, c), [Math.min(b, c), Math.max(b, c)]);
        if (c !== a) activeEdges.set(eKey(c, a), [Math.min(c, a), Math.max(c, a)]);
        if (a !== b && b !== c && c !== a) {
            const sorted = [a, b, c].sort((x, y) => x - y);
            activeTris.set(`${sorted[0]}_${sorted[1]}_${sorted[2]}`, sorted);
        }
    }

    const collapseTol = (options.collapseRatio !== undefined ? options.collapseRatio : 0.082) * bboxDiag;
    const portPullTol = 0.145 * bboxDiag;
    let safety = 0;
    while (safety++ < nSurf * 3) {
        const adj = new Map();
        for (const [u, v] of activeEdges.values()) {
            if (!adj.has(u)) adj.set(u, new Set());
            if (!adj.has(v)) adj.set(v, new Set());
            adj.get(u).add(v);
            adj.get(v).add(u);
        }
        const edgeTriCount = new Map();
        for (const [a, b, c] of activeTris.values()) {
            for (const [u, v] of [[a, b], [b, c], [a, c]]) {
                const k = eKey(u, v);
                edgeTriCount.set(k, (edgeTriCount.get(k) || 0) + 1);
            }
        }

        let bestA = -1, bestB = -1, bestCost = Infinity;
        for (const [k, [u, v]] of activeEdges) {
            const pu = nodePort[u], pv = nodePort[v];
            if (pu >= 0 && pv >= 0) continue; // Never merge two distinct boundary ports
            const tCount = edgeTriCount.get(k) || 0;
            const len = dist3(nodePos[u], nodePos[v]);
            if ((pu >= 0 || pv >= 0) && len > portPullTol) continue; // Keep interior saddle junctions separate from distant ports
            if (tCount === 0 && len > collapseTol) continue;

            // Link Condition: every common neighbor w of (u, v) MUST span an active 2D triangle {u, v, w}.
            // If {u, v, w} is NOT an active face, u-v-w-u is a 1D topological tunnel loop -> do NOT pinch!
            const nu = adj.get(u), nv = adj.get(v);
            let pinchesTunnel = false;
            if (nu && nv) {
                for (const w of nu) {
                    if (nv.has(w) && !activeTris.has(tKey(u, v, w))) {
                        pinchesTunnel = true;
                        break;
                    }
                }
            }
            if (pinchesTunnel) continue;

            const cost = (tCount > 0 ? 0.0 : 10.0) + len;
            if (cost < bestCost) {
                bestCost = cost;
                bestA = u;
                bestB = v;
            }
        }

        if (bestA !== -1 && bestB !== -1) {
            let keep = bestA, drop = bestB;
            if (nodePort[bestB] >= 0 && nodePort[bestA] < 0) { keep = bestB; drop = bestA; }
            parent[drop] = keep;
            if (nodePort[keep] < 0) {
                const wKeep = witnesses[keep].length, wDrop = witnesses[drop].length;
                const tot = Math.max(1, wKeep + wDrop);
                nodePos[keep] = [
                    (nodePos[keep][0] * wKeep + nodePos[drop][0] * wDrop) / tot,
                    (nodePos[keep][1] * wKeep + nodePos[drop][1] * wDrop) / tot,
                    (nodePos[keep][2] * wKeep + nodePos[drop][2] * wDrop) / tot
                ];
            }
            for (const wi of witnesses[drop]) witnesses[keep].push(wi);
            witnesses[drop] = [];

            const nextE = new Map();
            for (const [a0, b0] of activeEdges.values()) {
                const a = find(a0), b = find(b0);
                if (a !== b) nextE.set(eKey(a, b), [Math.min(a, b), Math.max(a, b)]);
            }
            const nextT = new Map();
            for (const [a0, b0, c0] of activeTris.values()) {
                const a = find(a0), b = find(b0), c = find(c0);
                if (a !== b && b !== c && c !== a) {
                    const sorted = [a, b, c].sort((x, y) => x - y);
                    nextT.set(`${sorted[0]}_${sorted[1]}_${sorted[2]}`, sorted);
                }
            }
            activeEdges = nextE;
            activeTris = nextT;
            continue;
        }

        // Elementary simplicial 2-cell collapse when port-locked or closed triangles remain:
        // Peel free boundary edge (tc === 1) + its single incident triangle without merging any vertices!
        if (activeTris.size > 0) {
            let dropEdgeKey = null, maxScore = -1;
            for (const [k, tc] of edgeTriCount) {
                if (tc === 1) {
                    const [u, v] = activeEdges.get(k);
                    const bothPortsBonus = (nodePort[u] >= 0 && nodePort[v] >= 0) ? 10.0 : 0.0;
                    const score = bothPortsBonus + dist3(nodePos[u], nodePos[v]);
                    if (score > maxScore) { maxScore = score; dropEdgeKey = k; }
                }
            }
            if (dropEdgeKey) {
                activeEdges.delete(dropEdgeKey);
                for (const [tk, [a, b, c]] of [...activeTris]) {
                    if (eKey(a, b) === dropEdgeKey || eKey(b, c) === dropEdgeKey || eKey(a, c) === dropEdgeKey) {
                        activeTris.delete(tk);
                    }
                }
                continue;
            }
            // Closed 2-manifold bladder with no free edge: puncture 1 face so elementary collapse can proceed
            let maxArea = -1, dropTriKey = null;
            for (const [tk, [a, b, c]] of activeTris) {
                const cr = cross3(sub3(nodePos[b], nodePos[a]), sub3(nodePos[c], nodePos[a]));
                const ar = Math.hypot(cr[0], cr[1], cr[2]);
                if (ar > maxArea) { maxArea = ar; dropTriKey = tk; }
            }
            if (dropTriKey) {
                activeTris.delete(dropTriKey);
                continue;
            }
        }
        break;
    }

    const rawSkelEdges = [...activeEdges.values()];

    // Compact surviving vertices & apply Medial Witness Re-Centering (Au et al. 2008 §5.2)
    const repToNew = new Map();
    const vertsOut = [];
    const portTagOut = [];
    const dedupEdges = [];
    const dedupSet = new Set();

    const getOrMakeNode = (oldRep) => {
        let ni = repToNew.get(oldRep);
        if (ni !== undefined) return ni;
        ni = vertsOut.length;
        repToNew.set(oldRep, ni);
        if (nodePort[oldRep] >= 0) {
            const c = portLoops[nodePort[oldRep]].centroid;
            vertsOut.push([c[0], c[1], c[2]]);
            portTagOut.push(nodePort[oldRep]);
        } else {
            const wits = witnesses[oldRep];
            if (wits && wits.length > 0) {
                let mx = 0, my = 0, mz = 0;
                for (const wi of wits) {
                    mx += surfVerts[wi][0]; my += surfVerts[wi][1]; mz += surfVerts[wi][2];
                }
                mx /= wits.length; my /= wits.length; mz /= wits.length;
                const cp = nodePos[oldRep];
                vertsOut.push([
                    0.55 * cp[0] + 0.45 * mx,
                    0.55 * cp[1] + 0.45 * my,
                    0.55 * cp[2] + 0.45 * mz
                ]);
            } else {
                vertsOut.push([nodePos[oldRep][0], nodePos[oldRep][1], nodePos[oldRep][2]]);
            }
            portTagOut.push(-1);
        }
        return ni;
    };

    for (const [rawU, rawV] of rawSkelEdges) {
        const ru = find(rawU), rv = find(rawV);
        if (ru === rv) continue;
        const u = getOrMakeNode(ru), v = getOrMakeNode(rv);
        const a = Math.min(u, v), b = Math.max(u, v);
        const k = `${a}_${b}`;
        if (!dedupSet.has(k)) { dedupSet.add(k); dedupEdges.push([a, b]); }
    }

    // Stage 4: Prune tiny unpinned leaf spurs & simplify nearly-collinear degree-2 interior chains
    let curV = vertsOut;
    let curE = dedupEdges;
    let curPort = portTagOut;

    const buildAdj = (nV, eList) => {
        const a = Array.from({ length: nV }, () => new Set());
        for (const [u, v] of eList) { a[u].add(v); a[v].add(u); }
        return a;
    };

    // 4a. Prune short unpinned leaf spurs (< 0.14 * bboxDiag)
    const spurTol = 0.14 * bboxDiag;
    let pruned = true;
    while (pruned && curE.length > 1) {
        pruned = false;
        const adj = buildAdj(curV.length, curE);
        for (let i = 0; i < curV.length; i++) {
            if (curPort[i] >= 0) continue;
            if (adj[i].size === 1) {
                const nb = [...adj[i]][0];
                if (dist3(curV[i], curV[nb]) < spurTol) {
                    curE = curE.filter(([u, v]) => u !== i && v !== i);
                    pruned = true;
                    break;
                }
            }
        }
    }

    // 4b. Simplify nearly-collinear degree-2 unpinned vertices (cos > 0.96), never collapsing a 3-cycle!
    const cosThresh = options.collinearCos !== undefined ? options.collinearCos : 0.96;
    let simplified = true;
    while (simplified && curE.length > 1) {
        simplified = false;
        const adj = buildAdj(curV.length, curE);
        for (let i = 0; i < curV.length; i++) {
            if (curPort[i] >= 0 || adj[i].size !== 2) continue;
            const [n0, n1] = [...adj[i]];
            if (adj[n0].has(n1)) continue; // Preserve 3-cycle loop!
            const d0 = norm3(sub3(curV[i], curV[n0]));
            const d1 = norm3(sub3(curV[n1], curV[i]));
            if (dot3(d0, d1) >= cosThresh) {
                curE = curE.filter(([u, v]) => u !== i && v !== i);
                const a = Math.min(n0, n1), b = Math.max(n0, n1);
                curE.push([a, b]);
                simplified = true;
                break;
            }
        }
    }

    // Compact isolated vertices
    const usedMap = new Int32Array(curV.length).fill(-1);
    const finalVerts = [];
    const finalPorts = [];
    for (const [u, v] of curE) {
        if (usedMap[u] === -1) { usedMap[u] = finalVerts.length; finalVerts.push(curV[u]); if (curPort[u] >= 0) finalPorts.push(usedMap[u]); }
        if (usedMap[v] === -1) { usedMap[v] = finalVerts.length; finalVerts.push(curV[v]); if (curPort[v] >= 0) finalPorts.push(usedMap[v]); }
    }
    const finalEdges = curE.map(([u, v]) => [usedMap[u], usedMap[v]]);

    return {
        vertices: finalVerts,
        edges: finalEdges,
        ports: finalPorts,
        portCount: portLoops.length,
        method: 'laplacian-contraction-v1'
    };
}

/**
 * Recreates the coarse all-quad bifurcating twin-tube column from the reference diagram:
 * - Bottom (z = -0.50): 2 adjacent square leg openings (front-right B1 & front-left B2) + vertical stem collar
 * - Waist  (z = -0.18 .. +0.16): Conjoined 8-gon saddle trunk
 * - Top    (z = +0.50): 2 diagonal / corner-kissing square chimney openings (front-right T1 & back-left T2)
 *
 * Pure manifold quad cage (26 quads, 24 vertices, 4 open 4-edge boundary ports).
 */
export function createTwinTubeBifurcationCoarseMesh() {
    const s = 0.28;   // square cuff width (fits comfortably in [-0.5, +0.5]^3 unit voxel)
    const g = 0.015;  // slight crotch offset so every quad edge is strictly 2-manifold
    // 8-gon waist ring W[0..7] counter-clockwise at zW0 = -0.18 and zW1 = +0.16
    // Bottom pairing bridges (2, 5, 6, 1) -> Square B1 = (2,3,4,5) in (+X,-Y), Square B2 = (6,7,0,1) in (-X,-Y)
    // Top pairing bridges (0, 3, 4, 7)    -> Square T1 = (0,1,2,3) in (+X,-Y), Square T2 = (4,5,6,7) in (-X,+Y)

    // Wait: check indices so T1 is (+X, -Y), T2 is (-X, +Y), B1 is (+X, -Y), B2 is (-X, -Y)!
    // Let's list the 8 vertices around the perimeter counter-clockwise:
    //   0: ( +g,  -g )   [inner front-right saddle]
    //   1: ( +g,  -s )   [front-mid-right]
    //   2: ( +s,  -s )   [front-right outer corner]
    //   3: ( +s,   0 )   [mid-right]
    //   4: (  0,  +g )   [inner back-left saddle]
    //   5: ( -s,  +s )   [back-left outer]
    //   6: ( -s,   0 )   [mid-left]
    //   7: ( -g,  -s )   [front-mid-left]
    // Let's verify both splits of (0,1,2,3,4,5,6,7):
    //   TOP split (bridge quad [0, 3, 4, 7]):
    //     - Chimney T1 uses (0, 1, 2, 3) -> maps cleanly to Top Square T1: [0..+s] x [-s..0] at z = +0.50!
    //     - Chimney T2 uses (4, 5, 6, 7) -> maps cleanly to Top Square T2: [-s..0] x [0..+s] at z = +0.50!
    //   BOTTOM split (bridge quad [1, 4, 3, 0]? Wait: to get B1=(+X,-Y) and B2=(-X,-Y), shift by 1 step -> bridge [1, 2? No, bridge (0, 7, 4, 3)? Wait]):
    //     If bridge is [7, 0, 3, 4], that's the same pair! Shift by 1 index -> bridge [0, 1, 4, 5] or [6, 1, 2, 5]?
    //     Wait: in an 8-gon (0,1,2,3,4,5,6,7), ANY chord-quad [k, (k+3)%8, (k+4)%8, (k+7)%8] splits the 8-gon into TWO 4-gons:
    //       Loop A = [k, k+1, k+2, k+3] and Loop B = [k+4, k+5, k+6, k+7]!
    //     Let's pick k = 0 for TOP and k = 1 (or k = 6) for BOTTOM!!
    //     Check k = 0 (TOP):
    //       T1 = (0, 1, 2, 3) -> Top Front-Right Square [0..+s] x [-s..0] at z = +0.50!
    //       T2 = (4, 5, 6, 7) -> Top Back-Left Square   [-s..0] x [0..+s] at z = +0.50!
    //       Top Saddle Quad = [0, 3, 4, 7] (oriented so shared edges match T1's 3->0 and T2's 7->4)!
    //     Check k = 1 (BOTTOM, 45° / 1-quadrant twist, matching Image 1!):
    //       B1 = (1, 2, 3, 4) -> Bottom Right/Front Square [0..+s] x [-s..0] at z = -0.50!
    //       B2 = (5, 6, 7, 0) -> Bottom Left/Front Square  [-s..0] x [-s..0] at z = -0.50!
    //       Bottom Saddle Quad = [1, 0, 5, 4] (oriented downward)!

    const verts = [
        // 0..7: Lower waist 8-gon at z = -0.20
        [  0.00, -0.06, -0.20], // 0
        [  0.04, -s,    -0.20], // 1
        [  s,    -s,    -0.20], // 2
        [  s,     0.00, -0.20], // 3
        [  0.04,  0.00, -0.20], // 4
        [ -0.04,  0.00, -0.20], // 5
        [ -s,     0.00, -0.20], // 6
        [ -s,    -s,    -0.20], // 7

        // 8..15: Upper waist 8-gon at z = +0.16 (twisted 1 slot toward diagonal top chimneys)
        [  0.02, -0.02,  0.16], // 8  (above 0)
        [  0.02, -s,     0.16], // 9  (above 1)
        [  s,    -s,     0.16], // 10 (above 2)
        [  s,    -0.02,  0.16], // 11 (above 3)
        [ -0.02,  0.02,  0.16], // 12 (above 4)
        [ -0.02,  s,     0.16], // 13 (above 5)
        [ -s,     s,     0.16], // 14 (above 6)
        [ -s,     0.02,  0.16], // 15 (above 7)

        // 16..19: Bottom Square B1 (+X, -Y) at z = -0.50 (connects to 1, 2, 3, 4; exact XY match with Top T1 for vertical stacking!)
        [  g, -s, -0.50], // 16
        [  s, -s, -0.50], // 17
        [  s, -g, -0.50], // 18
        [  g, -g, -0.50], // 19

        // 20..23: Bottom Square B2 (-X, -Y) at z = -0.50 (connects to 5, 6, 7, 0)
        [ -g, -g, -0.50], // 20
        [ -s, -g, -0.50], // 21
        [ -s, -s, -0.50], // 22
        [ -g, -s, -0.50], // 23

        // 24..27: Top Square T1 (+X, -Y) at z = +0.50 (connects to 8, 9, 10, 11)
        [  g, -g,  0.50], // 24
        [  g, -s,  0.50], // 25
        [  s, -s,  0.50], // 26
        [  s, -g,  0.50], // 27

        // 28..31: Top Square T2 (-X, +Y) at z = +0.50 (connects to 12, 13, 14, 15)
        [ -g,  g,  0.50], // 28
        [ -g,  s,  0.50], // 29
        [ -s,  s,  0.50], // 30
        [ -s,  g,  0.50]  // 31
    ];

    const faces = [];
    // 1. Central 8-gon waist trunk (8 quads: lower 0..7 -> upper 8..15)
    for (let k = 0; k < 8; k++) {
        const kn = (k + 1) % 8;
        faces.push([k, kn, 8 + kn, 8 + k]);
    }
    // 2. Bottom saddle quad closing the gap between B1=(1,2,3,4) and B2=(5,6,7,0)
    faces.push([0, 1, 4, 5]);
    // 3. Bottom Leg B1 sleeve (16,17,18,19 -> 1,2,3,4)
    const b1W = [1, 2, 3, 4], b1B = [16, 17, 18, 19];
    for (let k = 0; k < 4; k++) {
        const kn = (k + 1) % 4;
        faces.push([b1B[k], b1B[kn], b1W[kn], b1W[k]]);
    }
    // 4. Bottom Leg B2 sleeve (20,21,22,23 -> 5,6,7,0)
    const b2W = [5, 6, 7, 0], b2B = [20, 21, 22, 23];
    for (let k = 0; k < 4; k++) {
        const kn = (k + 1) % 4;
        faces.push([b2B[k], b2B[kn], b2W[kn], b2W[k]]);
    }
    // 5. Top saddle quad closing the gap between T1=(8,9,10,11) and T2=(12,13,14,15)
    faces.push([8, 15, 12, 11]);
    // 6. Top Chimney T1 sleeve (8,9,10,11 -> 24,25,26,27)
    const t1W = [8, 9, 10, 11], t1T = [24, 25, 26, 27];
    for (let k = 0; k < 4; k++) {
        const kn = (k + 1) % 4;
        faces.push([t1W[k], t1W[kn], t1T[kn], t1T[k]]);
    }
    // 7. Top Chimney T2 sleeve (12,13,14,15 -> 28,29,30,31)
    const t2W = [12, 13, 14, 15], t2T = [28, 29, 30, 31];
    for (let k = 0; k < 4; k++) {
        const kn = (k + 1) % 4;
        faces.push([t2W[k], t2W[kn], t2T[kn], t2T[k]]);
    }

    return { verts, faces };
}

export function buildCoarseMeshOBJText(meshOrVerts, facesArg = null, nameArg = 'twin_tube_bifurcation_coarse') {
    const isObj = meshOrVerts && !Array.isArray(meshOrVerts) && typeof meshOrVerts === 'object';
    const verts = isObj ? (meshOrVerts.verts || meshOrVerts.vertices || []) : (meshOrVerts || []);
    const faces = isObj ? (meshOrVerts.faces || []) : (facesArg || []);
    const name = isObj && typeof facesArg === 'string' ? facesArg : nameArg;
    const lines = [`# TOPOGEN Coarse Quad Tile: ${name}`, `o ${name}`];
    for (const [x, y, z] of verts) {
        lines.push(`v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
    }
    for (const f of faces) {
        lines.push(`f ${f.map(i => i + 1).join(' ')}`);
    }
    return lines.join('\n') + '\n';
}

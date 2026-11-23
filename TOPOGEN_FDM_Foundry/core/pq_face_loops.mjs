/**
 * WFC-FDM Foundry — Core Module 4a: Quad Planarity, Manifold Audit, Face Loops & PQ Optimization
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 * Re-exported through core/pq_solidifier.mjs and core/index.mjs.
 *
 * Student Quick-Map:
 *   - Edit face-loop color palette                 -> LOOP_PALETTE, computeParentColorShade()
 *   - Edit watertight 2-manifold & Euler check     -> verifyManifold()
 *   - Edit longitudinal / ring face-loop walker    -> walkMeshFaceLoops()
 *   - Edit negotiated Planar-Quad (PQ) solver      -> optimizeFaceLoopsToPQ()
 */

import { V3, toV3 } from './math_tiles.mjs';
import { computeQuadPlanarity, unrollFaceLoop2D } from './unroll_patterns.mjs';

// ============================================================
//  GRAPH-TO-TUBULAR-MESH ENGINE (Ported from index.html)
//  Pure-JS V3 implementation: weldVertices, mergeTrianglesToQuads,
//  verifyManifold, computeEndRingBisectorStitched,
//  solidifyGraphBisectorStitched, solidifyGraph, OBJ export
// ============================================================

function weldVertices(vertices, eps = 1e-4) {
    const uniqueVertices = [];
    const map = [];
    const spatialHash = {};
    const getCellKey = (v) => `${Math.floor(v.x / eps)},${Math.floor(v.y / eps)},${Math.floor(v.z / eps)}`;

    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        let foundIdx = -1;
        const xCell = Math.floor(v.x / eps);
        const yCell = Math.floor(v.y / eps);
        const zCell = Math.floor(v.z / eps);

        outerLoop:
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = spatialHash[`${xCell + dx},${yCell + dy},${zCell + dz}`];
                    if (bucket) {
                        for (let uIdx of bucket) {
                            if (uniqueVertices[uIdx].distanceTo(v) < eps) {
                                foundIdx = uIdx;
                                break outerLoop;
                            }
                        }
                    }
                }
            }
        }
        if (foundIdx === -1) {
            uniqueVertices.push(v);
            foundIdx = uniqueVertices.length - 1;
            const key = getCellKey(v);
            if (!spatialHash[key]) spatialHash[key] = [];
            spatialHash[key].push(foundIdx);
        }
        map[i] = foundIdx;
    }
    return { vertices: uniqueVertices, map };
}

function computeQuadPlanarityError(v0, v1, v2, v3) {
    const x0 = v0.x !== undefined ? v0.x : v0[0], y0 = v0.y !== undefined ? v0.y : v0[1], z0 = v0.z !== undefined ? v0.z : v0[2];
    const x1 = v1.x !== undefined ? v1.x : v1[0], y1 = v1.y !== undefined ? v1.y : v1[1], z1 = v1.z !== undefined ? v1.z : v1[2];
    const x2 = v2.x !== undefined ? v2.x : v2[0], y2 = v2.y !== undefined ? v2.y : v2[1], z2 = v2.z !== undefined ? v2.z : v2[2];
    const x3 = v3.x !== undefined ? v3.x : v3[0], y3 = v3.y !== undefined ? v3.y : v3[1], z3 = v3.z !== undefined ? v3.z : v3[2];
    const d1x = x2 - x0, d1y = y2 - y0, d1z = z2 - z0;
    const d2x = x3 - x1, d2y = y3 - y1, d2z = z3 - z1;
    let nx = d1y * d2z - d1z * d2y;
    let ny = d1z * d2x - d1x * d2z;
    let nz = d1x * d2y - d1y * d2x;
    let nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-14) {
        const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
        nx = e1y * d1z - e1z * d1y;
        ny = e1z * d1x - e1x * d1z;
        nz = e1x * d1y - e1y * d1x;
        nLen = Math.hypot(nx, ny, nz);
        if (nLen < 1e-14) return 0.0;
    }
    nx /= nLen; ny /= nLen; nz /= nLen;
    const sx = x0 - x1 + x2 - x3;
    const sy = y0 - y1 + y2 - y3;
    const sz = z0 - z1 + z2 - z3;
    return 0.25 * Math.abs(sx * nx + sy * ny + sz * nz);
}

function isConvexQuad3D(v0, v1, v2, v3) {
    const pts = [v0, v1, v2, v3].map(p => p.x !== undefined ? p : new V3(p[0], p[1], p[2]));
    const d1 = new V3().subVectors(pts[2], pts[0]);
    const d2 = new V3().subVectors(pts[3], pts[1]);
    const n = new V3().crossVectors(d1, d2);
    const nLen = n.length();
    if (nLen < 1e-12) return false;
    n.multiplyScalar(1 / nLen);
    for (let i = 0; i < 4; i++) {
        const prev = pts[(i + 3) % 4], cur = pts[i], next = pts[(i + 1) % 4];
        const eA = new V3().subVectors(cur, prev);
        const eB = new V3().subVectors(next, cur);
        const lA = eA.length(), lB = eB.length();
        if (lA < 1e-9 || lB < 1e-9) return false;
        const turn = new V3().crossVectors(eA, eB).dot(n) / (lA * lB);
        if (turn <= 0.02) return false;
    }
    return true;
}

function computeMeshPlanarityStats(vertices, quads) {
    if (!quads || quads.length === 0) {
        return { quadCount: 0, maxQuadPlanarityErrorM: 0.0, meanQuadPlanarityErrorM: 0.0 };
    }
    let maxErr = 0.0, sumErr = 0.0;
    for (let i = 0; i < quads.length; i++) {
        const q = quads[i];
        const err = computeQuadPlanarityError(vertices[q[0]], vertices[q[1]], vertices[q[2]], vertices[q[3]]);
        if (err > maxErr) maxErr = err;
        sumErr += err;
    }
    return {
        quadCount: quads.length,
        maxQuadPlanarityErrorM: maxErr,
        meanQuadPlanarityErrorM: sumErr / quads.length
    };
}

function computeSignedMeshVolume(vertices, quads, triangles) {
    let vol6 = 0.0;
    const addTri = (ia, ib, ic) => {
        const a = vertices[ia], b = vertices[ib], c = vertices[ic];
        vol6 += a.x * (b.y * c.z - b.z * c.y)
              + a.y * (b.z * c.x - b.x * c.z)
              + a.z * (b.x * c.y - b.y * c.x);
    };
    for (let i = 0; i < quads.length; i++) {
        const q = quads[i];
        addTri(q[0], q[1], q[2]);
        addTri(q[0], q[2], q[3]);
    }
    for (let i = 0; i < triangles.length; i++) {
        const t = triangles[i];
        addTri(t[0], t[1], t[2]);
    }
    return vol6 / 6.0;
}

function planarizeQuadMesh(vertices, quads, fixedSet, options = {}) {
    if (!quads || quads.length === 0) return;
    const iters = Math.max(1, Math.round(options.iterations || 12));
    const tol = options.targetErrorM !== undefined ? Number(options.targetErrorM) : 1e-6;
    const nV = vertices.length;
    const dx = new Float64Array(nV);
    const dy = new Float64Array(nV);
    const dz = new Float64Array(nV);
    const cnt = new Int32Array(nV);

    for (let iter = 0; iter < iters; iter++) {
        let maxErr = 0.0;
        dx.fill(0); dy.fill(0); dz.fill(0); cnt.fill(0);
        for (let qi = 0; qi < quads.length; qi++) {
            const [i0, i1, i2, i3] = quads[qi];
            const v0 = vertices[i0], v1 = vertices[i1], v2 = vertices[i2], v3 = vertices[i3];
            const err = computeQuadPlanarityError(v0, v1, v2, v3);
            if (err > maxErr) maxErr = err;
            if (err <= 1e-12) continue;
            const d1x = v2.x - v0.x, d1y = v2.y - v0.y, d1z = v2.z - v0.z;
            const d2x = v3.x - v1.x, d2y = v3.y - v1.y, d2z = v3.z - v1.z;
            let nx = d1y * d2z - d1z * d2y;
            let ny = d1z * d2x - d1x * d2z;
            let nz = d1x * d2y - d1y * d2x;
            const nLen = Math.hypot(nx, ny, nz);
            if (nLen < 1e-14) continue;
            nx /= nLen; ny /= nLen; nz /= nLen;
            const cx = 0.25 * (v0.x + v1.x + v2.x + v3.x);
            const cy = 0.25 * (v0.y + v1.y + v2.y + v3.y);
            const cz = 0.25 * (v0.z + v1.z + v2.z + v3.z);
            const idxs = [i0, i1, i2, i3];
            for (let k = 0; k < 4; k++) {
                const vi = idxs[k];
                if (fixedSet && fixedSet.has(vi)) continue;
                const p = vertices[vi];
                const dist = (p.x - cx) * nx + (p.y - cy) * ny + (p.z - cz) * nz;
                dx[vi] -= dist * nx;
                dy[vi] -= dist * ny;
                dz[vi] -= dist * nz;
                cnt[vi] += 1;
            }
        }
        if (maxErr <= tol) break;
        let moved = false;
        for (let vi = 0; vi < nV; vi++) {
            if (cnt[vi] > 0) {
                const inv = 0.75 / cnt[vi];
                vertices[vi].x += dx[vi] * inv;
                vertices[vi].y += dy[vi] * inv;
                vertices[vi].z += dz[vi] * inv;
                moved = true;
            }
        }
        if (!moved) break;
    }
}

function mergeTrianglesToQuads(vertices, faces, options = {}) {
    const maxPlanarityErrorM = options.maxPlanarityErrorM !== undefined ? Number(options.maxPlanarityErrorM) : Infinity;
    const requireConvex = options.requireConvex !== undefined ? !!options.requireConvex : Number.isFinite(maxPlanarityErrorM);
    const quads = [];
    const triangles = [];
    const used = new Set();
    const normals = [];
    for (let i = 0; i < faces.length; i += 3) {
        const v0 = vertices[faces[i]], v1 = vertices[faces[i + 1]], v2 = vertices[faces[i + 2]];
        const n = new V3().crossVectors(new V3().subVectors(v1, v0), new V3().subVectors(v2, v0)).normalize();
        normals.push(n);
    }
    for (let i = 0; i < faces.length; i += 3) {
        const triIdxA = i / 3;
        if (used.has(triIdxA)) continue;
        const a0 = faces[i], a1 = faces[i + 1], a2 = faces[i + 2];
        const nA = normals[triIdxA];
        let merged = false;
        for (let j = i + 3; j < faces.length; j += 3) {
            const triIdxB = j / 3;
            if (used.has(triIdxB)) continue;
            const b0 = faces[j], b1 = faces[j + 1], b2 = faces[j + 2];
            if (nA.dot(normals[triIdxB]) > 0.985) {
                const shared = [], unsharedA = [], unsharedB = [];
                const verticesA = [a0, a1, a2], verticesB = [b0, b1, b2];
                for (let v of verticesA) {
                    if (verticesB.includes(v)) shared.push(v); else unsharedA.push(v);
                }
                for (let v of verticesB) {
                    if (!verticesA.includes(v)) unsharedB.push(v);
                }
                if (shared.length === 2 && unsharedA.length === 1 && unsharedB.length === 1) {
                    const s0 = shared[0], s1 = shared[1], uA = unsharedA[0], uB = unsharedB[0];
                    const idx_s0 = verticesA.indexOf(s0), idx_s1 = verticesA.indexOf(s1);
                    const candQ = ((idx_s0 + 1) % 3 === idx_s1) ? [s0, uB, s1, uA] : [s1, uB, s0, uA];
                    const qErr = computeQuadPlanarityError(
                        vertices[candQ[0]], vertices[candQ[1]], vertices[candQ[2]], vertices[candQ[3]]
                    );
                    if (qErr <= maxPlanarityErrorM && (!requireConvex || isConvexQuad3D(vertices[candQ[0]], vertices[candQ[1]], vertices[candQ[2]], vertices[candQ[3]]))) {
                        quads.push(candQ);
                        used.add(triIdxA); used.add(triIdxB);
                        merged = true;
                        break;
                    }
                }
            }
        }
        if (!merged) { triangles.push([a0, a1, a2]); used.add(triIdxA); }
    }
    return { quads, triangles };
}

function verifyManifold(vertices, triIndicesFlat) {
    const edgeMap = {};
    for (let i = 0; i < triIndicesFlat.length; i += 3) {
        const f0 = triIndicesFlat[i], f1 = triIndicesFlat[i + 1], f2 = triIndicesFlat[i + 2];
        const edges = [[f0, f1], [f1, f2], [f2, f0]];
        for (let e of edges) {
            const key = `${Math.min(e[0], e[1])},${Math.max(e[0], e[1])}`;
            edgeMap[key] = (edgeMap[key] || 0) + 1;
        }
    }
    let boundaryEdges = 0, nonManifoldEdges = 0, manifoldEdges = 0;
    for (let key in edgeMap) {
        const count = edgeMap[key];
        if (count === 1) boundaryEdges++;
        else if (count > 2) nonManifoldEdges++;
        else if (count === 2) manifoldEdges++;
    }
    const totalMeshEdges = Object.keys(edgeMap).length;
    const euler = vertices.length - totalMeshEdges + (triIndicesFlat.length / 3);
    const genus = Math.max(0, Math.round((2 - euler) / 2));
    const isValid = (nonManifoldEdges === 0 && vertices.length > 0);
    const isWatertight = (isValid && boundaryEdges === 0);
    return { isValid, isWatertight, boundaryEdges, nonManifoldEdges, manifoldEdges, totalMeshEdges, euler, genus };
}

// Pure-JS Incremental 3D Convex Hull (used when stitchAtBisectors === false)
function computeConvexHull3D(points) {
    const n = points.length;
    if (n < 4) return [];
    let i0 = 0, i1 = -1, i2 = -1, i3 = -1;
    let maxD = -1;
    for (let i = 1; i < n; i++) {
        const d = points[i].distanceTo(points[i0]);
        if (d > maxD) { maxD = d; i1 = i; }
    }
    if (i1 === -1 || maxD < 1e-9) return [];
    const d01 = new V3().subVectors(points[i1], points[i0]);
    let maxArea = -1;
    for (let i = 0; i < n; i++) {
        if (i === i0 || i === i1) continue;
        const area = new V3().crossVectors(d01, new V3().subVectors(points[i], points[i0])).length();
        if (area > maxArea) { maxArea = area; i2 = i; }
    }
    if (i2 === -1 || maxArea < 1e-12) return [];
    const n012 = new V3().crossVectors(d01, new V3().subVectors(points[i2], points[i0])).normalize();
    let maxVol = -1;
    for (let i = 0; i < n; i++) {
        if (i === i0 || i === i1 || i === i2) continue;
        const vol = Math.abs(new V3().subVectors(points[i], points[i0]).dot(n012));
        if (vol > maxVol) { maxVol = vol; i3 = i; }
    }
    if (i3 === -1 || maxVol < 1e-12) return [];

    const center = new V3(
        (points[i0].x + points[i1].x + points[i2].x + points[i3].x) * 0.25,
        (points[i0].y + points[i1].y + points[i2].y + points[i3].y) * 0.25,
        (points[i0].z + points[i1].z + points[i2].z + points[i3].z) * 0.25
    );
    const makeFace = (a, b, c) => {
        const nrm = new V3().crossVectors(new V3().subVectors(points[b], points[a]), new V3().subVectors(points[c], points[a]));
        const len = nrm.length();
        if (len > 1e-15) nrm.multiplyScalar(1 / len);
        return { a, b, c, n: nrm, d: nrm.dot(points[a]) };
    };
    const orientFace = (a, b, c) => {
        let f = makeFace(a, b, c);
        if (f.n.dot(center) > f.d) f = makeFace(a, c, b);
        return f;
    };
    let faces = [
        orientFace(i0, i1, i2),
        orientFace(i0, i1, i3),
        orientFace(i1, i2, i3),
        orientFace(i2, i0, i3)
    ];

    for (let p = 0; p < n; p++) {
        if (p === i0 || p === i1 || p === i2 || p === i3) continue;
        const pt = points[p];
        const visible = [];
        const kept = [];
        for (let f of faces) {
            if (f.n.dot(pt) - f.d > 1e-11) visible.push(f);
            else kept.push(f);
        }
        if (visible.length === 0) continue;
        const edgeCount = new Map();
        const dirEdges = [];
        for (let f of visible) {
            const es = [[f.a, f.b], [f.b, f.c], [f.c, f.a]];
            for (let e of es) {
                const key = `${Math.min(e[0], e[1])}_${Math.max(e[0], e[1])}`;
                edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
                dirEdges.push([e[0], e[1], key]);
            }
        }
        for (let [u, v, key] of dirEdges) {
            if (edgeCount.get(key) === 1) {
                kept.push(makeFace(u, v, p));
            }
        }
        faces = kept;
    }
    return faces;
}

// ============================================================
//  FACE LOOP WALKING, COLORING, SUBDIVISION & NEGOTIATED PQ
//  (Root index.html Parity — 100% Pure-JS, Zero DOM/Three deps)
// ============================================================

const LOOP_PALETTE = [
    0xec4899, 0x06b6d4, 0x10b981, 0xf59e0b,
    0x8b5cf6, 0xef4444, 0x3b82f6, 0x84cc16,
    0x14b8a6, 0xf97316, 0x6366f1, 0xd946ef,
    0x0ea5e9, 0x22c55e, 0xeab308, 0xf43f5e
];

function hexToHSL(hex) {
    const r = ((hex >> 16) & 255) / 255;
    const g = ((hex >> 8) & 255) / 255;
    const b = (hex & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = 0.5 * (max + min);
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (max === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return { h, s, l };
}

function hslToHex(h, s, l) {
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1;
        if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    let r, g, b;
    if (s === 0) {
        r = g = b = l;
    } else {
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1 / 3);
    }
    return ((Math.round(r * 255) & 255) << 16)
         | ((Math.round(g * 255) & 255) << 8)
         | (Math.round(b * 255) & 255);
}

function computeParentColorShade(baseColorHex, siblingIdx, siblingCount) {
    if (siblingCount <= 1) return baseColorHex;
    const hsl = hexToHSL(baseColorHex);
    const t = (siblingCount === 2)
        ? (siblingIdx === 0 ? -0.75 : 0.75)
        : ((siblingIdx / (siblingCount - 1)) * 2.0 - 1.0);
    const newL = Math.max(0.20, Math.min(0.84, hsl.l + t * 0.19));
    const newS = Math.max(0.38, Math.min(1.0, hsl.s - t * 0.08));
    return hslToHex(hsl.h, newS, newL);
}

function walkMeshFaceLoops(vertices, quads, directionMode = 'longitudinal', optionsOrInherited = null, extraOpts = {}) {
    let opts = extraOpts || {};
    let inheritedQuadColors = null;
    if (Array.isArray(optionsOrInherited) || (optionsOrInherited && typeof optionsOrInherited.length === 'number')) {
        inheritedQuadColors = optionsOrInherited;
    } else if (optionsOrInherited && typeof optionsOrInherited === 'object') {
        opts = optionsOrInherited;
        inheritedQuadColors = opts.inheritedQuadColors || null;
    }

    const modeKey = (directionMode === 'ring') ? 'ring' : 'longitudinal';
    const solidRef = opts.solidData || null;
    const activeInherited = (inheritedQuadColors && inheritedQuadColors.length === quads.length)
        ? inheritedQuadColors
        : (solidRef && solidRef.quadInheritedColors && solidRef.quadInheritedColors[modeKey] && solidRef.quadInheritedColors[modeKey].length === quads.length
            ? solidRef.quadInheritedColors[modeKey]
            : null);
    const activeParentIds = (opts.quadParentLoopIds && opts.quadParentLoopIds.length === quads.length)
        ? opts.quadParentLoopIds
        : (solidRef && solidRef.quadParentLoopIds && solidRef.quadParentLoopIds[modeKey] && solidRef.quadParentLoopIds[modeKey].length === quads.length
            ? solidRef.quadParentLoopIds[modeKey]
            : null);

    const edgeToQuadSides = new Map();
    const edgeKey = (a, b) => (a < b ? `${a},${b}` : `${b},${a}`);
    for (let qIdx = 0; qIdx < quads.length; qIdx++) {
        const q = quads[qIdx];
        for (let s = 0; s < 4; s++) {
            const k = edgeKey(q[s], q[(s + 1) % 4]);
            let list = edgeToQuadSides.get(k);
            if (!list) { list = []; edgeToQuadSides.set(k, list); }
            list.push({ qIdx, side: s });
        }
    }

    const initSide = (modeKey === 'ring') ? 1 : 0;

    const traceCandidateLoop = (startQ, startSide, blockedSet) => {
        const startParentCol = activeInherited ? activeInherited[startQ] : -1;
        const startParentId  = activeParentIds ? activeParentIds[startQ] : -1;
        const walkChain = (startQuad, sSide, seen) => {
            const chain = [];
            let currQ = startQuad, exitSide = sSide;
            let closedOnStart = false;
            while (true) {
                const q = quads[currQ];
                const k = edgeKey(q[exitSide], q[(exitSide + 1) % 4]);
                const nbrs = edgeToQuadSides.get(k);
                const nbr = nbrs ? nbrs.find(n => n.qIdx !== currQ) : null;
                if (!nbr) break;
                if (activeParentIds && activeParentIds[nbr.qIdx] !== startParentId) break;
                if (activeInherited && activeInherited[nbr.qIdx] !== startParentCol) break;
                if (nbr.qIdx === startQuad && ((nbr.side + 2) % 4) === startSide) {
                    closedOnStart = true;
                    break;
                }
                if (blockedSet.has(nbr.qIdx) || seen.has(nbr.qIdx)) break;
                seen.add(nbr.qIdx);
                const nextExit = (nbr.side + 2) % 4;
                chain.push({ qIdx: nbr.qIdx, enterSide: nbr.side, exitSide: nextExit });
                currQ = nbr.qIdx;
                exitSide = nextExit;
            }
            return { chain, closedOnStart };
        };

        const seen = new Set([startQ]);
        const fwdRes = walkChain(startQ, startSide, seen);
        let steps;
        if (fwdRes.closedOnStart) {
            steps = [
                { qIdx: startQ, enterSide: (startSide + 2) % 4, exitSide: startSide },
                ...fwdRes.chain
            ];
        } else {
            const bwdRes = walkChain(startQ, (startSide + 2) % 4, seen);
            steps = [
                ...bwdRes.chain.reverse().map(s => ({ qIdx: s.qIdx, enterSide: s.exitSide, exitSide: s.enterSide })),
                { qIdx: startQ, enterSide: (startSide + 2) % 4, exitSide: startSide },
                ...fwdRes.chain
            ];
        }
        return { steps, isClosed: fwdRes.closedOnStart };
    };

    const seedOrder = Array.from({ length: quads.length }, (_, i) => i);
    if (modeKey === 'ring' && quads.length > 0) {
        const emptyBlocked = new Set();
        const ringPriority = new Float64Array(quads.length);
        for (let qIdx = 0; qIdx < quads.length; qIdx++) {
            const cand = traceCandidateLoop(qIdx, initSide, emptyBlocked);
            if (cand.isClosed && cand.steps.length >= 3 && cand.steps.length <= 32) {
                ringPriority[qIdx] = 100.0 - cand.steps.length;
            } else {
                ringPriority[qIdx] = -cand.steps.length;
            }
        }
        seedOrder.sort((a, b) => (ringPriority[b] - ringPriority[a]) || (a - b));
    }

    const visited = new Set();
    const loops = [];
    const quadToLoopId = new Int32Array(quads.length).fill(-1);
    const outQuadBaseColors = new Int32Array(quads.length);
    const outQuadParentIds  = new Int32Array(quads.length);

    for (let startQ of seedOrder) {
        if (visited.has(startQ)) continue;
        const { steps, isClosed } = traceCandidateLoop(startQ, initSide, visited);
        const loopId = loops.length;
        const baseColorHex = (activeInherited && activeInherited[startQ] >= 0)
            ? activeInherited[startQ]
            : LOOP_PALETTE[loopId % LOOP_PALETTE.length];
        const parentLoopId = (activeParentIds && activeParentIds[startQ] >= 0)
            ? activeParentIds[startQ]
            : loopId;

        const quadIndices = [];
        const centroid3D = new V3();
        let vCount = 0;
        for (let si = 0; si < steps.length; si++) {
            const s = steps[si];
            visited.add(s.qIdx);
            quadToLoopId[s.qIdx] = loopId;
            outQuadBaseColors[s.qIdx] = baseColorHex;
            outQuadParentIds[s.qIdx]  = parentLoopId;
            quadIndices.push(s.qIdx);
            const q = quads[s.qIdx];
            if (q) {
                for (let k = 0; k < 4; k++) {
                    centroid3D.add(toV3(vertices[q[k]]));
                    vCount++;
                }
            }
        }
        if (vCount > 0) centroid3D.divideScalar(vCount);

        loops.push({
            id: loopId,
            parentLoopId,
            baseColorHex,
            colorHex: baseColorHex,
            siblingIdx: 0,
            siblingCount: 1,
            isClosed,
            centroid3D,
            adjacentLoopWeights: new Map(),
            steps,
            quadIndices,
            maxPlanarityErr: 0,
            maxPlanarityErrorM: 0,
            meanPlanarityErr: 0,
            unrolled2D: null
        });
    }

    for (let [, qList] of edgeToQuadSides.entries()) {
        if (qList.length < 2) continue;
        for (let i = 0; i < qList.length; i++) {
            for (let j = i + 1; j < qList.length; j++) {
                const lA = quadToLoopId[qList[i].qIdx];
                const lB = quadToLoopId[qList[j].qIdx];
                if (lA >= 0 && lB >= 0 && lA !== lB) {
                    const wAB = (loops[lA].adjacentLoopWeights.get(lB) || 0) + 1;
                    loops[lA].adjacentLoopWeights.set(lB, wAB);
                    loops[lB].adjacentLoopWeights.set(lA, wAB);
                }
            }
        }
    }

    const parentGroups = new Map();
    for (let i = 0; i < loops.length; i++) {
        const loop = loops[i];
        if (!parentGroups.has(loop.parentLoopId)) parentGroups.set(loop.parentLoopId, []);
        parentGroups.get(loop.parentLoopId).push(loop);
    }

    for (let [, siblings] of parentGroups.entries()) {
        if (siblings.length > 1) {
            const meanC = new V3();
            for (let s of siblings) meanC.add(s.centroid3D);
            meanC.divideScalar(siblings.length);
            let maxDistSq = -1;
            let startSib = siblings[0];
            const sibIdSet = new Set(siblings.map(s => s.id));
            for (let s of siblings) {
                let internalNbrs = 0;
                for (let nbrId of s.adjacentLoopWeights.keys()) {
                    if (sibIdSet.has(nbrId)) internalNbrs++;
                }
                const dSq = s.centroid3D.distanceToSquared(meanC) + (internalNbrs <= 1 ? 1000.0 : 0);
                if (dSq > maxDistSq) { maxDistSq = dSq; startSib = s; }
            }

            const orderedSibs = [];
            const usedSibIds = new Set();
            let curr = startSib;
            while (curr) {
                orderedSibs.push(curr);
                usedSibIds.add(curr.id);
                let bestNext = null, bestScore = -Infinity;
                for (let cand of siblings) {
                    if (usedSibIds.has(cand.id)) continue;
                    const sharedEdges = curr.adjacentLoopWeights.get(cand.id) || 0;
                    const dist = curr.centroid3D.distanceTo(cand.centroid3D);
                    const score = sharedEdges * 100.0 - dist;
                    if (score > bestScore) { bestScore = score; bestNext = cand; }
                }
                curr = bestNext;
            }
            for (let idx = 0; idx < orderedSibs.length; idx++) {
                const sib = orderedSibs[idx];
                sib.siblingIdx = idx;
                sib.siblingCount = orderedSibs.length;
                sib.colorHex = computeParentColorShade(sib.baseColorHex, idx, orderedSibs.length);
            }
        }
    }

    const parentAdj = new Map();
    for (let pId of parentGroups.keys()) parentAdj.set(pId, new Map());
    for (let loop of loops) {
        const pA = loop.parentLoopId;
        for (let [nbrLoopId, w] of loop.adjacentLoopWeights.entries()) {
            const pB = loops[nbrLoopId].parentLoopId;
            if (pA !== pB) {
                const mapA = parentAdj.get(pA);
                mapA.set(pB, (mapA.get(pB) || 0) + w);
            }
        }
    }

    // Compute planarity metrics & 2D unrolled strips on every loop
    const computeUnroll = opts.computeUnroll !== false;
    const vertLoops = Array.from({ length: vertices.length }, () => new Set());
    let globalMaxRelErr = 0, globalSumRelErr = 0, globalMaxSkew = 0;
    let globalMaxErrM = 0, globalSumErrM = 0;

    for (let i = 0; i < loops.length; i++) {
        const loop = loops[i];
        let maxRel = 0, sumRel = 0, maxErrM = 0;
        for (let qIdx of loop.quadIndices) {
            const q = quads[qIdx];
            for (let k = 0; k < 4; k++) vertLoops[q[k]].add(loop.id);
            const { err, skewDist, relErr } = computeQuadPlanarity(vertices, q);
            if (relErr > maxRel) maxRel = relErr;
            if (err > maxErrM) maxErrM = err;
            if (relErr > globalMaxRelErr) globalMaxRelErr = relErr;
            if (err > globalMaxErrM) globalMaxErrM = err;
            if (skewDist > globalMaxSkew) globalMaxSkew = skewDist;
            sumRel += relErr;
            globalSumRelErr += relErr;
            globalSumErrM += err;
        }
        loop.maxPlanarityErr = maxRel;
        loop.maxPlanarityErrorM = maxErrM;
        loop.meanPlanarityErr = loop.quadIndices.length > 0 ? sumRel / loop.quadIndices.length : 0;
        if (computeUnroll) {
            loop.unrolled2D = unrollFaceLoop2D(vertices, quads, loop);
        }
    }

    let sharedVertCount = 0;
    for (let i = 0; i < vertLoops.length; i++) {
        if (vertLoops[i].size >= 2) sharedVertCount++;
    }

    const pqStats = {
        maxRelErr: globalMaxRelErr,
        meanRelErr: quads.length > 0 ? globalSumRelErr / quads.length : 0,
        maxSkewDist: globalMaxSkew,
        maxQuadPlanarityErrorM: globalMaxErrM,
        meanQuadPlanarityErrorM: quads.length > 0 ? globalSumErrM / quads.length : 0,
        sharedNegotiatedVerts: sharedVertCount,
        maxVertexShift: 0
    };

    const res = {
        directionMode: modeKey,
        loops,
        quadToLoopId,
        quadInheritedColors: outQuadBaseColors,
        quadParentLoopIds: outQuadParentIds,
        parentLoopAdjacency: parentAdj,
        pqStats
    };

    if (solidRef) {
        if (!solidRef.quadInheritedColors) solidRef.quadInheritedColors = { longitudinal: null, ring: null };
        if (!solidRef.quadParentLoopIds)   solidRef.quadParentLoopIds   = { longitudinal: null, ring: null };
        if (!solidRef.parentLoopAdjacency) solidRef.parentLoopAdjacency = { longitudinal: null, ring: null };
        solidRef.quadInheritedColors[modeKey] = outQuadBaseColors;
        solidRef.quadParentLoopIds[modeKey]   = outQuadParentIds;
        solidRef.parentLoopAdjacency[modeKey] = parentAdj;
        if (opts.updateActive !== false) {
            solidRef.directionMode = modeKey;
            solidRef.faceLoops = loops;
            solidRef.quadToLoopId = quadToLoopId;
            solidRef.pqStats = pqStats;
        }
    }
    return res;
}

function initSolidFaceLoops(solidData, activeDirectionMode = 'longitudinal') {
    if (!solidData || !solidData.quads) return solidData;
    solidData.quadInheritedColors = { longitudinal: null, ring: null };
    solidData.quadParentLoopIds   = { longitudinal: null, ring: null };
    solidData.parentLoopAdjacency = { longitudinal: null, ring: null };
    const modeKey = (activeDirectionMode === 'ring') ? 'ring' : 'longitudinal';
    const otherMode = (modeKey === 'ring') ? 'longitudinal' : 'ring';
    walkMeshFaceLoops(solidData.vertices, solidData.quads, otherMode, {
        solidData,
        computeUnroll: false,
        updateActive: false
    });
    walkMeshFaceLoops(solidData.vertices, solidData.quads, modeKey, {
        solidData,
        computeUnroll: true,
        updateActive: true
    });
    return solidData;
}

// Negotiated Adjacent-Face-Loop PQ Optimizer (supports both (solidData, iters, coupling, opts)
// and (vertices, quads, loops, iters, coupling)):
// Unpins junction vertices so shared boundary vertices negotiate smoothly without splitting quads into triangles!
function optimizeFaceLoopsToPQ(solidOrVerts, arg2 = 64, arg3 = 0.65, arg4 = {}, arg5 = 0.65) {
    let solidData = null;
    let vertices = null;
    let quads = null;
    let loops = null;
    let quadToLoopId = null;
    let iterations = 64;
    let coupling = 0.65;
    let opts = {};

    if (Array.isArray(solidOrVerts)) {
        vertices = solidOrVerts;
        quads = arg2 || [];
        const loopArg = arg3;
        loops = Array.isArray(loopArg) ? loopArg : (loopArg && loopArg.loops ? loopArg.loops : null);
        quadToLoopId = (loopArg && loopArg.quadToLoopId) ? loopArg.quadToLoopId : null;
        iterations = typeof arg4 === 'number' ? arg4 : 64;
        coupling = typeof arg5 === 'number' ? arg5 : 0.65;
    } else if (solidOrVerts && Array.isArray(solidOrVerts.vertices)) {
        solidData = solidOrVerts;
        vertices = solidData.vertices;
        quads = solidData.quads || [];
        iterations = typeof arg2 === 'number' ? arg2 : 64;
        coupling = typeof arg3 === 'number' ? arg3 : 0.65;
        opts = (arg4 && typeof arg4 === 'object') ? arg4 : {};
        if (!solidData.faceLoops || !solidData.quadToLoopId || solidData.quadToLoopId.length !== quads.length) {
            walkMeshFaceLoops(vertices, quads, solidData.directionMode || 'longitudinal', { solidData });
        }
        loops = solidData.faceLoops;
        quadToLoopId = solidData.quadToLoopId;
    } else {
        return null;
    }

    if (vertices.length === 0 || quads.length === 0) return null;
    if (!loops || loops.length === 0) {
        const walked = walkMeshFaceLoops(vertices, quads, 'longitudinal', { computeUnroll: false });
        loops = walked.loops;
        quadToLoopId = walked.quadToLoopId;
    }

    const nV = vertices.length;
    const isArrayVerts = !(vertices[0] && vertices[0].x !== undefined);
    const origVerts = vertices.map(v => toV3(v));
    const workVerts = vertices.map(v => toV3(v));

    const vertLoopSets = Array.from({ length: nV }, () => new Set());
    for (let qIdx = 0; qIdx < quads.length; qIdx++) {
        const lid = quadToLoopId ? (quadToLoopId[qIdx] ?? 0) : 0;
        const q = quads[qIdx];
        for (let k = 0; k < 4; k++) vertLoopSets[q[k]].add(lid);
    }

    const targetErrorM = opts.targetErrorM !== undefined ? Number(opts.targetErrorM) : 2e-6;
    const maxAllowedM = opts.maxQuadPlanarityErrorM !== undefined ? Number(opts.maxQuadPlanarityErrorM) : 0.0005;
    const totalIters = Math.max(8, Math.round(iterations));
    const accumDelta = Array.from({ length: nV }, () => new V3());
    const accumWeight = new Float64Array(nV);

    for (let iter = 0; iter < totalIters; iter++) {
        let iterMaxErrM = 0;
        for (let v = 0; v < nV; v++) {
            accumDelta[v].set(0, 0, 0);
            accumWeight[v] = 0;
        }

        for (let lIdx = 0; lIdx < loops.length; lIdx++) {
            const loop = loops[lIdx];
            let loopMaxRel = 0;
            for (let qIdx of loop.quadIndices) {
                const { err, relErr } = computeQuadPlanarity(workVerts, quads[qIdx]);
                if (relErr > loopMaxRel) loopMaxRel = relErr;
                if (err > iterMaxErrM) iterMaxErrM = err;
            }
            const loopWeight = 1.0 + 6.0 * loopMaxRel;

            for (let qIdx of loop.quadIndices) {
                const q = quads[qIdx];
                const { h, err, normal } = computeQuadPlanarity(workVerts, q);
                if (err < 1e-12) continue;
                const qBoost = err > maxAllowedM * 0.5 ? 2.5 : 1.0;

                for (let k = 0; k < 4; k++) {
                    const vIdx = q[k];
                    const isSharedBoundary = vertLoopSets[vIdx].size >= 2;
                    const w = (isSharedBoundary ? loopWeight * coupling : loopWeight) * qBoost;
                    const sign = (k % 2 === 0) ? -1 : 1;
                    accumDelta[vIdx].addScaledVector(normal, sign * h * w);
                    accumWeight[vIdx] += w;
                }
            }
        }

        if (iterMaxErrM <= targetErrorM) break;
        const step = 0.85;
        for (let v = 0; v < nV; v++) {
            if (accumWeight[v] > 0) {
                workVerts[v].addScaledVector(accumDelta[v], step / accumWeight[v]);
            }
        }
    }

    // Polish pass if any quad exceeds 2e-5 m before round6 snapping so every preset has >=10x PQ margin
    let postStats = computeMeshPlanarityStats(workVerts, quads);
    if (postStats.maxQuadPlanarityErrorM > Math.min(2e-5, maxAllowedM * 0.1)) {
        planarizeQuadMesh(workVerts, quads, null, {
            iterations: 180,
            targetErrorM: Math.min(2e-6, maxAllowedM * 0.02)
        });
    }

    // Snap to 1e-6 m so in-memory vertices match .mesh.obj bit-for-bit
    const r6 = (val) => Math.round(val * 1e6) / 1e6;
    let maxShift = 0;
    for (let i = 0; i < nV; i++) {
        workVerts[i].x = r6(workVerts[i].x);
        workVerts[i].y = r6(workVerts[i].y);
        workVerts[i].z = r6(workVerts[i].z);
        const sh = workVerts[i].distanceTo(origVerts[i]);
        if (sh > maxShift) maxShift = sh;
        if (isArrayVerts) {
            vertices[i][0] = workVerts[i].x;
            vertices[i][1] = workVerts[i].y;
            vertices[i][2] = workVerts[i].z;
        } else {
            vertices[i].x = workVerts[i].x;
            vertices[i].y = workVerts[i].y;
            vertices[i].z = workVerts[i].z;
        }
    }

    const walkedAfter = walkMeshFaceLoops(vertices, quads, solidData ? (solidData.directionMode || 'longitudinal') : 'longitudinal', {
        solidData,
        computeUnroll: true
    });
    walkedAfter.pqStats.maxVertexShift = maxShift;

    if (solidData) {
        solidData.planarity = computeMeshPlanarityStats(vertices, quads);
        solidData.pqStats = walkedAfter.pqStats;
        solidData.pqOptimizationApplied = true;
        solidData.signedVolume = computeSignedMeshVolume(vertices, quads, solidData.triangles || []);
    }
    return walkedAfter.pqStats;
}


export {
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
};

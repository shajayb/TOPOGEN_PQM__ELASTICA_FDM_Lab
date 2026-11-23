/**
 * WFC-FDM Foundry — Core Module 2: 3D Wave Function Collapse & Graph Conditioning
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 *
 * Student Quick-Map:
 *   - Edit WFC entropy / Adjacency Growth / XY symmetry propagation -> runWFCSolver()
 *   - Edit voxel-to-centerline welding & collinear node merging     -> buildWeldedGraphFromVoxels()
 *   - Edit short-bar collapse, T-junction split, or acute V-merges  -> cleanAndWeldGraph()
 *
 * Inputs:  Grid resolution [nx,ny,nz], tile templates & presets, raw [x,y,z] graphs
 * Outputs: Welded single-component centerline graphs { vertices, edges, anchors, boundingBox }
 */

import {
    V3,
    toV3,
    toArr3,
    mulberry32,
    DIRS,
    TILE_NULL,
    TILE_CROSS,
    TILE_VTUBE,
    TILE_HTUBE,
    TILE_HTUBE_Y,
    TILE_XBRACE_XZ,
    TILE_XBRACE_YZ,
    TILE_DIAG_PYR,
    TILE_ARCH_VAULT,
    TILE_TRIPOD_LEG,
    TILE_DIAPHRAGM,
    TILE_FUNICULAR_VAULT,
    TILE_SLENDER_DIAGRID,
    TILE_HYPERBOLOID,
    TILE_CATENARY_QUADRIPOD,
    createTileTemplates,
    TILE_PRESETS,
    applyTilePresetToTiles,
    buildAdjacencyRules
} from './math_tiles.mjs';

// --- Pure-JS WFC / Adjacency Growth Solver ---
function runWFCSolver(options = {}) {
    const [gx, gy, gz] = options.gridResolution || [3, 3, 6];
    const voxelSize = options.voxelSize || 1.0;
    const algorithm = options.algorithm || 'wfc';
    const tilePreset = options.tilePreset || 'arch_braced';
    const ruleMode = options.ruleMode || 'socket';
    const wfcSeed = options.wfcSeed !== undefined ? options.wfcSeed : 42;
    const symmetryXY = !!options.symmetryXY;
    const rng = mulberry32(wfcSeed);

    const tiles = createTileTemplates();
    const preset = applyTilePresetToTiles(tiles, tilePreset, options);
    const adjRules = buildAdjacencyRules(tiles, ruleMode);

    const inBounds = (x, y, z) => x >= 0 && x < gx && y >= 0 && y < gy && z >= 0 && z < gz;
    const vIdx = (x, y, z) => x + y * gx + z * gx * gy;
    const isAllowed = (tileA, tileB, dirIdx) => {
        if (!tiles[tileA] || !tiles[tileB] || !tiles[tileA].enabled || !tiles[tileB].enabled) return false;
        const d = DIRS[dirIdx];
        return d.sign === 1 ? !!adjRules[d.axis][tileA][tileB] : !!adjRules[d.axis][tileB][tileA];
    };

    const enabledDomain = tiles.map(t => t.enabled);
    const voxels = [];
    for (let z = 0; z < gz; z++) {
        for (let y = 0; y < gy; y++) {
            for (let x = 0; x < gx; x++) {
                voxels.push({
                    x, y, z, idx: vIdx(x, y, z),
                    collapsed: false, tile: null,
                    domain: [...enabledDomain], inFrontier: false
                });
            }
        }
    }

    const frontier = [];
    const collapse = (idx, tileId) => {
        const c = voxels[idx];
        c.collapsed = true;
        c.tile = tileId;
        c.domain = Array(tiles.length).fill(false);
        c.domain[tileId] = true;
        c.inFrontier = false;
        if (tileId !== TILE_NULL) {
            for (let d = 0; d < 6; d++) {
                const nx = c.x + DIRS[d].dx, ny = c.y + DIRS[d].dy, nz = c.z + DIRS[d].dz;
                if (inBounds(nx, ny, nz)) {
                    const nIdx = vIdx(nx, ny, nz);
                    if (!voxels[nIdx].collapsed && !voxels[nIdx].inFrontier) {
                        voxels[nIdx].inFrontier = true;
                        frontier.push(nIdx);
                    }
                }
            }
        }
    };

    const propagate = (queue) => {
        const stack = [...queue];
        while (stack.length > 0) {
            const curr = voxels[stack.pop()];
            const currPossible = [];
            for (let t = 0; t < tiles.length; t++) if (curr.domain[t]) currPossible.push(t);
            if (currPossible.length === 0) continue;
            for (let d = 0; d < 6; d++) {
                const nx = curr.x + DIRS[d].dx, ny = curr.y + DIRS[d].dy, nz = curr.z + DIRS[d].dz;
                if (!inBounds(nx, ny, nz)) continue;
                const nIdx = vIdx(nx, ny, nz);
                const nb = voxels[nIdx];
                if (nb.collapsed) continue;
                let changed = false;
                for (let nt = 0; nt < tiles.length; nt++) {
                    if (!nb.domain[nt]) continue;
                    let supported = false;
                    for (let i = 0; i < currPossible.length; i++) {
                        if (isAllowed(currPossible[i], nt, d)) { supported = true; break; }
                    }
                    if (!supported) { nb.domain[nt] = false; changed = true; }
                }
                if (changed) stack.push(nIdx);
            }
        }
    };

    const pickWeighted = (cands) => {
        let total = 0;
        for (let i = 0; i < cands.length; i++) total += tiles[cands[i]].weight;
        let r = rng() * total;
        for (let i = 0; i < cands.length; i++) {
            r -= tiles[cands[i]].weight;
            if (r <= 0) return cands[i];
        }
        return cands[cands.length - 1];
    };

    // Seed center voxel
    const cx = Math.floor(gx / 2), cy = Math.floor(gy / 2), cz = Math.floor(gz / 2);
    const seedKey = options.seedTile || preset.seedTile || 'cross';
    let seedTileIdx = tiles.findIndex(t => t.key === seedKey && t.enabled);
    if (seedTileIdx === -1) seedTileIdx = tiles.findIndex((t, i) => i > 0 && t.enabled);
    if (seedTileIdx !== -1) {
        const sIdx = vIdx(cx, cy, cz);
        collapse(sIdx, seedTileIdx);
        if (algorithm === 'wfc') propagate([sIdx]);
    }

    const maxSteps = options.maxSteps || (gx * gy * gz + 16);
    let steps = 0;
    while (steps < maxSteps) {
        if (algorithm === 'growth') {
            // Remove collapsed from frontier
            let fLen = 0;
            for (let i = 0; i < frontier.length; i++) {
                if (!voxels[frontier[i]].collapsed) frontier[fLen++] = frontier[i];
            }
            frontier.length = fLen;
            if (frontier.length === 0) {
                const rem = voxels.filter(v => !v.collapsed);
                if (rem.length === 0) break;
                const pick = rem[Math.floor(rng() * rem.length)];
                frontier.push(pick.idx);
                pick.inFrontier = true;
            }
            const fPos = Math.floor(rng() * frontier.length);
            const cellIdx = frontier.splice(fPos, 1)[0];
            const cell = voxels[cellIdx];
            cell.inFrontier = false;
            const valid = [];
            for (let t = 0; t < tiles.length; t++) {
                if (!tiles[t].enabled) continue;
                let ok = true;
                for (let d = 0; d < 6; d++) {
                    const nx = cell.x + DIRS[d].dx, ny = cell.y + DIRS[d].dy, nz = cell.z + DIRS[d].dz;
                    if (inBounds(nx, ny, nz)) {
                        const nb = voxels[vIdx(nx, ny, nz)];
                        if (nb.collapsed && nb.tile !== null && !isAllowed(t, nb.tile, d)) { ok = false; break; }
                    }
                }
                if (ok) valid.push(t);
            }
            const nonNull = valid.filter(t => t !== TILE_NULL);
            const pool = (nonNull.length > 0 && rng() < 0.78) ? nonNull : valid;
            collapse(cellIdx, pool.length > 0 ? pickWeighted(pool) : TILE_NULL);
            steps++;
        } else {
            let minEntropy = Infinity;
            let cands = [];
            for (let i = 0; i < voxels.length; i++) {
                const v = voxels[i];
                if (v.collapsed) continue;
                let count = 0;
                for (let t = 0; t < tiles.length; t++) if (v.domain[t] && tiles[t].enabled) count++;
                if (count === 0) {
                    collapse(i, TILE_NULL);
                    steps++;
                    cands = null;
                    break;
                }
                let hasNb = false;
                for (let d = 0; d < 6; d++) {
                    const nx = v.x + DIRS[d].dx, ny = v.y + DIRS[d].dy, nz = v.z + DIRS[d].dz;
                    if (inBounds(nx, ny, nz)) {
                        const nb = voxels[vIdx(nx, ny, nz)];
                        if (nb.collapsed && nb.tile !== TILE_NULL) { hasNb = true; break; }
                    }
                }
                const score = count - (hasNb ? 0.35 : 0);
                if (score < minEntropy - 1e-6) { minEntropy = score; cands = [i]; }
                else if (Math.abs(score - minEntropy) <= 1e-6) cands.push(i);
            }
            if (cands === null) continue;
            if (cands.length === 0) break;
            const pickIdx = cands[Math.floor(rng() * cands.length)];
            const cell = voxels[pickIdx];
            const valid = [];
            for (let t = 0; t < tiles.length; t++) if (cell.domain[t] && tiles[t].enabled) valid.push(t);
            const chosen = valid.length > 0 ? pickWeighted(valid) : TILE_NULL;
            collapse(pickIdx, chosen);
            propagate([pickIdx]);
            steps++;
        }
    }

    // Optional XY mirror symmetry for balanced 4-corner towers
    if (symmetryXY) {
        for (let z = 0; z < gz; z++) {
            for (let y = 0; y < Math.ceil(gy / 2); y++) {
                for (let x = 0; x < Math.ceil(gx / 2); x++) {
                    const t = voxels[vIdx(x, y, z)].tile;
                    const mx = gx - 1 - x;
                    const my = gy - 1 - y;
                    voxels[vIdx(mx, y, z)].tile = t;
                    voxels[vIdx(x, my, z)].tile = t;
                    voxels[vIdx(mx, my, z)].tile = t;
                }
            }
        }
    }

    return { voxels, tiles, gridResolution: [gx, gy, gz], voxelSize, algorithm, wfcSeed, tilePreset, steps };
}

// --- Welded Centerline Graph Builder ---
function computeBoundingBox(vertices) {
    if (!vertices || vertices.length === 0) return { min: [0, 0, 0], max: [0, 0, 0] };
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertices.length; i++) {
        const p = vertices[i];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        if (p[2] < minZ) minZ = p[2]; if (p[2] > maxZ) maxZ = p[2];
    }
    return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function buildWeldedGraphFromVoxels(voxels, tiles, gridResolution, voxelSize = 1.0, options = {}) {
    const [gx, gy, gz] = gridResolution;
    const weldTol = options.weldTol !== undefined ? options.weldTol : 1e-4;
    const mergeCollinear = options.mergeCollinear !== undefined ? options.mergeCollinear : true;
    const origin = { x: -(gx * voxelSize) / 2, y: -(gy * voxelSize) / 2, z: 0 };

    const invTol = 1 / Math.max(weldTol, 1e-8);
    const grid = new Map();
    const verts = [];
    const edgeSet = new Set();
    const rawEdges = [];
    let rawVertexCount = 0;
    let rawEdgeCount = 0;

    const weldPoint = (x, y, z) => {
        const gxI = Math.round(x * invTol), gyI = Math.round(y * invTol), gzI = Math.round(z * invTol);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = grid.get(`${gxI + dx}_${gyI + dy}_${gzI + dz}`);
                    if (!bucket) continue;
                    for (let k = 0; k < bucket.length; k++) {
                        const idx = bucket[k];
                        const q = verts[idx];
                        const ddx = x - q[0], ddy = y - q[1], ddz = z - q[2];
                        if (ddx * ddx + ddy * ddy + ddz * ddz <= weldTol * weldTol) return idx;
                    }
                }
            }
        }
        const idx = verts.length;
        verts.push([x, y, z]);
        const key = `${gxI}_${gyI}_${gzI}`;
        let b = grid.get(key);
        if (!b) { b = []; grid.set(key, b); }
        b.push(idx);
        return idx;
    };

    for (let i = 0; i < voxels.length; i++) {
        const v = voxels[i];
        if (!v.collapsed || v.tile === null || v.tile === TILE_NULL) continue;
        const tileDef = tiles[v.tile];
        if (!tileDef || !tileDef.graph || !tileDef.graph.edges || tileDef.graph.edges.length === 0) continue;
        const cx = origin.x + (v.x + 0.5) * voxelSize;
        const cy = origin.y + (v.y + 0.5) * voxelSize;
        const cz = origin.z + (v.z + 0.5) * voxelSize;
        const tv = tileDef.graph.vertices;
        const te = tileDef.graph.edges;
        rawVertexCount += tv.length;
        rawEdgeCount += te.length;

        const localMap = new Int32Array(tv.length);
        for (let j = 0; j < tv.length; j++) {
            localMap[j] = weldPoint(cx + tv[j][0] * voxelSize, cy + tv[j][1] * voxelSize, cz + tv[j][2] * voxelSize);
        }
        for (let j = 0; j < te.length; j++) {
            const u = localMap[te[j][0]], w = localMap[te[j][1]];
            if (u === w) continue;
            const a = Math.min(u, w), b = Math.max(u, w);
            const key = `${a}_${b}`;
            if (!edgeSet.has(key)) { edgeSet.add(key); rawEdges.push([a, b]); }
        }
    }

    let finalVerts = verts;
    let finalEdges = rawEdges;

    if (mergeCollinear && finalVerts.length > 0 && finalEdges.length > 0) {
        const adj = Array.from({ length: finalVerts.length }, () => new Set());
        for (let i = 0; i < finalEdges.length; i++) {
            adj[finalEdges[i][0]].add(finalEdges[i][1]);
            adj[finalEdges[i][1]].add(finalEdges[i][0]);
        }
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < finalVerts.length; i++) {
                if (adj[i].size !== 2) continue;
                const nbrs = Array.from(adj[i]);
                const a = nbrs[0], b = nbrs[1];
                if (a === b || adj[a].has(b)) continue;
                const p = finalVerts[i], pa = finalVerts[a], pb = finalVerts[b];
                const ax = pa[0] - p[0], ay = pa[1] - p[1], az = pa[2] - p[2];
                const bx = pb[0] - p[0], by = pb[1] - p[1], bz = pb[2] - p[2];
                const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
                if (la < 1e-8 || lb < 1e-8) continue;
                const dot = (ax * bx + ay * by + az * bz) / (la * lb);
                if (dot < -0.9999) {
                    adj[i].clear(); adj[a].delete(i); adj[b].delete(i);
                    adj[a].add(b); adj[b].add(a);
                    changed = true;
                }
            }
        }
        const remap = new Int32Array(finalVerts.length).fill(-1);
        const compVerts = [];
        for (let i = 0; i < finalVerts.length; i++) {
            if (adj[i].size > 0) { remap[i] = compVerts.length; compVerts.push(finalVerts[i]); }
        }
        const compEdgeSet = new Set();
        const compEdges = [];
        for (let i = 0; i < finalVerts.length; i++) {
            if (remap[i] === -1) continue;
            const u = remap[i];
            for (const nb of adj[i]) {
                const w = remap[nb];
                if (u < w) {
                    const key = `${u}_${w}`;
                    if (!compEdgeSet.has(key)) { compEdgeSet.add(key); compEdges.push([u, w]); }
                }
            }
        }
        finalVerts = compVerts;
        finalEdges = compEdges;
    }

    const valences = new Array(finalVerts.length).fill(0);
    for (let i = 0; i < finalEdges.length; i++) {
        valences[finalEdges[i][0]]++;
        valences[finalEdges[i][1]]++;
    }

    return {
        vertices: finalVerts,
        edges: finalEdges,
        valences,
        rawVertexCount,
        rawEdgeCount,
        weldTol,
        collinearMerged: mergeCollinear,
        boundingBox: computeBoundingBox(finalVerts)
    };
}

// --- Graph Connectivity & Cleanup ---
function extractLargestComponent(vertices, edges) {
    const n = vertices.length;
    if (n === 0 || edges.length === 0) return { vertices: [], edges: [], valences: [], boundingBox: computeBoundingBox([]) };
    const adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < edges.length; i++) {
        adj[edges[i][0]].push(edges[i][1]);
        adj[edges[i][1]].push(edges[i][0]);
    }
    const visited = new Uint8Array(n);
    let bestComp = [];
    for (let i = 0; i < n; i++) {
        if (visited[i] || adj[i].length === 0) continue;
        const comp = [];
        const q = [i];
        visited[i] = 1;
        while (q.length > 0) {
            const u = q.pop();
            comp.push(u);
            const nbs = adj[u];
            for (let k = 0; k < nbs.length; k++) {
                if (!visited[nbs[k]]) { visited[nbs[k]] = 1; q.push(nbs[k]); }
            }
        }
        if (comp.length > bestComp.length) bestComp = comp;
    }
    const remap = new Int32Array(n).fill(-1);
    const newVerts = [];
    for (let i = 0; i < bestComp.length; i++) {
        remap[bestComp[i]] = i;
        newVerts.push([...vertices[bestComp[i]]]);
    }
    const newEdges = [];
    for (let i = 0; i < edges.length; i++) {
        const u = remap[edges[i][0]], v = remap[edges[i][1]];
        if (u !== -1 && v !== -1 && u !== v) newEdges.push([Math.min(u, v), Math.max(u, v)]);
    }
    const valences = new Array(newVerts.length).fill(0);
    for (let i = 0; i < newEdges.length; i++) { valences[newEdges[i][0]]++; valences[newEdges[i][1]]++; }
    return { vertices: newVerts, edges: newEdges, valences, boundingBox: computeBoundingBox(newVerts) };
}

function pruneNonAnchorLeaves(vertices, edges, anchors) {
    const n = vertices.length;
    const anchorSet = new Set(anchors || []);
    const adj = Array.from({ length: n }, () => new Set());
    for (let i = 0; i < edges.length; i++) {
        adj[edges[i][0]].add(edges[i][1]);
        adj[edges[i][1]].add(edges[i][0]);
    }
    let changed = true;
    while (changed) {
        changed = false;
        for (let i = 0; i < n; i++) {
            if (anchorSet.has(i)) continue;
            if (adj[i].size === 1) {
                const nb = adj[i].values().next().value;
                adj[i].clear();
                adj[nb].delete(i);
                changed = true;
            }
        }
    }
    const remap = new Int32Array(n).fill(-1);
    const newVerts = [];
    for (let i = 0; i < n; i++) {
        if (adj[i].size > 0 || anchorSet.has(i)) {
            remap[i] = newVerts.length;
            newVerts.push([...vertices[i]]);
        }
    }
    const edgeSet = new Set();
    const newEdges = [];
    for (let i = 0; i < n; i++) {
        if (remap[i] === -1) continue;
        const u = remap[i];
        for (const nb of adj[i]) {
            const w = remap[nb];
            if (w !== -1 && u < w) {
                const k = `${u}_${w}`;
                if (!edgeSet.has(k)) { edgeSet.add(k); newEdges.push([u, w]); }
            }
        }
    }
    const newAnchors = (anchors || []).map(a => remap[a]).filter(a => a !== -1);
    return { vertices: newVerts, edges: newEdges, anchors: newAnchors, boundingBox: computeBoundingBox(newVerts) };
}

function collapseShortEdges(vertices, edges, anchors, minLen = 0.05) {
    if (!vertices || vertices.length === 0 || !edges || edges.length === 0 || minLen <= 0) {
        return { vertices, edges, anchors, collapsedCount: 0 };
    }
    const verts = vertices.map(p => [p[0], p[1], p[2]]);
    const parent = Int32Array.from({ length: verts.length }, (_, i) => i);
    const anchorSet = new Set(anchors || []);
    const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };

    let collapsedCount = 0;
    let curEdges = edges.map(e => [e[0], e[1]]);

    for (let iter = 0; iter < 500; iter++) {
        let bestIdx = -1, bestLen = minLen;
        for (let k = 0; k < curEdges.length; k++) {
            const u = find(curEdges[k][0]), v = find(curEdges[k][1]);
            if (u === v) continue;
            if (anchorSet.has(u) && anchorSet.has(v)) continue;
            const pu = verts[u], pv = verts[v];
            const L = Math.hypot(pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]);
            if (L < bestLen) { bestLen = L; bestIdx = k; }
        }
        if (bestIdx === -1) break;
        let u = find(curEdges[bestIdx][0]);
        let v = find(curEdges[bestIdx][1]);
        if (anchorSet.has(v) && !anchorSet.has(u)) { const tmp = u; u = v; v = tmp; }
        if (!anchorSet.has(u)) {
            verts[u] = [
                0.5 * (verts[u][0] + verts[v][0]),
                0.5 * (verts[u][1] + verts[v][1]),
                0.5 * (verts[u][2] + verts[v][2])
            ];
        }
        parent[v] = u;
        collapsedCount++;
    }

    if (collapsedCount === 0) return { vertices, edges, anchors, collapsedCount: 0 };

    const remap = new Int32Array(verts.length).fill(-1);
    const newVerts = [];
    const edgeSet = new Set();
    const newEdges = [];
    for (let k = 0; k < curEdges.length; k++) {
        const u = find(curEdges[k][0]), v = find(curEdges[k][1]);
        if (u === v) continue;
        if (remap[u] === -1) { remap[u] = newVerts.length; newVerts.push(verts[u]); }
        if (remap[v] === -1) { remap[v] = newVerts.length; newVerts.push(verts[v]); }
        const a = Math.min(remap[u], remap[v]), b = Math.max(remap[u], remap[v]);
        const key = `${a}_${b}`;
        if (!edgeSet.has(key)) { edgeSet.add(key); newEdges.push([a, b]); }
    }
    const newAnchors = [...new Set((anchors || []).map(a => remap[find(a)]).filter(a => a !== -1))];
    return { vertices: newVerts, edges: newEdges, anchors: newAnchors, collapsedCount };
}

// Weld any distinct graph nodes that converged to the same (or nearly same) 3D position after FDM
// (e.g. symmetric unlinked nodes in diagrid/octahedral cells). Prevents overlapping non-manifold joints!
function weldCoincidentGraphNodes(vertices, edges, anchors, tol = 0.015) {
    if (!vertices || vertices.length < 2 || !edges || edges.length === 0 || tol <= 0) {
        return { vertices, edges, anchors, weldedCount: 0 };
    }
    const n = vertices.length;
    const anchorSet = new Set(anchors || []);
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (i) => {
        while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
        return i;
    };
    const tolSq = tol * tol;
    let weldedCount = 0;
    for (let i = 0; i < n; i++) {
        const ri = find(i);
        const pi = vertices[ri];
        for (let j = i + 1; j < n; j++) {
            const rj = find(j);
            if (ri === rj) continue;
            if (anchorSet.has(ri) && anchorSet.has(rj)) continue;
            const pj = vertices[rj];
            const dx = pj[0] - pi[0], dy = pj[1] - pi[1], dz = pj[2] - pi[2];
            if (dx * dx + dy * dy + dz * dz <= tolSq) {
                if (anchorSet.has(rj) && !anchorSet.has(ri)) {
                    parent[ri] = rj;
                } else {
                    parent[rj] = ri;
                }
                weldedCount++;
            }
        }
    }
    if (weldedCount === 0) return { vertices, edges, anchors, weldedCount: 0 };

    // Average positions of non-anchor merged clusters
    const sum = Array.from({ length: n }, () => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) {
        const r = find(i);
        sum[r][0] += vertices[i][0];
        sum[r][1] += vertices[i][1];
        sum[r][2] += vertices[i][2];
        sum[r][3] += 1;
    }
    const remap = new Int32Array(n).fill(-1);
    const newVerts = [];
    const edgeSet = new Set();
    const newEdges = [];
    for (let k = 0; k < edges.length; k++) {
        const u = find(edges[k][0]), v = find(edges[k][1]);
        if (u === v) continue;
        if (remap[u] === -1) {
            remap[u] = newVerts.length;
            newVerts.push(anchorSet.has(u)
                ? [...vertices[u]]
                : [sum[u][0] / sum[u][3], sum[u][1] / sum[u][3], sum[u][2] / sum[u][3]]);
        }
        if (remap[v] === -1) {
            remap[v] = newVerts.length;
            newVerts.push(anchorSet.has(v)
                ? [...vertices[v]]
                : [sum[v][0] / sum[v][3], sum[v][1] / sum[v][3], sum[v][2] / sum[v][3]]);
        }
        const a = Math.min(remap[u], remap[v]), b = Math.max(remap[u], remap[v]);
        const key = `${a}_${b}`;
        if (!edgeSet.has(key)) { edgeSet.add(key); newEdges.push([a, b]); }
    }
    const newAnchors = [...new Set((anchors || []).map(a => remap[find(a)]).filter(a => a !== -1))];
    return { vertices: newVerts, edges: newEdges, anchors: newAnchors, weldedCount };
}

function splitEdgesPassingNearNodes(vertices, edges, tol = 0.02) {
    if (!vertices || vertices.length < 3 || !edges || edges.length === 0 || tol <= 0) {
        return { edges, splitCount: 0 };
    }
    const tolSq = tol * tol;
    let curEdges = edges.map(e => [Math.min(e[0], e[1]), Math.max(e[0], e[1])]);
    let totalSplits = 0;

    for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        const edgeSet = new Set();
        const nextEdges = [];
        const addEdge = (a, b) => {
            if (a === b) return;
            const u = Math.min(a, b), v = Math.max(a, b);
            const k = `${u}_${v}`;
            if (!edgeSet.has(k)) { edgeSet.add(k); nextEdges.push([u, v]); }
        };

        for (let ei = 0; ei < curEdges.length; ei++) {
            const [u, v] = curEdges[ei];
            const pu = vertices[u], pv = vertices[v];
            const dx = pv[0] - pu[0], dy = pv[1] - pu[1], dz = pv[2] - pu[2];
            const lenSq = dx * dx + dy * dy + dz * dz;
            if (lenSq < 1e-10) continue;

            // Find any vertex w lying inside the cylinder of segment (u, v)
            const hits = [];
            for (let w = 0; w < vertices.length; w++) {
                if (w === u || w === v) continue;
                const pw = vertices[w];
                const wx = pw[0] - pu[0], wy = pw[1] - pu[1], wz = pw[2] - pu[2];
                const t = (wx * dx + wy * dy + wz * dz) / lenSq;
                if (t <= 0.03 || t >= 0.97) continue;
                const px = wx - t * dx, py = wy - t * dy, pz = wz - t * dz;
                const dSq = px * px + py * py + pz * pz;
                if (dSq <= tolSq) hits.push({ w, t });
            }

            if (hits.length === 0) {
                addEdge(u, v);
            } else {
                hits.sort((a, b) => a.t - b.t);
                let prev = u;
                for (let h = 0; h < hits.length; h++) {
                    addEdge(prev, hits[h].w);
                    prev = hits[h].w;
                }
                addEdge(prev, v);
                totalSplits++;
                changed = true;
            }
        }
        curEdges = nextEdges;
        if (!changed) break;
    }
    return { edges: curEdges, splitCount: totalSplits };
}

function mergeAcuteIncidentEdges(vertices, edges, anchors, minAngleDeg = 13.0) {
    if (!vertices || vertices.length < 3 || !edges || edges.length < 2 || minAngleDeg <= 0) {
        return { vertices, edges, anchors, mergedCount: 0 };
    }
    const cosThresh = Math.cos((minAngleDeg * Math.PI) / 180.0);
    let curVerts = vertices.map(p => [p[0], p[1], p[2]]);
    let curEdges = edges.map(e => [Math.min(e[0], e[1]), Math.max(e[0], e[1])]);
    let curAnchors = [...(anchors || [])];
    let totalMerged = 0;

    for (let pass = 0; pass < 36; pass++) {
        const n = curVerts.length;
        const anchorSet = new Set(curAnchors);
        const adj = Array.from({ length: n }, () => []);
        for (let ei = 0; ei < curEdges.length; ei++) {
            adj[curEdges[ei][0]].push(ei);
            adj[curEdges[ei][1]].push(ei);
        }

        let bestPair = null;
        let worstCos = cosThresh;

        for (let u = 0; u < n; u++) {
            const inc = adj[u];
            if (inc.length < 2) continue;
            for (let i = 0; i < inc.length; i++) {
                const eA = curEdges[inc[i]];
                const vA = eA[0] === u ? eA[1] : eA[0];
                const dxA = curVerts[vA][0] - curVerts[u][0];
                const dyA = curVerts[vA][1] - curVerts[u][1];
                const dzA = curVerts[vA][2] - curVerts[u][2];
                const lenA = Math.hypot(dxA, dyA, dzA);
                if (lenA < 1e-8) continue;

                for (let j = i + 1; j < inc.length; j++) {
                    const eB = curEdges[inc[j]];
                    const vB = eB[0] === u ? eB[1] : eB[0];
                    if (vA === vB) continue;
                    if (anchorSet.has(vA) && anchorSet.has(vB)) continue;
                    const dxB = curVerts[vB][0] - curVerts[u][0];
                    const dyB = curVerts[vB][1] - curVerts[u][1];
                    const dzB = curVerts[vB][2] - curVerts[u][2];
                    const lenB = Math.hypot(dxB, dyB, dzB);
                    if (lenB < 1e-8) continue;

                    const cosAng = (dxA * dxB + dyA * dyB + dzA * dzB) / (lenA * lenB);
                    if (cosAng > worstCos) {
                        worstCos = cosAng;
                        bestPair = { u, eiA: inc[i], vA, lenA, eiB: inc[j], vB, lenB };
                    }
                }
            }
        }

        if (!bestPair) break;

        const isAShort = bestPair.lenA <= bestPair.lenB;
        const vShort = isAShort ? bestPair.vA : bestPair.vB;
        const vLong  = isAShort ? bestPair.vB : bestPair.vA;
        const eiLong = isAShort ? bestPair.eiB : bestPair.eiA;
        const lenShort = isAShort ? bestPair.lenA : bestPair.lenB;
        const lenLong  = isAShort ? bestPair.lenB : bestPair.lenA;

        if (lenShort < 0.82 * lenLong) {
            // Reroute (u, vLong) -> (vShort, vLong) serial chain, eliminating acute V-fork
            const edgeSet = new Set();
            const nextEdges = [];
            for (let ei = 0; ei < curEdges.length; ei++) {
                let [a, b] = ei === eiLong ? [vShort, vLong] : curEdges[ei];
                if (a === b) continue;
                if (a > b) { const t = a; a = b; b = t; }
                const k = `${a}_${b}`;
                if (!edgeSet.has(k)) { edgeSet.add(k); nextEdges.push([a, b]); }
            }
            curEdges = nextEdges;
            totalMerged++;
        } else {
            // Endpoints vShort and vLong are nearly coincident twin nodes: merge them
            let keep = vShort, drop = vLong;
            if (anchorSet.has(vLong) && !anchorSet.has(vShort)) { keep = vLong; drop = vShort; }
            if (!anchorSet.has(keep)) {
                curVerts[keep] = [
                    0.5 * (curVerts[keep][0] + curVerts[drop][0]),
                    0.5 * (curVerts[keep][1] + curVerts[drop][1]),
                    0.5 * (curVerts[keep][2] + curVerts[drop][2])
                ];
            }
            const remap = new Int32Array(n).fill(-1);
            const nextVerts = [];
            for (let vi = 0; vi < n; vi++) {
                if (vi === drop) continue;
                remap[vi] = nextVerts.length;
                nextVerts.push(curVerts[vi]);
            }
            remap[drop] = remap[keep];
            const edgeSet = new Set();
            const nextEdges = [];
            for (let ei = 0; ei < curEdges.length; ei++) {
                let a = remap[curEdges[ei][0]], b = remap[curEdges[ei][1]];
                if (a === b || a === -1 || b === -1) continue;
                if (a > b) { const t = a; a = b; b = t; }
                const k = `${a}_${b}`;
                if (!edgeSet.has(k)) { edgeSet.add(k); nextEdges.push([a, b]); }
            }
            curVerts = nextVerts;
            curEdges = nextEdges;
            curAnchors = [...new Set(curAnchors.map(a => remap[a]).filter(a => a !== -1))];
            totalMerged++;
        }
    }

    return { vertices: curVerts, edges: curEdges, anchors: curAnchors, mergedCount: totalMerged };
}

function removeAnchorToAnchorEdges(vertices, edges, anchors) {
    const anchorSet = new Set(anchors || []);
    const filtered = edges.filter(([u, v]) => !(anchorSet.has(u) && anchorSet.has(v)));
    return filtered.length > 0 ? filtered : edges;
}

// Unified Post-FDM Graph Welding & Conditioning Helper:
// Combines weldCoincidentGraphNodes, splitEdgesPassingNearNodes, mergeAcuteIncidentEdges, and collapseShortEdges
// so both headless generateCandidate AND interactive browser UI weld coincident nodes & T-junctions before solidification!
function cleanAndWeldGraph(inVertices, inEdges, inAnchors = [], options = {}) {
    if (!inVertices || inVertices.length === 0 || !inEdges || inEdges.length === 0) {
        return {
            vertices: (inVertices || []).map(p => toArr3(p)),
            edges: [],
            anchors: [...(inAnchors || [])],
            valences: [],
            boundingBox: computeBoundingBox([]),
            weldedCount: 0,
            splitCount: 0,
            mergedAcuteCount: 0,
            collapsedCount: 0,
            changed: false
        };
    }

    let curVerts = inVertices.map(p => toArr3(p));
    let curEdges = inEdges
        .filter(e => e && e[0] !== e[1] && e[0] >= 0 && e[1] >= 0 && e[0] < curVerts.length && e[1] < curVerts.length)
        .map(e => [Math.min(e[0], e[1]), Math.max(e[0], e[1])]);
    let curAnchors = Array.isArray(inAnchors)
        ? [...new Set(inAnchors.filter(a => a >= 0 && a < curVerts.length))]
        : [];

    const outerRadiusM = Math.max(1e-4, Number(options.outerRadiusM !== undefined ? options.outerRadiusM : 0.015));
    const minMemberLengthM = options.minMemberLengthM !== undefined ? Number(options.minMemberLengthM) : 0.045;
    const weldTol = options.weldTol !== undefined
        ? Number(options.weldTol)
        : Math.max(0.015, Math.min(Math.max(0.015, minMemberLengthM * 0.6), outerRadiusM * 1.5));
    const tSplitTol = options.tSplitTol !== undefined
        ? Number(options.tSplitTol)
        : Math.max(0.016, outerRadiusM * 1.35);
    const minIncidentAngleDeg = options.minIncidentAngleDeg !== undefined
        ? Number(options.minIncidentAngleDeg)
        : 13.0;
    const removeAnchorEdges = !!options.removeAnchorEdges;
    const maxPasses = Math.max(1, Math.min(12, Math.round(options.maxPasses || 5)));

    let weldedCount = 0;
    let splitCount = 0;
    let mergedAcuteCount = 0;
    let collapsedCount = 0;

    if (removeAnchorEdges && curAnchors.length > 0) {
        curEdges = removeAnchorToAnchorEdges(curVerts, curEdges, curAnchors);
    }

    for (let pass = 0; pass < maxPasses; pass++) {
        let passChanged = false;

        if (weldTol > 0 && curEdges.length > 0) {
            const w = weldCoincidentGraphNodes(curVerts, curEdges, curAnchors, weldTol);
            if (w.weldedCount > 0 && w.edges.length > 0) {
                curVerts = w.vertices;
                curEdges = removeAnchorEdges ? removeAnchorToAnchorEdges(w.vertices, w.edges, w.anchors) : w.edges;
                curAnchors = w.anchors;
                weldedCount += w.weldedCount;
                passChanged = true;
            }
        }

        if (tSplitTol > 0 && curEdges.length > 0) {
            const sp = splitEdgesPassingNearNodes(curVerts, curEdges, tSplitTol);
            if (sp.splitCount > 0 && sp.edges.length > 0) {
                curEdges = removeAnchorEdges ? removeAnchorToAnchorEdges(curVerts, sp.edges, curAnchors) : sp.edges;
                splitCount += sp.splitCount;
                passChanged = true;
            }
        }

        if (minIncidentAngleDeg > 0 && curEdges.length > 1) {
            const ac = mergeAcuteIncidentEdges(curVerts, curEdges, curAnchors, minIncidentAngleDeg);
            if (ac.mergedCount > 0 && ac.edges.length > 0) {
                curVerts = ac.vertices;
                curEdges = removeAnchorEdges ? removeAnchorToAnchorEdges(ac.vertices, ac.edges, ac.anchors) : ac.edges;
                curAnchors = ac.anchors;
                mergedAcuteCount += ac.mergedCount;
                passChanged = true;
            }
        }

        if (minMemberLengthM > 0 && curEdges.length > 0) {
            const col = collapseShortEdges(curVerts, curEdges, curAnchors, minMemberLengthM);
            if (col.collapsedCount > 0 && col.edges.length > 0) {
                curVerts = col.vertices;
                curEdges = removeAnchorEdges ? removeAnchorToAnchorEdges(col.vertices, col.edges, col.anchors) : col.edges;
                curAnchors = col.anchors;
                collapsedCount += col.collapsedCount;
                passChanged = true;
            }
        }

        if (!passChanged) break;
    }

    // Deduplicate canonical undirected edges
    const dedupSet = new Set();
    let finalEdges = [];
    for (let i = 0; i < curEdges.length; i++) {
        const a = Math.min(curEdges[i][0], curEdges[i][1]);
        const b = Math.max(curEdges[i][0], curEdges[i][1]);
        if (a === b) continue;
        const k = `${a}_${b}`;
        if (!dedupSet.has(k)) { dedupSet.add(k); finalEdges.push([a, b]); }
    }

    let prunedLeaves = false;
    if (options.pruneLeaves && curAnchors.length > 0 && finalEdges.length > 0) {
        const pr = pruneNonAnchorLeaves(curVerts, finalEdges, curAnchors);
        if (pr.edges.length > 0 && pr.edges.length < finalEdges.length) {
            curVerts = pr.vertices;
            finalEdges = pr.edges;
            curAnchors = pr.anchors;
            prunedLeaves = true;
        }
    }

    const valences = new Array(curVerts.length).fill(0);
    for (let i = 0; i < finalEdges.length; i++) {
        valences[finalEdges[i][0]]++;
        valences[finalEdges[i][1]]++;
    }

    return {
        vertices: curVerts,
        edges: finalEdges,
        anchors: curAnchors,
        valences,
        boundingBox: computeBoundingBox(curVerts),
        weldedCount,
        splitCount,
        mergedAcuteCount,
        collapsedCount,
        changed: prunedLeaves || (weldedCount + splitCount + mergedAcuteCount + collapsedCount) > 0
    };
}

export {
    runWFCSolver,
    computeBoundingBox,
    buildWeldedGraphFromVoxels,
    extractLargestComponent,
    pruneNonAnchorLeaves,
    collapseShortEdges,
    weldCoincidentGraphNodes,
    splitEdgesPassingNearNodes,
    mergeAcuteIncidentEdges,
    removeAnchorToAnchorEdges,
    cleanAndWeldGraph
};

/**
 * WFC-FDM Foundry — Tab 2 Helper: Network File Loader (.3dm / .json / .obj)
 *
 * Extracted from `tab2_topo.js` so students editing file-based centerline graph
 * imports only need to inspect ~220 lines! Re-exported via `tab2_topo.js`.
 */

import { appState, actions, CORE, getUnitScale, $ } from '../state/workbench_state.js';
import { zoomToBox, modelBoxToWorld } from '../display/viewport_scene.js';

export function weldSegmentsToGraph(segments, weldTol = 0.005, mergeCollinear = appState.mergeCollinearNodes) {
    const tol = Math.max(1e-6, Number(weldTol) || 0.005);
    const invTol = 1 / tol;
    const grid = new Map(), verts = [], edgeSet = new Set(), rawEdges = [];
    const weldPt = (x, y, z) => {
        const gx = Math.round(x * invTol), gy = Math.round(y * invTol), gz = Math.round(z * invTol);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const bucket = grid.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
                    if (!bucket) continue;
                    for (let k = 0; k < bucket.length; k++) {
                        const idx = bucket[k], q = verts[idx];
                        const ddx = x - q[0], ddy = y - q[1], ddz = z - q[2];
                        if (ddx * ddx + ddy * ddy + ddz * ddz <= tol * tol) return idx;
                    }
                }
            }
        }
        const idx = verts.length;
        verts.push([x, y, z]);
        const key = `${gx}_${gy}_${gz}`;
        let b = grid.get(key);
        if (!b) { b = []; grid.set(key, b); }
        b.push(idx);
        return idx;
    };
    for (const [p0, p1] of segments) {
        if (!p0 || !p1) continue;
        const u = weldPt(p0[0], p0[1], p0[2]), v = weldPt(p1[0], p1[1], p1[2]);
        if (u === v) continue;
        const a = Math.min(u, v), b = Math.max(u, v), key = `${a}_${b}`;
        if (!edgeSet.has(key)) { edgeSet.add(key); rawEdges.push([a, b]); }
    }

    let finalVerts = verts, finalEdges = rawEdges;
    if (mergeCollinear && finalVerts.length > 0 && finalEdges.length > 0) {
        const adj = Array.from({ length: finalVerts.length }, () => new Set());
        for (const [u, w] of finalEdges) { adj[u].add(w); adj[w].add(u); }
        let changed = true;
        while (changed) {
            changed = false;
            for (let i = 0; i < finalVerts.length; i++) {
                if (adj[i].size !== 2) continue;
                const [a, b] = Array.from(adj[i]);
                if (a === b || adj[a].has(b)) continue;
                const p = finalVerts[i], pa = finalVerts[a], pb = finalVerts[b];
                const ax = pa[0] - p[0], ay = pa[1] - p[1], az = pa[2] - p[2];
                const bx = pb[0] - p[0], by = pb[1] - p[1], bz = pb[2] - p[2];
                const la = Math.hypot(ax, ay, az), lb = Math.hypot(bx, by, bz);
                if (la < 1e-8 || lb < 1e-8) continue;
                if ((ax * bx + ay * by + az * bz) / (la * lb) < -0.9995) {
                    adj[i].clear(); adj[a].delete(i); adj[b].delete(i); adj[a].add(b); adj[b].add(a);
                    changed = true;
                }
            }
        }
        const remap = new Int32Array(finalVerts.length).fill(-1);
        const compVerts = [];
        for (let i = 0; i < finalVerts.length; i++) {
            if (adj[i].size > 0) { remap[i] = compVerts.length; compVerts.push(finalVerts[i]); }
        }
        const compEdgeSet = new Set(), compEdges = [];
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
        finalVerts = compVerts; finalEdges = compEdges;
    }

    const valences = new Array(finalVerts.length).fill(0);
    for (const [u, w] of finalEdges) { valences[u]++; valences[w]++; }
    return {
        vertices: finalVerts, edges: finalEdges, valences,
        rawVertexCount: segments.length * 2, rawEdgeCount: segments.length,
        weldTol: tol, collinearMerged: mergeCollinear,
        boundingBox: CORE.computeBoundingBox(finalVerts),
        isLoadedFromFile: true
    };
}

export function parse3dmToWeldedGraph(arrayBuffer, weldTol = 0.005) {
    const rhino = appState.rhino;
    if (!rhino) throw new Error('Rhino3dm WebAssembly is not initialized');
    const doc = rhino.File3dm.fromByteArray(new Uint8Array(arrayBuffer));
    if (!doc) throw new Error('Failed to parse .3dm file');
    let scale = 1.0;
    try { scale = getUnitScale(doc.settings().modelUnitSystem); } catch (e) { scale = 1.0; }
    const segments = [];
    const objects = doc.objects();
    for (let i = 0; i < objects.count; i++) {
        const geom = objects.get(i).geometry();
        if (!geom) continue;
        if (geom.objectType === rhino.ObjectType.Curve) {
            const nurbs = geom.toNurbsCurve();
            if (!nurbs) continue;
            const dom = nurbs.domain;
            const deg = typeof nurbs.degree === 'number' ? nurbs.degree : 1;
            const cvCount = nurbs.points ? nurbs.points().count : 2;
            if (deg === 1 && cvCount >= 2) {
                const pts = nurbs.points();
                for (let j = 0; j < cvCount - 1; j++) {
                    const pA = pts.get(j), pB = pts.get(j + 1);
                    segments.push([[pA[0] * scale, pA[1] * scale, pA[2] * scale], [pB[0] * scale, pB[1] * scale, pB[2] * scale]]);
                }
            } else {
                const steps = Math.max(1, Math.min(32, (cvCount - 1) * 4));
                let prev = null;
                for (let j = 0; j <= steps; j++) {
                    const t = dom[0] + (dom[1] - dom[0]) * (j / steps);
                    const p = nurbs.pointAt(t);
                    const cur = [p[0] * scale, p[1] * scale, p[2] * scale];
                    if (prev) segments.push([prev, cur]);
                    prev = cur;
                }
            }
            nurbs.delete();
        } else if (geom.objectType === rhino.ObjectType.Mesh) {
            const rVerts = geom.vertices(), rFaces = geom.faces();
            const vList = [];
            for (let v = 0; v < rVerts.count; v++) {
                const pt = rVerts.get(v);
                vList.push([pt[0] * scale, pt[1] * scale, pt[2] * scale]);
            }
            for (let f = 0; f < rFaces.count; f++) {
                const fc = rFaces.get(f);
                const idxLoop = fc[2] === fc[3] ? [fc[0], fc[1], fc[2]] : [fc[0], fc[1], fc[2], fc[3]];
                for (let k = 0; k < idxLoop.length; k++) {
                    const pA = vList[idxLoop[k]], pB = vList[idxLoop[(k + 1) % idxLoop.length]];
                    if (pA && pB) segments.push([pA, pB]);
                }
            }
        }
    }
    doc.delete();
    return weldSegmentsToGraph(segments, weldTol, appState.mergeCollinearNodes);
}

export function parseJSONOrOBJToWeldedGraph(text, ext, weldTol = 0.005) {
    if (ext === 'json') {
        const data = JSON.parse(text);
        const verts = (data.vertices || []).map(p => [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0]);
        const edges = (data.edges || []).map(e => [parseInt(e[0], 10), parseInt(e[1], 10)]).filter(([u, v]) => u >= 0 && v >= 0 && u < verts.length && v < verts.length && u !== v);
        return weldSegmentsToGraph(edges.map(([u, v]) => [verts[u], verts[v]]), weldTol, false);
    }
    const objVerts = [], segments = [];
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const parts = line.split(/\s+/);
        if (parts[0] === 'v' && parts.length >= 4) {
            objVerts.push([parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])]);
        } else if (parts[0] === 'l' && parts.length >= 3) {
            const idxs = parts.slice(1).map(s => { const r = parseInt(s.split('/')[0], 10); return r < 0 ? objVerts.length + r : r - 1; });
            for (let j = 0; j < idxs.length - 1; j++) if (objVerts[idxs[j]] && objVerts[idxs[j + 1]]) segments.push([objVerts[idxs[j]], objVerts[idxs[j + 1]]]);
        } else if (parts[0] === 'f' && parts.length >= 4) {
            const idxs = parts.slice(1).map(s => { const r = parseInt(s.split('/')[0], 10); return r < 0 ? objVerts.length + r : r - 1; });
            for (let j = 0; j < idxs.length; j++) {
                const a = objVerts[idxs[j]], b = objVerts[idxs[(j + 1) % idxs.length]];
                if (a && b) segments.push([a, b]);
            }
        }
    }
    return weldSegmentsToGraph(segments, weldTol, appState.mergeCollinearNodes);
}

export function setLoadedNetworkGraph(graph, sourceName = 'Loaded File') {
    if (!graph || !graph.edges || graph.edges.length === 0) return false;
    appState.loadedFileNetworkGraph = Object.assign({}, graph, { sourceName, isLoadedFromFile: true });
    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
    const badge = $('topo-file-graph-badge');
    if (badge) {
        badge.textContent = `${graph.vertices.length}V · ${graph.edges.length}E`;
        badge.className = 'text-[9.5px] font-mono text-emerald-400 font-semibold';
    }
    const clearBtn = $('btn-clear-loaded-network');
    if (clearBtn) clearBtn.disabled = false;
    const fb = $('topo-network-feedback');
    if (fb) {
        fb.textContent = `Loaded welded graph (${graph.vertices.length}V, ${graph.edges.length}E) from ${sourceName}`;
        fb.className = 'text-[9.5px] text-center font-mono text-emerald-400';
    }
    appState.showCenterlineGraph = true;
    appState.groupVis.graph = true;
    const chkShowGraph = $('chk-show-graph');
    if (chkShowGraph) chkShowGraph.checked = true;
    if (actions.draw) actions.draw();
    zoomToBox(modelBoxToWorld(appState.modelBox));
    return true;
}

export function clearLoadedNetworkGraph() {
    appState.loadedFileNetworkGraph = null;
    if (actions.clearActiveAnalysisOverlaysForTopo) actions.clearActiveAnalysisOverlaysForTopo();
    const badge = $('topo-file-graph-badge');
    if (badge) { badge.textContent = 'Voxel Topo'; badge.className = 'text-[9.5px] font-mono text-gray-400'; }
    const clearBtn = $('btn-clear-loaded-network');
    if (clearBtn) clearBtn.disabled = true;
    const fb = $('topo-network-feedback');
    if (fb) { fb.textContent = 'Reverted to Voxel Topology Generator.'; fb.className = 'text-[9.5px] text-center font-mono text-gray-400'; }
    if (actions.draw) actions.draw();
    zoomToBox(modelBoxToWorld(appState.modelBox));
}

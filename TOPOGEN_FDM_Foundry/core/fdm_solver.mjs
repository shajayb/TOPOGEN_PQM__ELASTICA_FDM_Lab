/**
 * WFC-FDM Foundry — Core Module 3: Force Density Method (FDM) & Compression Conditioning
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 *
 * Student Quick-Map:
 *   - Edit ground support selection (corners / farthest-point) -> selectGroundAnchors()
 *   - Edit force-density q_k profiles (uniform / column_boosted / funicular_tuned) -> assignForceDensities()
 *   - Edit funicular equilibrium solver (compression / tensile / zero-weight) -> solveFDM()
 *   - Edit symmetric tension-tie pruning & collar-boost conditioning -> conditionCompressionOnlyNetwork()
 *
 * Inputs:  Welded centerline graph { vertices, edges }, FDM options, structural brief
 * Outputs: Equilibrium funicular network { vertices, edges, anchors, forceDensities, edgeForces, equilibriumResidual }
 */

import { solveLinearSystem } from './math_tiles.mjs';
import {
    computeBoundingBox,
    extractLargestComponent,
    pruneNonAnchorLeaves,
    collapseShortEdges,
    weldCoincidentGraphNodes,
    splitEdgesPassingNearNodes,
    mergeAcuteIncidentEdges,
    removeAnchorToAnchorEdges
} from './wfc_graph.mjs';
import { estimateFrameMechanics } from './frame_fea_preview.mjs';

// ============================================================
//  FORCE DENSITY METHOD (FDM) ENGINE
//  Supports: 'compression' | 'tensile' | 'zero-weight'
// ============================================================

function selectGroundAnchors(vertices, edges, options = {}) {
    const maxAnchors = Math.max(1, options.maxAnchors || 4);
    const minAnchors = Math.max(1, Math.min(maxAnchors, options.minAnchors || 3));
    if (!vertices || vertices.length === 0) return [];

    const bbox = computeBoundingBox(vertices);
    const zMin = bbox.min[2];
    const H = Math.max(1e-6, bbox.max[2] - zMin);

    // Find ground-band candidates
    let band = Math.max(0.05 * H, 1e-3);
    let cands = [];
    for (let attempt = 0; attempt < 4; attempt++) {
        cands = [];
        for (let i = 0; i < vertices.length; i++) {
            if (vertices[i][2] <= zMin + band) cands.push(i);
        }
        if (cands.length >= minAnchors) break;
        band *= 2.5;
    }
    if (cands.length === 0) return [0];
    if (cands.length <= maxAnchors) return cands;

    // Compute XY bounds of ground candidates
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    let cx = 0, cy = 0;
    for (let i = 0; i < cands.length; i++) {
        const p = vertices[cands[i]];
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
        cx += p[0]; cy += p[1];
    }
    cx /= cands.length; cy /= cands.length;

    const chosen = [];
    const chosenSet = new Set();

    // If targeting 4 anchors, try picking the 4 corner-most ground nodes first
    if (maxAnchors === 4) {
        const corners = [
            [minX, minY],
            [maxX, minY],
            [maxX, maxY],
            [minX, maxY]
        ];
        for (let c = 0; c < 4; c++) {
            let bestIdx = -1, bestDist = Infinity;
            for (let i = 0; i < cands.length; i++) {
                const idx = cands[i];
                if (chosenSet.has(idx)) continue;
                const p = vertices[idx];
                const d = Math.hypot(p[0] - corners[c][0], p[1] - corners[c][1]) + 0.05 * (p[2] - zMin);
                if (d < bestDist) { bestDist = d; bestIdx = idx; }
            }
            if (bestIdx !== -1) { chosen.push(bestIdx); chosenSet.add(bestIdx); }
        }
        if (chosen.length === 4) return chosen;
    }

    // General farthest-point sampling around XY centroid
    if (chosen.length === 0) {
        let firstIdx = cands[0], maxD = -1;
        for (let i = 0; i < cands.length; i++) {
            const p = vertices[cands[i]];
            const d = Math.hypot(p[0] - cx, p[1] - cy);
            if (d > maxD) { maxD = d; firstIdx = cands[i]; }
        }
        chosen.push(firstIdx);
        chosenSet.add(firstIdx);
    }

    while (chosen.length < maxAnchors) {
        let bestIdx = -1, bestMinD = -1;
        for (let i = 0; i < cands.length; i++) {
            const idx = cands[i];
            if (chosenSet.has(idx)) continue;
            const p = vertices[idx];
            let minD = Infinity;
            for (let k = 0; k < chosen.length; k++) {
                const q = vertices[chosen[k]];
                const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
                if (d < minD) minD = d;
            }
            if (minD > bestMinD) { bestMinD = minD; bestIdx = idx; }
        }
        if (bestIdx === -1) break;
        chosen.push(bestIdx);
        chosenSet.add(bestIdx);
    }
    return chosen;
}

function assignForceDensities(vertices, edges, anchors, options = {}) {
    if (Array.isArray(options.forceDensities) && options.forceDensities.length === edges.length) {
        return options.forceDensities.map(v => Math.max(1e-6, Number(v) || 1.0));
    }
    const qBase = Math.max(1e-4, Number(options.qBase !== undefined ? options.qBase : 5.0));
    const profile = options.qProfile || 'column_boosted';
    const columnBoost = Number(options.columnBoost !== undefined ? options.columnBoost : 2.5);
    const anchorBoost = Number(options.anchorBoost !== undefined ? options.anchorBoost : 1.8);
    const collarBoost = Number(options.collarBoost !== undefined ? options.collarBoost : 1.0);
    const topCollarBoost = Number(options.topCollarBoost !== undefined ? options.topCollarBoost : 1.0);
    const heightGradeFactor = Number(options.heightGradeFactor !== undefined ? options.heightGradeFactor : 2.0);
    const anchorSet = new Set(anchors || []);

    const bbox = computeBoundingBox(vertices);
    const zMin = bbox.min[2];
    const H = Math.max(1e-6, bbox.max[2] - zMin);

    const q = new Array(edges.length);
    for (let k = 0; k < edges.length; k++) {
        const [u, v] = edges[k];
        const pu = vertices[u], pv = vertices[v];
        const dx = pv[0] - pu[0], dy = pv[1] - pu[1], dz = pv[2] - pu[2];
        const L = Math.max(1e-6, Math.hypot(dx, dy, dz));
        const zMidNorm = Math.max(0, Math.min(1, ((0.5 * (pu[2] + pv[2])) - zMin) / H));
        const vertRatio = Math.abs(dz) / L;

        let qk = qBase;
        if (profile === 'height_graded') {
            // Higher force density near base, lighter near crown
            qk = qBase * (1.0 + (heightGradeFactor - 1.0) * (1.0 - zMidNorm));
        } else if (profile === 'column_boosted') {
            const grade = 1.0 + 0.6 * (1.0 - zMidNorm);
            const col = (vertRatio > 0.55) ? columnBoost : (1.0 + 0.35 * vertRatio);
            const anc = (anchorSet.has(u) || anchorSet.has(v)) ? anchorBoost : 1.0;
            qk = qBase * grade * col * anc;
        } else if (profile === 'funicular_tuned') {
            // Load-path-aware initial q: strong lower/inclined load-bearing ribs,
            // lighter horizontal collar rings so the network arches cleanly without pinching
            const grade = 1.0 + (heightGradeFactor - 1.0) * Math.pow(1.0 - zMidNorm, 1.2);
            const col = vertRatio > 0.35
                ? (1.0 + (columnBoost - 1.0) * Math.min(1.0, vertRatio / 0.85))
                : 0.45;
            const anc = (anchorSet.has(u) || anchorSet.has(v)) ? anchorBoost : 1.0;
            qk = qBase * grade * col * anc;
        } else if (profile === 'compression_taper') {
            // Eiffel/pyramidal pure-compression taper: inward-pulling collar rings + strong splayed base legs
            const grade = 1.0 + (heightGradeFactor - 1.0) * Math.pow(1.0 - zMidNorm, 1.1);
            const col = vertRatio > 0.40
                ? (1.0 + (columnBoost - 1.0) * vertRatio)
                : (1.25 + 0.75 * zMidNorm);
            const anc = (anchorSet.has(u) || anchorSet.has(v)) ? anchorBoost : 1.0;
            qk = qBase * grade * col * anc;
        }
        if (vertRatio <= 0.35) {
            qk *= collarBoost;
            if (zMidNorm >= 0.78) qk *= topCollarBoost;
        }
        q[k] = Math.max(1e-6, qk);
    }
    return q;
}

function solveFDM(inVertices, inEdges, options = {}) {
    if (!inVertices || inVertices.length === 0 || !inEdges || inEdges.length === 0) {
        return {
            vertices: [], edges: [], anchors: [], mode: options.mode || 'compression',
            forceDensities: [], edgeForces: [], edgeLengths: [], nodalLoads: [],
            equilibriumResidual: 0, relativeResidual: 0, boundingBox: computeBoundingBox([])
        };
    }

    const mode = (options.mode === 'auto' || !options.mode) ? 'compression' : options.mode;
    const groundZ = options.groundZ !== undefined ? Number(options.groundZ) : 0.0;
    const snapAnchorsToGround = options.snapAnchorsToGround !== undefined ? !!options.snapAnchorsToGround : true;
    const fitEnvelope = options.fitEnvelope !== undefined ? !!options.fitEnvelope : true;
    const maxPlanX = Number(options.maxPlanX || 1.0);
    const maxPlanY = Number(options.maxPlanY || 1.0);
    const planMargin = Number(options.planMargin !== undefined ? options.planMargin : 0.04);
    const targetHeightZ = Number(options.targetHeightZ || 2.0);
    const loadZ = Number(options.loadZ !== undefined ? options.loadZ : 500.0);
    const selfWeightLoadN = Number(options.selfWeightLoadN !== undefined ? options.selfWeightLoadN : 150.0);
    const topZoneFractionZ = Number(options.topZoneFractionZ !== undefined ? options.topZoneFractionZ : 0.85);

    // Clone working vertices
    const workVerts = inVertices.map(p => [p[0], p[1], p[2]]);
    const edges = inEdges.map(e => [e[0], e[1]]);
    const n = workVerts.length;

    // 1. Anchors
    let anchors = Array.isArray(options.anchors) && options.anchors.length > 0
        ? [...new Set(options.anchors.filter(i => i >= 0 && i < n))]
        : selectGroundAnchors(workVerts, edges, options);

    const anchorSet = new Set(anchors);
    const freeNodes = [];
    const freeMap = new Int32Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
        if (!anchorSet.has(i)) {
            freeMap[i] = freeNodes.length;
            freeNodes.push(i);
        }
    }

    // 2. Snap anchors to groundZ & fit anchor XY footprint into plan envelope
    const initBBox = computeBoundingBox(workVerts);
    const initH = Math.max(1e-6, initBBox.max[2] - initBBox.min[2]);
    if (fitEnvelope && anchors.length >= 2) {
        let aMinX = Infinity, aMaxX = -Infinity, aMinY = Infinity, aMaxY = -Infinity;
        for (let i = 0; i < anchors.length; i++) {
            const p = workVerts[anchors[i]];
            if (p[0] < aMinX) aMinX = p[0]; if (p[0] > aMaxX) aMaxX = p[0];
            if (p[1] < aMinY) aMinY = p[1]; if (p[1] > aMaxY) aMaxY = p[1];
        }
        const spanX = Math.max(1e-6, aMaxX - aMinX);
        const spanY = Math.max(1e-6, aMaxY - aMinY);
        const cx = 0.5 * (aMinX + aMaxX);
        const cy = 0.5 * (aMinY + aMaxY);
        const availX = Math.max(0.1, maxPlanX - 2 * planMargin);
        const availY = Math.max(0.1, maxPlanY - 2 * planMargin);
        const sx = availX / spanX;
        const sy = availY / spanY;
        // Uniform XY scale preserves symmetry while fitting both X and Y cleanly
        const sXY = Math.min(sx, sy);
        for (let i = 0; i < n; i++) {
            workVerts[i][0] = (workVerts[i][0] - cx) * sXY;
            workVerts[i][1] = (workVerts[i][1] - cy) * sXY;
        }
    }
    if (snapAnchorsToGround) {
        for (let i = 0; i < anchors.length; i++) {
            workVerts[anchors[i]][2] = groundZ;
        }
    }

    // 3. Force densities q_k > 0
    let q = assignForceDensities(workVerts, edges, anchors, options);

    // 4. Nodal load vector P_f (for free nodes)
    const nf = freeNodes.length;
    const P_f = Array.from({ length: nf }, () => new Float64Array(3));

    if (mode === 'compression' || mode === 'tensile') {
        const sign = (mode === 'compression') ? 1.0 : -1.0; // compression: upward p_z > 0; tensile: downward p_z < 0
        // Compute tributary length per free node for self-weight distribution
        const tribLen = new Float64Array(nf);
        let totalTrib = 0;
        for (let k = 0; k < edges.length; k++) {
            const [u, v] = edges[k];
            const L = Math.hypot(
                workVerts[v][0] - workVerts[u][0],
                workVerts[v][1] - workVerts[u][1],
                workVerts[v][2] - workVerts[u][2]
            );
            if (freeMap[u] !== -1) { tribLen[freeMap[u]] += 0.5 * L; totalTrib += 0.5 * L; }
            if (freeMap[v] !== -1) { tribLen[freeMap[v]] += 0.5 * L; totalTrib += 0.5 * L; }
        }

        // Identify top-zone free nodes based on initial WFC height
        const topZThresh = initBBox.min[2] + topZoneFractionZ * initH;
        const topFreeIndices = [];
        for (let fi = 0; fi < nf; fi++) {
            const vi = freeNodes[fi];
            if (inVertices[vi][2] >= topZThresh - 1e-6) topFreeIndices.push(fi);
        }
        const perTopLoad = topFreeIndices.length > 0 ? (loadZ / topFreeIndices.length) : 0;
        const topSet = new Set(topFreeIndices);

        for (let fi = 0; fi < nf; fi++) {
            const sw = totalTrib > 1e-9 ? (selfWeightLoadN * (tribLen[fi] / totalTrib)) : (selfWeightLoadN / Math.max(1, nf));
            const imposed = topSet.has(fi) ? perTopLoad : 0;
            P_f[fi][0] = 0;
            P_f[fi][1] = 0;
            P_f[fi][2] = sign * (sw + imposed);
        }
    }

    // Helper to assemble D_f, RHS = P_f - D_fs * X_s, solve, and compute residual
    const solveOnce = (qArr) => {
        const Df = Array.from({ length: nf }, () => new Float64Array(nf));
        const RHS = Array.from({ length: nf }, (_, i) => Float64Array.from(P_f[i]));
        const DfsXs = Array.from({ length: nf }, () => new Float64Array(3));

        for (let k = 0; k < edges.length; k++) {
            const [u, v] = edges[k];
            const qk = qArr[k];
            const fu = freeMap[u], fv = freeMap[v];
            if (fu !== -1 && fv !== -1) {
                Df[fu][fu] += qk; Df[fv][fv] += qk;
                Df[fu][fv] -= qk; Df[fv][fu] -= qk;
            } else if (fu !== -1 && fv === -1) {
                Df[fu][fu] += qk;
                const pv = workVerts[v];
                RHS[fu][0] += qk * pv[0];
                RHS[fu][1] += qk * pv[1];
                RHS[fu][2] += qk * pv[2];
                DfsXs[fu][0] -= qk * pv[0];
                DfsXs[fu][1] -= qk * pv[1];
                DfsXs[fu][2] -= qk * pv[2];
            } else if (fu === -1 && fv !== -1) {
                Df[fv][fv] += qk;
                const pu = workVerts[u];
                RHS[fv][0] += qk * pu[0];
                RHS[fv][1] += qk * pu[1];
                RHS[fv][2] += qk * pu[2];
                DfsXs[fv][0] -= qk * pu[0];
                DfsXs[fv][1] -= qk * pu[1];
                DfsXs[fv][2] -= qk * pu[2];
            }
        }

        const Xf = nf > 0 ? solveLinearSystem(Df, RHS) : [];
        const solvedVerts = workVerts.map(p => [p[0], p[1], p[2]]);
        for (let fi = 0; fi < nf; fi++) {
            const vi = freeNodes[fi];
            solvedVerts[vi] = [Xf[fi][0], Xf[fi][1], Xf[fi][2]];
        }

        // Exact residual norm ||D_f * X_f + D_fs * X_s - P_f||_2
        let resSq = 0;
        let rhsSq = 0;
        for (let i = 0; i < nf; i++) {
            for (let d = 0; d < 3; d++) {
                let sum = DfsXs[i][d] - P_f[i][d];
                for (let j = 0; j < nf; j++) sum += Df[i][j] * Xf[j][d];
                resSq += sum * sum;
                rhsSq += RHS[i][d] * RHS[i][d];
            }
        }
        const residualNorm = Math.sqrt(resSq);
        const relativeResidual = residualNorm / Math.max(1.0, Math.sqrt(rhsSq));
        return { solvedVerts, residualNorm, relativeResidual };
    };

    let res = solveOnce(q);

    // 5. Exact Target-Height Re-Solve for Compression Mode
    // Scaling q_k <- q_k * (currentH / targetHeightZ) scales z_f to targetHeightZ while
    // preserving exact FDM equilibrium (residual ~ 1e-13) and leaving XY invariant!
    if (fitEnvelope && mode === 'compression' && targetHeightZ > 0 && nf > 0) {
        let maxZ = -Infinity;
        for (let i = 0; i < res.solvedVerts.length; i++) {
            if (res.solvedVerts[i][2] > maxZ) maxZ = res.solvedVerts[i][2];
        }
        const currentH = maxZ - groundZ;
        if (currentH > 1e-6) {
            const qScale = currentH / targetHeightZ;
            q = q.map(qk => Math.max(1e-6, qk * qScale));
            res = solveOnce(q);
        }
    }

    // 5b. Iterative Load-Path / Funicular Force-Density Tuning (optimizeForceDensities)
    // Updates nodal self-weight from actual cast plaster cross-section area A = pi*(R^2 - r_in^2),
    // aligns nodal loads with the exact top-zone nodes of the equilibrium geometry, and gently
    // tunes q_k based on member inclination, height, and length balance to minimize bending.
    const doOptimizeFDM = !!(options.optimizeForceDensities || options.qProfile === 'funicular_tuned');
    if (doOptimizeFDM && mode === 'compression' && nf > 0) {
        const outerR = Math.max(1e-4, Number(options.outerRadiusM !== undefined ? options.outerRadiusM : 0.020));
        const innerR = Math.max(0, Math.min(outerR - 1e-4, Number(options.innerRadiusM || 0)));
        const secArea = Math.PI * (outerR * outerR - innerR * innerR);
        const rho = Number(options.densityKgM3 || 1250);
        const grav = Number(options.gravityMS2 || 9.81);
        const optIters = Math.max(1, Math.min(12, Math.round(options.optimizeIterations || 5)));

        for (let iter = 0; iter < optIters; iter++) {
            const curV = res.solvedVerts;
            const curBB = computeBoundingBox(curV);
            const curH = Math.max(1e-6, curBB.max[2] - groundZ);

            // Recompute exact nodal self-weight from current member lengths & section area
            const nodeSW = new Float64Array(nf);
            for (let k = 0; k < edges.length; k++) {
                const [u, v] = edges[k];
                const L = Math.hypot(
                    curV[v][0] - curV[u][0],
                    curV[v][1] - curV[u][1],
                    curV[v][2] - curV[u][2]
                );
                const memberWeightN = rho * grav * secArea * L;
                if (freeMap[u] !== -1) nodeSW[freeMap[u]] += 0.5 * memberWeightN;
                if (freeMap[v] !== -1) nodeSW[freeMap[v]] += 0.5 * memberWeightN;
            }

            // Identify exact top-zone free nodes at current equilibrium height
            const zTopCut = groundZ + topZoneFractionZ * curH;
            const topFree = [];
            for (let fi = 0; fi < nf; fi++) {
                if (curV[freeNodes[fi]][2] >= zTopCut - 1e-6) topFree.push(fi);
            }
            const perTop = topFree.length > 0 ? (loadZ / topFree.length) : 0;
            const topSetNow = new Set(topFree);

            for (let fi = 0; fi < nf; fi++) {
                P_f[fi][0] = 0;
                P_f[fi][1] = 0;
                P_f[fi][2] = nodeSW[fi] + (topSetNow.has(fi) ? perTop : 0);
            }

            // Gentle inclination-based q_k refinement (damped so topology stays smooth)
            const damp = 0.25;
            for (let k = 0; k < edges.length; k++) {
                const [u, v] = edges[k];
                const dz = Math.abs(curV[v][2] - curV[u][2]);
                const L = Math.max(1e-6, Math.hypot(
                    curV[v][0] - curV[u][0],
                    curV[v][1] - curV[u][1],
                    dz
                ));
                const vertRatio = dz / L;
                const zMidNorm = Math.max(0, Math.min(1, ((0.5 * (curV[u][2] + curV[v][2])) - groundZ) / curH));
                // Boost primary inclined/vertical ribs near base; keep horizontal ties gentle
                const targetFactor = (vertRatio > 0.35)
                    ? (1.0 + 0.35 * vertRatio * (1.0 - 0.5 * zMidNorm))
                    : 0.92;
                q[k] = Math.max(1e-6, q[k] * (1.0 + damp * (targetFactor - 1.0)));
            }

            res = solveOnce(q);
            if (fitEnvelope && targetHeightZ > 0) {
                let maxZ = -Infinity;
                for (let i = 0; i < res.solvedVerts.length; i++) {
                    if (res.solvedVerts[i][2] > maxZ) maxZ = res.solvedVerts[i][2];
                }
                const hNow = maxZ - groundZ;
                if (hNow > 1e-6) {
                    const qScale = hNow / targetHeightZ;
                    q = q.map(qk => Math.max(1e-6, qk * qScale));
                    res = solveOnce(q);
                }
            }
        }
    }

    // Compute edge lengths and axial forces F_k = q_k * L_k
    const edgeLengths = new Array(edges.length);
    const edgeForces = new Array(edges.length);
    const forceSign = (mode === 'compression') ? -1.0 : 1.0;
    for (let k = 0; k < edges.length; k++) {
        const [u, v] = edges[k];
        const pu = res.solvedVerts[u], pv = res.solvedVerts[v];
        const L = Math.hypot(pv[0] - pu[0], pv[1] - pu[1], pv[2] - pu[2]);
        edgeLengths[k] = L;
        edgeForces[k] = forceSign * q[k] * L;
    }

    const nodalLoads = Array.from({ length: n }, () => [0, 0, 0]);
    for (let fi = 0; fi < nf; fi++) {
        nodalLoads[freeNodes[fi]] = [P_f[fi][0], P_f[fi][1], P_f[fi][2]];
    }

    return {
        vertices: res.solvedVerts,
        edges,
        anchors,
        mode,
        forceDensities: q,
        edgeForces,
        edgeLengths,
        nodalLoads,
        equilibriumResidual: res.residualNorm,
        relativeResidual: res.relativeResidual,
        boundingBox: computeBoundingBox(res.solvedVerts)
    };
}

function conditionCompressionOnlyNetwork(fdm, fdmOpts, brief = {}, config = {}) {
    const env = brief.envelope || {};
    const sup = brief.supports || {};
    const acc = brief.acceptanceCriteria || {};
    const mat = brief.material || {};
    const minAnchors = config.minAnchors !== undefined ? config.minAnchors : (sup.minAnchors || 3);
    const minHeightZ = Number(env.minHeightZ || (env.targetHeightZ ? env.targetHeightZ * 0.95 : 1.9));
    const maxDispLimit = Number(acc.maxDeflectionMeters || 0.0033333333);
    const minMemberLen = config.minMemberLengthM !== undefined
        ? Number(config.minMemberLengthM)
        : Math.max(0.05, Number(acc.minMemberLengthM || 0.04) * 1.25);
    const weldTol = Math.max(0.015, Math.min(minMemberLen * 0.6, fdmOpts.outerRadiusM * 1.5));
    const allowPrune = config.pruneTension !== undefined ? !!config.pruneTension : true;

    const minAngleDeg = config.minIncidentAngleDeg !== undefined ? Number(config.minIncidentAngleDeg) : 13.0;
    const minLateralTarget = config.minLateralSF !== undefined ? Number(config.minLateralSF) : 1.70;
    const tSplitTol = Math.max(0.016, fdmOpts.outerRadiusM * 1.35);
    const cleanAndSolve = (verts, edgs, ancs, extraOpts = {}) => {
        let curEdges = removeAnchorToAnchorEdges(verts, edgs, ancs);
        let curFdm = solveFDM(verts, curEdges, Object.assign({}, fdmOpts, extraOpts, {
            anchors: ancs,
            optimizeForceDensities: true
        }));
        for (let pass = 0; pass < 5; pass++) {
            let ch = false;
            const w = weldCoincidentGraphNodes(curFdm.vertices, curFdm.edges, curFdm.anchors, weldTol);
            if (w.weldedCount > 0 && w.edges.length > 0) {
                curFdm = solveFDM(w.vertices, removeAnchorToAnchorEdges(w.vertices, w.edges, w.anchors), Object.assign({}, fdmOpts, extraOpts, {
                    anchors: w.anchors,
                    optimizeForceDensities: true
                }));
                ch = true;
            }
            const sp = splitEdgesPassingNearNodes(curFdm.vertices, curFdm.edges, tSplitTol);
            if (sp.splitCount > 0 && sp.edges.length > 0) {
                curFdm = solveFDM(curFdm.vertices, removeAnchorToAnchorEdges(curFdm.vertices, sp.edges, curFdm.anchors), Object.assign({}, fdmOpts, extraOpts, {
                    anchors: curFdm.anchors,
                    optimizeForceDensities: true
                }));
                ch = true;
            }
            const ac = mergeAcuteIncidentEdges(curFdm.vertices, curFdm.edges, curFdm.anchors, minAngleDeg);
            if (ac.mergedCount > 0 && ac.edges.length > 0) {
                curFdm = solveFDM(ac.vertices, removeAnchorToAnchorEdges(ac.vertices, ac.edges, ac.anchors), Object.assign({}, fdmOpts, extraOpts, {
                    anchors: ac.anchors,
                    optimizeForceDensities: true
                }));
                ch = true;
            }
            const col = collapseShortEdges(curFdm.vertices, curFdm.edges, curFdm.anchors, minMemberLen);
            if (col.collapsedCount > 0 && col.edges.length > 0) {
                curFdm = solveFDM(col.vertices, removeAnchorToAnchorEdges(col.vertices, col.edges, col.anchors), Object.assign({}, fdmOpts, extraOpts, {
                    anchors: col.anchors,
                    optimizeForceDensities: true
                }));
                ch = true;
            }
            if (!ch) break;
        }
        return curFdm;
    };

    let bestFdm = cleanAndSolve(fdm.vertices, fdm.edges, fdm.anchors);
    const sec = { outerRadiusM: fdmOpts.outerRadiusM, innerRadiusM: fdmOpts.innerRadiusM, nSides: 8 };
    let bestEst = estimateFrameMechanics(bestFdm.vertices, bestFdm.edges, bestFdm.anchors, sec, mat, brief.loadCases);
    if (bestEst.valid && bestEst.tensileBarCount === 0 && bestEst.maxAxialForceN <= -0.1) {
        return { fdm: bestFdm, mechanics: bestEst };
    }

    // Try symmetric tension-tie orbit pruning and/or inward collarBoost tapering
    let curFdm = bestFdm;
    let curEst = bestEst;
    let curCollarBoost = Number(fdmOpts.collarBoost || 1.0);
    let curTopCollarBoost = Number(fdmOpts.topCollarBoost || 1.0);

    for (let iter = 0; iter < 8; iter++) {
        if (curEst.valid && curEst.tensileBarCount === 0 && curEst.maxAxialForceN <= -0.05) break;

        let improved = false;
        if (allowPrune && curEst.valid && curEst.tensileBarCount > 0 && curFdm.edges.length > minAnchors + 4) {
            // Group tensile edges into XY-symmetric geometric orbits by (zLow, zHigh, edgeLen)
            const orbits = [];
            const assigned = new Uint8Array(curFdm.edges.length);
            const tensIndices = [];
            for (let e = 0; e < curFdm.edges.length; e++) {
                if (curEst.barMaxForcesN[e] > -0.02) tensIndices.push(e);
            }
            tensIndices.sort((a, b) => curEst.barMaxForcesN[b] - curEst.barMaxForcesN[a]);

            for (const seedE of tensIndices) {
                if (assigned[seedE]) continue;
                const [u0, v0] = curFdm.edges[seedE];
                const p0 = curFdm.vertices[u0], q0 = curFdm.vertices[v0];
                const zLo0 = Math.min(p0[2], q0[2]), zHi0 = Math.max(p0[2], q0[2]);
                const len0 = Math.hypot(q0[0] - p0[0], q0[1] - p0[1], q0[2] - p0[2]);
                const rMid0 = Math.hypot(0.5 * (p0[0] + q0[0]), 0.5 * (p0[1] + q0[1]));
                const grp = [];
                for (let e = 0; e < curFdm.edges.length; e++) {
                    const [u, v] = curFdm.edges[e];
                    const p = curFdm.vertices[u], q = curFdm.vertices[v];
                    const zLo = Math.min(p[2], q[2]), zHi = Math.max(p[2], q[2]);
                    const len = Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]);
                    const rMid = Math.hypot(0.5 * (p[0] + q[0]), 0.5 * (p[1] + q[1]));
                    if (Math.abs(zLo - zLo0) < 0.015 && Math.abs(zHi - zHi0) < 0.015 &&
                        Math.abs(len - len0) < 0.02 && Math.abs(rMid - rMid0) < 0.02) {
                        grp.push(e);
                        assigned[e] = 1;
                    }
                }
                orbits.push(grp);
            }

            for (const grp of orbits) {
                if (grp.length >= curFdm.edges.length - minAnchors) continue;
                const dropSet = new Set(grp);
                const remEdges = curFdm.edges.filter((_, idx) => !dropSet.has(idx));
                const pruned = pruneNonAnchorLeaves(curFdm.vertices, remEdges, curFdm.anchors);
                if (pruned.edges.length < minAnchors || pruned.anchors.length < minAnchors) continue;
                const comp = extractLargestComponent(pruned.vertices, pruned.edges);
                const compAncs = selectGroundAnchors(comp.vertices, comp.edges, {
                    maxAnchors: fdmOpts.maxAnchors,
                    minAnchors
                });
                if (compAncs.length < minAnchors) continue;

                const candFdm = cleanAndSolve(comp.vertices, comp.edges, compAncs, {
                    collarBoost: curCollarBoost,
                    topCollarBoost: curTopCollarBoost
                });
                const bb = candFdm.boundingBox;
                if (bb.max[2] - bb.min[2] < minHeightZ || candFdm.anchors.length < minAnchors) continue;

                const candEst = estimateFrameMechanics(candFdm.vertices, candFdm.edges, candFdm.anchors, sec, mat, brief.loadCases);
                const latFloor = Math.min(minLateralTarget, Math.max(0.85, curEst.lateralMinSF * 0.90));
                if (!candEst.valid || candEst.maxDispM > maxDispLimit * 0.90 || candEst.lateralMinSF < latFloor || candEst.minSF_b < 2.15 || candEst.minSF_t < 1.65) continue;

                if (candEst.tensileBarCount < curEst.tensileBarCount ||
                    (candEst.tensileBarCount === curEst.tensileBarCount && candEst.maxAxialForceN < curEst.maxAxialForceN - 0.1)) {
                    curFdm = candFdm;
                    curEst = candEst;
                    improved = true;
                    break;
                }
            }
        }

        if (!improved) {
            // Increase inward horizontal collar compression taper
            curCollarBoost *= 1.45;
            curTopCollarBoost *= 1.35;
            const candFdm = cleanAndSolve(curFdm.vertices, curFdm.edges, curFdm.anchors, {
                collarBoost: curCollarBoost,
                topCollarBoost: curTopCollarBoost
            });
            const candEst = estimateFrameMechanics(candFdm.vertices, candFdm.edges, candFdm.anchors, sec, mat, brief.loadCases);
            if (candEst.valid && (candEst.tensileBarCount < curEst.tensileBarCount || candEst.maxAxialForceN < curEst.maxAxialForceN)) {
                curFdm = candFdm;
                curEst = candEst;
            }
        }

        if (curEst.valid && (
            curEst.tensileBarCount < bestEst.tensileBarCount ||
            (curEst.tensileBarCount === bestEst.tensileBarCount && curEst.maxAxialForceN < bestEst.maxAxialForceN)
        )) {
            bestFdm = curFdm;
            bestEst = curEst;
        }
    }

    return { fdm: bestFdm, mechanics: bestEst };
}

export {
    selectGroundAnchors,
    assignForceDensities,
    solveLinearSystem,
    solveFDM,
    conditionCompressionOnlyNetwork
};

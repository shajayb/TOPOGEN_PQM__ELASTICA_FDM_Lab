/**
 * WFC-FDM Foundry — Core Module 6: Generator-Side 3D Space-Frame FEA Preview
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier imports — strictly air-gapped!).
 * Provides fast generator-side Euler-Bernoulli 6-DOF/node frame mechanics estimation
 * for interactive Tab 5 FEA visualization and funicular compression conditioning.
 *
 * Student Quick-Map:
 *   - Edit generator pre-screener load cases -> estimateFrameMechanics()
 *   - Edit interactive Tab 5 3D FEA solver   -> analyzeSpaceFrameFEA()
 *
 * Inputs:  Centerline vertices, edges, anchor indices, tube sectionParams, material, loadConfig
 * Outputs: Nodal displacements, member axial/bending/buckling safety factors, equilibrium residuals
 */

import { toArr3, solveLinearSystem } from './math_tiles.mjs';
import { computeBoundingBox } from './wfc_graph.mjs';
import { selectGroundAnchors } from './fdm_solver.mjs';

// ============================================================
//  FIRST-PRINCIPLES SPACE-FRAME PRE-SCREENER & COMPRESSION CONDITIONING
// ============================================================

function estimateFrameMechanics(vertices, edges, anchors, sectionParams = {}, material = {}, loadCases = []) {
    if (!Array.isArray(vertices) || !Array.isArray(edges)) {
        return { valid: false, tensileBarCount: 0, maxAxialForceN: 0, maxDispM: Infinity, minSF_t: 0, minSF_c: 0, minSF_b: 0, lateralMinSF: 0, barMaxForcesN: [] };
    }
    const nNodes = vertices.length;
    const nEdges = edges.length;
    if (nNodes < 2 || nEdges < 1) {
        return { valid: false, tensileBarCount: 0, maxAxialForceN: 0, maxDispM: Infinity, minSF_t: 0, minSF_c: 0, minSF_b: 0, lateralMinSF: 0, barMaxForcesN: [] };
    }

    const R = Math.max(1e-4, Number(sectionParams.outerRadiusM || 0.015));
    const r = Math.max(0, Math.min(R - 1e-4, Number(sectionParams.innerRadiusM || 0)));
    const A = Math.PI * (R * R - r * r);
    const I = 0.25 * Math.PI * (Math.pow(R, 4) - Math.pow(r, 4));
    const J = 2.0 * I;
    const E = Number(material.youngsModulusPa || 5.0e9);
    const nu = Number(material.poissonsRatio || 0.24);
    const G = E / (2.0 * (1.0 + nu));
    const rho = Number(material.densityKgM3 || 1250);
    const sigC = Number(material.compressiveStrengthPa || 12.0e6);
    const sigT = Number(material.tensileStrengthPa || 2.0e6);

    const nDof = 6 * nNodes;
    const anchorSet = new Set(anchors || []);
    const fixedDof = new Uint8Array(nDof);
    for (const ai of anchorSet) {
        if (ai >= 0 && ai < nNodes) {
            fixedDof[6 * ai + 0] = 1;
            fixedDof[6 * ai + 1] = 1;
            fixedDof[6 * ai + 2] = 1;
        }
    }
    const freeDofs = [];
    const dofMap = new Int32Array(nDof).fill(-1);
    for (let d = 0; d < nDof; d++) {
        if (!fixedDof[d]) {
            dofMap[d] = freeDofs.length;
            freeDofs.push(d);
        }
    }
    const nf = freeDofs.length;
    if (nf === 0) {
        return { valid: false, tensileBarCount: 0, maxAxialForceN: 0, maxDispM: 0, minSF_t: 99, minSF_c: 99, minSF_b: 99, lateralMinSF: 99, barMaxForcesN: new Array(nEdges).fill(0) };
    }

    const Kff = Array.from({ length: nf }, () => new Float64Array(nf));
    const elemCache = new Array(nEdges);
    const tmpM = Array.from({ length: 12 }, () => new Float64Array(12));

    for (let e = 0; e < nEdges; e++) {
        const [u, v] = edges[e];
        if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= nNodes || v >= nNodes || u === v) {
            return { valid: false, tensileBarCount: nEdges, maxAxialForceN: 1e6, maxDispM: Infinity, minSF_t: 0, minSF_c: 0, minSF_b: 0, lateralMinSF: 0, barMaxForcesN: [] };
        }
        const pu = vertices[u], pv = vertices[v];
        const dx = pv[0] - pu[0], dy = pv[1] - pu[1], dz = pv[2] - pu[2];
        const L = Math.hypot(dx, dy, dz);
        if (!Number.isFinite(L) || L < 1e-7) return { valid: false, tensileBarCount: nEdges, maxAxialForceN: 1e6, maxDispM: Infinity, minSF_t: 0, minSF_c: 0, minSF_b: 0, lateralMinSF: 0, barMaxForcesN: [] };

        const ex = [dx / L, dy / L, dz / L];
        const tmp = Math.abs(ex[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
        let ey = [
            tmp[1] * ex[2] - tmp[2] * ex[1],
            tmp[2] * ex[0] - tmp[0] * ex[2],
            tmp[0] * ex[1] - tmp[1] * ex[0]
        ];
        const eyL = Math.hypot(ey[0], ey[1], ey[2]);
        ey = [ey[0] / eyL, ey[1] / eyL, ey[2] / eyL];
        const ez = [
            ex[1] * ey[2] - ex[2] * ey[1],
            ex[2] * ey[0] - ex[0] * ey[2],
            ex[0] * ey[1] - ex[1] * ey[0]
        ];
        const R3 = [ex, ey, ez];

        const kL = Array.from({ length: 12 }, () => new Float64Array(12));
        const eaL = (E * A) / L;
        const gjL = (G * J) / L;
        const eiL3 = (12 * E * I) / (L * L * L);
        const eiL2 = (6 * E * I) / (L * L);
        const ei4L = (4 * E * I) / L;
        const ei2L = (2 * E * I) / L;

        kL[0][0] = eaL;  kL[0][6] = -eaL;
        kL[6][0] = -eaL; kL[6][6] = eaL;
        kL[3][3] = gjL;  kL[3][9] = -gjL;
        kL[9][3] = -gjL; kL[9][9] = gjL;

        kL[1][1] = eiL3;  kL[1][5] = eiL2;   kL[1][7] = -eiL3;  kL[1][11] = eiL2;
        kL[5][1] = eiL2;  kL[5][5] = ei4L;   kL[5][7] = -eiL2;  kL[5][11] = ei2L;
        kL[7][1] = -eiL3; kL[7][5] = -eiL2;  kL[7][7] = eiL3;   kL[7][11] = -eiL2;
        kL[11][1] = eiL2; kL[11][5] = ei2L;  kL[11][7] = -eiL2; kL[11][11] = ei4L;

        kL[2][2] = eiL3;   kL[2][4] = -eiL2;  kL[2][8] = -eiL3;  kL[2][10] = -eiL2;
        kL[4][2] = -eiL2;  kL[4][4] = ei4L;   kL[4][8] = eiL2;   kL[4][10] = ei2L;
        kL[8][2] = -eiL3;  kL[8][4] = eiL2;   kL[8][8] = eiL3;   kL[8][10] = eiL2;
        kL[10][2] = -eiL2; kL[10][4] = ei2L;  kL[10][8] = eiL2;  kL[10][10] = ei4L;

        // T (12x12) block-diagonal of R3: kG = T^T * kL * T
        const T = Array.from({ length: 12 }, () => new Float64Array(12));
        for (let blk = 0; blk < 4; blk++) {
            const o = 3 * blk;
            for (let rI = 0; rI < 3; rI++) {
                for (let cI = 0; cI < 3; cI++) T[o + rI][o + cI] = R3[rI][cI];
            }
        }
        for (let i = 0; i < 12; i++) tmpM[i].fill(0);
        for (let i = 0; i < 12; i++) {
            for (let k = 0; k < 12; k++) {
                const vlk = kL[i][k];
                if (vlk === 0) continue;
                for (let j = 0; j < 12; j++) tmpM[i][j] += vlk * T[k][j];
            }
        }
        const gDofs = [
            6 * u, 6 * u + 1, 6 * u + 2, 6 * u + 3, 6 * u + 4, 6 * u + 5,
            6 * v, 6 * v + 1, 6 * v + 2, 6 * v + 3, 6 * v + 4, 6 * v + 5
        ];
        for (let i = 0; i < 12; i++) {
            const fi = dofMap[gDofs[i]];
            if (fi === -1) continue;
            for (let j = 0; j < 12; j++) {
                const fj = dofMap[gDofs[j]];
                if (fj === -1) continue;
                let s = 0;
                for (let k = 0; k < 12; k++) s += T[k][i] * tmpM[k][j];
                Kff[fi][fj] += s;
            }
        }

        elemCache[e] = { u, v, L, R3, kL, T, gDofs };
    }

    // Tiny rotational regularization in case of collinear torsional spin
    for (let i = 0; i < nf; i++) Kff[i][i] += 1e-6;

    const bb = computeBoundingBox(vertices);
    const zMin = bb.min[2];
    const H = Math.max(1e-6, bb.max[2] - zMin);

    const casesToRun = [];
    const reqCases = Array.isArray(loadCases) && loadCases.length > 0
        ? loadCases
        : [
            { id: 'LC1_self_weight', required: true, gravityMS2: 9.81, distributedVerticalMassKg: 0 },
            { id: 'LC2_self_weight_plus_50kg', required: true, gravityMS2: 9.81, distributedVerticalMassKg: 50, topZoneFractionZ: 0.85 }
        ];
    let peakTopLoadN = 490.5;
    let topFrac = 0.85;
    for (const lc of reqCases) {
        casesToRun.push({ id: lc.id, grav: lc.gravityMS2 || 9.81, topMassKg: lc.distributedVerticalMassKg || 0, topFrac: lc.topZoneFractionZ || 0.85, lateralN: 0, required: lc.required !== false });
        if ((lc.distributedVerticalMassKg || 0) > 0) {
            peakTopLoadN = lc.distributedVerticalMassKg * (lc.gravityMS2 || 9.81);
            topFrac = lc.topZoneFractionZ || 0.85;
        }
    }
    casesToRun.push({ id: 'LC_lateral_5pct_X', grav: 9.81, topMassKg: peakTopLoadN / 9.81, topFrac, lateralX: 0.05 * peakTopLoadN, lateralY: 0, required: false });
    casesToRun.push({ id: 'LC_lateral_5pct_Y', grav: 9.81, topMassKg: peakTopLoadN / 9.81, topFrac, lateralX: 0, lateralY: 0.05 * peakTopLoadN, required: false });
    casesToRun.push({ id: 'LC_lateral_5pct_XY', grav: 9.81, topMassKg: peakTopLoadN / 9.81, topFrac, lateralX: 0.035355 * peakTopLoadN, lateralY: 0.035355 * peakTopLoadN, required: false });

    const nCases = casesToRun.length;
    const RHS = Array.from({ length: nf }, () => new Float64Array(nCases));
    const elemFEF = Array.from({ length: nCases }, () => Array.from({ length: nEdges }, () => new Float64Array(12)));

    for (let ci = 0; ci < nCases; ci++) {
        const lc = casesToRun[ci];
        // Uniform member gravity load qGlobal = [0, 0, -rho * grav * A]
        const qz = -rho * lc.grav * A;
        for (let e = 0; e < nEdges; e++) {
            const ec = elemCache[e];
            const L = ec.L;
            const qlx = ec.R3[0][2] * qz;
            const qly = ec.R3[1][2] * qz;
            const qlz = ec.R3[2][2] * qz;
            const fefL = elemFEF[ci][e];
            // Equivalent nodal load vector in local coordinates
            fefL[0]  = 0.5 * qlx * L;
            fefL[1]  = 0.5 * qly * L;
            fefL[2]  = 0.5 * qlz * L;
            fefL[4]  = -(qlz * L * L) / 12.0;
            fefL[5]  =  (qly * L * L) / 12.0;
            fefL[6]  = 0.5 * qlx * L;
            fefL[7]  = 0.5 * qly * L;
            fefL[8]  = 0.5 * qlz * L;
            fefL[10] =  (qlz * L * L) / 12.0;
            fefL[11] = -(qly * L * L) / 12.0;

            for (let i = 0; i < 12; i++) {
                const fi = dofMap[ec.gDofs[i]];
                if (fi === -1) continue;
                let fg = 0;
                for (let k = 0; k < 12; k++) fg += ec.T[k][i] * fefL[k];
                RHS[fi][ci] += fg;
            }
        }

        const topZCut = zMin + lc.topFrac * H;
        const topNodes = [];
        for (let ni = 0; ni < nNodes; ni++) {
            if (!anchorSet.has(ni) && vertices[ni][2] >= topZCut - 1e-6) topNodes.push(ni);
        }
        if (topNodes.length > 0) {
            const fzPer = -(lc.topMassKg * lc.grav) / topNodes.length;
            const fxPer = (lc.lateralX || 0) / topNodes.length;
            const fyPer = (lc.lateralY || 0) / topNodes.length;
            for (const ni of topNodes) {
                const fzD = dofMap[6 * ni + 2];
                const fxD = dofMap[6 * ni + 0];
                const fyD = dofMap[6 * ni + 1];
                if (fzD !== -1) RHS[fzD][ci] += fzPer;
                if (fxD !== -1) RHS[fxD][ci] += fxPer;
                if (fyD !== -1) RHS[fyD][ci] += fyPer;
            }
        }
    }

    const Uf = solveLinearSystem(Kff, RHS);
    for (let i = 0; i < nf; i++) {
        for (let ci = 0; ci < nCases; ci++) {
            if (!Number.isFinite(Uf[i][ci])) {
                return { valid: false, tensileBarCount: nEdges, maxAxialForceN: 1e6, maxDispM: Infinity, minSF_t: 0, minSF_c: 0, minSF_b: 0, lateralMinSF: 0, barMaxForcesN: [] };
            }
        }
    }

    const barMaxForcesN = new Float64Array(nEdges).fill(-Infinity);
    let maxDispReqM = 0.0;
    let minSF_t = Infinity, minSF_c = Infinity, minSF_b = Infinity, lateralMinSF = Infinity;

    for (let ci = 0; ci < nCases; ci++) {
        const isReq = casesToRun[ci].required;
        const uGlobal = new Float64Array(nDof);
        for (let i = 0; i < nf; i++) uGlobal[freeDofs[i]] = Uf[i][ci];

        if (isReq) {
            for (let ni = 0; ni < nNodes; ni++) {
                const d = Math.hypot(uGlobal[6 * ni], uGlobal[6 * ni + 1], uGlobal[6 * ni + 2]);
                if (d > maxDispReqM) maxDispReqM = d;
            }
        }

        for (let e = 0; e < nEdges; e++) {
            const ec = elemCache[e];
            const uL = new Float64Array(12);
            for (let i = 0; i < 12; i++) {
                let s = 0;
                for (let j = 0; j < 12; j++) s += ec.T[i][j] * uGlobal[ec.gDofs[j]];
                uL[i] = s;
            }
            const fInt = new Float64Array(12);
            const fefL = elemFEF[ci][e];
            for (let i = 0; i < 12; i++) {
                let s = -fefL[i];
                for (let j = 0; j < 12; j++) s += ec.kL[i][j] * uL[j];
                fInt[i] = s;
            }
            // Member axial force convention: N > 0 tension, N < 0 compression
            const N_u = -fInt[0];
            const N_v =  fInt[6];
            const N_avg = 0.5 * (N_u + N_v);
            const N_worstTens = Math.max(N_u, N_v, N_avg);

            const M_u = Math.hypot(fInt[4], fInt[5]);
            const M_v = Math.hypot(fInt[10], fInt[11]);
            const M_max = Math.max(M_u, M_v);
            const Z_mod = I / R;
            const sigAxial = N_avg / A;
            const sigBend = M_max / Z_mod;
            const peakTensPa = Math.max(0, Math.max(N_u, N_v) / A + sigBend);
            const peakCompPa = Math.max(0, -Math.min(N_u, N_v) / A + sigBend);

            const sfT = peakTensPa > 1e-6 ? (sigT / peakTensPa) : 999.0;
            const sfC = peakCompPa > 1e-6 ? (sigC / peakCompPa) : 999.0;
            const P_comp = Math.max(0, -Math.min(N_u, N_v, N_avg));
            const P_crit = (Math.PI * Math.PI * E * I) / (ec.L * ec.L);
            const sfB = P_comp > 1e-6 ? (P_crit / P_comp) : 999.0;

            if (isReq) {
                if (N_avg > barMaxForcesN[e]) barMaxForcesN[e] = N_avg;
                if (N_worstTens > barMaxForcesN[e] && N_avg > -0.2) barMaxForcesN[e] = N_worstTens;
                if (sfT < minSF_t) minSF_t = sfT;
                if (sfC < minSF_c) minSF_c = sfC;
                if (sfB < minSF_b) minSF_b = sfB;
            } else {
                const latMin = Math.min(sfT, sfC, sfB);
                if (latMin < lateralMinSF) lateralMinSF = latMin;
            }
        }
    }

    let tensileBarCount = 0;
    let maxAxialForceN = -Infinity;
    for (let e = 0; e < nEdges; e++) {
        if (barMaxForcesN[e] > maxAxialForceN) maxAxialForceN = barMaxForcesN[e];
        if (barMaxForcesN[e] > 0.0) tensileBarCount++;
    }

    return {
        valid: true,
        tensileBarCount,
        maxAxialForceN,
        maxDispM: maxDispReqM,
        minSF_t,
        minSF_c,
        minSF_b,
        lateralMinSF,
        barMaxForcesN: Array.from(barMaxForcesN)
    };
}

// Interactive & Batch 3D Euler-Bernoulli Space-Frame FEA Helper (Pure-JS inside wfc-fdm-core, 0 verifier imports!)
function solveSparseBandedLDLT(nf, sparseRows, RHS, nCases) {
    // 1. Reverse Cuthill-McKee (RCM) ordering on the DOF adjacency graph to minimize profile
    const adj = Array.from({ length: nf }, (_, i) => {
        const nbrs = [];
        for (const j of sparseRows[i].keys()) {
            if (j !== i) nbrs.push(j);
        }
        return nbrs;
    });
    const deg = Int32Array.from({ length: nf }, (_, i) => adj[i].length);
    for (let i = 0; i < nf; i++) adj[i].sort((a, b) => deg[a] - deg[b]);

    const visited = new Uint8Array(nf);
    const rcmOrder = new Int32Array(nf);
    let pos = 0;
    const queue = new Int32Array(nf);

    while (pos < nf) {
        let start = -1, minDeg = Infinity;
        for (let i = 0; i < nf; i++) {
            if (!visited[i] && deg[i] < minDeg) {
                minDeg = deg[i];
                start = i;
                if (minDeg <= 1) break;
            }
        }
        let qHead = 0, qTail = 0;
        visited[start] = 1;
        queue[qTail++] = start;
        while (qHead < qTail) {
            const u = queue[qHead++];
            rcmOrder[pos++] = u;
            const nbrs = adj[u];
            for (let k = 0; k < nbrs.length; k++) {
                const v = nbrs[k];
                if (!visited[v]) {
                    visited[v] = 1;
                    queue[qTail++] = v;
                }
            }
        }
    }

    const perm = new Int32Array(nf);
    const invPerm = new Int32Array(nf);
    for (let i = 0; i < nf; i++) {
        const oldIdx = rcmOrder[nf - 1 - i];
        perm[i] = oldIdx;
        invPerm[oldIdx] = i;
    }

    // 2. Exact Skyline (variable-bandwidth) lower profile: firstCol[i] = min_{j <= i, A_ij != 0} j
    const firstCol = new Int32Array(nf);
    for (let i = 0; i < nf; i++) {
        let fc = i;
        const oldI = perm[i];
        for (const oldJ of sparseRows[oldI].keys()) {
            const j = invPerm[oldJ];
            if (j < fc) fc = j;
        }
        firstCol[i] = fc;
    }

    const rowStart = new Int32Array(nf + 1);
    let totalProfile = 0;
    for (let i = 0; i < nf; i++) {
        rowStart[i] = totalProfile;
        totalProfile += (i - firstCol[i] + 1);
    }
    rowStart[nf] = totalProfile;

    const L = new Float64Array(totalProfile);
    for (let i = 0; i < nf; i++) {
        const oldI = perm[i];
        const base = rowStart[i] - firstCol[i];
        for (const [oldJ, val] of sparseRows[oldI]) {
            const j = invPerm[oldJ];
            if (j <= i) L[base + j] += val;
        }
    }

    // 3. In-place Skyline LDL^T factorization
    const D = new Float64Array(nf);
    for (let i = 0; i < nf; i++) {
        const fcI = firstCol[i];
        const baseI = rowStart[i] - fcI;
        for (let j = fcI; j < i; j++) {
            const fcJ = firstCol[j];
            const kStart = fcI > fcJ ? fcI : fcJ;
            let sum = L[baseI + j];
            if (kStart < j) {
                const baseJ = rowStart[j] - fcJ;
                for (let k = kStart; k < j; k++) {
                    sum -= L[baseI + k] * L[baseJ + k];
                }
            }
            L[baseI + j] = sum;
        }
        let diag = L[baseI + i];
        for (let j = fcI; j < i; j++) {
            const lijDj = L[baseI + j];
            const lj = lijDj / D[j];
            L[baseI + j] = lj;
            diag -= lijDj * lj;
        }
        if (Math.abs(diag) < 1e-12) diag = diag >= 0 ? 1e-12 : -1e-12;
        D[i] = diag;
        L[baseI + i] = 1.0;
    }

    const Uf = Array.from({ length: nf }, () => new Float64Array(nCases));
    const y = new Float64Array(nf);
    for (let ci = 0; ci < nCases; ci++) {
        for (let i = 0; i < nf; i++) {
            let sum = RHS[perm[i]][ci];
            const fcI = firstCol[i];
            const baseI = rowStart[i] - fcI;
            for (let j = fcI; j < i; j++) sum -= L[baseI + j] * y[j];
            y[i] = sum;
        }
        for (let i = 0; i < nf; i++) y[i] /= D[i];
        for (let i = nf - 1; i >= 0; i--) {
            const xi = y[i];
            if (xi !== 0) {
                const fcI = firstCol[i];
                const baseI = rowStart[i] - fcI;
                for (let j = fcI; j < i; j++) y[j] -= L[baseI + j] * xi;
            }
            Uf[perm[i]][ci] = xi;
        }
    }
    return Uf;
}

function analyzeSpaceFrameFEA(inVertices, inEdges, inAnchors, sectionParams = {}, material = {}, loadConfig = {}) {
    const verts = Array.isArray(inVertices) ? inVertices.map(p => toArr3(p)) : [];
    const edges = Array.isArray(inEdges)
        ? inEdges.filter(e => Array.isArray(e) && e.length >= 2).map(e => [e[0], e[1]])
        : [];
    const nNodes = verts.length;
    const nEdges = edges.length;

    const emptyInvalid = () => ({
        valid: false,
        passed: false,
        governingCaseId: 'none',
        nodalDisplacements: verts.map(() => [0, 0, 0]),
        nodalRotations: verts.map(() => [0, 0, 0]),
        maxDispM: Infinity,
        maxDispMm: Infinity,
        maxDispNode: -1,
        characteristicLengthM: 1.0,
        deflectionRatio: Infinity,
        inverseDeflectionRatio: 0,
        reactions: [],
        appliedLoads: [],
        allNodalLoads: verts.map(() => [0, 0, 0]),
        equilibriumResidual: Infinity,
        members: [],
        minSF_t: 0,
        minSF_c: 0,
        minSF_b: 0,
        lateralMinSF: 0,
        funicularEfficiency: 0,
        compressionDominance: 0,
        tensileBarCount: nEdges,
        maxAxialForceN: 0,
        minAxialForceN: 0,
        centerlineMassKg: 0,
        totalLengthM: 0,
        loadCaseSummaries: []
    });

    if (nNodes < 2 || nEdges < 1) return emptyInvalid();
    for (let i = 0; i < nNodes; i++) {
        const p = verts[i];
        if (!Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) return emptyInvalid();
    }

    const cfg = Array.isArray(loadConfig) ? { loadCases: loadConfig } : (loadConfig || {});
    let anchors = Array.isArray(inAnchors) && inAnchors.length > 0
        ? [...new Set(inAnchors.filter(i => Number.isInteger(i) && i >= 0 && i < nNodes))]
        : [];
    if (anchors.length === 0) {
        const autoAnchors = selectGroundAnchors(verts, edges, { maxAnchors: 4, minAnchors: 3 });
        anchors = [...new Set((autoAnchors || []).filter(i => Number.isInteger(i) && i >= 0 && i < nNodes))];
    }
    if (anchors.length === 0) anchors = [0];

    const R = Math.max(1e-4, Number(sectionParams.outerRadiusM !== undefined ? sectionParams.outerRadiusM : 0.015));
    const r = Math.max(0, Math.min(R - 1e-4, Number(sectionParams.innerRadiusM || 0)));
    const A = Math.PI * (R * R - r * r);
    const I = 0.25 * Math.PI * (Math.pow(R, 4) - Math.pow(r, 4));
    const J = 2.0 * I;
    const rg = 0.5 * Math.sqrt(R * R + r * r);

    const E = Number(material.youngsModulusPa || 5.0e9);
    const nu = Number(material.poissonsRatio || 0.24);
    const G = E / (2.0 * (1.0 + nu));
    const rho = Number(material.densityKgM3 || 1250);
    const sigC = Number(material.compressiveStrengthPa || 12.0e6);
    const sigT = Number(material.tensileStrengthPa || 2.0e6);

    const minReqSF_t = Number(cfg.minSF_t !== undefined ? cfg.minSF_t : 1.5);
    const minReqSF_c = Number(cfg.minSF_c !== undefined ? cfg.minSF_c : 2.0);
    const minReqSF_b = Number(cfg.minSF_b !== undefined ? cfg.minSF_b : 2.0);
    const maxDeflectionRatio = Number(cfg.maxDeflectionRatio !== undefined ? cfg.maxDeflectionRatio : (1.0 / 300.0));
    const restraintType = String(cfg.restraintType || 'pinned').toLowerCase();
    const fixRotations = (restraintType === 'fixed' || restraintType === 'rigid' || restraintType === 'clamped');

    const nDof = 6 * nNodes;
    const anchorSet = new Set(anchors);
    const rotFixedAnchors = new Set();

    if (cfg.ensureComponentFixity) {
        const parent = Int32Array.from({ length: nNodes }, (_, i) => i);
        const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
        for (const [u, v] of edges) {
            const ru = find(u), rv = find(v);
            if (ru !== rv) parent[ru] = rv;
        }
        const compNodes = new Map();
        for (let i = 0; i < nNodes; i++) {
            const r = find(i);
            if (!compNodes.has(r)) compNodes.set(r, []);
            compNodes.get(r).push(i);
        }
        for (const nodes of compNodes.values()) {
            const compAnchors = nodes.filter(ni => anchorSet.has(ni));
            if (compAnchors.length === 0) {
                const sorted = [...nodes].sort((a, b) => verts[a][2] - verts[b][2]);
                const pickCount = Math.min(3, sorted.length);
                for (let k = 0; k < pickCount; k++) {
                    anchorSet.add(sorted[k]);
                    anchors.push(sorted[k]);
                    compAnchors.push(sorted[k]);
                }
            }
            // Prevent rotational mechanisms on components with < 3 non-collinear anchors
            let nonCollinear = false;
            if (compAnchors.length >= 3) {
                const p0 = verts[compAnchors[0]];
                const p1 = verts[compAnchors[1]];
                const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
                for (let k = 2; k < compAnchors.length; k++) {
                    const pk = verts[compAnchors[k]];
                    const bx = pk[0] - p0[0], by = pk[1] - p0[1], bz = pk[2] - p0[2];
                    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
                    if (cx * cx + cy * cy + cz * cz > 1e-6) { nonCollinear = true; break; }
                }
            }
            if (!nonCollinear || cfg.fixAllComponentRotations) {
                for (const ai of compAnchors) rotFixedAnchors.add(ai);
            }
        }
    }

    const fixedDof = new Uint8Array(nDof);
    for (const ai of anchorSet) {
        fixedDof[6 * ai + 0] = 1;
        fixedDof[6 * ai + 1] = 1;
        fixedDof[6 * ai + 2] = 1;
        if (fixRotations || rotFixedAnchors.has(ai)) {
            fixedDof[6 * ai + 3] = 1;
            fixedDof[6 * ai + 4] = 1;
            fixedDof[6 * ai + 5] = 1;
        }
    }

    const freeDofs = [];
    const dofMap = new Int32Array(nDof).fill(-1);
    for (let d = 0; d < nDof; d++) {
        if (!fixedDof[d]) {
            dofMap[d] = freeDofs.length;
            freeDofs.push(d);
        }
    }
    const nf = freeDofs.length;
    if (nf === 0) return emptyInvalid();

    const useSparse = nf > 450;
    const Kff = useSparse ? null : Array.from({ length: nf }, () => new Float64Array(nf));
    const Ksparse = useSparse ? Array.from({ length: nf }, () => new Map()) : null;
    const elemCache = new Array(nEdges);
    let totalLengthM = 0;
    let totalMassKg = 0;
    const edgeSpecs = Array.isArray(cfg.edgeSpecs) ? cfg.edgeSpecs : null;
    const tmpM = Array.from({ length: 12 }, () => new Float64Array(12));

    for (let e = 0; e < nEdges; e++) {
        const [u, v] = edges[e];
        if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= nNodes || v >= nNodes || u === v) return emptyInvalid();
        const pu = verts[u], pv = verts[v];
        const dx = pv[0] - pu[0], dy = pv[1] - pu[1], dz = pv[2] - pu[2];
        const L = Math.hypot(dx, dy, dz);
        if (!Number.isFinite(L) || L < 1e-7) return emptyInvalid();

        const spec = edgeSpecs && edgeSpecs[e] ? edgeSpecs[e] : null;
        const Re = spec && spec.outerRadiusM !== undefined ? Math.max(1e-4, Number(spec.outerRadiusM)) : R;
        const re = spec && spec.innerRadiusM !== undefined ? Math.max(0, Math.min(Re - 1e-4, Number(spec.innerRadiusM))) : (spec ? 0 : r);
        const Ae = Math.PI * (Re * Re - re * re);
        const Ie = 0.25 * Math.PI * (Math.pow(Re, 4) - Math.pow(re, 4));
        const Je = 2.0 * Ie;
        const rge = 0.5 * Math.sqrt(Re * Re + re * re);
        const Ee = spec && spec.youngsModulusPa !== undefined ? Number(spec.youngsModulusPa) : E;
        const Ge = spec && spec.shearModulusPa !== undefined ? Number(spec.shearModulusPa) : (Ee / (2.0 * (1.0 + nu)));
        const rhoe = spec && spec.densityKgM3 !== undefined ? Number(spec.densityKgM3) : rho;
        const sigTe = spec && spec.tensileStrengthPa !== undefined ? Number(spec.tensileStrengthPa) : sigT;
        const sigCe = spec && spec.compressiveStrengthPa !== undefined ? Number(spec.compressiveStrengthPa) : sigC;
        const isElastica = !!(spec && spec.isElastica);
        const initialBendStressPa = spec && spec.initialBendStressPa !== undefined ? Math.max(0, Number(spec.initialBendStressPa)) : 0;

        totalLengthM += L;
        totalMassKg += L * Ae * rhoe;

        const ex = [dx / L, dy / L, dz / L];
        const tmp = Math.abs(ex[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
        let ey = [
            tmp[1] * ex[2] - tmp[2] * ex[1],
            tmp[2] * ex[0] - tmp[0] * ex[2],
            tmp[0] * ex[1] - tmp[1] * ex[0]
        ];
        const eyL = Math.hypot(ey[0], ey[1], ey[2]);
        ey = [ey[0] / eyL, ey[1] / eyL, ey[2] / eyL];
        const ez = [
            ex[1] * ey[2] - ex[2] * ey[1],
            ex[2] * ey[0] - ex[0] * ey[2],
            ex[0] * ey[1] - ex[1] * ey[0]
        ];
        const R3 = [ex, ey, ez];

        const kL = Array.from({ length: 12 }, () => new Float64Array(12));
        const eaL = (Ee * Ae) / L;
        const gjL = (Ge * Je) / L;
        const eiL3 = (12 * Ee * Ie) / (L * L * L);
        const eiL2 = (6 * Ee * Ie) / (L * L);
        const ei4L = (4 * Ee * Ie) / L;
        const ei2L = (2 * Ee * Ie) / L;

        kL[0][0] = eaL;  kL[0][6] = -eaL;
        kL[6][0] = -eaL; kL[6][6] = eaL;
        kL[3][3] = gjL;  kL[3][9] = -gjL;
        kL[9][3] = -gjL; kL[9][9] = gjL;

        kL[1][1] = eiL3;  kL[1][5] = eiL2;   kL[1][7] = -eiL3;  kL[1][11] = eiL2;
        kL[5][1] = eiL2;  kL[5][5] = ei4L;   kL[5][7] = -eiL2;  kL[5][11] = ei2L;
        kL[7][1] = -eiL3; kL[7][5] = -eiL2;  kL[7][7] = eiL3;   kL[7][11] = -eiL2;
        kL[11][1] = eiL2; kL[11][5] = ei2L;  kL[11][7] = -eiL2; kL[11][11] = ei4L;

        kL[2][2] = eiL3;   kL[2][4] = -eiL2;  kL[2][8] = -eiL3;  kL[2][10] = -eiL2;
        kL[4][2] = -eiL2;  kL[4][4] = ei4L;   kL[4][8] = eiL2;   kL[4][10] = ei2L;
        kL[8][2] = -eiL3;  kL[8][4] = eiL2;   kL[8][8] = eiL3;   kL[8][10] = eiL2;
        kL[10][2] = -eiL2; kL[10][4] = ei2L;  kL[10][8] = eiL2;  kL[10][10] = ei4L;

        const T = Array.from({ length: 12 }, () => new Float64Array(12));
        for (let blk = 0; blk < 4; blk++) {
            const o = 3 * blk;
            for (let rI = 0; rI < 3; rI++) {
                for (let cI = 0; cI < 3; cI++) T[o + rI][o + cI] = R3[rI][cI];
            }
        }
        for (let i = 0; i < 12; i++) tmpM[i].fill(0);
        for (let i = 0; i < 12; i++) {
            for (let k = 0; k < 12; k++) {
                const vlk = kL[i][k];
                if (vlk === 0) continue;
                for (let j = 0; j < 12; j++) tmpM[i][j] += vlk * T[k][j];
            }
        }
        const kG = Array.from({ length: 12 }, () => new Float64Array(12));
        for (let i = 0; i < 12; i++) {
            for (let j = 0; j < 12; j++) {
                let s = 0;
                for (let k = 0; k < 12; k++) s += T[k][i] * tmpM[k][j];
                kG[i][j] = s;
            }
        }

        const gDofs = [
            6 * u, 6 * u + 1, 6 * u + 2, 6 * u + 3, 6 * u + 4, 6 * u + 5,
            6 * v, 6 * v + 1, 6 * v + 2, 6 * v + 3, 6 * v + 4, 6 * v + 5
        ];
        for (let i = 0; i < 12; i++) {
            const fi = dofMap[gDofs[i]];
            if (fi === -1) continue;
            if (useSparse) {
                const row = Ksparse[fi];
                for (let j = 0; j < 12; j++) {
                    const fj = dofMap[gDofs[j]];
                    if (fj === -1) continue;
                    const v = kG[i][j];
                    if (v !== 0) row.set(fj, (row.get(fj) || 0) + v);
                }
            } else {
                for (let j = 0; j < 12; j++) {
                    const fj = dofMap[gDofs[j]];
                    if (fj === -1) continue;
                    Kff[fi][fj] += kG[i][j];
                }
            }
        }
        elemCache[e] = { u, v, L, R3, kL, T, kG, gDofs, Re, re, Ae, Ie, Je, rge, Ee, Ge, rhoe, sigTe, sigCe, isElastica, initialBendStressPa };
    }

    // Tiny rotational regularization to prevent collinear torsional singularity on pinned nodes
    for (let i = 0; i < nf; i++) {
        if ((freeDofs[i] % 6) >= 3) {
            if (useSparse) Ksparse[i].set(i, (Ksparse[i].get(i) || 0) + 1e-6);
            else Kff[i][i] += 1e-6;
        }
    }

    const bb = computeBoundingBox(verts);
    const spanX = bb.max[0] - bb.min[0];
    const spanY = bb.max[1] - bb.min[1];
    const H = Math.max(1e-6, bb.max[2] - bb.min[2]);
    const zMin = bb.min[2];
    const characteristicLengthM = cfg.characteristicLengthM !== undefined
        ? Math.max(1e-3, Number(cfg.characteristicLengthM))
        : Math.max(0.1, Math.min(Math.max(spanX, spanY), H));

    const gravDefault = cfg.gravityMS2 !== undefined ? Number(cfg.gravityMS2) : 9.81;
    const topFracDefault = cfg.topZoneFractionZ !== undefined ? Number(cfg.topZoneFractionZ) : 0.85;
    const topMassDefault = cfg.distributedVerticalMassKg !== undefined
        ? Number(cfg.distributedVerticalMassKg)
        : (cfg.loadZ !== undefined ? (Number(cfg.loadZ) / Math.max(1e-6, gravDefault)) : 50.0);

    const casesToRun = [];
    if (Array.isArray(cfg.loadCases) && cfg.loadCases.length > 0) {
        for (const lc of cfg.loadCases) {
            casesToRun.push({
                id: lc.id || 'LC_custom',
                grav: lc.gravityMS2 !== undefined ? Number(lc.gravityMS2) : gravDefault,
                topMassKg: lc.distributedVerticalMassKg !== undefined ? Number(lc.distributedVerticalMassKg) : 0,
                topFrac: lc.topZoneFractionZ !== undefined ? Number(lc.topZoneFractionZ) : topFracDefault,
                lateralX: Number(lc.lateralX || 0),
                lateralY: Number(lc.lateralY || 0),
                required: lc.required !== false
            });
        }
    } else {
        casesToRun.push({
            id: 'LC1_self_weight',
            grav: gravDefault,
            topMassKg: 0,
            topFrac: topFracDefault,
            lateralX: 0,
            lateralY: 0,
            required: true
        });
        casesToRun.push({
            id: 'LC2_self_weight_plus_load',
            grav: gravDefault,
            topMassKg: topMassDefault,
            topFrac: topFracDefault,
            lateralX: Number(cfg.lateralX || 0),
            lateralY: Number(cfg.lateralY || 0),
            required: true
        });
    }

    let peakTopLoadN = Math.max(1.0, topMassDefault * gravDefault);
    for (const c of casesToRun) {
        if (c.topMassKg * c.grav > peakTopLoadN) peakTopLoadN = c.topMassKg * c.grav;
    }
    casesToRun.push({ id: 'LC_lateral_5pct_X',  grav: gravDefault, topMassKg: peakTopLoadN / gravDefault, topFrac: topFracDefault, lateralX: 0.05 * peakTopLoadN, lateralY: 0, required: false });
    casesToRun.push({ id: 'LC_lateral_5pct_Y',  grav: gravDefault, topMassKg: peakTopLoadN / gravDefault, topFrac: topFracDefault, lateralX: 0, lateralY: 0.05 * peakTopLoadN, required: false });
    casesToRun.push({ id: 'LC_lateral_5pct_XY', grav: gravDefault, topMassKg: peakTopLoadN / gravDefault, topFrac: topFracDefault, lateralX: 0.035355 * peakTopLoadN, lateralY: 0.035355 * peakTopLoadN, required: false });

    const nCases = casesToRun.length;
    const RHS = Array.from({ length: nf }, () => new Float64Array(nCases));
    const globalAppliedDof = Array.from({ length: nCases }, () => new Float64Array(nDof));
    const globalExternalOnlyDof = Array.from({ length: nCases }, () => new Float64Array(nDof));
    const elemFEF = Array.from({ length: nCases }, () => Array.from({ length: nEdges }, () => new Float64Array(12)));

    for (let ci = 0; ci < nCases; ci++) {
        const lc = casesToRun[ci];
        const fExt = globalAppliedDof[ci];
        const fVis = globalExternalOnlyDof[ci];

        for (let e = 0; e < nEdges; e++) {
            const ec = elemCache[e];
            const L = ec.L;
            const qz = -ec.rhoe * lc.grav * ec.Ae;
            const qlx = ec.R3[0][2] * qz;
            const qly = ec.R3[1][2] * qz;
            const qlz = ec.R3[2][2] * qz;
            const fefGrav = new Float64Array(12);
            fefGrav[0]  = 0.5 * qlx * L;
            fefGrav[1]  = 0.5 * qly * L;
            fefGrav[2]  = 0.5 * qlz * L;
            fefGrav[4]  = -(qlz * L * L) / 12.0;
            fefGrav[5]  =  (qly * L * L) / 12.0;
            fefGrav[6]  = 0.5 * qlx * L;
            fefGrav[7]  = 0.5 * qly * L;
            fefGrav[8]  = 0.5 * qlz * L;
            fefGrav[10] =  (qlz * L * L) / 12.0;
            fefGrav[11] = -(qly * L * L) / 12.0;

            const fefL = elemFEF[ci][e];
            for (let k = 0; k < 12; k++) fefL[k] = fefGrav[k];

            for (let i = 0; i < 12; i++) {
                let fgGrav = 0;
                for (let k = 0; k < 12; k++) {
                    fgGrav += ec.T[k][i] * fefGrav[k];
                }
                const gd = ec.gDofs[i];
                fExt[gd] += fgGrav;
                fVis[gd] += fgGrav;
                const fi = dofMap[gd];
                if (fi !== -1) RHS[fi][ci] += fgGrav;
            }
        }

        // Apply self-equilibrated chord tightening & active-bending thrusts between coupled rod endpoints
        if (Array.isArray(cfg.nodalSelfStressPairs)) {
            for (const pair of cfg.nodalSelfStressPairs) {
                const { u, v, pullForceN } = pair;
                if (u < 0 || v < 0 || u >= nNodes || v >= nNodes || u === v) continue;
                const pu = verts[u], pv = verts[v];
                const dx = pv[0] - pu[0], dy = pv[1] - pu[1], dz = pv[2] - pu[2];
                const cl = Math.hypot(dx, dy, dz);
                if (cl < 1e-6) continue;
                const fx = (pullForceN * dx) / cl;
                const fy = (pullForceN * dy) / cl;
                const fz = (pullForceN * dz) / cl;
                fExt[6 * u + 0] += fx; fExt[6 * u + 1] += fy; fExt[6 * u + 2] += fz;
                fExt[6 * v + 0] -= fx; fExt[6 * v + 1] -= fy; fExt[6 * v + 2] -= fz;
                if (dofMap[6 * u + 0] !== -1) RHS[dofMap[6 * u + 0]][ci] += fx;
                if (dofMap[6 * u + 1] !== -1) RHS[dofMap[6 * u + 1]][ci] += fy;
                if (dofMap[6 * u + 2] !== -1) RHS[dofMap[6 * u + 2]][ci] += fz;
                if (dofMap[6 * v + 0] !== -1) RHS[dofMap[6 * v + 0]][ci] -= fx;
                if (dofMap[6 * v + 1] !== -1) RHS[dofMap[6 * v + 1]][ci] -= fy;
                if (dofMap[6 * v + 2] !== -1) RHS[dofMap[6 * v + 2]][ci] -= fz;
            }
        }

        let topNodes = [];
        const nHostOnly = (cfg.hostNodeCount !== undefined && Number(cfg.hostNodeCount) > 0) ? Number(cfg.hostNodeCount) : nNodes;
        const topZCut = zMin + lc.topFrac * H;
        for (let ni = 0; ni < nHostOnly; ni++) {
            if (!anchorSet.has(ni) && verts[ni][2] >= topZCut - 1e-6) topNodes.push(ni);
        }
        if (topNodes.length === 0) {
            let bestNi = -1, bestZ = -Infinity;
            for (let ni = 0; ni < nHostOnly; ni++) {
                if (!anchorSet.has(ni) && verts[ni][2] > bestZ) { bestZ = verts[ni][2]; bestNi = ni; }
            }
            if (bestNi !== -1) topNodes = [bestNi];
        }
        if (topNodes.length > 0 && (Math.abs(lc.topMassKg) > 0 || Math.abs(lc.lateralX) > 0 || Math.abs(lc.lateralY) > 0)) {
            const fzPer = -(lc.topMassKg * lc.grav) / topNodes.length;
            const fxPer = (lc.lateralX || 0) / topNodes.length;
            const fyPer = (lc.lateralY || 0) / topNodes.length;
            for (const ni of topNodes) {
                fExt[6 * ni + 0] += fxPer;
                fExt[6 * ni + 1] += fyPer;
                fExt[6 * ni + 2] += fzPer;
                fVis[6 * ni + 0] += fxPer;
                fVis[6 * ni + 1] += fyPer;
                fVis[6 * ni + 2] += fzPer;
                if (dofMap[6 * ni + 0] !== -1) RHS[dofMap[6 * ni + 0]][ci] += fxPer;
                if (dofMap[6 * ni + 1] !== -1) RHS[dofMap[6 * ni + 1]][ci] += fyPer;
                if (dofMap[6 * ni + 2] !== -1) RHS[dofMap[6 * ni + 2]][ci] += fzPer;
            }
        }
    }

    const Uf = useSparse
        ? solveSparseBandedLDLT(nf, Ksparse, RHS, nCases)
        : solveLinearSystem(Kff, RHS);
    for (let i = 0; i < nf; i++) {
        for (let ci = 0; ci < nCases; ci++) {
            if (!Number.isFinite(Uf[i][ci])) return emptyInvalid();
        }
    }

    // Pick governing required load case (explicit cfg.governingCaseId, else required case with highest vertical load)
    let govCi = 0;
    if (cfg.governingCaseId) {
        const idx = casesToRun.findIndex(c => c.id === cfg.governingCaseId);
        if (idx >= 0) govCi = idx;
    } else {
        let bestLoad = -1;
        for (let ci = 0; ci < nCases; ci++) {
            if (casesToRun[ci].required && casesToRun[ci].topMassKg >= bestLoad) {
                bestLoad = casesToRun[ci].topMassKg;
                govCi = ci;
            }
        }
    }

    let minSF_t = Infinity, minSF_c = Infinity, minSF_b = Infinity, lateralMinSF = Infinity;
    let maxDispReqM = 0.0;
    const barMaxTensForce = new Float64Array(nEdges).fill(-Infinity);
    const loadCaseSummaries = [];
    let govResult = null;

    for (let ci = 0; ci < nCases; ci++) {
        const lc = casesToRun[ci];
        const uGlobal = new Float64Array(nDof);
        for (let i = 0; i < nf; i++) uGlobal[freeDofs[i]] = Uf[i][ci];

        // Compute global internal force vector Ku and support reactions R = Ku - F_applied
        const KuGlobal = new Float64Array(nDof);
        for (let e = 0; e < nEdges; e++) {
            const ec = elemCache[e];
            for (let i = 0; i < 12; i++) {
                let s = 0;
                for (let j = 0; j < 12; j++) s += ec.kG[i][j] * uGlobal[ec.gDofs[j]];
                KuGlobal[ec.gDofs[i]] += s;
            }
        }

        const fExt = globalAppliedDof[ci];
        let eqResSq = 0;
        for (let i = 0; i < nf; i++) {
            const gd = freeDofs[i];
            if ((gd % 6) < 3) {
                const diff = KuGlobal[gd] - fExt[gd];
                eqResSq += diff * diff;
            }
        }
        const eqResidual = Math.sqrt(eqResSq);

        let caseMaxDispM = 0;
        let caseMaxNode = 0;
        const nodalDisps = new Array(nNodes);
        const nodalRots  = new Array(nNodes);
        const nHostOnlyDisp = (cfg.hostNodeCount !== undefined && Number(cfg.hostNodeCount) > 0) ? Number(cfg.hostNodeCount) : nNodes;
        for (let ni = 0; ni < nNodes; ni++) {
            const ux = uGlobal[6 * ni + 0], uy = uGlobal[6 * ni + 1], uz = uGlobal[6 * ni + 2];
            const rx = uGlobal[6 * ni + 3], ry = uGlobal[6 * ni + 4], rz = uGlobal[6 * ni + 5];
            nodalDisps[ni] = [ux, uy, uz];
            nodalRots[ni]  = [rx, ry, rz];
            if (ni < nHostOnlyDisp) {
                const d = Math.hypot(ux, uy, uz);
                if (d > caseMaxDispM) { caseMaxDispM = d; caseMaxNode = ni; }
            }
        }
        if (lc.required && caseMaxDispM > maxDispReqM) maxDispReqM = caseMaxDispM;

        let caseMinSF_t = Infinity, caseMinSF_c = Infinity, caseMinSF_b = Infinity;
        let sumUAxial = 0, sumUBend = 0, sumUTors = 0;
        let sumCompAbsNL = 0, sumTotalAbsNL = 0;
        const caseMembers = new Array(nEdges);

        for (let e = 0; e < nEdges; e++) {
            const ec = elemCache[e];
            const uL = new Float64Array(12);
            for (let i = 0; i < 12; i++) {
                let s = 0;
                for (let j = 0; j < 12; j++) s += ec.T[i][j] * uGlobal[ec.gDofs[j]];
                uL[i] = s;
            }
            const fInt = new Float64Array(12);
            const fefL = elemFEF[ci][e];
            for (let i = 0; i < 12; i++) {
                let s = -fefL[i];
                for (let j = 0; j < 12; j++) s += ec.kL[i][j] * uL[j];
                fInt[i] = s;
            }

            // Convention: axialForceN > 0 tension, axialForceN < 0 compression
            const N_u = -fInt[0];
            const N_v =  fInt[6];
            const N_avg = 0.5 * (N_u + N_v);
            const N_worstTens = Math.max(N_u, N_v, N_avg);

            const V_u = Math.hypot(fInt[1], fInt[2]);
            const V_v = Math.hypot(fInt[7], fInt[8]);
            const V_max = Math.max(V_u, V_v);
            const T_max = Math.max(Math.abs(fInt[3]), Math.abs(fInt[9]));
            const M_u = Math.hypot(fInt[4], fInt[5]);
            const M_v = Math.hypot(fInt[10], fInt[11]);
            const M_max = Math.max(M_u, M_v);

            const Z_mod = ec.Ie / ec.Re;
            const sigAxial = N_avg / ec.Ae;
            const sigBend = M_max / Z_mod + (ec.initialBendStressPa || 0);
            const peakTensPa = Math.max(0, Math.max(N_u, N_v) / ec.Ae + sigBend);
            const peakCompPa = Math.max(0, -Math.min(N_u, N_v) / ec.Ae + sigBend);

            const sfT = peakTensPa > 1e-6 ? (ec.sigTe / peakTensPa) : 999.0;
            const sfC = peakCompPa > 1e-6 ? (ec.sigCe / peakCompPa) : 999.0;
            const P_comp = Math.max(0, -Math.min(N_u, N_v, N_avg));
            const P_crit = (Math.PI * Math.PI * ec.Ee * ec.Ie) / (ec.L * ec.L);
            const sfB = P_comp > 1e-6 ? (P_crit / P_comp) : 999.0;
            const govSF = Math.min(sfT, sfC, sfB);
            const utilCode = Math.max(
                peakTensPa / Math.max(1.0, ec.sigTe / minReqSF_t),
                peakCompPa / Math.max(1.0, ec.sigCe / minReqSF_c),
                P_comp / Math.max(1e-6, P_crit / minReqSF_b)
            );

            // Member strain energy partition (axial vs bending vs torsion)
            const uAx = (N_avg * N_avg * ec.L) / Math.max(1e-9, 2.0 * ec.Ee * ec.Ae);
            const mSqAvg = 0.5 * (M_u * M_u + M_v * M_v);
            const uBd = (mSqAvg * ec.L) / Math.max(1e-9, 2.0 * ec.Ee * ec.Ie);
            const uTr = (T_max * T_max * ec.L) / Math.max(1e-9, 2.0 * ec.Ge * ec.Je);
            sumUAxial += uAx;
            sumUBend  += uBd;
            sumUTors  += uTr;

            const absNL = Math.abs(N_avg) * ec.L;
            sumTotalAbsNL += absNL;
            if (N_avg < 0) sumCompAbsNL += absNL;

            if (sfT < caseMinSF_t) caseMinSF_t = sfT;
            if (sfC < caseMinSF_c) caseMinSF_c = sfC;
            if (sfB < caseMinSF_b) caseMinSF_b = sfB;

            if (lc.required) {
                if (N_avg > barMaxTensForce[e]) barMaxTensForce[e] = N_avg;
                if (N_worstTens > barMaxTensForce[e] && N_avg > -0.2) barMaxTensForce[e] = N_worstTens;
                if (sfT < minSF_t) minSF_t = sfT;
                if (sfC < minSF_c) minSF_c = sfC;
                if (sfB < minSF_b) minSF_b = sfB;
            } else {
                if (govSF < lateralMinSF) lateralMinSF = govSF;
            }

            caseMembers[e] = {
                edgeIndex: e,
                u: ec.u,
                v: ec.v,
                isElastica: ec.isElastica,
                outerRadiusM: ec.Re,
                lengthM: ec.L,
                slenderness: ec.L / Math.max(1e-6, ec.rge),
                axialForceN: N_avg,
                shearForceN: V_max,
                torsionMomentNm: T_max,
                bendingMomentNm: M_max,
                sigmaAxialPa: sigAxial,
                sigmaBendingPa: sigBend,
                sigmaTensilePa: peakTensPa,
                sigmaCompressivePa: peakCompPa,
                bucklingLoadN: P_crit,
                sfTension: sfT,
                sfCompression: sfC,
                sfBuckling: sfB,
                governingSF: govSF,
                bucklingUtilization: P_comp / Math.max(1e-6, P_crit),
                utilization: utilCode
            };
        }

        loadCaseSummaries.push({
            id: lc.id,
            required: lc.required,
            maxDispM: caseMaxDispM,
            minSF_t: caseMinSF_t,
            minSF_c: caseMinSF_c,
            minSF_b: caseMinSF_b,
            equilibriumResidual: eqResidual
        });

        if (ci === govCi) {
            const reactions = anchors.map(ai => {
                const Rx = KuGlobal[6 * ai + 0] - fExt[6 * ai + 0];
                const Ry = KuGlobal[6 * ai + 1] - fExt[6 * ai + 1];
                const Rz = KuGlobal[6 * ai + 2] - fExt[6 * ai + 2];
                const Mx = fixRotations ? (KuGlobal[6 * ai + 3] - fExt[6 * ai + 3]) : 0;
                const My = fixRotations ? (KuGlobal[6 * ai + 4] - fExt[6 * ai + 4]) : 0;
                const Mz = fixRotations ? (KuGlobal[6 * ai + 5] - fExt[6 * ai + 5]) : 0;
                return {
                    nodeIndex: ai,
                    force: [Rx, Ry, Rz],
                    moment: [Mx, My, Mz],
                    magnitudeN: Math.hypot(Rx, Ry, Rz)
                };
            });

            const fVis = globalExternalOnlyDof[ci];
            const allNodalLoads = new Array(nNodes);
            const appliedLoads = [];
            for (let ni = 0; ni < nNodes; ni++) {
                const fx = fVis[6 * ni + 0], fy = fVis[6 * ni + 1], fz = fVis[6 * ni + 2];
                allNodalLoads[ni] = [fx, fy, fz];
                const mag = Math.hypot(fx, fy, fz);
                if (mag > 1e-6) {
                    appliedLoads.push({ nodeIndex: ni, force: [fx, fy, fz], magnitudeN: mag });
                }
            }

            const totEnergy = sumUAxial + sumUBend + sumUTors;
            const funicularEfficiency = totEnergy > 1e-15 ? (sumUAxial / totEnergy) : 1.0;
            const compressionDominance = sumTotalAbsNL > 1e-12 ? (sumCompAbsNL / sumTotalAbsNL) : 1.0;

            govResult = {
                governingCaseId: lc.id,
                nodalDisplacements: nodalDisps,
                nodalRotations: nodalRots,
                maxDispM: caseMaxDispM,
                maxDispMm: caseMaxDispM * 1000.0,
                maxDispNode: caseMaxNode,
                reactions,
                appliedLoads,
                allNodalLoads,
                equilibriumResidual: eqResidual,
                members: caseMembers,
                funicularEfficiency,
                compressionDominance
            };
        }
    }

    let tensileBarCount = 0;
    let maxAxialForceN = -Infinity;
    let minAxialForceN = Infinity;
    for (let e = 0; e < nEdges; e++) {
        const fGov = govResult.members[e].axialForceN;
        if (fGov > maxAxialForceN) maxAxialForceN = fGov;
        if (fGov < minAxialForceN) minAxialForceN = fGov;
        if (barMaxTensForce[e] > 0.0) tensileBarCount++;
    }

    const dispM = Math.max(maxDispReqM, govResult.maxDispM);
    const deflectionRatio = dispM / characteristicLengthM;
    const inverseDeflectionRatio = dispM > 1e-12 ? (characteristicLengthM / dispM) : 999999.0;
    const centerlineMassKg = totalMassKg;
    const passed = (deflectionRatio <= maxDeflectionRatio)
        && (minSF_t >= minReqSF_t)
        && (minSF_c >= minReqSF_c)
        && (minSF_b >= minReqSF_b);

    return {
        valid: true,
        passed,
        governingCaseId: govResult.governingCaseId,
        restraintType: fixRotations ? 'fixed' : 'pinned',
        nodalDisplacements: govResult.nodalDisplacements,
        nodalRotations: govResult.nodalRotations,
        maxDispM: dispM,
        maxDispMm: dispM * 1000.0,
        maxDispNode: govResult.maxDispNode,
        characteristicLengthM,
        deflectionRatio,
        inverseDeflectionRatio,
        reactions: govResult.reactions,
        appliedLoads: govResult.appliedLoads,
        allNodalLoads: govResult.allNodalLoads,
        equilibriumResidual: govResult.equilibriumResidual,
        members: govResult.members,
        minSF_t,
        minSF_c,
        minSF_b,
        lateralMinSF: Number.isFinite(lateralMinSF) ? lateralMinSF : Math.min(minSF_t, minSF_c, minSF_b),
        funicularEfficiency: govResult.funicularEfficiency,
        compressionDominance: govResult.compressionDominance,
        tensileBarCount,
        maxAxialForceN,
        minAxialForceN,
        centerlineMassKg,
        totalLengthM,
        loadCaseSummaries
    };
}

export {
    estimateFrameMechanics,
    analyzeSpaceFrameFEA
};

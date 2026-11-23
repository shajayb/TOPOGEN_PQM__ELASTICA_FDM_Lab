/**
 * Independent 3D Euler-Bernoulli Space Frame Finite Element Analysis (FEA) Solver
 * Domain: TOPOGEN_FDM_Foundry/verifier (strictly air-gapped, zero external dependencies)
 *
 * Coordinate system: Right-handed 3D Cartesian (X, Y, Z), Z-up.
 * DOFs per node: 6 [ux, uy, uz, rx, ry, rz]
 * Units: SI (meters, Newtons, Pascals, kg, seconds)
 */

/**
 * Compute cross-section geometric properties for solid or hollow circular sections.
 * @param {number} outerRadiusM
 * @param {number} innerRadiusM
 * @returns {{ rOuter: number, rInner: number, isHollow: boolean, area: number, I: number, J: number, rg: number }}
 */
export function computeSectionProperties(outerRadiusM, innerRadiusM = 0) {
  const ro = Number(outerRadiusM);
  const ri = Math.max(0, Number(innerRadiusM) || 0);
  if (!(ro > 0) || !Number.isFinite(ro)) {
    throw new Error(`Invalid outerRadiusM: ${outerRadiusM}`);
  }
  if (ri >= ro) {
    throw new Error(`innerRadiusM (${ri}) must be strictly less than outerRadiusM (${ro})`);
  }
  const ro2 = ro * ro;
  const ri2 = ri * ri;
  const ro4 = ro2 * ro2;
  const ri4 = ri2 * ri2;
  const area = Math.PI * (ro2 - ri2);
  const I = (Math.PI / 4) * (ro4 - ri4);
  const J = (Math.PI / 2) * (ro4 - ri4); // Polar moment of inertia = Iy + Iz = 2*I
  const rg = Math.sqrt(I / area);
  return {
    rOuter: ro,
    rInner: ri,
    isHollow: ri > 1e-12,
    area,
    I,
    J,
    rg,
  };
}

/**
 * Resolve per-edge section properties from topology JSON.
 * Supports uniform `section` plus optional per-edge `section.edgeRadiiM` or `edgeRadiiM`.
 */
export function resolveEdgeSection(topology, edgeIndex) {
  const sec = topology.section || {};
  const edgeRadii = sec.edgeRadiiM || topology.edgeRadiiM || null;
  const ro =
    Array.isArray(edgeRadii) && edgeRadii[edgeIndex] != null
      ? Number(edgeRadii[edgeIndex])
      : Number(sec.outerRadiusM ?? 0.035);
  let ri = 0;
  if (sec.shape === 'circular_hollow' || (sec.innerRadiusM != null && Number(sec.innerRadiusM) > 0)) {
    const edgeInner = sec.edgeInnerRadiiM || topology.edgeInnerRadiiM || null;
    ri =
      Array.isArray(edgeInner) && edgeInner[edgeIndex] != null
        ? Number(edgeInner[edgeIndex])
        : Number(sec.innerRadiusM ?? 0);
  }
  return computeSectionProperties(ro, ri);
}

/**
 * Compute orthonormal local triad (ex, ey, ez) and 3x3 rotation matrix R (row-major: rows are ex, ey, ez)
 * mapping global vectors to local vectors: v_local = R * v_global.
 * Safely handles vertical members parallel to global Z.
 */
export function computeMemberTriad(p1, p2) {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const dz = p2[2] - p1[2];
  const L = Math.hypot(dx, dy, dz);
  if (!(L > 1e-12)) {
    throw new Error(`Degenerate zero-length member between [${p1}] and [${p2}]`);
  }
  const ex = [dx / L, dy / L, dz / L];

  // Choose reference vector not parallel to ex
  // Standard: global Z = [0, 0, 1]. If member is vertical (|ex.z| >= 0.999), use global Y = [0, 1, 0].
  const ref = Math.abs(ex[2]) < 0.999 ? [0, 0, 1] : [0, 1, 0];

  // ey = normalize(ref x ex)
  let eyx = ref[1] * ex[2] - ref[2] * ex[1];
  let eyy = ref[2] * ex[0] - ref[0] * ex[2];
  let eyz = ref[0] * ex[1] - ref[1] * ex[0];
  const eyLen = Math.hypot(eyx, eyy, eyz);
  eyx /= eyLen;
  eyy /= eyLen;
  eyz /= eyLen;
  const ey = [eyx, eyy, eyz];

  // ez = ex x ey (guaranteed unit length and right-handed)
  const ez = [
    ex[1] * ey[2] - ex[2] * ey[1],
    ex[2] * ey[0] - ex[0] * ey[2],
    ex[0] * ey[1] - ex[1] * ey[0],
  ];

  // 3x3 rotation matrix R (row-major)
  const R = [
    ex[0], ex[1], ex[2],
    ey[0], ey[1], ey[2],
    ez[0], ez[1], ez[2],
  ];

  return { L, ex, ey, ez, R };
}

/**
 * Build exact 12x12 local Euler-Bernoulli 3D space frame element stiffness matrix.
 * Local DOF ordering: [u1, v1, w1, rx1, ry1, rz1, u2, v2, w2, rx2, ry2, rz2]
 *
 * Sign conventions (right-handed):
 *   - Bending in x-y plane (v, rz): dv/dx = +rz
 *   - Bending in x-z plane (w, ry): dw/dx = -ry
 */
export function buildLocalStiffnessMatrix(E, G, A, Iy, Iz, J, L) {
  const k = new Float64Array(144);
  const set = (r, c, val) => {
    k[r * 12 + c] = val;
  };

  const L2 = L * L;
  const L3 = L2 * L;

  // Axial (u1=0, u2=6)
  const ka = (E * A) / L;
  set(0, 0, ka);  set(0, 6, -ka);
  set(6, 0, -ka); set(6, 6, ka);

  // Torsion (rx1=3, rx2=9)
  const kt = (G * J) / L;
  set(3, 3, kt);  set(3, 9, -kt);
  set(9, 3, -kt); set(9, 9, kt);

  // Bending in local x-y plane (v1=1, rz1=5, v2=7, rz2=11) using Iz
  const az = (12 * E * Iz) / L3;
  const bz = (6 * E * Iz) / L2;
  const cz = (4 * E * Iz) / L;
  const dz = (2 * E * Iz) / L;

  set(1, 1, az);   set(1, 5, bz);   set(1, 7, -az);  set(1, 11, bz);
  set(5, 1, bz);   set(5, 5, cz);   set(5, 7, -bz);  set(5, 11, dz);
  set(7, 1, -az);  set(7, 5, -bz);  set(7, 7, az);   set(7, 11, -bz);
  set(11, 1, bz);  set(11, 5, dz);  set(11, 7, -bz); set(11, 11, cz);

  // Bending in local x-z plane (w1=2, ry1=4, w2=8, ry2=10) using Iy
  const ay = (12 * E * Iy) / L3;
  const by = (6 * E * Iy) / L2;
  const cy = (4 * E * Iy) / L;
  const dy = (2 * E * Iy) / L;

  set(2, 2, ay);   set(2, 4, -by);  set(2, 8, -ay);  set(2, 10, -by);
  set(4, 2, -by);  set(4, 4, cy);   set(4, 8, by);   set(4, 10, dy);
  set(8, 2, -ay);  set(8, 4, by);   set(8, 8, ay);   set(8, 10, by);
  set(10, 2, -by); set(10, 4, dy);  set(10, 8, by);  set(10, 10, cy);

  return k;
}

/**
 * Transform 12x12 local stiffness matrix to global coordinates: K_global = T^T * K_local * T
 * where T = block_diag(R, R, R, R).
 */
export function transformStiffnessToGlobal(kLocal, R) {
  // Compute temp = kLocal * T (exploiting 3x3 block structure of T)
  const temp = new Float64Array(144);
  for (let row = 0; row < 12; row++) {
    const rowOff = row * 12;
    for (let blk = 0; blk < 4; blk++) {
      const c0 = blk * 3;
      const a0 = kLocal[rowOff + c0];
      const a1 = kLocal[rowOff + c0 + 1];
      const a2 = kLocal[rowOff + c0 + 2];
      temp[rowOff + c0]     = a0 * R[0] + a1 * R[3] + a2 * R[6];
      temp[rowOff + c0 + 1] = a0 * R[1] + a1 * R[4] + a2 * R[7];
      temp[rowOff + c0 + 2] = a0 * R[2] + a1 * R[5] + a2 * R[8];
    }
  }

  // Compute kGlobal = T^T * temp (T^T has R^T on its 3x3 diagonal blocks)
  const kGlobal = new Float64Array(144);
  for (let blk = 0; blk < 4; blk++) {
    const r0 = blk * 3;
    for (let col = 0; col < 12; col++) {
      const b0 = temp[(r0) * 12 + col];
      const b1 = temp[(r0 + 1) * 12 + col];
      const b2 = temp[(r0 + 2) * 12 + col];
      kGlobal[(r0) * 12 + col]     = R[0] * b0 + R[3] * b1 + R[6] * b2;
      kGlobal[(r0 + 1) * 12 + col] = R[1] * b0 + R[4] * b1 + R[7] * b2;
      kGlobal[(r0 + 2) * 12 + col] = R[2] * b0 + R[5] * b1 + R[8] * b2;
    }
  }
  return kGlobal;
}

/**
 * Transform a 12-vector from global to local coordinates: v_local = T * v_global.
 */
function transformVecGlobalToLocal(vGlobal, R) {
  const vLocal = new Float64Array(12);
  for (let blk = 0; blk < 4; blk++) {
    const i = blk * 3;
    const x = vGlobal[i];
    const y = vGlobal[i + 1];
    const z = vGlobal[i + 2];
    vLocal[i]     = R[0] * x + R[1] * y + R[2] * z;
    vLocal[i + 1] = R[3] * x + R[4] * y + R[5] * z;
    vLocal[i + 2] = R[6] * x + R[7] * y + R[8] * z;
  }
  return vLocal;
}

/**
 * Transform a 12-vector from local to global coordinates: v_global = T^T * v_local.
 */
function transformVecLocalToGlobal(vLocal, R) {
  const vGlobal = new Float64Array(12);
  for (let blk = 0; blk < 4; blk++) {
    const i = blk * 3;
    const x = vLocal[i];
    const y = vLocal[i + 1];
    const z = vLocal[i + 2];
    vGlobal[i]     = R[0] * x + R[3] * y + R[6] * z;
    vGlobal[i + 1] = R[1] * x + R[4] * y + R[7] * z;
    vGlobal[i + 2] = R[2] * x + R[5] * y + R[8] * z;
  }
  return vGlobal;
}

/**
 * Dense Gaussian elimination with partial pivoting for A * x = b.
 * Modifies A and b in place. Detects singular / mechanism / ill-conditioned systems.
 * @param {Float64Array} A - n x n row-major matrix
 * @param {Float64Array} b - n RHS vector
 * @param {number} n
 * @returns {{ x: Float64Array, ok: boolean, minPivotRatio: number, singularDof?: number, reason?: string }}
 */
export function solveLinearSystem(A, b, n) {
  if (n === 0) {
    return { x: new Float64Array(0), ok: true, minPivotRatio: 1.0 };
  }

  // Track max diagonal magnitude for relative singularity tolerance
  let maxDiag = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.abs(A[i * n + i]);
    if (d > maxDiag) maxDiag = d;
  }
  if (!(maxDiag > 0) || !Number.isFinite(maxDiag)) {
    return {
      x: new Float64Array(n),
      ok: false,
      minPivotRatio: 0,
      singularDof: 0,
      reason: 'Zero stiffness matrix (no active structural members)',
    };
  }

  let minPivot = Infinity;
  const tol = 1e-12 * maxDiag;

  // Forward elimination with partial pivoting
  for (let k = 0; k < n; k++) {
    let pivotRow = k;
    let maxVal = Math.abs(A[k * n + k]);
    for (let i = k + 1; i < n; i++) {
      const val = Math.abs(A[i * n + k]);
      if (val > maxVal) {
        maxVal = val;
        pivotRow = i;
      }
    }

    if (maxVal < tol || !Number.isFinite(maxVal)) {
      return {
        x: new Float64Array(n),
        ok: false,
        minPivotRatio: maxVal / maxDiag,
        singularDof: k,
        reason: `Singular or mechanism stiffness matrix at reduced DOF ${k} (pivot ${maxVal.toExponential(3)}, maxDiag ${maxDiag.toExponential(3)})`,
      };
    }
    if (maxVal < minPivot) minPivot = maxVal;

    // Swap rows k and pivotRow
    if (pivotRow !== k) {
      const kOff = k * n;
      const pOff = pivotRow * n;
      for (let j = k; j < n; j++) {
        const tmp = A[kOff + j];
        A[kOff + j] = A[pOff + j];
        A[pOff + j] = tmp;
      }
      const tmpB = b[k];
      b[k] = b[pivotRow];
      b[pivotRow] = tmpB;
    }

    const kOff = k * n;
    const pivot = A[kOff + k];

    // Eliminate below pivot
    for (let i = k + 1; i < n; i++) {
      const iOff = i * n;
      const a_ik = A[iOff + k];
      if (a_ik === 0) continue;
      const factor = a_ik / pivot;
      A[iOff + k] = 0;
      for (let j = k + 1; j < n; j++) {
        A[iOff + j] -= factor * A[kOff + j];
      }
      b[i] -= factor * b[k];
    }
  }

  // Back substitution
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    const iOff = i * n;
    let sum = b[i];
    for (let j = i + 1; j < n; j++) {
      sum -= A[iOff + j] * x[j];
    }
    const diag = A[iOff + i];
    if (!Number.isFinite(sum) || Math.abs(diag) < tol) {
      return {
        x,
        ok: false,
        minPivotRatio: Math.abs(diag) / maxDiag,
        singularDof: i,
        reason: `Numerical instability during back substitution at reduced DOF ${i}`,
      };
    }
    x[i] = sum / diag;
  }

  const minPivotRatio = minPivot / maxDiag;
  return { x, ok: true, minPivotRatio };
}

/**
 * Solve a 3D Euler-Bernoulli Space Frame under a specified load case.
 *
 * @param {object} topology - wfc-fdm-topology/v1 object ({ vertices, edges, anchors, section })
 * @param {object} material - { densityKgM3, youngsModulusPa, poissonsRatio, compressiveStrengthPa, tensileStrengthPa, shearStrengthPa }
 * @param {object} loadCase - { id, name, gravityMS2, distributedVerticalMassKg, distributedVerticalForceN, distribution, topZoneFractionZ, nodalLoads }
 * @param {object} [options] - { restraintType: 'pinned' | 'fixed', bucklingK: 1.0, characteristicLengthDef: 'min(planSpan, height)' }
 * @returns {object} Comprehensive FEA result
 */
export function solveSpaceFrame(topology, material, loadCase = {}, options = {}) {
  const vertices = topology.vertices || [];
  const edges = topology.edges || [];
  const anchors = topology.anchors || [];
  const nNodes = vertices.length;
  const nEdges = edges.length;
  const nDof = nNodes * 6;

  if (nNodes === 0 || nEdges === 0) {
    return {
      ok: false,
      error: `Empty topology (nodes=${nNodes}, edges=${nEdges})`,
      loadCaseId: loadCase.id || 'default',
    };
  }

  const E = Number(material.youngsModulusPa ?? 5.0e9);
  const nu = Number(material.poissonsRatio ?? 0.24);
  const G = E / (2 * (1 + nu));
  const rho = Number(material.densityKgM3 ?? 1250);
  const fc = Number(material.compressiveStrengthPa ?? 12.0e6);
  const ft = Number(material.tensileStrengthPa ?? 2.0e6);
  const fv = Number(material.shearStrengthPa ?? 1.5e6);

  const restraintType = options.restraintType || 'pinned';
  const bucklingK = Number(options.bucklingK ?? 1.0);
  const g = loadCase.gravityMS2 !== undefined ? Number(loadCase.gravityMS2) : 9.81;

  // Bounding box & characteristic length
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nNodes; i++) {
    const [x, y, z] = vertices[i];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const spanZ = maxZ - minZ;
  const planSpan = Math.max(spanX, spanY);
  let L_char;
  if (planSpan > 1e-6 && spanZ > 1e-6) {
    L_char = Math.min(planSpan, spanZ);
  } else {
    L_char = Math.max(planSpan, spanZ, 1e-6);
  }

  // Determine constrained DOFs
  const anchorSet = new Set(anchors);
  const isFixedDof = new Uint8Array(nDof);
  for (const aIdx of anchorSet) {
    if (aIdx < 0 || aIdx >= nNodes) {
      return {
        ok: false,
        error: `Anchor index ${aIdx} out of bounds (nNodes=${nNodes})`,
        loadCaseId: loadCase.id || 'default',
      };
    }
    const base = aIdx * 6;
    isFixedDof[base + 0] = 1; // ux
    isFixedDof[base + 1] = 1; // uy
    isFixedDof[base + 2] = 1; // uz
    if (restraintType === 'fixed') {
      isFixedDof[base + 3] = 1; // rx
      isFixedDof[base + 4] = 1; // ry
      isFixedDof[base + 5] = 1; // rz
    }
  }
  if (Array.isArray(options.additionalFixedDofs)) {
    for (const d of options.additionalFixedDofs) {
      if (d >= 0 && d < nDof) isFixedDof[d] = 1;
    }
  }

  // Map global DOF -> reduced free DOF index (-1 if fixed)
  const dofToFree = new Int32Array(nDof).fill(-1);
  const freeDofs = [];
  for (let d = 0; d < nDof; d++) {
    if (!isFixedDof[d]) {
      dofToFree[d] = freeDofs.length;
      freeDofs.push(d);
    }
  }
  const nFree = freeDofs.length;

  // Precompute element data, total volume/mass, and assemble K_ff + self-weight F_ext
  const elements = new Array(nEdges);
  const Kff = new Float64Array(nFree * nFree);
  const Fext = new Float64Array(nDof);

  let totalVolumeM3 = 0;
  let totalSelfWeightN = 0;

  for (let e = 0; e < nEdges; e++) {
    const [u, v] = edges[e];
    if (u < 0 || u >= nNodes || v < 0 || v >= nNodes) {
      return {
        ok: false,
        error: `Edge ${e} references out-of-bounds vertex [${u}, ${v}]`,
        loadCaseId: loadCase.id || 'default',
      };
    }
    const sec = resolveEdgeSection(topology, e);
    let triad;
    try {
      triad = computeMemberTriad(vertices[u], vertices[v]);
    } catch (err) {
      return {
        ok: false,
        error: `Edge ${e} (${u}-${v}): ${err.message}`,
        loadCaseId: loadCase.id || 'default',
      };
    }

    const kLocal = buildLocalStiffnessMatrix(E, G, sec.area, sec.I, sec.I, sec.J, triad.L);
    const kGlobal = transformStiffnessToGlobal(kLocal, triad.R);

    elements[e] = { u, v, sec, triad, kLocal, kGlobal };

    // Volume & self-weight (lumped half at each end, Z-down)
    const vol = sec.area * triad.L;
    totalVolumeM3 += vol;
    if (g !== 0) {
      const weightN = rho * vol * g;
      totalSelfWeightN += weightN;
      Fext[u * 6 + 2] -= 0.5 * weightN;
      Fext[v * 6 + 2] -= 0.5 * weightN;
    }

    // Assemble into K_ff
    const map = [
      u * 6 + 0, u * 6 + 1, u * 6 + 2, u * 6 + 3, u * 6 + 4, u * 6 + 5,
      v * 6 + 0, v * 6 + 1, v * 6 + 2, v * 6 + 3, v * 6 + 4, v * 6 + 5,
    ];
    for (let r = 0; r < 12; r++) {
      const fr = dofToFree[map[r]];
      if (fr === -1) continue;
      const frOff = fr * nFree;
      const krOff = r * 12;
      for (let c = 0; c < 12; c++) {
        const fcIdx = dofToFree[map[c]];
        if (fcIdx === -1) continue;
        Kff[frOff + fcIdx] += kGlobal[krOff + c];
      }
    }
  }

  const totalMassKg = totalVolumeM3 * rho;

  // Distributed vertical (and optional horizontal) load from loadCase
  let totalDistributedLoadN = 0;
  let totalHorizontalLoadN = 0;
  let loadedNodeIndices = [];
  const distForceN =
    loadCase.distributedVerticalForceN != null
      ? Number(loadCase.distributedVerticalForceN)
      : Number(loadCase.distributedVerticalMassKg || 0) * (g || 9.81);
  const horizVec = Array.isArray(loadCase.distributedHorizontalVecN) ? loadCase.distributedHorizontalVecN : null;
  const hasHoriz = horizVec && Math.hypot(horizVec[0] || 0, horizVec[1] || 0, horizVec[2] || 0) > 1e-12;

  if ((distForceN > 0 || hasHoriz) && loadCase.distribution !== 'none') {
    const distMode = loadCase.distribution || 'top_zone_nodes';
    if (distMode === 'top_zone_nodes') {
      const frac = Number(loadCase.topZoneFractionZ ?? 0.85);
      const zThresh = minZ + frac * spanZ - 1e-9;
      for (let i = 0; i < nNodes; i++) {
        if (!anchorSet.has(i) && vertices[i][2] >= zThresh) {
          loadedNodeIndices.push(i);
        }
      }
      // Fallback if all top nodes were anchors or threshold was strict
      if (loadedNodeIndices.length === 0) {
        let bestZ = -Infinity;
        for (let i = 0; i < nNodes; i++) {
          if (!anchorSet.has(i) && vertices[i][2] > bestZ) bestZ = vertices[i][2];
        }
        for (let i = 0; i < nNodes; i++) {
          if (!anchorSet.has(i) && vertices[i][2] >= bestZ - 1e-6) {
            loadedNodeIndices.push(i);
          }
        }
      }
    } else if (distMode === 'all_free_nodes') {
      for (let i = 0; i < nNodes; i++) {
        if (!anchorSet.has(i)) loadedNodeIndices.push(i);
      }
    } else if (distMode === 'all_nodes') {
      for (let i = 0; i < nNodes; i++) loadedNodeIndices.push(i);
    } else if (distMode === 'peak_nodes' || distMode === 'top_node' || distMode === 'apex_node') {
      for (let i = 0; i < nNodes; i++) {
        if (!anchorSet.has(i) && vertices[i][2] >= maxZ - 1e-5) {
          loadedNodeIndices.push(i);
        }
      }
    }

    if (loadedNodeIndices.length > 0) {
      if (distForceN > 0) {
        const fPerNode = distForceN / loadedNodeIndices.length;
        for (const idx of loadedNodeIndices) {
          Fext[idx * 6 + 2] -= fPerNode;
        }
        totalDistributedLoadN = distForceN;
      }
      if (hasHoriz) {
        const hx = Number(horizVec[0] || 0) / loadedNodeIndices.length;
        const hy = Number(horizVec[1] || 0) / loadedNodeIndices.length;
        const hz = Number(horizVec[2] || 0) / loadedNodeIndices.length;
        for (const idx of loadedNodeIndices) {
          Fext[idx * 6 + 0] += hx;
          Fext[idx * 6 + 1] += hy;
          Fext[idx * 6 + 2] += hz;
        }
        totalHorizontalLoadN = Math.hypot(horizVec[0] || 0, horizVec[1] || 0, horizVec[2] || 0);
      }
    }
  }

  // Explicit nodal point loads (useful for custom load cases and analytical verification)
  let totalNodalLoadVec = [0, 0, 0];
  if (Array.isArray(loadCase.nodalLoads)) {
    for (const nl of loadCase.nodalLoads) {
      const idx = nl.node;
      if (idx < 0 || idx >= nNodes) continue;
      const base = idx * 6;
      const fx = Number(nl.fx || 0);
      const fy = Number(nl.fy || 0);
      const fz = Number(nl.fz || 0);
      Fext[base + 0] += fx;
      Fext[base + 1] += fy;
      Fext[base + 2] += fz;
      Fext[base + 3] += Number(nl.mx || 0);
      Fext[base + 4] += Number(nl.my || 0);
      Fext[base + 5] += Number(nl.mz || 0);
      totalNodalLoadVec[0] += fx;
      totalNodalLoadVec[1] += fy;
      totalNodalLoadVec[2] += fz;
    }
  }

  // Extract RHS for free DOFs
  const rhs = new Float64Array(nFree);
  for (let i = 0; i < nFree; i++) {
    rhs[i] = Fext[freeDofs[i]];
  }

  // Solve K_ff * u_f = F_f
  const solved = solveLinearSystem(Kff, rhs, nFree);
  if (!solved.ok) {
    return {
      ok: false,
      isMechanism: true,
      error: solved.reason || 'Stiffness matrix is singular (mechanism or unstable structure)',
      minPivotRatio: solved.minPivotRatio,
      loadCaseId: loadCase.id || 'default',
      totalVolumeM3,
      totalMassKg,
    };
  }

  // Reconstruct full displacement vector u (nDof)
  const uFull = new Float64Array(nDof);
  for (let i = 0; i < nFree; i++) {
    uFull[freeDofs[i]] = solved.x[i];
  }

  // Post-process nodal displacements
  const nodalDisplacements = new Array(nNodes);
  let maxDispM = 0;
  let maxDispNode = -1;
  let maxDispZ = 0;
  let maxHorizontalDispM = 0;
  for (let i = 0; i < nNodes; i++) {
    const b = i * 6;
    const ux = uFull[b + 0];
    const uy = uFull[b + 1];
    const uz = uFull[b + 2];
    const rx = uFull[b + 3];
    const ry = uFull[b + 4];
    const rz = uFull[b + 5];
    const mag = Math.hypot(ux, uy, uz);
    const horizMag = Math.hypot(ux, uy);
    nodalDisplacements[i] = { node: i, ux, uy, uz, rx, ry, rz, mag };
    if (mag > maxDispM) {
      maxDispM = mag;
      maxDispNode = i;
    }
    if (horizMag > maxHorizontalDispM) {
      maxHorizontalDispM = horizMag;
    }
    if (Math.abs(uz) > Math.abs(maxDispZ)) {
      maxDispZ = uz;
    }
  }

  // Post-process member internal forces, stresses, buckling, and accumulate K*u for reactions
  const Ku = new Float64Array(nDof);
  const memberResults = new Array(nEdges);

  let maxTensileStressPa = 0;
  let worstTensileMember = -1;
  let maxCompressiveStressPa = 0;
  let worstCompressiveMember = -1;
  let maxShearStressPa = 0;
  let worstShearMember = -1;
  let minBucklingSF = Infinity;
  let worstBucklingMember = -1;
  let compressedMemberCount = 0;
  let sumBendingRatio = 0;
  let loadedMemberCount = 0;

  for (let e = 0; e < nEdges; e++) {
    const el = elements[e];
    const { u, v, sec, triad, kLocal } = el;
    const uElemGlobal = new Float64Array(12);
    for (let j = 0; j < 6; j++) {
      uElemGlobal[j] = uFull[u * 6 + j];
      uElemGlobal[6 + j] = uFull[v * 6 + j];
    }

    const uElemLocal = transformVecGlobalToLocal(uElemGlobal, triad.R);

    // fLocal = kLocal * uElemLocal
    const fLocal = new Float64Array(12);
    for (let r = 0; r < 12; r++) {
      const rOff = r * 12;
      let sum = 0;
      for (let c = 0; c < 12; c++) {
        sum += kLocal[rOff + c] * uElemLocal[c];
      }
      fLocal[r] = sum;
    }

    // fGlobal = T^T * fLocal -> accumulate into Ku
    const fGlobal = transformVecLocalToGlobal(fLocal, triad.R);
    for (let j = 0; j < 6; j++) {
      Ku[u * 6 + j] += fGlobal[j];
      Ku[v * 6 + j] += fGlobal[6 + j];
    }

    // Internal forces:
    // Axial N > 0 is tension, N < 0 is compression
    const N = 0.5 * (fLocal[6] - fLocal[0]);
    const Vy = -fLocal[1];
    const Vz = -fLocal[2];
    const Vmag = Math.hypot(Vy, Vz);
    const T = 0.5 * (fLocal[9] - fLocal[3]);

    const My1 = -fLocal[4], Mz1 = -fLocal[5];
    const My2 = fLocal[10], Mz2 = fLocal[11];
    const M1 = Math.hypot(My1, Mz1);
    const M2 = Math.hypot(My2, Mz2);
    const Mmax = Math.max(M1, M2);

    // Combined extreme fiber stresses
    const sigmaAxial = N / sec.area;
    const sigmaBend = (Mmax * sec.rOuter) / sec.I;
    const sigmaTensileMax = Math.max(0, sigmaAxial + sigmaBend);
    const sigmaCompressiveMax = Math.max(0, -sigmaAxial + sigmaBend);
    const stressMagSum = Math.abs(sigmaAxial) + Math.abs(sigmaBend);
    if (stressMagSum > 1e-6) {
      sumBendingRatio += Math.abs(sigmaBend) / (stressMagSum + 1e-9);
      loadedMemberCount++;
    }

    // Shear stress: torsion + transverse shear
    const tauTorsion = (Math.abs(T) * sec.rOuter) / sec.J;
    const shearCoeff = sec.isHollow ? 2.0 : 4.0 / 3.0;
    const tauTransverse = (shearCoeff * Vmag) / sec.area;
    const tauMax = tauTorsion + tauTransverse;

    // Member safety factors
    const sfTension = sigmaTensileMax > 1e-12 ? ft / sigmaTensileMax : Infinity;
    const sfCompression = sigmaCompressiveMax > 1e-12 ? fc / sigmaCompressiveMax : Infinity;
    const sfShear = tauMax > 1e-12 ? fv / tauMax : Infinity;

    // Euler buckling check for compressed members (N < 0)
    const Pcr = (Math.PI * Math.PI * E * sec.I) / (bucklingK * triad.L * bucklingK * triad.L);
    let sfBuckling = Infinity;
    if (N < -1e-12) {
      compressedMemberCount++;
      sfBuckling = Pcr / Math.abs(N);
      if (sfBuckling < minBucklingSF) {
        minBucklingSF = sfBuckling;
        worstBucklingMember = e;
      }
    }

    if (sigmaTensileMax > maxTensileStressPa) {
      maxTensileStressPa = sigmaTensileMax;
      worstTensileMember = e;
    }
    if (sigmaCompressiveMax > maxCompressiveStressPa) {
      maxCompressiveStressPa = sigmaCompressiveMax;
      worstCompressiveMember = e;
    }
    if (tauMax > maxShearStressPa) {
      maxShearStressPa = tauMax;
      worstShearMember = e;
    }

    memberResults[e] = {
      edgeIndex: e,
      u,
      v,
      lengthM: triad.L,
      rOuterM: sec.rOuter,
      rInnerM: sec.rInner,
      areaM2: sec.area,
      N,
      Vy,
      Vz,
      Vmag,
      T,
      My1,
      Mz1,
      My2,
      Mz2,
      Mmax,
      sigmaAxialPa: sigmaAxial,
      sigmaBendPa: sigmaBend,
      sigmaTensileMaxPa: sigmaTensileMax,
      sigmaCompressiveMaxPa: sigmaCompressiveMax,
      tauMaxPa: tauMax,
      PcrN: Pcr,
      sfTension,
      sfCompression,
      sfShear,
      sfBuckling,
    };
  }

  // Reactions at constrained DOFs: R = Ku - Fext
  const reactions = [];
  let sumRx = 0, sumRy = 0, sumRz = 0;
  for (const aIdx of anchorSet) {
    const b = aIdx * 6;
    const rx = isFixedDof[b + 0] ? Ku[b + 0] - Fext[b + 0] : 0;
    const ry = isFixedDof[b + 1] ? Ku[b + 1] - Fext[b + 1] : 0;
    const rz = isFixedDof[b + 2] ? Ku[b + 2] - Fext[b + 2] : 0;
    const mx = isFixedDof[b + 3] ? Ku[b + 3] - Fext[b + 3] : 0;
    const my = isFixedDof[b + 4] ? Ku[b + 4] - Fext[b + 4] : 0;
    const mz = isFixedDof[b + 5] ? Ku[b + 5] - Fext[b + 5] : 0;
    sumRx += rx;
    sumRy += ry;
    sumRz += rz;
    reactions.push({ node: aIdx, fx: rx, fy: ry, fz: rz, mx, my, mz });
  }

  // Global force equilibrium check: |sum(R) + sum(F_ext)| / |sum(F_ext)|
  let sumFx = 0, sumFy = 0, sumFz = 0;
  let sumAbsF = 0;
  for (let i = 0; i < nNodes; i++) {
    const b = i * 6;
    sumFx += Fext[b + 0];
    sumFy += Fext[b + 1];
    sumFz += Fext[b + 2];
    sumAbsF += Math.abs(Fext[b + 0]) + Math.abs(Fext[b + 1]) + Math.abs(Fext[b + 2]);
  }
  const forceImbalance = Math.hypot(sumRx + sumFx, sumRy + sumFy, sumRz + sumFz);
  const netExternalForceMag = Math.hypot(sumFx, sumFy, sumFz);
  const denom = netExternalForceMag > 1e-12 ? netExternalForceMag : Math.max(sumAbsF, 1e-12);
  const equilibriumResidual = forceImbalance / denom;

  // Free-DOF internal residual check: max |Ku_free - F_free| / max(|F_ext|, 1)
  let maxFreeRes = 0;
  for (let i = 0; i < nFree; i++) {
    const d = freeDofs[i];
    const r = Math.abs(Ku[d] - Fext[d]);
    if (r > maxFreeRes) maxFreeRes = r;
  }
  const freeDofResidual = maxFreeRes / Math.max(sumAbsF, 1.0);

  const sfTension = maxTensileStressPa > 1e-12 ? ft / maxTensileStressPa : Infinity;
  const sfCompression = maxCompressiveStressPa > 1e-12 ? fc / maxCompressiveStressPa : Infinity;
  const sfShear = maxShearStressPa > 1e-12 ? fv / maxShearStressPa : Infinity;

  const funicularEfficiency = loadedMemberCount > 0 ? 1 - sumBendingRatio / loadedMemberCount : 1.0;
  const compressionDominance = nEdges > 0 ? compressedMemberCount / nEdges : 0;
  const imposedLoadKg = g > 1e-9 ? totalDistributedLoadN / g : Number(loadCase.distributedVerticalMassKg || 0);
  const loadToMassRatio = totalMassKg > 1e-9 ? imposedLoadKg / totalMassKg : 0;

  return {
    ok: true,
    isMechanism: false,
    loadCaseId: loadCase.id || 'default',
    loadCaseName: loadCase.name || loadCase.id || 'Default Load Case',
    restraintType,
    minPivotRatio: solved.minPivotRatio,
    geometry: {
      nNodes,
      nEdges,
      nAnchors: anchorSet.size,
      nFreeDofs: nFree,
      spanX,
      spanY,
      spanZ,
      planSpan,
      characteristicLengthM: L_char,
      totalVolumeM3,
      totalMassKg,
      centerlineMassKg: totalMassKg,
    },
    loads: {
      gravityMS2: g,
      totalSelfWeightN,
      totalDistributedLoadN,
      totalHorizontalLoadN,
      loadedNodeCount: loadedNodeIndices.length,
      netExternalForceN: [sumFx, sumFy, sumFz],
    },
    displacements: {
      maxDispM,
      maxDispNode,
      maxDispZM: maxDispZ,
      maxHorizontalDispM,
      deflectionRatio: maxDispM / L_char,
      heightDeflectionRatio: spanZ > 1e-6 ? maxDispM / spanZ : 0,
      nodal: nodalDisplacements,
    },
    stresses: {
      maxTensileStressPa,
      worstTensileMember,
      maxCompressiveStressPa,
      worstCompressiveMember,
      maxShearStressPa,
      worstShearMember,
    },
    safetyFactors: {
      tension: sfTension,
      compression: sfCompression,
      shear: sfShear,
      buckling: minBucklingSF,
      worstBucklingMember,
      compressedMemberCount,
    },
    kpis: {
      funicularEfficiency,
      compressionDominance,
      imposedLoadKg,
      loadToMassRatio,
    },
    reactions: {
      sumReactionN: [sumRx, sumRy, sumRz],
      equilibriumResidual,
      freeDofResidual,
      perAnchor: reactions,
    },
    members: memberResults,
  };
}

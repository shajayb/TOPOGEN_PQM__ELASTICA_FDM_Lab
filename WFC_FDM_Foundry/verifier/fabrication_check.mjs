/**
 * Independent Topology, PQ Mesh & Unrolled Pattern Fabrication Verifier
 * Domain: WFC_FDM_Foundry/verifier (strictly air-gapped, zero external dependencies)
 */

import { resolveEdgeSection } from './fea_solver.mjs';

/**
 * Compute minimum angle (degrees) between any two edges sharing a node.
 * Useful for cast plaster moldability and joint clearance checks.
 */
export function computeMinIncidentAngle(vertices, edges) {
  const nNodes = vertices.length;
  const incident = Array.from({ length: nNodes }, () => []);
  for (let e = 0; e < edges.length; e++) {
    const [u, v] = edges[e];
    if (u < 0 || u >= nNodes || v < 0 || v >= nNodes || u === v) continue;
    const p1 = vertices[u];
    const p2 = vertices[v];
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    const dz = p2[2] - p1[2];
    const L = Math.hypot(dx, dy, dz);
    if (L <= 1e-12) continue;
    incident[u].push({ edge: e, dir: [dx / L, dy / L, dz / L] });
    incident[v].push({ edge: e, dir: [-dx / L, -dy / L, -dz / L] });
  }

  let minAngleDeg = Infinity;
  let minAngleNode = -1;
  let minAngleEdges = null;

  for (let n = 0; n < nNodes; n++) {
    const inc = incident[n];
    for (let i = 0; i < inc.length; i++) {
      const a = inc[i].dir;
      for (let j = i + 1; j < inc.length; j++) {
        const b = inc[j].dir;
        const dot = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
        const deg = (Math.acos(dot) * 180) / Math.PI;
        if (deg < minAngleDeg) {
          minAngleDeg = deg;
          minAngleNode = n;
          minAngleEdges = [inc[i].edge, inc[j].edge];
        }
      }
    }
  }

  return {
    minIncidentAngleDeg: minAngleDeg === Infinity ? null : minAngleDeg,
    minIncidentAngleNode: minAngleNode,
    minIncidentAngleEdges: minAngleEdges,
  };
}

/**
 * Check graph connectivity via BFS.
 * @param {number} nNodes
 * @param {Array<[number, number]>} edges
 * @returns {{ componentCount: number, isSingleComponent: boolean, isolatedNodes: number[], largestComponentSize: number }}
 */
export function checkGraphConnectivity(nNodes, edges) {
  if (nNodes === 0) {
    return { componentCount: 0, isSingleComponent: false, isolatedNodes: [], largestComponentSize: 0 };
  }
  const adj = Array.from({ length: nNodes }, () => []);
  for (const [u, v] of edges) {
    if (u >= 0 && u < nNodes && v >= 0 && v < nNodes && u !== v) {
      adj[u].push(v);
      adj[v].push(u);
    }
  }

  const visited = new Uint8Array(nNodes);
  const isolatedNodes = [];
  let componentCount = 0;
  let largestComponentSize = 0;

  for (let i = 0; i < nNodes; i++) {
    if (adj[i].length === 0) isolatedNodes.push(i);
    if (visited[i]) continue;
    componentCount++;
    const queue = [i];
    visited[i] = 1;
    let size = 0;
    let head = 0;
    while (head < queue.length) {
      const curr = queue[head++];
      size++;
      const neighbors = adj[curr];
      for (let j = 0; j < neighbors.length; j++) {
        const nb = neighbors[j];
        if (!visited[nb]) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    if (size > largestComponentSize) largestComponentSize = size;
  }

  return {
    componentCount,
    isSingleComponent: componentCount === 1,
    isolatedNodes,
    largestComponentSize,
  };
}

/**
 * Compute exact minimax vertex-to-plane distance (in meters) for a 3D quad face (v0, v1, v2, v3):
 *   err = 0.25 * |(v0 - v1 + v2 - v3) . normalize((v2 - v0) x (v3 - v1))|
 * Falls back to best-fit triangle normal if diagonals are degenerate.
 */
export function computeQuadPlanarityError(v0, v1, v2, v3) {
  const d1x = v2[0] - v0[0];
  const d1y = v2[1] - v0[1];
  const d1z = v2[2] - v0[2];
  const d2x = v3[0] - v1[0];
  const d2y = v3[1] - v1[1];
  const d2z = v3[2] - v1[2];

  let nx = d1y * d2z - d1z * d2y;
  let ny = d1z * d2x - d1x * d2z;
  let nz = d1x * d2y - d1y * d2x;
  let nLen = Math.hypot(nx, ny, nz);

  if (nLen > 1e-15) {
    nx /= nLen;
    ny /= nLen;
    nz /= nLen;
    const altX = v0[0] - v1[0] + v2[0] - v3[0];
    const altY = v0[1] - v1[1] + v2[1] - v3[1];
    const altZ = v0[2] - v1[2] + v2[2] - v3[2];
    return 0.25 * Math.abs(altX * nx + altY * ny + altZ * nz);
  }

  // Fallback for degenerate diagonals: best-fit corner triangle normal
  const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
  const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
  nx = e1y * e2z - e1z * e2y;
  ny = e1z * e2x - e1x * e2z;
  nz = e1x * e2y - e1y * e2x;
  nLen = Math.hypot(nx, ny, nz);

  if (nLen <= 1e-15) {
    const f1x = v2[0] - v1[0], f1y = v2[1] - v1[1], f1z = v2[2] - v1[2];
    const f2x = v3[0] - v1[0], f2y = v3[1] - v1[1], f2z = v3[2] - v1[2];
    nx = f1y * f2z - f1z * f2y;
    ny = f1z * f2x - f1x * f2z;
    nz = f1x * f2y - f1y * f2x;
    nLen = Math.hypot(nx, ny, nz);
  }
  if (nLen <= 1e-15) return 0.0;

  nx /= nLen;
  ny /= nLen;
  nz /= nLen;
  const cx = 0.25 * (v0[0] + v1[0] + v2[0] + v3[0]);
  const cy = 0.25 * (v0[1] + v1[1] + v2[1] + v3[1]);
  const cz = 0.25 * (v0[2] + v1[2] + v2[2] + v3[2]);
  const verts = [v0, v1, v2, v3];
  let maxDist = 0;
  for (let i = 0; i < 4; i++) {
    const p = verts[i];
    const dist = Math.abs((p[0] - cx) * nx + (p[1] - cy) * ny + (p[2] - cz) * nz);
    if (dist > maxDist) maxDist = dist;
  }
  return maxDist;
}

/**
 * Independent Wavefront .OBJ parser, watertight manifold checker, and Planar-Quad (PQ) auditor.
 * Supports tris, quads, and n-gons; handles v, v/vt, v//vn, v/vt/vn, and negative indices.
 *
 * @param {string} objText
 * @param {object} [options] - Optional { maxQuadPlanarityErrorM }
 * @returns {object} Mesh metrics, PQ planarity stats, and watertight manifold verdict
 */
export function verifyObjMesh(objText, options = {}) {
  const vertices = [];
  const faces = [];

  const lines = objText.split(/\r?\n/);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('v ')) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4) {
        const x = Number(parts[1]);
        const y = Number(parts[2]);
        const z = Number(parts[3]);
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
          vertices.push([x, y, z]);
        }
      }
    } else if (line.startsWith('f ')) {
      const parts = line.split(/\s+/).slice(1);
      if (parts.length < 3) continue;
      const faceIdx = [];
      for (let p = 0; p < parts.length; p++) {
        const token = parts[p].split('/')[0];
        let idx = parseInt(token, 10);
        if (!Number.isInteger(idx)) continue;
        if (idx < 0) {
          idx = vertices.length + idx;
        } else {
          idx = idx - 1;
        }
        if (idx >= 0 && idx < vertices.length) {
          faceIdx.push(idx);
        }
      }
      if (faceIdx.length >= 3) {
        faces.push(faceIdx);
      }
    }
  }

  let triCount = 0;
  let quadCount = 0;
  let ngonCount = 0;

  // Directed half-edge map: "a,b" -> count
  const directedEdges = new Map();
  // Undirected edge map: "min,max" -> { count, forward, backward }
  const undirectedEdges = new Map();

  let signedVolume6 = 0;
  let degenerateFaces = 0;

  // Planar-Quad (PQ) deviation tracking
  const planarityLimit = options.maxQuadPlanarityErrorM != null ? Number(options.maxQuadPlanarityErrorM) : null;
  let maxQuadPlanarityErrorM = 0;
  let sumQuadPlanarityErrorM = 0;
  let worstPlanarityQuadFace = -1;
  let warpedQuadCount = 0;
  const warpedQuads = [];

  // Bounding box
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const [x, y, z] = vertices[i];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  for (let f = 0; f < faces.length; f++) {
    const face = faces[f];
    const m = face.length;
    if (m === 3) {
      triCount++;
    } else if (m === 4) {
      quadCount++;
      const err = computeQuadPlanarityError(
        vertices[face[0]],
        vertices[face[1]],
        vertices[face[2]],
        vertices[face[3]]
      );
      sumQuadPlanarityErrorM += err;
      if (err > maxQuadPlanarityErrorM) {
        maxQuadPlanarityErrorM = err;
        worstPlanarityQuadFace = f;
      }
      if (planarityLimit != null && err > planarityLimit + 1e-12) {
        warpedQuadCount++;
        if (warpedQuads.length < 10) {
          warpedQuads.push({ faceIndex: f, vertices: face, errorM: err });
        }
      }
    } else {
      ngonCount++;
    }

    // Record directed & undirected edges
    let hasDegenerateEdge = false;
    for (let i = 0; i < m; i++) {
      const a = face[i];
      const b = face[(i + 1) % m];
      if (a === b) {
        hasDegenerateEdge = true;
        continue;
      }
      const dKey = `${a},${b}`;
      directedEdges.set(dKey, (directedEdges.get(dKey) || 0) + 1);

      const uKey = a < b ? `${a},${b}` : `${b},${a}`;
      let entry = undirectedEdges.get(uKey);
      if (!entry) {
        entry = { count: 0, forward: 0, backward: 0 };
        undirectedEdges.set(uKey, entry);
      }
      entry.count++;
      if (a < b) entry.forward++;
      else entry.backward++;
    }
    if (hasDegenerateEdge) degenerateFaces++;

    // Signed volume via fan triangulation around origin: sum v0 . (v1 x v2) / 6
    const v0 = vertices[face[0]];
    for (let i = 1; i < m - 1; i++) {
      const v1 = vertices[face[i]];
      const v2 = vertices[face[i + 1]];
      const cx = v1[1] * v2[2] - v1[2] * v2[1];
      const cy = v1[2] * v2[0] - v1[0] * v2[2];
      const cz = v1[0] * v2[1] - v1[1] * v2[0];
      signedVolume6 += v0[0] * cx + v0[1] * cy + v0[2] * cz;
    }
  }

  const signedVolume = signedVolume6 / 6.0;

  let boundaryEdges = 0;
  let nonManifoldEdges = 0;
  let inconsistentOrientationEdges = 0;
  let matchedTwinEdges = 0;

  for (const entry of undirectedEdges.values()) {
    if (entry.count === 1) {
      boundaryEdges++;
    } else if (entry.count === 2) {
      if (entry.forward === 1 && entry.backward === 1) {
        matchedTwinEdges++;
      } else {
        inconsistentOrientationEdges++;
      }
    } else {
      nonManifoldEdges++;
    }
  }

  const isClosed = faces.length > 0 && boundaryEdges === 0;
  const isManifold = faces.length > 0 && nonManifoldEdges === 0 && inconsistentOrientationEdges === 0;
  const hasPositiveVolume = signedVolume > 1e-12;
  const isWatertightManifold = isClosed && isManifold && hasPositiveVolume && degenerateFaces === 0;
  const meanQuadPlanarityErrorM = quadCount > 0 ? sumQuadPlanarityErrorM / quadCount : 0;

  return {
    vertexCount: vertices.length,
    faceCount: faces.length,
    triCount,
    quadCount,
    ngonCount,
    undirectedEdgeCount: undirectedEdges.size,
    matchedTwinEdges,
    boundaryEdges,
    nonManifoldEdges,
    inconsistentOrientationEdges,
    degenerateFaces,
    signedVolumeM3: signedVolume,
    maxQuadPlanarityErrorM: quadCount > 0 ? maxQuadPlanarityErrorM : 0,
    meanQuadPlanarityErrorM,
    worstPlanarityQuadFace,
    warpedQuadCount,
    warpedQuads,
    boundingBox: vertices.length > 0
      ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], span: [maxX - minX, maxY - minY, maxZ - minZ] }
      : null,
    isClosed,
    isManifold,
    hasPositiveVolume,
    isWatertightManifold,
  };
}

function cross2D(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function dist2D(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function onSegmentProj2D(a, b, p, tol) {
  return (
    p[0] >= Math.min(a[0], b[0]) - tol &&
    p[0] <= Math.max(a[0], b[0]) + tol &&
    p[1] >= Math.min(a[1], b[1]) - tol &&
    p[1] <= Math.max(a[1], b[1]) + tol
  );
}

/**
 * Closed 2D segment-segment intersection check for strictly non-shared segments.
 */
function nonSharedSegmentsIntersect2D(a, b, c, d, tol) {
  if (
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - tol ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - tol ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - tol ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - tol
  ) {
    return false;
  }

  const lenAB = Math.max(dist2D(a, b), 1e-15);
  const lenCD = Math.max(dist2D(c, d), 1e-15);

  const d1 = cross2D(a, b, c) / lenAB;
  const d2 = cross2D(a, b, d) / lenAB;
  const d3 = cross2D(c, d, a) / lenCD;
  const d4 = cross2D(c, d, b) / lenCD;

  if (((d1 > tol && d2 < -tol) || (d1 < -tol && d2 > tol)) &&
      ((d3 > tol && d4 < -tol) || (d3 < -tol && d4 > tol))) {
    return true;
  }

  if (Math.abs(d1) <= tol && onSegmentProj2D(a, b, c, tol)) return true;
  if (Math.abs(d2) <= tol && onSegmentProj2D(a, b, d, tol)) return true;
  if (Math.abs(d3) <= tol && onSegmentProj2D(c, d, a, tol)) return true;
  if (Math.abs(d4) <= tol && onSegmentProj2D(c, d, b, tol)) return true;

  return false;
}

function pointStrictlyInsideConvexQuad2D(p, q, tol) {
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i];
    const b = q[(i + 1) % 4];
    const len = Math.max(dist2D(a, b), 1e-15);
    const sd = cross2D(a, b, p) / len;
    if (sd > tol) pos++;
    else if (sd < -tol) neg++;
    else return false; // on boundary
  }
  return pos === 4 || neg === 4;
}

/**
 * Independently verify 2D per-bar unrolled fabrication patterns (.patterns.svg + .unrolled.json).
 */
export function verifyUnrolledPatterns(unrolledData, svgText, topology, brief) {
  const nEdges = (topology.edges || []).length;
  const minSubdiv = Number(brief.geometry?.minLongitudinalSubdivLevels ?? 0);
  const defaultNSides = Number(topology.section?.nSides ?? 8);
  const allowSelfIntersect = brief.fabrication?.allowUnrollSelfIntersection === true;

  // 1. Audit .patterns.svg
  const svgProvided = typeof svgText === 'string' && svgText.trim().length > 0;
  const hasSvgRoot = svgProvided && /<svg\b[\s\S]*<\/svg>/i.test(svgText);
  const hasSvgGeometry = svgProvided && /<(path|polygon|polyline|line|rect)\b/i.test(svgText);
  const gTagMatches = svgProvided ? (svgText.match(/<g\b[^>]*>/gi) || []) : [];
  const svgGroupCount = gTagMatches.length;

  let explicitBarGroupPatternDetected = false;
  for (const tag of gTagMatches) {
    if (/(?:id|data-bar|data-edge)=["'](?:bar[-_]?|edge[-_]?)?\d+["']/i.test(tag)) {
      explicitBarGroupPatternDetected = true;
      break;
    }
  }
  let svgCoveredBars = 0;
  if (explicitBarGroupPatternDetected) {
    const joinedTags = gTagMatches.join('\n');
    for (let e = 0; e < nEdges; e++) {
      const re = new RegExp(`(?:id|data-bar|data-edge)=["'](?:bar[-_]?|edge[-_]?)?${e}["']`, 'i');
      if (re.test(joinedTags)) svgCoveredBars++;
    }
  } else {
    svgCoveredBars = Math.min(svgGroupCount, nEdges);
  }
  const svgValid =
    svgProvided &&
    hasSvgRoot &&
    hasSvgGeometry &&
    svgGroupCount >= nEdges &&
    svgCoveredBars === nEdges;

  // 2. Audit .unrolled.json
  const jsonProvided = unrolledData != null && typeof unrolledData === 'object';
  if (!jsonProvided) {
    return {
      passed: false,
      svgProvided,
      svgValid,
      svgGroupCount,
      svgCoveredBars,
      jsonProvided: false,
      expectedBarCount: nEdges,
      unrolledBarCount: 0,
      totalUnrolledSurfaceAreaM2: null,
      note: 'Missing .unrolled.json companion data file.',
    };
  }

  const unitScale =
    unrolledData.units === 'mm' || unrolledData.units === 'millimeters' ? 1e-3 : 1.0;
  const areaScale = unitScale * unitScale;

  const bars = Array.isArray(unrolledData.bars) ? unrolledData.bars : [];
  const barCountMatches =
    bars.length === nEdges &&
    (unrolledData.barCount == null || Number(unrolledData.barCount) === nEdges);

  const seenEdgeIndices = new Set();
  for (let i = 0; i < bars.length; i++) {
    const ei = bars[i]?.edgeIndex;
    if (Number.isInteger(ei) && ei >= 0 && ei < nEdges) {
      seenEdgeIndices.add(ei);
    }
  }
  const edgeCoverageOk =
    bars.length === nEdges &&
    (seenEdgeIndices.size === nEdges || bars.every((b) => b?.edgeIndex == null));

  let verifiedTotalAreaM2 = 0;
  let totalQuad2DCount = 0;
  const underSubdividedBars = [];
  const nonConvexOrDegenerateQuads = [];
  const selfIntersectingBars = [];
  const invalidBboxBars = [];
  const barBboxes = [];

  for (let bi = 0; bi < bars.length; bi++) {
    const bar = bars[bi] || {};
    const barId = Number.isInteger(bar.edgeIndex) ? bar.edgeIndex : bi;
    const reqNSides =
      topology.section?.nSides != null
        ? Number(topology.section.nSides)
        : Number(bar.nSides ?? defaultNSides);
    const minQuadsForBar = (minSubdiv + 1) * Math.max(3, reqNSides);
    const quads = Array.isArray(bar.quads2D) ? bar.quads2D : [];
    totalQuad2DCount += quads.length;

    if (quads.length < minQuadsForBar) {
      underSubdividedBars.push({
        edgeIndex: barId,
        quadCount: quads.length,
        requiredMinQuads: minQuadsForBar,
      });
    }

    const parsedQuads = [];
    let minEdgeLenRaw = Infinity;
    let stripOrientationSign = 0;
    let hasWindingFlipInBar = false;

    for (let qi = 0; qi < quads.length; qi++) {
      const q = quads[qi];
      if (
        !Array.isArray(q) ||
        q.length !== 4 ||
        !q.every((pt) => Array.isArray(pt) && pt.length >= 2 && Number.isFinite(Number(pt[0])) && Number.isFinite(Number(pt[1])))
      ) {
        nonConvexOrDegenerateQuads.push({ edgeIndex: barId, quadIndex: qi, reason: 'invalid_vertices' });
        continue;
      }

      const pts = [
        [Number(q[0][0]), Number(q[0][1])],
        [Number(q[1][0]), Number(q[1][1])],
        [Number(q[2][0]), Number(q[2][1])],
        [Number(q[3][0]), Number(q[3][1])],
      ];

      let degenerateEdge = false;
      for (let k = 0; k < 4; k++) {
        const elen = dist2D(pts[k], pts[(k + 1) % 4]);
        if (elen < minEdgeLenRaw) minEdgeLenRaw = elen;
        if (elen * unitScale <= 1e-9) degenerateEdge = true;
      }

      const sArea2 =
        (pts[0][0] * pts[1][1] - pts[0][1] * pts[1][0]) +
        (pts[1][0] * pts[2][1] - pts[1][1] * pts[2][0]) +
        (pts[2][0] * pts[3][1] - pts[2][1] * pts[3][0]) +
        (pts[3][0] * pts[0][1] - pts[3][1] * pts[0][0]);
      const areaRaw = 0.5 * Math.abs(sArea2);
      const areaM2 = areaRaw * areaScale;

      const z0 = cross2D(pts[0], pts[1], pts[2]);
      const z1 = cross2D(pts[1], pts[2], pts[3]);
      const z2 = cross2D(pts[2], pts[3], pts[0]);
      const z3 = cross2D(pts[3], pts[0], pts[1]);
      const turnTol = 1e-12 * Math.max(areaRaw, 1e-12);
      const allCCW = z0 > turnTol && z1 > turnTol && z2 > turnTol && z3 > turnTol;
      const allCW = z0 < -turnTol && z1 < -turnTol && z2 < -turnTol && z3 < -turnTol;
      const isConvex = !degenerateEdge && areaM2 > 1e-11 && (allCCW || allCW);

      if (!isConvex) {
        nonConvexOrDegenerateQuads.push({
          edgeIndex: barId,
          quadIndex: qi,
          areaM2,
          reason: areaM2 <= 1e-11 ? 'non_positive_area' : 'non_convex_or_degenerate',
        });
        continue;
      }

      const sign = sArea2 > 0 ? 1 : -1;
      if (stripOrientationSign === 0) stripOrientationSign = sign;
      else if (stripOrientationSign !== sign) hasWindingFlipInBar = true;

      verifiedTotalAreaM2 += areaM2;

      const qMinX = Math.min(pts[0][0], pts[1][0], pts[2][0], pts[3][0]);
      const qMaxX = Math.max(pts[0][0], pts[1][0], pts[2][0], pts[3][0]);
      const qMinY = Math.min(pts[0][1], pts[1][1], pts[2][1], pts[3][1]);
      const qMaxY = Math.max(pts[0][1], pts[1][1], pts[2][1], pts[3][1]);
      const centroid = [
        0.25 * (pts[0][0] + pts[1][0] + pts[2][0] + pts[3][0]),
        0.25 * (pts[0][1] + pts[1][1] + pts[2][1] + pts[3][1]),
      ];

      parsedQuads.push({ qi, pts, qMinX, qMaxX, qMinY, qMaxY, centroid });
    }

    // Check 2D self-intersection within this bar's unrolled strip
    if (!allowSelfIntersect && parsedQuads.length > 1) {
      const vTol = Math.min(1e-5 / unitScale, 0.05 * Math.max(minEdgeLenRaw, 1e-9));
      const segTol = Math.min(1e-7 / unitScale, 0.005 * Math.max(minEdgeLenRaw, 1e-9));
      let intersectionFound = hasWindingFlipInBar ? { reason: 'folded_winding_reversal' } : null;

      for (let i = 0; i < parsedQuads.length && !intersectionFound; i++) {
        const qa = parsedQuads[i];
        for (let j = i + 1; j < parsedQuads.length && !intersectionFound; j++) {
          const qb = parsedQuads[j];
          if (
            qa.qMaxX < qb.qMinX - vTol ||
            qb.qMaxX < qa.qMinX - vTol ||
            qa.qMaxY < qb.qMinY - vTol ||
            qb.qMaxY < qa.qMinY - vTol
          ) {
            continue;
          }

          if (
            pointStrictlyInsideConvexQuad2D(qa.centroid, qb.pts, segTol) ||
            pointStrictlyInsideConvexQuad2D(qb.centroid, qa.pts, segTol)
          ) {
            intersectionFound = { quadA: qa.qi, quadB: qb.qi, reason: 'overlapping_quad_interior' };
            break;
          }

          for (let ea = 0; ea < 4 && !intersectionFound; ea++) {
            const a = qa.pts[ea];
            const b = qa.pts[(ea + 1) % 4];
            for (let eb = 0; eb < 4 && !intersectionFound; eb++) {
              const c = qb.pts[eb];
              const d = qb.pts[(eb + 1) % 4];

              const ac = dist2D(a, c) <= vTol;
              const ad = dist2D(a, d) <= vTol;
              const bc = dist2D(b, c) <= vTol;
              const bd = dist2D(b, d) <= vTol;

              if ((ac && bd) || (ad && bc)) {
                // Shared fold edge: centroids must lie on strictly opposite sides of shared line
                const s1 = cross2D(a, b, qa.centroid);
                const s2 = cross2D(a, b, qb.centroid);
                if (s1 * s2 >= -1e-20) {
                  intersectionFound = { quadA: qa.qi, quadB: qb.qi, reason: 'folded_back_shared_edge' };
                }
              } else if (ac || ad || bc || bd) {
                // Single shared corner vertex: ensure rays do not colinearly overlap
                let p, u, v;
                if (ac) { p = a; u = b; v = d; }
                else if (ad) { p = a; u = b; v = c; }
                else if (bc) { p = b; u = a; v = d; }
                else { p = b; u = a; v = c; }
                const ux = u[0] - p[0], uy = u[1] - p[1];
                const vx = v[0] - p[0], vy = v[1] - p[1];
                const uLen = Math.hypot(ux, uy);
                const vLen = Math.hypot(vx, vy);
                if (uLen > 1e-12 && vLen > 1e-12) {
                  const dot = ux * vx + uy * vy;
                  const cr = Math.abs(ux * vy - uy * vx);
                  if (dot > 0 && cr <= 1e-6 * uLen * vLen) {
                    intersectionFound = { quadA: qa.qi, quadB: qb.qi, reason: 'collinear_shared_vertex_overlap' };
                  }
                }
              } else {
                // Zero shared vertices: check strict/closed non-shared segment intersection
                if (nonSharedSegmentsIntersect2D(a, b, c, d, segTol)) {
                  intersectionFound = { quadA: qa.qi, quadB: qb.qi, edgeA: ea, edgeB: eb, reason: 'non_shared_edge_crossing' };
                }
              }
            }
          }
        }
      }

      if (intersectionFound) {
        selfIntersectingBars.push({ edgeIndex: barId, ...intersectionFound });
      }
    }

    // Validate bar's 2D sheet layout bbox2D
    const bb = bar.bbox2D;
    if (
      !Array.isArray(bb) ||
      bb.length !== 4 ||
      !bb.every((v) => Number.isFinite(Number(v))) ||
      Number(bb[2]) <= Number(bb[0]) + 1e-9 ||
      Number(bb[3]) <= Number(bb[1]) + 1e-9
    ) {
      invalidBboxBars.push({ edgeIndex: barId, bbox2D: bb ?? null });
    } else {
      barBboxes.push({
        edgeIndex: barId,
        bbox: [Number(bb[0]), Number(bb[1]), Number(bb[2]), Number(bb[3])],
      });
    }
  }

  // Pairwise sheet layout bbox2D overlap check
  const overlappingBboxes = [];
  const bboxOverlapTol = 1e-6 / unitScale;
  for (let i = 0; i < barBboxes.length; i++) {
    const a = barBboxes[i].bbox;
    for (let j = i + 1; j < barBboxes.length; j++) {
      const b = barBboxes[j].bbox;
      const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (ox > bboxOverlapTol && oy > bboxOverlapTol) {
        if (overlappingBboxes.length < 15) {
          overlappingBboxes.push({
            barA: barBboxes[i].edgeIndex,
            barB: barBboxes[j].edgeIndex,
            overlapX: ox,
            overlapY: oy,
          });
        } else {
          overlappingBboxes.push({ barA: barBboxes[i].edgeIndex, barB: barBboxes[j].edgeIndex });
        }
      }
    }
  }

  const reportedSelfIntersection = unrolledData.hasSelfIntersection === true;
  const selfIntersectionOk = allowSelfIntersect
    ? true
    : selfIntersectingBars.length === 0 && !reportedSelfIntersection;

  const reportedAreaM2 =
    unrolledData.totalUnrolledSurfaceAreaM2 != null
      ? Number(unrolledData.totalUnrolledSurfaceAreaM2)
      : null;
  const areaDiffM2 =
    reportedAreaM2 != null && Number.isFinite(reportedAreaM2)
      ? Math.abs(reportedAreaM2 - verifiedTotalAreaM2)
      : 0;
  const areaConsistent =
    reportedAreaM2 == null ||
    areaDiffM2 <= Math.max(0.02 * verifiedTotalAreaM2, 1e-3);

  const passed =
    svgValid &&
    barCountMatches &&
    edgeCoverageOk &&
    underSubdividedBars.length === 0 &&
    nonConvexOrDegenerateQuads.length === 0 &&
    selfIntersectionOk &&
    invalidBboxBars.length === 0 &&
    overlappingBboxes.length === 0 &&
    verifiedTotalAreaM2 > 1e-9 &&
    areaConsistent;

  return {
    passed,
    svgProvided,
    svgValid,
    svgGroupCount,
    svgCoveredBars,
    jsonProvided: true,
    expectedBarCount: nEdges,
    unrolledBarCount: bars.length,
    barCountMatches,
    edgeCoverageOk,
    totalQuad2DCount,
    totalUnrolledSurfaceAreaM2: verifiedTotalAreaM2,
    reportedTotalUnrolledSurfaceAreaM2: reportedAreaM2,
    areaConsistent,
    underSubdividedBarCount: underSubdividedBars.length,
    underSubdividedBars: underSubdividedBars.slice(0, 10),
    nonConvexQuadCount: nonConvexOrDegenerateQuads.length,
    nonConvexQuads: nonConvexOrDegenerateQuads.slice(0, 10),
    selfIntersectingBarCount: selfIntersectingBars.length,
    selfIntersectingBars: selfIntersectingBars.slice(0, 10),
    invalidBboxBarCount: invalidBboxBars.length,
    overlappingBboxCount: overlappingBboxes.length,
    overlappingBboxes: overlappingBboxes.slice(0, 10),
  };
}

/**
 * Run all topology, PQ geometry, and fabrication checks against a Foundry brief.
 *
 * @param {object} topology - wfc-fdm-topology/v1 JSON
 * @param {object} brief - Foundry brief JSON
 * @param {string|null} [objText=null] - Optional raw .obj file text
 * @param {object} [extraArtifacts={}] - Optional { svgText, unrolledData }
 * @returns {object} Detailed fabrication check report
 */
export function runFabricationChecks(topology, brief, objText = null, extraArtifacts = {}) {
  const vertices = topology.vertices || [];
  const edges = topology.edges || [];
  const anchors = topology.anchors || [];
  const nNodes = vertices.length;
  const nEdges = edges.length;

  const env = brief.envelope || {};
  const sup = brief.supports || {};
  const crit = brief.acceptanceCriteria || {};
  const topoSpec = brief.topology || {};
  const geomSpec = brief.geometry || {};
  const fabSpec = brief.fabrication || {};

  const checks = {};

  // 1. Graph connectivity
  const connectivity = checkGraphConnectivity(nNodes, edges);
  const reqSingleComp =
    crit.requireSingleConnectedComponent !== false &&
    topoSpec.requireSingleConnectedComponent !== false;
  checks.connectivity = {
    passed: reqSingleComp ? connectivity.isSingleComponent : true,
    required: reqSingleComp,
    componentCount: connectivity.componentCount,
    isolatedNodeCount: connectivity.isolatedNodes.length,
    largestComponentSize: connectivity.largestComponentSize,
  };

  // 1b. Voxel Grid Resolution Gate (when brief.topology specifies minGridResolution or maxGridResolution)
  const minGrid = Array.isArray(topoSpec.minGridResolution) ? topoSpec.minGridResolution : null;
  const maxGrid = Array.isArray(topoSpec.maxGridResolution) ? topoSpec.maxGridResolution : null;
  if (minGrid != null || maxGrid != null) {
    const rawGrid = topology.metadata?.gridResolution ?? topology.gridResolution ?? null;
    const hasValidGrid =
      Array.isArray(rawGrid) &&
      rawGrid.length === 3 &&
      rawGrid.every((v) => Number.isFinite(Number(v)) && Number(v) >= 1);
    const grid = hasValidGrid ? rawGrid.map(Number) : null;
    const minGridOk =
      minGrid == null ||
      (grid != null && grid[0] >= minGrid[0] && grid[1] >= minGrid[1] && grid[2] >= minGrid[2]);
    const maxGridOk =
      maxGrid == null ||
      (grid != null && grid[0] <= maxGrid[0] && grid[1] <= maxGrid[1] && grid[2] <= maxGrid[2]);
    const reqSymXY = topoSpec.symmetryXY === true;
    const actualSymXY = topology.metadata?.symmetryXY;
    const symOk = !reqSymXY || actualSymXY !== false;

    checks.voxelGrid = {
      passed: hasValidGrid && minGridOk && maxGridOk && symOk,
      required: true,
      gridResolution: grid,
      minGridResolution: minGrid,
      maxGridResolution: maxGrid,
      hasValidGrid,
      minGridOk,
      maxGridOk,
      symmetryXYRequired: reqSymXY,
      symmetryXY: actualSymXY ?? null,
      symOk,
    };
  }

  // 2. Anchor count & ground contact
  const uniqueAnchors = [...new Set(anchors)];
  const minAnchors = sup.minAnchors ?? 1;
  const maxAnchors = sup.maxAnchors ?? Infinity;
  const groundZ = env.groundZ ?? 0.0;
  const groundTol = env.groundTolerance ?? 0.02;
  const mustBeOnGround = sup.mustBeOnGround !== false;

  const offGroundAnchors = [];
  let maxAnchorGroundOffsetM = 0;
  for (const idx of uniqueAnchors) {
    if (idx < 0 || idx >= nNodes) {
      offGroundAnchors.push({ node: idx, z: NaN, offsetM: Infinity });
      maxAnchorGroundOffsetM = Infinity;
      continue;
    }
    const z = vertices[idx][2];
    const offset = Math.abs(z - groundZ);
    if (offset > maxAnchorGroundOffsetM) maxAnchorGroundOffsetM = offset;
    if (offset > groundTol + 1e-9) {
      offGroundAnchors.push({ node: idx, z, offsetM: offset });
    }
  }

  const anchorCountOk = uniqueAnchors.length >= minAnchors && uniqueAnchors.length <= maxAnchors;
  const anchorGroundOk = !mustBeOnGround || offGroundAnchors.length === 0;
  checks.anchors = {
    passed: anchorCountOk && anchorGroundOk,
    count: uniqueAnchors.length,
    minAnchors,
    maxAnchors,
    anchorCountOk,
    mustBeOnGround,
    groundZ,
    groundTolerance: groundTol,
    maxAnchorGroundOffsetM,
    offGroundAnchors,
    anchorGroundOk,
  };

  // 3. Envelope compliance
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < nNodes; i++) {
    const [x, y, z] = vertices[i];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const planX = nNodes > 0 ? maxX - minX : 0;
  const planY = nNodes > 0 ? maxY - minY : 0;
  const heightZ = nNodes > 0 ? maxZ - minZ : 0;
  const planTol = env.planTolerance ?? 0.02;

  const planXOk = env.maxPlanX == null || planX <= env.maxPlanX + planTol + 1e-9;
  const planYOk = env.maxPlanY == null || planY <= env.maxPlanY + planTol + 1e-9;
  const minHeightOk = env.minHeightZ == null || heightZ >= env.minHeightZ - 1e-9;
  const maxHeightOk = env.maxHeightZ == null || heightZ <= env.maxHeightZ + 1e-9;
  const aboveGroundOk = !mustBeOnGround || minZ >= groundZ - groundTol - 1e-9;

  checks.envelope = {
    passed: planXOk && planYOk && minHeightOk && maxHeightOk && aboveGroundOk,
    planX,
    planY,
    heightZ,
    minZ,
    maxZ,
    limits: {
      maxPlanX: env.maxPlanX ?? null,
      maxPlanY: env.maxPlanY ?? null,
      planTolerance: planTol,
      minHeightZ: env.minHeightZ ?? null,
      maxHeightZ: env.maxHeightZ ?? null,
    },
    planXOk,
    planYOk,
    minHeightOk,
    maxHeightOk,
    aboveGroundOk,
  };

  // 4. Member lengths, slenderness (L / r_g), and section radius/wall bounds
  const minLenLimit = crit.minMemberLengthM ?? fabSpec.minMemberLengthM ?? 0.0;
  const maxSlenderLimit = crit.maxSlendernessRatio ?? fabSpec.maxSlendernessRatio ?? Infinity;
  const minRadiusLimit = crit.minTubeOuterRadiusM ?? fabSpec.minTubeOuterRadiusM ?? 0.0;
  const maxRadiusLimit = crit.maxTubeOuterRadiusM ?? fabSpec.maxTubeOuterRadiusM ?? Infinity;
  const minWallLimit = crit.minWallThicknessM ?? fabSpec.minWallThicknessM ?? 0.0;

  let minMemberLengthM = Infinity;
  let shortestEdge = -1;
  let maxMemberLengthM = 0;
  let maxSlendernessRatio = 0;
  let mostSlenderEdge = -1;
  let minOuterRadiusM = Infinity;
  let maxOuterRadiusM = 0;
  let minWallThicknessM = Infinity;
  let hasHollowMembers = false;

  const shortEdges = [];
  const slenderEdges = [];
  const radiusViolations = [];
  const wallViolations = [];

  for (let e = 0; e < nEdges; e++) {
    const [u, v] = edges[e];
    if (u < 0 || u >= nNodes || v < 0 || v >= nNodes) continue;
    const p1 = vertices[u];
    const p2 = vertices[v];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const sec = resolveEdgeSection(topology, e);
    const slenderness = sec.rg > 1e-12 ? L / sec.rg : Infinity;

    if (L < minMemberLengthM) { minMemberLengthM = L; shortestEdge = e; }
    if (L > maxMemberLengthM) maxMemberLengthM = L;
    if (slenderness > maxSlendernessRatio) { maxSlendernessRatio = slenderness; mostSlenderEdge = e; }
    if (sec.rOuter < minOuterRadiusM) minOuterRadiusM = sec.rOuter;
    if (sec.rOuter > maxOuterRadiusM) maxOuterRadiusM = sec.rOuter;

    if (L < minLenLimit - 1e-9) shortEdges.push({ edge: e, lengthM: L });
    if (slenderness > maxSlenderLimit + 1e-9) slenderEdges.push({ edge: e, slenderness, lengthM: L, rgM: sec.rg });
    if (sec.rOuter < minRadiusLimit - 1e-9 || sec.rOuter > maxRadiusLimit + 1e-9) {
      radiusViolations.push({ edge: e, rOuterM: sec.rOuter });
    }
    if (sec.isHollow) {
      hasHollowMembers = true;
      const wall = sec.rOuter - sec.rInner;
      if (wall < minWallThicknessM) minWallThicknessM = wall;
      if (wall < minWallLimit - 1e-9) {
        wallViolations.push({ edge: e, wallThicknessM: wall });
      }
    }
  }

  const angleStats = computeMinIncidentAngle(vertices, edges);
  const minAngleLimitDeg = crit.minIncidentAngleDeg ?? null;
  const angleOk =
    minAngleLimitDeg == null ||
    angleStats.minIncidentAngleDeg == null ||
    angleStats.minIncidentAngleDeg >= minAngleLimitDeg - 1e-9;

  checks.members = {
    passed:
      nEdges > 0 &&
      shortEdges.length === 0 &&
      slenderEdges.length === 0 &&
      radiusViolations.length === 0 &&
      wallViolations.length === 0 &&
      angleOk,
    edgeCount: nEdges,
    minMemberLengthM: nEdges > 0 ? minMemberLengthM : 0,
    shortestEdge,
    maxMemberLengthM,
    minMemberLengthLimitM: minLenLimit,
    shortEdgeCount: shortEdges.length,
    maxSlendernessRatio,
    mostSlenderEdge,
    maxSlendernessLimit: maxSlenderLimit,
    slenderEdgeCount: slenderEdges.length,
    minOuterRadiusM: nEdges > 0 ? minOuterRadiusM : 0,
    maxOuterRadiusM,
    radiusLimitsM: [minRadiusLimit, maxRadiusLimit],
    radiusViolationCount: radiusViolations.length,
    hasHollowMembers,
    minWallThicknessM: hasHollowMembers ? minWallThicknessM : null,
    minWallThicknessLimitM: minWallLimit,
    wallViolationCount: wallViolations.length,
    minIncidentAngleDeg: angleStats.minIncidentAngleDeg,
    minIncidentAngleNode: angleStats.minIncidentAngleNode,
    minIncidentAngleEdges: angleStats.minIncidentAngleEdges,
    minIncidentAngleLimitDeg: minAngleLimitDeg,
    angleOk,
  };

  // 5. Optional FDM metadata check (if brief specifies funicular residual/mode limits)
  if (brief.funicular && (topology.fdm || brief.funicular.requireCompressionOnly)) {
    const maxFdmRes = brief.funicular.maxEquilibriumResidualNorm;
    const allowedModes = brief.funicular.allowedModes;
    const fdmRes = topology.fdm?.equilibriumResidual;
    const fdmMode = topology.fdm?.mode;
    const resOk = maxFdmRes == null || fdmRes == null || fdmRes <= maxFdmRes;
    const modeOk = !Array.isArray(allowedModes) || (Boolean(fdmMode) && allowedModes.includes(fdmMode));
    checks.funicularMetadata = {
      passed: resOk && modeOk,
      mode: fdmMode ?? null,
      equilibriumResidual: fdmRes ?? null,
      maxAllowedResidual: maxFdmRes ?? null,
      resOk,
      modeOk,
    };
  }

  // 6. Optional .OBJ Watertight Manifold Mesh Check & Mesh-Based Cast Mass
  const reqWatertight = Boolean(
    crit.requireWatertightManifoldMesh === true || geomSpec.requireWatertightManifoldMesh === true
  );
  const densityKgM3 = Number(brief.material?.densityKgM3 ?? 1250);
  const maxPlanarityLimitM =
    geomSpec.maxQuadPlanarityErrorM != null ? Number(geomSpec.maxQuadPlanarityErrorM) : null;
  let meshReport = null;

  if (objText != null) {
    meshReport = verifyObjMesh(objText, { maxQuadPlanarityErrorM: maxPlanarityLimitM });
    const meshMassKg = meshReport.signedVolumeM3 > 0 ? meshReport.signedVolumeM3 * densityKgM3 : null;
    checks.mesh = {
      passed: reqWatertight ? meshReport.isWatertightManifold : true,
      required: reqWatertight,
      provided: true,
      meshMassKg,
      ...meshReport,
    };
  } else {
    checks.mesh = {
      passed: !reqWatertight,
      required: reqWatertight,
      provided: false,
      meshMassKg: null,
      note: reqWatertight
        ? 'No .mesh.obj file provided, but brief requires a watertight manifold mesh.'
        : 'No .mesh.obj file provided (optional).',
    };
  }

  // 7. Planar-Quad (PQ) & Longitudinal Subdivision Gate (when brief.geometry specifies PQ/subdiv/tube rules)
  const reqTube = geomSpec.requireTubeTopology === true;
  const minSubdivLevels =
    geomSpec.minLongitudinalSubdivLevels != null ? Number(geomSpec.minLongitudinalSubdivLevels) : null;
  const reqPQOpt = geomSpec.requirePQOptimization === true;
  const hasPqGate = reqTube || minSubdivLevels != null || reqPQOpt || maxPlanarityLimitM != null;

  if (hasPqGate) {
    const topoGeom = topology.geometry || {};
    const quadCount = meshReport ? meshReport.quadCount : 0;
    const maxQuadErrM = meshReport ? meshReport.maxQuadPlanarityErrorM : Infinity;
    const meanQuadErrM = meshReport ? meshReport.meanQuadPlanarityErrorM : null;

    const meshQuadsPresentOk = meshReport != null && quadCount > 0;
    const planarityOk =
      maxPlanarityLimitM == null ||
      (meshQuadsPresentOk && maxQuadErrM <= maxPlanarityLimitM + 1e-12);
    const tubeTopologyOk = !reqTube || topoGeom.tubeTopology === true;
    const subdivLevelsVal =
      topoGeom.longitudinalSubdivLevels != null ? Number(topoGeom.longitudinalSubdivLevels) : null;
    const subdivLevelsOk =
      minSubdivLevels == null ||
      (Number.isFinite(subdivLevelsVal) && subdivLevelsVal >= minSubdivLevels);
    const pqOptOk = !reqPQOpt || topoGeom.pqOptimizationApplied === true;

    checks.pqGeometry = {
      passed: meshQuadsPresentOk && planarityOk && tubeTopologyOk && subdivLevelsOk && pqOptOk,
      required: true,
      quadCount,
      maxQuadPlanarityErrorM: meshReport ? maxQuadErrM : null,
      meanQuadPlanarityErrorM: meanQuadErrM,
      maxQuadPlanarityErrorLimitM: maxPlanarityLimitM,
      warpedQuadCount: meshReport ? meshReport.warpedQuadCount : null,
      worstPlanarityQuadFace: meshReport ? meshReport.worstPlanarityQuadFace : -1,
      tubeTopology: topoGeom.tubeTopology ?? null,
      requireTubeTopology: reqTube,
      longitudinalSubdivLevels: subdivLevelsVal,
      minLongitudinalSubdivLevels: minSubdivLevels,
      pqOptimizationApplied: topoGeom.pqOptimizationApplied ?? null,
      requirePQOptimization: reqPQOpt,
      meshQuadsPresentOk,
      planarityOk,
      tubeTopologyOk,
      subdivLevelsOk,
      pqOptOk,
    };
  }

  // 8. Independent Per-Bar Unrolled Pattern Gate (when brief.fabrication.requireUnrolledPatternsPerBar is true)
  const reqUnrolled = fabSpec.requireUnrolledPatternsPerBar === true;
  const svgText = extraArtifacts?.svgText ?? null;
  const unrolledData = extraArtifacts?.unrolledData ?? null;

  if (reqUnrolled || svgText != null || unrolledData != null) {
    const unrollReport = verifyUnrolledPatterns(unrolledData, svgText, topology, brief);
    checks.unrolledPatterns = {
      ...unrollReport,
      required: reqUnrolled,
      passed: reqUnrolled ? unrollReport.passed : true,
    };
  }

  const allPassed = Object.values(checks).every((c) => c.passed);

  return {
    passed: allPassed,
    checks,
  };
}

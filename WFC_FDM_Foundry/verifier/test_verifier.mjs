#!/usr/bin/env node
/**
 * Analytical Validation & Unit Test Suite for WFC_FDM_Foundry/verifier
 * Validates fea_solver.mjs, fabrication_check.mjs, and verify.mjs against exact closed-form mechanics
 * (10 core v1 benchmarks + 4 Pilot v2 PQ / Grid / Compression-Only / Unrolled & Air-Gap benchmarks = 14/14).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeSectionProperties, solveSpaceFrame } from './fea_solver.mjs';
import {
  checkGraphConnectivity,
  computeMinIncidentAngle,
  computeQuadPlanarityError,
  verifyObjMesh,
  verifyUnrolledPatterns,
} from './fabrication_check.mjs';
import { verifyCandidate } from './verify.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PLASTER = {
  densityKgM3: 1250,
  youngsModulusPa: 5.0e9,
  poissonsRatio: 0.24,
  compressiveStrengthPa: 12.0e6,
  tensileStrengthPa: 2.0e6,
  shearStrengthPa: 1.5e6,
};

let passedCount = 0;
let failedCount = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedCount++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    failedCount++;
  }
}

function assertRelClose(actual, expected, maxRelErr, label) {
  const relErr = Math.abs(actual - expected) / Math.max(Math.abs(expected), 1e-15);
  assert.ok(
    relErr <= maxRelErr,
    `${label}: actual=${actual}, expected=${expected}, relErr=${(relErr * 100).toFixed(6)}% > ${(maxRelErr * 100).toFixed(4)}%`
  );
}

console.log('========================================================================');
console.log(' WFC_FDM_Foundry Verifier — Analytical Mechanics & Pilot v2 Suite');
console.log('========================================================================');

// ---------------------------------------------------------------------------
// 1. Cantilever Beam (Horizontal along X, tip load P in -Z)
// ---------------------------------------------------------------------------
runTest('Cantilever beam tip deflection PL^3/(3EI) & root bending stress PL*r/I (< 0.1% err)', () => {
  const L = 1.5;
  const r = 0.04;
  const P = 200.0; // N downward
  const sec = computeSectionProperties(r, 0);

  const topology = {
    name: 'cantilever_x',
    vertices: [[0, 0, 0], [L, 0, 0]],
    edges: [[0, 1]],
    anchors: [0],
    section: { shape: 'circular_solid', outerRadiusM: r, innerRadiusM: 0 },
  };
  const loadCase = {
    id: 'tip_load',
    gravityMS2: 0,
    nodalLoads: [{ node: 1, fz: -P }],
  };

  const res = solveSpaceFrame(topology, PLASTER, loadCase, { restraintType: 'fixed' });
  assert.equal(res.ok, true, 'Solver should succeed');

  const expectedDisp = (P * Math.pow(L, 3)) / (3 * PLASTER.youngsModulusPa * sec.I);
  const expectedStress = (P * L * r) / sec.I;

  assertRelClose(Math.abs(res.displacements.nodal[1].uz), expectedDisp, 1e-3, 'Tip deflection');
  assertRelClose(res.stresses.maxTensileStressPa, expectedStress, 1e-3, 'Root tensile bending stress');
  assertRelClose(res.stresses.maxCompressiveStressPa, expectedStress, 1e-3, 'Root compressive bending stress');
  assert.ok(res.reactions.equilibriumResidual < 1e-10, `Equilibrium residual ${res.reactions.equilibriumResidual}`);
  assertRelClose(res.reactions.perAnchor[0].fz, P, 1e-10, 'Vertical reaction');
});

// ---------------------------------------------------------------------------
// 1b. Vertical Cantilever Beam (along Z, horizontal tip load P in +X)
//     Validates vertical-member local triad singularity guard!
// ---------------------------------------------------------------------------
runTest('Vertical cantilever beam (parallel to Z) tip deflection PL^3/(3EI) (< 0.1% err)', () => {
  const L = 2.0;
  const r = 0.035;
  const P = 150.0;
  const sec = computeSectionProperties(r, 0);

  const topology = {
    name: 'cantilever_z',
    vertices: [[0, 0, 0], [0, 0, L]],
    edges: [[0, 1]],
    anchors: [0],
    section: { shape: 'circular_solid', outerRadiusM: r, innerRadiusM: 0 },
  };
  const loadCase = {
    id: 'lateral_tip',
    gravityMS2: 0,
    nodalLoads: [{ node: 1, fx: P }],
  };

  const res = solveSpaceFrame(topology, PLASTER, loadCase, { restraintType: 'fixed' });
  assert.equal(res.ok, true);

  const expectedDisp = (P * Math.pow(L, 3)) / (3 * PLASTER.youngsModulusPa * sec.I);
  const expectedStress = (P * L * r) / sec.I;

  assertRelClose(res.displacements.nodal[1].ux, expectedDisp, 1e-3, 'Vertical cantilever tip disp');
  assertRelClose(res.stresses.maxTensileStressPa, expectedStress, 1e-3, 'Vertical cantilever root stress');
  assert.ok(res.reactions.equilibriumResidual < 1e-10);
});

// ---------------------------------------------------------------------------
// 2. Axial Column Shortening PL/(EA)
// ---------------------------------------------------------------------------
runTest('Axial column shortening PL/(EA) and pure compression stress P/A (< 0.01% err)', () => {
  const L = 2.0;
  const ro = 0.04;
  const ri = 0.02; // Hollow circular section
  const P = 5000.0; // N compressive
  const sec = computeSectionProperties(ro, ri);

  const topology = {
    name: 'axial_col',
    vertices: [[0, 0, 0], [0, 0, L]],
    edges: [[0, 1]],
    anchors: [0],
    section: { shape: 'circular_hollow', outerRadiusM: ro, innerRadiusM: ri },
  };
  const loadCase = {
    id: 'axial_comp',
    gravityMS2: 0,
    nodalLoads: [{ node: 1, fz: -P }],
  };

  const res = solveSpaceFrame(topology, PLASTER, loadCase, { restraintType: 'fixed' });
  assert.equal(res.ok, true);

  const expectedShortening = (P * L) / (PLASTER.youngsModulusPa * sec.area);
  const expectedStress = P / sec.area;

  assertRelClose(-res.displacements.nodal[1].uz, expectedShortening, 1e-4, 'Axial shortening');
  assertRelClose(res.stresses.maxCompressiveStressPa, expectedStress, 1e-4, 'Compressive axial stress');
  assert.equal(res.stresses.maxTensileStressPa, 0, 'Pure compression should have 0 tensile stress');
  assert.equal(res.safetyFactors.tension, Infinity, 'Pure compression should have Inf tensile SF');
  assertRelClose(res.members[0].N, -P, 1e-10, 'Axial internal force N');
});

// ---------------------------------------------------------------------------
// 3. Simply Supported Beam under Midspan Point Load PL^3/(48EI)
// ---------------------------------------------------------------------------
runTest('Simply supported beam midspan deflection PL^3/(48EI) & max stress PL*r/(4I) (< 0.1% err)', () => {
  const L = 2.0;
  const r = 0.03;
  const P = 300.0;
  const sec = computeSectionProperties(r, 0);

  const topology = {
    name: 'simply_supported',
    vertices: [[0, 0, 0], [L / 2, 0, 0], [L, 0, 0]],
    edges: [[0, 1], [1, 2]],
    anchors: [0, 2],
    section: { shape: 'circular_solid', outerRadiusM: r, innerRadiusM: 0 },
  };
  const loadCase = {
    id: 'midspan_load',
    gravityMS2: 0,
    nodalLoads: [{ node: 1, fz: -P }],
  };

  // Restrain rigid-body roll rx at node 0 (DOF 3) for this 1D colinear beam in 3D space
  const res = solveSpaceFrame(topology, PLASTER, loadCase, {
    restraintType: 'pinned',
    additionalFixedDofs: [3],
  });
  assert.equal(res.ok, true, `Solver failed: ${res.error}`);

  const expectedDisp = (P * Math.pow(L, 3)) / (48 * PLASTER.youngsModulusPa * sec.I);
  const expectedMoment = (P * L) / 4;
  const expectedStress = (expectedMoment * r) / sec.I;

  assertRelClose(-res.displacements.nodal[1].uz, expectedDisp, 1e-3, 'Midspan deflection');
  assertRelClose(res.stresses.maxTensileStressPa, expectedStress, 1e-3, 'Midspan tensile stress');
  assertRelClose(res.reactions.perAnchor[0].fz, P / 2, 1e-10, 'Left support reaction');
  assertRelClose(res.reactions.perAnchor[1].fz, P / 2, 1e-10, 'Right support reaction');
  assert.ok(res.reactions.equilibriumResidual < 1e-10);
});

// ---------------------------------------------------------------------------
// 4. 3D Space Tripod under Vertical Apex Load
// ---------------------------------------------------------------------------
runTest('3D space tripod equilibrium sum(Rz)=P and axial leg forces', () => {
  const R = 0.5;
  const H = 1.5;
  const P = 600.0; // N downward at apex
  const r = 0.015; // slender legs so axial action dominates

  const vertices = [
    [0, 0, H], // apex = 0
    [R, 0, 0], // anchor 1
    [R * Math.cos((2 * Math.PI) / 3), R * Math.sin((2 * Math.PI) / 3), 0], // anchor 2
    [R * Math.cos((4 * Math.PI) / 3), R * Math.sin((4 * Math.PI) / 3), 0], // anchor 3
  ];
  const topology = {
    name: 'space_tripod',
    vertices,
    edges: [[0, 1], [0, 2], [0, 3]],
    anchors: [1, 2, 3],
    section: { shape: 'circular_solid', outerRadiusM: r, innerRadiusM: 0 },
  };
  const loadCase = {
    id: 'apex_load',
    gravityMS2: 0,
    nodalLoads: [{ node: 0, fz: -P }],
  };

  const res = solveSpaceFrame(topology, PLASTER, loadCase, { restraintType: 'pinned' });
  assert.equal(res.ok, true, `Tripod solver failed: ${res.error}`);

  // Exact global vertical equilibrium
  assertRelClose(res.reactions.sumReactionN[2], P, 1e-10, 'Sum of vertical reactions');
  assert.ok(Math.abs(res.reactions.sumReactionN[0]) < 1e-9, 'Sum Rx = 0');
  assert.ok(Math.abs(res.reactions.sumReactionN[1]) < 1e-9, 'Sum Ry = 0');
  assert.ok(res.reactions.equilibriumResidual < 1e-10);

  // Each symmetric leg carries P/3 vertically -> axial force ~ -(P/3) * (L/H)
  const legLen = Math.hypot(R, H);
  const expectedTrussAxial = -(P / 3) * (legLen / H);
  for (let i = 0; i < 3; i++) {
    assertRelClose(res.reactions.perAnchor[i].fz, P / 3, 1e-9, `Anchor ${i} Rz`);
    assertRelClose(res.members[i].N, expectedTrussAxial, 0.01, `Leg ${i} axial force`);
  }
});

// ---------------------------------------------------------------------------
// 5. Euler Buckling Load P_cr = pi^2 * E * I / L^2
// ---------------------------------------------------------------------------
runTest('Euler buckling critical load pi^2*E*I/L^2 and SF_buckling exact match', () => {
  const L = 1.8;
  const r = 0.025;
  const P = 1000.0;
  const sec = computeSectionProperties(r, 0);
  const expectedPcr = (Math.PI * Math.PI * PLASTER.youngsModulusPa * sec.I) / (L * L);
  const expectedSF = expectedPcr / P;

  const topology = {
    name: 'euler_column',
    vertices: [[0, 0, 0], [0, 0, L]],
    edges: [[0, 1]],
    anchors: [0],
    section: { shape: 'circular_solid', outerRadiusM: r, innerRadiusM: 0 },
  };
  const loadCase = {
    id: 'buckling_test',
    gravityMS2: 0,
    nodalLoads: [{ node: 1, fz: -P }],
  };

  const res = solveSpaceFrame(topology, PLASTER, loadCase, { restraintType: 'fixed', bucklingK: 1.0 });
  assert.equal(res.ok, true);
  assertRelClose(res.members[0].PcrN, expectedPcr, 1e-10, 'P_cr');
  assertRelClose(res.safetyFactors.buckling, expectedSF, 1e-10, 'SF_buckling');
});

// ---------------------------------------------------------------------------
// 6. Mechanism / Singular Matrix Detection
// ---------------------------------------------------------------------------
runTest('Mechanism detection catches unanchored / unstable structures cleanly', () => {
  const topology = {
    name: 'unanchored_bar',
    vertices: [[0, 0, 0], [1, 0, 0]],
    edges: [[0, 1]],
    anchors: [],
    section: { shape: 'circular_solid', outerRadiusM: 0.03, innerRadiusM: 0 },
  };
  const res = solveSpaceFrame(topology, PLASTER, { gravityMS2: 9.81 }, { restraintType: 'pinned' });
  assert.equal(res.ok, false, 'Unanchored bar must fail');
  assert.equal(res.isMechanism, true, 'Should be flagged as mechanism');
});

// ---------------------------------------------------------------------------
// 7. Watertight Manifold Cube PASS vs Open-Face Cube FAIL vs Inverted Cube FAIL
// ---------------------------------------------------------------------------
runTest('OBJ watertight manifold checker: closed cube PASS, open-face cube FAIL, inverted FAIL', () => {
  // Unit cube [0,1]^3 with outward CCW quad faces
  const cubeVerts = [
    'v 0 0 0', // 1
    'v 1 0 0', // 2
    'v 1 1 0', // 3
    'v 0 1 0', // 4
    'v 0 0 1', // 5
    'v 1 0 1', // 6
    'v 1 1 1', // 7
    'v 0 1 1', // 8
  ];
  const cubeFaces = [
    'f 1 4 3 2', // bottom (z=0, normal -z)
    'f 5 6 7 8', // top    (z=1, normal +z)
    'f 1 2 6 5', // front  (y=0, normal -y)
    'f 2 3 7 6', // right  (x=1, normal +x)
    'f 3 4 8 7', // back   (y=1, normal +y)
    'f 4 1 5 8', // left   (x=0, normal -x)
  ];

  const closedObj = [...cubeVerts, ...cubeFaces].join('\n');
  const closedRes = verifyObjMesh(closedObj);
  assert.equal(closedRes.isWatertightManifold, true, 'Closed cube must pass watertight manifold check');
  assert.equal(closedRes.vertexCount, 8);
  assert.equal(closedRes.quadCount, 6);
  assert.equal(closedRes.triCount, 0);
  assert.equal(closedRes.boundaryEdges, 0);
  assert.equal(closedRes.nonManifoldEdges, 0);
  assertRelClose(closedRes.signedVolumeM3, 1.0, 1e-10, 'Unit cube signed volume');

  // Remove top face -> open-face cube
  const openObj = [...cubeVerts, ...cubeFaces.slice(0, 5)].join('\n');
  const openRes = verifyObjMesh(openObj);
  assert.equal(openRes.isWatertightManifold, false, 'Open-face cube must FAIL');
  assert.equal(openRes.boundaryEdges, 4, 'Open-face cube should have exactly 4 boundary edges');

  // Reverse winding on all faces -> negative signed volume
  const invertedFaces = cubeFaces.map((f) => {
    const parts = f.split(' ').slice(1).reverse();
    return `f ${parts.join(' ')}`;
  });
  const invertedObj = [...cubeVerts, ...invertedFaces].join('\n');
  const invertedRes = verifyObjMesh(invertedObj);
  assert.equal(invertedRes.isWatertightManifold, false, 'Inverted cube must FAIL');
  assertRelClose(invertedRes.signedVolumeM3, -1.0, 1e-10, 'Inverted cube signed volume');
});

// ---------------------------------------------------------------------------
// 8. Graph Connectivity & End-to-End Pilot Brief Verification
// ---------------------------------------------------------------------------
runTest('End-to-end verifyCandidate against pilot_brief.json (4-leg braced tower)', () => {
  const briefPath = path.resolve(__dirname, '../briefs/pilot_brief.json');
  const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));

  // Disconnected graph check
  const disc = checkGraphConnectivity(4, [[0, 1], [2, 3]]);
  assert.equal(disc.isSingleComponent, false);
  assert.equal(disc.componentCount, 2);

  // Build a clean 1.0m x 1.0m x 2.0m braced pyramid/tower with 4 ground anchors
  const topology = {
    $schema: 'wfc-fdm-topology/v1',
    name: 'analytical_braced_tower',
    units: 'meters',
    coordinateSystem: 'Z-up',
    vertices: [
      // Base anchors (z=0)
      [0.0, 0.0, 0.0], // 0
      [1.0, 0.0, 0.0], // 1
      [1.0, 1.0, 0.0], // 2
      [0.0, 1.0, 0.0], // 3
      // Mid ring (z=1.0)
      [0.2, 0.2, 1.0], // 4
      [0.8, 0.2, 1.0], // 5
      [0.8, 0.8, 1.0], // 6
      [0.2, 0.8, 1.0], // 7
      // Top ring (z=2.0)
      [0.35, 0.35, 2.0], // 8
      [0.65, 0.35, 2.0], // 9
      [0.65, 0.65, 2.0], // 10
      [0.35, 0.65, 2.0], // 11
    ],
    edges: [
      // Lower legs + diagonals
      [0, 4], [1, 5], [2, 6], [3, 7],
      [0, 5], [1, 6], [2, 7], [3, 4],
      // Mid ring
      [4, 5], [5, 6], [6, 7], [7, 4],
      // Upper legs + diagonals
      [4, 8], [5, 9], [6, 10], [7, 11],
      [4, 9], [5, 10], [6, 11], [7, 8],
      // Top ring + cross
      [8, 9], [9, 10], [10, 11], [11, 8], [8, 10],
    ],
    anchors: [0, 1, 2, 3],
    section: { shape: 'circular_solid', outerRadiusM: 0.04, innerRadiusM: 0 },
  };

  // Watertight dummy cube OBJ so mesh check passes
  const dummyObj = [
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'v 0 0 1', 'v 1 0 1', 'v 1 1 1', 'v 0 1 1',
    'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5',
    'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
  ].join('\n');

  const verdict = verifyCandidate(topology, brief, dummyObj);
  assert.equal(verdict.passed, true, `Expected braced tower to PASS, failures: ${verdict.failureReasons.join(', ')}`);
  assert.equal(verdict.loadCases.length, 2);
  assert.ok(verdict.loadCases[1].reactions.equilibriumResidual < 1e-10);
  // Verify hardened KPIs, mesh mass, min incident angle, and lateral stability advisory
  assertRelClose(verdict.geometry.meshMassKg, 1250.0, 1e-9, 'Unit cube OBJ mesh mass (1 m^3 * 1250 kg/m^3)');
  assert.ok(verdict.geometry.centerlineMassKg > 100 && verdict.geometry.centerlineMassKg < 200);
  assert.ok(verdict.kpis.funicularEfficiency > 0 && verdict.kpis.funicularEfficiency <= 1.0);
  assert.ok(verdict.kpis.compressionDominance > 0.5);
  assert.ok(verdict.kpis.loadToMassRatio > 0);
  assert.ok(verdict.kpis.minIncidentAngleDeg > 10 && verdict.kpis.minIncidentAngleDeg < 90);
  assert.ok(verdict.lateralStabilityAdvisory != null);
  assert.equal(verdict.lateralStabilityAdvisory.advisoryOnly, true);
  assert.ok(verdict.lateralStabilityAdvisory.maxLateralDriftMm > 0);
  assert.ok(verdict.lateralStabilityAdvisory.minSafetyFactor > 1.0);
});

// ---------------------------------------------------------------------------
// 9. Funicular Efficiency KPI (pure axial = 1.0 vs pure bending = 0.0) & Min Incident Angle
// ---------------------------------------------------------------------------
runTest('Funicular efficiency KPI (axial=1.0, cantilever=0.0) & minimum incident member angle', () => {
  // Pure axial column -> funicularEfficiency === 1.0
  const colRes = solveSpaceFrame(
    {
      name: 'pure_axial',
      vertices: [[0, 0, 0], [0, 0, 2.0]],
      edges: [[0, 1]],
      anchors: [0],
      section: { shape: 'circular_solid', outerRadiusM: 0.03, innerRadiusM: 0 },
    },
    PLASTER,
    { id: 'axial', gravityMS2: 0, nodalLoads: [{ node: 1, fz: -500 }] },
    { restraintType: 'fixed' }
  );
  assert.equal(colRes.ok, true);
  assertRelClose(colRes.kpis.funicularEfficiency, 1.0, 1e-9, 'Pure axial funicularEfficiency');
  assert.equal(colRes.kpis.compressionDominance, 1.0);

  // Pure bending cantilever -> funicularEfficiency === 0.0
  const cantRes = solveSpaceFrame(
    {
      name: 'pure_bend',
      vertices: [[0, 0, 0], [1.5, 0, 0]],
      edges: [[0, 1]],
      anchors: [0],
      section: { shape: 'circular_solid', outerRadiusM: 0.03, innerRadiusM: 0 },
    },
    PLASTER,
    { id: 'bend', gravityMS2: 0, nodalLoads: [{ node: 1, fz: -200 }] },
    { restraintType: 'fixed' }
  );
  assert.equal(cantRes.ok, true);
  assert.ok(cantRes.kpis.funicularEfficiency < 1e-9, `Expected ~0, got ${cantRes.kpis.funicularEfficiency}`);

  // Minimum incident angle: 90 deg vs 30 deg
  const ang90 = computeMinIncidentAngle([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1], [0, 2]]);
  assertRelClose(ang90.minIncidentAngleDeg, 90.0, 1e-9, '90-deg corner');

  const rad30 = Math.PI / 6;
  const ang30 = computeMinIncidentAngle(
    [[0, 0, 0], [1, 0, 0], [Math.cos(rad30), Math.sin(rad30), 0]],
    [[0, 1], [0, 2]]
  );
  assertRelClose(ang30.minIncidentAngleDeg, 30.0, 1e-9, '30-deg acute corner');
});

// ---------------------------------------------------------------------------
// 10. Pilot v2 Planar-Quad (PQ) Minimax Planarity Error & Subdiv Gate
// ---------------------------------------------------------------------------
runTest('Planar-Quad (PQ) minimax planarity error (exact 0 vs warped h/2) & longitudinal subdiv gate', () => {
  // Exact tilted planar quad on plane z = 0.3*x + 0.5*y -> planarity error = 0
  const errPlanar = computeQuadPlanarityError(
    [0, 0, 0],
    [1, 0, 0.3],
    [1, 1, 0.8],
    [0, 1, 0.5]
  );
  assert.ok(errPlanar < 1e-15, `Planar quad error should be 0, got ${errPlanar}`);

  // Saddle quad: (0,0,0), (1,0,h), (1,1,0), (0,1,h) -> equidistant plane z = h/2 -> minimax error = 0.5 * h
  const h = 0.0024; // 2.4 mm -> minimax error = 1.2 mm > 0.5 mm limit
  const errWarped = computeQuadPlanarityError(
    [0, 0, 0],
    [1, 0, h],
    [1, 1, 0],
    [0, 1, h]
  );
  assertRelClose(errWarped, 0.5 * h, 1e-12, 'Analytical saddle quad minimax planarity error');

  // Warped closed hexahedron in OBJ -> verifyObjMesh catches warped top quad
  const warpedCubeObj = [
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'v 0 0 1', `v 1 0 ${1 + h}`, 'v 1 1 1', `v 0 1 ${1 + h}`,
    'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5',
    'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
  ].join('\n');
  const meshAudit = verifyObjMesh(warpedCubeObj, { maxQuadPlanarityErrorM: 0.0005 });
  assert.equal(meshAudit.isWatertightManifold, true);
  assertRelClose(meshAudit.maxQuadPlanarityErrorM, 0.0012, 1e-9, 'OBJ maxQuadPlanarityErrorM');
  assert.ok(meshAudit.warpedQuadCount >= 1, 'Should flag warped top quad exceeding 0.5 mm');
});

// ---------------------------------------------------------------------------
// 11. Pilot v2 Voxel Grid Resolution Gate & v1 Backward Compatibility
// ---------------------------------------------------------------------------
runTest('Voxel grid resolution gate rejects 1x1x* in Pilot v2 while keeping v1 backward compatibility', () => {
  const v2Brief = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../briefs/pilot_v2_pq_unrolled.json'), 'utf8')
  );
  const v1Brief = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../briefs/pilot_brief.json'), 'utf8')
  );

  const baseTopo = {
    name: 'quadripod_grid_test',
    vertices: [
      [-0.45, -0.45, 0], [0.45, -0.45, 0], [0.45, 0.45, 0], [-0.45, 0.45, 0],
      [0, 0, 2.0],
    ],
    edges: [[0, 4], [1, 4], [2, 4], [3, 4]],
    anchors: [0, 1, 2, 3],
    section: { shape: 'circular_hollow', outerRadiusM: 0.035, innerRadiusM: 0.018, nSides: 8 },
    fdm: { mode: 'compression', equilibriumResidual: 1e-12 },
    geometry: { tubeTopology: true, longitudinalSubdivLevels: 1, pqOptimizationApplied: true },
    metadata: { gridResolution: [1, 1, 3], symmetryXY: true },
  };
  const dummyCubeObj = [
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'v 0 0 1', 'v 1 0 1', 'v 1 1 1', 'v 0 1 1',
    'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5',
    'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
  ].join('\n');

  // 1x1x3 MUST FAIL voxelGrid in Pilot v2
  const v2Res1x1 = verifyCandidate(baseTopo, v2Brief, dummyCubeObj);
  assert.equal(v2Res1x1.fabrication.checks.voxelGrid.passed, false, '1x1x3 must fail Pilot v2 voxelGrid');
  assert.ok(v2Res1x1.failureReasons.includes('fabrication.voxelGrid'));

  // 2x2x3 MUST PASS voxelGrid in Pilot v2
  const topo2x2x3 = { ...baseTopo, metadata: { gridResolution: [2, 2, 3], symmetryXY: true } };
  const v2Res2x2 = verifyCandidate(topo2x2x3, v2Brief, dummyCubeObj);
  assert.equal(v2Res2x2.fabrication.checks.voxelGrid.passed, true, '2x2x3 must pass Pilot v2 voxelGrid');

  // 1x1x3 MUST STILL PASS Pilot v1 brief (100% backward compatibility)
  const v1Res = verifyCandidate(baseTopo, v1Brief, dummyCubeObj);
  assert.equal(v1Res.passed, true, `1x1x3 quadripod must still pass Pilot v1: ${v1Res.failureReasons.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 12. Pilot v2 Strict Compression-Only FEA Gate (0 Bars in Net Axial Tension)
// ---------------------------------------------------------------------------
runTest('Strict compression-only FEA gate catches net axial tension bars with exact member indices', () => {
  const v2Brief = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../briefs/pilot_v2_pq_unrolled.json'), 'utf8')
  );

  // Pyramid with mid-height horizontal ring that spreads outward under vertical apex load -> ring bars go into TENSION!
  const tensionRingTopo = {
    name: 'portal_tension_tie_tower',
    vertices: [
      [-0.45, -0.45, 0.0], [0.45, -0.45, 0.0], [0.45, 0.45, 0.0], [-0.45, 0.45, 0.0], // 0..3 anchors
      [-0.35, -0.35, 1.0], [0.35, -0.35, 1.0], [0.35, 0.35, 1.0], [-0.35, 0.35, 1.0], // 4..7 mid-ring (kinked outward vs straight line to apex!)
      [0.0, 0.0, 2.0], // 8 apex
    ],
    edges: [
      [0, 4], [1, 5], [2, 6], [3, 7], // 0..3 lower legs
      [4, 8], [5, 8], [6, 8], [7, 8], // 4..7 upper legs (shallower slope pushes mid-ring outward!)
      [4, 5], [5, 6], [6, 7], [7, 4], // 8..11 horizontal mid-ring ties -> TENSION!
    ],
    anchors: [0, 1, 2, 3],
    section: { shape: 'circular_hollow', outerRadiusM: 0.025, innerRadiusM: 0.012, nSides: 8 },
    fdm: { mode: 'compression', equilibriumResidual: 1e-12 },
    geometry: { tubeTopology: true, longitudinalSubdivLevels: 1, pqOptimizationApplied: true },
    metadata: { gridResolution: [2, 2, 2], symmetryXY: true },
  };
  const dummyCubeObj = [
    'v 0 0 0', 'v 1 0 0', 'v 1 1 0', 'v 0 1 0',
    'v 0 0 1', 'v 1 0 1', 'v 1 1 1', 'v 0 1 1',
    'f 1 4 3 2', 'f 5 6 7 8', 'f 1 2 6 5',
    'f 2 3 7 6', 'f 3 4 8 7', 'f 4 1 5 8',
  ].join('\n');

  const resTension = verifyCandidate(tensionRingTopo, v2Brief, dummyCubeObj);
  const lc2Comp = resTension.loadCases[1].criteria.compressionOnly;
  assert.equal(lc2Comp.passed, false, 'Outward-pushed horizontal tie ring must fail compressionOnly');
  assert.equal(lc2Comp.tensileBarCount, 4, 'All 4 horizontal tie bars [8,9,10,11] should be in net tension');
  assert.deepEqual([...lc2Comp.tensileMemberIndices].sort((a, b) => a - b), [8, 9, 10, 11]);
  assert.ok(resTension.kpis.maxAxialForceN > 1.0, `Expected positive maxAxialForceN, got ${resTension.kpis.maxAxialForceN}`);

  // Pure compression 4-leg quadripod -> 0 tensile bars, maxAxialForceN < 0
  const pureCompTopo = {
    ...tensionRingTopo,
    name: 'pure_compression_quadripod',
    vertices: [
      [-0.45, -0.45, 0.0], [0.45, -0.45, 0.0], [0.45, 0.45, 0.0], [-0.45, 0.45, 0.0],
      [0.0, 0.0, 2.0],
    ],
    edges: [[0, 4], [1, 4], [2, 4], [3, 4]],
  };
  const resPure = verifyCandidate(pureCompTopo, v2Brief, dummyCubeObj);
  assert.equal(resPure.loadCases[0].criteria.compressionOnly.passed, true);
  assert.equal(resPure.loadCases[1].criteria.compressionOnly.passed, true);
  assert.equal(resPure.kpis.tensileBarCount, 0);
  assert.ok(resPure.kpis.maxAxialForceN < 0, 'All bars must have N < 0');
});

// ---------------------------------------------------------------------------
// 13. Pilot v2 2D Unrolled Strip Auditor & Strict Air-Gap Isolation Audit
// ---------------------------------------------------------------------------
runTest('2D unrolled pattern auditor (area, self-intersection, bbox overlap) & strict air-gap check', () => {
  const v2Brief = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../briefs/pilot_v2_pq_unrolled.json'), 'utf8')
  );
  const twoBarTopo = {
    edges: [[0, 1], [1, 2]],
    section: { nSides: 4 },
  };

  // Helper to build a clean 2x4 grid of 2D quads (L=1 subdiv -> 2 bands x 4 sides = 8 quads per bar)
  const makeCleanBar = (edgeIndex, offsetX) => {
    const quads2D = [];
    const w = 0.02;
    const h = 0.25;
    for (let band = 0; band < 2; band++) {
      for (let side = 0; side < 4; side++) {
        const x0 = side * w;
        const x1 = (side + 1) * w;
        const y0 = band * h;
        const y1 = (band + 1) * h;
        quads2D.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      }
    }
    return {
      edgeIndex,
      nSides: 4,
      subdivLevels: 1,
      bbox2D: [offsetX, 0, offsetX + 4 * w, 2 * h],
      quads2D,
    };
  };

  const validSvg = '<svg xmlns="http://www.w3.org/2000/svg"><g id="bar-0"><path d="M0,0 L1,0"/></g><g id="bar-1"><path d="M2,0 L3,0"/></g></svg>';
  const validUnrolled = {
    $schema: 'wfc-fdm-unrolled/v1',
    units: 'meters',
    barCount: 2,
    hasSelfIntersection: false,
    bars: [makeCleanBar(0, 0.0), makeCleanBar(1, 0.20)],
  };

  const okRes = verifyUnrolledPatterns(validUnrolled, validSvg, twoBarTopo, v2Brief);
  assert.equal(okRes.passed, true, `Valid unrolled strips should pass: ${JSON.stringify(okRes)}`);
  // Expected area = 2 bars * 8 quads * (0.02 * 0.25) = 0.08 m^2
  assertRelClose(okRes.totalUnrolledSurfaceAreaM2, 0.08, 1e-12, 'Verified 2D unrolled surface area');

  // Inject non-shared edge crossing in bar 0 (shift last quad across quad 0)
  const selfIntUnrolled = JSON.parse(JSON.stringify(validUnrolled));
  selfIntUnrolled.bars[0].quads2D[7] = [[-0.01, 0.05], [0.05, 0.05], [0.05, 0.15], [-0.01, 0.15]];
  const badSelfInt = verifyUnrolledPatterns(selfIntUnrolled, validSvg, twoBarTopo, v2Brief);
  assert.equal(badSelfInt.passed, false, 'Self-intersecting strip must fail');
  assert.ok(badSelfInt.selfIntersectingBarCount >= 1);

  // Inject overlapping sheet bbox2D between bar 0 and bar 1
  const overlapBboxUnrolled = JSON.parse(JSON.stringify(validUnrolled));
  overlapBboxUnrolled.bars[1].bbox2D = [0.04, 0.0, 0.12, 0.50]; // overlaps bar 0 [0, 0, 0.08, 0.50]
  const badBbox = verifyUnrolledPatterns(overlapBboxUnrolled, validSvg, twoBarTopo, v2Brief);
  assert.equal(badBbox.passed, false, 'Overlapping layout bbox2D must fail');
  assert.equal(badBbox.overlappingBboxCount, 1);

  // Automated strict Air-Gap isolation audit across all verifier files
  const verifierFiles = ['fea_solver.mjs', 'fabrication_check.mjs', 'verify.mjs', 'test_verifier.mjs', 'verifier.html'];
  const forbiddenTokens = [['index', '_WFC'].join(''), ['run_', 'generator'].join('')];
  for (const vf of verifierFiles) {
    const content = fs.readFileSync(path.join(__dirname, vf), 'utf8');
    for (const tok of forbiddenTokens) {
      assert.equal(
        content.includes(tok),
        false,
        `Air-gap violation: verifier/${vf} must never reference ${tok}`
      );
    }
  }
});

console.log('------------------------------------------------------------------------');
console.log(` Results: ${passedCount} passed, ${failedCount} failed`);
console.log('========================================================================');

if (failedCount > 0) {
  process.exit(1);
}

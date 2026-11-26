/**
 * WFC-FDM Foundry — Pure-JS Core & Geometry Regression Suite (core/test_core.mjs)
 *
 * STRICT AIR-GAP: Zero imports from verifier/. Pure Node.js ES module testing core/** only.
 * Usage: node ./TOPOGEN_FDM_Foundry/core/test_core.mjs  (or `npm run test:core`)
 */

import {
    createTwinTubeBifurcationCoarseMesh,
    extractBoundaryPortLoops,
    extractSkeletalGraphFromMesh
} from './mesh_skeletonizer.mjs';
import {
    applyRingOnlySubdivisionToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips
} from './pq_subdivision.mjs';
import { solidifyGraph } from './pq_solidifier.mjs';
import { analyzeSpaceFrameFEA } from './frame_fea_preview.mjs';
import {
    traceSkeletalPathsAStar,
    optimizeElasticaCurve,
    buildHybridGraphWithElastica
} from './elastica_curves.mjs';
import { generateCandidate } from './index.mjs';

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        failed++;
        console.error(`  [FAIL] ${name}: ${err && err.message ? err.message : err}`);
    }
}

function isConnectedGraph(nVerts, edges) {
    if (nVerts === 0) return false;
    const adj = Array.from({ length: nVerts }, () => []);
    for (const [u, v] of edges) {
        if (!Number.isInteger(u) || !Number.isInteger(v) || u < 0 || v < 0 || u >= nVerts || v >= nVerts) return false;
        adj[u].push(v);
        adj[v].push(u);
    }
    const visited = new Uint8Array(nVerts);
    const stack = [0];
    visited[0] = 1;
    let count = 0;
    while (stack.length > 0) {
        const cur = stack.pop();
        count++;
        for (const nb of adj[cur]) {
            if (!visited[nb]) {
                visited[nb] = 1;
                stack.push(nb);
            }
        }
    }
    return count === nVerts;
}

function allCoordsFinite(verts) {
    for (const p of verts) {
        const x = Array.isArray(p) ? p[0] : p.x;
        const y = Array.isArray(p) ? p[1] : p.y;
        const z = Array.isArray(p) ? p[2] : p.z;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    }
    return true;
}

console.log('=== TOPOGEN_FDM_Foundry Core & Geometry Regression Suite ===');

// ---------------------------------------------------------------------------
// Test 1: mesh_skeletonizer.mjs — Twin-Tube Bifurcation Coarse Mesh
// ---------------------------------------------------------------------------
test('1. mesh_skeletonizer: Twin-Tube Bifurcation coarse mesh -> valid connected skeleton', () => {
    const coarse = createTwinTubeBifurcationCoarseMesh();
    assert(coarse && Array.isArray(coarse.verts) && coarse.verts.length === 32, `Expected 32 verts, got ${coarse && coarse.verts.length}`);
    assert(Array.isArray(coarse.faces) && coarse.faces.length === 26, `Expected 26 quads, got ${coarse && coarse.faces.length}`);

    const ports = extractBoundaryPortLoops(coarse.verts, coarse.faces);
    assert(ports.length === 4, `Expected 4 open boundary ports, got ${ports.length}`);

    const skel = extractSkeletalGraphFromMesh(coarse.verts, coarse.faces);
    assert(skel && Array.isArray(skel.vertices) && Array.isArray(skel.edges), 'Skeleton result missing vertices/edges');
    assert(skel.vertices.length >= 4 && skel.edges.length >= 3, `Skeleton too sparse: ${skel.vertices.length}V / ${skel.edges.length}E`);
    assert(allCoordsFinite(skel.vertices), 'Skeleton contains non-finite coordinates');
    assert(isConnectedGraph(skel.vertices.length, skel.edges), `Skeleton is not connected (${skel.vertices.length}V / ${skel.edges.length}E)`);
    assert(skel.portCount === 4, `Expected portCount === 4, got ${skel.portCount}`);
});

// ---------------------------------------------------------------------------
// Test 2: mesh_skeletonizer.mjs — solidifyGraph round-trip skeletonization
// ---------------------------------------------------------------------------
test('2. mesh_skeletonizer: solidifyGraph tubular tripod -> round-trip skeletonization', () => {
    const tripodVerts = [
        [-0.45, -0.35, 0.0],
        [ 0.45, -0.35, 0.0],
        [ 0.00,  0.45, 0.0],
        [ 0.00,  0.00, 0.55],
        [ 0.00,  0.00, 1.10]
    ];
    const tripodEdges = [
        [0, 3], [1, 3], [2, 3], [3, 4]
    ];
    const solid = solidifyGraph(tripodVerts, tripodEdges, {
        nSides: 6,
        radius: 0.06,
        endOffset: 0.13,
        stitchAtBisectors: true,
        capLeafEnds: false
    });
    assert(solid.vertices.length > 0 && solid.quads.length > 0, 'solidifyGraph produced empty mesh');

    const vertsArr = solid.vertices.map(v => [v.x, v.y, v.z]);
    const skel = extractSkeletalGraphFromMesh(vertsArr, solid.quads);
    assert(skel.vertices.length >= 4 && skel.edges.length >= 3, `Round-trip skeleton too small: ${skel.vertices.length}V / ${skel.edges.length}E`);
    assert(allCoordsFinite(skel.vertices), 'Round-trip skeleton contains non-finite coordinates');
    assert(isConnectedGraph(skel.vertices.length, skel.edges), 'Round-trip skeleton is disconnected');
});

// ---------------------------------------------------------------------------
// Test 3: pq_subdivision.mjs — Ring-Only Cubic B-Spline Subdivision
// ---------------------------------------------------------------------------
test('3. pq_subdivision: applyRingOnlySubdivisionToPQStrips produces smooth valid quads', () => {
    const verts = [
        [-0.5, 0.0, 0.0],
        [ 0.0, 0.0, 0.6],
        [ 0.5, 0.0, 0.0]
    ];
    const edges = [[0, 1], [1, 2]];
    const solid = solidifyGraph(verts, edges, {
        nSides: 6,
        radius: 0.04,
        endOffset: 0.09,
        stitchAtBisectors: true,
        capLeafEnds: true
    });
    const initialQuads = solid.quads.length;
    assert(initialQuads > 0, 'Initial solidified mesh has no quads');

    const sub = applyRingOnlySubdivisionToPQStrips(solid, 1, false);
    assert(sub.quads.length > initialQuads, `Expected quad count > ${initialQuads}, got ${sub.quads.length}`);
    assert(sub.ringSubdivLevels === 1, `Expected ringSubdivLevels === 1, got ${sub.ringSubdivLevels}`);
    assert(allCoordsFinite(sub.vertices), 'Ring-subdivided mesh has non-finite vertices');
    for (const q of sub.quads) {
        assert(q.length === 4, 'Non-quad face in ring-subdivided mesh');
        for (const vi of q) assert(vi >= 0 && vi < sub.vertices.length, 'Quad index out of bounds');
    }
    assert(sub.verification && sub.verification.isValid, 'Ring-subdivided mesh failed manifold verification');
});

// ---------------------------------------------------------------------------
// Test 4: pq_subdivision.mjs — Longitudinal-Only Subdivision
// ---------------------------------------------------------------------------
test('4. pq_subdivision: applyLongitudinalOnlySubdivisionToPQStrips preserves valid quads', () => {
    const verts = [
        [-0.5, 0.0, 0.0],
        [ 0.0, 0.0, 0.6],
        [ 0.5, 0.0, 0.0]
    ];
    const edges = [[0, 1], [1, 2]];
    const solid = solidifyGraph(verts, edges, {
        nSides: 6,
        radius: 0.04,
        endOffset: 0.09,
        stitchAtBisectors: true,
        capLeafEnds: true
    });
    const initialQuads = solid.quads.length;

    const sub = applyLongitudinalOnlySubdivisionToPQStrips(solid, 1, false);
    assert(sub.quads.length > initialQuads, `Expected quad count > ${initialQuads}, got ${sub.quads.length}`);
    assert(allCoordsFinite(sub.vertices), 'Longitudinal-subdivided mesh has non-finite vertices');
    assert(sub.verification && sub.verification.isValid, 'Longitudinal-subdivided mesh failed manifold verification');
    assert(sub.planarity && Number.isFinite(sub.planarity.maxQuadPlanarityErrorM), 'Planarity stats invalid');
});

// ---------------------------------------------------------------------------
// Test 5: frame_fea_preview.mjs — BR-B05-01 Regression (omitted inAnchors + guards)
// ---------------------------------------------------------------------------
test('5. frame_fea_preview: analyzeSpaceFrameFEA without inAnchors (BR-B05-01 regression)', () => {
    const pyramidVerts = [
        [-0.5, -0.5, 0.0],
        [ 0.5, -0.5, 0.0],
        [ 0.5,  0.5, 0.0],
        [-0.5,  0.5, 0.0],
        [ 0.0,  0.0, 1.2]
    ];
    const pyramidEdges = [
        [0, 4], [1, 4], [2, 4], [3, 4],
        [0, 1], [1, 2], [2, 3], [3, 0]
    ];

    // Omitted inAnchors (previously threw ReferenceError: selectGroundAnchors is not defined)
    const fea = analyzeSpaceFrameFEA(pyramidVerts, pyramidEdges);
    assert(fea && fea.valid === true, 'analyzeSpaceFrameFEA(verts, edges) failed with omitted inAnchors');
    assert(Number.isFinite(fea.maxDispM) && fea.maxDispM > 0 && fea.maxDispM < 0.05, `Unexpected maxDispM=${fea.maxDispM}`);
    assert(Number.isFinite(fea.equilibriumResidual) && fea.equilibriumResidual < 1e-4, `Equilibrium residual too high: ${fea.equilibriumResidual}`);
    assert(fea.reactions.length >= 3, `Expected >= 3 auto-selected ground reactions, got ${fea.reactions.length}`);
    assert(allCoordsFinite(fea.nodalDisplacements), 'Non-finite nodal displacements');

    // Out-of-range inAnchors should fall back cleanly to ground anchors
    const feaFallback = analyzeSpaceFrameFEA(pyramidVerts, pyramidEdges, [-1, 999]);
    assert(feaFallback && feaFallback.valid === true && feaFallback.reactions.length >= 3, 'Out-of-range anchor fallback failed');

    // Degenerate empty graph should return valid: false without throwing
    const feaEmpty = analyzeSpaceFrameFEA([], []);
    assert(feaEmpty && feaEmpty.valid === false, 'Empty graph should return valid: false');
});

// ---------------------------------------------------------------------------
// Test 6: frame_fea_preview.mjs + elastica_curves.mjs — Elastica-Only FEA Stability
// ---------------------------------------------------------------------------
test('6. frame_fea_preview + elastica_curves: Elastica-only (excludeGraph: true) FEA stability', () => {
    const hostVerts = [
        [-0.5, -0.5, 0.0], // 0 (leaf ground)
        [ 0.5, -0.5, 0.0], // 1 (leaf ground)
        [ 0.5,  0.5, 0.0], // 2 (leaf ground)
        [-0.5,  0.5, 0.0], // 3 (leaf ground)
        [ 0.0,  0.0, 0.8], // 4 (hub)
        [ 0.0,  0.0, 1.5]  // 5 (top leaf)
    ];
    const hostEdges = [
        [0, 4], [1, 4], [2, 4], [3, 4], [4, 5]
    ];
    const hostAnchors = [0, 1, 2, 3];

    const traced = traceSkeletalPathsAStar(hostVerts, hostEdges, {
        sourceNodes: [0, 1, 2, 3],
        sinkNodes: [5],
        maxCurves: 8
    });
    assert(traced.paths.length >= 4, `Expected >= 4 traced paths, got ${traced.paths.length}`);

    const curves = traced.paths.map((p, idx) => {
        const opt = optimizeElasticaCurve(p.points, { iterations: 12, samples: 15 });
        return {
            id: idx,
            startNode: p.startNode,
            endNode: p.endNode,
            points: opt.points,
            rod: { radius: 0.014 }
        };
    });

    const hybrid = buildHybridGraphWithElastica(hostVerts, hostEdges, curves, {
        includeHostGraph: false,
        hostAnchors,
        segsPerRod: 6,
        rodRadiusM: 0.014,
        activeBendFactor: 1.0
    });
    assert(hybrid.hostEdgeCount === 0, `Expected hostEdgeCount === 0 in includeHostGraph:false mode, got ${hybrid.hostEdgeCount}`);
    assert(hybrid.elasticaEdgeCount > 0 && hybrid.coupledRodCount >= 4, 'Elastica-only hybrid graph missing rods');

    const fea = analyzeSpaceFrameFEA(
        hybrid.vertices,
        hybrid.edges,
        hybrid.recommendedAnchors,
        { outerRadiusM: 0.014, innerRadiusM: 0 },
        {},
        {
            edgeSpecs: hybrid.edgeSpecs,
            nodalSelfStressPairs: hybrid.nodalSelfStressPairs,
            hostNodeCount: hybrid.hostNodeCount,
            ensureComponentFixity: true,
            distributedVerticalMassKg: 10
        }
    );
    assert(fea && fea.valid === true, 'Elastica-only FEA returned invalid');
    assert(Number.isFinite(fea.maxDispM) && fea.maxDispM >= 0 && fea.maxDispM < 1.0, `Elastica-only FEA blowout: maxDispM=${fea.maxDispM}`);
    assert(allCoordsFinite(fea.nodalDisplacements), 'Elastica-only FEA produced non-finite displacements');
    assert(Number.isFinite(fea.equilibriumResidual) && fea.equilibriumResidual < 1e-2, `Equilibrium residual too high: ${fea.equilibriumResidual}`);
});

// ---------------------------------------------------------------------------
// Test 7: core/index.mjs — generateCandidate End-to-End Smoke
// ---------------------------------------------------------------------------
test('7. core/index: generateCandidate(pilot_champion, [2,2,3], seed=42) produces valid graph/mesh/unroll', () => {
    const res = generateCandidate(
        { fabrication: { requireUnrolledPatternsPerBar: true } },
        {
            name: 'core_smoke_pilot',
            tilePreset: 'pilot_champion',
            gridResolution: [2, 2, 3],
            wfcSeed: 42,
            unrollPatterns: true
        }
    );
    assert(res && res.metrics && res.topologyJson && res.solid, 'generateCandidate returned incomplete bundle');
    assert(res.metrics.graphVertices >= 4 && res.metrics.graphEdges >= 4, `Unexpected graph size: ${res.metrics.graphVertices}V/${res.metrics.graphEdges}E`);
    assert(res.metrics.anchors >= 3, `Expected >= 3 anchors, got ${res.metrics.anchors}`);
    assert(res.metrics.meshQuads > 0, 'Generated solid mesh has 0 quads');
    assert(res.metrics.manifoldValid === true, 'Generated solid mesh failed manifold check');
    assert(res.metrics.watertight === true, 'Generated solid mesh is not watertight');
    assert(res.topologyJson.$schema === 'wfc-fdm-topology/v1', 'Unexpected topology JSON schema');
    assert(typeof res.objText === 'string' && res.objText.includes('v ') && res.objText.includes('f '), 'Invalid OBJ text');
    assert(res.unrolledJson && Array.isArray(res.unrolledJson.bars) && res.unrolledJson.bars.length === res.fdm.edges.length, 'Unrolled bar count mismatch');
    assert(Number.isFinite(res.metrics.totalUnrolledSurfaceAreaM2) && res.metrics.totalUnrolledSurfaceAreaM2 > 0, 'Invalid unrolled surface area');
});

console.log(`\nCore Suite Summary: ${passed}/${passed + failed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

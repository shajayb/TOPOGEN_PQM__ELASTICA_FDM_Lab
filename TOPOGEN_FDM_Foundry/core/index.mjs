/**
 * WFC-FDM Foundry — Unified Generator Core Entrypoint (core/index.mjs)
 *
 * Assembles the pure-JS WFC -> FDM -> All-Quad PQ Solidifier -> 2D Unroll pipeline,
 * exports all symbols as named ES module exports, attaches `globalThis.WFC_FDM_CORE`
 * for seamless browser & legacy compatibility, and provides `loadWfcCore()`.
 *
 * STRICT AIR-GAP: Zero imports from external audit suites or DOM / Three.js.
 */

import {
    V3,
    toV3,
    toArr3,
    mulberry32,
    DIRS,
    TILE_NULL, TILE_CROSS, TILE_VTUBE, TILE_HTUBE, TILE_HTUBE_Y,
    TILE_XBRACE_XZ, TILE_XBRACE_YZ, TILE_DIAG_PYR, TILE_ARCH_VAULT, TILE_TRIPOD_LEG, TILE_DIAPHRAGM,
    TILE_FUNICULAR_VAULT, TILE_SLENDER_DIAGRID, TILE_HYPERBOLOID, TILE_CATENARY_QUADRIPOD,
    buildBoxArmQuads,
    buildStrutQuads,
    buildQuadsFromGraph,
    createTileTemplates,
    TILE_PRESETS,
    applyTilePresetToTiles,
    buildAdjacencyRules,
    solveLinearSystem
} from './math_tiles.mjs';

import {
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
} from './wfc_graph.mjs';

import {
    selectGroundAnchors,
    assignForceDensities,
    solveFDM,
    conditionCompressionOnlyNetwork
} from './fdm_solver.mjs';

import {
    weldVertices,
    LOOP_PALETTE,
    computeParentColorShade,
    computeQuadPlanarity,
    computeQuadPlanarityError,
    isConvexQuad3D,
    computeMeshPlanarityStats,
    computeSignedMeshVolume,
    planarizeQuadMesh,
    walkMeshFaceLoops,
    initSolidFaceLoops,
    optimizeFaceLoopsToPQ,
    applyCatmullClarkToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips,
    applyRingOnlySubdivisionToPQStrips,
    mergeTrianglesToQuads,
    verifyManifold,
    computeConvexHull3D,
    computeNodeBisectorRings,
    computeEndRingBisectorStitched,
    solidifyGraphBisectorStitched,
    solidifyGraph,
    buildQuadDominantOBJ
} from './pq_solidifier.mjs';

import {
    unrollFaceLoop2D,
    buildUnrolledPatterns,
    verifyUnrolledPatterns,
    buildUnrolledPatternsSVG
} from './unroll_patterns.mjs';

import {
    estimateFrameMechanics,
    analyzeSpaceFrameFEA
} from './frame_fea_preview.mjs';

import {
    findValenceOneNodes,
    traceSkeletalPathsAStar,
    subdivideCatmullClark1D,
    sampleCatmullRom,
    computeElasticaMetrics,
    optimizeElasticaCurve,
    buildElasticaRodMesh,
    unrollElasticaRibbon2D,
    packElasticaRibbons2D,
    generateElasticaRibbons,
    buildElasticaRibbonsSVG
} from './elastica_curves.mjs';

// --- Neutral Interchange Contract JSON Builder (wfc-fdm-topology/v1) ---
function buildFoundryTopologyJSON(fdmResult, sectionParams = {}, metadata = {}, extraBlocks = {}) {
    const round6 = v => Math.round(v * 1e6) / 1e6;
    const outerRadiusM = Number(sectionParams.outerRadiusM !== undefined ? sectionParams.outerRadiusM : 0.035);
    const innerRadiusM = Number(sectionParams.innerRadiusM !== undefined ? sectionParams.innerRadiusM : 0.0);
    const nSides = Math.round(sectionParams.nSides || 8);
    const shape = innerRadiusM > 1e-6 ? 'circular_hollow' : 'circular_solid';

    const payload = {
        $schema: 'wfc-fdm-topology/v1',
        name: metadata.name || 'wfc_fdm_candidate',
        units: 'meters',
        coordinateSystem: 'Z-up',
        vertices: fdmResult.vertices.map(p => [round6(p[0]), round6(p[1]), round6(p[2])]),
        edges: fdmResult.edges.map(e => [e[0], e[1]]),
        anchors: [...fdmResult.anchors],
        section: {
            shape,
            outerRadiusM,
            innerRadiusM,
            nSides
        },
        fdm: {
            mode: fdmResult.mode,
            forceDensities: fdmResult.forceDensities.map(q => Math.round(q * 1e6) / 1e6),
            equilibriumResidual: fdmResult.equilibriumResidual
        }
    };
    if (extraBlocks.geometry) payload.geometry = extraBlocks.geometry;
    if (extraBlocks.fabrication) payload.fabrication = extraBlocks.fabrication;
    payload.metadata = Object.assign({
        source: 'TOPOGEN_FDM_Foundry/index_WFC.html',
        exportedAt: new Date().toISOString()
    }, metadata);
    return payload;
}

// --- End-to-End Headless / Interactive Candidate Generator ---
function generateCandidate(brief = {}, config = {}) {
    const env = brief.envelope || {};
    const topo = brief.topology || {};
    const geom = brief.geometry || {};
    const fab = brief.fabrication || {};
    const sup = brief.supports || {};
    const fun = brief.funicular || {};
    const acc = brief.acceptanceCriteria || {};

    // Extract peak distributed load from brief loadCases (e.g. 50 kg * 9.81 = 490.5 N)
    let briefLoadN = 490.5;
    let briefTopFrac = 0.85;
    if (Array.isArray(brief.loadCases)) {
        for (const lc of brief.loadCases) {
            if (lc.distributedVerticalMassKg > 0) {
                briefLoadN = Math.max(briefLoadN, lc.distributedVerticalMassKg * (lc.gravityMS2 || 9.81));
                if (lc.topZoneFractionZ) briefTopFrac = lc.topZoneFractionZ;
            }
        }
    }

    const name = config.name || 'candidate';
    const tilePreset = config.tilePreset || 'pilot_champion';
    const presetDef = TILE_PRESETS[tilePreset] || {};
    const pCfg = presetDef.defaultConfig || {};

    // Enforce brief.topology.minGridResolution / maxGridResolution when present
    let rawGrid = config.gridResolution || presetDef.defaultGrid || [2, 2, 3];
    let gridResolution = [
        Math.max(1, Math.round(rawGrid[0] || 2)),
        Math.max(1, Math.round(rawGrid[1] || 2)),
        Math.max(1, Math.round(rawGrid[2] || 3))
    ];
    if (!config.ignoreGridLimits) {
        if (Array.isArray(topo.minGridResolution) && topo.minGridResolution.length === 3) {
            for (let d = 0; d < 3; d++) {
                gridResolution[d] = Math.max(Math.round(topo.minGridResolution[d]), gridResolution[d]);
            }
        }
        if (Array.isArray(topo.maxGridResolution) && topo.maxGridResolution.length === 3) {
            for (let d = 0; d < 3; d++) {
                gridResolution[d] = Math.min(Math.round(topo.maxGridResolution[d]), gridResolution[d]);
            }
        }
    }

    const wfcSeed = config.wfcSeed !== undefined ? config.wfcSeed : (pCfg.wfcSeed !== undefined ? pCfg.wfcSeed : 42);
    const algorithm = config.algorithm || 'wfc';
    const symmetryXY = config.symmetryXY !== undefined
        ? !!config.symmetryXY
        : (topo.symmetryXY !== undefined ? !!topo.symmetryXY : true);
    const mergeCollinear = config.mergeCollinear !== undefined ? !!config.mergeCollinear : true;
    const pruneLeaves = config.pruneLeaves !== undefined
        ? !!config.pruneLeaves
        : (topo.pruneNonAnchorLeaves !== undefined ? !!topo.pruneNonAnchorLeaves : true);

    const maxAnchors = config.maxAnchors !== undefined ? config.maxAnchors : (sup.maxAnchors || 4);
    const minAnchors = config.minAnchors !== undefined ? config.minAnchors : (sup.minAnchors || 3);

    // 1. Run WFC / Growth + Largest Component + Anchor & Leaf Check (retry if degenerate)
    let wfcRes = null;
    let welded = null;
    let graph = null;
    let anchors = [];

    for (let attempt = 0; attempt < 16; attempt++) {
        const fallbackToCross = (attempt >= 12 && !config.enabledTiles);
        wfcRes = runWFCSolver({
            gridResolution,
            voxelSize: config.voxelSize || 1.0,
            algorithm,
            tilePreset,
            enabledTiles: fallbackToCross ? ['cross'] : config.enabledTiles,
            tileWeights: config.tileWeights,
            ruleMode: config.ruleMode || 'socket',
            wfcSeed: wfcSeed + attempt * 7,
            symmetryXY
        });
        welded = buildWeldedGraphFromVoxels(wfcRes.voxels, wfcRes.tiles, wfcRes.gridResolution, wfcRes.voxelSize, {
            weldTol: 1e-4,
            mergeCollinear
        });
        if (welded.edges.length === 0) continue;

        let candGraph = extractLargestComponent(welded.vertices, welded.edges);
        let candAnchors = selectGroundAnchors(candGraph.vertices, candGraph.edges, { maxAnchors, minAnchors });
        if (pruneLeaves) {
            const pruned = pruneNonAnchorLeaves(candGraph.vertices, candGraph.edges, candAnchors);
            if (pruned.edges.length > 0) {
                candGraph = { vertices: pruned.vertices, edges: pruned.edges, boundingBox: pruned.boundingBox };
                candAnchors = pruned.anchors;
            }
        }
        const gBB = candGraph.boundingBox;
        const zSpan = gBB.max[2] - gBB.min[2];
        graph = candGraph;
        anchors = candAnchors;
        if (candAnchors.length >= minAnchors && candGraph.edges.length >= minAnchors && zSpan > 0.2) {
            break;
        }
    }

    // 4. Solve FDM
    const requireCompressionOnly = config.requireCompressionOnly !== undefined
        ? !!config.requireCompressionOnly
        : !!fun.requireCompressionOnly;
    const requestedMode = requireCompressionOnly
        ? 'compression'
        : (config.fdmMode || pCfg.fdmMode || (fun.mode && fun.mode !== 'auto' ? fun.mode : 'compression'));
    let outerRadiusM = Number(config.outerRadiusM !== undefined ? config.outerRadiusM : (pCfg.outerRadiusM !== undefined ? pCfg.outerRadiusM : 0.035));
    let innerRadiusM = Number(config.innerRadiusM !== undefined ? config.innerRadiusM : (pCfg.innerRadiusM !== undefined ? pCfg.innerRadiusM : 0.0));
    const nSides = Math.round(config.nSides || pCfg.nSides || 8);

    const mat = brief.material || {};
    const qProfile = config.qProfile || pCfg.qProfile || 'column_boosted';
    const fdmOpts = {
        mode: requestedMode,
        anchors,
        maxAnchors,
        minAnchors,
        qBase: config.qBase !== undefined ? config.qBase : (pCfg.qBase !== undefined ? pCfg.qBase : 5.0),
        qProfile,
        columnBoost: config.columnBoost !== undefined ? config.columnBoost : (pCfg.columnBoost !== undefined ? pCfg.columnBoost : 2.5),
        anchorBoost: config.anchorBoost !== undefined ? config.anchorBoost : (pCfg.anchorBoost !== undefined ? pCfg.anchorBoost : 1.8),
        collarBoost: config.collarBoost !== undefined ? config.collarBoost : 1.0,
        topCollarBoost: config.topCollarBoost !== undefined ? config.topCollarBoost : 1.0,
        heightGradeFactor: config.heightGradeFactor !== undefined ? config.heightGradeFactor : 2.0,
        forceDensities: config.forceDensities,
        optimizeForceDensities: config.optimizeForceDensities !== undefined
            ? !!config.optimizeForceDensities
            : (qProfile === 'funicular_tuned' || requireCompressionOnly),
        optimizeIterations: config.optimizeIterations !== undefined ? config.optimizeIterations : 5,
        outerRadiusM,
        innerRadiusM,
        densityKgM3: Number(mat.densityKgM3 || 1250),
        gravityMS2: 9.81,
        loadZ: config.loadZ !== undefined ? config.loadZ : briefLoadN,
        selfWeightLoadN: config.selfWeightLoadN !== undefined ? config.selfWeightLoadN : 150.0,
        topZoneFractionZ: config.topZoneFractionZ !== undefined ? config.topZoneFractionZ : briefTopFrac,
        snapAnchorsToGround: config.snapAnchorsToGround !== undefined ? !!config.snapAnchorsToGround : (sup.mustBeOnGround !== false),
        groundZ: env.groundZ !== undefined ? env.groundZ : 0.0,
        fitEnvelope: config.fitEnvelope !== undefined ? !!config.fitEnvelope : true,
        maxPlanX: env.maxPlanX || 1.0,
        maxPlanY: env.maxPlanY || 1.0,
        planMargin: config.planMargin !== undefined ? config.planMargin : Math.max(0.04, outerRadiusM + 0.01),
        targetHeightZ: config.targetHeightZ !== undefined ? config.targetHeightZ : (env.targetHeightZ || 2.0)
    };

    let initEdges = requireCompressionOnly
        ? removeAnchorToAnchorEdges(graph.vertices, graph.edges, anchors)
        : graph.edges;
    let fdm = solveFDM(graph.vertices, initEdges, fdmOpts);

    // 4b. Weld coincident nodes, split T-junctions, merge acute forks & collapse short edges, then re-solve FDM
    const minMemberLen = config.minMemberLengthM !== undefined
        ? Number(config.minMemberLengthM)
        : Math.max(0.05, Number(acc.minMemberLengthM || fab.minMemberLengthM || 0.04) * 1.25);
    if (minMemberLen > 0 && !config.forceDensities) {
        for (let pass = 0; pass < 3; pass++) {
            const cleaned = cleanAndWeldGraph(fdm.vertices, fdm.edges, fdm.anchors, {
                outerRadiusM,
                minMemberLengthM: minMemberLen,
                // Defer T-split & acute-merge until conditionCompressionOnlyNetwork when requireCompressionOnly is active
                tSplitTol: requireCompressionOnly ? 0 : undefined,
                minIncidentAngleDeg: requireCompressionOnly ? 0 : (config.minIncidentAngleDeg !== undefined ? Number(config.minIncidentAngleDeg) : 13.0),
                removeAnchorEdges: requireCompressionOnly,
                pruneLeaves,
                maxPasses: 3
            });
            if (!cleaned.changed || cleaned.edges.length === 0) break;
            fdm = solveFDM(cleaned.vertices, cleaned.edges, Object.assign({}, fdmOpts, { anchors: cleaned.anchors }));
        }
    }

    // 4c. Strict Compression-Only Conditioning & Symmetric Tension-Tie Pruning
    let mechanicsEst = null;
    if (requireCompressionOnly && !config.forceDensities) {
        const cond = conditionCompressionOnlyNetwork(fdm, fdmOpts, brief, config);
        fdm = cond.fdm;
        mechanicsEst = cond.mechanics;

        // Optional L_max Edge-Length Equalization Pass (reduces max member length -> unlocks thinner 12mm tubes!)
        if (config.equalizeEdgeLengths && fdm.edges.length > 0) {
            const secTest = { outerRadiusM, innerRadiusM, nSides };
            let eqQ = [...fdm.forceDensities];
            let eqFdm = fdm;
            let eqEst = mechanicsEst;
            for (let eqIter = 0; eqIter < 8; eqIter++) {
                const lens = eqFdm.edgeLengths;
                const maxL = Math.max(...lens);
                const meanL = lens.reduce((s, v) => s + v, 0) / lens.length;
                if (maxL <= 0.785) break;
                const nextQ = eqQ.map((qk, idx) => {
                    const ratio = lens[idx] / Math.max(0.1, meanL);
                    return ratio > 1.02 ? qk * Math.pow(ratio, 0.32) : qk * Math.pow(ratio, 0.12);
                });
                const candFdm = solveFDM(eqFdm.vertices, eqFdm.edges, Object.assign({}, fdmOpts, {
                    anchors: eqFdm.anchors,
                    forceDensities: nextQ,
                    optimizeForceDensities: false
                }));
                const candMaxL = Math.max(...candFdm.edgeLengths);
                const candMinL = Math.min(...candFdm.edgeLengths);
                const candEst = estimateFrameMechanics(candFdm.vertices, candFdm.edges, candFdm.anchors, secTest, mat, brief.loadCases);
                if (candMinL >= minMemberLen * 0.95 && candMaxL < maxL && candEst.valid &&
                    candEst.tensileBarCount === 0 && candEst.lateralMinSF >= 1.65) {
                    eqFdm = candFdm;
                    eqEst = candEst;
                    eqQ = [...candFdm.forceDensities];
                } else {
                    break;
                }
            }
            fdm = eqFdm;
            mechanicsEst = eqEst;
        }

        // 4d. Exact 0.1 mm Minimal-Wall Slenderness & Structural Safety Guard (verified post-FDM!)
        const autoSlend = config.autoSlenderness !== undefined ? !!config.autoSlenderness : true;
        const ensureLat = config.ensureLateralSF !== undefined ? !!config.ensureLateralSF : true;
        const maxSlendLimit = Number(acc.maxSlendernessRatio || fab.maxSlendernessRatio || 120);
        const minWallM = Number(acc.minWallThicknessM || fab.minWallThicknessM || 0.006);
        const maxOuterLimitM = Number(acc.maxTubeOuterRadiusM || fab.maxTubeOuterRadiusM || 0.090);
        const maxDispLim = Number(acc.maxDeflectionMeters || 0.0033333333);

        if (autoSlend && fdm.edgeLengths.length > 0) {
            const isHollow = innerRadiusM > 1e-6;
            const wallTarget = isHollow ? Math.max(minWallM, outerRadiusM - innerRadiusM) : 0.0;
            const lockedQ = [...fdm.forceDensities];

            for (let step = 0; step < 160; step++) {
                const rI_now = isHollow ? Math.max(0, Math.round((outerRadiusM - wallTarget) * 1e4) / 1e4) : 0.0;
                const rg = 0.5 * Math.sqrt(outerRadiusM * outerRadiusM + rI_now * rI_now);
                const maxEdgeL = Math.max(...fdm.edgeLengths);
                const slendOk = (maxEdgeL / rg) <= (maxSlendLimit - 0.8);
                const secNow = { outerRadiusM, innerRadiusM: rI_now, nSides };
                mechanicsEst = estimateFrameMechanics(fdm.vertices, fdm.edges, fdm.anchors, secNow, mat, brief.loadCases);
                const strOk = mechanicsEst.valid
                    && mechanicsEst.tensileBarCount === 0
                    && mechanicsEst.maxDispM <= maxDispLim * 0.92
                    && mechanicsEst.minSF_t >= 1.65
                    && mechanicsEst.minSF_c >= 2.15
                    && mechanicsEst.minSF_b >= 2.15
                    && (!ensureLat || mechanicsEst.lateralMinSF >= 1.62);

                if (slendOk && strOk) {
                    innerRadiusM = rI_now;
                    break;
                }
                if (outerRadiusM + 0.0002 > Math.min(maxOuterLimitM, 0.028)) {
                    innerRadiusM = rI_now;
                    break;
                }
                outerRadiusM = Math.round((outerRadiusM + 0.0002) * 1e4) / 1e4;
                innerRadiusM = isHollow ? Math.max(0, Math.round((outerRadiusM - wallTarget) * 1e4) / 1e4) : 0.0;
                // Re-solve with locked force-density ratios so topology & node proportions never jump!
                fdm = solveFDM(fdm.vertices, fdm.edges, Object.assign({}, fdmOpts, {
                    anchors: fdm.anchors,
                    forceDensities: lockedQ,
                    outerRadiusM,
                    innerRadiusM,
                    optimizeForceDensities: false
                }));
            }
        }
    }

    // 5. Solidify tubular mesh with optional Longitudinal Subdivision + PQ Planarization
    const longitudinalSubdivLevels = config.longitudinalSubdivLevels !== undefined
        ? Math.max(0, Math.round(config.longitudinalSubdivLevels))
        : Math.max(0, Math.round(geom.minLongitudinalSubdivLevels || 0));
    const pqOptimization = config.pqOptimization !== undefined
        ? !!config.pqOptimization
        : !!geom.requirePQOptimization;
    const maxQuadPlanarityErrorM = config.maxQuadPlanarityErrorM !== undefined
        ? Number(config.maxQuadPlanarityErrorM)
        : (geom.maxQuadPlanarityErrorM !== undefined ? Number(geom.maxQuadPlanarityErrorM) : 0.0005);

    const solid = solidifyGraph(fdm.vertices, fdm.edges, {
        nSides,
        radius: outerRadiusM,
        endOffset: config.endOffset !== undefined ? config.endOffset : outerRadiusM * 2.2,
        stitchAtBisectors: config.stitchAtBisectors !== undefined ? !!config.stitchAtBisectors : true,
        capLeafEnds: config.capLeafEnds !== undefined ? !!config.capLeafEnds : true,
        longitudinalSubdivLevels,
        pqOptimization,
        maxQuadPlanarityErrorM
    });

    // 5b. Per-bar 2D unrolled strip patterns (.unrolled.json & .patterns.svg)
    const wantUnroll = config.unrollPatterns !== undefined
        ? !!config.unrollPatterns
        : !!fab.requireUnrolledPatternsPerBar;
    let unrolledJson = null;
    let patternsSvg = null;
    if (wantUnroll) {
        const unrolled = buildUnrolledPatterns(fdm, solid, {
            name,
            outerRadiusM,
            nSides,
            longitudinalSubdivLevels
        });
        unrolledJson = unrolled.unrolledJson;
        patternsSvg = unrolled.patternsSvg;
    }

    // 6. Build Neutral JSON & Quad OBJ
    const round8 = v => Math.round(v * 1e8) / 1e8;
    const extraBlocks = {};
    if (brief.geometry || longitudinalSubdivLevels > 0 || pqOptimization) {
        extraBlocks.geometry = {
            tubeTopology: true,
            longitudinalSubdivLevels,
            pqOptimizationApplied: pqOptimization,
            maxQuadPlanarityErrorM: round8(solid.planarity ? solid.planarity.maxQuadPlanarityErrorM : 0),
            meanQuadPlanarityErrorM: round8(solid.planarity ? solid.planarity.meanQuadPlanarityErrorM : 0),
            barTubeQuadCount: solid.barTubeQuadCount !== undefined ? solid.barTubeQuadCount : solid.quads.length
        };
    }
    if (unrolledJson) {
        extraBlocks.fabrication = {
            unrolledPatternsFile: `${name}.patterns.svg`,
            unrolledDataFile: `${name}.unrolled.json`,
            barCount: fdm.edges.length,
            unrolledBarCount: unrolledJson.bars.length,
            totalUnrolledSurfaceAreaM2: unrolledJson.totalUnrolledSurfaceAreaM2,
            hasSelfIntersection: unrolledJson.hasSelfIntersection
        };
    }

    const metadata = {
        name,
        source: 'TOPOGEN_FDM_Foundry/index_WFC.html',
        wfcSeed: wfcRes ? wfcRes.wfcSeed : wfcSeed,
        algorithm,
        gridResolution,
        tilePreset,
        symmetryXY,
        qProfile
    };
    const topologyJson = buildFoundryTopologyJSON(fdm, { outerRadiusM, innerRadiusM, nSides }, metadata, extraBlocks);
    const objText = buildQuadDominantOBJ(solid, { name });

    const bb = fdm.boundingBox;
    const secArea = Math.PI * (outerRadiusM * outerRadiusM - innerRadiusM * innerRadiusM);
    const totalLen = fdm.edgeLengths.reduce((s, l) => s + l, 0);
    const centerlineMassKg = totalLen * secArea * Number(mat.densityKgM3 || 1250);

    const metrics = {
        name,
        gridResolution,
        graphVertices: fdm.vertices.length,
        graphEdges: fdm.edges.length,
        anchors: fdm.anchors.length,
        fdmMode: fdm.mode,
        equilibriumResidual: fdm.equilibriumResidual,
        spanX: bb.max[0] - bb.min[0],
        spanY: bb.max[1] - bb.min[1],
        heightZ: bb.max[2] - bb.min[2],
        minEdgeLen: fdm.edgeLengths.length > 0 ? Math.min(...fdm.edgeLengths) : 0,
        maxEdgeLen: fdm.edgeLengths.length > 0 ? Math.max(...fdm.edgeLengths) : 0,
        centerlineMassKg: Math.round(centerlineMassKg * 1e4) / 1e4,
        meshVertices: solid.vertices.length,
        meshQuads: solid.quads.length,
        meshTriangles: solid.triangles.length,
        barTubeQuadCount: solid.barTubeQuadCount || 0,
        longitudinalSubdivLevels,
        pqOptimizationApplied: pqOptimization,
        maxQuadPlanarityErrorM: solid.planarity ? solid.planarity.maxQuadPlanarityErrorM : 0,
        manifoldValid: solid.verification.isValid,
        watertight: solid.verification.isWatertight,
        boundaryEdges: solid.verification.boundaryEdges,
        nonManifoldEdges: solid.verification.nonManifoldEdges,
        euler: solid.verification.euler,
        genus: solid.verification.genus
    };
    if (unrolledJson) {
        metrics.totalUnrolledSurfaceAreaM2 = unrolledJson.totalUnrolledSurfaceAreaM2;
        metrics.unrolledSelfIntersection = unrolledJson.hasSelfIntersection;
    }
    if (mechanicsEst && mechanicsEst.valid) {
        metrics.estTensileBars = mechanicsEst.tensileBarCount;
        metrics.estMaxAxialForceN = Math.round(mechanicsEst.maxAxialForceN * 1e3) / 1e3;
        metrics.estMaxDispMM = Math.round(mechanicsEst.maxDispM * 1e6) / 1e3;
        metrics.estMinSF_t = Math.round(mechanicsEst.minSF_t * 100) / 100;
        metrics.estMinSF_c = Math.round(mechanicsEst.minSF_c * 100) / 100;
        metrics.estMinSF_b = Math.round(mechanicsEst.minSF_b * 100) / 100;
        metrics.estLatMinSF = Math.round(mechanicsEst.lateralMinSF * 100) / 100;
    }

    return { topologyJson, objText, unrolledJson, patternsSvg, graph, fdm, solid, metrics };
}

export const WFC_FDM_CORE = {
    V3,
    toV3,
    toArr3,
    mulberry32,
    DIRS,
    TILE_NULL, TILE_CROSS, TILE_VTUBE, TILE_HTUBE, TILE_HTUBE_Y,
    TILE_XBRACE_XZ, TILE_XBRACE_YZ, TILE_DIAG_PYR, TILE_ARCH_VAULT, TILE_TRIPOD_LEG, TILE_DIAPHRAGM,
    TILE_FUNICULAR_VAULT, TILE_SLENDER_DIAGRID, TILE_HYPERBOLOID, TILE_CATENARY_QUADRIPOD,
    buildBoxArmQuads,
    buildStrutQuads,
    buildQuadsFromGraph,
    createTileTemplates,
    TILE_PRESETS,
    applyTilePresetToTiles,
    buildAdjacencyRules,
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
    cleanAndWeldGraph,
    selectGroundAnchors,
    assignForceDensities,
    solveLinearSystem,
    solveFDM,
    weldVertices,
    LOOP_PALETTE,
    computeParentColorShade,
    computeQuadPlanarity,
    computeQuadPlanarityError,
    isConvexQuad3D,
    computeMeshPlanarityStats,
    computeSignedMeshVolume,
    planarizeQuadMesh,
    walkMeshFaceLoops,
    initSolidFaceLoops,
    unrollFaceLoop2D,
    optimizeFaceLoopsToPQ,
    applyCatmullClarkToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips,
    applyRingOnlySubdivisionToPQStrips,
    mergeTrianglesToQuads,
    verifyManifold,
    computeConvexHull3D,
    computeNodeBisectorRings,
    computeEndRingBisectorStitched,
    solidifyGraphBisectorStitched,
    solidifyGraph,
    buildUnrolledPatterns,
    verifyUnrolledPatterns,
    buildUnrolledPatternsSVG,
    estimateFrameMechanics,
    analyzeSpaceFrameFEA,
    conditionCompressionOnlyNetwork,
    buildQuadDominantOBJ,
    buildFoundryTopologyJSON,
    generateCandidate,
    findValenceOneNodes,
    traceSkeletalPathsAStar,
    subdivideCatmullClark1D,
    sampleCatmullRom,
    computeElasticaMetrics,
    optimizeElasticaCurve,
    buildElasticaRodMesh,
    unrollElasticaRibbon2D,
    packElasticaRibbons2D,
    generateElasticaRibbons,
    buildElasticaRibbonsSVG
};

globalThis.WFC_FDM_CORE = WFC_FDM_CORE;

export function loadWfcCore() {
    return WFC_FDM_CORE;
}

export {
    V3,
    toV3,
    toArr3,
    mulberry32,
    DIRS,
    TILE_NULL, TILE_CROSS, TILE_VTUBE, TILE_HTUBE, TILE_HTUBE_Y,
    TILE_XBRACE_XZ, TILE_XBRACE_YZ, TILE_DIAG_PYR, TILE_ARCH_VAULT, TILE_TRIPOD_LEG, TILE_DIAPHRAGM,
    TILE_FUNICULAR_VAULT, TILE_SLENDER_DIAGRID, TILE_HYPERBOLOID, TILE_CATENARY_QUADRIPOD,
    buildBoxArmQuads,
    buildStrutQuads,
    buildQuadsFromGraph,
    createTileTemplates,
    TILE_PRESETS,
    applyTilePresetToTiles,
    buildAdjacencyRules,
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
    cleanAndWeldGraph,
    selectGroundAnchors,
    assignForceDensities,
    solveLinearSystem,
    solveFDM,
    weldVertices,
    LOOP_PALETTE,
    computeParentColorShade,
    computeQuadPlanarity,
    computeQuadPlanarityError,
    isConvexQuad3D,
    computeMeshPlanarityStats,
    computeSignedMeshVolume,
    planarizeQuadMesh,
    walkMeshFaceLoops,
    initSolidFaceLoops,
    unrollFaceLoop2D,
    optimizeFaceLoopsToPQ,
    applyCatmullClarkToPQStrips,
    applyLongitudinalOnlySubdivisionToPQStrips,
    applyRingOnlySubdivisionToPQStrips,
    mergeTrianglesToQuads,
    verifyManifold,
    computeConvexHull3D,
    computeNodeBisectorRings,
    computeEndRingBisectorStitched,
    solidifyGraphBisectorStitched,
    solidifyGraph,
    buildUnrolledPatterns,
    verifyUnrolledPatterns,
    buildUnrolledPatternsSVG,
    estimateFrameMechanics,
    analyzeSpaceFrameFEA,
    conditionCompressionOnlyNetwork,
    buildQuadDominantOBJ,
    buildFoundryTopologyJSON,
    generateCandidate,
    findValenceOneNodes,
    traceSkeletalPathsAStar,
    subdivideCatmullClark1D,
    sampleCatmullRom,
    computeElasticaMetrics,
    optimizeElasticaCurve,
    buildElasticaRodMesh,
    unrollElasticaRibbon2D,
    packElasticaRibbons2D,
    generateElasticaRibbons,
    buildElasticaRibbonsSVG
};

export default WFC_FDM_CORE;

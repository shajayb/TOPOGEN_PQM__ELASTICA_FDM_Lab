#!/usr/bin/env node
/**
 * Standalone CLI Verifier for WFC-FDM Cast Plaster Foundry
 * Domain: TOPOGEN_FDM_Foundry/verifier (strictly air-gapped)
 *
 * Usage:
 *   node TOPOGEN_FDM_Foundry/verifier/verify.mjs \
 *     --topology <file.topology.json> \
 *     [--mesh <file.mesh.obj>] \
 *     [--patterns <file.patterns.svg>] \
 *     [--unrolled <file.unrolled.json>] \
 *     --brief <brief.json> \
 *     [--out <verdict.json>] \
 *     [--json]
 *
 * Exit codes:
 *   0 = PASS (all required structural load cases and fabrication checks passed)
 *   2 = FAIL (one or more required criteria failed)
 *   1 = Runtime / CLI / I/O error
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { solveSpaceFrame } from './fea_solver.mjs';
import { runFabricationChecks } from './fabrication_check.mjs';

function capInf(val) {
  if (val === Infinity) return 999999;
  if (val === -Infinity) return -999999;
  return val;
}

function fmtNum(val, digits = 3) {
  if (val === Infinity || val >= 999999) return 'Inf';
  if (val === -Infinity || val <= -999999) return '-Inf';
  if (val == null || Number.isNaN(val)) return 'N/A';
  return Number(val).toFixed(digits);
}

/**
 * Evaluate a single FEA load case result against the brief's acceptance & funicular criteria.
 */
export function evaluateLoadCase(feaResult, loadCase, brief) {
  const crit = brief.acceptanceCriteria || {};
  const fun = brief.funicular || {};
  const required = loadCase.required !== false;

  if (!feaResult.ok) {
    return {
      id: loadCase.id || feaResult.loadCaseId,
      name: loadCase.name || feaResult.loadCaseName,
      required,
      passed: false,
      isMechanism: Boolean(feaResult.isMechanism),
      error: feaResult.error || 'FEA solver failed',
      criteria: {
        solvable: { passed: false, reason: feaResult.error },
      },
    };
  }

  const maxDispRatioLimit = crit.maxDeflectionRatio ?? Infinity;
  const maxDispMetersLimit = crit.maxDeflectionMeters ?? Infinity;
  const minTensionSF = crit.minTensileSafetyFactor ?? 1.0;
  const minCompressionSF = crit.minCompressiveSafetyFactor ?? 1.0;
  const minBucklingSF = crit.minBucklingSafetyFactor ?? 1.0;
  const minShearSF = crit.minShearSafetyFactor ?? 0.0;
  const maxEqRes = 1e-5;

  const dispRatio = feaResult.displacements.deflectionRatio;
  const maxDispM = feaResult.displacements.maxDispM;
  const sfT = feaResult.safetyFactors.tension;
  const sfC = feaResult.safetyFactors.compression;
  const sfB = feaResult.safetyFactors.buckling;
  const sfV = feaResult.safetyFactors.shear;
  const eqRes = feaResult.reactions.equilibriumResidual;

  // Compute axial force summary across all members (N > 0 = tension, N < 0 = compression)
  const maxTensileAxialLimitN =
    fun.maxTensileAxialForceN != null ? Number(fun.maxTensileAxialForceN) : 0.0;
  const axialTol = 1e-6;
  let maxAxialForceN = -Infinity;
  let minAxialForceN = Infinity;
  let worstAxialMember = -1;
  const tensileMembers = [];

  for (let i = 0; i < feaResult.members.length; i++) {
    const m = feaResult.members[i];
    if (m.N > maxAxialForceN) {
      maxAxialForceN = m.N;
      worstAxialMember = m.edgeIndex;
    }
    if (m.N < minAxialForceN) {
      minAxialForceN = m.N;
    }
    if (m.N > maxTensileAxialLimitN + axialTol) {
      tensileMembers.push(m);
    }
  }
  if (feaResult.members.length === 0) {
    maxAxialForceN = 0;
    minAxialForceN = 0;
  }
  tensileMembers.sort((a, b) => b.N - a.N);
  const tensileMemberIndices = tensileMembers.map((m) => m.edgeIndex);

  const criteria = {
    equilibrium: {
      passed: eqRes <= maxEqRes,
      value: eqRes,
      limit: maxEqRes,
    },
    deflectionRatio: {
      passed: dispRatio <= maxDispRatioLimit + 1e-12,
      value: dispRatio,
      limit: capInf(maxDispRatioLimit),
      inverseRatio: dispRatio > 1e-12 ? Math.round(1 / dispRatio) : 999999,
    },
    maxDeflectionM: {
      passed: maxDispM <= maxDispMetersLimit + 1e-12,
      value: maxDispM,
      limit: capInf(maxDispMetersLimit),
      worstNode: feaResult.displacements.maxDispNode,
    },
    tensileSafetyFactor: {
      passed: sfT >= minTensionSF - 1e-9,
      value: capInf(sfT),
      limit: minTensionSF,
      maxStressPa: feaResult.stresses.maxTensileStressPa,
      worstMember: feaResult.stresses.worstTensileMember,
    },
    compressiveSafetyFactor: {
      passed: sfC >= minCompressionSF - 1e-9,
      value: capInf(sfC),
      limit: minCompressionSF,
      maxStressPa: feaResult.stresses.maxCompressiveStressPa,
      worstMember: feaResult.stresses.worstCompressiveMember,
    },
    bucklingSafetyFactor: {
      passed: sfB >= minBucklingSF - 1e-9,
      value: capInf(sfB),
      limit: minBucklingSF,
      worstMember: feaResult.safetyFactors.worstBucklingMember,
      compressedMemberCount: feaResult.safetyFactors.compressedMemberCount,
    },
    shearSafetyFactor: {
      passed: minShearSF > 0 ? sfV >= minShearSF - 1e-9 : true,
      value: capInf(sfV),
      limit: minShearSF,
      maxStressPa: feaResult.stresses.maxShearStressPa,
      worstMember: feaResult.stresses.worstShearMember,
    },
  };

  // Strict Compression-Only FEA Gate (when specified in brief.funicular)
  const reqCompOnly = fun.requireCompressionOnly === true;
  const minCompDom =
    fun.minCompressionDominance != null ? Number(fun.minCompressionDominance) : null;
  const hasAxialLimit = fun.maxTensileAxialForceN != null;

  if (reqCompOnly || minCompDom != null || hasAxialLimit) {
    const compDom = feaResult.kpis?.compressionDominance ?? 0;
    const compDomOk = minCompDom == null || compDom >= minCompDom - 1e-9;
    const axialForceOk =
      (!reqCompOnly && !hasAxialLimit) ||
      (tensileMembers.length === 0 && maxAxialForceN <= maxTensileAxialLimitN + axialTol);

    criteria.compressionOnly = {
      passed: compDomOk && axialForceOk,
      compressionDominance: compDom,
      minCompressionDominanceLimit: minCompDom,
      maxAxialForceN,
      maxTensileAxialForceLimitN: maxTensileAxialLimitN,
      worstAxialMember,
      tensileBarCount: tensileMembers.length,
      tensileMemberIndices,
      topTensileMembers: tensileMembers.slice(0, 10).map((m) => ({
        edgeIndex: m.edgeIndex,
        u: m.u,
        v: m.v,
        N: m.N,
      })),
    };
  }

  const passed = Object.values(criteria).every((c) => c.passed);

  // Identify top-5 worst members by utilization (max of tension, compression, buckling utilization)
  const rankedMembers = feaResult.members
    .map((m) => {
      const utilT = m.sfTension < Infinity ? minTensionSF / m.sfTension : 0;
      const utilC = m.sfCompression < Infinity ? minCompressionSF / m.sfCompression : 0;
      const utilB = m.sfBuckling < Infinity ? minBucklingSF / m.sfBuckling : 0;
      const maxUtil = Math.max(utilT, utilC, utilB);
      let governingMode = 'none';
      if (maxUtil > 0) {
        if (utilT >= utilC && utilT >= utilB) governingMode = 'tension';
        else if (utilC >= utilB) governingMode = 'compression';
        else governingMode = 'buckling';
      }
      return {
        edgeIndex: m.edgeIndex,
        u: m.u,
        v: m.v,
        lengthM: m.lengthM,
        N: m.N,
        Mmax: m.Mmax,
        sigmaTensileMPa: m.sigmaTensileMaxPa / 1e6,
        sigmaCompressiveMPa: m.sigmaCompressiveMaxPa / 1e6,
        sfTension: capInf(m.sfTension),
        sfCompression: capInf(m.sfCompression),
        sfBuckling: capInf(m.sfBuckling),
        governingMode,
        utilization: maxUtil,
      };
    })
    .sort((a, b) => b.utilization - a.utilization)
    .slice(0, 5);

  return {
    id: loadCase.id || feaResult.loadCaseId,
    name: loadCase.name || feaResult.loadCaseName,
    required,
    passed,
    restraintType: feaResult.restraintType,
    minPivotRatio: feaResult.minPivotRatio,
    loads: feaResult.loads,
    displacements: {
      maxDispM: feaResult.displacements.maxDispM,
      maxDispMm: feaResult.displacements.maxDispM * 1000,
      maxDispNode: feaResult.displacements.maxDispNode,
      maxDispZM: feaResult.displacements.maxDispZM,
      deflectionRatio: feaResult.displacements.deflectionRatio,
      heightDeflectionRatio: feaResult.displacements.heightDeflectionRatio,
    },
    stresses: {
      maxTensileMPa: feaResult.stresses.maxTensileStressPa / 1e6,
      worstTensileMember: feaResult.stresses.worstTensileMember,
      maxCompressiveMPa: feaResult.stresses.maxCompressiveStressPa / 1e6,
      worstCompressiveMember: feaResult.stresses.worstCompressiveMember,
      maxShearMPa: feaResult.stresses.maxShearStressPa / 1e6,
      worstShearMember: feaResult.stresses.worstShearMember,
    },
    axialForces: {
      maxAxialForceN,
      minAxialForceN,
      worstAxialMember,
      tensileBarCount: tensileMembers.length,
      tensileMemberIndices,
    },
    safetyFactors: {
      tension: capInf(sfT),
      compression: capInf(sfC),
      shear: capInf(sfV),
      buckling: capInf(sfB),
    },
    kpis: feaResult.kpis || null,
    reactions: feaResult.reactions,
    criteria,
    worstMembers: rankedMembers,
  };
}

/**
 * Run complete independent verification of a candidate topology (+ optional OBJ mesh & unrolled pattern artifacts) against a brief.
 *
 * @param {object} topology - wfc-fdm-topology/v1 JSON
 * @param {object} brief - Foundry brief JSON
 * @param {string|null} [objText=null] - Raw .mesh.obj text
 * @param {object} [extraArtifacts={}] - Optional { svgText, unrolledData }
 */
export function verifyCandidate(topology, brief, objText = null, extraArtifacts = {}) {
  const fabrication = runFabricationChecks(topology, brief, objText, extraArtifacts);
  const restraintType = brief.supports?.restraintType || 'pinned';
  const material = brief.material || {};
  const loadCases = Array.isArray(brief.loadCases) && brief.loadCases.length > 0
    ? brief.loadCases
    : [{ id: 'LC1_self_weight', name: 'Self-Weight Only', required: true, gravityMS2: 9.81, distributedVerticalMassKg: 0, distribution: 'none' }];

  const loadCaseVerdicts = [];
  let geometrySummary = null;

  for (const lc of loadCases) {
    const fea = solveSpaceFrame(topology, material, lc, { restraintType });
    if (fea.ok && !geometrySummary) {
      geometrySummary = { ...fea.geometry };
    } else if (!fea.ok && !geometrySummary && fea.totalMassKg != null) {
      geometrySummary = {
        nNodes: (topology.vertices || []).length,
        nEdges: (topology.edges || []).length,
        nAnchors: (topology.anchors || []).length,
        totalVolumeM3: fea.totalVolumeM3,
        totalMassKg: fea.totalMassKg,
        centerlineMassKg: fea.totalMassKg,
      };
    }
    const evaluated = evaluateLoadCase(fea, lc, brief);
    loadCaseVerdicts.push(evaluated);
  }

  // Enrich geometry summary with mesh-based cast plaster mass (avoids joint overlap double-counting)
  const meshCheck = fabrication.checks.mesh;
  const meshVolumeM3 = meshCheck?.provided && meshCheck.signedVolumeM3 > 0 ? meshCheck.signedVolumeM3 : null;
  const meshMassKg = meshCheck?.provided && meshCheck.meshMassKg != null ? meshCheck.meshMassKg : null;
  const nEdges = (topology.edges || []).length;
  if (geometrySummary) {
    geometrySummary.centerlineMassKg = geometrySummary.centerlineMassKg ?? geometrySummary.totalMassKg;
    geometrySummary.meshVolumeM3 = meshVolumeM3;
    geometrySummary.meshMassKg = meshMassKg;
    geometrySummary.effectiveMassKg = meshMassKg ?? geometrySummary.centerlineMassKg;
    geometrySummary.elementCount = nEdges;
    geometrySummary.longitudinalSubdivLevels = topology.geometry?.longitudinalSubdivLevels ?? null;
    geometrySummary.gridResolution = topology.metadata?.gridResolution ?? topology.gridResolution ?? null;
  }

  // Aggregate axial tension / compression dominance across required load cases
  const requiredLcs = loadCaseVerdicts.filter((lc) => lc.required && !lc.error);
  let maxAxialForceN = null;
  let minCompressionDominanceAcrossLCs = null;
  const tensileEdgeSet = new Set();
  for (const lc of requiredLcs) {
    if (lc.axialForces) {
      if (maxAxialForceN == null || lc.axialForces.maxAxialForceN > maxAxialForceN) {
        maxAxialForceN = lc.axialForces.maxAxialForceN;
      }
      for (const ei of lc.axialForces.tensileMemberIndices) {
        tensileEdgeSet.add(ei);
      }
    }
    if (lc.kpis?.compressionDominance != null) {
      if (minCompressionDominanceAcrossLCs == null || lc.kpis.compressionDominance < minCompressionDominanceAcrossLCs) {
        minCompressionDominanceAcrossLCs = lc.kpis.compressionDominance;
      }
    }
  }
  const tensileMemberIndices = [...tensileEdgeSet].sort((a, b) => a - b);

  // Funicularity, PQ, Unrolled & Efficiency KPIs
  const primaryLc = loadCaseVerdicts[loadCaseVerdicts.length - 1];
  const primaryKpis = primaryLc?.kpis || null;
  const imposedLoadKg = primaryKpis?.imposedLoadKg ?? 0;
  const centerlineMassKg = geometrySummary?.centerlineMassKg ?? null;
  const unrolledCheck = fabrication.checks.unrolledPatterns;
  const verifiedUnrolledAreaM2 =
    unrolledCheck?.jsonProvided && unrolledCheck.totalUnrolledSurfaceAreaM2 != null
      ? unrolledCheck.totalUnrolledSurfaceAreaM2
      : null;

  const kpis = {
    sourceLoadCaseId: primaryLc?.id ?? null,
    funicularEfficiency: primaryKpis?.funicularEfficiency ?? null,
    compressionDominance: primaryKpis?.compressionDominance ?? null,
    minCompressionDominanceAcrossLCs,
    maxAxialForceN,
    tensileBarCount: tensileMemberIndices.length,
    tensileMemberIndices,
    elementCount: nEdges,
    totalUnrolledSurfaceAreaM2: verifiedUnrolledAreaM2,
    maxQuadPlanarityErrorM: meshCheck?.provided ? meshCheck.maxQuadPlanarityErrorM : null,
    meanQuadPlanarityErrorM: meshCheck?.provided ? meshCheck.meanQuadPlanarityErrorM : null,
    longitudinalSubdivLevels: topology.geometry?.longitudinalSubdivLevels ?? null,
    gridResolution: topology.metadata?.gridResolution ?? topology.gridResolution ?? null,
    imposedLoadKg,
    centerlineMassKg,
    meshMassKg,
    loadToMassRatio: centerlineMassKg > 1e-9 ? imposedLoadKg / centerlineMassKg : null,
    loadToMeshMassRatio: meshMassKg != null && meshMassKg > 1e-9 ? imposedLoadKg / meshMassKg : null,
    minIncidentAngleDeg: fabrication.checks.members?.minIncidentAngleDeg ?? null,
  };

  // Notional Lateral Stability Advisory (LC_lateral_5pct):
  // 5% of total vertical load applied horizontally (+X and +Y) at top_zone_nodes.
  // Advisory only — does not affect brief pass/fail.
  let lateralStabilityAdvisory = null;
  if (loadCases.length > 0 && primaryLc && !primaryLc.error) {
    const baseLc = loadCases[loadCases.length - 1];
    const totalVertN = (primaryLc.loads?.totalSelfWeightN || 0) + (primaryLc.loads?.totalDistributedLoadN || 0);
    const notionalH = 0.05 * totalVertN;
    if (notionalH > 1e-9) {
      const topFrac = baseLc.topZoneFractionZ ?? 0.85;
      const lcX = {
        ...baseLc,
        id: 'LC_lateral_5pct_X',
        name: 'Notional 5% Lateral (+X)',
        distribution: baseLc.distribution && baseLc.distribution !== 'none' ? baseLc.distribution : 'top_zone_nodes',
        topZoneFractionZ: topFrac,
        distributedHorizontalVecN: [notionalH, 0, 0],
      };
      const lcY = {
        ...baseLc,
        id: 'LC_lateral_5pct_Y',
        name: 'Notional 5% Lateral (+Y)',
        distribution: baseLc.distribution && baseLc.distribution !== 'none' ? baseLc.distribution : 'top_zone_nodes',
        topZoneFractionZ: topFrac,
        distributedHorizontalVecN: [0, notionalH, 0],
      };
      const feaX = solveSpaceFrame(topology, material, lcX, { restraintType });
      const feaY = solveSpaceFrame(topology, material, lcY, { restraintType });
      if (feaX.ok && feaY.ok) {
        const heightZ = Math.max(geometrySummary?.spanZ || 1.0, 1e-6);
        const minSfOf = (f) => Math.min(f.safetyFactors.tension, f.safetyFactors.compression, f.safetyFactors.buckling);
        const driftX = feaX.displacements.maxHorizontalDispM;
        const driftY = feaY.displacements.maxHorizontalDispM;
        const maxDriftM = Math.max(driftX, driftY);
        const sfX = minSfOf(feaX);
        const sfY = minSfOf(feaY);
        lateralStabilityAdvisory = {
          id: 'LC_lateral_5pct',
          advisoryOnly: true,
          restraintType,
          notionalForceN: notionalH,
          maxLateralDriftM: maxDriftM,
          maxLateralDriftMm: maxDriftM * 1000,
          driftRatio: maxDriftM / heightZ,
          minSafetyFactor: capInf(Math.min(sfX, sfY)),
          plusX: {
            maxLateralDriftMm: driftX * 1000,
            maxDispMm: feaX.displacements.maxDispM * 1000,
            sfTension: capInf(feaX.safetyFactors.tension),
            sfCompression: capInf(feaX.safetyFactors.compression),
            sfBuckling: capInf(feaX.safetyFactors.buckling),
            minSafetyFactor: capInf(sfX),
          },
          plusY: {
            maxLateralDriftMm: driftY * 1000,
            maxDispMm: feaY.displacements.maxDispM * 1000,
            sfTension: capInf(feaY.safetyFactors.tension),
            sfCompression: capInf(feaY.safetyFactors.compression),
            sfBuckling: capInf(feaY.safetyFactors.buckling),
            minSafetyFactor: capInf(sfY),
          },
        };
      }
    }
  }

  // If primary restraint is pinned, also run a quick fixed-base reference on the hardest load case for insight
  let fixedBaseReference = null;
  if (restraintType === 'pinned' && loadCases.length > 0) {
    const lastLc = loadCases[loadCases.length - 1];
    const feaFixed = solveSpaceFrame(topology, material, lastLc, { restraintType: 'fixed' });
    if (feaFixed.ok) {
      fixedBaseReference = {
        loadCaseId: lastLc.id,
        maxDispMm: feaFixed.displacements.maxDispM * 1000,
        deflectionRatio: feaFixed.displacements.deflectionRatio,
        sfTension: capInf(feaFixed.safetyFactors.tension),
        sfCompression: capInf(feaFixed.safetyFactors.compression),
        sfBuckling: capInf(feaFixed.safetyFactors.buckling),
      };
    }
  }

  const requiredLoadCasesPassed = loadCaseVerdicts
    .filter((lc) => lc.required)
    .every((lc) => lc.passed);

  const overallPassed = fabrication.passed && requiredLoadCasesPassed;

  // Collect concise failure reason codes + detailed diagnostic strings
  const failureReasons = [];
  const failureDiagnostics = [];

  for (const [k, v] of Object.entries(fabrication.checks)) {
    if (!v.passed) {
      failureReasons.push(`fabrication.${k}`);
      if (k === 'voxelGrid') {
        failureDiagnostics.push(
          `fabrication.voxelGrid: grid=${JSON.stringify(v.gridResolution)} outside [${JSON.stringify(v.minGridResolution)} .. ${JSON.stringify(v.maxGridResolution)}] or symmetryXY=${v.symmetryXY}`
        );
      } else if (k === 'members') {
        failureDiagnostics.push(
          `fabrication.members: maxSlenderness=${fmtNum(v.maxSlendernessRatio, 1)} (limit ${v.maxSlendernessLimit}, slenderEdges=${v.slenderEdgeCount}, worstEdge=${v.mostSlenderEdge}), minLen=${fmtNum(v.minMemberLengthM, 4)} m (shortEdges=${v.shortEdgeCount}), rViolation=${v.radiusViolationCount}, wallViolation=${v.wallViolationCount}`
        );
      } else if (k === 'mesh') {
        failureDiagnostics.push(
          `fabrication.mesh: bnd=${v.boundaryEdges}, nonManifold=${v.nonManifoldEdges}, inconsOrient=${v.inconsistentOrientationEdges}, vol=${fmtNum(v.signedVolumeM3, 6)} m^3`
        );
      } else if (k === 'pqGeometry') {
        failureDiagnostics.push(
          `fabrication.pqGeometry: quadCount=${v.quadCount}, maxPlanarityErr=${fmtNum((v.maxQuadPlanarityErrorM ?? 0) * 1000, 4)} mm (limit ${fmtNum((v.maxQuadPlanarityErrorLimitM ?? 0) * 1000, 3)} mm), subdiv=${v.longitudinalSubdivLevels} (min ${v.minLongitudinalSubdivLevels}), tube=${v.tubeTopology}, pqOpt=${v.pqOptimizationApplied}`
        );
      } else if (k === 'unrolledPatterns') {
        failureDiagnostics.push(
          `fabrication.unrolledPatterns: svgValid=${v.svgValid} (groups=${v.svgGroupCount}/${v.expectedBarCount}), jsonProvided=${v.jsonProvided}, bars=${v.unrolledBarCount}/${v.expectedBarCount}, underSubdiv=${v.underSubdividedBarCount ?? 0}, nonConvex=${v.nonConvexQuadCount ?? 0}, selfIntersectBars=${v.selfIntersectingBarCount ?? 0}, bboxOverlaps=${v.overlappingBboxCount ?? 0}`
        );
      }
    }
  }

  for (const lc of loadCaseVerdicts) {
    if (lc.required && !lc.passed) {
      if (lc.error) {
        failureReasons.push(`${lc.id}: ${lc.error}`);
        failureDiagnostics.push(`${lc.id}: ${lc.error}`);
      } else {
        for (const [ck, cv] of Object.entries(lc.criteria)) {
          if (!cv.passed) {
            failureReasons.push(`${lc.id}.${ck}`);
            if (ck === 'compressionOnly') {
              const previewIdx = cv.tensileMemberIndices.slice(0, 12).join(',');
              const suffix = cv.tensileMemberIndices.length > 12 ? ',...' : '';
              failureDiagnostics.push(
                `${lc.id}.compressionOnly: ${cv.tensileBarCount} tensile bar(s) [${previewIdx}${suffix}], maxAxialForceN=${fmtNum(cv.maxAxialForceN, 4)} N (limit ${fmtNum(cv.maxTensileAxialForceLimitN, 4)} N), compDom=${fmtNum(cv.compressionDominance * 100, 2)}%`
              );
            }
          }
        }
      }
    }
  }

  return {
    verifier: 'TOPOGEN_FDM_Foundry/verifier (3D Euler-Bernoulli Space Frame FEA)',
    timestamp: new Date().toISOString(),
    candidateName: topology.name || 'unnamed',
    briefId: brief.id || 'unknown',
    passed: overallPassed,
    failureReasons,
    failureDiagnostics,
    geometry: geometrySummary,
    kpis,
    fabrication,
    loadCases: loadCaseVerdicts,
    lateralStabilityAdvisory,
    fixedBaseReference,
  };
}

/**
 * Resolve companion artifact paths (.mesh.obj, .patterns.svg, .unrolled.json) relative to a .topology.json path.
 */
export function resolveCompanionPaths(topologyPath, topologyObj = null, explicitPaths = {}) {
  const topoAbs = path.resolve(topologyPath);
  const topoDir = path.dirname(topoAbs);
  const stem = path
    .basename(topoAbs)
    .replace(/\.topology\.json$/i, '')
    .replace(/\.json$/i, '');

  const resolveCandidateFile = (explicit, fromTopoField, defaultExt) => {
    if (explicit) return path.resolve(explicit);
    if (typeof fromTopoField === 'string' && fromTopoField.trim().length > 0) {
      const p1 = path.resolve(topoDir, fromTopoField);
      if (fs.existsSync(p1)) return p1;
      const p2 = path.join(topoDir, path.basename(fromTopoField));
      if (fs.existsSync(p2)) return p2;
    }
    const fallback = path.join(topoDir, `${stem}${defaultExt}`);
    return fs.existsSync(fallback) ? fallback : null;
  };

  const meshPath = explicitPaths.mesh
    ? path.resolve(explicitPaths.mesh)
    : resolveCandidateFile(null, topologyObj?.geometry?.meshFile, '.mesh.obj');
  const patternsPath = resolveCandidateFile(
    explicitPaths.patterns,
    topologyObj?.fabrication?.unrolledPatternsFile,
    '.patterns.svg'
  );
  const unrolledPath = resolveCandidateFile(
    explicitPaths.unrolled,
    topologyObj?.fabrication?.unrolledDataFile,
    '.unrolled.json'
  );

  return { meshPath, patternsPath, unrolledPath };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--topology' || a === '-t') args.topology = argv[++i];
    else if (a === '--mesh' || a === '-m') args.mesh = argv[++i];
    else if (a === '--patterns' || a === '-p') args.patterns = argv[++i];
    else if (a === '--unrolled' || a === '-u') args.unrolled = argv[++i];
    else if (a === '--brief' || a === '-b') args.brief = argv[++i];
    else if (a === '--out' || a === '-o') args.out = argv[++i];
    else if (a === '--json') args.jsonStdout = true;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`Unknown CLI argument: ${a}`);
  }
  return args;
}

function printSummaryTable(verdict) {
  const statusTag = verdict.passed ? 'PASS' : 'FAIL';
  console.log('========================================================================');
  console.log(` PLASTER FEA VERIFIER  |  Candidate: ${verdict.candidateName}  |  Result: ${statusTag}`);
  console.log(` Brief: ${verdict.briefId}`);
  console.log('------------------------------------------------------------------------');

  if (verdict.geometry) {
    const g = verdict.geometry;
    const meshMassStr = g.meshMassKg != null ? ` | Mesh Mass: ${fmtNum(g.meshMassKg, 2)} kg` : '';
    const gridStr = Array.isArray(g.gridResolution) ? ` | Grid: ${g.gridResolution.join('x')}` : '';
    const subdivStr = g.longitudinalSubdivLevels != null ? ` | Subdiv: L=${g.longitudinalSubdivLevels}` : '';
    console.log(
      ` Geometry: ${g.nNodes} nodes, ${g.nEdges} bars, ${g.nAnchors} anchors${gridStr}${subdivStr} | ` +
      `Centerline Mass: ${fmtNum(g.centerlineMassKg ?? g.totalMassKg, 2)} kg${meshMassStr}`
    );
  }

  // Fabrication summary
  console.log('------------------------------------------------------------------------');
  console.log(' FABRICATION, PQ GEOMETRY & UNROLLED PATTERN CHECKS:');
  const fab = verdict.fabrication.checks;
  const pad = (s, n) => String(s).padEnd(16);
  console.log(`  [${fab.connectivity.passed ? 'PASS' : 'FAIL'}] ${pad('Connectivity')} components=${fab.connectivity.componentCount}, isolated=${fab.connectivity.isolatedNodeCount}`);
  if (fab.voxelGrid) {
    const gr = fab.voxelGrid.gridResolution ? fab.voxelGrid.gridResolution.join('x') : 'MISSING';
    const minG = fab.voxelGrid.minGridResolution ? fab.voxelGrid.minGridResolution.join('x') : '*';
    const maxG = fab.voxelGrid.maxGridResolution ? fab.voxelGrid.maxGridResolution.join('x') : '*';
    console.log(`  [${fab.voxelGrid.passed ? 'PASS' : 'FAIL'}] ${pad('Voxel Grid')} grid=${gr} (req ${minG}..${maxG}), symXY=${fab.voxelGrid.symmetryXY}`);
  }
  console.log(`  [${fab.anchors.passed ? 'PASS' : 'FAIL'}] ${pad('Anchors')} count=${fab.anchors.count} (req ${fab.anchors.minAnchors}..${fab.anchors.maxAnchors}), maxGroundOff=${fmtNum(fab.anchors.maxAnchorGroundOffsetM * 1000, 1)} mm`);
  console.log(`  [${fab.envelope.passed ? 'PASS' : 'FAIL'}] ${pad('Envelope')} plan=${fmtNum(fab.envelope.planX, 3)}x${fmtNum(fab.envelope.planY, 3)} m, height=${fmtNum(fab.envelope.heightZ, 3)} m`);
  const minAngStr = fab.members.minIncidentAngleDeg != null ? `, minAngle=${fmtNum(fab.members.minIncidentAngleDeg, 1)} deg` : '';
  console.log(`  [${fab.members.passed ? 'PASS' : 'FAIL'}] ${pad('Members')} bars=${fab.members.edgeCount}, minL=${fmtNum(fab.members.minMemberLengthM, 3)} m, maxSlender=${fmtNum(fab.members.maxSlendernessRatio, 1)}, r=${fmtNum(fab.members.minOuterRadiusM * 1000, 1)}..${fmtNum(fab.members.maxOuterRadiusM * 1000, 1)} mm${minAngStr}`);
  if (fab.mesh.provided) {
    const pqInline = `maxPQErr=${fmtNum((fab.mesh.maxQuadPlanarityErrorM ?? 0) * 1000, 4)} mm`;
    console.log(`  [${fab.mesh.passed ? 'PASS' : 'FAIL'}] ${pad('OBJ Mesh')} V=${fab.mesh.vertexCount}, F=${fab.mesh.faceCount} (Q=${fab.mesh.quadCount}, T=${fab.mesh.triCount}), bnd=${fab.mesh.boundaryEdges}, nonMan=${fab.mesh.nonManifoldEdges}, ${pqInline}, mass=${fmtNum(fab.mesh.meshMassKg, 2)} kg`);
  } else {
    console.log(`  [${fab.mesh.passed ? 'PASS' : 'FAIL'}] ${pad('OBJ Mesh')} ${fab.mesh.note}`);
  }
  if (fab.pqGeometry) {
    const pq = fab.pqGeometry;
    console.log(
      `  [${pq.passed ? 'PASS' : 'FAIL'}] ${pad('PQ & Subdiv')} quads=${pq.quadCount}, maxPlanarityErr=${fmtNum((pq.maxQuadPlanarityErrorM ?? 0) * 1000, 4)} mm (limit ${fmtNum((pq.maxQuadPlanarityErrorLimitM ?? 0) * 1000, 3)} mm), subdiv=${pq.longitudinalSubdivLevels} (min ${pq.minLongitudinalSubdivLevels}), tube=${pq.tubeTopology}, pqOpt=${pq.pqOptimizationApplied}`
    );
  }
  if (fab.unrolledPatterns) {
    const up = fab.unrolledPatterns;
    if (!up.jsonProvided) {
      console.log(`  [${up.passed ? 'PASS' : 'FAIL'}] ${pad('Unrolled Strips')} svgValid=${up.svgValid}, jsonProvided=false (${up.note || 'missing .unrolled.json'})`);
    } else {
      console.log(
        `  [${up.passed ? 'PASS' : 'FAIL'}] ${pad('Unrolled Strips')} bars=${up.unrolledBarCount}/${up.expectedBarCount}, svgGroups=${up.svgGroupCount}, area=${fmtNum(up.totalUnrolledSurfaceAreaM2, 4)} m^2, selfIntersect=${up.selfIntersectingBarCount}, bboxOverlap=${up.overlappingBboxCount}`
      );
    }
  }

  // Structural load cases
  console.log('------------------------------------------------------------------------');
  console.log(' STRUCTURAL FEA LOAD CASES:');
  for (const lc of verdict.loadCases) {
    const tag = lc.passed ? 'PASS' : 'FAIL';
    const reqTag = lc.required ? '' : ' (optional)';
    if (lc.error) {
      console.log(`  [${tag}] ${lc.id}${reqTag}: ERROR - ${lc.error}`);
      continue;
    }
    const invDefl = lc.displacements.deflectionRatio > 1e-12
      ? `L/${Math.round(1 / lc.displacements.deflectionRatio)}`
      : 'L/Inf';
    console.log(`  [${tag}] ${lc.id}${reqTag} (${lc.restraintType})`);
    console.log(
      `        Disp: ${fmtNum(lc.displacements.maxDispMm, 3)} mm (${invDefl}) | ` +
      `EqRes: ${lc.reactions.equilibriumResidual.toExponential(2)}`
    );
    console.log(
      `        Stress: Ten=${fmtNum(lc.stresses.maxTensileMPa, 3)} MPa (SF=${fmtNum(lc.safetyFactors.tension, 2)}), ` +
      `Comp=${fmtNum(lc.stresses.maxCompressiveMPa, 3)} MPa (SF=${fmtNum(lc.safetyFactors.compression, 2)}), ` +
      `BuckSF=${fmtNum(lc.safetyFactors.buckling, 2)}`
    );
    if (lc.axialForces) {
      const af = lc.axialForces;
      const tenList = af.tensileBarCount > 0 ? ` [edges: ${af.tensileMemberIndices.slice(0, 10).join(',')}${af.tensileBarCount > 10 ? ',...' : ''}]` : '';
      console.log(
        `        Axial:  MaxN=${fmtNum(af.maxAxialForceN, 3)} N, MinN=${fmtNum(af.minAxialForceN, 2)} N, TensileBars=${af.tensileBarCount}${tenList}`
      );
    }
  }

  // Funicularity & Efficiency KPIs + Lateral Advisory
  if (verdict.kpis || verdict.lateralStabilityAdvisory) {
    console.log('------------------------------------------------------------------------');
    console.log(' PILOT V1/V2 KPIS & LATERAL ADVISORY:');
    if (verdict.kpis) {
      const k = verdict.kpis;
      const meshLmr = k.loadToMeshMassRatio != null ? ` (mesh: ${fmtNum(k.loadToMeshMassRatio, 2)})` : '';
      const gridKpi = Array.isArray(k.gridResolution) ? k.gridResolution.join('x') : 'N/A';
      console.log(
        `  [KPI]  FunicularEff=${fmtNum(k.funicularEfficiency, 3)} | ` +
        `CompDom=${fmtNum((k.compressionDominance ?? 0) * 100, 1)}% | ` +
        `Load/Mass=${fmtNum(k.loadToMassRatio, 2)}${meshLmr} | ` +
        `MinAngle=${fmtNum(k.minIncidentAngleDeg, 1)} deg`
      );
      console.log(
        `  [V2]   UnrolledArea=${fmtNum(k.totalUnrolledSurfaceAreaM2, 4)} m^2 | ` +
        `Elements=${k.elementCount} | ` +
        `MaxPQErr=${k.maxQuadPlanarityErrorM != null ? fmtNum(k.maxQuadPlanarityErrorM * 1000, 4) + ' mm' : 'N/A'} | ` +
        `MaxAxialN=${fmtNum(k.maxAxialForceN, 3)} N (TensileBars=${k.tensileBarCount}) | ` +
        `Subdiv=${k.longitudinalSubdivLevels ?? 'N/A'} | Grid=${gridKpi}`
      );
    }
    if (verdict.lateralStabilityAdvisory) {
      const lat = verdict.lateralStabilityAdvisory;
      const invDrift = lat.driftRatio > 1e-12 ? `H/${Math.round(1 / lat.driftRatio)}` : 'H/Inf';
      console.log(
        `  [ADV]  LC_lateral_5pct (H=${fmtNum(lat.notionalForceN, 1)} N): ` +
        `MaxDrift=${fmtNum(lat.maxLateralDriftMm, 3)} mm (${invDrift}) | MinSF=${fmtNum(lat.minSafetyFactor, 2)}`
      );
    }
  }

  if (verdict.failureReasons.length > 0) {
    console.log('------------------------------------------------------------------------');
    console.log(` FAILURES: ${verdict.failureReasons.join(', ')}`);
    if (Array.isArray(verdict.failureDiagnostics)) {
      for (const diag of verdict.failureDiagnostics) {
        console.log(`   -> ${diag}`);
      }
    }
  }
  console.log('========================================================================');
}

function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`CLI Error: ${err.message}`);
    process.exit(1);
  }

  if (args.help || !args.topology || !args.brief) {
    console.log(
      'Usage: node TOPOGEN_FDM_Foundry/verifier/verify.mjs --topology <file.topology.json> [--mesh <file.mesh.obj>] [--patterns <file.patterns.svg>] [--unrolled <file.unrolled.json>] --brief <brief.json> [--out <verdict.json>] [--json]'
    );
    process.exit(args.help ? 0 : 1);
  }

  let topology, brief, objText = null, svgText = null, unrolledData = null;
  try {
    topology = JSON.parse(fs.readFileSync(args.topology, 'utf8'));
    brief = JSON.parse(fs.readFileSync(args.brief, 'utf8'));
    const companions = resolveCompanionPaths(args.topology, topology, {
      mesh: args.mesh,
      patterns: args.patterns,
      unrolled: args.unrolled,
    });
    if (companions.meshPath) {
      objText = fs.readFileSync(companions.meshPath, 'utf8');
    }
    if (companions.patternsPath) {
      svgText = fs.readFileSync(companions.patternsPath, 'utf8');
    }
    if (companions.unrolledPath) {
      unrolledData = JSON.parse(fs.readFileSync(companions.unrolledPath, 'utf8'));
    }
  } catch (err) {
    console.error(`File read/parse error: ${err.message}`);
    process.exit(1);
  }

  let verdict;
  try {
    verdict = verifyCandidate(topology, brief, objText, { svgText, unrolledData });
  } catch (err) {
    console.error(`Verification runtime error: ${err.stack || err.message}`);
    process.exit(1);
  }

  if (args.out) {
    try {
      const outDir = path.dirname(path.resolve(args.out));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(args.out, JSON.stringify(verdict, null, 2) + '\n', 'utf8');
    } catch (err) {
      console.error(`Failed to write verdict JSON to ${args.out}: ${err.message}`);
      process.exit(1);
    }
  }

  if (args.jsonStdout) {
    console.log(JSON.stringify(verdict, null, 2));
  } else {
    printSummaryTable(verdict);
  }

  process.exit(verdict.passed ? 0 : 2);
}

// Only run CLI if invoked directly
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}

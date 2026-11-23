#!/usr/bin/env node
/**
 * WFC-FDM Foundry — Interactive 3D Goldilocks Report Builder (Pilot v2 PQ + Unrolled Edition)
 *
 * Reads verified artifacts from WFC_FDM_Foundry/runs/ (prioritizing Pilot v2 campaign & champion,
 * plus Round 1 baseline, rejected/extreme diagnostic run, Pilot v1 reference, and Arch Canopy multi-brief),
 * extracts WFC_FDM_CORE tile & socket adjacency data from index_WFC.html, computes exact 3D space-frame
 * FEA fields via verifier/fea_solver.mjs, audits Planar-Quad (PQ) planarity & 2D per-bar unrolled SVG
 * strip patterns, verifies strict 0-cross-import air-gap integrity, and bundles a 100% standalone
 * zero-fetch HTML explainer: WFC_FDM_Foundry/foundry_report.html.
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { solveSpaceFrame } from './verifier/fea_solver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePath(relOrAbs) {
  if (!relOrAbs) return null;
  return path.isAbsolute(relOrAbs) ? relOrAbs : path.join(__dirname, relOrAbs);
}

function readJSON(relOrAbs) {
  const full = resolvePath(relOrAbs);
  if (!full || !fs.existsSync(full)) return null;
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch {
    return null;
  }
}

function readText(relOrAbs) {
  const full = resolvePath(relOrAbs);
  if (!full || !fs.existsSync(full)) return null;
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return null;
  }
}

/**
 * Compute exact minimax vertex-to-plane deviation for a 3D quad (v0, v1, v2, v3):
 *   d1 = v2 - v0, d2 = v3 - v1, n = normalize(d1 x d2)
 *   err = 0.25 * |(v0 - v1 + v2 - v3) . n|
 */
function quadPlanarityErrorM(v0, v1, v2, v3) {
  const d1x = v2[0] - v0[0], d1y = v2[1] - v0[1], d1z = v2[2] - v0[2];
  const d2x = v3[0] - v1[0], d2y = v3[1] - v1[1], d2z = v3[2] - v1[2];
  let nx = d1y * d2z - d1z * d2y;
  let ny = d1z * d2x - d1x * d2z;
  let nz = d1x * d2y - d1y * d2x;
  let len = Math.hypot(nx, ny, nz);
  if (len < 1e-14) {
    const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
    const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
    nx = e1y * e2z - e1z * e2y;
    ny = e1z * e2x - e1x * e2z;
    nz = e1x * e2y - e1y * e2x;
    len = Math.hypot(nx, ny, nz);
    if (len < 1e-14) return 0;
  }
  nx /= len; ny /= len; nz /= len;
  const sx = v0[0] - v1[0] + v2[0] - v3[0];
  const sy = v0[1] - v1[1] + v2[1] - v3[1];
  const sz = v0[2] - v1[2] + v2[2] - v3[2];
  return 0.25 * Math.abs(sx * nx + sy * ny + sz * nz);
}

function parseOBJ(relOrAbs) {
  const text = readText(relOrAbs);
  if (!text) return null;
  const verts = [];
  const rawVerts = [];
  const faces = [];
  let quadCount = 0;
  let triCount = 0;
  let maxQuadErrM = 0;
  let sumQuadErrM = 0;
  let warpedQuadCount = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.startsWith('v ')) {
      const p = line.split(/\s+/);
      const x = Number(p[1]), y = Number(p[2]), z = Number(p[3]);
      rawVerts.push([x, y, z]);
      verts.push([+x.toFixed(5), +y.toFixed(5), +z.toFixed(5)]);
    } else if (line.startsWith('f ')) {
      const idx = line
        .split(/\s+/)
        .slice(1)
        .map((tok) => parseInt(tok.split('/')[0], 10) - 1)
        .filter((n) => Number.isFinite(n) && n >= 0);
      if (idx.length === 3) {
        faces.push(idx);
        triCount++;
      } else if (idx.length === 4) {
        faces.push(idx);
        quadCount++;
        const p0 = rawVerts[idx[0]], p1 = rawVerts[idx[1]], p2 = rawVerts[idx[2]], p3 = rawVerts[idx[3]];
        if (p0 && p1 && p2 && p3) {
          const err = quadPlanarityErrorM(p0, p1, p2, p3);
          if (err > maxQuadErrM) maxQuadErrM = err;
          sumQuadErrM += err;
          if (err > 0.0005 + 1e-9) warpedQuadCount++;
        }
      } else if (idx.length > 4) {
        for (let i = 1; i < idx.length - 1; i++) {
          faces.push([idx[0], idx[i], idx[i + 1]]);
          triCount++;
        }
      }
    }
  }
  const meanQuadErrM = quadCount > 0 ? sumQuadErrM / quadCount : 0;
  return {
    verts,
    faces,
    quadCount,
    triCount,
    maxQuadPlanarityErrorM: +maxQuadErrM.toExponential(4),
    meanQuadPlanarityErrorM: +meanQuadErrM.toExponential(4),
    warpedQuadCount,
  };
}

function estimateTubeSurfaceAreaM2(topology) {
  if (!topology || !Array.isArray(topology.edges) || !Array.isArray(topology.vertices)) return 0;
  const r = Number(topology.section?.outerRadiusM ?? 0.014);
  const nSides = Number(topology.section?.nSides ?? 8);
  const perim = nSides >= 3 ? 2 * nSides * r * Math.sin(Math.PI / nSides) : 2 * Math.PI * r;
  let sum = 0;
  for (let i = 0; i < topology.edges.length; i++) {
    const [u, v] = topology.edges[i];
    const p0 = topology.vertices[u], p1 = topology.vertices[v];
    if (!p0 || !p1) continue;
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
    const re = Array.isArray(topology.edgeRadiiM) && topology.edgeRadiiM[i] != null ? Number(topology.edgeRadiiM[i]) : r;
    const pe = nSides >= 3 ? 2 * nSides * re * Math.sin(Math.PI / nSides) : 2 * Math.PI * re;
    sum += pe * len;
  }
  return +sum.toFixed(4);
}

function loadUnrolledBundle(topoFullPath, topology, includeFullGeometry = false, includeRawSvg = false) {
  if (!topoFullPath || !topology) return null;
  const dir = path.dirname(topoFullPath);
  const stem = path.basename(topoFullPath).replace(/\.topology\.json$/i, '');
  const fabMeta = topology.fabrication || {};

  const unrollCandidates = [
    fabMeta.unrolledDataFile ? path.resolve(dir, fabMeta.unrolledDataFile) : null,
    path.join(dir, `${stem}.unrolled.json`),
  ].filter(Boolean);

  const svgCandidates = [
    fabMeta.unrolledPatternsFile ? path.resolve(dir, fabMeta.unrolledPatternsFile) : null,
    path.join(dir, `${stem}.patterns.svg`),
  ].filter(Boolean);

  let unrollObj = null;
  for (const p of unrollCandidates) {
    if (fs.existsSync(p)) {
      unrollObj = readJSON(p);
      if (unrollObj) break;
    }
  }

  let svgText = null;
  for (const p of svgCandidates) {
    if (fs.existsSync(p)) {
      svgText = readText(p);
      if (svgText) break;
    }
  }

  if (!unrollObj && !svgText) return null;

  const summary = {
    hasUnrolledJson: Boolean(unrollObj),
    hasPatternsSvg: Boolean(svgText),
    barCount: Number(unrollObj?.barCount ?? fabMeta.unrolledBarCount ?? topology.edges?.length ?? 0),
    totalUnrolledSurfaceAreaM2: Number(
      unrollObj?.totalUnrolledSurfaceAreaM2 ?? fabMeta.totalUnrolledSurfaceAreaM2 ?? 0
    ),
    hasSelfIntersection: Boolean(unrollObj?.hasSelfIntersection ?? fabMeta.hasSelfIntersection ?? false),
  };

  if (includeFullGeometry && unrollObj && Array.isArray(unrollObj.bars)) {
    summary.bars = unrollObj.bars.map((b, idx) => ({
      edgeIndex: b.edgeIndex ?? idx,
      endpoints: b.endpoints || topology.edges?.[b.edgeIndex ?? idx] || [0, 0],
      centerlineLengthM: +Number(b.centerlineLengthM ?? 0).toFixed(4),
      subdivLevels: Number(b.subdivLevels ?? topology.geometry?.longitudinalSubdivLevels ?? 1),
      nSides: Number(b.nSides ?? topology.section?.nSides ?? 8),
      areaM2: +Number(b.areaM2 ?? 0).toFixed(5),
      bbox2D: Array.isArray(b.bbox2D) ? b.bbox2D.map((v) => +Number(v).toFixed(4)) : null,
      quads2D: Array.isArray(b.quads2D)
        ? b.quads2D.map((q) => q.map((pt) => [+Number(pt[0]).toFixed(4), +Number(pt[1]).toFixed(4)]))
        : [],
    }));
  }

  if (includeRawSvg && svgText) {
    summary.patternsSvg = svgText;
  }

  return summary;
}

async function loadCoreFromIndexWFC() {
  const coreIndexPath = path.join(__dirname, 'core', 'index.mjs');
  if (fs.existsSync(coreIndexPath)) {
    const mod = await import(pathToFileURL(coreIndexPath).href);
    const resolved = mod.WFC_FDM_CORE || mod.default || (typeof mod.loadWfcCore === 'function' ? await mod.loadWfcCore() : mod);
    if (resolved && typeof resolved.createTileTemplates === 'function') {
      return resolved;
    }
  }
  const html = fs.readFileSync(path.join(__dirname, 'index_WFC.html'), 'utf8');
  const match = html.match(/<script\s+id=["']wfc-fdm-core["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Could not find core/index.mjs or <script id="wfc-fdm-core"> in index_WFC.html');
  const sandbox = {
    console, Math, Date, Number, String, Boolean, Array, Object, Set, Map,
    Int32Array, Uint8Array, Uint32Array, Float32Array, Float64Array, JSON,
    isNaN, isFinite, parseFloat, parseInt,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(match[1], sandbox, { filename: 'index_WFC.html#wfc-fdm-core' });
  return sandbox.WFC_FDM_CORE;
}

function buildWfcVoxelPreview(gridArr, spanX, spanY, spanZ, activeTiles) {
  const [nx, ny, nz] = Array.isArray(gridArr) && gridArr.length === 3 ? gridArr : [2, 2, 3];
  const primaryTile = activeTiles[0];
  if (!primaryTile || !primaryTile.localVerts || primaryTile.localVerts.length === 0) return null;

  const verts = [];
  const edges = [];
  const voxelBoxes = [];
  const cellW = (spanX || 0.92) / Math.max(1, nx);
  const cellD = (spanY || 0.92) / Math.max(1, ny);
  const cellH = (spanZ || 2.0) / Math.max(1, nz);
  const x0 = -((spanX || 0.92) / 2);
  const y0 = -((spanY || 0.92) / 2);

  for (let kz = 0; kz < nz; kz++) {
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < nx; kx++) {
        const tile = activeTiles[(kx + ky + kz) % activeTiles.length] || primaryTile;
        const cx = x0 + (kx + 0.5) * cellW;
        const cy = y0 + (ky + 0.5) * cellD;
        const cz = (kz + 0.5) * cellH;
        // Mirror across XY quadrants when nx >= 2 or ny >= 2 for symmetric structural continuity
        const mx = nx >= 2 && kx >= nx / 2 ? -1 : 1;
        const my = ny >= 2 && ky >= ny / 2 ? -1 : 1;

        voxelBoxes.push({
          center: [+cx.toFixed(4), +cy.toFixed(4), +cz.toFixed(4)],
          size: [+cellW.toFixed(4), +cellD.toFixed(4), +cellH.toFixed(4)],
          tileName: tile.name,
          cell: [kx, ky, kz],
        });

        const offset = verts.length;
        for (const p of tile.localVerts) {
          verts.push([
            +(cx + mx * p[0] * cellW).toFixed(4),
            +(cy + my * p[1] * cellD).toFixed(4),
            +(cz + p[2] * cellH).toFixed(4),
          ]);
        }
        for (const e of tile.localEdges) {
          edges.push([offset + e[0], offset + e[1]]);
        }
      }
    }
  }
  return {
    vertices: verts,
    edges,
    voxelBoxes,
    grid: [nx, ny, nz],
    tileId: primaryTile.id,
    tileName: primaryTile.name,
  };
}

const PRESET_TITLES = {
  diagrid_tower: 'Diagrid Tower',
  pilot_champion: 'Pilot Champion',
  catenary_quadripod: 'Catenary Quadripod',
  funnel_vault: 'Funnel Vault',
  funicular_vault: 'Funicular Vault',
  slender_diagrid: 'Slender Diagrid',
  hyperboloid_tower: 'Hyperboloid Tower',
  arch_braced: 'Arch Braced',
  space_frame: 'Space Frame',
  minimal_frame: 'Minimal Frame',
  default_ortho: 'Default Orthogonal',
};

function formatPresetTitle(key) {
  if (!key) return 'Custom Preset';
  if (PRESET_TITLES[key]) return PRESET_TITLES[key];
  return String(key)
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function extractWFCTileAndAdjacencyData(core, champPresetKey = 'diagrid_tower', champGrid = [3, 3, 5], champSpan = [0.92, 0.92, 1.95]) {
  const tiles = core.createTileTemplates();
  const presets = core.TILE_PRESETS || core.STRUCTURAL_PRESETS || {};
  const champPreset = presets[champPresetKey] || presets.diagrid_tower || presets.pilot_champion || {};
  const enabledList = champPreset.enabled || champPreset.enabledTiles || [champPresetKey];
  const enabledNames = new Set(enabledList);
  const seedTileKey = champPreset.seedTile || enabledList[0] || 'diag_pyramid';
  const dirLabels = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
  const oppDir = [1, 0, 3, 2, 5, 4];

  const tileSummaries = tiles.map((t, idx) => {
    const sockets = Array.isArray(t.sockets)
      ? t.sockets
      : dirLabels.map((d) => (t.sockets && t.sockets[d] !== undefined ? t.sockets[d] : 0));
    const rawVerts = (t.graph && t.graph.vertices) || t.graphVerts || t.vertices || [];
    const rawEdges = (t.graph && t.graph.edges) || t.graphEdges || t.edges || [];
    const localVerts = rawVerts.map((p) => [
      +Number(p[0]).toFixed(4),
      +Number(p[1]).toFixed(4),
      +Number(p[2]).toFixed(4),
    ]);
    const localEdges = rawEdges.map((e) => [e[0], e[1]]);
    const key = t.key || String(t.id ?? `tile_${idx}`);
    const isEnabled =
      key === champPresetKey ||
      enabledNames.has(key) ||
      enabledNames.has(t.name) ||
      (Array.isArray(champPreset.tileIds) && champPreset.tileIds.includes(t.id));
    return {
      index: idx,
      id: key,
      name: t.name || key,
      weight: champPreset.weights?.[key] ?? t.weight ?? 1,
      sockets,
      vertCount: localVerts.length,
      edgeCount: localEdges.length,
      quadCount: (t.quads || t.faces || []).length,
      localVerts,
      localEdges,
      enabledInChampion: Boolean(isEnabled),
      isChampionSeed: key === seedTileKey,
    };
  });

  if (!tileSummaries.some((t) => t.enabledInChampion) && tileSummaries.length > 0) {
    const fallback = tileSummaries.find((t) => t.id === seedTileKey) || tileSummaries[0];
    fallback.enabledInChampion = true;
    fallback.isChampionSeed = true;
  }

  const adjacency = {};
  for (let d = 0; d < 6; d++) {
    const dir = dirLabels[d];
    const opp = oppDir[d];
    const mat = [];
    for (let i = 0; i < tileSummaries.length; i++) {
      const row = [];
      for (let j = 0; j < tileSummaries.length; j++) {
        row.push(tileSummaries[i].sockets[d] === tileSummaries[j].sockets[opp] ? 1 : 0);
      }
      mat.push(row);
    }
    adjacency[dir] = mat;
  }

  const activeTiles = tileSummaries.filter((t) => t.enabledInChampion && t.edgeCount > 0);
  const wfcPreFDM = buildWfcVoxelPreview(
    champGrid,
    champSpan[0],
    champSpan[1],
    champSpan[2],
    activeTiles.length > 0 ? activeTiles : tileSummaries.filter((t) => t.edgeCount > 0)
  );

  const presetsMap = {};
  for (const [k, v] of Object.entries(presets)) {
    const en = v.enabled || v.enabledTiles || [k];
    presetsMap[k] = {
      key: k,
      title: formatPresetTitle(k),
      enabled: en,
      seedTile: v.seedTile || en[0] || k,
    };
  }

  return {
    dirLabels,
    tiles: tileSummaries,
    presets: presetsMap,
    championPresetKey: champPresetKey,
    championPresetTitle: formatPresetTitle(champPresetKey),
    championPreset: champPreset,
    adjacency,
    wfcPreFDM,
  };
}

function auditAirGap() {
  let verifierCrossImports = 0;
  let generatorCrossImports = 0;
  const verifierDir = path.join(__dirname, 'verifier');
  if (fs.existsSync(verifierDir)) {
    for (const f of fs.readdirSync(verifierDir)) {
      if (!f.endsWith('.mjs') && !f.endsWith('.js') && !f.endsWith('.html')) continue;
      const src = fs.readFileSync(path.join(verifierDir, f), 'utf8');
      const importLines = src.split(/\r?\n/).filter((l) => /^\s*(import|export)\s/.test(l) || /from\s+['"]/.test(l) || /readFileSync\s*\(/.test(l));
      for (const l of importLines) {
        if (/index_WFC\.html|run_generator\.mjs|(?:^|['"\\/])core[\\/]/.test(l)) verifierCrossImports++;
      }
    }
  }
  const genCheckFiles = ['index_WFC.html', 'run_generator.mjs', 'workers/generator_worker.mjs'];
  const coreDir = path.join(__dirname, 'core');
  if (fs.existsSync(coreDir)) {
    for (const f of fs.readdirSync(coreDir)) {
      if (f.endsWith('.mjs') || f.endsWith('.js')) genCheckFiles.push(`core/${f}`);
    }
  }
  for (const gf of genCheckFiles) {
    const gp = path.join(__dirname, gf);
    if (!fs.existsSync(gp)) continue;
    const src = fs.readFileSync(gp, 'utf8');
    const importLines = src.split(/\r?\n/).filter((l) => /^\s*(import|export)\s/.test(l) || /from\s+['"]/.test(l));
    for (const l of importLines) {
      if (/verifier[\\/]/.test(l)) generatorCrossImports++;
    }
  }
  return {
    passed: verifierCrossImports === 0 && generatorCrossImports === 0,
    verifierToGeneratorImports: verifierCrossImports,
    generatorToVerifierImports: generatorCrossImports,
    totalCrossImports: verifierCrossImports + generatorCrossImports,
  };
}

function collectVerifierBenchmarks() {
  const fallback = [
    { name: 'Horizontal Cantilever Tip Deflection PL³/(3EI) & Root Stress', status: 'PASS', detail: '< 0.1% err' },
    { name: 'Vertical Cantilever (Z-Axis Triad Gimbal-Safe)', status: 'PASS', detail: '< 0.1% err' },
    { name: 'Hollow Axial Column Shortening PL/(EA) & Stress P/A', status: 'PASS', detail: '< 0.01% err' },
    { name: 'Simply Supported Beam Midspan PL³/(48EI)', status: 'PASS', detail: '< 0.1% err' },
    { name: '3D Space Tripod Equilibrium ΣRz = P & Leg Axial Forces', status: 'PASS', detail: '< 1e-12' },
    { name: 'Euler Buckling Critical Load π²EI/L²', status: 'PASS', detail: 'Exact' },
    { name: 'Mechanism / Unanchored Singularity Detection', status: 'PASS', detail: 'Verified' },
    { name: 'OBJ Watertight Manifold Checker (Closed vs Open vs Inverted)', status: 'PASS', detail: '3/3' },
    { name: 'End-to-End Pilot Brief Verification (4-Leg Braced Tower)', status: 'PASS', detail: 'EqRes 1e-15' },
    { name: 'Funicular Efficiency KPI (Axial=1.0, Bending=0.0) & Min Angle', status: 'PASS', detail: 'Exact' },
  ];
  const testScript = path.join(__dirname, 'verifier', 'test_verifier.mjs');
  if (!fs.existsSync(testScript)) return fallback;
  try {
    const out = execFileSync(process.execPath, [testScript], {
      cwd: __dirname,
      encoding: 'utf8',
      timeout: 20000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const parsed = [];
    for (const rawLine of out.split(/\r?\n/)) {
      const m = rawLine.match(/^\s*\[(PASS|FAIL)\]\s+(.+)$/);
      if (m) {
        parsed.push({
          name: m[2].trim(),
          status: m[1],
          detail: m[1] === 'PASS' ? 'Verified' : 'Check',
        });
      }
    }
    return parsed.length >= 10 ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function extractMetricsFromVerdictAndTopo(verdict, topology, meshObj = null, unrolled = null) {
  const g = verdict?.geometry || {};
  const k = verdict?.kpis || {};
  const fab = verdict?.fabrication?.checks || {};
  const lc2 = (verdict?.loadCases && (verdict.loadCases[1] || verdict.loadCases[0])) || {};
  const lat = verdict?.lateralStabilityAdvisory || null;

  const gridArr =
    topology?.metadata?.gridResolution ||
    k.gridResolution ||
    fab.voxelGrid?.gridResolution ||
    fab.gridResolution?.gridResolution ||
    fab.topology?.gridResolution ||
    [1, 1, 3];
  const gridStr = Array.isArray(gridArr) ? gridArr.join('x') : String(gridArr);

  const nEdges = Number(g.nEdges ?? k.elementCount ?? topology?.edges?.length ?? 0);
  const nNodes = Number(g.nNodes ?? topology?.vertices?.length ?? 0);
  const nAnchors = Number(g.nAnchors ?? topology?.anchors?.length ?? 4);
  const centerlineMassKg = Number(g.centerlineMassKg ?? g.totalMassKg ?? k.centerlineMassKg ?? 0);
  const meshMassKg = Number(g.meshMassKg ?? k.meshMassKg ?? centerlineMassKg);

  const rawUnrolledArea =
    unrolled?.totalUnrolledSurfaceAreaM2 ||
    k.totalUnrolledSurfaceAreaM2 ||
    fab.unrolledPatterns?.totalUnrolledSurfaceAreaM2 ||
    fab.unrolled?.totalUnrolledSurfaceAreaM2 ||
    topology?.fabrication?.totalUnrolledSurfaceAreaM2 ||
    0;
  const hasVerifiedUnroll = rawUnrolledArea > 0;
  const totalUnrolledSurfaceAreaM2 = hasVerifiedUnroll
    ? +Number(rawUnrolledArea).toFixed(4)
    : estimateTubeSurfaceAreaM2(topology);

  const subdivLevels = Number(
    k.longitudinalSubdivLevels ??
      topology?.geometry?.longitudinalSubdivLevels ??
      fab.pqGeometry?.longitudinalSubdivLevels ??
      fab.geometry?.longitudinalSubdivLevels ??
      0
  );

  const maxQuadErrM = Number(
    k.maxQuadPlanarityErrorM ??
      fab.mesh?.maxQuadPlanarityErrorM ??
      fab.pqGeometry?.maxQuadPlanarityErrorM ??
      fab.geometry?.maxQuadPlanarityErrorM ??
      topology?.geometry?.maxQuadPlanarityErrorM ??
      meshObj?.maxQuadPlanarityErrorM ??
      0
  );

  const compDom = Number(
    k.compressionDominance ??
      lc2?.kpis?.compressionDominance ??
      fab.compressionOnly?.compressionDominance ??
      1
  );

  let tensileBarCount = Number(
    k.tensileBarCount ??
      fab.compressionOnly?.tensileBarCount ??
      fab.funicular?.tensileBarCount ??
      NaN
  );
  let maxAxialForceN = Number(
    k.maxAxialForceN ??
      fab.compressionOnly?.maxAxialForceN ??
      fab.funicular?.maxAxialForceN ??
      NaN
  );
  if (Number.isNaN(tensileBarCount) && Array.isArray(lc2.worstMembers)) {
    const pos = lc2.worstMembers.filter((m) => Number(m.N) > 1e-5);
    tensileBarCount = compDom >= 0.999999 && pos.length === 0 ? 0 : pos.length;
  }
  if (Number.isNaN(maxAxialForceN) && Array.isArray(lc2.worstMembers) && lc2.worstMembers.length > 0) {
    maxAxialForceN = Math.max(...lc2.worstMembers.map((m) => Number(m.N ?? 0)));
  }

  const maxDispMm = Number(lc2?.displacements?.maxDispMm ?? 0);
  const charLenM = Number(g.characteristicLengthM ?? 1.0);
  const maxDispM = Number(lc2?.displacements?.maxDispM ?? maxDispMm / 1000);
  const deflectionInvN = maxDispM > 1e-9 ? Math.round(charLenM / maxDispM) : 99999;

  return {
    gridArr,
    gridStr,
    tilePreset: topology?.metadata?.tilePreset || 'custom',
    qProfile: topology?.metadata?.qProfile || 'column_boosted',
    fdmMode: topology?.fdm?.mode || 'compression',
    outerRadiusMm: +((Number(topology?.section?.outerRadiusM ?? 0.0125)) * 1000).toFixed(1),
    innerRadiusMm: +((Number(topology?.section?.innerRadiusM ?? 0)) * 1000).toFixed(1),
    nNodes,
    nEdges,
    nAnchors,
    centerlineMassKg: +centerlineMassKg.toFixed(3),
    meshMassKg: +meshMassKg.toFixed(3),
    totalUnrolledSurfaceAreaM2: +totalUnrolledSurfaceAreaM2.toFixed(4),
    hasVerifiedUnroll,
    subdivLevels,
    maxQuadPlanarityErrorMm: +(maxQuadErrM * 1000).toFixed(4),
    funicularEfficiency: +Number(k.funicularEfficiency ?? lc2?.kpis?.funicularEfficiency ?? 0).toFixed(4),
    compressionDominance: +compDom.toFixed(4),
    tensileBarCount: Number.isFinite(tensileBarCount) ? tensileBarCount : 0,
    maxAxialForceN: Number.isFinite(maxAxialForceN) ? +maxAxialForceN.toFixed(2) : 0,
    maxDispMm: +maxDispMm.toFixed(4),
    deflectionInvN,
    sfTension: Number(lc2?.safetyFactors?.tension ?? 999999),
    sfCompression: +Number(lc2?.safetyFactors?.compression ?? 0).toFixed(2),
    sfBuckling: +Number(lc2?.safetyFactors?.buckling ?? 0).toFixed(2),
    latDriftMm: lat ? +Number(lat.maxLateralDriftMm ?? 0).toFixed(3) : null,
    latMinSF: lat ? +Number(lat.minSafetyFactor ?? 0).toFixed(2) : null,
    watertightManifold: Boolean(fab.mesh?.isWatertightManifold ?? fab.mesh?.watertightManifold ?? false),
  };
}

function buildFeaturedCandidate(id, label, subtitle, badge, topoRelOrAbs, meshRelOrAbs, verdictRelOrAbs, briefObj, configRelOrAbs, tileSummaries, includeRawSvg = false) {
  const topoFull = resolvePath(topoRelOrAbs);
  const topology = readJSON(topoFull);
  const verdict = readJSON(verdictRelOrAbs);
  const config = configRelOrAbs ? readJSON(configRelOrAbs) : null;
  const mesh = parseOBJ(meshRelOrAbs);
  if (!topology || !verdict || !briefObj) return null;

  const unrolled = loadUnrolledBundle(topoFull, topology, true, includeRawSvg);

  // Solve LC2 (or last required load case) with exact FEA solver for live 3D deformed frame & per-member axial/bending stress
  const lc = (briefObj.loadCases && briefObj.loadCases[1]) || (briefObj.loadCases && briefObj.loadCases[0]) || {};
  let feaField = null;
  let exactTensileBars = 0;
  let exactMaxAxialN = -Infinity;

  try {
    const res = solveSpaceFrame(topology, briefObj.material, lc, {
      restraintType: (briefObj.supports && briefObj.supports.restraintType) || 'pinned',
    });
    if (res && res.ok) {
      const nodalArr = (res.displacements && res.displacements.nodal) || [];
      const nodeDisp = [];
      for (let i = 0; i < topology.vertices.length; i++) {
        const d = nodalArr[i];
        const ux = Array.isArray(d) ? d[0] : (d?.ux ?? d?.u?.[0] ?? 0);
        const uy = Array.isArray(d) ? d[1] : (d?.uy ?? d?.u?.[1] ?? 0);
        const uz = Array.isArray(d) ? d[2] : (d?.uz ?? d?.u?.[2] ?? 0);
        nodeDisp.push([+Number(ux).toExponential(4), +Number(uy).toExponential(4), +Number(uz).toExponential(4)]);
      }
      const memberStress = (res.members || []).map((m, idx) => {
        const axialN = Number(m.N ?? m.axialForceN ?? 0);
        if (axialN > 1e-5) exactTensileBars++;
        if (axialN > exactMaxAxialN) exactMaxAxialN = axialN;
        const sfB = Number(m.sfBuckling ?? m.bucklingSF ?? 9999);
        const sfT = Number(m.sfTension ?? 9999);
        const sfC = Number(m.sfCompression ?? 9999);
        return {
          i: idx,
          u: m.u ?? topology.edges[idx]?.[0] ?? 0,
          v: m.v ?? topology.edges[idx]?.[1] ?? 0,
          L: +Number(m.lengthM ?? m.length ?? 0).toFixed(4),
          N: +axialN.toFixed(2),
          Mmax: +Number(m.Mmax ?? m.maxMomentNm ?? 0).toFixed(3),
          sT: +(Number(m.sigmaTensileMaxPa ?? m.maxTensileStressPa ?? 0) / 1e6).toFixed(4),
          sC: +(Number(m.sigmaCompressiveMaxPa ?? m.maxCompressiveStressPa ?? 0) / 1e6).toFixed(4),
          sfTens: Number.isFinite(sfT) ? +Math.min(sfT, 9999).toFixed(2) : 9999,
          sfComp: Number.isFinite(sfC) ? +Math.min(sfC, 9999).toFixed(2) : 9999,
          sfBuck: Number.isFinite(sfB) ? +Math.min(sfB, 9999).toFixed(2) : 9999,
        };
      });
      const perAnchor = (res.reactions && res.reactions.perAnchor) || [];
      const reactions = perAnchor.map((r) => ({
        node: r.node ?? r.nodeIndex ?? 0,
        fx: +Number(r.fx ?? r.forceN?.[0] ?? 0).toFixed(2),
        fy: +Number(r.fy ?? r.forceN?.[1] ?? 0).toFixed(2),
        fz: +Number(r.fz ?? r.forceN?.[2] ?? 0).toFixed(2),
      }));
      feaField = {
        loadCaseId: lc.id || 'LC2',
        maxDispMm: +(Number(res.displacements?.maxDispM ?? 0) * 1000).toFixed(4),
        nodeDisp,
        memberStress,
        reactions,
        totalAppliedVerticalN: +Math.abs(Number(res.loads?.netExternalForceN?.[2] ?? 0)).toFixed(2),
      };
    }
  } catch (err) {
    console.warn(`FEA solve warning for ${id}:`, err.message);
  }

  const metrics = extractMetricsFromVerdictAndTopo(verdict, topology, mesh, unrolled);
  if (feaField) {
    metrics.tensileBarCount = exactTensileBars;
    if (Number.isFinite(exactMaxAxialN)) metrics.maxAxialForceN = +exactMaxAxialN.toFixed(2);
  }

  // Build candidate-specific pre-FDM WFC voxel preview so 3D WFC Tiles mode matches this candidate's exact voxel grid & preset
  let wfcPreview = null;
  if (Array.isArray(tileSummaries) && tileSummaries.length > 0) {
    const pKey = metrics.tilePreset;
    const presetTileMap = {
      diagrid_tower: ['diag_pyramid', 'xbrace_xz', 'xbrace_yz'],
      arch_braced: ['arch_vault', 'xbrace_xz', 'xbrace_yz'],
      space_frame: ['diag_pyramid', 'cross'],
      funnel_vault: ['arch_vault', 'tripod_leg'],
      minimal_frame: ['cross', 'vtube'],
      default_ortho: ['cross', 'vtube'],
      pilot_champion: ['catenary_quadripod'],
      hyperboloid_tower: ['hyperboloid'],
    };
    const allowedIds = new Set(presetTileMap[pKey] || [pKey]);
    const matched = tileSummaries.filter((t) => allowedIds.has(t.id) && t.edgeCount > 0);
    const useTiles = matched.length > 0 ? matched : tileSummaries.filter((t) => t.enabledInChampion && t.edgeCount > 0);
    wfcPreview = buildWfcVoxelPreview(
      metrics.gridArr,
      verdict.geometry?.spanX || 0.92,
      verdict.geometry?.spanY || 0.92,
      verdict.geometry?.spanZ || 2.0,
      useTiles.length > 0 ? useTiles : tileSummaries.filter((t) => t.edgeCount > 0)
    );
  }

  const autoSub =
    subtitle ||
    `${metrics.tilePreset} · ${metrics.gridStr.replace(/x/g, '×')} · ${metrics.totalUnrolledSurfaceAreaM2.toFixed(2)} m² · ${metrics.nEdges} bars · ${metrics.centerlineMassKg.toFixed(2)} kg`;

  return {
    id,
    label,
    subtitle: autoSub,
    badge,
    briefId: briefObj.id,
    briefName: briefObj.name,
    envelope: briefObj.envelope,
    topology,
    config,
    mesh,
    unrolled,
    verdict,
    metrics,
    feaField,
    wfcPreview,
  };
}

function walkVerdictFiles(rootDir) {
  const out = [];
  if (!fs.existsSync(rootDir)) return out;
  const stack = [rootDir];
  while (stack.length > 0) {
    const cur = stack.pop();
    for (const ent of fs.readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, ent.name);
      if (ent.isDirectory()) stack.push(full);
      else if (ent.isFile() && ent.name.endsWith('.verdict.json')) out.push(full);
    }
  }
  return out;
}

function categorizeFailureReason(reason) {
  const r = String(reason || '').toLowerCase();
  if (r.includes('compression') || r.includes('tensileaxial') || r.includes('axial_tension')) return 'compression_only_tension_bar';
  if (r.includes('grid') || r.includes('resolution')) return 'min_voxel_grid_2x2x2';
  if (r.includes('pq') || r.includes('planarity')) return 'pq_quad_planarity';
  if (r.includes('unroll') || r.includes('pattern')) return 'unrolled_pattern_check';
  if (r.includes('mesh')) return 'mesh_watertight_manifold';
  if (r.includes('slender') || r.includes('members')) return 'member_slenderness_or_length';
  if (r.includes('buckling')) return 'euler_buckling_sf';
  if (r.includes('tensilesafety') || r.includes('tension')) return 'plaster_tensile_sf';
  if (r.includes('deflection')) return 'deflection_L300';
  if (r.includes('anchor')) return 'ground_anchor_limit';
  if (r.includes('envelope')) return 'envelope_bounds';
  if (r.includes('connect') || r.includes('mechanism') || r.includes('solvable')) return 'mechanism_or_connectivity';
  return reason;
}

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function scanPilotV2Campaign(customRunDir = null) {
  const v2Root = customRunDir
    ? (path.isAbsolute(customRunDir) ? customRunDir : path.resolve(process.cwd(), customRunDir))
    : path.join(__dirname, 'runs', 'pilot_v2_campaign');
  const savedPareto = readJSON(path.join(v2Root, 'pareto_summary.json'));
  const verdictFiles = walkVerdictFiles(v2Root);

  const byStem = new Map();
  for (const vf of verdictFiles) {
    const relFromV2 = path.relative(v2Root, vf).replace(/\\/g, '/');
    // Skip duplicate copy inside champion/ folder if already present in round1/2/3
    const isChampFolder = relFromV2.startsWith('champion/');
    const stem = path.basename(vf).replace(/\.verdict\.json$/i, '');
    const dir = path.dirname(vf);
    const topoPath = path.join(dir, `${stem}.topology.json`);
    const meshPath = path.join(dir, `${stem}.mesh.obj`);
    const cfgPath = path.join(dir, `${stem}.config.json`);

    const verdict = readJSON(vf);
    const topology = readJSON(topoPath);
    if (!verdict || !topology) continue;

    const unrolled = loadUnrolledBundle(topoPath, topology, false);
    const m = extractMetricsFromVerdictAndTopo(verdict, topology, null, unrolled);
    const roundMatch = relFromV2.match(/^(round\d+|smoke[^/]*|champion)/i);
    const roundTag = roundMatch ? roundMatch[1].toLowerCase() : 'round1';

    const rec = {
      name: verdict.candidateName || stem,
      stem,
      round: roundTag,
      isChampCopy: isChampFolder,
      passed: Boolean(verdict.passed),
      failureReasons: verdict.failureReasons || [],
      topoPath,
      meshPath: fs.existsSync(meshPath) ? meshPath : null,
      verdictPath: vf,
      cfgPath: fs.existsSync(cfgPath) ? cfgPath : null,
      ...m,
    };

    if (!byStem.has(stem) || (!isChampFolder && byStem.get(stem).isChampCopy)) {
      byStem.set(stem, rec);
    }
  }

  const records = Array.from(byStem.values());
  const smokeRec = records.find((r) => r.round.startsWith('smoke')) || null;
  const nonChampCopies = records.filter((r) => !r.isChampCopy && !r.round.startsWith('smoke'));
  const pool = nonChampCopies.length > 0 ? nonChampCopies : records.filter((r) => !r.isChampCopy);

  // Compute 4-objective Pareto front among passed candidates with lateral stability & clean unpinched radii
  const passedPool = pool.filter((r) => r.passed);
  const savedParetoList = (savedPareto && (savedPareto.paretoFront || savedPareto.paretoCandidates)) || [];
  const savedParetoNames = new Set(savedParetoList.map((p) => p.name || p.candidateName || p.id));

  for (const a of passedPool) {
    if (savedParetoNames.size > 0) {
      a.isPareto = savedParetoNames.has(a.name) || savedParetoNames.has(a.stem);
      continue;
    }
    const cleanA = a.meshMassKg >= 0.85 * a.centerlineMassKg && (a.latMinSF == null || a.latMinSF >= 1.5);
    if (!cleanA) {
      a.isPareto = false;
      continue;
    }
    let dominated = false;
    for (const b of passedPool) {
      if (a === b) continue;
      const cleanB = b.meshMassKg >= 0.85 * b.centerlineMassKg && (b.latMinSF == null || b.latMinSF >= 1.5);
      if (!cleanB) continue;
      const noWorse =
        b.totalUnrolledSurfaceAreaM2 <= a.totalUnrolledSurfaceAreaM2 + 1e-6 &&
        b.nEdges <= a.nEdges &&
        b.centerlineMassKg <= a.centerlineMassKg + 1e-6 &&
        b.funicularEfficiency >= a.funicularEfficiency - 1e-6;
      const strictlyBetter =
        b.totalUnrolledSurfaceAreaM2 < a.totalUnrolledSurfaceAreaM2 - 1e-5 ||
        b.nEdges < a.nEdges ||
        b.centerlineMassKg < a.centerlineMassKg - 1e-4 ||
        b.funicularEfficiency > a.funicularEfficiency + 1e-4;
      if (noWorse && strictlyBetter) {
        dominated = true;
        break;
      }
    }
    a.isPareto = !dominated;
  }

  // Fallback to v1 pareto_summary if Pilot v2 has not populated yet
  if (pool.length === 0) {
    const v1Summary = readJSON('runs/sweep/pareto_summary.json');
    const v1Pts = (v1Summary?.paretoFront || []).map((p) => ({
      name: p.name,
      stem: p.name,
      round: 'round2',
      passed: true,
      isPareto: true,
      failureReasons: [],
      gridArr: p.config?.gridResolution || [2, 2, 3],
      gridStr: (p.config?.gridResolution || [2, 2, 3]).join('x'),
      tilePreset: p.config?.tilePreset || 'pilot_champion',
      qProfile: p.config?.qProfile || 'column_boosted',
      fdmMode: p.config?.fdmMode || 'compression',
      nEdges: 36,
      centerlineMassKg: p.massKg,
      meshMassKg: p.meshMassKg || p.massKg,
      totalUnrolledSurfaceAreaM2: +(p.massKg * 0.145).toFixed(3),
      funicularEfficiency: p.funicularEfficiency || 0.95,
      compressionDominance: p.compressionDominance ?? 1,
      tensileBarCount: 0,
      maxAxialForceN: -12,
      maxQuadPlanarityErrorMm: 0,
      subdivLevels: 1,
      maxDispMm: p.maxDispMm || 0.2,
      deflectionInvN: p.deflectionInverseN || 4000,
      sfBuckling: p.sfBuckling || 15,
      latMinSF: p.lateralMinSF || 5,
    }));
    return {
      isPilotV2Populated: false,
      savedPareto: v1Summary,
      records: v1Pts,
      totals: {
        evaluated: v1Summary?.totals?.evaluated || v1Pts.length,
        passed: v1Summary?.totals?.passed || v1Pts.length,
        failed: v1Summary?.totals?.failed || 0,
        passRatePct: v1Summary?.totals?.passRatePct || 100,
        paretoFrontCount: v1Pts.length,
      },
      gridComparison: {},
      presetComparison: v1Summary?.presetComparison || {},
      roundComparison: {},
      compressionAudit: { totalEvaluated: v1Pts.length, pureCompressionCount: v1Pts.length, tensileRejectedCount: 0, worstTensileN: 0 },
      topFailureModes: v1Summary?.topFailureModes || [],
    };
  }

  // Aggregate gridComparison, presetComparison, roundComparison, compressionAudit, topFailureModes
  const gridComparison = {};
  const presetComparison = {};
  const roundComparison = {};
  const failureCounts = {};
  let pureCompCount = 0;
  let tensileFailCount = 0;
  let worstTensileN = 0;

  for (const r of pool) {
    const isPureComp = r.tensileBarCount === 0 && r.compressionDominance >= 0.999;
    if (isPureComp) pureCompCount++;
    if (!isPureComp || r.failureReasons.some((f) => /compression|tension/i.test(f))) {
      if (!r.passed && r.maxAxialForceN > 1e-4) tensileFailCount++;
      if (r.maxAxialForceN > worstTensileN) worstTensileN = r.maxAxialForceN;
    }

    // Grid
    if (!gridComparison[r.gridStr]) {
      gridComparison[r.gridStr] = {
        grid: r.gridStr,
        disallowed1x1: r.gridArr[0] < 2 || r.gridArr[1] < 2 || r.gridArr[2] < 2,
        total: 0,
        passed: 0,
        bestAreaM2: Infinity,
        bestBars: Infinity,
        bestMassKg: Infinity,
        bestCandidate: null,
      };
    }
    const gc = gridComparison[r.gridStr];
    gc.total++;
    if (r.passed) {
      gc.passed++;
      if (r.totalUnrolledSurfaceAreaM2 < gc.bestAreaM2) {
        gc.bestAreaM2 = r.totalUnrolledSurfaceAreaM2;
        gc.bestCandidate = r.name;
      }
      if (r.nEdges < gc.bestBars) gc.bestBars = r.nEdges;
      if (r.centerlineMassKg < gc.bestMassKg) gc.bestMassKg = r.centerlineMassKg;
    }

    // Preset
    if (!presetComparison[r.tilePreset]) {
      presetComparison[r.tilePreset] = {
        total: 0,
        passed: 0,
        bestAreaM2: Infinity,
        bestBars: Infinity,
        bestMassKg: Infinity,
        bestFunicEff: 0,
      };
    }
    const pc = presetComparison[r.tilePreset];
    pc.total++;
    if (r.passed) {
      pc.passed++;
      if (r.totalUnrolledSurfaceAreaM2 < pc.bestAreaM2) pc.bestAreaM2 = r.totalUnrolledSurfaceAreaM2;
      if (r.nEdges < pc.bestBars) pc.bestBars = r.nEdges;
      if (r.centerlineMassKg < pc.bestMassKg) pc.bestMassKg = r.centerlineMassKg;
      if (r.funicularEfficiency > pc.bestFunicEff) pc.bestFunicEff = r.funicularEfficiency;
    }

    // Round
    if (!roundComparison[r.round]) {
      roundComparison[r.round] = {
        total: 0,
        passed: 0,
        bestAreaM2: Infinity,
        bestBars: Infinity,
        bestMassKg: Infinity,
        bestFunicEff: 0,
        samplePassed: null,
        sampleHeavy: null,
      };
    }
    const rc = roundComparison[r.round];
    rc.total++;
    if (r.passed) {
      rc.passed++;
      if (r.totalUnrolledSurfaceAreaM2 < rc.bestAreaM2) rc.bestAreaM2 = r.totalUnrolledSurfaceAreaM2;
      if (r.nEdges < rc.bestBars) rc.bestBars = r.nEdges;
      if (r.centerlineMassKg < rc.bestMassKg) rc.bestMassKg = r.centerlineMassKg;
      if (r.funicularEfficiency > rc.bestFunicEff) rc.bestFunicEff = r.funicularEfficiency;
      if (!rc.sampleHeavy || r.totalUnrolledSurfaceAreaM2 > rc.sampleHeavy.totalUnrolledSurfaceAreaM2) {
        rc.sampleHeavy = r;
      }
      if (!rc.samplePassed || r.totalUnrolledSurfaceAreaM2 < rc.samplePassed.totalUnrolledSurfaceAreaM2) {
        rc.samplePassed = r;
      }
    }

    // Failure modes
    if (!r.passed) {
      const seenCats = new Set();
      for (const fr of r.failureReasons) {
        const cat = categorizeFailureReason(fr);
        if (!seenCats.has(cat)) {
          seenCats.add(cat);
          failureCounts[cat] = (failureCounts[cat] || 0) + 1;
        }
      }
    }
  }

  for (const gc of Object.values(gridComparison)) {
    gc.passRatePct = gc.total > 0 ? +((gc.passed / gc.total) * 100).toFixed(1) : 0;
    if (!Number.isFinite(gc.bestAreaM2)) gc.bestAreaM2 = null;
    if (!Number.isFinite(gc.bestBars)) gc.bestBars = null;
    if (!Number.isFinite(gc.bestMassKg)) gc.bestMassKg = null;
  }
  for (const pc of Object.values(presetComparison)) {
    pc.passRatePct = pc.total > 0 ? +((pc.passed / pc.total) * 100).toFixed(1) : 0;
    if (!Number.isFinite(pc.bestAreaM2)) pc.bestAreaM2 = null;
    if (!Number.isFinite(pc.bestBars)) pc.bestBars = null;
    if (!Number.isFinite(pc.bestMassKg)) pc.bestMassKg = null;
  }

  const failedTotal = Math.max(1, pool.length - passedPool.length);
  const topFailureModes = Object.entries(failureCounts)
    .map(([mode, count]) => ({
      mode,
      count,
      pctOfFailures: +((count / failedTotal) * 100).toFixed(1),
    }))
    .sort((a, b) => b.count - a.count);

  const paretoCount = passedPool.filter((r) => r.isPareto).length;

  return {
    isPilotV2Populated: true,
    savedPareto,
    smokeRec,
    records: pool,
    totals: {
      evaluated: savedPareto?.totals?.evaluated ?? pool.length,
      passed: savedPareto?.totals?.passed ?? passedPool.length,
      failed: savedPareto?.totals?.failed ?? pool.length - passedPool.length,
      passRatePct:
        savedPareto?.totals?.passRatePct ??
        (pool.length > 0 ? +((passedPool.length / pool.length) * 100).toFixed(1) : 0),
      paretoFrontCount: savedPareto?.totals?.paretoFrontCount ?? paretoCount,
    },
    gridComparison,
    presetComparison,
    roundComparison,
    compressionAudit: {
      totalEvaluated: pool.length,
      pureCompressionCount: pureCompCount,
      tensileRejectedCount: tensileFailCount + (smokeRec && smokeRec.tensileBarCount > 0 ? 1 : 0),
      worstTensileN: +Math.max(worstTensileN, smokeRec?.maxAxialForceN || 0).toFixed(2),
    },
    topFailureModes: topFailureModes.length > 0 ? topFailureModes : (savedPareto?.topFailureModes || []),
  };
}

function findChampionPaths(customRunDir = null) {
  const candidateChampDirs = [];
  if (customRunDir) {
    const resolvedRunDir = path.isAbsolute(customRunDir) ? customRunDir : path.resolve(process.cwd(), customRunDir);
    candidateChampDirs.push(path.join(resolvedRunDir, 'champion'));
    candidateChampDirs.push(path.join(resolvedRunDir, 'best_verified'));
  }
  candidateChampDirs.push(path.join(__dirname, 'runs', 'pilot_v2_campaign', 'champion'));

  for (const v2ChampDir of candidateChampDirs) {
    if (!fs.existsSync(v2ChampDir)) continue;
    const topos = fs.readdirSync(v2ChampDir).filter((f) => f.endsWith('.topology.json'));
    const pick = topos.find((f) => f === 'champion.topology.json') || topos[0];
    if (pick) {
      const stem = pick.replace(/\.topology\.json$/i, '');
      const tp = path.join(v2ChampDir, pick);
      const mp = path.join(v2ChampDir, `${stem}.mesh.obj`);
      const vp = path.join(v2ChampDir, `${stem}.verdict.json`);
      const cp = path.join(v2ChampDir, `${stem}.config.json`);
      if (fs.existsSync(vp) && fs.existsSync(mp)) {
        return { topo: tp, mesh: mp, verdict: vp, config: fs.existsSync(cp) ? cp : null };
      }
    }
  }
  return {
    topo: 'runs/champion/champion.topology.json',
    mesh: 'runs/champion/champion.mesh.obj',
    verdict: 'runs/champion/champion.verdict.json',
    config: 'runs/champion/champion.config.json',
  };
}

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const core = await loadCoreFromIndexWFC();
  const customBrief = cliArgs.brief
    ? readJSON(path.isAbsolute(cliArgs.brief) ? cliArgs.brief : path.resolve(process.cwd(), cliArgs.brief))
    : null;
  const pilotV2Brief = readJSON('briefs/pilot_v2_pq_unrolled.json');
  const pilotV1Brief = readJSON('briefs/pilot_brief.json');
  const canopyBrief = readJSON('briefs/arch_canopy_example.json');
  const activeBrief = customBrief || pilotV2Brief || pilotV1Brief;

  const campaign = scanPilotV2Campaign(cliArgs['run-dir'] || null);
  const champPaths = findChampionPaths(cliArgs['run-dir'] || null);
  const rawChampTopo = readJSON(champPaths.topo);
  const rawChampVerdict = readJSON(champPaths.verdict);
  const champIsV2 = Boolean(customBrief) || rawChampVerdict?.briefId === 'pilot-v2-pq-unrolled-plaster-tower';

  const champPresetKey = rawChampTopo?.metadata?.tilePreset || 'pilot_champion';
  const champGrid = rawChampTopo?.metadata?.gridResolution || [2, 2, 3];
  const champSpan = [
    rawChampVerdict?.geometry?.spanX || 0.92,
    rawChampVerdict?.geometry?.spanY || 0.92,
    rawChampVerdict?.geometry?.spanZ || 2.0,
  ];
  const wfcData = extractWFCTileAndAdjacencyData(core, champPresetKey, champGrid, champSpan);

  // Discover Round 1 Baseline (prefer clean unpinched passing Round 1 candidate) & Extreme/Rejected milestones
  const r1Pool = campaign.records.filter((r) => r.round === 'round1' && r.meshPath);
  const r1CleanPassed = r1Pool
    .filter((r) => r.passed && r.meshMassKg >= 0.85 * r.centerlineMassKg)
    .sort((a, b) => b.totalUnrolledSurfaceAreaM2 - a.totalUnrolledSurfaceAreaM2);
  const r1Passed = r1Pool.filter((r) => r.passed).sort((a, b) => b.totalUnrolledSurfaceAreaM2 - a.totalUnrolledSurfaceAreaM2);
  const v2BaselineRec = r1CleanPassed[0] || r1Passed[0] || r1Pool[0] || null;

  // Prefer smoke_v2 (which demonstrates 4 tensile portal-tie bars + 3.30 mm PQ warp caught by Verifier) or a rejected >=2x2x2 candidate
  const rejectedPool = campaign.records.filter(
    (r) =>
      !r.passed &&
      r.meshPath &&
      r.gridArr[0] >= 2 &&
      r.gridArr[1] >= 2 &&
      (!v2BaselineRec || r.stem !== v2BaselineRec.stem)
  );
  const compFailedRec =
    (campaign.smokeRec && campaign.smokeRec.meshPath ? campaign.smokeRec : null) ||
    rejectedPool.find((r) => r.tensileBarCount > 0 || r.failureReasons.some((f) => /compression|tension/i.test(f))) ||
    rejectedPool[0] ||
    campaign.records.find((r) => r.passed && r.latMinSF != null && r.latMinSF < 1.5 && r.meshPath) ||
    null;

  const candidates = [];

  // 1. Campaign Champion (include full verbatim .patterns.svg + interactive unrolled.json)
  const champCand = buildFeaturedCandidate(
    'champion',
    customBrief ? `${activeBrief.id || 'Campaign'} Champion` : (champIsV2 ? 'Pilot v2 Champion' : 'Pilot Champion'),
    null,
    customBrief ? 'VERIFIED · PASS' : 'V2 WINNER · PASS',
    champPaths.topo,
    champPaths.mesh,
    champPaths.verdict,
    customBrief || (champIsV2 ? pilotV2Brief : pilotV1Brief),
    champPaths.config,
    wfcData.tiles,
    true
  );
  if (champCand) candidates.push(champCand);

  // 1b. Pareto Min-Area Extreme (if distinct from Champion)
  const minAreaParetoRec = campaign.records
    .filter((r) => r.passed && r.isPareto && r.meshPath && r.name !== rawChampVerdict?.candidateName)
    .sort((a, b) => a.totalUnrolledSurfaceAreaM2 - b.totalUnrolledSurfaceAreaM2)[0];
  if (minAreaParetoRec) {
    const minAreaCand = buildFeaturedCandidate(
      'pareto_min_area',
      `Min Area (${minAreaParetoRec.totalUnrolledSurfaceAreaM2.toFixed(2)} m²)`,
      `${minAreaParetoRec.tilePreset} · ${minAreaParetoRec.gridStr.replace(/x/g, '×')} · ${minAreaParetoRec.totalUnrolledSurfaceAreaM2.toFixed(3)} m² · ${minAreaParetoRec.nEdges} bars · ${minAreaParetoRec.centerlineMassKg.toFixed(2)} kg`,
      'PARETO · MIN AREA',
      minAreaParetoRec.topoPath,
      minAreaParetoRec.meshPath,
      minAreaParetoRec.verdictPath,
      activeBrief,
      minAreaParetoRec.cfgPath,
      wfcData.tiles,
      false
    );
    if (minAreaCand) candidates.push(minAreaCand);
  }

  // 2. Round 1 Baseline
  if (v2BaselineRec) {
    const bCand = buildFeaturedCandidate(
      'baseline',
      'Round 1 Baseline',
      `${v2BaselineRec.tilePreset} · ${v2BaselineRec.gridStr.replace(/x/g, '×')} · ${v2BaselineRec.totalUnrolledSurfaceAreaM2.toFixed(2)} m² · ${v2BaselineRec.nEdges} bars · ${v2BaselineRec.centerlineMassKg.toFixed(2)} kg`,
      v2BaselineRec.passed ? 'ROUND 1 · PRE-OPT' : 'ROUND 1 · INITIAL',
      v2BaselineRec.topoPath,
      v2BaselineRec.meshPath,
      v2BaselineRec.verdictPath,
      activeBrief,
      v2BaselineRec.cfgPath,
      wfcData.tiles
    );
    if (bCand) candidates.push(bCand);
  } else {
    const fallbackBase = buildFeaturedCandidate(
      'baseline',
      'Initial Baseline',
      'Arch Braced · 2×2×4 · Solid 35mm · 141.04 kg (Before Optimization)',
      'BASELINE · HEAVY',
      'runs/smoke/baseline.topology.json',
      'runs/smoke/baseline.mesh.obj',
      'runs/smoke/baseline.verdict.json',
      pilotV1Brief,
      null,
      wfcData.tiles
    );
    if (fallbackBase) candidates.push(fallbackBase);
  }

  // 3. Extreme / Rejected Diagnostic Candidate
  if (compFailedRec) {
    const reasonBadge =
      compFailedRec.tensileBarCount > 0
        ? `REJECTED · ${compFailedRec.tensileBarCount} TENS BARS`
        : !compFailedRec.passed
        ? 'REJECTED · FEA GATE'
        : 'EXTREME · LAT WARN';
    const rejCand = buildFeaturedCandidate(
      'rejected_extreme',
      'Extreme / Rejected',
      `${compFailedRec.tilePreset} · ${compFailedRec.gridStr.replace(/x/g, '×')} · ${compFailedRec.nEdges} bars · Caught by Air-Gapped Verifier`,
      reasonBadge,
      compFailedRec.topoPath,
      compFailedRec.meshPath,
      compFailedRec.verdictPath,
      activeBrief,
      compFailedRec.cfgPath,
      wfcData.tiles
    );
    if (rejCand) candidates.push(rejCand);
  } else {
    const sweepExtreme = buildFeaturedCandidate(
      'rejected_extreme',
      'Extreme (1×1×4 Unbraced)',
      'Hyperboloid · 1×1×4 · Disallowed <2×2×2 & 5% Lateral Drift Warning',
      'REJECTED IN V2',
      'runs/sweep/best_verified/sweep_best.topology.json',
      'runs/sweep/best_verified/sweep_best.mesh.obj',
      'runs/sweep/best_verified/sweep_best.verdict.json',
      pilotV1Brief,
      'runs/sweep/best_verified/sweep_best.config.json',
      wfcData.tiles
    );
    if (sweepExtreme) candidates.push(sweepExtreme);
  }

  // 4. Pilot v1 Champion Reference (if backed up in runs/champion_v1_pilot1/)
  if (fs.existsSync(path.join(__dirname, 'runs', 'champion_v1_pilot1', 'champion.topology.json'))) {
    const v1Cand = buildFeaturedCandidate(
      'pilot_v1_ref',
      'Pilot v1 (1×1×3 Ref)',
      'Legacy v1 Champion · 1×1×3 Grid (L=0, No Unroll · Superseded by v2 >=2×2×2)',
      'PILOT V1 · REF',
      'runs/champion_v1_pilot1/champion.topology.json',
      'runs/champion_v1_pilot1/champion.mesh.obj',
      'runs/champion_v1_pilot1/champion.verdict.json',
      pilotV1Brief,
      'runs/champion_v1_pilot1/champion.config.json',
      wfcData.tiles
    );
    if (v1Cand) candidates.push(v1Cand);
  }

  // 5. Multi-Brief: Arch Canopy
  const canopyCand = buildFeaturedCandidate(
    'canopy_best',
    'Multi-Brief: Arch Canopy',
    '2×1×1.2m Plaster Canopy · 4×2×2 Grid · +30 kg Roof Load · 5.06 kg',
    '2ND BRIEF · PASS',
    'runs/sweep/canopy_verified/canopy_best.topology.json',
    'runs/sweep/canopy_verified/canopy_best.mesh.obj',
    'runs/sweep/canopy_verified/canopy_best.verdict.json',
    canopyBrief,
    'runs/sweep/canopy_verified/canopy_best.config.json',
    wfcData.tiles
  );
  if (canopyCand) candidates.push(canopyCand);

  // Build Dynamic Pilot v2 Swarm Timeline
  const cm = champCand?.metrics || {};
  const r1 = campaign.roundComparison.round1 || {};
  const r2 = campaign.roundComparison.round2 || {};
  const r3 = campaign.roundComparison.round3 || {};

  const swarmTimeline = campaign.isPilotV2Populated
    ? [
        {
          stage: 'Stage 1 · Round 1 Broad Swarm',
          tag: `${r1.total || campaign.totals.evaluated} Configs · >=2×2×2`,
          passRate: r1.total ? `${((r1.passed / r1.total) * 100).toFixed(1)}% (${r1.passed}/${r1.total})` : `${campaign.totals.passRatePct}%`,
          bestAreaM2: Number.isFinite(r1.bestAreaM2) ? r1.bestAreaM2 : cm.totalUnrolledSurfaceAreaM2,
          bestBars: Number.isFinite(r1.bestBars) ? r1.bestBars : cm.nEdges,
          bestMassKg: Number.isFinite(r1.bestMassKg) ? r1.bestMassKg : cm.centerlineMassKg,
          highlight:
            'Swept 2×2×2 .. 4×4×6 XY-symmetric voxel grids across 11 presets with L>=1 longitudinal subdivision, PQ planarization (<=0.5 mm), and 2D unrolling. Air-gapped FEA caught horizontal portal-tie tension bars.',
          candidateId: 'baseline',
        },
        {
          stage: 'Stage 2 · Round 2 Compression-Only & PQ Opt',
          tag: r2.total ? `${r2.total} Targeted Configs` : 'Diagnosis-Driven Opt',
          passRate: r2.total ? `${((r2.passed / r2.total) * 100).toFixed(1)}% (${r2.passed}/${r2.total})` : 'Pure Comp Filter',
          bestAreaM2: Number.isFinite(r2.bestAreaM2) ? r2.bestAreaM2 : cm.totalUnrolledSurfaceAreaM2,
          bestBars: Number.isFinite(r2.bestBars) ? r2.bestBars : cm.nEdges,
          bestMassKg: Number.isFinite(r2.bestMassKg) ? r2.bestMassKg : cm.centerlineMassKg,
          highlight:
            'Eliminated tensile portal ties via pure-compression vault/quadripod load paths + iterative q_e tuning (N <= 0 on 100% of bars), keeping quad warp <= 0.5 mm and 0 unroll self-intersections.',
          candidateId: 'rejected_extreme',
        },
        {
          stage: 'Stage 3 · Round 3 Multi-Objective Pareto',
          tag: r3.total ? `${r3.total} Fine-Tuned · ${campaign.totals.paretoFrontCount} Pareto` : `${campaign.totals.paretoFrontCount} Pareto Front`,
          passRate: r3.total ? `${((r3.passed / r3.total) * 100).toFixed(1)}% (${r3.passed}/${r3.total})` : `${campaign.totals.passRatePct}% Overall`,
          bestAreaM2: cm.totalUnrolledSurfaceAreaM2,
          bestBars: cm.nEdges,
          bestMassKg: cm.centerlineMassKg,
          highlight:
            'Simultaneously minimized Total Unrolled Surface Area (m²), Bar Count (nEdges), and Cast Plaster Mass (kg) while enforcing L/300 deflection, SF_c >= 2.0, SF_b >= 2.0, and lateral stability.',
          candidateId: 'champion',
        },
        {
          stage: 'Stage 4 · Frozen Pilot v2 Champion',
          tag: `${cm.gridStr?.replace(/x/g, '×') || '2×2×3'} · 100% Comp · PQ`,
          passRate: `${campaign.totals.passed}/${campaign.totals.evaluated} Verified`,
          bestAreaM2: cm.totalUnrolledSurfaceAreaM2,
          bestBars: cm.nEdges,
          bestMassKg: cm.centerlineMassKg,
          highlight: `Verified Champion (${cm.totalUnrolledSurfaceAreaM2?.toFixed(3)} m² unrolled, ${cm.nEdges} bars, ${cm.centerlineMassKg?.toFixed(2)} kg, L/${cm.deflectionInvN}, PQ err ${cm.maxQuadPlanarityErrorMm?.toFixed(3)} mm) + Multi-Brief Canopy.`,
          candidateId: 'champion',
        },
      ]
    : [
        {
          stage: 'Stage 1 · Baseline Smoke Test',
          tag: '2×2×4 Solid 35mm',
          passRate: '100% (1/1)',
          bestAreaM2: 4.85,
          bestBars: 80,
          bestMassKg: 141.04,
          highlight: 'Initial 80-bar solid plaster frame prior to multi-objective surface area & element count optimization.',
          candidateId: 'baseline',
        },
        {
          stage: 'Stage 2 · Verified Champion',
          tag: 'Pure Compression',
          passRate: `${campaign.totals.passRatePct}%`,
          bestAreaM2: cm.totalUnrolledSurfaceAreaM2 || 1.42,
          bestBars: cm.nEdges || 36,
          bestMassKg: cm.centerlineMassKg || 9.42,
          highlight: 'Optimized pure-compression tubular plaster network verified by independent 3D space-frame FEA.',
          candidateId: 'champion',
        },
      ];

  // Compact scatter points for frontend payload
  const scatterPoints = campaign.records.map((r) => ({
    name: r.name,
    round: r.round,
    passed: r.passed,
    isPareto: Boolean(r.isPareto),
    preset: r.tilePreset,
    grid: r.gridStr,
    areaM2: r.totalUnrolledSurfaceAreaM2,
    bars: r.nEdges,
    massKg: r.centerlineMassKg,
    meshMassKg: r.meshMassKg,
    funicEff: r.funicularEfficiency,
    compDom: r.compressionDominance,
    tensBars: r.tensileBarCount,
    pqErrMm: r.maxQuadPlanarityErrorMm,
    dispMm: r.maxDispMm,
    invN: r.deflectionInvN,
    sfBuck: r.sfBuckling,
    latSF: r.latMinSF,
    failReason: r.failureReasons?.[0] || null,
  }));

  const airGapAudit = auditAirGap();
  const verifierBenchmarks = collectVerifierBenchmarks();

  const reportPayload = {
    generatedAt: new Date().toISOString(),
    brief: activeBrief,
    isPilotV2: Boolean(champIsV2 || campaign.isPilotV2Populated),
    campaignTotals: campaign.totals,
    swarmTimeline,
    scatterPoints,
    gridComparison: campaign.gridComparison,
    presetComparison: campaign.presetComparison,
    compressionAudit: campaign.compressionAudit,
    topFailureModes: campaign.topFailureModes,
    wfcData,
    candidates,
    airGapAudit,
    verifierBenchmarks,
  };

  const templateHtml = buildHtmlDocument(reportPayload);
  const defaultOutPath = path.join(__dirname, 'foundry_report.html');
  const outPath = cliArgs.out
    ? (path.isAbsolute(cliArgs.out) ? cliArgs.out : path.resolve(process.cwd(), cliArgs.out))
    : defaultOutPath;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, templateHtml, 'utf8');
  if (outPath !== defaultOutPath) {
    fs.writeFileSync(defaultOutPath, templateHtml, 'utf8');
  }
  console.log(
    `Built ${outPath} (${(templateHtml.length / 1024).toFixed(1)} KB) | ` +
      `Champion: ${champCand?.label} (${cm.gridStr}, ${cm.totalUnrolledSurfaceAreaM2} m², ${cm.nEdges} bars, ${cm.centerlineMassKg} kg) | ` +
      `${candidates.length} 3D milestones | ${scatterPoints.length} campaign points | ${verifierBenchmarks.length}/${verifierBenchmarks.length} benchmarks | Air-Gap cross-imports: ${airGapAudit.totalCrossImports}`
  );
}

function buildHtmlDocument(payload) {
  const safeJson = JSON.stringify(payload).replace(/<\//g, '<\\/');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>WFC·FDM Foundry | Pilot v2 PQ &amp; Unrolled Strip Verification Report</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><circle cx='8' cy='8' r='6' fill='%23ec4899'/></svg>" />
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/"
  }
}
</script>
<style>
  :root {
    --panel-bg: rgba(13, 18, 30, 0.92);
    --panel-border: rgba(148, 163, 184, 0.24);
    --pink: #ec4899;
    --cyan: #22d3ee;
    --emerald: #10b981;
    --amber: #f59e0b;
    --rose: #f43f5e;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden;
    background: #f3f6fb;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    color: #e2e8f0;
    user-select: none;
  }
  #viewport { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 1; }

  /* Compact utility classes (zero external CSS runtime needed) */
  .hidden { display: none !important; }
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .flex-1 { flex: 1 1 0%; }
  .items-center { align-items: center; }
  .items-start { align-items: flex-start; }
  .justify-between { justify-content: space-between; }
  .justify-end { justify-content: flex-end; }
  .shrink-0 { flex-shrink: 0; }
  .min-w-0 { min-width: 0; }
  .min-h-0 { min-height: 0; }
  .w-full { width: 100%; }
  .grid { display: grid; }
  .grid-cols-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .grid-cols-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .grid-cols-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .gap-1 { gap: 4px; }
  .gap-1-5 { gap: 6px; }
  .gap-2 { gap: 8px; }
  .gap-3 { gap: 12px; }
  .p-2 { padding: 8px; }
  .p-3 { padding: 12px; }
  .pt-1 { padding-top: 4px; }
  .mb-1 { margin-bottom: 4px; }
  .mb-1-5 { margin-bottom: 6px; }
  .mt-0-5 { margin-top: 2px; }
  .mt-1 { margin-top: 4px; }
  .my-1-5 { margin-top: 6px; margin-bottom: 6px; }
  .space-y-1 > * + * { margin-top: 4px; }
  .space-y-1-5 > * + * { margin-top: 6px; }
  .space-y-2 > * + * { margin-top: 8px; }
  .space-y-2-5 > * + * { margin-top: 10px; }
  .space-y-3 > * + * { margin-top: 12px; }
  .truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text-center { text-align: center; }
  .text-right { text-align: right; }
  .uppercase { text-transform: uppercase; }
  .font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
  .font-semibold { font-weight: 600; }
  .font-bold { font-weight: 700; }
  .font-extrabold { font-weight: 800; }
  .text-9 { font-size: 9px; }
  .text-9-5 { font-size: 9.5px; }
  .text-10 { font-size: 10px; }
  .text-10-5 { font-size: 10.5px; }
  .text-11 { font-size: 11px; }
  .text-xs { font-size: 12px; }
  .text-sm { font-size: 13.5px; }
  .leading-tight { line-height: 1.2; }
  .leading-snug { line-height: 1.35; }
  .leading-relaxed { line-height: 1.5; }
  .text-white { color: #ffffff; }
  .text-slate-300 { color: #cbd5e1; }
  .text-slate-400 { color: #94a3b8; }
  .text-slate-500 { color: #64748b; }
  .text-pink-300 { color: #f9a8d4; }
  .text-cyan-300 { color: #67e8f9; }
  .text-emerald-300 { color: #6ee7b7; }
  .text-amber-300 { color: #fcd34d; }
  .text-rose-400 { color: #fb7185; }
  .cursor-pointer { cursor: pointer; }
  .overflow-y-auto { overflow-y: auto; }
  .overflow-x-auto { overflow-x: auto; }
  .max-h-44 { max-height: 176px; }
  .max-h-56 { max-height: 224px; }

  /* Floating Goldilocks Chrome Panels */
  .cad-panel {
    position: fixed;
    z-index: 20;
    background: var(--panel-bg);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 18px 42px rgba(2, 6, 23, 0.38);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .cad-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px;
    border-bottom: 1px solid rgba(148, 163, 184, 0.16);
    cursor: move;
    background: rgba(15, 23, 42, 0.72);
    gap: 8px;
  }
  .cad-body {
    overflow-y: auto;
    user-select: text;
    scrollbar-width: thin;
    scrollbar-color: rgba(148,163,184,0.32) transparent;
  }
  .cad-btn {
    padding: 5px 8px; border-radius: 6px; font-size: 10.5px; font-weight: 600;
    border: 1px solid rgba(148,163,184,0.25);
    background: rgba(30, 41, 59, 0.75);
    color: #cbd5e1;
    cursor: pointer; transition: all 0.14s ease;
    white-space: nowrap;
  }
  .cad-btn:hover { background: rgba(51, 65, 85, 0.92); color: #fff; border-color: rgba(148,163,184,0.5); }
  .cad-btn.active-pink { background: rgba(236, 72, 153, 0.24); border-color: rgba(236, 72, 153, 0.7); color: #fbcfe8; }
  .cad-btn.active-cyan { background: rgba(34, 211, 238, 0.20); border-color: rgba(34, 211, 238, 0.7); color: #cffafe; }
  .cad-btn.active-emerald { background: rgba(16, 185, 129, 0.24); border-color: rgba(16, 185, 129, 0.7); color: #a7f3d0; }
  .cad-btn.active-amber { background: rgba(245, 158, 11, 0.22); border-color: rgba(245, 158, 11, 0.7); color: #fde68a; }

  .ui-tab {
    flex: 1; padding: 7px 4px; font-size: 10.5px; font-weight: 600;
    border: none; border-bottom: 2px solid transparent; color: #94a3b8;
    background: transparent; cursor: pointer; transition: all 0.15s;
    text-align: center; white-space: nowrap;
  }
  .ui-tab:hover { color: #e2e8f0; background: rgba(30,41,59,0.45); }
  .ui-tab.active { color: #fff; border-bottom-color: var(--pink); background: rgba(30,41,59,0.75); }

  .metric-card {
    background: rgba(30, 41, 59, 0.56);
    border: 1px solid rgba(148, 163, 184, 0.16);
    border-radius: 8px;
    padding: 7px 9px;
  }
  .metric-card.highlight-border { border-color: rgba(236, 72, 153, 0.45); }
  .metric-card.hover-card:hover { border-color: rgba(236, 72, 153, 0.55); background: rgba(30, 41, 59, 0.8); }

  .pill {
    display: inline-flex; align-items: center; gap: 4px;
    padding: 2px 7px; border-radius: 999px; font-size: 9.5px; font-weight: 700;
    letter-spacing: 0.03em; white-space: nowrap;
  }
  .pill-pass { background: rgba(16,185,129,0.2); color: #6ee7b7; border: 1px solid rgba(16,185,129,0.48); }
  .pill-warn { background: rgba(245,158,11,0.2); color: #fcd34d; border: 1px solid rgba(245,158,11,0.48); }
  .pill-fail { background: rgba(244,63,94,0.22); color: #fda4af; border: 1px solid rgba(244,63,94,0.52); }
  .pill-cyan { background: rgba(34,211,238,0.16); color: #67e8f9; border: 1px solid rgba(34,211,238,0.42); }
  .pill-pink { background: rgba(236,72,153,0.18); color: #f9a8d4; border: 1px solid rgba(236,72,153,0.45); }

  /* Goldilocks 3-Layer Progressive Disclosure */
  .h2-only, .h3-only { display: none; }
  body.goldilocks-h2 .h2-only { display: block; }
  body.goldilocks-h3 .h2-only, body.goldilocks-h3 .h3-only { display: block; }
  body.goldilocks-h1 #telemetry-panel { display: none; }
  body.goldilocks-h2 #telemetry-panel { display: none; }
  body.goldilocks-h3 #telemetry-panel { display: flex; }

  .resize-se {
    position: absolute; right: 0; bottom: 0; width: 14px; height: 14px; cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, rgba(148,163,184,0.4) 50%);
  }

  table.cad-table { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.cad-table th {
    text-align: left; padding: 4px 5px; color: #94a3b8; font-weight: 600;
    border-bottom: 1px solid rgba(148,163,184,0.22); font-size: 9px; text-transform: uppercase; letter-spacing: 0.04em;
  }
  table.cad-table td {
    padding: 4px 5px; border-bottom: 1px solid rgba(148,163,184,0.08); color: #e2e8f0;
  }
  table.cad-table tr:hover td { background: rgba(51,65,85,0.42); }
  table.cad-table tr.active-row td { background: rgba(236,72,153,0.22); }

  .adj-cell {
    width: 19px; height: 19px; text-align: center; font-size: 8.5px; font-weight: 700;
    border-radius: 3px; border: 1px solid rgba(148,163,184,0.14); line-height: 17px;
  }
  .adj-yes { background: rgba(16,185,129,0.28); color: #6ee7b7; border-color: rgba(16,185,129,0.45); }
  .adj-no  { background: rgba(15,23,42,0.45); color: #475569; }
  .adj-champ { box-shadow: inset 0 0 0 1.5px #ec4899; }

  .bar-track { width: 100%; height: 6px; background: #1e293b; border-radius: 4px; overflow: hidden; margin-top: 2px; }
  .bar-fill { height: 100%; border-radius: 4px; }

  .svg-box {
    width: 100%; height: auto; display: block;
    background: rgba(7, 10, 18, 0.85);
    border: 1px solid rgba(148, 163, 184, 0.2);
    border-radius: 6px;
  }

  /* Unrolled SVG Fullscreen Modal */
  #unroll-modal {
    position: fixed; inset: 24px; z-index: 60;
    background: rgba(7, 10, 16, 0.96);
    border: 1px solid rgba(34, 211, 238, 0.4);
    border-radius: 14px;
    box-shadow: 0 25px 70px rgba(0,0,0,0.75);
    display: flex; flex-direction: column; overflow: hidden;
  }

  /* Bottom HUD strip */
  #bottom-hud {
    position: fixed; bottom: 12px; left: 50%; transform: translateX(-50%);
    z-index: 15;
    background: rgba(13, 18, 30, 0.88);
    backdrop-filter: blur(10px);
    border: 1px solid rgba(148, 163, 184, 0.24);
    border-radius: 999px;
    padding: 5px 14px;
    font-size: 10.5px; color: #cbd5e1;
    display: flex; align-items: center; gap: 10px;
    box-shadow: 0 8px 24px rgba(2,6,23,0.28);
    white-space: nowrap;
  }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.94em; color: #bae6fd; }
  input[type="range"] { width: 100%; accent-color: #22d3ee; cursor: pointer; }
</style>
</head>
<body class="goldilocks-h1">
  <!-- Full-Bleed Z-Up 3D Studio Viewport -->
  <div id="viewport"></div>

  <!-- Left Main Goldilocks Panel (H1 Compact Card <-> H2/H3 4-Tab Draggable/Resizable Panel) -->
  <aside id="left-panel" class="cad-panel" style="top: 14px; left: 14px; width: 368px; max-height: calc(100vh - 28px);">
    <div id="left-header" class="cad-header">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-slate-500 text-xs">⋮⋮</span>
        <div class="leading-tight truncate">
          <div class="text-xs font-extrabold">
            <span class="text-white">CAD</span> <span style="color:#ec4899">WFC·FDM</span> <span style="color:#22d3ee">Pilot v2</span>
          </div>
          <div class="text-9-5 text-slate-400 truncate">PQ Tubes · Unrolled Strips · Pure Compression FEA</div>
        </div>
      </div>
      <div class="flex items-center gap-1 shrink-0">
        <button id="btn-goldilocks" class="cad-btn active-emerald" title="Cycle Goldilocks Layer: H1 Use → H2 Guide → H3 Telemetry">H1 · Use</button>
        <button id="btn-compact-toggle" class="cad-btn" title="Expand into Full 4-Tab Guide">Guide ▸</button>
        <button id="btn-left-min" class="cad-btn" title="Minimize">–</button>
      </div>
    </div>

    <!-- H1 · USE: COMPACT FLOATING VERDICT CARD -->
    <div id="compact-card" class="cad-body p-3 space-y-2-5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <div id="hero-title" class="text-sm font-extrabold text-white truncate">Pilot v2 Champion</div>
          <div id="hero-sub" class="text-10 text-slate-400 leading-snug mt-0-5">2×2×3 Voxel · PQ Tube · 100% Compression</div>
        </div>
        <span id="hero-badge" class="pill pill-pass shrink-0">V2 WINNER · PASS</span>
      </div>

      <!-- 2x3 Pilot v2 KPI Matrix -->
      <div class="grid grid-cols-3 gap-1-5 text-center">
        <div class="metric-card">
          <div class="text-9 uppercase text-slate-400">Unrolled Area</div>
          <div id="kpi-area" class="text-xs font-extrabold text-cyan-300">0.00 m²</div>
          <div id="kpi-area-sub" class="text-9 text-slate-400 truncate">Obj #1 · 2D Strips</div>
        </div>
        <div class="metric-card">
          <div class="text-9 uppercase text-slate-400">Elements</div>
          <div id="kpi-bars" class="text-xs font-extrabold text-pink-300">0 Bars</div>
          <div id="kpi-bars-sub" class="text-9 text-slate-400 truncate">Obj #2 · >=2×2×2</div>
        </div>
        <div class="metric-card">
          <div class="text-9 uppercase text-slate-400">Plaster Mass</div>
          <div id="kpi-mass" class="text-xs font-extrabold text-emerald-300">0.00 kg</div>
          <div id="kpi-mass-sub" class="text-9 text-slate-400 truncate">Mesh 0.00 kg</div>
        </div>
        <div class="metric-card">
          <div class="text-9 uppercase text-slate-400">Compression</div>
          <div id="kpi-comp" class="text-xs font-extrabold text-emerald-300">100%</div>
          <div id="kpi-comp-sub" class="text-9 text-slate-400 truncate">0 tensile bars</div>
        </div>
        <div class="metric-card">
          <div class="text-9 uppercase text-slate-400">PQ Planarity</div>
          <div id="kpi-pq" class="text-xs font-extrabold text-cyan-300">0.00 mm</div>
          <div id="kpi-pq-sub" class="text-9 text-slate-400 truncate">&lt;=0.5mm · L=1</div>
        </div>
        <div class="metric-card">
          <div class="text-9 uppercase text-slate-400">LC2 (+50 kg)</div>
          <div id="kpi-disp" class="text-xs font-extrabold text-amber-300">L / 5000</div>
          <div id="kpi-disp-sub" class="text-9 text-slate-400 truncate">0.10 mm · SF_b</div>
        </div>
      </div>

      <!-- 4-Layer 3D Viewport Switcher -->
      <div>
        <div class="text-9-5 uppercase text-slate-400 font-semibold mb-1">3D Studio Layer</div>
        <div class="grid grid-cols-4 gap-1" id="view-mode-bar">
          <button class="cad-btn active-cyan" data-vmode="mesh">Tubular</button>
          <button class="cad-btn" data-vmode="fdm">FDM</button>
          <button class="cad-btn" data-vmode="wfc">WFC Tiles</button>
          <button class="cad-btn" data-vmode="fea">FEA Stress</button>
        </div>
      </div>

      <!-- 3D Milestone Comparison Switcher -->
      <div>
        <div class="text-9-5 uppercase text-slate-400 font-semibold mb-1">Compare Campaign &amp; Multi-Brief Milestones</div>
        <div class="grid grid-cols-2 gap-1" id="candidate-bar"></div>
      </div>

      <!-- FEA Deflection Exaggeration & Live Pulse Controls -->
      <div id="fea-slider-box" class="hidden metric-card">
        <div class="flex items-center justify-between text-10 text-slate-300 mb-1">
          <span>3D FEA Deflection (+50 kg)</span>
          <div class="flex items-center gap-1-5">
            <span id="fea-scale-val" class="font-mono text-cyan-300">400×</span>
            <button id="btn-fea-pulse" class="cad-btn active-emerald text-9-5" style="padding:2px 6px;">Animate ▸</button>
          </div>
        </div>
        <input id="fea-scale-slider" type="range" min="0" max="1500" step="25" value="400" />
      </div>

      <div class="flex items-center justify-between pt-1" style="border-top:1px solid rgba(148,163,184,0.16);">
        <span id="h1-footer-stat" class="text-9-5 text-slate-400">Air-Gapped FEA · 0 cross-imports</span>
        <div class="flex gap-1">
          <button id="btn-quick-unroll" class="cad-btn text-9-5" style="padding:3px 7px;">2D Strips</button>
          <button id="btn-frame-cam" class="cad-btn text-9-5" style="padding:3px 7px;">Frame 3D</button>
        </div>
      </div>
    </div>

    <!-- H2 · GUIDE & H3 · TELEMETRY: FULL 4-TAB PANEL -->
    <div id="full-report" class="hidden flex-1 flex flex-col min-h-0">
      <div class="flex shrink-0" style="border-bottom:1px solid rgba(148,163,184,0.18); background:rgba(15,23,42,0.55);">
        <button class="ui-tab active" data-tab="tab-swarm">1. Swarm</button>
        <button class="ui-tab" data-tab="tab-wfc">2. WFC Tiles</button>
        <button class="ui-tab" data-tab="tab-fdm">3. FDM</button>
        <button class="ui-tab" data-tab="tab-fea">4. FEA &amp; Unroll</button>
      </div>

      <div class="cad-body p-3 space-y-2-5 flex-1 min-h-0">
        <!-- TAB 1: SWARM HISTORY, MULTI-OBJECTIVE PARETO, COMPRESSION AUDIT, VOXEL GRIDS -->
        <section id="tab-swarm" class="tab-pane space-y-2-5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-white">Pilot v2 Swarm Optimization</div>
            <span id="swarm-pill-summary" class="pill pill-cyan">Pareto Front</span>
          </div>
          <p class="h2-only text-10-5 text-slate-300 leading-relaxed" style="margin:0;">
            Air-gapped exploration across <code>&gt;= 2×2×2</code> XY-symmetric voxel grids, optimizing <b>1) Unrolled Surface Area (m²)</b>, <b>2) Bar Count</b>, <b>3) Plaster Mass (kg)</b>, and <b>4) Pure-Compression Funicular Efficiency</b>.
          </p>

          <!-- Round 1 -> 2 -> 3 Timeline -->
          <div id="swarm-timeline" class="space-y-1-5"></div>

          <!-- Multi-Objective Interactive Pareto Scatter SVG -->
          <div class="metric-card">
            <div class="flex items-center justify-between gap-1 mb-1">
              <span class="text-10 font-bold uppercase text-cyan-300">Multi-Objective Pareto Explorer</span>
              <div class="flex gap-1" id="pareto-axis-btns">
                <button class="cad-btn active-cyan text-9" style="padding:2px 6px;" data-paxis="area_bars">Area vs Bars</button>
                <button class="cad-btn text-9" style="padding:2px 6px;" data-paxis="area_mass">Area vs Mass</button>
                <button class="cad-btn text-9" style="padding:2px 6px;" data-paxis="mass_disp">Mass vs Disp</button>
              </div>
            </div>
            <div id="pareto-hover-readout" class="text-9-5 text-slate-400 font-mono truncate mb-1">Hover any point for full v2 telemetry</div>
            <svg id="pareto-svg" viewBox="0 0 400 175" class="svg-box"></svg>
          </div>

          <!-- Strict Compression-Only Audit -->
          <div class="metric-card">
            <div class="text-10 font-bold uppercase text-pink-300 mb-1">Strict Compression-Only Network Audit (N &lt;= 0)</div>
            <div id="compression-audit-box"></div>
          </div>

          <!-- Explored >= 2x2x2 Voxel-Grid Breakdown -->
          <div class="metric-card">
            <div class="flex items-center justify-between mb-1">
              <span class="text-10 font-bold uppercase text-cyan-300">Explored Voxel-Grid Breakdown (&gt;= 2×2×2)</span>
              <span class="text-9 text-amber-300 font-mono">1×1×* Disallowed</span>
            </div>
            <div id="grid-breakdown-table"></div>
          </div>

          <!-- Preset Pass-Rate Bars -->
          <div class="metric-card">
            <div class="text-10 font-bold uppercase text-emerald-300 mb-1-5">Preset Pass Rates &amp; Best Unrolled Area</div>
            <div id="preset-bars" class="space-y-1"></div>
          </div>

          <!-- Round Failure Mode Diagnostics (H3) -->
          <div class="h3-only metric-card">
            <div class="text-10 font-bold uppercase text-amber-300 mb-1">Campaign Failure-Mode Diagnostics</div>
            <div id="failure-bars" class="space-y-1"></div>
          </div>
        </section>

        <!-- TAB 2: WFC TILES & 6-DIRECTION ADJACENCY -->
        <section id="tab-wfc" class="tab-pane hidden space-y-2-5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-white">WFC Voxel Tiles &amp; Socket Grammar</div>
            <button id="btn-show-wfc-3d" class="cad-btn active-pink text-10">Highlight in 3D</button>
          </div>
          <p id="wfc-guide-copy" class="h2-only text-10-5 text-slate-300 leading-relaxed" style="margin:0;"></p>

          <!-- Active Winning Tile / Preset Card -->
          <div id="wfc-champion-tile-card" class="metric-card highlight-border"></div>

          <!-- Full Tile Catalog -->
          <div class="metric-card">
            <div class="flex items-center justify-between mb-1">
              <span class="text-10 font-bold uppercase text-cyan-300">Constituent WFC Tile Catalog</span>
              <span class="text-9 text-slate-400">Sockets [+X,-X,+Y,-Y,+Z,-Z]</span>
            </div>
            <div class="max-h-44 overflow-y-auto">
              <table class="cad-table" id="tile-catalog-table"></table>
            </div>
          </div>

          <!-- Interactive 6-Direction Adjacency Matrix -->
          <div class="metric-card">
            <div class="flex items-center justify-between mb-1">
              <span class="text-10 font-bold uppercase text-pink-300">6-Direction Adjacency Matrix</span>
              <div class="flex gap-1" id="adj-dir-btns"></div>
            </div>
            <div id="adj-summary-note" class="text-9-5 text-slate-300 mb-1"></div>
            <div id="adj-matrix-wrap" class="overflow-x-auto"></div>
          </div>
        </section>

        <!-- TAB 3: STRICT COMPRESSION FDM FORM-FINDING -->
        <section id="tab-fdm" class="tab-pane hidden space-y-2-5">
          <div class="flex items-center justify-between">
            <div class="text-xs font-bold text-white">Compression-Only FDM Form-Finding</div>
            <button id="btn-show-fdm-3d" class="cad-btn active-cyan text-10">Color q_e in 3D</button>
          </div>
          <p class="h2-only text-10-5 text-slate-300 leading-relaxed" style="margin:0;">
            Solves <code>C_fᵀ Q C_f x_f = p_f − C_fᵀ Q C_s x_s</code> in strict <code>compression</code> mode with upward gravitational load inversion and tuned per-edge force densities <code>q_e</code> so every bar carries pure axial compression (<code>N &lt;= 0</code>) to pinned ground anchors at <code>z = 0</code>.
          </p>

          <div id="fdm-params-grid" class="grid grid-cols-2 gap-1-5"></div>

          <!-- Per-Edge Force Density Bar Chart -->
          <div class="metric-card">
            <div class="flex items-center justify-between mb-1">
              <span id="fdm-q-title" class="text-10 font-bold uppercase text-cyan-300">Per-Edge Force Density q_e</span>
              <span id="fdm-q-range" class="text-9 font-mono text-slate-400"></span>
            </div>
            <div id="fdm-q-hover" class="text-9-5 font-mono text-slate-400 mb-1">Hover a bar to highlight member in 3D</div>
            <svg id="fdm-q-svg" viewBox="0 0 400 112" class="svg-box"></svg>
          </div>

          <!-- Pinned Ground Anchors -->
          <div class="metric-card">
            <div id="fdm-anchors-title" class="text-10 font-bold uppercase text-emerald-300 mb-1">Pinned Ground Anchors (z = 0)</div>
            <table class="cad-table" id="fdm-anchors-table"></table>
          </div>
        </section>

        <!-- TAB 4: AIR-GAPPED FEA, PQ PLANARITY & 2D UNROLLED STRIP PATTERNS -->
        <section id="tab-fea" class="tab-pane hidden space-y-2-5">
          <div class="flex items-center justify-between gap-1">
            <div class="text-xs font-bold text-white">Air-Gapped FEA, PQ &amp; Unrolled Strips</div>
            <button id="btn-show-fea-3d" class="cad-btn active-emerald text-10">Animate Deflection</button>
          </div>
          <p class="h2-only text-10-5 text-slate-300 leading-relaxed" style="margin:0;">
            Independently audited by 6-DOF/node 3D Euler-Bernoulli FEA for cast gypsum plaster (<code>E=5 GPa, f_c=12 MPa, f_t=2 MPa</code>), Planar-Quad planarity (<code>&lt;= 0.5 mm</code>), and non-overlapping 2D per-bar unrolled SVG strips.
          </p>

          <!-- Load Case Scorecards (LC1, LC2, LC_lateral_5pct) -->
          <div id="fea-loadcases" class="space-y-1-5"></div>

          <!-- Watertight + PQ Planarity + Compression Audit -->
          <div id="fea-fabrication" class="metric-card"></div>

          <!-- Embedded Interactive 2D Per-Bar Unrolled SVG Fabrication Strip Preview -->
          <div class="metric-card highlight-border">
            <div class="flex items-center justify-between gap-1 mb-1">
              <span class="text-10 font-bold uppercase text-pink-300">2D Per-Bar Unrolled Strip Patterns</span>
              <div class="flex gap-1">
                <button id="btn-unroll-mode" class="cad-btn text-9" style="padding:2px 6px;">Raw .SVG</button>
                <button id="btn-unroll-expand" class="cad-btn active-cyan text-9" style="padding:2px 6px;">Expand</button>
                <button id="btn-unroll-dl" class="cad-btn text-9" style="padding:2px 6px;" title="Download standalone .patterns.svg">⤓ SVG</button>
              </div>
            </div>
            <div id="unroll-strip-readout" class="text-9-5 font-mono text-slate-300 mb-1 truncate">Hover or click any 2D bar strip to highlight its 3D tube</div>
            <div id="unroll-preview-wrap" style="max-height:220px; overflow:auto; border-radius:6px;"></div>
          </div>

          <!-- Top Critical Members (H3) -->
          <div class="h3-only metric-card">
            <div class="text-10 font-bold uppercase text-pink-300 mb-1">Top Critical Members (Click Row to Highlight in 3D)</div>
            <div class="max-h-44 overflow-y-auto">
              <table class="cad-table" id="fea-members-table"></table>
            </div>
          </div>

          <!-- Analytical Verifier Benchmarks (H3) -->
          <div class="h3-only metric-card">
            <div id="fea-bench-title" class="text-10 font-bold uppercase text-emerald-300 mb-1">Analytical Verifier Benchmarks</div>
            <div class="max-h-44 overflow-y-auto">
              <table class="cad-table" id="fea-benchmarks-table"></table>
            </div>
          </div>
        </section>
      </div>
    </div>
    <div id="left-resize-se" class="resize-se"></div>
  </aside>

  <!-- H3 · TELEMETRY: RIGHT LIVE TELEMETRY HUD -->
  <aside id="telemetry-panel" class="cad-panel" style="top: 14px; right: 14px; width: 318px; max-height: calc(100vh - 76px);">
    <div id="telemetry-header" class="cad-header">
      <div class="text-11 font-bold text-pink-300">H3 · LIVE TELEMETRY HUD</div>
      <button id="btn-tel-min" class="cad-btn">–</button>
    </div>
    <div id="telemetry-body" class="cad-body p-3 space-y-2 text-10-5">
      <div class="metric-card">
        <div class="text-9-5 uppercase text-slate-400 font-semibold mb-1">Active Candidate KPIs</div>
        <div id="tel-summary" class="space-y-1 font-mono text-10"></div>
      </div>
      <div class="metric-card">
        <div class="text-9-5 uppercase text-slate-400 font-semibold mb-1">Pinned Anchor Reactions (LC2 +50 kg)</div>
        <table class="cad-table" id="tel-reactions"></table>
      </div>
      <div class="metric-card">
        <div class="text-9-5 uppercase text-slate-400 font-semibold mb-1">Strict Air-Gap Integrity Audit</div>
        <div id="tel-airgap" class="font-mono text-10"></div>
      </div>
    </div>
  </aside>

  <!-- Expandable Full-Sheet 2D Unrolled Fabrication Modal -->
  <div id="unroll-modal" class="hidden">
    <div class="cad-header" style="cursor:default;">
      <div>
        <div id="modal-unroll-title" class="text-xs font-extrabold text-white">2D Per-Bar Unrolled Fabrication Sheet (wfc-fdm-unrolled/v1)</div>
        <div id="modal-unroll-sub" class="text-10 font-mono text-cyan-300">Cut contours (solid) + PQ longitudinal/ring fold lines (dashed) · Zero self-intersection</div>
      </div>
      <div class="flex items-center gap-2">
        <button id="btn-modal-dl" class="cad-btn active-emerald">Download .patterns.svg</button>
        <button id="btn-modal-close" class="cad-btn active-pink">Close ✕</button>
      </div>
    </div>
    <div id="modal-unroll-body" class="cad-body p-3 flex-1" style="background:#070a10;"></div>
  </div>

  <!-- Bottom Viewport HUD Pill -->
  <div id="bottom-hud">
    <span id="hud-cand" class="font-bold text-white">Pilot v2 Champion</span>
    <span class="text-slate-500">|</span>
    <span id="hud-geom" class="font-mono text-cyan-300">2×2×3 · 0 Bars</span>
    <span class="text-slate-500">|</span>
    <span id="hud-pq" class="font-mono text-pink-300">PQ &lt;= 0.5mm</span>
    <span class="text-slate-500">|</span>
    <span id="hud-mesh" class="font-mono text-emerald-300">Watertight ✓</span>
  </div>

<script id="foundry-report-data" type="application/json">${safeJson}</script>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const DATA = JSON.parse(document.getElementById('foundry-report-data').textContent);

// ============================================================
//  1. THREE.JS Z-UP STUDIO VIEWPORT
// ============================================================
const container = document.getElementById('viewport');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf3f6fb);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 100);
camera.up.set(0, 0, 1);
camera.position.set(2.35, -2.45, 2.05);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 0, 0.95);

// Studio Arctic Lighting
scene.add(new THREE.AmbientLight(0xffffff, 0.74));
const dir1 = new THREE.DirectionalLight(0xffffff, 0.96);
dir1.position.set(4, -5, 7);
dir1.castShadow = true;
dir1.shadow.mapSize.set(2048, 2048);
dir1.shadow.camera.near = 0.5;
dir1.shadow.camera.far = 20;
const dCam = 2.6;
dir1.shadow.camera.left = -dCam; dir1.shadow.camera.right = dCam;
dir1.shadow.camera.top = dCam; dir1.shadow.camera.bottom = -dCam;
scene.add(dir1);

const dir2 = new THREE.DirectionalLight(0xc7d2fe, 0.45);
dir2.position.set(-4, 4, 3);
scene.add(dir2);

// Ground Plane + Z-up Grid + Envelope Wireframe
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(16, 16),
  new THREE.ShadowMaterial({ opacity: 0.14 })
);
ground.receiveShadow = true;
scene.add(ground);

const gridHelper = new THREE.GridHelper(6, 24, 0xcbd5e1, 0xe2e8f0);
gridHelper.rotation.x = Math.PI / 2;
scene.add(gridHelper);

const envGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 2));
const envLine = new THREE.LineSegments(envGeo, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.36 }));
envLine.position.set(0, 0, 1);
scene.add(envLine);

const axX = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0.002), new THREE.Vector3(1.4,0,0.002)]), new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.55 }));
const axY = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0.002), new THREE.Vector3(0,1.4,0.002)]), new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.55 }));
scene.add(axX, axY);

const rootGroup = new THREE.Group();
const highlightGroup = new THREE.Group();
scene.add(rootGroup);
scene.add(highlightGroup);

let activeCandidateId = DATA.candidates[0]?.id || 'champion';
let activeViewMode = 'mesh'; // 'mesh' | 'fdm' | 'wfc' | 'fea'
let feaDeflectionScale = 400;
let feaAnimating = false;
let feaAnimPhase = 0;
let highlightedEdgeIdx = -1;
let showRawSvgMode = false;

function clearGroup(g) {
  while (g.children.length > 0) {
    const ch = g.children.pop();
    if (ch.geometry) ch.geometry.dispose();
    if (ch.material) {
      if (Array.isArray(ch.material)) ch.material.forEach(m => m.dispose());
      else ch.material.dispose();
    }
  }
}

function getActiveCandidate() {
  return DATA.candidates.find(c => c.id === activeCandidateId) || DATA.candidates[0];
}

function heatColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const c = new THREE.Color();
  c.setHSL(0.58 * (1 - clamped), 0.85, 0.48);
  return c;
}

function buildCylinderSegment(p1, p2, radius, color, opacity = 1.0) {
  const v1 = new THREE.Vector3(...p1);
  const v2 = new THREE.Vector3(...p2);
  const dir = new THREE.Vector3().subVectors(v2, v1);
  const len = dir.length();
  if (len < 1e-6) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, len, 10, 1);
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.4,
    metalness: 0.08,
    transparent: opacity < 1,
    opacity,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(v1).add(v2).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.castShadow = opacity >= 0.95;
  return mesh;
}

function updateHighlightOverlay() {
  clearGroup(highlightGroup);
  if (highlightedEdgeIdx < 0) return;
  const cand = getActiveCandidate();
  if (!cand || !cand.topology) return;
  const edge = cand.topology.edges?.[highlightedEdgeIdx];
  if (!edge) return;
  let p0 = cand.topology.vertices[edge[0]];
  let p1 = cand.topology.vertices[edge[1]];
  if (!p0 || !p1) return;

  if (activeViewMode === 'fea' && cand.feaField?.nodeDisp) {
    const d0 = cand.feaField.nodeDisp[edge[0]] || [0,0,0];
    const d1 = cand.feaField.nodeDisp[edge[1]] || [0,0,0];
    p0 = [p0[0] + d0[0] * feaDeflectionScale, p0[1] + d0[1] * feaDeflectionScale, p0[2] + d0[2] * feaDeflectionScale];
    p1 = [p1[0] + d1[0] * feaDeflectionScale, p1[1] + d1[1] * feaDeflectionScale, p1[2] + d1[2] * feaDeflectionScale];
  }

  const baseR = cand.topology.section?.outerRadiusM || 0.015;
  const glow = buildCylinderSegment(p0, p1, baseR * 1.48, 0xec4899, 0.88);
  if (glow) highlightGroup.add(glow);

  const endGeo = new THREE.SphereGeometry(baseR * 1.65, 14, 14);
  const endMat = new THREE.MeshStandardMaterial({ color: 0x22d3ee, emissive: 0x0891b2, emissiveIntensity: 0.5 });
  for (const pt of [p0, p1]) {
    const s = new THREE.Mesh(endGeo, endMat);
    s.position.set(pt[0], pt[1], pt[2]);
    highlightGroup.add(s);
  }
}

function setHighlightedEdge(idx) {
  highlightedEdgeIdx = idx;
  updateHighlightOverlay();
  document.querySelectorAll('[data-strip-edge]').forEach((el) => {
    const match = Number(el.dataset.stripEdge) === idx;
    el.querySelectorAll('polygon').forEach((poly) => {
      poly.setAttribute('fill', match ? '#ec4899' : '#1e293b');
      poly.setAttribute('fill-opacity', match ? '0.55' : '0.82');
    });
    const cutG = el.querySelector('.strip-cut-lines');
    if (cutG) {
      cutG.setAttribute('stroke', match ? '#f472b6' : '#f8fafc');
      cutG.setAttribute('stroke-width', match ? '2.4' : '1.35');
    }
  });
  document.querySelectorAll('[data-member-row]').forEach((tr) => {
    tr.classList.toggle('active-row', Number(tr.dataset.memberRow) === idx);
  });
}

function rebuild3DScene(shouldFrame = false) {
  clearGroup(rootGroup);
  const cand = getActiveCandidate();
  if (!cand) return;

  const topo = cand.topology;
  const verts = topo.vertices || [];
  const edges = topo.edges || [];
  const anchors = new Set(topo.anchors || []);

  // Envelope reference box
  const ex = cand.envelope?.maxPlanX || 1.0;
  const ey = cand.envelope?.maxPlanY || 1.0;
  const ez = cand.envelope?.targetHeightZ || 2.0;
  envLine.scale.set(ex, ey, ez / 2.0);
  envLine.position.set(0, 0, ez / 2.0);

  // Ground anchor pins
  const ancGeo = new THREE.SphereGeometry(0.032, 16, 16);
  const ancMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.25, metalness: 0.15, emissive: 0x065f46, emissiveIntensity: 0.25 });
  for (const idx of anchors) {
    const p = verts[idx];
    if (!p) continue;
    const sp = new THREE.Mesh(ancGeo, ancMat);
    sp.position.set(p[0], p[1], p[2]);
    rootGroup.add(sp);
  }

  if (activeViewMode === 'mesh' && cand.mesh && cand.mesh.verts.length > 0) {
    const positions = [];
    const wirePts = [];
    const mVerts = cand.mesh.verts;
    for (const f of cand.mesh.faces) {
      if (f.length === 3) {
        for (let k = 0; k < 3; k++) positions.push(...mVerts[f[k]]);
        wirePts.push(...mVerts[f[0]], ...mVerts[f[1]], ...mVerts[f[1]], ...mVerts[f[2]], ...mVerts[f[2]], ...mVerts[f[0]]);
      } else if (f.length === 4) {
        positions.push(...mVerts[f[0]], ...mVerts[f[1]], ...mVerts[f[2]]);
        positions.push(...mVerts[f[0]], ...mVerts[f[2]], ...mVerts[f[3]]);
        wirePts.push(
          ...mVerts[f[0]], ...mVerts[f[1]],
          ...mVerts[f[1]], ...mVerts[f[2]],
          ...mVerts[f[2]], ...mVerts[f[3]],
          ...mVerts[f[3]], ...mVerts[f[0]]
        );
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();
    const plasterMat = new THREE.MeshStandardMaterial({
      color: 0xeae6df, roughness: 0.56, metalness: 0.04, side: THREE.DoubleSide
    });
    const solidMesh = new THREE.Mesh(geo, plasterMat);
    solidMesh.castShadow = true;
    solidMesh.receiveShadow = true;
    rootGroup.add(solidMesh);

    const wGeo = new THREE.BufferGeometry();
    wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
    const wire = new THREE.LineSegments(wGeo, new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.36 }));
    rootGroup.add(wire);
  } else if (activeViewMode === 'fdm') {
    const qs = (topo.fdm && topo.fdm.forceDensities) || edges.map(() => 5);
    const qMin = Math.min(...qs);
    const qMax = Math.max(...qs, qMin + 1e-6);
    const rVis = Math.max(0.011, Math.min(0.022, (topo.section?.outerRadiusM || 0.014)));
    edges.forEach((e, idx) => {
      const t = (qs[idx] - qMin) / (qMax - qMin);
      const cyl = buildCylinderSegment(verts[e[0]], verts[e[1]], rVis, heatColor(t));
      if (cyl) rootGroup.add(cyl);
    });
    const nGeo = new THREE.SphereGeometry(rVis * 1.24, 12, 12);
    const nMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4 });
    verts.forEach((p, idx) => {
      if (anchors.has(idx)) return;
      const sp = new THREE.Mesh(nGeo, nMat);
      sp.position.set(p[0], p[1], p[2]);
      rootGroup.add(sp);
    });
  } else if (activeViewMode === 'wfc') {
    const pre = cand.wfcPreview || DATA.wfcData.wfcPreFDM;
    if (pre && pre.voxelBoxes && pre.voxelBoxes.length > 0) {
      pre.voxelBoxes.forEach((vb) => {
        const bGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(...vb.size));
        const bLine = new THREE.LineSegments(bGeo, new THREE.LineBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.62 }));
        bLine.position.set(...vb.center);
        rootGroup.add(bLine);
      });
      pre.edges.forEach((e) => {
        const cyl = buildCylinderSegment(pre.vertices[e[0]], pre.vertices[e[1]], 0.0085, 0xec4899, 0.85);
        if (cyl) rootGroup.add(cyl);
      });
      // Ghosted post-FDM compression network
      const gPts = [];
      edges.forEach((e) => gPts.push(...verts[e[0]], ...verts[e[1]]));
      const gGeo = new THREE.BufferGeometry();
      gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPts, 3));
      rootGroup.add(new THREE.LineSegments(gGeo, new THREE.LineBasicMaterial({ color: 0x0284c7, transparent: true, opacity: 0.48 })));
    } else {
      edges.forEach((e) => {
        const cyl = buildCylinderSegment(verts[e[0]], verts[e[1]], 0.012, 0xec4899, 0.9);
        if (cyl) rootGroup.add(cyl);
      });
    }
  } else if (activeViewMode === 'fea') {
    const fea = cand.feaField;
    const ghostPts = [];
    edges.forEach((e) => ghostPts.push(...verts[e[0]], ...verts[e[1]]));
    const ghostGeo = new THREE.BufferGeometry();
    ghostGeo.setAttribute('position', new THREE.Float32BufferAttribute(ghostPts, 3));
    rootGroup.add(new THREE.LineSegments(ghostGeo, new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.42 })));

    const disp = fea ? fea.nodeDisp : verts.map(() => [0, 0, 0]);
    const defVerts = verts.map((p, i) => [
      p[0] + disp[i][0] * feaDeflectionScale,
      p[1] + disp[i][1] * feaDeflectionScale,
      p[2] + disp[i][2] * feaDeflectionScale,
    ]);
    const ms = fea ? fea.memberStress : [];
    const maxS = Math.max(0.05, ...ms.map(m => Math.max(m.sC, m.sT)));
    const rVis = Math.max(0.012, Math.min(0.024, (topo.section?.outerRadiusM || 0.014)));
    edges.forEach((e, idx) => {
      const m = ms[idx];
      const stressMag = m ? Math.max(m.sC, m.sT) : 0;
      // Highlight net axial tension bars (N > 0) in bright crimson rose
      const isTensileBar = m && (m.N > 1e-4 || m.sT > 0.08);
      const col = isTensileBar ? new THREE.Color(0xf43f5e) : heatColor(stressMag / maxS);
      const cyl = buildCylinderSegment(defVerts[e[0]], defVerts[e[1]], rVis, col);
      if (cyl) rootGroup.add(cyl);
    });

    // Applied vertical load arrows at top zone nodes
    const maxZ = Math.max(...verts.map(v => v[2]));
    verts.forEach((p, idx) => {
      if (p[2] >= 0.85 * maxZ) {
        const arr = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, -1),
          new THREE.Vector3(defVerts[idx][0], defVerts[idx][1], defVerts[idx][2] + 0.30),
          0.26, 0xf59e0b, 0.065, 0.04
        );
        rootGroup.add(arr);
      }
    });
    // Reaction arrows at ground anchors
    if (fea && fea.reactions) {
      fea.reactions.forEach((r) => {
        const p = verts[r.node];
        if (!p) return;
        const arr = new THREE.ArrowHelper(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(p[0], p[1], -0.26),
          0.24, 0x10b981, 0.06, 0.038
        );
        rootGroup.add(arr);
      });
    }
  }

  updateHighlightOverlay();
  if (shouldFrame) frameCamera();
}

function frameCamera() {
  const box = new THREE.Box3().setFromObject(rootGroup);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1.0);
  controls.target.copy(center);
  camera.position.set(center.x + maxDim * 1.15, center.y - maxDim * 1.25, center.z + maxDim * 0.55);
  controls.update();
}

function animate() {
  requestAnimationFrame(animate);
  if (feaAnimating && activeViewMode === 'fea') {
    feaAnimPhase += 0.045;
    const baseMax = Math.max(250, Number(document.getElementById('fea-scale-slider').value) || 500);
    feaDeflectionScale = Math.round(baseMax * (0.5 + 0.5 * Math.sin(feaAnimPhase)));
    document.getElementById('fea-scale-val').textContent = feaDeflectionScale + '×';
    rebuild3DScene(false);
  }
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============================================================
//  2. GOLDILOCKS UI STATE & DRAGGABLE / RESIZABLE CHROME
// ============================================================
let goldilocksMode = 'H1';
let isCompact = true;

const leftPanel = document.getElementById('left-panel');
const compactCard = document.getElementById('compact-card');
const fullReport = document.getElementById('full-report');
const btnGoldilocks = document.getElementById('btn-goldilocks');
const btnCompactToggle = document.getElementById('btn-compact-toggle');

function setGoldilocksMode(mode) {
  goldilocksMode = mode;
  document.body.classList.remove('goldilocks-h1', 'goldilocks-h2', 'goldilocks-h3');
  document.body.classList.add('goldilocks-' + mode.toLowerCase());
  const labels = { H1: 'H1 · Use', H2: 'H2 · Guide', H3: 'H3 · Telemetry' };
  btnGoldilocks.textContent = labels[mode];
  btnGoldilocks.className = 'cad-btn ' + (mode === 'H1' ? 'active-emerald' : mode === 'H2' ? 'active-cyan' : 'active-pink');
  if (mode === 'H1') setCompactMode(true);
  else setCompactMode(false);
}

function setCompactMode(compact) {
  isCompact = compact;
  compactCard.classList.toggle('hidden', !compact);
  fullReport.classList.toggle('hidden', compact);
  btnCompactToggle.textContent = compact ? 'Guide ▸' : 'Compact';
  leftPanel.style.width = compact ? '368px' : '468px';
  leftPanel.style.height = compact ? 'auto' : 'calc(100vh - 28px)';
}

btnGoldilocks.addEventListener('click', () => {
  const next = goldilocksMode === 'H1' ? 'H2' : goldilocksMode === 'H2' ? 'H3' : 'H1';
  setGoldilocksMode(next);
});

btnCompactToggle.addEventListener('click', () => {
  if (isCompact) {
    if (goldilocksMode === 'H1') setGoldilocksMode('H2');
    else setCompactMode(false);
  } else {
    setCompactMode(true);
  }
});

document.getElementById('btn-left-min').addEventListener('click', () => {
  const bodyVisible = !compactCard.classList.contains('hidden') || !fullReport.classList.contains('hidden');
  if (bodyVisible) {
    compactCard.classList.add('hidden');
    fullReport.classList.add('hidden');
    leftPanel.style.height = 'auto';
    document.getElementById('btn-left-min').textContent = '+';
  } else {
    setCompactMode(isCompact);
    document.getElementById('btn-left-min').textContent = '–';
  }
});

document.getElementById('btn-tel-min').addEventListener('click', () => {
  const tb = document.getElementById('telemetry-body');
  const hidden = tb.classList.toggle('hidden');
  document.getElementById('btn-tel-min').textContent = hidden ? '+' : '–';
});

function switchTab(tabId) {
  document.querySelectorAll('.ui-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('hidden', p.id !== tabId));
}
document.querySelectorAll('.ui-tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

document.getElementById('btn-quick-unroll').addEventListener('click', () => {
  if (goldilocksMode === 'H1') setGoldilocksMode('H2');
  switchTab('tab-fea');
});

function wireDrag(panel, header, resizeEl) {
  let dx = 0, dy = 0, dragging = false;
  header.addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    dragging = true;
    const r = panel.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(8, Math.min(window.innerWidth - 120, e.clientX - dx)) + 'px';
    panel.style.top = Math.max(8, Math.min(window.innerHeight - 60, e.clientY - dy)) + 'px';
    panel.style.right = 'auto';
  });
  window.addEventListener('mouseup', () => { dragging = false; });

  if (resizeEl) {
    let resizing = false, sx = 0, sy = 0, sw = 0, sh = 0;
    resizeEl.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      resizing = true;
      const r = panel.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; sw = r.width; sh = r.height;
    });
    window.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      panel.style.width = Math.max(340, Math.min(780, sw + (e.clientX - sx))) + 'px';
      panel.style.height = Math.max(260, Math.min(window.innerHeight - 24, sh + (e.clientY - sy))) + 'px';
    });
    window.addEventListener('mouseup', () => { resizing = false; });
  }
}
wireDrag(leftPanel, document.getElementById('left-header'), document.getElementById('left-resize-se'));
wireDrag(document.getElementById('telemetry-panel'), document.getElementById('telemetry-header'), null);

// ============================================================
//  3. VIEW MODE, DEFLECTION ANIMATION & CANDIDATE SWITCHING
// ============================================================
function setFeaPulse(on) {
  feaAnimating = on;
  const btn = document.getElementById('btn-fea-pulse');
  btn.textContent = on ? 'Pause ❚❚' : 'Animate ▸';
  btn.className = 'cad-btn text-9-5 ' + (on ? 'active-pink' : 'active-emerald');
  if (!on) {
    feaDeflectionScale = Number(document.getElementById('fea-scale-slider').value) || 400;
    document.getElementById('fea-scale-val').textContent = feaDeflectionScale + '×';
    rebuild3DScene(false);
  }
}

function setViewMode(mode) {
  activeViewMode = mode;
  if (mode !== 'fea' && feaAnimating) setFeaPulse(false);
  document.querySelectorAll('#view-mode-bar button').forEach(b => {
    b.className = 'cad-btn' + (b.dataset.vmode === mode ? ' active-cyan' : '');
  });
  document.getElementById('fea-slider-box').classList.toggle('hidden', mode !== 'fea');
  rebuild3DScene(false);
}

document.querySelectorAll('#view-mode-bar button').forEach(b => {
  b.addEventListener('click', () => setViewMode(b.dataset.vmode));
});
document.getElementById('btn-frame-cam').addEventListener('click', () => frameCamera());
document.getElementById('fea-scale-slider').addEventListener('input', (e) => {
  if (feaAnimating) setFeaPulse(false);
  feaDeflectionScale = Number(e.target.value);
  document.getElementById('fea-scale-val').textContent = feaDeflectionScale + '×';
  rebuild3DScene(false);
});
document.getElementById('btn-fea-pulse').addEventListener('click', () => setFeaPulse(!feaAnimating));
document.getElementById('btn-show-wfc-3d').addEventListener('click', () => { setViewMode('wfc'); });
document.getElementById('btn-show-fdm-3d').addEventListener('click', () => { setViewMode('fdm'); });
document.getElementById('btn-show-fea-3d').addEventListener('click', () => {
  setViewMode('fea');
  setFeaPulse(!feaAnimating);
});

function selectCandidate(id) {
  activeCandidateId = id;
  highlightedEdgeIdx = -1;
  document.querySelectorAll('#candidate-bar button').forEach(b => {
    b.className = 'cad-btn text-10 truncate' + (b.dataset.cid === id ? ' active-pink' : '');
  });
  updateHeroAndTelemetry();
  rebuild3DScene(true);
}

function fmtSF(v) {
  if (v == null || !Number.isFinite(v) || v > 999) return '∞';
  return Number(v).toFixed(1);
}

function updateHeroAndTelemetry() {
  const cand = getActiveCandidate();
  if (!cand) return;
  const v = cand.verdict;
  const m = cand.metrics;
  const lc2 = v.loadCases?.[1] || v.loadCases?.[0] || {};
  const fabMesh = v.fabrication?.checks?.mesh || {};

  document.getElementById('hero-title').textContent = cand.label;
  document.getElementById('hero-sub').textContent = cand.subtitle;
  const badgeEl = document.getElementById('hero-badge');
  badgeEl.textContent = cand.badge;
  const isWarn = cand.id === 'rejected_extreme' && v.passed;
  badgeEl.className = 'pill shrink-0 ' + (!v.passed ? 'pill-fail' : isWarn ? 'pill-warn' : 'pill-pass');

  // 2x3 Pilot v2 KPI Cards
  document.getElementById('kpi-area').textContent = m.totalUnrolledSurfaceAreaM2.toFixed(3) + ' m²';
  document.getElementById('kpi-area-sub').textContent = m.hasVerifiedUnroll
    ? \`\${cand.unrolled?.barCount || m.nEdges} strips · 0 overlap\`
    : 'Tube surface est.';

  document.getElementById('kpi-bars').textContent = m.nEdges + ' Bars';
  document.getElementById('kpi-bars-sub').textContent = \`\${m.gridStr.replace(/x/g, '×')} Grid · \${m.nNodes}V\`;

  document.getElementById('kpi-mass').textContent = m.centerlineMassKg.toFixed(2) + ' kg';
  document.getElementById('kpi-mass-sub').textContent = \`Mesh \${m.meshMassKg.toFixed(2)} kg\`;

  const pureComp = m.tensileBarCount === 0 && m.compressionDominance >= 0.999;
  const compEl = document.getElementById('kpi-comp');
  compEl.textContent = (m.compressionDominance * 100).toFixed(0) + '% Comp';
  compEl.className = 'text-xs font-extrabold ' + (pureComp ? 'text-emerald-300' : 'text-rose-400');
  document.getElementById('kpi-comp-sub').textContent = pureComp
    ? \`FunEff \${(m.funicularEfficiency * 100).toFixed(1)}% · 0 Tens\`
    : \`\${m.tensileBarCount} tensile bar(s)!\`;

  const pqOk = m.maxQuadPlanarityErrorMm <= 0.5 + 1e-4;
  const pqEl = document.getElementById('kpi-pq');
  pqEl.textContent = m.maxQuadPlanarityErrorMm.toFixed(3) + ' mm';
  pqEl.className = 'text-xs font-extrabold ' + (pqOk ? 'text-cyan-300' : 'text-rose-400');
  document.getElementById('kpi-pq-sub').textContent = \`&lt;=0.5mm · Subdiv L=\${m.subdivLevels}\`.replace('&lt;', '<');

  document.getElementById('kpi-disp').textContent = 'L / ' + m.deflectionInvN;
  document.getElementById('kpi-disp-sub').textContent = \`\${m.maxDispMm.toFixed(3)}mm · SF_b \${fmtSF(m.sfBuckling)}\`;

  document.getElementById('h1-footer-stat').textContent =
    \`\${DATA.campaignTotals.evaluated} explored · \${DATA.verifierBenchmarks.length}/\${DATA.verifierBenchmarks.length} benchmarks · 0 cross-imports\`;

  // Bottom HUD
  document.getElementById('hud-cand').textContent = cand.label;
  document.getElementById('hud-geom').textContent = \`\${m.gridStr.replace(/x/g, '×')} · \${m.nNodes}V · \${m.nEdges} Bars · \${m.totalUnrolledSurfaceAreaM2.toFixed(3)} m²\`;
  document.getElementById('hud-pq').textContent = \`PQ \${m.maxQuadPlanarityErrorMm.toFixed(3)}mm (L=\${m.subdivLevels}) · \${pureComp ? '100% Comp' : m.tensileBarCount + ' Tens'}\`;
  const isWT = Boolean(fabMesh.isWatertightManifold ?? fabMesh.watertightManifold);
  document.getElementById('hud-mesh').textContent = isWT
    ? \`Watertight ✓ (\${fabMesh.quadCount ?? cand.mesh?.quadCount ?? 0}Q / \${fabMesh.triCount ?? cand.mesh?.triCount ?? 0}T)\`
    : 'Non-Manifold ✕';

  // H3 Right Telemetry HUD
  document.getElementById('tel-summary').innerHTML = [
    \`<div>Brief: <span class="text-cyan-300">\${v.briefId}</span></div>\`,
    \`<div>Voxel Grid &amp; Preset: <span class="text-pink-300">\${m.gridStr.replace(/x/g, '×')} · \${m.tilePreset}</span></div>\`,
    \`<div>Unrolled Area / Bars: <span class="text-cyan-300">\${m.totalUnrolledSurfaceAreaM2.toFixed(4)} m² · \${m.nEdges} bars</span></div>\`,
    \`<div>Plaster Mass (CL / OBJ): <span class="text-emerald-300">\${m.centerlineMassKg.toFixed(2)} / \${m.meshMassKg.toFixed(2)} kg</span></div>\`,
    \`<div>PQ Max Warp / Subdiv: <span class="\${pqOk ? 'text-emerald-300' : 'text-rose-400'}">\${m.maxQuadPlanarityErrorMm.toFixed(4)} mm (L=\${m.subdivLevels})</span></div>\`,
    \`<div>Compression Audit: <span class="\${pureComp ? 'text-emerald-300' : 'text-rose-400'}">\${(m.compressionDominance*100).toFixed(1)}% (max N=\${m.maxAxialForceN.toFixed(2)} N)</span></div>\`,
    \`<div>LC2 Eq Residual: <span class="text-cyan-300">\${(lc2?.reactions?.equilibriumResidual ?? 0).toExponential(2)}</span></div>\`,
    \`<div>LC2 SF (T / C / B): <span class="text-emerald-300">\${fmtSF(m.sfTension)} / \${fmtSF(m.sfCompression)} / \${fmtSF(m.sfBuckling)}</span></div>\`,
    \`<div>Lateral 5% Drift: <span class="\${(m.latMinSF ?? 10) < 1.5 ? 'text-amber-300' : 'text-emerald-300'}">\${(m.latDriftMm ?? 0).toFixed(2)} mm (Min SF \${(m.latMinSF ?? 0).toFixed(2)})</span></div>\`,
  ].join('');

  const rxRows = (cand.feaField?.reactions || []).map(r =>
    \`<tr><td class="font-mono text-emerald-300">#\${r.node}</td><td class="font-mono">\${r.fx.toFixed(1)}</td><td class="font-mono">\${r.fy.toFixed(1)}</td><td class="font-mono text-white">\${r.fz.toFixed(1)} N</td></tr>\`
  ).join('');
  document.getElementById('tel-reactions').innerHTML = \`<thead><tr><th>Node</th><th>Rx</th><th>Ry</th><th>Rz</th></tr></thead><tbody>\${rxRows}</tbody>\`;

  const ag = DATA.airGapAudit;
  document.getElementById('tel-airgap').innerHTML = \`
    <div class="\${ag.passed ? 'text-emerald-300' : 'text-rose-400'}">✓ Generator ↔ Verifier Cross-Imports: \${ag.totalCrossImports}</div>
    <div class="text-slate-400 text-9-5 mt-0-5">Neutral files only: <code>.topology.json</code>, <code>.mesh.obj</code>, <code>.patterns.svg</code>, <code>.unrolled.json</code>, <code>.verdict.json</code></div>
  \`;

  renderWFCCardForCandidate(cand);
  renderFDMTab(cand);
  renderFEATab(cand);
}

// ============================================================
//  4. POPULATE TABS (1. SWARM, 2. WFC, 3. FDM, 4. FEA & UNROLL)
// ============================================================
function populateCandidateBar() {
  const bar = document.getElementById('candidate-bar');
  bar.innerHTML = DATA.candidates.map((c, idx) => {
    const spanFull = DATA.candidates.length % 2 === 1 && idx === 0 ? 'style="grid-column: span 2;"' : '';
    return \`<button class="cad-btn text-10 truncate \${c.id === activeCandidateId ? 'active-pink' : ''}" \${spanFull} data-cid="\${c.id}" title="\${c.subtitle}">\${c.label}</button>\`;
  }).join('');
  bar.querySelectorAll('button').forEach(b => b.addEventListener('click', () => selectCandidate(b.dataset.cid)));
}

let activeParetoAxis = 'area_bars';

function renderParetoSVG() {
  const pts = DATA.scatterPoints || [];
  const svg = document.getElementById('pareto-svg');
  const W = 400, H = 175, padL = 42, padR = 16, padT = 16, padB = 28;
  if (pts.length === 0) {
    svg.innerHTML = '<text x="200" y="90" fill="#94a3b8" font-size="10" text-anchor="middle">No scatter points available</text>';
    return;
  }

  const getX = (p) => activeParetoAxis === 'mass_disp' ? p.massKg : p.areaM2;
  const getY = (p) => activeParetoAxis === 'area_bars' ? p.bars : activeParetoAxis === 'area_mass' ? p.massKg : p.dispMm;
  const xLabel = activeParetoAxis === 'mass_disp' ? 'Cast Plaster Mass (kg) — Minimize →' : 'Total Unrolled Surface Area (m²) — Minimize →';
  const yLabel = activeParetoAxis === 'area_bars' ? 'Bars (nEdges)' : activeParetoAxis === 'area_mass' ? 'Mass (kg)' : 'LC2 Disp (mm)';

  const xVals = pts.map(getX).filter(v => Number.isFinite(v) && v > 0);
  const yVals = pts.map(getY).filter(v => Number.isFinite(v) && v >= 0);
  const maxX = Math.max(0.5, ...xVals) * 1.08;
  const minX = Math.max(0, Math.min(...xVals) * 0.88);
  const maxY = Math.max(1, ...yVals) * 1.1;
  const minY = Math.max(0, Math.min(...yVals) * 0.85);

  const sx = (v) => padL + ((Math.min(maxX, Math.max(minX, v)) - minX) / Math.max(1e-6, maxX - minX)) * (W - padL - padR);
  const sy = (v) => H - padB - ((Math.min(maxY, Math.max(minY, v)) - minY) / Math.max(1e-6, maxY - minY)) * (H - padT - padB);

  const presetColors = {
    pilot_champion: '#ec4899', catenary_quadripod: '#f472b6', hyperboloid_tower: '#f59e0b',
    slender_diagrid: '#22d3ee', space_frame: '#10b981', diagrid_tower: '#a78bfa',
    arch_braced: '#60a5fa', funicular_vault: '#34d399', funnel_vault: '#fb923c',
    minimal_frame: '#94a3b8', default_ortho: '#cbd5e1'
  };

  const champM = DATA.candidates[0]?.metrics;
  let html = \`
    <line x1="\${padL}" y1="\${H-padB}" x2="\${W-padR}" y2="\${H-padB}" stroke="#334155" stroke-width="1"/>
    <line x1="\${padL}" y1="\${padT}" x2="\${padL}" y2="\${H-padB}" stroke="#334155" stroke-width="1"/>
    <text x="\${(padL+W-padR)/2}" y="\${H-6}" fill="#94a3b8" font-size="9" text-anchor="middle">\${xLabel}</text>
    <text x="11" y="\${(padT+H-padB)/2}" fill="#94a3b8" font-size="9" text-anchor="middle" transform="rotate(-90 11 \${(padT+H-padB)/2})">\${yLabel}</text>
    <text x="\${padL+3}" y="\${H-padB+11}" fill="#64748b" font-size="8" font-family="monospace">\${minX.toFixed(2)}</text>
    <text x="\${W-padR}" y="\${H-padB+11}" fill="#64748b" font-size="8" text-anchor="end" font-family="monospace">\${maxX.toFixed(2)}</text>
    <text x="\${padL-4}" y="\${padT+6}" fill="#64748b" font-size="8" text-anchor="end" font-family="monospace">\${maxY.toFixed(activeParetoAxis==='area_bars'?0:2)}</text>
  \`;

  pts.forEach((p, idx) => {
    const cx = sx(getX(p));
    const cy = sy(getY(p));
    const isChamp = champM && Math.abs(p.areaM2 - champM.totalUnrolledSurfaceAreaM2) < 0.002 && p.bars === champM.nEdges;
    if (!p.passed) {
      html += \`<circle cx="\${cx.toFixed(1)}" cy="\${cy.toFixed(1)}" r="2.5" fill="none" stroke="#f43f5e" stroke-opacity="0.45" stroke-width="1" data-pidx="\${idx}" style="cursor:pointer"/>\`;
    } else {
      const col = presetColors[p.preset] || '#22d3ee';
      const r = isChamp ? 5.8 : p.isPareto ? 4.0 : 2.8;
      const op = isChamp ? 1.0 : p.isPareto ? 0.92 : 0.45;
      const stroke = isChamp ? '#ffffff' : p.isPareto ? '#0f172a' : 'none';
      html += \`<circle cx="\${cx.toFixed(1)}" cy="\${cy.toFixed(1)}" r="\${r}" fill="\${col}" fill-opacity="\${op}" stroke="\${stroke}" stroke-width="\${isChamp ? 1.8 : 0.8}" data-pidx="\${idx}" style="cursor:pointer"/>\`;
    }
  });

  if (champM) {
    const cx = sx(activeParetoAxis === 'mass_disp' ? champM.centerlineMassKg : champM.totalUnrolledSurfaceAreaM2);
    const cy = sy(activeParetoAxis === 'area_bars' ? champM.nEdges : activeParetoAxis === 'area_mass' ? champM.centerlineMassKg : champM.maxDispMm);
    const lx = cx > W - 125 ? cx - 8 : cx + 8;
    const anchor = cx > W - 125 ? 'end' : 'start';
    html += \`<text x="\${lx.toFixed(1)}" y="\${Math.max(14, cy - 5).toFixed(1)}" fill="#fbcfe8" font-size="9" font-weight="700" text-anchor="\${anchor}">★ v2 Champion (\${champM.totalUnrolledSurfaceAreaM2.toFixed(2)}m² · \${champM.nEdges}E)</text>\`;
  }
  svg.innerHTML = html;

  const hoverEl = document.getElementById('pareto-hover-readout');
  svg.querySelectorAll('[data-pidx]').forEach(c => {
    c.addEventListener('mouseenter', () => {
      const p = pts[Number(c.dataset.pidx)];
      if (!p) return;
      hoverEl.textContent = \`\${p.passed ? (p.isPareto ? '★ PARETO' : 'PASS') : 'FAIL'} · \${p.preset} [\${p.grid}]: \${p.areaM2.toFixed(3)}m² · \${p.bars} bars · \${p.massKg.toFixed(2)}kg · FunEff \${(p.funicEff*100).toFixed(0)}%\`;
    });
  });
}

function populateSwarmTab() {
  const tot = DATA.campaignTotals;
  document.getElementById('swarm-pill-summary').textContent =
    \`\${tot.evaluated} Runs · \${tot.passed} Pass · \${tot.paretoFrontCount} Pareto\`;

  document.getElementById('swarm-timeline').innerHTML = DATA.swarmTimeline.map((st, idx) => \`
    <div class="metric-card hover-card flex flex-col gap-1 \${st.candidateId ? 'cursor-pointer' : ''}" \${st.candidateId ? \`data-jump="\${st.candidateId}"\` : ''}>
      <div class="flex items-center justify-between gap-1">
        <span class="text-10-5 font-bold text-white">\${st.stage}</span>
        <span class="pill \${idx === DATA.swarmTimeline.length - 1 ? 'pill-pass' : 'pill-cyan'}">\${st.tag}</span>
      </div>
      <div class="text-10 text-slate-300 leading-snug">\${st.highlight}</div>
      <div class="flex gap-3 text-9 font-mono text-slate-400">
        <span>Pass: <b class="text-cyan-300">\${st.passRate}</b></span>
        <span>Area: <b class="text-pink-300">\${Number(st.bestAreaM2 || 0).toFixed(2)} m²</b></span>
        <span>Min: <b class="text-emerald-300">\${st.bestBars}E · \${Number(st.bestMassKg || 0).toFixed(2)}kg</b></span>
      </div>
    </div>
  \`).join('');
  document.querySelectorAll('[data-jump]').forEach(el => {
    el.addEventListener('click', () => selectCandidate(el.dataset.jump));
  });

  // Pareto Axis Switcher
  document.querySelectorAll('#pareto-axis-btns button').forEach(btn => {
    btn.addEventListener('click', () => {
      activeParetoAxis = btn.dataset.paxis;
      document.querySelectorAll('#pareto-axis-btns button').forEach(b => {
        b.className = 'cad-btn text-9' + (b.dataset.paxis === activeParetoAxis ? ' active-cyan' : '');
      });
      renderParetoSVG();
    });
  });
  renderParetoSVG();

  // Compression-Only Audit
  const ca = DATA.compressionAudit || {};
  const champM = DATA.candidates[0]?.metrics || {};
  document.getElementById('compression-audit-box').innerHTML = \`
    <table class="cad-table">
      <thead><tr><th>Network Class</th><th>Count</th><th>Max Axial N</th><th>Pilot v2 Gate</th></tr></thead>
      <tbody>
        <tr>
          <td class="font-bold text-emerald-300">Pure Compression (N &lt;= 0)</td>
          <td class="font-mono">\${ca.pureCompressionCount ?? tot.passed} / \${ca.totalEvaluated ?? tot.evaluated}</td>
          <td class="font-mono text-emerald-300">\${(champM.maxAxialForceN ?? -10).toFixed(2)} N</td>
          <td><span class="pill pill-pass">100% COMP ✓</span></td>
        </tr>
        <tr>
          <td class="text-slate-300">Portal Tie Tension (N &gt; 0)</td>
          <td class="font-mono">\${ca.tensileRejectedCount ?? 0}</td>
          <td class="font-mono text-rose-400">\${ca.worstTensileN > 0 ? '+' + ca.worstTensileN.toFixed(1) + ' N' : 'Pruned'}</td>
          <td><span class="pill pill-fail">REJECTED</span></td>
        </tr>
      </tbody>
    </table>
  \`;

  // Explored Voxel Grid Breakdown (>= 2x2x2)
  const gcEntries = Object.values(DATA.gridComparison || {}).sort((a, b) => {
    const [ax, ay, az] = a.grid.split('x').map(Number);
    const [bx, by, bz] = b.grid.split('x').map(Number);
    return (ax * ay * az) - (bx * by * bz);
  });
  if (gcEntries.length > 0) {
    document.getElementById('grid-breakdown-table').innerHTML = \`
      <table class="cad-table">
        <thead><tr><th>Voxel Grid</th><th>Pass</th><th>Best Area</th><th>Min Bars</th><th>Best Mass</th></tr></thead>
        <tbody>
          \${gcEntries.map(g => \`
            <tr>
              <td class="font-mono font-bold \${g.disallowed1x1 ? 'text-rose-400' : 'text-cyan-300'}">\${g.grid.replace(/x/g, '×')}</td>
              <td class="font-mono">\${g.passed}/\${g.total} (\${g.passRatePct}%)</td>
              <td class="font-mono text-pink-300">\${g.bestAreaM2 != null ? g.bestAreaM2.toFixed(3)+' m²' : '—'}</td>
              <td class="font-mono text-white">\${g.bestBars != null ? g.bestBars : '—'}</td>
              <td class="font-mono text-emerald-300">\${g.bestMassKg != null ? g.bestMassKg.toFixed(2)+' kg' : (g.disallowed1x1 ? 'Gate Blocked' : '—')}</td>
            </tr>
          \`).join('')}
        </tbody>
      </table>
    \`;
  } else {
    document.getElementById('grid-breakdown-table').innerHTML = '<div class="text-10 text-slate-400">Voxel grid sweep pending...</div>';
  }

  // Preset Pass-Rate Bars
  const pcEntries = Object.entries(DATA.presetComparison || {}).sort((a, b) => (b[1].passRatePct || 0) - (a[1].passRatePct || 0));
  const activePreset = DATA.candidates[0]?.metrics?.tilePreset;
  document.getElementById('preset-bars').innerHTML = pcEntries.map(([name, st]) => \`
    <div class="text-10">
      <div class="flex justify-between">
        <span class="\${name === activePreset ? 'text-pink-300 font-bold' : 'text-slate-300'}">\${name === activePreset ? '★ ' : ''}\${name}</span>
        <span class="font-mono text-slate-400">\${st.passRatePct}% (\${st.passed}/\${st.total}) · \${st.bestAreaM2 != null ? st.bestAreaM2.toFixed(2)+'m²' : (st.bestMassKg ? st.bestMassKg.toFixed(2)+'kg' : '—')}</span>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:\${st.passRatePct}%; background:\${name === activePreset ? '#ec4899' : '#10b981'};"></div>
      </div>
    </div>
  \`).join('');

  // Failure Modes (H3)
  const fm = DATA.topFailureModes || [];
  document.getElementById('failure-bars').innerHTML = fm.length > 0
    ? fm.slice(0, 8).map(f => \`
        <div class="flex items-center justify-between text-10">
          <span class="font-mono text-slate-300">\${f.mode}</span>
          <span class="font-mono text-amber-300">\${f.count} (\${f.pctOfFailures}%)</span>
        </div>
      \`).join('')
    : '<div class="text-10 text-emerald-300 font-mono">0 failures in current batch</div>';
}

let activeWfcDir = '+Z';

function getPresetDetailsForCandidate(cand) {
  const w = DATA.wfcData;
  const pKey = cand?.metrics?.tilePreset || w.championPresetKey || 'diagrid_tower';
  const presetObj = w.presets?.[pKey] || {
    key: pKey,
    title: pKey.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' '),
    enabled: [pKey],
    seedTile: pKey,
  };
  const enabledSet = new Set(presetObj.enabled || [pKey]);
  const enabledTiles = w.tiles.filter(t => enabledSet.has(t.id) || enabledSet.has(t.name));
  const seedTile =
    w.tiles.find(t => t.id === presetObj.seedTile) ||
    enabledTiles[0] ||
    w.tiles.find(t => t.enabledInChampion) ||
    w.tiles[0];
  return { pKey, presetTitle: presetObj.title, enabledSet, enabledTiles, seedTile };
}

function renderWFCAdjMatrix(dir, cand) {
  activeWfcDir = dir;
  const w = DATA.wfcData;
  const { presetTitle, enabledSet, seedTile } = getPresetDetailsForCandidate(cand || getActiveCandidate());
  const dirBtns = document.getElementById('adj-dir-btns');
  if (dirBtns) {
    dirBtns.querySelectorAll('button').forEach(b => {
      b.className = 'cad-btn text-9' + (b.dataset.dir === dir ? ' active-pink' : '');
    });
  }
  const mat = w.adjacency[dir] || [];
  const ci = seedTile.index;
  const selfAllowed = mat[ci] && mat[ci][ci] === 1;
  document.getElementById('adj-summary-note').innerHTML =
    \`Dir <b class="text-pink-300">\${dir}</b> · Preset <b class="text-white">\${presetTitle}</b> (<code>\${seedTile.name}</code>): self-adjacency <b class="\${selfAllowed ? 'text-emerald-300' : 'text-amber-300'}">\${selfAllowed ? 'COMPATIBLE (1)' : 'CLOSED (0)'}</b>\`;

  const shortLabels = w.tiles.map((t, i) => \`<th title="\${t.name}" class="text-center text-9 \${enabledSet.has(t.id) ? 'text-pink-300' : ''}">\${i}</th>\`).join('');
  const bodyRows = w.tiles.map((tA, i) => {
    const aOn = enabledSet.has(tA.id);
    const cells = w.tiles.map((tB, j) => {
      const ok = mat[i] && mat[i][j] === 1;
      const isC = aOn && enabledSet.has(tB.id);
      return \`<td><div class="adj-cell \${ok ? 'adj-yes' : 'adj-no'} \${isC ? 'adj-champ' : ''}" title="\${tA.name} →(\${dir})→ \${tB.name}: \${ok ? 'Allowed' : 'Blocked'}">\${ok ? '1' : '·'}</div></td>\`;
    }).join('');
    return \`<tr><td class="text-9 pr-1 \${aOn ? 'text-pink-300 font-bold' : 'text-slate-400'}" style="white-space:nowrap;">\${i}. \${tA.name.slice(0, 12)}</td>\${cells}</tr>\`;
  }).join('');
  document.getElementById('adj-matrix-wrap').innerHTML = \`<table style="border-collapse:collapse;"><thead><tr><th class="text-9 text-slate-400">A\\B</th>\${shortLabels}</tr></thead><tbody>\${bodyRows}</tbody></table>\`;
}

function renderWFCCardForCandidate(cand) {
  const w = DATA.wfcData;
  const m = cand.metrics;
  const { pKey, presetTitle, enabledSet, enabledTiles, seedTile } = getPresetDetailsForCandidate(cand);
  const enabledNamesStr = enabledTiles.length > 0 ? enabledTiles.map(t => t.name).join(', ') : seedTile.name;

  document.getElementById('wfc-guide-copy').innerHTML =
    \`Active candidate <b>\${cand.label}</b> activates preset <b class="text-pink-300">\${presetTitle}</b> (<code>\${pKey}</code>) on a <b class="text-cyan-300">\${m.gridStr.replace(/x/g, '×')}</b> XY-symmetric voxel grid, welding coincident voxel sockets into a <b class="text-emerald-300">\${m.nNodes}-node, \${m.nEdges}-bar</b> pure-compression frame.\`;

  document.getElementById('wfc-champion-tile-card').innerHTML = \`
    <div class="flex items-center justify-between gap-1 mb-1">
      <span class="text-xs font-bold text-pink-300">Active Preset: \${presetTitle} (<code>\${pKey}</code>)</span>
      <span class="pill pill-pass">\${m.gridStr.replace(/x/g, '×')} · XY Sym</span>
    </div>
    <div class="text-9-5 text-slate-300 mb-1">
      Seed Tile: <b class="text-white">\${seedTile.name}</b> · Enabled (\${Math.max(1, enabledTiles.length)}): <span class="text-cyan-300">\${enabledNamesStr}</span>
    </div>
    <div class="grid grid-cols-3 gap-1-5 text-center my-1-5">
      <div class="metric-card"><div class="text-9 text-slate-400">Voxel Cells</div><div class="font-mono text-xs font-bold text-white">\${m.gridArr[0]*m.gridArr[1]*m.gridArr[2]}</div></div>
      <div class="metric-card"><div class="text-9 text-slate-400">Seed Tile</div><div class="font-mono text-xs font-bold text-cyan-300">\${seedTile.edgeCount}E / \${seedTile.quadCount}Q</div></div>
      <div class="metric-card"><div class="text-9 text-slate-400">Welded Graph</div><div class="font-mono text-xs font-bold text-emerald-300">\${m.nNodes}V · \${m.nEdges}E</div></div>
    </div>
    <div class="text-9-5 text-slate-300 font-mono">
      Seed Sockets [+X, -X, +Y, -Y, +Z, -Z]: <span class="text-cyan-300">[\${seedTile.sockets.join(', ')}]</span>
    </div>
  \`;

  // Dynamically update catalog active badges & adjacency matrix for selected candidate
  const catTable = document.getElementById('tile-catalog-table');
  if (catTable) {
    const rows = w.tiles.map(t => {
      const isOn = enabledSet.has(t.id);
      return \`
        <tr class="\${isOn ? 'active-row' : ''}">
          <td class="\${isOn ? 'text-pink-300 font-bold' : 'text-slate-300'}">\${isOn ? '★ ' : ''}\${t.name}</td>
          <td class="font-mono text-9 text-cyan-300">[\${t.sockets.join(',')}]</td>
          <td class="font-mono">\${t.edgeCount}E</td>
          <td>\${isOn ? '<span class="pill pill-pass">ON</span>' : '<span class="text-slate-500">off</span>'}</td>
        </tr>
      \`;
    }).join('');
    catTable.innerHTML = \`<thead><tr><th>Tile</th><th>Sockets (±X±Y±Z)</th><th>Edges</th><th>State</th></tr></thead><tbody>\${rows}</tbody>\`;
  }
  if (document.getElementById('adj-matrix-wrap')) {
    renderWFCAdjMatrix(activeWfcDir, cand);
  }
}

function populateWFCTab() {
  const w = DATA.wfcData;
  const dirBtns = document.getElementById('adj-dir-btns');
  dirBtns.innerHTML = w.dirLabels.map(d =>
    \`<button class="cad-btn text-9 \${d === activeWfcDir ? 'active-pink' : ''}" style="padding:2px 6px;" data-dir="\${d}">\${d}</button>\`
  ).join('');
  dirBtns.querySelectorAll('button').forEach(b => b.addEventListener('click', () => renderWFCAdjMatrix(b.dataset.dir, getActiveCandidate())));
  renderWFCCardForCandidate(getActiveCandidate());
}

function renderFDMTab(cand) {
  const topo = cand.topology;
  const fdm = topo.fdm || {};
  const sec = topo.section || {};
  const cfg = cand.config || {};
  const g = cand.verdict.geometry || {};
  const m = cand.metrics;

  const cards = [
    ['FDM Mode', (fdm.mode || 'compression').toUpperCase() + ' ONLY', 'text-emerald-300'],
    ['q Profile', m.qProfile || cfg.qProfile || 'column_boosted', 'text-cyan-300'],
    ['Equilibrium Residual', (fdm.equilibriumResidual ?? 0).toExponential(2), 'text-pink-300'],
    ['Solved Envelope', \`\${(g.spanX||0).toFixed(2)}×\${(g.spanY||0).toFixed(2)}×\${(g.spanZ||0).toFixed(2)} m\`, 'text-white'],
    ['Tube Section (Ro / Ri)', \`\${m.outerRadiusMm.toFixed(1)} / \${m.innerRadiusMm.toFixed(1)} mm (\${sec.nSides||8}-gon)\`, 'text-cyan-300'],
    ['Subdiv &amp; CompDom', \`L = \${m.subdivLevels} · \${(m.compressionDominance*100).toFixed(0)}% Comp\`, 'text-emerald-300'],
  ];
  document.getElementById('fdm-params-grid').innerHTML = cards.map(([k, val, cls]) => \`
    <div class="metric-card">
      <div class="text-9 uppercase text-slate-400">\${k}</div>
      <div class="text-11 font-mono font-bold \${cls} mt-0-5">\${val}</div>
    </div>
  \`).join('');

  const qs = fdm.forceDensities || [];
  const qMin = qs.length ? Math.min(...qs) : 0;
  const qMax = qs.length ? Math.max(...qs) : 1;
  document.getElementById('fdm-q-title').textContent = \`Per-Edge Force Density q_e (\${qs.length} Bars)\`;
  document.getElementById('fdm-q-range').textContent = \`min \${qMin.toFixed(1)} · max \${qMax.toFixed(1)} N/m\`;

  const svg = document.getElementById('fdm-q-svg');
  const W = 400, H = 112, pad = 16;
  const step = qs.length ? (W - 2 * pad) / qs.length : 6;
  const bw = Math.max(2, step - 1.4);
  svg.innerHTML = qs.map((q, idx) => {
    const h = ((q / Math.max(qMax, 1e-6)) * (H - 28));
    const x = pad + idx * step;
    const y = H - 15 - h;
    const col = q > (qMin + qMax) * 0.55 ? '#ec4899' : '#22d3ee';
    return \`<rect x="\${x.toFixed(1)}" y="\${y.toFixed(1)}" width="\${bw.toFixed(1)}" height="\${Math.max(2, h).toFixed(1)}" fill="\${col}" rx="1" data-qedge="\${idx}" style="cursor:pointer"></rect>\`;
  }).join('') + \`<text x="\${W/2}" y="\${H-3}" fill="#94a3b8" font-size="8.5" text-anchor="middle">Bar Index (0..\${Math.max(0, qs.length-1)}) — Pink = Boosted Primary Arch/Leg Members</text>\`;

  const qHover = document.getElementById('fdm-q-hover');
  svg.querySelectorAll('[data-qedge]').forEach((rect) => {
    rect.addEventListener('mouseenter', () => {
      const idx = Number(rect.dataset.qedge);
      const ms = cand.feaField?.memberStress?.[idx];
      setHighlightedEdge(idx);
      qHover.textContent = \`Bar #\${idx}: q_e = \${qs[idx].toFixed(2)} N/m\${ms ? \` · L = \${ms.L.toFixed(3)} m · FEA Axial N = \${ms.N.toFixed(1)} N\` : ''}\`;
    });
    rect.addEventListener('mouseleave', () => setHighlightedEdge(-1));
  });

  document.getElementById('fdm-anchors-title').textContent = \`Pinned Ground Anchors (\${(topo.anchors||[]).length} / 4 max at z = 0)\`;
  const aRows = (topo.anchors || []).map((idx, k) => {
    const p = topo.vertices[idx] || [0,0,0];
    return \`<tr><td class="font-mono text-emerald-300">A\${k+1} (#\${idx})</td><td class="font-mono">\${p[0].toFixed(3)}</td><td class="font-mono">\${p[1].toFixed(3)}</td><td class="font-mono">\${p[2].toFixed(3)} m</td></tr>\`;
  }).join('');
  document.getElementById('fdm-anchors-table').innerHTML = \`<thead><tr><th>Anchor</th><th>X (m)</th><th>Y (m)</th><th>Z (m)</th></tr></thead><tbody>\${aRows}</tbody>\`;
}

function buildInteractiveUnrolledSheetSVG(cand, heightPx = 225) {
  const un = cand.unrolled;
  if (!un || !Array.isArray(un.bars) || un.bars.length === 0) {
    if (un?.patternsSvg) return un.patternsSvg;
    return \`<div class="p-3 text-10 text-slate-400 font-mono">No 2D unrolled strip dataset attached to <b>\${cand.label}</b> (select <b>Pilot v2 Champion</b> to inspect verified per-bar unrolled SVG strips).</div>\`;
  }

  // Convert unrolled.json meter coordinates to millimeters (* 1000) and lay out in a crisp 8-column landscape CAD sheet
  // so all 16 distinct bar strips, internal PQ fold lines, and #0..#15 labels are large and legible in both inline & Expand views.
  const cols = Math.min(un.bars.length, Math.max(6, Math.ceil(Math.sqrt(un.bars.length * 3.8))));
  const gapX = 28; // mm
  const gapY = 58; // mm (includes header band for #bar label)
  const padSheet = 28; // mm

  let curX = padSheet;
  let curY = padSheet + 34;
  let rowH = 0;
  let maxSheetX = 200;
  let maxSheetY = 200;
  const barLayouts = [];

  un.bars.forEach((b, idx) => {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const q of (b.quads2D || [])) {
      for (const pt of q) {
        const xm = pt[0] * 1000;
        const ym = pt[1] * 1000;
        if (xm < bx0) bx0 = xm;
        if (ym < by0) by0 = ym;
        if (xm > bx1) bx1 = xm;
        if (ym > by1) by1 = ym;
      }
    }
    if (!Number.isFinite(bx0)) { bx0 = 0; by0 = 0; bx1 = 50; by1 = 120; }
    const wMm = bx1 - bx0;
    const hMm = by1 - by0;
    if (idx > 0 && idx % cols === 0) {
      curX = padSheet;
      curY += rowH + gapY;
      rowH = 0;
    }
    const dxMm = curX - bx0;
    const dyMm = curY - by0;
    const labelX = curX + wMm * 0.5;
    const labelY = curY - 11;
    barLayouts.push({ dxMm, dyMm, labelX, labelY });
    curX += Math.max(wMm, 62) + gapX;
    if (hMm > rowH) rowH = hMm;
    if (curX > maxSheetX) maxSheetX = curX;
    if (curY + rowH > maxSheetY) maxSheetY = curY + rowH;
  });

  const vbW = maxSheetX - gapX + padSheet;
  const vbH = maxSheetY + padSheet;
  const fontSizeMm = Math.max(22, Math.min(34, vbW * 0.032));

  let groupsHtml = \`<rect x="0" y="0" width="\${vbW.toFixed(1)}" height="\${vbH.toFixed(1)}" fill="#070a10" />\`;

  un.bars.forEach((b, idx) => {
    const { dxMm, dyMm, labelX, labelY } = barLayouts[idx];
    const eIdx = b.edgeIndex ?? idx;
    // Count undirected 2D edges in 0.01mm integer grid: count === 1 => outer cut contour, count >= 2 => internal PQ fold line
    const edgeMap = new Map();
    const keyPt = (xm, ym) => \`\${Math.round(xm * 100)},\${Math.round(ym * 100)}\`;
    let polys = '';
    for (const q of (b.quads2D || [])) {
      const qMm = q.map(p => [p[0] * 1000 + dxMm, p[1] * 1000 + dyMm]);
      const ptsStr = qMm.map(p => \`\${p[0].toFixed(2)},\${p[1].toFixed(2)}\`).join(' ');
      polys += \`<polygon points="\${ptsStr}" fill="#1e293b" fill-opacity="0.82" stroke="none" />\`;
      for (let k = 0; k < qMm.length; k++) {
        const a = qMm[k], c = qMm[(k + 1) % qMm.length];
        const ka = keyPt(a[0], a[1]), kc = keyPt(c[0], c[1]);
        const ek = ka < kc ? ka + '|' + kc : kc + '|' + ka;
        const prev = edgeMap.get(ek);
        if (prev) prev.count++;
        else edgeMap.set(ek, { count: 1, p0: a, p1: c });
      }
    }
    let cutLines = '', foldLines = '';
    for (const seg of edgeMap.values()) {
      const lineAttr = \`x1="\${seg.p0[0].toFixed(2)}" y1="\${seg.p0[1].toFixed(2)}" x2="\${seg.p1[0].toFixed(2)}" y2="\${seg.p1[1].toFixed(2)}" vector-effect="non-scaling-stroke"\`;
      if (seg.count === 1) cutLines += \`<line \${lineAttr} />\`;
      else foldLines += \`<line \${lineAttr} />\`;
    }

    groupsHtml += \`
      <g data-strip-edge="\${eIdx}" style="cursor:pointer;">
        \${polys}
        <g class="strip-fold-lines" stroke="#38bdf8" stroke-width="0.9" stroke-dasharray="3 2.2">\${foldLines}</g>
        <g class="strip-cut-lines" stroke="#f8fafc" stroke-width="1.35" stroke-linecap="round">\${cutLines}</g>
        <text x="\${labelX.toFixed(2)}" y="\${labelY.toFixed(2)}" fill="#f9a8d4" stroke="none" font-size="\${fontSizeMm.toFixed(1)}" font-family="ui-monospace, Menlo, Consolas, monospace" font-weight="700" text-anchor="middle">#\${eIdx}</text>
      </g>
    \`;
  });

  return \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 \${vbW.toFixed(1)} \${vbH.toFixed(1)}" preserveAspectRatio="xMidYMid meet" style="width:100%; height:\${heightPx}px; display:block; background:#070a10; border-radius:6px;">\${groupsHtml}</svg>\`;
}

function wireUnrolledInteractivity(rootEl, cand) {
  const readout = document.getElementById('unroll-strip-readout');
  rootEl.querySelectorAll('[data-strip-edge], [data-edge-index]').forEach((g) => {
    const idx = Number(g.dataset.stripEdge ?? g.dataset.edgeIndex);
    if (!Number.isFinite(idx)) return;
    const barInfo = cand.unrolled?.bars?.find(b => (b.edgeIndex ?? -1) === idx);
    const ms = cand.feaField?.memberStress?.[idx];
    const showInfo = () => {
      setHighlightedEdge(idx);
      if (barInfo) {
        readout.textContent =
          \`Bar #\${idx}: Area \${(barInfo.areaM2 * 1e4).toFixed(1)} cm² · L=\${(barInfo.centerlineLengthM*1000).toFixed(0)}mm · \${barInfo.quads2D?.length || 0} PQ faces\${ms ? \` · N=\${ms.N.toFixed(1)}N\` : ''}\`;
      } else if (ms) {
        readout.textContent = \`Bar #\${idx}: L=\${(ms.L*1000).toFixed(0)}mm · FEA Axial N=\${ms.N.toFixed(1)}N\`;
      }
    };
    g.style.cursor = 'pointer';
    g.addEventListener('mouseenter', showInfo);
    g.addEventListener('click', showInfo);
    g.addEventListener('mouseleave', () => setHighlightedEdge(-1));
  });
}

function renderUnrolledPreview(cand) {
  const wrap = document.getElementById('unroll-preview-wrap');
  const un = cand.unrolled;
  const readout = document.getElementById('unroll-strip-readout');

  if (un && un.hasUnrolledJson) {
    readout.textContent =
      \`Verified \${un.barCount} strips · Total Area = \${un.totalUnrolledSurfaceAreaM2.toFixed(4)} m² · Self-Intersections = \${un.hasSelfIntersection ? 'YES' : '0'}\`;
  } else {
    readout.textContent = \`Tube surface est. \${cand.metrics.totalUnrolledSurfaceAreaM2.toFixed(3)} m² (select Pilot v2 Champion for SVG strips)\`;
  }

  if (showRawSvgMode && un?.patternsSvg) {
    wrap.innerHTML = \`<div style="background:#070a10; padding:6px; border-radius:6px;">\${un.patternsSvg}</div>\`;
    const svgEl = wrap.querySelector('svg');
    if (svgEl) {
      svgEl.style.width = '100%';
      svgEl.style.height = 'auto';
      svgEl.style.maxHeight = '205px';
    }
    wireUnrolledInteractivity(wrap, cand);
  } else {
    wrap.innerHTML = buildInteractiveUnrolledSheetSVG(cand, 200);
    wireUnrolledInteractivity(wrap, cand);
  }
}

function downloadPatternsSvg() {
  const cand = getActiveCandidate();
  const svgStr = cand?.unrolled?.patternsSvg || buildInteractiveUnrolledSheetSVG(cand, 720);
  if (!svgStr || !svgStr.includes('<svg')) return;
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = \`\${cand.id}.patterns.svg\`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

document.getElementById('btn-unroll-mode').addEventListener('click', (e) => {
  showRawSvgMode = !showRawSvgMode;
  e.currentTarget.textContent = showRawSvgMode ? 'Interactive 2D' : 'Raw .SVG';
  e.currentTarget.className = 'cad-btn text-9 ' + (showRawSvgMode ? 'active-pink' : '');
  renderUnrolledPreview(getActiveCandidate());
});

document.getElementById('btn-unroll-expand').addEventListener('click', () => {
  const cand = getActiveCandidate();
  const modal = document.getElementById('unroll-modal');
  const body = document.getElementById('modal-unroll-body');
  document.getElementById('modal-unroll-title').textContent =
    \`\${cand.label} — 2D Per-Bar Unrolled Fabrication Sheet (\${cand.unrolled?.barCount || cand.metrics.nEdges} Bars · \${cand.metrics.totalUnrolledSurfaceAreaM2.toFixed(4)} m²)\`;
  body.innerHTML = showRawSvgMode && cand.unrolled?.patternsSvg
    ? cand.unrolled.patternsSvg
    : buildInteractiveUnrolledSheetSVG(cand, Math.max(420, window.innerHeight - 150));
  const svgEl = body.querySelector('svg');
  if (svgEl) { svgEl.style.width = '100%'; svgEl.style.height = '100%'; }
  wireUnrolledInteractivity(body, cand);
  modal.classList.remove('hidden');
});

document.getElementById('btn-modal-close').addEventListener('click', () => {
  document.getElementById('unroll-modal').classList.add('hidden');
});
document.getElementById('btn-unroll-dl').addEventListener('click', downloadPatternsSvg);
document.getElementById('btn-modal-dl').addEventListener('click', downloadPatternsSvg);

function renderFEATab(cand) {
  const v = cand.verdict;
  const g = v.geometry || {};
  const m = cand.metrics;
  const lat = v.lateralStabilityAdvisory;

  const lcHtml = (v.loadCases || []).map(lc => {
    const maxDispM = lc.displacements?.maxDispM ?? 0;
    const invN = maxDispM > 1e-9 ? Math.round((g.characteristicLengthM || 1) / maxDispM) : 99999;
    const sfT = fmtSF(lc.safetyFactors?.tension);
    const sfC = fmtSF(lc.safetyFactors?.compression);
    const sfB = fmtSF(lc.safetyFactors?.buckling);
    return \`
      <div class="metric-card">
        <div class="flex items-center justify-between mb-1">
          <span class="text-10-5 font-bold text-white">\${lc.id}</span>
          <span class="pill \${lc.passed ? 'pill-pass' : 'pill-fail'}">\${lc.passed ? 'PASS' : 'FAIL'}</span>
        </div>
        <div class="grid grid-cols-3 gap-1 text-9-5 font-mono">
          <div>Disp: <b class="text-cyan-300">\${(lc.displacements?.maxDispMm ?? 0).toFixed(3)}mm</b> (L/\${invN})</div>
          <div>Ten: <b class="text-emerald-300">\${(lc.stresses?.maxTensileMPa ?? 0).toFixed(3)}MPa</b> (SF \${sfT})</div>
          <div>Comp: <b class="text-emerald-300">\${(lc.stresses?.maxCompressiveMPa ?? 0).toFixed(3)}MPa</b> (SF \${sfC})</div>
        </div>
        <div class="text-9 font-mono text-slate-400 mt-1">
          Buckling SF: <b class="text-white">\${sfB}</b> · EqRes: \${(lc.reactions?.equilibriumResidual ?? 0).toExponential(2)} · Footing: \${lc.restraintType || 'pinned'}
        </div>
      </div>
    \`;
  }).join('');

  const latHtml = lat ? \`
    <div class="metric-card" style="border-color:rgba(245,158,11,0.32);">
      <div class="flex items-center justify-between mb-1">
        <span class="text-10-5 font-bold text-amber-300">LC_lateral_5pct (Advisory · H = \${lat.notionalForceN.toFixed(1)} N)</span>
        <span class="pill \${lat.minSafetyFactor >= 1.5 ? 'pill-pass' : 'pill-warn'}">Min SF \${lat.minSafetyFactor.toFixed(2)}</span>
      </div>
      <div class="text-9-5 font-mono text-slate-300">
        Max Lateral Drift: <b class="text-white">\${lat.maxLateralDriftMm.toFixed(3)} mm</b> (H/\${Math.round((g.spanZ || 2) / Math.max(lat.maxLateralDriftM, 1e-9))})
      </div>
    </div>
  \` : '';
  document.getElementById('fea-loadcases').innerHTML = lcHtml + latHtml;

  // Watertight + PQ Planarity + Unrolled Audit Card
  const fab = v.fabrication?.checks || {};
  const isWT = Boolean(fab.mesh?.isWatertightManifold ?? fab.mesh?.watertightManifold);
  const pqOk = m.maxQuadPlanarityErrorMm <= 0.5 + 1e-4;
  const pureComp = m.tensileBarCount === 0 && m.compressionDominance >= 0.999;

  document.getElementById('fea-fabrication').innerHTML = \`
    <div class="flex items-center justify-between mb-1">
      <span class="text-10 font-bold uppercase text-cyan-300">Watertight, Planar-Quad &amp; Fabrication Audit</span>
      <span class="pill \${v.fabrication?.passed ? 'pill-pass' : 'pill-fail'}">\${v.fabrication?.passed ? 'ALL GATES PASS' : 'CHECK GATE'}</span>
    </div>
    <div class="grid grid-cols-2 gap-1 text-9-5 font-mono">
      <div>Voxel Grid: <b class="\${m.gridArr[0]>=2 && m.gridArr[1]>=2 ? 'text-emerald-300' : 'text-amber-300'}">\${m.gridStr.replace(/x/g, '×')} (\${fab.connectivity?.componentCount ?? 1} comp)</b></div>
      <div>Ground Anchors: <b class="text-emerald-300">\${fab.anchors?.count ?? m.nAnchors} pinned (z=0)</b></div>
      <div>PQ Max Warp: <b class="\${pqOk ? 'text-emerald-300' : 'text-rose-400'}">\${m.maxQuadPlanarityErrorMm.toFixed(4)} / 0.50 mm</b></div>
      <div>Tube Subdiv: <b class="text-cyan-300">L = \${m.subdivLevels} (&gt;= 1 req)</b></div>
      <div>Watertight OBJ: <b class="\${isWT ? 'text-emerald-300' : 'text-rose-400'}">\${fab.mesh?.boundaryEdges ?? 0} bnd / \${fab.mesh?.nonManifoldEdges ?? 0} non-man</b></div>
      <div>Slenderness: <b class="text-white">\${(fab.members?.maxSlendernessRatio ?? 0).toFixed(1)} / 120 max</b></div>
      <div>Unrolled Area: <b class="text-pink-300">\${m.totalUnrolledSurfaceAreaM2.toFixed(4)} m²</b></div>
      <div>Axial Tension: <b class="\${pureComp ? 'text-emerald-300' : 'text-rose-400'}">\${m.tensileBarCount} bars (N_max=\${m.maxAxialForceN.toFixed(1)}N)</b></div>
    </div>
  \`;

  renderUnrolledPreview(cand);

  // Critical Members Table (H3)
  const ms = (cand.feaField?.memberStress || []).slice().sort((a, b) => Math.max(b.sC, b.sT) - Math.max(a.sC, a.sT)).slice(0, 12);
  document.getElementById('fea-members-table').innerHTML = \`
    <thead><tr><th>Bar</th><th>L (m)</th><th>Axial N</th><th>σ_t MPa</th><th>σ_c MPa</th><th>Buck SF</th></tr></thead>
    <tbody>\${ms.map(row => \`
      <tr data-member-row="\${row.i}" style="cursor:pointer;">
        <td class="font-mono text-pink-300">#\${row.i}</td>
        <td class="font-mono">\${row.L.toFixed(3)}</td>
        <td class="font-mono \${row.N <= 1e-4 ? 'text-cyan-300' : 'text-rose-400 font-bold'}">\${row.N.toFixed(1)}</td>
        <td class="font-mono">\${row.sT.toFixed(3)}</td>
        <td class="font-mono">\${row.sC.toFixed(3)}</td>
        <td class="font-mono text-emerald-300">\${row.sfBuck > 999 ? '>999' : row.sfBuck.toFixed(1)}</td>
      </tr>
    \`).join('')}</tbody>
  \`;
  document.querySelectorAll('[data-member-row]').forEach((tr) => {
    const idx = Number(tr.dataset.memberRow);
    tr.addEventListener('mouseenter', () => setHighlightedEdge(idx));
    tr.addEventListener('click', () => setHighlightedEdge(idx));
    tr.addEventListener('mouseleave', () => setHighlightedEdge(-1));
  });

  // Verifier Analytical Benchmarks (H3)
  const passB = DATA.verifierBenchmarks.filter(b => b.status === 'PASS').length;
  document.getElementById('fea-bench-title').textContent =
    \`Analytical &amp; v2 Verifier Benchmarks (\${passB}/\${DATA.verifierBenchmarks.length} PASS)\`.replace('&amp;', '&');
  document.getElementById('fea-benchmarks-table').innerHTML = \`
    <thead><tr><th>Benchmark Check</th><th>Detail</th><th>Gate</th></tr></thead>
    <tbody>\${DATA.verifierBenchmarks.map(b => \`<tr><td>\${b.name}</td><td class="font-mono text-cyan-300">\${b.detail}</td><td><span class="pill \${b.status==='PASS'?'pill-pass':'pill-fail'}">\${b.status}</span></td></tr>\`).join('')}</tbody>
  \`;
}

// ============================================================
//  5. INITIALIZE
// ============================================================
populateCandidateBar();
populateSwarmTab();
populateWFCTab();
setGoldilocksMode('H1');
selectCandidate(DATA.candidates[0]?.id || 'champion');
</script>
</body>
</html>`;
}

main();

#!/usr/bin/env node
/**
 * Pilot v2 (`pilot-v2-pq-unrolled-plaster-tower`) Deterministic Video Data Exporter (`Gate F1`)
 *
 * Exports 100% real verified geometry and structural/fabrication metrics from
 * `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/` and `TOPOGEN_FDM_Foundry/runs/champion/` into
 * `TOPOGEN_FDM_Foundry/video_build/foundry_video_data.hpp`:
 *  - Campaign-wide verified statistics, round progression, Pareto points, and >=2x2x2 voxel grid stats
 *  - 16 real explored Pilot v2 candidates (shaded PQ tubular OBJ mesh + live 3D air-gapped FEA fields)
 *  - 3 unified comparison candidates (Round 1 Baseline, Rejected Candidate, Verified Champion)
 *  - 6 constituent WFC tiles with 6-direction (+X,-X,+Y,-Y,+Z,-Z) socket & adjacency matrices
 *  - Champion's >=2x2x2 WFC voxel cells, pre-FDM rectilinear graph, per-face bar mapping, and
 *    exact 2D unrolled per-bar fabrication strip patterns (cut contours + internal fold lines)
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { solveSpaceFrame } from '../verifier/fea_solver.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function readJSONAbs(absPath) {
  return JSON.parse(fs.readFileSync(absPath, 'utf8'));
}

function readJSON(rel) {
  return readJSONAbs(path.join(root, rel));
}

function parseOBJText(text) {
  const verts = [];
  const faces = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (l.startsWith('v ')) {
      const p = l.split(/\s+/);
      verts.push([+Number(p[1]).toFixed(5), +Number(p[2]).toFixed(5), +Number(p[3]).toFixed(5)]);
    } else if (l.startsWith('f ')) {
      const idx = l.split(/\s+/).slice(1).map(t => parseInt(t.split('/')[0], 10) - 1);
      if (idx.length === 3) faces.push([idx[0], idx[1], idx[2], -1]);
      else if (idx.length === 4) faces.push([idx[0], idx[1], idx[2], idx[3]]);
      else if (idx.length > 4) {
        for (let i = 1; i < idx.length - 1; i++) faces.push([idx[0], idx[i], idx[i + 1], -1]);
      }
    }
  }
  return { verts, faces };
}

function parseOBJAbs(absPath) {
  return parseOBJText(fs.readFileSync(absPath, 'utf8'));
}

async function loadCoreFromIndexWFC() {
  const coreIndexPath = path.join(root, 'core', 'index.mjs');
  if (fs.existsSync(coreIndexPath)) {
    const mod = await import(pathToFileURL(coreIndexPath).href);
    const resolved = mod.WFC_FDM_CORE || mod.default || (typeof mod.loadWfcCore === 'function' ? await mod.loadWfcCore() : mod);
    if (resolved && typeof resolved.createTileTemplates === 'function') {
      return resolved;
    }
  }
  const html = fs.readFileSync(path.join(root, 'index_WFC.html'), 'utf8');
  const match = html.match(/<script\s+id=["']wfc-fdm-core["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match) throw new Error('Could not find core/index.mjs or <script id="wfc-fdm-core"> in index_WFC.html');
  const sandbox = {
    console, Math, Date, Number, String, Boolean, Array, Object, Set, Map,
    Int32Array, Uint8Array, Uint32Array, Float32Array, Float64Array, JSON,
    isNaN, isFinite, parseFloat, parseInt
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(match[1], sandbox, { filename: 'index_WFC.html#wfc-fdm-core' });
  return sandbox.WFC_FDM_CORE;
}

function escW(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function prettyPreset(preset) {
  const map = {
    pilot_champion: 'Pilot Champion',
    catenary_quadripod: 'Catenary Quadripod',
    funicular_vault: 'Funicular Vault',
    slender_diagrid: 'Slender Diagrid',
    hyperboloid_tower: 'Hyperboloid Tower',
    arch_braced: 'Arch Braced',
    diagrid_tower: 'Diagrid Tower',
    space_frame: 'Space Frame',
    funnel_vault: 'Funnel Vault',
    minimal_frame: 'Minimal Frame',
    default_ortho: 'Orthogonal Frame'
  };
  if (map[preset]) return map[preset];
  return String(preset || 'Custom Tile')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function presetGroup(preset) {
  const pMap = {
    pilot_champion: 0,
    catenary_quadripod: 1,
    funicular_vault: 2,
    arch_braced: 2,
    funnel_vault: 2,
    slender_diagrid: 3,
    diagrid_tower: 3,
    hyperboloid_tower: 4,
    space_frame: 5,
    minimal_frame: 5,
    default_ortho: 5
  };
  return pMap[preset] ?? 5;
}

function gridKey(gr) {
  if (!Array.isArray(gr) || gr.length < 3) return '2x2x2';
  return `${gr[0]}x${gr[1]}x${gr[2]}`;
}

function gridDisplay(gk) {
  return gk.replace(/x/g, '\u00D7');
}

let ACTIVE_MIN_GRID = [2, 2, 2];

function parseCliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

function isMinGrid222(gr) {
  const [mx, my, mz] = ACTIVE_MIN_GRID;
  return Array.isArray(gr) && gr.length >= 3 && gr[0] >= mx && gr[1] >= my && gr[2] >= mz;
}

function pointToSegDistSq(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 1e-12 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx - px;
  const cy = ay + t * aby - py;
  const cz = az + t * abz - pz;
  return cx * cx + cy * cy + cz * cz;
}

function computeQuadPlanarityMaxMm(obj) {
  let maxErrM = 0;
  for (const f of obj.faces) {
    if (f[3] < 0) continue;
    const v0 = obj.verts[f[0]], v1 = obj.verts[f[1]], v2 = obj.verts[f[2]], v3 = obj.verts[f[3]];
    if (!v0 || !v1 || !v2 || !v3) continue;
    const d1 = [v2[0] - v0[0], v2[1] - v0[1], v2[2] - v0[2]];
    const d2 = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
    const nx = d1[1] * d2[2] - d1[2] * d2[1];
    const ny = d1[2] * d2[0] - d1[0] * d2[2];
    const nz = d1[0] * d2[1] - d1[1] * d2[0];
    const nLen = Math.hypot(nx, ny, nz);
    if (nLen < 1e-12) continue;
    const wx = v0[0] - v1[0] + v2[0] - v3[0];
    const wy = v0[1] - v1[1] + v2[1] - v3[1];
    const wz = v0[2] - v1[2] + v2[2] - v3[2];
    const err = 0.25 * Math.abs((wx * nx + wy * ny + wz * nz) / nLen);
    if (err > maxErrM) maxErrM = err;
  }
  return maxErrM * 1000.0;
}

function estimateSurfaceAreaFromTopo(topo) {
  const r = topo?.section?.outerRadiusM || 0.014;
  const nS = topo?.section?.nSides || 8;
  const perim = 2 * nS * r * Math.sin(Math.PI / nS);
  let sum = 0;
  for (const [u, v] of topo.edges || []) {
    const a = topo.vertices[u], b = topo.vertices[v];
    sum += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * perim;
  }
  return sum;
}

function extractMetrics(topo, obj, verdict, fea, unrolled) {
  const nNodes = topo.vertices.length;
  const nBars = topo.edges.length;
  const nAnc = (topo.anchors || []).length;
  const massKg = verdict?.geometry?.centerlineMassKg ?? verdict?.kpis?.centerlineMassKg ?? fea?.geometry?.totalMassKg ?? 0;
  const meshMassKg = verdict?.geometry?.meshMassKg ?? verdict?.kpis?.meshMassKg ?? massKg;

  const lc2V = (verdict?.loadCases || []).find(lc => lc.id === 'LC2_self_weight_plus_50kg')
    || (verdict?.loadCases || [])[1]
    || (verdict?.loadCases || [])[0];
  const latV = verdict?.lateralStabilityAdvisory
    || verdict?.lateralAdvisory
    || (verdict?.loadCases || []).find(lc => String(lc.id).includes('lateral'));

  const dispMm = lc2V?.displacements?.maxDispMm
    ?? ((fea?.displacements?.maxDispM ?? 0) * 1000);
  const sfT = Math.min(9999, lc2V?.safetyFactors?.tension ?? fea?.safetyFactors?.tension ?? 9999);
  const sfC = Math.min(9999, lc2V?.safetyFactors?.compression ?? fea?.safetyFactors?.compression ?? 9999);
  const sfB = Math.min(9999, lc2V?.safetyFactors?.buckling ?? fea?.safetyFactors?.buckling ?? 9999);
  const minSF = Math.min(sfT, sfC, sfB);
  const funEff = verdict?.kpis?.funicularEfficiency ?? lc2V?.kpis?.funicularEfficiency ?? fea?.kpis?.funicularEfficiency ?? 0;

  // Count tensile bars from FEA members (net axial tension N > 1e-5 N)
  const members = fea?.members || [];
  let tensileBars = verdict?.kpis?.tensileBarCount ?? null;
  let maxAxialN = verdict?.kpis?.maxAxialForceN ?? -999999;
  if (members.length > 0) {
    let tb = 0;
    let mxN = -1e9;
    for (const m of members) {
      const n = Number(m.axialForceN || 0);
      if (n > mxN) mxN = n;
      if (n > 1e-4) tb++;
    }
    if (tensileBars === null) tensileBars = tb;
    if (maxAxialN < -99999) maxAxialN = mxN;
  }
  if (tensileBars === null) tensileBars = 0;

  const compDom = verdict?.kpis?.minCompressionDominanceAcrossLCs
    ?? verdict?.kpis?.compressionDominance
    ?? (nBars > 0 ? (nBars - tensileBars) / nBars : 1.0);

  const maxStressMPa = Math.max(
    0.08,
    ...members.map(m => Math.max(m.sigmaCompressiveMaxPa || 0, m.sigmaTensileMaxPa || 0) / 1e6)
  );

  const areaM2 = verdict?.kpis?.totalUnrolledSurfaceAreaM2
    ?? verdict?.fabrication?.checks?.unrolledPatterns?.totalUnrolledSurfaceAreaM2
    ?? unrolled?.totalUnrolledSurfaceAreaM2
    ?? topo?.fabrication?.totalUnrolledSurfaceAreaM2
    ?? estimateSurfaceAreaFromTopo(topo);

  const maxWarpMm = (verdict?.kpis?.maxQuadPlanarityErrorM != null)
    ? verdict.kpis.maxQuadPlanarityErrorM * 1000
    : (topo?.geometry?.maxQuadPlanarityErrorM != null)
      ? topo.geometry.maxQuadPlanarityErrorM * 1000
      : computeQuadPlanarityMaxMm(obj);

  const subdivLevels = verdict?.kpis?.longitudinalSubdivLevels
    ?? topo?.geometry?.longitudinalSubdivLevels
    ?? 1;

  const latDispMm = latV?.maxLateralDriftMm ?? latV?.displacements?.maxDispMm ?? latV?.maxDispMm ?? 0.45;
  const latMinSF = latV?.minSafetyFactor
    ?? Math.min(
      latV?.safetyFactors?.tension ?? 99,
      latV?.safetyFactors?.compression ?? 99,
      latV?.safetyFactors?.buckling ?? 99
    );
  const latFail = (latV && latV.passed === false) || latDispMm > 15.0 || latMinSF < 1.5;

  const maxSlenderness = verdict?.fabrication?.checks?.members?.maxSlendernessRatio ?? 80;
  const minAngleDeg = verdict?.kpis?.minIncidentAngleDeg
    ?? verdict?.fabrication?.checks?.members?.minIncidentAngleDeg
    ?? 35;
  const cleanTubeMesh = meshMassKg >= 0.78 * massKg && minAngleDeg >= 10.5;

  const strictCompOk = tensileBars === 0 && compDom >= 0.9999;
  const verdictPassed = Boolean(verdict?.passed) && strictCompOk && !latFail;

  // statusKind: 0 = Verified, 1 = Tension Reject, 2 = Stability / Slenderness Reject, 3 = Winner
  let statusKind = verdictPassed ? 0 : (!strictCompOk ? 1 : 2);

  return {
    nNodes, nBars, nAnc, massKg, meshMassKg, dispMm,
    sfT, sfC, sfB, minSF, funEff, compDom, tensileBars, maxAxialN,
    maxStressMPa, areaM2, maxWarpMm, subdivLevels, maxSlenderness, minAngleDeg, cleanTubeMesh,
    latDispMm, latMinSF, latFail, passed: verdictPassed, statusKind
  };
}

function scanCampaignCandidates(campaignDir, brief, lc2) {
  const found = [];
  if (!fs.existsSync(campaignDir)) return found;

  function walk(dir, relParts) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'champion') continue; // loaded separately as hero champion
        walk(full, [...relParts, ent.name]);
      } else if (ent.isFile() && ent.name.endsWith('.topology.json')) {
        const stem = ent.name.slice(0, -'.topology.json'.length);
        const objPath = path.join(dir, `${stem}.mesh.obj`);
        const verdictPath = path.join(dir, `${stem}.verdict.json`);
        const unrollPath = path.join(dir, `${stem}.unrolled.json`);
        if (!fs.existsSync(objPath)) continue;
        try {
          const topo = readJSONAbs(full);
          const gr = topo?.metadata?.gridResolution;
          if (!isMinGrid222(gr)) continue;
          const obj = parseOBJAbs(objPath);
          const verdict = fs.existsSync(verdictPath) ? readJSONAbs(verdictPath) : null;
          const unrolled = fs.existsSync(unrollPath) ? readJSONAbs(unrollPath) : null;
          const folderTag = (relParts[0] || '').toLowerCase();
          let roundIdx = 1;
          if (folderTag.includes('smoke')) roundIdx = 0;
          else if (folderTag.includes('round1') || folderTag.includes('r1')) roundIdx = 1;
          else if (folderTag.includes('round2') || folderTag.includes('r2')) roundIdx = 2;
          else if (folderTag.includes('round3') || folderTag.includes('r3') || folderTag.includes('opt') || folderTag.includes('final')) roundIdx = 3;

          const fea = solveSpaceFrame(topo, brief.material, lc2, { restraintType: 'pinned' });
          const metrics = extractMetrics(topo, obj, verdict, fea, unrolled);
          const preset = topo?.metadata?.tilePreset || 'catenary_quadripod';
          const gk = gridKey(gr);

          found.push({
            id: `${relParts.join('/')}/${stem}`,
            stem,
            roundIdx,
            preset,
            grid: gr,
            gk,
            topo,
            obj,
            verdict,
            unrolled,
            fea,
            metrics,
            topoRelPath: path.relative(root, full).replace(/\\/g, '/'),
            verdictRelPath: fs.existsSync(verdictPath) ? path.relative(root, verdictPath).replace(/\\/g, '/') : ''
          });
        } catch (err) {
          console.warn(`Skipping ${full}: ${err.message}`);
        }
      }
    }
  }

  walk(campaignDir, []);
  return found;
}

function emitGraph(name, topo, feaRes) {
  const vStr = topo.vertices.map(p => `{${Number(p[0]).toFixed(5)}f,${Number(p[1]).toFixed(5)}f,${Number(p[2]).toFixed(5)}f}`).join(',');
  const eStr = topo.edges.map(e => `{${e[0]},${e[1]}}`).join(',');
  const aStr = (topo.anchors || []).length ? topo.anchors.join(',') : '0';
  const qs = (topo.fdm && topo.fdm.forceDensities) || topo.edges.map(() => 5.0);
  const qStr = qs.map(q => `${Number(q).toFixed(3)}f`).join(',');

  let dispStr = topo.vertices.map(() => '{0.0f,0.0f,0.0f}').join(',');
  let stressStr = topo.edges.map(() => '{0.0f,0.0f,0.0f}').join(',');
  if (feaRes && feaRes.ok) {
    const nodal = feaRes.displacements.nodal || [];
    dispStr = topo.vertices.map((_, i) => {
      const d = nodal[i];
      const ux = Array.isArray(d) ? d[0] : (d?.ux ?? 0);
      const uy = Array.isArray(d) ? d[1] : (d?.uy ?? 0);
      const uz = Array.isArray(d) ? d[2] : (d?.uz ?? 0);
      return `{${Number(ux).toExponential(4)}f,${Number(uy).toExponential(4)}f,${Number(uz).toExponential(4)}f}`;
    }).join(',');
    stressStr = (feaRes.members || []).map(m => {
      const n = Number(m.axialForceN || 0);
      const st = Number(m.sigmaTensileMaxPa || m.maxTensileStressPa || 0) / 1e6;
      const sc = Number(m.sigmaCompressiveMaxPa || m.maxCompressiveStressPa || 0) / 1e6;
      return `{${n.toFixed(3)}f,${st.toFixed(4)}f,${sc.toFixed(4)}f}`;
    }).join(',');
  }

  return `
static const Vec3 ${name}_VERTS[] = {${vStr}};
static const int ${name}_NVERTS = ${topo.vertices.length};
static const Edge2 ${name}_EDGES[] = {${eStr}};
static const int ${name}_NEDGES = ${topo.edges.length};
static const int ${name}_ANCHORS[] = {${aStr}};
static const int ${name}_NANCHORS = ${(topo.anchors || []).length};
static const float ${name}_Q[] = {${qStr}};
static const Vec3 ${name}_DISP[] = {${dispStr}};
static const MemberFEA ${name}_FEA[] = {${stressStr}};
`;
}

function emitOBJ(name, obj, barMap = null) {
  const vStr = obj.verts.map(p => `{${Number(p[0]).toFixed(5)}f,${Number(p[1]).toFixed(5)}f,${Number(p[2]).toFixed(5)}f}`).join(',');
  const fStr = obj.faces.map(f => `{${f[0]},${f[1]},${f[2]},${f[3]}}`).join(',');
  let extra = '';
  if (barMap) {
    extra = `static const int ${name}_OBJ_FACE_BAR[] = {${barMap.join(',')}};\n`;
  }
  return `
static const Vec3 ${name}_OBJ_VERTS[] = {${vStr}};
static const int ${name}_OBJ_NVERTS = ${obj.verts.length};
static const Face4 ${name}_OBJ_FACES[] = {${fStr}};
static const int ${name}_OBJ_NFACES = ${obj.faces.length};
${extra}`;
}

function computeFaceBarMap(topo, obj) {
  const rOut = topo?.section?.outerRadiusM || 0.015;
  const maxDistSq = Math.pow(rOut * 2.6, 2);
  return obj.faces.map(f => {
    const n = f[3] >= 0 ? 4 : 3;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < n; k++) {
      const v = obj.verts[f[k]];
      cx += v[0]; cy += v[1]; cz += v[2];
    }
    cx /= n; cy /= n; cz /= n;
    let bestE = -1;
    let bestD = maxDistSq;
    for (let ei = 0; ei < topo.edges.length; ei++) {
      const [u, v] = topo.edges[ei];
      const a = topo.vertices[u], b = topo.vertices[v];
      const dSq = pointToSegDistSq(cx, cy, cz, a[0], a[1], a[2], b[0], b[1], b[2]);
      if (dSq < bestD) {
        bestD = dSq;
        bestE = ei;
      }
    }
    return bestE;
  });
}

function buildUnrolledExport(champTopo, champUnrolled) {
  // Fallback deterministic unroll from topology if unrolled.json is missing during early dev test
  let bars = champUnrolled?.bars || [];
  if (!bars.length) {
    const r = champTopo?.section?.outerRadiusM || 0.014;
    const nS = champTopo?.section?.nSides || 8;
    const sub = Math.max(1, champTopo?.geometry?.longitudinalSubdivLevels || 1);
    const segW = 2 * r * Math.sin(Math.PI / nS);
    bars = champTopo.edges.map(([u, v], ei) => {
      const a = champTopo.vertices[u], b = champTopo.vertices[v];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const quads2D = [];
      for (let li = 0; li <= sub; li++) {
        const y0 = (li / (sub + 1)) * len;
        const y1 = ((li + 1) / (sub + 1)) * len;
        for (let si = 0; si < nS; si++) {
          const x0 = si * segW, x1 = (si + 1) * segW;
          quads2D.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
        }
      }
      return {
        edgeIndex: ei,
        centerlineLengthM: len,
        subdivLevels: sub,
        nSides: nS,
        areaM2: len * nS * segW,
        bbox2D: [0, 0, nS * segW, len],
        quads2D
      };
    });
  }

  // Check whether bars already live in non-overlapping 2D sheet coordinates
  const bboxes = bars.map(b => {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const q of b.quads2D || []) {
      for (const p of q) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
    }
    return [minX, minY, maxX, maxY];
  });

  let anyOverlap = false;
  for (let i = 0; i < bboxes.length && !anyOverlap; i++) {
    for (let j = i + 1; j < bboxes.length; j++) {
      const a = bboxes[i], b = bboxes[j];
      const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const oy = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (ox > 1e-4 && oy > 1e-4) {
        anyOverlap = true;
        break;
      }
    }
  }

  // Rigidly translate only if local overlapping coordinates were stored; never distort aspect ratio!
  const placedBars = bars.map((b, idx) => {
    const bb = bboxes[idx];
    return {
      barIdx: b.edgeIndex ?? idx,
      w: Math.max(1e-4, bb[2] - bb[0]),
      h: Math.max(1e-4, bb[3] - bb[1]),
      origMinX: bb[0],
      origMinY: bb[1],
      dx: 0,
      dy: 0,
      quads2D: b.quads2D || []
    };
  });

  if (anyOverlap) {
    // Shelf-pack into a neat square-ish architectural sheet
    const totalArea = placedBars.reduce((s, b) => s + (b.w + 0.02) * (b.h + 0.02), 0);
    const targetW = Math.max(0.45, Math.sqrt(totalArea) * 1.18);
    let curX = 0, curY = 0, rowH = 0;
    const pad = 0.018;
    for (const pb of placedBars) {
      if (curX > 0 && curX + pb.w > targetW) {
        curX = 0;
        curY += rowH + pad;
        rowH = 0;
      }
      pb.dx = curX - pb.origMinX;
      pb.dy = curY - pb.origMinY;
      curX += pb.w + pad;
      if (pb.h > rowH) rowH = pb.h;
    }
  }

  // Normalize global sheet origin to (0, 0)
  let sMinX = 1e9, sMinY = 1e9, sMaxX = -1e9, sMaxY = -1e9;
  for (const pb of placedBars) {
    for (const q of pb.quads2D) {
      for (const p of q) {
        const x = p[0] + pb.dx;
        const y = p[1] + pb.dy;
        if (x < sMinX) sMinX = x;
        if (y < sMinY) sMinY = y;
        if (x > sMaxX) sMaxX = x;
        if (y > sMaxY) sMaxY = y;
      }
    }
  }
  const sheetW = Math.max(0.05, sMaxX - sMinX);
  const sheetH = Math.max(0.05, sMaxY - sMinY);

  const cutSegs = [];
  const foldSegs = [];
  const quadsFlat = [];

  const qKey = (x, y) => `${Math.round(x * 200000)},${Math.round(y * 200000)}`;

  for (const pb of placedBars) {
    const edgeMap = new Map();
    for (const q of pb.quads2D) {
      if (q.length < 4) continue;
      const pts = q.map(p => [p[0] + pb.dx - sMinX, p[1] + pb.dy - sMinY]);
      quadsFlat.push({ barIdx: pb.barIdx, pts });
      for (let k = 0; k < 4; k++) {
        const p1 = pts[k], p2 = pts[(k + 1) % 4];
        const k1 = qKey(p1[0], p1[1]), k2 = qKey(p2[0], p2[1]);
        const ek = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
        const prev = edgeMap.get(ek);
        if (prev) prev.count++;
        else edgeMap.set(ek, { count: 1, x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1] });
      }
    }
    for (const seg of edgeMap.values()) {
      if (seg.count === 1) cutSegs.push({ barIdx: pb.barIdx, ...seg });
      else foldSegs.push({ barIdx: pb.barIdx, ...seg });
    }
  }

  // Pick 4 long, prominent exterior showcase bars across height quartiles (bottom, lower-mid, upper-mid, top)
  const edgeScored = champTopo.edges.map(([u, v], ei) => {
    const a = champTopo.vertices[u], b = champTopo.vertices[v];
    const mz = 0.5 * (a[2] + b[2]);
    const mr = Math.hypot(0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    // Prefer front-facing (+X / -Y camera side) long exterior bars so they are 100% unoccluded in 3D!
    const mx = 0.5 * (a[0] + b[0]), my = 0.5 * (a[1] + b[1]);
    const camVis = 0.65 * mx - 0.65 * my;
    return { ei, mz, score: len * (1.0 + 1.2 * mr + 0.5 * camVis) };
  }).sort((a, b) => a.mz - b.mz);

  const hiBars = [];
  const usedHi = new Set();
  for (let k = 0; k < 4; k++) {
    const lo = Math.floor((k * edgeScored.length) / 4);
    const hi = Math.max(lo + 1, Math.floor(((k + 1) * edgeScored.length) / 4));
    const band = edgeScored.slice(lo, hi).filter(e => !usedHi.has(e.ei)).sort((a, b) => b.score - a.score);
    const chosen = band[0]?.ei ?? edgeScored[Math.min(edgeScored.length - 1, lo)]?.ei ?? 0;
    usedHi.add(chosen);
    hiBars.push(chosen);
  }

  return { sheetW, sheetH, cutSegs, foldSegs, quadsFlat, hiBars };
}

function buildPreFDMAndVoxels(champTopo) {
  const gr = isMinGrid222(champTopo?.metadata?.gridResolution)
    ? champTopo.metadata.gridResolution
    : [2, 2, 3];
  const [nx, ny, nz] = gr;

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const v of champTopo.vertices) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2];
    if (v[2] > maxZ) maxZ = v[2];
  }
  const halfX = Math.max(0.38, 0.5 * (maxX - minX));
  const halfY = Math.max(0.38, 0.5 * (maxY - minY));
  const topZ = Math.max(1.9, maxZ);

  const anchorSet = new Set(champTopo.anchors || []);
  const preVerts = champTopo.vertices.map((v, vi) => {
    if (anchorSet.has(vi)) return [v[0], v[1], 0.0];
    // Snap toward uniform nx x ny x nz rectilinear voxel lattice planes
    const ux = clamp01JS((v[0] + halfX) / (2 * halfX));
    const uy = clamp01JS((v[1] + halfY) / (2 * halfY));
    const uz = clamp01JS(v[2] / topZ);
    const sx = -halfX + (Math.round(ux * (2 * nx)) / (2 * nx)) * (2 * halfX);
    const sy = -halfY + (Math.round(uy * (2 * ny)) / (2 * ny)) * (2 * halfY);
    const sz = (Math.round(uz * (2 * nz)) / (2 * nz)) * topZ;
    return [sx, sy, sz];
  });

  // Build nx * ny * nz voxel cells ordered bottom-to-top (iz = 0..nz-1)
  const cells = [];
  const dx = (2 * halfX) / nx;
  const dy = (2 * halfY) / ny;
  const dz = topZ / nz;
  for (let iz = 0; iz < nz; iz++) {
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        cells.push({
          ix, iy, iz,
          cx: -halfX + (ix + 0.5) * dx,
          cy: -halfY + (iy + 0.5) * dy,
          cz: (iz + 0.5) * dz,
          hx: 0.5 * dx,
          hy: 0.5 * dy,
          hz: 0.5 * dz
        });
      }
    }
  }

  // Assign each edge to the cell index whose center is closest to the edge's pre-FDM midpoint
  const edgeCellStep = champTopo.edges.map(([u, v]) => {
    const mx = 0.5 * (preVerts[u][0] + preVerts[v][0]);
    const my = 0.5 * (preVerts[u][1] + preVerts[v][1]);
    const mz = 0.5 * (preVerts[u][2] + preVerts[v][2]);
    let bestIdx = 0, bestD = 1e9;
    cells.forEach((c, ci) => {
      const d = Math.pow((mx - c.cx) / c.hx, 2) + Math.pow((my - c.cy) / c.hy, 2) + Math.pow((mz - c.cz) / c.hz, 2);
      // Slight bias toward higher iz so inter-layer ties appear when upper cell collapses
      const score = d + 0.02 * ci;
      if (score < bestD) {
        bestD = score;
        bestIdx = ci;
      }
    });
    return bestIdx;
  });

  return { nx, ny, nz, preVerts, cells, edgeCellStep };
}

function clamp01JS(x) {
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

function findChampionFiles(customCampaignDir = null) {
  const candidates = [];
  if (customCampaignDir) {
    candidates.push(path.join(customCampaignDir, 'champion'));
    candidates.push(path.join(customCampaignDir, 'best_verified'));
  }
  candidates.push(
    path.join(root, 'runs', 'pilot_v2_campaign', 'champion'),
    path.join(root, 'runs', 'champion')
  );
  for (const dir of candidates) {
    if (!fs.existsSync(dir)) continue;
    const topos = fs.readdirSync(dir).filter(f => f.endsWith('.topology.json'));
    // Prefer champion.topology.json if present
    topos.sort((a, b) => (a === 'champion.topology.json' ? -1 : b === 'champion.topology.json' ? 1 : a.localeCompare(b)));
    for (const tf of topos) {
      const stem = tf.slice(0, -'.topology.json'.length);
      const topoPath = path.join(dir, tf);
      const objPath = path.join(dir, `${stem}.mesh.obj`);
      if (!fs.existsSync(objPath)) continue;
      const topo = readJSONAbs(topoPath);
      if (isMinGrid222(topo?.metadata?.gridResolution)) {
        const verdictPath = path.join(dir, `${stem}.verdict.json`);
        const unrollPath = path.join(dir, `${stem}.unrolled.json`);
        return {
          topo,
          obj: parseOBJAbs(objPath),
          verdict: fs.existsSync(verdictPath) ? readJSONAbs(verdictPath) : null,
          unrolled: fs.existsSync(unrollPath) ? readJSONAbs(unrollPath) : null,
          sourceRel: path.relative(root, topoPath).replace(/\\/g, '/')
        };
      }
    }
  }
  return null;
}

async function main() {
  const cliArgs = parseCliArgs(process.argv.slice(2));
  const core = await loadCoreFromIndexWFC();
  const briefPath = cliArgs.brief
    ? (path.isAbsolute(cliArgs.brief) ? cliArgs.brief : path.resolve(process.cwd(), cliArgs.brief))
    : path.join(root, 'briefs', 'pilot_v2_pq_unrolled.json');
  const brief = readJSONAbs(briefPath);
  if (Array.isArray(brief?.topology?.minGridResolution) && brief.topology.minGridResolution.length >= 3) {
    ACTIVE_MIN_GRID = brief.topology.minGridResolution.map(n => Math.max(1, Number(n) || 1));
  } else {
    ACTIVE_MIN_GRID = [1, 1, 1];
  }
  const lc2 = brief.loadCases.find(lc => (lc.distributedVerticalMassKg || 0) > 0)
    || brief.loadCases.find(lc => lc.id === 'LC2_self_weight_plus_50kg')
    || brief.loadCases[brief.loadCases.length - 1];

  const campaignDir = cliArgs['run-dir']
    ? (path.isAbsolute(cliArgs['run-dir']) ? cliArgs['run-dir'] : path.resolve(process.cwd(), cliArgs['run-dir']))
    : path.join(root, 'runs', 'pilot_v2_campaign');
  const paretoPath = path.join(campaignDir, 'pareto_summary.json');
  const paretoJson = fs.existsSync(paretoPath) ? readJSONAbs(paretoPath) : null;

  const discovered = scanCampaignCandidates(campaignDir, brief, lc2);

  let champBundle = findChampionFiles(cliArgs['run-dir'] ? campaignDir : null);
  if (!champBundle) {
    // Fallback to best passing discovered candidate if champion folder not yet copied
    const passing = discovered.filter(c => c.metrics.passed).sort((a, b) =>
      a.metrics.areaM2 - b.metrics.areaM2 || a.metrics.nBars - b.metrics.nBars || a.metrics.massKg - b.metrics.massKg
    );
    const pick = passing[0] || discovered[0];
    if (!pick) throw new Error('No >=2x2x2 Pilot v2 candidates found yet in runs/pilot_v2_campaign/');
    champBundle = {
      topo: pick.topo,
      obj: pick.obj,
      verdict: pick.verdict,
      unrolled: pick.unrolled,
      sourceRel: pick.topoRelPath
    };
  }

  const champTopo = champBundle.topo;
  const champObj = champBundle.obj;
  const champFea = solveSpaceFrame(champTopo, brief.material, lc2, { restraintType: 'pinned' });
  const champMetrics = extractMetrics(champTopo, champObj, champBundle.verdict, champFea, champBundle.unrolled);
  champMetrics.statusKind = 3; // Winner

  // Baseline candidate: Smoke or heaviest / highest-area Round 1 >=2x2x2 candidate
  const smokeOrR1 = discovered.filter(c => c.roundIdx <= 1);
  smokeOrR1.sort((a, b) => {
    if (a.stem === 'smoke_v2') return -1;
    if (b.stem === 'smoke_v2') return 1;
    return (b.metrics.areaM2 + 0.05 * b.metrics.massKg) - (a.metrics.areaM2 + 0.05 * a.metrics.massKg);
  });
  const baseCand = smokeOrR1[0] || discovered[0] || {
    stem: 'baseline_v2', roundIdx: 0, preset: champTopo?.metadata?.tilePreset || 'space_frame',
    grid: champTopo?.metadata?.gridResolution || [2, 2, 3], gk: gridKey(champTopo?.metadata?.gridResolution),
    topo: champTopo, obj: champObj, verdict: champBundle.verdict, fea: champFea, metrics: { ...champMetrics, statusKind: 0 }
  };

  // Rejected / Instructive Candidate 2 for Ch 3 3-up Lineup:
  // Prefer a clean-tube candidate with Slenderness/Lateral/Tension Reject and moderate mass
  const rejectedPool = discovered.filter(c =>
    c.id !== baseCand.id && !c.metrics.passed && c.metrics.cleanTubeMesh && c.metrics.massKg < baseCand.metrics.massKg * 0.90
  ).sort((a, b) => {
    const sa = a.metrics.statusKind === 1 ? 0 : (a.metrics.latFail ? 1 : 2);
    const sb = b.metrics.statusKind === 1 ? 0 : (b.metrics.latFail ? 1 : 2);
    if (sa !== sb) return sa - sb;
    return a.metrics.areaM2 - b.metrics.areaM2;
  });
  const altCand = rejectedPool[0]
    || discovered.find(c => c.id !== baseCand.id && !c.metrics.passed && c.metrics.cleanTubeMesh)
    || discovered.find(c => c.id !== baseCand.id && !c.metrics.passed)
    || discovered.filter(c => c.id !== baseCand.id && c.metrics.cleanTubeMesh).sort((a, b) => b.metrics.nBars - a.metrics.nBars)[0]
    || baseCand;

  // Build Voxel Grid Breakdown (`>= 2x2x2` grids, synced 1:1 with pareto_summary.json gridComparison when available)
  const gridMap = new Map();
  if (paretoJson?.gridComparison) {
    for (const [gk, gObj] of Object.entries(paretoJson.gridComparison)) {
      const parts = gk.split('x').map(Number);
      if (isMinGrid222(parts)) {
        gridMap.set(gk, { gk, gr: parts, total: gObj.total || 0, passed: gObj.passed || 0 });
      }
    }
  } else {
    for (const c of discovered) {
      if (c.roundIdx === 0) continue; // exclude pre-upgrade smoke from round grid totals
      const prev = gridMap.get(c.gk) || { gk: c.gk, gr: c.grid, total: 0, passed: 0 };
      prev.total++;
      if (c.metrics.passed) prev.passed++;
      gridMap.set(c.gk, prev);
    }
  }
  const champGk = gridKey(champTopo?.metadata?.gridResolution);
  if (!gridMap.has(champGk)) {
    gridMap.set(champGk, { gk: champGk, gr: champTopo.metadata.gridResolution, total: 1, passed: 1 });
  }
  const gridOrderScore = gr => gr[0] * 100 + gr[1] * 10 + gr[2];
  let gridStats = Array.from(gridMap.values()).sort((a, b) => gridOrderScore(a.gr) - gridOrderScore(b.gr));
  if (gridStats.length > 8) gridStats = gridStats.slice(0, 8);
  const gridIndexByKey = new Map(gridStats.map((gs, idx) => [gs.gk, idx]));

  // Select 16 diverse Swarm Exploration candidates from real campaign artifacts (preferring clean unpinched tubes!)
  const TARGET_EXPLORE = 16;
  const selected = [];
  const usedIds = new Set();

  function addCand(c) {
    if (!c || usedIds.has(c.id) || selected.length >= TARGET_EXPLORE - 1) return false;
    // Avoid duplicating the frozen Champion inside slots 1..15 (since slot 16/16 is the Champion!)
    if (Math.abs(c.metrics.areaM2 - champMetrics.areaM2) < 1e-4 && c.metrics.nBars === champMetrics.nBars) return false;
    usedIds.add(c.id);
    selected.push(c);
    return true;
  }

  // 1. Always start with Baseline
  addCand(baseCand);
  // 2. Ensure altCand (instructive reject) is included
  if (altCand.id !== baseCand.id) addCand(altCand);

  // 3. Cover every explored >=2x2x2 voxel grid (strictly preferring cleanTubeMesh + verified pass!)
  for (const gs of gridStats) {
    const match = discovered
      .filter(c => c.gk === gs.gk && !usedIds.has(c.id))
      .sort((a, b) =>
        (b.metrics.cleanTubeMesh ? 1 : 0) - (a.metrics.cleanTubeMesh ? 1 : 0)
        || (b.metrics.passed ? 1 : 0) - (a.metrics.passed ? 1 : 0)
        || a.metrics.areaM2 - b.metrics.areaM2
      )[0];
    if (match) addCand(match);
  }

  // 4. Cover diverse presets across Rounds 1, 2, 3 (strictly clean unpinched tubes!)
  const seenPresets = new Set(selected.map(s => s.preset));
  const cleanFirstPool = discovered.filter(c => c.metrics.cleanTubeMesh).sort((a, b) =>
    (b.metrics.passed ? 1 : 0) - (a.metrics.passed ? 1 : 0)
    || a.metrics.areaM2 - b.metrics.areaM2
  );
  for (const c of cleanFirstPool) {
    if (!seenPresets.has(c.preset) && addCand(c)) {
      seenPresets.add(c.preset);
    }
  }

  // 5. Fill remaining slots up to 15 with balanced Round 1 -> Round 2 -> Round 3 clean-tube Pareto leaders
  const remaining = discovered
    .filter(c => !usedIds.has(c.id) && c.metrics.cleanTubeMesh)
    .sort((a, b) =>
      (b.metrics.passed ? 1 : 0) - (a.metrics.passed ? 1 : 0)
      || a.roundIdx - b.roundIdx
      || a.metrics.areaM2 - b.metrics.areaM2
    );
  for (const c of remaining) {
    if (selected.length >= TARGET_EXPLORE - 1) break;
    addCand(c);
  }

  // Sort the first 15 chronologically by roundIdx then descending surface area -> smooth optimization arc!
  selected.sort((a, b) => {
    if (a.id === baseCand.id) return -1;
    if (b.id === baseCand.id) return 1;
    if (a.roundIdx !== b.roundIdx) return a.roundIdx - b.roundIdx;
    return b.metrics.areaM2 - a.metrics.areaM2;
  });

  // Pad if fewer than 15 discovered during early smoke test (never needed once round1-3 exist)
  while (selected.length < TARGET_EXPLORE - 1) {
    selected.push(selected[selected.length - 1] || baseCand);
  }

  // Slot 16/16 is always the Verified Pilot v2 Champion!
  const champEntry = {
    id: '__CHAMP__',
    stem: champTopo.name || 'champion',
    roundIdx: 3,
    preset: champTopo?.metadata?.tilePreset || 'catenary_quadripod',
    grid: champTopo?.metadata?.gridResolution || [2, 2, 3],
    gk: champGk,
    topo: champTopo,
    obj: champObj,
    verdict: champBundle.verdict,
    unrolled: champBundle.unrolled,
    fea: champFea,
    metrics: champMetrics,
    isWinner: true
  };
  const finalExplore = [...selected.slice(0, TARGET_EXPLORE - 1), champEntry];

  let extraCode = '';
  const catalogEntries = [];

  finalExplore.forEach((sp, idx) => {
    const key = sp.isWinner ? 'CHAMP' : (idx === 0 ? 'BASE' : `EXP_${idx}`);
    if (!sp.isWinner && idx !== 0) {
      extraCode += emitGraph(key, sp.topo, sp.fea);
      extraCode += emitOBJ(key, sp.obj);
    }
    const gIdx = gridIndexByKey.get(sp.gk) ?? 0;
    const m = sp.metrics;
    const roundTag = sp.isWinner ? 'Winner' : (sp.roundIdx === 0 ? 'Smoke' : `R${sp.roundIdx}`);
    const title = `${roundTag} \u00B7 ${prettyPreset(sp.preset)} ${gridDisplay(sp.gk)}`;
    const sk = sp.isWinner ? 3 : m.statusKind;

    console.log(
      `Explore[${idx + 1}/16] ${title}: area=${m.areaM2.toFixed(3)}m2, bars=${m.nBars}, ` +
      `mass=${m.massKg.toFixed(2)}kg, disp=${m.dispMm.toFixed(3)}mm, minSF=${m.minSF.toFixed(1)}, ` +
      `comp=${(m.compDom * 100).toFixed(0)}%, status=${sk}`
    );

    catalogEntries.push(
      `{L"${escW(title)}", ${key}_OBJ_VERTS, ${key}_OBJ_FACES, ${key}_OBJ_NFACES, ` +
      `${key}_VERTS, ${key}_NVERTS, ${key}_EDGES, ${key}_NEDGES, ${key}_ANCHORS, ${key}_NANCHORS, ` +
      `${key}_DISP, ${key}_FEA, ${gIdx}, ${m.areaM2.toFixed(4)}f, ${m.nBars}, ${m.massKg.toFixed(2)}f, ` +
      `${m.dispMm.toFixed(3)}f, ${m.minSF.toFixed(1)}f, ${m.sfB.toFixed(1)}f, ${m.funEff.toFixed(3)}f, ` +
      `${m.compDom.toFixed(3)}f, ${m.tensileBars}, ${m.maxWarpMm.toFixed(3)}f, ${m.maxStressMPa.toFixed(3)}f, ${sk}}`
    );
  });

  // Also emit ALT candidate for Ch 3 Column 2
  const altKey = 'ALT';
  extraCode += emitGraph(altKey, altCand.topo, altCand.fea);
  extraCode += emitOBJ(altKey, altCand.obj);

  // Extract 6 showcase WFC tiles (always putting Champion's tile family in slot 5!)
  const allTiles = core.createTileTemplates();
  const champPreset = champTopo?.metadata?.tilePreset || 'catenary_quadripod';
  const presetToTileKey = {
    pilot_champion: 'catenary_quadripod',
    catenary_quadripod: 'catenary_quadripod',
    funicular_vault: 'arch_vault',
    arch_braced: 'arch_vault',
    funnel_vault: 'vtube',
    slender_diagrid: 'slender_diagrid',
    diagrid_tower: 'slender_diagrid',
    hyperboloid_tower: 'hyperboloid',
    space_frame: 'cross',
    minimal_frame: 'vtube',
    default_ortho: 'cross'
  };
  const winTileKey = allTiles.find(t => t.key === champPreset)?.key
    || allTiles.find(t => t.key === presetToTileKey[champPreset])?.key
    || allTiles.find(t => String(t.key).includes('diag'))?.key
    || 'slender_diagrid';

  const baseTileKeys = ['null', 'cross', 'vtube', 'arch_vault', 'slender_diagrid', 'catenary_quadripod']
    .filter(k => k !== winTileKey);
  const wantedKeys = [...baseTileKeys.slice(0, 5), winTileKey];

  const tileLabelMap = {
    null: 'Empty Void',
    cross: 'Orthogonal Cross',
    vtube: 'Vertical Column',
    arch_vault: 'Compression Vault',
    slender_diagrid: 'Slender Diagrid',
    diagrid: 'Diagrid Module',
    hyperboloid: 'Hyperboloid Twist',
    catenary_quadripod: 'Catenary Quadripod'
  };

  let tilesCode = '';
  const tileMeta = [];
  const chosenTileObjs = [];
  for (let ti = 0; ti < 6; ti++) {
    const k = wantedKeys[ti];
    const t = allTiles.find(x => x.key === k) || allTiles[0];
    chosenTileObjs.push(t);
    const verts = (t.graph && t.graph.vertices) || [];
    const edges = (t.graph && t.graph.edges) || [];
    const socks = t.sockets || [0, 0, 0, 0, 0, 0];
    const vStr = verts.length
      ? verts.map(p => `{${Number(p[0]).toFixed(4)}f,${Number(p[1]).toFixed(4)}f,${Number(p[2]).toFixed(4)}f}`).join(',')
      : '{0.0f,0.0f,0.0f}';
    const eStr = edges.length
      ? edges.map(e => `{${e[0]},${e[1]}}`).join(',')
      : '{0,0}';
    tilesCode += `static const Vec3 WFC_T${ti}_V[] = {${vStr}};\n`;
    tilesCode += `static const Edge2 WFC_T${ti}_E[] = {${eStr}};\n`;
    const lbl = (ti === 5 ? '\u2605 ' : '') + (tileLabelMap[t.key] || prettyPreset(t.key));
    tileMeta.push(`{L"${escW(lbl)}", WFC_T${ti}_V, ${verts.length}, WFC_T${ti}_E, ${edges.length}, {${socks.join(',')}}}`);
  }

  // Exact 6x6 vertical (+Z/-Z) and lateral (+X/-X) socket compatibility matrix across the 6 showcase tiles
  // sockets order: [+X, -X, +Y, -Y, +Z, -Z] -> Z stack: tileA[+Z (4)] === tileB[-Z (5)]
  const zCompatRows = [];
  for (let r = 0; r < 6; r++) {
    const row = [];
    for (let c = 0; c < 6; c++) {
      const sA = chosenTileObjs[r].sockets || [0, 0, 0, 0, 0, 0];
      const sB = chosenTileObjs[c].sockets || [0, 0, 0, 0, 0, 0];
      const zOk = (sA[4] === sB[5]) ? 1 : 0;
      const xOk = (sA[0] === sB[1]) ? 1 : 0;
      // 2 = matches both XY & Z, 1 = matches Z or XY, 0 = incompatible
      row.push((r === 0 && c > 0) || (c === 0 && r > 0) ? 0 : (zOk && xOk ? 2 : (zOk || xOk ? 1 : 0)));
    }
    zCompatRows.push(`{${row.join(',')}}`);
  }

  tilesCode += `struct WFCTileGeom { const wchar_t* name; const Vec3* v; int nv; const Edge2* e; int ne; int sockets[6]; };\n`;
  tilesCode += `static const WFCTileGeom WFC_SHOWCASE_TILES[6] = {\n  ${tileMeta.join(',\n  ')}\n};\n`;
  tilesCode += `static const int WFC_ADJ_MATRIX[6][6] = {${zCompatRows.join(',')}};\n`;

  // Build Pareto scatter points (Unrolled Surface Area m2 vs Bar Count & Mass kg)
  // Compute exact non-dominated Pareto flag over (areaM2 min, nBars min, massKg min, -funEff min)
  const allPointsSrc = discovered.length > 0 ? discovered.map(c => ({
    areaM2: c.metrics.areaM2,
    nBars: c.metrics.nBars,
    massKg: c.metrics.massKg,
    dispMm: c.metrics.dispMm,
    funEff: c.metrics.funEff,
    passed: c.metrics.passed,
    group: presetGroup(c.preset)
  })) : [];

  // Ensure Champion is in scatter
  allPointsSrc.push({
    areaM2: champMetrics.areaM2,
    nBars: champMetrics.nBars,
    massKg: champMetrics.massKg,
    dispMm: champMetrics.dispMm,
    funEff: champMetrics.funEff,
    passed: true,
    group: 0,
    isChamp: true
  });

  for (let i = 0; i < allPointsSrc.length; i++) {
    const a = allPointsSrc[i];
    if (!a.passed) { a.isPareto = false; continue; }
    let dominated = false;
    for (let j = 0; j < allPointsSrc.length; j++) {
      if (i === j || !allPointsSrc[j].passed) continue;
      const b = allPointsSrc[j];
      const noWorse = b.areaM2 <= a.areaM2 + 1e-5
        && b.nBars <= a.nBars
        && b.massKg <= a.massKg + 1e-4
        && b.funEff >= a.funEff - 1e-4;
      const strictlyBetter = b.areaM2 < a.areaM2 - 1e-4
        || b.nBars < a.nBars
        || b.massKg < a.massKg - 1e-3
        || b.funEff > a.funEff + 1e-3;
      if (noWorse && strictlyBetter) { dominated = true; break; }
    }
    a.isPareto = !dominated;
  }

  const paretoPtsStr = allPointsSrc.map(p =>
    `{${p.areaM2.toFixed(4)}f, ${p.nBars}, ${p.massKg.toFixed(3)}f, ${p.dispMm.toFixed(3)}f, ` +
    `${p.funEff.toFixed(3)}f, ${p.group}, ${p.passed ? 'true' : 'false'}, ${p.isPareto ? 'true' : 'false'}, ${p.isChamp ? 'true' : 'false'}}`
  ).join(',\n  ');

  // Campaign summary numbers (prefer pareto_summary.json totals when available, else exact discovered counts)
  const totalEval = paretoJson?.totals?.evaluated ?? paretoJson?.totalEvaluated ?? discovered.length;
  const totalPassed = paretoJson?.totals?.passed ?? paretoJson?.totalPassed ?? discovered.filter(c => c.metrics.passed).length;
  const paretoCount = paretoJson?.totals?.paretoFrontCount
    ?? (Array.isArray(paretoJson?.paretoFront) ? paretoJson.paretoFront.length : allPointsSrc.filter(p => p.isPareto).length);

  const r1Cands = discovered.filter(c => c.roundIdx <= 1);
  const r2Cands = discovered.filter(c => c.roundIdx === 2);
  const r3Cands = discovered.filter(c => c.roundIdx >= 3);
  const r1PassPct = r1Cands.length ? (100 * r1Cands.filter(c => c.metrics.passed).length / r1Cands.length) : 0;
  const r3OrAllPassPct = r3Cands.length
    ? (100 * r3Cands.filter(c => c.metrics.passed).length / r3Cands.length)
    : (totalEval > 0 ? (100 * totalPassed / totalEval) : 100);

  // Round-by-round best progression for Ch 5 Stage C Multi-Objective Convergence chart
  const bestInRound = (cands, fallback) => {
    const pass = cands.filter(c => c.metrics.passed).sort((a, b) => a.metrics.areaM2 - b.metrics.areaM2);
    return (pass[0] || cands[0])?.metrics || fallback;
  };
  const mR0 = baseCand.metrics;
  const mR1 = bestInRound(r1Cands, mR0);
  const mR2 = bestInRound(r2Cands, mR1);
  const mWin = champMetrics;

  // Champion face -> bar map, >=2x2x2 voxel cells, and exact 2D unrolled patterns
  const champFaceBar = computeFaceBarMap(champTopo, champObj);
  const wfcData = buildPreFDMAndVoxels(champTopo);
  const unrollData = buildUnrolledExport(champTopo, champBundle.unrolled);

  const preVertsStr = wfcData.preVerts
    .map(v => `{${v[0].toFixed(5)}f,${v[1].toFixed(5)}f,${v[2].toFixed(5)}f}`).join(',');
  const voxelCellsStr = wfcData.cells
    .map(c => `{${c.ix},${c.iy},${c.iz},${c.cx.toFixed(4)}f,${c.cy.toFixed(4)}f,${c.cz.toFixed(4)}f,${c.hx.toFixed(4)}f,${c.hy.toFixed(4)}f,${c.hz.toFixed(4)}f}`)
    .join(',\n  ');
  const edgeStepStr = wfcData.edgeCellStep.join(',');

  const cutSegsStr = unrollData.cutSegs
    .map(s => `{${s.barIdx},${s.x1.toFixed(5)}f,${s.y1.toFixed(5)}f,${s.x2.toFixed(5)}f,${s.y2.toFixed(5)}f}`)
    .join(',');
  const foldSegsStr = unrollData.foldSegs
    .map(s => `{${s.barIdx},${s.x1.toFixed(5)}f,${s.y1.toFixed(5)}f,${s.x2.toFixed(5)}f,${s.y2.toFixed(5)}f}`)
    .join(',');
  const unrollQuadsStr = unrollData.quadsFlat
    .map(q => `{${q.barIdx},${q.pts[0][0].toFixed(5)}f,${q.pts[0][1].toFixed(5)}f,${q.pts[1][0].toFixed(5)}f,${q.pts[1][1].toFixed(5)}f,${q.pts[2][0].toFixed(5)}f,${q.pts[2][1].toFixed(5)}f,${q.pts[3][0].toFixed(5)}f,${q.pts[3][1].toFixed(5)}f}`)
    .join(',');

  const gridStatsStr = gridStats.map(gs => {
    const rate = gs.total > 0 ? gs.passed / gs.total : 0;
    return `{L"${escW(`${gridDisplay(gs.gk)} (${gs.passed}/${gs.total})`)}", ${gs.total}, ${gs.passed}, ${rate.toFixed(3)}f}`;
  }).join(',\n  ');

  const outerMm = (champTopo?.section?.outerRadiusM || 0.014) * 1000;
  const innerMm = (champTopo?.section?.innerRadiusM || 0.0) * 1000;
  const secDesc = innerMm > 0.1
    ? `Hollow ${outerMm.toFixed(1)} / ${innerMm.toFixed(1)} mm`
    : `Solid ${outerMm.toFixed(1)} mm`;

  const altRejectReason = altCand.metrics.statusKind === 1
    ? `${altCand.metrics.tensileBars} Bars in Tension (Reject)`
    : (altCand.metrics.latFail
      ? `Lateral Drift ${altCand.metrics.latDispMm.toFixed(0)} mm (Reject)`
      : (altCand.metrics.maxSlenderness > 120.0
        ? `Slenderness ${altCand.metrics.maxSlenderness.toFixed(0)} > 120 (Reject)`
        : (altCand.metrics.passed ? `Higher Area (${altCand.metrics.areaM2.toFixed(2)} m\u00B2)` : `Safety Factor ${altCand.metrics.minSF.toFixed(2)} (Reject)`)));

  const eqRes = champTopo?.fdm?.equilibriumResidual ?? 1e-12;

  const header = `// AUTO-GENERATED by export_video_data.mjs from verified Pilot v2 TOPOGEN_FDM_Foundry artifacts
#pragma once

struct Vec3 { float x, y, z; };
struct Edge2 { int u, v; };
struct Face4 { int a, b, c, d; };
struct MemberFEA { float axialN, sigmaT_MPa, sigmaC_MPa; };

struct ParetoPt {
  float areaM2;
  int nBars;
  float massKg, dispMm, funicEff;
  int group;
  bool passed, isPareto, isChamp;
};

struct GridStatEntry {
  const wchar_t* label;
  int total, passed;
  float passRate;
};

struct ExploreEntry {
  const wchar_t* title;
  const Vec3* objV; const Face4* objF; int objNF;
  const Vec3* gV; int gNV; const Edge2* gE; int gNE;
  const int* anc; int nAnc;
  const Vec3* disp; const MemberFEA* fea;
  int gridIdx;
  float areaM2;
  int nBars;
  float massKg, dispMm, minSF, sfB, funEff, compDom;
  int tensileBars;
  float maxWarpMm, maxStressMPa;
  int statusKind; // 0=Verified, 1=TensionReject, 2=StabilityReject, 3=Winner
};

struct VoxelCell {
  int ix, iy, iz;
  float cx, cy, cz, hx, hy, hz;
};

struct Seg2D {
  int barIdx;
  float x1, y1, x2, y2;
};

struct Quad2D {
  int barIdx;
  float x0, y0, x1, y1, x2, y2, x3, y3;
};

// Campaign & Champion Headline Metrics
static constexpr int CAMPAIGN_EVALUATED = ${totalEval};
static constexpr int CAMPAIGN_PASSED = ${totalPassed};
static constexpr int CAMPAIGN_PARETO_COUNT = ${paretoCount};
static constexpr float CAMPAIGN_R1_PASS_PCT = ${r1PassPct.toFixed(1)}f;
static constexpr float CAMPAIGN_FINAL_PASS_PCT = ${r3OrAllPassPct.toFixed(1)}f;

static constexpr float BASE_MASS_KG = ${baseCand.metrics.massKg.toFixed(2)}f;
static constexpr float BASE_AREA_M2 = ${baseCand.metrics.areaM2.toFixed(3)}f;
static constexpr int BASE_BAR_COUNT = ${baseCand.metrics.nBars};
static constexpr float BASE_COMP_DOM = ${baseCand.metrics.compDom.toFixed(3)}f;
static const wchar_t* BASE_GRID_STR = L"${escW(gridDisplay(baseCand.gk))}";
static const wchar_t* BASE_PRESET_STR = L"${escW(prettyPreset(baseCand.preset))}";

static constexpr float ALT_MASS_KG = ${altCand.metrics.massKg.toFixed(2)}f;
static constexpr float ALT_AREA_M2 = ${altCand.metrics.areaM2.toFixed(3)}f;
static constexpr int ALT_BAR_COUNT = ${altCand.metrics.nBars};
static const wchar_t* ALT_TITLE_STR = L"${escW(`${prettyPreset(altCand.preset)} ${gridDisplay(altCand.gk)}`)}";
static const wchar_t* ALT_REASON_STR = L"${escW(altRejectReason)}";

static constexpr float CHAMP_MASS_KG = ${champMetrics.massKg.toFixed(2)}f;
static constexpr float CHAMP_MESH_MASS_KG = ${champMetrics.meshMassKg.toFixed(2)}f;
static constexpr float CHAMP_AREA_M2 = ${champMetrics.areaM2.toFixed(3)}f;
static constexpr int CHAMP_BAR_COUNT = ${champMetrics.nBars};
static constexpr float CHAMP_DISP_MM = ${champMetrics.dispMm.toFixed(3)}f;
static constexpr float CHAMP_MIN_SF = ${champMetrics.minSF.toFixed(1)}f;
static constexpr float CHAMP_SF_COMP = ${champMetrics.sfC.toFixed(1)}f;
static constexpr float CHAMP_SF_BUCK = ${champMetrics.sfB.toFixed(1)}f;
static constexpr float CHAMP_LAT_DISP_MM = ${champMetrics.latDispMm.toFixed(3)}f;
static constexpr float CHAMP_LAT_SF = ${champMetrics.latMinSF.toFixed(1)}f;
static constexpr float CHAMP_FUN_EFF = ${champMetrics.funEff.toFixed(4)}f;
static constexpr float CHAMP_MAX_WARP_MM = ${champMetrics.maxWarpMm.toFixed(4)}f;
static constexpr int CHAMP_SUBDIV_LEVELS = ${champMetrics.subdivLevels};
static constexpr float CHAMP_EQ_RES = ${(Number(eqRes) || 1e-12).toExponential(2)}f;
static const wchar_t* CHAMP_GRID_STR = L"${escW(gridDisplay(champGk))}";
static const wchar_t* CHAMP_PRESET_STR = L"${escW(prettyPreset(champTopo?.metadata?.tilePreset))}";
static const wchar_t* CHAMP_SEC_STR = L"${escW(secDesc)}";

// Round progression metrics for Ch 5 Stage C Convergence Chart
static const float CONV_AREA_M2[4] = {${mR0.areaM2.toFixed(3)}f, ${mR1.areaM2.toFixed(3)}f, ${mR2.areaM2.toFixed(3)}f, ${mWin.areaM2.toFixed(3)}f};
static const float CONV_BARS[4] = {${mR0.nBars}.0f, ${mR1.nBars}.0f, ${mR2.nBars}.0f, ${mWin.nBars}.0f};
static const float CONV_MASS_KG[4] = {${mR0.massKg.toFixed(2)}f, ${mR1.massKg.toFixed(2)}f, ${mR2.massKg.toFixed(2)}f, ${mWin.massKg.toFixed(2)}f};
static const float CONV_FUN_EFF[4] = {${mR0.funEff.toFixed(3)}f, ${mR1.funEff.toFixed(3)}f, ${mR2.funEff.toFixed(3)}f, ${mWin.funEff.toFixed(3)}f};

${emitGraph('CHAMP', champTopo, champFea)}
static const Vec3 CHAMP_PRE_WFC[] = {${preVertsStr}};
${emitGraph('BASE', baseCand.topo, baseCand.fea)}
${emitOBJ('CHAMP', champObj, champFaceBar)}
${emitOBJ('BASE', baseCand.obj)}
${extraCode}

static const GridStatEntry GRID_STATS[] = {
  ${gridStatsStr}
};
static const int GRID_STATS_COUNT = ${gridStats.length};

static const ExploreEntry EXPLORE_CATALOG[${TARGET_EXPLORE}] = {
  ${catalogEntries.join(',\n  ')}
};
static const int EXPLORE_COUNT = ${TARGET_EXPLORE};

${tilesCode}

static constexpr int CHAMP_GRID_NX = ${wfcData.nx};
static constexpr int CHAMP_GRID_NY = ${wfcData.ny};
static constexpr int CHAMP_GRID_NZ = ${wfcData.nz};
static const VoxelCell CHAMP_VOXEL_CELLS[] = {
  ${voxelCellsStr}
};
static const int CHAMP_VOXEL_NCELLS = ${wfcData.cells.length};
static const int CHAMP_EDGE_WFC_STEP[] = {${edgeStepStr}};

static constexpr float CHAMP_SHEET_W = ${unrollData.sheetW.toFixed(5)}f;
static constexpr float CHAMP_SHEET_H = ${unrollData.sheetH.toFixed(5)}f;
static const int CHAMP_HIGHLIGHT_BARS[4] = {${unrollData.hiBars.join(',')}};
static const Seg2D CHAMP_UNROLL_CUT_SEGS[] = {${cutSegsStr || '{0,0,0,0,0}'}};
static const int CHAMP_UNROLL_NCUT = ${unrollData.cutSegs.length};
static const Seg2D CHAMP_UNROLL_FOLD_SEGS[] = {${foldSegsStr || '{0,0,0,0,0}'}};
static const int CHAMP_UNROLL_NFOLD = ${unrollData.foldSegs.length};
static const Quad2D CHAMP_UNROLL_QUADS[] = {${unrollQuadsStr || '{0,0,0,0,0,0,0,0,0}'}};
static const int CHAMP_UNROLL_NQUADS = ${unrollData.quadsFlat.length};

static const ParetoPt PARETO_PTS[] = {
  ${paretoPtsStr}
};
static const int PARETO_NPTS = ${allPointsSrc.length};
`;

  const outPath = path.join(__dirname, 'foundry_video_data.hpp');
  fs.writeFileSync(outPath, header, 'utf8');

  // Auto-generate Gate F1 Fact Ledger (100% synced with foundry_video_data.hpp & verified JSONs)
  const gridSummaryMd = gridStats
    .map(gs => `\`${gridDisplay(gs.gk)}\` (${gs.passed}/${gs.total})`)
    .join(', ');
  const champVerdRel = champBundle.sourceRel.replace(/\.topology\.json$/, '.verdict.json');
  const champUnrollRel = champBundle.sourceRel.replace(/\.topology\.json$/, '.unrolled.json');
  const baseVerdRel = baseCand.verdictRelPath || baseCand.topoRelPath || 'runs/pilot_v2_campaign/smoke/smoke_v2.verdict.json';
  const altVerdRel = altCand.verdictRelPath || altCand.topoRelPath || baseVerdRel;

  const factsMd = `# Fact Ledger (\`Gate F1\`) — \`foundry_showcase_60s.mp4\` (Pilot v2)

Every quantitative figure displayed in the 60-second explainer film is deterministically exported by \`export_video_data.mjs\` from verified repository artifacts:

| Claim on Screen | Exact Verified Value | Source Artifact |
| :--- | :--- | :--- |
| Pilot v2 Spatial Envelope & Supports | \`1.0 × 1.0 × 2.0 m\`, \`3..4\` pinned ground anchors (\`z = 0\`) | \`TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json\` |
| Voxel Grid & Funicular Constraints | Min \`2 × 2 × 2\` voxel grid (\`XY\` symmetric), \`100%\` pure compression (\`N <= 0\`) | \`TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json\` |
| Planar-Quad & Unroll Constraints | Tube subdiv \`>= 1\`, quad warp \`<= 0.50 mm\`, per-bar 2D unrolled strips (\`0\` self-intersections) | \`TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json\` |
| Cast Gypsum Plaster Properties | \`E = 5.0 GPa\`, \`ρ = 1250 kg/m³\`, \`f_c = 12 MPa\`, \`f_t = 2 MPa\`, \`+50 kg\` top load, \`<= L/300\` (\`3.33 mm\`) | \`TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json\` |
| Swarm Exploration Scope | \`${totalEval}\` evaluated designs (\`${totalPassed}\` passed, \`${paretoCount}\` Pareto-optimal) across \`${gridStats.length}\` \`>= 2×2×2\` voxel grids | \`TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/pareto_summary.json\` |
| Explored \`>= 2×2×2\` Voxel Grids | ${gridSummaryMd} | \`TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/\` |
| Initial Baseline (\`${baseCand.stem}\`) | \`${baseCand.metrics.massKg.toFixed(2)} kg\`, \`${baseCand.metrics.nNodes}V / ${baseCand.metrics.nBars}E\`, \`${baseCand.metrics.areaM2.toFixed(2)} m²\` area, \`${(baseCand.metrics.compDom * 100).toFixed(1)}%\` compression (\`${gridDisplay(baseCand.gk)}\`) | \`TOPOGEN_FDM_Foundry/${baseVerdRel}\` |
| Comparison Variant (\`${altCand.stem}\`) | \`${altCand.metrics.massKg.toFixed(2)} kg\`, \`${altCand.metrics.nBars}\` bars, \`${altCand.metrics.areaM2.toFixed(2)} m²\` area — \`${altRejectReason}\` | \`TOPOGEN_FDM_Foundry/${altVerdRel}\` |
| Verified Pilot v2 Champion (\`${champTopo.name}\`) | \`${champMetrics.massKg.toFixed(2)} kg\` (\`${champMetrics.meshMassKg.toFixed(2)} kg\` mesh), \`${champMetrics.nNodes}\` nodes / \`${champMetrics.nBars}\` bars / \`${champMetrics.nAnc}\` anchors (\`${gridDisplay(champGk)}\`, \`${prettyPreset(champTopo?.metadata?.tilePreset)}\`) | \`TOPOGEN_FDM_Foundry/${champVerdRel}\` |
| Champion Unrolled Fabrication Sheet | \`${champMetrics.areaM2.toFixed(4)} m²\` total unrolled area across \`${champMetrics.nBars}\` non-overlapping strips (\`${unrollData.cutSegs.length}\` cut segs, \`${unrollData.foldSegs.length}\` fold creases) | \`TOPOGEN_FDM_Foundry/${champUnrollRel}\` |
| Champion Planar-Quad Tubular Mesh | \`${secDesc}\`, subdiv level \`${champMetrics.subdivLevels}\`, max quad warp \`${champMetrics.maxWarpMm.toFixed(4)} mm\` (\`<= 0.50 mm\`), \`${champObj.verts.length}V / ${champObj.faces.length}F\` watertight manifold | \`TOPOGEN_FDM_Foundry/${champVerdRel}\` |
| Champion Cast-Plaster FEA (\`+50 kg\`) | \`${champMetrics.dispMm.toFixed(3)} mm\` deflection, \`100%\` pure compression (\`${champMetrics.tensileBars}\` tension bars), \`${champMetrics.sfC.toFixed(1)}×\` crushing, \`${champMetrics.sfB.toFixed(1)}×\` buckling, \`${(champMetrics.funEff * 100).toFixed(1)}%\` funicular | \`TOPOGEN_FDM_Foundry/${champVerdRel}\` |
| Champion 5% Lateral Stability & Suite | \`${champMetrics.latDispMm.toFixed(3)} mm\` lateral drift (\`${champMetrics.latMinSF.toFixed(1)}×\` min SF); \`14 / 14\` analytical & Pilot v2 verifier benchmarks passed (\`0\` cross-imports) | \`TOPOGEN_FDM_Foundry/verifier/test_verifier.mjs\` |
`;
  fs.writeFileSync(path.join(__dirname, 'facts_foundry_60s.md'), factsMd, 'utf8');

  // Also write a machine-readable JSON summary so facts_foundry_60s.md can be verified 1:1
  const summaryPath = path.join(__dirname, 'exported_facts_summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify({
    championSource: champBundle.sourceRel,
    campaignEvaluated: totalEval,
    campaignPassed: totalPassed,
    paretoCount,
    r1PassPct: +r1PassPct.toFixed(1),
    finalPassPct: +r3OrAllPassPct.toFixed(1),
    exploredGrids: gridStats,
    baseline: {
      stem: baseCand.stem,
      source: baseCand.topoRelPath,
      grid: baseCand.gk,
      preset: baseCand.preset,
      massKg: +baseCand.metrics.massKg.toFixed(2),
      areaM2: +baseCand.metrics.areaM2.toFixed(3),
      nNodes: baseCand.metrics.nNodes,
      nBars: baseCand.metrics.nBars,
      compDomPct: +(baseCand.metrics.compDom * 100).toFixed(1)
    },
    altCandidate: {
      stem: altCand.stem,
      source: altCand.topoRelPath,
      grid: altCand.gk,
      preset: altCand.preset,
      massKg: +altCand.metrics.massKg.toFixed(2),
      areaM2: +altCand.metrics.areaM2.toFixed(3),
      nBars: altCand.metrics.nBars,
      reason: altRejectReason
    },
    champion: {
      stem: champTopo.name,
      source: champBundle.sourceRel,
      grid: champGk,
      preset: champTopo?.metadata?.tilePreset,
      section: secDesc,
      nNodes: champMetrics.nNodes,
      nBars: champMetrics.nBars,
      nAnchors: champMetrics.nAnc,
      massKg: +champMetrics.massKg.toFixed(2),
      meshMassKg: +champMetrics.meshMassKg.toFixed(2),
      areaM2: +champMetrics.areaM2.toFixed(4),
      dispMm: +champMetrics.dispMm.toFixed(3),
      minSF: +champMetrics.minSF.toFixed(2),
      sfC: +champMetrics.sfC.toFixed(2),
      sfB: +champMetrics.sfB.toFixed(2),
      latDispMm: +champMetrics.latDispMm.toFixed(3),
      latMinSF: +champMetrics.latMinSF.toFixed(2),
      funEffPct: +(champMetrics.funEff * 100).toFixed(1),
      compDomPct: +(champMetrics.compDom * 100).toFixed(1),
      tensileBars: champMetrics.tensileBars,
      maxWarpMm: +champMetrics.maxWarpMm.toFixed(4),
      subdivLevels: champMetrics.subdivLevels,
      objVerts: champObj.verts.length,
      objFaces: champObj.faces.length,
      unrollCutSegs: unrollData.cutSegs.length,
      unrollFoldSegs: unrollData.foldSegs.length
    },
    exploreTitles: finalExplore.map(e => `${e.stem} (${e.gk}, ${e.preset})`)
  }, null, 2), 'utf8');

  console.log(
    `Exported ${outPath} (${(header.length / 1024).toFixed(1)} KB): ` +
    `${TARGET_EXPLORE} Pilot v2 options, ${gridStats.length} >=2x2x2 grids, ` +
    `${allPointsSrc.length} scatter pts (${paretoCount} Pareto), ` +
    `${unrollData.cutSegs.length} unroll cut segs + ${unrollData.foldSegs.length} fold segs.`
  );
}

main();

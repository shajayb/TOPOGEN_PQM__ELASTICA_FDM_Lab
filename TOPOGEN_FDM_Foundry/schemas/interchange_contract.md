# WFC-FDM Foundry Air-Gap & Interchange Contract

## Air-Gap Rule (Strict)
1. **Generator domain** (`TOPOGEN_FDM_Foundry/index_WFC.html`, `TOPOGEN_FDM_Foundry/run_generator.mjs`, `TOPOGEN_FDM_Foundry/presets/`) generates centerline graphs, runs Force Density Method (FDM) form-finding, solidifies watertight quad-dominant Planar-Quad (PQ) tubular meshes with longitudinal subdivision, and exports 2D unrolled per-bar fabrication patterns.
2. **Verifier domain** (`TOPOGEN_FDM_Foundry/verifier/`) is strictly independent. Generator code and generator-optimization agents MUST NEVER read, import, or edit any file inside `TOPOGEN_FDM_Foundry/verifier/`. Verifier code and verification agents MUST NEVER read, import, or edit `TOPOGEN_FDM_Foundry/index_WFC.html` or `TOPOGEN_FDM_Foundry/run_generator.mjs`.
3. Communication between Generator and Verifier occurs **exclusively** via neutral artifact files on disk:
   - Input Brief: `TOPOGEN_FDM_Foundry/briefs/<brief>.json`
   - Candidate Topology JSON: `<candidate>.topology.json`
   - Candidate Tubular Mesh OBJ: `<candidate>.mesh.obj`
   - Candidate Per-Bar Unrolled Patterns SVG (when required by brief): `<candidate>.patterns.svg`
   - Candidate Per-Bar Unrolled Geometry JSON (companion to `.patterns.svg`): `<candidate>.unrolled.json`
   - Verifier Verdict JSON: `<candidate>.verdict.json`

## Neutral Topology JSON Format (`wfc-fdm-topology/v1`)
```json
{
  "$schema": "wfc-fdm-topology/v1",
  "name": "candidate_id",
  "units": "meters",
  "coordinateSystem": "Z-up",
  "vertices": [[x, y, z], ...],
  "edges": [[u, v], ...],
  "anchors": [vertexIndex, ...],
  "section": {
    "shape": "circular_solid" | "circular_hollow",
    "outerRadiusM": 0.015,
    "innerRadiusM": 0.008,
    "nSides": 8
  },
  "fdm": {
    "mode": "compression" | "tensile" | "zero-weight",
    "forceDensities": [q0, q1, ...],
    "equilibriumResidual": 1e-12
  },
  "geometry": {
    "tubeTopology": true,
    "longitudinalSubdivLevels": 1,
    "pqOptimizationApplied": true,
    "maxQuadPlanarityErrorM": 0.0,
    "meanQuadPlanarityErrorM": 0.0,
    "barTubeQuadCount": 384
  },
  "fabrication": {
    "unrolledPatternsFile": "candidate_id.patterns.svg",
    "unrolledDataFile": "candidate_id.unrolled.json",
    "barCount": 24,
    "unrolledBarCount": 24,
    "totalUnrolledSurfaceAreaM2": 0.52,
    "hasSelfIntersection": false
  },
  "metadata": {
    "source": "TOPOGEN_FDM_Foundry/index_WFC.html",
    "wfcSeed": 42,
    "gridResolution": [2, 2, 3],
    "tilePreset": "catenary_quadripod",
    "symmetryXY": true,
    "qProfile": "column_boosted"
  }
}
```
Note: `section.outerRadiusM` (and optional per-edge `edgeRadiiM`) specifies the cast plaster cross-section radius of the tubular members. If `innerRadiusM === 0`, members are solid cast plaster cylinders of radius `outerRadiusM`; if `innerRadiusM > 0`, hollow plaster tubes with wall thickness `outerRadiusM - innerRadiusM`.

## Planar Quad (PQ) & Longitudinal Subdivision Definition
- **Longitudinal Subdivision (`longitudinalSubdivLevels = L >= 1`)**: Every bar's tubular trunk is subdivided along its axis into `L + 1` longitudinal segments (`L` intermediate cross-sectional rings between its start and end junction rings), yielding `(L + 1) * nSides` planar quad faces per bar trunk.
- **Quad Planarity Error (`maxQuadPlanarityErrorM`)**: For any quad face `(v0, v1, v2, v3)` in `<candidate>.mesh.obj`, let `d1 = v2 - v0` and `d2 = v3 - v1` be its diagonals, `n = normalize(d1 × d2)` be the unit normal parallel to both diagonals (fallback to best-fit triangle normal if degenerate), and `c = 0.25 * (v0 + v1 + v2 + v3)`. The exact minimax vertex distance to the equidistant plane is `err = max_i |(v_i - c) · n| = 0.25 * |(v0 - v1 + v2 - v3) · n|` in meters. All quad faces in `.mesh.obj` must satisfy `err <= brief.geometry.maxQuadPlanarityErrorM` (e.g. `<= 0.0005` m = `0.5` mm). Any junction cap triangle pairs whose merged quad would exceed `maxQuadPlanarityErrorM` should remain clean triangles rather than warped quads.

## Neutral Unrolled Fabrication Pattern Files (`<candidate>.patterns.svg` & `<candidate>.unrolled.json`)
When `brief.fabrication.requireUnrolledPatternsPerBar` is `true`:
1. `<candidate>.patterns.svg`: Standalone SVG (`<svg xmlns="http://www.w3.org/2000/svg" ...>`) containing one `<g id="bar-0"> ... </g>` group per bar (`0 .. nEdges - 1`), rendering outer cut contours, internal longitudinal/transverse fold lines, and bar ID labels in millimeters or meters with non-overlapping 2D layout boxes.
2. `<candidate>.unrolled.json`: Neutral companion JSON for deterministic air-gapped verification:
```json
{
  "$schema": "wfc-fdm-unrolled/v1",
  "name": "candidate_id",
  "units": "meters",
  "barCount": 24,
  "totalUnrolledSurfaceAreaM2": 0.5214,
  "hasSelfIntersection": false,
  "bars": [
    {
      "edgeIndex": 0,
      "endpoints": [u, v],
      "centerlineLengthM": 0.612,
      "subdivLevels": 1,
      "nSides": 8,
      "areaM2": 0.0217,
      "bbox2D": [minX, minY, maxX, maxY],
      "quads2D": [
        [[x0, y0], [x1, y1], [x2, y2], [x3, y3]],
        ...
      ]
    }
  ]
}
```
Each `quads2D` entry is a 2D convex planar quad in local strip coordinates (or sheet coordinates) with positive signed area and zero non-shared edge intersections within the bar's 2D strip.

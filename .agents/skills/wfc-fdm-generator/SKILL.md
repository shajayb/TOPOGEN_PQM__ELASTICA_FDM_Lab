---
name: wfc-fdm-generator
description: Operate, configure, and optimize the WFC_FDM_Foundry generator (index_WFC.html and run_generator.mjs) to synthesize Wave Function Collapse (WFC) centerline graphs, run Force Density Method (FDM) funicular form-finding (tensile, zero-weight, compression), solidify watertight quad-dominant tubular meshes, and export neutral wfc-fdm-topology/v1 JSON + Quad OBJ artifacts for air-gapped verification.
---

# WFC-FDM Generator Skill (`wfc-fdm-generator`)

Use this skill whenever you need to **generate, tune, or optimize funicular tubular network candidates** inside `WFC_FDM_Foundry/` for any structural and fabrication brief conforming to `WFC_FDM_Foundry/schemas/brief.schema.json`.

---

## 1. Strict Air-Gap Rule

> [!CAUTION]
> **Generator-domain code and generator-optimization agents MUST NEVER read, import, or edit any file inside `WFC_FDM_Foundry/verifier/`.**

All communication with the independent verifier occurs strictly through neutral on-disk artifacts specified in `WFC_FDM_Foundry/schemas/interchange_contract.md`:
- Input: `WFC_FDM_Foundry/briefs/<brief>.json`
- Output: `<candidate>.topology.json` (`wfc-fdm-topology/v1`) and `<candidate>.mesh.obj` (Quad-dominant watertight OBJ)
- Feedback: `<candidate>.verdict.json` (read-only diagnostic output produced by the verifier)

---

## 2. Modular Student-Friendly Architecture (Zero Build Step)

To keep student & agent edits fast and low-token (never reading a 16k-line monolith), the generator is organized into small, zero-build-step ES modules (see `WFC_FDM_Foundry/STUDENT_GUIDE.md` for the full file map):

1. **`WFC_FDM_Foundry/core/` (Pure-JS Generator Engine — Browser & Node.js)**:
   - `core/index.mjs` — Unified `WFC_FDM_CORE` (`globalThis.WFC_FDM_CORE`), `loadWfcCore()`, `generateCandidate()`, `buildFoundryTopologyJSON()`.
   - `core/math_tiles.mjs` — `V3`, `createTileTemplates()`, `TILE_PRESETS`, socket adjacency rules.
   - `core/wfc_graph.mjs` — `runWFCSolver()`, `buildWeldedGraphFromVoxels()`, `cleanAndWeldGraph()`.
   - `core/fdm_solver.mjs` — `selectGroundAnchors()`, `assignForceDensities()`, `solveFDM()`, `conditionCompressionOnlyNetwork()`.
   - `core/pq_solidifier.mjs` (+ `pq_face_loops.mjs`, `pq_subdivision.mjs`) — Bisector-stitched all-quad PQ tubular solidifier, longitudinal/CC/ring subdivision, `verifyManifold()`, `buildQuadDominantOBJ()`.
   - `core/unroll_patterns.mjs` — 2D per-bar strip unrolling & non-overlapping laser-bed `.svg` layout.
   - `core/frame_fea_preview.mjs` — Generator-side pure-JS space-frame preview (`estimateFrameMechanics`, `analyzeSpaceFrameFEA`, zero `verifier/` imports).
2. **`WFC_FDM_Foundry/index_WFC.html` + `WFC_FDM_Foundry/ui/` (6-Tab Workbench UI)**:
   - Lightweight ~230-line HTML shell loading `ui/styles/workbench.css` and `ui/main.js`.
   - **Targeted student edits**: open **only** the specific module needed — `ui/styles/workbench.css` (theme), `ui/display/viewport_scene.js` (3D lighting/camera/Arctic), `ui/display/display_hud.js` (Display HUD/Outliner/Goldilocks), `ui/display/telemetry_hud.js`, or the single tab file `ui/tabs/tab1_tiles.js` .. `ui/tabs/tab6_io.js` (`220–1,280` lines each).
3. **`WFC_FDM_Foundry/run_generator.mjs` (Fast ESM & Warm Batch CLI)**:
   - Imports `./core/index.mjs` directly (~35 ms cold start) and supports `--batch <batch.json>` and `--stdin-jsonl` persistent streaming modes alongside all single-candidate CLI flags.

---

## 3. Core Generation Pipeline

Every candidate passes through four deterministic stages:

```text
[1. WFC / Growth Graph] ──> [2. Vertex Welding & Anchor Selection]
                                            │
[4. Watertight Quad OBJ + Topology JSON] <── [3. Force Density Method (FDM)]
```

### Stage 1: WFC Seed Tiles & Adjacency Synthesis
- Synthesizes a 3D spatial centerline network on a voxel grid (`gridResolution: [nx, ny, nz]`) using a deterministic seeded WFC / Adjacency Growth solver (`runWFCSolver`) with optional XY symmetry.
- **Tile catalog**: `null`, `cross`, `vtube`, `htube`, `htube_y`, `xbrace_xz`, `xbrace_yz`, `diag_pyramid`, `arch_vault`, `tripod_leg`, `diaphragm_xy`.
- **Structural presets**: `pilot_champion` *(default verified champion)*, `catenary_quadripod`, `funicular_vault`, `slender_diagrid`, `hyperboloid_tower`, `arch_braced`, `diagrid_tower`, `space_frame`, `funnel_vault`, `minimal_frame`, `default_ortho`.
- Welds coincident endpoints across adjacent tiles (`buildWeldedGraphFromVoxels`), extracts the largest connected component (`extractLargestComponent`), prunes non-anchor dangling leaves (`pruneNonAnchorLeaves`), and collapses degenerate short edges (`collapseShortEdges`).

### Stage 2: Anchor Selection & Envelope Conditioning
- Selects between `supports.minAnchors` and `supports.maxAnchors` corner-most ground support nodes (`selectGroundAnchors`) near `z ≈ z_min`.
- Snaps anchors onto `envelope.groundZ` (default `0.0`) and fits XY plan footprint cleanly within `maxPlanX × maxPlanY`.

### Stage 3: Force Density Method (FDM) Form-Finding
Solves the exact linear nodal equilibrium system (`solveFDM`) using Gaussian elimination with partial pivoting for free nodes `x_f` given fixed anchor coordinates `x_s` and branch force densities `Q = diag(q)`:

$$C_f^T Q C_f \, \mathbf{x}_f = \mathbf{p}_f - C_f^T Q C_s \, \mathbf{x}_s$$

Supports all three funicular modes:
- **`compression`** *(recommended for cast gypsum plaster and masonry)*: Solves with upward nodal loads `p_z > 0` on free nodes so the resulting inverted hanging vault/tower carries downward gravity + imposed vertical load primarily in axial compression, minimizing brittle tensile bending.
- **`zero-weight`**: Self-equilibrated minimal network with `p_f = 0` at all free nodes (requires non-coplanar anchors to maintain height by the discrete maximum principle).
- **`tensile`**: Positive force densities `q > 0` forming a tensioned cable-net under anchor tension and optional loads.

Force-density (`q`) profiles & refinement:
- **`uniform`**: Equal force density across all edges.
- **`height_graded`**: Scales `q` smoothly with elevation to control arch rise and crown flatness.
- **`column_boosted`**: Increases `q` on lower primary load-path legs (`--column-boost`, `--anchor-boost`) to draw thrust cleanly into the ground anchors and prevent excessive lateral splay.
- **`funicular_tuned` (`optimizeForceDensities` / `--optimize-fdm`)**: Optional iterative load-path & self-weight refinement pass that adjusts `q_e` by member inclination, height, and tributary load to minimize bending under vertical loads.
- **Exact target-height re-solve & post-FDM welding**: Scales load/force-density ratio to hit `envelope.targetHeightZ` cleanly (`~1e-13` residual) and runs `weldCoincidentGraphNodes()` post-FDM to eliminate overlapping junctions where symmetric unlinked nodes converge to identical 3D coordinates.

### Stage 4: Tubular Mesh Solidification & Export
- Converts the form-found centerline graph into a closed, watertight, quad-dominant tubular mesh using bisector-stitched node junctions (`solidifyGraphBisectorStitched`, `computeEndRingBisectorStitched`, `mergeTrianglesToQuads`, `buildQuadDominantOBJ`) with outward-oriented leaf end-caps, degenerate-quad-to-triangle collapse, and an automatic watertight convex-hull junction fallback in `solidifyGraph()` for complex/slender nodes.
- Supports both solid (`innerRadiusM = 0`) and hollow cast circular sections (`innerRadiusM > 0`, respecting `minWallThicknessM`).
- Verifies manifold topology (`verifyManifold`: `0` boundary edges, `0` non-manifold edges) before writing `<name>.mesh.obj`.
- Writes `<name>.topology.json` (`buildFoundryTopologyJSON`) strictly conforming to `wfc-fdm-topology/v1` (Z-up, meters, `vertices`, `edges`, `anchors`, `section`, `fdm`, `metadata`).

---

## 4. Operating the Generator

### Interactive Browser Mode
Open `WFC_FDM_Foundry/index_WFC.html` in any modern browser (or via a local static server):
1. Generate a WFC centerline graph from the tile/growth tabs or switch directly to the **`3. FDM & Tubes`** tab.
2. Pick a structural preset (e.g., `pilot_champion`, `catenary_quadripod`, `funicular_vault`, `slender_diagrid`, `hyperboloid_tower`, `arch_braced`), choose the FDM mode (`compression`, `zero-weight`, `tensile`), `q` profile (`uniform`, `height_graded`, `column_boosted`, `funicular_tuned`), load, max anchors, and target envelope, then click **Run FDM** to inspect the force-colored network and anchor spheres.
3. Configure tubular mesh parameters (outer radius `outerRadiusM`, hollow **`Inner R`** slider `innerRadiusM`, `nSides`, end offset, bisector stitching), click **Solidify**, and confirm the manifold status readout reports watertight manifold geometry.
4. Click the `.topology.json` and `.mesh.obj` export buttons to save neutral artifacts for the air-gapped verifier.

### Headless CLI Mode
```bash
node WFC_FDM_Foundry/run_generator.mjs \
  --brief WFC_FDM_Foundry/briefs/pilot_brief.json \
  [--config WFC_FDM_Foundry/runs/configs/candidate.json] \
  --out-dir WFC_FDM_Foundry/runs/batch_01 \
  --name cand_001 \
  [--seed 42] \
  [--preset pilot_champion] \
  [--mode compression] \
  [--grid 1,1,3] \
  [--radius 0.0125] \
  [--inner-radius 0.0065] \
  [--sides 8] \
  [--q-profile column_boosted] \
  [--q-base 1.0] \
  [--column-boost 4.0] \
  [--anchor-boost 1.5] \
  [--optimize-fdm]
```
- `--brief <path>`: Required path to a brief JSON file conforming to `brief.schema.json`.
- `--config <path>`: Optional JSON overriding generator parameters.
- `--out-dir <dir>`: Output directory (created automatically if missing).
- `--name <id>`: Candidate identifier prefix; produces `<out-dir>/<name>.topology.json` and `<out-dir>/<name>.mesh.obj`.
- `--seed <n>`: Deterministic WFC RNG seed.
- `--preset <name>`: Structural tile preset (`pilot_champion`, `catenary_quadripod`, `funicular_vault`, `slender_diagrid`, `hyperboloid_tower`, `arch_braced`, `diagrid_tower`, `space_frame`, `funnel_vault`, `minimal_frame`, `default_ortho`).
- `--mode <compression|tensile|zero-weight>`: Funicular FDM mode override.
- `--grid <nx,ny,nz>`: Voxel grid resolution override (e.g. `1,1,3` or `3,3,6`).
- `--radius <m>`: Cast tube outer radius `outerRadiusM` in meters (e.g. `0.0125`).
- `--inner-radius <m>`: Optional hollow tube inner radius `innerRadiusM` in meters (e.g. `0.0065`; keep `outerRadiusM - innerRadiusM >= minWallThicknessM`).
- `--sides <n>`: Circumferential polygon sides per tube (default `8`).
- `--q-profile <name>`: Force-density profile (`uniform`, `height_graded`, `column_boosted`, `funicular_tuned`).
- `--q-base <num>`: Base force density scalar.
- `--column-boost <num>`: Multiplier applied to primary vertical/column load-path edges.
- `--anchor-boost <num>`: Multiplier applied to anchor-incident edges.
- `--optimize-fdm`: Enables the iterative `optimizeForceDensities` load-path refinement pass.

---

## 5. Optimization & Tuning Heuristics

When iterating on candidates based on verifier verdict diagnostics:

| Symptom in Verdict | Generator-Side Adjustment |
| :--- | :--- |
| **Low Tensile Safety Factor (`SF_t < min`)** | Switch FDM mode to `compression`; increase arch/vault rise or leg-boosted `q` to align members with thrust lines; add triangulated/braced tile presets to turn bending into axial force; increase `outerRadiusM` (section modulus scales as `r^3`). |
| **Excessive Deflection (`maxDisp > L/300`)** | Increase `outerRadiusM` (stiffness `EI` scales as `r^4`); increase lateral bracing/triangulation in tile preset; reduce unbraced member lengths; check that anchors are well-spread near envelope corners. |
| **Euler Buckling Failure (`SF_b < min`)** | Shorten long slender compression legs (increase vertical grid subdivisions or braced presets); increase `outerRadiusM` (`I` scales as `r^4`). |
| **Slenderness Violation (`L / r_g > max`)** | Increase `outerRadiusM` (since `r_g = r/2` for solid tubes) or subdivide long edges via finer grid / braced tiles. |
| **Envelope Overflow (`planX/Y` or `heightZ`)** | Enable/tighten target-envelope scaling and ground anchor snapping (`z = groundZ`). |
| **Non-Manifold or Open Mesh** | Ensure bisector stitching is enabled, tune end-offset relative to `outerRadiusM`, avoid extremely short edges (`L < 2.5 * outerRadiusM`), and keep `nSides >= 6` (default `8`). |
| **Excessive Plaster Mass** | Once all structural margins pass with headroom, step down `outerRadiusM` or explore hollow sections (`innerRadiusM > 0`, respecting `minWallThicknessM`) and cleaner funicular load paths. |

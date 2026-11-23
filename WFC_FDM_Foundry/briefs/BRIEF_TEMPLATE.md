# WFC-FDM Foundry — Structural & Fabrication Brief Template

> **How to Invoke the Foundry**: Copy this template (and `BRIEF_TEMPLATE.json`) to `WFC_FDM_Foundry/briefs/<brief_slug>.md` + `<brief_slug>.json`, fill in the sections below, and prompt:
> *"Run `wfc-fdm-foundry` on `WFC_FDM_Foundry/briefs/<brief_slug>.json` through all 7 phases (air-gapped Generate → Verify → Optimize → Goldilocks 3D HTML Report → 60s Showcase Video)."*

---

## 1. Project Identity & Spatial Envelope
- **Brief ID**: `<slug-e.g.-plaster-tower-v2>`
- **Envelope (`X × Y × Z`, meters, Z-up)**: `<maxPlanX> m × <maxPlanY> m` in plan, `<targetHeightZ> m` in height (`minHeightZ` .. `maxHeightZ`)
- **Ground Plane**: `z = <0.0> m` (`± <0.02> m` tolerance)

## 2. WFC Topology & Voxel Grid Constraints
- **Minimum Voxel Resolution**: `<nx> × <ny> × <nz>` (e.g., `2 × 2 × 2`)
- **Maximum Voxel Resolution**: `<nx_max> × <ny_max> × <nz_max>` (optional)
- **Symmetry**: `XY symmetric` (`true` / `false`)
- **Connectivity**: Single connected component, zero dangling non-anchor leaves

## 3. Geometry & Funicular Form-Finding Metrics
- **Funicular Mode**: `compression` | `tensile` | `zero-weight` | `auto`
- **Compression-Only Network**: `true` / `false` (if `true`: `100%` of bars in net axial compression under governing load case, `maxTensileAxialForceN = 0`)
- **Bar Topology**: `tube_topology` (`true` — every bar solidified as a watertight quad-dominant circular tube)
- **Subdivision & Planar Quad (PQ) Requirement**:
  - `{longitudinal subdivision + PQ planarization}` applied at least `<1>` time (`minLongitudinalSubdivLevels >= 1`, `requirePQOptimization = true`)
  - Max quad planarity deviation: `<= <0.0005> m` (`0.5 mm`)
- **Cross-Section Bounds**: Outer radius `<12–90> mm`, optional hollow wall thickness `>= <6> mm`

## 4. Supports & Boundary Conditions
- **Anchor Count**: `<minAnchors>` .. `<maxAnchors>` (e.g., `3..4`)
- **Support Location**: Ground plane (`z = 0`) | Elevated | Custom
- **Restraint Type**: `pinned` (`ux=uy=uz=0`, conservative for cast plaster) | `fixed`

## 5. Material & Structural Load Cases
- **Material**: Standard Cast Gypsum Plaster (`E = 5.0 GPa`, `ρ = 1250 kg/m³`, `ν = 0.24`, `f_c = 12.0 MPa`, `f_t = 2.0 MPa`, `f_v = 1.5 MPa`) — or custom material
- **Load Case 1 (Required)**: Self-weight (`g = 9.81 m/s²`)
- **Load Case 2 (Required)**: Self-weight + `<massKg> kg` vertical distributed load (`top_zone_nodes` / `all_free_nodes`)
- **Lateral Stability Check**: `5%` notional horizontal load (`LC_lateral_5pct`, advisory or required)

## 6. Structural Acceptance Criteria (Air-Gapped FEA)
- **Maximum Allowable Deflection**: `L / <300>`
- **Minimum Tensile Safety Factor (`SF_t`)**: `>= <1.5>`
- **Minimum Compressive Safety Factor (`SF_c`)**: `>= <2.0>`
- **Minimum Euler Buckling Safety Factor (`SF_b`)**: `>= <2.0>`
- **Minimum Member Length / Max Slenderness**: `>= <0.04> m` / `L/r_g <= <120>`

## 7. Fabrication Metrics & Unrolled Patterns
- **Watertight Manifold Mesh**: Required (`0` boundary edges, `0` non-manifold edges)
- **Per-Bar Unrolled Fabrication Patterns**: `true` / `false` (every bar must unroll into a valid, non-self-intersecting 2D strip pattern `.svg`)
- **Unrolled Surface Area**: `minimize` (`totalUnrolledSurfaceAreaM2`)

## 8. Optimization Objectives (Multi-Objective Pareto Ranking)
1. **Minimize Total Unrolled Surface Area** (`m²`)
2. **Minimize Number of Elements / Bars** (`nEdges`)
3. **Minimize Total Cast Plaster Mass** (`kg`)
4. **Maximize Funicular Efficiency** (`0..1`) & Lateral Stability Margin

## 9. Mandatory Foundry Deliverables
- [x] **Air-Gapped Verification Suite**: `10/10` analytical benchmarks (`test_verifier.mjs`) + champion `verdict.json` (`0` generator↔verifier cross-imports)
- [x] **Interactive 3D Goldilocks HTML Explainer (`foundry_report.html`)**: `H1 · Use / H2 · Guide / H3 · Telemetry`, live 3D viewer (`Tubular`, `FDM`, `WFC Tiles`, `FEA Stress`), swarm history, Pareto front, WFC tile catalog & 6-direction adjacency matrix, FDM `q_e` details, FEA scorecards, verified with `0` console errors
- [x] **60-Second Showcase Explainer Video (`foundry_showcase_60s.mp4`)**: `1920×1080 @ 30 FPS`, cycling `>= 16` explored options across all voxel grids with **live adjacent 3D FEA**, unified CAD shaded tubular display for all comparison candidates, sequential cycle through all constituent WFC tiles + adjacency table + WFC collapse, FDM↔FEA optimization loop, and `F1/S1/Q1-A/Q1-B` contact-sheet + post-encode decoded verification

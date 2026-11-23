# Fact Ledger (`Gate F1`) — `foundry_showcase_60s.mp4` (Pilot v2)

Every quantitative figure displayed in the 60-second explainer film is deterministically exported by `export_video_data.mjs` from verified repository artifacts:

| Claim on Screen | Exact Verified Value | Source Artifact |
| :--- | :--- | :--- |
| Pilot v2 Spatial Envelope & Supports | `1.0 × 1.0 × 2.0 m`, `3..4` pinned ground anchors (`z = 0`) | `TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json` |
| Voxel Grid & Funicular Constraints | Min `2 × 2 × 2` voxel grid (`XY` symmetric), `100%` pure compression (`N <= 0`) | `TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json` |
| Planar-Quad & Unroll Constraints | Tube subdiv `>= 1`, quad warp `<= 0.50 mm`, per-bar 2D unrolled strips (`0` self-intersections) | `TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json` |
| Cast Gypsum Plaster Properties | `E = 5.0 GPa`, `ρ = 1250 kg/m³`, `f_c = 12 MPa`, `f_t = 2 MPa`, `+50 kg` top load, `<= L/300` (`3.33 mm`) | `TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json` |
| Swarm Exploration Scope | `72` evaluated designs (`58` passed, `11` Pareto-optimal) across `8` `>= 2×2×2` voxel grids | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/pareto_summary.json` |
| Explored `>= 2×2×2` Voxel Grids | `2×2×2` (10/14), `2×2×3` (9/12), `2×2×4` (8/9), `3×3×3` (6/8), `3×3×4` (6/8), `3×3×5` (6/7), `3×3×6` (6/6), `4×4×6` (7/8) | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/` |
| Initial Baseline (`smoke_v2`) | `27.88 kg`, `36V / 111E`, `4.05 m²` area, `96.4%` compression (`2×2×3`) | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/smoke/smoke_v2.verdict.json` |
| Comparison Variant (`r1_26_diagrid_334`) | `2.63 kg`, `26` bars, `0.27 m²` area — `Lateral Drift 397 mm (Reject)` | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/round1/r1_26_diagrid_334.verdict.json` |
| Verified Pilot v2 Champion (`r2_04_diagridt_335`) | `3.49 kg` (`4.16 kg` mesh), `17` nodes / `16` bars / `4` anchors (`3×3×5`, `Diagrid Tower`) | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/champion/champion.verdict.json` |
| Champion Unrolled Fabrication Sheet | `0.5976 m²` total unrolled area across `16` non-overlapping strips (`320` cut segs, `352` fold creases) | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/champion/champion.unrolled.json` |
| Champion Planar-Quad Tubular Mesh | `Hollow 12.0 / 6.0 mm`, subdiv level `1`, max quad warp `0.0005 mm` (`<= 0.50 mm`), `274V / 288F` watertight manifold | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/champion/champion.verdict.json` |
| Champion Cast-Plaster FEA (`+50 kg`) | `0.171 mm` deflection, `100%` pure compression (`0` tension bars), `29.6×` crushing, `9.4×` buckling, `99.6%` funicular | `TOPOGEN_FDM_Foundry/runs/pilot_v2_campaign/champion/champion.verdict.json` |
| Champion 5% Lateral Stability & Suite | `0.672 mm` lateral drift (`7.7×` min SF); `14 / 14` analytical & Pilot v2 verifier benchmarks passed (`0` cross-imports) | `TOPOGEN_FDM_Foundry/verifier/test_verifier.mjs` |

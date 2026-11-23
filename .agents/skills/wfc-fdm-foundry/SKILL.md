---
name: wfc-fdm-foundry
description: Orchestrate end-to-end air-gapped Generate -> Verify -> Optimize -> HTML Explainer -> 60s Video design campaigns in TOPOGEN_FDM_Foundry for ANY structural and fabrication brief conforming to brief.schema.json. Enforces the strict Generator/Verifier air-gap, runs analytical verifier benchmarks, executes parametric/swarm exploration, applies diagnosis-driven optimization (including compression-only, PQ longitudinal-subdiv tubes, unrolled patterns, min surface area, and min element count), and mandates both an interactive 3D Goldilocks HTML explainer and a verified 60s showcase video.
---

# WFC-FDM Foundry End-to-End Orchestrator Skill (`wfc-fdm-foundry`)

Use this skill whenever the user asks to **run a Foundry design-and-verification campaign** for `pilot_brief.json`, `pilot_v2_pq_unrolled.json`, `arch_canopy_example.json`, or **any new structural + fabrication brief** instantiated from `TOPOGEN_FDM_Foundry/briefs/BRIEF_TEMPLATE.md` / `BRIEF_TEMPLATE.json`.

This skill coordinates three sibling skills while strictly preserving the Generator/Verifier air-gap:
- **Generator**: `.agents/skills/wfc-fdm-generator/SKILL.md` (`TOPOGEN_FDM_Foundry/core/`, `ui/`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `run_generator.mjs`)
- **Verifier**: `.agents/skills/plaster-fe-verifier/SKILL.md` (`TOPOGEN_FDM_Foundry/verifier/`)
- **Explainer Video**: `.agents/skills/alice-explainer-video/SKILL.md` (`TOPOGEN_FDM_Foundry/video_build/`)

> [!TIP]
> **Fast Student Edits & Sub-5-Second Search**:
> - When customizing UI tabs, themes, or 3D display settings, consult `TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md` and read/edit **only** the targeted module inside `TOPOGEN_FDM_Foundry/ui/` or `TOPOGEN_FDM_Foundry/launcher_ui/` (200–1,280 lines each).
> - Use `foundry_server.mjs` + `foundry_runner.mjs` warm air-gapped `worker_threads` pools (`workers/generator_worker.mjs` & `workers/verifier_worker.mjs`): **`POST /api/quick-eval`** verifies a single candidate in **~70 ms**, **`searchProfile: 'lightning'`** completes Gates 1–5 in **~1.4 s**, **`'interactive'`** completes 25 Mode A/B evaluations in **~4.5 s**, and **`POST /api/nudge`** supports live mid-run candidate injection or `finish_round` early freeze.

---

## 1. The Non-Negotiable Air-Gap Contract

To guarantee that structural verification is never gamed or coupled to form-finding assumptions:

1. **Generator Isolation**: Generator code and generator-side optimization agents MUST NEVER read, import, or edit any file inside `TOPOGEN_FDM_Foundry/verifier/`.
2. **Verifier Isolation**: Verifier code MUST NEVER read, import, or edit `TOPOGEN_FDM_Foundry/index_TOPOGEN_PQM_ELASTICA_FDM.html` or `TOPOGEN_FDM_Foundry/run_generator.mjs`.
3. **Neutral Artifact Boundary Only**: Every handoff between Generator and Verifier happens strictly through files on disk as defined in `TOPOGEN_FDM_Foundry/schemas/interchange_contract.md`:
   - `TOPOGEN_FDM_Foundry/briefs/<brief>.json` (conforms to `TOPOGEN_FDM_Foundry/schemas/brief.schema.json`)
   - `<run_dir>/<candidate>.topology.json` (`wfc-fdm-topology/v1`)
   - `<run_dir>/<candidate>.mesh.obj` (Quad-dominant watertight OBJ, plus optional PQ & unrolled pattern JSON/SVG)
   - `<run_dir>/<candidate>.verdict.json` (Verifier scorecard & worst-member diagnostics)

---

## 2. The 7-Phase Foundry Pipeline (Generate → Verify → Optimize → Report → Film)

```text
[Phase 1: Brief & Benchmark Gate] ──> [Phase 2: Baseline Smoke Run] ──> [Phase 3: Broad Swarm Exploration]
                                                                                  │
[Phase 7: 60s Explainer Video] <── [Phase 6: Goldilocks 3D HTML] <── [Phase 5: Pareto Log] <── [Phase 4: Targeted Opt]
```

### Phase 1: Brief Validation & Verifier Benchmark Gate
1. Confirm the target brief JSON exists under `TOPOGEN_FDM_Foundry/briefs/` and satisfies `TOPOGEN_FDM_Foundry/schemas/brief.schema.json` (`envelope`, `topology`, `geometry`, `funicular`, `supports`, `material`, `loadCases`, `fabrication`, `acceptanceCriteria`, `objectives`, `deliverables`).
2. Run the independent analytical mechanics benchmark suite:
   ```bash
   node TOPOGEN_FDM_Foundry/verifier/test_verifier.mjs
   ```
   **Hard Gate**: Do not proceed unless `test_verifier.mjs` passes **100% (`10/10`)**.

### Phase 2: Baseline Smoke Run
1. Create a run folder: `TOPOGEN_FDM_Foundry/runs/<brief_id>_<timestamp>/`.
2. Generate and verify a baseline candidate via `run_generator.mjs` + `verifier/verify.mjs` to establish starting metrics (mass, element count, unrolled area, max deflection, `SF_t`, `SF_c`, `SF_b`, compression dominance, PQ planarity, manifoldness).

### Phase 3: Broad Parametric / Swarm Exploration
Explore diverse topologies across the generator's design space in parallel (respecting the strict air-gap):
- **Voxel resolutions**: honor `brief.topology.minGridResolution` (e.g., `>= 2×2×2`) and sweep multiple grid dimensions (`2×2×2`, `2×2×3`, `2×2×4`, `3×3×5`, `3×3×6`, etc.).
- **Topology diversity**: sweep all structural WFC tile presets (`pilot_champion`, `catenary_quadripod`, `funicular_vault`, `slender_diagrid`, `hyperboloid_tower`, `arch_braced`, `diagrid_tower`, `space_frame`, `funnel_vault`, `minimal_frame`, `default_ortho`) and multiple `--seed` values.
- **Funicular modes**: test `brief.funicular.allowedModes`; if `brief.funicular.requireCompressionOnly` is `true`, enforce `compression` mode and `100%` axial compression dominance (`N <= 0` on all bars).
- **Force-density profiles**: `uniform`, `height_graded`, `column_boosted`, `funicular_tuned` (`--optimize-fdm`).
- **Geometry & fabrication**: enforce tube topology, `{longitudinal subdivision + PQ planarization}` (`>= minLongitudinalSubdivLevels`), and per-bar unrolled 2D fabrication patterns when required by the brief.

### Phase 4: Diagnosis-Driven Multi-Objective Optimization
Filter candidates by failure mode in `<name>.verdict.json` and optimize along the brief's `objectives`:
- **Brittle tension (`SF_t`) or compression-only violation**: enforce `compression` FDM mode, tune `q` profiles (`column_boosted` / `funicular_tuned`), increase arch/vault curvature.
- **Deflection (`> L/300`) or lateral instability (`LC_lateral_5pct`)**: add triangulated bracing, widen ground anchor footprint within envelope, step up `outerRadiusM`.
- **Non-manifold junctions or PQ planarity error**: run post-FDM coincident-node welding, bisector-stitched quad tubes, longitudinal subdivision + PQ planarization.
- **Multi-objective Pareto minimization** (once feasibility is achieved): simultaneously minimize **plaster mass (`massKg`)**, **total unrolled surface area (`totalUnrolledSurfaceAreaM2`)**, and **number of elements (`nEdges`)** while maintaining strong safety margins (`SF_t >= 1.5`, `SF_c >= 2.0`, `SF_b >= 2.0`, `maxDisp <= L/300`, lateral `MinSF >= 1.5`).

### Phase 5: Pareto Frontier Logging & Champion Freeze
Save the verified Pareto log (`pareto_summary.json`) and freeze the winning champion in `TOPOGEN_FDM_Foundry/runs/champion/` (`champion.{topology.json,mesh.obj,verdict.json,config.json}` + unrolled pattern `.svg` when required).

---

## 3. Phase 6 — Mandatory Interactive 3D Goldilocks HTML Explainer Artifact

Every completed Foundry campaign MUST generate and browser-verify a standalone, zero-fetch interactive 3D report at `TOPOGEN_FDM_Foundry/foundry_report.html` via:
```bash
node TOPOGEN_FDM_Foundry/build_report.mjs
```

### Mandatory HTML Explainer Requirements
1. **Goldilocks 3-Layer Progressive Disclosure** (adapted from `index_TOPOGEN_PQM_ELASTICA_FDM.html`):
   - **`H1 · Use`** (default): Unobstructed Z-up Three.js studio viewport + sleek compact floating verdict card, 4-layer 3D switcher (`Tubular`, `FDM`, `WFC Tiles`, `FEA Stress`), and 3D milestone comparison switcher (`Champion`, `Baseline`, `Extreme/Rejected`, `Multi-Brief`).
   - **`H2 · Guide`**: Floating, draggable, resizable 4-tab panel covering:
     - **Tab 1 — Swarm History**: Stage-by-stage timeline, interactive Pareto scatter SVG, FDM mode comparison, preset pass-rate bars, and explored voxel-grid breakdown.
     - **Tab 2 — WFC Tiles & Adjacency**: Active winning tile card (edge/quad/socket breakdown), full tile catalog, interactive 6-direction WFC Adjacency Matrix (`+X,-X,+Y,-Y,+Z,-Z`), and `Highlight in 3D`.
     - **Tab 3 — FDM Form-Finding**: Mode, `q` profile, equilibrium residual, per-edge `q_e` bar chart, and ground anchor coordinates.
     - **Tab 4 — Air-Gapped FEA & Fabrication**: Load-case scorecards (`LC1`, `LC2`, `LC_lateral_5pct`), watertight/PQ/unrolled fabrication audit, and live 3D `Animate Deflection` with stress colormap & load/reaction arrows.
   - **`H3 · Telemetry`**: Auto-opens the right-hand Live Telemetry HUD (anchor reactions, air-gap audit) + Round failure-mode diagnostics, Top Critical Members table, and `10/10` Analytical Verifier Benchmarks.
2. **Live Browser QA Gate**: Launch via local HTTP server and verify in the browser with **zero console errors**, immediate 3D mesh render on load, and populated data across `H1 / H2 / H3` and all 4 tabs.

---

## 4. Phase 7 — Mandatory 60-Second Showcase Explainer Video

Every completed Foundry campaign MUST produce a verified **`60.0 s` (`1800` frames @ `30.00 FPS`, `1920×1080` Full HD, `22 Mbps` H.264)** explainer film at `TOPOGEN_FDM_Foundry/foundry_showcase_60s.mp4`, governed by `.agents/skills/alice-explainer-video/SKILL.md`:

```bash
node TOPOGEN_FDM_Foundry/video_build/export_video_data.mjs
clang++ -std=c++20 -O2 -DNOMINMAX TOPOGEN_FDM_Foundry/video_build/render_foundry_60s.cpp -o TOPOGEN_FDM_Foundry/video_build/render_foundry_60s.exe -lgdiplus -lmfplat -lmfreadwrite -lmfuuid -lole32 -luser32 -lgdi32
./TOPOGEN_FDM_Foundry/video_build/render_foundry_60s.exe
```

### Mandatory Video Content & Visual Mandates
1. **Real Verified Data Only (`Gate F1` & `Gate S1`)**: Maintain `facts_foundry_60s.md` and `storyboard_foundry_60s.md`; export every 3D mesh, graph, tile, Pareto point, and FEA field directly from verified artifacts via `export_video_data.mjs` (zero toy geometry, zero unverified numbers).
2. **Swarm Exploration Breadth + Live Adjacent 3D FEA**:
   - Cycle through **$\ge 16$ real explored topologies** spanning all optimization rounds, all explored voxel grid dimensions, and major presets.
   - Display each cycling option's **cast-plaster tubular OBJ mesh** directly **adjacent** to its **live 3D air-gapped FEA analysis** (exaggerated deflection, stress colormap, applied load arrows, live `Disp / SF_tens / SF_buck / FunicEff` readout), synced with a moving target ring on the 2D Pareto Front and active voxel-grid bar.
3. **Unified Display Across All Comparison Candidates**:
   - Every candidate in side-by-side or lineup comparisons MUST use the **exact same architectural CAD shaded tubular OBJ display** (`drawOBJShadedCAD` + wireframes + anchor pins) — never mix shaded OBJ meshes with bare stick-line graphs.
4. **Constituent Tile Cycle + WFC Run**:
   - Cycle sequentially through **each** constituent WFC tile (`Null`, `Cross`, `Vertical Tube`, `Arch Vault`, `Slender Diagrid`, `Catenary Quadripod`, etc.), highlighting its active row in the **WFC Adjacency Table** while rendering its real 3D voxel geometry and 6-face sockets on the right, followed by the live step-by-step **WFC voxel collapse** and welded centerline network.
5. **FDM ↔ FEA Optimization Loop**:
   - Animate continuous **WFC → FDM relaxation** synced with per-edge force density `q_e` tuning, followed by **Air-Gapped Plaster FEA** stress/deflection verification and the **Funicular Efficiency & Mass convergence curve**.
6. **Composition & Post-Encode Quality Gates (`Gate Q1-A` & `Gate Q1-B`)**:
   - Unified deep obsidian `#070A10` canvas, pure-black `#050608` 18-frame Calibri Bold Italic chapter cards, zero rectangle-in-rectangle chrome, `x = 40 px` left alignment, protected bottom seekbar zone (`y > 900` empty), zero truncated label buffers.
   - Visually inspect BOTH `contact_sheet_foundry_60s.png` (`4×4`) and `mp4_decoded_foundry_60s_verify.png` (`IMFSourceReader` post-encode decode) via `read_file` before delivery.

---

## 5. Reference Verified Benchmarks

| Brief | Verified Design | Mass (Centerline / OBJ) | Load / Mass | Funicular Eff. | Max Disp (`LC2`) | `SF_t` / `SF_c` / `SF_b` | Mesh |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`pilot_brief.json`** (`1×1×2m`, `+50 kg`) | `runs/champion/champion.*` (`pilot_champion`, `1×1×3`, hollow `12.5/6.5mm`) | **9.42 kg** / 11.21 kg | **5.31×** | **0.955** (`100%` comp.) | **0.124 mm** (`L/7436`) | `∞` / `35.89` / `19.09` *(Lat. `SF=10.47`)* | Watertight (`273Q/222T`) |
| **`arch_canopy_example.json`** (`2×1×1.2m`, `+30 kg`) | `runs/sweep/canopy_verified/canopy_best.*` (`arch_braced`, `4×2×2`, hollow `18/11mm`) | **5.06 kg** / 6.92 kg | **5.93×** | `100%` comp. | **0.431 mm** (`L/2786`) | `22.94` / `17.38` / `80.84` | Watertight (`0` bnd / `0` non-man) |

---

## 6. Invoking the Foundry on a New Brief

1. Copy `TOPOGEN_FDM_Foundry/briefs/BRIEF_TEMPLATE.md` (and `BRIEF_TEMPLATE.json`) to `TOPOGEN_FDM_Foundry/briefs/<new_brief>.{md,json}`.
2. Fill in Envelope, Voxel Resolution, Geometry/PQ, Funicular Mode, Supports, Material, Load Cases, Fabrication/Unrolling, Optimization Objectives, and Deliverables.
3. Run Phases 1–7 above (never breaking the Generator/Verifier air-gap).

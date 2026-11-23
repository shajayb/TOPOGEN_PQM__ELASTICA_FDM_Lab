# WFC-FDM Foundry

An air-gapped, brief-driven computational design and structural verification foundry for **Wave Function Collapse (WFC)** + **Force Density Method (FDM)** funicular tubular networks.

Given any structural and fabrication brief (envelope, funicular mode, supports, material properties, load cases, and acceptance criteria), the Foundry synthesizes watertight quad-dominant tubular networks and validates them with an independent 3D Euler-Bernoulli space-frame FEA & fabrication verifier.

---

## Architecture & Strict Air-Gap Boundary

The Foundry separates **Generation** from **Verification** across a strict air-gap so structural checks remain completely independent of form-finding heuristics:

```text
  ┌─────────────────────────────────────────┐
  │            GENERATOR DOMAIN             │
  │  index_WFC.html  <──  run_generator.mjs │
  │  (WFC -> Welded Graph -> FDM -> Quad    │
  │   Tubular Solidifier)                   │
  └────────────────────┬────────────────────┘
                       │
         NEUTRAL ON-DISK ARTIFACTS ONLY
         (schemas/interchange_contract.md)
           • briefs/<brief>.json
           • <candidate>.topology.json (wfc-fdm-topology/v1)
           • <candidate>.mesh.obj      (Watertight Quad OBJ)
           • <candidate>.verdict.json  (Pass/Fail + Diagnostics)
                       │
  ┌────────────────────▼────────────────────┐
  │            VERIFIER DOMAIN              │
  │  verifier/                              │
  │   ├── fea_solver.mjs        (3D FEA)    │
  │   ├── fabrication_check.mjs (Manifold)  │
  │   ├── verify.mjs            (CLI)       │
  │   ├── test_verifier.mjs     (Benchmarks)│
  │   └── verifier.html         (3D Viewer) │
  └─────────────────────────────────────────┘
```

**Air-Gap Rules:**
- Generator code (`index_WFC.html`, `run_generator.mjs`) and generator agents **never** read, import, or edit anything inside `verifier/`.
- Verifier code (`verifier/*`) **never** reads, imports, or edits `index_WFC.html` or `run_generator.mjs`.
- All data exchange uses neutral JSON and OBJ files documented in `schemas/interchange_contract.md`.

---

## Directory Layout

```text
TOPOGEN_FDM_Foundry/
├── README.md                          # Overview & quick-start commands
├── STUDENT_GUIDE.md                   # Student Quick-Map: "Where do I edit Tab X or Display Y?"
├── index_WFC.html                     # Lightweight 6-Tab Workbench HTML shell (~230 lines, zero build step)
├── foundry_launcher.html              # Lightweight Campaign Launcher & Live Tuner shell (~385 lines)
├── foundry_server.mjs                 # REST + SSE daemon, /api/quick-eval (~70ms), /api/nudge, TTL cache
├── foundry_runner.mjs                 # Warm worker_threads campaign engine (Lightning ~1.4s / Interactive ~4.5s)
├── run_generator.mjs                  # Headless Node CLI (native ESM + --batch / --stdin-jsonl warm modes)
├── core/                              # Pure-JS Generator Core (9 ES modules, zero DOM/Three/verifier deps)
│   ├── index.mjs                      # Unified WFC_FDM_CORE & generateCandidate exports
│   ├── math_tiles.mjs                 # 3D tile templates, socket codes & structural presets
│   ├── wfc_graph.mjs                  # WFC/Growth solver & centerline vertex welding
│   ├── fdm_solver.mjs                 # Force Density Method & compression-only tuning
│   ├── pq_solidifier.mjs              # Bisector-stitched all-quad PQ tubular solidifier (+ face loops & subdiv)
│   ├── unroll_patterns.mjs            # 2D per-bar unrolling & non-overlapping laser-sheet SVG layout
│   └── frame_fea_preview.mjs          # Generator-side pure-JS 3D space-frame preview
├── ui/                                # Student-editable Workbench UI modules (~220–1,280 lines each)
│   ├── styles/workbench.css           # Theme custom properties (:root colors, fonts, panel widths)
│   ├── state/workbench_state.js       # Shared appState & event bus
│   ├── display/                       # viewport_scene.js, display_hud.js, telemetry_hud.js
│   └── tabs/                          # tab1_tiles.js .. tab6_io.js (isolated HTML + logic per tab)
├── launcher_ui/                       # Student-editable Launcher modules (Quick-Verify, Speed Profiles, Pareto)
├── workers/                           # Warm air-gapped worker_threads (generator_worker.mjs, verifier_worker.mjs)
├── briefs/                            # pilot_brief.json, pilot_v2_pq_unrolled.json, arch_canopy_example.json
├── schemas/                           # brief.schema.json & interchange_contract.md
├── verifier/                          # Strictly air-gapped 3D FEA & fabrication verifier (14/14 benchmarks)
└── runs/                              # Generated candidates, verdicts, and Pareto logs
```

---

## Quick Start

### 1. Run Analytical Mechanics Benchmarks (Mandatory First Step)
Verify the independent FEA solver and manifold checker against closed-form mechanics (cantilever, axial column, simply supported beam, 3D tripod equilibrium, Euler buckling, watertight cube):

```bash
node TOPOGEN_FDM_Foundry/verifier/test_verifier.mjs
```

### 2. Generate a Candidate (Headless CLI)
```bash
node TOPOGEN_FDM_Foundry/run_generator.mjs \
  --brief TOPOGEN_FDM_Foundry/briefs/pilot_brief.json \
  --out-dir TOPOGEN_FDM_Foundry/runs/smoke \
  --name baseline \
  [--config <config.json>] [--seed 42] [--preset pilot_champion] \
  [--mode compression] [--grid 1,1,3] [--radius 0.0125] [--inner-radius 0.0065] \
  [--sides 8] [--q-profile column_boosted] [--q-base 1.0] \
  [--column-boost 4.0] [--anchor-boost 1.5] [--optimize-fdm]
```
Available structural presets: `pilot_champion`, `catenary_quadripod`, `funicular_vault`, `slender_diagrid`, `hyperboloid_tower`, `arch_braced`, `diagrid_tower`, `space_frame`, `funnel_vault`, `minimal_frame`, `default_ortho`.

This writes:
- `TOPOGEN_FDM_Foundry/runs/smoke/baseline.topology.json`
- `TOPOGEN_FDM_Foundry/runs/smoke/baseline.mesh.obj`

### 3. Verify the Candidate (Air-Gapped CLI)
```bash
node TOPOGEN_FDM_Foundry/verifier/verify.mjs \
  --topology TOPOGEN_FDM_Foundry/runs/smoke/baseline.topology.json \
  --mesh TOPOGEN_FDM_Foundry/runs/smoke/baseline.mesh.obj \
  --brief TOPOGEN_FDM_Foundry/briefs/pilot_brief.json \
  --out TOPOGEN_FDM_Foundry/runs/smoke/baseline.verdict.json \
  [--json]
```
Exit codes: `0` = PASS, `2` = FAIL, `1` = runtime/CLI error. Reports `centerlineMassKg` & `meshMassKg`, `funicularEfficiency`, `compressionDominance`, `loadToMassRatio`, `minIncidentAngleDeg`, and the `LC_lateral_5pct` notional lateral stability advisory.

### 4. Interactive Browser Apps & Long-Horizon Campaign Launcher
- **Foundry Launcher & Live Swarm Monitor** (`foundry_launcher.html` + `foundry_server.mjs`):
  ```bash
  node TOPOGEN_FDM_Foundry/foundry_server.mjs
  # Open http://127.0.0.1:8787/foundry_launcher.html
  ```
  Author or load briefs, choose **Mode A (Sealed Parametric)** or **Mode B (Adaptive Generator Evolution)**, select specific Foundry Gates (`G1`–`G7`), watch live candidate 3D meshes & Pareto fronts stream in real time via SSE, stop active swarm execution cleanly, and manage/reset `runs/` storage.
- **Generator UI**: Open `TOPOGEN_FDM_Foundry/index_WFC.html` in a browser and open the **`3. FDM & Tubes`** tab to explore WFC tile presets (including `pilot_champion`), run FDM in `compression` / `zero-weight` / `tensile` modes, adjust solid or hollow **`Inner R`** tubular sections, solidify watertight quad tubular meshes, and export `.topology.json` + `.mesh.obj`.
- **Verifier UI**: Open `TOPOGEN_FDM_Foundry/verifier/verifier.html` in a browser (includes a built-in demo tower) to drag-and-drop any `.topology.json`, `brief.json`, and `.mesh.obj`, run 3D plaster FEA, and inspect magnified deflected shapes, tensile/compressive/axial/utilization heatmaps, reaction/load arrows, and funicularity KPIs.

---

## Verified Reference Benchmarks

| Brief | Verified Artifact | Plaster Mass | Load / Mass | Funicular Eff. | Governing `LC2` Disp | `SF_t` / `SF_c` / `SF_b` | Manifold |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Pilot Tower** (`pilot_brief.json`, `1×1×2m`, `+50 kg`) | `runs/champion/champion.*` (`pilot_champion`, hollow `ro=12.5mm/ri=6.5mm`) | **9.42 kg** centerline (`11.21 kg` mesh) | **5.31×** (mesh `4.46×`) | **0.955** (`100%` comp.) | **0.124 mm** (`L/7436`) | `∞` / `35.89` / `19.09` *(Lat. `H/3563`, `SF=10.47`)* | Watertight (`0` bnd / `0` non-man) |
| **Arch Canopy** (`arch_canopy_example.json`, `2×1×1.2m`, `+30 kg`) | `runs/sweep/canopy_verified/canopy_best.*` (`default_ortho`, hollow `ro=18mm/ri=11mm`) | **6.35 kg** | **4.73×** | Compression arch | **1.47 mm** (`L/816`) | `1.63` / `7.79` / `33.46` | Watertight (`0` bnd / `0` non-man) |

---

### 5. Mandatory Campaign Deliverables (HTML Explainer + 60s Video)
- **Interactive 3D Goldilocks HTML Report**:
  ```bash
  node TOPOGEN_FDM_Foundry/build_report.mjs
  ```
  Generates standalone `TOPOGEN_FDM_Foundry/foundry_report.html` (`H1 · Use / H2 · Guide / H3 · Telemetry`, live 3D viewer, swarm history, Pareto front, WFC tiles & 6-direction adjacency table, FDM `q_e`, FEA scorecards & `10/10` benchmarks).
- **60-Second Showcase Explainer Video (`1920×1080 @ 30 FPS`, H.264)**:
  ```bash
  node TOPOGEN_FDM_Foundry/video_build/export_video_data.mjs
  clang++ -std=c++20 -O2 -DNOMINMAX TOPOGEN_FDM_Foundry/video_build/render_foundry_60s.cpp -o TOPOGEN_FDM_Foundry/video_build/render_foundry_60s.exe -lgdiplus -lmfplat -lmfreadwrite -lmfuuid -lole32 -luser32 -lgdi32
  ./TOPOGEN_FDM_Foundry/video_build/render_foundry_60s.exe
  ```
  Generates `TOPOGEN_FDM_Foundry/foundry_showcase_60s.mp4` cycling `>= 16` explored options across all voxel grids with **live adjacent 3D FEA**, unified CAD shaded tubular display, full constituent tile cycle + WFC run, FDM↔FEA loop, contact sheet (`Q1-A`), and post-encode decoded verification (`Q1-B`).

---

## Adding a New Structural & Fabrication Brief

1. Copy [`TOPOGEN_FDM_Foundry/briefs/BRIEF_TEMPLATE.md`](./briefs/BRIEF_TEMPLATE.md) and [`BRIEF_TEMPLATE.json`](./briefs/BRIEF_TEMPLATE.json) (see [`pilot_v2_pq_unrolled.json`](./briefs/pilot_v2_pq_unrolled.json) for a fully populated v2 brief with `>= 2×2×2` voxel resolution, compression-only network, `{longitudinal subdiv + PQ}` tube topology, per-bar unrolled patterns, and minimization of unrolled area & element count).
2. Run Phases 1–7 of `.agents/skills/wfc-fdm-foundry/SKILL.md`.

---

## Workspace Agent Skills

Three Antigravity skills under `.agents/skills/` codify Foundry operations:
- `.agents/skills/wfc-fdm-generator/SKILL.md` — Generator operation, FDM modes, tubular solidification, and parameter tuning.
- `.agents/skills/plaster-fe-verifier/SKILL.md` — Independent FEA verification, analytical benchmarks, and brittle plaster diagnostics.
- `.agents/skills/wfc-fdm-foundry/SKILL.md` — End-to-end air-gapped Generate → Verify → Optimize orchestration and Pareto logging.

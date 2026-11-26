# WFC-FDM Foundry — Student Quick-Map (`STUDENT_GUIDE.md`)

Welcome to the **WFC-FDM-PQ-FEA Structural Foundry**!
Every algorithm and UI panel is organized into small, zero-build-step JavaScript ES modules (`200–1,200 lines` each) so you—or an AI coding assistant on a tight token budget—only ever need to open **one small file** to customize a tab, material, tile, or 3D viewport style.

---

## 1. Desktop MCP Setup, Launching TOPOGEN in External Chrome & Connecting via MCP Bridge

> **CRITICAL — External Desktop Google Chrome ONLY (Never Antigravity's Built-In Browser)**:
> Always launch TOPOGEN in the user's **external Desktop Google Chrome** and connect to it through the **Desktop MCP bridge** (`topogen_ui_launch` / `topogen_ui_tabs` + `topogen_ui_connect`). **NEVER** open TOPOGEN in Antigravity's built-in `browser` subagent / embedded webview pane (`browserKind: "webview"`), which Bridge v2 excludes from auto-routing and which stalls on file uploads.

### First-Time Desktop MCP Binding & External Chrome Launch (Full Foundry Repo `origin`)
Register `topogen_fdm_foundry` once in `~/.gemini/config/mcp_config.json` (Antigravity) or `~/.codex/config.toml` (Codex) — sessionless, discovering the active `:8787` daemon automatically via `%LOCALAPPDATA%\Topogen\Foundry\<ecosystem>\latest-session.json`:

```bash
# 1. Bind Desktop MCP once per machine (then refresh topogen_fdm_foundry in Antigravity MCP settings):
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mcp --bind --ecosystem antigravity

# 2. Launch 3D Workbench in EXTERNAL Desktop Google Chrome & pair to your conversation (auto-starts :8787):
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs launch --conv <Conversation ID>

# Or via Desktop MCP tools (preferred, unsandboxed — confirms browserKind: "chrome", never "webview"):
#   topogen_inspect({})                                                 -> verify daemon & surfaceDrift: null
#   topogen_ui_launch({ conversationId: "<Conversation ID>" })          -> open & pair external Desktop Chrome
#   topogen_ui_tabs({ conversationId: "<Conversation ID>" })            -> list open external Chrome tabs
#   topogen_ui_connect({ conversationId: "<Conversation ID>", clientId }) -> bind an already-open Chrome tab

# 3. Inspect connected external Chrome tabs & drive the paired Workbench tab from CLI:
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs tabs
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui inspect --conv <Conversation ID>
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui configure --conv <Conversation ID> --preset pilot_champion --grid 2x2x3
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui step --conv <Conversation ID> --step all
```

- **Standalone Lab-Only Server (`lab` repo / no Foundry Launcher)**: If you cloned the app-only `TOPOGEN_PQM__ELASTICA_FDM_Lab` repo (which excludes `foundry_server.mjs`, `foundry_launcher.html`, `foundry_runner.mjs`, `launcher_ui/`, and `workers/`), serve the 3D Workbench directly via:
  ```bash
  node TOPOGEN_FDM_Foundry/serve_lab.mjs 8000
  # -> http://127.0.0.1:8000/index_TOPOGEN_PQM_ELASTICA_FDM.html
  ```
- **Interactive 7-Tab 3D Workbench**: `http://127.0.0.1:8787/index_TOPOGEN_PQM_ELASTICA_FDM.html` *(click the top-right **Chrome · Paired** pill to inspect, pair, unpair, or copy Tab ID)*
- **Campaign Launcher & Live Tuner** *(full Foundry `origin` only)*: `http://127.0.0.1:8787/foundry_launcher.html` *(or `topogen launch --launcher`)*
- **Important Agent Rules** *(full playbook in [`../AGENTS.md`](../AGENTS.md) & [`../WISE_AI_ASSISTANT_MCP.md`](../WISE_AI_ASSISTANT_MCP.md))*:
  - **ALWAYS** launch TOPOGEN in Google Chrome bound to `<Conversation ID>` (`topogen_ui_launch` or `topogen.mjs launch --conv <id>`) and wait for `ok: true` + `clientId` before claiming success.
  - **NEVER** use Antigravity's built-in `browser` webview subagent to launch TOPOGEN for the user unless explicitly requested, and **NEVER** write ad-hoc `node -e "brokerCall(...)"` scripts — use `topogen_ui_*` MCP tools or `topogen.mjs ui <subcommand>`.
  - **Multi-Tab & Large Exports**: If `AMBIGUOUS_CHROME_TABS` is returned, resolve with `topogen_ui_tabs` + `topogen_ui_connect`. For `> 150 KB` exports (e.g., 256-rod Elastica SVGs), read the returned `stagedPath` rather than expecting inline text.
  - **Honest Mode A Boundaries**: Per-voxel `NULL`/tile pinning (`voxelPins`), `fea_animate` deflection playback, and state-preserving `topogen_ui_reload` are wired in Mode A (`BATCH-TOPOGEN-04`) under `agent/ui-action-contract.mjs` (`BATCH-TOPOGEN-05`). If any future UI action is not yet exposed on `mcp_ui_bridge.js`, report it honestly (note: `topogen_ui_reload` and `F5` both preserve tab pairing) and offer to enter Mode B to generalize & reseal.
- **Mode A vs Mode B Code Edits**:
  - Unlock Mode B before editing sealed `core/`, `ui/`, `launcher_ui/`, `agent/`, or `cli/` files: `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B`
  - Run all 5 deterministic verification suites (`npm run test:verifier && npm run test:guard && npm run test:core && npm run test:mcp && npm run test:cli`), then reseal and return to Mode A: `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs seal --mode B --reseal` followed by `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --A`

*(Any static server such as `npx serve TOPOGEN_FDM_Foundry` or `python -m http.server` inside `TOPOGEN_FDM_Foundry/` also works for standalone viewing of `index_TOPOGEN_PQM_ELASTICA_FDM.html`!)*

---

## 2. "Where Do I Edit...?" — Workbench UI (`TOPOGEN_FDM_Foundry/ui/`)

| What you want to customize | Open ONLY this file | Approx. Size |
| :--- | :--- | :--- |
| **Colors, Fonts, Panel Widths, Dark/Light Theme** | `ui/styles/workbench.css` (`:root` CSS variables) | ~380 lines |
| **3D Viewport, Studio Lighting, Camera, Arctic Clay, 2D Status Bar** | `ui/display/viewport_scene.js` | ~735 lines |
| **Viewport Display HUD, Outliner, Goldilocks `H1/H2/H3`, Compact Mode** | `ui/display/display_hud.js` | ~485 lines |
| **Right-Hand Analytical Telemetry HUD (`#telemetry-panel`)** | `ui/display/telemetry_hud.js` | ~360 lines |
| **Tab 1: Module / Tile Catalog, 3D Tile Showcase & Coarse `.obj`/`.3dm` Importer** | `ui/tabs/tab1_tiles.js` | ~890 lines |
| **Tab 2: Topology Generator (WFC / Adj Growth, Grid X×Y×Z, Adjacency Matrix)** | `ui/tabs/tab2_topo.js` | ~1,285 lines |
| **Tab 2 Helper: `.3dm` / `.json` / `.obj` Centerline Network Importer** | `ui/tabs/tab2_network_loader.js` | ~220 lines |
| **Tab 3: All-Quad PQ Tubular Mesh Solidifier, Subdiv, Coloring & 2D/3D Unroll** | `ui/tabs/tab4_pq_mesh.js` | ~810 lines |
| **Tab 4: Force Density Method (Presets, 3D Click Fixed Anchors, `q` Sliders)** | `ui/tabs/tab3_fdm.js` | ~790 lines |
| **Tab 5 (Elastica): 3D Elastica Tubular Rods, Source/Sink Valency & DER Strip Unrolling** | `ui/tabs/tab_elastica.js` | ~760 lines |
| **Tab 6: 3D Space-Frame FEA Contours, Materials, Deflection Animation & Scorecard** | `ui/tabs/tab5_fea.js` | ~585 lines |
| **Tab 7: Foundry `.JSON`, Quad `.OBJ`, Unroll `.SVG` & Multi-Layer Rhino `.3dm` Exports** | `ui/tabs/tab6_io.js` | ~660 lines |
| **Shared State (`appState`), Material Constants & Event Bus (`on`/`emit`)** | `ui/state/workbench_state.js` | ~320 lines |
| **App Startup & Browser Console API (`window.WFC_WORKBENCH`)** | `ui/main.js` & `index_TOPOGEN_PQM_ELASTICA_FDM.html` | ~230–295 lines |

> **Tip**: Each `ui/tabs/tab*.js` file contains **both** its own HTML template (`mountTab*()`) and its event listeners (`initTab*()`), so adding a slider or button to a single tab requires editing only that single file!

---

## 3. "Where Do I Edit...?" — Pure-JS Generator Core (`TOPOGEN_FDM_Foundry/core/`)

All files in `core/` are **100% pure JavaScript** (zero DOM or Three.js dependencies) and run identically in the Browser and in Node.js (`run_generator.mjs` & worker pools):

| Algorithmic Stage | Open ONLY this file | Key Exports |
| :--- | :--- | :--- |
| **3D Tiles, Socket Codes & Presets** | `core/math_tiles.mjs` (~670 lines) | `V3`, `createTileTemplates`, `TILE_PRESETS`, `applyTilePresetToTiles`, `buildAdjacencyRules` |
| **WFC Solver & Centerline Graph Welding** | `core/wfc_graph.mjs` (~945 lines) | `runWFCSolver`, `buildWeldedGraphFromVoxels`, `extractLargestComponent`, `cleanAndWeldGraph` |
| **Force Density Method (FDM) & Funicular Tuning** | `core/fdm_solver.mjs` (~670 lines) | `selectGroundAnchors`, `assignForceDensities`, `solveFDM`, `conditionCompressionOnlyNetwork` |
| **All-Quad PQ Tubular Solidifier & `.OBJ` Export** | `core/pq_solidifier.mjs` (~1,250 lines) + `pq_face_loops.mjs` + `pq_subdivision.mjs` | `solidifyGraph`, `optimizeFaceLoopsToPQ`, `applyLongitudinalOnlySubdivisionToPQStrips`, `verifyManifold`, `buildQuadDominantOBJ` |
| **Mesh-to-Skeleton Extraction & Coarse Tile Subdiv** | `core/mesh_skeletonizer.mjs` (~1,280 lines) | `extractSkeletalGraphFromMesh`, `subdivideMeshBoundaryPreserving`, `extractBoundaryPortLoops`, `createTwinTubeBifurcationCoarseMesh`, `buildCoarseMeshOBJText` |
| **3D Elastica Tubular Rods & DER Strip Unrolling** | `core/elastica_curves.mjs` (~1,195 lines) | `traceSkeletalPathsAStar`, `optimizeElasticaCurve`, `buildElasticaRodMesh`, `generateElasticaRibbons`, `buildElasticaRibbonsSVG`, `buildHybridGraphWithElastica` |
| **2D Per-Bar Unrolling & Laser-Sheet SVG Nesting** | `core/unroll_patterns.mjs` (~760 lines) | `unrollFaceLoop2D`, `buildUnrolledPatterns`, `verifyUnrolledPatterns`, `buildUnrolledPatternsSVG` |
| **Generator-Side 3D Space-Frame FEA Preview** | `core/frame_fea_preview.mjs` (~925 lines) | `estimateFrameMechanics`, `analyzeSpaceFrameFEA` |
| **End-to-End Candidate Pipeline & Unified Exports** | `core/index.mjs` (~655 lines) | `generateCandidate`, `buildFoundryTopologyJSON`, `WFC_FDM_CORE`, `loadWfcCore` |
| **Pure-JS Core & Geometry Regression Suite (`npm run test:core`)** | `core/test_core.mjs` | Deterministic tests for `mesh_skeletonizer`, `pq_subdivision`, `frame_fea_preview`, `elastica_curves` & `generateCandidate` (zero `verifier/` imports) |

---

## 4. Browser Console & Headless CLI Experimentation

1. **Live Browser Console (`index_TOPOGEN_PQM_ELASTICA_FDM.html`)**:
   Open DevTools (`F12`) and inspect `window.WFC_WORKBENCH`:
   ```js
   WFC_WORKBENCH.applyTilePreset('pilot_champion');
   WFC_WORKBENCH.runFDM();
   WFC_WORKBENCH.solidifyActiveGraph();
   WFC_WORKBENCH.switchTab('tab-fea');
   WFC_WORKBENCH.runFEA({ expandHud: true });
   ```

2. **Headless Node.js CLI (`run_generator.mjs`)**:
   ```bash
   # Single candidate
   node TOPOGEN_FDM_Foundry/run_generator.mjs --brief TOPOGEN_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json --out-dir TOPOGEN_FDM_Foundry/runs/test --name my_tower

   # Warm multi-candidate batch (zero cold-start overhead)
   node TOPOGEN_FDM_Foundry/run_generator.mjs --batch my_batch.json
   ```

3. **Syntax Check & Pure-JS Core Tests**:
   ```bash
   node --check TOPOGEN_FDM_Foundry/ui/tabs/tab4_pq_mesh.js
   node --check TOPOGEN_FDM_Foundry/launcher_ui/tab_brief_sandbox.js
   npm run test:core
   ```

---

## 5. "Where Do I Edit...?" — Campaign Launcher UI (`TOPOGEN_FDM_Foundry/launcher_ui/`)

| What you want to customize in the Launcher | Open ONLY this file | Approx. Size |
| :--- | :--- | :--- |
| **Launcher Shell & DOM Layout** | `foundry_launcher.html` | ~385 lines |
| **Launcher Theme, Speed Pills & Mode Cards CSS** | `launcher_ui/launcher.css` | ~250 lines |
| **Tab 1: Brief Composer & ~50ms Live Quick-Verify Tuner** | `launcher_ui/tab_brief_sandbox.js` | ~405 lines |
| **Tab 2: Speed Profiles (`Lightning`/`Interactive`/`Deep`), Mode A/B & Gates** | `launcher_ui/tab_mode_gates.js` | ~195 lines |
| **Tab 3: Live Search Monitor, Interactive Pareto Plot & `↑`/`↓` Scrubbing** | `launcher_ui/tab_live_monitor.js` | ~395 lines |
| **Tab 4: Deliverables, Storage Reset & Live Log** | `launcher_ui/tab_storage_logs.js` | ~130 lines |
| **Right-Hand 3D Candidate Verdict HUD & Unrolled `.svg` Preview** | `launcher_ui/verdict_hud.js` | ~140 lines |
| **3D Z-Up Viewport & 0ms LRU Candidate Mesh Cache** | `launcher_ui/viewport3d.js` | ~420 lines |
| **Shared Launcher State, `rAF` 60 FPS Scheduler & `loadWfcCore()`** | `launcher_ui/state.js` & `launcher_ui/main.js` | ~205–255 lines |

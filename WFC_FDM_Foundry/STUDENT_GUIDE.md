# WFC-FDM Foundry — Student Quick-Map (`STUDENT_GUIDE.md`)

Welcome to the **WFC-FDM-PQ-FEA Structural Foundry**!
Every algorithm and UI panel is organized into small, zero-build-step JavaScript ES modules (`200–1,200 lines` each) so you—or an AI coding assistant on a tight token budget—only ever need to open **one small file** to customize a tab, material, tile, or 3D viewport style.

---

## 1. Quick Run (Zero Build Step)

Start the local Foundry server from the repository root:

```bash
node WFC_FDM_Foundry/foundry_server.mjs
```

Then open in your browser:
- **Interactive 6-Tab Workbench**: `http://127.0.0.1:8787/index_WFC.html`
- **Campaign Launcher & Live Tuner**: `http://127.0.0.1:8787/foundry_launcher.html`

*(Any static server such as `npx serve WFC_FDM_Foundry` or `python -m http.server` inside `WFC_FDM_Foundry/` also works for `index_WFC.html`!)*

---

## 2. "Where Do I Edit...?" — Workbench UI (`WFC_FDM_Foundry/ui/`)

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
| **Tab 5: 3D Space-Frame FEA Contours, Materials, Deflection Animation & Scorecard** | `ui/tabs/tab5_fea.js` | ~585 lines |
| **Tab 6: Foundry `.JSON`, Quad `.OBJ`, Unroll `.SVG` & Multi-Layer Rhino `.3dm` Exports** | `ui/tabs/tab6_io.js` | ~660 lines |
| **Shared State (`appState`), Material Constants & Event Bus (`on`/`emit`)** | `ui/state/workbench_state.js` | ~320 lines |
| **App Startup & Browser Console API (`window.WFC_WORKBENCH`)** | `ui/main.js` & `index_WFC.html` | ~230–295 lines |

> **Tip**: Each `ui/tabs/tab*.js` file contains **both** its own HTML template (`mountTab*()`) and its event listeners (`initTab*()`), so adding a slider or button to a single tab requires editing only that single file!

---

## 3. "Where Do I Edit...?" — Pure-JS Generator Core (`WFC_FDM_Foundry/core/`)

All files in `core/` are **100% pure JavaScript** (zero DOM or Three.js dependencies) and run identically in the Browser and in Node.js (`run_generator.mjs` & worker pools):

| Algorithmic Stage | Open ONLY this file | Key Exports |
| :--- | :--- | :--- |
| **3D Tiles, Socket Codes & Presets** | `core/math_tiles.mjs` (~670 lines) | `V3`, `createTileTemplates`, `TILE_PRESETS`, `applyTilePresetToTiles`, `buildAdjacencyRules` |
| **WFC Solver & Centerline Graph Welding** | `core/wfc_graph.mjs` (~945 lines) | `runWFCSolver`, `buildWeldedGraphFromVoxels`, `extractLargestComponent`, `cleanAndWeldGraph` |
| **Force Density Method (FDM) & Funicular Tuning** | `core/fdm_solver.mjs` (~670 lines) | `selectGroundAnchors`, `assignForceDensities`, `solveFDM`, `conditionCompressionOnlyNetwork` |
| **All-Quad PQ Tubular Solidifier & `.OBJ` Export** | `core/pq_solidifier.mjs` (~1,250 lines) + `pq_face_loops.mjs` + `pq_subdivision.mjs` | `solidifyGraph`, `optimizeFaceLoopsToPQ`, `applyLongitudinalOnlySubdivisionToPQStrips`, `verifyManifold`, `buildQuadDominantOBJ` |
| **2D Per-Bar Unrolling & Laser-Sheet SVG Nesting** | `core/unroll_patterns.mjs` (~760 lines) | `unrollFaceLoop2D`, `buildUnrolledPatterns`, `verifyUnrolledPatterns`, `buildUnrolledPatternsSVG` |
| **Generator-Side 3D Space-Frame FEA Preview** | `core/frame_fea_preview.mjs` (~925 lines) | `estimateFrameMechanics`, `analyzeSpaceFrameFEA` |
| **End-to-End Candidate Pipeline & Unified Exports** | `core/index.mjs` (~655 lines) | `generateCandidate`, `buildFoundryTopologyJSON`, `WFC_FDM_CORE`, `loadWfcCore` |

---

## 4. Browser Console & Headless CLI Experimentation

1. **Live Browser Console (`index_WFC.html`)**:
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
   node WFC_FDM_Foundry/run_generator.mjs --brief WFC_FDM_Foundry/briefs/pilot_v2_pq_unrolled.json --out-dir WFC_FDM_Foundry/runs/test --name my_tower

   # Warm multi-candidate batch (zero cold-start overhead)
   node WFC_FDM_Foundry/run_generator.mjs --batch my_batch.json
   ```

3. **Syntax Check Any Edit Instantly**:
   ```bash
   node --check WFC_FDM_Foundry/ui/tabs/tab4_pq_mesh.js
   node --check WFC_FDM_Foundry/launcher_ui/tab_brief_sandbox.js
   ```

---

## 5. "Where Do I Edit...?" — Campaign Launcher UI (`WFC_FDM_Foundry/launcher_ui/`)

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

# Capture Specification — Topogen Procedural Chains Demo

> **Mode A Governance**: Do **NOT** edit any sealed files (`TOPOGEN_FDM_Foundry/core/**`, `ui/**`, `serve_lab.mjs`, etc.). All capture scripts, temporary frames, and outputs live strictly under `video_build/procedural_chains_video/`.

---

## 1. Verified Environment & Zero-Dependency Browser Automation Stack

Verified on this Windows host:
- **Node.js**: `v26.12.1` (includes native `WebSocket` and `fetch` — **zero npm installs required**)
- **Chrome**: `C:\Program Files\Google\Chrome\Application\chrome.exe` (verified with `--headless=new --remote-debugging-port=<port>`)
- **FFmpeg**: Installed on `PATH` (`ffmpeg version N-127021`, `libx264` available)
- **Local Server**: `TOPOGEN_FDM_Foundry/serve_lab.mjs` (serves the app AND all `/api/chains`, `/api/chains/save`, `/api/repo-file` routes!)
  - `@capture-corpus` uses **port `8891`** + Chrome CDP port **`9231`**
  - `@capture-walkthrough` uses **port `8892`** + Chrome CDP port **`9232`**
  - Launching separate `serve_lab.mjs` ports + separate `--user-data-dir` temp folders guarantees 100% parallel isolation with zero port or profile collisions.

### Chrome Launch Flags (1920×1080 WebGL + Real Mouse/Keyboard CDP)
```js
const chromeArgs = [
  '--headless=new',
  '--disable-gpu-sandbox',
  '--use-gl=angle',
  '--use-angle=swiftshader-webgl',
  '--enable-webgl',
  '--ignore-gpu-blocklist',
  '--window-size=1920,1080',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  `--remote-debugging-port=${CDP_PORT}`,
  `--user-data-dir=${userDataDir}`,
  `http://127.0.0.1:${LAB_PORT}/index_TOPOGEN_PQM_ELASTICA_FDM.html`
];
```
After connecting via native `WebSocket` to `GET http://127.0.0.1:${CDP_PORT}/json/list`, call:
1. `Emulation.setDeviceMetricsOverride({ width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })`
2. Wait for `window.__app && window.__app.ready` (await `window.__app.ready` so Rhino3dm WASM + Three.js scene are initialized).
3. Use real CDP input events for **"Computer Use"** interactions:
   - `Input.dispatchMouseEvent` (`mouseMoved`, `mousePressed`, `mouseReleased`, `mouseWheel`) with smooth interpolated cursor motion (`12–18` frames per move) AND an optional clean subtle cursor indicator dot (injected purely at runtime in the page, never editing repo files) so viewers can follow every click and orbit drag!
   - `Input.insertText` / `Input.dispatchKeyEvent` for typing `"Hero Arch"` into `#inp-cam-bookmark-name`.
4. Capture frames at **`30 fps`** via `Page.captureScreenshot({ format: 'png' })` (or JPEG quality `95` for speed) into `video_build/procedural_chains_video/frames/<clip_name>/frame_%04d.png`, then encode each clip cleanly:
   ```bash
   ffmpeg -y -framerate 30 -i frame_%04d.png -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -r 30 -movflags +faststart <clip.mp4>
   ```

---

## 2. CRITICAL UI HYGIENE — Preventing Panel & HUD Collisions

At `1920×1080`, Topogen's floating panels have these default CSS positions (`workbench.css`):

| Panel Element | Default Position | Default State | Minimize Button | Overlap Risk |
| :--- | :--- | :--- | :--- | :--- |
| `#left-sidebar` | `top: 12px; left: 12px; width: 386px` | **Expanded** | `#btn-sidebar-minimize` | Covers left 20% of 3D viewport when expanded. **Collapse it immediately after clicking Load / Play All** so 3D geometry breathes! |
| `#telemetry-panel` | `top: 12px; left: 410px; width: 368px` | Minimized (`40px` tall) | `#btn-telemetry-minimize` | Keep **minimized** in all clips (and optionally dock right or keep top-left minimized). |
| `#display-hud-panel` | `bottom: 28px; left: 410px; width: 310px` | Minimized (`40px` tall) | `#btn-display-hud-minimize` | **HIGH RISK COLLISION!** Default `left: 410..720px, bottom: 28px` **OVERLAPS `#viewport-chain-timeline` (`left: 620..1300px, bottom: 28px`) by 100px** and has higher `z-index (29 > 24)`! |
| `#outliner` | `top: 12px; right: 12px; width: 260px` | Minimized (`40px` tall) | `#outliner-collapse` | Keep **minimized** in all clips. |
| `#viewport-chain-timeline` | `bottom: 28px; left: 50% (x=620..1300)` | Hidden until chain loaded | `[data-tl-dismiss]` | **MUST NEVER BE OBSCURED!** Shows chain name, stage progress rail, clickable dots, and hover tooltips. |

### Mandatory Startup UI Hygiene Recipe (Run at Start of Every Capture Session)
1. **Reposition `#display-hud-panel` to Bottom-Right** (either by dragging `#display-hud-drag-header` or setting `style.left = 'auto'; style.right = '12px'; style.bottom = '28px'`) so it occupies `x = 1598..1908` — **zero overlap** with `#viewport-chain-timeline` (`x = 620..1300`) both when minimized AND when expanded for Camera Bookmarks!
2. **Reposition `#telemetry-panel` cleanly** (keep minimized, e.g. `style.left = 'auto'; style.right = '284px'; style.top = '12px'`) so the top-center/top-left viewport zone (`x = 410..1200, y = 12..120`) is 100% open for the 3D scene and editor signpost pills!
3. **Keep `#outliner` minimized** (`top: 12px; right: 12px`).
4. **Minimize `#left-sidebar`** by clicking `#btn-sidebar-minimize` during all playback, timeline-stepping, and 3D orbit showcases (`Clips 1A, 1B, 1C, 3A, 3B`). Only expand `#left-sidebar` when actively clicking tab controls (`Clips 2A, 2B`, or briefly to pick a corpus chain / click Play All).
5. **Disable damping inertia during scripted orbits** or use smooth mouse drag steps on `#canvas-container` (`x = 960, y = 520`, dragging `±160px` horizontally over `90–120` frames) for silky, calm `~6°/sec` 3D orbits!
6. **Hide `#overlay-canvas`** only if its bottom-left debug text clashes; otherwise keep ground grid subtle or toggle off via Outliner/state if cleaner (keep the 3D bounding box / mesh crisp on pure `#FFFFFF`).

---

## 3. Exact DOM Selectors Reference

### Tab Navigation (Inside `#left-sidebar`)
- `1. Tiles`: `.ui-tab[data-tab="tab-tiles"]`
- `2. Topo`: `.ui-tab[data-tab="tab-topo"]`
- `3. PQ Mesh`: `.ui-tab[data-tab="tab-pq"]`
- `4. Elastica`: `.ui-tab[data-tab="tab-elastica"]`
- `5. FDM`: `.ui-tab[data-tab="tab-fdm"]`
- `6. FEA`: `.ui-tab[data-tab="tab-fea"]`
- `7. I/O`: `.ui-tab[data-tab="tab-io"]`

### Panel Collapse / Minimize Controls
- Left Sidebar minimize/expand: `#btn-sidebar-minimize` (panel has class `.minimized` when collapsed)
- Telemetry HUD minimize/expand: `#btn-telemetry-minimize`
- Display HUD minimize/expand: `#btn-display-hud-minimize`
- Outliner minimize/expand: `#outliner-collapse`

### Tab 7 (`7. I/O`) — Procedural Chain Controls
- Step count badge: `#chain-step-count-badge`
- Active loaded chain badge: `#chain-loaded-file-badge`
- Clear chain: `#btn-chain-clear`
- Export `.chain.json`: `#btn-chain-export`
- Save to Repo: `#btn-chain-save-repo`
- Corpus / Repo dropdown: `#sel-chain-corpus`
  - Exact option values served by `serve_lab.mjs`:
    - `TOPOGEN_FDM_Foundry/corpus/case1_arch_vault_pq_ring_subdiv.chain.json`
    - `TOPOGEN_FDM_Foundry/corpus/case2_arch_vault_pq_long_subdiv.chain.json`
    - `TOPOGEN_FDM_Foundry/corpus/case3_batwing_1x1x1_pq.chain.json`
- Load selected corpus chain: `#btn-chain-load-corpus` *(Note: clicking this loads AND immediately replays all steps!)*
- Refresh corpus list: `#btn-chain-refresh-corpus`
- Camera view mode dropdown: `#sel-chain-capture-views` (`stage` = Stage Bookmark, `active` = Active View, `defaults` = All Default Views)
- Play All button: `#btn-chain-play-all`
- Step Next button: `#btn-chain-step-next`
- Progress bar: `#chain-progress-bar`
- Status text: `#chain-status-text`

### Direct-Over-Viewport Stage Timeline (`#viewport-chain-timeline`)
- Root container: `#viewport-chain-timeline` (visible when chain loaded; `.hidden` when cleared)
- Chain title: `#viewport-chain-timeline [data-tl-name]`
- Stage status text: `#viewport-chain-timeline [data-tl-status]`
- Progress rail fill: `#viewport-chain-timeline [data-tl-fill]`
- Individual clickable stage nodes: `#viewport-chain-timeline .chain-tl-node[data-tl-index="0"]` .. `[data-tl-index="N"]`
  - Hovering a `.chain-tl-node` reveals `.chain-tl-tooltip` (`Stage X/N · <Label>`).
  - Clicking a `.chain-tl-node` calls `jumpToStage(index)` deterministically!

### Tab 1 (`1. Tiles`), Tab 2 (`2. Topo`), Tab 3 (`3. PQ Mesh`) — Chain Authoring
- Enable Arch Vault tile (id 8): `#tile-catalog .tile-toggle-btn[data-tile-id="8"]` *(Note: clicking a tile card enables it if disabled and inspects it!)*
- Switch Tile View to Voxel Grid: `#btn-tile-view-grid`
- Grid Preset `3×3×4`: `#tab-topo .res-preset-btn[data-rx="3"][data-ry="3"][data-rz="4"]`
- Collapse Full Grid Now: `#btn-sim-collapse-all`
- Solidify All-Quad PQ Mesh: `#btn-solidify-tubes`
- PQ Ring Subdiv + PQ Planarize: `#btn-ring-subdiv-pq`
- PQ Longitudinal Subdiv + PQ Planarize: `#btn-long-subdiv-pq`

### Camera Bookmarks (Inside `#display-hud-panel`)
- Expand Display HUD: `#btn-display-hud-minimize` (when `#display-hud-panel.minimized`)
- Open Save View row: `#btn-cam-save-toggle`
- Bookmark name input: `#inp-cam-bookmark-name`
- Confirm save bookmark: `#btn-cam-save-confirm`
- Built-in perspective views: `#cam-persp-list [data-bookmark-id="persp-iso"]`, `[data-bookmark-id="persp-front-left"]`, `[data-bookmark-id="persp-low"]`
- Saved custom bookmarks: `#cam-custom-list .cam-bm-pill-apply`

---

## 4. Shot-by-Shot Capture Recipes

### `@capture-corpus` (Port `8891`, CDP `9231`)
1. **`clip_1a_case1_ring.mp4` (`240 frames`, `8.0 s`)**:
   - Start with `7. I/O` open, `#display-hud-panel` parked bottom-right, `#telemetry-panel` & `#outliner` minimized.
   - Real mouse click `#sel-chain-corpus` -> select `case1_arch_vault_pq_ring_subdiv.chain.json` -> click `#btn-chain-load-corpus` (`0.0–1.5s`).
   - Immediately click `#btn-sidebar-minimize` (`1.5–2.0s`) so 3D viewport + bottom `#viewport-chain-timeline` are unobstructed.
   - Step visually across key stages on `#viewport-chain-timeline` so viewer sees progression cleanly: click stage `3` (Collapse WFC Topology, hold `1.2s`) → click stage `5` (Solidify PQ Mesh, hold `1.4s`) → click stage `6` (PQ Ring Subdiv + Planarize, hold `1.4s`) → calm mouse drag orbit around the finished Arch Vault (`2.0s`).
2. **`clip_1b_case2_long.mp4` (`225 frames`, `7.5 s`)**:
   - Expand `#left-sidebar` (`#btn-sidebar-minimize`), select `case2_arch_vault_pq_long_subdiv.chain.json`, click `#btn-chain-load-corpus`, minimize `#left-sidebar` (`0.0–2.0s`).
   - Click timeline stage `5` (Solidify PQ Mesh, hold `1.5s`) → click stage `6` (PQ Longitudinal Subdiv + Planarize, hold `1.8s`) → calm mouse drag orbit (`2.2s`).
3. **`clip_1c_case3_batwing.mp4` (`210 frames`, `7.0 s`)**:
   - Expand `#left-sidebar`, select `case3_batwing_1x1x1_pq.chain.json`, click `#btn-chain-load-corpus`, minimize `#left-sidebar` (`0.0–2.0s`).
   - Click timeline stage `0` (Import Batwing OBJ Tile, hold `1.4s`) → stage `2` (Collapse `1×1×1`, hold `1.2s`) → stage `4` (Solidify Batwing PQ Mesh, hold `1.4s`) → calm mouse drag orbit (`1.0s`).

### `@capture-walkthrough` (Port `8892`, CDP `9232`)
1. **`clip_2a_create_steps.mp4` (`270 frames`, `9.0 s`)**:
   - Start on `7. I/O`, click `#btn-chain-clear` so live chain starts at `0 steps`. `#left-sidebar` expanded; `#display-hud-panel` parked bottom-right (minimized); `#telemetry-panel` & `#outliner` minimized.
   - Real mouse clicks:
     - `0.0–2.5s`: Click `1. Tiles` → click Arch Vault card `.tile-toggle-btn[data-tile-id="8"]` (viewport updates to show Arch Vault tile!).
     - `2.5–5.5s`: Click `2. Topo` → click `3×3×4` preset → click `#btn-sim-collapse-all` (viewport collapses 3D voxel topology!).
     - `5.5–9.0s`: Click `3. PQ Mesh` → click `#btn-solidify-tubes` (hold `1.5s`) → click `#btn-ring-subdiv-pq` (hold `1.5s`).
2. **`clip_2b_bookmark_save.mp4` (`255 frames`, `8.5 s`)**:
   - Continuing from the live state of `2a`:
     - `0.0–2.2s`: Smooth real mouse drag on `#canvas-container` (`x = 1100, y = 540`) to orbit to a dramatic low hero angle.
     - `2.2–5.2s`: Click `#btn-display-hud-minimize` (bottom-right) to expand Display HUD → click `#btn-cam-save-toggle` → type `"Hero Arch"` into `#inp-cam-bookmark-name` → click `#btn-cam-save-confirm` → click `#btn-display-hud-minimize` to collapse Display HUD back down!
     - `5.2–8.5s`: Click `7. I/O` tab (viewer sees `#chain-step-count-badge` showing the recorded steps!) → click `#btn-chain-save-repo` → hold `2.0s` showing `"Saved → ..."` in `#chain-status-text`! *(Clean up any temporary saved chain in `TOPOGEN_FDM_Foundry/chains/` after capture if desired, or keep `demo_hero_arch.chain.json` strictly for Clip 3A/3B then remove it at the end so git stays clean!)*
3. **`clip_3a_step_through.mp4` (`270 frames`, `9.0 s`)**:
   - Load Case 1 (or the just-saved chain) in `7. I/O`, click `#btn-sidebar-minimize` so `#left-sidebar` is collapsed and the full viewport + `#viewport-chain-timeline` are 100% unobstructed.
   - Move real cursor down to `#viewport-chain-timeline`:
     - Hover & click `[data-tl-index="3"]` (WFC Collapse, hold `2.0s` with tooltip visible)
     - Hover & click `[data-tl-index="5"]` (Solidify PQ Mesh, hold `2.2s`)
     - Hover & click `[data-tl-index="6"]` (PQ Ring Subdiv + Planarize, hold `2.4s`)
     - Hover & click `[data-tl-index="7"]` (Camera Bookmark view, hold `2.4s`)
4. **`clip_3b_play_smooth.mp4` (`195 frames`, `6.5 s`)**:
   - Expand `#left-sidebar` on `7. I/O`, click `#btn-chain-play-all`, immediately minimize `#left-sidebar` (`0.0–1.5s`).
   - Note: `playChain()` executes fast in JS; to make smooth playback visually readable on `#viewport-chain-timeline`, either step smoothly via `#btn-chain-step-next` / timeline clicks spaced `0.45s` apart after triggering replay, OR capture the live `Play All` transition followed by a lush, calm `3.5s` 3D hero orbit around the completed structure!

# Standard Operating Procedure (SOP): Algorithmic & Technical Showcase Video Creation

> **Golden Rule of Order**:
> **Narrative Thread -> Minimal Text Edit -> Pacing & Signpost Design -> Clean Raw Footage Capture -> Supersampled Composite -> Chapter-Aligned Storyboard QA.**
> Never capture raw footage or render video frames before locking in the narrative thread and editing every slide/shot down to its minimally necessary text.

---

## Phase 1: Narrative Thread & Minimal Text Script (FIRST STEP)

Before writing any capture or rendering code, author a standalone script (`narrative_and_text_script.md`) that defines a **single continuous narrative thread** across all chapters and edits every on-screen text string down to the bare minimum required for instant comprehension.

### 1.1 Structure the 4-Chapter Narrative Arc
Every technical showcase video should follow a logical progression from **shared primitives -> mechanism comparison -> parameter exploration -> final output**:

| Chapter | Role in Narrative Arc | Example (`index_WFC.html`) |
| :--- | :--- | :--- |
| **Chapter 01** | **Building Blocks (Shared Inputs)** — Introduce the core primitives, domain grid, and local rules that all algorithms share. | `01 / BUILDING BLOCKS`<br>`Tiles · Voxel Grid · Adjacency Rules` |
| **Chapter 02** | **Mechanism Comparison (How It Works)** — Contrast how two algorithms or stages process the exact same inputs differently. | `02 / TWO SOLVERS`<br>`Adjacency Growth vs. Wave Function Collapse` |
| **Chapter 03** | **Design / Parameter Catalogue (What It Produces)** — Show a systematic matrix of outcomes when varying key parameters (grid shape, active tiles, rule openness). | `03 / DESIGN CATALOGUE`<br>`Varying Grid Shape, Tiles & Rules` |
| **Chapter 04** | **Topology & Output Finale (Hero Result & I/O)** — Showcase the converged geometry, material/shading modes (`Arctic`), and CAD export (`.3dm`). | `04 / QUAD-MESH OUTPUT`<br>`Clean Topology · Arctic Shading · Rhino .3dm` |

### 1.2 Aggressive Text Reduction Rules ("Minimally Necessary & Communicative")
Viewers watching dynamic 3D simulations cannot read dense paragraphs or code snippets inside a 2–6 second shot. Apply these strict rules across **every** slide and clip:
1. **Zero Raw Code Snippets on Video Slides**:
   - Do **not** put raw JavaScript/C++ lines (`const cellIdx = ...`, `isAdjacentAllowed(...)`, `fl.addQuadFace(...)`) on comparison cards or viewport insets. Translate code mechanics into plain, 3–5 word human concepts (e.g., `Random frontier neighbor` vs. `Lowest-entropy cell first`).
2. **Zero Redundant Eyebrow Headers**:
   - Never pair an eyebrow pill (`STAGE 01 • CELL SELECTION QUEUE`) with a heading that says the same thing (`Uncollapsed Voxel Selection Strategy`). Use a single numbered heading (`1. Next Cell`).
3. **2–6 Words Per Signpost Pill**:
   - Floating viewport pills must be a single line of **2–6 words** (e.g., `4×4×8 Tower · CRS + VTB Only`), readable in `< 1.0s`.
4. **30-Word Maximum on Full-Screen Comparison Slides**:
   - On a 3-row comparison stack (held for `4.0s`), total word count across the entire slide must stay under **35 words** (`~4–5 words` per cell).

---

## Phase 2: Message Signposts, Graphic Layouts & Pacing Rhythm

Model layout changes and visual signposts so the viewer always knows *where* they are in the narrative and *what* to look at next.

### 2.1 Hierarchy of Message Signposts
1. **Chapter Title Cards (`1.20s` / `36 frames` at `30 fps`)**:
   - Full-screen white `#FFFFFF` canvas with minimalist corner L-brackets (`#0D9488`).
   - Envelope: `8 frames` (`0.27s`) fade-in -> `20 frames` (`0.67s`) hold -> `8 frames` (`0.27s`) fade-out.
   - Contains **3 elements only**: Chapter Number Pill (`01`), Bold Chapter Title (`BUILDING BLOCKS`), and 3-item Subtitle (`Tiles · Voxel Grid · Adjacency Rules`).
2. **Single-Line Top-Left Viewport Signpost Pill**:
   - Positioned consistently at `(x=64, y=64)` (in `2560×1440` space) with a `6px` vertical accent bar on the left (Teal `#0D9488` for primary/Algorithm A, Magenta `#BE185D` for Algorithm B, Slate `#0F172A` for neutral).
   - No secondary bottom status bars or bottom-right parameter tables unless a shot specifically requires a 4-item legend (e.g., Shot 02 tile legend chips).
3. **Layout Rhythm Across Chapters**:
   - Alternate between **Full-Screen Single Viewport** (`16:9` rounded container), **1×2 Split Screen** (Left UI Inspector + Right 3D Viewport, or Left Solver A + Right Solver B), **Progressive 3-Row Stack** (for conceptual comparison), and **2×2 Simultaneous Quad Grid** (overview before 4 sequential full-screen closeups).

### 2.2 Pacing & Velocity of Change (Slow Down for Comprehension)
Rapid camera orbits and 60-step-per-second voxel collapses turn algorithmic videos into unreadable noise. Enforce these velocity ceilings at `30.00 fps`:

| Motion / Step Type | Target Velocity / Hold Duration | Why |
| :--- | :--- | :--- |
| **Camera Orbit Angular Velocity** | **`0.0025 – 0.0045 rad/frame`** (`~4°–8° per second`) | Keeps 3D structure legible while providing gentle parallax depth. |
| **Sub-Step Rule Lookup Hold** | **`12 – 16 frames` (`0.40s – 0.53s`) per lookup** | Gives the viewer's eye time to read the highlighted matrix cell and see the 3D green/red candidate ghost tile. |
| **Side-by-Side Solver Race Step Rate** | **`1 cell every 3 frames` (`10 cells/sec`)** | Allows the viewer to compare Adjacency Growth's outward branching vs. WFC's minimum-entropy pruning step by step. |
| **Parameter Variation Clips** | **`8.0s` (`240 frames`) per variation** (`4.4s` in 2×2 grid + `3.6s` in closeup) | Shows both early seeding and final converged architecture. |
| **Shaded -> Arctic Cross-Dissolve** | **`30 frames` (`1.00s`) alpha blend** | Smoothly transitions between colored tile topology and ambient-occlusion clay shading. |

---

## Phase 3: App Instrumentation & Clean White-Theme Raw Footage Capture

Across the DRL project apps (`Base/Reference_viewport_rhinoIO_Outliner.html`, `index.html`, `index_WFC.html`), the web application exposes a `window.__app` object for deterministic headless control.

### 3.1 Required `window.__app` Hooks
When building or preparing an interactive Three.js / Rhino3dm app for video capture, ensure `window.__app` exposes:
- `setup()`, `update(dt)`, `draw()`
- `stepAlgorithmOnce()` and `stepSubstepOnce()` (for deterministic frame-by-frame stepping with auto-run paused)
- `setAlgorithm(algo)`, `setGridResolution(gx, gy, gz)` (supporting independent anisotropic `X × Y × Z` resolutions like `4×3×1` or `4×4×8`), `setSubstepMode(on)`, `setArctic(on)`
- `groupVis` (`{ points, simLines, curves, meshes, voxels, grid }`)
- `scene`, `camera`, `renderer`, `controls`, `mainGroup`, `meshGroup`, `voxelGroup`, `substepGroup`

### 3.2 Mandatory Visual Hygiene Checklist Before Every Capture
In every Playwright capture script (`video_build/capture_ch1.mjs`, `video_build/capture_ch2.mjs`, `video_build/capture_ch3_ch4.mjs`), execute this exact initialization block before capturing a single frame:

```javascript
await page.evaluate(() => {
    const app = window.__app;

    // 1. Pause automatic simulation loop so stepping is 100% deterministic per frame
    const btnRun = document.getElementById('btn-sim-run');
    if (btnRun && btnRun.classList.contains('on')) btnRun.click();
    app.controls.enableDamping = false;

    // 2. Pure White Background (#FFFFFF) throughout
    app.scene.background.setHex(0xffffff);
    document.body.style.backgroundColor = '#ffffff';

    // 3. Permanently remove Ground Grid (GridHelper) & Origin Axes Lines (axesGroup)
    // Setting groupVis.grid = false prevents applyOutlinerVisibility() inside draw() from re-enabling them!
    app.groupVis.grid = false;
    app.scene.traverse((obj) => {
        if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
    });
    if (app.mainGroup && app.mainGroup.children[0]) {
        app.mainGroup.children[0].visible = false;
    }

    // 4. Hide all HTML/2D canvas viewport overlays (#outliner, #overlay-canvas, #substep-hud)
    ['outliner', 'overlay-canvas', 'substep-hud'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });

    // 5. Fix sidebar width to match SIDEBAR_W (320px) and remove CSS drop-shadow onto canvas
    const aside = document.querySelector('aside');
    if (aside) {
        aside.style.width = '320px';
        aside.style.minWidth = '320px';
        aside.style.maxWidth = '320px';
        aside.style.flexShrink = '0';
        aside.style.boxShadow = 'none';
    }

    // 6. Enforce 2x HiDPI WebGL Supersampling for crisp wireframe anti-aliasing
    app.renderer.setPixelRatio(2);
    window.dispatchEvent(new Event('resize'));
    app.draw();
});
```

### 3.3 Deterministic Seeding & Parallel Swarm Capture
- **Seeded PRNG**: Always override `Math.random` with a deterministic LCG (`s = (s * 1664525 + 1013904223) % 4294967296`) at the start of each clip so side-by-side comparisons (`Adjacency Growth` vs. `WFC Collapse`) start from the exact same seed and re-runs are 100% reproducible.
- **Swarm Parallelism**: Partition raw footage capture across independent worker subagents by chapter (`Worker 1: Ch1`, `Worker 2: Ch2`, `Worker 3: Ch3 & Ch4`, `Worker 4: Compositor`) writing to isolated subdirectories (`video_build/raw/ch1/` .. `ch4/`) and saving per-frame telemetry (`substep_meta.json`, `ch2_meta.json`, `ch3_meta.json`).
- **Standalone Playable Raw Clips**: Encode every raw PNG sequence into `video_build/raw_clips/` (`ch1_01_tiles_turntable.mp4` .. `ch4_02_arctic_clay.mp4`) so raw clips can be inspected independently before or alongside the master edit.

---

## Phase 4: 2× Supersampled Compositing & Encoding (`video_build/compose_master.py`)

1. **2× Supersampled Master Canvas (`2560 × 1440` -> `1280 × 720` HD)**:
   - Draw all 2D layouts, rounded viewport containers, matrices, and typography on a `2560 × 1440` canvas and downsample each completed frame to `1280 × 720` using `Image.Resampling.LANCZOS`.
2. **Anti-Aliased Rounded Rectangles & Borders**:
   - Never use `ImageDraw.rounded_rectangle(..., outline=...)` directly at `1×` (which produces jagged 1-bit corners). Always use a `2×` supersampled alpha mask (`get_rounded_mask` + `paste_aa_rounded_box`) so every card border, matrix cell, and signpost pill has smooth anti-aliased edges.
3. **FFmpeg 1:1 Frame-Accurate Encoding**:
   - Always pass `-framerate 30` **before** `-i frame_%04d.jpg` and `-r 30` after:
     ```powershell
     ffmpeg -y -framerate 30 -i video_build/frames/frame_%04d.jpg -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -r 30 -movflags +faststart wfc_showcase_60s_720p.mp4
     ```

---

## Phase 5: Keyframes & Chapter-Aligned Storyboard Verification

Every video build must conclude by generating **individual shot keyframes** and a **Chapter-Aligned Storyboard Sheet** for visual QA:

1. **Individual Named Keyframes (`video_build/keyframes/`)**:
   - Extract one representative frame per shot/beat (`kf_01_ch1_title_card.jpg` through `kf_22_ch4_rhino_3dm_export.jpg`) so every title card, split-screen, comparison slide, and parameter variation can be inspected at native `1280 × 720` resolution.
2. **Chapter-Aligned Storyboard (`video_build/storyboard_by_chapter.jpg`)**:
   - Group shots by chapter under a full-width **Chapter Header Banner** (`CHAPTER 01` .. `CHAPTER 04` with timecode and frame range).
   - **Always start each new chapter on the far left (Column 1) of a new row** (leaving any unused columns at the end of the previous chapter blank). This allows the viewer to scan the narrative **top-to-bottom by chapter** and **left-to-right within each chapter** without hunting for chapter starts inside a flat grid.
3. **Visual QA Checklist on the Storyboard**:
   - [ ] Is the background pure white (`#FFFFFF`) across all title cards, slides, and 3D viewports?
   - [ ] Are all ground grid lines (`GridHelper`), origin axes (`axesGroup`), and sidebar drop-shadows completely absent?
   - [ ] Does every slide obey the minimal-text rule (zero code snippets, zero redundant `STAGE` badges, 2–6 words per pill)?
   - [ ] Are all wireframe lines and rounded card borders cleanly anti-aliased?

---
name: alice-explainer-video
description: Create, edit, and surgically revise practice-grade architectural & computational design explainer films and show-reels (1K/2K/4K 30 FPS H.264 MP4 + interactive Goldilocks web showcase). Codifies custom C++20/GDI+/WebGPU algorithm visualizer apps (linked 2D+3D space, 50/50 Input->Output openers, 3-5 stage element-by-element geometry processing), designer-voice text simplification (<= 2.5 words/sec, zero developer/compiler jargon), 2D screen layout composition (full-bleed 16:9, strict 1:1 isotropic aspect ratio, unified #070A10 dark canvas, white-on-black 2D CAD drawings, zero rectangle-in-rectangle chrome, x = 40 px left-aligned single-spaced typography, seamless full-width HUD masking), diagram & CAD choreography (Calibri 44pt/22pt pure-black title cards, A->B->C sequential reveals, authentic Rhino CAD shaded wireframes vs. sci-fi neon glows), timing/motion comfort (1.0x 30 FPS playback, >= 3.0s stage holds, proportional-time latency racing), and SOP 4-Gate + Swarm Two-Phase Convergence.
---

# Technical Explainer Film & Show-Reel Creation and Editing Skill (`alice-explainer-video`)

Use this skill whenever the user asks to **create, edit, re-time, re-layout, or revise a technical explainer video, show-reel, algorithm walkthrough, or feature showcase** (such as the 19-round evolution across **Explainer Film R1–R13** and **ALICE 3.0 Show-Reel R14–R19**).

---

## 1. Foundational Philosophy & The 5 Non-Negotiable Principles

Every technical explainer film is **visual argumentation for a computational designer, architect, and general audience—not a developer telemetry dump**.

1. **Practice-Grade Architectural Realism (Zero Toy Geometry)**:
   - Every frame must operate on real production architectural models and typologies (`Grand Théâtre de Rabat` `813,147` triangles, `Nansha Stadium Roof` `23,040V / 11,840Q`, `4393 KLNG Arena`, `4368 Hangzhou` towers, `ScmPod` Sub-D pod, `WaveLatent` `S1..S5` high-rise floorplans with slender `1 : 4.2` vertical proportions, `256`-parcel waterfront masterplans).
   - Never substitute wavy `sin(x)*cos(y)` grids, low-poly rainbow cylinders, or Monopoly sheds.
2. **Audience-First Plain English (100% Designer Voice, Zero Systems Jargon)**:
   - Address an **architect / computational designer** (Rhino, Grasshopper, Maya, Unreal mindset).
   - Purge all compiler, memory-allocator, and internal solver acronyms from visible video frames (see Section 4).
3. **Earn Every Pixel (Zero "Rectangle-in-Rectangle-in-Rectangle" Chrome)**:
   - Let moving 3D and 2D geometry breathe **full-bleed across `1920×1080` (`16:9`)** on a unified **deep obsidian `#070A10` (`RGB(7, 10, 16)`)** canvas.
   - Delete outer frame borders, top stage-pill bars, viewport borders, right-hand inspector boxes, nested sub-cards, and bottom banner boxes. Overlay clean, un-boxed typography (`x = 40 px`, single-line spacing) directly onto the moving video.
4. **Show *How* the Algorithm Works in Linked `2D + 3D` Space**:
   - When raw screen capture is cryptic, static, or cluttered, build a dedicated **C++20 algorithmic visualizer app** (`gen_ch*.cpp`) that decomposes the algorithm into **3–5 element-by-element stages**, pairing **2D Plan / Field / Graph Space** with **3D Perspective / Surface / Massing Space** (see Section 3).
5. **Respect Human Reading Speed & Motion Comfort (`1.0×` Pacing, $\le 2.5\text{ words/sec}$)**:
   - Never fast-forward 3D camera orbits (`ban advanceFrames(2..4)`), never strobe-crossfade 3 stills inside 3 seconds, never leave dead static start windows where nothing moves, and hold every algorithmic stage for **`3.0–3.6 seconds` (`90–110` frames @ `30 FPS`)**.

---

## 2. The 8-Step Deterministic Video Pipeline & 4 Quality Gates (`SOP`)

Never treat video editing as an ad-hoc screen recording. Every film or revision batch follows the **8-step deterministic pipeline** with four hard gates (`F1`, `S1`, `C1`, `Q1`):

```
[1. Gate F1: Fact Ledger] ──> [2. Gate S1: Storyboard] ──> [3. Gate C1: 2x2 SSAA Capture]
                                                                      │
[6. Master C++20 Encode] <── [5. Gate Q1: Audit Sheets] <── [4. Custom Algorithm Apps]
         │
         ▼
[7. Goldilocks Web Player] ──> [8. 5-Kind Annotated-Screenshot Review Loop]
```

| Step / Gate | Artifact / Output | Mandatory Verification Rule |
| :--- | :--- | :--- |
| **Step 1 (`Gate F1`)** | `facts_<film>.md` | **Fact Ledger**: Every quantitative claim (`0.033 s`, `86× Faster`, `11,840 Quads`, `0.14 mm warp`) must have an exact `source_path:line` or benchmark log citation. Zero unverified numbers may appear on screen. |
| **Step 2 (`Gate S1`)** | `storyboard_<film>.md` | **Frame-Accurate Storyboard**: Every chapter specifies `[startF .. endF]`, duration in seconds, visual device (`50/50 Input->Output`, `Linked 2D+3D`, `3-Stage Wipe`, `Latency Race`), exact left-aligned copy (`<= 2.5 words/sec`), and source clip. |
| **Step 3 (`Gate C1`)** | Raw App Captures (`.mp4`/`.png`) | **`2×2` SSAA & Minimal UI Capture**: Capture live apps at `16:9` with non-essential docks hidden (`Node Inspector`, `Foundry HPR Switcher` closed), node graphs **Zoom-Fit (`Frame All`)**, and `[OBSERVER]` histograms un-cropped. |
| **Step 4 (Custom Apps)** | `gen_ch*.cpp` $\rightarrow$ `clips/*.mp4` | **Algorithm Visualizer Apps**: Compile standalone C++20/GDI+/Media Foundation renderers for chapters requiring element-by-element 3D/2D algorithmic staging (Section 3). |
| **Step 5 (`Gate Q1-A`)** | `w*_audit_sheet.png` | **Pre-Encode Worker Contact Sheets**: Every custom clip generator writes a multi-row PNG grid sampling key frames of every stage. Inspect via `read_file` *before* running the master compositor. |
| **Step 6 (Master Encode)** | `render_<film>.cpp` $\rightarrow$ `<film>.mp4` | **Deterministic C++20 `IMFSinkWriter` Compositor**: Single-file C++20 compositor encoding `1920×1080` (`1K`, `22 Mbps`) or `2560×1440` (`2K`, `35 Mbps`) @ `30.00 FPS` with top-down positive stride (`OUT_W * 4`). |
| **Step 7 (`Gate Q1-B`)** | `contact_sheet_<film>.png` & `mp4_decoded_*_verify.png` | **Post-Encode & Post-Decode Verification**: Compositor automatically decodes frames back out of the finished `.mp4` via `IMFSourceReader` to verify `0` vertical stride flips, `0` text overlaps, `0` cropped edges, and `1:1` aspect ratio. |
| **Step 8 (Review Loop)** | `review_<film>.md` + `index.html` | **5-Kind Annotated Review Ledger**: Log every user comment or red-pen screenshot markup by timecode, classify as `Fact` / `Fairness` / `Device` / `Craft` / `Scope`, and verify Goldilocks entropy (`H_norm in [0.64..0.86]`) on `index.html`. |

---

## 3. Pillar 1 — Creating Custom Apps & C++20 Renderers to Explain Algorithms

Raw screen captures of a complex 3D engine often fail to explain *what* an algorithm is doing or *why* it matters (e.g., a static pink mesh waiting 2.85 seconds to solve, a speckled point cloud with a developer hex dump, or a flat 2D chart of neural training losses).

### 3.1 When to Build a Custom Algorithm Visualizer App (`gen_ch*.cpp`)
Build or revise a dedicated C++20 visualizer executable whenever:
1. **The raw capture has dead/static windows** (`REV-11A`): Nothing visibly changes for `> 1.5 s`, or the solver finishes before/after the sampled window.
2. **The algorithm is an invisible internal pipeline** (`R16`, `REV-09E`, `REV-11D`): e.g. 3D-to-2D Hidden-Line Removal, Rhino `.3dm` to Unreal 5.8 `.pmesh` chunking & Lumen GI compilation, or OpenUSD binary quad/instance packing.
3. **The concept bridges 2D mathematics and 3D architecture** (`REV-11E..G`): e.g. Signed-Distance Fields ($z = d(x,y)$), Autoencoder Latent Spaces, or Multi-Agent Reinforcement Learning (MARL).

### 3.2 Five Proven Algorithmic Visual Devices

#### Device 1: Immediate `50 / 50` Side-by-Side `Input → Output` Opener (`REV-09A`, `REV-10B`)
- **Rule**: Start every Foundry or transformation chapter (`f = 0..74`, `~2.5 s`) with an immediate **`50 / 50` side-by-side split screen (`x = 0..960` vs. `x = 960..1920`)**:
  - **Left Half (`x = 0..960`)**: The rotating 3D Input model (e.g. raw 3D Rhino `.3dm` model of Grand Théâtre de Rabat, `813,147` triangles).
  - **Right Half (`x = 960..1920`)**: The final Output (e.g. crisp white-on-black 2D architectural plans & elevations, or the live Unreal Engine 5.8 walkthrough).
- **Critical Trap to Avoid**: Never start a split-screen wipe at `x = 1880` on frame `0`, which leaves the right half of the screen completely black at `t = 0.0 s` (`REV-10B` Image 2). Both Input and Output must be 100% visible from Frame `0`.

#### Device 2: 3–5 Stage Element-by-Element 3D Geometry Processing Storyboard (`R16`, `REV-09E`, `REV-11D`)
Decompose any complex pipeline into **3 to 5 sequential stages (`~3.0–3.5 s` each)** where the viewer watches the algorithm transform the 3D geometry element-by-element:
- **Example A — 2D Drawing Foundry (`gen_r16_ch11_drawing_foundry.cpp`)**:
  1. *Stage 0 (`Input → Output`)*: `50/50` 3D Rhino `.3dm` model (left) $\rightarrow$ 6 white-on-black `1:1` 2D plans & elevations (right).
  2. *Stage 1 (3D Assembly Indexing)*: The `813,147` 3D triangles light up group-by-group into `9` color-coded structural/envelope groups (`SILH_GRP`).
  3. *Stage 2 (Horizontal Cutting Plane)*: A glowing plane at `Z = +20.11 m` sweeps through the 3D model, highlighting exact 3D triangle-plane intersection segments in gold on the left while projecting closed `0.55 mm` white 2D section loops on the right.
  4. *Stage 3 (Depth-Buffer Hidden-Line Removal)*: A front-to-back scan wave culls `98.8%` occluded crimson interior ribs in 3D, leaving only crisp visible exterior silhouette curves.
  5. *Stage 4 (Gap Bridging & ISO 128 Lineweights)*: Zoomed 2D CAD detail closing `<= 350 mm` micro-gaps and applying the 5-tier architectural pen hierarchy (`0.55 mm` down to `0.07 mm`).
- **Example B — Unreal 5.8 Foundry (`gen_r16_ch12_ue_foundry.cpp`) — Show Both Prep AND Runtime Ingestion (`REV-09E`)**:
  - Never jump straight from exporter prep to the finished walkthrough. Show both:
    - *Exporter Prep (`alice_ue_export.exe`)*: Datum alignment (`Z = 0.0 m`), `<= 45 m` spatial cutting planes subdividing the shell into `202` `.pmesh` chunks, and outward glass normal vectors ($\vec{N}$).
    - *Runtime Engine Ingestion (`Rhino_to_UE.exe`)*: `.pmesh` streaming + **CAD-to-Lumen GI lighting build wipe** (authentic Rhino CAD technical wireframe `#CFD6DF` with `1 px` `#2E3644` edges wiping into the multi-bounce Lumen GI render), followed by calm CAD leader callouts (`Trees & Landscape`, `Pedestrian Promenade`, `Walkable Plaza`).
- **Example C — OpenUSD 3D Architectural Exchange (`gen_r19_ch08_09_10_13.cpp`, `REV-11D`)**:
  - *Step 1 (Problem vs. Solution)*: Side-by-side zoomed 3D stadium roof sector comparing `Standard 3D Export (Triangulated • 23,680 Triangles)` with broken red diagonal creases against `ALICE Native OpenUSD (.usdc • 11,840 Pure Quads)`.
  - *Step 2 (3D Layer Explode)*: Vertical 3D separation lifting the `1,920` warm-gold instanced structural mullions (`Layer 1`) above the `11,840` cyan glazing quad surface (`Layer 2`) (`48.4 MB Raw CAD → 1.39 MB Binary OpenUSD`).
  - *Step 3 (Cross-Platform Curtain Wipe)*: 3-zone wipe across the 3D stadium bowl (`1. Rhino 8 CAD Quad Mesh` $\rightarrow$ `2. ALICE OpenUSD (.usdc)` $\rightarrow$ `3. Unreal Engine 5.8 Render`).

#### Device 3: Linked `2D Space (Left)` + `3D Space (Right)` Explanations (`REV-11E`, `REV-11G`)
Whenever explaining a mathematical, machine-learning, or spatial-optimization concept (`A, B, C`), **never show a flat 2D chart alone**. Pair **2D Space on the Left (`x = 40..920`)** with **3D Space on the Right (`x = 960..1880`)**:
- **`WaveLatent` Glass-Box Autoencoder (`gen_r15_ml_urban_clips.cpp`, `REV-11E`)**:
  - **Stage A (Architectural Floor Outlines)**: *2D Plan Space (Left)* shows the 5 floorplan diagrams (`S1..S5`) with glazing loops, blue elevator cores, and red columns; *3D Structural Space (Right)* simultaneously shows the 3D perspective cutaway of thick extruded concrete floor slabs, continuous 3D vertical blue core shafts, and 3D red perimeter columns.
  - **Stage B (Signed-Distance Fields — The 3D Zero-Plane Intuition)**: *2D SDF Field (Left)* shows the 2D distance heatmap $d(x,y)$ and iso-contours; *3D SDF Surface (Right)* renders the **3D perspective height landscape $z = d(x,y)$ sliced by a semi-transparent horizontal cutting plane at $z = 0$**, where the glowing magenta 3D intersection loop ($z = d(x,y) = 0$) forms the exact floor perimeter. This makes it immediately intuitive in 3D how a single valley bifurcating into 4 basins across the $z = 0$ plane smoothly splits 1 floorplate into 4 residential tower petals (`S5`) without breaking mesh topology.
  - **Stage C (Continuous Latent Manifold)**: *2D Latent Map (Left)* shows the `10×10` decoded floorplan grid with the orange trajectory `S1 → S2 → S3 → S4 → S5`; *3D Latent Trajectory (Right)* shows that 2D grid as a horizontal base plane ($z = 0$) with the `S1 → S5` path extruded vertically along the height axis into a 40-story 3D contour stack.
- **Multi-Agent Reinforcement Learning (`MARL`, `REV-11G`)**:
  - Pair **3D Urban Massing & Solar Sightline Space (`x = 40..1240`)** with the **2D 36-Node Agent Policy Graph & Cooperative Reward Curve (`x = 1280..1880`)** across *Episode 1 (Uncoordinated Greedy Waterfront Walls with red shadow cones & conflict rays)* $\rightarrow$ *Episode 120 (Sightline & Height Negotiation with golden solar vectors)* $\rightarrow$ *Episode 250 (Converged Cooperative Equilibrium with stepped waterfront terraces and a central green park commons)*.

#### Device 4: Active 3D Wavefront & Proportional-Time Latency Racing (`SOP Principle 4`, `REV-11A`)
- Never show a benchmark comparison as two static meshes or an instant cut.
- In a side-by-side race (`Legacy Solver • 2.85 s` on Left vs. `ALICE Algorithm Foundry • 0.033 s — 86× Faster` on Right), sweep a **visible 3D radial/azimuthal solver wavefront** across the right-hand 3D Nansha Stadium Roof in `1.2–1.5 s`, snapping `11,840` warped magenta quads into emerald-green planar quads (`< 0.50 mm` warp) with a zoomed 3D quad-corner projection inset ($\Delta z: 18.4\text{ mm} \rightarrow 0.14\text{ mm}$), while the left-hand Legacy Solver crawls slowly from `6% → 33%`.

#### Device 5: Architectural Slenderness & True Proportions (`REV-11F`)
- When rendering procedural 3D high-rise towers, never use stubby `1 : 1.7` column-stump aspect ratios. Enforce a tall, graceful **`1 : 4.2` width-to-height slenderness ratio** with an architectural vertical taper profile (e.g. $s(h) = 1.0 - 0.38 \cdot h^{1.15}$ across `80` floors from a 4-petal base through a fluted mid-rise waist to a sculpted crown), and verify that the 3D geometry stays strictly within the vertical safe zone (`y = 140..845`) so it never touches top headers or bottom captions.

---

## 4. Pillar 2 — Text Simplification, Audience Voice & Reading-Speed Budgets

### 4.1 The Designer-Voice Translation Table (Banned Jargon $\rightarrow$ Approved Plain English)
Before encoding any frame, audit every string in `render_*.cpp` and `gen_*.cpp` against this mandatory translation table (`REV-06A`, `REV-07C..F`, `REV-08A`, `REV-10C`, `REV-11D`):

| Banned Developer / Compiler / Internal Jargon | Approved Architectural & Computational Design Plain English |
| :--- | :--- |
| `SoA`, `DOD`, `Data-Oriented Design`, `cache-line aligned` | `High-Speed Parallel Geometry`, `Instant 3D Solver`, `Interactive Performance` |
| `0 clang++ spawns`, `0 Heap Allocs`, `0 evaluate() allocations`, `GuardScope` | `Instant Code Hot-Reload`, `Zero Pause or Freeze`, `Smooth 60+ FPS Interaction` |
| `pfor`, `AVX2/FMA SIMD`, `Lock-Free Atomics`, `WGSL Compute JIT` | `Multi-Core & GPU Acceleration`, `Real-Time 3D Feedback` |
| `dirty-bitset DAG`, `1e-12 Parity`, `SHA-256 Receipt` | `Smart Scene Graph`, `Exact Geometric Precision (0.000 mm Drift)` |
| `MPxDeformerNode`, `MPxDrawOverride`, `MPxCommand 2.0`, `doIt()/undoIt()` | `Native Maya Plug-In`, `Direct Viewport Handles & 1-Step Undo` |
| `R3D3`, `Arthur Appel QI in {0,1}`, `minCenterGutterPx = 38 px` | `Automated 3D-to-2D Hidden-Line Removal`, `ISO 128 Architectural Lineweights` |
| `PMB1 v2`, `699-Slot Material Synthesis`, `LIFO Walkable` | `Real-Time Unreal Engine 5.8 Walkthrough`, `Architectural Materials & Daylight` |
| `PXR-USDC Crate v0.8.0`, `Zero-Copy Half-Edge` | `Lossless OpenUSD (.usdc) 3D Exchange`, `Preserving 100% Pure Architectural Quads` |
| `512-300-2 Autoencoder`, `Jacobian \|\|J\|\|_F`, `InfoNCE`, `140x140 SDF` | `Glass-Box AI Design Explorer`, `Signed-Distance Fields (SDF)`, `Continuous 2D & 3D Latent Space` |
| `Bid-Rent Grad`, `Schelling`, `Ostrom MARL`, `Q(Conserve/Extract)`, `Gini` | `Multi-Agent Reinforcement Learning (MARL)`, `Cooperative Daylight & Park Commons Negotiation` |
| `tree.point`, `bush.point`, `people.path`, `light.point` | `Trees & Landscape`, `Pedestrian Promenade`, `Walkable Plaza` |

### 4.2 Hard On-Screen Word & Reading-Speed Budgets (`REV-01A`, `REV-04D..E`, `REV-10B..C`)
1. **Display Only Text Meant to Be Read (`REV-04E`)**:
   - Never leave tiny (`8–12 pt`) multi-line diagnostic HUDs, FPS/memory dumps, or baked-in telemetry visible on screen. If text is not meant to be read by the viewer, mask or remove it completely.
2. **Duration-Matched Reading Rate ($\le 2.5\text{ words/second}$, `REV-01A`)**:
   - A `3.0 s` stage may contain at most **`7–8` words in its primary header** (`<= 5`-word bold headline + `<= 7`-word subtitle).
   - Full-screen architecture diagrams or final scorecards (`6.0 s`) must contain **$\le 35\text{–}40$ words total across the entire screen** (`REV-04D`, `REV-07F`).
3. **Ultra-Short Single-Spaced Bullets (Zero Secondary Sub-Lines, `REV-10C`)**:
   - When listing stage takeaways or materials, use at most **`3–4` bullets of `2–4` words each** (e.g., `• Outward Glass Normals`, `• White GFRC Cladding`, `• Double-Glazed Facades`, `• Acoustic Timber & Water`), stacked at the left margin (`x = 40 px`) with **`28 px` single-line vertical spacing** and **zero secondary gray sub-lines** beneath bullets.

---

## 5. Pillar 3 — 2D Screen Layout & Compositional Principles

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ (0,0)                                                              (1920,0)  │
│   x = 40 px (STRICT LEFT ALIGNMENT FOR ALL OVERLAY TEXT)                     │
│   y = 32 px : [26 pt Bold White Headline — <= 5-6 Words]                     │
│   y = 66 px : [18 pt Silver #CBD5E1 Subtitle — Single-Line Pitch (34 px)]    │
│   y = 104 px: • [17.5 pt Short 2-4 Word Bullet 1 (28 px pitch)]              │
│   y = 132 px: • [17.5 pt Short 2-4 Word Bullet 2 (Zero sub-lines!)]          │
│                                                                              │
│   ┌──────────────────────────────────────────────────────────────────────┐   │
│   │                 3D / 2D ACTIVE GEOMETRY SAFE ZONE                    │   │
│   │                      (y = 140 px .. 845 px)                          │   │
│   │     Full-Bleed 16:9 Moving Canvas on Unified Obsidian #070A10        │   │
│   │     Zero Outer Borders • Zero Boxed Cards • Zero Right Inspectors    │   │
│   │     Strict 1:1 Isotropic Scaling (scaleX == scaleY)                  │   │
│   └──────────────────────────────────────────────────────────────────────┘   │
│   y = 858 px: [Optional 1-Line Stage Caption — NEVER below y = 890 px]       │
│ ════════════════════════════════════════════════════════════════════════════ │
│   y = 900..1080 px: PROTECTED MEDIA-PLAYER SEEKBAR ZONE (0% TEXT ALLOWED!)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Eight Mandatory Layout Invariants

1. **Full-Bleed `16:9` Un-Cropped Framing (`(0, 0, 1920, 1080)`, `REV-03A`)**:
   - Always blit `16:9` source captures full-frame at `(0, 0, OUT_W, OUT_H)`.
   - **Never** center-crop a `16:9` capture into an inset box like `(40, 60, 1840, 960)`—that slices `60 px` off the top menu bar, bottom toolbar, and bottom-right `[OBSERVER]` histogram.
2. **Strict `1:1` Isotropic Aspect Ratio (`scaleX == scaleY`, `REV-07A`, `REV-09B`)**:
   - Whenever blitting a 2D architectural drawing sheet (e.g. `2800×2200` master sheet), floorplan crop, or masterplan image into a target slot `(boxX, boxY, boxW, boxH)`, enforce uniform scaling:
     ```cpp
     double scale = std::min(boxW / srcCropW, boxH / srcCropH); // scaleX == scaleY!
     double dstW  = srcCropW * scale;
     double dstH  = srcCropH * scale;
     double dstX  = boxX + 0.5 * (boxW - dstW);
     double dstY  = boxY + 0.5 * (boxH - dstH);
     ```
   - Never stretch `dstW` and `dstH` independently, which warps architectural domes, circular stadia, and square structural grids.
3. **Unified Deep Obsidian Canvas (`#070A10`) & White-on-Black 2D Drawings (`REV-09C`)**:
   - Use **`RGB(7, 10, 16)` (`#070A10`)** across all 3D viewports, 2D drawings, and diagrams.
   - Invert white-paper (`#FAF8F5`) 2D CAD drawings in the shader/pixel sampler onto `#070A10` so `0.55 mm` section cuts render in crisp pure white (`#F8FAFC`), secondary `0.30 mm` silhouettes in luminous silver-cyan (`#CBD5E1`), reflecting water basins in deep azure (`#1C94DA`), and landscape hatches in emerald (`#127658`). This eliminates jarring white paper rectangles next to dark 3D viewports.
4. **Zero "Rectangle-in-Rectangle-in-Rectangle" Chrome (`REV-09D`)**:
   - Never enclose full-screen video inside an outer frame border, never draw rows of boxed stage pills across the top, never draw right-hand inspector rectangles containing nested card rectangles, and never wrap floating titles in rounded pill boxes over live 3D footage.
   - Overlay **direct, un-boxed typography** using a soft 2-pass dark drop-shadow (`alpha = 210` at `(x+2, y+2)`) or a subtle frameless top-left gradient scrim so the moving video fills `100%` of the screen.
5. **Left-Edge Alignment Invariant (`x = 40 px`, Single-Line Spacing, `REV-10A..C`)**:
   - Anchor **all** overlay text at **`x = 40 px`**:
     - **Line 1 (`x = 40, y = 32..36`, `26 pt` Bold White)**: Primary Stage / Scene Title.
     - **Line 2 (`x = 40, y = 66..70`, `18 pt` Silver `#CBD5E1`, `32–34 px` single-line vertical pitch)**: Concise 1-line plain-English explanation.
     - **Optional Bullets (`x = 40, y = 104, 132, 160...`, `17.5 pt` White, `28 px` single-line pitch)**: Short `2–4` word bullets.
   - **Ban Top Eyebrow Lines** above the title (`REV-10B`).
   - **Ban Top-Right Status Text (`x > 900`)** and **Ban Right-Hand Text Columns** (`REV-10A`, `REV-10C`). Only in-scene 3D spatial datum labels (like `Z = +20.1 m` attached to a 3D cutting plane in the middle of the screen) may sit away from `x = 40 px`.
6. **Protected Bottom Seekbar Zone (`y > 900..920`, `REV-10B`)**:
   - Media players overlay their scrubber bar and transport controls across `y = 920..1080`.
   - **Keep `y > 900` 100% free of captions, subtitles, and badges.** Place the subtitle at `y = 66` directly beneath the top-left title (`x = 40`), or keep any bottom stage caption at `y <= 858` with the 3D viewport camera framed above `y = 845`.
7. **Zero Double-Header Collisions & Seamless Full-Width Background Masking (`REV-01B`, `REV-04E`, `REV-11B`)**:
   - Never draw a compositor title on top of a baked-in video HUD header.
   - When masking baked-in diagnostic text at the top of a pre-recorded viewport (such as a white Rhino 8 viewport or dark app capture), **never draw a partial grey patch rectangle** (which creates an awkward visible box `(B)` and leaves half-sliced text `(A)` and `(C)` peeking out around its edges, `REV-11B`).
   - Mask the **entire full width (`x = 0..1920, y = 0..maskH`)** using the **exact sampled background color** of the viewport (`RGB(255, 255, 255)` for white Rhino 8 viewports; `RGB(7, 10, 16)` or per-column background sampling for dark viewports) so the mask is 100% invisible.
8. **Clean App UI Capture Geometry (`REV-02D`, `REV-03B..E`)**:
   - When capturing the live application (`alice_app.exe`):
     - Hide `Node Inspector`, `Foundry HPR Switcher`, and any overlapping floating sub-windows.
     - Keep `Dependency Hypergraph` compact (`~270 px` tall, `<= 25%` of screen height) and execute **Zoom-Fit (`Frame All`)** on the active nodes so node titles and wires are large and legible (`0` tiny `32×14 px` unreadably zoomed-out nodes).
     - Keep the bottom-right `[OBSERVER]` 2D HUD Histogram inside `(1640, 860, 260, 180)` so `100%` of its title, 64 bars, and `min/mean/max` labels remain un-cropped.

---

## 6. Pillar 4 — Creating Diagrams & Architectural CAD Visualizations

### 6.1 Pure-Black Chapter Title Cards (`R12-03`, `REV-02A`)
- Precede each chapter with a dedicated **`18`-frame (`0.60 s` @ `30 FPS`) fullscreen pure-black (`#050608`) chapter card**—never overlay chapter numbers onto busy 3D footage:
  - **Headline**: `Calibri` `44 pt` **Bold Italic ALL CAPS** (`#FFFFFF`), centered or left-anchored at `x = 120`, e.g. `08 · ALGORITHM FOUNDRY`.
  - **Subtitle**: `Calibri` `22 pt` **Italic** (`#38BDF8` cyan or `#CBD5E1` silver), $\le 7$ plain-English words, e.g. *Instant 3D Panel Planarisation & Rationalization*.
  - **Transition**: `6`-frame smooth fade-in from black and `6`-frame cross-dissolve into the chapter's opening frame.

### 6.2 Sequential `A → B → C` Diagram Choreography (`REV-02B`, `R11-02b`)
- Never dump multiple complex diagram zones onto the screen simultaneously.
- **Pattern 1 — Concept-to-Viewport Bridge (`REV-02B`)**:
  - `Phase A (0.0–1.5 s)`: Reveal only the clean 4-node architecture diagram (`Input Mesh → Deformer → Diagnostic Observer → Viewport Output`).
  - `Phase B (1.5–3.0 s)`: Reveal 3 concise takeaway pills (`<= 4` words each) below the graph.
  - `Phase C (3.0–6.0 s)`: Dissolve cleanly into the full-bleed `16:9` live application viewport.
- **Pattern 2 — Step-by-Step Pathway Illumination (`R11-02b`, `REV-07E`)**:
  - In a multi-column architecture map (`01 Specify → 02 Route → 03 Execute → 04 Deliver`), animate an explicit step counter (`[STEP 1/9]` through `[STEP 9/9]`) tracing Pathway 1 box-by-box with a directional travelling pulse before illuminating Pathways 2..5 sequentially.
- **Pattern 3 — Simultaneous `2×2` Multi-Host Grid Opener (`REV-05C`)**:
  - When introducing cross-platform ecosystem parity (e.g. `ALICE Native`, `Rhino 8`, `Autodesk Maya`, `Unreal Engine 5.8`), open with a `1.5 s` (`45`-frame) **`2×2` simultaneous live video grid** before cutting to the individual full-screen host chapters.

### 6.3 Authentic Architectural CAD Aesthetic vs. Sci-Fi Neon Glows (`REV-10D`, `REV-10E`, `REV-B02-02`)
- **STRICT BAN ON SCI-FI HOLOGRAM EFFECTS (`REV-10D`)**:
  - Never overlay fake 2D screen-space neon-cyan grids with glowing yellow dots over a 3D building.
  - Never run a glowing neon-cyan Sobel edge-detection filter over architectural renders.
  - Never use thick, opaque 3D cylinder/cone "clubs" as vector arrows that obscure the building (`REV-B02-02`).
- **REQUIRED ARCHITECTURAL CAD STYLE**:
  - Render 3D engineering stages in **authentic Rhino-style Architectural CAD Technical / Shaded mode**: warm architectural clay/grey surfaces (`#CFD6DF` / `#D8DEE9`) with crisp, non-glowing `1 px` dark-slate CAD triangle/quad wireframe edges (`#2E3644`) and crisp `1.5 px` white CAD section lines.
  - For spatial callouts (`REV-10E`), use **calm CAD leader lines** (`drawCalmCadLeader`: a small crisp white target ring + thin `1.5 px` angled leader line + un-boxed bold white label with drop shadow, at most **3 leaders per view**, held steadily without pulsing).

---

## 7. Pillar 5 — Timing, Pacing, Motion Comfort & Speed of Video

### 7.1 The 7 Timing & Motion Invariants

| Rule | Specification | Rationale / Revision Citation |
| :--- | :--- | :--- |
| **1. Natural `1.0×` 30 FPS Playback** | `advanceFrames(reader, 1)` on every 3D camera orbit or walkthrough (`0` frame skipping). | Skipping every 2nd–4th frame (`2×–4×` fast-forward) causes severe camera rotation dizziness (`REV-08B`). |
| **2. Calm Stage Hold Durations** | **`3.0–3.6 seconds` (`90–110` frames @ `30 FPS`)** per algorithmic stage; **`1.6–2.2 seconds` (`48–66` frames)** minimum per sub-phase (`A, B, C, D`). | Viewers cannot read a stage header and inspect a 3D+2D transformation in `< 2.0 s` (`R16`, `REV-10E`). |
| **3. Ban Rapid Strobe Crossfades & Pulsing Tags** | Never crossfade 3 lighting stills (Daylight $\rightarrow$ Golden Hour $\rightarrow$ Blue Hour) or pop 6 tags in/out inside a `2.8 s` window. | Hold one continuous calm camera move and keep `<= 3` CAD leader callouts steadily visible for `> 3.2 s` (`REV-10E`). |
| **4. Eliminate Dead / Static Opening Windows** | Every clip must show visible 3D geometric progression within **`0.25–1.0 s` (`8–30` frames)**. | When sampling pre-recorded showcase videos, skip static pre-drag pauses and sample the **active mid-drag handle-scrubbing windows** (`REV-11A`, `REV-11B`). |
| **5. Show Complete Modeling & Convergence Arcs** | Play multi-stage modeling operations (`ScmPod@1 -> @5`) to completion and hold on the finished smooth surface for `>= 1.0 s`. | Cutting away at step 2/5 leaves the viewer confused about the final architectural form (`REV-04B`, `R9-01`). |
| **6. Establish Form Before Parameter Sweeps** | Hold initial parameter (`periodicity = 1.0`) during a slow `1.5 s` `15°` camera orbit, then sweep `1.0 → 5.0` over `2.0 s`. | Separating camera introduction from high-frequency topology morphing prevents visual overload (`R9-01`). |
| **7. Temporal Smoothing & Anti-Moiré** | Use `smoothstep` / `lerp` across frames, enforce `dz >= 0.25 m` vertical layer separation, and render 3D meshes at **`2×2` SSAA (`3840×2160 → 1920×1080`)**. | Prevents frame-to-frame height/color strobing, Z-fighting flicker, and ground-grid moiré shimmer (`REV-06D`, `REV-07B`). |

### 7.2 Timeline Expansion Rule (`R16`, `R18`, `R19`)
- Whenever a user asks to explain an algorithm in multiple stages (e.g. expanding a `7.0 s` overview into a 5-stage 3D-to-2D Drawing Foundry walkthrough or a 4-stage `2D+3D` `WaveLatent` walkthrough), **expand the chapter's frame budget by `1.5×–2.2×`** (e.g. `210` frames $\rightarrow$ `480` frames = `16.0 s`) rather than cramming 5 stages into 7 seconds (`1.4 s` per stage is unreadable).
- Update `TOTAL_FRAMES` in the master compositor, re-synchronize chapter start frames `CH_START[]`, and update `data-start` / `data-end` attributes in `index.html`.

---

## 8. Pillar 6 — Deterministic C++20 Media Foundation Compositor & Swarm Surgical Splicing

### 8.1 Windows Media Foundation (`IMFSinkWriter` / `IMFSourceReader`) Engineering Rules
1. **Header Ordering for `<gdiplus.h>` under `clang++ -DNOMINMAX`**:
   - Windows SDK `GdiplusTypes.h` uses unqualified `min`/`max`. Always include `<algorithm>` and expose `std::min`/`std::max` before `<gdiplus.h>`:
     ```cpp
     #include <windows.h>
     #include <algorithm>
     using std::min;
     using std::max;
     #include <gdiplus.h>
     ```
2. **Top-Down RGB32 Stride Invariant (`R1-FIX-01`)**:
   - Configure `IMFSinkWriter` input media type with `MFVideoFormat_RGB32` and a **positive top-down stride (`OUT_W * 4`)**, and copy rows sequentially from `y = 0` to `OUT_H - 1` so encoded H.264 frames are never vertically flipped.
   - Always include an automated post-encode `IMFSourceReader` verification pass at the end of `main()` that decodes `4–8` sample frames from the finished `.mp4` and saves `mp4_decoded_<film>_verify.png`.
3. **1K Iteration Speed vs. 2K/4K Master Delivery (`REV-07`)**:
   - During multi-round visual review cycles (`R14–R19`), render and composite at **`1K` Full HD (`1920×1080` @ `30.00 FPS`, `22 Mbps` H.264)** for fast `~60–180 s` turnaround and crisp 1:1 pixel inspection, keeping all coordinates resolution-independent (`sc(px) = px * OUT_W / 1920.0`).

### 8.2 Two-Phase Swarm Convergence for Multi-Chapter Video Revisions
When revising `>= 3` chapters in parallel:
1. **Phase 1 — Disjoint Parallel Clip Authoring (`invoke_subagent` with `TypeName: "self"`)**:
   - Assign each worker a strictly disjoint C++ clip generator (`gen_r19_ch08_09_10_13.cpp`, `gen_r16_ch11_drawing_foundry.cpp`, `gen_r16_ch12_ue_foundry.cpp`, `gen_r15_ml_urban_clips.cpp`) outputting standalone `1920×1080` `.mp4` clips into `scratch/clips/` plus a per-worker contact sheet (`w1_audit.png`, `w2_audit.png`).
   - A dedicated compositor worker updates `render_<film>.cpp`, `storyboard_<film>.md`, `facts_<film>.md`, and `index.html` without running the final encode until the clip workers finish.
2. **Phase 2 — Single-Builder Master Encode & Visual Contact-Sheet Audit**:
   - The Coordinator inspects every worker's `w*_audit.png` via `read_file`, compiles and runs `render_<film>.exe` once, inspects `contact_sheet_<film>.png` and `mp4_decoded_*_verify.png` via `read_file`, and verifies Foundry Mode A cleanliness (`powershell -NoProfile -ExecutionPolicy Bypass -File .\common\scripts\foundry_mode_guard.ps1 -Mode A -Verify`).

---

## 9. Pre-Delivery 12-Point Verification Checklist

Before presenting any new or revised explainer video to the user, verify all 12 gates:

- [ ] **1. Fact & Storyboard Sync (`Gates F1 & S1`)**: `facts_<film>.md`, `storyboard_<film>.md`, `review_<film>.md`, and `index.html` chapter timecodes (`data-start` / `data-end`) match `CH_START[]` in `render_<film>.cpp` to the exact frame.
- [ ] **2. 100% Designer Voice**: Zero banned developer/compiler acronyms (`SoA`, `DOD`, `0 clang++`, `GuardScope`, `pfor`, `AVX2`, `MPxCommand`, `R3D3`, `PMB1`, `PXR-USDC`, `512-300-2`, `Ostrom MARL`) appear in any frame.
- [ ] **3. Word & Reading Budget**: Every 3s stage has $\le 12$ header words ($\le 2.5\text{ words/sec}$), full-screen diagrams have $\le 40$ words total, and bullet lists have $\le 4$ single-spaced `2–4` word items with zero secondary sub-lines.
- [ ] **4. Full-Bleed `16:9` & `1:1` Aspect Ratio**: All `16:9` captures blit to `(0, 0, 1920, 1080)` un-cropped, and all 2D drawings/maps enforce `scaleX == scaleY` (`< 0.01%` aspect error).
- [ ] **5. Unified `#070A10` Dark Canvas & White-on-Black 2D Drawings**: Zero jarring white paper boxes next to dark 3D viewports.
- [ ] **6. Zero Rectangle-in-Rectangle Chrome**: Zero outer borders, top stage-pill bars, right-hand inspector boxes, nested sub-cards, or pill boxes around titles.
- [ ] **7. Left-Margin Alignment (`x = 40 px`) & Protected Seekbar (`y > 900`)**: All overlay text is left-aligned at `x = 40 px` (`y = 32` title, `y = 66` subtitle, single-line spacing), zero top eyebrows, zero top-right status text, and zero text in `y > 900`.
- [ ] **8. Seamless Full-Width HUD Masking**: Any masked baked-in header covers the full `0..1920` width in the exact viewport background color (`0` visible grey patch boxes or half-cut text).
- [ ] **9. Linked `2D + 3D` & `Input → Output` Staging**: Foundry chapters open with an immediate `50/50` Frame-0 `Input → Output` view and decompose algorithms into 3–5 element-by-element stages in linked 2D and 3D space.
- [ ] **10. Authentic Architectural CAD Visuals & Slender Proportions**: Rhino-style CAD shaded wireframes (`#CFD6DF` + `1 px` `#2E3644` edges, zero glowing neon grids/Sobel filters) and tall, slender `1 : 4.2` high-rise tower proportions.
- [ ] **11. `1.0×` Motion Comfort & Continuous Action**: Zero `2×–4×` fast-forward camera orbits, zero rapid strobe crossfades, stage holds $\ge 3.0\text{ s}$, and active 3D geometry transformation within the first `1.0 s` of every clip.
- [ ] **12. Post-Decode Contact Sheet & 8-Gate Goldilocks Web Audit**: `mp4_decoded_*_verify.png` and `contact_sheet_<film>.png` visually inspected via `read_file`, `verify_goldilocks_entropy.js` passes all 8 gates (`H_norm in [0.64..0.86]`, including `G8_HOVER_CONTENT_LEGIBILITY`: every `data-tip` `<= 16` words / `<= 95` chars and every `<svg><title>` `<= 14` words / `<= 80` chars in plain English so native hover tooltips never clip off the container edge), and `foundry_mode_guard.ps1 -Mode A -Verify` reports `ok: true`.

---

## 10. Reference Exemplars in This Workspace

- **SOP Specification**: [`COMMON/USER REFS/SOP.md`](file:///C:/Users/shajay.b.ZAHA-HADID/OneDrive%20-%20Zaha%20Hadid%20Limited/Documents/REPOS/ANTIGRAVITY%20REPOS/cpp-agentic-harness-development-environment/COMMON/USER%20REFS/SOP.md)
- **Master 16-Chapter C++20 Compositor (`R14–R19`)**: [`render_alice3_film_120s.cpp`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/scratch/render_alice3_film_120s.cpp) & [`alice3_vector_chapters_renderer.h`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/scratch/alice3_vector_chapters_renderer.h)
- **Custom Algorithm Visualizer Apps (`R15–R19`)**:
  - Chapters 08, 09, 10, 13 (3D Planarisation Wave, IEO Handle Action, Seamless Rhino 8 Masking, 3-Stage OpenUSD Storyboard): [`gen_r19_ch08_09_10_13.cpp`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/scratch/gen_r19_ch08_09_10_13.cpp)
  - Chapter 11 (2D Drawing Foundry `50/50 Input->Output` & 5-Stage 3D-to-2D HLR Pipeline): [`gen_r16_ch11_drawing_foundry.cpp`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/scratch/gen_r16_ch11_drawing_foundry.cpp)
  - Chapter 12 (Unreal 5.8 Foundry `.3dm` Prep + `Rhino_to_UE.exe` CAD-to-Lumen GI Ingestion): [`gen_r16_ch12_ue_foundry.cpp`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/scratch/gen_r16_ch12_ue_foundry.cpp)
  - Chapters 14, 15, 16 (`WaveLatent` Linked `2D+3D` `A, B, C` + Slender `1:4.2` Tower & `MARL` Cooperative Urban Negotiation): [`gen_r15_ml_urban_clips.cpp`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/scratch/gen_r15_ml_urban_clips.cpp)
- **19-Round Review & Storyboard Ledgers**: [`review_alice3_120s.md`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/review_alice3_120s.md), [`storyboard_alice3_120s.md`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/storyboard_alice3_120s.md), [`facts_alice3_120s.md`](file:///C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/bd72b2aa-c719-4484-bada-9d37de4e54cc/facts_alice3_120s.md)

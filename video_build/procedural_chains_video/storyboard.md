# Storyboard — Topogen Procedural Chains Demo Video

**Target Master**: `video_build/procedural_chains_video/out/topogen_procedural_chains_master_1080p.mp4` (`1920×1080`, `30.00 fps`, H.264 `yuv420p`, `+faststart`)  
**Target Discord**: `video_build/procedural_chains_video/out/topogen_procedural_chains_discord_720p.mp4` (`1280×720`, `30.00 fps`, H.264 `yuv420p`, `+faststart`, **< 10 MB**)  
**Target Duration**: **~60 seconds** (`1,800 frames` @ `30 fps`, calm `1.0×` pacing — zero fast-forward camera orbits)  
**Visual Theme**: Authentic Topogen **Studio Light** (`#FFFFFF` canvas, `#0F172A` slate ink, `#2563EB` primary blue & `#0D9488` teal accents)  
**Audience Voice**: Computational designer & architect plain English (`<= 2.5 words/sec`, zero developer/JSON/code jargon)

---

## 1. Narrative Arc & Chapter Plan

| Chapter | Timecode | Duration | Clip Owner | On-Screen Card / Signpost Copy | Visual Goal |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Opening** | `00:00.0 – 00:01.8` | `1.8 s` (`54 f`) | `@editor` | **TOPOGEN · PROCEDURAL CHAINS**<br>*Record, Replay & Share 3D Workflows* | Clean Studio Light title card (`#FFFFFF`, corner L-brackets). |
| **Ch 01 Card** | `00:01.8 – 00:03.3` | `1.5 s` (`45 f`) | `@editor` | **01 · CORPUS PLAYBACK**<br>*Stored Workflows Replayed Live* | Introduces the 3 built-in corpus chains. |
| **Clip 1A** | `00:03.3 – 00:11.3` | `8.0 s` (`240 f`) | `@capture-corpus` | `Case 1 · Arch Vault Ring Subdivision` | Select Case 1 in `7. I/O` → Load → minimize sidebar → watch bottom timeline step through WFC → PQ Solidify → Ring Subdiv → calm 3D orbit. |
| **Clip 1B** | `00:11.3 – 00:18.8` | `7.5 s` (`225 f`) | `@capture-corpus` | `Case 2 · Arch Vault Longitudinal Strips` | Select Case 2 in `7. I/O` → Load → minimize sidebar → watch timeline step through Miter Clamp OFF → Longitudinal Subdiv → calm 3D orbit. |
| **Clip 1C** | `00:18.8 – 00:25.8` | `7.0 s` (`210 f`) | `@capture-corpus` | `Case 3 · Custom Batwing Tile` | Select Case 3 in `7. I/O` → Load (auto-loads `batwing.obj` asset) → minimize sidebar → watch `1×1×1` Batwing solidify into PQ tubes → calm 3D orbit. |
| **Ch 02 Card** | `00:25.8 – 00:27.3` | `1.5 s` (`45 f`) | `@editor` | **02 · CREATE A CHAIN**<br>*Build Steps · Bookmark Views · Save* | Transitions to live step-by-step authoring. |
| **Clip 2A** | `00:27.3 – 00:36.3` | `9.0 s` (`270 f`) | `@capture-walkthrough` | `Record Steps · Tiles → Topo → PQ Mesh` | Clean start (`Clear`), real mouse clicks across `1. Tiles` (enable Arch Vault) → `2. Topo` (Collapse `3×3×4` grid) → `3. PQ Mesh` (Solidify + Ring Subdiv). |
| **Clip 2B** | `00:36.3 – 00:44.8` | `8.5 s` (`255 f`) | `@capture-walkthrough` | `Save Camera View & Export Chain` | Real mouse orbit to hero angle → expand Display HUD (parked bottom-right) → `+ Save View` (`"Hero Arch"`) → minimize Display HUD → open `7. I/O` → show recorded step badge → click `Save to Repo`. |
| **Ch 03 Card** | `00:44.8 – 00:46.3` | `1.5 s` (`45 f`) | `@editor` | **03 · STEP & PLAYBACK**<br>*Inspect Any Stage · Replay Smoothly* | Transitions to interactive inspection and full replay. |
| **Clip 3A** | `00:46.3 – 00:55.3` | `9.0 s` (`270 f`) | `@capture-walkthrough` | `Stage-by-Stage Timeline Inspection` | Load chain, minimize sidebar so 3D viewport + bottom `#viewport-chain-timeline` are 100% unobstructed; click timeline stage dots sequentially (showing hover tooltip & clear 3D progression: Topology → Solidify → Subdivide → Hero View). |
| **Clip 3B** | `00:55.3 – 01:01.8` | `6.5 s` (`195 f`) | `@capture-walkthrough` | `Smooth Full Replay` | Open `7. I/O` → click `Play All` → minimize sidebar → watch timeline rail progress cleanly across all stages → calm hero 3D orbit finish. |
| **Outro** | `01:01.8 – 01:03.6` | `1.8 s` (`54 f`) | `@editor` | **TOPOGEN · PROCEDURAL CHAINS**<br>*Reproducible 3D Design Workflows* | Clean Studio Light closing card with fade-out. |

*(With `0.3s` crossfades between chapters, final master runtime is **~60–62 seconds**.)*

---

## 2. Signpost Typography & Safe-Zone Rules (Zero Overlap Guarantee)

1. **Top Signpost Pill (Composited by `@editor`)**:
   - **Position**: Top-center-left safe zone:
     - When `#left-sidebar` is **minimized** (Clips `1A`, `1B`, `1C`, `3A`, `3B`): `x = 40 px, y = 64 px` (sits cleanly *below* the `40 px` minimized sidebar header at `y = 12..52`, zero collision!).
     - When `#left-sidebar` is **expanded** (Clips `2A`, `2B`): `x = 420 px, y = 64 px` (sits cleanly *to the right* of the `386 px` sidebar and *below* the `40 px` minimized Telemetry bar if visible, or `y = 20 px` if Telemetry bar is parked right).
   - **Style**: Crisp light translucent pill (`rgba(255,255,255,0.92)`, `1px solid #CBD5E1`, `5px` left accent bar `#2563EB`, `#0F172A` bold `20px` text, `2–6` words max).
2. **Protected Bottom Timeline & Seekbar Zone (`y > 930 px`)**:
   - **NEVER** draw editor subtitles, captions, or badges in `y > 930 px`. That band belongs exclusively to Topogen's live frameless `#viewport-chain-timeline` (`bottom: 28px`, `x = 620..1300`) and media player controls.
3. **Zero Developer Jargon**:
   - Never display `.json`, `wfc_collapse`, `pq_subdiv_ring`, `repoRelativePath`, `DOM`, or `CDP` in any title card or signpost pill. Use plain architectural terms (`Arch Vault`, `Ring Subdivision`, `Longitudinal Strips`, `Custom Batwing Tile`, `Save Camera View`, `Stage-by-Stage Timeline`).

---

## 3. Clip Output Paths & Handoff Contract

| Agent | Output Raw Clips (`1920×1080`, `30 fps`, H.264 MP4) |
| :--- | :--- |
| `@capture-corpus` | `video_build/procedural_chains_video/clips/clip_1a_case1_ring.mp4`<br>`video_build/procedural_chains_video/clips/clip_1b_case2_long.mp4`<br>`video_build/procedural_chains_video/clips/clip_1c_case3_batwing.mp4` |
| `@capture-walkthrough` | `video_build/procedural_chains_video/clips/clip_2a_create_steps.mp4`<br>`video_build/procedural_chains_video/clips/clip_2b_bookmark_save.mp4`<br>`video_build/procedural_chains_video/clips/clip_3a_step_through.mp4`<br>`video_build/procedural_chains_video/clips/clip_3b_play_smooth.mp4` |
| `@editor` | `video_build/procedural_chains_video/out/topogen_procedural_chains_master_1080p.mp4`<br>`video_build/procedural_chains_video/out/topogen_procedural_chains_discord_720p.mp4`<br>`video_build/procedural_chains_video/out/contact_sheet.png` |

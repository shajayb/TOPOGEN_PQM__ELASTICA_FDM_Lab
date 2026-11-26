# WISE_AI_ASSISTANT_MCP.md — TOPOGEN Desktop MCP & Live Co-Pilot Playbook

> **Purpose**: Institutional memory distilled from the TOPOGEN Foundry project conversations (`b066bad3`, `07f862b1`, `12dac260`, `b9988a1e`), cross-project sync with `YYC_Robot` / `ALICE_ABB_FOUNDRY` (`WISE_AI_ASSISTANT_MCP.md`), and codebase audit (`TOPOGEN_FDM_Foundry/agent/*`, `ui/bridge/mcp_ui_bridge.js`, `foundry_server.mjs`, `cli/topogen.mjs`, `scripts/foundry_mode_guard.mjs`). Read this before launching TOPOGEN, driving the live Chrome 3D Workbench via Desktop MCP, or entering Mode B to extend the bridge.

---

## 1. System Architecture: How Desktop MCP Controls TOPOGEN

TOPOGEN's AI assistance stack is a **zero-dependency, 4-layer local control plane** designed to run both **headless Foundry campaigns** and **live interactive Co-Pilot sessions** in **Google Chrome** while enforcing the **Mode A / Mode B cryptographic seal** and **Generator / Verifier air-gap**:

```text
┌───────────────────────────────────────────────────────────────────────────┐
│ 1. Desktop MCP Client (Antigravity / Codex)                               │
│    ~/.gemini/config/mcp_config.json -> `topogen_fdm_foundry` (sessionless)│
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ JSON-RPC 2.0 over stdio (concurrent)
┌───────────────────────────────────▼───────────────────────────────────────┐
│ 2. Unsandboxed MCP Server (`TOPOGEN_FDM_Foundry/agent/mcp.mjs`, v2.1.0)   │
│    • Discovers live daemon via atomic `latest-session.json`               │
│    • Auto-injects `conversationId` from env on `topogen_ui_*` calls       │
│    • Auto-launches `foundry_server.mjs --no-browser --mcp-auto` if down   │
│    • L6 Fallback: spawns desktop Chrome directly if sandboxed daemon hits │
│      `NO_HANDSHAKE`                                                       │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ 4-byte length-prefixed JSON (<=256 KB)
                                    │ Windows named pipe / Unix domain socket
┌───────────────────────────────────▼───────────────────────────────────────┐
│ 3. Foundry Daemon & Broker (`foundry_server.mjs` :8787 + `agent/*`)       │
│    • `agent/broker.mjs`: 256 KB framed IPC server                         │
│    • `agent/service.mjs`: timing-safe 32-byte token, idempotent requestId │
│      receipts, append-only `agent-receipts.jsonl`, Mode A/B hard gate     │
│    • `agent/ui-action-contract.mjs`: single-source 4-layer UI action spec │
│    • `agent/ui-bridge.mjs` (Protocol v2): `browserKind` classifier,       │
│      conversation-to-tab affinity, companion Workbench<->Launcher binding │
│    • `agent/chrome-launcher.mjs`: Chrome binary discovery + detached spawn│
│    • `agent/workspace-tools.mjs`: Mode B confined fs/command sandbox      │
└───────────────────────────────────┬───────────────────────────────────────┘
                                    │ Same-origin HTTP long-poll (`/api/ui-bridge/*`)
┌───────────────────────────────────▼───────────────────────────────────────┐
│ 4. Live Browser UI Bridge v2 (`ui/bridge/mcp_ui_bridge.js`)               │
│    • Runs in `index_TOPOGEN_PQM_ELASTICA_FDM.html` & `foundry_launcher.html`
│    • Reload-stable tab ID (`window.name` + `sessionStorage`)              │
│    • Duplicate-tab collision veto via `BroadcastChannel('topogen_ui_bridge_v2')`
│    • `0ms` close cleanup via `pagehide`/`beforeunload` `sendBeacon`       │
│    • Studio-Light `#mcp-bridge-hud` pill + Pair/Unpair/Copy popover       │
└───────────────────────────────────────────────────────────────────────────┘
```

### Complete Desktop MCP Tool Surface (`27` Tools in `agent/tools.mjs`)

| Domain | Mode | Tools |
| :--- | :--- | :--- |
| **Governance & Briefs** (`4`) | Mode A (`reseal` needs B) | `topogen_inspect`, `topogen_seal_check`, `topogen_list_briefs`, `topogen_save_brief` |
| **Headless Foundry & Campaigns** (`8`) | Mode A (`executionMode: "B"` needs B) | `topogen_quick_eval`, `topogen_launch_campaign`, `topogen_campaign_status`, `topogen_nudge_campaign`, `topogen_stop_campaign`, `topogen_list_runs`, `topogen_get_run`, `topogen_build_report` |
| **Live 3D Workbench UI Bridge** (`9`) | Mode A | `topogen_ui_launch`, `topogen_ui_tabs`, `topogen_ui_connect`, `topogen_ui_inspect`, `topogen_ui_load_file`, `topogen_ui_configure`, `topogen_ui_run_step`, `topogen_ui_reload`, `topogen_ui_export` |
| **Confined Workspace Tools** (`6`) | Read: A / Mutate: **B only** | `topogen_workspace_list`, `topogen_workspace_read`, `topogen_workspace_read_batch`, `topogen_workspace_search`, `topogen_workspace_edit`, `topogen_workspace_run_command` |

### Unified CLI Parity (`TOPOGEN_FDM_Foundry/cli/topogen.mjs` & `topogen.cmd`)

Every live UI and governance operation has first-class CLI parity (backed by single-source `agent/ui-action-contract.mjs`) so agents never need ad-hoc scripts:
- **Launch & Tabs**: `topogen launch [--conv <id>] [--workbench|--launcher] [--reuse|--new-tab]`, `topogen tabs`, `topogen ui <tabs|connect|inspect|load-file|configure|step|reload|export>` (including `--target mesh_tile`, `--skeletonize`, and `--pin-voxel`)
- **Mode & Seals**: `topogen mode [--status|--A|--B]`, `topogen seal --mode A|B [--verify|--reseal|--self-test]`
- **Foundry Runs**: `topogen bench`, `topogen generate`, `topogen verify`, `topogen eval`, `topogen batch`, `topogen run`, `topogen runs`, `topogen report`
- **Daemon & MCP**: `topogen serve [--port 8787] [--allow-mode-b] [--bind-mcp|--no-bind-mcp]`, `topogen mcp [--bind|--unbind|--print-config]`

---

## 2. What Was Implemented & Refined (Evolution Summary)

1. **Wave 1 — Core Mode A/B Guard, Desktop MCP & CLI (`commit 2ec95ff`)**:
   - Ported the dual-layer Mode A/B cryptographic surface guard (`foundry_manifest.json`, `scripts/foundry_mode_guard.{mjs,ps1}`) sealing `core/**`, `ui/**`, `launcher_ui/**`, `agent/**`, `cli/**`, and `verifier/**` with deterministic `sha256-sorted-path-and-bytes-v1` hashes and static air-gap enforcement.
   - Built the zero-dependency Desktop MCP stack (`agent/broker.mjs`, `service.mjs`, `mcp.mjs`, `tools.mjs`, `desktop-binding.mjs`, `workspace-tools.mjs`, `ui-bridge.mjs`), `foundry_server.mjs` bridge routes, and `cli/topogen.mjs`.
2. **Wave 2 — Generalized Live Workbench MCP & Multi-Tab Focus Routing (`12dac260`)**:
   - Added `topogen_ui_load_file` (`.obj`, `.3dm`, `.json` tiles with `subDiv 0..4`, `fitToVoxel`, `customOnly`, `clearExisting`, or Tab 2 polyline networks up to `10 MB` server-side).
   - Expanded `topogen_ui_configure` (`subDiv`, full `elastica` solver/valency `1|2|3|4|5+`/top/ground/rod radius/sides/visibility, DOM-synced `grid` sliders, spherical/cartesian `camera`), `topogen_ui_run_step` (`collapse_all`, `reset_topo`, `elastica_trace`, `elastica_reset`, `elastica_unroll`, `longitudinal_subdiv`, `ring_subdiv`, `pq_optimize`, `unroll`, `zoom_fit`), and `topogen_ui_export` (`elastica_svg`, `snapshot`).
3. **Wave 3 — Chrome-First Launch, Conversation Affinity & Bridge Protocol v2 (`b9988a1e`, resealed `2026-11-24T17:10:35Z`)**:
   - Added `agent/chrome-launcher.mjs`, `POST /api/ui-bridge/launch`, `topogen_ui_launch`, `topogen_ui_tabs`, `topogen_ui_connect`, and `mcp.mjs` L6 unsandboxed Chrome spawn fallback on `NO_HANDSHAKE`.
   - Upgraded `agent/ui-bridge.mjs` & `ui/bridge/mcp_ui_bridge.js` to **Protocol v2**: deterministic `browserKind` (`chrome` | `edge` | `webview` | `headless` | `other`), strict webview isolation, `conversationId` affinity with companion Workbench↔Launcher co-binding, fail-closed `AMBIGUOUS_CHROME_TABS`, `v1 → v2` `__reload__` auto-upgrade, reload-stable `window.name`+`sessionStorage` identity, `BroadcastChannel` duplicate-tab veto, and `0ms` `sendBeacon` disconnect.
   - Added atomic `latest-session.json` + sessionless `~/.gemini/config/mcp_config.json` binding, `>150 KB` `stagedPath` export staging, Studio-Light `#mcp-bridge-hud` pairing pill, and `47/47` automated tests (`test-mcp.mjs` 17/17, `test-cli.mjs` 12/12, `foundry_mode_guard.mjs --self-test` 4/4, `test_verifier.mjs` 14/14).
4. **Wave 4 — `BATCH-TOPOGEN-04` Hot-Reload, Drift Handshake, Fast-Fail & Complete Mode A Bridge (Certified `2026-11-25`)**:
   - Added `topogen_ui_reload` (`Cache-Control: no-store`, state-preserving `sessionStorage` snapshot, bounded readiness gate), `codeSurfaceSha256`/`toolsSha256` drift detection across `mcp.mjs`/`agent-session.json`/`topogen_inspect`, synchronous pre-queue `.obj`/`.3dm`/`.json` validation + terminal cleanup, parallel `topogen_workspace_search`, `topogen_workspace_read_batch`, atomic multi-file `topogen_workspace_edit`, per-voxel `voxelPins` & `fea_animate` playback, and `npm run test:live-desktop` (`27` MCP tools, `52/52` deterministic tests).
5. **Wave 5 — `BATCH-TOPOGEN-05` Single-Source UI Action Contract, Compute Perf & Core Test Suite (`2026-11-25`)**:
   - Introduced `agent/ui-action-contract.mjs` as the single source of truth for `UI_STEPS`, `UI_LOAD_TARGETS` (`tile` | `mesh_tile` | `network`), `UI_EXPORT_FORMATS`, and `UI_CONFIG_SECTIONS` across MCP, bridge, browser, and CLI (wiring `swap_long_ring`, `select_pq_loop`, and CLI `--target mesh_tile` / `--skeletonize`).
   - Added pure-JS `core/test_core.mjs` (`npm run test:core`) covering `mesh_skeletonizer.mjs`, `pq_subdivision.mjs`, `frame_fea_preview.mjs` (`selectGroundAnchors` fix), `elastica_curves.mjs`, and `generateCandidate`, alongside demand-driven/visibility-gated 3D render loops, `fatMaterials` leak cleanup, and TTL-cached `/api/briefs` & `/api/runs` + async static serving.

---

## 3. Traps, Failure Modes & Hard-Won Lessons

Every trap below was actually hit during live TOPOGEN sessions and caused wasted turns, misrouted edits, or broken UX before being diagnosed and engineered out:

| # | Trap / Failure Mode | What Went Wrong in Practice | Permanent Rule / Safeguard |
| :--- | :--- | :--- | :--- |
| **T1** | **Using Antigravity's `browser` webview subagent to open TOPOGEN** | Opened `foundry_launcher.html` in a cramped `677×789` internal pane, left 2 zombie webview tabs polling `/api/ui-bridge/poll` with `visible: true` for 2+ hours, and stalled 60 minutes on `UPLOAD_NEEDS_PERMISSION`. | **NEVER** use the `browser` subagent to launch TOPOGEN unless the user explicitly asks for the internal webview. Always use `topogen_ui_launch({ conversationId })` or `topogen launch --conv <id>` to open **Google Chrome**. |
| **T2** | **Spawning Chrome from sandboxed `run_command` + premature success claims** | Sandboxed shell `start` / `chrome.exe` cannot pass Windows singleton IPC to an already-running desktop Chrome session (`NO_NEW_CLIENT`), yet the agent claimed Chrome opened before verifying a tab connected. | Always launch via **unsandboxed Desktop MCP** (`topogen_ui_launch`), which has L6 fallback spawning in `mcp.mjs`. **Never** claim Chrome opened until `ok: true` returns a non-empty `clientId` and `browserKind: "chrome"`. |
| **T3** | **Multi-window `document.hasFocus()` & FIFO tab hijacking** | Across separate OS windows (Antigravity webview + Chrome), multiple tabs report `hasFocus() === true` simultaneously. FIFO routing hijacked mutations meant for Chrome into hidden webviews. | Always pass `conversationId` on every `topogen_ui_*` call. Bridge v2 never auto-routes to `webview`/`headless` tabs and fails closed with `AMBIGUOUS_CHROME_TABS` when `>=2` unpaired Chrome tabs exist — resolve with `topogen_ui_tabs` + `topogen_ui_connect`. |
| **T4** | **Ad-hoc `node -e "brokerCall(...)"` scripts & `args` vs `arguments` silent no-op** | Inline scripts passed `{ args: {...} }` instead of `{ arguments: {...} }`; `service.mjs` defaulted to `{}` and returned `{ ok: true, applied: [] }`. | **NEVER** write ad-hoc `brokerCall` shell scripts. Always use `topogen_ui_*` MCP tools or `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui <subcommand>`. *(Defensive `value.arguments ?? value.args` was also added in `service.mjs`.)* |
| **T5** | **Orphaned MCP binding on daemon restart** | Running `topogen mcp --bind` *before* restarting `topogen serve` pinned `mcp_config.json` to an ephemeral session manifest that died 11 seconds later. | `mcp_config.json` now uses **sessionless** args (`mcp.mjs --ecosystem antigravity`) and discovers the newest daemon via atomic `latest-session.json`. Never restart `serve` with `--no-bind-mcp` unless intentionally isolating a test. |
| **T6** | **Stale pre-upgrade JS in Chrome, `F5` tab ID rotation & Duplicate Tab collisions** | Restarting the daemon left old JS running in open tabs (`Unsupported UI bridge action: load_file`), `F5` rotated `clientId`, and Chrome "Duplicate Tab" cloned `sessionStorage`/`window.name`. | Protocol v2 auto-upgrades `v1` tabs via `__reload__`, preserves `tabId` + `?conv=` across `F5`, vetoes duplicate-tab IDs via `BroadcastChannel('topogen_ui_bridge_v2')`, and sends `0ms` `sendBeacon` on tab close. |
| **T7** | **Large exports exceeding the 256 KB broker frame** | `broker.mjs` enforces `LIMIT = 262144` bytes (256 KB). Exporting 256-curve `batwing.obj` Elastica SVG produced `989 KB`, blowing past the pipe frame. | Exports `> 150 KB` are automatically staged to disk by `foundry_server.mjs` and returned with `stagedPath` + metadata instead of inline text. Always check `stagedPath` when handling `topogen_ui_export` results. |
| **T8** | **Faking or hacking around unexposed UI controls in Mode A** | During live Co-Pilot (`b9988a1e`), the user asked for per-voxel `NULL` pinning, `fea_animate` deflection playback, and browser `refresh` before they were wired *(all three are now **CERTIFIED** in `BATCH-TOPOGEN-04`)*. | **Be honest and respect Mode A.** If any future UI control isn't yet wired in `agent/ui-action-contract.mjs` / `mcp_ui_bridge.js`, immediately tell the user, give the exact 1-click Chrome UI instruction (note: `topogen_ui_reload` and `F5` both preserve tab pairing), and offer to enter **Mode B** to wire it cleanly and reseal. |
| **T9** | **DOM slider desync & non-absolute paths** | Mutating JS state without dispatching both `input` and `change` events leaves HTML sliders out of sync; passing relative paths to host file tools fails permission checks. | Inside `mcp_ui_bridge.js`, always use `setInputVal` / `setCheckboxVal` (dispatches both `input` and `change`). In host agent tool calls (`read_file`, `edit_file`, `write_file`), always pass absolute paths. |
| **T10** | **Mode B scope creep / forgetting to reseal** | Entering Mode B for a one-off hack forces repeated Mode B cycles; leaving the daemon in Mode B or unresealed breaks Mode A strict-seal campaigns. | When entering Mode B, **generalize** the capability, run 4-Gate verification (`test:verifier` + `test:guard` + `test:core` + `test:mcp` + `test:cli` + live Chrome desktop check), reseal (`topogen seal --mode B --reseal`), switch back to Mode A (`topogen mode --A`), and confirm `topogen seal --mode A --verify` returns `ok: true`. |
| **T11** | **Restarting the daemon does NOT reload Antigravity's running `mcp.mjs` subprocess** | After editing `agent/tools.mjs` or `agent/mcp.mjs` in Mode B and restarting `foundry_server.mjs`, Antigravity still rejects new tool names/arguments because `tools/list` is cached in the running stdio `mcp.mjs` child process. *(Confirmed in `YYC_Robot` `BR-B07-02`.)* | Whenever `agent/tools.mjs` or `agent/mcp.mjs` changes, **refresh `topogen_fdm_foundry` in Antigravity's MCP settings** (or start a new chat) so `tools/list` reloads. Never hot-copy single agent JS files independently of `foundry_manifest.json` (`codeSurfaceSha256` parity). For pure `ui/**` or `launcher_ui/**` edits, a browser tab reload suffices. |

---

## 4. Best-Practice Operating Playbooks

### Playbook A — Cold-Start Launch & Pairing (Default)
1. Call **`topogen_ui_launch`** via Desktop MCP (preferred, unsandboxed):
   ```json
   { "conversationId": "<Conversation ID>", "surface": "workbench" }
   ```
   *(CLI fallback: `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs launch --conv <Conversation ID>`)*
2. Verify the response has `ok: true`, a non-empty `clientId`, and `browserKind: "chrome"`.
3. If `AMBIGUOUS_CHROME_TABS` is returned, call `topogen_ui_tabs({ conversationId })`, ask/identify the target tab, and call `topogen_ui_connect({ conversationId, clientId })` (or `claimFocusedChrome: true`).
4. Note the top-right **Chrome · Paired** pill in the Workbench UI — users can also click it to Pair, Unpair, or Copy Tab ID at any time.

### Playbook B — Live Co-Pilot Design Loop (Mode A)
- **Always pass `conversationId`** on `topogen_ui_inspect`, `topogen_ui_load_file`, `topogen_ui_configure`, `topogen_ui_run_step`, and `topogen_ui_export`.
- **Inspect before mutating** when a parameter is relative (e.g., `"double rod radius"` → call `topogen_ui_inspect` to read `0.015m`, then `topogen_ui_configure({ elastica: { rodRadius: 0.030 } })`).
- **Standard tile → grid → Elastica / FDM / PQ / FEA flow**:
  1. `topogen_ui_load_file({ conversationId, target: "tile", filePath: "<abs path>", subDiv: 0, fitToVoxel: true, customOnly: true })`
  2. `topogen_ui_configure({ conversationId, grid: "2x2x2", tab: "tab-topo", camera: "fit" })`
  3. `topogen_ui_run_step({ conversationId, step: "collapse_all" })`
  4. `topogen_ui_configure({ conversationId, tab: "tab-elastica", elastica: { sources: { mode: "valency", valency: 3 }, sinks: { mode: "valency", valency: 3 } } })` (or `{ mode: "top" }` / `{ mode: "ground" }`)
  5. `topogen_ui_run_step({ conversationId, step: "elastica_trace" })`
  6. `topogen_ui_export({ conversationId, format: "elastica_svg" })` → read `stagedPath` if `> 150 KB`.
- **After a grid change**, remind or re-run downstream stages (`elastica_trace`, `fdm`, `solidify`, `fea`) when the user requests it, because vertex indices change with grid resolution.

### Playbook C — Mode B Code Evolution & Reseal Discipline
Only enter Mode B when explicitly authorized to modify sealed files (`core/**`, `ui/**`, `launcher_ui/**`, `agent/**`, `cli/**`, `foundry_server.mjs`, `foundry_runner.mjs`, `run_generator.mjs`, `build_report.mjs`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `foundry_launcher.html`, `scripts/foundry_mode_guard.*`). Never break the Generator/Verifier air-gap (`verifier/**` vs generator domain).

```bash
# 1. Unlock Mode B on the active daemon
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B

# 2. Apply generalized edits & run all 5 automated verification suites
npm run test:verifier   # 14/14 analytical mechanics benchmarks
npm run test:guard      # 4/4 cryptographic seal & air-gap self-tests
npm run test:core       # Pure-JS core & geometry regression suite (core/test_core.mjs)
npm run test:mcp        # Desktop MCP + Chrome/Bridge v2 + ui-action-contract parity tests
npm run test:cli        # CLI parity tests

# 3. 4-Gate "Zero-Fake-Green" Live Desktop Check (before declaring GUI/bridge edits done)
#    Gate 1: All 5 deterministic suites above pass (via `npm run test:live-desktop`)
#    Gate 2: Real Windows WinSta0\Default Chrome visibility (non-mocked): confirm `browserKind: "chrome"`,
#            `visible: true`, and an interactive desktop window (`MainWindowHandle != 0`, Width > 800)
#    Gate 3: Real end-to-end Chrome Workbench flow (load-file -> configure -> run-step -> >150 KB stagedPath export + topogen_ui_reload)
#    Gate 4: Mode B -> Mode A cryptographic reseal & parity verify below (plus Antigravity MCP refresh if tools.mjs/mcp.mjs changed)

# 4. Reseal manifest, return to Mode A, and verify zero drift
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs seal --mode B --reseal
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --A
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs seal --mode A --verify
```

---

## 5. Bridge Coverage Status (`BATCH-TOPOGEN-04` Certified & `BATCH-TOPOGEN-05` Contract)

Previously unexposed live Co-Pilot controls from session `b9988a1e` are now **CERTIFIED** in Mode A (`BATCH-TOPOGEN-04`):
1. **Per-voxel `NULL` / tile pinning** (`Tab 2 Topo`) — **`CERTIFIED (BATCH-TOPOGEN-04)`**: Wired via `voxelPins` / `clearVoxelPins` in `topogen_ui_configure` and `--pin-voxel x,y,z=tile` in `cli/topogen.mjs`.
2. **FEA deflection animation toggle** (`Tab 6 FEA`) — **`CERTIFIED (BATCH-TOPOGEN-04)`**: Wired via `fea: { animate, deflectionScale, loadCase }` in `topogen_ui_configure` and `step: "fea_animate"` in `topogen_ui_run_step`.
3. **Remote zero-restart UI hot-reload (`topogen_ui_reload` / `step: "reload"`)** — **`CERTIFIED (BATCH-TOPOGEN-04)`**: Serves UI assets with `Cache-Control: no-store, must-revalidate`, snapshots/restores active Workbench state across cache-busting reloads, keeps `tabId` + `?conv=` paired, and awaits bounded `inspect` readiness.
4. **Single-Source 4-Layer UI Action Contract & Core Regression Suite (`BATCH-TOPOGEN-05`)**: `agent/ui-action-contract.mjs` now centralizes `UI_STEPS`, `UI_LOAD_TARGETS` (`tile` | `mesh_tile` | `network`), `UI_EXPORT_FORMATS`, and `UI_CONFIG_SECTIONS` across `agent/tools.mjs`, `agent/ui-bridge.mjs`, `ui/bridge/mcp_ui_bridge.js`, and `cli/topogen.mjs` (preventing schema drift for `swap_long_ring`, `select_pq_loop`, and `mesh_tile` / `--skeletonize`), paired with the pure-JS `core/test_core.mjs` (`npm run test:core`) regression suite.

---

## 6. Cross-Project Lessons Absorbed from `YYC_Robot` (`ALICE_ABB_FOUNDRY` / Pen Studio)

Cross-checking against `YYC_Robot/WISE_AI_ASSISTANT_MCP.md` confirmed strong architectural convergence (sessionless `mcp_config.json` + atomic `latest-session.json`, `256 KB` framed named-pipe broker, `> 150 KB` disk staging, `verbose: true` opt-in on `topogen_inspect` / `topogen_ui_inspect`, Mode A/B seals, DOM `input`+`change` parity) and drove **`BATCH-TOPOGEN-04`** (Items 1–6 **CERTIFIED**, Item 7 conditional blueprint) and **`BATCH-TOPOGEN-05`** (`agent/ui-action-contract.mjs` & `npm run test:core`):

| # | Pattern / Safeguard from `YYC_Robot` | Current TOPOGEN State |
| :--- | :--- | :--- |
| **1** | **Zero-Restart UI Hot-Reload (`pen_reload_ui`)** | **`CERTIFIED (BATCH-TOPOGEN-04)`**: `topogen_ui_reload` / `step: "reload"` with `Cache-Control: no-store, must-revalidate`, state preservation, and bounded readiness wait on `inspect`. |
| **2** | **`codeSurfaceSha256` Drift Handshake + `mcp.mjs` Reload Awareness** | **`CERTIFIED (BATCH-TOPOGEN-04)`**: `foundryVersion`, `codeSurfaceSha256`, and `toolsSha256` propagate through `initialize.serverInfo`, `agent-session.json`, and `topogen_inspect` with structured `surfaceDrift` warnings (Trap **T11**). |
| **3** | **Fast Parallel Mode B Workspace Tools** | **`CERTIFIED (BATCH-TOPOGEN-04)`**: Parallel multi-query `topogen_workspace_search` (skipping `runs/`, `video_build/`, `outputs/`), `topogen_workspace_read_batch` (`1..12` files), and atomic all-or-nothing multi-file `topogen_workspace_edit` (`1..20` edits). |
| **4** | **Synchronous Pre-Queue Validation + Terminal Failure Cleanup** | **`CERTIFIED (BATCH-TOPOGEN-04)`**: Synchronous `.3dm`/`.obj`/`.json` magic-byte/UTF-8/structure validation before queuing, unconditional `finally` lock cleanup, and `replace: true` / `discardPending` recovery. |
| **5** | **Compact State Deltas, Prompt-Cache Stability & Embedded Assistant Blueprints** | TOPOGEN enforces compact `topogen_inspect` / `topogen_ui_inspect` payloads by default (`verbose: true` opt-in). If an in-app Assistant panel is later added alongside Desktop MCP, `REV-B04-06` mandates `Auto (Tiered)` Gemini routing, `cachePrefixSha256`, `thinkingBudget: 2048`, `procNonce`, and zero-retry `HTTP 402/403` banners. |
| **6** | **4-Gate "Zero-Fake-Green" Verification + Windows `WinSta0\Default` Checks** | **`CERTIFIED (BATCH-TOPOGEN-04)`** & extended in **`BATCH-TOPOGEN-05`**: `npm run test:live-desktop` (`scripts/verify_live_desktop_mcp.mjs`) verifies all 5 deterministic suites (`test:verifier`, `test:guard`, `test:core`, `test:mcp`, `test:cli`), Win32 `WinSta0\Default` Chrome visibility, real E2E Workbench flow, and Mode A seal parity. |

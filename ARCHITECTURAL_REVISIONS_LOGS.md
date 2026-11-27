# TOPOGEN_PQM_ELASTICA_FDM_FEA_FOUNDRY — Architectural Revisions, Feature Requests & Bug Fix Log

> **TOPOGEN Foundry: Air-Gapped Generative Topology, Funicular Mechanics & Fabrication Intelligence**
> *"An air-gapped computational design foundry combining Wave Function Collapse (WFC), Force Density Method (FDM), Planar Quad (PQ) solidification, 3D Elastica rod mechanics, independent 3D Euler-Bernoulli FEA verification, and a live Google Chrome Desktop MCP Co-Pilot control plane under cryptographic Mode A / Mode B governance."*

This shared engineering ledger tracks architectural revisions (`REV-B*-*`), feature requests (`FR-B*-*`), and bug reports (`BR-B*-*`) across **`TOPOGEN_PQM_ELASTICA_FDM_FEA_FOUNDRY`** (`TOPOGEN_FDM_Foundry/{core, ui, launcher_ui, agent, cli, verifier, workers, schemas, scripts}`).

- **Canonical Location**: [`ARCHITECTURAL_REVISIONS_LOGS.md`](./ARCHITECTURAL_REVISIONS_LOGS.md) *(Mode A-mutable root engineering ledger)*.
- **Related Ledgers & Guides**:
  - [`AGENTS.md`](./AGENTS.md) — Cold-start AI assistant guardrails, Chrome-first launch rules, Mode A / Mode B governance, and Generator $\leftrightarrow$ Verifier air-gap contract.
  - [`WISE_AI_ASSISTANT_MCP.md`](./WISE_AI_ASSISTANT_MCP.md) — Desktop MCP architecture, traps `T1`–`T11`, live Co-Pilot playbooks, and cross-project lessons synced with `YYC_Robot` (`ALICE_ABB_FOUNDRY` / Pen Studio).
  - [`TOPOGEN_FDM_Foundry/foundry_manifest.json`](./TOPOGEN_FDM_Foundry/foundry_manifest.json) & [`TOPOGEN_FDM_Foundry/scripts/foundry_mode_guard.mjs`](./TOPOGEN_FDM_Foundry/scripts/foundry_mode_guard.mjs) — Deterministic `sha256-sorted-path-and-bytes-v1` Mode A/B surface seal (`58` code files + `8` air-gapped verifier/schema files).
  - [`TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md`](./TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md) & [`TOPOGEN_FDM_Foundry/README.md`](./TOPOGEN_FDM_Foundry/README.md) — Zero-build-step ES module map and verified structural benchmarks.

---

## 0. Foundry Baseline History (`TOPOGEN_FDM_Foundry` Foundation)

| Milestone / Baseline | Date | Scope & Architectural Summary | Primary Subsystems | Status |
| :--- | :---: | :--- | :--- | :---: |
| **Baseline `0.1` (`31579c7` $\rightarrow$ `2da3c7b`)** | `2026-11-20` – `2026-11-22` | **Air-Gapped WFC $\times$ FDM $\times$ All-Quad PQ $\times$ 3D Euler-Bernoulli FEA Foundation**: Bisector-stitched watertight quad-dominant tubular solidifier, parent-propagated face-loop/ring colors across Catmull-Clark & longitudinal subdivisions, 2D unrolled laser-sheet `.svg` nesting, neutral `wfc-fdm-topology/v1` interchange contract, and independent `14/14` analytical mechanics FEA & manifold verifier (`pilot_brief.json` `9.42 kg` / `5.31x` load-to-mass champion). | `TOPOGEN_FDM_Foundry/{core/*, verifier/*, schemas/*, briefs/*, run_generator.mjs}` | **`CERTIFIED`** |
| **Baseline `0.2` (`a158d2e` $\rightarrow$ `f6d3680`)** | `2026-11-22` | **Zero-Build-Step ES Module Decomposition & Warm `worker_threads` Campaign Engine**: Decomposed generator core (`9` pure-JS modules in `core/`), Workbench UI (`ui/`), and Campaign Launcher (`launcher_ui/`) into `130–1,285`-line zero-build ES modules; added warm air-gapped `workers/{generator_worker,verifier_worker}.mjs` pools (`~70 ms` `/api/quick-eval`, `~1.4 s` `lightning`, `~4.5 s` `interactive` campaigns). | `TOPOGEN_FDM_Foundry/{core/*, ui/*, launcher_ui/*, workers/*, foundry_server.mjs, foundry_runner.mjs}` | **`CERTIFIED`** |
| **Baseline `0.3` (`32fc0ea` $\rightarrow$ `f661fed`)** | `2026-11-23` – `2026-11-24` | **`TOPOGEN_FDM_Foundry` Unification, 3D Elastica Tubular Rods, `.3dm` Curve Import & Studio-Light 7-Tab Workbench**: Renamed to `TOPOGEN_FDM_Foundry` / `index_TOPOGEN_PQM_ELASTICA_FDM.html`; added A* / valency / top-ground 3D Elastica tubular rod solver, DER straight-strip unrolling, coupled Elastica FEA, `.3dm` curve tile import, unified Studio-Light Display HUD, and Elastica V1/Source/Sink anchor isolation. | `TOPOGEN_FDM_Foundry/{core/elastica_curves.mjs, ui/tabs/tab_elastica.js, ui/display/*, index_TOPOGEN_PQM_ELASTICA_FDM.html}` | **`CERTIFIED`** |

---

## 1. Batch 1 (`BATCH-TOPOGEN-01`) — Dual-Mode Cryptographic Surface Guard, Named-Pipe Desktop MCP Stack & Unified Foundry CLI *(Certified `2ec95ff`)*

- **Batch ID**: `BATCH-TOPOGEN-01`
- **Date Certified**: `2026-11-24` (`commit 2ec95ff`, conversations `b066bad3`, `07f862b1`)
- **Target Execution Mode**: **Mode B** (`foundry_mode_guard.mjs --mode B --reseal` $\rightarrow$ `--mode A --verify`)
- **Mandatory Global Foundry Invariants**:
  1. **Strict Generator / Verifier Air-Gap**: Generator-domain files (`core/**`, `ui/**`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `run_generator.mjs`) and Verifier-domain files (`verifier/**`) share zero cross-imports (`0` violations enforced statically by `foundry_mode_guard.mjs`) and exchange data strictly via neutral on-disk artifacts (`schemas/interchange_contract.md`).
  2. **Mode A Default Lock (`allowModeB: false`)**: Standard sessions expose headless Foundry evaluation, campaign orchestration, brief authoring, and live 3D Workbench UI Co-Pilot tools while blocking `topogen_workspace_edit`, `topogen_workspace_run_command`, and `topogen_seal_check({ reseal: true })`.
  3. **Ecosystem Purity (`antigravity` | `codex`)**: Session manifests, named-pipe broker tokens, receipts (`agent-receipts.jsonl`), and Desktop MCP bindings enforce timing-safe 32-byte token + ecosystem verification.

### 1.1 Summary Table of Batch 1 (`BATCH-TOPOGEN-01`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`REV-B01-01`<br>`FR-B01-01` | **Governance + Cryptographic Guard** | `TOPOGEN_FDM_Foundry/{foundry_manifest.json, scripts/foundry_mode_guard.mjs, scripts/foundry_mode_guard.ps1}` | **Dual-Layer Mode A / Mode B Cryptographic Seal & Static Air-Gap Auditor**: Deterministic `sha256-sorted-path-and-bytes-v1` sealing over generator/runtime code and `verifier/**`, fail-closed exit code `2` on Mode A `--reseal`, automatic `test_verifier.mjs` benchmark gate on Mode B `--reseal`, and 4-part adversarial `--self-test`. | `foundry_mode_guard.mjs --self-test` (`4/4` PASS), `test_verifier.mjs` (`14/14` PASS), Mode A `--verify` (`0` offending files, `0` air-gap cross-imports). | **`CERTIFIED (2ec95ff)`** |
| **`Step 2`**<br>`REV-B01-02`<br>`FR-B01-02` | **Desktop MCP + Unified CLI** | `TOPOGEN_FDM_Foundry/agent/{broker.mjs, service.mjs, mcp.mjs, tools.mjs, desktop-binding.mjs, workspace-tools.mjs, ui-bridge.mjs}`, `cli/topogen.{mjs,cmd}`, `foundry_server.mjs` | **Zero-Dependency Named-Pipe Desktop MCP Stack & `topogen` CLI**: `256 KB` framed IPC broker, idempotent `requestId` receipt ledger, confined Mode B workspace tools (symlink/credential/`.git` guards + secret redaction), cold-start daemon auto-launch (`--no-browser --mcp-auto`), and full CLI parity (`topogen.{mjs,cmd}`). | `agent/test-mcp.mjs`, `cli/test-cli.mjs`, cold-start stdio `initialize` / `tools/list` / `tools/call` PASS. | **`CERTIFIED (2ec95ff)`** |

---

## 2. Batch 2 (`BATCH-TOPOGEN-02`) — Generalized Live 3D Workbench Co-Pilot Bridge, `.obj`/`.3dm`/`.json` Ingestion & Elastica/PQ/FEA Controls *(Certified `12dac260`)*

- **Batch ID**: `BATCH-TOPOGEN-02`
- **Date Certified**: `2026-11-24` (conversation `12dac260`)
- **Target Execution Mode**: **Mode B** (`foundry_mode_guard.mjs --mode B --reseal` $\rightarrow$ `--mode A --verify`)

### 2.1 Summary Table of Batch 2 (`BATCH-TOPOGEN-02`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`FR-B02-01`<br>`REV-B02-01` | **Live UI Bridge Generalization** | `TOPOGEN_FDM_Foundry/agent/tools.mjs`, `foundry_server.mjs`, `ui/bridge/mcp_ui_bridge.js`, `ui/tabs/{tab1_tiles,tab3_fdm,tab4_pq_mesh,tab5_fea,tab_elastica}.js`, `cli/topogen.mjs` | **Full Live Workbench File Load, Elastica/PQ/FDM Configuration & Export**: Added `topogen_ui_load_file` (`<= 10 MB` server-side `.obj`, `.3dm`, `.json` tiles with Catmull-Clark `subDiv 0..4`, `fitToVoxel`, `customOnly`, `clearExisting`, or Tab 2 polyline networks); expanded `topogen_ui_configure` (valency `1..5+` / top / ground Elastica sources & sinks, rod radius/sides, spherical/cartesian camera, grid), `topogen_ui_run_step` (`collapse_all`, `elastica_trace`, `elastica_unroll`, `pq_optimize`, `unroll`, `zoom_fit`), and `topogen_ui_export` (`elastica_svg`, `snapshot`). | Live Workbench E2E (`batwing.obj` tile load $\rightarrow$ grid $\rightarrow$ `collapse_all` $\rightarrow$ `elastica_trace` $\rightarrow$ `elastica_svg` export) + `test-mcp.mjs` & `test-cli.mjs` PASS. | **`CERTIFIED`** |
| **`Step 2`**<br>`BR-B02-01`<br>`BR-B02-02` | **DOM Sync & Broker Resilience** | `TOPOGEN_FDM_Foundry/ui/bridge/mcp_ui_bridge.js`, `agent/service.mjs` | **DOM `input`+`change` Parity & Defensive `arguments ?? args` Normalization (`T4`, `T9`)**: Enforced `setInputVal` / `setCheckboxVal` (`input` + `change` bubbling events) so HTML sliders never desync from JS state, and normalized `value.arguments ?? value.args` in `service.mjs` so malformed caller payloads cannot silently no-op. | `test-mcp.mjs` slider/configure state readback assertions PASS. | **`CERTIFIED`** |

---

## 3. Batch 3 (`BATCH-TOPOGEN-03`) — Chrome-First Launch, Conversation-to-Tab Affinity & UI Bridge Protocol v2 *(Certified `b9988a1e` — Resealed `2026-11-24T17:10:35Z`)*

- **Batch ID**: `BATCH-TOPOGEN-03`
- **Date Certified**: `2026-11-24` (`2026-11-24T17:10:35Z`, conversation `b9988a1e`, `foundry_manifest.json` `semanticVersion: "2.0.0"`, `codeSurfaceSha256: 9f304e63893ee3349257cf6e3fafad8e307062d2016594a22f4432311f0027af` across `55` files, `verifierSurfaceSha256: 27120364a9b23f390fda7d579b23bcac10ca7e350cdab8cf95d88053697181b2` across `8` files)
- **Target Execution Mode**: **Mode B** (`foundry_mode_guard.mjs --mode B --reseal` $\rightarrow$ `--mode A --verify`)
- **Note**: Certified changes currently reside in the clean Mode A-verified working tree on top of `2ec95ff` pending git commit.

### 3.1 Summary Table of Batch 3 (`BATCH-TOPOGEN-03`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`REV-B03-01`<br>`FR-B03-01`<br>`BR-B03-01`<br>`BR-B03-02` | **Chrome-First Launch + Unsandboxed Fallback** | `TOPOGEN_FDM_Foundry/agent/{chrome-launcher.mjs, mcp.mjs, tools.mjs}`, `foundry_server.mjs`, `cli/topogen.mjs` | **Deterministic Desktop Google Chrome Launch & `mcp.mjs` L6 Unsandboxed Spawn Fallback (`T1`, `T2`)**: Added `chrome-launcher.mjs` (Windows registry/standard-path/PATH discovery), `POST /api/ui-bridge/launch`, `topogen_ui_launch` (`25` total MCP tools, `mcp.mjs` `v2.1.0`), `topogen launch --conv <id>`, and automatic `mcp.mjs` L6 direct Chrome spawn when a sandboxed daemon hits `NO_HANDSHAKE`. | `agent/test-mcp.mjs` (`17/17` PASS) & `cli/test-cli.mjs` (`12/12` PASS) including L6 `NO_HANDSHAKE` recovery & handshake verification. | **`CERTIFIED (Resealed)`** |
| **`Step 2`**<br>`REV-B03-02`<br>`BR-B03-03`<br>`BR-B03-04` | **Bridge Protocol v2 & Multi-Tab Safety** | `TOPOGEN_FDM_Foundry/agent/ui-bridge.mjs`, `ui/bridge/mcp_ui_bridge.js`, `ui/styles/workbench.css`, `launcher_ui/{launcher.css, main.js}`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `foundry_launcher.html` | **UI Bridge Protocol v2, Webview Isolation & Conversation Affinity (`T3`, `T6`)**: Added `browserKind` classifier (`chrome`/`edge`/`webview`/`headless`/`other`) blocking internal webview poll hijacking; `conversationId` affinity + companion Workbench $\leftrightarrow$ Launcher co-binding; fail-closed `AMBIGUOUS_CHROME_TABS` + `topogen_ui_tabs` / `topogen_ui_connect`; `v1 -> v2` `__reload__` auto-upgrade; reload-stable `window.name`+`sessionStorage` IDs; `BroadcastChannel('topogen_ui_bridge_v2')` duplicate-tab veto; `0 ms` `sendBeacon` disconnect; and Studio-Light `#mcp-bridge-hud` pairing pill. | `test-mcp.mjs` E2E multi-tab contention, webview isolation, `F5` reload vs. Duplicate Tab veto, `0 ms` beacon disconnect, and `v1 -> v2` `__reload__` tests (`17/17` PASS). | **`CERTIFIED (Resealed)`** |
| **`Step 3`**<br>`REV-B03-03`<br>`BR-B03-05`<br>`BR-B03-06` | **Sessionless MCP Continuity & Large-Export Staging** | `TOPOGEN_FDM_Foundry/agent/{desktop-binding.mjs, mcp.mjs}`, `foundry_server.mjs`, `cli/topogen.mjs` | **Sessionless `mcp_config.json` + Atomic `latest-session.json` & `> 150 KB` Outbound `stagedPath` (`T5`, `T7`)**: Switched `~/.gemini/config/mcp_config.json` to sessionless args (`mcp.mjs --ecosystem antigravity`) backed by atomic `latest-session.json` pointer; added automatic `> 150 KB` disk staging (`stagedPath`) in `foundry_server.mjs` so multi-hundred-KB Elastica/unroll SVG exports never overflow the `256 KB` named-pipe broker frame. | `47/47` total suite PASS (`14/14` verifier, `4/4` guard, `17/17` MCP, `12/12` CLI) + `seal --mode A --verify` (`ok: true`, `0` offending files). | **`CERTIFIED (Resealed)`** |

---

## 4. Batch 4 (`BATCH-TOPOGEN-04`) — MCP & AI-Assistance Architectural Revisions from Live Co-Pilot & `YYC_Robot` Cross-Project Review *(IMPLEMENTED & SEALED — Mode A Certified; Item 7 Blueprint)*

- **Batch ID**: `BATCH-TOPOGEN-04`
- **Date Opened**: `2026-11-25`
- **Date Sealed**: `2026-11-25T10:42:22Z`
- **Status**: **`CERTIFIED (Items 1–6 Implemented, Resealed & Locked in Mode A; Item 7 OPEN Blueprint)`**
- **Certified Seal Receipt (`foundry_manifest.json`, Mode A Verified)**:
  - `codeSurfaceSha256`: `7607d599faf3d043f975f442c48c952c72149df697d335eded36cf582dcf0a1c` (`55` sealed files)
  - `verifierSurfaceSha256`: `27120364a9b23f390fda7d579b23bcac10ca7e350cdab8cf95d88053697181b2` (`8` sealed files — unchanged)
  - `airGapPassed`: `true` (`0` generator $\leftrightarrow$ verifier cross-imports, `0` offending files)
  - **Deterministic Verification (`52/52` PASS)**: `test:verifier` (`14/14`), `test:guard` (`4/4` self-test + clean verify), `test:mcp` (`22/22`), `test:cli` (`12/12`).
  - **Live Desktop Harness (`npm run test:live-desktop`)**: Gate 1 PASS (`4/4` deterministic suites); Gate 2 returned `NO_HANDSHAKE` from inside the sandboxed agent terminal (expected Trap T6 sandbox boundary — run `npm run test:live-desktop` from an unsandboxed Windows desktop PowerShell to exercise live Chrome Gates 2–3).
  - **Operator Action Required (Trap T11)**: Refresh `topogen_fdm_foundry` in Antigravity MCP settings (or start a new chat) so Antigravity's stdio `agent/mcp.mjs` reloads the updated `toolDefinitions` and `codeSurfaceSha256` digest.
- **Source Reviews & Evidence**:
  - **Cross-Project MCP & AI-Assistance Sync (`777177d2-ec79-4ea9-b0f7-f7a20cdf1b07`)**: Comparative architectural audit against `YYC_Robot` (`ALICE_ABB_FOUNDRY` / Pen Studio [`WISE_AI_ASSISTANT_MCP.md`](file:///C:/Users/shajay.b/Documents/REPOS/CODEX_REPOS/PERSONAL/YYC_Robot/WISE_AI_ASSISTANT_MCP.md) & [`ARCHITECTURAL_REVISIONS_LOGS.md`](file:///C:/Users/shajay.b/Documents/REPOS/CODEX_REPOS/PERSONAL/YYC_Robot/alice-3.0-antigravity-abb/common/docs/ARCHITECTURAL_REVISIONS_LOGS.md) Batches 6–8).
  - **Live Co-Pilot Session Post-Mortem (`b9988a1e`)**: Unexposed Mode A Workbench controls documented honestly under Trap `T8` and Section 5 of [`WISE_AI_ASSISTANT_MCP.md`](./WISE_AI_ASSISTANT_MCP.md).
- **Target Execution Mode**: **Mode B** (`node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B` $\rightarrow$ 4-Gate Zero-Fake-Green Verification $\rightarrow$ `seal --mode B --reseal` $\rightarrow$ `mode --A` $\rightarrow$ `seal --mode A --verify`, followed by refreshing `topogen_fdm_foundry` in Antigravity MCP settings because `agent/tools.mjs` and `agent/mcp.mjs` schemas change).

---

### 4.1 Item 1: Zero-Restart Browser UI Hot-Reload (`topogen_ui_reload` / `step: "reload"`), `Cache-Control: no-store` Asset Serving & State-Preserving Readiness Gate (`REV-B04-01` / `FR-B04-01` / `BR-B04-01`)

- **Priority / Sequence**: **`P0` (`Step 1` — Live UI Iteration & Cache Hygiene)**
- **Added**: `2026-11-25`
- **Status**: **`CERTIFIED (Mode A Sealed)`**
- **Affected Subsystems**:
  - `TOPOGEN_FDM_Foundry/agent/tools.mjs` (`toolDefinitions`, `toolOperations`, `validateTool`)
  - `TOPOGEN_FDM_Foundry/foundry_server.mjs` (static file `Cache-Control` headers + `ui.reload` / `ui.run_step` handler)
  - `TOPOGEN_FDM_Foundry/agent/ui-bridge.mjs` (`UI_ACTIONS`, bounded post-reload readiness waiter)
  - `TOPOGEN_FDM_Foundry/ui/bridge/mcp_ui_bridge.js` (`__reload__` / `reload` handler + `sessionStorage` state snapshot/restore)
  - `TOPOGEN_FDM_Foundry/cli/topogen.mjs` (`topogen ui reload` / `topogen ui step --step reload`)
  - `TOPOGEN_FDM_Foundry/agent/test-mcp.mjs` & `cli/test-cli.mjs`

#### Problem & Root Causes (`BR-B04-01`)
1. **No Public Remote Tab Reload in Mode A/B (`WISE_AI_ASSISTANT_MCP.md` Section 5 #3)**: While `agent/ui-bridge.mjs` sends an internal `__reload__` task to upgrade stale `bridgeVersion: 1` tabs, agents cannot trigger a clean browser reload via `topogen_ui_run_step` or a dedicated MCP tool after editing `ui/**` or `launcher_ui/**` modules in Mode B (forcing manual `F5` in Chrome or spawning duplicate tabs via `newTab: true`).
2. **Static Browser Module/CSS Caching**: Without `Cache-Control: no-store, must-revalidate` on local HTML/JS/CSS routes in `foundry_server.mjs`, Chromium's memory/disk cache can serve stale ES modules (`ui/tabs/*.js`, `workbench.css`) across soft reloads.
3. **Post-Reload Readiness Race & State Loss**: Immediately dispatching a follow-up `topogen_ui_configure` or `topogen_ui_inspect` while Chrome is mid-reload races window teardown/bootstrap unless the server awaits the reconnected tab's post-reload poll + readiness handshake; furthermore, a bare reload wipes the user's active custom tiles, grid resolution, FDM parameters, and Elastica configuration unless snapshotted.

#### Required Architectural Revision & Feature Scope (`REV-B04-01` & `FR-B04-01`)
1. **Zero-Stale Static Serving**: Serve all Workbench and Launcher HTML, ES module `.js`/`.mjs`, and `.css` assets from `foundry_server.mjs` with `Cache-Control: no-store, must-revalidate` (`Pragma: no-cache`, `Expires: 0`).
2. **State-Preserving `topogen_ui_reload` (and `topogen_ui_run_step({ step: "reload" })`) Across All 4 Bridge Layers**:
   - Accept `{ conversationId, clientId, preserveState = true, hardReload = true, waitMs = 10000 }`.
   - When `preserveState: true`, `mcp_ui_bridge.js` serializes a bounded JSON snapshot of the active Workbench session (`activeTab`, `preset`, `grid`, loaded custom tiles, `fdm` settings, `elastica` settings, `pq` settings, and `camera` orbit) into `sessionStorage` keyed by `tabId` before calling cache-busting navigation/reload, and restores it automatically upon `WFC_WORKBENCH` initialization while preserving `tabId` and `?conv=<conversationId>`.
3. **Bounded Post-Reload Readiness Gate**: `ui-bridge.mjs` awaits the reloaded `clientId` re-entering `/api/ui-bridge/poll` with `bridgeVersion >= 2` and verifies `inspect` readiness (`ok === true`) within `waitMs` before resolving the MCP tool call (`0` race conditions on immediate next-turn mutations).

---

### 4.2 Item 2: `codeSurfaceSha256` / `toolsSha256` Drift Handshake Across `mcp.mjs`, `agent-session.json` & `topogen_inspect` (`REV-B04-02` / `BR-B04-02`)

- **Priority / Sequence**: **`P0` (`Step 2` — MCP Subprocess & Manifest Parity)**
- **Added**: `2026-11-25`
- **Status**: **`CERTIFIED (Mode A Sealed)`**
- **Affected Subsystems**:
  - `TOPOGEN_FDM_Foundry/agent/{mcp.mjs, service.mjs, tools.mjs}`
  - `TOPOGEN_FDM_Foundry/foundry_server.mjs` (`foundry.inspect`)
  - `TOPOGEN_FDM_Foundry/scripts/foundry_mode_guard.mjs`
  - `TOPOGEN_FDM_Foundry/agent/test-mcp.mjs`

#### Problem & Root Causes (`BR-B04-02` / Trap `T11`)
1. **Long-Lived Stdio `mcp.mjs` Subprocess Stale Schema Cache**: Antigravity spawns `agent/mcp.mjs` once at chat/server startup. Restarting `foundry_server.mjs` (`topogen serve`) after Mode B edits to `agent/tools.mjs` or `agent/mcp.mjs` restarts only the named-pipe broker—leaving Antigravity's running `mcp.mjs` child process validating against stale `toolDefinitions` / `validateTool` schemas (`Unexpected tool argument` or missing tools).
2. **No Runtime Hash Handshake Between `mcp.mjs` and Daemon**: `mcp.mjs` `initialize` currently returns `serverInfo: { name: 'topogen_fdm_foundry', version: '2.1.0' }`, and `agent-session.json` does not record `foundryVersion`, `codeSurfaceSha256`, or `toolsSha256`. Neither `mcp.mjs` nor `topogen_inspect` currently warns when the running stdio `mcp.mjs` process, the running `:8787` daemon, and the on-disk `foundry_manifest.json` have drifted apart.

#### Required Architectural Revision (`REV-B04-02`)
1. **Manifest & Tool-Schema Digest Propagation**: Compute deterministic `toolsSha256` (over `toolDefinitions`) in `agent/tools.mjs` and read `foundryVersion` (`semanticVersion`) + `codeSurfaceSha256` from `foundry_manifest.json`. Include all three digests in:
   - `mcp.mjs` `initialize.serverInfo` (`{ name, version, foundryVersion, codeSurfaceSha256, toolsSha256 }`),
   - `agent-session.json` written by `agent/service.mjs`, and
   - `topogen_inspect` (`manifestSeal` + `mcp` status block in `foundry_server.mjs`).
2. **Explicit `surfaceDrift` Detection & Actionable Remediation**: In `mcp.mjs` (on `tools/call` responses when drift exists, and directly on `topogen_inspect`), compare `mcp.mjs`'s in-memory `{ toolsSha256, codeSurfaceSha256 }` against both the active daemon's `agent-session.json` and on-disk `foundry_manifest.json`. Emit a structured `surfaceDrift` warning with the exact remediation (`"Refresh topogen_fdm_foundry in Antigravity MCP settings"` vs. `"Restart foundry_server.mjs"` vs. `"Reseal foundry_manifest.json in Mode B"`).

---

### 4.3 Item 3: Synchronous Pre-Queue Geometry/Brief Validation, Terminal-Failure Cleanup & `replace: true` / Discard Semantics (`REV-B04-03` / `BR-B04-03`)

- **Priority / Sequence**: **`P0` (`Step 3` — Bridge Deadlock Immunity & Fast-Fail Diagnostics)**
- **Added**: `2026-11-25`
- **Status**: **`CERTIFIED (Mode A Sealed)`**
- **Affected Subsystems**:
  - `TOPOGEN_FDM_Foundry/foundry_server.mjs` (`ui.load_file`, `briefs.save`)
  - `TOPOGEN_FDM_Foundry/agent/{ui-bridge.mjs, tools.mjs}`
  - `TOPOGEN_FDM_Foundry/ui/bridge/mcp_ui_bridge.js` (`load_file` error recovery)
  - `TOPOGEN_FDM_Foundry/agent/test-mcp.mjs`

#### Problem & Root Causes (`BR-B04-03`)
1. **Deferred Browser-Side Parse Failures**: `topogen_ui_load_file` currently checks argument shapes/lengths in `tools.mjs` (`filePath` `<= 10 MB`, inline `content`/`contentBase64` `<= 200 KB`) and forwards raw payloads into `ui-bridge.mjs` (`queue`, `pending`, `busyClients`), deferring actual `.obj` / `.3dm` / `.json` format validation to browser-side parsers—where corrupt binaries, wrong extensions, or empty geometry fail late or with opaque DOM errors.
2. **Stale Pending / `busyClients` Lock Risk**: As demonstrated in `YYC_Robot` (`BR-B07-01` 10-minute `pendingImage` deadlock), any multi-step or queued UI import state that fails terminally without clearing server/client pending locks—or without `replace: true` / discard recovery—blocks subsequent MCP mutations.

#### Required Architectural Revision (`REV-B04-03`)
1. **Synchronous Server-Side Pre-Queue File Validation**: Before enqueuing `ui.load_file` onto `ui-bridge.mjs`:
   - Reject symlinks, UNC/network paths, NUL bytes in text formats, and `0`-byte files.
   - Verify format magic/structure synchronously: `.3dm` (`"3D Geometry File Format "` 24-byte OpenNURBS header + non-truncated size), `.obj` (valid UTF-8 with `>= 1` `v ` vertex and `>= 1` `f ` / `l ` element), and `.json` (valid UTF-8 JSON parse + expected topology/tile/polyline keys), returning rich `{ fileName, ext, bytes, headerHex, reason }` diagnostics on failure with `0` browser queue pollution.
2. **Guaranteed `finally` Cleanup & `replace: true` / `discardPending` Semantics**: Audit `ui-bridge.mjs` (`busyClients`, `pending`, `queue`) and `mcp_ui_bridge.js` so every timeout, disconnect, or renderer throw unconditionally releases busy/pending locks, and support `replace: true` (default `true` for superseding stale pending file loads) plus explicit `discardPending: true` recovery.

---

### 4.4 Item 4: Fast Parallel Mode B Workspace Tools — Multi-Query `topogen_workspace_search`, `topogen_workspace_read_batch` & Atomic Multi-File `topogen_workspace_edit` (`REV-B04-04` / `FR-B04-02`)

- **Priority / Sequence**: **`P1` (`Step 4` — Mode B Engineering Velocity & Atomicity)**
- **Added**: `2026-11-25`
- **Status**: **`CERTIFIED (Mode A Sealed)`**
- **Affected Subsystems**:
  - `TOPOGEN_FDM_Foundry/agent/{workspace-tools.mjs, tools.mjs, service.mjs}`
  - `TOPOGEN_FDM_Foundry/agent/test-mcp.mjs`

#### Problem & Root Causes (`FR-B04-02`)
1. **Sequential Single-Query Search Scanning Run Artifacts**: `agent/workspace-tools.mjs` currently runs single-query synchronous `fs.readdirSync` walks where `SKIP_DIRS` (`['.git', 'node_modules', 'build', 'dist', '__pycache__']`) omits `runs`, `video_build`, and `outputs`—wasting file budget (`MAX_FILES = 1500`, `MAX_SEARCH_FILE_BYTES = 2 MB`) on generated `.topology.json`, `.mesh.obj`, and `.verdict.json` campaign artifacts.
2. **Multi-Turn Read/Edit Overhead & Partial Multi-File Edits**: Extending any MCP UI action requires reading and editing 4 coordinated files (`agent/tools.mjs`, `foundry_server.mjs`, `agent/ui-bridge.mjs`, `ui/bridge/mcp_ui_bridge.js`). Single-file `topogen_workspace_read` and single-file `topogen_workspace_edit` require multiple serial broker round-trips and can leave half-applied edits if file #3 fails target matching.

#### Required Architectural Revision (`REV-B04-04` & `FR-B04-02`)
1. **Parallel Multi-Query `topogen_workspace_search`**: Accept `queries: string[]` (`1..8`, backward-compatible with `query: string`) plus `include` / `exclude` globs; scan candidate files concurrently (bounded async pool) while skipping noisy artifact directories (`runs`, `video_build`, `outputs`, `.rsi_snapshots`) and `> 1 MB` JSON/OBJ data dumps by default unless `path` explicitly targets them.
2. **Batched `topogen_workspace_read_batch`**: Add `topogen_workspace_read_batch({ files: [{ path, startLine?, endLine? }] })` (`1..12` files) executing confined, secret-redacted reads in one broker round-trip within the `256 KB` frame cap (or `stagedPath` fallback).
3. **Atomic All-or-Nothing Multi-File `topogen_workspace_edit`**: Extend `topogen_workspace_edit` to accept `edits: [{ path, target?, replacement?, content?, replaceAll? }]` (`1..20`, backward-compatible with single-file args). Validate **all** paths, symlink/credential/`.git` guards, `target` match uniqueness, `256 KB` size caps, and Generator $\leftrightarrow$ Verifier air-gap cross-import rules in memory **before** writing per-file `.tmp` files and committing renames.

---

### 4.5 Item 5: Complete Mode A Live Co-Pilot Workbench Controls — Per-Voxel `TILE_NULL` / Tile Pinning & `fea_animate` Deflection Playback (`FR-B04-03` / `FR-B04-04`)

- **Priority / Sequence**: **`P1` (`Step 5` — Complete 7-Tab Live Workbench Coverage)**
- **Added**: `2026-11-25`
- **Status**: **`CERTIFIED (Mode A Sealed)`**
- **Affected Subsystems**:
  - `TOPOGEN_FDM_Foundry/agent/tools.mjs` (`topogen_ui_configure`, `topogen_ui_run_step`)
  - `TOPOGEN_FDM_Foundry/ui/bridge/mcp_ui_bridge.js` & `ui/tabs/{tab2_topo.js, tab5_fea.js}`
  - `TOPOGEN_FDM_Foundry/cli/topogen.mjs` (`topogen ui configure`, `topogen ui step`)
  - `TOPOGEN_FDM_Foundry/agent/test-mcp.mjs` & `cli/test-cli.mjs`

#### Problem (`WISE_AI_ASSISTANT_MCP.md` Section 5 #1 & #2)
During live Co-Pilot sessions (`b9988a1e`), two interactive Workbench features had to be delegated manually to the user in Chrome under Trap `T8` (Honest Mode A Reporting):
1. **Per-Voxel `NULL` / Tile ID Pinning (`Tab 2 Topo`)**: `topogen_ui_configure` cannot yet pin specific `(x, y, z)` voxel cells (e.g., hollowing an atrium courtyard or pinning corner support tiles) prior to `wfc` / `collapse_all`.
2. **FEA Deflection Animation Playback (`Tab 5 FEA`)**: `#btn-fea-animate` (`▶ Animate Deflection`) and deflection exaggeration scale cannot yet be toggled or configured via `topogen_ui_run_step` / `topogen_ui_configure`.

#### Required Feature Scope (`FR-B04-03` & `FR-B04-04`)
1. **Declarative Voxel Pinning (`FR-B04-03`)**: Add `voxelPins: [{ x, y, z, tile: "null" | <tileId> }]` and `clearVoxelPins: boolean` to `topogen_ui_configure` (plus `--pin-voxel x,y,z=tile` in `cli/topogen.mjs`), updating `appState` voxel masks and Tab 2 UI readouts cleanly before `collapse_all`.
2. **Live FEA Deflection Playback (`FR-B04-04`)**: Add `fea: { animate?: boolean, deflectionScale?: number, loadCase?: string }` to `topogen_ui_configure` and `fea_animate` (`start` / `stop` / `toggle`) to `topogen_ui_run_step`, syncing `#btn-fea-animate` button state and `topogen_ui_inspect` telemetry (`fea.animating`).

---

### 4.6 Item 6: Automated `WinSta0\Default` Interactive Desktop Visibility & 4-Gate "Zero-Fake-Green" Verification Harness (`REV-B04-05` / `BR-B04-04`)

- **Priority / Sequence**: **`P1` (`Step 6` — Real-Environment GUI & WebGL Verification)**
- **Added**: `2026-11-25`
- **Status**: **`CERTIFIED (Implemented & Mode A Sealed; Gate 2–3 requires unsandboxed Windows desktop PowerShell)`**
- **Affected Subsystems**:
  - `TOPOGEN_FDM_Foundry/agent/chrome-launcher.mjs`
  - `TOPOGEN_FDM_Foundry/scripts/verify_live_desktop_mcp.mjs` *(new)*
  - `package.json` (`npm run test:live-desktop`)

#### Problem (`BR-B04-04`)
TOPOGEN's `47/47` automated suite validates Bridge v2 routing via `TOPOGEN_MOCK_CHROME_CMD` and `createSimulatedBrowserTab()` (`agent/test-mcp.mjs`). Cross-project post-mortems in `YYC_Robot` (`BR-B06-04`) proved that mocked tests pass even when Windows spawns GUI processes inside a non-interactive window station (`MainWindowHandle == 0`, `0x0` Chromium message windows, or suspended DWM/WebGL `requestAnimationFrame` loops).

#### Required Architectural Revision (`REV-B04-05`)
1. **Interactive `WinSta0\Default` Spawn Hardening**: Ensure `agent/chrome-launcher.mjs` on Windows verifies interactive desktop attachment (with out-of-proc Explorer / `Win32_Process.Create` fallback when invoked from detached background service trees) while preserving `TOPOGEN_MOCK_CHROME_CMD` / headless isolation for CI unit tests.
2. **Executable 4-Gate "Zero-Fake-Green" Script (`scripts/verify_live_desktop_mcp.mjs`)**: Automate all 4 release gates in one opt-in desktop command (`npm run test:live-desktop`):
   - **Gate 1**: Run all 4 deterministic suites (`test:verifier`, `test:guard`, `test:mcp`, `test:cli`).
   - **Gate 2**: Launch real Chrome via `topogen_ui_launch` and verify Win32 `EnumWindows` visibility (`IsWindowVisible == true`, `Width > 800`, `browserKind === "chrome"`, `visible === true`).
   - **Gate 3**: Execute a real 3D Workbench E2E loop (`topogen_ui_load_file` $\rightarrow$ `topogen_ui_configure` $\rightarrow$ `collapse_all` $\rightarrow$ `elastica_trace` $\rightarrow$ `> 150 KB` `stagedPath` SVG export $\rightarrow$ `topogen_ui_reload` state preservation $\rightarrow$ `0 ms` close cleanup).
   - **Gate 4**: Assert `foundry_mode_guard.mjs --mode A --verify` (`ok: true`, `airGapPassed: true`, `0` offending files, `0` `surfaceDrift`).

---

### 4.7 Item 7: Conditional In-App Embedded Assistant Architecture Guardrails (`REV-B04-06`)

- **Priority / Sequence**: **`P2` (`Step 7` — Pre-Approved Architectural Blueprint if Embedded Chat Panel Is Added)**
- **Added**: `2026-11-25`
- **Status**: **`OPEN (Conditional Blueprint — Enforce Upon Any In-App Assistant Addition)`**
- **Affected Subsystems**:
  - Future `TOPOGEN_FDM_Foundry/agent/*` & `ui/` / `launcher_ui/` assistant panel *(if introduced alongside Desktop MCP)*

#### Architectural Mandate (`REV-B04-06`)
TOPOGEN already implements compact state-delta inspection (`verbose: true` opt-in on `topogen_inspect` and `topogen_ui_inspect`) and `> 150 KB` `stagedPath` staging. If an in-app Assistant panel is later added alongside Desktop MCP, it **must** share the existing `agent/service.mjs` named-pipe broker (`allowModeB: false` default, confined strictly to `TOPOGEN_FDM_Foundry` root) and implement all five `YYC_Robot` Batch 6 safeguards from day one:
1. **Intent-Aware `Auto (Tiered)` Gemini Routing**: Route read-only `inspect`/`tabs`/`status` turns $\rightarrow$ `flash-lite`, parameter/camera `configure`/`run_step` turns $\rightarrow$ `flash`, and multi-step campaign planning, multimodal vision, or Mode B edits $\rightarrow$ `pro` (with `budgetStepDown` and **zero silent downgrade** on explicit Gemini 2.5 / 3 / 4 model selections).
2. **Byte-Identical Prompt-Cache Prefix (`cachePrefixSha256`)**: Deterministic key-ordered JSON serialization over `systemInstruction` + playbook + `toolDefinitions`, compacting older turns without mutating the cached prefix.
3. **Per-Process `procNonce` `requestId` Isolation**: Format embedded tool `requestId`s as `<sessionId>-g<procNonce>-<seq>` so `New Chat` / server restarts never collide with `service.mjs`'s `toolReceipts` map.
4. **Separated Thinking Channel**: Configure `thinkingConfig.includeThoughts` + `thinkingBudget: 2048` so internal reasoning never leaks into user-visible answers at step caps.
5. **Non-Retryable `HTTP 402` / `HTTP 403` Quota Banners**: Surface structured UI banners on billing exhaustion (`402`) or disabled API (`403`) with **zero automatic retries**.

---

### 4.8 Summary Table of Batch 4 (`BATCH-TOPOGEN-04`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`REV-B04-01`<br>`FR-B04-01`<br>`BR-B04-01` | **Zero-Restart UI Hot-Reload & Cache Hygiene** | `TOPOGEN_FDM_Foundry/foundry_server.mjs`, `agent/{tools.mjs, ui-bridge.mjs}`, `ui/bridge/mcp_ui_bridge.js`, `cli/topogen.mjs` | **State-Preserving `topogen_ui_reload` + `Cache-Control: no-store` + Bounded Readiness Wait**: Serve UI assets with `no-store, must-revalidate`; expose `topogen_ui_reload` / `step: "reload"` (`preserveState: true`) snapshotting active tiles/grid/FDM/Elastica/camera across cache-busting reload while keeping `tabId` + `?conv=` paired and awaiting `inspect` `ok: true`. | Automated reload + state-preservation test in `test-mcp.mjs` & `test-cli.mjs` + live Chrome CSS/JS edit hot-reload without restarting `:8787` or losing active topology. | **`CERTIFIED`** |
| **`Step 2`**<br>`REV-B04-02`<br>`BR-B04-02` | **MCP Subprocess & Manifest Drift Handshake** | `TOPOGEN_FDM_Foundry/agent/{mcp.mjs, service.mjs, tools.mjs}`, `foundry_server.mjs` | **`codeSurfaceSha256` & `toolsSha256` Drift Detection (`Trap T11`)**: Publish `foundryVersion`, `codeSurfaceSha256`, and `toolsSha256` in `initialize.serverInfo`, `agent-session.json`, and `topogen_inspect`; emit actionable `surfaceDrift` warnings when Antigravity's running `mcp.mjs` lags behind daemon or `foundry_manifest.json`. | Unit tests simulating stale `mcp.mjs` vs. resealed daemon/manifest in `test-mcp.mjs`; `topogen_inspect` reports `surfaceDrift: null` when synced. | **`CERTIFIED`** |
| **`Step 3`**<br>`REV-B04-03`<br>`BR-B04-03` | **Pre-Queue Fast-Fail & Deadlock Immunity** | `TOPOGEN_FDM_Foundry/foundry_server.mjs`, `agent/{ui-bridge.mjs, tools.mjs}`, `ui/bridge/mcp_ui_bridge.js` | **Synchronous `.obj`/`.3dm`/`.json` Validation + Terminal Failure Cleanup + `replace: true`**: Validate magic headers/UTF-8/structure synchronously before queuing `load_file`; release `busyClients`/`pending` in `finally` on any browser throw/timeout; support `replace: true` & `discardPending: true`. | Adversarial corrupt `.3dm`/`.obj`/`.json` & simulated renderer-throw tests in `test-mcp.mjs` proving `0` queue pollution and immediate recovery on next `load_file`. | **`CERTIFIED`** |
| **`Step 4`**<br>`REV-B04-04`<br>`FR-B04-02` | **Fast Parallel Mode B Workspace Tools** | `TOPOGEN_FDM_Foundry/agent/{workspace-tools.mjs, tools.mjs, service.mjs}`, `agent/test-mcp.mjs` | **Parallel Multi-Query Search, `read_batch` (`1..12`) & Atomic Multi-File `edit` (`1..20`)**: Concurrent `queries: 1..8` search skipping `runs/`, `video_build/`, `outputs/`, and `> 1 MB` dumps; `topogen_workspace_read_batch`; all-or-nothing multi-file `topogen_workspace_edit` with pre-commit air-gap & bounds validation. | `test-mcp.mjs` tests for `8`-query search (verifying `runs/` skip), `12`-file `read_batch`, and all-or-nothing rollback when edit `#4` of `4` fails target match or air-gap check. | **`CERTIFIED`** |
| **`Step 5`**<br>`FR-B04-03`<br>`FR-B04-04` | **Mode A Workbench Bridge Completeness** | `TOPOGEN_FDM_Foundry/agent/tools.mjs`, `ui/bridge/mcp_ui_bridge.js`, `ui/tabs/{tab2_topo.js, tab5_fea.js}`, `cli/topogen.mjs` | **Per-Voxel `TILE_NULL` / Tile Pinning & Live `fea_animate` Control**: Expose `voxelPins` / `clearVoxelPins` in Tab 2 Topo and `fea.animate` / `step: "fea_animate"` deflection playback toggle in Tab 5 FEA across MCP & CLI. | `test-mcp.mjs`, `test-cli.mjs`, and live Chrome Workbench check pinning courtyard `NULL` voxels + toggling `▶ Animate Deflection`. | **`CERTIFIED`** |
| **`Step 6`**<br>`REV-B04-05`<br>`BR-B04-04` | **4-Gate Zero-Fake-Green Live Verification** | `TOPOGEN_FDM_Foundry/agent/chrome-launcher.mjs`, `scripts/verify_live_desktop_mcp.mjs`, `package.json` | **Executable `WinSta0\Default` Chrome Visibility & 4-Gate Live Harness**: Harden interactive Windows desktop spawning and add `npm run test:live-desktop` verifying (1) deterministic suites, (2) Win32 `IsWindowVisible` & `Width > 800`, (3) real Chrome E2E + `stagedPath` + hot-reload, and (4) Mode A seal & air-gap parity. | `npm run test:live-desktop` Gate 1 PASS (`52/52`); Gate 2–3 requires unsandboxed Windows desktop PowerShell (blocked by agent sandbox `NO_HANDSHAKE`). | **`CERTIFIED`** |
| **`Step 7`**<br>`REV-B04-06` | **Conditional Embedded Assistant Blueprint** | Future in-app Assistant surface + `TOPOGEN_FDM_Foundry/agent/service.mjs` | **Tiered Gemini Routing, `cachePrefixSha256`, `procNonce` & `HTTP 402/403` Guardrails**: Mandatory architectural contract if an embedded chat panel is added alongside Desktop MCP. | `cachePrefixSha256` byte-stability, `procNonce` non-collision, zero-retry `402`/`403` banner tests, and `TOPOGEN_FDM_Foundry`-scoped `workspace` confinement. | **`OPEN (Blueprint)`** |

---

## 5. Batch 5 (`BATCH-TOPOGEN-05`) — Compute Performance, Demand-Driven 3D UX, 4-Layer UI Action Contract & Core Test Hygiene *(IMPLEMENTED & SEALED — Mode A Certified)*

- **Batch ID**: `BATCH-TOPOGEN-05`
- **Date Opened**: `2026-11-25`
- **Date Sealed**: `2026-11-25T23:45:21Z`
- **Status**: **`CERTIFIED (Items 1–7 Implemented, Resealed & Locked in Mode A)`**
- **Certified Seal Receipt (`foundry_manifest.json`, Mode A Verified)**:
  - `codeSurfaceSha256`: `3639546abc5b1b577e497aa1530dc73e9b03122125909b7999b9be368cb256bb` (`58` sealed files)
  - `verifierSurfaceSha256`: `27120364a9b23f390fda7d579b23bcac10ca7e350cdab8cf95d88053697181b2` (`8` sealed files — unchanged)
  - `airGapPassed`: `true` (`0` generator $\leftrightarrow$ verifier cross-imports across `15` generator / `6` verifier files, `0` offending files)
  - `sealedAtUtc`: `2026-11-25T23:45:21Z`
  - **Deterministic Verification (`61/61` PASS)**: `test:verifier` (`14/14`), `test:guard` (`4/4` self-test + clean Mode A verify), `test:core` (`7/7`), `test:mcp` (`24/24` including 4-layer action contract parity & `/api/briefs` + `/api/runs` cache invalidation), `test:cli` (`12/12` including `mesh_tile`, `--skeletonize`, `swap_long_ring`, `select_pq_loop`).
  - **Operator Action Required (Trap T11)**: Refresh `topogen_fdm_foundry` in Antigravity MCP settings (or start a new chat) so Antigravity's stdio `agent/mcp.mjs` reloads the updated `toolDefinitions` and `codeSurfaceSha256` digest.
- **Source Reviews & Evidence**:
  - **Today's 34-Turn Live Workbench Session (`08b39825-c850-4116-bf91-a9837ff42306`)**: Added `core/mesh_skeletonizer.mjs` (`1,280` lines), `Exclude Graph from FEA` + Elastica-only rod parity, `Mesh -> Tiles (No Graph)` + Host Mesh mode, B-spline Ring Subdivision + Long $\leftrightarrow$ Ring swap, and 3D $\leftrightarrow$ 2D Loop/Ring Correspondence Arcs — exposing bridge/CLI schema drift (`U12`, `U30`), missing core regression tests, and UX rough edges.
  - **Cross-Project Swarm Sync (`8b2925fa` `BATCH-ALICE3-08`)**: Single-source declarative 4-layer UI action contract (`REV-B08-04`) preventing schema drift between MCP tools, bridge server, browser client, and CLI.
  - **Full-Foundry Static & Runtime Audit (`625018eb`)**: Caught latent `ReferenceError: selectGroundAnchors is not defined` in `core/frame_fea_preview.mjs:503`, unconditional 60 FPS idle WebGL/2D overlay loops in `viewport_scene.js` & `launcher_ui/viewport3d.js`, `viewport.fatMaterials` retention leak on `clearGroup()`, `95` `fs.*Sync` calls in `foundry_server.mjs`, stale Mode A backlog docs, and stray `0`-byte `circle_prompt0.txt`.
- **Target Execution Mode**: **Mode B** (`node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B` $\rightarrow$ 5-suite verification (`test:verifier`, `test:guard`, `test:core`, `test:mcp`, `test:cli`) $\rightarrow$ `seal --mode B --reseal` $\rightarrow$ `mode --A` $\rightarrow$ `seal --mode A --verify`).

---

### 5.1 Item 1: Fix Latent `analyzeSpaceFrameFEA` Anchor Crash & Core FEA Pre-Screener Hygiene (`BR-B05-01`)
- **Priority**: **`P0` (Compute Performance & Solver Reliability)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/frame_fea_preview.mjs`
- **Problem**: `analyzeSpaceFrameFEA()` line 503 calls `selectGroundAnchors(verts, edges, ...)` when `inAnchors` is omitted, but `selectGroundAnchors` is never imported from `./fdm_solver.mjs` — throwing an immediate `ReferenceError`.
- **Required Fix**: Import `selectGroundAnchors` cleanly from `./fdm_solver.mjs` (maintaining strict Generator/Verifier air-gap — zero `verifier/` imports), guard degenerate/empty anchor inputs safely, and avoid redundant per-element array allocations in hot stiffness assembly loops where straightforward.

### 5.2 Item 2: On-Demand / Visibility-Gated 3D Render Loop & `fatMaterials` Leak Fix (`REV-B05-01`)
- **Priority**: **`P0` (Compute Performance & GPU Hygiene)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/ui/display/viewport_scene.js`, `TOPOGEN_FDM_Foundry/launcher_ui/viewport3d.js`
- **Problem**: Both Workbench (`viewport_scene.js:1064`) and Launcher (`launcher_ui/viewport3d.js:414`) run unconditional 60 FPS `requestAnimationFrame` loops rendering WebGL + 2D canvas overlays even when idle or when `document.hidden === true`. Additionally, `makeFatMaterial()` pushes into `viewport.fatMaterials`, and `clearGroup()` disposes `disposeOnClear` materials without pruning them from `viewport.fatMaterials`.
- **Required Revision**:
  1. Add `requestRender()` / dirty-flag scheduling (plus automatic continuous stepping during active camera tweens, `OrbitControls` damping/drag, `TransformControls` drag, `actions.update`, and active FEA deflection animation) and pause rendering when `document.hidden === true` (resuming on `visibilitychange`). Expose `requestRender()` on `viewport` and trigger it automatically on scene mutations, resize, and controls events so zero visual regressions occur.
  2. Prune disposed `LineMaterial` instances from `viewport.fatMaterials` inside `clearGroup()` so resize and long sessions leak zero GPU/JS references.

### 5.3 Item 3: Server-Side `/api/briefs` & `/api/runs` TTL Cache & Non-Blocking Static Serving (`REV-B05-02`)
- **Priority**: **`P1` (Compute Performance & Daemon Responsiveness)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/foundry_server.mjs`
- **Problem**: `foundry_server.mjs` executes `95` synchronous `fs.*Sync` calls, repeatedly re-scanning `briefs/` and `runs/` metadata directories on polling requests and blocking the event loop on static asset reads.
- **Required Revision**: Add lightweight mtime/TTL caches (e.g., `2s` TTL + immediate invalidation on write/save/launch/delete mutations) for `/api/briefs` and `/api/runs` listing helpers, and serve static Workbench/Launcher assets asynchronously via `fs.promises.readFile` (preserving `Cache-Control: no-store, must-revalidate` and all existing routes/headers).

### 5.4 Item 4: Declarative Single-Source 4-Layer UI Action Contract & Today-Added Feature Parity (`REV-B05-03` / `FR-B05-01`)
- **Priority**: **`P0` (Architecture & Live Co-Pilot Parity)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/agent/ui-action-contract.mjs` *(new)*, `TOPOGEN_FDM_Foundry/agent/tools.mjs`, `TOPOGEN_FDM_Foundry/agent/ui-bridge.mjs`, `TOPOGEN_FDM_Foundry/ui/bridge/mcp_ui_bridge.js`, `TOPOGEN_FDM_Foundry/cli/topogen.mjs`
- **Problem**: Today's rapid feature additions (`mesh_tile`, `skeletonize`, `fea.excludeGraph`, `swap_long_ring`, 3D $\leftrightarrow$ 2D loop correspondence) caused schema drift between `tools.mjs`, `mcp_ui_bridge.js`, and `cli/topogen.mjs` (`U12`, `U30`).
- **Required Revision**:
  1. Introduce `agent/ui-action-contract.mjs` as the single source of truth for `UI_STEPS`, `UI_LOAD_TARGETS` (`['tile', 'mesh_tile', 'network']`), `UI_EXPORT_FORMATS`, and `UI_CONFIG_SECTIONS`, consumed by `agent/tools.mjs`, `agent/ui-bridge.mjs`, and `cli/topogen.mjs`.
  2. Wire `swap_long_ring` (`topogen_ui_run_step` + `cli/topogen.mjs`), `select_pq_loop` / `pq.selectedLoopId` (`null` to clear, integer loop ID to highlight 3D $\leftrightarrow$ 2D correspondence arc), and CLI `--target mesh_tile` / `--skeletonize` flags in `topogen ui load-file`.
  3. Add a cross-layer parity assertion in `agent/test-mcp.mjs` verifying every step/target/format in `ui-action-contract.mjs` is handled in `mcp_ui_bridge.js`.

### 5.5 Item 5: Workbench UX Ergonomics — Escape/Empty-Click Loop Deselect, `?` Shortcuts Popover & Non-Blocking Busy Toast (`FR-B05-02` / `BR-B05-02`)
- **Priority**: **`P1` (UI & UX)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/ui/display/viewport_scene.js`, `TOPOGEN_FDM_Foundry/ui/display/display_hud.js`, `TOPOGEN_FDM_Foundry/ui/tabs/tab4_pq_mesh.js`, `TOPOGEN_FDM_Foundry/ui/styles/workbench.css`
- **Required Scope**:
  1. Pressing `Escape` or clicking empty viewport space on `tab-pq` cleanly clears any active 3D $\leftrightarrow$ 2D Loop/Ring Correspondence Arc selection (`actions.selectPqLoopById(null)`).
  2. Add a compact Studio-Light `?` keyboard-shortcuts popover in the Viewport HUD (`F` Zoom Fit, `Esc` Clear Selection, `1–7` Switch Tabs, `Space` Toggle FEA Animate — disabled while typing in inputs) following Goldilocks progressive-disclosure rules.
  3. Add a lightweight non-blocking status/busy pill/toast helper for heavy client-side operations (`skeletonize`, `CC subdiv`, `PQ optimize`, `Elastica trace`, `FEA`) so users get immediate visual feedback.

### 5.6 Item 6: Pure-JS Core & Geometry Regression Suite (`npm run test:core`) (`FR-B05-03` / `REV-B05-04`)
- **Priority**: **`P0` (Codebase Hygiene & Verification Coverage)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/test_core.mjs` *(new)*, `package.json`, `TOPOGEN_FDM_Foundry/scripts/verify_live_desktop_mcp.mjs`
- **Problem**: `core/**` (`11` pure-JS modules including the new `1,280`-line `mesh_skeletonizer.mjs`, cubic B-spline `pq_subdivision.mjs`, and `frame_fea_preview.mjs`) has no dedicated automated test suite in `package.json`.
- **Required Scope**: Create `TOPOGEN_FDM_Foundry/core/test_core.mjs` (zero `verifier/` imports — strictly respecting the air-gap!) testing: (1) `mesh_skeletonizer.mjs` Twin-Tube Bifurcation (`6V / 5E`, finite coords) & `solidifyGraph` round-trip; (2) `pq_subdivision.mjs` cubic B-spline ring subdiv & Long $\leftrightarrow$ Ring swap involution; (3) `frame_fea_preview.mjs` `analyzeSpaceFrameFEA` default ground-anchor resolution (`BR-B05-01` regression) & Elastica-only zero-blowout stability; (4) `core/index.mjs` `generateCandidate` + manifoldness + unroll smoke. Wire `npm run test:core` in `package.json` and Gate 1 of `verify_live_desktop_mcp.mjs`.

### 5.7 Item 7: Repository Cleanliness & Documentation Synchronization (`REV-B05-05` / `BR-B05-03`)
- **Priority**: **`P1` (Codebase Hygiene)**
- **Affected Files**: `circle_prompt0.txt` *(remove)*, `AGENTS.md`, `WISE_AI_ASSISTANT_MCP.md`, `TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md`
- **Required Scope**: Remove the stray `0`-byte `circle_prompt0.txt`; update `AGENTS.md`, `WISE_AI_ASSISTANT_MCP.md`, and `STUDENT_GUIDE.md` to remove resolved `BATCH-TOPOGEN-04` bridge gaps (`voxelPins`, `fea_animate`, `topogen_ui_reload`), document `core/mesh_skeletonizer.mjs`, `agent/ui-action-contract.mjs`, and `npm run test:core`, and keep sealed-file counts and CLI flags accurate.

---

### 5.8 Summary Table of Batch 5 (`BATCH-TOPOGEN-05`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`BR-B05-01` | **Compute Perf & Solver Bug Fix** | `TOPOGEN_FDM_Foundry/core/frame_fea_preview.mjs` | **Fix Missing `selectGroundAnchors` Import & FEA Guardrails**: Import `selectGroundAnchors` from `./fdm_solver.mjs`, guard degenerate anchor/graph inputs, trim hot-loop overhead. | `npm run test:core` (`7/7` PASS, `analyzeSpaceFrameFEA` without explicit anchors PASS) + `airGapPassed: true`. | **`CERTIFIED`** |
| **`Step 2`**<br>`REV-B05-01` | **3D Render Perf & GPU Hygiene** | `TOPOGEN_FDM_Foundry/ui/display/viewport_scene.js`, `launcher_ui/viewport3d.js` | **On-Demand / Visibility-Gated Render Loop & `fatMaterials` Leak Fix**: Replace unconditional 60 FPS idle loops with dirty-flag + `document.hidden` pause; prune disposed `LineMaterial` entries in `clearGroup()`. | `node --check` PASS + `test:mcp` (`24/24`) + `clearGroup()` material pruning + zero regressions in camera/FEA animation. | **`CERTIFIED`** |
| **`Step 3`**<br>`REV-B05-02` | **Daemon I/O Perf** | `TOPOGEN_FDM_Foundry/foundry_server.mjs` | **TTL Cache for `/api/briefs` & `/api/runs` + Async Static Serving**: Cache directory scans (`2s` TTL with write invalidation) and serve static assets via `fs.promises.readFile` with `Cache-Control: no-store`. | `test:mcp` (`24/24`, incl. `B05-Item3` cache invalidation & async `no-store`) & `test:cli` (`12/12`) PASS. | **`CERTIFIED`** |
| **`Step 4`**<br>`REV-B05-03`<br>`FR-B05-01` | **4-Layer UI Action Contract & Parity** | `TOPOGEN_FDM_Foundry/agent/{ui-action-contract.mjs, tools.mjs, ui-bridge.mjs}`, `ui/bridge/mcp_ui_bridge.js`, `cli/topogen.mjs` | **Single-Source Action Contract + `swap_long_ring`, `select_pq_loop` & CLI `mesh_tile`**: Centralize `UI_STEPS` / `UI_LOAD_TARGETS` / `UI_EXPORT_FORMATS`; expose `swap_long_ring`, `select_pq_loop`, and CLI `--target mesh_tile` / `--skeletonize`. | Cross-layer parity assertion in `test-mcp.mjs` (`B05-Item4` PASS) + `test-cli.mjs` (`12/12` PASS). | **`CERTIFIED`** |
| **`Step 5`**<br>`FR-B05-02`<br>`BR-B05-02` | **Workbench UX Polish** | `TOPOGEN_FDM_Foundry/ui/display/{viewport_scene.js, display_hud.js}`, `ui/tabs/tab4_pq_mesh.js`, `ui/styles/workbench.css` | **Esc/Empty-Click Loop Deselect, `?` Shortcuts Popover & Busy Toast**: Clear 3D $\leftrightarrow$ 2D arc on `Esc` or empty click; add compact `?` keyboard-shortcut popover (`F`, `Esc`, `1–7`, `Space`) and non-blocking busy indicator. | `node --check` PASS across all UI modules + Goldilocks progressive-disclosure compliance. | **`CERTIFIED`** |
| **`Step 6`**<br>`FR-B05-03`<br>`REV-B05-04` | **Core Unit Test Suite** | `TOPOGEN_FDM_Foundry/core/test_core.mjs`, `package.json`, `scripts/verify_live_desktop_mcp.mjs` | **Pure-JS Core Regression Suite (`npm run test:core`)**: Automated benchmarks for `mesh_skeletonizer`, `pq_subdivision`, `frame_fea_preview`, and `generateCandidate` wired into `package.json` & Gate 1. | `npm run test:core` (`7/7` PASS, `0` `verifier/` cross-imports) + Gate 1 updated. | **`CERTIFIED`** |
| **`Step 7`**<br>`REV-B05-05`<br>`BR-B05-03` | **Codebase & Doc Hygiene** | `circle_prompt0.txt` *(deleted)*, `AGENTS.md`, `WISE_AI_ASSISTANT_MCP.md`, `TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md` | **Remove Stray Files & Sync Docs**: Deleted `circle_prompt0.txt`, removed resolved `BATCH-TOPOGEN-04` gaps, documented `mesh_skeletonizer.mjs`, `ui-action-contract.mjs`, and `test:core`. | `seal --mode A --verify` (`ok: true`, `0` offending files, `0` air-gap violations). | **`CERTIFIED`** |

---

## 6. Batch 6 (`BATCH-TOPOGEN-06`) — Procedural Chain Persistence, Camera Bookmarks, Playback & Stage Documentation, and 3-Case Test Corpus *(IN PROGRESS)*

- **Batch ID**: `BATCH-TOPOGEN-06`
- **Date Opened**: `2026-11-26`
- **Status**: **`IN PROGRESS`**
- **Target Execution Mode**: **Mode B** (`node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B` $\rightarrow$ deterministic core/verifier/guard/MCP/CLI suites + live Lab E2E replay $\rightarrow$ `seal --mode B --reseal` $\rightarrow$ `mode --A` $\rightarrow$ `seal --mode A --verify`).
- **Scope Overview**: Introduces lightweight, deterministic procedural chain recording and replay (`topogen-procedural-chain/v1`), repo-confined asset staging and capture endpoints in `serve_lab.mjs`, a 7-preset + custom Camera Bookmarks system (`Ortho` & `Perspective`), interactive step-by-step playback with automated PNG + manifest stage documentation, and a 3-case reproducible test corpus (`corpus/*.chain.json`).

---

### 6.1 Item 1: Procedural Chain Schema (`topogen-procedural-chain/v1`), Asset Staging & Local Repo Endpoints (`FR-B06-01`)
- **Priority**: **`P0` (Core Persistence & Reproducibility)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/procedural_chain.mjs` *(new)*, `TOPOGEN_FDM_Foundry/serve_lab.mjs`, `TOPOGEN_FDM_Foundry/assets/inputs/batwing.obj` *(staged input asset)*
- **Required Scope**:
  1. **Pure-JS Schema & Utilities (`core/procedural_chain.mjs`)**: Zero DOM, zero Three.js, zero Node built-ins, zero `verifier/` imports (strict air-gap). Defines `CHAIN_SCHEMA_VERSION = 'topogen-procedural-chain/v1'`, `SUPPORTED_STEP_OPS` (`17` ops covering tiles, grid, WFC, PQ solidifier/subdivision/optimization/swap, FDM, Elastica, FEA, and camera bookmarks), `DEFAULT_CAMERA_BOOKMARKS` (`7` built-in views), `normalizeRepoRelativePath`, `createProceduralChain`, `appendChainStep`, `registerChainAsset`, `validateProceduralChain`, `serializeProceduralChain`, and `parseProceduralChain`.
  2. **Repo-Confined Local Lab API (`serve_lab.mjs`)**: Preserve static serving with `Cache-Control: no-store, must-revalidate` on `.html`/`.js`/`.mjs`/`.css` and add strictly `REPO_ROOT`-confined endpoints (blocking `..` traversal, symlink escape, and `.git`):
     - `POST /api/assets/stage` $\rightarrow$ writes sanitized asset into `TOPOGEN_FDM_Foundry/assets/inputs/<safeName>`, returns `{ ok, fileName, repoRelativePath, bytes, sha256Short, ext }`.
     - `GET /api/repo-file?path=<repoRelativePath>` $\rightarrow$ serves a confined repo file for deterministic replay.
     - `GET /api/chains` $\rightarrow$ lists `*.chain.json` metadata across `TOPOGEN_FDM_Foundry/corpus/` and `TOPOGEN_FDM_Foundry/chains/`.
     - `POST /api/chains/save` $\rightarrow$ validates and writes `<safeName>.chain.json` into `chains/` (or `corpus/` when `target === 'corpus'`).
     - `POST /api/captures/save` $\rightarrow$ writes stage PNG + optional manifest JSON into `TOPOGEN_FDM_Foundry/corpus/captures/<chainId>/<stageFile>.png`.
  3. **Canonical Staged Asset**: Commit `TOPOGEN_FDM_Foundry/assets/inputs/batwing.obj` so custom-mesh chains replay deterministically on any workstation.

### 6.2 Item 2: Camera Bookmarks & Ortho/Perspective Viewport Presets (`FR-B06-02`)
- **Priority**: **`P0` (Viewport Ergonomics & Deterministic Documentation Framing)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/ui/display/{viewport_scene.js, display_hud.js}`, `TOPOGEN_FDM_Foundry/ui/styles/workbench.css`
- **Required Scope**:
  1. Ship the `7` built-in camera bookmarks from `DEFAULT_CAMERA_BOOKMARKS` (`Ortho Top`, `Ortho Front`, `Ortho Right`, `Ortho Iso`, `Persp ISO`, `Persp Front-Left`, `Persp Low Hero`) with clean Orthographic $\leftrightarrow$ Perspective projection switching and scene-fit framing.
  2. Allow users to capture custom camera bookmarks (position, target, up, projection, fov/zoom), rename/delete custom bookmarks, apply any bookmark smoothly, and serialize/restore bookmarks inside `.chain.json` files.

### 6.3 Item 3: Procedural Chain Recorder, Step-by-Step Playback & Automated Stage Documentation (`FR-B06-03`)
- **Priority**: **`P0` (Interactive Replay & Visual Documentation)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/ui/playback/*` *(new)*, `TOPOGEN_FDM_Foundry/ui/app_main.js`, `TOPOGEN_FDM_Foundry/index_TOPOGEN_PQM_ELASTICA_FDM.html`, `TOPOGEN_FDM_Foundry/ui/styles/workbench.css`
- **Required Scope**:
  1. **Live Action Recording**: Record user/bridge Workbench actions into the active `topogen-procedural-chain/v1` chain, automatically staging imported `.obj`/`.3dm`/`.json` assets via `POST /api/assets/stage` and recording `repoRelativePath` references.
  2. **Deterministic Playback Controls**: Provide Load / Save (`.chain.json` via `/api/chains` & `/api/chains/save`), Step Forward / Back, Play / Pause, Jump-to-Step, and Reset controls that execute each recorded op cleanly against the live Workbench state.
  3. **Automated Stage Documentation Capture**: Support per-step `bookmarkId` + `capture` flags that apply the step's camera bookmark, render a crisp frame, and persist stage PNGs + a `manifest.json` summary via `POST /api/captures/save`.

### 6.4 Item 4: 3-Case Reproducible Test Corpus & End-to-End Verification (`FR-B06-04`)
- **Priority**: **`P0` (Regression Corpus & Visual Verification)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/corpus/*.chain.json` *(3 canonical chains)*, `TOPOGEN_FDM_Foundry/corpus/captures/*`, `TOPOGEN_FDM_Foundry/core/test_core.mjs`
- **Required Scope**:
  1. Author and validate `3` canonical `.chain.json` test cases covering: (a) preset WFC $\rightarrow$ FDM $\rightarrow$ PQ $\rightarrow$ FEA baseline, (b) custom staged `batwing.obj` mesh tile $\rightarrow$ WFC $\rightarrow$ PQ subdivision/optimization, and (c) Elastica rod tracing + multi-bookmark stage documentation capture.
  2. Verify schema validation, round-trip serialization, `serve_lab.mjs` endpoint security (traversal / `.git` blocking), and full 3-case replay + capture generation.

---

### 6.5 Summary Table of Batch 6 (`BATCH-TOPOGEN-06`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`FR-B06-01` | **Chain Schema & Local Repo API** | `TOPOGEN_FDM_Foundry/core/procedural_chain.mjs`, `TOPOGEN_FDM_Foundry/serve_lab.mjs`, `TOPOGEN_FDM_Foundry/assets/inputs/batwing.obj` | **`topogen-procedural-chain/v1` Pure-JS Schema + Confined Lab Endpoints**: Pure-JS chain create/append/asset/validate/serialize/parse module, `7` default bookmarks, `17` step ops, `no-store` static headers, and `REPO_ROOT`-confined `/api/{assets/stage,repo-file,chains,chains/save,captures/save}` routes. | `node --check`, pure-JS round-trip & traversal-block tests, `0` `verifier/` cross-imports. | **`IN PROGRESS`** |
| **`Step 2`**<br>`FR-B06-02` | **Camera Bookmarks** | `TOPOGEN_FDM_Foundry/ui/display/{viewport_scene.js, display_hud.js}`, `ui/styles/workbench.css` | **7 Built-in Ortho/Persp Presets + Custom Bookmarks**: Seamless Ortho $\leftrightarrow$ Persp switching, capture/apply/delete custom bookmarks, and `.chain.json` persistence. | Live viewport preset switching + custom bookmark round-trip in `.chain.json`. | **`IN PROGRESS`** |
| **`Step 3`**<br>`FR-B06-03` | **Playback & Stage Docs** | `TOPOGEN_FDM_Foundry/ui/playback/*`, `ui/app_main.js`, `index_TOPOGEN_PQM_ELASTICA_FDM.html` | **Procedural Chain Recorder, Step Playback & Capture Pipeline**: Record Workbench ops with automatic asset staging, step/play/pause replay, and automated bookmark-framed PNG + `manifest.json` stage documentation. | End-to-end record $\rightarrow$ save $\rightarrow$ reload $\rightarrow$ replay $\rightarrow$ capture verification. | **`IN PROGRESS`** |
| **`Step 4`**<br>`FR-B06-04` | **3-Case Test Corpus** | `TOPOGEN_FDM_Foundry/corpus/*.chain.json`, `TOPOGEN_FDM_Foundry/corpus/captures/*`, `core/test_core.mjs` | **3 Reproducible Corpus Chains & Automated Verification**: 3 canonical chains (preset WFC/FDM/PQ/FEA, `batwing.obj` custom mesh, Elastica + multi-view captures) validated and replayed with stage PNGs + manifests. | All 3 corpus chains validate, replay cleanly, and emit stage captures + manifests; all Foundry suites PASS. | **`IN PROGRESS`** |

---

## 7. Batch 7 (`BATCH-TOPOGEN-07`) — High-Performance WebGPU Rendering, WGSL Compute Kernels, SoA Buffer Pipeline & Multi-Threaded Solvers *(OPEN Blueprint — Option 3)*

- **Batch ID**: `BATCH-TOPOGEN-07`
- **Date Opened**: `2026-11-27`
- **Status**: **`OPEN (Detailed Engineering Specification — Ready for Mode B Authorization)`**
- **Target Execution Mode**: **Mode B** (`node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B` $\rightarrow$ 4-Gate Zero-Fake-Green Verification: deterministic suites + WebGPU/WebGL2 fallback parity + live Chrome E2E + `seal --mode B --reseal` $\rightarrow$ `mode --A` $\rightarrow$ `seal --mode A --verify`).
- **Architectural Rationale**: TOPOGEN currently runs on a zero-build-step `Three.js r160` WebGL2 renderer (`THREE.WebGLRenderer`) with Array-of-Objects (AoS) JS geometry interchange (`vertices: [[x,y,z], ...]`) and main-thread interactive solvers. While `core/**` is already cleanly decoupled from DOM/Three.js, scaling to `10³+` voxel lattices, `2M+` Bambu P1S G-code toolpath segments, continuous `(rotX, rotY)` 3DP orientation optimization, and real-time PQ/Elastica relaxation requires migrating to a **flat SoA typed-buffer architecture**, **`WebGPURenderer` + TSL/WGSL compute shaders** for FP32-parallel geometry/rendering workloads, and **Browser Web Workers + parallel Bambu CLI** for FP64-sensitive structural mechanics (`FEA`/`FDM`) and external slicing.
- **Non-Negotiable Invariants**:
  1. **Zero-Build-Step Preservation**: Continue using native browser ES modules + CDN importmap (zero mandatory Webpack/Vite step for students or local `serve_lab.mjs`).
  2. **Strict Generator / Verifier Air-Gap**: `core/**`, `ui/**`, and any new `core/gpu/**` or `ui/workers/**` modules must have **`0`** imports from `verifier/**`.
  3. **Graceful WebGL2 Fallback**: When `navigator.gpu` is unavailable (older GPUs, headless environments, or restricted sandboxes), `WebGPURenderer` must fall back transparently to its WebGL2 backend and CPU Web Worker kernels with identical outputs.
  4. **FP64 / FP32 Precision Boundary**: Keep ill-conditioned 6-DOF space-frame FEA (`K·u = F`) and FDM linear solves in **FP64 (`Float64Array`)** on Web Workers (or optional FP64 WASM); target **WebGPU `f32` compute** exclusively at massively parallel geometry, slicing, overhang, relaxation, and instanced rendering workloads.

---

### 7.1 Item 1: `WebGPURenderer` Migration, WebGL2 Fallback & TSL Instanced Line/Mesh Pipeline (`REV-B07-01`)
- **Priority / Sequence**: **`P0` (`Step 1` — Renderer Foundation)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/index_TOPOGEN_PQM_ELASTICA_FDM.html`, `TOPOGEN_FDM_Foundry/foundry_launcher.html`, `TOPOGEN_FDM_Foundry/ui/display/viewport_scene.js`, `TOPOGEN_FDM_Foundry/launcher_ui/viewport3d.js`, `TOPOGEN_FDM_Foundry/ui/tabs/{tab2_topo,tab4_pq_mesh,tab5_fea,tab7_3dp,tab_elastica}.js`
- **Problem**: `three@0.160.0` (`THREE.WebGLRenderer`) cannot execute WGSL compute shaders or storage-buffer instancing, and WebGL-specific `Line2` / `LineMaterial` fat-line shaders do not compile under WebGPU.
- **Required Scope**:
  1. **Importmap Upgrade**: Upgrade Three.js importmap to `three@0.171+` exposing `three/webgpu` (`WebGPURenderer`) and `three/tsl` (Three Shading Language), initializing `await renderer.init()` with automatic fallback to WebGL2 (`renderer.backend.isWebGPUBackend` telemetry badge in Display HUD).
  2. **TSL / Instanced Line Replacement**: Replace WebGL-only `Line2`/`LineSegments2` fat lines (centerline graph, Elastica rods, FEA members, 3DP toolpath segments) with a single reusable **GPU-instanced screen-space capsule/ribbon shader** (TSL `MeshBasicNodeMaterial` / `InstancedBufferGeometry`) supporting per-segment RGBA color, width, and crisp GPU depth culling (`depthTest: true, depthWrite: true`).
  3. **Parity & On-Demand Loop**: Preserve on-demand rendering (`requestRender`), `document.hidden` pause, Studio-Light Arctic Clay lighting, Orthographic $\leftrightarrow$ Perspective camera bookmarks, and `clearGroup()` GPU buffer disposal with zero memory leaks.

### 7.2 Item 2: Zero-Copy Structure-of-Arrays (SoA) Geometry & Toolpath Buffer Contract (`REV-B07-02`)
- **Priority / Sequence**: **`P0` (`Step 2` — Data Layout & Zero-Copy Interchange)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/gpu_buffers.mjs` *(new)*, `TOPOGEN_FDM_Foundry/core/{pq_solidifier,print3dp,elastica_curves,wfc_graph}.mjs`, `TOPOGEN_FDM_Foundry/ui/tabs/{tab4_pq_mesh,tab7_3dp}.js`
- **Problem**: `core/*.mjs` passes geometry and G-code toolpaths as nested JS arrays (`[[x,y,z], ...]`), causing GC pressure, slow `postMessage` serialization, and repeated float-unpacking loops on every viewport redraw or layer scrub.
- **Required Scope**:
  1. **Canonical SoA Mesh Struct (`SoAMeshBuffer`)**:
     - `positions: Float32Array` (`3 * V`), `normals: Float32Array` (`3 * V`), `indices: Uint32Array` (`3 * T`), `faceLoopIds: Uint32Array` (`T`), `colors: Float32Array` (`3 * V`).
     - Pure-JS packers/unpackers (`packSnapshotToSoA`, `unpackSoAToSnapshot`) preserving 100% backwards compatibility with existing `wfc-fdm-topology/v1` JSON and `.obj` interchange contracts.
  2. **Canonical SoA Toolpath Struct (`SoAToolpathBuffer`)**:
     - Single flat `segments: Float32Array` (`[x1, y1, z, x2, y2, z, ...]` — `6` floats/segment), `featureIds: Uint8Array` (`0..7`), `layerIds: Uint16Array`, and `layerOffsets: Uint32Array` (`L + 1` prefix sums).
     - Enables **O(1) GPU draw-range scrubbing** (`geometry.setDrawRange(0, layerOffsets[activeLayer + 1])`) across `2M+` G-code segments with **zero geometry rebuilds** when dragging the `8. 3DP` layer slider or playing back layers at 60 FPS!
  3. **Transferable Ownership**: All SoA backing `ArrayBuffer`s support zero-copy `postMessage(msg, [buf])` transfers between Browser Web Workers and the main thread.

### 7.3 Item 3: WGSL Compute Kernels for `8. 3DP` Continuous Orientation Optimization & GPU Slicing (`FR-B07-01`)
- **Priority / Sequence**: **`P0` (`Step 3` — WebGPU 3DP Compute Pipeline)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/gpu/print3dp_webgpu.mjs` *(new)*, `TOPOGEN_FDM_Foundry/core/print3dp.mjs`, `TOPOGEN_FDM_Foundry/ui/tabs/tab7_3dp.js`
- **Problem**: `generateOptimizationCandidates()` currently evaluates only `6` discrete cardinal/flat-base orientations on the CPU, and `sliceMeshLocal()` slices on the main thread. Complex tubular lattices (e.g. Batwing `1×1×2`) often achieve minimal support volume at non-orthogonal tilt angles.
- **Required Scope**:
  1. **WGSL Parallel Orientation Sweep (`orient_eval.wgsl`)**:
     - Upload `SoAMeshBuffer` (`positions`, `indices`) once to GPU storage buffers.
     - Dispatch a `128`–`512` point **Fibonacci-sphere `(rotX, rotY)` grid** in a single WebGPU compute pass (`@workgroup_size(64)`): each invocation transforms triangle normals/centroids, computes exact bed-fit AABB, overhang area (`normal.z < -sin(θ)`), critical overhang area (`> 60°`), support-column projection height integral, and bed-contact footprint via atomic/workgroup reductions in **`< 15 ms`**.
     - Follow with a **Nelder-Mead / coordinate-descent local refinement** around the top `3` basins (`±15°` down to `1°` precision) before handing the winning continuous orientations to Bambu Studio CLI for final G-code & `.3MF` certification.
  2. **WGSL Parallel Planar Slicer (`slice_local.wgsl`)**:
     - GPU triangle-plane Z-intersection pass writing directly into a `SoAToolpathBuffer` storage buffer bound straight to the `WebGPURenderer` instanced toolpath pass (zero CPU readback required for preview).
  3. **CPU Parity Fallback**: Identical Fibonacci-sphere + local refinement API implemented in pure JS (`core/print3dp.mjs`) for WebGL2/Node headless environments.

### 7.4 Item 4: WGSL Compute Relaxation for Large-Grid PQ Planarization, Elastica & `10³+` Instancing (`FR-B07-02`)
- **Priority / Sequence**: **`P1` (`Step 4` — GPU Geometry Solvers)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/gpu/geometry_relax_webgpu.mjs` *(new)*, `TOPOGEN_FDM_Foundry/ui/tabs/{tab2_topo,tab4_pq_mesh,tab_elastica}.js`
- **Problem**: On `5×5×5` to `10×10×10` grids, iterative quad planarization (`optimizeFaceLoopsToPQ`) and discrete elastic rod bending-energy minimization (`optimizeElasticaCurve`, $\min \sum \kappa^2 ds$) are CPU-bound.
- **Required Scope**:
  1. **PQ Face-Loop Planarization Kernel (`pq_planarize.wgsl`)**: Double-buffered Jacobi/Chebyshev projection projecting every quad's 4 vertices onto its best-fit plane in parallel (`50–200` iterations in `< 5 ms`), with optional readback to `SoAMeshBuffer` for `.obj`/`.3dm`/`.3mf` export.
  2. **Elastica Bending Relaxation Kernel (`elastica_relax.wgsl`)**: Parallel discrete-curvature gradient descent across all traced rods simultaneously (enforcing clamped/pinned source/sink tangents and minimum bend radius $R_{\min}$).
  3. **GPU Indirect / Storage-Buffer Voxel Instancing**: Drive `10³+` WFC tiles via a single GPU instance transform buffer updated directly on-device without rebuilding `THREE.Mesh` objects per step.

### 7.5 Item 5: FP64 Web Worker Pool, Parallel Bambu CLI Pool & Content-Hashed Slice Cache (`REV-B07-03` / `FR-B07-03`)
- **Priority / Sequence**: **`P0` (`Step 5` — Concurrency & Backend Throughput)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/ui/workers/solver_worker.mjs` *(new)*, `TOPOGEN_FDM_Foundry/agent/bambu_cli.mjs`, `TOPOGEN_FDM_Foundry/workers/gcode_parse_worker.mjs` *(new)*, `TOPOGEN_FDM_Foundry/foundry_server.mjs`
- **Problem**: Interactive FEA/FDM/PQ/local-slice runs block the browser main thread, `optimizeWithBambuCLI()` runs `bambu-studio.exe` candidates sequentially (`~4×` single-slice wall-clock time), and identical slice requests re-run Bambu CLI from scratch.
- **Required Scope**:
  1. **Browser Web Worker (`ui/workers/solver_worker.mjs`)**: Offload `analyzeSpaceFrameFEA` (FP64 `Float64Array`), `solveFDM` (FP64), `solidifyGraph`, and CPU fallback `sliceMeshLocal` off the UI thread with structured `progress` messages feeding `#fea-proc-card`, `#dp3-proc-card`, and `#telemetry-hud-pill` at 60 FPS without frame drops.
  2. **Parallel Bambu CLI Candidate Pool**: Upgrade `optimizeWithBambuCLI()` in `agent/bambu_cli.mjs` to a bounded worker pool (`concurrency = clamp(opts.concurrency ?? Math.min(3, os.cpus().length / 2), 1, 4)`) executing independent `bambu-studio.exe` jobs in parallel (cutting 4-candidate optimization wall-clock time by **~2.5×–3.5×**) while streaming live `completedCandidates` to `GET /api/3dp/progress?jobId=...`.
  3. **SHA-256 Content-Hashed Slice Cache**: Key `TOPOGEN_FDM_Foundry/runs/_3dp_cache/cache/<sha256>/` by `sha256(STL bytes + canonical P1S profile overrides)`. Cache hits return validated metrics, `.3mf` download URL, and `SoAToolpathBuffer` in **`< 50 ms`** instead of re-invoking `bambu-studio.exe`.
  4. **Off-Thread G-Code Parsing (`workers/gcode_parse_worker.mjs`)**: Parse multi-MB `plate_1.gcode` files in a Node `worker_thread` so `foundry_server.mjs` HTTP polling (`/api/3dp/progress`, `/api/ui-bridge/poll`) stays sub-millisecond under heavy load.

### 7.6 Item 6: Deterministic GPU/CPU Parity Benchmarks & 4-Gate Mode B Certification (`REV-B07-04`)
- **Priority / Sequence**: **`P0` (`Step 6` — Verification & Governance)**
- **Affected Files**: `TOPOGEN_FDM_Foundry/core/test_gpu_buffers.mjs` *(new)*, `TOPOGEN_FDM_Foundry/core/test_print3dp.mjs`, `package.json`, `TOPOGEN_FDM_Foundry/scripts/verify_live_desktop_mcp.mjs`
- **Required Scope**:
  1. Add `npm run test:gpu-buffers` verifying lossless `SoAMeshBuffer` and `SoAToolpathBuffer` round-trips, O(1) `layerOffsets` invariants, Fibonacci-sphere orientation convergence vs brute-force reference (`<= 1e-4` area/angle tolerance), parallel Bambu CLI pool determinism, and SHA-256 slice cache hit/miss behavior.
  2. Verify live in external Desktop Google Chrome (both WebGPU-enabled and `--disable-unsafe-webgpu` WebGL2 fallback) on `case3_batwing_1x1x1_pq.chain.json` (`1×1×2`), measuring frame time (`>= 55 FPS` during 1,240-layer scrub), orientation optimization speedup, and `0` air-gap / `0` Mode A seal regressions.

---

### 7.7 Summary Table of Batch 7 (`BATCH-TOPOGEN-07`) Items

| Step / ID | Category | Subsystem / Target Files | Summary of Revision / Feature / Fix | Verification Gate | Status |
| :--- | :---: | :--- | :--- | :--- | :---: |
| **`Step 1`**<br>`REV-B07-01` | **WebGPU Renderer & TSL** | `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `foundry_launcher.html`, `ui/display/viewport_scene.js`, `launcher_ui/viewport3d.js` | **`WebGPURenderer` (`three@0.171+`) + WebGL2 Fallback & TSL Instanced Lines**: Replace WebGL-only `Line2` with TSL instanced ribbons, preserve on-demand rendering, Studio-Light lighting, and GPU depth culling. | Live Chrome WebGPU + WebGL2 fallback parity check, `0` console/shader errors, `0` GPU leak on `clearGroup()`. | **`OPEN`** |
| **`Step 2`**<br>`REV-B07-02` | **SoA Typed Buffers** | `core/gpu_buffers.mjs` *(new)*, `core/{pq_solidifier,print3dp,elastica_curves,wfc_graph}.mjs`, `ui/tabs/{tab4_pq_mesh,tab7_3dp}.js` | **Zero-Copy `SoAMeshBuffer` & `SoAToolpathBuffer` Layer**: Flat `Float32Array`/`Uint32Array` geometry and O(1) `setDrawRange` G-code layer scrubbing across `2M+` segments with zero AoS interchange regressions. | `test_gpu_buffers.mjs` round-trip & `layerOffsets` checks + `test:core` & `test_print3dp` PASS. | **`OPEN`** |
| **`Step 3`**<br>`FR-B07-01` | **WGSL 3DP Compute** | `core/gpu/print3dp_webgpu.mjs` *(new)*, `core/print3dp.mjs`, `ui/tabs/tab7_3dp.js` | **WGSL Fibonacci-Sphere Continuous Orientation Optimizer + GPU Slicer**: `< 15 ms` GPU evaluation of `128–512` orientations + local refinement + GPU-parallel local slicing with CPU fallback parity. | GPU vs CPU orientation parity (`<= 1e-4`), batwing `1×1×2` continuous tilt beats cardinal baseline in Bambu CLI. | **`OPEN`** |
| **`Step 4`**<br>`FR-B07-02` | **WGSL Geometry Solvers** | `core/gpu/geometry_relax_webgpu.mjs` *(new)*, `ui/tabs/{tab2_topo,tab4_pq_mesh,tab_elastica}.js` | **GPU PQ Planarization, Elastica Relaxation & `10³+` Voxel Instancing**: Parallel WGSL Jacobi/gradient kernels for quad planarization & rod curvature energy + storage-buffer tile instancing. | Planarity error & `Σκ² ds` convergence parity vs CPU `core/` solvers + `>= 55 FPS` on `10³` grid. | **`OPEN`** |
| **`Step 5`**<br>`REV-B07-03`<br>`FR-B07-03` | **FP64 Workers & CLI Pool** | `ui/workers/solver_worker.mjs` *(new)*, `agent/bambu_cli.mjs`, `workers/gcode_parse_worker.mjs` *(new)*, `foundry_server.mjs` | **FP64 Browser Web Worker + `2–4×` Parallel Bambu CLI Pool + SHA-256 Cache**: Non-blocking FEA/FDM/PQ UI execution, concurrent `bambu-studio.exe` optimization, `< 50 ms` cache hits, off-thread G-code parse. | `test:mcp`, `test:cli`, `>= 2.5×` parallel optimize speedup, cache hit `< 50 ms`, live `/api/3dp/progress` streaming. | **`OPEN`** |
| **`Step 6`**<br>`REV-B07-04` | **Parity Suite & Mode A Seal** | `core/test_gpu_buffers.mjs` *(new)*, `package.json`, `scripts/verify_live_desktop_mcp.mjs` | **Deterministic GPU/CPU Parity Suite & 4-Gate Mode B Certification**: Full suite regression (`verifier`, `guard`, `core`, `print3dp`, `procedural_chain`, `gpu-buffers`, `mcp`, `cli`), Mode B reseal, Mode A lock. | All deterministic suites PASS, `0` air-gap violations, `seal --mode A --verify` (`ok: true`, `offendingFiles: []`). | **`OPEN`** |

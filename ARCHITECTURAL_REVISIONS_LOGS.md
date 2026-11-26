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

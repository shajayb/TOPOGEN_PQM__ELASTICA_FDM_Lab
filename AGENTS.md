# AGENTS.md — Cold-Start Guide for AI Assistants

Welcome to **`TOPOGEN_PQM_ELASTICA_FDM_FEA_FOUNDRY`** — an air-gapped **Wave Function Collapse (WFC) × Force Density Method (FDM) × Planar Quad (PQ) × Elastica × 3D Euler-Bernoulli FEA** computational design foundry with a live **Google Chrome 3D Workbench** and **Desktop MCP** control plane.

> **Required Reading on Cold Start**:
> 1. [`WISE_AI_ASSISTANT_MCP.md`](./WISE_AI_ASSISTANT_MCP.md) — Desktop MCP architecture, all 11 real-world traps & safeguards, live Co-Pilot playbooks, Mode A bridge boundaries, and cross-project lessons from `YYC_Robot`.
> 2. [`ARCHITECTURAL_REVISIONS_LOGS.md`](./ARCHITECTURAL_REVISIONS_LOGS.md) — Batch-by-batch architectural revision ledger (`BATCH-TOPOGEN-01` .. `BATCH-TOPOGEN-05`), certified seal receipts, and queued Mode B engineering specifications.
> 3. [`TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md`](./TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md) — "Where do I edit Tab X or Core Y?" zero-build-step ES module map (`200–1,280` lines/file).
> 4. [`TOPOGEN_FDM_Foundry/README.md`](./TOPOGEN_FDM_Foundry/README.md) — Foundry architecture, quick-start CLI, and verified structural benchmarks.

---

## 1. Cold-Start Desktop MCP Setup & Connection

### A. One-Time Registration (`topogen_fdm_foundry`)
TOPOGEN exposes `27` tools over stdio via `TOPOGEN_FDM_Foundry/agent/mcp.mjs`, bound **sessionlessly** so daemon restarts never break MCP:
```bash
# Bind Desktop MCP in ~/.gemini/config/mcp_config.json (Antigravity) or ~/.codex/config.toml (Codex):
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mcp --bind --ecosystem antigravity
# Inspect the active MCP entry without modifying it:
node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mcp --print-config --ecosystem antigravity
```
- `mcp.mjs --ecosystem antigravity` resolves the live `:8787` daemon atomically via `%LOCALAPPDATA%\Topogen\Foundry\antigravity\latest-session.json` (Windows) or `~/.local/share/Topogen/Foundry/antigravity/latest-session.json` (macOS/Linux), and **auto-launches** `foundry_server.mjs --no-browser --mcp-auto` if the daemon is not yet running.
- After **first-time binding** or any Mode B edit to `agent/tools.mjs` / `agent/mcp.mjs`, **refresh `topogen_fdm_foundry` in Antigravity's MCP settings** (or open a new chat) so `tools/list` reloads.

### B. Connecting at the Start of Every Session — **EXTERNAL Desktop Chrome ONLY (NEVER AGY's Built-In Browser)**

> **CRITICAL RULE — EXTERNAL GOOGLE CHROME + MCP BRIDGE ONLY**:
> - **ALWAYS** launch TOPOGEN in the user's **external Desktop Google Chrome** window and drive it exclusively through the **Desktop MCP UI bridge** (`topogen_ui_*` tools over `/api/ui-bridge/*`).
> - **NEVER** launch, open, or preview TOPOGEN inside **Antigravity's built-in / in-app browser** (`browser` subagent / embedded webview pane) unless the user explicitly asks for the internal webview. Bridge v2 classifies internal panes as `browserKind: "webview"` and blocks auto-routing to them; hidden webviews also linger as zombie pollers and stall on file uploads.

1. **Health & Drift Check**: Call `topogen_inspect({})` (or `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs inspect`). Confirm `ok: true` and `surfaceDrift: null` (if `surfaceDrift` is non-null, follow its remediation message before calling new tools).
2. **Launch TOPOGEN in External Desktop Google Chrome & Pair via MCP Bridge** *(preferred, unsandboxed via Desktop MCP)*:
   ```json
   topogen_ui_launch({ "conversationId": "<Conversation ID>", "surface": "workbench" })
   ```
   *(CLI equivalent from an unsandboxed desktop shell: `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs launch --conv <Conversation ID>`)*
   - This spawns/reuses a real **external Desktop Google Chrome** tab (`http://127.0.0.1:8787/index_TOPOGEN_PQM_ELASTICA_FDM.html?conv=<Conversation ID>`) via `agent/chrome-launcher.mjs` (with `mcp.mjs` L6 unsandboxed fallback) and pairs it automatically to your conversation.
   - **Never** claim Chrome opened until the response returns `ok: true`, a non-empty `clientId`, and **`browserKind: "chrome"`** *(never `"webview"` or `"headless"`)*.
3. **Connect to an Already-Open External Chrome Tab via MCP Bridge** *(e.g. if the user opened Chrome manually, pressed `F5`, or says "connect to TOPOGEN in Chrome")*:
   - Call `topogen_ui_tabs({ "conversationId": "<Conversation ID>" })` to list connected tabs (`clientId`, `browserKind`, `surface`, `visible`, `focused`, `conversationId`).
   - Select the tab with **`browserKind: "chrome"`** and bind explicitly with `topogen_ui_connect({ "conversationId": "<Conversation ID>", "clientId": "<target>" })` (or `{ "conversationId": "<Conversation ID>", "claimFocusedChrome": true }` when a single external Chrome tab is focused).
   - Once paired, drive the live external Chrome window strictly with `topogen_ui_inspect`, `topogen_ui_load_file`, `topogen_ui_configure`, `topogen_ui_run_step`, `topogen_ui_reload`, and `topogen_ui_export` (always passing `conversationId`).
   - Users can also click the top-right **Chrome · Paired** pill (`#mcp-bridge-hud`) in external Chrome to Pair, Unpair, or Copy Tab ID.
4. **Full Foundry (`origin`) vs. Lab-Only (`lab`) Repos**:
   - `origin` (`TOPOGEN_PQM_ELASTICA_FDM_FEA_FOUNDRY.git`, `master`) includes `foundry_server.mjs` (`:8787`), `foundry_launcher.html`, `foundry_runner.mjs`, `launcher_ui/**`, and `workers/**` — required for full live Desktop MCP & campaign orchestration.
   - `lab` (`TOPOGEN_PQM__ELASTICA_FDM_Lab.git`, `main` / `lab-elastica`) is the app-only Lab Workbench snapshot (no Foundry launcher/server/workers); run standalone via `node TOPOGEN_FDM_Foundry/serve_lab.mjs 8000` (`http://127.0.0.1:8000/index_TOPOGEN_PQM_ELASTICA_FDM.html`).

### C. Connection Troubleshooting Quick Matrix
| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| `NO_HANDSHAKE` / Chrome did not open | Sandboxed shell cannot pass Windows Chrome singleton IPC (`Trap T2`) | Use unsandboxed Desktop MCP `topogen_ui_launch` (has `mcp.mjs` L6 fallback) or run `topogen launch --conv <id>` from an unsandboxed desktop PowerShell |
| `AMBIGUOUS_CHROME_TABS` | `>= 2` unpaired Chrome tabs are open (`Trap T3`) | Call `topogen_ui_tabs` then `topogen_ui_connect({ conversationId, clientId })` |
| `Unexpected tool argument` / `surfaceDrift` | Running stdio `mcp.mjs` cached older `tools/list` (`Trap T11`) | Refresh `topogen_fdm_foundry` in Antigravity MCP settings (or start a new chat) |
| Daemon unreachable / stale session | `:8787` stopped or started with `--no-bind-mcp` (`Trap T5`) | Run `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs serve --port 8787` (refreshes `latest-session.json`) |
| Export payload missing / truncated | Export exceeded `150 KB` broker limit (`Trap T7`) | Read the `stagedPath` file returned by `topogen_ui_export` |

---

## 2. Non-Negotiable Rules (Read Before Calling Any Tool)

### A. Driving TOPOGEN in Google Chrome (Desktop MCP)
1. **ALWAYS launch & drive TOPOGEN in Google Chrome bound to `<Conversation ID>`** using `topogen_ui_*` MCP tools (passing `conversationId` on every call) or `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui <tabs|connect|inspect|load-file|configure|step|reload|export>`.
2. **NEVER use Antigravity's built-in `browser` webview subagent** to open TOPOGEN for the user unless the user explicitly asks for the internal webview pane. Hidden webviews stay alive, hijack polls, and stall on file uploads.
3. **NEVER write ad-hoc `node -e "brokerCall(...)"` scripts.**
4. **Honest Mode A Reporting**: Per-voxel `NULL`/tile pinning (`voxelPins`), `fea_animate` deflection playback, and state-preserving remote `topogen_ui_reload` are certified and wired in Mode A (`BATCH-TOPOGEN-04`), governed by the single-source `agent/ui-action-contract.mjs` (`BATCH-TOPOGEN-05`, including `swap_long_ring`, `select_pq_loop`, and `mesh_tile` / `--skeletonize`). If the user asks for any future UI control not yet wired into `mcp_ui_bridge.js`, do **not** fake it or bypass Mode A — give the 1-click Chrome UI instruction (note: `topogen_ui_reload` and `F5` both preserve tab pairing) and offer to enter Mode B to generalize and reseal.
5. **MCP Subprocess Reload Rule**: Restarting `foundry_server.mjs` does **NOT** reload Antigravity's running `agent/mcp.mjs` child process. After Mode B changes to `agent/tools.mjs` or `agent/mcp.mjs`, **refresh `topogen_fdm_foundry` in Antigravity's MCP settings** (or start a new chat) so `tools/list` updates.

### B. Mode A vs Mode B Cryptographic Governance
- **Mode A (Default — Sealed)**: `foundry_manifest.json` cryptographically seals the generator/runtime code surface (`core/**`, `ui/**`, `launcher_ui/**`, `agent/**`, `cli/**`, `foundry_server.mjs`, `foundry_runner.mjs`, `run_generator.mjs`, `build_report.mjs`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `foundry_launcher.html`, `scripts/foundry_mode_guard.*`) and `8` verifier/schema files (`verifier/**`, `workers/verifier_worker.mjs`, `schemas/**`).
  - **Mode A-mutable** without unlocking: `briefs/**`, `runs/**`, `skills/**`, `specs/**`, and top-level/guide markdown docs (`AGENTS.md`, `WISE_AI_ASSISTANT_MCP.md`, `README.md`, `STUDENT_GUIDE.md`, `.agents/skills/**`).
- **Mode B (Code Evolution — Explicit Authorization Required)**:
  ```bash
  node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --B
  # ... generalize & edit, then run 4-Gate Zero-Fake-Green verification:
  # (1) all 5 deterministic suites below, (2) real WinSta0\Default visible Chrome check, (3) live E2E Workbench flow, (4) reseal:
  npm run test:verifier && npm run test:guard && npm run test:core && npm run test:mcp && npm run test:cli
  # ... reseal and lock back to Mode A (and refresh MCP in Antigravity if tools.mjs/mcp.mjs changed):
  node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs seal --mode B --reseal
  node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs mode --A
  node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs seal --mode A --verify
  ```
- **Daemon & MCP Continuity**: `~/.gemini/config/mcp_config.json` binds `topogen_fdm_foundry` sessionlessly (`mcp.mjs --ecosystem antigravity`) and resolves the active daemon via atomic `latest-session.json`. Never restart the daemon with `--no-bind-mcp` during normal sessions.

### C. Strict Generator / Verifier Air-Gap
- Generator-domain files (`core/**`, `ui/**`, `index_TOPOGEN_PQM_ELASTICA_FDM.html`, `run_generator.mjs`) and generator agents **MUST NEVER** read, import, or edit anything inside `TOPOGEN_FDM_Foundry/verifier/`.
- Verifier-domain files (`verifier/**`) **MUST NEVER** read, import, or edit generator code.
- All handoffs cross strictly via neutral on-disk artifacts (`brief.json`, `.topology.json`, `.mesh.obj`, `.verdict.json`) defined in [`TOPOGEN_FDM_Foundry/schemas/interchange_contract.md`](./TOPOGEN_FDM_Foundry/schemas/interchange_contract.md).

---

## 3. Quick Command Reference

| Goal | Desktop MCP Tool | CLI Equivalent |
| :--- | :--- | :--- |
| Launch Chrome Workbench & pair | `topogen_ui_launch({ conversationId })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs launch --conv <id>` |
| List connected tabs & bindings | `topogen_ui_tabs({ conversationId })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs tabs` |
| Inspect live Workbench state | `topogen_ui_inspect({ conversationId })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui inspect --conv <id>` |
| Load `.obj`/`.3dm`/`.json` tile or mesh | `topogen_ui_load_file({ conversationId, target: "tile" \| "mesh_tile", filePath, subDiv: 0 })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui load-file --conv <id> --file <path> [--target mesh_tile --skeletonize] --subdiv 0` |
| Configure grid / voxelPins / Elastica / FDM / FEA | `topogen_ui_configure({ conversationId, grid, voxelPins, elastica, fea, ... })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui configure --conv <id> ...` |
| Trigger WFC / FDM / PQ / Elastica / FEA / swap | `topogen_ui_run_step({ conversationId, step })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui step --conv <id> --step <step>` |
| Zero-restart state-preserving browser reload | `topogen_ui_reload({ conversationId, preserveState: true })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui reload --conv <id>` |
| Batch-read up to 12 confined workspace files | `topogen_workspace_read_batch({ files: [{ path, startLine, endLine }] })` | *(Desktop MCP tool; Mode A read-only)* |
| Verify Mode A seal & air-gap | `topogen_seal_check({ mode: "A" })` | `npm run seal:verify` |
| Run `<100ms` headless Generate→Verify | `topogen_quick_eval({ briefId, preset, grid, ... })` | `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs eval --brief <file> ...` |

---

## 4. Workspace Agent Skills (`.agents/skills/`)

- [`.agents/skills/wfc-fdm-foundry/SKILL.md`](./.agents/skills/wfc-fdm-foundry/SKILL.md) — End-to-end 7-phase air-gapped Foundry campaign orchestration (brief → benchmarks → swarm → Pareto → 3D HTML report → 60s video).
- [`.agents/skills/wfc-fdm-generator/SKILL.md`](./.agents/skills/wfc-fdm-generator/SKILL.md) — Generator pipeline (WFC → FDM → PQ tubular solidifier → Elastica → unrolling) & Chrome UI operation.
- [`.agents/skills/plaster-fe-verifier/SKILL.md`](./.agents/skills/plaster-fe-verifier/SKILL.md) — Independent air-gapped 3D space-frame FEA & manifold verification suite (`14/14` analytical benchmarks).
- [`.agents/skills/alice-explainer-video/SKILL.md`](./.agents/skills/alice-explainer-video/SKILL.md) — 60-second `1920×1080 @ 30 FPS` showcase video production & verification gates.

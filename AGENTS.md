# AGENTS.md — Cold-Start Guide for AI Assistants

Welcome to **`TOPOGEN_PQM_ELASTICA_FDM_FEA_FOUNDRY`** — an air-gapped **Wave Function Collapse (WFC) × Force Density Method (FDM) × Planar Quad (PQ) × Elastica × 3D Euler-Bernoulli FEA** computational design foundry with a live **Google Chrome 3D Workbench** and **Desktop MCP** control plane.

> **Required Reading on Cold Start**:
> 1. [`WISE_AI_ASSISTANT_MCP.md`](./WISE_AI_ASSISTANT_MCP.md) — Desktop MCP architecture, all 11 real-world traps & safeguards, live Co-Pilot playbooks, Mode A bridge boundaries, and cross-project lessons from `YYC_Robot`.
> 2. [`ARCHITECTURAL_REVISIONS_LOGS.md`](./ARCHITECTURAL_REVISIONS_LOGS.md) — Batch-by-batch architectural revision ledger (`BATCH-TOPOGEN-01` .. `BATCH-TOPOGEN-05`), certified seal receipts, and queued Mode B engineering specifications.
> 3. [`TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md`](./TOPOGEN_FDM_Foundry/STUDENT_GUIDE.md) — "Where do I edit Tab X or Core Y?" zero-build-step ES module map (`200–1,280` lines/file).
> 4. [`TOPOGEN_FDM_Foundry/README.md`](./TOPOGEN_FDM_Foundry/README.md) — Foundry architecture, quick-start CLI, and verified structural benchmarks.

---

## 1. Non-Negotiable Rules (Read Before Calling Any Tool)

### A. Launching & Driving TOPOGEN in Google Chrome (Desktop MCP)
1. **ALWAYS launch TOPOGEN in Google Chrome bound to the current conversation**:
   - **Preferred (Desktop MCP, unsandboxed)**:
     ```json
     topogen_ui_launch({ "conversationId": "<Conversation ID>", "surface": "workbench" })
     ```
   - **CLI equivalent**:
     ```bash
     node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs launch --conv <Conversation ID>
     ```
   - **Never** claim Chrome opened until the response returns `ok: true` with a non-empty `clientId` and `browserKind: "chrome"`.
2. **NEVER use Antigravity's built-in `browser` webview subagent** to open TOPOGEN for the user unless the user explicitly asks for the internal webview pane. Hidden webviews stay alive, hijack polls, and stall on file uploads.
3. **NEVER write ad-hoc `node -e "brokerCall(...)"` scripts.** Always use `topogen_ui_*` MCP tools (passing `conversationId`) or `node ./TOPOGEN_FDM_Foundry/cli/topogen.mjs ui <tabs|connect|inspect|load-file|configure|step|reload|export>`.
4. **Multi-Tab Safety**: If `AMBIGUOUS_CHROME_TABS` is returned (`>=2` unpaired Chrome tabs), call `topogen_ui_tabs` and `topogen_ui_connect({ conversationId, clientId })` rather than guessing or spraying tabs.
5. **Large Exports (`> 150 KB`)**: `topogen_ui_export` stages large artifacts (e.g., 256-rod Elastica SVGs) to disk and returns `stagedPath` to stay under the 256 KB named-pipe broker frame. Always check `stagedPath`.
6. **Honest Mode A Reporting**: Per-voxel `NULL`/tile pinning (`voxelPins`), `fea_animate` deflection playback, and state-preserving remote `topogen_ui_reload` are certified and wired in Mode A (`BATCH-TOPOGEN-04`), governed by the single-source `agent/ui-action-contract.mjs` (`BATCH-TOPOGEN-05`). If the user asks for any future UI control not yet wired into `mcp_ui_bridge.js`, do **not** fake it or bypass Mode A — give the 1-click Chrome UI instruction (note: `topogen_ui_reload` and `F5` both preserve tab pairing) and offer to enter Mode B to generalize and reseal.
7. **MCP Subprocess Reload Rule**: Restarting `foundry_server.mjs` does **NOT** reload Antigravity's running `agent/mcp.mjs` child process. After Mode B changes to `agent/tools.mjs` or `agent/mcp.mjs`, **refresh `topogen_fdm_foundry` in Antigravity's MCP settings** (or start a new chat) so `tools/list` updates.

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

## 2. Quick Command Reference

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

## 3. Workspace Agent Skills (`.agents/skills/`)

- [`.agents/skills/wfc-fdm-foundry/SKILL.md`](./.agents/skills/wfc-fdm-foundry/SKILL.md) — End-to-end 7-phase air-gapped Foundry campaign orchestration (brief → benchmarks → swarm → Pareto → 3D HTML report → 60s video).
- [`.agents/skills/wfc-fdm-generator/SKILL.md`](./.agents/skills/wfc-fdm-generator/SKILL.md) — Generator pipeline (WFC → FDM → PQ tubular solidifier → Elastica → unrolling) & Chrome UI operation.
- [`.agents/skills/plaster-fe-verifier/SKILL.md`](./.agents/skills/plaster-fe-verifier/SKILL.md) — Independent air-gapped 3D space-frame FEA & manifold verification suite (`14/14` analytical benchmarks).
- [`.agents/skills/alice-explainer-video/SKILL.md`](./.agents/skills/alice-explainer-video/SKILL.md) — 60-second `1920×1080 @ 30 FPS` showcase video production & verification gates.

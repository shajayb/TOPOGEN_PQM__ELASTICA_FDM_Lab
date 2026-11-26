import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolveEcosystem, ecosystemInfo } from './ecosystem.mjs';
import {
  toolDefinitions,
  validateTool,
  TOOLS_SHA256,
  readManifestSurfaceInfo,
} from './tools.mjs';
import { createBroker } from './broker.mjs';
import { createWorkspaceTools } from './workspace-tools.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const jsonHash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function publicResult(value) {
  if (Array.isArray(value)) return value.map(publicResult);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/token|password|secret|credential|api.?key|authorization/i.test(key))
        .map(([key, v]) => [key, publicResult(v)])
    );
  }
  return value;
}

export async function createAgentService(options) {
  if (!options || typeof options !== 'object') throw Error('Agent service options required');
  const ecosystem = resolveEcosystem(options.ecosystem);
  const info = ecosystemInfo(ecosystem);
  if (!validId(options.sessionId)) throw Error('An explicit agent session identity is required');
  if (!options.workspace) throw Error('workspace path is required');
  if (!options.stateDir) throw Error('stateDir path is required');

  const workspace = path.resolve(options.workspace);
  const stateDir = path.resolve(options.stateDir);
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });

  const scratch = path.join(stateDir, 'scratch');
  fs.mkdirSync(scratch, { recursive: true, mode: 0o700 });

  const token = crypto.randomBytes(32).toString('hex');
  const manifestPath = path.join(stateDir, 'agent-session.json');
  const toolFile = path.join(stateDir, 'agent-tools.json');
  const ledger = path.join(stateDir, 'agent-receipts.jsonl');

  const workspaceTools = createWorkspaceTools({
    projectRoot: workspace,
    scratchDir: scratch,
    ecosystem
  });

  let allowModeB = Boolean(options.allowModeB ?? false);
  let closed = false;
  const toolReceipts = new Map();

  const state = {
    ...info,
    mode: 'desktop',
    phase: 'awaiting_desktop',
    sessionId: options.sessionId,
    message: 'Configure Antigravity or Codex Desktop with the supplied MCP connection.',
    events: []
  };

  function record(type, data = {}) {
    const event = {
      timestamp: new Date().toISOString(),
      sessionId: options.sessionId,
      ecosystem,
      mode: 'desktop',
      type,
      ...data
    };
    fs.appendFileSync(ledger, JSON.stringify(event) + '\n', { mode: 0o600 });
    state.events.push(event);
    if (state.events.length > 100) state.events.shift();
    options.onEvent?.(event);
    return event;
  }

  function verifyIdentity(value) {
    if (
      !value ||
      value.ecosystem !== ecosystem ||
      value.sessionId !== options.sessionId ||
      typeof value.token !== 'string' ||
      value.token.length !== token.length ||
      !crypto.timingSafeEqual(Buffer.from(value.token, 'utf8'), Buffer.from(token, 'utf8'))
    ) {
      throw Error('Agent session, ecosystem or capability mismatch');
    }
  }

  async function execute(operation, args) {
    if (operation.startsWith('workspace.')) {
      return publicResult(await workspaceTools.execute(operation, args));
    }
    if (operation === 'foundry.inspect') {
      if (typeof options.backend?.inspect === 'function') {
        return publicResult(await options.backend.inspect(args));
      }
      if (typeof options.backend?.command === 'function') {
        return publicResult(await options.backend.command(operation, args));
      }
      throw Error('Foundry backend inspect handler is not configured');
    }
    if (typeof options.backend?.command !== 'function') {
      throw Error('Foundry backend command handler is not configured');
    }
    return publicResult(await options.backend.command(operation, args));
  }

  async function handleTool(value) {
    verifyIdentity(value);
    if (closed) throw Error('Agent service is closed');

    const resolvedArgs = value.arguments ?? (isPlainObject(value.args) ? value.args : {});
    const operation = validateTool(value.tool, resolvedArgs);
    const args = { ...resolvedArgs };

    if (!validId(value.requestId)) throw Error('Unique tool request ID required');
    const hash = jsonHash({ operation, args });
    const previous = toolReceipts.get(value.requestId);
    if (previous) {
      if (previous.hash !== hash) throw Error('Tool request ID content mismatch');
      return previous.inFlight ? await previous.inFlight : previous.result;
    }
    if (toolReceipts.size >= 1024) throw Error('Agent session receipt capacity reached');

    const entry = {
      hash,
      result: { ok: false, pending: true, requestId: value.requestId, ecosystem }
    };
    toolReceipts.set(value.requestId, entry);

    record('tool_requested', {
      requestId: value.requestId,
      operation,
      argumentsSha256: hash
    });

    const mutatingWorkspace = operation === 'workspace.edit' || operation === 'workspace.run_command';
    const modeBReseal = operation === 'foundry.seal_check' && args.reseal === true;

    entry.inFlight = (async () => {
      if ((mutatingWorkspace || modeBReseal) && !allowModeB) {
        const errorMsg = modeBReseal
          ? 'Resealing foundry_manifest.json (Mode B) is locked in Mode A. Enable Developer Mode B first.'
          : 'Source-code editing and local commands (Mode B) are locked in Mode A. Enable Developer Mode B to unlock mutating workspace tools.';
        entry.result = {
          ok: false,
          error: errorMsg,
          ecosystem,
          sessionId: options.sessionId
        };
        record('workspace_operation_audit', {
          requestId: value.requestId,
          allowModeB: false,
          operation,
          ok: false,
          path: args.path || (Array.isArray(args.edits) ? args.edits.map(e => e?.path).filter(Boolean).join(', ') : null),
          editCount: Array.isArray(args.edits) ? args.edits.length : (operation === 'workspace.edit' ? 1 : undefined),
          command: args.command || null,
          args: Array.isArray(args.args) ? args.args : undefined,
          error: errorMsg
        });
      } else {
        try {
          const result = await execute(operation, args);
          const failed = result?.ok === false;
          entry.result = {
            ok: !failed,
            result,
            ...(failed ? { error: result.message || result.error || 'The local operation could not finish' } : {}),
            ecosystem,
            sessionId: options.sessionId
          };
        } catch (error) {
          entry.result = {
            ok: false,
            error: error?.message || String(error),
            ecosystem,
            sessionId: options.sessionId
          };
        }
        if (mutatingWorkspace || modeBReseal) {
          record('workspace_operation_audit', {
            requestId: value.requestId,
            allowModeB: true,
            operation,
            ok: entry.result.ok,
            path: args.path || (Array.isArray(args.edits) ? args.edits.map(e => e?.path).filter(Boolean).join(', ') : null),
            editCount: Array.isArray(args.edits) ? args.edits.length : (operation === 'workspace.edit' ? 1 : undefined),
            command: args.command || null,
            args: Array.isArray(args.args) ? args.args : undefined,
            exitCode: entry.result.result?.exitCode ?? null,
            bytes: entry.result.result?.bytes ?? entry.result.result?.totalBytes ?? null,
            sha256: entry.result.result?.sha256 ?? null,
            airGapSurfaceWarning: entry.result.result?.airGapSurfaceWarning ?? false,
            error: entry.result.error || null
          });
        }
      }

      state.phase = entry.result.ok ? 'connected' : 'fault';
      state.message = entry.result.ok
        ? `Desktop MCP tool ${operation} completed.`
        : `Desktop MCP tool ${operation} failed: ${entry.result.error || 'Operation declined'}`;

      record('tool_completed', {
        requestId: value.requestId,
        operation,
        ok: entry.result.ok,
        message: state.message
      });

      return entry.result;
    })();

    await entry.inFlight;
    delete entry.inFlight;
    return entry.result;
  }

  const resolveSurfaceInfo = () => {
    if (options.foundryRoot || options.manifestRoot) {
      return readManifestSurfaceInfo(options.foundryRoot || options.manifestRoot);
    }
    const wsInfo = readManifestSurfaceInfo(workspace);
    return wsInfo.ok ? wsInfo : readManifestSurfaceInfo();
  };
  const surfaceInfo = resolveSurfaceInfo();
  const foundryVersion = surfaceInfo.foundryVersion || '2.0.0';
  const codeSurfaceSha256 = surfaceInfo.codeSurfaceSha256 || null;
  const toolsSha256 = TOOLS_SHA256;

  const broker = await createBroker(stateDir, handleTool);
  const manifest = {
    schema: 'topogen.foundry.agent-session.v1',
    endpoint: broker.endpoint,
    token,
    sessionId: options.sessionId,
    ecosystem,
    mode: 'desktop',
    pid: process.pid,
    foundryVersion,
    codeSurfaceSha256,
    toolsSha256
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  fs.writeFileSync(toolFile, JSON.stringify(toolDefinitions, null, 2) + '\n', { mode: 0o600 });

  function status() {
    return {
      ...state,
      allowModeB,
      projectRoot: workspace,
      scratch,
      manifestPath,
      ledgerPath: ledger,
      foundryVersion,
      codeSurfaceSha256,
      toolsSha256,
      toolCount: toolDefinitions.length,
      receiptCount: toolReceipts.size,
      events: [...state.events]
    };
  }

  function setAllowModeB(next) {
    allowModeB = Boolean(next);
    record('mode_b_changed', { allowModeB });
    return status();
  }

  function desktopConfig({ pinSession = true } = {}) {
    const mcpArgs = pinSession
      ? [path.join(directory, 'mcp.mjs'), '--session', manifestPath, '--ecosystem', ecosystem]
      : [path.join(directory, 'mcp.mjs'), '--ecosystem', ecosystem];
    return {
      ecosystem,
      sessionId: options.sessionId,
      serverName: 'topogen_fdm_foundry',
      server: {
        command: process.execPath,
        args: mcpArgs,
        env: { TOPOGEN_ECOSYSTEM: ecosystem, ALICE_ECOSYSTEM: ecosystem }
      },
      message: 'Add this MCP server to Antigravity or Codex Desktop.'
    };
  }

  function sessionManifest() {
    return { ...manifest };
  }

  async function close() {
    if (closed) return;
    closed = true;
    await broker.close();
  }

  return {
    status,
    setAllowModeB,
    desktopConfig,
    sessionManifest,
    manifestPath,
    close
  };
}

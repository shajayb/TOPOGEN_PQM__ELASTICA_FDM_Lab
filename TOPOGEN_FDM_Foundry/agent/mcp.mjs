import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveEcosystem } from './ecosystem.mjs';
import {
  antigravityMcpConfigFile,
  foundryEcosystemDir,
  latestSessionManifestFile,
} from './desktop-binding.mjs';
import {
  toolDefinitions,
  validateTool,
  TOOLS_SHA256,
  readManifestSurfaceInfo,
} from './tools.mjs';
import { brokerCall } from './broker.mjs';
import { spawnChromeUrl } from './chrome-launcher.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const manifestRoot = process.env.TOPOGEN_MCP_MANIFEST_ROOT
  ? path.resolve(process.env.TOPOGEN_MCP_MANIFEST_ROOT)
  : path.resolve(directory, '..');
const startupSurface = readManifestSurfaceInfo(manifestRoot);
const MCP_SERVER_VERSION = '2.1.0';
const mcpFoundryVersion = startupSurface.foundryVersion || '2.0.0';
const mcpCodeSurfaceSha256 = process.env.TOPOGEN_MCP_CODE_SURFACE_SHA256_OVERRIDE || startupSurface.codeSurfaceSha256 || null;
const mcpToolsSha256 = process.env.TOPOGEN_MCP_TOOLS_SHA256_OVERRIDE || TOOLS_SHA256;
let lastConnectedManifest = null;

function computeSurfaceDrift(daemonManifest, diskSurface, inspectResult = null) {
  const mcp = {
    foundryVersion: mcpFoundryVersion,
    codeSurfaceSha256: mcpCodeSurfaceSha256,
    toolsSha256: mcpToolsSha256,
  };
  const daemon = {
    foundryVersion: daemonManifest?.foundryVersion ?? null,
    codeSurfaceSha256: daemonManifest?.codeSurfaceSha256 ?? null,
    toolsSha256: daemonManifest?.toolsSha256 ?? null,
  };
  const disk = {
    foundryVersion: diskSurface?.foundryVersion ?? null,
    codeSurfaceSha256: diskSurface?.codeSurfaceSha256 ?? null,
    ok: Boolean(diskSurface?.ok),
  };

  const reasons = [];
  const remediations = [];
  const addRemediation = msg => {
    if (!remediations.includes(msg)) remediations.push(msg);
  };

  if (daemon.toolsSha256 && daemon.toolsSha256 !== mcp.toolsSha256) {
    reasons.push(`mcp.mjs toolsSha256 (${mcp.toolsSha256.slice(0, 12)}) differs from active daemon (${daemon.toolsSha256.slice(0, 12)})`);
    addRemediation('Refresh topogen_fdm_foundry in Antigravity MCP settings');
  }
  if (daemon.codeSurfaceSha256 && mcp.codeSurfaceSha256 && daemon.codeSurfaceSha256 !== mcp.codeSurfaceSha256) {
    reasons.push(`mcp.mjs codeSurfaceSha256 (${mcp.codeSurfaceSha256.slice(0, 12)}) differs from active daemon (${daemon.codeSurfaceSha256.slice(0, 12)})`);
    addRemediation('Refresh topogen_fdm_foundry in Antigravity MCP settings');
  }
  if (disk.ok && disk.codeSurfaceSha256 && mcp.codeSurfaceSha256 && disk.codeSurfaceSha256 !== mcp.codeSurfaceSha256) {
    reasons.push(`mcp.mjs codeSurfaceSha256 (${mcp.codeSurfaceSha256.slice(0, 12)}) differs from on-disk foundry_manifest.json (${disk.codeSurfaceSha256.slice(0, 12)})`);
    addRemediation('Refresh topogen_fdm_foundry in Antigravity MCP settings');
  }
  if (disk.ok && daemon.codeSurfaceSha256 && disk.codeSurfaceSha256 && daemon.codeSurfaceSha256 !== disk.codeSurfaceSha256) {
    reasons.push(`Active daemon codeSurfaceSha256 (${daemon.codeSurfaceSha256.slice(0, 12)}) differs from on-disk foundry_manifest.json (${disk.codeSurfaceSha256.slice(0, 12)})`);
    addRemediation('Restart foundry_server.mjs');
  }
  const diskUnsealed = disk.ok && (!disk.codeSurfaceSha256 || disk.codeSurfaceSha256 === 'UNSEALED' || /^PENDING/i.test(disk.codeSurfaceSha256));
  const inspectSealDirty = Boolean(
    inspectResult &&
    ((inspectResult.manifestSeal && inspectResult.manifestSeal.ok === false) ||
      (inspectResult.seal && inspectResult.seal.ok === false))
  );
  if (diskUnsealed) {
    reasons.push('On-disk foundry_manifest.json codeSurfaceSha256 is unsealed');
    addRemediation('Reseal foundry_manifest.json in Mode B');
  } else if (inspectSealDirty) {
    reasons.push('Sealed code or verifier files on disk differ from foundry_manifest.json');
    addRemediation('Reseal foundry_manifest.json in Mode B');
  }

  if (reasons.length === 0) return null;
  return {
    detected: true,
    reasons,
    remediation: remediations[0],
    remediations,
    mcp,
    daemon,
    disk: {
      foundryVersion: disk.foundryVersion,
      codeSurfaceSha256: disk.codeSurfaceSha256,
    },
  };
}

function attachSurfaceDrift(toolName, response) {
  if (!response || typeof response !== 'object') return response;
  const diskSurface = readManifestSurfaceInfo(manifestRoot);
  const inspectResult = toolName === 'topogen_inspect' && response.result && typeof response.result === 'object'
    ? response.result
    : null;
  const drift = computeSurfaceDrift(lastConnectedManifest, diskSurface, inspectResult);

  if (toolName === 'topogen_inspect') {
    if (inspectResult) {
      inspectResult.surfaceDrift = drift;
      inspectResult.mcp = {
        ...(inspectResult.mcp && typeof inspectResult.mcp === 'object' ? inspectResult.mcp : {}),
        foundryVersion: mcpFoundryVersion,
        codeSurfaceSha256: mcpCodeSurfaceSha256,
        toolsSha256: mcpToolsSha256,
        surfaceDrift: drift,
      };
    }
    response.surfaceDrift = drift;
  } else if (drift !== null) {
    response.surfaceDrift = drift;
  }
  return response;
}
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  if (!['--session', '--ecosystem'].includes(process.argv[i]) || !process.argv[i + 1]) {
    throw Error('Usage: mcp.mjs [--session FILE] [--ecosystem antigravity|codex]');
  }
  options[process.argv[i]] = process.argv[i + 1];
}
const ecosystem = resolveEcosystem(options['--ecosystem']);

function readManifest(sessionPath) {
  const stat = fs.statSync(sessionPath);
  const manifest = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
  if (manifest.ecosystem !== ecosystem || manifest.schema !== 'topogen.foundry.agent-session.v1') {
    throw Error('MCP session ecosystem or schema mismatch');
  }
  return { manifest, mtimeMs: stat.mtimeMs, sessionPath };
}

function listCandidateManifests(minMtimeMs = 0) {
  const candidates = [];
  const seen = new Set();
  const seenEndpoints = new Set();
  const addPath = p => {
    if (typeof p !== 'string' || !p || seen.has(p)) return;
    seen.add(p);
    try {
      if (!fs.existsSync(p)) return;
      const entry = readManifest(p);
      if (entry.mtimeMs >= minMtimeMs && !seenEndpoints.has(entry.manifest.endpoint)) {
        seenEndpoints.add(entry.manifest.endpoint);
        candidates.push(entry);
      }
    } catch {}
  };

  // 1. Explicit CLI --session (used by isolated unit tests or pinned sessions)
  if (options['--session']) addPath(options['--session']);

  // 2. Atomic latest-session.json pointer written by the most recently started daemon
  addPath(latestSessionManifestFile(ecosystem));

  // 3. Optional --session pinned in mcp_config.json (legacy compatibility)
  if (ecosystem === 'antigravity') {
    try {
      const cfgPath = antigravityMcpConfigFile();
      if (fs.existsSync(cfgPath)) {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        const args = cfg?.mcpServers?.topogen_fdm_foundry?.args;
        const idx = Array.isArray(args) ? args.indexOf('--session') : -1;
        if (idx >= 0) addPath(args[idx + 1]);
      }
    } catch {}
  }

  // 4. Recent session folders sorted newest-first
  const ecoDir = foundryEcosystemDir(ecosystem);
  try {
    if (fs.existsSync(ecoDir)) {
      const recent = [];
      for (const name of fs.readdirSync(ecoDir, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        const candidate = path.join(ecoDir, name.name, 'agent-session.json');
        if (seen.has(candidate)) continue;
        try {
          if (!fs.existsSync(candidate)) continue;
          const entry = readManifest(candidate);
          if (entry.mtimeMs >= minMtimeMs) recent.push(entry);
        } catch {}
      }
      recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of recent) {
        if (seenEndpoints.has(entry.manifest.endpoint)) continue;
        seen.add(entry.sessionPath);
        seenEndpoints.add(entry.manifest.endpoint);
        candidates.push(entry);
      }
    }
  } catch {}

  return candidates;
}

function isConnectionError(error) {
  const code = error?.code || '';
  if (['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(code)) return true;
  const msg = String(error?.message || '');
  return msg.includes('ENOENT') || msg.includes('ECONNREFUSED');
}

function resolveEnvConversationId() {
  const raw = process.env.ANTIGRAVITY_CONVERSATION_ID
    || process.env.ANTIGRAVITY_TRAJECTORY_ID
    || process.env.TOPOGEN_CONVERSATION_ID
    || process.env.CODEX_THREAD_ID
    || '';
  const trimmed = raw.trim();
  return /^[a-zA-Z0-9._:-]{1,120}$/.test(trimmed) ? trimmed : null;
}

let launchInFlight = null;
async function ensureFoundryDaemonRunning() {
  if (process.env.TOPOGEN_MCP_NO_AUTOLAUNCH === '1') {
    throw Error('TOPOGEN Foundry daemon is offline and auto-launch is disabled.');
  }
  if (launchInFlight) return launchInFlight;
  launchInFlight = (async () => {
    const serverScript = path.resolve(directory, '..', 'foundry_server.mjs');
    if (!fs.existsSync(serverScript)) {
      throw Error('TOPOGEN Foundry daemon is not running and foundry_server.mjs could not be found.');
    }
    const launchTime = Date.now();
    const child = spawn(
      process.execPath,
      [serverScript, '--no-browser', '--mcp-auto', '--ecosystem', ecosystem],
      {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...process.env, TOPOGEN_ECOSYSTEM: ecosystem, ALICE_ECOSYSTEM: ecosystem }
      }
    );
    child.unref();

    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 400));
      const candidates = listCandidateManifests(launchTime - 2000);
      for (const { manifest } of candidates) {
        try {
          const check = await brokerCall(manifest.endpoint, {
            tool: 'topogen_inspect',
            arguments: {},
            ecosystem,
            sessionId: manifest.sessionId,
            token: manifest.token,
            requestId: crypto.randomUUID()
          }, 5000);
          if (check?.ok === true) return candidates;
        } catch {}
      }
    }
    throw Error('Launched TOPOGEN Foundry daemon, but it did not become ready within 30 seconds.');
  })();
  try {
    return await launchInFlight;
  } finally {
    launchInFlight = null;
  }
}

async function callWithAutoLaunch(name, args) {
  const payloadFor = manifest => ({
    tool: name,
    arguments: args,
    ecosystem,
    sessionId: manifest.sessionId,
    token: manifest.token,
    requestId: crypto.randomUUID()
  });

  const tryCandidates = async candidates => {
    let lastConnError = null;
    for (const { manifest } of candidates) {
      try {
        const res = await brokerCall(manifest.endpoint, payloadFor(manifest));
        lastConnectedManifest = manifest;
        return res;
      } catch (error) {
        if (!isConnectionError(error)) throw error;
        lastConnError = error;
      }
    }
    return { notConnected: true, lastConnError };
  };

  const firstAttempt = await tryCandidates(listCandidateManifests());
  if (!firstAttempt?.notConnected) return firstAttempt;

  const launchedCandidates = await ensureFoundryDaemonRunning();
  const deadline = Date.now() + 15000;
  let lastError = firstAttempt.lastConnError;
  let candidates = launchedCandidates;
  while (Date.now() < deadline) {
    const attempt = await tryCandidates(candidates);
    if (!attempt?.notConnected) return attempt;
    lastError = attempt.lastConnError || lastError;
    await new Promise(resolve => setTimeout(resolve, 400));
    candidates = listCandidateManifests();
  }
  throw lastError || Error('Failed to connect to TOPOGEN Foundry daemon after launching it.');
}

async function invokeToolWithUnsandboxedFallback(name, rawArgs) {
  const effectiveArgs = { ...rawArgs };
  if (name.startsWith('topogen_ui_') && effectiveArgs.conversationId === undefined) {
    const envConv = resolveEnvConversationId();
    if (envConv) {
      effectiveArgs.conversationId = envConv;
    }
  }
  validateTool(name, effectiveArgs);

  const response = await callWithAutoLaunch(name, effectiveArgs);

  // L6 Fix: If daemon was started inside a restricted sandbox where spawning desktop Chrome
  // timed out on NO_HANDSHAKE, spawn Chrome directly from this unsandboxed Desktop MCP process!
  const resBody = response?.result;
  if (
    response?.ok === false &&
    resBody?.code === 'NO_HANDSHAKE' &&
    typeof resBody.launchUrl === 'string' &&
    typeof resBody.launchId === 'string'
  ) {
    const localSpawn = await spawnChromeUrl(resBody.launchUrl, {
      chromePath: resBody.chromePath || null,
    });
    if (localSpawn.ok) {
      const waitArgs = {
        ...(effectiveArgs.conversationId ? { conversationId: effectiveArgs.conversationId } : {}),
        surface: resBody.surface || effectiveArgs.surface || 'workbench',
        waitOnlyLaunchId: resBody.launchId,
        waitMs: Number.isInteger(effectiveArgs.waitMs) ? effectiveArgs.waitMs : 8000,
        ...(name === 'topogen_ui_launch' ? {
          ...(effectiveArgs.preset ? { preset: effectiveArgs.preset } : {}),
          ...(effectiveArgs.grid ? { grid: effectiveArgs.grid } : {}),
          ...(effectiveArgs.gridResolution !== undefined ? { gridResolution: effectiveArgs.gridResolution } : {}),
          ...(effectiveArgs.tab ? { tab: effectiveArgs.tab } : {}),
        } : {}),
      };
      const handshakeRes = await callWithAutoLaunch('topogen_ui_launch', waitArgs);
      if (name === 'topogen_ui_launch' || handshakeRes?.ok !== true) {
        return handshakeRes;
      }
      return await callWithAutoLaunch(name, {
        ...effectiveArgs,
        ...(handshakeRes.result?.clientId ? { clientId: handshakeRes.result.clientId } : {}),
      });
    }
  }

  return response;
}

const output = value => process.stdout.write(JSON.stringify(value) + '\n');

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const inFlightRequests = new Set();

async function handleRpcLine(line) {
  if (!line.trim()) return;
  let request;
  try {
    if (Buffer.byteLength(line, 'utf8') > 262144) throw Error('MCP request exceeds limit');
    request = JSON.parse(line);
    if (!Object.hasOwn(request, 'id')) return;
    let result;
    if (request.method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: {
          name: 'topogen_fdm_foundry',
          version: MCP_SERVER_VERSION,
          foundryVersion: mcpFoundryVersion,
          codeSurfaceSha256: mcpCodeSurfaceSha256,
          toolsSha256: mcpToolsSha256
        }
      };
    } else if (request.method === 'ping') {
      result = {};
    } else if (request.method === 'tools/list') {
      result = { tools: toolDefinitions };
    } else if (request.method === 'tools/call') {
      const name = request.params?.name;
      const args = request.params?.arguments || {};
      const response = attachSurfaceDrift(name, await invokeToolWithUnsandboxedFallback(name, args));
      result = {
        isError: response.ok !== true,
        content: [{ type: 'text', text: JSON.stringify(response) }]
      };
    } else {
      throw Error('Unknown MCP method');
    }
    output({ jsonrpc: '2.0', id: request.id, result });
  } catch (error) {
    output({
      jsonrpc: '2.0',
      id: request?.id ?? null,
      error: { code: -32602, message: error?.message || String(error) }
    });
  }
}

rl.on('line', line => {
  const pending = handleRpcLine(line).finally(() => {
    inFlightRequests.delete(pending);
  });
  inFlightRequests.add(pending);
});

await new Promise(resolve => rl.once('close', resolve));
await Promise.allSettled(Array.from(inFlightRequests));

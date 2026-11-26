#!/usr/bin/env node
/**
 * TOPOGEN FDM Foundry — Unified Foundry-Ready CLI
 *
 * Strict Air-Gap Architecture:
 *   - NEVER imports `core/*` or `verifier/*` directly.
 *   - `generate` spawns `run_generator.mjs` as an isolated child process.
 *   - `verify` and `bench` spawn `verifier/verify.mjs` and `verifier/test_verifier.mjs`
 *     as isolated child processes.
 *   - `eval`, `batch`, and `run` delegate to `foundry_runner.mjs` which executes
 *     Generator and Verifier in separate isolated `worker_threads` pools.
 *   - `seal` delegates to `scripts/foundry_mode_guard.mjs`.
 *   - `launch` / `open`, `mode`, `tabs`, and `serve` coordinate with `foundry_server.mjs`
 *     over local HTTP (`127.0.0.1:<port>`), launching Google Chrome bound to the
 *     active conversation and keeping Desktop MCP (`mcp_config.json`) synced.
 *   - `ui` dispatches structured `topogen_ui_*` calls through `agent/broker.mjs`
 *     with `arguments` + auto-resolved `conversationId` (eliminating ad-hoc scripts).
 *   - `mcp` delegates to `agent/mcp.mjs` & `agent/desktop-binding.mjs`.
 *   - `report` delegates to `build_report.mjs`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  FOUNDRY_ROOT,
  CANONICAL_GATES,
  computeFoundrySeal,
  quickEvaluateCandidate,
  FoundryCampaignRunner,
  shutdownSharedWorkerPools,
} from '../foundry_runner.mjs';
import { brokerCall } from '../agent/broker.mjs';
import {
  UI_STEPS,
  UI_STEP_MODES,
  UI_LOAD_TARGETS,
  UI_EXPORT_FORMATS,
} from '../agent/ui-action-contract.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(FOUNDRY_ROOT, '..');

const PATHS = {
  modeGuard: path.join(FOUNDRY_ROOT, 'scripts', 'foundry_mode_guard.mjs'),
  generatorCli: path.join(FOUNDRY_ROOT, 'run_generator.mjs'),
  verifierCli: path.join(FOUNDRY_ROOT, 'verifier', 'verify.mjs'),
  verifierBenchCli: path.join(FOUNDRY_ROOT, 'verifier', 'test_verifier.mjs'),
  reportBuilderCli: path.join(FOUNDRY_ROOT, 'build_report.mjs'),
  serverCli: path.join(FOUNDRY_ROOT, 'foundry_server.mjs'),
  mcpCli: path.join(FOUNDRY_ROOT, 'agent', 'mcp.mjs'),
  desktopBinding: path.join(FOUNDRY_ROOT, 'agent', 'desktop-binding.mjs'),
  ecosystemMod: path.join(FOUNDRY_ROOT, 'agent', 'ecosystem.mjs'),
  briefsDir: path.join(FOUNDRY_ROOT, 'briefs'),
  runsDir: path.join(FOUNDRY_ROOT, 'runs'),
  benchCacheJson: path.join(FOUNDRY_ROOT, 'runs', '.bench_cache.json'),
};

const PURE_BOOLEAN_FLAGS = new Set([
  'help', 'version', 'json', 'text', 'force', 'ndjson', 'stdin-jsonl',
  'keep-failed', 'force-benchmarks', 'verify', 'reseal', 'skip-bench',
  'self-test', 'allow-mode-b', 'bind-mcp', 'no-browser', 'mcp-auto',
  'print-config', 'bind', 'unbind', 'workbench', 'launcher', 'new-tab',
  'B', 'A', 'status', 'verbose', 'focused-chrome', 'claim-focused-chrome',
  'custom-only', 'fit-to-voxel', 'clear-existing', 'restart', 'download',
  'skeletonize', 'skeletonize-mesh', 'mesh-only',
  'elastica-top-sources', 'elastica-ground-sinks', 'elastica-clear',
  'print-data', 'preserve-state', 'hard-reload', 'clear-voxel-pins',
]);

const REPEATABLE_FLAGS = new Set([
  'pin-voxel',
]);

// ============================================================================
// Argument Parsing & Conversation / Daemon Helpers
// ============================================================================

export function parseArgv(argv) {
  const flags = {};
  const positional = [];
  const setFlag = (key, val) => {
    if (REPEATABLE_FLAGS.has(key)) {
      if (!Array.isArray(flags[key])) flags[key] = [];
      flags[key].push(val);
    } else {
      flags[key] = val;
    }
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (tok.startsWith('--')) {
      const eqIdx = tok.indexOf('=');
      if (eqIdx !== -1) {
        const key = tok.slice(2, eqIdx);
        setFlag(key, tok.slice(eqIdx + 1));
      } else {
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (key.startsWith('no-') && (next === undefined || next.startsWith('-') || !/^(true|false|0|1|yes|no|on|off)$/i.test(next))) {
          flags[key.slice(3)] = false;
          flags[key] = true;
        } else if (next === undefined || next.startsWith('--')) {
          setFlag(key, true);
        } else if (PURE_BOOLEAN_FLAGS.has(key) && !/^(true|false|0|1|yes|no|on|off)$/i.test(next)) {
          setFlag(key, true);
        } else {
          setFlag(key, next);
          i++;
        }
      }
    } else if (tok === '-h') {
      flags.help = true;
    } else if (tok === '-v') {
      flags.version = true;
    } else if (tok === '-B') {
      flags.B = true;
    } else if (tok === '-A') {
      flags.A = true;
    } else {
      positional.push(tok);
    }
  }
  return { flags, positional };
}

function parseBool(val, defaultVal = true) {
  if (val === undefined) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
  return defaultVal;
}

export function resolveConversationId(flags = {}, env = process.env) {
  const candidates = [
    flags.conv,
    flags.conversation,
    flags['conversation-id'],
    env?.ANTIGRAVITY_CONVERSATION_ID,
    env?.ANTIGRAVITY_TRAJECTORY_ID,
    env?.TOPOGEN_CONVERSATION_ID,
    env?.CODEX_THREAD_ID,
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.length > 0 && trimmed.length <= 120) {
        return trimmed;
      }
    }
  }
  return null;
}

async function resolveEcosystemCli(explicitFlag, env = process.env) {
  if (fs.existsSync(PATHS.ecosystemMod)) {
    const ecoMod = await import(pathToFileURL(PATHS.ecosystemMod).href);
    if (typeof ecoMod.resolveEcosystem === 'function') {
      return ecoMod.resolveEcosystem(
        typeof explicitFlag === 'string' ? explicitFlag : undefined,
        env
      );
    }
  }
  const raw = String(explicitFlag || env?.TOPOGEN_ECOSYSTEM || env?.ALICE_ECOSYSTEM || 'antigravity')
    .trim()
    .toLowerCase();
  return raw === 'codex' ? 'codex' : 'antigravity';
}

function resolvePort(flags = {}, env = process.env) {
  const p = Number(flags.port ?? env?.FOUNDRY_PORT ?? 8787);
  if (!Number.isFinite(p) || p < 1 || p > 65535) {
    throw new Error(`Invalid --port "${flags.port}". Expected 1..65535.`);
  }
  return Math.trunc(p);
}

function resolveRequestedMode(flags = {}, positional = []) {
  if (flags.B === true || flags['allow-mode-b'] === true) return 'B';
  if (flags.A === true || flags['allow-mode-b'] === false) return 'A';
  if (typeof flags['allow-mode-b'] === 'string') {
    return parseBool(flags['allow-mode-b'], false) ? 'B' : 'A';
  }
  if (typeof flags.mode === 'string') {
    const m = flags.mode.trim().toUpperCase();
    if (m === 'A' || m === 'B') return m;
  }
  if (typeof positional[0] === 'string') {
    const p = positional[0].trim().toUpperCase();
    if (p === 'A' || p === 'B') return p;
  }
  return null;
}

function httpRequestJson(port, method, pathname, bodyObj = undefined, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const payloadStr = bodyObj !== undefined ? JSON.stringify(bodyObj) : null;
    const headers = {
      Accept: 'application/json',
      Origin: `http://127.0.0.1:${port}`,
    };
    if (payloadStr !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payloadStr, 'utf8');
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let data = null;
          if (raw.trim().length > 0) {
            try {
              data = JSON.parse(raw);
            } catch {
              data = { raw };
            }
          }
          const status = res.statusCode ?? 0;
          resolve({
            ok: status >= 200 && status < 300,
            status,
            headers: res.headers,
            data,
          });
        });
      }
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(new Error(`HTTP ${method} ${pathname} timed out after ${timeoutMs}ms`), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    if (payloadStr !== null) req.write(payloadStr);
    req.end();
  });
}

async function probeHealth(port, timeoutMs = 2000) {
  try {
    const res = await httpRequestJson(port, 'GET', '/api/health', undefined, timeoutMs);
    if (res.ok && res.data && res.data.status === 'online') {
      return res.data;
    }
    return null;
  } catch {
    return null;
  }
}

async function ensureMcpBoundOnDaemon(port, ecosystem) {
  if (ecosystem !== 'antigravity') return { bound: false, reason: 'non-antigravity' };
  try {
    const res = await httpRequestJson(port, 'POST', '/api/agent/mcp-bind', {}, 5000);
    if (res.ok && res.data?.bound) {
      return { bound: true, configPath: res.data.configPath || null };
    }
  } catch {}
  if (fs.existsSync(PATHS.desktopBinding)) {
    const bindMod = await import(pathToFileURL(PATHS.desktopBinding).href);
    const serverConfig = {
      command: process.execPath,
      args: [PATHS.mcpCli, '--ecosystem', ecosystem],
      env: { TOPOGEN_ECOSYSTEM: ecosystem },
    };
    const configPath = await bindMod.bindAntigravityMcp(serverConfig);
    return { bound: true, configPath };
  }
  return { bound: false };
}

async function syncDaemonMode(port, targetMode) {
  if (targetMode !== 'A' && targetMode !== 'B') return null;
  const allowModeB = targetMode === 'B';
  const res = await httpRequestJson(
    port,
    'POST',
    '/api/mode',
    { allowModeB, executionMode: targetMode },
    5000
  );
  if (!res.ok) {
    throw new Error(res.data?.error || `Failed to switch daemon mode to ${targetMode} (HTTP ${res.status})`);
  }
  return res.data;
}

async function ensureDaemonOnline({
  port = 8787,
  ecosystem = 'antigravity',
  requestedMode = null,
  shouldBindMcp = ecosystem === 'antigravity',
  startupTimeoutMs = 20000,
} = {}) {
  let health = await probeHealth(port, 2000);
  let spawned = false;

  if (!health) {
    const args = ['--port', String(port), '--no-browser', '--ecosystem', ecosystem];
    if (requestedMode === 'B') args.push('--allow-mode-b');
    if (shouldBindMcp) args.push('--bind-mcp');
    else args.push('--no-bind-mcp');

    const child = spawn(process.execPath, [PATHS.serverCli, ...args], {
      cwd: FOUNDRY_ROOT,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env: {
        ...process.env,
        TOPOGEN_ECOSYSTEM: ecosystem,
        ALICE_ECOSYSTEM: ecosystem,
      },
    });
    child.unref();
    spawned = true;

    const deadline = Date.now() + startupTimeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250));
      health = await probeHealth(port, 2000);
      if (health) break;
    }
    if (!health) {
      throw new Error(`Started foundry_server.mjs on 127.0.0.1:${port}, but /api/health did not come online within ${startupTimeoutMs}ms.`);
    }
  } else {
    if (requestedMode === 'A' || requestedMode === 'B') {
      await syncDaemonMode(port, requestedMode);
    }
    if (shouldBindMcp) {
      await ensureMcpBoundOnDaemon(port, ecosystem);
    }
    health = (await probeHealth(port, 2500)) || health;
  }

  return { health, spawned, reusedDaemon: !spawned };
}

function localAppDataDir() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  return path.join(os.homedir(), '.local', 'share');
}

function tryReadSessionManifest(filePath, expectedEcosystem) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (raw && typeof raw === 'object') {
      if (typeof raw.manifestPath === 'string' && raw.manifestPath !== filePath && fs.existsSync(raw.manifestPath)) {
        return tryReadSessionManifest(raw.manifestPath, expectedEcosystem);
      }
      if (typeof raw.sessionPath === 'string' && raw.sessionPath !== filePath && fs.existsSync(raw.sessionPath)) {
        return tryReadSessionManifest(raw.sessionPath, expectedEcosystem);
      }
      if (
        (!expectedEcosystem || !raw.ecosystem || raw.ecosystem === expectedEcosystem) &&
        typeof raw.endpoint === 'string' &&
        typeof raw.sessionId === 'string' &&
        typeof raw.token === 'string'
      ) {
        return { manifest: raw, mtimeMs: stat.mtimeMs, sessionPath: filePath };
      }
    }
  } catch {}
  return null;
}

function discoverBrokerManifests(ecosystem, explicitSessionFile = undefined) {
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (p) => {
    if (!p || seen.has(p)) return;
    const entry = tryReadSessionManifest(p, ecosystem);
    if (entry && !seen.has(entry.sessionPath)) {
      seen.add(p);
      seen.add(entry.sessionPath);
      candidates.push(entry);
    }
  };

  if (explicitSessionFile) {
    pushCandidate(path.resolve(process.cwd(), String(explicitSessionFile)));
  }

  const ecoDir = path.join(localAppDataDir(), 'Topogen', 'Foundry', ecosystem);
  pushCandidate(path.join(ecoDir, 'latest-session.json'));

  try {
    if (fs.existsSync(ecoDir)) {
      const discovered = [];
      for (const name of fs.readdirSync(ecoDir)) {
        const p = path.join(ecoDir, name, 'agent-session.json');
        if (seen.has(p)) continue;
        const entry = tryReadSessionManifest(p, ecosystem);
        if (entry) discovered.push(entry);
      }
      discovered.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of discovered) {
        if (!seen.has(entry.sessionPath)) {
          seen.add(entry.sessionPath);
          candidates.push(entry);
        }
      }
    }
  } catch {}

  return candidates;
}

function isBrokerConnError(err) {
  const code = err?.code || '';
  if (['ENOENT', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE'].includes(code)) return true;
  const msg = String(err?.message || '');
  return msg.includes('ENOENT') || msg.includes('ECONNREFUSED') || msg.includes('disconnected');
}

async function discoverPortMatchedManifest(port, ecosystem) {
  try {
    const res = await httpRequestJson(port, 'GET', '/api/agent/status', undefined, 1500);
    if (res.ok && res.data?.agent?.manifestPath) {
      const entry = tryReadSessionManifest(res.data.agent.manifestPath, ecosystem);
      if (entry) return entry;
    }
  } catch {}
  return null;
}

async function callDaemonTool(toolName, toolArgs = {}, opts = {}) {
  const ecosystem = opts.ecosystem || 'antigravity';
  const port = opts.port || 8787;
  const explicitPort = Boolean(opts.explicitPort);
  const timeoutMs = opts.timeoutMs || 60000;

  const buildManifestList = async () => {
    const list = [];
    const seenPaths = new Set();
    if (!opts.sessionFile) {
      const portEntry = await discoverPortMatchedManifest(port, ecosystem);
      if (portEntry) {
        list.push(portEntry);
        seenPaths.add(portEntry.sessionPath);
        if (explicitPort) return list;
      } else if (explicitPort) {
        return list;
      }
    }
    for (const item of discoverBrokerManifests(ecosystem, opts.sessionFile)) {
      if (!seenPaths.has(item.sessionPath)) {
        seenPaths.add(item.sessionPath);
        list.push(item);
      }
    }
    return list;
  };

  const tryAll = async (manifests) => {
    let lastConnErr = null;
    for (const { manifest } of manifests) {
      try {
        const invoke = async (argsToSend) => brokerCall(
          manifest.endpoint,
          {
            tool: toolName,
            arguments: argsToSend,
            ecosystem,
            sessionId: manifest.sessionId,
            token: manifest.token,
            requestId: crypto.randomUUID(),
          },
          timeoutMs
        );
        let res = await invoke(toolArgs);
        if (
          res &&
          res.ok === false &&
          typeof res.error === 'string' &&
          res.error.includes('Unexpected tool argument: conversationId') &&
          Object.hasOwn(toolArgs, 'conversationId')
        ) {
          const fallbackArgs = { ...toolArgs };
          delete fallbackArgs.conversationId;
          res = await invoke(fallbackArgs);
        }
        return { connected: true, response: res, sessionId: manifest.sessionId };
      } catch (err) {
        if (!isBrokerConnError(err)) throw err;
        lastConnErr = err;
      }
    }
    return { connected: false, lastConnErr };
  };

  let attempt = await tryAll(await buildManifestList());
  if (attempt.connected) return attempt.response;

  await ensureDaemonOnline({
    port,
    ecosystem,
    shouldBindMcp: !explicitPort && ecosystem === 'antigravity',
  });

  attempt = await tryAll(await buildManifestList());
  if (attempt.connected) return attempt.response;

  throw attempt.lastConnErr || new Error(`Could not connect to TOPOGEN Foundry broker on port ${port} (${ecosystem}).`);
}

function parseGrid(gridVal) {
  if (Array.isArray(gridVal) && gridVal.length === 3) {
    return gridVal.map(Number);
  }
  if (!gridVal) return undefined;
  const parts = String(gridVal).split(/[x,]/i).map(Number);
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 1)) {
    return parts;
  }
  throw new Error(`Invalid --grid value "${gridVal}". Expected format like 2x2x3 or 2,2,3.`);
}

function resolveBriefPath(briefArg, fallbackName = 'pilot_v2_pq_unrolled.json') {
  if (!briefArg) {
    return path.join(PATHS.briefsDir, fallbackName);
  }
  const candidates = [
    path.resolve(process.cwd(), briefArg),
    path.resolve(FOUNDRY_ROOT, briefArg),
    path.join(PATHS.briefsDir, briefArg),
    path.join(PATHS.briefsDir, briefArg.endsWith('.json') ? briefArg : `${briefArg}.json`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  throw new Error(`Brief file not found: ${briefArg}`);
}

function loadJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function spawnNodeCaptured(scriptPath, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: opts.cwd || process.cwd(),
      env: opts.env || process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function spawnNodeInherited(scriptPath, args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: opts.cwd || process.cwd(),
      env: opts.env || process.env,
      stdio: 'inherit',
    });
    const forwardSig = (sig) => {
      try {
        child.kill(sig);
      } catch {}
    };
    process.on('SIGINT', forwardSig);
    process.on('SIGTERM', forwardSig);
    child.on('error', (err) => {
      process.off('SIGINT', forwardSig);
      process.off('SIGTERM', forwardSig);
      reject(err);
    });
    child.on('close', (code) => {
      process.off('SIGINT', forwardSig);
      process.off('SIGTERM', forwardSig);
      resolve(code ?? 1);
    });
  });
}

function buildConfigFromFlags(flags, base = {}) {
  const cfg = { ...base };
  if (flags.name !== undefined) cfg.name = String(flags.name);
  if (flags.preset !== undefined) cfg.tilePreset = String(flags.preset);
  if (flags.grid !== undefined) cfg.gridResolution = parseGrid(flags.grid);
  if (flags.mode !== undefined) cfg.fdmMode = String(flags.mode);
  if (flags.seed !== undefined) cfg.wfcSeed = Number(flags.seed);
  if (flags.radius !== undefined) cfg.outerRadiusM = Number(flags.radius);
  if (flags['inner-radius'] !== undefined) cfg.innerRadiusM = Number(flags['inner-radius']);
  if (flags.sides !== undefined) cfg.nSides = Number(flags.sides);
  if (flags['q-profile'] !== undefined) cfg.qProfile = String(flags['q-profile']);
  if (flags.subdiv !== undefined) cfg.longitudinalSubdivLevels = Number(flags.subdiv);
  if (flags.pq !== undefined) cfg.pqOptimization = parseBool(flags.pq, true);
  if (flags.unroll !== undefined) cfg.unrollPatterns = parseBool(flags.unroll, true);
  if (flags['auto-slenderness'] !== undefined) cfg.autoSlenderness = parseBool(flags['auto-slenderness'], false);
  if (flags['prune-tension'] !== undefined) cfg.pruneTension = parseBool(flags['prune-tension'], false);
  return cfg;
}

function writeEvalArtifacts(writeDir, name, evalRes, config) {
  const resolvedDir = path.resolve(process.cwd(), writeDir);
  fs.mkdirSync(resolvedDir, { recursive: true });
  const stem = name || config.name || 'candidate';
  const topoPath = path.join(resolvedDir, `${stem}.topology.json`);
  const objPath = path.join(resolvedDir, `${stem}.mesh.obj`);
  const verdictPath = path.join(resolvedDir, `${stem}.verdict.json`);
  const cfgPath = path.join(resolvedDir, `${stem}.config.json`);

  fs.writeFileSync(topoPath, JSON.stringify(evalRes.topologyJson, null, 2) + '\n', 'utf8');
  fs.writeFileSync(objPath, evalRes.objText, 'utf8');
  fs.writeFileSync(verdictPath, JSON.stringify(evalRes.verdict, null, 2) + '\n', 'utf8');
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n', 'utf8');

  const outputs = {
    topology: topoPath,
    meshObj: objPath,
    verdict: verdictPath,
    configJson: cfgPath,
  };

  if (evalRes.patternsSvg && evalRes.unrolledJson) {
    const svgPath = path.join(resolvedDir, `${stem}.patterns.svg`);
    const unrollPath = path.join(resolvedDir, `${stem}.unrolled.json`);
    fs.writeFileSync(svgPath, evalRes.patternsSvg, 'utf8');
    fs.writeFileSync(unrollPath, JSON.stringify(evalRes.unrolledJson, null, 2) + '\n', 'utf8');
    outputs.patternsSvg = svgPath;
    outputs.unrolledJson = unrollPath;
  }

  return outputs;
}

// ============================================================================
// Help Text
// ============================================================================

function printHelp() {
  const text = `TOPOGEN FDM Foundry CLI (v2.0.0)
Usage: topogen <command> [options]

Browser Launch & Live UI Bridge (Google Chrome + Conversation Affinity):
  launch    Ensure daemon & MCP are bound, open TOPOGEN in Google Chrome, and pair tab
  (open)    [--conv <id>]  [--workbench | --launcher]  [--reuse | --new-tab]
            [--port 8787]  [--mode A|B | --allow-mode-b]  [--no-bind-mcp]
            [--preset <id>]  [--grid <NxNyNz>]  [--tab <tabId>]  [--wait-ms <ms>]
            Exit: 0 Chrome handshake verified | 1 launch/handshake error

  mode      Inspect or switch active Foundry daemon execution mode (Mode A vs Mode B)
            [--status | --A | --B]  [--port 8787]

  tabs      List connected browser tabs and active conversation-to-tab bindings
            [--port 8787]  [--conv <id>]

  ui        Control the paired Chrome 3D Workbench tab via Desktop MCP broker
            tabs       [--port 8787]
            connect    --conv <id> [--client <id> | --focused-chrome]
            inspect    [--conv <id>] [--client <id>] [--verbose]
            reload     [--conv <id>] [--client <id>] [--no-preserve-state] [--no-hard-reload] [--wait-ms <ms>]
            load-file  --file <path> [--target ${UI_LOAD_TARGETS.join('|')}] [--subdiv 0..4]
                       [--skeletonize] [--mesh-only] [--custom-only] [--fit-to-voxel] [--clear-existing]
            configure  [--grid 1x1x1] [--preset <id>] [--tab <tabId>] [--fdm-mode <m>]
                       [--radius <r>] [--inner-radius <r>] [--camera <fit|iso|front|top>]
                       [--elastica-valency <N>] [--elastica-pair-mode <m>]
                       [--pin-voxel x,y,z=tile] [--clear-voxel-pins] [--pq-loop <id|null>]
                       [--fea-animate <true|false>] [--fea-scale <num>] [--fea-load-case <str>]
            step       --step <${UI_STEPS.join('|')}>
                       [--mode ${UI_STEP_MODES.join('|')}] [--loop-id <id|null>]
            export     --format <${UI_EXPORT_FORMATS.join('|')}> [--out <file>]

Headless Foundry Governance, Generation & Verification:
  seal      Verify, reseal, or self-test Mode A/B cryptographic seals & air-gap
            --mode A|B  --verify  --reseal  --skip-bench  --self-test  [--json]
            Exit: 0 valid | 2 mode/seal violation | 1 error

  bench     Run air-gapped analytical verifier mechanics benchmarks (14/14)
            [--force]
            Exit: 0 pass | 2 fail | 1 error

  generate  Generate a single WFC-FDM candidate (spawns run_generator.mjs)
            --brief <file>  --preset <id>  --grid <NxMxK>  --mode <fdm>
            --seed <N>  --radius <m>  --inner-radius <m>  --subdiv <L>
            --pq <bool>  --unroll <bool>  --out-dir <dir>  --name <stem>

  verify    Run air-gapped structural & fabrication verification (verifier/verify.mjs)
            --topology <file>  [--mesh <file>]  --brief <file>  [--out <file>]
            Exit: 0 PASS | 2 FAIL | 1 error

  eval      Single-shot air-gapped Generate -> Verify via warm worker threads
            --brief <file>  --preset <id>  --grid <NxMxK>  --mode <fdm>
            --seed <N>  --radius <m>  --inner-radius <m>  [--write-dir <dir>]  [--name <stem>]
            Exit: 0 PASS | 2 FAIL | 1 error

  batch     Parallel warm-worker sweep streaming NDJSON records + final summary
            (--input <sweep.json> | --stdin-jsonl)  [--brief <file>]
            [--concurrency N]  [--out-dir <dir>]  [--keep-failed]
            Exit: 0 (>=1 pass) | 2 (0 pass) | 1 error

  run       Full gated Foundry campaign with Mode A strict seal enforcement
            --brief <file>  [--mode A|B]  [--profile lightning|interactive|thorough]
            [--gates 1,2,3,4,5[,6,7]]  [--run-id ID]  [--run-dir DIR]
            [--ndjson]  [--strict-seal | --no-strict-seal]
            Exit: 0 champion passed | 2 no passing champion or seal fail | 1 error

  runs      Inspect or clean campaign runs in TOPOGEN_FDM_Foundry/runs/
            list | show <runId> | pareto <runId> | clean --scope scratch|run [--run-id ID]

  report    Build standalone Goldilocks 3D HTML report (build_report.mjs)
            [--run-id ID]  [--run-dir DIR]  [--brief FILE]  [--out FILE]

  serve     Start (or idempotently reuse) the Foundry HTTP/SSE daemon & Desktop MCP broker
            [--port N]  [--ecosystem antigravity|codex]  [--allow-mode-b]
            [--bind-mcp | --no-bind-mcp]  [--no-browser]  [--restart]

  mcp       Run Desktop MCP stdio server or manage Antigravity mcp_config.json
            [--bind | --unbind | --print-config]  [--ecosystem antigravity|codex]  [--session FILE]

  help      Show this help message
`;
  process.stdout.write(text);
}

// ============================================================================
// Subcommand Handlers
// ============================================================================

async function cmdLaunch(argv) {
  const { flags, positional } = parseArgv(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const port = resolvePort(flags);
  const ecosystem = await resolveEcosystemCli(flags.ecosystem);
  const conversationId = resolveConversationId(flags);
  const requestedMode = resolveRequestedMode(flags, positional);
  const shouldBindMcp = flags['bind-mcp'] !== undefined
    ? parseBool(flags['bind-mcp'], true)
    : (ecosystem === 'antigravity');

  const surface = flags.launcher || String(flags.surface || '').toLowerCase() === 'launcher'
    ? 'launcher'
    : 'workbench';
  const newTab = parseBool(flags['new-tab'], false);
  const reuseExisting = newTab ? false : parseBool(flags.reuse, true);
  const waitMs = flags['wait-ms'] !== undefined ? Number(flags['wait-ms']) : 8000;

  // Step 1: Ensure daemon is online, mode is synced, and MCP is bound
  const { health } = await ensureDaemonOnline({
    port,
    ecosystem,
    requestedMode,
    shouldBindMcp,
  });

  // Step 2: Request Chrome launch & conversation handshake from daemon
  const launchPayload = {
    ...(conversationId ? { conversationId } : {}),
    surface,
    reuseExisting,
    newTab,
    waitMs: Number.isFinite(waitMs) && waitMs > 0 ? Math.trunc(waitMs) : 8000,
    ...(flags.preset !== undefined ? { preset: String(flags.preset) } : {}),
    ...(flags.grid !== undefined ? { grid: String(flags.grid) } : {}),
    ...(flags.tab !== undefined ? { tab: String(flags.tab) } : {}),
  };

  const httpTimeoutMs = Math.max(20000, launchPayload.waitMs + 10000);
  const launchRes = await httpRequestJson(port, 'POST', '/api/ui-bridge/launch', launchPayload, httpTimeoutMs);

  if (launchRes.status === 404 && !launchRes.data?.code && !launchRes.data?.error) {
    const errPayload = {
      ok: false,
      port,
      conversationId,
      surface,
      error: `Running daemon on 127.0.0.1:${port} does not expose POST /api/ui-bridge/launch (restart daemon with Mode B UI Bridge v2).`,
    };
    console.log(JSON.stringify(errPayload, null, 2));
    return 1;
  }

  const data = launchRes.data || {};
  const handshakeOk = Boolean(
    launchRes.ok &&
    data.ok === true &&
    typeof data.clientId === 'string' &&
    data.clientId.trim().length > 0
  );

  // Step 3: Strict handshake gate (never exit 0 unless Chrome tab connected with clientId)
  if (!handshakeOk) {
    const failOut = {
      ok: false,
      launched: Boolean(data.launched),
      reused: Boolean(data.reused),
      clientId: data.clientId || null,
      conversationId: data.conversationId ?? conversationId ?? null,
      surface,
      port,
      error: data.error || `Google Chrome tab did not complete UI bridge handshake on 127.0.0.1:${port}.`,
      hint: 'If running inside a restricted command sandbox where desktop Chrome IPC is blocked, invoke the unsandboxed Desktop MCP tool topogen_ui_launch({ conversationId }) instead.',
      ...(data.launchUrl ? { launchUrl: data.launchUrl } : {}),
    };
    console.log(JSON.stringify(failOut, null, 2));
    return 1;
  }

  const out = {
    ok: true,
    launched: Boolean(data.launched),
    reused: Boolean(data.reused),
    clientId: data.clientId,
    conversationId: data.conversationId ?? conversationId ?? null,
    browserKind: data.browserKind || 'chrome',
    surface: data.surface || surface,
    url: data.url || `http://127.0.0.1:${port}/${surface === 'launcher' ? 'foundry_launcher.html' : 'index_TOPOGEN_PQM_ELASTICA_FDM.html'}`,
    port,
    executionMode: data.executionMode ?? health?.executionMode ?? 'A',
    allowModeB: Boolean(data.allowModeB ?? health?.allowModeB ?? false),
    ...(data.configured ? { configured: data.configured } : {}),
    ...(data.state ? { state: data.state } : {}),
  };
  console.log(JSON.stringify(out, null, 2));
  return 0;
}

async function cmdMode(argv) {
  const { flags, positional } = parseArgv(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const port = resolvePort(flags);
  const ecosystem = await resolveEcosystemCli(flags.ecosystem);
  const targetMode = flags.status ? null : resolveRequestedMode(flags, positional);

  if (targetMode === 'A' || targetMode === 'B') {
    await ensureDaemonOnline({
      port,
      ecosystem,
      requestedMode: targetMode,
      shouldBindMcp: flags['bind-mcp'] !== undefined ? parseBool(flags['bind-mcp'], true) : (ecosystem === 'antigravity'),
    });
    const modeData = await syncDaemonMode(port, targetMode);
    console.log(JSON.stringify({
      ok: true,
      port,
      executionMode: modeData?.executionMode ?? targetMode,
      allowModeB: Boolean(modeData?.allowModeB ?? (targetMode === 'B')),
      ecosystem: modeData?.ecosystem ?? ecosystem,
    }, null, 2));
    return 0;
  }

  const health = await probeHealth(port, 2500);
  if (!health) {
    console.log(JSON.stringify({
      ok: false,
      status: 'offline',
      port,
      error: `TOPOGEN Foundry daemon is not running on 127.0.0.1:${port}. Run "topogen launch" or "topogen mode --B" to start it.`,
    }, null, 2));
    return 1;
  }

  const res = await httpRequestJson(port, 'GET', '/api/mode', undefined, 3000);
  const d = res.data || {};
  console.log(JSON.stringify({
    ok: true,
    port,
    executionMode: d.executionMode ?? health.executionMode ?? 'A',
    allowModeB: Boolean(d.allowModeB ?? health.allowModeB ?? false),
    ecosystem: d.ecosystem ?? health.ecosystem ?? ecosystem,
  }, null, 2));
  return 0;
}

async function cmdTabs(argv) {
  const { flags } = parseArgv(argv);
  if (flags.help) {
    printHelp();
    return 0;
  }

  const port = resolvePort(flags);
  const conversationId = resolveConversationId(flags);
  const health = await probeHealth(port, 2500);
  if (!health) {
    console.log(JSON.stringify({
      ok: false,
      status: 'offline',
      port,
      conversationId,
      tabs: [],
      error: `TOPOGEN Foundry daemon is offline on 127.0.0.1:${port}.`,
    }, null, 2));
    return 1;
  }

  const tabsRes = await httpRequestJson(port, 'GET', '/api/ui-bridge/tabs', undefined, 5000);
  if (tabsRes.ok && tabsRes.data) {
    console.log(JSON.stringify({
      ok: true,
      port,
      callerConversationId: conversationId,
      ...tabsRes.data,
    }, null, 2));
    return 0;
  }

  // Fallback for pre-v2 daemon
  const statusRes = await httpRequestJson(port, 'GET', '/api/agent/status', undefined, 5000);
  const uiBridge = statusRes.data?.uiBridge || health.mcp?.uiBridge || {};
  console.log(JSON.stringify({
    ok: true,
    port,
    callerConversationId: conversationId,
    executionMode: health.executionMode,
    allowModeB: health.allowModeB,
    connected: Boolean(uiBridge.connected),
    preferredClientId: uiBridge.preferredClientId || null,
    clients: uiBridge.clients || [],
    conversationBindings: uiBridge.conversationBindings || {},
  }, null, 2));
  return 0;
}

function parseCameraOption(rawCam) {
  if (rawCam === undefined) return undefined;
  const s = String(rawCam).trim();
  if (!s) return undefined;
  if (s.startsWith('{')) {
    return JSON.parse(s);
  }
  switch (s.toLowerCase()) {
    case 'fit':
      return 'fit';
    case 'iso':
    case 'persp':
    case 'perspective':
      return { az: 0.7854, el: 0.48, distScale: 1.0 };
    case 'front':
      return { az: -1.5708, el: 0.05, distScale: 1.0 };
    case 'right':
    case 'side':
      return { az: 0.0, el: 0.05, distScale: 1.0 };
    case 'top':
    case 'plan':
      return { az: 0.0, el: 1.55, distScale: 1.0 };
    default:
      return s;
  }
}

function parseValencyList(rawVal) {
  if (rawVal === undefined || rawVal === null || rawVal === false) return null;
  return String(rawVal)
    .split(/[,\s]+/)
    .map((tok) => tok.trim())
    .filter(Boolean)
    .map((tok) => {
      if (tok === '5+') return '5+';
      const n = Number(tok);
      if (Number.isFinite(n) && n >= 5) return '5+';
      return String(tok);
    });
}

function buildElasticaObjectFromFlags(flags) {
  let el = {};
  if (typeof flags['elastica-json'] === 'string') {
    el = { ...JSON.parse(flags['elastica-json']) };
  }
  if (flags['elastica-pair-mode'] !== undefined) {
    el.pairMode = String(flags['elastica-pair-mode']);
  }
  if (flags['elastica-solver'] !== undefined) {
    el.solver = String(flags['elastica-solver']);
  }
  if (flags['elastica-smooth'] !== undefined) {
    el.smooth = Number(flags['elastica-smooth']);
  }
  if (flags['elastica-tightness'] !== undefined) {
    el.tightness = Number(flags['elastica-tightness']);
  }
  if (flags['elastica-radius'] !== undefined) {
    el.rodRadius = Number(flags['elastica-radius']);
  }
  if (flags['elastica-sides'] !== undefined) {
    el.rodSides = Number(flags['elastica-sides']);
  }
  if (flags['elastica-clear']) {
    el.clearSelection = true;
  }

  const sharedValencies = parseValencyList(flags['elastica-valency']);
  const srcValencies = parseValencyList(flags['elastica-source-valency']) || sharedValencies;
  const sinkValencies = parseValencyList(flags['elastica-sink-valency']) || sharedValencies;

  if (srcValencies || flags['elastica-top-sources']) {
    if (sharedValencies && el.clearSelection === undefined) el.clearSelection = true;
    el.sources = {
      ...(el.sources || {}),
      ...(flags['elastica-top-sources'] ? { top: true } : {}),
      ...(srcValencies ? { valencies: srcValencies } : {}),
    };
  }
  if (sinkValencies || flags['elastica-ground-sinks']) {
    if (sharedValencies && el.clearSelection === undefined) el.clearSelection = true;
    el.sinks = {
      ...(el.sinks || {}),
      ...(flags['elastica-ground-sinks'] ? { ground: true } : {}),
      ...(sinkValencies ? { valencies: sinkValencies } : {}),
    };
  }

  return Object.keys(el).length > 0 ? el : undefined;
}

export function parseVoxelPinToken(rawToken) {
  const s = String(rawToken ?? '').trim();
  const eqIdx = s.indexOf('=');
  if (eqIdx <= 0 || eqIdx === s.length - 1) {
    throw new Error(`Invalid --pin-voxel "${rawToken}". Expected format x,y,z=tile (e.g. 1,0,1=null).`);
  }
  const coordsPart = s.slice(0, eqIdx).trim();
  const tilePart = s.slice(eqIdx + 1).trim();
  const parts = coordsPart.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || !parts.every((n) => Number.isInteger(n) && n >= 0)) {
    throw new Error(`Invalid --pin-voxel coordinates "${coordsPart}". Expected three non-negative integers x,y,z.`);
  }
  if (!tilePart) {
    throw new Error(`Invalid --pin-voxel "${rawToken}". Tile value cannot be empty.`);
  }
  let tile;
  const lower = tilePart.toLowerCase();
  if (lower === 'null' || lower === 'tile_null') {
    tile = 'null';
  } else if (/^\d+$/.test(tilePart)) {
    tile = Number(tilePart);
  } else {
    tile = tilePart;
  }
  return { x: parts[0], y: parts[1], z: parts[2], tile };
}

function parseVoxelPinsFromFlags(flags) {
  const raw = flags['pin-voxel'];
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  const pins = list
    .filter((v) => v !== undefined && v !== null && v !== true && v !== false)
    .map((tok) => parseVoxelPinToken(tok));
  return pins.length > 0 ? pins : undefined;
}

function buildFeaObjectFromFlags(flags) {
  const fea = {};
  if (flags['fea-animate'] !== undefined) {
    fea.animate = parseBool(flags['fea-animate'], true);
  }
  if (flags['fea-exclude-graph'] !== undefined) {
    fea.excludeGraph = parseBool(flags['fea-exclude-graph'], true);
  }
  if (flags['fea-include-elastica'] !== undefined) {
    fea.includeElastica = parseBool(flags['fea-include-elastica'], true);
  }
  if (flags['fea-rod-material'] !== undefined) {
    fea.rodMaterial = String(flags['fea-rod-material']).trim();
  }
  if (flags['fea-material'] !== undefined) {
    fea.material = String(flags['fea-material']).trim();
  }
  if (flags['fea-supports'] !== undefined) {
    fea.restraintType = String(flags['fea-supports']).trim();
  }
  if (flags['fea-load-kg'] !== undefined) {
    const kg = Number(flags['fea-load-kg']);
    if (!Number.isFinite(kg) || kg < 0) throw new Error(`Invalid --fea-load-kg "${flags['fea-load-kg']}"`);
    fea.topLoadKg = kg;
  }
  if (flags['fea-scale'] !== undefined) {
    const scale = Number(flags['fea-scale']);
    if (!Number.isFinite(scale) || scale <= 0) {
      throw new Error(`Invalid --fea-scale "${flags['fea-scale']}". Expected a positive number.`);
    }
    fea.deflectionScale = scale;
  }
  if (flags['fea-load-case'] !== undefined) {
    const lc = String(flags['fea-load-case']).trim();
    if (!lc) throw new Error('Invalid --fea-load-case. Expected a non-empty string.');
    fea.loadCase = lc;
  }
  return Object.keys(fea).length > 0 ? fea : undefined;
}

export function extractExportWriteBuffer(exportPayload, normalizedFormat) {
  const body = exportPayload?.result && typeof exportPayload.result === 'object'
    ? exportPayload.result
    : exportPayload;
  if (!body || typeof body !== 'object') return null;

  if (typeof body.stagedPath === 'string' && fs.existsSync(body.stagedPath)) {
    return fs.readFileSync(body.stagedPath);
  }
  if (body.truncated === true) {
    throw new Error(
      `Export payload (${body.bytes ?? 'large'} bytes) was truncated without a stagedPath; refusing to write a partial ${normalizedFormat} file.`
    );
  }

  if (typeof body.data === 'string') {
    return Buffer.from(body.data, 'utf8');
  }
  if (body.data && typeof body.data === 'object') {
    return Buffer.from(JSON.stringify(body.data, null, 2) + '\n', 'utf8');
  }
  if (body.topology && typeof body.topology === 'object') {
    return Buffer.from(JSON.stringify(body.topology, null, 2) + '\n', 'utf8');
  }
  if (typeof body.objText === 'string') {
    return Buffer.from(body.objText, 'utf8');
  }
  if (typeof body.svgText === 'string') {
    return Buffer.from(body.svgText, 'utf8');
  }
  if (normalizedFormat === 'snapshot' && typeof body.dataUrl === 'string') {
    const commaIdx = body.dataUrl.indexOf(',');
    if (commaIdx !== -1) {
      return Buffer.from(body.dataUrl.slice(commaIdx + 1), 'base64');
    }
  }
  return null;
}

async function cmdUi(argv) {
  const sub = argv[0];
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    printHelp();
    return 0;
  }

  const rest = argv.slice(1);
  if (sub === 'tabs') {
    return await cmdTabs(rest);
  }
  if (sub === 'launch' || sub === 'open') {
    return await cmdLaunch(rest);
  }

  const { flags, positional } = parseArgv(rest);
  const port = resolvePort(flags);
  const explicitPort = flags.port !== undefined || Boolean(process.env.FOUNDRY_PORT);
  const ecosystem = await resolveEcosystemCli(flags.ecosystem);
  const conversationId = resolveConversationId(flags);
  const clientId = flags.client || flags['client-id'] ? String(flags.client || flags['client-id']).trim() : undefined;
  const brokerOpts = {
    port,
    explicitPort,
    ecosystem,
    sessionFile: flags.session ? String(flags.session) : undefined,
  };

  if (sub === 'connect' || sub === 'claim') {
    if (!conversationId) {
      throw new Error('ui connect requires --conv <conversationId> (or ANTIGRAVITY_CONVERSATION_ID in env).');
    }
    const claimFocusedChrome = Boolean(flags['focused-chrome'] || flags['claim-focused-chrome']);
    const connectArgs = {
      conversationId,
      ...(clientId ? { clientId } : {}),
      ...(claimFocusedChrome ? { claimFocusedChrome: true } : {}),
    };

    try {
      const res = await callDaemonTool('topogen_ui_connect', connectArgs, brokerOpts);
      if (res && res.ok === true) {
        console.log(JSON.stringify(res, null, 2));
        return 0;
      }
      if (res && typeof res.error === 'string' && !res.error.includes('Unknown tool')) {
        console.log(JSON.stringify(res, null, 2));
        return 1;
      }
    } catch {}

    const claimHttp = await httpRequestJson(port, 'POST', '/api/ui-bridge/claim', connectArgs, 5000);
    console.log(JSON.stringify(claimHttp.data || { ok: claimHttp.ok, status: claimHttp.status }, null, 2));
    return claimHttp.ok && claimHttp.data?.ok !== false ? 0 : 1;
  }

  if (sub === 'inspect') {
    const toolArgs = {
      ...(flags.verbose ? { verbose: true } : {}),
      ...(clientId ? { clientId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    const res = await callDaemonTool('topogen_ui_inspect', toolArgs, brokerOpts);
    console.log(JSON.stringify(res, null, 2));
    return res?.ok === true ? 0 : 1;
  }

  if (sub === 'reload') {
    const preserveState = flags['preserve-state'] !== undefined
      ? parseBool(flags['preserve-state'], true)
      : (flags['no-preserve-state'] ? false : true);
    const hardReload = flags['hard-reload'] !== undefined
      ? parseBool(flags['hard-reload'], true)
      : (flags['no-hard-reload'] ? false : true);
    let waitMs;
    if (flags['wait-ms'] !== undefined) {
      const parsed = Number(flags['wait-ms']);
      if (!Number.isFinite(parsed) || parsed < 500 || parsed > 60000) {
        throw new Error(`Invalid --wait-ms "${flags['wait-ms']}". Expected 500..60000.`);
      }
      waitMs = Math.trunc(parsed);
    }
    const toolArgs = {
      preserveState,
      hardReload,
      ...(waitMs !== undefined ? { waitMs } : {}),
      ...(clientId ? { clientId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    const res = await callDaemonTool('topogen_ui_reload', toolArgs, {
      ...brokerOpts,
      timeoutMs: Math.max(25000, (waitMs ?? 10000) + 15000),
    });
    console.log(JSON.stringify(res, null, 2));
    return res?.ok === true ? 0 : 1;
  }

  if (sub === 'load-file' || sub === 'load') {
    const rawFile = flags.file ?? flags['file-path'] ?? positional[0];
    if (!rawFile || typeof rawFile !== 'string') {
      throw new Error('ui load-file requires --file <path>.');
    }
    const resolvedFile = path.resolve(process.cwd(), rawFile);
    if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
      throw new Error(`Geometry file not found: ${resolvedFile}`);
    }
    const target = flags.target ? String(flags.target).trim() : 'tile';
    if (!UI_LOAD_TARGETS.includes(target)) {
      throw new Error(`Invalid --target "${target}". Expected one of: ${UI_LOAD_TARGETS.join(', ')}.`);
    }
    const subDivRaw = flags['sub-div'] ?? flags.subdiv;
    const skelFlag = flags.skeletonize ?? flags['skeletonize-mesh'];
    const toolArgs = {
      filePath: resolvedFile,
      target,
      ...(subDivRaw !== undefined ? { subDiv: Number(subDivRaw) } : {}),
      ...(flags['mesh-only'] !== undefined ? { meshOnly: parseBool(flags['mesh-only'], true) } : {}),
      ...(skelFlag !== undefined ? { skeletonize: parseBool(skelFlag, true) } : {}),
      ...(flags['custom-only'] !== undefined ? { customOnly: parseBool(flags['custom-only'], true) } : {}),
      ...(flags['fit-to-voxel'] !== undefined ? { fitToVoxel: parseBool(flags['fit-to-voxel'], true) } : {}),
      ...(flags['clear-existing'] !== undefined ? { clearExisting: parseBool(flags['clear-existing'], true) } : {}),
      ...(flags['weld-tol'] !== undefined ? { weldTol: Number(flags['weld-tol']) } : {}),
      ...(clientId ? { clientId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    const res = await callDaemonTool('topogen_ui_load_file', toolArgs, { ...brokerOpts, timeoutMs: 60000 });
    console.log(JSON.stringify(res, null, 2));
    return res?.ok === true ? 0 : 1;
  }

  if (sub === 'configure' || sub === 'config') {
    const fdmMode = flags['fdm-mode'] ?? flags.mode;
    const elasticaObj = buildElasticaObjectFromFlags(flags);
    const voxelPins = parseVoxelPinsFromFlags(flags);
    const feaObj = buildFeaObjectFromFlags(flags);
    const cameraVal = parseCameraOption(flags.camera);
    const ccSubDiv = flags['cc-subdiv'] ?? flags['sub-div'];
    const skelFlag = flags.skeletonize ?? flags['skeletonize-mesh'];
    const baseParams = typeof flags.params === 'string' ? JSON.parse(flags.params) : undefined;
    let pqVal;
    const rawPqLoop = flags['pq-loop'] ?? flags['selected-loop-id'];
    if (rawPqLoop !== undefined) {
      const s = String(rawPqLoop).trim().toLowerCase();
      const selectedLoopId = (s === 'null' || s === 'none' || s === 'clear' || s === '')
        ? null
        : Number(rawPqLoop);
      if (selectedLoopId !== null && (!Number.isInteger(selectedLoopId) || selectedLoopId < 0)) {
        throw new Error(`Invalid --pq-loop "${rawPqLoop}". Expected a non-negative integer or "null".`);
      }
      pqVal = {
        selectedLoopId,
        ...(flags.pq !== undefined ? { optimization: parseBool(flags.pq, true) } : {}),
      };
    } else if (flags.pq !== undefined) {
      pqVal = parseBool(flags.pq, true);
    }

    const toolArgs = {
      ...(flags.preset !== undefined ? { preset: String(flags.preset) } : {}),
      ...(flags.grid !== undefined ? { grid: String(flags.grid) } : {}),
      ...(flags.seed !== undefined ? { seed: Number(flags.seed) } : {}),
      ...(fdmMode !== undefined ? { mode: String(fdmMode) } : {}),
      ...(flags.radius !== undefined ? { radius: Number(flags.radius) } : {}),
      ...(flags['inner-radius'] !== undefined ? { innerRadius: Number(flags['inner-radius']) } : {}),
      ...(flags.subdiv !== undefined ? { subdiv: Number(flags.subdiv) } : {}),
      ...(ccSubDiv !== undefined ? { subDiv: Number(ccSubDiv) } : {}),
      ...(skelFlag !== undefined ? { skeletonize: parseBool(skelFlag, true) } : {}),
      ...(pqVal !== undefined ? { pq: pqVal } : {}),
      ...(flags.unroll !== undefined ? { unroll: parseBool(flags.unroll, true) } : {}),
      ...(cameraVal !== undefined ? { camera: cameraVal } : {}),
      ...(flags.tab !== undefined ? { tab: String(flags.tab) } : {}),
      ...(elasticaObj ? { elastica: elasticaObj } : {}),
      ...(voxelPins ? { voxelPins } : {}),
      ...(flags['clear-voxel-pins'] !== undefined ? { clearVoxelPins: parseBool(flags['clear-voxel-pins'], true) } : {}),
      ...(feaObj ? { fea: feaObj } : {}),
      ...(baseParams ? { params: baseParams } : {}),
      ...(clientId ? { clientId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    const res = await callDaemonTool('topogen_ui_configure', toolArgs, brokerOpts);
    console.log(JSON.stringify(res, null, 2));
    const inner = res?.result ?? res;
    if (res?.ok !== true || inner?.configured === false) return 1;
    return 0;
  }

  if (sub === 'step' || sub === 'run-step') {
    const rawStep = flags.step ?? positional[0];
    if (!rawStep || typeof rawStep !== 'string') {
      throw new Error(`ui step requires --step <${UI_STEPS.join('|')}>.`);
    }
    const trimmedStep = rawStep.trim();
    const stepName = trimmedStep === 'elastica' ? 'elastica_trace' : trimmedStep;
    if (!UI_STEPS.includes(stepName)) {
      throw new Error(`Invalid --step "${rawStep}". Expected one of: ${UI_STEPS.join(', ')}.`);
    }
    const elasticaParams = buildElasticaObjectFromFlags(flags);
    const explicitParams = typeof flags.params === 'string' ? JSON.parse(flags.params) : undefined;
    const reloadParams = stepName === 'reload'
      ? {
          ...(flags['preserve-state'] !== undefined ? { preserveState: parseBool(flags['preserve-state'], true) } : (flags['no-preserve-state'] ? { preserveState: false } : {})),
          ...(flags['hard-reload'] !== undefined ? { hardReload: parseBool(flags['hard-reload'], true) } : (flags['no-hard-reload'] ? { hardReload: false } : {})),
          ...(flags['wait-ms'] !== undefined && Number.isFinite(Number(flags['wait-ms'])) ? { waitMs: Math.trunc(Number(flags['wait-ms'])) } : {}),
        }
      : undefined;
    const hasReloadParams = reloadParams && Object.keys(reloadParams).length > 0;
    const mergedParams = (elasticaParams || explicitParams || hasReloadParams)
      ? { ...(elasticaParams || {}), ...(hasReloadParams ? reloadParams : {}), ...(explicitParams || {}) }
      : undefined;

    let stepMode;
    if (flags.mode !== undefined) {
      const m = String(flags.mode).trim().toLowerCase();
      if (!UI_STEP_MODES.includes(m)) {
        throw new Error(`Invalid --mode "${flags.mode}" for ui step. Expected one of: ${UI_STEP_MODES.join(', ')}.`);
      }
      stepMode = m;
    }

    let loopId;
    const rawLoopId = flags['loop-id'] ?? flags.loop;
    if (rawLoopId !== undefined) {
      const s = String(rawLoopId).trim().toLowerCase();
      if (s === 'null' || s === 'none' || s === 'clear' || s === '') {
        loopId = null;
      } else {
        const parsed = Number(rawLoopId);
        if (!Number.isInteger(parsed) || parsed < 0) {
          throw new Error(`Invalid --loop-id "${rawLoopId}". Expected a non-negative integer or "null".`);
        }
        loopId = parsed;
      }
    }

    const toolArgs = {
      step: stepName,
      ...(stepMode !== undefined ? { mode: stepMode } : {}),
      ...(loopId !== undefined ? { loopId } : {}),
      ...(mergedParams ? { params: mergedParams } : {}),
      ...(clientId ? { clientId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };
    const res = await callDaemonTool('topogen_ui_run_step', toolArgs, { ...brokerOpts, timeoutMs: 90000 });
    console.log(JSON.stringify(res, null, 2));
    return res?.ok === true ? 0 : 1;
  }

  if (sub === 'export') {
    const rawFormat = String(flags.format ?? positional[0] ?? 'topology').trim().toLowerCase();
    const formatAliasMap = {
      topology_json: 'topology',
      json: 'topology',
      mesh: 'obj',
      unroll_svg: 'svg',
    };
    const normalizedFormat = formatAliasMap[rawFormat] || (UI_EXPORT_FORMATS.includes(rawFormat) ? rawFormat : null);
    if (!normalizedFormat) {
      throw new Error(`Unsupported --format "${rawFormat}". Expected one of: ${UI_EXPORT_FORMATS.join(', ')}.`);
    }

    const outFile = flags.out ? path.resolve(process.cwd(), String(flags.out)) : null;
    const toolArgs = {
      format: normalizedFormat,
      download: Boolean(flags.download),
      ...(flags.scale !== undefined ? { scale: Number(flags.scale) } : {}),
      ...(clientId ? { clientId } : {}),
      ...(conversationId ? { conversationId } : {}),
    };

    const res = await callDaemonTool('topogen_ui_export', toolArgs, { ...brokerOpts, timeoutMs: 60000 });
    if (res?.ok !== true) {
      console.log(JSON.stringify(res, null, 2));
      return 1;
    }

    if (outFile) {
      let buf = null;
      try {
        buf = extractExportWriteBuffer(res, normalizedFormat);
      } catch (truncErr) {
        console.log(JSON.stringify({
          ok: false,
          format: rawFormat,
          out: outFile,
          error: truncErr?.message || String(truncErr),
        }, null, 2));
        return 1;
      }
      if (!buf) {
        console.log(JSON.stringify({
          ok: false,
          format: rawFormat,
          out: outFile,
          error: 'Browser tab did not return inline export data (ensure Geometry/Elastica is generated first and UI Bridge v2 is loaded).',
          response: res,
        }, null, 2));
        return 1;
      }
      fs.mkdirSync(path.dirname(outFile), { recursive: true });
      fs.writeFileSync(outFile, buf);

      const printed = structuredClone(res);
      const targetObj = printed.result && typeof printed.result === 'object' ? printed.result : printed;
      if (!flags['print-data']) {
        if (typeof targetObj.data === 'string' && targetObj.data.length > 512) {
          targetObj.data = `[written ${buf.length} bytes to ${outFile}]`;
        }
        if (targetObj.topology && typeof targetObj.topology === 'object') {
          delete targetObj.topology;
        }
        if (typeof targetObj.dataUrl === 'string' && targetObj.dataUrl.length > 512) {
          targetObj.dataUrl = `[written ${buf.length} bytes to ${outFile}]`;
        }
      }
      printed.writtenTo = outFile;
      printed.bytesWritten = buf.length;
      console.log(JSON.stringify(printed, null, 2));
      return 0;
    }

    console.log(JSON.stringify(res, null, 2));
    return 0;
  }

  throw new Error(`Unknown ui subcommand "${sub}". Expected inspect, connect, tabs, reload, load-file, configure, step, or export.`);
}

async function cmdSeal(argv) {
  if (!fs.existsSync(PATHS.modeGuard)) {
    throw new Error(`Mode guard script not found at ${PATHS.modeGuard}`);
  }
  const { flags } = parseArgv(argv);
  const forwardArgs = [...argv];
  if (!flags.json && !flags.text && !forwardArgs.includes('--json')) {
    forwardArgs.push('--json');
  }
  const res = await spawnNodeCaptured(PATHS.modeGuard, forwardArgs);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.code;
}

async function cmdBench(argv) {
  const { flags } = parseArgv(argv);
  const force = Boolean(flags.force);
  const t0 = performance.now();
  const seal = computeFoundrySeal(force);
  const verifierSealHash = seal.verifierSealHash;

  if (!force && fs.existsSync(PATHS.benchCacheJson)) {
    try {
      const cached = JSON.parse(fs.readFileSync(PATHS.benchCacheJson, 'utf8'));
      if (cached && cached.verifierSealHash === verifierSealHash && cached.passed === true) {
        console.log(JSON.stringify({
          status: 'ok',
          passed: true,
          passCount: cached.passCount ?? 14,
          total: cached.total ?? cached.passCount ?? 14,
          verifierSealHash,
          cached: true,
          elapsedMs: +(performance.now() - t0).toFixed(2),
        }, null, 2));
        return 0;
      }
    } catch {}
  }

  const res = await spawnNodeCaptured(PATHS.verifierBenchCli, []);
  const combined = `${res.stdout}\n${res.stderr}`;
  const passMatches = combined.match(/\[PASS\]/g) || [];
  const failMatches = combined.match(/\[FAIL\]/g) || [];
  const passCount = passMatches.length;
  const failCount = failMatches.length;
  const total = passCount + failCount;
  const passed = res.code === 0 && failCount === 0 && passCount > 0;
  const elapsedMs = +(performance.now() - t0).toFixed(2);

  if (passed) {
    try {
      fs.mkdirSync(path.dirname(PATHS.benchCacheJson), { recursive: true });
      fs.writeFileSync(PATHS.benchCacheJson, JSON.stringify({
        verifierSealHash,
        passed: true,
        passCount,
        total,
        verifiedAt: new Date().toISOString(),
      }, null, 2) + '\n', 'utf8');
    } catch {}
  }

  console.log(JSON.stringify({
    status: passed ? 'ok' : 'fail',
    passed,
    passCount,
    failCount,
    total,
    verifierSealHash,
    cached: false,
    elapsedMs,
    ...(passed ? {} : { stderr: res.stderr.trim() || undefined }),
  }, null, 2));

  return passed ? 0 : 2;
}

async function cmdGenerate(argv) {
  const { flags } = parseArgv(argv);
  const forwardArgs = [];

  if (flags.brief) {
    forwardArgs.push('--brief', resolveBriefPath(String(flags.brief), 'pilot_brief.json'));
  }
  const passKeys = [
    'config', 'preset', 'grid', 'mode', 'seed', 'radius', 'inner-radius',
    'sides', 'q-profile', 'q-base', 'column-boost', 'anchor-boost',
    'collar-boost', 'top-collar-boost', 'optimize-fdm', 'subdiv', 'pq',
    'max-pq-error', 'unroll', 'prune-tension', 'min-angle', 'ensure-lateral',
    'auto-slenderness', 'equalize-lengths', 'out-dir', 'name',
  ];
  for (const k of passKeys) {
    if (flags[k] === undefined) continue;
    if (flags[k] === true) {
      forwardArgs.push(`--${k}`);
    } else {
      forwardArgs.push(`--${k}`, String(flags[k]));
    }
  }

  const res = await spawnNodeCaptured(PATHS.generatorCli, forwardArgs);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.code;
}

async function cmdVerify(argv) {
  const { flags } = parseArgv(argv);
  const forwardArgs = [];
  if (flags.topology) forwardArgs.push('--topology', path.resolve(process.cwd(), String(flags.topology)));
  if (flags.mesh) forwardArgs.push('--mesh', path.resolve(process.cwd(), String(flags.mesh)));
  if (flags.patterns) forwardArgs.push('--patterns', path.resolve(process.cwd(), String(flags.patterns)));
  if (flags.unrolled) forwardArgs.push('--unrolled', path.resolve(process.cwd(), String(flags.unrolled)));
  if (flags.brief) forwardArgs.push('--brief', resolveBriefPath(String(flags.brief), 'pilot_brief.json'));
  if (flags.out) forwardArgs.push('--out', path.resolve(process.cwd(), String(flags.out)));
  forwardArgs.push('--json');

  const res = await spawnNodeCaptured(PATHS.verifierCli, forwardArgs);
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
  return res.code;
}

async function cmdEval(argv) {
  const { flags } = parseArgv(argv);
  const briefPath = resolveBriefPath(flags.brief ? String(flags.brief) : null, 'pilot_v2_pq_unrolled.json');
  const brief = loadJsonFile(briefPath);
  const config = buildConfigFromFlags(flags);
  if (!config.name) config.name = 'eval_candidate';

  try {
    const res = await quickEvaluateCandidate(brief, config);
    const passed = Boolean(res.verdict?.passed ?? res.verdict?.overallPassed ?? res.record?.passed);
    const outputs = flags['write-dir']
      ? writeEvalArtifacts(String(flags['write-dir']), config.name, res, config)
      : null;

    console.log(JSON.stringify({
      status: 'ok',
      passed,
      elapsedMs: res.elapsedMs,
      generatorMs: res.generatorMs,
      verifierMs: res.verifierMs,
      metrics: res.record,
      verdict: res.verdict,
      outputs,
    }, null, 2));

    return passed ? 0 : 2;
  } finally {
    await shutdownSharedWorkerPools();
  }
}

async function readStdinLines() {
  const items = [];
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    items.push(JSON.parse(line));
  }
  return items;
}

async function cmdBatch(argv) {
  const { flags } = parseArgv(argv);
  const t0 = performance.now();
  const defaultBriefPath = flags.brief
    ? resolveBriefPath(String(flags.brief), 'pilot_v2_pq_unrolled.json')
    : resolveBriefPath(null, 'pilot_v2_pq_unrolled.json');
  const defaultBrief = loadJsonFile(defaultBriefPath);
  const keepFailed = parseBool(flags['keep-failed'], false);
  const defaultOutDir = flags['out-dir'] ? path.resolve(process.cwd(), String(flags['out-dir'])) : null;
  const concurrency = Math.max(1, Math.min(16, Number(flags.concurrency || Math.min(6, os.cpus().length))));

  let rawItems = [];
  let specBrief = defaultBrief;
  let specOutDir = defaultOutDir;

  if (flags.input) {
    const inputPath = path.resolve(process.cwd(), String(flags.input));
    const spec = loadJsonFile(inputPath);
    if (Array.isArray(spec)) {
      rawItems = spec;
    } else if (spec && typeof spec === 'object') {
      if (spec.brief) specBrief = spec.brief;
      else if (spec.briefPath) specBrief = loadJsonFile(resolveBriefPath(String(spec.briefPath)));
      if (spec.outDir && !specOutDir) specOutDir = path.resolve(process.cwd(), String(spec.outDir));
      rawItems = Array.isArray(spec.items) ? spec.items : (Array.isArray(spec.candidates) ? spec.candidates : []);
    }
  } else if (flags['stdin-jsonl']) {
    rawItems = await readStdinLines();
  } else {
    throw new Error('batch requires either --input <sweep.json> or --stdin-jsonl');
  }

  const briefCache = new Map();
  const resolveItemBrief = (item) => {
    if (item && item.brief && typeof item.brief === 'object') return item.brief;
    if (item && item.briefPath) {
      const p = resolveBriefPath(String(item.briefPath));
      if (!briefCache.has(p)) briefCache.set(p, loadJsonFile(p));
      return briefCache.get(p);
    }
    return specBrief;
  };

  let passedCount = 0;
  let failedCount = 0;
  let errorCount = 0;
  let best = null;
  let nextIdx = 0;

  try {
    const workerFn = async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= rawItems.length) break;
        const item = rawItems[idx] || {};
        const itemBrief = resolveItemBrief(item);
        const rawCfg = item.config && typeof item.config === 'object' ? { ...item.config } : { ...item };
        delete rawCfg.brief;
        delete rawCfg.briefPath;
        delete rawCfg.outDir;

        if (rawCfg.preset && !rawCfg.tilePreset) rawCfg.tilePreset = rawCfg.preset;
        if (rawCfg.grid && !rawCfg.gridResolution) rawCfg.gridResolution = parseGrid(rawCfg.grid);
        if (rawCfg.mode && !rawCfg.fdmMode) rawCfg.fdmMode = rawCfg.mode;
        if (rawCfg.seed !== undefined && rawCfg.wfcSeed === undefined) rawCfg.wfcSeed = Number(rawCfg.seed);
        if (rawCfg.radius !== undefined && rawCfg.outerRadiusM === undefined) rawCfg.outerRadiusM = Number(rawCfg.radius);
        if (rawCfg['inner-radius'] !== undefined && rawCfg.innerRadiusM === undefined) rawCfg.innerRadiusM = Number(rawCfg['inner-radius']);
        const name = String(item.name || rawCfg.name || `cand_${String(idx + 1).padStart(3, '0')}`);
        rawCfg.name = name;

        try {
          const evalRes = await quickEvaluateCandidate(itemBrief, rawCfg);
          const passed = Boolean(evalRes.verdict?.passed ?? evalRes.verdict?.overallPassed ?? evalRes.record?.passed);
          const itemOutDir = item.outDir ? path.resolve(process.cwd(), String(item.outDir)) : specOutDir;
          const outputs = itemOutDir && (passed || keepFailed)
            ? writeEvalArtifacts(itemOutDir, name, evalRes, rawCfg)
            : null;

          if (passed) {
            passedCount++;
            const score = evalRes.record?.massKg ?? Infinity;
            if (!best || score < best.massKg) {
              best = {
                index: idx,
                name,
                massKg: score,
                maxDeflectionMm: evalRes.record?.maxDeflectionMm ?? null,
                minSafetyFactor: evalRes.record?.minSafetyFactor ?? null,
                outputs,
              };
            }
          } else {
            failedCount++;
          }

          process.stdout.write(JSON.stringify({
            type: 'candidate',
            index: idx,
            name,
            passed,
            elapsedMs: evalRes.elapsedMs,
            metrics: evalRes.record,
            failureReasons: evalRes.verdict?.failureReasons || [],
            outputs,
          }) + '\n');
        } catch (err) {
          errorCount++;
          process.stdout.write(JSON.stringify({
            type: 'candidate',
            index: idx,
            name,
            passed: false,
            error: err?.message || String(err),
          }) + '\n');
        }
      }
    };

    const workers = Array.from({ length: Math.min(concurrency, Math.max(1, rawItems.length)) }, () => workerFn());
    await Promise.all(workers);

    const summary = {
      type: 'summary',
      total: rawItems.length,
      passed: passedCount,
      failed: failedCount,
      errors: errorCount,
      elapsedMs: +(performance.now() - t0).toFixed(2),
      best,
    };
    process.stdout.write(JSON.stringify(summary) + '\n');
    return passedCount >= 1 ? 0 : 2;
  } finally {
    await shutdownSharedWorkerPools();
  }
}

async function checkStrictSealModeA() {
  if (!fs.existsSync(PATHS.modeGuard)) {
    return { ok: false, error: `Mode guard script missing at ${PATHS.modeGuard}` };
  }
  try {
    const mod = await import(pathToFileURL(PATHS.modeGuard).href);
    if (typeof mod.verifyFoundryMode === 'function') {
      return await mod.verifyFoundryMode({ foundryRoot: FOUNDRY_ROOT, mode: 'A' });
    }
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
  const res = await spawnNodeCaptured(PATHS.modeGuard, ['--mode', 'A', '--verify', '--json']);
  try {
    return JSON.parse(res.stdout);
  } catch {
    return { ok: res.code === 0, code: res.code, stdout: res.stdout, stderr: res.stderr };
  }
}

async function cmdRun(argv) {
  const { flags } = parseArgv(argv);
  const mode = String(flags.mode || 'A').toUpperCase() === 'B' ? 'B' : 'A';
  const strictSeal = parseBool(flags['strict-seal'], true);
  const ndjson = Boolean(flags.ndjson);

  if (mode === 'A' && strictSeal) {
    const sealRes = await checkStrictSealModeA();
    const sealOk = Boolean(sealRes && (sealRes.ok === true || sealRes.passed === true || sealRes.valid === true));
    if (!sealOk) {
      const payload = {
        type: ndjson ? 'error' : undefined,
        status: 'seal_violation',
        mode,
        message: 'Mode A strict seal verification failed prior to campaign launch.',
        seal: sealRes,
      };
      process.stdout.write(JSON.stringify(payload, null, ndjson ? 0 : 2) + '\n');
      return 2;
    }
  }

  const briefPath = resolveBriefPath(flags.brief ? String(flags.brief) : null, 'pilot_v2_pq_unrolled.json');
  const brief = loadJsonFile(briefPath);
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const runId = flags['run-id'] ? String(flags['run-id']) : `${brief.id || 'campaign'}_${ts}`;
  const runDir = flags['run-dir']
    ? path.resolve(process.cwd(), String(flags['run-dir']))
    : path.join(PATHS.runsDir, runId);

  const selectedNums = flags.gates
    ? new Set(String(flags.gates).split(',').map((s) => Number(s.trim())).filter(Number.isFinite))
    : new Set([1, 2, 3, 4, 5]);
  const gates = {};
  for (const g of CANONICAL_GATES) {
    gates[g.id] = selectedNums.has(g.index);
  }

  const searchConfig = {
    searchProfile: flags.profile ? String(flags.profile) : 'interactive',
    ...(flags.concurrency !== undefined ? { concurrency: Number(flags.concurrency) } : {}),
    ...(flags.rounds !== undefined ? { maxRounds: Number(flags.rounds) } : {}),
    ...(flags['per-round'] !== undefined
      ? { candidatesPerRound: Number(flags['per-round']), round1Count: Number(flags['per-round']) }
      : {}),
    ...(flags['force-benchmarks'] ? { forceBenchmarks: true } : {}),
  };

  const runner = new FoundryCampaignRunner({
    briefPath,
    brief,
    runId,
    runDir,
    executionMode: mode,
    gates,
    searchConfig,
  });

  runner.on('event', (e) => {
    if (ndjson) {
      process.stdout.write(JSON.stringify({ type: 'event', eventType: e.type, payload: e.payload }) + '\n');
    } else if (e.type === 'log') {
      process.stderr.write(`[${String(e.payload?.level || 'info').toUpperCase()}] ${e.payload?.message || ''}\n`);
    }
  });

  const onSigint = () => runner.stop('SIGINT received');
  process.on('SIGINT', onSigint);

  try {
    const finalState = await runner.run();
    const summary = {
      ...(ndjson ? { type: 'summary' } : {}),
      status: finalState.status,
      runId: finalState.runId,
      runDir: finalState.runDir,
      executionMode: finalState.executionMode,
      searchProfile: finalState.searchProfile,
      elapsedSec: finalState.elapsedSec,
      throughputCandPerSec: finalState.throughputCandPerSec,
      seal: finalState.seal,
      totals: finalState.totals,
      champion: finalState.champion,
      deliverables: finalState.deliverables,
    };
    process.stdout.write(JSON.stringify(summary, null, ndjson ? 0 : 2) + '\n');

    if (finalState.status !== 'completed') return 1;
    const hasPassingChampion = Boolean(finalState.champion && finalState.champion.passed) || (finalState.totals?.passed > 0);
    return hasPassingChampion ? 0 : 2;
  } finally {
    process.off('SIGINT', onSigint);
    await shutdownSharedWorkerPools();
  }
}

async function cmdRuns(argv) {
  const { flags, positional } = parseArgv(argv);
  const action = positional[0] || 'list';

  if (action === 'list') {
    fs.mkdirSync(PATHS.runsDir, { recursive: true });
    const entries = fs.readdirSync(PATHS.runsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'));
    const runs = entries.map((d) => {
      const fullDir = path.join(PATHS.runsDir, d.name);
      const stateFile = path.join(fullDir, 'campaign_state.json');
      const stat = fs.statSync(fullDir);
      let state = null;
      if (fs.existsSync(stateFile)) {
        try {
          state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        } catch {}
      }
      return {
        runId: d.name,
        path: fullDir,
        mtimeUtc: stat.mtime.toISOString(),
        status: state?.status || 'artifacts_only',
        briefId: state?.briefId || null,
        executionMode: state?.executionMode || null,
        searchProfile: state?.searchProfile || null,
        passed: state?.totals?.passed ?? null,
        evaluated: state?.totals?.evaluated ?? null,
        champion: state?.champion?.name || null,
      };
    }).sort((a, b) => b.mtimeUtc.localeCompare(a.mtimeUtc));

    console.log(JSON.stringify({ runsDir: PATHS.runsDir, count: runs.length, runs }, null, 2));
    return 0;
  }

  if (action === 'show') {
    const runId = positional[1] || flags['run-id'];
    if (!runId) throw new Error('runs show requires <runId>');
    const runDir = path.join(PATHS.runsDir, String(runId));
    if (!fs.existsSync(runDir)) throw new Error(`Run not found: ${runId}`);
    const stateFile = path.join(runDir, 'campaign_state.json');
    const paretoFile = path.join(runDir, 'pareto_summary.json');
    const state = fs.existsSync(stateFile) ? loadJsonFile(stateFile) : null;
    const pareto = fs.existsSync(paretoFile) ? loadJsonFile(paretoFile) : null;
    console.log(JSON.stringify({ runId, runDir, state, pareto }, null, 2));
    return 0;
  }

  if (action === 'pareto') {
    const runId = positional[1] || flags['run-id'];
    if (!runId) throw new Error('runs pareto requires <runId>');
    const runDir = path.join(PATHS.runsDir, String(runId));
    if (!fs.existsSync(runDir)) throw new Error(`Run not found: ${runId}`);
    const paretoFile = path.join(runDir, 'pareto_summary.json');
    const stateFile = path.join(runDir, 'campaign_state.json');
    if (fs.existsSync(paretoFile)) {
      console.log(JSON.stringify(loadJsonFile(paretoFile), null, 2));
      return 0;
    }
    if (fs.existsSync(stateFile)) {
      const state = loadJsonFile(stateFile);
      console.log(JSON.stringify({
        runId,
        champion: state.champion || null,
        paretoFront: state.paretoFront || [],
      }, null, 2));
      return 0;
    }
    throw new Error(`No pareto_summary.json or campaign_state.json found in run: ${runId}`);
  }

  if (action === 'clean') {
    const scope = String(flags.scope || 'scratch').toLowerCase();
    const removed = [];
    if (scope === 'scratch') {
      if (fs.existsSync(PATHS.runsDir)) {
        for (const name of fs.readdirSync(PATHS.runsDir)) {
          if (name.startsWith('_tmp_') || name === '.bench_cache.json') {
            const target = path.join(PATHS.runsDir, name);
            fs.rmSync(target, { recursive: true, force: true });
            removed.push(target);
          }
        }
      }
      console.log(JSON.stringify({ status: 'ok', scope: 'scratch', removed }, null, 2));
      return 0;
    }
    if (scope === 'run') {
      const runId = String(flags['run-id'] || positional[1] || '');
      if (!runId || runId.includes('..') || runId.includes('/') || runId.includes('\\')) {
        throw new Error('runs clean --scope run requires a valid --run-id without path separators');
      }
      const target = path.resolve(PATHS.runsDir, runId);
      if (!target.startsWith(PATHS.runsDir + path.sep)) {
        throw new Error(`Refusing to remove path outside runs/: ${target}`);
      }
      if (!fs.existsSync(target)) {
        throw new Error(`Run not found: ${runId}`);
      }
      fs.rmSync(target, { recursive: true, force: true });
      removed.push(target);
      console.log(JSON.stringify({ status: 'ok', scope: 'run', runId, removed }, null, 2));
      return 0;
    }
    throw new Error(`Unknown clean scope "${scope}". Use --scope scratch or --scope run.`);
  }

  throw new Error(`Unknown runs subcommand "${action}". Use list, show, pareto, or clean.`);
}

async function cmdReport(argv) {
  const { flags } = parseArgv(argv);
  const forwardArgs = [];
  let runDir = null;
  if (flags['run-dir']) {
    runDir = path.resolve(process.cwd(), String(flags['run-dir']));
  } else if (flags['run-id']) {
    runDir = path.join(PATHS.runsDir, String(flags['run-id']));
  }
  if (runDir) forwardArgs.push('--run-dir', runDir);
  if (flags.brief) forwardArgs.push('--brief', resolveBriefPath(String(flags.brief)));
  const outPath = flags.out
    ? path.resolve(process.cwd(), String(flags.out))
    : path.join(FOUNDRY_ROOT, 'foundry_report.html');
  if (flags.out) forwardArgs.push('--out', outPath);

  const res = await spawnNodeCaptured(PATHS.reportBuilderCli, forwardArgs);
  if (res.code !== 0) {
    if (res.stderr) process.stderr.write(res.stderr);
    if (res.stdout) process.stderr.write(res.stdout);
    return res.code;
  }
  const bytes = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
  console.log(JSON.stringify({
    status: 'ok',
    runId: flags['run-id'] || null,
    runDir,
    reportPath: outPath,
    bytes,
    detail: res.stdout.trim(),
  }, null, 2));
  return 0;
}

async function cmdServe(argv) {
  const { flags, positional } = parseArgv(argv);
  const port = resolvePort(flags);
  const ecosystem = await resolveEcosystemCli(flags.ecosystem);
  const requestedMode = resolveRequestedMode(flags, positional);
  const shouldBindMcp = flags['bind-mcp'] !== undefined
    ? parseBool(flags['bind-mcp'], true)
    : (ecosystem === 'antigravity');

  // Idempotency pre-check: reuse healthy daemon on :8787 instead of EADDRINUSE or orphaning MCP
  if (!flags.restart) {
    const existingHealth = await probeHealth(port, 2000);
    if (existingHealth) {
      if (requestedMode === 'A' || requestedMode === 'B') {
        await syncDaemonMode(port, requestedMode);
      }
      if (shouldBindMcp) {
        await ensureMcpBoundOnDaemon(port, ecosystem);
      }
      const updated = (await probeHealth(port, 2500)) || existingHealth;
      console.log(JSON.stringify({
        ok: true,
        status: 'online',
        reusedDaemon: true,
        port,
        url: `http://127.0.0.1:${port}`,
        ecosystem: updated.ecosystem || ecosystem,
        sessionId: updated.mcp?.sessionId || null,
        executionMode: updated.executionMode || 'A',
        allowModeB: Boolean(updated.allowModeB),
        mcpBound: Boolean(updated.mcp?.bound ?? shouldBindMcp),
        uiBridge: updated.mcp?.uiBridge || null,
      }, null, 2));
      return 0;
    }
  }

  const forwardArgs = ['--port', String(port), '--ecosystem', ecosystem];
  if (flags.state !== undefined) forwardArgs.push('--state', String(flags.state));
  if (requestedMode === 'B') forwardArgs.push('--allow-mode-b');
  if (shouldBindMcp) forwardArgs.push('--bind-mcp');
  else forwardArgs.push('--no-bind-mcp');
  if (flags['no-browser'] || flags.browser === false) forwardArgs.push('--no-browser');
  if (flags['mcp-auto']) forwardArgs.push('--mcp-auto');

  return await spawnNodeInherited(PATHS.serverCli, forwardArgs);
}

async function cmdMcp(argv) {
  const { flags } = parseArgv(argv);
  const ecosystem = await resolveEcosystemCli(flags.ecosystem);

  const serverConfig = {
    command: process.execPath,
    args: [PATHS.mcpCli, '--ecosystem', ecosystem],
    env: {
      TOPOGEN_ECOSYSTEM: ecosystem,
    },
  };

  if (flags['print-config']) {
    let configPath = null;
    if (fs.existsSync(PATHS.desktopBinding)) {
      const bindMod = await import(pathToFileURL(PATHS.desktopBinding).href);
      if (typeof bindMod.antigravityMcpConfigFile === 'function') {
        configPath = bindMod.antigravityMcpConfigFile();
      }
    }
    console.log(JSON.stringify({
      ecosystem,
      configPath,
      mcpServers: {
        topogen_fdm_foundry: serverConfig,
      },
    }, null, 2));
    return 0;
  }

  if (flags.bind) {
    if (!fs.existsSync(PATHS.desktopBinding)) {
      throw new Error(`Desktop binding module not found at ${PATHS.desktopBinding}`);
    }
    const bindMod = await import(pathToFileURL(PATHS.desktopBinding).href);
    const configPath = flags['config-path'] ? path.resolve(process.cwd(), String(flags['config-path'])) : undefined;
    const receipt = await bindMod.bindAntigravityMcp(serverConfig, configPath);
    console.log(JSON.stringify({ status: 'ok', action: 'bind', ecosystem, receipt }, null, 2));
    return 0;
  }

  if (flags.unbind) {
    if (!fs.existsSync(PATHS.desktopBinding)) {
      throw new Error(`Desktop binding module not found at ${PATHS.desktopBinding}`);
    }
    const bindMod = await import(pathToFileURL(PATHS.desktopBinding).href);
    const configPath = flags['config-path'] ? path.resolve(process.cwd(), String(flags['config-path'])) : undefined;
    const receipt = await bindMod.unbindAntigravityMcp(flags.session ? String(flags.session) : undefined, configPath);
    console.log(JSON.stringify({ status: 'ok', action: 'unbind', ecosystem, receipt }, null, 2));
    return 0;
  }

  // Default: run stdio MCP server directly
  if (!fs.existsSync(PATHS.mcpCli)) {
    throw new Error(`MCP server script not found at ${PATHS.mcpCli}`);
  }
  const forwardArgs = ['--ecosystem', ecosystem];
  if (flags.session) forwardArgs.push('--session', String(flags.session));
  return await spawnNodeInherited(PATHS.mcpCli, forwardArgs);
}

// ============================================================================
// Main Dispatcher
// ============================================================================

async function main() {
  const rawArgv = process.argv.slice(2);
  const cmd = rawArgv[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    process.exit(0);
  }
  if (cmd === '--version' || cmd === '-v') {
    console.log('topogen 2.0.0');
    process.exit(0);
  }

  const subArgv = rawArgv.slice(1);
  let exitCode = 0;

  switch (cmd) {
    case 'launch':
    case 'open':
      exitCode = await cmdLaunch(subArgv);
      break;
    case 'mode':
      exitCode = await cmdMode(subArgv);
      break;
    case 'tabs':
      exitCode = await cmdTabs(subArgv);
      break;
    case 'ui':
      exitCode = await cmdUi(subArgv);
      break;
    case 'seal':
      exitCode = await cmdSeal(subArgv);
      break;
    case 'bench':
      exitCode = await cmdBench(subArgv);
      break;
    case 'generate':
      exitCode = await cmdGenerate(subArgv);
      break;
    case 'verify':
      exitCode = await cmdVerify(subArgv);
      break;
    case 'eval':
      exitCode = await cmdEval(subArgv);
      break;
    case 'batch':
      exitCode = await cmdBatch(subArgv);
      break;
    case 'run':
      exitCode = await cmdRun(subArgv);
      break;
    case 'runs':
      exitCode = await cmdRuns(subArgv);
      break;
    case 'report':
      exitCode = await cmdReport(subArgv);
      break;
    case 'serve':
      exitCode = await cmdServe(subArgv);
      break;
    case 'mcp':
      exitCode = await cmdMcp(subArgv);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\nRun "topogen --help" for usage.\n`);
      process.exit(1);
  }

  process.exit(exitCode);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
  main().catch((err) => {
    process.stderr.write(JSON.stringify({
      ok: false,
      status: 'error',
      error: err?.message || String(err),
    }) + '\n');
    process.exit(1);
  });
}

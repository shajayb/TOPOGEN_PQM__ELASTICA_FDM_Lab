import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveEcosystem } from './ecosystem.mjs';
import { antigravityMcpConfigFile } from './desktop-binding.mjs';
import { toolDefinitions, validateTool } from './tools.mjs';
import { brokerCall } from './broker.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
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

function localAppDataDir() {
  if (process.platform === 'win32') {
    return process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  }
  return path.join(os.homedir(), '.local', 'share');
}

function listCandidateManifests(minMtimeMs = 0) {
  const candidates = [];
  const seen = new Set();
  const addPath = p => {
    if (typeof p !== 'string' || !p || seen.has(p)) return;
    seen.add(p);
    try {
      if (!fs.existsSync(p)) return;
      const entry = readManifest(p);
      if (entry.mtimeMs >= minMtimeMs) candidates.push(entry);
    } catch {}
  };

  if (options['--session']) addPath(options['--session']);

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

  const ecoDir = path.join(localAppDataDir(), 'Topogen', 'Foundry', ecosystem);
  try {
    if (fs.existsSync(ecoDir)) {
      const recent = [];
      for (const name of fs.readdirSync(ecoDir)) {
        const candidate = path.join(ecoDir, name, 'agent-session.json');
        if (seen.has(candidate)) continue;
        try {
          if (!fs.existsSync(candidate)) continue;
          const entry = readManifest(candidate);
          if (entry.mtimeMs >= minMtimeMs) recent.push(entry);
        } catch {}
      }
      recent.sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const entry of recent) {
        seen.add(entry.sessionPath);
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
        return await brokerCall(manifest.endpoint, payloadFor(manifest));
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

const output = value => process.stdout.write(JSON.stringify(value) + '\n');

for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  if (!line.trim()) continue;
  let request;
  try {
    if (Buffer.byteLength(line, 'utf8') > 262144) throw Error('MCP request exceeds limit');
    request = JSON.parse(line);
    if (!Object.hasOwn(request, 'id')) continue;
    let result;
    if (request.method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'topogen_fdm_foundry', version: '2.0.0' }
      };
    } else if (request.method === 'ping') {
      result = {};
    } else if (request.method === 'tools/list') {
      result = { tools: toolDefinitions };
    } else if (request.method === 'tools/call') {
      const name = request.params?.name;
      const args = request.params?.arguments || {};
      validateTool(name, args);
      const response = await callWithAutoLaunch(name, args);
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

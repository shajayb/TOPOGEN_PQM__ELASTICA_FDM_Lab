import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveEcosystem, ecosystemInfo, ecosystemEnvironment } from './ecosystem.mjs';
import { brokerCall } from './broker.mjs';
import {
  bindAntigravityMcp,
  unbindAntigravityMcp,
  latestSessionManifestFile,
} from './desktop-binding.mjs';
import {
  BRIDGE_PROTOCOL_VERSION,
  UI_ACTIONS,
  classifyBrowserKind,
  createBrowserUiBridge,
} from './ui-bridge.mjs';
import {
  UI_STEPS,
  UI_STEP_MODES,
  UI_LOAD_TARGETS,
  UI_EXPORT_FORMATS,
  UI_SURFACES,
  UI_CONFIG_SECTIONS,
} from './ui-action-contract.mjs';
import { createAgentService, publicResult } from './service.mjs';
import {
  toolDefinitions,
  validateTool,
  TOOLS_SHA256,
  computeToolsSha256,
  readManifestSurfaceInfo,
} from './tools.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOUNDRY_ROOT = path.resolve(__dirname, '..');
const mcpScript = path.join(__dirname, 'mcp.mjs');
const serverScript = path.join(FOUNDRY_ROOT, 'foundry_server.mjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(err => (err ? reject(err) : resolve(port)));
    });
  });
}

function httpJson(port, method, pathname, body = undefined, extraHeaders = {}, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const rawBody = body !== undefined ? JSON.stringify(body) : null;
    const headers = {
      Accept: 'application/json',
      Origin: `http://127.0.0.1:${port}`,
      ...extraHeaders,
    };
    if (rawBody !== null) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(rawBody, 'utf8');
    }
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method,
        headers,
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data = null;
          if (text.trim()) {
            try {
              data = JSON.parse(text);
            } catch {
              data = { raw: text };
            }
          }
          resolve({
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            status: res.statusCode ?? 0,
            headers: res.headers,
            data,
          });
        });
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(Object.assign(Error(`HTTP ${method} ${pathname} timed out`), { code: 'ETIMEDOUT' }));
    });
    req.on('error', reject);
    if (rawBody !== null) req.write(rawBody);
    req.end();
  });
}

function createMcpClient(child) {
  const pending = new Map();
  let nextId = 1;
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', line => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    const handler = pending.get(msg.id);
    if (handler) {
      pending.delete(msg.id);
      handler(msg);
    }
  });
  return {
    request(method, params = {}, timeoutMs = 20000) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`MCP request timed out: ${method}`));
        }, timeoutMs);
        pending.set(id, msg => {
          clearTimeout(timer);
          resolve(msg);
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    async callTool(name, args = {}, timeoutMs = 20000) {
      const res = await this.request('tools/call', { name, arguments: args }, timeoutMs);
      const parsed = res?.result?.content?.[0]?.text
        ? JSON.parse(res.result.content[0].text)
        : null;
      return {
        raw: res,
        isError: Boolean(res?.result?.isError || res?.error),
        rpcError: res?.error || null,
        body: parsed,
      };
    },
    async close() {
      rl.close();
      if (child.exitCode === null && !child.killed) {
        try { child.kill(); } catch {}
        await Promise.race([
          new Promise(r => child.once('exit', r)),
          sleep(800),
        ]);
      }
    }
  };
}

const UA_BY_KIND = {
  chrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  webview: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Antigravity/1.0.0 Chrome/128.0.0.0 Electron/32.0.0 Safari/537.36',
  headless: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36',
};

/**
 * Simulated in-process HTTP long-polling browser tab client for deterministic multi-tab & chaos tests.
 */
function createSimulatedBrowserTab({
  port,
  uiBridgeToken,
  clientId,
  surface = 'workbench',
  browserKind = 'chrome',
  userAgent = UA_BY_KIND[browserKind] || UA_BY_KIND.chrome,
  bridgeVersion = 2,
  conv = undefined,
  launch = undefined,
  visible = true,
  focused = false,
  lastFocusedAt = 0,
  url = undefined,
  onTask = null,
}) {
  let active = true;
  let pendingLaunch = launch;
  let currentConv = conv;
  let currentReq = null;
  let firstPollResolved = false;
  let resolveFirstPoll;
  const firstPollEntered = new Promise(r => { resolveFirstPoll = r; });

  const state = {
    preset: 'pilot_champion',
    grid: { x: 3, y: 3, z: 4 },
    activeTab: 'tab-tiles',
    voxelPins: [],
    fea: { animating: false, deflectionScale: 10, loadCase: 'self_weight' },
  };
  const receivedTasks = [];
  const syncHeadersLog = [];

  const pageUrl = url || (
    `http://127.0.0.1:${port}/${surface === 'launcher' ? 'foundry_launcher.html' : 'index_TOPOGEN_PQM_ELASTICA_FDM.html'}` +
    (currentConv ? `?conv=${encodeURIComponent(currentConv)}` : '')
  );

  const pollOnce = () => new Promise((resolve, reject) => {
    const qs = new URLSearchParams();
    qs.set('clientId', clientId);
    qs.set('surface', surface);
    qs.set('browserKind', browserKind);
    qs.set('bridgeVersion', String(bridgeVersion));
    qs.set('visible', visible ? '1' : '0');
    qs.set('focused', focused ? '1' : '0');
    qs.set('focusedAt', String(lastFocusedAt || (focused ? Date.now() : 0)));
    qs.set('url', pageUrl);
    qs.set('timeoutMs', '2500');
    if (currentConv !== undefined && currentConv !== null) {
      qs.set('conv', String(currentConv));
    }
    if (pendingLaunch) {
      qs.set('launch', String(pendingLaunch));
    }

    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: `/api/ui-bridge/poll?${qs.toString()}`,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Origin: `http://127.0.0.1:${port}`,
          'x-ui-bridge-token': uiBridgeToken,
          'User-Agent': userAgent,
        },
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          pendingLaunch = undefined;
          syncHeadersLog.push({
            boundConv: res.headers['x-bound-conversation'] ?? '',
            mode: res.headers['x-execution-mode'] ?? '',
            allowModeB: res.headers['x-allow-mode-b'] ?? '',
            bridgeVersion: res.headers['x-bridge-version'] ?? '',
          });
          if (typeof res.headers['x-bound-conversation'] === 'string' && res.headers['x-bound-conversation']) {
            currentConv = res.headers['x-bound-conversation'];
          }
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(parsed);
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    currentReq = req;
    if (!firstPollResolved) {
      firstPollResolved = true;
      setTimeout(() => resolveFirstPoll(), 35);
    }
    req.on('error', err => {
      currentReq = null;
      reject(err);
    });
    req.end();
  });

  const defaultTaskHandler = async task => {
    if (task.action === 'ping') {
      return {
        response: {
          ok: true,
          pong: true,
          clientId,
          conversationId: currentConv || null,
          browserKind,
          surface,
          bridgeVersion,
          activeTab: state.activeTab,
        }
      };
    }
    if (task.action === '__reload__') {
      if (bridgeVersion < 2) {
        return { error: 'Unsupported UI bridge action: __reload__' };
      }
      return { response: { reloading: true } };
    }
    if (task.action === 'reload') {
      return {
        response: {
          ok: true,
          reloading: true,
          preserveState: task.payload?.preserveState !== false,
          hardReload: task.payload?.hardReload !== false,
        }
      };
    }
    if (task.action === 'inspect') {
      return {
        response: {
          ok: true,
          available: true,
          clientId,
          conversationId: currentConv || null,
          browserKind,
          surface,
          bridgeVersion,
          activeTab: state.activeTab,
          preset: state.preset,
          gridResolution: state.grid,
          voxelPinCount: state.voxelPins.length,
          voxelPins: state.voxelPins,
          fea: { ...state.fea },
        }
      };
    }
    if (task.action === 'configure') {
      const p = task.payload || {};
      const applied = [];
      const gSpec = p.gridResolution !== undefined ? p.gridResolution : p.grid;
      if (gSpec !== undefined) {
        if (typeof gSpec === 'string') {
          const [x, y, z] = gSpec.split(/[xX,\s]+/).map(Number);
          state.grid = { x, y, z };
        } else if (Array.isArray(gSpec)) {
          state.grid = { x: gSpec[0], y: gSpec[1], z: gSpec[2] };
        } else if (gSpec && typeof gSpec === 'object') {
          state.grid = { x: gSpec.x, y: gSpec.y, z: gSpec.z };
        }
        applied.push(p.gridResolution !== undefined ? 'gridResolution' : 'grid');
      }
      if (p.clearVoxelPins) {
        state.voxelPins = [];
        applied.push('clearVoxelPins');
      }
      if (Array.isArray(p.voxelPins)) {
        state.voxelPins = p.voxelPins.map(pin => ({ ...pin }));
        applied.push('voxelPins');
      }
      if (p.fea && typeof p.fea === 'object') {
        if (typeof p.fea.animate === 'boolean') state.fea.animating = p.fea.animate;
        if (typeof p.fea.deflectionScale === 'number') state.fea.deflectionScale = p.fea.deflectionScale;
        if (typeof p.fea.loadCase === 'string') state.fea.loadCase = p.fea.loadCase;
        applied.push('fea');
      }
      if (p.preset) {
        state.preset = p.preset;
        applied.push('preset');
      }
      if (p.tab) {
        state.activeTab = p.tab;
        applied.push('tab');
      }
      return {
        response: {
          configured: applied.length > 0,
          applied,
          state: {
            gridResolution: state.grid,
            preset: state.preset,
            activeTab: state.activeTab,
            voxelPins: state.voxelPins,
            fea: { ...state.fea },
          },
        }
      };
    }
    if (task.action === 'load_file') {
      return {
        response: {
          loaded: true,
          fileName: task.payload?.fileName || 'custom.obj',
          target: task.payload?.target || 'tile',
        }
      };
    }
    if (task.action === 'run_step') {
      const delayMs = Number(task.payload?.params?.delayMs || 0);
      const startedAt = performance.now();
      if (delayMs > 0) await sleep(delayMs);
      const finishedAt = performance.now();
      if (task.payload?.step === 'fea_animate') {
        const mode = task.payload?.mode || task.payload?.params?.mode || 'toggle';
        if (mode === 'start') state.fea.animating = true;
        else if (mode === 'stop') state.fea.animating = false;
        else state.fea.animating = !state.fea.animating;
        return {
          response: {
            step: 'fea_animate',
            mode,
            completed: true,
            executedOn: clientId,
            fea: { ...state.fea },
          }
        };
      }
      return {
        response: {
          step: task.payload?.step,
          completed: true,
          executedOn: clientId,
          tag: task.payload?.params?.tag || null,
          startedAt,
          finishedAt,
        }
      };
    }
    if (task.action === 'export') {
      return {
        response: {
          format: task.payload?.format || 'topology',
          filename: 'mock.svg',
          bytes: 44,
          data: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        }
      };
    }
    return { error: `Unknown action ${task.action}` };
  };

  const loopPromise = (async () => {
    while (active) {
      let polled;
      try {
        polled = await pollOnce();
      } catch {
        if (!active) break;
        await sleep(40);
        continue;
      }
      if (!active) break;
      const task = polled?.task;
      if (!task) continue;
      receivedTasks.push({
        id: task.id,
        action: task.action,
        payload: task.payload,
        receivedAt: performance.now(),
      });
      const outcome = onTask ? await onTask(task, defaultTaskHandler) : await defaultTaskHandler(task);
      if (!active || outcome?.skipReply) continue;
      try {
        await httpJson(
          port,
          'POST',
          '/api/ui-bridge/reply',
          {
            id: task.id,
            clientId,
            surface,
            browserKind,
            bridgeVersion,
            conv: currentConv || undefined,
            visible,
            focused,
            url: pageUrl,
            ...(outcome.error ? { error: outcome.error } : { response: outcome.response }),
          },
          {
            'x-ui-bridge-token': uiBridgeToken,
            'User-Agent': userAgent,
          },
          5000
        );
      } catch {
        if (!active) break;
      }
    }
  })();

  return {
    clientId,
    state,
    receivedTasks,
    syncHeadersLog,
    ready: () => firstPollEntered,
    async sendBeaconDisconnect() {
      active = false;
      try { currentReq?.destroy(); } catch {}
      const res = await httpJson(
        port,
        'POST',
        '/api/ui-bridge/disconnect',
        { clientId, bridgeProof: uiBridgeToken, surface },
        {}, // Deliberately omit x-ui-bridge-token to test navigator.sendBeacon Blob proof!
        5000
      );
      await loopPromise.catch(() => {});
      return res;
    },
    async stop(notifyServer = true) {
      active = false;
      try { currentReq?.destroy(); } catch {}
      if (notifyServer) {
        await httpJson(
          port,
          'POST',
          '/api/ui-bridge/disconnect',
          { clientId, bridgeProof: uiBridgeToken, surface },
          {},
          2000
        ).catch(() => {});
      }
      await loopPromise.catch(() => {});
    },
  };
}

/**
 * Write a standalone mock Chrome executable script used via TOPOGEN_MOCK_CHROME_CMD.
 * Logs every spawn to spawnsFile and connects to the target Foundry URL via /api/ui-bridge/poll.
 */
function writeMockChromeScript(scriptPath, spawnsFile) {
  const code = `import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const targetUrl = process.argv[2] || process.env.TOPOGEN_LAUNCH_URL || '';
const spawnsFile = ${JSON.stringify(spawnsFile)};
const urlObj = new URL(targetUrl);
const port = Number(urlObj.port || 8787);
const surface = urlObj.pathname.includes('foundry_launcher.html') ? 'launcher' : 'workbench';
const prefix = surface === 'launcher' ? 'ln' : 'wb';
const clientId = \`\${prefix}_mock_\${crypto.randomBytes(4).toString('hex')}\`;
let currentConv = urlObj.searchParams.get('conv') || '';
let pendingLaunch = urlObj.searchParams.get('launch') || '';

fs.appendFileSync(spawnsFile, JSON.stringify({
  pid: process.pid,
  clientId,
  url: targetUrl,
  pathname: urlObj.pathname,
  conv: currentConv || null,
  launch: pendingLaunch || null,
  ts: Date.now()
}) + '\\n', 'utf8');

const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function reqJson(method, pathStr, body, token) {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : null;
    const headers = {
      Accept: 'application/json',
      Origin: \`http://127.0.0.1:\${port}\`,
      'User-Agent': CHROME_UA,
      ...(token ? { 'x-ui-bridge-token': token } : {}),
      ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
    };
    const req = http.request({ hostname: '127.0.0.1', port, path: pathStr, method, headers }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    if (payload !== null) req.write(payload);
    req.end();
  });
}

let grid = { x: 3, y: 3, z: 4 };
let preset = 'pilot_champion';
let activeTab = 'tab-tiles';

async function main() {
  const health = await reqJson('GET', '/api/health');
  const token = health.data?.uiBridgeToken;
  if (!token) process.exit(1);

  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const cleanUrl = \`http://127.0.0.1:\${port}\${urlObj.pathname}\${currentConv ? '?conv=' + encodeURIComponent(currentConv) : ''}\`;
    const qs = new URLSearchParams({
      clientId,
      surface,
      browserKind: 'chrome',
      bridgeVersion: '2',
      visible: '1',
      focused: '1',
      focusedAt: String(Date.now()),
      url: cleanUrl,
      timeoutMs: '3000',
    });
    if (currentConv) qs.set('conv', currentConv);
    if (pendingLaunch) qs.set('launch', pendingLaunch);

    let polled;
    try {
      polled = await reqJson('GET', '/api/ui-bridge/poll?' + qs.toString(), undefined, token);
      pendingLaunch = '';
      if (polled.headers['x-bound-conversation']) {
        currentConv = String(polled.headers['x-bound-conversation']);
      }
    } catch {
      break;
    }

    const task = polled.data?.task;
    if (!task) continue;

    let response = { ok: true };
    if (task.action === 'ping') {
      response = { ok: true, pong: true, clientId, conversationId: currentConv || null, browserKind: 'chrome', surface, bridgeVersion: 2, activeTab };
    } else if (task.action === 'inspect') {
      response = { available: true, clientId, conversationId: currentConv || null, browserKind: 'chrome', surface, bridgeVersion: 2, gridResolution: grid, preset, activeTab };
    } else if (task.action === 'configure') {
      const p = task.payload || {};
      const applied = [];
      const g = p.gridResolution !== undefined ? p.gridResolution : p.grid;
      if (g !== undefined) {
        if (typeof g === 'string') {
          const [x, y, z] = g.split(/[xX,\\s]+/).map(Number);
          grid = { x, y, z };
        } else if (Array.isArray(g)) {
          grid = { x: g[0], y: g[1], z: g[2] };
        } else if (g && typeof g === 'object') {
          grid = { x: g.x, y: g.y, z: g.z };
        }
        applied.push(p.gridResolution !== undefined ? 'gridResolution' : 'grid');
      }
      if (p.preset) { preset = p.preset; applied.push('preset'); }
      if (p.tab) { activeTab = p.tab; applied.push('tab'); }
      response = { configured: applied.length > 0, applied, state: { gridResolution: grid, preset, activeTab } };
    } else if (task.action === 'run_step') {
      response = { step: task.payload?.step, completed: true, executedOn: clientId };
    } else if (task.action === 'load_file') {
      response = { loaded: true, fileName: task.payload?.fileName || 'tile.obj', target: task.payload?.target || 'tile' };
    } else if (task.action === 'export') {
      response = { format: task.payload?.format || 'topology', filename: 'out.svg', bytes: 44, data: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' };
    }

    try {
      await reqJson('POST', '/api/ui-bridge/reply', {
        id: task.id,
        clientId,
        surface,
        browserKind: 'chrome',
        bridgeVersion: 2,
        conv: currentConv || undefined,
        visible: true,
        focused: true,
        url: cleanUrl,
        response,
      }, token);
    } catch {
      break;
    }
  }
}

main().catch(() => process.exit(1));
`;
  fs.writeFileSync(scriptPath, code, 'utf8');
}

function readSpawnsLog(spawnsFile) {
  if (!fs.existsSync(spawnsFile)) return [];
  return fs.readFileSync(spawnsFile, 'utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line));
}

async function startEphemeralDaemon({ port, env, extraArgs = [] }) {
  const child = spawn(
    process.execPath,
    [serverScript, '--port', String(port), '--no-browser', '--ecosystem', 'antigravity', ...extraArgs],
    {
      cwd: FOUNDRY_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  let stderr = '';
  child.stderr.on('data', d => { stderr += d.toString(); });

  const deadline = Date.now() + 15000;
  let health = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw Error(`Ephemeral foundry_server exited early (${child.exitCode}): ${stderr}`);
    }
    try {
      const res = await httpJson(port, 'GET', '/api/health', undefined, {}, 1500);
      if (res.ok && res.data?.status === 'online' && res.data?.uiBridgeToken) {
        health = res.data;
        break;
      }
    } catch {}
    await sleep(120);
  }
  if (!health) {
    try { child.kill(); } catch {}
    throw Error(`Timed out waiting for ephemeral foundry_server on :${port}: ${stderr}`);
  }

  return {
    child,
    port,
    health,
    async stop() {
      if (child.exitCode === null && !child.killed) {
        try { child.kill('SIGTERM'); } catch {}
        await Promise.race([
          new Promise(r => child.once('exit', r)),
          sleep(2000),
        ]);
        if (child.exitCode === null) {
          try { child.kill('SIGKILL'); } catch {}
        }
      }
    }
  };
}

async function run() {
  const results = [];
  const check = async (name, fn) => {
    await fn();
    results.push(name);
    console.log(`PASS: ${name}`);
  };

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'topogen-mcp-test-'));
  const projectDir = path.join(tempRoot, 'workspace');
  const stateDir = path.join(tempRoot, 'state');
  const mcpConfigPath = path.join(tempRoot, 'mcp_config.json');
  const daemonHome = path.join(tempRoot, 'home');
  const daemonLocalAppData = path.join(tempRoot, 'localappdata');
  const daemonMcpConfigPath = path.join(tempRoot, 'daemon_mcp_config.json');
  const mockChromeScript = path.join(tempRoot, 'mock-chrome.mjs');
  const spawnsFile = path.join(tempRoot, 'chrome-spawns.jsonl');

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.mkdirSync(daemonHome, { recursive: true });
  fs.mkdirSync(daemonLocalAppData, { recursive: true });
  writeMockChromeScript(mockChromeScript, spawnsFile);

  fs.writeFileSync(path.join(projectDir, 'hello.txt'), 'line1\nTOPOGEN_SEARCH_TOKEN=alpha\nGEMINI_API_KEY=AIzaSyFakeSecretKey123456789012345\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET=topsecret\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'API_KEYS.txt'), 'OPENAI_API_KEY=sk-1234567890abcdef\n', 'utf8');

  let service = null;
  let mcpChild = null;
  let mcpClient = null;
  const activeDaemons = [];
  const activeSimTabs = [];
  const liveMcpClients = [];

  try {
    // 1. Ecosystem resolution
    await check('ecosystem resolution & env propagation', async () => {
      assert.equal(resolveEcosystem(undefined, {}), 'antigravity');
      assert.equal(resolveEcosystem(undefined, { ALICE_ECOSYSTEM: 'codex' }), 'codex');
      assert.equal(resolveEcosystem(undefined, { TOPOGEN_ECOSYSTEM: 'codex', ALICE_ECOSYSTEM: 'antigravity' }), 'codex');
      assert.equal(resolveEcosystem('antigravity', { TOPOGEN_ECOSYSTEM: 'codex' }), 'antigravity');
      assert.throws(() => resolveEcosystem('unknown', {}), /antigravity or codex/i);
      assert.equal(ecosystemInfo('codex').desktop, 'Codex Desktop');
      const env = ecosystemEnvironment('antigravity', {});
      assert.equal(env.TOPOGEN_ECOSYSTEM, 'antigravity');
      assert.equal(env.ALICE_ECOSYSTEM, 'antigravity');
    });

    // 2. Expanded Mode B Tool Surface, UI_ACTIONS v2, classifyBrowserKind & Schema Hardening (M1, C2, C4, B04)
    await check('expanded Mode B tool surface, UI_ACTIONS v2, classifyBrowserKind & gridResolution schemas', async () => {
      assert.equal(BRIDGE_PROTOCOL_VERSION, 2);
      assert.deepEqual(UI_ACTIONS, ['inspect', 'load_file', 'configure', 'run_step', 'export', 'reload', 'ping']);
      assert.equal(TOOLS_SHA256, computeToolsSha256(toolDefinitions));
      assert.match(TOOLS_SHA256, /^[0-9a-f]{64}$/);
      const mInfo = readManifestSurfaceInfo(FOUNDRY_ROOT);
      assert.equal(mInfo.ok, true);
      assert.ok(typeof mInfo.foundryVersion === 'string' && mInfo.foundryVersion.length > 0);

      const names = new Set(toolDefinitions.map(t => t.name));
      for (const expectedTool of [
        'topogen_ui_launch',
        'topogen_ui_tabs',
        'topogen_ui_connect',
        'topogen_ui_inspect',
        'topogen_ui_load_file',
        'topogen_ui_configure',
        'topogen_ui_run_step',
        'topogen_ui_reload',
        'topogen_ui_export',
        'topogen_workspace_read_batch',
      ]) {
        assert.ok(names.has(expectedTool), `Missing expected MCP tool ${expectedTool}`);
      }

      // Browser UA classification (C4)
      assert.equal(classifyBrowserKind(UA_BY_KIND.chrome), 'chrome');
      assert.equal(classifyBrowserKind(UA_BY_KIND.edge), 'edge');
      assert.equal(classifyBrowserKind(UA_BY_KIND.webview), 'webview');
      assert.equal(classifyBrowserKind(UA_BY_KIND.headless), 'headless');

      // C2: gridResolution accepted as string, [x,y,z] array, and {x,y,z} object
      assert.equal(validateTool('topogen_ui_configure', { gridResolution: '1x1x1', conversationId: 'conv-1' }), 'ui.configure');
      assert.equal(validateTool('topogen_ui_configure', { gridResolution: [1, 1, 1], fdmMode: 'tensile' }), 'ui.configure');
      assert.equal(validateTool('topogen_ui_configure', { gridResolution: { x: 1, y: 1, z: 1 }, outerRadiusM: 0.03, innerRadiusM: 0.015 }), 'ui.configure');
      assert.throws(() => validateTool('topogen_ui_configure', { gridResolution: [1, 2] }), /gridResolution/i);
      assert.throws(() => validateTool('topogen_ui_configure', { gridResolution: { x: 0, y: 1, z: 1 } }), /gridResolution/i);

      // Verify publicResult secret scrubber never strips UI bridge / launch metadata keys
      const scrubbed = publicResult({
        ok: true,
        clientId: 'wb_abc123',
        conversationId: 'conv-alpha',
        launchId: 'lnch_xyz',
        browserKind: 'chrome',
        bridgeVersion: 2,
        surface: 'workbench',
        url: 'http://127.0.0.1:8787/index_TOPOGEN_PQM_ELASTICA_FDM.html?conv=conv-alpha',
        secretToken: 'REDACTED',
      });
      assert.equal(scrubbed.clientId, 'wb_abc123');
      assert.equal(scrubbed.conversationId, 'conv-alpha');
      assert.equal(scrubbed.launchId, 'lnch_xyz');
      assert.equal(scrubbed.secretToken, undefined);
    });

    // 3. Browser UI Bridge unit routing & focus-steal guard
    await check('browser UI bridge offline, round-trip, Chrome focus routing & explicit-clientId focus-steal guard', async () => {
      const bridge = createBrowserUiBridge({ ecosystem: 'antigravity' });
      const offline = await bridge.request('inspect', 250);
      assert.equal(offline.available, false);
      assert.equal(offline.code, 'NO_CHROME_TAB');

      const pollPromise = bridge.poll(2000, 'tab-1', {
        browserKind: 'chrome',
        bridgeVersion: 2,
        visible: true,
        focused: false,
        lastFocusedAt: 100,
      });
      const reqPromise = bridge.request('inspect', 2000, { verbose: false });
      const task = await pollPromise;
      assert.equal(task.action, 'inspect');
      const rep = bridge.reply({ id: task.id, clientId: 'tab-1', browserKind: 'chrome', bridgeVersion: 2, response: { preset: 'pilot_champion', nodes: 42 } });
      assert.equal(rep.accepted, true);
      const res = await reqPromise;
      assert.equal(res.available, true);
      assert.equal(res.preset, 'pilot_champion');
      assert.equal(bridge.status().connected, true);

      // Multi-tab focus routing: tab-2 focused after tab-1 must receive the next task
      const p1 = bridge.poll(2000, 'tab-1', { browserKind: 'chrome', bridgeVersion: 2, visible: true, focused: false, lastFocusedAt: 100 });
      const p2 = bridge.poll(2000, 'tab-2', { browserKind: 'chrome', bridgeVersion: 2, visible: true, focused: true, lastFocusedAt: 500 });
      bridge.focus('tab-2', { browserKind: 'chrome', bridgeVersion: 2, visible: true, focused: true, lastFocusedAt: 600 });
      const req2 = bridge.request('load_file', 2000, { target: 'tile', fileName: 'batwing.obj', content: 'v 0 0 0\n' });
      const t2 = await p2;
      assert.equal(t2.action, 'load_file');
      bridge.reply({ id: t2.id, clientId: 'tab-2', browserKind: 'chrome', bridgeVersion: 2, response: { loaded: true, clientId: 'tab-2' } });
      const r2 = await req2;
      assert.equal(r2.loaded, true);
      assert.equal(r2.clientId, 'tab-2');

      // M2 regression guard: explicit clientId inspect on tab-1 (even reporting focused: true in reply)
      // must NOT steal preferredClientId from tab-2!
      const req1 = bridge.request('inspect', 2000, { clientId: 'tab-1' });
      const t1 = await p1;
      assert.equal(t1.action, 'inspect');
      bridge.reply({ id: t1.id, clientId: 'tab-1', browserKind: 'chrome', bridgeVersion: 2, focused: true, response: { clientId: 'tab-1' } });
      const r1 = await req1;
      assert.equal(r1.clientId, 'tab-1');
      assert.equal(bridge.status().preferredClientId, 'tab-2');
    });

    // 4. Start real Agent Service with mock backend
    let inspectCalls = 0;
    let lastConfiguredArgs = null;
    const sessionId = 'test-session-' + crypto.randomUUID().slice(0, 8);
    service = await createAgentService({
      ecosystem: 'antigravity',
      sessionId,
      workspace: projectDir,
      stateDir,
      allowModeB: false,
      backend: {
        async inspect(args) {
          inspectCalls++;
          return {
            ok: true,
            foundry: 'TOPOGEN_FDM_FOUNDRY',
            calls: inspectCalls,
            verbose: Boolean(args?.verbose),
            secretToken: 'MUST_BE_STRIPPED',
            nested: { apiKey: 'MUST_BE_STRIPPED', safe: 'visible' }
          };
        },
        async command(operation, args) {
          lastConfiguredArgs = { operation, args };
          return { ok: true, operation, args };
        }
      }
    });

    const manifest = JSON.parse(fs.readFileSync(service.manifestPath, 'utf8'));
    assert.equal(manifest.schema, 'topogen.foundry.agent-session.v1');
    assert.equal(manifest.ecosystem, 'antigravity');
    assert.equal(manifest.sessionId, sessionId);

    // 5. Desktop MCP Binding / Unbinding (pinned & sessionless)
    await check('bindAntigravityMcp & unbindAntigravityMcp preserve sibling servers (pinned & sessionless)', async () => {
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: { other_server: { command: 'node', args: ['other.js'] } }
      }, null, 2));
      const cfg = service.desktopConfig();
      assert.ok(cfg.server.args.includes('--session'));
      const sessionlessCfg = service.desktopConfig({ pinSession: false });
      assert.ok(!sessionlessCfg.server.args.includes('--session'));

      bindAntigravityMcp(cfg.server, mcpConfigPath);
      const bound = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      assert.ok(bound.mcpServers.other_server);
      assert.equal(bound.mcpServers.topogen_fdm_foundry.command, process.execPath);

      // Wrong manifest must NOT unbind
      assert.equal(unbindAntigravityMcp('/wrong/manifest.json', mcpConfigPath), false);
      assert.ok(JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')).mcpServers.topogen_fdm_foundry);

      // Matching manifest unbinds cleanly and preserves sibling
      assert.equal(unbindAntigravityMcp(service.manifestPath, mcpConfigPath), true);
      const afterUnbind = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      assert.equal(afterUnbind.mcpServers.topogen_fdm_foundry, undefined);
      assert.ok(afterUnbind.mcpServers.other_server);
    });

    // 6. Direct broker security checks + C2 `args` vs `arguments` alias
    await check('broker auth (token & ecosystem), requestId idempotency & C2 args alias', async () => {
      const badToken = await brokerCall(manifest.endpoint, {
        tool: 'topogen_inspect',
        arguments: {},
        ecosystem: 'antigravity',
        sessionId,
        token: '0'.repeat(manifest.token.length),
        requestId: 'req-bad-token'
      });
      assert.equal(badToken.ok, false);
      assert.match(badToken.error, /mismatch/i);

      const badEco = await brokerCall(manifest.endpoint, {
        tool: 'topogen_inspect',
        arguments: {},
        ecosystem: 'codex',
        sessionId,
        token: manifest.token,
        requestId: 'req-bad-eco'
      });
      assert.equal(badEco.ok, false);
      assert.match(badEco.error, /mismatch/i);

      const first = await brokerCall(manifest.endpoint, {
        tool: 'topogen_inspect',
        arguments: { verbose: false },
        ecosystem: 'antigravity',
        sessionId,
        token: manifest.token,
        requestId: 'req-idem-1'
      });
      assert.equal(first.ok, true);
      assert.equal(first.result.calls, 1);
      assert.equal(first.result.secretToken, undefined);
      assert.equal(first.result.nested.apiKey, undefined);
      assert.equal(first.result.nested.safe, 'visible');

      // Replay with same requestId and same args returns cached receipt (calls still 1)
      const second = await brokerCall(manifest.endpoint, {
        tool: 'topogen_inspect',
        arguments: { verbose: false },
        ecosystem: 'antigravity',
        sessionId,
        token: manifest.token,
        requestId: 'req-idem-1'
      });
      assert.equal(second.ok, true);
      assert.equal(second.result.calls, 1);

      // Replay with same requestId and different args is rejected
      const mismatch = await brokerCall(manifest.endpoint, {
        tool: 'topogen_inspect',
        arguments: { verbose: true },
        ecosystem: 'antigravity',
        sessionId,
        token: manifest.token,
        requestId: 'req-idem-1'
      });
      assert.equal(mismatch.ok, false);
      assert.match(mismatch.error, /content mismatch/i);

      // C2: brokerCall with `args` instead of `arguments` must NOT silently drop parameters!
      const viaArgsAlias = await brokerCall(manifest.endpoint, {
        tool: 'topogen_ui_configure',
        args: { gridResolution: [1, 1, 1], preset: 'pilot_champion', conversationId: 'conv-c2' },
        ecosystem: 'antigravity',
        sessionId,
        token: manifest.token,
        requestId: 'req-c2-args-alias'
      });
      assert.equal(viaArgsAlias.ok, true);
      assert.equal(lastConfiguredArgs.operation, 'ui.configure');
      assert.deepEqual(lastConfiguredArgs.args.gridResolution, [1, 1, 1]);
      assert.equal(lastConfiguredArgs.args.preset, 'pilot_champion');
      assert.equal(lastConfiguredArgs.args.conversationId, 'conv-c2');
    });

    // 7. Real stdio MCP child process (pinned unit test)
    mcpChild = spawn(process.execPath, [mcpScript, '--session', service.manifestPath, '--ecosystem', 'antigravity'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, TOPOGEN_MCP_NO_AUTOLAUNCH: '1', TOPOGEN_ANTIGRAVITY_MCP_CONFIG: mcpConfigPath }
    });
    mcpClient = createMcpClient(mcpChild);

    await check('stdio MCP initialize, ping, tools/list, topogen_inspect', async () => {
      const init = await mcpClient.request('initialize', {});
      assert.equal(init.result.protocolVersion, '2024-11-05');
      assert.equal(init.result.serverInfo.name, 'topogen_fdm_foundry');

      const ping = await mcpClient.request('ping', {});
      assert.deepEqual(ping.result, {});

      const listed = await mcpClient.request('tools/list', {});
      assert.equal(listed.result.tools.length, toolDefinitions.length);
      assert.ok(listed.result.tools.some(t => t.name === 'topogen_inspect'));
      assert.ok(listed.result.tools.some(t => t.name === 'topogen_ui_launch'));
      assert.ok(listed.result.tools.some(t => t.name === 'topogen_ui_tabs'));
      assert.ok(listed.result.tools.some(t => t.name === 'topogen_ui_connect'));
      assert.ok(listed.result.tools.some(t => t.name === 'topogen_workspace_edit'));

      const callRes = await mcpClient.request('tools/call', {
        name: 'topogen_inspect',
        arguments: {}
      });
      assert.equal(callRes.result.isError, false);
      const payload = JSON.parse(callRes.result.content[0].text);
      assert.equal(payload.ok, true);
      assert.equal(payload.result.foundry, 'TOPOGEN_FDM_FOUNDRY');
      assert.equal(payload.result.secretToken, undefined);
    });

    // 8. Mode A lock: read-only workspace ok; mutating workspace blocked
    await check('Mode A lock allows read-only workspace & rejects edit/run_command/reseal', async () => {
      const listRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_list',
        arguments: { path: '.' }
      });
      assert.equal(listRes.result.isError, false);
      const listData = JSON.parse(listRes.result.content[0].text);
      assert.ok(listData.result.entries.some(e => e.name === 'hello.txt'));
      assert.ok(!listData.result.entries.some(e => e.name === '.env'));
      assert.ok(!listData.result.entries.some(e => e.name === 'API_KEYS.txt'));

      const readRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_read',
        arguments: { path: 'hello.txt' }
      });
      assert.equal(readRes.result.isError, false);
      const readData = JSON.parse(readRes.result.content[0].text);
      assert.match(readData.result.content, /\[credential redacted\]/);

      const editBlocked = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_edit',
        arguments: { path: path.join(stateDir, 'scratch', 'note.txt'), content: 'blocked' }
      });
      assert.equal(editBlocked.result.isError, true);
      const editBody = JSON.parse(editBlocked.result.content[0].text);
      assert.match(editBody.error, /Mode B/i);

      const cmdBlocked = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_run_command',
        arguments: { command: 'node', args: ['-e', 'console.log(1)'] }
      });
      assert.equal(cmdBlocked.result.isError, true);
      const cmdBody = JSON.parse(cmdBlocked.result.content[0].text);
      assert.match(cmdBody.error, /Mode B/i);

      const resealBlocked = await mcpClient.request('tools/call', {
        name: 'topogen_seal_check',
        arguments: { mode: 'B', reseal: true }
      });
      assert.equal(resealBlocked.result.isError, true);
    });

    // 9. Mode B enabled: confined scratch edit & command ok; traversal, .env, destructive git blocked
    await check('Mode B allows confined scratch edit/cmd & blocks traversal/.env/destructive git', async () => {
      const updated = service.setAllowModeB(true);
      assert.equal(updated.allowModeB, true);

      const scratchFile = path.join(stateDir, 'scratch', 'modeb-test.txt');
      const writeRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_edit',
        arguments: { path: scratchFile, content: 'hello world\n' }
      });
      assert.equal(writeRes.result.isError, false);
      assert.equal(fs.readFileSync(scratchFile, 'utf8'), 'hello world\n');

      const patchRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_edit',
        arguments: { path: scratchFile, target: 'world', replacement: 'topogen' }
      });
      assert.equal(patchRes.result.isError, false);
      assert.equal(fs.readFileSync(scratchFile, 'utf8'), 'hello topogen\n');

      const cmdRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_run_command',
        arguments: { command: 'node', args: ['-e', 'console.log("modeb-ok")'] }
      });
      assert.equal(cmdRes.result.isError, false);
      const cmdPayload = JSON.parse(cmdRes.result.content[0].text);
      assert.equal(cmdPayload.result.exitCode, 0);
      assert.match(cmdPayload.result.stdout, /modeb-ok/);

      const traversalRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_edit',
        arguments: { path: '../escaped.txt', content: 'nope' }
      });
      assert.equal(traversalRes.result.isError, true);
      assert.match(JSON.parse(traversalRes.result.content[0].text).error, /outside allowed workspace/i);

      const envRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_read',
        arguments: { path: '.env' }
      });
      assert.equal(envRes.result.isError, true);
      assert.match(JSON.parse(envRes.result.content[0].text).error, /credential/i);

      const gitPushRes = await mcpClient.request('tools/call', {
        name: 'topogen_workspace_run_command',
        arguments: { command: 'git', args: ['push', 'origin', 'main'] }
      });
      assert.equal(gitPushRes.result.isError, true);
      assert.match(JSON.parse(gitPushRes.result.content[0].text).error, /Destructive git/i);

      const receipts = fs.readFileSync(path.join(stateDir, 'agent-receipts.jsonl'), 'utf8')
        .trim().split(/\r?\n/).map(line => JSON.parse(line));
      assert.ok(receipts.some(r => r.type === 'workspace_operation_audit' && r.allowModeB === false));
      assert.ok(receipts.some(r => r.type === 'workspace_operation_audit' && r.allowModeB === true && r.ok === true));
    });

    // =========================================================================
    // E2E Ephemeral Daemon & Multi-Tab Chaos Suite (isolated temp dirs & ports)
    // =========================================================================
    const ephemeralPort1 = await getFreePort();
    const isolatedEnvBase = {
      ...process.env,
      HOME: daemonHome,
      USERPROFILE: daemonHome,
      LOCALAPPDATA: daemonLocalAppData,
      TOPOGEN_STATE_ROOT: path.join(daemonLocalAppData, 'Topogen', 'Foundry'),
      TOPOGEN_ANTIGRAVITY_MCP_CONFIG: daemonMcpConfigPath,
      TOPOGEN_MOCK_CHROME_CMD: mockChromeScript,
      TOPOGEN_MCP_NO_AUTOLAUNCH: '1',
    };
    delete isolatedEnvBase.ANTIGRAVITY_CONVERSATION_ID;
    delete isolatedEnvBase.ANTIGRAVITY_TRAJECTORY_ID;
    delete isolatedEnvBase.TOPOGEN_CONVERSATION_ID;
    delete isolatedEnvBase.CODEX_THREAD_ID;

    const daemon1 = await startEphemeralDaemon({
      port: ephemeralPort1,
      env: isolatedEnvBase,
      extraArgs: ['--bind-mcp'],
    });
    activeDaemons.push(daemon1);
    const uiBridgeToken = daemon1.health.uiBridgeToken;
    const daemonSessionId1 = daemon1.health.mcp.sessionId;

    // Sessionless stdio MCP client (reads latest-session.json + daemon_mcp_config.json, NO --session flag!)
    const liveMcpChild = spawn(process.execPath, [mcpScript, '--ecosystem', 'antigravity'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: isolatedEnvBase,
    });
    const liveMcp = createMcpClient(liveMcpChild);
    liveMcpClients.push(liveMcp);
    await liveMcp.request('initialize', {});

    // 10. Chrome Launch & Handshake + Ping Reuse + newTab + L6 Unsandboxed MCP Fallback
    await check('E2E Chrome launch & handshake (L2, L6): ?conv=&launch=, 1.5s ping reuse & newTab', async () => {
      const firstLaunch = await liveMcp.callTool('topogen_ui_launch', {
        conversationId: 'conv-1',
        grid: '1x1x1',
        waitMs: 8000,
      });
      assert.equal(firstLaunch.isError, false, `First launch failed: ${JSON.stringify(firstLaunch.body)}`);
      const l1 = firstLaunch.body.result;
      assert.equal(l1.ok, true);
      assert.equal(l1.launched, true);
      assert.equal(l1.reused, false);
      assert.equal(l1.browserKind, 'chrome');
      assert.equal(l1.surface, 'workbench');
      assert.equal(l1.conversationId, 'conv-1');
      assert.ok(l1.clientId.startsWith('wb_mock_'));
      assert.equal(l1.configured?.configured, true);

      const spawnsAfter1 = readSpawnsLog(spawnsFile);
      assert.equal(spawnsAfter1.length, 1);
      assert.equal(spawnsAfter1[0].pathname, '/index_TOPOGEN_PQM_ELASTICA_FDM.html');
      assert.equal(spawnsAfter1[0].conv, 'conv-1');
      assert.ok(spawnsAfter1[0].launch?.startsWith('lnch_'));

      // Subsequent launch on conv-1 MUST reuse the live tab via ping without spawning a 2nd Chrome!
      const reuseLaunch = await liveMcp.callTool('topogen_ui_launch', {
        conversationId: 'conv-1',
      });
      assert.equal(reuseLaunch.isError, false);
      const l2 = reuseLaunch.body.result;
      assert.equal(l2.ok, true);
      assert.equal(l2.launched, false);
      assert.equal(l2.reused, true);
      assert.equal(l2.clientId, l1.clientId);
      assert.equal(readSpawnsLog(spawnsFile).length, 1, 'Reuse must NOT spawn a second Chrome process');

      // newTab: true MUST spawn a second Chrome tab and rebind conv-1 to it
      const forcedNew = await liveMcp.callTool('topogen_ui_launch', {
        conversationId: 'conv-1',
        newTab: true,
        waitMs: 8000,
      });
      assert.equal(forcedNew.isError, false);
      const l3 = forcedNew.body.result;
      assert.equal(l3.ok, true);
      assert.equal(l3.launched, true);
      assert.equal(l3.reused, false);
      assert.notEqual(l3.clientId, l1.clientId);
      assert.equal(readSpawnsLog(spawnsFile).length, 2, 'newTab:true must spawn a second Chrome process');

      // Terminate the two spawned mock-chrome processes first, then disconnect them so subsequent routing tests start with 0 Chrome tabs
      for (const s of readSpawnsLog(spawnsFile)) {
        if (s.pid) {
          try { process.kill(s.pid); } catch {}
        }
      }
      await sleep(80);
      await httpJson(ephemeralPort1, 'POST', '/api/ui-bridge/disconnect', { clientId: l1.clientId, bridgeProof: uiBridgeToken });
      await httpJson(ephemeralPort1, 'POST', '/api/ui-bridge/disconnect', { clientId: l3.clientId, bridgeProof: uiBridgeToken });
      const cleanTabs = await httpJson(ephemeralPort1, 'GET', '/api/ui-bridge/tabs');
      assert.equal(cleanTabs.data.clientCount, 0);
    });

    // 10b. L6 Unsandboxed Desktop MCP fallback when sandboxed daemon returns NO_HANDSHAKE
    await check('E2E L6 unsandboxed MCP Chrome spawn fallback when daemon hits NO_HANDSHAKE', async () => {
      const sandboxedPort = await getFreePort();
      const sandboxedDaemon = await startEphemeralDaemon({
        port: sandboxedPort,
        env: {
          ...isolatedEnvBase,
          LOCALAPPDATA: path.join(tempRoot, 'sandboxed_appdata'),
          TOPOGEN_STATE_ROOT: path.join(tempRoot, 'sandboxed_appdata', 'Topogen', 'Foundry'),
          TOPOGEN_ANTIGRAVITY_MCP_CONFIG: path.join(tempRoot, 'sandboxed_mcp.json'),
          // Simulate sandboxed daemon whose Chrome spawn silently no-ops -> NO_HANDSHAKE!
          TOPOGEN_MOCK_CHROME_CMD: 'noop',
        },
        extraArgs: ['--no-bind-mcp'],
      });
      activeDaemons.push(sandboxedDaemon);

      const fallbackMcpChild = spawn(process.execPath, [mcpScript, '--ecosystem', 'antigravity'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...isolatedEnvBase,
          LOCALAPPDATA: path.join(tempRoot, 'sandboxed_appdata'),
          TOPOGEN_STATE_ROOT: path.join(tempRoot, 'sandboxed_appdata', 'Topogen', 'Foundry'),
          TOPOGEN_ANTIGRAVITY_MCP_CONFIG: path.join(tempRoot, 'sandboxed_mcp.json'),
          // Unsandboxed MCP process HAS working desktop Chrome access!
          TOPOGEN_MOCK_CHROME_CMD: mockChromeScript,
          ANTIGRAVITY_CONVERSATION_ID: 'conv-l6-fallback',
        },
      });
      const fallbackMcp = createMcpClient(fallbackMcpChild);
      liveMcpClients.push(fallbackMcp);
      await fallbackMcp.request('initialize', {});

      const beforeSpawns = readSpawnsLog(spawnsFile).length;
      const res = await fallbackMcp.callTool('topogen_ui_launch', { waitMs: 900 }, 20000);
      assert.equal(res.isError, false, `L6 fallback failed: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.result.ok, true);
      assert.equal(res.body.result.launched, true);
      assert.equal(res.body.result.conversationId, 'conv-l6-fallback');
      assert.equal(readSpawnsLog(spawnsFile).length, beforeSpawns + 1);

      await fallbackMcp.close();
      await sandboxedDaemon.stop();
      for (const s of readSpawnsLog(spawnsFile)) {
        if (s.pid) {
          try { process.kill(s.pid); } catch {}
        }
      }
    });

    // 11. Webview & Headless Anti-Hijack (L3, C3, M2, M3)
    await check('E2E Webview & Headless anti-hijack (L3, C3, M2) + M3 poll URL & header sync', async () => {
      const wv1 = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_webview_1',
        browserKind: 'webview',
        visible: true,
        focused: true,
        lastFocusedAt: Date.now() + 50000,
      });
      const wv2 = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_webview_2',
        browserKind: 'webview',
        visible: true,
        focused: true,
        lastFocusedAt: Date.now() + 60000,
      });
      const hl1 = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_headless_1',
        browserKind: 'headless',
        visible: true,
        focused: true,
        lastFocusedAt: Date.now() + 70000,
      });
      activeSimTabs.push(wv1, wv2, hl1);
      await Promise.all([wv1.ready(), wv2.ready(), hl1.ready()]);

      // When ONLY webview + headless tabs are open, conversationId mutating calls MUST NOT touch webview/headless!
      const noChromeRes = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-only-webview',
        grid: '1x1x1',
        autoLaunchChrome: false,
      });
      assert.equal(noChromeRes.body.result.available, false);
      assert.equal(noChromeRes.body.result.code, 'NO_CHROME_TAB');
      assert.equal(wv1.receivedTasks.length, 0, 'Webview 1 must receive 0 tasks');
      assert.equal(wv2.receivedTasks.length, 0, 'Webview 2 must receive 0 tasks');
      assert.equal(hl1.receivedTasks.length, 0, 'Headless tab must receive 0 tasks');

      // Now connect 1 unfocused Chrome tab alongside the 2 focused webviews + 1 focused headless tab
      const chromeReal = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_chrome_solo',
        browserKind: 'chrome',
        visible: true,
        focused: false,
        lastFocusedAt: 100,
      });
      activeSimTabs.push(chromeReal);
      await chromeReal.ready();

      const claimRes = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-auto',
        grid: '1x1x1',
        autoLaunchChrome: false,
      });
      assert.equal(claimRes.isError, false);
      assert.equal(claimRes.body.result.clientId, 'wb_chrome_solo');
      assert.equal(claimRes.body.result.boundConversationId, 'conv-auto');
      assert.deepEqual(chromeReal.state.grid, { x: 1, y: 1, z: 1 });
      assert.equal(wv1.receivedTasks.length, 0, 'Webview 1 must NEVER be hijacked');
      assert.equal(wv2.receivedTasks.length, 0, 'Webview 2 must NEVER be hijacked');
      assert.equal(hl1.receivedTasks.length, 0, 'Headless tab must NEVER be hijacked');

      // M3: Verify URL & browserKind metadata on /api/ui-bridge/tabs via topogen_ui_tabs
      const tabsRes = await liveMcp.callTool('topogen_ui_tabs', { conversationId: 'conv-auto' });
      assert.equal(tabsRes.isError, false);
      const soloRecord = tabsRes.body.result.clients.find(c => c.clientId === 'wb_chrome_solo');
      assert.ok(soloRecord);
      assert.equal(soloRecord.browserKind, 'chrome');
      assert.equal(soloRecord.boundConversationId, 'conv-auto');
      assert.match(soloRecord.url, /index_TOPOGEN_PQM_ELASTICA_FDM\.html/);

      await Promise.all([wv1.stop(), wv2.stop(), hl1.stop(), chromeReal.stop()]);
    });

    // 12. Multi-Conversation Isolation & Per-Tab Concurrency (M2)
    await check('E2E Multi-conversation isolation & per-tab concurrent busyClients (M2)', async () => {
      const chromeA = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_chrome_A',
        browserKind: 'chrome',
        conv: 'conv-A',
        visible: true,
        focused: true,
      });
      const chromeB = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_chrome_B',
        browserKind: 'chrome',
        conv: 'conv-B',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(chromeA, chromeB);
      await Promise.all([chromeA.ready(), chromeB.ready()]);

      // Fire concurrent mutating run_step calls (each sleeps 260ms inside simulated browser tab)
      const t0 = performance.now();
      const [resA, resB] = await Promise.all([
        liveMcp.callTool('topogen_ui_run_step', {
          conversationId: 'conv-A',
          step: 'elastica',
          params: { delayMs: 260, tag: 'job-A' },
          autoLaunchChrome: false,
        }),
        liveMcp.callTool('topogen_ui_run_step', {
          conversationId: 'conv-B',
          step: 'fdm',
          params: { delayMs: 260, tag: 'job-B' },
          autoLaunchChrome: false,
        }),
      ]);
      const elapsed = performance.now() - t0;

      assert.equal(resA.isError, false);
      assert.equal(resB.isError, false);
      const outA = resA.body.result;
      const outB = resB.body.result;

      // Zero cross-talk
      assert.equal(outA.executedOn, 'wb_chrome_A');
      assert.equal(outA.tag, 'job-A');
      assert.equal(outB.executedOn, 'wb_chrome_B');
      assert.equal(outB.tag, 'job-B');
      assert.equal(chromeA.receivedTasks.length, 1);
      assert.equal(chromeB.receivedTasks.length, 1);

      // True parallel execution: execution intervals overlapped (not serialized by a global lock!)
      assert.ok(
        outB.startedAt < outA.finishedAt && outA.startedAt < outB.finishedAt,
        `Expected overlapping parallel execution across tabs (elapsed=${elapsed.toFixed(0)}ms, A=[${outA.startedAt.toFixed(0)},${outA.finishedAt.toFixed(0)}], B=[${outB.startedAt.toFixed(0)},${outB.finishedAt.toFixed(0)}])`
      );

      // Per-tab busyClients lock: a 2nd concurrent mutation on conv-A rejects while conv-B remains free
      const holdA = liveMcp.callTool('topogen_ui_run_step', {
        conversationId: 'conv-A',
        step: 'pq',
        params: { delayMs: 300, tag: 'hold-A' },
        autoLaunchChrome: false,
      });
      await sleep(70);
      const [dupA, freeB] = await Promise.all([
        liveMcp.callTool('topogen_ui_run_step', {
          conversationId: 'conv-A',
          step: 'fea',
          autoLaunchChrome: false,
        }),
        liveMcp.callTool('topogen_ui_run_step', {
          conversationId: 'conv-B',
          step: 'fea',
          params: { delayMs: 20, tag: 'free-B' },
          autoLaunchChrome: false,
        }),
      ]);
      assert.equal(dupA.isError, true);
      assert.match(dupA.body.error, /already in progress on tab "wb_chrome_A"/i);
      assert.equal(freeB.isError, false);
      assert.equal(freeB.body.result.executedOn, 'wb_chrome_B');
      await holdA;

      await Promise.all([chromeA.stop(), chromeB.stop()]);
    });

    // 13. 2-Tab Disambiguation (AMBIGUOUS_CHROME_TABS) & topogen_ui_connect
    let u2 = null;
    await check('E2E 2-tab disambiguation fails closed (AMBIGUOUS_CHROME_TABS) until topogen_ui_connect pairs one', async () => {
      const u1 = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_unbound_1',
        browserKind: 'chrome',
        visible: true,
        focused: true,
      });
      u2 = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_unbound_2',
        browserKind: 'chrome',
        visible: true,
        focused: false,
      });
      activeSimTabs.push(u1, u2);
      await Promise.all([u1.ready(), u2.ready()]);

      const ambigRes = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-new',
        grid: '2x2x2',
        autoLaunchChrome: false,
      });
      assert.equal(ambigRes.isError, true);
      assert.match(ambigRes.body.error, /Ambiguous target tab.*2 unpaired Google Chrome/i);
      assert.match(ambigRes.body.error, /wb_unbound_1/);
      assert.match(ambigRes.body.error, /wb_unbound_2/);
      assert.equal(u1.receivedTasks.length, 0);
      assert.equal(u2.receivedTasks.length, 0);

      // Pair conv-new explicitly to wb_unbound_2
      const connectRes = await liveMcp.callTool('topogen_ui_connect', {
        conversationId: 'conv-new',
        clientId: 'wb_unbound_2',
      });
      assert.equal(connectRes.isError, false);
      assert.equal(connectRes.body.result.claimed, true);
      assert.equal(connectRes.body.result.clientId, 'wb_unbound_2');

      const afterConnect = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-new',
        grid: '2x2x2',
        autoLaunchChrome: false,
      });
      assert.equal(afterConnect.isError, false);
      assert.equal(afterConnect.body.result.clientId, 'wb_unbound_2');
      assert.deepEqual(u2.state.grid, { x: 2, y: 2, z: 2 });
      assert.equal(u1.receivedTasks.length, 0, 'Unpaired Chrome tab 1 must remain untouched');

      await u1.stop();
    });

    // 14. F5 Reload vs Duplicate Tab & 0ms Beacon Disconnect + C2 gridResolution + Stale Bridge v1 Reload (C5, C6)
    await check('E2E F5 reload vs duplicate tab, 0ms Beacon disconnect, C2 gridResolution & C5 v1->v2 __reload__', async () => {
      // Focus u2 so preferredClientId === 'wb_unbound_2'
      await httpJson(
        ephemeralPort1,
        'POST',
        '/api/ui-bridge/focus',
        { clientId: 'wb_unbound_2', surface: 'workbench', browserKind: 'chrome', bridgeVersion: 2, visible: true, focused: true, lastFocusedAt: Date.now() },
        { 'x-ui-bridge-token': uiBridgeToken, 'User-Agent': UA_BY_KIND.chrome }
      );
      const tabsBeforeDup = await httpJson(ephemeralPort1, 'GET', '/api/ui-bridge/tabs');
      assert.equal(tabsBeforeDup.data.preferredClientId, 'wb_unbound_2');

      // Simulate Chrome "Duplicate Tab" opening with ?conv=conv-new while wb_unbound_2 is STILL LIVE
      const dupTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_dup_tab',
        browserKind: 'chrome',
        conv: 'conv-new',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(dupTab);
      await dupTab.ready();

      const tabsWithDup = await httpJson(ephemeralPort1, 'GET', '/api/ui-bridge/tabs');
      const dupInfo = tabsWithDup.data.clients.find(c => c.clientId === 'wb_dup_tab');
      assert.equal(dupInfo.boundConversationId, null, 'Duplicate tab must NOT hijack live conv-new binding');
      const cfgWhileDup = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-new',
        grid: '4x4x4',
        autoLaunchChrome: false,
      });
      assert.equal(cfgWhileDup.body.result.clientId, 'wb_unbound_2');
      assert.equal(dupTab.receivedTasks.length, 0);
      await dupTab.stop();

      // C6: 0ms Beacon Disconnect with bridgeProof (no x-ui-bridge-token header)
      const discRes = await u2.sendBeaconDisconnect();
      assert.equal(discRes.ok, true);
      assert.equal(discRes.data.disconnected, true);

      const tabsAfterDisc = await httpJson(ephemeralPort1, 'GET', '/api/ui-bridge/tabs');
      assert.equal(tabsAfterDisc.data.preferredClientId, null, 'preferredClientId must clear in 0ms on disconnect');
      assert.ok(!tabsAfterDisc.data.clients.some(c => c.clientId === 'wb_unbound_2'), 'Disconnected tab must be evicted immediately');
      const staleBinding = tabsAfterDisc.data.bindings.find(b => b.conversationId === 'conv-new');
      assert.equal(staleBinding?.live, false);

      // F5 Reload #1: reconnecting with ?conv=conv-new under SAME clientId seamlessly rebinds
      const reloadedSameId = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_unbound_2',
        browserKind: 'chrome',
        conv: 'conv-new',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(reloadedSameId);
      await reloadedSameId.ready();
      const inspectSame = await liveMcp.callTool('topogen_ui_inspect', { conversationId: 'conv-new' });
      assert.equal(inspectSame.isError, false);
      assert.equal(inspectSame.body.result.clientId, 'wb_unbound_2');
      assert.equal(inspectSame.body.result.boundConversationId, 'conv-new');
      await reloadedSameId.sendBeaconDisconnect();

      // F5 Reload #2: reconnecting with ?conv=conv-new under NEW clientId also seamlessly rebinds
      const reloadedNewId = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_reloaded_v2',
        browserKind: 'chrome',
        conv: 'conv-new',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(reloadedNewId);
      await reloadedNewId.ready();
      const inspectNewId = await liveMcp.callTool('topogen_ui_inspect', { conversationId: 'conv-new' });
      assert.equal(inspectNewId.isError, false);
      assert.equal(inspectNewId.body.result.clientId, 'wb_reloaded_v2');
      assert.equal(inspectNewId.body.result.boundConversationId, 'conv-new');

      // C2: Test all 3 gridResolution formats against live daemon + simulated Chrome tab
      for (const spec of ['1x1x1', [2, 3, 4], { x: 1, y: 2, z: 3 }]) {
        const gRes = await liveMcp.callTool('topogen_ui_configure', {
          conversationId: 'conv-new',
          gridResolution: spec,
          autoLaunchChrome: false,
        });
        assert.equal(gRes.isError, false);
        assert.ok(gRes.body.result.applied.includes('gridResolution'));
      }
      assert.deepEqual(reloadedNewId.state.grid, { x: 1, y: 2, z: 3 });
      await reloadedNewId.stop();

      // C5: Stale bridgeVersion: 1 client receives __reload__ signal and returns structured staleBridge notice
      const staleTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_stale_v1',
        browserKind: 'chrome',
        bridgeVersion: 1,
        conv: 'conv-stale',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(staleTab);
      await staleTab.ready();

      const staleRes = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-stale',
        grid: '1x1x1',
        autoLaunchChrome: false,
      });
      assert.equal(staleTab.receivedTasks[0]?.action, '__reload__', 'Stale v1 tab must receive __reload__');
      assert.equal(staleRes.body.result.staleBridge, true);
      assert.equal(staleRes.body.result.requiredBridgeVersion, 2);
      await staleTab.stop();

      // C5b: Upgrading tab that replies { reloading: true } and reconnects with bridgeVersion: 2 after ~50ms
      // transparently completes the caller's request without returning staleBridge error!
      let upgradingTab = null;
      upgradingTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_upgrading_tab',
        browserKind: 'chrome',
        bridgeVersion: 1,
        conv: 'conv-upgrade',
        visible: true,
        focused: true,
        onTask: async (task, defaultHandler) => {
          if (task.action === '__reload__') {
            setTimeout(async () => {
              await upgradingTab.sendBeaconDisconnect();
              const upgradedV2 = createSimulatedBrowserTab({
                port: ephemeralPort1,
                uiBridgeToken,
                clientId: 'wb_upgrading_tab',
                browserKind: 'chrome',
                bridgeVersion: 2,
                conv: 'conv-upgrade',
                visible: true,
                focused: true,
              });
              activeSimTabs.push(upgradedV2);
            }, 50);
            return { response: { reloading: true } };
          }
          return defaultHandler(task);
        },
      });
      activeSimTabs.push(upgradingTab);
      await upgradingTab.ready();

      const upgradedRes = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-upgrade',
        grid: '2x2x3',
        autoLaunchChrome: false,
      });
      assert.equal(upgradedRes.isError, false, `Expected C5 auto-upgrade to succeed: ${JSON.stringify(upgradedRes.body)}`);
      assert.equal(upgradedRes.body.result.configured, true);
      assert.deepEqual(upgradedRes.body.result.state.gridResolution, { x: 2, y: 2, z: 3 });
      await httpJson(ephemeralPort1, 'POST', '/api/ui-bridge/disconnect', { clientId: 'wb_upgrading_tab', bridgeProof: uiBridgeToken });
    });

    // 15. Companion Workbench <-> Launcher Co-Binding, Instant Mode notifySync & 204 Favicon
    await check('E2E Companion workbench+launcher co-binding, <100ms mode notifySync & 204 /favicon.ico', async () => {
      const fav = await httpJson(ephemeralPort1, 'GET', '/favicon.ico');
      assert.equal(fav.status, 204);

      const wbCompanion = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_comp_1',
        surface: 'workbench',
        browserKind: 'chrome',
        conv: 'conv-comp',
        visible: true,
        focused: true,
      });
      const lnCompanion = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'ln_comp_1',
        surface: 'launcher',
        browserKind: 'chrome',
        conv: 'conv-comp',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(wbCompanion, lnCompanion);
      await Promise.all([wbCompanion.ready(), lnCompanion.ready()]);

      const tabsComp = await httpJson(ephemeralPort1, 'GET', '/api/ui-bridge/tabs?conv=conv-comp');
      const wbRec = tabsComp.data.clients.find(c => c.clientId === 'wb_comp_1');
      const lnRec = tabsComp.data.clients.find(c => c.clientId === 'ln_comp_1');
      assert.equal(wbRec?.boundConversationId, 'conv-comp', 'Workbench companion must retain conv-comp');
      assert.equal(lnRec?.boundConversationId, 'conv-comp', 'Launcher companion must co-bind conv-comp without erasing ?conv=');

      // Instant notifySync wake-up when flipping POST /api/mode -> wakes parked long-poll in <150ms!
      const prevHeaderCount = wbCompanion.syncHeadersLog.length;
      const tFlip = performance.now();
      await httpJson(ephemeralPort1, 'POST', '/api/mode', { allowModeB: true, executionMode: 'B' });
      const wakeDeadline = Date.now() + 500;
      while (Date.now() < wakeDeadline && !wbCompanion.syncHeadersLog.slice(prevHeaderCount).some(h => h.mode === 'B')) {
        await sleep(10);
      }
      const wakeMs = performance.now() - tFlip;
      assert.ok(
        wbCompanion.syncHeadersLog.slice(prevHeaderCount).some(h => h.mode === 'B'),
        `Expected parked poll waiter to wake with x-execution-mode: B immediately (wakeMs=${wakeMs.toFixed(0)})`
      );
      await httpJson(ephemeralPort1, 'POST', '/api/mode', { allowModeB: false, executionMode: 'A' });

      await Promise.all([wbCompanion.stop(), lnCompanion.stop()]);
    });

    // 16. Large >150KB Export Staging via stagedPath while keeping broker.mjs IPC frame <256KB (#21/#22/#23/#24)
    await check('E2E Large >150KB UI export stages full untruncated payload to stagedPath under 256KB broker cap', async () => {
      const pathRows = Array.from(
        { length: 7500 },
        (_, idx) => `<path id="rod_${idx}" d="M ${idx} 10.125 C ${idx + 5} 40.500, ${idx + 15} 80.750, ${idx + 25} 120.000"/>`
      ).join('\n');
      const fullLargeSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">\n${pathRows}\n</svg>`;
      const fullByteLen = Buffer.byteLength(fullLargeSvg, 'utf8');
      assert.ok(fullByteLen > 450 * 1024, `Expected test SVG >450KB, got ${fullByteLen}`);

      const largeExportTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_large_export',
        browserKind: 'chrome',
        conv: 'conv-large-export',
        visible: true,
        focused: true,
        onTask: async (task, defaultHandler) => {
          if (task.action === 'export') {
            return {
              response: {
                format: 'elastica_svg',
                filename: 'elastica_rods_unrolled.svg',
                bytes: fullByteLen,
                truncated: false,
                data: fullLargeSvg,
              },
            };
          }
          return defaultHandler(task);
        },
      });
      activeSimTabs.push(largeExportTab);
      await largeExportTab.ready();

      const expRes = await liveMcp.callTool('topogen_ui_export', {
        conversationId: 'conv-large-export',
        format: 'elastica_svg',
        autoLaunchChrome: false,
      });
      assert.equal(expRes.isError, false, `Large export failed over broker: ${JSON.stringify(expRes.body)}`);

      const brokerWireBytes = Buffer.byteLength(JSON.stringify(expRes.body), 'utf8');
      assert.ok(brokerWireBytes < 256 * 1024, `Expected broker response <256KB, got ${brokerWireBytes}`);

      const r = expRes.body.result;
      assert.equal(r.truncated, true, 'Expected inline data marked truncated when staged');
      assert.equal(r.bytes, fullByteLen, 'Expected full byte count preserved');
      assert.ok(typeof r.stagedPath === 'string' && fs.existsSync(r.stagedPath), 'Expected stagedPath file on disk');
      assert.ok(Buffer.byteLength(r.data, 'utf8') <= 145 * 1024, 'Expected inline preview data <=145KB');

      const stagedContent = fs.readFileSync(r.stagedPath, 'utf8');
      assert.equal(stagedContent.length, fullLargeSvg.length);
      assert.equal(stagedContent, fullLargeSvg, 'Staged file must match 100% untruncated SVG byte-for-byte');
      assert.ok(stagedContent.trim().endsWith('</svg>'), 'Staged SVG must end with intact closing </svg>');

      await largeExportTab.stop();
    });

    // 17. BATCH-TOPOGEN-04 Item 1: Cache-Control: no-store headers, topogen_ui_reload & step: "reload" with preserveState + readiness wait
    await check('B04-Item1: Cache-Control no-store static headers, topogen_ui_reload & step: "reload" readiness wait', async () => {
      for (const staticPath of ['/index_TOPOGEN_PQM_ELASTICA_FDM.html', '/ui/bridge/mcp_ui_bridge.js', '/ui/styles/workbench.css']) {
        const res = await httpJson(ephemeralPort1, 'GET', staticPath);
        assert.equal(res.status, 200, `Expected 200 for ${staticPath}`);
        assert.match(String(res.headers['cache-control'] || ''), /no-store/i, `Expected Cache-Control no-store on ${staticPath}`);
        assert.match(String(res.headers['cache-control'] || ''), /must-revalidate/i, `Expected must-revalidate on ${staticPath}`);
        assert.equal(String(res.headers['pragma'] || '').toLowerCase(), 'no-cache');
        assert.equal(String(res.headers['expires'] || ''), '0');
      }

      const persisted = { grid: { x: 2, y: 3, z: 2 }, preset: 'custom_preserved' };
      let reloadTab = null;
      reloadTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_hot_reload',
        browserKind: 'chrome',
        conv: 'conv-reload',
        visible: true,
        focused: true,
        onTask: async (task, defaultHandler) => {
          if (task.action === 'reload') {
            const snap = task.payload?.preserveState !== false ? { ...persisted } : { grid: { x: 3, y: 3, z: 4 }, preset: 'pilot_champion' };
            setTimeout(async () => {
              await reloadTab.sendBeaconDisconnect();
              const reborn = createSimulatedBrowserTab({
                port: ephemeralPort1,
                uiBridgeToken,
                clientId: 'wb_hot_reload',
                browserKind: 'chrome',
                bridgeVersion: 2,
                conv: 'conv-reload',
                visible: true,
                focused: true,
              });
              reborn.state.grid = snap.grid;
              reborn.state.preset = snap.preset;
              reloadTab = reborn;
              activeSimTabs.push(reborn);
            }, 40);
            return { response: { ok: true, reloading: true, preserveState: task.payload?.preserveState !== false } };
          }
          return defaultHandler(task);
        },
      });
      reloadTab.state.grid = { ...persisted.grid };
      reloadTab.state.preset = persisted.preset;
      activeSimTabs.push(reloadTab);
      await reloadTab.ready();

      const r1 = await liveMcp.callTool('topogen_ui_reload', {
        conversationId: 'conv-reload',
        preserveState: true,
        hardReload: true,
        waitMs: 5000,
      });
      assert.equal(r1.isError, false, `topogen_ui_reload failed: ${JSON.stringify(r1.body)}`);
      assert.equal(r1.body.result.ok, true);
      assert.equal(r1.body.result.reloaded, true);

      // Immediate post-reload inspect must succeed with preserved state (0 race condition)
      const inspAfter = await liveMcp.callTool('topogen_ui_inspect', { conversationId: 'conv-reload' });
      assert.equal(inspAfter.isError, false);
      assert.deepEqual(inspAfter.body.result.gridResolution, persisted.grid);
      assert.equal(inspAfter.body.result.preset, persisted.preset);

      // step: "reload" via topogen_ui_run_step must also work cleanly
      const r2 = await liveMcp.callTool('topogen_ui_run_step', {
        conversationId: 'conv-reload',
        step: 'reload',
        params: { preserveState: true, waitMs: 5000 },
        autoLaunchChrome: false,
      });
      assert.equal(r2.isError, false, `step reload failed: ${JSON.stringify(r2.body)}`);
      assert.equal(r2.body.result.ok, true);
      assert.equal(r2.body.result.reloaded, true);

      await httpJson(ephemeralPort1, 'POST', '/api/ui-bridge/disconnect', { clientId: 'wb_hot_reload', bridgeProof: uiBridgeToken });
    });

    // 18. BATCH-TOPOGEN-04 Item 2: initialize.serverInfo & agent-session.json digests + surfaceDrift detection
    await check('B04-Item2: initialize.serverInfo & agent-session.json digests, synced surfaceDrift: null & stale mcp/daemon detection', async () => {
      // Verify agent-session.json written by service.mjs contains foundryVersion, codeSurfaceSha256, toolsSha256
      assert.ok(typeof manifest.foundryVersion === 'string' && manifest.foundryVersion.length > 0);
      assert.equal(manifest.toolsSha256, TOOLS_SHA256);
      assert.ok(typeof manifest.codeSurfaceSha256 === 'string' && manifest.codeSurfaceSha256.length >= 16);

      // Verify initialize.serverInfo carries the same digests
      const initInfo = await mcpClient.request('initialize', {});
      assert.equal(initInfo.result.serverInfo.name, 'topogen_fdm_foundry');
      assert.equal(initInfo.result.serverInfo.foundryVersion, manifest.foundryVersion);
      assert.equal(initInfo.result.serverInfo.codeSurfaceSha256, manifest.codeSurfaceSha256);
      assert.equal(initInfo.result.serverInfo.toolsSha256, TOOLS_SHA256);

      // Synced topogen_inspect on mock service -> surfaceDrift === null
      const syncedInspect = await mcpClient.callTool('topogen_inspect', {});
      assert.equal(syncedInspect.isError, false);
      assert.equal(syncedInspect.body.surfaceDrift, null);
      assert.equal(syncedInspect.body.result.surfaceDrift, null);

      // Simulated stale mcp.mjs (toolsSha256 differs from daemon) -> emits surfaceDrift with Antigravity refresh remediation
      const staleMcpChild = spawn(process.execPath, [mcpScript, '--session', service.manifestPath, '--ecosystem', 'antigravity'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TOPOGEN_MCP_NO_AUTOLAUNCH: '1',
          TOPOGEN_MCP_TOOLS_SHA256_OVERRIDE: 'deadbeef'.repeat(8),
        },
      });
      const staleMcp = createMcpClient(staleMcpChild);
      liveMcpClients.push(staleMcp);
      const staleInit = await staleMcp.request('initialize', {});
      assert.equal(staleInit.result.serverInfo.toolsSha256, 'deadbeef'.repeat(8));

      const driftedInspect = await staleMcp.callTool('topogen_inspect', {});
      assert.equal(driftedInspect.isError, false);
      assert.equal(driftedInspect.body.surfaceDrift?.detected, true);
      assert.match(driftedInspect.body.surfaceDrift.remediation, /Refresh topogen_fdm_foundry in Antigravity MCP settings/i);
      assert.equal(driftedInspect.body.result.surfaceDrift?.detected, true);

      // Non-inspect tools/call also carries surfaceDrift when drifted
      const driftedList = await staleMcp.callTool('topogen_workspace_list', { path: '.' });
      assert.equal(driftedList.isError, false);
      assert.equal(driftedList.body.surfaceDrift?.detected, true);
      await staleMcp.close();

      // Simulated resealed on-disk foundry_manifest.json vs older daemon -> emits "Restart foundry_server.mjs"
      const fakeManifestRoot = path.join(tempRoot, 'fake-manifest-root');
      fs.mkdirSync(fakeManifestRoot, { recursive: true });
      fs.writeFileSync(
        path.join(fakeManifestRoot, 'foundry_manifest.json'),
        JSON.stringify({
          semanticVersion: manifest.foundryVersion,
          seals: {
            codeSurfaceSha256: 'cafebabe'.repeat(8),
            verifierSurfaceSha256: '12345678'.repeat(8),
            codeFileCount: 56,
            verifierFileCount: 8,
            sealedAtUtc: new Date().toISOString(),
          },
        }, null, 2),
        'utf8'
      );
      const resealedMcpChild = spawn(process.execPath, [mcpScript, '--session', service.manifestPath, '--ecosystem', 'antigravity'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          TOPOGEN_MCP_NO_AUTOLAUNCH: '1',
          TOPOGEN_MCP_MANIFEST_ROOT: fakeManifestRoot,
        },
      });
      const resealedMcp = createMcpClient(resealedMcpChild);
      liveMcpClients.push(resealedMcp);
      await resealedMcp.request('initialize', {});
      const daemonLagInspect = await resealedMcp.callTool('topogen_inspect', {});
      assert.equal(daemonLagInspect.isError, false);
      assert.equal(daemonLagInspect.body.surfaceDrift?.detected, true);
      assert.ok(
        daemonLagInspect.body.surfaceDrift.remediations.some(r => /Restart foundry_server\.mjs/i.test(r)),
        `Expected Restart foundry_server.mjs remediation, got ${JSON.stringify(daemonLagInspect.body.surfaceDrift)}`
      );
      await resealedMcp.close();
    });

    // 19. BATCH-TOPOGEN-04 Item 3: Pre-queue corrupt file rejection (0 queue pollution), renderer-throw lock cleanup & replace/discardPending
    await check('B04-Item3: Synchronous pre-queue corrupt .3dm/.obj/.json/0-byte/NUL/symlink rejection, renderer-throw recovery & replace/discardPending', async () => {
      const advDir = path.join(tempRoot, 'adversarial_files');
      fs.mkdirSync(advDir, { recursive: true });
      const bad3dm = path.join(advDir, 'corrupt.3dm');
      const trunc3dm = path.join(advDir, 'truncated.3dm');
      const badObj = path.join(advDir, 'empty_geo.obj');
      const nulObj = path.join(advDir, 'nul_byte.obj');
      const zeroObj = path.join(advDir, 'zero.obj');
      const badJson = path.join(advDir, 'bad.json');
      const schemaBadJson = path.join(advDir, 'wrong_keys.json');
      const goodObj = path.join(advDir, 'good_tile.obj');

      fs.writeFileSync(bad3dm, Buffer.from('NOT_A_3DM_HEADER_BYTES_1234567890'));
      fs.writeFileSync(trunc3dm, Buffer.from('3D Geometry File Format 7'));
      fs.writeFileSync(badObj, '# comment only, no vertices or faces\n', 'utf8');
      fs.writeFileSync(nulObj, Buffer.from('v 0 0 0\0\nf 1 1 1\n'));
      fs.writeFileSync(zeroObj, Buffer.alloc(0));
      fs.writeFileSync(badJson, '{not valid json', 'utf8');
      fs.writeFileSync(schemaBadJson, JSON.stringify({ unrelated: 123 }), 'utf8');
      fs.writeFileSync(goodObj, 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n', 'utf8');

      let throwOnce = true;
      let hangOnce = false;
      const advTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_adv_load',
        browserKind: 'chrome',
        conv: 'conv-adv-load',
        visible: true,
        focused: true,
        onTask: async (task, defaultHandler) => {
          if (task.action === 'load_file' && throwOnce) {
            throwOnce = false;
            return { error: 'Simulated renderer throw during mesh parse' };
          }
          if (task.action === 'load_file' && hangOnce) {
            hangOnce = false;
            return { skipReply: true }; // Simulate stalled pending load
          }
          return defaultHandler(task);
        },
      });
      activeSimTabs.push(advTab);
      await advTab.ready();

      for (const badPath of [bad3dm, trunc3dm, badObj, nulObj, zeroObj, badJson, schemaBadJson]) {
        const res = await liveMcp.callTool('topogen_ui_load_file', {
          conversationId: 'conv-adv-load',
          target: 'tile',
          filePath: badPath,
          autoLaunchChrome: false,
        });
        const body = res.body?.result || res.body || {};
        assert.ok(res.isError || body.ok === false, `Expected failure for ${path.basename(badPath)}: ${JSON.stringify(res.body)}`);
        if (!res.isError) {
          assert.equal(body.code, 'INVALID_GEOMETRY_FILE', `Expected INVALID_GEOMETRY_FILE for ${path.basename(badPath)}`);
          assert.ok(typeof body.reason === 'string' && body.reason.length > 0);
          assert.ok(typeof body.headerHex === 'string');
        }
      }

      // Symlink rejection check (if OS permits creating symlinks in temp)
      const linkPath = path.join(advDir, 'link_tile.obj');
      let symlinkCreated = false;
      try {
        fs.symlinkSync(goodObj, linkPath);
        symlinkCreated = true;
      } catch {}
      if (symlinkCreated) {
        const symRes = await liveMcp.callTool('topogen_ui_load_file', {
          conversationId: 'conv-adv-load',
          target: 'tile',
          filePath: linkPath,
          autoLaunchChrome: false,
        });
        const symBody = symRes.body?.result || symRes.body || {};
        assert.ok(symRes.isError || symBody.ok === false, 'Expected symlink rejection');
      }

      // 0 queue pollution across all adversarial rejections!
      assert.equal(advTab.receivedTasks.length, 0, `Expected 0 browser tasks queued for corrupt files, got ${advTab.receivedTasks.length}`);

      // Simulated renderer throw releases busyClients/pending lock immediately
      const thrownRes = await liveMcp.callTool('topogen_ui_load_file', {
        conversationId: 'conv-adv-load',
        target: 'tile',
        filePath: goodObj,
        autoLaunchChrome: false,
      });
      assert.equal(thrownRes.isError, true);
      assert.match(thrownRes.body.error, /Simulated renderer throw/i);

      // Immediate recovery on the very next valid load_file
      const recoveredRes = await liveMcp.callTool('topogen_ui_load_file', {
        conversationId: 'conv-adv-load',
        target: 'tile',
        filePath: goodObj,
        autoLaunchChrome: false,
      });
      assert.equal(recoveredRes.isError, false, `Expected immediate recovery after renderer throw: ${JSON.stringify(recoveredRes.body)}`);
      assert.equal(recoveredRes.body.result.loaded, true);

      // Superseding stalled load_file via replace: true & discardPending: true
      hangOnce = true;
      const hungPromise = liveMcp.callTool('topogen_ui_load_file', {
        conversationId: 'conv-adv-load',
        target: 'tile',
        filePath: goodObj,
        autoLaunchChrome: false,
      });
      await sleep(80);
      const supersededRes = await liveMcp.callTool('topogen_ui_load_file', {
        conversationId: 'conv-adv-load',
        target: 'tile',
        filePath: goodObj,
        replace: true,
        discardPending: true,
        autoLaunchChrome: false,
      });
      assert.equal(supersededRes.isError, false, `Expected replace+discardPending recovery: ${JSON.stringify(supersededRes.body)}`);
      assert.equal(supersededRes.body.result.loaded, true);
      const hungOutcome = await hungPromise;
      assert.equal(hungOutcome.isError, true, 'Superseded pending load_file must settle cleanly as cancelled/error');

      await advTab.stop();
    });

    // 20. BATCH-TOPOGEN-04 Item 4: 8-query parallel search (skipping runs/), 12-file read_batch & atomic multi-file edit rollback + air-gap
    await check('B04-Item4: 8-query parallel search (runs/ skip), 12-file read_batch & atomic 4-file edit rollback + air-gap', async () => {
      // Seed runs/ noise + 8 token files + 12 batch files inside projectDir (Mode B already enabled on service)
      fs.mkdirSync(path.join(projectDir, 'runs', 'noisy_run'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'runs', 'noisy_run', 'artifact.json'), 'B04_Q1_MARKER B04_RUNS_ONLY_MARKER\n', 'utf8');

      const qTokens = [];
      for (let i = 1; i <= 8; i++) {
        const tok = `B04_Q${i}_MARKER`;
        qTokens.push(tok);
        fs.writeFileSync(path.join(projectDir, `search_file_${i}.txt`), `header\n${tok}=value_${i}\n`, 'utf8');
      }

      const batchSpecs = [];
      for (let i = 1; i <= 12; i++) {
        const rel = `batch_read_${i}.txt`;
        fs.writeFileSync(
          path.join(projectDir, rel),
          `batch_line_1_${i}\nGEMINI_API_KEY=AIzaSyFakeBatchSecretKey1234567890${i}\nbatch_line_3_${i}\n`,
          'utf8'
        );
        batchSpecs.push({ path: rel, startLine: 1, endLine: 3 });
      }

      // 8-query parallel search
      const searchRes = await mcpClient.callTool('topogen_workspace_search', {
        queries: qTokens,
        path: '.',
      });
      assert.equal(searchRes.isError, false, `8-query search failed: ${JSON.stringify(searchRes.body)}`);
      const sr = searchRes.body.result;
      assert.equal(sr.queries.length, 8);
      assert.ok(sr.skippedDirs >= 1, 'Expected runs/ directory skipped');
      for (const tok of qTokens) {
        assert.ok(sr.matchesByQuery[tok]?.length >= 1, `Expected match for ${tok}`);
      }
      assert.ok(
        sr.matches.every(m => !m.file.startsWith('runs/')),
        `Expected 0 matches from runs/, got ${JSON.stringify(sr.matches.filter(m => m.file.startsWith('runs/')))}`
      );

      // 12-file read_batch
      const rbRes = await mcpClient.callTool('topogen_workspace_read_batch', { files: batchSpecs });
      assert.equal(rbRes.isError, false, `12-file read_batch failed: ${JSON.stringify(rbRes.body)}`);
      const rb = rbRes.body.result;
      assert.equal(rb.ok, true);
      assert.equal(rb.count, 12);
      assert.equal(rb.files.length, 12);
      for (const f of rb.files) {
        assert.match(f.content, /\[credential redacted\]/, `Expected secret redaction in ${f.path}`);
      }

      // Atomic all-or-nothing rollback when edit #4 of 4 fails target match
      const atomicFiles = [1, 2, 3, 4].map(i => path.join(projectDir, `atomic_${i}.txt`));
      for (let i = 0; i < 4; i++) {
        fs.writeFileSync(atomicFiles[i], `ORIGINAL_${i + 1}\n`, 'utf8');
      }
      const failTargetRes = await mcpClient.callTool('topogen_workspace_edit', {
        edits: [
          { path: 'atomic_1.txt', target: 'ORIGINAL_1', replacement: 'MODIFIED_1' },
          { path: 'atomic_2.txt', target: 'ORIGINAL_2', replacement: 'MODIFIED_2' },
          { path: 'atomic_3.txt', target: 'ORIGINAL_3', replacement: 'MODIFIED_3' },
          { path: 'atomic_4.txt', target: 'NONEXISTENT_TARGET', replacement: 'MODIFIED_4' },
        ],
      });
      assert.equal(failTargetRes.isError, true, 'Expected 4-file edit to fail when edit #4 target is missing');
      for (let i = 0; i < 4; i++) {
        assert.equal(fs.readFileSync(atomicFiles[i], 'utf8'), `ORIGINAL_${i + 1}\n`, `File atomic_${i + 1}.txt must remain untouched after rollback`);
      }

      // Atomic all-or-nothing rollback when edit #4 introduces a Generator->Verifier air-gap cross-import
      fs.mkdirSync(path.join(projectDir, 'core'), { recursive: true });
      fs.writeFileSync(path.join(projectDir, 'core', 'gen_sample.mjs'), 'export const x = 1;\n', 'utf8');
      const failAirgapRes = await mcpClient.callTool('topogen_workspace_edit', {
        edits: [
          { path: 'atomic_1.txt', target: 'ORIGINAL_1', replacement: 'MODIFIED_1' },
          { path: 'atomic_2.txt', target: 'ORIGINAL_2', replacement: 'MODIFIED_2' },
          { path: 'atomic_3.txt', target: 'ORIGINAL_3', replacement: 'MODIFIED_3' },
          { path: 'core/gen_sample.mjs', content: "import { solve } from '../verifier/fea_solver.mjs';\nexport const x = solve;\n" },
        ],
      });
      assert.equal(failAirgapRes.isError, true, 'Expected air-gap violation rejection');
      assert.match(failAirgapRes.body.error, /AIR-GAP VIOLATION/i);
      for (let i = 0; i < 3; i++) {
        assert.equal(fs.readFileSync(atomicFiles[i], 'utf8'), `ORIGINAL_${i + 1}\n`, `File atomic_${i + 1}.txt must remain untouched after air-gap rollback`);
      }
      assert.equal(fs.readFileSync(path.join(projectDir, 'core', 'gen_sample.mjs'), 'utf8'), 'export const x = 1;\n');

      // Valid 3-file atomic edit succeeds and updates all 3 files
      const okBatchEdit = await mcpClient.callTool('topogen_workspace_edit', {
        edits: [
          { path: 'atomic_1.txt', target: 'ORIGINAL_1', replacement: 'COMMITTED_1' },
          { path: 'atomic_2.txt', target: 'ORIGINAL_2', replacement: 'COMMITTED_2' },
          { path: 'atomic_3.txt', target: 'ORIGINAL_3', replacement: 'COMMITTED_3' },
        ],
      });
      assert.equal(okBatchEdit.isError, false, `Valid 3-file edit failed: ${JSON.stringify(okBatchEdit.body)}`);
      assert.equal(fs.readFileSync(atomicFiles[0], 'utf8'), 'COMMITTED_1\n');
      assert.equal(fs.readFileSync(atomicFiles[1], 'utf8'), 'COMMITTED_2\n');
      assert.equal(fs.readFileSync(atomicFiles[2], 'utf8'), 'COMMITTED_3\n');
    });

    // 21. BATCH-TOPOGEN-04 Item 5: voxelPins / clearVoxelPins & fea.animate / step: "fea_animate"
    await check('B04-Item5: voxelPins/clearVoxelPins & fea.animate/step: "fea_animate" across MCP bridge', async () => {
      const pinTab = createSimulatedBrowserTab({
        port: ephemeralPort1,
        uiBridgeToken,
        clientId: 'wb_item5_pins',
        browserKind: 'chrome',
        conv: 'conv-item5',
        visible: true,
        focused: true,
      });
      activeSimTabs.push(pinTab);
      await pinTab.ready();

      const cfgPins = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-item5',
        voxelPins: [
          { x: 1, y: 1, z: 0, tile: 'null' },
          { x: 0, y: 0, z: 0, tile: 2 },
        ],
        fea: { animate: true, deflectionScale: 12.5, loadCase: 'self_weight' },
        autoLaunchChrome: false,
      });
      assert.equal(cfgPins.isError, false, `Item 5 configure failed: ${JSON.stringify(cfgPins.body)}`);
      assert.ok(cfgPins.body.result.applied.includes('voxelPins'));
      assert.ok(cfgPins.body.result.applied.includes('fea'));
      assert.equal(pinTab.state.voxelPins.length, 2);
      assert.equal(pinTab.state.fea.animating, true);
      assert.equal(pinTab.state.fea.deflectionScale, 12.5);

      const stopFea = await liveMcp.callTool('topogen_ui_run_step', {
        conversationId: 'conv-item5',
        step: 'fea_animate',
        mode: 'stop',
        autoLaunchChrome: false,
      });
      assert.equal(stopFea.isError, false);
      assert.equal(stopFea.body.result.fea.animating, false);

      const toggleFea = await liveMcp.callTool('topogen_ui_run_step', {
        conversationId: 'conv-item5',
        step: 'fea_animate',
        mode: 'toggle',
        autoLaunchChrome: false,
      });
      assert.equal(toggleFea.isError, false);
      assert.equal(toggleFea.body.result.fea.animating, true);

      const clearPins = await liveMcp.callTool('topogen_ui_configure', {
        conversationId: 'conv-item5',
        clearVoxelPins: true,
        autoLaunchChrome: false,
      });
      assert.equal(clearPins.isError, false);
      assert.ok(clearPins.body.result.applied.includes('clearVoxelPins'));
      assert.equal(pinTab.state.voxelPins.length, 0);

      await pinTab.stop();
    });

    // 21b. BATCH-TOPOGEN-05 Item 4: 4-Layer UI Action Contract Parity (ui-action-contract.mjs <-> tools.mjs <-> ui-bridge.mjs <-> mcp_ui_bridge.js <-> cli/topogen.mjs)
    await check('B05-Item4: 4-layer UI action contract parity across contract, tools.mjs, mcp_ui_bridge.js & cli/topogen.mjs', async () => {
      // Required B05 additions present in single-source contract
      assert.ok(UI_STEPS.includes('swap_long_ring'), 'UI_STEPS must include swap_long_ring');
      assert.ok(UI_STEPS.includes('select_pq_loop'), 'UI_STEPS must include select_pq_loop');
      assert.ok(UI_LOAD_TARGETS.includes('mesh_tile'), 'UI_LOAD_TARGETS must include mesh_tile');
      assert.ok(UI_CONFIG_SECTIONS.includes('pq'), 'UI_CONFIG_SECTIONS must include pq');

      // tools.mjs schema enums match ui-action-contract.mjs 1-for-1
      const byName = new Map(toolDefinitions.map(t => [t.name, t]));
      assert.deepEqual(byName.get('topogen_ui_run_step').inputSchema.properties.step.enum, [...UI_STEPS]);
      assert.deepEqual(byName.get('topogen_ui_run_step').inputSchema.properties.mode.enum, [...UI_STEP_MODES]);
      assert.deepEqual(byName.get('topogen_ui_load_file').inputSchema.properties.target.enum, [...UI_LOAD_TARGETS]);
      assert.deepEqual(byName.get('topogen_ui_export').inputSchema.properties.format.enum, [...UI_EXPORT_FORMATS]);
      assert.deepEqual(byName.get('topogen_ui_launch').inputSchema.properties.surface.enum, [...UI_SURFACES]);

      // validateTool accepts B05 actions/targets/configs cleanly
      validateTool('topogen_ui_run_step', { step: 'swap_long_ring' });
      validateTool('topogen_ui_run_step', { step: 'select_pq_loop', loopId: 2 });
      validateTool('topogen_ui_run_step', { step: 'select_pq_loop', loopId: null });
      validateTool('topogen_ui_load_file', { target: 'mesh_tile', filePath: 'sample.obj', subDiv: 0, meshOnly: true });
      validateTool('topogen_ui_load_file', { target: 'tile', filePath: 'sample.obj', skeletonize: true });
      validateTool('topogen_ui_configure', { pq: { selectedLoopId: 3, optimization: true } });
      validateTool('topogen_ui_configure', { pq: { selectedLoopId: null } });

      // Cross-layer source parity: every step/target/format in ui-action-contract.mjs is handled in ui/bridge/mcp_ui_bridge.js
      const bridgeSrc = fs.readFileSync(path.join(FOUNDRY_ROOT, 'ui', 'bridge', 'mcp_ui_bridge.js'), 'utf8');
      const runStepIdx = bridgeSrc.indexOf('async function runWorkbenchStep(');
      const exportIdx = bridgeSrc.indexOf('function exportFromWorkbench(');
      const loadFileIdx = bridgeSrc.indexOf('async function loadFileInWorkbench(');
      assert.ok(runStepIdx > 0 && exportIdx > runStepIdx && loadFileIdx > 0, 'Expected bridge handler functions in mcp_ui_bridge.js');

      const loadFileBlock = bridgeSrc.slice(loadFileIdx, runStepIdx);
      const runStepBlock = bridgeSrc.slice(runStepIdx, exportIdx);
      const exportBlock = bridgeSrc.slice(exportIdx, bridgeSrc.indexOf('function summarizeActivity('));

      for (const step of UI_STEPS) {
        const re = new RegExp(`case\\s+['"]${step}['"]\\s*:`);
        assert.ok(re.test(runStepBlock), `mcp_ui_bridge.js runWorkbenchStep missing handler for contract step "${step}"`);
      }
      for (const target of UI_LOAD_TARGETS) {
        const re = new RegExp(`['"]${target}['"]`);
        assert.ok(re.test(loadFileBlock), `mcp_ui_bridge.js loadFileInWorkbench missing handler for contract target "${target}"`);
      }
      for (const fmt of UI_EXPORT_FORMATS) {
        const re = new RegExp(`['"]${fmt}['"]`);
        assert.ok(re.test(exportBlock), `mcp_ui_bridge.js exportFromWorkbench missing handler for contract format "${fmt}"`);
      }

      // cli/topogen.mjs imports canonical contract
      const cliSrc = fs.readFileSync(path.join(FOUNDRY_ROOT, 'cli', 'topogen.mjs'), 'utf8');
      assert.ok(cliSrc.includes("from '../agent/ui-action-contract.mjs'"), 'cli/topogen.mjs must import from ../agent/ui-action-contract.mjs');
    });

    // 21c. BATCH-TOPOGEN-05 Item 3: /api/briefs & /api/runs TTL cache invalidation & async static serving
    await check('B05-Item3: foundry_server.mjs /api/briefs & /api/runs cache invalidation and async no-store static serving', async () => {
      const tempBriefId = `test_b05_cache_${crypto.randomBytes(3).toString('hex')}`;
      const tempBriefPath = path.join(FOUNDRY_ROOT, 'briefs', `${tempBriefId}.json`);
      const pilotBrief = JSON.parse(fs.readFileSync(path.join(FOUNDRY_ROOT, 'briefs', 'pilot_brief.json'), 'utf8'));
      const tempBrief = { ...pilotBrief, id: tempBriefId, name: 'B05 Cache Invalidation Smoke Brief' };

      try {
        // Warm /api/briefs cache
        const b1 = await httpJson(ephemeralPort1, 'GET', '/api/briefs');
        assert.equal(b1.ok, true);
        assert.ok(Array.isArray(b1.data?.briefs));
        assert.ok(!b1.data.briefs.some(b => b.id === tempBriefId), 'Temp brief must not exist before save');

        // Mutate briefs via MCP topogen_save_brief (must invalidate _briefsListCache immediately)
        const saveRes = await liveMcp.callTool('topogen_save_brief', { id: tempBriefId, brief: tempBrief });
        assert.equal(saveRes.isError, false, `topogen_save_brief failed: ${JSON.stringify(saveRes.body)}`);

        // Immediately query /api/briefs (<200ms, well inside 2000ms TTL) and confirm new brief is visible
        const b2 = await httpJson(ephemeralPort1, 'GET', '/api/briefs');
        assert.equal(b2.ok, true);
        assert.ok(
          b2.data.briefs.some(b => b.id === tempBriefId),
          'GET /api/briefs returned stale cached list after topogen_save_brief mutation'
        );

        // Verify /api/runs & /api/storage respond cleanly and async static serving preserves Cache-Control: no-store
        const r1 = await httpJson(ephemeralPort1, 'GET', '/api/runs');
        assert.equal(r1.ok, true);
        assert.ok(Array.isArray(r1.data?.runs));
        const r2 = await httpJson(ephemeralPort1, 'GET', '/api/runs');
        assert.equal(r2.ok, true);
        assert.equal(r2.data.runs.length, r1.data.runs.length);

        const htmlRes = await httpJson(ephemeralPort1, 'GET', '/index_TOPOGEN_PQM_ELASTICA_FDM.html');
        assert.equal(htmlRes.status, 200);
        assert.match(String(htmlRes.headers['cache-control'] || ''), /no-store/i);
      } finally {
        try { fs.rmSync(tempBriefPath, { force: true }); } catch {}
      }
    });

    // 22. Daemon Restart Session Continuity across new sessionId (L5)
    await check('E2E Daemon stop + restart session continuity on new sessionId via latest-session.json (L5)', async () => {
      // Verify sessionless mcp_config.json written by daemon1
      const mcpCfgBefore = JSON.parse(fs.readFileSync(daemonMcpConfigPath, 'utf8'));
      const serverEntry = mcpCfgBefore.mcpServers?.topogen_fdm_foundry;
      assert.ok(serverEntry, 'Expected topogen_fdm_foundry bound in daemon_mcp_config.json');
      assert.ok(!serverEntry.args.includes('--session'), 'mcp_config.json binding must be sessionless');

      // Inspect via liveMcp while daemon1 is up
      const insp1 = await liveMcp.callTool('topogen_inspect', {});
      assert.equal(insp1.isError, false);
      assert.equal(insp1.body.result.mcp.sessionId, daemonSessionId1);

      // Stop daemon1 (simulating user/agent killing the old daemon)
      await daemon1.stop();
      assert.ok(
        JSON.parse(fs.readFileSync(daemonMcpConfigPath, 'utf8')).mcpServers?.topogen_fdm_foundry,
        'Stopping daemon must NOT unbind sessionless mcp_config.json'
      );

      // Start daemon2 WITHOUT --bind-mcp (exact L5 reproducer!) -> mints brand-new sessionId
      const ephemeralPort2 = await getFreePort();
      const daemon2 = await startEphemeralDaemon({
        port: ephemeralPort2,
        env: isolatedEnvBase,
        extraArgs: ['--no-bind-mcp'],
      });
      activeDaemons.push(daemon2);
      const daemonSessionId2 = daemon2.health.mcp.sessionId;
      assert.notEqual(daemonSessionId2, daemonSessionId1);

      const latestPtr = JSON.parse(fs.readFileSync(
        path.join(daemonLocalAppData, 'Topogen', 'Foundry', 'antigravity', 'latest-session.json'),
        'utf8'
      ));
      assert.equal(latestPtr.sessionId, daemonSessionId2);

      // Already-running liveMcp process seamlessly switches to daemon2 without restart!
      const insp2 = await liveMcp.callTool('topogen_inspect', {});
      assert.equal(insp2.isError, false, `MCP failed after daemon restart: ${JSON.stringify(insp2.body)}`);
      assert.equal(insp2.body.result.mcp.sessionId, daemonSessionId2);
      assert.equal(insp2.body.result.port, ephemeralPort2);
    });

    console.log(`\nALL ${results.length} MCP & UI BRIDGE CHAOS CHECKS PASSED.`);
  } finally {
    for (const tab of activeSimTabs) {
      await tab.stop(false).catch(() => {});
    }
    for (const client of liveMcpClients) {
      await client.close().catch(() => {});
    }
    await mcpClient?.close().catch(() => {});
    if (service) await service.close().catch(() => {});
    for (const d of activeDaemons) {
      await d.stop().catch(() => {});
    }
    for (const spawned of readSpawnsLog(spawnsFile)) {
      if (spawned.pid) {
        try { process.kill(spawned.pid); } catch {}
      }
    }
    await sleep(250);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error('MCP TEST FAILED:', err);
  process.exit(1);
});

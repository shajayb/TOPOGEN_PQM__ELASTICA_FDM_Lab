#!/usr/bin/env node
/**
 * TOPOGEN FDM Foundry — Unified CLI Smoke & Integration Test Suite
 *
 * Tests:
 *   1. Air-gap static & dynamic check on cli/topogen.mjs (0 core/ or verifier/ imports)
 *   2. `help` / `--help` (all headless + Mode B Chrome/UI subcommands)
 *   3. `seal --self-test`, `seal --mode A --reseal` lock, and `seal --mode A --verify`
 *   4. `bench`
 *   5. `eval` (with --write-dir artifact persistence)
 *   6. `batch` (3-candidate NDJSON sweep)
 *   7. `run --profile lightning --gates 1,2,3,5 --ndjson` (into temp run dir, cleaned up after)
 *   8. `runs list` & sessionless `mcp --print-config` / `mcp --bind` / `mcp --unbind`
 *   9. Ephemeral-port `serve` startup + idempotent `serve` reuse (`reusedDaemon: true`)
 *  10. Ephemeral-port `mode --status`, `mode --B`, `mode --A`, and offline port exit 1
 *  11. Ephemeral-port `launch --conv test-conv` (via TOPOGEN_MOCK_CHROME_CMD), idempotent reuse, & `tabs`
 *  12. Ephemeral-port `ui inspect`, `ui configure --grid 1x1x1`, `ui load-file`, `ui step`, & `ui export`
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FOUNDRY_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(__dirname, 'topogen.mjs');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function httpGetJson(port, pathname, timeoutMs = 2000) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Origin: `http://127.0.0.1:${port}`,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve({
              status: res.statusCode ?? 0,
              data: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch (err) {
            reject(err);
          }
        });
      }
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('HTTP timeout')));
    req.on('error', reject);
    req.end();
  });
}

function runCli(args = [], opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd: opts.cwd || path.resolve(FOUNDRY_ROOT, '..'),
      env: { ...process.env, ...(opts.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', reject);
    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

function writeCliMockChromeScript(scriptPath, spawnsFile) {
  const code = `import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const targetUrl = process.argv[2] || process.env.TOPOGEN_LAUNCH_URL || '';
const spawnsFile = ${JSON.stringify(spawnsFile)};
const urlObj = new URL(targetUrl);
const port = Number(urlObj.port || 8787);
const surface = urlObj.pathname.includes('foundry_launcher.html') ? 'launcher' : 'workbench';
const clientId = \`wb_climock_\${crypto.randomBytes(4).toString('hex')}\`;
let currentConv = urlObj.searchParams.get('conv') || '';
let pendingLaunch = urlObj.searchParams.get('launch') || '';

fs.appendFileSync(spawnsFile, JSON.stringify({
  pid: process.pid,
  clientId,
  url: targetUrl,
  pathname: urlObj.pathname,
  conv: currentConv || null,
  launch: pendingLaunch || null,
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
    const req = http.request({ hostname: '127.0.0.1', port, path: pathStr, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
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

let state = {
  gridResolution: { x: 3, y: 3, z: 4 },
  preset: 'pilot_champion',
  activeTab: 'tab-tiles',
  lastStep: null,
  loadedFiles: [],
  voxelPins: [],
  fea: { animating: false, deflectionScale: 10, loadCase: 'self_weight' },
};

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
      response = { ok: true, pong: true, clientId, conversationId: currentConv || null, browserKind: 'chrome', surface, bridgeVersion: 2, activeTab: state.activeTab };
    } else if (task.action === 'reload') {
      response = { ok: true, reloading: true, preserveState: task.payload?.preserveState !== false, hardReload: task.payload?.hardReload !== false };
    } else if (task.action === 'inspect') {
      response = { ok: true, available: true, bridgeVersion: 2, clientId, conversationId: currentConv || null, browserKind: 'chrome', surface, ...state };
    } else if (task.action === 'configure') {
      const p = task.payload || {};
      const applied = [];
      const g = p.gridResolution !== undefined ? p.gridResolution : p.grid;
      if (g !== undefined) {
        const [x, y, z] = Array.isArray(g) ? g : String(g).split(/[xX,\\s]+/).map(Number);
        state.gridResolution = { x, y, z };
        applied.push(p.gridResolution !== undefined ? 'gridResolution' : 'grid');
      }
      if (p.clearVoxelPins) { state.voxelPins = []; applied.push('clearVoxelPins'); }
      if (Array.isArray(p.voxelPins)) { state.voxelPins = p.voxelPins.map(v => ({ ...v })); applied.push('voxelPins'); }
      if (p.fea && typeof p.fea === 'object') {
        if (typeof p.fea.animate === 'boolean') state.fea.animating = p.fea.animate;
        if (typeof p.fea.deflectionScale === 'number') state.fea.deflectionScale = p.fea.deflectionScale;
        if (typeof p.fea.loadCase === 'string') state.fea.loadCase = p.fea.loadCase;
        applied.push('fea');
      }
      if (p.preset) { state.preset = p.preset; applied.push('preset'); }
      if (p.tab) { state.activeTab = p.tab; applied.push('tab'); }
      if (p.camera) { applied.push('camera'); }
      if (p.elastica) { state.elastica = p.elastica; applied.push('elastica'); }
      response = { configured: applied.length > 0, applied, state };
    } else if (task.action === 'load_file') {
      state.loadedFiles.push(task.payload?.fileName || 'custom.obj');
      response = {
        loaded: true,
        fileName: task.payload?.fileName,
        target: task.payload?.target || 'tile',
        skeletonize: Boolean(task.payload?.skeletonize),
        meshOnly: Boolean(task.payload?.meshOnly),
        state,
      };
    } else if (task.action === 'run_step') {
      state.lastStep = task.payload?.step;
      if (task.payload?.step === 'fea_animate') {
        const mode = task.payload?.mode || task.payload?.params?.mode || 'toggle';
        if (mode === 'start') state.fea.animating = true;
        else if (mode === 'stop') state.fea.animating = false;
        else state.fea.animating = !state.fea.animating;
      }
      response = {
        step: task.payload?.step,
        ...(task.payload?.loopId !== undefined ? { loopId: task.payload.loopId } : {}),
        completed: true,
        state,
      };
    } else if (task.action === 'export') {
      const fmt = task.payload?.format || 'topology';
      if (fmt === 'topology' || fmt === 'topology_json') {
        const topo = { schema: 'wfc-fdm-topology/v1', vertices: [[0, 0, 0], [0, 0, 1]], edges: [[0, 1]], anchors: [0] };
        const jsonStr = JSON.stringify(topo, null, 2);
        response = { format: fmt, filename: 'mock.topology.json', bytes: jsonStr.length, data: jsonStr, topology: topo };
      } else if (fmt === 'obj') {
        const objStr = 'v 0 0 0\\nv 1 0 0\\nv 0 1 0\\nf 1 2 3\\n';
        response = { format: 'obj', filename: 'mock.mesh.obj', bytes: objStr.length, data: objStr };
      } else {
        const bigBody = Array.from({ length: 7500 }, (_, i) => \`<path d="M \${i} 0 L \${i + 10} 100" stroke="#111"/>\`).join('\\n');
        const svgStr = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">\\n\${bigBody}\\n</svg>\`;
        response = { format: fmt, filename: 'elastica_rods_unrolled.svg', bytes: Buffer.byteLength(svgStr, 'utf8'), data: svgStr };
      }
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

let passed = 0;
let failed = 0;

async function test(name, fn) {
  const t0 = performance.now();
  try {
    await fn();
    const dt = (performance.now() - t0).toFixed(0);
    console.log(`  [PASS] ${name} (${dt} ms)`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err && err.stack ? err.stack : String(err)}`);
    failed++;
  }
}

async function main() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'topogen-cli-test-'));
  const isolatedHome = path.join(tmpRoot, 'home');
  const isolatedAppData = path.join(tmpRoot, 'appdata');
  const isolatedMcpCfg = path.join(tmpRoot, 'mcp_config.json');
  const mockChromeScript = path.join(tmpRoot, 'mock-chrome-cli.mjs');
  const spawnsFile = path.join(tmpRoot, 'cli-chrome-spawns.jsonl');

  fs.mkdirSync(isolatedHome, { recursive: true });
  fs.mkdirSync(isolatedAppData, { recursive: true });
  writeCliMockChromeScript(mockChromeScript, spawnsFile);

  let serveChild = null;

  console.log('========================================================================');
  console.log(' TOPOGEN FDM Foundry — Unified CLI Test Suite');
  console.log('========================================================================');

  try {
    await test('Air-gap check: cli/topogen.mjs has 0 static or dynamic core/ or verifier/ imports', async () => {
      const src = fs.readFileSync(CLI_PATH, 'utf8');
      const importLines = src.split(/\r?\n/).filter((l) => /\b(?:import|export)\b/.test(l));
      for (const line of importLines) {
        if (/^\s*(?:\/\/|\*)/.test(line)) continue;
        assert.ok(!/['"`][^'"`]*core\//.test(line), `Disallowed core/ import: ${line}`);
        assert.ok(!/['"`][^'"`]*verifier\//.test(line), `Disallowed verifier/ import: ${line}`);
      }
    });

    await test('topogen help prints usage with all headless + Mode B Chrome/UI subcommands', async () => {
      const res = await runCli(['help']);
      assert.equal(res.code, 0, `Expected exit 0, got ${res.code}: ${res.stderr}`);
      for (const sub of [
        'launch', 'mode', 'tabs', 'ui',
        'seal', 'bench', 'generate', 'verify', 'eval', 'batch', 'run', 'runs', 'report', 'serve', 'mcp',
      ]) {
        assert.ok(res.stdout.includes(sub), `Help output missing subcommand "${sub}"`);
      }
    });

    await test('topogen seal --self-test, Mode A reseal lock & seal --mode A --verify', async () => {
      const res = await runCli(['seal', '--self-test']);
      assert.equal(res.code, 0, `seal --self-test failed (code=${res.code}): ${res.stdout}\n${res.stderr}`);
      const data = JSON.parse(res.stdout);
      assert.equal(Boolean(data.ok ?? data.passed ?? true), true, 'Expected self-test ok=true');

      // Mode A reseal must ALWAYS fail closed with exit code 2
      const lockRes = await runCli(['seal', '--mode', 'A', '--reseal']);
      assert.equal(lockRes.code, 2, `Expected Mode A reseal exit 2, got ${lockRes.code}`);

      // Verify seal --mode A --verify checks air-gap & verifier surface (and full code seal when sealed)
      const verifyRes = await runCli(['seal', '--mode', 'A', '--verify']);
      const verifyData = JSON.parse(verifyRes.stdout);
      const vEntry = Array.isArray(verifyData.results) ? verifyData.results[0] : verifyData;
      assert.ok(vEntry, 'Expected verify result object');
      assert.equal(vEntry.airGapPassed, true, 'Expected strict airGapPassed=true');
      assert.equal(
        vEntry.actualVerifierSurfaceSha256,
        vEntry.expectedVerifierSurfaceSha256,
        'Expected verifierSurfaceSha256 unchanged'
      );
      if (verifyRes.code === 0) {
        assert.equal(verifyData.ok, true);
        assert.equal(
          vEntry.actualCodeSurfaceSha256,
          vEntry.expectedCodeSurfaceSha256,
          'Expected codeSurfaceSha256 match when verify exits 0'
        );
        assert.deepEqual(vEntry.offendingFiles, []);
      }
    });

    await test('topogen bench passes analytical verifier benchmarks', async () => {
      const res = await runCli(['bench']);
      assert.equal(res.code, 0, `bench failed (code=${res.code}): ${res.stdout}\n${res.stderr}`);
      const data = JSON.parse(res.stdout);
      assert.equal(data.passed, true, 'Expected bench passed=true');
      assert.ok(data.passCount >= 14, `Expected >=14 benchmarks, got ${data.passCount}`);
      assert.ok(typeof data.verifierSealHash === 'string' && data.verifierSealHash.length >= 8, 'Expected verifierSealHash');
    });

    await test('topogen eval evaluates pilot_brief candidate and writes artifacts', async () => {
      const evalDir = path.join(tmpRoot, 'eval_out');
      const res = await runCli([
        'eval',
        '--brief', 'briefs/pilot_brief.json',
        '--preset', 'pilot_champion',
        '--grid', '2x2x3',
        '--seed', '42',
        '--radius', '0.022',
        '--inner-radius', '0.011',
        '--write-dir', evalDir,
        '--name', 'cli_smoke_eval',
      ]);
      assert.equal(res.code, 0, `Expected eval exit 0 (PASS), got ${res.code}: ${res.stderr}`);
      const data = JSON.parse(res.stdout);
      assert.equal(data.status, 'ok');
      assert.equal(data.passed, true, 'Expected eval passed=true');
      assert.ok(data.verdict && typeof data.verdict === 'object', 'Expected verdict object');
      assert.ok(data.metrics && typeof data.metrics === 'object', 'Expected metrics object');
      assert.ok(data.outputs && fs.existsSync(data.outputs.topology), 'Expected persisted topology JSON');
      assert.ok(fs.existsSync(data.outputs.meshObj), 'Expected persisted mesh OBJ');
      assert.ok(fs.existsSync(data.outputs.verdict), 'Expected persisted verdict JSON');
    });

    await test('topogen batch runs 3-candidate NDJSON sweep with warm worker pool', async () => {
      const sweepFile = path.join(tmpRoot, 'sweep.json');
      const batchOut = path.join(tmpRoot, 'batch_out');
      fs.writeFileSync(sweepFile, JSON.stringify({
        briefPath: 'briefs/pilot_brief.json',
        items: [
          { name: 'b1', preset: 'pilot_champion', grid: '2x2x3', seed: 42, radius: 0.022, 'inner-radius': 0.011 },
          { name: 'b2', preset: 'pilot_champion', grid: '2x2x3', seed: 43, radius: 0.024, 'inner-radius': 0.012 },
          { name: 'b3', preset: 'pilot_champion', grid: '2x2x3', seed: 44, radius: 0.026, 'inner-radius': 0.013 },
        ],
      }, null, 2), 'utf8');

      const res = await runCli([
        'batch',
        '--input', sweepFile,
        '--concurrency', '2',
        '--out-dir', batchOut,
      ]);
      assert.equal(res.code, 0, `Expected batch exit 0 (>=1 pass), got ${res.code}: ${res.stderr}`);
      const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
      const cands = lines.filter((l) => l.type === 'candidate');
      const summary = lines.find((l) => l.type === 'summary');
      assert.equal(cands.length, 3, `Expected 3 candidate NDJSON lines, got ${cands.length}`);
      assert.ok(summary, 'Expected final summary NDJSON line');
      assert.equal(summary.total, 3);
      assert.ok(summary.passed >= 1, `Expected >=1 passing candidate, got ${summary.passed}`);
      assert.equal(summary.errors, 0, `Expected 0 batch errors, got ${summary.errors}`);
    });

    await test('topogen run --profile lightning --gates 1,2,3,5 --ndjson completes in temp run dir', async () => {
      const sealCheck = await runCli(['seal', '--mode', 'A', '--verify']);
      const runMode = sealCheck.code === 0 ? 'A' : 'B';
      const tmpRunDir = path.join(tmpRoot, 'lightning_run');
      const res = await runCli([
        'run',
        '--brief', 'briefs/pilot_brief.json',
        '--mode', runMode,
        '--profile', 'lightning',
        '--gates', '1,2,3,5',
        '--run-id', 'cli_test_lightning',
        '--run-dir', tmpRunDir,
        '--ndjson',
      ]);
      assert.equal(res.code, 0, `Expected run exit 0 (passing champion), got ${res.code}: ${res.stderr}`);
      const lines = res.stdout.trim().split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
      const summary = lines.find((l) => l.type === 'summary');
      assert.ok(summary, 'Expected final summary NDJSON line from run');
      assert.equal(summary.status, 'completed', `Expected completed status, got ${summary.status}`);
      assert.equal(summary.runId, 'cli_test_lightning');
      assert.ok(summary.totals && summary.totals.evaluated > 0, 'Expected evaluated candidates > 0');
      assert.ok(summary.totals.passed > 0, 'Expected passed candidates > 0');
      assert.ok(fs.existsSync(path.join(tmpRunDir, 'campaign_state.json')), 'Expected campaign_state.json in temp run dir');
    });

    await test('topogen runs list & sessionless mcp --print-config / --bind / --unbind return valid JSON', async () => {
      const runsRes = await runCli(['runs', 'list']);
      assert.equal(runsRes.code, 0, `runs list failed: ${runsRes.stderr}`);
      const runsData = JSON.parse(runsRes.stdout);
      assert.ok(Array.isArray(runsData.runs), 'Expected runs array');

      const isolatedEnv = {
        HOME: isolatedHome,
        USERPROFILE: isolatedHome,
        LOCALAPPDATA: isolatedAppData,
        TOPOGEN_STATE_ROOT: path.join(isolatedAppData, 'Topogen', 'Foundry'),
        TOPOGEN_ANTIGRAVITY_MCP_CONFIG: isolatedMcpCfg,
      };

      const mcpRes = await runCli(['mcp', '--print-config'], { env: isolatedEnv });
      assert.equal(mcpRes.code, 0, `mcp --print-config failed: ${mcpRes.stderr}`);
      const mcpData = JSON.parse(mcpRes.stdout);
      assert.ok(mcpData.mcpServers?.topogen_fdm_foundry?.command, 'Expected topogen_fdm_foundry server config');
      assert.ok(!mcpData.mcpServers.topogen_fdm_foundry.args.includes('--session'), 'Expected sessionless MCP config');

      const bindRes = await runCli(['mcp', '--bind', '--config-path', isolatedMcpCfg], { env: isolatedEnv });
      assert.equal(bindRes.code, 0);
      assert.ok(JSON.parse(fs.readFileSync(isolatedMcpCfg, 'utf8')).mcpServers?.topogen_fdm_foundry);

      const unbindRes = await runCli(['mcp', '--unbind', '--config-path', isolatedMcpCfg], { env: isolatedEnv });
      assert.equal(unbindRes.code, 0);
      assert.equal(JSON.parse(fs.readFileSync(isolatedMcpCfg, 'utf8')).mcpServers?.topogen_fdm_foundry, undefined);
    });

    // =========================================================================
    // Ephemeral-Port Daemon, Mode, Chrome Launch, Tabs & UI Control Tests
    // =========================================================================
    const ephemeralPort = await getFreePort();
    const offlinePort = await getFreePort();
    const cliDaemonEnv = {
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      LOCALAPPDATA: isolatedAppData,
      TOPOGEN_STATE_ROOT: path.join(isolatedAppData, 'Topogen', 'Foundry'),
      TOPOGEN_ANTIGRAVITY_MCP_CONFIG: isolatedMcpCfg,
      TOPOGEN_MOCK_CHROME_CMD: mockChromeScript,
    };

    await test('Ephemeral daemon: topogen serve starts cleanly & second serve reuses daemon idempotently', async () => {
      // Offline mode check before daemon starts must exit 1 cleanly
      const offlineMode = await runCli(['mode', '--status', '--port', String(offlinePort)], { env: cliDaemonEnv });
      assert.equal(offlineMode.code, 1);
      assert.equal(JSON.parse(offlineMode.stdout).status, 'offline');

      // Start `topogen serve --port <ephemeralPort> --no-browser` in background
      serveChild = spawn(
        process.execPath,
        [CLI_PATH, 'serve', '--port', String(ephemeralPort), '--no-browser'],
        {
          cwd: path.resolve(FOUNDRY_ROOT, '..'),
          env: { ...process.env, ...cliDaemonEnv },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );

      let initialHealth = null;
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        try {
          const h = await httpGetJson(ephemeralPort, '/api/health', 1500);
          if (h.status === 200 && h.data?.status === 'online') {
            initialHealth = h.data;
            break;
          }
        } catch {}
        await sleep(120);
      }
      assert.ok(initialHealth, `Expected serve daemon online on :${ephemeralPort}`);
      assert.equal(initialHealth.mcp?.bound, true, 'serve in antigravity must auto-bind mcp_config.json');
      assert.ok(JSON.parse(fs.readFileSync(isolatedMcpCfg, 'utf8')).mcpServers?.topogen_fdm_foundry);

      // Idempotent 2nd `topogen serve` on same port MUST exit 0 with reusedDaemon: true (no EADDRINUSE!)
      const reuseRes = await runCli(['serve', '--port', String(ephemeralPort)], { env: cliDaemonEnv });
      assert.equal(reuseRes.code, 0, `Expected idempotent serve exit 0: ${reuseRes.stderr}`);
      const reuseData = JSON.parse(reuseRes.stdout);
      assert.equal(reuseData.ok, true);
      assert.equal(reuseData.reusedDaemon, true);
      assert.equal(reuseData.port, ephemeralPort);
      assert.equal(reuseData.sessionId, initialHealth.mcp.sessionId);
    });

    await test('Ephemeral daemon: topogen mode --status / --B / --A toggles runtime mode cleanly', async () => {
      const status1 = await runCli(['mode', '--status', '--port', String(ephemeralPort)], { env: cliDaemonEnv });
      assert.equal(status1.code, 0);
      assert.equal(JSON.parse(status1.stdout).executionMode, 'A');
      assert.equal(JSON.parse(status1.stdout).allowModeB, false);

      const toB = await runCli(['mode', '--B', '--port', String(ephemeralPort)], { env: cliDaemonEnv });
      assert.equal(toB.code, 0);
      const bData = JSON.parse(toB.stdout);
      assert.equal(bData.ok, true);
      assert.equal(bData.executionMode, 'B');
      assert.equal(bData.allowModeB, true);

      const status2 = await runCli(['mode', '--status', '--port', String(ephemeralPort)], { env: cliDaemonEnv });
      assert.equal(status2.code, 0);
      assert.equal(JSON.parse(status2.stdout).executionMode, 'B');
      assert.equal(JSON.parse(status2.stdout).allowModeB, true);

      const toA = await runCli(['mode', '--A', '--port', String(ephemeralPort)], { env: cliDaemonEnv });
      assert.equal(toA.code, 0);
      const aData = JSON.parse(toA.stdout);
      assert.equal(aData.ok, true);
      assert.equal(aData.executionMode, 'A');
      assert.equal(aData.allowModeB, false);
    });

    let boundClientId = null;

    await test('Ephemeral daemon: topogen launch --conv test-conv (mock Chrome), idempotent reuse & topogen tabs', async () => {
      const launch1 = await runCli(
        ['launch', '--port', String(ephemeralPort), '--conv', 'test-conv', '--wait-ms', '8000'],
        { env: cliDaemonEnv }
      );
      assert.equal(launch1.code, 0, `launch failed: ${launch1.stdout}\n${launch1.stderr}`);
      const l1 = JSON.parse(launch1.stdout);
      assert.equal(l1.ok, true);
      assert.equal(l1.launched, true);
      assert.equal(l1.reused, false);
      assert.equal(l1.conversationId, 'test-conv');
      assert.equal(l1.browserKind, 'chrome');
      assert.equal(l1.surface, 'workbench');
      assert.ok(l1.clientId.startsWith('wb_climock_'));
      boundClientId = l1.clientId;

      // Second launch for test-conv reuses live tab without spawning a second Chrome process
      const launch2 = await runCli(
        ['launch', '--port', String(ephemeralPort), '--conv', 'test-conv'],
        { env: cliDaemonEnv }
      );
      assert.equal(launch2.code, 0);
      const l2 = JSON.parse(launch2.stdout);
      assert.equal(l2.ok, true);
      assert.equal(l2.launched, false);
      assert.equal(l2.reused, true);
      assert.equal(l2.clientId, boundClientId);

      const spawns = fs.readFileSync(spawnsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean).map((s) => JSON.parse(s));
      assert.equal(spawns.length, 1, 'Expected exactly 1 mock Chrome spawn across launch + reuse');

      // Inspect tabs via `topogen tabs`
      const tabsRes = await runCli(
        ['tabs', '--port', String(ephemeralPort), '--conv', 'test-conv'],
        { env: cliDaemonEnv }
      );
      assert.equal(tabsRes.code, 0);
      const tabsData = JSON.parse(tabsRes.stdout);
      assert.equal(tabsData.ok, true);
      assert.equal(tabsData.chromeWorkbenchCount, 1);
      assert.ok(tabsData.clients.some((c) => c.clientId === boundClientId && c.boundConversationId === 'test-conv'));
      assert.ok(tabsData.bindings.some((b) => b.conversationId === 'test-conv' && b.clientId === boundClientId && b.live === true));
    });

    await test('Ephemeral daemon: topogen ui inspect, configure --grid 1x1x1, load-file, step & export', async () => {
      // 1. ui inspect
      const inspRes = await runCli(
        ['ui', 'inspect', '--port', String(ephemeralPort), '--conv', 'test-conv'],
        { env: cliDaemonEnv }
      );
      assert.equal(inspRes.code, 0, `ui inspect failed: ${inspRes.stdout}\n${inspRes.stderr}`);
      const inspData = JSON.parse(inspRes.stdout);
      assert.equal(inspData.ok, true);
      assert.equal(inspData.result.clientId, boundClientId);
      assert.equal(inspData.result.boundConversationId, 'test-conv');

      // 2. ui load-file
      const customObjPath = path.join(tmpRoot, 'batwing_sample.obj');
      fs.writeFileSync(customObjPath, 'v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n', 'utf8');
      const loadRes = await runCli(
        ['ui', 'load-file', '--port', String(ephemeralPort), '--conv', 'test-conv', '--file', customObjPath, '--subdiv', '0', '--custom-only'],
        { env: cliDaemonEnv }
      );
      assert.equal(loadRes.code, 0, `ui load-file failed: ${loadRes.stdout}\n${loadRes.stderr}`);
      assert.equal(JSON.parse(loadRes.stdout).result.loaded, true);

      // 3. ui configure --grid 1x1x1
      const cfgRes = await runCli(
        ['ui', 'configure', '--port', String(ephemeralPort), '--conv', 'test-conv', '--grid', '1x1x1', '--elastica-valency', '3', '--camera', 'iso'],
        { env: cliDaemonEnv }
      );
      assert.equal(cfgRes.code, 0, `ui configure failed: ${cfgRes.stdout}\n${cfgRes.stderr}`);
      const cfgData = JSON.parse(cfgRes.stdout);
      assert.equal(cfgData.ok, true);
      assert.equal(cfgData.result.configured, true);
      assert.deepEqual(cfgData.result.state.gridResolution, { x: 1, y: 1, z: 1 });

      // 4. ui step --step elastica (maps to elastica_trace)
      const stepRes = await runCli(
        ['ui', 'step', '--port', String(ephemeralPort), '--conv', 'test-conv', '--step', 'elastica'],
        { env: cliDaemonEnv }
      );
      assert.equal(stepRes.code, 0, `ui step failed: ${stepRes.stdout}\n${stepRes.stderr}`);
      const stepData = JSON.parse(stepRes.stdout);
      assert.equal(stepData.ok, true);
      assert.equal(stepData.result.completed, true);
      assert.equal(stepData.result.step, 'elastica_trace');

      // 5. ui export --format elastica_svg & --format topology_json
      const svgOutPath = path.join(tmpRoot, 'exported_elastica.svg');
      const expSvgRes = await runCli(
        ['ui', 'export', '--port', String(ephemeralPort), '--conv', 'test-conv', '--format', 'elastica_svg', '--out', svgOutPath],
        { env: cliDaemonEnv }
      );
      assert.equal(expSvgRes.code, 0, `ui export elastica_svg failed: ${expSvgRes.stdout}\n${expSvgRes.stderr}`);
      const expSvgData = JSON.parse(expSvgRes.stdout);
      assert.equal(expSvgData.ok, true);
      assert.ok(expSvgData.bytesWritten > 250 * 1024, `Expected >250KB staged SVG written, got ${expSvgData.bytesWritten}`);
      assert.ok(fs.existsSync(svgOutPath));
      const writtenSvg = fs.readFileSync(svgOutPath, 'utf8');
      assert.match(writtenSvg, /^<svg\b/);
      assert.ok(writtenSvg.trim().endsWith('</svg>'), 'Expected complete untruncated closing </svg> via stagedPath');

      const topoOutPath = path.join(tmpRoot, 'exported.topology.json');
      const expTopoRes = await runCli(
        ['ui', 'export', '--port', String(ephemeralPort), '--conv', 'test-conv', '--format', 'topology_json', '--out', topoOutPath],
        { env: cliDaemonEnv }
      );
      assert.equal(expTopoRes.code, 0, `ui export topology_json failed: ${expTopoRes.stdout}\n${expTopoRes.stderr}`);
      const topoDisk = JSON.parse(fs.readFileSync(topoOutPath, 'utf8'));
      assert.equal(topoDisk.schema, 'wfc-fdm-topology/v1');

      // 6. BATCH-TOPOGEN-04 Item 5: ui configure --pin-voxel, --fea-animate, --fea-scale, --clear-voxel-pins & ui step --step fea_animate
      const pinCfgRes = await runCli(
        [
          'ui', 'configure', '--port', String(ephemeralPort), '--conv', 'test-conv',
          '--pin-voxel', '1,1,0=null',
          '--pin-voxel', '0,0,0=2',
          '--fea-animate',
          '--fea-scale', '15',
          '--fea-load-case', 'self_weight',
        ],
        { env: cliDaemonEnv }
      );
      assert.equal(pinCfgRes.code, 0, `ui configure voxelPins/fea failed: ${pinCfgRes.stdout}\n${pinCfgRes.stderr}`);
      const pinCfgData = JSON.parse(pinCfgRes.stdout);
      assert.equal(pinCfgData.ok, true);
      assert.equal(pinCfgData.result.state.voxelPins.length, 2);
      assert.equal(pinCfgData.result.state.fea.animating, true);
      assert.equal(pinCfgData.result.state.fea.deflectionScale, 15);

      const feaStepRes = await runCli(
        ['ui', 'step', '--port', String(ephemeralPort), '--conv', 'test-conv', '--step', 'fea_animate', '--mode', 'stop'],
        { env: cliDaemonEnv }
      );
      assert.equal(feaStepRes.code, 0, `ui step fea_animate failed: ${feaStepRes.stdout}\n${feaStepRes.stderr}`);
      assert.equal(JSON.parse(feaStepRes.stdout).result.state.fea.animating, false);

      const clearPinsRes = await runCli(
        ['ui', 'configure', '--port', String(ephemeralPort), '--conv', 'test-conv', '--clear-voxel-pins'],
        { env: cliDaemonEnv }
      );
      assert.equal(clearPinsRes.code, 0, `ui configure --clear-voxel-pins failed: ${clearPinsRes.stdout}\n${clearPinsRes.stderr}`);
      assert.equal(JSON.parse(clearPinsRes.stdout).result.state.voxelPins.length, 0);

      // 7. BATCH-TOPOGEN-04 Item 1: ui reload & ui step --step reload
      const reloadCliRes = await runCli(
        ['ui', 'reload', '--port', String(ephemeralPort), '--conv', 'test-conv', '--wait-ms', '5000'],
        { env: cliDaemonEnv }
      );
      assert.equal(reloadCliRes.code, 0, `ui reload failed: ${reloadCliRes.stdout}\n${reloadCliRes.stderr}`);
      const reloadCliData = JSON.parse(reloadCliRes.stdout);
      assert.equal(reloadCliData.ok, true);
      assert.equal(reloadCliData.result.reloaded, true);

      const reloadStepRes = await runCli(
        ['ui', 'step', '--port', String(ephemeralPort), '--conv', 'test-conv', '--step', 'reload'],
        { env: cliDaemonEnv }
      );
      assert.equal(reloadStepRes.code, 0, `ui step reload failed: ${reloadStepRes.stdout}\n${reloadStepRes.stderr}`);
      assert.equal(JSON.parse(reloadStepRes.stdout).result.reloaded, true);

      // 8. BATCH-TOPOGEN-05 Item 4: ui load-file --target mesh_tile / --skeletonize & ui step swap_long_ring / select_pq_loop
      const meshTileRes = await runCli(
        ['ui', 'load-file', '--port', String(ephemeralPort), '--conv', 'test-conv', '--file', customObjPath, '--target', 'mesh_tile', '--subdiv', '0'],
        { env: cliDaemonEnv }
      );
      assert.equal(meshTileRes.code, 0, `ui load-file --target mesh_tile failed: ${meshTileRes.stdout}\n${meshTileRes.stderr}`);
      const meshTileData = JSON.parse(meshTileRes.stdout);
      assert.equal(meshTileData.ok, true);
      assert.equal(meshTileData.result.target, 'mesh_tile');

      const skelRes = await runCli(
        ['ui', 'load-file', '--port', String(ephemeralPort), '--conv', 'test-conv', '--file', customObjPath, '--target', 'tile', '--skeletonize', '--subdiv', '0'],
        { env: cliDaemonEnv }
      );
      assert.equal(skelRes.code, 0, `ui load-file --skeletonize failed: ${skelRes.stdout}\n${skelRes.stderr}`);
      const skelData = JSON.parse(skelRes.stdout);
      assert.equal(skelData.ok, true);
      assert.equal(skelData.result.target, 'tile');
      assert.equal(skelData.result.skeletonize, true);

      const swapStepRes = await runCli(
        ['ui', 'step', '--port', String(ephemeralPort), '--conv', 'test-conv', '--step', 'swap_long_ring'],
        { env: cliDaemonEnv }
      );
      assert.equal(swapStepRes.code, 0, `ui step swap_long_ring failed: ${swapStepRes.stdout}\n${swapStepRes.stderr}`);
      assert.equal(JSON.parse(swapStepRes.stdout).result.step, 'swap_long_ring');

      const selLoopRes = await runCli(
        ['ui', 'step', '--port', String(ephemeralPort), '--conv', 'test-conv', '--step', 'select_pq_loop', '--loop-id', '2'],
        { env: cliDaemonEnv }
      );
      assert.equal(selLoopRes.code, 0, `ui step select_pq_loop failed: ${selLoopRes.stdout}\n${selLoopRes.stderr}`);
      const selLoopData = JSON.parse(selLoopRes.stdout);
      assert.equal(selLoopData.result.step, 'select_pq_loop');
      assert.equal(selLoopData.result.loopId, 2);

      const clearLoopRes = await runCli(
        ['ui', 'step', '--port', String(ephemeralPort), '--conv', 'test-conv', '--step', 'select_pq_loop', '--loop-id', 'null'],
        { env: cliDaemonEnv }
      );
      assert.equal(clearLoopRes.code, 0, `ui step select_pq_loop null failed: ${clearLoopRes.stdout}\n${clearLoopRes.stderr}`);
      assert.equal(JSON.parse(clearLoopRes.stdout).result.loopId, null);
    });
  } finally {
    if (fs.existsSync(spawnsFile)) {
      for (const line of fs.readFileSync(spawnsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean)) {
        try {
          const { pid } = JSON.parse(line);
          if (pid) process.kill(pid);
        } catch {}
      }
    }
    if (serveChild && serveChild.exitCode === null && !serveChild.killed) {
      try { serveChild.kill('SIGTERM'); } catch {}
      await Promise.race([
        new Promise((r) => serveChild.once('exit', r)),
        sleep(2000),
      ]);
      if (serveChild.exitCode === null) {
        try { serveChild.kill('SIGKILL'); } catch {}
      }
    }
    const latestPtrPath = path.join(isolatedAppData, 'Topogen', 'Foundry', 'antigravity', 'latest-session.json');
    if (fs.existsSync(latestPtrPath)) {
      try {
        const ptr = JSON.parse(fs.readFileSync(latestPtrPath, 'utf8'));
        if (ptr?.pid) process.kill(ptr.pid);
      } catch {}
    }
    await sleep(250);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }

  console.log('------------------------------------------------------------------------');
  console.log(` CLI Test Summary: ${passed} passed, ${failed} failed`);
  console.log('========================================================================');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveEcosystem, ecosystemInfo, ecosystemEnvironment } from './ecosystem.mjs';
import { brokerCall } from './broker.mjs';
import { bindAntigravityMcp, unbindAntigravityMcp } from './desktop-binding.mjs';
import { UI_ACTIONS, createBrowserUiBridge } from './ui-bridge.mjs';
import { createAgentService } from './service.mjs';
import { toolDefinitions } from './tools.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mcpScript = path.join(__dirname, 'mcp.mjs');

function createMcpClient(child) {
  const pending = new Map();
  let nextId = 1;
  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on('line', line => {
    if (!line.trim()) return;
    const msg = JSON.parse(line);
    const handler = pending.get(msg.id);
    if (handler) {
      pending.delete(msg.id);
      handler(msg);
    }
  });
  return {
    request(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Error(`MCP request timed out: ${method}`));
        }, 15000);
        pending.set(id, msg => {
          clearTimeout(timer);
          resolve(msg);
        });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    },
    close() {
      rl.close();
      child.kill();
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
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'hello.txt'), 'line1\nTOPOGEN_SEARCH_TOKEN=alpha\nGEMINI_API_KEY=AIzaSyFakeSecretKey123456789012345\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, '.env'), 'SECRET=topsecret\n', 'utf8');
  fs.writeFileSync(path.join(projectDir, 'API_KEYS.txt'), 'OPENAI_API_KEY=sk-1234567890abcdef\n', 'utf8');

  let service = null;
  let mcpChild = null;
  let mcpClient = null;

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

    // 2. Browser UI Bridge
    await check('browser UI bridge offline & round-trip', async () => {
      assert.deepEqual(UI_ACTIONS, ['inspect', 'configure', 'run_step', 'export']);
      const bridge = createBrowserUiBridge({ ecosystem: 'antigravity' });
      const offline = await bridge.request('inspect', 300);
      assert.equal(offline.available, false);

      const pollPromise = bridge.poll(2000, 'tab-1', true);
      const reqPromise = bridge.request('inspect', 2000, { verbose: false });
      const task = await pollPromise;
      assert.equal(task.action, 'inspect');
      const rep = bridge.reply({ id: task.id, clientId: 'tab-1', response: { preset: 'pilot_champion', nodes: 42 } });
      assert.equal(rep.accepted, true);
      const res = await reqPromise;
      assert.equal(res.available, true);
      assert.equal(res.preset, 'pilot_champion');
      assert.equal(bridge.status().connected, true);
    });

    // 3. Start real Agent Service with mock backend
    let inspectCalls = 0;
    const sessionId = 'test-session-' + crypto.randomUUID().slice(0, 8);
    service = await createAgentService({
      ecosystem: 'antigravity',
      sessionId,
      workspace: projectDir,
      stateDir,
      allowModeB: false,
      backend: {
        async inspect() {
          inspectCalls++;
          return {
            ok: true,
            foundry: 'TOPOGEN_FDM_FOUNDRY',
            calls: inspectCalls,
            secretToken: 'MUST_BE_STRIPPED',
            nested: { apiKey: 'MUST_BE_STRIPPED', safe: 'visible' }
          };
        },
        async command(operation, args) {
          return { ok: true, operation, args };
        }
      }
    });

    const manifest = JSON.parse(fs.readFileSync(service.manifestPath, 'utf8'));
    assert.equal(manifest.schema, 'topogen.foundry.agent-session.v1');
    assert.equal(manifest.ecosystem, 'antigravity');
    assert.equal(manifest.sessionId, sessionId);

    // 4. Desktop MCP Binding / Unbinding
    await check('bindAntigravityMcp & unbindAntigravityMcp preserve sibling servers', async () => {
      fs.writeFileSync(mcpConfigPath, JSON.stringify({
        mcpServers: { other_server: { command: 'node', args: ['other.js'] } }
      }, null, 2));
      const cfg = service.desktopConfig();
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

    // 5. Direct broker security checks: token, ecosystem, requestId idempotency
    await check('broker auth (token & ecosystem) & requestId idempotency', async () => {
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
    });

    // 6. Real stdio MCP child process
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

    // 7. Mode A lock: read-only workspace ok; mutating workspace blocked
    await check('Mode A lock allows read-only workspace & rejects edit/run_command', async () => {
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

    // 8. Mode B enabled: confined scratch edit & command ok; traversal, .env, destructive git blocked
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

    console.log(`\nALL ${results.length} MCP INTEGRATION CHECKS PASSED.`);
  } finally {
    mcpClient?.close();
    if (service) await service.close();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

run().catch(err => {
  console.error('MCP TEST FAILED:', err);
  process.exit(1);
});

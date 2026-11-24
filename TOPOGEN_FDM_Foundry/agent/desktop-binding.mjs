import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MCP_SERVER_KEY = 'topogen_fdm_foundry';

export function desktopBindingFile(thread) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(thread || '')) {
    throw Error('Launch TOPOGEN Foundry from the intended Codex chat to pair it.');
  }
  return path.join(os.homedir(), '.topogen', 'foundry-desktop', `${thread}.json`);
}

export function bindDesktop(origin, sessionId, thread) {
  const file = desktopBindingFile(thread);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ origin, sessionId }), { flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return file;
}

export function antigravityMcpConfigFile() {
  return process.env.TOPOGEN_ANTIGRAVITY_MCP_CONFIG
    || process.env.ALICE_ANTIGRAVITY_MCP_CONFIG
    || path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
}

export function bindAntigravityMcp(serverConfig, configPath = antigravityMcpConfigFile()) {
  if (!serverConfig || typeof serverConfig.command !== 'string' || !Array.isArray(serverConfig.args)) {
    throw Error('Valid MCP server configuration is required');
  }
  let doc = {};
  if (fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) doc = parsed;
    }
  }
  const existingServers = (doc.mcpServers && typeof doc.mcpServers === 'object' && !Array.isArray(doc.mcpServers))
    ? doc.mcpServers
    : {};
  const next = {
    ...doc,
    mcpServers: {
      ...existingServers,
      [MCP_SERVER_KEY]: serverConfig
    }
  };
  fs.mkdirSync(path.dirname(configPath), { recursive: true, mode: 0o700 });
  const temp = `${configPath}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temp, configPath);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return configPath;
}

export function unbindAntigravityMcp(manifestPath, configPath = antigravityMcpConfigFile()) {
  if (manifestPath === '' || !fs.existsSync(configPath)) return false;
  try {
    const raw = fs.readFileSync(configPath, 'utf8').trim();
    if (!raw) return false;
    const doc = JSON.parse(raw);
    const entry = doc?.mcpServers?.[MCP_SERVER_KEY];
    if (!entry || !Array.isArray(entry.args)) return false;
    if (manifestPath !== undefined && manifestPath !== null) {
      const idx = entry.args.indexOf('--session');
      const boundManifest = idx >= 0 ? entry.args[idx + 1] : entry.args[2];
      if (boundManifest !== manifestPath) return false;
    }
    const servers = { ...doc.mcpServers };
    delete servers[MCP_SERVER_KEY];
    const next = { ...doc, mcpServers: servers };
    const temp = `${configPath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    try {
      fs.renameSync(temp, configPath);
    } finally {
      fs.rmSync(temp, { force: true });
    }
    return true;
  } catch {
    return false;
  }
}

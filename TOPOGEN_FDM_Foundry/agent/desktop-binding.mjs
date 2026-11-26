import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const MCP_SERVER_KEY = 'topogen_fdm_foundry';

function localShareBaseDir() {
  if (process.env.TOPOGEN_STATE_ROOT) {
    return path.resolve(process.env.TOPOGEN_STATE_ROOT);
  }
  if (process.platform === 'win32') {
    return path.join(
      process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
      'Topogen',
      'Foundry'
    );
  }
  return path.join(os.homedir(), '.local', 'share', 'Topogen', 'Foundry');
}

export function foundryEcosystemDir(ecosystem = 'antigravity') {
  return path.join(localShareBaseDir(), ecosystem);
}

export function latestSessionManifestFile(ecosystem = 'antigravity', customParentDir = null) {
  const dir = customParentDir ? path.resolve(customParentDir) : foundryEcosystemDir(ecosystem);
  return path.join(dir, 'latest-session.json');
}

export function writeLatestSessionManifest(manifest, { ecosystem = 'antigravity', customParentDir = null } = {}) {
  if (!manifest || typeof manifest !== 'object') {
    throw Error('Valid session manifest object is required');
  }
  const file = latestSessionManifestFile(ecosystem, customParentDir);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const payload = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  try {
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
  return file;
}

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
      if (idx >= 0) {
        const boundManifest = entry.args[idx + 1];
        if (boundManifest !== manifestPath) return false;
      } else if (entry.args.length >= 3 && !entry.args[1]?.startsWith('--')) {
        if (entry.args[2] !== manifestPath) return false;
      }
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

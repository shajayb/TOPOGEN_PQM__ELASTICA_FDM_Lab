import crypto from 'node:crypto';
import { resolveEcosystem } from './ecosystem.mjs';

export const UI_ACTIONS = ['inspect', 'configure', 'run_step', 'export'];
const MUTATING_ACTIONS = new Set(['configure', 'run_step', 'export']);

export function createBrowserUiBridge({ ecosystem = 'antigravity' } = {}) {
  const resolvedEco = resolveEcosystem(ecosystem, {});
  const queue = [];
  const pending = new Map();
  const waiters = [];
  const clients = new Map();
  let preferredClientId = null;
  let busy = false;

  function pruneClients() {
    if (busy || pending.size > 0) return;
    const now = Date.now();
    for (const [id, c] of clients) {
      if (now - c.lastSeenAt > 25000) clients.delete(id);
    }
  }

  function hasLiveClient() {
    pruneClients();
    return waiters.length > 0 || clients.size > 0;
  }

  function pickWaiterIndex() {
    if (!waiters.length) return -1;
    if (preferredClientId) {
      const exact = waiters.findIndex(w => w.clientId === preferredClientId);
      if (exact >= 0) return exact;
      const c = clients.get(preferredClientId);
      if (c && Date.now() - c.lastSeenAt < 5000) return -1;
    }
    const vis = waiters.findIndex(w => w.visible);
    return vis >= 0 ? vis : 0;
  }

  function dispatchNext() {
    if (!queue.length || !waiters.length) return;
    const wIdx = pickWaiterIndex();
    if (wIdx < 0) return;
    const w = waiters.splice(wIdx, 1)[0];
    const task = queue.shift();
    w.deliver(task);
  }

  function waitForClient(maxWaitMs = 4000) {
    if (hasLiveClient()) return Promise.resolve(true);
    return new Promise(resolve => {
      let done = false;
      const finish = value => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(interval);
        resolve(value);
      };
      const timer = setTimeout(() => finish(hasLiveClient()), maxWaitMs);
      const interval = setInterval(() => {
        if (hasLiveClient()) finish(true);
      }, 200);
    });
  }

  function sendRaw(action, payload, timeoutMs) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        const idx = queue.findIndex(q => q.id === id);
        if (idx >= 0) queue.splice(idx, 1);
        reject(Error('The TOPOGEN 3D Workbench browser tab did not respond in time; keep the Workbench tab open.'));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      queue.push({ id, action, ecosystem: resolvedEco, ...(payload === undefined ? {} : { payload }) });
      dispatchNext();
    });
  }

  return {
    preferClient(clientId) {
      if (typeof clientId === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(clientId)) {
        preferredClientId = clientId;
      }
    },

    poll(timeoutMs = 12000, clientId = 'default', visible = true) {
      clients.set(clientId, { lastSeenAt: Date.now(), visible: !!visible });
      if (queue.length) {
        if (
          !preferredClientId ||
          clientId === preferredClientId ||
          !clients.has(preferredClientId) ||
          Date.now() - clients.get(preferredClientId).lastSeenAt >= 5000
        ) {
          return Promise.resolve(queue.shift());
        }
      }
      return new Promise(resolve => {
        const entry = {
          clientId,
          visible: !!visible,
          deliver: task => {
            clearTimeout(timer);
            const i = waiters.indexOf(entry);
            if (i >= 0) waiters.splice(i, 1);
            resolve(task);
          }
        };
        const timer = setTimeout(() => {
          const i = waiters.indexOf(entry);
          if (i >= 0) waiters.splice(i, 1);
          dispatchNext();
          resolve(null);
        }, timeoutMs);
        waiters.push(entry);
        dispatchNext();
      });
    },

    reply(body) {
      if (body?.clientId) {
        clients.set(body.clientId, { lastSeenAt: Date.now(), visible: true });
      }
      if (!body || typeof body.id !== 'string') throw Error('UI bridge reply id required');
      const entry = pending.get(body.id);
      if (!entry) return { accepted: false };
      pending.delete(body.id);
      clearTimeout(entry.timer);
      if (body.error) entry.reject(Error(String(body.error)));
      else entry.resolve(body.response);
      return { accepted: true };
    },

    async request(action, timeoutMs = 30000, payload) {
      if (!UI_ACTIONS.includes(action)) throw Error('Unsupported UI action: ' + action);
      const clientWait = Math.min(4000, Math.max(200, Number(timeoutMs) || 4000));
      if (!await waitForClient(clientWait)) {
        return {
          available: false,
          message: 'Open the TOPOGEN 3D Workbench in your browser tab so the MCP bridge can inspect and update the live canvas.',
          source: 'live-browser-renderer',
          ecosystem: resolvedEco
        };
      }
      const mutation = MUTATING_ACTIONS.has(action);
      if (mutation && busy) {
        throw Error('A live UI operation is already in progress; wait for it to finish.');
      }
      if (mutation) busy = true;
      try {
        const capMs = action === 'inspect' ? 15000
          : action === 'configure' ? 30000
          : action === 'export' ? 45000
          : 60000;
        const boundMs = Math.min(Math.max(500, Number(timeoutMs) || capMs), capMs);
        const response = await sendRaw(action, payload, boundMs);
        if (response && typeof response === 'object' && !Array.isArray(response)) {
          return {
            ...response,
            available: true,
            source: 'live-browser-renderer',
            ecosystem: resolvedEco
          };
        }
        return {
          available: true,
          value: response,
          source: 'live-browser-renderer',
          ecosystem: resolvedEco
        };
      } finally {
        if (mutation) busy = false;
      }
    },

    status() {
      pruneClients();
      return {
        connected: hasLiveClient(),
        clientCount: clients.size,
        waiterCount: waiters.length,
        pendingCount: pending.size,
        preferredClientId,
        busy,
        ecosystem: resolvedEco
      };
    }
  };
}

import crypto from 'node:crypto';
import { resolveEcosystem } from './ecosystem.mjs';
import {
  UI_ACTIONS as CONTRACT_UI_ACTIONS,
  UI_MUTATING_ACTIONS,
  UI_SURFACES,
} from './ui-action-contract.mjs';

export const BRIDGE_PROTOCOL_VERSION = 2;
export const UI_ACTIONS = CONTRACT_UI_ACTIONS;

const MUTATING_ACTIONS = new Set(UI_MUTATING_ACTIONS);
const VALID_SURFACES = new Set(UI_SURFACES);
const VALID_BROWSER_KINDS = new Set(['chrome', 'edge', 'webview', 'headless', 'other']);
const CLIENT_TTL_MS = 25000;

function validClientId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,80}$/.test(id);
}

function validConversationId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9._:-]{1,120}$/.test(id);
}

export function classifyBrowserKind(userAgent = '', explicitKind = '') {
  const hint = typeof explicitKind === 'string' ? explicitKind.trim().toLowerCase() : '';
  if (hint === 'other-browser') return 'other';
  if (VALID_BROWSER_KINDS.has(hint)) return hint;

  const ua = typeof userAgent === 'string' ? userAgent : '';
  if (!ua.trim()) return 'other';
  if (/HeadlessChrome|PhantomJS|Playwright|Puppeteer/i.test(ua)) return 'headless';
  if (/Electron\/|VSCode|Antigravity|\bwv\)|WebView/i.test(ua)) return 'webview';
  if (/Edg\/|EdgA\/|EdgiOS\//i.test(ua)) return 'edge';
  if (/Chrome\//i.test(ua) && !/OPR\/|Opera|Vivaldi|YaBrowser|Brave/i.test(ua)) return 'chrome';
  return 'other';
}

function inferSurface(explicitSurface, url, fallback = 'workbench') {
  if (typeof explicitSurface === 'string') {
    const s = explicitSurface.trim().toLowerCase();
    if (VALID_SURFACES.has(s)) return s;
  }
  if (typeof url === 'string' && url.includes('foundry_launcher.html')) {
    return 'launcher';
  }
  return VALID_SURFACES.has(fallback) ? fallback : 'workbench';
}

function isRealBrowserKind(kind) {
  return kind !== 'webview' && kind !== 'headless';
}

export function createBrowserUiBridge({ ecosystem = 'antigravity' } = {}) {
  const resolvedEco = resolveEcosystem(ecosystem, {});
  const queue = [];
  const pending = new Map();
  const waiters = [];
  const clients = new Map();
  const busyClients = new Map(); // clientId -> { token, action }
  const clientPollSeq = new Map(); // clientId -> monotonic poll counter (survives disconnect across reload)
  const conversationBindings = new Map(); // conversationId -> { conversationId, clientId, surface, boundAt, launchId, live }
  const pendingLaunches = new Map(); // launchId -> { launchId, conversationId, surface, createdAt, expiresAt, resolvers }
  const completedLaunches = new Map(); // launchId -> handshakeResult
  const suppressedConvForClient = new Map(); // clientId -> suppressedConversationId
  let preferredClientId = null;

  function isClientLiveRaw(clientId, now = Date.now()) {
    if (!clientId) return false;
    if (waiters.some(w => w.clientId === clientId)) return true;
    const c = clients.get(clientId);
    return Boolean(c && now - c.lastSeenAt <= CLIENT_TTL_MS);
  }

  function recomputeBindingSummary(b, now = Date.now()) {
    if (!b) return null;
    const wbLive = Boolean(b.workbenchClientId && b.workbenchLive && isClientLiveRaw(b.workbenchClientId, now));
    const lnLive = Boolean(b.launcherClientId && b.launcherLive && isClientLiveRaw(b.launcherClientId, now));
    b.workbenchLive = wbLive;
    b.launcherLive = lnLive;
    b.live = wbLive || lnLive;
    if (wbLive) {
      b.clientId = b.workbenchClientId;
      b.surface = 'workbench';
    } else if (lnLive) {
      b.clientId = b.launcherClientId;
      b.surface = 'launcher';
    } else if (b.workbenchClientId) {
      b.clientId = b.workbenchClientId;
      b.surface = 'workbench';
    } else {
      b.clientId = b.launcherClientId || null;
      b.surface = b.launcherClientId ? 'launcher' : 'workbench';
    }
    return b;
  }

  function getBindingSurfaceSlot(b, surface = 'workbench', now = Date.now()) {
    if (!b) return { clientId: null, live: false };
    if (surface === 'launcher') {
      const id = b.launcherClientId || (b.surface === 'launcher' ? b.clientId : null);
      return { clientId: id, live: Boolean(id && b.launcherLive !== false && isClientLiveRaw(id, now)) };
    }
    const id = b.workbenchClientId || (b.surface !== 'launcher' ? b.clientId : null);
    return { clientId: id, live: Boolean(id && b.workbenchLive !== false && isClientLiveRaw(id, now)) };
  }

  function notifySyncInternal(targetClientIds = null) {
    const filterSet = (targetClientIds === null || targetClientIds === undefined)
      ? null
      : new Set((Array.isArray(targetClientIds) ? targetClientIds : [targetClientIds]).filter(Boolean));
    let woken = 0;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (!filterSet || filterSet.has(waiters[i].clientId)) {
        const [w] = waiters.splice(i, 1);
        w.cancel();
        woken++;
      }
    }
    return { woken };
  }

  function pruneClients() {
    const now = Date.now();
    for (const [id, c] of clients) {
      if (busyClients.has(id)) continue;
      if (waiters.some(w => w.clientId === id)) continue;
      if (now - c.lastSeenAt > CLIENT_TTL_MS) {
        clients.delete(id);
        suppressedConvForClient.delete(id);
        if (preferredClientId === id) {
          preferredClientId = null;
        }
        for (const [, binding] of conversationBindings) {
          let touched = false;
          if (binding.workbenchClientId === id) {
            binding.workbenchLive = false;
            touched = true;
          }
          if (binding.launcherClientId === id) {
            binding.launcherLive = false;
            touched = true;
          }
          if (binding.clientId === id) {
            touched = true;
          }
          if (touched) {
            recomputeBindingSummary(binding, now);
          }
        }
      }
    }

    if (preferredClientId && !clients.has(preferredClientId) && !waiters.some(w => w.clientId === preferredClientId)) {
      preferredClientId = null;
    }

    for (const [launchId, pl] of pendingLaunches) {
      if (now > pl.expiresAt) {
        pendingLaunches.delete(launchId);
        for (const finish of pl.resolvers) {
          finish({ ok: false, code: 'NO_HANDSHAKE', launchId, conversationId: pl.conversationId });
        }
      }
    }

    for (const [launchId, done] of completedLaunches) {
      if (now - done.completedAt > 60000) {
        completedLaunches.delete(launchId);
      }
    }
  }

  function hasLiveClient(targetClientId = null) {
    pruneClients();
    if (targetClientId) {
      return isClientLiveRaw(targetClientId);
    }
    return waiters.length > 0 || clients.size > 0;
  }

  function getBoundConversation(clientId) {
    if (!clientId) return null;
    for (const [convId, binding] of conversationBindings) {
      if (binding.workbenchClientId === clientId && binding.workbenchLive !== false) {
        return convId;
      }
      if (binding.launcherClientId === clientId && binding.launcherLive !== false) {
        return convId;
      }
    }
    return null;
  }

  function bindConversationInternal(conversationId, clientId, { surface = 'workbench', launchId = null } = {}) {
    if (!validConversationId(conversationId) || !validClientId(clientId)) return null;
    const now = Date.now();
    const c = clients.get(clientId);
    const resolvedSurface = c?.surface || (VALID_SURFACES.has(surface) ? surface : 'workbench');
    const affectedClients = new Set([clientId]);

    // Ensure one tab is bound to at most one active conversation at a time
    for (const [otherConv, binding] of conversationBindings) {
      if (otherConv === conversationId) continue;
      let changed = false;
      if (binding.workbenchClientId === clientId) {
        binding.workbenchClientId = null;
        binding.workbenchLive = false;
        changed = true;
      }
      if (binding.launcherClientId === clientId) {
        binding.launcherClientId = null;
        binding.launcherLive = false;
        changed = true;
      }
      if (changed) {
        if (!binding.workbenchClientId && !binding.launcherClientId) {
          conversationBindings.delete(otherConv);
        } else {
          recomputeBindingSummary(binding, now);
        }
      }
    }

    const existing = conversationBindings.get(conversationId);
    const prevSlotClientId = resolvedSurface === 'launcher'
      ? existing?.launcherClientId
      : existing?.workbenchClientId;
    if (prevSlotClientId && prevSlotClientId !== clientId) {
      affectedClients.add(prevSlotClientId);
      const oldClient = clients.get(prevSlotClientId);
      if (oldClient && oldClient.conversationId === conversationId) {
        oldClient.conversationId = null;
      }
    }

    const record = {
      conversationId,
      clientId: existing?.clientId || clientId,
      surface: existing?.surface || resolvedSurface,
      workbenchClientId: resolvedSurface === 'workbench' ? clientId : (existing?.workbenchClientId || null),
      workbenchLive: resolvedSurface === 'workbench' ? true : Boolean(existing?.workbenchLive),
      launcherClientId: resolvedSurface === 'launcher' ? clientId : (existing?.launcherClientId || null),
      launcherLive: resolvedSurface === 'launcher' ? true : Boolean(existing?.launcherLive),
      boundAt: now,
      launchId: launchId || c?.launchId || existing?.launchId || null,
      live: true,
    };
    recomputeBindingSummary(record, now);
    conversationBindings.set(conversationId, record);
    suppressedConvForClient.delete(clientId);
    if (c) {
      c.conversationId = conversationId;
    }
    record.affectedClientIds = Array.from(affectedClients);
    return record;
  }

  function updateClientMeta(clientId, meta = {}) {
    const now = Date.now();
    const prev = clients.get(clientId) || null;

    const visible = meta.visible !== undefined ? Boolean(meta.visible) : (prev ? prev.visible : true);
    const focused = meta.focused !== undefined ? Boolean(meta.focused) : (prev ? prev.focused : false);
    const incomingFocusedAt = Number(meta.lastFocusedAt);
    const transitionedToFocused = focused && !(prev?.focused);
    const lastFocusedAt = Number.isFinite(incomingFocusedAt) && incomingFocusedAt > 0
      ? Math.max(prev?.lastFocusedAt || 0, incomingFocusedAt)
      : (transitionedToFocused ? now : (prev?.lastFocusedAt || (focused ? now : 0)));

    const url = typeof meta.url === 'string' && meta.url.length > 0 ? meta.url : (prev?.url || null);
    const surface = inferSurface(meta.surface, url, prev?.surface || 'workbench');
    const userAgent = typeof meta.userAgent === 'string' && meta.userAgent.length > 0
      ? meta.userAgent
      : (prev?.userAgent || null);
    const hasKindHint = (typeof meta.browserKind === 'string' && meta.browserKind.length > 0)
      || (typeof meta.userAgent === 'string' && meta.userAgent.length > 0);
    const browserKind = hasKindHint
      ? classifyBrowserKind(userAgent || '', meta.browserKind || '')
      : (prev?.browserKind || 'other');

    const parsedVer = Number(meta.bridgeVersion);
    const bridgeVersion = (meta.bridgeVersion !== undefined && Number.isFinite(parsedVer) && parsedVer > 0)
      ? parsedVer
      : (prev?.bridgeVersion ?? BRIDGE_PROTOCOL_VERSION);

    const rawLaunch = typeof (meta.launchId ?? meta.launch) === 'string'
      ? (meta.launchId ?? meta.launch).trim()
      : '';
    const launchId = rawLaunch || prev?.launchId || null;

    const rawConvParam = meta.conversationId !== undefined ? meta.conversationId : meta.conv;
    let incomingConv = typeof rawConvParam === 'string' ? rawConvParam.trim() : undefined;
    const suppressedConv = suppressedConvForClient.get(clientId);
    if (suppressedConv) {
      if (!incomingConv) {
        suppressedConvForClient.delete(clientId);
      } else if (incomingConv === suppressedConv) {
        incomingConv = '';
      } else {
        suppressedConvForClient.delete(clientId);
      }
    }

    const next = {
      clientId,
      url,
      surface,
      browserKind,
      userAgent,
      bridgeVersion,
      conversationId: prev?.conversationId || null,
      launchId,
      visible,
      focused,
      lastFocusedAt,
      lastSeenAt: now,
      connectedAt: prev?.connectedAt || now,
    };
    clients.set(clientId, next);

    // 1. Resolve pending launchId handshake atomically
    if (rawLaunch && pendingLaunches.has(rawLaunch)) {
      const pl = pendingLaunches.get(rawLaunch);
      pendingLaunches.delete(rawLaunch);
      const targetConv = pl.conversationId || (validConversationId(incomingConv) ? incomingConv : null);
      const targetSurface = next.surface || pl.surface || 'workbench';
      if (targetConv) {
        bindConversationInternal(targetConv, clientId, { surface: targetSurface, launchId: rawLaunch });
      }
      const handshake = {
        ok: true,
        clientId,
        conversationId: targetConv,
        surface: targetSurface,
        browserKind: next.browserKind,
        bridgeVersion: next.bridgeVersion,
        url: next.url,
        launchId: rawLaunch,
        completedAt: now,
      };
      completedLaunches.set(rawLaunch, handshake);
      for (const finish of pl.resolvers) {
        finish(handshake);
      }
    }

    // 2. Reconcile conversationBindings affinity (including F5 reload & companion workbench <-> launcher surfaces)
    const activeBoundConv = getBoundConversation(clientId);
    if (activeBoundConv) {
      const b = conversationBindings.get(activeBoundConv);
      if (b) {
        if (next.surface === 'launcher') {
          if (b.workbenchClientId === clientId) {
            b.workbenchClientId = null;
            b.workbenchLive = false;
          }
          b.launcherClientId = clientId;
          b.launcherLive = true;
        } else {
          if (b.launcherClientId === clientId) {
            b.launcherClientId = null;
            b.launcherLive = false;
          }
          b.workbenchClientId = clientId;
          b.workbenchLive = true;
        }
        recomputeBindingSummary(b, now);
      }
      next.conversationId = activeBoundConv;
    } else if (validConversationId(incomingConv) && isRealBrowserKind(next.browserKind)) {
      const existing = conversationBindings.get(incomingConv);
      const slot = getBindingSurfaceSlot(existing, next.surface, now);
      if (!existing || !slot.clientId || slot.clientId === clientId || !slot.live) {
        bindConversationInternal(incomingConv, clientId, { surface: next.surface, launchId: next.launchId });
      } else {
        // Another live tab of the SAME surface already owns incomingConv (e.g. duplicated tab); leave unbound
        next.conversationId = null;
      }
    } else if (incomingConv === '') {
      next.conversationId = null;
    }

    return next;
  }

  function scoreClientRecord(c) {
    const browserTier = c.browserKind === 'chrome' ? 3
      : (c.browserKind === 'edge' || c.browserKind === 'other') ? 2
      : 0;
    const focusTier = (c.focused && c.visible) ? 3
      : c.visible ? 2
      : c.focused ? 1
      : 0;
    const isPref = (preferredClientId && c.clientId === preferredClientId) ? 1 : 0;
    return {
      browserTier,
      isPref,
      focusTier,
      lastFocusedAt: c.lastFocusedAt || 0,
      lastSeenAt: c.lastSeenAt || 0,
    };
  }

  function compareClientRecordsDesc(a, b) {
    const sa = scoreClientRecord(a);
    const sb = scoreClientRecord(b);
    if (sb.browserTier !== sa.browserTier) return sb.browserTier - sa.browserTier;
    if (sb.isPref !== sa.isPref) return sb.isPref - sa.isPref;
    if (sb.focusTier !== sa.focusTier) return sb.focusTier - sa.focusTier;
    if (sb.lastFocusedAt !== sa.lastFocusedAt) return sb.lastFocusedAt - sa.lastFocusedAt;
    return sb.lastSeenAt - sa.lastSeenAt;
  }

  function pickWaiterIndex(targetClientId = null) {
    if (!waiters.length) return -1;
    if (targetClientId) {
      return waiters.findIndex(w => w.clientId === targetClientId);
    }
    let bestIdx = -1;
    let bestClient = null;
    for (let i = 0; i < waiters.length; i++) {
      const c = clients.get(waiters[i].clientId) || {
        clientId: waiters[i].clientId,
        browserKind: 'other',
        visible: waiters[i].visible,
        focused: waiters[i].focused,
        lastFocusedAt: waiters[i].lastFocusedAt,
        lastSeenAt: waiters[i].enqueuedAt,
      };
      if (!bestClient || compareClientRecordsDesc(bestClient, c) > 0) {
        bestClient = c;
        bestIdx = i;
      }
    }
    return bestIdx;
  }

  function dispatchNext() {
    if (!queue.length || !waiters.length) return;
    for (let qIdx = 0; qIdx < queue.length; qIdx++) {
      const task = queue[qIdx];
      const wIdx = pickWaiterIndex(task.targetClientId || null);
      if (wIdx < 0) continue;
      const w = waiters.splice(wIdx, 1)[0];
      queue.splice(qIdx, 1);
      const pendingEntry = pending.get(task.id);
      if (pendingEntry) {
        pendingEntry.dispatchedToClientId = w.clientId;
      }
      const { targetClientId: _ignored, ...wireTask } = task;
      w.deliver(wireTask);
      return;
    }
  }

  function discardPendingForClient(clientId, { actionFilter = null, releaseBusy = true, reason = 'Superseded by newer request' } = {}) {
    if (!validClientId(clientId)) return { discardedCount: 0 };
    let discardedCount = 0;
    for (const [taskId, entry] of [...pending.entries()]) {
      const matchesClient = entry.targetClientId === clientId || entry.dispatchedToClientId === clientId;
      const matchesAction = !actionFilter || entry.action === actionFilter;
      if (matchesClient && matchesAction) {
        pending.delete(taskId);
        clearTimeout(entry.timer);
        const qIdx = queue.findIndex(q => q.id === taskId);
        if (qIdx >= 0) queue.splice(qIdx, 1);
        const err = Error(reason);
        err.code = 'TASK_SUPERSEDED';
        err.superseded = true;
        entry.reject(err);
        discardedCount++;
      }
    }
    for (let i = queue.length - 1; i >= 0; i--) {
      const q = queue[i];
      if (q.targetClientId === clientId && (!actionFilter || q.action === actionFilter)) {
        queue.splice(i, 1);
        discardedCount++;
      }
    }
    if (releaseBusy) {
      const curBusy = busyClients.get(clientId);
      if (curBusy && (!actionFilter || curBusy.action === actionFilter)) {
        busyClients.delete(clientId);
      }
    }
    return { discardedCount };
  }

  function sendRaw(action, payload, timeoutMs, targetClientId = null, customId = null) {
    return new Promise((resolve, reject) => {
      const id = customId || crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        const idx = queue.findIndex(q => q.id === id);
        if (idx >= 0) queue.splice(idx, 1);
        reject(Error(
          targetClientId
            ? `The requested TOPOGEN browser tab (${targetClientId}) did not respond in time.`
            : 'The TOPOGEN 3D Workbench browser tab did not respond in time; keep the Workbench tab open.'
        ));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer, action, targetClientId, dispatchedToClientId: null });
      queue.push({
        id,
        action,
        ecosystem: resolvedEco,
        ...(targetClientId ? { targetClientId } : {}),
        ...(payload === undefined ? {} : { payload }),
      });
      dispatchNext();
    });
  }

  function formatClientSummaryList(surfaceFilter = null) {
    pruneClients();
    const now = Date.now();
    const list = [];
    for (const [id, c] of clients) {
      if (surfaceFilter && c.surface !== surfaceFilter) continue;
      const boundConversationId = getBoundConversation(id);
      list.push({
        clientId: id,
        url: c.url,
        surface: c.surface,
        browserKind: c.browserKind,
        userAgent: c.userAgent,
        bridgeVersion: c.bridgeVersion,
        conversationId: boundConversationId || c.conversationId || null,
        boundConversationId,
        launchId: c.launchId,
        visible: c.visible,
        focused: c.focused,
        lastFocusedAt: c.lastFocusedAt,
        lastSeenAt: c.lastSeenAt,
        connectedAt: c.connectedAt,
        ageMs: Math.max(0, now - c.lastSeenAt),
        busy: busyClients.has(id),
        preferred: id === preferredClientId,
      });
    }
    list.sort(compareClientRecordsDesc);
    return list;
  }

  function formatBindingsList() {
    pruneClients();
    const now = Date.now();
    return Array.from(conversationBindings.values()).map(b => {
      recomputeBindingSummary(b, now);
      return {
        conversationId: b.conversationId,
        clientId: b.clientId,
        surface: b.surface,
        workbenchClientId: b.workbenchClientId || null,
        launcherClientId: b.launcherClientId || null,
        boundAt: b.boundAt,
        launchId: b.launchId,
        live: Boolean(b.live),
      };
    });
  }

  function getUnboundLiveChromeTabs(surface = 'workbench', forConversationId = null) {
    const now = Date.now();
    const matches = [];
    for (const [, c] of clients) {
      if (!isClientLiveRaw(c.clientId, now)) continue;
      if ((c.surface || 'workbench') !== surface) continue;
      if (c.browserKind !== 'chrome') continue;
      const boundConv = getBoundConversation(c.clientId);
      if (boundConv && boundConv !== forConversationId) continue;
      if (c.conversationId && c.conversationId !== forConversationId) {
        const otherBinding = conversationBindings.get(c.conversationId);
        const otherSlot = getBindingSurfaceSlot(otherBinding, surface, now);
        if (otherSlot.live) continue;
      }
      matches.push(c);
    }
    matches.sort(compareClientRecordsDesc);
    return matches;
  }

  function resolveRoutingDecision({
    explicitClientId,
    conversationId,
    surface,
    mutation,
    allowWebviewFallback,
    minBridgeVersion = 0,
  }) {
    pruneClients();
    const now = Date.now();
    const meetsVersion = c => !minBridgeVersion || ((c?.bridgeVersion ?? BRIDGE_PROTOCOL_VERSION) >= minBridgeVersion);

    // 1. Explicit clientId: route strictly to that clientId
    if (explicitClientId) {
      if (isClientLiveRaw(explicitClientId, now)) {
        const ec = clients.get(explicitClientId);
        if (!ec || meetsVersion(ec)) {
          return { ok: true, targetClientId: explicitClientId };
        }
      }
      return { ok: false, waitable: true, reason: 'EXPLICIT_CLIENT_OFFLINE' };
    }

    // 2. Deterministic conversationId routing
    if (conversationId) {
      const binding = conversationBindings.get(conversationId);
      const slot = getBindingSurfaceSlot(binding, surface, now);
      if (slot.live && slot.clientId) {
        const boundClient = clients.get(slot.clientId);
        if (
          boundClient &&
          (boundClient.surface || 'workbench') === surface &&
          isRealBrowserKind(boundClient.browserKind) &&
          meetsVersion(boundClient)
        ) {
          recomputeBindingSummary(binding, now);
          return { ok: true, targetClientId: slot.clientId };
        }
      }

      // Live real-browser tab reporting matching client.conversationId on surface -> auto-bind & target
      const matchingBySelfConv = [];
      for (const [, c] of clients) {
        if (!isClientLiveRaw(c.clientId, now)) continue;
        if ((c.surface || 'workbench') !== surface) continue;
        if (!isRealBrowserKind(c.browserKind)) continue;
        if (!meetsVersion(c)) continue;
        const otherBound = getBoundConversation(c.clientId);
        if (otherBound && otherBound !== conversationId) continue;
        if (c.conversationId === conversationId) {
          matchingBySelfConv.push(c);
        }
      }
      if (matchingBySelfConv.length > 0) {
        matchingBySelfConv.sort(compareClientRecordsDesc);
        const chosen = matchingBySelfConv[0];
        bindConversationInternal(conversationId, chosen.clientId, { surface, launchId: chosen.launchId });
        return { ok: true, targetClientId: chosen.clientId, autoBound: true };
      }

      // Unbound live Chrome tabs on surface
      const unboundChrome = getUnboundLiveChromeTabs(surface, conversationId).filter(meetsVersion);
      if (unboundChrome.length === 1) {
        const chosen = unboundChrome[0];
        bindConversationInternal(conversationId, chosen.clientId, { surface, launchId: chosen.launchId });
        return { ok: true, targetClientId: chosen.clientId, autoBound: true };
      }
      if (unboundChrome.length >= 2) {
        if (mutation) {
          const tabListStr = unboundChrome.map(c => `${c.clientId}${c.focused ? ' (focused)' : ''}`).join(', ');
          const err = Error(
            `Ambiguous target tab: ${unboundChrome.length} unpaired Google Chrome ${surface} tabs are open (${tabListStr}) and none is paired to conversation "${conversationId}". ` +
            `Call topogen_ui_connect({ conversationId: "${conversationId}", clientId: "<tabId>" }) (inspect tabs via topogen_ui_tabs) or click "Pair This Tab" in the Chrome HUD pill.`
          );
          err.code = 'AMBIGUOUS_CHROME_TABS';
          err.clients = formatClientSummaryList(surface);
          throw err;
        }
        return { ok: true, targetClientId: unboundChrome[0].clientId, ambiguousTabs: true };
      }

      return { ok: false, waitable: true, reason: 'NO_CHROME_FOR_CONVERSATION' };
    }

    // 3. Neither clientId nor conversationId: prefer Chrome > Edge/Other; NEVER pick webview/headless if real browser exists (or unless allowWebviewFallback)
    const realTabs = [];
    const fallbackTabs = [];
    for (const [, c] of clients) {
      if (!isClientLiveRaw(c.clientId, now)) continue;
      if ((c.surface || 'workbench') !== surface) continue;
      if (!meetsVersion(c)) continue;
      if (isRealBrowserKind(c.browserKind)) {
        realTabs.push(c);
      } else if (allowWebviewFallback) {
        fallbackTabs.push(c);
      }
    }
    if (realTabs.length > 0) {
      realTabs.sort(compareClientRecordsDesc);
      return { ok: true, targetClientId: realTabs[0].clientId };
    }
    if (fallbackTabs.length > 0) {
      fallbackTabs.sort(compareClientRecordsDesc);
      return { ok: true, targetClientId: fallbackTabs[0].clientId };
    }
    return { ok: false, waitable: true, reason: 'NO_ELIGIBLE_CLIENT' };
  }

  function waitForRoutedClient(maxWaitMs, routingParams) {
    const initial = resolveRoutingDecision(routingParams);
    if (initial.ok || !initial.waitable) return Promise.resolve(initial);
    if (maxWaitMs <= 0) return Promise.resolve(initial);

    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (val, err = null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(interval);
        if (err) reject(err);
        else resolve(val);
      };
      const check = () => {
        try {
          const decision = resolveRoutingDecision(routingParams);
          if (decision.ok || !decision.waitable) {
            finish(decision);
          }
        } catch (err) {
          finish(null, err);
        }
      };
      const timer = setTimeout(() => {
        try {
          finish(resolveRoutingDecision(routingParams));
        } catch (err) {
          finish(null, err);
        }
      }, maxWaitMs);
      const interval = setInterval(check, 120);
    });
  }

  return {
    preferClient(clientId) {
      if (validClientId(clientId)) {
        preferredClientId = clientId;
      }
    },

    focus(clientId, meta = {}) {
      if (!validClientId(clientId)) return { ok: false };
      const now = Date.now();
      const updated = updateClientMeta(clientId, {
        ...meta,
        visible: meta.visible !== undefined ? Boolean(meta.visible) : true,
        focused: meta.focused !== undefined ? Boolean(meta.focused) : true,
        lastFocusedAt: Number(meta.lastFocusedAt) || now,
      });
      if (updated.focused && updated.visible) {
        const curPref = preferredClientId ? clients.get(preferredClientId) : null;
        if (isRealBrowserKind(updated.browserKind) || !curPref || !isRealBrowserKind(curPref.browserKind)) {
          preferredClientId = clientId;
        }
      }
      for (const w of waiters) {
        if (w.clientId === clientId) {
          w.visible = updated.visible;
          w.focused = updated.focused;
          w.lastFocusedAt = updated.lastFocusedAt;
        }
      }
      dispatchNext();
      return {
        ok: true,
        clientId,
        preferredClientId,
        boundConversationId: getBoundConversation(clientId),
      };
    },

    disconnect(clientId) {
      if (!validClientId(clientId)) {
        return { ok: false, disconnected: false };
      }
      const existed = clients.delete(clientId);
      busyClients.delete(clientId);
      suppressedConvForClient.delete(clientId);

      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].clientId === clientId) {
          const [w] = waiters.splice(i, 1);
          w.cancel();
        }
      }

      if (preferredClientId === clientId) {
        preferredClientId = null;
      }

      const affectedConversations = [];
      const now = Date.now();
      for (const [convId, binding] of conversationBindings) {
        let matched = false;
        if (binding.workbenchClientId === clientId) {
          binding.workbenchLive = false;
          matched = true;
        }
        if (binding.launcherClientId === clientId) {
          binding.launcherLive = false;
          matched = true;
        }
        if (binding.clientId === clientId) {
          matched = true;
        }
        if (matched) {
          recomputeBindingSummary(binding, now);
          affectedConversations.push(convId);
        }
      }

      for (const [taskId, entry] of pending) {
        if (entry.targetClientId === clientId || entry.dispatchedToClientId === clientId) {
          pending.delete(taskId);
          clearTimeout(entry.timer);
          const qIdx = queue.findIndex(q => q.id === taskId);
          if (qIdx >= 0) queue.splice(qIdx, 1);
          entry.reject(Error(`TOPOGEN browser tab "${clientId}" disconnected before completing the operation.`));
        }
      }

      return {
        ok: true,
        clientId,
        disconnected: existed,
        affectedConversations,
      };
    },

    registerPendingLaunch({ launchId, conversationId = null, surface = 'workbench', timeoutMs = 15000 } = {}) {
      if (typeof launchId !== 'string' || !launchId.trim()) {
        throw Error('launchId is required for registerPendingLaunch');
      }
      const cleanId = launchId.trim();
      const cleanConv = validConversationId(conversationId) ? conversationId.trim() : null;
      const cleanSurface = VALID_SURFACES.has(surface) ? surface : 'workbench';
      const now = Date.now();
      const ttl = Math.max(2000, Math.min(60000, Number(timeoutMs) || 15000));
      pendingLaunches.set(cleanId, {
        launchId: cleanId,
        conversationId: cleanConv,
        surface: cleanSurface,
        createdAt: now,
        expiresAt: now + ttl,
        resolvers: new Set(),
      });
      return {
        launchId: cleanId,
        conversationId: cleanConv,
        surface: cleanSurface,
      };
    },

    waitForLaunch(launchId, timeoutMs = 8000) {
      const cleanId = typeof launchId === 'string' ? launchId.trim() : '';
      if (!cleanId) {
        return Promise.resolve({ ok: false, code: 'INVALID_LAUNCH_ID', launchId });
      }
      if (completedLaunches.has(cleanId)) {
        return Promise.resolve(completedLaunches.get(cleanId));
      }
      // Also check if an already-connected client reported this launchId
      for (const [, c] of clients) {
        if (c.launchId === cleanId && isClientLiveRaw(c.clientId)) {
          const boundConv = getBoundConversation(c.clientId) || c.conversationId || null;
          const hit = {
            ok: true,
            clientId: c.clientId,
            conversationId: boundConv,
            surface: c.surface,
            browserKind: c.browserKind,
            bridgeVersion: c.bridgeVersion,
            url: c.url,
            launchId: cleanId,
            completedAt: Date.now(),
          };
          completedLaunches.set(cleanId, hit);
          return Promise.resolve(hit);
        }
      }
      const pl = pendingLaunches.get(cleanId);
      if (!pl) {
        return Promise.resolve({ ok: false, code: 'UNKNOWN_LAUNCH_ID', launchId: cleanId });
      }
      const waitBound = Math.max(300, Math.min(30000, Number(timeoutMs) || 8000));
      pl.expiresAt = Math.max(pl.expiresAt, Date.now() + waitBound + 5000);

      return new Promise(resolve => {
        let settled = false;
        const finish = result => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          pl.resolvers.delete(finish);
          resolve(result);
        };
        const timer = setTimeout(() => {
          finish({
            ok: false,
            code: 'NO_HANDSHAKE',
            launchId: cleanId,
            conversationId: pl.conversationId,
          });
        }, waitBound);
        pl.resolvers.add(finish);
      });
    },

    notifySync(targetClientIds = null) {
      return notifySyncInternal(targetClientIds);
    },

    claimTab({ clientId = null, conversationId = null, claimFocusedChrome = false, surface = 'workbench' } = {}) {
      pruneClients();
      const now = Date.now();
      const targetSurface = VALID_SURFACES.has(surface) ? surface : 'workbench';

      // Unbind mode when conversationId is null or empty string
      if (conversationId === null || conversationId === '') {
        if (!validClientId(clientId)) {
          return { ok: false, error: 'clientId is required when unbinding a tab.' };
        }
        const prevConvs = [];
        for (const [convId, b] of conversationBindings) {
          let matched = false;
          if (b.workbenchClientId === clientId) {
            b.workbenchClientId = null;
            b.workbenchLive = false;
            matched = true;
          }
          if (b.launcherClientId === clientId) {
            b.launcherClientId = null;
            b.launcherLive = false;
            matched = true;
          }
          if (matched) {
            prevConvs.push(convId);
            if (!b.workbenchClientId && !b.launcherClientId) {
              conversationBindings.delete(convId);
            } else {
              recomputeBindingSummary(b, now);
            }
          }
        }
        const c = clients.get(clientId);
        if (c) {
          if (c.conversationId) suppressedConvForClient.set(clientId, c.conversationId);
          c.conversationId = null;
        } else if (prevConvs[0]) {
          suppressedConvForClient.set(clientId, prevConvs[0]);
        }
        return {
          ok: true,
          claimed: false,
          unclaimed: true,
          clientId,
          conversationId: null,
          removedConversations: prevConvs,
          affectedClientIds: [clientId],
        };
      }

      if (!validConversationId(conversationId)) {
        return { ok: false, error: 'A valid conversationId is required to pair a tab.' };
      }

      let resolvedClientId = validClientId(clientId) ? clientId : null;
      if (resolvedClientId) {
        if (!isClientLiveRaw(resolvedClientId, now)) {
          return {
            ok: false,
            error: `TOPOGEN browser tab "${resolvedClientId}" is not currently connected.`,
            clients: formatClientSummaryList(),
          };
        }
      } else if (claimFocusedChrome) {
        const chromeCandidates = [];
        for (const [, c] of clients) {
          if (!isClientLiveRaw(c.clientId, now)) continue;
          if (c.browserKind !== 'chrome') continue;
          if ((c.surface || 'workbench') !== targetSurface) continue;
          chromeCandidates.push(c);
        }
        chromeCandidates.sort(compareClientRecordsDesc);
        if (!chromeCandidates.length) {
          return {
            ok: false,
            error: `No live Google Chrome ${targetSurface} tab is currently connected. Launch Chrome first via topogen_ui_launch.`,
            clients: formatClientSummaryList(),
          };
        }
        resolvedClientId = chromeCandidates[0].clientId;
      } else {
        return {
          ok: false,
          error: 'Provide either clientId or claimFocusedChrome: true to pair a tab.',
          clients: formatClientSummaryList(),
        };
      }

      const c = clients.get(resolvedClientId);
      const effectiveSurface = c?.surface || targetSurface;
      const binding = bindConversationInternal(conversationId, resolvedClientId, { surface: effectiveSurface });
      return {
        ok: true,
        claimed: true,
        clientId: resolvedClientId,
        conversationId,
        surface: effectiveSurface,
        browserKind: c?.browserKind || 'other',
        url: c?.url || null,
        affectedClientIds: binding?.affectedClientIds || [resolvedClientId],
      };
    },

    findReuseCandidate({ conversationId = null, surface = 'workbench', adoptUnbound = true } = {}) {
      pruneClients();
      const now = Date.now();
      const targetSurface = VALID_SURFACES.has(surface) ? surface : 'workbench';

      if (validConversationId(conversationId)) {
        const binding = conversationBindings.get(conversationId);
        const slot = getBindingSurfaceSlot(binding, targetSurface, now);
        if (slot.live && slot.clientId) {
          const bc = clients.get(slot.clientId);
          if (
            bc &&
            bc.browserKind === 'chrome' &&
            (bc.bridgeVersion || 1) >= BRIDGE_PROTOCOL_VERSION &&
            (bc.surface || 'workbench') === targetSurface
          ) {
            return bc;
          }
        }

        for (const [, c] of clients) {
          if (!isClientLiveRaw(c.clientId, now)) continue;
          if (c.browserKind !== 'chrome') continue;
          if ((c.bridgeVersion || 1) < BRIDGE_PROTOCOL_VERSION) continue;
          if ((c.surface || 'workbench') !== targetSurface) continue;
          const boundConv = getBoundConversation(c.clientId);
          if (boundConv && boundConv !== conversationId) continue;
          if (c.conversationId === conversationId) {
            return c;
          }
        }

        if (adoptUnbound) {
          const unbound = getUnboundLiveChromeTabs(targetSurface, conversationId)
            .filter(c => (c.bridgeVersion || 1) >= BRIDGE_PROTOCOL_VERSION);
          if (unbound.length === 1) {
            return unbound[0];
          }
        }
        return null;
      }

      const chromeTabs = [];
      for (const [, c] of clients) {
        if (!isClientLiveRaw(c.clientId, now)) continue;
        if (c.browserKind !== 'chrome') continue;
        if ((c.bridgeVersion || 1) < BRIDGE_PROTOCOL_VERSION) continue;
        if ((c.surface || 'workbench') !== targetSurface) continue;
        chromeTabs.push(c);
      }
      chromeTabs.sort(compareClientRecordsDesc);
      return chromeTabs[0] || null;
    },

    hasCandidateForConversation(conversationId = null, surface = 'workbench') {
      pruneClients();
      const now = Date.now();
      const targetSurface = VALID_SURFACES.has(surface) ? surface : 'workbench';
      if (validConversationId(conversationId)) {
        const binding = conversationBindings.get(conversationId);
        const slot = getBindingSurfaceSlot(binding, targetSurface, now);
        if (slot.live && slot.clientId) {
          const bc = clients.get(slot.clientId);
          if (bc && isRealBrowserKind(bc.browserKind) && (bc.surface || 'workbench') === targetSurface) {
            return true;
          }
        }
        for (const [, c] of clients) {
          if (!isClientLiveRaw(c.clientId, now)) continue;
          if (!isRealBrowserKind(c.browserKind)) continue;
          if ((c.surface || 'workbench') !== targetSurface) continue;
          if (c.conversationId === conversationId) return true;
        }
        const unboundChrome = getUnboundLiveChromeTabs(targetSurface, conversationId);
        return unboundChrome.length > 0;
      }
      for (const [, c] of clients) {
        if (!isClientLiveRaw(c.clientId, now)) continue;
        if (!isRealBrowserKind(c.browserKind)) continue;
        if ((c.surface || 'workbench') === targetSurface) return true;
      }
      return false;
    },

    async pingClient(clientId, timeoutMs = 1500) {
      if (!validClientId(clientId) || !isClientLiveRaw(clientId)) {
        return { ok: false, error: 'Client offline' };
      }
      const c = clients.get(clientId);
      if (c && (c.bridgeVersion || 1) < BRIDGE_PROTOCOL_VERSION) {
        return { ok: false, staleBridge: true, error: 'Stale bridge version' };
      }
      try {
        const res = await sendRaw('ping', {}, Math.max(300, Math.min(5000, Number(timeoutMs) || 1500)), clientId);
        return { ok: true, response: res };
      } catch (err) {
        return { ok: false, error: err?.message || String(err) };
      }
    },

    getBoundConversation,

    listTabs({ surface = null, conversationId = null } = {}) {
      const targetSurface = (surface && VALID_SURFACES.has(surface)) ? surface : null;
      const clientList = formatClientSummaryList(targetSurface);
      const bindingsList = formatBindingsList();
      const chromeWorkbenchCount = clientList.filter(
        c => c.browserKind === 'chrome' && c.surface === 'workbench'
      ).length;
      const activeBinding = validConversationId(conversationId)
        ? (bindingsList.find(b => b.conversationId === conversationId) || null)
        : null;
      return {
        bridgeVersion: BRIDGE_PROTOCOL_VERSION,
        connected: waiters.length > 0 || clientList.length > 0,
        clientCount: clientList.length,
        chromeWorkbenchCount,
        preferredClientId,
        ...(conversationId ? { conversationId, activeBinding } : {}),
        clients: clientList,
        bindings: bindingsList,
      };
    },

    poll(timeoutMs = 12000, clientId = 'default', visibleOrMeta = true) {
      const meta = (visibleOrMeta && typeof visibleOrMeta === 'object')
        ? visibleOrMeta
        : { visible: Boolean(visibleOrMeta) };
      clientPollSeq.set(clientId, (clientPollSeq.get(clientId) || 0) + 1);
      const updated = updateClientMeta(clientId, meta);
      if (updated.focused && updated.visible) {
        const pref = preferredClientId ? clients.get(preferredClientId) : null;
        const canPromote = isRealBrowserKind(updated.browserKind) || !pref || !isRealBrowserKind(pref.browserKind);
        if (canPromote && (!pref || !pref.focused || updated.lastFocusedAt >= (pref.lastFocusedAt || 0))) {
          preferredClientId = clientId;
        }
      }

      if (queue.length) {
        const qIdx = queue.findIndex(task => {
          if (task.targetClientId) return task.targetClientId === clientId;
          return (
            isRealBrowserKind(updated.browserKind) &&
            (
              !preferredClientId ||
              clientId === preferredClientId ||
              !clients.has(preferredClientId) ||
              Date.now() - clients.get(preferredClientId).lastSeenAt >= 5000
            )
          );
        });
        if (qIdx >= 0) {
          const task = queue.splice(qIdx, 1)[0];
          const pendingEntry = pending.get(task.id);
          if (pendingEntry) {
            pendingEntry.dispatchedToClientId = clientId;
          }
          const { targetClientId: _ignored, ...wireTask } = task;
          return Promise.resolve(wireTask);
        }
      }

      return new Promise(resolve => {
        const entry = {
          clientId,
          visible: updated.visible,
          focused: updated.focused,
          lastFocusedAt: updated.lastFocusedAt,
          enqueuedAt: Date.now(),
          deliver: task => {
            clearTimeout(timer);
            const i = waiters.indexOf(entry);
            if (i >= 0) waiters.splice(i, 1);
            resolve(task);
          },
          cancel: () => {
            clearTimeout(timer);
            resolve(null);
          },
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
        updateClientMeta(body.clientId, {
          visible: body.visible !== undefined ? Boolean(body.visible) : true,
          focused: body.focused !== undefined ? Boolean(body.focused) : undefined,
          url: body.url,
          surface: body.surface,
          browserKind: body.browserKind,
          userAgent: body.userAgent,
          bridgeVersion: body.bridgeVersion,
          conversationId: body.conversationId ?? body.conv,
        });
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
      const explicitClientId = validClientId(payload?.clientId) ? payload.clientId : null;
      const conversationId = validConversationId(payload?.conversationId) ? payload.conversationId.trim() : null;
      const surface = payload?.surface === 'launcher' ? 'launcher' : 'workbench';
      const allowWebviewFallback = Boolean(payload?.allowWebviewFallback);
      const mutation = MUTATING_ACTIONS.has(action);

      const clientWait = Math.min(4000, Math.max(200, Number(timeoutMs) || 4000));
      const decision = await waitForRoutedClient(clientWait, {
        explicitClientId,
        conversationId,
        surface,
        mutation,
        allowWebviewFallback,
      });

      if (!decision.ok || !decision.targetClientId) {
        const clientList = formatClientSummaryList();
        let message;
        if (explicitClientId) {
          message = `TOPOGEN browser tab "${explicitClientId}" is not currently connected.`;
        } else if (conversationId) {
          message = `No Google Chrome TOPOGEN ${surface} tab is paired to conversation "${conversationId}". Call topogen_ui_launch({ conversationId: "${conversationId}" }) to open Chrome.`;
        } else {
          message = 'Open the TOPOGEN 3D Workbench in Google Chrome (or call topogen_ui_launch) so the MCP bridge can inspect and update the live canvas.';
        }
        return {
          available: false,
          code: explicitClientId ? 'CLIENT_OFFLINE' : 'NO_CHROME_TAB',
          ...(conversationId ? { conversationId } : {}),
          ...(explicitClientId ? { clientId: explicitClientId } : {}),
          clients: clientList,
          message,
          source: 'live-browser-renderer',
          ecosystem: resolvedEco,
        };
      }

      let targetClientId = decision.targetClientId;
      const targetClient = clients.get(targetClientId);

      // C5: Stale pre-upgrade bridge version check
      if (targetClient && (targetClient.bridgeVersion || 1) < BRIDGE_PROTOCOL_VERSION) {
        const reloadId = `reload_${Date.now()}`;
        let reloadAck = null;
        try {
          reloadAck = await sendRaw('__reload__', {}, 1200, targetClientId, reloadId);
        } catch {
          // Pre-v2 bridge scripts throw Unsupported UI bridge action: __reload__
        }
        if (reloadAck?.reloading) {
          const refreshed = await waitForRoutedClient(2500, {
            explicitClientId,
            conversationId,
            surface,
            mutation,
            allowWebviewFallback,
            minBridgeVersion: BRIDGE_PROTOCOL_VERSION,
          }).catch(() => null);
          const refreshedClient = refreshed?.targetClientId ? clients.get(refreshed.targetClientId) : null;
          if (refreshedClient && (refreshedClient.bridgeVersion || 1) >= BRIDGE_PROTOCOL_VERSION) {
            targetClientId = refreshed.targetClientId;
          } else {
            return {
              ok: false,
              available: false,
              staleBridge: true,
              reloading: true,
              clientId: targetClientId,
              bridgeVersion: targetClient.bridgeVersion || 1,
              requiredBridgeVersion: BRIDGE_PROTOCOL_VERSION,
              message: `Browser tab "${targetClientId}" had stale UI bridge v${targetClient.bridgeVersion || 1} and is reloading to v${BRIDGE_PROTOCOL_VERSION}; retry in a moment.`,
              source: 'live-browser-renderer',
              ecosystem: resolvedEco,
            };
          }
        } else {
          return {
            ok: false,
            available: false,
            staleBridge: true,
            reloading: false,
            clientId: targetClientId,
            bridgeVersion: targetClient.bridgeVersion || 1,
            requiredBridgeVersion: BRIDGE_PROTOCOL_VERSION,
            message: `Browser tab "${targetClientId}" is running stale pre-upgrade UI bridge v${targetClient.bridgeVersion || 1} (requires v${BRIDGE_PROTOCOL_VERSION}). Press F5 / refresh the Chrome tab once or call topogen_ui_launch({ newTab: true }).`,
            source: 'live-browser-renderer',
            ecosystem: resolvedEco,
          };
        }
      }

      if (action === 'reload') {
        const waitMs = Math.max(500, Math.min(30000, Number(payload?.waitMs ?? timeoutMs) || 10000));
        const preserveState = payload?.preserveState !== false;
        const hardReload = payload?.hardReload !== false;
        if (payload?.discardPending === true) {
          discardPendingForClient(targetClientId, {
            actionFilter: null,
            releaseBusy: true,
            reason: `Pending UI task on tab "${targetClientId}" discarded before reload.`,
          });
        }
        if (busyClients.has(targetClientId)) {
          throw Error(`A live UI operation is already in progress on tab "${targetClientId}"; wait for it to finish.`);
        }
        const lockToken = crypto.randomUUID();
        busyClients.set(targetClientId, { token: lockToken, action: 'reload' });
        const reloadStartedAt = Date.now();
        const deadline = reloadStartedAt + waitMs;
        const preReloadPollSeq = clientPollSeq.get(targetClientId) || 0;
        try {
          let reloadAck = null;
          const reloadPayload = {
            ...(payload && typeof payload === 'object' ? payload : {}),
            preserveState,
            hardReload,
            waitMs,
          };
          try {
            reloadAck = await sendRaw('reload', reloadPayload, Math.min(3000, waitMs), targetClientId);
          } catch (err) {
            const msg = String(err?.message || err);
            if (!/disconnected/i.test(msg)) {
              throw err;
            }
            reloadAck = { ok: true, reloading: true, disconnectedDuringReload: true };
          }
          if (reloadAck && reloadAck.ok === false) {
            return {
              ok: false,
              available: false,
              reloaded: false,
              clientId: targetClientId,
              error: reloadAck.error || 'Browser tab declined reload request.',
              source: 'live-browser-renderer',
              ecosystem: resolvedEco,
            };
          }

          // Wait for the same clientId to re-enter /api/ui-bridge/poll with bridgeVersion >= 2
          let reconnectedClient = null;
          while (Date.now() < deadline) {
            const curSeq = clientPollSeq.get(targetClientId) || 0;
            const c = clients.get(targetClientId);
            if (
              curSeq > preReloadPollSeq &&
              c &&
              (c.bridgeVersion || 1) >= BRIDGE_PROTOCOL_VERSION &&
              isClientLiveRaw(targetClientId)
            ) {
              reconnectedClient = c;
              break;
            }
            await new Promise(r => setTimeout(r, 40));
          }

          if (!reconnectedClient) {
            return {
              ok: false,
              available: false,
              reloaded: false,
              code: 'RELOAD_TIMEOUT',
              clientId: targetClientId,
              error: `Browser tab "${targetClientId}" did not re-enter /api/ui-bridge/poll with bridgeVersion >= ${BRIDGE_PROTOCOL_VERSION} within ${waitMs}ms after reload.`,
              source: 'live-browser-renderer',
              ecosystem: resolvedEco,
            };
          }

          // Verify post-reload inspect readiness within remaining waitMs
          let inspectRes = null;
          let lastInspectErr = null;
          while (Date.now() < deadline) {
            const remMs = Math.max(250, deadline - Date.now());
            try {
              const candidate = await sendRaw(
                'inspect',
                {
                  clientId: targetClientId,
                  ...(conversationId ? { conversationId } : {}),
                },
                Math.min(remMs, 4000),
                targetClientId
              );
              if (candidate && candidate.available !== false && candidate.ok !== false) {
                inspectRes = candidate;
                break;
              }
              lastInspectErr = candidate?.error || 'Workbench not yet ready after reload';
            } catch (err) {
              lastInspectErr = err?.message || String(err);
            }
            if (Date.now() + 120 >= deadline) break;
            await new Promise(r => setTimeout(r, 120));
          }

          if (!inspectRes) {
            return {
              ok: false,
              available: false,
              reloaded: true,
              ready: false,
              code: 'RELOAD_INSPECT_TIMEOUT',
              clientId: targetClientId,
              error: `Browser tab "${targetClientId}" reconnected after reload, but inspect readiness did not succeed within ${waitMs}ms (${lastInspectErr || 'timeout'}).`,
              source: 'live-browser-renderer',
              ecosystem: resolvedEco,
            };
          }

          const boundConv = getBoundConversation(targetClientId);
          return {
            ok: true,
            reloaded: true,
            ready: true,
            available: true,
            preserveState,
            hardReload,
            clientId: targetClientId,
            ...(boundConv ? { boundConversationId: boundConv } : {}),
            bridgeVersion: reconnectedClient.bridgeVersion || BRIDGE_PROTOCOL_VERSION,
            elapsedMs: Date.now() - reloadStartedAt,
            stateRestored: Boolean(inspectRes.restoredFromReload ?? inspectRes.stateRestored ?? reloadAck?.stateSnapshotted ?? false),
            state: inspectRes,
            source: 'live-browser-renderer',
            ecosystem: resolvedEco,
          };
        } finally {
          if (busyClients.get(targetClientId)?.token === lockToken) {
            busyClients.delete(targetClientId);
          }
        }
      }

      const discardPending = Boolean(payload?.discardPending);
      const replaceLoad = action === 'load_file' && payload?.replace !== false;
      if (discardPending) {
        discardPendingForClient(targetClientId, {
          actionFilter: null,
          releaseBusy: true,
          reason: `Pending UI task on tab "${targetClientId}" discarded by caller.`,
        });
      } else if (replaceLoad) {
        const curBusy = busyClients.get(targetClientId);
        const hasPendingLoad = Array.from(pending.values()).some(
          e => (e.targetClientId === targetClientId || e.dispatchedToClientId === targetClientId) && e.action === 'load_file'
        ) || queue.some(q => q.targetClientId === targetClientId && q.action === 'load_file');
        if (hasPendingLoad || curBusy?.action === 'load_file') {
          discardPendingForClient(targetClientId, {
            actionFilter: 'load_file',
            releaseBusy: curBusy?.action === 'load_file',
            reason: `Previous load_file on tab "${targetClientId}" superseded by replace: true.`,
          });
        }
      }

      if (mutation && busyClients.has(targetClientId)) {
        throw Error(`A live UI operation is already in progress on tab "${targetClientId}"; wait for it to finish.`);
      }
      const lockToken = mutation ? crypto.randomUUID() : null;
      if (mutation) busyClients.set(targetClientId, { token: lockToken, action });
      try {
        const capMs = action === 'ping' ? 5000
          : action === 'inspect' ? 15000
          : action === 'configure' ? 30000
          : action === 'load_file' ? 45000
          : action === 'export' ? 45000
          : 60000;
        const boundMs = Math.min(Math.max(300, Number(timeoutMs) || capMs), capMs);
        const response = await sendRaw(action, payload, boundMs, targetClientId);
        const boundConv = getBoundConversation(targetClientId);
        return {
          ...(response && typeof response === 'object' ? response : { value: response }),
          clientId: response?.clientId || targetClientId,
          ...(boundConv ? { boundConversationId: boundConv } : {}),
          ...(decision.ambiguousTabs ? { ambiguousTabs: true } : {}),
          available: response?.available !== false,
          source: 'live-browser-renderer',
          ecosystem: resolvedEco,
        };
      } finally {
        if (mutation && busyClients.get(targetClientId)?.token === lockToken) {
          busyClients.delete(targetClientId);
        }
      }
    },

    discardPending(clientId, opts = {}) {
      return discardPendingForClient(clientId, opts);
    },

    status() {
      const clientList = formatClientSummaryList();
      const bindingsList = formatBindingsList();
      return {
        bridgeVersion: BRIDGE_PROTOCOL_VERSION,
        connected: waiters.length > 0 || clientList.length > 0,
        clientCount: clientList.length,
        chromeWorkbenchCount: clientList.filter(c => c.browserKind === 'chrome' && c.surface === 'workbench').length,
        waiterCount: waiters.length,
        pendingCount: pending.size,
        preferredClientId,
        busy: busyClients.size > 0,
        busyClientIds: Array.from(busyClients.keys()),
        ecosystem: resolvedEco,
        clients: clientList,
        bindings: bindingsList,
      };
    },
  };
}

/**
 * WFC-FDM Foundry — Browser UI Bridge Client v2 (ui/bridge/mcp_ui_bridge.js)
 *
 * Same-origin long-poll client connecting the 3D Workbench (`window.WFC_WORKBENCH`)
 * and Campaign Launcher (`window.FOUNDRY_LAUNCHER`) to `foundry_server.mjs`
 * (`/api/ui-bridge/poll`, `/api/ui-bridge/focus`, `/api/ui-bridge/reply`,
 * `/api/ui-bridge/disconnect`, `/api/ui-bridge/tabs`, `/api/ui-bridge/claim`).
 *
 * Protocol v2 Capabilities:
 *   - Reload-stable + Duplicate-safe Tab Identity (`window.name` + `sessionStorage`
 *     + `BroadcastChannel('topogen_ui_bridge_v2')` duplicate-tab disambiguation).
 *   - Clean `?conv=<conversationId>&launch=<launchId>` URL handshake (`launch` stripped
 *     via `history.replaceState` while preserving `?conv=` across reloads & bookmarks).
 *   - Deterministic `browserKind` detection (`chrome`, `edge`, `webview`, `headless`, `other`).
 *   - Full client metadata on every poll/focus/reply + `0ms` `sendBeacon` disconnect.
 *   - Studio-Light Live Connection & Pairing HUD (`#mcp-bridge-pill` + `#mcp-bridge-popover`).
 *   - Graceful No-Op on `file://` or static servers (`serve_lab.mjs`) with no bridge token.
 */

export const BRIDGE_VERSION = 2;

const WINDOW_NAME_PREFIX = '__topogen_tab_v2__:';
const SESSION_STORAGE_KEY = '__topogen_tab_v2__';
const RELOAD_SNAPSHOT_PREFIX = '__topogen_reload_snapshot_v1__:';
const MAX_RELOAD_SNAPSHOT_BYTES = 512 * 1024;
const BROADCAST_CHANNEL_NAME = 'topogen_ui_bridge_v2';
const MAX_EXPORT_DATA_BYTES = Math.floor(3.5 * 1024 * 1024);

let lastFocusedAt = Date.now();

function byId(id) {
    return typeof document !== 'undefined' ? document.getElementById(id) : null;
}

function setInputVal(id, value) {
    const el = byId(id);
    if (!el) return false;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}

function setCheckboxVal(id, checked) {
    const el = byId(id);
    if (!el) return false;
    const next = Boolean(checked);
    if (el.checked !== next) {
        el.checked = next;
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
}

function base64ToUint8Array(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function waitMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function triggerTextDownload(text, fileName, mimeType = 'text/plain') {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = fileName;
    document.body.appendChild(aEl);
    aEl.click();
    document.body.removeChild(aEl);
    URL.revokeObjectURL(url);
    return true;
}

function boundExportString(rawText, maxBytes = MAX_EXPORT_DATA_BYTES) {
    const str = typeof rawText === 'string' ? rawText : '';
    const totalBytes = typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(str).byteLength
        : str.length;
    if (totalBytes <= maxBytes) {
        return { data: str, bytes: totalBytes, truncated: false };
    }
    let sliced = str.slice(0, maxBytes);
    if (typeof TextEncoder !== 'undefined') {
        const enc = new TextEncoder();
        while (sliced.length > 0 && enc.encode(sliced).byteLength > maxBytes) {
            sliced = sliced.slice(0, Math.floor(sliced.length * 0.92));
        }
    }
    return { data: sliced, bytes: totalBytes, truncated: true };
}

export function detectBrowserKind(userAgentOverride, webdriverOverride) {
    const ua = typeof userAgentOverride === 'string'
        ? userAgentOverride
        : (typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '');
    const isWebdriver = webdriverOverride !== undefined
        ? Boolean(webdriverOverride)
        : Boolean(typeof navigator !== 'undefined' && navigator.webdriver);

    if (isWebdriver || /HeadlessChrome/i.test(ua)) {
        return 'headless';
    }

    let inFrame = false;
    if (userAgentOverride === undefined && typeof window !== 'undefined') {
        try {
            inFrame = window.top !== window.self;
        } catch {
            inFrame = true;
        }
    }
    if (/Electron|VSCode|Antigravity|wv\)/i.test(ua) || inFrame) {
        return 'webview';
    }
    if (/Chrome\//.test(ua) && !/Edg\/|OPR\/|Brave/i.test(ua)) {
        return 'chrome';
    }
    if (/Edg\//.test(ua)) {
        return 'edge';
    }
    return 'other';
}

function formatBrowserDisplay(browserKind) {
    switch (browserKind) {
        case 'chrome': return 'Chrome';
        case 'edge': return 'Edge';
        case 'webview': return 'Webview';
        case 'headless': return 'Headless';
        default: return 'Browser';
    }
}

function shortId(raw, maxChars = 6) {
    const s = String(raw || '').trim();
    if (!s) return '';
    if (s.length <= maxChars + 2) return s;
    return s.slice(0, maxChars);
}

function validTabIdForSurface(tabId, surface) {
    if (typeof tabId !== 'string' || !/^[a-zA-Z0-9_-]{4,80}$/.test(tabId)) return false;
    const expectedPrefix = surface === 'launcher' ? 'ln_' : 'wb_';
    return tabId.startsWith(expectedPrefix);
}

function mintTabId(surface = 'workbench') {
    const prefix = surface === 'launcher' ? 'ln' : 'wb';
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function readStoredIdentity() {
    let fromWindowName = null;
    let fromSession = null;
    if (typeof window !== 'undefined') {
        try {
            if (typeof window.name === 'string' && window.name.startsWith(WINDOW_NAME_PREFIX)) {
                fromWindowName = JSON.parse(window.name.slice(WINDOW_NAME_PREFIX.length));
            }
        } catch {
            fromWindowName = null;
        }
        try {
            const raw = window.sessionStorage?.getItem(SESSION_STORAGE_KEY);
            if (raw) fromSession = JSON.parse(raw);
        } catch {
            fromSession = null;
        }
    }
    return { fromWindowName, fromSession };
}

function writeStoredIdentity(tabId, conversationId, surface) {
    if (typeof window === 'undefined') return;
    const record = JSON.stringify({
        tabId,
        conversationId: conversationId || null,
        surface,
    });
    try {
        window.name = `${WINDOW_NAME_PREFIX}${record}`;
    } catch {
        // Ignore restricted window.name environments
    }
    try {
        window.sessionStorage?.setItem(SESSION_STORAGE_KEY, record);
    } catch {
        // Ignore restricted sessionStorage environments
    }
}

function syncAddressBarParams(conversationId, stripLaunch = true) {
    if (typeof window === 'undefined' || !window.history || typeof window.history.replaceState !== 'function') {
        return;
    }
    try {
        const urlObj = new URL(window.location.href);
        let changed = false;
        if (stripLaunch) {
            if (urlObj.searchParams.has('launch')) {
                urlObj.searchParams.delete('launch');
                changed = true;
            }
            if (urlObj.searchParams.has('launchId')) {
                urlObj.searchParams.delete('launchId');
                changed = true;
            }
            if (urlObj.searchParams.has('_r')) {
                urlObj.searchParams.delete('_r');
                changed = true;
            }
        }
        if (urlObj.searchParams.has('conversationId')) {
            urlObj.searchParams.delete('conversationId');
            changed = true;
        }
        const cleanConv = typeof conversationId === 'string' && conversationId.trim().length > 0
            ? conversationId.trim()
            : null;
        if (cleanConv) {
            if (urlObj.searchParams.get('conv') !== cleanConv) {
                urlObj.searchParams.set('conv', cleanConv);
                changed = true;
            }
        } else if (urlObj.searchParams.has('conv')) {
            urlObj.searchParams.delete('conv');
            changed = true;
        }
        if (changed) {
            const nextRel = `${urlObj.pathname}${urlObj.search}${urlObj.hash}`;
            window.history.replaceState(window.history.state, '', nextRel);
        }
    } catch {
        // Ignore URL rewrite errors
    }
}

async function waitForOverlayHidden(timeoutMs = 20000) {
    const t0 = Date.now();
    await waitMs(40);
    while (Date.now() - t0 < timeoutMs) {
        const overlay = byId('loading-overlay');
        if (!overlay || overlay.classList.contains('hidden')) {
            await waitMs(40);
            return;
        }
        await waitMs(60);
    }
}

function readVoxelPinsFromState(st) {
    if (!st) return [];
    if (st._voxelPinApi && typeof st._voxelPinApi.getVoxelPins === 'function') {
        try {
            return st._voxelPinApi.getVoxelPins();
        } catch {
            // Fall through to raw map read
        }
    }
    if (st.voxelPins instanceof Map) {
        return Array.from(st.voxelPins.values()).map(p => ({
            x: p.x,
            y: p.y,
            z: p.z,
            tile: p.tileId === 0 ? 'null' : p.tileId,
            tileId: p.tileId,
        }));
    }
    return [];
}

function inspectWorkbench(wb, bridgeMeta = {}) {
    if (!wb) {
        return {
            ok: false,
            available: false,
            clientId: bridgeMeta.clientId || null,
            conversationId: bridgeMeta.conversationId || null,
            browserKind: bridgeMeta.browserKind || null,
            surface: bridgeMeta.surface || 'workbench',
            bridgeVersion: BRIDGE_VERSION,
            error: 'window.WFC_WORKBENCH is not initialized',
        };
    }
    const st = wb.state || {};
    const graph = wb.weldedGraph || st.lastWeldedGraph || null;
    const fdm = wb.fdmResult || st.lastFDMResult || null;
    const solid = wb.solidData || st.lastSolidData || null;
    const fea = wb.feaResult || st.lastFEAResult || null;
    const elasticaData = st.lastElasticaData || null;
    const voxelPins = readVoxelPinsFromState(st);
    const solidFaceCount = solid
        ? (Array.isArray(solid.faces)
            ? solid.faces.length
            : ((Array.isArray(solid.quads) ? solid.quads.length : 0) +
               (Array.isArray(solid.triangles) ? solid.triangles.length : 0)))
        : 0;

    return {
        ok: true,
        available: true,
        bridgeVersion: BRIDGE_VERSION,
        clientId: bridgeMeta.clientId || null,
        conversationId: bridgeMeta.conversationId || null,
        browserKind: bridgeMeta.browserKind || null,
        surface: bridgeMeta.surface || 'workbench',
        executionMode: bridgeMeta.executionMode || 'A',
        busy: Boolean(bridgeMeta.busy),
        restoredFromReload: Boolean(bridgeMeta.restoredFromReload),
        url: typeof window !== 'undefined' ? window.location.href : null,
        visible: typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
        focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : false,
        lastFocusedAt,
        activeTab: wb.activeTab || st.activeTabId || null,
        algorithm: wb.algorithm || st.currentAlgorithm || null,
        gridResolution: wb.gridResolution || { x: st.GRID_X, y: st.GRID_Y, z: st.GRID_Z },
        voxelSize: wb.voxelSize ?? st.VOXEL_SIZE ?? null,
        ccSubdivLevel: st.ccSubdivLevel ?? null,
        skeletonizeMeshTile: Boolean(st.skeletonizeMeshTile),
        voxelPinCount: voxelPins.length,
        voxelPins: voxelPins.slice(0, 200),
        customTileBadge: byId('custom-tile-badge')?.textContent?.trim() || null,
        meshModuleFeedback: byId('mesh-module-feedback')?.textContent?.trim() || null,
        meshOnlyTileBadge: byId('mesh-only-tile-badge')?.textContent?.trim() || null,
        meshOnlyTileFeedback: byId('mesh-only-tile-feedback')?.textContent?.trim() || null,
        goldilocksMode: wb.goldilocksMode || st.goldilocksMode || 'H1',
        arctic: typeof wb.arctic === 'function' ? wb.arctic() : Boolean(st.arcticOn),
        fdmMode: st.fdmState?.mode || null,
        tubeRadiusM: st.tubeState?.radius ?? null,
        tubeInnerRadiusM: st.tubeState?.innerRadiusM ?? st.tubeState?.innerRadius ?? null,
        graph: graph ? {
            vertices: Array.isArray(graph.vertices) ? graph.vertices.length : 0,
            edges: Array.isArray(graph.edges) ? graph.edges.length : 0,
        } : null,
        fdm: fdm ? {
            vertices: Array.isArray(fdm.vertices) ? fdm.vertices.length : 0,
            edges: Array.isArray(fdm.edges) ? fdm.edges.length : 0,
            anchors: Array.isArray(fdm.anchors) ? fdm.anchors.length : 0,
        } : null,
        solid: solid ? {
            vertices: Array.isArray(solid.vertices) ? solid.vertices.length : 0,
            faces: solidFaceCount,
            maxPlanarityError: solid.maxPlanarityError ?? solid.planarity?.maxQuadPlanarityErrorM ?? solid.planarity?.maxError ?? null,
        } : null,
        pq: {
            selectedLoopId: st.faceLoopState?.selectedLoopId ?? null,
            selectedLoopIdx: st.faceLoopState?.selectedLoopIdx ?? null,
            loopCount: Array.isArray(st.faceLoopState?.loops) ? st.faceLoopState.loops.length : 0,
            colorMode: st.tubeState?.colorMode ?? null,
        },
        elastica: {
            status: byId('elastica-status-badge')?.textContent?.trim() || null,
            sourceSink: byId('elastica-ss-badge')?.textContent?.trim() || null,
            sourceSinkList: byId('elastica-ss-list')?.textContent?.trim() || null,
            readout: byId('elastica-readout')?.textContent?.trim() || null,
            curveCount: Array.isArray(elasticaData?.curves) ? elasticaData.curves.length : 0,
        },
        fea: {
            hasResult: Boolean(fea),
            passed: fea ? (fea.passed ?? null) : null,
            maxDispMm: fea ? (fea.displacements?.maxDispMm ?? fea.maxDispMm ?? null) : null,
            animating: Boolean(st.feaState?.animate),
            deflectionScale: st.feaState?.exaggeration ?? null,
            loadCase: st.feaState?.loadCase ?? null,
            materialKey: st.feaState?.materialKey ?? null,
            restraintType: st.feaState?.restraintType ?? null,
            visMode: st.feaState?.visMode ?? null,
            excludeGraph: Boolean(st.feaState?.excludeGraph),
            includeElastica: Boolean(st.feaState?.includeElastica),
            elasticaMaterialKey: st.feaState?.elasticaMaterialKey ?? null,
        },
    };
}

function inspectLauncher(bridgeMeta = {}) {
    const launcher = typeof window !== 'undefined' ? window.FOUNDRY_LAUNCHER : null;
    const st = launcher?.appState || null;
    return {
        ok: Boolean(launcher),
        available: Boolean(launcher),
        bridgeVersion: BRIDGE_VERSION,
        clientId: bridgeMeta.clientId || null,
        conversationId: bridgeMeta.conversationId || null,
        browserKind: bridgeMeta.browserKind || null,
        surface: 'launcher',
        executionMode: st?.executionMode || bridgeMeta.executionMode || 'A',
        url: typeof window !== 'undefined' ? window.location.href : null,
        visible: typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true,
        focused: typeof document !== 'undefined' && typeof document.hasFocus === 'function' ? document.hasFocus() : false,
        lastFocusedAt,
        activeTab: st?.activeTab || null,
        currentRunId: st?.currentRunId || null,
        candidateCount: Array.isArray(st?.currentCandidates) ? st.currentCandidates.length : 0,
    };
}

function applyElasticaConfig(elCfg, applied) {
    if (!elCfg || typeof elCfg !== 'object') return;

    if (elCfg.pairMode && setInputVal('sel-elastica-pair-mode', elCfg.pairMode)) {
        applied.push('elastica.pairMode');
    }
    if (elCfg.solver && setInputVal('sel-elastica-smooth-mode', elCfg.solver)) {
        applied.push('elastica.solver');
    }
    if (elCfg.smooth !== undefined && setInputVal('rng-elastica-subdiv', elCfg.smooth)) {
        applied.push('elastica.smooth');
    }
    if (elCfg.tightness !== undefined && setInputVal('rng-elastica-tightness', elCfg.tightness)) {
        applied.push('elastica.tightness');
    }
    if (elCfg.rodRadius !== undefined && setInputVal('rng-elastica-radius', elCfg.rodRadius)) {
        applied.push('elastica.rodRadius');
    }
    if (elCfg.rodSides !== undefined && setInputVal('rng-elastica-sides', elCfg.rodSides)) {
        applied.push('elastica.rodSides');
    }
    if (elCfg.showLeaves !== undefined && setCheckboxVal('chk-elastica-show-leaves', elCfg.showLeaves)) {
        applied.push('elastica.showLeaves');
    }
    if (elCfg.showSkeletal !== undefined && setCheckboxVal('chk-elastica-show-skeletal', elCfg.showSkeletal)) {
        applied.push('elastica.showSkeletal');
    }
    if (elCfg.showCurves !== undefined && setCheckboxVal('chk-elastica-show-curves', elCfg.showCurves)) {
        applied.push('elastica.showCurves');
    }
    if (elCfg.showRods !== undefined && setCheckboxVal('chk-elastica-show-rods', elCfg.showRods)) {
        applied.push('elastica.showRods');
    }

    if (elCfg.clearSelection || elCfg.sources?.clear || elCfg.sinks?.clear) {
        const btnClear = byId('btn-el-clear-ss');
        if (btnClear) {
            btnClear.click();
            applied.push('elastica.clearSelection');
        }
    }

    const applyRole = (role, spec) => {
        if (!spec || typeof spec !== 'object') return;
        const pickBtn = byId(role === 'source' ? 'btn-elastica-pick-source' : 'btn-elastica-pick-sink');
        if (pickBtn) pickBtn.click();

        if (role === 'source' && spec.top) {
            byId('btn-el-top-sources')?.click();
            applied.push('elastica.sources.top');
        }
        if (role === 'sink' && spec.ground) {
            byId('btn-el-ground-sinks')?.click();
            applied.push('elastica.sinks.ground');
        }
        if (Array.isArray(spec.valencies)) {
            for (const rawV of spec.valencies) {
                const vKey = String(rawV).trim();
                const btn = typeof document !== 'undefined'
                    ? document.querySelector(`button.el-valency-btn[data-el-valency="${vKey}"]`)
                    : null;
                if (btn) {
                    btn.click();
                    applied.push(`elastica.${role}s.v=${vKey}`);
                }
            }
        }
    };

    applyRole('source', elCfg.sources);
    applyRole('sink', elCfg.sinks);

    if (elCfg.unroll3d !== undefined) {
        const stateEl = byId('elastica-unroll-3d-state');
        const isOn = stateEl?.textContent?.trim().toUpperCase() === 'ON';
        if (Boolean(elCfg.unroll3d) !== isOn) {
            byId('btn-toggle-elastica-unroll-3d')?.click();
            applied.push('elastica.unroll3d');
        }
    }
}

function applyCameraConfig(wb, cameraSpec, applied) {
    if (!cameraSpec) return;
    if (cameraSpec === 'fit' && typeof wb.zoomFit === 'function') {
        wb.zoomFit();
        applied.push('camera');
        return;
    }
    if (typeof cameraSpec === 'object' && wb.camera && wb.controls) {
        const cam = wb.camera;
        const ctl = wb.controls;
        if (Array.isArray(cameraSpec.target) && cameraSpec.target.length === 3) {
            ctl.target.set(Number(cameraSpec.target[0]), Number(cameraSpec.target[1]), Number(cameraSpec.target[2]));
        }
        if (Array.isArray(cameraSpec.position) && cameraSpec.position.length === 3) {
            cam.position.set(Number(cameraSpec.position[0]), Number(cameraSpec.position[1]), Number(cameraSpec.position[2]));
            ctl.update();
            applied.push('camera');
            return;
        }
        if (cameraSpec.az !== undefined || cameraSpec.el !== undefined) {
            const tgt = ctl.target.clone();
            const baseDist = Math.max(1.0, cam.position.distanceTo(tgt));
            const r = baseDist * (Number.isFinite(Number(cameraSpec.distScale)) ? Number(cameraSpec.distScale) : 1.0);
            const az = Number.isFinite(Number(cameraSpec.az)) ? Number(cameraSpec.az) : 0.78;
            const el = Number.isFinite(Number(cameraSpec.el)) ? Number(cameraSpec.el) : 0.42;
            cam.position.set(
                tgt.x + r * Math.cos(el) * Math.cos(az),
                tgt.y + r * Math.cos(el) * Math.sin(az),
                tgt.z + r * Math.sin(el)
            );
            ctl.update();
            applied.push('camera');
        }
    }
}

function applyVoxelPinsConfig(wb, payload, applied) {
    const st = wb?.state;
    if (!st) return;
    const pinApi = st._voxelPinApi || null;

    if (payload.clearVoxelPins === true) {
        if (pinApi && typeof pinApi.clearVoxelPins === 'function') {
            pinApi.clearVoxelPins({ redraw: !Array.isArray(payload.voxelPins) || payload.voxelPins.length === 0 });
        } else {
            if (st.voxelPins instanceof Map) st.voxelPins.clear();
            if (Array.isArray(st.voxels)) {
                for (const v of st.voxels) v.pinned = false;
            }
        }
        applied.push('clearVoxelPins');
    }

    if (Array.isArray(payload.voxelPins)) {
        if (pinApi && typeof pinApi.setVoxelPins === 'function') {
            pinApi.setVoxelPins(payload.voxelPins, { replace: Boolean(payload.clearVoxelPins), redraw: true });
        } else {
            if (!(st.voxelPins instanceof Map)) st.voxelPins = new Map();
            const gx = Number(st.GRID_X || 0);
            const gy = Number(st.GRID_Y || 0);
            const gz = Number(st.GRID_Z || 0);
            for (const pin of payload.voxelPins) {
                if (!pin || typeof pin !== 'object') continue;
                const x = Math.round(Number(pin.x));
                const y = Math.round(Number(pin.y));
                const z = Math.round(Number(pin.z));
                if (x < 0 || x >= gx || y < 0 || y >= gy || z < 0 || z >= gz) {
                    throw new Error(`Voxel pin (${pin.x},${pin.y},${pin.z}) out of bounds`);
                }
                const tileId = (pin.tile === null || pin.tile === undefined || String(pin.tile).trim().toLowerCase() === 'null')
                    ? 0
                    : Number(pin.tile);
                st.voxelPins.set(`${x},${y},${z}`, { x, y, z, tileId: Number.isFinite(tileId) ? tileId : 0 });
            }
        }
        applied.push('voxelPins');
    }
}

function applyFeaConfig(wb, feaCfg, applied) {
    if (!feaCfg || typeof feaCfg !== 'object') return;
    const st = wb?.state;
    const feaState = st?.feaState;
    const feaApi = st?._feaApi || null;

    if (feaCfg.excludeGraph !== undefined) {
        const ex = Boolean(feaCfg.excludeGraph);
        if (feaState) feaState.excludeGraph = ex;
        setCheckboxVal('chk-fea-exclude-graph', ex);
        applied.push('fea.excludeGraph');
    }

    if (feaCfg.includeElastica !== undefined) {
        const incEl = Boolean(feaCfg.includeElastica);
        if (feaState) feaState.includeElastica = incEl;
        setCheckboxVal('chk-fea-include-elastica', incEl);
        applied.push('fea.includeElastica');
    }

    const rodMatKey = feaCfg.rodMaterial ?? feaCfg.elasticaMaterialKey;
    if (rodMatKey !== undefined && rodMatKey !== null) {
        const rmk = String(rodMatKey).trim();
        if (rmk) {
            if (feaState) feaState.elasticaMaterialKey = rmk;
            setInputVal('sel-fea-elastica-mat', rmk);
            applied.push('fea.rodMaterial');
        }
    }

    const scaleSpec = feaCfg.deflectionScale ?? feaCfg.exaggeration;
    if (scaleSpec !== undefined) {
        const val = Number(scaleSpec);
        if (Number.isFinite(val) && val > 0) {
            const clamped = Math.max(1, Math.min(200, Math.round(val)));
            if (feaApi && typeof feaApi.setFEADeflectionScale === 'function') {
                feaApi.setFEADeflectionScale(clamped);
            } else if (feaState) {
                feaState.exaggeration = clamped;
            }
            setInputVal('rng-fea-exag', clamped);
            applied.push('fea.deflectionScale');
        }
    }

    if (feaCfg.loadCase !== undefined && feaCfg.loadCase !== null) {
        const lc = String(feaCfg.loadCase).trim();
        if (lc) {
            if (feaApi && typeof feaApi.setFEALoadCase === 'function') {
                feaApi.setFEALoadCase(lc);
            } else if (feaState) {
                feaState.loadCase = lc;
            }
            applied.push('fea.loadCase');
        }
    }

    const matKey = feaCfg.material ?? feaCfg.materialKey;
    if (matKey !== undefined && matKey !== null) {
        if (feaState) feaState.materialKey = String(matKey);
        setInputVal('sel-fea-material', String(matKey));
        applied.push('fea.material');
    }

    if (feaCfg.topLoadKg !== undefined) {
        const kg = Math.max(0, Number(feaCfg.topLoadKg));
        if (Number.isFinite(kg)) {
            if (feaState) feaState.topLoadKg = kg;
            setInputVal('rng-fea-load-kg', Math.min(500, kg));
            setInputVal('num-fea-load-kg', kg);
            applied.push('fea.topLoadKg');
        }
    }

    const restraint = feaCfg.restraintType ?? feaCfg.supports;
    if (restraint !== undefined && restraint !== null) {
        const rStr = String(restraint).trim().toLowerCase();
        if (feaState) feaState.restraintType = rStr;
        if (typeof document !== 'undefined') {
            const btn = document.querySelector(`button.fea-support-btn[data-fea-support="${rStr}"]`);
            if (btn) btn.click();
        }
        applied.push('fea.restraintType');
    }

    if (feaCfg.visMode !== undefined && feaCfg.visMode !== null) {
        const vm = String(feaCfg.visMode).trim().toLowerCase();
        if (feaState) feaState.visMode = vm;
        if (typeof document !== 'undefined') {
            const btn = document.querySelector(`button.fea-vis-btn[data-fea-vis="${vm}"]`);
            if (btn) btn.click();
        }
        applied.push('fea.visMode');
    }

    if (feaCfg.showArrows !== undefined) {
        if (feaState) feaState.showArrows = Boolean(feaCfg.showArrows);
        setCheckboxVal('chk-fea-arrows', Boolean(feaCfg.showArrows));
        applied.push('fea.showArrows');
    }

    if (feaCfg.animate !== undefined) {
        const wantOn = Boolean(feaCfg.animate);
        if (wantOn && typeof wb?.switchTab === 'function') {
            wb.switchTab('tab-fea');
        }
        if (typeof wb?.setFEAAnimation === 'function') {
            wb.setFEAAnimation(wantOn);
        } else if (feaApi && typeof feaApi.setFEAAnimation === 'function') {
            feaApi.setFEAAnimation(wantOn);
        } else {
            if (feaState) feaState.animate = wantOn;
            setCheckboxVal('chk-fea-animate', wantOn);
        }
        const chk = byId('chk-fea-animate');
        if (chk) {
            chk.checked = Boolean(feaState?.animate ?? wantOn);
            chk.dispatchEvent(new Event('change', { bubbles: true }));
        }
        applied.push('fea.animate');
    }
}

function captureWorkbenchSnapshot(wb) {
    if (!wb || !wb.state) return null;
    const st = wb.state;
    const cam = wb.camera;
    const ctl = wb.controls;
    const customTiles = Array.isArray(st.TILES)
        ? st.TILES.filter(t => t && t.isCustomGraph).map(t => ({
            name: t.name,
            ccLevel: t.ccLevel ?? st.ccSubdivLevel ?? 1,
            meshOnly: Boolean(t.meshOnly),
            skeletonized: Boolean(t.skeletonized),
            enabled: Boolean(t.enabled),
            rawMesh: t.rawMesh ? { verts: t.rawMesh.verts, faces: t.rawMesh.faces } : null,
        }))
        : [];
    const builtinEnabled = Array.isArray(st.TILES)
        ? st.TILES.filter(t => t && !t.isCustomGraph).map(t => Boolean(t.enabled))
        : [];

    const snap = {
        v: 1,
        savedAt: Date.now(),
        activeTab: wb.activeTab || st.activeTabId || null,
        preset: st.currentTilePreset || null,
        algorithm: wb.algorithm || st.currentAlgorithm || null,
        grid: { x: st.GRID_X, y: st.GRID_Y, z: st.GRID_Z },
        voxelSize: st.VOXEL_SIZE,
        ccSubdivLevel: st.ccSubdivLevel ?? 1,
        skeletonizeMeshTile: Boolean(st.skeletonizeMeshTile),
        inspectedTileId: st.inspectedTileId ?? 1,
        builtinEnabled,
        customTiles,
        voxelPins: readVoxelPinsFromState(st),
        fdm: st.fdmState ? {
            mode: st.fdmState.mode,
            qProfile: st.fdmState.qProfile,
            qBase: st.fdmState.qBase,
            columnBoost: st.fdmState.columnBoost,
            loadZ: st.fdmState.loadZ,
            maxAnchors: st.fdmState.maxAnchors,
            fitEnvelope: st.fdmState.fitEnvelope,
            pruneLeaves: st.fdmState.pruneLeaves,
            triggerOnHost: st.fdmState.triggerOnHost,
        } : null,
        pq: st.tubeState ? {
            radius: st.tubeState.radius,
            innerRadiusM: st.tubeState.innerRadiusM,
            nSides: st.tubeState.nSides,
            endOffset: st.tubeState.endOffset,
            longitudinalSubdivLevels: st.tubeState.longitudinalSubdivLevels,
            pqOptimization: st.tubeState.pqOptimization,
            colorMode: st.tubeState.colorMode,
        } : null,
        elastica: st.elasticaState ? {
            pairMode: st.elasticaState.pairMode,
            solver: st.elasticaState.smoothMode,
            smooth: st.elasticaState.smoothLevel,
            tightness: st.elasticaState.tightness,
            rodRadius: st.elasticaState.rodRadius,
            rodSides: st.elasticaState.rodSides,
            showLeaves: st.elasticaState.showLeaves,
            showSkeletal: st.elasticaState.showSkeletalPaths,
            showCurves: st.elasticaState.showCurves,
            showRods: st.elasticaState.showRods,
            unroll3d: st.elasticaState.showUnrolled3D,
        } : null,
        fea: st.feaState ? {
            materialKey: st.feaState.materialKey,
            topLoadKg: st.feaState.topLoadKg,
            restraintType: st.feaState.restraintType,
            visMode: st.feaState.visMode,
            excludeGraph: Boolean(st.feaState.excludeGraph),
            includeElastica: Boolean(st.feaState.includeElastica),
            deflectionScale: st.feaState.exaggeration,
            animate: Boolean(st.feaState.animate),
            showArrows: Boolean(st.feaState.showArrows),
            loadCase: st.feaState.loadCase || null,
        } : null,
        goldilocksMode: wb.goldilocksMode || st.goldilocksMode || 'H1',
        arctic: typeof wb.arctic === 'function' ? wb.arctic() : Boolean(st.arcticOn),
        camera: (cam && ctl) ? {
            position: [cam.position.x, cam.position.y, cam.position.z],
            target: [ctl.target.x, ctl.target.y, ctl.target.z],
        } : null,
    };
    return snap;
}

function saveReloadSnapshot(tabId, wb) {
    if (typeof window === 'undefined' || !window.sessionStorage || !tabId || !wb) {
        return { saved: false, bytes: 0 };
    }
    try {
        const snap = captureWorkbenchSnapshot(wb);
        if (!snap) return { saved: false, bytes: 0 };
        let json = JSON.stringify(snap);
        if (json.length > MAX_RELOAD_SNAPSHOT_BYTES && Array.isArray(snap.customTiles) && snap.customTiles.length > 0) {
            snap.customTiles = [];
            snap.customTilesOmitted = true;
            json = JSON.stringify(snap);
        }
        if (json.length > MAX_RELOAD_SNAPSHOT_BYTES) {
            return { saved: false, bytes: json.length };
        }
        window.sessionStorage.setItem(`${RELOAD_SNAPSHOT_PREFIX}${tabId}`, json);
        return { saved: true, bytes: json.length, customTileCount: snap.customTiles.length };
    } catch {
        return { saved: false, bytes: 0 };
    }
}

function restoreReloadSnapshot(wb, tabId) {
    if (typeof window === 'undefined' || !window.sessionStorage || !tabId || !wb) {
        return false;
    }
    const key = `${RELOAD_SNAPSHOT_PREFIX}${tabId}`;
    let raw = null;
    try {
        raw = window.sessionStorage.getItem(key);
    } catch {
        return false;
    }
    if (!raw) return false;

    // One-shot entry: clear immediately so a restore error can never loop
    try {
        window.sessionStorage.removeItem(key);
    } catch {}

    let snap = null;
    try {
        snap = JSON.parse(raw);
    } catch {
        return false;
    }
    if (!snap || typeof snap !== 'object') return false;

    const applied = [];
    try {
        if (snap.ccSubdivLevel !== undefined && typeof wb.setCCSubdivLevel === 'function') {
            wb.setCCSubdivLevel(snap.ccSubdivLevel, false);
        }
        if (snap.skeletonizeMeshTile !== undefined && typeof wb.setSkeletonizeMeshTile === 'function') {
            wb.setSkeletonizeMeshTile(Boolean(snap.skeletonizeMeshTile), false);
        }
        if (Array.isArray(snap.customTiles) && snap.customTiles.length > 0 && typeof wb.importMeshModuleFromData === 'function') {
            for (const ct of snap.customTiles) {
                if (ct?.rawMesh?.verts && ct?.rawMesh?.faces) {
                    const imported = wb.importMeshModuleFromData(ct.name, ct.rawMesh.verts, ct.rawMesh.faces, {
                        ccLevel: ct.ccLevel ?? snap.ccSubdivLevel ?? 1,
                        meshOnly: Boolean(ct.meshOnly),
                        skeletonize: ct.skeletonized ?? snap.skeletonizeMeshTile ?? false,
                        normalize: false,
                    });
                    if (imported && ct.enabled !== undefined) {
                        imported.enabled = Boolean(ct.enabled);
                    }
                }
            }
            if (Array.isArray(snap.builtinEnabled) && Array.isArray(wb.state?.TILES)) {
                let bIdx = 0;
                for (const t of wb.state.TILES) {
                    if (!t.isCustomGraph && bIdx < snap.builtinEnabled.length) {
                        t.enabled = Boolean(snap.builtinEnabled[bIdx++]);
                    }
                }
            }
        }

        if (snap.algorithm && typeof wb.setAlgorithm === 'function' && snap.algorithm !== wb.algorithm) {
            wb.setAlgorithm(snap.algorithm);
        }
        if (snap.grid && typeof wb.setGridResolution === 'function') {
            const { x, y, z } = snap.grid;
            if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
                wb.setGridResolution(x, y, z, { zoom: false });
            }
        }
        if (snap.voxelSize !== undefined && typeof wb.setVoxelSize === 'function') {
            wb.setVoxelSize(snap.voxelSize, { zoom: false });
        }
        if (Array.isArray(snap.voxelPins) && snap.voxelPins.length > 0) {
            applyVoxelPinsConfig(wb, { clearVoxelPins: true, voxelPins: snap.voxelPins }, applied);
            if (typeof wb.setup === 'function') wb.setup({ collapseAll: true });
            if (typeof wb.draw === 'function') wb.draw();
        }
        const hasCustomTiles = Array.isArray(snap.customTiles) && snap.customTiles.length > 0;
        if (!hasCustomTiles && snap.preset && snap.preset !== 'active_topo' && typeof wb.applyTilePreset === 'function') {
            wb.applyTilePreset(snap.preset, { keepCamera: true });
        }
        if (snap.fdm && wb.state?.fdmState) {
            Object.assign(wb.state.fdmState, snap.fdm);
            if (snap.fdm.mode) setInputVal('sel-fdm-mode', snap.fdm.mode);
            if (snap.fdm.qProfile) setInputVal('sel-fdm-q-profile', snap.fdm.qProfile);
        }
        if (snap.pq && wb.state?.tubeState) {
            Object.assign(wb.state.tubeState, snap.pq);
            if (snap.pq.radius !== undefined) {
                setInputVal('rng-tube-radius', snap.pq.radius);
                setInputVal('rng-compact-tube-radius', snap.pq.radius);
            }
            if (snap.pq.innerRadiusM !== undefined) setInputVal('rng-tube-inner-radius', snap.pq.innerRadiusM);
            if (snap.pq.nSides !== undefined) setInputVal('rng-tube-sides', snap.pq.nSides);
            if (snap.pq.colorMode && typeof wb.setTubeColorMode === 'function') {
                wb.setTubeColorMode(snap.pq.colorMode);
            }
        }
        if (snap.elastica) {
            applyElasticaConfig(snap.elastica, applied);
        }
        if (snap.fea) {
            const { animate: wantAnim, ...restFea } = snap.fea;
            applyFeaConfig(wb, restFea, applied);
            if (wantAnim) applyFeaConfig(wb, { animate: true }, applied);
        }
        if (snap.goldilocksMode && typeof wb.setGoldilocksMode === 'function') {
            wb.setGoldilocksMode(snap.goldilocksMode);
        }
        if (snap.arctic !== undefined && typeof wb.setArctic === 'function') {
            wb.setArctic(Boolean(snap.arctic));
        }
        if (snap.activeTab && typeof wb.switchTab === 'function') {
            wb.switchTab(snap.activeTab);
        }
        if (snap.camera) {
            applyCameraConfig(wb, snap.camera, applied);
        }
        return true;
    } catch {
        return false;
    }
}

const ROUTING_META_KEYS = new Set([
    'clientId',
    'conversationId',
    'conv',
    'launch',
    'launchId',
    'surface',
    'autoLaunchChrome',
    'params',
]);

let _cachedWorkbenchActions = null;
async function resolveWorkbenchActions(wb) {
    if (wb?.actions && typeof wb.actions === 'object') return wb.actions;
    if (_cachedWorkbenchActions) return _cachedWorkbenchActions;
    try {
        const mod = await import('../state/workbench_state.js');
        if (mod?.actions && typeof mod.actions === 'object') {
            _cachedWorkbenchActions = mod.actions;
            return mod.actions;
        }
    } catch {
        // Outside Workbench module context (e.g. Launcher or unit test mock)
    }
    return null;
}

async function applySelectPqLoop(wb, rawLoopId) {
    const loopId = (
        rawLoopId === null ||
        rawLoopId === undefined ||
        rawLoopId === '' ||
        String(rawLoopId).trim().toLowerCase() === 'null'
    )
        ? null
        : Math.round(Number(rawLoopId));
    if (loopId !== null && (!Number.isFinite(loopId) || loopId < 0)) {
        throw new Error(`Invalid PQ loopId: ${rawLoopId}`);
    }
    const wbActions = await resolveWorkbenchActions(wb);
    const selectFn = wb?.selectPqLoopById
        || wbActions?.selectPqLoopById
        || wb?.state?._pqApi?.selectPqLoopById;
    if (typeof selectFn === 'function') {
        selectFn(loopId);
    } else if (wb?.state?.faceLoopState) {
        wb.state.faceLoopState.selectedLoopId = loopId;
        if (loopId !== null) {
            wb.state.faceLoopState.selectedLoopIdx = loopId;
        }
    }
    return loopId;
}

async function configureWorkbench(wb, rawPayload = {}, bridgeMeta = {}) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const nestedParams = rawPayload && typeof rawPayload.params === 'object' && !Array.isArray(rawPayload.params)
        ? rawPayload.params
        : {};
    const payload = { ...nestedParams, ...(rawPayload || {}) };
    const applied = [];

    if (payload.tab && typeof wb.switchTab === 'function') {
        wb.switchTab(String(payload.tab));
        applied.push('tab');
    }
    if (payload.preset && typeof wb.applyTilePreset === 'function') {
        wb.applyTilePreset(String(payload.preset));
        applied.push('preset');
    }
    if (payload.algorithm && typeof wb.setAlgorithm === 'function') {
        wb.setAlgorithm(String(payload.algorithm));
        applied.push('algorithm');
    }

    const skelSpec = payload.skeletonize ?? payload.skeletonizeMeshTile;
    if (skelSpec !== undefined) {
        const wantSkel = Boolean(skelSpec);
        if (typeof wb.setSkeletonizeMeshTile === 'function') {
            wb.setSkeletonizeMeshTile(wantSkel, true);
        } else {
            setCheckboxVal('chk-skeletonize-mesh', wantSkel);
        }
        applied.push('skeletonize');
    }

    const subDivSpec = payload.subDiv ?? payload.ccLevel;
    if (subDivSpec !== undefined) {
        const n = Math.max(0, Math.min(4, Math.round(Number(subDivSpec))));
        if (Number.isFinite(n)) {
            setInputVal('rng-cc-level', n);
            setInputVal('num-cc-level', n);
            applied.push('subDiv');
        }
    }

    const hasGridResolution = payload.gridResolution !== undefined;
    const gridSpec = hasGridResolution ? payload.gridResolution : payload.grid;
    if (gridSpec !== undefined && gridSpec !== null && typeof wb.setGridResolution === 'function') {
        let gx, gy, gz;
        if (typeof gridSpec === 'string') {
            const parts = gridSpec.trim().split(/[xX×,\s]+/).map(Number);
            [gx, gy, gz] = parts;
        } else if (Array.isArray(gridSpec)) {
            [gx, gy, gz] = gridSpec.map(Number);
        } else if (typeof gridSpec === 'object') {
            gx = Number(gridSpec.x ?? gridSpec.nx);
            gy = Number(gridSpec.y ?? gridSpec.ny);
            gz = Number(gridSpec.z ?? gridSpec.nz);
        }
        if (Number.isFinite(gx) && Number.isFinite(gy) && Number.isFinite(gz) && gx >= 1 && gy >= 1 && gz >= 1) {
            wb.setGridResolution(gx, gy, gz);
            for (const [axis, val] of [['x', gx], ['y', gy], ['z', gz]]) {
                const rng = byId(`rng-grid-${axis}`);
                const num = byId(`num-grid-${axis}`);
                if (rng) rng.value = String(val);
                if (num) num.value = String(val);
            }
            applied.push(hasGridResolution ? 'gridResolution' : 'grid');
        }
    }

    if (payload.voxelSize !== undefined && typeof wb.setVoxelSize === 'function') {
        const v = Number(payload.voxelSize);
        if (Number.isFinite(v) && v > 0) {
            wb.setVoxelSize(v);
            applied.push('voxelSize');
        }
    }

    const fdmMode = payload.fdmMode ?? payload.mode;
    if (fdmMode && wb.state?.fdmState) {
        wb.state.fdmState.mode = String(fdmMode);
        setInputVal('sel-fdm-mode', fdmMode);
        applied.push('fdmMode');
    }
    if (payload.qProfile && wb.state?.fdmState) {
        wb.state.fdmState.qProfile = String(payload.qProfile);
        setInputVal('sel-fdm-q-profile', payload.qProfile);
        applied.push('qProfile');
    }

    if ((payload.outerRadiusM !== undefined || payload.radius !== undefined) && wb.state?.tubeState) {
        const r = Number(payload.outerRadiusM ?? payload.radius);
        if (Number.isFinite(r) && r > 0) {
            wb.state.tubeState.radius = r;
            setInputVal('rng-tube-radius', r);
            setInputVal('rng-compact-tube-radius', r);
            applied.push('outerRadiusM');
        }
    }
    const innerR = payload.innerRadiusM ?? payload.innerRadius;
    if (innerR !== undefined && wb.state?.tubeState) {
        const r = Number(innerR);
        if (Number.isFinite(r) && r >= 0) {
            wb.state.tubeState.innerRadiusM = r;
            wb.state.tubeState.innerRadius = r;
            setInputVal('rng-tube-inner-radius', r);
            applied.push('innerRadiusM');
        }
    }
    if (payload.nSides !== undefined && wb.state?.tubeState) {
        const n = Math.round(Number(payload.nSides));
        if (Number.isFinite(n) && n >= 3) {
            wb.state.tubeState.nSides = n;
            setInputVal('rng-tube-sides', n);
            applied.push('nSides');
        }
    }
    if (payload.tubeColorMode && typeof wb.setTubeColorMode === 'function') {
        wb.setTubeColorMode(String(payload.tubeColorMode));
        applied.push('tubeColorMode');
    }
    if (typeof payload.pq === 'boolean' && wb.state?.tubeState) {
        wb.state.tubeState.pqOptimization = payload.pq;
        setCheckboxVal('chk-tube-pq', payload.pq);
        applied.push('pq');
    } else if (payload.pq && typeof payload.pq === 'object') {
        const pqCfg = payload.pq;
        if (Object.hasOwn(pqCfg, 'selectedLoopId')) {
            await applySelectPqLoop(wb, pqCfg.selectedLoopId);
            applied.push('pq.selectedLoopId');
        }
        if (pqCfg.optimization !== undefined && wb.state?.tubeState) {
            wb.state.tubeState.pqOptimization = Boolean(pqCfg.optimization);
            setCheckboxVal('chk-tube-pq', Boolean(pqCfg.optimization));
            applied.push('pq.optimization');
        }
        if (pqCfg.colorMode && typeof wb.setTubeColorMode === 'function') {
            wb.setTubeColorMode(String(pqCfg.colorMode));
            applied.push('pq.colorMode');
        }
        if (pqCfg.nSides !== undefined && wb.state?.tubeState) {
            const n = Math.round(Number(pqCfg.nSides));
            if (Number.isFinite(n) && n >= 3) {
                wb.state.tubeState.nSides = n;
                setInputVal('rng-tube-sides', n);
                applied.push('pq.nSides');
            }
        }
        if (pqCfg.longitudinalSubdivLevels !== undefined && wb.state?.tubeState) {
            const l = Math.round(Number(pqCfg.longitudinalSubdivLevels));
            if (Number.isFinite(l) && l >= 0) {
                wb.state.tubeState.longitudinalSubdivLevels = l;
                setInputVal('rng-tube-subdiv', l);
                applied.push('pq.longitudinalSubdivLevels');
            }
        }
    }
    if (payload.goldilocksMode && typeof wb.setGoldilocksMode === 'function') {
        wb.setGoldilocksMode(String(payload.goldilocksMode));
        applied.push('goldilocksMode');
    }
    if (payload.arctic !== undefined && typeof wb.setArctic === 'function') {
        wb.setArctic(Boolean(payload.arctic));
        applied.push('arctic');
    }
    if (payload.clearVoxelPins === true || Array.isArray(payload.voxelPins)) {
        applyVoxelPinsConfig(wb, payload, applied);
    }
    if (payload.elastica && typeof payload.elastica === 'object') {
        applyElasticaConfig(payload.elastica, applied);
    }
    const feaPayload = (payload.fea && typeof payload.fea === 'object')
        ? payload.fea
        : (payload.params?.fea && typeof payload.params.fea === 'object' ? payload.params.fea : null);
    if (feaPayload) {
        applyFeaConfig(wb, feaPayload, applied);
    }
    if (payload.camera !== undefined) {
        applyCameraConfig(wb, payload.camera, applied);
    }

    const userConfigKeys = Object.keys(payload).filter(
        k => !ROUTING_META_KEYS.has(k) && payload[k] !== undefined
    );
    if (userConfigKeys.length > 0 && applied.length === 0) {
        return {
            configured: false,
            applied: [],
            warning: 'No recognized configuration fields matched.',
            state: inspectWorkbench(wb, bridgeMeta),
        };
    }

    return { configured: true, applied, state: inspectWorkbench(wb, bridgeMeta) };
}

async function loadFileInWorkbench(wb, payload = {}, bridgeMeta = {}, bridgeLocks = null) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const target = payload.target === 'network' ? 'network' : (payload.target === 'mesh_tile' ? 'mesh_tile' : 'tile');
    const fileName = String(payload.fileName || 'imported.obj');
    const hasBase64 = typeof payload.contentBase64 === 'string' && payload.contentBase64.length > 0;
    const hasText = typeof payload.content === 'string';
    const discardPending = payload.discardPending === true;
    const replace = payload.replace !== false;

    const resetPendingDom = () => {
        const overlay = byId('loading-overlay');
        if (overlay && !overlay.classList.contains('hidden')) {
            overlay.classList.add('hidden');
        }
        const tileInp = byId('mesh-module-input');
        if (tileInp) {
            try { tileInp.value = ''; } catch {}
        }
        const netInp = byId('topo-network-file-input');
        if (netInp) {
            try { netInp.value = ''; } catch {}
        }
    };

    if (discardPending || replace) {
        if (bridgeLocks) bridgeLocks.pendingLoadFile = null;
        resetPendingDom();
        if (discardPending && !hasBase64 && !hasText) {
            return {
                ok: true,
                discardedPending: true,
                loaded: false,
                target,
                state: inspectWorkbench(wb, bridgeMeta),
            };
        }
    }

    if (!hasBase64 && !hasText) {
        throw new Error('load_file requires content or contentBase64');
    }

    if (bridgeLocks) {
        bridgeLocks.pendingLoadFile = {
            target,
            fileName,
            startedAt: Date.now(),
        };
    }

    try {
        const fileBytes = hasBase64 ? base64ToUint8Array(payload.contentBase64) : payload.content;
        const file = new File([fileBytes], fileName, {
            type: hasBase64 ? 'application/octet-stream' : 'text/plain',
        });

        if (target === 'mesh_tile' || (target === 'tile' && payload.meshOnly === true)) {
            if (typeof wb.switchTab === 'function') wb.switchTab('tab-tiles');
            if (payload.clearExisting) {
                const btnClear = byId('btn-clear-mesh-only-tiles');
                if (btnClear && !btnClear.disabled) btnClear.click();
            }
            if (payload.subDiv !== undefined) {
                const n = Math.max(0, Math.min(4, Math.round(Number(payload.subDiv))));
                setInputVal('rng-mesh-only-cc', n);
                setInputVal('num-mesh-only-cc', n);
            }
            if (payload.fitToVoxel !== undefined) {
                setCheckboxVal('chk-mesh-only-norm', payload.fitToVoxel);
            }
            if (payload.customOnly !== undefined) {
                setCheckboxVal('chk-mesh-only-custom-only', payload.customOnly);
            }
            const input = byId('mesh-only-tile-input');
            if (!input) throw new Error('Tab 1 #mesh-only-tile-input not found in DOM');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await waitForOverlayHidden(20000);
            await waitMs(80);
            const fbEl = byId('mesh-only-tile-feedback');
            const feedback = fbEl?.textContent?.trim() || null;
            const failed = Boolean(feedback && (/^Import error:/i.test(feedback) || fbEl?.classList?.contains('text-rose-400')));
            return {
                ok: !failed,
                loaded: !failed,
                ...(failed ? { error: feedback } : {}),
                target: 'mesh_tile',
                meshOnly: true,
                fileName,
                feedback,
                meshOnlyTileBadge: byId('mesh-only-tile-badge')?.textContent?.trim() || null,
                state: inspectWorkbench(wb, bridgeMeta),
            };
        }

        if (target === 'tile') {
            if (typeof wb.switchTab === 'function') wb.switchTab('tab-tiles');
            if (payload.clearExisting) {
                const btnClear = byId('btn-clear-custom-tiles');
                if (btnClear && !btnClear.disabled) btnClear.click();
            }
            if (payload.skeletonize !== undefined) {
                const wantSkel = Boolean(payload.skeletonize);
                if (typeof wb.setSkeletonizeMeshTile === 'function') {
                    wb.setSkeletonizeMeshTile(wantSkel, false);
                } else {
                    setCheckboxVal('chk-skeletonize-mesh', wantSkel);
                }
            }
            if (payload.subDiv !== undefined) {
                const n = Math.max(0, Math.min(4, Math.round(Number(payload.subDiv))));
                setInputVal('rng-cc-level', n);
                setInputVal('num-cc-level', n);
            }
            if (payload.fitToVoxel !== undefined) {
                setCheckboxVal('chk-norm-voxel', payload.fitToVoxel);
            }
            if (payload.customOnly !== undefined) {
                setCheckboxVal('chk-disable-builtin', payload.customOnly);
            }
            const input = byId('mesh-module-input');
            if (!input) throw new Error('Tab 1 #mesh-module-input not found in DOM');
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await waitForOverlayHidden(20000);
            await waitMs(80);
            const fbEl = byId('mesh-module-feedback');
            const feedback = fbEl?.textContent?.trim() || null;
            const failed = Boolean(feedback && (/^Import error:/i.test(feedback) || fbEl?.classList?.contains('text-rose-400')));
            if (failed) {
                return {
                    ok: false,
                    loaded: false,
                    error: feedback,
                    target: 'tile',
                    fileName,
                    subDiv: wb.state?.ccSubdivLevel ?? null,
                    skeletonize: Boolean(wb.state?.skeletonizeMeshTile),
                    feedback,
                    customTileBadge: byId('custom-tile-badge')?.textContent?.trim() || null,
                    state: inspectWorkbench(wb, bridgeMeta),
                };
            }
            return {
                ok: true,
                loaded: true,
                target: 'tile',
                fileName,
                subDiv: wb.state?.ccSubdivLevel ?? null,
                skeletonize: Boolean(wb.state?.skeletonizeMeshTile),
                feedback,
                customTileBadge: byId('custom-tile-badge')?.textContent?.trim() || null,
                state: inspectWorkbench(wb, bridgeMeta),
            };
        }

        if (typeof wb.switchTab === 'function') wb.switchTab('tab-topo');
        if (payload.weldTol !== undefined) {
            setInputVal('num-topo-file-weld-tol', payload.weldTol);
        }
        const input = byId('topo-network-file-input');
        if (!input) throw new Error('Tab 2 #topo-network-file-input not found in DOM');
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        await waitForOverlayHidden(20000);
        await waitMs(80);
        const fbEl = byId('topo-network-feedback');
        const feedback = fbEl?.textContent?.trim() || null;
        const failed = Boolean(feedback && (/^Import error:/i.test(feedback) || fbEl?.classList?.contains('text-rose-400')));
        if (failed) {
            return {
                ok: false,
                loaded: false,
                error: feedback,
                target: 'network',
                fileName,
                feedback,
                state: inspectWorkbench(wb, bridgeMeta),
            };
        }
        return {
            ok: true,
            loaded: true,
            target: 'network',
            fileName,
            feedback,
            state: inspectWorkbench(wb, bridgeMeta),
        };
    } finally {
        if (bridgeLocks) bridgeLocks.pendingLoadFile = null;
        resetPendingDom();
    }
}

async function runWorkbenchStep(wb, payload = {}, bridgeMeta = {}) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const step = String(payload.step || '').trim().toLowerCase();
    if (!step) throw new Error('run_step requires a step name');

    switch (step) {
        case 'generate':
        case 'wfc':
            if (typeof wb.setup === 'function') wb.setup({ collapseAll: true });
            if (typeof wb.draw === 'function') wb.draw();
            break;
        case 'collapse_all': {
            const btn = byId('btn-sim-collapse-all');
            if (btn) btn.click();
            else if (typeof wb.setup === 'function') wb.setup({ collapseAll: true });
            await waitMs(80);
            break;
        }
        case 'reset_topo': {
            const btn = byId('btn-sim-reset');
            if (btn) btn.click();
            await waitMs(60);
            break;
        }
        case 'fdm':
            if (typeof wb.runFDM === 'function') wb.runFDM({ keepCamera: true });
            break;
        case 'reset_fdm':
            if (typeof wb.resetFDM === 'function') wb.resetFDM();
            break;
        case 'solidify':
        case 'pq':
            if (typeof wb.solidifyActiveGraph === 'function') wb.solidifyActiveGraph({ keepCamera: true });
            break;
        case 'longitudinal_subdiv':
            if (typeof wb.applyLongitudinalSubdivPQ === 'function') wb.applyLongitudinalSubdivPQ();
            break;
        case 'ring_subdiv':
            if (typeof wb.applyRingSubdivPQ === 'function') wb.applyRingSubdivPQ();
            break;
        case 'swap_long_ring': {
            const wbActions = await resolveWorkbenchActions(wb);
            const swapFn = wb.swapPqLongRing
                || wb.swapLongRingDirections
                || wbActions?.swapPqLongRing
                || wb.state?._pqApi?.swapPqLongRing;
            if (typeof swapFn === 'function') {
                swapFn();
            } else {
                const btn = byId('btn-pq-swap-long-ring') || byId('btn-swap-long-ring');
                if (btn) btn.click();
                else throw new Error('swap_long_ring action or #btn-swap-long-ring button not found');
            }
            await waitMs(60);
            break;
        }
        case 'select_pq_loop': {
            const rawLoopId = payload.loopId !== undefined
                ? payload.loopId
                : (payload.params?.loopId !== undefined ? payload.params.loopId : payload.params?.selectedLoopId);
            const selectedLoopId = await applySelectPqLoop(wb, rawLoopId);
            await waitMs(40);
            return {
                step,
                loopId: selectedLoopId,
                selectedLoopId,
                completed: true,
                state: inspectWorkbench(wb, bridgeMeta),
            };
        }
        case 'pq_optimize':
            if (typeof wb.applyOnlyPQOptimization === 'function') wb.applyOnlyPQOptimization();
            break;
        case 'unroll':
            if (typeof wb.toggleUnroll3D === 'function') wb.toggleUnroll3D();
            break;
        case 'elastica':
        case 'elastica_trace': {
            if (typeof wb.switchTab === 'function') wb.switchTab('tab-elastica');
            if (payload.params && typeof payload.params === 'object') {
                const applied = [];
                applyElasticaConfig(payload.params, applied);
            }
            const btn = byId('btn-generate-elastica');
            if (!btn) throw new Error('#btn-generate-elastica not found');
            btn.click();
            await waitMs(120);
            break;
        }
        case 'elastica_reset':
            byId('btn-reset-elastica')?.click();
            await waitMs(60);
            break;
        case 'elastica_unroll':
            byId('btn-toggle-elastica-unroll-3d')?.click();
            await waitMs(60);
            break;
        case 'fea':
            if (typeof wb.runFEA === 'function') wb.runFEA({ trigger: 'mcp' });
            break;
        case 'fea_animate': {
            const rawMode = payload.mode ?? payload.params?.mode ?? 'toggle';
            const mode = String(rawMode || 'toggle').trim().toLowerCase();
            const currentAnim = Boolean(wb.state?.feaState?.animate);
            let nextAnim;
            if (mode === 'start' || mode === 'on' || mode === 'play' || mode === 'true') {
                nextAnim = true;
            } else if (mode === 'stop' || mode === 'off' || mode === 'pause' || mode === 'false') {
                nextAnim = false;
            } else if (mode === 'toggle') {
                nextAnim = !currentAnim;
            } else {
                throw new Error(`Unsupported fea_animate mode: ${rawMode}`);
            }
            if (nextAnim && typeof wb.switchTab === 'function') {
                wb.switchTab('tab-fea');
            }
            if (typeof wb.setFEAAnimation === 'function') {
                wb.setFEAAnimation(nextAnim);
            } else if (wb.state?._feaApi?.setFEAAnimation) {
                wb.state._feaApi.setFEAAnimation(nextAnim);
            } else {
                const btn = byId('btn-fea-animate');
                if (btn && currentAnim !== nextAnim) btn.click();
            }
            const chk = byId('chk-fea-animate');
            if (chk) {
                chk.checked = Boolean(wb.state?.feaState?.animate ?? nextAnim);
                chk.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await waitMs(40);
            return {
                step,
                mode,
                animating: Boolean(wb.state?.feaState?.animate),
                completed: true,
                state: inspectWorkbench(wb, bridgeMeta),
            };
        }
        case 'all':
            if (typeof wb.setup === 'function') wb.setup({ collapseAll: true });
            if (typeof wb.draw === 'function') wb.draw();
            if (typeof wb.runFDM === 'function') wb.runFDM({ keepCamera: true });
            if (typeof wb.solidifyActiveGraph === 'function') wb.solidifyActiveGraph({ keepCamera: true });
            if (typeof wb.runFEA === 'function') wb.runFEA({ trigger: 'mcp' });
            break;
        case 'zoom_fit':
            if (typeof wb.zoomFit === 'function') wb.zoomFit();
            break;
        case 'reload':
            // Reload steps are intercepted by handleReloadTask() in pollLoop
            break;
        default:
            throw new Error(`Unsupported workbench step: ${step}`);
    }

    return { step, completed: true, state: inspectWorkbench(wb, bridgeMeta) };
}

function exportFromWorkbench(wb, payload = {}) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const format = String(payload.format || 'topology').trim().toLowerCase();
    const triggerDownload = payload.download === true;
    const includeData = payload.includeData !== false;

    const buildTopo = () => {
        const built = typeof wb.buildFoundryTopologyJSONPayload === 'function'
            ? wb.buildFoundryTopologyJSONPayload()
            : null;
        const topoObj = built?.payload ?? built ?? null;
        const filename = `${built?.baseName || 'TopoGen_FDM_active'}.topology.json`;
        const jsonText = topoObj ? JSON.stringify(topoObj, null, 2) : '';
        if (triggerDownload && jsonText) {
            triggerTextDownload(jsonText, filename, 'application/json');
        }
        const bounded = boundExportString(jsonText);
        return {
            format: format === 'topology_json' ? 'topology_json' : 'topology',
            filename,
            bytes: bounded.bytes,
            truncated: bounded.truncated,
            downloaded: triggerDownload,
            vertexCount: topoObj?.vertices?.length ?? 0,
            edgeCount: topoObj?.edges?.length ?? 0,
            anchorCount: topoObj?.anchors?.length ?? 0,
            ...(includeData
                ? {
                    data: bounded.data,
                    ...(bounded.bytes <= 200 * 1024 ? { topology: topoObj } : {}),
                }
                : {}),
        };
    };

    const buildObj = () => {
        let solid = wb.solidData || wb.state?.lastSolidData || null;
        if ((!solid || !Array.isArray(solid.vertices) || solid.vertices.length === 0) && typeof wb.solidifyActiveGraph === 'function') {
            wb.solidifyActiveGraph({ keepCamera: true });
            solid = wb.solidData || wb.state?.lastSolidData || null;
        }
        const preset = wb.state?.currentTilePreset || 'active_topo';
        const filename = `TopoGen_FDM_${preset}.mesh.obj`;
        const objText = solid && wb.core && typeof wb.core.buildQuadDominantOBJ === 'function'
            ? wb.core.buildQuadDominantOBJ(solid, { name: `TopoGen_FDM_${preset}` })
            : '';
        if (triggerDownload && objText) {
            triggerTextDownload(objText, filename, 'text/plain');
        }
        const bounded = boundExportString(objText);
        const faceCount = solid
            ? (Array.isArray(solid.faces)
                ? solid.faces.length
                : ((Array.isArray(solid.quads) ? solid.quads.length : 0) +
                   (Array.isArray(solid.triangles) ? solid.triangles.length : 0)))
            : 0;
        return {
            format: 'obj',
            filename,
            bytes: bounded.bytes,
            truncated: bounded.truncated,
            downloaded: triggerDownload,
            vertexCount: solid?.vertices?.length ?? 0,
            faceCount,
            ...(includeData ? { data: bounded.data } : {}),
        };
    };

    const buildUnrollSvg = () => {
        let solid = wb.solidData || wb.state?.lastSolidData || null;
        if ((!solid || !Array.isArray(solid.vertices) || solid.vertices.length === 0) && typeof wb.solidifyActiveGraph === 'function') {
            wb.solidifyActiveGraph({ keepCamera: true });
            solid = wb.solidData || wb.state?.lastSolidData || null;
        }
        const activeG = wb.fdmResult || wb.weldedGraph || wb.state?.lastFDMResult || wb.state?.lastWeldedGraph || null;
        const preset = wb.state?.currentTilePreset || 'active_topo';
        const baseName = `TopoGen_FDM_${preset}`;
        const filename = `${baseName}.patterns.svg`;
        let patternsSvg = '';
        let unrolledJson = null;
        if (activeG && solid && wb.core && typeof wb.core.buildUnrolledPatterns === 'function') {
            const built = wb.core.buildUnrolledPatterns(activeG, solid, {
                name: baseName,
                outerRadiusM: wb.state?.tubeState?.radius ?? 0.06,
                nSides: wb.state?.tubeState?.nSides ?? 8,
                longitudinalSubdivLevels: wb.state?.tubeState?.longitudinalSubdivLevels ?? 1,
            });
            patternsSvg = built?.patternsSvg || '';
            unrolledJson = built?.unrolledJson || null;
        }
        if (triggerDownload && patternsSvg) {
            triggerTextDownload(patternsSvg, filename, 'image/svg+xml');
        }
        const bounded = boundExportString(patternsSvg);
        const faceCount = solid
            ? ((Array.isArray(solid.quads) ? solid.quads.length : 0) +
               (Array.isArray(solid.triangles) ? solid.triangles.length : 0))
            : 0;
        return {
            format: format === 'unroll_svg' ? 'unroll_svg' : 'svg',
            filename,
            bytes: bounded.bytes,
            truncated: bounded.truncated,
            downloaded: triggerDownload,
            stripCount: Array.isArray(wb.faceLoopState?.loops)
                ? wb.faceLoopState.loops.length
                : (unrolledJson?.bars?.length ?? 0),
            faceCount,
            ...(includeData ? { data: bounded.data } : {}),
        };
    };

    if (format === 'topology' || format === 'json' || format === 'topology_json') return buildTopo();
    if (format === 'obj' || format === 'mesh') return buildObj();
    if (format === 'svg' || format === 'unroll_svg') return buildUnrollSvg();

    if (format === 'elastica_svg') {
        let elData = wb.state?.lastElasticaData || null;
        if (!elData || !Array.isArray(elData.curves) || elData.curves.length === 0) {
            byId('btn-generate-elastica')?.click();
            elData = wb.state?.lastElasticaData || null;
        }
        const curves = Array.isArray(elData?.curves) ? elData.curves : [];
        const svgText = curves.length > 0 && wb.core && typeof wb.core.buildElasticaRibbonsSVG === 'function'
            ? wb.core.buildElasticaRibbonsSVG(curves)
            : '';
        const filename = 'elastica_rods_unrolled.svg';
        if (triggerDownload && svgText) {
            triggerTextDownload(svgText, filename, 'image/svg+xml');
        }
        const bounded = boundExportString(svgText);
        return {
            format: 'elastica_svg',
            filename,
            bytes: bounded.bytes,
            truncated: bounded.truncated,
            downloaded: triggerDownload,
            curveCount: curves.length,
            readout: byId('elastica-readout')?.textContent?.trim() || null,
            ...(includeData ? { data: bounded.data } : {}),
        };
    }

    if (format === 'all') {
        return {
            format: 'all',
            topology: buildTopo(),
            obj: buildObj(),
        };
    }

    if (format === 'snapshot') {
        const scale = Number(payload.scale);
        const dataUrl = typeof wb.snapshot === 'function'
            ? wb.snapshot(Number.isFinite(scale) && scale > 0 && scale <= 1 ? scale : 0.5)
            : null;
        return {
            format: 'snapshot',
            dataUrl,
        };
    }

    throw new Error(`Unsupported export format: ${format}`);
}

function summarizeActivity(action, payload = {}, result = {}) {
    switch (action) {
        case 'configure': {
            const g = result?.state?.gridResolution;
            const applied = Array.isArray(result?.applied) ? result.applied : [];
            if ((applied.includes('grid') || applied.includes('gridResolution')) && g) {
                return `Updated ${g.x}×${g.y}×${g.z} Grid`;
            }
            if (applied.includes('preset') && payload.preset) {
                return `Applied Preset ${payload.preset}`;
            }
            if (applied.length > 0) {
                return `Updated ${applied.slice(0, 2).join(', ')}`;
            }
            return null;
        }
        case 'load_file':
            return `Imported ${payload.fileName || 'Geometry'}`;
        case 'run_step': {
            const s = String(payload.step || '').toLowerCase();
            if (s === 'fdm') return 'Ran Force Density Form-Find';
            if (s === 'solidify' || s === 'pq') return 'Built All-Quad PQ Mesh';
            if (s === 'swap_long_ring') return 'Swapped PQ Long ↔ Ring Directions';
            if (s === 'select_pq_loop') return result?.loopId === null ? 'Cleared PQ Loop Highlight' : `Highlighted PQ Loop #${result?.loopId ?? ''}`;
            if (s === 'elastica' || s === 'elastica_trace') return 'Traced Smooth Elastica Rods';
            if (s === 'fea') return 'Ran Space-Frame Check';
            if (s === 'fea_animate') return result?.animating ? 'Started FEA Deflection Playback' : 'Stopped FEA Deflection Playback';
            if (s === 'reload') return 'Reloading Workbench';
            if (s === 'generate' || s === 'wfc' || s === 'collapse_all') return 'Generated Voxel Topology';
            if (s === 'unroll' || s === 'elastica_unroll') return 'Toggled 3D Flat Unroll';
            if (s === 'all') return 'Completed Full Pipeline';
            return `Completed Step ${s}`;
        }
        case 'export':
            return `Exported ${String(payload.format || 'geometry').replace(/_/g, ' ').toUpperCase()}`;
        default:
            return null;
    }
}

export function initMcpUiBridge(options = {}) {
    if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) {
        return { bridgeVersion: BRIDGE_VERSION, stop() {} };
    }

    const surface = options.surface === 'launcher' ||
        /foundry_launcher\.html/i.test(window.location.pathname)
        ? 'launcher'
        : 'workbench';
    const browserKind = detectBrowserKind();
    const instanceNonce = `${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

    let urlConv = null;
    let urlLaunch = null;
    try {
        const urlObj = new URL(window.location.href);
        urlConv = (urlObj.searchParams.get('conv') || urlObj.searchParams.get('conversationId') || '').trim() || null;
        urlLaunch = (urlObj.searchParams.get('launch') || urlObj.searchParams.get('launchId') || '').trim() || null;
    } catch {
        urlConv = null;
        urlLaunch = null;
    }

    const { fromWindowName, fromSession } = readStoredIdentity();
    const storedPrimary = (fromWindowName && validTabIdForSurface(fromWindowName.tabId, surface))
        ? fromWindowName
        : ((fromSession && validTabIdForSurface(fromSession.tabId, surface)) ? fromSession : null);
    const anyStoredConv = fromWindowName?.conversationId || fromSession?.conversationId || null;

    const bridgeState = {
        tabId: storedPrimary ? storedPrimary.tabId : mintTabId(surface),
        conversationId: urlConv || storedPrimary?.conversationId || anyStoredConv || null,
        pendingLaunchId: urlLaunch || null,
        surface,
        browserKind,
        executionMode: 'A',
        allowModeB: false,
        connected: false,
        identitySettled: false,
        restoredFromReload: false,
    };

    const bridgeLocks = {
        busy: false,
        activeTaskId: null,
        pendingLoadFile: null,
    };

    // Strip one-shot `launch` from address bar while preserving `?conv=`
    syncAddressBarParams(bridgeState.conversationId, true);
    writeStoredIdentity(bridgeState.tabId, bridgeState.conversationId, surface);

    let stopped = false;
    let bridgeToken = null;
    let backoffMs = 500;
    let disconnectSent = false;
    let flashTimer = null;
    let copyTimer = null;
    let bc = null;

    function setConversationId(nextConv, { syncUrl = true } = {}) {
        const cleaned = typeof nextConv === 'string' && nextConv.trim().length > 0
            ? nextConv.trim()
            : null;
        const changed = bridgeState.conversationId !== cleaned;
        bridgeState.conversationId = cleaned;
        writeStoredIdentity(bridgeState.tabId, bridgeState.conversationId, surface);
        if (syncUrl) {
            syncAddressBarParams(bridgeState.conversationId, true);
        }
        if (changed && typeof options.onConversationChange === 'function') {
            try { options.onConversationChange(bridgeState.conversationId); } catch {}
        }
        renderHud();
    }

    // Duplicate-tab detection via BroadcastChannel('topogen_ui_bridge_v2')
    const identityReadyPromise = (async () => {
        if (typeof BroadcastChannel !== 'function') {
            bridgeState.identitySettled = true;
            return;
        }
        try {
            bc = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
        } catch {
            bridgeState.identitySettled = true;
            return;
        }

        let duplicateDetected = false;
        let resolveDuplicateWait = null;
        const waitDup = new Promise(resolve => {
            resolveDuplicateWait = resolve;
            setTimeout(resolve, 85);
        });

        bc.onmessage = (ev) => {
            const msg = ev?.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'who_has' && msg.tabId === bridgeState.tabId && msg.nonce !== instanceNonce) {
                if (bridgeState.identitySettled || instanceNonce < String(msg.nonce || '')) {
                    try {
                        bc.postMessage({
                            type: 'i_have',
                            tabId: bridgeState.tabId,
                            nonce: instanceNonce,
                        });
                    } catch {}
                }
            } else if (
                msg.type === 'i_have' &&
                !bridgeState.identitySettled &&
                msg.tabId === bridgeState.tabId &&
                msg.nonce !== instanceNonce
            ) {
                duplicateDetected = true;
                if (resolveDuplicateWait) resolveDuplicateWait();
            }
        };

        try {
            bc.postMessage({
                type: 'who_has',
                tabId: bridgeState.tabId,
                nonce: instanceNonce,
            });
        } catch {}

        await waitDup;
        if (duplicateDetected) {
            bridgeState.tabId = mintTabId(surface);
            bridgeState.conversationId = null;
            writeStoredIdentity(bridgeState.tabId, null, surface);
            syncAddressBarParams(null, true);
            if (typeof options.onConversationChange === 'function') {
                try { options.onConversationChange(null); } catch {}
            }
        }
        bridgeState.identitySettled = true;
        renderHud();
    })();

    // Workbench Live Connection & Pairing HUD wiring
    function renderHud() {
        const hud = byId('mcp-bridge-hud');
        if (!hud) return;
        if (!bridgeToken) {
            hud.classList.add('hidden');
            return;
        }
        hud.classList.remove('hidden');

        const dot = byId('mcp-bridge-dot');
        const label = byId('mcp-bridge-label');
        const modeBadge = byId('mcp-bridge-mode');
        const surfaceLbl = byId('mcp-bridge-surface-label');
        const stateTag = byId('mcp-bridge-state-tag');
        const tabIdEl = byId('mcp-bridge-tab-id');
        const convInput = byId('inp-mcp-conv-id');
        const pairBtn = byId('btn-mcp-pair-tab');
        const unpairBtn = byId('btn-mcp-unpair-tab');
        const launcherLink = byId('lnk-mcp-open-launcher');

        const bName = formatBrowserDisplay(bridgeState.browserKind);
        const conv = bridgeState.conversationId;
        const isWarnBrowser = bridgeState.browserKind === 'webview' || bridgeState.browserKind === 'headless';
        const isModeB = bridgeState.executionMode === 'B' || bridgeState.allowModeB;

        if (dot) {
            dot.classList.remove('dot-paired', 'dot-unpaired', 'dot-warn');
            if (!bridgeState.connected || isWarnBrowser) {
                dot.classList.add('dot-warn');
            } else if (conv && bridgeState.browserKind === 'chrome') {
                dot.classList.add('dot-paired');
            } else if (conv) {
                dot.classList.add('dot-paired');
            } else {
                dot.classList.add('dot-unpaired');
            }
        }

        if (label) {
            if (!bridgeState.connected) {
                label.textContent = `${bName} · Reconnecting`;
            } else if (conv) {
                label.textContent = `${bName} · Paired ${shortId(conv, 6)}`;
            } else {
                label.textContent = `${bName} · Unpaired`;
            }
        }

        if (modeBadge) {
            modeBadge.textContent = isModeB ? 'MODE B' : 'MODE A';
            modeBadge.classList.toggle('mode-b', isModeB);
            modeBadge.classList.toggle('mode-a', !isModeB);
        }

        if (surfaceLbl) {
            surfaceLbl.textContent = `${bName} · ${surface === 'launcher' ? 'Campaign Launcher' : '3D Workbench'}`;
        }
        if (stateTag) {
            if (!bridgeState.connected) {
                stateTag.textContent = 'Reconnecting';
                stateTag.className = 'mcp-state-tag warn';
            } else if (isWarnBrowser) {
                stateTag.textContent = conv ? `Webview · ${shortId(conv, 6)}` : 'Embedded View';
                stateTag.className = 'mcp-state-tag warn';
            } else if (conv) {
                stateTag.textContent = 'Paired';
                stateTag.className = 'mcp-state-tag paired';
            } else {
                stateTag.textContent = 'Unpaired';
                stateTag.className = 'mcp-state-tag unpaired';
            }
        }
        if (tabIdEl) {
            tabIdEl.textContent = bridgeState.tabId.length > 16
                ? `${bridgeState.tabId.slice(0, 15)}…`
                : bridgeState.tabId;
            tabIdEl.dataset.fullId = bridgeState.tabId;
        }
        if (convInput && document.activeElement !== convInput) {
            convInput.value = conv || '';
        }
        if (pairBtn) {
            pairBtn.textContent = conv ? 'Update Pair' : 'Pair This Tab';
        }
        if (unpairBtn) {
            unpairBtn.disabled = !conv;
            unpairBtn.classList.toggle('hidden', !conv);
        }
        if (launcherLink) {
            launcherLink.href = conv
                ? `./foundry_launcher.html?conv=${encodeURIComponent(conv)}`
                : './foundry_launcher.html';
        }
    }

    function flashActivity(message) {
        if (!message) return;
        const flashEl = byId('mcp-bridge-flash');
        if (!flashEl) return;
        flashEl.textContent = message;
        flashEl.classList.remove('hidden', 'fade-out');
        if (flashTimer) clearTimeout(flashTimer);
        flashTimer = setTimeout(() => {
            flashEl.classList.add('fade-out');
            setTimeout(() => flashEl.classList.add('hidden'), 260);
        }, 2500);
    }

    function setClaimFeedback(text, isError = false) {
        const msgEl = byId('mcp-bridge-claim-msg');
        if (!msgEl) return;
        msgEl.textContent = text || '';
        msgEl.classList.toggle('hidden', !text);
        msgEl.classList.toggle('is-error', Boolean(isError));
    }

    async function claimConversationOnServer(nextConversationId) {
        if (!bridgeToken) return false;
        const targetConv = typeof nextConversationId === 'string' && nextConversationId.trim().length > 0
            ? nextConversationId.trim()
            : null;
        try {
            const res = await fetch('/api/ui-bridge/claim', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-ui-bridge-token': bridgeToken,
                },
                body: JSON.stringify({
                    clientId: bridgeState.tabId,
                    conversationId: targetConv,
                }),
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                setClaimFeedback(errBody.error || `Pairing failed (${res.status})`, true);
                return false;
            }
            setConversationId(targetConv, { syncUrl: true });
            setClaimFeedback(
                targetConv ? `Paired to conversation ${shortId(targetConv, 8)}` : 'Tab unpaired',
                false
            );
            return true;
        } catch {
            setClaimFeedback('Unable to reach local Foundry server.', true);
            return false;
        }
    }

    function wireHudControls() {
        const hud = byId('mcp-bridge-hud');
        const pill = byId('mcp-bridge-pill');
        const popover = byId('mcp-bridge-popover');
        if (!hud || !pill || !popover || hud.dataset.wired === '1') return;
        hud.dataset.wired = '1';

        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            const isHidden = popover.classList.toggle('hidden');
            pill.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
            if (!isHidden) {
                setClaimFeedback('');
                syncFromTabsEndpoint();
            }
        });

        popover.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        document.addEventListener('click', () => {
            if (!popover.classList.contains('hidden')) {
                popover.classList.add('hidden');
                pill.setAttribute('aria-expanded', 'false');
            }
        });

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !popover.classList.contains('hidden')) {
                popover.classList.add('hidden');
                pill.setAttribute('aria-expanded', 'false');
            }
        });

        byId('btn-mcp-copy-tab')?.addEventListener('click', async () => {
            const copyBtn = byId('btn-mcp-copy-tab');
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(bridgeState.tabId);
                } else {
                    const ta = document.createElement('textarea');
                    ta.value = bridgeState.tabId;
                    document.body.appendChild(ta);
                    ta.select();
                    document.execCommand('copy');
                    document.body.removeChild(ta);
                }
                if (copyBtn) {
                    copyBtn.textContent = 'Copied';
                    if (copyTimer) clearTimeout(copyTimer);
                    copyTimer = setTimeout(() => {
                        copyBtn.textContent = 'Copy Tab ID';
                    }, 1400);
                }
            } catch {
                setClaimFeedback('Clipboard unavailable in this browser.', true);
            }
        });

        byId('btn-mcp-pair-tab')?.addEventListener('click', async () => {
            const raw = byId('inp-mcp-conv-id')?.value?.trim() || '';
            if (!raw) {
                setClaimFeedback('Paste a Conversation ID first.', true);
                byId('inp-mcp-conv-id')?.focus();
                return;
            }
            await claimConversationOnServer(raw);
        });

        byId('inp-mcp-conv-id')?.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const raw = e.currentTarget.value?.trim() || '';
                if (raw) await claimConversationOnServer(raw);
            }
        });

        byId('btn-mcp-unpair-tab')?.addEventListener('click', async () => {
            await claimConversationOnServer(null);
        });
    }

    function notifyModeIfChanged(prevMode, prevAllowB) {
        const prevEffective = prevMode === 'B' || prevAllowB ? 'B' : 'A';
        const nextEffective = bridgeState.executionMode === 'B' || bridgeState.allowModeB ? 'B' : 'A';
        if (prevEffective !== nextEffective && typeof options.onModeChange === 'function') {
            try { options.onModeChange(nextEffective); } catch {}
        }
    }

    function syncHeadersFromResponse(res) {
        if (!res || !res.headers) return;
        const prevMode = bridgeState.executionMode;
        const prevAllowB = bridgeState.allowModeB;
        const hdrMode = res.headers.get('x-execution-mode');
        if (hdrMode === 'A' || hdrMode === 'B') {
            bridgeState.executionMode = hdrMode;
        }
        const hdrAllowB = res.headers.get('x-allow-mode-b');
        if (hdrAllowB !== null) {
            bridgeState.allowModeB = hdrAllowB === '1' || hdrAllowB === 'true';
        }
        notifyModeIfChanged(prevMode, prevAllowB);
        const hdrConv = res.headers.get('x-bound-conversation');
        if (hdrConv !== null) {
            const clean = hdrConv.trim() || null;
            if (clean !== bridgeState.conversationId) {
                setConversationId(clean, { syncUrl: true });
                return;
            }
        }
        renderHud();
    }

    async function syncFromTabsEndpoint() {
        if (!bridgeToken || stopped) return;
        try {
            const res = await fetch('/api/ui-bridge/tabs', {
                cache: 'no-store',
                headers: { 'x-ui-bridge-token': bridgeToken },
            });
            if (!res.ok) return;
            syncHeadersFromResponse(res);
            const data = await res.json();
            if (!data || typeof data !== 'object') return;
            const prevMode = bridgeState.executionMode;
            const prevAllowB = bridgeState.allowModeB;
            if (data.executionMode === 'A' || data.executionMode === 'B') {
                bridgeState.executionMode = data.executionMode;
            }
            if (data.allowModeB !== undefined) {
                bridgeState.allowModeB = Boolean(data.allowModeB);
            }
            notifyModeIfChanged(prevMode, prevAllowB);
            const tabs = Array.isArray(data.tabs) ? data.tabs : (Array.isArray(data.clients) ? data.clients : []);
            const me = tabs.find(t => t && t.clientId === bridgeState.tabId);
            if (me) {
                const boundConv = me.boundConversationId ?? me.conversationId ?? null;
                if (boundConv && boundConv !== bridgeState.conversationId) {
                    setConversationId(boundConv, { syncUrl: true });
                    return;
                }
            }
            renderHud();
        } catch {
            // Endpoint optional on older servers
        }
    }

    async function probeDaemon() {
        try {
            const res = await fetch('/api/health', { cache: 'no-store' });
            if (!res.ok) return null;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return null;
            syncHeadersFromResponse(res);
            const data = await res.json();
            if (data && data.status === 'online' && typeof data.uiBridgeToken === 'string' && data.uiBridgeToken.length > 0) {
                if (data.executionMode === 'A' || data.executionMode === 'B') {
                    bridgeState.executionMode = data.executionMode;
                }
                if (data.allowModeB !== undefined) {
                    bridgeState.allowModeB = Boolean(data.allowModeB);
                }
                return data.uiBridgeToken;
            }
            return null;
        } catch {
            return null;
        }
    }

    function buildClientMetadata() {
        const isVisible = typeof document !== 'undefined' ? document.visibilityState !== 'hidden' : true;
        const isFocused = typeof document !== 'undefined' && typeof document.hasFocus === 'function'
            ? document.hasFocus()
            : false;
        return {
            clientId: bridgeState.tabId,
            surface: bridgeState.surface,
            browserKind: bridgeState.browserKind,
            bridgeVersion: BRIDGE_VERSION,
            conv: bridgeState.conversationId || null,
            conversationId: bridgeState.conversationId || null,
            ...(bridgeState.pendingLaunchId
                ? { launch: bridgeState.pendingLaunchId, launchId: bridgeState.pendingLaunchId }
                : {}),
            visible: isVisible,
            focused: isFocused,
            focusedAt: lastFocusedAt,
            lastFocusedAt,
            url: window.location.href,
        };
    }

    async function notifyFocus() {
        lastFocusedAt = Date.now();
        if (!bridgeToken || stopped || !bridgeState.identitySettled) return;
        try {
            const meta = buildClientMetadata();
            const res = await fetch('/api/ui-bridge/focus', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-ui-bridge-token': bridgeToken,
                },
                body: JSON.stringify(meta),
            });
            if (res.ok) syncHeadersFromResponse(res);
        } catch {
            // Ignore transient focus ping errors
        }
    }

    const onFocusEvent = () => {
        if (document.visibilityState !== 'hidden') notifyFocus();
    };
    window.addEventListener('focus', onFocusEvent);
    document.addEventListener('visibilitychange', onFocusEvent);
    window.addEventListener('pointerdown', onFocusEvent, { passive: true });

    function sendDisconnectBeacon() {
        if (!bridgeToken || disconnectSent) return;
        disconnectSent = true;
        const bodyJson = JSON.stringify({
            clientId: bridgeState.tabId,
            bridgeProof: bridgeToken,
            surface: bridgeState.surface,
        });
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                navigator.sendBeacon(
                    '/api/ui-bridge/disconnect',
                    new Blob([bodyJson], { type: 'application/json' })
                );
            } else {
                fetch('/api/ui-bridge/disconnect', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-ui-bridge-token': bridgeToken,
                    },
                    body: bodyJson,
                    keepalive: true,
                }).catch(() => {});
            }
        } catch {
            // Ignore tab close unload errors
        }
    }

    window.addEventListener('pagehide', sendDisconnectBeacon);
    window.addEventListener('beforeunload', sendDisconnectBeacon);

    async function postReply(id, response, error) {
        if (!bridgeToken) return;
        try {
            const meta = buildClientMetadata();
            const res = await fetch('/api/ui-bridge/reply', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-ui-bridge-token': bridgeToken,
                },
                body: JSON.stringify({
                    id,
                    ...meta,
                    ...(error
                        ? { error: String(error), ...(response ? { response } : {}) }
                        : { response }),
                }),
            });
            if (res.ok) syncHeadersFromResponse(res);
        } catch {
            // Ignore transient network errors on reply
        }
    }

    async function executeTask(action, payload = {}) {
        const bridgeMeta = {
            clientId: bridgeState.tabId,
            conversationId: bridgeState.conversationId,
            browserKind: bridgeState.browserKind,
            surface: bridgeState.surface,
            executionMode: bridgeState.executionMode,
            busy: bridgeLocks.busy,
            restoredFromReload: bridgeState.restoredFromReload,
        };
        const wb = typeof window !== 'undefined' ? window.WFC_WORKBENCH : null;

        try {
            if (action === 'ping') {
                return {
                    ok: true,
                    pong: true,
                    clientId: bridgeState.tabId,
                    conversationId: bridgeState.conversationId || null,
                    browserKind: bridgeState.browserKind,
                    surface: bridgeState.surface,
                    bridgeVersion: BRIDGE_VERSION,
                    activeTab: surface === 'launcher'
                        ? (window.FOUNDRY_LAUNCHER?.appState?.activeTab || null)
                        : (wb?.activeTab || wb?.state?.activeTabId || null),
                };
            }

            if (surface === 'launcher') {
                if (action === 'inspect') {
                    return inspectLauncher(bridgeMeta);
                }
                throw new Error(`Action "${action}" requires a 3D Workbench tab (current tab is Campaign Launcher).`);
            }

            switch (action) {
                case 'inspect':
                    return inspectWorkbench(wb, bridgeMeta);
                case 'configure':
                    return await configureWorkbench(wb, payload, bridgeMeta);
                case 'load_file':
                    return await loadFileInWorkbench(wb, payload, bridgeMeta, bridgeLocks);
                case 'run_step':
                    return await runWorkbenchStep(wb, payload, bridgeMeta);
                case 'export':
                    return exportFromWorkbench(wb, payload);
                default:
                    throw new Error(`Unsupported UI bridge action: ${action}`);
            }
        } finally {
            if (action === 'load_file') {
                bridgeLocks.pendingLoadFile = null;
            }
        }
    }

    async function handleReloadTask(task) {
        const payload = task.payload || {};
        const preserveState = payload.preserveState !== false;
        const hardReload = payload.hardReload !== false;
        const wb = typeof window !== 'undefined' ? window.WFC_WORKBENCH : null;
        let snapshotInfo = { saved: false, bytes: 0, customTileCount: 0 };

        try {
            if (preserveState && surface === 'workbench' && wb) {
                snapshotInfo = saveReloadSnapshot(bridgeState.tabId, wb);
            }
            writeStoredIdentity(bridgeState.tabId, bridgeState.conversationId, surface);
            await postReply(task.id, {
                ok: true,
                reloading: true,
                preserveState,
                hardReload,
                stateSnapshotted: Boolean(snapshotInfo.saved),
                snapshotBytes: snapshotInfo.bytes || 0,
                clientId: bridgeState.tabId,
                conversationId: bridgeState.conversationId || null,
                bridgeVersion: BRIDGE_VERSION,
            }, null);
        } finally {
            bridgeLocks.busy = false;
            bridgeLocks.activeTaskId = null;
            bridgeLocks.pendingLoadFile = null;
        }

        let targetHref = null;
        try {
            const nextUrl = new URL(window.location.href);
            nextUrl.searchParams.delete('launch');
            nextUrl.searchParams.delete('launchId');
            if (bridgeState.conversationId) {
                nextUrl.searchParams.set('conv', bridgeState.conversationId);
            }
            if (hardReload) {
                nextUrl.searchParams.set('_r', String(Date.now()));
            } else {
                nextUrl.searchParams.delete('_r');
            }
            targetHref = nextUrl.toString();
        } catch {
            targetHref = null;
        }

        setTimeout(() => {
            if (hardReload && targetHref && typeof window.location.replace === 'function') {
                window.location.replace(targetHref);
            } else {
                window.location.reload();
            }
        }, 30);
    }

    async function pollLoop() {
        const [probedToken] = await Promise.all([probeDaemon(), identityReadyPromise]);

        // Restore one-shot reload state snapshot automatically upon WFC_WORKBENCH init
        if (surface === 'workbench' && typeof window !== 'undefined' && window.WFC_WORKBENCH) {
            bridgeState.restoredFromReload = restoreReloadSnapshot(window.WFC_WORKBENCH, bridgeState.tabId);
        }

        bridgeToken = probedToken;
        if (!bridgeToken || stopped) {
            return; // Static server (e.g., serve_lab.mjs or file://) — silent no-op, HUD stays hidden
        }

        wireHudControls();
        bridgeState.connected = true;
        renderHud();
        syncFromTabsEndpoint();

        if (document.visibilityState !== 'hidden' && typeof document.hasFocus === 'function' && document.hasFocus()) {
            notifyFocus();
        }

        while (!stopped) {
            try {
                disconnectSent = false;
                const visible = typeof document !== 'undefined' && document.visibilityState !== 'hidden' ? '1' : '0';
                const focused = typeof document !== 'undefined' && typeof document.hasFocus === 'function' && document.hasFocus() ? '1' : '0';
                const sentLaunchId = bridgeState.pendingLaunchId;

                const params = new URLSearchParams({
                    clientId: bridgeState.tabId,
                    surface: bridgeState.surface,
                    browserKind: bridgeState.browserKind,
                    bridgeVersion: String(BRIDGE_VERSION),
                    conv: bridgeState.conversationId || '',
                    visible,
                    focused,
                    focusedAt: String(lastFocusedAt),
                    url: window.location.href,
                });
                if (sentLaunchId) {
                    params.set('launch', sentLaunchId);
                }

                const res = await fetch(`/api/ui-bridge/poll?${params.toString()}`, {
                    cache: 'no-store',
                    headers: { 'x-ui-bridge-token': bridgeToken },
                });

                if (res.status === 401 || res.status === 403 || res.status === 404) {
                    bridgeState.connected = false;
                    renderHud();
                    await waitMs(1500);
                    bridgeToken = await probeDaemon();
                    if (!bridgeToken) {
                        renderHud();
                        return;
                    }
                    bridgeState.connected = true;
                    renderHud();
                    continue;
                }
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }

                if (sentLaunchId && bridgeState.pendingLaunchId === sentLaunchId) {
                    bridgeState.pendingLaunchId = null;
                }
                if (!bridgeState.connected) {
                    bridgeState.connected = true;
                }
                syncHeadersFromResponse(res);
                backoffMs = 500;

                const data = await res.json();
                const task = data && data.task ? data.task : null;
                if (task && task.id && task.action) {
                    const isReloadTask = task.action === '__reload__'
                        || task.action === 'reload'
                        || (task.action === 'run_step' && String(task.payload?.step || '').trim().toLowerCase() === 'reload');
                    if (isReloadTask) {
                        await handleReloadTask(task);
                        return;
                    }
                    bridgeLocks.busy = true;
                    bridgeLocks.activeTaskId = task.id;
                    try {
                        const result = await executeTask(task.action, task.payload || {});
                        await postReply(task.id, result, null);
                        const summary = summarizeActivity(task.action, task.payload || {}, result);
                        if (summary) flashActivity(summary);
                    } catch (err) {
                        const errMsg = err?.message || String(err);
                        await postReply(task.id, {
                            ok: false,
                            error: errMsg,
                            action: task.action,
                            clientId: bridgeState.tabId,
                        }, errMsg);
                    } finally {
                        bridgeLocks.busy = false;
                        bridgeLocks.activeTaskId = null;
                        bridgeLocks.pendingLoadFile = null;
                        const overlay = byId('loading-overlay');
                        if (overlay && !overlay.classList.contains('hidden')) {
                            overlay.classList.add('hidden');
                        }
                    }
                }
            } catch {
                bridgeState.connected = false;
                renderHud();
                await waitMs(backoffMs);
                backoffMs = Math.min(8000, backoffMs * 2);
                if (!stopped) {
                    const refreshed = await probeDaemon();
                    if (refreshed) bridgeToken = refreshed;
                }
            }
        }
    }

    pollLoop();

    return {
        bridgeVersion: BRIDGE_VERSION,
        get clientId() { return bridgeState.tabId; },
        get conversationId() { return bridgeState.conversationId; },
        get browserKind() { return bridgeState.browserKind; },
        get surface() { return bridgeState.surface; },
        get connected() { return bridgeState.connected; },
        claimConversation: claimConversationOnServer,
        setConversationId,
        stop() {
            stopped = true;
            window.removeEventListener('focus', onFocusEvent);
            document.removeEventListener('visibilitychange', onFocusEvent);
            window.removeEventListener('pointerdown', onFocusEvent);
            window.removeEventListener('pagehide', sendDisconnectBeacon);
            window.removeEventListener('beforeunload', sendDisconnectBeacon);
            if (bc) {
                try { bc.close(); } catch {}
                bc = null;
            }
        },
    };
}

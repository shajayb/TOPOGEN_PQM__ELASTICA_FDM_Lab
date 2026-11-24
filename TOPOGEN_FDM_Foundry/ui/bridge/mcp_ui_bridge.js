/**
 * WFC-FDM Foundry — Browser UI Bridge Client (ui/bridge/mcp_ui_bridge.js)
 *
 * Lightweight same-origin long-poll client that connects the live 3D Workbench
 * (`window.WFC_WORKBENCH`) to `foundry_server.mjs` (`/api/ui-bridge/poll` and
 * `/api/ui-bridge/reply`) so Desktop MCP tools (`topogen_ui_*`) can inspect,
 * configure, step, and export from the active browser tab.
 *
 * Graceful No-Op: When served from static `serve_lab.mjs` or `file://`, the
 * initial `/api/health` probe fails or reports no bridge token and the client
 * exits silently without polling or console noise.
 */

const CLIENT_ID = `wb_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;

function inspectWorkbench(wb) {
    if (!wb) {
        return { available: false, error: 'window.WFC_WORKBENCH is not initialized' };
    }
    const st = wb.state || {};
    const graph = wb.weldedGraph || st.lastWeldedGraph || null;
    const fdm = wb.fdmResult || st.lastFDMResult || null;
    const solid = wb.solidData || st.lastSolidData || null;
    const fea = wb.feaResult || st.lastFEAResult || null;

    return {
        available: true,
        clientId: CLIENT_ID,
        url: typeof window !== 'undefined' ? window.location.href : null,
        activeTab: wb.activeTab || st.activeTabId || null,
        algorithm: wb.algorithm || st.currentAlgorithm || null,
        gridResolution: wb.gridResolution || { x: st.GRID_X, y: st.GRID_Y, z: st.GRID_Z },
        voxelSize: wb.voxelSize ?? st.VOXEL_SIZE ?? null,
        goldilocksMode: wb.goldilocksMode || st.goldilocksMode || 'H1',
        arctic: typeof wb.arctic === 'function' ? wb.arctic() : Boolean(st.arcticOn),
        fdmMode: st.fdmState?.mode || null,
        tubeRadiusM: st.tubeState?.radius ?? null,
        tubeInnerRadiusM: st.tubeState?.innerRadius ?? null,
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
            faces: Array.isArray(solid.faces) ? solid.faces.length : 0,
            maxPlanarityError: solid.maxPlanarityError ?? solid.planarity?.maxError ?? null,
        } : null,
        fea: fea ? {
            passed: fea.passed ?? null,
            maxDispMm: fea.displacements?.maxDispMm ?? fea.maxDispMm ?? null,
        } : null,
    };
}

function configureWorkbench(wb, rawPayload = {}) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const payload = { ...(rawPayload.params && typeof rawPayload.params === 'object' ? rawPayload.params : {}), ...rawPayload };
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
    const gridSpec = payload.gridResolution ?? payload.grid;
    if (gridSpec && typeof wb.setGridResolution === 'function') {
        let gx, gy, gz;
        if (typeof gridSpec === 'string') {
            const parts = gridSpec.split(/[xX,\s]+/).map(Number);
            [gx, gy, gz] = parts;
        } else if (Array.isArray(gridSpec)) {
            [gx, gy, gz] = gridSpec.map(Number);
        } else if (typeof gridSpec === 'object') {
            gx = Number(gridSpec.x); gy = Number(gridSpec.y); gz = Number(gridSpec.z);
        }
        if (Number.isFinite(gx) && Number.isFinite(gy) && Number.isFinite(gz)) {
            wb.setGridResolution(gx, gy, gz);
            applied.push('gridResolution');
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
        applied.push('fdmMode');
    }
    if ((payload.outerRadiusM !== undefined || payload.radius !== undefined) && wb.state?.tubeState) {
        const r = Number(payload.outerRadiusM ?? payload.radius);
        if (Number.isFinite(r) && r > 0) {
            wb.state.tubeState.radius = r;
            applied.push('outerRadiusM');
        }
    }
    const innerR = payload.innerRadiusM ?? payload.innerRadius;
    if (innerR !== undefined && wb.state?.tubeState) {
        const r = Number(innerR);
        if (Number.isFinite(r) && r >= 0) {
            wb.state.tubeState.innerRadius = r;
            applied.push('innerRadiusM');
        }
    }
    if (payload.tubeColorMode && typeof wb.setTubeColorMode === 'function') {
        wb.setTubeColorMode(String(payload.tubeColorMode));
        applied.push('tubeColorMode');
    }
    if (payload.goldilocksMode && typeof wb.setGoldilocksMode === 'function') {
        wb.setGoldilocksMode(String(payload.goldilocksMode));
        applied.push('goldilocksMode');
    }
    if (payload.arctic !== undefined && typeof wb.setArctic === 'function') {
        wb.setArctic(Boolean(payload.arctic));
        applied.push('arctic');
    }
    if (payload.camera === 'fit' && typeof wb.zoomFit === 'function') {
        wb.zoomFit();
        applied.push('camera');
    }

    return { configured: true, applied, state: inspectWorkbench(wb) };
}

function runWorkbenchStep(wb, payload = {}) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const step = String(payload.step || '').trim().toLowerCase();
    if (!step) throw new Error('run_step requires a step name');

    switch (step) {
        case 'generate':
        case 'wfc':
            if (typeof wb.setup === 'function') wb.setup({ collapseAll: true });
            if (typeof wb.draw === 'function') wb.draw();
            break;
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
        case 'pq_optimize':
            if (typeof wb.applyOnlyPQOptimization === 'function') wb.applyOnlyPQOptimization();
            break;
        case 'unroll':
            if (typeof wb.toggleUnroll3D === 'function') wb.toggleUnroll3D();
            break;
        case 'elastica':
            if (typeof wb.switchTab === 'function') wb.switchTab('tab-elastica');
            break;
        case 'fea':
            if (typeof wb.runFEA === 'function') wb.runFEA({ trigger: 'mcp' });
            break;
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
        default:
            throw new Error(`Unsupported workbench step: ${step}`);
    }

    return { step, completed: true, state: inspectWorkbench(wb) };
}

function exportFromWorkbench(wb, payload = {}) {
    if (!wb) throw new Error('window.WFC_WORKBENCH is not initialized');
    const format = String(payload.format || 'topology').trim().toLowerCase();
    const triggerDownload = Boolean(payload.download);

    const buildTopo = () => {
        const topology = typeof wb.buildFoundryTopologyJSONPayload === 'function'
            ? wb.buildFoundryTopologyJSONPayload()
            : null;
        if (triggerDownload && typeof wb.exportFoundryTopologyJSON === 'function') {
            wb.exportFoundryTopologyJSON();
        }
        return {
            format: 'topology',
            downloaded: triggerDownload,
            vertexCount: topology?.vertices?.length ?? 0,
            edgeCount: topology?.edges?.length ?? 0,
            anchorCount: topology?.anchors?.length ?? 0,
            topology: payload.includeData ? topology : undefined,
        };
    };

    const buildObj = () => {
        if (triggerDownload && typeof wb.exportQuadOBJ === 'function') {
            wb.exportQuadOBJ();
        }
        const solid = wb.solidData || wb.state?.lastSolidData || null;
        return {
            format: 'obj',
            downloaded: triggerDownload,
            vertexCount: solid?.vertices?.length ?? 0,
            faceCount: solid?.faces?.length ?? 0,
        };
    };

    if (format === 'topology' || format === 'json') return buildTopo();
    if (format === 'obj' || format === 'mesh') return buildObj();
    if (format === 'svg') {
        const solid = wb.solidData || wb.state?.lastSolidData || null;
        return {
            format: 'svg',
            downloaded: false,
            stripCount: Array.isArray(wb.faceLoopState?.strips) ? wb.faceLoopState.strips.length : 0,
            faceCount: solid?.faces?.length ?? 0,
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

function executeTask(action, payload) {
    const wb = typeof window !== 'undefined' ? window.WFC_WORKBENCH : null;
    switch (action) {
        case 'inspect':
            return inspectWorkbench(wb);
        case 'configure':
            return configureWorkbench(wb, payload);
        case 'run_step':
            return runWorkbenchStep(wb, payload);
        case 'export':
            return exportFromWorkbench(wb, payload);
        default:
            throw new Error(`Unsupported UI bridge action: ${action}`);
    }
}

export function initMcpUiBridge() {
    if (typeof window === 'undefined' || !window.location.protocol.startsWith('http')) {
        return { stop() {} };
    }

    let stopped = false;
    let bridgeToken = null;
    let backoffMs = 500;

    async function probeDaemon() {
        try {
            const res = await fetch('/api/health', { cache: 'no-store' });
            if (!res.ok) return null;
            const ct = res.headers.get('content-type') || '';
            if (!ct.includes('application/json')) return null;
            const data = await res.json();
            if (data && data.status === 'online' && typeof data.uiBridgeToken === 'string' && data.uiBridgeToken.length > 0) {
                return data.uiBridgeToken;
            }
            return null;
        } catch {
            return null;
        }
    }

    async function postReply(id, response, error) {
        if (!bridgeToken) return;
        try {
            await fetch('/api/ui-bridge/reply', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-ui-bridge-token': bridgeToken,
                },
                body: JSON.stringify({
                    id,
                    clientId: CLIENT_ID,
                    ...(error ? { error: String(error) } : { response }),
                }),
            });
        } catch {
            // Ignore transient network errors on reply
        }
    }

    async function pollLoop() {
        bridgeToken = await probeDaemon();
        if (!bridgeToken || stopped) {
            return; // Static server (e.g., serve_lab.mjs) — silent no-op
        }

        while (!stopped) {
            try {
                const visible = typeof document !== 'undefined' && document.visibilityState !== 'hidden' ? '1' : '0';
                const res = await fetch(
                    `/api/ui-bridge/poll?clientId=${encodeURIComponent(CLIENT_ID)}&visible=${visible}`,
                    {
                        cache: 'no-store',
                        headers: { 'x-ui-bridge-token': bridgeToken },
                    }
                );
                if (res.status === 401 || res.status === 403 || res.status === 404) {
                    // Daemon restarted or token rotated; re-probe once after delay
                    await new Promise(r => setTimeout(r, 2000));
                    bridgeToken = await probeDaemon();
                    if (!bridgeToken) return;
                    continue;
                }
                if (!res.ok) {
                    throw new Error(`HTTP ${res.status}`);
                }
                backoffMs = 500;
                const data = await res.json();
                const task = data && data.task ? data.task : null;
                if (task && task.id && task.action) {
                    try {
                        const result = executeTask(task.action, task.payload || {});
                        await postReply(task.id, result, null);
                    } catch (err) {
                        await postReply(task.id, null, err?.message || String(err));
                    }
                }
            } catch {
                await new Promise(r => setTimeout(r, backoffMs));
                backoffMs = Math.min(8000, backoffMs * 2);
            }
        }
    }

    pollLoop();

    return {
        clientId: CLIENT_ID,
        stop() {
            stopped = true;
        },
    };
}

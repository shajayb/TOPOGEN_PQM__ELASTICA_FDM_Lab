/**
 * WFC·FDM Foundry — Campaign Launcher Main Orchestrator (~175 lines)
 *
 * Wires Tabs 1–4, Z-up 3D Viewport, Verdict HUD, Draggable/Resizable Floating Panels,
 * Goldilocks H1/H2/H3 Progressive Disclosure, rAF-Coalesced SSE Telemetry Stream,
 * and Keyboard Shortcuts (`↑` / `↓` / `Space` to scrub candidates, `F` to Zoom Fit).
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import { API_BASE, appState, switchTab, upsertCandidate } from './state.js';
import { drawEnvelopeBox, initViewport3D, inspectCandidateByStem, prefetchCandidateBundle, zoomFitModel } from './viewport3d.js';
import { initVerdictHudAndModals } from './verdict_hud.js';
import { initTabBriefSandbox, populateBriefDropdown, populatePresetDropdown } from './tab_brief_sandbox.js';
import { initTabModeGates } from './tab_mode_gates.js';
import { initTabLiveMonitor, loadRunBundle, refreshRunsList, scheduleMonitorRender, scrubCandidateSelection } from './tab_live_monitor.js';
import { appendLogLine, initTabStorageLogs, renderStorageSummary } from './tab_storage_logs.js';

function makeDraggable(panelEl, handleEl) {
    if (!panelEl || !handleEl) return;
    let dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    handleEl.addEventListener('mousedown', (e) => {
        if (e.target.closest('button, a, input, select')) return;
        dragging = true;
        const r = panelEl.getBoundingClientRect();
        sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
        panelEl.style.right = 'auto';
    });
    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        panelEl.style.left = `${Math.max(4, ox + e.clientX - sx)}px`;
        panelEl.style.top = `${Math.max(4, oy + e.clientY - sy)}px`;
    });
    window.addEventListener('mouseup', () => { dragging = false; });
}

function initFloatingPanelsAndShortcuts() {
    document.querySelectorAll('.ui-tab').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Goldilocks Progressive Disclosure Switcher
    const goldilocksLevels = ['H1 · Clean', 'H2 · Guide', 'H3 · Telemetry'];
    let gIdx = 1;
    document.getElementById('btn-goldilocks-mode')?.addEventListener('click', (e) => {
        gIdx = (gIdx + 1) % 3;
        document.body.classList.remove('goldilocks-h1', 'goldilocks-h2', 'goldilocks-h3');
        document.body.classList.add(`goldilocks-h${gIdx + 1}`);
        e.currentTarget.textContent = goldilocksLevels[gIdx];
        if (gIdx === 2) {
            document.getElementById('telemetry-collapsible')?.classList.remove('hidden');
            document.getElementById('telemetry-panel')?.classList.remove('minimized');
        }
    });

    document.getElementById('btn-sidebar-minimize')?.addEventListener('click', (e) => {
        const col = document.getElementById('sidebar-collapsible');
        const side = document.getElementById('left-sidebar');
        const hidden = col.classList.toggle('hidden');
        side.classList.toggle('minimized', hidden);
        e.currentTarget.textContent = hidden ? '+' : '–';
    });

    document.getElementById('btn-telemetry-minimize')?.addEventListener('click', (e) => {
        const col = document.getElementById('telemetry-collapsible');
        const pan = document.getElementById('telemetry-panel');
        const hidden = col.classList.toggle('hidden');
        pan.classList.toggle('minimized', hidden);
        e.currentTarget.textContent = hidden ? '+' : '–';
    });

    makeDraggable(document.getElementById('left-sidebar'), document.getElementById('sidebar-drag-header'));
    makeDraggable(document.getElementById('telemetry-panel'), document.getElementById('telemetry-drag-header'));

    // Sidebar East Resize
    const side = document.getElementById('left-sidebar');
    const handle = document.getElementById('sidebar-resize-e');
    if (side && handle) {
        let resizing = false, startX = 0, startW = 404;
        handle.addEventListener('mousedown', (e) => {
            resizing = true; startX = e.clientX; startW = side.getBoundingClientRect().width;
            e.preventDefault();
        });
        window.addEventListener('mousemove', (e) => {
            if (!resizing) return;
            const w = Math.max(330, Math.min(650, startW + (e.clientX - startX)));
            side.style.width = `${w}px`;
            document.documentElement.style.setProperty('--sidebar-width', `${w}px`);
        });
        window.addEventListener('mouseup', () => { resizing = false; });
    }

    // Keyboard Shortcuts: ↑ / ↓ / Space to scrub candidates, F to Zoom Fit
    window.addEventListener('keydown', (e) => {
        const tag = (e.target?.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
        if (e.metaKey || e.ctrlKey || e.altKey) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            scrubCandidateSelection(1);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            scrubCandidateSelection(-1);
        } else if (e.key === ' ') {
            e.preventDefault();
            scrubCandidateSelection(e.shiftKey ? -1 : 1);
        } else if (e.key === 'f' || e.key === 'F') {
            e.preventDefault();
            zoomFitModel();
        }
    });
}

function connectSSE() {
    if (appState.sseSource) appState.sseSource.close();
    const sse = new EventSource(`${API_BASE}/api/stream`);
    appState.sseSource = sse;

    sse.onmessage = async (msg) => {
        let evt;
        try { evt = JSON.parse(msg.data); } catch { return; }
        const { type, payload } = evt;

        if (type === 'log' && payload) {
            appendLogLine(payload.level, payload.message, payload.ts);
            return;
        }
        if (type === 'storage_reset' && payload) {
            renderStorageSummary(payload.storage);
            return;
        }

        if (payload?.runId && payload.runId === appState.currentRunId) {
            if (type === 'candidate_evaluated' && payload.candidate) {
                upsertCandidate(payload.candidate);
                if (payload.candidate.isPareto) prefetchCandidateBundle(payload.candidate);
            }
            if (payload.paretoFront && Array.isArray(payload.paretoFront)) {
                const pNames = new Set(payload.paretoFront.map(p => p.name));
                for (const c of appState.currentCandidates) {
                    c.isPareto = pNames.has(c.name);
                }
            }
            if (payload.champion) {
                if (!appState.currentRunState) appState.currentRunState = {};
                const prevChamp = appState.currentRunState.champion?.name;
                appState.currentRunState.champion = payload.champion;
                if (document.getElementById('chk-auto-follow')?.checked && payload.champion.name !== prevChamp) {
                    inspectCandidateByStem(payload.champion.name, appState.currentCandidates.length <= 2);
                }
            }
            if (appState.currentRunState) {
                for (const k of ['status', 'totals', 'gates', 'currentRound', 'maxRounds', 'elapsedSec', 'throughputCandPerSec', 'topFailureModes']) {
                    if (payload[k] !== undefined) appState.currentRunState[k] = payload[k];
                }
                scheduleMonitorRender();
            }
            if (type === 'campaign_completed' || type === 'campaign_stopped' || type === 'campaign_failed') {
                await refreshRunsList(appState.currentRunId);
                await loadRunBundle(appState.currentRunId);
            }
        }
    };
}

async function bootLauncher() {
    initViewport3D();
    initVerdictHudAndModals();
    initFloatingPanelsAndShortcuts();
    initTabBriefSandbox();
    initTabModeGates();
    initTabLiveMonitor();
    initTabStorageLogs();

    try {
        const hRes = await fetch(`${API_BASE}/api/health`);
        if (!hRes.ok) throw new Error('Health check failed');
        const health = await hRes.json();
        appState.daemonOnline = true;

        document.getElementById('daemon-dot').className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 pulse-live flex-none';
        document.getElementById('daemon-status-label').textContent = 'DAEMON ONLINE :8787';
        document.getElementById('seal-hash-readout').textContent =
            `Gen:${health.seal?.generatorSealHash?.slice(0, 8)} · Ver:${health.seal?.verifierSealHash?.slice(0, 8)}`;

        populatePresetDropdown(health.presets || []);
        renderStorageSummary(health.storage);

        const bRes = await fetch(`${API_BASE}/api/briefs`);
        const bData = await bRes.json();
        populateBriefDropdown(bData.briefs || []);

        await refreshRunsList(health.activeRunId || 'pilot_v2_campaign');
        if (appState.currentRunId) await loadRunBundle(appState.currentRunId);
        connectSSE();
    } catch {
        appState.daemonOnline = false;
        document.getElementById('daemon-dot').className = 'w-2.5 h-2.5 rounded-full bg-rose-400 flex-none';
        document.getElementById('daemon-status-label').textContent = 'OFFLINE (RUN: node TOPOGEN_FDM_Foundry/foundry_server.mjs)';
        drawEnvelopeBox({ maxPlanX: 1.0, maxPlanY: 1.0, targetHeightZ: 2.0, groundZ: 0 });
        zoomFitModel();
    }

    window.FOUNDRY_LAUNCHER = { appState, switchTab, zoomFitModel, inspectCandidateByStem };
}

bootLauncher();

/**
 * WFC·FDM Foundry — Tab 2: Execution Mode (A/B), 1-Click Speed Profiles & Gates
 *
 * Inputs / Outputs:
 *   - 1-Click Speed Profile Bar:
 *       ⚡ Lightning (~1.5s · 10 cands) -> `searchProfile: 'lightning'`
 *       🚀 Interactive (~4s · 25 cands) -> `searchProfile: 'interactive'` (Default!)
 *       🔬 Deep Sweep (~12s · 60 cands) -> `searchProfile: 'thorough'`
 *   - Mode A (Sealed) vs Mode B (Adaptive Evolution) selector.
 *   - Gate `G1`–`G7` checkboxes & quick presets (`Search G1–5`, `Search+HTML`,
 *     `Full G1–7`, `Report+Video`), plus `launchFoundryCampaign()` & `stopActiveSwarm()`.
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import { API_BASE, SPEED_PROFILES, appState, switchTab } from './state.js';
import { buildBriefFromForm } from './tab_brief_sandbox.js';
import { loadRunBundle, refreshRunsList } from './tab_live_monitor.js';
import { appendLogLine } from './tab_storage_logs.js';

const GATE_PRESETS = {
    search: ['gate1_benchmarks', 'gate2_smoke', 'gate3_explore', 'gate4_optimize', 'gate5_pareto'],
    report: ['gate1_benchmarks', 'gate2_smoke', 'gate3_explore', 'gate4_optimize', 'gate5_pareto', 'gate6_report'],
    full:   ['gate1_benchmarks', 'gate2_smoke', 'gate3_explore', 'gate4_optimize', 'gate5_pareto', 'gate6_report', 'gate7_video'],
    post:   ['gate5_pareto', 'gate6_report', 'gate7_video'],
};

export function setExecutionMode(mode) {
    appState.executionMode = mode === 'B' ? 'B' : 'A';
    document.getElementById('card-mode-a')?.classList.toggle('active-a', appState.executionMode === 'A');
    document.getElementById('card-mode-b')?.classList.toggle('active-b', appState.executionMode === 'B');

    const pill = document.getElementById('active-mode-pill');
    if (pill) {
        if (appState.executionMode === 'A') {
            pill.textContent = 'MODE A · SEALED';
            pill.className = 'px-1.5 py-0.5 rounded text-[9px] font-mono bg-cyan-950/80 border border-cyan-500/40 text-cyan-300';
        } else {
            pill.textContent = 'MODE B · EVOLUTION';
            pill.className = 'px-1.5 py-0.5 rounded text-[9px] font-mono bg-pink-950/80 border border-pink-500/40 text-pink-300';
        }
    }
}

export function setSpeedProfile(profileKey, syncInputs = true) {
    const prof = SPEED_PROFILES[profileKey];
    appState.searchProfile = prof ? prof.id : 'custom';

    document.querySelectorAll('.speed-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.speedProfile === appState.searchProfile);
    });

    const topBadge = document.getElementById('active-speed-pill');
    if (topBadge) {
        topBadge.textContent = prof ? prof.label.toUpperCase() : 'CUSTOM BUDGET';
    }

    if (prof && syncInputs) {
        const cEl = document.getElementById('cfg-concurrency');
        const rEl = document.getElementById('cfg-rounds');
        const pEl = document.getElementById('cfg-per-round');
        if (cEl) cEl.value = prof.concurrency;
        if (rEl) rEl.value = prof.maxRounds;
        if (pEl) pEl.value = prof.candidatesPerRound;
    }
}

export function readSelectedGates() {
    const out = {};
    document.querySelectorAll('[data-gate-chk]').forEach(chk => {
        out[chk.dataset.gateChk] = chk.checked;
    });
    return out;
}

export async function launchFoundryCampaign() {
    if (!appState.daemonOnline) {
        alert('Foundry Daemon is offline. Start it via:\nnode TOPOGEN_FDM_Foundry/foundry_server.mjs');
        return;
    }

    let briefData;
    try {
        briefData = buildBriefFromForm();
    } catch (err) {
        alert('Invalid brief configuration: ' + err.message);
        return;
    }

    const gates = readSelectedGates();
    if (!Object.values(gates).some(Boolean)) {
        alert('Select at least one Foundry Gate to execute.');
        return;
    }

    const attachExisting = document.getElementById('cfg-attach-existing')?.checked;
    const targetRunId = attachExisting ? document.getElementById('sel-run-id')?.value : null;

    const concurrency = Number(document.getElementById('cfg-concurrency')?.value) || 8;
    const maxRounds = Number(document.getElementById('cfg-rounds')?.value) || 2;
    const candidatesPerRound = Number(document.getElementById('cfg-per-round')?.value) || 12;
    const keepFailedMeshes = Boolean(document.getElementById('cfg-keep-meshes')?.checked);

    const payload = {
        briefData,
        executionMode: appState.executionMode,
        gates,
        targetRunId,
        searchConfig: {
            searchProfile: appState.searchProfile || 'interactive',
            concurrency,
            maxRounds,
            candidatesPerRound,
            keepFailedMeshes,
        },
    };

    const res = await fetch(`${API_BASE}/api/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'Launch failed');
        return;
    }

    appState.currentRunId = data.runId;
    appState.selectedCandidateStem = null;
    appState.evalTimestampsMs = [];
    appState.throughputCandPerSec = 0;

    switchTab('tab-monitor');
    await refreshRunsList(appState.currentRunId);
    await loadRunBundle(appState.currentRunId);
}

export async function stopActiveSwarm() {
    try {
        const res = await fetch(`${API_BASE}/api/stop`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'User clicked Stop Swarm in Launcher UI' }),
        });
        const data = await res.json();
        appendLogLine('warn', `Swarm stopped (${data.runId || 'idle'}). Partial results & Pareto summary preserved.`);
        await refreshRunsList(appState.currentRunId);
        if (appState.currentRunId) await loadRunBundle(appState.currentRunId);
    } catch (err) {
        appendLogLine('error', `Stop failed: ${err.message}`);
    }
}

export function initTabModeGates() {
    document.getElementById('card-mode-a')?.addEventListener('click', () => setExecutionMode('A'));
    document.getElementById('card-mode-b')?.addEventListener('click', () => setExecutionMode('B'));

    // Speed Profile pills
    document.querySelectorAll('.speed-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            setSpeedProfile(btn.dataset.speedProfile, true);
        });
    });

    // Mark profile as 'custom' when user manually edits round/count inputs
    ['cfg-rounds', 'cfg-per-round'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => {
            setSpeedProfile('custom', false);
        });
    });

    // Gate Presets
    document.querySelectorAll('.gate-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.gate-preset-btn').forEach(b => b.classList.remove('seg-on'));
            btn.classList.add('seg-on');
            const set = new Set(GATE_PRESETS[btn.dataset.gatePreset] || GATE_PRESETS.search);
            document.querySelectorAll('[data-gate-chk]').forEach(chk => {
                chk.checked = set.has(chk.dataset.gateChk);
            });
            if (btn.dataset.gatePreset === 'post') {
                const attach = document.getElementById('cfg-attach-existing');
                if (attach) attach.checked = true;
            }
        });
    });

    document.getElementById('btn-top-launch')?.addEventListener('click', launchFoundryCampaign);
    document.getElementById('btn-panel-launch')?.addEventListener('click', launchFoundryCampaign);
    document.getElementById('btn-top-stop')?.addEventListener('click', stopActiveSwarm);

    // Initialize default speed profile ('interactive')
    setSpeedProfile('interactive', true);
}

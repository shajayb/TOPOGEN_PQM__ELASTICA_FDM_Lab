/**
 * WFC·FDM Foundry — Tab 3: Live Search Monitor, Interactive Pareto & Keyboard Scrubbing
 *
 * Inputs / Outputs:
 *   - Live Throughput indicator (`cand/s` badge) + progress bar + Gate tracker.
 *   - Interactive SVG Pareto scatter plot with axis metric selector (`Mass vs Unrolled Area`,
 *     `Elements vs Funicular Eff`, `Mass vs Deflection`, `Area vs Buckling SF`) +
 *     hover/click 0ms cached 3D preview!
 *   - Candidate stream table with `↑` / `↓` / `Space` keyboard navigation + filter tabs.
 *   - "⏭ Finish Round & Freeze Best" steering button (`POST /api/nudge` -> `finish_round`,
 *     with graceful fallback to `/api/stop`).
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import { API_BASE, appState, on, scheduleUIUpdate, setCandidatesList } from './state.js';
import { inspectCandidateByStem, prefetchCandidateBundle } from './viewport3d.js';
import { appendLogLine, renderStorageSummary } from './tab_storage_logs.js';

const PARETO_AXIS_MODES = {
    mass_vs_area: {
        xLabel: 'Mass (kg)',
        yLabel: 'Unrolled (m²)',
        xVal: p => Number(p.massKg || 0),
        yVal: p => Number(p.totalUnrolledSurfaceAreaM2 || (p.massKg || 0) * 0.14),
        xFmt: v => `${v.toFixed(1)}kg`,
        yFmt: v => v.toFixed(2),
    },
    bars_vs_funic: {
        xLabel: 'Elements (bars)',
        yLabel: 'Funicular Eff (%)',
        xVal: p => Number(p.nEdges || 0),
        yVal: p => Number((p.funicularEfficiency || 0) * 100),
        xFmt: v => `${Math.round(v)}b`,
        yFmt: v => `${v.toFixed(0)}%`,
    },
    mass_vs_disp: {
        xLabel: 'Mass (kg)',
        yLabel: 'Deflection (mm)',
        xVal: p => Number(p.massKg || 0),
        yVal: p => Number(p.maxDispMm || 0),
        xFmt: v => `${v.toFixed(1)}kg`,
        yFmt: v => `${v.toFixed(2)}`,
    },
    area_vs_sfb: {
        xLabel: 'Unrolled (m²)',
        yLabel: 'Buckling SF (×)',
        xVal: p => Number(p.totalUnrolledSurfaceAreaM2 || 0),
        yVal: p => Math.min(50, Number(p.sfBuckling || 0)),
        xFmt: v => `${v.toFixed(2)}m²`,
        yFmt: v => `${v.toFixed(1)}×`,
    },
};

export function getFilteredCandidates() {
    let list = [...appState.currentCandidates].reverse();
    if (appState.candidateFilter === 'passed') list = list.filter(c => c.passed);
    else if (appState.candidateFilter === 'pareto') list = list.filter(c => c.isPareto);
    else if (appState.candidateFilter === 'failed') list = list.filter(c => !c.passed);
    return list;
}

export function scrubCandidateSelection(delta = 1) {
    const list = getFilteredCandidates();
    if (list.length === 0) return;
    const curIdx = list.findIndex(c => c.name === appState.selectedCandidateStem);
    let nextIdx = curIdx < 0 ? 0 : (curIdx + delta + list.length) % list.length;
    const nextCand = list[nextIdx];
    if (nextCand) {
        inspectCandidateByStem(nextCand.name, false);
        const row = document.querySelector(`[data-row-stem="${CSS.escape(nextCand.name)}"]`);
        row?.scrollIntoView({ block: 'nearest' });
    }
}

export function renderGateRows(gates = []) {
    const wrap = document.getElementById('live-gates-list');
    if (!wrap) return;
    const iconFor = st => ({
        passed: '✓', running: '●', failed: '✕', stopped: '■', skipped: '–', pending: '○',
    }[st] || '○');
    const badgeCls = st => ({
        passed: 'text-emerald-400', running: 'text-amber-300 pulse-live', failed: 'text-rose-400',
        stopped: 'text-amber-400', skipped: 'text-gray-600', pending: 'text-gray-400',
    }[st] || 'text-gray-400');

    wrap.innerHTML = gates.map(g => `
        <div class="gate-row ${g.status}">
            <div class="flex items-center gap-1.5 min-w-0">
                <span class="font-mono font-bold ${badgeCls(g.status)}">${iconFor(g.status)}</span>
                <span class="font-semibold text-gray-200">${g.short}</span>
                <span class="text-[9px] text-gray-400 truncate">${g.detail || g.name}</span>
            </div>
            <span class="font-mono text-[8.5px] text-gray-400 flex-none">${g.elapsedSec ? g.elapsedSec + 's' : g.status.toUpperCase()}</span>
        </div>
    `).join('');
}

export function renderParetoScatter() {
    const svg = document.getElementById('pareto-svg');
    if (!svg) return;
    const spec = PARETO_AXIS_MODES[appState.paretoAxes] || PARETO_AXIS_MODES.mass_vs_area;
    const pts = appState.currentCandidates.filter(c => c.massKg > 0 || c.nEdges > 0);

    if (pts.length === 0) {
        svg.innerHTML = `<text x="170" y="86" text-anchor="middle" fill="#64748b" font-size="10" font-family="monospace">Waiting for evaluated candidates...</text>`;
        return;
    }

    const padL = 38, padR = 14, padT = 14, padB = 24;
    const W = 340, H = 165;
    const pw = W - padL - padR, ph = H - padT - padB;

    const xs = pts.map(spec.xVal);
    const ys = pts.map(spec.yVal);
    const minX = Math.min(...xs) * 0.92, maxX = Math.max(...xs, minX + 0.2) * 1.06;
    const minY = Math.min(...ys) * 0.90, maxY = Math.max(...ys, minY + 0.05) * 1.08;

    const sx = v => padL + ((v - minX) / Math.max(1e-6, maxX - minX)) * pw;
    const sy = v => padT + ph - ((v - minY) / Math.max(1e-6, maxY - minY)) * ph;

    let html = `
        <line x1="${padL}" y1="${padT + ph}" x2="${W - padR}" y2="${padT + ph}" stroke="#334155" stroke-width="1"/>
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + ph}" stroke="#334155" stroke-width="1"/>
        <text x="${padL}" y="${H - 6}" fill="#94a3b8" font-size="8.5" font-family="monospace">${spec.xFmt(minX)}</text>
        <text x="${W - padR}" y="${H - 6}" text-anchor="end" fill="#94a3b8" font-size="8.5" font-family="monospace">${spec.xFmt(maxX)}</text>
        <text x="${padL - 4}" y="${padT + 6}" text-anchor="end" fill="#94a3b8" font-size="8" font-family="monospace">${spec.yFmt(maxY)}</text>
        <text x="${padL - 4}" y="${padT + ph}" text-anchor="end" fill="#94a3b8" font-size="8" font-family="monospace">${spec.yFmt(minY)}</text>
    `;

    const paretoPts = pts.filter(p => p.isPareto).sort((a, b) => spec.xVal(a) - spec.xVal(b));
    if (paretoPts.length >= 2) {
        const poly = paretoPts.map(p => `${sx(spec.xVal(p)).toFixed(1)},${sy(spec.yVal(p)).toFixed(1)}`).join(' ');
        html += `<polyline points="${poly}" fill="none" stroke="#22d3ee" stroke-width="1.3" stroke-dasharray="3,2"/>`;
    }

    const champName = appState.currentRunState?.champion?.name;
    for (const p of pts) {
        const cx = sx(spec.xVal(p)).toFixed(1);
        const cy = sy(spec.yVal(p)).toFixed(1);
        const isChamp = p.name === champName;
        const isSel = p.name === appState.selectedCandidateStem;
        const fill = isChamp ? '#10b981' : !p.passed ? '#f43f5e' : p.isPareto ? '#22d3ee' : p.synthesized ? '#ec4899' : '#94a3b8';
        const r = isChamp ? 5.2 : p.isPareto ? 4.2 : 3.1;
        if (isSel) {
            html += `<circle cx="${cx}" cy="${cy}" r="${r + 3.4}" fill="none" stroke="#fbbf24" stroke-width="1.6"/>`;
        }
        html += `<circle data-pt-stem="${p.name}" cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" fill-opacity="0.92" class="cursor-pointer hover:stroke-white" stroke="#0f172a" stroke-width="0.8"><title>${p.name} | ${(p.massKg || 0).toFixed(2)}kg | ${(p.totalUnrolledSurfaceAreaM2 || 0).toFixed(3)}m² | ${p.nEdges || 0} bars</title></circle>`;
    }
    svg.innerHTML = html;

    svg.querySelectorAll('[data-pt-stem]').forEach(el => {
        el.addEventListener('click', () => inspectCandidateByStem(el.dataset.ptStem, false));
        el.addEventListener('mouseenter', () => {
            // Instant 0ms hover preview when auto-follow is paused or campaign is idle!
            const isRunning = appState.currentRunState?.status === 'running';
            if (!isRunning || !document.getElementById('chk-auto-follow')?.checked) {
                inspectCandidateByStem(el.dataset.ptStem, false);
            }
        });
    });
}

export function renderCandidateStreamTable() {
    const tbody = document.getElementById('cand-stream-tbody');
    if (!tbody) return;
    const champName = appState.currentRunState?.champion?.name;
    const list = getFilteredCandidates();

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="p-2 text-center text-gray-500">No matching candidates yet.</td></tr>`;
        return;
    }

    tbody.innerHTML = list.slice(0, 80).map(c => {
        const isChamp = c.name === champName;
        const isSel = c.name === appState.selectedCandidateStem;
        const gStr = (c.config?.gridResolution || []).join('×');
        const stBadge = isChamp
            ? '<span class="text-emerald-300 font-bold">★</span>'
            : c.passed
            ? (c.isPareto ? '<span class="text-cyan-300 font-bold">P</span>' : '<span class="text-emerald-400">✓</span>')
            : '<span class="text-rose-400">✕</span>';
        return `
            <tr data-row-stem="${c.name}" class="cursor-pointer hover:bg-gray-800/80 ${isSel ? 'bg-gray-800 ring-1 ring-inset ring-amber-400/50' : ''}">
                <td class="p-1 truncate max-w-[116px] ${c.synthesized ? 'text-pink-300' : 'text-gray-200'}" title="${c.name}">${c.name}</td>
                <td class="p-1 text-gray-400">${gStr}</td>
                <td class="p-1 text-right text-cyan-300">${c.totalUnrolledSurfaceAreaM2 ? c.totalUnrolledSurfaceAreaM2.toFixed(2) : '—'}</td>
                <td class="p-1 text-right text-gray-200">${c.nEdges || '—'}</td>
                <td class="p-1 text-right text-gray-300">${c.massKg ? c.massKg.toFixed(2) : '—'}</td>
                <td class="p-1 text-center">${stBadge}</td>
            </tr>
        `;
    }).join('');

    tbody.querySelectorAll('[data-row-stem]').forEach(tr => {
        tr.addEventListener('click', () => inspectCandidateByStem(tr.dataset.rowStem, false));
    });
}

export function renderFailureHistogram(modes = []) {
    const box = document.getElementById('failure-modes-bars');
    if (!box) return;
    if (!modes || modes.length === 0) {
        box.innerHTML = '<div class="text-gray-500">0 failure rejections recorded.</div>';
        return;
    }
    const maxC = Math.max(1, ...modes.map(m => m.count));
    box.innerHTML = modes.slice(0, 5).map(m => `
        <div>
            <div class="flex justify-between text-[9px]">
                <span class="text-gray-300">${m.mode}</span>
                <span class="text-rose-300">${m.count} (${m.pctOfFailures}%)</span>
            </div>
            <div class="w-full h-1.5 bg-gray-800 rounded overflow-hidden mt-0.5">
                <div class="h-full bg-rose-500" style="width:${Math.round((m.count / maxC) * 100)}%"></div>
            </div>
        </div>
    `).join('');
}

export function applyRunStateToUI(state) {
    if (!state) return;
    appState.currentRunState = state;
    const isRunning = state.status === 'running' || state.status === 'initializing';

    const setDis = (id, dis) => {
        const el = document.getElementById(id);
        if (el) el.disabled = dis;
    };
    setDis('btn-top-stop', !isRunning);
    setDis('btn-finish-round', !isRunning);
    setDis('btn-top-launch', isRunning);
    setDis('btn-panel-launch', isRunning);

    const planned = state.totals?.planned || state.totals?.evaluated || 0;
    const evald = state.totals?.evaluated || 0;
    const pct = planned > 0 ? Math.min(100, Math.round((evald / planned) * 100)) : (state.status === 'completed' ? 100 : 0);

    const kEval = document.getElementById('kpi-eval');
    if (kEval) kEval.textContent = planned > 0 ? `${evald} / ${planned}` : `${evald}`;
    const kPass = document.getElementById('kpi-pass');
    if (kPass) kPass.textContent = `${state.totals?.passed || 0} (${state.totals?.passRatePct || 0}%)`;
    const kPar = document.getElementById('kpi-pareto');
    if (kPar) kPar.textContent = `${state.totals?.paretoFrontCount || 0}`;
    const kElap = document.getElementById('kpi-elapsed');
    if (kElap) kElap.textContent = `${Number(state.elapsedSec || 0).toFixed(1)}s`;

    const bar = document.getElementById('live-progress-bar');
    if (bar) bar.style.width = `${pct}%`;

    const rate = state.throughputCandPerSec ?? appState.throughputCandPerSec ?? (state.elapsedSec > 0.1 ? +(evald / state.elapsedSec).toFixed(1) : 0);
    const rateBadge = document.getElementById('kpi-throughput-badge');
    if (rateBadge) {
        rateBadge.textContent = isRunning
            ? `⚡ ${rate} cand/s`
            : `${state.status.toUpperCase()}${rate > 0 ? ` · ${rate} cand/s` : ''}`;
    }

    const sub = document.getElementById('top-progress-sub');
    if (sub) {
        sub.textContent = `[${state.runId}] ${state.status.toUpperCase()} · Mode ${state.executionMode} · Round ${state.currentRound || 0}/${state.maxRounds || 2} · Best: ${state.champion?.name || 'searching...'}`;
    }

    renderGateRows(state.gates || []);
    renderFailureHistogram(state.topFailureModes || []);
    renderParetoScatter();
    renderCandidateStreamTable();

    if (state.deliverables?.reportHtml) {
        const lnk = document.getElementById('lnk-open-report');
        if (lnk) lnk.href = `${API_BASE}/${state.deliverables.reportHtml}`;
    }
}

export function scheduleMonitorRender() {
    scheduleUIUpdate('monitor_panel', () => {
        if (appState.currentRunState) applyRunStateToUI(appState.currentRunState);
        else {
            renderParetoScatter();
            renderCandidateStreamTable();
        }
    });
}

export async function refreshRunsList(preferRunId = null) {
    try {
        const res = await fetch(`${API_BASE}/api/runs`);
        if (!res.ok) return;
        const data = await res.json();
        renderStorageSummary(data.storage);

        const sel = document.getElementById('sel-run-id');
        if (!sel) return;
        sel.innerHTML = '';
        for (const r of data.runs || []) {
            const opt = document.createElement('option');
            opt.value = r.runId;
            const tag = r.status === 'running' ? '● LIVE' : r.status.toUpperCase();
            opt.textContent = `[${tag}] ${r.runId} (${r.passed}/${r.evaluated} pass · Mode ${r.executionMode})`;
            sel.appendChild(opt);
        }
        const target = preferRunId || data.activeRunId || appState.currentRunId || data.runs?.[0]?.runId;
        if (target) {
            sel.value = target;
            appState.currentRunId = target;
        }
    } catch {}
}

export async function loadRunBundle(runId) {
    if (!runId) return;
    appState.currentRunId = runId;
    try {
        const res = await fetch(`${API_BASE}/api/state?runId=${encodeURIComponent(runId)}`);
        if (!res.ok) return;
        const bundle = await res.json();
        setCandidatesList(bundle.candidates || []);
        applyRunStateToUI(bundle.state);

        const term = document.getElementById('live-log-terminal');
        if (term) {
            term.innerHTML = '';
            for (const ev of bundle.events || []) {
                appendLogLine(ev.level, ev.message, ev.ts);
            }
        }

        const heroStem = bundle.state?.champion?.name || appState.currentCandidates[appState.currentCandidates.length - 1]?.name;
        if (heroStem) {
            await inspectCandidateByStem(heroStem, true);
        }

        // Warm-prefetch Pareto front candidates in background for 0ms Pareto hover!
        const paretoCands = appState.currentCandidates.filter(c => c.isPareto).slice(0, 14);
        for (const pc of paretoCands) {
            prefetchCandidateBundle(pc);
        }
    } catch {}
}

export async function finishRoundAndFreezeBest() {
    if (!appState.daemonOnline) return;
    try {
        const res = await fetch(`${API_BASE}/api/nudge`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'finish_round',
                reason: 'User clicked Finish Round & Freeze Best in Launcher UI',
            }),
        });
        if (res.status === 404) {
            // Graceful fallback to /api/stop if running an older server build
            await fetch(`${API_BASE}/api/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'User clicked Finish & Freeze Best' }),
            });
            appendLogLine('warn', 'Stopped swarm & froze current best candidate.');
            return;
        }
        const data = await res.json();
        appendLogLine('success', data.message || 'Finishing current round & freezing Pareto champion...');
    } catch (err) {
        appendLogLine('error', `Nudge failed: ${err.message}`);
    }
}

export function initTabLiveMonitor() {
    on('candidate_selected', () => {
        scheduleUIUpdate('selection_highlight', () => {
            renderParetoScatter();
            renderCandidateStreamTable();
        });
    });

    document.getElementById('sel-run-id')?.addEventListener('change', e => loadRunBundle(e.target.value));
    document.getElementById('btn-refresh-runs')?.addEventListener('click', () => refreshRunsList(appState.currentRunId));
    document.getElementById('btn-finish-round')?.addEventListener('click', finishRoundAndFreezeBest);

    document.getElementById('sel-pareto-axes')?.addEventListener('change', e => {
        appState.paretoAxes = e.target.value;
        renderParetoScatter();
    });

    document.querySelectorAll('.cand-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.cand-filter-btn').forEach(b => b.classList.remove('seg-on'));
            btn.classList.add('seg-on');
            appState.candidateFilter = btn.dataset.candFilter;
            renderCandidateStreamTable();
        });
    });

    document.getElementById('btn-scrub-prev')?.addEventListener('click', () => scrubCandidateSelection(-1));
    document.getElementById('btn-scrub-next')?.addEventListener('click', () => scrubCandidateSelection(1));
}

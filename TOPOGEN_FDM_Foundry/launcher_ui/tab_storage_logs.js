/**
 * WFC·FDM Foundry — Tab 4: Deliverables, Storage Reset & Streaming Terminal Log
 *
 * Inputs / Outputs:
 *   - Renders campaign folder storage summary (`#storage-folders-list`).
 *   - Executes safe scratch / run / all-campaign resets (`POST /api/reset`) with
 *     reference benchmark protection (`champion`, `pilot_v2_campaign`, `sweep`).
 *   - Buffers & flushes streaming orchestrator logs via `requestAnimationFrame`
 *     so bursty SSE log lines never block layout.
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import { API_BASE, appState, scheduleUIUpdate, switchTab } from './state.js';
import { clearCandidateCache } from './viewport3d.js';
import { loadRunBundle, refreshRunsList } from './tab_live_monitor.js';

const pendingLogEntries = [];

export function appendLogLine(level, msg, ts = null) {
    const time = ts ? String(ts).slice(11, 19) : new Date().toISOString().slice(11, 19);
    pendingLogEntries.push({ level, msg, time });

    scheduleUIUpdate('log_terminal', () => {
        const term = document.getElementById('live-log-terminal');
        if (!term || pendingLogEntries.length === 0) return;

        const frag = document.createDocumentFragment();
        const batch = pendingLogEntries.splice(0, pendingLogEntries.length);
        for (const item of batch) {
            const cls = item.level === 'error'
                ? 'text-rose-400'
                : item.level === 'warn'
                ? 'text-amber-300'
                : item.level === 'success'
                ? 'text-emerald-300'
                : 'text-gray-300';
            const div = document.createElement('div');
            div.className = cls;
            div.textContent = `[${item.time}] ${item.msg}`;
            frag.appendChild(div);
        }
        term.appendChild(frag);
        while (term.children.length > 160) {
            term.removeChild(term.firstChild);
        }
        term.scrollTop = term.scrollHeight;
    });
}

export function renderStorageSummary(storage) {
    if (!storage) return;
    const badge = document.getElementById('storage-summary-badge');
    if (badge) {
        badge.textContent = `${storage.folderCount} dirs · ${storage.totalFiles} files · ${storage.totalSizeMB} MB`;
    }

    const listEl = document.getElementById('storage-folders-list');
    if (!listEl) return;
    listEl.innerHTML = (storage.folders || []).map(f => `
        <div class="flex items-center justify-between py-0.5 px-1 rounded hover:bg-gray-900">
            <span class="truncate ${f.isActive ? 'text-amber-300 font-bold' : f.isReference ? 'text-emerald-300' : 'text-gray-200'}">
                ${f.isReference ? '🛡 ' : '📁 '}${f.name}
            </span>
            <span class="text-gray-400 flex-none ml-2">${f.files}f · ${f.sizeMB} MB</span>
        </div>
    `).join('');
}

export async function executeReset(scope, targetRunId = null) {
    const preserveReferences = Boolean(document.getElementById('chk-preserve-refs')?.checked);
    const labelMap = {
        scratch: 'Clean temporary scratch folders (_tmp_eval)?',
        run: `Delete run folder '${targetRunId}'?`,
        all_campaigns: preserveReferences
            ? 'Stop any active swarm and delete all new campaign folders (preserving reference benchmarks)?'
            : 'WARNING: Delete ALL folders in TOPOGEN_FDM_Foundry/runs/ including reference champions?',
    };
    if (!confirm(labelMap[scope] || 'Proceed with storage reset?')) return;

    const fb = document.getElementById('storage-reset-feedback');
    try {
        const res = await fetch(`${API_BASE}/api/reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ scope, preserveReferences, targetRunId, stopActiveFirst: true }),
        });
        const data = await res.json();
        if (!res.ok) {
            if (fb) {
                fb.textContent = data.error || 'Reset failed';
                fb.className = 'text-[9.5px] font-mono text-center text-rose-400';
            }
            return;
        }
        clearCandidateCache();
        if (fb) {
            fb.textContent = `Reset complete: removed ${data.removedCount} item(s).`;
            fb.className = 'text-[9.5px] font-mono text-center text-emerald-400';
        }
        renderStorageSummary(data.storage);
        await refreshRunsList();
        const selVal = document.getElementById('sel-run-id')?.value;
        if (selVal) await loadRunBundle(selVal);
    } catch (err) {
        if (fb) {
            fb.textContent = `Reset error: ${err.message}`;
            fb.className = 'text-[9.5px] font-mono text-center text-rose-400';
        }
    }
}

export function initTabStorageLogs() {
    document.getElementById('btn-top-reset-modal')?.addEventListener('click', () => {
        switchTab('tab-storage');
        refreshRunsList(appState.currentRunId);
    });

    document.getElementById('btn-clean-scratch')?.addEventListener('click', () => executeReset('scratch'));
    document.getElementById('btn-delete-selected-run')?.addEventListener('click', () => {
        const rId = document.getElementById('sel-run-id')?.value || appState.currentRunId;
        if (rId) executeReset('run', rId);
    });
    document.getElementById('btn-reset-all-runs')?.addEventListener('click', () => executeReset('all_campaigns'));

    document.getElementById('btn-clear-log')?.addEventListener('click', () => {
        pendingLogEntries.length = 0;
        const term = document.getElementById('live-log-terminal');
        if (term) term.innerHTML = '';
    });
}

/**
 * WFC·FDM Foundry — Right-Hand 3D Candidate Verdict HUD & Unrolled Strip Modal
 *
 * Inputs / Outputs:
 *   - Updates `#telemetry-panel` with Pareto fabrication metrics, air-gapped plaster
 *     FEA safety factors (`SF_t`, `SF_c`, `SF_b`, deflection `L/N`, lateral stability),
 *     failure diagnostics, and 2D unrolled SVG strip sheet thumbnail.
 *   - Wires `#media-modal` for enlarged 2D SVG sheets and the 60s MP4 showcase video.
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import { API_BASE, appState } from './state.js';

export function updateRightHud(rec, svgText = null) {
    if (!rec) return;

    const nameEl = document.getElementById('hud-cand-name');
    if (nameEl) nameEl.textContent = rec.name || 'Candidate';

    const badge = document.getElementById('hud-cand-badge');
    if (badge) {
        if (rec.previewOnly) {
            badge.textContent = 'PREVIEW · LOCAL';
            badge.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold bg-cyan-950 text-cyan-300 border border-cyan-500/40';
        } else if (rec.quickVerified) {
            badge.textContent = rec.passed
                ? `⚡ AIR-GAP PASS${rec.evalMs ? ` · ${rec.evalMs}ms` : ''}`
                : `⚡ AIR-GAP FAIL${rec.evalMs ? ` · ${rec.evalMs}ms` : ''}`;
            badge.className = rec.passed
                ? 'px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                : 'px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-500/50';
        } else if (rec.passed) {
            badge.textContent = rec.isPareto ? 'PARETO · PASS' : 'VERIFIED · PASS';
            badge.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 text-emerald-300 border border-emerald-500/40';
        } else {
            badge.textContent = 'REJECTED · FAIL';
            badge.className = 'px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-950 text-rose-300 border border-rose-500/40';
        }
    }

    const gStr = (rec.config?.gridResolution || []).join('×');
    const subEl = document.getElementById('hud-cand-sub');
    if (subEl) {
        subEl.textContent = `${rec.config?.tilePreset || 'preset'} · ${gStr} · ${rec.config?.fdmMode || 'compression'}${rec.synthesized ? ' · Mode B Synth' : ''}`;
    }

    const setTxt = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setTxt('hud-area', `${Number(rec.totalUnrolledSurfaceAreaM2 || 0).toFixed(4)} m²`);
    setTxt('hud-bars', `${rec.nEdges || 0} bars · ${rec.nNodes || 0}V`);
    setTxt('hud-mass', `${Number(rec.massKg || 0).toFixed(2)} kg / ${Number(rec.meshMassKg || rec.massKg || 0).toFixed(2)} kg`);

    const roMm = ((rec.config?.outerRadiusM || 0.014) * 1000).toFixed(1);
    const riVal = Number(rec.config?.innerRadiusM || 0) * 1000;
    const riMm = riVal.toFixed(1);
    setTxt('hud-section', `${riVal > 0 ? `Hollow ${roMm}/${riMm}mm` : `Solid ${roMm}mm`} · L=${rec.longitudinalSubdivLevels ?? 1}`);
    setTxt('hud-warp', `${Number(rec.maxQuadPlanarityErrorMm || 0).toFixed(4)} mm`);

    const manEl = document.getElementById('hud-manifold');
    if (manEl) {
        const ok = rec.watertightManifold !== false;
        manEl.textContent = ok ? 'Watertight (0 bnd)' : 'Non-Manifold';
        manEl.className = ok ? 'text-emerald-400' : 'text-rose-400 font-bold';
    }

    setTxt('hud-funic', `${((rec.funicularEfficiency || 0) * 100).toFixed(1)}% · ${((rec.compressionDominance || 0) * 100).toFixed(0)}% comp`);
    setTxt('hud-disp', `${Number(rec.maxDispMm || 0).toFixed(3)} mm (L/${rec.deflectionInverseN || '—'})`);

    const colorSF = (id, val, req, isTension = false) => {
        const el = document.getElementById(id);
        if (!el) return;
        const num = Number(val || 0);
        el.textContent = isTension && num >= 999 ? '∞ (0 tension)' : `${num.toFixed(2)}×`;
        el.className = num >= req ? 'text-emerald-300 font-semibold' : 'text-rose-400 font-bold';
    };

    colorSF('hud-sft', rec.sfTension, 1.5, true);
    colorSF('hud-sfc', rec.sfCompression, 2.0, false);
    colorSF('hud-sfb', rec.sfBuckling, 2.0, false);

    setTxt('hud-lat', rec.lateralMinSF != null ? `${Number(rec.lateralMinSF).toFixed(2)}×` : '—');
    setTxt('hud-res', rec.fdmResidual != null ? Number(rec.fdmResidual).toExponential(2) : '—');

    const failCard = document.getElementById('hud-failures-card');
    if (failCard) {
        if (!rec.passed && Array.isArray(rec.failureReasons) && rec.failureReasons.length > 0) {
            failCard.classList.remove('hidden');
            failCard.innerHTML = rec.failureReasons.slice(0, 5).map(r => `<div>• ${r}</div>`).join('');
        } else {
            failCard.classList.add('hidden');
            failCard.innerHTML = '';
        }
    }

    appState.activePatternsSvg = svgText;
    const unrollBox = document.getElementById('hud-unroll-box');
    const thumb = document.getElementById('hud-svg-thumb');
    if (unrollBox && thumb) {
        if (svgText) {
            unrollBox.classList.remove('hidden');
            thumb.innerHTML = svgText.replace(/<svg\s/, '<svg style="width:100%;height:100%;" ');
        } else {
            unrollBox.classList.add('hidden');
            thumb.innerHTML = '';
        }
    }
}

export function initVerdictHudAndModals() {
    const modal = document.getElementById('media-modal');
    const modalTitle = document.getElementById('media-modal-title');
    const modalBody = document.getElementById('media-modal-body');

    document.getElementById('btn-close-media-modal')?.addEventListener('click', () => {
        modal.classList.add('hidden');
        modalBody.innerHTML = '';
    });

    modal?.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.classList.add('hidden');
            modalBody.innerHTML = '';
        }
    });

    document.getElementById('btn-open-video-modal')?.addEventListener('click', () => {
        modalTitle.textContent = '60-Second Foundry Showcase Video (1920×1080 @ 30 FPS)';
        modalBody.innerHTML = `<video src="${API_BASE}/foundry_showcase_60s.mp4?t=${Date.now()}" controls autoplay class="max-h-[76vh] w-auto rounded border border-gray-800"></video>`;
        modal.classList.remove('hidden');
    });

    document.getElementById('btn-expand-svg')?.addEventListener('click', () => {
        if (!appState.activePatternsSvg) return;
        modalTitle.textContent = `Per-Bar 2D Unrolled Fabrication Sheet — ${appState.selectedCandidateStem || 'Preview'}`;
        modalBody.innerHTML = `<div class="w-full overflow-auto bg-[#070A10] p-2 rounded">${appState.activePatternsSvg}</div>`;
        modal.classList.remove('hidden');
    });
}

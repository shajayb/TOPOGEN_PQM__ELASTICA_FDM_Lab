/**
 * WFC-FDM Foundry — Direct-Over-Viewport Clickable Stage Timeline (ui/display/chain_timeline.js)
 *
 * Renders a sleek, frameless horizontal procedural-chain timeline directly over the
 * bottom of the 3D viewport (transparent background — NOT a boxed/card HUD panel).
 *
 * Interaction & Pointer-Events Guarantee:
 *   - Outer wrapper uses `pointer-events: none` so 3D viewport orbiting, panning, and
 *     raycasting are never blocked.
 *   - Only the interactive track, stage nodes, and dismiss button opt in to
 *     `pointer-events: auto`.
 *
 * API:
 *   const tl = createChainTimeline({ container, onSelectStage, onDismiss });
 *   tl.setChain(chain, activeIndex = -1);
 *   tl.setActiveStage(index, statusText = '');
 *   tl.setBusy(busy);
 *   tl.show();
 *   tl.hide();
 *   tl.destroy();
 */

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function stepLabel(step, idx) {
    if (!step || typeof step !== 'object') return `Stage ${idx + 1}`;
    const raw = step.label || step.op || `Stage ${idx + 1}`;
    return String(raw).trim() || `Stage ${idx + 1}`;
}

export function createChainTimeline({ container = null, onSelectStage = null, onDismiss = null } = {}) {
    let _chain = null;
    let _steps = [];
    let _activeIndex = -1;
    let _statusText = '';
    let _busy = false;
    let _visible = false;
    let _root = null;

    function ensureRoot() {
        if (_root || typeof document === 'undefined') return _root;
        const mountParent = container || document.body;
        const el = document.createElement('div');
        el.id = 'viewport-chain-timeline';
        el.className = 'chain-tl-overlay hidden';
        el.setAttribute('role', 'navigation');
        el.setAttribute('aria-label', 'Procedural Chain Stage Timeline');
        el.innerHTML = `
            <div class="chain-tl-inner">
                <div class="chain-tl-meta-left">
                    <span class="chain-tl-name" data-tl-name></span>
                    <span class="chain-tl-status" data-tl-status></span>
                </div>
                <div class="chain-tl-track-wrap" data-tl-track-wrap>
                    <div class="chain-tl-rail">
                        <div class="chain-tl-rail-fill" data-tl-fill></div>
                    </div>
                    <div class="chain-tl-nodes" data-tl-nodes></div>
                </div>
                <button type="button" class="chain-tl-dismiss" data-tl-dismiss title="Hide timeline (chain stays loaded)" aria-label="Hide timeline">×</button>
            </div>
        `;

        el.addEventListener('click', (e) => {
            const dismissBtn = e.target.closest('[data-tl-dismiss]');
            if (dismissBtn) {
                e.stopPropagation();
                hide();
                if (typeof onDismiss === 'function') onDismiss();
                return;
            }
            const nodeBtn = e.target.closest('[data-tl-index]');
            if (nodeBtn) {
                e.stopPropagation();
                const idx = parseInt(nodeBtn.dataset.tlIndex, 10);
                if (Number.isInteger(idx) && idx >= 0 && idx < _steps.length) {
                    if (typeof onSelectStage === 'function') {
                        onSelectStage(idx, _steps[idx]);
                    }
                }
            }
        });

        mountParent.appendChild(el);
        _root = el;
        return _root;
    }

    function render() {
        const root = ensureRoot();
        if (!root) return;

        const hasSteps = Array.isArray(_steps) && _steps.length > 0;
        root.classList.toggle('hidden', !_visible || !hasSteps);
        root.classList.toggle('is-busy', _busy);
        if (!hasSteps) return;

        const nameEl = root.querySelector('[data-tl-name]');
        const statusEl = root.querySelector('[data-tl-status]');
        const nodesEl = root.querySelector('[data-tl-nodes]');
        const fillEl = root.querySelector('[data-tl-fill]');

        const total = _steps.length;
        const clamped = (_activeIndex >= 0 && _activeIndex < total) ? _activeIndex : -1;

        if (nameEl) {
            const chainTitle = (_chain && (_chain.name || _chain.id)) ? String(_chain.name || _chain.id) : 'Procedural Chain';
            nameEl.textContent = chainTitle;
            nameEl.title = chainTitle;
        }

        if (statusEl) {
            if (_statusText) {
                statusEl.textContent = _statusText;
            } else if (clamped >= 0) {
                statusEl.textContent = `${clamped + 1}/${total} · ${stepLabel(_steps[clamped], clamped)}`;
            } else {
                statusEl.textContent = `0/${total} ready`;
            }
        }

        if (fillEl) {
            const pct = total <= 1
                ? (clamped >= 0 ? 100 : 0)
                : (clamped <= 0 ? 0 : Math.min(100, (clamped / (total - 1)) * 100));
            fillEl.style.width = `${pct.toFixed(2)}%`;
        }

        if (nodesEl) {
            nodesEl.innerHTML = _steps.map((step, i) => {
                const lbl = stepLabel(step, i);
                const isDone = clamped >= 0 && i < clamped;
                const isActive = i === clamped;
                const stateCls = isActive ? 'is-active' : (isDone ? 'is-done' : 'is-pending');
                const glyph = (isDone || isActive) ? '●' : '○';
                const tip = `Stage ${i + 1}/${total} · ${lbl}`;
                return `<button type="button" class="chain-tl-node ${stateCls}" data-tl-index="${i}" aria-label="${escapeHtml(tip)}" aria-current="${isActive ? 'step' : 'false'}">` +
                    `<span class="chain-tl-dot" aria-hidden="true">${glyph}</span>` +
                    `<span class="chain-tl-tooltip" role="tooltip">${escapeHtml(tip)}</span>` +
                    `</button>`;
            }).join('');
        }
    }

    function setChain(chain, activeIndex = -1) {
        _chain = chain && typeof chain === 'object' ? chain : null;
        _steps = (_chain && Array.isArray(_chain.steps)) ? _chain.steps : [];
        _activeIndex = Number.isInteger(activeIndex) ? activeIndex : -1;
        _statusText = '';
        _visible = _steps.length > 0;
        render();
    }

    function setActiveStage(index, statusText = '') {
        _activeIndex = Number.isInteger(index) ? index : -1;
        _statusText = statusText ? String(statusText) : '';
        if (_steps.length > 0 && !_visible) _visible = true;
        render();
    }

    function setBusy(busy) {
        _busy = Boolean(busy);
        if (_root) _root.classList.toggle('is-busy', _busy);
    }

    function show() {
        _visible = _steps.length > 0;
        render();
    }

    function hide() {
        _visible = false;
        if (_root) _root.classList.add('hidden');
    }

    function destroy() {
        if (_root && _root.parentNode) {
            _root.parentNode.removeChild(_root);
        }
        _root = null;
        _chain = null;
        _steps = [];
        _activeIndex = -1;
        _visible = false;
    }

    return {
        setChain,
        setActiveStage,
        setBusy,
        show,
        hide,
        destroy,
        getElement: () => _root,
        getChain: () => _chain,
        getActiveIndex: () => _activeIndex
    };
}

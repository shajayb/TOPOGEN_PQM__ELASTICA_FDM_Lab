/**
 * TOPOGEN_FDM_Foundry — Procedural Chain Schema & Pure-JS Utilities
 * Schema: 'topogen-procedural-chain/v1'
 *
 * Pure ES module: ZERO DOM, ZERO Three.js, ZERO Node built-ins, ZERO verifier/ imports.
 * Safe to import in both browser Workbench UI modules and Node.js server/CLI/tests.
 */

export const CHAIN_SCHEMA_VERSION = 'topogen-procedural-chain/v1';

export const SUPPORTED_STEP_OPS = Object.freeze([
    'tile_preset',
    'tile_toggle',
    'tile_import',
    'grid_config',
    'wfc_collapse',
    'pq_config',
    'pq_solidify',
    'pq_subdiv_ring',
    'pq_subdiv_long',
    'pq_subdiv_cc',
    'pq_optimize',
    'pq_swap_long_ring',
    'fdm_config',
    'fdm_solve',
    'elastica_trace',
    'fea_run',
    'camera_bookmark'
]);

const SUPPORTED_STEP_OP_SET = new Set(SUPPORTED_STEP_OPS);

const DEFAULT_OP_LABELS = Object.freeze({
    tile_preset: 'Load Tile Preset',
    tile_toggle: 'Toggle Tile',
    tile_import: 'Import Custom Tile',
    grid_config: 'Configure Grid',
    wfc_collapse: 'Collapse WFC',
    pq_config: 'Configure PQ Solidifier',
    pq_solidify: 'Solidify PQ Mesh',
    pq_subdiv_ring: 'Subdivide PQ Ring',
    pq_subdiv_long: 'Subdivide PQ Longitudinal',
    pq_subdiv_cc: 'Catmull-Clark Subdivide',
    pq_optimize: 'Optimize PQ Planarity',
    pq_swap_long_ring: 'Swap Long / Ring',
    fdm_config: 'Configure FDM',
    fdm_solve: 'Solve FDM',
    elastica_trace: 'Trace Elastica Rods',
    fea_run: 'Run Space-Frame FEA',
    camera_bookmark: 'Apply Camera Bookmark'
});

/**
 * 7 Built-in Studio Camera Bookmarks (4 Orthographic + 3 Perspective).
 * Coordinates use standard Three.js Y-up convention; `spherical` + `fitToScene`
 * allow camera controllers to adapt cleanly to any bounding sphere size.
 */
export const DEFAULT_CAMERA_BOOKMARKS = Object.freeze([
    Object.freeze({
        id: 'ortho-top',
        name: 'Ortho Top',
        projection: 'orthographic',
        fov: 45,
        orthoSize: 8,
        position: Object.freeze([0, 10, 0.01]),
        target: Object.freeze([0, 0, 0]),
        up: Object.freeze([0, 0, -1]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: 0, elevationDeg: 89.5, distanceScale: 1.35 }),
        fitToScene: true,
        builtin: true
    }),
    Object.freeze({
        id: 'ortho-front',
        name: 'Ortho Front',
        projection: 'orthographic',
        fov: 45,
        orthoSize: 8,
        position: Object.freeze([0, 0, 10]),
        target: Object.freeze([0, 0, 0]),
        up: Object.freeze([0, 1, 0]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: 0, elevationDeg: 0, distanceScale: 1.35 }),
        fitToScene: true,
        builtin: true
    }),
    Object.freeze({
        id: 'ortho-right',
        name: 'Ortho Right',
        projection: 'orthographic',
        fov: 45,
        orthoSize: 8,
        position: Object.freeze([10, 0, 0]),
        target: Object.freeze([0, 0, 0]),
        up: Object.freeze([0, 1, 0]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: 90, elevationDeg: 0, distanceScale: 1.35 }),
        fitToScene: true,
        builtin: true
    }),
    Object.freeze({
        id: 'ortho-iso',
        name: 'Ortho Iso',
        projection: 'orthographic',
        fov: 45,
        orthoSize: 8,
        position: Object.freeze([10, 10, 10]),
        target: Object.freeze([0, 0, 0]),
        up: Object.freeze([0, 1, 0]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: 45, elevationDeg: 35.264, distanceScale: 1.4 }),
        fitToScene: true,
        builtin: true
    }),
    Object.freeze({
        id: 'persp-iso',
        name: 'Persp ISO',
        projection: 'perspective',
        fov: 45,
        position: Object.freeze([10, 8.2, 10]),
        target: Object.freeze([0, 0, 0]),
        up: Object.freeze([0, 1, 0]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: 45, elevationDeg: 30, distanceScale: 1.45 }),
        fitToScene: true,
        builtin: true
    }),
    Object.freeze({
        id: 'persp-front-left',
        name: 'Persp Front-Left',
        projection: 'perspective',
        fov: 45,
        position: Object.freeze([-7.5, 5.2, 10.7]),
        target: Object.freeze([0, 0, 0]),
        up: Object.freeze([0, 1, 0]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: -35, elevationDeg: 22, distanceScale: 1.45 }),
        fitToScene: true,
        builtin: true
    }),
    Object.freeze({
        id: 'persp-low',
        name: 'Persp Low Hero',
        projection: 'perspective',
        fov: 42,
        position: Object.freeze([6.5, 2.2, 10.4]),
        target: Object.freeze([0, 0.3, 0]),
        up: Object.freeze([0, 1, 0]),
        zoom: 1,
        spherical: Object.freeze({ azimuthDeg: 32, elevationDeg: 10, distanceScale: 1.25 }),
        fitToScene: true,
        builtin: true
    })
]);

const BUILTIN_BOOKMARK_IDS = new Set(DEFAULT_CAMERA_BOOKMARKS.map((b) => b.id));

function deepClone(val) {
    if (val === null || typeof val !== 'object') return val;
    if (Array.isArray(val)) return val.map(deepClone);
    const out = {};
    for (const [k, v] of Object.entries(val)) {
        if (v !== undefined) out[k] = deepClone(v);
    }
    return out;
}

function slugifyId(text, fallback = 'chain') {
    const cleaned = String(text || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return cleaned || fallback;
}

function extractExt(filePath) {
    const clean = String(filePath || '').split('?')[0].split('#')[0];
    const lastDot = clean.lastIndexOf('.');
    const lastSlash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    if (lastDot > lastSlash && lastDot < clean.length - 1) {
        return clean.slice(lastDot).toLowerCase();
    }
    return '';
}

function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalize a repository-relative path to clean POSIX form.
 * Rejects absolute paths, Windows drive letters, NUL bytes, '..' traversal, and '.git'.
 *
 * @param {string} p
 * @returns {string}
 */
export function normalizeRepoRelativePath(p) {
    if (typeof p !== 'string') {
        throw new Error('Repo-relative path must be a string.');
    }
    const raw = p.trim();
    if (!raw) {
        throw new Error('Repo-relative path cannot be empty.');
    }
    if (raw.includes('\0')) {
        throw new Error('Repo-relative path contains NUL byte.');
    }
    if (/^[a-zA-Z]:/.test(raw) || raw.startsWith('/') || raw.startsWith('\\')) {
        throw new Error(`Absolute or UNC path is not allowed: "${p}"`);
    }
    const posix = raw.replace(/\\/g, '/');
    const parts = posix.split('/');
    const out = [];
    for (const seg of parts) {
        if (!seg || seg === '.') continue;
        if (seg === '..') {
            throw new Error(`Path traversal ("..") is not allowed: "${p}"`);
        }
        if (seg.toLowerCase() === '.git') {
            throw new Error(`Access to ".git" is not allowed: "${p}"`);
        }
        out.push(seg);
    }
    if (out.length === 0) {
        throw new Error(`Repo-relative path resolves to empty: "${p}"`);
    }
    return out.join('/');
}

/**
 * Create a new procedural chain object conforming to 'topogen-procedural-chain/v1'.
 *
 * @param {object} [meta]
 * @returns {object}
 */
export function createProceduralChain(meta = {}) {
    const now = new Date().toISOString();
    const name = typeof meta.name === 'string' && meta.name.trim()
        ? meta.name.trim()
        : 'Untitled Procedural Chain';
    const id = typeof meta.id === 'string' && meta.id.trim()
        ? slugifyId(meta.id, 'chain')
        : slugifyId(name, `chain-${Date.now()}`);

    const chain = {
        schema: CHAIN_SCHEMA_VERSION,
        id,
        name,
        createdAt: typeof meta.createdAt === 'string' && meta.createdAt.trim() ? meta.createdAt : now,
        updatedAt: typeof meta.updatedAt === 'string' && meta.updatedAt.trim() ? meta.updatedAt : now,
        notes: typeof meta.notes === 'string' ? meta.notes : '',
        assets: [],
        bookmarks: Array.isArray(meta.bookmarks) && meta.bookmarks.length > 0
            ? deepClone(meta.bookmarks)
            : deepClone(DEFAULT_CAMERA_BOOKMARKS),
        steps: []
    };

    if (Array.isArray(meta.assets)) {
        for (const a of meta.assets) {
            registerChainAsset(chain, a);
        }
    }
    if (Array.isArray(meta.steps)) {
        for (const s of meta.steps) {
            appendChainStep(chain, s);
        }
    }
    if (typeof meta.updatedAt === 'string' && meta.updatedAt.trim()) {
        chain.updatedAt = meta.updatedAt;
    }

    return chain;
}

/**
 * Append a procedural step to a chain, assigning sequential index and default id/label.
 *
 * @param {object} chain
 * @param {object} step
 * @returns {object} The appended step entry
 */
export function appendChainStep(chain, step) {
    if (!isPlainObject(chain) || !Array.isArray(chain.steps)) {
        throw new Error('appendChainStep: invalid chain object.');
    }
    if (!isPlainObject(step)) {
        throw new Error('appendChainStep: step must be an object.');
    }
    const op = typeof step.op === 'string' ? step.op.trim() : '';
    if (!SUPPORTED_STEP_OP_SET.has(op)) {
        throw new Error(`appendChainStep: unsupported step op "${op}".`);
    }

    const index = chain.steps.length;
    const id = typeof step.id === 'string' && step.id.trim()
        ? step.id.trim()
        : `step-${String(index + 1).padStart(2, '0')}-${op}`;
    const label = typeof step.label === 'string' && step.label.trim()
        ? step.label.trim()
        : (DEFAULT_OP_LABELS[op] || op);
    const params = isPlainObject(step.params) ? deepClone(step.params) : {};

    if (typeof params.repoRelativePath === 'string' && params.repoRelativePath.trim()) {
        params.repoRelativePath = normalizeRepoRelativePath(params.repoRelativePath);
    }

    const entry = { index, id, op, label, params };
    if (typeof step.bookmarkId === 'string' && step.bookmarkId.trim()) {
        entry.bookmarkId = step.bookmarkId.trim();
    }
    if (step.capture !== undefined && step.capture !== null && step.capture !== false) {
        entry.capture = typeof step.capture === 'boolean' ? step.capture : deepClone(step.capture);
    }

    chain.steps.push(entry);
    chain.updatedAt = new Date().toISOString();
    return entry;
}

/**
 * Register (or update) an external asset reference in a procedural chain.
 *
 * @param {object} chain
 * @param {object} assetInfo
 * @returns {object} The registered asset entry
 */
export function registerChainAsset(chain, assetInfo) {
    if (!isPlainObject(chain) || !Array.isArray(chain.assets)) {
        throw new Error('registerChainAsset: invalid chain object.');
    }
    if (!isPlainObject(assetInfo)) {
        throw new Error('registerChainAsset: assetInfo must be an object.');
    }

    const repoRelativePath = normalizeRepoRelativePath(assetInfo.repoRelativePath);
    const baseName = repoRelativePath.split('/').pop() || 'asset';
    const originalName = typeof assetInfo.originalName === 'string' && assetInfo.originalName.trim()
        ? assetInfo.originalName.trim()
        : baseName;
    const ext = typeof assetInfo.ext === 'string' && assetInfo.ext.trim()
        ? (assetInfo.ext.startsWith('.') ? assetInfo.ext.toLowerCase() : `.${assetInfo.ext.toLowerCase()}`)
        : (extractExt(originalName) || extractExt(repoRelativePath));
    const id = typeof assetInfo.id === 'string' && assetInfo.id.trim()
        ? assetInfo.id.trim()
        : slugifyId(originalName.replace(/\.[^.]+$/, ''), `asset-${chain.assets.length + 1}`);
    const sha256Short = typeof assetInfo.sha256Short === 'string' ? assetInfo.sha256Short.trim() : '';
    const bytes = Number.isFinite(Number(assetInfo.bytes)) && Number(assetInfo.bytes) >= 0
        ? Math.floor(Number(assetInfo.bytes))
        : 0;

    const record = { id, originalName, repoRelativePath, sha256Short, bytes, ext };

    const existingIdx = chain.assets.findIndex(
        (a) => a && (a.repoRelativePath === repoRelativePath || a.id === id)
    );
    if (existingIdx >= 0) {
        chain.assets[existingIdx] = record;
    } else {
        chain.assets.push(record);
    }

    chain.updatedAt = new Date().toISOString();
    return record;
}

/**
 * Validate a procedural chain object against 'topogen-procedural-chain/v1'.
 *
 * @param {object} chain
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateProceduralChain(chain) {
    const errors = [];
    const warnings = [];

    if (!isPlainObject(chain)) {
        return { ok: false, errors: ['Chain must be a plain JSON object.'], warnings };
    }
    if (chain.schema !== CHAIN_SCHEMA_VERSION) {
        errors.push(`Invalid schema "${chain.schema}": expected "${CHAIN_SCHEMA_VERSION}".`);
    }
    if (typeof chain.id !== 'string' || !chain.id.trim()) {
        errors.push('Chain "id" must be a non-empty string.');
    }
    if (typeof chain.name !== 'string' || !chain.name.trim()) {
        errors.push('Chain "name" must be a non-empty string.');
    }

    const assetIds = new Set();
    if (!Array.isArray(chain.assets)) {
        errors.push('Chain "assets" must be an array.');
    } else {
        chain.assets.forEach((asset, i) => {
            if (!isPlainObject(asset)) {
                errors.push(`assets[${i}] must be an object.`);
                return;
            }
            if (typeof asset.id !== 'string' || !asset.id.trim()) {
                errors.push(`assets[${i}].id must be a non-empty string.`);
            } else {
                assetIds.add(asset.id);
            }
            if (typeof asset.originalName !== 'string' || !asset.originalName.trim()) {
                errors.push(`assets[${i}].originalName must be a non-empty string.`);
            }
            try {
                normalizeRepoRelativePath(asset.repoRelativePath);
            } catch (err) {
                errors.push(`assets[${i}].repoRelativePath invalid: ${err.message}`);
            }
            if (asset.bytes !== undefined && (!Number.isFinite(Number(asset.bytes)) || Number(asset.bytes) < 0)) {
                errors.push(`assets[${i}].bytes must be a non-negative number.`);
            }
        });
    }

    const bookmarkIds = new Set(BUILTIN_BOOKMARK_IDS);
    if (!Array.isArray(chain.bookmarks)) {
        errors.push('Chain "bookmarks" must be an array.');
    } else {
        chain.bookmarks.forEach((bm, i) => {
            if (!isPlainObject(bm)) {
                errors.push(`bookmarks[${i}] must be an object.`);
                return;
            }
            if (typeof bm.id !== 'string' || !bm.id.trim()) {
                errors.push(`bookmarks[${i}].id must be a non-empty string.`);
            } else {
                bookmarkIds.add(bm.id);
            }
            if (typeof bm.name !== 'string' || !bm.name.trim()) {
                errors.push(`bookmarks[${i}].name must be a non-empty string.`);
            }
            if (bm.projection !== 'ortho' && bm.projection !== 'orthographic' && bm.projection !== 'perspective') {
                errors.push(`bookmarks[${i}].projection must be "orthographic" ("ortho") or "perspective" (got "${bm.projection}").`);
            }
        });
    }

    if (!Array.isArray(chain.steps)) {
        errors.push('Chain "steps" must be an array.');
    } else {
        chain.steps.forEach((step, i) => {
            if (!isPlainObject(step)) {
                errors.push(`steps[${i}] must be an object.`);
                return;
            }
            if (!Number.isInteger(step.index) || step.index < 0) {
                errors.push(`steps[${i}].index must be a non-negative integer.`);
            } else if (step.index !== i) {
                warnings.push(`steps[${i}].index is ${step.index} (expected sequential ${i}).`);
            }
            if (typeof step.id !== 'string' || !step.id.trim()) {
                errors.push(`steps[${i}].id must be a non-empty string.`);
            }
            if (typeof step.op !== 'string' || !SUPPORTED_STEP_OP_SET.has(step.op)) {
                errors.push(`steps[${i}].op "${step.op}" is not supported.`);
            }
            if (!isPlainObject(step.params)) {
                errors.push(`steps[${i}].params must be an object.`);
            } else if (typeof step.params.repoRelativePath === 'string' && step.params.repoRelativePath.trim()) {
                try {
                    normalizeRepoRelativePath(step.params.repoRelativePath);
                } catch (err) {
                    errors.push(`steps[${i}].params.repoRelativePath invalid: ${err.message}`);
                }
            }
            if (step.bookmarkId !== undefined) {
                if (typeof step.bookmarkId !== 'string' || !step.bookmarkId.trim()) {
                    errors.push(`steps[${i}].bookmarkId must be a non-empty string when present.`);
                } else if (!bookmarkIds.has(step.bookmarkId)) {
                    warnings.push(`steps[${i}].bookmarkId "${step.bookmarkId}" not found in chain bookmarks.`);
                }
            }
            if (step.op === 'tile_import' && isPlainObject(step.params)) {
                if (step.params.assetId && !assetIds.has(step.params.assetId)) {
                    warnings.push(`steps[${i}].params.assetId "${step.params.assetId}" not found in chain assets.`);
                }
            }
        });
    }

    return { ok: errors.length === 0, errors, warnings };
}

/**
 * Serialize a procedural chain into canonical JSON after validation.
 *
 * @param {object} chain
 * @param {{ pretty?: boolean }} [options]
 * @returns {string}
 */
export function serializeProceduralChain(chain, options = {}) {
    const check = validateProceduralChain(chain);
    if (!check.ok) {
        throw new Error(`Cannot serialize invalid procedural chain: ${check.errors.join('; ')}`);
    }
    const pretty = options.pretty !== false;
    const normalized = {
        schema: CHAIN_SCHEMA_VERSION,
        id: chain.id.trim(),
        name: chain.name.trim(),
        createdAt: chain.createdAt || new Date().toISOString(),
        updatedAt: chain.updatedAt || new Date().toISOString(),
        notes: typeof chain.notes === 'string' ? chain.notes : '',
        assets: deepClone(chain.assets),
        bookmarks: deepClone(chain.bookmarks),
        steps: chain.steps.map((s, idx) => {
            const copy = {
                index: idx,
                id: s.id,
                op: s.op,
                label: typeof s.label === 'string' && s.label.trim() ? s.label : (DEFAULT_OP_LABELS[s.op] || s.op),
                params: deepClone(s.params)
            };
            if (s.bookmarkId) copy.bookmarkId = s.bookmarkId;
            if (s.capture !== undefined && s.capture !== null && s.capture !== false) {
                copy.capture = deepClone(s.capture);
            }
            return copy;
        })
    };
    return JSON.stringify(normalized, null, pretty ? 2 : 0);
}

/**
 * Parse and validate a procedural chain from a JSON string.
 *
 * @param {string} jsonText
 * @returns {object}
 */
export function parseProceduralChain(jsonText) {
    if (typeof jsonText !== 'string') {
        throw new Error('parseProceduralChain: expected JSON string.');
    }
    let parsed;
    try {
        parsed = JSON.parse(jsonText);
    } catch (err) {
        throw new Error(`parseProceduralChain: invalid JSON (${err.message}).`);
    }
    const check = validateProceduralChain(parsed);
    if (!check.ok) {
        throw new Error(`parseProceduralChain: validation failed: ${check.errors.join('; ')}`);
    }
    return parsed;
}

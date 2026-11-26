/**
 * WFC-FDM Foundry — Camera View Bookmarks Store (ui/display/camera_bookmarks.js)
 *
 * Manages built-in Perspective & Orthographic camera bookmarks plus custom
 * user-saved bookmarks persisted in `localStorage` under
 * `'topogen_camera_bookmarks_v1'`, and import/export helpers for procedural chains.
 *
 * Coordinate convention:
 *   Matches `ui/display/viewport_scene.js` Three.js world space (Y-up;
 *   `viewport.mainGroup.rotation.x = -Math.PI / 2` maps model Z-up -> world Y-up).
 *   - World +Y = Up (model +Z)
 *   - World +X = Right (model +X)
 *   - World +Z = Front (model -Y)
 *
 * Bookmark schema:
 *   {
 *     id: string,
 *     name: string,
 *     builtin: boolean,
 *     projection: 'perspective' | 'orthographic',
 *     position: [x, y, z],
 *     target: [x, y, z],
 *     up: [x, y, z],
 *     fov?: number,
 *     zoom?: number,
 *     orthoSize?: number
 *   }
 */

export const STORAGE_KEY = 'topogen_camera_bookmarks_v1';

const DEFAULT_BOOKMARKS_RAW = [
    // Perspective views
    {
        id: 'persp-iso',
        name: 'Persp ISO',
        builtin: true,
        projection: 'perspective',
        position: [6.8, 5.2, 7.8],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        fov: 45,
        zoom: 1
    },
    {
        id: 'persp-front-left',
        name: 'Persp Front-Left',
        builtin: true,
        projection: 'perspective',
        position: [-6.2, 3.8, 8.2],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        fov: 45,
        zoom: 1
    },
    {
        id: 'persp-low',
        name: 'Persp Low Hero',
        builtin: true,
        projection: 'perspective',
        position: [7.2, 1.9, 7.8],
        target: [0, 1.8, 0],
        up: [0, 1, 0],
        fov: 42,
        zoom: 1
    },
    // Orthographic views (slight +Z offset on Top keeps OrbitControls gimbal-safe with Y-up)
    {
        id: 'ortho-top',
        name: 'Ortho Top',
        builtin: true,
        projection: 'orthographic',
        position: [0, 14, 0.001],
        target: [0, 0, 0],
        up: [0, 1, 0],
        zoom: 1,
        orthoSize: 6
    },
    {
        id: 'ortho-front',
        name: 'Ortho Front',
        builtin: true,
        projection: 'orthographic',
        position: [0, 1.5, 14],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        zoom: 1,
        orthoSize: 6
    },
    {
        id: 'ortho-right',
        name: 'Ortho Right',
        builtin: true,
        projection: 'orthographic',
        position: [14, 1.5, 0],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        zoom: 1,
        orthoSize: 6
    },
    {
        id: 'ortho-iso',
        name: 'Ortho Iso',
        builtin: true,
        projection: 'orthographic',
        position: [10, 9.665, 10],
        target: [0, 1.5, 0],
        up: [0, 1, 0],
        zoom: 1,
        orthoSize: 6
    }
];

const BUILTIN_IDS = new Set(DEFAULT_BOOKMARKS_RAW.map(b => b.id));
const _listeners = new Set();
let _customCache = null;

function roundNum(v, fallback = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.round(n * 1e5) / 1e5;
}

function normVec3(arr, fallback) {
    if (Array.isArray(arr) && arr.length >= 3) {
        return [
            roundNum(arr[0], fallback[0]),
            roundNum(arr[1], fallback[1]),
            roundNum(arr[2], fallback[2])
        ];
    }
    if (arr && typeof arr === 'object' && 'x' in arr && 'y' in arr && 'z' in arr) {
        return [
            roundNum(arr.x, fallback[0]),
            roundNum(arr.y, fallback[1]),
            roundNum(arr.z, fallback[2])
        ];
    }
    return [...fallback];
}

function slugifyId(name) {
    const slug = String(name || 'view')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'view';
    const rand = Math.random().toString(36).slice(2, 6);
    return `custom-${slug}-${rand}`;
}

function cloneBookmark(bm) {
    const out = {
        id: bm.id,
        name: bm.name,
        builtin: Boolean(bm.builtin),
        projection: bm.projection === 'orthographic' ? 'orthographic' : 'perspective',
        position: [...bm.position],
        target: [...bm.target],
        up: [...bm.up]
    };
    if (bm.fov !== undefined && Number.isFinite(Number(bm.fov))) out.fov = roundNum(bm.fov, 45);
    if (bm.zoom !== undefined && Number.isFinite(Number(bm.zoom))) out.zoom = roundNum(bm.zoom, 1);
    if (bm.orthoSize !== undefined && Number.isFinite(Number(bm.orthoSize))) out.orthoSize = roundNum(bm.orthoSize, 6);
    return out;
}

export function normalizeBookmark(raw, { builtin = false } = {}) {
    if (!raw || typeof raw !== 'object') return null;
    const projection = String(raw.projection || 'perspective').toLowerCase().startsWith('ortho')
        ? 'orthographic'
        : 'perspective';
    const name = String(raw.name || raw.label || raw.id || 'Saved View').trim().slice(0, 48) || 'Saved View';
    const id = String(raw.id || '').trim() || slugifyId(name);
    const out = {
        id,
        name,
        builtin: Boolean(builtin || raw.builtin) && BUILTIN_IDS.has(id),
        projection,
        position: normVec3(raw.position, [6.8, 5.2, 7.8]),
        target: normVec3(raw.target, [0, 1.5, 0]),
        up: normVec3(raw.up, [0, 1, 0])
    };
    if (projection === 'perspective') {
        out.fov = Math.max(10, Math.min(120, roundNum(raw.fov, 45)));
        out.zoom = Math.max(0.05, Math.min(50, roundNum(raw.zoom, 1)));
    } else {
        out.zoom = Math.max(0.05, Math.min(50, roundNum(raw.zoom, 1)));
        out.orthoSize = Math.max(0.1, Math.min(1000, roundNum(raw.orthoSize, 6)));
    }
    return out;
}

function readCustomFromStorage() {
    if (_customCache !== null) return _customCache;
    const list = [];
    try {
        if (typeof localStorage !== 'undefined') {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    const seen = new Set();
                    for (const item of parsed) {
                        const bm = normalizeBookmark(item, { builtin: false });
                        if (bm && !BUILTIN_IDS.has(bm.id) && !seen.has(bm.id)) {
                            bm.builtin = false;
                            seen.add(bm.id);
                            list.push(bm);
                        }
                    }
                }
            }
        }
    } catch (_) {
        // Ignore storage errors (private browsing / SSR / Node)
    }
    _customCache = list;
    return _customCache;
}

function writeCustomToStorage(list) {
    _customCache = list.map(b => cloneBookmark({ ...b, builtin: false }));
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(_customCache));
        }
    } catch (_) {
        // Ignore storage quota errors
    }
    for (const fn of _listeners) {
        try { fn(getAllBookmarks()); } catch (_) {}
    }
}

export function onBookmarksChange(listener) {
    if (typeof listener !== 'function') return () => {};
    _listeners.add(listener);
    return () => _listeners.delete(listener);
}

export function getDefaultBookmarks() {
    return DEFAULT_BOOKMARKS_RAW.map(cloneBookmark);
}

export function getCustomBookmarks() {
    return readCustomFromStorage().map(cloneBookmark);
}

export function getAllBookmarks() {
    return [...getDefaultBookmarks(), ...getCustomBookmarks()];
}

export function getBookmarkById(id) {
    if (!id) return null;
    const key = String(id).trim();
    const def = DEFAULT_BOOKMARKS_RAW.find(b => b.id === key);
    if (def) return cloneBookmark(def);
    const custom = readCustomFromStorage().find(b => b.id === key);
    return custom ? cloneBookmark(custom) : null;
}

export function saveCustomBookmark(name, cameraState) {
    const cleanName = String(name || '').trim() || `View ${readCustomFromStorage().length + 1}`;
    const state = (cameraState && typeof cameraState === 'object') ? cameraState : {};
    const existing = readCustomFromStorage();
    const requestedId = state.id && !BUILTIN_IDS.has(String(state.id)) ? String(state.id).trim() : null;
    const bm = normalizeBookmark({
        ...state,
        id: requestedId || slugifyId(cleanName),
        name: cleanName,
        builtin: false
    }, { builtin: false });
    bm.builtin = false;

    const next = existing.filter(item => item.id !== bm.id);
    next.push(bm);
    writeCustomToStorage(next);
    return cloneBookmark(bm);
}

export function deleteCustomBookmark(id) {
    if (!id || BUILTIN_IDS.has(String(id))) return false;
    const existing = readCustomFromStorage();
    const next = existing.filter(item => item.id !== String(id));
    if (next.length === existing.length) return false;
    writeCustomToStorage(next);
    return true;
}

export function mergeChainBookmarks(list) {
    if (!Array.isArray(list) || list.length === 0) return getAllBookmarks();
    const existing = readCustomFromStorage();
    const byId = new Map(existing.map(b => [b.id, cloneBookmark(b)]));
    let changed = false;

    for (const raw of list) {
        const bm = normalizeBookmark(raw, { builtin: false });
        if (!bm || BUILTIN_IDS.has(bm.id)) continue;
        bm.builtin = false;
        byId.set(bm.id, bm);
        changed = true;
    }

    if (changed) {
        writeCustomToStorage(Array.from(byId.values()));
    }
    return getAllBookmarks();
}

export function exportBookmarks({ includeBuiltins = true } = {}) {
    return includeBuiltins ? getAllBookmarks() : getCustomBookmarks();
}

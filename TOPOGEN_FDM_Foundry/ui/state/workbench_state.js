/**
 * WFC-FDM Foundry — Shared Workbench State, Event Bus & DOM Helpers (ui/state/workbench_state.js)
 *
 * Centralizes shared mutable workbench state (`appState`), cross-module action hooks (`actions`),
 * a lightweight pub/sub event bus (`on`, `off`, `emit`), Rhino3dm WASM initialization,
 * and shared DOM helpers so each tab module stays small, cohesive, and independent.
 */

import * as THREE from 'three';
import { WFC_FDM_CORE } from '../../core/index.mjs';

export const CORE = WFC_FDM_CORE;

export const PALETTE = Object.freeze({
    INK: 0x111827,
    GREY: 0x4b5563,
    LGREY: 0x9ca3af,
    FILL: 0xe5e7eb,
    ACCENT: 0xec4899
});

export const UI_LOOP_PALETTE = [
    0x60a5fa, 0xf472b6, 0x4ade80, 0xfacc15, 0xc084fc, 0xfb7185,
    0x2dd4bf, 0xfb923c, 0x38bdf8, 0xe879f9, 0xa3e635, 0xfde047
];

export const CUSTOM_TILE_PALETTE = [
    { color: [0.96, 0.62, 0.04], hex: '#f59e0b' }, // Amber
    { color: [0.06, 0.73, 0.51], hex: '#10b981' }, // Emerald
    { color: [0.55, 0.36, 0.96], hex: '#8b5cf6' }, // Violet
    { color: [0.94, 0.27, 0.27], hex: '#ef4444' }, // Red
    { color: [0.08, 0.72, 0.65], hex: '#14b8a6' }, // Teal
    { color: [0.98, 0.45, 0.09], hex: '#f97316' }  // Orange
];

export const TUBE_DEFAULTS = Object.freeze({
    radius: 0.060,
    innerRadiusM: 0.030,
    nSides: 8,
    endOffset: 0.04,
    longitudinalSubdivLevels: 1,
    pqOptimization: true,
    stitchAtBisectors: true,
    miterClamp: true,
    capLeafEnds: true,
    show: true,
    colorMode: 'longitudinal'
});

export const FEA_MATERIALS = Object.freeze({
    plaster: {
        name: 'Cast Gypsum Plaster',
        youngsModulusPa: 4.5e9,
        shearModulusPa: 1.875e9,
        densityKgM3: 1250,
        tensileStrengthPa: 2.0e6,
        compressiveStrengthPa: 10.0e6
    },
    gfrg: {
        name: 'GFRG Composite',
        youngsModulusPa: 7.5e9,
        shearModulusPa: 3.0e9,
        densityKgM3: 1450,
        tensileStrengthPa: 6.5e6,
        compressiveStrengthPa: 18.0e6
    },
    timber: {
        name: 'Timber (C24)',
        youngsModulusPa: 11.0e9,
        shearModulusPa: 0.69e9,
        densityKgM3: 420,
        tensileStrengthPa: 14.0e6,
        compressiveStrengthPa: 21.0e6
    },
    steel: {
        name: 'Steel (S235)',
        youngsModulusPa: 210.0e9,
        shearModulusPa: 81.0e9,
        densityKgM3: 7850,
        tensileStrengthPa: 235.0e6,
        compressiveStrengthPa: 235.0e6
    }
});

export function createEmptyAdjRules(n) {
    return [
        Array.from({ length: n }, () => Array(n).fill(false)),
        Array.from({ length: n }, () => Array(n).fill(false)),
        Array.from({ length: n }, () => Array(n).fill(false))
    ];
}

const initialTiles = CORE.createTileTemplates();

export const appState = {
    // Rhino WASM & CAD scene pools
    rhino: null,
    rhinoReady: null,
    currentDoc: null,
    unitScale: 1.0,
    pointPool: [],
    simLinePool: [],
    curvePool: [],
    meshPool: [],
    userImportedMeshes: [],
    selectedIdx: -1,

    // Bounding boxes
    modelBox: new THREE.Box3(),
    tilePreviewBounds: new THREE.Box3(),

    // Chrome & Goldilocks UI modes
    goldilocksMode: 'H1',
    sidebarCompactMode: false,
    activeTabId: 'tab-tiles',
    arcticOn: false,
    wireframeOn: false,
    gizmoMode: 'off',
    sketchMode: false,
    sketchPts: [],
    drawnCount: 0,
    cvHandles: [],
    camTween: null,

    // Layer / group visibility flags
    groupVis: {
        points: true,
        simLines: true,
        curves: true,
        meshes: true,
        graph: true,
        voxels: true,
        grid: true,
        bbox: true
    },
    showInactiveVoxels: true,
    showSuperposition: true,
    showCenterlineGraph: true,
    showQuadMeshes: true,
    showBoundingBox: true,
    structureBBox: new THREE.Box3(),

    // Tab 1 & Tab 2: Tiles, Adjacency Rules & Voxel Grid
    TILES: initialTiles,
    adjRules: createEmptyAdjRules(initialTiles.length),
    rulesInitialized: false,
    currentRuleAxis: 0,
    inspectedTileId: 1,
    tileViewMode: 'inspector', // 'inspector' | 'grid'
    ccSubdivLevel: 1,

    GRID_X: 3,
    GRID_Y: 3,
    GRID_Z: 4,
    VOXEL_SIZE: 1.0,
    GRID_ORIGIN: new THREE.Vector3(-1.5, -1.5, 0),
    loadedFileNetworkGraph: null,

    currentAlgorithm: 'wfc', // 'growth' | 'wfc'
    voxels: [],
    growthFrontier: [],
    simStepCount: 0,
    simRunning: false,
    mergeCollinearNodes: true,
    activeMeshEntry: null,
    lastWeldedGraph: {
        vertices: [],
        edges: [],
        valences: [],
        rawVertexCount: 0,
        rawEdgeCount: 0,
        weldTol: 1e-4,
        collinearMerged: true,
        boundingBox: { min: [0, 0, 0], max: [0, 0, 0] }
    },

    // Sub-step rule trace state
    substepMode: false,
    substepQueue: [],
    substepCursor: 0,
    currentSubstep: null,
    substepAccum: 0,
    SUBSTEP_INTERVAL: 0.28,

    // Tab 3: FDM & Fixed Anchors
    currentTilePreset: 'active_topo',
    lastHostGraph: null,
    fdmFixedNodeSet: new Set(),
    fdmFixedCustomized: false,
    fdmNodePickMeshes: [],
    lastFDMResult: null,
    fdmState: {
        triggerOnHost: false,
        mode: 'compression',
        qProfile: 'column_boosted',
        qBase: 5.0,
        columnBoost: 4.0,
        loadZ: 500.0,
        maxAnchors: 4,
        envX: 1.0,
        envY: 1.0,
        envZ: 2.0,
        fitEnvelope: true,
        pruneLeaves: true
    },

    // Tab 4: PQ Tubular Mesh & Unroll
    tubeState: Object.assign({}, TUBE_DEFAULTS),
    lastSolidData: null,
    faceLoopState: {
        loops: [],
        quadToLoopId: [],
        quadInheritedColors: null,
        quadParentLoopIds: null,
        parentLoopAdjacency: null,
        pqStats: null,
        selectedLoopIdx: 0,
        showUnrolled3D: false,
        unrolledBedLayout: null
    },

    // Tab 5: 3D Space-Frame FEA
    lastFEAResult: null,
    feaState: {
        materialKey: 'plaster',
        topLoadKg: 25,
        restraintType: 'pinned',
        visMode: 'axial',
        exaggeration: 50,
        animate: false,
        showArrows: true,
        animPhase: 0,
        runCount: 0,
        hudAutoExpandedOnce: false,
        historyLog: []
    },

    // Elastica Curves & Unrolled Rods Tab
    elasticaSourceSet: new Set(),
    elasticaSinkSet: new Set(),
    lastElasticaData: null,
    elasticaState: {
        pairMode: 'all_pairs',
        pickTarget: 'source',
        smoothMode: 'der_inextensible',
        inextensible: true,
        smoothLevel: 2,
        tightness: 0.50,
        rodRadius: 0.015,
        rodSides: 6,
        showLeaves: true,
        showSkeletalPaths: false,
        showCurves: true,
        showRods: true,
        showGuideTube: false,
        showUnrolled3D: false,
        selectedCurveIdx: 0
    }
};

// Cross-module action hooks populated by individual UI modules during initialization
export const actions = {};

// Lightweight event bus
const listeners = new Map();
export function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(handler);
    return () => off(event, handler);
}
export function off(event, handler) {
    const set = listeners.get(event);
    if (set) set.delete(handler);
}
export function emit(event, payload) {
    const set = listeners.get(event);
    if (!set) return;
    for (const fn of set) {
        try { fn(payload); } catch (err) { console.error(`[Event:${event}]`, err); }
    }
}

// Shared DOM helpers
export const $ = (id) => document.getElementById(id);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function setTxt(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

export function setValIfNotFocused(id, value) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = String(value);
}

export function bindSlider(rngId, valId, suffix, onVal) {
    const el = document.getElementById(rngId);
    const lbl = document.getElementById(valId);
    if (!el) return;
    el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (lbl) lbl.textContent = `${el.value}${suffix}`;
        onVal(v);
    });
}

export function downloadBlob(blob, name) {
    const url = URL.createObjectURL(blob);
    const aEl = document.createElement('a');
    aEl.href = url;
    aEl.download = name;
    document.body.appendChild(aEl);
    aEl.click();
    document.body.removeChild(aEl);
    URL.revokeObjectURL(url);
}

export async function initRhino() {
    const loadingOverlay = $('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');
    try {
        if (typeof globalThis.rhino3dm === 'function') {
            appState.rhino = await globalThis.rhino3dm();
        }
    } catch (err) {
        console.error('Failed to load Rhino WASM:', err);
    }
    if (loadingOverlay) loadingOverlay.classList.add('hidden');
    return appState.rhino;
}

export function getUnitScale(unitSystem) {
    const rhino = appState.rhino;
    if (!rhino || !rhino.UnitSystem) return 1.0;
    switch (unitSystem) {
        case rhino.UnitSystem.Millimeters: return 0.001;
        case rhino.UnitSystem.Centimeters: return 0.01;
        case rhino.UnitSystem.Meters: return 1.0;
        case rhino.UnitSystem.Inches: return 0.0254;
        case rhino.UnitSystem.Feet: return 0.3048;
        default: return 1.0;
    }
}

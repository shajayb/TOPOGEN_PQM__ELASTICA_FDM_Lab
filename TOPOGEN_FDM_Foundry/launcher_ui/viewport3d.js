/**
 * WFC·FDM Foundry — Z-Up Three.js CAD Viewport & 0ms LRU Candidate Bundle Cache
 *
 * Inputs / Outputs:
 *   - Initializes Z-up Three.js scene (`mainGroup.rotation.x = -Math.PI / 2`),
 *     envelope bounding box wireframe, shaded PQ tubular OBJ + quad edge overlay,
 *     force-colored FDM centerline graph + tensile-bar highlighting + anchor pins.
 *   - Maintains an in-memory LRU cache (`MAX_CACHED_BUNDLES = 64`) of fetched
 *     `/api/candidate` bundles AND parsed `THREE.BufferGeometry` data so hovering,
 *     clicking, or arrow-key scrubbing across Pareto points swaps 3D meshes in 0 ms!
 *
 * Air-Gap Compliance: Strictly neutral UI client (zero verifier module coupling).
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { API_BASE, appState, emit } from './state.js';
import { updateRightHud } from './verdict_hud.js';

const MAX_CACHED_BUNDLES = 64;
const candidateBundleLRU = new Map(); // cacheKey -> { bundle, parsedMesh }
let activeFetchToken = 0;

let scene = null;
let camera = null;
let renderer = null;
let controls = null;
let gridHelper = null;
let mainGroup = null;
let envelopeGroup = null;
let fdmGroup = null;
let tubeGroup = null;

let darkStudio = true;
let wireframeOnly = false;

const matTubeSolid = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.48,
    metalness: 0.08,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
});

const matTubeQuadEdges = new THREE.LineBasicMaterial({
    color: 0x0f172a,
    transparent: true,
    opacity: 0.55,
});

const ancGeoShared = new THREE.SphereGeometry(0.028, 14, 14);
const ancMatShared = new THREE.MeshStandardMaterial({
    color: 0x10b981,
    emissive: 0x064e3b,
    roughness: 0.3,
});

function clearGroup(grp, disposeGeometries = true) {
    if (!grp) return;
    while (grp.children.length > 0) {
        const ch = grp.children[0];
        if (disposeGeometries && ch.geometry && !ch.userData?.cachedGeo) {
            ch.geometry.dispose();
        }
        grp.remove(ch);
    }
}

function lruGet(key) {
    if (!candidateBundleLRU.has(key)) return null;
    const val = candidateBundleLRU.get(key);
    candidateBundleLRU.delete(key);
    candidateBundleLRU.set(key, val);
    return val;
}

function lruSet(key, val) {
    if (candidateBundleLRU.has(key)) {
        candidateBundleLRU.delete(key);
    } else if (candidateBundleLRU.size >= MAX_CACHED_BUNDLES) {
        const oldestKey = candidateBundleLRU.keys().next().value;
        const evicted = candidateBundleLRU.get(oldestKey);
        if (evicted?.parsedMesh) {
            evicted.parsedMesh.triGeo?.dispose();
            evicted.parsedMesh.edgeGeo?.dispose();
        }
        candidateBundleLRU.delete(oldestKey);
    }
    candidateBundleLRU.set(key, val);
}

export function clearCandidateCache() {
    for (const [, val] of candidateBundleLRU.entries()) {
        val?.parsedMesh?.triGeo?.dispose();
        val?.parsedMesh?.edgeGeo?.dispose();
    }
    candidateBundleLRU.clear();
}

export function cacheCandidateBundleDirect(cacheKey, bundle) {
    if (!cacheKey || !bundle) return;
    const parsedMesh = buildOBJGeometries(bundle.objText);
    lruSet(cacheKey, { bundle, parsedMesh });
}

function buildOBJGeometries(objText) {
    if (!objText) return null;
    const verts = [];
    const triPos = [];
    const edgePos = [];

    for (const raw of objText.split(/\r?\n/)) {
        const line = raw.trim();
        if (line.startsWith('v ')) {
            const p = line.split(/\s+/);
            verts.push([Number(p[1]), Number(p[2]), Number(p[3])]);
        } else if (line.startsWith('f ')) {
            const idx = line.split(/\s+/).slice(1).map(tok => parseInt(tok.split('/')[0], 10) - 1);
            if (idx.length >= 3) {
                for (let i = 1; i < idx.length - 1; i++) {
                    const a = verts[idx[0]], b = verts[idx[i]], c = verts[idx[i + 1]];
                    if (a && b && c) {
                        triPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
                    }
                }
                for (let i = 0; i < idx.length; i++) {
                    const u = verts[idx[i]], v = verts[idx[(i + 1) % idx.length]];
                    if (u && v) edgePos.push(u[0], u[1], u[2], v[0], v[1], v[2]);
                }
            }
        }
    }

    let triGeo = null;
    let edgeGeo = null;
    if (triPos.length > 0) {
        triGeo = new THREE.BufferGeometry();
        triGeo.setAttribute('position', new THREE.Float32BufferAttribute(triPos, 3));
        triGeo.computeVertexNormals();
    }
    if (edgePos.length > 0) {
        edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
    }
    return { triGeo, edgeGeo };
}

function mountParsedOBJ(parsedMesh, isCached = false) {
    clearGroup(tubeGroup, true);
    if (!parsedMesh) return;

    if (parsedMesh.triGeo) {
        matTubeSolid.wireframe = wireframeOnly;
        const mesh = new THREE.Mesh(parsedMesh.triGeo, matTubeSolid);
        mesh.userData.cachedGeo = isCached;
        tubeGroup.add(mesh);
    }
    if (parsedMesh.edgeGeo && !wireframeOnly) {
        const lines = new THREE.LineSegments(parsedMesh.edgeGeo, matTubeQuadEdges);
        lines.userData.cachedGeo = isCached;
        tubeGroup.add(lines);
    }
}

export function parseOBJTextAndRender(objText) {
    const parsed = buildOBJGeometries(objText);
    mountParsedOBJ(parsed, false);
}

export function drawEnvelopeBox(env) {
    clearGroup(envelopeGroup, true);
    if (!env || !envelopeGroup) return;
    const sx = Number(env.maxPlanX || 1.0);
    const sy = Number(env.maxPlanY || 1.0);
    const sz = Number(env.targetHeightZ || 2.0);
    const gz = Number(env.groundZ || 0.0);

    const boxGeo = new THREE.BoxGeometry(sx, sy, sz);
    const edgesGeo = new THREE.EdgesGeometry(boxGeo);
    boxGeo.dispose();
    const wire = new THREE.LineSegments(
        edgesGeo,
        new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.42 })
    );
    wire.position.set(0, 0, gz + sz * 0.5);
    envelopeGroup.add(wire);
}

export function renderTopologyGraph(topology, verdict) {
    clearGroup(fdmGroup, true);
    if (!fdmGroup || !topology || !Array.isArray(topology.vertices) || !Array.isArray(topology.edges)) return;

    const verts = topology.vertices;
    const edges = topology.edges;
    const anchors = new Set(topology.anchors || []);
    const qs = topology.fdm?.forceDensities || [];
    const maxQ = Math.max(1, ...qs.map(v => Math.abs(Number(v) || 1)));

    const tensSet = new Set(
        verdict?.loadCases?.[1]?.criteria?.compressionOnly?.tensileMemberIndices ||
        verdict?.loadCases?.[0]?.criteria?.compressionOnly?.tensileMemberIndices ||
        []
    );

    const pos = [];
    const cols = [];
    const cComp = new THREE.Color(0x22d3ee);
    const cHigh = new THREE.Color(0xec4899);
    const cTens = new THREE.Color(0xf43f5e);

    edges.forEach(([u, v], ei) => {
        const pu = verts[u], pv = verts[v];
        if (!pu || !pv) return;
        pos.push(pu[0], pu[1], pu[2], pv[0], pv[1], pv[2]);
        let col;
        if (tensSet.has(ei)) {
            col = cTens;
        } else {
            const t = Math.min(1, Math.abs(qs[ei] || 1) / maxQ);
            col = cComp.clone().lerp(cHigh, t * 0.65);
        }
        cols.push(col.r, col.g, col.b, col.r, col.g, col.b);
    });

    if (pos.length > 0) {
        const lGeo = new THREE.BufferGeometry();
        lGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        lGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
        const lMat = new THREE.LineBasicMaterial({
            vertexColors: true,
            depthTest: false,
            transparent: true,
            opacity: 0.92,
        });
        fdmGroup.add(new THREE.LineSegments(lGeo, lMat));
    }

    for (const ai of anchors) {
        const p = verts[ai];
        if (!p) continue;
        const pin = new THREE.Mesh(ancGeoShared, ancMatShared);
        pin.userData.cachedGeo = true;
        pin.position.set(p[0], p[1], p[2]);
        fdmGroup.add(pin);
    }
}

export function zoomFitModel() {
    if (!mainGroup || !camera || !controls) return;
    const box = new THREE.Box3().setFromObject(mainGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(0.8, size.x, size.y, size.z);
    controls.target.copy(center);
    camera.position.set(center.x + maxDim * 1.35, center.y + maxDim * 0.95, center.z + maxDim * 1.35);
    controls.update();
}

/**
 * Inspects a candidate in 3D + Verdict HUD.
 * Hits the in-memory LRU cache first for 0ms instant scrubbing!
 */
export async function inspectCandidateByStem(stem, autoZoom = false) {
    const rec = appState.currentCandidates.find(c => c.name === stem || c.stem === stem);
    if (!rec) return;

    appState.selectedCandidateStem = rec.name;
    emit('candidate_selected', rec.name);

    const topoKey = rec.artifacts?.topology || `${appState.currentRunId || 'run'}::${rec.name}`;
    const cached = lruGet(topoKey);
    if (cached) {
        mountParsedOBJ(cached.parsedMesh, true);
        renderTopologyGraph(cached.bundle.topology, cached.bundle.verdict);
        updateRightHud(rec, cached.bundle.patternsSvg);
        if (autoZoom) zoomFitModel();
        return;
    }

    if (!rec.artifacts?.topology) {
        updateRightHud(rec, null);
        return;
    }

    const myToken = ++activeFetchToken;
    updateRightHud(rec, null);

    try {
        const q = new URLSearchParams({ topo: rec.artifacts.topology });
        const res = await fetch(`${API_BASE}/api/candidate?${q.toString()}`);
        if (!res.ok) return;
        const bundle = await res.json();
        const parsedMesh = buildOBJGeometries(bundle.objText);
        lruSet(topoKey, { bundle, parsedMesh });

        // Only mount if user hasn't scrubbed to another candidate while fetching
        if (myToken === activeFetchToken) {
            mountParsedOBJ(parsedMesh, true);
            renderTopologyGraph(bundle.topology, bundle.verdict);
            updateRightHud(rec, bundle.patternsSvg);
            if (autoZoom) zoomFitModel();
        }
    } catch {
        // Ignore transient network errors when offline
    }
}

/**
 * Background prefetch helper so Pareto points are already warm in LRU cache before hover!
 */
export async function prefetchCandidateBundle(rec) {
    if (!rec?.artifacts?.topology) return;
    const topoKey = rec.artifacts.topology;
    if (candidateBundleLRU.has(topoKey)) return;
    try {
        const q = new URLSearchParams({ topo: topoKey });
        const res = await fetch(`${API_BASE}/api/candidate?${q.toString()}`);
        if (!res.ok) return;
        const bundle = await res.json();
        const parsedMesh = buildOBJGeometries(bundle.objText);
        lruSet(topoKey, { bundle, parsedMesh });
    } catch {}
}

export function initViewport3D() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f19);

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.02, 500);
    camera.position.set(2.8, 2.2, 2.8);

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, 0.95, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.05));
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight1.position.set(8, 14, 10);
    scene.add(dirLight1);
    const dirLight2 = new THREE.DirectionalLight(0x93c5fd, 0.45);
    dirLight2.position.set(-8, 6, -8);
    scene.add(dirLight2);

    gridHelper = new THREE.GridHelper(12, 24, 0x334155, 0x1e293b);
    scene.add(gridHelper);

    mainGroup = new THREE.Group();
    mainGroup.rotation.x = -Math.PI / 2;
    scene.add(mainGroup);

    envelopeGroup = new THREE.Group();
    fdmGroup = new THREE.Group();
    tubeGroup = new THREE.Group();
    mainGroup.add(envelopeGroup, fdmGroup, tubeGroup);

    const axesGroup = new THREE.Group();
    axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.002), new THREE.Vector3(0.6, 0, 0.002)]),
        new THREE.LineBasicMaterial({ color: 0xef4444 })
    ));
    axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.002), new THREE.Vector3(0, 0.6, 0.002)]),
        new THREE.LineBasicMaterial({ color: 0x22c55e })
    ));
    axesGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.002), new THREE.Vector3(0, 0, 0.6)]),
        new THREE.LineBasicMaterial({ color: 0x38bdf8 })
    ));
    mainGroup.add(axesGroup);

    // Wire bottom display HUD buttons
    document.getElementById('chk-vis-tube')?.addEventListener('change', e => { tubeGroup.visible = e.target.checked; });
    document.getElementById('chk-vis-fdm')?.addEventListener('change', e => { fdmGroup.visible = e.target.checked; });
    document.getElementById('chk-vis-env')?.addEventListener('change', e => { envelopeGroup.visible = e.target.checked; });

    document.getElementById('btn-vis-wire')?.addEventListener('click', e => {
        wireframeOnly = !wireframeOnly;
        matTubeSolid.wireframe = wireframeOnly;
        e.currentTarget.classList.toggle('on', wireframeOnly);
        // Toggle quad edge overlay visibility
        tubeGroup.children.forEach(ch => {
            if (ch.isLineSegments) ch.visible = !wireframeOnly;
        });
    });

    document.getElementById('btn-vis-theme')?.addEventListener('click', e => {
        darkStudio = !darkStudio;
        scene.background = new THREE.Color(darkStudio ? 0x0b0f19 : 0xf8fafc);
        scene.remove(gridHelper);
        gridHelper = new THREE.GridHelper(12, 24, darkStudio ? 0x334155 : 0xcbd5e1, darkStudio ? 0x1e293b : 0xe2e8f0);
        scene.add(gridHelper);
        e.currentTarget.textContent = darkStudio ? 'Studio Light' : 'Obsidian Dark';
    });

    document.getElementById('btn-vis-fit')?.addEventListener('click', zoomFitModel);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    function animate() {
        requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
    }
    animate();
}

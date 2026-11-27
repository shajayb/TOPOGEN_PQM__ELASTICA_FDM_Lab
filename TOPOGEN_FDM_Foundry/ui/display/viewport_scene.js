/**
 * WFC-FDM Foundry — 3D Viewport Scene, Camera, Lighting, Materials & Picking (ui/display/viewport_scene.js)
 *
 * Student Quick-Map:
 *   - Edit studio background color, camera FOV, or directional lights -> initViewportScene()
 *   - Edit Arctic clay / surface / wireframe materials                -> sharedMaterials
 *   - Edit framing / Zoom-Fit offset                                  -> zoomToBox(), recomputeModelBox()
 *   - Edit bottom-left 2D canvas status bar & sub-step callouts       -> drawOverlay()
 *
 * Inputs:  DOM `#canvas-container` & `#overlay-canvas`, `appState`
 * Outputs: Scene graph (`scene`, `mainGroup`, 14 layer groups), camera helpers, render loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { appState, actions, PALETTE, $ } from '../state/workbench_state.js';
import { getBookmarkById } from './camera_bookmarks.js';

export const viewport = {
    container: null,
    overlay: null,
    octx: null,
    scene: null,
    camera: null,
    perspCamera: null,
    orthoCamera: null,
    projectionMode: 'perspective',
    orthoSize: 6,
    activeBookmarkId: null,
    renderer: null,
    controls: null,
    tControls: null,
    hemiLight: null,
    dirLight: null,
    gridHelper: null,
    axesGroup: null,
    mainGroup: null,
    pointGroup: null,
    curveGroup: null,
    userMeshGroup: null,
    meshGroup: null,
    graphGroup: null,
    tilePreviewGroup: null,
    fdmGroup: null,
    tubeGroup: null,
    unroll3DGroup: null,
    elasticaGroup: null,
    elasticaUnroll3DGroup: null,
    feaGroup: null,
    voxelGroup: null,
    bboxGroup: null,
    substepGroup: null,
    sketchGroup: null,
    cvGroup: null,
    fatMaterials: [],
    requestRender: null,
    setBusy: null,
    setProjectionMode: null,
    getCameraBookmarkState: null,
    applyCameraBookmark: null,
    captureHighResPNG: null
};

export const sharedMaterials = {};
export const sharedGeometries = {};

// --- On-Demand / Visibility-Gated Render Scheduler (REV-B05-01) ---
let _dirtyFrames = 15;
let _rafId = null;
let _loopStarted = false;
let _renderClock = null;
let _inRenderTick = false;

function needsContinuousRender() {
    return Boolean(
        appState.camTween ||
        (viewport.tControls && viewport.tControls.dragging) ||
        (typeof actions.isFEAAnimating === 'function' && actions.isFEAAnimating()) ||
        appState.feaAnimating ||
        (appState.feaState && appState.feaState.animate) ||
        appState.simRunning
    );
}

function _renderTick() {
    _rafId = null;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!viewport.renderer || !viewport.scene || !viewport.camera) return;

    _inRenderTick = true;
    let updateActive = false;
    try {
        const dt = _renderClock ? Math.min(_renderClock.getDelta(), 0.1) : (1 / 60);
        updateActive = actions.update ? Boolean(actions.update(dt)) : false;
        if (actions.tickFEAAnimation) actions.tickFEAAnimation(dt);
        updateCamTween(dt);
        if (viewport.controls) viewport.controls.update();
        renderFrame();
        drawOverlay();
    } finally {
        _inRenderTick = false;
    }

    if (_dirtyFrames > 0) _dirtyFrames--;
    if (_rafId === null && (_dirtyFrames > 0 || updateActive || needsContinuousRender())) {
        _rafId = requestAnimationFrame(_renderTick);
    }
}

export function requestRender(frames = 15) {
    const n = Math.max(1, Math.round(Number(frames) || 1));
    if (n > _dirtyFrames) _dirtyFrames = n;
    if (!_loopStarted || _inRenderTick) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (_rafId === null) {
        if (_renderClock) _renderClock.getDelta(); // reset idle dt spike
        _rafId = requestAnimationFrame(_renderTick);
    }
}

export function setBusy(label) {
    if (typeof document === 'undefined') return;
    let pill = document.getElementById('workbench-busy-pill');
    const text = label ? String(label).trim() : '';
    if (!text) {
        if (pill) pill.classList.add('hidden');
        return;
    }
    if (!pill) {
        pill = document.createElement('div');
        pill.id = 'workbench-busy-pill';
        pill.className = 'workbench-busy-pill';
        pill.setAttribute('role', 'status');
        pill.setAttribute('aria-live', 'polite');
        pill.innerHTML = '<span class="workbench-busy-spinner" aria-hidden="true"></span><span class="workbench-busy-text"></span>';
        document.body.appendChild(pill);
    }
    const textEl = pill.querySelector('.workbench-busy-text');
    if (textEl) textEl.textContent = text;
    pill.classList.remove('hidden');
}

viewport.requestRender = requestRender;
viewport.setBusy = setBusy;

function watchTruthyStateFlag(obj, prop, onTruthy) {
    if (!obj || typeof obj !== 'object') return;
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    if (desc && !desc.configurable) return;
    let val = obj[prop];
    Object.defineProperty(obj, prop, {
        configurable: true,
        enumerable: true,
        get() { return val; },
        set(next) {
            val = next;
            if (next) onTruthy();
        }
    });
}

export const cssSize = () => ({ w: window.innerWidth, h: window.innerHeight });

export function sizeOverlay() {
    if (!viewport.overlay || !viewport.octx) return;
    const { w, h } = cssSize();
    const dpr = window.devicePixelRatio || 1;
    viewport.overlay.width = Math.round(w * dpr);
    viewport.overlay.height = Math.round(h * dpr);
    viewport.overlay.style.width = `${w}px`;
    viewport.overlay.style.height = `${h}px`;
    viewport.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function makeFatMaterial(color, widthPx, opts = {}) {
    const { w, h } = cssSize();
    const { disposeOnClear = false, ...rest } = opts;
    const m = new LineMaterial({ color, linewidth: widthPx, ...rest });
    m.resolution.set(w, h);
    if (disposeOnClear) m.userData.disposeOnClear = true;
    viewport.fatMaterials.push(m);
    return m;
}

export function makeFatLine(points, material) {
    const geo = new LineGeometry();
    const arr = [];
    points.forEach(p => arr.push(p.x, p.y, p.z));
    geo.setPositions(arr);
    const line = new Line2(geo, material);
    line.computeLineDistances();
    return line;
}

export function makeFatLineSegments(positionsArray, material, colorsArray = null) {
    const geo = new LineSegmentsGeometry();
    geo.setPositions(positionsArray);
    if (colorsArray) geo.setColors(colorsArray);
    const segs = new LineSegments2(geo, material);
    segs.computeLineDistances();
    return segs;
}

export function clearGroup(group) {
    if (!group) return;
    const hadChildren = group.children.length > 0;
    const disposeMaterialList = (matOrArr) => {
        if (!matOrArr) return;
        const mats = Array.isArray(matOrArr) ? matOrArr : [matOrArr];
        for (const m of mats) {
            if (m && m.userData && m.userData.disposeOnClear) {
                m.dispose();
                let idx = viewport.fatMaterials.indexOf(m);
                while (idx !== -1) {
                    viewport.fatMaterials.splice(idx, 1);
                    idx = viewport.fatMaterials.indexOf(m);
                }
            }
        }
    };
    while (group.children.length > 0) {
        const child = group.children[0];
        if (child.line && child.cone && typeof child.dispose === 'function') {
            child.dispose();
        } else if (typeof child.traverse === 'function') {
            child.traverse(obj => {
                if (
                    obj.geometry &&
                    obj.geometry !== sharedGeometries.pointSphere &&
                    obj.geometry !== sharedGeometries.graphNode &&
                    !(obj.geometry.userData && obj.geometry.userData.shared)
                ) {
                    obj.geometry.dispose();
                }
                disposeMaterialList(obj.material);
            });
        } else {
            if (
                child.geometry &&
                child.geometry !== sharedGeometries.pointSphere &&
                child.geometry !== sharedGeometries.graphNode &&
                !(child.geometry.userData && child.geometry.userData.shared)
            ) {
                child.geometry.dispose();
            }
            disposeMaterialList(child.material);
        }
        group.remove(child);
    }
    if (hadChildren) requestRender();
}

const smooth = x => x * x * (3 - 2 * x);

function round5(v) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n * 1e5) / 1e5 : 0;
}

function updateOrthoFrustum(orthoCam, aspect, orthoSize) {
    if (!orthoCam) return;
    const a = Math.max(0.05, Number(aspect) || 1);
    const halfH = Math.max(0.05, (Number(orthoSize) || 6) * 0.5);
    orthoCam.left = -halfH * a;
    orthoCam.right = halfH * a;
    orthoCam.top = halfH;
    orthoCam.bottom = -halfH;
    orthoCam.updateProjectionMatrix();
}

export function setProjectionMode(mode, { preserveFraming = true } = {}) {
    const nextMode = String(mode || 'perspective').toLowerCase().startsWith('ortho')
        ? 'orthographic'
        : 'perspective';
    if (!viewport.perspCamera || !viewport.orthoCamera) {
        viewport.projectionMode = nextMode;
        return nextMode;
    }

    const prevMode = viewport.projectionMode;
    const prevCam = viewport.camera || viewport.perspCamera;
    const nextCam = nextMode === 'orthographic' ? viewport.orthoCamera : viewport.perspCamera;
    const sz = cssSize();
    const aspect = Math.max(0.05, sz.w / Math.max(1, sz.h));
    const target = viewport.controls ? viewport.controls.target.clone() : new THREE.Vector3();

    if (prevMode !== nextMode && preserveFraming && prevCam) {
        const offset = prevCam.position.clone().sub(target);
        const dist = Math.max(offset.length(), 0.05);
        const dir = offset.lengthSq() > 1e-10 ? offset.clone().normalize() : new THREE.Vector3(0.68, 0.52, 0.78).normalize();

        nextCam.up.copy(prevCam.up);
        if (nextMode === 'orthographic') {
            const fovRad = THREE.MathUtils.degToRad(viewport.perspCamera.fov || 45);
            const visH = (2 * dist * Math.tan(fovRad * 0.5)) / Math.max(0.05, viewport.perspCamera.zoom || 1);
            viewport.orthoSize = Math.max(0.1, visH);
            nextCam.zoom = 1;
            nextCam.position.copy(prevCam.position);
            nextCam.near = -Math.max(1000, dist * 20);
            nextCam.far = Math.max(10000, dist * 100);
            updateOrthoFrustum(nextCam, aspect, viewport.orthoSize);
        } else {
            const visH = Math.max(0.1, (viewport.orthoSize || 6) / Math.max(0.05, viewport.orthoCamera.zoom || 1));
            const fovRad = THREE.MathUtils.degToRad(viewport.perspCamera.fov || 45);
            const nextDist = Math.max(0.1, visH / (2 * Math.tan(fovRad * 0.5)));
            nextCam.zoom = 1;
            nextCam.position.copy(target).addScaledVector(dir, nextDist);
            nextCam.aspect = aspect;
            nextCam.near = Math.max(nextDist / 2000, 0.001);
            nextCam.far = Math.max(10000, nextDist * 100);
            nextCam.updateProjectionMatrix();
        }
    } else if (nextMode === 'orthographic') {
        updateOrthoFrustum(nextCam, aspect, viewport.orthoSize);
    } else {
        nextCam.aspect = aspect;
        nextCam.updateProjectionMatrix();
    }

    viewport.projectionMode = nextMode;
    viewport.camera = nextCam;
    if (viewport.controls) {
        viewport.controls.object = nextCam;
        viewport.controls.update();
    }
    if (viewport.tControls) {
        viewport.tControls.camera = nextCam;
    }
    if (actions.syncCameraBookmarkUI) actions.syncCameraBookmarkUI();
    requestRender(15);
    return nextMode;
}

export function getCameraBookmarkState() {
    const cam = viewport.camera || viewport.perspCamera;
    const tgt = viewport.controls ? viewport.controls.target : new THREE.Vector3();
    if (!cam) {
        return {
            projection: viewport.projectionMode || 'perspective',
            position: [6.8, 5.2, 7.8],
            target: [0, 1.5, 0],
            up: [0, 1, 0],
            fov: 45,
            zoom: 1,
            orthoSize: viewport.orthoSize || 6
        };
    }
    const state = {
        projection: viewport.projectionMode === 'orthographic' ? 'orthographic' : 'perspective',
        position: [round5(cam.position.x), round5(cam.position.y), round5(cam.position.z)],
        target: [round5(tgt.x), round5(tgt.y), round5(tgt.z)],
        up: [round5(cam.up.x), round5(cam.up.y), round5(cam.up.z)],
        zoom: round5(cam.zoom || 1)
    };
    if (state.projection === 'orthographic') {
        state.orthoSize = round5(viewport.orthoSize || 6);
    } else {
        state.fov = round5(viewport.perspCamera ? viewport.perspCamera.fov : 45);
    }
    return state;
}

export function applyCameraBookmark(bookmark, opts = {}) {
    const bm = typeof bookmark === 'string' ? getBookmarkById(bookmark) : bookmark;
    if (!bm || typeof bm !== 'object') return null;

    const animate = Boolean(opts.animate);
    const fitBounds = opts.fitBounds !== undefined
        ? Boolean(opts.fitBounds)
        : (bm.fitToScene !== undefined ? Boolean(bm.fitToScene) : Boolean(bm.builtin));
    const proj = String(bm.projection || 'perspective').toLowerCase().startsWith('ortho')
        ? 'orthographic'
        : 'perspective';

    appState.camTween = null;
    setProjectionMode(proj, { preserveFraming: false });

    const cam = viewport.camera;
    if (!cam) return null;

    const sz = cssSize();
    const aspect = Math.max(0.05, sz.w / Math.max(1, sz.h));
    const bmPos = Array.isArray(bm.position) && bm.position.length >= 3
        ? new THREE.Vector3(Number(bm.position[0]) || 0, Number(bm.position[1]) || 0, Number(bm.position[2]) || 0)
        : new THREE.Vector3(6.8, 5.2, 7.8);
    const bmTgt = Array.isArray(bm.target) && bm.target.length >= 3
        ? new THREE.Vector3(Number(bm.target[0]) || 0, Number(bm.target[1]) || 0, Number(bm.target[2]) || 0)
        : new THREE.Vector3(0, 1.5, 0);
    const bmUp = Array.isArray(bm.up) && bm.up.length >= 3
        ? new THREE.Vector3(Number(bm.up[0]) || 0, Number(bm.up[1]) || 1, Number(bm.up[2]) || 0)
        : new THREE.Vector3(0, 1, 0);
    if (bmUp.lengthSq() < 1e-8) bmUp.set(0, 1, 0);
    bmUp.normalize();

    let toPos = bmPos.clone();
    let toTg = bmTgt.clone();
    let toFov = Math.max(10, Math.min(120, Number(bm.fov) || 45));
    let toZoom = Math.max(0.05, Math.min(50, Number(bm.zoom) || 1));
    let toOrthoSize = Math.max(0.1, Number(bm.orthoSize) || 6);

    if (fitBounds) {
        if (appState.modelBox.isEmpty()) recomputeModelBox({ skipBBox: true });
        const boxWorld = modelBoxToWorld(appState.modelBox);
        if (boxWorld && !boxWorld.isEmpty()) {
            const center = boxWorld.getCenter(new THREE.Vector3());
            const size = boxWorld.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z, 1.15);
            const rawDir = bmPos.clone().sub(bmTgt);
            const dir = rawDir.lengthSq() > 1e-10 ? rawDir.normalize() : new THREE.Vector3(0.68, 0.52, 0.78).normalize();
            toTg.copy(center);
            if (proj === 'orthographic') {
                toOrthoSize = Math.max(0.5, maxDim * 1.48);
                const dist = Math.max(maxDim * 3.0, 12);
                toPos.copy(center).addScaledVector(dir, dist);
            } else {
                const fovRad = THREE.MathUtils.degToRad(toFov);
                const dist = Math.abs(maxDim / 2 / Math.tan(fovRad / 2)) * 1.48;
                toPos.copy(center).addScaledVector(dir, dist);
            }
        }
    }

    cam.up.copy(bmUp);
    viewport.activeBookmarkId = bm.id || null;

    if (animate && viewport.controls) {
        appState.camTween = {
            t: 0,
            dur: 0.32,
            fromPos: cam.position.clone(),
            toPos,
            fromTg: viewport.controls.target.clone(),
            toTg,
            fromZoom: cam.zoom || 1,
            toZoom,
            fromFov: proj === 'perspective' ? (cam.fov || 45) : null,
            toFov: proj === 'perspective' ? toFov : null,
            fromOrthoSize: proj === 'orthographic' ? (viewport.orthoSize || 6) : null,
            toOrthoSize: proj === 'orthographic' ? toOrthoSize : null
        };
        if (actions.syncCameraBookmarkUI) actions.syncCameraBookmarkUI();
        requestRender(25);
        return getCameraBookmarkState();
    }

    cam.position.copy(toPos);
    cam.zoom = toZoom;
    if (proj === 'orthographic') {
        const dist = Math.max(toPos.distanceTo(toTg), 1);
        viewport.orthoSize = toOrthoSize;
        cam.near = -Math.max(1000, dist * 20);
        cam.far = Math.max(10000, dist * 100);
        updateOrthoFrustum(cam, aspect, viewport.orthoSize);
    } else {
        const dist = Math.max(toPos.distanceTo(toTg), 0.1);
        cam.fov = toFov;
        cam.aspect = aspect;
        cam.near = Math.max(dist / 2000, 0.001);
        cam.far = Math.max(10000, dist * 100);
        cam.updateProjectionMatrix();
    }
    if (viewport.controls) {
        viewport.controls.target.copy(toTg);
        viewport.controls.update();
    } else {
        cam.lookAt(toTg);
    }
    if (viewport.renderer && viewport.scene) {
        renderFrame();
    }
    if (actions.syncCameraBookmarkUI) actions.syncCameraBookmarkUI();
    requestRender(15);
    return getCameraBookmarkState();
}

function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const rad = Math.max(0, Math.min(r, Math.min(w, h) * 0.5));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, rad);
        return;
    }
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
    ctx.lineTo(x + rad, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
    ctx.lineTo(x, y + rad);
    ctx.quadraticCurveTo(x, y, x + rad, y);
    ctx.closePath();
}

function truncateText(ctx, text, maxWidth) {
    const raw = String(text ?? '');
    if (ctx.measureText(raw).width <= maxWidth) return raw;
    let out = raw;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) {
        out = out.slice(0, -1);
    }
    return `${out}…`;
}

export function drawStageUIOverlay(ctx, width, height, uiOverlay, fallbackMeta = {}) {
    if (!ctx || !uiOverlay || typeof uiOverlay !== 'object') return;
    const s = Math.max(0.65, Math.min(2.0, width / 1920));
    const margin = Math.round(28 * s);
    const cardW = Math.round(Math.min(410 * s, width * 0.34));
    const padX = Math.round(16 * s);
    const radius = Math.round(10 * s);

    const tabTitle = String(uiOverlay.tabTitle || 'WORKBENCH').trim();
    const stageCount = Math.max(0, Number(uiOverlay.stageCount) || 0);
    const stageIdx = Number.isFinite(Number(uiOverlay.stageIndex)) ? Number(uiOverlay.stageIndex) : -1;
    const stageCounter = stageCount > 0 && stageIdx >= 0
        ? `STAGE ${stageIdx + 1}/${stageCount}`
        : (stageIdx >= 0 ? `STAGE ${stageIdx + 1}` : 'STAGE');
    const stageLabel = String(uiOverlay.stageLabel || uiOverlay.op || 'Procedural Stage').trim();
    const opTag = uiOverlay.op ? String(uiOverlay.op).trim() : '';

    const rawParams = Array.isArray(uiOverlay.params) ? uiOverlay.params.slice(0, 14) : [];
    const rawMetrics = Array.isArray(uiOverlay.metrics)
        ? uiOverlay.metrics.map(m => String(m || '').trim()).filter(Boolean).slice(0, 8)
        : [];

    const headerH = Math.round(40 * s);
    const titleH = Math.round(38 * s);
    const rowH = Math.round(25 * s);
    const paramsPadY = rawParams.length > 0 ? Math.round(10 * s) : 0;
    const paramsBlockH = rawParams.length > 0 ? (paramsPadY * 2 + rawParams.length * rowH) : 0;

    // Pre-layout metric chips so we know exact footer height
    const chipFont = `600 ${Math.round(11 * s)}px Consolas, ui-monospace, monospace`;
    ctx.font = chipFont;
    const chipH = Math.round(22 * s);
    const chipGap = Math.round(6 * s);
    const chipPadX = Math.round(8 * s);
    const chipMaxRowW = cardW - padX * 2;
    const metricRows = [];
    if (rawMetrics.length > 0) {
        let curRow = [];
        let curW = 0;
        for (const text of rawMetrics) {
            const w = Math.min(chipMaxRowW, Math.ceil(ctx.measureText(text).width) + chipPadX * 2);
            if (curRow.length > 0 && curW + chipGap + w > chipMaxRowW) {
                metricRows.push(curRow);
                curRow = [{ text, w }];
                curW = w;
            } else {
                curRow.push({ text, w });
                curW += (curRow.length > 1 ? chipGap : 0) + w;
            }
        }
        if (curRow.length > 0) metricRows.push(curRow);
    }
    const metricsBlockH = metricRows.length > 0
        ? Math.round(12 * s) * 2 + metricRows.length * chipH + (metricRows.length - 1) * chipGap
        : 0;

    const cardH = Math.min(height - margin * 2 - Math.round(48 * s), headerH + titleH + paramsBlockH + metricsBlockH);
    const cardX = margin;
    const cardY = margin;

    ctx.save();

    // 1. Studio-Light floating card shell + subtle shadow
    ctx.save();
    ctx.shadowColor = 'rgba(15, 23, 42, 0.14)';
    ctx.shadowBlur = Math.round(24 * s);
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = Math.round(8 * s);
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, radius);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();
    ctx.restore();

    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, radius);
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = Math.max(1, Math.round(1.25 * s));
    ctx.stroke();

    // Clip inner contents cleanly to rounded card
    ctx.save();
    drawRoundedRectPath(ctx, cardX, cardY, cardW, cardH, radius);
    ctx.clip();

    // 2. Card header band (#f1f5f9)
    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(cardX, cardY, cardW, headerH);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = Math.max(1, Math.round(1 * s));
    ctx.beginPath();
    ctx.moveTo(cardX, cardY + headerH);
    ctx.lineTo(cardX + cardW, cardY + headerH);
    ctx.stroke();

    // Tab title pill (left)
    const pillFont = `700 ${Math.round(11 * s)}px system-ui, -apple-system, sans-serif`;
    ctx.font = pillFont;
    const tabPillTxt = tabTitle.toUpperCase();
    const tabPillW = Math.min(cardW * 0.56, Math.ceil(ctx.measureText(tabPillTxt).width) + Math.round(16 * s));
    const pillH = Math.round(22 * s);
    const pillY = cardY + Math.round((headerH - pillH) * 0.5);
    drawRoundedRectPath(ctx, cardX + padX, pillY, tabPillW, pillH, Math.round(5 * s));
    ctx.fillStyle = '#eff6ff';
    ctx.fill();
    ctx.strokeStyle = '#93c5fd';
    ctx.lineWidth = Math.max(1, Math.round(1 * s));
    ctx.stroke();
    ctx.fillStyle = '#1d4ed8';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(truncateText(ctx, tabPillTxt, tabPillW - Math.round(12 * s)), cardX + padX + Math.round(8 * s), pillY + pillH * 0.5 + 0.5);

    // Stage counter pill (right)
    ctx.font = `700 ${Math.round(10.5 * s)}px Consolas, ui-monospace, monospace`;
    const cntW = Math.ceil(ctx.measureText(stageCounter).width) + Math.round(14 * s);
    const cntX = cardX + cardW - padX - cntW;
    drawRoundedRectPath(ctx, cntX, pillY, cntW, pillH, Math.round(5 * s));
    ctx.fillStyle = '#e2e8f0';
    ctx.fill();
    ctx.fillStyle = '#334155';
    ctx.textAlign = 'center';
    ctx.fillText(stageCounter, cntX + cntW * 0.5, pillY + pillH * 0.5 + 0.5);

    // 3. Stage label + op tag row
    let cursorY = cardY + headerH;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const opMaxW = opTag ? Math.round(120 * s) : 0;
    ctx.font = `700 ${Math.round(13.5 * s)}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#0f172a';
    const labelMaxW = cardW - padX * 2 - (opTag ? opMaxW + Math.round(8 * s) : 0);
    ctx.fillText(truncateText(ctx, stageLabel, labelMaxW), cardX + padX, cursorY + titleH * 0.5);

    if (opTag) {
        ctx.font = `600 ${Math.round(10.5 * s)}px Consolas, ui-monospace, monospace`;
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'right';
        ctx.fillText(truncateText(ctx, opTag, opMaxW), cardX + cardW - padX, cursorY + titleH * 0.5);
    }
    cursorY += titleH;

    // 4. Key/value parameter rows
    if (rawParams.length > 0) {
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = Math.max(1, Math.round(1 * s));
        ctx.beginPath();
        ctx.moveTo(cardX + padX, cursorY);
        ctx.lineTo(cardX + cardW - padX, cursorY);
        ctx.stroke();

        cursorY += paramsPadY;
        for (let i = 0; i < rawParams.length; i++) {
            const p = rawParams[i] || {};
            const rowMidY = cursorY + rowH * 0.5;
            if (i % 2 === 1) {
                ctx.fillStyle = 'rgba(241, 245, 249, 0.72)';
                ctx.fillRect(cardX + Math.round(8 * s), cursorY, cardW - Math.round(16 * s), rowH);
            }
            ctx.font = `600 ${Math.round(11.5 * s)}px system-ui, -apple-system, sans-serif`;
            ctx.fillStyle = '#475569';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(truncateText(ctx, p.label ?? '', cardW * 0.52), cardX + padX, rowMidY);

            const isBool = typeof p.value === 'boolean' || p.kind === 'bool';
            if (isBool) {
                const on = Boolean(p.value) && String(p.value).toLowerCase() !== 'false' && String(p.value).toLowerCase() !== 'off';
                const badgeTxt = on ? 'ON' : 'OFF';
                const bW = Math.round(36 * s);
                const bH = Math.round(18 * s);
                const bX = cardX + cardW - padX - bW;
                const bY = rowMidY - bH * 0.5;
                drawRoundedRectPath(ctx, bX, bY, bW, bH, Math.round(4 * s));
                ctx.fillStyle = on ? '#ecfdf5' : '#f1f5f9';
                ctx.fill();
                ctx.strokeStyle = on ? '#6ee7b7' : '#cbd5e1';
                ctx.lineWidth = Math.max(1, Math.round(1 * s));
                ctx.stroke();
                ctx.font = `700 ${Math.round(10 * s)}px Consolas, ui-monospace, monospace`;
                ctx.fillStyle = on ? '#047857' : '#64748b';
                ctx.textAlign = 'center';
                ctx.fillText(badgeTxt, bX + bW * 0.5, rowMidY + 0.5);
            } else {
                ctx.font = `600 ${Math.round(11.5 * s)}px Consolas, ui-monospace, monospace`;
                ctx.fillStyle = p.kind === 'accent' ? '#1d4ed8' : '#0f172a';
                ctx.textAlign = 'right';
                ctx.fillText(truncateText(ctx, p.value ?? '—', cardW * 0.44), cardX + cardW - padX, rowMidY);
            }
            cursorY += rowH;
        }
        cursorY += paramsPadY;
    }

    // 5. Bottom telemetry metric chips
    if (metricRows.length > 0) {
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(cardX, cursorY, cardW, cardY + cardH - cursorY);
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = Math.max(1, Math.round(1 * s));
        ctx.beginPath();
        ctx.moveTo(cardX, cursorY);
        ctx.lineTo(cardX + cardW, cursorY);
        ctx.stroke();

        ctx.font = chipFont;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        let my = cursorY + Math.round(12 * s);
        for (const row of metricRows) {
            let mx = cardX + padX;
            for (const chip of row) {
                drawRoundedRectPath(ctx, mx, my, chip.w, chipH, Math.round(5 * s));
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.strokeStyle = '#cbd5e1';
                ctx.lineWidth = Math.max(1, Math.round(1 * s));
                ctx.stroke();
                ctx.fillStyle = '#1e293b';
                ctx.fillText(truncateText(ctx, chip.text, chip.w - Math.round(8 * s)), mx + chip.w * 0.5, my + chipH * 0.5 + 0.5);
                mx += chip.w + chipGap;
            }
            my += chipH + chipGap;
        }
    }

    ctx.restore(); // end card clip

    // 6. Subtle bottom-left projection / camera view pill
    const projRaw = uiOverlay.projection || fallbackMeta.projection || viewport.projectionMode || 'perspective';
    const isOrtho = String(projRaw).toLowerCase().startsWith('ortho');
    const projBadge = isOrtho ? 'ORTHO' : 'PERSP';
    const camName = String(uiOverlay.cameraName || fallbackMeta.cameraName || '').trim();
    const viewTag = camName ? `${projBadge} · ${camName}` : projBadge;

    ctx.font = `700 ${Math.round(11 * s)}px Consolas, ui-monospace, monospace`;
    const tagPadX = Math.round(12 * s);
    const tagH = Math.round(26 * s);
    const tagW = Math.ceil(ctx.measureText(viewTag).width) + tagPadX * 2;
    const tagX = margin;
    const tagY = height - margin - tagH;

    drawRoundedRectPath(ctx, tagX, tagY, tagW, tagH, Math.round(6 * s));
    ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
    ctx.fill();
    ctx.strokeStyle = isOrtho ? '#6ee7b7' : '#93c5fd';
    ctx.lineWidth = Math.max(1, Math.round(1.25 * s));
    ctx.stroke();
    ctx.fillStyle = isOrtho ? '#047857' : '#1d4ed8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(viewTag, tagX + tagW * 0.5, tagY + tagH * 0.5 + 0.5);

    ctx.restore();
}

export function captureHighResPNG({ width = 1920, height = 1080, bookmark = null, background = null, uiOverlay = null } = {}) {
    if (!viewport.renderer || !viewport.scene || !viewport.camera) {
        throw new Error('Viewport renderer is not initialized');
    }

    const capW = Math.max(64, Math.min(4096, Math.round(Number(width) || 1920)));
    const capH = Math.max(64, Math.min(4096, Math.round(Number(height) || 1080)));
    const capAspect = capW / capH;

    const savedCamState = getCameraBookmarkState();
    const savedBookmarkId = viewport.activeBookmarkId;
    const savedPixelRatio = viewport.renderer.getPixelRatio();
    const savedSize = viewport.renderer.getSize(new THREE.Vector2());
    const savedBg = viewport.scene.background;
    const savedFatRes = viewport.fatMaterials.map(m => (m && m.resolution ? m.resolution.clone() : null));

    try {
        let resolvedBookmark = null;
        if (bookmark) {
            resolvedBookmark = typeof bookmark === 'string' ? getBookmarkById(bookmark) : bookmark;
            applyCameraBookmark(resolvedBookmark || bookmark, { animate: false });
        }
        if (background !== null && background !== undefined) {
            viewport.scene.background = background instanceof THREE.Color ? background : new THREE.Color(background);
        }

        // Resize backing buffer only (updateStyle=false) so live CSS layout never flickers
        viewport.renderer.setPixelRatio(1);
        viewport.renderer.setSize(capW, capH, false);

        const activeCam = viewport.camera;
        if (activeCam.isOrthographicCamera) {
            updateOrthoFrustum(activeCam, capAspect, viewport.orthoSize);
        } else {
            activeCam.aspect = capAspect;
            activeCam.updateProjectionMatrix();
        }
        viewport.fatMaterials.forEach(m => {
            if (m && m.resolution) m.resolution.set(capW, capH);
        });

        viewport.renderer.render(viewport.scene, activeCam);

        if (uiOverlay && typeof uiOverlay === 'object' && typeof document !== 'undefined') {
            const offCanvas = document.createElement('canvas');
            offCanvas.width = capW;
            offCanvas.height = capH;
            const ctx = offCanvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(viewport.renderer.domElement, 0, 0, capW, capH);
                const activeBm = resolvedBookmark || (viewport.activeBookmarkId ? getBookmarkById(viewport.activeBookmarkId) : null);
                drawStageUIOverlay(ctx, capW, capH, uiOverlay, {
                    projection: viewport.projectionMode,
                    cameraName: activeBm ? activeBm.name : ''
                });
                return offCanvas.toDataURL('image/png');
            }
        }
        return viewport.renderer.domElement.toDataURL('image/png');
    } finally {
        viewport.scene.background = savedBg;
        viewport.renderer.setPixelRatio(savedPixelRatio);
        viewport.renderer.setSize(savedSize.x, savedSize.y, false);
        viewport.fatMaterials.forEach((m, idx) => {
            if (m && m.resolution && savedFatRes[idx]) {
                m.resolution.copy(savedFatRes[idx]);
            }
        });

        if (bookmark) {
            applyCameraBookmark(savedCamState, { animate: false, fitBounds: false });
            viewport.activeBookmarkId = savedBookmarkId;
        } else {
            const liveAspect = Math.max(0.05, savedSize.x / Math.max(1, savedSize.y));
            if (viewport.perspCamera) {
                viewport.perspCamera.aspect = liveAspect;
                viewport.perspCamera.updateProjectionMatrix();
            }
            if (viewport.orthoCamera) {
                updateOrthoFrustum(viewport.orthoCamera, liveAspect, viewport.orthoSize);
            }
        }
        viewport.renderer.render(viewport.scene, viewport.camera);
        if (actions.syncCameraBookmarkUI) actions.syncCameraBookmarkUI();
        requestRender(5);
    }
}

export function frameBoxParams(boxWorld) {
    const center = boxWorld.getCenter(new THREE.Vector3());
    const size = boxWorld.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1.15);
    const fovDeg = viewport.perspCamera ? viewport.perspCamera.fov : 45;
    const fov = fovDeg * (Math.PI / 180);
    const dist = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.48;
    const sz = cssSize();
    const aspect = Math.max(0.05, sz.w / Math.max(1, sz.h));

    if (viewport.perspCamera) {
        viewport.perspCamera.near = Math.max(dist / 2000, 0.001);
        viewport.perspCamera.far = Math.max(10000, dist * 100);
        viewport.perspCamera.updateProjectionMatrix();
    }
    if (viewport.orthoCamera) {
        viewport.orthoSize = Math.max(0.5, maxDim * 1.48);
        viewport.orthoCamera.zoom = 1;
        viewport.orthoCamera.near = -Math.max(1000, dist * 20);
        viewport.orthoCamera.far = Math.max(10000, dist * 100);
        updateOrthoFrustum(viewport.orthoCamera, aspect, viewport.orthoSize);
    }
    return { center, dist, maxDim };
}

export function zoomToBox(boxWorld) {
    if (!boxWorld || boxWorld.isEmpty()) return;
    const { center, dist, maxDim } = frameBoxParams(boxWorld);
    const viewOffset = new THREE.Vector3(dist * 0.68, dist * 0.52, dist * 0.78);
    const forward = viewOffset.clone().negate().normalize();
    const camRight = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const sidebarShift = !appState.sidebarCompactMode ? -maxDim * 0.14 : -maxDim * 0.06;
    const shiftedTarget = center.clone().addScaledVector(camRight, sidebarShift);
    viewport.camera.position.copy(shiftedTarget).add(viewOffset);
    viewport.controls.target.copy(shiftedTarget);
    viewport.controls.update();
    requestRender(15);
}

export function modelBoxToWorld(boxModel) {
    viewport.mainGroup.updateMatrixWorld(true);
    return boxModel.clone().applyMatrix4(viewport.mainGroup.matrixWorld);
}

export function expandBoxFromGroup(box, grp) {
    if (!grp || !grp.visible || grp.children.length === 0) return false;
    let added = false;
    const hasGroupTransform =
        grp.scale.x !== 1 || grp.scale.y !== 1 || grp.scale.z !== 1 ||
        grp.position.x !== 0 || grp.position.y !== 0 || grp.position.z !== 0;
    if (hasGroupTransform) grp.updateMatrix();
    grp.traverse(obj => {
        if (!obj.visible || !obj.geometry) return;
        obj.geometry.computeBoundingBox();
        if (obj.geometry.boundingBox && !obj.geometry.boundingBox.isEmpty()) {
            const b = obj.geometry.boundingBox.clone();
            if (obj.isInstancedMesh && obj.count > 0) {
                const tmpM = new THREE.Matrix4();
                const tmpV = new THREE.Vector3();
                for (let i = 0; i < obj.count; i++) {
                    obj.getMatrixAt(i, tmpM);
                    tmpV.setFromMatrixPosition(tmpM);
                    if (hasGroupTransform) tmpV.applyMatrix4(grp.matrix);
                    box.expandByPoint(tmpV);
                }
                added = true;
            } else {
                obj.updateMatrix();
                b.applyMatrix4(obj.matrix);
                if (hasGroupTransform) b.applyMatrix4(grp.matrix);
                box.union(b);
                added = true;
            }
        }
    });
    return added;
}

export function recomputeModelBox(opts = {}) {
    const { modelBox, pointPool, simLinePool, curvePool, activeTabId, lastFDMResult, lastSolidData, lastFEAResult, lastHostGraph, tilePreviewBounds, loadedFileNetworkGraph, GRID_X, GRID_Y, GRID_Z, VOXEL_SIZE } = appState;
    modelBox.makeEmpty();
    let hasFocused = false;

    pointPool.forEach(p => { modelBox.expandByPoint(p.pt); hasFocused = true; });
    simLinePool.forEach(l => {
        modelBox.expandByPoint(l.p0);
        modelBox.expandByPoint(l.p1);
        hasFocused = true;
    });
    curvePool.forEach(c => {
        if (c.visible !== false) c.displayPts.forEach(p => { modelBox.expandByPoint(p); hasFocused = true; });
    });
    if (expandBoxFromGroup(modelBox, viewport.userMeshGroup)) hasFocused = true;

    if (activeTabId === 'tab-fea' && lastFEAResult && viewport.feaGroup.visible && viewport.feaGroup.children.length > 0) {
        if (expandBoxFromGroup(modelBox, viewport.feaGroup)) hasFocused = true;
    } else if (activeTabId === 'tab-fdm' && viewport.fdmGroup.visible && viewport.fdmGroup.children.length > 0) {
        if (expandBoxFromGroup(modelBox, viewport.fdmGroup)) hasFocused = true;
    } else if ((lastSolidData || lastFDMResult || lastHostGraph) && (viewport.tubeGroup.visible || viewport.fdmGroup.visible) && activeTabId !== 'tab-tiles' && activeTabId !== 'tab-topo') {
        if (lastSolidData && lastSolidData.vertices && lastSolidData.vertices.length > 0 && viewport.tubeGroup.visible) {
            for (let i = 0; i < lastSolidData.vertices.length; i++) {
                const v = lastSolidData.vertices[i];
                modelBox.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
            }
            hasFocused = true;
        } else if (viewport.fdmGroup.visible && viewport.fdmGroup.children.length > 0) {
            if (expandBoxFromGroup(modelBox, viewport.fdmGroup)) hasFocused = true;
        } else if (lastFDMResult && lastFDMResult.boundingBox) {
            const bb = lastFDMResult.boundingBox;
            modelBox.expandByPoint(new THREE.Vector3(bb.min[0], bb.min[1], bb.min[2]));
            modelBox.expandByPoint(new THREE.Vector3(bb.max[0], bb.max[1], bb.max[2]));
            hasFocused = true;
        }
    } else if (viewport.tilePreviewGroup.visible && !tilePreviewBounds.isEmpty()) {
        modelBox.union(tilePreviewBounds);
        hasFocused = true;
    }

    if (!hasFocused && viewport.unroll3DGroup.visible && viewport.unroll3DGroup.children.length > 0) {
        if (expandBoxFromGroup(modelBox, viewport.unroll3DGroup)) hasFocused = true;
    }

    if (!hasFocused && loadedFileNetworkGraph && loadedFileNetworkGraph.boundingBox && loadedFileNetworkGraph.vertices && loadedFileNetworkGraph.vertices.length > 0) {
        const bb = loadedFileNetworkGraph.boundingBox;
        modelBox.expandByPoint(new THREE.Vector3(bb.min[0], bb.min[1], bb.min[2]));
        modelBox.expandByPoint(new THREE.Vector3(bb.max[0], bb.max[1], bb.max[2]));
        hasFocused = true;
    }

    if (!hasFocused) {
        const halfX = (GRID_X * VOXEL_SIZE) * 0.5;
        const halfY = (GRID_Y * VOXEL_SIZE) * 0.5;
        modelBox.expandByPoint(new THREE.Vector3(-halfX, -halfY, 0));
        modelBox.expandByPoint(new THREE.Vector3(halfX, halfY, GRID_Z * VOXEL_SIZE));
    }
    if (!opts.skipBBox) updateBoundingBox3D();
    requestRender();
}

function fmtDimM(val) {
    const v = Math.abs(Number(val) || 0);
    if (v >= 10) return v.toFixed(2);
    if (Math.abs(v - Math.round(v * 100) / 100) < 5e-4) return v.toFixed(2);
    return v.toFixed(3);
}

export function computeActiveStructureBBox() {
    const box = appState.structureBBox;
    box.makeEmpty();
    const { activeTabId, tileViewMode, userImportedMeshes, lastFEAResult, lastSolidData, lastFDMResult, lastHostGraph, lastWeldedGraph } = appState;

    // 1. User-imported CAD meshes / curves / points when present
    let hasGeom = false;
    appState.pointPool.forEach(p => { if (p.visible !== false) { box.expandByPoint(p.pt); hasGeom = true; } });
    appState.curvePool.forEach(c => { if (c.visible !== false) c.displayPts.forEach(p => { box.expandByPoint(p); hasGeom = true; }); });
    if (viewport.userMeshGroup && viewport.userMeshGroup.visible && viewport.userMeshGroup.children.length > 0) {
        if (expandBoxFromGroup(box, viewport.userMeshGroup)) hasGeom = true;
    }

    // 2. Active tab geometry (excludes flat 2D laser unroll sheet & inactive voxel cages!)
    if (activeTabId === 'tab-tiles' && tileViewMode === 'inspector' && userImportedMeshes.length === 0) {
        // Bound the inspected hero tile module itself (physical VOXEL_SIZE or hero preview) rather than the background gallery row
        const hs = (Number(appState.VOXEL_SIZE) || 1.0) * 0.5;
        const heroScale = 1.55;
        const heroCenterY = -0.35;
        const heroCenterZ = heroScale * 0.5 + 0.03;
        box.expandByPoint(new THREE.Vector3(-heroScale * 0.5, heroCenterY - heroScale * 0.5, heroCenterZ - heroScale * 0.5));
        box.expandByPoint(new THREE.Vector3(heroScale * 0.5, heroCenterY + heroScale * 0.5, heroCenterZ + heroScale * 0.5));
        box.userData = { overrideDimsM: [hs * 2, hs * 2, hs * 2] };
        hasGeom = true;
    } else if (activeTabId === 'tab-fea' && lastFEAResult && viewport.feaGroup && viewport.feaGroup.visible && viewport.feaGroup.children.length > 0) {
        box.userData = null;
        // Measure deflected/active structure nodes cleanly without oversizing from reaction arrow cones
        const gSrc = lastFEAResult._sourceGraph;
        const disp = lastFEAResult.nodalDisplacements;
        const exag = actions.computeEffectiveExaggeration ? actions.computeEffectiveExaggeration(appState.feaState.exaggeration) : 1;
        if (gSrc && Array.isArray(gSrc.vertices) && gSrc.vertices.length > 0) {
            const rPad = Number(appState.tubeState.radius) || 0;
            for (let i = 0; i < gSrc.vertices.length; i++) {
                const p = gSrc.vertices[i];
                const d = (disp && disp[i]) ? disp[i] : [0, 0, 0];
                const x = p[0] + (d[0] || 0) * exag;
                const y = p[1] + (d[1] || 0) * exag;
                const z = p[2] + (d[2] || 0) * exag;
                box.expandByPoint(new THREE.Vector3(x - rPad, y - rPad, z));
                box.expandByPoint(new THREE.Vector3(x + rPad, y + rPad, z + rPad));
            }
            hasGeom = true;
        } else if (expandBoxFromGroup(box, viewport.feaGroup)) {
            hasGeom = true;
        }
    } else if (activeTabId === 'tab-fdm' && (lastFDMResult || lastHostGraph)) {
        box.userData = null;
        const g = (appState.fdmState.triggerOnHost && lastFDMResult) ? lastFDMResult : (lastHostGraph || lastFDMResult);
        if (g && Array.isArray(g.vertices) && g.vertices.length > 0) {
            for (const p of g.vertices) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
            hasGeom = true;
        }
    } else if (lastSolidData && lastSolidData.vertices && lastSolidData.vertices.length > 0 && viewport.tubeGroup && viewport.tubeGroup.visible && activeTabId !== 'tab-tiles' && activeTabId !== 'tab-topo') {
        box.userData = null;
        for (let i = 0; i < lastSolidData.vertices.length; i++) {
            const v = lastSolidData.vertices[i];
            box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z));
        }
        hasGeom = true;
    } else if ((activeTabId === 'tab-pq' || activeTabId === 'tab-io') && (lastFDMResult || lastHostGraph)) {
        box.userData = null;
        const g = (appState.fdmState.triggerOnHost && lastFDMResult) ? lastFDMResult : (lastHostGraph || lastFDMResult);
        if (g && Array.isArray(g.vertices) && g.vertices.length > 0) {
            for (const p of g.vertices) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
            hasGeom = true;
        }
    } else {
        box.userData = null;
        if (viewport.meshGroup && viewport.meshGroup.visible && viewport.meshGroup.children.length > 0) {
            if (expandBoxFromGroup(box, viewport.meshGroup)) hasGeom = true;
        }
        if (!hasGeom && lastWeldedGraph && Array.isArray(lastWeldedGraph.vertices) && lastWeldedGraph.vertices.length > 0) {
            for (const p of lastWeldedGraph.vertices) box.expandByPoint(new THREE.Vector3(p[0], p[1], p[2]));
            hasGeom = true;
        }
    }

    if (!hasGeom && !appState.modelBox.isEmpty()) {
        box.copy(appState.modelBox);
    }
    return box;
}

export function updateBoundingBox3D() {
    if (!viewport.bboxGroup) return;
    clearGroup(viewport.bboxGroup);

    if (appState.activeTabId === 'tab-3dp') {
        viewport.bboxGroup.visible = false;
        return;
    }

    const visible = !!(appState.showBoundingBox && appState.groupVis.bbox !== false);
    viewport.bboxGroup.visible = visible;
    const box = computeActiveStructureBBox();
    if (!visible || box.isEmpty()) return;

    const min = box.min;
    const max = box.max;
    const w = Math.max(0, max.x - min.x);
    const d = Math.max(0, max.y - min.y);
    const h = Math.max(0, max.z - min.z);
    const diag = Math.hypot(w, d, h);
    if (diag < 1e-5) return;

    // 1. Subtle architectural wireframe bounding prism
    const x0 = min.x, x1 = max.x;
    const y0 = min.y, y1 = max.y;
    const z0 = min.z, z1 = max.z;
    const wirePos = new Float32Array([
        // Bottom rectangle
        x0, y0, z0,  x1, y0, z0,
        x1, y0, z0,  x1, y1, z0,
        x1, y1, z0,  x0, y1, z0,
        x0, y1, z0,  x0, y0, z0,
        // Top rectangle
        x0, y0, z1,  x1, y0, z1,
        x1, y0, z1,  x1, y1, z1,
        x1, y1, z1,  x0, y1, z1,
        x0, y1, z1,  x0, y0, z1,
        // 4 vertical pillars
        x0, y0, z0,  x0, y0, z1,
        x1, y0, z0,  x1, y0, z1,
        x1, y1, z0,  x1, y1, z1,
        x0, y1, z0,  x0, y1, z1
    ]);
    const wireGeo = new THREE.BufferGeometry();
    wireGeo.setAttribute('position', new THREE.BufferAttribute(wirePos, 3));
    const wireSegs = new THREE.LineSegments(wireGeo, sharedMaterials.bboxCage);
    wireSegs.computeLineDistances();
    wireSegs.renderOrder = 22;
    viewport.bboxGroup.add(wireSegs);

    // 2. Crisp corner architectural L-ticks & offset dimension lines along W (X), D (Y), H (Z)
    const tick = Math.max(0.025, Math.min(0.14, diag * 0.032));
    const off = Math.max(0.045, Math.min(0.22, diag * 0.048));
    const tickPos = [];
    const corners = [
        [x0, y0, z0, 1, 1, 1], [x1, y0, z0, -1, 1, 1], [x1, y1, z0, -1, -1, 1], [x0, y1, z0, 1, -1, 1],
        [x0, y0, z1, 1, 1, -1], [x1, y0, z1, -1, 1, -1], [x1, y1, z1, -1, -1, -1], [x0, y1, z1, 1, -1, -1]
    ];
    for (const [cx, cy, cz, sx, sy, sz] of corners) {
        const tx = Math.min(tick, w * 0.35), ty = Math.min(tick, d * 0.35), tz = Math.min(tick, h * 0.35);
        if (tx > 1e-4) tickPos.push(cx, cy, cz, cx + sx * tx, cy, cz);
        if (ty > 1e-4) tickPos.push(cx, cy, cz, cx, cy + sy * ty, cz);
        if (tz > 1e-4) tickPos.push(cx, cy, cz, cx, cy, cz + sz * tz);
    }

    // Offset dimension witness + measurement lines (front-bottom W, right-bottom D, front-right vertical H)
    // W along X at y = y0 - off, z = z0
    if (w > 1e-4) {
        const wy = y0 - off;
        tickPos.push(
            x0, y0, z0,  x0, wy - tick * 0.35, z0,
            x1, y0, z0,  x1, wy - tick * 0.35, z0,
            x0, wy, z0,  x1, wy, z0
        );
    }
    // D along Y at x = x1 + off, z = z0
    if (d > 1e-4) {
        const dx = x1 + off;
        tickPos.push(
            x1, y0, z0,  dx + tick * 0.35, y0, z0,
            x1, y1, z0,  dx + tick * 0.35, y1, z0,
            dx, y0, z0,  dx, y1, z0
        );
    }
    // H along Z at x = x1 + off, y = y1 + off * 0.35
    if (h > 1e-4) {
        const hx = x1 + off, hy = y1;
        tickPos.push(
            x1, y1, z0,  hx + tick * 0.35, hy, z0,
            x1, y1, z1,  hx + tick * 0.35, hy, z1,
            hx, hy, z0,  hx, hy, z1
        );
    }

    if (tickPos.length > 0) {
        const tGeo = new THREE.BufferGeometry();
        tGeo.setAttribute('position', new THREE.Float32BufferAttribute(tickPos, 3));
        const tSegs = new THREE.LineSegments(tGeo, sharedMaterials.bboxTicks);
        tSegs.renderOrder = 23;
        viewport.bboxGroup.add(tSegs);
    }
}

export function setArctic(on) {
    appState.arcticOn = !!on;
    appState.meshPool.forEach(m => {
        if (!m.mesh) return;
        m.mesh.material = appState.arcticOn
            ? sharedMaterials.arctic
            : (m.isUserImported ? sharedMaterials.userImportedMesh : sharedMaterials.surface);
    });
    viewport.meshGroup.children.forEach(m => {
        if (m.isMesh && m.userData && m.userData.baseMaterial) {
            m.material = appState.arcticOn ? sharedMaterials.arctic : m.userData.baseMaterial;
        }
    });
    viewport.tilePreviewGroup.children.forEach(m => {
        if (m.isMesh && m.userData && m.userData.arcticTarget) {
            m.material = appState.arcticOn ? sharedMaterials.arctic : (m.userData.baseMaterial || sharedMaterials.surface);
        }
    });
    viewport.tubeGroup.children.forEach(m => {
        if (m.isMesh && m.userData && m.userData.isTubeSurface) {
            m.material = appState.arcticOn ? sharedMaterials.arctic : (m.userData.baseMaterial || sharedMaterials.tubeVertexColored);
        }
    });
    viewport.unroll3DGroup.children.forEach(m => {
        if (m.isMesh && m.userData && m.userData.baseMaterial) {
            m.material = appState.arcticOn ? sharedMaterials.arctic : m.userData.baseMaterial;
        }
    });
    if (viewport.elasticaGroup) {
        viewport.elasticaGroup.children.forEach(m => {
            if (m.isMesh && m.userData && m.userData.baseMaterial) {
                m.material = appState.arcticOn ? sharedMaterials.arctic : m.userData.baseMaterial;
            }
        });
    }
    if (viewport.elasticaUnroll3DGroup) {
        viewport.elasticaUnroll3DGroup.children.forEach(m => {
            if (m.isMesh && m.userData && m.userData.baseMaterial) {
                m.material = appState.arcticOn ? sharedMaterials.arctic : m.userData.baseMaterial;
            }
        });
    }
    viewport.hemiLight.intensity = appState.arcticOn ? 1.45 : 1.35;
    viewport.dirLight.intensity = appState.arcticOn ? 0.45 : 1.15;
    const btnArctic = $('btn-arctic');
    if (btnArctic) {
        btnArctic.textContent = appState.arcticOn ? 'Arctic ✓' : 'Arctic';
        btnArctic.classList.toggle('seg-on', appState.arcticOn);
    }
    requestRender();
}

// --- Curve Pool & Gizmo Helpers ---
export function makeRhinoCurveFromPoints(ptsMeters) {
    if (!appState.rhino) return null;
    let crv = null;
    try {
        const pl = new appState.rhino.Point3dList(ptsMeters.length);
        ptsMeters.forEach(p => pl.add(p.x / appState.unitScale, p.y / appState.unitScale, p.z / appState.unitScale));
        crv = appState.rhino.NurbsCurve.create(false, 3, pl);
        pl.delete();
    } catch (e) { crv = null; }
    return crv;
}

export function renderCurves() {
    clearGroup(viewport.curveGroup);
    appState.curvePool.forEach((c, i) => {
        const centroid = new THREE.Vector3();
        c.displayPts.forEach(p => centroid.add(p));
        centroid.divideScalar(Math.max(c.displayPts.length, 1));
        c.centroid = centroid;
        c.localPts = c.displayPts.map(p => p.clone().sub(centroid));
        const mat = (i === appState.selectedIdx) ? sharedMaterials.sketch : sharedMaterials.curveLine;
        const line = makeFatLine(c.localPts, mat);
        line.position.copy(centroid);
        line.userData.poolIndex = i;
        c.line = line;
        line.visible = (c.visible !== false) && appState.groupVis.curves;
        viewport.curveGroup.add(line);
    });
}

export function refreshPoolUI() {
    const hasGraph = appState.lastWeldedGraph && appState.lastWeldedGraph.edges.length > 0;
    const hasAny = appState.pointPool.length > 0 || appState.simLinePool.length > 0 || appState.curvePool.length > 0 || appState.meshPool.length > 0 || hasGraph || !!appState.lastHostGraph || !!appState.lastFDMResult || !!appState.lastSolidData;
    const setDis = (id, dis) => { const el = $(id); if (el) el.disabled = dis; };
    setDis('btn-export', !hasAny);
    setDis('btn-export-graph-both', !hasGraph);
    setDis('btn-export-graph-3dm', !hasGraph);
    setDis('btn-export-graph-json', !hasGraph);
    setDis('btn-compact-export-graph', !hasGraph);
    setDis('btn-delete-selected', !appState.curvePool[appState.selectedIdx]);
}

function sampleAtNormalizedLength(pts, u) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[cum.length - 1];
    if (total < 1e-12) return pts[0].clone();
    const s = Math.min(Math.max(u, 0), 1) * total;
    let k = 0;
    while (k < cum.length - 2 && cum[k + 1] < s) k++;
    const seg = cum[k + 1] - cum[k];
    const f = seg > 1e-15 ? (s - cum[k]) / seg : 0;
    return pts[k].clone().lerp(pts[k + 1], f);
}

export function bakeObjectTransform() {
    const c = appState.curvePool[appState.selectedIdx];
    if (!c || !c.line) return;
    c.line.updateMatrix();
    const m = c.line.matrix.clone();
    c.displayPts = c.localPts.map(p => p.clone().applyMatrix4(m));
    if (c.ctrlPts) {
        const c0 = c.centroid;
        c.ctrlPts = c.ctrlPts.map(q => q.clone().sub(c0).applyMatrix4(m));
    }
    try { if (c.geom) c.geom.delete(); } catch (e) {}
    c.geom = makeRhinoCurveFromPoints(c.displayPts);
    renderCurves();
    recomputeModelBox();
    syncGizmo();
}

function buildCVHandles() {
    clearGroup(viewport.cvGroup);
    appState.cvHandles = [];
    const c = appState.curvePool[appState.selectedIdx];
    if (!c) return;
    if (!c.ctrlPts || c.ctrlPts.length < 2) {
        c.ctrlPts = Array.from({ length: 10 }, (_, i) => sampleAtNormalizedLength(c.displayPts, i / 9));
        c.cvDerived = true;
    }
    const r = Math.max(appState.modelBox.getSize(new THREE.Vector3()).length() * 0.008, 0.05);
    const geo = new THREE.SphereGeometry(r, 10, 10);
    c.ctrlPts.forEach((q, i) => {
        const h = new THREE.Mesh(geo, sharedMaterials.dot);
        h.position.copy(q);
        h.userData.cvIndex = i;
        h.renderOrder = 998;
        viewport.cvGroup.add(h);
        appState.cvHandles.push(h);
    });
}

function liveCVUpdate() {
    const c = appState.curvePool[appState.selectedIdx];
    const h = viewport.tControls.object;
    if (!c || !c.line || !h || h.userData.cvIndex === undefined) return;
    c.ctrlPts[h.userData.cvIndex] = h.position.clone();
    const cr = new THREE.CatmullRomCurve3(c.ctrlPts, false, 'centripetal');
    c.displayPts = cr.getPoints(Math.max(60, c.ctrlPts.length * 12));
    const arr = [];
    c.displayPts.forEach(p => arr.push(p.x - c.centroid.x, p.y - c.centroid.y, p.z - c.centroid.z));
    c.line.geometry.setPositions(arr);
}

function bakeCVEdit() {
    const c = appState.curvePool[appState.selectedIdx];
    if (!c) return;
    try { if (c.geom) c.geom.delete(); } catch (e) {}
    c.geom = makeRhinoCurveFromPoints(c.displayPts);
    recomputeModelBox();
}

export function syncGizmo() {
    viewport.tControls.detach();
    clearGroup(viewport.cvGroup);
    appState.cvHandles = [];
    const c = appState.curvePool[appState.selectedIdx];
    if (!c || appState.gizmoMode === 'off') return;
    if (appState.gizmoMode === 'cv') {
        buildCVHandles();
    } else {
        viewport.tControls.setMode(appState.gizmoMode);
        viewport.tControls.attach(c.line);
    }
}

export function setGizmoMode(mode) {
    appState.gizmoMode = mode;
    document.querySelectorAll('.gizbtn').forEach(b => b.classList.toggle('seg-on', b.dataset.gizmo === mode));
    syncGizmo();
}

export function selectCurve(idx) {
    appState.selectedIdx = appState.curvePool[idx] ? idx : -1;
    renderCurves();
    refreshPoolUI();
    if (actions.refreshOutliner) actions.refreshOutliner();
    syncGizmo();
}

export function deselect() {
    appState.selectedIdx = -1;
    renderCurves();
    refreshPoolUI();
    if (actions.refreshOutliner) actions.refreshOutliner();
    syncGizmo();
}

export function deleteSelectedCurve() {
    if (!appState.curvePool[appState.selectedIdx]) return;
    const removed = appState.curvePool.splice(appState.selectedIdx, 1)[0];
    try { if (removed.geom) removed.geom.delete(); } catch (e) {}
    appState.selectedIdx = -1;
    renderCurves();
    recomputeModelBox();
    refreshPoolUI();
    if (actions.refreshOutliner) actions.refreshOutliner();
    syncGizmo();
}

export function commitCurveFromPoints(ptsV3, label) {
    const cr = new THREE.CatmullRomCurve3(ptsV3, false, 'centripetal');
    const dense = cr.getPoints(Math.max(60, ptsV3.length * 12));
    const geom = makeRhinoCurveFromPoints(dense);
    if (!geom) return -1;
    appState.curvePool.push({
        name: label,
        geom,
        displayPts: dense,
        source: 'drawn',
        visible: true,
        ctrlPts: ptsV3.map(p => p.clone())
    });
    const idx = appState.curvePool.length - 1;
    renderCurves();
    recomputeModelBox();
    refreshPoolUI();
    if (actions.refreshOutliner) actions.refreshOutliner();
    return idx;
}

export function renderFrame() {
    viewport.renderer.render(viewport.scene, viewport.camera);
}

export function drawOverlay() {
    const { octx } = viewport;
    if (!octx) return;
    const { w, h } = cssSize();
    const { currentAlgorithm, voxels, GRID_X, GRID_Y, GRID_Z, substepMode, currentSubstep, substepCursor, substepQueue, activeTabId, lastFEAResult, feaState, lastSolidData } = appState;
    const algoLabel = currentAlgorithm === 'growth' ? 'Adjacency Growth' : 'Topo Collapse';
    const totalVoxels = voxels.length || (GRID_X * GRID_Y * GRID_Z);
    const collapsedCount = voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
    octx.clearRect(0, 0, w, h);

    if (substepMode && currentSubstep) {
        const ev = currentSubstep;
        const badgeText = `SUB-STEP [${substepCursor}/${substepQueue.length}]  ${ev.ruleText}  —  ${ev.desc}`;
        octx.font = 'bold 11px Consolas, monospace';
        const tw = Math.min(w - 24, octx.measureText(badgeText).width + 20);
        octx.fillStyle = 'rgba(17, 24, 39, 0.88)';
        octx.fillRect(10, 10, tw, 24);
        octx.strokeStyle = ev.allowed ? '#10b981' : '#f43f5e';
        octx.lineWidth = 1.5;
        octx.strokeRect(10, 10, tw, 24);
        octx.fillStyle = ev.allowed ? '#6ee7b7' : '#fda4af';
        octx.fillText(badgeText, 18, 26);

        const sv = voxels[ev.srcIdx];
        if (sv && actions.voxelCenter) {
            const sc = actions.voxelCenter(sv.x, sv.y, sv.z).clone();
            sc.applyMatrix4(viewport.mainGroup.matrixWorld);
            sc.project(viewport.camera);
            if (sc.z >= -1 && sc.z <= 1) {
                const sx = (sc.x * 0.5 + 0.5) * w;
                const sy = (-sc.y * 0.5 + 0.5) * h;
                octx.font = 'bold 10px Consolas, monospace';
                const tag = ev.ruleText;
                const bw = octx.measureText(tag).width + 10;
                octx.fillStyle = 'rgba(17, 24, 39, 0.85)';
                octx.fillRect(sx - bw * 0.5, sy - 24, bw, 16);
                octx.fillStyle = ev.allowed ? '#34d399' : '#fb7185';
                octx.fillText(tag, sx - bw * 0.5 + 5, sy - 12);
            }
        }
    }

    octx.font = '10px Consolas, monospace';
    octx.fillStyle = '#9ca3af';

    // Tab 8 (3DP): Strictly millimeter (mm) status bar & 3D bounding-box pills on Bambu P1S bed
    if (activeTabId === 'tab-3dp') {
        const m3 = typeof actions.get3dpOverlayMetrics === 'function' ? actions.get3dpOverlayMetrics() : null;
        let status3dp = 'units: mm · Bambu P1S (256×256×256 mm)';
        if (m3 && m3.bboxMm) {
            const sz = m3.bboxMm.size || [0, 0, 0];
            status3dp += ` · src: ${m3.sourceLabel || 'Mesh'} · ${sz[0].toFixed(1)}×${sz[1].toFixed(1)}×${sz[2].toFixed(1)} mm · ${m3.fitsBed ? 'BED FIT ✓' : 'OUT OF BED'}`;
            if (m3.layerCount > 0) {
                status3dp += ` · ${m3.layerCount} layers (${m3.sliceSource === 'bambu_cli' ? 'Bambu CLI' : 'Local'})`;
            }
        }
        octx.fillText(status3dp, 10, h - 8);

        if (
            appState.showBoundingBox &&
            appState.groupVis.bbox !== false &&
            m3 &&
            m3.bboxMm &&
            m3.sceneBBox &&
            viewport.print3dpGroup &&
            viewport.print3dpGroup.visible
        ) {
            const sb = m3.sceneBBox;
            const bw = Math.max(0, sb.max[0] - sb.min[0]);
            const bd = Math.max(0, sb.max[1] - sb.min[1]);
            const bh = Math.max(0, sb.max[2] - sb.min[2]);
            const diag = Math.hypot(bw, bd, bh);
            if (diag > 1e-5) {
                const off = Math.max(0.05, Math.min(0.22, diag * 0.055));
                viewport.print3dpGroup.updateMatrixWorld(true);

                const drawMmPill = (localPt, text, accentHex, bgAlpha = 0.88, isSummary = false) => {
                    const wp = localPt.clone().applyMatrix4(viewport.print3dpGroup.matrixWorld);
                    wp.project(viewport.camera);
                    if (wp.z < -1 || wp.z > 1) return;
                    const sx = (wp.x * 0.5 + 0.5) * w;
                    const sy = (-wp.y * 0.5 + 0.5) * h;
                    if (sx < -80 || sx > w + 80 || sy < -40 || sy > h + 40) return;

                    octx.font = isSummary ? '600 10.5px Consolas, monospace' : '600 10px Consolas, monospace';
                    const padX = isSummary ? 8 : 6;
                    const pillH = isSummary ? 19 : 16;
                    const tw = octx.measureText(text).width + padX * 2;
                    const rx = Math.round(sx - tw * 0.5);
                    const ry = Math.round(sy - pillH * 0.5);

                    octx.save();
                    octx.beginPath();
                    if (typeof octx.roundRect === 'function') {
                        octx.roundRect(rx, ry, tw, pillH, 4);
                    } else {
                        octx.rect(rx, ry, tw, pillH);
                    }
                    octx.fillStyle = `rgba(15, 23, 42, ${bgAlpha})`;
                    octx.fill();
                    octx.lineWidth = 1;
                    octx.strokeStyle = accentHex;
                    octx.stroke();

                    octx.fillStyle = '#f8fafc';
                    octx.textBaseline = 'middle';
                    octx.fillText(text, rx + padX, ry + pillH * 0.5 + 0.5);
                    octx.restore();
                };

                const szMm = m3.bboxMm.size || [0, 0, 0];
                const wMm = Number(szMm[0] || 0).toFixed(1);
                const dMm = Number(szMm[1] || 0).toFixed(1);
                const hMm = Number(szMm[2] || 0).toFixed(1);
                const summaryAccent = m3.fitsBed ? 'rgba(16, 185, 129, 0.85)' : 'rgba(244, 63, 94, 0.90)';

                if (bw > 1e-4) {
                    drawMmPill(
                        new THREE.Vector3((sb.min[0] + sb.max[0]) * 0.5, sb.min[1] - off * 1.45, sb.min[2]),
                        `W ${wMm} mm`,
                        'rgba(248, 113, 113, 0.72)'
                    );
                }
                if (bd > 1e-4) {
                    drawMmPill(
                        new THREE.Vector3(sb.max[0] + off * 1.45, (sb.min[1] + sb.max[1]) * 0.5, sb.min[2]),
                        `D ${dMm} mm`,
                        'rgba(52, 211, 153, 0.72)'
                    );
                }
                if (bh > 1e-4) {
                    drawMmPill(
                        new THREE.Vector3(sb.max[0] + off * 1.55, sb.max[1], (sb.min[2] + sb.max[2]) * 0.5),
                        `H ${hMm} mm`,
                        'rgba(56, 189, 248, 0.78)'
                    );
                }
                drawMmPill(
                    new THREE.Vector3((sb.min[0] + sb.max[0]) * 0.5, (sb.min[1] + sb.max[1]) * 0.5, sb.max[2] + off * 1.35),
                    `${wMm} × ${dMm} × ${hMm} mm${m3.fitsBed ? '' : ' · OVERFLOW'}`,
                    summaryAccent,
                    0.92,
                    true
                );
            }
        }
        return;
    }

    let statusLine = `units: m · grid: ${GRID_X}×${GRID_Y}×${GRID_Z} · topo: ${algoLabel} · collapsed: ${collapsedCount}/${totalVoxels}`;
    if (activeTabId === 'tab-fea' && lastFEAResult) {
        const dispVal = Number(lastFEAResult.maxDispMm || 0);
        const dispTxt = dispVal > 0 && dispVal < 0.1 ? dispVal.toFixed(3) : dispVal.toFixed(2);
        const invL = Number.isFinite(lastFEAResult.inverseDeflectionRatio) && lastFEAResult.inverseDeflectionRatio < 99999
            ? `L/${Math.round(lastFEAResult.inverseDeflectionRatio)}`
            : 'L/>9999';
        const sumRz = (lastFEAResult.reactions || []).reduce((s, r) => s + (r.force ? r.force[2] : 0), 0);
        const fmtS = (v) => (!Number.isFinite(v) || v > 99) ? '>99' : Number(v).toFixed(2);
        statusLine += ` · FEA #${feaState.runCount || 1}: ${lastFEAResult.passed ? 'PASS ✓' : 'CHECK LIMITS'} | |u|=${dispTxt}mm @#${lastFEAResult.maxDispNode ?? 0} (${invL}) | SFt=${fmtS(lastFEAResult.minSF_t)} SFc=${fmtS(lastFEAResult.minSF_c)} SFb=${fmtS(lastFEAResult.minSF_b)} | ΣRz=${sumRz.toFixed(1)}N`;
    } else if (lastSolidData && viewport.tubeGroup.visible) {
        statusLine += ` · PQ Tubes: ${lastSolidData.quads.length}Q / ${lastSolidData.triangles.length}T`;
    }
    octx.fillText(statusLine, 10, h - 8);

    // Architectural 3D Bounding Box Dimension Pills (W × D × H in meters)
    if (appState.showBoundingBox && appState.groupVis.bbox !== false && !appState.structureBBox.isEmpty()) {
        const bb = appState.structureBBox;
        const bw = Math.max(0, bb.max.x - bb.min.x);
        const bd = Math.max(0, bb.max.y - bb.min.y);
        const bh = Math.max(0, bb.max.z - bb.min.z);
        const diag = Math.hypot(bw, bd, bh);
        if (diag > 1e-5) {
            const off = Math.max(0.045, Math.min(0.22, diag * 0.048));
            viewport.mainGroup.updateMatrixWorld(true);

            const drawDimPill = (modelPt, text, accentHex, bgAlpha = 0.88, isSummary = false) => {
                const wp = modelPt.clone().applyMatrix4(viewport.mainGroup.matrixWorld);
                wp.project(viewport.camera);
                if (wp.z < -1 || wp.z > 1) return;
                const sx = (wp.x * 0.5 + 0.5) * w;
                const sy = (-wp.y * 0.5 + 0.5) * h;
                if (sx < -80 || sx > w + 80 || sy < -40 || sy > h + 40) return;

                octx.font = isSummary ? '600 10.5px Consolas, monospace' : '600 10px Consolas, monospace';
                const padX = isSummary ? 8 : 6;
                const pillH = isSummary ? 19 : 16;
                const tw = octx.measureText(text).width + padX * 2;
                const rx = Math.round(sx - tw * 0.5);
                const ry = Math.round(sy - pillH * 0.5);

                octx.save();
                octx.beginPath();
                if (typeof octx.roundRect === 'function') {
                    octx.roundRect(rx, ry, tw, pillH, 4);
                } else {
                    octx.rect(rx, ry, tw, pillH);
                }
                octx.fillStyle = `rgba(15, 23, 42, ${bgAlpha})`;
                octx.fill();
                octx.lineWidth = 1;
                octx.strokeStyle = accentHex;
                octx.stroke();

                octx.fillStyle = '#f8fafc';
                octx.textBaseline = 'middle';
                octx.fillText(text, rx + padX, ry + pillH * 0.5 + 0.5);
                octx.restore();
            };

            const ov = Array.isArray(bb.userData?.overrideDimsM) ? bb.userData.overrideDimsM : null;
            const wStr = fmtDimM(ov ? ov[0] : bw);
            const dStr = fmtDimM(ov ? ov[1] : bd);
            const hStr = fmtDimM(ov ? ov[2] : bh);

            // Individual axis edge callouts aligned with the 3D witness lines
            if (bw > 1e-4) {
                drawDimPill(
                    new THREE.Vector3((bb.min.x + bb.max.x) * 0.5, bb.min.y - off * 1.45, bb.min.z),
                    `W ${wStr} m`,
                    'rgba(248, 113, 113, 0.65)'
                );
            }
            if (bd > 1e-4) {
                drawDimPill(
                    new THREE.Vector3(bb.max.x + off * 1.45, (bb.min.y + bb.max.y) * 0.5, bb.min.z),
                    `D ${dStr} m`,
                    'rgba(52, 211, 153, 0.65)'
                );
            }
            if (bh > 1e-4) {
                drawDimPill(
                    new THREE.Vector3(bb.max.x + off * 1.55, bb.max.y, (bb.min.z + bb.max.z) * 0.5),
                    `H ${hStr} m`,
                    'rgba(56, 189, 248, 0.70)'
                );
            }
            // Tasteful top-crown summary badge: W × D × H m
            drawDimPill(
                new THREE.Vector3((bb.min.x + bb.max.x) * 0.5, (bb.min.y + bb.max.y) * 0.5, bb.max.z + off * 1.35),
                `${wStr} × ${dStr} × ${hStr} m`,
                'rgba(251, 191, 36, 0.72)',
                0.92,
                true
            );
        }
    }
}

export function updateCamTween(dt) {
    const { camTween } = appState;
    if (!camTween) return;
    camTween.t += dt;
    const s = smooth(Math.min(1, camTween.t / camTween.dur));
    viewport.camera.position.lerpVectors(camTween.fromPos, camTween.toPos, s);
    viewport.controls.target.lerpVectors(camTween.fromTg, camTween.toTg, s);
    if (camTween.fromZoom !== undefined && camTween.toZoom !== undefined) {
        viewport.camera.zoom = camTween.fromZoom + (camTween.toZoom - camTween.fromZoom) * s;
    }
    if (viewport.camera.isPerspectiveCamera && camTween.fromFov !== null && camTween.toFov !== null && camTween.toFov !== undefined) {
        viewport.camera.fov = camTween.fromFov + (camTween.toFov - camTween.fromFov) * s;
        viewport.camera.updateProjectionMatrix();
    } else if (viewport.camera.isOrthographicCamera && camTween.fromOrthoSize !== null && camTween.toOrthoSize !== null && camTween.toOrthoSize !== undefined) {
        const sz = cssSize();
        viewport.orthoSize = camTween.fromOrthoSize + (camTween.toOrthoSize - camTween.fromOrthoSize) * s;
        updateOrthoFrustum(viewport.camera, sz.w / Math.max(1, sz.h), viewport.orthoSize);
    } else if (camTween.fromZoom !== undefined && camTween.toZoom !== undefined) {
        viewport.camera.updateProjectionMatrix();
    }
    if (camTween.t >= camTween.dur) appState.camTween = null;
}

export function initViewportScene() {
    viewport.container = $('canvas-container');
    viewport.overlay = $('overlay-canvas');
    viewport.octx = viewport.overlay.getContext('2d');

    viewport.scene = new THREE.Scene();
    viewport.scene.background = new THREE.Color(0xffffff);

    const { w, h } = cssSize();
    const aspect = Math.max(0.05, w / Math.max(1, h));
    viewport.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 10000);
    viewport.perspCamera.position.set(18, 16, 18);

    const halfH = (viewport.orthoSize || 6) * 0.5;
    viewport.orthoCamera = new THREE.OrthographicCamera(-halfH * aspect, halfH * aspect, halfH, -halfH, -1000, 10000);
    viewport.orthoCamera.position.set(18, 16, 18);

    viewport.projectionMode = 'perspective';
    viewport.camera = viewport.perspCamera;

    viewport.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    viewport.renderer.setSize(w, h);
    viewport.renderer.setPixelRatio(window.devicePixelRatio || 1);
    viewport.container.appendChild(viewport.renderer.domElement);

    sizeOverlay();

    viewport.controls = new OrbitControls(viewport.camera, viewport.renderer.domElement);
    viewport.controls.enableDamping = true;
    viewport.controls.dampingFactor = 0.05;
    viewport.controls.addEventListener('change', () => requestRender(15));
    viewport.controls.addEventListener('start', () => requestRender(15));

    viewport.hemiLight = new THREE.HemisphereLight(0xffffff, 0xe5e7eb, 1.35);
    viewport.scene.add(viewport.hemiLight);
    viewport.dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
    viewport.dirLight.position.set(50, 100, 50);
    viewport.scene.add(viewport.dirLight);

    viewport.gridHelper = new THREE.GridHelper(100, 100, 0xd1d5db, 0xf3f4f6);
    viewport.scene.add(viewport.gridHelper);

    viewport.axesGroup = new THREE.Group();
    const axisLen = 8;
    const xAxisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.01), new THREE.Vector3(axisLen, 0, 0.01)]);
    const yAxisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0.01), new THREE.Vector3(0, axisLen, 0.01)]);
    viewport.axesGroup.add(new THREE.Line(xAxisGeo, new THREE.LineBasicMaterial({ color: 0xef4444 })));
    viewport.axesGroup.add(new THREE.Line(yAxisGeo, new THREE.LineBasicMaterial({ color: 0x22c55e })));

    viewport.mainGroup = new THREE.Group();
    viewport.mainGroup.rotation.x = -Math.PI / 2;
    viewport.scene.add(viewport.mainGroup);

    viewport.pointGroup       = new THREE.Group();
    viewport.curveGroup       = new THREE.Group();
    viewport.userMeshGroup    = new THREE.Group();
    viewport.meshGroup        = new THREE.Group();
    viewport.graphGroup       = new THREE.Group();
    viewport.tilePreviewGroup = new THREE.Group();
    viewport.fdmGroup         = new THREE.Group();
    viewport.tubeGroup             = new THREE.Group();
    viewport.unroll3DGroup         = new THREE.Group();
    viewport.elasticaGroup         = new THREE.Group();
    viewport.elasticaUnroll3DGroup = new THREE.Group();
    viewport.feaGroup              = new THREE.Group();
    viewport.voxelGroup       = new THREE.Group();
    viewport.bboxGroup        = new THREE.Group();
    viewport.substepGroup     = new THREE.Group();
    viewport.sketchGroup      = new THREE.Group();
    viewport.cvGroup          = new THREE.Group();

    viewport.mainGroup.add(
        viewport.axesGroup, viewport.pointGroup, viewport.curveGroup, viewport.userMeshGroup,
        viewport.meshGroup, viewport.graphGroup, viewport.tilePreviewGroup, viewport.fdmGroup,
        viewport.tubeGroup, viewport.unroll3DGroup, viewport.elasticaGroup, viewport.elasticaUnroll3DGroup,
        viewport.feaGroup, viewport.voxelGroup,
        viewport.bboxGroup, viewport.substepGroup, viewport.sketchGroup, viewport.cvGroup
    );

    // Shared geometries & materials
    sharedGeometries.graphNode = new THREE.SphereGeometry(0.055, 10, 10);
    sharedGeometries.pointSphere = new THREE.SphereGeometry(0.28, 16, 16);
    sharedGeometries.fdmPickSphere = new THREE.SphereGeometry(1, 14, 14);
    sharedGeometries.fdmPickSphere.userData.shared = true;

    sharedMaterials.surface = new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.72, metalness: 0.08, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    sharedMaterials.arctic = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 1.0, metalness: 0.0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    sharedMaterials.userImportedMesh = new THREE.MeshPhysicalMaterial({
        color: 0x38bdf8, transparent: true, opacity: 0.82, roughness: 0.45, metalness: 0.08, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    sharedMaterials.tubeVertexColored = new THREE.MeshPhysicalMaterial({
        vertexColors: true, roughness: 0.42, metalness: 0.0, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
    });
    sharedMaterials.quadWire = new THREE.LineBasicMaterial({ color: 0x334155, transparent: true, opacity: 0.45 });
    sharedMaterials.tubeWire = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.35 });
    sharedMaterials.innerBoreWire = new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.78, depthTest: false });
    sharedMaterials.bedBorder = new THREE.LineBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.85 });
    sharedMaterials.graphEdge = new THREE.LineBasicMaterial({ color: 0xef4444, transparent: true, opacity: 0.92, depthTest: false });
    sharedMaterials.graphNode = new THREE.MeshBasicMaterial({ color: 0xdc2626, transparent: true, opacity: 0.92, depthTest: false });
    sharedMaterials.anchorSphere = new THREE.MeshBasicMaterial({ color: 0x10b981 });
    sharedMaterials.anchorSphere.userData.shared = true;
    sharedMaterials.freeNodeSphere = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    sharedMaterials.freeNodeSphere.userData.shared = true;
    sharedMaterials.inactiveGrid = new THREE.LineBasicMaterial({ color: 0x9ca3af, transparent: true, opacity: 0.25 });
    sharedMaterials.bboxCage = new THREE.LineDashedMaterial({ color: 0xd97706, dashSize: 0.06, gapSize: 0.04, transparent: true, opacity: 0.62 });
    sharedMaterials.bboxTicks = new THREE.LineBasicMaterial({ color: 0xb45309, transparent: true, opacity: 0.88 });
    sharedMaterials.frontierGrid = new THREE.LineBasicMaterial({ color: 0xec4899, transparent: true, opacity: 0.45 });
    sharedMaterials.superpos = new THREE.MeshBasicMaterial({ color: 0xec4899, wireframe: true, transparent: true, opacity: 0.28 });
    sharedMaterials.subSrcBox = new THREE.MeshBasicMaterial({ color: 0xf59e0b, wireframe: true, transparent: true, opacity: 0.95 });
    sharedMaterials.subDstOk = new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true, transparent: true, opacity: 0.95 });
    sharedMaterials.subDstFail = new THREE.MeshBasicMaterial({ color: 0xf43f5e, wireframe: true, transparent: true, opacity: 0.95 });
    sharedMaterials.subGhostOk = new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    sharedMaterials.subGhostFail = new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.45, side: THREE.DoubleSide });
    sharedMaterials.subGhostLineOk = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.9, depthTest: false });
    sharedMaterials.subGhostLineFail = new THREE.LineBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.9, depthTest: false });

    sharedMaterials.curveLine = makeFatMaterial(PALETTE.INK, 1.5);
    sharedMaterials.curveLine.transparent = true;
    sharedMaterials.edgeLine = makeFatMaterial(PALETTE.GREY, 1.5);
    sharedMaterials.sketch = makeFatMaterial(PALETTE.ACCENT, 2.5);
    sharedMaterials.dot = new THREE.MeshBasicMaterial({ color: PALETTE.ACCENT, depthTest: false });

    // TransformControls gizmo
    viewport.tControls = new TransformControls(viewport.camera, viewport.renderer.domElement);
    viewport.tControls.setSize(0.8);
    viewport.scene.add(viewport.tControls);
    viewport.tControls.addEventListener('change', () => requestRender(15));
    viewport.tControls.addEventListener('dragging-changed', (e) => {
        viewport.controls.enabled = !e.value;
        requestRender(15);
        if (!e.value) {
            if (appState.gizmoMode === 'cv') bakeCVEdit();
            else bakeObjectTransform();
        }
    });
    viewport.tControls.addEventListener('objectChange', () => {
        if (appState.gizmoMode === 'cv') liveCVUpdate();
        requestRender(15);
    });

    // 3D Viewport Click Raycaster (FDM Fixed-Node Picking + Curve/CV Picking)
    const pickRay = new THREE.Raycaster();
    const mouseNdc = new THREE.Vector2();
    let downXY = null;
    viewport.renderer.domElement.addEventListener('pointerdown', (e) => {
        requestRender(15);
        if (e.button === 0) downXY = { x: e.clientX, y: e.clientY };
    });
    viewport.renderer.domElement.addEventListener('wheel', () => requestRender(15), { passive: true });
    viewport.renderer.domElement.addEventListener('pointerup', (e) => {
        requestRender(15);
        if (e.button !== 0 || !downXY) return;
        const moved = Math.hypot(e.clientX - downXY.x, e.clientY - downXY.y);
        downXY = null;
        if (moved > 5 || appState.sketchMode || viewport.tControls.dragging || viewport.tControls.axis) return;
        const rect = viewport.renderer.domElement.getBoundingClientRect();
        mouseNdc.set(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );
        pickRay.setFromCamera(mouseNdc, viewport.camera);

        if (appState.activeTabId === 'tab-pq' && actions.selectPqLoopById) {
            if (viewport.unroll3DGroup.visible) {
                const stripMeshes = viewport.unroll3DGroup.children.filter(c => c.isMesh && c.userData && c.userData.unrollLoopId !== undefined);
                const stripHits = pickRay.intersectObjects(stripMeshes, false);
                if (stripHits.length > 0) {
                    actions.selectPqLoopById(stripHits[0].object.userData.unrollLoopId);
                    return;
                }
            }
            if (viewport.tubeGroup.visible && appState.faceLoopState.quadToLoopId) {
                const tubeMeshes = viewport.tubeGroup.children.filter(c => c.isMesh && c.userData && c.userData.isTubeSurface);
                const tubeHits = pickRay.intersectObjects(tubeMeshes, false);
                if (tubeHits.length > 0 && tubeHits[0].faceIndex !== undefined) {
                    const qIdx = Math.floor(tubeHits[0].faceIndex / 2);
                    const lid = appState.faceLoopState.quadToLoopId[qIdx];
                    if (lid !== undefined && lid >= 0) {
                        actions.selectPqLoopById(lid);
                        return;
                    }
                }
            }
            // Clicked empty viewport space on tab-pq -> clear active correspondence arc
            actions.selectPqLoopById(null);
        }
        if ((appState.activeTabId === 'tab-fdm' || appState.activeTabId === 'tab-elastica') && viewport.fdmGroup.visible && appState.fdmNodePickMeshes.length > 0) {
            const nodeHits = pickRay.intersectObjects(appState.fdmNodePickMeshes, false);
            if (nodeHits.length > 0) {
                const hostIndices = nodeHits[0].object.userData.fdmHostNodeIndices;
                const isCtrl = !!(e.ctrlKey || e.metaKey);
                if (Array.isArray(hostIndices) && hostIndices.length > 0) {
                    if (appState.activeTabId === 'tab-fdm' && actions.toggleFdmFixedNodesByClick) {
                        actions.toggleFdmFixedNodesByClick(hostIndices, isCtrl);
                        return;
                    }
                    if (appState.activeTabId === 'tab-elastica' && actions.toggleElasticaNodesByClick) {
                        actions.toggleElasticaNodesByClick(hostIndices, isCtrl);
                        return;
                    }
                }
            }
        }
        if (appState.gizmoMode === 'cv' && appState.cvHandles.length) {
            const hit = pickRay.intersectObjects(appState.cvHandles, false)[0];
            if (hit) { viewport.tControls.setMode('translate'); viewport.tControls.attach(hit.object); return; }
        }
        try {
            const lines = appState.curvePool.map(c => c.line).filter(l => l && l.visible);
            const hits = pickRay.intersectObjects(lines, false);
            if (hits.length) { selectCurve(hits[0].object.userData.poolIndex); return; }
        } catch (err) {}
        if (appState.gizmoMode !== 'cv') deselect();
    });

    window.addEventListener('keydown', (e) => {
        if ((e.key === 'Delete' || e.key === 'Backspace') && appState.selectedIdx >= 0 && document.activeElement === document.body) {
            deleteSelectedCurve();
        }
    });

    window.addEventListener('resize', () => {
        const sz = cssSize();
        const aspect = Math.max(0.05, sz.w / Math.max(1, sz.h));
        if (viewport.perspCamera) {
            viewport.perspCamera.aspect = aspect;
            viewport.perspCamera.updateProjectionMatrix();
        }
        if (viewport.orthoCamera) {
            updateOrthoFrustum(viewport.orthoCamera, aspect, viewport.orthoSize);
        }
        viewport.renderer.setSize(sz.w, sz.h);
        sizeOverlay();
        viewport.fatMaterials.forEach(m => { if (m && m.resolution) m.resolution.set(sz.w, sz.h); });
        requestRender(15);
    });

    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) requestRender(15);
    });
    document.addEventListener('click', () => requestRender(15), { passive: true });
    document.addEventListener('input', () => requestRender(15), { passive: true });
    document.addEventListener('change', () => requestRender(15), { passive: true });

    // Wake render loop immediately whenever continuous-animation flags turn truthy
    watchTruthyStateFlag(appState, 'simRunning', () => requestRender(15));
    watchTruthyStateFlag(appState, 'camTween', () => requestRender(15));
    watchTruthyStateFlag(appState, 'feaAnimating', () => requestRender(15));
    if (appState.feaState) watchTruthyStateFlag(appState.feaState, 'animate', () => requestRender(15));

    viewport.requestRender = requestRender;
    viewport.setBusy = setBusy;
    viewport.setProjectionMode = setProjectionMode;
    viewport.getCameraBookmarkState = getCameraBookmarkState;
    viewport.applyCameraBookmark = applyCameraBookmark;
    viewport.captureHighResPNG = captureHighResPNG;
    return viewport;
}

export function startRenderLoop() {
    if (_loopStarted) {
        requestRender(15);
        return;
    }
    _renderClock = new THREE.Clock();
    _loopStarted = true;
    requestRender(15);
}

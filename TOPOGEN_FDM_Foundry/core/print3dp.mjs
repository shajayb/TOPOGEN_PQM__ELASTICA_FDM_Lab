/**
 * TOPOGEN_FDM_Foundry — Pure-JS 3D-Printing Engine for Bambu Lab P1S (core/print3dp.mjs)
 *
 * STRICT AIR-GAP: Zero imports from verifier/. Zero external dependencies.
 * Runs identically in Browser ES modules and Node.js.
 *
 * Provides:
 *  - P1S_SPEC: Bambu Lab P1S printer & process specification
 *  - rescaleGeometryForP1S: Non-mutating clone + Euler rotation + scale + Z=0 bed centering
 *  - buildBinarySTL / buildASCIISTL: STL serialization (Uint8Array / string)
 *  - analyzePrintability: Overhang, critical overhang, bed contact, min feature, score
 *  - sliceMeshLocal: Fast Z-bucketed pure-JS planar slicer for instant browser preview
 *  - parseBambuGcode: Real Bambu Studio plate_1.gcode parser (G0/G1/G2/G3 + features + stats)
 *  - scorePrintCandidate / generateOptimizationCandidates: Multi-orientation & recipe optimizer
 */

export const P1S_SPEC = Object.freeze({
    name: 'Bambu Lab P1S',
    bedX: 256,
    bedY: 256,
    bedZ: 256,
    safeMarginMm: 8,
    nozzleMm: 0.4,
    defaultLayerHeightMm: 0.2,
    minWallMm: 0.84,
    extrusionWidthMm: 0.42
});

const DEG2RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Internal Geometry Helpers
// ---------------------------------------------------------------------------

function round3(v) {
    return Math.round(v * 1000) / 1000;
}

function round2(v) {
    return Math.round(v * 100) / 100;
}

function round1(v) {
    return Math.round(v * 10) / 10;
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

/**
 * Normalize input mesh snapshot into fresh cloned vertices [[x,y,z],...],
 * cloned faces [[...],...], and triangulated triangles [[i0,i1,i2],...].
 * Never mutates the input snapshot.
 */
function cloneAndTriangulateSnapshot(meshSnapshot) {
    if (!meshSnapshot || !Array.isArray(meshSnapshot.vertices)) {
        throw new Error('meshSnapshot must have a vertices array');
    }

    const rawVerts = meshSnapshot.vertices;
    const vertices = new Array(rawVerts.length);
    for (let i = 0; i < rawVerts.length; i++) {
        const v = rawVerts[i];
        if (Array.isArray(v)) {
            vertices[i] = [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
        } else if (v && typeof v === 'object') {
            vertices[i] = [Number(v.x) || 0, Number(v.y) || 0, Number(v.z) || 0];
        } else {
            vertices[i] = [0, 0, 0];
        }
    }

    const faces = [];
    const triangles = [];

    if (Array.isArray(meshSnapshot.faces) && meshSnapshot.faces.length > 0) {
        for (let i = 0; i < meshSnapshot.faces.length; i++) {
            const f = meshSnapshot.faces[i];
            if (!Array.isArray(f) || f.length < 3) continue;
            const clonedFace = new Array(f.length);
            for (let k = 0; k < f.length; k++) clonedFace[k] = f[k] | 0;
            faces.push(clonedFace);
            for (let k = 1; k + 1 < clonedFace.length; k++) {
                triangles.push([clonedFace[0], clonedFace[k], clonedFace[k + 1]]);
            }
        }
    } else if (Array.isArray(meshSnapshot.triangles) && meshSnapshot.triangles.length > 0) {
        const rawTris = meshSnapshot.triangles;
        if (Array.isArray(rawTris[0])) {
            for (let i = 0; i < rawTris.length; i++) {
                const t = rawTris[i];
                if (!Array.isArray(t) || t.length < 3) continue;
                const tri = [t[0] | 0, t[1] | 0, t[2] | 0];
                triangles.push(tri);
                faces.push([tri[0], tri[1], tri[2]]);
            }
        } else {
            // Flat index array
            for (let i = 0; i + 2 < rawTris.length; i += 3) {
                const tri = [rawTris[i] | 0, rawTris[i + 1] | 0, rawTris[i + 2] | 0];
                triangles.push(tri);
                faces.push([tri[0], tri[1], tri[2]]);
            }
        }
    }

    return { vertices, faces, triangles };
}

function computeBBox(vertices) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        const x = v[0], y = v[1], z = v[2];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }
    if (!Number.isFinite(minX)) {
        return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
    }
    return {
        min: [minX, minY, minZ],
        max: [maxX, maxY, maxZ],
        size: [maxX - minX, maxY - minY, maxZ - minZ]
    };
}

/**
 * Apply intrinsic XYZ Euler rotation (Rx then Ry then Rz) around origin.
 */
function makeEulerMatrix(rxDeg, ryDeg, rzDeg) {
    const rx = (Number(rxDeg) || 0) * DEG2RAD;
    const ry = (Number(ryDeg) || 0) * DEG2RAD;
    const rz = (Number(rzDeg) || 0) * DEG2RAD;
    const cx = Math.cos(rx), sx = Math.sin(rx);
    const cy = Math.cos(ry), sy = Math.sin(ry);
    const cz = Math.cos(rz), sz = Math.sin(rz);

    // R = Rz * Ry * Rx
    return [
        cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
        sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
        -sy,     cy * sx,                cy * cx
    ];
}

function extractTriMesh(triMesh) {
    if (!triMesh || !Array.isArray(triMesh.vertices)) {
        throw new Error('triMesh must have a vertices array');
    }
    const vertices = triMesh.vertices;
    if (Array.isArray(triMesh.triangles)) {
        return { vertices, triangles: triMesh.triangles };
    }
    if (Array.isArray(triMesh.faces)) {
        const triangles = [];
        for (let i = 0; i < triMesh.faces.length; i++) {
            const f = triMesh.faces[i];
            if (!Array.isArray(f) || f.length < 3) continue;
            for (let k = 1; k + 1 < f.length; k++) {
                triangles.push([f[0], f[k], f[k + 1]]);
            }
        }
        return { vertices, triangles };
    }
    return { vertices, triangles: [] };
}

/**
 * Pure-JS OBJ parser helper producing { vertices, faces } snapshot.
 */
export function parseOBJToSnapshot(objText) {
    const vertices = [];
    const faces = [];
    const lines = String(objText || '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line[0] === '#') continue;
        if (line[0] === 'v' && (line[1] === ' ' || line[1] === '\t')) {
            const p = line.split(/\s+/);
            if (p.length >= 4) {
                vertices.push([parseFloat(p[1]) || 0, parseFloat(p[2]) || 0, parseFloat(p[3]) || 0]);
            }
        } else if (line[0] === 'f' && (line[1] === ' ' || line[1] === '\t')) {
            const parts = line.split(/\s+/).slice(1);
            const vCount = vertices.length;
            const idx = [];
            for (let k = 0; k < parts.length; k++) {
                const raw = parseInt(parts[k].split('/')[0], 10);
                if (!Number.isNaN(raw)) {
                    idx.push(raw > 0 ? raw - 1 : vCount + raw);
                }
            }
            if (idx.length >= 3) faces.push(idx);
        }
    }
    return { vertices, faces };
}

// ---------------------------------------------------------------------------
// 1b. checkP1SBedFit — Strict P1S build-volume gating (tolerance 0.05 mm)
// ---------------------------------------------------------------------------

/**
 * Checks whether a bounding box in mm fits strictly inside the Bambu Lab P1S bed
 * ([0..256, 0..256, 0..256] mm within +/-0.05 mm tolerance).
 * Returns { fitsBed, overflowMm: { x, y, z }, bedMm: [bedX, bedY, bedZ] }.
 */
export function checkP1SBedFit(bboxMm, opts = {}) {
    const bedX = Number.isFinite(opts.bedX) ? opts.bedX : P1S_SPEC.bedX;
    const bedY = Number.isFinite(opts.bedY) ? opts.bedY : P1S_SPEC.bedY;
    const bedZ = Number.isFinite(opts.bedZ) ? opts.bedZ : P1S_SPEC.bedZ;
    const tol = Number.isFinite(opts.toleranceMm) ? Math.max(0, opts.toleranceMm) : 0.05;

    const min = bboxMm && Array.isArray(bboxMm.min) ? bboxMm.min : [0, 0, 0];
    const max = bboxMm && Array.isArray(bboxMm.max) ? bboxMm.max : [0, 0, 0];

    const axisOverflow = (lo, hi, limit) => {
        const neg = lo < -tol ? -lo : 0;
        const pos = hi > limit + tol ? hi - limit : 0;
        return round3(neg + pos);
    };

    const ox = axisOverflow(min[0], max[0], bedX);
    const oy = axisOverflow(min[1], max[1], bedY);
    const oz = axisOverflow(min[2], max[2], bedZ);

    const fitsBed =
        min[0] >= -tol && max[0] <= bedX + tol &&
        min[1] >= -tol && max[1] <= bedY + tol &&
        min[2] >= -tol && max[2] <= bedZ + tol;

    return {
        fitsBed,
        overflowMm: { x: ox, y: oy, z: oz },
        bedMm: [bedX, bedY, bedZ]
    };
}

// ---------------------------------------------------------------------------
// 2. rescaleGeometryForP1S
// ---------------------------------------------------------------------------

/**
 * Rescales and rotates a read-only mesh snapshot for the Bambu Lab P1S bed.
 * Never mutates meshSnapshot or dimParams.
 * Centers X=128, Y=128 (bedX/2, bedY/2) and seats minZ=0.
 */
export function rescaleGeometryForP1S(meshSnapshot, dimParams = {}, opts = {}) {
    const { vertices, faces, triangles } = cloneAndTriangulateSnapshot(meshSnapshot);
    if (vertices.length === 0) {
        throw new Error('rescaleGeometryForP1S: meshSnapshot has no vertices');
    }

    const bedX = Number.isFinite(opts.bedX) ? opts.bedX : P1S_SPEC.bedX;
    const bedY = Number.isFinite(opts.bedY) ? opts.bedY : P1S_SPEC.bedY;
    const bedZ = Number.isFinite(opts.bedZ) ? opts.bedZ : P1S_SPEC.bedZ;
    const marginMm = Number.isFinite(opts.marginMm) ? Math.max(0, opts.marginMm) : P1S_SPEC.safeMarginMm;
    const fitMode = opts.fitMode || 'fit-bed';
    const rotXDeg = Number(opts.rotXDeg) || 0;
    const rotYDeg = Number(opts.rotYDeg) || 0;
    const rotZDeg = Number(opts.rotZDeg) || 0;

    // 1. Rotate around raw bounding-box center
    const rawBox = computeBBox(vertices);
    const rcx = (rawBox.min[0] + rawBox.max[0]) * 0.5;
    const rcy = (rawBox.min[1] + rawBox.max[1]) * 0.5;
    const rcz = (rawBox.min[2] + rawBox.max[2]) * 0.5;

    if (rotXDeg !== 0 || rotYDeg !== 0 || rotZDeg !== 0) {
        const m = makeEulerMatrix(rotXDeg, rotYDeg, rotZDeg);
        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            const dx = v[0] - rcx;
            const dy = v[1] - rcy;
            const dz = v[2] - rcz;
            v[0] = m[0] * dx + m[1] * dy + m[2] * dz;
            v[1] = m[3] * dx + m[4] * dy + m[5] * dz;
            v[2] = m[6] * dx + m[7] * dy + m[8] * dz;
        }
    }

    // 2. Compute rotated bounding box
    const rotBox = computeBBox(vertices);
    const [dx, dy, dz] = rotBox.size;

    // 3. Compute uniform scaleFactor
    let scaleFactor = 1.0;
    if (fitMode === 'target-z') {
        const targetZ = Number.isFinite(opts.targetZMm) && opts.targetZMm > 0 ? opts.targetZMm : 180;
        scaleFactor = dz > 1e-9 ? targetZ / dz : 1.0;
    } else if (fitMode === 'custom-scale') {
        scaleFactor = Number.isFinite(opts.customScale) && opts.customScale > 0 ? opts.customScale : 1.0;
    } else {
        // 'fit-bed'
        const availX = Math.max(1, bedX - 2 * marginMm);
        const availY = Math.max(1, bedY - 2 * marginMm);
        const availZ = Math.max(1, bedZ - marginMm);
        const sx = dx > 1e-9 ? availX / dx : Infinity;
        const sy = dy > 1e-9 ? availY / dy : Infinity;
        const sz = dz > 1e-9 ? availZ / dz : Infinity;
        const minS = Math.min(sx, sy, sz);
        scaleFactor = Number.isFinite(minS) ? minS : 1.0;
    }

    // 4. Center X=bedX/2, Y=bedY/2, seat Z=0
    const cx = (rotBox.min[0] + rotBox.max[0]) * 0.5;
    const cy = (rotBox.min[1] + rotBox.max[1]) * 0.5;
    const minZ = rotBox.min[2];
    const halfBedX = bedX * 0.5;
    const halfBedY = bedY * 0.5;

    for (let i = 0; i < vertices.length; i++) {
        const v = vertices[i];
        v[0] = (v[0] - cx) * scaleFactor + halfBedX;
        v[1] = (v[1] - cy) * scaleFactor + halfBedY;
        v[2] = (v[2] - minZ) * scaleFactor;
    }

    // 5. Final bbox & dimensional parameters
    const finalBox = computeBBox(vertices);
    const sizeMm = finalBox.size.map(round3);
    const minMm = finalBox.min.map(round3);
    const maxMm = finalBox.max.map(round3);

    const bedCheck = checkP1SBedFit(finalBox, { bedX, bedY, bedZ });
    const fitsBed = bedCheck.fitsBed;
    const overflowMm = bedCheck.overflowMm;

    const bedUtilizationPct = round1(
        Math.max(finalBox.size[0] / bedX, finalBox.size[1] / bedY, finalBox.size[2] / bedZ) * 100
    );

    const dp = dimParams || {};
    const voxelSizeMm = Number.isFinite(dp.voxelSize) ? round3(dp.voxelSize * scaleFactor) : null;
    const outerRMm = Number.isFinite(dp.outerR) ? round3(dp.outerR * scaleFactor) : null;
    const innerRMm = Number.isFinite(dp.innerR) ? round3(dp.innerR * scaleFactor) : null;
    const rodRadiusMm = Number.isFinite(dp.rodRadius) ? round3(dp.rodRadius * scaleFactor) : null;
    const tubeDiaMm = outerRMm !== null
        ? round3(outerRMm * 2)
        : (rodRadiusMm !== null ? round3(rodRadiusMm * 2) : null);

    let wallThicknessMm = null;
    if (outerRMm !== null && innerRMm !== null && innerRMm > 0 && outerRMm > innerRMm) {
        wallThicknessMm = round3(outerRMm - innerRMm);
    } else if (tubeDiaMm !== null) {
        wallThicknessMm = tubeDiaMm;
    }

    const thinWallWarning =
        (wallThicknessMm !== null && wallThicknessMm < P1S_SPEC.minWallMm) ||
        (tubeDiaMm !== null && tubeDiaMm < P1S_SPEC.minWallMm);

    const rescaledParams = {
        scaleFactor: +scaleFactor.toFixed(6),
        scaleToMm: +scaleFactor.toFixed(6),
        fitMode,
        marginMm,
        rotationDeg: { x: rotXDeg, y: rotYDeg, z: rotZDeg },
        voxelSizeMm,
        grid: dp.grid ? { nx: dp.grid.nx, ny: dp.grid.ny, nz: dp.grid.nz } : null,
        sides: Number.isFinite(dp.sides) ? dp.sides : null,
        outerRMm,
        innerRMm,
        rodRadiusMm,
        tubeDiaMm,
        wallThicknessMm,
        bboxMm: { min: minMm, max: maxMm, size: sizeMm },
        fitsBed,
        overflowMm,
        bedUtilizationPct,
        thinWallWarning
    };

    return { vertices, faces, triangles, rescaledParams };
}

// ---------------------------------------------------------------------------
// 3. buildBinarySTL & buildASCIISTL
// ---------------------------------------------------------------------------

/**
 * Convert { vertices, triangles } (or { vertices, faces }) in mm into Binary STL Uint8Array.
 * Pure JS (DataView + Uint8Array), zero Node Buffer dependency.
 */
export function buildBinarySTL(triMesh, headerText = 'TOPOGEN P1S Binary STL') {
    const { vertices, triangles } = extractTriMesh(triMesh);
    const nTris = triangles.length;
    const buf = new Uint8Array(84 + nTris * 50);
    const view = new DataView(buf.buffer);

    const hdr = String(headerText || '').slice(0, 79);
    for (let i = 0; i < hdr.length; i++) {
        buf[i] = hdr.charCodeAt(i) & 0x7f;
    }
    view.setUint32(80, nTris, true);

    for (let t = 0; t < nTris; t++) {
        const tri = triangles[t];
        const a = vertices[tri[0]];
        const b = vertices[tri[1]];
        const c = vertices[tri[2]];
        if (!a || !b || !c) continue;

        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        if (len > 1e-12) {
            nx /= len; ny /= len; nz /= len;
        }

        const off = 84 + t * 50;
        view.setFloat32(off, nx, true);
        view.setFloat32(off + 4, ny, true);
        view.setFloat32(off + 8, nz, true);
        view.setFloat32(off + 12, a[0], true);
        view.setFloat32(off + 16, a[1], true);
        view.setFloat32(off + 20, a[2], true);
        view.setFloat32(off + 24, b[0], true);
        view.setFloat32(off + 28, b[1], true);
        view.setFloat32(off + 32, b[2], true);
        view.setFloat32(off + 36, c[0], true);
        view.setFloat32(off + 40, c[1], true);
        view.setFloat32(off + 44, c[2], true);
        view.setUint16(off + 48, 0, true);
    }

    return buf;
}

/**
 * Convert { vertices, triangles } (or { vertices, faces }) in mm into ASCII STL string.
 */
export function buildASCIISTL(triMesh, solidName = 'topogen_p1s') {
    const { vertices, triangles } = extractTriMesh(triMesh);
    const lines = [`solid ${solidName}`];
    for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        const a = vertices[tri[0]];
        const b = vertices[tri[1]];
        const c = vertices[tri[2]];
        if (!a || !b || !c) continue;

        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        if (len > 1e-12) {
            nx /= len; ny /= len; nz /= len;
        }

        lines.push(`  facet normal ${nx.toFixed(6)} ${ny.toFixed(6)} ${nz.toFixed(6)}`);
        lines.push('    outer loop');
        lines.push(`      vertex ${a[0].toFixed(4)} ${a[1].toFixed(4)} ${a[2].toFixed(4)}`);
        lines.push(`      vertex ${b[0].toFixed(4)} ${b[1].toFixed(4)} ${b[2].toFixed(4)}`);
        lines.push(`      vertex ${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)}`);
        lines.push('    endloop');
        lines.push('  endfacet');
    }
    lines.push(`endsolid ${solidName}`);
    return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// 4. analyzePrintability
// ---------------------------------------------------------------------------

/**
 * Analytical printability analysis for a rescaled mm mesh (Z-up, seated at Z=0).
 * Overhang criterion: normal.z < -sin(overhangAngleDeg).
 */
export function analyzePrintability(triMesh, opts = {}) {
    const { vertices, triangles } = extractTriMesh(triMesh);
    const overhangAngleDeg = Number.isFinite(opts.overhangAngleDeg) ? opts.overhangAngleDeg : 45;
    const criticalAngleDeg = Number.isFinite(opts.criticalAngleDeg) ? opts.criticalAngleDeg : 60;
    const bedContactTolMm = Number.isFinite(opts.bedContactTolMm) ? opts.bedContactTolMm : 0.4;
    const bedX = Number.isFinite(opts.bedX) ? opts.bedX : P1S_SPEC.bedX;
    const bedY = Number.isFinite(opts.bedY) ? opts.bedY : P1S_SPEC.bedY;
    const bedZ = Number.isFinite(opts.bedZ) ? opts.bedZ : P1S_SPEC.bedZ;

    const sinOverhang = Math.sin(overhangAngleDeg * DEG2RAD);
    const sinCritical = Math.sin(criticalAngleDeg * DEG2RAD);

    const bbox = computeBBox(vertices);
    const minZ = bbox.min[2];
    const contactZThreshold = minZ + bedContactTolMm;

    let totalSurfaceAreaMm2 = 0;
    let overhangAreaMm2 = 0;
    let criticalOverhangAreaMm2 = 0;
    let bedContactAreaMm2 = 0;
    let signedVol6 = 0;
    let supportVolProxyMm3 = 0;
    let minEdgeMm = Infinity;

    const overhangFaceIndices = [];
    const criticalFaceIndices = [];
    const faceOverhangSeverity = new Float32Array(triangles.length);

    for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        const a = vertices[tri[0]];
        const b = vertices[tri[1]];
        const c = vertices[tri[2]];
        if (!a || !b || !c) continue;

        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        const e3x = c[0] - b[0], e3y = c[1] - b[1], e3z = c[2] - b[2];

        const l1 = Math.hypot(e1x, e1y, e1z);
        const l2 = Math.hypot(e2x, e2y, e2z);
        const l3 = Math.hypot(e3x, e3y, e3z);
        if (l1 > 1e-4 && l1 < minEdgeMm) minEdgeMm = l1;
        if (l2 > 1e-4 && l2 < minEdgeMm) minEdgeMm = l2;
        if (l3 > 1e-4 && l3 < minEdgeMm) minEdgeMm = l3;

        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        const area = 0.5 * len;
        if (len > 1e-12) {
            nx /= len; ny /= len; nz /= len;
        }

        totalSurfaceAreaMm2 += area;
        signedVol6 +=
            a[0] * (b[1] * c[2] - b[2] * c[1]) +
            a[1] * (b[2] * c[0] - b[0] * c[2]) +
            a[2] * (b[0] * c[1] - b[1] * c[0]);

        const avgZ = (a[2] + b[2] + c[2]) / 3;
        const allOnBed = a[2] <= contactZThreshold && b[2] <= contactZThreshold && c[2] <= contactZThreshold;

        if (allOnBed) {
            bedContactAreaMm2 += area;
        } else if (avgZ > contactZThreshold && nz < -sinOverhang) {
            overhangAreaMm2 += area;
            overhangFaceIndices.push(t);
            const horizProjArea = area * Math.abs(nz);
            supportVolProxyMm3 += horizProjArea * Math.max(0, avgZ - minZ) * 0.22;
            const sev = clamp((-nz - sinOverhang) / Math.max(1e-6, 1 - sinOverhang), 0, 1);
            faceOverhangSeverity[t] = sev;
            if (nz < -sinCritical) {
                criticalOverhangAreaMm2 += area;
                criticalFaceIndices.push(t);
            }
        }
    }

    let bedContactVertCount = 0;
    for (let i = 0; i < vertices.length; i++) {
        if (vertices[i][2] <= contactZThreshold) bedContactVertCount++;
    }

    // If mesh has thin bed touchpoints (edges/vertices near Z=0 without full flat triangles),
    // estimate a small contact footprint from bed vertices so curved bases are not scored identically to floating parts.
    if (bedContactAreaMm2 < 1e-3 && bedContactVertCount >= 3) {
        let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
        for (let i = 0; i < vertices.length; i++) {
            if (vertices[i][2] <= contactZThreshold) {
                const vx = vertices[i][0], vy = vertices[i][1];
                if (vx < bx0) bx0 = vx; if (vx > bx1) bx1 = vx;
                if (vy < by0) by0 = vy; if (vy > by1) by1 = vy;
            }
        }
        const spanArea = Math.max(0, (bx1 - bx0) * (by1 - by0));
        bedContactAreaMm2 = Math.min(spanArea * 0.08, bedContactVertCount * 1.2);
    }

    const volumeMm3 = Math.abs(signedVol6 / 6);
    const volumeCm3 = volumeMm3 / 1000;
    const overhangAreaPct = totalSurfaceAreaMm2 > 0 ? (overhangAreaMm2 / totalSurfaceAreaMm2) * 100 : 0;
    const criticalOverhangPct = totalSurfaceAreaMm2 > 0 ? (criticalOverhangAreaMm2 / totalSurfaceAreaMm2) * 100 : 0;

    const bedCheck = checkP1SBedFit(bbox, { bedX, bedY, bedZ });
    const fitsBed = bedCheck.fitsBed;

    const minFeatureMm = Number.isFinite(opts.wallThicknessMm)
        ? opts.wallThicknessMm
        : (Number.isFinite(minEdgeMm) ? minEdgeMm : 0);

    const thinWallWarning = minFeatureMm > 0 && minFeatureMm < P1S_SPEC.minWallMm;

    // Estimated support ratio proxy (%) based on support volume vs model volume
    const denomVol = Math.max(volumeMm3, totalSurfaceAreaMm2 * 1.2, 100);
    const estimatedSupportRatioPct = clamp((supportVolProxyMm3 / (denomVol + supportVolProxyMm3)) * 100, 0, 85);

    // Rough print-time proxy (minutes) for PLA on P1S (~14 mm^3/s effective avg incl. travels)
    const layerHeightMm = Number.isFinite(opts.layerHeightMm) ? opts.layerHeightMm : P1S_SPEC.defaultLayerHeightMm;
    const estLayers = Math.max(1, Math.ceil(bbox.size[2] / layerHeightMm));
    const estModelVolShellMm3 = Math.min(volumeMm3, totalSurfaceAreaMm2 * 0.9) + volumeMm3 * 0.15;
    const estPrintTimeMin = clamp((estModelVolShellMm3 + supportVolProxyMm3 * 0.6) / (10.5 * 60) + estLayers * 0.06, 5, 1440);

    const scoreDetail = scorePrintCandidate({
        fitsBed,
        supportPct: estimatedSupportRatioPct,
        overhangAreaPct,
        criticalOverhangPct,
        bedContactAreaMm2,
        footprintAreaMm2: Math.max(1, bbox.size[0] * bbox.size[1]),
        printTimeMin: estPrintTimeMin,
        thinWallWarning,
        wallLoops: opts.wallLoops ?? 2,
        brim: opts.brim ?? 'auto',
        supportType: opts.supportType ?? 'tree'
    });

    return {
        vertexCount: vertices.length,
        triangleCount: triangles.length,
        bboxMm: {
            min: bbox.min.map(round3),
            max: bbox.max.map(round3),
            size: bbox.size.map(round3)
        },
        fitsBed,
        totalSurfaceAreaMm2: round2(totalSurfaceAreaMm2),
        overhangAngleDeg,
        criticalAngleDeg,
        overhangFaceCount: overhangFaceIndices.length,
        criticalFaceCount: criticalFaceIndices.length,
        overhangFaceIndices,
        criticalFaceIndices,
        faceOverhangSeverity,
        overhangAreaMm2: round2(overhangAreaMm2),
        overhangAreaPct: round2(overhangAreaPct),
        criticalOverhangAreaMm2: round2(criticalOverhangAreaMm2),
        criticalOverhangPct: round2(criticalOverhangPct),
        bedContactAreaMm2: round2(bedContactAreaMm2),
        bedContactVertCount,
        volumeMm3: round2(volumeMm3),
        volumeCm3: round3(volumeCm3),
        minFeatureMm: round3(minFeatureMm),
        thinWallWarning,
        estimatedSupportRatioPct: round2(estimatedSupportRatioPct),
        estimatedPrintTimeMin: round1(estPrintTimeMin),
        printabilityScore: scoreDetail.score,
        scoreDetail
    };
}

// ---------------------------------------------------------------------------
// 5. sliceMeshLocal — Fast Z-bucketed pure-JS planar slicer
// ---------------------------------------------------------------------------

function intersectTriangleWithZ(a, b, c, z) {
    const da = a[2] - z;
    const db = b[2] - z;
    const dc = c[2] - z;

    const pts = [];
    const checkEdge = (p0, d0, p1, d1) => {
        if ((d0 > 0 && d1 <= 0) || (d0 <= 0 && d1 > 0)) {
            const denom = d0 - d1;
            if (Math.abs(denom) > 1e-12) {
                const t = d0 / denom;
                pts.push([p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])]);
            }
        }
    };
    checkEdge(a, da, b, db);
    checkEdge(b, db, c, dc);
    checkEdge(c, dc, a, da);
    if (pts.length === 2) {
        const dx = pts[1][0] - pts[0][0];
        const dy = pts[1][1] - pts[0][1];
        if (dx * dx + dy * dy > 1e-8) return pts;
    }
    return null;
}

/**
 * Chain unordered 2D segments into polylines using quantized spatial endpoint hashing.
 */
function chainSegmentsToPolylines(segs, snapMm = 0.05) {
    if (segs.length === 0) return [];
    const inv = 1 / snapMm;
    const keyOf = (p) => `${Math.round(p[0] * inv)},${Math.round(p[1] * inv)}`;

    const adj = new Map();
    for (let i = 0; i < segs.length; i++) {
        const [p0, p1] = segs[i];
        const k0 = keyOf(p0);
        const k1 = keyOf(p1);
        if (!adj.has(k0)) adj.set(k0, []);
        if (!adj.has(k1)) adj.set(k1, []);
        adj.get(k0).push({ idx: i, end: 0 });
        adj.get(k1).push({ idx: i, end: 1 });
    }

    const used = new Uint8Array(segs.length);
    const polylines = [];

    for (let i = 0; i < segs.length; i++) {
        if (used[i]) continue;
        used[i] = 1;
        const chain = [segs[i][0], segs[i][1]];

        // Extend forward
        for (let guard = 0; guard < segs.length; guard++) {
            const tip = chain[chain.length - 1];
            const list = adj.get(keyOf(tip));
            if (!list) break;
            let found = null;
            for (let j = 0; j < list.length; j++) {
                if (!used[list[j].idx]) {
                    found = list[j];
                    break;
                }
            }
            if (!found) break;
            used[found.idx] = 1;
            const seg = segs[found.idx];
            chain.push(found.end === 0 ? seg[1] : seg[0]);
        }

        // Extend backward
        for (let guard = 0; guard < segs.length; guard++) {
            const head = chain[0];
            const list = adj.get(keyOf(head));
            if (!list) break;
            let found = null;
            for (let j = 0; j < list.length; j++) {
                if (!used[list[j].idx]) {
                    found = list[j];
                    break;
                }
            }
            if (!found) break;
            used[found.idx] = 1;
            const seg = segs[found.idx];
            chain.unshift(found.end === 0 ? seg[1] : seg[0]);
        }

        polylines.push(chain);
    }

    return polylines;
}

/**
 * Generate simple 45/-45 deg scanline hatch infill clipped against layer 2D segments.
 */
function generateHatchInfill(segs, spacingMm, angleRad) {
    if (segs.length < 3 || spacingMm <= 0) return [];
    const ca = Math.cos(angleRad);
    const sa = Math.sin(angleRad);

    // Rotate segments into scanline frame (u = x*ca + y*sa, v = -x*sa + y*ca)
    let minV = Infinity, maxV = -Infinity;
    const rotSegs = new Array(segs.length);
    for (let i = 0; i < segs.length; i++) {
        const [p0, p1] = segs[i];
        const u0 = p0[0] * ca + p0[1] * sa;
        const v0 = -p0[0] * sa + p0[1] * ca;
        const u1 = p1[0] * ca + p1[1] * sa;
        const v1 = -p1[0] * sa + p1[1] * ca;
        if (v0 < minV) minV = v0;
        if (v0 > maxV) maxV = v0;
        if (v1 < minV) minV = v1;
        if (v1 > maxV) maxV = v1;
        rotSegs[i] = [u0, v0, u1, v1];
    }

    const out = [];
    const startV = Math.floor(minV / spacingMm) * spacingMm + spacingMm * 0.5;
    for (let v = startV; v < maxV; v += spacingMm) {
        const hits = [];
        for (let i = 0; i < rotSegs.length; i++) {
            const [u0, v0, u1, v1] = rotSegs[i];
            if ((v0 <= v && v1 > v) || (v1 <= v && v0 > v)) {
                const t = (v - v0) / (v1 - v0);
                hits.push(u0 + t * (u1 - u0));
            }
        }
        if (hits.length < 2) continue;
        hits.sort((a, b) => a - b);
        for (let k = 0; k + 1 < hits.length; k += 2) {
            const ua = hits[k];
            const ub = hits[k + 1];
            if (ub - ua < 0.6) continue;
            // Rotate back: x = u*ca - v*sa, y = u*sa + v*ca
            const x1 = round1(ua * ca - v * sa);
            const y1 = round1(ua * sa + v * ca);
            const x2 = round1(ub * ca - v * sa);
            const y2 = round1(ub * sa + v * ca);
            out.push([x1, y1, x2, y2]);
        }
    }
    return out;
}

/**
 * Fast pure-JS planar slicer for instant browser visualization.
 */
export function sliceMeshLocal(triMesh, opts = {}) {
    const { vertices, triangles } = extractTriMesh(triMesh);
    const layerHeightMm = clamp(Number(opts.layerHeightMm) || P1S_SPEC.defaultLayerHeightMm, 0.06, 2.0);
    const overhangAngleDeg = Number.isFinite(opts.overhangAngleDeg) ? opts.overhangAngleDeg : 45;
    const wallLoops = clamp(parseInt(opts.wallLoops, 10) || 2, 1, 8);
    const infillPct = clamp(Number.isFinite(opts.infillPct) ? opts.infillPct : 15, 0, 100);
    const supportType = opts.supportType || 'tree';
    const maxLayers = Number.isFinite(opts.maxLayers) ? opts.maxLayers : 1500;

    const bbox = computeBBox(vertices);
    const bedX = Number.isFinite(opts.bedX) ? opts.bedX : P1S_SPEC.bedX;
    const bedY = Number.isFinite(opts.bedY) ? opts.bedY : P1S_SPEC.bedY;
    const bedZ = Number.isFinite(opts.bedZ) ? opts.bedZ : P1S_SPEC.bedZ;
    const bboxMm = {
        min: bbox.min.map(round3),
        max: bbox.max.map(round3),
        size: bbox.size.map(round3)
    };
    const bedCheck = checkP1SBedFit(bbox, { bedX, bedY, bedZ });
    if (!bedCheck.fitsBed) {
        return {
            ok: false,
            error: 'OUT_OF_BED_BOUNDS',
            message: `Geometry exceeds Bambu Lab P1S bed (${bedCheck.bedMm.join('x')} mm). Only geometry that fits inside the bed can be sliced.`,
            overflowMm: bedCheck.overflowMm,
            layerHeightMm: round3(layerHeightMm),
            layerCount: 0,
            layers: [],
            summary: {
                fitsBed: false,
                overflowMm: bedCheck.overflowMm,
                layerCount: 0,
                layerHeightMm: round3(layerHeightMm),
                totalFilamentG: 0,
                modelFilamentG: 0,
                supportFilamentG: 0,
                supportPct: 0,
                estimatedTimeMin: 0,
                estimatedTimeStr: '0m 0s',
                overhangLayerCount: 0,
                supportColumnCount: 0,
                bboxMm
            }
        };
    }

    const minZ = Math.max(0, bbox.min[2]);
    const maxZ = Math.min(bedZ, bbox.max[2]);
    const heightMm = Math.max(0, maxZ - minZ);
    const rawCount = Math.max(1, Math.ceil(heightMm / layerHeightMm));
    const layerCount = Math.min(rawCount, maxLayers);
    const effectiveLayerH = heightMm > 1e-6 ? heightMm / layerCount : layerHeightMm;

    // Bucket triangles into layer index ranges for O(N_tris * avg_span) slicing
    const buckets = Array.from({ length: layerCount }, () => []);
    const sinOverhang = Math.sin(overhangAngleDeg * DEG2RAD);

    // Collect overhang support columns (quantized XY grid cells)
    const supportCellMm = supportType === 'tree' ? 6.0 : 4.5;
    const supportCells = new Map(); // "gx,gy" -> { x, y, maxZ }

    for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        const a = vertices[tri[0]];
        const b = vertices[tri[1]];
        const c = vertices[tri[2]];
        if (!a || !b || !c) continue;

        const zLo = Math.min(a[2], b[2], c[2]);
        const zHi = Math.max(a[2], b[2], c[2]);
        let i0 = Math.floor((zLo - minZ) / effectiveLayerH);
        let i1 = Math.floor((zHi - minZ) / effectiveLayerH);
        i0 = clamp(i0, 0, layerCount - 1);
        i1 = clamp(i1, 0, layerCount - 1);
        for (let k = i0; k <= i1; k++) {
            buckets[k].push(t);
        }

        // Track overhang support columns
        if (supportType !== 'none') {
            const avgZ = (a[2] + b[2] + c[2]) / 3;
            if (avgZ > minZ + 0.6) {
                const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
                const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
                const nx = e1y * e2z - e1z * e2y;
                const ny = e1z * e2x - e1x * e2z;
                const nz = e1x * e2y - e1y * e2x;
                const len = Math.hypot(nx, ny, nz);
                if (len > 1e-12 && (nz / len) < -sinOverhang) {
                    const cx = (a[0] + b[0] + c[0]) / 3;
                    const cy = (a[1] + b[1] + c[1]) / 3;
                    const gx = Math.round(cx / supportCellMm);
                    const gy = Math.round(cy / supportCellMm);
                    const key = `${gx},${gy}`;
                    const prev = supportCells.get(key);
                    if (!prev || avgZ > prev.maxZ) {
                        supportCells.set(key, { x: gx * supportCellMm, y: gy * supportCellMm, maxZ: avgZ });
                    }
                }
            }
        }
    }

    const supportList = Array.from(supportCells.values());
    const hatchSpacingMm = infillPct > 0 ? clamp(P1S_SPEC.extrusionWidthMm / (infillPct / 100), 1.4, 24) : 0;

    const layers = new Array(layerCount);
    let totalWallLenMm = 0;
    let totalInfillLenMm = 0;
    let totalSupportLenMm = 0;
    let overhangLayerCount = 0;

    const clampX = (v) => round1(clamp(v, 0, bedX));
    const clampY = (v) => round1(clamp(v, 0, bedY));

    for (let li = 0; li < layerCount; li++) {
        const z = round3(clamp(minZ + (li + 0.5) * effectiveLayerH, 0, bedZ));
        const triIndices = buckets[li];
        const segs2d = [];

        for (let j = 0; j < triIndices.length; j++) {
            const tri = triangles[triIndices[j]];
            const seg = intersectTriangleWithZ(vertices[tri[0]], vertices[tri[1]], vertices[tri[2]], z);
            if (seg) {
                segs2d.push([
                    [clamp(seg[0][0], 0, bedX), clamp(seg[0][1], 0, bedY)],
                    [clamp(seg[1][0], 0, bedX), clamp(seg[1][1], 0, bedY)]
                ]);
            }
        }

        const contours = chainSegmentsToPolylines(segs2d);

        // Flat outer_wall segments for unified WebGL rendering
        const outerWallFlat = [];
        for (let c = 0; c < contours.length; c++) {
            const poly = contours[c];
            for (let k = 0; k + 1 < poly.length; k++) {
                const x1 = clampX(poly[k][0]);
                const y1 = clampY(poly[k][1]);
                const x2 = clampX(poly[k + 1][0]);
                const y2 = clampY(poly[k + 1][1]);
                outerWallFlat.push(x1, y1, x2, y2);
                totalWallLenMm += Math.hypot(x2 - x1, y2 - y1);
            }
        }

        // Hatch infill preview segments
        const angleRad = (li % 2 === 0 ? 45 : -45) * DEG2RAD;
        const rawInfill = hatchSpacingMm > 0 ? generateHatchInfill(segs2d, hatchSpacingMm, angleRad) : [];
        const infillSegments = [];
        const infillFlat = [];
        for (let k = 0; k < rawInfill.length; k++) {
            const s = rawInfill[k];
            const x1 = clampX(s[0]), y1 = clampY(s[1]), x2 = clampX(s[2]), y2 = clampY(s[3]);
            infillSegments.push([x1, y1, x2, y2]);
            infillFlat.push(x1, y1, x2, y2);
            totalInfillLenMm += Math.hypot(x2 - x1, y2 - y1);
        }

        // Overhang support pillar preview segments (small cross/ring at each active support column)
        const supportSegments = [];
        const supportFlat = [];
        if (supportType !== 'none' && supportList.length > 0) {
            const halfR = supportType === 'tree' ? 1.4 : 1.8;
            for (let s = 0; s < supportList.length; s++) {
                const col = supportList[s];
                if (z < col.maxZ - effectiveLayerH * 0.5) {
                    // Slight tree taper near top
                    const r = supportType === 'tree'
                        ? halfR * (0.65 + 0.35 * (1 - z / Math.max(col.maxZ, 1)))
                        : halfR;
                    const x1 = clampX(col.x - r), y1 = clampY(col.y);
                    const x2 = clampX(col.x + r), y2 = clampY(col.y);
                    const x3 = clampX(col.x), y3 = clampY(col.y - r);
                    const x4 = clampX(col.x), y4 = clampY(col.y + r);
                    supportSegments.push([x1, y1, x2, y2], [x3, y3, x4, y4]);
                    supportFlat.push(x1, y1, x2, y2, x3, y3, x4, y4);
                    totalSupportLenMm += 4 * r;
                }
            }
            if (supportSegments.length > 0) overhangLayerCount++;
        }

        layers[li] = {
            index: li,
            z,
            layerHeight: round3(effectiveLayerH),
            contours,
            infillSegments,
            supportSegments,
            segments: {
                outer_wall: outerWallFlat,
                inner_wall: [],
                infill: infillFlat,
                support: supportFlat,
                support_interface: [],
                bridge: [],
                brim: [],
                travel: []
            }
        };
    }

    // Estimate filament mass (PLA 1.26 g/cm^3) and print time
    const lineAreaMm2 = P1S_SPEC.extrusionWidthMm * effectiveLayerH;
    const modelVolMm3 = (totalWallLenMm * wallLoops + totalInfillLenMm) * lineAreaMm2;
    const supportVolMm3 = totalSupportLenMm * lineAreaMm2 * 1.4;
    const plaDensityGPerMm3 = 1.26 / 1000;
    const modelFilamentG = round2(modelVolMm3 * plaDensityGPerMm3);
    const supportFilamentG = round2(supportVolMm3 * plaDensityGPerMm3);
    const totalFilamentG = round2(modelFilamentG + supportFilamentG);
    const supportPct = totalFilamentG > 0 ? round2((supportFilamentG / totalFilamentG) * 100) : 0;
    const estTimeMin = round1((totalWallLenMm * wallLoops + totalInfillLenMm + totalSupportLenMm) / (95 * 60) + layerCount * 0.04);

    return {
        ok: true,
        layerHeightMm: round3(effectiveLayerH),
        layerCount,
        layers,
        summary: {
            fitsBed: true,
            overflowMm: bedCheck.overflowMm,
            layerCount,
            layerHeightMm: round3(effectiveLayerH),
            totalFilamentG,
            modelFilamentG,
            supportFilamentG,
            supportPct,
            estimatedTimeMin: estTimeMin,
            estimatedTimeStr: formatDurationMin(estTimeMin),
            overhangLayerCount,
            supportColumnCount: supportList.length,
            bboxMm
        }
    };
}

// ---------------------------------------------------------------------------
// 6. parseBambuGcode — Real Bambu Studio plate_1.gcode parser
// ---------------------------------------------------------------------------

function mapGcodeFeatureToKey(rawName) {
    const s = String(rawName || '').trim().toLowerCase();
    if (!s || s === 'custom') return null;
    if (s.includes('support') && s.includes('interface')) return 'support_interface';
    if (s.includes('support')) return 'support';
    if (s.includes('bridge')) return 'bridge';
    if (s.includes('brim') || s.includes('skirt')) return 'brim';
    if (s.includes('outer wall') || s.includes('external perimeter') || s.includes('overhang wall')) return 'outer_wall';
    if (s.includes('inner wall') || s.includes('perimeter') || s.includes('gap infill')) return 'inner_wall';
    if (s.includes('infill') || s.includes('top surface') || s.includes('bottom surface') || s.includes('solid')) return 'infill';
    return 'infill';
}

function parseTimeStringToMinutes(str) {
    if (!str) return null;
    let totalSec = 0;
    let matched = false;
    const d = str.match(/(\d+)\s*d/i);
    const h = str.match(/(\d+)\s*h/i);
    const m = str.match(/(\d+)\s*m(?!s)/i);
    const s = str.match(/(\d+)\s*s/i);
    if (d) { totalSec += parseInt(d[1], 10) * 86400; matched = true; }
    if (h) { totalSec += parseInt(h[1], 10) * 3600; matched = true; }
    if (m) { totalSec += parseInt(m[1], 10) * 60; matched = true; }
    if (s) { totalSec += parseInt(s[1], 10); matched = true; }
    return matched ? round2(totalSec / 60) : null;
}

function formatDurationMin(mins) {
    const totalSec = Math.max(0, Math.round((Number(mins) || 0) * 60));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
}

function createEmptyLayerSegments() {
    return {
        outer_wall: [],
        inner_wall: [],
        infill: [],
        support: [],
        support_interface: [],
        bridge: [],
        brim: [],
        travel: []
    };
}

function parseGcodeWord(line, letter) {
    const len = line.length;
    for (let i = 0; i < len; i++) {
        const ch = line[i];
        if (ch === ';') return NaN;
        if (ch === letter && (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')) {
            return parseFloat(line.slice(i + 1));
        }
    }
    return NaN;
}

const GCODE_FEATURE_PRIORITY = Object.freeze([
    'outer_wall',
    'support',
    'support_interface',
    'bridge',
    'brim',
    'inner_wall',
    'infill',
    'travel'
]);

function applyLayerSegmentBudget(layer, maxSegmentsPerLayer) {
    const segs = layer.segments;
    let count = 0;
    for (let i = 0; i < GCODE_FEATURE_PRIORITY.length; i++) {
        count += segs[GCODE_FEATURE_PRIORITY[i]].length >> 2;
    }
    if (count <= maxSegmentsPerLayer) return count;

    let remaining = maxSegmentsPerLayer;
    let kept = 0;
    for (let i = 0; i < GCODE_FEATURE_PRIORITY.length; i++) {
        const key = GCODE_FEATURE_PRIORITY[i];
        const arr = segs[key];
        const segCount = arr.length >> 2;
        if (segCount === 0) continue;
        if (remaining <= 0) {
            segs[key] = [];
            continue;
        }
        if (segCount <= remaining) {
            remaining -= segCount;
            kept += segCount;
        } else {
            // Uniformly stride across the full feature array so every island on the bed stays visible
            const out = new Array(remaining * 4);
            for (let k = 0; k < remaining; k++) {
                const src = Math.floor((k * segCount) / remaining) * 4;
                const dst = k * 4;
                out[dst] = arr[src];
                out[dst + 1] = arr[src + 1];
                out[dst + 2] = arr[src + 2];
                out[dst + 3] = arr[src + 3];
            }
            segs[key] = out;
            kept += remaining;
            remaining = 0;
        }
    }
    return kept;
}

/**
 * Parse real Bambu Studio plate_1.gcode (and Prusa/Orca G-code) into compact per-layer
 * feature segments + summary statistics.
 * Supports G0/G1 linear moves and G2/G3 arc moves (Bambu Studio arc fitting).
 * Applies per-layer budgeting by feature priority with uniform striding so no island is truncated.
 */
export function parseBambuGcode(gcodeText, opts = {}) {
    const includeTravel = opts.includeTravel !== undefined ? Boolean(opts.includeTravel) : false;
    const quantizeMm = Number.isFinite(opts.quantizeMm) && opts.quantizeMm > 0 ? opts.quantizeMm : 0.1;
    const invQ = 1 / quantizeMm;
    const q = (v) => Math.round(v * invQ) / invQ;
    const maxSegmentsPerLayer = Number.isFinite(opts.maxSegmentsPerLayer) && opts.maxSegmentsPerLayer > 0
        ? Math.floor(opts.maxSegmentsPerLayer)
        : 12000;
    const minSegLen = opts.minSegmentLengthMm !== undefined
        ? Math.max(0, Number(opts.minSegmentLengthMm) || 0)
        : 0.25;
    const minSegLenSq = minSegLen > 0 ? minSegLen * minSegLen : 0;
    const arcStepMm = Number.isFinite(opts.arcStepMm) && opts.arcStepMm > 0.1 ? opts.arcStepMm : 1.2;

    const lines = String(gcodeText || '').split(/\r?\n/);

    let headerLayerCount = 0;
    let density = 1.26;
    let diameter = 1.75;
    let headerTotalG = null;
    let headerTotalTimeStr = null;
    let headerModelTimeStr = null;

    let relativeE = true; // Bambu Studio default M83
    let relativeXYZ = false;
    let curX = 0, curY = 0, curZ = 0, curE = 0;
    let rawFeature = 'Custom';
    let featureKey = null;

    const featureMm = Object.create(null);
    const layers = [];
    let currentLayer = null;
    let totalSegments = 0;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    const ensureLayer = (zHint) => {
        if (!currentLayer) {
            currentLayer = {
                index: layers.length,
                z: round3(Number.isFinite(zHint) ? zHint : curZ),
                layerHeight: P1S_SPEC.defaultLayerHeightMm,
                segments: createEmptyLayerSegments()
            };
            layers.push(currentLayer);
        }
        return currentLayer;
    };

    const pushSeg = (bucketKey, x1, y1, x2, y2, trackBounds) => {
        if (!currentLayer || !bucketKey) return;
        const qx1 = q(x1), qy1 = q(y1), qx2 = q(x2), qy2 = q(y2);
        if (qx1 === qx2 && qy1 === qy2) return;
        if (minSegLenSq > 0) {
            const dx = qx2 - qx1, dy = qy2 - qy1;
            if (dx * dx + dy * dy < minSegLenSq) return;
        }
        currentLayer.segments[bucketKey].push(qx1, qy1, qx2, qy2);
        if (trackBounds) {
            if (qx1 < minX) minX = qx1; if (qx1 > maxX) maxX = qx1;
            if (qx2 < minX) minX = qx2; if (qx2 > maxX) maxX = qx2;
            if (qy1 < minY) minY = qy1; if (qy1 > maxY) maxY = qy1;
            if (qy2 < minY) minY = qy2; if (qy2 > maxY) maxY = qy2;
            if (currentLayer.z < minZ) minZ = currentLayer.z;
            if (currentLayer.z > maxZ) maxZ = currentLayer.z;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (line[0] === ';') {
            if (line.startsWith('; CHANGE_LAYER') || line.startsWith(';LAYER_CHANGE')) {
                if (currentLayer) {
                    totalSegments += applyLayerSegmentBudget(currentLayer, maxSegmentsPerLayer);
                }
                currentLayer = {
                    index: layers.length,
                    z: round3(curZ),
                    layerHeight: P1S_SPEC.defaultLayerHeightMm,
                    segments: createEmptyLayerSegments()
                };
                layers.push(currentLayer);
            } else if (line.startsWith('; Z_HEIGHT:') || line.startsWith(';Z:')) {
                const v = parseFloat(line.slice(line.indexOf(':') + 1));
                if (Number.isFinite(v)) {
                    curZ = v;
                    if (currentLayer) currentLayer.z = round3(v);
                }
            } else if (line.startsWith('; LAYER_HEIGHT:')) {
                const v = parseFloat(line.slice(line.indexOf(':') + 1));
                if (Number.isFinite(v) && currentLayer) currentLayer.layerHeight = round3(v);
            } else if (line.startsWith('; FEATURE:')) {
                rawFeature = line.slice('; FEATURE:'.length).trim();
                featureKey = mapGcodeFeatureToKey(rawFeature);
            } else if (line.startsWith(';TYPE:')) {
                rawFeature = line.slice(';TYPE:'.length).trim();
                featureKey = mapGcodeFeatureToKey(rawFeature);
            } else if (line.startsWith('; total layer number:')) {
                headerLayerCount = parseInt(line.slice(line.indexOf(':') + 1).trim(), 10) || 0;
            } else if (line.startsWith('; filament_density:')) {
                const v = parseFloat(line.slice(line.indexOf(':') + 1).trim());
                if (Number.isFinite(v) && v > 0) density = v;
            } else if (line.startsWith('; filament_diameter:')) {
                const v = parseFloat(line.slice(line.indexOf(':') + 1).trim());
                if (Number.isFinite(v) && v > 0) diameter = v;
            } else if (line.startsWith('; total filament weight [g]')) {
                const v = parseFloat(line.slice(line.indexOf(':') + 1).trim());
                if (Number.isFinite(v)) headerTotalG = v;
            } else if (line.startsWith('; model printing time:')) {
                const m1 = line.match(/model printing time:\s*([^;]+)/);
                const m2 = line.match(/total estimated time:\s*(.+)$/);
                if (m1) headerModelTimeStr = m1[1].trim();
                if (m2) headerTotalTimeStr = m2[1].trim();
            } else if (line.startsWith('; estimated printing time')) {
                const m = line.match(/=\s*(.+)$/);
                if (m && !headerTotalTimeStr) headerTotalTimeStr = m[1].trim();
            }
            continue;
        }

        const c0 = line[0];
        if (c0 === 'M') {
            if (line.startsWith('M83')) relativeE = true;
            else if (line.startsWith('M82')) relativeE = false;
            continue;
        }

        if (c0 !== 'G') continue;
        const c1 = line[1];
        const c2 = line[2];

        if (c1 === '9' && c2 === '0') { relativeXYZ = false; continue; }
        if (c1 === '9' && c2 === '1') { relativeXYZ = true; continue; }
        if (c1 === '9' && c2 === '2') {
            const ev = parseGcodeWord(line, 'E');
            if (Number.isFinite(ev)) curE = ev;
            continue;
        }

        const isLinear = (c1 === '0' || c1 === '1') && (c2 === ' ' || c2 === '\t');
        const isArc = (c1 === '2' || c1 === '3') && (c2 === ' ' || c2 === '\t');
        if (!isLinear && !isArc) continue;

        const xVal = parseGcodeWord(line, 'X');
        const yVal = parseGcodeWord(line, 'Y');
        const zVal = parseGcodeWord(line, 'Z');
        const eVal = parseGcodeWord(line, 'E');

        const nx = Number.isFinite(xVal) ? (relativeXYZ ? curX + xVal : xVal) : curX;
        const ny = Number.isFinite(yVal) ? (relativeXYZ ? curY + yVal : yVal) : curY;
        const nz = Number.isFinite(zVal) ? (relativeXYZ ? curZ + zVal : zVal) : curZ;

        let de = 0;
        if (Number.isFinite(eVal)) {
            if (relativeE) {
                de = eVal;
            } else {
                de = eVal - curE;
                curE = eVal;
            }
            featureMm[rawFeature] = (featureMm[rawFeature] || 0) + de;
        }

        const movedXY = (nx !== curX || ny !== curY);
        if (movedXY && currentLayer) {
            if (de > 0) {
                const targetKey = featureKey || 'infill';
                if (isLinear) {
                    pushSeg(targetKey, curX, curY, nx, ny, true);
                } else {
                    // G2 (CW) / G3 (CCW) arc interpolation
                    const iVal = parseGcodeWord(line, 'I');
                    const jVal = parseGcodeWord(line, 'J');
                    if (Number.isFinite(iVal) || Number.isFinite(jVal)) {
                        const cx = curX + (Number.isFinite(iVal) ? iVal : 0);
                        const cy = curY + (Number.isFinite(jVal) ? jVal : 0);
                        const r = Math.hypot(curX - cx, curY - cy);
                        const a0 = Math.atan2(curY - cy, curX - cx);
                        const a1 = Math.atan2(ny - cy, nx - cx);
                        let da = a1 - a0;
                        const cw = (c1 === '2');
                        if (cw) {
                            if (da >= 0) da -= Math.PI * 2;
                        } else {
                            if (da <= 0) da += Math.PI * 2;
                        }
                        const arcLen = Math.abs(da) * r;
                        const steps = clamp(Math.ceil(arcLen / arcStepMm), 2, 24);
                        let px = curX, py = curY;
                        for (let s = 1; s <= steps; s++) {
                            const ang = a0 + (da * s) / steps;
                            const tx = s === steps ? nx : cx + Math.cos(ang) * r;
                            const ty = s === steps ? ny : cy + Math.sin(ang) * r;
                            pushSeg(targetKey, px, py, tx, ty, true);
                            px = tx; py = ty;
                        }
                    } else {
                        pushSeg(targetKey, curX, curY, nx, ny, true);
                    }
                }
            } else if (includeTravel && featureKey !== null) {
                pushSeg('travel', curX, curY, nx, ny, false);
            }
        } else if (movedXY && !currentLayer && de > 0 && featureKey !== null) {
            // Fallback for G-code without explicit CHANGE_LAYER markers
            ensureLayer(nz);
            pushSeg(featureKey, curX, curY, nx, ny, true);
        }

        curX = nx;
        curY = ny;
        curZ = nz;
    }

    if (currentLayer) {
        totalSegments += applyLayerSegmentBudget(currentLayer, maxSegmentsPerLayer);
    }

    // Per-feature filament mass
    const areaMm2 = Math.PI * (diameter * 0.5) * (diameter * 0.5);
    const mmToGrams = (mm) => (Math.max(0, mm) * areaMm2 * density) / 1000;
    const featureFilamentG = {};
    let computedTotalG = 0;
    let supportFilamentG = 0;
    let overhangWallG = 0;
    let bridgeG = 0;

    for (const [feat, mm] of Object.entries(featureMm)) {
        const g = mmToGrams(mm);
        computedTotalG += g;
        if (g > 0.0005) featureFilamentG[feat] = round3(g);
        const fl = feat.toLowerCase();
        if (fl.includes('support')) supportFilamentG += g;
        if (fl.includes('overhang')) overhangWallG += g;
        if (fl.includes('bridge')) bridgeG += g;
    }

    const totalFilamentG = round3(headerTotalG !== null ? headerTotalG : computedTotalG);
    const supportG = round3(supportFilamentG);
    const modelFilamentG = round3(Math.max(0, totalFilamentG - supportG));
    const supportPct = totalFilamentG > 0 ? round2((supportG / totalFilamentG) * 100) : 0;

    const estimatedTimeMin = parseTimeStringToMinutes(headerTotalTimeStr);
    const modelTimeMin = parseTimeStringToMinutes(headerModelTimeStr);

    const bboxMm = Number.isFinite(minX)
        ? {
            min: [round2(minX), round2(minY), round2(minZ)],
            max: [round2(maxX), round2(maxY), round2(maxZ)],
            size: [round2(maxX - minX), round2(maxY - minY), round2(maxZ - minZ)]
        }
        : { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };

    return {
        layers,
        summary: {
            layerCount: headerLayerCount || layers.length,
            parsedLayerCount: layers.length,
            totalFilamentG,
            modelFilamentG,
            supportFilamentG: supportG,
            supportPct,
            overhangWallG: round3(overhangWallG),
            bridgeG: round3(bridgeG),
            estimatedTimeMin,
            estimatedTimeStr: headerTotalTimeStr || (estimatedTimeMin !== null ? formatDurationMin(estimatedTimeMin) : null),
            modelTimeMin,
            modelTimeStr: headerModelTimeStr || (modelTimeMin !== null ? formatDurationMin(modelTimeMin) : null),
            filamentDensity: density,
            filamentDiameter: diameter,
            featureFilamentG,
            totalSegments,
            bboxMm
        }
    };
}

// ---------------------------------------------------------------------------
// 7. scorePrintCandidate & generateOptimizationCandidates
// ---------------------------------------------------------------------------

/**
 * Transparent 0..100 printability score balancing:
 *  - Bed fit (20 pts, hard cap <= 15 if overflow)
 *  - Low support ratio (25 pts)
 *  - Low overhang % & critical overhang % (20 pts)
 *  - Bed contact area & adhesion (15 pts)
 *  - Print time efficiency (10 pts)
 *  - Wall/feature safety (10 pts)
 */
export function scorePrintCandidate(metrics = {}) {
    const fitsBed = metrics.fitsBed !== false;
    const supportPct = Number.isFinite(metrics.supportPct)
        ? metrics.supportPct
        : (Number.isFinite(metrics.estimatedSupportRatioPct) ? metrics.estimatedSupportRatioPct : 0);
    const overhangPct = Number.isFinite(metrics.overhangAreaPct) ? metrics.overhangAreaPct : 0;
    const criticalPct = Number.isFinite(metrics.criticalOverhangPct) ? metrics.criticalOverhangPct : 0;
    const bedContactMm2 = Number.isFinite(metrics.bedContactAreaMm2) ? metrics.bedContactAreaMm2 : 0;
    const footprintMm2 = Number.isFinite(metrics.footprintAreaMm2) && metrics.footprintAreaMm2 > 0
        ? metrics.footprintAreaMm2
        : 4000;
    const printTimeMin = Number.isFinite(metrics.printTimeMin) ? metrics.printTimeMin : 180;
    const thinWallWarning = Boolean(metrics.thinWallWarning);
    const wallLoops = Number.isFinite(metrics.wallLoops) ? metrics.wallLoops : 2;
    const brim = metrics.brim || 'auto';
    const supportType = metrics.supportType || metrics.support || 'tree';

    const notes = [];

    // 1. Bed Fit (0..20)
    const bedFitPts = fitsBed ? 20 : 0;
    if (!fitsBed) notes.push('Exceeds P1S 256x256x256 mm build volume');

    // 2. Support Ratio (0..25)
    // Also penalize unsupported steep overhangs if supportType === 'none' and criticalPct > 4%
    let supportPts = 25 * clamp(1 - supportPct / 50, 0, 1);
    if (supportType === 'none' && criticalPct > 4) {
        const penalty = Math.min(18, (criticalPct - 4) * 1.4);
        supportPts = Math.max(0, supportPts - penalty);
        notes.push(`Unsupported critical overhangs (${round1(criticalPct)}%)`);
    }

    // 3. Overhang Risk (0..20)
    const overhangPenalty = overhangPct * 0.45 + criticalPct * 0.85;
    const overhangPts = clamp(20 - overhangPenalty, 0, 20);
    if (criticalPct > 8) notes.push(`High critical overhang area (${round1(criticalPct)}%)`);

    // 4. Bed Contact / Adhesion (0..15)
    const contactRatio = bedContactMm2 / Math.max(100, footprintMm2);
    let bedContactPts = clamp(Math.sqrt(clamp(contactRatio * 4.5, 0, 1)) * 12, 0, 12);
    if (bedContactMm2 >= 400) bedContactPts = Math.max(bedContactPts, 10);
    else if (bedContactMm2 >= 120) bedContactPts = Math.max(bedContactPts, 7);
    if (brim === 'outer' || brim === 'auto') bedContactPts = Math.min(15, bedContactPts + 3);
    if (bedContactMm2 < 30 && brim === 'none') notes.push('Low bed contact without brim');

    // 5. Print Time Efficiency (0..10)
    const printTimePts = clamp(10 - Math.max(0, printTimeMin - 90) / 75, 1.5, 10);

    // 6. Wall Safety (0..10)
    let wallSafetyPts = thinWallWarning ? 3 : 9;
    if (wallLoops >= 3) wallSafetyPts = Math.min(10, wallSafetyPts + 1);
    if (thinWallWarning) notes.push(`Thin wall < ${P1S_SPEC.minWallMm} mm minimum`);

    let rawScore = bedFitPts + supportPts + overhangPts + bedContactPts + printTimePts + wallSafetyPts;
    if (!fitsBed) rawScore = Math.min(rawScore, 15);
    const score = round1(clamp(rawScore, 0, 100));

    const grade = score >= 85 ? 'A' : (score >= 72 ? 'B' : (score >= 58 ? 'C' : (score >= 42 ? 'D' : 'F')));

    return {
        score,
        grade,
        breakdown: {
            bedFit: round1(bedFitPts),
            support: round1(supportPts),
            overhang: round1(overhangPts),
            bedContact: round1(bedContactPts),
            printTime: round1(printTimePts),
            wallSafety: round1(wallSafetyPts)
        },
        notes
    };
}

/**
 * Find an automatic flat-base rotation by clustering face normals weighted by area
 * and computing Euler angles (rotX, rotY) that align the dominant planar normal to -Z.
 */
function findOptimalFlatBaseRotation(meshSnapshot) {
    const { vertices, triangles } = cloneAndTriangulateSnapshot(meshSnapshot);
    if (triangles.length === 0) return { x: 0, y: 0, z: 0 };

    // Bin unit normals on an icosahedral-like coarse grid (step 0.25)
    const bins = new Map();
    for (let t = 0; t < triangles.length; t++) {
        const tri = triangles[t];
        const a = vertices[tri[0]], b = vertices[tri[1]], c = vertices[tri[2]];
        if (!a || !b || !c) continue;
        const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
        const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
        let nx = e1y * e2z - e1z * e2y;
        let ny = e1z * e2x - e1x * e2z;
        let nz = e1x * e2y - e1y * e2x;
        const len = Math.hypot(nx, ny, nz);
        if (len < 1e-12) continue;
        const area = 0.5 * len;
        nx /= len; ny /= len; nz /= len;
        const key = `${Math.round(nx * 4)},${Math.round(ny * 4)},${Math.round(nz * 4)}`;
        let bObj = bins.get(key);
        if (!bObj) {
            bObj = { area: 0, nx: 0, ny: 0, nz: 0 };
            bins.set(key, bObj);
        }
        bObj.area += area;
        bObj.nx += nx * area;
        bObj.ny += ny * area;
        bObj.nz += nz * area;
    }

    let best = null;
    for (const bObj of bins.values()) {
        if (!best || bObj.area > best.area) best = bObj;
    }
    if (!best || best.area < 1e-6) return { x: 0, y: 0, z: 0 };

    const len = Math.hypot(best.nx, best.ny, best.nz);
    const nx = best.nx / len, ny = best.ny / len, nz = best.nz / len;

    // We want R_y(ry) * R_x(rx) * [nx, ny, nz]^T = [0, 0, -1]^T
    // R_x(rx) zeros out y component: ny*cos(rx) - nz*sin(rx) = 0 => rx = atan2(ny, nz)
    // Wait: after Rx, z' = ny*sin(rx) + nz*cos(rx) = hypot(ny, nz).
    // If we want z' negative, use rx = atan2(-ny, -nz).
    const rxRad = Math.atan2(-ny, -nz);
    const zPrime = ny * Math.sin(rxRad) + nz * Math.cos(rxRad); // <= 0
    // R_y(ry) * [nx, 0, zPrime] -> x'' = nx*cos(ry) + zPrime*sin(ry) = 0 => ry = atan2(-nx, zPrime)
    const ryRad = Math.atan2(-nx, zPrime);

    const snap5 = (deg) => {
        const norm = ((deg + 180) % 360 + 360) % 360 - 180;
        return Math.round(norm / 5) * 5;
    };

    return {
        x: snap5(rxRad / DEG2RAD),
        y: snap5(ryRad / DEG2RAD),
        z: 0
    };
}

/**
 * Generates and ranks a curated set of orientation + slicer/support optimization candidates.
 * Pure JS, never mutates meshSnapshot or dimParams.
 */
export function generateOptimizationCandidates(meshSnapshot, dimParams = {}, baseOpts = {}) {
    const baseFit = {
        fitMode: baseOpts.fitMode || 'fit-bed',
        targetZMm: baseOpts.targetZMm,
        customScale: baseOpts.customScale,
        marginMm: Number.isFinite(baseOpts.marginMm) ? baseOpts.marginMm : P1S_SPEC.safeMarginMm
    };
    const baseRot = {
        x: Number(baseOpts.rotXDeg) || 0,
        y: Number(baseOpts.rotYDeg) || 0,
        z: Number(baseOpts.rotZDeg) || 0
    };
    const baseSlicer = {
        support: baseOpts.support || baseOpts.supportType || 'tree',
        supportAngle: Number.isFinite(baseOpts.supportAngle) ? baseOpts.supportAngle : 30,
        layerHeightMm: Number.isFinite(baseOpts.layerHeightMm) ? baseOpts.layerHeightMm : 0.20,
        wallLoops: Number.isFinite(baseOpts.wallLoops) ? baseOpts.wallLoops : 2,
        infillPct: Number.isFinite(baseOpts.infillPct) ? baseOpts.infillPct : 15,
        brim: baseOpts.brim || 'auto'
    };

    const flatRot = findOptimalFlatBaseRotation(meshSnapshot);

    const orientations = [
        { id: 'upright', label: 'Upright (0,0,0)', rot: { x: 0, y: 0, z: 0 } },
        { id: 'rot_x_pos90', label: 'Tilt +90° X', rot: { x: 90, y: 0, z: 0 } },
        { id: 'rot_x_neg90', label: 'Tilt -90° X', rot: { x: -90, y: 0, z: 0 } },
        { id: 'rot_y_pos90', label: 'Tilt +90° Y', rot: { x: 0, y: 90, z: 0 } },
        { id: 'rot_x_180', label: 'Inverted 180° X', rot: { x: 180, y: 0, z: 0 } },
        { id: 'flat_base', label: `Auto Flat Base (${flatRot.x}°,${flatRot.y}°)`, rot: flatRot }
    ];

    // Deduplicate orientations by (x,y,z)
    const seenRot = new Set();
    const uniqueOrients = [];
    for (const o of orientations) {
        const k = `${o.rot.x},${o.rot.y},${o.rot.z}`;
        if (!seenRot.has(k)) {
            seenRot.add(k);
            uniqueOrients.push(o);
        }
    }

    const candidates = [];
    const evalCandidate = (id, label, rot, slicerOpts, isBaseline = false) => {
        const rescaled = rescaleGeometryForP1S(meshSnapshot, dimParams, {
            ...baseFit,
            rotXDeg: rot.x,
            rotYDeg: rot.y,
            rotZDeg: rot.z
        });
        const analysis = analyzePrintability(rescaled, {
            overhangAngleDeg: 90 - slicerOpts.supportAngle,
            criticalAngleDeg: 60,
            layerHeightMm: slicerOpts.layerHeightMm,
            wallLoops: slicerOpts.wallLoops,
            wallThicknessMm: rescaled.rescaledParams.wallThicknessMm,
            brim: slicerOpts.brim,
            supportType: slicerOpts.support
        });

        // Adjust support proxy slightly for tree vs normal vs none
        let adjSupportPct = analysis.estimatedSupportRatioPct;
        if (slicerOpts.support === 'none') adjSupportPct = 0;
        else if (slicerOpts.support === 'normal') adjSupportPct = round2(adjSupportPct * 1.18);
        else if (slicerOpts.support === 'tree') adjSupportPct = round2(adjSupportPct * 0.92);

        // Layer height affects print time inversely
        const timeScale = 0.20 / slicerOpts.layerHeightMm;
        const estTimeMin = round1(analysis.estimatedPrintTimeMin * timeScale);

        const scoreDetail = scorePrintCandidate({
            fitsBed: rescaled.rescaledParams.fitsBed,
            supportPct: adjSupportPct,
            overhangAreaPct: analysis.overhangAreaPct,
            criticalOverhangPct: analysis.criticalOverhangPct,
            bedContactAreaMm2: analysis.bedContactAreaMm2,
            footprintAreaMm2: Math.max(1, rescaled.rescaledParams.bboxMm.size[0] * rescaled.rescaledParams.bboxMm.size[1]),
            printTimeMin: estTimeMin,
            thinWallWarning: rescaled.rescaledParams.thinWallWarning,
            wallLoops: slicerOpts.wallLoops,
            brim: slicerOpts.brim,
            supportType: slicerOpts.support
        });

        return {
            id,
            label,
            isBaseline,
            fitsBed: rescaled.rescaledParams.fitsBed,
            overflowMm: rescaled.rescaledParams.overflowMm,
            orientationDeg: { x: rot.x, y: rot.y, z: rot.z },
            slicerOpts: { ...slicerOpts },
            rescaledParams: rescaled.rescaledParams,
            analysis: {
                overhangAreaPct: analysis.overhangAreaPct,
                criticalOverhangPct: analysis.criticalOverhangPct,
                bedContactAreaMm2: analysis.bedContactAreaMm2,
                estimatedSupportRatioPct: adjSupportPct,
                estimatedPrintTimeMin: estTimeMin,
                volumeCm3: analysis.volumeCm3,
                fitsBed: rescaled.rescaledParams.fitsBed,
                overflowMm: rescaled.rescaledParams.overflowMm,
                thinWallWarning: analysis.thinWallWarning
            },
            score: scoreDetail.score,
            grade: scoreDetail.grade,
            scoreDetail
        };
    };

    // 1. Evaluate Baseline first
    const baseline = evalCandidate('baseline', 'Baseline', baseRot, baseSlicer, true);
    candidates.push(baseline);

    // 2. Evaluate all unique orientations with default tree(30) recipe
    const orientResults = [];
    for (const o of uniqueOrients) {
        const sameAsBase =
            o.rot.x === baseRot.x && o.rot.y === baseRot.y && o.rot.z === baseRot.z &&
            baseSlicer.support === 'tree' && baseSlicer.supportAngle === 30 &&
            baseSlicer.layerHeightMm === 0.20 && baseSlicer.wallLoops === 2 && baseSlicer.brim === 'auto';
        if (sameAsBase) {
            orientResults.push(baseline);
            continue;
        }
        const cand = evalCandidate(
            `${o.id}_tree30`,
            `${o.label} · Tree 30°`,
            o.rot,
            { support: 'tree', supportAngle: 30, layerHeightMm: 0.20, wallLoops: 2, infillPct: baseSlicer.infillPct, brim: 'auto' },
            false
        );
        candidates.push(cand);
        orientResults.push(cand);
    }

    // 3. Generate curated recipe variations on top 2 bed-fitting orientations
    orientResults.sort((a, b) => (b.fitsBed ? 1 : 0) - (a.fitsBed ? 1 : 0) || b.score - a.score);
    const topOrients = orientResults.filter(c => c.fitsBed).slice(0, 2);

    const recipes = [
        { tag: 'tree25_opt', label: 'Tree 25° · 0.16mm · 3W', support: 'tree', supportAngle: 25, layerHeightMm: 0.16, wallLoops: 3, brim: 'outer' },
        { tag: 'tree40_fast', label: 'Tree 40° · 0.20mm · 2W', support: 'tree', supportAngle: 40, layerHeightMm: 0.20, wallLoops: 2, brim: 'auto' },
        { tag: 'normal30', label: 'Normal 30° · 0.20mm · 3W', support: 'normal', supportAngle: 30, layerHeightMm: 0.20, wallLoops: 3, brim: 'outer' },
        { tag: 'nosup_brim', label: 'No Support · 0.20mm · Outer Brim', support: 'none', supportAngle: 30, layerHeightMm: 0.20, wallLoops: 2, brim: 'outer' }
    ];

    const seenKeys = new Set(candidates.map(c =>
        `${c.orientationDeg.x},${c.orientationDeg.y},${c.orientationDeg.z}|${c.slicerOpts.support}|${c.slicerOpts.supportAngle}|${c.slicerOpts.layerHeightMm}|${c.slicerOpts.wallLoops}|${c.slicerOpts.brim}`
    ));

    for (const top of topOrients) {
        const baseOrientTag = top.id.replace(/_tree30$/, '');
        for (const r of recipes) {
            const key = `${top.orientationDeg.x},${top.orientationDeg.y},${top.orientationDeg.z}|${r.support}|${r.supportAngle}|${r.layerHeightMm}|${r.wallLoops}|${r.brim}`;
            if (seenKeys.has(key)) continue;
            seenKeys.add(key);
            candidates.push(evalCandidate(
                `${baseOrientTag}_${r.tag}`,
                `${top.label.split(' · ')[0]} · ${r.label}`,
                top.orientationDeg,
                {
                    support: r.support,
                    supportAngle: r.supportAngle,
                    layerHeightMm: r.layerHeightMm,
                    wallLoops: r.wallLoops,
                    infillPct: baseSlicer.infillPct,
                    brim: r.brim
                },
                false
            ));
        }
    }

    // Strictly rank bed-fitting candidates ahead of out-of-bed candidates; best MUST fit bed
    candidates.sort((a, b) => (b.fitsBed ? 1 : 0) - (a.fitsBed ? 1 : 0) || b.score - a.score);
    const bestFitting = candidates.find(c => c.fitsBed) || null;

    return {
        baseline,
        best: bestFitting,
        candidates
    };
}

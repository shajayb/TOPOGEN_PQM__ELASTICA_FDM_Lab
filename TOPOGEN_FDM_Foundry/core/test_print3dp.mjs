/**
 * TOPOGEN_FDM_Foundry — Pure-JS 3D-Printing Engine Unit Test Suite (core/test_print3dp.mjs)
 *
 * STRICT AIR-GAP: Zero imports from verifier/. Pure Node.js ES module testing core/print3dp.mjs only.
 * Usage: node ./TOPOGEN_FDM_Foundry/core/test_print3dp.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    P1S_SPEC,
    checkP1SBedFit,
    parseOBJToSnapshot,
    rescaleGeometryForP1S,
    buildBinarySTL,
    buildASCIISTL,
    analyzePrintability,
    sliceMeshLocal,
    parseBambuGcode,
    scorePrintCandidate,
    generateOptimizationCandidates
} from './print3dp.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
    if (!cond) throw new Error(msg || 'Assertion failed');
}

function assertClose(a, b, tol, msg) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a - b) > tol) {
        throw new Error(`${msg || 'assertClose failed'}: got ${a}, expected ${b} (±${tol})`);
    }
}

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        failed++;
        console.error(`  [FAIL] ${name}: ${err && err.message ? err.message : err}`);
    }
}

/**
 * Create a closed unit box [0..sx, 0..sy, 0..sz] with outward normals (quad faces).
 */
function makeBoxQuadSnapshot(sx = 1, sy = 1, sz = 1, ox = 0, oy = 0, oz = 0) {
    const vertices = [
        [ox, oy, oz],
        [ox + sx, oy, oz],
        [ox + sx, oy + sy, oz],
        [ox, oy + sy, oz],
        [ox, oy, oz + sz],
        [ox + sx, oy, oz + sz],
        [ox + sx, oy + sy, oz + sz],
        [ox, oy + sy, oz + sz]
    ];
    // Outward-facing CCW quads
    const faces = [
        [0, 3, 2, 1], // -Z bottom
        [4, 5, 6, 7], // +Z top
        [0, 1, 5, 4], // -Y front
        [2, 3, 7, 6], // +Y back
        [1, 2, 6, 5], // +X right
        [3, 0, 4, 7]  // -X left
    ];
    return { vertices, faces };
}

/**
 * Create an inverted-T (mushroom) shape: narrow stem on bottom + wide flat cap on top -> huge horizontal overhang!
 * When flipped 180°X, the wide flat cap sits on the bed -> zero overhang!
 */
function makeMushroomSnapshot() {
    const stem = makeBoxQuadSnapshot(20, 20, 40, -10, -10, 0);
    const cap = makeBoxQuadSnapshot(100, 100, 20, -50, -50, 40);
    const offset = stem.vertices.length;
    return {
        vertices: [...stem.vertices, ...cap.vertices],
        faces: [...stem.faces, ...cap.faces.map(f => f.map(i => i + offset))]
    };
}

console.log('=== TOPOGEN_FDM_Foundry core/print3dp.mjs Unit Test Suite ===');

test('1. P1S_SPEC has exact Bambu Lab P1S constants and is frozen', () => {
    assert(P1S_SPEC.name === 'Bambu Lab P1S', 'name mismatch');
    assert(P1S_SPEC.bedX === 256 && P1S_SPEC.bedY === 256 && P1S_SPEC.bedZ === 256, 'bed dimensions mismatch');
    assert(P1S_SPEC.safeMarginMm === 8, 'safeMarginMm mismatch');
    assert(P1S_SPEC.nozzleMm === 0.4, 'nozzleMm mismatch');
    assert(P1S_SPEC.defaultLayerHeightMm === 0.2, 'defaultLayerHeightMm mismatch');
    assert(P1S_SPEC.minWallMm === 0.84, 'minWallMm mismatch');
    assert(P1S_SPEC.extrusionWidthMm === 0.42, 'extrusionWidthMm mismatch');
    assert(Object.isFrozen(P1S_SPEC), 'P1S_SPEC must be frozen');
});

test('2. rescaleGeometryForP1S fits bed, centers at (128,128), seats Z=0, and never mutates input', () => {
    const box = makeBoxQuadSnapshot(2, 1, 1, 10, -5, 3);
    const dimParams = { voxelSize: 1.0, grid: { nx: 2, ny: 1, nz: 1 }, outerR: 0.12, innerR: 0.08, sides: 8 };
    const snapBefore = JSON.stringify(box);
    const dimBefore = JSON.stringify(dimParams);

    const res = rescaleGeometryForP1S(box, dimParams, { fitMode: 'fit-bed', marginMm: 8 });

    assert(JSON.stringify(box) === snapBefore, 'Input meshSnapshot was mutated!');
    assert(JSON.stringify(dimParams) === dimBefore, 'Input dimParams was mutated!');

    const p = res.rescaledParams;
    assert(p.fitsBed === true, 'Should fit P1S bed');
    assertClose(p.bboxMm.size[0], 240, 0.01, 'X should fill 256 - 2*8 = 240mm');
    assertClose(p.bboxMm.size[1], 120, 0.01, 'Y should be 120mm');
    assertClose(p.bboxMm.size[2], 120, 0.01, 'Z should be 120mm');
    assertClose((p.bboxMm.min[0] + p.bboxMm.max[0]) * 0.5, 128, 0.01, 'X centered at 128');
    assertClose((p.bboxMm.min[1] + p.bboxMm.max[1]) * 0.5, 128, 0.01, 'Y centered at 128');
    assertClose(p.bboxMm.min[2], 0, 0.001, 'Seated at Z=0');
    assertClose(p.scaleFactor, 120, 0.001, 'scaleFactor should be 120');
    assertClose(p.voxelSizeMm, 120, 0.01, 'voxelSizeMm scaled');
    assertClose(p.outerRMm, 14.4, 0.01, 'outerRMm scaled');
    assertClose(p.innerRMm, 9.6, 0.01, 'innerRMm scaled');
    assertClose(p.wallThicknessMm, 4.8, 0.01, 'wallThicknessMm = outerR - innerR');
    assert(p.thinWallWarning === false, 'Wall 4.8mm should not trigger thinWallWarning');
    assert(res.triangles.length === 12, '6 quads should triangulate to 12 triangles');
});

test('3. rescaleGeometryForP1S supports target-z, custom-scale, Euler rotation, overflow & thin-wall warnings', () => {
    const box = makeBoxQuadSnapshot(10, 20, 40);
    const resRot = rescaleGeometryForP1S(box, { outerR: 0.5, innerR: 0.45 }, {
        fitMode: 'target-z',
        targetZMm: 100,
        rotXDeg: 90
    });
    // Rotating 90° around X swaps Y (20) and Z (40), so new Z span before scaling is 20 -> scaleFactor = 5
    assertClose(resRot.rescaledParams.bboxMm.size[2], 100, 0.01, 'target-z after 90°X');
    assertClose(resRot.rescaledParams.bboxMm.size[1], 200, 0.01, 'swapped Y becomes 40*5=200mm');
    assertClose(resRot.rescaledParams.bboxMm.min[2], 0, 0.001, 'Z seated at 0');
    assert(resRot.rescaledParams.thinWallWarning === true, '0.05*5 = 0.25mm < 0.84mm should warn');

    const resOverflow = rescaleGeometryForP1S(box, {}, { fitMode: 'custom-scale', customScale: 10 });
    assert(resOverflow.rescaledParams.fitsBed === false, '400mm tall box must fail fitsBed');
});

test('4. buildBinarySTL and buildASCIISTL serialize valid STL payloads', () => {
    const box = rescaleGeometryForP1S(makeBoxQuadSnapshot(40, 40, 40), {}, { fitMode: 'custom-scale', customScale: 1 });
    const bin = buildBinarySTL(box);
    assert(bin instanceof Uint8Array, 'Binary STL must be Uint8Array');
    assert(bin.length === 84 + 12 * 50, `Expected ${84 + 12 * 50} bytes, got ${bin.length}`);
    const dv = new DataView(bin.buffer);
    assert(dv.getUint32(80, true) === 12, 'Triangle count in binary STL header must be 12');

    const ascii = buildASCIISTL(box, 'test_cube');
    assert(ascii.startsWith('solid test_cube\n'), 'ASCII STL header');
    assert(ascii.includes('endsolid test_cube'), 'ASCII STL footer');
    const facetMatches = ascii.match(/facet normal/g) || [];
    assert(facetMatches.length === 12, 'ASCII STL should contain 12 facets');
});

test('5. analyzePrintability distinguishes flat cube vs steep overhang mushroom', () => {
    const cube = rescaleGeometryForP1S(makeBoxQuadSnapshot(60, 60, 60), {}, { fitMode: 'custom-scale', customScale: 1 });
    const cubeAn = analyzePrintability(cube);
    assertClose(cubeAn.overhangAreaPct, 0, 0.01, 'Cube should have 0% overhang');
    assertClose(cubeAn.bedContactAreaMm2, 3600, 1.0, 'Cube bed contact area = 60*60 = 3600 mm^2');
    assertClose(cubeAn.volumeCm3, 216, 0.5, 'Cube volume = 216 cm^3');
    assert(cubeAn.printabilityScore >= 85, `Cube score should be >= 85, got ${cubeAn.printabilityScore}`);

    const mush = rescaleGeometryForP1S(makeMushroomSnapshot(), {}, { fitMode: 'custom-scale', customScale: 1 });
    const mushAn = analyzePrintability(mush);
    assert(mushAn.overhangAreaPct > 10, `Mushroom should have >10% overhang, got ${mushAn.overhangAreaPct}%`);
    assert(mushAn.criticalOverhangPct > 10, 'Mushroom should have critical horizontal overhangs');
    assert(mushAn.overhangFaceIndices.length > 0, 'Should report overhangFaceIndices');
    assert(mushAn.faceOverhangSeverity.length === mush.triangles.length, 'faceOverhangSeverity length mismatch');
    assert(mushAn.printabilityScore < cubeAn.printabilityScore, 'Mushroom must score lower than cube');
});

test('6. sliceMeshLocal slices cube and overhang mushroom cleanly with contours, infill & supports', () => {
    const cube = rescaleGeometryForP1S(makeBoxQuadSnapshot(40, 40, 20), {}, { fitMode: 'custom-scale', customScale: 1 });
    const slicedCube = sliceMeshLocal(cube, { layerHeightMm: 0.5, infillPct: 15, supportType: 'tree' });
    assert(slicedCube.layerCount === 40, `Expected 40 layers for 20mm @ 0.5mm, got ${slicedCube.layerCount}`);
    const mid = slicedCube.layers[20];
    assert(mid.contours.length >= 1, 'Mid-layer should have at least 1 contour');
    assert(mid.infillSegments.length > 0, 'Mid-layer should have hatch infill segments');
    assert(mid.supportSegments.length === 0, 'Cube should have 0 support segments');

    const mush = rescaleGeometryForP1S(makeMushroomSnapshot(), {}, { fitMode: 'custom-scale', customScale: 1 });
    const slicedMush = sliceMeshLocal(mush, { layerHeightMm: 1.0, overhangAngleDeg: 45, supportType: 'tree' });
    assert(slicedMush.summary.supportColumnCount > 0, 'Mushroom should generate support columns');
    assert(slicedMush.layers[10].supportSegments.length > 0, 'Lower layers under cap should have support segments');
});

test('7. parseBambuGcode parses Bambu Studio CHANGE_LAYER, FEATURE, G0/G1, G2/G3 arcs, and summary stats', () => {
    const sampleGcode = [
        '; model printing time: 1h 12m 30s; total estimated time: 1h 18m 0s',
        '; total layer number: 2',
        '; total filament weight [g] : 14.52',
        '; filament_density: 1.26',
        '; filament_diameter: 1.75',
        'M83',
        '; FEATURE: Custom',
        'G1 X10 Y10 Z0.2 E1.0',
        '; CHANGE_LAYER',
        '; Z_HEIGHT: 0.2',
        '; LAYER_HEIGHT: 0.2',
        '; FEATURE: Brim',
        'G1 X100 Y100',
        'G1 X120 Y100 E0.8',
        '; FEATURE: Outer wall',
        'G1 X120 Y120 E0.9',
        'G3 X100 Y120 I-10 J0 E1.2',
        '; FEATURE: Support',
        'G0 X130 Y130',
        'G1 X135 Y135 E0.5',
        '; CHANGE_LAYER',
        '; Z_HEIGHT: 0.4',
        '; LAYER_HEIGHT: 0.2',
        '; FEATURE: Support interface',
        'G1 X135 Y140 E0.4',
        '; FEATURE: Bridge',
        'G1 X110 Y140 E0.7',
        '; FEATURE: Sparse infill',
        'G1 X110 Y110 E0.6'
    ].join('\n');

    const parsedDefault = parseBambuGcode(sampleGcode);
    assert(parsedDefault.layers[0].segments.travel.length === 0, 'Default includeTravel=false omits travel moves');

    const parsed = parseBambuGcode(sampleGcode, { includeTravel: true });
    assert(parsed.layers.length === 2, `Expected 2 layers, got ${parsed.layers.length}`);
    assertClose(parsed.layers[0].z, 0.2, 0.001, 'Layer 0 Z=0.2');
    assertClose(parsed.layers[1].z, 0.4, 0.001, 'Layer 1 Z=0.4');
    assert(parsed.layers[0].segments.brim.length === 4, 'Layer 0 brim segment');
    assert(parsed.layers[0].segments.outer_wall.length >= 12, 'Layer 0 outer_wall includes linear + G3 arc chords');
    assert(parsed.layers[0].segments.support.length === 4, 'Layer 0 support segment');
    assert(parsed.layers[0].segments.travel.length >= 4, 'Layer 0 travel segment');
    assert(parsed.layers[1].segments.support_interface.length === 4, 'Layer 1 support_interface segment');
    assert(parsed.layers[1].segments.bridge.length === 4, 'Layer 1 bridge segment');
    assert(parsed.layers[1].segments.infill.length === 4, 'Layer 1 infill segment');
    assertClose(parsed.summary.totalFilamentG, 14.52, 0.01, 'Header filament grams');
    assertClose(parsed.summary.estimatedTimeMin, 78, 0.01, 'Header total time = 78 min');
    assertClose(parsed.summary.modelTimeMin, 72.5, 0.01, 'Header model time = 72.5 min');
    assert(parsed.summary.supportFilamentG > 0, 'Support filament grams computed');
});

test('8. generateOptimizationCandidates flips mushroom upside-down to improve printability score', () => {
    const mush = makeMushroomSnapshot();
    const opt = generateOptimizationCandidates(mush, { voxelSize: 100 }, {
        fitMode: 'fit-bed',
        rotXDeg: 0,
        rotYDeg: 0,
        rotZDeg: 0
    });
    assert(opt.candidates.length >= 6, `Expected >= 6 candidates, got ${opt.candidates.length}`);
    assert(opt.best.score > opt.baseline.score, `Best (${opt.best.score}) should beat upright baseline (${opt.baseline.score})`);
    assert(opt.best.analysis.overhangAreaPct < opt.baseline.analysis.overhangAreaPct, 'Best orientation should reduce overhang %');
});

test('9. Real batwing.obj end-to-end rescale -> STL -> analyze -> slice -> optimize', () => {
    const batwingPath = path.resolve(__dirname, '..', 'assets', 'inputs', 'batwing.obj');
    assert(fs.existsSync(batwingPath), `batwing.obj missing at ${batwingPath}`);
    const objText = fs.readFileSync(batwingPath, 'utf8');
    const snap = parseOBJToSnapshot(objText);
    assert(snap.vertices.length >= 20 && snap.faces.length >= 10, `batwing.obj parsed (${snap.vertices.length}v/${snap.faces.length}f)`);

    const rescaled = rescaleGeometryForP1S(snap, { voxelSize: 1.0, outerR: 0.04, innerR: 0.02 }, {
        fitMode: 'target-z',
        targetZMm: 180
    });
    assert(rescaled.rescaledParams.fitsBed === true, 'batwing @ 180mm Z should fit P1S bed');
    assertClose(rescaled.rescaledParams.bboxMm.size[2], 180, 0.1, 'batwing Z=180mm');
    assertClose(rescaled.rescaledParams.bboxMm.min[2], 0, 0.001, 'batwing seated at Z=0');

    const stl = buildBinarySTL(rescaled);
    assert(stl.length === 84 + rescaled.triangles.length * 50, 'batwing binary STL exact size');

    const analysis = analyzePrintability(rescaled);
    assert(analysis.printabilityScore >= 0 && analysis.printabilityScore <= 100, 'score in [0,100]');

    const sliced = sliceMeshLocal(rescaled, { layerHeightMm: 1.0, infillPct: 15, supportType: 'tree' });
    assert(sliced.layerCount === 180, `Expected 180 layers @ 1mm, got ${sliced.layerCount}`);
    assert(sliced.layers[90].contours.length > 0, 'batwing mid-layer has contours');

    const opt = generateOptimizationCandidates(snap, { voxelSize: 1.0 }, { fitMode: 'target-z', targetZMm: 180 });
    assert(opt.best.score >= opt.baseline.score, 'Optimizer best >= baseline on batwing.obj');
    console.log(`    [info] batwing.obj: ${snap.vertices.length}v/${rescaled.triangles.length}t | bbox=${rescaled.rescaledParams.bboxMm.size.join('x')}mm | baseline=${opt.baseline.score} -> best=${opt.best.score} (${opt.best.label})`);
});

test('10. Strict P1S bed-fit gating: checkP1SBedFit, sliceMeshLocal OUT_OF_BED_BOUNDS, and optimizer exclusion', () => {
    // 10a. checkP1SBedFit tolerance & overflow reporting
    const okFit = checkP1SBedFit({ min: [-0.04, 0, 0], max: [256.04, 256, 256] });
    assert(okFit.fitsBed === true, 'Within 0.05mm tolerance should fit bed');
    assert(okFit.overflowMm.x === 0 && okFit.overflowMm.y === 0 && okFit.overflowMm.z === 0, 'Zero overflow when fitting');
    assert(okFit.bedMm[0] === 256 && okFit.bedMm[1] === 256 && okFit.bedMm[2] === 256, 'bedMm is [256,256,256]');

    const badFit = checkP1SBedFit({ min: [-12, 10, 0], max: [268, 240, 300] });
    assert(badFit.fitsBed === false, 'Overflowing bbox must fail fitsBed');
    assertClose(badFit.overflowMm.x, 24, 0.01, 'X overflow = 12 + 12 = 24mm');
    assertClose(badFit.overflowMm.y, 0, 0.01, 'Y overflow = 0mm');
    assertClose(badFit.overflowMm.z, 44, 0.01, 'Z overflow = 300 - 256 = 44mm');

    // 10b. sliceMeshLocal rejects out-of-bed geometry cleanly without slicing
    const oversized = rescaleGeometryForP1S(makeBoxQuadSnapshot(300, 100, 100), {}, {
        fitMode: 'custom-scale',
        customScale: 1
    });
    assert(oversized.rescaledParams.fitsBed === false, '300mm wide box must fail fitsBed');
    assert(oversized.rescaledParams.overflowMm.x > 40, 'rescaledParams.overflowMm.x should report overflow');

    const rejected = sliceMeshLocal(oversized, { layerHeightMm: 0.5 });
    assert(rejected.ok === false, 'sliceMeshLocal must return ok:false when out of bed');
    assert(rejected.error === 'OUT_OF_BED_BOUNDS', `Expected OUT_OF_BED_BOUNDS, got ${rejected.error}`);
    assert(rejected.layerCount === 0 && rejected.layers.length === 0, 'Out-of-bed slice must emit 0 layers');
    assert(rejected.overflowMm.x > 40, 'Rejected slice must report overflowMm');

    // 10c. Bed-fitting geometry slices normally with ok:true and all coords strictly within [0..256]
    const fitting = rescaleGeometryForP1S(makeBoxQuadSnapshot(256, 256, 40), {}, {
        fitMode: 'custom-scale',
        customScale: 1
    });
    const okSlice = sliceMeshLocal(fitting, { layerHeightMm: 1.0, infillPct: 15, supportType: 'tree' });
    assert(okSlice.ok === true, 'Bed-fitting geometry must return ok:true');
    assert(okSlice.layerCount === 40, `Expected 40 layers, got ${okSlice.layerCount}`);
    for (const layer of okSlice.layers) {
        assert(layer.z >= 0 && layer.z <= 256, `Layer Z=${layer.z} out of [0..256]`);
        for (const arr of Object.values(layer.segments)) {
            for (let i = 0; i < arr.length; i++) {
                assert(arr[i] >= 0 && arr[i] <= 256, `Segment coord ${arr[i]} out of [0..256]`);
            }
        }
    }

    // 10d. generateOptimizationCandidates excludes out-of-bed candidates from winning
    // Tall 50x50x300 bar at custom-scale=1: upright overflows Z (300>256), tilted +90X overflows Y,
    // all orientations overflow at custom-scale=1 -> best must be null!
    const allOverflow = generateOptimizationCandidates(makeBoxQuadSnapshot(300, 300, 300), {}, {
        fitMode: 'custom-scale',
        customScale: 1
    });
    assert(allOverflow.best === null, 'When zero candidates fit bed, optimizer best must be null');
    assert(allOverflow.baseline.fitsBed === false, 'Oversized baseline marked fitsBed=false');

    // 100x100x200 box with target-z=200: upright fits (100x100x200), tilted +90X has Z=100 -> scaled to 200 -> Y=400 (overflow!)
    const partialFit = generateOptimizationCandidates(makeBoxQuadSnapshot(100, 100, 200), {}, {
        fitMode: 'target-z',
        targetZMm: 200
    });
    assert(partialFit.best !== null && partialFit.best.fitsBed === true, 'Optimizer best must always have fitsBed === true');
});

test('11. parseBambuGcode feature-priority budgeting preserves 100% of outer_wall & support islands', () => {
    const g = ['M83', '; CHANGE_LAYER', '; Z_HEIGHT: 0.2', '; LAYER_HEIGHT: 0.2'];
    // Emit heavy infill (160 segs) + travel (60 segs) FIRST in raw G-code order
    g.push('; FEATURE: Sparse infill');
    g.push('G1 X60 Y60');
    for (let i = 0; i < 160; i++) {
        const y = 60 + (i % 80);
        const x = (i % 2 === 0) ? 180 : 60;
        g.push(`G1 X${x} Y${y} E0.4`);
        if (i < 60) g.push(`G0 X${x + 2} Y${y + 0.5}`);
    }
    // Emit 4 distinct spatial outer_wall islands AFTER infill (10 segs each = 40 segs)
    const islands = [
        [40, 40],
        [200, 40],
        [200, 200],
        [40, 200]
    ];
    g.push('; FEATURE: Outer wall');
    for (const [cx, cy] of islands) {
        g.push(`G0 X${cx + 8} Y${cy}`);
        for (let k = 1; k <= 10; k++) {
            const ang = (k / 10) * Math.PI * 2;
            const x = (cx + Math.cos(ang) * 8).toFixed(2);
            const y = (cy + Math.sin(ang) * 8).toFixed(2);
            g.push(`G1 X${x} Y${y} E0.2`);
        }
    }
    // Emit 2 distinct support islands AFTER outer_wall (10 segs each = 20 segs)
    const supIslands = [[90, 90], [160, 160]];
    g.push('; FEATURE: Support');
    for (const [cx, cy] of supIslands) {
        g.push(`G0 X${cx + 5} Y${cy}`);
        for (let k = 1; k <= 10; k++) {
            const ang = (k / 10) * Math.PI * 2;
            const x = (cx + Math.cos(ang) * 5).toFixed(2);
            const y = (cy + Math.sin(ang) * 5).toFixed(2);
            g.push(`G1 X${x} Y${y} E0.2`);
        }
    }

    const gcode = g.join('\n');
    const parsed = parseBambuGcode(gcode, { maxSegmentsPerLayer: 80, includeTravel: true });
    const segs = parsed.layers[0].segments;
    const outerCount = segs.outer_wall.length / 4;
    const supCount = segs.support.length / 4;
    const infillCount = segs.infill.length / 4;
    const travelCount = segs.travel.length / 4;

    assert(outerCount === 40, `Expected 100% of outer_wall (40 segs), got ${outerCount}`);
    assert(supCount === 20, `Expected 100% of support (20 segs), got ${supCount}`);
    assert(infillCount === 20, `Expected remaining 20 segs for infill, got ${infillCount}`);
    assert(travelCount === 0, `Expected travel truncated when budget exhausted, got ${travelCount}`);
    assert(parsed.summary.totalSegments === 80, `Total segments must equal budget 80, got ${parsed.summary.totalSegments}`);

    // Verify all 4 outer_wall islands are present even under aggressive budget (24 segs < 40 outer_wall segs)
    const tight = parseBambuGcode(gcode, { maxSegmentsPerLayer: 24, includeTravel: false });
    const ow = tight.layers[0].segments.outer_wall;
    assert(ow.length / 4 === 24, `Expected 24 uniformly strided outer_wall segs, got ${ow.length / 4}`);
    for (const [cx, cy] of islands) {
        let hit = false;
        for (let i = 0; i < ow.length; i += 4) {
            if (Math.hypot(ow[i] - cx, ow[i + 1] - cy) < 12) { hit = true; break; }
        }
        assert(hit, `Uniform striding must preserve island near (${cx},${cy})`);
    }
});

test('12. Strict Generator/Verifier air-gap check on core/print3dp.mjs', () => {
    const src = fs.readFileSync(path.join(__dirname, 'print3dp.mjs'), 'utf8');
    const forbiddenDir = 'veri' + 'fier';
    const reStatic = new RegExp(`from\\s+['"][^'"]*${forbiddenDir}`, 'i');
    const reDynamic = new RegExp(`import\\s*\\([^)]*${forbiddenDir}`, 'i');
    assert(!reStatic.test(src), 'core/print3dp.mjs must NEVER import forbidden air-gap dir');
    assert(!reDynamic.test(src), 'core/print3dp.mjs must NEVER dynamically import forbidden air-gap dir');
    assert(!/node:fs|node:path|node:child_process/i.test(src), 'core/print3dp.mjs must have zero Node-only imports');
});

console.log(`\nResult: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

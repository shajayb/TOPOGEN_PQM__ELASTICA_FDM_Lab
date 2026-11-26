#!/usr/bin/env node
/**
 * TOPOGEN_FDM_Foundry — Deterministic Test Suite for Procedural Chain, Corpus & Lab Server API
 *
 * ZERO verifier/ imports (strict Generator/Verifier air-gap).
 * Usage:
 *   node ./TOPOGEN_FDM_Foundry/core/test_procedural_chain.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
    CHAIN_SCHEMA_VERSION,
    SUPPORTED_STEP_OPS,
    DEFAULT_CAMERA_BOOKMARKS,
    normalizeRepoRelativePath,
    createProceduralChain,
    appendChainStep,
    registerChainAsset,
    validateProceduralChain,
    serializeProceduralChain,
    parseProceduralChain
} from './procedural_chain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FOUNDRY_DIR = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FOUNDRY_DIR, '..');
const CORPUS_DIR = path.join(FOUNDRY_DIR, 'corpus');
const SERVE_LAB_PATH = path.join(FOUNDRY_DIR, 'serve_lab.mjs');

let passed = 0;
let failed = 0;

async function runTest(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  [PASS] ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  [FAIL] ${name}`);
        console.error(`         ${err && err.stack ? err.stack : err}`);
    }
}

function getFreePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.unref();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            const port = addr && typeof addr === 'object' ? addr.port : 0;
            srv.close(() => resolve(port));
        });
    });
}

async function waitForServer(baseUrl, timeoutMs = 6000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${baseUrl}/api/chains`);
            if (res.ok) return;
        } catch {
            // retry until ready
        }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`Timed out waiting for serve_lab.mjs at ${baseUrl}`);
}

console.log('=== TOPOGEN Procedural Chain & Corpus Test Suite ===');

// 1. Default Camera Bookmarks (Ortho & Persp)
await runTest('DEFAULT_CAMERA_BOOKMARKS provides 4 Orthographic and 3 Perspective studio views', () => {
    assert.equal(CHAIN_SCHEMA_VERSION, 'topogen-procedural-chain/v1');
    assert.ok(Array.isArray(DEFAULT_CAMERA_BOOKMARKS));
    assert.equal(DEFAULT_CAMERA_BOOKMARKS.length, 7);

    const ids = new Set(DEFAULT_CAMERA_BOOKMARKS.map((b) => b.id));
    for (const reqId of [
        'ortho-top',
        'ortho-front',
        'ortho-right',
        'ortho-iso',
        'persp-iso',
        'persp-front-left',
        'persp-low'
    ]) {
        assert.ok(ids.has(reqId), `Missing built-in bookmark "${reqId}"`);
    }

    const ortho = DEFAULT_CAMERA_BOOKMARKS.filter((b) => b.projection === 'orthographic');
    const persp = DEFAULT_CAMERA_BOOKMARKS.filter((b) => b.projection === 'perspective');
    assert.equal(ortho.length, 4, 'Expected 4 orthographic bookmarks');
    assert.equal(persp.length, 3, 'Expected 3 perspective bookmarks');

    for (const bm of DEFAULT_CAMERA_BOOKMARKS) {
        assert.equal(bm.position.length, 3);
        assert.equal(bm.target.length, 3);
        assert.equal(bm.up.length, 3);
        assert.ok(bm.position.every(Number.isFinite));
        assert.ok(bm.target.every(Number.isFinite));
        assert.ok(bm.up.every(Number.isFinite));
        assert.equal(bm.builtin, true);
    }
});

// 2. Repo-relative path normalization & security rejections
await runTest('normalizeRepoRelativePath normalizes clean paths and rejects Windows/POSIX absolute, UNC, traversal, and .git', () => {
    assert.equal(
        normalizeRepoRelativePath('TOPOGEN_FDM_Foundry\\assets\\inputs\\batwing.obj'),
        'TOPOGEN_FDM_Foundry/assets/inputs/batwing.obj'
    );
    assert.equal(
        normalizeRepoRelativePath('./TOPOGEN_FDM_Foundry/corpus/case1.chain.json'),
        'TOPOGEN_FDM_Foundry/corpus/case1.chain.json'
    );

    const badPaths = [
        '',
        '   ',
        'C:\\Users\\alice\\Downloads\\batwing.obj',
        'D:/repo/file.obj',
        '\\\\server\\share\\file.obj',
        '//server/share/file.obj',
        '/etc/passwd',
        '/Users/alice/Downloads/batwing.obj',
        '../outside.obj',
        'TOPOGEN_FDM_Foundry/../../escape.obj',
        '.git/config',
        'TOPOGEN_FDM_Foundry/.git/HEAD',
        'foo/bar\0baz.obj'
    ];

    for (const p of badPaths) {
        assert.throws(
            () => normalizeRepoRelativePath(p),
            `Expected normalizeRepoRelativePath(${JSON.stringify(p)}) to throw`
        );
    }
});

// 3. Schema creation, mutation, validation & rejection of bad chains
await runTest('createProceduralChain, appendChainStep, registerChainAsset, and validateProceduralChain enforce schema', () => {
    assert.ok(SUPPORTED_STEP_OPS.includes('tile_import'));
    assert.ok(SUPPORTED_STEP_OPS.includes('pq_subdiv_ring'));
    assert.ok(SUPPORTED_STEP_OPS.includes('pq_subdiv_long'));
    assert.ok(SUPPORTED_STEP_OPS.includes('camera_bookmark'));

    const chain = createProceduralChain({
        id: 'unit-test-chain',
        name: 'Unit Test Chain',
        notes: 'Deterministic schema test'
    });
    assert.equal(chain.schema, CHAIN_SCHEMA_VERSION);
    assert.equal(chain.bookmarks.length, 7);

    const asset = registerChainAsset(chain, {
        repoRelativePath: 'TOPOGEN_FDM_Foundry\\assets\\inputs\\batwing.obj',
        originalName: 'batwing.obj',
        bytes: 5922,
        sha256Short: '7afc2091597d'
    });
    assert.equal(asset.repoRelativePath, 'TOPOGEN_FDM_Foundry/assets/inputs/batwing.obj');
    assert.equal(asset.ext, '.obj');

    const s0 = appendChainStep(chain, {
        op: 'tile_import',
        params: {
            assetId: asset.id,
            repoRelativePath: asset.repoRelativePath,
            customOnly: true
        },
        bookmarkId: 'persp-iso',
        capture: true
    });
    assert.equal(s0.index, 0);

    const valid = validateProceduralChain(chain);
    assert.equal(valid.ok, true, `Unexpected validation errors: ${valid.errors.join('; ')}`);
    assert.equal(valid.errors.length, 0);

    // Reject absolute Windows & POSIX paths in saved chains
    const badWin = structuredClone(chain);
    badWin.assets[0].repoRelativePath = 'C:\\Users\\alice\\Downloads\\batwing.obj';
    assert.equal(validateProceduralChain(badWin).ok, false);
    assert.throws(() => serializeProceduralChain(badWin));

    const badPosix = structuredClone(chain);
    badPosix.steps[0].params.repoRelativePath = '/Users/alice/Downloads/batwing.obj';
    assert.equal(validateProceduralChain(badPosix).ok, false);
    assert.throws(() => serializeProceduralChain(badPosix));

    // Reject unknown op and wrong schema
    const badOp = structuredClone(chain);
    badOp.steps[0].op = 'delete_everything';
    assert.equal(validateProceduralChain(badOp).ok, false);

    const badSchema = structuredClone(chain);
    badSchema.schema = 'wrong-schema/v99';
    assert.equal(validateProceduralChain(badSchema).ok, false);
});

// 4. Serialization compactness & performance
await runTest('serializeProceduralChain / parseProceduralChain round-trip is compact and fast', () => {
    const chain = createProceduralChain({ id: 'perf-chain', name: 'Perf Chain' });
    appendChainStep(chain, { op: 'tile_preset', params: { preset: 'default_ortho' } });
    appendChainStep(chain, { op: 'grid_config', params: { nx: 3, ny: 3, nz: 4 } });
    appendChainStep(chain, { op: 'wfc_collapse', params: { seed: 42 }, bookmarkId: 'persp-iso', capture: true });
    appendChainStep(chain, { op: 'pq_solidify', params: {}, bookmarkId: 'ortho-iso', capture: true });

    const prettyJson = serializeProceduralChain(chain, { pretty: true });
    const compactJson = serializeProceduralChain(chain, { pretty: false });
    assert.ok(compactJson.length < prettyJson.length, 'Compact JSON must be smaller than pretty JSON');
    assert.ok(Buffer.byteLength(compactJson, 'utf8') < 4096, 'Compact 4-step chain should stay lightweight (< 4 KB)');

    const parsed = parseProceduralChain(compactJson);
    assert.equal(parsed.id, chain.id);
    assert.equal(parsed.steps.length, 4);

    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
        const s = serializeProceduralChain(chain, { pretty: false });
        const p = parseProceduralChain(s);
        assert.equal(p.steps.length, 4);
    }
    const elapsedMs = performance.now() - t0;
    assert.ok(elapsedMs < 1000, `200 serialize/parse round-trips took ${elapsedMs.toFixed(1)}ms (expected < 1000ms)`);
});

// 5. All 3 Corpus .chain.json files + corpus_manifest.json + asset verification on disk
await runTest('corpus_manifest.json and all 3 corpus .chain.json files pass schema, hygiene, and on-disk asset checks', () => {
    const manifestPath = path.join(CORPUS_DIR, 'corpus_manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'Missing TOPOGEN_FDM_Foundry/corpus/corpus_manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.cases.length, 3, 'Expected 3 corpus cases in corpus_manifest.json');

    const chainsById = new Map();
    for (const c of manifest.cases) {
        const rel = normalizeRepoRelativePath(c.chainPath);
        const abs = path.join(REPO_ROOT, ...rel.split('/'));
        assert.ok(fs.existsSync(abs), `Corpus chain file missing on disk: ${rel}`);

        const raw = fs.readFileSync(abs, 'utf8');
        // Hygiene: no absolute local Windows/macOS/Linux disk paths leaked
        assert.equal(/[A-Za-z]:\\/.test(raw), false, `Absolute Windows path leaked into ${rel}`);
        assert.equal(/\/Users\/|\/home\//.test(raw), false, `Absolute POSIX user path leaked into ${rel}`);

        const chain = parseProceduralChain(raw);
        const validation = validateProceduralChain(chain);
        assert.equal(validation.ok, true, `${rel} failed validation: ${validation.errors.join('; ')}`);
        assert.equal(validation.warnings.length, 0, `${rel} had validation warnings: ${validation.warnings.join('; ')}`);
        assert.equal(chain.id, c.id);
        assert.equal(chain.steps.length, c.expectedStepCount, `${rel} step count mismatch`);

        const captureCount = chain.steps.filter((s) => Boolean(s.capture)).length;
        assert.equal(captureCount, c.expectedCaptureCount, `${rel} capture count mismatch`);

        // Verify all referenced assets exist on disk with exact byte size & sha256Short
        for (const asset of chain.assets) {
            const assetRel = normalizeRepoRelativePath(asset.repoRelativePath);
            const assetAbs = path.join(REPO_ROOT, ...assetRel.split('/'));
            assert.ok(fs.existsSync(assetAbs), `Referenced asset missing on disk: ${assetRel}`);
            const buf = fs.readFileSync(assetAbs);
            assert.equal(buf.length, asset.bytes, `Asset byte length mismatch for ${assetRel}`);
            const shaShort = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
            assert.equal(shaShort, asset.sha256Short, `Asset sha256Short mismatch for ${assetRel}`);
        }

        chainsById.set(chain.id, chain);
    }

    // Case 1 assertions (Image 1: default + arch_vault, 3x3x4, miterClamp: true, pq_subdiv_ring)
    const c1 = chainsById.get('case1_arch_vault_pq_ring_subdiv');
    assert.ok(c1, 'Missing case1_arch_vault_pq_ring_subdiv');
    assert.ok(c1.steps.some((s) => s.op === 'tile_toggle' && s.params.key === 'arch_vault' && s.params.enabled === true));
    assert.ok(c1.steps.some((s) => s.op === 'grid_config' && s.params.nx === 3 && s.params.ny === 3 && s.params.nz === 4));
    const c1Pq = c1.steps.find((s) => s.op === 'pq_config');
    assert.ok(c1Pq && c1Pq.params.outerR === 0.073 && c1Pq.params.innerR === 0 && c1Pq.params.sides === 8 && c1Pq.params.subdivL === 1 && c1Pq.params.bisector === true && c1Pq.params.miterClamp === true && c1Pq.params.planarize === true && c1Pq.params.caps === true);
    assert.ok(c1.steps.some((s) => s.op === 'pq_solidify'));
    assert.ok(c1.steps.some((s) => s.op === 'pq_subdiv_ring'));

    // Case 2 assertions (Image 2: default + arch_vault, 3x3x4, miterClamp: false, pq_subdiv_long)
    const c2 = chainsById.get('case2_arch_vault_pq_long_subdiv');
    assert.ok(c2, 'Missing case2_arch_vault_pq_long_subdiv');
    assert.ok(c2.steps.some((s) => s.op === 'tile_toggle' && s.params.key === 'arch_vault' && s.params.enabled === true));
    assert.ok(c2.steps.some((s) => s.op === 'grid_config' && s.params.nx === 3 && s.params.ny === 3 && s.params.nz === 4));
    const c2Pq = c2.steps.find((s) => s.op === 'pq_config');
    assert.ok(c2Pq && c2Pq.params.outerR === 0.073 && c2Pq.params.innerR === 0 && c2Pq.params.sides === 8 && c2Pq.params.subdivL === 1 && c2Pq.params.bisector === true && c2Pq.params.miterClamp === false && c2Pq.params.planarize === true && c2Pq.params.caps === true);
    assert.ok(c2.steps.some((s) => s.op === 'pq_solidify'));
    assert.ok(c2.steps.some((s) => s.op === 'pq_subdiv_long'));

    // Case 3 assertions (Image 3: batwing.obj customOnly, 1x1x1, miterClamp: false, pq_solidify)
    const c3 = chainsById.get('case3_batwing_1x1x1_pq');
    assert.ok(c3, 'Missing case3_batwing_1x1x1_pq');
    assert.ok(c3.steps.some((s) => s.op === 'tile_import' && s.params.repoRelativePath === 'TOPOGEN_FDM_Foundry/assets/inputs/batwing.obj' && s.params.customOnly === true));
    assert.ok(c3.steps.some((s) => s.op === 'grid_config' && s.params.nx === 1 && s.params.ny === 1 && s.params.nz === 1));
    const c3Pq = c3.steps.find((s) => s.op === 'pq_config');
    assert.ok(c3Pq && c3Pq.params.outerR === 0.073 && c3Pq.params.innerR === 0 && c3Pq.params.sides === 8 && c3Pq.params.subdivL === 1 && c3Pq.params.bisector === true && c3Pq.params.miterClamp === false && c3Pq.params.planarize === true && c3Pq.params.caps === true);
    assert.ok(c3.steps.some((s) => s.op === 'pq_solidify'));
});

// 6. Live serve_lab.mjs HTTP API round-trip with cleanup
await runTest('serve_lab.mjs HTTP API round-trip (stage, repo-file, chains, chains/save, captures/save + security)', async () => {
    const port = await getFreePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [SERVE_LAB_PATH, String(port)], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe']
    });

    const nonce = `tmp_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const stagedAssetName = `${nonce}.obj`;
    const tempChainId = `${nonce}_chain`;
    const cleanupPaths = [];

    try {
        await waitForServer(baseUrl);

        // Static HTML Cache-Control header check
        const htmlRes = await fetch(`${baseUrl}/index_TOPOGEN_PQM_ELASTICA_FDM.html`);
        assert.equal(htmlRes.status, 200);
        assert.match(htmlRes.headers.get('cache-control') || '', /no-store/i);

        // POST /api/assets/stage
        const objText = '# temp test obj\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';
        const stageRes = await fetch(`${baseUrl}/api/assets/stage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileName: stagedAssetName, contentText: objText })
        });
        assert.equal(stageRes.status, 200);
        const stageJson = await stageRes.json();
        assert.equal(stageJson.ok, true);
        assert.equal(stageJson.repoRelativePath, `TOPOGEN_FDM_Foundry/assets/inputs/${stagedAssetName}`);
        cleanupPaths.push(path.join(REPO_ROOT, ...stageJson.repoRelativePath.split('/')));

        // GET /api/repo-file?path=...
        const fetchRes = await fetch(`${baseUrl}/api/repo-file?path=${encodeURIComponent(stageJson.repoRelativePath)}`);
        assert.equal(fetchRes.status, 200);
        const fetchedText = await fetchRes.text();
        assert.equal(fetchedText, objText);

        // Security: block traversal and .git
        const travRes = await fetch(`${baseUrl}/api/repo-file?path=${encodeURIComponent('../package.json')}`);
        assert.ok(travRes.status === 400 || travRes.status === 403, `Expected 400/403 on traversal, got ${travRes.status}`);
        const gitRes = await fetch(`${baseUrl}/api/repo-file?path=${encodeURIComponent('.git/HEAD')}`);
        assert.ok(gitRes.status === 400 || gitRes.status === 403, `Expected 400/403 on .git, got ${gitRes.status}`);

        // GET /api/chains (lists all 3 corpus chains)
        const listRes = await fetch(`${baseUrl}/api/chains`);
        assert.equal(listRes.status, 200);
        const listJson = await listRes.json();
        assert.equal(listJson.ok, true);
        const listedIds = new Set(listJson.chains.map((c) => c.id));
        assert.ok(listedIds.has('case1_arch_vault_pq_ring_subdiv'));
        assert.ok(listedIds.has('case2_arch_vault_pq_long_subdiv'));
        assert.ok(listedIds.has('case3_batwing_1x1x1_pq'));

        // POST /api/chains/save
        const tempChain = createProceduralChain({ id: tempChainId, name: 'Temp Roundtrip Chain' });
        registerChainAsset(tempChain, {
            repoRelativePath: stageJson.repoRelativePath,
            originalName: stagedAssetName,
            bytes: stageJson.bytes,
            sha256Short: stageJson.sha256Short
        });
        appendChainStep(tempChain, {
            op: 'tile_import',
            params: { repoRelativePath: stageJson.repoRelativePath, customOnly: true }
        });

        const saveChainRes = await fetch(`${baseUrl}/api/chains/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chain: tempChain, target: 'chains' })
        });
        assert.equal(saveChainRes.status, 200);
        const saveChainJson = await saveChainRes.json();
        assert.equal(saveChainJson.ok, true);
        assert.match(saveChainJson.repoRelativePath, /^TOPOGEN_FDM_Foundry\/chains\/.*\.chain\.json$/);
        cleanupPaths.push(path.join(REPO_ROOT, ...saveChainJson.repoRelativePath.split('/')));

        // POST /api/captures/save (1x1 transparent PNG + manifest)
        const tinyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
        const capRes = await fetch(`${baseUrl}/api/captures/save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chainId: tempChainId,
                stageFile: 'stage_01_test.png',
                imageBase64: tinyPngBase64,
                manifest: { chainId: tempChainId, stages: [{ index: 0, file: 'stage_01_test.png' }] }
            })
        });
        assert.equal(capRes.status, 200);
        const capJson = await capRes.json();
        assert.equal(capJson.ok, true);
        assert.match(capJson.repoRelativePath, /^TOPOGEN_FDM_Foundry\/corpus\/captures\/.*\.png$/);
        const capAbs = path.join(REPO_ROOT, ...capJson.repoRelativePath.split('/'));
        assert.ok(fs.existsSync(capAbs), 'Captured PNG missing on disk');
        cleanupPaths.push(path.dirname(capAbs));
    } finally {
        child.kill('SIGTERM');
        await new Promise((resolve) => {
            child.once('exit', resolve);
            setTimeout(resolve, 1000);
        });
        for (const p of cleanupPaths) {
            await fsp.rm(p, { recursive: true, force: true }).catch(() => {});
        }
        // Clean up empty TOPOGEN_FDM_Foundry/chains or captures dirs if created only by this test
        for (const maybeEmpty of [
            path.join(FOUNDRY_DIR, 'chains'),
            path.join(CORPUS_DIR, 'captures')
        ]) {
            try {
                const entries = await fsp.readdir(maybeEmpty);
                if (entries.length === 0) await fsp.rmdir(maybeEmpty);
            } catch {
                // ignore if doesn't exist
            }
        }
    }
});

// 7. Regression test: exact user-exported 5-step live-session JSON round-trip
await runTest('User-exported 5-step live-session JSON (4 tile_toggle + 1 grid_config 2x2x1) parses and validates with 0 errors', () => {
    const userExported = {
        schema: 'topogen-procedural-chain/v1',
        id: 'live-session',
        name: 'Live Session',
        createdAt: '2026-11-26T12:10:00.000Z',
        updatedAt: '2026-11-26T12:12:00.000Z',
        notes: 'User-exported live session regression fixture',
        assets: [],
        bookmarks: DEFAULT_CAMERA_BOOKMARKS.map((b) => structuredClone(b)),
        steps: [
            {
                index: 0,
                id: 'step-01-tile_toggle',
                op: 'tile_toggle',
                label: 'Disable Vertical Tube',
                params: { id: 2, key: 'vtube', enabled: false }
            },
            {
                index: 1,
                id: 'step-02-tile_toggle',
                op: 'tile_toggle',
                label: 'Disable Null',
                params: { id: 0, key: 'null', enabled: false }
            },
            {
                index: 2,
                id: 'step-03-tile_toggle',
                op: 'tile_toggle',
                label: 'Disable Cross',
                params: { id: 1, key: 'cross', enabled: false }
            },
            {
                index: 3,
                id: 'step-04-tile_toggle',
                op: 'tile_toggle',
                label: 'Enable Diagrid Octa',
                params: { id: 7, key: 'diag_pyramid', enabled: true }
            },
            {
                index: 4,
                id: 'step-05-grid_config',
                op: 'grid_config',
                label: 'Configure Grid 2x2x1',
                params: { x: 2, y: 2, z: 1, voxelSize: 1, algorithm: 'wfc' }
            }
        ]
    };

    const jsonText = JSON.stringify(userExported, null, 2);
    const parsed = parseProceduralChain(jsonText);
    const check = validateProceduralChain(parsed);
    assert.equal(check.ok, true, `Validation failed: ${check.errors.join('; ')}`);
    assert.equal(check.errors.length, 0);
    assert.equal(check.warnings.length, 0);
    assert.equal(parsed.id, 'live-session');
    assert.equal(parsed.assets.length, 0);
    assert.equal(parsed.bookmarks.length, 7);
    assert.equal(parsed.steps.length, 5);
    assert.equal(parsed.steps[3].params.id, 7);
    assert.equal(parsed.steps[3].params.enabled, true);
    assert.deepEqual(parsed.steps[4].params, { x: 2, y: 2, z: 1, voxelSize: 1, algorithm: 'wfc' });

    const reserialized = serializeProceduralChain(parsed, { pretty: false });
    const reparsed = parseProceduralChain(reserialized);
    assert.equal(reparsed.steps.length, 5);
});

// 8. Static & contract invariants for tab-lock, jumpToStage, file-load, and direct-over-viewport timeline
await runTest('UI playback contract invariants: tab-lock, jumpToStage, file-load, and frameless viewport timeline', () => {
    const recorderSrc = fs.readFileSync(path.join(FOUNDRY_DIR, 'ui', 'state', 'procedural_recorder.js'), 'utf8');
    const tab6Src = fs.readFileSync(path.join(FOUNDRY_DIR, 'ui', 'tabs', 'tab6_io.js'), 'utf8');
    const mainSrc = fs.readFileSync(path.join(FOUNDRY_DIR, 'ui', 'main.js'), 'utf8');
    const timelineSrc = fs.readFileSync(path.join(FOUNDRY_DIR, 'ui', 'display', 'chain_timeline.js'), 'utf8');
    const cssSrc = fs.readFileSync(path.join(FOUNDRY_DIR, 'ui', 'styles', 'workbench.css'), 'utf8');

    // Air-gap: zero verifier/ imports
    assert.equal(/verifier\//.test(recorderSrc), false, 'procedural_recorder.js must not import verifier/');
    assert.equal(/verifier\//.test(timelineSrc), false, 'chain_timeline.js must not import verifier/');

    // Image 1 fix: never switch active tab during replay
    assert.equal(/\bswitchTab\s*\(/.test(recorderSrc), false, 'procedural_recorder.js must not call switchTab() during replay');
    assert.match(recorderSrc, /restoreActiveTabInPlace/, 'procedural_recorder.js must restore active tab in-place');

    // Image 3 fix: jumpToStage & file load feedback
    assert.match(recorderSrc, /export\s+async\s+function\s+jumpToStage\b|export\s+function\s+jumpToStage\b/, 'procedural_recorder.js must export jumpToStage');
    assert.match(recorderSrc, /export\s+function\s+getActiveStageIndex\b/, 'procedural_recorder.js must export getActiveStageIndex');
    assert.match(tab6Src, /chain-file-input/, 'tab6_io.js must wire #chain-file-input');
    assert.match(tab6Src, /chain-loaded-file-badge/, 'tab6_io.js must display #chain-loaded-file-badge');

    // Image 2 feature: direct-over-viewport frameless clickable stage timeline
    assert.match(timelineSrc, /export\s+function\s+createChainTimeline\b/, 'chain_timeline.js must export createChainTimeline');
    assert.match(timelineSrc, /viewport-chain-timeline/, 'chain_timeline.js must mount #viewport-chain-timeline');
    assert.match(cssSrc, /\.chain-tl-/, 'workbench.css must define .chain-tl-* frameless timeline styles');
    assert.match(cssSrc, /pointer-events:\s*none/, 'workbench.css must keep outer timeline wrapper pointer-events: none');
    assert.match(mainSrc, /createChainTimeline/, 'main.js must wire createChainTimeline');
    assert.match(mainSrc, /jumpToStage/, 'main.js must connect timeline selection to jumpToStage');
});

console.log(`\nSummary: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);

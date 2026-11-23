#!/usr/bin/env node
/**
 * WFC-FDM Foundry — Parallel Parametric Explorer & Multi-Brief Validator
 *
 * Strictly air-gapped: invokes TOPOGEN_FDM_Foundry/run_generator.mjs and
 * TOPOGEN_FDM_Foundry/verifier/verify.mjs exclusively as black-box CLI processes
 * communicating via neutral on-disk artifacts (.topology.json, .mesh.obj, .verdict.json).
 *
 * Usage:
 *   node TOPOGEN_FDM_Foundry/runs/sweep/run_sweep.mjs
 *   node TOPOGEN_FDM_Foundry/runs/sweep/run_sweep.mjs --brief TOPOGEN_FDM_Foundry/briefs/arch_canopy_example.json --out-dir TOPOGEN_FDM_Foundry/runs/sweep/canopy_verified --mode-set canopy
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FOUNDRY_DIR = path.resolve(__dirname, '..', '..');
const GENERATOR_CLI = path.join(FOUNDRY_DIR, 'run_generator.mjs');
const VERIFIER_CLI = path.join(FOUNDRY_DIR, 'verifier', 'verify.mjs');
const INDEX_HTML = path.join(FOUNDRY_DIR, 'index_WFC.html');

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const tok = argv[i];
        if (!tok.startsWith('--')) continue;
        const key = tok.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
            args[key] = true;
        } else {
            args[key] = next;
            i++;
        }
    }
    return args;
}

/**
 * Dynamically discover all TILE_PRESETS defined in TOPOGEN_FDM_Foundry/index_WFC.html
 * so newly added presets from @opt-tiles-fdm are automatically swept.
 */
function discoverPresets(htmlPath) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const startIdx = html.indexOf('const TILE_PRESETS = {');
    if (startIdx === -1) {
        return ['arch_braced', 'diagrid_tower', 'space_frame', 'funnel_vault', 'minimal_frame', 'default_ortho'];
    }
    // Extract balanced braces for TILE_PRESETS object
    let depth = 0;
    let inObj = false;
    let endIdx = startIdx;
    for (let i = startIdx; i < html.length; i++) {
        const ch = html[i];
        if (ch === '{') {
            depth++;
            inObj = true;
        } else if (ch === '}') {
            depth--;
            if (inObj && depth === 0) {
                endIdx = i;
                break;
            }
        }
    }
    const block = html.slice(startIdx, endIdx + 1);
    const presets = [];
    // Top-level keys inside TILE_PRESETS (depth === 1)
    let d = 0;
    let lineStart = 0;
    for (let i = 0; i < block.length; i++) {
        if (block[i] === '\n' || i === block.length - 1) {
            const line = block.slice(lineStart, i + 1);
            if (d === 1) {
                const m = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*\{/);
                if (m) presets.push(m[1]);
            }
            for (const c of line) {
                if (c === '{') d++;
                else if (c === '}') d--;
            }
            lineStart = i + 1;
        }
    }
    return presets.length > 0
        ? presets
        : ['arch_braced', 'diagrid_tower', 'space_frame', 'funnel_vault', 'minimal_frame', 'default_ortho'];
}

function runProcess(cmd, args, timeoutMs = 45000) {
    return new Promise((resolve) => {
        const child = spawn(cmd, args, {
            cwd: path.resolve(FOUNDRY_DIR, '..'),
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        let timedOut = false;

        const timer = setTimeout(() => {
            timedOut = true;
            try { child.kill('SIGKILL'); } catch {}
        }, timeoutMs);

        child.stdout.on('data', (d) => { stdout += d.toString(); });
        child.stderr.on('data', (d) => { stderr += d.toString(); });
        child.on('error', (err) => {
            clearTimeout(timer);
            resolve({ code: -1, stdout, stderr: stderr + '\n' + err.message, timedOut });
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, timedOut });
        });
    });
}

function buildPilotMatrix(presets) {
    const configs = [];
    const seen = new Set();

    function addCfg(cfg) {
        const cb = cfg.columnBoost !== undefined ? cfg.columnBoost : 2.5;
        const key = JSON.stringify([
            cfg.tilePreset,
            cfg.fdmMode,
            cfg.wfcSeed,
            cfg.gridResolution,
            cfg.outerRadiusM,
            cfg.innerRadiusM || 0,
            cfg.qProfile,
            cb
        ]);
        if (seen.has(key)) return;
        seen.add(key);
        const rMm = (cfg.outerRadiusM * 1000).toFixed(1).replace(/\.0$/, '');
        const irMm = ((cfg.innerRadiusM || 0) * 1000).toFixed(1).replace(/\.0$/, '');
        const secTag = (cfg.innerRadiusM || 0) > 0 ? `h${rMm}_${irMm}` : `s${rMm}`;
        const gTag = cfg.gridResolution.join('x');
        const cbTag = cb !== 2.5 ? `__cb${cb}` : '';
        const id = `${cfg.tilePreset}__${cfg.fdmMode}__g${gTag}__sd${cfg.wfcSeed}__${secTag}__${cfg.qProfile}${cbTag}`;
        configs.push({ ...cfg, name: id });
    }

    // 1. All 3 FDM modes x all presets at 2x2x4 (plus 1x1x3 for new single-cell funicular presets)
    const modes = ['compression', 'zero-weight', 'tensile'];
    const newFunicularPresets = new Set(['pilot_champion', 'catenary_quadripod', 'funicular_vault', 'slender_diagrid', 'hyperboloid_tower']);
    for (const tilePreset of presets) {
        const primaryGrid = newFunicularPresets.has(tilePreset) ? [1, 1, 3] : [2, 2, 4];
        for (const fdmMode of modes) {
            addCfg({
                tilePreset,
                fdmMode,
                wfcSeed: 42,
                gridResolution: primaryGrid,
                outerRadiusM: 0.018,
                innerRadiusM: 0,
                qProfile: 'column_boosted'
            });
            if (fdmMode === 'compression') {
                addCfg({
                    tilePreset,
                    fdmMode,
                    wfcSeed: 42,
                    gridResolution: [3, 3, 5],
                    outerRadiusM: 0.018,
                    innerRadiusM: 0,
                    qProfile: 'column_boosted'
                });
            }
        }
    }

    // 2. Force density qProfile comparison (uniform, height_graded, column_boosted, funicular_tuned) & 3x3x6 grid
    const qProfiles = ['uniform', 'height_graded', 'column_boosted', 'funicular_tuned'];
    for (const tilePreset of presets) {
        const primaryGrid = newFunicularPresets.has(tilePreset) ? [1, 1, 3] : [2, 2, 4];
        for (const qProfile of qProfiles) {
            addCfg({
                tilePreset,
                fdmMode: 'compression',
                wfcSeed: 42,
                gridResolution: primaryGrid,
                outerRadiusM: 0.016,
                innerRadiusM: 0,
                qProfile
            });
        }
        addCfg({
            tilePreset,
            fdmMode: 'compression',
            wfcSeed: 42,
            gridResolution: [3, 3, 6],
            outerRadiusM: 0.018,
            innerRadiusM: 0,
            qProfile: 'column_boosted'
        });
    }

    // 3. Multi-seed robustness sweep (seeds 1, 7, 13, 42, 99) across all presets
    const seeds = [1, 7, 13, 42, 99];
    for (const tilePreset of presets) {
        const primaryGrid = newFunicularPresets.has(tilePreset) ? [1, 1, 3] : [2, 2, 4];
        for (const wfcSeed of seeds) {
            addCfg({
                tilePreset,
                fdmMode: 'compression',
                wfcSeed,
                gridResolution: primaryGrid,
                outerRadiusM: 0.016,
                innerRadiusM: 0,
                qProfile: 'column_boosted'
            });
        }
    }

    // 4. Aggressive mass-reduction sweep: slender solid radii (0.012m - 0.035m) + hollow sections
    const solidRadii = [0.012, 0.014, 0.016, 0.020, 0.028, 0.035];
    const hollowSections = [
        [0.0125, 0.0065], // 6mm wall (champion class)
        [0.014, 0.007],   // 7mm wall
        [0.016, 0.009],   // 7mm wall
        [0.018, 0.011],   // 7mm wall
        [0.022, 0.015]    // 7mm wall
    ];
    for (const tilePreset of presets) {
        const grids = newFunicularPresets.has(tilePreset)
            ? [[1, 1, 3], [1, 1, 4], [2, 2, 4]]
            : [[2, 2, 3], [2, 2, 4]];
        for (const gridResolution of grids) {
            for (const r of solidRadii) {
                addCfg({
                    tilePreset,
                    fdmMode: 'compression',
                    wfcSeed: 42,
                    gridResolution,
                    outerRadiusM: r,
                    innerRadiusM: 0,
                    qProfile: 'column_boosted'
                });
            }
            for (const [ro, ri] of hollowSections) {
                addCfg({
                    tilePreset,
                    fdmMode: 'compression',
                    wfcSeed: 42,
                    gridResolution,
                    outerRadiusM: ro,
                    innerRadiusM: ri,
                    qProfile: 'column_boosted'
                });
            }
        }
    }

    // 5. Explicit pilot_champion / catenary_quadripod high-columnBoost verification
    for (const tilePreset of ['pilot_champion', 'catenary_quadripod', 'funicular_vault', 'slender_diagrid', 'hyperboloid_tower']) {
        if (!presets.includes(tilePreset)) continue;
        for (const [ro, ri] of [[0.0125, 0.0065], [0.013, 0.007], [0.014, 0.008]]) {
            addCfg({
                tilePreset,
                fdmMode: 'compression',
                wfcSeed: 42,
                gridResolution: [1, 1, 3],
                outerRadiusM: ro,
                innerRadiusM: ri,
                qProfile: 'column_boosted',
                columnBoost: 4.0
            });
        }
    }

    return configs;
}

function buildCanopyMatrix(presets) {
    const configs = [];
    const seen = new Set();

    function addCfg(cfg) {
        const key = JSON.stringify([
            cfg.tilePreset,
            cfg.fdmMode,
            cfg.wfcSeed,
            cfg.gridResolution,
            cfg.outerRadiusM,
            cfg.innerRadiusM || 0,
            cfg.qProfile
        ]);
        if (seen.has(key)) return;
        seen.add(key);
        const rMm = Math.round(cfg.outerRadiusM * 1000);
        const irMm = Math.round((cfg.innerRadiusM || 0) * 1000);
        const secTag = irMm > 0 ? `h${rMm}_${irMm}` : `s${rMm}`;
        const gTag = cfg.gridResolution.join('x');
        const id = `canopy__${cfg.tilePreset}__${cfg.fdmMode}__g${gTag}__sd${cfg.wfcSeed}__${secTag}__${cfg.qProfile}`;
        configs.push({ ...cfg, name: id });
    }

    // arch_canopy_example.json: 2.0m x 1.0m x 1.2m, allowedModes: compression, zero-weight, minTubeOuterRadiusM: 0.015
    const grids = [[2, 1, 2], [4, 2, 2], [3, 2, 2]];
    const sections = [
        [0.015, 0],
        [0.018, 0],
        [0.016, 0.009],
        [0.018, 0.011]
    ];

    for (const tilePreset of presets) {
        for (const gridResolution of grids) {
            for (const [ro, ri] of sections) {
                addCfg({
                    tilePreset,
                    fdmMode: 'compression',
                    wfcSeed: 42,
                    gridResolution,
                    outerRadiusM: ro,
                    innerRadiusM: ri,
                    qProfile: 'column_boosted'
                });
            }
        }
        // Also sample zero-weight mode on each preset for mode comparison
        addCfg({
            tilePreset,
            fdmMode: 'zero-weight',
            wfcSeed: 42,
            gridResolution: [4, 2, 2],
            outerRadiusM: 0.018,
            innerRadiusM: 0,
            qProfile: 'column_boosted'
        });
    }
    return configs;
}

function classifyFailureModes(verdict, runError) {
    const modes = new Set();
    if (runError) {
        modes.add(runError);
        return [...modes];
    }
    if (!verdict) {
        modes.add('missing_verdict');
        return [...modes];
    }
    if (verdict.passed) return [];

    const fab = verdict.fabrication?.checks || {};
    if (fab.connectivity && !fab.connectivity.passed) modes.add('disconnected_graph');
    if (fab.anchors && !fab.anchors.passed) modes.add('anchor_violation');
    if (fab.envelope && !fab.envelope.passed) modes.add('envelope_violation');
    if (fab.members && !fab.members.passed) {
        if ((fab.members.slenderEdgeCount || 0) > 0) modes.add('slenderness_limit');
        if ((fab.members.shortEdgeCount || 0) > 0) modes.add('short_member_limit');
        if ((fab.members.radiusViolationCount || 0) > 0) modes.add('radius_limit');
        if ((fab.members.wallViolationCount || 0) > 0) modes.add('wall_thickness_limit');
    }
    if (fab.funicularMetadata && !fab.funicularMetadata.passed) {
        if (fab.funicularMetadata.modeOk === false) modes.add('disallowed_fdm_mode');
        if (fab.funicularMetadata.resOk === false) modes.add('fdm_residual_limit');
    }
    if (fab.mesh && !fab.mesh.passed) modes.add('mesh_non_manifold');

    for (const lc of verdict.loadCases || []) {
        if (lc.passed) continue;
        const c = lc.criteria || {};
        if (c.equilibrium && !c.equilibrium.passed) modes.add('fea_equilibrium_or_singular');
        if ((c.deflectionRatio && !c.deflectionRatio.passed) || (c.maxDeflectionM && !c.maxDeflectionM.passed)) {
            modes.add('deflection_L300');
        }
        if (c.tensileSafetyFactor && !c.tensileSafetyFactor.passed) modes.add('tensile_bending');
        if (c.compressiveSafetyFactor && !c.compressiveSafetyFactor.passed) modes.add('compressive_strength');
        if (c.bucklingSafetyFactor && !c.bucklingSafetyFactor.passed) modes.add('euler_buckling');
    }

    if (modes.size === 0 && Array.isArray(verdict.failureReasons) && verdict.failureReasons.length > 0) {
        modes.add('other_failure');
    }
    return [...modes];
}

function extractMetrics(cfg, verdict, brief) {
    const geom = verdict.geometry || {};
    const fab = verdict.fabrication?.checks || {};
    const lcs = verdict.loadCases || [];
    // Governing load case: the loaded case (typically LC2) or last load case
    const lcGov = lcs.find(lc => (lc.loads?.totalDistributedLoadN || 0) > 0) || lcs[lcs.length - 1] || {};
    const lc1 = lcs[0] || {};

    let imposedLoadKg = 0;
    for (const lc of brief.loadCases || []) {
        if ((lc.distributedVerticalMassKg || 0) > imposedLoadKg) {
            imposedLoadKg = lc.distributedVerticalMassKg;
        }
    }

    const massKg = Number(geom.totalMassKg || 0);
    const meshMassKg = geom.meshMassKg !== undefined && geom.meshMassKg !== null
        ? Number(geom.meshMassKg)
        : null;
    const kpis = verdict.kpis || lcGov.kpis || {};
    const loadToMass = kpis.loadToMassRatio !== undefined
        ? Number(kpis.loadToMassRatio)
        : (massKg > 0 && imposedLoadKg > 0 ? imposedLoadKg / massKg : 0);
    const loadToMeshMass = kpis.loadToMeshMassRatio !== undefined && kpis.loadToMeshMassRatio !== null
        ? Number(kpis.loadToMeshMassRatio)
        : (meshMassKg && meshMassKg > 0 && imposedLoadKg > 0 ? imposedLoadKg / meshMassKg : null);

    const maxTensileMPa = Number(lcGov.stresses?.maxTensileMPa ?? 0);
    const maxCompressiveMPa = Number(lcGov.stresses?.maxCompressiveMPa ?? 0);
    // Prefer verifier's official bending-vs-axial funicularEfficiency KPI when available
    const funicularEfficiency = kpis.funicularEfficiency !== undefined && kpis.funicularEfficiency !== null
        ? Number(kpis.funicularEfficiency)
        : ((maxCompressiveMPa + maxTensileMPa) > 1e-9
            ? maxCompressiveMPa / (maxCompressiveMPa + maxTensileMPa)
            : 0);
    const compressionDominance = kpis.compressionDominance !== undefined && kpis.compressionDominance !== null
        ? Number(kpis.compressionDominance)
        : null;
    const minIncidentAngleDeg = fab.members?.minIncidentAngleDeg ?? kpis.minIncidentAngleDeg ?? null;
    const lateral = verdict.lateralStabilityAdvisory || null;

    const sfTension = Number(lcGov.safetyFactors?.tension ?? 0);
    const sfCompression = Number(lcGov.safetyFactors?.compression ?? 0);
    const sfBuckling = Number(lcGov.safetyFactors?.buckling ?? 0);
    const minSafetyFactor = Math.min(sfTension, sfCompression, sfBuckling);

    const maxDispMm = Number(lcGov.displacements?.maxDispMm ?? 0);
    const deflRatio = Number(lcGov.displacements?.deflectionRatio ?? 0);
    const deflInverseN = lcGov.criteria?.deflectionRatio?.inverseRatio
        ?? (deflRatio > 1e-12 ? Math.round(1 / deflRatio) : 0);

    return {
        name: cfg.name,
        passed: Boolean(verdict.passed),
        config: {
            tilePreset: cfg.tilePreset,
            fdmMode: cfg.fdmMode,
            wfcSeed: cfg.wfcSeed,
            gridResolution: cfg.gridResolution,
            outerRadiusM: cfg.outerRadiusM,
            innerRadiusM: cfg.innerRadiusM || 0,
            qProfile: cfg.qProfile,
            ...(cfg.columnBoost !== undefined ? { columnBoost: cfg.columnBoost } : {})
        },
        massKg: Number(massKg.toFixed(4)),
        meshMassKg: meshMassKg !== null ? Number(meshMassKg.toFixed(4)) : null,
        loadToMassRatio: Number(loadToMass.toFixed(4)),
        loadToMeshMassRatio: loadToMeshMass !== null ? Number(loadToMeshMass.toFixed(4)) : null,
        funicularEfficiency: Number(funicularEfficiency.toFixed(4)),
        compressionDominance: compressionDominance !== null ? Number(compressionDominance.toFixed(4)) : null,
        sfTension: Number(sfTension.toFixed(3)),
        sfCompression: Number(sfCompression.toFixed(3)),
        sfBuckling: Number(sfBuckling.toFixed(3)),
        minSafetyFactor: Number(minSafetyFactor.toFixed(3)),
        maxDispMm: Number(maxDispMm.toFixed(4)),
        deflectionRatio: Number(deflRatio.toFixed(7)),
        deflectionInverseN: deflInverseN,
        lc1MaxDispMm: Number((lc1.displacements?.maxDispMm ?? 0).toFixed(4)),
        lateralMaxDriftMm: lateral?.maxLateralDriftMm !== undefined ? Number(Number(lateral.maxLateralDriftMm).toFixed(4)) : null,
        lateralMinSF: lateral?.minSafetyFactor !== undefined ? Number(Number(lateral.minSafetyFactor).toFixed(3)) : null,
        minIncidentAngleDeg: minIncidentAngleDeg !== null ? Number(Number(minIncidentAngleDeg).toFixed(2)) : null,
        nNodes: geom.nNodes || 0,
        nEdges: geom.nEdges || 0,
        nAnchors: geom.nAnchors || 0,
        spanX: Number((geom.spanX || 0).toFixed(4)),
        spanY: Number((geom.spanY || 0).toFixed(4)),
        heightZ: Number((geom.spanZ || 0).toFixed(4)),
        maxSlenderness: Number((fab.members?.maxSlendernessRatio || 0).toFixed(2)),
        minMemberLenM: Number((fab.members?.minMemberLengthM || 0).toFixed(4)),
        watertightManifold: Boolean(fab.mesh?.isWatertightManifold),
        boundaryEdges: fab.mesh?.boundaryEdges ?? null,
        nonManifoldEdges: fab.mesh?.nonManifoldEdges ?? null,
        fdmResidual: fab.funicularMetadata?.equilibriumResidual ?? null,
        failureModes: classifyFailureModes(verdict, null),
        failureReasons: verdict.failureReasons || []
    };
}

async function evaluateCandidate(cfg, briefPath, brief, workDir, keepAllArtifacts) {
    const cfgPath = path.join(workDir, `${cfg.name}.config.json`);
    const topoPath = path.join(workDir, `${cfg.name}.topology.json`);
    const objPath = path.join(workDir, `${cfg.name}.mesh.obj`);
    const verdictPath = path.join(workDir, `${cfg.name}.verdict.json`);

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');

    const genRes = await runProcess('node', [
        GENERATOR_CLI,
        '--brief', briefPath,
        '--config', cfgPath,
        '--out-dir', workDir,
        '--name', cfg.name
    ]);

    if (genRes.code !== 0 || !fs.existsSync(topoPath) || !fs.existsSync(objPath)) {
        // Cleanup partial files
        for (const p of [cfgPath, topoPath, objPath]) {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
        }
        return {
            name: cfg.name,
            passed: false,
            config: {
                tilePreset: cfg.tilePreset,
                fdmMode: cfg.fdmMode,
                wfcSeed: cfg.wfcSeed,
                gridResolution: cfg.gridResolution,
                outerRadiusM: cfg.outerRadiusM,
                innerRadiusM: cfg.innerRadiusM || 0,
                qProfile: cfg.qProfile
            },
            failureModes: [genRes.timedOut ? 'generator_timeout' : 'generator_error'],
            failureReasons: [(genRes.stderr || genRes.stdout || 'Generator failed').trim().slice(0, 300)]
        };
    }

    const verRes = await runProcess('node', [
        VERIFIER_CLI,
        '--topology', topoPath,
        '--mesh', objPath,
        '--brief', briefPath,
        '--out', verdictPath
    ]);

    if (!fs.existsSync(verdictPath)) {
        for (const p of [cfgPath, topoPath, objPath]) {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
        }
        return {
            name: cfg.name,
            passed: false,
            config: {
                tilePreset: cfg.tilePreset,
                fdmMode: cfg.fdmMode,
                wfcSeed: cfg.wfcSeed,
                gridResolution: cfg.gridResolution,
                outerRadiusM: cfg.outerRadiusM,
                innerRadiusM: cfg.innerRadiusM || 0,
                qProfile: cfg.qProfile
            },
            failureModes: [verRes.timedOut ? 'verifier_timeout' : 'verifier_error'],
            failureReasons: [(verRes.stderr || verRes.stdout || 'Verifier failed').trim().slice(0, 300)]
        };
    }

    const verdict = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
    const entry = extractMetrics(cfg, verdict, brief);

    // Clean up bulky intermediate files for failed runs (and non-kept runs) to keep disk tidy
    if (!keepAllArtifacts) {
        for (const p of [cfgPath, topoPath, objPath, verdictPath]) {
            try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch {}
        }
    }

    return entry;
}

async function runPool(items, concurrency, fn) {
    const results = new Array(items.length);
    let nextIdx = 0;
    let doneCount = 0;

    async function worker() {
        while (true) {
            const idx = nextIdx++;
            if (idx >= items.length) break;
            results[idx] = await fn(items[idx], idx);
            doneCount++;
            if (doneCount % 25 === 0 || doneCount === items.length) {
                process.stderr.write(`[sweep] progress ${doneCount}/${items.length}\n`);
            }
        }
    }

    const workers = [];
    for (let i = 0; i < Math.min(concurrency, items.length); i++) {
        workers.push(worker());
    }
    await Promise.all(workers);
    return results;
}

function computeParetoFront(passing) {
    // Non-dominated front optimizing: minimize massKg, maximize minSafetyFactor, maximize funicularEfficiency, minimize maxDispMm
    const front = [];
    for (const a of passing) {
        let dominated = false;
        for (const b of passing) {
            if (a === b) continue;
            const bBetterOrEq =
                b.massKg <= a.massKg &&
                b.minSafetyFactor >= a.minSafetyFactor &&
                b.funicularEfficiency >= a.funicularEfficiency &&
                b.maxDispMm <= a.maxDispMm;
            const bStrictlyBetter =
                b.massKg < a.massKg ||
                b.minSafetyFactor > a.minSafetyFactor ||
                b.funicularEfficiency > a.funicularEfficiency ||
                b.maxDispMm < a.maxDispMm;
            if (bBetterOrEq && bStrictlyBetter) {
                dominated = true;
                break;
            }
        }
        if (!dominated) front.push(a);
    }
    return front.sort((x, y) => x.massKg - y.massKg);
}

function summarizeGroup(results, keyFn) {
    const groups = new Map();
    for (const r of results) {
        const k = keyFn(r);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(r);
    }
    const out = {};
    for (const [k, list] of groups.entries()) {
        const pass = list.filter(x => x.passed);
        pass.sort((a, b) => a.massKg - b.massKg);
        const best = pass[0] || null;
        out[k] = {
            total: list.length,
            passed: pass.length,
            passRatePct: Number(((pass.length / list.length) * 100).toFixed(1)),
            bestMassKg: best ? best.massKg : null,
            bestLoadToMass: best ? best.loadToMassRatio : null,
            bestFunicularEff: best ? best.funicularEfficiency : null,
            bestSfTension: best ? best.sfTension : null,
            bestSfBuckling: best ? best.sfBuckling : null,
            bestDeflectionInverseN: best ? best.deflectionInverseN : null,
            bestCandidate: best ? best.name : null
        };
    }
    return out;
}

async function materializeBestArtifacts(bestEntry, briefPath, outDir, prefix = 'champion') {
    if (!bestEntry) return null;
    fs.mkdirSync(outDir, { recursive: true });
    const cfg = { ...bestEntry.config, name: prefix };
    const cfgPath = path.join(outDir, `${prefix}.config.json`);
    const topoPath = path.join(outDir, `${prefix}.topology.json`);
    const objPath = path.join(outDir, `${prefix}.mesh.obj`);
    const verdictPath = path.join(outDir, `${prefix}.verdict.json`);

    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    const genRes = await runProcess('node', [
        GENERATOR_CLI,
        '--brief', briefPath,
        '--config', cfgPath,
        '--out-dir', outDir,
        '--name', prefix
    ]);
    if (genRes.code !== 0) {
        throw new Error(`Failed to materialize ${prefix}: ${genRes.stderr}`);
    }
    await runProcess('node', [
        VERIFIER_CLI,
        '--topology', topoPath,
        '--mesh', objPath,
        '--brief', briefPath,
        '--out', verdictPath
    ]);
    return { cfgPath, topoPath, objPath, verdictPath };
}

async function main() {
    const t0 = Date.now();
    const args = parseArgs(process.argv.slice(2));

    const briefPath = args.brief
        ? path.resolve(process.cwd(), args.brief)
        : path.join(FOUNDRY_DIR, 'briefs', 'pilot_brief.json');
    const brief = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
    const outDir = args['out-dir']
        ? path.resolve(process.cwd(), args['out-dir'])
        : __dirname;
    const modeSet = args['mode-set'] || (brief.id && brief.id.includes('canopy') ? 'canopy' : 'pilot');
    const concurrency = Number(args.concurrency || 8);

    fs.mkdirSync(outDir, { recursive: true });
    const scratchDir = path.join(outDir, '_tmp_eval');
    fs.mkdirSync(scratchDir, { recursive: true });

    const presets = discoverPresets(INDEX_HTML);
    const matrix = modeSet === 'canopy' ? buildCanopyMatrix(presets) : buildPilotMatrix(presets);

    process.stderr.write(`[sweep] brief=${brief.id} presets=[${presets.join(', ')}] candidates=${matrix.length} concurrency=${concurrency}\n`);

    const results = await runPool(matrix, concurrency, (cfg) =>
        evaluateCandidate(cfg, briefPath, brief, scratchDir, false)
    );

    // Clean up scratch directory
    try { fs.rmSync(scratchDir, { recursive: true, force: true }); } catch {}

    const passing = results.filter(r => r.passed);
    const failing = results.filter(r => !r.passed);

    // Failure mode histogram
    const failureModeCounts = {};
    for (const r of failing) {
        for (const m of r.failureModes || ['unknown']) {
            failureModeCounts[m] = (failureModeCounts[m] || 0) + 1;
        }
    }
    const topFailureModes = Object.entries(failureModeCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([mode, count]) => ({
            mode,
            count,
            pctOfFailures: Number(((count / Math.max(1, failing.length)) * 100).toFixed(1))
        }));

    // Rankings
    const byLowestMass = [...passing].sort((a, b) => a.massKg - b.massKg);
    const byHighestLoadToMass = [...passing].sort((a, b) => b.loadToMassRatio - a.loadToMassRatio);
    const byHighestFunicularEff = [...passing].sort((a, b) =>
        (b.funicularEfficiency - a.funicularEfficiency) || (a.massKg - b.massKg)
    );
    const byBestDeflection = [...passing].sort((a, b) => b.deflectionInverseN - a.deflectionInverseN);
    const paretoFront = computeParetoFront(passing);

    // Materialize best verified design artifacts
    let bestArtifacts = null;
    if (byLowestMass.length > 0) {
        const artifactPrefix = modeSet === 'canopy' ? 'canopy_best' : 'sweep_best';
        const artifactDir = modeSet === 'canopy' ? outDir : path.join(outDir, 'best_verified');
        bestArtifacts = await materializeBestArtifacts(byLowestMass[0], briefPath, artifactDir, artifactPrefix);
    }

    const elapsedSec = Number(((Date.now() - t0) / 1000).toFixed(2));
    const summary = {
        timestamp: new Date().toISOString(),
        briefId: brief.id,
        briefName: brief.name,
        modeSet,
        elapsedSec,
        discoveredPresets: presets,
        totals: {
            evaluated: results.length,
            passed: passing.length,
            failed: failing.length,
            passRatePct: Number(((passing.length / Math.max(1, results.length)) * 100).toFixed(1)),
            paretoFrontCount: paretoFront.length
        },
        modeComparison: summarizeGroup(results, r => r.config.fdmMode),
        presetComparison: summarizeGroup(results, r => r.config.tilePreset),
        qProfileComparison: summarizeGroup(results, r => r.config.qProfile),
        gridComparison: summarizeGroup(results, r => r.config.gridResolution.join('x')),
        topFailureModes,
        bestArtifacts,
        rankings: {
            lowestMassTop15: byLowestMass.slice(0, 15),
            highestLoadToMassTop10: byHighestLoadToMass.slice(0, 10),
            highestFunicularEfficiencyTop10: byHighestFunicularEff.slice(0, 10),
            bestDeflectionTop10: byBestDeflection.slice(0, 10)
        },
        paretoFront,
        allResultsCount: results.length
    };

    const summaryPath = path.join(outDir, 'pareto_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');

    console.log(JSON.stringify({
        status: 'ok',
        summaryPath,
        elapsedSec,
        totals: summary.totals,
        bestOverall: byLowestMass[0] || null,
        modeComparison: summary.modeComparison,
        topFailureModes: summary.topFailureModes.slice(0, 8)
    }, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});

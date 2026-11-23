#!/usr/bin/env node
/**
 * WFC-FDM Foundry — Headless Generator CLI & Warm Batch Runner
 *
 * Imports pure-JS ES modules directly from `./core/index.mjs` (zero HTML regex / VM overhead).
 * Strictly air-gapped: zero external FEA audit imports.
 *
 * Usage (Single Candidate):
 *   node WFC_FDM_Foundry/run_generator.mjs \
 *     --brief WFC_FDM_Foundry/briefs/pilot_brief.json \
 *     [--config config.json] \
 *     --out-dir WFC_FDM_Foundry/runs/smoke \
 *     --name baseline
 *
 * Usage (Warm Batch JSON File):
 *   node WFC_FDM_Foundry/run_generator.mjs --batch batch.json
 *   // batch.json: { "briefPath": "...", "items": [{ "config": {...}, "outDir": "...", "name": "c01" }] }
 *
 * Usage (Persistent Warm JSONL Stream over stdin):
 *   node WFC_FDM_Foundry/run_generator.mjs --stdin-jsonl
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { WFC_FDM_CORE, loadWfcCore } from './core/index.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export { WFC_FDM_CORE, loadWfcCore };

export function parseArgs(argv) {
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

function parseBoolArg(val) {
    return (val === false || val === 'false' || val === '0') ? false : true;
}

export function applyCliOverridesToConfig(config, args) {
    if (args.name) config.name = String(args.name);
    if (!config.name) config.name = 'candidate';
    if (args.seed !== undefined) config.wfcSeed = Number(args.seed);
    if (args.preset) config.tilePreset = String(args.preset);
    if (args.mode) config.fdmMode = String(args.mode);
    if (args.radius !== undefined) config.outerRadiusM = Number(args.radius);
    if (args['inner-radius'] !== undefined) config.innerRadiusM = Number(args['inner-radius']);
    if (args.sides !== undefined) config.nSides = Number(args.sides);
    if (args['q-profile']) config.qProfile = String(args['q-profile']);
    if (args['q-base'] !== undefined) config.qBase = Number(args['q-base']);
    if (args['column-boost'] !== undefined) config.columnBoost = Number(args['column-boost']);
    if (args['anchor-boost'] !== undefined) config.anchorBoost = Number(args['anchor-boost']);
    if (args['collar-boost'] !== undefined) config.collarBoost = Number(args['collar-boost']);
    if (args['top-collar-boost'] !== undefined) config.topCollarBoost = Number(args['top-collar-boost']);
    if (args['optimize-fdm']) config.optimizeForceDensities = true;
    if (args.subdiv !== undefined) config.longitudinalSubdivLevels = Number(args.subdiv);
    if (args.pq !== undefined) config.pqOptimization = parseBoolArg(args.pq);
    if (args['max-pq-error'] !== undefined) config.maxQuadPlanarityErrorM = Number(args['max-pq-error']);
    if (args.unroll !== undefined) config.unrollPatterns = parseBoolArg(args.unroll);
    if (args['prune-tension'] !== undefined) config.pruneTension = parseBoolArg(args['prune-tension']);
    if (args['min-angle'] !== undefined) config.minIncidentAngleDeg = Number(args['min-angle']);
    if (args['ensure-lateral'] !== undefined) config.ensureLateralSF = parseBoolArg(args['ensure-lateral']);
    if (args['auto-slenderness'] !== undefined) config.autoSlenderness = parseBoolArg(args['auto-slenderness']);
    if (args['equalize-lengths'] !== undefined) config.equalizeEdgeLengths = parseBoolArg(args['equalize-lengths']);
    if (args.grid) {
        const parts = String(args.grid).split(/[x,]/i).map(Number);
        if (parts.length === 3 && parts.every(n => Number.isFinite(n) && n >= 1)) {
            config.gridResolution = parts;
        }
    }
    return config;
}

export function writeCandidateArtifacts(result, config, outDir, briefPath = null) {
    const resolvedOutDir = path.resolve(process.cwd(), outDir || path.join('WFC_FDM_Foundry', 'runs', 'default'));
    fs.mkdirSync(resolvedOutDir, { recursive: true });

    const candName = config.name || 'candidate';
    const topoPath = path.join(resolvedOutDir, `${candName}.topology.json`);
    const objPath = path.join(resolvedOutDir, `${candName}.mesh.obj`);
    const cfgOutPath = path.join(resolvedOutDir, `${candName}.config.json`);

    fs.writeFileSync(topoPath, JSON.stringify(result.topologyJson, null, 2) + '\n', 'utf8');
    fs.writeFileSync(objPath, result.objText, 'utf8');

    const cfgPayload = Object.assign(
        briefPath ? { brief: path.relative(process.cwd(), briefPath).replace(/\\/g, '/') } : {},
        config,
        {
            name: candName,
            gridResolution: result.topologyJson.metadata.gridResolution,
            outerRadiusM: result.topologyJson.section.outerRadiusM,
            innerRadiusM: result.topologyJson.section.innerRadiusM
        }
    );
    fs.writeFileSync(cfgOutPath, JSON.stringify(cfgPayload, null, 2) + '\n', 'utf8');

    const outputs = {
        topology: topoPath,
        meshObj: objPath,
        configJson: cfgOutPath
    };

    if (result.patternsSvg && result.unrolledJson) {
        const svgPath = path.join(resolvedOutDir, `${candName}.patterns.svg`);
        const unrollPath = path.join(resolvedOutDir, `${candName}.unrolled.json`);
        fs.writeFileSync(svgPath, result.patternsSvg, 'utf8');
        fs.writeFileSync(unrollPath, JSON.stringify(result.unrolledJson, null, 2) + '\n', 'utf8');
        outputs.patternsSvg = svgPath;
        outputs.unrolledJson = unrollPath;
    }

    return outputs;
}

export function runBatchGeneration(batchSpec, defaultBriefPath = null) {
    const baseBriefPath = batchSpec.briefPath
        ? path.resolve(process.cwd(), batchSpec.briefPath)
        : defaultBriefPath;
    const baseBrief = batchSpec.brief
        ? batchSpec.brief
        : (baseBriefPath && fs.existsSync(baseBriefPath)
            ? JSON.parse(fs.readFileSync(baseBriefPath, 'utf8'))
            : {});

    const items = Array.isArray(batchSpec.items) ? batchSpec.items : [];
    const results = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i] || {};
        const itemBriefPath = item.briefPath ? path.resolve(process.cwd(), item.briefPath) : baseBriefPath;
        const itemBrief = item.brief
            ? item.brief
            : (item.briefPath && fs.existsSync(itemBriefPath)
                ? JSON.parse(fs.readFileSync(itemBriefPath, 'utf8'))
                : baseBrief);

        const cfg = Object.assign({}, item.config || {});
        if (item.name) cfg.name = String(item.name);
        if (!cfg.name) cfg.name = `cand_${String(i).padStart(3, '0')}`;

        try {
            const gen = WFC_FDM_CORE.generateCandidate(itemBrief, cfg);
            const outDir = item.outDir || batchSpec.outDir || path.join('WFC_FDM_Foundry', 'runs', 'batch');
            const outputs = item.writeDisk === false
                ? null
                : writeCandidateArtifacts(gen, cfg, outDir, itemBriefPath);
            results.push({
                status: 'ok',
                name: cfg.name,
                outputs,
                metrics: gen.metrics
            });
        } catch (err) {
            results.push({
                status: 'error',
                name: cfg.name,
                error: err && err.message ? err.message : String(err)
            });
        }
    }

    return {
        status: 'ok',
        count: results.length,
        results
    };
}

async function runStdinJsonlLoop(defaultBriefPath) {
    const briefCache = new Map();
    const getBrief = (bPath, inlineBrief) => {
        if (inlineBrief && typeof inlineBrief === 'object') return inlineBrief;
        const resolved = bPath ? path.resolve(process.cwd(), bPath) : defaultBriefPath;
        if (!resolved || !fs.existsSync(resolved)) return {};
        if (!briefCache.has(resolved)) {
            briefCache.set(resolved, JSON.parse(fs.readFileSync(resolved, 'utf8')));
        }
        return briefCache.get(resolved);
    };

    const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
    for await (const rawLine of rl) {
        const line = rawLine.trim();
        if (!line) continue;
        let req = null;
        try {
            req = JSON.parse(line);
            if (req.cmd === 'exit' || req.cmd === 'quit') break;
            const bPath = req.briefPath ? path.resolve(process.cwd(), req.briefPath) : defaultBriefPath;
            const brief = getBrief(req.briefPath, req.brief);
            const cfg = Object.assign({}, req.config || {});
            if (req.name) cfg.name = String(req.name);
            if (!cfg.name) cfg.name = 'candidate';

            const gen = WFC_FDM_CORE.generateCandidate(brief, cfg);
            const outputs = req.writeDisk === false
                ? null
                : writeCandidateArtifacts(gen, cfg, req.outDir, bPath);
            process.stdout.write(JSON.stringify({
                id: req.id ?? null,
                status: 'ok',
                name: cfg.name,
                outputs,
                metrics: gen.metrics
            }) + '\n');
        } catch (err) {
            process.stdout.write(JSON.stringify({
                id: req && req.id !== undefined ? req.id : null,
                status: 'error',
                error: err && err.message ? err.message : String(err)
            }) + '\n');
        }
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const defaultBriefPath = args.brief
        ? path.resolve(process.cwd(), args.brief)
        : path.join(__dirname, 'briefs', 'pilot_brief.json');

    // Mode 1: Persistent warm JSONL stream over stdin
    if (args['stdin-jsonl']) {
        await runStdinJsonlLoop(defaultBriefPath);
        return;
    }

    // Mode 2: Warm batch JSON file (--batch <batch.json>)
    if (args.batch) {
        const batchPath = path.resolve(process.cwd(), String(args.batch));
        const batchSpec = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
        const summary = runBatchGeneration(batchSpec, args.brief ? defaultBriefPath : null);
        console.log(JSON.stringify(summary, null, 2));
        return;
    }

    // Mode 3: Standard single-candidate CLI execution (100% backward-compatible)
    const brief = fs.existsSync(defaultBriefPath)
        ? JSON.parse(fs.readFileSync(defaultBriefPath, 'utf8'))
        : {};

    let config = {};
    if (args.config) {
        const cfgPath = path.resolve(process.cwd(), args.config);
        config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    }
    applyCliOverridesToConfig(config, args);

    const result = WFC_FDM_CORE.generateCandidate(brief, config);
    const outputs = writeCandidateArtifacts(result, config, args['out-dir'], defaultBriefPath);

    console.log(JSON.stringify({
        status: 'ok',
        outputs,
        metrics: result.metrics
    }, null, 2));
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isDirectRun) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}

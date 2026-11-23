import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'WFC_FDM_Foundry/runs/opt_lab/search';
fs.mkdirSync(outDir, { recursive: true });

const configs = [];
const presetsGrids = [
    ['catenary_quadripod', '1x1x3'],
    ['catenary_quadripod', '1x1x4'],
    ['catenary_quadripod', '1x1x5'],
    ['funicular_vault', '1x1x3'],
    ['funicular_vault', '1x1x4'],
    ['hyperboloid_tower', '1x1x3'],
    ['hyperboloid_tower', '1x1x4'],
    ['slender_diagrid', '2x2x3'],
    ['slender_diagrid', '2x2x4'],
    ['minimal_frame', '2x2x4']
];

const sections = [
    { tag: 'h12_6', ro: 0.012, ri: 0.006 },
    { tag: 'h13_7', ro: 0.013, ri: 0.007 },
    { tag: 'h14_8', ro: 0.014, ri: 0.008 },
    { tag: 'h15_9', ro: 0.015, ri: 0.009 },
    { tag: 'h16_10', ro: 0.016, ri: 0.010 },
    { tag: 's12', ro: 0.012, ri: 0.0 },
    { tag: 's14', ro: 0.014, ri: 0.0 },
    { tag: 's16', ro: 0.016, ri: 0.0 }
];

const profiles = ['funicular_tuned', 'column_boosted'];

for (const [preset, grid] of presetsGrids) {
    for (const sec of sections) {
        for (const qProfile of profiles) {
            configs.push({
                name: `${preset}_${grid}_${sec.tag}_${qProfile === 'funicular_tuned' ? 'ft' : 'cb'}`,
                preset, grid, ro: sec.ro, ri: sec.ri, qProfile
            });
        }
    }
}

const passed = [];
let total = 0;
let meshFails = 0;

for (const c of configs) {
    total++;
    const topo = path.join(outDir, `${c.name}.topology.json`);
    const mesh = path.join(outDir, `${c.name}.mesh.obj`);
    const verdict = path.join(outDir, `${c.name}.verdict.json`);
    try {
        const genArgs = [
            'WFC_FDM_Foundry/run_generator.mjs',
            '--brief', 'WFC_FDM_Foundry/briefs/pilot_brief.json',
            '--out-dir', outDir,
            '--name', c.name,
            '--preset', c.preset,
            '--grid', c.grid,
            '--radius', String(c.ro),
            '--inner-radius', String(c.ri),
            '--q-profile', c.qProfile,
            '--seed', '42'
        ];
        if (c.qProfile === 'funicular_tuned') genArgs.push('--optimize-fdm');
        execFileSync('node', genArgs, { stdio: 'pipe' });
        try {
            execFileSync('node', [
                'WFC_FDM_Foundry/verifier/verify.mjs',
                '--topology', topo,
                '--mesh', mesh,
                '--brief', 'WFC_FDM_Foundry/briefs/pilot_brief.json',
                '--out', verdict
            ], { stdio: 'pipe' });
        } catch (e) {}

        const v = JSON.parse(fs.readFileSync(verdict, 'utf8'));
        if (!v.fabrication.checks.mesh.passed) meshFails++;
        if (v.passed) {
            const lc2 = v.loadCases.find(l => l.id === 'LC2_self_weight_plus_50kg');
            const mem = v.fabrication.checks.members;
            passed.push({
                name: c.name,
                preset: c.preset,
                grid: c.grid,
                ro: c.ro,
                ri: c.ri,
                qProfile: c.qProfile,
                massKg: v.geometry.totalMassKg,
                loadToMass: 50.0 / v.geometry.totalMassKg,
                nodes: v.geometry.nNodes,
                edges: v.geometry.nEdges,
                slend: mem.maxSlendernessRatio,
                dispMm: lc2.displacements.maxDispMm,
                invDefl: lc2.criteria.deflectionRatio.inverseRatio,
                sfTens: lc2.safetyFactors.tension,
                sfComp: lc2.safetyFactors.compression,
                sfBuck: lc2.safetyFactors.buckling,
                compFrac: lc2.criteria.bucklingSafetyFactor.compressedMemberCount / v.geometry.nEdges
            });
        }
    } catch (e) {}
}

passed.sort((a, b) => a.massKg - b.massKg);
console.log(`Tested ${total} configs | Passed: ${passed.length} (${(100 * passed.length / total).toFixed(1)}%) | Mesh fails: ${meshFails}`);
console.log('\nTOP 20 LIGHTEST PASSING DESIGNS:');
for (const r of passed.slice(0, 20)) {
    console.log(
        r.name.padEnd(36),
        `${r.massKg.toFixed(2).padStart(6)}kg`,
        `(${r.loadToMass.toFixed(2)}x)`,
        `V=${String(r.nodes).padStart(2)} E=${String(r.edges).padStart(2)}`,
        `slend=${r.slend.toFixed(1).padStart(5)}`,
        `disp=${r.dispMm.toFixed(3)}mm (L/${r.invDefl})`,
        `SFt=${Math.min(999, r.sfTens).toFixed(1).padStart(5)}`,
        `SFc=${r.sfComp.toFixed(1).padStart(5)}`,
        `SFb=${r.sfBuck.toFixed(1).padStart(5)}`,
        `comp=${(100 * r.compFrac).toFixed(0)}%`
    );
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify({ total, passedCount: passed.length, meshFails, passed }, null, 2));

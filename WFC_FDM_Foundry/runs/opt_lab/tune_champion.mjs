import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'WFC_FDM_Foundry/runs/opt_lab/tune';
fs.mkdirSync(outDir, { recursive: true });

const configs = [];
const presets = [
    ['catenary_quadripod', '1x1x3'],
    ['catenary_quadripod', '1x1x4'],
    ['funicular_vault', '1x1x3'],
    ['slender_diagrid', '2x2x3']
];
const sections = [
    { tag: 'h12_6', ro: 0.012, ri: 0.006 },
    { tag: 'h13_7', ro: 0.013, ri: 0.007 },
    { tag: 'h14_8', ro: 0.014, ri: 0.008 },
    { tag: 's15', ro: 0.015, ri: 0.0 }
];
const boosts = [2.5, 4.0, 6.0, 10.0];
const profiles = ['column_boosted', 'funicular_tuned'];

for (const [preset, grid] of presets) {
    for (const sec of sections) {
        for (const cb of boosts) {
            for (const qProfile of profiles) {
                configs.push({
                    name: `${preset.slice(0,3)}_${grid}_${sec.tag}_c${cb}_${qProfile === 'funicular_tuned' ? 'ft' : 'cb'}`,
                    preset, grid, ro: sec.ro, ri: sec.ri, columnBoost: cb, qProfile
                });
            }
        }
    }
}

const results = [];
for (const c of configs) {
    const topo = path.join(outDir, `${c.name}.topology.json`);
    const mesh = path.join(outDir, `${c.name}.mesh.obj`);
    const verdict = path.join(outDir, `${c.name}.verdict.json`);
    try {
        const args = [
            'WFC_FDM_Foundry/run_generator.mjs',
            '--brief', 'WFC_FDM_Foundry/briefs/pilot_brief.json',
            '--out-dir', outDir,
            '--name', c.name,
            '--preset', c.preset,
            '--grid', c.grid,
            '--radius', String(c.ro),
            '--inner-radius', String(c.ri),
            '--q-profile', c.qProfile,
            '--column-boost', String(c.columnBoost),
            '--seed', '42'
        ];
        if (c.qProfile === 'funicular_tuned') args.push('--optimize-fdm');
        execFileSync('node', args, { stdio: 'pipe' });
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
        if (!v.passed) continue;
        const lc2 = v.loadCases.find(l => l.id === 'LC2_self_weight_plus_50kg');
        const k = v.kpis || {};
        const lat = v.lateralStabilityAdvisory || {};
        const mem = v.fabrication.checks.members;
        results.push({
            ...c,
            massKg: v.geometry.totalMassKg,
            meshMassKg: v.geometry.meshMassKg,
            loadToMass: k.loadToMassRatio,
            funEff: k.funicularEfficiency,
            compDom: k.compressionDominance,
            minAng: k.minIncidentAngleDeg,
            slend: mem.maxSlendernessRatio,
            dispMm: lc2.displacements.maxDispMm,
            invDefl: lc2.criteria.deflectionRatio.inverseRatio,
            sfTens: lc2.safetyFactors.tension,
            sfComp: lc2.safetyFactors.compression,
            sfBuck: lc2.safetyFactors.buckling,
            latSF: lat.minSafetyFactor,
            nodes: v.geometry.nNodes,
            edges: v.geometry.nEdges,
            meshMaxZ: v.fabrication.checks.mesh.boundingBox.max[2]
        });
    } catch (e) {}
}

// Filter for genuinely castable, laterally stable, high-funicularity champions
const elite = results.filter(r => r.latSF >= 3.0 && r.minAng >= 15.0 && r.funEff >= 0.85 && r.sfBuck >= 5.0);
elite.sort((a, b) => a.massKg - b.massKg);
results.sort((a, b) => a.massKg - b.massKg);

console.log(`Total passed: ${results.length}/${configs.length} | Elite (latSF>=3, minAng>=15deg, funEff>=0.85): ${elite.length}`);
console.log('\n=== TOP 15 ELITE CHAMPIONS (CASTABLE + LATERALLY STABLE + FUNICULAR) ===');
for (const r of elite.slice(0, 15)) {
    console.log(
        r.name.padEnd(28),
        `${r.massKg.toFixed(2).padStart(5)}kg`,
        `(${r.loadToMass.toFixed(1)}x)`,
        `fun=${r.funEff.toFixed(3)}`,
        `cmp=${(100 * r.compDom).toFixed(0)}%`,
        `ang=${r.minAng.toFixed(1).padStart(4)}°`,
        `latSF=${r.latSF.toFixed(1).padStart(4)}`,
        `disp=${r.dispMm.toFixed(3)}mm`,
        `SFt=${Math.min(999, r.sfTens).toFixed(1).padStart(5)}`,
        `SFb=${r.sfBuck.toFixed(1).padStart(4)}`,
        `sl=${r.slend.toFixed(0).padStart(3)}`,
        `mZ=${r.meshMaxZ.toFixed(2)}`
    );
}
fs.writeFileSync(path.join(outDir, 'tune_results.json'), JSON.stringify({ total: configs.length, passed: results.length, elite }, null, 2));

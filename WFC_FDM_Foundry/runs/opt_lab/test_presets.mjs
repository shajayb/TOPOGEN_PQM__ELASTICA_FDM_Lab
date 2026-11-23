import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const outDir = 'WFC_FDM_Foundry/runs/opt_lab';
fs.mkdirSync(outDir, { recursive: true });

const cases = [
    ['fv_solid14', ['--preset', 'funicular_vault', '--grid', '1x1x3', '--radius', '0.014', '--q-profile', 'funicular_tuned']],
    ['sd_solid14', ['--preset', 'slender_diagrid', '--grid', '2x2x3', '--radius', '0.014', '--q-profile', 'funicular_tuned']],
    ['hyp_solid14', ['--preset', 'hyperboloid_tower', '--grid', '1x1x3', '--radius', '0.014', '--q-profile', 'funicular_tuned']],
    ['ctq_solid14', ['--preset', 'catenary_quadripod', '--grid', '1x1x3', '--radius', '0.014', '--q-profile', 'funicular_tuned']],
    ['ctq_hollow15_9', ['--preset', 'catenary_quadripod', '--grid', '1x1x2', '--radius', '0.015', '--inner-radius', '0.009', '--q-profile', 'funicular_tuned']],
    ['hyp_hollow15_9', ['--preset', 'hyperboloid_tower', '--grid', '1x1x2', '--radius', '0.015', '--inner-radius', '0.009', '--q-profile', 'funicular_tuned']],
    ['ctq_hollow14_8', ['--preset', 'catenary_quadripod', '--grid', '1x1x3', '--radius', '0.014', '--inner-radius', '0.008', '--q-profile', 'funicular_tuned']],
    ['ctq_hollow13_7', ['--preset', 'catenary_quadripod', '--grid', '1x1x2', '--radius', '0.013', '--inner-radius', '0.007', '--q-profile', 'funicular_tuned']],
    ['ctq_hollow12_6', ['--preset', 'catenary_quadripod', '--grid', '1x1x2', '--radius', '0.012', '--inner-radius', '0.006', '--q-profile', 'funicular_tuned']],
    ['diag_test', ['--preset', 'diagrid_tower', '--grid', '2x2x3', '--radius', '0.016', '--q-profile', 'column_boosted']]
];

for (const [name, args] of cases) {
    try {
        execFileSync('node', [
            'WFC_FDM_Foundry/run_generator.mjs',
            '--brief', 'WFC_FDM_Foundry/briefs/pilot_brief.json',
            '--out-dir', outDir,
            '--name', name,
            ...args
        ], { stdio: 'pipe' });

        const topo = path.join(outDir, `${name}.topology.json`);
        const mesh = path.join(outDir, `${name}.mesh.obj`);
        const verdict = path.join(outDir, `${name}.verdict.json`);
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
        const lc2 = v.loadCases.find(l => l.id === 'LC2_self_weight_plus_50kg');
        const m = v.fabrication.checks.mesh;
        const mem = v.fabrication.checks.members;
        console.log(
            name.padEnd(16),
            v.passed ? 'PASS' : 'FAIL',
            `mass=${v.geometry.totalMassKg.toFixed(2).padStart(6)}kg`,
            `E=${String(v.geometry.nEdges).padStart(3)}`,
            `slend=${mem.maxSlendernessRatio.toFixed(1).padStart(5)}`,
            `disp=${(lc2 ? lc2.displacements.maxDispMm.toFixed(3) : '?').padStart(6)}mm`,
            `SFt=${(lc2 ? Math.min(999, lc2.safetyFactors.tension).toFixed(1) : '?').padStart(5)}`,
            `SFb=${(lc2 ? Math.min(999, lc2.safetyFactors.buckling).toFixed(1) : '?').padStart(5)}`,
            `mesh(b=${m.boundaryEdges},nm=${m.nonManifoldEdges},inc=${m.inconsistentOrientationEdges},deg=${m.degenerateFaces})`,
            v.passed ? '' : JSON.stringify(v.failureReasons)
        );
    } catch (e) {
        console.log(name.padEnd(16), 'ERR:', e.message.slice(0, 140));
    }
}

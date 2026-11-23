import fs from 'fs';
import path from 'path';
import { chromium } from 'file:///C:/Users/shajay.b/Documents/REPOS/JavaScript_blankStart/node_modules/playwright/index.mjs';

const OUT_DIR = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw/ch1';
fs.mkdirSync(OUT_DIR, { recursive: true });

const URL = 'file:///c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY%20REPOS/DRL/index_WFC.html';

const pad3 = (n) => String(n).padStart(3, '0');

async function main() {
    console.log('Launching browser...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2
    });
    const page = await context.newPage();

    console.log('Loading page:', URL);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__app && window.__app.ready);
    await page.evaluate(() => window.__app.ready);

    // Pause automatic update() immediately & apply pure white viewport theme without clutter
    await page.evaluate(() => {
        const btnRun = document.getElementById('btn-sim-run');
        if (btnRun && btnRun.classList.contains('on')) {
            btnRun.click();
        }
        const outlinerEl = document.getElementById('outliner');
        if (outlinerEl) outlinerEl.style.display = 'none';
        const overlayEl = document.getElementById('overlay-canvas');
        if (overlayEl) overlayEl.style.display = 'none';
        const substepHudEl = document.getElementById('substep-hud');
        if (substepHudEl) substepHudEl.style.display = 'none';

        const app = window.__app;
        app.scene.background.setHex(0xffffff);
        document.body.style.backgroundColor = '#ffffff';
        app.renderer.setPixelRatio(2);

        const aside = document.querySelector('aside');
        if (aside) {
            aside.style.width = '320px';
            aside.style.minWidth = '320px';
            aside.style.maxWidth = '320px';
            aside.style.flexShrink = '0';
            aside.style.boxShadow = 'none';
        }
        window.dispatchEvent(new Event('resize'));

        // Completely hide ground grid & origin axes lines permanently across draw() calls
        app.groupVis.grid = false;
        app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (app.mainGroup && app.mainGroup.children[0]) {
            app.mainGroup.children[0].visible = false; // hides axesGroup red/green origin lines
        }
        app.draw();
    });

    // Helper function to ensure overlay & grid stay hidden after algorithm/substep changes
    const applyDarkSceneTuning = async () => {
        await page.evaluate(() => {
            const app = window.__app;
            app.scene.background.setHex(0xffffff);
            app.scene.traverse((obj) => {
                if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
            });
            if (app.mainGroup && app.mainGroup.children[0]) {
                app.mainGroup.children[0].visible = false;
            }
            const outlinerEl = document.getElementById('outliner');
            if (outlinerEl) outlinerEl.style.display = 'none';
            const overlayEl = document.getElementById('overlay-canvas');
            if (overlayEl) overlayEl.style.display = 'none';
            const substepHudEl = document.getElementById('substep-hud');
            if (substepHudEl) substepHudEl.style.display = 'none';
        });
    };

    const VP_CLIP = { x: 320, y: 0, width: 960, height: 720 };
    const SIDEBAR_FULL_CLIP = { x: 0, y: 0, width: 320, height: 720 };
    const SUBSTEP_UI_CLIP = { x: 0, y: 0, width: 320, height: 720 };

    // =========================================================================
    // 1. tiles_turntable (54 frames: tiles_000.png .. tiles_053.png)
    // =========================================================================
    console.log('Capturing 1/4: tiles_turntable (54 frames)...');
    await page.evaluate(() => {
        const app = window.__app;
        const btnRun = document.getElementById('btn-sim-run');
        if (btnRun && btnRun.classList.contains('on')) btnRun.click();

        app.setSubstepMode(false);
        app.setGridResolution(4, 3, 1);

        // Enable wireframe if not already on
        const btnWf = document.getElementById('btn-wireframe');
        if (btnWf && !btnWf.classList.contains('seg-on')) {
            btnWf.click();
        }

        // Clear all voxels and place CRS (1), VTB (2), HTB (3), and NUL/Superposition (0) side-by-side at y=1, z=0
        const vox = app.voxels;
        for (let i = 0; i < vox.length; i++) {
            vox[i].collapsed = false;
            vox[i].tile = null;
            vox[i].domain = [true, true, true, true];
            vox[i].inFrontier = false;
        }

        const idx = (x, y, z) => x + y * 4 + z * 12;
        // (0,1,0) -> TILE_CROSS = 1
        vox[idx(0, 1, 0)].collapsed = true;
        vox[idx(0, 1, 0)].tile = 1;
        vox[idx(0, 1, 0)].domain = [false, true, false, false];

        // (1,1,0) -> TILE_VTUBE = 2
        vox[idx(1, 1, 0)].collapsed = true;
        vox[idx(1, 1, 0)].tile = 2;
        vox[idx(1, 1, 0)].domain = [false, false, true, false];

        // (2,1,0) -> TILE_HTUBE = 3
        vox[idx(2, 1, 0)].collapsed = true;
        vox[idx(2, 1, 0)].tile = 3;
        vox[idx(2, 1, 0)].domain = [false, false, false, true];

        // (3,1,0) -> Leave uncollapsed in frontier/constrained state so the superposition cube & frontier box represent NUL / Superposition primitive
        vox[idx(3, 1, 0)].collapsed = false;
        vox[idx(3, 1, 0)].tile = 0;
        vox[idx(3, 1, 0)].domain = [true, true, true, false];
        vox[idx(3, 1, 0)].inFrontier = true;

        app.draw();
    });
    await applyDarkSceneTuning();

    for (let f = 0; f < 54; f++) {
        await page.evaluate((frameIdx) => {
            const app = window.__app;
            const t = frameIdx / 53;
            // Center of 4x3x1 slab in world coords (Y is up, Z is -modelY):
            // Model box is [-2..2, -1.5..1.5, 0..1] -> World center is (0, 0.5, 0)
            const target = { x: 0, y: 0.45, z: 0 };
            const angle = -0.25 + t * 0.50; // slow smooth sweep across front-isometric
            const radius = 4.3;
            const height = 2.4 + Math.sin(t * Math.PI) * 0.15;

            app.controls.target.set(target.x, target.y, target.z);
            app.camera.position.set(
                target.x + Math.sin(angle) * radius,
                height,
                target.z + Math.cos(angle) * radius
            );
            app.controls.update();
            app.draw();
            app.renderer.render(app.scene, app.camera);
        }, f);

        await page.screenshot({
            path: path.join(OUT_DIR, `tiles_${pad3(f)}.png`),
            clip: VP_CLIP
        });
    }

    // =========================================================================
    // 2. grid_resolutions (54 frames: grid_000.png .. grid_053.png)
    // =========================================================================
    console.log('Capturing 2/4: grid_resolutions (54 frames)...');
    for (let f = 0; f < 54; f++) {
        if (f === 0) {
            await page.evaluate(() => {
                const app = window.__app;
                app.setAlgorithm('wfc');
                app.setGridResolution(4, 3, 1);
                for (let s = 0; s < 2; s++) app.stepAlgorithmOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f === 6 || f === 12) {
            await page.evaluate(() => {
                const app = window.__app;
                app.stepAlgorithmOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f === 18) {
            await page.evaluate(() => {
                const app = window.__app;
                app.setAlgorithm('wfc');
                app.setGridResolution(4, 4, 8);
                for (let s = 0; s < 6; s++) app.stepAlgorithmOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f === 24 || f === 30) {
            await page.evaluate(() => {
                const app = window.__app;
                app.stepAlgorithmOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f === 36) {
            await page.evaluate(() => {
                const app = window.__app;
                app.setAlgorithm('wfc');
                app.setGridResolution(10, 10, 10);
                for (let s = 0; s < 10; s++) app.stepAlgorithmOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f === 42 || f === 48) {
            await page.evaluate(() => {
                const app = window.__app;
                app.stepAlgorithmOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        }

        await page.evaluate((frameIdx) => {
            const app = window.__app;
            const localIdx = frameIdx % 18;
            const u = localIdx / 17;
            const res = app.gridResolution;
            const targetY = (res.z * 1.0) * 0.5;
            const maxDim = Math.max(res.x, res.y, res.z, 6);
            const radius = maxDim * 1.65;
            const angle = 0.50 + u * 0.20;
            const elev = targetY + maxDim * 0.72;

            app.controls.target.set(0, targetY, 0);
            app.camera.position.set(
                Math.sin(angle) * radius,
                elev,
                Math.cos(angle) * radius
            );
            app.controls.update();
            app.draw();
            app.renderer.render(app.scene, app.camera);
        }, f);

        await page.screenshot({
            path: path.join(OUT_DIR, `grid_${pad3(f)}.png`),
            clip: VP_CLIP
        });
    }

    // =========================================================================
    // 3. rules_matrix_tour (54 frames: rules_000.png .. rules_053.png + sidebar crops)
    // =========================================================================
    console.log('Capturing 3/4: rules_matrix_tour (54 frames + sidebar crops)...');
    await page.evaluate(() => {
        const app = window.__app;
        app.setSubstepMode(false);
        app.setAlgorithm('wfc');
        app.setGridResolution(6, 6, 6);
        document.getElementById('btn-rules-socket').click();
        for (let s = 0; s < 18; s++) app.stepAlgorithmOnce();
        app.draw();
    });
    await applyDarkSceneTuning();

    for (let f = 0; f < 54; f++) {
        // Cycle through Axis 0 (0..13), Axis 1 (14..27), Axis 2 (28..41), All Rules (42..53)
        await page.evaluate((frameIdx) => {
            const app = window.__app;
            if (frameIdx === 0) {
                document.querySelector('.axis-btn[data-axis="0"]').click();
            } else if (frameIdx === 14) {
                document.querySelector('.axis-btn[data-axis="1"]').click();
            } else if (frameIdx === 28) {
                document.querySelector('.axis-btn[data-axis="2"]').click();
            } else if (frameIdx === 42) {
                document.getElementById('btn-rules-all').click();
                app.setup();
                for (let s = 0; s < 18; s++) app.stepAlgorithmOnce();
                app.draw();
            }

            if (frameIdx % 6 === 3 && frameIdx < 42) {
                app.stepAlgorithmOnce();
                app.draw();
            }

            const t = frameIdx / 53;
            const targetY = 3.0;
            const radius = 11.5;
            const angle = 0.55 + t * 0.35;
            app.controls.target.set(0, targetY, 0);
            app.camera.position.set(
                Math.sin(angle) * radius,
                targetY + 5.2,
                Math.cos(angle) * radius
            );
            app.controls.update();
            app.draw();
            app.renderer.render(app.scene, app.camera);
        }, f);

        await applyDarkSceneTuning();

        // Save 3D viewport cropped frame
        await page.screenshot({
            path: path.join(OUT_DIR, `rules_${pad3(f)}.png`),
            clip: VP_CLIP
        });

        // Save dedicated high-res sidebar crops at each state transition
        if (f === 0) {
            await page.screenshot({
                path: path.join(OUT_DIR, 'sidebar_axis0.png'),
                clip: SIDEBAR_FULL_CLIP
            });
        } else if (f === 14) {
            await page.screenshot({
                path: path.join(OUT_DIR, 'sidebar_axis1.png'),
                clip: SIDEBAR_FULL_CLIP
            });
        } else if (f === 28) {
            await page.screenshot({
                path: path.join(OUT_DIR, 'sidebar_axis2.png'),
                clip: SIDEBAR_FULL_CLIP
            });
        } else if (f === 42) {
            await page.screenshot({
                path: path.join(OUT_DIR, 'sidebar_all.png'),
                clip: SIDEBAR_FULL_CLIP
            });
        }
    }

    // Restore socket rules before step 4
    await page.evaluate(() => {
        document.getElementById('btn-rules-socket').click();
    });

    // =========================================================================
    // 4. substep_lookup (192 frames: substep_vp_000..191.png, substep_ui_000..191.png + substep_meta.json)
    // =========================================================================
    console.log('Capturing 4/4: substep_lookup (192 frames + substep_meta.json)...');
    const substepMeta = [];

    for (let f = 0; f < 192; f++) {
        if (f === 0) {
            // First 96 frames: WFC on 5x5x5 grid with Sub-Step Visualisation enabled
            await page.evaluate(() => {
                const app = window.__app;
                document.getElementById('btn-rules-socket').click();
                app.setAlgorithm('wfc');
                app.setGridResolution(5, 5, 5);
                // Perform 2 initial collapses so there is rich geometry + active neighbors around center (2,2,2)
                app.stepAlgorithmOnce();
                app.stepAlgorithmOnce();
                app.setSubstepMode(true);
                app.stepSubstepOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f === 96) {
            // Second 96 frames: Growth on 5x5x5 grid with Sub-Step Visualisation enabled
            await page.evaluate(() => {
                const app = window.__app;
                document.getElementById('btn-rules-socket').click();
                app.setAlgorithm('growth');
                app.setGridResolution(5, 5, 5);
                app.stepAlgorithmOnce();
                app.stepAlgorithmOnce();
                app.setSubstepMode(true);
                app.stepSubstepOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        } else if (f % 16 === 0) {
            // Step sub-step once every 16 frames (0.53s hold per rule lookup)
            await page.evaluate(() => {
                const app = window.__app;
                app.stepSubstepOnce();
                app.draw();
            });
            await applyDarkSceneTuning();
        }

        // Camera orbit zoomed in (dist * 0.65) around the center seed voxel (2,2,2) -> world (0, 2.5, 0)
        const metaItem = await page.evaluate((frameIdx) => {
            const app = window.__app;
            const u = frameIdx / 191;
            // Base distance for 5x5x5 is ~18.7; dist * 0.65 is ~7.5
            const dist = 7.2;
            const angle = 0.60 + u * 0.45;
            const target = { x: 0.0, y: 2.5, z: 0.0 };

            app.controls.target.set(target.x, target.y, target.z);
            app.camera.position.set(
                target.x + Math.sin(angle) * dist * 0.72,
                target.y + dist * 0.42,
                target.z + Math.cos(angle) * dist * 0.72
            );
            app.controls.update();
            app.draw();
            app.renderer.render(app.scene, app.camera);

            // Also trigger overlay redraw by dispatching a quick render cycle or reading currentSubstep
            const ev = app.currentSubstep || {};
            return {
                frame: frameIdx,
                algorithm: app.algorithm,
                type: ev.type || null,
                ruleText: ev.ruleText || '',
                desc: ev.desc || '',
                axis: ev.axis !== undefined ? ev.axis : 0,
                allowed: ev.allowed !== undefined ? ev.allowed : true,
                candidateTile: ev.candidateTile !== undefined ? ev.candidateTile : null,
                neighborTile: ev.neighborTile !== undefined ? ev.neighborTile : null,
                srcIdx: ev.srcIdx !== undefined ? ev.srcIdx : null,
                dstIdx: ev.dstIdx !== undefined ? ev.dstIdx : null,
                rulesChecked: ev.rulesChecked ? JSON.parse(JSON.stringify(ev.rulesChecked)) : [],
                adjRules: JSON.parse(JSON.stringify(app.adjRules))
            };
        }, f);

        // Wait one animation frame so animate() also calls drawOverlay() with the updated camera projection
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));

        substepMeta.push(metaItem);

        await page.screenshot({
            path: path.join(OUT_DIR, `substep_vp_${pad3(f)}.png`),
            clip: VP_CLIP
        });
        await page.screenshot({
            path: path.join(OUT_DIR, `substep_ui_${pad3(f)}.png`),
            clip: SUBSTEP_UI_CLIP
        });
    }

    fs.writeFileSync(
        path.join(OUT_DIR, 'substep_meta.json'),
        JSON.stringify(substepMeta, null, 2),
        'utf-8'
    );

    console.log('All captures complete! Closing browser...');
    await browser.close();
}

main().catch((err) => {
    console.error('Error in capture_ch1.mjs:', err);
    process.exit(1);
});

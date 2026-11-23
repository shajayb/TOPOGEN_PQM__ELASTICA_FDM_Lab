import fs from 'fs';
import path from 'path';
import { chromium } from 'file:///C:/Users/shajay.b/Documents/REPOS/JavaScript_blankStart/node_modules/playwright/index.mjs';

const OUT_DIR = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw/ch2';
const HTML_URL = 'file:///c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY%20REPOS/DRL/index_WFC.html';

fs.mkdirSync(OUT_DIR, { recursive: true });

function pad3(n) {
    return String(n).padStart(3, '0');
}

async function main() {
    console.log('Launching browser for Chapter 2 capture...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2
    });
    const page = await context.newPage();

    await page.goto(HTML_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__app && window.__app.ready);
    await page.evaluate(() => window.__app.ready);

    // Pure white background & clean UI setup
    await page.evaluate(() => {
        // Pause simulation immediately
        const btnRun = document.getElementById('btn-sim-run');
        if (btnRun && btnRun.classList.contains('on')) {
            btnRun.click();
        }
        // Enable Quad Wireframe
        const btnWire = document.getElementById('btn-wireframe');
        if (btnWire && !btnWire.classList.contains('seg-on')) {
            btnWire.click();
        }
        // Pure white viewport background
        window.__app.scene.background.setHex(0xffffff);
        document.body.style.backgroundColor = '#ffffff';
        // Completely hide ground grid and origin axes lines
        window.__app.groupVis.grid = false;
        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false; // hides axesGroup
        }
        // Hide viewport overlay clutter & fix sidebar width to 320px
        ['outliner', 'overlay-canvas', 'substep-hud'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        const aside = document.querySelector('aside');
        if (aside) {
            aside.style.width = '320px';
            aside.style.minWidth = '320px';
            aside.style.maxWidth = '320px';
            aside.style.flexShrink = '0';
        }
        window.__app.renderer.setPixelRatio(2);
        window.dispatchEvent(new Event('resize'));
        // Disable damping for exact deterministic camera positioning per frame
        window.__app.controls.enableDamping = false;
    });

    const clipRegion = { x: 320, y: 0, width: 960, height: 720 };
    const meta = {
        chapter: 2,
        viewport: { width: 1280, height: 720 },
        crop: clipRegion,
        race_growth: [],
        race_wfc: [],
        mech_growth_substep: [],
        mech_wfc_substep: []
    };

    // =========================================================================
    // 1. race_growth (180 frames: raw/ch2/race_growth_000.png .. race_growth_179.png)
    // =========================================================================
    console.log('Capturing 1/4: race_growth (180 frames)...');
    await page.evaluate(() => {
        // Seed PRNG deterministically
        let s = 42;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setAlgorithm('growth');
        window.__app.setGridResolution(6, 6, 6);
        window.__app.stepAlgorithmOnce();
        window.__app.stepAlgorithmOnce();
    });

    for (let f = 0; f < 180; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Step once every 3 frames (60 steps over 180 frames, after 2 initial seed steps)
            if (frameIdx % 3 === 0) window.__app.stepAlgorithmOnce();
            window.__app.draw();

            // Orbit camera smoothly around (0, 3, 0) in Three.js Y-up world space (which corresponds to Z=3 in Z-up voxel space)
            const radius = 12.5;
            const height = 8.5;
            const theta = 0.60 + frameIdx * 0.004;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 3.0, 0);
            cam.position.set(
                radius * Math.cos(theta),
                height,
                radius * Math.sin(theta)
            );
            ctrl.update();
            window.__app.renderer.render(window.__app.scene, window.__app.camera);

            const voxels = window.__app.voxels;
            const collapsedCount = voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
            const nonNullCount = voxels.reduce((acc, v) => acc + (v.collapsed && v.tile > 0 ? 1 : 0), 0);
            const frontierSize = voxels.reduce((acc, v) => acc + (!v.collapsed && v.inFrontier ? 1 : 0), 0);
            const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;

            return {
                frame: frameIdx,
                stepCount: 2 + Math.floor(frameIdx / 3) + 1,
                collapsedCount,
                nonNullCount,
                frontierSize,
                activeQuads,
                theta: Number(theta.toFixed(4))
            };
        }, f);

        const outPath = path.join(OUT_DIR, `race_growth_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: clipRegion });
        meta.race_growth.push({ ...frameData, file: `race_growth_${pad3(f)}.png` });
    }

    // =========================================================================
    // 2. race_wfc (180 frames: raw/ch2/race_wfc_000.png .. race_wfc_179.png)
    // =========================================================================
    console.log('Capturing 2/4: race_wfc (180 frames)...');
    await page.evaluate(() => {
        // Seed PRNG deterministically
        let s = 42;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        const chkSup = document.getElementById('chk-superposition');
        if (chkSup && !chkSup.checked) {
            chkSup.click();
        }
        window.__app.setSubstepMode(false);
        window.__app.setAlgorithm('wfc');
        window.__app.setGridResolution(6, 6, 6);
        window.__app.stepAlgorithmOnce();
        window.__app.stepAlgorithmOnce();
    });

    for (let f = 0; f < 180; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Step once every 3 frames (60 steps over 180 frames, after 2 initial seed steps)
            if (frameIdx % 3 === 0) window.__app.stepAlgorithmOnce();
            window.__app.draw();

            // Exact same camera orbit as race_growth
            const radius = 12.5;
            const height = 8.5;
            const theta = 0.60 + frameIdx * 0.004;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 3.0, 0);
            cam.position.set(
                radius * Math.cos(theta),
                height,
                radius * Math.sin(theta)
            );
            ctrl.update();
            window.__app.renderer.render(window.__app.scene, window.__app.camera);

            const voxels = window.__app.voxels;
            const collapsedCount = voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
            const nonNullCount = voxels.reduce((acc, v) => acc + (v.collapsed && v.tile > 0 ? 1 : 0), 0);
            let constrainedSuperposCount = 0;
            for (const v of voxels) {
                if (!v.collapsed) {
                    const cnt = v.domain.filter(Boolean).length;
                    if (cnt > 0 && cnt < 4) constrainedSuperposCount++;
                }
            }
            const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;

            return {
                frame: frameIdx,
                stepCount: 2 + Math.floor(frameIdx / 3) + 1,
                collapsedCount,
                nonNullCount,
                frontierSize: constrainedSuperposCount,
                activeQuads,
                theta: Number(theta.toFixed(4))
            };
        }, f);

        const outPath = path.join(OUT_DIR, `race_wfc_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: clipRegion });
        meta.race_wfc.push({ ...frameData, file: `race_wfc_${pad3(f)}.png` });
    }

    // =========================================================================
    // 3. mech_growth_substep (72 frames: raw/ch2/mech_growth_000.png .. mech_growth_071.png)
    // =========================================================================
    console.log('Capturing 3/4: mech_growth_substep (72 frames)...');
    await page.evaluate(() => {
        let s = 101;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setAlgorithm('growth');
        window.__app.setGridResolution(5, 5, 5);
        // Step 4 full iterations so there is a small cluster of collapsed tiles at the center
        for (let i = 0; i < 4; i++) {
            window.__app.stepAlgorithmOnce();
        }
        window.__app.setSubstepMode(true);
        const hud = document.getElementById('substep-hud');
        if (hud) hud.style.display = 'none';
    });

    for (let f = 0; f < 72; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Advance stepSubstepOnce() every 12 frames (6 sub-steps total, starting at f=0)
            if (frameIdx % 12 === 0) {
                window.__app.stepSubstepOnce();
                window.__app.draw();
                const hud = document.getElementById('substep-hud');
                if (hud) hud.style.display = 'none';
            }

            // Zoom camera closer (radius = 7.5) to the active frontier voxel / center cluster
            const radius = 7.5;
            const height = 5.2;
            const theta = 0.72 + frameIdx * 0.0025;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 2.5, 0);
            cam.position.set(
                radius * Math.cos(theta),
                height,
                radius * Math.sin(theta)
            );
            ctrl.update();
            window.__app.renderer.render(window.__app.scene, window.__app.camera);

            const ev = window.__app.currentSubstep;
            return {
                frame: frameIdx,
                substepIndex: Math.floor(frameIdx / 12),
                type: ev ? ev.type : null,
                candidateTile: ev ? ev.candidateTile : null,
                allowed: ev ? ev.allowed : null,
                ruleText: ev ? ev.ruleText : null,
                desc: ev ? ev.desc : null
            };
        }, f);

        const outPath = path.join(OUT_DIR, `mech_growth_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: clipRegion });
        meta.mech_growth_substep.push({ ...frameData, file: `mech_growth_${pad3(f)}.png` });
    }

    // =========================================================================
    // 4. mech_wfc_substep (72 frames: raw/ch2/mech_wfc_000.png .. mech_wfc_071.png)
    // =========================================================================
    console.log('Capturing 4/4: mech_wfc_substep (72 frames)...');
    await page.evaluate(() => {
        let s = 101;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setAlgorithm('wfc');
        window.__app.setGridResolution(5, 5, 5);
        // Step 3 full iterations, then enable substepMode
        for (let i = 0; i < 3; i++) {
            window.__app.stepAlgorithmOnce();
        }
        window.__app.setSubstepMode(true);
        const hud = document.getElementById('substep-hud');
        if (hud) hud.style.display = 'none';
    });

    for (let f = 0; f < 72; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Advance stepSubstepOnce() every 12 frames (6 sub-steps total, starting at f=0)
            if (frameIdx % 12 === 0) {
                window.__app.stepSubstepOnce();
                window.__app.draw();
                const hud = document.getElementById('substep-hud');
                if (hud) hud.style.display = 'none';
            }

            // Zoom camera closer (radius = 7.5) to the center cluster
            const radius = 7.5;
            const height = 5.2;
            const theta = 0.72 + frameIdx * 0.0025;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 2.5, 0);
            cam.position.set(
                radius * Math.cos(theta),
                height,
                radius * Math.sin(theta)
            );
            ctrl.update();
            window.__app.renderer.render(window.__app.scene, window.__app.camera);

            const ev = window.__app.currentSubstep;
            return {
                frame: frameIdx,
                substepIndex: Math.floor(frameIdx / 12),
                type: ev ? ev.type : null,
                candidateTile: ev ? ev.candidateTile : null,
                allowed: ev ? ev.allowed : null,
                prunedTile: ev ? ev.prunedTile : null,
                ruleText: ev ? ev.ruleText : null,
                desc: ev ? ev.desc : null
            };
        }, f);

        const outPath = path.join(OUT_DIR, `mech_wfc_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: clipRegion });
        meta.mech_wfc_substep.push({ ...frameData, file: `mech_wfc_${pad3(f)}.png` });
    }

    const metaPath = path.join(OUT_DIR, 'ch2_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    console.log(`Saved metadata to ${metaPath}`);

    await browser.close();
    console.log('Chapter 2 capture complete!');
}

main().catch(err => {
    console.error('Error in capture_ch2.mjs:', err);
    process.exit(1);
});

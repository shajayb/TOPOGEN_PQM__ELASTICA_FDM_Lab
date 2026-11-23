import fs from 'fs';
import path from 'path';
import { chromium } from 'file:///C:/Users/shajay.b/Documents/REPOS/JavaScript_blankStart/node_modules/playwright/index.mjs';

const OUT_CH3 = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw/ch3';
const OUT_CH4 = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw/ch4';
const HTML_URL = 'file:///c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY%20REPOS/DRL/index_WFC.html';

fs.mkdirSync(OUT_CH3, { recursive: true });
fs.mkdirSync(OUT_CH4, { recursive: true });

function pad3(n) {
    return String(n).padStart(3, '0');
}

async function main() {
    console.log('Launching browser for Chapter 3 & Chapter 4 720p HD (2× HiDPI supersampled) white-background capture...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        viewport: { width: 1280, height: 720 },
        deviceScaleFactor: 2
    });
    const page = await context.newPage();

    await page.goto(HTML_URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__app && window.__app.ready);
    await page.evaluate(() => window.__app.ready);

    // Base pure white theme, clean viewport & UI setup
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

        // 1. Pure White Background (#ffffff)
        window.__app.scene.background.setHex(0xffffff);
        document.body.style.backgroundColor = '#ffffff';

        // 2. Completely Remove Ground Grid (GridHelper) & Origin Axes Lines (axesGroup)
        if (window.__app.groupVis) {
            window.__app.groupVis.grid = false;
        }
        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false; // hides red/green origin axes lines
        }

        // 3. Remove Viewport Overlay Clutter & Fix Sidebar Width (320px)
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

        // 4. High Anti-Aliasing (deviceScaleFactor: 2)
        window.__app.renderer.setPixelRatio(2);
        window.dispatchEvent(new Event('resize'));

        // Disable damping for exact deterministic camera positioning per frame
        window.__app.controls.enableDamping = false;
    });

    const viewportClip = { x: 320, y: 0, width: 960, height: 720 };
    const sidebarClip  = { x: 0, y: 80, width: 320, height: 640 };

    const ch3Meta = {
        chapter: 3,
        viewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
        crop: viewportClip,
        sidebarCrop: sidebarClip,
        v1: [],
        v2: [],
        v3: [],
        v4: [],
        ch4_summary: {}
    };

    // =========================================================================
    // PART A — Chapter 3 Parameter Variations (raw/ch3/)
    // =========================================================================

    // -------------------------------------------------------------------------
    // Variation 1 (raw/ch3/v1_000.png .. v1_239.png)
    // 10×10×10 Isotropic Cube | All 4 Tiles (NUL, CRS, VTB, HTB) | Socket Rules
    // -------------------------------------------------------------------------
    console.log('Capturing Ch3 Variation 1: 10×10×10 Isotropic Cube (240 frames)...');
    await page.evaluate(() => {
        let s = 301;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setArctic(false);

        const chkGrid = document.getElementById('chk-inactive-grid');
        if (chkGrid && !chkGrid.checked) chkGrid.click();
        const chkSup = document.getElementById('chk-superposition');
        if (chkSup && !chkSup.checked) chkSup.click();

        // Reset Socket rules, set algorithm to WFC, set 10x10x10
        document.getElementById('btn-rules-socket').click();
        window.__app.setAlgorithm('wfc');
        window.__app.setGridResolution(10, 10, 10);

        // Ensure all 4 tiles enabled with rich architectural weights so lattice is dense
        window.__app.tiles[0].enabled = true; window.__app.tiles[0].weight = 0.85;
        window.__app.tiles[1].enabled = true; window.__app.tiles[1].weight = 1.45;
        window.__app.tiles[2].enabled = true; window.__app.tiles[2].weight = 1.35;
        window.__app.tiles[3].enabled = true; window.__app.tiles[3].weight = 1.35;

        // Re-init domain with all 4 tiles enabled & pre-step 30 iterations
        for (let i = 0; i < 30; i++) {
            window.__app.stepAlgorithmOnce();
        }
        window.__app.draw();

        // Ensure grid & axes remain hidden
        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false;
        }
    });

    await page.screenshot({ path: path.join(OUT_CH3, 'v1_sidebar.png'), clip: sidebarClip });

    for (let f = 0; f < 240; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Step 2 iterations per frame over frames 0..239
            for (let k = 0; k < 2; k++) {
                window.__app.stepAlgorithmOnce();
            }
            window.__app.draw();

            window.__app.scene.traverse((obj) => {
                if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
            });
            if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
                window.__app.mainGroup.children[0].visible = false;
            }

            // Orbit camera smoothly: radius = 19, height = 13, target (0, 0, 5) in Z-up -> (0, 5, 0) in Y-up
            const radius = 19.0;
            const height = 13.0;
            const theta = 0.50 + frameIdx * 0.0035;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 5.0, 0);
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
            const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;

            return {
                frame: frameIdx,
                collapsedCount,
                nonNullCount,
                activeQuads,
                theta: Number(theta.toFixed(4))
            };
        }, f);

        const outPath = path.join(OUT_CH3, `v1_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: viewportClip });
        ch3Meta.v1.push({ ...frameData, file: `v1_${pad3(f)}.png` });
    }
    console.log(`  V1 complete: final quads = ${ch3Meta.v1[239].activeQuads}, nonNull = ${ch3Meta.v1[239].nonNullCount}/1000`);

    // -------------------------------------------------------------------------
    // Variation 2 (raw/ch3/v2_000.png .. v2_239.png)
    // 4×4×8 Vertical Tower | HTB Disabled (CRS + VTB Only) | Socket Rules
    // -------------------------------------------------------------------------
    console.log('Capturing Ch3 Variation 2: 4×4×8 Vertical Tower (240 frames)...');
    await page.evaluate(() => {
        let s = 509;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setArctic(false);

        document.getElementById('btn-rules-socket').click();
        window.__app.setAlgorithm('wfc');
        window.__app.setGridResolution(4, 4, 8);

        // Click HTB (tile 3) button in #tile-catalog to disable it and update UI
        const btnHtb = document.querySelector('#tile-catalog button[data-tile-id="3"]');
        if (btnHtb) btnHtb.click();
        window.__app.tiles[0].enabled = true;  window.__app.tiles[0].weight = 0.7;
        window.__app.tiles[1].enabled = true;  window.__app.tiles[1].weight = 1.4;
        window.__app.tiles[2].enabled = true;  window.__app.tiles[2].weight = 2.2;
        window.__app.tiles[3].enabled = false;

        // Re-prune domains for disabled tile 3 and propagate from initial seed
        for (const v of window.__app.voxels) {
            if (!v.collapsed) v.domain[3] = false;
        }

        // Pre-step 6 iterations
        for (let i = 0; i < 6; i++) {
            window.__app.stepAlgorithmOnce();
        }
        window.__app.draw();

        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false;
        }
    });

    await page.screenshot({ path: path.join(OUT_CH3, 'v2_sidebar.png'), clip: sidebarClip });

    for (let f = 0; f < 240; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Step 1 iteration every 2 frames across frames 0..239
            if (frameIdx % 2 === 0) {
                window.__app.stepAlgorithmOnce();
                window.__app.draw();
            }

            window.__app.scene.traverse((obj) => {
                if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
            });
            if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
                window.__app.mainGroup.children[0].visible = false;
            }

            // Orbit around (0, 0, 4) in Z-up -> (0, 4, 0) in Y-up (radius = 12.5, height = 7.0)
            const radius = 12.5;
            const height = 7.0;
            const theta = 0.65 + frameIdx * 0.0035;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 4.0, 0);
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
            const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;

            return {
                frame: frameIdx,
                collapsedCount,
                nonNullCount,
                activeQuads,
                theta: Number(theta.toFixed(4))
            };
        }, f);

        const outPath = path.join(OUT_CH3, `v2_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: viewportClip });
        ch3Meta.v2.push({ ...frameData, file: `v2_${pad3(f)}.png` });
    }
    console.log(`  V2 complete: final quads = ${ch3Meta.v2[239].activeQuads}, nonNull = ${ch3Meta.v2[239].nonNullCount}/128`);

    // -------------------------------------------------------------------------
    // Variation 3 (raw/ch3/v3_000.png .. v3_239.png)
    // 6×6×1 Planar Slab | VTB Disabled (CRS + HTB Only) | Socket Rules
    // -------------------------------------------------------------------------
    console.log('Capturing Ch3 Variation 3: 6×6×1 Planar Slab (240 frames)...');
    await page.evaluate(() => {
        let s = 777;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setArctic(false);

        document.getElementById('btn-rules-socket').click();
        window.__app.setAlgorithm('wfc');
        window.__app.setGridResolution(6, 6, 1);

        // Disable VTB (tile 2) via UI button so #tile-catalog updates cleanly
        const btnVtb = document.querySelector('#tile-catalog button[data-tile-id="2"]');
        if (btnVtb) btnVtb.click();
        window.__app.tiles[0].enabled = true;  window.__app.tiles[0].weight = 0.55;
        window.__app.tiles[1].enabled = true;  window.__app.tiles[1].weight = 1.5;
        window.__app.tiles[2].enabled = false;
        window.__app.tiles[3].enabled = true;  window.__app.tiles[3].weight = 2.0;

        for (const v of window.__app.voxels) {
            if (!v.collapsed) v.domain[2] = false;
        }

        // Pre-step 2 iterations
        for (let i = 0; i < 2; i++) {
            window.__app.stepAlgorithmOnce();
        }
        window.__app.draw();

        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false;
        }
    });

    await page.screenshot({ path: path.join(OUT_CH3, 'v3_sidebar.png'), clip: sidebarClip });

    for (let f = 0; f < 240; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Step 1 iteration every 5 frames so the planar horizontal conduit mat grows gradually across the clip
            if (frameIdx % 5 === 0) {
                window.__app.stepAlgorithmOnce();
                window.__app.draw();
            }

            window.__app.scene.traverse((obj) => {
                if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
            });
            if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
                window.__app.mainGroup.children[0].visible = false;
            }

            // Elevated isometric angle: radius = 9.0, height = 8.0, target (0, 0, 0.5) in Z-up -> (0, 0.5, 0) in Y-up
            const radius = 9.0;
            const height = 8.0;
            const theta = 0.75 + frameIdx * 0.0035;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 0.5, 0);
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
            const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;

            return {
                frame: frameIdx,
                collapsedCount,
                nonNullCount,
                activeQuads,
                theta: Number(theta.toFixed(4))
            };
        }, f);

        const outPath = path.join(OUT_CH3, `v3_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: viewportClip });
        ch3Meta.v3.push({ ...frameData, file: `v3_${pad3(f)}.png` });
    }
    console.log(`  V3 complete: final quads = ${ch3Meta.v3[239].activeQuads}, nonNull = ${ch3Meta.v3[239].nonNullCount}/36`);

    // -------------------------------------------------------------------------
    // Variation 4 (raw/ch3/v4_000.png .. v4_239.png)
    // 5×5×5 Cube | All 4 Tiles | Custom / All-Allowed Adjacency Matrix
    // -------------------------------------------------------------------------
    console.log('Capturing Ch3 Variation 4: 5×5×5 Cube All-Allowed Adjacency Matrix (240 frames)...');
    await page.evaluate(() => {
        let s = 999;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setArctic(false);

        // Set algorithm to growth and grid resolution to 5x5x5 (which re-enables all 4 tiles via setup())
        window.__app.setAlgorithm('growth');
        window.__app.setGridResolution(5, 5, 5);

        // Click #btn-rules-all (allowAllAdjacencyRules)
        document.getElementById('btn-rules-all').click();

        // Pre-step 5 iterations
        for (let i = 0; i < 5; i++) {
            window.__app.stepAlgorithmOnce();
        }
        window.__app.draw();

        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false;
        }
    });

    await page.screenshot({ path: path.join(OUT_CH3, 'v4_sidebar.png'), clip: sidebarClip });

    for (let f = 0; f < 240; f++) {
        const frameData = await page.evaluate((frameIdx) => {
            // Step 1 iteration every 2 frames across frames 0..239
            if (frameIdx % 2 === 0) {
                window.__app.stepAlgorithmOnce();
                window.__app.draw();
            }

            window.__app.scene.traverse((obj) => {
                if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
            });
            if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
                window.__app.mainGroup.children[0].visible = false;
            }

            // Orbit smoothly: radius = 10.5, height = 7.5, target (0, 0, 2.5) in Z-up -> (0, 2.5, 0) in Y-up
            const radius = 10.5;
            const height = 7.5;
            const theta = 0.55 + frameIdx * 0.0035;
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

            const voxels = window.__app.voxels;
            const collapsedCount = voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
            const nonNullCount = voxels.reduce((acc, v) => acc + (v.collapsed && v.tile > 0 ? 1 : 0), 0);
            const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;

            return {
                frame: frameIdx,
                collapsedCount,
                nonNullCount,
                activeQuads,
                theta: Number(theta.toFixed(4))
            };
        }, f);

        const outPath = path.join(OUT_CH3, `v4_${pad3(f)}.png`);
        await page.screenshot({ path: outPath, clip: viewportClip });
        ch3Meta.v4.push({ ...frameData, file: `v4_${pad3(f)}.png` });
    }
    console.log(`  V4 complete: final quads = ${ch3Meta.v4[239].activeQuads}, nonNull = ${ch3Meta.v4[239].nonNullCount}/125`);

    // =========================================================================
    // PART B — Chapter 4 Finale: Converged 10×10×10 Quad-Mesh Wireframe,
    //          Arctic Shading & Hero Orbit (raw/ch4/, 294 frames: 000..293)
    // =========================================================================
    console.log('Preparing Ch4 Finale: Converged 10×10×10 WFC Lattice...');
    const ch4Stats = await page.evaluate(() => {
        let s = 2026;
        Math.random = () => {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
        window.__app.setSubstepMode(false);
        window.__app.setArctic(false);

        document.getElementById('btn-rules-socket').click();
        window.__app.setAlgorithm('wfc');
        window.__app.setGridResolution(10, 10, 10);

        // Tune weights so the 10x10x10 WFC lattice forms a rich, sculpted 3D architectural space-frame
        window.__app.tiles[0].enabled = true; window.__app.tiles[0].weight = 0.90;
        window.__app.tiles[1].enabled = true; window.__app.tiles[1].weight = 1.40;
        window.__app.tiles[2].enabled = true; window.__app.tiles[2].weight = 1.35;
        window.__app.tiles[3].enabled = true; window.__app.tiles[3].weight = 1.35;

        // Uncheck chk-inactive-grid so only the pure 3D quad-mesh architecture floats over the white background
        const chkGrid = document.getElementById('chk-inactive-grid');
        if (chkGrid && chkGrid.checked) {
            chkGrid.click();
        }
        // Ensure Quad Wireframe is enabled
        const btnWire = document.getElementById('btn-wireframe');
        if (btnWire && !btnWire.classList.contains('seg-on')) {
            btnWire.click();
        }

        // Step until all 1000 voxels are converged
        let steps = 0;
        while (window.__app.stepAlgorithmOnce() && steps < 1200) {
            steps++;
        }
        window.__app.draw();

        // Ensure grid & axes remain hidden
        window.__app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (window.__app.mainGroup && window.__app.mainGroup.children[0]) {
            window.__app.mainGroup.children[0].visible = false;
        }

        const voxels = window.__app.voxels;
        const collapsedCount = voxels.reduce((acc, v) => acc + (v.collapsed ? 1 : 0), 0);
        const nonNullCount = voxels.reduce((acc, v) => acc + (v.collapsed && v.tile > 0 ? 1 : 0), 0);
        const activeQuads = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].quads.length : 0;
        const activeVertices = window.__app.meshPool().length > 0 ? window.__app.meshPool()[0].positions.length / 3 : 0;

        return { steps, collapsedCount, nonNullCount, activeQuads, activeVertices };
    });

    console.log(`  Ch4 Lattice converged: ${ch4Stats.collapsedCount}/1000 collapsed, ${ch4Stats.nonNullCount} active tiles, ${ch4Stats.activeQuads} quads, ${ch4Stats.activeVertices} vertices.`);
    ch3Meta.ch4_summary = ch4Stats;

    console.log('Capturing Ch4 synchronized streams: shaded_000..293 and arctic_000..293 (294 frames each)...');
    for (let f = 0; f < 294; f++) {
        // 1. Set camera pose and Shaded mode (setArctic(false))
        await page.evaluate((frameIdx) => {
            const radius = 17.5;
            const height = 11.5;
            const theta = 0.40 + frameIdx * 0.0045;
            const cam = window.__app.camera;
            const ctrl = window.__app.controls;
            ctrl.target.set(0, 5.0, 0);
            cam.position.set(
                radius * Math.cos(theta),
                height,
                radius * Math.sin(theta)
            );
            ctrl.update();

            window.__app.setArctic(false);
            window.__app.renderer.render(window.__app.scene, window.__app.camera);
        }, f);

        const shadedPath = path.join(OUT_CH4, `shaded_${pad3(f)}.png`);
        await page.screenshot({ path: shadedPath, clip: viewportClip });

        // 2. Exact same camera pose, switch to Arctic mode (setArctic(true)) with #eef2f6 clay contrast on white background
        await page.evaluate(() => {
            window.__app.setArctic(true);
            window.__app.meshGroup.children.forEach(obj => {
                if (obj.isMesh && obj.material) {
                    obj.material.color.setHex(0xeef2f6);
                } else if (obj.isLineSegments && obj.material) {
                    obj.material.color.setHex(0x1e293b);
                    obj.material.opacity = 0.80;
                }
            });
            window.__app.renderer.render(window.__app.scene, window.__app.camera);
        });

        const arcticPath = path.join(OUT_CH4, `arctic_${pad3(f)}.png`);
        await page.screenshot({ path: arcticPath, clip: viewportClip });

        if ((f + 1) % 60 === 0 || f === 293) {
            console.log(`  Ch4 progress: ${f + 1}/294 frames captured`);
        }
    }

    const metaPath = path.join(OUT_CH3, 'ch3_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(ch3Meta, null, 2), 'utf-8');
    console.log(`Saved metadata to ${metaPath}`);

    const ch4MetaPath = path.join(OUT_CH4, 'ch4_meta.json');
    fs.writeFileSync(ch4MetaPath, JSON.stringify(ch4Stats, null, 2), 'utf-8');

    await browser.close();
    console.log('Chapter 3 & Chapter 4 720p HD (2× HiDPI supersampled) white-background capture complete!');
}

main().catch(err => {
    console.error('Error in capture_ch3_ch4.mjs:', err);
    process.exit(1);
});

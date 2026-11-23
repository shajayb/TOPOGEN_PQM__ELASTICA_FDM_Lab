import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { chromium } from 'file:///C:/Users/shajay.b/Documents/REPOS/JavaScript_blankStart/node_modules/playwright/index.mjs';

const REPO_DIR = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL';
const OUT_DIR  = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw_pq/ch1_ch2';
const RAW_PQ   = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw_pq';
const URL      = 'file:///c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY%20REPOS/DRL/index.html';

fs.mkdirSync(OUT_DIR, { recursive: true });

const pad4 = (n) => String(n).padStart(4, '0');

async function main() {
    console.log('Launching Headless Chrome for Chapters 1 & 2 (900 frames @ 1920x1080)...');
    const browser = await chromium.launch({
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true
    });
    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        deviceScaleFactor: 1
    });
    const page = await context.newPage();

    console.log('Loading page:', URL);
    await page.goto(URL, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => window.__app && window.__app.ready);
    await page.evaluate(() => window.__app.ready);

    // Base visual setup: unified #070A10 dark obsidian canvas, crisp 2x WebGL supersampling,
    // full 3-tab Goldilocks UI expanded, and clean viewport without ground grid / origin axes clutter.
    await page.evaluate(() => {
        const app = window.__app;

        // 1. Deterministic controls (no damping inertia)
        app.controls.enableDamping = false;

        // 2. Unified #070A10 dark obsidian canvas for in-situ 3D + UI contrast
        app.scene.background.setHex(0x070a10);
        document.body.style.backgroundColor = '#070a10';

        // 3. Hide Ground Grid & Origin Axes lines permanently
        app.groupVis.grid = false;
        app.scene.traverse((obj) => {
            if (obj.type === 'GridHelper' || obj.isGridHelper) obj.visible = false;
        });
        if (app.mainGroup && app.mainGroup.children[0]) {
            app.mainGroup.children[0].visible = false;
        }

        // 4. Hide top-right Outliner and bottom-left Display HUD in Ch1/Ch2 so the 3D mesh & Telemetry HUD breathe cleanly
        const outlinerEl = document.getElementById('outliner');
        if (outlinerEl) outlinerEl.style.display = 'none';
        const dispHudEl = document.getElementById('display-hud-panel');
        if (dispHudEl) dispHudEl.style.display = 'none';
        // Hide bottom overlay canvas status line (prevent text in y > 900 seekbar zone!)
        const overlayEl = document.getElementById('overlay-canvas');
        if (overlayEl) overlayEl.style.display = 'none';

        // 5. Expand Full 3-Tab Sidebar UI (exit 3-button compact card)
        const compactCard = document.getElementById('sidebar-compact-card');
        if (compactCard && !compactCard.classList.contains('hidden')) {
            const btnExpand = document.getElementById('btn-compact-expand-full') || document.getElementById('btn-sidebar-compact-toggle');
            if (btnExpand) btnExpand.click();
        }

        //Position Left Sidebar cleanly at top: 16px, left: 16px
        const leftSidebar = document.getElementById('left-sidebar');
        if (leftSidebar) {
            leftSidebar.style.top = '16px';
            leftSidebar.style.left = '16px';
            leftSidebar.style.width = '348px';
        }

        // 6. Enforce 2x HiDPI WebGL Supersampling on the 1920x1080 canvas
        app.renderer.setPixelRatio(2);
        window.dispatchEvent(new Event('resize'));

        // Helper for active button highlight ring during instructional stages
        window.__highlightBtn = (btnId, color = '#ec4899') => {
            document.querySelectorAll('.cad-btn').forEach(b => {
                b.style.boxShadow = '';
                b.style.transform = '';
            });
            if (!btnId) return;
            const el = document.getElementById(btnId);
            if (el) {
                el.style.boxShadow = `0 0 0 2px #ffffff, 0 0 16px 3px ${color}`;
            }
        };

        // Helper to expand or minimize Telemetry HUD
        window.__setTelemetryExpanded = (expanded) => {
            const panel = document.getElementById('telemetry-panel');
            const body = document.getElementById('telemetry-collapsible');
            const btn = document.getElementById('btn-telemetry-minimize');
            if (!panel || !body) return;
            if (expanded && body.classList.contains('hidden')) {
                if (btn) btn.click();
                body.classList.remove('hidden');
                panel.classList.remove('minimized');
            } else if (!expanded && !body.classList.contains('hidden')) {
                if (btn) btn.click();
                body.classList.add('hidden');
                panel.classList.add('minimized');
            }
            // Place Telemetry HUD at top-right or right of sidebar?
            // Let's check: compositor puts stage headers at x=380..1200, y=32..140!
            // If we dock Telemetry HUD at right: 20px, top: 16px (x=1580..1900, y=16..480),
            // then:
            // - Left Sidebar is at x=16..364
            // - Top-Left Compositor Header is at x=380..1150, y=28..140 (100% clear!)
            // - Center 3D Viewport is at x=380..1560, y=140..880 (huge un-occluded 3D stage!)
            // - Right Telemetry HUD is at x=1585..1900, y=16..480 (100% legible, zero overlap with header or 3D center!)
            panel.style.left = 'auto';
            panel.style.right = '20px';
            panel.style.top = '16px';
            panel.style.width = '316px';
        };
    });

    const telemetry = {
        chapter1: {
            totalFrames: 450,
            fps: 30,
            stages: {},
            frames: []
        },
        chapter2: {
            totalFrames: 450,
            fps: 30,
            stages: {},
            frames: []
        }
    };

    // =========================================================================
    // CHAPTER 1 (450 frames: ch1_0000.png .. ch1_0449.png)
    // Single-File App Overview: Graph-to-Mesh + Edge-Ring-Only & Edge-Loop-Only Subdivision
    // =========================================================================
    console.log('--- Capturing Chapter 1 (450 frames) ---');

    // Initialize Dodecahedron on Tab 1 (1. Solidify)
    await page.evaluate(() => {
        const app = window.__app;
        const tab1 = document.querySelector('.ui-tab[data-tab="tab-solidify"]');
        if (tab1) tab1.click();

        app.loadPresetGraph('dodecahedron');
        app.setArctic(false); // Show vibrant Face-Loop colors with dark slate quad wireframes

        if (typeof app.setGoldilocksMode === 'function') {
            app.setGoldilocksMode('H1');
        }
        // Configure brighter quad wireframe for dark #070A10 viewport background
        if (app.solidData().quadWireObj && app.solidData().quadWireObj.material) {
            app.solidData().quadWireObj.material.color.setHex(0x0f172a);
            app.solidData().quadWireObj.material.opacity = 0.72;
        }

        // Expand Telemetry HUD at top-right so topology counts (20V·30E, 120 Quads·0 Tris, 60 planes) are visible in-situ
        window.__setTelemetryExpanded(true);
    });

    for (let f = 0; f < 450; f++) {
        // Stage transitions & state updates
        if (f === 0) {
            // Frames 0..45: Show Red Skeleton Graph (20V · 30E) + 60 Pink Pairwise Bisector Planes
            await page.evaluate(() => {
                const app = window.__app;
                const tab1 = document.querySelector('.ui-tab[data-tab="tab-solidify"]');
                if (tab1) tab1.click();

                app.solidifyParams.showGraph = true;
                app.groupVis.graph = true;
                document.getElementById('chk-show-graph').checked = true;

                app.solidifyParams.showBisectors = true;
                app.groupVis.bisectors = true;
                document.getElementById('chk-show-bisectors').checked = true;

                app.solidifyParams.showSolid = false;
                app.groupVis.solid = false;
                document.getElementById('chk-show-solid').checked = false;

                app.solidifyParams.showQuadWire = false;
                app.groupVis.quadWire = false;
                document.getElementById('chk-show-quadwire').checked = false;

                window.__highlightBtn('btn-rebuild-tubes', '#06b6d4');
                app.draw();
            });
        } else if (f >= 46 && f <= 85) {
            // Smooth transition: solidify graph into water-tight 100%-quad tubular mesh while bisectors & graph remain visible
            await page.evaluate((frameIdx) => {
                const app = window.__app;
                const u = (frameIdx - 46) / (85 - 46); // 0 -> 1
                const smooth = u * u * (3 - 2 * u);

                app.solidifyParams.showSolid = true;
                app.groupVis.solid = true;
                document.getElementById('chk-show-solid').checked = true;

                app.solidifyParams.showQuadWire = true;
                app.groupVis.quadWire = true;
                document.getElementById('chk-show-quadwire').checked = true;

                const op = Math.max(0.15, Math.min(1.0, smooth));
                app.solidifyParams.opacity = op;
                const meshObj = app.solidData().solidMeshObj;
                if (meshObj && meshObj.material) {
                    meshObj.material.opacity = op;
                    meshObj.material.transparent = op < 0.98;
                    meshObj.material.depthWrite = op >= 0.55;
                    meshObj.material.needsUpdate = true;
                }
                app.draw();
            }, f);
        } else if (f === 86) {
            // Frames 86..149: Pure water-tight 100%-quad tubular mesh (120 Quads · 0 Tris · 0 Node Hulls) with bisectors toggled off cleanly at f=105
            await page.evaluate(() => {
                const app = window.__app;
                app.solidifyParams.opacity = 1.0;
                const meshObj = app.solidData().solidMeshObj;
                if (meshObj && meshObj.material) {
                    meshObj.material.opacity = 1.0;
                    meshObj.material.transparent = false;
                    meshObj.material.depthWrite = true;
                    meshObj.material.needsUpdate = true;
                }
                app.draw();
            });
        } else if (f === 108) {
            // Turn off graph & bisectors to showcase the clean 120-quad manifold tubular shell & 24 face loops
            await page.evaluate(() => {
                const app = window.__app;
                app.solidifyParams.showBisectors = false;
                app.groupVis.bisectors = false;
                document.getElementById('chk-show-bisectors').checked = false;

                app.solidifyParams.showGraph = false;
                app.groupVis.graph = false;
                document.getElementById('chk-show-graph').checked = false;

                app.faceLoopData().showLoopPaths = true;
                app.groupVis.loopPaths = true;
                const chkPaths = document.getElementById('chk-show-loop-paths');
                if (chkPaths) chkPaths.checked = true;
                app.draw();
            });
        } else if (f === 150) {
            // STAGE 1B (f = 150..299): Switch to Tab 2 (2. Face Loops & PQ), highlight ◎ Ring Subdiv + PQ
            // Hold base 120Q for 24 frames (0.8s) so viewer sees the button highlight & 4-sided cross-section before the split
            await page.evaluate(() => {
                const app = window.__app;
                const tab2 = document.querySelector('.ui-tab[data-tab="tab-loops"]');
                if (tab2) tab2.click();
                // Switch to H1 · Use (with Telemetry HUD expanded on the right) so controls are clean & uncluttered
                if (typeof app.setGoldilocksMode === 'function') {
                    app.setGoldilocksMode('H1');
                }
                window.__setTelemetryExpanded(true);
                window.__highlightBtn('btn-cc-ring-pq', '#ec4899');
                app.draw();
            });
        } else if (f === 178) {
            // Apply Level 1 Edge-Ring-Only Subdivision + PQ (120Q -> 240Q, 24 -> 48 strips)
            await page.evaluate(() => {
                const app = window.__app;
                const btnRingPq = document.getElementById('btn-cc-ring-pq');
                if (btnRingPq) btnRingPq.click();
                else app.applyRingOnlySubdivisionToPQStrips(1, true);
                app.draw();
            });
        } else if (f === 242) {
            // Apply Level 2 Edge-Ring-Only Subdivision + PQ (240Q -> 480Q, 48 -> 96 strips) to show smooth circular tube rings while longitudinal struts remain 1 quad long!
            await page.evaluate(() => {
                const app = window.__app;
                const btnRingPq = document.getElementById('btn-cc-ring-pq');
                if (btnRingPq) btnRingPq.click();
                else app.applyRingOnlySubdivisionToPQStrips(1, true);
                app.draw();
            });
        } else if (f === 300) {
            // STAGE 1C (f = 300..449): Reset to base 120Q, highlight ═ Long. Subdiv + PQ
            await page.evaluate(() => {
                const app = window.__app;
                app.resetMeshToPrePQ();
                app.faceLoopData().showLoopPaths = true;
                app.groupVis.loopPaths = true;
                const chkPaths = document.getElementById('chk-show-loop-paths');
                if (chkPaths) chkPaths.checked = true;
                window.__highlightBtn('btn-cc-long-pq', '#f59e0b');
                app.draw();
            });
        } else if (f === 328) {
            // Apply Level 1 Longitudinal-Only Subdivision + PQ (120Q -> 240Q, 24 strips preserved!)
            await page.evaluate(() => {
                const app = window.__app;
                const btnLongPq = document.getElementById('btn-cc-long-pq');
                if (btnLongPq) btnLongPq.click();
                else app.applyLongitudinalOnlySubdivisionToPQStrips(1, true);
                app.draw();
            });
        } else if (f === 388) {
            // Apply Level 2 Longitudinal-Only Subdivision + PQ (240Q -> 480Q, 24 strips preserved!)
            await page.evaluate(() => {
                const app = window.__app;
                const btnLongPq = document.getElementById('btn-cc-long-pq');
                if (btnLongPq) btnLongPq.click();
                else app.applyLongitudinalOnlySubdivisionToPQStrips(1, true);
                app.draw();
            });
        }

        // Calm 1.0x camera orbit (0.0035 rad/frame) around the Dodecahedron center
        // Offset target slightly to the left in camera space so the 3D Dodecahedron sits centered in the open viewport (x = 420..1560)
        const frameStats = await page.evaluate((frameIdx) => {
            const app = window.__app;
            const sd = app.solidData();
            const fd = app.faceLoopData();
            const gd = app.graphData();

            // Dodecahedron model center in Three.js Y-up world space:
            // Model Z is [0.8 .. 11.2], so world Y center is ~6.0
            const angle = 0.55 + frameIdx * 0.0035;
            const dist = 19.2;
            const elev = 6.2 + Math.sin(frameIdx * 0.007) * 1.1;

            app.controls.target.set(-0.6, 5.9, 0.2);
            app.camera.position.set(
                -0.6 + Math.sin(angle) * dist,
                elev + 5.2,
                0.2 + Math.cos(angle) * dist
            );
            app.controls.update();
            app.renderer.render(app.scene, app.camera);

            return {
                f: frameIdx,
                stage: frameIdx < 18 ? 'TITLE' : (frameIdx < 150 ? '1A_GRAPH_TO_MESH' : (frameIdx < 300 ? '1B_RING_SUBDIV' : '1C_LONG_SUBDIV')),
                graphV: gd.nodes.length,
                graphE: gd.edges.length,
                bisectors: gd.bisectors.length,
                meshV: sd.vertices.length,
                quads: sd.quads.length,
                tris: sd.triangles.length,
                loops: fd.loops.length,
                ccLevel: fd.ccLevel,
                maxRelErrPct: Number((fd.pqStats.maxRelErr * 100).toFixed(4))
            };
        }, f);

        if (f === 20 || f === 120 || f === 200 || f === 270 || f === 350 || f === 420) {
            telemetry.chapter1.stages[`f_${f}`] = frameStats;
        }
        telemetry.chapter1.frames.push(frameStats);

        await page.screenshot({
            path: path.join(OUT_DIR, `ch1_${pad4(f)}.png`)
        });
    }

    // =========================================================================
    // CHAPTER 2 (450 frames: ch2_0000.png .. ch2_0449.png)
    // In-Situ Negotiated Planar-Quad (PQ) Loop Optimization (computeQuadPlanarity & optimizeFaceLoopsToPQ)
    // =========================================================================
    console.log('--- Capturing Chapter 2 (450 frames) ---');

    // Reset to clean Dodecahedron at Longitudinal Level 1 (240 Quads, 24 Loops, 220 shared vertices)
    // Wait: let's check whether 220 shared verts is on Longitudinal Level 1 (240Q) or Base Level 0 (120Q) or Catmull-Clark Level 1!
    const sharedVertCheck = await page.evaluate(() => {
        const app = window.__app;
        app.loadPresetGraph('dodecahedron');
        const s0 = app.faceLoopData().pqStats.sharedNegotiatedVerts;
        app.applyLongitudinalOnlySubdivisionToPQStrips(1, false);
        const sLong1 = app.faceLoopData().pqStats.sharedNegotiatedVerts;
        app.resetMeshToPrePQ();
        app.applyCatmullClarkToPQStrips(1, false);
        const sCC1 = app.faceLoopData().pqStats.sharedNegotiatedVerts;
        return { s0, sLong1, sCC1 };
    });
    console.log('Shared vertex counts on Dodecahedron:', sharedVertCheck);

    // Let's check what preset/level produces 220 shared verts and 43.55% max planarity error after perturbMeshForPQTest()!
    const perturbCheck = await page.evaluate(() => {
        const app = window.__app;
        const results = {};

        // Test 1: Base Dodecahedron (120Q)
        app.loadPresetGraph('dodecahedron');
        app.perturbMeshForPQTest();
        results.base120 = {
            quads: app.solidData().quads.length,
            loops: app.faceLoopData().loops.length,
            shared: app.faceLoopData().pqStats.sharedNegotiatedVerts,
            maxErrPct: (app.faceLoopData().pqStats.maxRelErr * 100).toFixed(2)
        };

        // Test 2: Longitudinal Level 1 (240Q)
        app.loadPresetGraph('dodecahedron');
        app.applyLongitudinalOnlySubdivisionToPQStrips(1, false);
        app.perturbMeshForPQTest();
        results.long240 = {
            quads: app.solidData().quads.length,
            loops: app.faceLoopData().loops.length,
            shared: app.faceLoopData().pqStats.sharedNegotiatedVerts,
            maxErrPct: (app.faceLoopData().pqStats.maxRelErr * 100).toFixed(2)
        };

        // Test 3: Longitudinal Level 2 (480Q)
        app.loadPresetGraph('dodecahedron');
        app.applyLongitudinalOnlySubdivisionToPQStrips(2, false);
        app.perturbMeshForPQTest();
        results.long480 = {
            quads: app.solidData().quads.length,
            loops: app.faceLoopData().loops.length,
            shared: app.faceLoopData().pqStats.sharedNegotiatedVerts,
            maxErrPct: (app.faceLoopData().pqStats.maxRelErr * 100).toFixed(2)
        };

        return results;
    });
    console.log('Perturb check results:', perturbCheck);

    for (let f = 0; f < 450; f++) {
        if (f === 0) {
            // Stage 2A Part 1 (f = 0..59): Walk and color the 24 longitudinal face loops with centerline ribs (showLoopPaths = true)
            // Use Longitudinal Level 1 (240Q, 24 loops, 220 shared verts) if long240 has 220 shared verts, or whichever matches!
            await page.evaluate((pCheck) => {
                const app = window.__app;
                const tab2 = document.querySelector('.ui-tab[data-tab="tab-loops"]');
                if (tab2) tab2.click();
                window.__setTelemetryExpanded(true);

                app.loadPresetGraph('dodecahedron');
                if (pCheck.long240 && pCheck.long240.shared === 220) {
                    app.applyLongitudinalOnlySubdivisionToPQStrips(1, false);
                }

                app.faceLoopData().colorByLoop = true;
                document.getElementById('chk-color-by-loop').checked = true;
                document.getElementById('chk-color-by-loop').dispatchEvent(new Event('change'));
                app.faceLoopData().showLoopPaths = true;
                app.groupVis.loopPaths = true;
                document.getElementById('chk-show-loop-paths').checked = true;
                document.getElementById('chk-show-loop-paths').dispatchEvent(new Event('change'));

                // Enable planarity heatmap if @ui-app added it, or keep off until perturbation
                if (typeof app.setShowPlanarityHeatmap === 'function') {
                    app.setShowPlanarityHeatmap(false);
                }
                if (typeof app.showDiagonalSkewLines === 'function') {
                    app.showDiagonalSkewLines(false);
                }

                window.__highlightBtn('btn-walk-color-loops', '#06b6d4');
                app.draw();
            }, perturbCheck);
        } else if (f === 28 || f === 44) {
            // Cycle selectedLoopIdx across loops #0 -> #1 -> #2 so the viewer sees the Face Loop Walker & 2D Unrolled Strip live
            await page.evaluate((frameIdx) => {
                const app = window.__app;
                app.faceLoopData().selectedLoopIdx = frameIdx === 28 ? 1 : 2;
                const row = document.querySelector(`[data-loop-id="${app.faceLoopData().selectedLoopIdx}"]`);
                if (row) row.click();
                app.draw();
            }, f);
        } else if (f === 62) {
            // Stage 2A Part 2 (f = 62..155): Trigger perturbMeshForPQTest() in-situ!
            // Turn on planarity error heatmap & skew lines if available so warped non-planar quads glow crimson/amber!
            await page.evaluate(() => {
                const app = window.__app;
                window.__highlightBtn('btn-perturb-mesh', '#f43f5e');
                app.perturbMeshForPQTest();
                if (typeof app.setShowPlanarityHeatmap === 'function') {
                    app.setShowPlanarityHeatmap(true);
                }
                if (typeof app.showDiagonalSkewLines === 'function') {
                    app.showDiagonalSkewLines(true);
                }
                app.draw();
            });
        } else if (f === 156) {
            // Stage 2B (f = 156..315, 160f): Iterative Negotiated PQ Solver Convergence in-situ
            // Step optimizeFaceLoopsToPQ(1, 0.85) 1 iteration every 2 frames (80 iterations total!)
            await page.evaluate(() => {
                window.__highlightBtn('btn-optimize-pq', '#ec4899');
            });
        }

        // During Stage 2B (f = 156..315), run 1 iteration of optimizeFaceLoopsToPQ(1, 0.85) every 2 frames
        if (f >= 156 && f <= 315 && (f - 156) % 2 === 0) {
            await page.evaluate(() => {
                const app = window.__app;
                app.optimizeFaceLoopsToPQ(1, 0.85);
                app.draw();
            });
        }

        if (f === 316) {
            // Stage 2C (f = 316..449, 134f): Strip-Crease Preservation vs. Smooth Seam Negotiation
            // First finish full convergence to 0.0000% residual skew and show crisp colored strip borders
            await page.evaluate(() => {
                const app = window.__app;
                app.optimizeFaceLoopsToPQ(120, 0.85);
                if (typeof app.setShowPlanarityHeatmap === 'function') {
                    app.setShowPlanarityHeatmap(false);
                }
                if (typeof app.showDiagonalSkewLines === 'function') {
                    app.showDiagonalSkewLines(false);
                }
                const btnCrease = document.querySelector('.cc-mode-btn[data-cc-mode="preserve_strip_creases"]');
                if (btnCrease) {
                    btnCrease.click();
                    btnCrease.style.boxShadow = '0 0 0 2px #ffffff, 0 0 14px 2px #10b981';
                }
                app.draw();
            });
        } else if (f === 382) {
            // Second half of Stage 2C (f = 382..449): Compare with Smooth All seam mode + Catmull-Clark + PQ planarization
            await page.evaluate(() => {
                const app = window.__app;
                const btnSmooth = document.querySelector('.cc-mode-btn[data-cc-mode="smooth_all"]');
                if (btnSmooth) {
                    btnSmooth.click();
                    btnSmooth.style.boxShadow = '0 0 0 2px #ffffff, 0 0 14px 2px #06b6d4';
                }
                app.optimizeFaceLoopsToPQ(60, 0.85);
                app.draw();
            });
        }

        // Camera choreography for Chapter 2:
        // - Stage 2A (f = 0..155): Full 3D Dodecahedron orbit showing 24 loops and 3D non-planar perturbation
        // - Stage 2B (f = 156..315): Smoothly dolly in to a close-up of a 3-strut junction where 3 colored face-loop strips negotiate shared boundary vertices
        // - Stage 2C (f = 316..449): Smoothly dolly back out to frame the converged 0.0000% PQ mesh with crisp loop centerlines
        const frameStats = await page.evaluate((frameIdx) => {
            const app = window.__app;
            const sd = app.solidData();
            const fd = app.faceLoopData();

            const smoothstep = (a, b, x) => {
                const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
                return t * t * (3 - 2 * t);
            };

            // Zoom factor: 0 = full view (dist 18.8), 1 = 3-strut junction close-up (dist 11.2)
            let zoomIn = 0;
            if (frameIdx >= 130 && frameIdx < 335) {
                if (frameIdx < 175) zoomIn = smoothstep(130, 175, frameIdx);
                else if (frameIdx > 295) zoomIn = 1.0 - smoothstep(295, 335, frameIdx);
                else zoomIn = 1.0;
            }

            const angle = 2.10 + frameIdx * 0.0035;
            const dist = 18.8 * (1 - zoomIn) + 11.4 * zoomIn;
            const targetX = -0.6 * (1 - zoomIn) + 0.8 * zoomIn;
            const targetY = 5.9 * (1 - zoomIn) + 7.4 * zoomIn;
            const targetZ = 0.2 * (1 - zoomIn) + 1.6 * zoomIn;

            app.controls.target.set(targetX, targetY, targetZ);
            app.camera.position.set(
                targetX + Math.sin(angle) * dist,
                targetY + (4.8 * (1 - zoomIn) + 2.4 * zoomIn),
                targetZ + Math.cos(angle) * dist
            );
            app.controls.update();
            app.renderer.render(app.scene, app.camera);

            return {
                f: frameIdx,
                stage: frameIdx < 18 ? 'TITLE' : (frameIdx < 156 ? '2A_WALK_AND_PERTURB' : (frameIdx < 316 ? '2B_ITERATIVE_PQ_CONVERGENCE' : '2C_CONVERGED_SEAMS')),
                quads: sd.quads.length,
                loops: fd.loops.length,
                sharedVerts: fd.pqStats.sharedNegotiatedVerts,
                maxRelErrPct: Number((fd.pqStats.maxRelErr * 100).toFixed(4)),
                meanRelErrPct: Number((fd.pqStats.meanRelErr * 100).toFixed(4)),
                maxVertexShift: Number(fd.pqStats.maxVertexShift.toFixed(4))
            };
        }, f);

        if (f === 25 || f === 90 || f === 160 || f === 220 || f === 310 || f === 400) {
            telemetry.chapter2.stages[`f_${f}`] = frameStats;
        }
        telemetry.chapter2.frames.push(frameStats);

        await page.screenshot({
            path: path.join(OUT_DIR, `ch2_${pad4(f)}.png`)
        });
    }

    await browser.close();

    // Save telemetry JSON
    const metaPath = path.join(RAW_PQ, 'ch1_ch2_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(telemetry, null, 2), 'utf-8');
    console.log('Saved telemetry JSON:', metaPath);

    // Also save copy inside ch1_ch2 folder
    fs.writeFileSync(path.join(OUT_DIR, 'ch1_ch2_meta.json'), JSON.stringify(telemetry, null, 2), 'utf-8');

    // Generate 4x3 pre-encode audit sheet (w1_ch1_ch2_audit.png) via Headless Chrome HTML Grid
    console.log('Generating 4x3 pre-encode contact sheet w1_ch1_ch2_audit.png...');
    await generateAuditSheet();
    console.log('Chapters 1 & 2 capture complete!');
}

async function generateAuditSheet() {
    const auditPath = path.join(RAW_PQ, 'w1_ch1_ch2_audit.png');
    const samples = [
        ['ch1_0024.png', 'Ch1 1A-1: Graph (20V,30E) + 60 Bisectors'],
        ['ch1_0065.png', 'Ch1 1A-2: Bisector Stitching Transition'],
        ['ch1_0125.png', 'Ch1 1A-3: 100% Quad Mesh (120Q, 0 Hulls)'],
        ['ch1_0162.png', 'Ch1 1B-1: Tab 2 Ring Subdiv + PQ Selected'],
        ['ch1_0210.png', 'Ch1 1B-2: Ring-Only Lv1 (240Q, 48 Strips)'],
        ['ch1_0275.png', 'Ch1 1B-3: Ring-Only Lv2 (480Q, 96 Strips)'],
        ['ch1_0315.png', 'Ch1 1C-1: Reset 120Q + Long. Subdiv Selected'],
        ['ch1_0420.png', 'Ch1 1C-2: Long-Only Lv2 (480Q, 24 Strips)'],
        ['ch2_0045.png', 'Ch2 2A-1: 24 Longitudinal Loops & Ribs'],
        ['ch2_0110.png', 'Ch2 2A-2: 3D Non-Planar Perturb (42.77% Err)'],
        ['ch2_0210.png', 'Ch2 2B: Live Iterative PQ Negotiation'],
        ['ch2_0360.png', 'Ch2 2C: Converged PQ Mesh (0.0000% Skew)']
    ];
    const cells = samples.map(([fname, label]) => {
        const fpath = 'file:///' + path.join(OUT_DIR, fname).replace(/\\/g, '/');
        return `<div style="position:relative;width:480px;height:270px;overflow:hidden;border:1px solid #1e293b;box-sizing:border-box;">
            <img src="${fpath}" style="width:480px;height:270px;display:block;" />
            <div style="position:absolute;top:0;left:0;right:0;background:rgba(7,10,16,0.88);color:#f8fafc;font:bold 11.5px Consolas,monospace;padding:4px 8px;">${fname} | ${label}</div>
        </div>`;
    }).join('');
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#070a10;display:grid;grid-template-columns:repeat(4,480px);grid-template-rows:repeat(3,270px);width:1920px;height:810px;">${cells}</body></html>`;
    const tmpHtml = path.join(RAW_PQ, '_audit_w1.html');
    fs.writeFileSync(tmpHtml, html, 'utf-8');

    const auditBrowser = await chromium.launch({
        executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        headless: true
    });
    const auditPage = await auditBrowser.newPage({ viewport: { width: 1920, height: 810 } });
    await auditPage.goto('file:///' + tmpHtml.replace(/\\/g, '/'), { waitUntil: 'networkidle' });
    await auditPage.screenshot({ path: auditPath });
    await auditBrowser.close();
    try { fs.unlinkSync(tmpHtml); } catch (e) {}
    console.log('Saved audit sheet:', auditPath);
}

if (process.argv.includes('--audit-only')) {
    generateAuditSheet().catch(err => { console.error(err); process.exit(1); });
} else {
    main().catch(err => {
        console.error('Error in capture_pq_ch1_ch2.mjs:', err);
        process.exit(1);
    });
}

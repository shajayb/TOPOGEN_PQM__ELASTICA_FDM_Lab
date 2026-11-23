import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { chromium } from 'file:///C:/Users/shajay.b/Documents/REPOS/JavaScript_blankStart/node_modules/playwright/index.mjs';

const REPO_DIR = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL';
const OUT_DIR  = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw_pq/ch3_ch4';
const RAW_PQ   = 'c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY REPOS/DRL/video_build/raw_pq';
const URL      = 'file:///c:/Users/shajay.b/Documents/REPOS/ANTIGRAVITY%20REPOS/DRL/index.html';

fs.mkdirSync(OUT_DIR, { recursive: true });

const pad4 = (n) => String(n).padStart(4, '0');

async function main() {
    console.log('Launching Headless Chrome for Chapters 3 & 4 (900 frames @ 1920x1080)...');
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

        // 4. Patch overlay canvas drawOverlay() so the bottom status bar text in y > 900 (protected seekbar zone)
        // is suppressed while keeping R#·C# (#id) 3D-to-2D correlation badges on the laser cutting bed!
        const overlayEl = document.getElementById('overlay-canvas');
        if (overlayEl) {
            overlayEl.style.display = 'block';
            const octx = overlayEl.getContext('2d');
            const origFillText = octx.fillText.bind(octx);
            octx.fillText = function(text, x, y, maxWidth) {
                if (typeof text === 'string' && text.startsWith('units: m')) {
                    return; // Suppress bottom-left status text in protected seekbar zone (y > 900)
                }
                return origFillText(text, x, y, maxWidth);
            };
        }

        // Hide bottom-left Display HUD by default
        const dispHudEl = document.getElementById('display-hud-panel');
        if (dispHudEl) dispHudEl.style.display = 'none';
        const outlinerEl = document.getElementById('outliner');
        if (outlinerEl) outlinerEl.style.display = 'none';

        // 5. Expand Full 3-Tab Sidebar UI (exit 3-button compact card)
        const compactCard = document.getElementById('sidebar-compact-card');
        if (compactCard && !compactCard.classList.contains('hidden')) {
            const btnExpand = document.getElementById('btn-compact-expand-full') || document.getElementById('btn-sidebar-compact-toggle');
            if (btnExpand) btnExpand.click();
        }

        // Position Left Sidebar cleanly at top: 16px, left: 16px
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

        // Helper to expand or minimize Telemetry HUD docked at top-right (x=1584..1900, y=16..480)
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
            panel.style.left = 'auto';
            panel.style.right = '20px';
            panel.style.top = '16px';
            panel.style.width = '316px';
        };
    });

    const telemetry = {
        chapter3: {
            totalFrames: 450,
            fps: 30,
            exportVerification: null,
            stages: {},
            frames: []
        },
        chapter4: {
            totalFrames: 450,
            fps: 30,
            tensilePresetStats: null,
            stages: {},
            frames: []
        }
    };

    // =========================================================================
    // CHAPTER 3 (450 frames: ch3_0000.png .. ch3_0449.png)
    // Isometric Hinge Unrolling (PQ Mesh -> Unroll) & Native Rhino .3dm Export in-situ
    // =========================================================================
    console.log('--- Capturing Chapter 3 (450 frames) ---');
    // Re-capture frames 165..449 if FORCE_CH3_DUAL is true, while skipping 0..164 if already captured
    const ch3Stage3ADone = fs.existsSync(path.join(OUT_DIR, 'ch3_0000.png')) && fs.existsSync(path.join(OUT_DIR, 'ch3_0164.png'));
    const ch3DualDone = false; // Re-capture 165..449 with wide dual 3D + 2D laser bed framing!

    // Initialize Dodecahedron with Longitudinal Level 1 + Negotiated PQ (240 Quads, 24 Planar Loops)
    await page.evaluate(() => {
        const app = window.__app;
        const tab2 = document.querySelector('.ui-tab[data-tab="tab-loops"]');
        if (tab2) tab2.click();
        if (typeof app.setGoldilocksMode === 'function') {
            app.setGoldilocksMode('H1');
        }

        app.loadPresetGraph('dodecahedron');
        app.setArctic(false);
        app.applyLongitudinalOnlySubdivisionToPQStrips(1, true);
        app.optimizeFaceLoopsToPQ(100, 0.85);

        if (typeof app.setShowPlanarityHeatmap === 'function') {
            app.setShowPlanarityHeatmap(false);
        }
        if (typeof app.showDiagonalSkewLines === 'function') {
            app.showDiagonalSkewLines(false);
        }

        app.faceLoopData().colorByLoop = true;
        document.getElementById('chk-color-by-loop').checked = true;
        app.faceLoopData().showLoopPaths = true;
        app.groupVis.loopPaths = true;
        document.getElementById('chk-show-loop-paths').checked = true;

        // Ensure 3D Unrolled Strips start OFF for Stage 3A
        if (app.faceLoopData().showUnrolled3D) {
            document.getElementById('btn-unroll-3d').click();
        }

        // Open Telemetry HUD (with Face Loop Inspector list visible!)
        window.__setTelemetryExpanded(true);

        // Scroll left sidebar so #unroll-canvas is prominently visible at bottom-left
        const scrollBody = document.querySelector('#left-sidebar .sidebar-scroll-body');
        if (scrollBody) scrollBody.scrollTop = scrollBody.scrollHeight;
    });

    const loopCycleOrder = [0, 1, 2, 4, 7];

    for (let f = 0; f < 450; f++) {
        // Stage 3A (f = 0..164): In-App 2D Rigid Hinge Unrolling Inspector (unrollFaceLoop2D & #unroll-canvas)
        // Cycle selectedLoopIdx across Loops #0, #1, #2, #4, #7 (~28 frames hold per loop across f=18..164)
        if (f < 165) {
            const cycleIdx = f < 18 ? 0 : Math.min(loopCycleOrder.length - 1, Math.floor((f - 18) / 29));
            const targetLoopId = loopCycleOrder[cycleIdx];
            await page.evaluate((loopId) => {
                const app = window.__app;
                const fd = app.faceLoopData();
                if (fd.selectedLoopIdx !== loopId) {
                    fd.selectedLoopIdx = loopId;
                    const row = document.querySelector(`#face-loop-list [data-loop-id="${loopId}"]`);
                    if (row) {
                        row.click();
                        row.scrollIntoView({ block: 'nearest' });
                    }
                }
                const unrollCanvas = document.getElementById('unroll-canvas');
                if (unrollCanvas) {
                    unrollCanvas.style.boxShadow = '0 0 0 2px #38bdf8, 0 0 16px rgba(56, 189, 248, 0.45)';
                }
                app.draw();
            }, targetLoopId);
        } else if (f === 165) {
            // Stage 3B (f = 165..314, 150f): Linked 3D Mesh + 2D Laser-Cutting Bed Layout in-situ (showUnrolled3D = true, R#·C# badges)
            await page.evaluate(() => {
                const app = window.__app;
                const unrollCanvas = document.getElementById('unroll-canvas');
                if (unrollCanvas) unrollCanvas.style.boxShadow = '';

                if (!app.faceLoopData().showUnrolled3D) {
                    document.getElementById('btn-unroll-3d').click();
                }
                window.__highlightBtn('btn-unroll-3d', '#06b6d4');
                app.draw();
            });
        } else if (f > 165 && f < 315 && (f - 165) % 30 === 0) {
            // Gently cycle selected loop on the 3D mesh & laser bed so matching R#·C# badges highlight across rows
            const idx = Math.floor((f - 165) / 30) % loopCycleOrder.length;
            const lid = loopCycleOrder[idx];
            await page.evaluate((loopId) => {
                const row = document.querySelector(`#face-loop-list [data-loop-id="${loopId}"]`);
                if (row) row.click();
            }, lid);
        } else if (f === 315) {
            // Stage 3C (f = 315..449, 135f): Native Rhino .3dm & Fabrication Export Verification (buildExportBytes / rhino3dm WASM)
            const exportStats = await page.evaluate(() => {
                const app = window.__app;

                // Show & expand Outliner panel at top-right (below or in place of Telemetry HUD) so scene layers & manifold status are visible
                window.__setTelemetryExpanded(false);
                const outlinerEl = document.getElementById('outliner');
                const outlinerBody = document.getElementById('outliner-body');
                const outlinerCollapse = document.getElementById('outliner-collapse');
                if (outlinerEl) {
                    outlinerEl.style.display = 'flex';
                    outlinerEl.style.top = '16px';
                    outlinerEl.style.right = '20px';
                    outlinerEl.style.width = '296px';
                }
                if (outlinerBody && outlinerBody.classList.contains('hidden')) {
                    if (outlinerCollapse) outlinerCollapse.click();
                    outlinerBody.classList.remove('hidden');
                }
                app.refreshOutliner();

                // Highlight Export Footer buttons (Export .3dm, Export Quad .OBJ, Export Unrolled .SVG)
                window.__highlightBtn('btn-export', '#38bdf8');
                const btnObj = document.getElementById('btn-export-obj');
                if (btnObj) btnObj.style.boxShadow = '0 0 0 1.5px #22d3ee';
                const btnSvg = document.getElementById('btn-export-svg');
                if (btnSvg) btnSvg.style.boxShadow = '0 0 0 1.5px #ec4899';

                // Call window.__app.exportBytes() in-app to verify live Rhino .3dm byte payload!
                const bytes = app.exportBytes();
                const byteLength = bytes ? bytes.byteLength || bytes.length : 0;

                // Parse back with rhino.File3dm.fromByteArray to verify layers & object counts
                let layerNames = [];
                let objectCount = 0;
                if (app.rhino && bytes) {
                    const doc = app.rhino.File3dm.fromByteArray(bytes);
                    if (doc) {
                        for (let i = 0; i < doc.layers().count; i++) {
                            layerNames.push(doc.layers().get(i).name);
                        }
                        objectCount = doc.objects().count;
                        doc.delete();
                    }
                }

                const svgText = app.exportUnrolledLoopsSVG();
                const objText = app.exportQuadDominantOBJ();

                return {
                    rhino3dmBytes: byteLength,
                    rhino3dmLayers: layerNames,
                    rhino3dmObjects: objectCount,
                    svgBytes: svgText ? svgText.length : 0,
                    objBytes: objText ? objText.length : 0
                };
            });
            telemetry.chapter3.exportVerification = exportStats;
            console.log('  Stage 3C Live Rhino .3dm Export Verification:', exportStats);
        } else if (f === 375) {
            // Second half of Stage 3C (f = 375..449): Toggle Arctic Clay shading on the 3D manifold mesh while 2D unrolled strips stay color-coded!
            await page.evaluate(() => {
                const app = window.__app;
                app.setArctic(true);
                app.draw();
            });
        } else if (f === 420) {
            // Switch back to Loop-Colored view for the final 30 frames of Chapter 3
            await page.evaluate(() => {
                const app = window.__app;
                app.setArctic(false);
                app.draw();
            });
        }

        // Camera choreography for Chapter 3:
        // - Stage 3A (f = 0..164): Focused 3D orbit on the Dodecahedron at (-0.6, 5.9, 0.2), dist = 18.5
        // - Stage 3B (f = 165..314): Smoothly pan/dolly camera over frames 165..210 to frame BOTH the 3D PQ Dodecahedron on the left AND the 24-strip rectangular laser-cutting bed on the right!
        // - Stage 3C (f = 315..449): Gentle parallax sweep across the dual 3D Mesh + 2D Laser-Cutting Bed view
        const frameStats = await page.evaluate((frameIdx) => {
            const app = window.__app;
            const sd = app.solidData();
            const fd = app.faceLoopData();

            const smoothstep = (a, b, x) => {
                const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
                return t * t * (3 - 2 * t);
            };

            // Dual-view pan factor: 0 = 3D mesh centered, 1 = 3D mesh (left) + 2D laser bed (right)
            const dualPan = frameIdx < 165 ? 0.0 : smoothstep(165, 210, frameIdx);

            // Compute laser bed center in model coords (Z-up) -> world coords (Y-up: worldX = modelX, worldY = modelZ, worldZ = -modelY)
            let bedCenterX = 14.5;
            let bedCenterZ = -1.0;
            if (fd.unrolledBedLayout && fd.unrolledBedLayout.bedBounds) {
                const b = fd.unrolledBedLayout.bedBounds;
                bedCenterX = 0.5 * (b.minX + b.maxX);
                const modelMidY = 0.5 * (b.minY + b.maxY);
                bedCenterZ = -modelMidY;
            }

            // Target in 3D mesh mode: (-0.6, 5.9, 0.2)
            // Target in Dual 3D + 2D Bed mode: frame BOTH the 3D Dodecahedron (x in [-5.2..5.2], y in [0.8..11.2]) AND the 2D Laser Bed (x in [8.7..56.7], z in [-16..16])
            // Using targetX = 16.5, dist = 62.0, camElev = 28.0 puts the 3D Dodecahedron clearly at x ~ 460..760 (left of open viewport) and the 24-strip Laser Bed at x ~ 820..1820 (right)!
            const dualTargetX = 0.25 * 0.0 + 0.55 * bedCenterX - 1.5;
            const dualTargetY = 3.6;
            const dualTargetZ = 0.45 * bedCenterZ;

            const targetX = -0.6 * (1 - dualPan) + dualTargetX * dualPan;
            const targetY = 5.9 * (1 - dualPan) + dualTargetY * dualPan;
            const targetZ = 0.2 * (1 - dualPan) + dualTargetZ * dualPan;

            const baseAngle = 0.35 + (frameIdx < 165 ? frameIdx * 0.0035 : (165 * 0.0035 + (frameIdx - 165) * 0.0012));
            const angle = baseAngle * (1 - dualPan) + (0.04 + (frameIdx - 165) * 0.0010) * dualPan;

            const dist = 18.6 * (1 - dualPan) + 58.0 * dualPan;
            const camElev = 5.0 * (1 - dualPan) + 27.5 * dualPan;

            app.controls.target.set(targetX, targetY, targetZ);
            app.camera.position.set(
                targetX + Math.sin(angle) * dist,
                targetY + camElev,
                targetZ + Math.cos(angle) * dist
            );
            app.controls.update();
            app.renderer.render(app.scene, app.camera);
            // Re-project 2D R#·C# overlay badges for current camera matrix
            app.step(0);

            const selLoop = fd.loops[fd.selectedLoopIdx] || fd.loops[0];
            return {
                f: frameIdx,
                stage: frameIdx < 18 ? 'TITLE' : (frameIdx < 165 ? '3A_2D_HINGE_UNROLL_INSPECTOR' : (frameIdx < 315 ? '3B_3D_CORRELATED_LASER_BED' : '3C_RHINO_3DM_EXPORT')),
                selectedLoopId: fd.selectedLoopIdx,
                selectedLoopQuads: selLoop ? selLoop.steps.length : 0,
                showUnrolled3D: fd.showUnrolled3D,
                bedStrips: fd.unrolledBedLayout ? fd.unrolledBedLayout.length : 0,
                bedRows: (fd.unrolledBedLayout && fd.unrolledBedLayout.bedBounds) ? fd.unrolledBedLayout.bedBounds.numRows : 0,
                arctic: app.arctic()
            };
        }, f);

        if (f === 25 || f === 85 || f === 150 || f === 225 || f === 300 || f === 350 || f === 400) {
            telemetry.chapter3.stages[`f_${f}`] = frameStats;
        }
        telemetry.chapter3.frames.push(frameStats);

        const skipCh3Frame = (f < 165 && ch3Stage3ADone) || (f >= 165 && ch3DualDone);
        if (!skipCh3Frame) {
            await page.screenshot({
                path: path.join(OUT_DIR, `ch3_${pad4(f)}.png`)
            });
        }
    }

    // =========================================================================
    // CHAPTER 4 (450 frames: ch4_0000.png .. ch4_0449.png)
    // Outlook — Negotiated PQ & Unrolling on a Topologically Complex Tensile Network (tensile_network)
    // =========================================================================
    console.log('--- Capturing Chapter 4 (450 frames) ---');
    const ch4AlreadyDone = fs.existsSync(path.join(OUT_DIR, 'ch4_0000.png')) && fs.existsSync(path.join(OUT_DIR, 'ch4_0449.png'));
    if (ch4AlreadyDone) {
        console.log('  Chapter 4 frames ch4_0000.png .. ch4_0449.png already exist! Running fast metadata pass...');
    }

    // Load tensile_network preset and record its topology & valence distribution
    const tensileStats = await page.evaluate(() => {
        const app = window.__app;

        // Hide Outliner and re-open Telemetry HUD at top-right
        const outlinerEl = document.getElementById('outliner');
        if (outlinerEl) outlinerEl.style.display = 'none';
        window.__setTelemetryExpanded(true);

        // Switch to Tab 1 (1. Solidify) for Stage 4A
        const tab1 = document.querySelector('.ui-tab[data-tab="tab-solidify"]');
        if (tab1) tab1.click();
        const scrollBody = document.querySelector('#left-sidebar .sidebar-scroll-body');
        if (scrollBody) scrollBody.scrollTop = 0;

        app.setArctic(false);
        if (app.faceLoopData().showUnrolled3D) {
            document.getElementById('btn-unroll-3d').click();
        }

        const presetKey = app.PRESETS.includes('tensile_network') ? 'tensile_network' : 'space_truss';
        app.loadPresetGraph(presetKey);

        const gd = app.graphData();
        const sd = app.solidData();
        const fd = app.faceLoopData();
        const valences = {};
        gd.nodes.forEach(n => {
            valences[n.valence] = (valences[n.valence] || 0) + 1;
        });

        return {
            presetKey,
            name: gd.name,
            nodes: gd.nodes.length,
            edges: gd.edges.length,
            bisectors: gd.bisectors.length,
            valences,
            baseMeshV: sd.vertices.length,
            baseQuads: sd.quads.length,
            baseTris: sd.triangles.length,
            baseLoops: fd.loops.length,
            boundaryEdges: sd.verification.boundaryEdges,
            nonManifoldEdges: sd.verification.nonManifoldEdges,
            euler: sd.verification.euler,
            genus: sd.verification.genus
        };
    });
    telemetry.chapter4.tensilePresetStats = tensileStats;
    console.log('  Tensile Network Preset Stats:', tensileStats);

    for (let f = 0; f < 450; f++) {
        if (f === 0) {
            // Stage 4A Part 1 (f = 0..48): Complex 3D catenary tensile graph centerlines + multi-valence bisector planes (valence 3, 4, 5)
            await page.evaluate(() => {
                const app = window.__app;
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

                const btnPreset = document.querySelector('#preset-grid [data-preset="tensile_network"]');
                if (btnPreset) {
                    btnPreset.style.boxShadow = '0 0 0 2px #ffffff, 0 0 16px 3px #06b6d4';
                }
                app.draw();
            });
        } else if (f >= 49 && f <= 92) {
            // Stage 4A Part 2 (f = 49..92): Smoothly solidify via direct bisector stitching into high-genus water-tight quad shell (0 node hulls)
            await page.evaluate((frameIdx) => {
                const app = window.__app;
                const u = (frameIdx - 49) / (92 - 49);
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
                window.__highlightBtn('btn-rebuild-tubes', '#ec4899');
                app.draw();
            }, f);
        } else if (f === 93) {
            // Stage 4A Part 3 (f = 93..149): Clean solidified high-genus tensile tubular shell
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
                app.solidifyParams.showBisectors = false;
                app.groupVis.bisectors = false;
                document.getElementById('chk-show-bisectors').checked = false;

                app.solidifyParams.showGraph = false;
                app.groupVis.graph = false;
                document.getElementById('chk-show-graph').checked = false;

                app.faceLoopData().showLoopPaths = true;
                app.groupVis.loopPaths = true;
                document.getElementById('chk-show-loop-paths').checked = true;
                app.draw();
            });
        } else if (f === 150) {
            // Stage 4B (f = 150..299, 150f): Longitudinal Subdivision + Negotiated PQ Optimization on the Tensile Network
            await page.evaluate(() => {
                const app = window.__app;
                const tab2 = document.querySelector('.ui-tab[data-tab="tab-loops"]');
                if (tab2) tab2.click();

                // Apply Longitudinal-Only Subdivision Level 1 (without immediate PQ so we can step optimizeFaceLoopsToPQ live from 9.2940% -> 0.0001%!)
                app.applyLongitudinalOnlySubdivisionToPQStrips(1, false);
                if (typeof app.setShowPlanarityHeatmap === 'function') {
                    app.setShowPlanarityHeatmap(true);
                }
                if (typeof app.showDiagonalSkewLines === 'function') {
                    app.showDiagonalSkewLines(true);
                }
                window.__highlightBtn('btn-cc-long-only', '#06b6d4');
                app.draw();
            });
        } else if (f === 180) {
            // Start stepping optimizeFaceLoopsToPQ in-situ across frames 180..275
            await page.evaluate(() => {
                window.__highlightBtn('btn-optimize-pq', '#ec4899');
            });
        } else if (f >= 180 && f <= 275 && (f - 180) % 2 === 0) {
            await page.evaluate(() => {
                const app = window.__app;
                app.optimizeFaceLoopsToPQ(2, 0.85);
                app.draw();
            });
        } else if (f === 276) {
            // Finalize PQ convergence on the subdivided tensile canopy and display loop colors
            await page.evaluate(() => {
                const app = window.__app;
                if (typeof app.setShowPlanarityHeatmap === 'function') {
                    app.setShowPlanarityHeatmap(false);
                }
                if (typeof app.showDiagonalSkewLines === 'function') {
                    app.showDiagonalSkewLines(false);
                }
                app.optimizeFaceLoopsToPQ(80, 0.85);
                app.draw();
            });
        } else if (f === 300) {
            // Stage 4C (f = 300..449, 150f): Full 3D Tensile Canopy + Complete 2D Unrolled Laser-Cutting Sheet Finale
            await page.evaluate(() => {
                const app = window.__app;
                if (!app.faceLoopData().showUnrolled3D) {
                    document.getElementById('btn-unroll-3d').click();
                }
                window.__highlightBtn('btn-unroll-3d', '#10b981');
                const scrollBody = document.querySelector('#left-sidebar .sidebar-scroll-body');
                if (scrollBody) scrollBody.scrollTop = scrollBody.scrollHeight;
                app.draw();
            });
        }

        // Camera choreography for Chapter 4:
        // - Stage 4A & 4B (f = 0..299): Dynamic 1.0x architectural orbit around the 3D catenary tensile canopy pavilion
        // - Stage 4C (f = 300..449): Smoothly pan/dolly out over frames 300..345 to showcase the 3D planar-quad tensile canopy alongside its entire nested 2D laser-cutting bed of developable PQ strips!
        const frameStats = await page.evaluate((frameIdx) => {
            const app = window.__app;
            const sd = app.solidData();
            const fd = app.faceLoopData();

            const smoothstep = (a, b, x) => {
                const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
                return t * t * (3 - 2 * t);
            };

            const dualPan = frameIdx < 300 ? 0.0 : smoothstep(300, 348, frameIdx);

            // Compute model bounding box in world coordinates for the tensile canopy
            const box = new app.scene.constructor().children ? null : null;
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
            sd.vertices.forEach(v => {
                if (v.x < minX) minX = v.x;
                if (v.x > maxX) maxX = v.x;
                if (v.y < minY) minY = v.y;
                if (v.y > maxY) maxY = v.y;
                if (v.z < minZ) minZ = v.z;
                if (v.z > maxZ) maxZ = v.z;
            });
            if (!isFinite(minX)) {
                minX = -6; maxX = 6; minY = -6; maxY = 6; minZ = 0; maxZ = 6;
            }
            // Model (x, y, z) with mainGroup.rotation.x = -PI/2 maps to World (x, z, -y)
            const modelCenterX = 0.5 * (minX + maxX);
            const modelCenterY = 0.5 * (minY + maxY);
            const modelCenterZ = 0.5 * (minZ + maxZ);
            const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 10.0);

            const canopyWorldX = modelCenterX - 0.8;
            const canopyWorldY = modelCenterZ;
            const canopyWorldZ = -modelCenterY;

            let bedCenterX = maxX + 12.0;
            let bedCenterZ = canopyWorldZ;
            let bedSpan = span * 1.8;
            if (fd.unrolledBedLayout && fd.unrolledBedLayout.bedBounds) {
                const b = fd.unrolledBedLayout.bedBounds;
                bedCenterX = 0.5 * (b.minX + b.maxX);
                bedCenterZ = -0.5 * (b.minY + b.maxY);
                bedSpan = Math.max(b.width, b.height, span);
            }

            const dualTargetX = 0.38 * canopyWorldX + 0.62 * bedCenterX - 1.5;
            const dualTargetY = canopyWorldY * 0.65;
            const dualTargetZ = 0.45 * canopyWorldZ + 0.55 * bedCenterZ;

            const targetX = canopyWorldX * (1 - dualPan) + dualTargetX * dualPan;
            const targetY = canopyWorldY * (1 - dualPan) + dualTargetY * dualPan;
            const targetZ = canopyWorldZ * (1 - dualPan) + dualTargetZ * dualPan;

            const orbitAngle = 0.48 + frameIdx * 0.0032;
            const dualAngle = 0.06 + (frameIdx - 300) * 0.0011;
            const angle = orbitAngle * (1 - dualPan) + dualAngle * dualPan;

            const baseDist = span * 1.52;
            const dualDist = Math.max(38.0, (bedCenterX - minX + bedSpan * 0.55) * 1.08);
            const dist = baseDist * (1 - dualPan) + dualDist * dualPan;
            const elev = (span * 0.52) * (1 - dualPan) + (dualDist * 0.58) * dualPan;

            app.controls.target.set(targetX, targetY, targetZ);
            app.camera.position.set(
                targetX + Math.sin(angle) * dist,
                targetY + elev,
                targetZ + Math.cos(angle) * dist
            );
            app.controls.update();
            app.renderer.render(app.scene, app.camera);
            app.step(0);

            return {
                f: frameIdx,
                stage: frameIdx < 18 ? 'TITLE' : (frameIdx < 150 ? '4A_TENSILE_SOLIDIFY' : (frameIdx < 300 ? '4B_TENSILE_SUBDIV_PQ' : '4C_TENSILE_UNROLL_FINALE')),
                meshV: sd.vertices.length,
                quads: sd.quads.length,
                tris: sd.triangles.length,
                loops: fd.loops.length,
                maxRelErrPct: Number((fd.pqStats.maxRelErr * 100).toFixed(4)),
                meanRelErrPct: Number((fd.pqStats.meanRelErr * 100).toFixed(4)),
                showUnrolled3D: fd.showUnrolled3D,
                bedStrips: fd.unrolledBedLayout ? fd.unrolledBedLayout.length : 0
            };
        }, f);

        if (f === 25 || f === 75 || f === 125 || f === 165 || f === 225 || f === 285 || f === 360 || f === 430) {
            telemetry.chapter4.stages[`f_${f}`] = frameStats;
        }
        telemetry.chapter4.frames.push(frameStats);

        if (!ch4AlreadyDone) {
            await page.screenshot({
                path: path.join(OUT_DIR, `ch4_${pad4(f)}.png`)
            });
        }
    }

    // Save telemetry JSON
    const metaPath = path.join(RAW_PQ, 'ch3_ch4_meta.json');
    fs.writeFileSync(metaPath, JSON.stringify(telemetry, null, 2), 'utf-8');
    console.log('Saved telemetry JSON:', metaPath);

    // Also save copy inside ch3_ch4 folder
    fs.writeFileSync(path.join(OUT_DIR, 'ch3_ch4_meta.json'), JSON.stringify(telemetry, null, 2), 'utf-8');

    // Generate 4x3 pre-encode audit sheet (w2_ch3_ch4_audit.png) directly inside Headless Chrome Canvas!
    console.log('Generating 4x3 pre-encode contact sheet w2_ch3_ch4_audit.png...');
    const auditSamples = [
        ["ch3_0025.png", "Ch3 3A-1: Loop #0 2D Hinge Unroll Inspector"],
        ["ch3_0085.png", "Ch3 3A-2: Loop #2 Unrolled Strip & Fold Hinges"],
        ["ch3_0150.png", "Ch3 3A-3: Loop #7 2D Unrolled Strip Preview"],
        ["ch3_0225.png", "Ch3 3B-1: Linked 3D Mesh + 24-Strip Laser Bed"],
        ["ch3_0300.png", "Ch3 3B-2: R#·C# Elevation-Sorted Correlation"],
        ["ch3_0350.png", "Ch3 3C-1: Outliner & Native Rhino .3dm Export"],
        ["ch3_0400.png", "Ch3 3C-2: Arctic Clay + Colored 2D Laser Bed"],
        ["ch4_0025.png", "Ch4 4A-1: Tensile Network Graph + Bisectors"],
        ["ch4_0125.png", "Ch4 4A-2: High-Genus Bisector-Stitched Shell"],
        ["ch4_0170.png", "Ch4 4B-1: Long. Subdiv + Planarity Heatmap"],
        ["ch4_0285.png", "Ch4 4B-2: Converged Planar-Quad Tensile Canopy"],
        ["ch4_0390.png", "Ch4 4C: 3D Tensile Canopy + Full 2D Laser Sheet"]
    ];

    const auditPage = await context.newPage();
    const cellsHtml = auditSamples.map(([fname, label]) => {
        const fpath = path.join(OUT_DIR, fname);
        const b64 = fs.existsSync(fpath) ? fs.readFileSync(fpath).toString('base64') : '';
        const dataUri = b64 ? `data:image/png;base64,${b64}` : '';
        return `<div style="position:relative;width:480px;height:270px;overflow:hidden;border:1px solid #1e293b;box-sizing:border-box;">
            <img src="${dataUri}" style="width:480px;height:270px;display:block;object-fit:cover;"/>
            <div style="position:absolute;top:0;left:0;right:0;height:24px;background:rgba(7,10,16,0.88);color:#f8fafc;font:bold 11px Consolas,monospace;line-height:24px;padding:0 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${fname} | ${label}
            </div>
        </div>`;
    }).join('');
    await auditPage.setContent(`<!DOCTYPE html><html><body style="margin:0;padding:0;background:#070a10;width:1920px;height:810px;display:grid;grid-template-columns:repeat(4,480px);grid-template-rows:repeat(3,270px);">${cellsHtml}</body></html>`, { waitUntil: 'load' });
    await auditPage.setViewportSize({ width: 1920, height: 810 });
    const auditPath = path.join(RAW_PQ, 'w2_ch3_ch4_audit.png');
    await auditPage.screenshot({ path: auditPath, clip: { x: 0, y: 0, width: 1920, height: 810 } });
    await auditPage.close();
    console.log('Saved audit sheet:', auditPath);

    await browser.close();
    console.log('Chapters 3 & 4 capture complete!');
}

main().catch(err => {
    console.error('Error in capture_pq_ch3_ch4.mjs:', err);
    process.exit(1);
});

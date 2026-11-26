import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLIPS_DIR = path.resolve(REPO_ROOT, 'video_build/procedural_chains_video/clips');
const WALKTHROUGH_DIR = path.resolve(CLIPS_DIR, 'walkthrough');
const BRAIN_SCREENSHOT = 'C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/90cceb12-f31e-4ff5-8f07-4fc5bd4a7a6b/walkthrough_representative.png';
const CHROME_EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const LAB_PORT = 8892;
const CDP_PORT = 9232;
const APP_URL = `http://127.0.0.1:${LAB_PORT}/index_TOPOGEN_PQM_ELASTICA_FDM.html`;

const TEMP_ROOT = path.join(os.tmpdir(), `topogen_walkthrough_${Date.now()}`);
const USER_DATA_DIR = path.join(TEMP_ROOT, 'chrome_profile');
const FRAMES_ROOT = path.join(TEMP_ROOT, 'frames');

fs.mkdirSync(CLIPS_DIR, { recursive: true });
fs.mkdirSync(WALKTHROUGH_DIR, { recursive: true });
fs.mkdirSync(USER_DATA_DIR, { recursive: true });
fs.mkdirSync(FRAMES_ROOT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad4 = (n) => String(n).padStart(4, '0');

class CdpClient {
    constructor(wsUrl) {
        this.wsUrl = wsUrl;
        this.ws = null;
        this.nextId = 1;
        this.pending = new Map();
    }
    async connect() {
        await new Promise((resolve, reject) => {
            const ws = new WebSocket(this.wsUrl);
            this.ws = ws;
            ws.addEventListener('open', () => resolve());
            ws.addEventListener('error', (err) => reject(err));
            ws.addEventListener('message', (ev) => {
                const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ev.data.toString());
                if (msg.id && this.pending.has(msg.id)) {
                    const { resolve, reject } = this.pending.get(msg.id);
                    this.pending.delete(msg.id);
                    if (msg.error) reject(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
                    else resolve(msg.result);
                }
            });
        });
    }
    send(method, params = {}) {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }
    async eval(expression) {
        const res = await this.send('Runtime.evaluate', {
            expression,
            awaitPromise: true,
            returnByValue: true
        });
        if (res.exceptionDetails) {
            throw new Error(`JS eval error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
        }
        return res.result ? res.result.value : undefined;
    }
    close() {
        if (this.ws) {
            try { this.ws.close(); } catch {}
        }
    }
}

async function waitForHttp(url, timeoutMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return true;
        } catch {}
        await sleep(200);
    }
    throw new Error(`Timeout waiting for ${url}`);
}

async function waitForPageTarget(cdpPort, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`http://127.0.0.1:${cdpPort}/json/list`);
            if (res.ok) {
                const list = await res.json();
                const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
                if (page) return page;
            }
        } catch {}
        await sleep(250);
    }
    throw new Error(`Timeout waiting for Chrome CDP target on port ${cdpPort}`);
}

class ClipRecorder {
    constructor(cdp, clipName) {
        this.cdp = cdp;
        this.clipName = clipName;
        this.dir = path.join(FRAMES_ROOT, clipName);
        fs.mkdirSync(this.dir, { recursive: true });
        this.frameIdx = 0;
        this.cursorX = 960;
        this.cursorY = 540;
    }

    async captureFrame() {
        const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
        const outPath = path.join(this.dir, `frame_${pad4(this.frameIdx)}.png`);
        fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
        this.frameIdx++;
        return outPath;
    }

    async hold(frames) {
        for (let i = 0; i < frames; i++) {
            await sleep(20);
            await this.captureFrame();
        }
    }

    async setCursorVisual(x, y, clicking = false) {
        await this.cdp.eval(`(() => {
            const c = document.getElementById('demo-cursor');
            if (!c) return;
            c.style.left = ${x} + 'px';
            c.style.top = ${y} + 'px';
            c.style.opacity = '1';
            c.style.transform = 'translate(-50%, -50%) scale(' + (${clicking} ? '0.82' : '1') + ')';
        })()`);
    }

    async pulseRipple(x, y) {
        await this.cdp.eval(`(() => {
            const r = document.createElement('div');
            r.className = 'demo-click-ripple';
            r.style.left = ${x} + 'px';
            r.style.top = ${y} + 'px';
            document.body.appendChild(r);
            setTimeout(() => r.remove(), 420);
        })()`);
    }

    async moveTo(tx, ty, frames = 14) {
        const sx = this.cursorX;
        const sy = this.cursorY;
        for (let i = 1; i <= frames; i++) {
            const t = i / frames;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const x = Math.round(sx + (tx - sx) * ease);
            const y = Math.round(sy + (ty - sy) * ease);
            this.cursorX = x;
            this.cursorY = y;
            await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
            await this.setCursorVisual(x, y, false);
            await this.captureFrame();
        }
    }

    async getElementCenter(selector) {
        const box = await this.cdp.eval(`(() => {
            const el = document.querySelector(${JSON.stringify(selector)});
            if (!el) return null;
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            const r = el.getBoundingClientRect();
            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) };
        })()`);
        if (!box || (box.w === 0 && box.h === 0)) {
            throw new Error(`Element not visible or not found: ${selector}`);
        }
        return box;
    }

    async clickSelector(selector, moveFrames = 14, holdAfterFrames = 8) {
        const box = await this.getElementCenter(selector);
        await this.moveTo(box.x, box.y, moveFrames);
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        await this.setCursorVisual(box.x, box.y, true);
        await this.pulseRipple(box.x, box.y);
        await this.captureFrame();
        await this.captureFrame();
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
        await this.setCursorVisual(box.x, box.y, false);
        await sleep(80);
        await this.hold(holdAfterFrames);
        return box;
    }

    async orbitDrag(startX, startY, endX, endY, dragFrames = 60, moveFrames = 10) {
        await this.moveTo(startX, startY, moveFrames);
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: startX, y: startY, button: 'left', clickCount: 1 });
        await this.setCursorVisual(startX, startY, true);
        for (let i = 1; i <= dragFrames; i++) {
            const t = i / dragFrames;
            const ease = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            const x = Math.round(startX + (endX - startX) * ease);
            const y = Math.round(startY + (endY - startY) * ease);
            this.cursorX = x;
            this.cursorY = y;
            await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 });
            await this.setCursorVisual(x, y, true);
            await sleep(16);
            await this.captureFrame();
        }
        await this.cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: endX, y: endY, button: 'left', clickCount: 1 });
        await this.setCursorVisual(endX, endY, false);
        await this.captureFrame();
    }

    async typeText(text, framesPerChar = 2) {
        for (const ch of text) {
            await this.cdp.send('Input.insertText', { text: ch });
            await this.hold(framesPerChar);
        }
    }

    async padToTotalFrames(targetFrames) {
        while (this.frameIdx < targetFrames) {
            await sleep(16);
            await this.captureFrame();
        }
    }

    encode(outputMp4) {
        console.log(`Encoding ${this.clipName}: ${this.frameIdx} frames -> ${outputMp4}`);
        execFileSync('ffmpeg', [
            '-y',
            '-framerate', '30',
            '-i', path.join(this.dir, 'frame_%04d.png'),
            '-c:v', 'libx264',
            '-preset', 'slow',
            '-crf', '16',
            '-pix_fmt', 'yuv420p',
            '-r', '30',
            '-movflags', '+faststart',
            outputMp4
        ], { stdio: 'inherit' });
    }
}

async function applyUiHygiene(cdp) {
    await cdp.eval(`(() => {
        // 1. Park Display HUD bottom-right so it NEVER overlaps #viewport-chain-timeline (bottom center x=620..1300)
        const disp = document.getElementById('display-hud-panel');
        if (disp) {
            disp.style.left = 'auto';
            disp.style.right = '12px';
            disp.style.bottom = '28px';
            disp.style.top = 'auto';
            if (!disp.classList.contains('minimized')) {
                document.getElementById('btn-display-hud-minimize')?.click();
            }
        }
        // 2. Park Telemetry HUD minimized top-right-of-center so top-left/top-center stay open
        const tel = document.getElementById('telemetry-panel');
        if (tel) {
            tel.style.left = 'auto';
            tel.style.right = '284px';
            tel.style.top = '12px';
            if (!tel.classList.contains('minimized')) {
                document.getElementById('btn-telemetry-minimize')?.click();
            }
        }
        // 3. Ensure Outliner is minimized top-right
        const out = document.getElementById('outliner');
        if (out) {
            out.style.right = '12px';
            out.style.top = '12px';
            if (!out.classList.contains('minimized') && !out.classList.contains('collapsed')) {
                const body = out.querySelector('.outliner-body, #outliner-body');
                if (body && body.offsetHeight > 0) {
                    document.getElementById('outliner-collapse')?.click();
                }
            }
        }
        // 4. Hide #overlay-canvas debug text in bottom zone
        const ov = document.getElementById('overlay-canvas');
        if (ov) ov.style.display = 'none';

        // 5. Inject subtle, crisp Computer-Use cursor indicator
        if (!document.getElementById('demo-cursor')) {
            const style = document.createElement('style');
            style.textContent = \`
                #demo-cursor {
                    position: fixed;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    border: 2.5px solid #2563EB;
                    background: rgba(255, 255, 255, 0.85);
                    box-shadow: 0 2px 10px rgba(15, 23, 42, 0.35);
                    pointer-events: none;
                    z-index: 999999;
                    left: 960px;
                    top: 540px;
                    transform: translate(-50%, -50%);
                    transition: transform 0.08s ease;
                }
                .demo-click-ripple {
                    position: fixed;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: 2.5px solid #2563EB;
                    background: rgba(37, 99, 235, 0.18);
                    pointer-events: none;
                    z-index: 999998;
                    transform: translate(-50%, -50%) scale(0.5);
                    animation: demoRipple 0.38s ease-out forwards;
                }
                @keyframes demoRipple {
                    to { transform: translate(-50%, -50%) scale(1.65); opacity: 0; }
                }
            \`;
            document.head.appendChild(style);
            const cur = document.createElement('div');
            cur.id = 'demo-cursor';
            document.body.appendChild(cur);
        }
    })()`);
}

async function setSidebarMinimized(cdp, wantMinimized) {
    await cdp.eval(`(() => {
        const sb = document.getElementById('left-sidebar');
        if (!sb) return;
        const isMin = sb.classList.contains('minimized');
        if (isMin !== ${wantMinimized}) {
            document.getElementById('btn-sidebar-minimize')?.click();
        }
    })()`);
}

async function main() {
    const existingChainsDir = path.join(REPO_ROOT, 'TOPOGEN_FDM_Foundry', 'chains');
    const preExistingChains = fs.existsSync(existingChainsDir)
        ? new Set(fs.readdirSync(existingChainsDir))
        : new Set();

    console.log(`Starting serve_lab.mjs on port ${LAB_PORT}...`);
    const labProc = spawn(process.execPath, [path.join(REPO_ROOT, 'TOPOGEN_FDM_Foundry/serve_lab.mjs'), String(LAB_PORT)], {
        cwd: REPO_ROOT,
        stdio: 'pipe'
    });
    labProc.stdout.on('data', (d) => process.stdout.write(`[lab] ${d}`));
    labProc.stderr.on('data', (d) => process.stderr.write(`[lab-err] ${d}`));

    let chromeProc = null;
    let cdp = null;

    try {
        await waitForHttp(APP_URL, 15000);
        console.log('Lab server ready. Launching Headless Chrome...');

        chromeProc = spawn(CHROME_EXE, [
            '--headless=new',
            '--disable-gpu-sandbox',
            '--use-gl=angle',
            '--use-angle=swiftshader-webgl',
            '--enable-webgl',
            '--ignore-gpu-blocklist',
            '--window-size=1920,1080',
            '--force-device-scale-factor=1',
            '--hide-scrollbars',
            `--remote-debugging-port=${CDP_PORT}`,
            `--user-data-dir=${USER_DATA_DIR}`,
            APP_URL
        ], { stdio: 'ignore' });

        const target = await waitForPageTarget(CDP_PORT, 20000);
        cdp = new CdpClient(target.webSocketDebuggerUrl);
        await cdp.connect();

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            mobile: false
        });

        console.log('Waiting for Topogen window.__app.ready...');
        await cdp.eval(`(async () => {
            const t0 = Date.now();
            while (!window.__app || !window.__app.ready) {
                if (Date.now() - t0 > 30000) throw new Error('Timed out waiting for window.__app.ready');
                await new Promise(r => setTimeout(r, 100));
            }
            await window.__app.ready;
            return true;
        })()`);
        await sleep(600);

        await applyUiHygiene(cdp);
        await sleep(300);

        // =========================================================================
        // CLIP 2A: Record Steps · Tiles -> Topo -> PQ Mesh (270 frames, 9.0s)
        // =========================================================================
        console.log('\n--- Capturing Clip 2A: Create Steps (270 frames / 9.0s) ---');
        await setSidebarMinimized(cdp, false);
        await cdp.eval(`(() => {
            document.querySelector('.ui-tab[data-tab="tab-io"]')?.click();
            document.getElementById('btn-chain-clear')?.click();
        })()`);
        await sleep(350);

        const rec2a = new ClipRecorder(cdp, 'clip_2a_create_steps');
        rec2a.cursorX = 680;
        rec2a.cursorY = 340;
        await rec2a.hold(10);

        // 0.0-2.5s: Tab 1. Tiles -> Enable Arch Vault (id 8)
        await rec2a.clickSelector('.ui-tab[data-tab="tab-tiles"]', 14, 10);
        await rec2a.clickSelector('#tile-catalog .tile-toggle-btn[data-tile-id="8"]', 16, 22);

        // 2.5-5.5s: Tab 2. Topo -> 3x3x4 preset -> Collapse Full Grid Now
        await rec2a.clickSelector('.ui-tab[data-tab="tab-topo"]', 14, 8);
        await rec2a.clickSelector('#tab-topo .res-preset-btn[data-rx="3"][data-ry="3"][data-rz="4"]', 14, 10);
        await rec2a.clickSelector('#btn-sim-collapse-all', 14, 34);

        // 5.5-9.0s: Tab 3. PQ Mesh -> Solidify -> Ring Subdiv
        await rec2a.clickSelector('.ui-tab[data-tab="tab-pq"]', 14, 10);
        await rec2a.clickSelector('#btn-solidify-tubes', 14, 34);
        await rec2a.clickSelector('#btn-ring-subdiv-pq', 14, 34);

        await rec2a.padToTotalFrames(270);
        const clip2aPath = path.join(CLIPS_DIR, 'clip_2a_create_steps.mp4');
        rec2a.encode(clip2aPath);

        // =========================================================================
        // CLIP 2B: Save Camera View & Export/Save Chain (255 frames, 8.5s)
        // =========================================================================
        console.log('\n--- Capturing Clip 2B: Bookmark & Save (255 frames / 8.5s) ---');
        const rec2b = new ClipRecorder(cdp, 'clip_2b_bookmark_save');
        rec2b.cursorX = rec2a.cursorX;
        rec2b.cursorY = rec2a.cursorY;
        await rec2b.hold(6);

        // 0.0-2.2s: Smooth real mouse orbit on 3D canvas to dramatic low hero angle
        await rec2b.orbitDrag(1080, 560, 1260, 480, 48, 10);
        await rec2b.hold(6);

        // 2.2-5.2s: Expand bottom-right Display HUD -> + Save View -> type "Hero Arch" -> Confirm -> Collapse Display HUD
        await rec2b.clickSelector('#btn-display-hud-minimize', 14, 8);
        await rec2b.clickSelector('#btn-cam-save-toggle', 10, 6);
        await rec2b.clickSelector('#inp-cam-bookmark-name', 10, 4);
        await rec2b.typeText('Hero Arch', 2);
        await rec2b.clickSelector('#btn-cam-save-confirm', 10, 12);
        await rec2b.clickSelector('#btn-display-hud-minimize', 10, 6);

        // 5.2-8.5s: Switch to 7. I/O -> show step count badge -> click Save to Repo -> hold 2s showing "Saved -> ..."
        await rec2b.clickSelector('.ui-tab[data-tab="tab-io"]', 16, 10);
        await rec2b.clickSelector('#btn-chain-save-repo', 14, 42);

        await rec2b.padToTotalFrames(255);
        const clip2bPath = path.join(CLIPS_DIR, 'clip_2b_bookmark_save.mp4');
        rec2b.encode(clip2bPath);

        // =========================================================================
        // CLIP 3A: Stage-by-Stage Timeline Inspection (270 frames, 9.0s)
        // =========================================================================
        console.log('\n--- Capturing Clip 3A: Step-Through Timeline (270 frames / 9.0s) ---');
        // Load Case 1 cleanly, then minimize sidebar so 3D viewport + bottom #viewport-chain-timeline are 100% unobstructed
        await setSidebarMinimized(cdp, false);
        await cdp.eval(`(async () => {
            document.querySelector('.ui-tab[data-tab="tab-io"]')?.click();
            const sel = document.getElementById('sel-chain-corpus');
            if (sel) {
                sel.value = 'TOPOGEN_FDM_Foundry/corpus/case1_arch_vault_pq_ring_subdiv.chain.json';
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            document.getElementById('btn-chain-load-corpus')?.click();
            await new Promise(r => setTimeout(r, 900));
            // Jump to stage 2 (grid config) before clip starts so clicking stage 3 shows a crisp transition
            const n2 = document.querySelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="2"]');
            if (n2) n2.click();
            await new Promise(r => setTimeout(r, 350));
        })()`);
        await setSidebarMinimized(cdp, true);
        await sleep(300);

        const rec3a = new ClipRecorder(cdp, 'clip_3a_step_through');
        rec3a.cursorX = 740;
        rec3a.cursorY = 820;
        await rec3a.hold(12);

        // Step 1: Hover & click Stage 3 (Collapse WFC Topology)
        await rec3a.clickSelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="3"]', 16, 46);
        // Step 2: Hover & click Stage 5 (Solidify PQ Tubular Mesh)
        await rec3a.clickSelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="5"]', 14, 50);
        // Step 3: Hover & click Stage 6 (PQ Ring Subdiv + PQ Planarize)
        await rec3a.clickSelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="6"]', 14, 52);
        // Step 4: Hover & click Stage 7 (Document Persp ISO View / Camera Bookmark)
        await rec3a.clickSelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="7"]', 14, 48);

        await rec3a.padToTotalFrames(270);
        // Save a representative full-window 1920x1080 screenshot from Clip 3A showing unobstructed 3D viewport + bottom timeline!
        fs.copyFileSync(path.join(rec3a.dir, `frame_${pad4(Math.min(220, rec3a.frameIdx - 1))}.png`), BRAIN_SCREENSHOT);
        const clip3aPath = path.join(CLIPS_DIR, 'clip_3a_step_through.mp4');
        rec3a.encode(clip3aPath);

        // =========================================================================
        // CLIP 3B: Smooth Full Replay (195 frames, 6.5s)
        // =========================================================================
        console.log('\n--- Capturing Clip 3B: Smooth Full Replay (195 frames / 6.5s) ---');
        await setSidebarMinimized(cdp, false);
        await cdp.eval(`(() => {
            document.querySelector('.ui-tab[data-tab="tab-io"]')?.click();
            const n0 = document.querySelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="0"]');
            if (n0) n0.click();
        })()`);
        await sleep(300);

        const rec3b = new ClipRecorder(cdp, 'clip_3b_play_smooth');
        rec3b.cursorX = 520;
        rec3b.cursorY = 460;
        await rec3b.hold(6);

        // Click Play All, then immediately minimize sidebar
        await rec3b.clickSelector('#btn-chain-play-all', 12, 6);
        await rec3b.clickSelector('#btn-sidebar-minimize', 12, 6);

        // Move cursor gently into canvas and play smoothly through visible timeline milestones (stages 2 -> 3 -> 5 -> 6 -> 7)
        await rec3b.moveTo(960, 520, 8);
        const replayStages = [2, 3, 5, 6, 7];
        for (const st of replayStages) {
            await cdp.eval(`(() => {
                const n = document.querySelector('#viewport-chain-timeline .chain-tl-node[data-tl-index="${st}"]');
                if (n) n.click();
            })()`);
            await rec3b.hold(13);
        }

        // Calm hero 3D orbit around the completed Arch Vault
        await rec3b.orbitDrag(960, 520, 1140, 490, 68, 4);
        await rec3b.padToTotalFrames(195);
        const clip3bPath = path.join(CLIPS_DIR, 'clip_3b_play_smooth.mp4');
        rec3b.encode(clip3bPath);

        // =========================================================================
        // CONTACT SHEET (4x4 grid = 16 keyframes, 4 per clip)
        // =========================================================================
        console.log('\n--- Generating Walkthrough Contact Sheet ---');
        const samples = [
            { rec: rec2a, label: '2A Create' },
            { rec: rec2b, label: '2B Bookmark+Save' },
            { rec: rec3a, label: '3A Step-Through' },
            { rec: rec3b, label: '3B Smooth Replay' }
        ];
        const tilePaths = [];
        for (let r = 0; r < samples.length; r++) {
            const { rec, label } = samples[r];
            const fracs = [0.15, 0.40, 0.68, 0.92];
            for (let c = 0; c < fracs.length; c++) {
                const fIdx = Math.min(rec.frameIdx - 1, Math.max(0, Math.floor(rec.frameIdx * fracs[c])));
                const src = path.join(rec.dir, `frame_${pad4(fIdx)}.png`);
                const dst = path.join(TEMP_ROOT, `tile_${r}_${c}.png`);
                const timeSec = (fIdx / 30).toFixed(1);
                execFileSync('ffmpeg', [
                    '-y', '-i', src,
                    '-vf', `scale=480:270,drawbox=x=0:y=0:w=230:h=26:color=black@0.72:t=fill,drawtext=text='${label} ${timeSec}s':x=8:y=6:fontsize=15:fontcolor=white`,
                    dst
                ], { stdio: 'ignore' });
                tilePaths.push(dst);
            }
        }
        const contactSheetPath = path.join(WALKTHROUGH_DIR, 'walkthrough_contact_sheet.png');
        const inputs = [];
        for (const tp of tilePaths) inputs.push('-i', tp);
        execFileSync('ffmpeg', [
            '-y',
            ...inputs,
            '-filter_complex', 'xstack=inputs=16:layout=0_0|480_0|960_0|1440_0|0_270|480_270|960_270|1440_270|0_540|480_540|960_540|1440_540|0_810|480_810|960_810|1440_810',
            contactSheetPath
        ], { stdio: 'inherit' });

        console.log('Contact sheet saved:', contactSheetPath);
        console.log('Representative screenshot saved:', BRAIN_SCREENSHOT);
    } finally {
        if (cdp) cdp.close();
        if (chromeProc) {
            try { chromeProc.kill('SIGKILL'); } catch {}
        }
        if (labProc) {
            try { labProc.kill('SIGKILL'); } catch {}
        }
        // Clean up temporary saved chain files created during Clip 2B so git stays clean
        if (fs.existsSync(existingChainsDir)) {
            for (const f of fs.readdirSync(existingChainsDir)) {
                if (!preExistingChains.has(f)) {
                    try {
                        fs.unlinkSync(path.join(existingChainsDir, f));
                        console.log('Cleaned up temporary saved chain:', f);
                    } catch {}
                }
            }
        }
        // Clean up temporary frame PNGs & Chrome profile
        try {
            fs.rmSync(TEMP_ROOT, { recursive: true, force: true });
        } catch {}
    }
}

main().catch((err) => {
    console.error('CAPTURE FAILED:', err);
    process.exit(1);
});

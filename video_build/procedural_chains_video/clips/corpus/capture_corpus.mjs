/**
 * capture_corpus.mjs — In-browser "Computer Use" capture for Topogen Procedural Chains (Part 1: Corpus Playback)
 * Uses pure Node v26+ (native WebSocket + fetch) + Chrome CDP (--headless=new) + ffmpeg.
 * Dedicated ports: serve_lab.mjs on 8891, Chrome CDP on 9231.
 * Outputs strictly under video_build/procedural_chains_video/clips/corpus/.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../..');
const OUT_DIR = __dirname;
const BRAIN_SCREENSHOT = 'C:/Users/shajay.b.ZAHA-HADID/.gemini/antigravity/brain/1a36a0e2-b303-4e93-b90b-6dda38bd871a/corpus_chains_showcase.png';

const LAB_PORT = 8891;
const CDP_PORT = 9231;
const CHROME_PATH = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const APP_URL = `http://127.0.0.1:${LAB_PORT}/index_TOPOGEN_PQM_ELASTICA_FDM.html`;

const TEMP_ROOT = path.join(os.tmpdir(), `topogen_capture_corpus_${Date.now()}`);
const USER_DATA_DIR = path.join(TEMP_ROOT, 'chrome_profile');
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(USER_DATA_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad4 = (n) => String(n).padStart(4, '0');

async function waitForHttp(url, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDPClient {
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
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(`CDP ${msg.error.code}: ${msg.error.message}`));
          else res(msg.result);
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
  async eval(expression, awaitPromise = true) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`JS Eval Error: ${res.exceptionDetails.text || JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result ? res.result.value : undefined;
  }
  close() {
    try { this.ws?.close(); } catch {}
  }
}

class ClipRecorder {
  constructor(cdp, clipName, targetFrames) {
    this.cdp = cdp;
    this.clipName = clipName;
    this.targetFrames = targetFrames;
    this.framesDir = path.join(TEMP_ROOT, 'frames', clipName);
    fs.mkdirSync(this.framesDir, { recursive: true });
    this.frameIndex = 0;
    this.cursorX = 200;
    this.cursorY = 200;
  }

  async captureFrame() {
    if (this.frameIndex >= this.targetFrames) return;
    // Let WebGL render a fresh rAF tick before grabbing
    await this.cdp.eval(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'png' });
    const outPath = path.join(this.framesDir, `frame_${pad4(this.frameIndex)}.png`);
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    this.frameIndex++;
  }

  async hold(frames) {
    for (let i = 0; i < frames && this.frameIndex < this.targetFrames; i++) {
      await this.captureFrame();
    }
  }

  async padToTarget() {
    while (this.frameIndex < this.targetFrames) {
      await this.captureFrame();
    }
  }

  async setCursorVisual(x, y, pressed = false) {
    await this.cdp.eval(`window.__setDemoCursor && window.__setDemoCursor(${x}, ${y}, ${pressed})`);
  }

  async triggerRipple(x, y) {
    await this.cdp.eval(`window.__demoCursorRipple && window.__demoCursorRipple(${x}, ${y})`);
  }

  async moveTo(targetX, targetY, steps = 12, buttonDown = false) {
    const startX = this.cursorX;
    const startY = this.cursorY;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // Smooth cubic ease-in-out
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const x = startX + (targetX - startX) * ease;
      const y = startY + (targetY - startY) * ease;
      await this.cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x,
        y,
        button: buttonDown ? 'left' : 'none',
        buttons: buttonDown ? 1 : 0,
      });
      await this.setCursorVisual(x, y, buttonDown);
      this.cursorX = x;
      this.cursorY = y;
      await this.captureFrame();
    }
  }

  async getCenter(selector) {
    const rect = await this.cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
    })()`);
    if (!rect || rect.w === 0 || rect.h === 0) {
      throw new Error(`Element not visible or not found: ${selector}`);
    }
    return rect;
  }

  async moveAndClick(selector, moveSteps = 12, postClickHold = 4) {
    const rect = await this.getCenter(selector);
    await this.moveTo(rect.x, rect.y, moveSteps, false);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: rect.x,
      y: rect.y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await this.setCursorVisual(rect.x, rect.y, true);
    await this.triggerRipple(rect.x, rect.y);
    await this.captureFrame();
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: rect.x,
      y: rect.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await this.setCursorVisual(rect.x, rect.y, false);
    await this.hold(postClickHold);
  }

  async selectDropdown(selector, value, moveSteps = 10, postHold = 4) {
    const rect = await this.getCenter(selector);
    await this.moveTo(rect.x, rect.y, moveSteps, false);
    await this.triggerRipple(rect.x, rect.y);
    await this.cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error('Missing select ' + ${JSON.stringify(selector)});
      el.focus();
      el.value = ${JSON.stringify(value)};
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.style.boxShadow = '0 0 0 2px #2563eb';
      setTimeout(() => { el.style.boxShadow = ''; }, 600);
    })()`);
    await this.hold(postHold);
  }

  async orbitDrag(startX, startY, dx, dy, dragFrames = 60, holdEnd = 10) {
    await this.moveTo(startX, startY, 10, false);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: startX,
      y: startY,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await this.setCursorVisual(startX, startY, true);
    await this.moveTo(startX + dx, startY + dy, dragFrames, true);
    await this.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: startX + dx,
      y: startY + dy,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await this.setCursorVisual(startX + dx, startY + dy, false);
    await this.hold(holdEnd);
  }

  encode(outMp4Path) {
    console.log(`[${this.clipName}] Encoding ${this.frameIndex} frames -> ${outMp4Path}`);
    execFileSync('ffmpeg', [
      '-y',
      '-framerate', '30',
      '-i', path.join(this.framesDir, 'frame_%04d.png'),
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '16',
      '-pix_fmt', 'yuv420p',
      '-r', '30',
      '-movflags', '+faststart',
      outMp4Path,
    ], { stdio: 'inherit' });
  }
}

async function waitForChainLoaded(cdp, expectedSubstr, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const state = await cdp.eval(`(() => {
      const tl = document.getElementById('viewport-chain-timeline');
      const status = document.getElementById('chain-status-text')?.textContent || '';
      const name = tl?.querySelector('[data-tl-name]')?.textContent || '';
      const nodes = tl ? tl.querySelectorAll('.chain-tl-node').length : 0;
      const visible = tl && !tl.classList.contains('hidden');
      const playing = Boolean(window.__app?.chainPlaying);
      return { visible, nodes, name, status, playing };
    })()`);
    if (
      state.visible &&
      state.nodes >= 4 &&
      !state.playing &&
      (!expectedSubstr || state.name.toLowerCase().includes(expectedSubstr.toLowerCase())) &&
      (state.status.toLowerCase().includes('replayed') ||
        state.status.toLowerCase().includes('loaded') ||
        state.status.toLowerCase().includes('step') ||
        state.status.toLowerCase().includes('complete') ||
        state.status.toLowerCase().includes('done') ||
        state.nodes >= 5)
    ) {
      await sleep(300);
      return state;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for chain "${expectedSubstr}" to load`);
}

async function waitForTimelineStepSettled(cdp) {
  await sleep(180);
  await cdp.eval(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
}

async function setupUIHygieneAndCursor(cdp) {
  await cdp.eval(`(() => {
    // 1. Reposition #display-hud-panel to bottom-right so it NEVER overlaps #viewport-chain-timeline
    const disp = document.getElementById('display-hud-panel');
    if (disp) {
      disp.style.left = 'auto';
      disp.style.right = '12px';
      disp.style.bottom = '28px';
      if (!disp.classList.contains('minimized')) {
        document.getElementById('btn-display-hud-minimize')?.click();
      }
    }
    // 2. Reposition #telemetry-panel to top-right next to #outliner and keep minimized
    const tel = document.getElementById('telemetry-panel');
    if (tel) {
      tel.style.left = 'auto';
      tel.style.right = '284px';
      tel.style.top = '12px';
      if (!tel.classList.contains('minimized')) {
        document.getElementById('btn-telemetry-minimize')?.click();
      }
    }
    // 3. Keep #outliner minimized at top-right
    const outliner = document.getElementById('outliner');
    if (outliner) {
      outliner.style.top = '12px';
      outliner.style.right = '12px';
      if (!outliner.classList.contains('minimized') && !outliner.classList.contains('collapsed')) {
        document.getElementById('outliner-collapse')?.click();
      }
    }
    // 4. Disable OrbitControls damping for deterministic smooth camera orbits
    if (window.__app?.controls) {
      window.__app.controls.enableDamping = false;
    }
    // 5. Inject clean runtime-only pointer cursor overlay (never touches repo files)
    if (!document.getElementById('demo-cursor-overlay')) {
      const style = document.createElement('style');
      style.textContent = \`
        #demo-cursor-overlay {
          position: fixed;
          left: 0; top: 0;
          width: 26px; height: 26px;
          pointer-events: none;
          z-index: 999999;
          transform: translate(-2px, -2px);
          filter: drop-shadow(0 2px 4px rgba(15,23,42,0.35));
          transition: transform 0.04s linear;
        }
        #demo-cursor-overlay.pressed svg {
          transform: scale(0.88);
        }
        .demo-cursor-ripple {
          position: fixed;
          width: 34px; height: 34px;
          margin-left: -17px; margin-top: -17px;
          border-radius: 50%;
          border: 2.5px solid #2563EB;
          background: rgba(37,99,235,0.16);
          pointer-events: none;
          z-index: 999998;
          animation: demoRipple 0.45s ease-out forwards;
        }
        @keyframes demoRipple {
          0% { transform: scale(0.35); opacity: 0.95; }
          100% { transform: scale(1.65); opacity: 0; }
        }
      \`;
      document.head.appendChild(style);
      const cur = document.createElement('div');
      cur.id = 'demo-cursor-overlay';
      cur.innerHTML = \`<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M4 3L21 12.2L13.4 14.2L10.4 21.5L4 3Z" fill="#0F172A" stroke="#FFFFFF" stroke-width="2" stroke-linejoin="round"/>
      </svg>\`;
      document.body.appendChild(cur);
      window.__setDemoCursor = (x, y, pressed) => {
        cur.style.left = x + 'px';
        cur.style.top = y + 'px';
        cur.classList.toggle('pressed', Boolean(pressed));
      };
      window.__demoCursorRipple = (x, y) => {
        const rip = document.createElement('div');
        rip.className = 'demo-cursor-ripple';
        rip.style.left = x + 'px';
        rip.style.top = y + 'px';
        document.body.appendChild(rip);
        setTimeout(() => rip.remove(), 500);
      };
    }
  })()`);
}

async function ensureSidebarState(cdp, rec, wantExpanded) {
  const isMin = await cdp.eval(`document.getElementById('left-sidebar')?.classList.contains('minimized')`);
  if (wantExpanded && isMin) {
    await rec.moveAndClick('#btn-sidebar-minimize', 10, 4);
  } else if (!wantExpanded && !isMin) {
    await rec.moveAndClick('#btn-sidebar-minimize', 10, 4);
  }
}

function buildContactSheet(clips, outPng) {
  // 3 rows x 4 columns = 12 frames (4 key timestamps per clip)
  const tileW = 640;
  const tileH = 360;
  const sampleFracs = [0.12, 0.35, 0.62, 0.88];
  const tilePaths = [];

  for (let r = 0; r < clips.length; r++) {
    const { mp4, durationSec, tag } = clips[r];
    for (let c = 0; c < sampleFracs.length; c++) {
      const ts = (durationSec * sampleFracs[c]).toFixed(2);
      const tileOut = path.join(TEMP_ROOT, `tile_${r}_${c}.png`);
      execFileSync('ffmpeg', [
        '-y',
        '-ss', ts,
        '-i', mp4,
        '-frames:v', '1',
        '-vf', `scale=${tileW}:${tileH}`,
        tileOut,
      ], { stdio: 'ignore' });
      tilePaths.push(tileOut);
    }
  }

  // Stitch 12 tiles into 4x3 grid using ffmpeg xstack
  const inputs = tilePaths.flatMap((p) => ['-i', p]);
  const layoutParts = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) {
      layoutParts.push(`${c * tileW}_${r * tileH}`);
    }
  }
  const filter = `${tilePaths.map((_, i) => `[${i}:v]`).join('')}xstack=inputs=12:layout=${layoutParts.join('|')}[out]`;
  execFileSync('ffmpeg', [
    '-y',
    ...inputs,
    '-filter_complex', filter,
    '-map', '[out]',
    '-frames:v', '1',
    outPng,
  ], { stdio: 'inherit' });
}

async function main() {
  console.log(`Starting serve_lab.mjs on port ${LAB_PORT}...`);
  const serverProc = spawn('node', ['TOPOGEN_FDM_Foundry/serve_lab.mjs', String(LAB_PORT)], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  serverProc.stdout.on('data', (d) => process.stdout.write(`[lab:${LAB_PORT}] ${d}`));
  serverProc.stderr.on('data', (d) => process.stderr.write(`[lab:${LAB_PORT} ERR] ${d}`));

  let chromeProc = null;
  let cdp = null;

  try {
    await waitForHttp(`http://127.0.0.1:${LAB_PORT}/api/chains`, 15000);
    console.log('serve_lab.mjs is ready.');

    console.log(`Launching headless Chrome on CDP port ${CDP_PORT}...`);
    chromeProc = spawn(CHROME_PATH, [
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
      APP_URL,
    ], { stdio: 'ignore' });

    const listRes = await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/list`, 15000);
    const targets = await listRes.json();
    const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes(String(LAB_PORT))) || targets.find((t) => t.type === 'page');
    if (!pageTarget?.webSocketDebuggerUrl) {
      throw new Error(`No page target found in CDP /json/list: ${JSON.stringify(targets)}`);
    }

    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    console.log('Waiting for window.__app.ready...');
    for (let i = 0; i < 60; i++) {
      const ready = await cdp.eval(`Boolean(window.__app && window.__app.ready)`);
      if (ready) break;
      await sleep(250);
    }
    await cdp.eval(`Promise.resolve(window.__app.ready).then(() => true)`);
    await sleep(500);

    // Apply startup UI hygiene and open Tab 7 (7. I/O)
    await setupUIHygieneAndCursor(cdp);
    await cdp.eval(`document.querySelector('.ui-tab[data-tab="tab-io"]')?.click()`);
    await sleep(400);

    // Ensure corpus dropdown is populated
    for (let i = 0; i < 30; i++) {
      const count = await cdp.eval(`document.querySelectorAll('#sel-chain-corpus option').length`);
      if (count >= 3) break;
      await sleep(200);
    }
    const corpusOptions = await cdp.eval(`Array.from(document.querySelectorAll('#sel-chain-corpus option')).map(o => o.value)`);
    console.log('Corpus dropdown options:', corpusOptions);

    // =========================================================================
    // CLIP 1A: Case 1 — Arch Vault + PQ Ring Subdiv (240 frames = 8.0s)
    // =========================================================================
    console.log('\n--- Capturing Clip 1A: Case 1 (Arch Vault Ring Subdiv) ---');
    const rec1a = new ClipRecorder(cdp, 'clip_1a_case1_ring', 240);
    rec1a.cursorX = 220;
    rec1a.cursorY = 300;
    await rec1a.setCursorVisual(rec1a.cursorX, rec1a.cursorY, false);
    await rec1a.hold(4);
    await rec1a.selectDropdown('#sel-chain-corpus', 'TOPOGEN_FDM_Foundry/corpus/case1_arch_vault_pq_ring_subdiv.chain.json', 10, 4);
    await rec1a.moveAndClick('#btn-chain-load-corpus', 10, 2);
    await waitForChainLoaded(cdp, 'Case 1');
    await rec1a.hold(6);
    // Minimize left sidebar so 3D viewport + bottom timeline are 100% unobstructed
    await ensureSidebarState(cdp, rec1a, false);
    await rec1a.hold(4);
    // Stage 3: Collapse WFC Topology
    await rec1a.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="3"]', 12, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1a.hold(22);
    // Stage 5: Solidify PQ Tubular Mesh
    await rec1a.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="5"]', 10, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1a.hold(28);
    // Stage 6: PQ Ring Subdiv + PQ Planarize
    await rec1a.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="6"]', 10, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1a.hold(30);

    // Save representative full-window showcase screenshot while Case 1 Ring Subdiv + clean HUD/timeline is framed!
    {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(BRAIN_SCREENSHOT), { recursive: true });
      fs.writeFileSync(BRAIN_SCREENSHOT, Buffer.from(data, 'base64'));
      console.log('Saved representative screenshot:', BRAIN_SCREENSHOT);
    }

    // Calm 3D mouse drag orbit around finished Arch Vault
    const rem1a = Math.max(20, 240 - rec1a.frameIndex - 18);
    await rec1a.orbitDrag(960, 500, 190, -18, rem1a, 8);
    await rec1a.padToTarget();
    const mp4_1a = path.join(OUT_DIR, 'clip_1a_case1_ring.mp4');
    rec1a.encode(mp4_1a);

    // =========================================================================
    // CLIP 1B: Case 2 — Arch Vault + PQ Longitudinal Subdiv (225 frames = 7.5s)
    // =========================================================================
    console.log('\n--- Capturing Clip 1B: Case 2 (Arch Vault Longitudinal Subdiv) ---');
    const rec1b = new ClipRecorder(cdp, 'clip_1b_case2_long', 225);
    rec1b.cursorX = rec1a.cursorX;
    rec1b.cursorY = rec1a.cursorY;
    await ensureSidebarState(cdp, rec1b, true);
    await rec1b.selectDropdown('#sel-chain-corpus', 'TOPOGEN_FDM_Foundry/corpus/case2_arch_vault_pq_long_subdiv.chain.json', 10, 4);
    await rec1b.moveAndClick('#btn-chain-load-corpus', 10, 2);
    await waitForChainLoaded(cdp, 'Case 2');
    await rec1b.hold(6);
    await ensureSidebarState(cdp, rec1b, false);
    await rec1b.hold(4);
    // Stage 5: Solidify PQ Tubular Mesh
    await rec1b.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="5"]', 12, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1b.hold(30);
    // Stage 6: PQ Longitudinal Subdiv + PQ Planarize
    await rec1b.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="6"]', 10, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1b.hold(38);
    // Calm 3D orbit
    const rem1b = Math.max(20, 225 - rec1b.frameIndex - 18);
    await rec1b.orbitDrag(960, 500, -200, -16, rem1b, 8);
    await rec1b.padToTarget();
    const mp4_1b = path.join(OUT_DIR, 'clip_1b_case2_long.mp4');
    rec1b.encode(mp4_1b);

    // =========================================================================
    // CLIP 1C: Case 3 — Custom Batwing Tile 1x1x1 + PQ Solidify (210 frames = 7.0s)
    // =========================================================================
    console.log('\n--- Capturing Clip 1C: Case 3 (Custom Batwing Tile) ---');
    const rec1c = new ClipRecorder(cdp, 'clip_1c_case3_batwing', 210);
    rec1c.cursorX = rec1b.cursorX;
    rec1c.cursorY = rec1b.cursorY;
    await ensureSidebarState(cdp, rec1c, true);
    await rec1c.selectDropdown('#sel-chain-corpus', 'TOPOGEN_FDM_Foundry/corpus/case3_batwing_1x1x1_pq.chain.json', 10, 4);
    await rec1c.moveAndClick('#btn-chain-load-corpus', 10, 2);
    await waitForChainLoaded(cdp, 'Case 3');
    await rec1c.hold(6);
    await ensureSidebarState(cdp, rec1c, false);
    await rec1c.hold(4);
    // Stage 0: Import Batwing OBJ Tile
    await rec1c.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="0"]', 12, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1c.hold(24);
    // Stage 2: Collapse 1x1x1 WFC Topology
    await rec1c.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="2"]', 10, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1c.hold(22);
    // Stage 4: Solidify Batwing PQ Tubular Mesh
    await rec1c.moveAndClick('#viewport-chain-timeline .chain-tl-node[data-tl-index="4"]', 10, 2);
    await waitForTimelineStepSettled(cdp);
    await rec1c.hold(26);
    // Calm 3D orbit
    const rem1c = Math.max(16, 210 - rec1c.frameIndex - 16);
    await rec1c.orbitDrag(960, 500, 170, -15, rem1c, 6);
    await rec1c.padToTarget();
    const mp4_1c = path.join(OUT_DIR, 'clip_1c_case3_batwing.mp4');
    rec1c.encode(mp4_1c);

    // =========================================================================
    // Build 4x3 Contact Sheet
    // =========================================================================
    const contactSheetPath = path.join(OUT_DIR, 'corpus_contact_sheet.png');
    console.log('\nBuilding contact sheet ->', contactSheetPath);
    buildContactSheet([
      { mp4: mp4_1a, durationSec: 8.0, tag: 'Case 1' },
      { mp4: mp4_1b, durationSec: 7.5, tag: 'Case 2' },
      { mp4: mp4_1c, durationSec: 7.0, tag: 'Case 3' },
    ], contactSheetPath);

    console.log('\nALL CORPUS CLIPS & CONTACT SHEET GENERATED SUCCESSFULLY!');
  } finally {
    cdp?.close();
    try { chromeProc?.kill(); } catch {}
    try { serverProc?.kill(); } catch {}
    // Clean up temporary frames and profile in %TEMP%
    try { fs.rmSync(TEMP_ROOT, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error('CAPTURE FAILED:', err);
  process.exit(1);
});

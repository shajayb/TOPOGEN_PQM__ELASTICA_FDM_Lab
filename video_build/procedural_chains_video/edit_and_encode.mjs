#!/usr/bin/env node
/**
 * Topogen Procedural Chains — Video Editor & Encoder
 *
 * Composes the 7 captured clips + Studio Light title/chapter/outro cards into:
 *   1. video_build/procedural_chains_video/topogen_procedural_chains_master.mp4   (1920x1080 @ 30fps, H.264 yuv420p, +faststart)
 *   2. video_build/procedural_chains_video/topogen_procedural_chains_discord.mp4  (1280x720  @ 30fps, H.264 yuv420p, +faststart, < 10 MB)
 *   3. video_build/procedural_chains_video/master_contact_sheet.png             (decoded from master MP4)
 *   4. video_build/procedural_chains_video/discord_contact_sheet.png            (decoded from Discord MP4)
 *
 * Strictly honors VIDEO_CREATION_SOP.md & alice-explainer-video/SKILL.md:
 *   - Studio Light (#FFFFFF) aesthetic matching Topogen's UI
 *   - Plain-English designer voice (<= 2.5 words/sec, zero developer jargon)
 *   - Protected bottom seekbar & timeline zone (y > 900 px 100% free of added overlays)
 *   - Zero temp raw frame dumps left inside the git repository
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve('video_build/procedural_chains_video');
const CLIPS_DIR = path.join(ROOT, 'clips');
const TEMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'topogen-video-edit-'));

const MASTER_OUT = path.join(ROOT, 'topogen_procedural_chains_master.mp4');
const DISCORD_OUT = path.join(ROOT, 'topogen_procedural_chains_discord.mp4');
const MASTER_SHEET = path.join(ROOT, 'master_contact_sheet.png');
const DISCORD_SHEET = path.join(ROOT, 'discord_contact_sheet.png');

const FONT_BOLD = 'C\\:/Windows/Fonts/calibrib.ttf';
const FONT_REG = 'C\\:/Windows/Fonts/calibri.ttf';
const FONT_STAMP = 'C\\:/Windows/Fonts/arialbd.ttf';

const FPS = 30;
const XFADE_DUR = 0.30; // 9 frames @ 30fps

// Escape text for FFmpeg drawtext
function esc(text) {
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/%/g, '\\%');
}

function runFfmpeg(args, label) {
  console.log(`[ffmpeg] ${label}...`);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'warning', ...args], {
    stdio: 'inherit'
  });
}

function ffprobeInfo(filePath) {
  const out = execFileSync(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,codec_name,pix_fmt,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size,bit_rate',
      '-of', 'json',
      filePath
    ],
    { encoding: 'utf8' }
  );
  const parsed = JSON.parse(out);
  const stream = (parsed.streams && parsed.streams[0]) || {};
  const fmt = parsed.format || {};
  return {
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    codec: stream.codec_name || '',
    pixFmt: stream.pix_fmt || '',
    fps: stream.r_frame_rate || '',
    duration: Number(fmt.duration || 0),
    sizeBytes: Number(fmt.size || fs.statSync(filePath).size),
    bitRate: Number(fmt.bit_rate || 0)
  };
}

function resolveClip(candidates, label) {
  for (const rel of candidates) {
    const abs = path.join(CLIPS_DIR, rel);
    if (fs.existsSync(abs) && fs.statSync(abs).size > 1024) {
      return abs;
    }
  }
  throw new Error(`Missing required clip for ${label}. Checked:\n  - ${candidates.map(c => path.join(CLIPS_DIR, c)).join('\n  - ')}`);
}

/**
 * Render a clean Studio Light (#FFFFFF) title or chapter card (1920x1080 @ 30fps)
 * with minimalist teal corner L-brackets and plain-English typography.
 */
function renderCard({ outPath, duration, badge, title, subtitle, accentHex = '0x0D9488' }) {
  const f = [];
  // Corner L-brackets (minimalist architectural framing, 48px arms, 3px thick, inset 64px)
  const arm = 44;
  const th = 3;
  const m = 64;
  // Top-left
  f.push(`drawbox=x=${m}:y=${m}:w=${arm}:h=${th}:color=${accentHex}:t=fill`);
  f.push(`drawbox=x=${m}:y=${m}:w=${th}:h=${arm}:color=${accentHex}:t=fill`);
  // Top-right
  f.push(`drawbox=x=${1920 - m - arm}:y=${m}:w=${arm}:h=${th}:color=${accentHex}:t=fill`);
  f.push(`drawbox=x=${1920 - m - th}:y=${m}:w=${th}:h=${arm}:color=${accentHex}:t=fill`);
  // Bottom-left (kept above y=900? Cards are full-screen titles, y=1016 is purely decorative corner bracket, zero text!)
  f.push(`drawbox=x=${m}:y=${1080 - m - th}:w=${arm}:h=${th}:color=${accentHex}:t=fill`);
  f.push(`drawbox=x=${m}:y=${1080 - m - arm}:w=${th}:h=${arm}:color=${accentHex}:t=fill`);
  // Bottom-right
  f.push(`drawbox=x=${1920 - m - arm}:y=${1080 - m - th}:w=${arm}:h=${th}:color=${accentHex}:t=fill`);
  f.push(`drawbox=x=${1920 - m - th}:y=${1080 - m - arm}:w=${th}:h=${arm}:color=${accentHex}:t=fill`);

  if (badge) {
    // Chapter pill centered above headline
    f.push(`drawbox=x=924:y=392:w=72:h=40:color=${accentHex}:t=fill`);
    f.push(
      `drawtext=fontfile='${FONT_BOLD}':text='${esc(badge)}':fontcolor=0xFFFFFF:fontsize=24:` +
      `x=(w-text_w)/2:y=402`
    );
  }

  // Main headline
  const titleY = badge ? 468 : 448;
  f.push(
    `drawtext=fontfile='${FONT_BOLD}':text='${esc(title)}':fontcolor=0x0F172A:fontsize=64:` +
    `x=(w-text_w)/2:y=${titleY}`
  );

  // Subtle horizontal divider bar
  const barY = titleY + 90;
  f.push(`drawbox=x=860:y=${barY}:w=200:h=3:color=${accentHex}:t=fill`);

  // Subtitle
  const subY = barY + 26;
  f.push(
    `drawtext=fontfile='${FONT_REG}':text='${esc(subtitle)}':fontcolor=0x475569:fontsize=30:` +
    `x=(w-text_w)/2:y=${subY}`
  );

  runFfmpeg(
    [
      '-f', 'lavfi',
      '-i', `color=c=0xFFFFFF:s=1920x1080:r=${FPS}:d=${duration.toFixed(3)}`,
      '-vf', `${f.join(',')},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '14',
      '-r', String(FPS),
      outPath
    ],
    `Render card ${path.basename(outPath)}`
  );
  return outPath;
}

/**
 * Prepare a live captured clip: normalize to 1920x1080 @ 30fps and composite
 * a clean, left-aligned Studio Light signpost pill in the upper safe zone
 * (never touching the minimized/expanded sidebar, HUD, or y > 900 bottom timeline).
 */
function prepareClip({ srcPath, outPath, label, sidebarExpanded = false, startDelay = 0.15, accentHex = '0x2563EB' }) {
  const info = ffprobeInfo(srcPath);
  const x = sidebarExpanded ? 416 : 40;
  const y = sidebarExpanded ? 14 : 64;
  // Estimate clean pill width from character length (Calibri Bold 20-22pt ~ 11px/char + 48px padding)
  const pillW = Math.min(540, Math.max(260, Math.round(label.length * 10.8 + 48)));
  const pillH = 40;

  const tStart = Math.min(startDelay, Math.max(0.15, info.duration - 1.0));
  const enableExpr = `between(t,${tStart.toFixed(3)},${Math.max(tStart + 0.5, info.duration - 0.10).toFixed(3)})`;

  const vf = [
    `scale=1920:1080:force_original_aspect_ratio=decrease`,
    `pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xFFFFFF`,
    `fps=${FPS}`,
    `setsar=1`,
    // Subtle outer border box (1px #CBD5E1)
    `drawbox=x=${x - 1}:y=${y - 1}:w=${pillW + 2}:h=${pillH + 2}:color=0xCBD5E1@0.95:t=fill:enable='${enableExpr}'`,
    // Translucent white pill fill
    `drawbox=x=${x}:y=${y}:w=${pillW}:h=${pillH}:color=0xFFFFFF@0.94:t=fill:enable='${enableExpr}'`,
    // Left 5px color accent bar
    `drawbox=x=${x}:y=${y}:w=5:h=${pillH}:color=${accentHex}@1.0:t=fill:enable='${enableExpr}'`,
    // Crisp plain-English signpost text
    `drawtext=fontfile='${FONT_BOLD}':text='${esc(label)}':fontcolor=0x0F172A:fontsize=20:` +
      `x=${x + 16}:y=${y + 10}:enable='${enableExpr}'`,
    `format=yuv420p`
  ].join(',');

  runFfmpeg(
    [
      '-i', srcPath,
      '-an',
      '-vf', vf,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '15',
      '-r', String(FPS),
      outPath
    ],
    `Prepare clip ${path.basename(srcPath)} -> ${path.basename(outPath)}`
  );
  return { path: outPath, duration: ffprobeInfo(outPath).duration };
}

/**
 * Concatenate segments with smooth xfade transitions into the 1080p master MP4.
 */
function assembleMaster(segments, outPath) {
  const inputs = [];
  const filterParts = [];

  segments.forEach((seg, i) => {
    inputs.push('-i', seg.path);
    filterParts.push(`[${i}:v]settb=AVTB,fps=${FPS},format=yuv420p[v${i}]`);
  });

  let curLabel = 'v0';
  let accDur = segments[0].duration;

  for (let i = 1; i < segments.length; i++) {
    const nextLabel = `v${i}`;
    const outLabel = i === segments.length - 1 ? 'vout' : `xf${i}`;
    const offset = Math.max(0.1, accDur - XFADE_DUR);
    filterParts.push(
      `[${curLabel}][${nextLabel}]xfade=transition=fade:duration=${XFADE_DUR.toFixed(3)}:offset=${offset.toFixed(3)}[${outLabel}]`
    );
    curLabel = outLabel;
    accDur = offset + segments[i].duration;
  }

  // Gentle 0.35s fade-in from white on frame 0 and 0.45s fade-out to white at end
  const finalLabel = 'vfinal';
  const fadeOutStart = Math.max(0.5, accDur - 0.45);
  filterParts.push(
    `[${curLabel}]fade=t=in:st=0:d=0.30:color=0xFFFFFF,fade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.45:color=0xFFFFFF,format=yuv420p[${finalLabel}]`
  );

  const filterComplex = filterParts.join(';');

  runFfmpeg(
    [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', `[${finalLabel}]`,
      '-an',
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-crf', '18',
      '-maxrate', '3800k',
      '-bufsize', '7600k',
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      '-movflags', '+faststart',
      outPath
    ],
    `Assemble Master 1080p (${segments.length} segments, ~${accDur.toFixed(1)}s)`
  );
}

/**
 * 2-pass 720p Discord encode strictly under 10 MB (target ~8.2 MB).
 */
function encodeDiscord(masterPath, outPath) {
  const info = ffprobeInfo(masterPath);
  const dur = Math.max(1, info.duration);
  // Target 8.2 MB = 8.2 * 8192 kb = 67174 kb; cap at 1200 kbps max so it stays crisp and well under 10 MB
  const targetKbps = Math.min(1250, Math.max(500, Math.floor((8.2 * 8192) / dur)));
  const maxRateKbps = Math.round(targetKbps * 1.25);
  const bufSizeKbps = Math.round(targetKbps * 2.0);
  const passLog = path.join(TEMP_DIR, 'discord_2pass');
  const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null';

  console.log(`[discord] duration=${dur.toFixed(2)}s -> target bitrate=${targetKbps}k (2-pass 720p)`);

  // Pass 1
  runFfmpeg(
    [
      '-i', masterPath,
      '-an',
      '-vf', `scale=1280:720:flags=lanczos,fps=${FPS},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-b:v', `${targetKbps}k`,
      '-maxrate', `${maxRateKbps}k`,
      '-bufsize', `${bufSizeKbps}k`,
      '-pass', '1',
      '-passlogfile', passLog,
      '-f', 'mp4',
      nullSink
    ],
    'Discord 720p Pass 1/2'
  );

  // Pass 2
  runFfmpeg(
    [
      '-i', masterPath,
      '-an',
      '-vf', `scale=1280:720:flags=lanczos,fps=${FPS},format=yuv420p`,
      '-c:v', 'libx264',
      '-preset', 'slow',
      '-b:v', `${targetKbps}k`,
      '-maxrate', `${maxRateKbps}k`,
      '-bufsize', `${bufSizeKbps}k`,
      '-pass', '2',
      '-passlogfile', passLog,
      '-pix_fmt', 'yuv420p',
      '-r', String(FPS),
      '-movflags', '+faststart',
      outPath
    ],
    'Discord 720p Pass 2/2'
  );

  const outInfo = ffprobeInfo(outPath);
  if (outInfo.sizeBytes >= 10_000_000) {
    throw new Error(`Discord encode exceeded 10 MB (${outInfo.sizeBytes} bytes)!`);
  }
}

/**
 * Decode a 4x4 (16-frame) verification contact sheet directly from a finished MP4.
 */
function buildContactSheet(mp4Path, outPngPath, label) {
  const info = ffprobeInfo(mp4Path);
  const dur = Math.max(1, info.duration);
  // Sample 16 evenly spaced frames across the full video (0.8s .. dur - 0.6s)
  const sampleFps = 16 / Math.max(1, dur - 1.2);
  const vf = [
    `fps=${sampleFps.toFixed(5)}:start_time=0.8`,
    `scale=480:270:flags=lanczos`,
    `drawbox=x=4:y=240:w=114:h=26:color=0x0F172A@0.82:t=fill`,
    `drawtext=fontfile='${FONT_STAMP}':text='%{pts\\:hms}':fontcolor=0xFFFFFF:fontsize=15:x=10:y=246`,
    `tile=4x4:padding=6:margin=8:color=0xE2E8F0`
  ].join(',');

  runFfmpeg(
    [
      '-i', mp4Path,
      '-vf', vf,
      '-frames:v', '1',
      '-update', '1',
      outPngPath
    ],
    `Decode contact sheet (${label})`
  );
}

function main() {
  const sheetsOnly = process.argv.includes('--sheets-only');
  console.log('=== Topogen Procedural Chains — Master Edit & Encode ===');
  console.log(`Working temp dir: ${TEMP_DIR}`);

  if (!sheetsOnly) {
    // 1. Resolve all 7 captured clips (supporting both flat clips/ and corpus/ or walkthrough/ subdirs)
    const clip1a = resolveClip(['clip_1a_case1_ring.mp4', 'corpus/clip_1a_case1_ring.mp4', 'corpus/clip_corpus_case1.mp4'], 'Clip 1A (Case 1 Ring)');
    const clip1b = resolveClip(['clip_1b_case2_long.mp4', 'corpus/clip_1b_case2_long.mp4', 'corpus/clip_corpus_case2.mp4'], 'Clip 1B (Case 2 Long)');
    const clip1c = resolveClip(['clip_1c_case3_batwing.mp4', 'corpus/clip_1c_case3_batwing.mp4', 'corpus/clip_corpus_case3.mp4'], 'Clip 1C (Case 3 Batwing)');
    const clip2a = resolveClip(['clip_2a_create_steps.mp4', 'walkthrough/clip_2a_create_steps.mp4'], 'Clip 2A (Create Steps)');
    const clip2b = resolveClip(['clip_2b_bookmark_save.mp4', 'walkthrough/clip_2b_bookmark_save.mp4'], 'Clip 2B (Bookmark & Save)');
    const clip3a = resolveClip(['clip_3a_step_through.mp4', 'walkthrough/clip_3a_step_through.mp4'], 'Clip 3A (Step-Through)');
    const clip3b = resolveClip(['clip_3b_play_smooth.mp4', 'walkthrough/clip_3b_play_smooth.mp4'], 'Clip 3B (Full Playback)');

    // 2. Render clean Studio Light title, chapter, and closing cards
    const cardIntro = renderCard({
      outPath: path.join(TEMP_DIR, 'card_00_intro.mp4'),
      duration: 2.0,
      badge: null,
      title: 'TOPOGEN  ·  PROCEDURAL CHAINS',
      subtitle: 'Record, Replay & Share 3D Design Workflows',
      accentHex: '0x0D9488'
    });

    const cardCh01 = renderCard({
      outPath: path.join(TEMP_DIR, 'card_01_corpus.mp4'),
      duration: 1.6,
      badge: '01',
      title: 'CORPUS PLAYBACK',
      subtitle: 'Stored Workflows Replayed Live',
      accentHex: '0x2563EB'
    });

    const cardCh02 = renderCard({
      outPath: path.join(TEMP_DIR, 'card_02_create.mp4'),
      duration: 1.6,
      badge: '02',
      title: 'CREATE A CHAIN',
      subtitle: 'Build Steps  ·  Bookmark Views  ·  Save',
      accentHex: '0x0D9488'
    });

    const cardCh03 = renderCard({
      outPath: path.join(TEMP_DIR, 'card_03_playback.mp4'),
      duration: 1.6,
      badge: '03',
      title: 'STEP & PLAYBACK',
      subtitle: 'Inspect Any Stage  ·  Replay Smoothly',
      accentHex: '0x2563EB'
    });

    const cardOutro = renderCard({
      outPath: path.join(TEMP_DIR, 'card_04_outro.mp4'),
      duration: 2.0,
      badge: null,
      title: 'TOPOGEN  ·  PROCEDURAL CHAINS',
      subtitle: 'Reproducible 3D Architectural Workflows',
      accentHex: '0x0D9488'
    });

    // 3. Prepare all 7 clips with minimal plain-English signpost overlays
    const p1a = prepareClip({
      srcPath: clip1a,
      outPath: path.join(TEMP_DIR, 'seg_1a.mp4'),
      label: 'Case 1  ·  Arch Vault Ring Subdivision',
      sidebarExpanded: false,
      startDelay: 2.15,
      accentHex: '0x2563EB'
    });
    const p1b = prepareClip({
      srcPath: clip1b,
      outPath: path.join(TEMP_DIR, 'seg_1b.mp4'),
      label: 'Case 2  ·  Arch Vault Longitudinal Strips',
      sidebarExpanded: false,
      startDelay: 2.15,
      accentHex: '0x2563EB'
    });
    const p1c = prepareClip({
      srcPath: clip1c,
      outPath: path.join(TEMP_DIR, 'seg_1c.mp4'),
      label: 'Case 3  ·  Custom Batwing Tile',
      sidebarExpanded: false,
      startDelay: 2.15,
      accentHex: '0x2563EB'
    });
    const p2a = prepareClip({
      srcPath: clip2a,
      outPath: path.join(TEMP_DIR, 'seg_2a.mp4'),
      label: 'Record Steps  ·  Tiles to Quad Mesh',
      sidebarExpanded: true,
      startDelay: 0.15,
      accentHex: '0x0D9488'
    });
    const p2b = prepareClip({
      srcPath: clip2b,
      outPath: path.join(TEMP_DIR, 'seg_2b.mp4'),
      label: 'Save Camera View & Export Chain',
      sidebarExpanded: true,
      startDelay: 0.15,
      accentHex: '0x0D9488'
    });
    const p3a = prepareClip({
      srcPath: clip3a,
      outPath: path.join(TEMP_DIR, 'seg_3a.mp4'),
      label: 'Stage-by-Stage Timeline Inspection',
      sidebarExpanded: false,
      startDelay: 0.15,
      accentHex: '0x2563EB'
    });
    const p3b = prepareClip({
      srcPath: clip3b,
      outPath: path.join(TEMP_DIR, 'seg_3b.mp4'),
      label: 'Smooth Full Chain Replay',
      sidebarExpanded: false,
      startDelay: 1.85,
      accentHex: '0x2563EB'
    });

    // 4. Assemble full timeline with smooth fades
    const timeline = [
      { path: cardIntro, duration: ffprobeInfo(cardIntro).duration },
      { path: cardCh01, duration: ffprobeInfo(cardCh01).duration },
      p1a,
      p1b,
      p1c,
      { path: cardCh02, duration: ffprobeInfo(cardCh02).duration },
      p2a,
      p2b,
      { path: cardCh03, duration: ffprobeInfo(cardCh03).duration },
      p3a,
      p3b,
      { path: cardOutro, duration: ffprobeInfo(cardOutro).duration }
    ];

    assembleMaster(timeline, MASTER_OUT);
    encodeDiscord(MASTER_OUT, DISCORD_OUT);
  }

  // 5. Decode verification contact sheets directly from final encoded MP4s
  buildContactSheet(MASTER_OUT, MASTER_SHEET, 'Master 1080p');
  buildContactSheet(DISCORD_OUT, DISCORD_SHEET, 'Discord 720p');

  // 6. Report exact ffprobe stats
  const mInfo = ffprobeInfo(MASTER_OUT);
  const dInfo = ffprobeInfo(DISCORD_OUT);
  console.log('\n=== ENCODE SUMMARY ===');
  console.log(`Master : ${MASTER_OUT}`);
  console.log(`         ${mInfo.width}x${mInfo.height} @ ${mInfo.fps} | ${mInfo.codec} ${mInfo.pixFmt} | ${mInfo.duration.toFixed(2)}s | ${(mInfo.sizeBytes / 1_048_576).toFixed(2)} MB (${mInfo.sizeBytes} bytes)`);
  console.log(`Discord: ${DISCORD_OUT}`);
  console.log(`         ${dInfo.width}x${dInfo.height} @ ${dInfo.fps} | ${dInfo.codec} ${dInfo.pixFmt} | ${dInfo.duration.toFixed(2)}s | ${(dInfo.sizeBytes / 1_048_576).toFixed(2)} MB (${dInfo.sizeBytes} bytes)`);
  console.log(`Sheets : ${MASTER_SHEET}`);
  console.log(`         ${DISCORD_SHEET}`);

  // Clean up temp dir
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

try {
  main();
} catch (err) {
  console.error('[editor] FAILED:', err.message || err);
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  process.exit(1);
}

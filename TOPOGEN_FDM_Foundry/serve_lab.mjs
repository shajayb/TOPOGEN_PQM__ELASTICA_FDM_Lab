#!/usr/bin/env node
/**
 * WFC-FDM Lab — Zero-Dependency Static & Local Chain Persistence Node.js Server (serve_lab.mjs)
 *
 * Usage:
 *   node TOPOGEN_FDM_Foundry/serve_lab.mjs [port]
 *   -> http://127.0.0.1:8000/index_TOPOGEN_PQM_ELASTICA_FDM.html
 *
 * Local API routes (all paths strictly confined inside REPO_ROOT):
 *   POST /api/assets/stage
 *   GET  /api/repo-file?path=<repoRelativePath>
 *   GET  /api/chains
 *   POST /api/chains/save
 *   POST /api/captures/save
 */

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
    normalizeRepoRelativePath,
    validateProceduralChain,
    serializeProceduralChain
} from './core/procedural_chain.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = __dirname;
const REPO_ROOT = path.resolve(ROOT_DIR, '..');
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const MAX_BODY_BYTES = 25 * 1024 * 1024; // 25 MB cap for staged .3dm/.obj/PNG payloads

const ASSETS_INPUTS_DIR = path.join(ROOT_DIR, 'assets', 'inputs');
const CORPUS_DIR = path.join(ROOT_DIR, 'corpus');
const CHAINS_DIR = path.join(ROOT_DIR, 'chains');
const CAPTURES_DIR = path.join(CORPUS_DIR, 'captures');

const NO_STORE_EXTS = new Set(['.html', '.js', '.mjs', '.css']);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.obj': 'text/plain; charset=utf-8',
    '.3dm': 'application/octet-stream',
    '.wasm': 'application/wasm',
    '.md': 'text/markdown; charset=utf-8'
};

function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store, must-revalidate'
    });
    res.end(body);
}

function readJsonBody(req, maxBytes = MAX_BODY_BYTES) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;
        let aborted = false;

        req.on('data', (chunk) => {
            if (aborted) return;
            total += chunk.length;
            if (total > maxBytes) {
                aborted = true;
                const err = new Error(`Payload exceeds ${maxBytes} byte limit.`);
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            if (aborted) return;
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw.trim()) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            } catch (err) {
                const parseErr = new Error(`Invalid JSON body: ${err.message}`);
                parseErr.statusCode = 400;
                reject(parseErr);
            }
        });

        req.on('error', (err) => {
            if (!aborted) reject(err);
        });
    });
}

function sanitizeFileName(rawName, fallback = 'file') {
    const base = path.basename(String(rawName || '').trim());
    const cleaned = base
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .replace(/^\.+/, '')
        .replace(/_+/g, '_');
    return cleaned || fallback;
}

function sanitizeSegment(raw, fallback = 'item') {
    const cleaned = String(raw || '')
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned || fallback;
}

function isInsideDir(baseDir, targetPath) {
    const resolvedBase = path.resolve(baseDir);
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget === resolvedBase) return true;
    const prefix = resolvedBase.endsWith(path.sep) ? resolvedBase : resolvedBase + path.sep;
    return process.platform === 'win32'
        ? resolvedTarget.toLowerCase().startsWith(prefix.toLowerCase())
        : resolvedTarget.startsWith(prefix);
}

function toRepoRelative(absPath) {
    return path.relative(REPO_ROOT, absPath).replace(/\\/g, '/');
}

function resolveConfinedRepoPath(repoRelInput) {
    const norm = normalizeRepoRelativePath(repoRelInput);
    const absPath = path.resolve(REPO_ROOT, norm);
    if (!isInsideDir(REPO_ROOT, absPath)) {
        const err = new Error(`Path escapes repository root: "${repoRelInput}"`);
        err.statusCode = 403;
        throw err;
    }
    return { norm, absPath };
}

async function handleStageAsset(req, res) {
    const body = await readJsonBody(req);
    if (!body || typeof body.fileName !== 'string' || !body.fileName.trim()) {
        sendJson(res, 400, { ok: false, error: 'Missing required "fileName".' });
        return;
    }

    let buf;
    if (typeof body.contentBase64 === 'string') {
        const stripped = body.contentBase64.replace(/^data:[^;]+;base64,/, '');
        buf = Buffer.from(stripped, 'base64');
    } else if (typeof body.contentText === 'string') {
        buf = Buffer.from(body.contentText, 'utf8');
    } else {
        sendJson(res, 400, { ok: false, error: 'Provide either "contentBase64" or "contentText".' });
        return;
    }

    const safeName = sanitizeFileName(body.fileName, 'asset.bin');
    const destPath = path.resolve(ASSETS_INPUTS_DIR, safeName);
    if (!isInsideDir(ASSETS_INPUTS_DIR, destPath)) {
        sendJson(res, 403, { ok: false, error: 'Invalid asset filename.' });
        return;
    }

    await fsp.mkdir(ASSETS_INPUTS_DIR, { recursive: true });
    await fsp.writeFile(destPath, buf);

    const sha256Short = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);
    const ext = path.extname(safeName).toLowerCase();
    const repoRelativePath = `TOPOGEN_FDM_Foundry/assets/inputs/${safeName}`;

    sendJson(res, 200, {
        ok: true,
        fileName: safeName,
        repoRelativePath,
        bytes: buf.length,
        sha256Short,
        ext
    });
}

async function handleRepoFile(req, res, urlObj) {
    const reqParam = urlObj.searchParams.get('path') || '';
    let resolved;
    try {
        resolved = resolveConfinedRepoPath(reqParam);
    } catch (err) {
        sendJson(res, err.statusCode || 403, { ok: false, error: err.message });
        return;
    }

    let stat;
    try {
        stat = await fsp.lstat(resolved.absPath);
    } catch {
        sendJson(res, 404, { ok: false, error: `File not found: ${resolved.norm}` });
        return;
    }

    if (stat.isSymbolicLink()) {
        const real = await fsp.realpath(resolved.absPath);
        if (!isInsideDir(REPO_ROOT, real)) {
            sendJson(res, 403, { ok: false, error: 'Symlink escapes repository root.' });
            return;
        }
        stat = await fsp.stat(real);
    }

    if (!stat.isFile()) {
        sendJson(res, 404, { ok: false, error: `Not a file: ${resolved.norm}` });
        return;
    }

    const ext = path.extname(resolved.absPath).toLowerCase();
    const headers = {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Cache-Control': 'no-store, must-revalidate'
    };
    res.writeHead(200, headers);
    fs.createReadStream(resolved.absPath).pipe(res);
}

async function listChainsInDir(dirPath, source) {
    const items = [];
    let entries;
    try {
        entries = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
        return items;
    }

    for (const ent of entries) {
        if (!ent.isFile() || !ent.name.endsWith('.chain.json')) continue;
        const abs = path.join(dirPath, ent.name);
        try {
            const [stat, raw] = await Promise.all([fsp.stat(abs), fsp.readFile(abs, 'utf8')]);
            const parsed = JSON.parse(raw);
            items.push({
                id: parsed.id || ent.name.replace(/\.chain\.json$/i, ''),
                name: parsed.name || ent.name,
                schema: parsed.schema || null,
                source,
                fileName: ent.name,
                repoRelativePath: toRepoRelative(abs),
                updatedAt: parsed.updatedAt || stat.mtime.toISOString(),
                stepCount: Array.isArray(parsed.steps) ? parsed.steps.length : 0,
                assetCount: Array.isArray(parsed.assets) ? parsed.assets.length : 0,
                bookmarkCount: Array.isArray(parsed.bookmarks) ? parsed.bookmarks.length : 0,
                bytes: stat.size
            });
        } catch (err) {
            items.push({
                id: ent.name.replace(/\.chain\.json$/i, ''),
                name: ent.name,
                source,
                fileName: ent.name,
                repoRelativePath: toRepoRelative(abs),
                error: err.message
            });
        }
    }
    return items;
}

async function handleListChains(req, res) {
    const [corpusChains, userChains] = await Promise.all([
        listChainsInDir(CORPUS_DIR, 'corpus'),
        listChainsInDir(CHAINS_DIR, 'chains')
    ]);
    const chains = [...corpusChains, ...userChains].sort((a, b) =>
        String(a.repoRelativePath).localeCompare(String(b.repoRelativePath))
    );
    sendJson(res, 200, { ok: true, chains });
}

async function handleSaveChain(req, res) {
    const body = await readJsonBody(req);
    const chainObj = body && body.chain && typeof body.chain === 'object' ? body.chain : body;
    const validation = validateProceduralChain(chainObj);
    if (!validation.ok) {
        sendJson(res, 400, {
            ok: false,
            error: `Invalid procedural chain: ${validation.errors.join('; ')}`,
            errors: validation.errors,
            warnings: validation.warnings
        });
        return;
    }

    const target = body && body.target === 'corpus' ? 'corpus' : 'chains';
    const targetDir = target === 'corpus' ? CORPUS_DIR : CHAINS_DIR;

    const rawName = (body && typeof body.fileName === 'string' && body.fileName.trim())
        ? body.fileName.trim()
        : (chainObj.id || chainObj.name || 'chain');
    const stripped = rawName.replace(/\.chain\.json$/i, '').replace(/\.json$/i, '');
    const safeBase = sanitizeSegment(stripped, 'chain');
    const finalName = `${safeBase}.chain.json`;
    const destPath = path.resolve(targetDir, finalName);

    if (!isInsideDir(targetDir, destPath)) {
        sendJson(res, 403, { ok: false, error: 'Invalid chain destination path.' });
        return;
    }

    const serialized = serializeProceduralChain(chainObj, { pretty: true }) + '\n';
    await fsp.mkdir(targetDir, { recursive: true });
    await fsp.writeFile(destPath, serialized, 'utf8');

    sendJson(res, 200, {
        ok: true,
        id: chainObj.id,
        target,
        fileName: finalName,
        repoRelativePath: toRepoRelative(destPath),
        bytes: Buffer.byteLength(serialized, 'utf8'),
        warnings: validation.warnings
    });
}

async function handleSaveCapture(req, res) {
    const body = await readJsonBody(req);
    if (!body || typeof body.chainId !== 'string' || !body.chainId.trim()) {
        sendJson(res, 400, { ok: false, error: 'Missing required "chainId".' });
        return;
    }
    const rawImage = typeof body.imageBase64 === 'string'
        ? body.imageBase64
        : (typeof body.dataUrl === 'string' ? body.dataUrl : '');

    if (!rawImage && !body.manifest) {
        sendJson(res, 400, { ok: false, error: 'Provide "imageBase64" / "dataUrl" and/or "manifest".' });
        return;
    }

    const safeChainId = sanitizeSegment(body.chainId, 'chain');
    const chainCaptureDir = path.resolve(CAPTURES_DIR, safeChainId);
    if (!isInsideDir(CAPTURES_DIR, chainCaptureDir)) {
        sendJson(res, 403, { ok: false, error: 'Invalid capture chainId.' });
        return;
    }
    await fsp.mkdir(chainCaptureDir, { recursive: true });

    let repoRelativePath = null;
    let bytes = 0;

    if (rawImage) {
        const rawStage = typeof body.stageFile === 'string' && body.stageFile.trim()
            ? body.stageFile.trim()
            : `stage_${Date.now()}`;
        const strippedStage = rawStage.replace(/\.png$/i, '');
        const safeStage = `${sanitizeFileName(strippedStage, 'stage')}.png`;
        const pngPath = path.resolve(chainCaptureDir, safeStage);
        if (!isInsideDir(chainCaptureDir, pngPath)) {
            sendJson(res, 403, { ok: false, error: 'Invalid stageFile name.' });
            return;
        }
        const b64 = rawImage.replace(/^data:image\/[a-zA-Z0-9+.-]+;base64,/, '');
        const buf = Buffer.from(b64, 'base64');
        await fsp.writeFile(pngPath, buf);
        repoRelativePath = toRepoRelative(pngPath);
        bytes = buf.length;
    }

    let manifestRepoRelativePath = null;
    if (body.manifest && typeof body.manifest === 'object') {
        const rawManifestName = typeof body.manifestFile === 'string' && body.manifestFile.trim()
            ? body.manifestFile.trim()
            : 'manifest.json';
        const safeManifestName = sanitizeFileName(
            rawManifestName.endsWith('.json') ? rawManifestName : `${rawManifestName}.json`,
            'manifest.json'
        );
        const manifestPath = path.resolve(chainCaptureDir, safeManifestName);
        if (!isInsideDir(chainCaptureDir, manifestPath)) {
            sendJson(res, 403, { ok: false, error: 'Invalid manifestFile name.' });
            return;
        }
        const manifestJson = JSON.stringify(body.manifest, null, 2) + '\n';
        await fsp.writeFile(manifestPath, manifestJson, 'utf8');
        manifestRepoRelativePath = toRepoRelative(manifestPath);
    }

    const result = { ok: true, repoRelativePath, bytes };
    if (manifestRepoRelativePath) {
        result.manifestRepoRelativePath = manifestRepoRelativePath;
    }
    sendJson(res, 200, result);
}

const server = http.createServer(async (req, res) => {
    try {
        const urlObj = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
        const reqPath = urlObj.pathname;
        const method = (req.method || 'GET').toUpperCase();

        if (method === 'POST' && reqPath === '/api/assets/stage') {
            await handleStageAsset(req, res);
            return;
        }
        if (method === 'GET' && reqPath === '/api/repo-file') {
            await handleRepoFile(req, res, urlObj);
            return;
        }
        if (method === 'GET' && reqPath === '/api/chains') {
            await handleListChains(req, res);
            return;
        }
        if (method === 'POST' && reqPath === '/api/chains/save') {
            await handleSaveChain(req, res);
            return;
        }
        if (method === 'POST' && reqPath === '/api/captures/save') {
            await handleSaveCapture(req, res);
            return;
        }

        // Default static file serving inside ROOT_DIR
        const relPath = reqPath === '/'
            ? 'index_TOPOGEN_PQM_ELASTICA_FDM.html'
            : decodeURIComponent(reqPath.replace(/^\/+/, ''));
        const fullPath = path.resolve(ROOT_DIR, relPath);

        if (!isInsideDir(ROOT_DIR, fullPath)) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('403 Forbidden');
            return;
        }

        fs.stat(fullPath, (err, stats) => {
            if (err || !stats.isFile()) {
                res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end(`404 Not Found: ${relPath}`);
                return;
            }
            const ext = path.extname(fullPath).toLowerCase();
            const headers = {
                'Content-Type': MIME_TYPES[ext] || 'application/octet-stream'
            };
            if (NO_STORE_EXTS.has(ext)) {
                headers['Cache-Control'] = 'no-store, must-revalidate';
                headers['Pragma'] = 'no-cache';
                headers['Expires'] = '0';
            }
            res.writeHead(200, headers);
            fs.createReadStream(fullPath).pipe(res);
        });
    } catch (err) {
        sendJson(res, err.statusCode || 500, {
            ok: false,
            error: err && err.message ? err.message : 'Internal server error'
        });
    }
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`WFC-FDM Lab serving at http://127.0.0.1:${PORT}/index_TOPOGEN_PQM_ELASTICA_FDM.html`);
});

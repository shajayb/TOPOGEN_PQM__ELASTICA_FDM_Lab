#!/usr/bin/env node
/**
 * WFC-FDM Lab — Zero-Dependency Static Node.js Server (serve_lab.mjs)
 *
 * Usage:
 *   node WFC_FDM_Foundry/serve_lab.mjs [port]
 *   -> http://127.0.0.1:8000/index_WFC.html
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = __dirname;
const PORT = Number(process.argv[2] || process.env.PORT || 8000);

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.obj': 'text/plain; charset=utf-8',
    '.3dm': 'application/octet-stream',
    '.wasm': 'application/wasm',
    '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
    const reqPath = (req.url || '/').split('?')[0];
    const relPath = reqPath === '/' ? 'index_WFC.html' : decodeURIComponent(reqPath.replace(/^\/+/, ''));
    const fullPath = path.resolve(ROOT_DIR, relPath);

    if (!fullPath.startsWith(ROOT_DIR)) {
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
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        fs.createReadStream(fullPath).pipe(res);
    });
});

server.listen(PORT, '127.0.0.1', () => {
    console.log(`WFC-FDM Lab serving at http://127.0.0.1:${PORT}/index_WFC.html`);
});

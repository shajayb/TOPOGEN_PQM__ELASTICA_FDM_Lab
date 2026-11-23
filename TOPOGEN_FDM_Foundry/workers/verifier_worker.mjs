#!/usr/bin/env node
/**
 * WFC-FDM Foundry — Warm Persistent Air-Gapped Verifier Worker (`node:worker_threads`)
 *
 * Strictly Air-Gapped Verifier Domain:
 *   - Imports ONLY `../verifier/verify.mjs` (`verifyCandidate`) and Node built-ins (`node:fs`, `node:path`).
 *   - NEVER imports or references any generator file or symbol.
 *   - Evaluates neutral candidate artifacts (on-disk paths or neutral JSON/OBJ/SVG strings)
 *     in ~3–15 ms with zero OS process-spawn overhead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parentPort } from 'node:worker_threads';
import { verifyCandidate } from '../verifier/verify.mjs';

if (parentPort) {
  parentPort.on('message', (msg) => {
    const { id, type } = msg || {};
    const t0 = performance.now();
    try {
      if (type === 'ping' || type === 'warmup') {
        parentPort.postMessage({
          id,
          ok: true,
          elapsedMs: +(performance.now() - t0).toFixed(2),
        });
        return;
      }

      if (type === 'verify') {
        const brief = msg.brief || (msg.briefPath ? JSON.parse(fs.readFileSync(msg.briefPath, 'utf8')) : {});
        const topology = msg.topology || (msg.topoPath ? JSON.parse(fs.readFileSync(msg.topoPath, 'utf8')) : null);
        if (!topology) {
          throw new Error('Missing candidate topology for verification.');
        }

        const objText = msg.objText !== undefined
          ? msg.objText
          : (msg.objPath && fs.existsSync(msg.objPath) ? fs.readFileSync(msg.objPath, 'utf8') : null);

        const svgText = msg.svgText !== undefined
          ? msg.svgText
          : (msg.svgPath && fs.existsSync(msg.svgPath) ? fs.readFileSync(msg.svgPath, 'utf8') : null);

        const unrolledData = msg.unrolledData !== undefined
          ? msg.unrolledData
          : (msg.unrollPath && fs.existsSync(msg.unrollPath)
            ? JSON.parse(fs.readFileSync(msg.unrollPath, 'utf8'))
            : null);

        const verdict = verifyCandidate(topology, brief, objText, {
          svgText,
          unrolledData,
        });

        if (msg.candidateName) {
          verdict.candidateName = msg.candidateName;
        }

        if (msg.verdictPath) {
          fs.mkdirSync(path.dirname(msg.verdictPath), { recursive: true });
          fs.writeFileSync(msg.verdictPath, JSON.stringify(verdict, null, 2) + '\n', 'utf8');
        }

        parentPort.postMessage({
          id,
          ok: true,
          elapsedMs: +(performance.now() - t0).toFixed(2),
          passed: Boolean(verdict.passed),
          verdict: msg.returnVerdict !== false ? verdict : undefined,
        });
        return;
      }

      parentPort.postMessage({ id, ok: false, error: `Unknown verifier_worker message type: ${type}` });
    } catch (err) {
      parentPort.postMessage({
        id,
        ok: false,
        error: err?.message || String(err),
        elapsedMs: +(performance.now() - t0).toFixed(2),
      });
    }
  });
}

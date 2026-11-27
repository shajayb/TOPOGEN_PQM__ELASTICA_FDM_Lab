import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  UI_STEPS,
  UI_STEP_MODES,
  UI_LOAD_TARGETS,
  UI_EXPORT_FORMATS,
  UI_SURFACES,
} from './ui-action-contract.mjs';

const DEFAULT_FOUNDRY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = properties => ({ type: 'object', properties, additionalProperties: false });

export const toolDefinitions = [
  // ── Mode A Foundry Governance & Inspection ──────────────────────────────────
  {
    name: 'topogen_inspect',
    description: 'Inspect TOPOGEN_FDM_Foundry daemon health, ecosystem, Mode A/B state, foundry_manifest.json seal status, active campaign, available presets, briefs, and live UI bridge connection.',
    inputSchema: schema({ verbose: { type: 'boolean' } }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_seal_check',
    description: 'Run foundry_mode_guard cryptographic surface seal and air-gap verification. In Mode B only (allowModeB=true), optional reseal: true recomputes foundry_manifest.json seals.',
    inputSchema: schema({
      mode: { type: 'string', enum: ['A', 'B'] },
      reseal: { type: 'boolean' },
      skipBench: { type: 'boolean' }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_list_briefs',
    description: 'List available design briefs under TOPOGEN_FDM_Foundry/briefs/. Pass includeContent: true to return full brief JSON bodies.',
    inputSchema: schema({ includeContent: { type: 'boolean' } }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_save_brief',
    description: 'Validate and save a design brief JSON under TOPOGEN_FDM_Foundry/briefs/ (Mode A mutable surface).',
    inputSchema: {
      ...schema({
        id: { type: 'string', maxLength: 120 },
        brief: { type: 'object' }
      }),
      required: ['id', 'brief']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },

  // ── Mode A Headless Generation, Verification & Campaigns ────────────────────
  {
    name: 'topogen_quick_eval',
    description: 'Run a single-shot air-gapped Generate -> Verify evaluation using warm worker threads (<100ms typical), returning structural KPIs, verdict, and optional artifact paths.',
    inputSchema: schema({
      briefId: { type: 'string', maxLength: 120 },
      briefData: { type: 'object' },
      preset: { type: 'string', maxLength: 120 },
      grid: { type: 'string', maxLength: 32 },
      mode: { type: 'string', maxLength: 64 },
      seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
      radius: { type: 'number', minimum: 0.001, maximum: 5.0 },
      innerRadius: { type: 'number', minimum: 0, maximum: 5.0 },
      subdiv: { type: 'integer', minimum: 1, maximum: 64 },
      pq: { type: 'boolean' },
      unroll: { type: 'boolean' },
      writeDir: { type: 'string', maxLength: 500 },
      name: { type: 'string', maxLength: 120 }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_launch_campaign',
    description: 'Launch a gated TOPOGEN Foundry design campaign. Execution mode B requires allowModeB=true on the daemon.',
    inputSchema: schema({
      briefId: { type: 'string', maxLength: 120 },
      briefData: { type: 'object' },
      executionMode: { type: 'string', enum: ['A', 'B'] },
      gates: { type: 'array', maxItems: 16, items: { type: 'integer', minimum: 1, maximum: 10 } },
      searchProfile: { type: 'string', enum: ['lightning', 'interactive', 'thorough'] },
      concurrency: { type: 'integer', minimum: 1, maximum: 32 },
      maxRounds: { type: 'integer', minimum: 1, maximum: 50 },
      candidatesPerRound: { type: 'integer', minimum: 1, maximum: 200 },
      runId: { type: 'string', maxLength: 120 }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_campaign_status',
    description: 'Inspect active or historical Foundry campaign status. Optional waitSeconds (0..60) waits on the server until the campaign completes or the timeout elapses.',
    inputSchema: schema({
      runId: { type: 'string', maxLength: 120 },
      waitSeconds: { type: 'number', minimum: 0, maximum: 60 }
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_nudge_campaign',
    description: 'Nudge an active Foundry campaign (finish_round or inject_candidate).',
    inputSchema: {
      ...schema({
        action: { type: 'string', enum: ['finish_round', 'inject_candidate'] },
        candidate: { type: 'object' }
      }),
      required: ['action']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_stop_campaign',
    description: 'Gracefully stop the currently running Foundry campaign.',
    inputSchema: schema({}),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_list_runs',
    description: 'List historical Foundry campaign runs under TOPOGEN_FDM_Foundry/runs/.',
    inputSchema: schema({ limit: { type: 'integer', minimum: 1, maximum: 100 } }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_get_run',
    description: 'Inspect a specific Foundry campaign run, including its Pareto front, champion verdict, and optional candidate list.',
    inputSchema: {
      ...schema({
        runId: { type: 'string', maxLength: 120 },
        includeCandidates: { type: 'boolean' }
      }),
      required: ['runId']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_build_report',
    description: 'Build the interactive Goldilocks 3D HTML report (build_report.mjs) for a completed campaign run.',
    inputSchema: {
      ...schema({ runId: { type: 'string', maxLength: 120 } }),
      required: ['runId']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },

  // ── Mode A Live 3D Workbench UI Bridge (Chrome + Conversation Affinity) ─────
  {
    name: 'topogen_ui_launch',
    description: 'Launch or reuse a Google Chrome tab on the TOPOGEN 3D Workbench (index_TOPOGEN_PQM_ELASTICA_FDM.html) or Campaign Launcher, deterministically pair it to conversationId, verify live UI bridge handshake, and optionally apply initial preset/grid/tab configuration.',
    inputSchema: schema({
      conversationId: { type: 'string', maxLength: 120 },
      surface: { type: 'string', enum: [...UI_SURFACES] },
      reuseExisting: { type: 'boolean' },
      newTab: { type: 'boolean' },
      adoptUnbound: { type: 'boolean' },
      waitMs: { type: 'integer', minimum: 500, maximum: 30000 },
      prepareOnly: { type: 'boolean' },
      waitOnlyLaunchId: { type: 'string', maxLength: 80 },
      preset: { type: 'string', maxLength: 120 },
      grid: { type: 'string', maxLength: 32 },
      gridResolution: { type: ['string', 'array', 'object'] },
      tab: { type: 'string', maxLength: 64 }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_tabs',
    description: 'List all connected TOPOGEN browser tabs (clientId, surface, browserKind, bridgeVersion, conversationId, visible, focused, url) and active conversation-to-tab bindings.',
    inputSchema: schema({
      conversationId: { type: 'string', maxLength: 120 },
      surface: { type: 'string', enum: [...UI_SURFACES] }
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_connect',
    description: 'Explicitly pair (or unpair when conversationId is null) a conversationId to a connected browser tab clientId or to the currently focused Google Chrome Workbench tab.',
    inputSchema: schema({
      conversationId: { type: ['string', 'null'], maxLength: 120 },
      clientId: { type: 'string', maxLength: 80 },
      claimFocusedChrome: { type: 'boolean' },
      surface: { type: 'string', enum: [...UI_SURFACES] }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_inspect',
    description: 'Read live state from the open TOPOGEN 3D Workbench browser tab (active tab, grid resolution, preset, custom tiles, FDM mode, Elastica status, node/edge/quad counts, planarity error, FEA preview summary, and connected browser tabs).',
    inputSchema: schema({
      verbose: { type: 'boolean' },
      clientId: { type: 'string', maxLength: 80 },
      conversationId: { type: 'string', maxLength: 120 },
      autoLaunchChrome: { type: 'boolean' },
      allowWebviewFallback: { type: 'boolean' }
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_load_file',
    description: 'Load a custom .obj, .3dm, or .json geometry file into the live TOPOGEN 3D Workbench browser tab (Tab 1 coarse mesh / graph tile with Catmull-Clark subDiv 0..4, mesh_tile host mesh, or Tab 2 polyline network). Accepts either a local filePath (read server-side, <=10MB) or inline content/contentBase64 + fileName.',
    inputSchema: schema({
      target: { type: 'string', enum: [...UI_LOAD_TARGETS] },
      filePath: { type: 'string', maxLength: 500 },
      fileName: { type: 'string', maxLength: 200 },
      content: { type: 'string', maxLength: 200000 },
      contentBase64: { type: 'string', maxLength: 200000 },
      subDiv: { type: 'integer', minimum: 0, maximum: 4 },
      meshOnly: { type: 'boolean' },
      skeletonize: { type: 'boolean' },
      fitToVoxel: { type: 'boolean' },
      customOnly: { type: 'boolean' },
      clearExisting: { type: 'boolean' },
      weldTol: { type: 'number', minimum: 0.0001, maximum: 0.5 },
      replace: { type: 'boolean' },
      discardPending: { type: 'boolean' },
      clientId: { type: 'string', maxLength: 80 },
      conversationId: { type: 'string', maxLength: 120 },
      autoLaunchChrome: { type: 'boolean' }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_configure',
    description: 'Configure parameters on the live TOPOGEN 3D Workbench tab (preset, grid/gridResolution, voxelPins/clearVoxelPins, subDiv 0..4, seed, FDM mode, tube radii, PQ subdivision, Elastica solver/valency sources & sinks, FEA animate/deflectionScale/loadCase, camera preset or orbit object, active tab, or params object).',
    inputSchema: schema({
      preset: { type: 'string', maxLength: 120 },
      grid: { type: 'string', maxLength: 32 },
      gridResolution: { type: ['string', 'array', 'object'] },
      voxelPins: {
        type: 'array',
        maxItems: 512,
        items: {
          type: 'object',
          properties: {
            x: { type: 'integer', minimum: 0, maximum: 63 },
            y: { type: 'integer', minimum: 0, maximum: 63 },
            z: { type: 'integer', minimum: 0, maximum: 63 },
            tile: { type: ['string', 'integer'] }
          },
          required: ['x', 'y', 'z', 'tile'],
          additionalProperties: false
        }
      },
      clearVoxelPins: { type: 'boolean' },
      seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
      mode: { type: 'string', maxLength: 64 },
      fdmMode: { type: 'string', maxLength: 64 },
      radius: { type: 'number', minimum: 0.001, maximum: 5.0 },
      outerRadiusM: { type: 'number', minimum: 0.001, maximum: 5.0 },
      innerRadius: { type: 'number', minimum: 0, maximum: 5.0 },
      innerRadiusM: { type: 'number', minimum: 0, maximum: 5.0 },
      voxelSize: { type: 'number', minimum: 0.01, maximum: 100 },
      subdiv: { type: 'integer', minimum: 0, maximum: 64 },
      subDiv: { type: 'integer', minimum: 0, maximum: 4 },
      ccLevel: { type: 'integer', minimum: 0, maximum: 4 },
      skeletonize: { type: 'boolean' },
      algorithm: { type: 'string', maxLength: 64 },
      tubeColorMode: { type: 'string', maxLength: 64 },
      goldilocksMode: { type: 'string', maxLength: 16 },
      arctic: { type: 'boolean' },
      pq: {
        type: ['boolean', 'object'],
        properties: {
          selectedLoopId: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
          optimization: { type: 'boolean' },
          colorMode: { type: 'string', maxLength: 64 },
          nSides: { type: 'integer', minimum: 3, maximum: 64 },
          longitudinalSubdivLevels: { type: 'integer', minimum: 0, maximum: 8 }
        },
        additionalProperties: false
      },
      unroll: { type: 'boolean' },
      camera: { type: ['string', 'object'] },
      tab: { type: 'string', maxLength: 64 },
      elastica: { type: 'object' },
      fea: {
        type: 'object',
        properties: {
          animate: { type: 'boolean' },
          deflectionScale: { type: 'number', minimum: 0, maximum: 1000 },
          loadCase: { type: 'string', maxLength: 120 },
          excludeGraph: { type: 'boolean' },
          includeElastica: { type: 'boolean' },
          rodMaterial: { type: 'string', maxLength: 64 },
          material: { type: 'string', maxLength: 64 },
          topLoadKg: { type: 'number', minimum: 0, maximum: 100000 },
          restraintType: { type: 'string', maxLength: 32 }
        },
        additionalProperties: false
      },
      params: { type: 'object' },
      clientId: { type: 'string', maxLength: 80 },
      conversationId: { type: 'string', maxLength: 120 },
      autoLaunchChrome: { type: 'boolean' }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_run_step',
    description: 'Trigger a live computation step in the open TOPOGEN 3D Workbench browser tab (wfc, collapse_all, reset_topo, fdm, reset_fdm, solidify, pq, longitudinal_subdiv, ring_subdiv, swap_long_ring, select_pq_loop, pq_optimize, unroll, elastica, elastica_trace, elastica_reset, elastica_unroll, fea, fea_animate, chain_load, chain_play, chain_jump, chain_clear, camera_bookmark, zoom_fit, reload, or all).',
    inputSchema: {
      ...schema({
        step: {
          type: 'string',
          enum: [...UI_STEPS]
        },
        mode: { type: 'string', enum: [...UI_STEP_MODES] },
        loopId: { type: ['integer', 'null'], minimum: 0, maximum: 10000 },
        params: { type: 'object' },
        clientId: { type: 'string', maxLength: 80 },
        conversationId: { type: 'string', maxLength: 120 },
        autoLaunchChrome: { type: 'boolean' }
      }),
      required: ['step']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_reload',
    description: 'Trigger a zero-restart cache-busting hot-reload of the connected TOPOGEN 3D Workbench or Launcher browser tab, optionally preserving active Workbench session state and awaiting post-reload bridge readiness.',
    inputSchema: schema({
      conversationId: { type: 'string', maxLength: 120 },
      clientId: { type: 'string', maxLength: 80 },
      surface: { type: 'string', enum: [...UI_SURFACES] },
      preserveState: { type: 'boolean' },
      hardReload: { type: 'boolean' },
      waitMs: { type: 'integer', minimum: 500, maximum: 30000 }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_export',
    description: 'Export current geometry artifacts from the live TOPOGEN 3D Workbench browser tab (topology, topology_json, obj, svg, unroll_svg, elastica_svg, snapshot, or all).',
    inputSchema: {
      ...schema({
        format: {
          type: 'string',
          enum: [...UI_EXPORT_FORMATS]
        },
        includeData: { type: 'boolean' },
        download: { type: 'boolean' },
        scale: { type: 'number', minimum: 0.1, maximum: 1.0 },
        clientId: { type: 'string', maxLength: 80 },
        conversationId: { type: 'string', maxLength: 120 },
        autoLaunchChrome: { type: 'boolean' }
      }),
      required: ['format']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },

  // ── Mode B Confined Workspace Tools ─────────────────────────────────────────
  {
    name: 'topogen_workspace_list',
    description: 'List files and directories inside the bounded project workspace or session scratch directory. Read-only; excludes credential files and symlinks.',
    inputSchema: schema({
      path: { type: 'string', maxLength: 500 },
      recursive: { type: 'boolean' },
      maxEntries: { type: 'integer', minimum: 1, maximum: 200 }
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_workspace_read',
    description: 'Read a bounded text file inside the project workspace or session scratch directory with optional startLine and endLine. Blocks credential and API key files.',
    inputSchema: {
      ...schema({
        path: { type: 'string', maxLength: 500 },
        startLine: { type: 'integer', minimum: 1, maximum: 100000 },
        endLine: { type: 'integer', minimum: 1, maximum: 100000 }
      }),
      required: ['path']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_workspace_read_batch',
    description: 'Read 1..12 bounded text files inside the project workspace or session scratch directory in one round-trip, with secret redaction and optional startLine/endLine ranges.',
    inputSchema: {
      ...schema({
        files: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', maxLength: 500 },
              startLine: { type: 'integer', minimum: 1, maximum: 100000 },
              endLine: { type: 'integer', minimum: 1, maximum: 100000 }
            },
            required: ['path'],
            additionalProperties: false
          }
        }
      }),
      required: ['files']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_workspace_search',
    description: 'Search one or multiple (1..8) text/regex queries in parallel across files inside the project workspace or session scratch directory, with optional include/exclude globs. Skips binary, credential, and run-artifact files by default.',
    inputSchema: schema({
      query: { type: 'string', maxLength: 500 },
      queries: {
        type: 'array',
        minItems: 1,
        maxItems: 8,
        items: { type: 'string', maxLength: 500 }
      },
      path: { type: 'string', maxLength: 500 },
      include: {
        type: ['string', 'array'],
        maxItems: 16,
        items: { type: 'string', maxLength: 200 }
      },
      exclude: {
        type: ['string', 'array'],
        maxItems: 16,
        items: { type: 'string', maxLength: 200 }
      },
      regex: { type: 'boolean' },
      caseSensitive: { type: 'boolean' },
      maxMatches: { type: 'integer', minimum: 1, maximum: 200 }
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_workspace_edit',
    description: 'Apply a single-file surgical edit or an atomic all-or-nothing multi-file edit batch (edits: 1..20) inside the Mode B project workspace or scratch directory. Strictly requires allowModeB=true. Refuses path traversal, symlinks, .git internals, credential files, and Generator<->Verifier air-gap violations.',
    inputSchema: schema({
      path: { type: 'string', maxLength: 500 },
      target: { type: 'string', maxLength: 131072 },
      replacement: { type: 'string', maxLength: 131072 },
      content: { type: 'string', maxLength: 262144 },
      replaceAll: { type: 'boolean' },
      edits: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', maxLength: 500 },
            target: { type: 'string', maxLength: 131072 },
            replacement: { type: 'string', maxLength: 131072 },
            content: { type: 'string', maxLength: 262144 },
            replaceAll: { type: 'boolean' }
          },
          required: ['path'],
          additionalProperties: false
        }
      }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_workspace_run_command',
    description: 'Run a bounded local engineering or test command (node, npm, npx, git, pwsh, powershell, clang++, python, python3) inside the Mode B project workspace or scratch directory with <=120s timeout, output cap, and secret redaction. Strictly requires allowModeB=true.',
    inputSchema: {
      ...schema({
        command: { type: 'string', maxLength: 200 },
        args: { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 1000 } },
        cwd: { type: 'string', maxLength: 500 },
        timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000 }
      }),
      required: ['command']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  }
];

export const toolOperations = Object.freeze({
  topogen_inspect: 'foundry.inspect',
  topogen_seal_check: 'foundry.seal_check',
  topogen_list_briefs: 'briefs.list',
  topogen_save_brief: 'briefs.save',
  topogen_quick_eval: 'foundry.quick_eval',
  topogen_launch_campaign: 'campaign.launch',
  topogen_campaign_status: 'campaign.status',
  topogen_nudge_campaign: 'campaign.nudge',
  topogen_stop_campaign: 'campaign.stop',
  topogen_list_runs: 'runs.list',
  topogen_get_run: 'runs.get',
  topogen_build_report: 'runs.build_report',
  topogen_ui_launch: 'ui.launch',
  topogen_ui_tabs: 'ui.tabs',
  topogen_ui_connect: 'ui.connect',
  topogen_ui_inspect: 'ui.inspect',
  topogen_ui_load_file: 'ui.load_file',
  topogen_ui_configure: 'ui.configure',
  topogen_ui_run_step: 'ui.run_step',
  topogen_ui_reload: 'ui.reload',
  topogen_ui_export: 'ui.export',
  topogen_workspace_list: 'workspace.list',
  topogen_workspace_read: 'workspace.read',
  topogen_workspace_read_batch: 'workspace.read_batch',
  topogen_workspace_search: 'workspace.search',
  topogen_workspace_edit: 'workspace.edit',
  topogen_workspace_run_command: 'workspace.run_command'
});

function canonicalizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalizeValue);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      const v = value[key];
      if (v !== undefined) {
        out[key] = canonicalizeValue(v);
      }
    }
    return out;
  }
  return value;
}

export function computeToolsSha256(defs = toolDefinitions) {
  const canonical = JSON.stringify(canonicalizeValue(defs));
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

export const TOOLS_SHA256 = computeToolsSha256(toolDefinitions);

export function readManifestSurfaceInfo(rootDir = DEFAULT_FOUNDRY_ROOT) {
  const resolvedRoot = path.resolve(rootDir || DEFAULT_FOUNDRY_ROOT);
  const manifestPath = path.join(resolvedRoot, 'foundry_manifest.json');
  try {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(raw);
    const seals = manifest?.seals && typeof manifest.seals === 'object' ? manifest.seals : {};
    const semanticVersion = typeof manifest?.semanticVersion === 'string' ? manifest.semanticVersion : null;
    return {
      ok: true,
      manifestPath,
      foundryVersion: semanticVersion,
      semanticVersion,
      codeSurfaceSha256: typeof seals.codeSurfaceSha256 === 'string' ? seals.codeSurfaceSha256 : null,
      verifierSurfaceSha256: typeof seals.verifierSurfaceSha256 === 'string' ? seals.verifierSurfaceSha256 : null,
      codeFileCount: Number.isInteger(seals.codeFileCount) ? seals.codeFileCount : null,
      verifierFileCount: Number.isInteger(seals.verifierFileCount) ? seals.verifierFileCount : null,
      sealedAtUtc: typeof seals.sealedAtUtc === 'string' ? seals.sealedAtUtc : null,
    };
  } catch (err) {
    return {
      ok: false,
      manifestPath,
      foundryVersion: null,
      semanticVersion: null,
      codeSurfaceSha256: null,
      verifierSurfaceSha256: null,
      codeFileCount: null,
      verifierFileCount: null,
      sealedAtUtc: null,
      error: err?.message || String(err),
    };
  }
}

const SAFE_ID_RE = /^[a-zA-Z0-9._:-]{1,120}$/;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function validateUiRoutingFields(args, { allowNullConversation = false } = {}) {
  if (args.clientId !== undefined && (typeof args.clientId !== 'string' || !SAFE_ID_RE.test(args.clientId) || args.clientId.length > 80)) {
    throw Error('Invalid clientId');
  }
  if (args.conversationId !== undefined) {
    if (allowNullConversation && args.conversationId === null) {
      // Valid explicit unpair
    } else if (typeof args.conversationId !== 'string' || !SAFE_ID_RE.test(args.conversationId) || args.conversationId.includes('..') || args.conversationId.length > 120) {
      throw Error('Invalid conversationId');
    }
  }
  if (args.autoLaunchChrome !== undefined && typeof args.autoLaunchChrome !== 'boolean') {
    throw Error('autoLaunchChrome must be a boolean');
  }
  if (args.allowWebviewFallback !== undefined && typeof args.allowWebviewFallback !== 'boolean') {
    throw Error('allowWebviewFallback must be a boolean');
  }
}

function validateGridResolutionField(gridResolution) {
  if (gridResolution === undefined) return;
  if (typeof gridResolution === 'string') {
    if (!gridResolution.trim() || gridResolution.length > 32) {
      throw Error('Invalid gridResolution string');
    }
    return;
  }
  if (Array.isArray(gridResolution)) {
    if (
      gridResolution.length !== 3 ||
      !gridResolution.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 1 && n <= 64)
    ) {
      throw Error('gridResolution array must contain 3 numbers between 1 and 64');
    }
    return;
  }
  if (isPlainObject(gridResolution)) {
    if (
      !['x', 'y', 'z'].every(
        k => typeof gridResolution[k] === 'number' && Number.isFinite(gridResolution[k]) && gridResolution[k] >= 1 && gridResolution[k] <= 64
      )
    ) {
      throw Error('gridResolution object must provide numeric { x, y, z } between 1 and 64');
    }
    return;
  }
  throw Error('gridResolution must be a string, [x, y, z] array, or { x, y, z } object');
}

export function validateTool(name, args) {
  const tool = toolDefinitions.find(t => t.name === name);
  if (!tool || !isPlainObject(args)) throw Error('Unknown tool or invalid arguments');
  for (const key of Object.keys(args)) {
    if (!Object.hasOwn(tool.inputSchema.properties, key)) {
      throw Error('Unexpected tool argument: ' + key);
    }
  }

  if (name === 'topogen_inspect' || name === 'topogen_ui_inspect') {
    if (args.verbose !== undefined && typeof args.verbose !== 'boolean') throw Error('verbose must be a boolean');
    validateUiRoutingFields(args);
    return toolOperations[name];
  }

  if (name === 'topogen_ui_launch') {
    validateUiRoutingFields(args);
    if (args.surface !== undefined && !UI_SURFACES.includes(args.surface)) {
      throw Error(`surface must be one of ${UI_SURFACES.join(', ')}`);
    }
    for (const k of ['reuseExisting', 'newTab', 'adoptUnbound', 'prepareOnly']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    if (args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || args.waitMs < 500 || args.waitMs > 30000)) {
      throw Error('waitMs must be an integer between 500 and 30000');
    }
    if (args.waitOnlyLaunchId !== undefined && (typeof args.waitOnlyLaunchId !== 'string' || !SAFE_ID_RE.test(args.waitOnlyLaunchId) || args.waitOnlyLaunchId.length > 80)) {
      throw Error('Invalid waitOnlyLaunchId');
    }
    for (const k of ['preset', 'grid', 'tab']) {
      if (args[k] !== undefined && (typeof args[k] !== 'string' || args[k].length > 120)) throw Error(`Invalid ${k}`);
    }
    validateGridResolutionField(args.gridResolution);
    return toolOperations[name];
  }

  if (name === 'topogen_ui_tabs') {
    validateUiRoutingFields(args);
    if (args.surface !== undefined && !UI_SURFACES.includes(args.surface)) {
      throw Error(`surface must be one of ${UI_SURFACES.join(', ')}`);
    }
    return toolOperations[name];
  }

  if (name === 'topogen_ui_connect') {
    validateUiRoutingFields(args, { allowNullConversation: true });
    if (args.claimFocusedChrome !== undefined && typeof args.claimFocusedChrome !== 'boolean') {
      throw Error('claimFocusedChrome must be a boolean');
    }
    if (args.surface !== undefined && !UI_SURFACES.includes(args.surface)) {
      throw Error(`surface must be one of ${UI_SURFACES.join(', ')}`);
    }
    return toolOperations[name];
  }

  if (name === 'topogen_seal_check') {
    if (args.mode !== undefined && !['A', 'B'].includes(args.mode)) throw Error('mode must be A or B');
    if (args.reseal !== undefined && typeof args.reseal !== 'boolean') throw Error('reseal must be a boolean');
    if (args.skipBench !== undefined && typeof args.skipBench !== 'boolean') throw Error('skipBench must be a boolean');
    return toolOperations[name];
  }

  if (name === 'topogen_list_briefs') {
    if (args.includeContent !== undefined && typeof args.includeContent !== 'boolean') throw Error('includeContent must be a boolean');
    return toolOperations[name];
  }

  if (name === 'topogen_save_brief') {
    if (typeof args.id !== 'string' || !SAFE_ID_RE.test(args.id) || args.id.includes('..')) {
      throw Error('Valid brief id is required');
    }
    if (!isPlainObject(args.brief)) throw Error('brief must be a JSON object');
    return toolOperations[name];
  }

  if (name === 'topogen_quick_eval') {
    if (args.briefId !== undefined && (typeof args.briefId !== 'string' || !SAFE_ID_RE.test(args.briefId))) throw Error('Invalid briefId');
    if (args.briefData !== undefined && !isPlainObject(args.briefData)) throw Error('briefData must be a JSON object');
    for (const k of ['preset', 'grid', 'mode', 'name']) {
      if (args[k] !== undefined && (typeof args[k] !== 'string' || args[k].length > 120)) throw Error(`Invalid ${k}`);
    }
    if (args.writeDir !== undefined && (typeof args.writeDir !== 'string' || args.writeDir.length > 500)) throw Error('Invalid writeDir');
    if (args.seed !== undefined && (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2147483647)) throw Error('Invalid seed');
    if (args.subdiv !== undefined && (!Number.isInteger(args.subdiv) || args.subdiv < 1 || args.subdiv > 64)) throw Error('Invalid subdiv');
    if (args.radius !== undefined && (typeof args.radius !== 'number' || !Number.isFinite(args.radius) || args.radius < 0.001 || args.radius > 5.0)) throw Error('Invalid radius');
    if (args.innerRadius !== undefined && (typeof args.innerRadius !== 'number' || !Number.isFinite(args.innerRadius) || args.innerRadius < 0 || args.innerRadius > 5.0)) throw Error('Invalid innerRadius');
    for (const k of ['pq', 'unroll']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    return toolOperations[name];
  }

  if (name === 'topogen_launch_campaign') {
    if (args.briefId !== undefined && (typeof args.briefId !== 'string' || !SAFE_ID_RE.test(args.briefId))) throw Error('Invalid briefId');
    if (args.briefData !== undefined && !isPlainObject(args.briefData)) throw Error('briefData must be a JSON object');
    if (args.executionMode !== undefined && !['A', 'B'].includes(args.executionMode)) throw Error('executionMode must be A or B');
    if (args.searchProfile !== undefined && !['lightning', 'interactive', 'thorough'].includes(args.searchProfile)) throw Error('Invalid searchProfile');
    if (args.gates !== undefined && (!Array.isArray(args.gates) || args.gates.length > 16 || args.gates.some(g => !Number.isInteger(g) || g < 1 || g > 10))) {
      throw Error('gates must be an array of gate integers (1..10)');
    }
    if (args.concurrency !== undefined && (!Number.isInteger(args.concurrency) || args.concurrency < 1 || args.concurrency > 32)) throw Error('Invalid concurrency');
    if (args.maxRounds !== undefined && (!Number.isInteger(args.maxRounds) || args.maxRounds < 1 || args.maxRounds > 50)) throw Error('Invalid maxRounds');
    if (args.candidatesPerRound !== undefined && (!Number.isInteger(args.candidatesPerRound) || args.candidatesPerRound < 1 || args.candidatesPerRound > 200)) throw Error('Invalid candidatesPerRound');
    if (args.runId !== undefined && (typeof args.runId !== 'string' || !SAFE_ID_RE.test(args.runId) || args.runId.includes('..'))) throw Error('Invalid runId');
    return toolOperations[name];
  }

  if (name === 'topogen_campaign_status') {
    if (args.runId !== undefined && (typeof args.runId !== 'string' || !SAFE_ID_RE.test(args.runId) || args.runId.includes('..'))) throw Error('Invalid runId');
    if (args.waitSeconds !== undefined && (typeof args.waitSeconds !== 'number' || !Number.isFinite(args.waitSeconds) || args.waitSeconds < 0 || args.waitSeconds > 60)) {
      throw Error('waitSeconds must be between 0 and 60');
    }
    return toolOperations[name];
  }

  if (name === 'topogen_nudge_campaign') {
    if (!['finish_round', 'inject_candidate'].includes(args.action)) throw Error('action must be finish_round or inject_candidate');
    if (args.candidate !== undefined && !isPlainObject(args.candidate)) throw Error('candidate must be a JSON object');
    return toolOperations[name];
  }

  if (name === 'topogen_stop_campaign') {
    return toolOperations[name];
  }

  if (name === 'topogen_list_runs') {
    if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) throw Error('limit must be an integer between 1 and 100');
    return toolOperations[name];
  }

  if (name === 'topogen_get_run') {
    if (typeof args.runId !== 'string' || !SAFE_ID_RE.test(args.runId) || args.runId.includes('..')) throw Error('Valid runId required');
    if (args.includeCandidates !== undefined && typeof args.includeCandidates !== 'boolean') throw Error('includeCandidates must be a boolean');
    return toolOperations[name];
  }

  if (name === 'topogen_build_report') {
    if (typeof args.runId !== 'string' || !SAFE_ID_RE.test(args.runId) || args.runId.includes('..')) throw Error('Valid runId required');
    return toolOperations[name];
  }

  if (name === 'topogen_ui_load_file') {
    if (args.target !== undefined && !UI_LOAD_TARGETS.includes(args.target)) {
      throw Error(`target must be one of ${UI_LOAD_TARGETS.join(', ')}`);
    }
    const hasPath = typeof args.filePath === 'string' && args.filePath.trim().length > 0;
    const hasInline = typeof args.content === 'string' || typeof args.contentBase64 === 'string';
    if (!hasPath && !hasInline) throw Error('Provide either filePath or inline content/contentBase64');
    if (hasPath && args.filePath.length > 500) throw Error('filePath too long');
    if (hasInline && (typeof args.fileName !== 'string' || !args.fileName.trim() || args.fileName.length > 200)) {
      throw Error('fileName is required when providing inline content');
    }
    if (args.subDiv !== undefined && (!Number.isInteger(args.subDiv) || args.subDiv < 0 || args.subDiv > 4)) throw Error('subDiv must be an integer between 0 and 4');
    for (const k of ['meshOnly', 'skeletonize', 'fitToVoxel', 'customOnly', 'clearExisting', 'replace', 'discardPending']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    if (args.weldTol !== undefined && (typeof args.weldTol !== 'number' || !Number.isFinite(args.weldTol) || args.weldTol < 0.0001 || args.weldTol > 0.5)) {
      throw Error('Invalid weldTol');
    }
    validateUiRoutingFields(args);
    return toolOperations[name];
  }

  if (name === 'topogen_ui_configure') {
    for (const k of ['preset', 'grid', 'mode', 'fdmMode', 'tab', 'algorithm', 'tubeColorMode', 'goldilocksMode']) {
      if (args[k] !== undefined && (typeof args[k] !== 'string' || args[k].length > 120)) throw Error(`Invalid ${k}`);
    }
    validateGridResolutionField(args.gridResolution);
    if (args.voxelPins !== undefined) {
      if (!Array.isArray(args.voxelPins) || args.voxelPins.length > 512) {
        throw Error('voxelPins must be an array of at most 512 voxel pin entries');
      }
      for (const pin of args.voxelPins) {
        if (!isPlainObject(pin)) throw Error('Each voxelPins entry must be an object');
        for (const k of Object.keys(pin)) {
          if (!['x', 'y', 'z', 'tile'].includes(k)) throw Error(`Unexpected voxelPins field: ${k}`);
        }
        for (const axis of ['x', 'y', 'z']) {
          if (!Number.isInteger(pin[axis]) || pin[axis] < 0 || pin[axis] > 63) {
            throw Error(`voxelPins.${axis} must be an integer between 0 and 63`);
          }
        }
        const validTile = (typeof pin.tile === 'string' && pin.tile.trim().length > 0 && pin.tile.length <= 64)
          || (Number.isInteger(pin.tile) && pin.tile >= -1 && pin.tile <= 1024);
        if (!validTile) {
          throw Error('voxelPins.tile must be a non-empty string (e.g. "null" or tile id) or integer');
        }
      }
    }
    if (args.clearVoxelPins !== undefined && typeof args.clearVoxelPins !== 'boolean') {
      throw Error('clearVoxelPins must be a boolean');
    }
    if (args.camera !== undefined && typeof args.camera !== 'string' && !isPlainObject(args.camera)) {
      throw Error('camera must be a preset string or JSON object');
    }
    if (typeof args.camera === 'string' && args.camera.length > 120) throw Error('Invalid camera');
    if (args.seed !== undefined && (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2147483647)) throw Error('Invalid seed');
    if (args.subdiv !== undefined && (!Number.isInteger(args.subdiv) || args.subdiv < 0 || args.subdiv > 64)) throw Error('Invalid subdiv');
    for (const k of ['subDiv', 'ccLevel']) {
      if (args[k] !== undefined && (!Number.isInteger(args[k]) || args[k] < 0 || args[k] > 4)) throw Error(`${k} must be an integer between 0 and 4`);
    }
    for (const k of ['radius', 'outerRadiusM']) {
      if (args[k] !== undefined && (typeof args[k] !== 'number' || !Number.isFinite(args[k]) || args[k] < 0.001 || args[k] > 5.0)) throw Error(`Invalid ${k}`);
    }
    for (const k of ['innerRadius', 'innerRadiusM']) {
      if (args[k] !== undefined && (typeof args[k] !== 'number' || !Number.isFinite(args[k]) || args[k] < 0 || args[k] > 5.0)) throw Error(`Invalid ${k}`);
    }
    if (args.voxelSize !== undefined && (typeof args.voxelSize !== 'number' || !Number.isFinite(args.voxelSize) || args.voxelSize < 0.01 || args.voxelSize > 100)) {
      throw Error('Invalid voxelSize');
    }
    for (const k of ['unroll', 'arctic', 'skeletonize']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    if (args.pq !== undefined && typeof args.pq !== 'boolean') {
      if (!isPlainObject(args.pq)) throw Error('pq must be a boolean or JSON object');
      for (const k of Object.keys(args.pq)) {
        if (!['selectedLoopId', 'optimization', 'colorMode', 'nSides', 'longitudinalSubdivLevels'].includes(k)) {
          throw Error(`Unexpected pq field: ${k}`);
        }
      }
      if (
        args.pq.selectedLoopId !== undefined &&
        args.pq.selectedLoopId !== null &&
        (!Number.isInteger(args.pq.selectedLoopId) || args.pq.selectedLoopId < 0 || args.pq.selectedLoopId > 10000)
      ) {
        throw Error('pq.selectedLoopId must be null or an integer between 0 and 10000');
      }
      if (args.pq.optimization !== undefined && typeof args.pq.optimization !== 'boolean') {
        throw Error('pq.optimization must be a boolean');
      }
      if (args.pq.colorMode !== undefined && (typeof args.pq.colorMode !== 'string' || args.pq.colorMode.length > 64)) {
        throw Error('Invalid pq.colorMode');
      }
      if (args.pq.nSides !== undefined && (!Number.isInteger(args.pq.nSides) || args.pq.nSides < 3 || args.pq.nSides > 64)) {
        throw Error('pq.nSides must be an integer between 3 and 64');
      }
      if (args.pq.longitudinalSubdivLevels !== undefined && (!Number.isInteger(args.pq.longitudinalSubdivLevels) || args.pq.longitudinalSubdivLevels < 0 || args.pq.longitudinalSubdivLevels > 8)) {
        throw Error('pq.longitudinalSubdivLevels must be an integer between 0 and 8');
      }
    }
    if (args.elastica !== undefined && !isPlainObject(args.elastica)) throw Error('elastica must be a JSON object');
    if (args.fea !== undefined) {
      if (!isPlainObject(args.fea)) throw Error('fea must be a JSON object');
      for (const k of Object.keys(args.fea)) {
        if (!['animate', 'deflectionScale', 'loadCase', 'excludeGraph', 'includeElastica', 'rodMaterial', 'material', 'topLoadKg', 'restraintType'].includes(k)) {
          throw Error(`Unexpected fea field: ${k}`);
        }
      }
      for (const bk of ['animate', 'excludeGraph', 'includeElastica']) {
        if (args.fea[bk] !== undefined && typeof args.fea[bk] !== 'boolean') {
          throw Error(`fea.${bk} must be a boolean`);
        }
      }
      for (const sk of ['rodMaterial', 'material', 'restraintType']) {
        if (args.fea[sk] !== undefined && (typeof args.fea[sk] !== 'string' || args.fea[sk].length > 64)) {
          throw Error(`Invalid fea.${sk}`);
        }
      }
      if (args.fea.topLoadKg !== undefined && (typeof args.fea.topLoadKg !== 'number' || !Number.isFinite(args.fea.topLoadKg) || args.fea.topLoadKg < 0 || args.fea.topLoadKg > 100000)) {
        throw Error('fea.topLoadKg must be a number between 0 and 100000');
      }
      if (args.fea.deflectionScale !== undefined && (typeof args.fea.deflectionScale !== 'number' || !Number.isFinite(args.fea.deflectionScale) || args.fea.deflectionScale < 0 || args.fea.deflectionScale > 1000)) {
        throw Error('fea.deflectionScale must be a number between 0 and 1000');
      }
      if (args.fea.loadCase !== undefined && (typeof args.fea.loadCase !== 'string' || args.fea.loadCase.length > 120)) {
        throw Error('Invalid fea.loadCase');
      }
    }
    if (args.params !== undefined && !isPlainObject(args.params)) throw Error('params must be a JSON object');
    validateUiRoutingFields(args);
    return toolOperations[name];
  }

  if (name === 'topogen_ui_run_step') {
    if (!UI_STEPS.includes(args.step)) {
      throw Error(`step must be one of ${UI_STEPS.join(', ')}`);
    }
    if (args.mode !== undefined && !UI_STEP_MODES.includes(args.mode)) {
      throw Error(`mode must be one of ${UI_STEP_MODES.join(', ')}`);
    }
    if (
      args.loopId !== undefined &&
      args.loopId !== null &&
      (!Number.isInteger(args.loopId) || args.loopId < 0 || args.loopId > 10000)
    ) {
      throw Error('loopId must be null or an integer between 0 and 10000');
    }
    if (args.params !== undefined && !isPlainObject(args.params)) throw Error('params must be a JSON object');
    validateUiRoutingFields(args);
    return toolOperations[name];
  }

  if (name === 'topogen_ui_reload') {
    validateUiRoutingFields(args);
    if (args.surface !== undefined && !UI_SURFACES.includes(args.surface)) {
      throw Error(`surface must be one of ${UI_SURFACES.join(', ')}`);
    }
    for (const k of ['preserveState', 'hardReload']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    if (args.waitMs !== undefined && (!Number.isInteger(args.waitMs) || args.waitMs < 500 || args.waitMs > 30000)) {
      throw Error('waitMs must be an integer between 500 and 30000');
    }
    return toolOperations[name];
  }

  if (name === 'topogen_ui_export') {
    if (!UI_EXPORT_FORMATS.includes(args.format)) {
      throw Error(`format must be one of ${UI_EXPORT_FORMATS.join(', ')}`);
    }
    for (const k of ['download', 'includeData']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    if (args.scale !== undefined && (typeof args.scale !== 'number' || !Number.isFinite(args.scale) || args.scale < 0.1 || args.scale > 1.0)) {
      throw Error('scale must be between 0.1 and 1.0');
    }
    validateUiRoutingFields(args);
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_list') {
    if (args.path !== undefined && (typeof args.path !== 'string' || args.path.length > 500)) throw Error('Bounded directory path required');
    if (args.recursive !== undefined && typeof args.recursive !== 'boolean') throw Error('recursive must be a boolean');
    if (args.maxEntries !== undefined && (!Number.isInteger(args.maxEntries) || args.maxEntries < 1 || args.maxEntries > 200)) throw Error('maxEntries must be an integer between 1 and 200');
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_read') {
    if (typeof args.path !== 'string' || !args.path.trim() || args.path.length > 500) throw Error('Bounded file path required');
    if (args.startLine !== undefined && (!Number.isInteger(args.startLine) || args.startLine < 1 || args.startLine > 100000)) throw Error('startLine must be a positive integer');
    if (args.endLine !== undefined && (!Number.isInteger(args.endLine) || args.endLine < 1 || args.endLine > 100000)) throw Error('endLine must be a positive integer');
    if (args.startLine !== undefined && args.endLine !== undefined && args.endLine < args.startLine) throw Error('endLine must be >= startLine');
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_read_batch') {
    if (!Array.isArray(args.files) || args.files.length < 1 || args.files.length > 12) {
      throw Error('files must be an array of 1..12 file descriptors');
    }
    for (const item of args.files) {
      if (!isPlainObject(item)) throw Error('Each files entry must be an object');
      for (const k of Object.keys(item)) {
        if (!['path', 'startLine', 'endLine'].includes(k)) throw Error(`Unexpected files entry field: ${k}`);
      }
      if (typeof item.path !== 'string' || !item.path.trim() || item.path.length > 500) {
        throw Error('Bounded file path required in files entry');
      }
      if (item.startLine !== undefined && (!Number.isInteger(item.startLine) || item.startLine < 1 || item.startLine > 100000)) {
        throw Error('startLine must be a positive integer');
      }
      if (item.endLine !== undefined && (!Number.isInteger(item.endLine) || item.endLine < 1 || item.endLine > 100000)) {
        throw Error('endLine must be a positive integer');
      }
      if (item.startLine !== undefined && item.endLine !== undefined && item.endLine < item.startLine) {
        throw Error('endLine must be >= startLine');
      }
    }
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_search') {
    const hasQuery = args.query !== undefined;
    const hasQueries = args.queries !== undefined;
    if (!hasQuery && !hasQueries) throw Error('Provide either query or queries (1..8)');
    if (hasQuery && (typeof args.query !== 'string' || !args.query.length || args.query.length > 500)) {
      throw Error('Bounded search query required');
    }
    if (hasQueries) {
      if (!Array.isArray(args.queries) || args.queries.length < 1 || args.queries.length > 8) {
        throw Error('queries must be an array of 1..8 non-empty strings');
      }
      for (const q of args.queries) {
        if (typeof q !== 'string' || !q.length || q.length > 500) {
          throw Error('Each entry in queries must be a bounded non-empty string');
        }
      }
    }
    for (const k of ['include', 'exclude']) {
      if (args[k] !== undefined) {
        if (typeof args[k] === 'string') {
          if (args[k].length > 200) throw Error(`${k} glob too long`);
        } else if (Array.isArray(args[k])) {
          if (args[k].length > 16 || args[k].some(g => typeof g !== 'string' || g.length > 200)) {
            throw Error(`${k} must be a string or array of up to 16 bounded glob strings`);
          }
        } else {
          throw Error(`${k} must be a string or array of glob strings`);
        }
      }
    }
    if (args.path !== undefined && (typeof args.path !== 'string' || args.path.length > 500)) throw Error('Bounded search path required');
    if (args.regex !== undefined && typeof args.regex !== 'boolean') throw Error('regex must be a boolean');
    if (args.caseSensitive !== undefined && typeof args.caseSensitive !== 'boolean') throw Error('caseSensitive must be a boolean');
    if (args.maxMatches !== undefined && (!Number.isInteger(args.maxMatches) || args.maxMatches < 1 || args.maxMatches > 200)) throw Error('maxMatches must be an integer between 1 and 200');
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_edit') {
    const validateSingleEdit = (spec) => {
      if (typeof spec.path !== 'string' || !spec.path.trim() || spec.path.length > 500) {
        throw Error('Bounded file path required');
      }
      const hasTarget = spec.target !== undefined;
      const hasContent = spec.content !== undefined;
      if (hasTarget === hasContent) throw Error('Provide either target+replacement or content');
      if (hasTarget && (typeof spec.target !== 'string' || !spec.target.length || spec.target.length > 131072 || typeof spec.replacement !== 'string' || spec.replacement.length > 131072)) {
        throw Error('Bounded target and replacement strings required');
      }
      if (hasContent && (typeof spec.content !== 'string' || spec.content.length > 262144)) {
        throw Error('Bounded file content string required');
      }
      if (spec.replaceAll !== undefined && typeof spec.replaceAll !== 'boolean') {
        throw Error('replaceAll must be a boolean');
      }
    };

    if (args.edits !== undefined) {
      if (args.path !== undefined || args.target !== undefined || args.replacement !== undefined || args.content !== undefined) {
        throw Error('Provide either edits array or single-file path/target/content arguments, not both');
      }
      if (!Array.isArray(args.edits) || args.edits.length < 1 || args.edits.length > 20) {
        throw Error('edits must be an array of 1..20 edit operations');
      }
      for (const spec of args.edits) {
        if (!isPlainObject(spec)) throw Error('Each edits entry must be an object');
        for (const k of Object.keys(spec)) {
          if (!['path', 'target', 'replacement', 'content', 'replaceAll'].includes(k)) {
            throw Error(`Unexpected edits entry field: ${k}`);
          }
        }
        validateSingleEdit(spec);
      }
      return toolOperations[name];
    }

    validateSingleEdit(args);
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_run_command') {
    if (typeof args.command !== 'string' || !args.command.trim() || args.command.length > 200) throw Error('Bounded command string required');
    if (args.args !== undefined && (!Array.isArray(args.args) || args.args.length > 64 || args.args.some(a => typeof a !== 'string' || a.length > 1000))) {
      throw Error('args must be an array of up to 64 bounded strings');
    }
    if (args.cwd !== undefined && (typeof args.cwd !== 'string' || args.cwd.length > 500)) throw Error('Bounded cwd path required');
    if (args.timeoutMs !== undefined && (!Number.isInteger(args.timeoutMs) || args.timeoutMs < 1000 || args.timeoutMs > 120000)) {
      throw Error('timeoutMs must be an integer between 1000 and 120000');
    }
    return toolOperations[name];
  }

  return toolOperations[name];
}

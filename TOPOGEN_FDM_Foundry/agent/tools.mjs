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

  // ── Mode A Live 3D Workbench UI Bridge ──────────────────────────────────────
  {
    name: 'topogen_ui_inspect',
    description: 'Read live state from the open TOPOGEN 3D Workbench browser tab (active tab, grid resolution, preset, FDM mode, node/edge/quad counts, planarity error, FEA preview summary).',
    inputSchema: schema({ verbose: { type: 'boolean' } }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_configure',
    description: 'Configure parameters on the live TOPOGEN 3D Workbench tab (preset, grid, seed, FDM mode, tube radii, PQ subdivision, camera preset, active tab, or params object).',
    inputSchema: schema({
      preset: { type: 'string', maxLength: 120 },
      grid: { type: 'string', maxLength: 32 },
      seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
      mode: { type: 'string', maxLength: 64 },
      radius: { type: 'number', minimum: 0.001, maximum: 5.0 },
      innerRadius: { type: 'number', minimum: 0, maximum: 5.0 },
      subdiv: { type: 'integer', minimum: 1, maximum: 64 },
      pq: { type: 'boolean' },
      unroll: { type: 'boolean' },
      camera: { type: 'string', maxLength: 64 },
      tab: { type: 'string', maxLength: 64 },
      params: { type: 'object' }
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_run_step',
    description: 'Trigger a live computation step in the open TOPOGEN 3D Workbench browser tab (wfc, fdm, solidify, pq, elastica, fea, or all).',
    inputSchema: {
      ...schema({
        step: { type: 'string', enum: ['wfc', 'fdm', 'solidify', 'pq', 'elastica', 'fea', 'all'] },
        params: { type: 'object' }
      }),
      required: ['step']
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_ui_export',
    description: 'Export current geometry artifacts from the live TOPOGEN 3D Workbench browser tab (topology, obj, svg, or all).',
    inputSchema: {
      ...schema({
        format: { type: 'string', enum: ['topology', 'obj', 'svg', 'all'] }
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
    name: 'topogen_workspace_search',
    description: 'Search text or regex matches across files inside the project workspace or session scratch directory. Skips binary and credential files.',
    inputSchema: {
      ...schema({
        query: { type: 'string', maxLength: 500 },
        path: { type: 'string', maxLength: 500 },
        regex: { type: 'boolean' },
        caseSensitive: { type: 'boolean' },
        maxMatches: { type: 'integer', minimum: 1, maximum: 100 }
      }),
      required: ['query']
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
  },
  {
    name: 'topogen_workspace_edit',
    description: 'Apply a surgical target->replacement edit or write a bounded file inside the Mode B project workspace or scratch directory. Strictly requires allowModeB=true. Refuses path traversal, symlinks, .git internals, and credential files.',
    inputSchema: {
      ...schema({
        path: { type: 'string', maxLength: 500 },
        target: { type: 'string', maxLength: 131072 },
        replacement: { type: 'string', maxLength: 131072 },
        content: { type: 'string', maxLength: 262144 },
        replaceAll: { type: 'boolean' }
      }),
      required: ['path']
    },
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
  topogen_ui_inspect: 'ui.inspect',
  topogen_ui_configure: 'ui.configure',
  topogen_ui_run_step: 'ui.run_step',
  topogen_ui_export: 'ui.export',
  topogen_workspace_list: 'workspace.list',
  topogen_workspace_read: 'workspace.read',
  topogen_workspace_search: 'workspace.search',
  topogen_workspace_edit: 'workspace.edit',
  topogen_workspace_run_command: 'workspace.run_command'
});

const SAFE_ID_RE = /^[a-zA-Z0-9._-]{1,120}$/;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
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

  if (name === 'topogen_ui_configure') {
    for (const k of ['preset', 'grid', 'mode', 'camera', 'tab']) {
      if (args[k] !== undefined && (typeof args[k] !== 'string' || args[k].length > 120)) throw Error(`Invalid ${k}`);
    }
    if (args.seed !== undefined && (!Number.isInteger(args.seed) || args.seed < 0 || args.seed > 2147483647)) throw Error('Invalid seed');
    if (args.subdiv !== undefined && (!Number.isInteger(args.subdiv) || args.subdiv < 1 || args.subdiv > 64)) throw Error('Invalid subdiv');
    if (args.radius !== undefined && (typeof args.radius !== 'number' || !Number.isFinite(args.radius) || args.radius < 0.001 || args.radius > 5.0)) throw Error('Invalid radius');
    if (args.innerRadius !== undefined && (typeof args.innerRadius !== 'number' || !Number.isFinite(args.innerRadius) || args.innerRadius < 0 || args.innerRadius > 5.0)) throw Error('Invalid innerRadius');
    for (const k of ['pq', 'unroll']) {
      if (args[k] !== undefined && typeof args[k] !== 'boolean') throw Error(`${k} must be a boolean`);
    }
    if (args.params !== undefined && !isPlainObject(args.params)) throw Error('params must be a JSON object');
    return toolOperations[name];
  }

  if (name === 'topogen_ui_run_step') {
    if (!['wfc', 'fdm', 'solidify', 'pq', 'elastica', 'fea', 'all'].includes(args.step)) {
      throw Error('step must be one of wfc, fdm, solidify, pq, elastica, fea, all');
    }
    if (args.params !== undefined && !isPlainObject(args.params)) throw Error('params must be a JSON object');
    return toolOperations[name];
  }

  if (name === 'topogen_ui_export') {
    if (!['topology', 'obj', 'svg', 'all'].includes(args.format)) {
      throw Error('format must be one of topology, obj, svg, all');
    }
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

  if (name === 'topogen_workspace_search') {
    if (typeof args.query !== 'string' || !args.query.length || args.query.length > 500) throw Error('Bounded search query required');
    if (args.path !== undefined && (typeof args.path !== 'string' || args.path.length > 500)) throw Error('Bounded search path required');
    if (args.regex !== undefined && typeof args.regex !== 'boolean') throw Error('regex must be a boolean');
    if (args.caseSensitive !== undefined && typeof args.caseSensitive !== 'boolean') throw Error('caseSensitive must be a boolean');
    if (args.maxMatches !== undefined && (!Number.isInteger(args.maxMatches) || args.maxMatches < 1 || args.maxMatches > 100)) throw Error('maxMatches must be an integer between 1 and 100');
    return toolOperations[name];
  }

  if (name === 'topogen_workspace_edit') {
    if (typeof args.path !== 'string' || !args.path.trim() || args.path.length > 500) throw Error('Bounded file path required');
    const hasTarget = args.target !== undefined;
    const hasContent = args.content !== undefined;
    if (hasTarget === hasContent) throw Error('Provide either target+replacement or content');
    if (hasTarget && (typeof args.target !== 'string' || !args.target.length || args.target.length > 131072 || typeof args.replacement !== 'string' || args.replacement.length > 131072)) {
      throw Error('Bounded target and replacement strings required');
    }
    if (hasContent && (typeof args.content !== 'string' || args.content.length > 262144)) {
      throw Error('Bounded file content string required');
    }
    if (args.replaceAll !== undefined && typeof args.replaceAll !== 'boolean') throw Error('replaceAll must be a boolean');
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

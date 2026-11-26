/**
 * TOPOGEN FDM Foundry — Single-Source 4-Layer UI Action Contract
 *
 * Canonical frozen enums shared across:
 *   1. MCP Tool Schema & Validator (`agent/tools.mjs`)
 *   2. Bridge Server Dispatcher (`agent/ui-bridge.mjs` & `foundry_server.mjs`)
 *   3. Browser Bridge Client (`ui/bridge/mcp_ui_bridge.js`)
 *   4. Unified Foundry CLI (`cli/topogen.mjs`)
 *
 * Strict Air-Gap: pure constants only; zero imports from `core/` or `verifier/`.
 */

export const UI_ACTIONS = Object.freeze([
  'inspect',
  'load_file',
  'configure',
  'run_step',
  'export',
  'reload',
  'ping',
]);

export const UI_MUTATING_ACTIONS = Object.freeze([
  'configure',
  'run_step',
  'load_file',
  'export',
  'reload',
]);

export const UI_SURFACES = Object.freeze([
  'workbench',
  'launcher',
]);

export const UI_STEPS = Object.freeze([
  'wfc',
  'collapse_all',
  'reset_topo',
  'fdm',
  'reset_fdm',
  'solidify',
  'pq',
  'longitudinal_subdiv',
  'ring_subdiv',
  'swap_long_ring',
  'select_pq_loop',
  'pq_optimize',
  'unroll',
  'elastica',
  'elastica_trace',
  'elastica_reset',
  'elastica_unroll',
  'fea',
  'fea_animate',
  'zoom_fit',
  'reload',
  'all',
]);

export const UI_STEP_MODES = Object.freeze([
  'start',
  'stop',
  'toggle',
]);

export const UI_LOAD_TARGETS = Object.freeze([
  'tile',
  'mesh_tile',
  'network',
]);

export const UI_EXPORT_FORMATS = Object.freeze([
  'topology',
  'topology_json',
  'json',
  'obj',
  'svg',
  'unroll_svg',
  'elastica_svg',
  'snapshot',
  'all',
]);

export const UI_CONFIG_SECTIONS = Object.freeze([
  'preset',
  'grid',
  'gridResolution',
  'voxelPins',
  'clearVoxelPins',
  'seed',
  'mode',
  'fdmMode',
  'radius',
  'outerRadiusM',
  'innerRadius',
  'innerRadiusM',
  'voxelSize',
  'subdiv',
  'subDiv',
  'ccLevel',
  'skeletonize',
  'algorithm',
  'tubeColorMode',
  'goldilocksMode',
  'arctic',
  'pq',
  'unroll',
  'camera',
  'tab',
  'elastica',
  'fea',
  'params',
]);

export const UI_ACTIONS_SET = Object.freeze(new Set(UI_ACTIONS));
export const UI_MUTATING_ACTIONS_SET = Object.freeze(new Set(UI_MUTATING_ACTIONS));
export const UI_SURFACES_SET = Object.freeze(new Set(UI_SURFACES));
export const UI_STEPS_SET = Object.freeze(new Set(UI_STEPS));
export const UI_STEP_MODES_SET = Object.freeze(new Set(UI_STEP_MODES));
export const UI_LOAD_TARGETS_SET = Object.freeze(new Set(UI_LOAD_TARGETS));
export const UI_EXPORT_FORMATS_SET = Object.freeze(new Set(UI_EXPORT_FORMATS));
export const UI_CONFIG_SECTIONS_SET = Object.freeze(new Set(UI_CONFIG_SECTIONS));

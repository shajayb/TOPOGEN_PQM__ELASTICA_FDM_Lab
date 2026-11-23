import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync('WFC_FDM_Foundry/index_WFC.html', 'utf8');
const code = html.match(/<script\s+id=["']wfc-fdm-core["'][^>]*>([\s\S]*?)<\/script>/i)[1];
const sb = { console, Math, Date, Number, String, Boolean, Array, Object, Set, Map, Int32Array, Uint8Array, Uint32Array, Float32Array, Float64Array, JSON, isNaN, isFinite, parseFloat, parseInt };
sb.globalThis = sb;
vm.runInNewContext(code, sb);
const core = sb.WFC_FDM_CORE;

for (const name of ['diag_test', 'sd_solid14']) {
    const topo = JSON.parse(fs.readFileSync(`WFC_FDM_Foundry/runs/opt_lab/${name}.topology.json`, 'utf8'));
    const nodes = topo.vertices.map((p, id) => ({ id, pt: new core.V3(p[0], p[1], p[2]) }));
    const edges = topo.edges.map((e, id) => ({ id, u: e[0], v: e[1], visible: true }));
    const adj = nodes.map(() => []);
    for (const e of edges) { adj[e.u].push(e.id); adj[e.v].push(e.id); }
    const sBisect = core.solidifyGraphBisectorStitched(8, topo.section.outerRadiusM, nodes, edges, edges, adj, { capLeafEnds: true });
    const sHull = core.solidifyGraph(topo.vertices, topo.edges, { nSides: 8, radius: topo.section.outerRadiusM, stitchAtBisectors: false });
    console.log(name, 'V=', topo.vertices.length, 'E=', topo.edges.length, 'maxVal=', Math.max(...adj.map(a => a.length)));
    console.log('  bisect:', sBisect.verification);
    console.log('  hull:  ', sHull.verification);
}

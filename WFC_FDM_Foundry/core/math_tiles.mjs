/**
 * WFC-FDM Foundry — Core Module 1: 3D Vector Math, PRNG, Linear Solver & Tile Catalog
 *
 * Pure JavaScript ES Module (zero DOM / Three.js / Verifier dependencies).
 * Runs identically in Browser (<script type="module">) and Node.js CLI / Workers.
 *
 * Student Quick-Map:
 *   - Edit tile geometry, socket codes, or add new 3D tiles -> createTileTemplates()
 *   - Edit named tile presets or default radii/boosts       -> TILE_PRESETS
 *   - Edit socket compatibility rules                       -> buildAdjacencyRules()
 *
 * Inputs:  Seed numbers, preset names, tile template arrays, dense linear matrices (A, B)
 * Outputs: V3 vectors, deterministic PRNG, 15 structural tile definitions, adjacency matrices
 */

// --- Lightweight Pure-JS 3D Vector (100% compatible with THREE.Vector3) ---
class V3 {
    constructor(x = 0, y = 0, z = 0) {
        this.x = x; this.y = y; this.z = z;
    }
    clone() { return new V3(this.x, this.y, this.z); }
    copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
    set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
    addVectors(a, b) { this.x = a.x + b.x; this.y = a.y + b.y; this.z = a.z + b.z; return this; }
    subVectors(a, b) { this.x = a.x - b.x; this.y = a.y - b.y; this.z = a.z - b.z; return this; }
    addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
    multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
    divideScalar(s) {
        if (Math.abs(s) > 1e-18) { this.x /= s; this.y /= s; this.z /= s; }
        else { this.x = 0; this.y = 0; this.z = 0; }
        return this;
    }
    negate() { this.x = -this.x; this.y = -this.y; this.z = -this.z; return this; }
    dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
    crossVectors(a, b) {
        const ax = a.x, ay = a.y, az = a.z;
        const bx = b.x, by = b.y, bz = b.z;
        this.x = ay * bz - az * by;
        this.y = az * bx - ax * bz;
        this.z = ax * by - ay * bx;
        return this;
    }
    lengthSq() { return this.x * this.x + this.y * this.y + this.z * this.z; }
    length() { return Math.sqrt(this.lengthSq()); }
    normalize() {
        const l = this.length();
        if (l > 1e-12) { this.x /= l; this.y /= l; this.z /= l; }
        return this;
    }
    distanceToSquared(v) {
        const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
        return dx * dx + dy * dy + dz * dz;
    }
    distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
    toArray() { return [this.x, this.y, this.z]; }
}

const toV3 = (p) => (p && p.x !== undefined) ? new V3(p.x, p.y, p.z) : new V3(p[0], p[1], p[2]);
const toArr3 = (p) => (p && p.x !== undefined) ? [p.x, p.y, p.z] : [p[0], p[1], p[2]];

// --- Deterministic Seeded PRNG (Mulberry32) ---
function mulberry32(seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// --- 6 Cardinal Directions (Z-up) ---
const DIRS = [
    { dx:  1, dy:  0, dz:  0, opp: 1, axis: 0, sign:  1, name: '+X' },
    { dx: -1, dy:  0, dz:  0, opp: 0, axis: 0, sign: -1, name: '-X' },
    { dx:  0, dy:  1, dz:  0, opp: 3, axis: 1, sign:  1, name: '+Y' },
    { dx:  0, dy: -1, dz:  0, opp: 2, axis: 1, sign: -1, name: '-Y' },
    { dx:  0, dy:  0, dz:  1, opp: 5, axis: 2, sign:  1, name: '+Z' },
    { dx:  0, dy:  0, dz: -1, opp: 4, axis: 2, sign: -1, name: '-Z' }
];

const TILE_NULL        = 0;
const TILE_CROSS       = 1;
const TILE_VTUBE       = 2;
const TILE_HTUBE       = 3;
const TILE_HTUBE_Y     = 4;
const TILE_XBRACE_XZ   = 5;
const TILE_XBRACE_YZ   = 6;
const TILE_DIAG_PYR    = 7;
const TILE_ARCH_VAULT  = 8;
const TILE_TRIPOD_LEG  = 9;
const TILE_DIAPHRAGM   = 10;
const TILE_FUNICULAR_VAULT   = 11;
const TILE_SLENDER_DIAGRID   = 12;
const TILE_HYPERBOLOID       = 13;
const TILE_CATENARY_QUADRIPOD = 14;

function buildBoxArmQuads(x0, x1, y0, y1, z0, z1, openFaces = {}) {
    const v = [
        [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
        [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]
    ];
    const quads = [];
    if (!openFaces.px) quads.push([v[1], v[2], v[6], v[5]]);
    if (!openFaces.nx) quads.push([v[3], v[0], v[4], v[7]]);
    if (!openFaces.py) quads.push([v[2], v[3], v[7], v[6]]);
    if (!openFaces.ny) quads.push([v[0], v[1], v[5], v[4]]);
    if (!openFaces.pz) quads.push([v[4], v[5], v[6], v[7]]);
    if (!openFaces.nz) quads.push([v[3], v[2], v[1], v[0]]);
    return quads;
}

// Build simple prism strut quads along an arbitrary segment [p0, p1] for browser visualization
function buildStrutQuads(p0, p1, halfW = 0.08) {
    const a = new V3(p0[0], p0[1], p0[2]);
    const b = new V3(p1[0], p1[1], p1[2]);
    const d = new V3().subVectors(b, a);
    if (d.length() < 1e-6) return [];
    d.normalize();
    const tmp = Math.abs(d.x) > 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0);
    const u = new V3().crossVectors(d, tmp).normalize().multiplyScalar(halfW);
    const w = new V3().crossVectors(d, u).normalize().multiplyScalar(halfW);
    const r0 = [
        a.clone().add(u).add(w).toArray(),
        a.clone().sub(u).add(w).toArray(),
        a.clone().sub(u).sub(w).toArray(),
        a.clone().add(u).sub(w).toArray()
    ];
    const r1 = [
        b.clone().add(u).add(w).toArray(),
        b.clone().sub(u).add(w).toArray(),
        b.clone().sub(u).sub(w).toArray(),
        b.clone().add(u).sub(w).toArray()
    ];
    return [
        [r0[0], r0[1], r1[1], r1[0]],
        [r0[1], r0[2], r1[2], r1[1]],
        [r0[2], r0[3], r1[3], r1[2]],
        [r0[3], r0[0], r1[0], r1[3]]
    ];
}

function buildQuadsFromGraph(graph, halfW = 0.08) {
    const quads = [];
    for (let i = 0; i < graph.edges.length; i++) {
        const [u, v] = graph.edges[i];
        const sq = buildStrutQuads(graph.vertices[u], graph.vertices[v], halfW);
        for (let k = 0; k < sq.length; k++) quads.push(sq[k]);
    }
    return quads;
}

function createTileTemplates() {
    const r = 0.22;
    const h = 0.50;

    const crossQuads = [
        ...buildBoxArmQuads( r,  h, -r,  r, -r,  r, { nx: true, px: true }),
        ...buildBoxArmQuads(-h, -r, -r,  r, -r,  r, { px: true, nx: true }),
        ...buildBoxArmQuads(-r,  r,  r,  h, -r,  r, { ny: true, py: true }),
        ...buildBoxArmQuads(-r,  r, -h, -r, -r,  r, { py: true, ny: true }),
        ...buildBoxArmQuads(-r,  r, -r,  r,  r,  h, { nz: true, pz: true }),
        ...buildBoxArmQuads(-r,  r, -r,  r, -h, -r, { pz: true, nz: true })
    ];
    const vTubeQuads = [
        ...buildBoxArmQuads(-r,  r, -r,  r, -h,  0, { pz: true, nz: true }),
        ...buildBoxArmQuads(-r,  r, -r,  r,  0,  h, { pz: true, nz: true })
    ];
    const hTubeQuads = [
        ...buildBoxArmQuads(-h,  0, -r,  r, -r,  r, { px: true, nx: true }),
        ...buildBoxArmQuads( 0,  h, -r,  r, -r,  r, { px: true, nx: true })
    ];
    const hTubeYQuads = [
        ...buildBoxArmQuads(-r,  r, -h,  0, -r,  r, { py: true, ny: true }),
        ...buildBoxArmQuads(-r,  r,  0,  h, -r,  r, { py: true, ny: true })
    ];

    // 5. X-Brace XZ (triangulated diamond + orthogonal chords in XZ plane)
    const xBraceXZGraph = {
        vertices: [
            [0, 0, 0],     // 0: center
            [ h, 0, 0],    // 1: +X
            [-h, 0, 0],    // 2: -X
            [0, 0,  h],    // 3: +Z
            [0, 0, -h]     // 4: -Z
        ],
        edges: [
            [0, 1], [0, 2], [0, 3], [0, 4],
            [1, 3], [1, 4], [2, 3], [2, 4]
        ]
    };

    // 6. X-Brace YZ (triangulated diamond + orthogonal chords in YZ plane)
    const xBraceYZGraph = {
        vertices: [
            [0, 0, 0],     // 0: center
            [0,  h, 0],    // 1: +Y
            [0, -h, 0],    // 2: -Y
            [0, 0,  h],    // 3: +Z
            [0, 0, -h]     // 4: -Z
        ],
        edges: [
            [0, 1], [0, 2], [0, 3], [0, 4],
            [1, 3], [1, 4], [2, 3], [2, 4]
        ]
    };

    // 7. Octahedral / Pyramidal 3D Diagrid Cell (pure 3D triangulated octahedron between all 6 face centers)
    const diagPyrGraph = {
        vertices: [
            [ h, 0, 0],    // 0: +X
            [-h, 0, 0],    // 1: -X
            [0,  h, 0],    // 2: +Y
            [0, -h, 0],    // 3: -Y
            [0, 0,  h],    // 4: +Z
            [0, 0, -h]     // 5: -Z
        ],
        edges: [
            [0, 2], [2, 1], [1, 3], [3, 0], // XY equatorial ring
            [4, 0], [4, 1], [4, 2], [4, 3], // upper pyramid to +Z
            [5, 0], [5, 1], [5, 2], [5, 3]  // lower pyramid to -Z
        ]
    };

    // 8. Arch-Vaulted Braced Hub (octahedron + vertical spine + XY cross)
    const archVaultGraph = {
        vertices: [
            [0, 0, 0],     // 0: center
            [ h, 0, 0],    // 1: +X
            [-h, 0, 0],    // 2: -X
            [0,  h, 0],    // 3: +Y
            [0, -h, 0],    // 4: -Y
            [0, 0,  h],    // 5: +Z
            [0, 0, -h]     // 6: -Z
        ],
        edges: [
            [0, 5], [0, 6],                 // vertical spine
            [6, 1], [6, 2], [6, 3], [6, 4], // upward arch ribs from -Z
            [5, 1], [5, 2], [5, 3], [5, 4], // converging vault ribs to +Z
            [1, 3], [3, 2], [2, 4], [4, 1]  // horizontal collar ring
        ]
    };

    // 9. Funneling Tripod / Splayed Leg (connects -Z to +Z via center & splayed lateral braces)
    const tripodLegGraph = {
        vertices: [
            [0, 0, 0],     // 0: center
            [ h, 0, 0],    // 1: +X
            [-h, 0, 0],    // 2: -X
            [0,  h, 0],    // 3: +Y
            [0, -h, 0],    // 4: -Y
            [0, 0,  h],    // 5: +Z
            [0, 0, -h]     // 6: -Z
        ],
        edges: [
            [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
            [6, 1], [6, 2], [6, 3], [6, 4]
        ]
    };

    // 10. Horizontal XY Diaphragm (ring + cross in XY)
    const diaphragmGraph = {
        vertices: [
            [0, 0, 0],     // 0: center
            [ h, 0, 0],    // 1: +X
            [-h, 0, 0],    // 2: -X
            [0,  h, 0],    // 3: +Y
            [0, -h, 0]     // 4: -Y
        ],
        edges: [
            [0, 1], [0, 2], [0, 3], [0, 4],
            [1, 3], [3, 2], [2, 4], [4, 1]
        ]
    };

    // 11. Funicular Vault Cell (corner-welded groin vault ribs + crown ties)
    const funicularVaultGraph = {
        vertices: [
            [-h, -h, -h], [ h, -h, -h], [ h,  h, -h], [-h,  h, -h], // 0..3: bottom corners
            [-h, -h,  h], [ h, -h,  h], [ h,  h,  h], [-h,  h,  h], // 4..7: top corners
            [ 0,  0,  h]                                             // 8: crown apex
        ],
        edges: [
            [0, 4], [1, 5], [2, 6], [3, 7], // 4 corner legs
            [0, 8], [1, 8], [2, 8], [3, 8], // 4 funicular groin ribs
            [4, 8], [5, 8], [6, 8], [7, 8], // 4 crown spandrel ties
            [4, 5], [5, 6], [6, 7], [7, 4]  // top collar ring
        ]
    };

    // 12. Slender Diagrid Cell (pure 8-edge face-centered diamond, zero redundant bars)
    const slenderDiagridGraph = {
        vertices: [
            [ h, 0, 0],    // 0: +X
            [-h, 0, 0],    // 1: -X
            [0,  h, 0],    // 2: +Y
            [0, -h, 0],    // 3: -Y
            [0, 0,  h],    // 4: +Z
            [0, 0, -h]     // 5: -Z
        ],
        edges: [
            [5, 0], [5, 1], [5, 2], [5, 3], // lower diverging ribs
            [4, 0], [4, 1], [4, 2], [4, 3]  // upper converging ribs
        ]
    };

    // 13. Hyperboloid Tower Cell (Shukhov-inspired counter-rotating helical lattice, corner-welded)
    const hyperboloidGraph = {
        vertices: [
            [-h, -h, -h], [ h, -h, -h], [ h,  h, -h], [-h,  h, -h], // 0..3: bottom corners
            [-h, -h,  h], [ h, -h,  h], [ h,  h,  h], [-h,  h,  h]  // 4..7: top corners
        ],
        edges: [
            [0, 5], [1, 6], [2, 7], [3, 4], // CW helical diagonals
            [0, 7], [3, 6], [2, 5], [1, 4], // CCW helical diagonals
            [4, 5], [5, 6], [6, 7], [7, 4]  // top collar ring
        ]
    };

    // 14. Catenary Quadripod Cell (ultra-lean 4-leg triangulated compression tower, corner-welded)
    const catenaryQuadripodGraph = {
        vertices: [
            [-h, -h, -h], [ h, -h, -h], [ h,  h, -h], [-h,  h, -h], // 0..3: bottom corners
            [-h, -h,  h], [ h, -h,  h], [ h,  h,  h], [-h,  h,  h]  // 4..7: top corners
        ],
        edges: [
            [0, 4], [1, 5], [2, 6], [3, 7], // 4 primary compression legs
            [0, 5], [1, 6], [2, 7], [3, 4], // 4 triangulating shear diagonals
            [4, 5], [5, 6], [6, 7], [7, 4]  // 4 horizontal collar ties
        ]
    };

    return [
        {
            id: TILE_NULL, key: 'null', name: 'Null (Empty)', short: 'NUL',
            color: [0.55, 0.58, 0.62], hex: '#6b7280', enabled: true, weight: 1.4,
            sockets: [0, 0, 0, 0, 0, 0], quads: [],
            graph: { vertices: [], edges: [] }
        },
        {
            id: TILE_CROSS, key: 'cross', name: 'Cross (6-Way)', short: 'CRS',
            color: [0.93, 0.28, 0.60], hex: '#ec4899', enabled: true, weight: 1.0,
            sockets: [1, 1, 1, 1, 1, 1], quads: crossQuads,
            graph: {
                vertices: [[0,0,0],[h,0,0],[-h,0,0],[0,h,0],[0,-h,0],[0,0,h],[0,0,-h]],
                edges: [[0,1],[0,2],[0,3],[0,4],[0,5],[0,6]]
            }
        },
        {
            id: TILE_VTUBE, key: 'vtube', name: 'Vertical Tube', short: 'VTB',
            color: [0.22, 0.74, 0.97], hex: '#38bdf8', enabled: true, weight: 1.2,
            sockets: [0, 0, 0, 0, 1, 1], quads: vTubeQuads,
            graph: { vertices: [[0,0,-h],[0,0,h]], edges: [[0,1]] }
        },
        {
            id: TILE_HTUBE, key: 'htube', name: 'Horizontal Tube X', short: 'HTX',
            color: [0.92, 0.93, 0.95], hex: '#e5e7eb', enabled: true, weight: 1.2,
            sockets: [1, 1, 0, 0, 0, 0], quads: hTubeQuads,
            graph: { vertices: [[-h,0,0],[h,0,0]], edges: [[0,1]] }
        },
        {
            id: TILE_HTUBE_Y, key: 'htube_y', name: 'Horizontal Tube Y', short: 'HTY',
            color: [0.80, 0.84, 0.90], hex: '#cbd5e1', enabled: false, weight: 1.2,
            sockets: [0, 0, 1, 1, 0, 0], quads: hTubeYQuads,
            graph: { vertices: [[0,-h,0],[0,h,0]], edges: [[0,1]] }
        },
        {
            id: TILE_XBRACE_XZ, key: 'xbrace_xz', name: 'X-Brace (XZ)', short: 'XBZ',
            color: [0.96, 0.62, 0.04], hex: '#f59e0b', enabled: false, weight: 1.5,
            sockets: [1, 1, 0, 0, 1, 1], quads: buildQuadsFromGraph(xBraceXZGraph, 0.07),
            graph: xBraceXZGraph
        },
        {
            id: TILE_XBRACE_YZ, key: 'xbrace_yz', name: 'X-Brace (YZ)', short: 'YBZ',
            color: [0.92, 0.70, 0.03], hex: '#eab308', enabled: false, weight: 1.5,
            sockets: [0, 0, 1, 1, 1, 1], quads: buildQuadsFromGraph(xBraceYZGraph, 0.07),
            graph: xBraceYZGraph
        },
        {
            id: TILE_DIAG_PYR, key: 'diag_pyramid', name: 'Diagrid Octa', short: 'OCT',
            color: [0.06, 0.72, 0.51], hex: '#10b981', enabled: false, weight: 1.8,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(diagPyrGraph, 0.07),
            graph: diagPyrGraph
        },
        {
            id: TILE_ARCH_VAULT, key: 'arch_vault', name: 'Arch Vault', short: 'ARC',
            color: [0.55, 0.36, 0.96], hex: '#8b5cf6', enabled: false, weight: 2.0,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(archVaultGraph, 0.07),
            graph: archVaultGraph
        },
        {
            id: TILE_TRIPOD_LEG, key: 'tripod_leg', name: 'Funnel Tripod', short: 'FNL',
            color: [0.08, 0.72, 0.85], hex: '#06b6d4', enabled: false, weight: 1.4,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(tripodLegGraph, 0.07),
            graph: tripodLegGraph
        },
        {
            id: TILE_DIAPHRAGM, key: 'diaphragm_xy', name: 'XY Diaphragm', short: 'DIA',
            color: [0.98, 0.45, 0.09], hex: '#f97316', enabled: false, weight: 1.1,
            sockets: [1, 1, 1, 1, 0, 0], quads: buildQuadsFromGraph(diaphragmGraph, 0.07),
            graph: diaphragmGraph
        },
        {
            id: TILE_FUNICULAR_VAULT, key: 'funicular_vault', name: 'Funicular Vault', short: 'FVL',
            color: [0.16, 0.80, 0.65], hex: '#2dd4bf', enabled: false, weight: 2.2,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(funicularVaultGraph, 0.06),
            graph: funicularVaultGraph
        },
        {
            id: TILE_SLENDER_DIAGRID, key: 'slender_diagrid', name: 'Slender Diagrid', short: 'SDG',
            color: [0.20, 0.83, 0.60], hex: '#34d399', enabled: false, weight: 2.4,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(slenderDiagridGraph, 0.06),
            graph: slenderDiagridGraph
        },
        {
            id: TILE_HYPERBOLOID, key: 'hyperboloid', name: 'Hyperboloid Lattice', short: 'HYP',
            color: [0.38, 0.65, 0.98], hex: '#60a5fa', enabled: false, weight: 2.2,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(hyperboloidGraph, 0.06),
            graph: hyperboloidGraph
        },
        {
            id: TILE_CATENARY_QUADRIPOD, key: 'catenary_quadripod', name: 'Catenary Quadripod', short: 'CTQ',
            color: [0.95, 0.45, 0.72], hex: '#f472b6', enabled: false, weight: 2.4,
            sockets: [1, 1, 1, 1, 1, 1], quads: buildQuadsFromGraph(catenaryQuadripodGraph, 0.06),
            graph: catenaryQuadripodGraph
        }
    ];
}

const TILE_PRESETS = {
    default_ortho: {
        enabled: ['null', 'cross', 'vtube', 'htube', 'htube_y'],
        weights: { null: 1.2, cross: 1.2, vtube: 1.2, htube: 1.0, htube_y: 1.0 },
        seedTile: 'cross'
    },
    arch_braced: {
        enabled: ['arch_vault', 'xbrace_xz', 'xbrace_yz', 'cross', 'vtube'],
        weights: { arch_vault: 2.4, xbrace_xz: 1.6, xbrace_yz: 1.6, cross: 0.9, vtube: 0.7 },
        seedTile: 'arch_vault'
    },
    diagrid_tower: {
        enabled: ['diag_pyramid', 'xbrace_xz', 'xbrace_yz', 'diaphragm_xy'],
        weights: { diag_pyramid: 2.5, xbrace_xz: 1.5, xbrace_yz: 1.5, diaphragm_xy: 0.8 },
        seedTile: 'diag_pyramid'
    },
    space_frame: {
        enabled: ['diag_pyramid', 'cross', 'diaphragm_xy'],
        weights: { diag_pyramid: 2.5, cross: 1.2, diaphragm_xy: 0.8 },
        seedTile: 'diag_pyramid'
    },
    funnel_vault: {
        enabled: ['arch_vault', 'tripod_leg', 'cross', 'vtube'],
        weights: { arch_vault: 2.2, tripod_leg: 1.8, cross: 1.0, vtube: 0.6 },
        seedTile: 'arch_vault'
    },
    minimal_frame: {
        enabled: ['cross', 'vtube', 'htube', 'htube_y'],
        weights: { cross: 1.8, vtube: 1.2, htube: 1.0, htube_y: 1.0 },
        seedTile: 'cross'
    },
    funicular_vault: {
        enabled: ['funicular_vault'],
        weights: { funicular_vault: 2.2 },
        seedTile: 'funicular_vault',
        defaultGrid: [2, 2, 3],
        defaultConfig: {
            fdmMode: 'compression',
            qProfile: 'column_boosted',
            qBase: 5.0,
            columnBoost: 4.0,
            anchorBoost: 1.8,
            outerRadiusM: 0.015,
            innerRadiusM: 0.008,
            nSides: 8,
            wfcSeed: 42
        }
    },
    slender_diagrid: {
        enabled: ['slender_diagrid'],
        weights: { slender_diagrid: 2.4 },
        seedTile: 'slender_diagrid',
        defaultGrid: [2, 2, 3],
        defaultConfig: {
            fdmMode: 'compression',
            qProfile: 'column_boosted',
            qBase: 5.0,
            columnBoost: 4.0,
            anchorBoost: 1.8,
            outerRadiusM: 0.015,
            innerRadiusM: 0.008,
            nSides: 8,
            wfcSeed: 42
        }
    },
    hyperboloid_tower: {
        enabled: ['hyperboloid'],
        weights: { hyperboloid: 2.2 },
        seedTile: 'hyperboloid',
        defaultGrid: [2, 2, 3],
        defaultConfig: {
            fdmMode: 'compression',
            qProfile: 'column_boosted',
            qBase: 5.0,
            columnBoost: 4.0,
            anchorBoost: 1.8,
            outerRadiusM: 0.026,
            innerRadiusM: 0.013,
            nSides: 8,
            wfcSeed: 42
        }
    },
    catenary_quadripod: {
        enabled: ['catenary_quadripod'],
        weights: { catenary_quadripod: 2.4 },
        seedTile: 'catenary_quadripod',
        defaultGrid: [2, 2, 3],
        defaultConfig: {
            fdmMode: 'compression',
            qProfile: 'column_boosted',
            qBase: 5.0,
            columnBoost: 4.0,
            anchorBoost: 1.8,
            outerRadiusM: 0.016,
            innerRadiusM: 0.009,
            nSides: 8,
            wfcSeed: 42
        }
    },
    pilot_champion: {
        enabled: ['catenary_quadripod'],
        weights: { catenary_quadripod: 2.4 },
        seedTile: 'catenary_quadripod',
        defaultGrid: [2, 2, 3],
        defaultConfig: {
            fdmMode: 'compression',
            qProfile: 'column_boosted',
            qBase: 5.0,
            columnBoost: 4.0,
            anchorBoost: 1.8,
            outerRadiusM: 0.016,
            innerRadiusM: 0.009,
            nSides: 8,
            wfcSeed: 42
        }
    }
};

function applyTilePresetToTiles(tiles, presetName, overrides = {}) {
    const preset = TILE_PRESETS[presetName] || TILE_PRESETS.arch_braced;
    const enabledSet = new Set(overrides.enabledTiles || preset.enabled);
    const weights = Object.assign({}, preset.weights, overrides.tileWeights || {});
    for (let i = 0; i < tiles.length; i++) {
        const t = tiles[i];
        t.enabled = enabledSet.has(t.key) || enabledSet.has(t.id);
        if (weights[t.key] !== undefined) t.weight = weights[t.key];
    }
    return preset;
}

function buildAdjacencyRules(tiles, mode = 'socket') {
    const n = tiles.length;
    const rules = [
        Array.from({ length: n }, () => Array(n).fill(false)),
        Array.from({ length: n }, () => Array(n).fill(false)),
        Array.from({ length: n }, () => Array(n).fill(false))
    ];
    for (let axis = 0; axis < 3; axis++) {
        const posDir = axis * 2;
        const negDir = axis * 2 + 1;
        for (let a = 0; a < n; a++) {
            for (let b = 0; b < n; b++) {
                rules[axis][a][b] = (mode === 'all')
                    ? true
                    : (tiles[a].sockets[posDir] === tiles[b].sockets[negDir]);
            }
        }
    }
    return rules;
}

// Exact Dense Linear Solver: Gaussian Elimination with Partial Pivoting
// Solves A * X = B where A is n x n (array of Float64Array) and B is n x m
function solveLinearSystem(A, B) {
    const n = A.length;
    const m = B[0].length;
    // Deep copy to avoid mutating caller arrays
    const M = new Array(n);
    const R = new Array(n);
    for (let i = 0; i < n; i++) {
        M[i] = Float64Array.from(A[i]);
        R[i] = Float64Array.from(B[i]);
    }

    for (let col = 0; col < n; col++) {
        // Partial pivoting
        let pivotRow = col;
        let maxAbs = Math.abs(M[col][col]);
        for (let row = col + 1; row < n; row++) {
            const v = Math.abs(M[row][col]);
            if (v > maxAbs) { maxAbs = v; pivotRow = row; }
        }
        if (pivotRow !== col) {
            const tmpM = M[col]; M[col] = M[pivotRow]; M[pivotRow] = tmpM;
            const tmpR = R[col]; R[col] = R[pivotRow]; R[pivotRow] = tmpR;
        }
        let piv = M[col][col];
        if (Math.abs(piv) < 1e-14) {
            piv = 1e-12;
            M[col][col] = piv;
        }
        const invPiv = 1.0 / piv;
        for (let row = col + 1; row < n; row++) {
            const factor = M[row][col] * invPiv;
            if (factor === 0) continue;
            M[row][col] = 0;
            const rowArr = M[row], colArr = M[col];
            for (let j = col + 1; j < n; j++) rowArr[j] -= factor * colArr[j];
            for (let k = 0; k < m; k++) R[row][k] -= factor * R[col][k];
        }
    }

    // Back substitution
    const X = Array.from({ length: n }, () => new Float64Array(m));
    for (let i = n - 1; i >= 0; i--) {
        const rowArr = M[i];
        for (let k = 0; k < m; k++) {
            let sum = R[i][k];
            for (let j = i + 1; j < n; j++) sum -= rowArr[j] * X[j][k];
            X[i][k] = sum / rowArr[i];
        }
    }
    return X;
}

export {
    V3,
    toV3,
    toArr3,
    mulberry32,
    DIRS,
    TILE_NULL,
    TILE_CROSS,
    TILE_VTUBE,
    TILE_HTUBE,
    TILE_HTUBE_Y,
    TILE_XBRACE_XZ,
    TILE_XBRACE_YZ,
    TILE_DIAG_PYR,
    TILE_ARCH_VAULT,
    TILE_TRIPOD_LEG,
    TILE_DIAPHRAGM,
    TILE_FUNICULAR_VAULT,
    TILE_SLENDER_DIAGRID,
    TILE_HYPERBOLOID,
    TILE_CATENARY_QUADRIPOD,
    buildBoxArmQuads,
    buildStrutQuads,
    buildQuadsFromGraph,
    createTileTemplates,
    TILE_PRESETS,
    applyTilePresetToTiles,
    buildAdjacencyRules,
    solveLinearSystem
};

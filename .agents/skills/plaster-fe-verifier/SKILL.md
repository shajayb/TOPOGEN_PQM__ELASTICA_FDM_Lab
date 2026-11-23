---
name: plaster-fe-verifier
description: Operate the independent, air-gapped TOPOGEN_FDM_Foundry/verifier/ structural & fabrication verification suite (verify.mjs, test_verifier.mjs, verifier.html). Run analytical closed-form mechanics benchmarks, evaluate 3D Euler-Bernoulli space-frame FEA for brittle cast gypsum plaster (L/300 deflection, tensile vs compressive safety factors, Euler buckling), audit watertight quad-dominant OBJ manifoldness, and interpret JSON verdicts.
---

# Independent Plaster FEA & Fabrication Verifier Skill (`plaster-fe-verifier`)

Use this skill whenever you need to **validate the FEA solver against closed-form mechanics, verify a candidate funicular topology + mesh against any Foundry brief, or inspect deflected shapes and stress distributions** in `TOPOGEN_FDM_Foundry/verifier/`.

---

## 1. Strict Air-Gap Rule

> [!CAUTION]
> **The Verifier domain (`TOPOGEN_FDM_Foundry/verifier/`) is strictly independent.** Verifier code and verification agents MUST NEVER read, import, or edit `TOPOGEN_FDM_Foundry/index_TOPOGEN_PQM_ELASTICA_FDM.html` or `TOPOGEN_FDM_Foundry/run_generator.mjs`.

The verifier consumes **only** neutral files defined in `TOPOGEN_FDM_Foundry/schemas/interchange_contract.md`:
- Brief specification: `TOPOGEN_FDM_Foundry/briefs/<brief>.json`
- Candidate topology: `<candidate>.topology.json` (`wfc-fdm-topology/v1`)
- Candidate mesh (optional/recommended): `<candidate>.mesh.obj`

---

## 2. Verifier Architecture (`TOPOGEN_FDM_Foundry/verifier/`)

| File | Role |
| :--- | :--- |
| `fea_solver.mjs` | Independent 3D Euler-Bernoulli space-frame FEA engine (6 DOF/node: `ux, uy, uz, rx, ry, rz`), circular solid/hollow section properties (`A`, `I`, `J`, `r_g`), consistent/lumped self-weight + brief load cases, pinned or fixed supports, axial + biaxial bending peak fiber stresses, and Euler buckling (`P_cr = pi^2 E I / (K L)^2`, `K = 1.0`). |
| `fabrication_check.mjs` | Independent topological and geometric fabrication auditor: BFS single-component connectivity, anchor count & ground-plane contact, 3D envelope compliance, member length & slenderness (`L / r_g`), tube radius/wall bounds, and independent `.obj` watertight manifold check (`0` boundary edges, `0` non-manifold edges, positive signed volume). |
| `verify.mjs` | Standalone Node.js CLI evaluating all fabrication checks and all load cases in a brief, printing a structured summary table, writing `<verdict>.json`, and returning deterministic exit codes (`0` = PASS, `2` = FAIL, `1` = runtime error). |
| `test_verifier.mjs` | Analytical closed-form mechanics benchmark suite validating `fea_solver.mjs` and `fabrication_check.mjs` before any verification campaign. |
| `verifier.html` | Standalone interactive Three.js 3D FEA viewer for inspecting any `.topology.json` + brief in the browser (magnified deflected shape, tensile/compressive stress heatmap, support reaction arrows, and pass/fail scorecard). |

---

## 3. Mandatory Analytical Benchmark Gate

Before trusting verifier results on a new brief or after any maintenance, **always** run the analytical validation suite:

```bash
node TOPOGEN_FDM_Foundry/verifier/test_verifier.mjs
```

Confirm **10/10 PASS** across all closed-form mechanics, KPI, and fabrication benchmarks:
1. **Horizontal & vertical cantilever beam** tip deflection `PL^3 / (3EI)` and root bending stress `PL*r / I` (`< 0.1%` error).
2. **Hollow axial column shortening** `PL / (EA)` (`< 0.01%` error).
3. **Simply supported beam under midspan point load** `PL^3 / (48EI)` (`< 0.1%` error).
4. **3D space tripod under vertical load** (global equilibrium `sum(Rz) = P` and exact leg axial forces).
5. **Euler buckling critical load** `pi^2 E I / L^2` (`K = 1.0`).
6. **Mechanism detection** (singular/unrestrained stiffness matrix detection).
7. **Mesh manifold check** (watertight cube PASS vs open-face cube FAIL vs inverted-normal cube FAIL).
8. **End-to-end `pilot_brief.json` verification** (global equilibrium residual `~1e-15`).
9. **Funicular efficiency & incident angle checks** (pure axial `funicularEfficiency = 1.0`, pure bending `0.0`, exact `90°`/`30°` incident member angles).
10. **Mesh-based plaster mass & notional lateral advisory** (`meshMassKg = signedVolumeM3 × densityKgM3`, `LC_lateral_5pct` drift and safety factor).

---

## 4. Running Verification (CLI & Browser)

### Standalone CLI
```bash
node TOPOGEN_FDM_Foundry/verifier/verify.mjs \
  --topology TOPOGEN_FDM_Foundry/runs/smoke/baseline.topology.json \
  --mesh TOPOGEN_FDM_Foundry/runs/smoke/baseline.mesh.obj \
  --brief TOPOGEN_FDM_Foundry/briefs/pilot_brief.json \
  --out TOPOGEN_FDM_Foundry/runs/smoke/baseline.verdict.json \
  [--json]
```

**CLI Flags:**
- `--topology <path>`: Required path to `<candidate>.topology.json`.
- `--mesh <path>`: Optional (required when `brief.acceptanceCriteria.requireWatertightManifoldMesh` is `true`) path to `<candidate>.mesh.obj`.
- `--brief <path>`: Required path to the Foundry brief JSON.
- `--out <path>`: Optional path to write the full structured JSON verdict.
- `--json`: Optional flag to print raw JSON verdict to stdout instead of the formatted summary table.

`verify.mjs` also exports `verifyCandidate()` for programmatic verification scripts.

**Exit Codes:**
- `0`: All required fabrication checks and all required load cases **PASSED**.
- `2`: Valid evaluation completed, but one or more acceptance criteria **FAILED**.
- `1`: Runtime / CLI / file error.

### Interactive Browser Viewer
Open `TOPOGEN_FDM_Foundry/verifier/verifier.html` in a browser (includes a built-in demo tower), drag-and-drop any `<candidate>.topology.json`, `brief.json`, and optional `<candidate>.mesh.obj`, and click **Run Plaster FEA** to inspect:
- Magnified 3D deflected shape (with deflection scale slider)
- Color-mapped tensile, compressive, axial, and utilization heatmaps
- Support reaction and applied load force arrows
- Full PASS/FAIL acceptance scorecard

---

## 5. Interpreting Brittle Plaster FEA Metrics

Standard cast gypsum plaster (Plaster of Paris / Hydrocal: `E = 5.0 GPa`, `rho = 1250 kg/m^3`, `f_c = 12.0 MPa`, `f_t = 2.0 MPa`) is **6× weaker in tension than in compression**. Consequently, failure modes follow a predictable hierarchy:

1. **Tensile / Flexural Cracking (`SF_t = f_t / max(sigma_t)`) — Primary Governing Limit**:
   - Even small bending moments `M` in a plaster strut generate peak tensile fiber stress `sigma_t = N/A + M*r/I`.
   - A well-formed compression funicular structure keeps axial force `N < 0` (compressive) large enough to cancel bending tension, keeping `SF_t >= 1.5`.
   - Check `worstMembers` in `<verdict>.json` to pinpoint where bending tension spikes (commonly near pinned supports or unbraced mid-height kinks).
2. **Serviceability Deflection (`maxDisp <= maxDeflectionMeters`, typically `L/300`)**:
   - Check both absolute nodal displacement `maxDisp` and its ratio against the brief's characteristic length (`min(planSpan, height)`).
   - Check `worstNodes` to see whether deflection is global lateral sway (needs diagonal bracing or wider anchor spread) or local crown sag (needs deeper arch rise or thicker tube radius).
3. **Compressive Crushing (`SF_c = f_c / max(|sigma_c|) >= 2.0`)**:
   - Rarely governs before tension unless cross-sections are very thin under heavy loads.
4. **Euler Buckling (`SF_b = min(P_cr / |N|) >= 2.0`)**:
   - Checked on all compressed members (`N < 0`) with conservative effective length factor `K = 1.0`.
   - Flagged alongside slenderness ratio `L / r_g <= maxSlendernessRatio`.
5. **Fabrication, Manifoldness & Castability KPIs**:
   - Single connected component (no floating struts).
   - Exact anchor count in `[minAnchors, maxAnchors]` and ground contact `|z - groundZ| <= groundTolerance`.
   - Watertight manifold `.obj` (`boundaryEdges === 0`, `nonManifoldEdges === 0`, `signedVolume > 0`) so molds or 3D-printed formwork can be fabricated directly.
   - **Mesh-based plaster mass (`meshMassKg`)**: Reported alongside `centerlineMassKg` and `effectiveMassKg` (`signedVolumeM3 × densityKgM3`) so joint overlap isn't double-counted.
   - **Minimum incident member angle (`minIncidentAngleDeg`)**: Computed via `computeMinIncidentAngle()` in `fabrication_check.mjs` to flag overly acute cast joints.
6. **Funicularity, Efficiency & Lateral Advisory KPIs (`verdict.kpis`, `verdict.lateralStabilityAdvisory`)**:
   - **`funicularEfficiency`**: `1 - mean(|sigma_bending| / (|sigma_axial| + |sigma_bending| + 1e-9))` across loaded members (`1.0` = pure axial funicular, `0.0` = pure bending).
   - **`compressionDominance`**: Fraction of members in net axial compression (`N < 0`) under the governing load case.
   - **`loadToMassRatio` & `loadToMeshMassRatio`**: `imposedLoadKg / massKg` (higher = lighter, more efficient structure).
   - **`LC_lateral_5pct` Notional Lateral Stability Advisory**: Evaluates `0.05 × totalVerticalLoad` horizontally in `+X` and `+Y` at `top_zone_nodes`, reporting `maxDrift` (e.g., `H/3563`) and `minSF` as an engineering advisory (does not alter `verdict.passed` unless the brief explicitly includes a lateral load case).

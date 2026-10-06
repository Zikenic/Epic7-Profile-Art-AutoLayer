# Development Status & Architectural Checkpoint

**Date**: October 6, 2026  
**Checkpoint**: Milestones 1, 2, and 3 Complete (Frozen prior to Milestone 4)

---

## 1. System Overview & Completed Components

### A. Authoritative Profile Editor (Milestone 1)
- **Canvas Geometry**: Fixed 21:31 aspect ratio (native resolution: 310×210) strictly matching Epic Seven's in-game profile card format.
- **Layer System**:
  - Hard constraint of 130 layers enforced at the core engine level (`ProfileEngine.ts`).
  - Layer operations: Add, delete, duplicate, reorder (Z-order), toggle visibility.
- **Transform Editing**:
  - Position: $(x, y) \in [0.0, 1.0]$, centered at native $(0.5, 0.5)$.
  - Scaling: Anisotropic `scaleX`, `scaleY` with true geometric scaling.
  - Rotation: $[-180^\circ, +180^\circ]$ in degrees.
  - Opacity: $[0.0, 1.0]$.
  - Color: 24-color game palette plus arbitrary hex support.
- **Authoritative Shape Definitions**:
  - 13 distinct primitives: `Baloon`, `Circle`, `Cross`, `Glow`, `Half_Circle`, `Heart`, `Moon_Curve`, `Moon_Edge`, `Pill`, `Rounded_Square`, `Square`, `Star`, `Triangle`.
  - Native square frame calibration (`shape-frame-calibration.json`) derived from `ref_Frame_size/` captures.
  - Mathematical vector paths in `MathematicalShapeDefinition.ts` execute through `DeterministicRenderer.ts`.
  - `Half_Circle` uses the authoritative circular arc geometry (`ctx.arc`), verified to provide 98.40% IoU against the in-game reference sprite.

### B. Headless Image Scorer (Milestone 2)
- **Adapter**: `HeadlessRenderer.ts` dynamically uses `@napi-rs/canvas` in Node.js and `OffscreenCanvas` in the browser, ensuring exact rendering parity without diverging implementations.
- **Objective Function**: Multi-term loss in `ImageScorer.ts`:
  1. **Color Loss**: Perceptually uniform CIELAB $\Delta E$ distance on foreground pixels.
  2. **Alpha Mask Loss**: IoU and absolute difference error on transparent alpha channels.
  3. **Multi-Scale Loss**: Multi-resolution image pyramid gradient difference.
  4. **Centroid Penalty**: Normalized Euclidean distance penalty between target and candidate centroids.
- **Zero-Loss Identity**: An identical candidate layer evaluated against its own render achieves score $\approx 0.0000$.

### C. Single-Layer Optimizer (Milestone 3)
- **Initial Parameter Estimation**:
  - Spatial moments ($\mu_{00}, \mu_{10}, \mu_{01}$) for centroid estimation.
  - Central moments ($\mu_{20}, \mu_{02}, \mu_{11}$) for orientation angle $\theta$ and semi-major/minor axis lengths.
  - Foreground pixel sampling for initial color and opacity estimation.
- **Dynamic Primitive Calibration**:
  - Primitive calibration values (spawn aspect ratio, effective fill factor) are dynamically derived from the authoritative renderer via `derivePrimitiveCalibration()` at initialization, preventing drift.
- **Symmetry & Canonicalization**:
  - `Symmetry.ts` encapsulates symmetry orders ($C_1, C_2, C_4, D_1, D_2, D_4, D_\infty$), rotational periods, and $90^\circ$ aspect swap rules.
  - Occam's razor tie-breaking: when two candidates achieve statistically indistinguishable loss, the higher-symmetry primitive is preferred.
- **Shape Disambiguation**:
  - Anisotropic candidate generation expands isotropic primitives (e.g. Circle) when image moments indicate non-uniform aspect ratios, resolving previous Circle vs. Pill pruning misclassifications.
- **Hierarchical Refinement**:
  - Stage 1: Coarse candidate ranking on half-resolution proxy (155×105).
  - Stage 2: Fine coordinate descent on native resolution (310×210) for position, scale, rotation, color, and opacity.
  - Optional Stage 3: Nelder-Mead simplex polish.

---

## 2. Test Evidence & Verification Results

### A. Unit and Integration Test Suites (`npm test`)
All 6 test suites pass cleanly:
1. `test_engine.mjs`: Profile card data structures, layer ordering, and 130-layer limit.
2. `test_calibration.mjs`: Native square frame calibration consistency.
3. `test_math_primitives.mjs`: Mathematical path generation for all 13 primitives.
4. `test_editor_regression.mjs`: Canvas ratio, transform bounds, and layer operations.
5. `test_scoring.mjs`: Color conversion, alpha masking, identity loss, and metric monotonicity.
6. `test_optimizer.mjs`: 6 synthetic single-layer recovery scenarios, including zero-drift dynamic calibration verification.

### B. Held-Out Single-Layer Benchmark (`npm run test:heldout`)
- **Suite Size**: 120 randomized synthetic cases spanning all 13 primitives with variable transforms, rotations, non-uniform scaling, and palette colors.
- **Shape Classification Accuracy**: **119 / 120 (99.2%)**
- **Color Recovery Accuracy**: **120 / 120 (100.0%)**
- **Symmetric Equivalence Rate**: **89 / 120 (74.2%)**
- **Loss Percentiles**:
  - Median ($p_{50}$): **0.0062** (well below the $\le 0.015$ threshold)
  - 90th percentile ($p_{90}$): **0.0604** (below the $\le 0.070$ threshold)
- **Challenging Case**: Exactly 1 case failed shape recovery (Heart case #9, recovered as Baloon due to a local orientation minimum under sideways rotation at $-98^\circ$).

### C. Build Verification (`npm run build`)
- Clean compilation via `tsc && vite build` (output emitted to `dist/` in under 2 seconds).
- `node_modules` remains completely unpatched and pristine.

---

## 3. Known Limitations & Freeze Boundaries

1. **Milestone 4 Not Started**:
   - Greedy multi-layer reconstruction, residual error image subtraction, and layer reduction passes have NOT been implemented. The codebase is frozen at the single-layer recovery boundary.
2. **Local Minima on Extreme Rotations**:
   - Single-layer recovery can rarely settle into a local orientation minimum for asymmetric shapes (e.g., Heart) rotated near $\pm 90^\circ$ when evaluated without multi-start global search.
3. **Execution Sandbox Considerations**:
   - Building with Rollup or connecting to external Git remotes on Windows requires standard process spawning and network access outside restricted job-object sandboxes.

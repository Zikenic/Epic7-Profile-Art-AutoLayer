# Development Status & Architectural Checkpoint

**Date**: October 6, 2026  
**Checkpoint**: Milestones 1, 2, 3, and 4 Complete (Ready for Milestone 5 UI Integration)

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
  - Color: 26-color game palette (`EPIC7_PALETTE_HEX`) plus arbitrary hex support.
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

### D. Greedy Multi-Layer Reconstruction Engine (Milestone 4)
- **Orchestrator**: `MultiLayerReconstructor.ts` exposes `reconstruct(target, options)` and `createProjectFromLayers()`.
- **Residual Representation**:
  - Per-pixel error magnitude: $M(x, y) = \max(|a_t - a_c|,\; \min(a_t, a_c) \cdot \Delta E(RGB_t, RGB_c))$.
  - Color-homogeneous connected component segmentation: partitions high-residual pixels into distinct spatial clusters grouped strictly by target palette color, preventing complementary color blending across adjacent shapes.
- **Fast Incremental Evaluation**:
  - Caches base canvas rendering of current layer stack.
  - Composites candidate layer using native 2D canvas operations (`drawImage`) in under 0.25 ms per candidate.
- **Z-Order Exploration**:
  - Evaluates candidate insertion at Top (`length`), Bottom (`0`), and directly above the dominant layer covering the candidate region's centroid.
- **Authoritative Finalist Verification**:
  - Renders top $K$ finalists at native verification resolution ($210 \times 310$) with `DeterministicRenderer` and scores with `ImageScorer`.
  - Selects the finalist achieving the highest verified loss improvement exceeding `minImprovement`.
- **Local Micro-Polish**:
  - Multi-scale coordinate descent ($dPos = 0.012, 0.005, 0.002$; $dScale = 0.03, 0.015, 0.006$; $dRot = 3^\circ, 1.5^\circ, 0.8^\circ$) on native resolution before committing.
- **Post-Greedy Layer Reduction**:
  - Estimates marginal loss impact of removing each layer.
  - Iteratively prunes redundant or occluded layers as long as total loss regression stays within `reductionTolerance`.

---

## 2. Test Evidence & Verification Results

### A. All Automated Test Suites (`npm test`)
All 7 test suites pass with zero failures:
1. `test_engine.mjs`: Profile card data structures, layer ordering, and 130-layer limit.
2. `test_calibration.mjs`: Native square frame calibration consistency.
3. `test_math_primitives.mjs`: Mathematical path generation for all 13 primitives.
4. `test_editor_regression.mjs`: Canvas ratio, transform bounds, and layer operations.
5. `test_scoring.mjs`: Color conversion, alpha masking, identity loss, and metric monotonicity.
6. `test_optimizer.mjs`: 6 synthetic single-layer recovery scenarios, including zero-drift dynamic calibration verification.
7. `test_multilayer.mjs`: Complete Milestone 4 test suite (Tests A through H).

### B. Milestone 4 Synthetic Reconstruction Results (`npm run test:multilayer`)
| Test | Scenario | Initial Loss | Final Loss | Layers (Pre $\to$ Post) | Status |
|---|---|---|---|---|---|
| **Test A** | Two Non-Overlapping Shapes (`Circle` + `Triangle`) | 0.8921 | **0.0097** | 2 $\to$ 2 | **PASSED** |
| **Test B** | Overlapping Shapes in Painter's Stacking Order (`Rounded_Square` base + `Heart` top) | 0.9744 | **0.0167** | 2 $\to$ 2 | **PASSED** |
| **Test C** | Multiple Palette Colors (`Pill` `#e43032` + `Star` `#11d4bd` + `Heart` `#fe9dbe`) | 0.9038 | **0.0171** | 3 $\to$ 3 | **PASSED** |
| **Test D** | Disconnected Same-Color Shapes (2 separate green Circles) | 0.8388 | **0.0133** | 2 $\to$ 2 | **PASSED** |
| **Test E** | Redundant Layer Pruning via Reduction Pass | 1.0000 | **0.0035** | 1 $\to$ 1 | **PASSED** |
| **Test F** | Hard Budget Enforcement (`maxLayers` = 1, 2, 5) | - | - | Strictly capped | **PASSED** |
| **Test G** | Imperfect / Noisy Target Stability (Anti-Aliasing robustness) | 0.8921 | **0.0145** | 2 $\to$ 2 | **PASSED** |
| **Test H** | Direct Export to `.e7profile.json` Serialization | - | - | Valid schema | **PASSED** |

### C. Build Verification (`npm run build`)
- Clean compilation via `tsc && vite build` (output emitted to `dist/` in 2.58s).
- `node_modules` remains completely unpatched and pristine.

---

## 3. Known Limitations & Next Steps

1. **Milestone 5 Next Step**:
   - Auto-Layer UI integration: Crop interface, image drag-and-drop / upload modal, progress bar / live preview during greedy iterations.
2. **Highly Complex Freeform Vector Art**:
   - Complex non-geometric illustrations with thousands of curves will be approximated using up to 130 overlapping geometric primitives.

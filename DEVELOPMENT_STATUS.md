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
### E. Adaptive Image Simplifier & Region Preprocessing (Phase 5)
- **Module**: `ImageSimplifier.ts` and `RegionRepresentation.ts`.
- **Edge-Preserving Smoothing**: Bilateral filter on Lab channels ($5\times 5$ window, spatial $\sigma_s = 2.0$, range $\sigma_r = 15.0$) suppresses high-frequency antialiasing and gradient noise without blurring structural edges.
- **Adaptive Perceptual Color Quantization**: Lab-space K-means clustering with deterministic Mulberry32 seed and dynamic $K$ selection ($8 \le K \le 16$) based on image color variance.
- **Palette Mapping**: Maps cluster centers in Lab space to the 26 authoritative Epic Seven palette colors (`findClosestPaletteColorFromLab()`), preserving pre-snapped cluster colors and $\Delta E$ diagnostics.
- **Spatial Macro-Region Extraction**: 8-connected BFS extracts coherent spatial regions on the quantized buffer.
- **Island Merging & Detail Protection**: Merges sub-threshold islands ($< 0.35\%$ area) into adjacent color-compatible neighbors while protecting high-contrast salient features (eyes, pupils, accessories) using contrast, enclosure ratio ($> 50\%$), and saliency signals.
- **Adaptive `minImprovement` Threshold**: Replaces rigid static threshold with dynamic scaling:
  $\text{effectiveThreshold} = \max(\text{floor},\; \min(\text{ceiling},\; \text{currentLoss} \cdot \text{fraction}))$, allowing subtle foreground details to be reconstructed without premature stalling.

---

## 2. Test Suites & Verification Results

### A. Core Regression Suites (`npm test`)
1. `test_engine.mjs`: Core ProfileEngine operations and layer limits.
2. `test_calibration.mjs`: Native frame calibration vs in-game captures.
3. `test_math_primitives.mjs`: Mathematical path generation for all 13 primitives.
4. `test_editor_regression.mjs`: Canvas ratio, transform bounds, and layer operations.
5. `test_scoring.mjs`: Color conversion, alpha masking, identity loss, and metric monotonicity.
6. `test_optimizer.mjs`: 6 synthetic single-layer recovery scenarios, including zero-drift dynamic calibration verification.
7. `test_multilayer.mjs`: Complete Milestone 4 test suite (Tests A through L, including determinism, strict layer improvement, layer order sensitivity, and cumulative drift safety).
8. `test_simplifier.mjs`: Complete Phase 5 test suite (Tests A through H).

### B. Phase 5 Simplifier Test Results (`npm run test:simplifier`)
| Test | Scenario | Raw Regions | Simplified Regions | Result |
|---|---|---|---|---|
| **Test A** | Flat Solid Regions | 3 | 3 | **PASSED** (Minimal regions, 3 palette colors preserved) |
| **Test B** | Smooth Continuous Gradient | 5 | 5 | **PASSED** (Quantized into 5 tonal bands, zero 1-px islands) |
| **Test C** | Antialiased Edge Boundary | 119 | 2 | **PASSED** (117 fringe artifacts merged into circle/background) |
| **Test D** | Small High-Contrast Detail | 2 | 2 | **PASSED** (8x8 pupil preserved with saliency 0.438) |
| **Test E** | Random Pixel Salt & Pepper Noise | 46 | 2 | **PASSED** (Noise suppressed, macro-structures retained) |
| **Test F** | Disconnected Same-Color Regions | 3 | 3 | **PASSED** (2 disconnected foreground circles cleanly isolated) |
| **Test G** | Determinism & Repeatability | - | - | **PASSED** (Bit-for-bit identical raster and region list) |
| **Test H** | Adaptive `minImprovement` Acceptance | - | - | **PASSED** (Subtle foreground circle recovered at loss 0.0002) |

### C. Real-Image Diagnostic Comparison
| Image | Raw Pipeline Regions | Simplified Pipeline Regions | Simplifier Runtime | Raw Recon Layers / Loss | Simplified Recon Layers / Loss |
|---|---|---|---|---|---|
| **Image 1 (`Seriane.png`)** | 2,000+ (pathological) | **11 coherent regions** | **107 ms** | 1 layer / 0.0125 (stalled) | 1 layer / 0.0001 (target matched) |
| **Image 2 (`wp15313950.jpg`)** | 523 (fragmented) | **12 coherent regions** | **123 ms** | 4 layers / 0.2288 (timeout) | 4 layers / **0.0732 vs original** |

### D. Build Verification (`npm run build`)
- Clean compilation via `tsc && vite build` (output emitted to `dist/` in 1.88s).
- `node_modules` remains completely unpatched and pristine.

---

## 3. Known Limitations & Next Steps

1. **Phase 6 / Milestone 5 Next Step**:
   - AutoLayer UI integration: Crop workspace (21:31 ratio), drag-and-drop / upload modal, live progress rendering.
   - Web Worker execution for ImageSimplifier and MultiLayerReconstructor.
2. **Highly Complex Freeform Vector Art**:
   - Complex non-geometric illustrations with thousands of curves will be approximated using up to 130 overlapping geometric primitives.

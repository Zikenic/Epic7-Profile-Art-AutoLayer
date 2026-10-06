# Development Status & Architectural Checkpoint

**Date**: October 7, 2026  
**Checkpoint**: Milestones 1-4, Phase 5 (Adaptive Simplifier), and Phase 6 (Region-Driven Reconstruction) Complete (Ready for Milestone 5 UI Integration)

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
9. `test_region_reconstruction.mjs`: Complete Phase 6 test suite (Tests A through G).

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

### C. Phase 6 Region-Driven Reconstruction Test Results (`npm run test:region`)
| Test | Scenario | Tested Feature | Result |
|---|---|---|---|
| **Test A** | Region to Candidate Initialization | Centroid, scale, orientation, palette color seeding | **PASSED** (88 candidates generated with direct geometric bounds) |
| **Test B** | Candidate Preference & Aspect Matching | Anisotropic aspect ratio compatibility ranking | **PASSED** (Elongated structure matched by aspect-compatible primitive) |
| **Test C** | Regional Improvement for Subtle Details | Regional error metric prevents macro-region starvation | **PASSED** (Subtle foreground eye/pupil recovered at center) |
| **Test D** | Background Mode Policy | `'reconstruct'` vs `'ignore'` background handling | **PASSED** (Background correctly handled without suppressing foreground) |
| **Test E** | Disconnected Same-Color Isolation | Topological separation of identical-color patches | **PASSED** (Independent spot layers placed accurately) |
| **Test F** | Multi-Layer Complex Regions | Iterative residual moment tracking on non-convex shapes | **PASSED** (2 layers allocated to explain non-convex L-shape) |
| **Test G** | Reconstruction Determinism | Bit-for-bit repeatability across repeated runs | **PASSED** (Identical layers and loss: 0.5690 across both runs) |

### D. Phase 6 Real-Image Quantitative Evaluation (`evaluate_phase6.mjs`)
| Metric | Seriane (`Seriane.png`) | Wallpaper (`wp15313950.jpg`) |
|---|---|---|
| **Target Dimensions** | 210 × 310 (native 21:31) | 210 × 310 (native 21:31) |
| **Raw Connected Components** | 2,300+ pixel fragments | 523 fragmented components |
| **Simplified Macro-Regions** | **3 coherent regions** | **12 coherent regions** |
| **Candidate Search Space Reduction** | **> 99.9% reduction** | **> 99.5% reduction** |
| **Reconstruction Runtime** | **2.9s** (was 30s+ in Phase 4.5) | **31.2s** |
| **Accepted Layers** | 3 layers (`Rounded_Square`, `Triangle`, `Circle`) | 4 layers (`Rounded_Square` bg + 3 accent layers) |
| **Final Loss vs Simplified Target** | **0.0001** (near-perfect match) | **0.0478** |
| **Final Loss vs Raw Target** | **0.0125** | **0.0810** |
| **Candidate Evaluation Throughput** | ~5,500 candidate checks/sec | ~5,200 candidate checks/sec |

### E. Build Verification (`npm run build`)
- Clean compilation via `tsc && vite build` (output emitted to `dist/` in 1.86s).
- All 9 test suites pass cleanly via `npm test`.

---

## 3. Architecture of Region-Driven Reconstruction (Phase 6)

```text
RAW SOURCE IMAGE
       ↓
ImageSimplifier (Bilateral filter + Lab K-means + Palette mapping + 8-connected BFS + Island merging)
       ↓
RegionGraph (Coherent Macro-Regions + Adjacency + Saliency + Detail Protection)
       ↓
MultiLayerReconstructor:
  1. Active Region Prioritization:
     importance = 0.35 * areaFraction + 0.30 * saliency + 0.35 * meanResidual + (isPreservedDetail ? 0.25 : 0)
  2. Direct Region -> Candidate Seeding:
     Geometric moments (centroid, semi-major/minor radii, orientation θ) directly parameterize candidate shapes
  3. Aspect-Ratio Matching & Anisotropic Expansion:
     Shortlists primitives by aspect compatibility; expands uniform shapes into anisotropic bounding boxes
  4. Dual-Objective Scoring:
     combinedImprovement = fastImprovement + regionalWeight * regionalImprovement
  5. Dynamic Residual Tracking:
     Non-convex and multi-layer regions update their active unexplained residual moments per iteration
       ↓
Authoritative Verification (DeterministicRenderer + ImageScorer @ 210×310)
       ↓
Local Coordinate Polish & Redundant Layer Reduction
       ↓
Clean Epic Seven Composition (≤ 130 layers)
```

---

## 4. Known Limitations & Next Steps

1. **Milestone 5 / Next Phase**:
   - **Auto-Layer Crop/Import UI**: Interactive 21:31 canvas crop tool, drag-and-drop file upload, live multi-layer reconstruction progress preview, preset simplification profiles (`FAST`, `BALANCED`, `DETAIL`).
   - **Web Worker Execution**: Offload simplification and reconstruction loop from main UI thread to Web Worker for silky smooth 60fps UI responsiveness.
2. **Extreme Geometric Detail Approximation**:
   - Extremely high-frequency textures (such as intricate lace or chainmail) will be abstracted into macro-clusters by the 130-layer budget limit.

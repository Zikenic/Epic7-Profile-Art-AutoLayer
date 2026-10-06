# Development Status & Architectural Checkpoint

**Date**: October 7, 2026  
**Checkpoint**: Milestones 1-4, Phase 5 (Adaptive Simplifier), Phase 6 (Region-Driven Reconstruction), and Phase 7 (True Multi-Shape Reconstruction) Complete (Ready for Milestone 5 UI Integration)

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
  - Color-homogeneous connected component segmentation: partitions high-residual pixels into distinct spatial clusters grouped strictly by target palette color.
- **Fast Incremental Evaluation**:
  - Caches base canvas rendering of current layer stack.
  - Composites candidate layer using native 2D canvas operations (`drawImage`) in under 0.25 ms per candidate.
- **Z-Order Exploration**:
  - Evaluates candidate insertion at Top (`length`), Bottom (`0`), and directly above the dominant layer covering the candidate region's centroid.
- **Authoritative Finalist Verification**:
  - Renders top $K$ finalists at native verification resolution ($210 \times 310$) with `DeterministicRenderer` and scores with `ImageScorer`.
  - Selects the finalist achieving the highest verified utility exceeding thresholds.
- **Local Micro-Polish**:
  - Multi-scale coordinate descent ($dPos = 0.012, 0.005, 0.002$; $dScale = 0.03, 0.015, 0.006$; $dRot = 3^\circ, 1.5^\circ, 0.8^\circ$) on native resolution before committing.
- **Post-Greedy Layer Reduction**:
  - Estimates marginal loss impact of removing each layer.
  - Iteratively prunes redundant or occluded layers with foreground protection safeguards.

### E. Adaptive Image Simplifier & Region Preprocessing (Phase 5)
- **Module**: `ImageSimplifier.ts` and `RegionRepresentation.ts`.
- **Edge-Preserving Smoothing**: Bilateral filter on Lab channels ($5\times 5$ window, spatial $\sigma_s = 2.0$, range $\sigma_r = 15.0$) suppresses high-frequency antialiasing and gradient noise without blurring structural edges.
- **Adaptive Perceptual Color Quantization**: Lab-space K-means clustering with deterministic Mulberry32 seed and dynamic $K$ selection ($8 \le K \le 16$) based on image color variance.
- **Palette Mapping**: Maps cluster centers in Lab space to the 26 authoritative Epic Seven palette colors (`findClosestPaletteColorFromLab()`), preserving pre-snapped cluster colors and $\Delta E$ diagnostics.
- **Spatial Macro-Region Extraction**: 8-connected BFS extracts coherent spatial regions on the quantized buffer.
- **Island Merging & Detail Protection**: Merges sub-threshold islands ($< 0.35\%$ area) into adjacent color-compatible neighbors while protecting high-contrast salient features (eyes, pupils, accessories) using contrast, enclosure ratio ($> 50\%$), and saliency signals.
- **Adaptive `minImprovement` Threshold**: Replaces rigid static threshold with dynamic scaling:
  $\text{effectiveThreshold} = \max(\text{floor},\; \min(\text{ceiling},\; \text{currentLoss} \cdot \text{fraction}))$, allowing subtle foreground details to be reconstructed without premature stalling.

### F. True Multi-Shape Reconstruction & Dynamic Residual Splitting (Phase 7)
- **Paradigm Shift**: Moved from "one region $\rightarrow$ one primary shape" to iterative decomposition:
  $\text{Region} \rightarrow \text{best shape} \rightarrow \text{render} \rightarrow \text{residual sub-regions} \rightarrow \text{next shape} \rightarrow \dots$.
- **Residual Decomposition API**: `ResidualAnalyzer.splitRegionResidual()` restricts analysis to the parent region's bounds/mask, filters noise ($e \ge 0.06$), extracts 8-connected components, and calculates central moments ($\mu_{20}, \mu_{02}, \mu_{11}$) and PCA principal radii to seed subsequent sub-shapes.
- **Multi-Color Sub-Region Layering**: Bins pixel errors by nearest Epic Seven palette color, enabling independent candidate generation for dominant and secondary colors in compound areas (e.g. highlights, shadows, accessories).
- **Foreground Saliency Weighting**:
  - Explicit foreground mask weights non-background pixels by saliency ($w_f \in [0.35, 1.0]$) while suppressing background ($w_f = 0.05$).
  - Dual loss reporting: tracks both `globalLoss` and `foregroundWeightedLoss`.
- **Candidate Utility Function**:
  $$\text{Utility} = W_g \cdot \Delta \mathcal{L}_{\text{global}} + W_f \cdot \Delta \mathcal{L}_{\text{foreground}} + W_r \cdot \max(0, \Delta \mathcal{L}_{\text{regional}})$$
  where default weights are $W_g = 0.25, W_f = 0.45, W_r = 0.30$.
- **Reduction Pass Foreground Safeguard**: Pruning prevents removing layers that cause foreground loss regression $> 1.5 \times \text{tolerance}$, protecting small salient features.

---

## 2. Test Suites & Verification Results

### A. Core Regression Suites (`npm test`)
All 10 test suites pass with 100% clean status:
1. `test_engine.mjs`: Core ProfileEngine operations and layer limits.
2. `test_calibration.mjs`: Native frame calibration vs in-game captures.
3. `test_math_primitives.mjs`: Mathematical path generation for all 13 primitives.
4. `test_editor_regression.mjs`: Canvas ratio, transform bounds, and layer operations.
5. `test_scoring.mjs`: Color conversion, alpha masking, identity loss, and metric monotonicity.
6. `test_optimizer.mjs`: 6 synthetic single-layer recovery scenarios.
7. `test_multilayer.mjs`: Complete Milestone 4 test suite (Tests A through L).
8. `test_simplifier.mjs`: Complete Phase 5 test suite (Tests A through H).
9. `test_region_reconstruction.mjs`: Complete Phase 6 test suite (Tests A through G).
10. `test_true_multishape.mjs`: Complete Phase 7 test suite (Tests A through G).

### B. Phase 7 True Multi-Shape Test Results (`npm run test:multishape`)
| Test | Scenario | Tested Feature | Result |
|---|---|---|---|
| **Test A** | Compound Region Decomposition | Non-convex L-shape fitted with multiple shapes | **PASSED** (3 shapes: Heart + Half_Circle + Baloon allocated to single L-shape) |
| **Test B** | Multi-Color Layering in Same Visual Area | Stacking multiple colors within compound region | **PASSED** (3 colors: #ffffff base + #3f48bb + #e43032 detail) |
| **Test C** | Residual Splitting & Sub-Region Discovery | Remaining error extracted as sub-region | **PASSED** (1,500-px sub-region extracted with centroid and moments) |
| **Test D** | Foreground-Aware Utility Prioritization | Small high-contrast detail prioritized | **PASSED** (Small red pupil prioritized despite tiny pixel area) |
| **Test E** | Multi-Layer Budget Utilization | Continuous layer placement across budget | **PASSED** (5 shapes accepted up to requested budget) |
| **Test F** | Graceful Termination on Negligible Residual | Halts cleanly when target matched | **PASSED** (Terminates with `target_matched` at 0.001 loss threshold) |
| **Test G** | Reconstruction Determinism | Bit-for-bit repeatability across repeated runs | **PASSED** (Exact identical layer parameters and loss values) |

### C. Phase 7 Real-Image Quantitative Evaluation (`evaluate_phase7.mjs`)
| Metric | Seriane (`Seriane.png`) | Wallpaper (`wp15313950.jpg`) |
|---|---|---|
| **Target Dimensions** | 210 × 310 (native 21:31) | 210 × 310 (native 21:31) |
| **Simplified Macro-Regions** | 3 coherent regions (146ms) | 12 coherent regions (167ms) |
| **Initial Global Loss** | 0.8500 | 0.8500 |
| **Final Global Loss** | **0.0125** | **0.0803** |
| **Final Foreground Loss** | **0.0473** | **0.3947** |
| **Accepted Layers** | 1 layer (Full #ffffff background matches canvas) | 4 layers (`Rounded_Square` bg + `Circle` body + `Heart` + `Circle` accents) |
| **Residual Split Runtime** | **7 ms** | **26 ms** |
| **Stop Reason** | `no_improvement` (canvas already matched) | `timeout` (120s limit reached) |

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

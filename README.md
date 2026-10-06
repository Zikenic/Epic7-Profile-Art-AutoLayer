# Epic7 Profile Art Editor & AutoLayer Engine

A web-based editor and inverse-rendering reconstruction engine for **Epic Seven** profile cards.

Built with React 19, TypeScript, Vite, and HTML5 Canvas, this project faithfully replicates Epic Seven's in-game profile card editor constraints and provides a headless optimization pipeline for automated single-layer shape recovery.

---

## Features

### 1. Authoritative Profile Editor
- **Game-Accurate Canvas**: Fixed 21:31 canvas aspect ratio (native 310×210 render space) matching the in-game Epic Seven profile card.
- **130-Layer Limit**: Hard constraint of 130 layers with layer creation, deletion, duplication, and Z-index reordering.
- **Full Transform Controls**:
  - Normalized canvas coordinates $(x, y) \in [0, 1]$ centered at $(0.5, 0.5)$.
  - Independent anisotropic scaling (`scaleX`, `scaleY`).
  - Continuous rotation from $-180^\circ$ to $+180^\circ$.
  - Opacity $[0.0, 1.0]$ and hex color selection from the game's color palette.
- **Dual Rendering Modes**:
  - **Raster Renderer**: Renders reference asset sprites extracted from the game.
  - **Mathematical Vector Renderer (`DeterministicRenderer`)**: Precision path geometry for all 13 standard primitives (Baloon, Circle, Cross, Glow, Half_Circle, Heart, Moon_Curve, Moon_Edge, Pill, Rounded_Square, Square, Star, Triangle).
- **Square Frame Calibration**: Accurate spawn scale factors calibrated against the game's native square frame references (`ref_Frame_size/`).

### 2. AutoLayer Reconstruction Pipeline (Milestones 2 & 3)
- **Headless Renderer Adapter (`HeadlessRenderer`)**:
  - Unified rendering execution across environments: Node.js (via `@napi-rs/canvas`) and browser (via `OffscreenCanvas`).
  - Zero divergence between test/optimization runs and user-facing editor renders.
- **Multi-Term Image Scorer (`ImageScorer`)**:
  - Pixel-wise Lab color difference ($\Delta E$), alpha channel mask IoU loss, gradient structure penalty, and centroid alignment penalty.
  - Sub-millisecond evaluation speed per candidate layer.
- **Deterministic Single-Layer Optimizer (`SingleLayerOptimizer`)**:
  - Image moment analysis (`ImageMoments`) for initial centroid, orientation, axis lengths, and color estimation.
  - Symmetry-aware parameter space exploration (`Symmetry`) handling $90^\circ$ aspect swaps and rotational invariants.
  - Anisotropic candidate generation for isotropic primitives to resolve shape ambiguities (e.g., Circle vs. Pill).
  - Multi-resolution hierarchical refinement: Coarse-grid evaluation (155×105) followed by coordinate descent on native resolution (310×210).

---

## Project Structure

```text
ProfileCreator/
├── src/
│   ├── core/                   # Authoritative editor engine, layer models & math shapes
│   │   ├── LayerModel.ts
│   │   ├── ProfileEngine.ts
│   │   ├── Renderer.ts         # DeterministicRenderer (math & raster)
│   │   ├── MathematicalShapeDefinition.ts
│   │   ├── MathematicalShapeRegistry.ts
│   │   └── ShapeFrameCalibration.ts
│   ├── components/             # React UI components (Editor, Canvas, Panels, Modals)
│   ├── calibration/            # Interactive shape calibration tooling
│   └── reconstruction/         # AutoLayer optimization & scoring engine
│       ├── HeadlessRenderer.ts
│       ├── ImageScorer.ts
│       ├── ImageMoments.ts
│       ├── SingleLayerOptimizer.ts
│       ├── Symmetry.ts
│       ├── ColorSpaces.ts
│       └── types.ts
├── Shapes_Colors/              # Authoritative game reference sprites & palettes
├── ref_Frame_size/             # Reference square frames for spawn size calibration
├── Ref_Spawn_Size/             # Reference spawn size captures
├── DerivedShapes/              # Derived assets (e.g. Cross.png)
├── test_*.mjs                  # Test suites (engine, calibration, math, regression, scoring, optimizer)
├── shape-frame-calibration.json# Serialized frame calibration parameters
├── package.json
└── vite.config.ts
```

---

## Getting Started

### Prerequisites
- Node.js 18+ (tested on Node.js 20+)
- npm 9+

### Installation
```bash
npm install
```

### Running the Editor (Local Web App)
```bash
npm run dev
```
Open the provided local URL (default: `http://localhost:5173`) in your browser.

### Building for Production
```bash
npm run build
```

---

## Testing & Verification

The project includes automated test suites covering the core engine, mathematical shapes, calibration models, regression tests, and reconstruction optimizer:

```bash
# Run all test suites
npm test

# Run individual test suites
node --experimental-strip-types test_engine.mjs
node --experimental-strip-types test_calibration.mjs
node --experimental-strip-types test_math_primitives.mjs
node --experimental-strip-types test_editor_regression.mjs
node --experimental-strip-types test_scoring.mjs
node --experimental-strip-types test_optimizer.mjs
node --experimental-strip-types test_multilayer.mjs

# Run held-out single-layer recovery benchmark (120 synthetic cases)
npm run test:heldout
```

---

## Status & Roadmap

- [x] **Milestone 1**: Authoritative Editor, 21:31 canvas, 130-layer limit, transform controls, square frame calibration, mathematical shape primitives.
- [x] **Milestone 2**: Headless multi-term image scorer with Lab color space and multi-resolution proxy evaluation.
- [x] **Milestone 3**: Single-layer optimizer with moment estimation, symmetry registry, anisotropic candidate generation, and hierarchical coordinate descent.
- [x] **Milestone 4**: Greedy multi-layer reconstruction engine (`MultiLayerReconstructor`), color-homogeneous residual analysis, candidate ranking, authoritative verification, local polish, and post-greedy layer reduction.
- [ ] **Milestone 5** (Planned): AutoLayer UI integration, interactive image upload, and crop workspace.

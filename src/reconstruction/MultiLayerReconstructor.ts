import type { Layer, ProjectData } from '../core/types.ts';
import { MAX_LAYERS } from '../core/types.ts';
import { DeterministicRenderer, type RenderMode } from '../core/Renderer.ts';
import { getShapeFrameCalibration } from '../core/ShapeFrameCalibration.ts';
import type {
  RasterImage,
  ReconstructionOptions,
  ReconstructionResult,
  AcceptedLayerRecord,
  ScoreResult,
  ScoreWeights,
  Resolution
} from './types.ts';
import { DEFAULT_SCORE_WEIGHTS } from './types.ts';
import {
  createHeadlessCanvas,
  renderLayersToRaster,
  type HeadlessCanvasInstance
} from './HeadlessRenderer.ts';
import { ImageScorer } from './ImageScorer.ts';
import {
  SingleLayerOptimizer,
  derivePrimitiveCalibration,
  type DerivedPrimitiveCalibration
} from './SingleLayerOptimizer.ts';
import { PRIMITIVE_SYMMETRIES, normalizeAngleDeg } from './Symmetry.ts';
import { ResidualAnalyzer, type ResidualRegion } from './ResidualAnalyzer.ts';

const DEFAULT_PRIMITIVES: readonly string[] = [
  'Circle',
  'Pill',
  'Rounded_Square',
  'Half_Circle',
  'Triangle',
  'Star',
  'Heart',
  'Baloon',
  'Moon_Curve',
  'Moon_Edge',
  'Glow',
  'Cross'
];

/**
 * Generates a deterministic hash/identifier for a set of ReconstructionOptions.
 */
function computeConfigHash(options: Required<Omit<ReconstructionOptions, 'onProgress' | 'saveDebugSnapshots'>>): string {
  const parts = [
    `maxL=${options.maxLayers}`,
    `minImp=${options.minImprovement}`,
    `sRes=${options.searchResolution.width}x${options.searchResolution.height}`,
    `vRes=${options.verificationResolution.width}x${options.verificationResolution.height}`,
    `polish=${options.enablePolish}`,
    `refInt=${options.refinementInterval}`,
    `reduct=${options.reductionEnabled}`,
    `redTol=${options.reductionTolerance}`,
    `seed=${options.seed}`,
    `topK=${options.topKFinalists}`,
    `mode=${options.renderMode}`
  ];
  let h = 0x811c9dc5;
  const str = parts.join('|');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Checks if a point (nx, ny) in normalized canvas coordinates is covered by a layer.
 */
function isPointInLayer(
  layer: Layer,
  nx: number,
  ny: number,
  canvasW: number,
  canvasH: number
): boolean {
  if (!layer.visible || layer.opacity <= 0.05) return false;

  const calib = getShapeFrameCalibration(layer.shapeAsset);
  const frameNormSize = calib ? calib.frameNormalizedSize : 450 / 567;
  const nativeFrameSize = canvasW * frameNormSize;

  const frameW = nativeFrameSize * Math.max(0.01, layer.scaleX);
  const frameH = nativeFrameSize * Math.max(0.01, layer.scaleY);

  const cx = layer.x * canvasW;
  const cy = layer.y * canvasH;
  const px = nx * canvasW;
  const py = ny * canvasH;

  const dx = px - cx;
  const dy = py - cy;

  const rad = (layer.rotation * Math.PI) / 180.0;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);

  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  return Math.abs(lx) <= frameW * 0.5 && Math.abs(ly) <= frameH * 0.5;
}

/**
 * Finds the top-most layer in currentLayers that covers (nx, ny).
 */
function findDominantCoveringLayerIndex(
  layers: readonly Layer[],
  nx: number,
  ny: number,
  canvasW: number,
  canvasH: number
): number {
  for (let i = layers.length - 1; i >= 0; i--) {
    if (isPointInLayer(layers[i], nx, ny, canvasW, canvasH)) {
      return i;
    }
  }
  return -1;
}

/**
 * Converts layers to a standard .e7profile.json ProjectData structure.
 */
export function createProjectFromLayers(
  layers: Layer[],
  projectName = 'Reconstructed Profile'
): ProjectData {
  return {
    version: 1,
    name: projectName,
    canvas: {
      aspectRatio: '21:31',
      aspectRatioWidth: 21,
      aspectRatioHeight: 31,
      backgroundColor: '#141721'
    },
    layers,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Greedy Multi-Layer Reconstruction Engine (Milestone 4).
 * Progressively constructs an authoritative Epic Seven composition to reconstruct a target image.
 */
export class MultiLayerReconstructor {
  /**
   * Reconstructs an Epic Seven shape composition from a target image.
   */
  public static reconstruct(
    target: RasterImage,
    options: ReconstructionOptions = {}
  ): ReconstructionResult {
    const startTime = Date.now();

    // 1. Resolve configuration with defaults
    const resolved = {
      maxLayers: Math.min(MAX_LAYERS, options.maxLayers ?? MAX_LAYERS),
      minImprovement: options.minImprovement ?? 0.003,
      searchResolution: options.searchResolution ?? { width: 105, height: 155 },
      verificationResolution: options.verificationResolution ?? { width: 210, height: 310 },
      enablePolish: options.enablePolish ?? true,
      refinementInterval: options.refinementInterval ?? 4,
      reductionEnabled: options.reductionEnabled ?? true,
      reductionTolerance: options.reductionTolerance ?? 0.002,
      seed: options.seed ?? 42,
      timeoutMs: options.timeoutMs ?? 60000,
      topKFinalists: options.topKFinalists ?? 4,
      allowedPrimitives: options.allowedPrimitives ? [...options.allowedPrimitives] : [...DEFAULT_PRIMITIVES],
      weights: options.weights ?? DEFAULT_SCORE_WEIGHTS,
      renderMode: (options.renderMode ?? 'mathematical') as RenderMode
    };

    const configHash = computeConfigHash(resolved);

    // 2. Prepare resolution targets
    const verW = resolved.verificationResolution.width;
    const verH = resolved.verificationResolution.height;
    const sw = resolved.searchResolution.width;
    const sh = resolved.searchResolution.height;

    const verificationTarget = (target.width === verW && target.height === verH)
      ? target
      : SingleLayerOptimizer.resampleImage(target, verW, verH);

    const searchTarget = SingleLayerOptimizer.resampleImage(verificationTarget, sw, sh);

    // 3. Pre-allocate headless canvases for search & incremental composition
    const baseSearchCanvas: HeadlessCanvasInstance = createHeadlessCanvas(sw, sh);
    const scratchCanvas: HeadlessCanvasInstance = createHeadlessCanvas(sw, sh);
    const layerCanvas: HeadlessCanvasInstance = createHeadlessCanvas(sw, sh);

    // Initial empty composition state
    let currentLayers: Layer[] = [];

    // Authoritative verification render of empty canvas
    let currentVerificationRender = renderLayersToRaster(currentLayers, verW, verH, {
      backgroundColor: 'transparent',
      renderMode: resolved.renderMode
    });
    let currentVerificationScore = ImageScorer.score(verificationTarget, currentVerificationRender, resolved.weights);

    // Search render of empty canvas
    baseSearchCanvas.ctx.clearRect(0, 0, sw, sh);
    let currentSearchRender = baseSearchCanvas.getImageData();
    let currentSearchScore = ImageScorer.score(searchTarget, currentSearchRender, resolved.weights);

    // Diagnostic tracking
    let fastCandidatesEvaluated = 0;
    let finalistsEvaluated = 0;
    let authoritativeRenders = 1;
    let acceptedLayersCount = 0;
    let rejectedCandidatesCount = 0;
    const history: AcceptedLayerRecord[] = [];
    let stopReason: 'max_layers' | 'no_improvement' | 'timeout' | 'target_matched' = 'no_improvement';

    const calibTable: DerivedPrimitiveCalibration = derivePrimitiveCalibration();

    let iteration = 0;

    // 4. Main Greedy Reconstruction Loop
    while (currentLayers.length < resolved.maxLayers) {
      if (Date.now() - startTime >= resolved.timeoutMs) {
        stopReason = 'timeout';
        break;
      }

      if (currentVerificationScore.totalLoss <= 0.001) {
        stopReason = 'target_matched';
        break;
      }

      iteration++;
      const iterStartTime = Date.now();

      // Step A: Residual analysis on search resolution
      let residual = ResidualAnalyzer.analyze(searchTarget, currentSearchRender, {
        residualThreshold: 0.14,
        maxRegions: 6
      });

      if (residual.regions.length === 0) {
        // Fallback with lower threshold to catch subtle remaining residuals
        residual = ResidualAnalyzer.analyze(searchTarget, currentSearchRender, {
          residualThreshold: 0.08,
          maxRegions: 4
        });
      }

      if (residual.regions.length === 0 || residual.totalResidualMass < 0.5) {
        stopReason = 'no_improvement';
        break;
      }

      // Step B: Generate candidate layers for discovered residual regions
      interface EvaluatedCandidate {
        layer: Layer;
        insertIndex: number;
        fastScore: ScoreResult;
        fastImprovement: number;
        symmetryOrder: number;
      }

      const candidatePool: EvaluatedCandidate[] = [];

      for (const region of residual.regions) {
        if (Date.now() - startTime >= resolved.timeoutMs) break;

        const candidatesForRegion = this.generateCandidatesForRegion(
          region,
          sw,
          sh,
          resolved.allowedPrimitives,
          calibTable,
          iteration
        );

        // Determine Z-order insertion positions for this region
        const insertPositions: number[] = [currentLayers.length]; // 1. Top
        if (currentLayers.length > 0) {
          insertPositions.push(0); // 2. Bottom

          // 3. Directly above dominant covering layer (if any)
          const dominantCoverIdx = findDominantCoveringLayerIndex(
            currentLayers,
            region.normalizedCentroid.x,
            region.normalizedCentroid.y,
            sw,
            sh
          );
          if (dominantCoverIdx >= 0 && dominantCoverIdx < currentLayers.length - 1) {
            insertPositions.push(dominantCoverIdx + 1);
          }
        }

        // Fast Candidate Evaluation
        for (const candLayer of candidatesForRegion) {
          if (Date.now() - startTime >= resolved.timeoutMs) break;

          for (const insertIdx of insertPositions) {
            fastCandidatesEvaluated++;

            let candRaster: RasterImage;

            if (insertIdx === currentLayers.length) {
              // Top insertion: composite candLayer directly on baseSearchCanvas
              scratchCanvas.ctx.clearRect(0, 0, sw, sh);
              if (currentLayers.length > 0) {
                scratchCanvas.ctx.drawImage(baseSearchCanvas.canvas, 0, 0);
              }
              layerCanvas.ctx.clearRect(0, 0, sw, sh);
              DeterministicRenderer.render(layerCanvas.ctx, [candLayer], {
                width: sw,
                height: sh,
                backgroundColor: 'transparent',
                renderMode: resolved.renderMode
              });
              scratchCanvas.ctx.drawImage(layerCanvas.canvas, 0, 0);
              candRaster = scratchCanvas.getImageData();
            } else if (insertIdx === 0) {
              // Bottom insertion: composite baseSearchCanvas on top of candLayer
              scratchCanvas.ctx.clearRect(0, 0, sw, sh);
              layerCanvas.ctx.clearRect(0, 0, sw, sh);
              DeterministicRenderer.render(layerCanvas.ctx, [candLayer], {
                width: sw,
                height: sh,
                backgroundColor: 'transparent',
                renderMode: resolved.renderMode
              });
              scratchCanvas.ctx.drawImage(layerCanvas.canvas, 0, 0);
              if (currentLayers.length > 0) {
                scratchCanvas.ctx.drawImage(baseSearchCanvas.canvas, 0, 0);
              }
              candRaster = scratchCanvas.getImageData();
            } else {
              // Intermediate insertion: composite full proposed stack
              const proposed = [
                ...currentLayers.slice(0, insertIdx),
                candLayer,
                ...currentLayers.slice(insertIdx)
              ];
              scratchCanvas.ctx.clearRect(0, 0, sw, sh);
              DeterministicRenderer.render(scratchCanvas.ctx, proposed, {
                width: sw,
                height: sh,
                backgroundColor: 'transparent',
                renderMode: resolved.renderMode
              });
              candRaster = scratchCanvas.getImageData();
            }

            const fastScore = ImageScorer.score(searchTarget, candRaster, resolved.weights);
            const fastImprovement = currentSearchScore.totalLoss - fastScore.totalLoss;

            if (fastImprovement > 0) {
              const sym = PRIMITIVE_SYMMETRIES[candLayer.shapeAsset];
              const symmetryOrder = sym ? (sym.type === 'continuous' ? 99 : (sym.rotationalPeriodDeg === 90 ? 4 : (sym.rotationalPeriodDeg === 180 ? 2 : 1))) : 1;

              candidatePool.push({
                layer: candLayer,
                insertIndex: insertIdx,
                fastScore,
                fastImprovement,
                symmetryOrder
              });
            }
          }
        }
      }

      if (candidatePool.length === 0) {
        stopReason = 'no_improvement';
        break;
      }

      // Step C: Rank candidates deterministically
      candidatePool.sort((a, b) => {
        const diff = b.fastImprovement - a.fastImprovement;
        if (Math.abs(diff) <= 0.0025) {
          // Occam's tie-breaking: prefer higher symmetry for near-identical fast improvements
          if (b.symmetryOrder !== a.symmetryOrder) return b.symmetryOrder - a.symmetryOrder;
        }
        if (Math.abs(diff) > 1e-5) return diff;
        // Prefer top insertion
        if (b.insertIndex !== a.insertIndex) return b.insertIndex - a.insertIndex;
        // Deterministic primitive name order
        return a.layer.shapeAsset.localeCompare(b.layer.shapeAsset);
      });

      // Step D: Authoritative Verification on Top Finalists — pick best verified candidate
      const finalists = candidatePool.slice(0, resolved.topKFinalists);
      let acceptedFinalist: EvaluatedCandidate | null = null;
      let acceptedScore: ScoreResult | null = null;
      let acceptedVerifiedImprovement = 0;

      for (const finalist of finalists) {
        if (Date.now() - startTime >= resolved.timeoutMs) break;

        finalistsEvaluated++;

        const proposedStack = [
          ...currentLayers.slice(0, finalist.insertIndex),
          finalist.layer,
          ...currentLayers.slice(finalist.insertIndex)
        ];

        authoritativeRenders++;
        const verifiedRender = renderLayersToRaster(proposedStack, verW, verH, {
          backgroundColor: 'transparent',
          renderMode: resolved.renderMode
        });
        const verifiedScore = ImageScorer.score(verificationTarget, verifiedRender, resolved.weights);
        const verifiedImprovement = currentVerificationScore.totalLoss - verifiedScore.totalLoss;

        if (verifiedImprovement >= resolved.minImprovement) {
          if (!acceptedFinalist || verifiedImprovement > acceptedVerifiedImprovement + 1e-4) {
            acceptedFinalist = finalist;
            acceptedScore = verifiedScore;
            acceptedVerifiedImprovement = verifiedImprovement;
          }
        } else {
          rejectedCandidatesCount++;
        }
      }

      if (!acceptedFinalist || !acceptedScore) {
        stopReason = 'no_improvement';
        break;
      }

      // Step E: Accept candidate and commit to composition
      let layerToCommit = acceptedFinalist.layer;
      const insertIndex = acceptedFinalist.insertIndex;

      // Optional quick coordinate polish on native resolution
      if (resolved.enablePolish) {
        const polished = this.quickPolishCandidate(
          layerToCommit,
          insertIndex,
          currentLayers,
          verificationTarget,
          verW,
          verH,
          acceptedScore.totalLoss,
          resolved.weights,
          resolved.renderMode
        );
        if (polished.score.totalLoss < acceptedScore.totalLoss) {
          layerToCommit = polished.layer;
          acceptedScore = polished.score;
          acceptedVerifiedImprovement = currentVerificationScore.totalLoss - acceptedScore.totalLoss;
        }
      }

      currentLayers = [
        ...currentLayers.slice(0, insertIndex),
        layerToCommit,
        ...currentLayers.slice(insertIndex)
      ];

      currentVerificationScore = acceptedScore;

      // Update cached base search render
      baseSearchCanvas.ctx.clearRect(0, 0, sw, sh);
      DeterministicRenderer.render(baseSearchCanvas.ctx, currentLayers, {
        width: sw,
        height: sh,
        backgroundColor: 'transparent',
        renderMode: resolved.renderMode
      });
      currentSearchRender = baseSearchCanvas.getImageData();
      currentSearchScore = ImageScorer.score(searchTarget, currentSearchRender, resolved.weights);

      acceptedLayersCount++;

      const record: AcceptedLayerRecord = {
        iteration,
        shapeAsset: layerToCommit.shapeAsset,
        color: layerToCommit.color,
        x: layerToCommit.x,
        y: layerToCommit.y,
        scaleX: layerToCommit.scaleX,
        scaleY: layerToCommit.scaleY,
        rotation: layerToCommit.rotation,
        opacity: layerToCommit.opacity,
        zIndex: insertIndex,
        fastImprovement: Number(acceptedFinalist.fastImprovement.toFixed(4)),
        verifiedImprovement: Number(acceptedVerifiedImprovement.toFixed(4)),
        elapsedMs: Date.now() - iterStartTime
      };
      history.push(record);

      if (options.onProgress) {
        options.onProgress({
          iteration,
          currentLayerCount: currentLayers.length,
          currentScore: currentVerificationScore,
          lastImprovement: acceptedVerifiedImprovement,
          elapsedMs: Date.now() - startTime
        });
      }

      // Step F: Periodic Local Refinement on recent layers
      if (
        resolved.refinementInterval > 0 &&
        currentLayers.length % resolved.refinementInterval === 0 &&
        resolved.enablePolish
      ) {
        const refined = this.refineRecentLayers(
          currentLayers,
          verificationTarget,
          verW,
          verH,
          currentVerificationScore.totalLoss,
          resolved.weights,
          resolved.renderMode
        );
        if (refined.improved) {
          currentLayers = refined.layers;
          currentVerificationScore = refined.score;

          // Re-render search base canvas
          baseSearchCanvas.ctx.clearRect(0, 0, sw, sh);
          DeterministicRenderer.render(baseSearchCanvas.ctx, currentLayers, {
            width: sw,
            height: sh,
            backgroundColor: 'transparent',
            renderMode: resolved.renderMode
          });
          currentSearchRender = baseSearchCanvas.getImageData();
          currentSearchScore = ImageScorer.score(searchTarget, currentSearchRender, resolved.weights);
        }
      }
    }

    if (currentLayers.length >= resolved.maxLayers) {
      stopReason = 'max_layers';
    }

    const layersBeforeReduction = currentLayers.length;
    let reductionLayersRemoved = 0;

    // 5. Post-Reconstruction Reduction Pass (Section 21)
    if (resolved.reductionEnabled && currentLayers.length > 1) {
      const reductionResult = this.runReductionPass(
        currentLayers,
        verificationTarget,
        verW,
        verH,
        currentVerificationScore.totalLoss,
        resolved.reductionTolerance,
        resolved.weights,
        resolved.renderMode
      );
      currentLayers = reductionResult.layers;
      currentVerificationScore = reductionResult.score;
      reductionLayersRemoved = layersBeforeReduction - currentLayers.length;
    }

    const totalElapsedMs = Date.now() - startTime;

    return {
      layers: currentLayers,
      finalScore: currentVerificationScore,
      diagnostics: {
        configHash,
        totalElapsedMs,
        fastCandidatesEvaluated,
        finalistsEvaluated,
        authoritativeRenders,
        acceptedLayersCount,
        rejectedCandidatesCount,
        reductionLayersRemoved,
        layersBeforeReduction,
        layersAfterReduction: currentLayers.length,
        initialScore: ImageScorer.score(verificationTarget, renderLayersToRaster([], verW, verH), resolved.weights),
        finalScore: currentVerificationScore,
        history,
        stopReason
      }
    };
  }

  /**
   * Generates candidate layers from a discovered residual region.
   */
  private static generateCandidatesForRegion(
    region: ResidualRegion,
    sw: number,
    sh: number,
    allowedPrimitives: readonly string[],
    calibTable: DerivedPrimitiveCalibration,
    iteration: number
  ): Layer[] {
    const candidates: Layer[] = [];

    const cx = region.normalizedCentroid.x;
    const cy = region.normalizedCentroid.y;
    const bw = Math.max(0.04, (region.bounds.maxX - region.bounds.minX + 1) / sw);
    const bh = Math.max(0.04, (region.bounds.maxY - region.bounds.minY + 1) / sh);

    const targetAlpha = Math.max(0.15, Math.min(1.0, region.meanTargetAlpha));

    for (const shapeId of allowedPrimitives) {
      const calib = getShapeFrameCalibration(shapeId);
      const frameNorm = calib ? calib.frameNormalizedSize : 450 / 567;
      const geomScaleX = calib ? calib.geometryScaleX : 0.8;
      const geomScaleY = calib ? calib.geometryScaleY : 0.8;

      const baseNormW = Math.max(0.01, frameNorm * geomScaleX);
      const baseNormH = Math.max(0.01, (21 / 31) * frameNorm * geomScaleY);

      // Baseline scale estimation from region bounding box and moments
      const boundSx = Math.max(0.08, bw / baseNormW);
      const boundSy = Math.max(0.08, bh / baseNormH);

      const unitR = calibTable.unitRadii[shapeId];
      const axis = calibTable.majorAxes[shapeId] || 'uniform';

      const candidateScales: [number, number][] = [
        [boundSx, boundSy],
        [boundSx * 1.08, boundSy * 1.08],
        [boundSx * 0.92, boundSy * 0.92]
      ];

      if (unitR) {
        if (axis === 'y') {
          const radSy = Math.max(0.08, region.normalizedRadii.major / unitR.major);
          const radSx = Math.max(0.08, region.normalizedRadii.minor / unitR.minor);
          candidateScales.push([radSx, radSy]);
          candidateScales.push([radSx * 1.08, radSy * 0.92]);
        } else if (axis === 'x') {
          const radSx = Math.max(0.08, region.normalizedRadii.major / unitR.major);
          const radSy = Math.max(0.08, region.normalizedRadii.minor / unitR.minor);
          candidateScales.push([radSx, radSy]);
          candidateScales.push([radSx * 0.92, radSy * 1.08]);
        } else {
          // Isotropic / uniform primitive (Circle, Rounded_Square, Star, Glow, Cross)
          const s = Math.max(0.08, (region.normalizedRadii.major + region.normalizedRadii.minor) / (unitR.major + unitR.minor));
          const sMajor = Math.max(0.08, region.normalizedRadii.major / unitR.major);
          const sMinor = Math.max(0.08, region.normalizedRadii.minor / unitR.minor);
          candidateScales.push([s, s]);
          candidateScales.push([sMajor, sMinor]);
          candidateScales.push([sMinor, sMajor]);
        }
      }

      const sym = PRIMITIVE_SYMMETRIES[shapeId];
      const unitOrient = calibTable.unitOrientations[shapeId] ?? 0;
      const estAngle = normalizeAngleDeg(region.orientationDeg - unitOrient);

      let testAngles: number[];
      if (sym?.type === 'continuous') {
        testAngles = [0];
      } else if (shapeId === 'Star') {
        testAngles = [0, 18, 36, 54, 72];
      } else if (sym?.rotationalPeriodDeg === 90) {
        testAngles = [estAngle, normalizeAngleDeg(estAngle + 45), 0, 45];
      } else {
        testAngles = [
          estAngle,
          normalizeAngleDeg(estAngle + 90),
          normalizeAngleDeg(estAngle + 180),
          0,
          90
        ];
      }

      const off = calibTable.centroidOffsets[shapeId] || { dx: 0, dy: 0 };

      const testColors = [region.closestPaletteHex];
      if (region.secondaryPaletteHex && region.secondaryPaletteHex !== region.closestPaletteHex) {
        testColors.push(region.secondaryPaletteHex);
      }

      // Compact loop over colors, scales and angles
      for (const curColor of testColors) {
        for (const [sx, sy] of candidateScales) {
          for (const ang of testAngles) {
            const angleRad = (ang * Math.PI) / 180.0;
            const cOffX = sx * off.dx * Math.cos(angleRad) - sy * off.dy * (31 / 21) * Math.sin(angleRad);
            const cOffY = sx * off.dx * (21 / 31) * Math.sin(angleRad) + sy * off.dy * Math.cos(angleRad);

            const spawnX = Math.max(0.01, Math.min(0.99, cx - cOffX));
            const spawnY = Math.max(0.01, Math.min(0.99, cy - cOffY));

            candidates.push({
              id: `layer-${iteration}-${shapeId}-${candidates.length + 1}`,
              name: `${shapeId} ${iteration}`,
              shapeAsset: shapeId,
              x: Number(spawnX.toFixed(4)),
              y: Number(spawnY.toFixed(4)),
              scaleX: Number(sx.toFixed(4)),
              scaleY: Number(sy.toFixed(4)),
              rotation: Number(ang.toFixed(1)),
              color: curColor,
              opacity: Number(targetAlpha.toFixed(2)),
              visible: true,
              locked: false
            });
          }
        }
      }
    }

    return candidates;
  }

  /**
   * Fast coordinate polish on the candidate layer before committing to the composition.
   */
  private static quickPolishCandidate(
    layer: Layer,
    insertIndex: number,
    baseLayers: readonly Layer[],
    target: RasterImage,
    verW: number,
    verH: number,
    initialLoss: number,
    weights: ScoreWeights,
    renderMode: RenderMode
  ): { layer: Layer; score: ScoreResult } {
    let bestLayer = { ...layer };
    let bestLoss = initialLoss;
    let bestScore: ScoreResult = ImageScorer.score(
      target,
      renderLayersToRaster(
        [...baseLayers.slice(0, insertIndex), bestLayer, ...baseLayers.slice(insertIndex)],
        verW,
        verH,
        { backgroundColor: 'transparent', renderMode }
      ),
      weights
    );

    const steps = [
      { dPos: 0.012, dScale: 0.03, dRot: 3.0, dOp: 0.05 },
      { dPos: 0.005, dScale: 0.015, dRot: 1.5, dOp: 0.02 },
      { dPos: 0.002, dScale: 0.006, dRot: 0.8, dOp: 0.01 }
    ];

    for (const step of steps) {
      const deltas: [number, number, number, number, number, number][] = [
        [step.dPos, 0, 0, 0, 0, 0],
        [-step.dPos, 0, 0, 0, 0, 0],
        [0, step.dPos, 0, 0, 0, 0],
        [0, -step.dPos, 0, 0, 0, 0],
        [0, 0, step.dScale, step.dScale, 0, 0],
        [0, 0, -step.dScale, -step.dScale, 0, 0],
        [0, 0, step.dScale, 0, 0, 0],
        [0, 0, -step.dScale, 0, 0, 0],
        [0, 0, 0, step.dScale, 0, 0],
        [0, 0, 0, -step.dScale, 0, 0],
        [0, 0, 0, 0, step.dRot, 0],
        [0, 0, 0, 0, -step.dRot, 0],
        [0, 0, 0, 0, 0, step.dOp],
        [0, 0, 0, 0, 0, -step.dOp]
      ];

      for (const [dx, dy, dsx, dsy, drot, dop] of deltas) {
        const testLayer: Layer = {
          ...bestLayer,
          x: Math.max(0.01, Math.min(0.99, bestLayer.x + dx)),
          y: Math.max(0.01, Math.min(0.99, bestLayer.y + dy)),
          scaleX: Math.max(0.05, Math.min(4.0, bestLayer.scaleX + dsx)),
          scaleY: Math.max(0.05, Math.min(4.0, bestLayer.scaleY + dsy)),
          rotation: normalizeAngleDeg(bestLayer.rotation + drot),
          opacity: Math.max(0.05, Math.min(1.0, bestLayer.opacity + dop))
        };

        const stack = [...baseLayers.slice(0, insertIndex), testLayer, ...baseLayers.slice(insertIndex)];
        const render = renderLayersToRaster(stack, verW, verH, {
          backgroundColor: 'transparent',
          renderMode
        });
        const score = ImageScorer.score(target, render, weights);

        if (score.totalLoss < bestLoss - 1e-4) {
          bestLayer = testLayer;
          bestLoss = score.totalLoss;
          bestScore = score;
        }
      }
    }

    return { layer: bestLayer, score: bestScore };
  }

  /**
   * Refines recently accepted layers via coordinate descent.
   */
  private static refineRecentLayers(
    layers: Layer[],
    target: RasterImage,
    verW: number,
    verH: number,
    currentLoss: number,
    weights: ScoreWeights,
    renderMode: RenderMode
  ): { improved: boolean; layers: Layer[]; score: ScoreResult } {
    let workingLayers = [...layers];
    let workingLoss = currentLoss;
    let workingScore = ImageScorer.score(
      target,
      renderLayersToRaster(workingLayers, verW, verH, { backgroundColor: 'transparent', renderMode }),
      weights
    );
    let overallImproved = false;

    // Refine the last 2 layers
    const targetIndices = [workingLayers.length - 1];
    if (workingLayers.length >= 2) targetIndices.push(workingLayers.length - 2);

    const step = { dPos: 0.008, dScale: 0.02, dRot: 2.0 };

    for (const idx of targetIndices) {
      const checks: [number, number, number, number, number][] = [
        [step.dPos, 0, 0, 0, 0],
        [-step.dPos, 0, 0, 0, 0],
        [0, step.dPos, 0, 0, 0],
        [0, -step.dPos, 0, 0, 0],
        [0, 0, step.dScale, step.dScale, 0],
        [0, 0, -step.dScale, -step.dScale, 0],
        [0, 0, 0, 0, step.dRot],
        [0, 0, 0, 0, -step.dRot]
      ];

      for (const [dx, dy, dsx, dsy, drot] of checks) {
        const original = workingLayers[idx];
        const modified: Layer = {
          ...original,
          x: Math.max(0.01, Math.min(0.99, original.x + dx)),
          y: Math.max(0.01, Math.min(0.99, original.y + dy)),
          scaleX: Math.max(0.05, Math.min(4.0, original.scaleX + dsx)),
          scaleY: Math.max(0.05, Math.min(4.0, original.scaleY + dsy)),
          rotation: normalizeAngleDeg(original.rotation + drot)
        };

        const testStack = [...workingLayers];
        testStack[idx] = modified;

        const render = renderLayersToRaster(testStack, verW, verH, {
          backgroundColor: 'transparent',
          renderMode
        });
        const score = ImageScorer.score(target, render, weights);

        if (score.totalLoss < workingLoss - 1e-4) {
          workingLayers[idx] = modified;
          workingLoss = score.totalLoss;
          workingScore = score;
          overallImproved = true;
        }
      }
    }

    return {
      improved: overallImproved,
      layers: workingLayers,
      score: workingScore
    };
  }

  /**
   * Post-greedy reduction pass to prune redundant or low-contribution layers with drift safety.
   * Ensures cumulative degradation cannot exceed reductionTolerance relative to the baseline start-of-pass loss.
   */
  public static reduceLayers(
    layers: Layer[],
    target: RasterImage,
    options: {
      reductionTolerance?: number;
      verificationResolution?: Resolution;
      weights?: ScoreWeights;
      renderMode?: RenderMode;
    } = {}
  ): { layers: Layer[]; score: ScoreResult; prunedCount: number } {
    const verW = options.verificationResolution?.width || 210;
    const verH = options.verificationResolution?.height || 310;
    const weights = options.weights || DEFAULT_SCORE_WEIGHTS;
    const renderMode = options.renderMode || 'mathematical';
    const tolerance = options.reductionTolerance ?? 0.002;

    const initialRender = renderLayersToRaster(layers, verW, verH, { backgroundColor: 'transparent', renderMode });
    const initialScore = ImageScorer.score(target, initialRender, weights);

    const result = this.runReductionPass(
      layers,
      target,
      verW,
      verH,
      initialScore.totalLoss,
      tolerance,
      weights,
      renderMode
    );

    const reindexed = result.layers.map((l, idx) => ({ ...l, zIndex: idx }));
    return {
      layers: reindexed,
      score: result.score,
      prunedCount: layers.length - reindexed.length
    };
  }

  /**
   * Internal reduction pass implementation using start-of-pass baseline loss anchor.
   */
  private static runReductionPass(
    layers: Layer[],
    target: RasterImage,
    verW: number,
    verH: number,
    initialLoss: number,
    reductionTolerance: number,
    weights: ScoreWeights,
    renderMode: RenderMode
  ): { layers: Layer[]; score: ScoreResult } {
    let workingLayers = [...layers];
    let workingLoss = initialLoss;
    // Explicit baseline anchor: total visual loss cannot exceed initial baseline + tolerance
    const maxAllowedLoss = initialLoss + reductionTolerance;
    let workingScore = ImageScorer.score(
      target,
      renderLayersToRaster(workingLayers, verW, verH, { backgroundColor: 'transparent', renderMode }),
      weights
    );

    let changed = true;
    while (changed && workingLayers.length > 1) {
      changed = false;

      // Calculate marginal loss regression for removing each layer
      let bestRemovalIdx = -1;
      let smallestDelta = Infinity;
      let candidateScoreForBest: ScoreResult | null = null;

      for (let i = 0; i < workingLayers.length; i++) {
        const withoutI = workingLayers.filter((_, idx) => idx !== i);
        const render = renderLayersToRaster(withoutI, verW, verH, {
          backgroundColor: 'transparent',
          renderMode
        });
        const score = ImageScorer.score(target, render, weights);
        const delta = score.totalLoss - workingLoss;

        if (delta < smallestDelta) {
          smallestDelta = delta;
          bestRemovalIdx = i;
          candidateScoreForBest = score;
        }
      }

      // Check if removing the least impactful layer is within the cumulative allowed tolerance
      if (
        bestRemovalIdx >= 0 &&
        candidateScoreForBest &&
        candidateScoreForBest.totalLoss <= maxAllowedLoss
      ) {
        workingLayers.splice(bestRemovalIdx, 1);
        workingLoss = candidateScoreForBest.totalLoss;
        workingScore = candidateScoreForBest;
        changed = true;
      }
    }

    return {
      layers: workingLayers,
      score: workingScore
    };
  }
}

/**
 * Top-level export matching the conceptual signature:
 * const result = reconstruct(target, options);
 */
export function reconstruct(
  target: RasterImage,
  options: ReconstructionOptions = {}
): ReconstructionResult {
  return MultiLayerReconstructor.reconstruct(target, options);
}

/**
 * Top-level export for post-greedy reduction pass with drift safety.
 */
export function reduceLayers(
  layers: Layer[],
  target: RasterImage,
  options: {
    reductionTolerance?: number;
    verificationResolution?: Resolution;
    weights?: ScoreWeights;
    renderMode?: RenderMode;
  } = {}
) {
  return MultiLayerReconstructor.reduceLayers(layers, target, options);
}

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
  Resolution,
  QualityCheckpoint,
  BackgroundMode
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
import type { RegionGraph, ImageRegion } from './RegionRepresentation.ts';
import { ImageSimplifier } from './ImageSimplifier.ts';
import { colorDifferenceNormalized } from './ColorSpaces.ts';

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
function computeConfigHash(options: Required<Omit<ReconstructionOptions, 'onProgress' | 'saveDebugSnapshots' | 'regionGraph' | 'simplificationOptions'>>): string {
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
    `mode=${options.renderMode}`,
    `simp=${options.useSimplification}`,
    `bg=${options.backgroundMode}`,
    `regW=${options.regionalWeight}`
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
      minImprovementFloor: options.minImprovementFloor ?? 0.0005,
      relativeImprovementFraction: options.relativeImprovementFraction ?? 0.15,
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
      renderMode: (options.renderMode ?? 'mathematical') as RenderMode,
      useSimplification: options.useSimplification ?? false,
      backgroundMode: (options.backgroundMode ?? 'reconstruct') as BackgroundMode,
      maxRegionsPerIteration: options.maxRegionsPerIteration ?? 12,
      regionalWeight: options.regionalWeight ?? 0.40,
      checkpoints: options.checkpoints ?? [10, 25, 50, 100, 130]
    };

    const configHash = computeConfigHash(resolved);

    // 2. Prepare resolution targets & region representation
    const verW = resolved.verificationResolution.width;
    const verH = resolved.verificationResolution.height;
    const sw = resolved.searchResolution.width;
    const sh = resolved.searchResolution.height;

    const verificationTarget = (target.width === verW && target.height === verH)
      ? target
      : SingleLayerOptimizer.resampleImage(target, verW, verH);

    let activeTarget = verificationTarget;
    let activeRegionGraph: RegionGraph | null = options.regionGraph ?? null;

    if (!activeRegionGraph && resolved.useSimplification) {
      const simpResult = ImageSimplifier.simplify(verificationTarget, {
        seed: resolved.seed,
        ...(options.simplificationOptions || {})
      });
      activeTarget = simpResult.simplified;
      activeRegionGraph = simpResult.regionGraph;
    }

    const searchTarget = SingleLayerOptimizer.resampleImage(activeTarget, sw, sh);

    // 3. Pre-allocate headless canvases for search & incremental composition
    const baseSearchCanvas: HeadlessCanvasInstance = createHeadlessCanvas(sw, sh);
    const scratchCanvas: HeadlessCanvasInstance = createHeadlessCanvas(sw, sh);
    const layerCanvas: HeadlessCanvasInstance = createHeadlessCanvas(sw, sh);

    // Precompute search pixel region map for fast regional scoring
    let searchPixelRegionMap: Int32Array | null = null;
    let imageRegions: ImageRegion[] = [];

    if (activeRegionGraph) {
      imageRegions = activeRegionGraph.regions;
      searchPixelRegionMap = new Int32Array(sw * sh);
      const origW = activeRegionGraph.width;
      const origH = activeRegionGraph.height;
      for (let y = 0; y < sh; y++) {
        const origY = Math.min(origH - 1, Math.floor((y * origH) / sh));
        const rowOffset = y * sw;
        const origRowOffset = origY * origW;
        for (let x = 0; x < sw; x++) {
          const origX = Math.min(origW - 1, Math.floor((x * origW) / sw));
          searchPixelRegionMap[rowOffset + x] = activeRegionGraph.pixelRegionMap[origRowOffset + origX];
        }
      }
    }

    function computePixelError(
      tData: Uint8ClampedArray | Uint8Array,
      cData: Uint8ClampedArray | Uint8Array,
      byteIdx: number
    ): number {
      const at = tData[byteIdx + 3] / 255.0;
      const ac = cData[byteIdx + 3] / 255.0;
      if (at < 0.02 && ac < 0.02) return 0.0;
      if (at >= 0.05 && ac >= 0.05) {
        const cDiff = colorDifferenceNormalized(
          { r: tData[byteIdx], g: tData[byteIdx + 1], b: tData[byteIdx + 2] },
          { r: cData[byteIdx], g: cData[byteIdx + 1], b: cData[byteIdx + 2] }
        );
        return Math.max(Math.abs(at - ac), cDiff * Math.min(at, ac));
      }
      return at >= 0.05 ? at : ac;
    }

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
    const checkpoints: QualityCheckpoint[] = [];
    let timingCandidateGenMs = 0;
    let timingFastEvalMs = 0;
    let timingVerificationMs = 0;
    let timingPolishMs = 0;
    let stopReason: 'max_layers' | 'no_improvement' | 'timeout' | 'target_matched' = 'no_improvement';

    const calibTable: DerivedPrimitiveCalibration = derivePrimitiveCalibration();

    let iteration = 0;

    interface EvaluatedCandidate {
      layer: Layer;
      insertIndex: number;
      fastScore: ScoreResult;
      fastImprovement: number;
      regionalImprovement: number;
      combinedImprovement: number;
      targetRegionId?: string;
      symmetryOrder: number;
    }

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

      if (resolved.checkpoints && resolved.checkpoints.includes(currentLayers.length)) {
        if (!checkpoints.some(c => c.layerCount === currentLayers.length)) {
          checkpoints.push({
            layerCount: currentLayers.length,
            globalLoss: currentVerificationScore.totalLoss,
            elapsedMs: Date.now() - startTime
          });
        }
      }

      const candidatePool: EvaluatedCandidate[] = [];

      if (imageRegions.length > 0 && searchPixelRegionMap) {
        // --- PATH A: REGION-DRIVEN CANDIDATE GENERATION (Phase 6) ---
        const tGen0 = Date.now();
        const rankedRegions: Array<{
          region: ImageRegion;
          regionIndex: number;
          importance: number;
          meanResidual: number;
          pixelCount: number;
        }> = [];

        for (let rIdx = 0; rIdx < imageRegions.length; rIdx++) {
          const r = imageRegions[rIdx];
          const minPx = Math.max(0, Math.floor(r.bounds.x * sw));
          const maxPx = Math.min(sw - 1, Math.ceil((r.bounds.x + r.bounds.width) * sw));
          const minPy = Math.max(0, Math.floor(r.bounds.y * sh));
          const maxPy = Math.min(sh - 1, Math.ceil((r.bounds.y + r.bounds.height) * sh));

          let rErrSum = 0;
          let rPixCount = 0;
          let weightedSumX = 0;
          let weightedSumY = 0;
          let weightTotal = 0;
          let errMinPx = sw;
          let errMaxPx = 0;
          let errMinPy = sh;
          let errMaxPy = 0;

          for (let y = minPy; y <= maxPy; y++) {
            const rowOffset = y * sw;
            for (let x = minPx; x <= maxPx; x++) {
              const pIdx = rowOffset + x;
              if (searchPixelRegionMap[pIdx] === rIdx) {
                const err = computePixelError(searchTarget.data, currentSearchRender.data, pIdx * 4);
                rErrSum += err;
                rPixCount++;
                if (err > 0.04) {
                  weightedSumX += x * err;
                  weightedSumY += y * err;
                  weightTotal += err;
                  if (x < errMinPx) errMinPx = x;
                  if (x > errMaxPx) errMaxPx = x;
                  if (y < errMinPy) errMinPy = y;
                  if (y > errMaxPy) errMaxPy = y;
                }
              }
            }
          }

          const meanRes = rPixCount > 0 ? rErrSum / rPixCount : 0;

          // If region is already well explained (mean residual < 0.035), de-prioritize
          if (meanRes < 0.035) continue;

          let effectiveRegion = r;
          if (currentLayers.length > 0 && weightTotal > 0 && errMaxPx >= errMinPx && errMaxPy >= errMinPy) {
            const resCx = weightedSumX / weightTotal;
            const resCy = weightedSumY / weightTotal;

            let mu20 = 0;
            let mu02 = 0;
            let mu11 = 0;
            for (let y = errMinPy; y <= errMaxPy; y++) {
              const rowOffset = y * sw;
              for (let x = errMinPx; x <= errMaxPx; x++) {
                const pIdx = rowOffset + x;
                if (searchPixelRegionMap[pIdx] === rIdx) {
                  const err = computePixelError(searchTarget.data, currentSearchRender.data, pIdx * 4);
                  if (err > 0.04) {
                    const dx = x - resCx;
                    const dy = y - resCy;
                    mu20 += dx * dx * err;
                    mu02 += dy * dy * err;
                    mu11 += dx * dy * err;
                  }
                }
              }
            }
            mu20 /= weightTotal;
            mu02 /= weightTotal;
            mu11 /= weightTotal;

            const delta = mu20 - mu02;
            const sqrtTerm = Math.sqrt(delta * delta + 4 * mu11 * mu11);
            const lambda1 = Math.max(0.1, (mu20 + mu02 + sqrtTerm) / 2);
            const lambda2 = Math.max(0.1, (mu20 + mu02 - sqrtTerm) / 2);
            const majorR = Math.max(1.0, 2.0 * Math.sqrt(lambda1));
            const minorR = Math.max(1.0, 2.0 * Math.sqrt(lambda2));
            const orientationRad = 0.5 * Math.atan2(2 * mu11, delta);
            const orientationDeg = (orientationRad * 180) / Math.PI;

            effectiveRegion = {
              ...r,
              centroid: { x: resCx / sw, y: resCy / sh },
              pixelCentroid: { x: resCx, y: resCy },
              bounds: {
                x: errMinPx / sw,
                y: errMinPy / sh,
                width: Math.max(0.02, (errMaxPx - errMinPx + 1) / sw),
                height: Math.max(0.02, (errMaxPy - errMinPy + 1) / sh)
              },
              pixelBounds: {
                minX: errMinPx,
                minY: errMinPy,
                maxX: errMaxPx,
                maxY: errMaxPy
              },
              normalizedRadii: {
                major: Math.max(0.02, majorR / sw),
                minor: Math.max(0.02, minorR / sw)
              },
              orientationDeg
            };
          }

          let importance = 0.35 * r.areaFraction + 0.30 * r.saliencyScore + 0.35 * meanRes;
          if (r.isPreservedDetail) importance += 0.25;
          if (r.isBackground) {
            if (resolved.backgroundMode === 'ignore' || resolved.backgroundMode === 'transparent') {
              continue;
            } else {
              importance *= 0.5; // De-prioritize background vs foreground
            }
          }

          rankedRegions.push({ region: effectiveRegion, regionIndex: rIdx, importance, meanResidual: meanRes, pixelCount: rPixCount });
        }

        rankedRegions.sort((a, b) => b.importance - a.importance);

        if (rankedRegions.length === 0) {
          stopReason = 'target_matched';
          break;
        }

        const topRegions = rankedRegions.slice(0, resolved.maxRegionsPerIteration);

        const regionProposals: Array<{
          region: ImageRegion;
          regionIndex: number;
          meanResidual: number;
          pixelCount: number;
          candidates: Layer[];
        }> = [];

        for (const tr of topRegions) {
          const cands = MultiLayerReconstructor.generateCandidatesForImageRegion(
            tr.region,
            sw,
            sh,
            resolved.allowedPrimitives,
            calibTable,
            iteration
          );
          regionProposals.push({
            region: tr.region,
            regionIndex: tr.regionIndex,
            meanResidual: tr.meanResidual,
            pixelCount: tr.pixelCount,
            candidates: cands
          });
        }
        timingCandidateGenMs += (Date.now() - tGen0);

        const tFast0 = Date.now();
        for (const prop of regionProposals) {
          if (Date.now() - startTime >= resolved.timeoutMs) break;

          const insertPositions: number[] = [currentLayers.length];
          if (currentLayers.length > 0) {
            insertPositions.push(0);
            const domCoverIdx = findDominantCoveringLayerIndex(
              currentLayers,
              prop.region.centroid.x,
              prop.region.centroid.y,
              sw,
              sh
            );
            if (domCoverIdx >= 0 && domCoverIdx < currentLayers.length - 1) {
              insertPositions.push(domCoverIdx + 1);
            }
          }

          const minPx = Math.max(0, Math.floor(prop.region.bounds.x * sw));
          const maxPx = Math.min(sw - 1, Math.ceil((prop.region.bounds.x + prop.region.bounds.width) * sw));
          const minPy = Math.max(0, Math.floor(prop.region.bounds.y * sh));
          const maxPy = Math.min(sh - 1, Math.ceil((prop.region.bounds.y + prop.region.bounds.height) * sh));

          for (const candLayer of prop.candidates) {
            if (Date.now() - startTime >= resolved.timeoutMs) break;

            for (const insertIdx of insertPositions) {
              fastCandidatesEvaluated++;

              let candRaster: RasterImage;
              if (insertIdx === currentLayers.length) {
                scratchCanvas.ctx.clearRect(0, 0, sw, sh);
                if (currentLayers.length > 0) scratchCanvas.ctx.drawImage(baseSearchCanvas.canvas, 0, 0);
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
                scratchCanvas.ctx.clearRect(0, 0, sw, sh);
                layerCanvas.ctx.clearRect(0, 0, sw, sh);
                DeterministicRenderer.render(layerCanvas.ctx, [candLayer], {
                  width: sw,
                  height: sh,
                  backgroundColor: 'transparent',
                  renderMode: resolved.renderMode
                });
                scratchCanvas.ctx.drawImage(layerCanvas.canvas, 0, 0);
                if (currentLayers.length > 0) scratchCanvas.ctx.drawImage(baseSearchCanvas.canvas, 0, 0);
                candRaster = scratchCanvas.getImageData();
              } else {
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

              // Measure regional improvement inside target region
              let candRegionErrSum = 0;
              let regPixCount = 0;
              for (let y = minPy; y <= maxPy; y++) {
                const rowOffset = y * sw;
                for (let x = minPx; x <= maxPx; x++) {
                  const pIdx = rowOffset + x;
                  if (searchPixelRegionMap[pIdx] === prop.regionIndex) {
                    candRegionErrSum += computePixelError(searchTarget.data, candRaster.data, pIdx * 4);
                    regPixCount++;
                  }
                }
              }
              const candMeanRes = regPixCount > 0 ? candRegionErrSum / regPixCount : 0;
              const regionalImprovement = prop.meanResidual - candMeanRes;

              // Combined ranking metric: combines global gain with local region fix
              const combinedImprovement = fastImprovement + resolved.regionalWeight * Math.max(0, regionalImprovement);

              if (combinedImprovement > 0 && (fastImprovement >= -0.005 || regionalImprovement >= 0.08)) {
                const sym = PRIMITIVE_SYMMETRIES[candLayer.shapeAsset];
                const symmetryOrder = sym ? (sym.type === 'continuous' ? 99 : (sym.rotationalPeriodDeg === 90 ? 4 : (sym.rotationalPeriodDeg === 180 ? 2 : 1))) : 1;

                candidatePool.push({
                  layer: candLayer,
                  insertIndex: insertIdx,
                  fastScore,
                  fastImprovement,
                  regionalImprovement,
                  combinedImprovement,
                  targetRegionId: prop.region.id,
                  symmetryOrder
                });
              }
            }
          }
        }
        timingFastEvalMs += (Date.now() - tFast0);
      } else {
        // --- PATH B: FALLBACK RESIDUAL BFS (when no RegionGraph available) ---
        const tGen0 = Date.now();
        let residual = ResidualAnalyzer.analyze(searchTarget, currentSearchRender, {
          residualThreshold: 0.14,
          maxRegions: 6
        });

        if (residual.regions.length === 0) {
          residual = ResidualAnalyzer.analyze(searchTarget, currentSearchRender, {
            residualThreshold: 0.08,
            maxRegions: 4
          });
        }

        if (residual.regions.length === 0 || residual.totalResidualMass < 0.5) {
          stopReason = 'no_improvement';
          break;
        }

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

          const insertPositions: number[] = [currentLayers.length];
          if (currentLayers.length > 0) {
            insertPositions.push(0);
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

          for (const candLayer of candidatesForRegion) {
            if (Date.now() - startTime >= resolved.timeoutMs) break;

            for (const insertIdx of insertPositions) {
              fastCandidatesEvaluated++;

              let candRaster: RasterImage;
              if (insertIdx === currentLayers.length) {
                scratchCanvas.ctx.clearRect(0, 0, sw, sh);
                if (currentLayers.length > 0) scratchCanvas.ctx.drawImage(baseSearchCanvas.canvas, 0, 0);
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
                scratchCanvas.ctx.clearRect(0, 0, sw, sh);
                layerCanvas.ctx.clearRect(0, 0, sw, sh);
                DeterministicRenderer.render(layerCanvas.ctx, [candLayer], {
                  width: sw,
                  height: sh,
                  backgroundColor: 'transparent',
                  renderMode: resolved.renderMode
                });
                scratchCanvas.ctx.drawImage(layerCanvas.canvas, 0, 0);
                if (currentLayers.length > 0) scratchCanvas.ctx.drawImage(baseSearchCanvas.canvas, 0, 0);
                candRaster = scratchCanvas.getImageData();
              } else {
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
                  regionalImprovement: 0,
                  combinedImprovement: fastImprovement,
                  symmetryOrder
                });
              }
            }
          }
        }
        timingCandidateGenMs += (Date.now() - tGen0);
      }

      if (candidatePool.length === 0) {
        stopReason = 'no_improvement';
        break;
      }

      // Step C: Rank candidates deterministically
      candidatePool.sort((a, b) => {
        const diff = b.combinedImprovement - a.combinedImprovement;
        if (Math.abs(diff) <= 0.0025) {
          if (b.symmetryOrder !== a.symmetryOrder) return b.symmetryOrder - a.symmetryOrder;
        }
        if (Math.abs(diff) > 1e-5) return diff;
        if (b.insertIndex !== a.insertIndex) return b.insertIndex - a.insertIndex;
        return a.layer.shapeAsset.localeCompare(b.layer.shapeAsset);
      });

      // Step D: Authoritative Verification on Top Finalists — pick best verified candidate
      const tVer0 = Date.now();
      const finalists = candidatePool.slice(0, resolved.topKFinalists);
      let acceptedFinalist: EvaluatedCandidate | null = null;
      let acceptedScore: ScoreResult | null = null;
      let acceptedVerifiedImprovement = 0;

      const effectiveMinImprovement = resolved.relativeImprovementFraction > 0
        ? Math.max(
            resolved.minImprovementFloor,
            Math.min(
              resolved.minImprovement,
              currentVerificationScore.totalLoss * resolved.relativeImprovementFraction
            )
          )
        : resolved.minImprovement;

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

        const passesAcceptance = verifiedImprovement >= effectiveMinImprovement ||
          (finalist.regionalImprovement >= 0.12 && verifiedImprovement >= resolved.minImprovementFloor);

        if (passesAcceptance) {
          if (!acceptedFinalist || verifiedImprovement > acceptedVerifiedImprovement + 1e-4) {
            acceptedFinalist = finalist;
            acceptedScore = verifiedScore;
            acceptedVerifiedImprovement = verifiedImprovement;
          }
        } else {
          rejectedCandidatesCount++;
        }
      }
      timingVerificationMs += (Date.now() - tVer0);

      if (!acceptedFinalist || !acceptedScore) {
        stopReason = 'no_improvement';
        break;
      }

      // Step E: Accept candidate and commit to composition
      let layerToCommit = acceptedFinalist.layer;
      const insertIndex = acceptedFinalist.insertIndex;

      // Optional quick coordinate polish on native resolution
      if (resolved.enablePolish) {
        const tPol0 = Date.now();
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
        timingPolishMs += (Date.now() - tPol0);
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
        targetRegionId: acceptedFinalist.targetRegionId,
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
        checkpoints,
        timingBreakdownMs: {
          candidateGenMs: timingCandidateGenMs,
          fastEvalMs: timingFastEvalMs,
          verificationMs: timingVerificationMs,
          polishMs: timingPolishMs,
          totalMs: totalElapsedMs
        },
        stopReason
      }
    };
  }

  /**
   * Generates candidate layers from a coherent ImageRegion produced by ImageSimplifier.
   */
  public static generateCandidatesForImageRegion(
    region: ImageRegion,
    _sw: number,
    _sh: number,
    allowedPrimitives: readonly string[],
    calibTable: DerivedPrimitiveCalibration,
    iteration: number
  ): Layer[] {
    const candidates: Layer[] = [];

    // Background region proposal: cover entire canvas with background rectangle
    if (region.isBackground) {
      candidates.push({
        id: `layer-${iteration}-bg-1`,
        name: `Background ${iteration}`,
        shapeAsset: 'Rounded_Square',
        x: 0.5,
        y: 0.5,
        scaleX: 2.0,
        scaleY: 2.8,
        rotation: 0,
        color: region.paletteHex,
        opacity: 1.0,
        visible: true,
        locked: false
      });
      candidates.push({
        id: `layer-${iteration}-bg-2`,
        name: `Background ${iteration}`,
        shapeAsset: 'Square',
        x: 0.5,
        y: 0.5,
        scaleX: 2.0,
        scaleY: 2.8,
        rotation: 0,
        color: region.paletteHex,
        opacity: 1.0,
        visible: true,
        locked: false
      });
      return candidates;
    }

    const cx = region.centroid.x;
    const cy = region.centroid.y;
    const majR = region.normalizedRadii.major;
    const minR = region.normalizedRadii.minor;
    const estAspect = minR > 1e-4 ? majR / minR : 1.0;

    // Rank primitives by aspect ratio compatibility
    const scoredPrimitives: Array<{ shapeId: string; score: number }> = [];
    for (const shapeId of allowedPrimitives) {
      const unitR = calibTable.unitRadii[shapeId];
      if (!unitR) continue;
      const primAspect = unitR.minor > 1e-4 ? unitR.major / unitR.minor : 1.0;
      const aspectDiff = Math.abs(estAspect - primAspect);
      scoredPrimitives.push({ shapeId, score: aspectDiff });
    }
    scoredPrimitives.sort((a, b) => a.score - b.score);

    // Shortlist: Top 3 aspect-compatible + versatile shapes
    const shortlistSet = new Set<string>();
    for (const item of scoredPrimitives.slice(0, 3)) {
      shortlistSet.add(item.shapeId);
    }
    for (const v of ['Circle', 'Rounded_Square', 'Pill', 'Triangle']) {
      if (allowedPrimitives.includes(v)) {
        shortlistSet.add(v);
      }
    }

    const testColors = [region.paletteHex];
    const targetAlpha = 1.0;

    for (const shapeId of shortlistSet) {
      const unitR = calibTable.unitRadii[shapeId];
      const axis = calibTable.majorAxes[shapeId] || 'uniform';

      const candidateScales: [number, number][] = [];
      if (unitR) {
        let baseSx: number;
        let baseSy: number;
        if (axis === 'y') {
          baseSy = Math.max(0.08, majR / unitR.major);
          baseSx = Math.max(0.08, minR / unitR.minor);
        } else if (axis === 'x') {
          baseSx = Math.max(0.08, majR / unitR.major);
          baseSy = Math.max(0.08, minR / unitR.minor);
        } else {
          baseSx = Math.max(0.08, (majR + minR) / (unitR.major + unitR.minor));
          baseSy = baseSx;
          const sMaj = Math.max(0.08, majR / unitR.major);
          const sMin = Math.max(0.08, minR / unitR.minor);
          candidateScales.push([sMaj, sMin]);
          candidateScales.push([sMin, sMaj]);
          candidateScales.push([sMaj * 1.10, sMin * 1.10]);
          candidateScales.push([sMin * 1.10, sMaj * 1.10]);
          candidateScales.push([sMaj * 0.70, sMin * 0.70]);
          candidateScales.push([sMin * 0.70, sMaj * 0.70]);
        }

        candidateScales.push([baseSx, baseSy]);
        candidateScales.push([baseSx * 1.10, baseSy * 1.10]);
        candidateScales.push([baseSx * 0.90, baseSy * 0.90]);
        candidateScales.push([baseSx * 0.70, baseSy * 0.70]);
        candidateScales.push([baseSy, baseSx]);
        candidateScales.push([baseSy * 1.10, baseSx * 1.10]);
        candidateScales.push([baseSy * 0.90, baseSx * 0.90]);
        candidateScales.push([baseSy * 0.70, baseSx * 0.70]);
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
        testAngles = [estAngle, normalizeAngleDeg(estAngle + 45), 0];
      } else {
        testAngles = [
          estAngle,
          normalizeAngleDeg(estAngle + 90),
          normalizeAngleDeg(estAngle + 180),
          0
        ];
      }

      const off = calibTable.centroidOffsets[shapeId] || { dx: 0, dy: 0 };

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

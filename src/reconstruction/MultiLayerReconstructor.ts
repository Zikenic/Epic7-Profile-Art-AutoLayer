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
import { colorDifferenceNormalized, hexToRgb, rgbToLab } from './ColorSpaces.ts';

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
 * Computes foreground-weighted loss using a normalized foreground spatial mask.
 */
function computeForegroundWeightedLoss(
  tRaster: RasterImage,
  cRaster: RasterImage,
  mask: Float32Array
): number {
  const total = tRaster.width * tRaster.height;
  const tData = tRaster.data;
  const cData = cRaster.data;
  let wSum = 0;
  let errSum = 0;
  for (let i = 0; i < total; i++) {
    const w = mask[i];
    if (w <= 0.001) continue;
    const byteIdx = i * 4;
    const at = tData[byteIdx + 3] / 255.0;
    const ac = cData[byteIdx + 3] / 255.0;
    let err = 0.0;
    if (at < 0.02 && ac < 0.02) {
      err = 0.0;
    } else if (at >= 0.05 && ac >= 0.05) {
      const rgbT = { r: tData[byteIdx], g: tData[byteIdx + 1], b: tData[byteIdx + 2] };
      const rgbC = { r: cData[byteIdx], g: cData[byteIdx + 1], b: cData[byteIdx + 2] };
      const cDiff = colorDifferenceNormalized(rgbT, rgbC);
      const aDiff = Math.abs(at - ac);
      err = Math.max(aDiff, cDiff * Math.min(at, ac));
    } else {
      err = at >= 0.05 ? at : ac;
    }
    errSum += err * w;
    wSum += w;
  }
  return wSum > 0.001 ? errSum / wSum : 0.0;
}

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
    `regW=${options.regionalWeight}`,
    `fgW=${options.foregroundWeight}`,
    `glW=${options.globalWeight}`,
    `maxCand=${options.maxCandidatesPerIteration}`
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
      maxCandidatesPerIteration: options.maxCandidatesPerIteration ?? 64,
      globalWeight: options.globalWeight ?? 0.25,
      foregroundWeight: options.foregroundWeight ?? 0.45,
      regionalWeight: options.regionalWeight ?? 0.30,
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

    // Build explicit foreground masks for search and verification resolutions (Phase 7)
    const searchForegroundMask = new Float32Array(sw * sh);
    const verForegroundMask = new Float32Array(verW * verH);

    if (activeRegionGraph && searchPixelRegionMap) {
      for (let i = 0; i < sw * sh; i++) {
        const rIdx = searchPixelRegionMap[i];
        if (rIdx >= 0 && rIdx < imageRegions.length) {
          const r = imageRegions[rIdx];
          const w_f = r.isBackground ? 0.0 : Math.min(1.0, 0.35 + 0.45 * r.saliencyScore + (r.isPreservedDetail ? 0.35 : 0.0));
          const at = searchTarget.data[i * 4 + 3] / 255.0;
          searchForegroundMask[i] = w_f * at;
        } else {
          searchForegroundMask[i] = searchTarget.data[i * 4 + 3] / 255.0;
        }
      }

      const origW = activeRegionGraph.width;
      const origH = activeRegionGraph.height;
      for (let y = 0; y < verH; y++) {
        const origY = Math.min(origH - 1, Math.floor((y * origH) / verH));
        const rowOffset = y * verW;
        const origRowOffset = origY * origW;
        for (let x = 0; x < verW; x++) {
          const origX = Math.min(origW - 1, Math.floor((x * origW) / verW));
          const rIdx = activeRegionGraph.pixelRegionMap[origRowOffset + origX];
          const pIdx = rowOffset + x;
          if (rIdx >= 0 && rIdx < imageRegions.length) {
            const r = imageRegions[rIdx];
            const w_f = r.isBackground ? 0.0 : Math.min(1.0, 0.35 + 0.45 * r.saliencyScore + (r.isPreservedDetail ? 0.35 : 0.0));
            const at = verificationTarget.data[pIdx * 4 + 3] / 255.0;
            verForegroundMask[pIdx] = w_f * at;
          } else {
            verForegroundMask[pIdx] = verificationTarget.data[pIdx * 4 + 3] / 255.0;
          }
        }
      }
    } else {
      for (let i = 0; i < sw * sh; i++) {
        const at = searchTarget.data[i * 4 + 3] / 255.0;
        searchForegroundMask[i] = at >= 0.05 ? 1.0 : 0.0;
      }
      for (let i = 0; i < verW * verH; i++) {
        const at = verificationTarget.data[i * 4 + 3] / 255.0;
        verForegroundMask[i] = at >= 0.05 ? 1.0 : 0.0;
      }
    }

    // Initial empty composition state
    let currentLayers: Layer[] = [];

    // Authoritative verification render of empty canvas
    let currentVerificationRender = renderLayersToRaster(currentLayers, verW, verH, {
      backgroundColor: 'transparent',
      renderMode: resolved.renderMode
    });
    let currentVerificationScore = ImageScorer.score(verificationTarget, currentVerificationRender, resolved.weights);
    let currentVerForegroundLoss = computeForegroundWeightedLoss(
      verificationTarget,
      currentVerificationRender,
      verForegroundMask
    );

    // Search render of empty canvas
    baseSearchCanvas.ctx.clearRect(0, 0, sw, sh);
    let currentSearchRender = baseSearchCanvas.getImageData();
    let currentSearchScore = ImageScorer.score(searchTarget, currentSearchRender, resolved.weights);
    let currentSearchForegroundLoss = computeForegroundWeightedLoss(
      searchTarget,
      currentSearchRender,
      searchForegroundMask
    );

    // Diagnostic tracking
    let fastCandidatesEvaluated = 0;
    let finalistsEvaluated = 0;
    let authoritativeRenders = 1;
    let acceptedLayersCount = 0;
    let rejectedCandidatesCount = 0;
    let hasBackgroundLayerPlaced = false;
    const history: AcceptedLayerRecord[] = [];
    const checkpoints: QualityCheckpoint[] = [];
    let timingCandidateGenMs = 0;
    let timingCandidateScreeningMs = 0;
    let timingFastEvalMs = 0;
    let timingVerificationMs = 0;
    let timingPolishMs = 0;
    let timingResidualSplitMs = 0;
    let stopReason: 'max_layers' | 'no_improvement' | 'timeout' | 'target_matched' = 'no_improvement';

    const calibTable: DerivedPrimitiveCalibration = derivePrimitiveCalibration();

    let iteration = 0;

    interface ActiveProposal {
      id: string;
      sourceRegionId: string;
      sourceRegionIndex: number;
      subRegionId?: string;
      centroid: { x: number; y: number };
      normalizedRadii: { major: number; minor: number };
      bounds: { x: number; y: number; width: number; height: number };
      pixelBounds: { minX: number; minY: number; maxX: number; maxY: number };
      orientationDeg: number;
      paletteHex: string;
      alternativePaletteHexes: string[];
      meanResidual: number;
      pixelCount: number;
      importance: number;
      saliency: number;
      isBackground: boolean;
      isPreservedDetail: boolean;
    }

    let activeProposals: ActiveProposal[] = [];
    if (imageRegions.length > 0 && searchPixelRegionMap) {
      for (let rIdx = 0; rIdx < imageRegions.length; rIdx++) {
        const r = imageRegions[rIdx];
        if (r.isBackground && (resolved.backgroundMode === 'ignore' || resolved.backgroundMode === 'transparent')) {
          continue;
        }

        const minPx = Math.max(0, Math.floor(r.bounds.x * sw));
        const maxPx = Math.min(sw - 1, Math.ceil((r.bounds.x + r.bounds.width) * sw));
        const minPy = Math.max(0, Math.floor(r.bounds.y * sh));
        const maxPy = Math.min(sh - 1, Math.ceil((r.bounds.y + r.bounds.height) * sh));
        let rErrSum = 0;
        let rCount = 0;
        for (let y = minPy; y <= maxPy; y++) {
          const rowOff = y * sw;
          for (let x = minPx; x <= maxPx; x++) {
            const pix = rowOff + x;
            if (searchPixelRegionMap[pix] === rIdx) {
              rErrSum += computePixelError(searchTarget.data, currentSearchRender.data, pix * 4);
              rCount++;
            }
          }
        }
        const initialMeanRes = rCount > 0 ? rErrSum / rCount : 1.0;
        let baseImp = r.isBackground ? 0.25 : (0.35 * r.areaFraction + 0.35 * r.saliencyScore + 0.30);
        if (r.isPreservedDetail) baseImp += 0.30;

        activeProposals.push({
          id: `prop-${r.id}-init`,
          sourceRegionId: r.id,
          sourceRegionIndex: rIdx,
          centroid: { ...r.centroid },
          normalizedRadii: { ...r.normalizedRadii },
          bounds: { ...r.bounds },
          pixelBounds: { ...r.pixelBounds },
          orientationDeg: r.orientationDeg,
          paletteHex: r.paletteHex,
          alternativePaletteHexes: [],
          meanResidual: initialMeanRes,
          pixelCount: r.pixelCount,
          importance: baseImp,
          saliency: r.saliencyScore,
          isBackground: r.isBackground,
          isPreservedDetail: r.isPreservedDetail
        });
      }
    }

    interface EvaluatedCandidate {
      layer: Layer;
      insertIndex: number;
      fastScore: ScoreResult;
      fastImprovement: number;
      foregroundImprovement: number;
      regionalImprovement: number;
      utility: number;
      combinedImprovement: number;
      targetRegionId?: string;
      targetRegionIndex?: number;
      symmetryOrder: number;
    }

    // 4. Main Greedy Reconstruction Loop
    while (currentLayers.length < resolved.maxLayers) {
      if (Date.now() - startTime >= resolved.timeoutMs) {
        stopReason = 'timeout';
        break;
      }

      if (currentVerificationScore.totalLoss <= 0.001 && currentVerForegroundLoss <= 0.02) {
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
            foregroundLoss: currentVerForegroundLoss,
            elapsedMs: Date.now() - startTime
          });
        }
      }

      const candidatePool: EvaluatedCandidate[] = [];

      if (activeProposals.length > 0 && searchPixelRegionMap) {
        // --- PATH A: TRUE MULTI-SHAPE RESIDUAL DRIVEN RECONSTRUCTION (Phase 7) ---
        const tGen0 = Date.now();

        // 1. Calculate active proposal priorities
        const rankedProposals = activeProposals
          .filter(p => p.meanResidual >= 0.035)
          .map(p => {
            const areaWeight = Math.sqrt(Math.max(0.0001, p.bounds.width * p.bounds.height));
            let priority = (areaWeight * 0.70 + p.importance * 0.30) * p.meanResidual;
            if (p.isBackground && hasBackgroundLayerPlaced) {
              priority *= 0.005;
            } else if (p.isBackground && !hasBackgroundLayerPlaced && resolved.backgroundMode === 'reconstruct') {
              priority = 999.0;
            }
            return { proposal: p, priority };
          });

        rankedProposals.sort((a, b) => b.priority - a.priority);

        if (rankedProposals.length === 0) {
          if (currentVerForegroundLoss <= 0.03) {
            stopReason = 'target_matched';
          } else {
            stopReason = 'no_improvement';
          }
          break;
        }

        const topProposals = rankedProposals
          .slice(0, resolved.maxRegionsPerIteration)
          .map(rp => rp.proposal);

        // 2. Generate candidate shapes for each top proposal
        interface UnscreenedCandidate {
          layer: Layer;
          insertIdx: number;
          proposal: ActiveProposal;
          minPx: number;
          maxPx: number;
          minPy: number;
          maxPy: number;
          cheapScore: number;
        }

        const unscreenedPool: UnscreenedCandidate[] = [];

        for (const prop of topProposals) {
          const cands = MultiLayerReconstructor.generateCandidatesForProposal(
            prop,
            sw,
            sh,
            resolved.allowedPrimitives,
            calibTable,
            iteration
          );

          const insertPositions: number[] = [currentLayers.length];
          if (currentLayers.length > 0) {
            insertPositions.push(0);
            const domCoverIdx = findDominantCoveringLayerIndex(
              currentLayers,
              prop.centroid.x,
              prop.centroid.y,
              sw,
              sh
            );
            if (domCoverIdx >= 0 && domCoverIdx < currentLayers.length - 1) {
              insertPositions.push(domCoverIdx + 1);
            }
          }

          const minPx = Math.max(0, Math.floor(prop.bounds.x * sw));
          const maxPx = Math.min(sw - 1, Math.ceil((prop.bounds.x + prop.bounds.width) * sw));
          const minPy = Math.max(0, Math.floor(prop.bounds.y * sh));
          const maxPy = Math.min(sh - 1, Math.ceil((prop.bounds.y + prop.bounds.height) * sh));

          const propRgb = hexToRgb(prop.paletteHex);
          const propLab = rgbToLab(propRgb);

          for (const candLayer of cands) {
            const candRgb = hexToRgb(candLayer.color);
            const candLab = rgbToLab(candRgb);
            const dL = candLab.L - propLab.L;
            const da = candLab.a - propLab.a;
            const db = candLab.b - propLab.b;
            const dE = Math.sqrt(dL * dL + da * da + db * db);

            const majR = prop.normalizedRadii.major;
            const minR = prop.normalizedRadii.minor;
            const estAspect = minR > 1e-4 ? majR / minR : 1.0;
            const unitR = calibTable.unitRadii[candLayer.shapeAsset];
            const primAspect = unitR && unitR.minor > 1e-4 ? unitR.major / unitR.minor : 1.0;
            const aspectDiff = Math.abs(estAspect - primAspect);

            const propAreaWeight = Math.sqrt(Math.max(0.0001, prop.bounds.width * prop.bounds.height));
            for (const insertIdx of insertPositions) {
              let basePriority = (propAreaWeight * 0.70 + prop.importance * 0.30) * prop.meanResidual * (prop.isPreservedDetail ? 1.5 : 1.0);
              if (prop.isBackground && !hasBackgroundLayerPlaced && resolved.backgroundMode === 'reconstruct') {
                basePriority = 999.0;
              } else if (prop.isBackground && hasBackgroundLayerPlaced) {
                basePriority *= 0.005;
              }

              let insertBonus = 1.0;
              if (prop.isBackground && insertIdx === 0) insertBonus = 1.25;
              else if (!prop.isBackground && insertIdx === currentLayers.length) insertBonus = 1.15;

              const cheapScore = (basePriority * insertBonus) / (1.0 + aspectDiff * 0.5 + dE * 0.05);

              unscreenedPool.push({
                layer: candLayer,
                insertIdx,
                proposal: prop,
                minPx,
                maxPx,
                minPy,
                maxPy,
                cheapScore
              });
            }
          }
        }
        timingCandidateGenMs += (Date.now() - tGen0);

        // Stage A Cheap Screening: Select top candidates within maxCandidatesPerIteration
        const tScreen0 = Date.now();
        unscreenedPool.sort((a, b) => b.cheapScore - a.cheapScore);

        const candidateCap = resolved.maxCandidatesPerIteration;
        const screenedPool: UnscreenedCandidate[] = [];
        const shapeCounts = new Map<string, number>();

        // Ensure diversity: distribute quota among primitives for each proposal
        for (const item of unscreenedPool) {
          if (screenedPool.length >= candidateCap) break;
          const key = `${item.proposal.id}-${item.layer.shapeAsset}`;
          const count = shapeCounts.get(key) || 0;
          if (count < 4) {
            screenedPool.push(item);
            shapeCounts.set(key, count + 1);
          }
        }
        if (screenedPool.length < candidateCap) {
          for (const item of unscreenedPool) {
            if (screenedPool.length >= candidateCap) break;
            if (!screenedPool.includes(item)) {
              screenedPool.push(item);
            }
          }
        }
        timingCandidateScreeningMs += (Date.now() - tScreen0);

        // 3. Fast candidate scoring (Stage B: Canvas rendering & ImageScorer)
        const tFast0 = Date.now();
        for (const item of screenedPool) {
          if (Date.now() - startTime >= resolved.timeoutMs) break;
          const candLayer = item.layer;
          const insertIdx = item.insertIdx;
          const prop = item.proposal;
          const minPx = item.minPx;
          const maxPx = item.maxPx;
          const minPy = item.minPy;
          const maxPy = item.maxPy;

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
          const fastGlobalImp = currentSearchScore.totalLoss - fastScore.totalLoss;

          const candFgLoss = computeForegroundWeightedLoss(searchTarget, candRaster, searchForegroundMask);
          const fastFgImp = currentSearchForegroundLoss - candFgLoss;

          // Measure regional improvement inside target region
          let candRegionErrSum = 0;
          let regPixCount = 0;
          for (let y = minPy; y <= maxPy; y++) {
            const rowOffset = y * sw;
            for (let x = minPx; x <= maxPx; x++) {
              const pIdx = rowOffset + x;
              if (searchPixelRegionMap[pIdx] === prop.sourceRegionIndex) {
                candRegionErrSum += computePixelError(searchTarget.data, candRaster.data, pIdx * 4);
                regPixCount++;
              }
            }
          }
          const candMeanRes = regPixCount > 0 ? candRegionErrSum / regPixCount : 0;
          const regionalImprovement = prop.meanResidual - candMeanRes;

          // Candidate Utility Formula (Phase 7 Section 9)
          const utility = prop.isBackground
            ? fastGlobalImp + resolved.regionalWeight * Math.max(0, regionalImprovement)
            : resolved.globalWeight * fastGlobalImp +
              resolved.foregroundWeight * fastFgImp +
              resolved.regionalWeight * Math.max(0, regionalImprovement);

          if (utility > 0 && (fastGlobalImp >= -0.005 || regionalImprovement >= 0.08 || fastFgImp >= 0.005)) {
            const sym = PRIMITIVE_SYMMETRIES[candLayer.shapeAsset];
            const symmetryOrder = sym ? (sym.type === 'continuous' ? 99 : (sym.rotationalPeriodDeg === 90 ? 4 : (sym.rotationalPeriodDeg === 180 ? 2 : 1))) : 1;

            candidatePool.push({
              layer: candLayer,
              insertIndex: insertIdx,
              fastScore,
              fastImprovement: fastGlobalImp,
              foregroundImprovement: fastFgImp,
              regionalImprovement,
              utility,
              combinedImprovement: utility,
              targetRegionId: prop.sourceRegionId,
              targetRegionIndex: prop.sourceRegionIndex,
              symmetryOrder
            });
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
                  foregroundImprovement: fastImprovement,
                  regionalImprovement: 0,
                  utility: fastImprovement,
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
        stopReason = Date.now() - startTime >= resolved.timeoutMs ? 'timeout' : 'no_improvement';
        break;
      }

      // Step C: Rank candidates deterministically by utility
      candidatePool.sort((a, b) => {
        const diff = b.utility - a.utility;
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
      let acceptedFgLoss = currentVerForegroundLoss;
      let acceptedVerifiedImp = 0;
      let acceptedVerifiedUtility = 0;

      const effectiveMinImprovement = resolved.relativeImprovementFraction > 0
        ? Math.max(
            resolved.minImprovementFloor,
            Math.min(
              resolved.minImprovement,
              currentVerificationScore.totalLoss * resolved.relativeImprovementFraction
            )
          )
        : resolved.minImprovement;

      const effectiveFgMinImprovement = resolved.relativeImprovementFraction > 0
        ? Math.max(
            resolved.minImprovementFloor,
            Math.min(
              resolved.minImprovement,
              currentVerForegroundLoss * resolved.relativeImprovementFraction
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
        const verGlobalImp = currentVerificationScore.totalLoss - verifiedScore.totalLoss;

        const verifiedFgLoss = computeForegroundWeightedLoss(verificationTarget, verifiedRender, verForegroundMask);
        const verFgImp = currentVerForegroundLoss - verifiedFgLoss;

        const isBgFinalist = finalist.targetRegionIndex !== undefined && imageRegions[finalist.targetRegionIndex]?.isBackground;
        const verifiedUtility = activeRegionGraph
          ? (isBgFinalist
              ? verGlobalImp + resolved.regionalWeight * Math.max(0, finalist.regionalImprovement)
              : resolved.globalWeight * verGlobalImp +
                resolved.foregroundWeight * verFgImp +
                resolved.regionalWeight * Math.max(0, finalist.regionalImprovement))
          : verGlobalImp;

        const passesAcceptance = activeRegionGraph
          ? (verGlobalImp >= effectiveMinImprovement ||
             (finalist.regionalImprovement >= 0.08 && verGlobalImp >= -0.002) ||
             (verFgImp >= effectiveFgMinImprovement && verGlobalImp >= -0.002))
          : (verGlobalImp >= effectiveMinImprovement);

        if (passesAcceptance) {
          if (!acceptedFinalist || verifiedUtility > acceptedVerifiedUtility + 1e-4) {
            acceptedFinalist = finalist;
            acceptedScore = verifiedScore;
            acceptedFgLoss = verifiedFgLoss;
            acceptedVerifiedImp = verGlobalImp;
            acceptedVerifiedUtility = verifiedUtility;
          }
        } else {
          rejectedCandidatesCount++;
        }
      }
      timingVerificationMs += (Date.now() - tVer0);

      if (!acceptedFinalist || !acceptedScore) {
        stopReason = Date.now() - startTime >= resolved.timeoutMs ? 'timeout' : 'no_improvement';
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
          acceptedVerifiedImp = currentVerificationScore.totalLoss - acceptedScore.totalLoss;
          acceptedFgLoss = computeForegroundWeightedLoss(
            verificationTarget,
            renderLayersToRaster([
              ...currentLayers.slice(0, insertIndex),
              layerToCommit,
              ...currentLayers.slice(insertIndex)
            ], verW, verH, { backgroundColor: 'transparent', renderMode: resolved.renderMode }),
            verForegroundMask
          );
        }
        timingPolishMs += (Date.now() - tPol0);
      }

      currentLayers = [
        ...currentLayers.slice(0, insertIndex),
        layerToCommit,
        ...currentLayers.slice(insertIndex)
      ];

      if (layerToCommit.name.startsWith('Background') || (acceptedFinalist.targetRegionIndex !== undefined && imageRegions[acceptedFinalist.targetRegionIndex]?.isBackground)) {
        hasBackgroundLayerPlaced = true;
      }

      currentVerificationScore = acceptedScore;
      currentVerForegroundLoss = acceptedFgLoss;

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
      currentSearchForegroundLoss = computeForegroundWeightedLoss(
        searchTarget,
        currentSearchRender,
        searchForegroundMask
      );

      // Step F: Residual Splitting & Active Proposals Queue Update (Phase 7)
      if (activeRegionGraph && searchPixelRegionMap && acceptedFinalist.targetRegionIndex !== undefined) {
        const tSplit0 = Date.now();
        const targetedIdx = acceptedFinalist.targetRegionIndex;
        const parentRegion = imageRegions[targetedIdx];

        if (parentRegion) {
          // Decompose remaining residual inside this parent region
          const subRegions = ResidualAnalyzer.splitRegionResidual(
            searchTarget,
            currentSearchRender,
            parentRegion,
            targetedIdx,
            searchPixelRegionMap,
            {
              residualThreshold: 0.06,
              minPixels: 6,
              minMass: 0.5,
              maxSubRegions: 4
            }
          );

          // Remove old active proposals for this parent region
          activeProposals = activeProposals.filter(p => p.sourceRegionIndex !== targetedIdx);

          // Add newly discovered residual sub-regions to active pool
          for (const sub of subRegions) {
            if (sub.meanResidual >= 0.035) {
              activeProposals.push({
                id: sub.id,
                sourceRegionId: parentRegion.id,
                sourceRegionIndex: targetedIdx,
                subRegionId: sub.id,
                centroid: sub.centroid,
                normalizedRadii: sub.normalizedRadii,
                bounds: sub.normalizedBounds,
                pixelBounds: sub.bounds,
                orientationDeg: sub.orientationDeg,
                paletteHex: sub.dominantPaletteHex,
                alternativePaletteHexes: sub.alternativePaletteHexes,
                meanResidual: sub.meanResidual,
                pixelCount: sub.pixelCount,
                importance: sub.importance,
                saliency: parentRegion.saliencyScore,
                isBackground: false,
                isPreservedDetail: parentRegion.isPreservedDetail
              });
            }
          }
        }

        // Update mean residual for other active proposals
        for (let pIdx = activeProposals.length - 1; pIdx >= 0; pIdx--) {
          const prop = activeProposals[pIdx];
          if (prop.sourceRegionIndex === targetedIdx) continue;
          let errSum = 0;
          let count = 0;
          const minPx = Math.max(0, Math.floor(prop.bounds.x * sw));
          const maxPx = Math.min(sw - 1, Math.ceil((prop.bounds.x + prop.bounds.width) * sw));
          const minPy = Math.max(0, Math.floor(prop.bounds.y * sh));
          const maxPy = Math.min(sh - 1, Math.ceil((prop.bounds.y + prop.bounds.height) * sh));
          for (let y = minPy; y <= maxPy; y++) {
            const rowOff = y * sw;
            for (let x = minPx; x <= maxPx; x++) {
              const pix = rowOff + x;
              if (searchPixelRegionMap[pix] === prop.sourceRegionIndex) {
                errSum += computePixelError(searchTarget.data, currentSearchRender.data, pix * 4);
                count++;
              }
            }
          }
          if (count > 0) {
            prop.meanResidual = errSum / count;
            if (prop.meanResidual < 0.035 && !prop.isBackground) {
              activeProposals.splice(pIdx, 1);
            }
          }
        }

        timingResidualSplitMs += (Date.now() - tSplit0);
      }

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
        verifiedImprovement: Number(acceptedVerifiedImp.toFixed(4)),
        targetRegionId: acceptedFinalist.targetRegionId,
        elapsedMs: Date.now() - iterStartTime
      };
      history.push(record);

      if (options.onProgress) {
        options.onProgress({
          iteration,
          currentLayerCount: currentLayers.length,
          currentScore: currentVerificationScore,
          lastImprovement: acceptedVerifiedImp,
          elapsedMs: Date.now() - startTime
        });
      }

      // Step G: Periodic Local Refinement on recent layers
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
          currentVerForegroundLoss = computeForegroundWeightedLoss(
            verificationTarget,
            renderLayersToRaster(currentLayers, verW, verH, { backgroundColor: 'transparent', renderMode: resolved.renderMode }),
            verForegroundMask
          );

          baseSearchCanvas.ctx.clearRect(0, 0, sw, sh);
          DeterministicRenderer.render(baseSearchCanvas.ctx, currentLayers, {
            width: sw,
            height: sh,
            backgroundColor: 'transparent',
            renderMode: resolved.renderMode
          });
          currentSearchRender = baseSearchCanvas.getImageData();
          currentSearchScore = ImageScorer.score(searchTarget, currentSearchRender, resolved.weights);
          currentSearchForegroundLoss = computeForegroundWeightedLoss(
            searchTarget,
            currentSearchRender,
            searchForegroundMask
          );
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
        resolved.renderMode,
        verForegroundMask,
        currentVerForegroundLoss
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
        foregroundWeightedLoss: currentVerForegroundLoss,
        history,
        checkpoints,
        timingBreakdownMs: {
          candidateGenMs: timingCandidateGenMs,
          candidateScreeningMs: timingCandidateScreeningMs,
          fastEvalMs: timingFastEvalMs,
          verificationMs: timingVerificationMs,
          polishMs: timingPolishMs,
          residualSplitMs: timingResidualSplitMs,
          totalMs: totalElapsedMs
        },
        stopReason
      }
    };
  }

  /**
   * Generates candidate layers from a proposal (initial region or residual sub-region).
   * Multi-color support: generates candidates using dominant and alternative palette colors.
   */
  public static generateCandidatesForProposal(
    prop: {
      centroid: { x: number; y: number };
      normalizedRadii: { major: number; minor: number };
      orientationDeg: number;
      paletteHex: string;
      alternativePaletteHexes?: string[];
      isBackground: boolean;
      sourceRegionId?: string;
    },
    _sw: number,
    _sh: number,
    allowedPrimitives: readonly string[],
    calibTable: DerivedPrimitiveCalibration,
    iteration: number
  ): Layer[] {
    const candidates: Layer[] = [];

    // Background region proposal: cover entire canvas with background rectangle
    if (prop.isBackground) {
      candidates.push({
        id: `layer-${iteration}-bg-1`,
        name: `Background ${iteration}`,
        shapeAsset: 'Rounded_Square',
        x: 0.5,
        y: 0.5,
        scaleX: 2.0,
        scaleY: 2.8,
        rotation: 0,
        color: prop.paletteHex,
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
        color: prop.paletteHex,
        opacity: 1.0,
        visible: true,
        locked: false
      });
      return candidates;
    }

    const cx = prop.centroid.x;
    const cy = prop.centroid.y;
    const majR = prop.normalizedRadii.major;
    const minR = prop.normalizedRadii.minor;
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

    const testColors = [prop.paletteHex];
    if (prop.alternativePaletteHexes) {
      for (const alt of prop.alternativePaletteHexes.slice(0, 2)) {
        if (!testColors.includes(alt)) testColors.push(alt);
      }
    }
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
      const estAngle = normalizeAngleDeg(prop.orientationDeg - unitOrient);

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
   * Generates candidate layers from a coherent ImageRegion produced by ImageSimplifier.
   */
  public static generateCandidatesForImageRegion(
    region: ImageRegion,
    sw: number,
    sh: number,
    allowedPrimitives: readonly string[],
    calibTable: DerivedPrimitiveCalibration,
    iteration: number
  ): Layer[] {
    return this.generateCandidatesForProposal(
      {
        centroid: region.centroid,
        normalizedRadii: region.normalizedRadii,
        orientationDeg: region.orientationDeg,
        paletteHex: region.paletteHex,
        alternativePaletteHexes: [],
        isBackground: region.isBackground,
        sourceRegionId: region.id
      },
      sw,
      sh,
      allowedPrimitives,
      calibTable,
      iteration
    );
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
   * Safeguarded by foreground-weighted loss to protect delicate foreground structures.
   */
  private static runReductionPass(
    layers: Layer[],
    target: RasterImage,
    verW: number,
    verH: number,
    initialLoss: number,
    reductionTolerance: number,
    weights: ScoreWeights,
    renderMode: RenderMode,
    foregroundMask?: Float32Array,
    initialFgLoss?: number
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
        let allowed = true;
        if (foregroundMask && initialFgLoss !== undefined) {
          const withoutI = workingLayers.filter((_, idx) => idx !== bestRemovalIdx);
          const candRender = renderLayersToRaster(withoutI, verW, verH, {
            backgroundColor: 'transparent',
            renderMode
          });
          const candFgLoss = computeForegroundWeightedLoss(target, candRender, foregroundMask);
          if (candFgLoss > initialFgLoss + reductionTolerance * 1.5) {
            allowed = false; // Foreground degradation safeguard
          }
        }

        if (allowed) {
          workingLayers.splice(bestRemovalIdx, 1);
          workingLoss = candidateScoreForBest.totalLoss;
          workingScore = candidateScoreForBest;
          changed = true;
        }
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

import type { Layer } from '../core/types.ts';
import { getShapeFrameCalibration } from '../core/ShapeFrameCalibration.ts';
import type {
  RasterImage,
  OptimizerOptions,
  OptimizerResult,
  ScoreResult
} from './types.ts';
import { DEFAULT_SCORE_WEIGHTS, EPIC7_PALETTE_HEX } from './types.ts';
import { renderSingleLayerToRaster } from './HeadlessRenderer.ts';
import { ImageScorer } from './ImageScorer.ts';
import { computeImageMoments } from './ImageMoments.ts';
import { PRIMITIVE_SYMMETRIES, normalizeAngleDeg } from './Symmetry.ts';

const ALL_PRIMITIVES = [
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

export interface DerivedPrimitiveCalibration {
  centroidOffsets: Record<string, { dx: number; dy: number }>;
  unitRadii: Record<string, { major: number; minor: number }>;
  unitOrientations: Record<string, number>;
  majorAxes: Record<string, 'x' | 'y' | 'uniform'>;
}

let cachedCalibration: DerivedPrimitiveCalibration | null = null;

/**
 * Dynamically derives center-of-mass offsets, principal unit radii, intrinsic PCA orientations,
 * and elongation axes directly from the authoritative Epic Seven renderer.
 * Computed once lazily and cached.
 */
export function derivePrimitiveCalibration(): DerivedPrimitiveCalibration {
  if (cachedCalibration) {
    return cachedCalibration;
  }

  // Anchor grid discretizations relative to centered unit circle
  const refCircleLayer: Layer = {
    id: 'calib-ref-circle',
    name: 'Circle',
    shapeAsset: 'Circle',
    x: 0.5,
    y: 0.5,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    color: '#ffffff',
    opacity: 1.0,
    visible: true,
    locked: false
  };
  const refRaster = renderSingleLayerToRaster(refCircleLayer, 105, 155, {
    backgroundColor: 'transparent',
    renderMode: 'mathematical'
  });
  const refMoments = computeImageMoments(refRaster);
  const refCenter = refMoments.normalizedCentroid;

  const centroidOffsets: Record<string, { dx: number; dy: number }> = {};
  const unitRadii: Record<string, { major: number; minor: number }> = {};
  const unitOrientations: Record<string, number> = {};
  const majorAxes: Record<string, 'x' | 'y' | 'uniform'> = {};

  for (const shapeId of ALL_PRIMITIVES) {
    const layer: Layer = {
      id: `calib-${shapeId}`,
      name: shapeId,
      shapeAsset: shapeId,
      x: 0.5,
      y: 0.5,
      scaleX: 1.0,
      scaleY: 1.0,
      rotation: 0,
      color: '#ffffff',
      opacity: 1.0,
      visible: true,
      locked: false
    };

    const raster = renderSingleLayerToRaster(layer, 105, 155, {
      backgroundColor: 'transparent',
      renderMode: 'mathematical'
    });
    const moments = computeImageMoments(raster);

    // Compute centroid offset relative to frame center anchor
    const dx = Number((moments.normalizedCentroid.x - refCenter.x).toFixed(4));
    const dy = Number((moments.normalizedCentroid.y - refCenter.y).toFixed(4));
    centroidOffsets[shapeId] = { dx, dy };

    const major = Number(moments.principalRadii.major.toFixed(4));
    const minor = Number(moments.principalRadii.minor.toFixed(4));
    unitRadii[shapeId] = { major, minor };

    const orientation = Number(moments.orientationDeg.toFixed(2));
    unitOrientations[shapeId] = orientation;

    const ratio = major / Math.max(1e-4, minor);
    if (ratio > 1.08) {
      const absDeg = Math.abs(orientation);
      majorAxes[shapeId] = (absDeg <= 45 || absDeg >= 135) ? 'x' : 'y';
    } else {
      majorAxes[shapeId] = 'uniform';
    }
  }

  cachedCalibration = {
    centroidOffsets,
    unitRadii,
    unitOrientations,
    majorAxes
  };
  return cachedCalibration;
}

/**
 * Headless inverse-rendering optimizer solving:
 * Target Image -> Single Epic Seven Layer parameters.
 */
export class SingleLayerOptimizer {
  /**
   * Optimizes a single Epic Seven layer to reconstruct the target image.
   */
  public static optimize(
    target: RasterImage,
    options: OptimizerOptions = {}
  ): OptimizerResult {
    const startTime = Date.now();
    const {
      searchResolution = { width: 105, height: 155 },
      verificationResolution = { width: 210, height: 310 },
      timeoutMs = 10000,
      maxIterations = 140,
      weights = DEFAULT_SCORE_WEIGHTS,
      allowedPrimitives = ALL_PRIMITIVES,
      renderMode = 'mathematical'
    } = options;

    let candidatesEvaluated = 0;
    let timedOut = false;
    let totalIterations = 0;

    const isBudgetExceeded = () => {
      if (Date.now() - startTime >= timeoutMs) {
        timedOut = true;
        return true;
      }
      return false;
    };

    // 1. Prepare search-resolution target
    const searchTarget = this.resampleImage(target, searchResolution.width, searchResolution.height);

    interface CandidateState {
      shapeAsset: string;
      x: number;
      y: number;
      scaleX: number;
      scaleY: number;
      rotation: number;
      color: string;
      opacity: number;
      score: ScoreResult;
    }

    let topCandidates: CandidateState[] = [];
    let initialColor = '#ffffff';

    // Check if initialLayer is provided (Real Bad-Start test mode)
    if (options.initialLayer) {
      const init = options.initialLayer;
      initialColor = init.color;
      let curX = init.x;
      let curY = init.y;
      let curScaleX = init.scaleX;
      let curScaleY = init.scaleY;
      let curRotation = init.rotation;
      let curOpacity = init.opacity;
      const curShape = init.shapeAsset;
      let curColor = init.color;

      const initLayer: Layer = {
        id: 'opt-init',
        name: `Init (${curShape})`,
        shapeAsset: curShape,
        x: curX,
        y: curY,
        scaleX: curScaleX,
        scaleY: curScaleY,
        rotation: curRotation,
        color: curColor,
        opacity: curOpacity,
        visible: true,
        locked: false
      };
      const curRender = renderSingleLayerToRaster(initLayer, searchResolution.width, searchResolution.height, {
        backgroundColor: 'transparent',
        renderMode
      });
      candidatesEvaluated++;
      let curScore = ImageScorer.score(searchTarget, curRender, weights);

      // Wide schedules for bad start convergence across large distance
      const badStartSchedules = [
        { dPos: 0.16, dScale: 0.30, dRot: 30.0, dOpacity: 0.20 },
        { dPos: 0.08, dScale: 0.15, dRot: 15.0, dOpacity: 0.10 },
        { dPos: 0.04, dScale: 0.08, dRot: 8.0,  dOpacity: 0.06 },
        { dPos: 0.02, dScale: 0.04, dRot: 4.0,  dOpacity: 0.04 },
        { dPos: 0.008, dScale: 0.02, dRot: 2.0, dOpacity: 0.02 }
      ];

      for (const schedule of badStartSchedules) {
        if (isBudgetExceeded()) break;
        let improved = true;
        let pass = 0;
        while (improved && pass < 8 && totalIterations < maxIterations) {
          if (isBudgetExceeded()) break;
          improved = false;
          pass++;
          totalIterations++;

          const coordChecks: { deltas: [number, number, number, number, number, number] }[] = [
            { deltas: [schedule.dPos, 0, 0, 0, 0, 0] },
            { deltas: [-schedule.dPos, 0, 0, 0, 0, 0] },
            { deltas: [0, schedule.dPos, 0, 0, 0, 0] },
            { deltas: [0, -schedule.dPos, 0, 0, 0, 0] },
            { deltas: [schedule.dPos, schedule.dPos, 0, 0, 0, 0] },
            { deltas: [-schedule.dPos, -schedule.dPos, 0, 0, 0, 0] },
            { deltas: [schedule.dPos, -schedule.dPos, 0, 0, 0, 0] },
            { deltas: [-schedule.dPos, schedule.dPos, 0, 0, 0, 0] },
            { deltas: [0, 0, schedule.dScale, schedule.dScale, 0, 0] },
            { deltas: [0, 0, -schedule.dScale, -schedule.dScale, 0, 0] },
            { deltas: [0, 0, schedule.dScale, 0, 0, 0] },
            { deltas: [0, 0, -schedule.dScale, 0, 0, 0] },
            { deltas: [0, 0, 0, schedule.dScale, 0, 0] },
            { deltas: [0, 0, 0, -schedule.dScale, 0, 0] },
            { deltas: [0, 0, 0, 0, schedule.dRot, 0] },
            { deltas: [0, 0, 0, 0, -schedule.dRot, 0] },
            { deltas: [0, 0, 0, 0, 0, schedule.dOpacity] },
            { deltas: [0, 0, 0, 0, 0, -schedule.dOpacity] }
          ];

          for (const check of coordChecks) {
            if (isBudgetExceeded()) break;
            const nX = Math.max(0.0, Math.min(1.0, curX + check.deltas[0]));
            const nY = Math.max(0.0, Math.min(1.0, curY + check.deltas[1]));
            const nScaleX = Math.max(0.05, Math.min(4.0, curScaleX + check.deltas[2]));
            const nScaleY = Math.max(0.05, Math.min(4.0, curScaleY + check.deltas[3]));
            const nRot = normalizeAngleDeg(curRotation + check.deltas[4]);
            const nOp = Math.max(0.05, Math.min(1.0, curOpacity + check.deltas[5]));

            const testLayer: Layer = {
              id: 'opt-badstart',
              name: `BadStart (${curShape})`,
              shapeAsset: curShape,
              x: nX,
              y: nY,
              scaleX: nScaleX,
              scaleY: nScaleY,
              rotation: nRot,
              color: curColor,
              opacity: nOp,
              visible: true,
              locked: false
            };

            const render = renderSingleLayerToRaster(testLayer, searchResolution.width, searchResolution.height, {
              backgroundColor: 'transparent',
              renderMode
            });
            candidatesEvaluated++;

            const score = ImageScorer.score(searchTarget, render, weights);
            if (score.totalLoss < curScore.totalLoss - 1e-4) {
              curX = nX;
              curY = nY;
              curScaleX = nScaleX;
              curScaleY = nScaleY;
              curRotation = nRot;
              curOpacity = nOp;
              curScore = score;
              improved = true;
            }
          }
        }
      }

      topCandidates = [{
        shapeAsset: curShape,
        x: curX,
        y: curY,
        scaleX: curScaleX,
        scaleY: curScaleY,
        rotation: curRotation,
        color: curColor,
        opacity: curOpacity,
        score: curScore
      }];
    } else {
      // Standard Moment-Based Initialization
      const moments = computeImageMoments(searchTarget);
      const initialX = moments.normalizedCentroid.x;
      const initialY = moments.normalizedCentroid.y;
      const initialOpacity = moments.estimatedOpacity;
      initialColor = moments.dominantColorHex;
      const rawOrientation = moments.orientationDeg;

      // Filter primitives according to softness
      const candidatePrimitives = this.filterCandidatePrimitives(allowedPrimitives, moments.softnessRatio);
      const perPrimitiveBest: CandidateState[] = [];

      for (const shapeId of candidatePrimitives) {
        if (isBudgetExceeded()) break;

        const calib = getShapeFrameCalibration(shapeId);
        const frameNorm = calib ? calib.frameNormalizedSize : 450 / 567;
        const geomScaleX = calib ? calib.geometryScaleX : 0.8;
        const geomScaleY = calib ? calib.geometryScaleY : 0.8;

        const baseNormWidth = frameNorm * geomScaleX;
        const baseNormHeight = (21 / 31) * frameNorm * geomScaleY;

        // Multi-anchor scale estimation
        const boundScaleX = Math.max(0.1, moments.normalizedBounds.width / baseNormWidth);
        const boundScaleY = Math.max(0.1, moments.normalizedBounds.height / baseNormHeight);

        const calibTable = derivePrimitiveCalibration();
        const unitR = calibTable.unitRadii[shapeId];
        const axis = calibTable.majorAxes[shapeId] || 'uniform';
        let radSx = 1.0;
        let radSy = 1.0;

        const candidateScales: [number, number][] = [];

        if (unitR) {
          if (axis === 'y') {
            radSy = Math.max(0.1, moments.principalRadii.major / unitR.major);
            radSx = Math.max(0.1, moments.principalRadii.minor / unitR.minor);
            candidateScales.push([radSx, radSy]);
          } else if (axis === 'x') {
            radSx = Math.max(0.1, moments.principalRadii.major / unitR.major);
            radSy = Math.max(0.1, moments.principalRadii.minor / unitR.minor);
            candidateScales.push([radSx, radSy]);
          } else {
            // Isotropic / uniform primitive (Circle, Rounded_Square, Star, Glow, Cross)
            const s = Math.max(0.1, (moments.principalRadii.major + moments.principalRadii.minor) / (unitR.major + unitR.minor));
            const sMajor = Math.max(0.1, moments.principalRadii.major / unitR.major);
            const sMinor = Math.max(0.1, moments.principalRadii.minor / unitR.minor);
            radSx = sMajor;
            radSy = sMinor;
            candidateScales.push([sMajor, sMinor]);
            candidateScales.push([sMinor, sMajor]);
            candidateScales.push([s, s]);
          }
        } else {
          radSx = boundScaleX;
          radSy = boundScaleY;
          candidateScales.push([radSx, radSy]);
        }

        const uniformRadiiScale = Math.sqrt(radSx * radSy);

        candidateScales.push(
          [radSx * 1.06, radSy * 0.94],
          [radSx * 0.94, radSy * 1.06],
          [uniformRadiiScale, uniformRadiiScale],
          [boundScaleX, boundScaleY],
          [1.0, 1.0]
        );

        const sym = PRIMITIVE_SYMMETRIES[shapeId];
        const targetEccentricity = moments.principalRadii.major / Math.max(1e-4, moments.principalRadii.minor);
        const isTargetAnisotropic = targetEccentricity > 1.08;
        const isTrulyContinuous = sym?.type === 'continuous' && !isTargetAnisotropic;

        // Compute estimated layer rotation using primitive's intrinsic PCA orientation
        const unitOrient = calibTable.unitOrientations[shapeId] ?? 0;
        const estimatedAngle = normalizeAngleDeg(rawOrientation - unitOrient);

        let testAngles: number[];
        if (isTrulyContinuous) {
          testAngles = [0];
        } else if (shapeId === 'Star') {
          testAngles = Array.from({ length: 20 }, (_, i) => i * 18);
        } else if (sym?.rotationalPeriodDeg === 90) {
          testAngles = [
            estimatedAngle,
            normalizeAngleDeg(estimatedAngle + 45),
            0,
            45
          ];
        } else {
          testAngles = [
            estimatedAngle,
            normalizeAngleDeg(estimatedAngle + 90),
            normalizeAngleDeg(estimatedAngle + 180),
            normalizeAngleDeg(estimatedAngle + 270),
            0,
            90,
            180
          ];
        }

        let bestForPrim: CandidateState | null = null;
        const off = calibTable.centroidOffsets[shapeId] || { dx: 0, dy: 0 };

        for (const [curScaleX, curScaleY] of candidateScales) {
          for (const ang of testAngles) {
            if (isBudgetExceeded()) break;

            const angleRad = (ang * Math.PI) / 180;
            // Compensate for shape center of mass relative to frame center
            const cOffX = curScaleX * off.dx * Math.cos(angleRad) - curScaleY * off.dy * (31 / 21) * Math.sin(angleRad);
            const cOffY = curScaleX * off.dx * (21 / 31) * Math.sin(angleRad) + curScaleY * off.dy * Math.cos(angleRad);

            const spawnX = Math.max(0.02, Math.min(0.98, initialX - cOffX));
            const spawnY = Math.max(0.02, Math.min(0.98, initialY - cOffY));

            const testLayer: Layer = {
              id: `opt-${shapeId}`,
              name: `Layer (${shapeId})`,
              shapeAsset: shapeId,
              x: spawnX,
              y: spawnY,
              scaleX: curScaleX,
              scaleY: curScaleY,
              rotation: ang,
              color: initialColor,
              opacity: initialOpacity,
              visible: true,
              locked: false
            };

            const render = renderSingleLayerToRaster(testLayer, searchResolution.width, searchResolution.height, {
              backgroundColor: 'transparent',
              renderMode
            });
            candidatesEvaluated++;

            const score = ImageScorer.score(searchTarget, render, weights);

            if (!bestForPrim || score.totalLoss < bestForPrim.score.totalLoss) {
              bestForPrim = {
                shapeAsset: shapeId,
                x: spawnX,
                y: spawnY,
                scaleX: curScaleX,
                scaleY: curScaleY,
                rotation: ang,
                color: initialColor,
                opacity: initialOpacity,
                score
              };
            }
          }
        }

        if (bestForPrim) {
          perPrimitiveBest.push(bestForPrim);
        }
      }

      perPrimitiveBest.sort((a, b) => a.score.totalLoss - b.score.totalLoss);
      topCandidates = perPrimitiveBest.slice(0, 5);

      // Coarse and medium descent schedules
      const coarseSchedules = [
        { dPos: 0.025, dScale: 0.100, dRot: 15.0, dOpacity: 0.08 },
        { dPos: 0.012, dScale: 0.050, dRot: 7.0,  dOpacity: 0.04 }
      ];

      for (const cand of topCandidates) {
        if (isBudgetExceeded()) break;
        const sym = PRIMITIVE_SYMMETRIES[cand.shapeAsset];
        let isUniform = Math.abs(cand.scaleX - cand.scaleY) < 0.03;
        let isRotIrr = sym?.type === 'continuous' && isUniform;

        let curX = cand.x;
        let curY = cand.y;
        let curScaleX = cand.scaleX;
        let curScaleY = cand.scaleY;
        let curRotation = isRotIrr ? 0 : cand.rotation;
        let curOpacity = cand.opacity;
        let curScore = cand.score;

        for (const schedule of coarseSchedules) {
          if (isBudgetExceeded()) break;
          let improved = true;
          let pass = 0;

          while (improved && pass < 2 && totalIterations < maxIterations) {
            if (isBudgetExceeded()) break;
            improved = false;
            pass++;
            totalIterations++;

            isUniform = Math.abs(curScaleX - curScaleY) < 0.03;
            isRotIrr = sym?.type === 'continuous' && isUniform;

            const coordChecks: { deltas: [number, number, number, number, number, number] }[] = [
              { deltas: [schedule.dPos, 0, 0, 0, 0, 0] },
              { deltas: [-schedule.dPos, 0, 0, 0, 0, 0] },
              { deltas: [0, schedule.dPos, 0, 0, 0, 0] },
              { deltas: [0, -schedule.dPos, 0, 0, 0, 0] },
              { deltas: [0, 0, schedule.dScale, 0, 0, 0] },
              { deltas: [0, 0, -schedule.dScale, 0, 0, 0] },
              { deltas: [0, 0, 0, schedule.dScale, 0, 0] },
              { deltas: [0, 0, 0, -schedule.dScale, 0, 0] },
              { deltas: [0, 0, schedule.dScale, schedule.dScale, 0, 0] },
              { deltas: [0, 0, -schedule.dScale, -schedule.dScale, 0, 0] }
            ];

            if (!isRotIrr) {
              coordChecks.push(
                { deltas: [0, 0, 0, 0, schedule.dRot, 0] },
                { deltas: [0, 0, 0, 0, -schedule.dRot, 0] }
              );
            }

            coordChecks.push(
              { deltas: [0, 0, 0, 0, 0, schedule.dOpacity] },
              { deltas: [0, 0, 0, 0, 0, -schedule.dOpacity] }
            );

            for (const check of coordChecks) {
              if (isBudgetExceeded()) break;
              const nX = Math.max(0.0, Math.min(1.0, curX + check.deltas[0]));
              const nY = Math.max(0.0, Math.min(1.0, curY + check.deltas[1]));
              const nScaleX = Math.max(0.05, Math.min(4.0, curScaleX + check.deltas[2]));
              const nScaleY = Math.max(0.05, Math.min(4.0, curScaleY + check.deltas[3]));
              const nRot = isRotIrr ? 0 : normalizeAngleDeg(curRotation + check.deltas[4]);
              const nOp = Math.max(0.05, Math.min(1.0, curOpacity + check.deltas[5]));

              const testLayer: Layer = {
                id: 'opt-coarse',
                name: `Coarse (${cand.shapeAsset})`,
                shapeAsset: cand.shapeAsset,
                x: nX,
                y: nY,
                scaleX: nScaleX,
                scaleY: nScaleY,
                rotation: nRot,
                color: initialColor,
                opacity: nOp,
                visible: true,
                locked: false
              };

              const render = renderSingleLayerToRaster(testLayer, searchResolution.width, searchResolution.height, {
                backgroundColor: 'transparent',
                renderMode
              });
              candidatesEvaluated++;

              const score = ImageScorer.score(searchTarget, render, weights);
              if (score.totalLoss < curScore.totalLoss - 1e-4) {
                curX = nX;
                curY = nY;
                curScaleX = nScaleX;
                curScaleY = nScaleY;
                curRotation = nRot;
                curOpacity = nOp;
                curScore = score;
                improved = true;
              }
            }
          }
        }

        cand.x = curX;
        cand.y = curY;
        cand.scaleX = curScaleX;
        cand.scaleY = curScaleY;
        cand.rotation = curRotation;
        cand.opacity = curOpacity;
        cand.score = curScore;
      }

      topCandidates.sort((a, b) => a.score.totalLoss - b.score.totalLoss);
    }

    // Precision Fine-Tuning for Top Finalists on searchTarget
    const fineSchedules = [
      { dPos: 0.006, dScale: 0.025, dRot: 3.0,  dOpacity: 0.02 },
      { dPos: 0.002, dScale: 0.010, dRot: 1.0,  dOpacity: 0.01 }
    ];

    const finalists = topCandidates.slice(0, 3);
    let bestCandidate: CandidateState = finalists[0];

    for (const cand of finalists) {
      if (isBudgetExceeded()) break;
      const winSym = PRIMITIVE_SYMMETRIES[cand.shapeAsset];

      let curX = cand.x;
      let curY = cand.y;
      let curScaleX = cand.scaleX;
      let curScaleY = cand.scaleY;
      let curRotation = cand.rotation;
      let curOpacity = cand.opacity;
      let curScore = cand.score;

      for (const schedule of fineSchedules) {
        if (isBudgetExceeded()) break;
        let improved = true;
        let pass = 0;

        while (improved && pass < 3 && totalIterations < maxIterations) {
          if (isBudgetExceeded()) break;
          improved = false;
          pass++;
          totalIterations++;

          const isUniform = Math.abs(curScaleX - curScaleY) < 0.03;
          const isRotIrr = winSym?.type === 'continuous' && isUniform;

          const coordChecks: { deltas: [number, number, number, number, number, number] }[] = [
            { deltas: [schedule.dPos, 0, 0, 0, 0, 0] },
            { deltas: [-schedule.dPos, 0, 0, 0, 0, 0] },
            { deltas: [0, schedule.dPos, 0, 0, 0, 0] },
            { deltas: [0, -schedule.dPos, 0, 0, 0, 0] },
            { deltas: [0, 0, schedule.dScale, 0, 0, 0] },
            { deltas: [0, 0, -schedule.dScale, 0, 0, 0] },
            { deltas: [0, 0, 0, schedule.dScale, 0, 0] },
            { deltas: [0, 0, 0, -schedule.dScale, 0, 0] },
            { deltas: [0, 0, schedule.dScale, schedule.dScale, 0, 0] },
            { deltas: [0, 0, -schedule.dScale, -schedule.dScale, 0, 0] }
          ];

          if (!isRotIrr) {
            coordChecks.push(
              { deltas: [0, 0, 0, 0, schedule.dRot, 0] },
              { deltas: [0, 0, 0, 0, -schedule.dRot, 0] }
            );
          }

          coordChecks.push(
            { deltas: [0, 0, 0, 0, 0, schedule.dOpacity] },
            { deltas: [0, 0, 0, 0, 0, -schedule.dOpacity] }
          );

          for (const check of coordChecks) {
            if (isBudgetExceeded()) break;
            const nX = Math.max(0.0, Math.min(1.0, curX + check.deltas[0]));
            const nY = Math.max(0.0, Math.min(1.0, curY + check.deltas[1]));
            const nScaleX = Math.max(0.05, Math.min(4.0, curScaleX + check.deltas[2]));
            const nScaleY = Math.max(0.05, Math.min(4.0, curScaleY + check.deltas[3]));
            const nRot = isRotIrr ? 0 : normalizeAngleDeg(curRotation + check.deltas[4]);
            const nOp = Math.max(0.05, Math.min(1.0, curOpacity + check.deltas[5]));

            const testLayer: Layer = {
              id: 'opt-fine',
              name: `Fine (${cand.shapeAsset})`,
              shapeAsset: cand.shapeAsset,
              x: nX,
              y: nY,
              scaleX: nScaleX,
              scaleY: nScaleY,
              rotation: nRot,
              color: initialColor,
              opacity: nOp,
              visible: true,
              locked: false
            };

            const render = renderSingleLayerToRaster(testLayer, searchResolution.width, searchResolution.height, {
              backgroundColor: 'transparent',
              renderMode
            });
            candidatesEvaluated++;

            const score = ImageScorer.score(searchTarget, render, weights);
            if (score.totalLoss < curScore.totalLoss - 1e-4) {
              curX = nX;
              curY = nY;
              curScaleX = nScaleX;
              curScaleY = nScaleY;
              curRotation = nRot;
              curOpacity = nOp;
              curScore = score;
              improved = true;
            }
          }
        }
      }

      cand.x = curX;
      cand.y = curY;
      cand.scaleX = curScaleX;
      cand.scaleY = curScaleY;
      cand.rotation = curRotation;
      cand.opacity = curOpacity;
      cand.score = curScore;

      if (!bestCandidate || curScore.totalLoss < bestCandidate.score.totalLoss) {
        bestCandidate = { ...cand };
      }
    }

    // Principled Occam's tie-breaking:
    // When finalists have nearly identical loss (|lossA - lossB| < 0.005), prefer the simpler
    // geometric primitive (higher rotational/continuous symmetry, fewer degrees of freedom).
    finalists.sort((a, b) => {
      const lossDiff = a.score.totalLoss - b.score.totalLoss;
      if (Math.abs(lossDiff) > 0.005) {
        return lossDiff;
      }
      const symA = PRIMITIVE_SYMMETRIES[a.shapeAsset];
      const symB = PRIMITIVE_SYMMETRIES[b.shapeAsset];
      const complexityOrder: Record<string, number> = {
        continuous: 1, // Circle, Glow (maximally symmetric)
        c4: 2,         // Rounded_Square, Cross (4-fold symmetry)
        c5: 3,         // Star (5-fold symmetry)
        c2: 4,         // Pill (2-fold symmetry)
        d1: 5,         // Triangle, Heart, Baloon, Moon_Curve (bilateral reflection only)
        asymmetric: 6  // Moon_Edge
      };
      const compA = complexityOrder[symA?.type ?? 'asymmetric'] ?? 10;
      const compB = complexityOrder[symB?.type ?? 'asymmetric'] ?? 10;
      if (compA !== compB) {
        return compA - compB;
      }
      // If Pill vs Circle where aspect ratio is circular (capsule length ≈ width)
      if (a.shapeAsset === 'Pill' && b.shapeAsset === 'Circle') return 1;
      if (a.shapeAsset === 'Circle' && b.shapeAsset === 'Pill') return -1;
      // Deterministic fallback by canonical primitive order
      return ALL_PRIMITIVES.indexOf(a.shapeAsset) - ALL_PRIMITIVES.indexOf(b.shapeAsset);
    });
    bestCandidate = finalists[0];

    let curX = bestCandidate.x;
    let curY = bestCandidate.y;
    let curScaleX = bestCandidate.scaleX;
    let curScaleY = bestCandidate.scaleY;
    let curRotation = bestCandidate.rotation;
    let curOpacity = bestCandidate.opacity;
    const curShape = bestCandidate.shapeAsset;
    let curColor = bestCandidate.color;
    let currentScore = bestCandidate.score;

    // Palette Color Refinement
    if (!isBudgetExceeded()) {
      const moments = computeImageMoments(searchTarget);
      const topPaletteColors = this.getTopPaletteCandidates(moments.averageRgb, 4);
      for (const palColor of topPaletteColors) {
        if (palColor === curColor) continue;
        const testLayer: Layer = {
          id: 'opt-color',
          name: `Color (${curShape})`,
          shapeAsset: curShape,
          x: curX,
          y: curY,
          scaleX: curScaleX,
          scaleY: curScaleY,
          rotation: curRotation,
          color: palColor,
          opacity: curOpacity,
          visible: true,
          locked: false
        };

        const render = renderSingleLayerToRaster(testLayer, searchResolution.width, searchResolution.height, {
          backgroundColor: 'transparent',
          renderMode
        });
        candidatesEvaluated++;

        const score = ImageScorer.score(searchTarget, render, weights);
        if (score.totalLoss < currentScore.totalLoss) {
          curColor = palColor;
          currentScore = score;
        }
      }
    }

    // High-Resolution Micro-Polish on verifTarget
    const finalSym = PRIMITIVE_SYMMETRIES[curShape];
    const isUniformFinal = Math.abs(curScaleX - curScaleY) < 0.03;
    const isRotIrrFinal = finalSym?.type === 'continuous' && isUniformFinal;

    let recoveredLayer: Layer = {
      id: options.seed !== undefined ? `layer-recovered-${options.seed}` : `layer-recovered-${curShape}`,
      name: `Recovered (${curShape})`,
      shapeAsset: curShape,
      x: curX,
      y: curY,
      scaleX: curScaleX,
      scaleY: curScaleY,
      rotation: isRotIrrFinal ? 0 : curRotation,
      color: curColor,
      opacity: curOpacity,
      visible: true,
      locked: false
    };

    const verifTarget = this.resampleImage(target, verificationResolution.width, verificationResolution.height);
    let verifRender = renderSingleLayerToRaster(recoveredLayer, verificationResolution.width, verificationResolution.height, {
      backgroundColor: 'transparent',
      renderMode
    });
    candidatesEvaluated++;
    let verificationLoss = ImageScorer.score(verifTarget, verifRender, weights);

    // High-Resolution Micro-Step Polish (optional, enabled by default)
    const enablePolish = options.enablePolish ?? true;
    if (enablePolish) {
      const microSchedules = [
        { dPos: 0.005, dScale: 0.020, dRot: 1.5, dOpacity: 0.015 },
        { dPos: 0.002, dScale: 0.008, dRot: 0.8, dOpacity: 0.010 },
        { dPos: 0.001, dScale: 0.003, dRot: 0.4, dOpacity: 0.005 },
        { dPos: 0.0005, dScale: 0.001, dRot: 0.2, dOpacity: 0.002 }
      ];

      for (const micro of microSchedules) {
        if (isBudgetExceeded()) break;
        let microImproved = true;
        let microPass = 0;
        while (microImproved && microPass < 3) {
          if (isBudgetExceeded()) break;
          microImproved = false;
          microPass++;

          const isUnif = Math.abs(recoveredLayer.scaleX - recoveredLayer.scaleY) < 0.03;
          const isRotIrr = finalSym?.type === 'continuous' && isUnif;

          const checks: [number, number, number, number, number, number][] = [
            [micro.dPos, 0, 0, 0, 0, 0],
            [-micro.dPos, 0, 0, 0, 0, 0],
            [0, micro.dPos, 0, 0, 0, 0],
            [0, -micro.dPos, 0, 0, 0, 0],
            [0, 0, micro.dScale, 0, 0, 0],
            [0, 0, -micro.dScale, 0, 0, 0],
            [0, 0, 0, micro.dScale, 0, 0],
            [0, 0, 0, -micro.dScale, 0, 0],
            [0, 0, micro.dScale, micro.dScale, 0, 0],
            [0, 0, -micro.dScale, -micro.dScale, 0, 0],
            [0, 0, 0, 0, 0, micro.dOpacity],
            [0, 0, 0, 0, 0, -micro.dOpacity]
          ];

          if (!isRotIrr) {
            checks.push([0, 0, 0, 0, micro.dRot, 0]);
            checks.push([0, 0, 0, 0, -micro.dRot, 0]);
          }

          for (const [dx, dy, dsx, dsy, drot, dop] of checks) {
            if (isBudgetExceeded()) break;
            const tLayer: Layer = {
              ...recoveredLayer,
              x: Math.max(0.0, Math.min(1.0, recoveredLayer.x + dx)),
              y: Math.max(0.0, Math.min(1.0, recoveredLayer.y + dy)),
              scaleX: Math.max(0.05, Math.min(4.0, recoveredLayer.scaleX + dsx)),
              scaleY: Math.max(0.05, Math.min(4.0, recoveredLayer.scaleY + dsy)),
              rotation: isRotIrr ? 0 : normalizeAngleDeg(recoveredLayer.rotation + drot),
              opacity: Math.max(0.05, Math.min(1.0, recoveredLayer.opacity + dop))
            };

            const r = renderSingleLayerToRaster(tLayer, verificationResolution.width, verificationResolution.height, {
              backgroundColor: 'transparent',
              renderMode
            });
            candidatesEvaluated++;

            const loss = ImageScorer.score(verifTarget, r, weights);
            if (loss.totalLoss < verificationLoss.totalLoss - 1e-5) {
              recoveredLayer = tLayer;
              verificationLoss = loss;
              microImproved = true;
            }
          }
        }
      }
    }

    const elapsedMs = Date.now() - startTime;

    return {
      recoveredLayer,
      searchLoss: currentScore,
      verificationLoss,
      elapsedMs,
      candidatesEvaluated,
      iterations: totalIterations,
      timedOut,
      searchResolution,
      verificationResolution
    };
  }

  /**
   * Filter and order candidate primitives based on image features.
   */
  private static filterCandidatePrimitives(allowed: string[], softnessRatio: number): string[] {
    if (softnessRatio > 0.65 && allowed.includes('Glow')) {
      return ['Glow', ...allowed.filter(p => p !== 'Glow')];
    }
    return [...allowed];
  }

  /**
   * Returns top N closest palette colors for fine-tuning.
   */
  private static getTopPaletteCandidates(avgRgb: { r: number; g: number; b: number }, topN: number): string[] {
    const list: { hex: string; dist: number }[] = [];
    for (const hex of EPIC7_PALETTE_HEX) {
      const num = parseInt(hex.replace('#', ''), 16);
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      const dist = Math.sqrt((r - avgRgb.r) ** 2 + (g - avgRgb.g) ** 2 + (b - avgRgb.b) ** 2);
      list.push({ hex, dist });
    }
    list.sort((a, b) => a.dist - b.dist);
    return list.slice(0, topN).map(item => item.hex);
  }

  /**
   * Resamples / rescales a RasterImage using bilinear / area sampling.
   */
  public static resampleImage(image: RasterImage, targetW: number, targetH: number): RasterImage {
    if (image.width === targetW && image.height === targetH) {
      return image;
    }

    const srcW = image.width;
    const srcH = image.height;
    const sData = image.data;
    const outData = new Uint8ClampedArray(targetW * targetH * 4);

    const xRatio = srcW / targetW;
    const yRatio = srcH / targetH;

    for (let dy = 0; dy < targetH; dy++) {
      const srcY = Math.min(srcH - 1, Math.floor(dy * yRatio));
      const rowOut = dy * targetW;
      const rowIn = srcY * srcW;

      for (let dx = 0; dx < targetW; dx++) {
        const srcX = Math.min(srcW - 1, Math.floor(dx * xRatio));
        const outIdx = (rowOut + dx) * 4;
        const inIdx = (rowIn + srcX) * 4;

        outData[outIdx] = sData[inIdx];
        outData[outIdx + 1] = sData[inIdx + 1];
        outData[outIdx + 2] = sData[inIdx + 2];
        outData[outIdx + 3] = sData[inIdx + 3];
      }
    }

    return {
      width: targetW,
      height: targetH,
      data: outData
    };
  }
}

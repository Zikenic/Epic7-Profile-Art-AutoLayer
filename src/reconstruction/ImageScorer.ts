import type { RasterImage, ScoreResult, ScoreWeights } from './types.ts';
import { DEFAULT_SCORE_WEIGHTS } from './types.ts';
import { colorDifferenceNormalized, type RGB } from './ColorSpaces.ts';

/**
 * Headless, deterministic image scorer comparing target vs candidate RasterImages.
 */
export class ImageScorer {
  /**
   * Scores candidate image against target image using weighted composite loss.
   */
  public static score(
    target: RasterImage,
    candidate: RasterImage,
    weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS
  ): ScoreResult {
    if (target.width !== candidate.width || target.height !== candidate.height) {
      throw new Error(
        `Dimension mismatch: target (${target.width}x${target.height}) vs candidate (${candidate.width}x${candidate.height})`
      );
    }

    const w = target.width;
    const h = target.height;
    const totalPixels = w * h;
    const tData = target.data;
    const cData = candidate.data;

    let sumIntersection = 0;
    let sumTargetAlphaSq = 0;
    let sumCandAlphaSq = 0;
    let sumAlphaAbsDiff = 0;
    let sumAlphaSqDiff = 0;

    let targetMass = 0;
    let candMass = 0;
    let targetXMass = 0;
    let targetYMass = 0;
    let candXMass = 0;
    let candYMass = 0;

    let weightedColorDiffSum = 0;
    let colorWeightSum = 0;

    let targetAvgR = 0, targetAvgG = 0, targetAvgB = 0;
    let candAvgR = 0, candAvgG = 0, candAvgB = 0;

    // Fast single-pass pixel traversal
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const idx = (rowOffset + x) * 4;

        const at = tData[idx + 3] / 255.0;
        const ac = cData[idx + 3] / 255.0;

        // Alpha / silhouette metrics
        const diffA = Math.abs(at - ac);
        sumAlphaAbsDiff += diffA;
        sumAlphaSqDiff += diffA * diffA;

        sumIntersection += at * ac;
        sumTargetAlphaSq += at * at;
        sumCandAlphaSq += ac * ac;

        // Mass and centroids
        if (at > 0.01) {
          targetMass += at;
          targetXMass += x * at;
          targetYMass += y * at;
          targetAvgR += tData[idx] * at;
          targetAvgG += tData[idx + 1] * at;
          targetAvgB += tData[idx + 2] * at;
        }

        if (ac > 0.01) {
          candMass += ac;
          candXMass += x * ac;
          candYMass += y * ac;
          candAvgR += cData[idx] * ac;
          candAvgG += cData[idx + 1] * ac;
          candAvgB += cData[idx + 2] * ac;
        }

        // Color difference for overlapping pixels
        if (at > 0.05 && ac > 0.05) {
          const cTarget: RGB = { r: tData[idx], g: tData[idx + 1], b: tData[idx + 2] };
          const cCand: RGB = { r: cData[idx], g: cData[idx + 1], b: cData[idx + 2] };
          const cDiff = colorDifferenceNormalized(cTarget, cCand);
          const pixelWeight = Math.min(at, ac);
          weightedColorDiffSum += cDiff * pixelWeight;
          colorWeightSum += pixelWeight;
        }
      }
    }

    // 1. Color Loss
    let colorLoss = 0.0;
    if (colorWeightSum > 0.001) {
      colorLoss = weightedColorDiffSum / colorWeightSum;
    } else if (targetMass > 0.001 && candMass > 0.001) {
      // No overlap: compare average colors so incorrect color is penalized even before overlap
      const avgTarget: RGB = {
        r: targetAvgR / targetMass,
        g: targetAvgG / targetMass,
        b: targetAvgB / targetMass
      };
      const avgCand: RGB = {
        r: candAvgR / candMass,
        g: candAvgG / candMass,
        b: candAvgB / candMass
      };
      colorLoss = colorDifferenceNormalized(avgTarget, avgCand);
    } else if (targetMass > 0.001 || candMass > 0.001) {
      colorLoss = 1.0;
    }

    // 2. Silhouette / Occupancy Loss
    const eps = 1e-5;
    const softDice = 1.0 - (2.0 * sumIntersection + eps) / (sumTargetAlphaSq + sumCandAlphaSq + eps);
    const meanL1 = sumAlphaAbsDiff / totalPixels;
    const baseSilhouetteLoss = 0.7 * softDice + 0.3 * Math.min(1.0, meanL1 * 4.0);

    // Distance component to prevent flat plateaus for distant candidates
    let distancePenalty = 0.0;
    if (targetMass > 0.001 && candMass > 0.001) {
      const txNorm = (targetXMass / targetMass) / w;
      const tyNorm = (targetYMass / targetMass) / h;
      const cxNorm = (candXMass / candMass) / w;
      const cyNorm = (candYMass / candMass) / h;

      const dx = txNorm - cxNorm;
      const dy = tyNorm - cyNorm;
      const normDist = Math.sqrt(dx * dx + dy * dy); // [0, ~1.414]

      const overlapRatio = (2.0 * sumIntersection + eps) / (sumTargetAlphaSq + sumCandAlphaSq + eps);
      // Non-overlap factor: when overlap is high (1.0), distance penalty -> 0; when overlap -> 0, distance penalty scales smoothly with distance
      const nonOverlap = Math.max(0, 1.0 - overlapRatio);
      distancePenalty = nonOverlap * Math.min(1.0, normDist * 1.5);
    } else if (targetMass > 0.001 || candMass > 0.001) {
      distancePenalty = 1.0;
    }

    const silhouetteLoss = Math.min(1.0, baseSilhouetteLoss * 0.75 + distancePenalty * 0.25);

    // 3. Structural Edge Loss (Sobel filter over alpha channel)
    const edgeLoss = this.computeEdgeLoss(target, candidate);

    // 4. Alpha Softness / Distribution Loss
    // Evaluates difference in alpha energy and profile (crucial for distinguishing Glow from solid shapes)
    const alphaLoss = Math.min(1.0, (sumAlphaSqDiff / totalPixels) * 3.0);

    // Combine according to normalized weights
    const weightSum = weights.color + weights.silhouette + weights.edge + weights.alpha;
    const normWeights = {
      color: weights.color / weightSum,
      silhouette: weights.silhouette / weightSum,
      edge: weights.edge / weightSum,
      alpha: weights.alpha / weightSum
    };

    const totalLoss =
      normWeights.color * colorLoss +
      normWeights.silhouette * silhouetteLoss +
      normWeights.edge * edgeLoss +
      normWeights.alpha * alphaLoss;

    // Validate for numerical safety
    const safeTotal = isNaN(totalLoss) || !isFinite(totalLoss) ? 1.0 : Math.max(0, totalLoss);

    return {
      totalLoss: safeTotal,
      colorLoss: isNaN(colorLoss) || !isFinite(colorLoss) ? 1.0 : Math.max(0, colorLoss),
      silhouetteLoss: isNaN(silhouetteLoss) || !isFinite(silhouetteLoss) ? 1.0 : Math.max(0, silhouetteLoss),
      edgeLoss: isNaN(edgeLoss) || !isFinite(edgeLoss) ? 1.0 : Math.max(0, edgeLoss),
      alphaLoss: isNaN(alphaLoss) || !isFinite(alphaLoss) ? 1.0 : Math.max(0, alphaLoss),
      comparedPixels: totalPixels
    };
  }

  /**
   * Computes structural boundary / edge difference using multi-scale smoothed gradient magnitudes,
   * providing sub-pixel displacement tolerance while strictly penalizing structural boundary mismatches.
   */
  private static computeEdgeLoss(target: RasterImage, candidate: RasterImage): number {
    const w = target.width;
    const h = target.height;
    const tData = target.data;
    const cData = candidate.data;

    const gT = new Float32Array(w * h);
    const gC = new Float32Array(w * h);

    // 1. Central difference gradients on alpha channel
    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      for (let x = 1; x < w - 1; x++) {
        const i = (row + x) * 4 + 3;
        const gxT = Math.abs(tData[i + 4] - tData[i - 4]) / 255.0;
        const gyT = Math.abs(tData[i + w * 4] - tData[i - w * 4]) / 255.0;
        gT[row + x] = gxT + gyT;

        const gxC = Math.abs(cData[i + 4] - cData[i - 4]) / 255.0;
        const gyC = Math.abs(cData[i + w * 4] - cData[i - w * 4]) / 255.0;
        gC[row + x] = gxC + gyC;
      }
    }

    // 2. 3x3 smoothing on gradients to enable smooth sub-pixel boundary convergence
    let edgeDiffSum = 0;
    let edgeEnergySum = 0;

    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        let sT = 0;
        let sC = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const offset = (y + dy) * w + x;
          sT += gT[offset - 1] + gT[offset] + gT[offset + 1];
          sC += gC[offset - 1] + gC[offset] + gC[offset + 1];
        }
        const bT = sT / 9.0;
        const bC = sC / 9.0;
        edgeDiffSum += Math.abs(bT - bC);
        edgeEnergySum += Math.max(bT, bC);
      }
    }

    if (edgeEnergySum <= 0.001) {
      return 0.0;
    }
    return Math.min(1.0, edgeDiffSum / edgeEnergySum);
  }
}

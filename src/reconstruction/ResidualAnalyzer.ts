import type { RasterImage } from './types.ts';
import { EPIC7_PALETTE_HEX } from './types.ts';
import { colorDifferenceNormalized, findClosestPaletteColor, type RGB } from './ColorSpaces.ts';

export interface ResidualRegion {
  id: number;
  pixelCount: number;
  totalMass: number;
  meanResidual: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  normalizedCentroid: { x: number; y: number };
  principalRadii: { major: number; minor: number };
  normalizedRadii: { major: number; minor: number };
  orientationDeg: number;
  dominantTargetColorHex: string;
  closestPaletteHex: string;
  secondaryPaletteHex?: string;
  meanTargetAlpha: number;
  isUncoveredTarget: boolean;
}

export interface ResidualAnalysisResult {
  meanResidual: number;
  maxResidual: number;
  totalResidualMass: number;
  regions: ResidualRegion[];
  residualMap: Float32Array;
}

/**
 * Analyzes visual residuals between a target image and the current composition render.
 * Computes per-pixel error magnitude and extracts coherent residual regions deterministically.
 */
export class ResidualAnalyzer {
  /**
   * Analyzes target vs current composition render.
   */
  public static analyze(
    target: RasterImage,
    currentRender: RasterImage,
    options: {
      residualThreshold?: number;
      minRegionPixels?: number;
      minRegionMass?: number;
      maxRegions?: number;
    } = {}
  ): ResidualAnalysisResult {
    const {
      residualThreshold = 0.15,
      minRegionPixels = 4,
      minRegionMass = 1.2,
      maxRegions = 8
    } = options;

    const w = target.width;
    const h = target.height;
    const totalPixels = w * h;
    const tData = target.data;
    const cData = currentRender.data;

    const residualMap = new Float32Array(totalPixels);
    let totalResidualMass = 0;
    let maxResidual = 0;

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const at = tData[idx + 3] / 255.0;
      const ac = cData[idx + 3] / 255.0;

      let rMag = 0.0;
      if (at < 0.02 && ac < 0.02) {
        rMag = 0.0;
      } else if (at >= 0.05 && ac >= 0.05) {
        const rgbT: RGB = { r: tData[idx], g: tData[idx + 1], b: tData[idx + 2] };
        const rgbC: RGB = { r: cData[idx], g: cData[idx + 1], b: cData[idx + 2] };
        const cDiff = colorDifferenceNormalized(rgbT, rgbC);
        const aDiff = Math.abs(at - ac);
        rMag = Math.max(aDiff, cDiff * Math.min(at, ac));
      } else if (at >= 0.05) {
        // Target is visible, render is transparent/missing
        rMag = at;
      } else {
        // Render has excess pixels where target is transparent
        rMag = ac;
      }

      residualMap[i] = rMag;
      totalResidualMass += rMag;
      if (rMag > maxResidual) {
        maxResidual = rMag;
      }
    }

    const meanResidual = totalResidualMass / Math.max(1, totalPixels);

    // Precompute discrete palette color category for high-residual pixels
    const pixelCategory = new Int8Array(totalPixels);
    pixelCategory.fill(-1);

    for (let i = 0; i < totalPixels; i++) {
      if (residualMap[i] >= residualThreshold) {
        const byteIdx = i * 4;
        const at = tData[byteIdx + 3] / 255.0;
        if (at >= 0.05) {
          const rgb: RGB = { r: tData[byteIdx], g: tData[byteIdx + 1], b: tData[byteIdx + 2] };
          const pColor = findClosestPaletteColor(rgb).hex;
          const pIdx = EPIC7_PALETTE_HEX.indexOf(pColor as any);
          pixelCategory[i] = pIdx >= 0 ? pIdx : 0;
        } else {
          pixelCategory[i] = 26; // overdrawn pixel category
        }
      }
    }

    // Extract connected components above residualThreshold
    const visited = new Uint8Array(totalPixels);
    const regions: ResidualRegion[] = [];
    let regionId = 1;

    // Queue buffer for BFS to avoid recursion and heap reallocations
    const queue = new Int32Array(totalPixels);

    // 8-connectivity neighborhood offsets in deterministic clockwise order
    const neighbors = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1]
    ];

    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const startIdx = rowOffset + x;
        if (visited[startIdx] || residualMap[startIdx] < residualThreshold) {
          continue;
        }

        const startCat = pixelCategory[startIdx];

        // Start BFS for new component
        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = startIdx;
        visited[startIdx] = 1;

        let compPixelCount = 0;
        let compMass = 0;
        let compSumX = 0;
        let compSumY = 0;
        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;

        let targetSumR = 0;
        let targetSumG = 0;
        let targetSumB = 0;
        let targetColorWeight = 0;
        let targetSumAlpha = 0;
        let uncoveredPixels = 0;

        while (qHead < qTail) {
          const currIdx = queue[qHead++];
          const currX = currIdx % w;
          const currY = (currIdx / w) | 0;
          const mag = residualMap[currIdx];

          compPixelCount++;
          compMass += mag;
          compSumX += currX * mag;
          compSumY += currY * mag;

          if (currX < minX) minX = currX;
          if (currX > maxX) maxX = currX;
          if (currY < minY) minY = currY;
          if (currY > maxY) maxY = currY;

          const byteIdx = currIdx * 4;
          const at = tData[byteIdx + 3] / 255.0;
          const ac = cData[byteIdx + 3] / 255.0;
          targetSumAlpha += at;

          if (at > ac) {
            uncoveredPixels++;
          }

          if (at > 0.05) {
            const weight = mag * at;
            targetSumR += tData[byteIdx] * weight;
            targetSumG += tData[byteIdx + 1] * weight;
            targetSumB += tData[byteIdx + 2] * weight;
            targetColorWeight += weight;
          }

          // Explore neighbors
          for (let n = 0; n < 8; n++) {
            const nx = currX + neighbors[n][0];
            const ny = currY + neighbors[n][1];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nIdx = ny * w + nx;
              if (!visited[nIdx] && residualMap[nIdx] >= residualThreshold && pixelCategory[nIdx] === startCat) {
                visited[nIdx] = 1;
                queue[qTail++] = nIdx;
              }
            }
          }
        }

        if (compPixelCount < minRegionPixels || compMass < minRegionMass) {
          continue;
        }

        const cx = compSumX / compMass;
        const cy = compSumY / compMass;

        // Second pass over this component: compute central moments and palette histogram votes
        let mu20 = 0;
        let mu02 = 0;
        let mu11 = 0;
        const paletteVotes = new Map<string, number>();

        for (let k = 0; k < qTail; k++) {
          const pIdx = queue[k];
          const px = pIdx % w;
          const py = (pIdx / w) | 0;
          const mag = residualMap[pIdx];

          const dx = px - cx;
          const dy = py - cy;
          mu20 += dx * dx * mag;
          mu02 += dy * dy * mag;
          mu11 += dx * dy * mag;

          const byteIdx = pIdx * 4;
          const at = tData[byteIdx + 3] / 255.0;
          if (at > 0.05) {
            const rgb: RGB = { r: tData[byteIdx], g: tData[byteIdx + 1], b: tData[byteIdx + 2] };
            const pColor = findClosestPaletteColor(rgb).hex;
            const weight = mag * at;
            paletteVotes.set(pColor, (paletteVotes.get(pColor) ?? 0) + weight);
          }
        }

        mu20 /= compMass;
        mu02 /= compMass;
        mu11 /= compMass;

        // Principal moments and orientation
        const commonDiff = 0.5 * (mu20 - mu02);
        const term = Math.sqrt(commonDiff * commonDiff + mu11 * mu11);
        const lambda1 = Math.max(0.1, 0.5 * (mu20 + mu02) + term);
        const lambda2 = Math.max(0.1, 0.5 * (mu20 + mu02) - term);

        const majorRadius = 2.0 * Math.sqrt(lambda1);
        const minorRadius = 2.0 * Math.sqrt(lambda2);

        let orientationDeg = 0.0;
        if (Math.abs(mu11) > 1e-4 || Math.abs(mu20 - mu02) > 1e-4) {
          orientationDeg = 0.5 * Math.atan2(2 * mu11, mu20 - mu02) * (180.0 / Math.PI);
        }

        // Determine dominant palette colors from histogram voting
        let topPaletteHex = '#ffffff';
        let topVotes = 0;
        let secondPaletteHex: string | undefined = undefined;
        let secondVotes = 0;

        for (const [colorHex, votes] of paletteVotes.entries()) {
          if (votes > topVotes) {
            secondPaletteHex = topPaletteHex;
            secondVotes = topVotes;
            topPaletteHex = colorHex;
            topVotes = votes;
          } else if (votes > secondVotes) {
            secondPaletteHex = colorHex;
            secondVotes = votes;
          }
        }

        let domR = 255;
        let domG = 255;
        let domB = 255;
        if (targetColorWeight > 0.01) {
          domR = Math.round(targetSumR / targetColorWeight);
          domG = Math.round(targetSumG / targetColorWeight);
          domB = Math.round(targetSumB / targetColorWeight);
        }
        const dominantHex = `#${domR.toString(16).padStart(2, '0')}${domG.toString(16).padStart(2, '0')}${domB.toString(16).padStart(2, '0')}`;

        regions.push({
          id: regionId++,
          pixelCount: compPixelCount,
          totalMass: Number(compMass.toFixed(3)),
          meanResidual: Number((compMass / compPixelCount).toFixed(3)),
          bounds: { minX, minY, maxX, maxY },
          normalizedCentroid: {
            x: Number((cx / w).toFixed(4)),
            y: Number((cy / h).toFixed(4))
          },
          principalRadii: {
            major: Number(majorRadius.toFixed(2)),
            minor: Number(minorRadius.toFixed(2))
          },
          normalizedRadii: {
            major: Number((majorRadius / w).toFixed(4)),
            minor: Number((minorRadius / w).toFixed(4))
          },
          orientationDeg: Number(orientationDeg.toFixed(2)),
          dominantTargetColorHex: dominantHex,
          closestPaletteHex: topPaletteHex,
          secondaryPaletteHex: (secondVotes >= topVotes * 0.15 && secondPaletteHex !== '#ffffff') ? secondPaletteHex : undefined,
          meanTargetAlpha: Number((targetSumAlpha / compPixelCount).toFixed(3)),
          isUncoveredTarget: uncoveredPixels >= compPixelCount * 0.5
        });
      }
    }

    // Deterministic sort: largest mass first, break ties by y then x
    regions.sort((a, b) => {
      if (Math.abs(b.totalMass - a.totalMass) > 1e-3) {
        return b.totalMass - a.totalMass;
      }
      if (Math.abs(a.normalizedCentroid.y - b.normalizedCentroid.y) > 1e-4) {
        return a.normalizedCentroid.y - b.normalizedCentroid.y;
      }
      return a.normalizedCentroid.x - b.normalizedCentroid.x;
    });

    const finalRegions = regions.slice(0, maxRegions);

    return {
      meanResidual: Number(meanResidual.toFixed(4)),
      maxResidual: Number(maxResidual.toFixed(4)),
      totalResidualMass: Number(totalResidualMass.toFixed(2)),
      regions: finalRegions,
      residualMap
    };
  }
}

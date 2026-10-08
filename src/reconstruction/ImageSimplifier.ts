import type { RasterImage } from './types.ts';
import { EPIC7_PALETTE_HEX } from './types.ts';
import {
  rgbToLab,
  labToRgb,
  findClosestPaletteColorFromLab,
  hexToRgb,
  type RGB,
  type Lab
} from './ColorSpaces.ts';
import type { ImageRegion, RegionGraph } from './RegionRepresentation.ts';

export type SimplificationLevel = 'VERY_COARSE' | 'COARSE' | 'MEDIUM' | 'FINE';

export interface SimplificationOptions {
  level?: SimplificationLevel;
  minColors?: number;
  maxColors?: number;
  minRegionAreaFraction?: number;
  preserveSalientFeatures?: boolean;
  saliencyThreshold?: number;
  enableSmoothing?: boolean;
  smoothingSpatialSigma?: number;
  smoothingRangeSigma?: number;
  seed?: number;
}

export interface SimplificationDiagnostics {
  level: SimplificationLevel;
  representativeColorCount: number;
  paletteColorCount: number;
  rawRegionCount: number;
  simplifiedRegionCount: number;
  medianRegionSize: number;
  p90RegionSize: number;
  largestRegionSize: number;
  regionsBelowMinSize: number;
  preservedDetailCount: number;
  quantizationErrorLab: number;
  runtimeBreakdownMs: {
    smoothingMs: number;
    clusteringMs: number;
    paletteMappingMs: number;
    regionExtractionMs: number;
    cleanupMs: number;
    totalMs: number;
  };
  colorClusters: Array<{
    clusterIndex: number;
    lab: [number, number, number];
    rgb: RGB;
    paletteHex: string;
    deltaE: number;
    pixelCount: number;
  }>;
}

export interface SimplifiedImageResult {
  source: RasterImage;
  simplified: RasterImage;
  regions: ImageRegion[];
  regionGraph: RegionGraph;
  diagnostics: SimplificationDiagnostics;
}

const LEVEL_PRESETS: Record<SimplificationLevel, Required<Omit<SimplificationOptions, 'level' | 'seed'>>> = {
  VERY_COARSE: {
    minColors: 4,
    maxColors: 8,
    minRegionAreaFraction: 0.008, // 0.8% of canvas (~520 px on 210x310)
    preserveSalientFeatures: true,
    saliencyThreshold: 0.40,
    enableSmoothing: true,
    smoothingSpatialSigma: 3.0,
    smoothingRangeSigma: 20.0
  },
  COARSE: {
    minColors: 6,
    maxColors: 10,
    minRegionAreaFraction: 0.005, // 0.5% (~325 px)
    preserveSalientFeatures: true,
    saliencyThreshold: 0.35,
    enableSmoothing: true,
    smoothingSpatialSigma: 2.5,
    smoothingRangeSigma: 18.0
  },
  MEDIUM: {
    minColors: 8,
    maxColors: 14,
    minRegionAreaFraction: 0.0035, // 0.35% (~227 px)
    preserveSalientFeatures: true,
    saliencyThreshold: 0.30,
    enableSmoothing: true,
    smoothingSpatialSigma: 2.0,
    smoothingRangeSigma: 15.0
  },
  FINE: {
    minColors: 12,
    maxColors: 18,
    minRegionAreaFraction: 0.002, // 0.20% (~130 px)
    preserveSalientFeatures: true,
    saliencyThreshold: 0.25,
    enableSmoothing: true,
    smoothingSpatialSigma: 1.5,
    smoothingRangeSigma: 12.0
  }
};

/**
 * Deterministic PRNG using Mulberry32.
 */
function createMulberry32(seed: number) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adaptive Image Simplifier for preprocessing arbitrary source images into
 * coherent macro-regions suitable for geometric layer reconstruction.
 */
export class ImageSimplifier {
  /**
   * Main entry point to simplify a source raster image.
   */
  public static simplify(
    source: RasterImage,
    options: SimplificationOptions = {}
  ): SimplifiedImageResult {
    const level = options.level || 'MEDIUM';
    const preset = LEVEL_PRESETS[level];
    const resolved = {
      level,
      minColors: options.minColors ?? preset.minColors,
      maxColors: options.maxColors ?? preset.maxColors,
      minRegionAreaFraction: options.minRegionAreaFraction ?? preset.minRegionAreaFraction,
      preserveSalientFeatures: options.preserveSalientFeatures ?? preset.preserveSalientFeatures,
      saliencyThreshold: options.saliencyThreshold ?? preset.saliencyThreshold,
      enableSmoothing: options.enableSmoothing ?? preset.enableSmoothing,
      smoothingSpatialSigma: options.smoothingSpatialSigma ?? preset.smoothingSpatialSigma,
      smoothingRangeSigma: options.smoothingRangeSigma ?? preset.smoothingRangeSigma,
      seed: options.seed ?? 42
    };

    const w = source.width;
    const h = source.height;
    const totalPixels = w * h;
    const rng = createMulberry32(resolved.seed);

    const tStart = Date.now();

    // 1. Convert source RGB to Lab buffers
    const labL = new Float32Array(totalPixels);
    const labA = new Float32Array(totalPixels);
    const labB = new Float32Array(totalPixels);
    const alphaBuf = new Uint8Array(totalPixels);

    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      const r = source.data[idx];
      const g = source.data[idx + 1];
      const b = source.data[idx + 2];
      const a = source.data[idx + 3];
      alphaBuf[i] = a;

      if (a < 10) {
        // Transparent default to white Lab for clean border math
        labL[i] = 100;
        labA[i] = 0;
        labB[i] = 0;
      } else {
        const lab = rgbToLab({ r, g, b });
        labL[i] = lab.L;
        labA[i] = lab.a;
        labB[i] = lab.b;
      }
    }

    // 2. Edge-Preserving Bilateral Smoothing
    const tSmoothingStart = Date.now();
    let smoothL = labL;
    let smoothA = labA;
    let smoothB = labB;

    if (resolved.enableSmoothing) {
      smoothL = new Float32Array(totalPixels);
      smoothA = new Float32Array(totalPixels);
      smoothB = new Float32Array(totalPixels);

      const radius = 2; // 5x5 window
      const spatialSigmaSq2 = 2 * resolved.smoothingSpatialSigma * resolved.smoothingSpatialSigma;
      const rangeSigmaSq2 = 2 * resolved.smoothingRangeSigma * resolved.smoothingRangeSigma;

      // Spatial Gaussian kernel cache
      const spatialKernel = new Float32Array(25);
      let kIdx = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          spatialKernel[kIdx++] = Math.exp(-(dx * dx + dy * dy) / spatialSigmaSq2);
        }
      }

      for (let y = 0; y < h; y++) {
        const rowOffset = y * w;
        for (let x = 0; x < w; x++) {
          const centerIdx = rowOffset + x;
          const cL = labL[centerIdx];
          const ca = labA[centerIdx];
          const cb = labB[centerIdx];

          let weightSum = 0;
          let sumL = 0;
          let suma = 0;
          let sumb = 0;
          let kernelIdx = 0;

          for (let dy = -radius; dy <= radius; dy++) {
            const ny = y + dy;
            if (ny < 0 || ny >= h) {
              kernelIdx += (radius * 2 + 1);
              continue;
            }
            const nRowOffset = ny * w;
            for (let dx = -radius; dx <= radius; dx++) {
              const nx = x + dx;
              const sWeight = spatialKernel[kernelIdx++];
              if (nx < 0 || nx >= w) continue;

              const nIdx = nRowOffset + nx;
              const nL = labL[nIdx];
              const na = labA[nIdx];
              const nb = labB[nIdx];

              const dL = cL - nL;
              const da = ca - na;
              const db = cb - nb;
              const distRangeSq = dL * dL + da * da + db * db;
              const rWeight = Math.exp(-distRangeSq / rangeSigmaSq2);
              const weight = sWeight * rWeight;

              weightSum += weight;
              sumL += nL * weight;
              suma += na * weight;
              sumb += nb * weight;
            }
          }

          if (weightSum > 1e-4) {
            smoothL[centerIdx] = sumL / weightSum;
            smoothA[centerIdx] = suma / weightSum;
            smoothB[centerIdx] = sumb / weightSum;
          } else {
            smoothL[centerIdx] = cL;
            smoothA[centerIdx] = ca;
            smoothB[centerIdx] = cb;
          }
        }
      }
    }
    const smoothingMs = Date.now() - tSmoothingStart;

    // 3. Saliency / Detail Contrast Map
    const saliencyMap = new Float32Array(totalPixels);
    for (let y = 1; y < h - 1; y++) {
      const rowOffset = y * w;
      for (let x = 1; x < w - 1; x++) {
        const idx = rowOffset + x;
        const dLx = smoothL[idx + 1] - smoothL[idx - 1];
        const dLy = smoothL[idx + w] - smoothL[idx - w];
        const dAx = smoothA[idx + 1] - smoothA[idx - 1];
        const dAy = smoothA[idx + w] - smoothA[idx - w];
        const dBx = smoothB[idx + 1] - smoothB[idx - 1];
        const dBy = smoothB[idx + w] - smoothB[idx - w];

        const gradMag = Math.sqrt(
          dLx * dLx + dLy * dLy +
          dAx * dAx + dAy * dAy +
          dBx * dBx + dBy * dBy
        );
        saliencyMap[idx] = Math.min(1.0, gradMag / 60.0);
      }
    }

    // 4. Perceptual Color Clustering (Lab K-Means with Adaptive K)
    const tClusteringStart = Date.now();

    // Calculate total Lab standard deviation to adaptively choose K
    let meanL = 0, meanA = 0, meanB = 0;
    for (let i = 0; i < totalPixels; i++) {
      meanL += smoothL[i];
      meanA += smoothA[i];
      meanB += smoothB[i];
    }
    meanL /= totalPixels;
    meanA /= totalPixels;
    meanB /= totalPixels;

    let varL = 0, varA = 0, varB = 0;
    for (let i = 0; i < totalPixels; i++) {
      const dL = smoothL[i] - meanL;
      const da = smoothA[i] - meanA;
      const db = smoothB[i] - meanB;
      varL += dL * dL;
      varA += da * da;
      varB += db * db;
    }
    const totalStdDev = Math.sqrt((varL + varA + varB) / totalPixels);

    // Adaptive K selection
    const kFraction = Math.max(0, Math.min(1, (totalStdDev - 15) / 35));
    const targetK = Math.round(resolved.minColors + (resolved.maxColors - resolved.minColors) * kFraction);
    const K = Math.max(resolved.minColors, Math.min(resolved.maxColors, targetK));

    // K-Means++ initialization
    const clusterCentersL = new Float32Array(K);
    const clusterCentersA = new Float32Array(K);
    const clusterCentersB = new Float32Array(K);

    // Pick first center deterministically
    const firstIdx = Math.floor(rng() * totalPixels);
    clusterCentersL[0] = smoothL[firstIdx];
    clusterCentersA[0] = smoothA[firstIdx];
    clusterCentersB[0] = smoothB[firstIdx];

    const distSqToClosest = new Float32Array(totalPixels);
    for (let k = 1; k < K; k++) {
      let sumDistSq = 0;
      for (let i = 0; i < totalPixels; i++) {
        const dL = smoothL[i] - clusterCentersL[k - 1];
        const da = smoothA[i] - clusterCentersA[k - 1];
        const db = smoothB[i] - clusterCentersB[k - 1];
        const distSq = dL * dL + da * da + db * db;
        if (k === 1 || distSq < distSqToClosest[i]) {
          distSqToClosest[i] = distSq;
        }
        sumDistSq += distSqToClosest[i] * (1.0 + 3.0 * saliencyMap[i]);
      }

      // Sample next center proportional to distance squared and saliency
      let targetVal = rng() * sumDistSq;
      let chosenIdx = 0;
      for (let i = 0; i < totalPixels; i++) {
        targetVal -= distSqToClosest[i] * (1.0 + 3.0 * saliencyMap[i]);
        if (targetVal <= 0) {
          chosenIdx = i;
          break;
        }
      }
      clusterCentersL[k] = smoothL[chosenIdx];
      clusterCentersA[k] = smoothA[chosenIdx];
      clusterCentersB[k] = smoothB[chosenIdx];
    }

    // Run K-Means iterations
    const pixelAssignments = new Uint8Array(totalPixels);
    const maxIters = 12;
    const clusterCounts = new Int32Array(K);
    const sumClusterL = new Float32Array(K);
    const sumClusterA = new Float32Array(K);
    const sumClusterB = new Float32Array(K);

    for (let iter = 0; iter < maxIters; iter++) {
      clusterCounts.fill(0);
      sumClusterL.fill(0);
      sumClusterA.fill(0);
      sumClusterB.fill(0);

      for (let i = 0; i < totalPixels; i++) {
        const pL = smoothL[i];
        const pa = smoothA[i];
        const pb = smoothB[i];

        let bestK = 0;
        let bestDistSq = Infinity;

        for (let k = 0; k < K; k++) {
          const dL = pL - clusterCentersL[k];
          const da = pa - clusterCentersA[k];
          const db = pb - clusterCentersB[k];
          const distSq = dL * dL + da * da + db * db;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestK = k;
          }
        }

        pixelAssignments[i] = bestK;
        clusterCounts[bestK]++;
        sumClusterL[bestK] += pL;
        sumClusterA[bestK] += pa;
        sumClusterB[bestK] += pb;
      }

      // Update cluster centers
      let maxShift = 0;
      for (let k = 0; k < K; k++) {
        if (clusterCounts[k] > 0) {
          const newL = sumClusterL[k] / clusterCounts[k];
          const newA = sumClusterA[k] / clusterCounts[k];
          const newB = sumClusterB[k] / clusterCounts[k];
          const shift = Math.sqrt(
            Math.pow(newL - clusterCentersL[k], 2) +
            Math.pow(newA - clusterCentersA[k], 2) +
            Math.pow(newB - clusterCentersB[k], 2)
          );
          if (shift > maxShift) maxShift = shift;
          clusterCentersL[k] = newL;
          clusterCentersA[k] = newA;
          clusterCentersB[k] = newB;
        }
      }

      if (maxShift < 0.2) break;
    }

    const clusteringMs = Date.now() - tClusteringStart;

    // 5. Mapping Representative Cluster Colors to Epic Seven Palette
    const tPaletteStart = Date.now();
    const clusterDiagnostics: SimplificationDiagnostics['colorClusters'] = [];
    const clusterPaletteHex = new Array<string>(K);
    const clusterPaletteIdx = new Int8Array(K);
    const clusterRepresentativeRgb = new Array<RGB>(K);

    let totalQuantErrorLab = 0;

    for (let k = 0; k < K; k++) {
      const lab: Lab = {
        L: clusterCentersL[k],
        a: clusterCentersA[k],
        b: clusterCentersB[k]
      };
      const repRgb = labToRgb(lab);
      const paletteMatch = findClosestPaletteColorFromLab(lab);

      clusterPaletteHex[k] = paletteMatch.hex;
      clusterPaletteIdx[k] = paletteMatch.paletteIndex;
      clusterRepresentativeRgb[k] = repRgb;

      clusterDiagnostics.push({
        clusterIndex: k,
        lab: [lab.L, lab.a, lab.b],
        rgb: repRgb,
        paletteHex: paletteMatch.hex,
        deltaE: paletteMatch.distance * 100.0,
        pixelCount: clusterCounts[k]
      });
    }

    for (let i = 0; i < totalPixels; i++) {
      const k = pixelAssignments[i];
      const dL = smoothL[i] - clusterCentersL[k];
      const da = smoothA[i] - clusterCentersA[k];
      const db = smoothB[i] - clusterCentersB[k];
      totalQuantErrorLab += Math.sqrt(dL * dL + da * da + db * db);
    }
    const quantizationErrorLab = totalQuantErrorLab / totalPixels;
    const paletteMappingMs = Date.now() - tPaletteStart;

    // 6. Spatial Region Extraction (Connected Components on Quantized Image)
    const tExtractionStart = Date.now();
    const pixelPaletteIndex = new Int8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      pixelPaletteIndex[i] = clusterPaletteIdx[pixelAssignments[i]];
    }

    // Run 8-connected BFS
    const visited = new Uint8Array(totalPixels);
    const queue = new Int32Array(totalPixels);
    const rawRegionsList: Array<{
      id: number;
      paletteIdx: number;
      pixels: number[];
      minX: number;
      minY: number;
      maxX: number;
      maxY: number;
      meanSaliency: number;
    }> = [];

    const neighbors = [
      [0, -1], [1, -1], [1, 0], [1, 1],
      [0, 1], [-1, 1], [-1, 0], [-1, -1]
    ];

    let compId = 0;
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w;
      for (let x = 0; x < w; x++) {
        const startIdx = rowOffset + x;
        if (visited[startIdx]) continue;

        const targetPal = pixelPaletteIndex[startIdx];
        let qHead = 0;
        let qTail = 0;
        queue[qTail++] = startIdx;
        visited[startIdx] = 1;

        const compPixels: number[] = [];
        let minX = x, maxX = x, minY = y, maxY = y;
        let sumSaliency = 0;

        while (qHead < qTail) {
          const currIdx = queue[qHead++];
          compPixels.push(currIdx);
          const cx = currIdx % w;
          const cy = (currIdx / w) | 0;

          if (cx < minX) minX = cx;
          if (cx > maxX) maxX = cx;
          if (cy < minY) minY = cy;
          if (cy > maxY) maxY = cy;

          sumSaliency += saliencyMap[currIdx];

          for (let n = 0; n < 8; n++) {
            const nx = cx + neighbors[n][0];
            const ny = cy + neighbors[n][1];
            if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
              const nIdx = ny * w + nx;
              if (!visited[nIdx] && pixelPaletteIndex[nIdx] === targetPal) {
                visited[nIdx] = 1;
                queue[qTail++] = nIdx;
              }
            }
          }
        }

        rawRegionsList.push({
          id: compId++,
          paletteIdx: targetPal,
          pixels: compPixels,
          minX,
          minY,
          maxX,
          maxY,
          meanSaliency: sumSaliency / compPixels.length
        });
      }
    }
    const rawRegionCount = rawRegionsList.length;
    const regionExtractionMs = Date.now() - tExtractionStart;

    // 7. Island Merging & Salient Feature Preservation
    const tCleanupStart = Date.now();
    const minPixelThreshold = Math.max(16, Math.floor(resolved.minRegionAreaFraction * totalPixels));
    const minDetailPixelFloor = Math.max(12, Math.floor(totalPixels * 0.0003)); // ~20 px

    // Construct pixel region map
    const pixelToRegionId = new Int32Array(totalPixels);
    for (const r of rawRegionsList) {
      for (const p of r.pixels) {
        pixelToRegionId[p] = r.id;
      }
    }

    // Helper to evaluate border adjacency
    function getNeighborContacts(r: { id: number; pixels: number[] }): Map<number, number> {
      const neighborHits = new Map<number, number>();
      for (const p of r.pixels) {
        const px = p % w;
        const py = (p / w) | 0;
        for (let n = 0; n < 4; n++) {
          const nx = px + neighbors[n * 2][0];
          const ny = py + neighbors[n * 2][1];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nIdx = ny * w + nx;
            const nRegionId = pixelToRegionId[nIdx];
            if (nRegionId !== r.id) {
              neighborHits.set(nRegionId, (neighborHits.get(nRegionId) || 0) + 1);
            }
          }
        }
      }
      return neighborHits;
    }

    // Pre-identify background candidate regions prior to island merging
    const isCandidateBg = new Uint8Array(rawRegionsList.length);
    for (let rId = 0; rId < rawRegionsList.length; rId++) {
      const r = rawRegionsList[rId];
      let topTouch = false, bottomTouch = false, leftTouch = false, rightTouch = false;
      for (const p of r.pixels) {
        const px = p % w;
        const py = (p / w) | 0;
        if (py === 0) topTouch = true;
        if (py === h - 1) bottomTouch = true;
        if (px === 0) leftTouch = true;
        if (px === w - 1) rightTouch = true;
      }
      const borderTouches = (topTouch ? 1 : 0) + (bottomTouch ? 1 : 0) + (leftTouch ? 1 : 0) + (rightTouch ? 1 : 0);
      const areaFraction = r.pixels.length / totalPixels;
      if (borderTouches === 4 && areaFraction >= 0.20) {
        isCandidateBg[rId] = 1;
      } else if (borderTouches >= 3 && areaFraction >= 0.55) {
        isCandidateBg[rId] = 1;
      }
    }

    // Identify preserved detail regions (e.g. eyes, pupils, small accessories, line art)
    const isPreserved = new Uint8Array(rawRegionsList.length);
    let preservedDetailCount = 0;
    if (resolved.preserveSalientFeatures) {
      for (let rId = 0; rId < rawRegionsList.length; rId++) {
        const r = rawRegionsList[rId];
        // Details must have at least minDetailPixelFloor (prevents 1-5px AA fringe noise)
        // and must be smaller than minPixelThreshold
        if (r.pixels.length >= minDetailPixelFloor && r.pixels.length < minPixelThreshold) {
          const neighborHits = getNeighborContacts(r);
          let totalBorder = 0;
          let maxSingleBorder = 0;
          let primaryNeighborId = -1;
          for (const [nId, contacts] of neighborHits.entries()) {
            totalBorder += contacts;
            if (contacts > maxSingleBorder) {
              maxSingleBorder = contacts;
              primaryNeighborId = nId;
            }
          }

          if (totalBorder > 0 && primaryNeighborId >= 0) {
            const enclosureRatio = maxSingleBorder / totalBorder;
            const primaryNeighbor = rawRegionsList[primaryNeighborId];
            const rLab = rgbToLab(hexToRgb(EPIC7_PALETTE_HEX[r.paletteIdx]));
            const nLab = rgbToLab(hexToRgb(EPIC7_PALETTE_HEX[primaryNeighbor.paletteIdx]));
            const colorDeltaE = Math.sqrt(
              Math.pow(rLab.L - nLab.L, 2) +
              Math.pow(rLab.a - nLab.a, 2) +
              Math.pow(rLab.b - nLab.b, 2)
            );

            // True salient detail is enclosed by parent (>50%) or distinct contrast against background
            const touchesBg = isCandidateBg[primaryNeighborId] === 1;
            if (
              (enclosureRatio >= 0.50 && colorDeltaE >= 12.0 && r.meanSaliency >= resolved.saliencyThreshold) ||
              (touchesBg && colorDeltaE >= 14.0 && r.meanSaliency >= resolved.saliencyThreshold * 0.4)
            ) {
              isPreserved[rId] = 1;
              preservedDetailCount++;
            }
          }
        }
      }
    }

    // Sort regions by size ascending so smallest islands merge first into larger bodies
    const regionsToMerge = rawRegionsList
      .filter(r => r.pixels.length < minPixelThreshold && !isPreserved[r.id])
      .sort((a, b) => a.pixels.length - b.pixels.length);

    let regionsBelowMinSize = 0;
    for (const r of regionsToMerge) {
      if (r.pixels.length === 0) continue;
      regionsBelowMinSize++;

      const neighborHits = getNeighborContacts(r);

      if (neighborHits.size > 0) {
        const rLab = rgbToLab(hexToRgb(EPIC7_PALETTE_HEX[r.paletteIdx]));
        let bestNeighborId = -1;
        let bestCost = Infinity;

        for (const [nId, borderContacts] of neighborHits.entries()) {
          const targetRegion = rawRegionsList[nId];
          if (!targetRegion || targetRegion.pixels.length === 0) continue;
          const nLab = rgbToLab(hexToRgb(EPIC7_PALETTE_HEX[targetRegion.paletteIdx]));

          const dL = rLab.L - nLab.L;
          const da = rLab.a - nLab.a;
          const db = rLab.b - nLab.b;
          const dE = Math.sqrt(dL * dL + da * da + db * db);

          // If target is background:
          if (isCandidateBg[nId]) {
            // Tiny isolated noise (<= 4 px) can merge into background to clean up AA noise speckles.
            // But visible foreground features (>= 5 px with dE >= 12) must NEVER merge into background!
            if (r.pixels.length >= 5 && dE >= 12.0) {
              continue;
            }
          }

          const cost = dE / (1.0 + Math.log(borderContacts + 1));
          if (cost < bestCost) {
            bestCost = cost;
            bestNeighborId = nId;
          }
        }

        if (bestNeighborId >= 0) {
          const target = rawRegionsList[bestNeighborId];
          for (const p of r.pixels) {
            pixelToRegionId[p] = target.id;
            pixelPaletteIndex[p] = target.paletteIdx;
            target.pixels.push(p);
          }
          if (r.minX < target.minX) target.minX = r.minX;
          if (r.maxX > target.maxX) target.maxX = r.maxX;
          if (r.minY < target.minY) target.minY = r.minY;
          if (r.maxY > target.maxY) target.maxY = r.maxY;
          r.pixels = [];
        } else {
          // If a visible feature (>= 5 px) cannot merge into background, preserve it!
          if (r.pixels.length >= 5) {
            isPreserved[r.id] = 1;
          }
        }
      }
    }

    // 8. Construct Final Coherent Regions
    const finalRegions: ImageRegion[] = [];
    const activeRawRegions = rawRegionsList.filter(r => r.pixels.length > 0);

    // Re-index pixelToRegionId to contiguous [0, activeCount - 1]
    const finalRegionIdMap = new Map<number, number>();
    activeRawRegions.forEach((r, idx) => finalRegionIdMap.set(r.id, idx));

    const finalPixelRegionMap = new Int32Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      finalPixelRegionMap[i] = finalRegionIdMap.get(pixelToRegionId[i]) ?? 0;
    }

    for (let idx = 0; idx < activeRawRegions.length; idx++) {
      const r = activeRawRegions[idx];
      const count = r.pixels.length;

      // Centroid
      let sumX = 0, sumY = 0;
      for (const p of r.pixels) {
        sumX += p % w;
        sumY += (p / w) | 0;
      }
      const cx = sumX / count;
      const cy = sumY / count;

      // Central moments
      let mu20 = 0, mu02 = 0, mu11 = 0;
      for (const p of r.pixels) {
        const px = p % w;
        const py = (p / w) | 0;
        const dx = px - cx;
        const dy = py - cy;
        mu20 += dx * dx;
        mu02 += dy * dy;
        mu11 += dx * dy;
      }

      mu20 /= count;
      mu02 /= count;
      mu11 /= count;

      const delta = mu20 - mu02;
      const sqrtTerm = Math.sqrt(delta * delta + 4 * mu11 * mu11);
      const lambda1 = Math.max(0.1, (mu20 + mu02 + sqrtTerm) / 2);
      const lambda2 = Math.max(0.1, (mu20 + mu02 - sqrtTerm) / 2);

      const majorR = Math.max(1.0, 2.0 * Math.sqrt(lambda1));
      const minorR = Math.max(1.0, 2.0 * Math.sqrt(lambda2));
      const orientationRad = 0.5 * Math.atan2(2 * mu11, delta);
      const orientationDeg = (orientationRad * 180) / Math.PI;

      // Background heuristic: touches 3 borders AND area fraction >= 0.15
      let topTouch = false, bottomTouch = false, leftTouch = false, rightTouch = false;
      for (const p of r.pixels) {
        const px = p % w;
        const py = (p / w) | 0;
        if (py === 0) topTouch = true;
        if (py === h - 1) bottomTouch = true;
        if (px === 0) leftTouch = true;
        if (px === w - 1) rightTouch = true;
      }
      const borderTouches = (topTouch ? 1 : 0) + (bottomTouch ? 1 : 0) + (leftTouch ? 1 : 0) + (rightTouch ? 1 : 0);
      const areaFraction = count / totalPixels;
      const isBackground = (borderTouches >= 3 && areaFraction >= 0.12) || (borderTouches >= 2 && areaFraction >= 0.25);

      const paletteHex = EPIC7_PALETTE_HEX[r.paletteIdx];
      const repRgb = hexToRgb(paletteHex);
      const repLab = rgbToLab(repRgb);

      // Find adjacent neighbors
      const neighborsSet = new Set<string>();
      for (const p of r.pixels) {
        const px = p % w;
        const py = (p / w) | 0;
        for (let n = 0; n < 4; n++) {
          const nx = px + neighbors[n * 2][0];
          const ny = py + neighbors[n * 2][1];
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            const nRegIdx = finalPixelRegionMap[ny * w + nx];
            if (nRegIdx !== idx) {
              neighborsSet.add(`region-${nRegIdx}`);
            }
          }
        }
      }

      finalRegions.push({
        id: `region-${idx}`,
        paletteIndex: r.paletteIdx,
        paletteHex,
        representativeRgb: repRgb,
        clusterColorLab: [repLab.L, repLab.a, repLab.b],
        deltaEToPalette: 0,
        pixelCount: count,
        areaFraction,
        centroid: { x: cx / w, y: cy / h },
        pixelCentroid: { x: cx, y: cy },
        bounds: {
          x: r.minX / w,
          y: r.minY / h,
          width: (r.maxX - r.minX + 1) / w,
          height: (r.maxY - r.minY + 1) / h
        },
        pixelBounds: {
          minX: r.minX,
          minY: r.minY,
          maxX: r.maxX,
          maxY: r.maxY
        },
        principalRadii: { major: majorR, minor: minorR },
        normalizedRadii: { major: majorR / w, minor: minorR / w },
        orientationDeg,
        isBackground,
        saliencyScore: r.meanSaliency,
        isPreservedDetail: isPreserved[r.id] === 1,
        neighborRegionIds: Array.from(neighborsSet)
      });
    }

    const cleanupMs = Date.now() - tCleanupStart;

    // 9. Construct Final Simplified Raster
    const simplifiedData = new Uint8ClampedArray(totalPixels * 4);
    for (let i = 0; i < totalPixels; i++) {
      const byteIdx = i * 4;
      const regIdx = finalPixelRegionMap[i];
      const region = finalRegions[regIdx];
      const rgb = region.representativeRgb;

      simplifiedData[byteIdx] = rgb.r;
      simplifiedData[byteIdx + 1] = rgb.g;
      simplifiedData[byteIdx + 2] = rgb.b;
      simplifiedData[byteIdx + 3] = alphaBuf[i] >= 10 ? 255 : 0;
    }

    const simplifiedRaster: RasterImage = {
      width: w,
      height: h,
      data: simplifiedData
    };

    // Calculate region size statistics
    const sizes = finalRegions.map(r => r.pixelCount).sort((a, b) => a - b);
    const medianRegionSize = sizes[Math.floor(sizes.length / 2)] || 0;
    const p90RegionSize = sizes[Math.floor(sizes.length * 0.9)] || 0;
    const largestRegionSize = sizes[sizes.length - 1] || 0;

    const uniquePaletteColors = new Set(finalRegions.map(r => r.paletteHex));
    const totalMs = Date.now() - tStart;

    const regionMap = new Map<string, ImageRegion>();
    for (const r of finalRegions) {
      regionMap.set(r.id, r);
    }

    const regionGraph: RegionGraph = {
      regions: finalRegions,
      regionMap,
      pixelRegionMap: finalPixelRegionMap,
      width: w,
      height: h
    };

    const diagnostics: SimplificationDiagnostics = {
      level: resolved.level,
      representativeColorCount: K,
      paletteColorCount: uniquePaletteColors.size,
      rawRegionCount,
      simplifiedRegionCount: finalRegions.length,
      medianRegionSize,
      p90RegionSize,
      largestRegionSize,
      regionsBelowMinSize,
      preservedDetailCount,
      quantizationErrorLab,
      runtimeBreakdownMs: {
        smoothingMs,
        clusteringMs,
        paletteMappingMs,
        regionExtractionMs,
        cleanupMs,
        totalMs
      },
      colorClusters: clusterDiagnostics
    };

    return {
      source,
      simplified: simplifiedRaster,
      regions: finalRegions,
      regionGraph,
      diagnostics
    };
  }
}

/**
 * Functional export matching:
 * const simplified = simplifyImage(sourceImage, options);
 */
export function simplifyImage(
  source: RasterImage,
  options: SimplificationOptions = {}
): SimplifiedImageResult {
  return ImageSimplifier.simplify(source, options);
}

/**
 * Functional export matching:
 * const regions = extractRegions(simplifiedResult);
 */
export function extractRegions(
  simplifiedResult: SimplifiedImageResult
): ImageRegion[] {
  return simplifiedResult.regions;
}

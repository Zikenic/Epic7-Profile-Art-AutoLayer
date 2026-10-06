import type { RasterImage } from './types.ts';
import { findClosestPaletteColor, type RGB } from './ColorSpaces.ts';

export interface ImageMomentsResult {
  hasForeground: boolean;
  totalMass: number;
  // Normalized canvas coordinates [0, 1]
  normalizedCentroid: { x: number; y: number };
  // Pixel coordinates
  pixelCentroid: { x: number; y: number };
  // Orientation angle in degrees [-90, 90]
  orientationDeg: number;
  // Principal radii (in normalized width units)
  principalRadii: { major: number; minor: number };
  // Bounding box in normalized canvas units
  normalizedBounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    width: number;
    height: number;
  };
  // Estimated layer opacity [0, 1]
  estimatedOpacity: number;
  // Estimated softness fraction (ratio of partial alpha pixels to total active pixels)
  softnessRatio: number;
  // Dominant palette color hex
  dominantColorHex: string;
  // Average foreground RGB
  averageRgb: RGB;
}

/**
 * Computes spatial moments, PCA orientation, bounding box, and color estimates for a target RasterImage.
 */
export function computeImageMoments(image: RasterImage): ImageMomentsResult {
  const { width, height, data } = image;
  let totalMass = 0;
  let m10 = 0;
  let m01 = 0;

  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  let maxAlpha = 0;
  let softPixelCount = 0;
  let solidPixelCount = 0;

  let weightedR = 0;
  let weightedG = 0;
  let weightedB = 0;
  let colorWeightSum = 0;

  // First pass: 0th and 1st order moments, bounding box, color
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] / 255.0;

      if (a > 0.01) {
        totalMass += a;
        m10 += x * a;
        m01 += y * a;

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;

        if (a > maxAlpha) maxAlpha = a;

        if (a >= 0.85) {
          solidPixelCount++;
        } else {
          softPixelCount++;
        }

        // Weight color by alpha for accurate chromatic recovery
        if (a > 0.15) {
          const w = a;
          weightedR += data[idx] * w;
          weightedG += data[idx + 1] * w;
          weightedB += data[idx + 2] * w;
          colorWeightSum += w;
        }
      }
    }
  }

  if (totalMass <= 0.001 || colorWeightSum <= 0.001) {
    return {
      hasForeground: false,
      totalMass: 0,
      normalizedCentroid: { x: 0.5, y: 0.5 },
      pixelCentroid: { x: width / 2, y: height / 2 },
      orientationDeg: 0,
      principalRadii: { major: 0.1, minor: 0.1 },
      normalizedBounds: { minX: 0.4, minY: 0.4, maxX: 0.6, maxY: 0.6, width: 0.2, height: 0.2 },
      estimatedOpacity: 1.0,
      softnessRatio: 0,
      dominantColorHex: '#586a8b',
      averageRgb: { r: 88, g: 106, b: 139 }
    };
  }

  const cx = m10 / totalMass;
  const cy = m01 / totalMass;

  // Second pass: 2nd order central moments for PCA
  let mu20 = 0;
  let mu02 = 0;
  let mu11 = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3] / 255.0;
      if (a > 0.01) {
        const dx = x - cx;
        const dy = y - cy;
        mu20 += dx * dx * a;
        mu02 += dy * dy * a;
        mu11 += dx * dy * a;
      }
    }
  }

  // PCA orientation angle
  const angleRad = 0.5 * Math.atan2(2 * mu11, mu20 - mu02);
  const orientationDeg = (angleRad * 180) / Math.PI;

  // Eigenvalues of covariance matrix
  const delta = Math.sqrt(Math.pow(mu20 - mu02, 2) + 4 * Math.pow(mu11, 2));
  const lambda1 = Math.max(0, (mu20 + mu02 + delta) / (2 * totalMass));
  const lambda2 = Math.max(0, (mu20 + mu02 - delta) / (2 * totalMass));

  const majorRadiusPx = 2 * Math.sqrt(lambda1);
  const minorRadiusPx = 2 * Math.sqrt(lambda2);

  const avgR = Math.round(weightedR / colorWeightSum);
  const avgG = Math.round(weightedG / colorWeightSum);
  const avgB = Math.round(weightedB / colorWeightSum);
  const avgRgb: RGB = { r: avgR, g: avgG, b: avgB };

  const closest = findClosestPaletteColor(avgRgb);

  const totalActivePixels = softPixelCount + solidPixelCount;
  const softnessRatio = totalActivePixels > 0 ? softPixelCount / totalActivePixels : 0;

  return {
    hasForeground: true,
    totalMass,
    normalizedCentroid: {
      x: cx / width,
      y: cy / height
    },
    pixelCentroid: { x: cx, y: cy },
    orientationDeg,
    principalRadii: {
      major: majorRadiusPx / width,
      minor: minorRadiusPx / width
    },
    normalizedBounds: {
      minX: minX / width,
      minY: minY / height,
      maxX: (maxX + 1) / width,
      maxY: (maxY + 1) / height,
      width: (maxX - minX + 1) / width,
      height: (maxY - minY + 1) / height
    },
    estimatedOpacity: Math.min(1.0, Math.max(0.05, maxAlpha)),
    softnessRatio,
    dominantColorHex: closest.hex,
    averageRgb: avgRgb
  };
}

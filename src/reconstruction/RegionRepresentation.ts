import type { RGB } from './ColorSpaces.ts';

/**
 * Coherent spatial region representation produced by the ImageSimplifier.
 */
export interface ImageRegion {
  id: string;
  paletteIndex: number;                       // 0..25 in EPIC7_PALETTE_HEX
  paletteHex: string;                         // Snapped Epic Seven color hex
  representativeRgb: RGB;                     // Pre-snapped cluster mean RGB
  clusterColorLab: [number, number, number];  // Pre-snapped cluster mean Lab [L, a, b]
  deltaEToPalette: number;                    // CIE76 Delta-E distance to snapped palette color

  pixelCount: number;                         // Total pixels in region
  areaFraction: number;                       // pixelCount / totalCanvasPixels

  centroid: { x: number; y: number };         // Normalized [0, 1] canvas coordinate
  pixelCentroid: { x: number; y: number };    // Absolute integer pixel coordinate

  bounds: { x: number; y: number; width: number; height: number }; // Normalized [0, 1] bounding box
  pixelBounds: { minX: number; minY: number; maxX: number; maxY: number };

  principalRadii: { major: number; minor: number };    // Pixel radii from central moments
  normalizedRadii: { major: number; minor: number };   // Radii divided by canvas width
  orientationDeg: number;                     // Principal orientation in degrees [-90, 90]

  contourComplexity?: number;                 // Normalized perimeter^2 / area
  isBackground: boolean;                      // True if touches multiple borders and covers large area
  saliencyScore: number;                      // Local contrast / feature salience [0..1]
  isPreservedDetail: boolean;                 // True if protected from island merging despite small size
  neighborRegionIds: string[];                // IDs of directly adjacent spatial regions
}

/**
 * Connected spatial graph representation of image regions.
 */
export interface RegionGraph {
  regions: ImageRegion[];
  regionMap: Map<string, ImageRegion>;
  pixelRegionMap: Int32Array;                 // Maps pixel index (y * w + x) to 0-based region index
  width: number;
  height: number;
}

/**
 * Helper to compute Euclidean distance in normalized coordinate space.
 */
export function distanceBetweenCentroids(
  c1: { x: number; y: number },
  c2: { x: number; y: number }
): number {
  const dx = c1.x - c2.x;
  const dy = c1.y - c2.y;
  return Math.sqrt(dx * dx + dy * dy);
}

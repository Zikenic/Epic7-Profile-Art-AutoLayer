/**
 * Type definitions for the Shape Calibration & Geometry Inspection System (Phase 2A).
 */

export interface BoundingBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface PaddingInfo {
  left: number;
  right: number;
  top: number;
  bottom: number;
  normLeft: number;
  normRight: number;
  normTop: number;
  normBottom: number;
}

export interface CenterCoords {
  x: number;
  y: number;
}

export interface ShapeCenters {
  image: CenterCoords;
  foregroundBBox: CenterCoords;
  alphaCentroid: CenterCoords;
  offsetBBoxFromImage: CenterCoords;
  offsetCentroidFromImage: CenterCoords;
}

export interface SymmetryMetrics {
  horizontal: number; // 0 to 100%
  vertical: number;   // 0 to 100%
}

export interface PixelCounts {
  opaque: number;
  partial: number;
  transparent: number;
  total: number;
  percentOpaque: number;
  percentPartial: number;
  percentTransparent: number;
}

export type CandidatePrimitiveType =
  | 'circle'
  | 'capsule'
  | 'semicircle'
  | 'rounded_rect'
  | 'polygon_triangle'
  | 'star_10'
  | 'radial_glow'
  | 'heart_bezier'
  | 'custom_bezier'
  | 'vector_path';

export interface PrimitiveFitParameters {
  type: CandidatePrimitiveType;
  cx: number;
  cy: number;
  radius?: number;
  radiusX?: number;
  radiusY?: number;
  width?: number;
  height?: number;
  cornerRadius?: number;
  innerRadius?: number;
  outerRadius?: number;
  points?: { x: number; y: number }[];
  flatEdge?: 'top' | 'bottom' | 'left' | 'right';
  falloff?: 'cosine' | 'gaussian' | 'smoothstep';
}

export interface FitErrorMetrics {
  iou: number;               // Intersection over Union [0.0, 1.0]
  meanAbsoluteAlphaError: number; // Mean alpha difference [0.0, 1.0]
  pixelDisagreementCount: number;
  pixelDisagreementPercent: number;
  boundaryDistancePx?: number;
}

export interface RadialFalloffPoint {
  radius: number;
  meanAlpha: number;
}

export interface ShapeCalibrationResult {
  assetId: string;
  filename: string;
  sourceWidth: number;
  sourceHeight: number;
  alphaThreshold: number; // 0 to 255
  foregroundBounds: BoundingBox;
  padding: PaddingInfo;
  centers: ShapeCenters;
  symmetry: SymmetryMetrics;
  pixels: PixelCounts;
  candidatePrimitive: PrimitiveFitParameters;
  fitMetrics?: FitErrorMetrics;
  radialProfile?: RadialFalloffPoint[];
  analyzedAt: string;
}

export interface ColorSwatchDetail {
  palette: string;
  row: number;
  col: number;
  index: number;
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsv: { h: number; s: number; v: number };
  hsl: { h: number; s: number; l: number };
}

export interface PaletteAnalysisDetail {
  id: string;
  filename: string;
  width: number;
  height: number;
  grid: { rows: number; cols: number; swatchSize: number; pitch: number };
  colors: ColorSwatchDetail[];
}

export interface CalibrationDatabase {
  version: 1;
  description: string;
  generatedAt: string;
  shapes: Record<string, ShapeCalibrationResult>;
  palettes: Record<string, PaletteAnalysisDetail>;
}

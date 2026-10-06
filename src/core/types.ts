/**
 * Types and interfaces for the Epic Seven Profile Art Shape Editor.
 *
 * Designed for strict separation of concerns:
 * Shape Asset Loader -> Shape Representation -> Layer Model -> Renderer -> Editor UI
 */

export type ShapeCategory = 'raster' | 'vector' | 'primitive';

export interface ShapeDefinition {
  id: string;
  name: string;
  type: ShapeCategory;
  width: number;
  height: number;
  aspectRatio: number;
  renderToContext(ctx: CanvasRenderingContext2D, width: number, height: number, color: string): void;
  getThumbnail(size?: number): string | HTMLCanvasElement;
}

export interface Layer {
  id: string;
  name: string;
  shapeAsset: string; // Reference to ShapeDefinition.id
  x: number;          // Normalized coordinate [0.0, 1.0], center of shape
  y: number;          // Normalized coordinate [0.0, 1.0], center of shape
  scaleX: number;     // Independent scale along X axis
  scaleY: number;     // Independent scale along Y axis
  rotation: number;   // Rotation in degrees (e.g. 0 to 360 or -180 to 180)
  color: string;      // Hex color (e.g. "#586a8b")
  opacity: number;    // Opacity [0.0, 1.0]
  visible: boolean;   // Visibility toggle
  locked: boolean;    // Lock layer transformations
}

export interface CanvasConfig {
  aspectRatio: '21:31';
  aspectRatioWidth: 21;
  aspectRatioHeight: 31;
  backgroundColor: string;
}

export interface ReferenceImageConfig {
  dataUrl?: string;
  filename?: string;
  opacity: number;
  visible: boolean;
  fit: 'contain' | 'cover';
  includeInExport: boolean;
}

export interface ProjectData {
  version: 1;
  name: string;
  canvas: CanvasConfig;
  layers: Layer[];
  referenceImage?: ReferenceImageConfig;
  createdAt?: string;
  updatedAt?: string;
}

export interface ColorPalette {
  id: string;
  name: string;
  filename: string;
  colors: string[];
}

export interface DiscoveredAssets {
  shapes: {
    id: string;
    name: string;
    filename: string;
    url: string;
  }[];
  palettes: {
    id: string;
    name: string;
    filename: string;
    url: string;
  }[];
}

export const MAX_LAYERS = 130;
export const CANVAS_ASPECT_RATIO = 21 / 31;
export const REFERENCE_CANVAS_WIDTH = 840;
export const REFERENCE_CANVAS_HEIGHT = 1240;

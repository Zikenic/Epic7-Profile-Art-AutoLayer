import type { Layer, ShapeDefinition } from './types.ts';
import { CANVAS_ASPECT_RATIO } from './types.ts';
import { shapeAssetLoader } from './ShapeAssetLoader.ts';
import { mathematicalShapeRegistry } from './MathematicalShapeRegistry.ts';
import { MathematicalShapeDefinition } from './MathematicalShapeDefinition.ts';
import { getShapeFrameCalibration } from './ShapeFrameCalibration.ts';

export type RenderMode = 'raster' | 'mathematical' | 'auto';

export interface RenderOptions {
  width: number;
  height: number;
  backgroundColor?: string;
  referenceImage?: HTMLImageElement | null;
  referenceOpacity?: number;
  referenceFit?: 'contain' | 'cover';
  renderMode?: RenderMode;
  useCompatibilityOffset?: boolean;
}

/**
 * Deterministic renderer that composites profile art layers in strict stacking order.
 * Guarantees identical output between canvas preview and exported PNG.
 *
 * Implements the Native Square Frame coordinate system:
 * Canvas -> Layer (x, y, rotation) -> Square Native Frame (scaleX, scaleY) -> Contained Shape Geometry
 */
export class DeterministicRenderer {
  /**
   * Calculates height from width enforcing the exact 21:31 ratio.
   */
  public static calculateDimensions(width: number): { width: number; height: number } {
    const height = Math.round(width / CANVAS_ASPECT_RATIO);
    return { width, height };
  }

  /**
   * Renders the complete composition onto any target Canvas 2D context.
   */
  public static render(
    ctx: CanvasRenderingContext2D,
    layers: readonly Layer[],
    options: RenderOptions
  ): void {
    const {
      width,
      height,
      backgroundColor = '#141721',
      renderMode = 'raster'
    } = options;

    ctx.save();

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw artboard background
    if (backgroundColor && backgroundColor !== 'transparent') {
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
    }

    // Draw optional reference image (if provided)
    if (options.referenceImage && (options.referenceOpacity ?? 0) > 0) {
      this.drawReferenceImage(
        ctx,
        options.referenceImage,
        width,
        height,
        options.referenceOpacity ?? 0.5,
        options.referenceFit ?? 'contain'
      );
    }

    // Render layers in stacking order (index 0 is bottom, index N-1 is top)
    for (const layer of layers) {
      if (!layer.visible || layer.opacity <= 0) {
        continue;
      }

      // Determine shape definition according to render mode
      let shapeDef: ShapeDefinition | undefined;
      let isMath = false;
      let mathDef: MathematicalShapeDefinition | undefined;

      if (renderMode === 'mathematical') {
        mathDef = mathematicalShapeRegistry.getPrimitive(layer.shapeAsset);
        if (mathDef) {
          shapeDef = mathDef;
          isMath = true;
        } else {
          shapeDef = shapeAssetLoader.getShape(layer.shapeAsset);
        }
      } else if (renderMode === 'auto') {
        mathDef = mathematicalShapeRegistry.getPrimitive(layer.shapeAsset);
        if (mathDef) {
          shapeDef = mathDef;
          isMath = true;
        } else {
          shapeDef = shapeAssetLoader.getShape(layer.shapeAsset);
        }
      } else {
        // 'raster' (default)
        shapeDef = shapeAssetLoader.getShape(layer.shapeAsset);
        if (!shapeDef) {
          mathDef = mathematicalShapeRegistry.getPrimitive(layer.shapeAsset);
          if (mathDef) {
            shapeDef = mathDef;
            isMath = true;
          }
        }
      }

      if (!shapeDef && !mathDef) {
        continue;
      }

      // Native square frame dimensions:
      // In Epic Seven, native frame is strictly SQUARE with width === height.
      // Frame size relative to canvas width is given by frameNormalizedSize.
      const calib = getShapeFrameCalibration(layer.shapeAsset);
      const frameNormSize = calib ? calib.frameNormalizedSize : (450 / 567);
      const nativeFrameSize = width * frameNormSize;

      // Frame stretched by layer scaleX and scaleY
      const currentFrameWidth = nativeFrameSize * layer.scaleX;
      const currentFrameHeight = nativeFrameSize * layer.scaleY;

      // Layer position in canvas coordinates (frame center placed at layer.x, layer.y)
      const cx = layer.x * width;
      const cy = layer.y * height;

      ctx.save();
      ctx.translate(cx, cy);
      if (layer.rotation !== 0) {
        ctx.rotate((layer.rotation * Math.PI) / 180.0);
      }
      ctx.globalAlpha = Math.max(0, Math.min(1, layer.opacity));

      // Geometry inside native frame:
      // Frame center is at (0, 0).
      // Shape geometry has fixed calibrated relative offset and scale inside the frame.
      const geomWidth = (calib ? calib.geometryScaleX : 0.8) * currentFrameWidth;
      const geomHeight = (calib ? calib.geometryScaleY : 0.8) * currentFrameHeight;
      const geomCenterX = (calib ? calib.geometryOffsetX : 0) * currentFrameWidth;
      const geomCenterY = (calib ? calib.geometryOffsetY : 0) * currentFrameHeight;

      ctx.save();
      ctx.translate(geomCenterX, geomCenterY);

      if (isMath && mathDef) {
        mathDef.renderToContext(ctx, geomWidth, geomHeight, layer.color);
      } else if (shapeDef) {
        shapeDef.renderToContext(ctx, geomWidth, geomHeight, layer.color);
      }

      ctx.restore();
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Helper to draw a reference image scaled to fit 21:31 canvas.
   */
  private static drawReferenceImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    canvasW: number,
    canvasH: number,
    opacity: number,
    fit: 'contain' | 'cover'
  ): void {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, opacity));

    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    const imgAspect = imgW / imgH;
    const canvasAspect = canvasW / canvasH;

    let drawW = canvasW;
    let drawH = canvasH;
    let dx = 0;
    let dy = 0;

    if (fit === 'contain') {
      if (imgAspect > canvasAspect) {
        drawW = canvasW;
        drawH = canvasW / imgAspect;
        dy = (canvasH - drawH) / 2;
      } else {
        drawH = canvasH;
        drawW = canvasH * imgAspect;
        dx = (canvasW - drawW) / 2;
      }
    } else {
      // cover
      if (imgAspect > canvasAspect) {
        drawH = canvasH;
        drawW = canvasH * imgAspect;
        dx = (canvasW - drawW) / 2;
      } else {
        drawW = canvasW;
        drawH = canvasW / imgAspect;
        dy = (canvasH - drawH) / 2;
      }
    }

    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.restore();
  }

  /**
   * Renders the composition to an offscreen canvas and returns a PNG Blob.
   */
  public static async exportToBlob(
    layers: readonly Layer[],
    options: RenderOptions
  ): Promise<Blob> {
    const offscreen = document.createElement('canvas');
    offscreen.width = options.width;
    offscreen.height = options.height;

    const ctx = offscreen.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get 2D rendering context for export.');
    }

    this.render(ctx, layers, options);

    return new Promise((resolve, reject) => {
      offscreen.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create PNG blob.'));
        }
      }, 'image/png');
    });
  }

  /**
   * Returns bounding box of the layer's native square frame in canvas coordinates.
   */
  public static getLayerBounds(
    layer: Layer,
    canvasW: number,
    canvasH: number,
    _shape?: ShapeDefinition
  ): {
    cx: number;
    cy: number;
    width: number;
    height: number;
    corners: { x: number; y: number }[];
  } {
    const cx = layer.x * canvasW;
    const cy = layer.y * canvasH;

    const calib = getShapeFrameCalibration(layer.shapeAsset);
    const frameNormSize = calib ? calib.frameNormalizedSize : (450 / 567);
    const nativeFrameSize = canvasW * frameNormSize;

    const targetW = nativeFrameSize * layer.scaleX;
    const targetH = nativeFrameSize * layer.scaleY;

    const halfW = targetW / 2;
    const halfH = targetH / 2;

    const rad = (layer.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    const localCorners = [
      { x: -halfW, y: -halfH }, // top-left
      { x: halfW, y: -halfH },  // top-right
      { x: halfW, y: halfH },   // bottom-right
      { x: -halfW, y: halfH }   // bottom-left
    ];

    const corners = localCorners.map(p => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos
    }));

    return {
      cx,
      cy,
      width: targetW,
      height: targetH,
      corners
    };
  }
}

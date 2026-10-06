import type { ShapeDefinition, ShapeCategory } from './types.ts';

/**
 * Implementation of ShapeDefinition for raster PNG assets.
 * Converts grey-on-white images to transparent alpha masks with anti-aliasing preserved,
 * and automatically crops to the true foreground bounding box so that the shape geometry
 * aligns perfectly with mathematical primitives and native square frames.
 */
export class RasterShapeDefinition implements ShapeDefinition {
  public readonly id: string;
  public readonly name: string;
  public readonly type: ShapeCategory = 'raster';
  public width: number;
  public height: number;
  public aspectRatio: number;

  private maskCanvas: HTMLCanvasElement;
  private tintCache: Map<string, HTMLCanvasElement> = new Map();
  private thumbnailCache: Map<number, string> = new Map();

  constructor(id: string, name: string, image: HTMLImageElement) {
    this.id = id;
    this.name = name;
    const rawW = image.naturalWidth || image.width;
    const rawH = image.naturalHeight || image.height;
    this.width = rawW;
    this.height = rawH;
    this.aspectRatio = rawW / rawH;

    // Create alpha mask canvas
    this.maskCanvas = document.createElement('canvas');
    this.preprocessMask(image, rawW, rawH);
  }

  /**
   * Preprocesses grey shape on pure white background to a clean alpha mask,
   * cropping out background padding to align with native frame geometry.
   * White (255, 255, 255) -> Alpha = 0.0 (transparent)
   * Slate Grey (88, 106, 139) -> Alpha = 1.0 (opaque)
   * Intermediate shades -> smooth anti-aliased alpha
   */
  private preprocessMask(image: HTMLImageElement, rawW: number, rawH: number): void {
    const rawCanvas = document.createElement('canvas');
    rawCanvas.width = rawW;
    rawCanvas.height = rawH;
    const ctx = rawCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(image, 0, 0);
    const imgData = ctx.getImageData(0, 0, rawW, rawH);
    const data = imgData.data;

    // Epic Seven shape foreground slate grey is (88, 106, 139)
    // Diff from pure white (255, 255, 255): 167 + 149 + 116 = 432
    const maxDiff = 432.0;

    let minX = rawW;
    let minY = rawH;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < rawH; y++) {
      for (let x = 0; x < rawW; x++) {
        const i = (y * rawW + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        let alpha: number;
        if (a < 250) {
          alpha = a / 255.0;
        } else {
          const diff = (255 - r) + (255 - g) + (255 - b);
          alpha = diff / maxDiff;
        }

        // Clean threshold for pure background to eliminate any potential noise
        if (alpha <= 0.005) {
          alpha = 0;
        } else if (alpha >= 0.99) {
          alpha = 1;
        }

        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = Math.round(alpha * 255);

        if (alpha > 0.01) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);

    // Crop to true foreground bounding box
    if (maxX >= minX && maxY >= minY) {
      const fgW = maxX - minX + 1;
      const fgH = maxY - minY + 1;
      this.width = fgW;
      this.height = fgH;
      this.aspectRatio = fgW / fgH;

      this.maskCanvas.width = fgW;
      this.maskCanvas.height = fgH;
      const mCtx = this.maskCanvas.getContext('2d');
      if (mCtx) {
        mCtx.drawImage(rawCanvas, minX, minY, fgW, fgH, 0, 0, fgW, fgH);
      }
    } else {
      this.maskCanvas.width = rawW;
      this.maskCanvas.height = rawH;
      const mCtx = this.maskCanvas.getContext('2d');
      if (mCtx) {
        mCtx.drawImage(rawCanvas, 0, 0);
      }
    }
  }

  /**
   * Returns a cached canvas containing the mask tinted with the requested color.
   */
  public getTintedCanvas(color: string): HTMLCanvasElement {
    const normalizedColor = color.toLowerCase();
    const cached = this.tintCache.get(normalizedColor);
    if (cached) return cached;

    const tintedCanvas = document.createElement('canvas');
    tintedCanvas.width = this.width;
    tintedCanvas.height = this.height;

    const tCtx = tintedCanvas.getContext('2d');
    if (tCtx) {
      // Step 1: Draw the base alpha mask
      tCtx.drawImage(this.maskCanvas, 0, 0);

      // Step 2: Tint mask using source-in compositing
      tCtx.globalCompositeOperation = 'source-in';
      tCtx.fillStyle = color;
      tCtx.fillRect(0, 0, this.width, this.height);
    }

    this.tintCache.set(normalizedColor, tintedCanvas);
    return tintedCanvas;
  }

  /**
   * Renders the tinted shape centered at (0,0) in the destination context.
   */
  public renderToContext(
    ctx: CanvasRenderingContext2D,
    targetWidth: number,
    targetHeight: number,
    color: string
  ): void {
    const tinted = this.getTintedCanvas(color);
    ctx.drawImage(
      tinted,
      -targetWidth / 2,
      -targetHeight / 2,
      targetWidth,
      targetHeight
    );
  }

  /**
   * Returns a data URL thumbnail of the shape.
   */
  public getThumbnail(size: number = 64): string {
    const cached = this.thumbnailCache.get(size);
    if (cached) return cached;

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = size;
    thumbCanvas.height = size;
    const tCtx = thumbCanvas.getContext('2d');
    if (tCtx) {
      const padding = 6;
      const avail = size - padding * 2;
      let w = avail;
      let h = avail;
      if (this.aspectRatio > 1) {
        h = avail / this.aspectRatio;
      } else {
        w = avail * this.aspectRatio;
      }

      const tinted = this.getTintedCanvas('#586a8b');
      tCtx.drawImage(
        tinted,
        (size - w) / 2,
        (size - h) / 2,
        w,
        h
      );
    }

    const dataUrl = thumbCanvas.toDataURL('image/png');
    this.thumbnailCache.set(size, dataUrl);
    return dataUrl;
  }
}

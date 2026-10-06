import type { ShapeDefinition, ShapeCategory } from './types.ts';
import type { CanonicalShapeData } from './MathematicalShapeData.ts';

export interface LocalBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

/**
 * Mathematical / Vector primitive implementation of ShapeDefinition (Phase 2B).
 *
 * Provides exact analytical and vector geometry centered at canonical (0, 0)
 * while exposing compatibility offsets for seamless backwards compatibility with Phase 1 raster assets.
 */
export class MathematicalShapeDefinition implements ShapeDefinition {
  public readonly id: string;
  public readonly name: string;
  public readonly type: ShapeCategory;
  public readonly primitiveType: string;
  public readonly width: number;
  public readonly height: number;
  public readonly aspectRatio: number;

  public readonly rasterSourceWidth: number;
  public readonly rasterSourceHeight: number;
  public readonly compatibilityOffset: { dx: number; dy: number };
  public readonly canonicalPivot: { x: number; y: number } = { x: 0, y: 0 };
  public readonly localBounds: LocalBounds;
  public readonly parameters: CanonicalShapeData['parameters'];
  public readonly metrics: CanonicalShapeData['metrics'];
  public readonly confidence: string;

  private thumbnailCache: Map<number, string> = new Map();

  constructor(data: CanonicalShapeData) {
    this.id = data.id;
    this.name = data.name;
    this.type = data.category;
    this.primitiveType = data.primitiveType;
    this.width = data.canonicalWidth;
    this.height = data.canonicalHeight;
    this.aspectRatio = this.width / this.height;

    this.rasterSourceWidth = data.rasterSourceWidth;
    this.rasterSourceHeight = data.rasterSourceHeight;
    this.compatibilityOffset = { ...data.compatibilityOffset };
    this.parameters = { ...data.parameters };
    this.metrics = { ...data.metrics };
    this.confidence = data.confidence;

    const halfW = this.width / 2;
    const halfH = this.height / 2;
    this.localBounds = {
      minX: -halfW,
      minY: -halfH,
      maxX: halfW,
      maxY: halfH,
      width: this.width,
      height: this.height
    };
  }

  public getLocalBounds(): LocalBounds {
    return { ...this.localBounds };
  }

  public getCanonicalPivot(): { x: number; y: number } {
    return { ...this.canonicalPivot };
  }

  public getParameters(): CanonicalShapeData['parameters'] {
    return { ...this.parameters };
  }

  public getCompatibilityOffset(): { dx: number; dy: number } {
    return { ...this.compatibilityOffset };
  }

  /**
   * Constructs the 2D path centered around (0, 0) into targetWidth x targetHeight dimensions.
   */
  public buildPath(ctx: CanvasRenderingContext2D, targetWidth: number, targetHeight: number): void {
    const halfW = targetWidth / 2;
    const halfH = targetHeight / 2;

    switch (this.primitiveType) {
      case 'circle': {
        ctx.ellipse(0, 0, halfW, halfH, 0, 0, Math.PI * 2);
        break;
      }

      case 'capsule': {
        const r = halfH;
        ctx.moveTo(-halfW + r, -halfH);
        ctx.lineTo(halfW - r, -halfH);
        ctx.arc(halfW - r, 0, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(-halfW + r, halfH);
        ctx.arc(-halfW + r, 0, r, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        break;
      }

      case 'rounded_rect': {
        const cornerParam = this.parameters.cornerRadius ?? 27.0;
        const cornerRatio = cornerParam / this.width;
        const r = Math.min(cornerRatio * targetWidth, Math.min(targetWidth, targetHeight) / 2);

        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(-halfW, -halfH, targetWidth, targetHeight, r);
        } else {
          ctx.moveTo(-halfW + r, -halfH);
          ctx.lineTo(halfW - r, -halfH);
          ctx.arcTo(halfW, -halfH, halfW, -halfH + r, r);
          ctx.lineTo(halfW, halfH - r);
          ctx.arcTo(halfW, halfH, halfW - r, halfH, r);
          ctx.lineTo(-halfW + r, halfH);
          ctx.arcTo(-halfW, halfH, -halfW, halfH - r, r);
          ctx.lineTo(-halfW, -halfH + r);
          ctx.arcTo(-halfW, -halfH, -halfW + r, -halfH, r);
          ctx.closePath();
        }
        break;
      }

      case 'semicircle': {
        // Dome facing upwards, baseline at bottom (y = halfH)
        // Authoritative circular arc matching Epic Seven reference raster (IoU: 0.9840)
        ctx.arc(0, halfH, halfW, Math.PI, 0, false);
        ctx.lineTo(halfW, halfH);
        ctx.lineTo(-halfW, halfH);
        ctx.closePath();
        break;
      }

      case 'polygon_triangle': {
        ctx.moveTo(0, -halfH);
        ctx.lineTo(halfW, halfH);
        ctx.lineTo(-halfW, halfH);
        ctx.closePath();
        break;
      }

      case 'star_10': {
        const pts = this.parameters.normalizedPoints;
        if (pts && pts.length > 0) {
          ctx.moveTo(pts[0][0] * targetWidth, pts[0][1] * targetHeight);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i][0] * targetWidth, pts[i][1] * targetHeight);
          }
          ctx.closePath();
          break;
        }

        const rOut = Math.min(halfW, halfH);
        const rInRatio = 90.0 / 186.0;
        const rIn = rOut * rInRatio;
        const numPoints = 5;
        const angleStep = Math.PI / numPoints;
        const startAngle = -Math.PI / 2;

        for (let i = 0; i < numPoints * 2; i++) {
          const r = i % 2 === 0 ? rOut : rIn;
          const angle = startAngle + i * angleStep;
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      }

      case 'vector_path': {
        const pts = this.parameters.normalizedPoints;
        if (pts && pts.length > 0) {
          ctx.moveTo(pts[0][0] * targetWidth, pts[0][1] * targetHeight);
          for (let i = 1; i < pts.length; i++) {
            ctx.lineTo(pts[i][0] * targetWidth, pts[i][1] * targetHeight);
          }
          ctx.closePath();
        }
        break;
      }

      case 'radial_glow': {
        const r = Math.min(halfW, halfH);
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.closePath();
        break;
      }

      default: {
        ctx.arc(0, 0, Math.min(halfW, halfH), 0, Math.PI * 2);
        ctx.closePath();
      }
    }
  }

  /**
   * Renders the mathematical primitive onto the target context centered at (0, 0).
   */
  public renderToContext(
    ctx: CanvasRenderingContext2D,
    targetWidth: number,
    targetHeight: number,
    color: string
  ): void {
    ctx.save();

    if (this.primitiveType === 'radial_glow') {
      const r = Math.min(targetWidth, targetHeight) / 2;
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);

      // Parse input color into RGBA for gradient stops
      const { r: cr, g: cg, b: cb } = this.parseHexColor(color);
      const maxA = this.parameters.maxAlpha ?? 0.9028;

      const stops: [number, number][] = [
        [0.0, 1.0],
        [0.1, 0.957],
        [0.2, 0.845],
        [0.3, 0.716],
        [0.4, 0.584],
        [0.5, 0.457],
        [0.6, 0.332],
        [0.7, 0.211],
        [0.8, 0.103],
        [0.9, 0.030],
        [1.0, 0.0]
      ];

      for (const [pos, alphaFrac] of stops) {
        grad.addColorStop(pos, `rgba(${cr}, ${cg}, ${cb}, ${(maxA * alphaFrac).toFixed(4)})`);
      }

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      this.buildPath(ctx, targetWidth, targetHeight);
      ctx.fillStyle = color;
      ctx.fill();
    }

    ctx.restore();
  }

  /**
   * Helper to parse hex colors to RGB components.
   */
  private parseHexColor(hex: string): { r: number; g: number; b: number } {
    let clean = hex.replace('#', '');
    if (clean.length === 3) {
      clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    if (isNaN(num)) {
      return { r: 88, g: 106, b: 139 };
    }
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  /**
   * Returns a thumbnail data URL for UI rendering.
   */
  public getThumbnail(size: number = 64): string {
    const cached = this.thumbnailCache.get(size);
    if (cached) return cached;

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = size;
      thumbCanvas.height = size;
      const tCtx = thumbCanvas.getContext('2d');
      if (tCtx) {
        const padding = 8;
        const avail = size - padding * 2;
        let w = avail;
        let h = avail;
        if (this.aspectRatio > 1) {
          h = avail / this.aspectRatio;
        } else {
          w = avail * this.aspectRatio;
        }

        tCtx.save();
        tCtx.translate(size / 2, size / 2);
        this.renderToContext(tCtx, w, h, '#586a8b');
        tCtx.restore();

        const dataUrl = thumbCanvas.toDataURL('image/png');
        this.thumbnailCache.set(size, dataUrl);
        return dataUrl;
      }
    }

    // Fallback data URL
    const fallback = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="#1e2330"/></svg>`;
    this.thumbnailCache.set(size, fallback);
    return fallback;
  }
}

import type { PrimitiveFitParameters, FitErrorMetrics } from './types.ts';

/**
 * Mathematical Primitives Engine for Phase 2A calibration and fitting.
 * Renders mathematical candidate shapes and evaluates IoU / error metrics against raster assets.
 */
export class MathematicalPrimitives {
  /**
   * Renders the mathematical primitive onto a Canvas 2D context.
   */
  public static draw(
    ctx: CanvasRenderingContext2D,
    params: PrimitiveFitParameters,
    options: {
      fillColor?: string;
      strokeColor?: string;
      lineWidth?: number;
      fillOpacity?: number;
      strokeOpacity?: number;
    } = {}
  ): void {
    const {
      fillColor = '#3b82f6',
      strokeColor = '#60a5fa',
      lineWidth = 2,
      fillOpacity = 0.5,
      strokeOpacity = 0.9
    } = options;

    ctx.save();

    ctx.beginPath();
    this.buildPath(ctx, params);

    if (fillOpacity > 0) {
      ctx.globalAlpha = fillOpacity;
      if (params.type === 'radial_glow') {
        const rad = params.radius || 165;
        const grad = ctx.createRadialGradient(params.cx, params.cy, 0, params.cx, params.cy, rad);
        grad.addColorStop(0, fillColor);
        grad.addColorStop(0.5, fillColor);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = fillColor;
      }
      ctx.fill();
    }

    if (strokeOpacity > 0 && lineWidth > 0 && params.type !== 'radial_glow') {
      ctx.globalAlpha = strokeOpacity;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }

    ctx.restore();
  }

  /**
   * Builds the 2D path corresponding to the mathematical primitive.
   */
  public static buildPath(ctx: CanvasRenderingContext2D, params: PrimitiveFitParameters): void {
    const { cx, cy } = params;

    switch (params.type) {
      case 'circle': {
        const rx = params.radiusX || params.radius || 180;
        const ry = params.radiusY || params.radius || 180;
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
        break;
      }

      case 'capsule': {
        const w = params.width || 360;
        const h = params.height || 140;
        const r = h / 2;
        const left = cx - w / 2;
        const right = cx + w / 2;
        const top = cy - h / 2;
        const bottom = cy + h / 2;

        ctx.moveTo(left + r, top);
        ctx.lineTo(right - r, top);
        ctx.arc(right - r, cy, r, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(left + r, bottom);
        ctx.arc(left + r, cy, r, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        break;
      }

      case 'semicircle': {
        const r = params.radius || 180;
        const orientation = params.flatEdge || 'bottom';
        if (orientation === 'bottom') {
          // Dome facing upwards, baseline at cy + r / 2 or cy
          const baselineY = cy + r / 2;
          ctx.arc(cx, baselineY, r, Math.PI, 0, false);
          ctx.lineTo(cx + r, baselineY);
          ctx.lineTo(cx - r, baselineY);
        } else {
          ctx.arc(cx, cy, r, 0, Math.PI, false);
        }
        ctx.closePath();
        break;
      }

      case 'rounded_rect': {
        const w = params.width || 324;
        const h = params.height || 324;
        const r = Math.min(params.cornerRadius || 27, Math.min(w, h) / 2);
        const left = cx - w / 2;
        const top = cy - h / 2;

        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(left, top, w, h, r);
        } else {
          // Manual fallback
          ctx.moveTo(left + r, top);
          ctx.lineTo(left + w - r, top);
          ctx.arcTo(left + w, top, left + w, top + r, r);
          ctx.lineTo(left + w, top + h - r);
          ctx.arcTo(left + w, top + h, left + w - r, top + h, r);
          ctx.lineTo(left + r, top + h);
          ctx.arcTo(left, top + h, left, top + h - r, r);
          ctx.lineTo(left, top + r);
          ctx.arcTo(left, top, left + r, top, r);
        }
        ctx.closePath();
        break;
      }

      case 'polygon_triangle': {
        if (params.points && params.points.length >= 3) {
          ctx.moveTo(params.points[0].x, params.points[0].y);
          for (let i = 1; i < params.points.length; i++) {
            ctx.lineTo(params.points[i].x, params.points[i].y);
          }
        } else {
          const w = params.width || 399;
          const h = params.height || 351;
          const topX = cx;
          const topY = cy - h / 2;
          const leftX = cx - w / 2;
          const leftY = cy + h / 2;
          const rightX = cx + w / 2;
          const rightY = cy + h / 2;

          ctx.moveTo(topX, topY);
          ctx.lineTo(rightX, rightY);
          ctx.lineTo(leftX, leftY);
        }
        ctx.closePath();
        break;
      }

      case 'star_10': {
        const rOuter = params.outerRadius || 178;
        const rInner = params.innerRadius || 78;
        const numPoints = 5;
        const angleStep = Math.PI / numPoints;
        const startAngle = -Math.PI / 2; // Point pointing straight up

        for (let i = 0; i < numPoints * 2; i++) {
          const radius = i % 2 === 0 ? rOuter : rInner;
          const angle = startAngle + i * angleStep;
          const px = cx + Math.cos(angle) * radius;
          const py = cy + Math.sin(angle) * radius;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        break;
      }

      case 'heart_bezier': {
        const w = params.width || 381;
        const h = params.height || 357;
        const topY = cy - h / 2;
        const bottomY = cy + h / 2;
        const leftX = cx - w / 2;
        const rightX = cx + w / 2;

        ctx.moveTo(cx, topY + h * 0.3);
        ctx.bezierCurveTo(cx, topY, leftX, topY, leftX, topY + h * 0.35);
        ctx.bezierCurveTo(leftX, topY + h * 0.65, cx, topY + h * 0.85, cx, bottomY);
        ctx.bezierCurveTo(cx, topY + h * 0.85, rightX, topY + h * 0.65, rightX, topY + h * 0.35);
        ctx.bezierCurveTo(rightX, topY, cx, topY, cx, topY + h * 0.3);
        ctx.closePath();
        break;
      }

      case 'radial_glow': {
        const r = params.radius || 165.5;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
        break;
      }

      case 'vector_path':
      case 'custom_bezier': {
        if (params.points && params.points.length > 0) {
          ctx.moveTo(params.points[0].x, params.points[0].y);
          for (let i = 1; i < params.points.length; i++) {
            ctx.lineTo(params.points[i].x, params.points[i].y);
          }
          ctx.closePath();
        } else {
          const r = params.radius || 100;
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.closePath();
        }
        break;
      }

      default: {
        const r = params.radius || 100;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.closePath();
      }
    }
  }

  /**
   * Generates a 2D alpha mask array (float32 values 0.0 to 1.0) for the given mathematical candidate.
   */
  public static rasterizeToAlphaGrid(
    params: PrimitiveFitParameters,
    width: number,
    height: number
  ): Float32Array {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return new Float32Array(width * height);

    if (params.type === 'radial_glow') {
      const r = params.radius || 165.5;
      const grad = ctx.createRadialGradient(params.cx, params.cy, 0, params.cx, params.cy, r);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.965)');
      grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.724)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.483)');
      grad.addColorStop(0.75, 'rgba(255, 255, 255, 0.241)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(params.cx, params.cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = '#ffffff';
      this.buildPath(ctx, params);
      ctx.fill();
    }

    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const grid = new Float32Array(width * height);

    for (let i = 0; i < grid.length; i++) {
      grid[i] = data[i * 4 + 3] / 255.0; // Alpha channel
    }

    return grid;
  }

  /**
   * Computes comprehensive error metrics comparing candidate mathematical mask to raster mask.
   */
  public static evaluateMetrics(
    mathAlpha: Float32Array,
    rasterAlpha: Float32Array,
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    width: number
  ): FitErrorMetrics {
    let intersection = 0.0;
    let union = 0.0;
    let sumAbsError = 0.0;
    let disagreementCount = 0;
    let bboxPixels = 0;

    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const idx = rowOffset + x;
        const m = mathAlpha[idx];
        const r = rasterAlpha[idx];

        intersection += Math.min(m, r);
        union += Math.max(m, r);

        const diff = Math.abs(m - r);
        sumAbsError += diff;
        if (diff > 0.2) {
          disagreementCount++;
        }
        bboxPixels++;
      }
    }

    const iou = union > 0 ? intersection / union : 1.0;
    const mae = bboxPixels > 0 ? sumAbsError / bboxPixels : 0.0;
    const disagreementPercent = bboxPixels > 0 ? (disagreementCount / bboxPixels) * 100 : 0.0;

    // Estimate boundary distance error in pixels: disagreement / (perimeter / 2)
    let edgePixels = 0;
    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = minX; x <= maxX; x++) {
        const r = rasterAlpha[rowOffset + x];
        if (r > 0.1 && r < 0.9) {
          edgePixels++;
        }
      }
    }
    const perimeterEst = Math.max(10, edgePixels / 2.0);
    const boundaryDistancePx = parseFloat((disagreementCount / perimeterEst).toFixed(2));

    return {
      iou: parseFloat(iou.toFixed(4)),
      meanAbsoluteAlphaError: parseFloat(mae.toFixed(4)),
      pixelDisagreementCount: disagreementCount,
      pixelDisagreementPercent: parseFloat(disagreementPercent.toFixed(2)),
      boundaryDistancePx
    };
  }
}

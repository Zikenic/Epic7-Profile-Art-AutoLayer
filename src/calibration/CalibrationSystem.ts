import type {
  ShapeCalibrationResult,
  BoundingBox,
  PaddingInfo,
  ShapeCenters,
  SymmetryMetrics,
  PixelCounts,
  PrimitiveFitParameters,
  RadialFalloffPoint,
  PaletteAnalysisDetail,
  ColorSwatchDetail,
  CalibrationDatabase
} from './types.ts';
import { MathematicalPrimitives } from './MathematicalPrimitives.ts';

/**
 * Core Shape Calibration & Geometry Inspection Engine.
 * Operates purely on copies/in-memory data and never modifies source assets on disk.
 */
export class CalibrationSystem {
  private calibrationDatabase: Record<string, ShapeCalibrationResult> = {};
  private paletteDatabase: Record<string, PaletteAnalysisDetail> = {};

  /**
   * Extracts the alpha grid (float32 [0.0, 1.0]) from a Canvas image context using Phase 1 formula:
   * (255-r) + (255-g) + (255-b) / 432.0.
   */
  public static extractAlphaGrid(imgData: ImageData): Float32Array {
    const data = imgData.data;
    const len = data.length / 4;
    const alphaGrid = new Float32Array(len);
    const maxDiff = 432.0;

    for (let i = 0; i < len; i++) {
      const idx = i * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];

      const diff = (255 - r) + (255 - g) + (255 - b);
      let a = diff / maxDiff;
      if (a < 0.005) a = 0.0;
      else if (a > 0.99) a = 1.0;
      alphaGrid[i] = a;
    }

    return alphaGrid;
  }

  /**
   * Analyzes the geometry of a raster shape asset at a specific alpha threshold.
   */
  public static analyzeShapeGeometry(
    assetId: string,
    filename: string,
    width: number,
    height: number,
    alphaGrid: Float32Array,
    alphaThreshold: number = 2 // 0 to 255 (2 ≈ 0.0078)
  ): ShapeCalibrationResult {
    const thresholdNorm = alphaThreshold / 255.0;

    // 1. Calculate Foreground Bounding Box
    let minX = width - 1;
    let maxX = 0;
    let minY = height - 1;
    let maxY = 0;
    let hasForeground = false;

    let totalAlpha = 0.0;
    let sumAlphaX = 0.0;
    let sumAlphaY = 0.0;

    let opaqueCount = 0;
    let partialCount = 0;
    let transparentCount = 0;

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const a = alphaGrid[rowOffset + x];

        if (a >= 0.99) opaqueCount++;
        else if (a > 0.005) partialCount++;
        else transparentCount++;

        if (a >= thresholdNorm) {
          hasForeground = true;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;

          totalAlpha += a;
          sumAlphaX += a * x;
          sumAlphaY += a * y;
        }
      }
    }

    if (!hasForeground) {
      minX = 0;
      maxX = width - 1;
      minY = 0;
      maxY = height - 1;
    }

    const fgWidth = maxX - minX + 1;
    const fgHeight = maxY - minY + 1;

    const foregroundBounds: BoundingBox = {
      minX,
      minY,
      maxX,
      maxY,
      width: fgWidth,
      height: fgHeight
    };

    // 2. Calculate Padding
    const padLeft = minX;
    const padRight = width - 1 - maxX;
    const padTop = minY;
    const padBottom = height - 1 - maxY;

    const padding: PaddingInfo = {
      left: padLeft,
      right: padRight,
      top: padTop,
      bottom: padBottom,
      normLeft: parseFloat((padLeft / width).toFixed(4)),
      normRight: parseFloat((padRight / width).toFixed(4)),
      normTop: parseFloat((padTop / height).toFixed(4)),
      normBottom: parseFloat((padBottom / height).toFixed(4))
    };

    // 3. Calculate Centers
    const imgCx = width / 2.0;
    const imgCy = height / 2.0;

    const bboxCx = (minX + maxX) / 2.0;
    const bboxCy = (minY + maxY) / 2.0;

    const centroidX = totalAlpha > 0 ? sumAlphaX / totalAlpha : bboxCx;
    const centroidY = totalAlpha > 0 ? sumAlphaY / totalAlpha : bboxCy;

    const centers: ShapeCenters = {
      image: { x: parseFloat(imgCx.toFixed(2)), y: parseFloat(imgCy.toFixed(2)) },
      foregroundBBox: { x: parseFloat(bboxCx.toFixed(2)), y: parseFloat(bboxCy.toFixed(2)) },
      alphaCentroid: { x: parseFloat(centroidX.toFixed(2)), y: parseFloat(centroidY.toFixed(2)) },
      offsetBBoxFromImage: {
        x: parseFloat((bboxCx - imgCx).toFixed(2)),
        y: parseFloat((bboxCy - imgCy).toFixed(2))
      },
      offsetCentroidFromImage: {
        x: parseFloat((centroidX - imgCx).toFixed(2)),
        y: parseFloat((centroidY - imgCy).toFixed(2))
      }
    };

    // 4. Calculate Symmetry
    const symmetry = this.calculateSymmetry(alphaGrid, width, foregroundBounds);

    // 5. Pixel statistics
    const totalPixels = width * height;
    const pixels: PixelCounts = {
      opaque: opaqueCount,
      partial: partialCount,
      transparent: transparentCount,
      total: totalPixels,
      percentOpaque: parseFloat(((opaqueCount / totalPixels) * 100).toFixed(2)),
      percentPartial: parseFloat(((partialCount / totalPixels) * 100).toFixed(2)),
      percentTransparent: parseFloat(((transparentCount / totalPixels) * 100).toFixed(2))
    };

    // 6. Default Candidate Primitive
    const candidatePrimitive = this.suggestCandidatePrimitive(assetId, foregroundBounds, centers);

    // 7. Evaluate Initial Fit Metrics
    const mathGrid = MathematicalPrimitives.rasterizeToAlphaGrid(candidatePrimitive, width, height);
    const fitMetrics = MathematicalPrimitives.evaluateMetrics(
      mathGrid,
      alphaGrid,
      minX,
      minY,
      maxX,
      maxY,
      width
    );

    // 8. Radial Falloff Profile (for Glow or circular shapes)
    let radialProfile: RadialFalloffPoint[] | undefined;
    if (assetId.toLowerCase().includes('glow') || assetId.toLowerCase().includes('circle')) {
      radialProfile = this.calculateRadialProfile(alphaGrid, width, height, centers.alphaCentroid, Math.max(fgWidth, fgHeight) / 2);
    }

    return {
      assetId,
      filename,
      sourceWidth: width,
      sourceHeight: height,
      alphaThreshold,
      foregroundBounds,
      padding,
      centers,
      symmetry,
      pixels,
      candidatePrimitive,
      fitMetrics,
      radialProfile,
      analyzedAt: new Date().toISOString()
    };
  }

  /**
   * Calculates Horizontal & Vertical Symmetry % over the foreground crop.
   */
  private static calculateSymmetry(
    alphaGrid: Float32Array,
    width: number,
    bbox: BoundingBox
  ): SymmetryMetrics {
    const { minX, minY, maxX, maxY, width: bw, height: bh } = bbox;
    if (bw <= 0 || bh <= 0) return { horizontal: 100, vertical: 100 };

    let sumDiffH = 0.0;
    let countH = 0;

    let sumDiffV = 0.0;
    let countV = 0;

    // Horizontal symmetry (compare left half to mirrored right half)
    for (let y = minY; y <= maxY; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < Math.floor(bw / 2); x++) {
        const leftX = minX + x;
        const rightX = maxX - x;
        const leftVal = alphaGrid[rowOffset + leftX];
        const rightVal = alphaGrid[rowOffset + rightX];
        sumDiffH += Math.abs(leftVal - rightVal);
        countH++;
      }
    }

    // Vertical symmetry (compare top half to mirrored bottom half)
    for (let x = minX; x <= maxX; x++) {
      for (let y = 0; y < Math.floor(bh / 2); y++) {
        const topY = minY + y;
        const bottomY = maxY - y;
        const topVal = alphaGrid[topY * width + x];
        const bottomVal = alphaGrid[bottomY * width + x];
        sumDiffV += Math.abs(topVal - bottomVal);
        countV++;
      }
    }

    const meanDiffH = countH > 0 ? sumDiffH / countH : 0.0;
    const meanDiffV = countV > 0 ? sumDiffV / countV : 0.0;

    const symH = Math.max(0.0, Math.min(100.0, (1.0 - meanDiffH) * 100.0));
    const symV = Math.max(0.0, Math.min(100.0, (1.0 - meanDiffV) * 100.0));

    return {
      horizontal: parseFloat(symH.toFixed(2)),
      vertical: parseFloat(symV.toFixed(2))
    };
  }

  /**
   * Recommends a mathematical primitive classification and initial fitting parameters.
   */
  public static suggestCandidatePrimitive(
    assetId: string,
    bbox: BoundingBox,
    centers: ShapeCenters
  ): PrimitiveFitParameters {
    const id = assetId.toLowerCase();
    const cx = centers.foregroundBBox.x;
    const cy = centers.foregroundBBox.y;

    if (id.includes('circle') && !id.includes('half')) {
      return {
        type: 'circle',
        cx,
        cy,
        radius: bbox.width / 2.0,
        radiusX: bbox.width / 2.0,
        radiusY: bbox.height / 2.0
      };
    }

    if (id.includes('half_circle')) {
      return {
        type: 'semicircle',
        cx,
        cy: bbox.minY + (bbox.height * 0.49),
        radius: bbox.width / 2.0,
        flatEdge: 'bottom'
      };
    }

    if (id.includes('pill')) {
      return {
        type: 'capsule',
        cx,
        cy,
        width: bbox.width,
        height: bbox.height
      };
    }

    if (id.includes('rounded_square')) {
      return {
        type: 'rounded_rect',
        cx,
        cy,
        width: bbox.width,
        height: bbox.height,
        cornerRadius: 27
      };
    }

    if (id.includes('triangle')) {
      return {
        type: 'polygon_triangle',
        cx,
        cy,
        width: bbox.width,
        height: bbox.height,
        points: [
          { x: cx, y: bbox.minY },
          { x: bbox.maxX, y: bbox.maxY },
          { x: bbox.minX, y: bbox.maxY }
        ]
      };
    }

    if (id.includes('star')) {
      return {
        type: 'star_10',
        cx,
        cy,
        outerRadius: bbox.width / 2.0,
        innerRadius: (bbox.width / 2.0) * 0.44
      };
    }

    if (id.includes('heart')) {
      return {
        type: 'heart_bezier',
        cx,
        cy,
        width: bbox.width,
        height: bbox.height
      };
    }

    if (id.includes('glow')) {
      return {
        type: 'radial_glow',
        cx: centers.alphaCentroid.x,
        cy: centers.alphaCentroid.y,
        radius: bbox.width / 2.0,
        falloff: 'cosine'
      };
    }

    // Default fallback
    return {
      type: 'custom_bezier',
      cx,
      cy,
      width: bbox.width,
      height: bbox.height
    };
  }

  /**
   * Calculates the radial intensity profile for radial shapes (Glow, Circle).
   */
  private static calculateRadialProfile(
    alphaGrid: Float32Array,
    width: number,
    height: number,
    center: { x: number; y: number },
    maxRadius: number
  ): RadialFalloffPoint[] {
    const numBins = 25;
    const binSize = maxRadius / numBins;
    const sumAlpha = new Float32Array(numBins);
    const count = new Uint32Array(numBins);

    for (let y = 0; y < height; y++) {
      const rowOffset = y * width;
      for (let x = 0; x < width; x++) {
        const dx = x - center.x;
        const dy = y - center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= maxRadius) {
          const bin = Math.min(numBins - 1, Math.floor(dist / binSize));
          sumAlpha[bin] += alphaGrid[rowOffset + x];
          count[bin]++;
        }
      }
    }

    const profile: RadialFalloffPoint[] = [];
    for (let i = 0; i < numBins; i++) {
      const r = parseFloat(((i + 0.5) * binSize).toFixed(1));
      const mean = count[i] > 0 ? parseFloat((sumAlpha[i] / count[i]).toFixed(4)) : 0.0;
      profile.push({ radius: r, meanAlpha: mean });
    }
    return profile;
  }

  /**
   * Detailed analysis of Color Palette images.
   */
  public static analyzePaletteImage(
    id: string,
    filename: string,
    img: HTMLImageElement
  ): PaletteAnalysisDetail {
    const canvas = document.createElement('canvas');
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable');
    }
    ctx.drawImage(img, 0, 0);

    const isPalette1 = filename.toLowerCase().includes('palette_1');
    const rows = isPalette1 ? 3 : 1;
    const cols = isPalette1 ? 7 : 5;
    const xs = isPalette1 ? [45, 135, 225, 315, 405, 495, 585] : [45, 135, 225, 315, 405];
    const ys = isPalette1 ? [42, 127, 212] : [43];

    const colors: ColorSwatchDetail[] = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const px = ctx.getImageData(xs[c], ys[r], 1, 1).data;
        const hex = `#${((1 << 24) + (px[0] << 16) + (px[1] << 8) + px[2]).toString(16).slice(1)}`.toLowerCase();

        // Convert to HSV and HSL
        const rn = px[0] / 255.0;
        const gn = px[1] / 255.0;
        const bn = px[2] / 255.0;
        const max = Math.max(rn, gn, bn);
        const min = Math.min(rn, gn, bn);
        const delta = max - min;

        // Hue
        let hDeg = 0;
        if (delta !== 0) {
          if (max === rn) hDeg = ((gn - bn) / delta) % 6;
          else if (max === gn) hDeg = (bn - rn) / delta + 2;
          else hDeg = (rn - gn) / delta + 4;
          hDeg = Math.round(hDeg * 60);
          if (hDeg < 0) hDeg += 360;
        }

        // HSV
        const sHsv = max === 0 ? 0 : Math.round((delta / max) * 100);
        const vHsv = Math.round(max * 100);

        // HSL
        const lHsl = (max + min) / 2;
        const sHsl = delta === 0 ? 0 : Math.round((delta / (1 - Math.abs(2 * lHsl - 1))) * 100);

        colors.push({
          palette: id,
          row: r,
          col: c,
          index: r * cols + c,
          hex,
          rgb: { r: px[0], g: px[1], b: px[2] },
          hsv: { h: hDeg, s: sHsv, v: vHsv },
          hsl: { h: hDeg, s: sHsl, l: Math.round(lHsl * 100) }
        });
      }
    }

    return {
      id,
      filename,
      width: w,
      height: h,
      grid: { rows, cols, swatchSize: 60, pitch: 90 },
      colors
    };
  }

  // --- Database & Persistence API ---

  public setShapeCalibration(assetId: string, result: ShapeCalibrationResult): void {
    this.calibrationDatabase[assetId] = result;
  }

  public getShapeCalibration(assetId: string): ShapeCalibrationResult | undefined {
    return this.calibrationDatabase[assetId];
  }

  public getAllShapeCalibrations(): Record<string, ShapeCalibrationResult> {
    return { ...this.calibrationDatabase };
  }

  public setPaletteAnalysis(id: string, detail: PaletteAnalysisDetail): void {
    this.paletteDatabase[id] = detail;
  }

  public getPaletteAnalysis(id: string): PaletteAnalysisDetail | undefined {
    return this.paletteDatabase[id];
  }

  public getAllPaletteAnalyses(): Record<string, PaletteAnalysisDetail> {
    return { ...this.paletteDatabase };
  }

  public exportDatabaseJSON(): string {
    const db: CalibrationDatabase = {
      version: 1,
      description: 'Epic Seven Profile Art Shape & Palette Calibration Database (Phase 2A)',
      generatedAt: new Date().toISOString(),
      shapes: this.calibrationDatabase,
      palettes: this.paletteDatabase
    };
    return JSON.stringify(db, null, 2);
  }

  public loadDatabaseJSON(jsonStr: string): void {
    const parsed = JSON.parse(jsonStr) as CalibrationDatabase;
    if (parsed.version !== 1) {
      throw new Error(`Unsupported calibration database version: ${parsed.version}`);
    }
    this.calibrationDatabase = parsed.shapes || {};
    this.paletteDatabase = parsed.palettes || {};
  }
}

export const defaultCalibrationSystem = new CalibrationSystem();

import type { ShapeDefinition, ColorPalette, DiscoveredAssets } from './types.ts';
import { RasterShapeDefinition } from './RasterShapeDefinition.ts';

// Static fallback in case API endpoint is unavailable
const DEFAULT_DISCOVERED_ASSETS: DiscoveredAssets = {
  shapes: [
    { id: 'Baloon', name: 'Balloon', filename: 'Baloon.png', url: '/Shapes_Colors/Baloon.png' },
    { id: 'Circle', name: 'Circle', filename: 'Circle.png', url: '/Shapes_Colors/Circle.png' },
    { id: 'Cross', name: 'Cross', filename: 'Cross.png', url: '/DerivedShapes/Cross.png' },
    { id: 'Glow', name: 'Glow', filename: 'Glow.png', url: '/Shapes_Colors/Glow.png' },
    { id: 'Half_Circle', name: 'Half Circle', filename: 'Half_Circle.png', url: '/Shapes_Colors/Half_Circle.png' },
    { id: 'Heart', name: 'Heart', filename: 'Heart.png', url: '/Shapes_Colors/Heart.png' },
    { id: 'Moon_Curve', name: 'Moon Curve', filename: 'Moon_Curve.png', url: '/Shapes_Colors/Moon_Curve.png' },
    { id: 'Moon_Edge', name: 'Moon Edge', filename: 'Moon_Edge.png', url: '/Shapes_Colors/Moon_Edge.png' },
    { id: 'Pill', name: 'Pill', filename: 'Pill.png', url: '/Shapes_Colors/Pill.png' },
    { id: 'Rounded_Square', name: 'Rounded Square', filename: 'Rounded_Square.png', url: '/Shapes_Colors/Rounded_Square.png' },
    { id: 'Star', name: 'Star', filename: 'Star.png', url: '/Shapes_Colors/Star.png' },
    { id: 'Triangle', name: 'Triangle', filename: 'Triangle.png', url: '/Shapes_Colors/Triangle.png' }
  ],
  palettes: [
    { id: 'Color_Palette_1', name: 'Color Palette 1', filename: 'Color_Palette_1.png', url: '/Shapes_Colors/Color_Palette_1.png' },
    { id: 'Color_Palette_2', name: 'Color Palette 2', filename: 'Color_Palette_2.png', url: '/Shapes_Colors/Color_Palette_2.png' }
  ]
};

export class ShapeAssetLoader {
  private shapes: Map<string, ShapeDefinition> = new Map();
  private palettes: ColorPalette[] = [];
  private loaded: boolean = false;

  public async loadAll(): Promise<{ shapes: ShapeDefinition[]; palettes: ColorPalette[] }> {
    if (this.loaded) {
      return { shapes: Array.from(this.shapes.values()), palettes: this.palettes };
    }

    let assetList = DEFAULT_DISCOVERED_ASSETS;
    try {
      const response = await fetch('/api/assets');
      if (response.ok) {
        const data = await response.json();
        if (data.shapes && data.shapes.length > 0) {
          assetList = data;
        }
      }
    } catch {
      console.warn('Could not query /api/assets, using discovered fallback list');
    }

    // Load shapes concurrently
    const shapePromises = assetList.shapes.map(async (item) => {
      try {
        const img = await this.loadImage(item.url);
        const shapeDef = new RasterShapeDefinition(item.id, item.name, img);
        this.shapes.set(item.id, shapeDef);
      } catch (err) {
        console.error(`Failed to load shape asset: ${item.filename}`, err);
      }
    });

    // Load palettes concurrently
    const palettePromises = assetList.palettes.map(async (item) => {
      try {
        const img = await this.loadImage(item.url);
        const colors = this.extractPaletteColors(img, item.filename);
        this.palettes.push({
          id: item.id,
          name: item.name,
          filename: item.filename,
          colors
        });
      } catch (err) {
        console.error(`Failed to load palette asset: ${item.filename}`, err);
      }
    });

    await Promise.all([...shapePromises, ...palettePromises]);
    this.loaded = true;

    return {
      shapes: Array.from(this.shapes.values()),
      palettes: this.palettes
    };
  }

  public getShape(id: string): ShapeDefinition | undefined {
    return this.shapes.get(id);
  }

  public registerShape(shape: ShapeDefinition): void {
    this.shapes.set(shape.id, shape);
  }

  public getShapes(): ShapeDefinition[] {
    return Array.from(this.shapes.values());
  }

  public getPalettes(): ColorPalette[] {
    return this.palettes;
  }

  private loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Image load error for ${url}: ${e}`));
      img.src = url;
    });
  }

  /**
   * Extracts clean color swatches from the palette image.
   * Color_Palette_1 is a 7x3 grid of 60x60 swatches with 90px pitch.
   * Color_Palette_2 is a 5x1 grid of 60x60 swatches with 90px pitch.
   */
  private extractPaletteColors(img: HTMLImageElement, filename: string): string[] {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [];

    ctx.drawImage(img, 0, 0);

    const colors: string[] = [];

    if (filename.toLowerCase().includes('palette_1')) {
      const xs = [45, 135, 225, 315, 405, 495, 585];
      const ys = [42, 127, 212];
      for (const y of ys) {
        for (const x of xs) {
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
          colors.push(hex.toLowerCase());
        }
      }
    } else if (filename.toLowerCase().includes('palette_2')) {
      const xs = [45, 135, 225, 315, 405];
      const ys = [43];
      for (const y of ys) {
        for (const x of xs) {
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
          colors.push(hex.toLowerCase());
        }
      }
    } else {
      // General sampling fallback if custom palettes are added in the future
      const stepX = Math.floor(canvas.width / 8);
      const stepY = Math.floor(canvas.height / 4);
      for (let y = Math.floor(stepY / 2); y < canvas.height; y += stepY) {
        for (let x = Math.floor(stepX / 2); x < canvas.width; x += stepX) {
          const pixel = ctx.getImageData(x, y, 1, 1).data;
          const hex = `#${((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1)}`;
          if (!colors.includes(hex.toLowerCase())) {
            colors.push(hex.toLowerCase());
          }
        }
      }
    }

    return colors;
  }
}

// Singleton loader instance for application-wide sharing
export const shapeAssetLoader = new ShapeAssetLoader();

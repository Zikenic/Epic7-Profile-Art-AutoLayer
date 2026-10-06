import type { Layer } from '../core/types.ts';
import { DeterministicRenderer, type RenderMode, type RenderOptions } from '../core/Renderer.ts';
import type { RasterImage } from './types.ts';

// Holder for @napi-rs/canvas in Node.js
let napiCreateCanvas: ((width: number, height: number) => any) | null = null;

if (typeof window === 'undefined' && typeof document === 'undefined') {
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(import.meta.url);
    napiCreateCanvas = req('@napi-rs/canvas').createCanvas;
  } catch {
    // In browser or environments without node:module
  }
}

/**
 * Headless Canvas instance wrapping 2D rendering context and pixel extraction.
 */
export interface HeadlessCanvasInstance {
  ctx: CanvasRenderingContext2D;
  getImageData(): RasterImage;
}

/**
 * Creates a headless canvas instance compatible with both Node.js and browser runtimes.
 */
export function createHeadlessCanvas(width: number, height: number): HeadlessCanvasInstance {
  // 1. In Node.js: Prefer @napi-rs/canvas
  const nodeCreate = napiCreateCanvas;
  if (nodeCreate) {
    const canvas = nodeCreate(width, height);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return {
      ctx,
      getImageData: () => {
        const img = ctx.getImageData(0, 0, width, height);
        return {
          width,
          height,
          data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength)
        };
      }
    };
  }

  // 2. Browser with OffscreenCanvas
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as unknown as CanvasRenderingContext2D;
    return {
      ctx,
      getImageData: () => {
        const img = ctx.getImageData(0, 0, width, height);
        return {
          width,
          height,
          data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength)
        };
      }
    };
  }

  // 3. Browser with DOM Canvas
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    return {
      ctx,
      getImageData: () => {
        const img = ctx.getImageData(0, 0, width, height);
        return {
          width,
          height,
          data: new Uint8ClampedArray(img.data.buffer, img.data.byteOffset, img.data.byteLength)
        };
      }
    };
  }

  throw new Error('No canvas implementation available in the current environment.');
}

/**
 * Renders a list of layers using the authoritative Epic Seven DeterministicRenderer,
 * producing a pure RGBA RasterImage over a transparent background.
 */
export function renderLayersToRaster(
  layers: readonly Layer[],
  width: number,
  height: number,
  options: {
    backgroundColor?: string;
    renderMode?: RenderMode;
  } = {}
): RasterImage {
  const {
    backgroundColor = 'transparent',
    renderMode = 'mathematical'
  } = options;

  const instance = createHeadlessCanvas(width, height);
  const renderOptions: RenderOptions = {
    width,
    height,
    backgroundColor,
    renderMode
  };

  DeterministicRenderer.render(instance.ctx, layers, renderOptions);
  return instance.getImageData();
}

/**
 * Renders a single layer to a RasterImage.
 */
export function renderSingleLayerToRaster(
  layer: Layer,
  width: number,
  height: number,
  options: {
    backgroundColor?: string;
    renderMode?: RenderMode;
  } = {}
): RasterImage {
  return renderLayersToRaster([layer], width, height, options);
}

/**
 * Generates a synthetic target image from a known layer configuration.
 * Adheres strictly to the transparent RGBA compositing convention.
 */
export function generateSyntheticTarget(
  layer: Layer,
  resolution: { width: number; height: number } = { width: 210, height: 310 },
  renderMode: RenderMode = 'mathematical'
): RasterImage {
  return renderSingleLayerToRaster(layer, resolution.width, resolution.height, {
    backgroundColor: 'transparent',
    renderMode
  });
}

/**
 * Clones a RasterImage into a new memory buffer.
 */
export function cloneRasterImage(image: RasterImage): RasterImage {
  return {
    width: image.width,
    height: image.height,
    data: new Uint8ClampedArray(image.data)
  };
}

import { LayerModel } from './LayerModel.ts';
import { shapeAssetLoader, ShapeAssetLoader } from './ShapeAssetLoader.ts';
import { mathematicalShapeRegistry } from './MathematicalShapeRegistry.ts';
import { DeterministicRenderer, type RenderOptions, type RenderMode } from './Renderer.ts';
import type { Layer, ProjectData, ReferenceImageConfig, ShapeDefinition, ColorPalette } from './types.ts';
import { MAX_LAYERS } from './types.ts';

/**
 * High-level Engine API that coordinates Asset Loading, Layer Management, and Deterministic Rendering.
 * This class provides a 100% programmatic API without any UI dependency,
 * enabling future automated optimization algorithms to directly construct and manipulate compositions.
 */
export class ProfileEngine {
  public readonly model: LayerModel;
  public readonly assetLoader: ShapeAssetLoader;

  private renderMode: RenderMode = 'raster';
  private referenceImageElement: HTMLImageElement | null = null;
  private referenceConfig: ReferenceImageConfig = {
    opacity: 0.5,
    visible: false,
    fit: 'contain',
    includeInExport: false
  };

  constructor(model?: LayerModel, loader?: ShapeAssetLoader) {
    this.model = model || new LayerModel();
    this.assetLoader = loader || shapeAssetLoader;
  }

  public async initialize(): Promise<void> {
    await this.assetLoader.loadAll();
  }

  // --- Programmatic Layer API ---

  public getLayers(): readonly Layer[] {
    return this.model.getLayers();
  }

  public getLayerCount(): number {
    return this.model.getLayerCount();
  }

  public getMaxLayers(): number {
    return MAX_LAYERS;
  }

  public canAddLayer(): boolean {
    return this.model.canAddLayer();
  }

  public createLayer(shapeAsset: string, overrides: Partial<Layer> = {}): Layer {
    return this.model.createLayer(shapeAsset, overrides);
  }

  public updateLayer(id: string, updates: Partial<Layer>): void {
    this.model.updateLayer(id, updates);
  }

  public deleteLayer(id: string): boolean {
    return this.model.deleteLayer(id);
  }

  public duplicateLayer(id: string): Layer | null {
    return this.model.duplicateLayer(id);
  }

  public reorderLayer(fromIndex: number, toIndex: number): void {
    this.model.reorderLayer(fromIndex, toIndex);
  }

  public clear(): void {
    this.model.clear();
  }

  // --- Asset Discovery API ---

  public getShapes(): ShapeDefinition[] {
    const rasterShapes = this.assetLoader.getShapes();
    const existingIds = new Set(rasterShapes.map(s => s.id));
    const mathShapes = mathematicalShapeRegistry.getAllPrimitives().filter(s => !existingIds.has(s.id));
    return [...rasterShapes, ...mathShapes];
  }

  public getShape(id: string): ShapeDefinition | undefined {
    return this.assetLoader.getShape(id) || mathematicalShapeRegistry.getPrimitive(id);
  }

  public getPalettes(): ColorPalette[] {
    return this.assetLoader.getPalettes();
  }

  // --- Reference Image API ---

  public setReferenceImage(dataUrl: string, filename?: string): void {
    this.referenceConfig.dataUrl = dataUrl;
    this.referenceConfig.filename = filename;
    this.referenceConfig.visible = true;

    const img = new Image();
    img.onload = () => {
      this.referenceImageElement = img;
      this.model.setSelectedLayerId(this.model.getSelectedLayerId()); // Trigger model notification
    };
    img.src = dataUrl;
  }

  public clearReferenceImage(): void {
    this.referenceImageElement = null;
    this.referenceConfig.dataUrl = undefined;
    this.referenceConfig.filename = undefined;
    this.referenceConfig.visible = false;
    this.model.setSelectedLayerId(this.model.getSelectedLayerId());
  }

  public updateReferenceConfig(updates: Partial<ReferenceImageConfig>): void {
    this.referenceConfig = { ...this.referenceConfig, ...updates };
    this.model.setSelectedLayerId(this.model.getSelectedLayerId());
  }

  public getReferenceConfig(): ReferenceImageConfig {
    return { ...this.referenceConfig };
  }

  public setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;
    this.model.notifySubscribers();
  }

  public getRenderMode(): RenderMode {
    return this.renderMode;
  }

  // --- Rendering API ---

  public render(ctx: CanvasRenderingContext2D, width: number, height: number, renderMode?: RenderMode): void {
    const options: RenderOptions = {
      width,
      height,
      backgroundColor: this.model.getBackgroundColor(),
      referenceImage: this.referenceConfig.visible ? this.referenceImageElement : null,
      referenceOpacity: this.referenceConfig.opacity,
      referenceFit: this.referenceConfig.fit,
      renderMode: renderMode || this.renderMode
    };
    DeterministicRenderer.render(ctx, this.model.getLayers(), options);
  }

  public async exportPNG(width: number = 840, includeReference: boolean = false, renderMode?: RenderMode): Promise<Blob> {
    const { width: w, height: h } = DeterministicRenderer.calculateDimensions(width);
    const options: RenderOptions = {
      width: w,
      height: h,
      backgroundColor: this.model.getBackgroundColor(),
      referenceImage: (includeReference || this.referenceConfig.includeInExport) ? this.referenceImageElement : null,
      referenceOpacity: this.referenceConfig.opacity,
      referenceFit: this.referenceConfig.fit,
      renderMode: renderMode || this.renderMode
    };
    return DeterministicRenderer.exportToBlob(this.model.getLayers(), options);
  }

  // --- Save / Load API ---

  public toJSON(): ProjectData {
    const data = this.model.toJSON();
    data.referenceImage = { ...this.referenceConfig };
    return data;
  }

  public loadJSON(data: ProjectData): void {
    this.model.fromJSON(data);
    if (data.referenceImage && data.referenceImage.dataUrl) {
      this.setReferenceImage(data.referenceImage.dataUrl, data.referenceImage.filename);
      this.referenceConfig = { ...data.referenceImage };
    } else {
      this.clearReferenceImage();
    }
  }
}

export const defaultEngine = new ProfileEngine();

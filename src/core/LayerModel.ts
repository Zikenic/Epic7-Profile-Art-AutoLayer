import type { Layer, ProjectData } from './types.ts';
import { MAX_LAYERS } from './types.ts';

export type LayerModelListener = () => void;

/**
 * Manages the composition layers, enforcing max 130 layers constraint,
 * maintaining stacking order, and providing full programmatic manipulation.
 */
export class LayerModel {
  private layers: Layer[] = [];
  private selectedLayerId: string | null = null;
  private listeners: Set<LayerModelListener> = new Set();
  private nextIdCounter: number = 1;
  private projectName: string = 'Untitled Profile';
  private backgroundColor: string = '#141721';

  constructor() {}

  public subscribe(listener: LayerModelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  public notifySubscribers(): void {
    this.notify();
  }

  public getLayers(): readonly Layer[] {
    return this.layers;
  }

  public getLayerCount(): number {
    return this.layers.length;
  }

  public getMaxLayers(): number {
    return MAX_LAYERS;
  }

  public canAddLayer(): boolean {
    return this.layers.length < MAX_LAYERS;
  }

  public getSelectedLayerId(): string | null {
    return this.selectedLayerId;
  }

  public getSelectedLayer(): Layer | null {
    if (!this.selectedLayerId) return null;
    return this.layers.find(l => l.id === this.selectedLayerId) || null;
  }

  public setSelectedLayerId(id: string | null): void {
    if (this.selectedLayerId !== id) {
      this.selectedLayerId = id;
      this.notify();
    }
  }

  public getProjectName(): string {
    return this.projectName;
  }

  public setProjectName(name: string): void {
    this.projectName = name;
    this.notify();
  }

  public getBackgroundColor(): string {
    return this.backgroundColor;
  }

  public setBackgroundColor(color: string): void {
    this.backgroundColor = color;
    this.notify();
  }

  /**
   * Programmatic layer creation with calibrated spawn dimensions and positions.
   * Throws an error if attempting to exceed MAX_LAYERS (130).
   */
  public createLayer(shapeAsset: string, overrides: Partial<Layer> = {}): Layer {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Cannot add layer: Maximum of ${MAX_LAYERS} active layers reached.`);
    }

    const id = overrides.id || `layer-${Date.now()}-${this.nextIdCounter++}`;
    const layerNum = this.layers.length + 1;
    const name = overrides.name || `Layer ${layerNum} (${shapeAsset})`;

    // In Epic Seven: Freshly spawned shapes always spawn at the exact center of the 21:31 canvas (0.5, 0.5)
    // with scaleX = 1.0 and scaleY = 1.0 representing the native square frame size.
    const defaultX = 0.5;
    const defaultY = 0.5;
    const defaultScaleX = 1.0;
    const defaultScaleY = 1.0;

    const newLayer: Layer = {
      id,
      name,
      shapeAsset,
      x: overrides.x !== undefined ? overrides.x : defaultX,
      y: overrides.y !== undefined ? overrides.y : defaultY,
      scaleX: overrides.scaleX !== undefined ? overrides.scaleX : defaultScaleX,
      scaleY: overrides.scaleY !== undefined ? overrides.scaleY : defaultScaleY,
      rotation: overrides.rotation !== undefined ? overrides.rotation : 0,
      color: overrides.color || '#586a8b',
      opacity: overrides.opacity !== undefined ? overrides.opacity : 1.0,
      visible: overrides.visible !== undefined ? overrides.visible : true,
      locked: overrides.locked !== undefined ? overrides.locked : false,
      ...overrides
    };

    // Stacking order: top of the stack is rendered last (on top)
    // Create new array reference so useSyncExternalStore detects state change immediately
    this.layers = [...this.layers, newLayer];
    this.selectedLayerId = id;
    this.notify();
    return newLayer;
  }

  /**
   * Programmatic layer updates.
   */
  public updateLayer(id: string, updates: Partial<Layer>): void {
    const index = this.layers.findIndex(l => l.id === id);
    if (index === -1) return;

    const current = this.layers[index];
    // If locked, prevent transformation updates unless explicitly unlocking
    if (current.locked && updates.locked === undefined && (updates.x !== undefined || updates.y !== undefined || updates.scaleX !== undefined || updates.scaleY !== undefined || updates.rotation !== undefined)) {
      return;
    }

    // Immutable update to trigger useSyncExternalStore reactively
    this.layers = this.layers.map(l => l.id === id ? { ...l, ...updates } : l);
    this.notify();
  }

  /**
   * Programmatic layer deletion.
   */
  public deleteLayer(id: string): boolean {
    const index = this.layers.findIndex(l => l.id === id);
    if (index === -1) return false;

    const nextLayers = this.layers.filter(l => l.id !== id);
    this.layers = nextLayers;

    if (this.selectedLayerId === id) {
      if (this.layers.length > 0) {
        const newIndex = Math.min(index, this.layers.length - 1);
        this.selectedLayerId = this.layers[newIndex].id;
      } else {
        this.selectedLayerId = null;
      }
    }
    this.notify();
    return true;
  }

  /**
   * Programmatic layer duplication.
   */
  public duplicateLayer(id: string): Layer | null {
    if (this.layers.length >= MAX_LAYERS) {
      throw new Error(`Cannot duplicate layer: Maximum of ${MAX_LAYERS} active layers reached.`);
    }

    const index = this.layers.findIndex(l => l.id === id);
    if (index === -1) return null;

    const source = this.layers[index];
    const newId = `layer-${Date.now()}-${this.nextIdCounter++}`;
    const duplicated: Layer = {
      ...source,
      id: newId,
      name: `${source.name} (Copy)`,
      x: Math.min(1.0, source.x + 0.02),
      y: Math.min(1.0, source.y + 0.02)
    };

    // Insert directly above source in the stack with immutable array copy
    const nextLayers = [...this.layers];
    nextLayers.splice(index + 1, 0, duplicated);
    this.layers = nextLayers;
    this.selectedLayerId = newId;
    this.notify();
    return duplicated;
  }

  /**
   * Programmatic layer reordering.
   */
  public reorderLayer(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.layers.length || toIndex < 0 || toIndex >= this.layers.length) {
      return;
    }
    if (fromIndex === toIndex) return;

    const nextLayers = [...this.layers];
    const [item] = nextLayers.splice(fromIndex, 1);
    nextLayers.splice(toIndex, 0, item);
    this.layers = nextLayers;
    this.notify();
  }

  public moveLayer(id: string, direction: 'up' | 'down' | 'top' | 'bottom'): void {
    const index = this.layers.findIndex(l => l.id === id);
    if (index === -1) return;

    if (direction === 'up' && index < this.layers.length - 1) {
      this.reorderLayer(index, index + 1);
    } else if (direction === 'down' && index > 0) {
      this.reorderLayer(index, index - 1);
    } else if (direction === 'top' && index < this.layers.length - 1) {
      this.reorderLayer(index, this.layers.length - 1);
    } else if (direction === 'bottom' && index > 0) {
      this.reorderLayer(index, 0);
    }
  }

  public clear(): void {
    this.layers = [];
    this.selectedLayerId = null;
    this.notify();
  }

  /**
   * Serializes composition into stable versioned JSON.
   */
  public toJSON(): ProjectData {
    return {
      version: 1,
      name: this.projectName,
      canvas: {
        aspectRatio: '21:31',
        aspectRatioWidth: 21,
        aspectRatioHeight: 31,
        backgroundColor: this.backgroundColor
      },
      layers: this.layers.map(l => ({ ...l })),
      updatedAt: new Date().toISOString()
    };
  }

  /**
   * Loads a composition from JSON.
   */
  public fromJSON(data: ProjectData): void {
    if (!data || data.version !== 1 || !Array.isArray(data.layers)) {
      throw new Error('Invalid project file: expected version 1 profile project.');
    }

    if (data.layers.length > MAX_LAYERS) {
      throw new Error(`Project contains ${data.layers.length} layers, exceeding limit of ${MAX_LAYERS}.`);
    }

    this.projectName = data.name || 'Untitled Profile';
    if (data.canvas && data.canvas.backgroundColor) {
      this.backgroundColor = data.canvas.backgroundColor;
    }
    this.layers = data.layers.map((l, i) => ({
      id: l.id || `layer-${Date.now()}-${i}`,
      name: l.name || `Layer ${i + 1}`,
      shapeAsset: l.shapeAsset,
      x: typeof l.x === 'number' ? l.x : 0.5,
      y: typeof l.y === 'number' ? l.y : 0.5,
      scaleX: typeof l.scaleX === 'number' ? l.scaleX : 1.0,
      scaleY: typeof l.scaleY === 'number' ? l.scaleY : 1.0,
      rotation: typeof l.rotation === 'number' ? l.rotation : 0,
      color: l.color || '#586a8b',
      opacity: typeof l.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1.0,
      visible: l.visible !== false,
      locked: !!l.locked
    }));

    this.selectedLayerId = this.layers.length > 0 ? this.layers[this.layers.length - 1].id : null;
    this.notify();
  }
}

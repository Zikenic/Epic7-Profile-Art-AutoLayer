import { MathematicalShapeDefinition } from './MathematicalShapeDefinition.ts';
import { CANONICAL_SHAPES } from './MathematicalShapeData.ts';

/**
 * Registry of authoritative mathematical primitives for Epic Seven profile art (Phase 2B).
 * Maps shape asset IDs to their mathematical representations.
 */
export class MathematicalShapeRegistry {
  private primitives: Map<string, MathematicalShapeDefinition> = new Map();

  constructor() {
    this.initializeDefaults();
  }

  private initializeDefaults(): void {
    for (const [id, data] of Object.entries(CANONICAL_SHAPES)) {
      this.primitives.set(id, new MathematicalShapeDefinition(data));
    }
  }

  public getPrimitive(id: string): MathematicalShapeDefinition | undefined {
    return this.primitives.get(id);
  }

  public getAllPrimitives(): MathematicalShapeDefinition[] {
    return Array.from(this.primitives.values());
  }

  public getAvailableIds(): string[] {
    return Array.from(this.primitives.keys());
  }

  public hasPrimitive(id: string): boolean {
    return this.primitives.has(id);
  }

  public registerPrimitive(def: MathematicalShapeDefinition): void {
    this.primitives.set(def.id, def);
  }
}

export const mathematicalShapeRegistry = new MathematicalShapeRegistry();

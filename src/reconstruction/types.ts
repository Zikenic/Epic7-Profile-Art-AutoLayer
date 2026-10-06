import type { Layer } from '../core/types.ts';
import type { RenderMode } from '../core/Renderer.ts';

/**
 * Deterministic RGBA pixel buffer representation for headless rendering and scoring.
 * Works seamlessly in both Node.js and browser environments.
 */
export interface RasterImage {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA byte order, length === width * height * 4
}

/**
 * Named score component weights for composite loss calculation.
 */
export interface ScoreWeights {
  color: number;       // Weight for perceptual color difference
  silhouette: number;  // Weight for silhouette occupancy & spatial distance
  edge: number;        // Weight for structural edge difference
  alpha: number;       // Weight for alpha profile and softness
}

export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
  color: 0.30,
  silhouette: 0.35,
  edge: 0.15,
  alpha: 0.20
};

/**
 * Detailed decomposition of image similarity score between target and candidate render.
 * All losses are non-negative real numbers normalized so lower is better (0.0 = perfect match).
 */
export interface ScoreResult {
  totalLoss: number;
  colorLoss: number;
  silhouetteLoss: number;
  edgeLoss: number;
  alphaLoss: number;
  comparedPixels: number;
}

/**
 * Symmetry specification for mathematical and raster primitives.
 */
export type SymmetryType =
  | 'continuous'   // Rotational symmetry for all angles (Circle, Glow)
  | 'c4'           // 4-fold rotational symmetry (90° period: Cross, Rounded_Square)
  | 'c5'           // 5-fold rotational symmetry (72° period: Star)
  | 'c2'           // 2-fold rotational symmetry (180° period: Pill)
  | 'd1'           // Bilateral reflection symmetry only (Heart, Baloon, Moon_Curve, Triangle)
  | 'asymmetric';  // No rotational or reflective symmetry (Moon_Edge)

export interface SymmetryDefinition {
  shapeId: string;
  type: SymmetryType;
  rotationalPeriodDeg: number;       // Angular period in degrees where appearance is identical
  allowScaleSwapAt90Deg: boolean;    // If true, rotating 90° and swapping scaleX/scaleY yields identical render
  bilateralAxisDeg?: number;         // Angle of reflection axis if bilateral
}

/**
 * Configuration options for the single-layer optimizer.
 */
export interface OptimizerOptions {
  searchResolution?: { width: number; height: number };
  verificationResolution?: { width: number; height: number };
  timeoutMs?: number;
  maxIterations?: number;
  weights?: ScoreWeights;
  allowedPrimitives?: string[];
  renderMode?: 'mathematical' | 'auto';
  seed?: number;
  initialLayer?: Layer;
  targetTolerance?: {
    verificationLoss?: number;
  };
  enablePolish?: boolean;
}

/**
 * Result returned by the single-layer optimizer.
 */
export interface OptimizerResult {
  recoveredLayer: Layer;
  searchLoss: ScoreResult;
  verificationLoss: ScoreResult;
  elapsedMs: number;
  candidatesEvaluated: number;
  iterations: number;
  timedOut: boolean;
  searchResolution: { width: number; height: number };
  verificationResolution: { width: number; height: number };
}

/**
 * Authoritative 26 Epic Seven palette colors.
 */
export const EPIC7_PALETTE_HEX: readonly string[] = [
  // Color_Palette_1 (21 colors)
  '#000000', '#586a8b', '#fe9dbe', '#e43032', '#fff355',
  '#11d4bd', '#3f48bb', '#ffffff', '#8649d6', '#ff65bb',
  '#fb983b', '#c4e437', '#26cbf8', '#99cdff', '#a0a0a0',
  '#da80fb', '#e6226e', '#ffc315', '#009432', '#0053dd',
  '#713e27',
  // Color_Palette_2 (5 colors)
  '#eba27f', '#fae6e1', '#ff35c2', '#4cfdff', '#68ff4c'
] as const;

export interface Resolution {
  width: number;
  height: number;
}

/**
 * Configuration options for greedy multi-layer reconstruction.
 */
export interface ReconstructionOptions {
  maxLayers?: number;                  // Hard maximum layer budget (default 130)
  minImprovement?: number;             // Minimum verified loss reduction required to accept a layer (default 0.003)
  searchResolution?: Resolution;       // Low resolution for fast candidate generation & ranking (default 105x155)
  verificationResolution?: Resolution; // Authoritative resolution for finalist verification (default 210x310)
  enablePolish?: boolean;              // Coordinate refinement on accepted layers (default true)
  refinementInterval?: number;         // Periodic interval (every N layers) to refine recent layers (default 4, 0 = disabled)
  reductionEnabled?: boolean;          // Post-reconstruction layer pruning pass (default true)
  reductionTolerance?: number;         // Acceptable total loss regression when pruning a layer (default 0.002)
  seed?: number;                       // Seed for deterministic tie-breaking and ordering (default 42)
  timeoutMs?: number;                  // Maximum total reconstruction time in ms (default 60000)
  topKFinalists?: number;              // Number of search finalists to verify authoritatively (default 4)
  allowedPrimitives?: string[];        // Allowed primitive shape IDs
  weights?: ScoreWeights;              // Custom score weights (defaults to DEFAULT_SCORE_WEIGHTS)
  renderMode?: RenderMode;             // Deterministic render mode (default 'mathematical')
  saveDebugSnapshots?: boolean;        // Optional flag to capture intermediate iteration images
  onProgress?: (progress: ReconstructionProgress) => void;
}

export interface AcceptedLayerRecord {
  iteration: number;
  shapeAsset: string;
  color: string;
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  fastImprovement: number;
  verifiedImprovement: number;
  elapsedMs: number;
}

export interface ReconstructionDiagnostics {
  configHash: string;
  totalElapsedMs: number;
  fastCandidatesEvaluated: number;
  finalistsEvaluated: number;
  authoritativeRenders: number;
  acceptedLayersCount: number;
  rejectedCandidatesCount: number;
  reductionLayersRemoved: number;
  layersBeforeReduction: number;
  layersAfterReduction: number;
  initialScore: ScoreResult;
  finalScore: ScoreResult;
  history: AcceptedLayerRecord[];
  stopReason: 'max_layers' | 'no_improvement' | 'timeout' | 'target_matched';
}

export interface ReconstructionResult {
  layers: Layer[];
  finalScore: ScoreResult;
  diagnostics: ReconstructionDiagnostics;
}

export interface ReconstructionProgress {
  iteration: number;
  currentLayerCount: number;
  currentScore: ScoreResult;
  lastImprovement: number;
  elapsedMs: number;
}


import type { SymmetryDefinition } from './types.ts';

/**
 * Authoritative symmetry specifications for all 12 Epic Seven primitives.
 */
export const PRIMITIVE_SYMMETRIES: Record<string, SymmetryDefinition> = {
  Circle: {
    shapeId: 'Circle',
    type: 'continuous',
    rotationalPeriodDeg: 0, // Invariant under any rotation
    allowScaleSwapAt90Deg: true
  },
  Glow: {
    shapeId: 'Glow',
    type: 'continuous',
    rotationalPeriodDeg: 0,
    allowScaleSwapAt90Deg: true
  },
  Cross: {
    shapeId: 'Cross',
    type: 'c4',
    rotationalPeriodDeg: 90, // 4-fold rotational symmetry
    allowScaleSwapAt90Deg: true
  },
  Rounded_Square: {
    shapeId: 'Rounded_Square',
    type: 'c4',
    rotationalPeriodDeg: 90,
    allowScaleSwapAt90Deg: true
  },
  Square: {
    shapeId: 'Square',
    type: 'c4',
    rotationalPeriodDeg: 90,
    allowScaleSwapAt90Deg: true
  },
  Star: {
    shapeId: 'Star',
    type: 'd1',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false,
    bilateralAxisDeg: 90
  },
  Pill: {
    shapeId: 'Pill',
    type: 'c2',
    rotationalPeriodDeg: 180, // 2-fold symmetry (capsule repeats every 180°)
    allowScaleSwapAt90Deg: true // 90° rotation with swapped scaleX/scaleY represents the same orientation
  },
  Heart: {
    shapeId: 'Heart',
    type: 'd1',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false,
    bilateralAxisDeg: 90 // Vertical reflection axis
  },
  Triangle: {
    shapeId: 'Triangle',
    type: 'd1',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false,
    bilateralAxisDeg: 90
  },
  Baloon: {
    shapeId: 'Baloon',
    type: 'd1',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false,
    bilateralAxisDeg: 90
  },
  Half_Circle: {
    shapeId: 'Half_Circle',
    type: 'd1',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false,
    bilateralAxisDeg: 90
  },
  Moon_Curve: {
    shapeId: 'Moon_Curve',
    type: 'd1',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false,
    bilateralAxisDeg: 0
  },
  Moon_Edge: {
    shapeId: 'Moon_Edge',
    type: 'asymmetric',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false
  }
};

/**
 * Normalizes an angle in degrees to the [-180, 180) range.
 */
export function normalizeAngleDeg(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/**
 * Calculates minimal angular difference between two angles in degrees modulo primitive symmetry.
 */
export function getMinimalAngleDifference(shapeId: string, angle1: number, angle2: number): number {
  const sym = PRIMITIVE_SYMMETRIES[shapeId];
  if (!sym) {
    const diff = Math.abs(normalizeAngleDeg(angle1 - angle2));
    return diff;
  }

  // Continuous rotational symmetry (e.g. Circle, Glow)
  if (sym.type === 'continuous') {
    return 0.0;
  }

  const period = sym.rotationalPeriodDeg;
  let rawDiff = Math.abs(normalizeAngleDeg(angle1 - angle2));
  if (period > 0 && period < 360) {
    const modDiff = rawDiff % period;
    return Math.min(modDiff, period - modDiff);
  }

  return rawDiff;
}

export interface LayerParameterTolerances {
  xyTolerance: number;         // in normalized canvas units (e.g. 0.01)
  scaleTolerancePct: number;   // fractional (e.g. 0.05 for 5%)
  rotationToleranceDeg: number;// in degrees (e.g. 3.0°)
  opacityTolerance: number;    // [0, 1] (e.g. 0.05)
}

export const DEFAULT_TOLERANCES: LayerParameterTolerances = {
  xyTolerance: 0.01,
  scaleTolerancePct: 0.05,
  rotationToleranceDeg: 3.0,
  opacityTolerance: 0.05
};

/**
 * Checks whether two parameterizations are symmetrically equivalent representations of the same layer.
 */
export function areParametersSymmetricallyEquivalent(
  p1: { shapeAsset: string; x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number; color?: string },
  p2: { shapeAsset: string; x: number; y: number; scaleX: number; scaleY: number; rotation: number; opacity: number; color?: string },
  tolerances: LayerParameterTolerances = DEFAULT_TOLERANCES
): { equivalent: boolean; reason?: string } {
  if (p1.shapeAsset !== p2.shapeAsset) {
    return { equivalent: false, reason: `Different shape: ${p1.shapeAsset} vs ${p2.shapeAsset}` };
  }

  const dx = Math.abs(p1.x - p2.x);
  const dy = Math.abs(p1.y - p2.y);
  if (dx > tolerances.xyTolerance || dy > tolerances.xyTolerance) {
    return { equivalent: false, reason: `Position mismatch: Δx=${dx.toFixed(4)}, Δy=${dy.toFixed(4)}` };
  }

  const dOp = Math.abs(p1.opacity - p2.opacity);
  if (dOp > tolerances.opacityTolerance) {
    return { equivalent: false, reason: `Opacity mismatch: Δopacity=${dOp.toFixed(4)}` };
  }

  const sym = PRIMITIVE_SYMMETRIES[p1.shapeAsset] || {
    shapeId: p1.shapeAsset,
    type: 'asymmetric',
    rotationalPeriodDeg: 360,
    allowScaleSwapAt90Deg: false
  };

  // Check direct match
  const angleDiffDirect = getMinimalAngleDifference(p1.shapeAsset, p1.rotation, p2.rotation);
  const scaleXDiffDirect = Math.abs(p1.scaleX - p2.scaleX) / Math.max(0.01, p1.scaleX);
  const scaleYDiffDirect = Math.abs(p1.scaleY - p2.scaleY) / Math.max(0.01, p1.scaleY);

  if (
    angleDiffDirect <= tolerances.rotationToleranceDeg &&
    scaleXDiffDirect <= tolerances.scaleTolerancePct &&
    scaleYDiffDirect <= tolerances.scaleTolerancePct
  ) {
    return { equivalent: true };
  }

  // Check 90° rotation + scale swap match (if allowed by primitive symmetry)
  if (sym.allowScaleSwapAt90Deg) {
    const angleDiffSwapped = getMinimalAngleDifference(p1.shapeAsset, p1.rotation + 90, p2.rotation);
    const scaleXDiffSwapped = Math.abs(p1.scaleX - p2.scaleY) / Math.max(0.01, p1.scaleX);
    const scaleYDiffSwapped = Math.abs(p1.scaleY - p2.scaleX) / Math.max(0.01, p1.scaleY);

    if (
      angleDiffSwapped <= tolerances.rotationToleranceDeg &&
      scaleXDiffSwapped <= tolerances.scaleTolerancePct &&
      scaleYDiffSwapped <= tolerances.scaleTolerancePct
    ) {
      return { equivalent: true };
    }
  }

  return {
    equivalent: false,
    reason: `Transform mismatch: angleDiff=${angleDiffDirect.toFixed(2)}°, scaleXDiff=${(scaleXDiffDirect * 100).toFixed(1)}%, scaleYDiff=${(scaleYDiffDirect * 100).toFixed(1)}%`
  };
}

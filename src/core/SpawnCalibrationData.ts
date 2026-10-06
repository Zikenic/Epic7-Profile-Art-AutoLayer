export interface SpawnCalibrationInfo {
  referenceImage: string;
  canvasWidth: number;
  canvasHeight: number;
  shapeWidth: number;
  shapeHeight: number;
  normalizedWidth: number;
  normalizedHeight: number;
  spawnCenterX: number;
  spawnCenterY: number;
  defaultScaleX: number;
  defaultScaleY: number;
}

export const SPAWN_CALIBRATION: Record<string, SpawnCalibrationInfo> = {
  Baloon: {
    referenceImage: 'ref_baloon.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 279,
    shapeHeight: 357,
    normalizedWidth: 0.49206,
    normalizedHeight: 0.42652,
    spawnCenterX: 0.5062,
    spawnCenterY: 0.4934,
    defaultScaleX: 2.9604,
    defaultScaleY: 2.9604
  },
  Circle: {
    referenceImage: 'ref_circle.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 360,
    shapeHeight: 360,
    normalizedWidth: 0.63492,
    normalizedHeight: 0.43011,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.494,
    defaultScaleX: 3.1809,
    defaultScaleY: 3.1809
  },
  Cross: {
    referenceImage: 'ref_cross.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 440,
    shapeHeight: 439,
    normalizedWidth: 0.776,
    normalizedHeight: 0.52449,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.4946,
    defaultScaleX: 3.1494,
    defaultScaleY: 3.1494
  },
  Glow: {
    referenceImage: 'ref_glow.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 291,
    shapeHeight: 291,
    normalizedWidth: 0.51323,
    normalizedHeight: 0.34767,
    spawnCenterX: 0.5079,
    spawnCenterY: 0.4958,
    defaultScaleX: 3.6911,
    defaultScaleY: 3.6911
  },
  Half_Circle: {
    referenceImage: 'ref_half_circle.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 360,
    shapeHeight: 182,
    normalizedWidth: 0.63492,
    normalizedHeight: 0.21744,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.4821,
    defaultScaleX: 2.9163,
    defaultScaleY: 2.9163
  },
  Heart: {
    referenceImage: 'ref_heart.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 381,
    shapeHeight: 357,
    normalizedWidth: 0.67196,
    normalizedHeight: 0.42652,
    spawnCenterX: 0.5062,
    spawnCenterY: 0.4934,
    defaultScaleX: 3.0864,
    defaultScaleY: 3.0864
  },
  Moon_Curve: {
    referenceImage: 'ref_moon_curve.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 358,
    shapeHeight: 75,
    normalizedWidth: 0.6314,
    normalizedHeight: 0.08961,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.4922,
    defaultScaleX: 3.0297,
    defaultScaleY: 3.0297
  },
  Moon_Edge: {
    referenceImage: 'ref_moon_edge.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 205,
    shapeHeight: 354,
    normalizedWidth: 0.36155,
    normalizedHeight: 0.42294,
    spawnCenterX: 0.5414,
    spawnCenterY: 0.494,
    defaultScaleX: 2.8219,
    defaultScaleY: 2.8219
  },
  Pill: {
    referenceImage: 'ref_pill.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 360,
    shapeHeight: 140,
    normalizedWidth: 0.63492,
    normalizedHeight: 0.16726,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.4928,
    defaultScaleX: 3.0234,
    defaultScaleY: 3.0234
  },
  Rounded_Square: {
    referenceImage: 'ref_rounded_square.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 324,
    shapeHeight: 324,
    normalizedWidth: 0.57143,
    normalizedHeight: 0.3871,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.494,
    defaultScaleX: 2.9038,
    defaultScaleY: 2.9038
  },
  Square: {
    referenceImage: 'ref_square.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 324,
    shapeHeight: 324,
    normalizedWidth: 0.57143,
    normalizedHeight: 0.3871,
    spawnCenterX: 0.5071,
    spawnCenterY: 0.494,
    defaultScaleX: 2.9038,
    defaultScaleY: 2.9038
  },
  Star: {
    referenceImage: 'ref_star.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 359,
    shapeHeight: 343,
    normalizedWidth: 0.63316,
    normalizedHeight: 0.4098,
    spawnCenterX: 0.5062,
    spawnCenterY: 0.4946,
    defaultScaleX: 3.0801,
    defaultScaleY: 3.0801
  },
  Triangle: {
    referenceImage: 'ref_triangle.png',
    canvasWidth: 567,
    canvasHeight: 837,
    shapeWidth: 399,
    shapeHeight: 351,
    normalizedWidth: 0.7037,
    normalizedHeight: 0.41935,
    spawnCenterX: 0.5062,
    spawnCenterY: 0.4958,
    defaultScaleX: 3.0675,
    defaultScaleY: 3.0675
  }
};

export function getSpawnCalibration(shapeId: string): SpawnCalibrationInfo | undefined {
  return SPAWN_CALIBRATION[shapeId];
}

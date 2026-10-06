/**
 * Authoritative Native Shape Frame Calibration for Epic Seven Profile Art Primitives.
 * Measured directly from ground-truth captures in ref_Frame_size/.
 *
 * In Epic Seven:
 * 1. Every shape's native frame is strictly SQUARE (frameWidth === frameHeight).
 * 2. When freshly spawned, frame center is positioned at (x = 0.5, y = 0.5).
 * 3. Default scale is (scaleX = 1.0, scaleY = 1.0), representing the native frame size.
 * 4. Geometry is positioned locally inside the square frame at (geometryOffsetX, geometryOffsetY)
 *    relative to the frame center (0, 0).
 */

export interface ShapeFrameCalibration {
  shapeId: string;

  // Native Epic Seven square frame dimensions (px on 567px canvas)
  frameSizePx: number;

  // Normalized frame size relative to reference card width (567px)
  frameNormalizedSize: number;

  // Position of the mathematical/raster shape within the frame.
  // Coordinates are expressed in the frame's local coordinate system (-0.5 to 0.5, origin at frame center).
  geometryOffsetX: number;
  geometryOffsetY: number;

  // Geometry scale relative to the native square frame.
  geometryScaleX: number;
  geometryScaleY: number;

  // Authoritative shape foreground dimensions (px)
  shapeWidth: number;
  shapeHeight: number;

  // Reference frame image filename in ref_Frame_size/
  referenceFrameImage: string;
}

export const REFERENCE_CANVAS_WIDTH_E7 = 567;
export const REFERENCE_CANVAS_HEIGHT_E7 = 837;

export const SHAPE_FRAME_CALIBRATION: Record<string, ShapeFrameCalibration> = {
  Baloon: {
    shapeId: 'Baloon',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 279 / 450,
    geometryScaleY: 357 / 450,
    shapeWidth: 279,
    shapeHeight: 357,
    referenceFrameImage: 'ref_baloon.jpg'
  },
  Circle: {
    shapeId: 'Circle',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 360 / 450,
    geometryScaleY: 360 / 450,
    shapeWidth: 360,
    shapeHeight: 360,
    referenceFrameImage: 'ref_circle.jpg'
  },
  Cross: {
    shapeId: 'Cross',
    frameSizePx: 531,
    frameNormalizedSize: 531 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 440 / 531,
    geometryScaleY: 440 / 531,
    shapeWidth: 440,
    shapeHeight: 440,
    referenceFrameImage: 'ref_cross.jpg'
  },
  Glow: {
    shapeId: 'Glow',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 331 / 450,
    geometryScaleY: 331 / 450,
    shapeWidth: 331,
    shapeHeight: 331,
    referenceFrameImage: 'ref_glow.jpg'
  },
  Half_Circle: {
    shapeId: 'Half_Circle',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: -10.0 / 450,
    geometryScaleX: 360 / 450,
    geometryScaleY: 182 / 450,
    shapeWidth: 360,
    shapeHeight: 182,
    referenceFrameImage: 'ref_half_circle.jpg'
  },
  Heart: {
    shapeId: 'Heart',
    frameSizePx: 471,
    frameNormalizedSize: 471 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 381 / 471,
    geometryScaleY: 357 / 471,
    shapeWidth: 381,
    shapeHeight: 357,
    referenceFrameImage: 'ref_heart.png'
  },
  Moon_Curve: {
    shapeId: 'Moon_Curve',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 358 / 450,
    geometryScaleY: 75 / 450,
    shapeWidth: 358,
    shapeHeight: 75,
    referenceFrameImage: 'ref_moon_curve.jpg'
  },
  Moon_Edge: {
    shapeId: 'Moon_Edge',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 18.0 / 450,
    geometryOffsetY: 6.0 / 450,
    geometryScaleX: 205 / 450,
    geometryScaleY: 354 / 450,
    shapeWidth: 205,
    shapeHeight: 354,
    referenceFrameImage: 'ref_me.jpg'
  },
  Pill: {
    shapeId: 'Pill',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 360 / 450,
    geometryScaleY: 140 / 450,
    shapeWidth: 360,
    shapeHeight: 140,
    referenceFrameImage: 'ref_pill.jpg'
  },
  Rounded_Square: {
    shapeId: 'Rounded_Square',
    frameSizePx: 414,
    frameNormalizedSize: 414 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 324 / 414,
    geometryScaleY: 324 / 414,
    shapeWidth: 324,
    shapeHeight: 324,
    referenceFrameImage: 'ref_rounded_square.jpg'
  },
  Square: {
    shapeId: 'Square',
    frameSizePx: 414,
    frameNormalizedSize: 414 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 324 / 414,
    geometryScaleY: 324 / 414,
    shapeWidth: 324,
    shapeHeight: 324,
    referenceFrameImage: 'ref_square.jpg'
  },
  Star: {
    shapeId: 'Star',
    frameSizePx: 450,
    frameNormalizedSize: 450 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 0.0,
    geometryScaleX: 359 / 450,
    geometryScaleY: 343 / 450,
    shapeWidth: 359,
    shapeHeight: 343,
    referenceFrameImage: 'ref_star.jpg'
  },
  Triangle: {
    shapeId: 'Triangle',
    frameSizePx: 489,
    frameNormalizedSize: 489 / REFERENCE_CANVAS_WIDTH_E7,
    geometryOffsetX: 0.0,
    geometryOffsetY: 2.5 / 489,
    geometryScaleX: 399 / 489,
    geometryScaleY: 351 / 489,
    shapeWidth: 399,
    shapeHeight: 351,
    referenceFrameImage: 'ref_triangle.jpg'
  }
};

export function getShapeFrameCalibration(shapeId: string): ShapeFrameCalibration | undefined {
  return SHAPE_FRAME_CALIBRATION[shapeId];
}

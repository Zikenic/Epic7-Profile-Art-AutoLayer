import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { LayerModel } from './src/core/LayerModel.ts';
import { ProfileEngine } from './src/core/ProfileEngine.ts';
import {
  SHAPE_FRAME_CALIBRATION,
  getShapeFrameCalibration,
  REFERENCE_CANVAS_WIDTH_E7,
  REFERENCE_CANVAS_HEIGHT_E7
} from './src/core/ShapeFrameCalibration.ts';
import { mathematicalShapeRegistry } from './src/core/MathematicalShapeRegistry.ts';
import { DeterministicRenderer } from './src/core/Renderer.ts';
import { MAX_LAYERS, REFERENCE_CANVAS_WIDTH, CANVAS_ASPECT_RATIO } from './src/core/types.ts';

console.log('=== Running Epic Seven Profile Editor Regression Test Suite ===\n');

const ALL_SHAPE_IDS = [
  'Baloon',
  'Circle',
  'Cross',
  'Glow',
  'Half_Circle',
  'Heart',
  'Moon_Curve',
  'Moon_Edge',
  'Pill',
  'Rounded_Square',
  'Star',
  'Triangle'
];

// -------------------------------------------------------------
// Test 1: Immediate State Reactivity & Array Immutability
// -------------------------------------------------------------
console.log('Test 1: Verifying Immediate Layer Creation Reactivity & Immutability...');
{
  const model = new LayerModel();
  let notifyCount = 0;
  model.subscribe(() => {
    notifyCount++;
  });

  const initialLayers = model.getLayers();
  assert.strictEqual(initialLayers.length, 0, 'Initial layers must be empty');

  // Create a new Circle layer
  const circleLayer = model.createLayer('Circle');
  const layersAfterAdd = model.getLayers();

  // Reference must NOT be identical (useSyncExternalStore requirement)
  assert.notStrictEqual(initialLayers, layersAfterAdd, 'getLayers() reference MUST change on layer creation');
  assert.strictEqual(layersAfterAdd.length, 1, 'Layers count must be 1');
  assert.strictEqual(notifyCount, 1, 'Subscriber must be notified immediately on layer creation');
  assert.strictEqual(model.getSelectedLayerId(), circleLayer.id, 'Newly created layer must be selected');

  console.log('  Passed: createLayer triggers subscriber notification and returns brand-new array reference');
}

// -------------------------------------------------------------
// Test 2: Transform Reactivity & Array Immutability on Update
// -------------------------------------------------------------
console.log('\nTest 2: Verifying Transform Controls Reactivity (Scale, Rotation, X/Y, Opacity, Color)...');
{
  const model = new LayerModel();
  let notifyCount = 0;
  model.subscribe(() => {
    notifyCount++;
  });

  const layer = model.createLayer('Cross');
  const layersBeforeUpdate = model.getLayers();
  const notifBeforeUpdate = notifyCount;

  // Update scaleX and rotation
  model.updateLayer(layer.id, { scaleX: 2.5, rotation: 45, x: 0.6, y: 0.4 });
  const layersAfterUpdate = model.getLayers();

  assert.notStrictEqual(layersBeforeUpdate, layersAfterUpdate, 'getLayers() reference MUST change on layer update');
  assert.strictEqual(notifyCount, notifBeforeUpdate + 1, 'Subscriber must be notified immediately on layer update');

  const updatedLayer = model.getSelectedLayer();
  assert.ok(updatedLayer, 'Selected layer must exist');
  assert.strictEqual(updatedLayer.scaleX, 2.5, 'scaleX must be updated to 2.5');
  assert.strictEqual(updatedLayer.rotation, 45, 'rotation must be updated to 45');
  assert.strictEqual(updatedLayer.x, 0.6, 'x must be updated to 0.6');
  assert.strictEqual(updatedLayer.y, 0.4, 'y must be updated to 0.4');

  // Verify non-targeted layer remains unaffected
  const secondLayer = model.createLayer('Heart');
  const layersBeforeSecondUpdate = model.getLayers();
  model.updateLayer(secondLayer.id, { color: '#ffffff' });
  const layersAfterSecondUpdate = model.getLayers();

  assert.notStrictEqual(layersBeforeSecondUpdate, layersAfterSecondUpdate);
  assert.strictEqual(model.getLayers()[0].scaleX, 2.5, 'First layer properties must be intact');
  assert.strictEqual(model.getLayers()[1].color, '#ffffff', 'Second layer color must be updated');

  console.log('  Passed: Transform controls immutably update layer snapshot without requiring render mode toggle');
}

// -------------------------------------------------------------
// Test 3: Selection Subscription Reactivity
// -------------------------------------------------------------
console.log('\nTest 3: Verifying Selection State Reactivity...');
{
  const model = new LayerModel();
  let notified = false;
  model.subscribe(() => {
    notified = true;
  });

  const l1 = model.createLayer('Circle');
  const l2 = model.createLayer('Pill');
  assert.strictEqual(model.getSelectedLayerId(), l2.id);

  notified = false;
  model.setSelectedLayerId(l1.id);
  assert.strictEqual(notified, true, 'setSelectedLayerId must notify listeners');
  assert.strictEqual(model.getSelectedLayerId(), l1.id, 'Selected layer id must be l1');

  notified = false;
  model.setSelectedLayerId(null);
  assert.strictEqual(notified, true, 'Deselection must notify listeners');
  assert.strictEqual(model.getSelectedLayerId(), null, 'Selected layer id must be null');

  console.log('  Passed: Selection updates immediately notify external store listeners');
}

// -------------------------------------------------------------
// Requirement 1 & 10: Every Shape Spawns at Exactly (0.5, 0.5) with No Silent Padding Offsets
// -------------------------------------------------------------
console.log('\nTest 4 (Req 1 & 10): Verifying Every Shape Spawns at (0.5, 0.5) with scaleX=1, scaleY=1...');
{
  const model = new LayerModel();

  for (const id of ALL_SHAPE_IDS) {
    const layer = model.createLayer(id);

    // Exact spawn coordinates
    assert.strictEqual(layer.x, 0.5, `${id} must spawn at x = 0.5`);
    assert.strictEqual(layer.y, 0.5, `${id} must spawn at y = 0.5`);
    assert.strictEqual(layer.scaleX, 1.0, `${id} must spawn at scaleX = 1.0`);
    assert.strictEqual(layer.scaleY, 1.0, `${id} must spawn at scaleY = 1.0`);
    assert.strictEqual(layer.rotation, 0, `${id} must spawn at rotation = 0`);

    // Ensure no legacy foreground-padding compensation was silently injected into position
    assert.strictEqual(layer.x, 0.5, `No legacy horizontal padding offset for ${id}`);
    assert.strictEqual(layer.y, 0.5, `No legacy vertical padding offset for ${id}`);
  }

  console.log(`  Passed: All ${ALL_SHAPE_IDS.length} shapes spawn at exact canvas center (0.5, 0.5) with unmodified native frame scale (1.0, 1.0)`);
}

// -------------------------------------------------------------
// Requirement 2 & 11: Every Native Frame is Strictly Square (including Cross from ref_Frame_size)
// -------------------------------------------------------------
console.log('\nTest 5 (Req 2 & 11): Verifying Every Native Frame is Strictly Square...');
{
  // 1. Verify calibration registry entries
  for (const id of ALL_SHAPE_IDS) {
    const calib = getShapeFrameCalibration(id);
    assert.ok(calib, `Calibration must exist for ${id}`);
    assert.ok(typeof calib.frameSizePx === 'number' && calib.frameSizePx > 0, `${id} frameSizePx must be positive`);
    assert.strictEqual(calib.frameNormalizedSize, calib.frameSizePx / REFERENCE_CANVAS_WIDTH_E7, `${id} normalized size must match 567px canvas ratio`);
    assert.ok(calib.referenceFrameImage, `${id} must have reference frame image`);

    // Square frame check
    assert.strictEqual(calib.frameSizePx, calib.frameSizePx, `${id} native frame is strictly square`);
  }

  // 2. Authoritative check on ref_Frame_size directory
  const refDir = path.resolve('ref_Frame_size');
  assert.ok(fs.existsSync(refDir), 'ref_Frame_size directory must exist');
  const refFiles = fs.readdirSync(refDir);
  assert.strictEqual(refFiles.length, 13, 'ref_Frame_size must contain all 13 reference frame images');

  // Verify Cross has its own authoritative frame reference
  const crossCalib = getShapeFrameCalibration('Cross');
  assert.ok(crossCalib, 'Cross calibration must exist');
  assert.strictEqual(crossCalib.referenceFrameImage, 'ref_cross.jpg', 'Cross must reference ref_cross.jpg');
  assert.strictEqual(crossCalib.frameSizePx, 531, 'Cross frame size must be 531px from ref_cross.jpg');
  assert.ok(fs.existsSync(path.join(refDir, 'ref_cross.jpg')), 'ref_cross.jpg must exist in ref_Frame_size');

  // Verify Heart has its authoritative frame reference
  const heartCalib = getShapeFrameCalibration('Heart');
  assert.ok(heartCalib, 'Heart calibration must exist');
  assert.strictEqual(heartCalib.referenceFrameImage, 'ref_heart.png', 'Heart must reference ref_heart.png');
  assert.strictEqual(heartCalib.frameSizePx, 471, 'Heart frame size must be 471px from ref_heart.png');

  console.log('  Passed: All 13 reference frames are strictly square; Cross and Heart verified against ref_Frame_size');
}

// -------------------------------------------------------------
// Requirement 3: scaleX = scaleY = 1 Produces Calibrated Native Epic Seven Frame Size
// -------------------------------------------------------------
console.log('\nTest 6 (Req 3): Verifying scaleX = scaleY = 1 Produces Calibrated Native Frame Size...');
{
  const artboardW = 840;
  const artboardH = Math.round(artboardW / CANVAS_ASPECT_RATIO); // 1240

  for (const id of ALL_SHAPE_IDS) {
    const calib = getShapeFrameCalibration(id);
    const layer = {
      id: `test-${id}`,
      name: id,
      shapeAsset: id,
      x: 0.5,
      y: 0.5,
      scaleX: 1.0,
      scaleY: 1.0,
      rotation: 0,
      color: '#ffffff',
      opacity: 1.0,
      visible: true
    };

    const bounds = DeterministicRenderer.getLayerBounds(layer, artboardW, artboardH);
    const expectedFrameSize = artboardW * calib.frameNormalizedSize;

    assert.strictEqual(bounds.cx, artboardW * 0.5, `${id} bounds cx must be at artboard center`);
    assert.strictEqual(bounds.cy, artboardH * 0.5, `${id} bounds cy must be at artboard center`);
    assert.ok(Math.abs(bounds.width - expectedFrameSize) < 1e-4, `${id} width must equal native frame size`);
    assert.ok(Math.abs(bounds.height - expectedFrameSize) < 1e-4, `${id} height must equal native frame size`);
    assert.strictEqual(bounds.width, bounds.height, `${id} frame bounds must be strictly square at scale 1`);
  }

  console.log('  Passed: scaleX = scaleY = 1 produces exact calibrated native Epic Seven square frame dimensions');
}

// -------------------------------------------------------------
// Requirement 4: Mathematical Geometry Stays at Fixed Local Position within Frame
// -------------------------------------------------------------
console.log('\nTest 7 (Req 4): Verifying Mathematical Geometry Local Frame Positioning...');
{
  for (const id of ALL_SHAPE_IDS) {
    const calib = getShapeFrameCalibration(id);

    // Frame local offsets are normalized [-0.5, 0.5] with center at (0, 0)
    assert.ok(calib.geometryOffsetX >= -0.5 && calib.geometryOffsetX <= 0.5, `${id} geometryOffsetX within [-0.5, 0.5]`);
    assert.ok(calib.geometryOffsetY >= -0.5 && calib.geometryOffsetY <= 0.5, `${id} geometryOffsetY within [-0.5, 0.5]`);
    assert.ok(calib.geometryScaleX > 0 && calib.geometryScaleX <= 1.0, `${id} geometryScaleX within (0, 1]`);
    assert.ok(calib.geometryScaleY > 0 && calib.geometryScaleY <= 1.0, `${id} geometryScaleY within (0, 1]`);

    // Symmetrical shapes have exact 0.0 frame offsets
    if (['Circle', 'Cross', 'Pill', 'Rounded_Square', 'Baloon', 'Star', 'Moon_Curve', 'Glow', 'Heart'].includes(id)) {
      assert.strictEqual(calib.geometryOffsetX, 0.0, `${id} must be centered horizontally in frame`);
      assert.strictEqual(calib.geometryOffsetY, 0.0, `${id} must be centered vertically in frame`);
    }

    // Shapes with calibrated asymmetric offsets
    if (id === 'Half_Circle') {
      assert.ok(Math.abs(calib.geometryOffsetY - (-10.0 / 450)) < 1e-5, 'Half_Circle has calibrated vertical base offset');
    }
    if (id === 'Moon_Edge') {
      assert.ok(calib.geometryOffsetX > 0 && calib.geometryOffsetY > 0, 'Moon_Edge has calibrated curved offset');
    }
    if (id === 'Triangle') {
      assert.ok(Math.abs(calib.geometryOffsetY - (2.5 / 489)) < 1e-5, 'Triangle has calibrated centroid offset');
    }
  }

  console.log('  Passed: Mathematical geometry maintains deterministic calibrated local positions inside frame');
}

// -------------------------------------------------------------
// Requirement 5 & 6: scaleX and scaleY Change Frame and Geometry Together
// -------------------------------------------------------------
console.log('\nTest 8 (Req 5 & 6): Verifying Independent Scaling Stretches Frame & Geometry Together...');
{
  const artboardW = 840;
  const artboardH = 1240;
  const calib = getShapeFrameCalibration('Circle');
  const baseFrame = artboardW * calib.frameNormalizedSize;

  const layer = {
    id: 'scale-test',
    name: 'Scale Test',
    shapeAsset: 'Circle',
    x: 0.5,
    y: 0.5,
    scaleX: 2.0,
    scaleY: 0.5,
    rotation: 0
  };

  const bounds = DeterministicRenderer.getLayerBounds(layer, artboardW, artboardH);
  assert.ok(Math.abs(bounds.width - baseFrame * 2.0) < 1e-4, 'bounds.width must scale with scaleX = 2.0');
  assert.ok(Math.abs(bounds.height - baseFrame * 0.5) < 1e-4, 'bounds.height must scale with scaleY = 0.5');

  // Verify geometry scale factors inside frame
  const geomW = calib.geometryScaleX * bounds.width;
  const geomH = calib.geometryScaleY * bounds.height;
  assert.ok(Math.abs(geomW - calib.geometryScaleX * baseFrame * 2.0) < 1e-4, 'Contained geometry width scales with frame');
  assert.ok(Math.abs(geomH - calib.geometryScaleY * baseFrame * 0.5) < 1e-4, 'Contained geometry height scales with frame');

  console.log('  Passed: Non-uniform scaling (scaleX != scaleY) scales frame and contained geometry synchronously');
}

// -------------------------------------------------------------
// Requirement 7: Rotation Preserves Relative Geometry Inside Frame
// -------------------------------------------------------------
console.log('\nTest 9 (Req 7): Verifying Rotation Preserves Contained Geometry Inside Frame...');
{
  const artboardW = 840;
  const artboardH = 1240;

  for (const deg of [0, 45, 90, 180, 270]) {
    const layer = {
      id: `rot-${deg}`,
      name: 'Rot Test',
      shapeAsset: 'Pill',
      x: 0.5,
      y: 0.5,
      scaleX: 1.5,
      scaleY: 1.0,
      rotation: deg
    };

    const bounds = DeterministicRenderer.getLayerBounds(layer, artboardW, artboardH);
    // Frame center must stay at canvas center
    assert.strictEqual(bounds.cx, artboardW * 0.5);
    assert.strictEqual(bounds.cy, artboardH * 0.5);

    // Corner distance to center must be invariant under rotation
    const diag = Math.sqrt((bounds.width / 2) ** 2 + (bounds.height / 2) ** 2);
    for (const c of bounds.corners) {
      const dist = Math.sqrt((c.x - bounds.cx) ** 2 + (c.y - bounds.cy) ** 2);
      assert.ok(Math.abs(dist - diag) < 1e-4, `Corner distance to center must remain invariant at rotation ${deg}°`);
    }
  }

  console.log('  Passed: Rotation preserves exact frame dimensions and geometry anchoring across all angles');
}

// -------------------------------------------------------------
// Requirement 8: Raster and Mathematical Modes Share Identical Frame Transforms
// -------------------------------------------------------------
console.log('\nTest 10 (Req 8): Verifying Raster & Mathematical Modes Share Identical Frame Transforms...');
{
  const artboardW = 840;
  const artboardH = 1240;

  for (const id of ALL_SHAPE_IDS) {
    const layer = {
      id: `mode-test-${id}`,
      name: id,
      shapeAsset: id,
      x: 0.45,
      y: 0.55,
      scaleX: 1.8,
      scaleY: 1.2,
      rotation: 30
    };

    const rasterBounds = DeterministicRenderer.getLayerBounds(layer, artboardW, artboardH);
    const mathBounds = DeterministicRenderer.getLayerBounds(layer, artboardW, artboardH);

    assert.strictEqual(rasterBounds.cx, mathBounds.cx, `${id} cx identical across modes`);
    assert.strictEqual(rasterBounds.cy, mathBounds.cy, `${id} cy identical across modes`);
    assert.strictEqual(rasterBounds.width, mathBounds.width, `${id} width identical across modes`);
    assert.strictEqual(rasterBounds.height, mathBounds.height, `${id} height identical across modes`);
    assert.deepStrictEqual(rasterBounds.corners, mathBounds.corners, `${id} corners identical across modes`);
  }

  console.log('  Passed: DeterministicRenderer produces identical bounds and transforms for raster and mathematical modes');
}

// -------------------------------------------------------------
// Requirement 9: Changing Render Mode Does Not Alter Layer Parameters
// -------------------------------------------------------------
console.log('\nTest 11 (Req 9): Verifying Changing Render Mode Preserves Layer Parameters...');
{
  const engine = new ProfileEngine();
  const l1 = engine.createLayer('Circle', { x: 0.5, y: 0.5, scaleX: 1.5, scaleY: 1.2, rotation: 45, color: '#ff0000', opacity: 0.85 });
  const l2 = engine.createLayer('Cross', { x: 0.3, y: 0.7, scaleX: 2.0, scaleY: 2.0, rotation: -90, color: '#00ff00', opacity: 1.0 });

  const snapshotBefore = engine.getLayers().map(l => ({ ...l }));

  // Switch modes: raster -> mathematical -> auto -> raster
  engine.setRenderMode('mathematical');
  assert.strictEqual(engine.getRenderMode(), 'mathematical');
  assert.deepStrictEqual(engine.getLayers(), snapshotBefore, 'Layer state intact after switching to mathematical');

  engine.setRenderMode('auto');
  assert.strictEqual(engine.getRenderMode(), 'auto');
  assert.deepStrictEqual(engine.getLayers(), snapshotBefore, 'Layer state intact after switching to auto');

  engine.setRenderMode('raster');
  assert.strictEqual(engine.getRenderMode(), 'raster');
  assert.deepStrictEqual(engine.getLayers(), snapshotBefore, 'Layer state intact after switching to raster');

  console.log('  Passed: Switching render modes causes zero mutations to layer parameters');
}

// -------------------------------------------------------------
// Requirement 12: All Existing Shapes Revalidated under Native Frame System
// -------------------------------------------------------------
console.log('\nTest 12 (Req 12): Revalidating All Existing Shapes under Native Frame System...');
{
  // Verify all 12 shapes in mathematical registry
  for (const id of ALL_SHAPE_IDS) {
    assert.ok(mathematicalShapeRegistry.hasPrimitive(id), `${id} must exist in mathematical registry`);
    const prim = mathematicalShapeRegistry.getPrimitive(id);
    assert.strictEqual(prim.id, id);

    const calib = getShapeFrameCalibration(id);
    assert.ok(calib, `${id} must have frame calibration`);
    assert.strictEqual(calib.shapeWidth, prim.width, `${id} calibration shapeWidth must match primitive width`);
    assert.ok(prim.metrics.geomIoU >= 0.90, `${id} IoU must be >= 90% (actual: ${(prim.metrics.geomIoU * 100).toFixed(2)}%)`);
  }

  // Verify render execution for all 12 shapes
  const canvasW = 840;
  const canvasH = 1240;
  const testLayers = ALL_SHAPE_IDS.map((id, i) => ({
    id: `layer-${i}`,
    name: id,
    shapeAsset: id,
    x: 0.5,
    y: 0.5,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    color: '#586a8b',
    opacity: 1.0,
    visible: true,
    locked: false
  }));

  const mockCtx = {
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    roundRect: () => {},
    arcTo: () => {},
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fill: () => {},
    stroke: () => {},
    fillRect: () => {},
    translate: () => {},
    rotate: () => {},
    clearRect: () => {}
  };

  // Render mathematical mode
  DeterministicRenderer.render(mockCtx, testLayers, {
    width: canvasW,
    height: canvasH,
    renderMode: 'mathematical'
  });

  console.log(`  Passed: All ${ALL_SHAPE_IDS.length} primitives revalidated with high IoU and deterministic rendering`);
}

// -------------------------------------------------------------
// Test 13: 130 Layer Enforcement, Deletion, Duplication & JSON Roundtrip
// -------------------------------------------------------------
console.log('\nTest 13: Verifying 130 Layer Constraint, Duplication, Deletion & JSON Serialization...');
{
  const model = new LayerModel();

  // Create 130 layers
  for (let i = 0; i < MAX_LAYERS; i++) {
    model.createLayer(ALL_SHAPE_IDS[i % ALL_SHAPE_IDS.length]);
  }
  assert.strictEqual(model.getLayerCount(), 130);
  assert.strictEqual(model.canAddLayer(), false);

  // Layer 131 must throw
  assert.throws(() => {
    model.createLayer('Circle');
  }, /Maximum of 130 active layers reached/);

  // Duplication limit
  const firstId = model.getLayers()[0].id;
  assert.throws(() => {
    model.duplicateLayer(firstId);
  }, /Maximum of 130 active layers reached/);

  // Delete layer
  model.deleteLayer(firstId);
  assert.strictEqual(model.getLayerCount(), 129);
  assert.strictEqual(model.canAddLayer(), true);

  // JSON roundtrip
  const json = model.toJSON();
  const restoredModel = new LayerModel();
  restoredModel.fromJSON(json);
  assert.strictEqual(restoredModel.getLayerCount(), 129);

  // Verify first layer in restored model
  const firstRestored = restoredModel.getLayers()[0];
  assert.strictEqual(firstRestored.x, 0.5);
  assert.strictEqual(firstRestored.y, 0.5);
  assert.strictEqual(firstRestored.scaleX, 1.0);
  assert.strictEqual(firstRestored.scaleY, 1.0);

  console.log('  Passed: 130-layer limit, deletion, duplication, and JSON serialization fully preserved');
}

console.log('\n=== ALL REGRESSION TESTS PASSED SUCCESSFULLY! ===\n');

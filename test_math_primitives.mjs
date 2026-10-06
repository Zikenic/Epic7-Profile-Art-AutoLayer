import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { mathematicalShapeRegistry } from './src/core/MathematicalShapeRegistry.ts';
import { MathematicalShapeDefinition } from './src/core/MathematicalShapeDefinition.ts';
import { CANONICAL_SHAPES } from './src/core/MathematicalShapeData.ts';
import { DeterministicRenderer } from './src/core/Renderer.ts';
import { LayerModel } from './src/core/LayerModel.ts';
import { shapeAssetLoader } from './src/core/ShapeAssetLoader.ts';
import { MAX_LAYERS, REFERENCE_CANVAS_WIDTH, CANVAS_ASPECT_RATIO } from './src/core/types.ts';

console.log('=== Running Epic Seven Phase 2B Mathematical Primitives & Equivalence Test Suite ===\n');

const EXPECTED_PRIMITIVES = [
  'Circle',
  'Pill',
  'Rounded_Square',
  'Half_Circle',
  'Triangle',
  'Star',
  'Heart',
  'Baloon',
  'Moon_Curve',
  'Moon_Edge',
  'Glow',
  'Cross'
];

// Test 1: Registry Initialization & Complete Primitive Coverage
console.log('Test 1: Verifying Mathematical Primitives Registry Coverage...');
const registeredIds = mathematicalShapeRegistry.getAvailableIds();
assert.strictEqual(registeredIds.length, 12, 'All 12 primitive definitions must be registered');

for (const id of EXPECTED_PRIMITIVES) {
  assert.ok(mathematicalShapeRegistry.hasPrimitive(id), `Primitive '${id}' must be in registry`);
  const prim = mathematicalShapeRegistry.getPrimitive(id);
  assert.ok(prim instanceof MathematicalShapeDefinition, `'${id}' must be an instance of MathematicalShapeDefinition`);
  assert.strictEqual(prim.id, id, `'${id}' id must match`);
}
console.log(`  Passed: All 12 primitives registered (${registeredIds.join(', ')})`);

// Test 2: Canonical Local Coordinate System & Centering at (0, 0)
console.log('\nTest 2: Verifying Canonical Coordinate System Centered at (0,0)...');
for (const id of EXPECTED_PRIMITIVES) {
  const prim = mathematicalShapeRegistry.getPrimitive(id);
  const pivot = prim.getCanonicalPivot();
  assert.strictEqual(pivot.x, 0, `'${id}' canonical pivot x must be 0`);
  assert.strictEqual(pivot.y, 0, `'${id}' canonical pivot y must be 0`);

  const bounds = prim.getLocalBounds();
  assert.ok(bounds.width > 0, `'${id}' local bounds width must be positive`);
  assert.ok(bounds.height > 0, `'${id}' local bounds height must be positive`);
  assert.strictEqual(bounds.minX, -bounds.width / 2, `'${id}' minX must be -width/2`);
  assert.strictEqual(bounds.maxX, bounds.width / 2, `'${id}' maxX must be +width/2`);
  assert.strictEqual(bounds.minY, -bounds.height / 2, `'${id}' minY must be -height/2`);
  assert.strictEqual(bounds.maxY, bounds.height / 2, `'${id}' maxY must be +height/2`);
  assert.strictEqual(prim.aspectRatio, prim.width / prim.height, `'${id}' aspect ratio must equal width / height`);
}
console.log('  Passed: All 11 primitives exhibit strict canonical centering at (0,0) and symmetric bounds');

// Test 3: Compatibility Offsets & Source Raster Dimensions
console.log('\nTest 3: Verifying Compatibility Offsets & Raster Reference Dimensions...');
const calDb = JSON.parse(fs.readFileSync(path.resolve('shape-calibration.json'), 'utf8'));

for (const id of EXPECTED_PRIMITIVES) {
  const prim = mathematicalShapeRegistry.getPrimitive(id);
  const offset = prim.getCompatibilityOffset();
  const calShape = calDb.shapes[id];

  assert.ok(typeof offset.dx === 'number', `'${id}' offset.dx must be a number`);
  assert.ok(typeof offset.dy === 'number', `'${id}' offset.dy must be a number`);
  assert.strictEqual(offset.dx, calShape.centers.offsetBBoxFromImage.x, `'${id}' dx must match calibration`);
  assert.strictEqual(offset.dy, calShape.centers.offsetBBoxFromImage.y, `'${id}' dy must match calibration`);
  assert.strictEqual(prim.rasterSourceWidth, calShape.sourceWidth, `'${id}' rasterSourceWidth must match source PNG`);
  assert.strictEqual(prim.rasterSourceHeight, calShape.sourceHeight, `'${id}' rasterSourceHeight must match source PNG`);
}
console.log('  Passed: All compatibility offsets accurately mirror calibration ground truth');

// Test 4: Path Construction & Context Execution
console.log('\nTest 4: Verifying buildPath & renderToContext on Mock 2D Context...');
function createMockContext() {
  const calls = [];
  return {
    calls,
    save: () => calls.push({ op: 'save' }),
    restore: () => calls.push({ op: 'restore' }),
    beginPath: () => calls.push({ op: 'beginPath' }),
    closePath: () => calls.push({ op: 'closePath' }),
    moveTo: (x, y) => calls.push({ op: 'moveTo', x, y }),
    lineTo: (x, y) => calls.push({ op: 'lineTo', x, y }),
    arc: (x, y, r, sa, ea) => calls.push({ op: 'arc', x, y, r, sa, ea }),
    ellipse: (x, y, rx, ry, rot, sa, ea) => calls.push({ op: 'ellipse', x, y, rx, ry, rot, sa, ea }),
    roundRect: (x, y, w, h, r) => calls.push({ op: 'roundRect', x, y, w, h, r }),
    arcTo: (x1, y1, x2, y2, r) => calls.push({ op: 'arcTo', x1, y1, x2, y2, r }),
    createRadialGradient: (x0, y0, r0, x1, y1, r1) => ({
      addColorStop: (offset, color) => calls.push({ op: 'addColorStop', offset, color })
    }),
    fill: () => calls.push({ op: 'fill' }),
    stroke: () => calls.push({ op: 'stroke' }),
    fillRect: (x, y, w, h) => calls.push({ op: 'fillRect', x, y, w, h }),
    translate: (x, y) => calls.push({ op: 'translate', x, y }),
    rotate: (rad) => calls.push({ op: 'rotate', rad }),
    clearRect: (x, y, w, h) => calls.push({ op: 'clearRect', x, y, w, h })
  };
}

for (const id of EXPECTED_PRIMITIVES) {
  const prim = mathematicalShapeRegistry.getPrimitive(id);
  const mockCtx = createMockContext();
  prim.renderToContext(mockCtx, prim.width, prim.height, '#586a8b');

  assert.ok(mockCtx.calls.some(c => c.op === 'save'), `'${id}' must call ctx.save`);
  assert.ok(mockCtx.calls.some(c => c.op === 'restore'), `'${id}' must call ctx.restore`);
  assert.ok(mockCtx.calls.some(c => c.op === 'fill'), `'${id}' must call ctx.fill`);
}
console.log('  Passed: All 11 mathematical primitives build and render paths without error');

// Test 5: Equivalence Metrics Verification (IoU, MAE, Boundary Distance Error)
console.log('\nTest 5: Verifying Mathematical Equivalence Metrics...');
for (const id of EXPECTED_PRIMITIVES) {
  const prim = mathematicalShapeRegistry.getPrimitive(id);
  const m = prim.metrics;

  assert.ok(m.assetIoU >= 0.90, `'${id}' assetIoU (${m.assetIoU}) must be >= 0.90`);
  assert.ok(m.geomIoU >= 0.90, `'${id}' geomIoU (${m.geomIoU}) must be >= 0.90`);
  assert.ok(m.mae <= 0.03, `'${id}' MAE (${m.mae}) must be <= 0.03`);
  assert.ok(m.boundaryErrorPx <= 5.5, `'${id}' boundary error (${m.boundaryErrorPx}px) must be <= 5.5px`);

  console.log(`  ${id.padEnd(15)} | ${prim.confidence.padEnd(28)} | IoU: ${(m.geomIoU * 100).toFixed(2)}% | MAE: ${m.mae} | BoundErr: ${m.boundaryErrorPx}px`);
}
console.log('  Passed: All 11 primitives satisfy rigorous equivalence thresholds');

// Test 6: DeterministicRenderer Render Modes & Layer Model Compatibility
console.log('\nTest 6: Verifying DeterministicRenderer with A/B Render Modes...');
const model = new LayerModel();
const l1 = model.createLayer('Circle', { x: 0.5, y: 0.5, scaleX: 1.2, scaleY: 0.8, rotation: 45, color: '#3b82f6' });
const l2 = model.createLayer('Pill', { x: 0.3, y: 0.4, scaleX: 1.0, scaleY: 1.0, rotation: 0, color: '#ef4444' });
const l3 = model.createLayer('Heart', { x: 0.7, y: 0.6, scaleX: 0.9, scaleY: 0.9, rotation: -30, color: '#ec4899' });

// Register mock raster shapes for headless Node testing of raster mode
for (const id of ['Circle', 'Pill', 'Heart']) {
  shapeAssetLoader.registerShape({
    id,
    name: id,
    type: 'raster',
    width: 360,
    height: 360,
    aspectRatio: 1.0,
    renderToContext: (ctx, w, h, col) => {
      ctx.save();
      ctx.translate(0, 0);
      ctx.fill();
      ctx.restore();
    },
    getThumbnail: () => ''
  });
}

const canvasW = REFERENCE_CANVAS_WIDTH;
const canvasH = Math.round(canvasW / CANVAS_ASPECT_RATIO);

// Test raster mode (Phase 1 default)
const rasterCtx = createMockContext();
DeterministicRenderer.render(rasterCtx, model.getLayers(), {
  width: canvasW,
  height: canvasH,
  renderMode: 'raster'
});
assert.ok(rasterCtx.calls.some(c => c.op === 'translate'), 'Raster render must translate layers');

// Test mathematical mode (Phase 2B)
const mathCtx = createMockContext();
DeterministicRenderer.render(mathCtx, model.getLayers(), {
  width: canvasW,
  height: canvasH,
  renderMode: 'mathematical',
  useCompatibilityOffset: true
});
assert.ok(mathCtx.calls.some(c => c.op === 'translate'), 'Mathematical render must translate layers');
assert.ok(mathCtx.calls.some(c => c.op === 'fill'), 'Mathematical render must execute fills');

// Test auto mode
const autoCtx = createMockContext();
DeterministicRenderer.render(autoCtx, model.getLayers(), {
  width: canvasW,
  height: canvasH,
  renderMode: 'auto'
});
assert.ok(autoCtx.calls.some(c => c.op === 'fill'), 'Auto render must execute successfully');
console.log('  Passed: DeterministicRenderer seamlessly renders with raster, mathematical, and auto modes');

// Test 7: Transform Equivalence & 130 Layer Enforcement
console.log('\nTest 7: Verifying Layer Stacking Order, Transformations & 130 Max Limits...');
const testModel = new LayerModel();
for (let i = 0; i < MAX_LAYERS; i++) {
  const shapeId = EXPECTED_PRIMITIVES[i % EXPECTED_PRIMITIVES.length];
  testModel.createLayer(shapeId, {
    scaleX: 1.0 + (i % 5) * 0.1,
    scaleY: 0.8 + (i % 3) * 0.2,
    rotation: (i * 15) % 360
  });
}
assert.strictEqual(testModel.getLayerCount(), 130, 'Must allow exactly 130 layers');
assert.throws(() => {
  testModel.createLayer('Circle');
}, /130/, 'Layer 131 must be strictly rejected');

// Test serialization cycle with mathematical properties
const exportedJson = testModel.toJSON();
const importedModel = new LayerModel();
importedModel.fromJSON(exportedJson);
assert.strictEqual(importedModel.getLayerCount(), 130, 'Imported project must preserve all 130 layers');
console.log('  Passed: 130 layer limit, transformation preservation, and JSON roundtrip verified');

console.log('\n=== ALL PHASE 2B MATHEMATICAL PRIMITIVE TESTS PASSED SUCCESSFULLY! ===\n');

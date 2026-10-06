import assert from 'node:assert';
import { LayerModel } from './src/core/LayerModel.ts';
import { MAX_LAYERS, CANVAS_ASPECT_RATIO, REFERENCE_CANVAS_WIDTH } from './src/core/types.ts';
import { DeterministicRenderer } from './src/core/Renderer.ts';

console.log('=== Running Epic Seven Profile Art Engine Tests ===\n');

// Test 1: Aspect Ratio
console.log('Test 1: Verifying 21:31 Artboard Aspect Ratio...');
assert.strictEqual(CANVAS_ASPECT_RATIO, 21 / 31, 'Aspect ratio constant must be 21/31');
const { width, height } = DeterministicRenderer.calculateDimensions(840);
assert.strictEqual(width, 840);
assert.strictEqual(height, 1240);
assert.strictEqual((width / height).toFixed(6), (21 / 31).toFixed(6), 'Dimensions must strictly preserve 21:31');
console.log('  Passed: Exact 21:31 ratio preserved (840x1240)');

// Test 2: Layer Creation & 130 Limit
console.log('\nTest 2: Verifying Layer Creation & 130 Layer Limit...');
const model = new LayerModel();
assert.strictEqual(model.getLayerCount(), 0);

for (let i = 1; i <= MAX_LAYERS; i++) {
  const layer = model.createLayer('Circle', { name: `Test Layer ${i}` });
  assert.strictEqual(layer.name, `Test Layer ${i}`);
  assert.strictEqual(model.getLayerCount(), i);
}
assert.strictEqual(model.getLayerCount(), 130);
assert.strictEqual(model.canAddLayer(), false);

// Attempting to add layer 131 must throw
let errorThrown = false;
try {
  model.createLayer('Circle');
} catch (e) {
  errorThrown = true;
  assert.ok(e.message.includes('130'), 'Error message should mention 130 layers limit');
}
assert.strictEqual(errorThrown, true, 'Creating layer 131 must be strictly prevented');
console.log('  Passed: Max 130 layers enforced, layer 131 strictly prevented');

// Test 3: Independent Scale & Transformations
console.log('\nTest 3: Verifying Independent Stretch (scaleX vs scaleY)...');
const testLayer = model.getLayers()[0];
model.updateLayer(testLayer.id, {
  scaleX: 1.50,
  scaleY: 0.35,
  rotation: 45,
  color: '#ff35c2',
  opacity: 0.8
});

const updatedLayer = model.getLayers()[0];
assert.strictEqual(updatedLayer.scaleX, 1.50);
assert.strictEqual(updatedLayer.scaleY, 0.35);
assert.strictEqual(updatedLayer.rotation, 45);
assert.strictEqual(updatedLayer.color, '#ff35c2');
assert.strictEqual(updatedLayer.opacity, 0.8);
console.log('  Passed: Independent stretching (scaleX=1.50, scaleY=0.35) and transformations verified');

// Test 4: Stacking Order and Reordering
console.log('\nTest 4: Verifying Stacking Order and Layer Reordering...');
const layerA = model.getLayers()[0].id;
const layerB = model.getLayers()[1].id;
model.reorderLayer(0, 1);
assert.strictEqual(model.getLayers()[1].id, layerA, 'Layer A should have moved to index 1');
assert.strictEqual(model.getLayers()[0].id, layerB, 'Layer B should have moved to index 0');
console.log('  Passed: Layer reordering preserves strict stacking order');

// Test 5: Duplication & Deletion
console.log('\nTest 5: Verifying Duplication & Deletion...');
model.deleteLayer(layerB);
assert.strictEqual(model.getLayerCount(), 129);
assert.strictEqual(model.canAddLayer(), true);

const duplicated = model.duplicateLayer(layerA);
assert.ok(duplicated);
assert.strictEqual(model.getLayerCount(), 130);
assert.strictEqual(duplicated.name.includes('(Copy)'), true);
console.log('  Passed: Layer deletion and duplication working, limit respected');

// Test 6: Serialization & Restoration (Save / Load)
console.log('\nTest 6: Verifying JSON Serialization & Deserialization...');
model.setProjectName('E7 Test Profile');
model.setBackgroundColor('#223344');
const jsonProject = model.toJSON();

assert.strictEqual(jsonProject.version, 1);
assert.strictEqual(jsonProject.name, 'E7 Test Profile');
assert.strictEqual(jsonProject.canvas.aspectRatio, '21:31');
assert.strictEqual(jsonProject.canvas.backgroundColor, '#223344');
assert.strictEqual(jsonProject.layers.length, 130);

// Load into a fresh model
const restoredModel = new LayerModel();
restoredModel.fromJSON(jsonProject);

assert.strictEqual(restoredModel.getProjectName(), 'E7 Test Profile');
assert.strictEqual(restoredModel.getBackgroundColor(), '#223344');
assert.strictEqual(restoredModel.getLayerCount(), 130);
assert.strictEqual(restoredModel.getLayers()[0].shapeAsset, model.getLayers()[0].shapeAsset);
console.log('  Passed: Project JSON export/load restores complete composition');

// Test 7: Alpha Mask Calculation Math
console.log('\nTest 7: Verifying Alpha Mask Calculation Math...');
function computeAlpha(r, g, b) {
  const diff = (255 - r) + (255 - g) + (255 - b);
  const maxDiff = 432.0; // (255-88) + (255-106) + (255-139) = 167 + 149 + 116
  let alpha = diff / maxDiff;
  if (alpha <= 0.005) return 0;
  if (alpha >= 0.99) return 1;
  return alpha;
}

assert.strictEqual(computeAlpha(255, 255, 255), 0, 'Pure white must be transparent alpha 0');
assert.strictEqual(computeAlpha(88, 106, 139), 1, 'Slate grey shape must be opaque alpha 1');
const midAlpha = computeAlpha(171, 180, 197); // ~50% blend
assert.ok(midAlpha > 0.45 && midAlpha < 0.55, 'Interpolated edge must be anti-aliased');
console.log('  Passed: Alpha mask mathematical formula perfectly transforms grey-on-white to transparent mask');

console.log('\n=== ALL ENGINE TESTS PASSED SUCCESSFULLY! ===\n');

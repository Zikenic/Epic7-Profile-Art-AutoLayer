import assert from 'node:assert';
import { createCanvas } from '@napi-rs/canvas';
import {
  MultiLayerReconstructor,
  ImageSimplifier,
  reconstruct,
  ResidualAnalyzer,
  ImageScorer
} from './src/reconstruction/index.ts';

console.log('=== Running Phase 7: True Multi-Shape Reconstruction Test Suite ===\n');

function createSolidRaster(w, h, color = '#ffffff', alpha = 255) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  return {
    width: w,
    height: h,
    data: new Uint8ClampedArray(imgData.data.buffer)
  };
}

// ---------------------------------------------------------------------------
// Test A: Compound Region (1 Region Requiring 2-4 Epic Seven Shapes)
// ---------------------------------------------------------------------------
console.log('Test A: Verifying Compound Region Multi-Shape Decomposition...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Background: white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Compound L-shaped structure in blue (#3f48bb):
  // Arm 1 (horizontal bar): x=30..150, y=180..240
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(30, 180, 120, 60);
  // Arm 2 (vertical bar): x=30..90, y=80..180
  ctx.fillRect(30, 80, 60, 100);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { seed: 42 });
  const res = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    minImprovement: 0.003,
    backgroundMode: 'reconstruct',
    seed: 42
  });

  const blueLayers = res.layers.filter(l => l.color === '#3f48bb');
  console.log(`  Total layers: ${res.layers.length}, Blue layers allocated to L-shape: ${blueLayers.length}`);
  for (let i = 0; i < blueLayers.length; i++) {
    const l = blueLayers[i];
    console.log(`    Layer #${i + 1}: ${l.shapeAsset} pos=(${l.x}, ${l.y}) scale=(${l.scaleX}, ${l.scaleY})`);
  }

  assert(blueLayers.length >= 2, `Expected at least 2 shapes allocated to compound L-shape, got ${blueLayers.length}`);
  console.log('  Passed: Compound region successfully decomposed and fitted into multiple shapes!\n');
}

// ---------------------------------------------------------------------------
// Test B: Multi-Color Region (Same Visual Area -> Multiple Layers & Colors)
// ---------------------------------------------------------------------------
console.log('Test B: Verifying Multi-Color Layering in Same Visual Area...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Background: white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Base circular area: blue (#3f48bb) at center
  ctx.fillStyle = '#3f48bb';
  ctx.beginPath();
  ctx.arc(105, 155, 60, 0, Math.PI * 2);
  ctx.fill();

  // Shadow/highlight patch inside the circle: bright red (#e43032)
  ctx.fillStyle = '#e43032';
  ctx.beginPath();
  ctx.arc(105, 135, 25, 0, Math.PI * 2);
  ctx.fill();

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const res = reconstruct(target, {
    useSimplification: true,
    maxLayers: 5,
    minImprovement: 0.002,
    backgroundMode: 'reconstruct',
    seed: 42
  });

  const colors = res.layers.map(l => l.color);
  console.log(`  Layers accepted: ${res.layers.length}, Colors: ${colors.join(', ')}`);

  const hasBlue = colors.includes('#3f48bb');
  const hasRed = colors.includes('#e43032');
  assert(hasBlue, 'Expected blue base layer');
  assert(hasRed, 'Expected red detail/accent layer');
  console.log('  Passed: Multiple colors successfully layered to reconstruct compound color region!\n');
}

// ---------------------------------------------------------------------------
// Test C: Residual Splitting API Verification
// ---------------------------------------------------------------------------
console.log('Test C: Verifying Residual Decomposition and Sub-Region Extraction...');
{
  const sw = 105, sh = 155;
  const canvas = createCanvas(sw, sh);
  const ctx = canvas.getContext('2d');

  // Target: L-shape
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, sw, sh);
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(20, 80, 60, 30); // arm 1
  ctx.fillRect(20, 30, 30, 50); // arm 2
  const targetImg = { width: sw, height: sh, data: new Uint8ClampedArray(ctx.getImageData(0, 0, sw, sh).data.buffer) };

  // Current render: arm 1 has already been covered by a shape
  const renderCanvas = createCanvas(sw, sh);
  const rCtx = renderCanvas.getContext('2d');
  rCtx.fillStyle = '#ffffff';
  rCtx.fillRect(0, 0, sw, sh);
  rCtx.fillStyle = '#3f48bb';
  rCtx.fillRect(20, 80, 60, 30); // arm 1 covered
  const currentRender = { width: sw, height: sh, data: new Uint8ClampedArray(rCtx.getImageData(0, 0, sw, sh).data.buffer) };

  // Test splitRegionResidual on the region bounding box
  const testRegion = {
    id: 'region-l-shape',
    bounds: { x: 20 / sw, y: 30 / sh, width: 60 / sw, height: 80 / sh },
    paletteHex: '#3f48bb',
    saliencyScore: 0.8,
    isPreservedDetail: true
  };

  const subRegions = ResidualAnalyzer.splitRegionResidual(
    targetImg,
    currentRender,
    testRegion,
    1,
    null, // null pixelRegionMap tests pure bound residual check
    { residualThreshold: 0.06, minPixels: 6 }
  );

  console.log(`  Extracted sub-regions: ${subRegions.length}`);
  for (const sub of subRegions) {
    console.log(`    Sub-region ${sub.id}: pixels=${sub.pixelCount}, centroid=(${sub.centroid.x.toFixed(3)}, ${sub.centroid.y.toFixed(3)}), meanRes=${sub.meanResidual}`);
  }

  assert(subRegions.length >= 1, 'Expected at least 1 residual sub-region extracted for uncovered arm');
  const sub = subRegions[0];
  // Uncovered arm 2 is at x ~ 20..50 (norm ~ 0.19..0.48, cx ~ 0.33), y ~ 30..80 (norm ~ 0.19..0.52, cy ~ 0.35)
  assert(sub.centroid.y < 0.45, `Expected sub-region centroid to point to arm 2 (y < 0.45), got ${sub.centroid.y}`);
  assert.strictEqual(sub.dominantPaletteHex, '#3f48bb', 'Expected dominant palette to match residual target');
  console.log('  Passed: Residual splitting correctly extracted meaningful sub-region from remaining error!\n');
}

// ---------------------------------------------------------------------------
// Test D: Foreground-Aware Utility Preference
// ---------------------------------------------------------------------------
console.log('Test D: Verifying Foreground-Aware Candidate Utility...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // 99% white background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Tiny high-saliency red pupil/eye at center (area ~ 0.6%)
  ctx.fillStyle = '#e43032';
  ctx.fillRect(95, 145, 20, 20);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const res = reconstruct(target, {
    useSimplification: true,
    maxLayers: 3,
    minImprovement: 0.0005,
    minImprovementFloor: 0.0001,
    backgroundMode: 'reconstruct',
    seed: 42
  });

  console.log(`  Layers accepted: ${res.layers.length}`);
  for (const l of res.layers) {
    console.log(`    ${l.shapeAsset} color=${l.color} pos=(${l.x}, ${l.y}) scale=(${l.scaleX}, ${l.scaleY})`);
  }

  const eyeLayer = res.layers.find(l => l.color === '#e43032');
  assert(eyeLayer !== undefined, 'Expected foreground red eye detail to be reconstructed and accepted');
  console.log('  Passed: Foreground-aware metric successfully prioritized small salient detail!\n');
}

// ---------------------------------------------------------------------------
// Test E: Budget Behavior (Continue Accepting While Residual Remains)
// ---------------------------------------------------------------------------
console.log('Test E: Verifying Multi-Layer Budget Utilization...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // 4 distinct features
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(30, 40, 60, 60);
  ctx.fillStyle = '#e43032';
  ctx.beginPath();
  ctx.arc(160, 70, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#009432';
  ctx.fillRect(30, 200, 70, 70);
  ctx.fillStyle = '#ffc315';
  ctx.beginPath();
  ctx.arc(160, 230, 30, 0, Math.PI * 2);
  ctx.fill();

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const res = reconstruct(target, {
    useSimplification: true,
    maxLayers: 6,
    minImprovement: 0.001,
    backgroundMode: 'reconstruct',
    seed: 42
  });

  console.log(`  Budget requested: 6, Layers generated: ${res.layers.length}`);
  assert(res.layers.length >= 4, `Expected at least 4 layers accepted, got ${res.layers.length}`);
  console.log('  Passed: Useful layers continue being accepted up to budget!\n');
}

// ---------------------------------------------------------------------------
// Test F: Diminishing Returns (Graceful Termination)
// ---------------------------------------------------------------------------
console.log('Test F: Verifying Graceful Termination on Negligible Residual...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3f48bb';
  ctx.beginPath();
  ctx.arc(105, 155, 50, 0, Math.PI * 2);
  ctx.fill();

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  // Provide a large budget of 25 layers for a simple 2-shape composition
  const res = reconstruct(target, {
    useSimplification: true,
    maxLayers: 25,
    minImprovement: 0.003,
    backgroundMode: 'reconstruct',
    seed: 42
  });

  console.log(`  Max budget: 25, Actual layers used: ${res.layers.length}, Stop reason: ${res.diagnostics.stopReason}`);
  assert(res.layers.length <= 4, `Expected termination after 2-3 layers, got ${res.layers.length}`);
  console.log('  Passed: Reconstruction stopped gracefully when residual became negligible!\n');
}

// ---------------------------------------------------------------------------
// Test G: Determinism (Bit-For-Bit Repeatability)
// ---------------------------------------------------------------------------
console.log('Test G: Verifying Reconstruction Determinism...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(30, 80, 80, 120);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const res1 = reconstruct(target, {
    useSimplification: true,
    maxLayers: 4,
    minImprovement: 0.002,
    seed: 42
  });

  const res2 = reconstruct(target, {
    useSimplification: true,
    maxLayers: 4,
    minImprovement: 0.002,
    seed: 42
  });

  assert.strictEqual(res1.layers.length, res2.layers.length, 'Layer count mismatch');
  assert.strictEqual(res1.finalScore.totalLoss, res2.finalScore.totalLoss, 'Total loss mismatch');

  for (let i = 0; i < res1.layers.length; i++) {
    const l1 = res1.layers[i];
    const l2 = res2.layers[i];
    assert.strictEqual(l1.shapeAsset, l2.shapeAsset, `Shape mismatch at layer ${i}`);
    assert.strictEqual(l1.color, l2.color, `Color mismatch at layer ${i}`);
    assert.strictEqual(l1.x, l2.x, `X mismatch at layer ${i}`);
    assert.strictEqual(l1.y, l2.y, `Y mismatch at layer ${i}`);
  }

  console.log('  Passed: Exact bit-for-bit repeatability confirmed across repeated runs!\n');
}

console.log('=== ALL 7 PHASE 7 MULTI-SHAPE RECONSTRUCTION TESTS PASSED SUCCESSFULLY! ===\n');

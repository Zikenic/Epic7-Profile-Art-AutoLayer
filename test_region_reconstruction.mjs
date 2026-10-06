import assert from 'node:assert';
import { createCanvas } from '@napi-rs/canvas';
import {
  MultiLayerReconstructor,
  reconstruct,
  simplifyImage,
  renderLayersToRaster,
  derivePrimitiveCalibration,
  ImageScorer
} from './src/reconstruction/index.ts';

console.log('=== Running Phase 6: Region-Driven Reconstruction Test Suite ===\n');

// Helper to convert canvas to RasterImage
function canvasToRaster(canvas) {
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return {
    width: canvas.width,
    height: canvas.height,
    data: new Uint8ClampedArray(imgData.data.buffer)
  };
}

// ----------------------------------------------------------------------------
// Test A — Synthetic Region -> Correct Candidate Center/Scale Initialization
// ----------------------------------------------------------------------------
console.log('Test A: Verifying Region -> Candidate Initialization...');
{
  const calibTable = derivePrimitiveCalibration();

  const regionA = {
    id: 'region-test-a',
    paletteIndex: 0,
    paletteHex: '#e43032',
    representativeRgb: { r: 228, g: 48, b: 50 },
    clusterColorLab: [50, 60, 40],
    deltaEToPalette: 0,
    pixelCount: 2000,
    areaFraction: 0.03,
    centroid: { x: 0.42, y: 0.58 },
    pixelCentroid: { x: 88, y: 180 },
    bounds: { x: 0.30, y: 0.45, width: 0.24, height: 0.26 },
    pixelBounds: { minX: 63, minY: 140, maxX: 113, maxY: 220 },
    normalizedRadii: { major: 0.12, minor: 0.06 },
    orientationDeg: 35.0,
    isBackground: false,
    saliency: 0.7,
    neighborRegionIds: []
  };

  const candidates = MultiLayerReconstructor.generateCandidatesForImageRegion(
    regionA,
    105,
    155,
    ['Pill', 'Circle', 'Rounded_Square'],
    calibTable,
    1
  );

  assert(candidates.length > 0, 'Candidates should be generated for region');
  for (const c of candidates) {
    assert.strictEqual(c.color, '#e43032', 'Candidate should adopt region palette color');
    // Centroid should be in vicinity of (0.42, 0.58)
    assert(Math.abs(c.x - 0.42) < 0.08, `Candidate x (${c.x}) near region centroid 0.42`);
    assert(Math.abs(c.y - 0.58) < 0.08, `Candidate y (${c.y}) near region centroid 0.58`);
  }

  // Pill candidates should have anisotropic scales matching major/minor ratio (~2.0)
  const pillCands = candidates.filter(c => c.shapeAsset === 'Pill');
  assert(pillCands.length > 0, 'Pill candidates should be proposed');
  const hasAnisotropic = pillCands.some(c => Math.abs(c.scaleX - c.scaleY) > 0.05);
  assert(hasAnisotropic, 'Pill candidates should include elongated scales');

  console.log(`  Generated ${candidates.length} candidates from region A.`);
  console.log(`  Sample candidate: ${pillCands[0].shapeAsset} pos=(${pillCands[0].x}, ${pillCands[0].y}) scale=(${pillCands[0].scaleX}, ${pillCands[0].scaleY}) rot=${pillCands[0].rotation}°`);
  console.log('  Passed: Region correctly initializes candidate center, scale, orientation, and color!\n');
}

// ----------------------------------------------------------------------------
// Test B — Candidate Ranking Prefers Aspect-Compatible Primitive
// ----------------------------------------------------------------------------
console.log('Test B: Verifying Candidate Preference for Aspect-Compatible Primitives...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Background white
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Elongated horizontal pill/stripe in blue (#3f48bb), aspect ratio ~3.5:1
  ctx.fillStyle = '#3f48bb';
  ctx.beginPath();
  ctx.roundRect(40, 140, 130, 36, 18);
  ctx.fill();

  const target = canvasToRaster(canvas);
  const simp = simplifyImage(target, { level: 'MEDIUM' });

  const res = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 3,
    backgroundMode: 'ignore'
  });

  assert(res.layers.length >= 1, 'Should reconstruct at least 1 layer');
  const topLayer = res.layers[0];
  console.log(`  Top layer recovered: ${topLayer.shapeAsset} scale=(${topLayer.scaleX}, ${topLayer.scaleY}) rot=${topLayer.rotation}°`);
  
  // An elongated shape (Pill or Rounded_Square) should be preferred over isotropic Circle
  assert(
    topLayer.shapeAsset === 'Pill' || topLayer.shapeAsset === 'Rounded_Square',
    `Expected elongated primitive (Pill or Rounded_Square), got ${topLayer.shapeAsset}`
  );
  console.log('  Passed: Candidate selection correctly preferred aspect-compatible primitive!\n');
}

// ----------------------------------------------------------------------------
// Test C — Regional Improvement Identifies Useful Candidate With Small Global Gain
// ----------------------------------------------------------------------------
console.log('Test C: Verifying Regional Improvement for Small Subtle Details...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Dominant white background (99.7% of area)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Small high-contrast red heart/dot (area ~0.3%)
  ctx.fillStyle = '#e43032';
  ctx.beginPath();
  ctx.arc(105, 155, 7, 0, Math.PI * 2);
  ctx.fill();

  const target = canvasToRaster(canvas);
  const simp = simplifyImage(target, { level: 'FINE' });

  // Reconstruct with regional weighting enabled
  const res = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 3,
    backgroundMode: 'ignore',
    regionalWeight: 0.50,
    minImprovementFloor: 0.0005
  });

  assert(res.layers.length >= 1, 'Small detail must be accepted via regional improvement');
  const accepted = res.layers[0];
  console.log(`  Accepted detail layer: ${accepted.shapeAsset} color=${accepted.color} at (${accepted.x}, ${accepted.y})`);
  assert.strictEqual(accepted.color, '#e43032', 'Accepted layer must be the red detail');
  assert(Math.abs(accepted.x - 0.50) < 0.05, 'Accepted layer centered at x=0.5');
  assert(Math.abs(accepted.y - 0.50) < 0.05, 'Accepted layer centered at y=0.5');
  console.log('  Passed: Regional improvement successfully recovered subtle foreground detail!\n');
}

// ----------------------------------------------------------------------------
// Test D — Background Mode Policy (reconstruct vs ignore)
// ----------------------------------------------------------------------------
console.log('Test D: Verifying Background Mode Policy...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // White background, green central circle
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#009432';
  ctx.beginPath();
  ctx.arc(105, 155, 45, 0, Math.PI * 2);
  ctx.fill();

  const target = canvasToRaster(canvas);
  const simp = simplifyImage(target, { level: 'MEDIUM' });

  // Mode 1: backgroundMode = 'reconstruct' -> background layer placed first, then foreground
  const resRecon = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    backgroundMode: 'reconstruct'
  });
  console.log(`  'reconstruct' mode layers: ${resRecon.layers.length}`);
  const hasBgLayer = resRecon.layers.some(l => l.color === '#ffffff');
  const hasFgLayer = resRecon.layers.some(l => l.color === '#009432');
  assert(hasBgLayer, 'Reconstruct mode should include background layer');
  assert(hasFgLayer, 'Reconstruct mode should include foreground layer');

  // Mode 2: backgroundMode = 'ignore' -> background excluded, foreground placed immediately
  const resIgnore = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    backgroundMode: 'ignore'
  });
  console.log(`  'ignore' mode layers: ${resIgnore.layers.length}`);
  const firstLayerIgnore = resIgnore.layers[0];
  assert.strictEqual(firstLayerIgnore.color, '#009432', 'Ignore mode places foreground directly without background layer');

  console.log('  Passed: Background modes (reconstruct & ignore) behave correctly without suppressing foreground!\n');
}

// ----------------------------------------------------------------------------
// Test E — Disconnected Same-Color Regions Produce Separate Proposals
// ----------------------------------------------------------------------------
console.log('Test E: Verifying Disconnected Same-Color Regions...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Two distant circles of the exact same color (#e43032)
  ctx.fillStyle = '#e43032';
  ctx.beginPath();
  ctx.arc(60, 90, 25, 0, Math.PI * 2); // Top-left
  ctx.fill();

  ctx.beginPath();
  ctx.arc(150, 220, 25, 0, Math.PI * 2); // Bottom-right
  ctx.fill();

  const target = canvasToRaster(canvas);
  const simp = simplifyImage(target, { level: 'FINE' });

  const sameColorRegions = simp.regions.filter(r => r.paletteHex === '#e43032');
  assert.strictEqual(sameColorRegions.length, 2, 'Should segment into 2 distinct same-color regions');

  const res = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    backgroundMode: 'ignore'
  });

  const redLayers = res.layers.filter(l => l.color === '#e43032');
  assert(redLayers.length >= 2, `Expected at least 2 red layers, got ${redLayers.length}`);

  // Confirm positions correspond to the two spots
  const topLeft = redLayers.find(l => l.x < 0.45 && l.y < 0.45);
  const bottomRight = redLayers.find(l => l.x > 0.55 && l.y > 0.55);
  assert(topLeft !== undefined, 'Top-left red layer found');
  assert(bottomRight !== undefined, 'Bottom-right red layer found');

  console.log(`  Recovered spot 1 at (${topLeft.x}, ${topLeft.y}), spot 2 at (${bottomRight.x}, ${bottomRight.y})`);
  console.log('  Passed: Disconnected same-color regions reconstructed independently!\n');
}

// ----------------------------------------------------------------------------
// Test F — Same Region Generates Multiple Layers When Residual Remains
// ----------------------------------------------------------------------------
console.log('Test F: Verifying Multiple Layers For Complex Non-Convex Region...');
{
  const targetLayers = [
    { id: '1', name: 'BG', shapeAsset: 'Rounded_Square', x: 0.5, y: 0.5, scaleX: 2.0, scaleY: 2.8, rotation: 0, color: '#ffffff', opacity: 1, visible: true, locked: false },
    { id: '2', name: 'H', shapeAsset: 'Pill', x: 0.45, y: 0.65, scaleX: 0.90, scaleY: 0.35, rotation: 0, color: '#3f48bb', opacity: 1, visible: true, locked: false },
    { id: '3', name: 'V', shapeAsset: 'Pill', x: 0.30, y: 0.45, scaleX: 0.35, scaleY: 0.90, rotation: 0, color: '#3f48bb', opacity: 1, visible: true, locked: false }
  ];

  const target = renderLayersToRaster(targetLayers, 210, 310, { backgroundColor: '#ffffff' });
  const simp = simplifyImage(target, { level: 'COARSE' });

  const res = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 5,
    backgroundMode: 'reconstruct',
    minImprovement: 0.003
  });

  const blueLayers = res.layers.filter(l => l.color === '#3f48bb');
  console.log(`  Layers placed for composite blue structure: ${blueLayers.length}`);
  for (let i = 0; i < blueLayers.length; i++) {
    console.log(`    Layer #${i + 1}: ${blueLayers[i].shapeAsset} pos=(${blueLayers[i].x}, ${blueLayers[i].y}) scale=(${blueLayers[i].scaleX}, ${blueLayers[i].scaleY})`);
  }

  assert(blueLayers.length >= 2, 'Composite non-convex structure should require >= 2 layers to reconstruct');
  console.log('  Passed: Multiple layers iteratively allocated to explain non-convex region residual!\n');
}

// ----------------------------------------------------------------------------
// Test G — Deterministic Repeated Reconstruction
// ----------------------------------------------------------------------------
console.log('Test G: Verifying Reconstruction Determinism...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#fe9dbe';
  ctx.beginPath();
  ctx.arc(105, 120, 40, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#11d4bd';
  ctx.fillRect(60, 180, 90, 50);

  const target = canvasToRaster(canvas);

  const res1 = reconstruct(target, {
    useSimplification: true,
    seed: 12345,
    maxLayers: 4,
    backgroundMode: 'ignore'
  });

  const res2 = reconstruct(target, {
    useSimplification: true,
    seed: 12345,
    maxLayers: 4,
    backgroundMode: 'ignore'
  });

  const json1 = JSON.stringify(res1.layers);
  const json2 = JSON.stringify(res2.layers);

  assert.strictEqual(json1, json2, 'Repeated reconstruction runs with identical seed must produce identical layers');
  assert.strictEqual(res1.finalScore.totalLoss, res2.finalScore.totalLoss, 'Final scores must be identical');

  console.log(`  Run 1 Loss: ${res1.finalScore.totalLoss.toFixed(4)} (${res1.layers.length} layers)`);
  console.log(`  Run 2 Loss: ${res2.finalScore.totalLoss.toFixed(4)} (${res2.layers.length} layers)`);
  console.log('  Passed: Exact bit-for-bit determinism verified!\n');
}

console.log('=== ALL 7 PHASE 6 REGION RECONSTRUCTION TESTS PASSED SUCCESSFULLY! ===');

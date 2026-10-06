import assert from 'node:assert';
import { createCanvas } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  simplifyImage,
  extractRegions,
  EPIC7_PALETTE_HEX,
  reconstruct,
  renderLayersToRaster,
  ImageScorer
} from './src/reconstruction/index.ts';

console.log('=== Running Phase 5: Adaptive Image Simplifier Test Suite ===\n');

// Helper to create a raster image from canvas
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
// Test A — Flat Regions (Several Large Solid Colors)
// ----------------------------------------------------------------------------
console.log('Test A: Verifying Flat Regions Simplification...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Draw 3 distinct solid blocks matching palette colors
  ctx.fillStyle = '#e43032'; // Red
  ctx.fillRect(0, 0, w, 100);
  ctx.fillStyle = '#3f48bb'; // Blue
  ctx.fillRect(0, 100, w, 100);
  ctx.fillStyle = '#fff355'; // Yellow
  ctx.fillRect(0, 200, w, 110);

  const target = canvasToRaster(canvas);
  const res = simplifyImage(target, { level: 'MEDIUM' });

  console.log(`  Raw regions:        ${res.diagnostics.rawRegionCount}`);
  console.log(`  Simplified regions: ${res.diagnostics.simplifiedRegionCount}`);
  console.log(`  Palette colors:     ${res.diagnostics.paletteColorCount}`);
  console.log(`  Quantization error: ${res.diagnostics.quantizationErrorLab.toFixed(3)}`);

  assert(res.diagnostics.simplifiedRegionCount <= 5, `Expected <= 5 regions, got ${res.diagnostics.simplifiedRegionCount}`);
  assert.strictEqual(res.diagnostics.paletteColorCount, 3, `Expected 3 palette colors, got ${res.diagnostics.paletteColorCount}`);
  assert(res.diagnostics.quantizationErrorLab < 2.0, `Expected low quantization error, got ${res.diagnostics.quantizationErrorLab}`);
  console.log('  Passed: Flat regions cleanly preserved with minimal regions!\n');
}

// ----------------------------------------------------------------------------
// Test B — Gradient Handling (Smooth Synthetic Gradient)
// ----------------------------------------------------------------------------
console.log('Test B: Verifying Continuous Gradient Simplification...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Create smooth vertical gradient from white to dark blue
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.5, '#4cfdff');
  grad.addColorStop(1, '#0e1634');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const target = canvasToRaster(canvas);
  const res = simplifyImage(target, { level: 'MEDIUM' });

  console.log(`  Raw regions:        ${res.diagnostics.rawRegionCount}`);
  console.log(`  Simplified regions: ${res.diagnostics.simplifiedRegionCount}`);
  console.log(`  Representative K:   ${res.diagnostics.representativeColorCount}`);
  console.log(`  Median region size: ${res.diagnostics.medianRegionSize} px`);

  // Under the old system, this gradient exploded into thousands of 1-px regions
  assert(res.diagnostics.simplifiedRegionCount < 30, `Expected < 30 coherent tonal regions, got ${res.diagnostics.simplifiedRegionCount}`);
  assert(res.diagnostics.medianRegionSize > 100, `Expected median region size > 100 px, got ${res.diagnostics.medianRegionSize}`);
  console.log('  Passed: Gradient successfully converted into finite coherent tonal bands without fragmentation!\n');
}

// ----------------------------------------------------------------------------
// Test C — Antialiased Boundary Preservation
// ----------------------------------------------------------------------------
console.log('Test C: Verifying Antialiased Edge Boundary Coherence...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Smooth antialiased circle in center
  ctx.fillStyle = '#e43032';
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 60, 0, Math.PI * 2);
  ctx.fill();

  const target = canvasToRaster(canvas);
  const res = simplifyImage(target, { level: 'MEDIUM' });

  console.log(`  Raw regions:        ${res.diagnostics.rawRegionCount}`);
  console.log(`  Simplified regions: ${res.diagnostics.simplifiedRegionCount}`);
  console.log(`  Regions < minSize:  ${res.diagnostics.regionsBelowMinSize}`);

  // In raw segmentation, antialiasing created hundreds of boundary fringe regions
  assert(res.diagnostics.simplifiedRegionCount <= 3, `Expected <= 3 regions (background + circle), got ${res.diagnostics.simplifiedRegionCount}`);
  console.log('  Passed: Antialiasing edge fringe suppressed without boundary distortion!\n');
}

// ----------------------------------------------------------------------------
// Test D — Small High-Contrast Detail Preservation (Saliency Heuristic)
// ----------------------------------------------------------------------------
console.log('Test D: Verifying Preservation of Small High-Contrast Details...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Pale background (skin-like #fae6e1)
  ctx.fillStyle = '#fae6e1';
  ctx.fillRect(0, 0, w, h);

  // Tiny dark high-contrast pupil/eye (only 8x8 pixels = 64 px < minRegionAreaFraction ~227 px)
  ctx.fillStyle = '#0e1634'; // Dark blue pupil
  ctx.fillRect(100, 150, 8, 8);

  const target = canvasToRaster(canvas);
  const res = simplifyImage(target, {
    level: 'MEDIUM',
    preserveSalientFeatures: true,
    saliencyThreshold: 0.25
  });

  console.log(`  Total simplified regions: ${res.regions.length}`);
  console.log(`  Preserved detail count:   ${res.diagnostics.preservedDetailCount}`);

  // Find the pupil region
  const pupilRegion = res.regions.find(r => r.pixelCount <= 100 && r.isPreservedDetail);
  assert(pupilRegion !== undefined, 'Small high-contrast feature was incorrectly wiped out by island merging');
  console.log(`  Found preserved detail region: ID=${pupilRegion.id}, pixels=${pupilRegion.pixelCount}, saliency=${pupilRegion.saliencyScore.toFixed(3)}`);
  console.log('  Passed: High-contrast small detail successfully protected from island merging!\n');
}

// ----------------------------------------------------------------------------
// Test E — Noise Suppression (Random Pixel Jitter)
// ----------------------------------------------------------------------------
console.log('Test E: Verifying Noise Suppression & Structure Preservation...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // Two solid vertical columns: Green and Blue
  ctx.fillStyle = '#009432';
  ctx.fillRect(0, 0, w / 2, h);
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(w / 2, 0, w / 2, h);

  const cleanTarget = canvasToRaster(canvas);

  // Add severe random pixel salt-and-pepper noise
  const noisyTarget = {
    width: w,
    height: h,
    data: new Uint8ClampedArray(cleanTarget.data)
  };
  for (let i = 0; i < noisyTarget.data.length; i += 4) {
    if ((i * 37) % 19 === 0) {
      noisyTarget.data[i] = Math.min(255, noisyTarget.data[i] + 70);
      noisyTarget.data[i + 1] = Math.max(0, noisyTarget.data[i + 1] - 50);
      noisyTarget.data[i + 2] = Math.min(255, noisyTarget.data[i + 2] + 40);
    }
  }

  const res = simplifyImage(noisyTarget, { level: 'MEDIUM' });

  console.log(`  Raw regions with noise: ${res.diagnostics.rawRegionCount}`);
  console.log(`  Simplified regions:     ${res.diagnostics.simplifiedRegionCount}`);

  assert(res.diagnostics.simplifiedRegionCount <= 4, `Expected <= 4 regions after noise suppression, got ${res.diagnostics.simplifiedRegionCount}`);
  console.log('  Passed: Random pixel noise suppressed; major macro-structures retained!\n');
}

// ----------------------------------------------------------------------------
// Test F — Same-Color Disconnected Regions Isolation
// ----------------------------------------------------------------------------
console.log('Test F: Verifying Disconnected Same-Color Regions...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Two distinct separated red circles
  ctx.fillStyle = '#e43032';
  ctx.beginPath();
  ctx.arc(60, 150, 35, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.arc(150, 150, 35, 0, Math.PI * 2);
  ctx.fill();

  const target = canvasToRaster(canvas);
  const res = simplifyImage(target, { level: 'MEDIUM' });

  // Filter non-background regions
  const foregroundRegions = res.regions.filter(r => !r.isBackground);
  console.log(`  Total regions:      ${res.regions.length}`);
  console.log(`  Foreground regions: ${foregroundRegions.length}`);

  assert.strictEqual(foregroundRegions.length, 2, `Expected exactly 2 disconnected foreground regions, got ${foregroundRegions.length}`);
  assert.strictEqual(foregroundRegions[0].paletteHex, '#e43032');
  assert.strictEqual(foregroundRegions[1].paletteHex, '#e43032');
  console.log('  Passed: Disconnected same-color structures correctly isolated into independent spatial regions!\n');
}

// ----------------------------------------------------------------------------
// Test G — Determinism (Bit-for-Bit Repeatability)
// ----------------------------------------------------------------------------
console.log('Test G: Verifying Simplifier Repeatability & Determinism...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, '#fe9dbe');
  grad.addColorStop(1, '#11d4bd');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  const target = canvasToRaster(canvas);

  const run1 = simplifyImage(target, { seed: 1234 });
  const run2 = simplifyImage(target, { seed: 1234 });

  assert.strictEqual(run1.regions.length, run2.regions.length, 'Region count differed across identical runs');
  assert.strictEqual(run1.diagnostics.quantizationErrorLab, run2.diagnostics.quantizationErrorLab, 'Quantization error differed');
  assert.deepStrictEqual(run1.simplified.data, run2.simplified.data, 'Simplified pixel buffer differed across identical runs');
  console.log('  Passed: Exact bit-for-bit repeatability confirmed!\n');
}

// ----------------------------------------------------------------------------
// Test H — Adaptive minImprovement Semantics in Reconstruction
// ----------------------------------------------------------------------------
console.log('Test H: Verifying Adaptive minImprovement Acceptance...');
{
  // Construct a base composition: large background square + small subtle foreground circle
  const baseLayers = [
    {
      id: 'bg-sq',
      name: 'Background Square',
      shapeAsset: 'Rounded_Square',
      x: 0.5,
      y: 0.5,
      scaleX: 2.0,
      scaleY: 2.8,
      rotation: 0,
      color: '#ffffff',
      opacity: 1.0,
      visible: true,
      locked: false,
      zIndex: 0
    },
    {
      id: 'subtle-circle',
      name: 'Subtle Circle',
      shapeAsset: 'Circle',
      x: 0.5,
      y: 0.5,
      scaleX: 0.35,
      scaleY: 0.35,
      rotation: 0,
      color: '#fe9dbe', // Pale pink
      opacity: 1.0,
      visible: true,
      locked: false,
      zIndex: 1
    }
  ];

  const target = renderLayersToRaster(baseLayers, 210, 310, {
    backgroundColor: 'transparent',
    renderMode: 'mathematical'
  });

  // Reconstruct with adaptive relative threshold enabled
  const resAdaptive = reconstruct(target, {
    maxLayers: 3,
    minImprovement: 0.003,
    minImprovementFloor: 0.0005,
    relativeImprovementFraction: 0.15
  });

  console.log(`  Initial Loss: ${resAdaptive.diagnostics.initialScore.totalLoss.toFixed(4)}`);
  console.log(`  Final Loss:   ${resAdaptive.finalScore.totalLoss.toFixed(4)}`);
  console.log(`  Layers accepted: ${resAdaptive.layers.length}`);
  for (const h of resAdaptive.diagnostics.history) {
    console.log(`    Layer #${h.iteration} ${h.shapeAsset} (${h.color}) -> verified imp: ${h.verifiedImprovement.toFixed(4)}`);
  }

  // Both the background square and subtle foreground circle should be recovered!
  assert(resAdaptive.layers.length >= 2, `Expected at least 2 layers accepted with adaptive threshold, got ${resAdaptive.layers.length}`);
  assert(resAdaptive.finalScore.totalLoss < 0.020, `Final loss too high: ${resAdaptive.finalScore.totalLoss}`);
  console.log('  Passed: Adaptive minImprovement enabled subtle foreground detail recovery without premature stopping!\n');
}

console.log('=== ALL PHASE 5 SIMPLIFIER TESTS PASSED SUCCESSFULLY! ===');

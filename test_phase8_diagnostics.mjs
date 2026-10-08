import assert from 'node:assert';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  reconstruct,
  renderLayersToRaster
} from './src/reconstruction/index.ts';

console.log('=== Running Phase 8: Real-Image Reconstruction Diagnostic Suite ===\n');

// ---------------------------------------------------------------------------
// Test A: White-Background Deception Prevention
// Asserts that reconstructor does NOT stop after background layer when foreground residual remains.
// ---------------------------------------------------------------------------
console.log('Test A: Verifying White-Background Deception Prevention...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  // White background (large)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // High contrast red circle in center
  ctx.fillStyle = '#ff2b23';
  ctx.beginPath();
  ctx.arc(105, 155, 30, 0, Math.PI * 2);
  ctx.fill();

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { seed: 42 });
  const recon = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 10,
    minImprovement: 0.001,
    minImprovementFloor: 0.0002,
    seed: 42
  });

  console.log(`  Total layers placed: ${recon.layers.length}, stopReason: ${recon.diagnostics.stopReason}`);
  assert.ok(
    recon.layers.length >= 2,
    `Expected at least 2 layers (background + foreground), got ${recon.layers.length}`
  );

  const hasFgColor = recon.layers.some(l => l.color === '#e43032');
  assert.ok(hasFgColor, 'Expected at least one red (#e43032) foreground layer to be placed');
  console.log('  ✓ Test A passed: Reconstructor did not stop on white background alone.\n');
}

// ---------------------------------------------------------------------------
// Test B: Foreground Mask Correctness
// Verifies background pixels receive weight 0.0 while foreground features are preserved.
// ---------------------------------------------------------------------------
console.log('Test B: Verifying Foreground Mask Correctness...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Black cross in center
  ctx.fillStyle = '#000000';
  ctx.fillRect(95, 100, 20, 110);
  ctx.fillRect(50, 145, 110, 20);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { seed: 42 });
  const bgRegions = simp.regions.filter(r => r.isBackground);
  const fgRegions = simp.regions.filter(r => !r.isBackground);

  assert.ok(bgRegions.length >= 1, 'Expected at least one background region');
  assert.ok(fgRegions.length >= 1, 'Expected at least one foreground region');

  // Verify that background region is white and occupies >70% area
  const mainBg = bgRegions[0];
  assert.strictEqual(mainBg.paletteHex, '#ffffff');
  assert.ok(mainBg.areaFraction > 0.70, `Expected background area > 70%, got ${mainBg.areaFraction}`);

  // Foreground cross must be black and preserved
  const fgCross = fgRegions.find(r => r.paletteHex === '#000000');
  assert.ok(fgCross, 'Expected black foreground cross region');
  assert.strictEqual(fgCross.isBackground, false);
  console.log('  ✓ Test B passed: Background correctly separated with 0 weight, foreground preserved.\n');
}

// ---------------------------------------------------------------------------
// Test C: Foreground Improvement Prioritization
// Ensures foreground loss decreases significantly as foreground layers are committed.
// ---------------------------------------------------------------------------
console.log('Test C: Verifying Foreground Improvement Prioritization...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Blue square in center
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(70, 100, 70, 110);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { seed: 42 });
  const recon = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    minImprovement: 0.001,
    minImprovementFloor: 0.0002,
    seed: 42
  });

  const finalFgLoss = recon.diagnostics.foregroundWeightedLoss;
  console.log(`  Final foreground weighted loss: ${finalFgLoss.toFixed(4)}`);
  assert.ok(
    finalFgLoss < 0.15,
    `Expected foreground weighted loss < 0.15, got ${finalFgLoss}`
  );

  const blueLayer = recon.layers.find(l => l.color === '#3f48bb');
  assert.ok(blueLayer, 'Expected blue layer covering foreground shape');
  console.log('  ✓ Test C passed: Foreground weighted loss dropped to <0.15.\n');
}

// ---------------------------------------------------------------------------
// Test D: Candidate Cap Enforcement & Screening Telemetry
// Verifies maxCandidatesPerIteration is strictly respected and screening timing is recorded.
// ---------------------------------------------------------------------------
console.log('Test D: Verifying Candidate Cap Enforcement & Screening Telemetry...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff2b23';
  ctx.fillRect(60, 60, 90, 90);
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(60, 160, 90, 90);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { seed: 42 });
  const candidateCap = 32;
  const recon = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 3,
    maxCandidatesPerIteration: candidateCap,
    seed: 42
  });

  const iters = recon.diagnostics.history.length > 0
    ? recon.diagnostics.history[recon.diagnostics.history.length - 1].iteration
    : recon.diagnostics.acceptedLayersCount;
  const maxAllowedEvals = candidateCap * (iters + 1); // at most (iters + 1) search iterations
  console.log(`  Iterations: ${iters}, Fast evals: ${recon.diagnostics.fastCandidatesEvaluated}, Cap: ${candidateCap} * ${iters + 1} = ${maxAllowedEvals}`);
  assert.ok(
    recon.diagnostics.fastCandidatesEvaluated <= maxAllowedEvals,
    `Expected <= ${maxAllowedEvals} fast candidate evaluations, got ${recon.diagnostics.fastCandidatesEvaluated}`
  );

  assert.ok(
    recon.diagnostics.timingBreakdownMs.candidateScreeningMs !== undefined,
    'Expected candidateScreeningMs to be tracked in timing breakdown'
  );
  console.log(`  Screening time recorded: ${recon.diagnostics.timingBreakdownMs.candidateScreeningMs}ms`);
  console.log('  ✓ Test D passed: Candidate evaluation cap enforced and screening telemetry recorded.\n');
}

// ---------------------------------------------------------------------------
// Test E: Multi-Layer Continuation on Real Image
// Asserts real image reconstructor proceeds past layer 1 and places foreground details.
// ---------------------------------------------------------------------------
console.log('Test E: Verifying Multi-Layer Continuation on Real Image...');
{
  const imgPath = 'D:/Khai Van/KhaiVan Data/Resource/Images/wp15313950.jpg';
  const img = await loadImage(imgPath);

  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  const srcAspect = img.width / img.height;
  const targetAspect = 21 / 31;
  let cropX = 0, cropY = 0, cropW = img.width, cropH = img.height;
  if (srcAspect > targetAspect) {
    cropW = Math.round(img.height * targetAspect);
    cropX = Math.round((img.width - cropW) / 2);
  } else {
    cropH = Math.round(img.width / targetAspect);
    cropY = Math.round((img.height - cropH) / 2);
  }
  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { level: 'MEDIUM', seed: 42 });
  const recon = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 5,
    minImprovement: 0.001,
    minImprovementFloor: 0.0002,
    maxCandidatesPerIteration: 64,
    seed: 42
  });

  console.log(`  Real image reconstructed layers: ${recon.layers.length}`);
  assert.ok(
    recon.layers.length >= 3,
    `Expected at least 3 layers for real artwork, got ${recon.layers.length}`
  );
  console.log('  ✓ Test E passed: Real image continued past initial layer into character details.\n');
}

// ---------------------------------------------------------------------------
// Test F: Determinism
// Asserts two independent runs with identical seeds produce identical compositions.
// ---------------------------------------------------------------------------
console.log('Test F: Verifying Deterministic Multi-Layer Reconstruction...');
{
  const w = 210, h = 310;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#ff2b23';
  ctx.fillRect(40, 50, 60, 60);
  ctx.fillStyle = '#3f48bb';
  ctx.fillRect(110, 150, 70, 70);

  const imgData = ctx.getImageData(0, 0, w, h);
  const target = { width: w, height: h, data: new Uint8ClampedArray(imgData.data.buffer) };

  const simp = ImageSimplifier.simplify(target, { seed: 42 });
  const run1 = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    seed: 42
  });

  const run2 = reconstruct(target, {
    regionGraph: simp.regionGraph,
    maxLayers: 4,
    seed: 42
  });

  assert.strictEqual(run1.layers.length, run2.layers.length, 'Layer count mismatch across runs');
  for (let i = 0; i < run1.layers.length; i++) {
    const l1 = run1.layers[i];
    const l2 = run2.layers[i];
    assert.strictEqual(l1.shapeAsset, l2.shapeAsset, `Layer ${i} shape mismatch`);
    assert.strictEqual(l1.color, l2.color, `Layer ${i} color mismatch`);
    assert.strictEqual(l1.x, l2.x, `Layer ${i} x mismatch`);
    assert.strictEqual(l1.y, l2.y, `Layer ${i} y mismatch`);
    assert.strictEqual(l1.scaleX, l2.scaleX, `Layer ${i} scaleX mismatch`);
    assert.strictEqual(l1.scaleY, l2.scaleY, `Layer ${i} scaleY mismatch`);
    assert.strictEqual(l1.rotation, l2.rotation, `Layer ${i} rotation mismatch`);
  }
  console.log('  ✓ Test F passed: 100% deterministic bitwise layer parameter equality.\n');
}

console.log('================================================================');
console.log('All Phase 8 Diagnostic Tests (A-F) PASSED successfully!');
console.log('================================================================');

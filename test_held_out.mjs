import assert from 'node:assert';
import {
  generateSyntheticTarget,
  SingleLayerOptimizer,
  areParametersSymmetricallyEquivalent,
  DEFAULT_TOLERANCES,
  EPIC7_PALETTE_HEX,
  ImageScorer,
  renderSingleLayerToRaster,
  getMinimalAngleDifference
} from './src/reconstruction/index.ts';

console.log('=== Running Randomized Held-Out Suite (120 Test Cases Across 12 Primitives) ===\n');

const PRIMITIVES = [
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

// Linear Congruential Generator for reproducible pseudo-random numbers
class LCG {
  constructor(seed = 123456789) {
    this.state = seed;
  }
  next() {
    this.state = (this.state * 1664525 + 1013904223) % 4294967296;
    return this.state / 4294967296;
  }
  range(min, max) {
    return min + (max - min) * this.next();
  }
  choice(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

const rng = new LCG(20261006);

const results = [];
const casesPerPrimitive = 10;
const totalCases = PRIMITIVES.length * casesPerPrimitive;

const startTimeTotal = Date.now();

for (const shape of PRIMITIVES) {
  process.stdout.write(`Testing ${shape.padEnd(16)} (10 random cases)... `);
  const shapeStartTime = Date.now();
  let shapeCorrectCount = 0;

  for (let i = 0; i < casesPerPrimitive; i++) {
    const x = Math.round(rng.range(0.35, 0.65) * 1000) / 1000;
    const y = Math.round(rng.range(0.35, 0.65) * 1000) / 1000;
    const scaleX = Math.round(rng.range(0.70, 1.40) * 1000) / 1000;
    const scaleY = Math.round(rng.range(0.70, 1.40) * 1000) / 1000;
    const rotation = Math.round(rng.range(-170, 170));
    const color = rng.choice(EPIC7_PALETTE_HEX);
    const opacity = Math.round(rng.range(0.60, 1.00) * 100) / 100;

    const gtLayer = {
      id: `gt-${shape}-${i}`,
      name: `GT (${shape})`,
      shapeAsset: shape,
      x,
      y,
      scaleX,
      scaleY,
      rotation,
      color,
      opacity,
      visible: true,
      locked: false
    };

    const target = generateSyntheticTarget(gtLayer, { width: 210, height: 310 });
    const oracleRender = renderSingleLayerToRaster(gtLayer, 210, 310);
    const oracleLoss = ImageScorer.score(target, oracleRender).totalLoss;

    const optResult = SingleLayerOptimizer.optimize(target, {
      searchResolution: { width: 105, height: 155 },
      verificationResolution: { width: 210, height: 310 },
      timeoutMs: 8000
    });

    const rec = optResult.recoveredLayer;
    const shapeCorrect = rec.shapeAsset === shape;
    if (shapeCorrect) shapeCorrectCount++;

    const colorCorrect = rec.color === color;
    const dx = Math.abs(rec.x - gtLayer.x);
    const dy = Math.abs(rec.y - gtLayer.y);
    const dScaleX = Math.abs(rec.scaleX - gtLayer.scaleX) / gtLayer.scaleX;
    const dScaleY = Math.abs(rec.scaleY - gtLayer.scaleY) / gtLayer.scaleY;
    const dRot = getMinimalAngleDifference(shape, rec.rotation, gtLayer.rotation);
    const dOpacity = Math.abs(rec.opacity - gtLayer.opacity);

    const eq = areParametersSymmetricallyEquivalent(gtLayer, rec, {
      xyTolerance: 0.02,
      scaleTolerancePct: 0.10,
      rotationToleranceDeg: 5.0,
      opacityTolerance: 0.05
    });

    results.push({
      primitive: shape,
      caseIndex: i,
      recoveredShape: rec.shapeAsset,
      shapeCorrect,
      colorCorrect,
      dx,
      dy,
      dScaleX,
      dScaleY,
      dRot,
      dOpacity,
      oracleLoss,
      recoveredLoss: optResult.verificationLoss.totalLoss,
      elapsedMs: optResult.elapsedMs,
      equivalent: eq.equivalent,
      equivReason: eq.reason
    });
  }

  const shapeElapsed = Date.now() - shapeStartTime;
  console.log(`done (${shapeCorrectCount}/10 correct, ${shapeElapsed}ms, ~${Math.round(shapeElapsed / 10)}ms/case)`);
}

const totalTime = Date.now() - startTimeTotal;
console.log(`\nCompleted all ${totalCases} test cases in ${(totalTime / 1000).toFixed(2)}s\n`);

// Aggregate statistics
const totalShapeCorrect = results.filter(r => r.shapeCorrect).length;
const totalColorCorrect = results.filter(r => r.colorCorrect).length;
const totalEquivalent = results.filter(r => r.equivalent).length;

function percentile(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const shapeCorrectResults = results.filter(r => r.shapeCorrect);
const dxs = shapeCorrectResults.map(r => r.dx);
const dys = shapeCorrectResults.map(r => r.dy);
const dScales = shapeCorrectResults.map(r => Math.max(r.dScaleX, r.dScaleY));
const dRots = shapeCorrectResults.map(r => r.dRot);
const dOps = shapeCorrectResults.map(r => r.dOpacity);
const verifLosses = shapeCorrectResults.map(r => r.recoveredLoss);
const times = results.map(r => r.elapsedMs);

console.log('=== SUMMARY BENCHMARK METRICS ===');
console.log(`Shape Accuracy:       ${totalShapeCorrect} / ${totalCases} (${((totalShapeCorrect / totalCases) * 100).toFixed(1)}%)`);
console.log(`Color Accuracy:       ${totalColorCorrect} / ${totalCases} (${((totalColorCorrect / totalCases) * 100).toFixed(1)}%)`);
console.log(`Symmetric Equivalence:${totalEquivalent} / ${totalCases} (${((totalEquivalent / totalCases) * 100).toFixed(1)}%)`);
console.log(`Avg Latency:          ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)} ms per layer\n`);

if (totalShapeCorrect < totalCases) {
  console.log('=== SHAPE IDENTIFICATION FAILURES ===');
  for (const r of results.filter(r => !r.shapeCorrect)) {
    console.log(`- Target: ${r.primitive.padEnd(14)} (case #${r.caseIndex}) -> Recovered: ${r.recoveredShape.padEnd(14)} | VerifLoss: ${r.recoveredLoss.toFixed(5)}`);
  }
  console.log();
}

console.log('=== PARAMETER ERROR DISTRIBUTION (On Correctly Identified Shapes) ===');
console.log('Metric               |  p50 (Median) |  p90         |  Max');
console.log('---------------------|---------------|--------------|-------------');
console.log(`Position Δx          | ${percentile(dxs, 50).toFixed(4).padStart(13)} | ${percentile(dxs, 90).toFixed(4).padStart(12)} | ${Math.max(...dxs).toFixed(4).padStart(11)}`);
console.log(`Position Δy          | ${percentile(dys, 50).toFixed(4).padStart(13)} | ${percentile(dys, 90).toFixed(4).padStart(12)} | ${Math.max(...dys).toFixed(4).padStart(11)}`);
console.log(`Scale Error (max)    | ${(percentile(dScales, 50) * 100).toFixed(2).padStart(12)}% | ${(percentile(dScales, 90) * 100).toFixed(2).padStart(11)}% | ${(Math.max(...dScales) * 100).toFixed(2).padStart(10)}%`);
console.log(`Rotation Error (°)   | ${percentile(dRots, 50).toFixed(2).padStart(12)}° | ${percentile(dRots, 90).toFixed(2).padStart(11)}° | ${Math.max(...dRots).toFixed(2).padStart(10)}°`);
console.log(`Opacity Error        | ${percentile(dOps, 50).toFixed(4).padStart(13)} | ${percentile(dOps, 90).toFixed(4).padStart(12)} | ${Math.max(...dOps).toFixed(4).padStart(11)}`);
console.log(`Verification Loss    | ${percentile(verifLosses, 50).toFixed(4).padStart(13)} | ${percentile(verifLosses, 90).toFixed(4).padStart(12)} | ${Math.max(...verifLosses).toFixed(4).padStart(11)}`);

const p50VerifLoss = percentile(verifLosses, 50);
const p90VerifLoss = percentile(verifLosses, 90);

// Strict, regression-detecting criteria:
assert.ok(
  totalShapeCorrect >= totalCases * 0.95,
  `Shape accuracy (${totalShapeCorrect}/${totalCases}, ${((totalShapeCorrect / totalCases) * 100).toFixed(1)}%) must be >= 95%`
);
assert.ok(
  totalColorCorrect >= totalCases * 0.98,
  `Color accuracy (${totalColorCorrect}/${totalCases}, ${((totalColorCorrect / totalCases) * 100).toFixed(1)}%) must be >= 98%`
);
assert.ok(
  p50VerifLoss < 0.015,
  `Median verification loss (${p50VerifLoss.toFixed(4)}) must be < 0.015`
);
assert.ok(
  p90VerifLoss < 0.070,
  `90th percentile verification loss (${p90VerifLoss.toFixed(4)}) must be < 0.070`
);
console.log('\n=== HELD-OUT RANDOMIZED TEST SUITE PASSED SUCCESSFULLY! ===\n');

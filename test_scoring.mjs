import assert from 'node:assert';
import {
  generateSyntheticTarget,
  ImageScorer,
  DEFAULT_SCORE_WEIGHTS
} from './src/reconstruction/index.ts';

console.log('=== Running Milestone 2: Headless Image Scorer Test Suite ===\n');

// Common base layer for testing
const baseLayer = {
  id: 'test-layer-1',
  name: 'Base Layer',
  shapeAsset: 'Circle',
  x: 0.5,
  y: 0.5,
  scaleX: 1.0,
  scaleY: 1.0,
  rotation: 0,
  color: '#586a8b', // Slate grey palette color
  opacity: 1.0,
  visible: true,
  locked: false
};

const resolution = { width: 105, height: 155 };

// Test 1: Identity (Render against itself)
console.log('Test 1: Verifying Identity (Self-Loss)...');
const target1 = generateSyntheticTarget(baseLayer, resolution);
const score1 = ImageScorer.score(target1, target1);

assert.ok(score1.totalLoss < 1e-4, `Identity total loss must be ~0, got ${score1.totalLoss}`);
assert.ok(score1.colorLoss < 1e-4, `Identity color loss must be ~0, got ${score1.colorLoss}`);
assert.ok(score1.silhouetteLoss < 1e-4, `Identity silhouette loss must be ~0, got ${score1.silhouetteLoss}`);
assert.ok(score1.edgeLoss < 1e-4, `Identity edge loss must be ~0, got ${score1.edgeLoss}`);
assert.ok(score1.alphaLoss < 1e-4, `Identity alpha loss must be ~0, got ${score1.alphaLoss}`);
console.log(`  Passed: Identity loss = ${score1.totalLoss.toFixed(6)} ≈ 0`);

// Test 2: Translation Monotonic Trend
console.log('\nTest 2: Verifying Translation Error Monotonic Trend...');
const target2 = generateSyntheticTarget(baseLayer, resolution);
const xOffsets = [0.0, 0.02, 0.05, 0.10, 0.20, 0.35];
const translationScores = [];

for (const dx of xOffsets) {
  const shiftedLayer = { ...baseLayer, x: baseLayer.x + dx };
  const shiftedRender = generateSyntheticTarget(shiftedLayer, resolution);
  const score = ImageScorer.score(target2, shiftedRender);
  translationScores.push(score.totalLoss);
}

console.log(`  Offsets: [${xOffsets.join(', ')}]`);
console.log(`  Losses:  [${translationScores.map(s => s.toFixed(4)).join(', ')}]`);

for (let i = 1; i < translationScores.length; i++) {
  assert.ok(
    translationScores[i] > translationScores[i - 1],
    `Loss must increase monotonically as offset increases: offset ${xOffsets[i]} (loss ${translationScores[i].toFixed(4)}) vs ${xOffsets[i - 1]} (loss ${translationScores[i - 1].toFixed(4)})`
  );
}
console.log('  Passed: Loss increases strictly monotonically with translation error');

// Test 3: Scale
console.log('\nTest 3: Verifying Scale Sensitivity...');
const target3 = generateSyntheticTarget(baseLayer, resolution);
const correctScaleRender = generateSyntheticTarget({ ...baseLayer, scaleX: 1.0, scaleY: 1.0 }, resolution);
const slightlyWrongScale = generateSyntheticTarget({ ...baseLayer, scaleX: 1.2, scaleY: 1.2 }, resolution);
const veryWrongScale = generateSyntheticTarget({ ...baseLayer, scaleX: 1.6, scaleY: 1.6 }, resolution);

const scoreCorrectScale = ImageScorer.score(target3, correctScaleRender).totalLoss;
const scoreSlightlyWrong = ImageScorer.score(target3, slightlyWrongScale).totalLoss;
const scoreVeryWrong = ImageScorer.score(target3, veryWrongScale).totalLoss;

assert.ok(scoreSlightlyWrong > scoreCorrectScale + 0.05, 'Slightly wrong scale must score worse than correct');
assert.ok(scoreVeryWrong > scoreSlightlyWrong + 0.05, 'Very wrong scale must score worse than slightly wrong');
console.log(`  Passed: Correct=${scoreCorrectScale.toFixed(4)} < Scale(1.2)=${scoreSlightlyWrong.toFixed(4)} < Scale(1.6)=${scoreVeryWrong.toFixed(4)}`);

// Test 4: Rotation
console.log('\nTest 4: Verifying Rotation Sensitivity on Asymmetric Primitive...');
const pillLayer = { ...baseLayer, shapeAsset: 'Pill', scaleX: 1.2, scaleY: 0.6, rotation: 0 };
const target4 = generateSyntheticTarget(pillLayer, resolution);

const rot0 = ImageScorer.score(target4, generateSyntheticTarget(pillLayer, resolution)).totalLoss;
const rot15 = ImageScorer.score(target4, generateSyntheticTarget({ ...pillLayer, rotation: 15 }, resolution)).totalLoss;
const rot45 = ImageScorer.score(target4, generateSyntheticTarget({ ...pillLayer, rotation: 45 }, resolution)).totalLoss;
const rot90 = ImageScorer.score(target4, generateSyntheticTarget({ ...pillLayer, rotation: 90 }, resolution)).totalLoss;

assert.ok(rot15 > rot0 + 0.02, '15 deg rotation must score worse than 0 deg');
assert.ok(rot45 > rot15 + 0.02, '45 deg rotation must score worse than 15 deg');
assert.ok(rot90 > rot45 + 0.02, '90 deg rotation must score worse than 45 deg');
console.log(`  Passed: Rot 0°=${rot0.toFixed(4)} < Rot 15°=${rot15.toFixed(4)} < Rot 45°=${rot45.toFixed(4)} < Rot 90°=${rot90.toFixed(4)}`);

// Test 5: Color Sensitivity
console.log('\nTest 5: Verifying Palette Color Sensitivity...');
const target5 = generateSyntheticTarget({ ...baseLayer, color: '#e43032' }, resolution); // Red
const candCorrectColor = generateSyntheticTarget({ ...baseLayer, color: '#e43032' }, resolution);
const candSimilarColor = generateSyntheticTarget({ ...baseLayer, color: '#fe9dbe' }, resolution); // Pink
const candDifferentColor = generateSyntheticTarget({ ...baseLayer, color: '#11d4bd' }, resolution); // Cyan

const lossCorrectColor = ImageScorer.score(target5, candCorrectColor).totalLoss;
const lossSimilarColor = ImageScorer.score(target5, candSimilarColor).totalLoss;
const lossDifferentColor = ImageScorer.score(target5, candDifferentColor).totalLoss;

assert.ok(lossSimilarColor > lossCorrectColor + 0.05, 'Similar color must score worse than exact color');
assert.ok(lossDifferentColor > lossSimilarColor + 0.05, 'Contrasting color must score worse than similar color');
console.log(`  Passed: Exact (#e43032)=${lossCorrectColor.toFixed(4)} < Similar (#fe9dbe)=${lossSimilarColor.toFixed(4)} < Different (#11d4bd)=${lossDifferentColor.toFixed(4)}`);

// Test 6: Opacity Sensitivity
console.log('\nTest 6: Verifying Opacity Sensitivity...');
const target6 = generateSyntheticTarget({ ...baseLayer, opacity: 0.8 }, resolution);
const candCorrectOp = generateSyntheticTarget({ ...baseLayer, opacity: 0.8 }, resolution);
const candSlightWrongOp = generateSyntheticTarget({ ...baseLayer, opacity: 0.6 }, resolution);
const candVeryWrongOp = generateSyntheticTarget({ ...baseLayer, opacity: 0.2 }, resolution);

const lossCorrectOp = ImageScorer.score(target6, candCorrectOp).totalLoss;
const lossSlightOp = ImageScorer.score(target6, candSlightWrongOp).totalLoss;
const lossVeryWrongOp = ImageScorer.score(target6, candVeryWrongOp).totalLoss;

assert.ok(lossSlightOp > lossCorrectOp + 0.02, 'Slightly wrong opacity must score worse than exact');
assert.ok(lossVeryWrongOp > lossSlightOp + 0.05, 'Significantly wrong opacity must score worse than slight');
console.log(`  Passed: Opacity 0.8=${lossCorrectOp.toFixed(4)} < Opacity 0.6=${lossSlightOp.toFixed(4)} < Opacity 0.2=${lossVeryWrongOp.toFixed(4)}`);

// Test 7: Shape Identity
console.log('\nTest 7: Verifying Primitive Shape Discrimination...');
const targetCross = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Cross' }, resolution);
const candCross = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Cross' }, resolution);
const candCircle = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Circle' }, resolution);
const candSquare = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Rounded_Square' }, resolution);

const lossCross = ImageScorer.score(targetCross, candCross).totalLoss;
const lossCircle = ImageScorer.score(targetCross, candCircle).totalLoss;
const lossSquare = ImageScorer.score(targetCross, candSquare).totalLoss;

assert.ok(lossCircle > lossCross + 0.08, 'Circle must score noticeably worse against Cross target');
assert.ok(lossSquare > lossCross + 0.08, 'Square must score noticeably worse against Cross target');
console.log(`  Passed: Cross vs Cross=${lossCross.toFixed(4)} < Cross vs Circle=${lossCircle.toFixed(4)}, Cross vs Square=${lossSquare.toFixed(4)}`);

// Test 8: Glow / Soft Alpha vs Hard Solid
console.log('\nTest 8: Verifying Glow Softness Discrimination...');
const targetGlow = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Glow' }, resolution);
const candGlow = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Glow' }, resolution);
const candSolidCircle = generateSyntheticTarget({ ...baseLayer, shapeAsset: 'Circle' }, resolution);

const scoreGlow = ImageScorer.score(targetGlow, candGlow);
const scoreSolid = ImageScorer.score(targetGlow, candSolidCircle);

assert.ok(scoreSolid.alphaLoss > scoreGlow.alphaLoss + 0.15, 'Solid circle must have much higher alphaLoss against Glow');
assert.ok(scoreSolid.totalLoss > scoreGlow.totalLoss + 0.10, 'Solid circle must score worse overall against Glow target');
console.log(`  Passed: Glow target -> Glow alphaLoss=${scoreGlow.alphaLoss.toFixed(4)} vs Solid Circle alphaLoss=${scoreSolid.alphaLoss.toFixed(4)}`);

// Test 9: Multi-Scale / Distance-Aware Behavior for Distant Candidates
console.log('\nTest 9: Verifying Distance-Aware Non-Plateau Behavior...');
const targetFar = generateSyntheticTarget({ ...baseLayer, x: 0.15, y: 0.15 }, resolution);
const candFar1 = generateSyntheticTarget({ ...baseLayer, x: 0.50, y: 0.50 }, resolution); // Medium distance
const candFar2 = generateSyntheticTarget({ ...baseLayer, x: 0.85, y: 0.85 }, resolution); // Great distance

const scoreFar1 = ImageScorer.score(targetFar, candFar1);
const scoreFar2 = ImageScorer.score(targetFar, candFar2);

assert.ok(
  scoreFar2.totalLoss > scoreFar1.totalLoss,
  `Non-overlapping distant candidate must yield strictly higher loss as distance increases: far2 (${scoreFar2.totalLoss.toFixed(4)}) > far1 (${scoreFar1.totalLoss.toFixed(4)})`
);
console.log(`  Passed: Non-overlapping target at (0.15, 0.15) -> Cand at (0.50, 0.50) loss=${scoreFar1.totalLoss.toFixed(4)} < Cand at (0.85, 0.85) loss=${scoreFar2.totalLoss.toFixed(4)}`);

console.log('\n=== ALL 9 MILESTONE 2 SCORER TESTS PASSED SUCCESSFULLY! ===\n');

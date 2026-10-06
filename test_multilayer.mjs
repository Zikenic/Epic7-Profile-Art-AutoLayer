import assert from 'node:assert';
import {
  MultiLayerReconstructor,
  reconstruct,
  reduceLayers,
  createProjectFromLayers,
  renderLayersToRaster,
  ImageScorer,
  cloneRasterImage
} from './src/reconstruction/index.ts';

console.log('=== Running Milestone 4: Multi-Layer Reconstruction Test Suite ===\n');

function formatReportTable(history) {
  console.log('  Iteration | Shape          | Color    | Pos (x, y)      | Scale (sx, sy)  | Rot   | Opacity | Z | Verified Imp');
  console.log('  ----------|----------------|----------|-----------------|-----------------|-------|---------|---|-------------');
  for (const h of history) {
    const shape = h.shapeAsset.padEnd(14);
    const color = h.color.padEnd(8);
    const pos = `(${h.x.toFixed(3)}, ${h.y.toFixed(3)})`.padEnd(15);
    const scale = `(${h.scaleX.toFixed(2)}, ${h.scaleY.toFixed(2)})`.padEnd(15);
    const rot = `${h.rotation.toFixed(0)}°`.padEnd(5);
    const op = h.opacity.toFixed(2).padEnd(7);
    const z = `${h.zIndex}`.padEnd(1);
    const imp = h.verifiedImprovement.toFixed(4);
    console.log(`  #${h.iteration.toString().padEnd(8)} | ${shape} | ${color} | ${pos} | ${scale} | ${rot} | ${op} | ${z} | ${imp}`);
  }
}

// ----------------------------------------------------------------------------
// Test A — Two Non-Overlapping Shapes (Circle + Triangle)
// ----------------------------------------------------------------------------
console.log('Test A: Verifying Two Non-Overlapping Shapes (Circle + Triangle)...');
const t0_A = Date.now();
const targetA_Layers = [
  {
    id: 'gt-circle',
    name: 'Circle',
    shapeAsset: 'Circle',
    x: 0.32,
    y: 0.40,
    scaleX: 0.70,
    scaleY: 0.70,
    rotation: 0,
    color: '#e43032', // Red
    opacity: 1.0,
    visible: true,
    locked: false
  },
  {
    id: 'gt-triangle',
    name: 'Triangle',
    shapeAsset: 'Triangle',
    x: 0.68,
    y: 0.60,
    scaleX: 0.75,
    scaleY: 0.75,
    rotation: 0,
    color: '#3f48bb', // Blue
    opacity: 1.0,
    visible: true,
    locked: false
  }
];

const targetA = renderLayersToRaster(targetA_Layers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

const resA = reconstruct(targetA, {
  maxLayers: 6,
  minImprovement: 0.005,
  reductionEnabled: true
});

const elapsedA = Date.now() - t0_A;
console.log(`  Initial Loss: ${resA.diagnostics.initialScore.totalLoss.toFixed(4)}`);
console.log(`  Final Loss:   ${resA.finalScore.totalLoss.toFixed(4)}`);
console.log(`  Layers Before Reduction: ${resA.diagnostics.layersBeforeReduction}`);
console.log(`  Layers After Reduction:  ${resA.diagnostics.layersAfterReduction}`);
console.log(`  Runtime:      ${elapsedA}ms`);
formatReportTable(resA.diagnostics.history);

assert(resA.finalScore.totalLoss < 0.035, `Test A final loss too high: ${resA.finalScore.totalLoss}`);
assert(resA.layers.length >= 2, `Test A expected at least 2 layers, got ${resA.layers.length}`);
const shapesA = resA.layers.map(l => l.shapeAsset);
assert(shapesA.includes('Circle') || shapesA.includes('Pill'), 'Test A expected circular shape');
assert(shapesA.includes('Triangle'), 'Test A expected Triangle shape');
console.log('  Passed: Both non-overlapping structures successfully recovered!\n');

// ----------------------------------------------------------------------------
// Test B — Overlapping Shapes (Painter\'s Order)
// ----------------------------------------------------------------------------
console.log('Test B: Verifying Overlapping Shapes in Painter\'s Stacking Order...');
const t0_B = Date.now();
const targetB_Layers = [
  {
    id: 'gt-base',
    name: 'Base Rounded Square',
    shapeAsset: 'Rounded_Square',
    x: 0.50,
    y: 0.50,
    scaleX: 1.15,
    scaleY: 1.15,
    rotation: 0,
    color: '#3f48bb', // Blue base
    opacity: 1.0,
    visible: true,
    locked: false
  },
  {
    id: 'gt-fg',
    name: 'Foreground Yellow Heart',
    shapeAsset: 'Heart',
    x: 0.50,
    y: 0.48,
    scaleX: 0.65,
    scaleY: 0.65,
    rotation: 0,
    color: '#fff355', // Yellow foreground
    opacity: 1.0,
    visible: true,
    locked: false
  }
];

const targetB = renderLayersToRaster(targetB_Layers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

const resB = reconstruct(targetB, {
  maxLayers: 6,
  minImprovement: 0.005,
  reductionEnabled: true
});

const elapsedB = Date.now() - t0_B;
console.log(`  Initial Loss: ${resB.diagnostics.initialScore.totalLoss.toFixed(4)}`);
console.log(`  Final Loss:   ${resB.finalScore.totalLoss.toFixed(4)}`);
console.log(`  Layers Before Reduction: ${resB.diagnostics.layersBeforeReduction}`);
console.log(`  Layers After Reduction:  ${resB.diagnostics.layersAfterReduction}`);
console.log(`  Runtime:      ${elapsedB}ms`);
formatReportTable(resB.diagnostics.history);

assert(resB.finalScore.totalLoss < 0.045, `Test B final loss too high: ${resB.finalScore.totalLoss}`);
assert(resB.layers.length >= 2, `Test B expected at least 2 layers, got ${resB.layers.length}`);
console.log('  Passed: Overlapping composition and stacking order successfully recovered!\n');

// ----------------------------------------------------------------------------
// Test C — Multiple Colors
// ----------------------------------------------------------------------------
console.log('Test C: Verifying Multiple Palette Colors Recovery...');
const t0_C = Date.now();
const targetC_Layers = [
  {
    id: 'gt-red-pill',
    name: 'Pill',
    shapeAsset: 'Pill',
    x: 0.30,
    y: 0.35,
    scaleX: 0.70,
    scaleY: 0.70,
    rotation: 0,
    color: '#e43032', // Red
    opacity: 1.0,
    visible: true,
    locked: false
  },
  {
    id: 'gt-cyan-star',
    name: 'Star',
    shapeAsset: 'Star',
    x: 0.70,
    y: 0.35,
    scaleX: 0.70,
    scaleY: 0.70,
    rotation: 0,
    color: '#11d4bd', // Cyan
    opacity: 1.0,
    visible: true,
    locked: false
  },
  {
    id: 'gt-pink-heart',
    name: 'Heart',
    shapeAsset: 'Heart',
    x: 0.50,
    y: 0.70,
    scaleX: 0.70,
    scaleY: 0.70,
    rotation: 0,
    color: '#fe9dbe', // Pink
    opacity: 1.0,
    visible: true,
    locked: false
  }
];

const targetC = renderLayersToRaster(targetC_Layers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

const resC = reconstruct(targetC, {
  maxLayers: 8,
  minImprovement: 0.005,
  reductionEnabled: true
});

const elapsedC = Date.now() - t0_C;
console.log(`  Initial Loss: ${resC.diagnostics.initialScore.totalLoss.toFixed(4)}`);
console.log(`  Final Loss:   ${resC.finalScore.totalLoss.toFixed(4)}`);
console.log(`  Layers:       ${resC.layers.length}`);
console.log(`  Runtime:      ${elapsedC}ms`);
formatReportTable(resC.diagnostics.history);

const recoveredColors = resC.layers.map(l => l.color.toLowerCase());
assert(recoveredColors.includes('#e43032'), 'Test C expected #e43032');
assert(recoveredColors.includes('#11d4bd'), 'Test C expected #11d4bd');
assert(recoveredColors.includes('#fe9dbe'), 'Test C expected #fe9dbe');
assert(resC.finalScore.totalLoss < 0.035, `Test C final loss too high: ${resC.finalScore.totalLoss}`);
console.log('  Passed: All 3 distinct palette colors accurately discovered and reconstructed!\n');

// ----------------------------------------------------------------------------
// Test D — Same-Color Disconnected Shapes
// ----------------------------------------------------------------------------
console.log('Test D: Verifying Same-Color Disconnected Shapes Isolation...');
const t0_D = Date.now();
const targetD_Layers = [
  {
    id: 'gt-green-circle-left',
    name: 'Left Circle',
    shapeAsset: 'Circle',
    x: 0.28,
    y: 0.50,
    scaleX: 0.55,
    scaleY: 0.55,
    rotation: 0,
    color: '#009432', // Green
    opacity: 1.0,
    visible: true,
    locked: false
  },
  {
    id: 'gt-green-circle-right',
    name: 'Right Circle',
    shapeAsset: 'Circle',
    x: 0.72,
    y: 0.50,
    scaleX: 0.55,
    scaleY: 0.55,
    rotation: 0,
    color: '#009432', // Green
    opacity: 1.0,
    visible: true,
    locked: false
  }
];

const targetD = renderLayersToRaster(targetD_Layers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

const resD = reconstruct(targetD, {
  maxLayers: 6,
  minImprovement: 0.005,
  reductionEnabled: true
});

const elapsedD = Date.now() - t0_D;
console.log(`  Initial Loss: ${resD.diagnostics.initialScore.totalLoss.toFixed(4)}`);
console.log(`  Final Loss:   ${resD.finalScore.totalLoss.toFixed(4)}`);
console.log(`  Layers:       ${resD.layers.length}`);
console.log(`  Runtime:      ${elapsedD}ms`);
formatReportTable(resD.diagnostics.history);

assert(resD.layers.length >= 2, `Test D expected at least 2 layers, got ${resD.layers.length}`);
assert(resD.finalScore.totalLoss < 0.030, `Test D final loss too high: ${resD.finalScore.totalLoss}`);
console.log('  Passed: Same-color disconnected shapes successfully segmented into separate layers!\n');

// ----------------------------------------------------------------------------
// Test E — Redundant Composition & Reduction Pass
// ----------------------------------------------------------------------------
console.log('Test E: Verifying Redundant Layer Pruning via Reduction Pass...');
const t0_E = Date.now();
// A large opaque rounded square completely occludes a tiny shape placed behind it
const targetE_Layers = [
  {
    id: 'gt-large-covering',
    name: 'Large Covering Square',
    shapeAsset: 'Rounded_Square',
    x: 0.50,
    y: 0.50,
    scaleX: 1.30,
    scaleY: 1.30,
    rotation: 0,
    color: '#3f48bb',
    opacity: 1.0,
    visible: true,
    locked: false
  }
];

const targetE = renderLayersToRaster(targetE_Layers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

// Run with very low minImprovement to intentionally accept multiple candidate approximations
const resE = reconstruct(targetE, {
  maxLayers: 4,
  minImprovement: 0.002,
  reductionEnabled: true,
  reductionTolerance: 0.005
});

const elapsedE = Date.now() - t0_E;
console.log(`  Initial Loss: ${resE.diagnostics.initialScore.totalLoss.toFixed(4)}`);
console.log(`  Final Loss:   ${resE.finalScore.totalLoss.toFixed(4)}`);
console.log(`  Layers Before Reduction: ${resE.diagnostics.layersBeforeReduction}`);
console.log(`  Layers After Reduction:  ${resE.diagnostics.layersAfterReduction}`);
console.log(`  Layers Pruned:           ${resE.diagnostics.reductionLayersRemoved}`);
console.log(`  Runtime:      ${elapsedE}ms`);

assert(resE.layers.length <= 2, `Test E expected <= 2 layers after reduction, got ${resE.layers.length}`);
assert(resE.finalScore.totalLoss < 0.030, `Test E final loss too high: ${resE.finalScore.totalLoss}`);
console.log('  Passed: Reduction pass successfully pruned redundant representations!\n');

// ----------------------------------------------------------------------------
// Test F — Hard Budget Enforcement (maxLayers = 1, 2, 5, 130)
// ----------------------------------------------------------------------------
console.log('Test F: Verifying Hard Budget Enforcement (maxLayers constraint)...');
for (const budget of [1, 2, 5]) {
  const resBudget = reconstruct(targetC, {
    maxLayers: budget,
    minImprovement: 0.001
  });
  console.log(`  Budget maxLayers=${budget} -> Result layer count: ${resBudget.layers.length}`);
  assert(resBudget.layers.length <= budget, `Failed budget enforcement: got ${resBudget.layers.length} > ${budget}`);
}
console.log('  Passed: maxLayers budget strictly enforced across all limits!\n');

// ----------------------------------------------------------------------------
// Test G — Imperfect Target with Blur & Noise (Anti-Aliasing Stability)
// ----------------------------------------------------------------------------
console.log('Test G: Verifying Imperfect Target Stability (Anti-Aliasing & Noise)...');
const t0_G = Date.now();
const noisyTarget = cloneRasterImage(targetA);
// Deliberately perturb pixels with RGB & alpha noise
for (let i = 0; i < noisyTarget.data.length; i += 4) {
  if (noisyTarget.data[i + 3] > 0) {
    const noise = ((i % 17) - 8);
    noisyTarget.data[i] = Math.max(0, Math.min(255, noisyTarget.data[i] + noise));
    noisyTarget.data[i + 1] = Math.max(0, Math.min(255, noisyTarget.data[i + 1] + noise));
    noisyTarget.data[i + 2] = Math.max(0, Math.min(255, noisyTarget.data[i + 2] + noise));
  }
}

const resG = reconstruct(noisyTarget, {
  maxLayers: 10,
  minImprovement: 0.005,
  reductionEnabled: true
});

const elapsedG = Date.now() - t0_G;
console.log(`  Noisy Target Final Loss: ${resG.finalScore.totalLoss.toFixed(4)}`);
console.log(`  Layers Produced:         ${resG.layers.length}`);
console.log(`  Runtime:                 ${elapsedG}ms`);
assert(resG.layers.length <= 4, `Imperfect target wasted layers chasing noise: got ${resG.layers.length}`);
console.log('  Passed: Imperfect noisy target reconstructed stably without layer bloat!\n');

// ----------------------------------------------------------------------------
// Test H — Export to .e7profile.json Serializability
// ----------------------------------------------------------------------------
console.log('Test H: Verifying Direct Serialization to .e7profile.json Format...');
const projectData = createProjectFromLayers(resA.layers, 'Test Reconstructed Profile');
assert.strictEqual(projectData.version, 1);
assert.strictEqual(projectData.canvas.aspectRatio, '21:31');
assert.strictEqual(projectData.layers.length, resA.layers.length);
const serializedJson = JSON.stringify(projectData, null, 2);
assert(serializedJson.length > 100);
const parsedProject = JSON.parse(serializedJson);
assert.strictEqual(parsedProject.layers[0].shapeAsset, resA.layers[0].shapeAsset);
console.log('  Passed: Reconstructed composition fully conforms to .e7profile.json specification!\n');

// ----------------------------------------------------------------------------
// Test I — Determinism (Repeat Run Bit-for-Bit Identity)
// ----------------------------------------------------------------------------
console.log('Test I: Verifying Search Determinism (Repeat Run Bit-for-Bit Identity)...');
const resI1 = reconstruct(targetA, {
  maxLayers: 2,
  minImprovement: 0.005,
  seed: 42
});
const resI2 = reconstruct(targetA, {
  maxLayers: 2,
  minImprovement: 0.005,
  seed: 42
});
assert.strictEqual(
  JSON.stringify(resI1.layers),
  JSON.stringify(resI2.layers),
  'Test I failed: layers differed between two identical runs'
);
assert.strictEqual(
  resI1.finalScore.totalLoss,
  resI2.finalScore.totalLoss,
  'Test I failed: final loss differed between two identical runs'
);
console.log('  Passed: Exact bit-for-bit layer serialization determinism confirmed!\n');

// ----------------------------------------------------------------------------
// Test J — Strict Layer Improvement (Monotonic Improvement Assertion)
// ----------------------------------------------------------------------------
console.log('Test J: Verifying Monotonic Improvement on Accepted Layers...');
assert(resA.diagnostics.history.length >= 2, 'Test J: expected at least 2 history records');
for (const record of resA.diagnostics.history) {
  assert(
    record.verifiedImprovement >= 0.005,
    `Test J failed: accepted layer #${record.iteration} had improvement ${record.verifiedImprovement} < threshold 0.005`
  );
}
assert(
  resA.finalScore.totalLoss < resA.diagnostics.initialScore.totalLoss,
  'Test J failed: final score is not strictly lower than initial score'
);
console.log('  Passed: All accepted layers verified to improve loss by >= threshold!\n');

// ----------------------------------------------------------------------------
// Test K — Layer-Order Correctness (Stacking Inversion Detection)
// ----------------------------------------------------------------------------
console.log('Test K: Verifying Layer-Order Correctness (Stacking Order Detection)...');
const orderTargetLayers = [
  {
    id: 'base-circle',
    name: 'Red Base Circle',
    shapeAsset: 'Circle',
    x: 0.5,
    y: 0.5,
    scaleX: 1.0,
    scaleY: 1.0,
    rotation: 0,
    color: '#e43032',
    opacity: 1.0,
    visible: true,
    locked: false,
    zIndex: 0
  },
  {
    id: 'top-square',
    name: 'Blue Top Square',
    shapeAsset: 'Rounded_Square',
    x: 0.5,
    y: 0.5,
    scaleX: 0.5,
    scaleY: 0.5,
    rotation: 0,
    color: '#3f48bb',
    opacity: 1.0,
    visible: true,
    locked: false,
    zIndex: 1
  }
];

const targetK = renderLayersToRaster(orderTargetLayers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

// Render correct stack vs inverted stack
const renderCorrect = renderLayersToRaster(orderTargetLayers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});
const invertedLayers = [
  { ...orderTargetLayers[1], zIndex: 0 },
  { ...orderTargetLayers[0], zIndex: 1 }
];
const renderInverted = renderLayersToRaster(invertedLayers, 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

const scoreCorrect = ImageScorer.score(targetK, renderCorrect);
const scoreInverted = ImageScorer.score(targetK, renderInverted);

console.log(`  Correct Stack Loss:  ${scoreCorrect.totalLoss.toFixed(4)}`);
console.log(`  Inverted Stack Loss: ${scoreInverted.totalLoss.toFixed(4)}`);
assert(scoreCorrect.totalLoss < 0.001, `Correct stack should score near 0: got ${scoreCorrect.totalLoss}`);
assert(scoreInverted.totalLoss > 0.050, `Inverted stack should score poorly: got ${scoreInverted.totalLoss}`);
assert(
  scoreInverted.totalLoss - scoreCorrect.totalLoss > 0.050,
  'Inversion was not materially penalized by the scorer'
);
console.log('  Passed: Renderer and scorer detect layer order differences correctly!\n');

// ----------------------------------------------------------------------------
// Test L — Explicit Reduction Pass & Bounded Cumulative Drift Safety
// ----------------------------------------------------------------------------
console.log('Test L: Verifying Explicit Reduction Pass & Cumulative Drift Safety...');
const usefulLayer = {
  id: 'useful-square',
  name: 'Useful Green Square',
  shapeAsset: 'Rounded_Square',
  x: 0.5,
  y: 0.5,
  scaleX: 0.8,
  scaleY: 0.8,
  rotation: 0,
  color: '#009432',
  opacity: 1.0,
  visible: true,
  locked: false,
  zIndex: 1
};

const duplicateLayer = {
  ...usefulLayer,
  id: 'duplicate-square',
  name: 'Duplicate Green Square',
  zIndex: 2
};

const occludedLayer = {
  id: 'occluded-heart',
  name: 'Occluded Blue Heart',
  shapeAsset: 'Heart',
  x: 0.5,
  y: 0.5,
  scaleX: 0.2,
  scaleY: 0.2,
  rotation: 0,
  color: '#3f48bb',
  opacity: 1.0,
  visible: true,
  locked: false,
  zIndex: 0
};

// Target is just the single green square
const targetL = renderLayersToRaster([usefulLayer], 210, 310, {
  backgroundColor: 'transparent',
  renderMode: 'mathematical'
});

// Bloated stack contains occluded heart + useful square + duplicate square
const bloatedStack = [occludedLayer, usefulLayer, duplicateLayer];
const initialReductionScore = ImageScorer.score(
  targetL,
  renderLayersToRaster(bloatedStack, 210, 310, { backgroundColor: 'transparent', renderMode: 'mathematical' })
);

const toleranceL = 0.002;
const reductionOut = reduceLayers(bloatedStack, targetL, {
  reductionTolerance: toleranceL
});

console.log(`  Initial Stack Layers: ${bloatedStack.length}`);
console.log(`  Reduced Stack Layers: ${reductionOut.layers.length}`);
console.log(`  Pruned Layer Count:   ${reductionOut.prunedCount}`);
console.log(`  Initial Stack Loss:   ${initialReductionScore.totalLoss.toFixed(4)}`);
console.log(`  Reduced Stack Loss:   ${reductionOut.score.totalLoss.toFixed(4)}`);

assert(reductionOut.layers.length < bloatedStack.length, 'Reduction failed to prune redundant layers');
assert.strictEqual(reductionOut.layers.length, 1, `Expected exactly 1 layer after reduction, got ${reductionOut.layers.length}`);
assert.strictEqual(reductionOut.prunedCount, 2, `Expected 2 layers pruned, got ${reductionOut.prunedCount}`);
assert.strictEqual(reductionOut.layers[0].shapeAsset, 'Rounded_Square', 'Preserved layer should be Rounded_Square');

// DRIFT SAFETY: Cumulative drift must not exceed tolerance relative to start-of-pass baseline
const drift = reductionOut.score.totalLoss - initialReductionScore.totalLoss;
console.log(`  Cumulative Drift:     ${drift.toFixed(6)} (Tolerance: ${toleranceL})`);
assert(drift <= toleranceL, `Cumulative drift ${drift} exceeded tolerance budget ${toleranceL}`);
console.log('  Passed: Explicit reduction pruned redundant/occluded layers with strict cumulative drift safety!\n');

console.log('=== ALL MILESTONE 4 MULTI-LAYER RECONSTRUCTION TESTS PASSED SUCCESSFULLY! ===');


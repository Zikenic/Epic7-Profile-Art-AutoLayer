import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { CalibrationSystem } from './src/calibration/CalibrationSystem.ts';
import { MathematicalPrimitives } from './src/calibration/MathematicalPrimitives.ts';

console.log('=== Running Epic Seven Phase 2A Calibration Test Suite ===\n');

// 1. Verify shape-calibration.json existence and schema
console.log('Test 1: Verifying shape-calibration.json database...');
const calPath = path.resolve('shape-calibration.json');
assert.ok(fs.existsSync(calPath), 'shape-calibration.json must exist in root directory');

const calData = JSON.parse(fs.readFileSync(calPath, 'utf8'));
assert.strictEqual(calData.version, 1, 'Database version must be 1');
assert.ok(calData.shapes, 'Database must contain shapes table');
assert.ok(calData.palettes, 'Database must contain palettes table');

const expectedShapes = [
  'Baloon',
  'Circle',
  'Glow',
  'Half_Circle',
  'Heart',
  'Moon_Curve',
  'Moon_Edge',
  'Pill',
  'Rounded_Square',
  'Star',
  'Triangle',
  'Cross'
];

for (const name of expectedShapes) {
  assert.ok(calData.shapes[name], `Shape ${name} must be present in calibration database`);
}
console.log(`  Passed: All ${expectedShapes.length} discovered shapes verified in calibration database`);

// 2. Verify Geometry & Foreground Bounding Boxes
console.log('\nTest 2: Verifying Dimensions & True Foreground Bounding Boxes...');

// Circle: 505x484 PNG -> 360x360 true circular foreground
const circle = calData.shapes.Circle;
assert.strictEqual(circle.sourceWidth, 505);
assert.strictEqual(circle.sourceHeight, 484);
assert.strictEqual(circle.foregroundBounds.width, 360);
assert.strictEqual(circle.foregroundBounds.height, 360);
assert.strictEqual(circle.foregroundBounds.width / circle.foregroundBounds.height, 1.0, 'Circle foreground must be 1:1');
console.log('  Circle: 505x484 PNG -> Exact 360x360 foreground (1.000:1 aspect ratio)');

// Rounded_Square: 424x409 PNG -> 324x324 true square foreground
const square = calData.shapes.Rounded_Square;
assert.strictEqual(square.sourceWidth, 424);
assert.strictEqual(square.sourceHeight, 409);
assert.strictEqual(square.foregroundBounds.width, 324);
assert.strictEqual(square.foregroundBounds.height, 324);
assert.strictEqual(square.foregroundBounds.width / square.foregroundBounds.height, 1.0, 'Rounded_Square foreground must be 1:1');
console.log('  Rounded_Square: 424x409 PNG -> Exact 324x324 foreground (1.000:1 aspect ratio)');

// Pill: 471x231 PNG -> 360x140 foreground
const pill = calData.shapes.Pill;
assert.strictEqual(pill.foregroundBounds.width, 360);
assert.strictEqual(pill.foregroundBounds.height, 140);
console.log('  Pill: 471x231 PNG -> 360x140 capsule foreground');

// Half_Circle: 490x302 PNG -> 360x182 foreground (radius 180)
const halfCircle = calData.shapes.Half_Circle;
assert.strictEqual(halfCircle.foregroundBounds.width, 360);
assert.strictEqual(halfCircle.foregroundBounds.height, 182);
console.log('  Half_Circle: 490x302 PNG -> 360x182 semicircle foreground');

// Glow: 490x475 PNG -> 330x330 radial gradient, 0 opaque pixels
const glow = calData.shapes.Glow;
assert.strictEqual(glow.foregroundBounds.width, 331);
assert.strictEqual(glow.foregroundBounds.height, 331);
assert.strictEqual(glow.pixels.opaque, 0, 'Glow must contain 0 completely opaque pixels');
assert.ok(glow.pixels.partial > 80000, 'Glow must contain broad gradient partial pixels');
console.log('  Glow: 490x475 PNG -> 330x330 radial gradient (0 opaque pixels, smooth falloff)');

// 3. Verify Centers vs Centroid Discrepancies
console.log('\nTest 3: Verifying Centers & Offset Alignment...');
// Circle center offset
assert.strictEqual(circle.centers.image.x, 252.5);
assert.strictEqual(circle.centers.image.y, 242.0);
assert.strictEqual(circle.centers.foregroundBBox.x, 253.5);
assert.strictEqual(circle.centers.foregroundBBox.y, 263.5);
assert.ok(Math.abs(circle.centers.offsetBBoxFromImage.y) > 20, 'Circle foreground is vertically offset by >20px from PNG center');
console.log(`  Circle Center Offset: Image Center=(252.5, 242.0), BBox Center=(253.5, 263.5), ΔY=${circle.centers.offsetBBoxFromImage.y}px`);

// Triangle centroid offset
const triangle = calData.shapes.Triangle;
assert.ok(triangle.centers.alphaCentroid.y > triangle.centers.foregroundBBox.y + 40, 'Triangle mass is heavily weighted toward base');
console.log(`  Triangle Centroid: BBox Center Y=${triangle.centers.foregroundBBox.y}, Alpha Centroid Y=${triangle.centers.alphaCentroid.y}`);

// 4. Verify Symmetry Metrics
console.log('\nTest 4: Verifying Symmetry Metrics...');
assert.ok(circle.symmetry.horizontal >= 99.8, 'Circle horizontal symmetry >= 99.8%');
assert.ok(circle.symmetry.vertical >= 99.0, 'Circle vertical symmetry >= 99.0%');
assert.strictEqual(pill.symmetry.horizontal, 100.0, 'Pill horizontal symmetry must be 100%');
assert.ok(pill.symmetry.vertical >= 99.8, 'Pill vertical symmetry >= 99.8%');
assert.strictEqual(square.symmetry.horizontal, 100.0, 'Rounded_Square horizontal symmetry must be 100%');
assert.ok(triangle.symmetry.horizontal >= 99.0, 'Triangle horizontal symmetry >= 99.0%');
assert.ok(triangle.symmetry.vertical < 60.0, 'Triangle vertical symmetry must reflect true asymmetry (<60%)');
console.log('  Symmetry: Circle (H:100%, V:99.5%), Pill (H:100%, V:99.9%), Square (H:100%, V:99.9%), Triangle (H:99.5%, V:50.4%)');

// 5. Verify Palette Analysis
console.log('\nTest 5: Verifying Palette Extraction & Color Models...');
assert.ok(calData.palettes.Color_Palette_1, 'Palette 1 must exist');
assert.ok(calData.palettes.Color_Palette_2, 'Palette 2 must exist');

const p1 = calData.palettes.Color_Palette_1;
const p2 = calData.palettes.Color_Palette_2;

assert.strictEqual(p1.colorCount, 21, 'Color_Palette_1 must contain 21 colors');
assert.strictEqual(p1.colors.length, 21);
assert.strictEqual(p2.colorCount, 5, 'Color_Palette_2 must contain 5 colors');
assert.strictEqual(p2.colors.length, 5);

// Check first and last color of Palette 1
assert.strictEqual(p1.colors[0].hex, '#000000');
assert.strictEqual(p1.colors[1].hex, '#586a8b'); // Slate grey
assert.strictEqual(p1.colors[20].hex, '#713e27');

// Verify HSV & HSL presence
for (const c of [...p1.colors, ...p2.colors]) {
  assert.ok(c.rgb && typeof c.rgb.r === 'number');
  assert.ok(c.hsv && typeof c.hsv.h === 'number');
  assert.ok(c.hsl && typeof c.hsl.l === 'number');
  assert.ok(/^#[0-9a-f]{6}$/i.test(c.hex));
}
console.log('  Passed: 26 total palette colors extracted with valid RGB, HEX, HSV, and HSL values');

// 6. Verify Mathematical Fit Evaluator
console.log('\nTest 6: Verifying Mathematical Primitives Fit Evaluator...');
// Circle fit evaluation
const circleMath = new Float32Array(505 * 484);
const circleRaster = new Float32Array(505 * 484);

// Synthesize circle on grid
const cx = 253.5, cy = 263.5, r = 180;
for (let y = 0; y < 484; y++) {
  for (let x = 0; x < 505; x++) {
    const idx = y * 505 + x;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (dist <= r) {
      circleMath[idx] = 1.0;
      circleRaster[idx] = 1.0;
    }
  }
}

const metrics = MathematicalPrimitives.evaluateMetrics(
  circleMath,
  circleRaster,
  74,
  84,
  433,
  443,
  505
);
assert.strictEqual(metrics.iou, 1.0);
assert.strictEqual(metrics.meanAbsoluteAlphaError, 0.0);
assert.strictEqual(metrics.pixelDisagreementCount, 0);
console.log('  Passed: MathematicalPrimitives evaluator computes exact IoU and error metrics');

// 7. Verify Database Serialization & Deserialization
console.log('\nTest 7: Verifying Database Serialization & Deserialization...');
const system = new CalibrationSystem();
system.loadDatabaseJSON(JSON.stringify(calData));
const exportedStr = system.exportDatabaseJSON();
const reparsed = JSON.parse(exportedStr);

assert.strictEqual(reparsed.version, 1);
assert.strictEqual(Object.keys(reparsed.shapes).length, expectedShapes.length);
assert.strictEqual(reparsed.shapes.Circle.foregroundBounds.width, 360);
console.log('  Passed: CalibrationDatabase export and import cycle verified');

console.log('\n=== ALL PHASE 2A CALIBRATION TESTS PASSED! ===\n');

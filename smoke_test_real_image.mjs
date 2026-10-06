import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { ResidualAnalyzer } from './src/reconstruction/ResidualAnalyzer.ts';
import { reconstruct } from './src/reconstruction/MultiLayerReconstructor.ts';
import { DeterministicRenderer } from './src/core/Renderer.ts';

async function run() {
  console.log('=== PHASE 4.5: REAL-IMAGE SMOKE TEST & RESIDUAL DIAGNOSTICS ===');

  const sourcePath = 'D:/Khai Van/KhaiVan Data/Resource/Art/Seriane.png';
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }

  const outDir = path.resolve('smoke_artifacts');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Load image
  const img = await loadImage(sourcePath);
  const srcW = img.width;
  const srcH = img.height;
  console.log(`Source dimensions: ${srcW} x ${srcH}`);

  // 2. Deterministic crop to 21:31
  // For width 1638, height for 21:31 is round(1638 * 31 / 21) = 2418
  const cropW = srcW;
  const cropH = Math.round((srcW * 31) / 21);
  const cropX = 0;
  const cropY = Math.floor((srcH - cropH) / 2);
  console.log(`Crop window: (${cropX}, ${cropY}) ${cropW} x ${cropH} (Aspect ratio: ${(cropW / cropH).toFixed(5)})`);

  // 3. Processed dimensions: 210 x 310
  const procW = 210;
  const procH = 310;
  console.log(`Processed dimensions: ${procW} x ${procH}`);

  const targetCanvas = createCanvas(procW, procH);
  const tCtx = targetCanvas.getContext('2d');
  tCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, procW, procH);

  // Save target image
  const targetBuffer = targetCanvas.toBuffer('image/png');
  fs.writeFileSync(path.join(outDir, 'target_image.png'), targetBuffer);
  console.log(`Saved target image: ${path.join(outDir, 'target_image.png')}`);

  const targetImageData = tCtx.getImageData(0, 0, procW, procH);
  const targetRaster = {
    width: procW,
    height: procH,
    data: new Uint8Array(targetImageData.data.buffer)
  };

  // 4. DIAGNOSE RESIDUAL ANALYZER on raw real image vs empty canvas
  console.log('\n--- Diagnosing ResidualAnalyzer on Raw Real Image ---');
  const emptyCanvas = createCanvas(procW, procH);
  const eCtx = emptyCanvas.getContext('2d');
  const emptyImageData = eCtx.getImageData(0, 0, procW, procH);
  const emptyRaster = {
    width: procW,
    height: procH,
    data: new Uint8Array(emptyImageData.data.buffer)
  };

  // Analyze with default residual parameters
  // Note: we can run analyze with maxRegions: 500 to inspect the full distribution
  const analysisAll = ResidualAnalyzer.analyze(targetRaster, emptyRaster, {
    maxRegions: 2000,
    minRegionPixels: 1,
    minRegionMass: 0.1
  });

  const regions = analysisAll.regions;
  const totalPixels = procW * procH;
  console.log(`Total canvas pixels: ${totalPixels}`);
  console.log(`Total residual regions discovered: ${regions.length}`);

  // Analyze region size distribution
  const pixelCounts = regions.map(r => r.pixelCount).sort((a, b) => a - b);
  const minPixels = pixelCounts[0] || 0;
  const maxPixels = pixelCounts[pixelCounts.length - 1] || 0;
  const medianPixels = pixelCounts[Math.floor(pixelCounts.length / 2)] || 0;
  const meanPixels = (pixelCounts.reduce((acc, v) => acc + v, 0) / (pixelCounts.length || 1)).toFixed(1);

  // Histogram
  const buckets = {
    '< 4 px': 0,
    '4 - 10 px': 0,
    '11 - 50 px': 0,
    '51 - 200 px': 0,
    '201 - 1000 px': 0,
    '> 1000 px': 0
  };

  for (const count of pixelCounts) {
    if (count < 4) buckets['< 4 px']++;
    else if (count <= 10) buckets['4 - 10 px']++;
    else if (count <= 50) buckets['11 - 50 px']++;
    else if (count <= 200) buckets['51 - 200 px']++;
    else if (count <= 1000) buckets['201 - 1000 px']++;
    else buckets['> 1000 px']++;
  }

  console.log(`Region Size Distribution:`);
  console.log(`  Min size:    ${minPixels} px`);
  console.log(`  Max size:    ${maxPixels} px`);
  console.log(`  Median size: ${medianPixels} px`);
  console.log(`  Mean size:   ${meanPixels} px`);
  console.log(`Size Buckets:`, buckets);

  // Measure unique palette colors assigned
  const paletteColorCounts = new Map();
  for (const r of regions) {
    paletteColorCounts.set(r.closestPaletteHex, (paletteColorCounts.get(r.closestPaletteHex) || 0) + 1);
  }
  console.log(`Discrete palette categories populated: ${paletteColorCounts.size} / 26`);

  // 5. RUN FULL RECONSTRUCTION ENGINE DIRECTLY
  console.log('\n--- Running Milestone 4 Reconstruction on Real Image ---');
  const t0 = Date.now();
  // Using maxLayers = 20 for this quick smoke test (sufficient to see convergence and layer behavior)
  const result = reconstruct(targetRaster, {
    maxLayers: 20,
    minImprovement: 0.003,
    timeoutMs: 45000,
    onProgress: (p) => {
      console.log(`  Iter #${p.iteration} | Layers: ${p.currentLayerCount} | Loss: ${p.currentScore.totalLoss.toFixed(4)} | Imp: ${p.lastImprovement.toFixed(4)} | ${p.elapsedMs}ms`);
    }
  });
  const elapsed = Date.now() - t0;

  console.log('\n--- Reconstruction Result ---');
  console.log(`Runtime:                 ${elapsed}ms`);
  console.log(`Final layer count:       ${result.layers.length}`);
  console.log(`Initial verification loss: ${result.diagnostics.initialScore.totalLoss.toFixed(4)}`);
  console.log(`Final verification loss:   ${result.finalScore.totalLoss.toFixed(4)}`);
  console.log(`Stop reason:             ${result.diagnostics.stopReason}`);

  // Render and export final reconstructed image
  const outCanvas = createCanvas(procW, procH);
  const outCtx = outCanvas.getContext('2d');
  DeterministicRenderer.render(outCtx, result.layers, {
    width: procW,
    height: procH,
    backgroundColor: '#ffffff', // Render with neutral white background for clear visual comparison
    renderMode: 'mathematical'
  });
  const outBuffer = outCanvas.toBuffer('image/png');
  fs.writeFileSync(path.join(outDir, 'reconstructed_image.png'), outBuffer);
  console.log(`Saved reconstructed image: ${path.join(outDir, 'reconstructed_image.png')}`);

  // Also render without background (transparent)
  const transCanvas = createCanvas(procW, procH);
  const transCtx = transCanvas.getContext('2d');
  DeterministicRenderer.render(transCtx, result.layers, {
    width: procW,
    height: procH,
    backgroundColor: 'transparent',
    renderMode: 'mathematical'
  });
  fs.writeFileSync(path.join(outDir, 'reconstructed_transparent.png'), transCanvas.toBuffer('image/png'));

  // Save diagnostic layers JSON
  fs.writeFileSync(path.join(outDir, 'layers.json'), JSON.stringify(result.layers, null, 2));

  console.log('\n=== SMOKE TEST RUN COMPLETE ===');
}

run().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});

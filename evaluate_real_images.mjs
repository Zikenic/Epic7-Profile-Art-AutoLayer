import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  reconstruct,
  ResidualAnalyzer,
  renderLayersToRaster,
  ImageScorer
} from './src/reconstruction/index.ts';
import { DeterministicRenderer } from './src/core/Renderer.ts';

const outDir = path.resolve('phase5_artifacts');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

function saveCanvasPng(canvas, filePath) {
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(filePath, buf);
}

function rasterToCanvas(raster) {
  const canvas = createCanvas(raster.width, raster.height);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(raster.width, raster.height);
  imgData.data.set(raster.data);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function processImage(imagePath, label, cropAnchor = 'center') {
  console.log(`\n======================================================`);
  console.log(`Processing Real Image: ${label}`);
  console.log(`Path: ${imagePath}`);
  console.log(`======================================================`);

  const img = await loadImage(imagePath);
  const srcW = img.width;
  const srcH = img.height;
  console.log(`Source dimensions: ${srcW} x ${srcH}`);

  // Deterministic 21:31 crop
  const targetAspect = 21 / 31;
  let cropW, cropH, cropX, cropY;

  if (srcW / srcH > targetAspect) {
    // Image is wider than 21:31 -> crop width
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
    cropX = Math.floor((srcW - cropW) / 2);
    cropY = 0;
  } else {
    // Image is taller than 21:31 -> crop height
    cropW = srcW;
    cropH = Math.round(srcW / targetAspect);
    cropX = 0;
    cropY = Math.floor((srcH - cropH) / 2);
  }

  const procW = 210;
  const procH = 310;
  console.log(`Crop window: (${cropX}, ${cropY}) ${cropW} x ${cropH}`);
  console.log(`Processed dimensions: ${procW} x ${procH}`);

  const origCanvas = createCanvas(procW, procH);
  const oCtx = origCanvas.getContext('2d');
  oCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, procW, procH);

  const origImgData = oCtx.getImageData(0, 0, procW, procH);
  const origRaster = {
    width: procW,
    height: procH,
    data: new Uint8ClampedArray(origImgData.data.buffer)
  };

  // Export target_original.png
  const origPath = path.join(outDir, `${label}_target_original.png`);
  saveCanvasPng(origCanvas, origPath);
  console.log(`Saved original target: ${origPath}`);

  // Measure raw ResidualAnalyzer region count against empty canvas
  const emptyCanvas = createCanvas(procW, procH);
  const eCtx = emptyCanvas.getContext('2d');
  const emptyRaster = {
    width: procW,
    height: procH,
    data: new Uint8ClampedArray(eCtx.getImageData(0, 0, procW, procH).data.buffer)
  };

  const rawAnalysis = ResidualAnalyzer.analyze(origRaster, emptyRaster, {
    maxRegions: 5000,
    minRegionPixels: 1,
    minRegionMass: 0.1
  });
  console.log(`Raw exact-palette residual regions: ${rawAnalysis.regions.length}`);

  // 1. Run ImageSimplifier
  console.log(`\n--- Running ImageSimplifier ---`);
  const tSimp0 = Date.now();
  const simpResult = ImageSimplifier.simplify(origRaster, { level: 'MEDIUM' });
  const simpElapsed = Date.now() - tSimp0;

  const simpPath = path.join(outDir, `${label}_target_simplified.png`);
  const simpCanvas = rasterToCanvas(simpResult.simplified);
  saveCanvasPng(simpCanvas, simpPath);
  console.log(`Saved simplified target: ${simpPath}`);

  const d = simpResult.diagnostics;
  console.log(`Simplifier Diagnostics:`);
  console.log(`  Representative Colors (K): ${d.representativeColorCount}`);
  console.log(`  Mapped Palette Colors:     ${d.paletteColorCount} / 26`);
  console.log(`  Raw Component Count:       ${d.rawRegionCount}`);
  console.log(`  Simplified Region Count:   ${d.simplifiedRegionCount}`);
  console.log(`  Median Region Size:        ${d.medianRegionSize} px`);
  console.log(`  P90 Region Size:           ${d.p90RegionSize} px`);
  console.log(`  Largest Region Size:       ${d.largestRegionSize} px`);
  console.log(`  Regions Below Min Size:    ${d.regionsBelowMinSize}`);
  console.log(`  Preserved Detail Count:    ${d.preservedDetailCount}`);
  console.log(`  Quantization Error (Lab):  ${d.quantizationErrorLab.toFixed(3)}`);
  console.log(`  Runtime Breakdown:`);
  console.log(`    Smoothing:        ${d.runtimeBreakdownMs.smoothingMs}ms`);
  console.log(`    Color Clustering: ${d.runtimeBreakdownMs.clusteringMs}ms`);
  console.log(`    Palette Mapping:  ${d.runtimeBreakdownMs.paletteMappingMs}ms`);
  console.log(`    Extraction:       ${d.runtimeBreakdownMs.regionExtractionMs}ms`);
  console.log(`    Island Cleanup:   ${d.runtimeBreakdownMs.cleanupMs}ms`);
  console.log(`    Total Simplifier: ${d.runtimeBreakdownMs.totalMs}ms`);

  // 2. Run MultiLayerReconstructor on RAW Target
  console.log(`\n--- MultiLayerReconstructor on RAW Target ---`);
  const tRaw0 = Date.now();
  const rawRecon = reconstruct(origRaster, {
    maxLayers: 10,
    minImprovement: 0.003,
    minImprovementFloor: 0.0005,
    relativeImprovementFraction: 0.15,
    timeoutMs: 30000
  });
  const rawReconMs = Date.now() - tRaw0;
  console.log(`  Raw Pipeline Layers: ${rawRecon.layers.length}`);
  console.log(`  Raw Pipeline Runtime: ${rawReconMs}ms`);
  console.log(`  Raw Pipeline Initial Loss: ${rawRecon.diagnostics.initialScore.totalLoss.toFixed(4)}`);
  console.log(`  Raw Pipeline Final Loss:   ${rawRecon.finalScore.totalLoss.toFixed(4)}`);
  console.log(`  Raw Stop Reason: ${rawRecon.diagnostics.stopReason}`);

  const rawReconCanvas = createCanvas(procW, procH);
  DeterministicRenderer.render(rawReconCanvas.getContext('2d'), rawRecon.layers, {
    width: procW,
    height: procH,
    backgroundColor: '#ffffff'
  });
  saveCanvasPng(rawReconCanvas, path.join(outDir, `${label}_recon_raw.png`));

  // 3. Run MultiLayerReconstructor on SIMPLIFIED Target
  console.log(`\n--- MultiLayerReconstructor on SIMPLIFIED Target ---`);
  const tSimpRecon0 = Date.now();
  const simpRecon = reconstruct(simpResult.simplified, {
    maxLayers: 10,
    minImprovement: 0.003,
    minImprovementFloor: 0.0005,
    relativeImprovementFraction: 0.15,
    timeoutMs: 30000
  });
  const simpReconMs = Date.now() - tSimpRecon0;
  console.log(`  Simplified Pipeline Layers: ${simpRecon.layers.length}`);
  console.log(`  Simplified Pipeline Runtime: ${simpReconMs}ms`);
  console.log(`  Simplified Pipeline Initial Loss: ${simpRecon.diagnostics.initialScore.totalLoss.toFixed(4)}`);
  console.log(`  Simplified Pipeline Final Loss:   ${simpRecon.finalScore.totalLoss.toFixed(4)}`);
  console.log(`  Simplified Stop Reason: ${simpRecon.diagnostics.stopReason}`);

  // Evaluate simplified reconstruction against the original target as well
  const simpReconRender = renderLayersToRaster(simpRecon.layers, procW, procH, { backgroundColor: '#ffffff' });
  const scoreVsOriginal = ImageScorer.score(origRaster, simpReconRender);
  console.log(`  Simplified Layers Score vs ORIGINAL target: ${scoreVsOriginal.totalLoss.toFixed(4)}`);

  const simpReconCanvas = createCanvas(procW, procH);
  DeterministicRenderer.render(simpReconCanvas.getContext('2d'), simpRecon.layers, {
    width: procW,
    height: procH,
    backgroundColor: '#ffffff'
  });
  saveCanvasPng(simpReconCanvas, path.join(outDir, `${label}_recon_simplified.png`));

  return {
    label,
    sourceResolution: `${srcW} x ${srcH}`,
    processedResolution: `${procW} x ${procH}`,
    rawExactPaletteRegions: rawAnalysis.regions.length,
    diagnostics: d,
    rawRecon: {
      layers: rawRecon.layers.length,
      runtimeMs: rawReconMs,
      initialLoss: rawRecon.diagnostics.initialScore.totalLoss,
      finalLoss: rawRecon.finalScore.totalLoss,
      stopReason: rawRecon.diagnostics.stopReason
    },
    simpRecon: {
      layers: simpRecon.layers.length,
      runtimeMs: simpReconMs,
      initialLoss: simpRecon.diagnostics.initialScore.totalLoss,
      finalLoss: simpRecon.finalScore.totalLoss,
      lossVsOriginal: scoreVsOriginal.totalLoss,
      stopReason: simpRecon.diagnostics.stopReason
    }
  };
}

async function run() {
  const img1Path = 'D:/Khai Van/KhaiVan Data/Resource/Art/Seriane.png';
  const img2Path = 'D:/Khai Van/KhaiVan Data/Resource/Images/wp15313950.jpg';

  const res1 = await processImage(img1Path, 'image1_seriane');
  const res2 = await processImage(img2Path, 'image2_wallpaper');

  console.log('\n======================================================');
  console.log('SUMMARY COMPARISON REPORT');
  console.log('======================================================');
  console.log(JSON.stringify({ image1: res1, image2: res2 }, null, 2));
}

run().catch(err => {
  console.error('Real image evaluation failed:', err);
  process.exit(1);
});

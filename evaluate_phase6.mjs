import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  reconstruct,
  renderLayersToRaster,
  ImageScorer,
  createProjectFromLayers
} from './src/reconstruction/index.ts';
import { DeterministicRenderer } from './src/core/Renderer.ts';

const outDir = path.resolve('phase6');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const brainArtifactsDir = 'C:/Users/KHAI/.gemini/antigravity/brain/67432ea7-76bb-4a1b-a4b8-92d23d404957';

function saveCanvasPng(canvas, filePath) {
  const buf = canvas.toBuffer('image/png');
  fs.writeFileSync(filePath, buf);
  // Also copy to brain artifacts dir if file basename matches
  try {
    const baseName = path.basename(filePath);
    fs.writeFileSync(path.join(brainArtifactsDir, baseName), buf);
  } catch {}
}

function rasterToCanvas(raster) {
  const canvas = createCanvas(raster.width, raster.height);
  const ctx = canvas.getContext('2d');
  const imgData = ctx.createImageData(raster.width, raster.height);
  imgData.data.set(raster.data);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

async function processImagePhase6(imagePath, label, maxLayers = 35) {
  console.log(`\n======================================================`);
  console.log(`Phase 6 Evaluation: ${label}`);
  console.log(`Source Path: ${imagePath}`);
  console.log(`======================================================`);

  const img = await loadImage(imagePath);
  const srcW = img.width;
  const srcH = img.height;

  // Deterministic 21:31 crop
  const targetAspect = 21 / 31;
  let cropW, cropH, cropX, cropY;

  if (srcW / srcH > targetAspect) {
    cropH = srcH;
    cropW = Math.round(srcH * targetAspect);
    cropX = Math.floor((srcW - cropW) / 2);
    cropY = 0;
  } else {
    cropW = srcW;
    cropH = Math.round(srcW / targetAspect);
    cropX = 0;
    cropY = Math.floor((srcH - cropH) / 2);
  }

  const procW = 210;
  const procH = 310;
  console.log(`Source Dimensions:    ${srcW} x ${srcH}`);
  console.log(`Processed Dimensions: ${procW} x ${procH}`);

  const origCanvas = createCanvas(procW, procH);
  const oCtx = origCanvas.getContext('2d');
  oCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, procW, procH);

  const origImgData = oCtx.getImageData(0, 0, procW, procH);
  const origRaster = {
    width: procW,
    height: procH,
    data: new Uint8ClampedArray(origImgData.data.buffer)
  };

  // 1. ImageSimplifier Preprocessing
  console.log(`\n[Step 1] Running Phase 5 ImageSimplifier...`);
  const tSimp0 = Date.now();
  const simpResult = ImageSimplifier.simplify(origRaster, { level: 'MEDIUM' });
  const simpElapsed = Date.now() - tSimp0;

  const simpCanvas = rasterToCanvas(simpResult.simplified);
  const simpPngPath = path.join(outDir, `${label}_simplified.png`);
  saveCanvasPng(simpCanvas, simpPngPath);
  console.log(`  Simplified Image Saved: ${simpPngPath}`);
  console.log(`  Regions in RegionGraph: ${simpResult.regions.length}`);
  console.log(`  Palette Colors Used:    ${simpResult.diagnostics.paletteColorCount} / 26`);
  console.log(`  Simplification Runtime: ${simpElapsed}ms`);

  // 2. Region-Driven Reconstruction
  console.log(`\n[Step 2] Running Phase 6 Region-Driven Reconstruction (budget: ${maxLayers} layers)...`);
  const tRecon0 = Date.now();

  const checkpointRenders = new Map();

  const res = reconstruct(origRaster, {
    regionGraph: simpResult.regionGraph,
    maxLayers,
    minImprovement: 0.002,
    minImprovementFloor: 0.0003,
    relativeImprovementFraction: 0.12,
    backgroundMode: 'reconstruct',
    timeoutMs: 90000,
    checkpoints: [10, 25, 50],
    onProgress: (p) => {
      if ([10, 25, 50].includes(p.currentLayerCount)) {
        console.log(`  Reached checkpoint ${p.currentLayerCount} layers (elapsed: ${(p.elapsedMs / 1000).toFixed(1)}s, loss: ${p.currentScore.totalLoss.toFixed(4)})`);
      }
    }
  });

  const reconElapsed = Date.now() - tRecon0;
  console.log(`\nReconstruction Finished in ${(reconElapsed / 1000).toFixed(2)}s`);
  console.log(`  Final Layer Count: ${res.layers.length}`);
  console.log(`  Stop Reason:       ${res.diagnostics.stopReason}`);

  // Authoritative renders
  const reconCanvas = createCanvas(procW, procH);
  DeterministicRenderer.render(reconCanvas.getContext('2d'), res.layers, {
    width: procW,
    height: procH,
    backgroundColor: '#ffffff'
  });
  const reconPngPath = path.join(outDir, `${label}_reconstructed.png`);
  saveCanvasPng(reconCanvas, reconPngPath);
  console.log(`  Reconstructed PNG Saved: ${reconPngPath}`);

  // Save .json ProjectData
  const projectData = createProjectFromLayers(res.layers, `Phase6_${label}`);
  const jsonPath = path.join(outDir, `${label}_layers.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(projectData, null, 2));
  try {
    fs.writeFileSync(path.join(brainArtifactsDir, `${label}_layers.json`), JSON.stringify(projectData, null, 2));
  } catch {}
  console.log(`  Exported Layers JSON:    ${jsonPath}`);

  // Render Checkpoints at 10, 25 layers if reached
  for (const cpCount of [10, 25, 50]) {
    if (res.layers.length >= cpCount) {
      const cpLayers = res.layers.slice(0, cpCount);
      const cpCanvas = createCanvas(procW, procH);
      DeterministicRenderer.render(cpCanvas.getContext('2d'), cpLayers, {
        width: procW,
        height: procH,
        backgroundColor: '#ffffff'
      });
      const cpPngPath = path.join(outDir, `${label}_checkpoint_${cpCount}.png`);
      saveCanvasPng(cpCanvas, cpPngPath);
      console.log(`  Exported Checkpoint ${cpCount} PNG: ${cpPngPath}`);
    }
  }

  // 3. Loss Evaluation against both simplified & original reference
  const finalReconRaster = renderLayersToRaster(res.layers, procW, procH, { backgroundColor: '#ffffff' });
  const lossVsSimplified = ImageScorer.score(simpResult.simplified, finalReconRaster);
  const lossVsOriginal = ImageScorer.score(origRaster, finalReconRaster);

  console.log(`\nQuantitative Evaluation:`);
  console.log(`  Initial Loss vs Original:     ${res.diagnostics.initialScore.totalLoss.toFixed(4)}`);
  console.log(`  Final Loss vs SIMPLIFIED:     ${lossVsSimplified.totalLoss.toFixed(4)} (Color: ${lossVsSimplified.colorLoss.toFixed(4)}, Edge: ${lossVsSimplified.edgeLoss.toFixed(4)})`);
  console.log(`  Final Loss vs ORIGINAL RAW:   ${lossVsOriginal.totalLoss.toFixed(4)} (Color: ${lossVsOriginal.colorLoss.toFixed(4)}, Edge: ${lossVsOriginal.edgeLoss.toFixed(4)})`);

  const timing = res.diagnostics.timingBreakdownMs || {
    candidateGenMs: 0,
    fastEvalMs: 0,
    verificationMs: 0,
    polishMs: 0,
    totalMs: reconElapsed
  };
  console.log(`\nTiming & Profiling Breakdown:`);
  console.log(`  Candidate Generation: ${timing.candidateGenMs}ms (${((timing.candidateGenMs / reconElapsed) * 100).toFixed(1)}%)`);
  console.log(`  Fast Candidate Eval:  ${timing.fastEvalMs}ms (${((timing.fastEvalMs / reconElapsed) * 100).toFixed(1)}%)`);
  console.log(`  Authoritative Verif:  ${timing.verificationMs}ms (${((timing.verificationMs / reconElapsed) * 100).toFixed(1)}%)`);
  console.log(`  Coordinate Polish:    ${timing.polishMs}ms (${((timing.polishMs / reconElapsed) * 100).toFixed(1)}%)`);
  console.log(`  Total Recon Time:     ${reconElapsed}ms`);
  console.log(`  Avg Time per Layer:   ${(reconElapsed / Math.max(1, res.layers.length)).toFixed(0)}ms/layer`);

  console.log(`\nCandidate Count Reduction:`);
  console.log(`  Phase 4.5 Residual Regions: ~2,300+ fragmented pixel islands`);
  console.log(`  Phase 6 RegionGraph Regions: ${simpResult.regions.length} coherent macro-regions`);
  console.log(`  Reduction Ratio:            ${(((2300 - simpResult.regions.length) / 2300) * 100).toFixed(1)}% reduction in candidate space`);

  return {
    label,
    srcW,
    srcH,
    procW,
    procH,
    simpElapsed,
    reconElapsed,
    regionsCount: simpResult.regions.length,
    paletteColorsCount: simpResult.diagnostics.paletteColorCount,
    layerCount: res.layers.length,
    lossVsSimplified: lossVsSimplified.totalLoss,
    lossVsOriginal: lossVsOriginal.totalLoss,
    initialLoss: res.diagnostics.initialScore.totalLoss,
    stopReason: res.diagnostics.stopReason,
    timing,
    checkpoints: res.diagnostics.checkpoints || []
  };
}

async function runAll() {
  const img1Path = 'D:/Khai Van/KhaiVan Data/Resource/Art/Seriane.png';
  const img2Path = 'D:/Khai Van/KhaiVan Data/Resource/Images/wp15313950.jpg';

  const res1 = await processImagePhase6(img1Path, 'seriane', 25);
  const res2 = await processImagePhase6(img2Path, 'wallpaper', 25);

  console.log(`\n======================================================`);
  console.log(`PHASE 6 REAL IMAGE EVALUATION SUMMARY`);
  console.log(`======================================================`);
  console.table([
    {
      Image: 'Seriane',
      'Original Size': `${res1.srcW}x${res1.srcH}`,
      Regions: res1.regionsCount,
      Layers: res1.layerCount,
      'Recon Time': `${(res1.reconElapsed / 1000).toFixed(1)}s`,
      'Per Layer': `${(res1.reconElapsed / res1.layerCount).toFixed(0)}ms`,
      'Loss vs Simp': res1.lossVsSimplified.toFixed(4),
      'Loss vs Orig': res1.lossVsOriginal.toFixed(4)
    },
    {
      Image: 'Wallpaper',
      'Original Size': `${res2.srcW}x${res2.srcH}`,
      Regions: res2.regionsCount,
      Layers: res2.layerCount,
      'Recon Time': `${(res2.reconElapsed / 1000).toFixed(1)}s`,
      'Per Layer': `${(res2.reconElapsed / res2.layerCount).toFixed(0)}ms`,
      'Loss vs Simp': res2.lossVsSimplified.toFixed(4),
      'Loss vs Orig': res2.lossVsOriginal.toFixed(4)
    }
  ]);
}

runAll().catch(err => {
  console.error('Fatal error in evaluate_phase6:', err);
  process.exit(1);
});

import fs from 'node:fs';
import path from 'node:path';
import { loadImage, createCanvas } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  reconstruct,
  renderLayersToRaster,
  ImageScorer
} from './src/reconstruction/index.ts';

const outDir = path.resolve('phase7');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const brainArtifactsDir = 'C:/Users/KHAI/.gemini/antigravity/brain/67432ea7-76bb-4a1b-a4b8-92d23d404957';

function saveFile(filename, bufOrStr) {
  fs.writeFileSync(path.join(outDir, filename), bufOrStr);
  try {
    fs.writeFileSync(path.join(brainArtifactsDir, filename), bufOrStr);
  } catch {}
}

async function runEvaluation(name, imagePath) {
  console.log(`\n======================================================`);
  console.log(`Evaluating Real Image: ${name} (${imagePath})`);
  console.log(`======================================================`);

  if (!fs.existsSync(imagePath)) {
    console.error(`Error: Image file not found at ${imagePath}`);
    return null;
  }

  const img = await loadImage(imagePath);
  console.log(`Source dimensions: ${img.width}x${img.height}`);

  // Deterministic 21:31 center crop at native 210x310
  const procW = 210, procH = 310;
  const targetAspect = 21 / 31;
  const canvas = createCanvas(procW, procH);
  const ctx = canvas.getContext('2d');

  let cropW, cropH, cropX, cropY;
  const imgAspect = img.width / img.height;
  if (imgAspect > targetAspect) {
    cropH = img.height;
    cropW = Math.round(img.height * targetAspect);
    cropX = Math.floor((img.width - cropW) / 2);
    cropY = 0;
  } else {
    cropW = img.width;
    cropH = Math.round(img.width / targetAspect);
    cropX = 0;
    cropY = Math.floor((img.height - cropH) / 2);
  }

  ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, procW, procH);
  const origRaster = {
    width: procW,
    height: procH,
    data: new Uint8ClampedArray(ctx.getImageData(0, 0, procW, procH).data.buffer)
  };

  // Export target image
  saveFile(`${name}_target.png`, canvas.toBuffer('image/png'));

  // Run Phase 5 ImageSimplifier
  const tSimp0 = Date.now();
  const simpResult = ImageSimplifier.simplify(origRaster, { level: 'MEDIUM', seed: 42 });
  const simpTimeMs = Date.now() - tSimp0;

  console.log(`ImageSimplifier: ${simpResult.regionGraph.regions.length} coherent regions in ${simpTimeMs}ms`);

  // Export simplified target
  const simpCanvas = createCanvas(procW, procH);
  const simpCtx = simpCanvas.getContext('2d');
  const simpImgData = simpCtx.createImageData(procW, procH);
  simpImgData.data.set(simpResult.simplified.data);
  simpCtx.putImageData(simpImgData, 0, 0);
  saveFile(`${name}_simplified.png`, simpCanvas.toBuffer('image/png'));

  // Checkpoints to capture
  const requestedCheckpoints = [10, 25, 50, 100, 130];
  const capturedSnapshots = new Set();

  const tRecon0 = Date.now();
  const reconResult = reconstruct(origRaster, {
    regionGraph: simpResult.regionGraph,
    maxLayers: 130,
    minImprovement: 0.0005,
    minImprovementFloor: 0.0001,
    backgroundMode: 'reconstruct',
    topKFinalists: 3,
    checkpoints: requestedCheckpoints,
    timeoutMs: 120000,
    onProgress: (prog) => {
      if (requestedCheckpoints.includes(prog.currentLayerCount) && !capturedSnapshots.has(prog.currentLayerCount)) {
        capturedSnapshots.add(prog.currentLayerCount);
        console.log(`  -> Checkpoint reached: ${prog.currentLayerCount} layers (globalLoss: ${prog.currentScore.totalLoss.toFixed(4)}, elapsed: ${prog.elapsedMs}ms)`);
      }
    }
  });
  const reconTimeMs = Date.now() - tRecon0;

  console.log(`\nReconstruction finished in ${reconTimeMs}ms:`);
  console.log(`  Layers produced: ${reconResult.layers.length}`);
  console.log(`  Stop reason: ${reconResult.diagnostics.stopReason}`);
  console.log(`  Initial Global Loss: ${reconResult.diagnostics.initialScore.totalLoss.toFixed(4)}`);
  console.log(`  Final Global Loss:   ${reconResult.finalScore.totalLoss.toFixed(4)}`);
  console.log(`  Final Foreground Loss: ${reconResult.diagnostics.foregroundWeightedLoss.toFixed(4)}`);

  // Render snapshots for every checkpoint reached
  for (const cp of reconResult.diagnostics.checkpoints) {
    const cpLayers = reconResult.layers.slice(0, cp.layerCount);
    const cpRaster = renderLayersToRaster(cpLayers, procW, procH, { backgroundColor: '#141721' });
    const cpCanvas = createCanvas(procW, procH);
    const cpCtx = cpCanvas.getContext('2d');
    const cpImgData = cpCtx.createImageData(procW, procH);
    cpImgData.data.set(cpRaster.data);
    cpCtx.putImageData(cpImgData, 0, 0);
    const cpFilename = `${name}_${cp.layerCount}.png`;
    saveFile(cpFilename, cpCanvas.toBuffer('image/png'));
    console.log(`  Saved checkpoint image: ${cpFilename} (loss: ${cp.globalLoss.toFixed(4)}, fgLoss: ${cp.foregroundLoss?.toFixed(4) ?? 'N/A'})`);
  }

  // Export final reconstructed image
  const finalRaster = renderLayersToRaster(reconResult.layers, procW, procH, { backgroundColor: '#141721' });
  const finalCanvas = createCanvas(procW, procH);
  const finalCtx = finalCanvas.getContext('2d');
  const finalImgData = finalCtx.createImageData(procW, procH);
  finalImgData.data.set(finalRaster.data);
  finalCtx.putImageData(finalImgData, 0, 0);
  saveFile(`${name}_reconstructed.png`, finalCanvas.toBuffer('image/png'));

  // Export layers metadata
  saveFile(
    `${name}_layers.json`,
    JSON.stringify(
      {
        image: name,
        layerCount: reconResult.layers.length,
        globalLoss: reconResult.finalScore.totalLoss,
        foregroundLoss: reconResult.diagnostics.foregroundWeightedLoss,
        timingBreakdownMs: reconResult.diagnostics.timingBreakdownMs,
        checkpoints: reconResult.diagnostics.checkpoints,
        layers: reconResult.layers
      },
      null,
      2
    )
  );

  return {
    name,
    layerCount: reconResult.layers.length,
    globalLoss: reconResult.finalScore.totalLoss,
    foregroundLoss: reconResult.diagnostics.foregroundWeightedLoss,
    reconTimeMs,
    checkpoints: reconResult.diagnostics.checkpoints,
    timing: reconResult.diagnostics.timingBreakdownMs,
    stopReason: reconResult.diagnostics.stopReason
  };
}

async function main() {
  const serianePath = 'D:/Khai Van/KhaiVan Data/Resource/Art/Seriane.png';
  const wallpaperPath = 'D:/Khai Van/KhaiVan Data/Resource/Images/wp15313950.jpg';

  const r1 = await runEvaluation('seriane', serianePath);
  const r2 = await runEvaluation('wallpaper', wallpaperPath);

  console.log('\n======================================================');
  console.log('SUMMARY OF PHASE 7 REAL-IMAGE RECONSTRUCTION');
  console.log('======================================================');
  if (r1) {
    console.log(`Seriane:`);
    console.log(`  Layers: ${r1.layerCount}`);
    console.log(`  Global Loss: ${r1.globalLoss.toFixed(4)}`);
    console.log(`  Foreground Loss: ${r1.foregroundLoss.toFixed(4)}`);
    console.log(`  Runtime: ${(r1.reconTimeMs / 1000).toFixed(1)}s`);
    console.log(`  Checkpoints: ${JSON.stringify(r1.checkpoints)}`);
    console.log(`  Timing Breakdown: ${JSON.stringify(r1.timing)}`);
  }
  if (r2) {
    console.log(`Wallpaper:`);
    console.log(`  Layers: ${r2.layerCount}`);
    console.log(`  Global Loss: ${r2.globalLoss.toFixed(4)}`);
    console.log(`  Foreground Loss: ${r2.foregroundLoss.toFixed(4)}`);
    console.log(`  Runtime: ${(r2.reconTimeMs / 1000).toFixed(1)}s`);
    console.log(`  Checkpoints: ${JSON.stringify(r2.checkpoints)}`);
    console.log(`  Timing Breakdown: ${JSON.stringify(r2.timing)}`);
  }
}

main().catch(err => {
  console.error('Fatal error during evaluation:', err);
  process.exit(1);
});

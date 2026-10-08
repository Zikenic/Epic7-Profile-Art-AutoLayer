import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  reconstruct,
  renderLayersToRaster
} from './src/reconstruction/index.ts';

const ARTIFACTS_DIR = 'C:/Users/KHAI/.gemini/antigravity/brain/67432ea7-76bb-4a1b-a4b8-92d23d404957';
const PHASE8_DIR = path.resolve('./phase8');
if (!fs.existsSync(PHASE8_DIR)) fs.mkdirSync(PHASE8_DIR, { recursive: true });

function copyToArtifacts(filename) {
  const src = path.join(PHASE8_DIR, filename);
  const dst = path.join(ARTIFACTS_DIR, filename);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dst);
  }
}

function saveCanvas(canvas, filename) {
  const filePath = path.join(PHASE8_DIR, filename);
  fs.writeFileSync(filePath, canvas.toBuffer('image/png'));
  copyToArtifacts(filename);
  console.log(`  Saved: ${filePath}`);
}

async function runImage3() {
  console.log('=== Running Phase 8: Image 3 (TheFatRat Rise Up) Reconstruction ===\n');

  const imgPath = 'D:/Khai Van/KhaiVan Data/Resource/Images/164938-thefatrat_rise_up-rise_up-mayday-the_calling-mayday_feat_laura_brehm-x750.jpg';
  const img = await loadImage(imgPath);
  console.log(`Loaded image: ${img.width}x${img.height}`);

  const targetW = 210, targetH = 310;
  const targetCanvas = createCanvas(targetW, targetH);
  const targetCtx = targetCanvas.getContext('2d');

  // Deterministic 21:31 crop centered
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
  console.log(`Crop window: (${cropX}, ${cropY}) ${cropW}x${cropH}`);
  targetCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, targetW, targetH);
  saveCanvas(targetCanvas, 'image3_target.png');

  const targetImgData = targetCtx.getImageData(0, 0, targetW, targetH);
  const targetRaster = {
    width: targetW,
    height: targetH,
    data: new Uint8ClampedArray(targetImgData.data.buffer)
  };

  // Run Simplification
  console.log('Step 1: Running ImageSimplifier...');
  const tSimp0 = Date.now();
  const simp = ImageSimplifier.simplify(targetRaster, {
    level: 'MEDIUM',
    seed: 42
  });
  console.log(`  Simplifier completed in ${Date.now() - tSimp0}ms`);
  console.log(`  Raw regions: ${simp.diagnostics.rawRegionCount}`);
  console.log(`  Simplified regions: ${simp.diagnostics.simplifiedRegionCount}`);

  // Save simplified image
  const simpCanvas = createCanvas(targetW, targetH);
  const simpCtx = simpCanvas.getContext('2d');
  const simpImgData = simpCtx.createImageData(targetW, targetH);
  simpImgData.data.set(simp.simplified.data);
  simpCtx.putImageData(simpImgData, 0, 0);
  saveCanvas(simpCanvas, 'image3_simplified.png');

  // Save foreground mask
  const fgCanvas = createCanvas(targetW, targetH);
  const fgCtx = fgCanvas.getContext('2d');
  const fgImgData = fgCtx.createImageData(targetW, targetH);
  const fgRegions = simp.regions.filter(r => !r.isBackground);
  console.log(`  Foreground regions: ${fgRegions.length}`);

  for (let i = 0; i < targetW * targetH; i++) {
    const rIdx = simp.regionGraph.pixelRegionMap[i];
    const r = simp.regions[rIdx];
    const byteIdx = i * 4;
    if (r && !r.isBackground) {
      fgImgData.data[byteIdx] = 255;
      fgImgData.data[byteIdx + 1] = 255;
      fgImgData.data[byteIdx + 2] = 255;
      fgImgData.data[byteIdx + 3] = 255;
    } else {
      fgImgData.data[byteIdx] = 0;
      fgImgData.data[byteIdx + 1] = 0;
      fgImgData.data[byteIdx + 2] = 0;
      fgImgData.data[byteIdx + 3] = 255;
    }
  }
  fgCtx.putImageData(fgImgData, 0, 0);
  saveCanvas(fgCanvas, 'image3_fg_mask.png');

  // Save RegionGraph visualization
  const rgCanvas = createCanvas(targetW, targetH);
  const rgCtx = rgCanvas.getContext('2d');
  const rgImgData = rgCtx.createImageData(targetW, targetH);
  const regionColors = simp.regions.map((_, idx) => {
    const h = (idx * 137.5) % 360;
    return `hsl(${h}, 75%, 55%)`;
  });
  const tmpC = createCanvas(1, 1);
  const tmpCtx = tmpC.getContext('2d');
  const parsedColors = regionColors.map(colorStr => {
    tmpCtx.fillStyle = colorStr;
    tmpCtx.fillRect(0, 0, 1, 1);
    const pix = tmpCtx.getImageData(0, 0, 1, 1).data;
    return [pix[0], pix[1], pix[2]];
  });

  for (let i = 0; i < targetW * targetH; i++) {
    const rIdx = simp.regionGraph.pixelRegionMap[i];
    const byteIdx = i * 4;
    const rgb = parsedColors[rIdx] || [128, 128, 128];
    rgImgData.data[byteIdx] = rgb[0];
    rgImgData.data[byteIdx + 1] = rgb[1];
    rgImgData.data[byteIdx + 2] = rgb[2];
    rgImgData.data[byteIdx + 3] = 255;
  }
  rgCtx.putImageData(rgImgData, 0, 0);
  saveCanvas(rgCanvas, 'image3_region_graph.png');

  // Run Reconstruction up to 30 layers
  console.log('\nStep 2: Running MultiLayerReconstructor (maxLayers: 30)...');
  const checkpointLayers = [1, 5, 10, 20, 30];

  function saveSnapshot(layers, count) {
    const snapRaster = renderLayersToRaster(layers, targetW, targetH, { backgroundColor: 'transparent' });
    const snapCanvas = createCanvas(targetW, targetH);
    const snapCtx = snapCanvas.getContext('2d');
    const snapImgData = snapCtx.createImageData(targetW, targetH);
    snapImgData.data.set(snapRaster.data);
    snapCtx.putImageData(snapImgData, 0, 0);
    const name = `image3_layer_${String(count).padStart(2, '0')}.png`;
    saveCanvas(snapCanvas, name);
  }

  const tRecon0 = Date.now();
  const recon = reconstruct(targetRaster, {
    regionGraph: simp.regionGraph,
    maxLayers: 30,
    minImprovement: 0.001,
    minImprovementFloor: 0.0002,
    maxCandidatesPerIteration: 64,
    timeoutMs: 300000,
    seed: 42,
    checkpoints: [1, 5, 10, 20, 30],
    onProgress: (p) => {
      console.log(`  [Iter ${p.iteration}] Layers: ${p.currentLayerCount}, Global Loss: ${p.currentScore.totalLoss.toFixed(4)}, Last Imp: ${p.lastImprovement.toFixed(4)}, Elapsed: ${p.elapsedMs}ms`);
    }
  });

  const reconElapsed = Date.now() - tRecon0;
  console.log(`\nReconstruction finished in ${reconElapsed}ms`);
  console.log(`Final layer count: ${recon.layers.length}`);
  console.log(`Final score: ${recon.finalScore.totalLoss.toFixed(4)}`);
  console.log(`Foreground loss: ${recon.diagnostics.foregroundWeightedLoss.toFixed(4)}`);
  console.log(`Stop reason: ${recon.diagnostics.stopReason}`);
  console.log(`Timing breakdown:`, recon.diagnostics.timingBreakdownMs);

  // Save checkpoints
  for (const targetCount of checkpointLayers) {
    if (recon.layers.length >= targetCount) {
      saveSnapshot(recon.layers.slice(0, targetCount), targetCount);
    }
  }

  // Save final reconstruction
  const finalRaster = renderLayersToRaster(recon.layers, targetW, targetH, { backgroundColor: 'transparent' });
  const finalCanvas = createCanvas(targetW, targetH);
  const finalCtx = finalCanvas.getContext('2d');
  const finalImgData = finalCtx.createImageData(targetW, targetH);
  finalImgData.data.set(finalRaster.data);
  finalCtx.putImageData(finalImgData, 0, 0);
  saveCanvas(finalCanvas, 'image3_reconstructed.png');

  // Save 5-panel contact sheet
  const panelW = targetW, panelH = targetH;
  const sheetCanvas = createCanvas(panelW * 5 + 40, panelH + 60);
  const sheetCtx = sheetCanvas.getContext('2d');
  sheetCtx.fillStyle = '#1e1e24';
  sheetCtx.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height);

  const panels = [
    { title: '1. Target', canvas: targetCanvas },
    { title: '2. Simplified', canvas: simpCanvas },
    { title: '3. FG Mask', canvas: fgCanvas },
    { title: '4. RegionGraph', canvas: rgCanvas },
    { title: `5. Recon (${recon.layers.length}L)`, canvas: finalCanvas }
  ];

  sheetCtx.font = 'bold 13px sans-serif';
  sheetCtx.textAlign = 'center';

  panels.forEach((p, idx) => {
    const px = 10 + idx * (panelW + 8);
    const py = 35;
    sheetCtx.drawImage(p.canvas, px, py);
    sheetCtx.fillStyle = '#e0e0e0';
    sheetCtx.fillText(p.title, px + panelW / 2, 22);
  });

  saveCanvas(sheetCanvas, 'image3_contact_sheet.png');

  // Print layer table
  console.log('\n--- Layer Records ---');
  console.log('Idx | Shape | Color | Pos (x, y) | Scale (sx, sy) | Rot | FastImp | VerImp');
  recon.diagnostics.history.forEach(h => {
    console.log(`${String(h.iteration).padStart(3)} | ${h.shapeAsset.padEnd(14)} | ${h.color} | (${h.x.toFixed(3)}, ${h.y.toFixed(3)}) | (${h.scaleX.toFixed(3)}, ${h.scaleY.toFixed(3)}) | ${String(h.rotation).padStart(3)}° | ${h.fastImprovement.toFixed(4)} | ${h.verifiedImprovement.toFixed(4)}`);
  });

  return recon;
}

runImage3().catch(err => {
  console.error(err);
  process.exit(1);
});

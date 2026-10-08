import fs from 'node:fs';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  ImageSimplifier,
  reconstruct,
  renderLayersToRaster,
  ImageScorer
} from './src/reconstruction/index.ts';

const outDir = path.resolve('phase8');
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

// Distinct high-contrast palette for RegionGraph visualization
const DEBUG_REGION_COLORS = [
  '#e6194B', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6',
  '#bfef45', '#fabed4', '#469990', '#dcbeff', '#9A6324', '#fffac8', '#800000', '#aaffc3',
  '#808000', '#ffd8b1', '#000075', '#a9a9a9', '#00ced1', '#ff1493', '#7b68ee', '#32cd32'
];

async function diagnoseImage(name, imagePath) {
  console.log(`\n======================================================`);
  console.log(`Phase 8 Input Diagnosis: ${name}`);
  console.log(`Path: ${imagePath}`);
  console.log(`======================================================`);

  const img = await loadImage(imagePath);
  const srcW = img.width;
  const srcH = img.height;
  const targetAspect = 21 / 31;
  const imgAspect = srcW / srcH;

  let cropW, cropH, cropX, cropY;
  if (imgAspect > targetAspect) {
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

  const procW = 210, procH = 310;
  const targetCanvas = createCanvas(procW, procH);
  const tCtx = targetCanvas.getContext('2d');
  tCtx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, procW, procH);
  const targetBuffer = targetCanvas.toBuffer('image/png');
  saveFile(`${name}_target.png`, targetBuffer);

  const targetRaster = {
    width: procW,
    height: procH,
    data: new Uint8ClampedArray(tCtx.getImageData(0, 0, procW, procH).data.buffer)
  };

  // Run simplification across all 4 levels to collect region statistics
  const levels = ['VERY_COARSE', 'COARSE', 'MEDIUM', 'FINE'];
  const levelStats = {};

  for (const lvl of levels) {
    const resLvl = ImageSimplifier.simplify(targetRaster, { level: lvl, seed: 42 });
    const nonBg = resLvl.regionGraph.regions.filter(r => !r.isBackground);
    const sumFgPixels = nonBg.reduce((sum, r) => sum + r.pixelCount, 0);
    levelStats[lvl] = {
      totalRegions: resLvl.regionGraph.regions.length,
      nonBgRegions: nonBg.length,
      sumFgPixels,
      largestRegionSize: resLvl.diagnostics.largestRegionSize,
      quantizationErrorLab: resLvl.diagnostics.quantizationErrorLab
    };
  }

  // Base simplification result (MEDIUM as currently used in baseline)
  const simpResult = ImageSimplifier.simplify(targetRaster, { level: 'MEDIUM', seed: 42 });

  // 1. Simplified Target PNG
  const simpCanvas = createCanvas(procW, procH);
  const sCtx = simpCanvas.getContext('2d');
  const sImgData = sCtx.createImageData(procW, procH);
  sImgData.data.set(simpResult.simplified.data);
  sCtx.putImageData(sImgData, 0, 0);
  const simpBuffer = simpCanvas.toBuffer('image/png');
  saveFile(`${name}_simplified.png`, simpBuffer);

  // 2. Foreground Mask PNG
  const fgCanvas = createCanvas(procW, procH);
  const fgCtx = fgCanvas.getContext('2d');
  const fgImgData = fgCtx.createImageData(procW, procH);
  const fgData = fgImgData.data;

  let fgPixelCount = 0;
  let bgPixelCount = 0;
  let fgMinX = procW, fgMaxX = 0, fgMinY = procH, fgMaxY = 0;

  for (let y = 0; y < procH; y++) {
    for (let x = 0; x < procW; x++) {
      const idx = y * procW + x;
      const rIdx = simpResult.regionGraph.pixelRegionMap[idx];
      const r = simpResult.regionGraph.regions[rIdx];
      const isBg = r ? r.isBackground : true;

      const pByte = idx * 4;
      if (!isBg) {
        fgPixelCount++;
        fgData[pByte] = 255;
        fgData[pByte + 1] = 255;
        fgData[pByte + 2] = 255;
        fgData[pByte + 3] = 255;
        if (x < fgMinX) fgMinX = x;
        if (x > fgMaxX) fgMaxX = x;
        if (y < fgMinY) fgMinY = y;
        if (y > fgMaxY) fgMaxY = y;
      } else {
        bgPixelCount++;
        fgData[pByte] = 0;
        fgData[pByte + 1] = 0;
        fgData[pByte + 2] = 0;
        fgData[pByte + 3] = 255;
      }
    }
  }
  fgCtx.putImageData(fgImgData, 0, 0);
  const fgMaskBuffer = fgCanvas.toBuffer('image/png');
  saveFile(`${name}_fg_mask.png`, fgMaskBuffer);

  // 3. RegionGraph Visualization PNG
  const rgCanvas = createCanvas(procW, procH);
  const rgCtx = rgCanvas.getContext('2d');
  const rgImgData = rgCtx.createImageData(procW, procH);
  const rgData = rgImgData.data;

  for (let idx = 0; idx < procW * procH; idx++) {
    const rIdx = simpResult.regionGraph.pixelRegionMap[idx];
    const colorHex = DEBUG_REGION_COLORS[rIdx % DEBUG_REGION_COLORS.length];
    const r = parseInt(colorHex.slice(1, 3), 16);
    const g = parseInt(colorHex.slice(3, 5), 16);
    const b = parseInt(colorHex.slice(5, 7), 16);
    const pByte = idx * 4;
    rgData[pByte] = r;
    rgData[pByte + 1] = g;
    rgData[pByte + 2] = b;
    rgData[pByte + 3] = 255;
  }
  rgCtx.putImageData(rgImgData, 0, 0);

  // Draw region labels on top of region centroids
  rgCtx.font = 'bold 9px sans-serif';
  rgCtx.textAlign = 'center';
  rgCtx.textBaseline = 'middle';
  for (let rIdx = 0; rIdx < simpResult.regionGraph.regions.length; rIdx++) {
    const reg = simpResult.regionGraph.regions[rIdx];
    const px = Math.round(reg.centroid.x * procW);
    const py = Math.round(reg.centroid.y * procH);
    const label = `R${rIdx}:${reg.pixelCount}`;

    rgCtx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    rgCtx.fillRect(px - 18, py - 6, 36, 12);
    rgCtx.fillStyle = '#ffffff';
    rgCtx.fillText(label, px, py);
  }
  const rgBuffer = rgCanvas.toBuffer('image/png');
  saveFile(`${name}_region_graph.png`, rgBuffer);

  // 4. Current Reconstruction Result
  const reconResult = reconstruct(targetRaster, {
    regionGraph: simpResult.regionGraph,
    maxLayers: 30,
    minImprovement: 0.0005,
    minImprovementFloor: 0.0001,
    backgroundMode: 'reconstruct',
    timeoutMs: 30000
  });

  const reconRaster = renderLayersToRaster(reconResult.layers, procW, procH, { backgroundColor: '#141721' });
  const reconCanvas = createCanvas(procW, procH);
  const rCtx = reconCanvas.getContext('2d');
  const rImgData = rCtx.createImageData(procW, procH);
  rImgData.data.set(reconRaster.data);
  rCtx.putImageData(rImgData, 0, 0);
  const reconBuffer = reconCanvas.toBuffer('image/png');
  saveFile(`${name}_reconstructed.png`, reconBuffer);

  // 5. Side-by-side Contact Sheet (5 panels: Target | Simplified | FG Mask | RegionGraph | Recon)
  const contactCanvas = createCanvas(procW * 5 + 40, procH + 40);
  const cCtx = contactCanvas.getContext('2d');
  cCtx.fillStyle = '#1e1e24';
  cCtx.fillRect(0, 0, contactCanvas.width, contactCanvas.height);

  const panels = [
    { title: '1. Target', canvas: targetCanvas },
    { title: '2. Simplified', canvas: simpCanvas },
    { title: '3. Foreground Mask', canvas: fgCanvas },
    { title: '4. Region Graph', canvas: rgCanvas },
    { title: `5. Recon (${reconResult.layers.length}L)`, canvas: reconCanvas }
  ];

  cCtx.font = 'bold 12px sans-serif';
  cCtx.fillStyle = '#ffffff';
  cCtx.textAlign = 'center';

  for (let pIdx = 0; pIdx < panels.length; pIdx++) {
    const xOffset = 10 + pIdx * (procW + 6);
    const yOffset = 28;
    cCtx.fillText(panels[pIdx].title, xOffset + procW / 2, 18);
    cCtx.drawImage(panels[pIdx].canvas, xOffset, yOffset);
    cCtx.strokeStyle = '#3a3a48';
    cCtx.lineWidth = 1;
    cCtx.strokeRect(xOffset, yOffset, procW, procH);
  }

  saveFile(`${name}_contact_sheet.png`, contactCanvas.toBuffer('image/png'));

  // Calculate diagnostic metrics
  const totalPixels = procW * procH;
  const nonBgPercent = (fgPixelCount / totalPixels) * 100;
  const fgBBox = fgPixelCount > 0 ? { minX: fgMinX, maxX: fgMaxX, minY: fgMinY, maxY: fgMaxY } : null;

  return {
    name,
    srcW,
    srcH,
    crop: { cropX, cropY, cropW, cropH },
    procW,
    procH,
    totalPixels,
    fgPixelCount,
    bgPixelCount,
    nonBgPercent,
    fgBBox,
    levelStats,
    reconLayers: reconResult.layers.length,
    reconStopReason: reconResult.diagnostics.stopReason,
    initialLoss: reconResult.diagnostics.initialScore.totalLoss,
    finalLoss: reconResult.finalScore.totalLoss,
    foregroundLoss: reconResult.diagnostics.foregroundWeightedLoss
  };
}

async function main() {
  const serianePath = 'D:/Khai Van/KhaiVan Data/Resource/Art/Seriane.png';
  const wallpaperPath = 'D:/Khai Van/KhaiVan Data/Resource/Images/wp15313950.jpg';

  const d1 = await diagnoseImage('seriane', serianePath);
  const d2 = await diagnoseImage('wallpaper', wallpaperPath);

  console.log('\n======================================================');
  console.log('PHASE 8 INPUT ESTABLISHMENT REPORT');
  console.log('======================================================');
  console.log(JSON.stringify({ seriane: d1, wallpaper: d2 }, null, 2));
}

main().catch(err => {
  console.error('Diagnostic error:', err);
  process.exit(1);
});

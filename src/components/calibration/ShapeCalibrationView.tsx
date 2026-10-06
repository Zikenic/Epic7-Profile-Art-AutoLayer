import React, { useState, useEffect, useCallback } from 'react';
import { shapeAssetLoader } from '../../core/ShapeAssetLoader.ts';
import { CalibrationSystem, defaultCalibrationSystem } from '../../calibration/CalibrationSystem.ts';
import type {
  ShapeCalibrationResult,
  PrimitiveFitParameters,
  PaletteAnalysisDetail
} from '../../calibration/types.ts';
import { MathematicalPrimitives } from '../../calibration/MathematicalPrimitives.ts';
import { CalibrationShapeList } from './CalibrationShapeList.tsx';
import { CalibrationCanvas, ViewDisplayMode } from './CalibrationCanvas.tsx';
import { CalibrationInspector } from './CalibrationInspector.tsx';
import { PaletteAnalysisModal } from './PaletteAnalysisModal.tsx';

export const ShapeCalibrationView: React.FC = () => {
  const [shapes] = useState(() => shapeAssetLoader.getShapes());
  const [selectedAssetId, setSelectedAssetId] = useState<string>(shapes[0]?.id || 'Circle');
  const [displayMode, setDisplayMode] = useState<ViewDisplayMode>('raster_tinted');
  const [alphaThreshold, setAlphaThreshold] = useState<number>(2);

  // Cached alpha grids & image elements for each shape
  const [imageMap, setImageMap] = useState<Record<string, HTMLImageElement>>({});
  const [alphaGrids, setAlphaGrids] = useState<Record<string, Float32Array>>({});

  // Calibration database state
  const [calibrations, setCalibrations] = useState<Record<string, ShapeCalibrationResult>>({});
  const [palettes, setPalettes] = useState<Record<string, PaletteAnalysisDetail>>({});
  const [candidateParams, setCandidateParams] = useState<PrimitiveFitParameters>({
    type: 'circle',
    cx: 253.5,
    cy: 263.5,
    radius: 180
  });

  const [isPaletteModalOpen, setIsPaletteModalOpen] = useState(false);

  // Initialize and analyze all shapes
  useEffect(() => {
    let mounted = true;

    async function initCalibration() {
      // 1. Try to load pre-existing shape-calibration.json
      try {
        const resp = await fetch('/shape-calibration.json');
        if (resp.ok) {
          const json = await resp.json();
          defaultCalibrationSystem.loadDatabaseJSON(JSON.stringify(json));
          if (mounted) {
            setCalibrations(defaultCalibrationSystem.getAllShapeCalibrations());
            setPalettes(defaultCalibrationSystem.getAllPaletteAnalyses());
          }
        }
      } catch (e) {
        console.warn('Could not load shape-calibration.json from root, will compute dynamically', e);
      }

      // 2. Load and analyze all images in browser
      const newImages: Record<string, HTMLImageElement> = {};
      const newGrids: Record<string, Float32Array> = {};
      const newCals: Record<string, ShapeCalibrationResult> = {};

      for (const shape of shapes) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.onerror = () => resolve();
          img.src = shape.id === 'Cross' ? '/DerivedShapes/Cross.png' : `/Shapes_Colors/${shape.id}.png`;
        });

        newImages[shape.id] = img;

        const off = document.createElement('canvas');
        off.width = img.naturalWidth || img.width;
        off.height = img.naturalHeight || img.height;
        const ctx = off.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const imgData = ctx.getImageData(0, 0, off.width, off.height);
          const grid = CalibrationSystem.extractAlphaGrid(imgData);
          newGrids[shape.id] = grid;

          const cal = CalibrationSystem.analyzeShapeGeometry(
            shape.id,
            `${shape.id}.png`,
            off.width,
            off.height,
            grid,
            alphaThreshold
          );
          newCals[shape.id] = cal;
          defaultCalibrationSystem.setShapeCalibration(shape.id, cal);
        }
      }

      // 3. Load & analyze palette images
      for (const pName of ['Color_Palette_1', 'Color_Palette_2']) {
        const pImg = new Image();
        pImg.crossOrigin = 'anonymous';
        await new Promise<void>((resolve) => {
          pImg.onload = () => resolve();
          pImg.onerror = () => resolve();
          pImg.src = `/Shapes_Colors/${pName}.png`;
        });
        const detail = CalibrationSystem.analyzePaletteImage(pName, `${pName}.png`, pImg);
        defaultCalibrationSystem.setPaletteAnalysis(pName, detail);
      }

      if (mounted) {
        setImageMap(newImages);
        setAlphaGrids(newGrids);
        setCalibrations((prev) => ({ ...prev, ...newCals }));
        setPalettes(defaultCalibrationSystem.getAllPaletteAnalyses());

        if (newCals[selectedAssetId]) {
          setCandidateParams(newCals[selectedAssetId].candidatePrimitive);
        }
      }
    }

    initCalibration();

    return () => {
      mounted = false;
    };
  }, [shapes]);

  // When selected shape changes, update candidate params
  useEffect(() => {
    const cal = calibrations[selectedAssetId];
    if (cal) {
      setCandidateParams(cal.candidatePrimitive);
    }
  }, [selectedAssetId, calibrations]);

  // Recalculate analysis when alpha threshold slider changes
  const handleThresholdChange = useCallback(
    (threshold: number) => {
      setAlphaThreshold(threshold);
      const grid = alphaGrids[selectedAssetId];
      const cal = calibrations[selectedAssetId];
      if (!grid || !cal) return;

      const newCal = CalibrationSystem.analyzeShapeGeometry(
        cal.assetId,
        cal.filename,
        cal.sourceWidth,
        cal.sourceHeight,
        grid,
        threshold
      );
      // Preserve user modified candidate params
      newCal.candidatePrimitive = candidateParams;

      const mathGrid = MathematicalPrimitives.rasterizeToAlphaGrid(
        candidateParams,
        cal.sourceWidth,
        cal.sourceHeight
      );
      newCal.fitMetrics = MathematicalPrimitives.evaluateMetrics(
        mathGrid,
        grid,
        newCal.foregroundBounds.minX,
        newCal.foregroundBounds.minY,
        newCal.foregroundBounds.maxX,
        newCal.foregroundBounds.maxY,
        cal.sourceWidth
      );

      setCalibrations((prev) => ({ ...prev, [selectedAssetId]: newCal }));
      defaultCalibrationSystem.setShapeCalibration(selectedAssetId, newCal);
    },
    [selectedAssetId, alphaGrids, calibrations, candidateParams]
  );

  // Recalculate fit metrics
  const handleRecalculateFit = useCallback(() => {
    const grid = alphaGrids[selectedAssetId];
    const cal = calibrations[selectedAssetId];
    if (!grid || !cal) return;

    const mathGrid = MathematicalPrimitives.rasterizeToAlphaGrid(
      candidateParams,
      cal.sourceWidth,
      cal.sourceHeight
    );
    const fitMetrics = MathematicalPrimitives.evaluateMetrics(
      mathGrid,
      grid,
      cal.foregroundBounds.minX,
      cal.foregroundBounds.minY,
      cal.foregroundBounds.maxX,
      cal.foregroundBounds.maxY,
      cal.sourceWidth
    );

    const updatedCal: ShapeCalibrationResult = {
      ...cal,
      candidatePrimitive: candidateParams,
      fitMetrics
    };

    setCalibrations((prev) => ({ ...prev, [selectedAssetId]: updatedCal }));
    defaultCalibrationSystem.setShapeCalibration(selectedAssetId, updatedCal);
  }, [selectedAssetId, alphaGrids, calibrations, candidateParams]);

  // Export JSON
  const handleExportDatabase = () => {
    const jsonStr = defaultCalibrationSystem.exportDatabaseJSON();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'shape-calibration.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import JSON
  const handleImportDatabase = (jsonStr: string) => {
    defaultCalibrationSystem.loadDatabaseJSON(jsonStr);
    const loadedShapes = defaultCalibrationSystem.getAllShapeCalibrations();
    setCalibrations(loadedShapes);
    setPalettes(defaultCalibrationSystem.getAllPaletteAnalyses());
    if (loadedShapes[selectedAssetId]) {
      setCandidateParams(loadedShapes[selectedAssetId].candidatePrimitive);
    }
  };

  const currentImage = imageMap[selectedAssetId] || null;
  const currentCalibration = calibrations[selectedAssetId] || null;
  const currentAlphaGrid = alphaGrids[selectedAssetId] || null;

  return (
    <div style={{ display: 'flex', flex: 1, height: '100%', overflow: 'hidden' }}>
      {/* Left: Shape List */}
      <CalibrationShapeList
        shapes={shapes}
        calibrations={calibrations}
        selectedAssetId={selectedAssetId}
        onSelectAsset={setSelectedAssetId}
      />

      {/* Center: High Zoom Interactive Canvas */}
      <CalibrationCanvas
        imageElement={currentImage}
        calibration={currentCalibration}
        candidateParams={candidateParams}
        onUpdateCandidateParams={(updates) => setCandidateParams((p) => ({ ...p, ...updates }))}
        alphaGrid={currentAlphaGrid}
        displayMode={displayMode}
        setDisplayMode={setDisplayMode}
      />

      {/* Right: Property Inspector & Fitting Controls */}
      <CalibrationInspector
        calibration={currentCalibration}
        candidateParams={candidateParams}
        onUpdateCandidateParams={(updates) => setCandidateParams((p) => ({ ...p, ...updates }))}
        onThresholdChange={handleThresholdChange}
        onRecalculateFit={handleRecalculateFit}
        onExportDatabase={handleExportDatabase}
        onImportDatabase={handleImportDatabase}
        onOpenPaletteModal={() => setIsPaletteModalOpen(true)}
      />

      {/* Palette Inspection Modal */}
      <PaletteAnalysisModal
        isOpen={isPaletteModalOpen}
        onClose={() => setIsPaletteModalOpen(false)}
        palettes={palettes}
      />
    </div>
  );
};

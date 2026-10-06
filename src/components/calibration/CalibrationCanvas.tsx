import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { ShapeCalibrationResult, PrimitiveFitParameters } from '../../calibration/types.ts';
import { MathematicalPrimitives } from '../../calibration/MathematicalPrimitives.ts';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  RotateCcw,
  Eye,
  Grid
} from 'lucide-react';

export type ViewDisplayMode =
  | 'raster_original'
  | 'raster_mask'
  | 'raster_tinted'
  | 'math_primitive'
  | 'side_by_side'
  | 'overlay'
  | 'difference';

interface CalibrationCanvasProps {
  imageElement: HTMLImageElement | null;
  calibration: ShapeCalibrationResult | null;
  candidateParams: PrimitiveFitParameters;
  onUpdateCandidateParams: (updates: Partial<PrimitiveFitParameters>) => void;
  alphaGrid: Float32Array | null;
  displayMode: ViewDisplayMode;
  setDisplayMode: (mode: ViewDisplayMode) => void;
}

function drawCrosshair(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  label?: string
): void {
  c.beginPath();
  c.moveTo(x - len, y);
  c.lineTo(x + len, y);
  c.moveTo(x, y - len);
  c.lineTo(x, y + len);
  c.stroke();

  if (label) {
    c.fillStyle = c.strokeStyle;
    c.font = '9px monospace';
    c.fillText(label, x + 4, y - 4);
  }
}

export const CalibrationCanvas: React.FC<CalibrationCanvasProps> = ({
  imageElement,
  calibration,
  candidateParams,
  alphaGrid,
  displayMode,
  setDisplayMode
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Zoom & Pan
  const [zoom, setZoom] = useState<number>(1.5);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ x: number; y: number; startPanX: number; startPanY: number }>({
    x: 0,
    y: 0,
    startPanX: 0,
    startPanY: 0
  });

  // Measurement Overlay toggles
  const [showBBox, setShowBBox] = useState(true);
  const [showImageCenter, setShowImageCenter] = useState(true);
  const [showBBoxCenter, setShowBBoxCenter] = useState(true);
  const [showCentroid, setShowCentroid] = useState(true);
  const [showSymmetryAxes, setShowSymmetryAxes] = useState(false);
  const [showPixelGrid, setShowPixelGrid] = useState(true);
  const [overlayOpacity, setOverlayOpacity] = useState(0.5);

  // Pixel hover inspection
  const [hoverPixel, setHoverPixel] = useState<{ x: number; y: number; alpha: number } | null>(null);

  const fitToView = useCallback(() => {
    if (!containerRef.current || !calibration) return;
    const cw = containerRef.current.clientWidth - 80;
    const ch = containerRef.current.clientHeight - 80;
    const scaleX = cw / (displayMode === 'side_by_side' ? calibration.sourceWidth * 2 + 40 : calibration.sourceWidth);
    const scaleY = ch / calibration.sourceHeight;
    const fitZ = Math.min(scaleX, scaleY, 3.0);
    setZoom(parseFloat(Math.max(0.2, fitZ).toFixed(2)));
    setPan({ x: 0, y: 0 });
  }, [calibration, displayMode]);

  useEffect(() => {
    fitToView();
  }, [calibration?.assetId, displayMode, fitToView]);

  // Main canvas render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageElement || !calibration || !alphaGrid) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = calibration.sourceWidth;
    const h = calibration.sourceHeight;

    if (displayMode === 'side_by_side') {
      canvas.width = w * 2 + 40;
      canvas.height = h;
    } else {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawRaster = (targetCtx: CanvasRenderingContext2D, dx: number, dy: number) => {
      if (displayMode === 'raster_original') {
        targetCtx.drawImage(imageElement, dx, dy);
      } else if (displayMode === 'raster_mask') {
        const imgData = targetCtx.createImageData(w, h);
        const d = imgData.data;
        for (let i = 0; i < alphaGrid.length; i++) {
          const a = Math.round(alphaGrid[i] * 255);
          const idx = i * 4;
          d[idx] = a;
          d[idx + 1] = a;
          d[idx + 2] = a;
          d[idx + 3] = 255;
        }
        targetCtx.putImageData(imgData, dx, dy);
      } else {
        // raster_tinted, overlay, side_by_side, difference
        const off = document.createElement('canvas');
        off.width = w;
        off.height = h;
        const oCtx = off.getContext('2d');
        if (oCtx) {
          const imgData = oCtx.createImageData(w, h);
          const d = imgData.data;
          // Slate grey #586a8b
          for (let i = 0; i < alphaGrid.length; i++) {
            const a = Math.round(alphaGrid[i] * 255);
            const idx = i * 4;
            d[idx] = 88;
            d[idx + 1] = 106;
            d[idx + 2] = 139;
            d[idx + 3] = a;
          }
          oCtx.putImageData(imgData, 0, 0);
          targetCtx.drawImage(off, dx, dy);
        }
      }
    };

    if (displayMode === 'side_by_side') {
      // Left: Raster
      drawRaster(ctx, 0, 0);

      // Separator
      ctx.save();
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(w, 0, 40, h);
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(w + 20, 0);
      ctx.lineTo(w + 20, h);
      ctx.stroke();
      ctx.restore();

      // Right: Mathematical Candidate
      ctx.save();
      ctx.translate(w + 40, 0);
      MathematicalPrimitives.draw(ctx, candidateParams, {
        fillColor: '#3b82f6',
        strokeColor: '#60a5fa',
        lineWidth: 2,
        fillOpacity: 0.85
      });
      ctx.restore();
    } else if (displayMode === 'difference') {
      // Difference map
      const mathGrid = MathematicalPrimitives.rasterizeToAlphaGrid(candidateParams, w, h);
      const imgData = ctx.createImageData(w, h);
      const d = imgData.data;

      for (let i = 0; i < alphaGrid.length; i++) {
        const rVal = alphaGrid[i];
        const mVal = mathGrid[i];
        const diff = Math.abs(rVal - mVal);
        const idx = i * 4;

        if (diff < 0.05) {
          // Good match: dark subtle green
          d[idx] = 16;
          d[idx + 1] = 185;
          d[idx + 2] = 129;
          d[idx + 3] = Math.round(Math.max(rVal, mVal) * 80);
        } else {
          // Error: high intensity red
          d[idx] = 239;
          d[idx + 1] = 68;
          d[idx + 2] = 68;
          d[idx + 3] = Math.min(255, Math.round(diff * 255 + 50));
        }
      }
      ctx.putImageData(imgData, 0, 0);
    } else if (displayMode === 'math_primitive') {
      // Pure mathematical primitive view
      MathematicalPrimitives.draw(ctx, candidateParams, {
        fillColor: '#3b82f6',
        strokeColor: '#60a5fa',
        lineWidth: 2,
        fillOpacity: 0.95,
        strokeOpacity: 1.0
      });
    } else {
      // Single view: raster
      drawRaster(ctx, 0, 0);

      // If overlay mode, draw mathematical candidate on top
      if (displayMode === 'overlay') {
        MathematicalPrimitives.draw(ctx, candidateParams, {
          fillColor: '#f59e0b',
          strokeColor: '#fbbf24',
          lineWidth: 2,
          fillOpacity: overlayOpacity,
          strokeOpacity: 0.95
        });
      }
    }

    // Draw Overlays on top of the raster area (left side or single view)
    const drawOverlays = (targetCtx: CanvasRenderingContext2D) => {
      targetCtx.save();

      // 1. Image boundary (dashed border)
      targetCtx.strokeStyle = 'rgba(148, 163, 184, 0.4)';
      targetCtx.lineWidth = 1;
      targetCtx.setLineDash([4, 4]);
      targetCtx.strokeRect(0, 0, w, h);
      targetCtx.setLineDash([]);

      const bbox = calibration.foregroundBounds;

      // 2. Foreground Bounding Box (Cyan)
      if (showBBox) {
        targetCtx.strokeStyle = '#06b6d4';
        targetCtx.lineWidth = 1.5;
        targetCtx.strokeRect(bbox.minX, bbox.minY, bbox.width, bbox.height);

        // Dimension labels
        targetCtx.fillStyle = '#06b6d4';
        targetCtx.font = '10px monospace';
        targetCtx.fillText(`${bbox.width} × ${bbox.height}px`, bbox.minX + 4, bbox.minY - 4);
      }

      // 3. Symmetry Axes (Purple)
      if (showSymmetryAxes) {
        targetCtx.strokeStyle = 'rgba(168, 85, 247, 0.6)';
        targetCtx.lineWidth = 1;
        targetCtx.setLineDash([3, 3]);

        // Vertical axis through bbox center
        const bx = calibration.centers.foregroundBBox.x;
        targetCtx.beginPath();
        targetCtx.moveTo(bx, bbox.minY);
        targetCtx.lineTo(bx, bbox.maxY);
        targetCtx.stroke();

        // Horizontal axis through bbox center
        const by = calibration.centers.foregroundBBox.y;
        targetCtx.beginPath();
        targetCtx.moveTo(bbox.minX, by);
        targetCtx.lineTo(bbox.maxX, by);
        targetCtx.stroke();

        targetCtx.setLineDash([]);
      }

      // 4. Image Center Crosshair (Blue)
      if (showImageCenter) {
        const ic = calibration.centers.image;
        targetCtx.strokeStyle = '#3b82f6';
        targetCtx.lineWidth = 1.5;
        drawCrosshair(targetCtx, ic.x, ic.y, 10, 'Image Center');
      }

      // 5. BBox Center Crosshair (Cyan)
      if (showBBoxCenter) {
        const bc = calibration.centers.foregroundBBox;
        targetCtx.strokeStyle = '#06b6d4';
        targetCtx.lineWidth = 1.5;
        drawCrosshair(targetCtx, bc.x, bc.y, 8, 'BBox Center');
      }

      // 6. Alpha Centroid Crosshair (Amber)
      if (showCentroid) {
        const ac = calibration.centers.alphaCentroid;
        targetCtx.strokeStyle = '#f59e0b';
        targetCtx.lineWidth = 1.5;
        drawCrosshair(targetCtx, ac.x, ac.y, 8, 'Centroid');
      }

      targetCtx.restore();
    };

    drawOverlays(ctx);

    // High zoom pixel grid
    if (showPixelGrid && zoom >= 4.0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= w; x += 10) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += 10) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [
    imageElement,
    calibration,
    candidateParams,
    alphaGrid,
    displayMode,
    showBBox,
    showImageCenter,
    showBBoxCenter,
    showCentroid,
    showSymmetryAxes,
    showPixelGrid,
    overlayOpacity,
    zoom
  ]);

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    const nextZoom = Math.max(0.2, Math.min(10.0, zoom * factor));
    setZoom(parseFloat(nextZoom.toFixed(2)));
  };

  // Pan controls
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || e.altKey || e.button === 0) {
      setIsPanning(true);
      panStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y
      };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isPanning) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setPan({
        x: panStartRef.current.startPanX + dx,
        y: panStartRef.current.startPanY + dy
      });
      return;
    }

    // Inspect hovered pixel
    if (canvasRef.current && calibration && alphaGrid) {
      const rect = canvasRef.current.getBoundingClientRect();
      const px = Math.floor((e.clientX - rect.left) / zoom);
      const py = Math.floor((e.clientY - rect.top) / zoom);
      if (px >= 0 && px < calibration.sourceWidth && py >= 0 && py < calibration.sourceHeight) {
        const a = alphaGrid[py * calibration.sourceWidth + px];
        setHoverPixel({ x: px, y: py, alpha: parseFloat(a.toFixed(4)) });
      } else {
        setHoverPixel(null);
      }
    }
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      style={{
        flex: 1,
        position: 'relative',
        backgroundColor: '#07090e',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: isPanning ? 'grabbing' : 'crosshair'
      }}
    >
      {/* Top View Mode Switcher */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          left: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '4px',
          backgroundColor: 'rgba(19, 23, 34, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '4px',
          zIndex: 10
        }}
      >
        {[
          { id: 'raster_tinted', label: 'Tinted Alpha' },
          { id: 'raster_original', label: 'Original RGB' },
          { id: 'raster_mask', label: 'Alpha Mask' },
          { id: 'math_primitive', label: 'Math Primitive' },
          { id: 'overlay', label: 'Math Fit Overlay' },
          { id: 'side_by_side', label: 'Side-by-Side' },
          { id: 'difference', label: 'Difference Map' }
        ].map((m) => (
          <button
            key={m.id}
            onClick={() => setDisplayMode(m.id as ViewDisplayMode)}
            style={{
              padding: '4px 8px',
              fontSize: '11px',
              fontWeight: 500,
              borderRadius: '4px',
              border: 'none',
              cursor: 'pointer',
              backgroundColor: displayMode === m.id ? 'var(--accent)' : 'transparent',
              color: displayMode === m.id ? '#ffffff' : 'var(--text-secondary)'
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Top Right Overlay Toggles */}
      <div
        style={{
          position: 'absolute',
          top: '14px',
          right: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          backgroundColor: 'rgba(19, 23, 34, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '4px 8px',
          zIndex: 10,
          fontSize: '11px'
        }}
      >
        <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Eye size={12} /> Overlays:
        </span>
        <button
          className={`btn btn-icon ${showBBox ? 'btn-primary' : ''}`}
          onClick={() => setShowBBox(!showBBox)}
          title="Toggle Foreground Bounding Box"
          style={{ fontSize: '10px', padding: '3px 6px' }}
        >
          BBox
        </button>
        <button
          className={`btn btn-icon ${showImageCenter ? 'btn-primary' : ''}`}
          onClick={() => setShowImageCenter(!showImageCenter)}
          title="Toggle Image Center Crosshair"
          style={{ fontSize: '10px', padding: '3px 6px' }}
        >
          Img Center
        </button>
        <button
          className={`btn btn-icon ${showBBoxCenter ? 'btn-primary' : ''}`}
          onClick={() => setShowBBoxCenter(!showBBoxCenter)}
          title="Toggle BBox Center Crosshair"
          style={{ fontSize: '10px', padding: '3px 6px' }}
        >
          BBox Center
        </button>
        <button
          className={`btn btn-icon ${showCentroid ? 'btn-primary' : ''}`}
          onClick={() => setShowCentroid(!showCentroid)}
          title="Toggle Alpha Centroid"
          style={{ fontSize: '10px', padding: '3px 6px' }}
        >
          Centroid
        </button>
        <button
          className={`btn btn-icon ${showSymmetryAxes ? 'btn-primary' : ''}`}
          onClick={() => setShowSymmetryAxes(!showSymmetryAxes)}
          title="Toggle Symmetry Axes"
          style={{ fontSize: '10px', padding: '3px 6px' }}
        >
          Symmetry
        </button>
        <button
          className={`btn btn-icon ${showPixelGrid ? 'btn-primary' : ''}`}
          onClick={() => setShowPixelGrid(!showPixelGrid)}
          title="Toggle Pixel Grid (Visible at Zoom >= 400%)"
          style={{ fontSize: '10px', padding: '3px 6px' }}
        >
          <Grid size={11} />
        </button>

        {displayMode === 'overlay' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px', borderLeft: '1px solid var(--border-color)', paddingLeft: '6px' }}>
            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Opacity:</span>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={overlayOpacity}
              onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))}
              style={{ width: '60px', accentColor: 'var(--accent)' }}
            />
          </div>
        )}
      </div>

      {/* Bottom Floating Toolbar: Zoom & Pixel Inspector */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(19, 23, 34, 0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '4px 10px',
          zIndex: 10
        }}
      >
        <button className="btn btn-icon" onClick={() => setZoom(z => Math.max(0.2, parseFloat((z - 0.2).toFixed(2))))}>
          <ZoomOut size={13} />
        </button>
        <span style={{ fontSize: '11px', fontFamily: 'monospace', minWidth: '42px', textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="btn btn-icon" onClick={() => setZoom(z => Math.min(10.0, parseFloat((z + 0.2).toFixed(2))))}>
          <ZoomIn size={13} />
        </button>
        <button className="btn btn-icon" onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }} title="100% Zoom">
          <RotateCcw size={13} />
        </button>
        <button className="btn btn-icon" onClick={fitToView} title="Fit to Screen">
          <Maximize2 size={13} />
        </button>

        {hoverPixel && (
          <div style={{ borderLeft: '1px solid var(--border-color)', paddingLeft: '8px', fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
            X: <strong style={{ color: '#ffffff' }}>{hoverPixel.x}</strong> Y: <strong style={{ color: '#ffffff' }}>{hoverPixel.y}</strong> | Alpha: <strong style={{ color: 'var(--accent)' }}>{(hoverPixel.alpha * 100).toFixed(1)}%</strong>
          </div>
        )}
      </div>

      {/* Canvas Viewport with Pan and Zoom */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: isPanning ? 'none' : 'transform 0.05s ease-out',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          overflow: 'visible',
          position: 'relative'
        }}
        className={displayMode !== 'raster_original' ? 'checkerboard' : ''}
      >
        <canvas ref={canvasRef} style={{ display: 'block', borderRadius: '4px' }} />
      </div>
    </div>
  );
};

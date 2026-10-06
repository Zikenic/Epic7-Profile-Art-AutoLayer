import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Layer, ShapeDefinition, CANVAS_ASPECT_RATIO, REFERENCE_CANVAS_WIDTH } from '../core/types.ts';
import { DeterministicRenderer, RenderOptions, RenderMode } from '../core/Renderer.ts';
import { getShapeFrameCalibration } from '../core/ShapeFrameCalibration.ts';
import { ZoomIn, ZoomOut, Maximize2, RotateCcw, Grid } from 'lucide-react';

interface CanvasViewProps {
  layers: readonly Layer[];
  selectedLayer: Layer | null;
  onSelectLayer: (id: string | null) => void;
  onUpdateLayer: (id: string, updates: Partial<Layer>) => void;
  getShape: (id: string) => ShapeDefinition | undefined;
  backgroundColor: string;
  referenceImage: HTMLImageElement | null;
  referenceOpacity: number;
  referenceFit: 'contain' | 'cover';
  referenceVisible: boolean;
  renderMode?: RenderMode;
}

type DragMode = 'none' | 'pan' | 'move' | 'rotate' | 'resize-nw' | 'resize-ne' | 'resize-se' | 'resize-sw' | 'resize-n' | 'resize-s' | 'resize-w' | 'resize-e';

export const CanvasView: React.FC<CanvasViewProps> = ({
  layers,
  selectedLayer,
  onSelectLayer,
  onUpdateLayer,
  getShape,
  backgroundColor,
  referenceImage,
  referenceOpacity,
  referenceFit,
  referenceVisible,
  renderMode = 'raster'
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Zoom & Pan state
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState<boolean>(false);
  const isSpaceDownRef = useRef<boolean>(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        isSpaceDownRef.current = true;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceDownRef.current = false;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Interactive manipulation state
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const dragStartRef = useRef<{
    startX: number;
    startY: number;
    initialLayerX: number;
    initialLayerY: number;
    initialScaleX: number;
    initialScaleY: number;
    initialRotation: number;
    initialPanX: number;
    initialPanY: number;
  }>({
    startX: 0,
    startY: 0,
    initialLayerX: 0,
    initialLayerY: 0,
    initialScaleX: 1,
    initialScaleY: 1,
    initialRotation: 0,
    initialPanX: 0,
    initialPanY: 0
  });

  // Base artboard internal dimensions (Strict 21:31 ratio)
  const artboardW = REFERENCE_CANVAS_WIDTH; // 840
  const artboardH = Math.round(artboardW / CANVAS_ASPECT_RATIO); // 1240

  // Fit canvas to viewport
  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const containerH = containerRef.current.clientHeight;
    const padding = 60;

    const scaleX = (containerW - padding) / artboardW;
    const scaleY = (containerH - padding) / artboardH;
    const fitZoom = Math.min(scaleX, scaleY, 1.2);

    setZoom(parseFloat(fitZoom.toFixed(2)));
    setPan({ x: 0, y: 0 });
  }, [artboardW, artboardH]);

  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // Main rendering loop onto the interactive canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // High DPI / exact pixel resolution for rendering
    canvas.width = artboardW;
    canvas.height = artboardH;

    const options: RenderOptions = {
      width: artboardW,
      height: artboardH,
      backgroundColor,
      referenceImage: referenceVisible ? referenceImage : null,
      referenceOpacity,
      referenceFit,
      renderMode
    };

    DeterministicRenderer.render(ctx, layers, options);

    // Draw optional alignment grid
    if (showGrid) {
      ctx.save();
      ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
      ctx.lineWidth = 1;

      // Rule of thirds
      for (let i = 1; i <= 2; i++) {
        const gx = (artboardW / 3) * i;
        const gy = (artboardH / 3) * i;
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, artboardH);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(artboardW, gy);
        ctx.stroke();
      }

      // Center crosshair
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.3)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(artboardW / 2, 0);
      ctx.lineTo(artboardW / 2, artboardH);
      ctx.moveTo(0, artboardH / 2);
      ctx.lineTo(artboardW, artboardH / 2);
      ctx.stroke();

      ctx.restore();
    }
  }, [layers, selectedLayer, backgroundColor, referenceImage, referenceOpacity, referenceFit, referenceVisible, showGrid, artboardW, artboardH, renderMode]);

  // Helper to convert screen mouse event coordinates to normalized artboard coordinates
  const screenToArtboard = (e: React.MouseEvent | MouseEvent): { ax: number; ay: number } => {
    if (!canvasRef.current) return { ax: 0, ay: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    const ax = ((e.clientX - rect.left) / rect.width) * artboardW;
    const ay = ((e.clientY - rect.top) / rect.height) * artboardH;
    return { ax, ay };
  };

  // Convert artboard coordinates to local coordinates of a layer
  const artboardToLocal = (ax: number, ay: number, layer: Layer) => {
    const cx = layer.x * artboardW;
    const cy = layer.y * artboardH;
    const dx = ax - cx;
    const dy = ay - cy;
    const rad = (layer.rotation * Math.PI) / 180.0;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    return { lx, ly };
  };

  // Hit testing for layers from top to bottom against native square frames
  const hitTestLayer = (ax: number, ay: number): Layer | null => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (!layer.visible || layer.locked) continue;

      const calib = getShapeFrameCalibration(layer.shapeAsset);
      const frameNormSize = calib ? calib.frameNormalizedSize : (450 / 567);
      const nativeFrameSize = artboardW * frameNormSize;
      const targetW = nativeFrameSize * layer.scaleX;
      const targetH = nativeFrameSize * layer.scaleY;

      const { lx, ly } = artboardToLocal(ax, ay, layer);
      if (Math.abs(lx) <= targetW / 2 && Math.abs(ly) <= targetH / 2) {
        return layer;
      }
    }
    return null;
  };

  // Wheel zoom handling
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newZoom = Math.max(0.2, Math.min(4.0, zoom * zoomFactor));
    setZoom(parseFloat(newZoom.toFixed(2)));
  };

  // Mouse down on canvas or container
  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle click, Alt + click, or Space + click triggers panning
    if (e.button === 1 || e.altKey || isSpaceDownRef.current) {
      setDragMode('pan');
      dragStartRef.current = {
        ...dragStartRef.current,
        startX: e.clientX,
        startY: e.clientY,
        initialPanX: pan.x,
        initialPanY: pan.y
      };
      return;
    }

    if (e.button !== 0) return;

    const { ax, ay } = screenToArtboard(e);

    // If mouse was over a handle, dragMode is already set by handle's onMouseDown
    if (dragMode !== 'none') return;

    // Check hit test
    const hit = hitTestLayer(ax, ay);
    if (hit) {
      onSelectLayer(hit.id);
      setDragMode('move');
      dragStartRef.current = {
        ...dragStartRef.current,
        startX: ax,
        startY: ay,
        initialLayerX: hit.x,
        initialLayerY: hit.y,
        initialScaleX: hit.scaleX,
        initialScaleY: hit.scaleY,
        initialRotation: hit.rotation
      };
    } else {
      onSelectLayer(null);
    }
  };

  // Global mouse move & up listeners during dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragMode === 'none') return;

      if (dragMode === 'pan') {
        const dx = e.clientX - dragStartRef.current.startX;
        const dy = e.clientY - dragStartRef.current.startY;
        setPan({
          x: dragStartRef.current.initialPanX + dx,
          y: dragStartRef.current.initialPanY + dy
        });
        return;
      }

      if (!selectedLayer || selectedLayer.locked) return;

      const { ax, ay } = screenToArtboard(e);
      const calib = getShapeFrameCalibration(selectedLayer.shapeAsset);
      const frameNormSize = calib ? calib.frameNormalizedSize : (450 / 567);
      const nativeFrameSize = artboardW * frameNormSize;
      const baseW = nativeFrameSize;
      const baseH = nativeFrameSize;

      if (dragMode === 'move') {
        const deltaX = (ax - dragStartRef.current.startX) / artboardW;
        const deltaY = (ay - dragStartRef.current.startY) / artboardH;
        const newX = parseFloat((dragStartRef.current.initialLayerX + deltaX).toFixed(4));
        const newY = parseFloat((dragStartRef.current.initialLayerY + deltaY).toFixed(4));
        onUpdateLayer(selectedLayer.id, { x: newX, y: newY });
      } else if (dragMode === 'rotate') {
        const cx = selectedLayer.x * artboardW;
        const cy = selectedLayer.y * artboardH;
        const angle = Math.atan2(ay - cy, ax - cx) * (180 / Math.PI) + 90;
        let deg = Math.round(angle);
        if (e.shiftKey) deg = Math.round(deg / 15) * 15; // 15 degree snapping with Shift
        onUpdateLayer(selectedLayer.id, { rotation: deg });
      } else if (dragMode.startsWith('resize-')) {
        const { lx, ly } = artboardToLocal(ax, ay, selectedLayer);

        let newScaleX = selectedLayer.scaleX;
        let newScaleY = selectedLayer.scaleY;

        switch (dragMode) {
          case 'resize-e':
            newScaleX = Math.max(0.05, (lx * 2) / baseW);
            break;
          case 'resize-w':
            newScaleX = Math.max(0.05, (-lx * 2) / baseW);
            break;
          case 'resize-s':
            newScaleY = Math.max(0.05, (ly * 2) / baseH);
            break;
          case 'resize-n':
            newScaleY = Math.max(0.05, (-ly * 2) / baseH);
            break;
          case 'resize-se':
            newScaleX = Math.max(0.05, (lx * 2) / baseW);
            newScaleY = Math.max(0.05, (ly * 2) / baseH);
            break;
          case 'resize-sw':
            newScaleX = Math.max(0.05, (-lx * 2) / baseW);
            newScaleY = Math.max(0.05, (ly * 2) / baseH);
            break;
          case 'resize-ne':
            newScaleX = Math.max(0.05, (lx * 2) / baseW);
            newScaleY = Math.max(0.05, (-ly * 2) / baseH);
            break;
          case 'resize-nw':
            newScaleX = Math.max(0.05, (-lx * 2) / baseW);
            newScaleY = Math.max(0.05, (-ly * 2) / baseH);
            break;
        }

        // Shift key preserves aspect ratio
        if (e.shiftKey) {
          const avg = (newScaleX + newScaleY) / 2;
          newScaleX = avg;
          newScaleY = avg;
        }

        onUpdateLayer(selectedLayer.id, {
          scaleX: parseFloat(newScaleX.toFixed(3)),
          scaleY: parseFloat(newScaleY.toFixed(3))
        });
      }
    };

    const handleMouseUp = () => {
      setDragMode('none');
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, selectedLayer, onUpdateLayer, getShape, artboardW, artboardH, pan]);

  // Selected layer bounding box and transform handles
  const renderTransformBox = () => {
    if (!selectedLayer || !selectedLayer.visible || selectedLayer.locked) return null;

    const calib = getShapeFrameCalibration(selectedLayer.shapeAsset);
    const frameNormSize = calib ? calib.frameNormalizedSize : (450 / 567);
    const nativeFrameSize = artboardW * frameNormSize;
    const targetW = nativeFrameSize * selectedLayer.scaleX;
    const targetH = nativeFrameSize * selectedLayer.scaleY;

    const cx = selectedLayer.x * artboardW;
    const cy = selectedLayer.y * artboardH;

    const startResize = (e: React.MouseEvent, mode: DragMode) => {
      e.stopPropagation();
      setDragMode(mode);
      const { ax, ay } = screenToArtboard(e);
      dragStartRef.current = {
        ...dragStartRef.current,
        startX: ax,
        startY: ay,
        initialLayerX: selectedLayer.x,
        initialLayerY: selectedLayer.y,
        initialScaleX: selectedLayer.scaleX,
        initialScaleY: selectedLayer.scaleY,
        initialRotation: selectedLayer.rotation
      };
    };

    const handleSize = 10 / zoom;
    const halfW = targetW / 2;
    const halfH = targetH / 2;

    return (
      <div
        style={{
          position: 'absolute',
          left: `${cx}px`,
          top: `${cy}px`,
          width: `${targetW}px`,
          height: `${targetH}px`,
          transform: `translate(-50%, -50%) rotate(${selectedLayer.rotation}deg)`,
          border: `${1.5 / zoom}px solid #3b82f6`,
          pointerEvents: 'none',
          boxShadow: '0 0 4px rgba(59, 130, 246, 0.5)'
        }}
      >
        {/* Rotation stem & handle */}
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: `-${24 / zoom}px`,
            width: `${1 / zoom}px`,
            height: `${24 / zoom}px`,
            backgroundColor: '#3b82f6',
            transform: 'translateX(-50%)'
          }}
        />
        <div
          onMouseDown={(e) => startResize(e, 'rotate')}
          title="Drag to rotate (Hold Shift for 15° steps)"
          style={{
            position: 'absolute',
            left: '50%',
            top: `-${28 / zoom}px`,
            width: `${handleSize + 2}px`,
            height: `${handleSize + 2}px`,
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
            border: '2px solid #ffffff',
            transform: 'translate(-50%, -50%)',
            cursor: 'grab',
            pointerEvents: 'auto',
            boxShadow: '0 2px 4px rgba(0,0,0,0.5)'
          }}
        />

        {/* 8 Resize Handles */}
        {[
          { mode: 'resize-nw', x: -halfW, y: -halfH, cursor: 'nwse-resize' },
          { mode: 'resize-n',  x: 0,      y: -halfH, cursor: 'ns-resize' },
          { mode: 'resize-ne', x: halfW,  y: -halfH, cursor: 'nesw-resize' },
          { mode: 'resize-e',  x: halfW,  y: 0,      cursor: 'ew-resize' },
          { mode: 'resize-se', x: halfW,  y: halfH,  cursor: 'nwse-resize' },
          { mode: 'resize-s',  x: 0,      y: halfH,  cursor: 'ns-resize' },
          { mode: 'resize-sw', x: -halfW, y: halfH,  cursor: 'nesw-resize' },
          { mode: 'resize-w',  x: -halfW, y: 0,      cursor: 'ew-resize' }
        ].map((h) => (
          <div
            key={h.mode}
            onMouseDown={(e) => startResize(e, h.mode as DragMode)}
            style={{
              position: 'absolute',
              left: `${halfW + h.x}px`,
              top: `${halfH + h.y}px`,
              width: `${handleSize}px`,
              height: `${handleSize}px`,
              backgroundColor: '#ffffff',
              border: '2px solid #3b82f6',
              borderRadius: '2px',
              transform: 'translate(-50%, -50%)',
              cursor: h.cursor,
              pointerEvents: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.4)'
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onWheel={handleWheel}
      style={{
        flex: 1,
        position: 'relative',
        backgroundColor: '#07090e',
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: dragMode === 'pan' ? 'grabbing' : 'default'
      }}
    >
      {/* On-canvas Controls Overlay */}
      <div
        style={{
          position: 'absolute',
          bottom: '16px',
          left: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          backgroundColor: 'rgba(19, 23, 34, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-color)',
          borderRadius: '8px',
          padding: '4px 8px',
          zIndex: 10,
          boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
        }}
      >
        <button
          className="btn btn-icon"
          onClick={() => setZoom(z => Math.max(0.2, parseFloat((z - 0.1).toFixed(2))))}
          title="Zoom Out"
        >
          <ZoomOut size={14} />
        </button>
        <span
          style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            minWidth: '42px',
            textAlign: 'center',
            color: 'var(--text-primary)'
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="btn btn-icon"
          onClick={() => setZoom(z => Math.min(4.0, parseFloat((z + 0.1).toFixed(2))))}
          title="Zoom In"
        >
          <ZoomIn size={14} />
        </button>
        <button
          className="btn btn-icon"
          onClick={() => { setZoom(1.0); setPan({ x: 0, y: 0 }); }}
          title="Reset Zoom (100%)"
        >
          <RotateCcw size={14} />
        </button>
        <button
          className="btn btn-icon"
          onClick={fitToView}
          title="Fit Canvas to Screen"
        >
          <Maximize2 size={14} />
        </button>
        <div style={{ width: '1px', height: '16px', backgroundColor: 'var(--border-color)', margin: '0 2px' }} />
        <button
          className={`btn btn-icon ${showGrid ? 'btn-primary' : ''}`}
          onClick={() => setShowGrid(!showGrid)}
          title="Toggle Alignment Guides & Grid"
        >
          <Grid size={14} />
        </button>
      </div>

      {/* Ratio Indicator Badge */}
      <div
        style={{
          position: 'absolute',
          top: '16px',
          left: '16px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(19, 23, 34, 0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid var(--border-color)',
          borderRadius: '6px',
          padding: '4px 10px',
          fontSize: '11px',
          color: 'var(--text-secondary)',
          zIndex: 10
        }}
      >
        <span>Aspect Ratio:</span>
        <strong style={{ color: 'var(--accent)', fontFamily: 'monospace' }}>21 : 31</strong>
        <span style={{ color: 'var(--text-muted)' }}>({artboardW} × {artboardH}px)</span>
      </div>

      {/* Artboard Container with Zoom & Pan */}
      <div
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'center center',
          transition: dragMode === 'pan' ? 'none' : 'transform 0.05s ease-out',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.1)',
          borderRadius: '4px',
          overflow: 'visible',
          position: 'relative',
          width: `${artboardW}px`,
          height: `${artboardH}px`,
          flexShrink: 0
        }}
      >
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            borderRadius: '4px',
            backgroundColor: backgroundColor || '#141721'
          }}
        />

        {/* Selected Layer Interactive Transform Box */}
        {renderTransformBox()}
      </div>
    </div>
  );
};

import React, { useEffect, useState, useRef, useCallback, useSyncExternalStore } from 'react';
import { defaultEngine } from './core/ProfileEngine.ts';
import type { ShapeDefinition, ColorPalette, Layer } from './core/types.ts';
import type { RenderMode } from './core/Renderer.ts';
import { Toolbar } from './components/Toolbar.tsx';
import { ShapeBrowser } from './components/ShapeBrowser.tsx';
import { CanvasView } from './components/CanvasView.tsx';
import { LayerInspector } from './components/LayerInspector.tsx';
import { LayerPanel } from './components/LayerPanel.tsx';
import { ReferenceModal } from './components/ReferenceModal.tsx';
import { ExportModal } from './components/ExportModal.tsx';
import { ShapeCalibrationView } from './components/calibration/ShapeCalibrationView.tsx';

export const App: React.FC = () => {
  const engine = defaultEngine;

  // Reactively subscribe to layer model changes and selection
  const subscribe = useCallback((cb: () => void) => engine.model.subscribe(cb), [engine]);
  const layers = useSyncExternalStore(subscribe, () => engine.model.getLayers());
  const selectedLayerId = useSyncExternalStore(subscribe, () => engine.model.getSelectedLayerId());
  const selectedLayer = layers.find(l => l.id === selectedLayerId) || null;
  const selectedShape = selectedLayer ? engine.getShape(selectedLayer.shapeAsset) : undefined;

  // Application view state
  const [activeView, setActiveView] = useState<'editor' | 'calibration'>('editor');

  // Application state
  const [shapes, setShapes] = useState<ShapeDefinition[]>([]);
  const [palettes, setPalettes] = useState<ColorPalette[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [projectName, setProjectName] = useState<string>('Epic7_Profile');
  const [backgroundColor, setBackgroundColor] = useState<string>('#141721');
  const [renderMode, setRenderMode] = useState<RenderMode>('raster');

  // Modals
  const [isExportOpen, setIsExportOpen] = useState<boolean>(false);
  const [isReferenceOpen, setIsReferenceOpen] = useState<boolean>(false);

  // Hidden file input for opening projects
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reference image state
  const [refConfig, setRefConfig] = useState(engine.getReferenceConfig());
  const [refImageElement, setRefImageElement] = useState<HTMLImageElement | null>(null);

  // Initialize assets and palettes
  useEffect(() => {
    let mounted = true;
    engine.initialize().then(() => {
      if (mounted) {
        setShapes(engine.getShapes());
        setPalettes(engine.getPalettes());
        setLoading(false);
      }
    }).catch(err => {
      console.error('Initialization error:', err);
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, [engine]);

  // Keyboard shortcut listener for editor view
  useEffect(() => {
    if (activeView !== 'editor') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'Escape') {
        engine.model.setSelectedLayerId(null);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedLayerId) {
          e.preventDefault();
          engine.deleteLayer(selectedLayerId);
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
        if (selectedLayerId && engine.canAddLayer()) {
          e.preventDefault();
          engine.duplicateLayer(selectedLayerId);
        }
      } else if (selectedLayer && !selectedLayer.locked) {
        const step = e.shiftKey ? 0.02 : 0.005;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          engine.updateLayer(selectedLayer.id, { x: parseFloat((selectedLayer.x - step).toFixed(4)) });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          engine.updateLayer(selectedLayer.id, { x: parseFloat((selectedLayer.x + step).toFixed(4)) });
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          engine.updateLayer(selectedLayer.id, { y: parseFloat((selectedLayer.y - step).toFixed(4)) });
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          engine.updateLayer(selectedLayer.id, { y: parseFloat((selectedLayer.y + step).toFixed(4)) });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeView, selectedLayerId, selectedLayer, engine]);

  // Handlers for layer operations
  const handleAddShape = (shapeId: string) => {
    try {
      engine.createLayer(shapeId, {
        color: palettes[0]?.colors[1] || '#586a8b'
      });
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleUpdateLayer = (updates: Partial<Layer>) => {
    if (selectedLayerId) {
      engine.updateLayer(selectedLayerId, updates);
    }
  };

  const handleDeleteLayer = (id?: string) => {
    const targetId = id || selectedLayerId;
    if (targetId) {
      engine.deleteLayer(targetId);
    }
  };

  const handleDuplicateLayer = (id?: string) => {
    const targetId = id || selectedLayerId;
    if (targetId) {
      try {
        engine.duplicateLayer(targetId);
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  const handleMoveLayer = (direction: 'up' | 'down' | 'top' | 'bottom', id?: string) => {
    const targetId = id || selectedLayerId;
    if (targetId) {
      engine.model.moveLayer(targetId, direction);
    }
  };

  // Project file operations
  const handleNewProject = () => {
    if (window.confirm('Start a new project? Any unsaved changes will be lost.')) {
      engine.clear();
      setProjectName('Epic7_Profile');
    }
  };

  const handleSaveProject = () => {
    const data = engine.toJSON();
    data.name = projectName;
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.toLowerCase().replace(/\s+/g, '_')}.e7profile.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleOpenProjectClick = () => {
    fileInputRef.current?.click();
  };

  const handleProjectFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        engine.loadJSON(json);
        if (json.name) setProjectName(json.name);
        if (json.canvas?.backgroundColor) setBackgroundColor(json.canvas.backgroundColor);
        setRefConfig(engine.getReferenceConfig());
      } catch (err: any) {
        alert(`Failed to load project file: ${err.message}`);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Reference image operations
  const handleUploadReference = (dataUrl: string, filename: string) => {
    engine.setReferenceImage(dataUrl, filename);
    const img = new Image();
    img.onload = () => {
      setRefImageElement(img);
      setRefConfig(engine.getReferenceConfig());
    };
    img.src = dataUrl;
  };

  const handleClearReference = () => {
    engine.clearReferenceImage();
    setRefImageElement(null);
    setRefConfig(engine.getReferenceConfig());
  };

  const handleUpdateReferenceConfig = (updates: Partial<typeof refConfig>) => {
    engine.updateReferenceConfig(updates);
    setRefConfig(engine.getReferenceConfig());
  };

  // PNG Export
  const handleExportPNG = async (width: number, includeRef: boolean) => {
    const blob = await engine.exportPNG(width, includeRef, renderMode);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName.toLowerCase().replace(/\s+/g, '_')}_${width}x${Math.round(width * (31/21))}.png`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          backgroundColor: 'var(--bg-main)',
          gap: '12px'
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 600 }}>Loading Epic 7 Shape Assets...</div>
        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Preprocessing masks & color palettes</div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--bg-main)'
      }}
    >
      {/* Hidden file input for loading project JSON */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".json,.e7profile.json"
        style={{ display: 'none' }}
        onChange={handleProjectFileChange}
      />

      {/* Top Toolbar with View Switcher */}
      <Toolbar
        projectName={projectName}
        onProjectNameChange={setProjectName}
        layerCount={layers.length}
        onNewProject={handleNewProject}
        onOpenProject={handleOpenProjectClick}
        onSaveProject={handleSaveProject}
        onOpenExportModal={() => setIsExportOpen(true)}
        onOpenReferenceModal={() => setIsReferenceOpen(true)}
        hasReference={!!refConfig.dataUrl}
        backgroundColor={backgroundColor}
        onBackgroundColorChange={(c) => {
          setBackgroundColor(c);
          engine.model.setBackgroundColor(c);
        }}
        activeView={activeView}
        onViewChange={setActiveView}
        renderMode={renderMode}
        onRenderModeChange={(m) => {
          setRenderMode(m);
          engine.setRenderMode(m);
        }}
      />

      {/* Main Workspace: Editor View vs Shape Calibration View */}
      {activeView === 'editor' ? (
        <>
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            {/* Left: Shape Library Browser */}
            <ShapeBrowser
              shapes={shapes}
              onAddShape={handleAddShape}
              canAdd={engine.canAddLayer()}
              layerCount={layers.length}
              maxLayers={engine.getMaxLayers()}
            />

            {/* Center: Interactive 21:31 Canvas View */}
            <CanvasView
              layers={layers}
              selectedLayer={selectedLayer}
              onSelectLayer={(id) => engine.model.setSelectedLayerId(id)}
              onUpdateLayer={(id, updates) => engine.updateLayer(id, updates)}
              getShape={(id) => engine.getShape(id)}
              backgroundColor={backgroundColor}
              referenceImage={refImageElement}
              referenceOpacity={refConfig.opacity}
              referenceFit={refConfig.fit}
              referenceVisible={refConfig.visible}
              renderMode={renderMode}
            />

            {/* Right Sidebar: Inspector (Top) + Layer Panel (Bottom) */}
            <div
              style={{
                width: '320px',
                backgroundColor: 'var(--bg-panel)',
                borderLeft: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'hidden'
              }}
            >
              {/* Upper Section: Inspector */}
              <div
                style={{
                  flex: '0 0 55%',
                  borderBottom: '1px solid var(--border-color)',
                  overflowY: 'auto'
                }}
              >
                <LayerInspector
                  layer={selectedLayer}
                  shape={selectedShape}
                  palettes={palettes}
                  onUpdate={handleUpdateLayer}
                  onDelete={handleDeleteLayer}
                  onDuplicate={handleDuplicateLayer}
                  onMove={handleMoveLayer}
                  canDuplicate={engine.canAddLayer()}
                />
              </div>

              {/* Lower Section: Layer Stacking Panel */}
              <div
                style={{
                  flex: '1 1 45%',
                  overflowY: 'auto'
                }}
              >
                <LayerPanel
                  layers={layers}
                  selectedId={selectedLayerId}
                  onSelect={(id) => engine.model.setSelectedLayerId(id)}
                  onUpdate={(id, updates) => engine.updateLayer(id, updates)}
                  onDelete={handleDeleteLayer}
                  onDuplicate={handleDuplicateLayer}
                  onReorder={(from, to) => engine.reorderLayer(from, to)}
                  onMove={(id, dir) => engine.model.moveLayer(id, dir)}
                  getShape={(id) => engine.getShape(id)}
                  canAdd={engine.canAddLayer()}
                />
              </div>
            </div>
          </div>

          {/* Bottom Status Bar */}
          <div
            style={{
              height: '24px',
              backgroundColor: '#0a0d14',
              borderTop: '1px solid var(--border-color)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 12px',
              fontSize: '11px',
              color: 'var(--text-muted)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span>
                Layers: <strong style={{ color: 'var(--text-primary)' }}>{layers.length} / {engine.getMaxLayers()}</strong>
              </span>
              <span>
                Artboard: <strong style={{ color: 'var(--text-primary)' }}>21:31</strong>
              </span>
              {selectedLayer && (
                <span>
                  Selected: <strong style={{ color: 'var(--accent)' }}>{selectedLayer.name}</strong> ({selectedLayer.shapeAsset})
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span>Arrows: Nudge position</span>
              <span>Shift+Drag: Keep Aspect / 15° Snap</span>
              <span>Middle-click: Pan</span>
              <span>Scroll: Zoom</span>
            </div>
          </div>
        </>
      ) : (
        /* Phase 2A Shape Calibration View */
        <ShapeCalibrationView />
      )}

      {/* Modals */}
      <ReferenceModal
        isOpen={isReferenceOpen}
        onClose={() => setIsReferenceOpen(false)}
        config={refConfig}
        onUpdateConfig={handleUpdateReferenceConfig}
        onUploadImage={handleUploadReference}
        onClearImage={handleClearReference}
      />

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        onExport={handleExportPNG}
        projectName={projectName}
      />
    </div>
  );
};

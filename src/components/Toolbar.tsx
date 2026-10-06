import React from 'react';
import { MAX_LAYERS } from '../core/types.ts';
import {
  FolderOpen,
  Save,
  Download,
  Image as ImageIcon,
  RotateCcw,
  Sparkles,
  Compass,
  Palette
} from 'lucide-react';

interface ToolbarProps {
  projectName: string;
  onProjectNameChange: (name: string) => void;
  layerCount: number;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveProject: () => void;
  onOpenExportModal: () => void;
  onOpenReferenceModal: () => void;
  hasReference: boolean;
  backgroundColor: string;
  onBackgroundColorChange: (color: string) => void;
  activeView: 'editor' | 'calibration';
  onViewChange: (view: 'editor' | 'calibration') => void;
  renderMode?: import('../core/Renderer.ts').RenderMode;
  onRenderModeChange?: (mode: import('../core/Renderer.ts').RenderMode) => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  projectName,
  onProjectNameChange,
  layerCount,
  onNewProject,
  onOpenProject,
  onSaveProject,
  onOpenExportModal,
  onOpenReferenceModal,
  hasReference,
  backgroundColor,
  onBackgroundColorChange,
  activeView,
  onViewChange,
  renderMode = 'raster',
  onRenderModeChange
}) => {
  const isNearLimit = layerCount >= MAX_LAYERS - 10;
  const isAtLimit = layerCount >= MAX_LAYERS;

  return (
    <div
      style={{
        height: '48px',
        backgroundColor: 'var(--bg-panel)',
        borderBottom: '1px solid var(--border-color)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        zIndex: 20
      }}
    >
      {/* Brand & Project Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 2px 8px rgba(59, 130, 246, 0.4)'
            }}
          >
            <Sparkles size={16} color="#ffffff" />
          </div>
          <span style={{ fontWeight: 700, fontSize: '13px', letterSpacing: '0.02em', color: '#ffffff' }}>
            Epic 7 Studio
          </span>
        </div>

        <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)' }} />

        {/* View Mode Switcher */}
        <div
          style={{
            display: 'flex',
            backgroundColor: 'var(--bg-card)',
            borderRadius: '6px',
            padding: '2px',
            border: '1px solid var(--border-color)'
          }}
        >
          <button
            onClick={() => onViewChange('editor')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeView === 'editor' ? 'var(--accent)' : 'transparent',
              color: activeView === 'editor' ? '#ffffff' : 'var(--text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            <Palette size={13} />
            <span>Profile Editor</span>
          </button>
          <button
            onClick={() => onViewChange('calibration')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '4px',
              fontSize: '11px',
              fontWeight: 600,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeView === 'calibration' ? 'var(--accent)' : 'transparent',
              color: activeView === 'calibration' ? '#ffffff' : 'var(--text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            <Compass size={13} />
            <span>Shape Calibration</span>
          </button>
        </div>

        {activeView === 'editor' && (
          <>
            <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)' }} />
            {/* Project Title Input */}
            <input
              type="text"
              value={projectName}
              onChange={(e) => onProjectNameChange(e.target.value)}
              placeholder="Project Name"
              style={{
                fontSize: '12px',
                fontWeight: 500,
                width: '160px',
                backgroundColor: 'transparent',
                border: '1px solid transparent',
                color: 'var(--text-primary)'
              }}
              onFocus={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                e.currentTarget.style.borderColor = 'var(--border-color)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.backgroundColor = 'transparent';
                e.currentTarget.style.borderColor = 'transparent';
              }}
            />
          </>
        )}
      </div>

      {/* Center Actions: File & Tools for Editor */}
      {activeView === 'editor' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button className="btn" onClick={onNewProject} title="New Canvas">
            <RotateCcw size={13} />
            <span>New</span>
          </button>
          <button className="btn" onClick={onOpenProject} title="Open JSON Project">
            <FolderOpen size={13} />
            <span>Open</span>
          </button>
          <button className="btn" onClick={onSaveProject} title="Save JSON Project">
            <Save size={13} />
            <span>Save</span>
          </button>

          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

          <button
            className={`btn ${hasReference ? 'btn-primary' : ''}`}
            onClick={onOpenReferenceModal}
            title="Reference Image Overlay"
          >
            <ImageIcon size={13} />
            <span>Reference</span>
          </button>

          {/* Card Background Color Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '6px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Card Bg:</span>
            <div
              style={{
                position: 'relative',
                width: '20px',
                height: '20px',
                borderRadius: '4px',
                border: '1px solid var(--border-color)',
                overflow: 'hidden',
                cursor: 'pointer'
              }}
              title="Card Background Color"
            >
              <div style={{ width: '100%', height: '100%', backgroundColor }} />
              <input
                type="color"
                value={backgroundColor}
                onChange={(e) => onBackgroundColorChange(e.target.value)}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer'
                }}
              />
            </div>
          </div>

          <div style={{ width: '1px', height: '20px', backgroundColor: 'var(--border-color)', margin: '0 4px' }} />

          {/* Render Mode A/B Switcher */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }} title="A/B Render Engine Selector">
              Render:
            </span>
            <div
              style={{
                display: 'flex',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '5px',
                padding: '2px',
                border: '1px solid var(--border-color)'
              }}
            >
              {(['raster', 'mathematical', 'auto'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => onRenderModeChange?.(m)}
                  title={
                    m === 'raster'
                      ? 'Raster Mode: Authoritative PNG masks (Phase 1 default)'
                      : m === 'mathematical'
                      ? 'Mathematical Mode: Analytic & vector primitives (Phase 2B)'
                      : 'Auto Mode: Automatic primitive selection'
                  }
                  style={{
                    padding: '2px 8px',
                    fontSize: '11px',
                    fontWeight: 600,
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer',
                    backgroundColor: renderMode === m ? 'var(--accent)' : 'transparent',
                    color: renderMode === m ? '#ffffff' : 'var(--text-muted)',
                    textTransform: 'capitalize'
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
          <span style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)', fontFamily: 'monospace' }}>
            Phase 2: Shape Calibration & Mathematical Equivalence (Phase 2A & 2B)
          </span>
        </div>
      )}

      {/* Right Side: Layer Counter Badge & Export Button */}
      {activeView === 'editor' ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {/* Layer Counter with Visual Progress Bar */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '2px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Layers:</span>
              <span
                style={{
                  fontSize: '12px',
                  fontFamily: 'monospace',
                  fontWeight: 700,
                  color: isAtLimit ? 'var(--danger)' : isNearLimit ? 'var(--warning)' : '#ffffff'
                }}
              >
                {layerCount} / {MAX_LAYERS}
              </span>
            </div>
            <div
              style={{
                width: '90px',
                height: '4px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '2px',
                overflow: 'hidden'
              }}
            >
              <div
                style={{
                  width: `${(layerCount / MAX_LAYERS) * 100}%`,
                  height: '100%',
                  backgroundColor: isAtLimit ? 'var(--danger)' : isNearLimit ? 'var(--warning)' : 'var(--accent)',
                  transition: 'width 0.2s ease'
                }}
              />
            </div>
          </div>

          {/* PNG Export Button */}
          <button className="btn btn-primary" onClick={onOpenExportModal} title="Export PNG (21:31)">
            <Download size={13} />
            <span>Export PNG</span>
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            Authority: Source PNGs in Shapes_Colors
          </span>
        </div>
      )}
    </div>
  );
};

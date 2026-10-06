import React, { useState } from 'react';
import { Layer, ShapeDefinition, ColorPalette } from '../core/types.ts';
import { PalettePicker } from './PalettePicker.tsx';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  ArrowUp,
  ArrowDown,
  ChevronsUp,
  ChevronsDown,
  Link,
  Unlink,
  Sliders
} from 'lucide-react';

interface LayerInspectorProps {
  layer: Layer | null;
  shape: ShapeDefinition | undefined;
  palettes: ColorPalette[];
  onUpdate: (updates: Partial<Layer>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onMove: (direction: 'up' | 'down' | 'top' | 'bottom') => void;
  canDuplicate: boolean;
}

export const LayerInspector: React.FC<LayerInspectorProps> = ({
  layer,
  shape,
  palettes,
  onUpdate,
  onDelete,
  onDuplicate,
  onMove,
  canDuplicate
}) => {
  const [aspectLocked, setAspectLocked] = useState(false);

  if (!layer) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          padding: '24px',
          color: 'var(--text-muted)',
          textAlign: 'center',
          fontSize: '12px',
          gap: '8px'
        }}
      >
        <Sliders size={24} style={{ opacity: 0.4 }} />
        <span>No shape selected</span>
        <span style={{ fontSize: '11px', color: '#4b5563' }}>
          Select a shape on the canvas or from the layer list to edit its properties
        </span>
      </div>
    );
  }

  const handleScaleXChange = (newScaleX: number) => {
    if (aspectLocked && layer.scaleX !== 0) {
      const ratio = newScaleX / layer.scaleX;
      onUpdate({ scaleX: newScaleX, scaleY: parseFloat((layer.scaleY * ratio).toFixed(3)) });
    } else {
      onUpdate({ scaleX: newScaleX });
    }
  };

  const handleScaleYChange = (newScaleY: number) => {
    if (aspectLocked && layer.scaleY !== 0) {
      const ratio = newScaleY / layer.scaleY;
      onUpdate({ scaleY: newScaleY, scaleX: parseFloat((layer.scaleX * ratio).toFixed(3)) });
    } else {
      onUpdate({ scaleY: newScaleY });
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        overflowY: 'auto',
        padding: '12px',
        gap: '14px',
        fontSize: '12px'
      }}
    >
      {/* Layer Header: Name & Quick Actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <input
            type="text"
            value={layer.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
            style={{
              fontWeight: 600,
              fontSize: '13px',
              flex: 1
            }}
          />
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              className={`btn btn-icon ${layer.locked ? 'btn-primary' : ''}`}
              onClick={() => onUpdate({ locked: !layer.locked })}
              title={layer.locked ? 'Unlock Layer' : 'Lock Layer'}
            >
              {layer.locked ? <Lock size={13} /> : <Unlock size={13} />}
            </button>
            <button
              className="btn btn-icon"
              onClick={() => onUpdate({ visible: !layer.visible })}
              title={layer.visible ? 'Hide Layer' : 'Show Layer'}
            >
              {layer.visible ? <Eye size={13} /> : <EyeOff size={13} color="var(--text-muted)" />}
            </button>
            <button
              className="btn btn-icon"
              onClick={onDuplicate}
              disabled={!canDuplicate}
              title="Duplicate Layer"
            >
              <Copy size={13} />
            </button>
            <button
              className="btn btn-icon btn-danger"
              onClick={onDelete}
              title="Delete Layer"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>

        {shape && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', backgroundColor: 'var(--bg-card)', borderRadius: '4px' }}>
            <img src={shape.getThumbnail(32) as string} alt="" style={{ width: '20px', height: '20px' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Asset: {shape.name}</span>
          </div>
        )}
      </div>

      {/* Transform Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
          Transform
        </span>

        {/* Position X and Y */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
              X (0.00 - 1.00)
            </label>
            <input
              type="number"
              step="0.01"
              value={layer.x}
              disabled={layer.locked}
              onChange={(e) => onUpdate({ x: parseFloat(e.target.value) || 0 })}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: '10px', color: 'var(--text-muted)', display: 'block', marginBottom: '2px' }}>
              Y (0.00 - 1.00)
            </label>
            <input
              type="number"
              step="0.01"
              value={layer.y}
              disabled={layer.locked}
              onChange={(e) => onUpdate({ y: parseFloat(e.target.value) || 0 })}
              style={{ width: '100%' }}
            />
          </div>
        </div>

        {/* Scale X and Scale Y with Aspect Lock */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
              Scale (Independent Stretch)
            </label>
            <button
              onClick={() => setAspectLocked(!aspectLocked)}
              title={aspectLocked ? 'Aspect Ratio Locked' : 'Aspect Ratio Unlocked (Independent Stretch)'}
              style={{
                background: 'none',
                border: 'none',
                color: aspectLocked ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                fontSize: '10px'
              }}
            >
              {aspectLocked ? <Link size={11} /> : <Unlink size={11} />}
              {aspectLocked ? 'Locked' : 'Free'}
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Scale X:</span>
              <input
                type="number"
                step="0.05"
                min="0.01"
                max="20"
                value={layer.scaleX}
                disabled={layer.locked}
                onChange={(e) => handleScaleXChange(parseFloat(e.target.value) || 0.01)}
                style={{ width: '100%', marginTop: '2px' }}
              />
            </div>
            <div>
              <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>Scale Y:</span>
              <input
                type="number"
                step="0.05"
                min="0.01"
                max="20"
                value={layer.scaleY}
                disabled={layer.locked}
                onChange={(e) => handleScaleYChange(parseFloat(e.target.value) || 0.01)}
                style={{ width: '100%', marginTop: '2px' }}
              />
            </div>
          </div>
        </div>

        {/* Rotation */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Rotation</label>
            <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{Math.round(layer.rotation)}°</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={layer.rotation}
              disabled={layer.locked}
              onChange={(e) => onUpdate({ rotation: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <input
              type="number"
              step="1"
              value={Math.round(layer.rotation)}
              disabled={layer.locked}
              onChange={(e) => onUpdate({ rotation: parseFloat(e.target.value) || 0 })}
              style={{ width: '56px' }}
            />
          </div>
        </div>

        {/* Opacity */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2px' }}>
            <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Opacity</label>
            <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{Math.round(layer.opacity * 100)}%</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={layer.opacity}
              disabled={layer.locked}
              onChange={(e) => onUpdate({ opacity: parseFloat(e.target.value) })}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
            <input
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={layer.opacity}
              disabled={layer.locked}
              onChange={(e) => onUpdate({ opacity: Math.max(0, Math.min(1, parseFloat(e.target.value) || 0)) })}
              style={{ width: '56px' }}
            />
          </div>
        </div>
      </div>

      {/* Stacking Order Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
          Order
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '4px' }}>
          <button className="btn btn-icon" onClick={() => onMove('top')} title="Bring to Front">
            <ChevronsUp size={13} />
          </button>
          <button className="btn btn-icon" onClick={() => onMove('up')} title="Bring Forward">
            <ArrowUp size={13} />
          </button>
          <button className="btn btn-icon" onClick={() => onMove('down')} title="Send Backward">
            <ArrowDown size={13} />
          </button>
          <button className="btn btn-icon" onClick={() => onMove('bottom')} title="Send to Back">
            <ChevronsDown size={13} />
          </button>
        </div>
      </div>

      {/* Color & Palette Section */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
          Color & Palette
        </span>
        <PalettePicker
          color={layer.color}
          onChange={(newColor) => onUpdate({ color: newColor })}
          palettes={palettes}
        />
      </div>
    </div>
  );
};

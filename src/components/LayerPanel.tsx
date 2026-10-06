import React, { useState } from 'react';
import { Layer, ShapeDefinition, MAX_LAYERS } from '../core/types.ts';
import {
  Eye,
  EyeOff,
  Lock,
  Unlock,
  Trash2,
  Copy,
  ChevronUp,
  ChevronDown,
  Layers as LayersIcon
} from 'lucide-react';

interface LayerPanelProps {
  layers: readonly Layer[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUpdate: (id: string, updates: Partial<Layer>) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
  getShape: (id: string) => ShapeDefinition | undefined;
  canAdd: boolean;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  selectedId,
  onSelect,
  onUpdate,
  onDelete,
  onDuplicate,
  onMove,
  getShape,
  canAdd
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Stacking order in layers array: index 0 is bottom, index N-1 is top.
  // In UI, top-most layer is displayed at the top of the list:
  const reversedLayers = [...layers].map((layer, originalIndex) => ({
    layer,
    originalIndex
  })).reverse();

  const handleStartRename = (layer: Layer) => {
    setEditingId(layer.id);
    setEditName(layer.name);
  };

  const handleFinishRename = (id: string) => {
    if (editName.trim()) {
      onUpdate(id, { name: editName.trim() });
    }
    setEditingId(null);
  };

  const count = layers.length;
  const isNearLimit = count >= MAX_LAYERS - 10;
  const isAtLimit = count >= MAX_LAYERS;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'var(--bg-panel)',
        overflow: 'hidden'
      }}
    >
      {/* Header with Layer Counter */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
          <LayersIcon size={14} color="var(--accent)" />
          Layers
        </span>
        <div
          style={{
            fontSize: '11px',
            fontFamily: 'monospace',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: '12px',
            backgroundColor: isAtLimit ? 'rgba(239,68,68,0.2)' : isNearLimit ? 'rgba(245,158,11,0.2)' : 'var(--bg-card)',
            color: isAtLimit ? 'var(--danger)' : isNearLimit ? 'var(--warning)' : 'var(--text-secondary)',
            border: `1px solid ${isAtLimit ? 'var(--danger)' : isNearLimit ? 'var(--warning)' : 'var(--border-color)'}`
          }}
        >
          {count} / {MAX_LAYERS}
        </div>
      </div>

      {/* Layer List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '4px'
        }}
      >
        {reversedLayers.map(({ layer, originalIndex }) => {
          const isSelected = layer.id === selectedId;
          const shape = getShape(layer.shapeAsset);
          const thumb = shape ? shape.getThumbnail(24) : null;

          return (
            <div
              key={layer.id}
              onClick={() => onSelect(layer.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 8px',
                borderRadius: '6px',
                marginBottom: '2px',
                backgroundColor: isSelected ? 'var(--bg-hover)' : 'transparent',
                border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                cursor: 'pointer',
                opacity: layer.visible ? 1 : 0.45,
                transition: 'all 0.1s ease'
              }}
            >
              {/* Shape preview swatch */}
              <div
                style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-card)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: '1px solid var(--border-color)',
                  flexShrink: 0
                }}
              >
                {thumb ? (
                  <img src={thumb as string} alt="" style={{ width: '18px', height: '18px', objectFit: 'contain' }} />
                ) : (
                  <div style={{ width: '12px', height: '12px', backgroundColor: layer.color, borderRadius: '2px' }} />
                )}
              </div>

              {/* Color dot */}
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: layer.color,
                  border: '1px solid rgba(255,255,255,0.2)',
                  flexShrink: 0
                }}
                title={`Color: ${layer.color}`}
              />

              {/* Layer Name / Renaming */}
              <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
                {editingId === layer.id ? (
                  <input
                    type="text"
                    value={editName}
                    autoFocus
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={() => handleFinishRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleFinishRename(layer.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      width: '100%',
                      padding: '2px 4px',
                      fontSize: '11px',
                      height: '20px'
                    }}
                  />
                ) : (
                  <div
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleStartRename(layer);
                    }}
                    title="Double-click to rename"
                    style={{
                      fontSize: '11px',
                      fontWeight: isSelected ? 600 : 400,
                      color: isSelected ? '#ffffff' : 'var(--text-primary)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {layer.name}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                {/* Reorder Up / Down */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(layer.id, 'up');
                  }}
                  disabled={originalIndex === layers.length - 1}
                  title="Move Up"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: originalIndex === layers.length - 1 ? 'default' : 'pointer',
                    opacity: originalIndex === layers.length - 1 ? 0.2 : 0.8,
                    padding: '2px'
                  }}
                >
                  <ChevronUp size={13} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(layer.id, 'down');
                  }}
                  disabled={originalIndex === 0}
                  title="Move Down"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: originalIndex === 0 ? 'default' : 'pointer',
                    opacity: originalIndex === 0 ? 0.2 : 0.8,
                    padding: '2px'
                  }}
                >
                  <ChevronDown size={13} />
                </button>

                {/* Lock */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(layer.id, { locked: !layer.locked });
                  }}
                  title={layer.locked ? 'Unlock' : 'Lock'}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: layer.locked ? 'var(--accent)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px'
                  }}
                >
                  {layer.locked ? <Lock size={12} /> : <Unlock size={12} style={{ opacity: 0.4 }} />}
                </button>

                {/* Visibility */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUpdate(layer.id, { visible: !layer.visible });
                  }}
                  title={layer.visible ? 'Hide' : 'Show'}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: layer.visible ? 'var(--text-secondary)' : 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px'
                  }}
                >
                  {layer.visible ? <Eye size={12} /> : <EyeOff size={12} style={{ opacity: 0.4 }} />}
                </button>

                {/* Duplicate */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDuplicate(layer.id);
                  }}
                  disabled={!canAdd}
                  title="Duplicate"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: canAdd ? 'pointer' : 'default',
                    opacity: canAdd ? 0.8 : 0.2,
                    padding: '2px'
                  }}
                >
                  <Copy size={12} />
                </button>

                {/* Delete */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(layer.id);
                  }}
                  title="Delete"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px'
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = 'var(--danger)'}
                  onMouseLeave={(e) => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}

        {layers.length === 0 && (
          <div
            style={{
              padding: '24px 12px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '11px',
              lineHeight: 1.5
            }}
          >
            No layers yet.<br />Click any shape in the library to add your first layer.
          </div>
        )}
      </div>
    </div>
  );
};

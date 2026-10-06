import React, { useState } from 'react';
import { ShapeDefinition } from '../core/types.ts';
import { Search, Plus, Layers } from 'lucide-react';

interface ShapeBrowserProps {
  shapes: ShapeDefinition[];
  onAddShape: (shapeId: string) => void;
  canAdd: boolean;
  layerCount: number;
  maxLayers: number;
}

export const ShapeBrowser: React.FC<ShapeBrowserProps> = ({
  shapes,
  onAddShape,
  canAdd,
  layerCount,
  maxLayers
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredShapes = shapes.filter(s =>
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '240px',
        backgroundColor: 'var(--bg-panel)',
        borderRight: '1px solid var(--border-color)',
        height: '100%',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px',
          borderBottom: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.02em', display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Layers size={14} color="var(--accent)" />
            Shape Library
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {shapes.length} primitives
          </span>
        </div>

        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-muted)'
            }}
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search shapes..."
            style={{
              width: '100%',
              paddingLeft: '26px',
              fontSize: '11px'
            }}
          />
        </div>
      </div>

      {/* Warning if layer limit reached */}
      {!canAdd && (
        <div
          style={{
            margin: '8px 12px 0 12px',
            padding: '8px',
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: '4px',
            fontSize: '11px',
            color: 'var(--danger)',
            lineHeight: 1.4
          }}
        >
          Maximum limit of {maxLayers} layers reached. Delete a layer to add more.
        </div>
      )}

      {/* Shape Grid */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '10px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: '8px',
          alignContent: 'start'
        }}
      >
        {filteredShapes.map((shape) => {
          const thumb = shape.getThumbnail(72);
          return (
            <button
              key={shape.id}
              onClick={() => onAddShape(shape.id)}
              disabled={!canAdd}
              title={`Click to add ${shape.name}`}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                backgroundColor: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                padding: '8px 4px',
                cursor: canAdd ? 'pointer' : 'not-allowed',
                opacity: canAdd ? 1 : 0.5,
                transition: 'all 0.15s ease',
                position: 'relative'
              }}
              onMouseEnter={(e) => {
                if (canAdd) {
                  e.currentTarget.style.borderColor = 'var(--border-highlight)';
                  e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  e.currentTarget.style.transform = 'translateY(-1px)';
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: '6px',
                  position: 'relative'
                }}
              >
                <img
                  src={typeof thumb === 'string' ? thumb : ''}
                  alt={shape.name}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '100%',
                    objectFit: 'contain',
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))'
                  }}
                />
                {canAdd && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'var(--accent)',
                      borderRadius: '50%',
                      width: '18px',
                      height: '18px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.4)'
                    }}
                  >
                    <Plus size={12} color="#ffffff" />
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  color: 'var(--text-primary)',
                  textAlign: 'center',
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  padding: '0 4px'
                }}
              >
                {shape.name}
              </span>
            </button>
          );
        })}

        {filteredShapes.length === 0 && (
          <div
            style={{
              gridColumn: '1 / -1',
              padding: '24px 8px',
              textAlign: 'center',
              color: 'var(--text-muted)',
              fontSize: '12px'
            }}
          >
            No shapes match &quot;{searchTerm}&quot;
          </div>
        )}
      </div>

      {/* Footer info */}
      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid var(--border-color)',
          fontSize: '11px',
          color: 'var(--text-muted)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>Click shape to add</span>
        <span>{layerCount}/{maxLayers}</span>
      </div>
    </div>
  );
};

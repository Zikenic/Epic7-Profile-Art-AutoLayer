import React, { useState } from 'react';
import type { ShapeCalibrationResult } from '../../calibration/types.ts';
import { ShapeDefinition } from '../../core/types.ts';
import { Search, Compass } from 'lucide-react';

interface CalibrationShapeListProps {
  shapes: ShapeDefinition[];
  calibrations: Record<string, ShapeCalibrationResult>;
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
}

export const CalibrationShapeList: React.FC<CalibrationShapeListProps> = ({
  shapes,
  calibrations,
  selectedAssetId,
  onSelectAsset
}) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = shapes.filter(
    (s) =>
      s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '260px',
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
          <span style={{ fontSize: '13px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Compass size={14} color="var(--accent)" />
            Calibration Assets
          </span>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
            {shapes.length} shapes
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
            placeholder="Filter shapes..."
            style={{
              width: '100%',
              paddingLeft: '26px',
              fontSize: '11px'
            }}
          />
        </div>
      </div>

      {/* List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '6px'
        }}
      >
        {filtered.map((s) => {
          const isSelected = s.id === selectedAssetId;
          const cal = calibrations[s.id];
          const thumb = s.getThumbnail(40);

          return (
            <div
              key={s.id}
              onClick={() => onSelectAsset(s.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '8px',
                borderRadius: '6px',
                marginBottom: '4px',
                cursor: 'pointer',
                backgroundColor: isSelected ? 'var(--bg-hover)' : 'transparent',
                border: isSelected ? '1px solid var(--accent)' : '1px solid transparent',
                transition: 'all 0.12s ease'
              }}
            >
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0
                }}
              >
                <img src={thumb as string} alt="" style={{ maxWidth: '28px', maxHeight: '28px', objectFit: 'contain' }} />
              </div>

              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? '#ffffff' : 'var(--text-primary)' }}>
                    {s.name}
                  </span>
                  <span style={{ fontSize: '10px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {s.width}×{s.height}
                  </span>
                </div>

                {cal && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
                    <span
                      style={{
                        padding: '1px 4px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--bg-card)',
                        color: 'var(--accent)',
                        fontFamily: 'monospace'
                      }}
                    >
                      {cal.candidatePrimitive.type.replace('_', ' ')}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      H:{Math.round(cal.symmetry.horizontal)}% V:{Math.round(cal.symmetry.vertical)}%
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

import React, { useState } from 'react';
import { ColorPalette } from '../core/types.ts';
import { Pipette } from 'lucide-react';

interface PalettePickerProps {
  color: string;
  onChange: (color: string) => void;
  palettes: ColorPalette[];
}

export const PalettePicker: React.FC<PalettePickerProps> = ({ color, onChange, palettes }) => {
  const [activeTab, setActiveTab] = useState<string>(palettes[0]?.id || 'Color_Palette_1');

  const currentPalette = palettes.find(p => p.id === activeTab) || palettes[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {/* Current color display & custom input */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div style={{ position: 'relative', width: '32px', height: '32px', borderRadius: '4px', overflow: 'hidden', border: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{ width: '100%', height: '100%', backgroundColor: color }} />
          <input
            type="color"
            value={color.startsWith('#') ? color : '#586a8b'}
            onChange={(e) => onChange(e.target.value)}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              opacity: 0,
              cursor: 'pointer'
            }}
            title="Choose custom color"
          />
        </div>
        <input
          type="text"
          value={color.toUpperCase()}
          onChange={(e) => {
            const val = e.target.value;
            if (/^#[0-9A-Fa-f]{0,6}$/.test(val)) {
              onChange(val);
            }
          }}
          placeholder="#HEX"
          style={{ width: '80px', textTransform: 'uppercase' }}
        />
        <span style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <Pipette size={12} /> Custom
        </span>
      </div>

      {/* Palette tabs */}
      {palettes.length > 1 && (
        <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border-color)', paddingBottom: '4px' }}>
          {palettes.map((p) => (
            <button
              key={p.id}
              onClick={() => setActiveTab(p.id)}
              style={{
                background: activeTab === p.id ? 'var(--bg-hover)' : 'transparent',
                border: 'none',
                color: activeTab === p.id ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: '11px',
                fontWeight: 600,
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Swatches grid */}
      {currentPalette && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: currentPalette.id === 'Color_Palette_2' ? 'repeat(5, 1fr)' : 'repeat(7, 1fr)',
            gap: '4px',
            backgroundColor: 'var(--bg-card)',
            padding: '6px',
            borderRadius: '6px',
            border: '1px solid var(--border-color)'
          }}
        >
          {currentPalette.colors.map((hex, idx) => {
            const isSelected = hex.toLowerCase() === color.toLowerCase();
            return (
              <button
                key={`${hex}-${idx}`}
                onClick={() => onChange(hex)}
                title={hex.toUpperCase()}
                style={{
                  width: '100%',
                  aspectRatio: '1',
                  backgroundColor: hex,
                  borderRadius: '3px',
                  border: isSelected ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: isSelected ? '0 0 0 1px var(--accent), 0 2px 4px rgba(0,0,0,0.5)' : 'none',
                  cursor: 'pointer',
                  transform: isSelected ? 'scale(1.1)' : 'scale(1)',
                  transition: 'transform 0.1s ease',
                  zIndex: isSelected ? 2 : 1
                }}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};

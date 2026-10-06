import React, { useState } from 'react';
import type { PaletteAnalysisDetail, ColorSwatchDetail } from '../../calibration/types.ts';
import { X, Copy, Check } from 'lucide-react';

interface PaletteAnalysisModalProps {
  isOpen: boolean;
  onClose: () => void;
  palettes: Record<string, PaletteAnalysisDetail>;
}

export const PaletteAnalysisModal: React.FC<PaletteAnalysisModalProps> = ({
  isOpen,
  onClose,
  palettes
}) => {
  const [selectedColor, setSelectedColor] = useState<ColorSwatchDetail | null>(null);
  const [copiedHex, setCopiedHex] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCopy = (hex: string) => {
    navigator.clipboard.writeText(hex);
    setCopiedHex(hex);
    setTimeout(() => setCopiedHex(null), 1500);
  };

  const paletteList = Object.values(palettes);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '740px',
          maxHeight: '90vh',
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          boxShadow: '0 25px 50px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-card)'
          }}
        >
          <div>
            <span style={{ fontWeight: 700, fontSize: '14px' }}>Epic Seven Color Palette Analysis</span>
            <span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '12px' }}>
              Extracted directly from authoritative game assets
            </span>
          </div>
          <button className="btn btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Content Body */}
        <div
          style={{
            padding: '18px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px'
          }}
        >
          {paletteList.map((pal) => (
            <div
              key={pal.id}
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '14px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: '13px', color: '#ffffff' }}>
                  {pal.id.replace(/_/g, ' ')} ({pal.colors.length} swatches)
                </span>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                  Grid: {pal.grid.cols} cols × {pal.grid.rows} rows (60×60px swatches, 90px pitch)
                </span>
              </div>

              {/* Swatch Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${pal.grid.cols}, 1fr)`,
                  gap: '6px',
                  backgroundColor: '#0a0d14',
                  padding: '10px',
                  borderRadius: '6px'
                }}
              >
                {pal.colors.map((c) => {
                  const isSelected = selectedColor?.hex === c.hex && selectedColor?.palette === c.palette;
                  return (
                    <div
                      key={`${c.palette}-${c.index}`}
                      onClick={() => setSelectedColor(c)}
                      title={`${c.hex.toUpperCase()} (Row ${c.row}, Col ${c.col})`}
                      style={{
                        aspectRatio: '1',
                        backgroundColor: c.hex,
                        borderRadius: '4px',
                        cursor: 'pointer',
                        border: isSelected ? '2px solid #ffffff' : '1px solid rgba(255,255,255,0.15)',
                        boxShadow: isSelected ? '0 0 0 2px var(--accent)' : 'none',
                        transform: isSelected ? 'scale(1.08)' : 'scale(1)',
                        transition: 'transform 0.1s ease',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'flex-end',
                        padding: '2px'
                      }}
                    >
                      <span
                        style={{
                          fontSize: '8px',
                          fontFamily: 'monospace',
                          color: '#ffffff',
                          textShadow: '0 1px 2px #000000',
                          opacity: 0.7
                        }}
                      >
                        {c.row},{c.col}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Color Details Panel */}
          {selectedColor ? (
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '14px',
                borderRadius: '8px',
                border: '1px solid var(--border-highlight)',
                display: 'flex',
                alignItems: 'center',
                gap: '16px'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '6px',
                  backgroundColor: selectedColor.hex,
                  border: '1px solid rgba(255,255,255,0.2)',
                  flexShrink: 0
                }}
              />

              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', fontSize: '11px', fontFamily: 'monospace' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>HEX</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <strong style={{ fontSize: '13px', color: '#ffffff' }}>{selectedColor.hex.toUpperCase()}</strong>
                    <button
                      className="btn btn-icon"
                      onClick={() => handleCopy(selectedColor.hex)}
                      style={{ padding: '2px 4px' }}
                      title="Copy Hex"
                    >
                      {copiedHex === selectedColor.hex ? <Check size={11} color="var(--success)" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>RGB</span>
                  <strong>{selectedColor.rgb.r}, {selectedColor.rgb.g}, {selectedColor.rgb.b}</strong>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>Position</span>
                  <span>Row: {selectedColor.row}, Col: {selectedColor.col}</span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>HSV</span>
                  <span>{selectedColor.hsv.h}°, {selectedColor.hsv.s}%, {selectedColor.hsv.v}%</span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>HSL</span>
                  <span>{selectedColor.hsl.h}°, {selectedColor.hsl.s}%, {selectedColor.hsl.l}%</span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block' }}>Palette</span>
                  <span>{selectedColor.palette}</span>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', fontSize: '11px', color: 'var(--text-muted)', padding: '6px' }}>
              Click any color swatch above to inspect its exact RGB, HSV, HSL and coordinates
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', backgroundColor: 'var(--bg-card)' }}>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

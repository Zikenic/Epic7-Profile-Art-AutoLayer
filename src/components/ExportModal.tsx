import React, { useState } from 'react';
import { CANVAS_ASPECT_RATIO } from '../core/types.ts';
import { Download, X, Check } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExport: (width: number, includeReference: boolean) => Promise<void>;
  projectName: string;
}

const PRESETS = [
  { label: '1x Standard', width: 420, height: 620, desc: 'Compact preview size' },
  { label: '2x High-Def (Recommended)', width: 840, height: 1240, desc: 'Native crisp resolution' },
  { label: '4x Ultra HD', width: 1680, height: 2480, desc: 'Highest quality for showcases' }
];

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  onExport,
  projectName
}) => {
  const [selectedWidth, setSelectedWidth] = useState<number>(840);
  const [includeReference, setIncludeReference] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  if (!isOpen) return null;

  const currentHeight = Math.round(selectedWidth / CANVAS_ASPECT_RATIO);

  const handleDownload = async () => {
    setIsExporting(true);
    try {
      await onExport(selectedWidth, includeReference);
      onClose();
    } catch (err) {
      console.error('Export failed', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '460px',
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: '10px',
          boxShadow: '0 20px 40px rgba(0,0,0,0.6)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Export PNG Card</span>
          <button className="btn btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)' }}>
              Select Resolution (Exact 21:31 Aspect Ratio)
            </span>
            <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--accent)' }}>
              {selectedWidth} × {currentHeight} px
            </span>
          </div>

          {/* Preset Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {PRESETS.map((p) => {
              const isSelected = selectedWidth === p.width;
              return (
                <div
                  key={p.width}
                  onClick={() => setSelectedWidth(p.width)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    backgroundColor: isSelected ? 'var(--bg-hover)' : 'var(--bg-card)',
                    border: isSelected ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: isSelected ? '#ffffff' : 'var(--text-primary)' }}>
                      {p.label}
                    </span>
                    <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                      {p.desc}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                      {p.width} × {p.height}
                    </span>
                    {isSelected && <Check size={14} color="var(--accent)" />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Width Input */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', paddingTop: '4px' }}>
            <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Custom Width (px):</span>
            <input
              type="number"
              step="10"
              min="210"
              max="4200"
              value={selectedWidth}
              onChange={(e) => setSelectedWidth(Math.max(100, parseInt(e.target.value) || 840))}
              style={{ width: '120px' }}
            />
          </div>

          {/* Reference Image in Export Checkbox */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
            <input
              type="checkbox"
              id="exportRef"
              checked={includeReference}
              onChange={(e) => setIncludeReference(e.target.checked)}
            />
            <label htmlFor="exportRef" style={{ fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Include reference image background in exported PNG
            </label>
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
          <button className="btn" onClick={onClose} disabled={isExporting}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleDownload} disabled={isExporting}>
            <Download size={13} />
            <span>{isExporting ? 'Generating PNG...' : `Download ${projectName}.png`}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

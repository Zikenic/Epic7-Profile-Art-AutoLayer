import React, { useRef } from 'react';
import { ReferenceImageConfig } from '../core/types.ts';
import { Upload, X, Trash2, Eye, EyeOff } from 'lucide-react';

interface ReferenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: ReferenceImageConfig;
  onUpdateConfig: (updates: Partial<ReferenceImageConfig>) => void;
  onUploadImage: (dataUrl: string, filename: string) => void;
  onClearImage: () => void;
}

export const ReferenceModal: React.FC<ReferenceModalProps> = ({
  isOpen,
  onClose,
  config,
  onUpdateConfig,
  onUploadImage,
  onClearImage
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        onUploadImage(dataUrl, file.name);
      }
    };
    reader.readAsDataURL(file);
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
          width: '420px',
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
          <span style={{ fontWeight: 600, fontSize: '14px' }}>Reference Image Overlay</span>
          <button className="btn btn-icon" onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            Upload an anime reference or artwork to display underneath your shape composition.
            <br />
            <strong style={{ color: 'var(--accent)' }}>Note:</strong> Reference images do not count toward the 130 shape layer limit.
          </p>

          {/* Upload Box */}
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />

          {!config.dataUrl ? (
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed var(--border-color)',
                borderRadius: '8px',
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                backgroundColor: 'var(--bg-card)'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--accent)';
                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-color)';
                e.currentTarget.style.backgroundColor = 'var(--bg-card)';
              }}
            >
              <Upload size={24} color="var(--accent)" />
              <span style={{ fontSize: '12px', fontWeight: 500 }}>Click to select reference image</span>
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>PNG, JPEG, WebP</span>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                backgroundColor: 'var(--bg-card)',
                padding: '12px',
                borderRadius: '8px',
                border: '1px solid var(--border-color)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '240px' }}>
                  {config.filename || 'Reference Image'}
                </span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="btn btn-icon"
                    onClick={() => onUpdateConfig({ visible: !config.visible })}
                    title={config.visible ? 'Hide reference' : 'Show reference'}
                  >
                    {config.visible ? <Eye size={13} /> : <EyeOff size={13} color="var(--text-muted)" />}
                  </button>
                  <button
                    className="btn btn-icon btn-danger"
                    onClick={onClearImage}
                    title="Remove reference"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>

              {/* Opacity slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Opacity</span>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{Math.round(config.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="1.0"
                  step="0.05"
                  value={config.opacity}
                  onChange={(e) => onUpdateConfig({ opacity: parseFloat(e.target.value) })}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>

              {/* Fit Mode */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>Canvas Fitting:</span>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button
                    className={`btn ${config.fit === 'contain' ? 'btn-primary' : ''}`}
                    onClick={() => onUpdateConfig({ fit: 'contain' })}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    Contain
                  </button>
                  <button
                    className={`btn ${config.fit === 'cover' ? 'btn-primary' : ''}`}
                    onClick={() => onUpdateConfig({ fit: 'cover' })}
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                  >
                    Cover
                  </button>
                </div>
              </div>

              {/* Include in PNG Export toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
                <input
                  type="checkbox"
                  id="includeInExport"
                  checked={config.includeInExport}
                  onChange={(e) => onUpdateConfig({ includeInExport: e.target.checked })}
                />
                <label htmlFor="includeInExport" style={{ fontSize: '11px', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                  Include reference image in final PNG export
                </label>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

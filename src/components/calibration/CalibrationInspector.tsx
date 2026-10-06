import React, { useState, useRef, useEffect } from 'react';
import type {
  ShapeCalibrationResult,
  PrimitiveFitParameters,
  CandidatePrimitiveType
} from '../../calibration/types.ts';
import { MathematicalPrimitives } from '../../calibration/MathematicalPrimitives.ts';
import { CANONICAL_SHAPES } from '../../core/MathematicalShapeData.ts';
import { getShapeFrameCalibration } from '../../core/ShapeFrameCalibration.ts';
import {
  Sliders,
  Maximize2,
  Activity,
  Sparkles,
  Download,
  Upload,
  RefreshCw,
  Target
} from 'lucide-react';

interface CalibrationInspectorProps {
  calibration: ShapeCalibrationResult | null;
  candidateParams: PrimitiveFitParameters;
  onUpdateCandidateParams: (updates: Partial<PrimitiveFitParameters>) => void;
  onThresholdChange: (threshold: number) => void;
  onRecalculateFit: () => void;
  onExportDatabase: () => void;
  onImportDatabase: (jsonStr: string) => void;
  onOpenPaletteModal: () => void;
}

export const CalibrationInspector: React.FC<CalibrationInspectorProps> = ({
  calibration,
  candidateParams,
  onUpdateCandidateParams,
  onThresholdChange,
  onRecalculateFit,
  onExportDatabase,
  onImportDatabase,
  onOpenPaletteModal
}) => {
  const [activeTab, setActiveTab] = useState<'geometry' | 'fitting' | 'transform' | 'radial' | 'spawn'>('geometry');

  // Transformation Test State
  const [testScaleX, setTestScaleX] = useState<number>(1.0);
  const [testScaleY, setTestScaleY] = useState<number>(1.0);
  const [testRotation, setTestRotation] = useState<number>(0);

  if (!calibration) {
    return (
      <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
        Select a shape to inspect
      </div>
    );
  }

  const { foregroundBounds: bbox, padding, centers, symmetry, pixels, fitMetrics } = calibration;

  const handleApplyPreset = (sx: number, sy: number, rot: number = 0) => {
    setTestScaleX(sx);
    setTestScaleY(sy);
    setTestRotation(rot);
  };

  const handleImportClick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          onImportDatabase(ev.target?.result as string);
        } catch (err: any) {
          alert(`Failed to load calibration file: ${err.message}`);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  return (
    <div
      style={{
        width: '360px',
        backgroundColor: 'var(--bg-panel)',
        borderLeft: '1px solid var(--border-color)',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Top Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-color)',
          backgroundColor: 'var(--bg-card)'
        }}
      >
        {[
          { id: 'geometry', label: 'Geometry', icon: Maximize2 },
          { id: 'fitting', label: 'Math Fit', icon: Sparkles },
          { id: 'spawn', label: 'Spawn Calib', icon: Target },
          { id: 'transform', label: 'Transform Test', icon: Sliders },
          ...(calibration.radialProfile ? [{ id: 'radial', label: 'Radial Curve', icon: Activity }] : [])
        ].map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as any)}
              style={{
                flex: 1,
                padding: '10px 4px',
                fontSize: '11px',
                fontWeight: 600,
                border: 'none',
                borderBottom: activeTab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
                backgroundColor: activeTab === t.id ? 'var(--bg-panel)' : 'transparent',
                color: activeTab === t.id ? 'var(--accent)' : 'var(--text-secondary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px'
              }}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Inspector Body */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px',
          fontSize: '12px'
        }}
      >
        {/* TAB 1: GEOMETRY & PADDING */}
        {activeTab === 'geometry' && (
          <>
            {/* Header info */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
                {calibration.assetId}
              </span>
              <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                PNG: {calibration.sourceWidth} × {calibration.sourceHeight}px
              </span>
            </div>

            {/* Interactive Alpha Threshold Slider */}
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                gap: '6px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Foreground Alpha Threshold
                </span>
                <span style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--accent)' }}>
                  {calibration.alphaThreshold} / 255 ({(calibration.alphaThreshold / 255).toFixed(3)})
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="250"
                step="1"
                value={calibration.alphaThreshold}
                onChange={(e) => onThresholdChange(parseInt(e.target.value) || 2)}
                style={{ width: '100%', accentColor: 'var(--accent)' }}
              />
              <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                Drag slider to re-evaluate bounding box and centroid at different sensitivities.
              </span>
            </div>

            {/* Foreground Bounding Box */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Foreground Bounding Box
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '6px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontFamily: 'monospace',
                  fontSize: '11px'
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Width: </span>
                  <strong style={{ color: '#06b6d4' }}>{bbox.width} px</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Height: </span>
                  <strong style={{ color: '#06b6d4' }}>{bbox.height} px</strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>X Range: </span>
                  <span>[{bbox.minX}, {bbox.maxX}]</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Y Range: </span>
                  <span>[{bbox.minY}, {bbox.maxY}]</span>
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '4px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Aspect Ratio: </span>
                  <strong style={{ color: '#ffffff' }}>{(bbox.width / bbox.height).toFixed(3)} : 1</strong>
                </div>
              </div>
            </div>

            {/* Padding Details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Padding Analysis
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: '6px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontFamily: 'monospace',
                  fontSize: '11px'
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Left: </span>
                  <span>{padding.left}px ({(padding.normLeft * 100).toFixed(1)}%)</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Right: </span>
                  <span>{padding.right}px ({(padding.normRight * 100).toFixed(1)}%)</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Top: </span>
                  <span>{padding.top}px ({(padding.normTop * 100).toFixed(1)}%)</span>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Bottom: </span>
                  <span>{padding.bottom}px ({(padding.normBottom * 100).toFixed(1)}%)</span>
                </div>
              </div>
            </div>

            {/* Center Measurements */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Centers & Alignment Offsets
              </span>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontFamily: 'monospace',
                  fontSize: '11px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#3b82f6' }}>Image Center:</span>
                  <span>({centers.image.x}, {centers.image.y})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#06b6d4' }}>BBox Center:</span>
                  <span>({centers.foregroundBBox.x}, {centers.foregroundBBox.y})</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#f59e0b' }}>Alpha Centroid:</span>
                  <span>({centers.alphaCentroid.x}, {centers.alphaCentroid.y})</span>
                </div>
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '4px', color: 'var(--text-muted)', fontSize: '10px' }}>
                  BBox Offset from Center: ΔX={centers.offsetBBoxFromImage.x}px, ΔY={centers.offsetBBoxFromImage.y}px
                </div>
              </div>
            </div>

            {/* Symmetry & Anti-Aliasing */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
                Symmetry & Anti-Aliasing
              </span>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '6px',
                  backgroundColor: 'var(--bg-card)',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  fontSize: '11px'
                }}
              >
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Horiz Symmetry: </span>
                  <strong style={{ color: symmetry.horizontal > 98 ? 'var(--success)' : 'var(--warning)' }}>
                    {symmetry.horizontal}%
                  </strong>
                </div>
                <div>
                  <span style={{ color: 'var(--text-muted)' }}>Vert Symmetry: </span>
                  <strong style={{ color: symmetry.vertical > 98 ? 'var(--success)' : 'var(--warning)' }}>
                    {symmetry.vertical}%
                  </strong>
                </div>
                <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border-color)', paddingTop: '4px' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Pixels: </span>
                  <span>Opaque: {pixels.opaque.toLocaleString()} ({pixels.percentOpaque}%)</span>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Anti-Aliased Edges: </span>
                  <span>Partial: {pixels.partial.toLocaleString()} ({pixels.percentPartial}%)</span>
                </div>
              </div>
            </div>
          </>
        )}

        {/* TAB 2: MATHEMATICAL FIT & ERROR METRICS */}
        {activeTab === 'fitting' && (
          <>
            {/* Phase 2B Authoritative Equivalence Overview */}
            {CANONICAL_SHAPES[calibration.assetId] && (
              <div
                style={{
                  backgroundColor: 'rgba(59, 130, 246, 0.08)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                  borderRadius: '6px',
                  padding: '10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '10px', fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Phase 2B Equivalence
                  </span>
                  <span
                    style={{
                      fontSize: '10px',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: 'var(--success)',
                      fontWeight: 600
                    }}
                  >
                    {CANONICAL_SHAPES[calibration.assetId].confidence}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px', fontFamily: 'monospace' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Asset IoU: </span>
                    <strong style={{ color: '#ffffff' }}>
                      {(CANONICAL_SHAPES[calibration.assetId].metrics.assetIoU * 100).toFixed(2)}%
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Geom IoU: </span>
                    <strong style={{ color: '#ffffff' }}>
                      {(CANONICAL_SHAPES[calibration.assetId].metrics.geomIoU * 100).toFixed(2)}%
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>MAE: </span>
                    <span>{CANONICAL_SHAPES[calibration.assetId].metrics.mae}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Boundary Err: </span>
                    <strong style={{ color: '#38bdf8' }}>
                      {CANONICAL_SHAPES[calibration.assetId].metrics.boundaryErrorPx} px
                    </strong>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Canonical: </span>
                    <span>{CANONICAL_SHAPES[calibration.assetId].canonicalWidth}×{CANONICAL_SHAPES[calibration.assetId].canonicalHeight}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Offset: </span>
                    <span>({CANONICAL_SHAPES[calibration.assetId].compatibilityOffset.dx}, {CANONICAL_SHAPES[calibration.assetId].compatibilityOffset.dy})</span>
                  </div>
                </div>

                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const c = CANONICAL_SHAPES[calibration.assetId];
                    if (!c) return;
                    const cx = calibration.centers.foregroundBBox.x;
                    const cy = calibration.centers.foregroundBBox.y;
                    const updates: Partial<PrimitiveFitParameters> = {
                      type: c.primitiveType as any,
                      cx,
                      cy,
                      width: c.canonicalWidth,
                      height: c.canonicalHeight
                    };
                    if (c.parameters.radius) updates.radius = c.parameters.radius;
                    if (c.parameters.cornerRadius) updates.cornerRadius = c.parameters.cornerRadius;
                    if (c.parameters.innerRadius) updates.innerRadius = c.parameters.innerRadius;
                    if (c.parameters.outerRadius) updates.outerRadius = c.parameters.outerRadius;
                    if (c.parameters.falloff) updates.falloff = c.parameters.falloff as any;
                    if (c.parameters.normalizedPoints) {
                      updates.points = c.parameters.normalizedPoints.map(p => ({
                        x: cx + p[0] * c.canonicalWidth,
                        y: cy + p[1] * c.canonicalHeight
                      }));
                    }
                    onUpdateCandidateParams(updates);
                    setTimeout(onRecalculateFit, 50);
                  }}
                  style={{
                    marginTop: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    padding: '6px 10px',
                    fontSize: '11px',
                    fontWeight: 600
                  }}
                >
                  <Target size={13} />
                  <span>Auto-Fit Authoritative Model</span>
                </button>
              </div>
            )}

            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              Candidate Primitive Selection
            </span>

            {/* Primitive Type Selector */}
            <select
              value={candidateParams.type}
              onChange={(e) => {
                onUpdateCandidateParams({ type: e.target.value as CandidatePrimitiveType });
                setTimeout(onRecalculateFit, 50);
              }}
              style={{ width: '100%', padding: '6px 8px' }}
            >
              <option value="circle">Circle / Ellipse</option>
              <option value="capsule">Pill / Capsule</option>
              <option value="semicircle">Half Circle (Semicircle)</option>
              <option value="rounded_rect">Rounded Rectangle</option>
              <option value="polygon_triangle">3-Point Triangle</option>
              <option value="star_10">10-Point Star</option>
              <option value="heart_bezier">Heart (Bézier)</option>
              <option value="radial_glow">Radial Glow (Gradient)</option>
              <option value="vector_path">Canonical Vector Path</option>
              <option value="custom_bezier">Custom Bézier Silhouette</option>
            </select>

            {/* Error Metrics Badge / Progress */}
            {fitMetrics && (
              <div
                style={{
                  backgroundColor: 'var(--bg-card)',
                  padding: '10px',
                  borderRadius: '6px',
                  border: '1px solid var(--border-color)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 600, fontSize: '11px', color: 'var(--text-secondary)' }}>
                    Current Fit Accuracy (IoU)
                  </span>
                  <strong style={{ fontSize: '13px', fontFamily: 'monospace', color: fitMetrics.iou >= 0.95 ? 'var(--success)' : 'var(--warning)' }}>
                    {(fitMetrics.iou * 100).toFixed(2)}%
                  </strong>
                </div>

                <div style={{ height: '4px', backgroundColor: 'var(--bg-hover)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div
                    style={{
                      width: `${fitMetrics.iou * 100}%`,
                      height: '100%',
                      backgroundColor: fitMetrics.iou >= 0.95 ? 'var(--success)' : 'var(--warning)'
                    }}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px', fontSize: '11px', fontFamily: 'monospace', marginTop: '4px' }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>MAE: </span>
                    <span>{fitMetrics.meanAbsoluteAlphaError}</span>
                  </div>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>Mismatch: </span>
                    <span>{fitMetrics.pixelDisagreementPercent}%</span>
                  </div>
                  {fitMetrics.boundaryDistancePx !== undefined && (
                    <div style={{ gridColumn: '1 / -1' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Boundary Err: </span>
                      <strong style={{ color: '#38bdf8' }}>{fitMetrics.boundaryDistancePx} px</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Interactive Parameters for Primitive */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-secondary)' }}>
                Primitive Parameters
              </span>

              {/* Center Coordinates */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Center X</label>
                  <input
                    type="number"
                    step="0.5"
                    value={candidateParams.cx}
                    onChange={(e) => onUpdateCandidateParams({ cx: parseFloat(e.target.value) || 0 })}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Center Y</label>
                  <input
                    type="number"
                    step="0.5"
                    value={candidateParams.cy}
                    onChange={(e) => onUpdateCandidateParams({ cy: parseFloat(e.target.value) || 0 })}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>

              {/* Radius / Dimensions */}
              {candidateParams.type === 'circle' && (
                <div>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Radius (px)</label>
                  <input
                    type="number"
                    step="0.5"
                    value={candidateParams.radius || 180}
                    onChange={(e) => onUpdateCandidateParams({ radius: parseFloat(e.target.value) || 1 })}
                    style={{ width: '100%' }}
                  />
                </div>
              )}

              {candidateParams.type === 'rounded_rect' && (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Width</label>
                      <input
                        type="number"
                        step="1"
                        value={candidateParams.width || 324}
                        onChange={(e) => onUpdateCandidateParams({ width: parseFloat(e.target.value) || 1 })}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div>
                      <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Height</label>
                      <input
                        type="number"
                        step="1"
                        value={candidateParams.height || 324}
                        onChange={(e) => onUpdateCandidateParams({ height: parseFloat(e.target.value) || 1 })}
                        style={{ width: '100%' }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Corner Radius (px)</label>
                    <input
                      type="number"
                      step="1"
                      value={candidateParams.cornerRadius || 27}
                      onChange={(e) => onUpdateCandidateParams({ cornerRadius: parseFloat(e.target.value) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                </>
              )}

              {candidateParams.type === 'capsule' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Width</label>
                    <input
                      type="number"
                      step="1"
                      value={candidateParams.width || 360}
                      onChange={(e) => onUpdateCandidateParams({ width: parseFloat(e.target.value) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Height</label>
                    <input
                      type="number"
                      step="1"
                      value={candidateParams.height || 140}
                      onChange={(e) => onUpdateCandidateParams({ height: parseFloat(e.target.value) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}

              {candidateParams.type === 'star_10' && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Outer Radius</label>
                    <input
                      type="number"
                      step="1"
                      value={candidateParams.outerRadius || 178}
                      onChange={(e) => onUpdateCandidateParams({ outerRadius: parseFloat(e.target.value) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Inner Radius</label>
                    <input
                      type="number"
                      step="1"
                      value={candidateParams.innerRadius || 78}
                      onChange={(e) => onUpdateCandidateParams({ innerRadius: parseFloat(e.target.value) || 1 })}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>
              )}

              <button
                className="btn btn-primary"
                onClick={onRecalculateFit}
                style={{ marginTop: '8px' }}
              >
                <RefreshCw size={12} />
                Re-evaluate Error Metrics
              </button>
            </div>
          </>
        )}

        {/* TAB 3: CONTROLLED TRANSFORMATION TEST */}
        {activeTab === 'transform' && (
          <>
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              Non-Uniform Stretching & Rotation Test
            </span>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Test how this shape behaves under extreme aspect ratio stretches and rotations to anticipate mathematical rendering equivalence.
            </p>

            {/* Preset Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px' }}>
              <button className="btn" onClick={() => handleApplyPreset(1.0, 1.0, 0)}>1.0 × 1.0</button>
              <button className="btn" onClick={() => handleApplyPreset(2.0, 1.0, 0)}>2.0 × 1.0</button>
              <button className="btn" onClick={() => handleApplyPreset(1.0, 2.0, 0)}>1.0 × 2.0</button>
              <button className="btn" onClick={() => handleApplyPreset(4.0, 0.25, 0)}>4.0 × 0.25</button>
              <button className="btn" onClick={() => handleApplyPreset(0.25, 4.0, 0)}>0.25 × 4.0</button>
              <button className="btn" onClick={() => handleApplyPreset(1.0, 1.0, 45)}>45°</button>
              <button className="btn" onClick={() => handleApplyPreset(1.0, 1.0, 90)}>90°</button>
              <button className="btn" onClick={() => handleApplyPreset(1.0, 1.0, 180)}>180°</button>
              <button className="btn" onClick={() => handleApplyPreset(1.0, 1.0, 270)}>270°</button>
            </div>

            {/* Sliders */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Scale X</label>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{testScaleX.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="4.0"
                  step="0.05"
                  value={testScaleX}
                  onChange={(e) => setTestScaleX(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Scale Y</label>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{testScaleY.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="4.0"
                  step="0.05"
                  value={testScaleY}
                  onChange={(e) => setTestScaleY(parseFloat(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '10px', color: 'var(--text-muted)' }}>Rotation</label>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace' }}>{testRotation}°</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="360"
                  step="1"
                  value={testRotation}
                  onChange={(e) => setTestRotation(parseInt(e.target.value))}
                  style={{ width: '100%', accentColor: 'var(--accent)' }}
                />
              </div>
            </div>

            {/* Mini preview canvas for transform test */}
            <div
              style={{
                width: '100%',
                height: '140px',
                backgroundColor: 'var(--bg-card)',
                borderRadius: '6px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              <TransformPreview
                params={candidateParams}
                scaleX={testScaleX}
                scaleY={testScaleY}
                rotation={testRotation}
              />
            </div>
          </>
        )}

        {/* TAB 4: GLOW RADIAL INTENSITY PROFILE */}
        {activeTab === 'radial' && calibration.radialProfile && (
          <>
            <span style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)' }}>
              Radial Intensity Falloff (Distance vs Alpha)
            </span>
            <p style={{ fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
              Measured radial alpha curve from shape center to outer boundary.
            </p>

            {/* SVG Graph */}
            <div
              style={{
                backgroundColor: 'var(--bg-card)',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid var(--border-color)'
              }}
            >
              <svg width="100%" height="160" viewBox="0 0 300 160">
                {/* Axes */}
                <line x1="30" y1="130" x2="280" y2="130" stroke="#334155" strokeWidth="1" />
                <line x1="30" y1="130" x2="30" y2="20" stroke="#334155" strokeWidth="1" />

                {/* Y-axis labels (Alpha 0 to 1.0) */}
                <text x="5" y="24" fill="#94a3b8" fontSize="9">1.0</text>
                <text x="5" y="75" fill="#94a3b8" fontSize="9">0.5</text>
                <text x="12" y="133" fill="#94a3b8" fontSize="9">0</text>

                {/* Grid lines */}
                <line x1="30" y1="75" x2="280" y2="75" stroke="#1e293b" strokeDasharray="3 3" />

                {/* Plot points & curve */}
                {(() => {
                  const maxR = calibration.radialProfile[calibration.radialProfile.length - 1].radius;
                  const pts = calibration.radialProfile.map((p) => {
                    const x = 30 + (p.radius / maxR) * 240;
                    const y = 130 - p.meanAlpha * 110;
                    return `${x},${y}`;
                  }).join(' ');

                  return (
                    <>
                      <polyline fill="none" stroke="#3b82f6" strokeWidth="2" points={pts} />
                      {calibration.radialProfile.map((p, idx) => {
                        const cx = 30 + (p.radius / maxR) * 240;
                        const cy = 130 - p.meanAlpha * 110;
                        return (
                          <circle
                            key={idx}
                            cx={cx}
                            cy={cy}
                            r="3"
                            fill="#60a5fa"
                          />
                        );
                      })}
                    </>
                  );
                })()}

                {/* X-axis label */}
                <text x="130" y="152" fill="#94a3b8" fontSize="9">Radius (px)</text>
              </svg>
            </div>

            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              <strong>Falloff Model:</strong> The measured curve closely matches cosine falloff:
              <code style={{ display: 'block', padding: '4px', backgroundColor: 'var(--bg-card)', borderRadius: '4px', marginTop: '4px' }}>
                alpha(r) = 0.965 · cos²(π·r / (2 · 165))
              </code>
            </div>
          </>
        )}

        {/* TAB 5: EPIC SEVEN NATIVE SQUARE FRAME CALIBRATION */}
        {activeTab === 'spawn' && (() => {
          const calib = getShapeFrameCalibration(calibration.assetId);
          if (!calib) {
            return (
              <div style={{ color: 'var(--text-muted)', fontSize: '11px', textAlign: 'center', padding: '20px' }}>
                No native frame calibration data available for {calibration.assetId}.
              </div>
            );
          }

          return (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700, fontSize: '14px', color: '#ffffff' }}>
                  {calibration.assetId} Native Frame
                </span>
                <span style={{ fontSize: '10px', color: '#10b981', padding: '2px 6px', backgroundColor: 'rgba(16, 185, 129, 0.15)', borderRadius: '4px', fontFamily: 'monospace' }}>
                  Square Frame Model
                </span>
              </div>

              {/* Native Frame Info */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Native Square Frame (ref_Frame_size/)
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
                  <div>Reference: <span style={{ color: 'var(--accent)' }}>{calib.referenceFrameImage}</span></div>
                  <div>Frame Size: <span style={{ color: '#ffffff' }}>{calib.frameSizePx} × {calib.frameSizePx}px</span></div>
                  <div>Is Square: <span style={{ color: '#10b981' }}>Strictly Square (1:1)</span></div>
                  <div>Canvas Share: <span style={{ color: '#ffffff' }}>{(calib.frameNormalizedSize * 100).toFixed(1)}%</span></div>
                </div>
              </div>

              {/* Contained Shape Geometry */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  Contained Shape Geometry
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '11px', fontFamily: 'monospace' }}>
                  <div>Geometry W: <span style={{ color: '#ffffff' }}>{calib.shapeWidth}px</span></div>
                  <div>Geometry H: <span style={{ color: '#ffffff' }}>{calib.shapeHeight}px</span></div>
                  <div>Scale in Frame X: <span style={{ color: 'var(--accent)' }}>{(calib.geometryScaleX * 100).toFixed(1)}%</span></div>
                  <div>Scale in Frame Y: <span style={{ color: 'var(--accent)' }}>{(calib.geometryScaleY * 100).toFixed(1)}%</span></div>
                  <div>Local Offset X: <span style={{ color: '#ffffff' }}>{calib.geometryOffsetX.toFixed(4)}</span></div>
                  <div>Local Offset Y: <span style={{ color: '#ffffff' }}>{calib.geometryOffsetY.toFixed(4)}</span></div>
                </div>
              </div>

              {/* Native Spawn Coordinates */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px', backgroundColor: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--accent)' }}>
                  Native Spawn Transform
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '12px', fontFamily: 'monospace', fontWeight: 600 }}>
                  <span>Position: <strong style={{ color: '#ffffff' }}>x: 0.5, y: 0.5</strong></span>
                  <span>Rotation: <strong style={{ color: '#ffffff' }}>0°</strong></span>
                  <span>Scale X: <strong style={{ color: '#ffffff' }}>1.000</strong></span>
                  <span>Scale Y: <strong style={{ color: '#ffffff' }}>1.000</strong></span>
                </div>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Frame center placed at exact 21:31 canvas center (0.5, 0.5). Scale (1, 1) preserves native unmodified Epic Seven frame.
                </div>
              </div>

              {/* Mini visual preview */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '10px', backgroundColor: 'var(--bg-card)', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                <div style={{ fontSize: '10px', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Native Square Frame on 21:31 Card
                </div>
                <div style={{ width: '105px', height: '155px', backgroundColor: '#141721', borderRadius: '3px', position: 'relative', overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.3)', border: '1px solid var(--border-color)' }}>
                  {/* Square Frame */}
                  <div
                    style={{
                      position: 'absolute',
                      left: '50%',
                      top: '50%',
                      width: `${calib.frameNormalizedSize * 105}px`,
                      height: `${calib.frameNormalizedSize * 105}px`,
                      border: '1px dashed #3b82f6',
                      transform: 'translate(-50%, -50%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    {/* Contained Shape */}
                    <div
                      style={{
                        position: 'absolute',
                        left: `${50 + calib.geometryOffsetX * 100}%`,
                        top: `${50 + calib.geometryOffsetY * 100}%`,
                        width: `${calib.geometryScaleX * calib.frameNormalizedSize * 105}px`,
                        height: `${calib.geometryScaleY * calib.frameNormalizedSize * 105}px`,
                        backgroundColor: 'rgba(88, 106, 139, 0.85)',
                        transform: 'translate(-50%, -50%)',
                        borderRadius: calibration.assetId.includes('Circle') ? '50%' : '2px'
                      }}
                    />
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Footer Controls: Export / Import / Palette */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '6px',
          backgroundColor: 'var(--bg-card)'
        }}
      >
        <div style={{ display: 'flex', gap: '6px' }}>
          <button className="btn" onClick={onExportDatabase} style={{ flex: 1 }}>
            <Download size={12} />
            <span>Export DB</span>
          </button>
          <button className="btn" onClick={handleImportClick} style={{ flex: 1 }}>
            <Upload size={12} />
            <span>Import DB</span>
          </button>
        </div>

        <button className="btn btn-primary" onClick={onOpenPaletteModal}>
          <Sparkles size={12} />
          <span>View Color Palette Swatches</span>
        </button>
      </div>
    </div>
  );
};

// Helper component for Transform Test mini preview
const TransformPreview: React.FC<{
  params: PrimitiveFitParameters;
  scaleX: number;
  scaleY: number;
  rotation: number;
}> = ({ params, scaleX, scaleY, rotation }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 300;
    canvas.height = 140;
    ctx.clearRect(0, 0, 300, 140);

    ctx.save();
    ctx.translate(150, 70);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scaleX * 0.25, scaleY * 0.25);
    ctx.translate(-params.cx, -params.cy);

    MathematicalPrimitives.draw(ctx, params, {
      fillColor: '#3b82f6',
      strokeColor: '#60a5fa',
      lineWidth: 3,
      fillOpacity: 0.8
    });

    ctx.restore();
  }, [params, scaleX, scaleY, rotation]);

  return <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%', maxHeight: '100%' }} />;
};

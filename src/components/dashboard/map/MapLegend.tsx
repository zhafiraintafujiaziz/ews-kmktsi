import React, { useState } from 'react';
import type { DisasterAlert, AlertSeverity } from '../../../types';
import { renderDisasterIcon } from '../../../utils/alertUtils';

interface MapLegendProps {
  isInariskFilter: boolean;
  mapLayers: {
    critical: boolean;
    warning: boolean;
    watch: boolean;
    earthquake: boolean;
    extreme_weather: boolean;
    karhutla: boolean;
    volcanic: boolean;
    volcanic_ash?: boolean;
  };
  onToggleLayer: (layerKey: 'critical' | 'warning' | 'watch' | 'earthquake' | 'extreme_weather' | 'karhutla' | 'volcanic' | 'volcanic_ash') => void;
  selectedAlert?: DisasterAlert | null;
}

const SEV_CONFIG: Array<{ key: 'critical' | 'warning' | 'watch'; num: AlertSeverity; label: string; color: string }> = [
  { key: 'critical', num: 3, label: 'Keparahan Tinggi', color: 'var(--alert-critical)' },
  { key: 'warning',  num: 2, label: 'Keparahan Sedang', color: 'var(--alert-warning)' },
  { key: 'watch',    num: 1, label: 'Keparahan Rendah', color: 'var(--alert-watch)' },
];

const DISASTER_TYPES_CONFIG: Array<{ key: 'earthquake' | 'extreme_weather' | 'karhutla' | 'volcanic' | 'volcanic_ash'; label: string }> = [
  { key: 'earthquake', label: 'Gempa Bumi' },
  { key: 'extreme_weather', label: 'Cuaca Ekstrem' },
  { key: 'karhutla', label: 'Kebakaran Hutan' },
  { key: 'volcanic', label: 'Gunung Api' },
  { key: 'volcanic_ash', label: 'Abu Vulkanik' },
];

const MapLegend: React.FC<MapLegendProps> = ({
  isInariskFilter,
  mapLayers,
  onToggleLayer,
  selectedAlert,
}) => {
  const [isExpanded, setIsExpanded] = useState(() => window.innerWidth > 768);

  const selectedSeverity = selectedAlert?.severity ?? null;

  return (
    <div className={`map-legend ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="legend-header" onClick={() => setIsExpanded(!isExpanded)}>
        <div className="legend-header-title-container">
          <div className="legend-agency-logos-container">
            <img src="/bmkg-logo.png" alt="BMKG Logo" title="BMKG" className="legend-agency-logo" style={{ zIndex: 5 }} />
            <img src="/esdm-logo.png" alt="ESDM Logo" title="ESDM" className="legend-agency-logo" style={{ zIndex: 4 }} />
            <img src="/bnpb-logo.png" alt="BNPB Logo" title="BNPB" className="legend-agency-logo" style={{ zIndex: 3 }} />
            <img src="/klhk-logo.png" alt="KLHK Logo" title="Kementerian Kehutanan (KLHK)" className="legend-agency-logo" style={{ zIndex: 2 }} />
            <img src="/manggala-logo.png" alt="Manggala Agni Logo" title="Manggala Agni" className="legend-agency-logo" style={{ zIndex: 1 }} />
          </div>
          <span className="legend-title" style={{ marginLeft: '6px' }}>
            {isInariskFilter ? 'Indikator Wilayah (InaRisk)' : 'Map Legend'}
          </span>
        </div>
        <svg
          className={`legend-toggle-icon ${isExpanded ? 'rotated' : ''}`}
          viewBox="0 0 24 24"
          width="16"
          height="16"
          stroke="currentColor"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>

      {isExpanded && (
        <div className="legend-content">
          {SEV_CONFIG.map(({ key, num, label, color }) => {
            const show = !selectedAlert || selectedSeverity === num;
            if (!show) return null;
            return (
              <div
                key={key}
                className={`legend-item ${(!mapLayers[key] && !isInariskFilter) ? 'disabled' : ''}`}
                onClick={() => { if (!isInariskFilter) onToggleLayer(key); }}
                title={isInariskFilter ? label : `Toggle ${label}`}
                style={{ cursor: isInariskFilter ? 'default' : 'pointer' }}
              >
                <span className="legend-shape-icon" style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                  {[1, 2, 3].map((i) => (
                    <span key={i} style={{
                      width: '12px', height: '4px', borderRadius: '1px',
                      backgroundColor: i <= num ? color : 'var(--border-default)',
                      display: 'inline-block',
                    }} />
                  ))}
                </span>
                <span>{isInariskFilter ? (() => {
                  const inariskLabels: Record<number, string> = { 
                    3: 'Kerentanan Tinggi (61-100)', 
                    2: 'Kerentanan Sedang (31-60)', 
                    1: 'Kerentanan Rendah (0-30)' 
                  };
                  return inariskLabels[num];
                })() : label}</span>
                {!isInariskFilter && (
                  <span className={`legend-ios-toggle ${mapLayers[key] ? 'on' : 'off'}`}>
                    <span className="legend-ios-thumb" />
                  </span>
                )}
              </div>
            );
          })}
          {!isInariskFilter && (
            <>
              <div 
                className="legend-section-title" 
                style={{ 
                  margin: '8px 0 4px 0', 
                  fontSize: '10px', 
                  fontWeight: 700, 
                  color: 'var(--text-secondary)', 
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderTop: '1px solid var(--border-default)', 
                  paddingTop: '6px' 
                }}
              >
                Tipe Bencana
              </div>
              {DISASTER_TYPES_CONFIG.map(({ key, label }) => {
                return (
                  <div
                    key={key}
                    className={`legend-item ${!mapLayers[key] ? 'disabled' : ''}`}
                    onClick={() => onToggleLayer(key)}
                    title={`Toggle ${label}`}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="legend-shape-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {renderDisasterIcon(key, undefined, { width: '16px', height: '16px' })}
                    </span>
                    <span>{label}</span>
                    <span className={`legend-ios-toggle ${mapLayers[key] ? 'on' : 'off'}`}>
                      <span className="legend-ios-thumb" />
                    </span>
                  </div>
                );
              })}

              <div 
                className="legend-section-title" 
                style={{ 
                  margin: '8px 0 4px 0', 
                  fontSize: '10px', 
                  fontWeight: 700, 
                  color: 'var(--text-secondary)', 
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  borderTop: '1px solid var(--border-default)', 
                  paddingTop: '6px' 
                }}
              >
                Wilayah Kerja BI
              </div>

              <div className="legend-item legend-item--shape">
                <span className="legend-shape-icon">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <circle cx="12" cy="12" r="9" fill="var(--accent-primary)" stroke="white" strokeWidth="2" />
                  </svg>
                </span>
                <span>KPwBI (Kantor Perwakilan)</span>
              </div>

              <div className="legend-item legend-item--shape">
                <span className="legend-shape-icon">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="var(--accent-primary)" stroke="white" strokeWidth="1.5"
                      d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z" />
                  </svg>
                </span>
                <span>Korwil (Koordinator Wilayah)</span>
              </div>

              <div className="legend-item legend-item--shape">
                <span className="legend-shape-icon">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path fill="var(--accent-primary)" d="M12,2L1,7v2h22V7L12,2z M4,9v11h3V9H4z M10,9v11h4V9h-4z M17,9v11h3V9h-3z M2,20v2h20v-2H2z"/>
                  </svg>
                </span>
                <span>Kantor Pusat (KP)</span>
              </div>

              <div className="legend-item legend-item--shape">
                <span className="legend-shape-icon">
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <polygon points="12,2 23,22 1,22" fill="var(--accent-primary)" stroke="white" strokeWidth="1.5" />
                  </svg>
                </span>
                <span>Data Center (Sinergi)</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default MapLegend;
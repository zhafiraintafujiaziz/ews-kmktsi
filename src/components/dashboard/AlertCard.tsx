import React from 'react';
import type { DisasterAlert, Province } from '../../types';
import { severityToCssClass } from '../../types';
import { renderDisasterIcon } from '../../utils/alertUtils';
import './AlertCard.css';

interface AlertCardProps {
  alert: DisasterAlert;
  province?: Province;
  isSelected: boolean;
  onClick: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  earthquake:      'Gempa Bumi',
  flood:           'Banjir',
  volcanic:        'Gunung Api',
  volcanic_ash:    'Abu Vulkanik (INA-SIAM)',
  tsunami:         'Tsunami',
  landslide:       'Longsor',
  extreme_weather: 'Cuaca Buruk',
  karhutla:        'Karhutla',
  kekeringan:      'Kekeringan',
  air_quality:     'Kualitas Udara (ISPU)',
};

function renderMetrics(alert: DisasterAlert) {
  const { type, magnitude, depth, waterLevel, affectedArea, isForecast, forecastDateStr } = alert;

  switch (type) {
    case 'earthquake':
      return (
        <div className="alertcard-metrics">
          {magnitude !== undefined && (
            <div className="metric-mag">
              <span className="metric-mag-val">{magnitude.toFixed(1)}</span>
              <span className="metric-mag-unit">SR</span>
            </div>
          )}
          <div className="metric-chips">
            {depth !== undefined && (
              <span className="metric-chip">↓ {depth} km</span>
            )}
            {affectedArea && (
              <span className="metric-chip metric-chip-area">{affectedArea}</span>
            )}
          </div>
        </div>
      );

    case 'flood':
      return (
        <div className="alertcard-metrics">
          <div className="metric-chips">
            {waterLevel !== undefined && (
              <span className="metric-chip">Ketinggian {waterLevel} m</span>
            )}
            {affectedArea && (
              <span className="metric-chip metric-chip-area">{affectedArea}</span>
            )}
          </div>
        </div>
      );

    case 'extreme_weather':
      return (
        <div className="alertcard-metrics">
          <div className="metric-chips">
            {isForecast && forecastDateStr && (
              <span className="metric-chip">{forecastDateStr}</span>
            )}
            {affectedArea && (
              <span className="metric-chip metric-chip-area">{affectedArea}</span>
            )}
          </div>
        </div>
      );

    case 'volcanic_ash':
      return (
        <div className="alertcard-metrics">
          <div className="metric-chips">
            <span className="metric-chip" style={{ background: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
              INA-SIAM / VAAC
            </span>
            {alert.ashHeight && (
              <span className="metric-chip" style={{ background: '#ffedd5', color: '#9a3412', fontWeight: 500 }}>
                {alert.ashHeight.split('(')[0].trim()}
              </span>
            )}
            {alert.movementDirection && (
              <span className="metric-chip" style={{ background: '#fef08a', color: '#854d0e' }}>
                🧭 {alert.movementDirection.split('(')[0].trim()}
              </span>
            )}
            {alert.closedAirports && alert.closedAirports.length > 0 && (
              <span className="metric-chip" style={{ background: '#fee2e2', color: '#b91c1c', fontWeight: 700, border: '1px solid #fca5a5' }}>
                ⛔ Bandara Ditutup ({alert.closedAirports[0].icao})
              </span>
            )}
            {alert.affectedSeaports && alert.affectedSeaports.length > 0 && (
              <span className="metric-chip" style={{ background: '#dbeafe', color: '#1e40af', fontWeight: 600, border: '1px solid #93c5fd' }}>
                🚢 Dermaga Waspada
              </span>
            )}
            {affectedArea && (
              <span className="metric-chip metric-chip-area">{affectedArea}</span>
            )}
            {alert.trajectoryImageUrl && (
              <a
                href={alert.trajectoryImageUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="metric-chip"
                style={{ background: '#e0f2fe', color: '#0369a1', textDecoration: 'none', cursor: 'pointer' }}
                onClick={(e) => e.stopPropagation()}
              >
                📡 Citra Trajektori Satelit ↗
              </a>
            )}
          </div>
        </div>
      );

    case 'karhutla':
      return (
        <div className="alertcard-metrics">
          <div className="metric-chips">
            {alert.hotspotCount !== undefined && (
              <span className="metric-chip" style={{ background: '#ffedd5', color: '#c2410c', fontWeight: 700 }}>
                🔥 {alert.hotspotCount} Titik Panas
              </span>
            )}
            <span className="metric-chip" style={{ background: '#fee2e2', color: '#991b1b', fontWeight: 600 }}>
              Sangat Tinggi
            </span>
            {alert.satellites && alert.satellites.length > 0 && (
              <span className="metric-chip" style={{ background: '#f1f5f9', color: '#475569', fontSize: '10px' }}>
                🛰️ {alert.satellites.join(', ')}
              </span>
            )}
            {affectedArea && (
              <span className="metric-chip metric-chip-area">{affectedArea}</span>
            )}
          </div>
        </div>
      );

    case 'air_quality': {
      const ispuVal = alert.ispuValue || 0;
      const ispuCat = alert.ispuCategory || 'BAIK';
      let dotColor = '#10b981'; // Baik (Hijau)
      let catBg = 'rgba(16, 185, 129, 0.15)';
      let catColor = '#059669';

      if (ispuCat === 'BERBAHAYA' || ispuVal > 300) {
        dotColor = '#0f172a';
        catBg = '#0f172a';
        catColor = '#ffffff';
      } else if (ispuCat === 'SANGAT TIDAK SEHAT' || ispuVal > 200) {
        dotColor = '#ef4444';
        catBg = '#fee2e2';
        catColor = '#dc2626';
      } else if (ispuCat === 'TIDAK SEHAT' || ispuVal > 100) {
        dotColor = '#eab308';
        catBg = '#fef9c3';
        catColor = '#b45309';
      } else if (ispuCat === 'SEDANG' || ispuVal > 50) {
        dotColor = '#0284c7';
        catBg = '#e0f2fe';
        catColor = '#0369a1';
      }

      return (
        <div className="alertcard-metrics">
          <div className="metric-chips">
            <span
              className="metric-chip"
              style={{
                background: catBg,
                color: catColor,
                fontWeight: 700,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  backgroundColor: dotColor,
                  display: 'inline-block',
                }}
              />
              {ispuCat} • ISPU {ispuVal}
            </span>
            {alert.ispuParam && (
              <span className="metric-chip" style={{ background: '#f1f5f9', color: '#475569', fontWeight: 600 }}>
                Polutan: {alert.ispuParam}
              </span>
            )}
            {alert.stationName && (
              <span className="metric-chip" style={{ background: '#f8fafc', color: '#64748b' }}>
                SPKU: {alert.stationName}
              </span>
            )}
            {affectedArea && (
              <span className="metric-chip metric-chip-area">{affectedArea}</span>
            )}
          </div>
        </div>
      );
    }

    case 'volcanic':
    case 'landslide':
    case 'tsunami':
    case 'kekeringan':
    default:
      return affectedArea ? (
        <div className="alertcard-metrics">
          <div className="metric-chips">
            <span className="metric-chip metric-chip-area">{affectedArea}</span>
          </div>
        </div>
      ) : null;
  }
}

function formatTimeRange(rangeStr: string): string {
  const parts = rangeStr.split('-').map((p) => p.trim());
  if (parts.length !== 2) return rangeStr;

  const start = parts[0];
  const end = parts[1];

  if (start.includes('•') && end.includes('•')) {
    const startDatePart = start.split('•')[0].trim();
    const startTimePart = start.split('•')[1].trim();

    const endDatePart = end.split('•')[0].trim();
    const endTimePart = end.split('•')[1].trim();

    if (startDatePart === endDatePart) {
      return `${startDatePart} • ${startTimePart} - ${endTimePart}`;
    }
  }

  return rangeStr;
}

export const AlertCard: React.FC<AlertCardProps> = ({ alert, province, isSelected, onClick }) => {
  const formatWibTime = (isoString: string) => {
    try {
      const past = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - past.getTime();
      const diffHours = Math.floor(diffMs / 3600000);

      const timeStr = past.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      if (diffHours < 24) return `${timeStr} WIB`;

      const dateStr = past.toLocaleDateString('id-ID', {
        timeZone: 'Asia/Jakarta',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
      return `${dateStr}, ${timeStr} WIB`;
    } catch { return ''; }
  };

  const formatRelativeTime = (isoString: string) => {
    try {
      const past = new Date(isoString);
      const now = new Date();
      const diffMs = now.getTime() - past.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      if (diffMins < 1) return 'Baru saja';
      if (diffMins < 60) return `${diffMins}m lalu`;
      if (diffHours < 24) return `${diffHours}j lalu`;
      return past.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
    } catch { return ''; }
  };

  const sevCss = severityToCssClass(alert.severity);
  const sevBoxCount = alert.severity;

  return (
    <div
      className={`alertcard-container alertcard-sev-${sevCss}${isSelected ? ' selected' : ''}`}
      onClick={onClick}
    >
      <div className={`alertcard-stripe ${sevCss}`} />

      <div className="alertcard-header">
        <div className="alertcard-type-row">
          <span className="alertcard-icon">{renderDisasterIcon(alert.type, undefined, undefined, alert)}</span>
          <span className="alertcard-type-label">{TYPE_LABELS[alert.type] ?? alert.type}</span>
        </div>
        <div className={`alertcard-sev-badge sev-${sevCss}`}>
          {[1, 2, 3].map((i) => (
            <span key={i} className={`sev-box${i <= sevBoxCount ? ' filled' : ''}`} />
          ))}
        </div>
      </div>

      <div className="alertcard-title">{alert.title}</div>

      {renderMetrics(alert)}

      <div className={`alertcard-desc${alert.title === 'Peringatan Dini Cuaca' ? ' weather-early-warning' : ''}`}>
        {alert.title === 'Peringatan Dini Cuaca' && alert.description.includes('Waktu:') ? (
          <>
            {alert.description.split('Waktu:')[0].trim()}
            <br />
            {formatTimeRange(alert.description.split('Waktu:')[1].trim())}
          </>
        ) : (
          alert.description
        )}
      </div>

      <div className="alertcard-footer">
        <span className="alertcard-province">{province?.name ?? 'Unknown Province'}</span>
        <span className="alertcard-dot" />
        <span className="alertcard-time">{formatRelativeTime(alert.timestamp)}</span>
        <span className="alertcard-dot" />
        <span className="alertcard-time">{formatWibTime(alert.timestamp)}</span>
        {alert.isForecast && <span className="alertcard-forecast-tag">Prakiraan</span>}
      </div>
    </div>
  );
};

export default AlertCard;

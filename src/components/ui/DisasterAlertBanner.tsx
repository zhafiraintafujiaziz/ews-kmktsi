import React, { useState } from 'react';
import type { RiskCalcResult } from '../../types';
import { renderDisasterIcon } from '../../utils/alertUtils';
import { haversineDistance } from '../../utils/geo';
import './DisasterAlertBanner.css';

interface DisasterAlertBannerProps {
  activeAlerts: RiskCalcResult[];
}

export const DisasterAlertBanner: React.FC<DisasterAlertBannerProps> = ({ activeAlerts }) => {
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  const visibleAlerts = activeAlerts.filter((a) => !dismissedAlertIds.includes(a.event.id));

  if (visibleAlerts.length === 0) return null;

  const handleDismiss = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissedAlertIds((prev) => [...prev, id]);
    if (expandedAlertId === id) {
      setExpandedAlertId(null);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedAlertId((prev) => (prev === id ? null : id));
  };

  return (
    <div className="disaster-alert-banner-container">
      {visibleAlerts.map((alert) => {
        const isExpanded = expandedAlertId === alert.event.id;
        const affectedCount = alert.affectedLocations.length;

        return (
          <div
            key={alert.event.id}
            className={`disaster-alert-banner ${isExpanded ? 'expanded' : ''}`}
            onClick={() => toggleExpand(alert.event.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                toggleExpand(alert.event.id);
              }
            }}
          >
            <div className="banner-main">
              <div className="banner-left">
                <span className="banner-emoji-wrapper">
                  <span className="banner-emoji">{renderDisasterIcon(alert.event.type, undefined, undefined, { id: alert.event.id, title: alert.event.title })}</span>
                  <span className="banner-pulse-ring" />
                </span>
                <div className="banner-info">
                  <div className="banner-badge-row">
                    <span className="banner-badge-danger">RISIKO TINGGI</span>
                    <span className="banner-badge-score">
                      Skor Risiko: {alert.riskScore}/9
                    </span>
                  </div>
                  <h4 className="banner-title">{alert.event.title}</h4>
                  <p className="banner-subtitle">
                    Dampak bencana terdeteksi mencakup <strong>{affectedCount} lokasi</strong> penting Bank Indonesia. Klik untuk melihat detail lokasi.
                  </p>
                </div>
              </div>

              <div className="banner-right">
                <button
                  className="banner-dismiss-btn"
                  onClick={(e) => handleDismiss(alert.event.id, e)}
                  aria-label="Tutup Peringatan"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            </div>

            {isExpanded && (
              <div className="banner-details" onClick={(e) => e.stopPropagation()}>
                <div className="banner-divider" />
                <h5 className="details-header">Daftar Lokasi Terimbas & Skor Kerentanan</h5>
                <div className="details-grid">
                  {alert.affectedLocations.map((loc) => {
                    const dist = haversineDistance(
                      alert.event.latitude,
                      alert.event.longitude,
                      loc.latitude,
                      loc.longitude
                    );

                    return (
                      <div key={loc.id} className="details-card">
                        <div className="details-card-header">
                          <span className="location-bullet" />
                          <span className="location-name">{loc.name}</span>
                        </div>
                        <div className="details-card-body">
                          <div className="detail-item">
                            <span className="detail-label">Jarak Pusat Bencana:</span>
                            <span className="detail-value">{dist.toFixed(1)} km</span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Status Kerentanan:</span>
                            <span className={`detail-value vul-${alert.vulnerabilityLevel.toLowerCase()}`}>
                              {alert.vulnerabilityLevel} (Skor: {alert.vulnerabilityScore})
                            </span>
                          </div>
                          <div className="detail-item">
                            <span className="detail-label">Radius Dampak:</span>
                            <span className="detail-value">{alert.event.radiusKm} km</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default DisasterAlertBanner;

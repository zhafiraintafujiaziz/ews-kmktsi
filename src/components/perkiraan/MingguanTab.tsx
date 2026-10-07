import React, { useMemo, useState } from 'react';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import {
  FlashOn as FlashOnIcon,
  WaterDrop as WaterDropIcon
} from '@mui/icons-material';
import { PROVINCES } from '../../constants/provinces';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import { useAlerts } from '../../hooks/useAlerts';
import { getProvinceForecast, getForecastSnapshot } from '../../services/weatherForecastAssessment';
import { useInariskRevision } from '../../hooks/useInariskRevision';
import type { AlertSeverity } from '../../types';
import { severityToCssClass } from '../../types';
import PerkiraanMap from './PerkiraanMap';
import EmailBlastButton from './EmailBlastButton';
import MobileSplitter from '../ui/MobileSplitter';

interface MingguanTabProps {
  onEmailBlast?: (officeId: string) => void;
}

function getSeverityRank(sev: AlertSeverity | null) {
  return sev ?? 0;
}


const SEV_LABEL: Record<AlertSeverity, string> = {
  3: 'Siaga',
  2: 'Waspada',
  1: 'Potensi',
};

const MingguanTab: React.FC<MingguanTabProps> = () => {
  const { alerts } = useAlerts();
  const assessmentRevision = useInariskRevision();
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);

  const forecastAlerts = useMemo(() => alerts.filter((a) => a.type === 'extreme_weather' && a.isForecast), [alerts]);

  const provincesMap = useMemo(() => new Map(PROVINCES.map((p) => [p.id, p])), []);

  const rankedOffices = useMemo(() => {
    return KPWBI_OFFICES.map((office) => {
      const forecastSev = getProvinceForecast(office.provinceId).severity || null;
      const floodScore = BnpbInariskService.getLocalHazardIndex(office.id, 'flood');
      const rank = getSeverityRank(forecastSev) * 100 + (floodScore ?? 0) * 100;
      return { office, forecastSev, floodScore, rank };
    })
      .filter((item) => item.forecastSev !== null || (item.floodScore !== null && item.floodScore > 0.3))
      .sort((a, b) => b.rank - a.rank);
    // Forecast snapshots publish independently from the alert list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forecastAlerts, assessmentRevision]);

  const hasCritical = rankedOffices.some((r) => r.forecastSev === 3);

  const handleProvinceSelect = (id: string) => {
    setSelectedProvinceId((prev) => (prev === id ? null : id));
    setSelectedOfficeId(null);
  };

  const handleOfficeSelect = (officeId: string) => {
    setSelectedOfficeId(officeId);
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (office) setSelectedProvinceId(office.provinceId);
  };

  return (
    <div className="perkiraan-tab-layout">
      {/* Left panel */}
      <aside className="perkiraan-panel">
        <div className="perkiraan-panel-header">
          <span className="perkiraan-panel-title">Prakiraan Cuaca</span>
          <span className="perkiraan-panel-count">{rankedOffices.length} wilayah</span>
        </div>

        <p className="kerentanan-source-info" role="status">{getForecastSnapshot()?.error || ('BMKG · Tanggal tersedia: ' + (getForecastSnapshot()?.dates.join(', ') || 'Memuat...'))}</p>
        <p className="kerentanan-source-info">{getProvinceForecast(KPWBI_OFFICES[0].provinceId).dates.length < 3 ? 'Cakupan tanggal prakiraan belum lengkap 3 hari.' : 'Prakiraan dari hari ini hingga dua hari ke depan.'}</p>
        {/* In-app action reminder */}
        {hasCritical && (
          <div className="perkiraan-alert-banner critical">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>Terdapat wilayah KPw dengan prakiraan <strong>Siaga</strong>. Segera kirim notifikasi dan pastikan kesiapsiagaan!</span>
          </div>
        )}

        <div className="perkiraan-panel-scroll">
          {rankedOffices.length === 0 ? (
            <div className="perkiraan-empty">
              <p>Belum ada data prakiraan Cuaca Buruk 3 hari ke depan.</p>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6 }}>Data diambil otomatis dari BMKG setiap 60 detik.</p>
            </div>
          ) : (
            rankedOffices.map(({ office, forecastSev, floodScore }) => {
              const province = provincesMap.get(office.provinceId);
              const isSelected = selectedOfficeId === office.id;

              return (
                <div
                  key={office.id}
                  className={`perkiraan-row${isSelected ? ' selected' : ''}`}
                  onClick={() => handleOfficeSelect(office.id)}
                >
                  <div className="perkiraan-row-info">
                    <span className="perkiraan-office-name">{office.name}</span>
                    <span className="perkiraan-province-name">{province?.name ?? office.provinceId}</span>
                    <div className="perkiraan-row-tags">
                      {forecastSev && (
                        <span className={`perkiraan-badge sev-${severityToCssClass(forecastSev)}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <FlashOnIcon style={{ fontSize: 10 }} /> {SEV_LABEL[forecastSev]}
                        </span>
                      )}
                      {floodScore !== null && floodScore > 0.3 && (
                        <span className="perkiraan-badge flood" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                          <WaterDropIcon style={{ fontSize: 10 }} /> Banjir {Math.round(floodScore * 100)}
                        </span>
                      )}
                    </div>
                    {/* Show forecast dates */}
                    {forecastSev && (() => {
                      const forecasts = forecastAlerts
                        .filter((a) => a.provinceId === office.provinceId)
                        .slice(0, 3);
                      return (
                        <div className="perkiraan-forecast-days">
                          {forecasts.map((a) => (
                            <span key={a.id} className={`forecast-day-pill sev-${severityToCssClass(a.severity)}`}>
                              {a.forecastDateStr}: {a.title.split('(')[0].trim()}
                            </span>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <EmailBlastButton
                    office={office}
                    alerts={forecastAlerts}
                    compact
                  />
                </div>
              );
            })
          )}
        </div>
      </aside>

      <MobileSplitter />

      {/* Map */}
      <div className="perkiraan-map-wrap">
        <PerkiraanMap
          mode="mingguan"
          forecastAlerts={forecastAlerts}
          selectedProvinceId={selectedProvinceId}
          selectedOfficeId={selectedOfficeId}
          onProvinceSelect={handleProvinceSelect}
          onOfficeSelect={handleOfficeSelect}
        />
      </div>
    </div>
  );
};

export default MingguanTab;

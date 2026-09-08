import React, { useState, useMemo } from 'react';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { PROVINCES } from '../../constants/provinces';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import EwsMap from '../dashboard/EwsMap';
import { renderDisasterIcon } from '../../utils/alertUtils';
import ScreenshotPreviewModal from '../ui/ScreenshotPreviewModal';
import MobileSplitter from '../ui/MobileSplitter';
import '../dashboard/TopBar.css';
import './KerentananScreen.css';

type InariskHazard = 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash';

interface KerentananScreenProps {
  onBack: () => void;
}

const HAZARD_TABS: { key: InariskHazard; label: string }[] = [
  { key: 'flood', label: 'Banjir' },
  { key: 'tsunami', label: 'Tsunami' },
  { key: 'kekeringan', label: 'Kekeringan' },
  { key: 'volcanic', label: 'Gunung Api' },
  { key: 'volcanic_ash', label: 'Abu Vulkanik' },
];

function riskLevel(score: number): { label: string; cls: string } {
  const val = Math.round(score * 100);
  if (val >= 61) return { label: 'Tinggi', cls: 'risk-high' };
  if (val >= 31) return { label: 'Sedang', cls: 'risk-medium' };
  if (val >= 0) return { label: 'Rendah', cls: 'risk-low' };
  return { label: 'N/A', cls: 'risk-none' };
}

const KerentananScreen: React.FC<KerentananScreenProps> = ({ onBack }) => {
  const [selectedHazard, setSelectedHazard] = useState<InariskHazard>('flood');
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  const provincesMap = useMemo(() => new Map(PROVINCES.map((p) => [p.id, p])), []);

  const rankedOffices = useMemo(() => {
    return KPWBI_OFFICES.map((office) => ({
      office,
      score: BnpbInariskService.getLocalHazardIndex(office.id, selectedHazard),
    }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);
  }, [selectedHazard]);

  const handleProvinceSelect = (provinceId: string) => {
    setSelectedProvinceId((prev) => (prev === provinceId ? null : provinceId));
    setSelectedOfficeId(null);
  };

  const handleOfficeSelect = (officeId: string) => {
    setSelectedOfficeId(officeId);
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (office) setSelectedProvinceId(office.provinceId);
  };

  const handleScreenshot = async () => {
    try {
      const mapEl = document.querySelector('.kerentanan-map-wrap .map-wrapper');
      if (!mapEl) return;
      const domtoimage = (await import('dom-to-image-more')).default;
      const dataUrl = await domtoimage.toPng(mapEl as HTMLElement);
      setScreenshotUrl(dataUrl);
    } catch (e) {
      console.error('Gagal mengambil screenshot', e);
    }
  };

  const currentHazard = HAZARD_TABS.find((t) => t.key === selectedHazard)!;

  return (
    <div className="kerentanan-container">
      <header className="topbar-container">
        <div className="topbar-first-row">
          {/* Left: back btn + divider + brand */}
          <div className="topbar-brand">
            <button className="topbar-back-btn" onClick={onBack}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              Kembali
            </button>
            <div className="topbar-divider-v" />
            <div className="topbar-brand-text">
              <h1 className="topbar-title">Analisis <span>Kerentanan</span></h1>
              <span className="topbar-brand-sub">DEWA - BNPB InaRisk</span>
            </div>
          </div>

          {/* Right: count status chip + screenshot */}
          <div className="topbar-right">
            <button className="topbar-report-btn" onClick={handleScreenshot} title="Screenshot Peta">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
                <circle cx="12" cy="13" r="4"></circle>
              </svg>
              Screenshot
            </button>
            <div className="topbar-status kerentanan">
              <span className="topbar-status-dot" />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                {renderDisasterIcon(selectedHazard, undefined, { width: '14px', height: '14px' })}
                <span>{rankedOffices.length} Wilayah — {currentHazard.label}</span>
              </span>
            </div>
          </div>
        </div>

        {/* Center: hazard filter pills */}
        <div className="topbar-center">
          <div className="topbar-filter-group kerentanan">
            {HAZARD_TABS.map((tab) => (
              <button
                key={tab.key}
                className={`topbar-filter-pill${selectedHazard === tab.key ? ' active' : ''}`}
                onClick={() => setSelectedHazard(tab.key)}
              >
                <span>{renderDisasterIcon(tab.key)}</span>
                <span>{tab.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content: left panel + map */}
      <div className="kerentanan-content">
        <aside className="kerentanan-panel">
          <div className="kerentanan-panel-header">
            <span className="kerentanan-panel-title">Indeks Kerentanan</span>
            <span className="kerentanan-panel-count">{rankedOffices.length} wilayah</span>
          </div>

          <div className="kerentanan-panel-scroll">
            {rankedOffices.length === 0 ? (
              <div className="kerentanan-empty">
                <p>Tidak ada data kerentanan untuk bencana ini.</p>
              </div>
            ) : (
              rankedOffices.map(({ office, score }, idx) => {
                const risk = riskLevel(score);
                const province = provincesMap.get(office.provinceId);
                const isSelected = selectedOfficeId === office.id;
                return (
                  <button
                    key={office.id}
                    className={`kerentanan-row${isSelected ? ' selected' : ''}`}
                    onClick={() => handleOfficeSelect(office.id)}
                  >
                    <span className="kerentanan-rank">#{idx + 1}</span>
                    <div className="kerentanan-row-info">
                      <span className="kerentanan-office-name">{office.name}</span>
                      <span className="kerentanan-province-name">{province?.name ?? office.provinceId}</span>
                      <div className="kerentanan-score-bar-wrap">
                        <div
                          className={`kerentanan-score-bar ${risk.cls}`}
                          style={{ width: `${Math.round(score * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="kerentanan-row-right">
                      <span className={`kerentanan-risk-badge ${risk.cls}`}>{risk.label}</span>
                      <span className="kerentanan-score-value">{Math.round(score * 100)}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <MobileSplitter />

        <div className="kerentanan-map-wrap">
          <EwsMap
            alerts={[]}
            selectedProvinceId={selectedProvinceId}
            selectedOfficeId={selectedOfficeId}
            selectedAlertId={null}
            onProvinceSelect={handleProvinceSelect}
            onOfficeSelect={handleOfficeSelect}
            onAlertSelect={() => {}}
            activeTypeFilter={selectedHazard}
            isKerentananView={true}
          />
        </div>
      </div>

      <ScreenshotPreviewModal
        isOpen={!!screenshotUrl}
        imageDataUrl={screenshotUrl}
        onClose={() => setScreenshotUrl(null)}
      />
    </div>
  );
};

export default KerentananScreen;

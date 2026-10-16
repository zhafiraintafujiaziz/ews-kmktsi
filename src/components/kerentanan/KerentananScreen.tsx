import React, { useState, useMemo } from 'react';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { PROVINCES } from '../../constants/provinces';
import { BnpbIrbiService, type IrbiCategory } from '../../services/bnpbIrbiService';
import { IspuService, type OfficeIspuAssessment } from '../../services/ispuService';
import { ISPU_CATEGORIES } from '../../constants/ispuCategories';
import EwsMap from '../dashboard/EwsMap';
import { renderDisasterIcon } from '../../utils/alertUtils';
import FullPageCaptureButton from '../ui/FullPageCaptureButton';
import MobileSplitter from '../ui/MobileSplitter';
import IspuHistoryPanel from './IspuHistoryPanel';
import { INARISK_CATEGORIES, getHazardLevel, type InaRiskCategory } from '../../constants/kerentananCategories';
import { useAlerts } from '../../hooks/useAlerts';
import { useInariskRevision } from '../../hooks/useInariskRevision';
import type { OfficeHazardAssessment } from '../../utils/officeHazardAssessment';
import { getKerentananHeaderBand, resolveKerentananOfficeAssessment } from '../../utils/kerentananAssessment';
import { VOLCANO_REFERENCE_POINTS, VOLCANO_REFERENCE_SOURCE, VOLCANO_REFERENCE_RETRIEVED_AT } from '../../constants/volcanoReferencePoints';

interface KerentananScreenProps {
  onBack: () => void;
}

const HAZARD_TABS = INARISK_CATEGORIES;

function riskLevel(score: number): { label: string; cls: string } {
  const label = getHazardLevel(score);
  return { label, cls: label === 'Tinggi' ? 'risk-high' : label === 'Sedang' ? 'risk-medium' : 'risk-low' };
}

interface RankedOfficeItem {
  office: typeof KPWBI_OFFICES[number];
  score: number | null;
  assessment: OfficeHazardAssessment;
  ispuAssessment: OfficeIspuAssessment | null;
}

const KerentananScreen: React.FC<KerentananScreenProps> = ({ onBack }) => {
  const [selectedHazard, setSelectedHazard] = useState<InaRiskCategory>('earthquake');
  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);
  const [officeSelectionRevision, setOfficeSelectionRevision] = useState(0);
  const { alerts, loadingSources, feedHealth } = useAlerts();
  const assessmentRevision = useInariskRevision();

  const provincesMap = useMemo(() => new Map(PROVINCES.map((p) => [p.id, p])), []);

  const rankedOffices = useMemo<RankedOfficeItem[]>(() => {
    return KPWBI_OFFICES.flatMap((office) => {
      const ispuAssessment =
        selectedHazard === 'air_quality'
          ? IspuService.getOfficeIspuAssessment(office.id)
          : null;
      const assessment = resolveKerentananOfficeAssessment(office, selectedHazard);
      const score = assessment.index;
      if (score === null && selectedHazard !== 'earthquake' && selectedHazard !== 'karhutla' && selectedHazard !== 'extreme_weather') return [];

      return [{
        office,
        score,
        assessment,
        ispuAssessment,
      }];
    })
      .sort((a, b) => {
        if (selectedHazard === 'air_quality' && a.ispuAssessment && b.ispuAssessment) {
          return b.ispuAssessment.ispuValue - a.ispuAssessment.ispuValue;
        }
        return (b.score ?? -1) - (a.score ?? -1);
      });
    // InaRISK revisions and feed publications refresh the external assessment caches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHazard, assessmentRevision, alerts, feedHealth]);

  const handleProvinceSelect = (provinceId: string) => {
    setSelectedProvinceId((prev) => (prev === provinceId ? null : provinceId));
    setSelectedOfficeId(null);
  };

  const handleOfficeSelect = (officeId: string) => {
    setOfficeSelectionRevision(value => value + 1);
    setSelectedOfficeId(officeId);
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (office) setSelectedProvinceId(office.provinceId);
  };

  const currentHazard = HAZARD_TABS.find(t => t.key === selectedHazard)!;
  const showVolcanoReference = selectedHazard === 'volcanic' || selectedHazard === 'volcanic_ash';
  const irbiCategory: IrbiCategory | null = selectedHazard === 'earthquake' || selectedHazard === 'extreme_weather' || selectedHazard === 'karhutla' ? selectedHazard : null;
  const assessmentStatus = irbiCategory ? BnpbIrbiService.getAssessmentStatus(irbiCategory) : null;
  const displayedCount = rankedOffices.length;
  const actualAvailableCount = selectedHazard === 'air_quality'
    ? rankedOffices.filter(item => item.ispuAssessment !== null).length
    : rankedOffices.filter(item => item.score !== null && item.assessment.status !== 'assumed').length;
  const selectedSourceLoading = selectedHazard === 'air_quality'
    ? !feedHealth.ispu || loadingSources.includes('Kualitas Udara ISPU')
    : selectedHazard === 'earthquake' || selectedHazard === 'extreme_weather' || selectedHazard === 'karhutla'
      ? assessmentStatus?.status === 'idle' || assessmentStatus?.status === 'loading'
      : false;
  const initialLoading = selectedSourceLoading && actualAvailableCount === 0;
  const refreshing = selectedSourceLoading && actualAvailableCount > 0;
  const summaryLoading = initialLoading || refreshing;
  const headerBand = getKerentananHeaderBand(rankedOffices, selectedHazard, summaryLoading);
  const summaryLabel = headerBand.status === 'loading' ? 'Memuat data'
    : headerBand.status === 'no_data' ? 'Data tidak tersedia'
    : selectedHazard === 'air_quality' ? `${headerBand.count} Kantor · ISPU ${headerBand.level}`
    : `${headerBand.count} Kantor · Indeks ${headerBand.level} · ${currentHazard.label}`;
  const headerSummary = initialLoading ? currentHazard.label
    : selectedHazard === 'earthquake' && assessmentStatus?.status === 'error' ? 'Gagal memuat Gempa'
    : summaryLabel;
  const headerStatusClass = initialLoading || headerBand.status !== 'available'
    ? 'clear'
    : headerBand.level === 'Tinggi' ? 'critical'
    : headerBand.level === 'Sedang' ? 'warning'
    : 'monitoring';

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
              <h1 className="topbar-title">Analisis <span>Bahaya</span></h1>
              <span className="topbar-brand-sub">
                {showVolcanoReference ? 'DEWA - MAGMA / PVMBG' : selectedHazard === 'air_quality' ? 'DEWA - KemenLH ISPU' : 'DEWA - BNPB IRBI'}
              </span>
            </div>
          </div>

          {/* Right: count status chip + screenshot */}
          <div className="topbar-right">
            <FullPageCaptureButton filename="Bahaya_EWS" iconOnly />
            <div className={`topbar-status ${headerStatusClass}`}>
              <span className="topbar-status-dot" />
              <span className="kerentanan-status-content">
                {renderDisasterIcon(selectedHazard, undefined, { width: '14px', height: '14px' })}
                <span>{headerSummary}</span>
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
      <div className={`kerentanan-content${selectedHazard === 'air_quality' ? ' kerentanan-with-history' : ''}`}>
        <aside className="kerentanan-panel">
          {irbiCategory && currentHazard.inariskLabel && (
            <p className="kerentanan-source-info">BNPB IRBI · Kelas risiko {currentHazard.label} per kabupaten/kota kantor. Warna provinsi mengikuti kelas kantor tertinggi, bukan rata-rata seluruh provinsi.</p>
          )}
          {irbiCategory && assessmentStatus && (
            <div className="kerentanan-source-info" role="status" data-status={assessmentStatus.status}>
              <p>{actualAvailableCount}/{KPWBI_OFFICES.length} kantor memiliki nilai IRBI.</p>
              <p>{BnpbIrbiService.getAssessmentMessage(irbiCategory)}</p>
              {assessmentStatus.checkedAt && <p>Diperiksa: {new Date(assessmentStatus.checkedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</p>}
              <button className="topbar-back-btn" type="button" disabled={assessmentStatus.status === 'loading'} onClick={() => { void BnpbIrbiService.refreshAssessment(KPWBI_OFFICES); }}>Muat ulang</button>
            </div>
          )}
          {showVolcanoReference && <div className="kerentanan-source-info" data-volcano-reference>
            <p>Peta alternatif menampilkan {VOLCANO_REFERENCE_POINTS.length} titik gunung api dari <a href={VOLCANO_REFERENCE_SOURCE} target="_blank" rel="noopener noreferrer">MAGMA Indonesia / PVMBG</a> dan sketsa busur Ring of Fire. Koordinat diambil {VOLCANO_REFERENCE_RETRIEVED_AT}.</p>
            <p>Estimasi kerentanan geografis berdasarkan jarak. Gunung Api dan Abu Vulkanik: tinggi ≤30 km, sedang &gt;30–100 km, rendah &gt;100 km. Bukan zona bahaya resmi atau prakiraan sebaran abu.</p>
            {selectedHazard === 'volcanic_ash' && <p>Sebaran abu membutuhkan informasi erupsi dan angin; peta ini hanya menunjukkan lokasi sumber vulkanik.</p>}
          </div>}
          <div className="kerentanan-panel-header">
            <span className="kerentanan-panel-title">
              {showVolcanoReference ? 'Estimasi Kerentanan Geografis' : selectedHazard === 'air_quality' ? 'Peringkat Kualitas Udara (ISPU)' : irbiCategory ? 'Kelas Risiko IRBI' : 'Indeks Bahaya'}
            </span>
            {!initialLoading && <span className="kerentanan-panel-count">{displayedCount} {showVolcanoReference || selectedHazard === 'earthquake' ? 'kantor' : 'wilayah'}</span>}
          </div>

          {selectedHazard === 'air_quality' && (
            <>
              <div className="kerentanan-ispu-banner">
                <span>🍃 Sumber: SPKU Kementerian Lingkungan Hidup (KLHK)</span>
                <a href="https://ispu.kemenlh.go.id/webv5/#/" target="_blank" rel="noopener noreferrer">
                  ispu.kemenlh.go.id ↗
                </a>
              </div>
              <div className="kerentanan-ispu-legend">
                {ISPU_CATEGORIES.map(({ category, label, range, color }) => (
                  <span className="ispu-legend-item" key={category}>
                    <span className="ispu-legend-dot" style={{ backgroundColor: color, border: '1px solid #64748b' }} />
                    {label} ({range})
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="kerentanan-panel-scroll" aria-busy={initialLoading || refreshing}>
            {initialLoading ? (
              <div className="kerentanan-empty kerentanan-loading-status" role="status">
                <p>Memuat data {currentHazard.label}...</p>
              </div>
            ) : refreshing && (
              <div className="kerentanan-empty kerentanan-loading-status" role="status">
                <p>Memperbarui data {currentHazard.label}...</p>
              </div>
            )}
            {!initialLoading && rankedOffices.length === 0 ? (
              <div className="kerentanan-empty">
                <p>{selectedHazard === 'air_quality'
                  ? 'Data ISPU tidak tersedia.'
                  : irbiCategory ? BnpbIrbiService.getAssessmentMessage(irbiCategory) : 'Data tidak tersedia.'}</p>
              </div>
            ) : !initialLoading && (
              rankedOffices.map(({ office, score, assessment, ispuAssessment }, idx) => {
                const province = provincesMap.get(office.provinceId);
                const isSelected = selectedOfficeId === office.id;

                let badgeLabel = '';
                let badgeCls = '';
                let displayVal = Math.round((score ?? 0) * 100);
                const ispuBadge = selectedHazard === 'air_quality' && ispuAssessment
                  ? IspuService.getCategoryBadge(ispuAssessment.category, ispuAssessment.ispuValue) : null;

                if (selectedHazard === 'air_quality' && ispuAssessment) {
                  const badge = ispuBadge!;
                  badgeLabel = badge.label;
                  badgeCls = badge.cls;
                  displayVal = ispuAssessment.ispuValue;
                } else if (score === null) {
                  badgeLabel = 'Tidak tersedia'; badgeCls = 'risk-none';
                } else {
                  const generalRisk = riskLevel(score);
                  badgeLabel = generalRisk.label;
                  badgeCls = generalRisk.cls;
                }

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
                      {selectedHazard === 'air_quality' && ispuAssessment && (
                        <div className="kerentanan-station-info">
                          <span>SPKU: {ispuAssessment.stationName} ({ispuAssessment.distanceKm} km) • Polutan: <strong>{ispuAssessment.dominantParam}</strong></span>
                        </div>
                      )}
                      {selectedHazard !== 'air_quality' && <span className="kerentanan-station-info">{assessment.explanation}</span>}
                      {score !== null && <div className="kerentanan-score-bar-wrap">
                        <div
                          className={`kerentanan-score-bar ${badgeCls}`}
                          style={{ width: `${Math.round(score * 100)}%`, ...(ispuBadge ? { backgroundColor: ispuBadge.bg } : {}) }}
                        />
                      </div>}
                    </div>
                    <div className="kerentanan-row-right">
                      <span
                        className={`kerentanan-risk-badge ${badgeCls}`}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', ...(ispuBadge ? { backgroundColor: ispuBadge.bg, color: ispuBadge.color } : {}) }}
                      >
                        {selectedHazard === 'air_quality' && ispuAssessment && (
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              backgroundColor: IspuService.getCategoryColor(ispuAssessment.category),
                              display: 'inline-block',
                              flexShrink: 0,
                              border: '1px solid currentColor'
                            }}
                          />
                        )}
                        {badgeLabel}
                      </span>
                      <span className="kerentanan-score-value">
                        {selectedHazard === 'air_quality' ? `ISPU ${displayVal}` : score === null ? 'Tidak tersedia' : score.toFixed(2)}
                      </span>
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
            showVolcanoReference={showVolcanoReference}
            baseMapOnly={initialLoading}
          />
        </div>
        <IspuHistoryPanel active={selectedHazard === 'air_quality'} selectedOfficeId={selectedOfficeId} officeSelectionRevision={officeSelectionRevision} />
      </div>

    </div>
  );
};

export default KerentananScreen;

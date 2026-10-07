import React, { useState, useMemo } from 'react';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { PROVINCES } from '../../constants/provinces';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import { IspuService, type OfficeIspuAssessment } from '../../services/ispuService';
import { ISPU_CATEGORIES } from '../../constants/ispuCategories';
import EwsMap from '../dashboard/EwsMap';
import { renderDisasterIcon } from '../../utils/alertUtils';
import FullPageCaptureButton from '../ui/FullPageCaptureButton';
import MobileSplitter from '../ui/MobileSplitter';
import { INARISK_CATEGORIES, getHazardLevel, type InaRiskCategory } from '../../constants/kerentananCategories';
import { useAlerts } from '../../hooks/useAlerts';
import { useInariskRevision } from '../../hooks/useInariskRevision';
import type { OfficeHazardAssessment } from '../../utils/officeHazardAssessment';
import { resolveKerentananOfficeAssessment } from '../../utils/kerentananAssessment';
import { KarhutlaRegionalService } from '../../services/karhutlaRegionalService';
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
  const { alerts, isLoading } = useAlerts();
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
      if (score === null && selectedHazard !== 'karhutla' && selectedHazard !== 'extreme_weather') return [];

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
  }, [selectedHazard, assessmentRevision, alerts]);

  const handleProvinceSelect = (provinceId: string) => {
    setSelectedProvinceId((prev) => (prev === provinceId ? null : provinceId));
    setSelectedOfficeId(null);
  };

  const handleOfficeSelect = (officeId: string) => {
    setSelectedOfficeId(officeId);
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (office) setSelectedProvinceId(office.provinceId);
  };

  const currentHazard = HAZARD_TABS.find(t => t.key === selectedHazard)!;
  const showVolcanoReference = selectedHazard === 'volcanic' || selectedHazard === 'volcanic_ash';
  const useInaRisk = selectedHazard === 'earthquake' || selectedHazard === 'karhutla' || selectedHazard === 'extreme_weather';
  const assessmentStatus = selectedHazard === 'karhutla' ? KarhutlaRegionalService.getAssessmentStatus() : useInaRisk ? BnpbInariskService.getAssessmentStatus(selectedHazard) : null;
  const displayedCount = rankedOffices.length;
  const availableCount = rankedOffices.filter(item => item.score !== null).length;

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
                {showVolcanoReference ? 'DEWA - MAGMA / PVMBG' : selectedHazard === 'air_quality' ? 'DEWA - KemenLH ISPU' : 'DEWA - BNPB InaRISK'}
              </span>
            </div>
          </div>

          {/* Right: count status chip + screenshot */}
          <div className="topbar-right">
            <FullPageCaptureButton filename="Bahaya_EWS" />
            <div className="topbar-status kerentanan">
              <span className="topbar-status-dot" />
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                {renderDisasterIcon(selectedHazard, undefined, { width: '14px', height: '14px' })}
                <span>{displayedCount} {showVolcanoReference ? 'Kantor' : 'Wilayah'} — {currentHazard.label}</span>
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
                {tab.key === 'air_quality' && (
                  <span
                    style={{
                      width: '7px',
                      height: '7px',
                      borderRadius: '50%',
                      backgroundColor: '#ef4444',
                      display: 'inline-block',
                      marginLeft: '3px',
                      boxShadow: '0 0 3px rgba(0,0,0,0.3)',
                    }}
                    title="Indikator Kualitas Udara ISPU"
                  />
                )}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Main content: left panel + map */}
      <div className="kerentanan-content">
        <aside className="kerentanan-panel">
          {useInaRisk && currentHazard.inariskLabel && (
            <p className="kerentanan-source-info">InaRISK · Bahaya {currentHazard.inariskLabel}. {selectedHazard === 'karhutla' ? 'Indeks kantor adalah rata-rata sel raster valid dalam radius 25 km. Warna provinsi mengikuti indeks kantor tertinggi, bukan rata-rata seluruh provinsi.' : 'Warna provinsi menunjukkan indeks tertinggi dari kantor yang memiliki data, bukan seluruh wilayah provinsi.'}</p>
          )}
          {selectedHazard === 'extreme_weather' && <p className="kerentanan-source-info">Kerentanan Cuaca menggunakan indeks Bahaya Banjir InaRISK pada titik kantor. Indeks ini menggambarkan bahaya banjir, bukan seluruh jenis cuaca ekstrem. Provinsi dan kantor tanpa data menggunakan asumsi indeks 0.10, kategori Rendah. Halaman Perkiraan tetap menggunakan BMKG.</p>}
          {selectedHazard === 'karhutla' && <div className="kerentanan-source-info" role="status" data-karhutla-status={assessmentStatus?.status}>
            <p>Nilai raster 25 km: {availableCount}/{KPWBI_OFFICES.length} kantor tersedia.</p>
            <p>{assessmentStatus?.status === 'loading' ? 'Menghitung statistik raster...' : assessmentStatus?.status === 'error' ? 'Statistik InaRISK gagal dimuat.' : assessmentStatus?.status === 'no_data' ? 'Tidak ada sel raster valid pada wilayah kantor.' : 'NoData dikecualikan; angka 0 tetap dihitung. Cakupan adalah perkiraan proporsi area dengan data valid.'}</p>
            {!!assessmentStatus?.failedOfficeCount && <p>{assessmentStatus.failedOfficeCount} kantor gagal dihitung. Gunakan hitung ulang untuk mencoba kembali.</p>}
            {assessmentStatus?.checkedAt && <p>Diperiksa: {new Date(assessmentStatus.checkedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</p>}
            <button className="topbar-back-btn" type="button" disabled={assessmentStatus?.status === 'loading'} onClick={() => { void KarhutlaRegionalService.refresh(KPWBI_OFFICES, true); }}>Hitung ulang</button>
          </div>}
          {(selectedHazard === 'earthquake' || selectedHazard === 'extreme_weather') && assessmentStatus && (
            <p className="kerentanan-source-info" role="status" data-status={assessmentStatus.status}>
              {BnpbInariskService.getAssessmentMessage(selectedHazard)}
              {assessmentStatus.checkedAt && <> Terakhir diperiksa: {new Date(assessmentStatus.checkedAt).toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB.</>}
            </p>
          )}
          {showVolcanoReference && <div className="kerentanan-source-info" data-volcano-reference>
            <p>Peta alternatif menampilkan {VOLCANO_REFERENCE_POINTS.length} titik gunung api dari <a href={VOLCANO_REFERENCE_SOURCE} target="_blank" rel="noopener noreferrer">MAGMA Indonesia / PVMBG</a> dan sketsa busur Ring of Fire. Koordinat diambil {VOLCANO_REFERENCE_RETRIEVED_AT}.</p>
            <p>Estimasi kerentanan geografis berdasarkan jarak. Gunung Api dan Abu Vulkanik: tinggi ≤30 km, sedang &gt;30–100 km, rendah &gt;100 km. Bukan zona bahaya resmi atau prakiraan sebaran abu.</p>
            {selectedHazard === 'volcanic_ash' && <p>Sebaran abu membutuhkan informasi erupsi dan angin; peta ini hanya menunjukkan lokasi sumber vulkanik.</p>}
          </div>}
          <div className="kerentanan-panel-header">
            <span className="kerentanan-panel-title">
              {showVolcanoReference ? 'Estimasi Kerentanan Geografis' : selectedHazard === 'extreme_weather' ? 'Indeks Banjir InaRISK' : selectedHazard === 'air_quality' ? 'Peringkat Kualitas Udara (ISPU)' : selectedHazard === 'karhutla' ? 'Indeks Karhutla · 25 km' : 'Indeks Bahaya'}
            </span>
            <span className="kerentanan-panel-count">{displayedCount} {showVolcanoReference ? 'kantor' : 'wilayah'}</span>
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

          <div className="kerentanan-panel-scroll">
            {rankedOffices.length === 0 ? (
              <div className="kerentanan-empty">
                <p>{selectedHazard === 'air_quality'
                  ? isLoading ? 'Memuat data...' : 'Data ISPU tidak tersedia.'
                  : BnpbInariskService.getAssessmentMessage(selectedHazard)}</p>
              </div>
            ) : (
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
          />
        </div>
      </div>

    </div>
  );
};

export default KerentananScreen;

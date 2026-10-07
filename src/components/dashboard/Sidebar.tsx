import React, { useState, useMemo, useRef } from 'react';
import type { DisasterAlert, AlertSeverity, DisasterType, RiskCalcResult, RiskLevel } from '../../types';
import { severityToCssClass } from '../../types';
import { PROVINCES } from '../../constants/provinces';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { renderDisasterIcon } from '../../utils/alertUtils';
import { buildOfficeRiskMap } from '../../utils/riskCalculator';
import { useInariskRevision } from '../../hooks/useInariskRevision';
import AlertCard from './AlertCard';
import OfficeRiskCard from './OfficeRiskCard';
import { buildOfficeRiskSummaries, filterOfficeRiskSummaries, type OfficeRiskFilter } from '../../utils/officeRiskSummary';

const SEV_LABEL: Record<AlertSeverity, RiskLevel> = {
  3: 'Tinggi',
  2: 'Sedang',
  1: 'Rendah',
};

interface SidebarProps {
  filteredAlerts: DisasterAlert[];
  totalAlertCount: number;
  riskResults: RiskCalcResult[];
  stats: Record<AlertSeverity | 'total', number>;
  selectedOfficeId: string | null;
  onProvinceSelect: (provinceId: string) => void;
  onOfficeSelect?: (officeId: string) => void;
  selectedAlertId: string | null;
  onAlertSelect: (alertId: string) => void;
  severityFilter: AlertSeverity | 'all';
  setSeverityFilter: (val: AlertSeverity | 'all') => void;
  typeFilter: DisasterType | 'all';
  setTypeFilter: (val: DisasterType | 'all') => void;
  isLoading?: boolean;
  loadingSources?: string[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

const SORT_OPTIONS = [
  { value: 'newest', label: 'Terbaru' },
  { value: 'oldest', label: 'Terlama' },
  { value: 'magnitude-desc', label: 'Magnitudo Tertinggi' },
  { value: 'magnitude-asc', label: 'Magnitudo Terendah' },
  { value: 'severity-desc', label: 'Tingkat Tertinggi' },
] as const;
type SortKey = typeof SORT_OPTIONS[number]['value'];

export const Sidebar: React.FC<SidebarProps> = ({
  filteredAlerts,
  totalAlertCount,
  stats,
  selectedOfficeId,
  onProvinceSelect,
  onOfficeSelect,
  selectedAlertId,
  onAlertSelect,
  severityFilter,
  setSeverityFilter,
  typeFilter,
  setTypeFilter,
  isLoading,
  loadingSources = [],
  isCollapsed,
  onToggleCollapse,
}) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'alerts' | 'provinces'>('alerts');
  const [alertSearch, setAlertSearch] = useState('');
  const [officeSearch, setOfficeSearch] = useState('');
  const [officeProvinceFilter, setOfficeProvinceFilter] = useState('all');
  const [officeRiskFilter, setOfficeRiskFilter] = useState<OfficeRiskFilter>('all');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [officeFiltersOpen, setOfficeFiltersOpen] = useState(false);
  const [activeStatPanel, setActiveStatPanel] = useState<AlertSeverity | null>(null);

  const assessmentRevision = useInariskRevision();
  const officeRiskLevels = useMemo(
    () => buildOfficeRiskMap(KPWBI_OFFICES, filteredAlerts),
    // The external InaRISK cache can change without a new alert array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredAlerts, assessmentRevision],
  );

  // Counts of offices per risk level
  const riskStats = useMemo(() => {
    const counts: Record<number, number> = { 3: 0, 2: 0, 1: 0 };
    officeRiskLevels.forEach(({ riskLevel }) => {
      if (riskLevel === 'Tinggi') counts[3]++;
      else if (riskLevel === 'Sedang') counts[2]++;
      else counts[1]++;
    });
    return counts;
  }, [officeRiskLevels]);

  // Group offices per risk level for panel display
  const officesByBand = useMemo(() => {
    const result = new Map<AlertSeverity, Array<{ office: typeof KPWBI_OFFICES[0]; topHazards: string[] }>>([
      [3, []],
      [2, []],
      [1, []],
    ]);
    
    officeRiskLevels.forEach((data, officeId) => {
      const office = KPWBI_OFFICES.find((o) => o.id === officeId);
      if (!office) return;
      const band: AlertSeverity = data.riskLevel === 'Tinggi' ? 3 : data.riskLevel === 'Sedang' ? 2 : 1;
      const topHazards = Array.from(new Set(data.alerts.map((a) => a.type)));
      result.get(band)?.push({ office, topHazards });
    });
    
    return result;
  }, [officeRiskLevels]);

  const sortedAlerts = useMemo(() => {
    const search = alertSearch.trim().toLocaleLowerCase('id');
    const list = filteredAlerts.filter(alert => !search || [
      alert.title, alert.description, alert.affectedArea, alert.stationName,
      PROVINCES.find(province => province.id === alert.provinceId)?.name,
    ].some(value => value?.toLocaleLowerCase('id').includes(search)));
    switch (sortBy) {
      case 'newest': return list.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      case 'oldest': return list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      case 'magnitude-desc': return list.sort((a, b) => (b.magnitude || 0) - (a.magnitude || 0));
      case 'magnitude-asc': return list.sort((a, b) => (a.magnitude || 0) - (b.magnitude || 0));
      case 'severity-desc': return list.sort((a, b) => {
        const diff = (b.severity || 0) - (a.severity || 0);
        return diff !== 0 ? diff : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      });
      default: return list;
    }
  }, [filteredAlerts, sortBy, alertSearch]);

  const rankedOffices = useMemo(
    () => buildOfficeRiskSummaries(KPWBI_OFFICES, filteredAlerts),
    // Assessment caches publish revisions without changing the alerts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filteredAlerts, assessmentRevision],
  );
  const scopedOffices = useMemo(() => filterOfficeRiskSummaries(rankedOffices, {
    search: officeSearch, provinceId: officeProvinceFilter,
  }), [rankedOffices, officeSearch, officeProvinceFilter]);
  const visibleOffices = useMemo(() => filterOfficeRiskSummaries(scopedOffices, {
    risk: officeRiskFilter,
  }), [scopedOffices, officeRiskFilter]);
  const officeInsights = {
    affected: scopedOffices.filter(summary => summary.alertCount > 0).length,
    multiple: scopedOffices.filter(summary => summary.hazards.length > 1).length,
    unaffected: scopedOffices.filter(summary => summary.alertCount === 0).length,
  };
  const hasOfficeFilters = officeSearch.trim() !== '' || officeProvinceFilter !== 'all' || officeRiskFilter !== 'all';
  const resetOfficeFilters = () => {
    setOfficeSearch('');
    setOfficeProvinceFilter('all');
    setOfficeRiskFilter('all');
  };
  const officeProvinces = useMemo(() => PROVINCES.filter(province =>
    KPWBI_OFFICES.some(office => office.provinceId === province.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'id')), []);

  const provincesMap = useMemo(() => new Map(PROVINCES.map((p) => [p.id, p])), []);

  const handleStatClick = (severity: AlertSeverity) => {
    setActiveStatPanel((previous) => isCollapsed ? severity : previous === severity ? null : severity);
    if (isCollapsed) onToggleCollapse();
    if (contentRef.current) contentRef.current.scrollTop = 0;
  };

  const handleTabClick = (tab: 'alerts' | 'provinces') => {
    setActiveTab(tab);
    if (isCollapsed) onToggleCollapse();
  };

  const hasAlertFilters = alertSearch.trim() !== '' || severityFilter !== 'all' || typeFilter !== 'all' || sortBy !== 'newest';
  const resetAlertFilters = () => {
    setAlertSearch('');
    setSeverityFilter('all');
    setTypeFilter('all');
    setSortBy('newest');
  };
  const levelFilter = (
    <div className="filter-group sidebar-level-filter">
      <div className="severity-pills" role="group" aria-label="Filter tingkat risiko">
        {([3, 2, 1] as AlertSeverity[]).map((sev) => {
          const sevCss = severityToCssClass(sev);
          return (
            <button
              type="button"
              key={sev}
              aria-label={`Tingkat ${SEV_LABEL[sev]}`}
              aria-pressed={severityFilter === sev}
              className={`severity-pill sev-${sevCss}${severityFilter === sev ? ' active' : ''}`}
              onClick={() => setSeverityFilter(severityFilter === sev ? 'all' : sev)}
            >
              <span className="pill-boxes">
                {[1, 2, 3].map((i) => (
                  <span key={i} className={`pill-box${i <= sev ? ' filled' : ''}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );

  void stats;

  return (
    <aside className={`sidebar-container${isCollapsed ? ' sidebar-collapsed' : ''}`} aria-label="Pemantauan bencana">
      <section className="sidebar-stats-container" aria-label="Tingkat risiko kantor">
        <div className="sidebar-stats-title-row">
          <span className="sidebar-stats-title">Tingkat Risiko Lokasi Kerja</span>
          <span className="sidebar-info-tooltip-container" title="Kategori berdasarkan skor akhir: 1–2 Rendah, 3–5 Sedang, 6–9 Tinggi. Keparahan 3: selalu 9/9 Tinggi. Keparahan 1 atau 2: skor = Keparahan × Kerentanan. Nilai kerentanan mengikuti halaman Kerentanan. ISPU memakai keparahan sebagai kedua faktor: 1/9 Rendah, 4/9 Sedang, 9/9 Tinggi." aria-label="Kategori risiko berdasarkan skor akhir: 1 sampai 2 Rendah, 3 sampai 5 Sedang, 6 sampai 9 Tinggi">
            <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7v1" />
            </svg>
          </span>
          <button
            type="button"
            className="sidebar-toggle-btn"
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Buka sidebar' : 'Ciutkan sidebar'}
            aria-label={isCollapsed ? 'Buka sidebar' : 'Ciutkan sidebar'}
            aria-expanded={!isCollapsed}
            aria-controls="sidebar-content"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="3" />
              <path d="M9 4v16" />
              <path d={isCollapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'} />
            </svg>
          </button>
        </div>
        <div className="sidebar-stats-row">
          {([3, 2, 1] as AlertSeverity[]).map((severity) => (
            <button
              type="button"
              key={severity}
              className={`sidebar-stat-card ${severityToCssClass(severity)}${activeStatPanel === severity ? ' stat-active' : ''}`}
              onClick={() => handleStatClick(severity)}
              title={`Risiko ${SEV_LABEL[severity]}: ${riskStats[severity]} kantor`}
              aria-label={`Risiko ${SEV_LABEL[severity]}: ${riskStats[severity]} kantor`}
              aria-expanded={!isCollapsed && activeStatPanel === severity}
              aria-controls="sidebar-risk-panel"
            >
              <span className="sidebar-stat-value">{riskStats[severity]}</span>
              <span className="sidebar-stat-label">{isCollapsed ? SEV_LABEL[severity][0] : SEV_LABEL[severity]}</span>
            </button>
          ))}
        </div>
      </section>

      <nav className="sidebar-tabs" aria-label="Konten pemantauan">
        <button type="button" className={`sidebar-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => handleTabClick('alerts')} aria-pressed={activeTab === 'alerts'} aria-label={`Peringatan: ${filteredAlerts.length}`} title={`Peringatan: ${filteredAlerts.length}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10 21h4" />
          </svg>
          <span className="sidebar-tab-label">Peringatan</span>
          <span className="sidebar-tab-count">{filteredAlerts.length}</span>
        </button>
        <button type="button" className={`sidebar-tab-btn ${activeTab === 'provinces' ? 'active' : ''}`} onClick={() => handleTabClick('provinces')} aria-pressed={activeTab === 'provinces'} aria-label={`Lokasi Kerja: ${KPWBI_OFFICES.length}`} title={`Lokasi Kerja: ${KPWBI_OFFICES.length}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-5h4v5" />
          </svg>
          <span className="sidebar-tab-label">Lokasi Kerja</span>
          <span className="sidebar-tab-count">{KPWBI_OFFICES.length}</span>
        </button>
      </nav>

      <div id="sidebar-content" className="sidebar-scrollable-content" ref={contentRef} hidden={isCollapsed}>
        {activeStatPanel && (() => {
          const offices = officesByBand.get(activeStatPanel) ?? [];
          return (
            <div id="sidebar-risk-panel" className={`stat-panel stat-panel-${severityToCssClass(activeStatPanel)}`}>
              <div className="stat-panel-header">
                <span className="stat-panel-title">
                  Level Risiko Bencana
                  <span className="stat-panel-badge">{SEV_LABEL[activeStatPanel]} · {offices.length} kantor</span>
                </span>
                <button className="stat-panel-close" aria-label="Tutup kelompok risiko" onClick={() => setActiveStatPanel(null)}>✕</button>
              </div>
              <div className="stat-panel-body">
                {offices.length === 0 ? (
                  <p className="stat-panel-empty">Tidak ada KPW pada level risiko ini.</p>
                ) : (
                  offices.map(({ office, topHazards }) => (
                    <button
                      key={office.id}
                      className={`stat-panel-item${selectedOfficeId === office.id ? ' selected' : ''}`}
                      aria-pressed={selectedOfficeId === office.id}
                      onClick={() => onOfficeSelect ? onOfficeSelect(office.id) : onProvinceSelect(office.provinceId)}
                    >
                      <div className="stat-panel-item-info">
                        <span className="stat-panel-item-name">{office.name}</span>
                        <span className="stat-panel-item-city">{office.city}</span>
                      </div>
                      {topHazards && topHazards.length > 0 && (
                        <span className="stat-panel-item-types" style={{ display: 'flex', gap: '3px', alignItems: 'center' }}>
                          {topHazards.map((hz) => (
                            <React.Fragment key={hz}>
                              {renderDisasterIcon(hz, undefined, { width: '14px', height: '14px' })}
                            </React.Fragment>
                          ))}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })()}

        {isLoading ? (
          <div className="sidebar-loading-overlay" role="status">
            <div className="sidebar-spinner" />
            <p style={{ fontWeight: 500, marginTop: '8px' }}>
              Memuat data...
            </p>
            {loadingSources.length > 0 && (
              <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                {loadingSources.map((source) => (
                  <div key={source} style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'center', marginBottom: '4px' }}>
                    <div className="sidebar-spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} />
                    {source}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {activeTab === 'alerts' && (
              <>
                {levelFilter}
                <div className="filters-accordion">
                  <button
                    className="filters-accordion-trigger"
                    aria-expanded={filtersOpen}
                    aria-controls="sidebar-filter-options"
                    onClick={() => setFiltersOpen((v) => !v)}
                  >
                    <span className="filters-trigger-label">
                      Filter &amp; Urutkan
                      {hasAlertFilters && (
                        <span className="filters-active-dot" />
                      )}
                    </span>
                    <svg
                      viewBox="0 0 24 24" width="14" height="14"
                      fill="none" stroke="currentColor" strokeWidth="2.5"
                      strokeLinecap="round" strokeLinejoin="round"
                      className={filtersOpen ? 'rotated' : ''}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {filtersOpen && (
                    <div className="filters-accordion-body" id="sidebar-filter-options">
                      <input type="search" placeholder="Cari peringatan, wilayah, atau provinsi..."
                        aria-label="Cari peringatan, wilayah, atau provinsi" className="sidebar-search-box"
                        value={alertSearch} onChange={(e) => setAlertSearch(e.target.value)} />
                      <div className="sidebar-filter-grid">
                        <div className="filter-group">
                          <label className="filter-label" htmlFor="sidebar-disaster-type">Jenis Bencana</label>
                          <select id="sidebar-disaster-type" className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DisasterType | 'all')}>
                            <option value="all">Semua Jenis</option>
                            <option value="earthquake">Gempa Bumi</option>
                            <option value="extreme_weather">Cuaca Buruk</option>
                            <option value="karhutla">Karhutla</option>
                            <option value="volcanic">Gunung Api</option>
                            <option value="volcanic_ash">Abu Vulkanik (INA-SIAM)</option>
                            <option value="air_quality">Kualitas Udara (ISPU)</option>
                          </select>
                        </div>
                        <div className="filter-group">
                          <label className="filter-label" htmlFor="sidebar-sort">Urutkan</label>
                          <select id="sidebar-sort" className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
                            {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div className="sidebar-filter-result-count">
                        <span>{sortedAlerts.length} dari {totalAlertCount} peringatan</span>
                        {hasAlertFilters && <button type="button" onClick={resetAlertFilters}>Reset filter peringatan</button>}
                      </div>
                    </div>
                  )}
                </div>

                {sortedAlerts.length > 0 ? (
                  sortedAlerts.map((alert) => (
                    <AlertCard
                      key={alert.id}
                      alert={alert}
                      province={provincesMap.get(alert.provinceId)}
                      isSelected={selectedAlertId === alert.id}
                      onClick={() => onAlertSelect(alert.id)}
                    />
                  ))
                ) : (
                  <div className="empty-state">
                    <p>Tidak ada peringatan yang cocok dengan pencarian dan filter.</p>
                    {hasAlertFilters && <button type="button" className="office-risk-reset" onClick={resetAlertFilters}>Reset filter peringatan</button>}
                  </div>
                )}
              </>
            )}

            {activeTab === 'provinces' && (
              <>
                <div className="office-risk-overview">
                  <div className="office-risk-insights" aria-label="Ringkasan kantor berdasarkan pencarian dan provinsi">
                    {([
                      ['affected', 'Terdampak'],
                      ['multiple', '>1 Bencana'],
                      ['unaffected', 'Tanpa peringatan'],
                    ] as const).map(([filter, label]) => (
                      <button type="button" key={filter} className={'office-risk-insight office-risk-insight-' + filter + (officeRiskFilter === filter ? ' active' : '')}
                        aria-pressed={officeRiskFilter === filter}
                        onClick={() => setOfficeRiskFilter(previous => previous === filter ? 'all' : filter)}>
                        <strong>{officeInsights[filter]}</strong><span>{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="filters-accordion">
                  <button type="button" className="filters-accordion-trigger"
                    aria-expanded={officeFiltersOpen} aria-controls="office-filter-options"
                    onClick={() => setOfficeFiltersOpen(previous => !previous)}>
                    <span className="filters-trigger-label">
                      Filter Lokasi Kerja
                      {(hasOfficeFilters || severityFilter !== 'all' || typeFilter !== 'all') && <span className="filters-active-dot" />}
                    </span>
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"
                      fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className={officeFiltersOpen ? 'rotated' : ''}>
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                  {officeFiltersOpen && (
                    <div className="filters-accordion-body" id="office-filter-options">
                      {(severityFilter !== 'all' || typeFilter !== 'all') && (
                        <div className="office-risk-filter-note">
                          <span>Filter peringatan aktif membatasi data bencana.</span>
                          <button type="button" onClick={() => { setSeverityFilter('all'); setTypeFilter('all'); }}>Reset peringatan</button>
                        </div>
                      )}
                      <div className="office-risk-controls">
                        <input type="search" placeholder="Cari kantor, kota, atau provinsi..."
                          aria-label="Cari kantor BI, kota, atau provinsi" className="sidebar-search-box"
                          value={officeSearch} onChange={(e) => setOfficeSearch(e.target.value)} />
                        <div className="sidebar-filter-grid">
                          <div className="filter-group">
                            <label className="filter-label" htmlFor="office-province-filter">Provinsi</label>
                            <select id="office-province-filter" className="filter-select" value={officeProvinceFilter}
                              onChange={(e) => setOfficeProvinceFilter(e.target.value)}>
                              <option value="all">Semua provinsi</option>
                              {officeProvinces.map(province => <option key={province.id} value={province.id}>{province.name}</option>)}
                            </select>
                          </div>
                          <div className="filter-group">
                            <label className="filter-label" htmlFor="office-risk-filter">Status kantor</label>
                            <select id="office-risk-filter" className="filter-select" value={officeRiskFilter}
                              onChange={(e) => setOfficeRiskFilter(e.target.value as OfficeRiskFilter)}>
                              <option value="all">Semua kantor</option>
                              <option value="affected">Terdampak</option>
                              <option value="multiple">2+ jenis bencana</option>
                              {scopedOffices.some(summary => summary.alertCount > 0 && summary.totalScore === null) && <option value="unscored">Skor belum tersedia</option>}
                              <option value="unaffected">Tanpa peringatan</option>
                            </select>
                          </div>
                        </div>
                        <div className="sidebar-filter-result-count">
                          <span>{visibleOffices.length} dari {rankedOffices.length} kantor · Urutan risiko tertinggi</span>
                          {hasOfficeFilters && <button type="button" onClick={resetOfficeFilters}>Reset filter lokasi kerja</button>}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <ol className="office-risk-list" aria-label="Lokasi Kerja diurutkan berdasarkan skor risiko tertinggi">
                  {visibleOffices.map((summary, index) => (
                    <OfficeRiskCard key={summary.office.id} summary={summary} rank={index + 1}
                      isSelected={selectedOfficeId === summary.office.id} selectedAlertId={selectedAlertId}
                      onOfficeSelect={() => onOfficeSelect ? onOfficeSelect(summary.office.id) : onProvinceSelect(summary.office.provinceId)}
                      onAlertSelect={onAlertSelect} />
                  ))}
                </ol>
                {visibleOffices.length === 0 && (
                  <div className="empty-state">
                    <p>Tidak ada kantor yang cocok dengan pencarian dan filter.</p>
                    {hasOfficeFilters && <button type="button" className="office-risk-reset" onClick={resetOfficeFilters}>Reset filter lokasi kerja</button>}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;

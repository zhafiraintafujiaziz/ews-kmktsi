import React, { useState, useMemo, useRef } from 'react';
import type { DisasterAlert, AlertSeverity, DisasterType, RiskCalcResult } from '../../types';
import { severityToCssClass } from '../../types';
import { PROVINCES } from '../../constants/provinces';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { renderDisasterIcon } from '../../utils/alertUtils';
import { buildOfficeRiskMap } from '../../utils/riskCalculator';
import { useInariskRevision } from '../../hooks/useInariskRevision';
import AlertCard from './AlertCard';

const SEV_LABEL: Record<AlertSeverity, string> = {
  3: 'Tinggi',
  2: 'Sedang',
  1: 'Rendah',
};

interface SidebarProps {
  filteredAlerts: DisasterAlert[];
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
  const [officeSearch, setOfficeSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeStatPanel, setActiveStatPanel] = useState<AlertSeverity | null>(null);
  const [expandedRegions, setExpandedRegions] = useState<Record<string, boolean>>({
    'Sumatera': true,
    'Jawa': true,
    'Kalimantan': true,
    'Bali & Nusa Tenggara': true,
    'Sulawesi, Maluku, & Papua': true,
  });

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
    const list = [...filteredAlerts];
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
  }, [filteredAlerts, sortBy]);

  const groupedOffices = useMemo(() => {
    const searchLower = officeSearch.toLowerCase();
    const filtered = KPWBI_OFFICES.filter(
      (o) => o.name.toLowerCase().includes(searchLower) || o.city.toLowerCase().includes(searchLower)
    );
    const groups: Record<string, typeof KPWBI_OFFICES> = {
      'Sumatera': [],
      'Jawa': [],
      'Kalimantan': [],
      'Bali & Nusa Tenggara': [],
      'Sulawesi, Maluku, & Papua': [],
    };
    filtered.forEach((o) => {
      const r = o.region || 'Lainnya';
      if (groups[r]) groups[r].push(o);
      else {
        if (!groups['Lainnya']) groups['Lainnya'] = [];
        groups['Lainnya'].push(o);
      }
    });
    return groups;
  }, [officeSearch]);

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
        <button type="button" className={`sidebar-tab-btn ${activeTab === 'provinces' ? 'active' : ''}`} onClick={() => handleTabClick('provinces')} aria-pressed={activeTab === 'provinces'} aria-label={`Kantor BI: ${KPWBI_OFFICES.length}`} title={`Kantor BI: ${KPWBI_OFFICES.length}`}>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h1m4 0h1M9 11h1m4 0h1M10 21v-5h4v5" />
          </svg>
          <span className="sidebar-tab-label">Kantor BI</span>
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
                <div className="filters-accordion">
                  <button
                    className="filters-accordion-trigger"
                    aria-expanded={filtersOpen}
                    aria-controls="sidebar-filter-options"
                    onClick={() => setFiltersOpen((v) => !v)}
                  >
                    <span className="filters-trigger-label">
                      Filter &amp; Urutkan
                      {(severityFilter !== 'all' || typeFilter !== 'all' || sortBy !== 'newest') && (
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
                      <div className="filter-group">
                        <label className="filter-label">Tingkat</label>
                        <div className="severity-pills">
                          <button aria-pressed={severityFilter === 'all'} className={`severity-pill${severityFilter === 'all' ? ' active' : ''}`} onClick={() => setSeverityFilter('all')}>Semua</button>
                          {([3, 2, 1] as AlertSeverity[]).map((sev) => {
                            const sevCss = severityToCssClass(sev);
                            return (
                              <button
                                key={sev}
                                aria-label={`Tingkat ${SEV_LABEL[sev]}`}
                                aria-pressed={severityFilter === sev}
                                className={`severity-pill sev-${sevCss}${severityFilter === sev ? ' active' : ''}`}
                                onClick={() => setSeverityFilter(sev)}
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
                    <p>Tidak ada peringatan yang cocok dengan filter.</p>
                  </div>
                )}
              </>
            )}

            {activeTab === 'provinces' && (
              <>
                <input
                  type="text"
                  placeholder="Cari kantor BI atau kota..."
                  aria-label="Cari kantor BI atau kota"
                  className="sidebar-search-box"
                  value={officeSearch}
                  onChange={(e) => setOfficeSearch(e.target.value)}
                />
                {Object.keys(groupedOffices).map((region) => {
                  const list = groupedOffices[region];
                  if (!list || list.length === 0) return null;
                  const isExpanded = !!expandedRegions[region];
                  return (
                    <div key={region} className="province-group">
                      <button type="button" className="province-group-header" aria-expanded={isExpanded} onClick={() => setExpandedRegions((prev) => ({ ...prev, [region]: !prev[region] }))}>
                        <span className="province-group-title">{region}</span>
                        <span className="province-group-count">{list.length}<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" className={isExpanded ? 'rotated' : ''}><polyline points="6 9 12 15 18 9" /></svg></span>
                      </button>
                      {isExpanded && (
                        <div className="province-group-list">
                          {list.map((office) => {
                            const hasAlert = filteredAlerts.some((a) => a.provinceId === office.provinceId);
                            return (
                              <button
                                key={office.id}
                                className={`province-item-btn ${selectedOfficeId === office.id ? 'selected' : ''} ${office.isKorwil ? 'korwil-office' : ''}`}
                                aria-pressed={selectedOfficeId === office.id}
                                onClick={() => onOfficeSelect ? onOfficeSelect(office.id) : onProvinceSelect(office.provinceId)}
                              >
                                <div className="province-item-left">
                                  <span className={`province-item-dot ${hasAlert ? 'active-alert' : ''}`} />
                                  <span style={{ fontWeight: office.isKorwil ? 600 : 400 }}>
                                    {office.name}
                                    {office.isKantorPusat && ' 🏛️'}
                                    {office.isKorwil && !office.isKantorPusat && ' ★'}
                                  </span>
                                </div>
                                <span className="province-capital-lbl" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {office.city}
                                  {office.isKorwil && <span className="korwil-badge">KORWIL</span>}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {Object.values(groupedOffices).every((l) => l.length === 0) && (
                  <div className="empty-state">
                    <p>Kantor BI tidak ditemukan: "{officeSearch}"</p>
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

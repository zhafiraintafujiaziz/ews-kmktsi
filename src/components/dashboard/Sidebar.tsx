import React, { useState, useMemo } from 'react';
import type { DisasterAlert, AlertSeverity, DisasterType, RiskCalcResult } from '../../types';
import { severityToCssClass } from '../../types';
import { PROVINCES } from '../../constants/provinces';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { renderDisasterIcon } from '../../utils/alertUtils';
import { buildOfficeRiskMap } from '../../utils/riskCalculator';
import AlertCard from './AlertCard';
import './Sidebar.css';

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

  const officeRiskLevels = useMemo(
    () => buildOfficeRiskMap(KPWBI_OFFICES, filteredAlerts),
    [filteredAlerts],
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

  const handleStatClick = (sev: AlertSeverity) => {
    setActiveStatPanel((prev) => (prev === sev ? null : sev));
  };

  // Suppress unused-variable warning from linter while keeping the computed value
  void stats;


  return (
    <aside className={`sidebar-container${isCollapsed ? ' sidebar-collapsed' : ''}`}>
      {isCollapsed ? (
        /* ── Collapsed view ───────────────────────────────────── */
        <>
          <button className="sidebar-toggle-btn" onClick={onToggleCollapse} title="Expand sidebar">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>

          <div className="sidebar-stats-collapsed">
            <div className="sidebar-stat-icon critical" title={`${riskStats[3]} Tinggi`}>
              <span className="stat-icon-value">{riskStats[3]}</span>
              <span className="stat-icon-label">T</span>
            </div>
            <div className="sidebar-stat-icon warning" title={`${riskStats[2]} Sedang`}>
              <span className="stat-icon-value">{riskStats[2]}</span>
              <span className="stat-icon-label">S</span>
            </div>
            <div className="sidebar-stat-icon watch" title={`${riskStats[1]} Rendah`}>
              <span className="stat-icon-value">{riskStats[1]}</span>
              <span className="stat-icon-label">R</span>
            </div>
          </div>

          <div className="sidebar-tab-icons">
            <button
              className={`sidebar-tab-icon-btn ${activeTab === 'alerts' ? 'active' : ''}`}
              onClick={() => setActiveTab('alerts')}
              title={`Active Alerts (${filteredAlerts.length})`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
              </svg>
              {filteredAlerts.length > 0 && <span className="tab-badge">{filteredAlerts.length}</span>}
            </button>
            <button
              className={`sidebar-tab-icon-btn ${activeTab === 'provinces' ? 'active' : ''}`}
              onClick={() => setActiveTab('provinces')}
              title={`BI Offices (${KPWBI_OFFICES.length})`}
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="10" r="3"/>
                <path d="M12 2a8 8 0 0 0-8 8c0 5.25 8 12 8 12s8-6.75 8-12a8 8 0 0 0-8-8z"/>
              </svg>
            </button>
          </div>
        </>
      ) : (
        /* ── Expanded view ────────────────────────────────────── */
        <>
          {/* Stats row — Risiko alert level office counts, each card clickable */}
          <div className="sidebar-header-row">
            <div className="sidebar-stats-container">
              <div className="sidebar-stats-title-row">
                <span className="sidebar-stats-title">Tingkat Risiko</span>
                <div 
                  className="sidebar-info-tooltip-container"
                  title="Risiko Bencana: Tingkat Keparahan x Indeks Kerentanan&#10;&#10;Scoring:&#10;• 1 - 3: Rendah&#10;• 4 - 6: Sedang&#10;• 7 - 9: Tinggi"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="info-icon">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="16" x2="12" y2="12"/>
                    <line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                </div>
              </div>
              <div className="sidebar-stats-row">
                {([3, 2, 1] as AlertSeverity[]).map((sev) => (
                  <button
                    key={sev}
                    className={`sidebar-stat-card ${severityToCssClass(sev)}${activeStatPanel === sev ? ' stat-active' : ''}`}
                    onClick={() => handleStatClick(sev)}
                    title={`Lihat KPW — Risiko Bencana ${SEV_LABEL[sev]}`}
                  >
                    <span className="sidebar-stat-value">{riskStats[sev]}</span>
                    <span className="sidebar-stat-label">{SEV_LABEL[sev]}</span>
                  </button>
                ))}
              </div>
            </div>
            <button className="sidebar-toggle-btn sidebar-toggle-collapse" onClick={onToggleCollapse} title="Collapse sidebar">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          </div>

          {/* KPW panel grouped by Risiko alert level band */}
          {activeStatPanel && (() => {
            const offices = officesByBand.get(activeStatPanel) ?? [];
            return (
              <div className={`stat-panel stat-panel-${severityToCssClass(activeStatPanel)}`}>
                <div className="stat-panel-header">
                  <span className="stat-panel-title">
                    Level Risiko Bencana
                    <span className="stat-panel-badge">{SEV_LABEL[activeStatPanel]} · {offices.length} kantor</span>
                  </span>
                  <button className="stat-panel-close" onClick={() => setActiveStatPanel(null)}>✕</button>
                </div>
                <div className="stat-panel-body">
                  {offices.length === 0 ? (
                    <p className="stat-panel-empty">Tidak ada KPW pada level risiko ini.</p>
                  ) : (
                    offices.map(({ office, topHazards }) => (
                      <button
                        key={office.id}
                        className={`stat-panel-item${selectedOfficeId === office.id ? ' selected' : ''}`}
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

          <div className="sidebar-tabs">
            <button className={`sidebar-tab-btn ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')}>
              Peringatan ({filteredAlerts.length})
            </button>
            <button className={`sidebar-tab-btn ${activeTab === 'provinces' ? 'active' : ''}`} onClick={() => setActiveTab('provinces')}>
              Kantor BI ({KPWBI_OFFICES.length})
            </button>
          </div>

          <div className="sidebar-scrollable-content">
            {isLoading ? (
              <div className="sidebar-loading-overlay">
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
                        <div className="filters-accordion-body">
                          <div className="filter-group">
                            <label className="filter-label">Tingkat</label>
                            <div className="severity-pills">
                              <button className={`severity-pill${severityFilter === 'all' ? ' active' : ''}`} onClick={() => setSeverityFilter('all')}>Semua</button>
                              {([3, 2, 1] as AlertSeverity[]).map((sev) => {
                                const sevCss = severityToCssClass(sev);
                                return (
                                  <button
                                    key={sev}
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
                            <label className="filter-label">Jenis Bencana</label>
                            <select className="filter-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DisasterType | 'all')}>
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
                            <label className="filter-label">Urutkan</label>
                            <select className="filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortKey)}>
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
                          <div className="province-group-header" onClick={() => setExpandedRegions((prev) => ({ ...prev, [region]: !prev[region] }))}>
                            <span className="province-group-title">{region}</span>
                            <span className="province-group-count">{list.length} {isExpanded ? '▲' : '▼'}</span>
                          </div>
                          {isExpanded && (
                            <div className="province-group-list">
                              {list.map((office) => {
                                const hasAlert = filteredAlerts.some((a) => a.provinceId === office.provinceId);
                                return (
                                  <button
                                    key={office.id}
                                    className={`province-item-btn ${selectedOfficeId === office.id ? 'selected' : ''} ${office.isKorwil ? 'korwil-office' : ''}`}
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
        </>
      )}
    </aside>
  );
};

export default Sidebar;

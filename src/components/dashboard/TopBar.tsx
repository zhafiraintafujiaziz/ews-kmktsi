import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { DisasterAlert, DisasterType, RiskCalcResult } from '../../types';
import { severityToCssClass } from '../../types';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { renderDisasterIcon, getDisasterTypeStatus } from '../../utils/alertUtils';
import { Public as PublicIcon } from '@mui/icons-material';
import { useAlerts } from '../../hooks/useAlerts';
import { isOfficeAffectedByAlert } from '../../utils/disasterImpact';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import {
  mapDisasterTypeToInariskHazard,
  mapInariskToVulnerability,
  vulnerabilityToScore,
  getRiskLevel,
} from '../../utils/riskCalculator';
import ScreenshotPreviewModal from '../ui/ScreenshotPreviewModal';
import './TopBar.css';

interface TopBarProps {
  criticalCount: number;
  totalAlerts: number;
  criticalAlerts: DisasterAlert[];
  allAlerts: DisasterAlert[];
  riskResults: RiskCalcResult[];
  onAlertSelect: (alertId: string) => void;
  onGenerateReport?: () => void;
  selectedType: DisasterType | 'all';
  onTypeChange: (type: DisasterType | 'all') => void;
  onSwitchToKerentanan: () => void;
  onSwitchToPerkiraan: () => void;
}

const FILTER_OPTIONS: Array<{ value: DisasterType | 'all'; label: string }> = [
  { value: 'all', label: 'Semua' },
  { value: 'earthquake', label: 'Gempa' },
  { value: 'extreme_weather', label: 'Cuaca' },
  { value: 'karhutla', label: 'Karhutla' },
  { value: 'volcanic', label: 'Gunung Api' },
  { value: 'volcanic_ash', label: 'Abu Vulkanik' },
  { value: 'air_quality', label: 'Kualitas Udara' },
];

function formatRelativeTime(timestamp: string): string {
  const diffMs = new Date().getTime() - new Date(timestamp).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffSec < 60) {
    return 'baru saja';
  } else if (diffMin < 60) {
    return `${diffMin} menit yang lalu`;
  } else if (diffHr < 24) {
    return `${diffHr} jam yang lalu`;
  } else {
    return `${diffDay} hari yang lalu`;
  }
}

function buildRiskMailtoUrl(
  office: typeof KPWBI_OFFICES[0],
  riskLevel: string,
  riskScore: number,
  alerts: DisasterAlert[]
): string {
  const DMR_EMAIL = 'satker.dmr@bi.go.id';
  const officeEmail = `kpwbi.${office.id.replace('kpwbi-', '')}@bi.go.id`;
  const to = [officeEmail, DMR_EMAIL].join(',');

  const subject = encodeURIComponent(
    `[DEWA ALERT] Peringatan Risiko ${riskLevel} — ${office.name} — Skor: ${riskScore}`
  );

  const alertDetails = alerts
    .map((a) => `  • [Level ${a.severity}] ${a.title}: ${a.description}`)
    .join('\n');

  const body = encodeURIComponent(
    `Yth. Pimpinan ${office.name} dan Satker DMR,\n\n` +
    `Sistem DEWA (Bank Indonesia Disaster Early Warning Alert) mendeteksi status risiko bencana tingkat [${riskLevel.toUpperCase()}] untuk wilayah kerja Anda dengan rincian berikut:\n\n` +
    `Kantor: ${office.name} (${office.city})\n` +
    `Skor Risiko: ${riskScore} / 9 (Tingkat Risiko: ${riskLevel})\n\n` +
    `Detail Bencana Terdeteksi:\n` +
    alertDetails + `\n\n` +
    `Langkah Tindak Lanjut:\n` +
    `1. Pantau perkembangan situasi melalui aplikasi DEWA atau instansi resmi (BMKG/PVMBG).\n` +
    `2. Lakukan koordinasi dengan Tim Kesiapsiagaan dan Satker DMR.\n` +
    `3. Lakukan langkah kontinjensi dan evakuasi mandiri jika situasi memburuk sesuai dengan SOP.\n\n` +
    `Hormat kami,\n` +
    `DEWA - Disaster Early Warning Alert\n` +
    `(Dikirim via DEWA Dashboard — ${new Date().toLocaleString('id-ID')} WIB)\n` +
    `http://ews-mktbi.vercel.app\n`
  );

  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export const TopBar: React.FC<TopBarProps> = (props) => {
  const {
    allAlerts,
    onGenerateReport,
    selectedType,
    onTypeChange,
    onSwitchToKerentanan,
    onSwitchToPerkiraan,
    onAlertSelect,
  } = props;
  
  const { isFetching, lastCheckedTime } = useAlerts();
  const [timeStr, setTimeStr] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [notiOpen, setNotiOpen] = useState(false);
  const notiRef = useRef<HTMLDivElement>(null);
  const [showToast, setShowToast] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);

  const latestAlert = useMemo(() => {
    if (!allAlerts || allAlerts.length === 0) return null;
    return [...allAlerts].sort((a, b) => {
      const sevDiff = (b.severity || 0) - (a.severity || 0);
      if (sevDiff !== 0) return sevDiff;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    })[0];
  }, [allAlerts]);


  useEffect(() => {
    const isToastDisabled = localStorage.getItem('bima_toast_disabled') === 'true';
    if (latestAlert && !isToastDisabled) {
      setShowToast(true);
    } else {
      setShowToast(false);
    }
  }, [latestAlert]);

  const handleCloseToast = () => {
    setShowToast(false);
    localStorage.setItem('bima_toast_disabled', 'true');
  };

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notiOpen) return;
    const handler = (e: MouseEvent) => {
      if (notiRef.current && !notiRef.current.contains(e.target as Node)) {
        setNotiOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [notiOpen]);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const time = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now).replace(/\./g, ':');
      const date = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' }).format(now).replace(/\./g, ':');;
      setTimeStr(`${date} - ${time} WIB`);
    };
    updateTime();
    const id = setInterval(updateTime, 1000);
    return () => clearInterval(id);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  // Build a map: officeId -> highest riskLevel from active alerts affecting the office
  const officeRiskLevels = useMemo(() => {
    const map = new Map<string, { riskLevel: string; riskScore: number; alerts: DisasterAlert[] }>();
    
    KPWBI_OFFICES.forEach((office) => {
      const officeAlerts = allAlerts.filter((a) => isOfficeAffectedByAlert(office, a));
      if (officeAlerts.length === 0) return;

      let maxRiskScore = 0;
      officeAlerts.forEach((alert) => {
        const isKerentananSupported = ['flood', 'tsunami', 'kekeringan', 'volcanic'].includes(alert.type);
        let vulScore = 1;
        if (!isKerentananSupported) {
          vulScore = 3; // Bypass kerentanan
        } else {
          const hazard = mapDisasterTypeToInariskHazard(alert.type);
          const index = BnpbInariskService.getLocalHazardIndex(office.id, hazard);
          const vulLevel = mapInariskToVulnerability(index);
          vulScore = vulnerabilityToScore(vulLevel);
        }
        const totalScore = alert.severity * vulScore;
        if (totalScore > maxRiskScore) {
          maxRiskScore = totalScore;
        }
      });

      if (maxRiskScore > 0) {
        const riskLevel = getRiskLevel(maxRiskScore);
        map.set(office.id, {
          riskLevel,
          riskScore: maxRiskScore,
          alerts: officeAlerts,
        });
      }
    });
    
    return map;
  }, [allAlerts]);

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

  const totalAffectedOffices = officeRiskLevels.size;

  const statusClass = riskStats[3] > 0
    ? 'critical'
    : riskStats[2] > 0
    ? 'warning'
    : totalAffectedOffices > 0
    ? 'monitoring'
    : 'clear';

  const statusText = riskStats[3] > 0
    ? `${riskStats[3]} KPwBI Berisiko Tinggi`
    : totalAffectedOffices > 0
    ? `${totalAffectedOffices} KPwBI Dipantau`
    : 'Sistem Normal';

  return (
    <header className="topbar-container">
      <div className="topbar-first-row">
        <div className="topbar-brand">
          <div className="topbar-logo" style={{ overflow: 'hidden', padding: 0 }}>
            <img src="/bima-logo.jpg" alt="DEWA Logo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
          <div className="topbar-brand-text">
            <h1 className="topbar-title">DEWA</h1>
            <span className="topbar-brand-sub" style={{ lineHeight: '1.3' }}>
              Bank Indonesia<br />
              Disaster Early Warning Alert
            </span>
          </div>
        </div>

        <div className="topbar-right">
          <div className="topbar-sync-status" title={lastCheckedTime ? `Terakhir sinkronisasi: ${lastCheckedTime.toLocaleTimeString('id-ID')} WIB` : 'Sinkronisasi berjalan...'}>
            <span className={`sync-dot ${isFetching ? 'syncing' : 'active'}`} />
            <span className="sync-text">{isFetching ? 'Sinkronisasi...' : 'Live'}</span>
          </div>

          <span className="topbar-clock">{timeStr || '—'}</span>

          <button className="topbar-report-btn" onClick={async () => {
            try {
              const mapElement = document.querySelector('.map-wrapper');
              if (!mapElement) return;
              const domtoimage = (await import('dom-to-image-more')).default;
              const dataUrl = await domtoimage.toPng(mapElement as HTMLElement);
              setScreenshotUrl(dataUrl);
            } catch (error) {
              console.error('Gagal mengambil screenshot', error);
            }
          }}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
              <circle cx="12" cy="13" r="4"></circle>
            </svg>
            Screenshot
          </button>

          <button className="topbar-report-btn" onClick={onGenerateReport}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" />
              <line x1="12" y1="20" x2="12" y2="4" />
              <line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Laporan
          </button>

          <div className="topbar-status-wrapper" ref={dropdownRef}>
            {totalAffectedOffices > 0 ? (
              <button
                className={`topbar-status ${statusClass} topbar-status-btn${dropdownOpen ? ' open' : ''}`}
                onClick={() => setDropdownOpen((o) => !o)}
                aria-expanded={dropdownOpen}
              >
                <span className="topbar-status-dot" />
                <span>{statusText}</span>
                <svg
                  className="topbar-status-chevron"
                  viewBox="0 0 24 24" width="12" height="12" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.18s ease' }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            ) : (
              <div className={`topbar-status ${statusClass}`}>
                <span className="topbar-status-dot" />
                <span>{statusText}</span>
              </div>
            )}

            {dropdownOpen && (
              <div className={`topbar-dropdown topbar-dropdown--${statusClass}`} role="listbox">
                <div className="topbar-dropdown-header">
                  <span className="topbar-dropdown-title">
                    Kantor BI Dipantau
                    <span className="topbar-dropdown-count">{totalAffectedOffices}</span>
                  </span>
                  <button
                    className="topbar-dropdown-close"
                    onClick={() => setDropdownOpen(false)}
                    aria-label="Tutup"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="topbar-dropdown-list">
                  {(['Tinggi', 'Sedang', 'Rendah'] as const).map((level) => {
                    const levelOffices: Array<{ office: typeof KPWBI_OFFICES[0]; detail: { riskLevel: string; riskScore: number; alerts: DisasterAlert[] } }> = [];
                    officeRiskLevels.forEach((detail, officeId) => {
                      if (detail.riskLevel === level) {
                        const office = KPWBI_OFFICES.find((o) => o.id === officeId);
                        if (office) {
                          levelOffices.push({ office, detail });
                        }
                      }
                    });

                    if (levelOffices.length === 0) return null;
                    const levelClass = { Tinggi: 'critical', Sedang: 'warning', Rendah: 'watch' }[level];
                    return (
                      <div key={level}>
                        <div className={`dropdown-risk-group-header dropdown-risk-group-header--${levelClass}`}>
                          <span className="dropdown-risk-group-dot" />
                          {level}
                          <span className="dropdown-risk-group-count">{levelOffices.length}</span>
                        </div>
                        {levelOffices.map(({ office, detail }) => {
                          const alertIcons = Array.from(new Set(detail.alerts.map((a) => a.type)));
                          const sub = detail.alerts.map((a) => a.title).join(', ');
                          return (
                            <div
                              key={office.id}
                              className="topbar-dropdown-item"
                              style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}
                            >
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1 }}>
                                <div className="dropdown-item-emoji" style={{ display: 'flex', gap: '3px', alignItems: 'center', marginTop: '2px' }}>
                                  {alertIcons.map((type) => (
                                    <React.Fragment key={type}>
                                      {renderDisasterIcon(type, undefined, { width: '16px', height: '16px' })}
                                    </React.Fragment>
                                  ))}
                                </div>
                                <div className="dropdown-item-info" style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                  <span className="dropdown-item-type" style={{ fontWeight: 600, fontSize: '12px' }}>{office.name}</span>
                                  <span className="dropdown-item-title" style={{ fontSize: '11px' }}>{office.city}</span>
                                  {sub && <span className="dropdown-item-sub" style={{ fontSize: '10px' }}>{sub}</span>}
                                </div>
                              </div>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                                <span className="dropdown-item-time" style={{ fontWeight: 'bold', color: `var(--alert-${levelClass})`, fontSize: '11px' }}>
                                  Skor: {detail.riskScore}
                                </span>
                                <a
                                  href={buildRiskMailtoUrl(office, detail.riskLevel, detail.riskScore, detail.alerts)}
                                  className="topbar-risk-notify-btn"
                                  title={`Kirim Notifikasi Email ke ${office.name}`}
                                  style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: '3px 8px',
                                    fontSize: '10px',
                                    fontWeight: '600',
                                    color: '#ffffff',
                                    backgroundColor: `var(--alert-${levelClass})`,
                                    border: 'none',
                                    borderRadius: '3px',
                                    cursor: 'pointer',
                                    textDecoration: 'none',
                                    transition: 'opacity 0.2s ease',
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.85'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '4px' }}>
                                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                    <polyline points="22,6 12,13 2,6" />
                                  </svg>
                                  Notifikasi
                                </a>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="topbar-noti-wrapper" ref={notiRef}>
            <button
              className={`topbar-noti-btn${notiOpen ? ' open' : ''}`}
              onClick={() => setNotiOpen((o) => !o)}
              title="Notifikasi Kebencanaan"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
              </svg>
              {allAlerts.length > 0 && (
                <span className="noti-badge">{allAlerts.length}</span>
              )}
            </button>

            {notiOpen && (
              <div className="topbar-dropdown noti-dropdown" role="listbox">
                <div className="topbar-dropdown-header">
                  <span className="topbar-dropdown-title">
                    Peringatan Bencana (BMKG & MAGMA)
                    <span className="topbar-dropdown-count">{allAlerts.length}</span>
                  </span>
                  <button
                    className="topbar-dropdown-close"
                    onClick={() => setNotiOpen(false)}
                    aria-label="Tutup"
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>

                <div className="topbar-dropdown-list">
                  {allAlerts.length === 0 ? (
                    <div className="noti-empty">
                      <span>🔔</span>
                      <p>Tidak ada peringatan bencana aktif saat ini.</p>
                    </div>
                  ) : (
                    [...allAlerts]
                      .sort((a, b) => {
                        const sevDiff = (b.severity || 0) - (a.severity || 0);
                        if (sevDiff !== 0) return sevDiff;
                        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                      })
                      .map((alert) => {
                        const levelClass = severityToCssClass(alert.severity);
                        const sourceName = alert.type === 'volcanic' ? 'MAGMA' : alert.type === 'volcanic_ash' ? 'INA-SIAM' : alert.type === 'karhutla' ? 'SIPONGI' : 'BMKG';
                        
                        return (
                          <div
                            key={alert.id}
                            className="topbar-dropdown-item noti-item"
                            onClick={() => {
                              onAlertSelect(alert.id);
                              setNotiOpen(false);
                            }}
                          >
                            <div className={`noti-severity-indicator noti-severity-indicator--${levelClass}`} />
                            <div className="dropdown-item-emoji">
                              {renderDisasterIcon(alert.type, undefined, { width: '18px', height: '18px' })}
                            </div>
                            <div className="dropdown-item-info">
                              <span className="dropdown-item-type">
                                {alert.title}
                                <span className={`noti-source-badge noti-source-badge--${sourceName.toLowerCase()}`}>{sourceName}</span>
                              </span>
                              <span className="dropdown-item-title">{alert.description}</span>
                              <span className="dropdown-item-sub" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>{new Date(alert.timestamp).toLocaleString('id-ID', { hour: '2-digit', minute: '2-digit' })} WIB</span>
                                <span>—</span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                  Tingkat:
                                  <span className={`alertcard-sev-badge sev-${levelClass}`}>
                                    {[1, 2, 3].map((i) => (
                                      <span key={i} className={`sev-box${i <= alert.severity ? ' filled' : ''}`} />
                                    ))}
                                  </span>
                                </span>
                              </span>
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="topbar-center">
        <div className="topbar-filter-group">
          {FILTER_OPTIONS.map((opt) => {
            const status = getDisasterTypeStatus(opt.value, allAlerts);
            return (
              <button
                key={opt.value}
                className={`topbar-filter-pill${selectedType === opt.value ? ' active' : ''}`}
                onClick={() => onTypeChange(opt.value)}
                title={`Filter: ${opt.label} • Status: ${status.label}`}
              >
                <span>
                  {opt.value === 'all' ? (
                    <PublicIcon style={{ width: '14px', height: '14px', display: 'inline-block', verticalAlign: 'middle' }} />
                  ) : (
                    renderDisasterIcon(opt.value, undefined, { width: '14px', height: '14px' })
                  )}
                </span>
                <span>{opt.label}</span>
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: status.color,
                    display: 'inline-block',
                    marginLeft: '4px',
                    boxShadow: status.color === '#ef4444' ? '0 0 6px #ef4444' : '0 0 3px rgba(0,0,0,0.3)',
                    flexShrink: 0,
                  }}
                  title={`Status ${opt.label}: ${status.label}`}
                />
              </button>
            );
          })}
        </div>
        <div className="topbar-divider-v" />
        <button className="topbar-nav-btn" onClick={onSwitchToKerentanan}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          Kerentanan
        </button>
        <button className="topbar-nav-btn" onClick={onSwitchToPerkiraan}>
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
          Perkiraan
        </button>
      </div>



      {/* Toast Notification */}
      {showToast && latestAlert && (
        <div className={`bima-toast bima-toast--${severityToCssClass(latestAlert.severity)}`}>
          <div className="bima-toast-header">
            <div className="bima-toast-title" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '8px' }}>
              {renderDisasterIcon(latestAlert.type, undefined, { width: '15px', height: '15px' })}
              <span style={{ fontWeight: 'bold' }}>Peringatan Bencana Baru</span>
              <span className="bima-toast-time" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: 'auto' }}>
                {formatRelativeTime(latestAlert.timestamp)}
              </span>
            </div>
            <button className="bima-toast-close" onClick={handleCloseToast} aria-label="Tutup">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
          <div 
            className="bima-toast-body" 
            style={{ cursor: 'pointer' }}
            onClick={() => {
              onAlertSelect(latestAlert.id);
              setShowToast(false);
            }}
          >
            <span className="bima-toast-alert-title">{latestAlert.title}</span>
            <span className="bima-toast-alert-desc">{latestAlert.description}</span>
          </div>
        </div>
      )}

      <ScreenshotPreviewModal
        isOpen={!!screenshotUrl}
        imageDataUrl={screenshotUrl}
        onClose={() => setScreenshotUrl(null)}
      />
    </header>
  );
};

export default TopBar;

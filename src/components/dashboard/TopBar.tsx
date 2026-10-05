import React, { useState, useEffect, useRef, useMemo } from 'react';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Popper from '@mui/material/Popper';
import PublicIcon from '@mui/icons-material/Public';
import type { DisasterAlert, DisasterType, RiskCalcResult } from '../../types';
import { severityToCssClass } from '../../types';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { renderDisasterIcon } from '../../utils/alertUtils';
import { useAlerts } from '../../hooks/useAlerts';
import { buildOfficeRiskMap } from '../../utils/riskCalculator';
import FullPageCaptureButton from '../ui/FullPageCaptureButton';
import { playAlertSound } from '../../utils/alertSound';

interface TopBarProps {
  criticalCount: number;
  totalAlerts: number;
  criticalAlerts: DisasterAlert[];
  allAlerts: DisasterAlert[];
  riskAlerts: DisasterAlert[];
  riskResults: RiskCalcResult[];
  onAlertSelect: (alertId: string) => void;
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

function DisasterSelectChevron(props: React.ComponentProps<'svg'>) {
  return (
    <svg
      {...props}
      viewBox="0 0 24 24" width="12" height="12" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function renderFilterIcon(type: DisasterType | 'all'): React.ReactNode {
  if (type === 'all') return <PublicIcon sx={{ fontSize: 16 }} />;
  return renderDisasterIcon(
    type,
    undefined,
    { width: '16px', height: '16px' },
    type === 'extreme_weather' ? { title: 'badai' } : undefined,
  );
}
function sortNotificationAlerts(alerts: DisasterAlert[]): DisasterAlert[] {
  return [...alerts].sort((a, b) => {
    const sevDiff = (b.severity || 0) - (a.severity || 0);
    if (sevDiff !== 0) return sevDiff;
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
}

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
    `https://ews-kmktsi.vercel.app\n`
  );

  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export const TopBar: React.FC<TopBarProps> = (props) => {
  const {
    allAlerts,
    riskAlerts,
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
  const dropdownPanelRef = useRef<HTMLDivElement>(null);
  const [notiOpen, setNotiOpen] = useState(false);
  const notiRef = useRef<HTMLDivElement>(null);
  const notiPanelRef = useRef<HTMLDivElement>(null);
  const [toastDisabled, setToastDisabled] = useState(
    () => localStorage.getItem('bima_toast_disabled') === 'true',
  );
  const [dismissedToastAlert, setDismissedToastAlert] = useState<DisasterAlert | null>(null);
  const [demoAlert, setDemoAlert] = useState<DisasterAlert | null>(null);
  const playedToastId = useRef<string | null>(null);

  const sortedNotiAlerts = useMemo(() => sortNotificationAlerts(allAlerts ?? []), [allAlerts]);

  const latestAlert = sortedNotiAlerts[0] ?? null;
  const notificationStatusClass = latestAlert?.severity === 3
    ? 'critical'
    : latestAlert?.severity === 2 ? 'warning' : 'monitoring';

  const showToast = latestAlert !== null && !toastDisabled && latestAlert !== dismissedToastAlert;

  useEffect(() => {
    if (!showToast || !latestAlert) return;
    if (playedToastId.current === latestAlert.id) return;
    playedToastId.current = latestAlert.id;
    playAlertSound();
  }, [showToast, latestAlert]);

  const handleCloseToast = () => {
    if (demoAlert) {
      setDemoAlert(null);
      return;
    }
    setToastDisabled(true);
    localStorage.setItem('bima_toast_disabled', 'true');
  };

  const handleTestAlert = () => {
    const highest = sortedNotiAlerts[0];
    if (!highest) return;
    setDemoAlert(highest);
    playAlertSound();
  };

  // Close notification dropdown on outside click
  useEffect(() => {
    if (!notiOpen) return;
    const handler = (e: MouseEvent) => {
      if (notiRef.current && !notiRef.current.contains(e.target as Node) && !notiPanelRef.current?.contains(e.target as Node)) {
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node) && !dropdownPanelRef.current?.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [dropdownOpen]);

  useEffect(() => {
    if (!dropdownOpen && !notiOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDropdownOpen(false);
        setNotiOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [dropdownOpen, notiOpen]);

  const officeRiskLevels = useMemo(
    () => buildOfficeRiskMap(KPWBI_OFFICES, riskAlerts),
    [riskAlerts],
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
    : 'Risiko Rendah';

  const toastAlert = demoAlert ?? (showToast ? latestAlert : null);
  const toastClass = demoAlert ? 'critical' : toastAlert ? severityToCssClass(toastAlert.severity) : 'watch';

  return (
    <header className="topbar-container dashboard-topbar">
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

        <div className="topbar-center">
          <div className="dashboard-disaster-select">
            <Select
              value={selectedType}
              onChange={(event) => onTypeChange(event.target.value as typeof selectedType)}
              inputProps={{ 'aria-label': 'Jenis bencana' }}
              IconComponent={DisasterSelectChevron}
              renderValue={(value) => (
                <span className="dashboard-disaster-option" title={FILTER_OPTIONS.find((option) => option.value === value)?.label}>
                  <span className="dashboard-disaster-option-icon" aria-hidden="true">{renderFilterIcon(value)}</span>
                  <span className="dashboard-disaster-option-label">{FILTER_OPTIONS.find((option) => option.value === value)?.label}</span>
                </span>
              )}
              sx={{
                width: 120,
                height: 34,
                borderRadius: 'var(--radius-sm)',
                backgroundColor: 'var(--accent-light)',
                color: 'var(--accent-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 600,
                boxShadow: 'var(--shadow-sm)',
                '& .MuiSelect-select': { padding: '0 32px 0 10px', display: 'flex', alignItems: 'center' },
                '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-default)' },
                '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent-primary)' },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent-primary)' },
                '& .MuiSelect-icon': {
                  color: 'var(--accent-primary)',
                  fontSize: 12,
                  right: 12,
                  transition: 'transform 0.18s ease',
                },
              }}
              MenuProps={{
                slotProps: {
                  paper: {
                    sx: {
                      marginTop: '4px',
                      border: '1px solid var(--border-default)',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--bg-surface)',
                      boxShadow: 'var(--shadow-lg)',
                    },
                  },
                },
              }}
            >
              {FILTER_OPTIONS.map((option) => (
                <MenuItem
                  key={option.value}
                  value={option.value}
                  sx={{
                    gap: 1,
                    minHeight: 38,
                    fontFamily: 'var(--font-sans)',
                    fontSize: 13,
                    color: 'var(--text-primary)',
                    '&.Mui-selected, &.Mui-selected:hover': { backgroundColor: 'var(--accent-light)', color: 'var(--accent-primary)' },
                  }}
                >
                  <span className="dashboard-disaster-option-icon" aria-hidden="true">{renderFilterIcon(option.value)}</span>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
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

        <div className="topbar-right">
          <div className="topbar-sync-status" title={lastCheckedTime ? `Terakhir sinkronisasi: ${lastCheckedTime.toLocaleTimeString('id-ID')} WIB` : 'Sinkronisasi berjalan...'}>
            <span className={`sync-dot ${isFetching ? 'syncing' : 'active'}`} />
            <span className="sync-text">{isFetching ? 'Sinkronisasi...' : 'Live'}</span>
          </div>

          <span className="topbar-clock">{timeStr || '—'}</span>

          <FullPageCaptureButton filename="Dashboard_EWS" />

          <button className="topbar-report-btn" type="button" onClick={handleTestAlert} aria-label="Uji notifikasi" title="Uji notifikasi">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
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
              <Popper
                open
                anchorEl={dropdownRef.current}
                ref={dropdownPanelRef}
                placement="bottom-end"
                className="topbar-menu-popper"
                modifiers={[{ name: 'offset', options: { offset: [0, 8] } }, { name: 'preventOverflow', options: { padding: 8 } }]}
              >
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
                              className={`topbar-dropdown-item dropdown-risk-item--${levelClass}`}
                              style={{ cursor: 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}
                            >
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', flex: 1 }}>
                                <div className="dropdown-item-emoji" style={{ display: 'flex', gap: '3px', alignItems: 'center', marginTop: '2px' }}>
                                  {alertIcons.map((type) => {
                                    const match = detail.alerts.find((a) => a.type === type);
                                    return (
                                      <React.Fragment key={type}>
                                        {renderDisasterIcon(type, undefined, { width: '16px', height: '16px' }, match)}
                                      </React.Fragment>
                                    );
                                  })}
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
                                  Kirim
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
              </Popper>
            )}
          </div>

          <div className="topbar-noti-wrapper" ref={notiRef}>
            <button
              className={`topbar-noti-btn${notiOpen ? ' open' : ''}`}
              onClick={() => setNotiOpen((o) => !o)}
              title="Notifikasi Kebencanaan"
              aria-label="Notifikasi Kebencanaan"
              aria-expanded={notiOpen}
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
              <Popper
                open
                anchorEl={notiRef.current}
                ref={notiPanelRef}
                placement="bottom-end"
                className="topbar-menu-popper"
                modifiers={[{ name: 'offset', options: { offset: [0, 8] } }, { name: 'preventOverflow', options: { padding: 8 } }]}
              >
              <div className={`topbar-dropdown noti-dropdown topbar-dropdown--${notificationStatusClass}`} role="listbox">
                <div className="topbar-dropdown-header">
                  <span className="topbar-dropdown-title">
                    Peringatan Bencana
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
                    ([3, 2, 1] as const).map((severity) => {
                      const alerts = sortedNotiAlerts.filter((alert) => alert.severity === severity);
                      if (alerts.length === 0) return null;
                      const groupClass = severityToCssClass(severity);
                      const groupLabel = { 3: 'Tinggi', 2: 'Sedang', 1: 'Rendah' }[severity];
                      return (
                        <div key={severity}>
                          <div className={`dropdown-risk-group-header dropdown-risk-group-header--${groupClass}`}>
                            <span className="dropdown-risk-group-dot" />
                            {groupLabel}
                            <span className="dropdown-risk-group-count">{alerts.length}</span>
                          </div>
                          {alerts.map((alert) => {
                        const levelClass = severityToCssClass(alert.severity);
                        const sourceName = alert.type === 'volcanic' ? 'MAGMA' : alert.type === 'volcanic_ash' ? 'INA-SIAM' : alert.type === 'karhutla' ? 'SIPONGI' : 'BMKG';
                        
                        return (
                          <div
                            key={alert.id}
                            className={`topbar-dropdown-item noti-item dropdown-risk-item--${levelClass}`}
                            onClick={() => {
                              onAlertSelect(alert.id);
                              setNotiOpen(false);
                            }}
                          >
                            <div className="dropdown-item-emoji">
                              {renderDisasterIcon(alert.type, undefined, { width: '16px', height: '16px' }, alert)}
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
                          })}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
              </Popper>
            )}
          </div>
        </div>
      </div>

      {/* Toast Notification */}
      {toastAlert && (
        <div className={`bima-toast bima-toast--${toastClass}`}>
          <div className="bima-toast-header">
            <div className="bima-toast-title" style={{ display: 'flex', alignItems: 'center', width: '100%', gap: '8px' }}>
              {renderDisasterIcon(toastAlert.type, undefined, { width: '15px', height: '15px' }, toastAlert)}
              <span style={{ fontWeight: 'bold' }}>Peringatan Bencana Baru</span>
              {demoAlert && (
                <span className="alertcard-sev-badge sev-critical" aria-label="Risiko tertinggi">
                  {[1, 2, 3].map((i) => (
                    <span key={i} className="sev-box filled" />
                  ))}
                </span>
              )}
              <span className="bima-toast-time" style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 'normal', marginLeft: 'auto' }}>
                {formatRelativeTime(toastAlert.timestamp)}
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
              onAlertSelect(toastAlert.id);
              if (demoAlert) setDemoAlert(null);
              else setDismissedToastAlert(latestAlert);
            }}
          >
            <span className="bima-toast-alert-title">{toastAlert.title}</span>
            <span className="bima-toast-alert-desc">{toastAlert.description}</span>
          </div>
        </div>
      )}

    </header>
  );
};

export default TopBar;

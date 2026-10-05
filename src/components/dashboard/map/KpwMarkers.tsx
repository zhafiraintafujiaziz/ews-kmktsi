import React, { useMemo } from 'react';
import { Marker, Tooltip, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import type { DisasterAlert, DisasterType, KpwbiOffice, AlertSeverity, RiskCalcResult } from '../../../types';
import { severityToCssClass } from '../../../types';
import { KPWBI_OFFICES } from '../../../constants/kpwbiOffices';
import { PROVINCES } from '../../../constants/provinces';
import { isOfficeAffectedByAlert } from '../../../utils/disasterImpact';
import { BnpbInariskService } from '../../../services/bnpbInariskService';
import { IspuService } from '../../../services/ispuService';
import { classifyExtremeWeather, renderDisasterIcon } from '../../../utils/alertUtils';
import type { NearestKpwResult } from '../../../utils/geo';
import {
  buildOfficeRiskMap,
  scoreAlertForOffice,
  getRiskLevel,
} from '../../../utils/riskCalculator';


interface KpwMarkersProps {
  alerts: DisasterAlert[];
  riskAlerts?: DisasterAlert[];
  riskResults: RiskCalcResult[];
  activeTypeFilter: DisasterType | 'all';
  isKerentananView?: boolean;
  selectedProvinceId: string | null;
  selectedOfficeId: string | null;
  nearestOffices: NearestKpwResult[];
  onProvinceSelect: (id: string) => void;
  onOfficeSelect?: (officeId: string) => void;
  markerRefs: React.MutableRefObject<Record<string, L.Marker | null>>;
  mapLayers: {
    kp: boolean;
    korwil: boolean;
    normal: boolean;
    nearest: boolean;
    critical: boolean;
    warning: boolean;
    watch: boolean;
    earthquake?: boolean;
    extreme_weather?: boolean;
    karhutla?: boolean;
    volcanic?: boolean;
  };
  selectedAlertId?: string | null;
}

const KPW_PANE = 'kpwMarkers';

const TYPE_LABEL: Record<string, string> = {
  earthquake: 'Gempa',
  extreme_weather: 'Cuaca',
  karhutla: 'Karhutla',
  volcanic: 'Gunung Api',
  volcanic_ash: 'Abu Vulkanik',
  air_quality: 'Kualitas Udara',
  flood: 'Banjir',
  tsunami: 'Tsunami',
  landslide: 'Longsor',
  kekeringan: 'Kekeringan',
};

const WEATHER_DETAIL: Record<string, string> = {
  hujan: 'Hujan',
  hujan_lebat: 'Hujan lebat',
  hujan_petir: 'Petir',
  badai: 'Badai',
  angin: 'Angin',
};

function getProvinceName(provinceId: string): string {
  return PROVINCES.find((p) => p.id === provinceId)?.name ?? provinceId;
}

function useKpwPane() {
  const map = useMap();
  if (!map.getPane(KPW_PANE)) {
    const pane = map.createPane(KPW_PANE);
    pane.style.zIndex = '620';
  }
}

function alertDetail(alert: DisasterAlert): string | null {
  if (alert.type === 'earthquake' && alert.magnitude != null) {
    return `M ${alert.magnitude}`;
  }
  if (alert.type === 'extreme_weather') {
    return WEATHER_DETAIL[classifyExtremeWeather(alert)] ?? null;
  }
  return null;
}

function summarizeOfficeAlerts(alerts: DisasterAlert[]) {
  const groups = new Map<string, DisasterAlert[]>();
  for (const alert of alerts) {
    const list = groups.get(alert.type) ?? [];
    list.push(alert);
    groups.set(alert.type, list);
  }
  return [...groups.entries()]
    .map(([type, list]) => {
      const top = [...list].sort((a, b) => b.severity - a.severity)[0];
      return { type, count: list.length, alert: top, detail: alertDetail(top) };
    })
    .sort((a, b) => b.alert.severity - a.alert.severity || b.count - a.count);
}

function createMarkerIcon(
  office: KpwbiOffice,
  riskSeverity: AlertSeverity | null,
  selectedOfficeId: string | null,
  nearestOffices: NearestKpwResult[],
  ispuColor?: string
): L.DivIcon {
  const classes: string[] = [];
  if (riskSeverity) classes.push('has-alert', `alert-${severityToCssClass(riskSeverity)}`);
  if (selectedOfficeId === office.id) {
    classes.push('selected');
  } else if (nearestOffices.some((n) => n.office.id === office.id)) {
    classes.push('nearest');
  }
  const classString = classes.join(' ');
  const ispuSvgStyle = ispuColor ? `style="color:${ispuColor}"` : '';
  const ispuDotStyle = ispuColor ? `style="background-color:${ispuColor}"` : '';

  if (office.isKantorPusat) {
    return L.divIcon({
      className: 'custom-marker kp-marker-container',
      html: `<svg ${ispuSvgStyle} class="kp-building ${classString}" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M12,2L1,7v2h22V7L12,2z M4,9v11h3V9H4z M10,9v11h4V9h-4z M17,9v11h3V9h-3z M2,20v2h20v-2H2z"/></svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  if (office.isKorwil) {
    return L.divIcon({
      className: 'custom-marker korwil-marker-container',
      html: `<svg ${ispuSvgStyle} class="korwil-star ${classString}" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" stroke="white" stroke-width="2" d="M12,17.27L18.18,21L16.54,13.97L22,9.24L14.81,8.62L12,2L9.19,8.62L2,9.24L7.45,13.97L5.82,21L12,17.27Z"/></svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  if (office.category === 'dc') {
    return L.divIcon({
      className: 'custom-marker bi-dc-container',
      html: `<svg ${ispuSvgStyle} class="bi-dc-building ${classString}" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" stroke="white" stroke-width="1.2" d="M12,2L1,7v2h22V7L12,2z M4,9v11h3V9H4z M10,9v11h4V9h-4z M17,9v11h3V9h-3z M2,20v2h20v-2H2z"/></svg>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
  }

  return L.divIcon({
    className: 'custom-marker',
    html: `<div ${ispuDotStyle} class="${['marker-dot', ...classes].join(' ')}"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

const KpwMarkers: React.FC<KpwMarkersProps> = ({
  alerts,
  riskAlerts,
  activeTypeFilter,
  isKerentananView = false,
  selectedProvinceId,
  selectedOfficeId,
  nearestOffices,
  onProvinceSelect,
  onOfficeSelect,
  markerRefs,
  mapLayers,
  selectedAlertId,
}) => {
  useKpwPane();
  const isInariskFilter = ['flood', 'tsunami', 'kekeringan', 'volcanic'].includes(activeTypeFilter)
    || (isKerentananView && activeTypeFilter === 'air_quality');
  const officeRiskMap = useMemo(
    () => buildOfficeRiskMap(KPWBI_OFFICES, riskAlerts ?? alerts),
    [riskAlerts, alerts],
  );

  return (
    <>
      {KPWBI_OFFICES.filter((office) => {
        if (selectedAlertId) {
          // 1. Tampilkan jika kantor terdampak oleh alert terpilih
          const selectedAlert = alerts.find(a => a.id === selectedAlertId);
          if (selectedAlert && isOfficeAffectedByAlert(office, selectedAlert)) {
            return true;
          }
          // 2. Atau jika kantor tersebut adalah kantor provinsi terpilih (biru)
          if (selectedProvinceId && office.provinceId === selectedProvinceId) {
            return true;
          }
          // 3. Atau jika kantor tersebut adalah kantor terdekat (ungu)
          if (nearestOffices.some((n) => n.office.id === office.id)) {
            return true;
          }
          return false;
        }

        const activeAlerts = alerts.filter((a) => isOfficeAffectedByAlert(office, a));
        if (activeAlerts.length > 0) return true;

        const isNearest = nearestOffices.some((n) => n.office.id === office.id);
        if (isNearest && mapLayers.nearest) return true;

        if (office.isKantorPusat) return mapLayers.kp;
        if (office.isKorwil) return mapLayers.korwil;
        return mapLayers.normal;
      }).map((office) => {
        const nearestInfo = nearestOffices.find((n) => n.office.id === office.id);
        const officeAlerts = alerts.filter((a) => isOfficeAffectedByAlert(office, a));
        const officeRisk = officeRiskMap.get(office.id);
        const ispuAssessment = isKerentananView && activeTypeFilter === 'air_quality' ? IspuService.getOfficeIspuAssessment(office.id) : null;
        const riskSeverity: AlertSeverity | null = officeRisk
          ? (officeRisk.riskLevel === 'Tinggi' ? 3 : officeRisk.riskLevel === 'Sedang' ? 2 : 1)
          : null;

        return (
          <Marker
            key={office.id}
            position={[office.latitude, office.longitude]}
            pane={KPW_PANE}
            icon={createMarkerIcon(office, riskSeverity, selectedOfficeId, nearestOffices, ispuAssessment ? IspuService.getCategoryColor(ispuAssessment.category) : undefined)}
            zIndexOffset={office.isKantorPusat ? 1000 : office.isKorwil ? 500 : 0}
            ref={(ref) => { markerRefs.current[office.id] = ref; }}
            eventHandlers={{
              click: () => {
                if (onOfficeSelect) onOfficeSelect(office.id);
                else onProvinceSelect(office.provinceId);
              },
            }}
          >
            <Tooltip direction="top" offset={[0, -10]} opacity={0.9} permanent={false}>
              <div>
                <strong>{office.city}</strong> — {office.name}
                {office.isKantorPusat && ' 🏛️ (Kantor Pusat)'}
                {office.isKorwil && !office.isKantorPusat && ' ★ Korwil'}
                {office.category === 'dc' && ' 🏛️ (Data Center Sinergi)'}
                {nearestInfo && (
                  <div style={{ marginTop: '4px', fontSize: '11px', color: '#8b5cf6', fontWeight: 600 }}>
                    ↔️ Terdekat ({nearestInfo.distanceKm.toFixed(1)} km)
                  </div>
                )}
                {officeAlerts.length > 0 && (() => {
                  const summary = summarizeOfficeAlerts(officeAlerts);
                  const shown = summary.slice(0, 3);
                  const extra = summary.length - shown.length;
                  return (
                    <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      {shown.map((row) => (
                        <div key={row.type} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', fontWeight: 600, color: 'var(--text-primary)' }}>
                          <span style={{ display: 'inline-flex' }}>
                            {renderDisasterIcon(row.type, undefined, { width: '12px', height: '12px' }, row.alert)}
                          </span>
                          <span>
                            {TYPE_LABEL[row.type] ?? row.type}
                            {row.detail ? ` · ${row.detail}` : ''}
                            {row.count > 1 ? ` ×${row.count}` : ''}
                          </span>
                        </div>
                      ))}
                      {extra > 0 && (
                        <div style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>+{extra}</div>
                      )}
                    </div>
                  );
                })()}
                {isInariskFilter && (() => {
                  const hazard = activeTypeFilter as 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash' | 'air_quality';
                  if (hazard === 'air_quality') {
                    const asmt = IspuService.getOfficeIspuAssessment(office.id);
                    if (!asmt) return <div style={{ marginTop: '4px', fontSize: '11px' }}>Current data unavailable</div>;
                    const color = IspuService.getCategoryColor(asmt.category);
                    return (
                      <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 700, color }}>
                        ISPU: {asmt.ispuValue} ({asmt.category})
                      </div>
                    );
                  }
                  const indexVal = BnpbInariskService.getLocalHazardIndex(office.id, hazard);
                  if (indexVal === null) return <div style={{ marginTop: '4px', fontSize: '11px' }}>Current data unavailable</div>;
                  const hazardTitle = { flood: 'Banjir', tsunami: 'Tsunami', kekeringan: 'Kekeringan', volcanic: 'Gunung Api', volcanic_ash: 'Abu Vulkanik' }[hazard] || hazard;
                  const val = Math.round(indexVal * 100);
                  const color = val >= 64 ? 'var(--alert-critical)' : val > 40 ? 'var(--alert-warning)' : 'var(--alert-watch)';
                  return (
                    <div style={{ marginTop: '4px', fontSize: '11px', fontWeight: 700, color }}>
                      {hazardTitle} Indeks: {indexVal.toFixed(2)}
                    </div>
                  );
                })()}
              </div>
            </Tooltip>

            <Popup offset={[0, -10]} minWidth={280}>
              {isInariskFilter ? (
                (() => {
                  const hazard = activeTypeFilter as 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash' | 'air_quality';
                  if (hazard === 'air_quality') {
                    const asmt = IspuService.getOfficeIspuAssessment(office.id);
                    if (!asmt) {
                      return <div className="ews-popup-content"><div className="ews-popup-title">{office.name} ({office.city})</div><p>Current data unavailable</p></div>;
                    }
                    const badge = IspuService.getCategoryBadge(asmt.category, asmt.ispuValue);
                    return (
                      <div className="ews-popup-content">
                        <div className="ews-popup-header" style={{ color: badge.color, backgroundColor: badge.bg }}>
                          <span>{renderDisasterIcon('air_quality', undefined, { color: 'inherit' })}</span>
                          <span>Kualitas Udara (ISPU KemenLH)</span>
                        </div>
                        <div className="ews-popup-title" style={{ marginTop: 0 }}>{office.name} ({office.city})</div>
                        <p className="ews-popup-desc">
                          Stasiun SPKU: <strong>{asmt.stationName}</strong> ({asmt.distanceKm} km). Parameter Kritis: <strong>{asmt.dominantParam}</strong>. Kategori: <strong style={{ color: IspuService.getCategoryColor(asmt.category) }}>{asmt.category}</strong>.
                        </p>
                        <div className="ews-popup-footer">
                          <span className="ews-popup-tag" style={{
                            color: badge.color,
                            backgroundColor: badge.bg,
                            borderColor: badge.bg,
                          }}>
                            ISPU {asmt.ispuValue} • {asmt.category}
                          </span>
                        </div>
                      </div>
                    );
                  }
                  const indexVal = BnpbInariskService.getLocalHazardIndex(office.id, hazard);
                  if (indexVal === null) {
                    return <div className="ews-popup-content"><div className="ews-popup-title">{office.name} ({office.city})</div><p>Current data unavailable</p></div>;
                  }
                  const hazardTitle = { flood: 'Banjir', tsunami: 'Tsunami', kekeringan: 'Kekeringan', volcanic: 'Gunung Api', volcanic_ash: 'Abu Vulkanik' }[hazard] || hazard;
                  const val = Math.round(indexVal * 100);
                  let severity: AlertSeverity = 1;
                  if (val >= 64) severity = 3;
                  else if (val > 40) severity = 2;
                  return (
                    <div className="ews-popup-content">
                      <div className={`ews-popup-header ${severityToCssClass(severity)}`}>
                        <span>{renderDisasterIcon(hazard, undefined, { color: 'inherit' })}</span>
                        <span>Indeks Bahaya {hazardTitle} (InaRisk)</span>
                      </div>
                      <div className="ews-popup-title" style={{ marginTop: 0 }}>{office.name} ({office.city})</div>
                      <p className="ews-popup-desc">
                        Berdasarkan data InaRisk BNPB, lokasi sekitar {office.name} memiliki tingkat kerentanan/bahaya {hazardTitle} dengan indeks {indexVal.toFixed(2)} dari 1.0.
                      </p>
                      <div className="ews-popup-footer">
                        <span className="ews-popup-tag" style={{
                          color: `var(--alert-${severityToCssClass(severity)})`,
                          backgroundColor: `var(--alert-${severityToCssClass(severity)}-bg)`,
                          borderColor: `var(--alert-${severityToCssClass(severity)}-border)`,
                        }}>
                          Level {severity} ({indexVal.toFixed(2)})
                        </span>
                      </div>
                    </div>
                  );
                })()
              ) : (
                  <div className="ews-popup-content" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div className="ews-popup-header" style={{ color: 'var(--accent-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', paddingBottom: '4px', marginBottom: '2px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>📍</span>
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                          {office.category === 'dc' ? 'DATA CENTER' : office.category === 'drc' ? 'DRC' : 'KPwBI OFFICE'}
                        </span>
                      </div>
                      {riskSeverity && (
                        <span className="ews-popup-tag" style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          fontWeight: 600,
                          borderRadius: 'var(--radius-sm)',
                          color: `var(--alert-${severityToCssClass(riskSeverity)})`,
                          backgroundColor: `var(--alert-${severityToCssClass(riskSeverity)}-bg)`,
                          borderColor: `var(--alert-${severityToCssClass(riskSeverity)}-border)`,
                        }}>
                          Risiko: {riskSeverity === 3 ? 'Tinggi' : riskSeverity === 2 ? 'Sedang' : 'Rendah'}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                      <div className="ews-popup-title" style={{ marginTop: 0, fontSize: '12.5px', fontWeight: 700 }}>{office.name}</div>
                      <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                        {office.city}, {getProvinceName(office.provinceId)} ({office.region})
                      </div>
                    </div>

                    {officeAlerts.length > 0 && (
                      <div style={{ marginTop: '4px', paddingTop: '6px', borderTop: '1px dashed var(--border-default)', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-primary)' }}>
                          ⚠️ Bencana Terdampak ({officeAlerts.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto', paddingRight: '2px' }}>
                          {officeAlerts.map((alert) => scoreAlertForOffice(office.id, alert))
                          .filter((risk): risk is typeof risk & { totalScore: number } => risk.totalScore !== null)
                          .sort((a, b) => b.totalScore - a.totalScore)
                          .map(({ alert, totalScore, vulScore, isKerentananSupported }) => {
                            const indexValStr = isKerentananSupported ? `${vulScore}/3` : 'N/A';
                            const disasterScore = alert.severity;
                            const riskLevel = getRiskLevel(totalScore);

                            return (
                              <div 
                                key={alert.id} 
                                style={{ 
                                  padding: '5px 8px', 
                                  borderRadius: 'var(--radius-sm)', 
                                  backgroundColor: 'var(--bg-sidebar)', 
                                  border: '1px solid var(--border-default)',
                                  fontSize: '11px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '2px'
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600, color: 'var(--text-primary)' }}>
                                    <span style={{ display: 'inline-flex' }}>{renderDisasterIcon(alert.type, undefined, { color: 'inherit', width: '12px', height: '12px' }, alert)}</span>
                                    <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: '160px' }} title={alert.title}>{alert.title}</span>
                                  </div>
                                  <span style={{ 
                                    fontSize: '10px', 
                                    fontWeight: 700, 
                                    color: totalScore >= 7 ? 'var(--alert-critical)' : totalScore >= 4 ? 'var(--alert-warning)' : 'var(--alert-watch)'
                                  }}>
                                    Skor {totalScore}/9
                                  </span>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: 'var(--text-muted)' }}>
                                  <span>{alert.type === 'air_quality' ? `Keparahan: ${disasterScore}/3` : `Alert: ${disasterScore}/3 • Kerentanan: ${indexValStr}`}</span>
                                  <span style={{ 
                                    fontWeight: 600, 
                                    color: totalScore >= 7 ? 'var(--alert-critical)' : totalScore >= 4 ? 'var(--alert-warning)' : 'var(--alert-watch)' 
                                  }}>
                                    {riskLevel}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
              )}
            </Popup>
          </Marker>
        );
      })}
    </>
  );
};

export default KpwMarkers;

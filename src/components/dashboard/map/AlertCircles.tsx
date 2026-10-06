import React from 'react';
import { Circle, Tooltip, Marker, Popup, Polygon, Polyline } from 'react-leaflet';
import L from 'leaflet';
import type { DisasterAlert, AlertSeverity } from '../../../types';
import { severityToCssClass } from '../../../types';
import { PROVINCES } from '../../../constants/provinces';
import { isValidCoord } from '../../../utils/geo';
import { getDisasterIconHtml, renderDisasterIcon } from '../../../utils/alertUtils';
import { computeTrajectoryArrow, InaSiamService } from '../../../services/inaSiamService';
import { polygonLatLngs } from '../../../utils/polygonExposure';
import { getIspuStyle } from '../../../constants/ispuCategories';

interface AlertCirclesProps {
  alerts: DisasterAlert[];
  onAlertSelect?: (alertId: string) => void;
  provinceCentroids?: Map<string, [number, number]>;
}

interface CircleConfig {
  radius: number;
  pathOptions: {
    color: string;
    fillColor: string;
    fillOpacity: number;
    weight: number;
    dashArray?: string;
    bubblingMouseEvents?: boolean;
  };
}

const SEV_COLORS: Record<AlertSeverity, string> = {
  3: 'var(--alert-critical)',
  2: 'var(--alert-warning)',
  1: 'var(--alert-watch)',
};

function getCircleRadius(alert: DisasterAlert): number {
  switch (alert.type) {
    case 'earthquake':
      return (alert.magnitude || 5) * 35000;
    case 'tsunami':
      return 150000;
    case 'flood':
      return (alert.waterLevel || 1.5) * 40000;
    case 'landslide':
      return 50000;
    case 'extreme_weather':
      return 60000;
    case 'karhutla':
      return 10000;
    case 'kekeringan':
      return 100000;
    case 'air_quality':
      return 25000;
    default:
      return 60000;
  }
}

function getCircleConfig(alert: DisasterAlert): CircleConfig {
  let color = SEV_COLORS[alert.severity] || 'var(--alert-critical)';
  if (alert.type === 'air_quality') {
    color = getIspuStyle(alert.ispuCategory || 'BAIK', alert.ispuValue).color;
  }
  const radius = getCircleRadius(alert);

  return {
    radius,
    pathOptions: {
      color,
      fillColor: color,
      fillOpacity: alert.type === 'air_quality' ? 0.22 : 0.12,
      weight: 1.5,
      dashArray: '4, 4',
      bubblingMouseEvents: false,
    },
  };
}

function getDestinationCoords(centerLat: number, centerLng: number, radiusMeters: number, bearingDegrees = 135): [number, number] {
  const earthRadius = 6378137;
  const d = radiusMeters;
  const bearingRad = (bearingDegrees * Math.PI) / 180;

  const latRad = (centerLat * Math.PI) / 180;
  const lngRad = (centerLng * Math.PI) / 180;

  const destLatRad = Math.asin(
    Math.sin(latRad) * Math.cos(d / earthRadius) +
      Math.cos(latRad) * Math.sin(d / earthRadius) * Math.cos(bearingRad)
  );

  const destLngRad =
    lngRad +
    Math.atan2(
      Math.sin(bearingRad) * Math.sin(d / earthRadius) * Math.cos(latRad),
      Math.cos(d / earthRadius) - Math.sin(latRad) * Math.sin(destLatRad)
    );

  const destLat = (destLatRad * 180) / Math.PI;
  const destLng = (destLngRad * 180) / Math.PI;

  return [destLat, destLng];
}

function sevTagStyle(severity: AlertSeverity) {
  const css = severityToCssClass(severity);
  return {
    borderColor: `var(--alert-${css}-border)`,
    backgroundColor: `var(--alert-${css}-bg)`,
  };
}

function getVolcanoDeduplicationKey(alert: DisasterAlert): string | null {
  const isVolcano = alert.type === 'volcanic' || alert.type === 'volcanic_ash';
  if (!isVolcano) return null;

  const t = (alert.title + ' ' + (alert.affectedArea || '')).toLowerCase();
  if (t.includes('krakatau')) return 'krakatau';
  if (t.includes('lewotobi') || t.includes('lewotolok')) return 'lewotobi';
  if (t.includes('semeru')) return 'semeru';
  if (t.includes('ibu')) return 'ibu';
  if (t.includes('dukono')) return 'dukono';
  if (t.includes('merapi')) return 'merapi';
  if (t.includes('marapi')) return 'marapi';
  if (t.includes('sinabung')) return 'sinabung';

  if (alert.latitude && alert.longitude) {
    return `${Math.round(alert.latitude * 10)}_${Math.round(alert.longitude * 10)}`;
  }
  return alert.id;
}

const AlertCircles: React.FC<AlertCirclesProps> = ({ alerts, onAlertSelect, provinceCentroids }) => {
  // Deduplicate volcano alerts so that for each volcano, only ONE canonical SIGMET polygon is rendered
  const processedAlerts = React.useMemo(() => {
    const volcanoSeen = new Set<string>();
    const result: DisasterAlert[] = [];

    // Prioritize volcanic_ash (INA-SIAM) first because it has the authentic SIGMET geometry and flight corridors
    const sorted = [...alerts].sort((a, b) => {
      if (a.type === 'volcanic_ash' && b.type !== 'volcanic_ash') return -1;
      if (b.type === 'volcanic_ash' && a.type !== 'volcanic_ash') return 1;
      return 0;
    });

    for (const alert of sorted) {
      const vKey = getVolcanoDeduplicationKey(alert);
      if (vKey) {
        if (alert.type !== 'volcanic_ash' && volcanoSeen.has(vKey)) {
          // Already rendered polygon & marker for this volcano, skip duplicate to prevent double polygons
          continue;
        }
        volcanoSeen.add(vKey);
      }
      result.push(alert);
    }

    return result;
  }, [alerts]);

  return (
    <>
      {processedAlerts.map((alert) => {
        let center: [number, number] | null = null;

        if (isValidCoord(alert.latitude, alert.longitude)) {
          center = [Number(alert.latitude), Number(alert.longitude)];
        }

        if (!center) return null;

        const isVolcano = alert.type === 'volcanic' || alert.type === 'volcanic_ash';

        // Cari poligon SIGMET dinamis real-time dari INA-SIAM jika belum ada
        let polygonCoords = alert.pentagonCoords;
        let windBearing = alert.windBearing;
        let sigmetInfo = null;

        if (isVolcano) {
          sigmetInfo = InaSiamService.getSigmetForVolcano(alert.title || alert.affectedArea || '');
          if (!polygonCoords && sigmetInfo && sigmetInfo.coordinates.length >= 3) {
            polygonCoords = sigmetInfo.coordinates;
            windBearing = sigmetInfo.bearing;
          }
        }

        const sourcePolygons = polygonLatLngs(alert.sourceGeometry);
        const hasPolygon = isVolcano && (sourcePolygons || (polygonCoords && polygonCoords.length >= 3));
        const arrowData = isVolcano && center && windBearing !== undefined
          ? computeTrajectoryArrow(center[0], center[1], windBearing, 65)
          : null;

        const { radius, pathOptions } = getCircleConfig(alert);
        const iconCoords = getDestinationCoords(center[0], center[1], radius);
        
        // Icon type: jika memiliki sebaran abu vulkanik aktif / SIGMET, tampilkan gunung berawan
        const iconType = (alert.type === 'volcanic_ash' || (alert.type === 'volcanic' && sigmetInfo))
          ? 'volcanic_ash'
          : alert.type;
        // Cuaca Buruk markers always use the Map Legend icon (badai / lightning).
        const iconSource = alert.type === 'extreme_weather'
          ? { title: 'badai' }
          : { id: alert.id, title: alert.title, description: alert.description };
        const iconHtml = getDisasterIconHtml(iconType, isVolcano ? '#ea580c' : pathOptions.color, iconSource);
        const ispuStyle = alert.type === 'air_quality'
          ? getIspuStyle(alert.ispuCategory || 'BAIK', alert.ispuValue) : undefined;
        const sevColor = ispuStyle?.color ?? SEV_COLORS[alert.severity] ?? 'var(--alert-critical)';

        const customIcon = L.divIcon({
          className: 'custom-disaster-radius-icon',
          html: `<div style="
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            background-color: transparent;
            border: none;
            cursor: pointer;
            pointer-events: auto;
          ">${iconHtml}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        });

        const renderSevBoxes = () => (
          <span className="ews-popup-tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', padding: '2px 4px', ...sevTagStyle(alert.severity), ...(ispuStyle ? { borderColor: ispuStyle.color, backgroundColor: `${ispuStyle.color}18` } : {}) }}>
            {[1, 2, 3].map((i) => (
              <span key={i} style={{ width: '12px', height: '4px', borderRadius: '1px', backgroundColor: i <= alert.severity ? sevColor : 'var(--border-default)', display: 'inline-block' }} />
            ))}
          </span>
        );

        const isProvinceAlert = alert.type === 'extreme_weather';
        const isWeatherAlert = alert.type === 'extreme_weather';

        const effectiveAshHeight = alert.ashHeight || sigmetInfo?.flightLevel;
        const effectiveDirection = alert.movementDirection || sigmetInfo?.directionText;

        const popupContent = (
          <div className="ews-popup-content" style={{ maxWidth: '330px' }}>
            <div className={`ews-popup-header ${severityToCssClass(alert.severity)}`} style={ispuStyle ? { color: ispuStyle.textColor, backgroundColor: ispuStyle.color } : undefined}>
              <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                {renderDisasterIcon(iconType, undefined, { color: 'inherit' }, iconSource)}
              </span>
              <span>{alert.title}</span>
            </div>

            <div className="ews-popup-title" style={{ marginTop: '4px', fontWeight: 600 }}>
              {alert.affectedArea || 'Area Terdampak'}
            </div>

            {alert.type === 'air_quality' && (
              <div style={{ margin: '6px 0', padding: '6px 8px', background: `${sevColor}18`, border: `1px solid ${sevColor}`, borderRadius: '4px' }}>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span>🍃</span>
                  <span>PEMANTAUAN KUALITAS UDARA (ISPU KEMENLH)</span>
                </div>
                <div style={{ marginTop: '4px', fontSize: '11px', color: '#334155', lineHeight: 1.4 }}>
                  <div><strong>Nilai ISPU:</strong> {alert.ispuValue} ({alert.ispuCategory})</div>
                  <div><strong>Polutan Dominan:</strong> {alert.ispuParam}</div>
                  <div><strong>Stasiun SPKU:</strong> {alert.stationName}</div>
                </div>
              </div>
            )}

            {isVolcano && (
              <div style={{ fontSize: '11px', margin: '4px 0', background: 'rgba(234, 88, 12, 0.08)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(234, 88, 12, 0.25)' }}>
                <div style={{ color: '#c2410c', fontWeight: 700, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>📡</span>
                  <span>Poligon SIGMET Real-Time BMKG INA-SIAM</span>
                </div>
                {effectiveAshHeight && (
                  <div><strong>Ketinggian Kolom Abu:</strong> {effectiveAshHeight}</div>
                )}
                {effectiveDirection && (
                  <div><strong>Arah & Kecepatan:</strong> {effectiveDirection}</div>
                )}
                {sigmetInfo?.rawSigmet && (
                  <div style={{
                    marginTop: '4px',
                    fontSize: '9px',
                    fontFamily: 'monospace',
                    background: '#ffffff',
                    padding: '4px',
                    borderRadius: '3px',
                    border: '1px solid #e2e8f0',
                    maxHeight: '42px',
                    overflowY: 'auto',
                    whiteSpace: 'pre-wrap',
                    color: '#334155'
                  }}>
                    {sigmetInfo.rawSigmet}
                  </div>
                )}
              </div>
            )}

            {/* Closed Airport Alert Banner */}
            {alert.closedAirports && alert.closedAirports.length > 0 && (
              <div style={{ margin: '6px 0', padding: '6px 8px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '4px' }}>
                <div style={{ color: '#b91c1c', fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>⛔</span>
                  <span>BANDARA DITUTUP (AERODROME CLOSED)</span>
                </div>
                {alert.closedAirports.map((ap) => (
                  <div key={ap.icao} style={{ marginTop: '3px', fontSize: '10.5px', color: '#991b1b', lineHeight: 1.3 }}>
                    <div><strong>{ap.name} ({ap.icao})</strong> {ap.distanceKm ? `• ±${ap.distanceKm} km` : ''}</div>
                    <div style={{ fontSize: '10px', color: '#7f1d1d' }}>{ap.detail}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Regional Seaports / Dermaga Banner */}
            {alert.affectedSeaports && alert.affectedSeaports.length > 0 && (
              <div style={{ margin: '6px 0', padding: '6px 8px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '4px' }}>
                <div style={{ color: '#1e40af', fontWeight: 700, fontSize: '11px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>🚢</span>
                  <span>DERMAGA & PELABUHAN WASPADA</span>
                </div>
                {alert.affectedSeaports.map((port, pIdx) => (
                  <div key={pIdx} style={{ marginTop: '3px', fontSize: '10.5px', color: '#1e3a8a', lineHeight: 1.3 }}>
                    <div><strong>{port.name}</strong> • {port.distanceKm} km</div>
                    <div style={{ fontSize: '10px', color: '#3b82f6' }}>{port.status} - {port.note}</div>
                  </div>
                ))}
              </div>
            )}

            <p className="ews-popup-desc" style={{ fontSize: '11px', margin: '6px 0', color: 'var(--text-secondary)' }}>
              {alert.description.split('\n')[0]}
            </p>

            {alert.trajectoryImageUrl && (
              <div style={{ marginTop: '6px', marginBottom: '6px' }}>
                <a href={alert.trajectoryImageUrl} target="_blank" rel="noopener noreferrer">
                  <img
                    src={alert.trajectoryImageUrl}
                    alt="Citra Trajektori Satelit BMKG"
                    style={{ width: '100%', maxHeight: '140px', objectFit: 'contain', borderRadius: '4px', border: '1px solid var(--border-default)' }}
                  />
                </a>
                <div style={{ fontSize: '9.5px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '2px' }}>
                  INA-SIAM BMKG / VAAC Darwin (Klik untuk memperbesar)
                </div>
              </div>
            )}

            <div className="ews-popup-footer" style={{ marginTop: '6px', paddingTop: '4px', borderTop: '1px solid var(--border-default)' }}>
              {isVolcano ? (
                <span style={{ fontSize: '10.5px', color: '#ea580c', fontWeight: 600 }}>Poligon SIGMET INA-SIAM</span>
              ) : isProvinceAlert ? (
                <span>Provinsi terdampak Cuaca Buruk</span>
              ) : (
                <span>{alert.type === 'air_quality' ? `Area segitiga: jangkauan ${(radius / 1000).toFixed(0)} km` : `Radius: ${(radius / 1000).toFixed(0)} km`}</span>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '10.5px', color: 'var(--text-secondary)' }}>Severity:</span>
                {renderSevBoxes()}
              </div>
            </div>
          </div>
        );

        const weatherPos: [number, number] | null = isWeatherAlert && provinceCentroids
          ? (provinceCentroids.get(alert.provinceId) ?? null)
          : null;

        return (
          <React.Fragment key={`alert-group-${alert.id}`}>
            {/* 1. Volcanic Hazard: Real-Time Dynamic SIGMET Polygon & Trajectory Direction Arrow */}
            {hasPolygon && (
              <>
                <Polygon
                  positions={sourcePolygons ?? polygonCoords!}
                  pathOptions={{
                    color: '#facc15',
                    fillColor: '#dc2626',
                    fillOpacity: 0.35,
                    weight: 2.5,
                    dashArray: '6, 4',
                    bubblingMouseEvents: false,
                  }}
                  eventHandlers={{
                    click: () => onAlertSelect?.(alert.id),
                  }}
                >
                  <Tooltip sticky>
                    <div>
                      <strong>{alert.title}</strong><br />
                      <span style={{ color: '#ea580c', fontWeight: 600 }}>Poligon SIGMET Real-Time (INA-SIAM)</span><br />
                      {effectiveAshHeight && <>Ketinggian: {effectiveAshHeight}<br /></>}
                      {effectiveDirection && <>Arah & Kecepatan: {effectiveDirection}<br /></>}
                      {alert.closedAirports && alert.closedAirports.length > 0 && (
                        <div style={{ color: '#dc2626', fontWeight: 'bold' }}>
                          ⛔ Bandara Ditutup: {alert.closedAirports.map(a => a.icao).join(', ')}
                        </div>
                      )}
                      Area: {alert.affectedArea || 'Koridor Ruang Udara'}<br />
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                        <span>Severity:</span>
                        <div style={{ display: 'flex', gap: '3px' }}>
                          {[1, 2, 3].map((i) => (
                            <span key={i} style={{ width: '12px', height: '4px', borderRadius: '1px', backgroundColor: i <= alert.severity ? sevColor : 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                          ))}
                        </div>
                      </div>
                    </div>
                  </Tooltip>
                  <Popup>{popupContent}</Popup>
                </Polygon>

                {/* Trajectory Direction Arrow */}
                {arrowData && (
                  <>
                    <Polyline
                      positions={arrowData.shaft}
                      pathOptions={{ color: '#fde047', weight: 3.5, opacity: 0.95 }}
                    />
                    <Polyline
                      positions={arrowData.barb1}
                      pathOptions={{ color: '#fde047', weight: 3.5, opacity: 0.95 }}
                    />
                    <Polyline
                      positions={arrowData.barb2}
                      pathOptions={{ color: '#fde047', weight: 3.5, opacity: 0.95 }}
                    />
                  </>
                )}
              </>
            )}

            {/* 2. Standard Circle ONLY for non-volcano, non-air-quality, and non-province hazards */}
            {!isProvinceAlert && !hasPolygon && !isVolcano && alert.type !== 'air_quality' && (
              <Circle
                center={center}
                radius={radius}
                pathOptions={pathOptions}
                eventHandlers={{
                  click: () => {
                    onAlertSelect?.(alert.id);
                  }
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>{alert.title}</strong><br />
                    Radius Dampak: {(radius / 1000).toFixed(0)} km<br />
                    {isValidCoord(alert.latitude, alert.longitude) && (
                      <>Epicenter: {Number(alert.latitude).toFixed(4)}, {Number(alert.longitude).toFixed(4)}<br /></>
                    )}
                    Area: {alert.affectedArea || 'Sekitar KPW'}<br />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span>Severity:</span>
                      <div style={{ display: 'flex', gap: '3px' }}>
                        {[1, 2, 3].map((i) => (
                          <span key={i} style={{ width: '12px', height: '4px', borderRadius: '1px', backgroundColor: i <= alert.severity ? sevColor : 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </Tooltip>
                <Popup>{popupContent}</Popup>
              </Circle>
            )}

            {/* 2b. Air Quality Hazard: triangular impact area */}
            {alert.type === 'air_quality' && center && (
              <Polygon
                positions={[0, 120, 240].map((bearing) => getDestinationCoords(center[0], center[1], radius, bearing))}
                pathOptions={{
                  color: pathOptions.color,
                  fillColor: pathOptions.color,
                  fillOpacity: 0.28,
                  weight: 2,
                  dashArray: '5, 4',
                  bubblingMouseEvents: false,
                }}
                eventHandlers={{
                  click: () => {
                    onAlertSelect?.(alert.id);
                  }
                }}
              >
                <Tooltip sticky>
                  <div>
                    <strong>{alert.title}</strong><br />
                    <span style={{ color: pathOptions.color, fontWeight: 700 }}>
                      Area Segitiga Kualitas Udara (SPKU KemenLH)
                    </span><br />
                    Jangkauan Area: {(radius / 1000).toFixed(0)} km<br />
                    Nilai ISPU: <strong>{alert.ispuValue}</strong> ({alert.ispuCategory})<br />
                    Parameter Kritis: {alert.ispuParam || 'PM2.5'}<br />
                    Stasiun: {alert.stationName}<br />
                    Area: {alert.affectedArea || 'Sekitar KPw'}<br />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                      <span>Severity:</span>
                      <div style={{ display: 'flex', gap: '3px' }}>
                        {[1, 2, 3].map((i) => (
                          <span key={i} style={{ width: '12px', height: '4px', borderRadius: '1px', backgroundColor: i <= alert.severity ? sevColor : 'rgba(255,255,255,0.2)', display: 'inline-block' }} />
                        ))}
                      </div>
                    </div>
                  </div>
                </Tooltip>
                <Popup>{popupContent}</Popup>
              </Polygon>
            )}

            {/* 3. Hazard Marker Icon */}
            <Marker
              position={
                isWeatherAlert
                  ? (weatherPos ?? (() => {
                      const province = PROVINCES.find((p) => p.id === alert.provinceId);
                      return province ? [province.latitude, province.longitude] as [number, number] : center!;
                    })())
                  : (alert.type === 'karhutla' || alert.type === 'air_quality' || isVolcano ? center : iconCoords)
              }
              icon={customIcon}
              interactive={true}
              eventHandlers={{
                click: () => {
                  onAlertSelect?.(alert.id);
                }
              }}
            >
              <Popup>{popupContent}</Popup>
            </Marker>
          </React.Fragment>
        );
      })}
    </>
  );
};

export default AlertCircles;

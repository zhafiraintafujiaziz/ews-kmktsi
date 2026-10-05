import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polyline, CircleMarker, Marker, Circle, Tooltip, Polygon } from 'react-leaflet';
import L from 'leaflet';
import type { GeoJsonObject, Feature } from 'geojson';
import { PROVINCES } from '../../constants/provinces';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import { mapTextToProvinceId } from '../../utils/provinceMap';
import { MEGATHRUST_ZONES } from '../../constants/megathrustZones';
import { getPolylineBufferSegments } from '../../utils/geo';
import { RING_OF_FIRE_ARCS, VOLCANO_POINTS } from '../../constants/ringOfFire';
import type { DisasterAlert, AlertSeverity } from '../../types';
import MapController from '../dashboard/map/MapController';
import MapEventsHandler from '../dashboard/map/MapEventsHandler';

export type PerkiraanMapMode = 'mingguan' | 'iklim' | 'gempa';

interface PerkiraanMapProps {
  mode: PerkiraanMapMode;
  forecastAlerts?: DisasterAlert[];
  selectedProvinceId?: string | null;
  selectedOfficeId?: string | null;
  onProvinceSelect?: (id: string) => void;
  onOfficeSelect?: (officeId: string) => void;
  selectedMegathrustId?: string | null;
  onMegathrustSelect?: (id: string) => void;
  showMegathrust?: boolean;
  showRingOfFire?: boolean;
}

const INDONESIA_CENTER: [number, number] = [-2.5489, 118.0149];

function getProvinceFloodRisk(provinceId: string): number | null {
  const values = KPWBI_OFFICES.filter((office) => office.provinceId === provinceId)
    .map((office) => BnpbInariskService.getLocalHazardIndex(office.id, 'flood'))
    .filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

function getForecastSeverityForProvince(provinceId: string, alerts: DisasterAlert[]): AlertSeverity | null {
  const matching = alerts.filter((a) => a.provinceId === provinceId && a.isForecast);
  if (matching.length === 0) return null;
  if (matching.some((a) => a.severity === 3)) return 3;
  if (matching.some((a) => a.severity === 2)) return 2;
  return 1;
}

const PerkiraanMap: React.FC<PerkiraanMapProps> = ({
  mode,
  forecastAlerts = [],
  selectedProvinceId = null,
  selectedOfficeId = null,
  onProvinceSelect,
  onOfficeSelect,
  selectedMegathrustId = null,
  onMegathrustSelect,
  showMegathrust = true,
  showRingOfFire = true,
}) => {
  const [geoJsonData, setGeoJsonData] = useState<GeoJsonObject | null>(null);

  useEffect(() => {
    fetch('/indonesia-provinces.json')
      .then((r) => r.json())
      .then(setGeoJsonData)
      .catch(() => {});
  }, []);

  const getGeoJsonStyle = (feature?: Feature) => {
    if (!feature) return {};
    const provinceId = mapTextToProvinceId((feature.properties?.['Propinsi'] as string) || '');

    if (mode === 'mingguan') {
      const forecastSev = getForecastSeverityForProvince(provinceId, forecastAlerts);
      const floodRisk = getProvinceFloodRisk(provinceId);
      const isHighFlood = floodRisk !== null && floodRisk > 0.5;

      if (forecastSev === 3) {
        return { fillColor: '#dc2626', fillOpacity: 0.35, color: '#b91c1c', weight: 2.5 };
      }
      if (forecastSev === 2) {
        return { fillColor: '#d97706', fillOpacity: 0.3, color: '#b45309', weight: 2 };
      }
      if (forecastSev === 1) {
        return { fillColor: '#0ea5e9', fillOpacity: 0.2, color: '#0284c7', weight: 1.5 };
      }
      if (isHighFlood) {
        return { fillColor: '#6366f1', fillOpacity: 0.15, color: '#4f46e5', weight: 1.5 };
      }
      return { fillColor: 'transparent', fillOpacity: 0, color: 'rgba(0,0,0,0.08)', weight: 0.5 };
    }

    // gempa: no fill
    return { fillColor: 'transparent', fillOpacity: 0, color: 'rgba(255,255,255,0.15)', weight: 0.5 };
  };

  const onEachFeature = (feature: Feature, layer: L.Layer) => {
    const propName = (feature.properties?.['Propinsi'] as string) || '';
    const provinceId = mapTextToProvinceId(propName);

    if (mode === 'mingguan') {
      const floodRisk = getProvinceFloodRisk(provinceId);
      const forecastSev = getForecastSeverityForProvince(provinceId, forecastAlerts);
      if (!forecastSev && floodRisk === null) {
        layer.bindTooltip(`<div style="font-size:12px;padding:4px"><strong>${propName}</strong><br/>Current data unavailable</div>`, { sticky: true });
        return;
      }
      layer.bindTooltip(
        `<div style="font-size:12px;padding:4px">
          <strong>${propName}</strong><br/>
          ${forecastSev ? `Prakiraan: <strong>${forecastSev === 3 ? 'Siaga' : forecastSev === 2 ? 'Waspada' : 'Potensi'}</strong><br/>` : ''}
          Kerentanan Banjir: <strong>${floodRisk === null ? 'Current data unavailable' : `${(floodRisk * 100).toFixed(0)}/100`}</strong>
        </div>`,
        { sticky: true }
      );
    }

  };

  // Province centroid severity icons for mingguan & iklim
  const provinceSeverityMarkers = PROVINCES.map((prov) => {
    let iconHtml = '';
    let color = '';

    if (mode === 'mingguan') {
      const sev = getForecastSeverityForProvince(prov.id, forecastAlerts);
      const floodRisk = getProvinceFloodRisk(prov.id);
      if (sev === 3) {
        color = '#dc2626';
        iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="#dc2626" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6))"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else if (sev === 2) {
        color = '#d97706';
        iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="#d97706" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6))"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`;
      } else if (sev === 1) {
        color = '#0ea5e9';
        iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="#0ea5e9" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6))"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`;
      } else if (floodRisk !== null && floodRisk > 0.5) {
        color = '#6366f1';
        iconHtml = `<svg viewBox="0 0 24 24" width="20" height="20" fill="#6366f1" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6))"><path d="M12 22a7 7 0 0 0 7-7c0-4.3-7-11-7-11S5 10.7 5 15a7 7 0 0 0 7 7z"/></svg>`;
      }
    }

    if (!iconHtml) return null;

    const icon = L.divIcon({
      className: '',
      html: `<div style="display: flex; align-items: center; justify-content: center; width: 20px; height: 20px;">${iconHtml}</div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 10],
    });

    return (
      <Marker key={`prov-icon-${prov.id}`} position={[prov.latitude, prov.longitude]} icon={icon} interactive={false}>
        <Tooltip direction="top" offset={[0, -8]} sticky>
          <span style={{ fontSize: 12 }}>{prov.name} — {color === '#dc2626' ? 'Siaga' : color === '#d97706' ? 'Waspada' : color === '#0ea5e9' ? 'Potensi Cuaca' : color === '#6366f1' ? 'Rentan Banjir' : color === '#f97316' ? 'Risiko Kekeringan' : 'Risiko Banjir'}</span>
        </Tooltip>
      </Marker>
    );
  }).filter(Boolean);

  const selectedOffice = selectedOfficeId
    ? KPWBI_OFFICES.find((o) => o.id === selectedOfficeId) ?? null
    : selectedProvinceId
      ? KPWBI_OFFICES.find((o) => o.provinceId === selectedProvinceId) ?? null
      : null;
  const dummyAlert = null;
  const clearSelection = () => {
    onProvinceSelect?.('');
    onOfficeSelect?.('');
    onMegathrustSelect?.('');
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer
        center={INDONESIA_CENTER}
        zoom={5}
        style={{ width: '100%', height: '100%' }}
        zoomControl
        minZoom={4}
        maxZoom={18}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {geoJsonData && (
          <GeoJSON
            key={`perkiraan-geojson-${mode}`}
            data={geoJsonData}
            style={getGeoJsonStyle}
            onEachFeature={onEachFeature}
          />
        )}

        <MapController
          selectedOffice={selectedOffice}
          selectedAlert={dummyAlert}
          resetTrigger={0}
          isSidebarCollapsed={false}
          zoom={selectedOfficeId ? 9 : 7}
        />
        <MapEventsHandler onClearSelection={clearSelection} />

        {/* Province severity icons for mingguan & iklim */}
        {(mode === 'mingguan' || mode === 'iklim') && provinceSeverityMarkers}

        {/* KPW office dots */}
        {KPWBI_OFFICES.map((o) => {
          const isSelected = selectedOfficeId === o.id;
          return (
            <CircleMarker
              key={`kpw-${o.id}`}
              center={[o.latitude, o.longitude]}
              radius={isSelected ? 7 : 4}
              pathOptions={{
                color: isSelected ? '#2563eb' : '#1e3a8a',
                fillColor: isSelected ? '#3b82f6' : '#3b82f6',
                fillOpacity: isSelected ? 1 : 0.8,
                weight: isSelected ? 3 : 1,
              }}
              eventHandlers={{
                click: () => onOfficeSelect?.(o.id),
              }}
            >
              <Tooltip direction="top" offset={[0, -4]}>{o.name}</Tooltip>
            </CircleMarker>
          );
        })}

        {/* Ring of Fire arcs */}
        {mode === 'gempa' && showRingOfFire && RING_OF_FIRE_ARCS.map((arc) => (
          <Polyline
            key={arc.id}
            positions={arc.path}
            pathOptions={{ color: arc.color, weight: 3, dashArray: '8, 4', opacity: 0.85 }}
          >
            <Tooltip sticky><strong>{arc.name}</strong><br/>Ring of Fire / Busur Vulkanik</Tooltip>
          </Polyline>
        ))}

        {/* Volcano points */}
        {mode === 'gempa' && showRingOfFire && VOLCANO_POINTS.map((v) => {
          const icon = L.divIcon({
            className: '',
            html: `<div style="display: flex; align-items: center; justify-content: center; width: 22px; height: 22px; font-size: 18px; line-height: 1;">🌋</div>`,
            iconSize: [22, 22],
            iconAnchor: [11, 11],
          });
          return (
            <Marker key={`vol-${v.name}`} position={[v.lat, v.lng]} icon={icon}>
              <Tooltip direction="top" offset={[0, -8]}>
                <strong>G. {v.name}</strong><br/>
                {v.lat.toFixed(4)}, {v.lng.toFixed(4)}
              </Tooltip>
            </Marker>
          );
        })}

        {/* Megathrust zones */}
        {mode === 'gempa' && showMegathrust && MEGATHRUST_ZONES.map((zone) => {
          const isSelected = zone.id === selectedMegathrustId;
          const bufferSegments = getPolylineBufferSegments(zone.path, zone.impactRadiusKm);

          const bufferStyle = isSelected
            ? {
                color: '#f59e0b',
                fillColor: '#f59e0b',
                fillOpacity: 0.08,
                weight: 1.5,
                opacity: 0.5,
                dashArray: '6, 4',
              }
            : {
                color: '#7c3aed',
                fillColor: '#7c3aed',
                fillOpacity: 0.02,
                weight: 0.5,
                opacity: 0.15,
                dashArray: '3, 4',
              };

          return (
            <React.Fragment key={zone.id}>
              {/* Buffer segments along the subduction line */}
              {bufferSegments.map((pts, idx) => (
                <Polygon
                  key={`${zone.id}-buf-seg-${idx}`}
                  positions={pts}
                  pathOptions={bufferStyle}
                  eventHandlers={{ click: () => onMegathrustSelect?.(zone.id) }}
                >
                  <Tooltip sticky>
                    <strong>{zone.name}</strong> (Area Dampak)<br/>
                    Maks: Mw {zone.maxMagnitude}<br/>
                    Radius Dampak: {zone.impactRadiusKm} km
                  </Tooltip>
                </Polygon>
              ))}

              {/* Buffer circles around each point of the subduction line to round joint corners */}
              {zone.path.map((pt, idx) => (
                <Circle
                  key={`${zone.id}-buf-circ-${idx}`}
                  center={pt}
                  radius={zone.impactRadiusKm * 1000}
                  pathOptions={bufferStyle}
                  eventHandlers={{ click: () => onMegathrustSelect?.(zone.id) }}
                >
                  <Tooltip sticky>
                    <strong>{zone.name}</strong> (Area Dampak)<br/>
                    Maks: Mw {zone.maxMagnitude}<br/>
                    Radius Dampak: {zone.impactRadiusKm} km
                  </Tooltip>
                </Circle>
              ))}

              {/* Trench Line */}
              <Polyline
                positions={zone.path}
                pathOptions={{
                  color: isSelected ? '#f59e0b' : '#7c3aed',
                  weight: isSelected ? 5 : 3,
                  opacity: 0.9,
                }}
                eventHandlers={{ click: () => onMegathrustSelect?.(zone.id) }}
              >
                <Tooltip sticky>
                  <strong>{zone.name}</strong><br/>
                  Maks: Mw {zone.maxMagnitude}<br/>
                  Radius Dampak: {zone.impactRadiusKm} km
                </Tooltip>
              </Polyline>
            </React.Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
};

export default PerkiraanMap;

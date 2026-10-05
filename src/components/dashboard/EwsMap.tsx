import React, { useEffect, useRef, useMemo, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Polyline } from 'react-leaflet';
import L from 'leaflet';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import type { DisasterAlert, DisasterType, AlertSeverity, KpwbiOffice } from '../../types';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { findNearestOffices } from '../../utils/geo';
import { mapTextToProvinceId } from '../../utils/provinceMap';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import { IspuService } from '../../services/ispuService';
import MapController from './map/MapController';
import MapEventsHandler from './map/MapEventsHandler';
import AlertCircles from './map/AlertCircles';
import KpwMarkers from './map/KpwMarkers';
import NearestKpwPanel from './map/NearestKpwPanel';
import MapLegend from './map/MapLegend';

export interface EwsMapProps {
  alerts: DisasterAlert[];
  allAlerts?: DisasterAlert[];
  riskAlerts?: DisasterAlert[];
  riskResults?: import('../../types').RiskCalcResult[];
  selectedProvinceId: string | null;
  selectedOfficeId?: string | null;
  selectedAlertId: string | null;
  onProvinceSelect: (provinceId: string) => void;
  onOfficeSelect?: (officeId: string) => void;
  onAlertSelect: (alertId: string) => void;
  activeTypeFilter?: DisasterType | 'all';
  isSidebarCollapsed?: boolean;
  isKerentananView?: boolean;
  isPotensiView?: boolean;
}

const INDONESIA_CENTER: [number, number] = [-2.5489, 118.0149];
const INARISK_TYPES = ['flood', 'tsunami', 'kekeringan', 'volcanic', 'volcanic_ash', 'air_quality'];
const POTENSI_TYPES = ['gempa', 'karhutla', 'cuaca', 'pasang'];

interface ProvinceProperties {
  Propinsi?: string;
}

type ProvinceFeature = Feature<Geometry, ProvinceProperties>;

function getProvinceRisk(provinceId: string, hazard: 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash' | 'air_quality'): number | null {
  const values = KPWBI_OFFICES.filter((office) => office.provinceId === provinceId)
    .map((office) => BnpbInariskService.getLocalHazardIndex(office.id, hazard))
    .filter((value): value is number => value !== null);
  return values.length > 0 ? Math.max(...values) : null;
}

function getProvinceIspu(provinceId: string) {
  const assessments = KPWBI_OFFICES.filter((office) => office.provinceId === provinceId)
    .map((office) => IspuService.getOfficeIspuAssessment(office.id))
    .filter((assessment) => assessment !== null);
  return assessments.reduce<typeof assessments[number] | null>(
    (worst, current) => !worst || current.ispuValue > worst.ispuValue ? current : worst, null,
  );
}

function getProvincePotensi(): null {
  return null;
}

export const EwsMap: React.FC<EwsMapProps> = ({
  alerts,
  allAlerts,
  riskAlerts,
  riskResults = [],
  selectedProvinceId,
  selectedOfficeId = null,
  selectedAlertId,
  onProvinceSelect,
  onOfficeSelect,
  onAlertSelect,
  activeTypeFilter = 'all',
  isSidebarCollapsed = false,
  isKerentananView = false,
  isPotensiView = false,
}) => {
  const [resetTrigger, setResetTrigger] = useState(0);
  const [geoJsonData, setGeoJsonData] = useState<FeatureCollection<Geometry, ProvinceProperties> | null>(null);
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  const [mapLayers, setMapLayers] = useState({
    kp: true,
    korwil: true,
    normal: true,
    nearest: true,
    critical: true,
    warning: true,
    watch: true,
    earthquake: true,
    extreme_weather: true,
    karhutla: true,
    volcanic: true,
    volcanic_ash: true,
    air_quality: true,
  });

  const toggleLayer = (layerKey: keyof typeof mapLayers) => {
    setMapLayers((prev) => ({ ...prev, [layerKey]: !prev[layerKey] }));
  };

  useEffect(() => {
    fetch('/indonesia-provinces.json')
      .then((res) => res.json())
      .then((data) => setGeoJsonData(data))
      .catch((err) => console.error('Failed to load province GeoJSON:', err));
  }, []);

  const isInariskFilter = isKerentananView && INARISK_TYPES.includes(activeTypeFilter);
  const isPotensiFilter = isPotensiView && POTENSI_TYPES.includes(activeTypeFilter);

  const visibleAlerts = useMemo(() => {
    if (selectedAlertId) {
      return alerts.filter((alert) => alert.id === selectedAlertId);
    }
    return alerts.filter((alert) => {
      // Filter by alert severity directly (not risk level)
      if (alert.severity === 3 && !mapLayers.critical) return false;
      if (alert.severity === 2 && !mapLayers.warning)  return false;
      if (alert.severity === 1 && !mapLayers.watch)    return false;

      // Filter by disaster type toggle
      if (alert.type === 'earthquake' && !mapLayers.earthquake) return false;
      if (alert.type === 'extreme_weather' && !mapLayers.extreme_weather) return false;
      if (alert.type === 'karhutla' && !mapLayers.karhutla) return false;
      if (alert.type === 'volcanic' && !mapLayers.volcanic) return false;
      if (alert.type === 'volcanic_ash' && !mapLayers.volcanic_ash) return false;
      if (alert.type === 'air_quality' && !mapLayers.air_quality) return false;

      return true;
    });
  }, [
    alerts,
    selectedAlertId,
    mapLayers.critical,
    mapLayers.warning,
    mapLayers.watch,
    mapLayers.earthquake,
    mapLayers.extreme_weather,
    mapLayers.karhutla,
    mapLayers.volcanic,
    mapLayers.volcanic_ash,
    mapLayers.air_quality
  ]);

  // Compute province highlights for extreme_weather alerts (province-level impact instead of circle radius)
  const weatherAlertProvinces = useMemo(() => {
    const provinceMap = new Map<string, AlertSeverity>();
    for (const alert of visibleAlerts) {
      if (alert.type !== 'extreme_weather' || !alert.provinceId) continue;
      const existing = provinceMap.get(alert.provinceId);
      if (!existing || alert.severity > existing) {
        provinceMap.set(alert.provinceId, alert.severity);
      }
    }
    return provinceMap;
  }, [visibleAlerts]);

  const weatherAlertKey = useMemo(() => {
    return Array.from(weatherAlertProvinces.entries()).map(([k, v]) => `${k}-${v}`).join(',');
  }, [weatherAlertProvinces]);

  const getGeoJsonStyle = (feature?: ProvinceFeature) => {
    if (!isInariskFilter && !isPotensiFilter) {
      return { fillColor: 'transparent', fillOpacity: 0, color: 'transparent', weight: 0, bubblingMouseEvents: false };
    }
    const provinceId = mapTextToProvinceId(feature?.properties.Propinsi || '');
    if (activeTypeFilter === 'air_quality') {
      const assessment = getProvinceIspu(provinceId);
      if (!assessment) return { fillColor: 'transparent', fillOpacity: 0, color: 'rgba(0,0,0,0.12)', weight: 0.8, bubblingMouseEvents: false };
      const color = IspuService.getCategoryColor(assessment.category);
      return { fillColor: color, fillOpacity: 0.3, color, weight: 1.5, bubblingMouseEvents: false };
    }
    
    let score: number | null = null;
    if (isInariskFilter) {
      const hazard = activeTypeFilter as 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash' | 'air_quality';
      score = getProvinceRisk(provinceId, hazard);
    } else {
      score = getProvincePotensi();
    }

    if (score === null) return { fillColor: 'transparent', fillOpacity: 0, color: 'rgba(0,0,0,0.12)', weight: 0.8, bubblingMouseEvents: false };
    const val = Math.round(score * 100);
    if (val >= 64) {
      return { fillColor: 'var(--alert-critical)', fillOpacity: 0.35, color: 'var(--alert-critical)', weight: 1.5, bubblingMouseEvents: false };
    }
    if (val > 40) {
      return { fillColor: 'var(--alert-warning)', fillOpacity: 0.3, color: 'var(--alert-warning)', weight: 1.5, bubblingMouseEvents: false };
    }
    if (val > 0) {
      return { fillColor: 'var(--alert-watch)', fillOpacity: 0.2, color: 'var(--alert-watch)', weight: 1.2, bubblingMouseEvents: false };
    }
    return { fillColor: 'transparent', fillOpacity: 0, color: 'rgba(0,0,0,0.12)', weight: 0.8, bubblingMouseEvents: false };
  };

  const onEachFeature = (feature: ProvinceFeature, layer: L.Layer) => {
    const propName = feature.properties.Propinsi || '';
    const provinceId = mapTextToProvinceId(propName);
    if (activeTypeFilter === 'air_quality') {
      const assessment = getProvinceIspu(provinceId);
      const badge = assessment ? IspuService.getCategoryBadge(assessment.category, assessment.ispuValue) : null;
      layer.bindTooltip(`<div style="font-family: var(--font-sans); font-size: 12px; padding: 4px;"><strong>Provinsi ${propName}</strong><br/>${assessment && badge ? `ISPU: <strong>${assessment.ispuValue}</strong><br/><span style="background:${badge.bg};color:${badge.color};padding:2px 4px;border-radius:3px">${badge.label}</span>` : 'Current data unavailable'}</div>`, { sticky: true });
      return;
    }

    let score: number | null = null;
    let hazardTitle = '';
    
    if (isInariskFilter) {
      const hazard = activeTypeFilter as 'flood' | 'tsunami' | 'kekeringan' | 'volcanic' | 'volcanic_ash' | 'air_quality';
      score = getProvinceRisk(provinceId, hazard);
      hazardTitle = { flood: 'Banjir', tsunami: 'Tsunami', kekeringan: 'Kekeringan', volcanic: 'Gunung Api', volcanic_ash: 'Abu Vulkanik', air_quality: 'Kualitas Udara' }[hazard] ?? hazard;
    } else if (isPotensiFilter) {
      const hazard = activeTypeFilter as 'gempa' | 'karhutla' | 'cuaca' | 'pasang';
      score = getProvincePotensi();
      hazardTitle = { gempa: 'Gempa Bumi', karhutla: 'Kebakaran Hutan', cuaca: 'Cuaca Ekstrim', pasang: 'Gelombang Pasang' }[hazard] ?? hazard;
    } else {
      return;
    }

    if (score === null) {
      layer.bindTooltip(`<div style="font-family: var(--font-sans); font-size: 12px; padding: 4px;"><strong>Provinsi ${propName}</strong><br/>Current data unavailable</div>`, { sticky: true });
      return;
    }
    const val = Math.round(score * 100);
    const severity = val >= 64 ? 'Tinggi' : val > 40 ? 'Sedang' : val > 0 ? 'Rendah' : 'Aman';
    const statusColor = val >= 64 ? 'var(--alert-critical)' : val > 40 ? 'var(--alert-warning)' : 'var(--alert-watch)';

    layer.bindTooltip(`
      <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.4; padding: 4px;">
        <strong>Provinsi ${propName}</strong><br/>
        Indeks ${isPotensiView ? 'Potensi' : 'Kerentanan'} ${hazardTitle}: <strong>${score > 0 ? score.toFixed(2) : '0.00'}</strong><br/>
        Status: <span style="font-weight: 700; color: ${statusColor}">${severity}</span>
      </div>
    `, { sticky: true });
  };

  const severityColors: Record<AlertSeverity, string> = {
    3: 'var(--alert-critical)',
    2: 'var(--alert-warning)',
    1: 'var(--alert-watch)',
  };

  // Compute geometric centroids for each province from GeoJSON data
  const provinceCentroids = useMemo(() => {
    const map = new Map<string, [number, number]>();
    if (!geoJsonData) return map;
    const features = geoJsonData.features || [];
    for (const feature of features) {
      const provinceId = mapTextToProvinceId(feature.properties?.Propinsi || '');
      if (!provinceId) continue;
      const geometry = feature.geometry;

      let sumLat = 0, sumLng = 0, count = 0;
      const processRing = (ring: Position[]) => {
        for (const [lng, lat] of ring) {
          sumLat += lat;
          sumLng += lng;
          count++;
        }
      };
      const processPolygon = (poly: Position[][]) => {
        for (const ring of poly) processRing(ring);
      };

      if (geometry.type === 'Polygon') {
        processPolygon(geometry.coordinates);
      } else if (geometry.type === 'MultiPolygon') {
        for (const poly of geometry.coordinates) processPolygon(poly);
      }

      if (count > 0) {
        map.set(provinceId, [sumLat / count, sumLng / count]);
      }
    }
    return map;
  }, [geoJsonData]);

  const getWeatherGeoJsonStyle = (feature?: ProvinceFeature) => {
    const provinceId = mapTextToProvinceId(feature?.properties.Propinsi || '');
    const severity = weatherAlertProvinces.get(provinceId);
    if (!severity) {
      return { fillColor: 'transparent', fillOpacity: 0, color: 'transparent', weight: 0, bubblingMouseEvents: false };
    }
    const color = severityColors[severity];
    return {
      fillColor: color,
      fillOpacity: 0.2,
      color,
      weight: 2,
      bubblingMouseEvents: false,
    };
  };

  const onEachWeatherFeature = (feature: ProvinceFeature, layer: L.Layer) => {
    const propName = feature.properties.Propinsi || '';
    const provinceId = mapTextToProvinceId(propName);
    const severity = weatherAlertProvinces.get(provinceId);
    if (!severity) return;

    const weatherAlerts = visibleAlerts.filter(
      (a) => (a.type === 'extreme_weather' || a.type === 'karhutla') && a.provinceId === provinceId
    );

    const sevBoxes = '<div style="display:flex;gap:3px">' + [1,2,3].map((i) =>
      `<span style="width:12px;height:4px;border-radius:1px;background:${i <= severity ? severityColors[severity] : 'rgba(255,255,255,0.2)'};display:inline-block"></span>`
    ).join('') + '</div>';

    layer.bindTooltip(`
      <div style="font-family: var(--font-sans); font-size: 12px; line-height: 1.4; padding: 4px;">
        <strong>Provinsi ${propName}</strong><br/>
        <span>Peringatan Kebencanaan</span><br/>
        ${weatherAlerts.map((a) => `<div>• [${a.type === 'karhutla' ? 'Karhutla' : 'Cuaca Buruk'}] ${a.title}</div>`).join('')}
        <div style="margin-top: 4px; display:flex; align-items:center; gap:6px">
          <span>Severity:</span>${sevBoxes}
        </div>
      </div>
    `, { sticky: true });

    layer.on({
      click: () => {
        const firstAlert = weatherAlerts[0];
        if (firstAlert) {
          onAlertSelect(firstAlert.id);
          onProvinceSelect(provinceId);
        }
      },
    });
  };

  const selectedOffice = useMemo(() => {
    if (selectedOfficeId) {
      return KPWBI_OFFICES.find((o) => o.id === selectedOfficeId) ?? null;
    }
    if (selectedProvinceId) {
      return KPWBI_OFFICES.find((o) => o.provinceId === selectedProvinceId) ?? null;
    }
    return null;
  }, [selectedOfficeId, selectedProvinceId]);
  const selectedAlert = alerts.find((a) => a.id === selectedAlertId) ?? null;

  const nearestOffices = useMemo(() => {
    if (!selectedOffice || !mapLayers.nearest) return [];
    return findNearestOffices(selectedOffice, KPWBI_OFFICES, 3);
  }, [selectedOffice, mapLayers.nearest]);

  // Open the relevant marker popup when the selection changes
  useEffect(() => {
    let office: KpwbiOffice | undefined;
    if (selectedOfficeId) {
      office = KPWBI_OFFICES.find((o) => o.id === selectedOfficeId);
    }
    if (!office && selectedAlert) {
      office = KPWBI_OFFICES.find((o) => o.provinceId === selectedAlert.provinceId);
    }
    if (!office && selectedProvinceId) {
      office = KPWBI_OFFICES.find((o) => o.provinceId === selectedProvinceId);
    }
    if (!office) return;
    const marker = markerRefs.current[office.id];
    if (marker) setTimeout(() => marker.openPopup(), 100);
  }, [selectedAlert, selectedProvinceId, selectedOfficeId]);

  const clearSelection = () => { onAlertSelect(''); onProvinceSelect(''); onOfficeSelect?.(''); };

  return (
    <div className="map-wrapper">
      <button
        className="map-reset-btn"
        title="Reset Map View"
        onClick={() => { clearSelection(); setResetTrigger((n) => n + 1); }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
      </button>

      <MapContainer center={INDONESIA_CENTER} zoom={5} className="map-container-element" zoomControl minZoom={4} maxZoom={18}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {isInariskFilter && geoJsonData && (
          <GeoJSON
            key={`${activeTypeFilter}-${resetTrigger}`}
            data={geoJsonData}
            style={getGeoJsonStyle}
            onEachFeature={onEachFeature}
          />
        )}

        {!isInariskFilter && !isPotensiFilter && weatherAlertProvinces.size > 0 && geoJsonData && (
          <GeoJSON
            key={`weather-${weatherAlertKey}`}
            data={geoJsonData}
            style={getWeatherGeoJsonStyle}
            onEachFeature={onEachWeatherFeature}
          />
        )}

        <MapController
          selectedOffice={selectedOffice}
          selectedAlert={selectedAlert}
          resetTrigger={resetTrigger}
          isSidebarCollapsed={isSidebarCollapsed}
          zoom={selectedOfficeId ? 9 : 7}
        />
        <MapEventsHandler onClearSelection={clearSelection} />

        {selectedOffice && nearestOffices.map(({ office }) => (
          <Polyline
            key={`line-${selectedOffice.id}-${office.id}`}
            positions={[[selectedOffice.latitude, selectedOffice.longitude], [office.latitude, office.longitude]]}
            pathOptions={{ color: '#0ea5e9', weight: 2, dashArray: '6, 6', opacity: 0.8 }}
          />
        ))}

        <AlertCircles alerts={visibleAlerts} onAlertSelect={onAlertSelect} provinceCentroids={provinceCentroids} />

        <KpwMarkers
          alerts={visibleAlerts}
          riskAlerts={riskAlerts}
          riskResults={riskResults}
          activeTypeFilter={activeTypeFilter}
          isKerentananView={isKerentananView}
          selectedProvinceId={selectedProvinceId}
          selectedOfficeId={selectedOfficeId}
          nearestOffices={nearestOffices}
          onProvinceSelect={onProvinceSelect}
          onOfficeSelect={onOfficeSelect}
          markerRefs={markerRefs}
          mapLayers={mapLayers}
          selectedAlertId={selectedAlertId}
        />

      </MapContainer>

      <NearestKpwPanel
        selectedOffice={selectedOffice}
        nearestOffices={nearestOffices}
        alerts={alerts}
        onAlertSelect={onAlertSelect}
        onProvinceSelect={onProvinceSelect}
        onOfficeSelect={onOfficeSelect}
      />

      <MapLegend
        isInariskFilter={isInariskFilter}
        isAirQualityFilter={activeTypeFilter === 'air_quality'}
        mapLayers={mapLayers}
        onToggleLayer={toggleLayer}
        selectedAlert={selectedAlert}
        allAlerts={allAlerts || alerts}
      />
    </div>
  );
};

export default EwsMap;

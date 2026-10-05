import React, { useState, useMemo } from 'react';
import { MEGATHRUST_ZONES } from '../../constants/megathrustZones';
import { RING_OF_FIRE_ARCS, VOLCANO_POINTS } from '../../constants/ringOfFire';
import { FlashOn as FlashOnIcon, Business as BusinessIcon } from '@mui/icons-material';
import GempaMapLegend from './map/GempaMapLegend';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { PROVINCES } from '../../constants/provinces';
import { distanceToPolyline } from '../../utils/geo';
import PerkiraanMap from './PerkiraanMap';
import MobileSplitter from '../ui/MobileSplitter';

function getMwColor(mw: number): string {
  if (mw >= 9.0) return '#dc2626';
  if (mw >= 8.7) return '#ea580c';
  if (mw >= 8.5) return '#d97706';
  return '#ca8a04';
}
function getMwLabel(mw: number): string {
  if (mw >= 9.0) return 'Sangat Besar';
  if (mw >= 8.7) return 'Besar';
  if (mw >= 8.5) return 'Signifikan';
  return 'Menengah';
}
function getMwBarPct(mw: number): number {
  return Math.min(100, Math.max(0, ((mw - 7.0) / 2.5) * 100));
}
const GempaView: React.FC = () => {
  const [selectedZoneId, setSelectedZoneId]       = useState<string | null>(null);
  const [selectedArcId, setSelectedArcId]         = useState<string | null>(null);
  const [selectedVolcanoName, setSelectedVolcanoName] = useState<string | null>(null);
  const [activeLayer, setActiveLayer]             = useState<'megathrust' | 'ringoffire'>('megathrust');
  const [showMegathrust, setShowMegathrust]       = useState<boolean>(true);
  const [showRingOfFire, setShowRingOfFire]       = useState<boolean>(true);

  const provincesMap = useMemo(() => new Map(PROVINCES.map((p) => [p.id, p])), []);

  const selectedZone = selectedZoneId ? MEGATHRUST_ZONES.find((z) => z.id === selectedZoneId) : null;

  // Megathrust: KPW within polyline radius
  const megathrustOfficesAtRisk = useMemo(() => {
    if (!selectedZone) return [];
    return KPWBI_OFFICES.filter((o) =>
      distanceToPolyline(o.latitude, o.longitude, selectedZone.path) <= selectedZone.impactRadiusKm
    );
  }, [selectedZone]);

  // Ring of Fire arcs: pre-compute all
  const arcOfficesAtRisk = useMemo(() =>
    new Map(RING_OF_FIRE_ARCS.map((arc) => [
      arc.id,
      KPWBI_OFFICES.filter((o) =>
        distanceToPolyline(o.latitude, o.longitude, arc.path) <= arc.impactRadiusKm
      ),
    ])), []);

  const handleMegathrustSelect = (id: string) => setSelectedZoneId((p) => (p === id ? null : id));
  const handleArcSelect    = (id: string)   => setSelectedArcId((p) => (p === id ? null : id));
  const handleVolcanoSelect = (name: string) => setSelectedVolcanoName((p) => (p === name ? null : name));

  return (
    <div className="perkiraan-tab-layout">
      <aside className="perkiraan-panel">
        <div className="perkiraan-panel-header">
          <span className="perkiraan-panel-title">Peta Seismik & Ring of Fire</span>
        </div>

        {/* Layer toggle */}
        <div className="gempa-layer-tabs">
          <button className={`gempa-layer-btn${activeLayer === 'megathrust' ? ' active' : ''}`} onClick={() => setActiveLayer('megathrust')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#a855f7', display: 'inline-block' }} />
            Zona Megathrust
          </button>
          <button className={`gempa-layer-btn${activeLayer === 'ringoffire' ? ' active' : ''}`} onClick={() => setActiveLayer('ringoffire')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#dc2626', display: 'inline-block' }} />
            Ring of Fire
          </button>
        </div>

        {/* ── MEGATHRUST ── */}
        {activeLayer === 'megathrust' && (
          <div className="perkiraan-panel-scroll">
            <div className="mt-section-header">
              <span>Segmen Megathrust Indonesia</span>
              <span className="mt-count-badge">{MEGATHRUST_ZONES.length} segmen</span>
            </div>

            {MEGATHRUST_ZONES.map((zone) => {
              const isSelected = selectedZoneId === zone.id;
              const color = getMwColor(zone.maxMagnitude);
              return (
                <div key={zone.id} className={`mt-zone-card${isSelected ? ' selected' : ''}`}>
                  <button className="mt-zone-card-btn" onClick={() => handleMegathrustSelect(zone.id)} aria-expanded={isSelected}>
                    <div className="mt-zone-accent" style={{ background: color }} />
                    <div className="mt-zone-body">
                      <div className="mt-zone-top">
                        <span className="mt-zone-name">{zone.name}</span>
                        <span className="mt-zone-mw-badge" style={{ color, borderColor: `${color}40`, background: `${color}15` }}>
                          Mw {zone.maxMagnitude}
                        </span>
                      </div>
                      <div className="mt-mw-bar-track">
                        <div className="mt-mw-bar-fill" style={{ width: `${getMwBarPct(zone.maxMagnitude)}%`, background: color }} />
                      </div>
                      <div className="mt-mw-bar-label">
                        <span style={{ color }}>{getMwLabel(zone.maxMagnitude)}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <FlashOnIcon style={{ fontSize: 12 }} /> Radius {zone.impactRadiusKm} km
                        </span>
                      </div>
                      <div className="mt-province-pills">
                        {zone.affectedProvinces.map((id) => (
                          <span key={id} className="mt-province-pill">{provincesMap.get(id)?.name ?? id}</span>
                        ))}
                      </div>
                    </div>
                    <svg className="mt-zone-chevron" style={{ transform: isSelected ? 'rotate(90deg)' : 'none' }}
                      viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  {isSelected && (
                    <div className="mt-kpw-panel">
                      <div className="mt-kpw-panel-header">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        KPw dalam radius {zone.impactRadiusKm} km
                      </div>
                      {megathrustOfficesAtRisk.length === 0 ? (
                        <p className="mt-kpw-empty">Tidak ada KPw dalam radius dampak ini.</p>
                      ) : (
                        <div className="mt-kpw-list">
                          {megathrustOfficesAtRisk.map((o) => (
                            <div key={o.id} className="mt-kpw-item">
                              <span className="mt-kpw-dot" />
                              <div>
                                <span className="mt-kpw-name">{o.name}</span>
                                <span className="mt-kpw-province">{provincesMap.get(o.provinceId)?.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── RING OF FIRE ── */}
        {activeLayer === 'ringoffire' && (
          <div className="perkiraan-panel-scroll">
            {/* Arcs */}
            <div className="mt-section-header">
              <span>Busur Vulkanik Aktif</span>
              <span className="mt-count-badge">{RING_OF_FIRE_ARCS.length} busur</span>
            </div>

            {RING_OF_FIRE_ARCS.map((arc) => {
              const isSelected = selectedArcId === arc.id;
              const offices = arcOfficesAtRisk.get(arc.id) ?? [];
              return (
                <div key={arc.id} className={`mt-zone-card${isSelected ? ' selected' : ''}`}>
                  <button className="mt-zone-card-btn" onClick={() => handleArcSelect(arc.id)} aria-expanded={isSelected}>
                    {/* Arc color swatch as accent */}
                    <div className="mt-zone-accent" style={{ background: arc.color }} />
                    <div className="mt-zone-body">
                      <div className="mt-zone-top">
                        <span className="mt-zone-name">{arc.name}</span>
                        <span className="mt-zone-mw-badge" style={{ color: arc.color, borderColor: `${arc.color}40`, background: `${arc.color}15` }}>
                          {arc.impactRadiusKm} km
                        </span>
                      </div>
                      <div className="mt-mw-bar-label" style={{ marginTop: 2 }}>
                        <span style={{ color: arc.color }}>Busur Ring of Fire</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <BusinessIcon style={{ fontSize: 12 }} /> {offices.length} KPw terdampak
                        </span>
                      </div>
                      {/* Province pills from impacted KPW */}
                      {offices.length > 0 && (
                        <div className="mt-province-pills">
                          {[...new Set(offices.map((o) => o.provinceId))].slice(0, 5).map((id) => (
                            <span key={id} className="mt-province-pill">{provincesMap.get(id)?.name ?? id}</span>
                          ))}
                          {[...new Set(offices.map((o) => o.provinceId))].length > 5 && (
                            <span className="mt-province-pill">+{[...new Set(offices.map((o) => o.provinceId))].length - 5}</span>
                          )}
                        </div>
                      )}
                    </div>
                    <svg className="mt-zone-chevron" style={{ transform: isSelected ? 'rotate(90deg)' : 'none' }}
                      viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                  {isSelected && (
                    <div className="mt-kpw-panel">
                      <div className="mt-kpw-panel-header">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        KPw dalam radius {arc.impactRadiusKm} km dari busur
                      </div>
                      {offices.length === 0 ? (
                        <p className="mt-kpw-empty">Tidak ada KPw dalam radius ini.</p>
                      ) : (
                        <div className="mt-kpw-list">
                          {offices.map((o) => (
                            <div key={o.id} className="mt-kpw-item">
                              <span className="mt-kpw-dot" style={{ background: arc.color }} />
                              <div>
                                <span className="mt-kpw-name">{o.name}</span>
                                <span className="mt-kpw-province">{provincesMap.get(o.provinceId)?.name}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Volcanoes */}
            <div className="mt-section-header" style={{ marginTop: 4 }}>
              <span>Gunung Api Pantauan</span>
              <span className="mt-count-badge">{VOLCANO_POINTS.length} gunung</span>
            </div>

            {VOLCANO_POINTS.map((v) => {
              const isSelected = selectedVolcanoName === v.name;
              const color = '#7c3aed';
              return (
                <div key={v.name} className={`mt-zone-card${isSelected ? ' selected' : ''}`}>
                  <button className="mt-zone-card-btn" onClick={() => handleVolcanoSelect(v.name)} aria-expanded={isSelected}>
                    <div className="mt-zone-accent" style={{ background: color }} />
                    <div className="mt-zone-body">
                      <div className="mt-zone-top">
                        <span className="mt-zone-name" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <span style={{ fontSize: 14 }}>🌋</span> G. {v.name}
                        </span>
                      </div>
                      <div className="mt-mw-bar-label" style={{ marginTop: 2 }}>
                        <span style={{ color }}>{provincesMap.get(v.provinceId)?.name ?? v.provinceId}</span>
                        <span>
                          {v.lat.toFixed(4)}, {v.lng.toFixed(4)}
                        </span>
                      </div>
                    </div>
                    <svg className="mt-zone-chevron" style={{ transform: isSelected ? 'rotate(90deg)' : 'none' }}
                      viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </aside>

      <MobileSplitter />

      <div className="perkiraan-map-wrap">
        <PerkiraanMap
          mode="gempa"
          selectedMegathrustId={selectedZoneId}
          onMegathrustSelect={handleMegathrustSelect}
          showMegathrust={showMegathrust}
          showRingOfFire={showRingOfFire}
        />
        <GempaMapLegend
          megathrust={showMegathrust}
          ringOfFire={showRingOfFire}
          onToggleMegathrust={() => setShowMegathrust((v) => !v)}
          onToggleRingOfFire={() => setShowRingOfFire((v) => !v)}
        />
      </div>
    </div>
  );
};

export default GempaView;

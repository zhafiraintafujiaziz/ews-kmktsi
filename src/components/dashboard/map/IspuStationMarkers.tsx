import { Marker, Pane, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import type { IspuStationInfo } from '../../../types';
import { getIspuStyle } from '../../../constants/ispuCategories';
import { useAlertField } from '../../../hooks/useAlerts';
import { IspuService } from '../../../services/ispuService';
import './IspuStationMarkers.css';

function createStationIcon(station: IspuStationInfo) {
  const style = getIspuStyle(station.category, station.ispuValue);
  const badge = document.createElement('span');
  badge.className = 'ispu-station-badge';
  badge.style.setProperty('--ispu-color', style.color);
  badge.style.color = style.textColor;
  badge.textContent = String(station.ispuValue);
  badge.setAttribute('aria-label', `ISPU ${station.ispuValue}, ${style.label}`);
  const width = Math.max(32, badge.textContent.length * 8 + 16);

  return L.divIcon({
    className: 'ispu-station-marker',
    html: badge,
    iconSize: [width, 24],
    iconAnchor: [width / 2, 38],
    popupAnchor: [0, -38],
    tooltipAnchor: [0, -38],
  });
}

export default function IspuStationMarkers() {
  // A successful feed may contain no alerts, but still publish new station readings.
  useAlertField('feedHealth');
  const stations = IspuService.getStations();

  return <Pane name="ispuStations" style={{ zIndex: 610 }}>
    {stations.map(station => {
      const style = getIspuStyle(station.category, station.ispuValue);
      const name = station.nama || station.idStasiun;
      return <Marker
        key={station.idStasiun}
        position={[station.latitude, station.longitude]}
        icon={createStationIcon(station)}
        title={`Stasiun SPKU ${name}`}
        bubblingMouseEvents={false}
      >
        <Tooltip pane="tooltipPane" direction="top">SPKU {name}</Tooltip>
        <Popup pane="popupPane" minWidth={240}>
          <div className="ews-popup-content">
            <div className="ews-popup-header" style={{ backgroundColor: style.color, color: style.textColor }}>
              Stasiun SPKU · ISPU {station.ispuValue}
            </div>
            <div className="ews-popup-title">{name}</div>
            <p>{[station.kota, station.provinsi].filter(Boolean).join(', ')}</p>
            <p className="ews-popup-desc">
              Kategori: <strong>{style.label}</strong><br />
              Polutan dominan: <strong>{station.dominantParam || 'Tidak tersedia'}</strong><br />
              Waktu pengamatan: {station.waktuText}
            </p>
            <div className="ews-popup-footer">Sumber: SPKU KemenLH</div>
          </div>
        </Popup>
      </Marker>;
    })}
  </Pane>;
}

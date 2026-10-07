import { CircleMarker, Polyline, Popup, Tooltip } from 'react-leaflet';
import { RING_OF_FIRE_ARCS } from '../../../constants/ringOfFire';
import { VOLCANO_REFERENCE_POINTS, VOLCANO_REFERENCE_SOURCE, VOLCANO_REFERENCE_RETRIEVED_AT } from '../../../constants/volcanoReferencePoints';

export default function VolcanoReferenceLayer() {
  return <>
    {RING_OF_FIRE_ARCS.map(arc => <Polyline
      key={arc.id}
      positions={arc.path}
      pathOptions={{ color: arc.color, weight: 3, dashArray: '8, 6', opacity: 0.8, bubblingMouseEvents: false }}
    >
      <Tooltip sticky>{arc.name}<br/>Sketsa Ring of Fire, bukan batas kawasan bahaya.</Tooltip>
    </Polyline>)}
    {VOLCANO_REFERENCE_POINTS.map(volcano => <CircleMarker
      key={volcano.id}
      center={[volcano.latitude, volcano.longitude]}
      radius={6}
      pathOptions={{ color: '#7c2d12', fillColor: '#fb923c', fillOpacity: 0.95, weight: 1.5, bubblingMouseEvents: false }}
    >
      <Tooltip direction="top">G. {volcano.name}<br/>{volcano.province}</Tooltip>
      <Popup><div className="ews-popup-content">
        <div className="ews-popup-title">G. {volcano.name}</div>
        <p>{volcano.province}<br/>{volcano.latitude.toFixed(4)}, {volcano.longitude.toFixed(4)}</p>
        <p>Titik sebaran gunung api. Bukan zona bahaya letusan atau prakiraan sebaran abu.</p>
        <a href={VOLCANO_REFERENCE_SOURCE} target="_blank" rel="noopener noreferrer">Sumber: MAGMA Indonesia / PVMBG</a>
        <p>Koordinat diambil {VOLCANO_REFERENCE_RETRIEVED_AT}.</p>
      </div></Popup>
    </CircleMarker>)}
  </>;
}

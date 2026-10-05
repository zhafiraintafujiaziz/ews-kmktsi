import React, { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { KpwbiOffice, DisasterAlert } from '../../../types';
import { KPWBI_OFFICES } from '../../../constants/kpwbiOffices';
import { isValidCoord } from '../../../utils/geo';

interface MapControllerProps {
  selectedOffice: KpwbiOffice | null;
  selectedAlert: DisasterAlert | null;
  resetTrigger?: number;
  isSidebarCollapsed?: boolean;
  zoom?: number;
}

const INDONESIA_CENTER: [number, number] = [-2.5489, 118.0149];
const DEFAULT_ZOOM = 5;
const DETAIL_ZOOM = 9;

const MapController: React.FC<MapControllerProps> = ({ selectedOffice, selectedAlert, resetTrigger, zoom }) => {
  const map = useMap();
  const prevResetTrigger = useRef(resetTrigger);

  useEffect(() => {
    const container = map.getContainer();
    let resizeFrame = 0;
    const updateSize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        if (container.clientWidth > 0 && container.clientHeight > 0) {
          map.invalidateSize({ animate: false, debounceMoveend: true });
        }
      });
    };

    // Measure after layout, including when a hidden map becomes visible.
    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(container);
    updateSize();

    return () => {
      resizeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
    };
  }, [map]);

  useEffect(() => {
    try {
      if (resetTrigger !== prevResetTrigger.current) {
        prevResetTrigger.current = resetTrigger;
        map.flyTo(INDONESIA_CENTER, DEFAULT_ZOOM, { duration: 1.5, animate: true });
        return;
      }

      if (selectedAlert) {
        if (isValidCoord(selectedAlert.latitude, selectedAlert.longitude)) {
          map.flyTo(
            [Number(selectedAlert.latitude), Number(selectedAlert.longitude)],
            DETAIL_ZOOM,
            { duration: 1.5, animate: true }
          );
        } else {
          const office = KPWBI_OFFICES.find((o) => o.provinceId === selectedAlert.provinceId);
          if (office && isValidCoord(office.latitude, office.longitude)) {
            map.flyTo([office.latitude, office.longitude], DETAIL_ZOOM, { duration: 1.5, animate: true });
          }
        }
      } else if (selectedOffice) {
        if (isValidCoord(selectedOffice.latitude, selectedOffice.longitude)) {
          map.flyTo([selectedOffice.latitude, selectedOffice.longitude], zoom ?? DETAIL_ZOOM, { duration: 1.5, animate: true });
        }
      } else if (map.getZoom() !== DEFAULT_ZOOM || !map.getCenter().equals(INDONESIA_CENTER)) {
        map.flyTo(INDONESIA_CENTER, DEFAULT_ZOOM, { duration: 1.5, animate: true });
      }
    } catch (err) {
      console.error('MapController flyTo error:', err);
    }
  }, [selectedOffice, selectedAlert, resetTrigger, zoom, map]);

  return null;
};

export default MapController;

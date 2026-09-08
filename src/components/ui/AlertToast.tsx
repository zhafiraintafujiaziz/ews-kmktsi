import { useState, useEffect, useCallback } from 'react';
import type { DisasterAlert } from '../../types';
import { PROVINCES } from '../../constants/provinces';
import { renderDisasterIcon } from '../../utils/alertUtils';
import './AlertToast.css';

export interface ToastItem {
  toastId: string;
  alert: DisasterAlert;
  nearestKpwName?: string;
  nearestKpwDistanceKm?: number;
}

interface AlertToastProps {
  toasts: ToastItem[];
  onDismiss: (toastId: string) => void;
}

const DURATION = 7000;

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'baru saja';
  if (mins < 60) return `${mins} mnt lalu`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs} jam lalu` : `${Math.floor(hrs / 24)} hari lalu`;
}

const TYPE_LABEL: Record<string, string> = {
  earthquake:    'Gempa Bumi',
  extreme_weather: 'Cuaca Ekstrem',
  karhutla:      'Kebakaran Hutan (Karhutla)',
  flood:         'Banjir',
  tsunami:       'Tsunami',
  volcanic:      'Gunung Api',
  volcanic_ash:  'Abu Vulkanik',
  kekeringan:    'Kekeringan',
  landslide:     'Tanah Longsor',
};

function SingleToast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const [exiting, setExiting] = useState(false);
  const { alert } = item;
  const province = PROVINCES.find((p) => p.id === alert.provinceId);

  const handleDismiss = useCallback(() => {
    setExiting(true);
    setTimeout(onDismiss, 260);
  }, [onDismiss]);

  useEffect(() => {
    const t = setTimeout(handleDismiss, DURATION);
    return () => clearTimeout(t);
  }, [handleDismiss]);

  const sub = [
    province?.name,
    alert.magnitude ? `M${alert.magnitude}` : null,
    alert.depth ? `kedalaman ${alert.depth} km` : null,
    alert.hotspotCount ? `${alert.hotspotCount} Titik Panas (Sangat Tinggi)` : null,
    item.nearestKpwName && item.nearestKpwDistanceKm !== undefined
      ? `📍 ±${item.nearestKpwDistanceKm} km dari ${item.nearestKpwName}`
      : null,
  ].filter(Boolean).join(' • ');

  return (
    <div className={`alert-toast${exiting ? ' exiting' : ''}`} role="alert" aria-live="assertive">
      <div className="toast-header">
        <span className="toast-severity-dot" />
        <span className="toast-severity-label">Peringatan Kritis</span>
        <button className="toast-dismiss-btn" onClick={handleDismiss} aria-label="Tutup">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="toast-body">
        <span className="toast-emoji">{renderDisasterIcon(alert.type)}</span>
        <div className="toast-info">
          <span className="toast-type">{TYPE_LABEL[alert.type] ?? alert.type}</span>
          <span className="toast-title">{alert.title}</span>
          {sub && <span className="toast-sub">{sub}</span>}
          <span className="toast-time">{timeAgo(alert.timestamp)}</span>
        </div>
      </div>

      <div className="toast-progress-bar">
        <div className="toast-progress-fill" style={{ animationDuration: `${DURATION}ms` }} />
      </div>
    </div>
  );
}

export function AlertToast({ toasts, onDismiss }: AlertToastProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack">
      {toasts.map((item) => (
        <SingleToast key={item.toastId} item={item} onDismiss={() => onDismiss(item.toastId)} />
      ))}
    </div>
  );
}

export default AlertToast;

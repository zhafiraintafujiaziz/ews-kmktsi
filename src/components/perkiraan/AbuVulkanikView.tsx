import React, { useEffect, useState } from 'react';
import { InaSiamService } from '../../services/inaSiamService';
import type { DisasterAlert } from '../../types';

const AbuVulkanikView: React.FC = () => {
  const [alerts, setAlerts] = useState<DisasterAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    let mounted = true;
    InaSiamService.fetchLiveAlerts()
      .then((records) => {
        if (!mounted) return;
        setAlerts(records);
        setAvailable(true);
        setLoading(false);
      })
      .catch(() => {
        if (!mounted) return;
        setAvailable(false);
        setLoading(false);
      });
    return () => { mounted = false; };
  }, []);

  return (
    <div className="abu-vulkanik-container" style={{ padding: 16, overflowY: 'auto', height: '100%' }}>
      <h2>Sebaran Abu Vulkanik</h2>
      {loading ? <p>Memuat SIGMET aktif…</p> : null}
      {!loading && (!available || alerts.length === 0) ? <p role="status">Current data unavailable</p> : null}
      {alerts.map((alert) => (
        <article key={alert.id} className="perkiraan-panel" style={{ padding: 16, marginBottom: 12 }}>
          <h3>{alert.title}</h3>
          <p>{alert.description}</p>
          <p>Valid: {alert.validFrom} – {alert.validUntil}</p>
          {alert.latitude !== undefined && alert.longitude !== undefined
            ? <p>Area center: {alert.latitude.toFixed(4)}, {alert.longitude.toFixed(4)}</p>
            : null}
          {alert.ashHeight ? <p>Flight level: {alert.ashHeight}</p> : null}
          {alert.movementDirection ? <p>Movement: {alert.movementDirection}</p> : null}
        </article>
      ))}
    </div>
  );
};

export default AbuVulkanikView;

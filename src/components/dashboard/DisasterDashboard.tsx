import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAlerts } from '../../hooks/useAlerts';
import { useDisasterAlert } from '../../hooks/useDisasterAlert';
import type { AlertSeverity, DisasterType } from '../../types';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { haversineDistance } from '../../utils/geo';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import EwsMap from './EwsMap';
import AlertToast from '../ui/AlertToast';
import type { ToastItem } from '../ui/AlertToast';
import MobileSplitter from '../ui/MobileSplitter';
import './DisasterDashboard.css';

interface DisasterDashboardProps {
  onSwitchToKerentanan: () => void;
  onSwitchToPerkiraan: () => void;
}

export const DisasterDashboard: React.FC<DisasterDashboardProps> = ({
  onSwitchToKerentanan,
  onSwitchToPerkiraan
}) => {
  const { alerts, isLoading, loadingSources } = useAlerts();
  const { activeAlerts, riskResults } = useDisasterAlert();

  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<DisasterType | 'all'>('all');

  const [selectedProvinceId, setSelectedProvinceId] = useState<string | null>(null);
  const [selectedOfficeId, setSelectedOfficeId] = useState<string | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
  const effectiveSidebarCollapsed = isSidebarCollapsed && !isMobile;

  useEffect(() => {
    const media = window.matchMedia('(max-width: 768px)');
    const handleChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const shownAlertIds = useRef<Set<string>>(new Set());

  // Display window only. The fetch keeps the longer history.
  const [minTimestamp] = useState(() => Date.now() - 3 * 24 * 3600 * 1000);

  const recentAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (a.isForecast) return false;
      return new Date(a.timestamp).getTime() >= minTimestamp;
    });
  }, [alerts, minTimestamp]);

  const todayActiveAlerts = useMemo(() => {
    return activeAlerts.filter((calc) => {
      const alert = alerts.find((a) => a.id === calc.event.id);
      if (!alert) return false;
      return new Date(alert.timestamp).getTime() >= minTimestamp;
    });
  }, [activeAlerts, alerts, minTimestamp]);

  useEffect(() => {
    if (isLoading) return;
    const unseen = todayActiveAlerts.filter(
      (calc) => !shownAlertIds.current.has(calc.event.id)
    );
    unseen.forEach((calc) => shownAlertIds.current.add(calc.event.id));
    if (unseen.length === 0) return;
    // Show max 4; stagger by 350 ms so they don't all pop at once
    unseen.slice(0, 4).forEach((calc, i) => {
      const alert = alerts.find((a) => a.id === calc.event.id);
      if (!alert) return;

      const nearestLoc = calc.affectedLocations[0];
      let nearestKpwName: string | undefined;
      let nearestKpwDistanceKm: number | undefined;

      if (nearestLoc && alert.latitude != null && alert.longitude != null) {
        nearestKpwName = nearestLoc.name;
        nearestKpwDistanceKm = Math.round(
          haversineDistance(alert.latitude, alert.longitude, nearestLoc.latitude, nearestLoc.longitude)
        );
      }

      setTimeout(() => {
        setToasts((prev) => [
          ...prev,
          {
            toastId: `${alert.id}-${Date.now()}`,
            alert,
            nearestKpwName,
            nearestKpwDistanceKm,
          },
        ]);
      }, i * 350);
    });
  }, [todayActiveAlerts, alerts, isLoading]);

  const dismissToast = useCallback((toastId: string) => {
    setToasts((prev) => prev.filter((t) => t.toastId !== toastId));
  }, []);

  const calculatedCriticalAlerts = useMemo(() => {
    return recentAlerts.filter((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      const riskRes = riskResults.find((r) => r.event.id === a.id);
      if (riskRes) return riskRes.riskLevel === 'Tinggi';
      return a.severity === 3;
    });
  }, [recentAlerts, riskResults, typeFilter]);

  const filteredAlerts = useMemo(() => {
    return recentAlerts.filter((a) => {
      const riskRes = riskResults.find((r) => r.event.id === a.id);
      const effectiveRiskLevel = riskRes 
        ? riskRes.riskLevel 
        : (a.severity === 3 ? 'Tinggi' : a.severity === 2 ? 'Sedang' : 'Rendah');

      if (severityFilter !== 'all') {
        const mappedRiskLevel = { 3: 'Tinggi', 2: 'Sedang', 1: 'Rendah' }[severityFilter];
        if (effectiveRiskLevel !== mappedRiskLevel) return false;
      }

      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      return true;
    });
  }, [recentAlerts, riskResults, severityFilter, typeFilter]);

  const filteredStats = useMemo(() => {
    const stats: Record<AlertSeverity | 'total', number> = { 3: 0, 2: 0, 1: 0, total: 0 };

    recentAlerts.forEach((a) => {
      if (typeFilter !== 'all' && a.type !== typeFilter) return;

      const riskRes = riskResults.find((r) => r.event.id === a.id);
      const effectiveRiskLevel = riskRes 
        ? riskRes.riskLevel 
        : (a.severity === 3 ? 'Tinggi' : a.severity === 2 ? 'Sedang' : 'Rendah');

      if (effectiveRiskLevel === 'Tinggi') stats[3]++;
      else if (effectiveRiskLevel === 'Sedang') stats[2]++;
      else if (effectiveRiskLevel === 'Rendah') stats[1]++;
      stats.total++;
    });

    if (severityFilter !== 'all') {
      const activeVal = stats[severityFilter];
      stats[3] = 0; stats[2] = 0; stats[1] = 0;
      stats.total = activeVal;
      stats[severityFilter] = activeVal;
    }

    return stats;
  }, [recentAlerts, riskResults, severityFilter, typeFilter]);

  const handleProvinceSelect = (provinceId: string) => {
    setSelectedProvinceId(provinceId);
    setSelectedOfficeId(null);
    setSelectedAlertId(null);
  };

  const handleOfficeSelect = (officeId: string) => {
    setSelectedOfficeId(officeId);
    const office = KPWBI_OFFICES.find((o) => o.id === officeId);
    if (office) setSelectedProvinceId(office.provinceId);
    setSelectedAlertId(null);
  };

  const handleAlertSelect = (alertId: string) => {
    setSelectedAlertId(alertId);
    setSelectedOfficeId(null);
    const alert = alerts.find((a) => a.id === alertId);
    if (alert) setSelectedProvinceId(alert.provinceId);
  };

  return (
    <div className="dashboard-container">
      <TopBar
        criticalCount={filteredStats[3]}
        totalAlerts={filteredAlerts.length}
        criticalAlerts={calculatedCriticalAlerts}
        allAlerts={recentAlerts}
        riskAlerts={filteredAlerts}
        riskResults={riskResults}
        onAlertSelect={handleAlertSelect}
        selectedType={typeFilter}
        onTypeChange={setTypeFilter}
        onSwitchToKerentanan={onSwitchToKerentanan}
        onSwitchToPerkiraan={onSwitchToPerkiraan}
      />

      <div className="dashboard-content">
        <Sidebar
          filteredAlerts={filteredAlerts}
          riskResults={riskResults}
          stats={filteredStats}
          selectedOfficeId={selectedOfficeId}
          onProvinceSelect={handleProvinceSelect}
          onOfficeSelect={handleOfficeSelect}
          selectedAlertId={selectedAlertId}
          onAlertSelect={handleAlertSelect}
          severityFilter={severityFilter}
          setSeverityFilter={setSeverityFilter}
          typeFilter={typeFilter}
          setTypeFilter={setTypeFilter}
          isLoading={isLoading}
          loadingSources={loadingSources}
          isCollapsed={effectiveSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((c) => !c)}
        />

        <MobileSplitter />

        <EwsMap
          alerts={typeFilter === 'all' ? recentAlerts : recentAlerts.filter((a) => a.type === typeFilter)}
          allAlerts={recentAlerts}
          riskAlerts={filteredAlerts}
          riskResults={riskResults}
          selectedProvinceId={selectedProvinceId}
          selectedOfficeId={selectedOfficeId}
          selectedAlertId={selectedAlertId}
          onProvinceSelect={handleProvinceSelect}
          onOfficeSelect={handleOfficeSelect}
          onAlertSelect={handleAlertSelect}
          activeTypeFilter={typeFilter}
          isSidebarCollapsed={effectiveSidebarCollapsed}
        />
      </div>

      <AlertToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default DisasterDashboard;

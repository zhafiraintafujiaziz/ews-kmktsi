import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useAlerts } from '../../hooks/useAlerts';
import { useDisasterAlert } from '../../hooks/useDisasterAlert';
import type { AlertSeverity, DisasterType } from '../../types';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { haversineDistance } from '../../utils/geo';
import TopBar from './TopBar';
import Sidebar from './Sidebar';
import EwsMap from './EwsMap';
import ReportModal from './ReportModal';
import AlertToast from '../ui/AlertToast';
import type { ToastItem } from '../ui/AlertToast';
import LaporanSidebar from './LaporanSidebar';
import MobileSplitter from '../ui/MobileSplitter';
import './DisasterDashboard.css';
import './LaporanSidebar.css';

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
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isLaporanOpen, setIsLaporanOpen] = useState(false);

  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const shownAlertIds = useRef<Set<string>>(new Set());

  // Today's date data ONLY — alerts older than today (00:00:00 local time) are excluded
  const minTimestamp = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

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
    return alerts.filter((a) => {
      if (a.isForecast) return false;
      if (new Date(a.timestamp).getTime() < minTimestamp) return false;
      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      const riskRes = riskResults.find((r) => r.event.id === a.id);
      return riskRes && riskRes.riskLevel === 'Tinggi';
    });
  }, [alerts, riskResults, typeFilter, minTimestamp]);

  const filteredAlerts = useMemo(() => {
    return alerts.filter((a) => {
      if (a.isForecast) return false;
      if (new Date(a.timestamp).getTime() < minTimestamp) return false;

      const riskRes = riskResults.find((r) => r.event.id === a.id);
      if (!riskRes) return false;

      if (severityFilter !== 'all') {
        const mappedRiskLevel = { 3: 'Tinggi', 2: 'Sedang', 1: 'Rendah' }[severityFilter];
        if (riskRes.riskLevel !== mappedRiskLevel) return false;
      }

      if (typeFilter !== 'all' && a.type !== typeFilter) return false;
      return true;
    });
  }, [alerts, riskResults, severityFilter, typeFilter, minTimestamp]);

  const filteredStats = useMemo(() => {
    const stats: Record<AlertSeverity | 'total', number> = { 3: 0, 2: 0, 1: 0, total: 0 };

    alerts.forEach((a) => {
      if (a.isForecast) return;
      if (new Date(a.timestamp).getTime() < minTimestamp) return;
      if (typeFilter !== 'all' && a.type !== typeFilter) return;

      const riskRes = riskResults.find((r) => r.event.id === a.id);
      if (riskRes) {
        if (riskRes.riskLevel === 'Tinggi') stats[3]++;
        else if (riskRes.riskLevel === 'Sedang') stats[2]++;
        else if (riskRes.riskLevel === 'Rendah') stats[1]++;
        stats.total++;
      }
    });

    if (severityFilter !== 'all') {
      const activeVal = stats[severityFilter];
      stats[3] = 0; stats[2] = 0; stats[1] = 0;
      stats.total = activeVal;
      stats[severityFilter] = activeVal;
    }

    return stats;
  }, [alerts, riskResults, severityFilter, typeFilter, minTimestamp]);

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
        allAlerts={filteredAlerts}
        riskResults={riskResults}
        onAlertSelect={handleAlertSelect}
        onGenerateReport={() => setIsReportOpen(true)}
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
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((c) => !c)}
        />

        <MobileSplitter />

        <EwsMap
          alerts={filteredAlerts}
          riskResults={riskResults}
          selectedProvinceId={selectedProvinceId}
          selectedOfficeId={selectedOfficeId}
          selectedAlertId={selectedAlertId}
          onProvinceSelect={handleProvinceSelect}
          onOfficeSelect={handleOfficeSelect}
          onAlertSelect={handleAlertSelect}
          activeTypeFilter={typeFilter}
          isSidebarCollapsed={isSidebarCollapsed}
        />

        {/* Laporan KPw right sidebar */}
        <div className={`laporan-sidebar${isLaporanOpen ? ' open' : ''}`}>
          <button
            className="laporan-sidebar-toggle"
            onClick={() => setIsLaporanOpen((o) => !o)}
            title={isLaporanOpen ? 'Tutup Laporan KPw' : 'Buka Laporan KPw'}
          >
            <svg
              viewBox="0 0 24 24" width="14" height="14" fill="none"
              stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              style={{ transform: isLaporanOpen ? 'none' : 'rotate(180deg)', transition: 'transform 0.2s' }}
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
            <span className="laporan-sidebar-label">Laporan Satgas Satker Terdampak</span>
          </button>
          {isLaporanOpen && <LaporanSidebar />}
        </div>
      </div>

      <ReportModal
        isOpen={isReportOpen}
        onClose={() => setIsReportOpen(false)}
        alerts={alerts}
      />

      <AlertToast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default DisasterDashboard;

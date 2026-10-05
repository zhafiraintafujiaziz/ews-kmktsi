import React, { useState, useMemo } from 'react';
import type { DisasterAlert, KpwbiOffice, AlertSeverity } from '../../types';
import { renderDisasterIcon } from '../../utils/alertUtils';
import { CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { isOfficeAffectedByAlert } from '../../utils/disasterImpact';
import { haversineDistance } from '../../utils/geo';
import { BnpbInariskService } from '../../services/bnpbInariskService';
import {
  mapAlertToDisasterEvent,
  mapInariskToVulnerability,
  mapDisasterTypeToInariskHazard,
  vulnerabilityToScore,
  getRiskLevel,
} from '../../utils/riskCalculator';
import * as XLSX from 'xlsx';

interface ReportModalProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: DisasterAlert[];
}

interface ImpactedRecord {
  office: KpwbiOffice;
  alert: DisasterAlert;
  distanceKm: number | null;
  riskLevel: string;
  vulnerabilityIndex?: number;
  riskScore?: number;
}

export const ReportModal: React.FC<ReportModalProps> = ({ isOpen, onClose, alerts }) => {
  // Set default start date to 7 days ago and end date to now
  const defaultStartDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 16); // format: YYYY-MM-DDTHH:MM
  }, []);

  const defaultEndDate = useMemo(() => {
    return new Date().toISOString().slice(0, 16);
  }, []);

  const [startDate, setStartDate] = useState<string>(defaultStartDate);
  const [endDate, setEndDate] = useState<string>(defaultEndDate);
  const [report, setReport] = useState<{
    totalAlerts: number;
    earthquakes: number;
    otherDisasters: number;
    severityBreakdown: Record<AlertSeverity, number>;
    impactedOffices: ImpactedRecord[];
    allAlertsInRange: DisasterAlert[];
  } | null>(null);

  if (!isOpen) return null;

  const generateReportData = (startStr: string, endStr: string) => {
    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime();

    // 1. Filter alerts within range
    const filtered = alerts.filter((alert) => {
      const time = new Date(alert.timestamp).getTime();
      return time >= start && time <= end;
    });

    // 2. Counts
    const earthquakes = filtered.filter((a) => a.type === 'earthquake');
    const otherDisasters = filtered.filter((a) => a.type !== 'earthquake');

    const severityBreakdown = earthquakes.reduce(
      (acc, curr) => {
        acc[curr.severity]++;
        return acc;
      },
      { 3: 0, 2: 0, 1: 0 } as Record<AlertSeverity, number>
    );

    // 3. Find impacted KPW offices
    const impactedOffices: ImpactedRecord[] = [];
    KPWBI_OFFICES.forEach((office) => {
      filtered.forEach((alert) => {
        if (isOfficeAffectedByAlert(office, alert)) {
          const distanceKm =
            alert.latitude !== undefined && alert.longitude !== undefined
              ? haversineDistance(office.latitude, office.longitude, alert.latitude, alert.longitude)
              : null;
          
          let riskLevelStr = '-';
          let vulIndex: number | undefined;
          let rScoreVal: number | undefined;
          const event = mapAlertToDisasterEvent(alert);
          if (event) {
            const kerentananDisasters = ['flood', 'tsunami', 'kekeringan', 'volcanic', 'volcanic_ash'];
            const isKerentananSupported = kerentananDisasters.includes(event.type);
            if (isKerentananSupported) {
              const hazard = mapDisasterTypeToInariskHazard(event.type);
              const index = BnpbInariskService.getLocalHazardIndex(office.id, hazard);
              if (index !== null) {
                const vulLevel = mapInariskToVulnerability(index);
                const vulScore = vulnerabilityToScore(vulLevel);
                vulIndex = index;
                const rScore = event.disasterScore * vulScore;
                rScoreVal = rScore;
                riskLevelStr = getRiskLevel(rScore);
              }
            }
          }

          impactedOffices.push({
            office,
            alert,
            distanceKm,
            riskLevel: riskLevelStr,
            vulnerabilityIndex: vulIndex,
            riskScore: rScoreVal,
          });
        }
      });
    });

    // Sort impacted offices by alert severity, then distance
    impactedOffices.sort((a, b) => {
      const sevDiff = (b.alert.severity || 0) - (a.alert.severity || 0);
      if (sevDiff !== 0) return sevDiff;
      return (a.distanceKm || 0) - (b.distanceKm || 0);
    });

    // Sort all alerts by timestamp descending (newest first)
    const sortedFiltered = [...filtered].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    setReport({
      totalAlerts: filtered.length,
      earthquakes: earthquakes.length,
      otherDisasters: otherDisasters.length,
      severityBreakdown,
      impactedOffices,
      allAlertsInRange: sortedFiltered,
    });
  };

  const handleGenerateReport = () => {
    generateReportData(startDate, endDate);
  };

  const handleQuickPick = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);

    const startStr = start.toISOString().slice(0, 16);
    const endStr = end.toISOString().slice(0, 16);

    setStartDate(startStr);
    setEndDate(endStr);

    generateReportData(startStr, endStr);
  };

  const handleExportExcel = () => {
    if (!report) return;

    const SEVERITY_NUM: Record<string, number> = { 3: 3, 2: 2, 1: 1 };

    // Create a new workbook
    const wb = XLSX.utils.book_new();

    // 1. Summary Sheet
    const summaryData = [
      ["REPORTING DISASTER & KPW IMPACT"],
      [`Range Waktu: ${startDate.replace('T', ' ')} s.d ${endDate.replace('T', ' ')}`],
      [],
      ["SUMMARY STATS"],
      ["Metric", "Value"],
      ["Total Alerts", report.totalAlerts],
      ["Gempa Bumi", report.earthquakes],
      ["Bencana Lainnya", report.otherDisasters],
      ["Gempa Level 3", report.severityBreakdown[3]],
      ["Gempa Level 2", report.severityBreakdown[2]],
      ["Gempa Level 1", report.severityBreakdown[1]],
    ];
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    // 2. KPW Impacted Sheet
    const impactedHeaders = [
      "KPW Office", "City", "Disaster Title", "Type", "Severity", "Indeks Kerentanan", "Skor Risiko", "Tingkat Risiko", "Distance (km)", "Time"
    ];
    const impactedRows = report.impactedOffices.map(({ office, alert, distanceKm, riskLevel, vulnerabilityIndex, riskScore }) => [
      office.name,
      office.city,
      alert.title,
      alert.type,
      SEVERITY_NUM[alert.severity] || alert.severity,
      vulnerabilityIndex !== undefined ? vulnerabilityIndex : '-',
      riskScore !== undefined ? Math.round(riskScore) : '-',
      riskLevel,
      distanceKm !== null ? Number(distanceKm.toFixed(1)) : '-',
      new Date(alert.timestamp).toLocaleString('id-ID')
    ]);
    const wsImpacted = XLSX.utils.aoa_to_sheet([impactedHeaders, ...impactedRows]);
    XLSX.utils.book_append_sheet(wb, wsImpacted, "KPW Impacted");

    // 3. All Disasters Sheet
    const disasterHeaders = [
      "Time", "Disaster Title", "Type", "Severity", "Magnitude", "Depth (km)", "Area"
    ];
    const disasterRows = report.allAlertsInRange.map((alert) => [
      new Date(alert.timestamp).toLocaleString('id-ID'),
      alert.title,
      alert.type,
      alert.severity,
      alert.magnitude !== undefined ? alert.magnitude : '-',
      alert.depth !== undefined ? alert.depth : '-',
      alert.affectedArea || alert.description || ''
    ]);
    const wsDisasters = XLSX.utils.aoa_to_sheet([disasterHeaders, ...disasterRows]);
    XLSX.utils.book_append_sheet(wb, wsDisasters, "All Disasters");

    // Write workbook and download as .xlsx
    XLSX.writeFile(wb, `disaster_report_${startDate.split('T')[0]}_to_${endDate.split('T')[0]}.xlsx`);
  };

  return (
    <div className="report-modal-overlay" onClick={onClose}>
      <div className="report-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="report-modal-header">
          <div className="report-modal-title-area">
            <span className="report-modal-icon">📊</span>
            <h2>Disaster & KPW Impact Reporting</h2>
          </div>
          <button className="report-modal-close-btn" onClick={onClose}>
            &times;
          </button>
        </div>

        {/* Inputs Section */}
        <div className="report-modal-inputs">
          <div className="inputs-row">
            <div className="input-group">
              <label>Waktu Mulai (Start Time)</label>
              <input
                type="datetime-local"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="input-group">
              <label>Waktu Selesai (End Time)</label>
              <input
                type="datetime-local"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <button className="generate-report-btn" onClick={handleGenerateReport}>
              Generate Report
            </button>
          </div>
          
          <div className="quick-picks-row">
            <span className="quick-picks-label">Quick Pick:</span>
            <button className="quick-pick-btn" onClick={() => handleQuickPick(7)}>Last Week</button>
            <button className="quick-pick-btn" onClick={() => handleQuickPick(30)}>Last Month</button>
            <button className="quick-pick-btn" onClick={() => handleQuickPick(365)}>Last Year</button>
            <button className="quick-pick-btn" onClick={() => handleQuickPick(365 * 3)}>Last 3Y</button>
            <button className="quick-pick-btn" onClick={() => handleQuickPick(365 * 5)}>Last 5Y</button>
          </div>
        </div>

        {/* Results Area */}
        <div className="report-modal-results">
          {report ? (
            <div className="report-container">
              {/* Export Button */}
              <div className="report-export-row">
                <h3>Hasil Laporan</h3>
                <button className="export-report-btn" onClick={handleExportExcel}>
                  📥 Export to Excel
                </button>
              </div>

              {/* Grid Summary */}
              <div className="report-summary-grid">
                <div className="summary-card">
                  <div className="summary-val">{report.totalAlerts}</div>
                  <div className="summary-lbl">Total Kejadian</div>
                </div>
                <div className="summary-card">
                  <div className="summary-val">{report.earthquakes}</div>
                  <div className="summary-lbl">Gempa Bumi</div>
                </div>
                <div className="summary-card">
                  <div className="summary-val">{report.otherDisasters}</div>
                  <div className="summary-lbl">Bencana Lainnya</div>
                </div>
              </div>



              {/* Impacted KPW Offices List */}
              <div className="impacted-offices-section">
                <h4>KPwBI Terdampak (Geographically Impacted Offices)</h4>
                {report.impactedOffices.length > 0 ? (
                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Kantor Perwakilan</th>
                          <th>Kota</th>
                          <th>Disaster</th>
                          <th style={{ textAlign: 'center' }}>Keparahan ([H]azard)</th>
                          <th style={{ textAlign: 'center' }}>Kerentanan ([V]ulnerability)</th>
                          <th style={{ textAlign: 'center' }}>Risiko ([R]isk)</th>
                          <th style={{ textAlign: 'center' }}>Tingkat Risiko</th>
                          <th>Jarak Epicenter</th>
                          <th>Waktu</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.impactedOffices.map(({ office, alert, distanceKm, vulnerabilityIndex, riskScore, riskLevel }, idx) => (
                          <tr key={`${office.id}-${alert.id}-${idx}`}>
                            <td className="font-semibold">{office.name}</td>
                            <td>{office.city}</td>
                            <td>
                              <span className="disaster-tag font-semibold" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                {renderDisasterIcon(alert.type, undefined, { width: '14px', height: '14px' })}
                                <span>{alert.title}</span>
                              </span>
                            </td>
                            <td style={{ textAlign: 'center' }}>
                              {alert.severity}
                            </td>
                            <td style={{ textAlign: 'center' }}>{vulnerabilityIndex !== undefined ? vulnerabilityIndex : '-'}</td>
                             <td className='font-semibold' style={{ textAlign: 'center' }}>{riskScore !== undefined ? Math.round(riskScore) : '-'}</td>
                            <td style={{ textAlign: 'center' }}>
                              <span className={`severity-tag ${riskLevel === 'Tinggi' ? 'critical' : riskLevel === 'Sedang' ? 'warning' : 'watch'}`}>
                                {riskLevel}
                              </span>
                            </td>
                            <td className="font-semibold">
                              {distanceKm !== null ? `${distanceKm.toFixed(1)} km` : '-'}
                            </td>
                            <td className="time-col">
                              {new Date(alert.timestamp).toLocaleDateString('id-ID', {
                                day: 'numeric',
                                month: 'short',
                              })}{' '}
                              {new Date(alert.timestamp).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-report-state" style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
                    <CheckCircleIcon style={{ fontSize: 16, color: '#22c55e', flexShrink: 0 }} />
                    <span>Tidak ada Kantor Perwakilan (KPW) Bank Indonesia yang terdampak radius kebencanaan pada periode ini.</span>
                  </div>
                )}
              </div>

              {/* List of All Disasters / Earthquakes in Period */}
              <div className="all-disasters-section">
                <h4>Daftar Kejadian Gempa Bumi & Bencana (Disaster Incidents List)</h4>
                {report.allAlertsInRange.length > 0 ? (
                  <div className="report-table-wrapper">
                    <table className="report-table">
                      <thead>
                        <tr>
                          <th>Waktu</th>
                          <th>Judul Bencana</th>
                          <th>Tipe</th>
                          <th style={{ textAlign: 'center' }}>Tingkat Keparahan</th>
                          <th style={{ textAlign: 'center' }}>Kekuatan</th>
                          <th>Kedalaman</th>
                          <th>Area / Wilayah</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.allAlertsInRange.map((alert) => (
                          <tr key={alert.id}>
                            <td className="time-col">
                              {new Date(alert.timestamp).toLocaleDateString('id-ID', {
                                day: 'numeric',
                                month: 'short',
                                year: 'numeric',
                              })}{' '}
                              {new Date(alert.timestamp).toLocaleTimeString('id-ID', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                            <td className="font-semibold">{alert.title}</td>
                            <td style={{ textTransform: 'capitalize' }}>{alert.type}</td>
                            <td className="font-semibold" style={{ textAlign: 'center' }}>
                              {alert.severity}
                            </td>
                            <td className="font-semibold" style={{ textAlign: 'center' }}>
                              {alert.magnitude !== undefined ? `${alert.magnitude} M` : '-'}
                            </td>
                            <td>
                              {alert.depth !== undefined ? `${alert.depth} km` : '-'}
                            </td>
                            <td>{alert.affectedArea || alert.description}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-report-state">
                    Tidak ada kejadian bencana dalam periode ini.
                  </div>
                )}
              </div>

            </div>
          ) : (
            <div className="report-prompt">
              Silakan pilih range waktu di atas dan klik <strong>Generate Report</strong> untuk menampilkan statistik dampak bencana.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportModal;

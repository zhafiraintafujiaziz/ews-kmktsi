import type { DisasterAlert, DisasterType, KpwbiOffice, RiskLevel } from '../types';
import { PROVINCES } from '../constants/provinces';
import { isOfficeAffectedByAlert } from './disasterImpact';
import { compareOfficeAlertRisk, scoreAlertForOffice, type OfficeAlertRisk } from './riskCalculator';

export interface OfficeHazardSummary {
  type: DisasterType;
  risks: OfficeAlertRisk[];
  totalScore: number | null;
  riskLevel: RiskLevel | null;
}

export interface OfficeRiskSummary {
  office: KpwbiOffice;
  hazards: OfficeHazardSummary[];
  totalScore: number | null;
  riskLevel: RiskLevel | null;
  alertCount: number;
}

/** Keep unscored impacts visible; office and hazard scores use the highest event score. */
export function buildOfficeRiskSummaries(offices: KpwbiOffice[], alerts: DisasterAlert[]): OfficeRiskSummary[] {
  return offices.map((office) => {
    const risks = alerts.filter((alert) => isOfficeAffectedByAlert(office, alert))
      .map((alert) => scoreAlertForOffice(office.id, alert, office))
      .sort((a, b) => compareOfficeAlertRisk(b, a)
        || b.alert.severity - a.alert.severity
        || Date.parse(b.alert.timestamp) - Date.parse(a.alert.timestamp)
        || a.alert.id.localeCompare(b.alert.id));
    const groups = new Map<DisasterType, OfficeAlertRisk[]>();
    for (const risk of risks) {
      const group = groups.get(risk.alert.type) ?? [];
      group.push(risk);
      groups.set(risk.alert.type, group);
    }
    const hazards = [...groups].map(([type, group]) => ({
      type, risks: group, totalScore: group[0].totalScore, riskLevel: group[0].riskLevel,
    }));
    return {
      office, hazards, totalScore: risks[0]?.totalScore ?? null,
      riskLevel: risks[0]?.riskLevel ?? null, alertCount: risks.length,
    };
  }).sort((a, b) => (b.totalScore ?? -1) - (a.totalScore ?? -1)
    || b.hazards.length - a.hazards.length
    || b.alertCount - a.alertCount
    || a.office.name.localeCompare(b.office.name, 'id')
    || a.office.id.localeCompare(b.office.id));
}

export type OfficeRiskFilter = 'all' | 'affected' | 'multiple' | 'unscored' | 'unaffected' | RiskLevel;

export function filterOfficeRiskSummaries(
  summaries: OfficeRiskSummary[],
  filters: { search?: string; provinceId?: string; risk?: OfficeRiskFilter },
): OfficeRiskSummary[] {
  const search = filters.search?.trim().toLowerCase() ?? '';
  return summaries.filter((summary) => {
    const { office, hazards, alertCount, totalScore, riskLevel } = summary;
    if (filters.provinceId && filters.provinceId !== 'all' && office.provinceId !== filters.provinceId) return false;
    const provinceName = PROVINCES.find(province => province.id === office.provinceId)?.name ?? '';
    if (search && ![office.name, office.city, office.region, provinceName].some(value => value.toLowerCase().includes(search))) return false;
    switch (filters.risk) {
      case 'affected': return alertCount > 0;
      case 'multiple': return hazards.length > 1;
      case 'unscored': return alertCount > 0 && totalScore === null;
      case 'unaffected': return alertCount === 0;
      case 'Tinggi': case 'Sedang': case 'Rendah': return riskLevel === filters.risk;
      default: return true;
    }
  });
}

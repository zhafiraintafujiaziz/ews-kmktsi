import { useMemo } from 'react';
import { useAlerts } from './useAlerts';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import type { MarkedLocation, RiskCalcResult } from '../types';
import { buildAlertRiskResult } from '../utils/riskCalculator';
import { useInariskRevision } from './useInariskRevision';
export const useDisasterAlert = () => {
  const { alerts, isLoading } = useAlerts();
  const assessmentRevision = useInariskRevision();
  const markedLocations = useMemo<MarkedLocation[]>(() => KPWBI_OFFICES.map(office => ({ id: office.id, name: office.name, latitude: office.latitude, longitude: office.longitude })), []);
  const riskResults = useMemo<RiskCalcResult[]>(() => {
    if (isLoading) return [];
    return alerts.flatMap(alert => { const result = buildAlertRiskResult(alert, KPWBI_OFFICES); return result ? [result] : []; });
    // The external assessment caches publish independently of alerts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, isLoading, assessmentRevision]);
  const activeAlerts = useMemo(() => riskResults.filter(result => result.shouldAlert), [riskResults]);
  return { riskResults, activeAlerts, hasActiveAlert: activeAlerts.length > 0, markedLocations };
};

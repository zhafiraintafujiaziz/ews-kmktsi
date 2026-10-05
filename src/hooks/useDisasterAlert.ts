import { useMemo } from 'react';
import { useAlerts } from './useAlerts';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { BnpbInariskService } from '../services/bnpbInariskService';
import type { MarkedLocation, RiskCalcResult } from '../types';
import {
  mapAlertToDisasterEvent,
  mapInariskToVulnerability,
  mapDisasterTypeToInariskHazard,
  findAffectedLocations,
  vulnerabilityToScore,
  getRiskLevel,
  isKerentananSupportedType,
} from '../utils/riskCalculator';

export const useDisasterAlert = () => {
  const { alerts, isLoading } = useAlerts();
  const markedLocations = useMemo<MarkedLocation[]>(() => KPWBI_OFFICES.map((office) => ({
    id: office.id,
    name: office.name,
    latitude: office.latitude,
    longitude: office.longitude,
  })), []);

  const riskResults = useMemo<RiskCalcResult[]>(() => {
    if (isLoading) return [];
    return alerts.flatMap((alert) => {
      if (alert.isForecast || !isKerentananSupportedType(alert.type)) return [];
      const event = mapAlertToDisasterEvent(alert);
      if (!event) return [];
      const affectedLocations = findAffectedLocations(event, markedLocations);
      if (affectedLocations.length === 0) return [];

      const hazard = mapDisasterTypeToInariskHazard(event.type);
      const indices = affectedLocations
        .map((location) => BnpbInariskService.getLocalHazardIndex(location.id, hazard))
        .filter((index): index is number => index !== null);
      if (indices.length === 0) return [];

      const vulnerabilityLevel = mapInariskToVulnerability(Math.max(...indices));
      const vulnerabilityScore = vulnerabilityToScore(vulnerabilityLevel);
      const riskScore = event.disasterScore * vulnerabilityScore;
      const riskLevel = getRiskLevel(riskScore);
      return [{
        event,
        vulnerabilityLevel,
        vulnerabilityScore,
        riskScore,
        riskLevel,
        affectedLocations,
        shouldAlert: riskLevel === 'Tinggi',
      }];
    });
  }, [alerts, isLoading, markedLocations]);

  const activeAlerts = useMemo(() => riskResults.filter((result) => result.shouldAlert), [riskResults]);
  return { riskResults, activeAlerts, hasActiveAlert: activeAlerts.length > 0, markedLocations };
};

import { useMemo } from 'react';
import { useAlerts } from './useAlerts';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices';
import { BnpbInariskService } from '../services/bnpbInariskService';
import type { MarkedLocation, RiskCalcResult, VulnerabilityLevel } from '../types';
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

  // Map all BI office locations (KPWBI + DC/DRC) into MarkedLocation[]
  const markedLocations = useMemo<MarkedLocation[]>(() => {
    return KPWBI_OFFICES.map((office) => ({
      id: office.id,
      name: office.name,
      latitude: office.latitude,
      longitude: office.longitude,
    }));
  }, []);

  const riskResults = useMemo<RiskCalcResult[]>(() => {
    if (isLoading || !alerts) return [];

    return alerts
      .map((alert) => {
        // Abaikan prakiraan (forecast), fokus ke bencana real-time
        if (alert.isForecast) return null;

        const event = mapAlertToDisasterEvent(alert);
        if (!event) return null;

        // Cari lokasi-lokasi (KPW & DRC) yang berada DALAM radius dampak bencana
        const affectedLocations = findAffectedLocations(event, markedLocations);

        // ─── Syarat "Tinggi": ─────────────────────────────────────────────────
        // 1. Bencana level 3 (critical → disasterScore = 3)
        // 2. Kerentanan InaRisk lokasi terdampak = Tinggi (index >= 0.64 atau 64%)
        // 3. Minimal satu lokasi (KPW/DRC) berada DI DALAM radius dampak
        //
        // Jika tidak ada lokasi dalam radius → riskLevel = Rendah, shouldAlert = false.
        // Fallback provinsi TIDAK boleh menaikkan risk level ke Tinggi/Sedang.
        // ─────────────────────────────────────────────────────────────────────

        let maxVulnerabilityLevel: VulnerabilityLevel = 'Rendah';
        let maxVulnerabilityScore = 1;
        let maxRiskScore = event.disasterScore * 1; // worst case: disasterScore × Rendah
        let maxRiskLevel = getRiskLevel(maxRiskScore);

        const isKerentananSupported = isKerentananSupportedType(event.type);

        if (affectedLocations.length > 0) {
          if (!isKerentananSupported) {
            // Bypass kerentanan dan ikuti severity level (disasterScore)
            maxVulnerabilityScore = 3; // Set ke 3 agar riskScore (dikali disasterScore) langsung jadi 3, 6, atau 9
            maxVulnerabilityLevel = 'Tinggi'; // Atau 'N/A', tapi kita isi Tinggi agar matematis sejalan
            maxRiskScore = event.disasterScore * maxVulnerabilityScore;
            maxRiskLevel = getRiskLevel(maxRiskScore);
          } else {
            // Tentukan kerentanan tertinggi di antara lokasi-lokasi yang terdampak
            affectedLocations.forEach((loc) => {
              const hazard = mapDisasterTypeToInariskHazard(event.type);
              const index = BnpbInariskService.getLocalHazardIndex(loc.id, hazard);
              const vulLevel = mapInariskToVulnerability(index);
              const vulScore = vulnerabilityToScore(vulLevel);
              const rScore = event.disasterScore * vulScore;

              if (vulScore > maxVulnerabilityScore) {
                maxVulnerabilityLevel = vulLevel;
                maxVulnerabilityScore = vulScore;
                maxRiskScore = rScore;
                maxRiskLevel = getRiskLevel(rScore);
              }
            });
          }
        }
        // Jika affectedLocations kosong: risk level tetap Rendah (disasterScore × 1).
        // Tidak ada fallback provinsi — radius harus benar-benar mencakup lokasi.

        // shouldAlert hanya true jika KETIGA syarat terpenuhi:
        // - riskLevel Tinggi (score 7-9, artinya disasterScore=3 & vulScore=3)
        // - Ada lokasi yang secara geometris berada dalam radius dampak
        const shouldAlert = maxRiskLevel === 'Tinggi' && affectedLocations.length > 0;

        return {
          event,
          vulnerabilityLevel: maxVulnerabilityLevel,
          vulnerabilityScore: maxVulnerabilityScore,
          riskScore: maxRiskScore,
          riskLevel: maxRiskLevel,
          affectedLocations,
          shouldAlert,
        } as RiskCalcResult;
      })
      .filter((res): res is RiskCalcResult => res !== null);
  }, [alerts, isLoading, markedLocations]);

  // Hanya ambil hasil kalkulasi risiko yang men-trigger notifikasi (shouldAlert === true)
  const activeAlerts = useMemo(() => {
    return riskResults.filter((res) => res.shouldAlert);
  }, [riskResults]);

  const hasActiveAlert = activeAlerts.length > 0;

  return {
    riskResults,
    activeAlerts,
    hasActiveAlert,
    markedLocations,
  };
};

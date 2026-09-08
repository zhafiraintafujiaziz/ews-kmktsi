import type { KpwbiOffice, DisasterAlert } from '../types';
import { haversineDistance } from './geo';

/**
 * Gets the impact radius of a disaster alert in kilometers.
 */
export function getAlertImpactRadiusKm(alert: DisasterAlert): number {
  switch (alert.type) {
    case 'earthquake':
      return (alert.magnitude || 5) * 20;
    case 'tsunami':
      return 80;
    case 'flood':
      return (alert.waterLevel || 1.5) * 12;
    case 'volcanic':
      return 80;
    case 'volcanic_ash':
      return 100;
    case 'landslide':
      return 15;
    case 'extreme_weather':
      return 60;
    case 'karhutla':
      return 25; // Radius 25 km untuk zona dampak asap pekat & paparan langsung terhadap KPw BI
    case 'kekeringan':
      return 40;
    default:
      return 20;
  }
}

export function isOfficeAffectedByAlert(office: KpwbiOffice, alert: DisasterAlert): boolean {
  if (alert.type === 'extreme_weather') {
    return alert.provinceId === office.provinceId;
  }

  if (alert.latitude !== undefined && alert.longitude !== undefined && !isNaN(alert.latitude) && !isNaN(alert.longitude)) {
    const distance = haversineDistance(
      office.latitude,
      office.longitude,
      alert.latitude,
      alert.longitude
    );
    const radius = getAlertImpactRadiusKm(alert);
    return distance <= radius;
  }
  
  // Fallback to old province-based matching if alert has no coordinates
  return alert.provinceId === office.provinceId;
}

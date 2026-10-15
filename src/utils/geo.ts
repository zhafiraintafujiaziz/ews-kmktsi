import type { KpwbiOffice } from '../types/index.ts';
import { KPWBI_OFFICES } from '../constants/kpwbiOffices.ts';

export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function isValidCoord(lat?: unknown, lng?: unknown): boolean {
  if (lat == null || lng == null) return false;
  if (typeof lat === 'string' && lat.trim() === '') return false;
  if (typeof lng === 'string' && lng.trim() === '') return false;
  
  const numLat = Number(lat);
  const numLng = Number(lng);
  
  if (isNaN(numLat) || isNaN(numLng)) return false;
  if (numLat === 0 && numLng === 0) return false;
  
  // Basic bounds check
  if (numLat < -90 || numLat > 90) return false;
  if (numLng < -180 || numLng > 180) return false;

  return true;
}

export interface NearestKpwResult {
  office: KpwbiOffice;
  distanceKm: number;
}

export function findNearestKpwOffice(lat: number, lon: number): KpwbiOffice {
  let nearest = KPWBI_OFFICES[0];
  let minDist = haversineDistance(lat, lon, nearest.latitude, nearest.longitude);
  for (let i = 1; i < KPWBI_OFFICES.length; i++) {
    const d = haversineDistance(lat, lon, KPWBI_OFFICES[i].latitude, KPWBI_OFFICES[i].longitude);
    if (d < minDist) {
      minDist = d;
      nearest = KPWBI_OFFICES[i];
    }
  }
  return nearest;
}

export function findNearestOffices(
  targetOffice: KpwbiOffice,
  allOffices: KpwbiOffice[],
  count: number = 5
): NearestKpwResult[] {
  return allOffices
    .filter((o) => o.id !== targetOffice.id)
    .map((o) => ({
      office: o,
      distanceKm: haversineDistance(
        targetOffice.latitude,
        targetOffice.longitude,
        o.latitude,
        o.longitude
      ),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, count);
}

export function distanceToPolyline(
  lat: number,
  lng: number,
  path: [number, number][]
): number {
  let minDistance = Infinity;

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];

    // Interpolate points along the segment p1-p2
    const steps = 15; // 15 points per segment is plenty
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const interpLat = p1[0] + t * (p2[0] - p1[0]);
      const interpLng = p1[1] + t * (p2[1] - p1[1]);
      const dist = haversineDistance(lat, lng, interpLat, interpLng);
      if (dist < minDistance) {
        minDistance = dist;
      }
    }
  }

  return minDistance;
}

export function getPolylineBufferSegments(
  path: [number, number][],
  radiusKm: number
): [number, number][][] {
  const segments: [number, number][][] = [];
  const rDeg = radiusKm / 111.32; // rough estimate: 1 degree = 111.32 km

  for (let i = 0; i < path.length - 1; i++) {
    const p1 = path[i];
    const p2 = path[i + 1];

    const lat1 = p1[0];
    const lng1 = p1[1];
    const lat2 = p2[0];
    const lng2 = p2[1];

    const latAvg = ((lat1 + lat2) / 2) * (Math.PI / 180);
    const cosLat = Math.cos(latAvg);

    // Latitude and longitude delta
    const dy = lat2 - lat1;
    const dx = (lng2 - lng1) * cosLat;

    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) continue;

    // Normal vector: perpendicular to direction (dx, dy)
    const ny = dx / len;
    const nx = -dy / len;

    // Apply radius offset in degrees
    const offsetLat = ny * rDeg;
    const offsetLng = (nx * rDeg) / cosLat;

    const pt1: [number, number] = [lat1 + offsetLat, lng1 + offsetLng];
    const pt2: [number, number] = [lat2 + offsetLat, lng2 + offsetLng];
    const pt3: [number, number] = [lat2 - offsetLat, lng2 - offsetLng];
    const pt4: [number, number] = [lat1 - offsetLat, lng1 - offsetLng];

    segments.push([pt1, pt2, pt3, pt4]);
  }

  return segments;
}


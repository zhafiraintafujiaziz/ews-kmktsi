type Point = [number, number];
function validRing(value: unknown): value is Point[] {
  return Array.isArray(value) && value.length >= 4 && value.every(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90);
}
function inRing(point: Point, ring: Point[]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i];
    const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-9 && x >= Math.min(ax, bx) - 1e-9 && x <= Math.max(ax, bx) + 1e-9 && y >= Math.min(ay, by) - 1e-9 && y <= Math.max(ay, by) + 1e-9) return true;
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}
export function pointInSourceGeometry(longitude: number, latitude: number, geometry: unknown): boolean {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || !geometry || typeof geometry !== 'object') return false;
  const geo = geometry as { type?: string; coordinates?: unknown };
  const polygons = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' && Array.isArray(geo.coordinates) ? geo.coordinates : [];
  return polygons.some(polygon => Array.isArray(polygon) && polygon.length > 0 && polygon.every(validRing) && inRing([longitude, latitude], polygon[0]) && !polygon.slice(1).some(hole => inRing([longitude, latitude], hole)));
}

// Leaflet receives every exterior and hole used by the eligibility check.
export function polygonLatLngs(geometry: unknown): Point[][][] | null {
  if (!geometry || typeof geometry !== 'object') return null;
  const geo = geometry as { type?: string; coordinates?: unknown };
  const polygons = geo.type === 'Polygon' ? [geo.coordinates] : geo.type === 'MultiPolygon' && Array.isArray(geo.coordinates) ? geo.coordinates : [];
  if (!polygons.length || !polygons.every(p => Array.isArray(p) && p.length > 0 && p.every(validRing))) return null;
  return (polygons as Point[][][]).map(p => p.map(ring => ring.map(([lng, lat]) => [lat, lng])));
}

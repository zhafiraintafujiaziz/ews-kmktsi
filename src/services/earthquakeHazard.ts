import { INARISK_WMS_SERVICE, INARISK_HAZARD_SERVICES } from '../constants/kerentananCategories';

export { EARTHQUAKE_WMS_SERVICE, INARISK_WMS_SERVICE } from '../constants/kerentananCategories';

const POINT_HALF_WIDTH = 0.00005;

/** Query the raw 100 m Bahaya raster at a pixel centered on the office. */
export function inaRiskPointHazardUrl(
  office: { latitude: number; longitude: number },
  source: 'earthquake' | 'extreme_weather',
): string {
  const { latitude, longitude } = office;
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
    || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new Error('Invalid hazard office coordinates');
  }
  if (source !== 'earthquake' && source !== 'extreme_weather') {
    throw new Error('Invalid point hazard source');
  }

  const layer = INARISK_HAZARD_SERVICES[source];
  const url = new URL(INARISK_WMS_SERVICE);
  url.search = new URLSearchParams({
    service: 'WMS',
    version: '1.1.1',
    request: 'GetFeatureInfo',
    layers: layer,
    query_layers: layer,
    styles: '',
    srs: 'EPSG:4326',
    bbox: [
      longitude - POINT_HALF_WIDTH, latitude - POINT_HALF_WIDTH,
      longitude + POINT_HALF_WIDTH, latitude + POINT_HALF_WIDTH,
    ].join(','),
    width: '1',
    height: '1',
    x: '0',
    y: '0',
    buffer: '0',
    format: 'image/png',
    info_format: 'application/json',
    feature_count: '1',
  }).toString();
  return url.toString();
}

export function earthquakeHazardUrl(office: { latitude: number; longitude: number }): string {
  return inaRiskPointHazardUrl(office, 'earthquake');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Keep NoData distinct from a malformed response and preserve a valid zero. */
export function parseInaRiskPointHazardValue(data: Record<string, unknown>): unknown {
  if (!isRecord(data) || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Invalid hazard response: expected a FeatureCollection');
  }
  if (data.features.length === 0) return null;

  const feature: unknown = data.features[0];
  if (!isRecord(feature) || !isRecord(feature.properties)) {
    throw new Error('Invalid hazard response: missing feature properties');
  }
  if (!Object.hasOwn(feature.properties, 'GRAY_INDEX')) {
    throw new Error('Missing GRAY_INDEX in hazard response');
  }
  return feature.properties.GRAY_INDEX;
}

export function parseEarthquakeHazardValue(data: Record<string, unknown>): unknown {
  return parseInaRiskPointHazardValue(data);
}

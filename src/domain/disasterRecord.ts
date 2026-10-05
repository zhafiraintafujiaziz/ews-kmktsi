import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { DisasterAlert } from '../types';

export const DisasterRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  revision: z.string().min(1),
  recordKind: z.enum(['observation', 'warning', 'forecast', 'hazard_assessment']),
  hazard: z.enum([
    'earthquake', 'flood', 'volcanic', 'volcanic_ash', 'tsunami', 'landslide',
    'extreme_weather', 'karhutla', 'kekeringan', 'air_quality',
  ]),
  title: z.string(),
  description: z.string(),
  sourceInstructions: z.array(z.string()),
  time: z.object({
    occurrence: z.string().datetime().nullable(),
    observation: z.string().datetime().nullable(),
    issued: z.string().datetime().nullable(),
    validFrom: z.string().datetime().nullable(),
    validUntil: z.string().datetime().nullable(),
  }),
  location: z.object({
    administrativeIds: z.record(z.string(), z.string()),
    precision: z.enum(['exact', 'area', 'province', 'unknown']),
    point: z.object({ type: z.literal('Point'), coordinates: z.tuple([z.number(), z.number()]) }).nullable(),
    sourceGeometry: z.unknown().nullable(),
  }),
  severity: z.object({
    level: z.enum(['low', 'medium', 'high', 'unknown']),
    sourceScale: z.string().nullable(),
    sourceValue: z.union([z.string(), z.number()]).nullable(),
    mappingRule: z.string().nullable(),
    explanation: z.string().nullable(),
  }),
  details: z.record(z.string(), z.unknown()),
  resources: z.array(z.object({ type: z.string(), url: z.string().url(), label: z.string().optional() })),
  provenance: z.object({
    integration: z.string().min(1),
    feed: z.string().min(1),
    sourceUrl: z.string().url().nullable(),
    retrievedAt: z.string().datetime(),
    adapterVersion: z.string().min(1),
    rawRecordReference: z.string().min(1),
    rawRecord: z.unknown(),
  }),
});

export type DisasterRecord = z.infer<typeof DisasterRecordSchema>;
export const DisasterRecordJsonSchema = zodToJsonSchema(DisasterRecordSchema, {
  name: 'DisasterRecord',
  target: 'jsonSchema7',
});

export const LegacyDisasterAlertSchema = z.object({
  id: z.string().min(1),
  type: z.enum([
    'earthquake', 'flood', 'volcanic', 'volcanic_ash', 'tsunami', 'landslide',
    'extreme_weather', 'karhutla', 'kekeringan', 'air_quality',
  ]),
  severity: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  provinceId: z.string().min(1),
  title: z.string(),
  description: z.string(),
  timestamp: z.string().min(1),
}).passthrough();

export function validateAdapterAlert(alert: DisasterAlert): DisasterAlert {
  return LegacyDisasterAlertSchema.parse(alert) as DisasterAlert;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function normalizeAdapterAlert(alert: DisasterAlert, feedId: string, retrievedAt = new Date().toISOString()): DisasterRecord {
  const validated = validateAdapterAlert(alert);
  const hasPoint = Number.isFinite(validated.latitude) && Number.isFinite(validated.longitude);
  const geometry = validated.sourceGeometry ?? null;
  const validUrl = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    try { return new URL(value).toString(); } catch { return null; }
  };
  const isForecast = Boolean(validated.isForecast);
  const warning = ['extreme_weather', 'volcanic_ash'].includes(validated.type);
  const observation = ['earthquake', 'air_quality', 'karhutla', 'volcanic'].includes(validated.type);
  return DisasterRecordSchema.parse({
    schemaVersion: 1,
    id: validated.id,
    revision: `${validated.timestamp}:adapter-v1`,
    recordKind: isForecast ? 'forecast' : warning ? 'warning' : observation ? 'observation' : 'hazard_assessment',
    hazard: validated.type,
    title: validated.title,
    description: validated.description,
    sourceInstructions: [],
    time: {
      occurrence: validated.type === 'earthquake' ? isoOrNull(validated.timestamp) : null,
      observation: observation ? isoOrNull(validated.timestamp) : null,
      issued: isoOrNull(validated.timestamp),
      validFrom: isoOrNull(validated.validFrom),
      validUntil: isoOrNull(validated.validUntil),
    },
    location: {
      administrativeIds: validated.provinceId && validated.provinceId !== 'unknown' ? { province: validated.provinceId } : {},
      precision: geometry ? 'area' : hasPoint ? 'exact' : 'unknown',
      point: hasPoint ? { type: 'Point', coordinates: [validated.longitude!, validated.latitude!] } : null,
      sourceGeometry: geometry,
    },
    severity: {
      level: validated.severity === 3 ? 'high' : validated.severity === 2 ? 'medium' : 'low',
      sourceScale: 'legacy-adapter-1-to-3',
      sourceValue: validated.severity,
      mappingRule: 'Legacy dashboard severity mapping; not a source-issued severity scale.',
      explanation: null,
    },
    details: { ...validated, legacyAlert: validated },
    resources: validUrl(validated.sourceUrl) ? [{ type: 'source', url: validUrl(validated.sourceUrl)!, label: 'Source' }] : [],
    provenance: {
      integration: 'ews-kmktsi',
      feed: feedId,
      sourceUrl: validUrl(validated.sourceUrl),
      retrievedAt: isoOrNull(retrievedAt) ?? new Date().toISOString(),
      adapterVersion: '1',
      rawRecordReference: `${feedId}:${validated.id}`,
      rawRecord: validated,
    },
  });
}

export function toLegacyDisasterAlert(record: DisasterRecord): DisasterAlert {
  return LegacyDisasterAlertSchema.parse(record.details.legacyAlert) as DisasterAlert;
}

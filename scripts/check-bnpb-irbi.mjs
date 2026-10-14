#!/usr/bin/env node
// Run with: node --experimental-strip-types scripts/check-bnpb-irbi.mjs
// Options: --out=path/to/audit.json
//
// Scrapes BNPB InaRISK IRBI (Indeks Risiko Bencana Indonesia) per kabupaten/kota
// for every KPwBI office, for the Gempa, Cuaca, and Karhutla hazards.
// Kelas risiko thresholds are BNPB's own (inarisk.bnpb.go.id/v4 IRBI page):
// score >= 144 Tinggi, >= 13 Sedang, else Rendah on the national IRBI scale.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';

let outputPath;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--out=')) {
    outputPath = arg.slice('--out='.length);
    if (!outputPath) throw new Error('--out requires a file path');
  } else throw new Error('Unknown argument: ' + arg);
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL) {
      for (const suffix of ['.ts', '/index.ts']) {
        const url = new URL(specifier + suffix, context.parentURL);
        if (existsSync(url)) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});

const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
const { PROVINCES } = await import('../src/constants/provinces.ts');
const { IRBI_HAZARD_MAX, IRBI_CLASS_HIGH, IRBI_CLASS_MEDIUM, IRBI_CLASS_SCALE_MAX, getIrbiLevel } = await import('../src/constants/irbiRiskClass.ts');

const API = 'https://inarisk.bnpb.go.id/apiv4';
const HAZARDS = ['gempabumi', 'cuaca_ekstrem', 'karlahut'];

const provinceName = new Map(PROVINCES.map((p) => [p.id, p.name]));
const PROVINCE_ALIAS = { 'DI Yogyakarta': 'Daerah Istimewa Yogyakarta' };
const CITY_ALIAS = { Solo: 'Surakarta', Purwokerto: 'Banyumas' };

function normalize(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(kabupaten|kab\.?|kota|administrasi)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
const key = (value) => normalize(value).replace(/ /g, '');

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(response.status + ' ' + url);
  return response.json();
}

function matchKabupaten(city, candidates) {
  const target = key(CITY_ALIAS[city] ?? city);
  return candidates.find((k) => key(k.nama_kabupaten) === target)
    ?? candidates.find((k) => key(k.nama_kabupaten).includes(target) || target.includes(key(k.nama_kabupaten)));
}

const startedAt = new Date().toISOString();
const start = performance.now();
const requests = [];
async function tracked(url) {
  const requestStart = performance.now();
  try {
    const data = await getJson(url);
    requests.push({ url, status: 200, durationMs: Math.round((performance.now() - requestStart) * 100) / 100 });
    return data;
  } catch (error) {
    requests.push({ url, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

async function trackedText(url) {
  const requestStart = performance.now();
  try {
    const response = await fetch(url, { headers: { accept: 'application/x-ndjson' }, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(response.status + ' ' + url);
    const text = await response.text();
    requests.push({ url, status: response.status, durationMs: Math.round((performance.now() - requestStart) * 100) / 100 });
    return text;
  } catch (error) {
    requests.push({ url, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

const bnpbProvinces = await tracked(API + '/provinsi');
const bnpbProvinceByKey = new Map(bnpbProvinces.map((p) => [key(p.nama_provinsi), p.id_provinsi]));

const kabupatenByProvince = new Map();
const resolved = [];
for (const office of KPWBI_OFFICES) {
  const rawName = provinceName.get(office.provinceId) ?? office.provinceId;
  const provinceCode = bnpbProvinceByKey.get(key(PROVINCE_ALIAS[rawName] ?? rawName));
  let kabupaten;
  if (provinceCode) {
    if (!kabupatenByProvince.has(provinceCode)) kabupatenByProvince.set(provinceCode, await tracked(API + '/kabupaten/' + provinceCode));
    kabupaten = matchKabupaten(office.city, kabupatenByProvince.get(provinceCode));
  }
  resolved.push({ id: office.id, name: office.name, city: office.city, provinceId: office.provinceId, pcode: kabupaten?.id_kabupaten ?? null, kabupaten: kabupaten?.nama_kabupaten ?? null });
}

const pcodes = [...new Set(resolved.map((r) => r.pcode).filter(Boolean))];
const irbiByPcode = new Map();
for (const pcode of pcodes) irbiByPcode.set(pcode, await tracked(API + '/irbi/' + pcode));

// National maxima per hazard, used to normalize the IRBI component scores onto 0..1.
// Taken from the full national dataset (latest year per kabupaten/kota).
const fullText = await trackedText(API + '/data-irbi-full');
const latestByPcode = new Map();
for (const line of fullText.split('\n')) {
  if (!line.trim()) continue;
  const parsed = JSON.parse(line);
  if (parsed.type !== 'row') continue;
  const current = latestByPcode.get(parsed.data.pcode);
  if (!current || Number(parsed.data.tahun) > Number(current.tahun)) latestByPcode.set(parsed.data.pcode, parsed.data);
}
const nationalMax = Object.fromEntries(HAZARDS.map((h) => [h, Math.max(0, ...[...latestByPcode.values()].map((r) => Number(r[h]) || 0))]));
const maxMatchesAssumption = HAZARDS.every((h) => Math.abs(nationalMax[h] - IRBI_HAZARD_MAX[h]) < 0.05);

const offices = resolved.map((row) => {
  const record = row.pcode ? irbiByPcode.get(row.pcode) : null;
  const hazards = Object.fromEntries(HAZARDS.map((hazard) => {
    const score = record ? Number(record[hazard]) : null;
    const valid = score !== null && Number.isFinite(score);
    const index = valid ? Math.min(1, Math.max(0, score / IRBI_HAZARD_MAX[hazard])) : null;
    return [hazard, { score: valid ? score : null, index, level: index === null ? null : getIrbiLevel(index) }];
  }));
  return { ...row, hazards };
});

const unresolved = offices.filter((o) => !o.pcode);
const report = {
  success: unresolved.length === 0,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Math.round((performance.now() - start) * 100) / 100,
  source: {
    provider: 'BNPB InaRISK',
    assessment: 'IRBI kelas risiko',
    endpoint: API + '/irbi/{pcode}',
    thresholds: { tinggi: IRBI_CLASS_HIGH, sedang: IRBI_CLASS_MEDIUM, scaleMax: IRBI_CLASS_SCALE_MAX },
    hazardMax: IRBI_HAZARD_MAX,
  },
  nationalMax,
  maxMatchesAssumption,
  officeCount: offices.length,
  resolvedCount: offices.length - unresolved.length,
  unresolved: unresolved.map((o) => ({ id: o.id, city: o.city })),
  requestCount: requests.length,
  requests,
  offices,
};
const json = JSON.stringify(report, null, 2) + '\n';
if (outputPath) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, json, 'utf8');
}

const header = ['office', 'pcode', 'kabupaten', ...HAZARDS.flatMap((h) => [h + '_score', h + '_idx', h + '_kelas'])];
const lines = [header.join('\t')];
for (const office of offices) {
  lines.push([office.id, office.pcode ?? '-', office.kabupaten ?? '-',
    ...HAZARDS.flatMap((h) => {
      const e = office.hazards[h];
      return [e.score ?? '-', e.index === null ? '-' : e.index.toFixed(3), e.level ?? '-'];
    })].join('\t'));
}
console.error(lines.join('\n'));
console.log(JSON.stringify({ success: report.success, resolvedCount: report.resolvedCount, officeCount: report.officeCount, unresolved: report.unresolved, nationalMax, maxMatchesAssumption }));
if (!report.success) process.exitCode = 1;

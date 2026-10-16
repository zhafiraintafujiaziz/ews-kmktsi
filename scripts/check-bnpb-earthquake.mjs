#!/usr/bin/env node
// Run with: node --experimental-strip-types scripts/check-bnpb-earthquake.mjs
// Options: --app-url=http://localhost:5173, --direct, --out=path/to/audit.json
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';

let appUrl = 'http://localhost:5173';
let direct = false;
let outputPath;
for (const arg of process.argv.slice(2)) {
  if (arg === '--direct') direct = true;
  else if (arg.startsWith('--app-url=')) appUrl = arg.slice('--app-url='.length);
  else if (arg.startsWith('--out=')) {
    outputPath = arg.slice('--out='.length);
    if (!outputPath) throw new Error('--out requires a file path');
  } else throw new Error('Unknown argument: ' + arg);
}
const appBase = new URL(appUrl);
if (!['http:', 'https:'].includes(appBase.protocol)) throw new Error('--app-url must use HTTP or HTTPS');

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

const { BnpbInariskService } = await import('../src/services/bnpbInariskService.ts');
const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
const categories = await import('../src/constants/kerentananCategories.ts');
const { syncErrorDetails } = await import('../src/services/syncDiagnostics.ts');
const originalFetch = globalThis.fetch;
const originalInfo = console.info;
const requests = [];
let refreshError = null;
const startedAt = new Date().toISOString();
const start = performance.now();

globalThis.fetch = async (input, init) => {
  const requestedUrl = input instanceof Request ? input.url : String(input);
  const requested = new URL(requestedUrl, appBase);
  const upstreamUrl = requested.pathname === '/api/proxy' ? requested.searchParams.get('url') : null;
  const actualUrl = direct && upstreamUrl ? new URL(upstreamUrl).href : requested.href;
  const record = {
    method: init?.method ?? (input instanceof Request ? input.method : 'GET'),
    requestedUrl,
    actualUrl,
    upstreamUrl,
    status: null,
    durationMs: null,
  };
  requests.push(record);
  const requestStart = performance.now();
  try {
    const forwarded = input instanceof Request ? new Request(actualUrl, input) : actualUrl;
    const response = await originalFetch(forwarded, init);
    record.status = response.status;
    return response;
  } catch (error) {
    record.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    // Fetch duration ends at receipt of response headers; the refresh duration includes parsing.
    record.durationMs = Math.round((performance.now() - requestStart) * 100) / 100;
  }
};
// Keep stdout as one JSON document, including when the production service logs missing data.
console.info = (...args) => console.error(...args);
try {
  await BnpbInariskService.refreshAssessment(KPWBI_OFFICES, ['earthquake']);
} catch (error) {
  refreshError = syncErrorDetails(error);
} finally {
  globalThis.fetch = originalFetch;
  console.info = originalInfo;
}

const offices = KPWBI_OFFICES.map((office) => {
  const index = BnpbInariskService.getLocalHazardIndex(office.id, 'earthquake');
  return {
    id: office.id,
    name: office.name,
    latitude: office.latitude,
    longitude: office.longitude,
    index,
    valid: typeof index === 'number' && Number.isFinite(index) && index >= 0 && index <= 1,
  };
});
const status = BnpbInariskService.getAssessmentStatus('earthquake');
const validCount = offices.filter((office) => office.valid).length;
const success = offices.length === 48 && validCount === 48 && status.status === 'available' && refreshError === null;
const report = {
  success,
  mode: direct ? 'direct' : 'application_proxy',
  appUrl: direct ? null : appBase.href,
  startedAt,
  finishedAt: new Date().toISOString(),
  durationMs: Math.round((performance.now() - start) * 100) / 100,
  source: {
    provider: 'BNPB InaRISK',
    assessment: 'bahaya',
    hazard: 'gempabumi',
    endpoint: categories.getInaRiskAssessmentEndpoint('earthquake'),
    layer: categories.INARISK_HAZARD_SERVICES.earthquake,
  },
  status,
  expectedOfficeCount: 48,
  officeCount: offices.length,
  validCount,
  zeroCount: offices.filter((office) => office.index === 0).length,
  requestCount: requests.length,
  requests,
  offices,
  ...(refreshError ? { errors: refreshError } : {}),
};
const json = JSON.stringify(report, null, 2) + '\n';
if (outputPath) {
  const absolutePath = resolve(outputPath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, json, 'utf8');
}
process.stdout.write(json);
if (!success) process.exitCode = 1;

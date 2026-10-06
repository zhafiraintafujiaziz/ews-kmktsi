import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test from 'node:test';
import type { DisasterAlert, IspuStationInfo, IspuCategory } from '../src/types/index.ts';

// Resolve the app's extensionless TypeScript imports when running under Node.
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

const { IspuService } = await import('../src/services/ispuService.ts');
const { BnpbInariskService } = await import('../src/services/bnpbInariskService.ts');
const { KPWBI_OFFICES } = await import('../src/constants/kpwbiOffices.ts');
const { getIspuCategory } = await import('../src/constants/ispuCategories.ts');
const { scoreAlertForOffice, buildOfficeRiskMap, getRiskLevel } = await import('../src/utils/riskCalculator.ts');
const office = KPWBI_OFFICES[0];

function airAlert(category: IspuCategory, severity: 1 | 2 | 3): DisasterAlert {
  return {
    id: `synthetic-ispu-${severity}`, type: 'air_quality', severity,
    provinceId: office.provinceId, title: category, description: 'Synthetic fixture',
    timestamp: new Date().toISOString(), latitude: office.latitude, longitude: office.longitude,
    ispuCategory: category,
  };
}

test('ISPU stations generate severity 1, 2 and 3; Baik and Sedang generate no alerts', async (t) => {
  const values = [50, 100, 101, 200, 201, 299, 300, 301];
  const stations: IspuStationInfo[] = values.map((value) => ({
    idStasiun: String(value), nama: 'Synthetic station', kota: office.city, provinsi: '',
    latitude: office.latitude, longitude: office.longitude, ispuValue: value,
    category: getIspuCategory(value), dominantParam: 'PM2.5', waktuText: 'Synthetic observation',
    observedAt: new Date().toISOString(),
  }));
  t.mock.method(IspuService, 'fetchIspuStations', async () => stations);
  const alerts = await IspuService.fetchAirQualityAlerts();
  assert.deepEqual(alerts.map((alert) => [alert.ispuValue, alert.severity]), [
    [301, 3], [300, 3], [299, 2], [201, 2], [200, 1], [101, 1],
  ]);
});

test('ISPU contributes low, medium and high KPw risk without querying InaRISK', (t) => {
  const inarisk = t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => {
    throw new Error('ISPU must not query InaRISK');
  });
  const cases = [
    ['TIDAK SEHAT', 1, 3, 'Rendah'],
    ['SANGAT TIDAK SEHAT', 2, 6, 'Sedang'],
    ['BERBAHAYA', 3, 9, 'Tinggi'],
  ] as const;
  for (const [category, severity, score, level] of cases) {
    const alert = airAlert(category, severity);
    const risk = scoreAlertForOffice(office.id, alert);
    assert.equal(risk.totalScore, score);
    assert.equal(getRiskLevel(risk.totalScore!), level);
    assert.equal(risk.assessmentScore, null);
    assert.equal(risk.isInaRiskSupported, false);
    assert.equal(buildOfficeRiskMap([office], [alert]).get(office.id)?.riskLevel, level);
  }
  assert.equal(inarisk.mock.callCount(), 0);
});

test('KPw uses the highest ISPU risk and excludes offices outside the impact area', () => {
  const remote = { ...office, id: 'synthetic-remote-office', latitude: 20, longitude: 150 };
  const alerts = [airAlert('TIDAK SEHAT', 1), airAlert('SANGAT TIDAK SEHAT', 2), airAlert('BERBAHAYA', 3)];
  const risks = buildOfficeRiskMap([office, remote], alerts);
  assert.equal(risks.size, 1);
  assert.equal(risks.get(office.id)?.riskLevel, 'Tinggi');
  assert.equal(risks.get(office.id)?.riskScore, 9);
  assert.equal(risks.get(office.id)?.alerts.length, 3);
});

test('mapped disasters use hazard scoring and preserve missing-data behavior', (t) => {
  const inarisk = t.mock.method(BnpbInariskService, 'getLocalHazardIndex', () => 0.6);
  const earthquake: DisasterAlert = { ...airAlert('BERBAHAYA', 3), type: 'earthquake' };
  const scored = scoreAlertForOffice(office.id, earthquake);
  assert.equal(scored.assessmentScore, 2);
  assert.equal(scored.totalScore, 6);
  assert.equal(getRiskLevel(scored.totalScore!), 'Sedang');
  assert.equal(inarisk.mock.callCount(), 1);

  inarisk.mock.mockImplementation(() => null);
  assert.equal(scoreAlertForOffice(office.id, earthquake).totalScore, null);
});

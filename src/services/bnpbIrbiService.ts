import type { KpwbiOffice } from '../types/index.ts';
import { OFFICE_IRBI_REGION } from '../constants/officeIrbiRegion.ts';
import { normalizeIrbiScore, type IrbiHazard } from '../constants/irbiRiskClass.ts';
import { fetchHtmlWithCorsProxy } from './proxy.ts';
import { logSyncFailure } from './syncDiagnostics.ts';
import { usesBrowserStorage } from '../domain/dataMode.ts';
import { requestFeed } from './feedClient.ts';

const IRBI_DATA_URL = 'https://inarisk.bnpb.go.id/apiv4/data-irbi-full';

/** Application hazard names mapped to the BNPB IRBI per-hazard fields. */
export const IRBI_HAZARD_FIELD = {
  earthquake: 'gempabumi',
  extreme_weather: 'cuaca_ekstrem',
  karhutla: 'karlahut',
} as const;

export type IrbiCategory = keyof typeof IRBI_HAZARD_FIELD;

export interface IrbiAssessmentStatus {
  status: 'idle' | 'loading' | 'available' | 'partial' | 'no_data' | 'error';
  checkedAt: string | null;
  error: string | null;
  officeCount: number;
  valueCount: number;
  failedOfficeCount: number;
}

interface IrbiRow extends Record<string, unknown> {
  pcode: unknown;
  tahun: unknown;
  status: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Latest FINAL IRBI row per kabupaten/kota from the ndjson export. */
export function parseLatestIrbiRows(text: string): Map<string, IrbiRow> {
  const latest = new Map<string, IrbiRow>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(line); } catch { continue; }
    if (!isRecord(parsed) || parsed.type !== 'row' || !isRecord(parsed.data)) continue;
    const row = parsed.data as IrbiRow;
    const pcode = String(row.pcode ?? '');
    if (!pcode || row.status !== 'FINAL') continue;
    const current = latest.get(pcode);
    if (!current || Number(row.tahun) > Number(current.tahun)) latest.set(pcode, row);
  }
  return latest;
}

export class BnpbIrbiService {
  private static readonly published = new Map<IrbiHazard, Map<string, number>>();
  private static readonly statuses = new Map<IrbiHazard, IrbiAssessmentStatus>();
  private static readonly failedOffices = new Map<IrbiHazard, Set<string>>();
  private static readonly listeners = new Set<() => void>();
  private static revision = 0;

  static subscribe = (listener: () => void): (() => void) => {
    BnpbIrbiService.listeners.add(listener);
    return () => { BnpbIrbiService.listeners.delete(listener); };
  };

  static getRevision = (): number => BnpbIrbiService.revision;

  private static notify() {
    this.revision++;
    this.listeners.forEach((listener) => listener());
  }

  static async refreshAssessment(offices: KpwbiOffice[], hazards?: IrbiCategory[]): Promise<void> {
    const categories = (hazards ?? Object.keys(IRBI_HAZARD_FIELD) as IrbiCategory[]);
    const fields = categories.map((category) => IRBI_HAZARD_FIELD[category]);
    fields.forEach((field) => this.statuses.set(field, { ...this.getStatus(field), status: 'loading', officeCount: offices.length }));
    this.notify();
    let rows: Map<string, IrbiRow>;
    try {
      if (usesBrowserStorage()) {
        const compact = await requestFeed<IrbiRow[]>('irbi');
        rows = new Map(compact.map(row => [String(row.pcode), row]));
      } else {
        const text = await fetchHtmlWithCorsProxy(IRBI_DATA_URL);
        rows = parseLatestIrbiRows(text);
      }
    } catch (error) {
      fields.forEach((field) => {
        offices.forEach((office) => this.failedOffices.get(field)?.add(office.id));
        this.statuses.set(field, { status: 'error', checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error), officeCount: offices.length, valueCount: 0, failedOfficeCount: offices.length });
        logSyncFailure({ source: 'BNPB IRBI', category: field, endpoint: IRBI_DATA_URL }, error);
      });
      this.notify();
      throw new AggregateError([error], 'BNPB IRBI data unavailable');
    }
    const checkedAt = new Date().toISOString();
    for (const category of categories) {
      const field = IRBI_HAZARD_FIELD[category];
      const values = new Map<string, number>();
      const failures = new Set<string>();
      for (const office of offices) {
        const pcode = OFFICE_IRBI_REGION[office.id]?.pcode;
        const score = pcode ? rows.get(pcode)?.[field] : undefined;
        const numeric = Number(score);
        if (score === undefined || score === null || !Number.isFinite(numeric)) { failures.add(office.id); continue; }
        values.set(office.id, normalizeIrbiScore(field, numeric));
      }
      this.published.set(field, values);
      this.failedOffices.set(field, failures);
      const status: IrbiAssessmentStatus['status'] = values.size === 0 ? 'no_data'
        : values.size === offices.length && failures.size === 0 ? 'available' : 'partial';
      this.statuses.set(field, { status, checkedAt, error: null, officeCount: offices.length, valueCount: values.size, failedOfficeCount: failures.size });
    }
    this.notify();
  }

  static getIndex(officeId: string, category: IrbiCategory): number | null {
    return this.published.get(IRBI_HAZARD_FIELD[category])?.get(officeId) ?? null;
  }

  private static getStatus(field: IrbiHazard): IrbiAssessmentStatus {
    return this.statuses.get(field) ?? { status: 'idle', checkedAt: null, error: null, officeCount: 0, valueCount: 0, failedOfficeCount: 0 };
  }

  static getAssessmentStatus(category: IrbiCategory): IrbiAssessmentStatus {
    return this.getStatus(IRBI_HAZARD_FIELD[category]);
  }

  static getAssessmentMessage(category: IrbiCategory, officeId?: string): string {
    const field = IRBI_HAZARD_FIELD[category];
    const assessment = this.getStatus(field);
    if (assessment.status === 'idle' || assessment.status === 'loading') return 'Memuat kelas risiko IRBI BNPB...';
    if (assessment.status === 'error' || (officeId && this.failedOffices.get(field)?.has(officeId))) {
      return 'Layanan BNPB gagal merespons. Kelas risiko IRBI belum tersedia.';
    }
    if (officeId && this.getIndex(officeId, category) === null) return 'BNPB tidak menyediakan nilai IRBI untuk kabupaten/kota kantor ini.';
    if (assessment.status === 'no_data') return 'BNPB tidak menyediakan nilai IRBI untuk kantor yang diperiksa.';
    if (assessment.status === 'partial') return assessment.valueCount + ' dari ' + assessment.officeCount + ' kantor memiliki nilai IRBI.';
    return 'Kelas risiko IRBI tersedia untuk ' + assessment.valueCount + ' kantor.';
  }
}

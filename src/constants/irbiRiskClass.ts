import type { AssessmentLevel } from '../types';

/**
 * BNPB InaRISK IRBI (Indeks Risiko Bencana Indonesia) kelas risiko.
 *
 * BNPB classifies IRBI values into three classes (inarisk.bnpb.go.id/v4 IRBI
 * page): "Tinggi", "Sedang", and "Rendah". On the 0..1 grid index BNPB uses
 * class breaks at thirds (Rendah <= 1/3, Sedang 1/3..2/3, Tinggi > 2/3).
 * Per-hazard IRBI component scores are normalized onto that index by the
 * national maximum for the hazard (see `IRBI_HAZARD_MAX`).
 */
export const IRBI_SEDANG_INDEX = 1 / 3;
export const IRBI_TINGGI_INDEX = 2 / 3;

/**
 * Highest per-hazard IRBI component score observed across all kabupaten/kota,
 * verified against `https://inarisk.bnpb.go.id/apiv4/data-irbi-full` by
 * `scripts/check-bnpb-irbi.mjs`. Also the score BNPB assigns a class-3 (Tinggi)
 * hazard, i.e. score = class x weight.
 */
export const IRBI_HAZARD_MAX = {
  gempabumi: 32.4,
  cuaca_ekstrem: 20.4,
  karlahut: 36,
} as const;

export type IrbiHazard = keyof typeof IRBI_HAZARD_MAX;

export function normalizeIrbiScore(hazard: IrbiHazard, score: number): number {
  return Math.min(1, Math.max(0, score / IRBI_HAZARD_MAX[hazard]));
}

export function getIrbiLevel(index: number): AssessmentLevel {
  return index >= IRBI_TINGGI_INDEX ? 'Tinggi' : index >= IRBI_SEDANG_INDEX ? 'Sedang' : 'Rendah';
}

# Office hazard assessment

The list, map, office risk calculation, automatic notifications, and report export use the same assessment resolver in src/utils/officeHazardAssessment.ts.

## Gempa, Cuaca, and Karhutla — BNPB IRBI kelas risiko

These three hazards use BNPB's IRBI (Indeks Risiko Bencana Indonesia) per-hazard score for the office's kabupaten/kota instead of the InaRISK Bahaya raster.

- Region mapping lives in src/constants/officeIrbiRegion.ts (`office id -> pcode`), resolved from the BNPB wilayah endpoints and re-checkable with `node --experimental-strip-types scripts/check-bnpb-irbi.mjs --out=artifacts/bnpb-bahaya/irbi-offices.json`.
- Data is read from the public `https://inarisk.bnpb.go.id/apiv4/data-irbi-full` export by src/services/bnpbIrbiService.ts. The latest `FINAL` row per `pcode` is used, and per-hazard values come from the `gempabumi`, `cuaca_ekstrem`, and `karlahut` fields.
- A hazard score is normalized onto the 0..1 index by the national per-hazard maximum (`IRBI_HAZARD_MAX`: gempabumi 32.4, cuaca_ekstrem 20.4, karlahut 36). The maxima are verified against the full national dataset.
- The normalized index is classified with BNPB's 0..1 grid class breaks at thirds (`1/3`, `2/3`): Rendah ≤ 1/3, Sedang 1/3..2/3, Tinggi > 2/3. This recovers BNPB's component class 1/2/3 and maps to factors 1/2/3. For reference, BNPB classifies its composite IRBI score with `≥ 144` Tinggi, `≥ 13` Sedang, else Rendah (inarisk.bnpb.go.id/v4 IRBI page); that scale does not apply to the per-hazard component scores.
- A valid zero index is Rendah; a missing office or region stays null and is reported as unavailable. Each category keeps its own status (`idle`, `loading`, `available`, `partial`, `no_data`, `error`).
- The superseded InaRISK Bahaya raster point queries (`raster:INDEKS_BAHAYA_GEMPABUMI1`, `raster:INDEKS_BAHAYA_CUACAEKSTRIM1`) and the Karhutla 25 km raster statistics remain in the codebase for their own tests but no longer drive office risk.
- Gempa, Cuaca, and Karhutla all use the same IRBI class. The BMKG provincial forecast (Perkiraan) is unchanged and still drives weather warning severity independently.

## Gunung Api and Abu Vulkanik

Volcano and ash susceptibility use unrounded Haversine distances to the nearest of the 69 saved MAGMA/PVMBG reference points. They are labelled application-defined geographic estimates. Both categories use the same distance bands (Tinggi ≤30 km; Sedang >30–100 km; Rendah >100 km). The current office distribution is 21 low, 20 medium, and 7 high for each category. These classifications do not represent official exclusion zones or an ash forecast. Live volcano and ash risk uses the same geographic factor, with the automatic-high rule below. Ash exposure requires containment in an active SIGMET Polygon or MultiPolygon, includes exterior boundaries, and excludes holes and their boundaries. Multiple active warnings for the same volcano remain distinct.

## Dashboard risk scoring

The shared calculator returns 9/9 only when alert severity is 3. With severity 1 or 2 it multiplies severity by the office assessment factor. The final score determines the risk category: 1–2 Rendah, 3–5 Sedang, and 6–9 Tinggi. Severity 3 still gives 9/9 Tinggi if the assessment is unavailable, while keeping the missing index and factor null. Severity 1 or 2 with a missing assessment remains unscored. The matrix, with severity as rows and assessment as columns, is:

| Keparahan / Kerentanan | 1 | 2 | 3 |
| --- | --- | --- | --- |
| 1 | 1/9 Rendah | 2/9 Rendah | 3/9 Sedang |
| 2 | 2/9 Rendah | 4/9 Sedang | 6/9 Tinggi |
| 3 | 9/9 Tinggi | 9/9 Tinggi | 9/9 Tinggi |

The diagram uses green for Rendah, yellow for Sedang, and pink for Tinggi. Both combinations that score 2/9 are Rendah, regardless of input order. Score 3/9 is Sedang. Keparahan 2 with kerentanan 3 is 6/9 Tinggi and qualifies for a high-risk notification when an office is affected.

Kualitas Udara uses ISPU severity for both inputs, giving scores 1, 4, and 9 for severity 1, 2, and 3. It does not query InaRISK or IRBI and creates no independent vulnerability assessment. ISPU categories and source alert severities are unchanged.

Each office uses the highest final score among disasters affecting that location. Equal numeric scores always have the same category regardless of alert order. A high assessment without an affecting disaster does not create live office risk. Dashboard counts, office markers, popup labels and colors, reports, exports, and notification eligibility use the score category returned by the shared calculator. Changes published by the IRBI assessment cache refresh dashboard risk through the useInariskRevision subscription.

## Verification

Run `node --experimental-strip-types scripts/check-bnpb-irbi.mjs --out=artifacts/bnpb-bahaya/irbi-offices.json` to re-resolve every office to its BNPB kabupaten/kota, fetch the live IRBI scores, classify them, and confirm the national per-hazard maxima. The command uses real requests and exits unsuccessfully if any office cannot be resolved. It has been verified with all 48 offices resolved (one, Manokwari, has no numeric IRBI row and is reported as unavailable).

The IRBI unit and integration tests (tests/hazardAssessment.test.ts, tests/kerentanan.test.ts, tests/ispuRisk.test.ts, tests/karhutlaRegional.test.ts) mock BnpbIrbiService to cover the class boundaries, missing data, and scoring matrix.

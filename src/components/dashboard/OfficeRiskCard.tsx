import type { DisasterType, RiskLevel } from '../../types';
import { renderDisasterIcon } from '../../utils/alertUtils';
import type { OfficeAlertRisk } from '../../utils/riskCalculator';
import type { OfficeRiskSummary } from '../../utils/officeRiskSummary';

const TYPE_LABEL: Record<DisasterType, string> = {
  earthquake: 'Gempa bumi', extreme_weather: 'Cuaca buruk', karhutla: 'Karhutla',
  volcanic: 'Gunung api', volcanic_ash: 'Abu vulkanik', air_quality: 'Kualitas udara',
  flood: 'Banjir', tsunami: 'Tsunami', landslide: 'Longsor', kekeringan: 'Kekeringan',
};

const riskClass = (level: RiskLevel | null) => level === 'Tinggi' ? 'critical'
  : level === 'Sedang' ? 'warning' : level === 'Rendah' ? 'watch' : 'unscored';

function scoreExplanation(risk: OfficeAlertRisk): string {
  if (risk.totalScore === null) return risk.assessment?.explanation ?? 'Skor risiko belum tersedia untuk jenis bencana ini.';
  if (risk.alert.severity === 3) return 'Keparahan 3: otomatis skor 9/9.';
  if (risk.alert.type === 'air_quality') return 'ISPU: keparahan ' + risk.alert.severity + ' × ' + risk.alert.severity + ' = ' + risk.totalScore + '/9.';
  return 'Keparahan ' + risk.alert.severity + ' × kerentanan ' + risk.assessmentScore + ' = ' + risk.totalScore + '/9.';
}

interface OfficeRiskCardProps {
  summary: OfficeRiskSummary;
  rank: number;
  isSelected: boolean;
  selectedAlertId: string | null;
  onOfficeSelect: () => void;
  onAlertSelect: (alertId: string) => void;
}

export default function OfficeRiskCard({ summary, rank, isSelected, selectedAlertId, onOfficeSelect, onAlertSelect }: OfficeRiskCardProps) {
  const { office, hazards, totalScore, riskLevel, alertCount } = summary;
  const unscoredCount = hazards.reduce((count, hazard) => count + hazard.risks.filter(risk => risk.totalScore === null).length, 0);
  const status = riskLevel ?? (alertCount ? 'Skor belum tersedia' : 'Tanpa peringatan');
  return (
    <li className={'office-risk-card office-risk-' + riskClass(riskLevel) + (isSelected ? ' selected' : '')}>
      <span aria-hidden="true" className={'alertcard-stripe ' + riskClass(riskLevel)} />
      <button type="button" className="office-risk-select" aria-pressed={isSelected} onClick={onOfficeSelect}
        aria-label={office.name + ', ' + status + (totalScore === null ? '' : ', skor ' + totalScore + ' dari 9') + '. Tampilkan di peta'}>
        <span className="office-risk-rank" aria-label={'Urutan ' + rank}>{rank}</span>
        <span className="office-risk-identity">
          <span className="office-risk-name">{office.name}</span>
          <span className="office-risk-location">{office.city} · {office.region}</span>
          {office.isKantorPusat ? <span className="office-risk-category">Kantor pusat</span>
            : office.isKorwil ? <span className="office-risk-category">Korwil</span> : null}
        </span>
        <span className="office-risk-rating">
          <span className="office-risk-score">{totalScore ?? '—'}{totalScore !== null && <small>/9</small>}</span>
          <span className="office-risk-level">{status}</span>
        </span>
      </button>
      {riskLevel !== null && hazards.length > 0 && (
        <p className="office-risk-driver">
          Pemicu risiko tertinggi: {TYPE_LABEL[hazards[0].type]}
          {hazards.length > 1 && <span className="office-risk-multiple">{hazards.length} jenis bencana</span>}
        </p>
      )}
      {alertCount > 0 ? (
        <div className="office-risk-impact">
          <div className="office-risk-impact-heading">
            <span>Bencana berdampak</span><span>{hazards.length} jenis · {alertCount} peringatan</span>
          </div>
          <ul className="office-risk-hazards">
            {hazards.map((hazard) => (
              <li key={hazard.type} className={'office-risk-hazard office-risk-' + riskClass(hazard.riskLevel)}>
                <span className="office-risk-hazard-name">
                  <span aria-hidden="true">{renderDisasterIcon(hazard.type, undefined, { width: '16px', height: '16px' }, hazard.risks[0].alert)}</span>
                  {TYPE_LABEL[hazard.type]}
                  {hazard.risks.length > 1 && <small>×{hazard.risks.length}</small>}
                </span>
                <span className="office-risk-hazard-score">
                  {hazard.totalScore === null ? 'Skor belum tersedia' : hazard.totalScore + '/9 · ' + hazard.riskLevel}
                </span>
              </li>
            ))}
          </ul>
          {unscoredCount > 0 && <p className="office-risk-note">{unscoredCount} peringatan belum memiliki skor risiko.</p>}
          <details className="filters-accordion office-risk-details">
            <summary className="filters-accordion-trigger">
              <span className="filters-trigger-label">Rincian peringatan &amp; skor</span>
              <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14"
                fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                className="office-risk-details-chevron">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </summary>
            <div className="filters-accordion-body">
              <ul>
                {hazards.flatMap((hazard) => hazard.risks.map((risk) => (
                  <li key={risk.alert.id}>
                    <button type="button" className="office-risk-alert" aria-pressed={selectedAlertId === risk.alert.id}
                      onClick={() => onAlertSelect(risk.alert.id)}>{risk.alert.title}</button>
                    <p>{scoreExplanation(risk)}</p>
                    {risk.assessment && risk.totalScore !== null && <p className="office-risk-source">{risk.assessment.source} · {risk.assessment.explanation}</p>}
                  </li>
                )))}
              </ul>
            </div>
          </details>
        </div>
      ) : <p className="office-risk-no-alert">Tidak ada peringatan berdampak pada data yang ditampilkan.</p>}
    </li>
  );
}

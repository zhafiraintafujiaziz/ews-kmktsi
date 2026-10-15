import { useId, useState } from 'react';
import * as XLSX from 'xlsx';
import { buildIspuHistoryWorkbook } from '../../utils/ispuHistoryExport';
import type { IspuChartSeries, IspuDailyReading } from '../../domain/ispuHistory';
import { ISPU_QUALITY_LABELS } from '../../domain/ispuHistory';
import { getIspuStyle } from '../../constants/ispuCategories';
import { ispuChartScale, ispuChartSegments, ispuStationColor } from '../../utils/ispuChart';

const historyDateLabel = (date: string) => new Date(date + 'T00:00:00Z').toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta', day: 'numeric', month: 'short' });
const historyTimeLabel = (reading: IspuDailyReading) => reading.observedAt
  ? new Date(reading.observedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB'
  : `${reading.sourceTimeLabel || reading.sourceTimeText || 'Tidak diketahui'} · waktu belum terurai`;

export function IspuCategoryLabel({ reading }: { reading: Pick<IspuDailyReading, 'category' | 'value'> }) {
  const style = getIspuStyle(reading.category, reading.value);
  return <span className="ispu-history-category"><i style={{ backgroundColor: style.color }} />{style.label}</span>;
}

export default function IspuHistoryChart({ series }: { series: IspuChartSeries[] }) {
  const titleId = useId();
  const [hidden, setHidden] = useState<string[]>([]);
  const [focused, setFocused] = useState<{ stationId: string; date: string } | null>(null);
  const [showData, setShowData] = useState(false);
  const visible = series.filter(item => !hidden.includes(item.stationId));
  const values = visible.flatMap(item => item.points.flatMap(point => point.value === null ? [] : [point.value]));
  const scale = ispuChartScale(values);
  const points = series[0]?.points ?? [];
  const x = (index: number) => points.length <= 1 ? 206 : 46 + index / (points.length - 1) * 306;
  const y = (value: number) => 186 - value / scale.max * 156;
  const selected = visible.find(item => item.stationId === focused?.stationId)?.points.find(point => point.date === focused?.date)?.reading;
  const lastReading = visible.flatMap(item => item.points.flatMap(point => point.reading ? [point.reading] : [])).sort((a, b) => b.collectionDate.localeCompare(a.collectionDate))[0];
  const detail = selected || lastReading;
  const ticks = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])].filter(index => index >= 0);
  const dailyReadings = series.flatMap(item => item.points.flatMap(point => point.reading ? [{ date: point.date, name: item.name, reading: point.reading }] : []));
  const dayCount = new Set(dailyReadings.map(item => item.date)).size;
  const handleExportExcel = () => {
    if (!dailyReadings.length) return;
    const dates = series.flatMap(item => item.points.map(point => point.date)).sort();
    const workbook = buildIspuHistoryWorkbook({
      from: dates[0], to: dates.at(-1)!, stations: series,
      readings: dailyReadings.map(item => item.reading),
    }, 'ISPU stasiun terpilih');
    XLSX.writeFile(workbook, `ispu_harian_${dates[0]}_sd_${dates.at(-1)}.xlsx`);
  };
  return <div className="ispu-history-chart">
    <div className="ispu-history-series-legend" aria-label="Garis stasiun">
      {series.map(item => <button key={item.stationId} type="button" aria-pressed={!hidden.includes(item.stationId)} onClick={() => setHidden(current => current.includes(item.stationId) ? current.filter(id => id !== item.stationId) : [...current, item.stationId])}>
        <i style={{ background: ispuStationColor(item.stationId) }} />{item.name}
      </button>)}
    </div>
    {values.length ? <svg viewBox="0 0 376 220" role="group" aria-labelledby={titleId}>
      <title id={titleId}>Grafik garis riwayat ISPU per stasiun. Fokus pada titik untuk detail pengamatan.</title>
      <text x="8" y="16" className="ispu-chart-axis-title">ISPU</text>
      {scale.ticks.map(value => <g key={value}><line x1="46" x2="352" y1={y(value)} y2={y(value)} className="ispu-chart-grid" /><text x="39" y={y(value) + 4} textAnchor="end">{value.toLocaleString('id-ID')}</text></g>)}
      {ticks.map(index => <text key={index} x={x(index)} y="208" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}>{historyDateLabel(points[index].date)}</text>)}
      {visible.map(item => <g key={item.stationId}>
        {ispuChartSegments(item.points).map((segment, index) => <polyline key={index} fill="none" stroke={ispuStationColor(item.stationId)} strokeWidth="2" points={segment.map(({ index, point }) => `${x(index)},${y(point.value!)}`).join(' ')} />)}
        {item.points.map((point, index) => point.reading && <circle key={point.date} className="ispu-chart-point" tabIndex={0} role="button"
          aria-label={`${item.name}, ${point.date}, ISPU ${point.value}, ${point.reading.category}${point.reading.qualityFlags.length ? ', data bertanda kualitas' : ''}`}
          cx={x(index)} cy={y(point.value!)} r={focused?.stationId === item.stationId && focused.date === point.date ? 5 : 3.5}
          fill={point.reading.qualityFlags.length ? 'var(--bg-surface)' : ispuStationColor(item.stationId)} stroke={ispuStationColor(item.stationId)} strokeWidth="2"
          onMouseEnter={() => setFocused({ stationId: item.stationId, date: point.date })} onFocus={() => setFocused({ stationId: item.stationId, date: point.date })}
          onClick={() => setFocused({ stationId: item.stationId, date: point.date })}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setFocused({ stationId: item.stationId, date: point.date }); } }}>
          <title>{item.name} · {point.date} · ISPU {point.value} · {historyTimeLabel(point.reading)}</title>
        </circle>)}
      </g>)}
    </svg> : <p className="ispu-history-message">{visible.length ? 'Tidak ada arsip pada rentang ini.' : 'Pilih garis stasiun untuk menampilkan grafik.'}</p>}
    {!!dayCount && dayCount === 1 && <p className="ispu-history-note">Baru 1 hari arsip tersedia. Grafik akan bertambah seiring pengumpulan harian.</p>}
    <p className="ispu-history-note">Tanggal arsip WIB, bukan rata-rata harian. Jeda berarti tidak ada arsip. Titik kosong menandai catatan kualitas.</p>
    {detail && <div className="ispu-history-reading" aria-live="polite">
      <div><strong>{detail.name || detail.stationId}</strong><b>{detail.value.toLocaleString('id-ID')} <small>ISPU</small></b></div>
      <IspuCategoryLabel reading={detail} />
      <p>{detail.city} · {detail.province}</p><p>Arsip {detail.collectionDate} · Polutan {detail.dominantPollutant || 'tidak diketahui'}</p>
      <p>Pengamatan: {historyTimeLabel(detail)}</p>
      {detail.qualityFlags.map(flag => <p className="ispu-history-flag" key={flag}>{ISPU_QUALITY_LABELS[flag]}</p>)}
    </div>}
    <details className="ispu-history-data" onToggle={event => setShowData(event.currentTarget.open)}><summary>Data harian per stasiun</summary>{showData && <>
      <div className="ispu-history-data-actions"><button type="button" className="ispu-history-export" onClick={handleExportExcel} disabled={!dailyReadings.length}>Unduh Excel</button></div>
      <div className="ispu-history-table-scroll"><table>
      <caption>Arsip stasiun pada rentang terpilih. Hari tanpa arsip tetap menjadi jeda pada grafik.</caption>
      <thead><tr><th>Tanggal / stasiun</th><th>ISPU / kategori</th><th>Pengamatan / kualitas</th></tr></thead>
      <tbody>{dailyReadings.map(({ date, name, reading }) => <tr key={reading.stationId + date}>
        <td>{date}<small>{name}</small></td><td>{reading.value}<small>{reading.category}</small></td>
        <td>{historyTimeLabel(reading)}<small>{reading.dominantPollutant || 'Polutan tidak diketahui'}</small><small>{reading.qualityFlags.map(flag => ISPU_QUALITY_LABELS[flag]).join('; ') || 'Tanpa catatan kualitas'}</small></td>
      </tr>)}</tbody>
    </table></div></>}</details>
  </div>;
}

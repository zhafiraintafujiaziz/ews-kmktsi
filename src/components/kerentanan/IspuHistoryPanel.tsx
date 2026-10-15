import { useRef, useState } from 'react';
import { writeFile } from 'xlsx';
import { requestIspuHistory } from '../../services/ispuHistoryClient';
import { buildIspuHistoryWorkbook } from '../../utils/ispuHistoryExport';
import { Autocomplete, TextField } from '@mui/material';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import { ispuDateRange, nearestArchivedStation, validateGraphRange, wibToday } from '../../domain/ispuHistory';
import type { IspuHistoryExport, IspuHistoryDirectory, IspuHistoryResponse, IspuHistorySelection, IspuRankingEntry, IspuRankingGroup, IspuRankings } from '../../domain/ispuHistory';
import { useIspuHistoryResource } from '../../hooks/useIspuHistoryResource';
import IspuHistoryChart, { IspuCategoryLabel } from './IspuHistoryChart';
import { usesBrowserStorage } from '../../domain/dataMode.ts';
import BrowserDataControls from '../ui/BrowserDataControls';

function RankingsTable({ title, entries, group, onSelect }: { title: string; entries: IspuRankingEntry[]; group: IspuRankingGroup; onSelect: (entry: IspuRankingEntry) => void }) {
  return <section className="ispu-history-ranking"><h3>{title} <span>{entries.length} {group === 'city' ? 'kota' : 'stasiun'}</span></h3>
    {entries.length ? <table><thead><tr><th>#</th><th>{group === 'city' ? 'Kota / provinsi' : 'Stasiun / kota'}</th><th>ISPU</th></tr></thead>
      <tbody>{entries.map((entry, index) => <tr key={entry.id}><td>{index + 1}</td><td><button type="button" onClick={() => onSelect(entry)} aria-label={`Lihat riwayat ${entry.name}`}>
        <strong>{entry.name}</strong><small>{group === 'station' ? `${entry.city} · ${entry.province}` : entry.province}</small>
        {group === 'city' && <small>{entry.stationName} · {entry.stationCount} stasiun layak</small>}
      </button></td><td><b>{entry.value.toLocaleString('id-ID')}</b><IspuCategoryLabel reading={entry} /></td></tr>)}</tbody></table>
      : <p className="ispu-history-message">Tidak ada pengamatan yang layak diperingkat pada tanggal ini.</p>}
  </section>;
}

export default function IspuHistoryPanel({ active, selectedOfficeId, officeSelectionRevision }: { active: boolean; selectedOfficeId: string | null; officeSelectionRevision: number }) {
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState(() => ispuDateRange(30));
  const [group, setGroup] = useState<IspuRankingGroup>('station');
  const [chosenDay, setChosenDay] = useState('');
  const [exportState, setExportState] = useState({ loading: false, error: '' });
  const selectionControls = useRef<HTMLDivElement>(null);
  const office = KPWBI_OFFICES.find(item => item.id === selectedOfficeId) || KPWBI_OFFICES.find(item => item.isKantorPusat)!;
  const contextKey = `${office.id}:${officeSelectionRevision}`;
  const [manual, setManual] = useState<{ contextKey: string; selection: IspuHistorySelection } | null>(null);
  const directory = useIspuHistoryResource<IspuHistoryDirectory>(active, { action: 'directory' }, revision);
  const nearest = directory.data ? nearestArchivedStation(directory.data.stations, office) : null;
  const selection = manual?.contextKey === contextKey ? manual.selection : nearest ? { stationId: nearest.station.stationId } : null;
  const station = selection?.stationId ? directory.data?.stations.find(item => item.stationId === selection.stationId) : null;
  const selectedDistance = station ? nearestArchivedStation([station], office)?.distanceKm : undefined;
  const city = directory.data?.cities.find(item => item.cityKey === (selection?.cityKey || station?.cityKey)) ?? null;
  let rangeError = '';
  try { validateGraphRange(range); } catch (error) { rangeError = error instanceof Error ? error.message : 'Rentang tanggal tidak valid.'; }
  const seriesParams: Record<string, string> | null = selection && !rangeError ? { action: 'series', from: range.from, to: range.to,
    ...(selection.stationId ? { stationId: selection.stationId } : { cityKey: selection.cityKey! }) } : null;
  const history = useIspuHistoryResource<IspuHistoryResponse>(active, seriesParams, revision);
  const days = rangeError ? [] : directory.data?.collectionDates.filter(date => date >= range.from && date <= range.to) ?? [];
  const day = days.includes(chosenDay) ? chosenDay : days.at(-1) ?? '';
  const rankings = useIspuHistoryResource<IspuRankings>(active, day ? { action: 'rankings', date: day, groupBy: group } : null, revision);
  const choose = (value: IspuHistorySelection) => setManual({ contextKey, selection: value });
  const selectRanking = (entry: IspuRankingEntry) => {
    choose(group === 'city' ? { cityKey: entry.id } : { stationId: entry.stationId });
    selectionControls.current?.scrollIntoView({ block: 'start' });
  };
  const handleExportAllStations = async () => {
    if (rangeError || exportState.loading || !directory.data?.stations.length) return;
    setExportState({ loading: true, error: '' });
    try {
      const data = await requestIspuHistory<IspuHistoryExport>({ action: 'export', from: range.from, to: range.to });
      writeFile(buildIspuHistoryWorkbook(data), `ispu_semua_stasiun_${data.from}_sd_${data.to}.xlsx`);
      setExportState({ loading: false, error: '' });
    } catch (error) {
      setExportState({ loading: false, error: error instanceof Error ? error.message : 'Unduhan Excel gagal. Coba lagi.' });
    }
  };
  const retry = () => setRevision(value => value + 1);
  const firstDate = (station || city)?.firstCollectionDate;
  const lastDate = (station || city)?.lastCollectionDate;

  return <aside className="ispu-history-panel" hidden={!active} aria-label="Riwayat ISPU dan peringkat">
    <header className="ispu-history-header"><div><span className="ispu-history-eyebrow">SPKU KEMENLH · ARSIP HARIAN</span><h2>Riwayat kualitas udara</h2></div><button type="button" onClick={retry} aria-label="Muat ulang riwayat ISPU">Muat ulang</button></header>
    <div className="ispu-history-body">
      {usesBrowserStorage() && <><p className="ispu-history-message">Riwayat disimpan saat aplikasi dibuka, paling lama 90 hari sesuai kapasitas browser. Hari yang terlewat tetap kosong. Waktu pengamatan asli dipertahankan.</p><BrowserDataControls /></>}
      <p className="ispu-history-context">Acuan kantor <strong>{office.name}</strong>{manual?.contextKey === contextKey ? ' · Pilihan manual' : ' · Stasiun arsip terdekat'}{selectedDistance !== undefined ? ` · ${selectedDistance.toLocaleString('id-ID', { maximumFractionDigits: 1 })} km` : ''}</p>
      {directory.loading && <p role="status" className="ispu-history-message">Memuat direktori arsip...</p>}
      {directory.error && <div role="alert" className="ispu-history-error">{directory.error}<button type="button" onClick={retry}>Coba lagi</button></div>}
      {directory.data && !directory.data.stations.length && <p className="ispu-history-message">Belum ada arsip ISPU. Data akan tersedia setelah pengumpulan harian berhasil.</p>}
      <div className="ispu-history-selectors" ref={selectionControls}>
        <Autocomplete size="small" slotProps={{ paper: { sx: { typography: 'body1', fontSize: '12px', lineHeight: '1.4375em' } } }} options={directory.data?.cities ?? []} value={city} isOptionEqualToValue={(a, b) => a.cityKey === b.cityKey}
          getOptionLabel={item => `${item.city} · ${item.province}`} onChange={(_, value) => { if (value) choose({ cityKey: value.cityKey }); }}
          renderInput={params => <TextField {...params} label="Kota / kabupaten" />} disableClearable={!!city} />
        <Autocomplete size="small" slotProps={{ paper: { sx: { typography: 'body1', fontSize: '12px', lineHeight: '1.4375em' } } }} options={directory.data?.stations ?? []} value={station ?? null} isOptionEqualToValue={(a, b) => a.stationId === b.stationId}
          getOptionLabel={item => `${item.name || item.stationId} · ${item.city} · ${item.province}`} onChange={(_, value) => { if (value) choose({ stationId: value.stationId }); else if (city) choose({ cityKey: city.cityKey }); }}
          renderInput={params => <TextField {...params} label="Stasiun" placeholder={city ? 'Semua stasiun di kota terpilih' : 'Cari stasiun arsip'} />} />
      </div>
      {city && <p className="ispu-history-note">{city.city}, {city.province} · {station ? '1 stasiun dipilih' : `${city.stationIds.length} garis stasiun`}</p>}
      {!selection && !!directory.data?.stations.length && <p className="ispu-history-message">Koordinat arsip tidak tersedia untuk acuan kantor ini. Pilih kota atau stasiun.</p>}
      <div className="ispu-history-range-actions">
        <div className="ispu-history-presets" aria-label="Rentang riwayat">{[7, 30, 90].map(days => <button key={days} type="button" aria-pressed={range.to === wibToday() && range.from === ispuDateRange(days).from} onClick={() => setRange(ispuDateRange(days))}>{days} hari</button>)}</div>
        <button type="button" className="ispu-history-export" onClick={handleExportAllStations}
          disabled={!!rangeError || exportState.loading || !directory.data?.stations.length} aria-busy={exportState.loading}>
          {exportState.loading ? 'Menyiapkan Excel...' : 'Unduh semua stasiun'}
        </button>
      </div>
      <div className="ispu-history-dates"><label>Dari<input type="date" value={range.from} max={wibToday()} onChange={event => setRange(value => ({ ...value, from: event.target.value }))} /></label><label>Sampai<input type="date" value={range.to} max={wibToday()} onChange={event => setRange(value => ({ ...value, to: event.target.value }))} /></label></div>
      {rangeError && <p role="alert" className="ispu-history-error">{rangeError}</p>}
      {exportState.error && <p role="alert" className="ispu-history-error">{exportState.error}</p>}
      {firstDate && <p className="ispu-history-note">Cakupan arsip pilihan: {firstDate} s.d. {lastDate}.</p>}
      {history.loading && <p role="status" className="ispu-history-message">Memuat grafik riwayat...</p>}
      {history.error && <div role="alert" className="ispu-history-error">{history.error}<button type="button" onClick={retry}>Coba lagi</button></div>}
      {history.data && <IspuHistoryChart key={JSON.stringify(selection)} series={history.data.series} />}

      <section className="ispu-history-rankings" aria-label="Peringkat nasional ISPU">
        <div className="ispu-history-section-heading"><h2>Peringkat nasional</h2><span>Lokasi terpantau</span></div>
        <p className="ispu-history-note">Seluruh arsip Indonesia pada satu tanggal, terlepas dari pilihan grafik.</p>
        <div className="ispu-history-presets" aria-label="Kelompok peringkat">{(['station', 'city'] as const).map(value => <button key={value} type="button" aria-pressed={value === group} onClick={() => setGroup(value)}>{value === 'station' ? 'Stasiun' : 'Kota'}</button>)}</div>
        <label className="ispu-history-day">Tanggal arsip<select value={day} disabled={!days.length} onChange={event => setChosenDay(event.target.value)}>{days.length ? [...days].reverse().map(date => <option value={date} key={date}>{date}</option>) : <option value="">Tidak ada tanggal arsip</option>}</select></label>
        {group === 'city' && <p className="ispu-history-note">Skor kota = ISPU stasiun tertinggi yang layak diperingkat. Bukan pengukuran resmi seluruh kota.</p>}
        {!day && <p className="ispu-history-message">Tidak ada arsip pada rentang tanggal ini.</p>}
        {rankings.loading && <p role="status" className="ispu-history-message">Memuat peringkat...</p>}
        {rankings.error && <div role="alert" className="ispu-history-error">{rankings.error}<button type="button" onClick={retry}>Coba lagi</button></div>}
        {rankings.data && <><p className="ispu-history-note">{rankings.data.eligibleCount} pengamatan layak · {rankings.data.excludedCount} dikecualikan · {rankings.data.rankedCount} {group === 'station' ? 'stasiun' : 'kota'}.</p>
          <p className="ispu-history-note">Pengamatan lama, tanpa waktu, waktu tidak valid, dan waktu masa depan dikecualikan berdasarkan kondisi saat diarsipkan.</p>
          <RankingsTable title="10 Terburuk" entries={rankings.data.worst} group={group} onSelect={selectRanking} />
          <RankingsTable title="10 Terbaik" entries={rankings.data.best} group={group} onSelect={selectRanking} />
        </>}
      </section>
    </div>
  </aside>;
}

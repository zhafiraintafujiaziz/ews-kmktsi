import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Autocomplete, TextField } from '@mui/material';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet';
import { JAKARTA, categoryColor, type IqairDirectory, type IqairLocation, type IqairResult, type Measurement } from '../../domain/iqair';
import './IqairPanel.css';

async function iqairRequest<T>(params: Record<string, string>, signal?: AbortSignal, method = 'GET'): Promise<T> {
  const response = await fetch('/api/iqair?' + new URLSearchParams(params), { signal, method });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'IQAir tidak tersedia.');
  return data as T;
}
const time = (value?: string) => value ? new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB' : 'Tidak diketahui';
const labels: Record<string, string> = { temperature: 'Suhu', humidity: 'Kelembapan', pressure: 'Tekanan', wind: 'Angin', windDirection: 'Arah angin', feltTemperature: 'Suhu terasa', condition: 'Kode kondisi IQAir' };
function Measurements({ values }: { values?: Record<string, Measurement | string> }) {
  if (!values || !Object.keys(values).length) return <p>Tidak tersedia dari sumber ini.</p>;
  return <dl>{Object.entries(values).map(([key, value]) => <div key={key}><dt>{labels[key] || key}</dt><dd>{typeof value === 'string' ? value : `${value.value.toLocaleString('id-ID')} ${value.unit}`}</dd></div>)}</dl>;
}
function MapPosition({ coordinates }: { coordinates?: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.invalidateSize(); map.setView(coordinates ? [coordinates[1], coordinates[0]] : [-2.5, 118], coordinates ? 10 : 4); }, [map, coordinates]);
  return null;
}
const initialProvince: IqairLocation = { id: 'web:jakarta', province: 'Jakarta', websiteUrl: 'https://www.iqair.com/id/air-quality/indonesia/jakarta' };

export default function IqairPanel({ active }: { active: boolean }) {
  const [expanded, setExpanded] = useState(false);
  return <section className={'iqair-view' + (expanded ? ' iqair-view-expanded' : '')} hidden={!active} aria-label="IQAir Indonesia">
    <div className="iqair-source-entry">
      <h2>Peta kualitas udara IQAir</h2>
      <p>Lihat sebaran kualitas udara di Indonesia melalui penanda AQI dan lapisan warna pada peta resmi IQAir.</p>
      <a className="iqair-source-link" href="https://www.iqair.com/id/air-quality-map" target="_blank" rel="noopener noreferrer">Buka peta kualitas udara IQAir <span aria-hidden="true">↗</span></a>
      <p className="iqair-source-note">Dibuka di tab baru. Cakupan data, tampilan awal, dan ketersediaan peta mengikuti IQAir. Peta sebaran nasional tidak ditampilkan di aplikasi ini.</p>
      <button className="iqair-details-toggle" type="button" aria-expanded={expanded} aria-controls="iqair-city-details" onClick={() => setExpanded(value => !value)}>{expanded ? 'Sembunyikan detail kota di aplikasi' : 'Lihat detail kota di aplikasi'}</button>
    </div>
    <div id="iqair-city-details" className="iqair-city-details" hidden={!expanded}>
      <IqairCityDetails active={active && expanded} />
    </div>
  </section>;
}

function IqairCityDetails({ active }: { active: boolean }) {
  const [provinces, setProvinces] = useState<IqairLocation[]>([initialProvince]);
  const [cities, setCities] = useState<IqairLocation[]>([JAKARTA]);
  const [province, setProvince] = useState<IqairLocation | null>(null);
  const [city, setCity] = useState<IqairLocation | null>(null);
  const [citySearch, setCitySearch] = useState('');
  const [crawl, setCrawl] = useState<IqairDirectory['crawl']>();
  const [result, setResult] = useState<{ id: string; value: IqairResult }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [directoryMessage, setDirectoryMessage] = useState('');
  const [url, setUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const addController = useRef<AbortController | null>(null);
  useEffect(() => () => { addController.current?.abort(); }, [active]);
  const [refresh, setRefresh] = useState(0);
  const selectCity = useCallback((location: IqairLocation | null) => { setCity(location); setBusy(!!location); setError(''); }, []);
  const visibleCities = useMemo(() => cities.filter(item => (!province || item.province === province.province) && `${item.city} ${item.province}`.toLocaleLowerCase('id').includes(citySearch.toLocaleLowerCase('id').trim())), [cities, province, citySearch]);

  useEffect(() => {
    if (!active || city) return;
    const controller = new AbortController();
    let timer: number | undefined; let loading = false;
    const load = async () => {
      if (controller.signal.aborted || document.visibilityState === 'hidden' || loading) return;
      window.clearTimeout(timer); loading = true; let delay = 30_000;
      try {
        const data = await iqairRequest<IqairDirectory>({ action: 'all-cities' }, controller.signal);
        if (controller.signal.aborted) return;
        setCities(data.locations); setProvinces(data.provinces || []); setCrawl(data.crawl); setDirectoryMessage(data.message || '');
        delay = data.crawl?.status === 'complete' ? 60_000 : Math.max(15_000, Date.parse(data.crawl?.retryAt || '') - Date.now() || 0);
      } catch (error) { if (!controller.signal.aborted) setDirectoryMessage(error instanceof Error ? error.message : 'Direktori tidak tersedia.'); }
      finally {
        loading = false;
        if (!controller.signal.aborted) timer = window.setTimeout(() => { void load(); }, Math.min(delay, 24 * 3600_000));
      }
    };
    void load(); const onVisible = () => { void load(); }; document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, refresh, city]);
  useEffect(() => {
    if (!active || !city) return;
    const controller = new AbortController();
    let requestController: AbortController | undefined;
    const load = async () => {
      if (document.visibilityState === 'hidden' || requestController) return;
      requestController = new AbortController();
      const abort = () => requestController?.abort(); controller.signal.addEventListener('abort', abort);
      setBusy(true);
      try {
        const value = await iqairRequest<IqairResult>({ action: 'observation', id: city.id }, requestController.signal);
        if (!controller.signal.aborted) { setResult({ id: city.id, value }); setError(''); }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Data IQAir tidak tersedia.');
      } finally {
        controller.signal.removeEventListener('abort', abort); requestController = undefined;
        if (!controller.signal.aborted) setBusy(false);
      }
    };
    // Give the selected observation the website slot after the last directory page.
    const nextDirectoryAt = Date.parse(crawl?.retryAt || '');
    const delay = crawl?.status === 'pending' && nextDirectoryAt > Date.now() && nextDirectoryAt - Date.now() <= 15_000 ? nextDirectoryAt - Date.now() + 50 : 0;
    const initialLoad = window.setTimeout(() => { void load(); }, delay);
    const interval = window.setInterval(() => { void load(); }, 3600_000);
    const onVisible = () => { void load(); }; document.addEventListener('visibilitychange', onVisible);
    return () => { controller.abort(); window.clearTimeout(initialLoad); window.clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); };
  }, [active, city, refresh, crawl?.retryAt, crawl?.status]);
  async function addCity() {
    if (!active || addController.current) return;
    const controller = new AbortController();
    addController.current = controller;
    setAdding(true); setError('');
    try {
      const data = await iqairRequest<{ location: IqairLocation }>({ action: 'add', url }, controller.signal, 'POST');
      if (controller.signal.aborted) return;
      const item = data.location;
      const parent = provinces.find(p => p.province === item.province) || { id: 'web:' + item.id.slice(4).split('/')[0], province: item.province, websiteUrl: item.websiteUrl?.slice(0, item.websiteUrl.lastIndexOf('/')) };
      setProvinces(list => list.some(p => p.id === parent.id) ? list : [...list, parent]);
      setCities(list => list.some(c => c.id === item.id) ? list : [...list, item]); setProvince(null); setCitySearch(''); selectCity(item); setUrl(''); setRefresh(value => value + 1);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'URL tidak dapat ditambahkan.'); }
    finally { addController.current = null; setAdding(false); }
  }
  if (!active) return null;
  const current = result && result.id === city?.id ? result.value : undefined;
  const reading = current?.reading;
  const source = reading?.sourceMethod === 'website' ? 'Website IQAir' : 'API IQAir';
  const coordinates = reading?.coordinates;
  return <div className="iqair-content">
    <aside className="iqair-panel">
      <h2>IQAir Indonesia</h2>
      <p>Pilih kota yang tersedia untuk melihat detail kualitas udara. Daftar ini hanya memuat lokasi yang berhasil dikumpulkan dan belum tentu mencakup seluruh Indonesia.</p>
      <Autocomplete options={provinces} value={province} isOptionEqualToValue={(a, b) => a.id === b.id} getOptionLabel={item => item.province + (item.apiState ? ' · API' : '')} onChange={(_, item) => { setProvince(item); selectCity(null); }} renderInput={params => <TextField {...params} label="Provinsi" placeholder="Semua provinsi" size="small" />} />
      <TextField label="Cari kota atau provinsi" size="small" fullWidth value={citySearch} onChange={event => setCitySearch(event.target.value)} />
      <p className="iqair-message" role="status">{visibleCities.length} dari {cities.length} kota ditemukan. {!province && 'Tanpa filter provinsi.'}</p>
      {crawl && <p className="iqair-message" role="status">{crawl.status === 'complete' ? 'Direktori selesai diperiksa.' : crawl.status === 'paused' ? 'Pengumpulan kota dijeda.' : city ? 'Pengumpulan dilanjutkan saat detail kota ditutup.' : 'Mengumpulkan kota dari halaman publik IQAir...'} {crawl.completedPages}/{crawl.totalPages} halaman direktori diperiksa.{crawl.status === 'paused' && crawl.retryAt && <> Coba kembali: {time(crawl.retryAt)}.</>}</p>}
      {directoryMessage && <p className="iqair-message" role="status">{directoryMessage}</p>}
      <div className="iqair-city-list" aria-label="Daftar kota IQAir">
        {visibleCities.map(item => <button type="button" key={item.id} className={city?.id === item.id ? 'selected' : ''} aria-pressed={city?.id === item.id} onClick={() => selectCity(item)}><strong>{item.city}</strong><span>{item.province}{item.apiCity ? ' · API' : ''}</span></button>)}
        {!visibleCities.length && <p>Tidak ada kota yang cocok. Direktori yang belum terkumpul akan muncul setelah sumber dapat diakses.</p>}
      </div>
      <details><summary>Tambahkan URL kota IQAir</summary><form onSubmit={event => { event.preventDefault(); void addCity(); }}><label htmlFor="iqair-url">URL halaman kota Indonesia</label><input id="iqair-url" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://www.iqair.com/id/air-quality/indonesia/.../..." /><button disabled={adding} type="submit">{adding ? 'Menyimpan...' : 'Tambahkan'}</button></form></details>
      <button className="iqair-refresh" disabled={!city || busy} onClick={() => setRefresh(value => value + 1)}>{busy ? 'Memuat...' : 'Perbarui kota'}</button>
      {city && <button className="iqair-clear-city" onClick={() => selectCity(null)}>Tutup detail kota</button>}
      <p className="iqair-message">Cache satu jam. Pembaruan manual mengikuti jeda dan kuota sumber yang sama.</p>
      {error && <p role="alert">{error}</p>}
      {current?.message && <p role="status">{current.message}</p>}
      {!reading && <p role="status">{busy ? 'Memuat observasi...' : city ? 'Observasi tidak tersedia.' : 'Pilih kota.'}</p>}
      {reading && <>
        <div className="iqair-badges"><span>{current?.delivery === 'cache' ? `Cache · ${source}` : source}</span><span>{current?.freshness === 'outdated' ? 'Data kedaluwarsa' : current?.freshness === 'unknown' ? 'Waktu observasi tidak diketahui' : 'Observasi terkini'}</span></div>
        <section><h3>Kualitas Udara</h3><div className="iqair-index" style={{ borderColor: categoryColor(reading.index.category) }}><strong>{reading.index.value}</strong><span>{reading.index.scale}</span><span>{reading.index.category || 'Kategori tidak tersedia'}</span></div><p>Polutan utama: {reading.index.dominantPollutant || 'Tidak tersedia'}</p>{reading.chinaIndex && <p>China AQI: {reading.chinaIndex.value} · Polutan utama: {reading.chinaIndex.dominantPollutant || 'Tidak tersedia'}</p>}<h4>Konsentrasi</h4><Measurements values={reading.concentrations} /></section>
        <section><h3>Cuaca</h3><Measurements values={reading.weather} /></section>
        {!!reading.forecast?.length && <section><h3>Prakiraan</h3><ul>{reading.forecast.map(entry => <li key={entry.at}>{time(entry.at)}: {entry.index} {entry.scale}</li>)}</ul></section>}
        <section><h3>Lokasi &amp; Pembaruan</h3><dl>
          <div><dt>Kota / provinsi</dt><dd>{reading.location.city} / {reading.location.province}, Indonesia</dd></div>
          <div><dt>Observasi udara</dt><dd>{time(reading.observedAt)}</dd></div><div><dt>Observasi cuaca</dt><dd>{time(reading.weatherObservedAt)}</dd></div><div><dt>Diambil</dt><dd>{time(reading.retrievedAt)}</dd></div>
          <div><dt>Stasiun</dt><dd>{reading.stations ?? 'Tidak tersedia'}</dd></div><div><dt>Kontributor</dt><dd>{reading.contributors ?? 'Tidak tersedia'}</dd></div>
          <div><dt>Koordinat</dt><dd>{coordinates ? `${coordinates[1]}, ${coordinates[0]}` : 'Posisi peta tidak tersedia dari sumber ini.'}</dd></div>
        </dl><a href={reading.sourceUrl} target="_blank" rel="noopener noreferrer">Sumber {source}</a></section>
      </>}
    </aside>
    <div className="iqair-map" aria-label="Peta kota IQAir">
      <MapContainer center={[-2.5, 118]} zoom={4} style={{ height: '100%', width: '100%' }}>
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        <MapPosition coordinates={coordinates} />
        {coordinates && reading && <CircleMarker center={[coordinates[1], coordinates[0]]} radius={12} pathOptions={{ color: categoryColor(reading.index.category), fillOpacity: 0.8 }}><Popup>{reading.location.city}: {reading.index.value} {reading.index.scale}</Popup></CircleMarker>}
      </MapContainer>
      {!coordinates && <p className="iqair-map-message">Posisi peta tidak tersedia. Detail kota tetap ditampilkan saat tersedia.</p>}
    </div>
  </div>;
}

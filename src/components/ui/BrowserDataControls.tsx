import { useRef, useState } from 'react';
import { usesBrowserStorage } from '../../domain/dataMode.ts';
import { exportBrowserBackup, importBrowserBackup } from '../../services/browserPersistence.ts';

export default function BrowserDataControls() {
  const file = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  if (!usesBrowserStorage()) return null;
  const download = () => {
    try {
      const blob = new Blob([JSON.stringify(exportBrowserBackup())], { type: 'application/json' });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'ews-browser-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage('Cadangan diunduh. Simpan berkas ini untuk memindahkan data ke browser lain.');
    } catch { setMessage('Cadangan belum dapat diunduh. Coba kembali.'); }
  };
  return <section className="browser-data-controls" aria-label="Cadangan data browser">
    <p>Tersimpan di browser ini. Data tidak dibagikan ke perangkat lain dan dapat hilang jika penyimpanan browser dihapus.</p>
    <div className="browser-data-actions"><button type="button" onClick={download} disabled={busy}>Unduh cadangan</button>
      <button type="button" onClick={() => file.current?.click()} disabled={busy}>{busy ? 'Mengimpor...' : 'Impor cadangan'}</button></div>
    <input ref={file} hidden type="file" accept="application/json,.json" onChange={async event => {
      const selected = event.target.files?.[0]; event.target.value = '';
      if (!selected) return;
      setBusy(true);
      try {
        if (selected.size > 16 * 1024 * 1024) throw new Error('Berkas cadangan terlalu besar.');
        importBrowserBackup(JSON.parse(await selected.text()));
        setMessage('Cadangan diimpor. Data yang sudah ada dipertahankan.');
      } catch (error) { setMessage(error instanceof Error ? error.message : 'Cadangan tidak valid.'); }
      finally { setBusy(false); }
    }} />
    {message && <p role="status">{message}</p>}
  </section>;
}

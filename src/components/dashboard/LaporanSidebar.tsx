import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { KPWBI_OFFICES } from '../../constants/kpwbiOffices';
import type { KpwbiOffice } from '../../constants/kpwbiOffices';
import type { ReportFields, Report } from '../../domain/persistence';
import { initializePersistence, saveReport } from '../../services/persistenceService';

type LaporanForm = ReportFields;

const EMPTY_FORM: LaporanForm = {
  officeId: '',
  officeName: '',
  sumberGangguan: '',
  lokasi: '',
  penyebab: '',
  dampak: '',
  dampakGedung: '',
  evakuasi: false,
  responCepat: '',
};

const SUMBER_OPTIONS = [
  'Gempa Bumi', 'Banjir', 'Tanah Longsor', 'Angin Kencang',
  'Kebakaran', 'Tsunami', 'Erupsi Gunung Api', 'Cuaca Buruk', 'Lainnya',
];

const LaporanSidebar: React.FC = () => {
  const [form, setForm] = useState<LaporanForm>(EMPTY_FORM);
  const [officeQuery, setOfficeQuery] = useState('');
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');
  const [storageError, setStorageError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const pendingReport = useRef<Report | undefined>(undefined);
  const saving = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    void initializePersistence().catch(() => {
      if (active) setStorageError('Data lama gagal diimpor. Data browser tetap tersimpan; coba simpan kembali.');
    }).finally(() => { if (active) setIsLoading(false); });
    return () => { active = false; };
  }, []);

  const filteredOffices = useMemo(() => {
    if (!officeQuery.trim()) return KPWBI_OFFICES.slice(0, 10);
    const q = officeQuery.toLowerCase();
    return KPWBI_OFFICES.filter(
      (o) => o.name.toLowerCase().includes(q) || o.city.toLowerCase().includes(q)
    ).slice(0, 10);
  }, [officeQuery]);

  const set = <K extends keyof LaporanForm>(field: K, value: LaporanForm[K]) => {
    pendingReport.current = undefined;
    setSavedMsg('');
    setForm((f) => ({ ...f, [field]: value }));
  };

  const handleOfficeSelect = (o: KpwbiOffice) => {
    set('officeId', o.id);
    set('officeName', o.name);
    setOfficeQuery(o.name);
    setDropdownOpen(false);
  };

  const handleExcelUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
        if (rows.length === 0) return;
        const row = rows[0];
        const get = (...keys: string[]) => {
          for (const k of keys) {
            const found = Object.keys(row).find((rk) => rk.toLowerCase().includes(k.toLowerCase()));
            if (found && row[found]) return String(row[found]);
          }
          return '';
        };
        const evakVal = get('evakuasi');
        pendingReport.current = undefined;
        setSavedMsg('');
        setForm((f) => ({
          ...f,
          sumberGangguan: get('sumber', 'gangguan') || f.sumberGangguan,
          lokasi: get('lokasi') || f.lokasi,
          penyebab: get('penyebab') || f.penyebab,
          dampak: get('dampak') || f.dampak,
          dampakGedung: get('gedung', 'bangunan') || f.dampakGedung,
          evakuasi: evakVal ? /^(ya|yes|true|1)/i.test(evakVal) : f.evakuasi,
          responCepat: get('respon', 'response', 'cepat') || f.responCepat,
        }));
      } catch {
        // silently ignore parse errors
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  const handleSave = async () => {
    if (saving.current || isLoading) return;
    saving.current = true;
    setIsSaving(true);
    setStorageError('');
    setSavedMsg('');
    const report = pendingReport.current ?? { ...form, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    pendingReport.current = report;
    try {
      await saveReport(report);
      if (pendingReport.current === report) {
        pendingReport.current = undefined;
        setSavedMsg('Laporan tersimpan!');
      }
    } catch {
      setStorageError('Laporan gagal disimpan. Isian tetap tersedia; silakan coba lagi.');
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  const handleEmail = () => {
    const name = form.officeName || 'KPw BI';
    const subject = encodeURIComponent(
      `[Laporan Gangguan] ${name} — ${form.sumberGangguan || 'Gangguan'} — ${new Date().toLocaleDateString('id-ID')}`
    );
    const body = encodeURIComponent(
      `Yth. Tim Satker DMR,\n\nBerikut laporan gangguan operasional dari ${name}:\n\n` +
      `Sumber Gangguan   : ${form.sumberGangguan}\n` +
      `Lokasi            : ${form.lokasi}\n` +
      `Penyebab          : ${form.penyebab}\n` +
      `Dampak            : ${form.dampak}\n` +
      `Dampak ke Gedung  : ${form.dampakGedung}\n` +
      `Evakuasi          : ${form.evakuasi ? 'Ya' : 'Tidak'}\n` +
      `Respon Cepat      : ${form.responCepat}\n\n` +
      `Hormat kami,\n${name}`
    );
    window.location.href = `mailto:satker.dmr@bi.go.id?subject=${subject}&body=${body}`;
  };

  const canSubmit = !!form.officeId && !!form.sumberGangguan;

  return (
    <div className="laporan-sidebar-inner">
      {/* Header */}
      <div className="laporan-hdr">
        <span className="laporan-hdr-title">Laporan KPw</span>
        <span className="laporan-hdr-sub">Gangguan Operasional</span>
      </div>

      <div className="laporan-scroll">
        {/* Office search */}
        <div className="laporan-field-group">
          <label className="laporan-label">Kantor KPw BI</label>
          <div className="laporan-office-wrap" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropdownOpen(false); }}>
            <input
              className="laporan-input"
              placeholder="Cari nama atau kota..."
              value={officeQuery}
              onChange={(e) => { setOfficeQuery(e.target.value); setDropdownOpen(true); }}
              onFocus={() => setDropdownOpen(true)}
            />
            {dropdownOpen && filteredOffices.length > 0 && (
              <div className="laporan-office-dropdown">
                {filteredOffices.map((o) => (
                  <button
                    key={o.id}
                    className={`laporan-office-option${form.officeId === o.id ? ' selected' : ''}`}
                    onMouseDown={() => handleOfficeSelect(o)}
                  >
                    <span className="laporan-opt-name">{o.name}</span>
                    <span className="laporan-opt-city">{o.city}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Excel autofill */}
        <div className="laporan-autofill-row">
          <button className="laporan-autofill-btn" onClick={() => fileInputRef.current?.click()}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
            </svg>
            Auto-fill dari Excel
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleExcelUpload} />
          <span className="laporan-autofill-hint">.xlsx / .csv</span>
        </div>

        <div className="laporan-divider" />

        {/* Sumber Gangguan */}
        <div className="laporan-field-group">
          <label className="laporan-label">Sumber Gangguan</label>
          <select className="laporan-input" value={form.sumberGangguan} onChange={(e) => set('sumberGangguan', e.target.value)}>
            <option value="">— Pilih sumber —</option>
            {SUMBER_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>

        {/* Lokasi */}
        <div className="laporan-field-group">
          <label className="laporan-label">Lokasi</label>
          <input
            className="laporan-input"
            placeholder="Alamat / titik lokasi gangguan"
            value={form.lokasi}
            onChange={(e) => set('lokasi', e.target.value)}
          />
        </div>

        {/* Penyebab */}
        <div className="laporan-field-group">
          <label className="laporan-label">Penyebab</label>
          <textarea
            className="laporan-textarea"
            rows={2}
            placeholder="Deskripsi penyebab gangguan"
            value={form.penyebab}
            onChange={(e) => set('penyebab', e.target.value)}
          />
        </div>

        {/* Dampak */}
        <div className="laporan-field-group">
          <label className="laporan-label">Dampak</label>
          <textarea
            className="laporan-textarea"
            rows={2}
            placeholder="Dampak terhadap operasional"
            value={form.dampak}
            onChange={(e) => set('dampak', e.target.value)}
          />
        </div>

        {/* Dampak ke Gedung */}
        <div className="laporan-field-group">
          <label className="laporan-label">Dampak Gangguan ke Gedung</label>
          <textarea
            className="laporan-textarea"
            rows={2}
            placeholder="Kerusakan fisik, infrastruktur, dsb."
            value={form.dampakGedung}
            onChange={(e) => set('dampakGedung', e.target.value)}
          />
        </div>

        {/* Evakuasi toggle */}
        <div className="laporan-field-group">
          <label className="laporan-label">Evakuasi</label>
          <div className="laporan-toggle-row">
            <button
              className={`laporan-toggle${form.evakuasi ? ' on' : ''}`}
              onClick={() => set('evakuasi', !form.evakuasi)}
            >
              <span className="laporan-toggle-knob" />
            </button>
            <span className="laporan-toggle-label">{form.evakuasi ? 'Ya — evakuasi dilakukan' : 'Tidak — tidak ada evakuasi'}</span>
          </div>
        </div>

        {/* Respon Cepat */}
        <div className="laporan-field-group">
          <label className="laporan-label">Respon Cepat</label>
          <textarea
            className="laporan-textarea"
            rows={2}
            placeholder="Tindakan yang sudah dilakukan"
            value={form.responCepat}
            onChange={(e) => set('responCepat', e.target.value)}
          />
        </div>

        <div className="laporan-divider" />

        {/* Actions */}
        <div className="laporan-actions">
          <button className="laporan-btn-save" onClick={() => void handleSave()} disabled={!canSubmit || isLoading || isSaving}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
            </svg>
            {isSaving ? 'Menyimpan...' : 'Simpan Laporan'}
          </button>
          <button className="laporan-btn-email" onClick={handleEmail} disabled={!canSubmit}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            Kirim Email
          </button>
        </div>

        {isLoading && <p role="status">Memuat penyimpanan laporan...</p>}
        {storageError && <p role="alert">{storageError}</p>}
        {savedMsg && <div className="laporan-saved-toast" role="status">{savedMsg}</div>}
      </div>
    </div>
  );
};

export default LaporanSidebar;

import React, { useState, useEffect } from 'react';
import { InaSiamService, REGIONAL_SEAPORTS } from '../../services/inaSiamService';
import type { ClosedAirportInfo } from '../../types';
import { renderDisasterIcon } from '../../utils/alertUtils';
import './PerkiraanScreen.css';

interface VolcanoDetail {
  id: string;
  name: string;
  location: string;
  province: string;
  nearestKpw: string;
  flightLevel: string;
  windDirection: string;
  windBearing: number;
  statusLevel: string;
  statusClass: string;
  image: string;
  impactAirports: string;
  notes: string;
}

const VOLCANO_DETAILS: VolcanoDetail[] = [
  {
    id: 'lewotobi',
    name: 'G. Lewotobi Laki-Laki',
    location: 'Flores Timur, Nusa Tenggara Timur',
    province: 'Nusa Tenggara Timur',
    nearestKpw: 'KPw BI Provinsi Nusa Tenggara Timur (Kupang)',
    flightLevel: 'FL100 - FL140 (± 3.000 - 4.200 m dpl)',
    windDirection: 'Barat Daya (WSW / 247.5°)',
    windBearing: 247.5,
    statusLevel: 'Level IV (Awas)',
    statusClass: 'critical',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Lewotobi.png',
    impactAirports: 'Bandara Wunopito Lewoleba (WATW - Closed), Bandara Frans Seda Maumere (WATO)',
    notes: 'Aktivitas erupsi eksplosif berulang menyemburkan abu vulkanik ke arah barat daya. Menimbulkan penutupan operasional ruang udara dan bandara di sekitarnya.',
  },
  {
    id: 'krakatau',
    name: 'G. Anak Krakatau',
    location: 'Selat Sunda, Lampung / Banten',
    province: 'Lampung',
    nearestKpw: 'KPw BI Provinsi Lampung & KPw BI Provinsi Banten',
    flightLevel: 'FL070 - FL110 (± 2.100 - 3.300 m dpl)',
    windDirection: 'Barat Daya (SW / 225°)',
    windBearing: 225,
    statusLevel: 'Level III (Siaga)',
    statusClass: 'warning',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Anak_Krakatau.png',
    impactAirports: 'Bandara Radin Inten II Lampung (WILL), Bandara Soekarno-Hatta (WIII - koridor Selatan)',
    notes: 'Erupsi abu vulkanik ke arah perairan Selat Sunda dan Samudra Hindia. Jalur pelayaran kapal penyeberangan Bakauheni - Merak dalam pengawasan visibilitas.',
  },
  {
    id: 'semeru',
    name: 'G. Semeru',
    location: 'Lumajang & Malang, Jawa Timur',
    province: 'Jawa Timur',
    nearestKpw: 'KPw BI Malang & KPw BI Provinsi Jawa Timur (Surabaya)',
    flightLevel: 'FL140 (± 4.200 m dpl)',
    windDirection: 'Barat Daya (WSW / 250°)',
    windBearing: 250,
    statusLevel: 'Level III (Siaga)',
    statusClass: 'warning',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Semeru.png',
    impactAirports: 'Bandara Abdul Rachman Saleh Malang (WARA), Bandara Juanda Surabaya (WARR)',
    notes: 'Kolom abu vulkanik dan awan panas guguran (APG) mengarah ke barat daya dan selatan, mempengaruhi rute udara koridor Jawa bagian timur.',
  },
  {
    id: 'ibu',
    name: 'G. Ibu',
    location: 'Halmahera Barat, Maluku Utara',
    province: 'Maluku Utara',
    nearestKpw: 'KPw BI Provinsi Maluku Utara (Ternate)',
    flightLevel: 'FL090 (± 2.700 m dpl)',
    windDirection: 'Timur Laut (NE / 45°)',
    windBearing: 45,
    statusLevel: 'Level III (Siaga)',
    statusClass: 'warning',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Ibu.png',
    impactAirports: 'Bandara Sultan Babullah Ternate (WAEE), Bandara Kuabang Kao (WAEK)',
    notes: 'Lontaran abu vulkanik tebal mengarah ke timur laut menuju Samudra Pasifik.',
  },
  {
    id: 'dukono',
    name: 'G. Dukono',
    location: 'Halmahera Utara, Maluku Utara',
    province: 'Maluku Utara',
    nearestKpw: 'KPw BI Provinsi Maluku Utara (Ternate)',
    flightLevel: 'FL080 (± 2.400 m dpl)',
    windDirection: 'Timur Laut (ENE / 60°)',
    windBearing: 60,
    statusLevel: 'Level II (Waspada)',
    statusClass: 'watch',
    image: 'https://inderaja.bmkg.go.id/Trajektori/Dukono.png',
    impactAirports: 'Bandara Gamarmalamo Galela (WAEG), Bandara Kuabang Kao',
    notes: 'Erupsi menerus dengan kepulan abu vulkanik ke arah timur dan timur laut melintasi wilayah Tobelo.',
  },
];

const AbuVulkanikView: React.FC = () => {
  const [selectedVolcanoId, setSelectedVolcanoId] = useState<string>('lewotobi');
  const [closedAirports, setClosedAirports] = useState<ClosedAirportInfo[]>([]);
  const [loadingAviation, setLoadingAviation] = useState<boolean>(true);
  const [imgModalOpen, setImgModalOpen] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    InaSiamService.fetchClosedAirports()
      .then((airports) => {
        if (mounted) {
          setClosedAirports(airports);
          setLoadingAviation(false);
        }
      })
      .catch(() => {
        if (mounted) setLoadingAviation(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const currentVolcano = VOLCANO_DETAILS.find((v) => v.id === selectedVolcanoId) || VOLCANO_DETAILS[0];

  return (
    <div className="abu-vulkanik-container" style={{ padding: '16px', overflowY: 'auto', height: '100%' }}>
      {/* Header Info Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(234, 88, 12, 0.12), rgba(220, 38, 38, 0.08))',
        border: '1px solid rgba(234, 88, 12, 0.3)',
        borderRadius: '8px',
        padding: '14px 18px',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '28px' }}>
            {renderDisasterIcon('volcanic_ash', undefined, { width: '32px', height: '32px' })}
          </span>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-primary)' }}>
              Monitoring Sebaran Abu Vulkanik & Dampak Transportasi
            </h2>
            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
              Integrasi BMKG INA-SIAM (Aviation Meteorology), VAAC Darwin & Data Operasional Bandara/Dermaga
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <a
            href="https://inasiam.bmkg.go.id"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#ea580c',
              background: '#fff',
              border: '1px solid rgba(234, 88, 12, 0.4)',
              borderRadius: '6px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Portal INA-SIAM ↗
          </a>
          <a
            href="https://web-aviation.bmkg.go.id/va-map.php"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              padding: '6px 12px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#dc2626',
              background: '#fff',
              border: '1px solid rgba(220, 38, 38, 0.4)',
              borderRadius: '6px',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            Peta Bandara BMKG ↗
          </a>
        </div>
      </div>

      {/* Real-time Closed Airport Alert */}
      <div style={{
        background: '#fef2f2',
        border: '1.5px solid #f87171',
        borderRadius: '8px',
        padding: '14px 18px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#b91c1c', fontWeight: 700, fontSize: '13px' }}>
            <span style={{ fontSize: '18px' }}>⛔</span>
            <span>STATUS PENUTUPAN BANDARA (AERODROME CLOSED)</span>
          </div>
          <span style={{ fontSize: '11px', color: '#991b1b', background: '#fee2e2', padding: '3px 8px', borderRadius: '4px', fontWeight: 600 }}>
            Live NOTAM Aviation BMKG
          </span>
        </div>

        {closedAirports.length === 0 && !loadingAviation ? (
          <div style={{ fontSize: '12px', color: '#15803d' }}>
            ✅ Seluruh stasiun bandara regional saat ini berstatus OPEN (tidak ada penutupan ruang udara aktif).
          </div>
        ) : (
          closedAirports.map((ap) => (
            <div key={ap.icao} style={{
              background: '#ffffff',
              border: '1px solid #fecaca',
              borderRadius: '6px',
              padding: '10px 14px',
              marginTop: '6px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: '#991b1b' }}>
                  {ap.name} ({ap.icao})
                </span>
                <span style={{
                  background: '#dc2626',
                  color: '#fff',
                  fontSize: '10.5px',
                  fontWeight: 700,
                  padding: '2px 8px',
                  borderRadius: '4px'
                }}>
                  {ap.reason}
                </span>
              </div>
              <div style={{ fontSize: '11.5px', color: '#7f1d1d', marginTop: '4px' }}>
                {ap.detail}
              </div>
              <div style={{ fontSize: '11px', color: '#b91c1c', marginTop: '6px', fontWeight: 500 }}>
                💡 <strong>Dampak Logistik KPw BI:</strong> Pengiriman uang kartal / operasional perbankan di Kepulauan Solor & Lembata dialihkan sementara melalui moda transportasi kapal penyeberangan laut via Pelabuhan Larantuka.
              </div>
            </div>
          ))
        )}
      </div>

      {/* Main Grid: Volcano Trajectory & Details */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px', marginBottom: '16px' }}>
        {/* Left Card: Volcano Selector & Trajectory Image */}
        <div style={{
          background: 'var(--bg-panel, #ffffff)',
          border: '1px solid var(--border-default, #e2e8f0)',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <div style={{ fontWeight: 700, fontSize: '13px', marginBottom: '12px', color: 'var(--text-primary)' }}>
            Pilih Gunung Api Terpantau INA-SIAM:
          </div>

          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '14px' }}>
            {VOLCANO_DETAILS.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVolcanoId(v.id)}
                style={{
                  padding: '6px 12px',
                  fontSize: '11.5px',
                  fontWeight: selectedVolcanoId === v.id ? 700 : 500,
                  borderRadius: '6px',
                  cursor: 'pointer',
                  border: selectedVolcanoId === v.id ? '2px solid #ea580c' : '1px solid var(--border-default)',
                  background: selectedVolcanoId === v.id ? 'rgba(234, 88, 12, 0.12)' : 'var(--bg-secondary, #f8fafc)',
                  color: selectedVolcanoId === v.id ? '#ea580c' : 'var(--text-primary)'
                }}
              >
                {v.name}
              </button>
            ))}
          </div>

          {/* Satellite Image Display */}
          <div style={{ textAlign: 'center' }}>
            <div style={{
              position: 'relative',
              background: '#0f172a',
              borderRadius: '6px',
              overflow: 'hidden',
              border: '1px solid var(--border-default)',
              minHeight: '220px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <img
                src={currentVolcano.image}
                alt={`Citra Trajektori ${currentVolcano.name}`}
                style={{ width: '100%', maxHeight: '280px', objectFit: 'contain', cursor: 'pointer' }}
                onClick={() => setImgModalOpen(true)}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', fontSize: '11px', color: 'var(--text-secondary)' }}>
              <span>Analisis Satelit Citra Sebaran Abu BMKG</span>
              <a
                href={currentVolcano.image}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#ea580c', fontWeight: 600, textDecoration: 'none' }}
              >
                Buka Ukuran Asli ↗
              </a>
            </div>
          </div>
        </div>

        {/* Right Card: Volcano Meteorological & Risk Parameters */}
        <div style={{
          background: 'var(--bg-panel, #ffffff)',
          border: '1px solid var(--border-default, #e2e8f0)',
          borderRadius: '8px',
          padding: '16px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between'
        }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>
                {currentVolcano.name}
              </h3>
              <span style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '3px 8px',
                borderRadius: '4px',
                background: currentVolcano.statusClass === 'critical' ? '#fee2e2' : '#fef3c7',
                color: currentVolcano.statusClass === 'critical' ? '#b91c1c' : '#92400e',
                border: currentVolcano.statusClass === 'critical' ? '1px solid #fca5a5' : '1px solid #fde68a'
              }}>
                {currentVolcano.statusLevel}
              </span>
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
              📍 {currentVolcano.location}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border-default)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Ketinggian Kolom Abu (FL):</span>
                <span style={{ fontWeight: 600 }}>{currentVolcano.flightLevel}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border-default)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Arah Dispersi Angin:</span>
                <span style={{ fontWeight: 600, color: '#ea580c' }}>🧭 {currentVolcano.windDirection}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border-default)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Koridor Bandara:</span>
                <span style={{ fontWeight: 500, textAlign: 'right', maxWidth: '60%' }}>{currentVolcano.impactAirports}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px dashed var(--border-default)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Kantor KPw BI Terkait:</span>
                <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{currentVolcano.nearestKpw}</span>
              </div>
            </div>

            <div style={{ marginTop: '12px', padding: '10px', background: 'var(--bg-secondary, #f8fafc)', borderRadius: '6px', fontSize: '11.5px', color: 'var(--text-primary)', lineHeight: 1.4 }}>
              <strong>Keterangan BMKG:</strong> {currentVolcano.notes}
            </div>
          </div>

          <div style={{
            marginTop: '14px',
            padding: '8px 12px',
            background: 'rgba(234, 88, 12, 0.08)',
            border: '1px solid rgba(234, 88, 12, 0.2)',
            borderRadius: '6px',
            fontSize: '11px',
            color: '#c2410c'
          }}>
            ℹ️ Pada peta Leaflet dashboard, sebaran abu dimodelkan dengan poligon pentagon warna merah dengan garis kontur kuning tegas serta panah arah vektor angin sesuai standar INA-SIAM.
          </div>
        </div>
      </div>

      {/* Regional Seaports / Dermaga Monitoring */}
      <div style={{
        background: 'var(--bg-panel, #ffffff)',
        border: '1px solid var(--border-default, #e2e8f0)',
        borderRadius: '8px',
        padding: '16px',
        marginBottom: '16px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700, fontSize: '13px', color: '#1e40af' }}>
            <span style={{ fontSize: '18px' }}>🚢</span>
            <span>PEMANTAUAN DERMAGA KAPAL & PELABUHAN PENYEBERANGAN REGIONAL</span>
          </div>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
            Simpul Transportasi Alternatif Jika Bandara Ditutup
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '10px' }}>
          {REGIONAL_SEAPORTS.map((port, idx) => (
            <div key={idx} style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              padding: '10px 12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: 600, fontSize: '12px', color: '#1e3a8a' }}>
                  {port.name}
                </span>
                <span style={{
                  fontSize: '10px',
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: '4px',
                  background: port.status.includes('Waspada') ? '#fef3c7' : '#e0f2fe',
                  color: port.status.includes('Waspada') ? '#92400e' : '#0369a1'
                }}>
                  {port.status}
                </span>
              </div>
              <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                📍 {port.regency}
              </div>
              <div style={{ fontSize: '10.5px', color: '#475569', marginTop: '4px' }}>
                {port.note}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* KPw BI Mitigasi & Protokol Kesiapsiagaan */}
      <div style={{
        background: 'var(--bg-panel, #ffffff)',
        border: '1px solid var(--border-default, #e2e8f0)',
        borderRadius: '8px',
        padding: '16px'
      }}>
        <h3 style={{ margin: '0 0 12px 0', fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)' }}>
          🛡️ Protokol Mitigasi Dampak Abu Vulkanik bagi Kantor Perwakilan BI
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
          <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 600, fontSize: '12px', color: '#ea580c', marginBottom: '6px' }}>
              1. Proteksi Server DRC & Ruang Data Center
            </div>
            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Partikel abu silika bersifat abrasif dan dapat menimbulkan hubungan arus pendek jika bercampur kelembaban. Tutup rapat damper udara luar HVAC dan siapkan filter silika cadangan.
            </p>
          </div>

          <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 600, fontSize: '12px', color: '#ea580c', marginBottom: '6px' }}>
              2. Kontinjensi Distribusi Uang Kas (PUR)
            </div>
            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Jika bandara ditutup (NOTAM <em>aerodrome closed</em>), aktifkan skema kontinjensi pasokan uang kartal lewat jalur laut (kapal ASDP) atau pengawalan darat dari KPw korwil terdekat.
            </p>
          </div>

          <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 600, fontSize: '12px', color: '#ea580c', marginBottom: '6px' }}>
              3. Keselamatan Personel & APD Masker N95
            </div>
            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
              Pastikan stok masker respirator partikulat N95/FFP2 dan kacamata pelindung (goggles) siap didistribusikan kepada seluruh pegawai dan keluarga bila terjadi hujan abu.
            </p>
          </div>
        </div>
      </div>

      {/* Satellite Image Lightbox Modal */}
      {imgModalOpen && (
        <div
          onClick={() => setImgModalOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.85)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            cursor: 'zoom-out'
          }}
        >
          <div style={{ position: 'relative', maxWidth: '92vw', maxHeight: '92vh', textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', color: '#fff' }}>
              <span style={{ fontWeight: 600, fontSize: '14px' }}>Citra Trajektori Satelit - {currentVolcano.name}</span>
              <button
                onClick={() => setImgModalOpen(false)}
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  border: 'none',
                  color: '#fff',
                  fontSize: '14px',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                ✕ Tutup
              </button>
            </div>
            <img
              src={currentVolcano.image}
              alt={currentVolcano.name}
              style={{ maxWidth: '100%', maxHeight: '82vh', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.3)', objectFit: 'contain' }}
            />
          </div>
        </div>
      )}
    </div>
  );
};

export default AbuVulkanikView;
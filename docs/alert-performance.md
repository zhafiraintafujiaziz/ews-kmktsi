# Optimasi pemuatan alert

Pengukuran lokal pada 8 Oktober 2026 membandingkan source sebelum dan sesudah perubahan. Tidak ada dependency baru, perubahan API/database, atau perubahan rumus risiko.

## Perubahan

Controller alert dipisahkan dari React. Cache dan feed dimuat paralel, hasil tiap feed diterapkan segera, dan publikasi pada giliran microtask yang sama digabung. Snapshot mempertahankan referensi payload yang tidak berubah, sementara hook dashboard berlangganan hanya ke field yang diperlukan.

Dashboard menggunakan indeks risiko berdasarkan ID, callback stabil, serta peta dengan `React.memo`. Kerentanan dan Perkiraan dimuat ketika pengguna membuka layar tersebut. Waktu selesai polling dan revision assessment tetap memperbarui peta.

## Pengukuran browser

Chrome headless, Vite development, React StrictMode, viewport desktop 1440 × 1000. Kedua versi menggunakan 120 alert gempa sintetis identik, cache kosong, serta feed dengan jeda 150 ms, 650 ms, dan 1800 ms. Persistence dan assessment regional menggunakan stub; tile eksternal tidak diunduh. Pengukuran diulang setelah kedua versi selesai dimuat sekali untuk mengurangi pengaruh kompilasi awal Vite.

Waktu data pertama dihitung dari dimulainya feed pertama sampai MutationObserver mendeteksi kartu alert. Counter sementara menghitung pemanggilan fungsi render/kalkulasi, termasuk pengulangan StrictMode. Instrumentasi hanya berada dalam file sementara, tidak dalam kode aplikasi.

| Metrik setelah warmup | Sebelum | Sesudah |
| --- | ---: | ---: |
| Data live pertama tampil | 2098 ms | 435 ms |
| Data pertama tampil sebelum feed lambat selesai | Tidak | Ya |
| Pemanggilan render EwsMap saat progres metadata saja | 2 | 0 |
| Pemanggilan render EwsMap dalam refresh dengan payload identik | 4 | 2 |
| Evaluasi kalkulasi risiko dalam refresh tersebut | 2 | 0 |
| Waktu kalkulasi risiko dalam refresh tersebut | 2,8 ms | 0 ms |

Dua pemanggilan render peta yang tersisa berasal dari pembaruan waktu selesai polling dalam StrictMode. Pembaruan ini sengaja dipertahankan untuk menyegarkan layer assessment. Pengukuran ini membuktikan penghilangan waktu tunggu antar-feed dan pekerjaan berulang pada fixture, bukan jaminan latency API live.

## Validasi

- Seluruh 105 tes berhasil, termasuk 16 tes controller baru dengan waktu dan deferred promises yang dikendalikan.
- Kasus baru mencakup cache cepat/lambat/kedaluwarsa, hasil live kosong, kegagalan/timeout, urutan feed, perubahan payload bersarang, batching publikasi, expiry saat refresh gagal, cancellation persistence/cache, serta replay subscription StrictMode.
- Lint dan build produksi berhasil. Entry JavaScript turun dari 888,08 kB menjadi 842,40 kB, atau dari 271,06 kB menjadi 259,20 kB gzip. Layar Kerentanan dan Perkiraan menjadi chunk terpisah sebesar 9,17 kB dan 40,97 kB sebelum kompresi.
- Browser memverifikasi filter, pilihan alert dan popup peta, collapse/reopen sidebar, navigasi lazy, assessment revision, pesan sumber gagal, serta tampilan desktop/mobile. Kode layar lazy tidak diunduh saat pembukaan dashboard.
- Tidak ada request ke layanan live atau penulisan ke database aplikasi selama pengukuran browser.

Build tetap memiliki peringatan Vite tentang entry chunk yang melebihi 500 kB. Pemecahan lebih lanjut atas dependency peta/UI berada di luar perubahan ini.

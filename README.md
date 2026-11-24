# e-TTD Berita Acara — Forum Satu Data Kabupaten Berau 2026

Aplikasi penandatanganan kolaboratif **multiplayer realtime** untuk **Berita Acara Kesepakatan Forum Satu Data Kabupaten Berau Tahun 2026** (Rabu, 25 November 2026 — Ruang Rapat RKPD Bapperida Kabupaten Berau).

## Fitur Utama

- **Kolaborasi Realtime (WebSocket)**: Seluruh peserta dapat melihat tanda tangan yang masuk secara langsung dan melanjutkan baris masing-masing. Baris yang sedang diisi peserta lain otomatis ditandai *Sedang diisi...* agar tidak saling menimpa.
- **Tanda Tangan Otomatis Halus (Auto-Beautify Ink Ribbon)**: Menggunakan penyaring *streamline*, pembagian kurva *Chaikin* 3 tahap, perataan ketebalan Gaussian, serta ujung pena runcing (*taper*) sehingga goresan yang lambat atau sempat berhenti tetap halus dan rapi seperti tinta pena asli.
- **Opsi Unggah Gambar TTD**: Mendukung PNG/JPG/WebP dengan penghapus latar belakang kertas putih otomatis (slider kejernihan + opsi warna tinta + auto-crop transparan).
- **Mewakili (`a.n.`) & Tambah Nama**: Mendukung penandatanganan perwakilan beserta nama/jabatan, slot Pimpinan Rapat (Bupati), 54 pejabat dari file Word asli, serta penambahan peserta baru.
- **Export Lengkap & Per Orang (Word + PDF)**:
  - **Berita Acara Lengkap (`.docx`)**: Menyuntikkan tanda tangan langsung ke template Word asli (`templates/berita-acara-template.docx`, ukuran F4/Folio).
  - **Berita Acara Lengkap (`.pdf`)**: Siap cetak ukuran F4 (`215 × 330 mm`) dengan header tabel berulang tiap halaman.
  - **Bukti Per Orang (`.docx`, `.pdf`, `.png`)**, **Arsip ZIP Semua Peserta**, dan **Rekap Excel (`.csv`)**.
- **Kode Rapat & Mode Panitia (PIN)**: Peserta masuk dengan Kode Rapat (`SDI2026`), sedangkan Panitia (PIN `202600`) dapat mengubah kode, mengunci dokumen final, mengedit nama/jabatan, atau mengatur ulang tanda tangan.

---

## Menjalankan Lokal

```bash
npm install
npm start
```

Buka `http://localhost:3000` (Kode Rapat default: `SDI2026`, PIN Panitia default: `202600`).

---

## Deploy 100% Gratis + Custom Domain Sendiri

Karena aplikasi membutuhkan **Node.js + WebSocket realtime**, opsi **gratis terbaik** yang mendukung **domain sendiri (gratis SSL HTTPS)** adalah:

### Pilihan Terbaik (Gratis + Data Permanen): **Render Free + Neon PostgreSQL Free**
1. **Siapkan Database Gratis** di [neon.tech](https://neon.tech) (sign in dengan GitHub → buat project baru → salin **Connection String** `postgresql://...`).
2. **Upload folder ini ke GitHub** (repository public/private).
3. **Deploy di [render.com](https://render.com)**:
   - Login dengan GitHub → klik **New + → Blueprint** (otomatis membaca `render.yaml`) atau **Web Service** → pilih repo Anda.
   - Masukkan Environment Variables:
     - `DATABASE_URL` = connection string dari Neon
     - `MEETING_CODE` = `SDI2026` (atau sesuai keinginan)
     - `ADMIN_PIN` = `202600` (atau sesuai keinginan)
   - Klik **Deploy**.
4. **Hubungkan Domain Anda** (gratis SSL):
   - Di dashboard Render service → **Settings → Custom Domains → Add Custom Domain** (misal `ttd.domainanda.com` atau `domainanda.com`).
   - Masukkan record DNS (`CNAME` untuk subdomain atau `A` untuk root domain) yang diberikan Render ke panel DNS registrar domain Anda (Cloudflare / Niagahoster / Rumahweb / DomaiNesia / Namecheap).
   - Dalam beberapa menit SSL HTTPS aktif otomatis dan WebSocket `wss://` langsung berjalan!

### Alternatif Gratis Lain: **Koyeb Free Tier** (`koyeb.com`)
- Mendukung Node.js + WebSocket + Custom Domain + free PostgreSQL langsung dalam satu platform (membaca `Dockerfile` atau Node buildpack otomatis).

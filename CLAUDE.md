# Felis-Alyssa — Alyssa Auto Logistik

## Batasan wajib

**Project ini terisolasi.** Satu-satunya database yang boleh disentuh adalah
Supabase project `alyssa-logistik` milik Alyssa Logistics.

Dilarang membaca, mengubah, menghapus, atau menjalankan migration ke database
atau project lain — termasuk FreightWise, `fleet-photos`, dan project apa pun
yang sudah ada sebelumnya. Kalau kredensial yang terpasang menunjuk ke project
lain, berhenti dan laporkan; jangan lanjutkan.

`scripts/health-check.js` mencetak **project ref** yang sedang dituju. Jalankan
itu sebelum migration untuk memastikan sasarannya benar.

## Arsitektur

Tanpa framework dan tanpa build step — disengaja, jangan ditambahkan tanpa alasan.

| Lapisan | Isi |
|---|---|
| `src/server.js` | Express. Memuat API belakangan supaya kredensial kosong menghasilkan 503 yang jelas, bukan crash |
| `src/api.js` | Router. Semua akses database lewat sini |
| `src/supabase.js` | Client publik (anon) dan admin (service_role), dipisah |
| `public/` | SPA vanilla JS, hash router |
| `supabase/migrations/` | Skema, dijalankan berurutan lewat SQL Editor |

## Keamanan

Row Level Security aktif di semua tabel **tanpa policy apa pun**. Kunci anon
tidak bisa membaca maupun menulis; seluruh akses wajib lewat API server yang
memegang `service_role`. Kunci admin tidak pernah dikirim ke browser.

Kalau nanti frontend perlu akses langsung ke Supabase, tambahkan policy secara
eksplisit per tabel — jangan mematikan RLS.

## Catatan terbuka

**Belum ada authentication.** Keputusan pemilik project: lanjutkan tanpa membuat
sistem login dulu. Konsekuensinya, siapa pun yang tahu URL-nya bisa mengakses
seluruh data lewat `/api`, termasuk data Rekonsiliasi Bank nanti. Ini disadari
dan diterima, bukan kelalaian. Tinjau ulang sebelum aplikasi dipakai lebih luas
dari lingkaran internal.

## Konvensi

- Nama tabel, kolom, variabel, dan teks antarmuka memakai bahasa Indonesia
- Uang: `numeric(14,2)`; tampilkan lewat formatter `rupiah` di `public/app.js`
- Tanggal transaksi disimpan sebagai `date`, bukan `timestamptz` — menghindari
  bug geser satu hari karena timezone
- Nilai dari database selalu lewat `aman()` sebelum ditempel sebagai HTML
- Endpoint hanya menerima kolom yang di-whitelist (lihat `saring()` di `api.js`)

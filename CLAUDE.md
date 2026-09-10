# Felis-Alyssa — Alyssa Auto Logistik

## Batasan wajib

**Project ini terisolasi.** Satu-satunya database yang boleh disentuh adalah
project Supabase milik Alyssa Logistics: akun `alyssalogistik@gmail.com`,
organisasi `organisasi-alyssa`, region `ap-southeast-1`.

Yang menentukan sasaran adalah **project ref**, bukan nama tampilannya. Nama
tampilan di dashboard saat ini masih bawaan (`alyssalogistik's Project`) dan
boleh berubah sewaktu-waktu; ref tidak. Ref yang berlaku dicatat di
`SUPABASE_PROJECT_REF` pada environment, dan itulah yang diperiksa mesin.

Isolasi ini berlaku untuk **semua** milik Sean/Seanniel, bukan database saja:
akun, repository, environment, environment variable, dan deployment. Termasuk
FreightWise, `fleet-photos`, `syhhalyssaherman-oss/*`, dan project apa pun yang
sudah ada sebelumnya.

Sebelum aksi apa pun yang menyentuh GitHub, Supabase, Railway, environment
variable, atau deployment: **verifikasi dulu targetnya milik Alyssa Logistics.**
Kalau target tidak bisa dipastikan, atau kredensial menunjuk ke tempat lain,
berhenti dan laporkan. Jangan lanjutkan, jangan menebak.

Isolasi ini tidak lagi bergantung pada ingatan. Isi `SUPABASE_PROJECT_REF`
dengan ref project Alyssa, dan aplikasi akan **menolak menyala** ketika
kredensial menunjuk ke project lain: `/api` mati dengan 503 dan alasannya
dicetak ke log. Penjaga itu berjalan sebelum satu pun query terkirim.

`scripts/health-check.js` mencetak project ref yang sedang dituju dan gagal
keras bila tidak cocok. Jalankan itu sebelum migration.

## Memasang skema

`supabase/migrations/` adalah sumber kebenaran. `supabase/setup-lengkap.sql`
**dihasilkan** dari sana oleh `node scripts/bangun-setup.js` — jangan disunting
langsung; ubah migration-nya lalu bangun ulang.

Berkas hasilnya sengaja berupa **satu** blok `DO`, bukan rangkaian perintah.
SQL Editor Supabase menjalankan hanya teks yang tersorot bila ada seleksi
aktif, dan di layar sentuh seleksi liar mudah terjadi tanpa disadari. Sebagai
banyak perintah, sorotan yang meleset memasang sebagian skema dan menyisakan
database setengah jadi; sebagai satu perintah, hasilnya hanya seluruhnya masuk
atau tidak ada yang berubah sama sekali.

Baris terakhirnya memanggil `pg_notify('pgrst', 'reload schema')`. Tanpa itu
PostgREST masih memakai peta skema lama dan tetap melaporkan tabel baru sebagai
`Could not find the table ... in the schema cache` walaupun tabelnya sudah ada.

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

## Keputusan pustaka: pembaca spreadsheet

Memakai **exceljs**, bukan `xlsx` (SheetJS).

`xlsx` di npm berhenti di 0.18.5 dengan dua peringatan **high** yang berstatus
"no fix available" — prototype pollution dan ReDoS. Versi perbaikannya hanya
didistribusikan lewat CDN SheetJS sendiri, tidak lewat npm. Jalur kode yang
rentan justru jalur yang kita pakai: mengurai berkas yang diunggah pengguna.

Konsekuensinya, `.xls` format lama (wadah OLE2) tidak didukung. Berkas seperti
itu ditolak dengan petunjuk agar disimpan ulang sebagai `.xlsx`. WPS dan Excel
sudah menyimpan `.xlsx` secara bawaan.

Sisa peringatan `npm audit` yang diketahui: **uuid** melalui exceljs
(GHSA-w5hq-g745-h8pq, moderate). Tidak terjangkau — peringatan itu mengenai
`v3/v5/v6` ketika argumen `buf` diberikan, sedangkan exceljs hanya memanggil
`uuidv4()`. Perbaikannya menurunkan exceljs ke 3.4.0 yang jauh lebih tua, jadi
peringatan ini dibiarkan secara sadar. Tinjau ulang saat exceljs memperbarui
dependensinya.

## Audit pembayaran supplier

Aturan pencocokan hanya ada di `src/rekonsiliasi/pencocokan.js` — murni, tanpa
I/O, dan tidak ditulis ulang dalam SQL. Kalau logikanya disalin ke database,
dua tempat bisa menyimpang dalam memutuskan apa itu MATCH.

Dua kaidah yang tidak boleh dilanggar saat mengubah mesin ini:

- **Nominal tidak pernah menggugurkan kandidat**, hanya menentukan status.
  Kalau nominal dijadikan syarat kelayakan, transfer yang kurang bayar akan
  hilang dari hasil — padahal itu yang paling perlu ketahuan saat audit.
- **Satu transaksi hanya membayar satu tagihan.** Tanpa pembatasan itu, satu
  transfer bisa membuat beberapa tagihan tampak lunas sekaligus.

PPh diperlakukan sebagai potongan yang disetor sendiri, bukan uang yang keluar
lewat bank: acuan pencocokan adalah `net_seharusnya = gross - pph`, dan kolom
itu dihitung database agar tidak bergantung pada aplikasi menghitung benar.

Kecocokan dengan `dikonfirmasi = true` adalah keputusan manusia dan tidak boleh
tertimpa saat audit dijalankan ulang.

### Batasan yang diketahui

Satu transfer yang membayar beberapa invoice sekaligus, dan pembayaran cicilan,
belum ditangani. Keduanya akan muncul sebagai KURANG_BAYAR atau PERLU_REVIEW —
ditandai untuk diperiksa manusia, bukan salah diklaim lunas.

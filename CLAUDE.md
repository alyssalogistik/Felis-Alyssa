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

Menambah parameter ke fungsi yang sudah ada **tidak bisa** dengan
`create or replace function` saja. PostgreSQL membedakan fungsi berdasarkan
daftar argumennya, jadi versi baru akan berdampingan dengan versi lama alih-alih
menggantikannya, dan pemanggilan lama menjadi ambigu — gagal dengan "Could not
choose a best candidate function" justru setelah pemutakhiran yang tampak
berhasil. Tanda tangan lama harus dilepas eksplisit lebih dulu; lihat
`0005_filter_tanggal_audit.sql`.

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

## Rekening koran PDF (BCA)

Satu uploader, satu penyimpanan. Halaman Audit dan halaman Rekonsiliasi Bank
sama-sama menembak `POST /api/rekonsiliasi/unggah` dan menyimpan ke
`unggahan_rekening_koran` + `transaksi_bank`. Jangan pernah menambahkan jalur
unggah kedua: audit mencocokkan tagihan terhadap tabel itu, jadi rekening koran
yang masuk lewat dua pintu akan tercatat dua kali dan membuat satu transfer
tampak membayar dua tagihan.

Alurnya bercabang hanya di pembacaan berkas, lalu menyatu lagi:

| Lapisan | Tugas |
|---|---|
| `baca.js` | Mengenali format dari isi berkas (`%PDF-`, ZIP, OLE2), bukan dari namanya |
| `pdf.js` | PDF menjadi baris berkoordinat. Tidak tahu apa pun soal bank |
| `bca.js` | Baris berkoordinat menjadi tabel BCA, lengkap dengan baris header |
| `parser.js` | `uraiTabel()` yang sama dengan jalur xlsx/csv |

Karena keluaran `bca.js` berupa tabel bersama header, validasi, penandaan
duplikat, dan penanganan penanda DB/CR tetap hanya ada satu tempat. Dukungan
bank lain nanti cukup menambah satu berkas setara `bca.js`.

Tiga hal yang mudah rusak kalau modul ini disunting:

- **Kolom ditentukan dari tepi, bukan titik tengah.** Teks dinilai dari tepi
  kirinya, angka dari tepi kanannya. KETERANGAN memanjang jauh melewati lebar
  judulnya, sedangkan MUTASI dan SALDO dicetak rata kanan. Salah satu aturan
  saja yang dipakai untuk keduanya akan memenggal nama supplier atau melempar
  nominal ke kolom cabang.
- **Diproses per halaman.** BCA mencetak ulang kop di setiap halaman. Kalau
  halaman digabung jadi satu aliran, "NO. REKENING" halaman berikutnya akan
  tergabung sebagai sambungan keterangan transaksi terakhir halaman sebelumnya.
- **Tahun berasal dari baris PERIODE, tidak pernah ditebak.** Baris transaksi
  BCA hanya memuat DD/MM. Tanpa PERIODE, penguraian ditolak — tahun yang salah
  tidak menimbulkan galat apa pun dan baru ketahuan saat angka auditnya dipakai.

Memakai **pdfjs-dist**, bukan `pdf-parse`. `pdf-parse` membungkus salinan lama
pdfjs di dalamnya, sehingga perbaikan keamanan hulu tidak sampai. pdfjs-dist
adalah pustaka hulunya sendiri dan tidak menambah satu pun peringatan baru pada
`npm audit`. Impornya ditunda sampai benar-benar ada PDF yang dibaca, supaya
unggahan xlsx tidak menanggung biayanya.

## Impor rekening koran bulanan

Satu batch: maksimal dua belas berkas dan maksimal rentang dua belas bulan.
Batas itu berlaku untuk satu kali impor saja — database tetap boleh menyimpan
riwayat bertahun-tahun.

Urutannya tidak boleh bergantung pada urutan pemakai memilih berkas. Periode
setiap berkas dibaca lebih dulu lewat `POST /api/rekonsiliasi/periode`, yang
mengurai PDF **tanpa menyimpan apa pun**, lalu batch diurutkan dari bulan
terlama. Pemeriksaan batas juga terjadi di langkah itu: menolak di tengah jalan
akan meninggalkan sebagian bulan sudah masuk dan sebagian belum, dan tidak ada
cara sederhana bagi pemakainya untuk tahu sampai mana.

Aturan batch ada di `public/batch.js` — murni, tanpa DOM — sehingga pengurutan
dan penghitungan rentang bisa diuji tanpa peramban. Perhitungan rentangnya
inklusif: April 2025 sampai Maret 2026 adalah dua belas bulan, bukan sebelas.

### Sidik jari transaksi

Penjaga duplikat bukan hash berkas. Mengganti nama PDF tidak mengubah hash-nya,
tetapi mengunduh ulang e-statement yang sama dari myBCA bisa menghasilkan berkas
berbeda byte walau isinya identik. Yang dibandingkan adalah isi transaksinya:
kolom `sidik` pada `transaksi_bank`, dihitung database dari nomor rekening,
tanggal, keterangan yang diseragamkan huruf dan spasinya, debit, kredit,
referensi, dan `kembar_ke`. Indeks uniknya yang benar-benar menahan, bukan
pemeriksaan di aplikasi.

**`kembar_ke` adalah bagian yang paling mudah dirusak.** Dua penarikan
bernominal sama pada hari yang sama, tanpa nomor rujukan, adalah transaksi
sungguhan yang berbeda. Tanpa nomor urut itu, yang kedua akan ditolak sebagai
duplikat dan uang yang benar-benar keluar hilang dari catatan. Nomornya
ditetapkan `uraiTabel()` mengikuti urutan baris di berkas, sehingga berkas yang
sama selalu menghasilkan nomor yang sama dan unggahan ulang tetap tertolak.

Penyisipan memakai `upsert` dengan `ignoreDuplicates` — `ON CONFLICT DO NOTHING`,
bukan update. Transaksi lama tidak pernah ditimpa. Jumlah yang benar-benar
tersisip dibaca dari baris yang dikembalikan database, bukan ditebak aplikasi.

### Database yang sudah telanjur berisi ganda

Migration `0006` tidak menghapus apa pun. Baris yang sudah telanjur kembar
dinomori agar indeks uniknya bisa berdiri; nilai transaksinya tidak berubah
sedikit pun. Yang telanjur ganda **tetap ada dan tetap terhitung** — pakai
`periksa_transaksi_ganda()` untuk melihat mana saja, lalu putuskan sendiri.
Fungsi itu hanya melaporkan transaksi serupa yang datang dari unggahan berbeda,
karena kembar di dalam satu unggahan yang sama memang lazim.

## Hasil rekonsiliasi dilipat saat ditampilkan

Rekening koran yang sama pernah diunggah lebih dari sekali sebelum penjaga
duplikat ada, sehingga satu transfer bisa tampil tiga kali dan ikut terhitung
tiga kali pada "Total uang keluar". Yang diperbaiki adalah **tampilannya**,
bukan datanya: `transaksi_bank` tetap utuh, tidak satu baris pun dihapus atau
diubah.

Seluruh pembacaan untuk layar, ekspor, dan laporan menembak view
`transaksi_bank_unik` (`TABEL_TAMPIL` di `api.js`), sementara penyimpanan dan
pembaruan status rekon tetap menembak tabel aslinya. `ringkasan_transaksi_bank()`
ikut dialihkan ke view yang sama — kalau tidak, layar menampilkan dua transaksi
sedangkan totalnya masih menjumlahkan enam baris, dan kekeliruannya hanya
berpindah tempat alih-alih hilang.

Yang disamakan: tanggal, keterangan setelah huruf dan spasinya diseragamkan,
debit, kredit, dan referensi. **Nomor rekening sengaja tidak ikut** — baris lama
belum menyimpannya sedangkan unggahan baru menyimpannya, sehingga transaksi yang
sama dari dua masa justru akan tampak berbeda karena kolom itu.

**Pelipatan berhenti di batas berkas.** Salinan hanya digabung bila datang dari
unggahan yang berbeda; dua transaksi bernominal sama pada hari yang sama di
dalam satu rekening koran tetap dua baris, karena BCA memang mencetak keduanya
dan keduanya uang sungguhan. Di halaman ini kekurangan hitung lebih berbahaya
daripada kelebihan: yang tampak kurang dibayar akan dibayar untuk kedua kalinya.

Baris yang ditampilkan dari tiap kelompok bukan sekadar yang paling dulu masuk,
melainkan yang paling mahal bila hilang: yang hasil auditnya sudah dikonfirmasi
manusia, lalu yang punya kecocokan, lalu yang sudah direkonsiliasi. Tanpa urutan
itu layar bisa menampilkan salinan berstatus "belum" padahal aslinya sudah
direkon.

Berkas di `supabase/audit/` memeriksa duplikat yang sudah telanjur masuk. Ketiganya
hanya membaca dan tidak pernah dipanggil aplikasi.

## Halaman audit: pencarian dulu, pencocokan belakangan

Pertanyaan yang benar-benar dijawab halaman ini adalah "supplier ini sudah saya
transfer belum". Jawabannya ada di mutasi bank dan tidak menuntut daftar tagihan
lebih dulu, jadi **pencarian adalah alur utamanya** dan pencocokan otomatis
dengan tagihan adalah pelengkap yang dilipat di bawah.

Urutan itu bukan selera tata letak. Menaruh unggah tagihan sebagai langkah
pertama membuat orang menyangka fitur ini tidak bisa dipakai tanpa menyiapkan
data tagihan dulu — padahal seluruh jawabannya sudah ada di rekening koran yang
sudah diunggah.

`public/bayaran.js` membaca `GET /api/rekonsiliasi/transaksi`, endpoint yang
sama dengan halaman Rekonsiliasi Bank. Tidak ada endpoint, tabel, maupun
penyimpanan tersendiri: rekening koran yang diunggah kapan pun dan lewat menu
mana pun langsung bisa dicari, tanpa unggah ulang.

Dua hal yang harus dipertahankan:

- **Nihil hasil tidak pernah dinyatakan sebagai "belum dibayar".** Nama di
  keterangan bank sering berbeda dari nama resmi supplier; menyimpulkan belum
  dibayar di layar ini akan membuat orang membayar dua kali. Yang ditampilkan
  adalah bahwa tidak ada yang cocok pada kata kunci dan periode itu, beserta
  saran mempersempit atau melonggarkan pencarian.
- **`hanya_debit` tidak diteruskan ke `ringkasan_transaksi_bank()`.** Baris
  kredit menyumbang debit nol, sehingga total debitnya sama persis dengan atau
  tanpa penyaringan itu; jumlah barisnya diambil dari hitungan kueri yang memang
  sudah tersaring. Menambah parameter ke fungsinya hanya menuntut migration
  tanpa mengubah satu angka pun.

Aturan penyaringan hidup di dua tempat yang sengaja dijaga cermin: `saring()` di
`saringan.js` (murni, teruji) dan `terapkanKriteria()` di `api.js` (dijalankan
database). Kalau salah satu diubah, ubah keduanya.

### Filter dijalankan lewat tombol, bukan saat mengetik

Pencarian hanya berjalan ketika "Cari / Terapkan Filter" ditekan. Menyusun
beberapa filter sekaligus — nama, lalu bulan, lalu tahun, lalu rentang tanggal —
akan memicu beberapa permintaan setengah jadi bila setiap perubahan langsung
dijalankan, dan hasil antaranya sempat terlihat seolah itu jawabannya.

Konsekuensinya isian formulir bisa berbeda dari hasil yang sedang tampak.
Karena itu ada `kriteriaBerlaku`: potret filter yang diambil saat pencarian
dijalankan, dan itulah acuan tunggal bagi tabel, ringkasan, kop cetak, laporan
PDF, dan ekspor. Membaca isian formulir langsung akan membuat berkas yang
diunduh memuat filter yang belum pernah dijalankan — berbeda dari tabel yang
dilihat pemakainya, tanpa gejala apa pun.

Dua perapian kata kunci yang wajib dipertahankan:

- **Spasi ganda di tengah dirapatkan**, bukan hanya dipangkas di ujung.
  Pencocokannya harfiah, sehingga "SUGENG  RIYANTO" berspasi dua tidak akan
  pernah cocok dengan "SUGENG RIYANTO" di rekening koran.
- **Rentang tanggal terbalik ditolak sebelum dikirim.** Database tidak
  menganggapnya galat, hanya mengembalikan kosong — dan kosong di halaman ini
  terbaca sebagai "belum dibayar".

### Seluruh hasil masuk ke tabel, bukan satu halaman

Setelah pencarian dijalankan, halaman berikutnya ditarik otomatis sampai seluruh
hasil yang cocok ada di tabel. Auditor yang melihat sebagian daftar akan
menyimpulkan supplier kurang dibayar padahal sisanya hanya belum dimuat.

Pagarnya `BATAS_MUATAN` (2000 baris) supaya pencarian tanpa kata kunci di atas
rekening koran bertahun-tahun tidak menarik puluhan ribu baris sekaligus;
sisanya diambil lewat tombol "Muat lebih banyak", yang hanya muncul bila pagar
itu benar-benar tercapai.

Jumlah dan totalnya sendiri tidak bergantung pada pemuatan itu: keduanya datang
dari database sejak permintaan pertama — `count: 'exact'` untuk jumlah, dan
fungsi `ringkasan_transaksi_bank()` untuk totalnya — sehingga angkanya sudah
benar bahkan sebelum baris terakhir selesai dimuat.

Tidak ada satu pun nilai transaksi yang tertanam di kode. Kalau suatu saat ada
yang tergoda menambahkan contoh untuk mempermudah pengembangan, ingat bahwa
halaman ini dipakai memutuskan apakah seseorang sudah dibayar.

## Cetak dan Simpan PDF

Dokumen resminya dibuat di **server** (`src/rekonsiliasi/cetak.js`, pdfkit),
bukan dari tabel yang sedang tampil. Layar hanya memuat satu halaman hasil,
sedangkan laporan harus memuat seluruh transaksi yang cocok dengan filter.

Kedua tombol memakai laporan yang sama. "Simpan PDF" mengunduhnya langsung;
"Cetak" mengambilnya sebagai blob, memuatnya ke iframe tersembunyi, lalu
memanggil `print()`. Peramban seluler yang menolak mencetak dari iframe
tersembunyi dilayani dengan membuka laporan di tab baru.

Alasan "Cetak" tidak memakai stylesheet cetak sebagai jalur utamanya: CSS di
peramban tidak bisa menghitung nomor halaman. `@page` margin box yang
menyediakan `counter(page)` tidak didukung Chrome, sehingga footer
"Halaman X / Y" mustahil dihasilkan dari halaman web. Selain itu tabel di layar
hanya memuat 50 baris pertama.

Stylesheet cetak di `style.css` tetap ada sebagai jaring pengaman: siapa pun
yang menekan Ctrl+P pada halaman akan mendapat kertas putih tanpa tema gelap
dan tanpa menu, bukan tangkapan layar aplikasi.

Aturan tata letak A4 ada di `laporan.js` — murni, tanpa pdfkit — supaya
pembungkusan keterangan dan pemenggalan halaman bisa diuji tanpa membuat satu
PDF pun. `cetak.js` hanya menggambar.

Setelah "Simpan PDF" berhasil, hasil di layar dikosongkan: tabel, ringkasan,
kop cetak, dan keadaan paginasi kembali ke halaman satu. Isian filter sengaja
dibiarkan.

Karena itu unduhannya lewat `fetch` lalu blob, bukan navigasi biasa. Navigasi
tidak memberi tahu halaman apakah berkasnya jadi atau gagal, sehingga layar akan
ikut kosong walaupun laporannya tidak pernah terbentuk. **Gagal menyimpan berarti
hasil dibiarkan apa adanya.**

Pengosongan itu tampilan belaka — tidak satu baris pun dihapus dari
`transaksi_bank`. Pesan kosongnya menyebutkan bahwa hasil bisa dimunculkan lagi
dengan mencari ulang; tanpa itu, layar yang tiba-tiba kosong terbaca seperti
datanya ikut terhapus.

Dua hal yang mudah salah:

- **Lebar kolom diukur, bukan dikira-kira.** Kolom yang lebih sempit dari
  judulnya sendiri tidak membungkus melainkan terpotong diam-diam; REFERENSI
  pernah hilang seluruhnya karena ini. Ukur dengan `widthOfString()` pada font
  yang benar-benar dipakai bila lebarnya diubah.
- **Rupiah diformat sendiri, tidak lewat `Intl`.** Node di server bisa berjalan
  tanpa data locale `id-ID` dan diam-diam jatuh ke format Inggris, sehingga
  laporan mencetak "Rp 2,500,000" yang salah baca di Indonesia.

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

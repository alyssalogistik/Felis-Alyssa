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
| `src/mekari/` | Audit Data Mekari. Terpisah penuh dari rekonsiliasi |
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

## Dua perusahaan, satu database

PT Alyssa Auto Logistik dan CV Alyssa Trans Utama membayar sebagian supplier
yang sama. Tanpa pemisahan, mencari SUGENG RIYANTO dari rekening CV akan
memunculkan transfer PT juga — dan yang tampak sudah dibayar sebenarnya dibayar
oleh perusahaan yang lain.

Penandanya kolom `entitas` pada `transaksi_bank`, `unggahan_rekening_koran`,
`pembayaran_manual`, dan `tagihan_pemasok`. Kodenya di `src/rekonsiliasi/entitas.js`,
satu berkas yang dipakai server maupun peramban: `src/server.js` menyajikannya di
`/entitas.js` alih-alih menyalinnya ke `public/`, karena salinan yang tertinggal
akan membuat daftar perusahaan di layar berbeda dari yang diterima server tanpa
satu pun galat.

**Nomor rekening tidak bisa dipakai sebagai penandanya.** Baris lama belum
menyimpannya sama sekali, dan yang menyimpannya pun tidak seragam: satu rekening
PT yang sama tercatat sebagai `0072890271` maupun `00072890271`. Karena itu
seluruh data yang sudah ada di-backfill sebagai PT — seluruh rekening koran yang
pernah diunggah sebelum pemisahan ini memang milik PT.

### Tidak ada entitas bawaan

Menyimpan apa pun menuntut entitas yang disebut eksplisit: unggah rekening
koran, unggah daftar tagihan, input pembayaran manual, dan menjalankan
Auto-Match. Nilai bawaan yang diam-diam dipakai ketika pilihannya lupa dikirim
akan menandai rekening koran CV sebagai milik PT — kekeliruan yang tidak
menimbulkan galat apa pun, baru ketahuan berbulan kemudian saat angka auditnya
dipakai, dan saat itu tidak ada cara membedakan lagi baris mana yang salah tanda.

Pada **penyaringan**, tidak memilih apa-apa adalah pilihan yang sah dan berarti
"Semua". Tetapi nilai yang **tidak dikenali ditolak dengan 400**, bukan jatuh ke
"Semua": salah ketik yang diam-diam berarti seluruh perusahaan akan memunculkan
transaksi perusahaan lain tanpa gejala — justru yang seluruh pemisahan ini cegah.

Kotak berkas terkunci sampai pemilik rekening dipilih. Menolak sesudah berkas
telanjur dipilih membuat langkah itu terasa seperti galat, bukan bagian alurnya.

Satu nomor rekening hanya milik satu perusahaan. Unggahan yang nomor
rekeningnya sudah tercatat milik entitas lain ditolak dengan 409 beserta
kedua nama perusahaannya.

### Entitas ikut menyusun kunci, bukan sekadar menyaring

Tiga tempat, dan ketiganya perlu:

- **`sidik`** di `transaksi_bank`. Tanpa entitas di dalamnya, transaksi CV yang
  kebetulan sama tanggal, nominal, dan keterangannya dengan transaksi PT
  tertolak indeks unik sebagai duplikat, dan uang yang benar-benar keluar hilang
  dari catatan. Diuji terhadap data sungguhan: dari tiga baris CV yang identik
  dengan baris PT, **dua akan tertolak** dengan rumus lama.
- **Kunci pelipatan `transaksi_bank_unik`.** Tanpa itu satu transfer PT dan satu
  transfer CV yang kebetulan serupa dilipat menjadi satu baris di layar, dan
  salah satunya hilang dari hitungan. Nomor rekening tetap tidak ikut, dengan
  alasan yang sama seperti semula.
- **`kunci()` di `pending.js`.** Tanpa itu transfer CV bisa tampak melunasi
  baris PEND milik PT, menempelkan tanggal perusahaan lain pada uang yang
  benar-benar keluar.

Ringkasan ikut disaring lewat parameter `p_entitas` pada fungsi database. Kalau
tidak, layar menampilkan transaksi CV sedangkan totalnya masih menjumlahkan PT
dan CV sekaligus — kekeliruannya hanya berpindah tempat.

### Yang mudah terlewat

- **`cariSupplier()` mempertahankan pilihan entitas melewati `reset()`.** Filter
  lain sengaja dikosongkan supaya hasilnya seluruh transfer supplier itu; tetapi
  entitas bukan penyempit hasil, ia menentukan perusahaan mana yang sedang
  diperiksa. Ikut terhapus berarti sekali klik pada nama supplier memunculkan
  transfer perusahaan lain.
- **Nomor invoice hanya unik di dalam satu entitas.** Kedua perusahaan bisa
  menerima invoice bernomor sama dari supplier yang sama; aturan lama menolak
  yang kedua sebagai unggahan ganda.
- **Auto-Match wajib menyebut entitas, tidak boleh "Semua".** Pasangan
  tagihan-transaksi tersimpan permanen dan satu tagihan hanya boleh punya satu
  pasangan. Pencocokan lintas entitas menempelkan pasangan yang salah di
  database: tagihan PT tampak lunas padahal yang membayar perusahaan lain, dan
  tagihan yang sebenarnya belum dibayar hilang dari daftar menyimpang.
- **Nama berkas laporan memuat PT/CV.** Dua laporan supplier yang sama dari dua
  perusahaan akan bernama sama persis di folder unduhan, dan yang terunduh
  belakangan menimpa yang pertama tanpa peringatan.

### Penomoran `kembar_ke` di 0006 hanya sekali

Blok penomoran ulang di `0006` kini dijaga: ia hanya berjalan ketika kolom
`sidik` belum ada. Sesudah sidik berdiri, indeks uniknya diperiksa per baris
selama UPDATE berjalan, bukan di akhir — penomoran ulang yang menukar dua nomor
bertabrakan di tengah jalan dan seluruh perintah gagal dengan "duplicate key
value violates unique constraint".

Ini bug yang sudah ada sejak 0006 dan baru terlihat setelah database memuat
transaksi kembar sungguhan: `setup-lengkap.sql` yang dijalankan kedua kalinya
gagal. Gagalnya aman — satu blok `DO`, jadi tidak ada yang berubah — tetapi
berkas itu dijanjikan aman dijalankan berulang.

Sebab yang sama menuntut `drop view if exists` sebelum setiap `create view`
di `0004`, `0007`, dan `0008`: `create or replace view` tidak bisa MENGURANGI
kolom, sedangkan `0009` menambah kolom pada ketiganya.

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

## Dua cetakan BCA, satu jalur penyimpanan

BCA mengeluarkan rekening koran dalam dua tata letak yang sama sekali berbeda,
dan keduanya didukung:

| | E-statement bulanan | Mutasi Rekening |
|---|---|---|
| Asal | myBCA / KlikBCA, per bulan | KlikBCA, per rentang tanggal |
| Judul kolom | TANGGAL KETERANGAN CBG MUTASI SALDO | Tgl Keterangan Cabang Jumlah Saldo |
| Tanggal | DD/MM, tahunnya dari baris PERIODE | DD/MM/YYYY penuh |
| Sambungan keterangan | selalu di bawah baris berangka | di atas **dan** di bawah |
| Penafsir | `bca.js` | `bca-mutasi.js` |

Judul kolomnya tidak beririsan satu huruf pun, jadi keduanya tidak bisa
tertukar. `baca.js` memeriksa e-statement lebih dulu: itu format yang sudah
bertahun-tahun masuk ke database ini, dan kalau suatu saat pengenalannya
bertabrakan, yang menang harus jalur yang lama.

Yang bercabang hanya pembacaan berkasnya. Keduanya mengeluarkan tabel bersama
baris header dan bertemu kembali di `uraiTabel()` yang sama, sehingga validasi,
penandaan duplikat, dan penomoran `kembar_ke` tetap hanya ada satu tempat.

Tiga hal yang mudah rusak kalau `bca-mutasi.js` disunting:

- **Satu transaksi ditentukan dari baris berangkanya, bukan dari baris
  bertanggal.** Setiap transaksi punya tepat satu baris yang memuat nominal
  berpenanda DB/CR di kolom Jumlah — termasuk transaksi PEND yang tidak punya
  tanggal dan transaksi yang baris berangkanya tidak memuat keterangan sama
  sekali. Menghitung dari tanggal akan kehilangan keduanya.
- **Keterangan dipotong di jarak tegak terbesar, dan dipotong SEKALI.** Baris
  keterangan berada di atas dan di bawah baris berangkanya; satu-satunya
  pemisah antartransaksi adalah jarak tegak, yang lebih renggang daripada jarak
  di dalam satu transaksi. Menghitungnya dua kali — sekali dari sisi atas,
  sekali dari sisi bawah — bisa menghasilkan dua jawaban berbeda, dan satu baris
  nama supplier bisa hilang atau terhitung pada dua transaksi sekaligus. Yang
  dibandingkan perbandingan antarjarak di dalam berkas itu sendiri, bukan angka
  tetap dalam poin: ukuran huruf cetakan bisa berubah, urutan rapat-renggangnya
  tidak.
- **Kop dan tombol halaman web disaring, bukan diabaikan.** Cetakan ini berasal
  dari halaman web, sehingga "Format Download", "csv", "Sebelumnya", "Cetak",
  dan baris hak cipta ikut tercetak ke PDF-nya. Semuanya ada di `BUKAN_TRANSAKSI`.

Beberapa cetakan boleh disatukan menjadi satu PDF. Kop dibaca dari setiap
halaman, bukan dari 60 potong teks pertama saja, sehingga rentang yang
dilaporkan mencakup seluruh isinya. Dua nomor rekening berbeda dalam satu berkas
ditolak — sidik jari transaksi akan tersandera nomor yang salah, dan salahnya
tidak menimbulkan gejala apa pun.

### Transaksi PEND

Cetakan Mutasi menuliskan `PEND` di kolom tanggal untuk transaksi yang uangnya
sudah keluar tetapi tanggal bukunya belum ditetapkan BCA. **Tanggalnya disimpan
kosong, tidak pernah dikarang** — tanggal yang salah tidak menimbulkan galat apa
pun dan baru ketahuan saat angka auditnya dipakai. Nominalnya tetap dihitung,
karena total di kaki cetakan BCA sendiri sudah memuatnya.

Penandanya menumpang kolom `masalah` yang memang sudah ada dan sudah
ditampilkan, sehingga tidak menuntut migration untuk satu penanda.

Baris tanpa tanggal diurutkan **paling atas**, bukan paling bawah. PEND adalah
pergerakan paling baru di rekening; di bawah, ia terkubur di ujung daftar ribuan
baris — bahkan bisa jatuh di luar `BATAS_MUATAN` — sehingga auditor yang bertanya
"supplier ini sudah saya transfer belum" melihat daftar yang tampak lengkap
padahal transfer terbarunya tidak ikut termuat.

**Pengurutan itu saja ternyata tidak cukup.** Baris PEND tidak punya tanggal,
sehingga SETIAP penyaringan tanggal membuangnya: `NULL >= '2026-09-15'` bukan
benar dan bukan salah, jadi barisnya tersingkir tanpa satu pun galat. Urutan
paling atas tidak menolong kalau barisnya tidak pernah ikut terambil.

Ini ditemukan dari pemakaian sungguhan: satu cetakan Mutasi 17–24 September
memuat **13 transaksi PEND senilai Rp 5.912.500**, termasuk transfer
Rp 3.000.000 yang sedang dicari pemiliknya, dan tidak satu pun muncul saat
disaring 15–24 September. Layar melaporkan Rp 35.514.000 padahal yang benar
Rp 38.516.500.

Karena itu `/transaksi` dan `/cetak` menarik baris PEND **terpisah** lewat
`pendingTersaring()`, dengan kriteria yang sama minus tanggalnya:

- **Terpisah, bukan dengan melonggarkan filternya.** Mencampurnya membuat
  laporan September ikut menjumlahkan transaksi yang belum berperiode —
  kekeliruannya cuma berpindah tempat.
- **Kosong ketika kriteria tidak menyaring tanggal**, karena di situ baris PEND
  sudah ikut di daftar utama; menariknya lagi akan menampilkannya dua kali.
  Penentunya `menyaringTanggal()` di `saringan.js`, murni dan teruji.
- **Di layar**, blok peringatan di ATAS ringkasan, dengan subtotalnya sendiri.
- **Di PDF**, satu baris peringatan di kop lewat `peringatanPending()` yang
  menyebut jumlah dan nilainya. Laporan yang tampak lengkap padahal ada uang
  keluar di luar hitungannya adalah cara paling mudah membuat orang membayar
  dua kali.
- **Nihil hasil bertanggal tetapi ada PEND tidak pernah disebut "tidak
  ditemukan".** Itu justru keadaan paling berbahaya: uangnya baru saja keluar.

Saat mutasi berikutnya membukukan transaksi itu, `src/rekonsiliasi/pending.js`
mencocokkannya dan **tanggal baris yang sudah ada yang diisi** — bukan baris baru
yang ditambahkan. Sidik jarinya lalu menjadi sama persis dengan transaksi baru
itu, sehingga yang baru tertolak indeks unik sebagai duplikat: satu baris, bukan
dua.

### Urutan tiga langkah di jalur unggah

Ini bagian yang paling mudah dirusak, dan kerusakannya tidak menimbulkan galat
apa pun — hanya angka yang salah. Ketiganya harus selesai **sebelum** satu baris
pun disisipkan, dan dalam urutan ini:

1. **Pelunasan** mengisi tanggal baris PEND yang sudah tersimpan.
2. **Pemeriksaan duplikat** membaca ulang database — sehingga baris yang baru
   saja dilunasi sudah terbaca bertanggal, dan transaksi baru yang melunasinya
   ikut dikenali sebagai transaksi yang sama.
3. **Penyisipan** menyimpan sisanya.

Kalau nomor 2 berjalan lebih dulu, baris PEND masih bertanggal kosong saat
dibandingkan, sehingga transaksi yang melunasinya lolos sebagai transaksi baru —
dan satu transfer tersimpan dua kali: sekali sebagai baris PEND yang baru
dilunasi, sekali sebagai baris dari cetakan yang melunasinya.

## Transaksi yang sama dari dua cetakan berbeda

Sidik jari di database **tidak bisa menahan ini sendirian**, karena dua hal yang
ikut menyusunnya justru yang berbeda: tanggal (kosong pada baris PEND) dan
keterangan. Kedua cetakan BCA menuliskan transaksi yang sama dengan kalimat
berbeda, dan perbedaannya hanya di awalan jenis transaksinya:

| E-statement | Mutasi Rekening |
|---|---|
| `BIF TRANSFER KE 008 HERMANSYAH KBB` | `BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB` |
| `BIF BIAYA TXN KE 002 RUDI KBB` | `BI-FAST DB BIAYA TXN KE 002 RUDI KBB` |
| `0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL` | `TRSF E-BANKING DB 0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL` |

Sisa kalimatnya sama persis. `intiKeterangan()` di `pending.js` mengupas awalan
itu **hanya untuk membandingkan**; yang tersimpan di kolom `keterangan` tetap
kalimat apa adanya dari bank, karena itulah yang dicocokkan saat audit.

Kuncinya: nomor rekening, inti keterangan, debit, kredit, dan **saldo berjalan**.
Saldo yang menahan seluruhnya — ia tidak pernah berulang untuk dua transaksi
berbeda pada hari yang sama, karena setiap transaksi mengubahnya. Saldo yang
sama beserta nominal yang sama berarti transaksi yang sama, bukan dua transaksi
yang mirip.

Empat pagar yang tidak boleh dilepas:

- **Tanpa saldo, tidak pernah dilewati.** Penahan satu-satunya hilang.
- **Tanpa nominal, tidak pernah dilewati.** Baris bernominal nol bukan uang
  melainkan sisa kop yang lolos penguraian, dan dua di antaranya bisa tampak
  sama persis.
- **Tanggal berbeda berarti transaksi berbeda.** Dua transfer serupa pada dua
  hari berbeda adalah dua transaksi sungguhan.
- **Lebih dari satu kandidat berarti mengalah.** Barisnya tetap disisipkan dan
  kembarnya terlihat. Melewatkan transaksi sungguhan jauh lebih berbahaya
  daripada satu baris kembar yang bisa diperiksa mata.

**Baris bertanggal tidak pernah dibandingkan dengan isi berkasnya sendiri.**
Kalau itu dilakukan, setiap baris cocok dengan dirinya sendiri dan seluruh
berkas dilewati sebagai "sudah ada" pada unggahan pertamanya — uang yang
benar-benar keluar tidak pernah tercatat sama sekali. Yang dibandingkan dengan
isi berkas sendiri hanya baris PEND, karena satu PDF gabungan bisa memuat
cetakan lama beserta baris PEND-nya sekaligus cetakan yang sudah membukukannya.

Peringatan irisan periode tetap ada di samping penjaga ini: setiap unggahan
melaporkan berapa transaksi tersimpan yang tanggalnya jatuh di dalam rentang
berkas itu. Penjaga di atas hanya bekerja bila saldo dan nominalnya cocok
persis; yang di luar itu tetap perlu mata manusia.

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

### Daftar supplier disusun dari keterangan bank

Panel "Supplier di Rekening Koran" menghapus langkah "ingat lalu ketik nama".
Namanya diturunkan `src/rekonsiliasi/nama.js` dari keterangan transaksi — tidak
ada tabel supplier yang harus diisi lebih dulu, dan `GET /api/rekonsiliasi/supplier`
memindai seluruh baris, bukan satu halaman.

Daftarnya jalan pintas, **bukan** sumber kebenaran. Mengklik satu nama hanya
mengisi kotak pencarian lalu menjalankan `cariBayaran()` yang sama persis
dengan mengetik sendiri, jadi tidak ada jalur data kedua yang bisa menyimpang
dari tabel di bawahnya. `cariSupplier()` mengosongkan filter lain lebih dulu:
bulan atau rentang tanggal yang masih menempel membuat hasilnya hanya sebagian
transfer supplier itu.

Nama diambil dari rentetan kata terakhir yang tidak memuat angka — BCA menaruh
kode, tanggal, dan nominal di depan. **Kata tempelan dikupas dari kedua ujung.**
Mengupas ujung depan saja pernah memecah SUGENG RIYANTO menjadi tiga baris
karena "ANGSURAN" dan "PELUNASAN" ada di belakang nama; daftarnya menyebut
Rp2.500.000 padahal yang keluar Rp7.250.000.

Arah kesalahan yang dipilih sadar: nama yang memuat nama lain yang lebih pendek
dilipat ke yang pendek, sehingga dua orang berbeda bisa tergabung dan totalnya
menjadi terlalu besar. Kebalikannya jauh lebih berbahaya — satu orang terpecah,
totalnya terlalu kecil, terbaca sebagai kurang bayar, lalu dibayar untuk kedua
kalinya. Nama berkata tunggal tidak pernah jadi sasaran pelipatan ("BUDI" akan
menelan "BUDI SANTOSO" bersama "BUDI HARTONO"), dan semua yang digabung
dilaporkan sebagai varian supaya bisa diperiksa mata.

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

## Audit Data Mekari

Modul terpisah penuh dari Rekonsiliasi. Sumbernya ekspor Excel Mekari Jurnal
(`Purchases by Supplier`), dan tidak ada satu baris pun yang masuk
`transaksi_bank`. Yang dicarinya **tagihan yang berpotensi ganda**, bukan uang
yang benar-benar keluar dua kali — untuk itu perlu disilangkan dengan mutasi
bank, dan itu belum ada.

Istilah di seluruh modul ini "potensi duplikasi" dan "perlu diperiksa". Tidak
pernah "dobel bayar": yang berhak menyatakan itu auditor, sesudah melihat kedua
barisnya berdampingan.

### Angka tidak boleh membuka gerbang

Godaan pertamanya mengelompokkan baris yang "supplier sama + produk sama +
nominal sama + tanggal sama". Itu diukur terhadap ekspor sungguhan dan hasilnya
tidak bisa dipakai: dari 116 baris, **775 pasangan tertandai dan 110 baris (95%)
terlibat**.

Sebabnya harga adalah **daftar tarif, bukan sidik jari**. Di berkas yang sama
hanya ada 18 nilai nominal berbeda untuk 116 baris — Rp 6.500.000 muncul 44 kali
karena itu tarif satu rute. Kuantitas bernilai 1 pada 91% baris, dan hanya ada
13 tanggal berbeda.

Jadi yang boleh membuka gerbang hanya **identitas**: deskripsi yang sama persis,
atau tanda pengenal yang sama. Supplier, produk, nominal, harga, kuantitas, dan
tanggal tidak pernah membuat sepasang baris dibandingkan — mereka hanya menambah
skor sesudah gerbangnya terbuka. Dengan gerbang itu, berkas yang sama
menghasilkan 13 temuan atas 26 baris.

### Pengenal ditemukan dari kejarangan, bukan dari daftar pola

`pengenal.js` tidak tahu apa-apa soal kendaraan, dan itu disengaja. Yang dicari
token yang mengandung angka, panjang ≥ 3, dan jarang muncul di batch itu (≤ 2%
baris). Nomor rangka, nomor seri mesin, nomor kontrak, nomor batch, dan nomor
tiket semuanya lolos lewat aturan yang sama — sehingga ketika yang diaudit bukan
kendaraan, mesinnya tetap bekerja tanpa satu baris pun diubah.

Daftar pola akan menuntut penambahan setiap kali jenis data baru masuk, dan yang
lupa ditambahkan gagal diam-diam: barisnya tidak pernah dibandingkan dengan apa
pun, dan tagihan ganda di dalamnya tidak pernah muncul sebagai temuan.

**Konteks token ikut dibandingkan.** Token telanjang `1104` cocok pada
`B 1104 DKN` maupun `B 1104 DKM` — dua kendaraan berbeda; dua pasang seperti itu
ada di ekspor sungguhan. Yang konteksnya berbeda **tetap dilaporkan** dengan skor
lebih rendah, tidak dibuang: melewatkan tagihan ganda jauh lebih mahal daripada
satu baris yang perlu dilihat mata.

### Yang mudah terlewat

- **`kembar_ke` wajib, dan alasannya kritis.** Baris 120 dan 121 di ekspor
  sungguhan identik byte demi byte — dan **justru itulah temuan berskor
  tertinggi**. Dedup baris yang naif akan menghapus barang buktinya sendiri.
- **Nilai baris dari `Jumlah Tagihan`, tidak pernah dari kolom `Total`.** Kolom
  `Total` di ekspor Mekari jumlah **kumulatif berjalan**; memakainya akan
  menggelembungkan tiap baris mengikuti posisinya, dan baris terakhir bernilai
  seluruh laporan.
- **Nama supplier hanya ditulis sekali di baris kelompok**, bukan per baris.
  Tanpa dibawa turun, seluruh baris di bawahnya kehilangan suppliernya.
- **Baris kaki (`Total Pembelian`, `Grand Total`) disaring.** Nilainya sah tetapi
  penjumlahan baris di atasnya; ikut tersimpan berarti satu berkas tampak memuat
  pembelian berkali lipat.
- **`mekari_periksa` sengaja tanpa kunci asing ke `mekari_temuan`.** Menjalankan
  ulang mesin menghapus dan menulis ulang seluruh temuan; dengan kunci asing
  beserta cascade, setiap pergeseran ambang akan menghapus seluruh hasil
  pemeriksaan manusia — dan yang hilang bukan data yang bisa diurai ulang,
  melainkan pekerjaan orang. Penghubungnya `kunci_stabil`.
- **Nihil hasil tidak pernah dinyatakan sebagai "tidak ada duplikasi".** Mesin
  hanya membandingkan yang berbagi identitas; sepasang tagihan ganda yang
  deskripsinya ditulis sama sekali berbeda tidak akan muncul.
- **Kelompok lebih besar dari `BATAS_KELOMPOK` dilaporkan utuh, bukan dijabarkan
  jadi pasangan.** Deskripsi yang berulang ratusan kali adalah baris template,
  bukan ratusan tagihan ganda; menjabarkannya mengubur temuan sungguhan.

### Pemisahan PT/CV

Mengikuti `src/rekonsiliasi/entitas.js` yang sudah ada — entitas wajib disebut
saat unggah tanpa nilai bawaan, filter Semua/PT/CV, dan mesin tidak pernah
mencocokkan lintas entitas. Menghitung ulang satu entitas tidak menyentuh temuan
entitas lain.

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

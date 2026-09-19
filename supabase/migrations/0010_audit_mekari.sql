-- ---------------------------------------------------------------------------
-- Audit Data Mekari: mencari pembelian yang berpotensi terbayar dua kali
--
-- Sumbernya ekspor Excel Mekari Jurnal, bukan rekening koran. Modul ini berdiri
-- sendiri penuh: tidak ada satu baris pun yang masuk ke transaksi_bank, dan
-- tidak ada tabel rekonsiliasi yang disentuh. Yang dicarinya tagihan yang
-- berpotensi ganda, BUKAN uang yang benar-benar keluar dua kali — untuk itu
-- perlu disilangkan dengan mutasi bank, dan itu belum ada di sini.
--
-- Istilah di seluruh modul ini "potensi duplikasi" dan "perlu diperiksa".
-- Tidak pernah "dobel bayar": yang berhak menyatakan itu auditor, sesudah
-- melihat kedua barisnya berdampingan.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Satu unggahan
-- ---------------------------------------------------------------------------

create table if not exists mekari_impor (
  id             uuid primary key default gen_random_uuid(),

  nama_berkas    text not null,
  hash_berkas    text not null,

  -- Entitas WAJIB dan tanpa nilai bawaan, sama seperti rekening koran.
  -- Bawaan yang diam-diam dipakai saat pilihannya lupa dikirim akan menandai
  -- pembelian CV sebagai milik PT — kekeliruan yang tidak menimbulkan galat
  -- apa pun dan baru ketahuan saat angka auditnya dipakai.
  entitas        text not null check (entitas in (
                   'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),

  sheet          text,
  baris_header   int,

  periode_mulai  date,
  periode_selesai date,

  jumlah_baris       int not null default 0,
  jumlah_baru        int not null default 0,
  jumlah_sudah_ada   int not null default 0,
  jumlah_bermasalah  int not null default 0,
  nilai              numeric(16, 2) not null default 0,
  status             text,

  diunggah_pada  timestamptz not null default now()
);

create index if not exists idx_mekari_impor_waktu   on mekari_impor (diunggah_pada desc);
create index if not exists idx_mekari_impor_hash    on mekari_impor (hash_berkas);
create index if not exists idx_mekari_impor_entitas on mekari_impor (entitas);

-- ---------------------------------------------------------------------------
-- Baris mentah
--
-- TIDAK PERNAH DIUBAH mesin audit. Ekstraksi dan temuan boleh dihapus dan
-- dibangun ulang kapan saja; tabel ini yang menjadi acuan agar setiap temuan
-- selalu bisa dilacak kembali ke baris aslinya di berkas Mekari.
-- ---------------------------------------------------------------------------

create table if not exists mekari_baris (
  id             uuid primary key default gen_random_uuid(),
  impor_id       uuid not null references mekari_impor(id) on delete cascade,

  entitas        text not null check (entitas in (
                   'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),

  baris_sumber   int not null,
  berkas_sumber  text,

  supplier       text not null default '',
  tanggal        date,
  tanggal_ambigu boolean not null default false,
  jenis_transaksi text,
  no_invoice     text,
  produk         text,
  keterangan     text not null default '',

  kuantitas      numeric(14, 2) not null default 0,
  satuan         text,
  harga          numeric(16, 2) not null default 0,

  -- Nilai baris, diambil dari kolom "Jumlah Tagihan" di ekspor Mekari.
  -- Kolom "Total" di berkas itu jumlah KUMULATIF BERJALAN, bukan nilai baris;
  -- memakainya akan menggelembungkan tiap baris mengikuti posisinya, dan baris
  -- terakhir akan bernilai seluruh laporan.
  jumlah         numeric(16, 2) not null default 0,

  masalah        text[] not null default '{}',

  -- Dua baris yang isinya sama persis di dalam SATU berkas justru temuannya,
  -- bukan sampah yang harus dilebur. Di ekspor sungguhan, baris 120 dan 121
  -- identik dan itulah potensi duplikasi berskor tertinggi. Nomor urut ini
  -- yang membuat keduanya bisa berdiri berdampingan di bawah indeks unik.
  kembar_ke      int not null default 1,

  bulan int generated always as (extract(month from tanggal)) stored,
  tahun int generated always as (extract(year  from tanggal)) stored,

  -- Penjaga unggahan ganda yang sebenarnya. Bukan hash berkas: mengunduh ulang
  -- laporan yang sama dari Mekari bisa menghasilkan berkas berbeda byte walau
  -- isinya identik. Yang dibandingkan isi barisnya.
  sidik text generated always as (
    md5(
      entitas || '|' ||
      lower(regexp_replace(coalesce(supplier, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce((tanggal - date '1970-01-01')::text, '') || '|' ||
      lower(coalesce(no_invoice, '')) || '|' ||
      lower(coalesce(produk, '')) || '|' ||
      lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(kuantitas, 0)::text || '|' ||
      coalesce(harga, 0)::text || '|' ||
      coalesce(jumlah, 0)::text || '|' ||
      kembar_ke::text
    )
  ) stored,

  dibuat_pada    timestamptz not null default now()
);

create unique index if not exists idx_mekari_baris_sidik    on mekari_baris (sidik);
create index if not exists idx_mekari_baris_impor           on mekari_baris (impor_id);
create index if not exists idx_mekari_baris_entitas         on mekari_baris (entitas);
create index if not exists idx_mekari_baris_supplier        on mekari_baris (lower(supplier));
create index if not exists idx_mekari_baris_tanggal         on mekari_baris (tanggal desc);
create index if not exists idx_mekari_baris_periode         on mekari_baris (tahun, bulan);
create index if not exists idx_mekari_baris_invoice         on mekari_baris (lower(no_invoice));

-- ---------------------------------------------------------------------------
-- Tanda pengenal hasil ekstraksi
--
-- Disimpan sebagai pasangan nilai + konteks, BUKAN sebagai kolom nopol dan
-- nomor rangka tersendiri. Besok ketika yang diaudit bukan kendaraan, nomor
-- seri mesin dan nomor kontrak masuk ke tabel yang sama tanpa satu pun
-- migration baru.
--
-- Seluruh isinya bisa dibangun ulang dari mekari_baris, jadi tabel ini boleh
-- dikosongkan kapan saja tanpa kehilangan apa pun.
-- ---------------------------------------------------------------------------

create table if not exists mekari_pengenal (
  id        uuid primary key default gen_random_uuid(),
  baris_id  uuid not null references mekari_baris(id) on delete cascade,

  -- Ikut dibawa walau bisa diturunkan dari baris_id. Membangun ulang ekstraksi
  -- satu entitas tanpa kolom ini menuntut mengirim puluhan ribu id baris ke
  -- database hanya untuk menghapusnya; dengan kolom ini cukup satu perintah.
  entitas   text not null check (entitas in (
              'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),

  nilai     text not null,

  -- Nilai beserta kata tetangganya. Tanpa ini, token telanjang "1104" cocok
  -- pada "B 1104 DKN" dan "B 1104 DKM" — dua kendaraan berbeda yang dilaporkan
  -- sebagai barang yang sama. Dua pasang seperti itu ada di berkas sungguhan.
  konteks   text not null default ''
);

create index if not exists idx_mekari_pengenal_baris   on mekari_pengenal (baris_id);
create index if not exists idx_mekari_pengenal_entitas on mekari_pengenal (entitas);
create index if not exists idx_mekari_pengenal_nilai on mekari_pengenal (nilai);

-- ---------------------------------------------------------------------------
-- Temuan
--
-- Dihitung ulang setiap kali mesin dijalankan; isinya boleh dihapus penuh.
-- Yang TIDAK boleh ikut terhapus adalah keputusan manusia atasnya — lihat
-- mekari_periksa di bawah.
-- ---------------------------------------------------------------------------

create table if not exists mekari_temuan (
  id             uuid primary key default gen_random_uuid(),

  entitas        text not null check (entitas in (
                   'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),

  -- Diturunkan dari sidik kedua barisnya, diurutkan. Tidak berubah ketika
  -- mesin dijalankan ulang dengan ambang berbeda atau urutan barisnya bertukar.
  kunci_stabil   text not null,

  baris_a        uuid not null references mekari_baris(id) on delete cascade,
  baris_b        uuid not null references mekari_baris(id) on delete cascade,

  skor           int not null default 0,
  alasan         jsonb not null default '[]'::jsonb,
  ringkasan_alasan text,

  -- Yang mungkin terbayar dua kali adalah nilai yang lebih KECIL dari kedua
  -- barisnya. Memakai yang lebih besar melebih-lebihkan paparannya.
  nilai_berisiko numeric(16, 2) not null default 0,

  dihitung_pada  timestamptz not null default now()
);

create unique index if not exists idx_mekari_temuan_kunci   on mekari_temuan (kunci_stabil);
create index if not exists idx_mekari_temuan_entitas        on mekari_temuan (entitas);
create index if not exists idx_mekari_temuan_skor           on mekari_temuan (skor desc);

-- ---------------------------------------------------------------------------
-- Hasil pemeriksaan manusia
--
-- SENGAJA TANPA FOREIGN KEY ke mekari_temuan, dan itu bukan kelalaian.
--
-- Menjalankan ulang mesin audit menghapus dan menulis ulang seluruh isi
-- mekari_temuan. Dengan kunci asing beserta on delete cascade, setiap kali
-- ambangnya digeser atau aturannya diperbaiki, seluruh hasil pemeriksaan
-- manusia akan ikut terhapus — dan yang hilang bukan data yang bisa diurai
-- ulang dari berkas, melainkan pekerjaan orang.
--
-- Penghubungnya kunci_stabil, yang bertahan melewati perhitungan ulang.
-- ---------------------------------------------------------------------------

create table if not exists mekari_periksa (
  kunci_stabil   text primary key,

  entitas        text not null check (entitas in (
                   'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),

  -- BELUM adalah keadaan awal. TERKONFIRMASI_DUPLIKAT hanya boleh dipilih
  -- manusia; mesin tidak pernah menuliskannya sendiri.
  status         text not null default 'BELUM' check (status in (
                   'BELUM', 'WAJAR', 'PERLU_TINDAK_LANJUT', 'TERKONFIRMASI_DUPLIKAT')),

  catatan        text,
  diperiksa_oleh text,
  diperiksa_pada timestamptz not null default now()
);

create index if not exists idx_mekari_periksa_status on mekari_periksa (entitas, status);

-- ---------------------------------------------------------------------------
-- Tampilan temuan beserta status pemeriksaannya
--
-- drop dulu, bukan create or replace: replace tidak bisa MENGURANGI kolom,
-- sehingga migration berikutnya yang menyusun ulang kolomnya akan gagal.
-- ---------------------------------------------------------------------------

drop view if exists mekari_temuan_periksa;
create view mekari_temuan_periksa as
select
  t.id,
  t.entitas,
  t.kunci_stabil,
  t.baris_a,
  t.baris_b,
  t.skor,
  t.alasan,
  t.ringkasan_alasan,
  t.nilai_berisiko,
  t.dihitung_pada,
  coalesce(p.status, 'BELUM') as status,
  p.catatan,
  p.diperiksa_oleh,
  p.diperiksa_pada
from mekari_temuan t
left join mekari_periksa p on p.kunci_stabil = t.kunci_stabil;

-- ---------------------------------------------------------------------------
-- Ringkasan untuk dasbor
--
-- Angkanya datang dari database, bukan dari penjumlahan di peramban. Layar
-- hanya memuat sebagian temuan, sehingga menjumlahkan yang tampak akan
-- menghasilkan paparan yang terlalu kecil — dan yang tampak kecil tidak
-- diperiksa siapa pun.
-- ---------------------------------------------------------------------------

drop function if exists ringkasan_mekari(text);
create function ringkasan_mekari(p_entitas text default null)
returns table (
  transaksi        bigint,
  nilai            numeric,
  supplier         bigint,
  produk           bigint,
  invoice          bigint,
  temuan           bigint,
  nilai_berisiko   numeric,
  belum_diperiksa  bigint
)
language sql
stable
set search_path = public
as $$
  select
    (select count(*)                       from mekari_baris b
      where p_entitas is null or b.entitas = p_entitas),
    (select coalesce(sum(b.jumlah), 0)     from mekari_baris b
      where p_entitas is null or b.entitas = p_entitas),
    (select count(distinct lower(b.supplier)) from mekari_baris b
      where (p_entitas is null or b.entitas = p_entitas) and coalesce(b.supplier, '') <> ''),
    (select count(distinct lower(b.produk))   from mekari_baris b
      where (p_entitas is null or b.entitas = p_entitas) and coalesce(b.produk, '') <> ''),
    (select count(distinct lower(b.no_invoice)) from mekari_baris b
      where (p_entitas is null or b.entitas = p_entitas) and coalesce(b.no_invoice, '') <> ''),
    (select count(*)                       from mekari_temuan_periksa t
      where p_entitas is null or t.entitas = p_entitas),
    -- Yang sudah dinyatakan WAJAR tidak ikut dihitung sebagai paparan: kalau
    -- ikut, angkanya tidak pernah turun walaupun auditornya sudah bekerja, dan
    -- dasbor yang tidak pernah berubah berhenti dibaca.
    (select coalesce(sum(t.nilai_berisiko), 0) from mekari_temuan_periksa t
      where (p_entitas is null or t.entitas = p_entitas) and t.status <> 'WAJAR'),
    (select count(*)                       from mekari_temuan_periksa t
      where (p_entitas is null or t.entitas = p_entitas) and t.status = 'BELUM')
$$;

-- ---------------------------------------------------------------------------
-- Keamanan
--
-- RLS menyala tanpa satu policy pun, sama seperti seluruh tabel lain. Kunci
-- anon tidak bisa membaca maupun menulis; seluruh akses wajib lewat API server
-- yang memegang service_role. Data pembelian supplier beserta nilainya tidak
-- pernah bisa dibaca dari peramban secara langsung.
-- ---------------------------------------------------------------------------

alter table mekari_impor    enable row level security;
alter table mekari_baris    enable row level security;
alter table mekari_pengenal enable row level security;
alter table mekari_temuan   enable row level security;
alter table mekari_periksa  enable row level security;

select pg_notify('pgrst', 'reload schema');

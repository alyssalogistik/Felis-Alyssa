-- =====================================================================
-- SETUP LENGKAP ALYSSA AUTO LOGISTIK
--
-- Berkas ini adalah gabungan migration 0001-0004 ditambah verifikasi,
-- disusun agar bisa dijalankan SEKALI PASTE dari perangkat mobile.
--
-- Dihasilkan dari berkas di supabase/migrations/ — jangan disunting di
-- sini. Kalau skemanya berubah, ubah migration aslinya lalu bangun ulang
-- berkas ini, supaya tidak ada dua sumber kebenaran yang bisa menyimpang.
--
-- Hanya membuat tabel, fungsi, dan trigger baru. Tidak ada drop table,
-- tidak ada delete, tidak ada yang menimpa data yang sudah ada.
--
-- Baris terakhir menampilkan tabel verifikasi: semuanya harus OK.
-- =====================================================================



-- =====================================================================
-- BAGIAN: 0001_skema_awal.sql
-- =====================================================================

-- Skema awal Alyssa Auto Logistik.
--
-- Alur bisnisnya: customer menitipkan unit kendaraan, unit itu diangkut lewat
-- kapal dalam satu trip, lalu ditagih. Jadi pesanan adalah inti datanya, trip
-- mengelompokkan pesanan yang berangkat bersama, dan invoice menutup transaksi.
--
-- Row Level Security dinyalakan tanpa policy apa pun. Artinya kunci anon tidak
-- bisa membaca apa-apa, dan seluruh akses harus lewat API server yang memakai
-- service_role. Ini disengaja: kunci admin tidak pernah sampai ke browser.

-- ---------------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------------

create table if not exists kapal (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null,
  kode        text not null unique,
  rute        text,
  aktif       boolean not null default true,
  dibuat_pada timestamptz not null default now()
);

create table if not exists driver (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null,
  telepon     text,
  no_sim      text,
  aktif       boolean not null default true,
  dibuat_pada timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Trip: satu keberangkatan kapal yang mengangkut banyak pesanan
-- ---------------------------------------------------------------------------

create table if not exists trip (
  id                uuid primary key default gen_random_uuid(),
  kode_trip         text not null unique,
  kapal_id          uuid references kapal(id) on delete set null,
  driver_id         uuid references driver(id) on delete set null,
  asal              text not null,
  tujuan            text not null,
  tanggal_berangkat date,
  tanggal_tiba      date,
  status            text not null default 'disiapkan'
                      check (status in ('disiapkan', 'berangkat', 'tiba', 'batal')),
  catatan           text,
  dibuat_pada       timestamptz not null default now(),
  diubah_pada       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Pesanan: inti data operasional
-- ---------------------------------------------------------------------------

create table if not exists pesanan (
  id                uuid primary key default gen_random_uuid(),
  no_resi           text not null unique,

  customer_nama     text not null,
  customer_telepon  text,
  penerima_nama     text,
  penerima_telepon  text,

  unit_merk         text not null,
  unit_tipe         text,
  unit_nopol        text,
  unit_tahun        int check (unit_tahun is null or unit_tahun between 1900 and 2100),
  unit_warna        text,

  asal              text not null,
  tujuan            text not null,

  -- Status mengikuti istilah yang sudah dipakai di lapangan.
  status            text not null default 'baru'
                      check (status in ('baru', 'dispatched', 'on_trip', 'selesai', 'batal')),

  trip_id           uuid references trip(id) on delete set null,

  harga             numeric(14, 2) not null default 0 check (harga >= 0),
  catatan           text,

  dibuat_pada       timestamptz not null default now(),
  diubah_pada       timestamptz not null default now()
);

-- Kolom yang dipakai untuk filter dan urutan di dashboard.
create index if not exists idx_pesanan_status on pesanan (status);
create index if not exists idx_pesanan_trip on pesanan (trip_id);
create index if not exists idx_pesanan_dibuat on pesanan (dibuat_pada desc);

-- Pencarian bebas dari kotak "Cari No. Resi / Customer / Unit".
create index if not exists idx_pesanan_cari on pesanan
  using gin (to_tsvector('simple',
    coalesce(no_resi, '') || ' ' ||
    coalesce(customer_nama, '') || ' ' ||
    coalesce(unit_merk, '') || ' ' ||
    coalesce(unit_tipe, '') || ' ' ||
    coalesce(unit_nopol, '')));

-- ---------------------------------------------------------------------------
-- Riwayat perjalanan pesanan, sumber data halaman Tracking
-- ---------------------------------------------------------------------------

create table if not exists tracking_event (
  id          uuid primary key default gen_random_uuid(),
  pesanan_id  uuid not null references pesanan(id) on delete cascade,
  status      text not null,
  lokasi      text,
  catatan     text,
  dibuat_pada timestamptz not null default now()
);

create index if not exists idx_tracking_pesanan on tracking_event (pesanan_id, dibuat_pada desc);

-- ---------------------------------------------------------------------------
-- Invoice
-- ---------------------------------------------------------------------------

create table if not exists invoice (
  id            uuid primary key default gen_random_uuid(),
  no_invoice    text not null unique,
  pesanan_id    uuid not null references pesanan(id) on delete restrict,
  jumlah        numeric(14, 2) not null check (jumlah >= 0),
  status        text not null default 'draft'
                  check (status in ('draft', 'terkirim', 'lunas', 'batal')),
  jatuh_tempo   date,
  dibayar_pada  timestamptz,
  dibuat_pada   timestamptz not null default now(),
  diubah_pada   timestamptz not null default now()
);

create index if not exists idx_invoice_status on invoice (status);
create index if not exists idx_invoice_pesanan on invoice (pesanan_id);


-- =====================================================================
-- BAGIAN: 0002_otomatis_dan_keamanan.sql
-- =====================================================================

-- Otomatisasi penomoran, stempel waktu, dan penguncian akses.

-- ---------------------------------------------------------------------------
-- Penomoran resi dan invoice
--
-- Nomor dibuat di database, bukan di aplikasi, supaya dua request yang masuk
-- bersamaan tidak pernah menghasilkan nomor kembar.
-- ---------------------------------------------------------------------------

create sequence if not exists seq_no_resi;
create sequence if not exists seq_no_invoice;

create or replace function set_no_resi()
returns trigger
language plpgsql
as $$
begin
  if new.no_resi is null or new.no_resi = '' then
    -- Contoh: ALS-2609-0042
    new.no_resi := 'ALS-'
      || to_char(now() at time zone 'Asia/Jakarta', 'YYMM')
      || '-'
      || lpad(nextval('seq_no_resi')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function set_no_invoice()
returns trigger
language plpgsql
as $$
begin
  if new.no_invoice is null or new.no_invoice = '' then
    new.no_invoice := 'INV-'
      || to_char(now() at time zone 'Asia/Jakarta', 'YYMM')
      || '-'
      || lpad(nextval('seq_no_invoice')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pesanan_no_resi on pesanan;
create trigger trg_pesanan_no_resi
  before insert on pesanan
  for each row execute function set_no_resi();

drop trigger if exists trg_invoice_no_invoice on invoice;
create trigger trg_invoice_no_invoice
  before insert on invoice
  for each row execute function set_no_invoice();

-- ---------------------------------------------------------------------------
-- Stempel waktu perubahan
-- ---------------------------------------------------------------------------

create or replace function sentuh_diubah_pada()
returns trigger
language plpgsql
as $$
begin
  new.diubah_pada := now();
  return new;
end;
$$;

drop trigger if exists trg_pesanan_diubah on pesanan;
create trigger trg_pesanan_diubah
  before update on pesanan
  for each row execute function sentuh_diubah_pada();

drop trigger if exists trg_trip_diubah on trip;
create trigger trg_trip_diubah
  before update on trip
  for each row execute function sentuh_diubah_pada();

drop trigger if exists trg_invoice_diubah on invoice;
create trigger trg_invoice_diubah
  before update on invoice
  for each row execute function sentuh_diubah_pada();

-- ---------------------------------------------------------------------------
-- Jejak status pesanan
--
-- Setiap perubahan status otomatis tercatat di tracking_event, supaya riwayat
-- tidak bergantung pada aplikasi mengingat untuk mencatat.
-- ---------------------------------------------------------------------------

create or replace function catat_perubahan_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into tracking_event (pesanan_id, status, catatan)
    values (new.id, new.status, 'Status otomatis tercatat');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pesanan_jejak_status on pesanan;
create trigger trg_pesanan_jejak_status
  after insert or update of status on pesanan
  for each row execute function catat_perubahan_status();

-- ---------------------------------------------------------------------------
-- Keamanan
--
-- RLS dinyalakan tanpa policy sama sekali. Efeknya: kunci anon (yang boleh ada
-- di browser) tidak bisa membaca maupun menulis apa pun. Semua akses wajib
-- lewat API server yang memegang service_role. Kalau nanti butuh akses
-- langsung dari browser, tambahkan policy secara eksplisit per tabel.
-- ---------------------------------------------------------------------------

alter table kapal          enable row level security;
alter table driver         enable row level security;
alter table trip           enable row level security;
alter table pesanan        enable row level security;
alter table tracking_event enable row level security;
alter table invoice        enable row level security;


-- =====================================================================
-- BAGIAN: 0003_rekonsiliasi_bank.sql
-- =====================================================================

-- Rekonsiliasi Bank: menyimpan hasil unggahan rekening koran dan status rekonnya.
--
-- Setiap unggahan dicatat sebagai satu batch, dan tiap transaksi menunjuk balik
-- ke batch serta nomor barisnya di berkas asal. Tanpa jejak itu, transaksi yang
-- mencurigakan tidak bisa ditelusuri kembali ke sumbernya saat audit.

-- ---------------------------------------------------------------------------
-- Batch unggahan
-- ---------------------------------------------------------------------------

create table if not exists unggahan_rekening_koran (
  id                     uuid primary key default gen_random_uuid(),
  nama_berkas            text not null,

  -- Sidik jari isi berkas. Dipakai untuk mengenali berkas yang sama diunggah
  -- dua kali, termasuk bila namanya sudah diganti.
  hash_berkas            text not null,

  sheet                  text,
  baris_header           int,
  jumlah_transaksi       int  not null default 0,
  jumlah_valid           int  not null default 0,
  jumlah_perlu_diperiksa int  not null default 0,
  jumlah_duplikat        int  not null default 0,
  jumlah_tanggal_ambigu  int  not null default 0,
  diunggah_pada          timestamptz not null default now()
);

create index if not exists idx_unggahan_hash on unggahan_rekening_koran (hash_berkas);
create index if not exists idx_unggahan_waktu on unggahan_rekening_koran (diunggah_pada desc);

-- ---------------------------------------------------------------------------
-- Transaksi rekening koran
-- ---------------------------------------------------------------------------

create table if not exists transaksi_bank (
  id           uuid primary key default gen_random_uuid(),
  unggahan_id  uuid not null references unggahan_rekening_koran(id) on delete cascade,

  -- Nomor baris di berkas asal, untuk menelusuri balik saat audit.
  baris_sumber int,
  berkas_sumber text,

  -- Boleh null: baris dengan tanggal rusak tetap disimpan dan ditandai, bukan
  -- dibuang diam-diam. Bertipe date, bukan timestamptz, karena rekening koran
  -- tidak punya jam — sehingga tidak ada timezone yang bisa menggeser hari.
  tanggal      date,
  tanggal_ambigu boolean not null default false,

  -- Teks asli dari rekening koran. Tidak pernah diubah, karena inilah yang
  -- dicocokkan saat audit.
  keterangan   text not null,

  debit        numeric(14, 2) not null default 0 check (debit  >= 0),
  kredit       numeric(14, 2) not null default 0 check (kredit >= 0),
  saldo        numeric(14, 2),
  referensi    text,

  -- Mutu data hasil penguraian.
  status_data  text not null default 'valid'
                 check (status_data in ('valid', 'perlu_diperiksa')),
  masalah      text[] not null default '{}',
  duplikat     boolean not null default false,

  -- Status rekonsiliasi, diisi manusia setelah mencocokkan.
  status_rekon text not null default 'belum'
                 check (status_rekon in ('belum', 'sudah', 'selisih')),
  referensi_rekon    text,
  catatan_rekon      text,
  nominal_pembanding numeric(14, 2),
  selisih            numeric(14, 2),
  direkon_pada       timestamptz,
  direkon_oleh       text,

  dibuat_pada  timestamptz not null default now()
);

-- Bulan dan tahun disimpan sebagai kolom tersendiri, bukan dihitung saat query.
-- Menyaring dengan extract() membuat indeks pada tanggal dilewati, sedangkan
-- kolom tersimpan bisa diindeks dan disamakan langsung. Keduanya turunan dari
-- tanggal, jadi tidak mungkin melenceng dari sumbernya.
alter table transaksi_bank
  add column if not exists bulan int generated always as (extract(month from tanggal)) stored,
  add column if not exists tahun int generated always as (extract(year  from tanggal)) stored;

create index if not exists idx_transaksi_tanggal on transaksi_bank (tanggal desc);
create index if not exists idx_transaksi_periode on transaksi_bank (tahun, bulan);
create index if not exists idx_transaksi_status_rekon on transaksi_bank (status_rekon);
create index if not exists idx_transaksi_unggahan on transaksi_bank (unggahan_id);

-- Mempercepat pencarian "mengandung kata" pada keterangan. Ekstensi pg_trgm
-- membuat ILIKE '%kata%' bisa memakai indeks, yang tanpa itu selalu memindai
-- seluruh tabel.
create extension if not exists pg_trgm;
create index if not exists idx_transaksi_keterangan_trgm
  on transaksi_bank using gin (keterangan gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Perbandingan nominal
--
-- Selisih dan status dihitung di database, bukan di aplikasi, supaya sebuah
-- transaksi tidak pernah bisa berstatus "sudah rekon" sementara angkanya
-- sebenarnya berbeda — dari jalur mana pun baris itu ditulis.
-- ---------------------------------------------------------------------------

create or replace function hitung_status_rekon()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.nominal_pembanding is null then
    new.selisih := null;
    -- Tanpa pembanding, kecocokan hanya bisa dinyatakan manusia.
    if new.status_rekon = 'selisih' then new.status_rekon := 'belum'; end if;
  else
    -- Salah satu dari debit/kredit selalu nol, jadi jumlahnya adalah nominal
    -- transaksi itu sendiri.
    new.selisih := new.nominal_pembanding - (new.debit + new.kredit);
    new.status_rekon := case when new.selisih = 0 then 'sudah' else 'selisih' end;
  end if;

  if new.status_rekon <> 'belum' and new.direkon_pada is null then
    new.direkon_pada := now();
  elsif new.status_rekon = 'belum' then
    new.direkon_pada := null;
    new.direkon_oleh := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_transaksi_status_rekon on transaksi_bank;
create trigger trg_transaksi_status_rekon
  before insert or update of nominal_pembanding, status_rekon, debit, kredit
  on transaksi_bank
  for each row execute function hitung_status_rekon();

-- ---------------------------------------------------------------------------
-- Ringkasan mengikuti filter aktif
--
-- Penjumlahan dilakukan di database agar ringkasan tidak perlu menarik ribuan
-- baris ke aplikasi hanya untuk dijumlahkan. Syarat filternya sengaja disusun
-- sama persis dengan yang ada di src/rekonsiliasi/saringan.js.
-- ---------------------------------------------------------------------------

create or replace function ringkasan_transaksi_bank(
  p_cari   text default null,
  p_bulan  int  default null,
  p_tahun  int  default null,
  p_dari   date default null,
  p_sampai date default null
)
returns table (jumlah bigint, debit numeric, kredit numeric, net numeric)
language sql
stable
set search_path = public
as $$
  select
    count(*),
    coalesce(sum(t.debit), 0),
    coalesce(sum(t.kredit), 0),
    coalesce(sum(t.kredit), 0) - coalesce(sum(t.debit), 0)
  from transaksi_bank t
  where (p_cari is null or p_cari = ''
         or t.keterangan ilike '%' || p_cari || '%'
         or coalesce(t.referensi, '') ilike '%' || p_cari || '%')
    -- Perbandingan terhadap tanggal null menghasilkan null, sehingga baris
    -- bertanggal rusak otomatis tidak ikut begitu ada filter waktu.
    and (p_bulan  is null or t.bulan = p_bulan)
    and (p_tahun  is null or t.tahun = p_tahun)
    and (p_dari   is null or t.tanggal >= p_dari)
    and (p_sampai is null or t.tanggal <= p_sampai);
$$;

-- ---------------------------------------------------------------------------
-- Keamanan
--
-- Sama seperti tabel lain: RLS menyala tanpa policy, sehingga kunci anon tidak
-- bisa menyentuh data keuangan ini. Seluruh akses lewat API server.
-- ---------------------------------------------------------------------------

alter table unggahan_rekening_koran enable row level security;
alter table transaksi_bank          enable row level security;


-- =====================================================================
-- BAGIAN: 0004_audit_pemasok.sql
-- =====================================================================

-- Audit pembayaran supplier: tagihan yang masuk, dan pencocokannya dengan
-- transaksi rekening koran.
--
-- Tabel `invoice` yang sudah ada adalah tagihan KE customer (uang masuk).
-- Tagihan DARI supplier adalah arah sebaliknya, dengan aturan yang berbeda
-- (PPh dipotong, satu supplier bisa punya banyak nama di rekening koran),
-- sehingga dipisahkan alih-alih ditumpangkan.

-- ---------------------------------------------------------------------------
-- Supplier
-- ---------------------------------------------------------------------------

create table if not exists pemasok (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null unique,

  -- Nama yang muncul di rekening koran sering berbeda dari nama resmi.
  -- Alias dikumpulkan di sini supaya pencocokan tidak perlu menebak dua kali.
  alias       text[] not null default '{}',

  npwp        text,
  aktif       boolean not null default true,
  dibuat_pada timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tagihan supplier
-- ---------------------------------------------------------------------------

create table if not exists tagihan_pemasok (
  id              uuid primary key default gen_random_uuid(),
  pemasok_id      uuid not null references pemasok(id) on delete restrict,

  no_invoice      text not null,
  tanggal_invoice date not null,
  jatuh_tempo     date,

  -- Nilai penuh tagihan sebelum potongan apa pun.
  gross           numeric(14, 2) not null check (gross >= 0),
  -- Pajak penghasilan yang dipotong dan disetor sendiri, bukan ditransfer.
  pph             numeric(14, 2) not null default 0 check (pph >= 0),

  -- Yang seharusnya benar-benar keluar dari rekening. Dihitung database supaya
  -- angka acuan audit tidak pernah bergantung pada aplikasi menghitung benar.
  net_seharusnya  numeric(14, 2) generated always as (gross - pph) stored,

  keterangan      text,
  berkas_sumber   text,

  -- Sejalan dengan transaksi_bank, supaya filter bulan/tahun terindeks.
  bulan int generated always as (extract(month from tanggal_invoice)) stored,
  tahun int generated always as (extract(year  from tanggal_invoice)) stored,

  dibuat_pada     timestamptz not null default now(),

  -- Satu supplier tidak menerbitkan dua invoice bernomor sama; ini yang
  -- menahan unggahan ganda menggandakan tagihan.
  unique (pemasok_id, no_invoice),
  constraint pph_tidak_melebihi_gross check (pph <= gross)
);

create index if not exists idx_tagihan_pemasok on tagihan_pemasok (pemasok_id);
create index if not exists idx_tagihan_periode on tagihan_pemasok (tahun, bulan);
create index if not exists idx_tagihan_tanggal on tagihan_pemasok (tanggal_invoice desc);

-- ---------------------------------------------------------------------------
-- Hasil pencocokan
-- ---------------------------------------------------------------------------

create table if not exists kecocokan (
  id           uuid primary key default gen_random_uuid(),

  tagihan_id   uuid references tagihan_pemasok(id) on delete cascade,
  transaksi_id uuid references transaksi_bank(id)  on delete cascade,

  status       text not null check (status in (
                 'MATCH', 'KURANG_BAYAR', 'LEBIH_BAYAR',
                 'INVOICE_BELUM_ADA_TRANSFER', 'TRANSFER_TANPA_INVOICE', 'PERLU_REVIEW')),

  -- 0 sampai 1. Dicatat agar hasil audit bisa disaring berdasarkan seberapa
  -- yakin mesin, bukan diterima bulat-bulat.
  keyakinan    numeric(4, 3) not null default 0 check (keyakinan between 0 and 1),
  selisih      numeric(14, 2),
  alasan       text[] not null default '{}',

  -- Dibedakan supaya keputusan manusia tidak tertimpa saat audit diulang.
  otomatis      boolean not null default true,
  dikonfirmasi  boolean not null default false,
  catatan       text,

  dibuat_pada  timestamptz not null default now(),

  -- Satu tagihan satu pasangan, satu transaksi satu pasangan. Tanpa ini satu
  -- transfer bisa membuat beberapa tagihan tampak lunas sekaligus.
  unique (tagihan_id),
  unique (transaksi_id),
  constraint minimal_satu_sisi check (tagihan_id is not null or transaksi_id is not null)
);

create index if not exists idx_kecocokan_status on kecocokan (status);

-- ---------------------------------------------------------------------------
-- Tampilan audit
--
-- Bentuknya persis kolom yang dibaca saat audit, sehingga penyaringan dan
-- pengurutan bisa dilakukan database alih-alih menarik semuanya ke aplikasi.
-- ---------------------------------------------------------------------------

create or replace view audit_pembayaran_pemasok
with (security_invoker = true) as
select
  t.id                as tagihan_id,
  p.id                as pemasok_id,
  p.nama              as pemasok,
  t.no_invoice,
  t.tanggal_invoice,
  t.bulan,
  t.tahun,
  t.gross,
  t.pph,
  t.net_seharusnya,
  k.transaksi_id,
  b.tanggal           as tanggal_transfer,
  b.keterangan        as keterangan_transfer,
  b.debit             as transfer_bank,
  k.selisih,
  coalesce(k.status, 'INVOICE_BELUM_ADA_TRANSFER') as status,
  coalesce(k.keyakinan, 0) as keyakinan,
  coalesce(k.alasan, '{}') as alasan,
  coalesce(k.dikonfirmasi, false) as dikonfirmasi,
  k.catatan
from tagihan_pemasok t
join pemasok p        on p.id = t.pemasok_id
left join kecocokan k on k.tagihan_id = t.id
left join transaksi_bank b on b.id = k.transaksi_id

union all

-- Uang keluar yang tidak terhubung tagihan mana pun ikut di tampilan yang sama.
-- Dipisah ke daftar tersendiri akan memaksa auditor melihat dua tempat untuk
-- menjawab satu pertanyaan: apa saja yang menyimpang bulan ini.
select
  null::uuid, null::uuid, '(tanpa tagihan)',
  null::text, null::date,
  extract(month from b.tanggal)::int,
  extract(year  from b.tanggal)::int,
  null::numeric(14,2), null::numeric(14,2), null::numeric(14,2),
  k.transaksi_id, b.tanggal, b.keterangan, b.debit,
  null::numeric(14,2),
  k.status, k.keyakinan, k.alasan, k.dikonfirmasi, k.catatan
from kecocokan k
join transaksi_bank b on b.id = k.transaksi_id
where k.tagihan_id is null;

-- ---------------------------------------------------------------------------
-- Ringkasan audit mengikuti filter aktif
-- ---------------------------------------------------------------------------

create or replace function ringkasan_audit_pemasok(
  p_pemasok text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_status  text default null
)
returns table (
  total_tagihan bigint,
  total_gross numeric,
  total_pph numeric,
  total_transfer numeric,
  total_selisih numeric,
  perlu_perhatian bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where a.tagihan_id is not null),
    coalesce(sum(a.gross), 0),
    coalesce(sum(a.pph), 0),
    coalesce(sum(a.transfer_bank), 0),
    coalesce(sum(a.selisih), 0),
    count(*) filter (where a.status <> 'MATCH')
  from audit_pembayaran_pemasok a
  where (p_pemasok is null or p_pemasok = '' or a.pemasok ilike '%' || p_pemasok || '%')
    and (p_bulan  is null or a.bulan = p_bulan)
    and (p_tahun  is null or a.tahun = p_tahun)
    and (p_status is null or p_status = '' or a.status = p_status);
$$;

-- ---------------------------------------------------------------------------
-- Keamanan: sama seperti tabel lain, tanpa policy.
-- ---------------------------------------------------------------------------

alter table pemasok        enable row level security;
alter table tagihan_pemasok enable row level security;
alter table kecocokan      enable row level security;


-- =====================================================================
-- VERIFIKASI (read-only) — semua baris harus OK
-- =====================================================================

-- Verifikasi hasil migration. Jalankan di Supabase SQL Editor SETELAH 0001-0003.
--
-- Hanya membaca katalog sistem: tidak menyisipkan, mengubah, maupun menghapus
-- apa pun. Aman dijalankan berulang kali pada project yang sudah berisi data.
--
-- Semua baris harus berbunyi OK. Satu saja BELUM berarti ada migration yang
-- belum jalan atau jalan sebagian.

with periksa as (
  select 'Tabel inti (8)' as bagian,
         count(*) = 8 as lolos,
         count(*) || ' dari 8' as rincian
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('kapal', 'driver', 'trip', 'pesanan', 'tracking_event',
                      'invoice', 'unggahan_rekening_koran', 'transaksi_bank')

  union all
  -- Diperiksa per nama, bukan lewat jumlah total, supaya penambahan kolom di
  -- kemudian hari tidak membuat verifikasi ini berbunyi gagal tanpa sebab.
  select 'Kolom wajib transaksi_bank',
         count(*) = 12,
         count(*) || ' dari 12'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaksi_bank'
    and column_name in ('tanggal', 'keterangan', 'debit', 'kredit', 'saldo',
                        'referensi', 'status_data', 'status_rekon',
                        'nominal_pembanding', 'selisih', 'direkon_pada', 'direkon_oleh')

  union all
  -- Kolom turunan ini yang membuat filter bulan/tahun bisa memakai indeks.
  select 'Kolom turunan bulan & tahun',
         count(*) = 2,
         string_agg(column_name, ', ' order by column_name)
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaksi_bank'
    and column_name in ('bulan', 'tahun')
    and is_generated = 'ALWAYS'

  union all
  select 'Kolom tanggal bertipe date (bukan timestamptz)',
         data_type = 'date',
         data_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaksi_bank' and column_name = 'tanggal'

  union all
  -- Inti jaminan Fase 6: status rekon tidak bisa berbohong soal nominal.
  select 'Trigger perbandingan nominal',
         count(*) = 1,
         coalesce(string_agg(tgname, ', '), 'tidak ada')
  from pg_trigger
  where tgrelid = 'public.transaksi_bank'::regclass and tgname = 'trg_transaksi_status_rekon'

  union all
  select 'Trigger nomor resi & jejak status pesanan',
         count(*) = 3,
         count(*) || ' dari 3'
  from pg_trigger
  where tgrelid = 'public.pesanan'::regclass and not tgisinternal

  union all
  select 'Fungsi ringkasan_transaksi_bank',
         count(*) = 1,
         count(*) || ' fungsi'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ringkasan_transaksi_bank'

  union all
  select 'Ekstensi pg_trgm (pencarian terindeks)',
         count(*) = 1,
         coalesce(string_agg(extname, ', '), 'belum dipasang')
  from pg_extension where extname = 'pg_trgm'

  union all
  select 'Indeks transaksi_bank (5)',
         count(*) >= 5,
         count(*) || ' indeks'
  from pg_indexes
  where schemaname = 'public' and tablename = 'transaksi_bank'

  union all
  -- RLS menyala tanpa policy: kunci anon tidak bisa menyentuh data sama sekali.
  select 'RLS menyala di semua tabel',
         count(*) filter (where not c.relrowsecurity) = 0,
         count(*) filter (where c.relrowsecurity) || ' dari ' || count(*)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'

  union all
  select 'Tidak ada policy (akses hanya lewat API server)',
         count(*) = 0,
         count(*) || ' policy'
  from pg_policies where schemaname = 'public'
)
select
  case when lolos then 'OK' else 'BELUM' end as status,
  bagian,
  rincian
from periksa
order by lolos, bagian;

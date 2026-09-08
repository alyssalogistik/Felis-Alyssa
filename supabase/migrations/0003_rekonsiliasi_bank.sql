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

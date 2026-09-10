-- SETUP DATABASE ALYSSA AUTO LOGISTIK
-- Satu perintah. Salin seluruhnya, tempel, Run.
-- Hanya menambah tabel, fungsi, view, indeks, dan trigger baru.
-- Aman dijalankan berulang; data yang sudah ada tidak tersentuh.
do $migrasi$
begin
--
--
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
  status            text not null default 'baru'
                      check (status in ('baru', 'dispatched', 'on_trip', 'selesai', 'batal')),
  trip_id           uuid references trip(id) on delete set null,
  harga             numeric(14, 2) not null default 0 check (harga >= 0),
  catatan           text,
  dibuat_pada       timestamptz not null default now(),
  diubah_pada       timestamptz not null default now()
);
create index if not exists idx_pesanan_status on pesanan (status);
create index if not exists idx_pesanan_trip on pesanan (trip_id);
create index if not exists idx_pesanan_dibuat on pesanan (dibuat_pada desc);
create index if not exists idx_pesanan_cari on pesanan
  using gin (to_tsvector('simple',
    coalesce(no_resi, '') || ' ' ||
    coalesce(customer_nama, '') || ' ' ||
    coalesce(unit_merk, '') || ' ' ||
    coalesce(unit_tipe, '') || ' ' ||
    coalesce(unit_nopol, '')));
create table if not exists tracking_event (
  id          uuid primary key default gen_random_uuid(),
  pesanan_id  uuid not null references pesanan(id) on delete cascade,
  status      text not null,
  lokasi      text,
  catatan     text,
  dibuat_pada timestamptz not null default now()
);
create index if not exists idx_tracking_pesanan on tracking_event (pesanan_id, dibuat_pada desc);
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
--
create sequence if not exists seq_no_resi;
create sequence if not exists seq_no_invoice;
create or replace function set_no_resi()
returns trigger
language plpgsql
as $fn$
begin
  if new.no_resi is null or new.no_resi = '' then
    new.no_resi := 'ALS-'
      || to_char(now() at time zone 'Asia/Jakarta', 'YYMM')
      || '-'
      || lpad(nextval('seq_no_resi')::text, 4, '0');
  end if;
  return new;
end;
$fn$;
create or replace function set_no_invoice()
returns trigger
language plpgsql
as $fn$
begin
  if new.no_invoice is null or new.no_invoice = '' then
    new.no_invoice := 'INV-'
      || to_char(now() at time zone 'Asia/Jakarta', 'YYMM')
      || '-'
      || lpad(nextval('seq_no_invoice')::text, 4, '0');
  end if;
  return new;
end;
$fn$;
create or replace trigger trg_pesanan_no_resi
  before insert on pesanan
  for each row execute function set_no_resi();
create or replace trigger trg_invoice_no_invoice
  before insert on invoice
  for each row execute function set_no_invoice();
create or replace function sentuh_diubah_pada()
returns trigger
language plpgsql
as $fn$
begin
  new.diubah_pada := now();
  return new;
end;
$fn$;
create or replace trigger trg_pesanan_diubah
  before update on pesanan
  for each row execute function sentuh_diubah_pada();
create or replace trigger trg_trip_diubah
  before update on trip
  for each row execute function sentuh_diubah_pada();
create or replace trigger trg_invoice_diubah
  before update on invoice
  for each row execute function sentuh_diubah_pada();
--
create or replace function catat_perubahan_status()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into tracking_event (pesanan_id, status, catatan)
    values (new.id, new.status, 'Status otomatis tercatat');
  end if;
  return new;
end;
$fn$;
create or replace trigger trg_pesanan_jejak_status
  after insert or update of status on pesanan
  for each row execute function catat_perubahan_status();
--
alter table kapal          enable row level security;
alter table driver         enable row level security;
alter table trip           enable row level security;
alter table pesanan        enable row level security;
alter table tracking_event enable row level security;
alter table invoice        enable row level security;
--
create table if not exists unggahan_rekening_koran (
  id                     uuid primary key default gen_random_uuid(),
  nama_berkas            text not null,
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
create table if not exists transaksi_bank (
  id           uuid primary key default gen_random_uuid(),
  unggahan_id  uuid not null references unggahan_rekening_koran(id) on delete cascade,
  baris_sumber int,
  berkas_sumber text,
  tanggal      date,
  tanggal_ambigu boolean not null default false,
  keterangan   text not null,
  debit        numeric(14, 2) not null default 0 check (debit  >= 0),
  kredit       numeric(14, 2) not null default 0 check (kredit >= 0),
  saldo        numeric(14, 2),
  referensi    text,
  status_data  text not null default 'valid'
                 check (status_data in ('valid', 'perlu_diperiksa')),
  masalah      text[] not null default '{}',
  duplikat     boolean not null default false,
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
alter table transaksi_bank
  add column if not exists bulan int generated always as (extract(month from tanggal)) stored,
  add column if not exists tahun int generated always as (extract(year  from tanggal)) stored;
create index if not exists idx_transaksi_tanggal on transaksi_bank (tanggal desc);
create index if not exists idx_transaksi_periode on transaksi_bank (tahun, bulan);
create index if not exists idx_transaksi_status_rekon on transaksi_bank (status_rekon);
create index if not exists idx_transaksi_unggahan on transaksi_bank (unggahan_id);
create extension if not exists pg_trgm;
create index if not exists idx_transaksi_keterangan_trgm
  on transaksi_bank using gin (keterangan gin_trgm_ops);
--
create or replace function hitung_status_rekon()
returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  if new.nominal_pembanding is null then
    new.selisih := null;
    if new.status_rekon = 'selisih' then new.status_rekon := 'belum'; end if;
  else
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
$fn$;
create or replace trigger trg_transaksi_status_rekon
  before insert or update of nominal_pembanding, status_rekon, debit, kredit
  on transaksi_bank
  for each row execute function hitung_status_rekon();
--
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
as $fn$
  select
    count(*),
    coalesce(sum(t.debit), 0),
    coalesce(sum(t.kredit), 0),
    coalesce(sum(t.kredit), 0) - coalesce(sum(t.debit), 0)
  from transaksi_bank t
  where (p_cari is null or p_cari = ''
         or t.keterangan ilike '%' || p_cari || '%'
         or coalesce(t.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan  is null or t.bulan = p_bulan)
    and (p_tahun  is null or t.tahun = p_tahun)
    and (p_dari   is null or t.tanggal >= p_dari)
    and (p_sampai is null or t.tanggal <= p_sampai);
$fn$;
--
alter table unggahan_rekening_koran enable row level security;
alter table transaksi_bank          enable row level security;
--
create table if not exists pemasok (
  id          uuid primary key default gen_random_uuid(),
  nama        text not null unique,
  alias       text[] not null default '{}',
  npwp        text,
  aktif       boolean not null default true,
  dibuat_pada timestamptz not null default now()
);
create table if not exists tagihan_pemasok (
  id              uuid primary key default gen_random_uuid(),
  pemasok_id      uuid not null references pemasok(id) on delete restrict,
  no_invoice      text not null,
  tanggal_invoice date not null,
  jatuh_tempo     date,
  gross           numeric(14, 2) not null check (gross >= 0),
  pph             numeric(14, 2) not null default 0 check (pph >= 0),
  net_seharusnya  numeric(14, 2) generated always as (gross - pph) stored,
  keterangan      text,
  berkas_sumber   text,
  bulan int generated always as (extract(month from tanggal_invoice)) stored,
  tahun int generated always as (extract(year  from tanggal_invoice)) stored,
  dibuat_pada     timestamptz not null default now(),
  unique (pemasok_id, no_invoice),
  constraint pph_tidak_melebihi_gross check (pph <= gross)
);
create index if not exists idx_tagihan_pemasok on tagihan_pemasok (pemasok_id);
create index if not exists idx_tagihan_periode on tagihan_pemasok (tahun, bulan);
create index if not exists idx_tagihan_tanggal on tagihan_pemasok (tanggal_invoice desc);
create table if not exists kecocokan (
  id           uuid primary key default gen_random_uuid(),
  tagihan_id   uuid references tagihan_pemasok(id) on delete cascade,
  transaksi_id uuid references transaksi_bank(id)  on delete cascade,
  status       text not null check (status in (
                 'MATCH', 'KURANG_BAYAR', 'LEBIH_BAYAR',
                 'INVOICE_BELUM_ADA_TRANSFER', 'TRANSFER_TANPA_INVOICE', 'PERLU_REVIEW')),
  keyakinan    numeric(4, 3) not null default 0 check (keyakinan between 0 and 1),
  selisih      numeric(14, 2),
  alasan       text[] not null default '{}',
  otomatis      boolean not null default true,
  dikonfirmasi  boolean not null default false,
  catatan       text,
  dibuat_pada  timestamptz not null default now(),
  unique (tagihan_id),
  unique (transaksi_id),
  constraint minimal_satu_sisi check (tagihan_id is not null or transaksi_id is not null)
);
create index if not exists idx_kecocokan_status on kecocokan (status);
--
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
as $fn$
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
$fn$;
alter table pemasok        enable row level security;
alter table tagihan_pemasok enable row level security;
alter table kecocokan      enable row level security;

-- Setelah skema berubah, PostgREST masih memakai peta lama sampai diberi
-- tahu. Tanpa ini tabel baru tetap dilaporkan "not found in the schema
-- cache" walaupun sudah ada.
perform pg_notify('pgrst', 'reload schema');

raise notice 'Setup Alyssa selesai. Tabel audit supplier siap dipakai.';
end
$migrasi$;

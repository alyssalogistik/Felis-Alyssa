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
drop view if exists audit_pembayaran_pemasok;
create view audit_pembayaran_pemasok
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
  p_status  text default null,
  p_dari    date default null,
  p_sampai  date default null
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
    and (p_status is null or p_status = '' or a.status = p_status)
    and (p_dari   is null or a.tanggal_invoice >= p_dari)
    and (p_sampai is null or a.tanggal_invoice <= p_sampai);
$fn$;
alter table pemasok        enable row level security;
alter table tagihan_pemasok enable row level security;
alter table kecocokan      enable row level security;
--
--
--
drop function if exists ringkasan_audit_pemasok(text, int, int, text);
create or replace function ringkasan_audit_pemasok(
  p_pemasok text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_status  text default null,
  p_dari    date default null,
  p_sampai  date default null
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
    and (p_status is null or p_status = '' or a.status = p_status)
    and (p_dari   is null or a.tanggal_invoice >= p_dari)
    and (p_sampai is null or a.tanggal_invoice <= p_sampai);
$fn$;
--
--
--
alter table transaksi_bank
  add column if not exists no_rekening text,
  add column if not exists kembar_ke int not null default 1;
--
--
--
--
--
do $nomori$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'transaksi_bank' and column_name = 'sidik'
  ) then
    update transaksi_bank t
    set kembar_ke = u.urutan
    from (
      select id,
             row_number() over (
               partition by
                 coalesce(no_rekening, ''),
                 tanggal,
                 lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')),
                 coalesce(debit, 0),
                 coalesce(kredit, 0),
                 lower(coalesce(referensi, ''))
               order by dibuat_pada, id
             ) as urutan
      from transaksi_bank
    ) u
    where t.id = u.id and t.kembar_ke is distinct from u.urutan;
  end if;
end
$nomori$;
alter table transaksi_bank
  add column if not exists sidik text generated always as (
    md5(
      coalesce(no_rekening, '') || '|' ||
      coalesce((tanggal - date '1970-01-01')::text, '') || '|' ||
      lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(debit, 0)::text || '|' ||
      coalesce(kredit, 0)::text || '|' ||
      lower(coalesce(referensi, '')) || '|' ||
      kembar_ke::text
    )
  ) stored;
create unique index if not exists idx_transaksi_sidik on transaksi_bank (sidik);
--
alter table unggahan_rekening_koran
  add column if not exists no_rekening text,
  add column if not exists periode_bulan int,
  add column if not exists periode_tahun int,
  add column if not exists jumlah_baru int not null default 0,
  add column if not exists jumlah_sudah_ada int not null default 0,
  add column if not exists status text not null default 'selesai';
do $fn$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'status_unggahan_dikenali'
      and conrelid = 'unggahan_rekening_koran'::regclass
  ) then
    alter table unggahan_rekening_koran
      add constraint status_unggahan_dikenali
      check (status in ('selesai', 'sebagian', 'duplikat', 'gagal'));
  end if;
end
$fn$;
create index if not exists idx_unggahan_periode
  on unggahan_rekening_koran (periode_tahun, periode_bulan);
--
create or replace function periode_tersimpan()
returns table (tahun int, bulan int, jumlah bigint, debit numeric, kredit numeric)
language sql
stable
set search_path = public
as $fn$
  select t.tahun, t.bulan, count(*),
         coalesce(sum(t.debit), 0), coalesce(sum(t.kredit), 0)
  from transaksi_bank t
  where t.tanggal is not null
  group by t.tahun, t.bulan
  order by t.tahun desc, t.bulan desc;
$fn$;
--
drop function if exists periksa_transaksi_ganda();
create or replace function periksa_transaksi_ganda()
returns table (
  tanggal date, keterangan text, debit numeric, kredit numeric,
  jumlah_salinan bigint, jumlah_unggahan bigint
)
language sql
stable
set search_path = public
as $fn$
  select
    t.tanggal,
    max(t.keterangan),
    max(t.debit),
    max(t.kredit),
    count(*),
    count(distinct t.unggahan_id)
  from transaksi_bank t
  group by
    coalesce(t.no_rekening, ''),
    t.tanggal,
    lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')),
    coalesce(t.debit, 0),
    coalesce(t.kredit, 0),
    lower(coalesce(t.referensi, ''))
  having count(distinct t.unggahan_id) > 1
  order by t.tanggal desc;
$fn$;
--
--
--
--
--
--
--
drop view if exists pembayaran_semua;
drop view if exists transaksi_bank_unik;
create view transaksi_bank_unik
with (security_invoker = true) as
with sidikkan as (
  select
    t.*,
    md5(
      coalesce((t.tanggal - date '1970-01-01')::text, '')                 || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g'))  || '|' ||
      coalesce(t.debit,  0)::text                                         || '|' ||
      coalesce(t.kredit, 0)::text                                         || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik_tampil
  from transaksi_bank t
),
bernomor as (
  select s.*,
         row_number() over (partition by s.unggahan_id, s.sidik_tampil
                            order by s.dibuat_pada, s.id) as kembar_berkas
  from sidikkan s
)
select distinct on (b.sidik_tampil, b.kembar_berkas)
  b.id, b.unggahan_id, b.baris_sumber, b.berkas_sumber,
  b.tanggal, b.tanggal_ambigu, b.keterangan,
  b.debit, b.kredit, b.saldo, b.referensi,
  b.status_data, b.masalah, b.duplikat,
  b.status_rekon, b.referensi_rekon, b.catatan_rekon,
  b.nominal_pembanding, b.selisih, b.direkon_pada, b.direkon_oleh,
  b.dibuat_pada, b.bulan, b.tahun
from bernomor b
left join kecocokan k on k.transaksi_id = b.id
order by
  b.sidik_tampil, b.kembar_berkas,
  coalesce(k.dikonfirmasi, false) desc,
  (k.id is not null) desc,
  (b.status_rekon <> 'belum') desc,
  b.dibuat_pada, b.id;
--
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
  from transaksi_bank_unik t
  where (p_cari is null or p_cari = ''
         or t.keterangan ilike '%' || p_cari || '%'
         or coalesce(t.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan  is null or t.bulan = p_bulan)
    and (p_tahun  is null or t.tahun = p_tahun)
    and (p_dari   is null or t.tanggal >= p_dari)
    and (p_sampai is null or t.tanggal <= p_sampai);
$fn$;
grant select on transaksi_bank_unik to service_role;
--
--
create table if not exists pembayaran_manual (
  id            uuid primary key default gen_random_uuid(),
  tanggal       date not null,
  penerima      text not null check (length(trim(penerima)) > 0),
  nominal       numeric(14, 2) not null check (nominal > 0),
  sumber        text not null check (sumber in (
                  'MEKARI_PAY', 'BCA', 'BANK_LAIN', 'KAS', 'LAINNYA')),
  no_referensi  text,
  memo          text,
  bukti_url     text,
  bulan int generated always as (extract(month from tanggal)) stored,
  tahun int generated always as (extract(year  from tanggal)) stored,
  dibuat_pada   timestamptz not null default now(),
  dibuat_oleh   text not null check (length(trim(dibuat_oleh)) > 0),
  diubah_pada   timestamptz,
  diubah_oleh   text
);
create index if not exists idx_bayar_manual_tanggal  on pembayaran_manual (tanggal desc);
create index if not exists idx_bayar_manual_periode  on pembayaran_manual (tahun, bulan);
create index if not exists idx_bayar_manual_penerima on pembayaran_manual (lower(penerima));
--
--
create table if not exists pembayaran_manual_riwayat (
  id             uuid primary key default gen_random_uuid(),
  pembayaran_id  uuid not null,
  aksi           text not null check (aksi in ('BUAT', 'UBAH', 'HAPUS')),
  data_lama      jsonb,
  data_baru      jsonb,
  oleh           text,
  pada           timestamptz not null default now()
);
create index if not exists idx_riwayat_bayar on pembayaran_manual_riwayat (pembayaran_id, pada desc);
create or replace function catat_riwayat_pembayaran()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_pelaku text := nullif(current_setting('app.pelaku', true), '');
begin
  if tg_op = 'INSERT' then
    insert into pembayaran_manual_riwayat (pembayaran_id, aksi, data_baru, oleh)
    values (new.id, 'BUAT', to_jsonb(new), coalesce(v_pelaku, new.dibuat_oleh));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into pembayaran_manual_riwayat (pembayaran_id, aksi, data_lama, data_baru, oleh)
    values (new.id, 'UBAH', to_jsonb(old), to_jsonb(new),
            coalesce(v_pelaku, new.diubah_oleh, new.dibuat_oleh));
    return new;
  else
    insert into pembayaran_manual_riwayat (pembayaran_id, aksi, data_lama, oleh)
    values (old.id, 'HAPUS', to_jsonb(old), coalesce(v_pelaku, old.diubah_oleh, old.dibuat_oleh));
    return old;
  end if;
end;
$fn$;
drop trigger if exists trg_riwayat_pembayaran on pembayaran_manual;
create trigger trg_riwayat_pembayaran
  after insert or update or delete on pembayaran_manual
  for each row execute function catat_riwayat_pembayaran();
create or replace function hapus_pembayaran_manual(p_id uuid, p_oleh text)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_jumlah int;
begin
  perform set_config('app.pelaku', coalesce(nullif(trim(p_oleh), ''), 'tidak diketahui'), true);
  delete from pembayaran_manual where id = p_id;
  get diagnostics v_jumlah = row_count;
  return v_jumlah;
end;
$fn$;
--
--
--
drop view if exists pembayaran_semua;
create view pembayaran_semua
with (security_invoker = true) as
select
  'bank'::text                as asal,
  'BCA'::text                 as sumber,
  t.id, t.unggahan_id, t.baris_sumber, t.berkas_sumber,
  t.tanggal, t.tanggal_ambigu, t.keterangan,
  t.debit, t.kredit, t.saldo, t.referensi,
  t.status_data, t.masalah, t.duplikat,
  t.status_rekon, t.referensi_rekon, t.catatan_rekon,
  t.nominal_pembanding, t.selisih, t.direkon_pada, t.direkon_oleh,
  t.dibuat_pada, t.bulan, t.tahun,
  null::text                  as memo,
  null::text                  as bukti_url,
  null::text                  as dibuat_oleh
from transaksi_bank_unik t
union all
select
  'manual'::text,
  case m.sumber
    when 'MEKARI_PAY' then 'MEKARI PAY'
    when 'BANK_LAIN'  then 'BANK LAIN'
    when 'BCA'        then 'BCA (MANUAL)'
    else m.sumber
  end,
  m.id, null::uuid, null::int, null::text,
  m.tanggal, false,
  m.penerima || coalesce(' - ' || nullif(trim(m.memo), ''), ''),
  m.nominal, 0::numeric(14,2), null::numeric(14,2), m.no_referensi,
  'valid'::text, '{}'::text[], false,
  'belum'::text, null::text, null::text,
  null::numeric(14,2), null::numeric(14,2), null::timestamptz, null::text,
  m.dibuat_pada, m.bulan, m.tahun,
  m.memo, m.bukti_url, m.dibuat_oleh
from pembayaran_manual m;
--
--
create or replace function ringkasan_pembayaran(
  p_cari   text default null,
  p_bulan  int  default null,
  p_tahun  int  default null,
  p_dari   date default null,
  p_sampai date default null,
  p_hanya_debit boolean default false
)
returns table (kelompok text, jumlah bigint, debit numeric, kredit numeric)
language sql
stable
set search_path = public
as $fn$
  select
    case
      when p.asal = 'bank'          then 'BCA'
      when p.sumber = 'MEKARI PAY'  then 'MEKARI PAY'
      else 'MANUAL LAINNYA'
    end,
    count(*),
    coalesce(sum(p.debit), 0),
    coalesce(sum(p.kredit), 0)
  from pembayaran_semua p
  where (p_cari is null or p_cari = ''
         or p.keterangan ilike '%' || p_cari || '%'
         or coalesce(p.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan  is null or p.bulan = p_bulan)
    and (p_tahun  is null or p.tahun = p_tahun)
    and (p_dari   is null or p.tanggal >= p_dari)
    and (p_sampai is null or p.tanggal <= p_sampai)
    and (not p_hanya_debit or p.debit > 0)
  group by 1;
$fn$;
alter table pembayaran_manual          enable row level security;
alter table pembayaran_manual_riwayat  enable row level security;
grant select on pembayaran_semua to service_role;
--
--
--
alter table transaksi_bank          add column if not exists entitas text;
alter table unggahan_rekening_koran add column if not exists entitas text;
alter table pembayaran_manual       add column if not exists entitas text;
alter table tagihan_pemasok         add column if not exists entitas text;
update transaksi_bank          set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
update unggahan_rekening_koran set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
update pembayaran_manual       set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
update tagihan_pemasok         set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
alter table transaksi_bank          alter column entitas set not null;
alter table unggahan_rekening_koran alter column entitas set not null;
alter table pembayaran_manual       alter column entitas set not null;
alter table tagihan_pemasok         alter column entitas set not null;
do $pagar$
begin
  if not exists (select 1 from pg_constraint where conname = 'transaksi_bank_entitas_sah') then
    alter table transaksi_bank add constraint transaksi_bank_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unggahan_entitas_sah') then
    alter table unggahan_rekening_koran add constraint unggahan_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pembayaran_entitas_sah') then
    alter table pembayaran_manual add constraint pembayaran_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tagihan_entitas_sah') then
    alter table tagihan_pemasok add constraint tagihan_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
end
$pagar$;
alter table tagihan_pemasok drop constraint if exists tagihan_pemasok_pemasok_id_no_invoice_key;
create unique index if not exists idx_tagihan_entitas_invoice
  on tagihan_pemasok (entitas, pemasok_id, no_invoice);
--
--
--
drop view if exists pembayaran_semua;
drop view if exists transaksi_bank_unik;
alter table transaksi_bank drop column if exists sidik;
alter table transaksi_bank
  add column sidik text generated always as (
    md5(
      entitas || '|' ||
      coalesce(no_rekening, '') || '|' ||
      coalesce((tanggal - date '1970-01-01')::text, '') || '|' ||
      lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(debit, 0)::text || '|' ||
      coalesce(kredit, 0)::text || '|' ||
      lower(coalesce(referensi, '')) || '|' ||
      kembar_ke::text
    )
  ) stored;
create unique index if not exists idx_transaksi_sidik on transaksi_bank (sidik);
create index if not exists idx_transaksi_entitas on transaksi_bank (entitas);
--
--
create view transaksi_bank_unik
with (security_invoker = true) as
with sidikkan as (
  select
    t.*,
    md5(
      t.entitas                                                           || '|' ||
      coalesce((t.tanggal - date '1970-01-01')::text, '')                 || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g'))  || '|' ||
      coalesce(t.debit,  0)::text                                         || '|' ||
      coalesce(t.kredit, 0)::text                                         || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik_tampil
  from transaksi_bank t
),
bernomor as (
  select s.*,
         row_number() over (partition by s.unggahan_id, s.sidik_tampil
                            order by s.dibuat_pada, s.id) as kembar_berkas
  from sidikkan s
)
select distinct on (b.sidik_tampil, b.kembar_berkas)
  b.id, b.unggahan_id, b.baris_sumber, b.berkas_sumber,
  b.tanggal, b.tanggal_ambigu, b.keterangan,
  b.debit, b.kredit, b.saldo, b.referensi,
  b.status_data, b.masalah, b.duplikat,
  b.status_rekon, b.referensi_rekon, b.catatan_rekon,
  b.nominal_pembanding, b.selisih, b.direkon_pada, b.direkon_oleh,
  b.dibuat_pada, b.bulan, b.tahun, b.entitas
from bernomor b
left join kecocokan k on k.transaksi_id = b.id
order by
  b.sidik_tampil, b.kembar_berkas,
  coalesce(k.dikonfirmasi, false) desc,
  (k.id is not null) desc,
  (b.status_rekon <> 'belum') desc,
  b.dibuat_pada, b.id;
create view pembayaran_semua
with (security_invoker = true) as
select
  'bank'::text                as asal,
  'BCA'::text                 as sumber,
  t.id, t.unggahan_id, t.baris_sumber, t.berkas_sumber,
  t.tanggal, t.tanggal_ambigu, t.keterangan,
  t.debit, t.kredit, t.saldo, t.referensi,
  t.status_data, t.masalah, t.duplikat,
  t.status_rekon, t.referensi_rekon, t.catatan_rekon,
  t.nominal_pembanding, t.selisih, t.direkon_pada, t.direkon_oleh,
  t.dibuat_pada, t.bulan, t.tahun,
  null::text                  as memo,
  null::text                  as bukti_url,
  null::text                  as dibuat_oleh,
  t.entitas
from transaksi_bank_unik t
union all
select
  'manual'::text,
  case m.sumber
    when 'MEKARI_PAY' then 'MEKARI PAY'
    when 'BANK_LAIN'  then 'BANK LAIN'
    when 'BCA'        then 'BCA (MANUAL)'
    else m.sumber
  end,
  m.id, null::uuid, null::int, null::text,
  m.tanggal, false,
  m.penerima || coalesce(' - ' || nullif(trim(m.memo), ''), ''),
  m.nominal, 0::numeric(14,2), null::numeric(14,2), m.no_referensi,
  'valid'::text, '{}'::text[], false,
  'belum'::text, null::text, null::text,
  null::numeric(14,2), null::numeric(14,2), null::timestamptz, null::text,
  m.dibuat_pada, m.bulan, m.tahun,
  m.memo, m.bukti_url, m.dibuat_oleh,
  m.entitas
from pembayaran_manual m;
grant select on transaksi_bank_unik to service_role;
grant select on pembayaran_semua    to service_role;
--
--
drop function if exists ringkasan_transaksi_bank(text, int, int, date, date);
create or replace function ringkasan_transaksi_bank(
  p_cari    text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_dari    date default null,
  p_sampai  date default null,
  p_entitas text default null
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
  from transaksi_bank_unik t
  where (p_cari is null or p_cari = ''
         or t.keterangan ilike '%' || p_cari || '%'
         or coalesce(t.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan   is null or t.bulan = p_bulan)
    and (p_tahun   is null or t.tahun = p_tahun)
    and (p_dari    is null or t.tanggal >= p_dari)
    and (p_sampai  is null or t.tanggal <= p_sampai)
    and (p_entitas is null or t.entitas = p_entitas);
$fn$;
drop function if exists ringkasan_pembayaran(text, int, int, date, date, boolean);
create or replace function ringkasan_pembayaran(
  p_cari       text    default null,
  p_bulan      int     default null,
  p_tahun      int     default null,
  p_dari       date    default null,
  p_sampai     date    default null,
  p_hanya_debit boolean default false,
  p_entitas    text    default null
)
returns table (sumber text, jumlah bigint, debit numeric, kredit numeric, net numeric)
language sql
stable
set search_path = public
as $fn$
  select
    case
      when p.asal = 'bank'        then 'BCA'
      when p.sumber = 'MEKARI PAY' then 'MEKARI PAY'
      else 'MANUAL LAINNYA'
    end as sumber,
    count(*),
    coalesce(sum(p.debit), 0),
    coalesce(sum(p.kredit), 0),
    coalesce(sum(p.kredit), 0) - coalesce(sum(p.debit), 0)
  from pembayaran_semua p
  where (p_cari is null or p_cari = ''
         or p.keterangan ilike '%' || p_cari || '%'
         or coalesce(p.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan   is null or p.bulan = p_bulan)
    and (p_tahun   is null or p.tahun = p_tahun)
    and (p_dari    is null or p.tanggal >= p_dari)
    and (p_sampai  is null or p.tanggal <= p_sampai)
    and (p_entitas is null or p.entitas = p_entitas)
    and (not p_hanya_debit or p.debit > 0)
  group by 1
  order by 1;
$fn$;
drop function if exists periode_tersimpan();
create or replace function periode_tersimpan(p_entitas text default null)
returns table (tahun int, bulan int, jumlah bigint, debit numeric, kredit numeric)
language sql
stable
set search_path = public
as $fn$
  select t.tahun, t.bulan, count(*),
         coalesce(sum(t.debit), 0), coalesce(sum(t.kredit), 0)
  from transaksi_bank t
  where t.tanggal is not null
    and (p_entitas is null or t.entitas = p_entitas)
  group by t.tahun, t.bulan
  order by t.tahun desc, t.bulan desc;
$fn$;
--
drop function if exists periksa_transaksi_ganda();
create or replace function periksa_transaksi_ganda()
returns table (
  entitas text, tanggal date, keterangan text, debit numeric, kredit numeric,
  jumlah_salinan bigint, jumlah_unggahan bigint
)
language sql
stable
set search_path = public
as $fn$
  select
    t.entitas,
    t.tanggal,
    max(t.keterangan),
    max(t.debit),
    max(t.kredit),
    count(*),
    count(distinct t.unggahan_id)
  from transaksi_bank t
  group by
    t.entitas,
    coalesce(t.no_rekening, ''),
    t.tanggal,
    lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')),
    coalesce(t.debit, 0),
    coalesce(t.kredit, 0),
    lower(coalesce(t.referensi, ''))
  having count(distinct t.unggahan_id) > 1
  order by t.tanggal desc;
$fn$;
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
  k.catatan,
  t.entitas
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
  k.selisih, k.status, k.keyakinan, k.alasan, k.dikonfirmasi, k.catatan,
  b.entitas
from kecocokan k
join transaksi_bank b on b.id = k.transaksi_id
where k.tagihan_id is null;
grant select on audit_pembayaran_pemasok to service_role;
drop function if exists ringkasan_audit_pemasok(text, int, int, text, date, date);
create or replace function ringkasan_audit_pemasok(
  p_pemasok text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_status  text default null,
  p_dari    date default null,
  p_sampai  date default null,
  p_entitas text default null
)
returns table (
  total_tagihan bigint,
  total_gross numeric,
  total_pph numeric,
  total_transfer numeric,
  total_selisih numeric,
  jumlah_menyimpang bigint
)
language sql
stable
set search_path = public
as $fn$
  select
    count(*),
    coalesce(sum(a.gross), 0),
    coalesce(sum(a.pph), 0),
    coalesce(sum(a.transfer_bank), 0),
    coalesce(sum(a.selisih), 0),
    count(*) filter (where a.status <> 'MATCH')
  from audit_pembayaran_pemasok a
  where (p_pemasok is null or p_pemasok = '' or a.pemasok ilike '%' || p_pemasok || '%')
    and (p_bulan   is null or a.bulan = p_bulan)
    and (p_tahun   is null or a.tahun = p_tahun)
    and (p_status  is null or p_status = '' or a.status = p_status)
    and (p_dari    is null or a.tanggal_invoice >= p_dari)
    and (p_sampai  is null or a.tanggal_invoice <= p_sampai)
    and (p_entitas is null or a.entitas = p_entitas);
$fn$;
--
--
create table if not exists mekari_impor (
  id             uuid primary key default gen_random_uuid(),
  nama_berkas    text not null,
  hash_berkas    text not null,
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
--
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
  jumlah         numeric(16, 2) not null default 0,
  masalah        text[] not null default '{}',
  kembar_ke      int not null default 1,
  bulan int generated always as (extract(month from tanggal)) stored,
  tahun int generated always as (extract(year  from tanggal)) stored,
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
--
--
create table if not exists mekari_pengenal (
  id        uuid primary key default gen_random_uuid(),
  baris_id  uuid not null references mekari_baris(id) on delete cascade,
  entitas   text not null check (entitas in (
              'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),
  nilai     text not null,
  konteks   text not null default ''
);
create index if not exists idx_mekari_pengenal_baris   on mekari_pengenal (baris_id);
create index if not exists idx_mekari_pengenal_entitas on mekari_pengenal (entitas);
create index if not exists idx_mekari_pengenal_nilai on mekari_pengenal (nilai);
--
create table if not exists mekari_temuan (
  id             uuid primary key default gen_random_uuid(),
  entitas        text not null check (entitas in (
                   'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),
  kunci_stabil   text not null,
  baris_a        uuid not null references mekari_baris(id) on delete cascade,
  baris_b        uuid not null references mekari_baris(id) on delete cascade,
  skor           int not null default 0,
  alasan         jsonb not null default '[]'::jsonb,
  ringkasan_alasan text,
  nilai_berisiko numeric(16, 2) not null default 0,
  dihitung_pada  timestamptz not null default now()
);
create unique index if not exists idx_mekari_temuan_kunci   on mekari_temuan (kunci_stabil);
create index if not exists idx_mekari_temuan_entitas        on mekari_temuan (entitas);
create index if not exists idx_mekari_temuan_skor           on mekari_temuan (skor desc);
--
--
--
create table if not exists mekari_periksa (
  kunci_stabil   text primary key,
  entitas        text not null check (entitas in (
                   'PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA')),
  status         text not null default 'BELUM' check (status in (
                   'BELUM', 'WAJAR', 'PERLU_TINDAK_LANJUT', 'TERKONFIRMASI_DUPLIKAT')),
  catatan        text,
  diperiksa_oleh text,
  diperiksa_pada timestamptz not null default now()
);
create index if not exists idx_mekari_periksa_status on mekari_periksa (entitas, status);
--
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
--
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
as $fn$
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
    (select coalesce(sum(t.nilai_berisiko), 0) from mekari_temuan_periksa t
      where (p_entitas is null or t.entitas = p_entitas) and t.status <> 'WAJAR'),
    (select count(*)                       from mekari_temuan_periksa t
      where (p_entitas is null or t.entitas = p_entitas) and t.status = 'BELUM')
$fn$;
--
alter table mekari_impor    enable row level security;
alter table mekari_baris    enable row level security;
alter table mekari_pengenal enable row level security;
alter table mekari_temuan   enable row level security;
alter table mekari_periksa  enable row level security;

-- Setelah skema berubah, PostgREST masih memakai peta lama sampai diberi
-- tahu. Tanpa ini tabel baru tetap dilaporkan "not found in the schema
-- cache" walaupun sudah ada.
perform pg_notify('pgrst', 'reload schema');

raise notice 'Setup Alyssa selesai. Tabel audit supplier siap dipakai.';
end
$migrasi$;

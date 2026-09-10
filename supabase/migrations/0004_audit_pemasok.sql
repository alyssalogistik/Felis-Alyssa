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
    and (p_status is null or p_status = '' or a.status = p_status)
    and (p_dari   is null or a.tanggal_invoice >= p_dari)
    and (p_sampai is null or a.tanggal_invoice <= p_sampai);
$$;

-- ---------------------------------------------------------------------------
-- Keamanan: sama seperti tabel lain, tanpa policy.
-- ---------------------------------------------------------------------------

alter table pemasok        enable row level security;
alter table tagihan_pemasok enable row level security;
alter table kecocokan      enable row level security;

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

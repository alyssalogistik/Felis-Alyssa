-- Integrasi Audit Rekon -> Supplier di alyssa-dev.
--
-- Mengalirkan transaksi rekening koran yang sudah diikat ke satu supplier
-- supaya alyssa-dev bisa menariknya dan mencatatnya sebagai pembayaran.
--
-- ## Hanya menambah
--
-- Tidak ada ALTER, UPDATE, maupun DELETE terhadap tabel yang sudah ada.
-- transaksi_bank, unggahan_rekening_koran, pemasok, tagihan_pemasok,
-- kecocokan, dan pembayaran_manual tidak tersentuh sama sekali.
--
-- ## Nama supplier tidak pernah menjadi identitas
--
-- Nama di rekening koran adalah hasil tebakan dari teks bank: diukur pada
-- 453 transaksi keluar sungguhan, nama yang dihasilkan 138 dan 18 di antaranya
-- menggabungkan beberapa ejaan. Yang mengikat selalu supplier_id dari
-- alyssa-dev, diputuskan manusia, disimpan per transaksi fisik.

-- ---------------------------------------------------------------------------
-- Pemetaan supplier: INGATAN, bukan kebenaran
--
-- Gunanya satu: kedua kali keterangan yang serupa muncul, sistem bisa
-- mengusulkan supplier yang sama seperti kemarin. Ia tidak pernah mengikat
-- transaksi dengan sendirinya.
-- ---------------------------------------------------------------------------

create table if not exists pemetaan_supplier (
  id             uuid primary key default gen_random_uuid(),

  -- Disalin dari alyssa-dev. SENGAJA tanpa kunci asing: masternya ada di
  -- sistem lain, dan memvalidasi keberadaannya lintas sistem berarti satu
  -- sistem yang mati ikut mematikan yang lain.
  --
  -- Bertipe text, bukan uuid: bentuk id di alyssa-dev belum tentu uuid, dan
  -- menebaknya akan menolak id yang sah.
  supplier_id    text not null check (length(trim(supplier_id)) > 0),

  -- Potret nama saat dipetakan. Untuk dibaca mata; tidak pernah dibandingkan.
  supplier_nama  text not null check (length(trim(supplier_nama)) > 0),

  entitas        text not null,

  -- Kunci saran: nama yang sudah diseragamkan, ditambah kode bank tujuan bila
  -- bank mencetaknya. Contoh: 'MARTHEN RUNTURAMBI|002', 'HERMANSYAH|'.
  --
  -- TIDAK unique, dan itu disengaja: dua supplier bernama sama memang harus
  -- bisa hidup berdampingan. Yang menanganinya view konflik di bawah.
  kunci_saran    text not null check (length(trim(kunci_saran)) > 0),

  -- Dari master alyssa-dev, diketik manusia. TIDAK PERNAH dari rekening koran:
  -- BCA tidak mencetak nomor rekening tujuan pada transfer keluar sama sekali.
  no_rekening_tujuan text,

  status         text not null default 'aktif'
                   check (status in ('aktif', 'nonaktif')),

  dibuat_pada    timestamptz not null default now(),
  dibuat_oleh    text not null,
  diubah_pada    timestamptz,
  diubah_oleh    text
);

create index if not exists idx_pemetaan_kunci    on pemetaan_supplier (entitas, kunci_saran);
create index if not exists idx_pemetaan_supplier on pemetaan_supplier (supplier_id);

-- ---------------------------------------------------------------------------
-- Konflik DIHITUNG, bukan disimpan
--
-- Menyimpannya sebagai status akan basi: menghapus salah satu dari dua
-- pemetaan yang bertabrakan meninggalkan yang tersisa bertanda konflik
-- selamanya, dan tanda yang salah di sini berarti pekerjaan terhenti tanpa
-- sebab yang terlihat. Dihitung saat dibaca, jawabannya selalu benar.
-- ---------------------------------------------------------------------------

drop view if exists pemetaan_supplier_status;

create view pemetaan_supplier_status
with (security_invoker = true) as
select
  p.*,
  (
    select count(distinct p2.supplier_id)
    from pemetaan_supplier p2
    where p2.entitas = p.entitas
      and p2.kunci_saran = p.kunci_saran
      and p2.status = 'aktif'
  ) > 1 as konflik
from pemetaan_supplier p;

-- ---------------------------------------------------------------------------
-- Tautan pembayaran: satu transaksi fisik, satu supplier, SATU KALI
--
-- transaksi_id adalah PRIMARY KEY. Bukan sekadar unique, bukan pemeriksaan di
-- aplikasi: satu transaksi_bank.id secara struktural tidak mungkin punya dua
-- baris di sini, dari jalur mana pun baris itu ditulis.
--
-- ## Kenapa TANPA kunci asing ke transaksi_bank
--
-- Menghapus satu unggahan rekening koran sudah cascade ke transaksi_bank.
-- Dengan ON DELETE CASCADE, baris tautannya ikut terhapus dan penjaga
-- anti-dobel hilang bersamanya: transaksi yang uangnya sudah dikirim ke
-- alyssa-dev bisa dikirim lagi. Dengan ON DELETE RESTRICT, penghapusan
-- unggahan yang sudah berjalan bertahun-tahun mendadak gagal.
--
-- Tanpa kunci asing, catatan "uang ini sudah dikirim" selamat dari
-- penghapusan apa pun. Pola yang sama sudah dipakai dua kali di skema ini:
-- jejak_aktivitas tanpa kunci asing ke profil_pengguna, dan
-- pembayaran_manual_riwayat tanpa kunci asing ke pembayaran_manual.
-- ---------------------------------------------------------------------------

create table if not exists tautan_pembayaran (
  transaksi_id   uuid primary key,

  supplier_id    text not null check (length(trim(supplier_id)) > 0),
  supplier_nama  text not null check (length(trim(supplier_nama)) > 0),
  entitas        text not null,

  -- Potret nilai transaksi saat diikat. Kalau baris sumbernya kelak hilang
  -- atau berubah, payload yang sudah terkirim tetap bisa dipertanggungjawabkan
  -- dari sini.
  tanggal        date not null,
  nominal        numeric(14, 2) not null check (nominal > 0),
  sidik          text not null,

  status         text not null default 'siap'
                   check (status in ('siap', 'ditarik', 'dibatalkan', 'perlu_koreksi_hilir')),

  ditautkan_pada timestamptz not null default now(),
  ditautkan_oleh text not null,

  batch_tarik    uuid,
  ditarik_pada   timestamptz,

  dibatalkan_pada timestamptz,
  dibatalkan_oleh text,
  alasan          text
);

create index if not exists idx_tautan_status   on tautan_pembayaran (status, entitas);
create index if not exists idx_tautan_batch    on tautan_pembayaran (batch_tarik);
create index if not exists idx_tautan_supplier on tautan_pembayaran (supplier_id);

-- ---------------------------------------------------------------------------
-- Riwayat tautan: hanya bisa ditambah
--
-- Tanpa kunci asing, dengan alasan yang sama seperti jejak_aktivitas: catatan
-- tidak boleh ikut hilang bersama objek yang dicatatnya. Di sini taruhannya
-- lebih tinggi lagi, karena yang hilang bukan catatan melainkan bukti bahwa
-- uangnya sudah pernah dikirim.
-- ---------------------------------------------------------------------------

create table if not exists tautan_pembayaran_riwayat (
  id               uuid primary key default gen_random_uuid(),
  transaksi_id     uuid not null,
  aksi             text not null,
  supplier_id_lama text,
  supplier_id_baru text,
  status_lama      text,
  status_baru      text,
  alasan           text,
  oleh             text not null,
  pada             timestamptz not null default now()
);

create index if not exists idx_tautan_riwayat_transaksi on tautan_pembayaran_riwayat (transaksi_id, pada desc);

create or replace function tautan_riwayat_hanya_tambah()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'tautan_pembayaran_riwayat hanya bisa ditambah, tidak bisa diubah atau dihapus';
end
$$;

drop trigger if exists trg_tautan_riwayat_hanya_tambah on tautan_pembayaran_riwayat;
create trigger trg_tautan_riwayat_hanya_tambah
  before update or delete on tautan_pembayaran_riwayat
  for each row execute function tautan_riwayat_hanya_tambah();

-- ---------------------------------------------------------------------------
-- Penghapusan transaksi tidak boleh menghapus bukti pengiriman
--
-- Dipasang di database, bukan di hapus.js, karena penghapusan bisa datang
-- dari SQL Editor dan dari skrip sekali pakai juga. Aturan yang hanya hidup
-- di satu jalur kode akan terlewat oleh jalur berikutnya.
--
-- Yang BELUM ditarik cukup dibatalkan: tidak ada pihak lain yang sudah tahu,
-- jadi menolak penghapusannya hanya akan menghalangi pembersihan unggahan
-- yang memang keliru.
-- ---------------------------------------------------------------------------

create or replace function lindungi_tautan_tertarik()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  st text;
begin
  select t.status into st from tautan_pembayaran t where t.transaksi_id = old.id;

  if st is null then
    return old;
  end if;

  if st in ('ditarik', 'perlu_koreksi_hilir') then
    raise exception
      'Transaksi % sudah ditarik alyssa-dev dan tidak bisa dihapus. Batalkan dulu pencatatannya di sana.',
      old.id;
  end if;

  update tautan_pembayaran
     set status = 'dibatalkan',
         dibatalkan_pada = now(),
         dibatalkan_oleh = 'sistem',
         alasan = 'Baris transaksi bank dihapus.'
   where transaksi_id = old.id
     and status = 'siap';

  insert into tautan_pembayaran_riwayat (transaksi_id, aksi, status_lama, status_baru, alasan, oleh)
  values (old.id, 'BATAL', st, 'dibatalkan', 'Baris transaksi bank dihapus.', 'sistem');

  return old;
end
$$;

drop trigger if exists trg_lindungi_tautan_tertarik on transaksi_bank;
create trigger trg_lindungi_tautan_tertarik
  before delete on transaksi_bank
  for each row execute function lindungi_tautan_tertarik();

-- ---------------------------------------------------------------------------
-- Sidik tampilan, dipaparkan sebagai view
--
-- Rumusnya sama persis dengan yang dipakai transaksi_bank_unik untuk melipat
-- salinan. Dipaparkan di sini supaya aplikasi bisa memeriksa "apakah salinan
-- lain dari transaksi ini sudah pernah ditautkan" tanpa menyalin rumusnya ke
-- JavaScript — salinan rumus yang menyimpang akan melewatkan kembar yang
-- seharusnya tertahan, dan kekeliruannya berarti satu transfer dikirim dua
-- kali dengan dua id yang berbeda.
-- ---------------------------------------------------------------------------

drop view if exists transaksi_bank_kembar;

create view transaksi_bank_kembar
with (security_invoker = true) as
select
  t.id,
  t.entitas,
  md5(
    t.entitas                                                           || '|' ||
    coalesce((t.tanggal - date '1970-01-01')::text, '')                 || '|' ||
    lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g'))  || '|' ||
    coalesce(t.debit,  0)::text                                         || '|' ||
    coalesce(t.kredit, 0)::text                                         || '|' ||
    lower(coalesce(t.referensi, ''))
  ) as sidik_tampil
from transaksi_bank t;

-- ---------------------------------------------------------------------------
-- Keamanan
--
-- Sama seperti seluruh tabel lain: RLS menyala tanpa policy apa pun, sehingga
-- kunci anon tidak bisa membaca maupun menulis. Seluruh akses lewat API server
-- yang memegang service_role.
-- ---------------------------------------------------------------------------

alter table pemetaan_supplier          enable row level security;
alter table tautan_pembayaran          enable row level security;
alter table tautan_pembayaran_riwayat  enable row level security;

select pg_notify('pgrst', 'reload schema');

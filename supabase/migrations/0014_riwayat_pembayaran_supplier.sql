-- Riwayat pembayaran per supplier, dipisah per entitas.
--
-- Satu supplier bisa dibayar lewat BEBERAPA transfer dengan nama penerima yang
-- berbeda-beda. Contoh sungguhan: pekerjaan 15 unit atas supplier
-- MARTHEN RUTURAMBE dibayar sebagian ke MARTHEN dan sebagian ke JAFAR TALI.
-- Keduanya pembayaran yang sah untuk supplier administrasi yang sama.
--
-- ## Yang mengelompokkan adalah supplier_id, TIDAK PERNAH nama
--
-- Nama penerima di rekening koran adalah informasi audit transaksi bank, bukan
-- identitas supplier. JAFAR TALI tidak pernah menjadi supplier hanya karena
-- namanya muncul di keterangan; manusia yang memutuskan transfer itu milik
-- supplier mana, dan keputusan itu tersimpan sebagai supplier_id.
--
-- ## Hanya menambah
--
-- Tidak ada ALTER, UPDATE, DELETE, DROP, maupun TRUNCATE terhadap apa pun yang
-- sudah ada. transaksi_bank, tautan_pembayaran, kecocokan, tagihan_pemasok,
-- pemasok, pembayaran_manual, dan seluruh modul Mekari tidak tersentuh.

-- ---------------------------------------------------------------------------
-- Kewajiban supplier: OPSIONAL, dan boleh kosong
--
-- Nilainya ditetapkan manusia per (supplier_id, entitas). Sengaja tidak
-- diturunkan dari tagihan_pemasok maupun dari PO: administrasi PO belum
-- tertib, dan angka yang diturunkan dari sumber yang belum rapi akan
-- menampilkan "sisa" yang salah tanpa satu pun galat.
--
-- Tanpa baris di sini, sisa pembayaran dilaporkan TIDAK DIKETAHUI — bukan nol.
-- Nol berarti "sudah lunas", dan itu kesimpulan yang tidak boleh ditebak.
-- ---------------------------------------------------------------------------

create table if not exists kewajiban_supplier (
  supplier_id     text not null check (length(trim(supplier_id)) > 0),
  entitas         text not null,

  nilai           numeric(14, 2) not null check (nilai >= 0),
  catatan         text,

  ditetapkan_pada timestamptz not null default now(),
  ditetapkan_oleh text not null,

  -- Dipisah per entitas: PT dan CV membayar supplier yang sama dari rekening
  -- yang berbeda, dan mencampurnya membuat kewajiban satu perusahaan tampak
  -- terbayar oleh uang perusahaan lain.
  primary key (supplier_id, entitas)
);

-- ---------------------------------------------------------------------------
-- Alokasi manual: catatan pekerjaan/proyek, selama PO belum tertib
--
-- Teks bebas, bukan kunci asing ke objek apa pun. Ia keterangan audit, bukan
-- penggerak angka: tidak satu pun total dihitung darinya.
--
-- Tabel terpisah, bukan kolom tambahan di tautan_pembayaran, supaya tabel
-- yang sudah berjalan tidak perlu di-ALTER sama sekali.
-- ---------------------------------------------------------------------------

create table if not exists alokasi_pembayaran (
  transaksi_id uuid primary key,

  keterangan   text not null check (length(trim(keterangan)) > 0),

  dicatat_pada timestamptz not null default now(),
  dicatat_oleh text not null
);

-- ---------------------------------------------------------------------------
-- Riwayat per supplier per entitas
--
-- Pengelompokannya (supplier_id, entitas). Nama hanya ikut sebagai potret
-- untuk dibaca, dan jumlah ejaannya ikut dilaporkan: lebih dari satu ejaan
-- untuk satu supplier_id berarti ada salah ketik yang perlu dilihat mata.
-- Totalnya tetap benar karena dikelompokkan dari id, bukan dari nama — tetapi
-- salah ketik yang tidak pernah dilaporkan tidak akan pernah diperbaiki.
--
-- Baris 'dibatalkan' tidak ikut dijumlahkan; tautannya memang sudah dicabut.
-- ---------------------------------------------------------------------------

drop view if exists riwayat_pembayaran_supplier;

create view riwayat_pembayaran_supplier
with (security_invoker = true) as
with bayar as (
  select
    t.supplier_id,
    t.entitas,
    (array_agg(t.supplier_nama order by t.ditautkan_pada desc, t.transaksi_id))[1] as supplier_nama,
    count(distinct t.supplier_nama)              as jumlah_ejaan_nama,
    count(*)                                     as jumlah_pembayaran,
    sum(t.nominal)                               as total_dibayar,
    min(t.tanggal)                               as pembayaran_pertama,
    max(t.tanggal)                               as pembayaran_terakhir,
    count(*) filter (where t.status = 'siap')    as menunggu_tarik,
    count(*) filter (where t.status = 'ditarik') as sudah_ditarik,
    count(*) filter (where t.status = 'perlu_koreksi_hilir') as menunggu_koreksi
  from tautan_pembayaran t
  where t.status <> 'dibatalkan'
  group by t.supplier_id, t.entitas
)
select
  b.supplier_id,
  b.entitas,
  b.supplier_nama,
  b.jumlah_ejaan_nama,
  b.jumlah_pembayaran,
  b.total_dibayar,
  b.pembayaran_pertama,
  b.pembayaran_terakhir,
  b.menunggu_tarik,
  b.sudah_ditarik,
  b.menunggu_koreksi,

  k.nilai                                        as kewajiban,
  k.catatan                                      as kewajiban_catatan,
  -- NULL bila kewajibannya belum ditetapkan. Bukan nol: nol berarti lunas.
  case when k.nilai is null then null else k.nilai - b.total_dibayar end as sisa
from bayar b
left join kewajiban_supplier k
       on k.supplier_id = b.supplier_id and k.entitas = b.entitas;

-- ---------------------------------------------------------------------------
-- Keamanan: sama seperti seluruh tabel lain, RLS menyala tanpa policy apa pun.
-- ---------------------------------------------------------------------------

alter table kewajiban_supplier  enable row level security;
alter table alokasi_pembayaran  enable row level security;

select pg_notify('pgrst', 'reload schema');

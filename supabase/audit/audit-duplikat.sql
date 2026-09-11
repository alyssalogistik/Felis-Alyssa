-- ============================================================================
--  AUDIT DUPLIKAT TRANSAKSI BANK — HANYA MEMBACA
-- ============================================================================
--
--  Tidak ada insert, update, delete, alter, maupun drop di berkas ini. Seluruh
--  isinya satu perintah SELECT; menjalankannya tidak mengubah satu baris pun.
--
--  Sengaja SATU perintah, bukan rangkaian. SQL Editor Supabase hanya
--  menampilkan hasil perintah terakhir, sehingga laporan yang dipecah menjadi
--  beberapa SELECT akan kehilangan sebagian besar isinya di layar. Yang ini
--  mengembalikan seluruh laporan sebagai satu tabel bersambung.
--
--  Aturan yang dipakai sama dengan penjaga duplikat di aplikasi: yang
--  dibandingkan isi transaksinya, bukan nama atau hash berkasnya. Dua baris
--  dianggap satu transaksi yang sama bila tanggal, keterangan (setelah huruf
--  dan spasinya diseragamkan), debit, kredit, dan referensi (tanpa membedakan
--  huruf besar-kecil) semuanya sama.
--
--  Nomor kembar dihitung PER UNGGAHAN. Dua penarikan bernominal sama pada hari
--  yang sama di dalam satu berkas adalah transaksi sungguhan yang berbeda, dan
--  tidak dilaporkan sebagai duplikat. Yang dilaporkan hanya salinan yang datang
--  dari unggahan BERBEDA.
-- ============================================================================

with dasar as (
  select
    t.id, t.unggahan_id, t.tanggal, t.bulan, t.tahun,
    t.keterangan, t.debit, t.kredit, t.referensi, t.dibuat_pada,
    md5(
      lower(coalesce(to_jsonb(t) ->> 'no_rekening', ''))             || '|' ||
      coalesce((t.tanggal - date '1970-01-01')::text, '')            || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(t.debit,  0)::text                                    || '|' ||
      coalesce(t.kredit, 0)::text                                    || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik
  from transaksi_bank t
),

-- Nomor urut di antara baris kembar DI DALAM satu unggahan.
bernomor as (
  select d.*,
         row_number() over (partition by d.unggahan_id, d.sidik
                            order by d.dibuat_pada, d.id) as kembar_ke
  from dasar d
),

-- Satu transaksi nyata = satu (sidik, kembar_ke). Bila pasangan itu muncul di
-- lebih dari satu unggahan, selisihnya adalah salinan berlebih.
kunci as (
  select sidik, kembar_ke,
         count(*)                     as salinan,
         count(distinct unggahan_id)  as unggahan,
         min(tanggal)                 as tanggal,
         min(tahun)                   as tahun,
         min(bulan)                   as bulan,
         min(keterangan)              as keterangan,
         max(debit)                   as debit,
         max(kredit)                  as kredit
  from bernomor
  group by sidik, kembar_ke
),

ganda as (
  select * from kunci where salinan > 1 and unggahan > 1
),

angka as (
  select
    (select count(*)                      from dasar)   as total,
    (select coalesce(sum(salinan - 1), 0) from ganda)   as duplikat,
    (select count(*)                      from ganda)   as transaksi_terdampak,
    (select count(*) from unggahan_rekening_koran)      as unggahan
),

-- Rupiah diformat dengan titik secara eksplisit. to_char memakai pemisah
-- bawaan locale server, yang di Supabase belum tentu id-ID.
rupiah as (
  select 0 as x
),

laporan as (

  ---------------------------------------------------------------- 1. RINGKASAN
  select 1 as bab, 0 as urut, '1. RINGKASAN' as bagian,
         'Total transaksi di database' as rincian,
         a.total::text as nilai
  from angka a
  union all
  select 1, 1, '1. RINGKASAN', 'Transaksi unik (bila duplikat dihapus)',
         (a.total - a.duplikat)::text from angka a
  union all
  select 1, 2, '1. RINGKASAN', 'DUPLICATE ROWS (salinan berlebih, yang akan dihapus)',
         a.duplikat::text from angka a
  union all
  select 1, 3, '1. RINGKASAN', 'DUPLICATE GROUPS (transaksi yang punya salinan)',
         a.transaksi_terdampak::text from angka a
  union all
  select 1, 4, '1. RINGKASAN', 'Persentase duplikat',
         case when a.total = 0 then '0%'
              else round(a.duplikat * 100.0 / a.total, 2)::text || '%' end
  from angka a
  union all
  select 1, 5, '1. RINGKASAN', 'Nilai DEBIT pada salinan berlebih',
         'Rp ' || replace(to_char(coalesce(
           (select sum((salinan - 1) * debit) from ganda), 0),
           'FM999,999,999,999'), ',', '.')
  from angka a
  union all
  select 1, 6, '1. RINGKASAN', 'Nilai KREDIT pada salinan berlebih',
         'Rp ' || replace(to_char(coalesce(
           (select sum((salinan - 1) * kredit) from ganda), 0),
           'FM999,999,999,999'), ',', '.')
  from angka a
  union all
  select 1, 7, '1. RINGKASAN', 'Jumlah berkas rekening koran yang tercatat',
         a.unggahan::text from angka a

  ------------------------------------------------------- 2. DUPLIKAT PER BULAN
  union all
  select 2, row_number() over (order by g.tahun, g.bulan),
         '2. DUPLIKAT PER BULAN',
         coalesce(g.tahun::text || '-' || lpad(g.bulan::text, 2, '0'),
                  '(tanpa tanggal)'),
         sum(g.salinan - 1)::text || ' salinan berlebih  ·  Rp ' ||
         replace(to_char(sum((g.salinan - 1) * g.debit),
                 'FM999,999,999,999'), ',', '.') || ' debit'
  from ganda g
  group by g.tahun, g.bulan

  ------------------------------------------------------------- 3. CONTOH BARIS
  union all
  select 3, row_number() over (order by g.salinan desc, g.debit desc, g.tanggal),
         '3. CONTOH DUPLIKAT',
         coalesce(to_char(g.tanggal, 'DD/MM/YYYY'), '(tanpa tanggal)') || '  ' ||
         left(regexp_replace(g.keterangan, '\s+', ' ', 'g'), 60),
         g.salinan::text || 'x di ' || g.unggahan::text || ' berkas  ·  ' ||
         case when g.debit > 0
              then 'DB Rp ' || replace(to_char(g.debit, 'FM999,999,999,999'), ',', '.')
              else 'CR Rp ' || replace(to_char(g.kredit, 'FM999,999,999,999'), ',', '.')
         end
  from ganda g

  ---------------------------------------------------- 4. BERKAS YANG TERLIBAT
  --
  -- Kolom PERIODE pada riwayat impor kosong untuk unggahan lama karena periode
  -- baru mulai dicatat oleh migration 0006, saat berkasnya sudah lama diurai
  -- dan PDF-nya tidak disimpan. Tetapi periode itu masih bisa DITURUNKAN dari
  -- tanggal transaksinya sendiri, dan itulah yang ditampilkan di sini.
  union all
  select 4, row_number() over (order by u.diunggah_pada),
         '4. RIWAYAT UNGGAHAN',
         to_char(u.diunggah_pada, 'DD/MM/YYYY HH24:MI') || '  ' ||
         left(u.nama_berkas, 45),
         coalesce((select
                     case when min(d.tanggal) is null then 'periode tidak diketahui'
                          when to_char(min(d.tanggal), 'YYYY-MM')
                               = to_char(max(d.tanggal), 'YYYY-MM')
                          then 'periode ' || to_char(min(d.tanggal), 'YYYY-MM')
                          else 'periode ' || to_char(min(d.tanggal), 'YYYY-MM')
                               || '..' || to_char(max(d.tanggal), 'YYYY-MM')
                     end
                   from dasar d where d.unggahan_id = u.id),
                  'periode tidak diketahui') || '  ·  ' ||
         (select count(*) from dasar d where d.unggahan_id = u.id)::text ||
         ' baris  ·  ' ||
         (select count(*) from bernomor b
           where b.unggahan_id = u.id
             and exists (select 1 from ganda g
                          where g.sidik = b.sidik and g.kembar_ke = b.kembar_ke)
         )::text || ' punya salinan di berkas lain'
  from unggahan_rekening_koran u

  ------------------------------------------- 5. BERKAS DENGAN ISI PERSIS SAMA
  union all
  select 5, row_number() over (order by min(u.diunggah_pada)),
         '5. BERKAS HASH SAMA (diunggah ulang)',
         left(min(u.nama_berkas), 45) || '  (' || count(*)::text || 'x)',
         string_agg(to_char(u.diunggah_pada, 'DD/MM/YYYY HH24:MI'), '  |  '
                    order by u.diunggah_pada)
  from unggahan_rekening_koran u
  group by u.hash_berkas
  having count(*) > 1
)

select bagian, rincian, nilai
from laporan
order by bab, urut;

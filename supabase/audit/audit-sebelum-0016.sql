-- ============================================================================
--  AUDIT SEBELUM MIGRATION 0016 — HANYA MEMBACA
-- ============================================================================
--
--  Tidak ada insert, update, delete, alter, maupun drop di berkas ini.
--  Seluruh isinya SATU perintah SELECT; menjalankannya tidak mengubah satu
--  baris pun di database.
--
--  Sengaja satu perintah, bukan rangkaian. SQL Editor Supabase hanya
--  menampilkan hasil perintah TERAKHIR, sehingga laporan yang dipecah menjadi
--  beberapa SELECT akan kehilangan sebagian besar isinya di layar.
--
--  Kolom STATUS hanya pernah berisi dua hal:
--    OK       — tidak ada yang perlu dikerjakan
--    PERIKSA  — perlu mata manusia SEBELUM 0016 dijalankan
--
--  Tidak ada yang diperbaiki otomatis. Temuan dilaporkan, keputusannya Anda.
-- ============================================================================

with
jumlah as (
  select
    (select count(*) from transaksi_bank)            as trx,
    (select count(*) from tautan_pembayaran)         as tautan,
    (select count(*) from alokasi_pembayaran)        as alokasi,
    (select count(*) from tautan_pembayaran_riwayat) as riwayat
),
-- Kunci pelipatan tampilan: nomor rekening sengaja TIDAK ikut, sama seperti
-- view transaksi_bank_unik. Baris lama belum menyimpannya sedangkan unggahan
-- baru menyimpannya, sehingga transaksi yang sama dari dua masa justru akan
-- tampak berbeda kalau kolom itu diikutkan.
lipat as (
  select
    tanggal,
    upper(regexp_replace(coalesce(keterangan,''), '\s+', ' ', 'g')) as ket,
    debit, kredit, coalesce(referensi,'') as ref,
    count(*)                      as baris,
    count(distinct unggahan_id)   as berkas
  from transaksi_bank
  group by 1,2,3,4,5
  having count(*) > 1
)
select * from (

  select 1 as urut, 'A. JUMLAH BARIS' as bagian,
         'transaksi_bank' as hal,
         trx::text as nilai,
         case when trx = 9017 then 'OK' else 'PERIKSA' end as status,
         case when trx = 9017 then 'cocok dengan acuan 9.017'
              else 'acuan 9.017, selisih ' || (trx - 9017)::text end as keterangan
    from jumlah

  union all select 2, 'A. JUMLAH BARIS', 'tautan_pembayaran', tautan::text, 'OK',
         'catat angka ini untuk dicocokkan dengan CSV' from jumlah
  union all select 3, 'A. JUMLAH BARIS', 'alokasi_pembayaran', alokasi::text, 'OK',
         'catat angka ini untuk dicocokkan dengan CSV' from jumlah
  union all select 4, 'A. JUMLAH BARIS', 'tautan_pembayaran_riwayat', riwayat::text, 'OK',
         'catat angka ini untuk dicocokkan dengan CSV' from jumlah

  -- ---------------------------------------------------------------- PRA-0016
  union all select 10, 'B. PRA-0016', 'nama constraint status',
         coalesce((select conname from pg_constraint
                    where conrelid='tautan_pembayaran'::regclass and contype='c'
                      and pg_get_constraintdef(oid) like '%status%'), '(TIDAK ADA)'),
         case when (select count(*) from pg_constraint
                     where conrelid='tautan_pembayaran'::regclass and contype='c'
                       and pg_get_constraintdef(oid) like '%status%') = 1
               and exists (select 1 from pg_constraint
                            where conname='tautan_pembayaran_status_check'
                              and conrelid='tautan_pembayaran'::regclass)
              then 'OK' else 'PERIKSA' end,
         '0016 melepas constraint ini lewat namanya. Nama lain = 0016 gagal diam-diam'

  union all select 11, 'B. PRA-0016', '0016 sudah terpasang?',
         case when (select pg_get_constraintdef(oid) from pg_constraint
                     where conname='tautan_pembayaran_status_check'
                       and conrelid='tautan_pembayaran'::regclass) like '%menunggu_lepas%'
              then 'SUDAH' else 'BELUM' end,
         'OK', 'BELUM = normal. SUDAH = tidak perlu dijalankan lagi'

  union all select 12, 'B. PRA-0016', 'prasyarat 0015 (supplier_id canonical)',
         case when exists (select 1 from pg_constraint where conname='tautan_supplier_id_canonical')
              then 'ADA' else 'TIDAK ADA' end,
         case when exists (select 1 from pg_constraint where conname='tautan_supplier_id_canonical')
              then 'OK' else 'PERIKSA' end,
         'harus ADA sebelum 0016'

  union all select 13, 'B. PRA-0016', 'baris berstatus menunggu_lepas',
         (select count(*)::text from tautan_pembayaran where status='menunggu_lepas'),
         case when (select count(*) from tautan_pembayaran where status='menunggu_lepas')=0
              then 'OK' else 'PERIKSA' end,
         'harus 0 — status itu belum boleh ada sebelum 0016'

  union all select 14, 'B. PRA-0016', 'sebaran status tautan',
         coalesce((select string_agg(status||'='||j, ', ' order by status)
                     from (select status, count(*) j from tautan_pembayaran group by status) x),
                  '(tidak ada tautan)'),
         'OK', 'potret sebelum 0016 — tidak boleh berubah sesudahnya'

  -- ------------------------------------------------------------- DUPLIKASI
  union all select 20, 'C. DUPLIKASI', 'transaksi kembar LINTAS unggahan',
         coalesce((select count(*)::text from lipat where berkas > 1), '0'),
         case when coalesce((select count(*) from lipat where berkas > 1),0)=0
              then 'OK' else 'PERIKSA' end,
         'rekening koran yang sama pernah diunggah dua kali. Dilipat di layar, '
         'datanya tetap utuh. Pakai supabase/audit/audit-duplikat.sql untuk rinciannya'

  union all select 21, 'C. DUPLIKASI', 'transaksi kembar DALAM satu unggahan',
         coalesce((select count(*)::text from lipat where berkas = 1), '0'),
         'OK',
         'LAZIM dan BUKAN masalah — BCA memang mencetak dua transfer serupa di hari yang sama'

  union all select 22, 'C. DUPLIKASI', 'nilai uang pada kembar lintas unggahan',
         coalesce((select to_char(sum(debit * (baris-1)), 'FM999G999G999G990')
                     from lipat where berkas > 1), '0'),
         'OK', 'perkiraan nilai yang akan terhitung ganda bila tidak dilipat'

  -- ---------------------------------------------------------------- RELASI
  union all select 30, 'D. RELASI', 'tautan menunjuk transaksi yang tidak ada',
         (select count(*)::text from tautan_pembayaran t
           where not exists (select 1 from transaksi_bank b where b.id = t.transaksi_id)),
         case when (select count(*) from tautan_pembayaran t
                     where not exists (select 1 from transaksi_bank b where b.id=t.transaksi_id))=0
              then 'OK' else 'PERIKSA' end,
         'tautan_pembayaran sengaja tanpa kunci asing, jadi yatim mungkin terjadi'

  union all select 31, 'D. RELASI', 'alokasi menunjuk transaksi yang tidak ada',
         (select count(*)::text from alokasi_pembayaran a
           where not exists (select 1 from transaksi_bank b where b.id = a.transaksi_id)),
         case when (select count(*) from alokasi_pembayaran a
                     where not exists (select 1 from transaksi_bank b where b.id=a.transaksi_id))=0
              then 'OK' else 'PERIKSA' end,
         'catatan PO yang transaksinya hilang'

  union all select 32, 'D. RELASI', 'riwayat menunjuk tautan yang tidak ada',
         (select count(*)::text from tautan_pembayaran_riwayat r
           where not exists (select 1 from tautan_pembayaran t where t.transaksi_id = r.transaksi_id)),
         'OK',
         'WAJAR — riwayat sengaja selamat walau tautannya hilang, itu gunanya jejak audit'

  -- ------------------------------------------------------- INTEGRITAS UANG
  union all select 40, 'E. INTEGRITAS UANG', 'nominal tautan beda dari debit bank',
         (select count(*)::text from tautan_pembayaran t
            join transaksi_bank b on b.id = t.transaksi_id
           where t.nominal is distinct from b.debit),
         case when (select count(*) from tautan_pembayaran t
                      join transaksi_bank b on b.id=t.transaksi_id
                     where t.nominal is distinct from b.debit)=0
              then 'OK' else 'PERIKSA' end,
         'harus 0 — nominal tautan disalin dari debit transaksinya'

  union all select 41, 'E. INTEGRITAS UANG', 'tanggal tautan beda dari tanggal bank',
         (select count(*)::text from tautan_pembayaran t
            join transaksi_bank b on b.id = t.transaksi_id
           where t.tanggal is distinct from b.tanggal),
         case when (select count(*) from tautan_pembayaran t
                      join transaksi_bank b on b.id=t.transaksi_id
                     where t.tanggal is distinct from b.tanggal)=0
              then 'OK' else 'PERIKSA' end,
         'beda tanggal berarti tautan menunjuk transaksi yang keliru'

  union all select 42, 'E. INTEGRITAS UANG', 'entitas tautan beda dari entitas bank',
         (select count(*)::text from tautan_pembayaran t
            join transaksi_bank b on b.id = t.transaksi_id
           where t.entitas is distinct from b.entitas),
         case when (select count(*) from tautan_pembayaran t
                      join transaksi_bank b on b.id=t.transaksi_id
                     where t.entitas is distinct from b.entitas)=0
              then 'OK' else 'PERIKSA' end,
         'PT dan CV tidak boleh tertukar'

  union all select 43, 'E. INTEGRITAS UANG', 'supplier_id tidak canonical',
         (select count(*)::text from tautan_pembayaran where supplier_id !~ '^[0-9a-f]{8}$'),
         case when (select count(*) from tautan_pembayaran where supplier_id !~ '^[0-9a-f]{8}$')=0
              then 'OK' else 'PERIKSA' end,
         'harus 0 — dijaga CHECK sejak 0015'

  union all select 44, 'E. INTEGRITAS UANG', 'satu transaksi dua tautan',
         (select count(*)::text from (
            select transaksi_id from tautan_pembayaran group by transaksi_id having count(*)>1) d),
         'OK',
         'selalu 0 — transaksi_id adalah PRIMARY KEY, tidak mungkin ganda'

) laporan order by urut;

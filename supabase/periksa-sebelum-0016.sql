-- PEMERIKSAAN SEBELUM MENJALANKAN 0016. HANYA MEMBACA.
--
-- Tidak satu baris pun diubah. Jalankan di SQL Editor Supabase, baca hasilnya,
-- baru putuskan. Kalau ada satu saja yang bertanda PERIKSA, jangan lanjutkan.

select
  '1. PROJECT REF' as pemeriksaan,
  current_database()  as nilai,
  coalesce(current_setting('request.jwt.claim.iss', true), '(tidak terbaca)') as keterangan,
  'Cocokkan ref di alamat browser dengan SUPABASE_PROJECT_REF di Railway' as tindakan

union all select
  '2. NAMA CONSTRAINT STATUS',
  coalesce((select conname from pg_constraint
            where conrelid = 'tautan_pembayaran'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%status%'), '(TIDAK ADA)'),
  (select count(*)::text || ' CHECK menyebut status'
     from pg_constraint
    where conrelid = 'tautan_pembayaran'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%status%'),
  case when (select count(*) from pg_constraint
              where conrelid = 'tautan_pembayaran'::regclass and contype='c'
                and pg_get_constraintdef(oid) like '%status%') = 1
        and exists (select 1 from pg_constraint
                     where conname = 'tautan_pembayaran_status_check'
                       and conrelid = 'tautan_pembayaran'::regclass)
       then 'AMAN — 0016 akan melepas dan memasang ulang constraint ini'
       else 'PERIKSA — nama atau jumlahnya tidak seperti yang diharapkan' end

union all select
  '3. 0016 SUDAH TERPASANG?',
  case when (select pg_get_constraintdef(oid) from pg_constraint
              where conname='tautan_pembayaran_status_check'
                and conrelid='tautan_pembayaran'::regclass) like '%menunggu_lepas%'
       then 'SUDAH' else 'BELUM' end,
  '', 'Kalau SUDAH, 0016 tidak perlu dijalankan lagi (tetap aman kalau diulang)'

union all select
  '4. PRASYARAT 0015',
  case when exists (select 1 from pg_constraint where conname='tautan_supplier_id_canonical')
       then 'ADA' else 'TIDAK ADA' end,
  '', 'Harus ADA. Kalau tidak, jalankan setup-lengkap.sql lebih dulu'

union all select
  '5. BARIS menunggu_lepas',
  (select count(*)::text from tautan_pembayaran where status = 'menunggu_lepas'),
  '', 'Harus 0 sebelum 0016 — statusnya memang belum boleh ada'

union all select
  '6. JUMLAH BARIS (catat untuk dibandingkan sesudahnya)',
  (select count(*)::text from tautan_pembayaran),
  (select count(*)::text || ' transaksi_bank, '
        || (select count(*) from alokasi_pembayaran)::text || ' alokasi'
     from transaksi_bank),
  'Angka-angka ini TIDAK BOLEH berubah setelah 0016'

union all select
  '7. SEBARAN STATUS SEKARANG',
  (select string_agg(status || '=' || jml, ', ' order by status)
     from (select status, count(*) jml from tautan_pembayaran group by status) x),
  '', 'Juga tidak boleh berubah setelah 0016';

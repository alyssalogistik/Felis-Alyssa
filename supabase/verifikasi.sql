-- Verifikasi hasil migration. Jalankan di Supabase SQL Editor SETELAH 0001-0003.
--
-- Hanya membaca katalog sistem: tidak menyisipkan, mengubah, maupun menghapus
-- apa pun. Aman dijalankan berulang kali pada project yang sudah berisi data.
--
-- Semua baris harus berbunyi OK. Satu saja BELUM berarti ada migration yang
-- belum jalan atau jalan sebagian.

with periksa as (
  select 'Tabel inti (8)' as bagian,
         count(*) = 8 as lolos,
         count(*) || ' dari 8' as rincian
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
    and c.relname in ('kapal', 'driver', 'trip', 'pesanan', 'tracking_event',
                      'invoice', 'unggahan_rekening_koran', 'transaksi_bank')

  union all
  -- Diperiksa per nama, bukan lewat jumlah total, supaya penambahan kolom di
  -- kemudian hari tidak membuat verifikasi ini berbunyi gagal tanpa sebab.
  select 'Kolom wajib transaksi_bank',
         count(*) = 12,
         count(*) || ' dari 12'
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaksi_bank'
    and column_name in ('tanggal', 'keterangan', 'debit', 'kredit', 'saldo',
                        'referensi', 'status_data', 'status_rekon',
                        'nominal_pembanding', 'selisih', 'direkon_pada', 'direkon_oleh')

  union all
  -- Kolom turunan ini yang membuat filter bulan/tahun bisa memakai indeks.
  select 'Kolom turunan bulan & tahun',
         count(*) = 2,
         string_agg(column_name, ', ' order by column_name)
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaksi_bank'
    and column_name in ('bulan', 'tahun')
    and is_generated = 'ALWAYS'

  union all
  select 'Kolom tanggal bertipe date (bukan timestamptz)',
         data_type = 'date',
         data_type
  from information_schema.columns
  where table_schema = 'public' and table_name = 'transaksi_bank' and column_name = 'tanggal'

  union all
  -- Inti jaminan Fase 6: status rekon tidak bisa berbohong soal nominal.
  select 'Trigger perbandingan nominal',
         count(*) = 1,
         coalesce(string_agg(tgname, ', '), 'tidak ada')
  from pg_trigger
  where tgrelid = 'public.transaksi_bank'::regclass and tgname = 'trg_transaksi_status_rekon'

  union all
  select 'Trigger nomor resi & jejak status pesanan',
         count(*) = 3,
         count(*) || ' dari 3'
  from pg_trigger
  where tgrelid = 'public.pesanan'::regclass and not tgisinternal

  union all
  select 'Fungsi ringkasan_transaksi_bank',
         count(*) = 1,
         count(*) || ' fungsi'
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'ringkasan_transaksi_bank'

  union all
  select 'Ekstensi pg_trgm (pencarian terindeks)',
         count(*) = 1,
         coalesce(string_agg(extname, ', '), 'belum dipasang')
  from pg_extension where extname = 'pg_trgm'

  union all
  select 'Indeks transaksi_bank (5)',
         count(*) >= 5,
         count(*) || ' indeks'
  from pg_indexes
  where schemaname = 'public' and tablename = 'transaksi_bank'

  union all
  -- RLS menyala tanpa policy: kunci anon tidak bisa menyentuh data sama sekali.
  select 'RLS menyala di semua tabel',
         count(*) filter (where not c.relrowsecurity) = 0,
         count(*) filter (where c.relrowsecurity) || ' dari ' || count(*)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'

  union all
  select 'Tidak ada policy (akses hanya lewat API server)',
         count(*) = 0,
         count(*) || ' policy'
  from pg_policies where schemaname = 'public'
)
select
  case when lolos then 'OK' else 'BELUM' end as status,
  bagian,
  rincian
from periksa
order by lolos, bagian;

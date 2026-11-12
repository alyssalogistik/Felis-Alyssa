-- ============================================================================
--  KEMBAR LINTAS UNGGAHAN vs TAUTAN PEMBAYARAN — HANYA MEMBACA
-- ============================================================================
--
--  Satu SELECT. Tidak mengubah apa pun.
--
--  Melengkapi audit-sebelum-0016.sql, dengan dua perbaikan:
--
--  1. Memakai view transaksi_bank_kembar, bukan salinan rumusnya. View itulah
--     yang dipakai aplikasi menolak pengikatan salinan, dan rumusnya
--     menyertakan ENTITAS. Audit pertama mengelompokkan tanpa entitas, sehingga
--     transfer PT dan CV yang kebetulan serupa ikut terhitung kembar.
--
--  2. Memeriksa yang paling mahal bila meleset: transaksi kembar yang KEDUA
--     SALINANNYA tertaut ke supplier. Itu satu transfer bank yang tercatat dua
--     kali sebagai pembayaran di alyssa-dev.
--
--  Kolom status hanya OK atau PERIKSA. Tidak ada yang diperbaiki otomatis.
-- ============================================================================

with kelompok as (
  select
    k.sidik_tampil,
    k.entitas,
    count(*)                                              as salinan,
    count(distinct b.unggahan_id)                         as berkas,
    count(t.transaksi_id)                                 as tertaut,
    max(b.debit)                                          as debit
  from transaksi_bank_kembar k
  join transaksi_bank b on b.id = k.id
  left join tautan_pembayaran t
         on t.transaksi_id = k.id and t.status <> 'dibatalkan'
  group by k.sidik_tampil, k.entitas
  having count(distinct b.unggahan_id) > 1
)
select * from (

  select 1 as urut, 'kelompok kembar lintas unggahan, PT' as hal,
         count(*)::text as nilai,
         'OK' as status,
         'rekening koran yang sama pernah diunggah dua kali sebelum penjaga duplikat ada' as keterangan
    from kelompok where entitas = 'PT_ALYSSA_AUTO_LOGISTIK'

  union all select 2, 'kelompok kembar lintas unggahan, CV',
         count(*)::text, 'OK', 'CV hanya histori'
    from kelompok where entitas = 'CV_ALYSSA_TRANS_UTAMA'

  union all select 3, 'salinan berlebih (di luar satu yang sah)',
         coalesce(sum(salinan - 1), 0)::text, 'OK',
         'baris fisik yang menggandakan transaksi lain. Dilipat di layar, tidak dihapus'
    from kelompok

  union all select 4, 'nilai uang pada salinan berlebih (Rp)',
         coalesce(to_char(sum(debit * (salinan - 1)), 'FM999G999G999G990'), '0'), 'OK',
         'yang akan terhitung ganda bila layar tidak melipat'
    from kelompok

  union all select 5, 'kelompok yang SEBAGIAN salinannya tertaut',
         count(*)::text, 'OK',
         'satu salinan tertaut, kembarnya belum. Aplikasi menolak mengikat kembarnya'
    from kelompok where tertaut = 1

  union all select 6, 'kelompok yang LEBIH DARI SATU salinannya tertaut',
         count(*)::text,
         case when count(*) = 0 then 'OK' else 'PERIKSA' end,
         'harus 0. Lebih dari 0 = satu transfer bank tercatat dua kali di alyssa-dev'
    from kelompok where tertaut > 1

  union all select 7, 'nilai uang pada kelompok yang tertaut ganda (Rp)',
         coalesce(to_char(sum(debit * (tertaut - 1)), 'FM999G999G999G990'), '0'),
         case when count(*) = 0 then 'OK' else 'PERIKSA' end,
         'jumlah yang kemungkinan terhitung dua kali sebagai pembayaran supplier'
    from kelompok where tertaut > 1

) laporan order by urut;

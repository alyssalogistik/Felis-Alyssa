-- ============================================================================
--  RENCANA CLEANUP — HANYA MEMBACA, TIDAK MENGHAPUS APA PUN
-- ============================================================================
--
--  Menunjukkan apa yang AKAN terjadi bila duplikat dibersihkan: baris mana
--  yang dipertahankan, baris mana yang dihapus, alasannya, berapa yang hilang,
--  dan berapa yang tersisa.
--
--  Satu perintah SELECT. Tidak ada delete di berkas ini.
--
--  Aturan memilih yang dipertahankan, berurutan:
--    1. baris yang hasil auditnya SUDAH DIKONFIRMASI manusia
--    2. baris yang punya hasil pencocokan otomatis
--    3. baris yang sudah direkonsiliasi
--    4. baris dari berkas yang paling dulu diunggah
--
--  Urutan itu bukan selera. kecocokan.transaksi_id memakai ON DELETE CASCADE,
--  sehingga menghapus baris yang salah ikut menghapus keputusan manusia tanpa
--  peringatan apa pun.
-- ============================================================================

with dasar as (
  select
    t.id, t.unggahan_id, t.tanggal, t.bulan, t.tahun, t.keterangan,
    t.debit, t.kredit, t.referensi, t.dibuat_pada, t.status_rekon,
    md5(
      lower(coalesce(to_jsonb(t) ->> 'no_rekening', ''))                || '|' ||
      coalesce((t.tanggal - date '1970-01-01')::text, '')               || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(t.debit,  0)::text                                       || '|' ||
      coalesce(t.kredit, 0)::text                                       || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik
  from transaksi_bank t
),

bernomor as (
  select d.*, u.nama_berkas, u.diunggah_pada,
         row_number() over (partition by d.unggahan_id, d.sidik
                            order by d.dibuat_pada, d.id) as kembar_ke
  from dasar d
  join unggahan_rekening_koran u on u.id = d.unggahan_id
),

berperingkat as (
  select b.*,
         c.id is not null                as ada_kecocokan,
         coalesce(c.dikonfirmasi, false) as dikonfirmasi,
         count(*) over (partition by b.sidik, b.kembar_ke) as salinan,
         row_number() over (
           partition by b.sidik, b.kembar_ke
           order by coalesce(c.dikonfirmasi, false) desc,
                    (c.id is not null) desc,
                    (b.status_rekon <> 'belum') desc,
                    b.diunggah_pada, b.dibuat_pada, b.id
         ) as peringkat
  from bernomor b
  left join kecocokan c on c.transaksi_id = b.id
),

-- Hanya salinan dari unggahan BERBEDA. Dua penarikan bernominal sama pada hari
-- yang sama di dalam satu berkas adalah transaksi sungguhan dan tidak disentuh.
akan_dihapus as (
  select * from berperingkat where peringkat > 1 and salinan > 1
),
akan_disimpan as (
  select * from berperingkat where peringkat = 1 and salinan > 1
),

angka as (
  select
    (select count(*) from berperingkat)  as sekarang,
    (select count(*) from akan_dihapus)  as dihapus,
    (select count(*) from akan_disimpan) as grup,
    (select count(*) from akan_dihapus a
      where exists (select 1 from kecocokan k where k.transaksi_id = a.id)) as kecocokan_ikut,
    (select count(*) from akan_dihapus a
      where exists (select 1 from kecocokan k
                     where k.transaksi_id = a.id and k.dikonfirmasi)) as konfirmasi_ikut
),

laporan as (

  select 1 as bab, 0 as urut, '1. RENCANA' as bagian,
         'Total row sekarang' as rincian, a.sekarang::text as nilai from angka a
  union all
  select 1, 1, '1. RENCANA', 'DUPLICATE GROUPS', a.grup::text from angka a
  union all
  select 1, 2, '1. RENCANA', 'Row yang AKAN DIHAPUS', a.dihapus::text from angka a
  union all
  select 1, 3, '1. RENCANA', 'Row yang TERSISA sesudahnya',
         (a.sekarang - a.dihapus)::text from angka a
  union all
  select 1, 4, '1. RENCANA', 'Nilai DEBIT yang hilang dari total (kelebihan hitung)',
         'Rp ' || replace(to_char(coalesce((select sum(debit) from akan_dihapus), 0),
                 'FM999,999,999,999'), ',', '.') from angka a
  union all
  select 1, 5, '1. RENCANA', 'Transaksi unik TIDAK ADA yang disentuh',
         (select count(*) from berperingkat where salinan = 1)::text ||
         ' row aman' from angka a

  union all
  select 2, 0, '2. DAMPAK IKUTAN (ON DELETE CASCADE)',
         'Hasil audit yang ikut terhapus', a.kecocokan_ikut::text || ' baris kecocokan'
  from angka a
  union all
  select 2, 1, '2. DAMPAK IKUTAN (ON DELETE CASCADE)',
         'Di antaranya SUDAH DIKONFIRMASI manusia',
         case when a.konfirmasi_ikut = 0 then '0 — aman'
              else a.konfirmasi_ikut::text || ' — PERIKSA DULU' end
  from angka a

  union all
  select 3, row_number() over (order by d.tahun, d.bulan),
         '3. PERIODE TERDAMPAK',
         coalesce(d.tahun::text || '-' || lpad(d.bulan::text, 2, '0'), '(tanpa tanggal)'),
         count(*)::text || ' row dihapus  ·  Rp ' ||
         replace(to_char(sum(d.debit), 'FM999,999,999,999'), ',', '.') || ' debit'
  from akan_dihapus d group by d.tahun, d.bulan

  union all
  select 4, row_number() over (order by min(d.diunggah_pada)),
         '4. BERKAS ASAL SALINAN',
         to_char(min(d.diunggah_pada), 'DD/MM/YYYY HH24:MI') || '  ' ||
         left(min(d.nama_berkas), 40),
         count(*)::text || ' row dihapus dari berkas ini'
  from akan_dihapus d group by d.unggahan_id

  union all
  select 5, row_number() over (order by s.salinan desc, s.debit desc, s.tanggal),
         '5. CONTOH GRUP',
         coalesce(to_char(s.tanggal, 'DD/MM/YYYY'), '(tanpa tanggal)') || '  ' ||
         left(regexp_replace(s.keterangan, '\s+', ' ', 'g'), 50),
         'simpan 1 dari ' || s.salinan::text || ' (' || s.salinan::text ||
         ' berkas)  ·  hapus ' || (s.salinan - 1)::text || '  ·  sidik ' ||
         left(s.sidik, 10) ||
         case when s.dikonfirmasi then '  ·  yang disimpan sudah dikonfirmasi'
              else '' end
  from akan_disimpan s
)

select bagian, rincian, nilai from laporan order by bab, urut;

-- ============================================================================
--  MEMBEDAH SATU TRANSAKSI — HANYA MEMBACA
-- ============================================================================
--
--  Menjawab "kenapa transaksi ini tersimpan berkali-kali" dengan menunjukkan
--  setiap baris fisiknya beserta asal-usulnya: berkas mana, diunggah kapan,
--  dan baris ke berapa di berkas itu.
--
--  Satu perintah SELECT. Tidak mengubah apa pun.
--
--  UBAH KATA KUNCI DI BARIS DI BAWAH INI, lalu Run.
-- ============================================================================

with kata as (
  select 'KUSRIN YONOGI'::text as cari        -- <<< GANTI DI SINI
),

dasar as (
  select
    t.id, t.unggahan_id, t.tanggal, t.keterangan, t.debit, t.kredit,
    t.referensi, t.baris_sumber, t.dibuat_pada, t.status_rekon,
    md5(
      lower(coalesce(to_jsonb(t) ->> 'no_rekening', ''))                || '|' ||
      coalesce((t.tanggal - date '1970-01-01')::text, '')               || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(t.debit,  0)::text                                       || '|' ||
      coalesce(t.kredit, 0)::text                                       || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik
  from transaksi_bank t, kata k
  where t.keterangan ilike '%' || k.cari || '%'
),

bernomor as (
  select d.*, u.nama_berkas, u.diunggah_pada,
         row_number() over (partition by d.unggahan_id, d.sidik
                            order by d.dibuat_pada, d.id) as kembar_ke
  from dasar d
  join unggahan_rekening_koran u on u.id = d.unggahan_id
),

-- Baris yang dipertahankan adalah yang paling mahal untuk hilang: keputusan
-- manusia lebih dulu, baru yang paling awal masuk. kecocokan.transaksi_id
-- memakai ON DELETE CASCADE, jadi menghapus baris yang salah ikut menghapus
-- hasil audit yang sudah dikonfirmasi orang.
berperingkat as (
  select b.*,
         c.id is not null as ada_kecocokan,
         coalesce(c.dikonfirmasi, false) as dikonfirmasi,
         row_number() over (
           partition by b.sidik, b.kembar_ke
           order by coalesce(c.dikonfirmasi, false) desc,
                    (c.id is not null) desc,
                    (b.status_rekon <> 'belum') desc,
                    b.diunggah_pada, b.dibuat_pada, b.id
         ) as peringkat,
         count(*) over (partition by b.sidik, b.kembar_ke) as salinan
  from bernomor b
  left join kecocokan c on c.transaksi_id = b.id
)

select
  case when p.peringkat = 1 then '>> ASLI (dipertahankan)'
       else '   salinan #' || (p.peringkat - 1)::text || ' (calon dihapus)' end
    as status,
  to_char(p.tanggal, 'DD/MM/YYYY')                                as tanggal,
  'Rp ' || replace(to_char(p.debit, 'FM999,999,999,999'), ',', '.') as debit,
  left(regexp_replace(p.keterangan, '\s+', ' ', 'g'), 55)          as keterangan,
  p.nama_berkas                                                    as dari_berkas,
  to_char(p.diunggah_pada, 'DD/MM/YYYY HH24:MI')                   as diunggah,
  p.baris_sumber                                                   as baris_di_berkas,
  left(p.sidik, 12)                                                as sidik,
  p.salinan                                                        as total_salinan,
  case when p.dikonfirmasi then 'ADA — sudah dikonfirmasi manusia'
       when p.ada_kecocokan then 'ada (otomatis)'
       else '-' end                                                as hasil_audit_menempel,
  p.id                                                             as id_baris
from berperingkat p
order by p.sidik, p.kembar_ke, p.peringkat;

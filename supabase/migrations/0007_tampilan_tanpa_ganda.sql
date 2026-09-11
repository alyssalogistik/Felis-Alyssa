-- ---------------------------------------------------------------------------
-- Hasil rekonsiliasi tanpa salinan
--
-- Tidak ada satu baris pun yang dihapus atau diubah. Yang ditambahkan hanya
-- sebuah view: transaksi_bank tetap utuh apa adanya, dan seluruh pembacaan
-- untuk layar, ekspor, dan laporan dialihkan ke view ini.
--
-- Sebabnya: rekening koran yang sama pernah diunggah lebih dari sekali
-- sebelum penjaga duplikat ada, sehingga satu transfer bisa tampil tiga kali
-- dan ikut terhitung tiga kali di "Total uang keluar" — angka yang dipakai
-- memutuskan apakah seorang supplier sudah dibayar.
--
-- Yang disamakan: tanggal, keterangan setelah huruf dan spasinya diseragamkan,
-- debit, kredit, dan referensi. Nomor rekening sengaja TIDAK ikut: baris lama
-- belum menyimpannya sedangkan unggahan baru menyimpannya, sehingga transaksi
-- yang sama dari dua masa akan tampak berbeda justru karena kolom itu.
--
-- BATASNYA SATU BERKAS. Salinan hanya dilipat bila datang dari unggahan yang
-- BERBEDA. Dua penarikan bernominal sama pada hari yang sama di dalam satu
-- rekening koran adalah dua transaksi sungguhan — BCA memang mencetak
-- keduanya — dan melipatnya akan menyembunyikan uang yang benar-benar keluar.
-- Di halaman ini kekurangan hitung lebih berbahaya daripada kelebihan:
-- yang tampak kurang dibayar akan dibayar untuk kedua kalinya.
--
-- Baris yang ditampilkan dari tiap kelompok bukan sekadar yang paling dulu
-- masuk, melainkan yang paling mahal bila hilang: yang hasil auditnya sudah
-- dikonfirmasi manusia, lalu yang punya kecocokan, lalu yang sudah
-- direkonsiliasi. Tanpa urutan itu, layar bisa menampilkan salinan yang
-- berstatus "belum" padahal aslinya sudah direkon.
-- ---------------------------------------------------------------------------

create or replace view transaksi_bank_unik
with (security_invoker = true) as
with sidikkan as (
  select
    t.*,
    md5(
      coalesce((t.tanggal - date '1970-01-01')::text, '')                 || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g'))  || '|' ||
      coalesce(t.debit,  0)::text                                         || '|' ||
      coalesce(t.kredit, 0)::text                                         || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik_tampil
  from transaksi_bank t
),
bernomor as (
  select s.*,
         row_number() over (partition by s.unggahan_id, s.sidik_tampil
                            order by s.dibuat_pada, s.id) as kembar_berkas
  from sidikkan s
)
select distinct on (b.sidik_tampil, b.kembar_berkas)
  b.id, b.unggahan_id, b.baris_sumber, b.berkas_sumber,
  b.tanggal, b.tanggal_ambigu, b.keterangan,
  b.debit, b.kredit, b.saldo, b.referensi,
  b.status_data, b.masalah, b.duplikat,
  b.status_rekon, b.referensi_rekon, b.catatan_rekon,
  b.nominal_pembanding, b.selisih, b.direkon_pada, b.direkon_oleh,
  b.dibuat_pada, b.bulan, b.tahun
from bernomor b
left join kecocokan k on k.transaksi_id = b.id
order by
  b.sidik_tampil, b.kembar_berkas,
  coalesce(k.dikonfirmasi, false) desc,
  (k.id is not null) desc,
  (b.status_rekon <> 'belum') desc,
  b.dibuat_pada, b.id;

-- ---------------------------------------------------------------------------
-- Ringkasan dihitung dari himpunan yang sama dengan yang ditampilkan
--
-- Tanda tangannya tidak berubah, jadi create or replace benar-benar mengganti
-- dan tidak meninggalkan versi lama yang berdampingan.
--
-- Kalau fungsi ini tetap membaca tabel mentah sementara tabelnya sudah dilipat,
-- layar akan menampilkan dua transaksi tetapi totalnya tetap menjumlahkan enam
-- baris — persis kekeliruan yang sedang diperbaiki, hanya berpindah tempat.
-- ---------------------------------------------------------------------------

create or replace function ringkasan_transaksi_bank(
  p_cari   text default null,
  p_bulan  int  default null,
  p_tahun  int  default null,
  p_dari   date default null,
  p_sampai date default null
)
returns table (jumlah bigint, debit numeric, kredit numeric, net numeric)
language sql
stable
set search_path = public
as $$
  select
    count(*),
    coalesce(sum(t.debit), 0),
    coalesce(sum(t.kredit), 0),
    coalesce(sum(t.kredit), 0) - coalesce(sum(t.debit), 0)
  from transaksi_bank_unik t
  where (p_cari is null or p_cari = ''
         or t.keterangan ilike '%' || p_cari || '%'
         or coalesce(t.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan  is null or t.bulan = p_bulan)
    and (p_tahun  is null or t.tahun = p_tahun)
    and (p_dari   is null or t.tanggal >= p_dari)
    and (p_sampai is null or t.tanggal <= p_sampai);
$$;

grant select on transaksi_bank_unik to service_role;

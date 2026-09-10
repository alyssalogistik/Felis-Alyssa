-- Rentang tanggal pada ringkasan audit, untuk database yang sudah terpasang.
--
-- Penyaringan barisnya sendiri tidak perlu perubahan skema; PostgREST bisa
-- melakukannya langsung di atas view. Yang perlu diubah adalah fungsi ringkasan:
-- tanpa parameter yang sama, angka total di layar akan mengacu ke kumpulan baris
-- yang berbeda dari tabel di bawahnya. Kesalahan seperti itu tidak menimbulkan
-- galat apa pun, dan justru paling berbahaya saat audit karena yang salah adalah
-- angka yang dipercaya.
--
-- Menambah parameter TIDAK bisa dilakukan dengan create or replace saja.
-- PostgreSQL membedakan fungsi berdasarkan daftar argumennya, sehingga versi
-- enam parameter akan berdampingan dengan versi empat parameter alih-alih
-- menggantikannya. Akibatnya pemanggilan lama menjadi ambigu dan gagal dengan
-- "Could not choose a best candidate function" — ringkasan audit mati justru
-- setelah pemutakhiran yang tampak berhasil. Karena itu tanda tangan lama
-- dilepas lebih dulu, secara eksplisit dan hanya tanda tangan itu.
--
-- Yang dilepas adalah definisi kueri, bukan data: fungsi tidak menyimpan baris
-- apa pun. Pada database baru yang skemanya sudah dibuat dari 0004, baris
-- pertama ini tidak menemukan apa-apa dan tidak melakukan apa-apa.

drop function if exists ringkasan_audit_pemasok(text, int, int, text);

create or replace function ringkasan_audit_pemasok(
  p_pemasok text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_status  text default null,
  p_dari    date default null,
  p_sampai  date default null
)
returns table (
  total_tagihan bigint,
  total_gross numeric,
  total_pph numeric,
  total_transfer numeric,
  total_selisih numeric,
  perlu_perhatian bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(*) filter (where a.tagihan_id is not null),
    coalesce(sum(a.gross), 0),
    coalesce(sum(a.pph), 0),
    coalesce(sum(a.transfer_bank), 0),
    coalesce(sum(a.selisih), 0),
    count(*) filter (where a.status <> 'MATCH')
  from audit_pembayaran_pemasok a
  where (p_pemasok is null or p_pemasok = '' or a.pemasok ilike '%' || p_pemasok || '%')
    and (p_bulan  is null or a.bulan = p_bulan)
    and (p_tahun  is null or a.tahun = p_tahun)
    and (p_status is null or p_status = '' or a.status = p_status)
    and (p_dari   is null or a.tanggal_invoice >= p_dari)
    and (p_sampai is null or a.tanggal_invoice <= p_sampai);
$$;

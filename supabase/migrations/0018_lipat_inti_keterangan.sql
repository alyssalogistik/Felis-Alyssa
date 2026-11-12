-- 0018 — Tampilan melipat transaksi yang sama dari dua cetakan BCA berbeda.
--
-- Cetakan "Mutasi Rekening" dan e-statement menuliskan transfer yang sama
-- dengan awalan jenis berbeda ("BI-FAST DB TRANSFER KE ..." vs "BIF TRANSFER KE
-- ...") dan referensi berbeda (Mutasi memilikinya, e-statement tidak). Rumus
-- lama `sidik_tampil` memuat keduanya, sehingga pasangan itu tampil sebagai dua
-- transaksi dan Total Audit menggelembung.
--
-- Rumus baru: entitas | tanggal | INTI keterangan | debit | kredit.
-- Awalan jenis dikupas HANYA untuk membandingkan; kolom `keterangan` tidak
-- diubah. Referensi tidak ikut lagi. Pelipatan tetap berhenti di batas berkas
-- (kembar dalam satu unggahan tetap dua baris), dan tidak ada baris yang
-- dihapus atau diubah — hanya tampilan.
--
-- Cermin dari intiKeterangan() di src/rekonsiliasi/pending.js. Kalau salah satu
-- diubah, ubah keduanya; test/skema-lipat-inti.test.js menjaga keduanya sama.

create or replace function inti_keterangan(p_teks text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  rapi text := btrim(lower(regexp_replace(coalesce(p_teks, ''), '\s+', ' ', 'g')));
  awalan text;
  sisa text;
begin
  -- Urutan penting: yang lebih panjang dulu.
  foreach awalan in array array[
    'trsf e-banking db', 'trsf e-banking cr', 'trsf e-banking',
    'byr via e-banking',
    'bi-fast db', 'bi-fast cr', 'bi-fast',
    'bif'
  ] loop
    if rapi = awalan then
      return rapi;
    end if;
    if left(rapi, length(awalan) + 1) = awalan || ' ' then
      sisa := btrim(substr(rapi, length(awalan) + 2));
      return case when sisa = '' then rapi else sisa end;
    end if;
  end loop;
  return rapi;
end;
$$;

create or replace view transaksi_bank_unik
with (security_invoker = true) as
with sidikkan as (
  select
    t.*,
    md5(
      t.entitas                                                || '|' ||
      coalesce((t.tanggal - date '1970-01-01')::text, '')      || '|' ||
      inti_keterangan(t.keterangan)                            || '|' ||
      coalesce(t.debit,  0)::text                              || '|' ||
      coalesce(t.kredit, 0)::text
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
  b.dibuat_pada, b.bulan, b.tahun, b.entitas
from bernomor b
left join kecocokan k on k.transaksi_id = b.id
order by
  b.sidik_tampil, b.kembar_berkas,
  coalesce(k.dikonfirmasi, false) desc,
  (k.id is not null) desc,
  (b.status_rekon <> 'belum') desc,
  b.dibuat_pada, b.id;

create or replace view transaksi_bank_kembar
with (security_invoker = true) as
select
  t.id,
  t.entitas,
  md5(
    t.entitas                                                || '|' ||
    coalesce((t.tanggal - date '1970-01-01')::text, '')      || '|' ||
    inti_keterangan(t.keterangan)                            || '|' ||
    coalesce(t.debit,  0)::text                              || '|' ||
    coalesce(t.kredit, 0)::text
  ) as sidik_tampil
from transaksi_bank t;

grant select on transaksi_bank_unik to service_role;
grant select on transaksi_bank_kembar to service_role;
grant execute on function inti_keterangan(text) to service_role;

select pg_notify('pgrst', 'reload schema');

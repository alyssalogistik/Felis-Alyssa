-- Membatalkan 0018: kembalikan rumus sidik_tampil lama (dengan referensi).
-- Aman dijalankan kapan saja; tidak menyentuh data.

create or replace view transaksi_bank_unik
with (security_invoker = true) as
with sidikkan as (
  select
    t.*,
    md5(
      t.entitas                                                           || '|' ||
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
    t.entitas                                                           || '|' ||
    coalesce((t.tanggal - date '1970-01-01')::text, '')                 || '|' ||
    lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g'))  || '|' ||
    coalesce(t.debit,  0)::text                                         || '|' ||
    coalesce(t.kredit, 0)::text                                         || '|' ||
    lower(coalesce(t.referensi, ''))
  ) as sidik_tampil
from transaksi_bank t;

drop function if exists inti_keterangan(text);
select pg_notify('pgrst', 'reload schema');

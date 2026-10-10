-- ROLLBACK 0016. Mengembalikan CHECK status ke empat nilai semula.
--
-- MENOLAK BERJALAN bila masih ada baris berstatus 'menunggu_lepas'. Memaksakan
-- rollback di atas baris seperti itu akan membuat tabelnya melanggar
-- constraint-nya sendiri — dan yang rusak bukan satu baris, melainkan setiap
-- UPDATE berikutnya pada baris itu, dengan galat yang tidak menyebut sebabnya.
--
-- Kalau penolakan itu muncul, selesaikan dulu barisnya: lepaskan lewat tombol
-- Lepas Paksa di aplikasi, atau biarkan alyssa-dev mengakuinya. Keduanya
-- memindahkannya ke 'dibatalkan', dan sesudah itu rollback ini aman.
--
-- Rollback ini TIDAK menghapus satu baris pun, dan tidak mengembalikan status
-- yang sudah terlanjur 'dibatalkan' menjadi 'ditarik' — pelepasan yang sudah
-- terjadi adalah keputusan manusia yang tercatat di tautan_pembayaran_riwayat,
-- bukan kesalahan teknis yang boleh diurungkan mesin.

do $batal$
declare
  tersangkut int;
begin
  select count(*) into tersangkut
    from tautan_pembayaran where status = 'menunggu_lepas';

  if tersangkut > 0 then
    raise exception
      'Rollback ditolak: % baris masih berstatus menunggu_lepas. Selesaikan dulu '
      'pelepasannya, baru jalankan rollback ini.', tersangkut;
  end if;

  alter table tautan_pembayaran
    drop constraint if exists tautan_pembayaran_status_check;

  alter table tautan_pembayaran
    add constraint tautan_pembayaran_status_check
    check (status in ('siap', 'ditarik', 'dibatalkan', 'perlu_koreksi_hilir'));

  drop index if exists idx_tautan_menunggu_lepas;

  raise notice 'Rollback 0016 selesai. Tidak satu baris pun diubah.';
end
$batal$;

select pg_notify('pgrst', 'reload schema');

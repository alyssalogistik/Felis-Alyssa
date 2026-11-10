-- Membatalkan 0017: melepas fungsi lepas_tautan().
--
-- Hanya menghapus satu fungsi. Tidak ada tabel, kolom, atau baris yang
-- disentuh, dan riwayat tautan tetap utuh. Setelah ini endpoint pelepasan dari
-- kode 0017 tidak bisa jalan (ia memanggil fungsi ini), jadi kembalikan kodenya
-- ke versi sebelum 0017 lebih dulu, atau jangan gunakan fitur pelepasan.

drop function if exists lepas_tautan(uuid, text, text, text, text, text, text, boolean);

select pg_notify('pgrst', 'reload schema');

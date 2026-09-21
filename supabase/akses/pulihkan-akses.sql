-- ---------------------------------------------------------------------------
-- Jaring pengaman: memulihkan akses Owner
--
-- Dipakai HANYA bila Owner benar-benar tidak bisa masuk. Jalankan di
-- Supabase SQL Editor.
-- ---------------------------------------------------------------------------

-- 1. Siapa saja yang terdaftar, dan statusnya apa.
select email, nama, peran, status, owner_utama, terakhir_login
from profil_pengguna
order by owner_utama desc, dibuat_pada;

-- 2. Mengaktifkan kembali Owner yang terlanjur nonaktif.
--    (Owner utama tidak bisa dinonaktifkan sama sekali, jadi ini hanya
--     berlaku untuk Owner tambahan.)
-- update profil_pengguna set status = 'AKTIF'
--   where lower(email) = lower('GANTI@EMAIL.ANDA');

-- 3. Melepas kewajiban ganti password bila formnya bermasalah.
-- update profil_pengguna set harus_ganti_password = false
--   where lower(email) = lower('GANTI@EMAIL.ANDA');

-- 4. Darurat: mematikan proteksi sementara.
--    Proteksi menyala karena ADA Owner aktif. Tidak ada cara mematikannya
--    dari SQL tanpa menghapus seluruh Owner — dan itu ditolak trigger.
--    Kalau benar-benar buntu, hapus variabel WAJIB_LOGIN di Railway lalu
--    naikkan Owner baru lewat langkah 5.

-- 5. Menaikkan akun lain menjadi Owner (akunnya harus sudah ada di
--    Authentication -> Users).
-- do $pulih$
-- declare id_baru uuid;
-- begin
--   select id into id_baru from auth.users where lower(email) = lower('GANTI@EMAIL.ANDA');
--   if id_baru is null then raise exception 'Akun itu belum ada di Authentication -> Users.'; end if;
--   insert into profil_pengguna (id, email, nama, peran, entitas_akses, boleh_periksa,
--                                status, harus_ganti_password, owner_utama)
--   values (id_baru, lower('GANTI@EMAIL.ANDA'), 'Owner Cadangan', 'OWNER',
--           array['PT_ALYSSA_AUTO_LOGISTIK','CV_ALYSSA_TRANS_UTAMA'], true, 'AKTIF', false, false)
--   on conflict (id) do update set peran = 'OWNER', status = 'AKTIF';
-- end
-- $pulih$;

-- ---------------------------------------------------------------------------
-- Menandai akun Owner pertama
--
-- Dijalankan SEKALI, sesudah akunnya dibuat di
--   Supabase Dashboard -> Authentication -> Users -> Add user
-- dengan "Auto Confirm User" menyala.
--
-- Ganti alamat email di bawah dengan email akun itu, lalu Run.
--
-- Sebelum baris ini masuk, aplikasi masih terbuka seperti sebelumnya.
-- Sesudahnya, seluruh halaman internal langsung terkunci dan hanya bisa
-- dibuka lewat login. Jadi pastikan login akun ini berhasil lebih dulu.
-- ---------------------------------------------------------------------------

do $bootstrap$
declare
  email_owner text := 'GANTI@EMAIL.ANDA';   -- <<< ISI INI
  id_owner    uuid;
begin
  select id into id_owner from auth.users where lower(email) = lower(email_owner);

  if id_owner is null then
    raise exception
      'Akun % belum ada di Authentication -> Users. Buat dulu di sana, baru jalankan berkas ini.',
      email_owner;
  end if;

  insert into profil_pengguna (
    id, email, nama, peran, entitas_akses, boleh_periksa,
    status, harus_ganti_password, owner_utama
  )
  values (
    id_owner, lower(email_owner), 'Owner', 'OWNER',
    array['PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'],
    true, 'AKTIF',
    -- Owner memilih sendiri passwordnya saat membuat akun, jadi tidak ada
    -- siapa pun lain yang mengetahuinya dan tidak perlu dipaksa ganti.
    false, true
  )
  on conflict (id) do update set
    peran = 'OWNER',
    status = 'AKTIF',
    owner_utama = true,
    entitas_akses = array['PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'];

  raise notice 'Owner utama siap: % (%)', email_owner, id_owner;
  raise notice 'Mulai sekarang seluruh halaman internal menuntut login.';
end
$bootstrap$;

-- Memastikan hasilnya. Harus mengembalikan tepat satu baris, owner_utama = t.
select email, peran, status, owner_utama, entitas_akses
from profil_pengguna
where owner_utama;

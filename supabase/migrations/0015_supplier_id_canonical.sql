-- ---------------------------------------------------------------------------
-- supplier_id wajib berbentuk canonical milik alyssa-dev
--
-- Master supplier ada di alyssa-dev, bukan di sini. Felis tidak pernah membuat
-- id sendiri dan tidak pernah menentukan supplier dari namanya; yang tersimpan
-- harus benar-benar supplier_profiles.id di sana, supaya pembayaran yang
-- dikirim bisa ditemukan pemiliknya.
--
-- Bentuknya tepat delapan digit heksadesimal huruf kecil. alyssa-dev
-- membandingkannya PERSIS, jadi 'A3F91B2C' gagal lookup walaupun menunjuk
-- supplier yang sama. Penyeragaman huruf terjadi di aplikasi sebelum menyimpan;
-- yang di sini menolak apa pun yang lolos dari sana.
--
-- Dipasang di database, bukan cukup di aplikasi, dengan alasan yang sama
-- seperti trigger di 0011: aturan yang hanya hidup di kode akan hilang begitu
-- ada satu jalur baru yang lupa memanggilnya — dan di sini "jalur baru" itu
-- termasuk SQL Editor yang dipakai manusia.
--
-- Salah ketik di sini tidak menimbulkan galat apa pun di Felis. Ia baru
-- ketahuan di alyssa-dev sebagai supplier yang tidak ada, sesudah uangnya
-- benar-benar keluar. Lebih buruk lagi, pemetaan_supplier MENGINGAT id yang
-- pernah dipakai dan menyarankannya kembali untuk transaksi serupa berikutnya,
-- sehingga satu salah ketik berkembang biak sendiri.
-- ---------------------------------------------------------------------------

do $pagar$
begin
  if not exists (select 1 from pg_constraint where conname = 'pemetaan_supplier_id_canonical') then
    alter table pemetaan_supplier add constraint pemetaan_supplier_id_canonical
      check (supplier_id ~ '^[0-9a-f]{8}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tautan_supplier_id_canonical') then
    alter table tautan_pembayaran add constraint tautan_supplier_id_canonical
      check (supplier_id ~ '^[0-9a-f]{8}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'kewajiban_supplier_id_canonical') then
    alter table kewajiban_supplier add constraint kewajiban_supplier_id_canonical
      check (supplier_id ~ '^[0-9a-f]{8}$');
  end if;
end
$pagar$;

-- tautan_pembayaran_riwayat sengaja TIDAK diberi pagar ini. Ia catatan sejarah
-- yang hanya bisa ditambah, dan supplier_id_lama di dalamnya merekam keadaan
-- sebagaimana adanya pada saat itu. Memagarinya berarti sejarah harus patuh
-- pada aturan yang belum berlaku ketika ia dicatat.

select pg_notify('pgrst', 'reload schema');

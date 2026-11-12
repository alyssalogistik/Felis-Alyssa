-- Melepas tautan yang sudah ditarik alyssa-dev.
--
-- SATU-SATUNYA perubahan skema: daftar status yang diizinkan bertambah satu,
-- 'menunggu_lepas'. Tidak ada tabel baru, tidak ada kolom baru, tidak ada baris
-- yang disentuh. Seluruh data lama tetap sah menurut aturan yang baru, jadi
-- migration ini tidak bisa menolak satu pun baris yang sudah ada.
--
-- ## Kenapa status baru, bukan menumpang yang sudah ada
--
-- Godaannya memakai 'perlu_koreksi_hilir', yang bentuknya memang mirip: sama-
-- sama menunggu alyssa-dev. Tetapi keduanya menuntut hal yang BERBEDA di sana —
-- yang satu minta pembayarannya dipindah ke supplier lain, yang satu minta
-- catatannya dihapus. Menumpangkannya membuat satu antrean memuat dua perintah
-- yang berlawanan, dan alyssa-dev tidak punya cara membedakannya.
--
-- ## Kenapa bukan sekadar langsung 'dibatalkan'
--
-- Keadaan ini dipegang dua sistem. Felis tidak bisa tahu apakah alyssa-dev
-- masih menyimpan pembayarannya — yang tercatat di sini hanya bahwa Felis
-- pernah MENGIRIM, bukan bahwa di sana masih ADA. Status antara inilah yang
-- membuat jarak waktu antara "Owner minta lepas" dan "alyssa-dev sudah hapus"
-- terlihat, alih-alih dianggap tidak pernah ada.

alter table tautan_pembayaran
  drop constraint if exists tautan_pembayaran_status_check;

alter table tautan_pembayaran
  add constraint tautan_pembayaran_status_check
  check (status in ('siap', 'ditarik', 'dibatalkan', 'perlu_koreksi_hilir', 'menunggu_lepas'));

-- Antrean pelepasan dibaca per status, sama seperti antrean koreksi.
create index if not exists idx_tautan_menunggu_lepas
  on tautan_pembayaran (status)
  where status = 'menunggu_lepas';

select pg_notify('pgrst', 'reload schema');

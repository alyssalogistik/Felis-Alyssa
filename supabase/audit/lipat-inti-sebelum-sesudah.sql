-- HANYA MEMBACA. Jalankan SEBELUM dan SESUDAH 0018, bandingkan angkanya.
-- Satu SELECT, supaya SQL Editor menampilkan hasilnya.
select
  (select count(*) from transaksi_bank)                          as baris_fisik,
  (select count(*) from transaksi_bank_unik)                     as baris_tampil,
  (select coalesce(sum(debit),0) from transaksi_bank_unik)       as total_debit_tampil,
  (select coalesce(sum(debit),0) from transaksi_bank_unik
     where tanggal between '2026-10-01' and '2026-10-10')        as debit_1_10_okt;

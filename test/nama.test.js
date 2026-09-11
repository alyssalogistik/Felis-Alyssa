// Menarik nama supplier dari keterangan rekening koran.
//
// Contohnya diambil dari keterangan sungguhan yang dilaporkan pemilik project,
// bukan dikarang: bentuk keterangan BCA itulah yang menentukan aturannya.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namaDariKeterangan, petaKanonik, daftarSupplier } from '../src/rekonsiliasi/nama.js';

const baris = (keterangan, debit, tanggal) => ({ keterangan, debit, tanggal, kredit: 0 });

test('nama diambil dari ujung, sesudah kode dan nominal', () => {
  assert.equal(
    namaDariKeterangan('TRSF E-BANKING DB 0308 WSID:1042025 SUGENG RIYANTO'),
    'SUGENG RIYANTO'
  );
  assert.equal(
    namaDariKeterangan('TRSF E-BANKING DB 1208 WSID:1042026 PT MITRA SEJAHTERA'),
    'PT MITRA SEJAHTERA'
  );
});

test('SKENARIO: keterangan bergaya invoice internal', () => {
  assert.equal(
    namaDariKeterangan('2602/FTSCY/WS95051 1000000.00 Dp KUSRIN YONOGI'),
    'KUSRIN YONOGI'
  );
  assert.equal(
    namaDariKeterangan('2302/FTSCY/WS95051 4000000.00 Towing sby KUSRIN YONOGI'),
    'KUSRIN YONOGI'
  );
  assert.equal(
    namaDariKeterangan('2311/FTSCY/WS95051 7750000.00 INV/AAL/42/XI/2025 KUSRIN YONOGI'),
    'KUSRIN YONOGI'
  );
});

test('transaksi tanpa lawan bernama tidak ikut jadi supplier', () => {
  assert.equal(namaDariKeterangan('TARIKAN TUNAI ATM'), null);
  assert.equal(namaDariKeterangan('BIAYA ADM'), null);
  assert.equal(namaDariKeterangan('KR OTOMATIS SETORAN TUNAI'), null);
  assert.equal(namaDariKeterangan('BUNGA'), null);
});

test('keterangan kosong atau cacat tidak melempar galat', () => {
  assert.equal(namaDariKeterangan(''), null);
  assert.equal(namaDariKeterangan(null), null);
  assert.equal(namaDariKeterangan(undefined), null);
  assert.equal(namaDariKeterangan('   '), null);
  assert.equal(namaDariKeterangan('0308 1042025'), null);
});

test('sisa kode satu huruf tidak dianggap nama', () => {
  assert.equal(namaDariKeterangan('TRSF 0308 WSID:1042025 AB'), null);
});

test('nama yang seluruhnya huruf tetap terbaca walau tanpa kode', () => {
  assert.equal(namaDariKeterangan('SUGENG RIYANTO'), 'SUGENG RIYANTO');
});

test('SKENARIO: awalan keterangan dilipat ke nama yang sama', () => {
  // "DP KUSRIN YONOGI" dan "KUSRIN YONOGI" adalah orang yang sama. Kalau
  // dibiarkan terpisah, total masing-masing menjadi separuh — dan separuh di
  // halaman ini terbaca sebagai kurang bayar.
  const peta = petaKanonik([
    { nama: 'KUSRIN YONOGI' },
    { nama: 'PEMBELIAN UNIT KUSRIN YONOGI' },
    { nama: 'SUGENG RIYANTO' },
  ]);
  assert.equal(peta.get('PEMBELIAN UNIT KUSRIN YONOGI'), 'KUSRIN YONOGI');
  assert.equal(peta.get('KUSRIN YONOGI'), 'KUSRIN YONOGI');
  assert.equal(peta.get('SUGENG RIYANTO'), 'SUGENG RIYANTO');
});

test('nama berbeda yang kebetulan berakhiran mirip tidak digabung', () => {
  // "RIYANTO" bukan akhiran kata-utuh dari "SUGENG RIYANTO SAPUTRA".
  const peta = petaKanonik([
    { nama: 'SUGENG RIYANTO SAPUTRA' },
    { nama: 'RIYANTO' },
  ]);
  assert.equal(peta.get('SUGENG RIYANTO SAPUTRA'), 'SUGENG RIYANTO SAPUTRA');
});

test('pelipatan hanya satu arah: panjang menyusut ke pendek', () => {
  const peta = petaKanonik([{ nama: 'BUDI SANTOSO' }, { nama: 'PROYEK BUDI SANTOSO' }]);
  assert.equal(peta.get('PROYEK BUDI SANTOSO'), 'BUDI SANTOSO');
  assert.equal(peta.get('BUDI SANTOSO'), 'BUDI SANTOSO');
});

test('nama berkata tunggal tidak pernah menelan nama lain', () => {
  // "BUDI" terlalu umum. Kalau ia boleh jadi sasaran, dua orang berbeda akan
  // menyatu dan totalnya jadi milik orang yang salah.
  const peta = petaKanonik([
    { nama: 'BUDI' },
    { nama: 'BUDI SANTOSO' },
    { nama: 'BUDI HARTONO' },
  ]);
  assert.equal(peta.get('BUDI SANTOSO'), 'BUDI SANTOSO');
  assert.equal(peta.get('BUDI HARTONO'), 'BUDI HARTONO');
});

test('SKENARIO NYATA: kata keterangan di BELAKANG nama tidak memecah supplier', () => {
  // Ditemukan saat menguji dengan data sungguhan: SUGENG RIYANTO terpecah tiga
  // karena "ANGSURAN" dan "PELUNASAN" ada di belakang nama, bukan di depan.
  // Akibatnya daftar menyebut Rp2.500.000 padahal yang keluar Rp7.250.000 —
  // dan yang tampak kurang dibayar akan dibayar untuk kedua kalinya.
  const hasil = daftarSupplier([
    baris('TRSF E-BANKING DB 05/11 WSID:70001 SUGENG RIYANTO', 2500000, '2025-11-05'),
    baris('TRSF E-BANKING DB 14/11 WSID:70002 SUGENG RIYANTO ANGSURAN', 1750000, '2025-11-14'),
    baris('TRSF SUGENG RIYANTO PELUNASAN', 3000000, '2025-11-27'),
  ]);

  assert.equal(hasil.length, 1, 'satu orang, satu baris daftar');
  assert.equal(hasil[0].nama, 'SUGENG RIYANTO');
  assert.equal(hasil[0].jumlah_transaksi, 3);
  assert.equal(hasil[0].total_debit, 7250000);
});

test('SKENARIO: rekap satu supplier menjumlahkan seluruh variannya', () => {
  const hasil = daftarSupplier([
    baris('2602/FTSCY/WS95051 1000000.00 Dp KUSRIN YONOGI', 1000000, '2026-02-16'),
    baris('2302/FTSCY/WS95051 4000000.00 Towing sby KUSRIN YONOGI', 4000000, '2026-02-13'),
    baris('TRSF E-BANKING DB 0308 WSID:1042025 SUGENG RIYANTO', 2500000, '2026-02-20'),
    baris('TARIKAN TUNAI ATM', 500000, '2026-02-25'),
  ]);

  assert.equal(hasil.length, 2, 'tarikan tunai tidak jadi supplier');

  const kusrin = hasil.find((h) => h.nama === 'KUSRIN YONOGI');
  assert.equal(kusrin.jumlah_transaksi, 2);
  assert.equal(kusrin.total_debit, 5000000);
  assert.equal(kusrin.pertama, '2026-02-13');
  assert.equal(kusrin.terakhir, '2026-02-16');
});

test('diurutkan dari uang keluar terbesar', () => {
  const hasil = daftarSupplier([
    baris('TRSF DB 01 WSID:1 BUDI SANTOSO', 1000000, '2026-01-05'),
    baris('TRSF DB 02 WSID:2 SITI AMINAH', 9000000, '2026-01-06'),
  ]);
  assert.equal(hasil[0].nama, 'SITI AMINAH');
  assert.equal(hasil[1].nama, 'BUDI SANTOSO');
});

test('varian yang tergabung ikut dilaporkan supaya bisa diperiksa mata', () => {
  const hasil = daftarSupplier([
    baris('2602/FTSCY/WS1 1000000.00 Dp KUSRIN YONOGI', 1000000, '2026-02-16'),
    baris('TRSF DB 01 WSID:1 KUSRIN YONOGI', 2000000, '2026-02-18'),
  ]);
  assert.deepEqual(hasil[0].varian, ['KUSRIN YONOGI']);
  assert.equal(hasil[0].total_debit, 3000000);
});

test('baris tanpa tanggal tidak merusak rentang periode', () => {
  const hasil = daftarSupplier([
    baris('TRSF DB 01 WSID:1 BUDI SANTOSO', 1000000, null),
    baris('TRSF DB 02 WSID:2 BUDI SANTOSO', 2000000, '2026-01-06'),
  ]);
  assert.equal(hasil[0].pertama, '2026-01-06');
  assert.equal(hasil[0].terakhir, '2026-01-06');
  assert.equal(hasil[0].total_debit, 3000000);
});

test('uang masuk tidak menambah total uang keluar', () => {
  const hasil = daftarSupplier([
    { keterangan: 'KR TRANSFER DARI BUDI SANTOSO', debit: 0, kredit: 750000, tanggal: '2026-02-28' },
  ]);
  assert.equal(hasil[0].total_debit, 0, 'kredit tidak ikut dijumlahkan sebagai uang keluar');
});

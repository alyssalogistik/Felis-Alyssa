// Penjaga double count untuk pembayaran manual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cariKembar, peringatanSumber, perluKonfirmasi, KUAT, LEMAH,
} from '../src/rekonsiliasi/kembar-bayar.js';

const bank = (tanggal, keterangan, debit, referensi = null) => ({
  id: `bank-${tanggal}-${debit}`, asal: 'bank', sumber: 'BCA',
  tanggal, keterangan, debit, kredit: 0, referensi,
});

const manual = (tanggal, penerima, debit, referensi = null, sumber = 'MEKARI PAY') => ({
  id: `manual-${tanggal}-${debit}`, asal: 'manual', sumber,
  tanggal, keterangan: penerima, debit, kredit: 0, referensi,
});

const calon = (ubah = {}) => ({
  tanggal: '2025-01-06',
  penerima: 'SUGENG RIYANTO',
  nominal: 28000000,
  no_referensi: null,
  sumber: 'MEKARI_PAY',
  ...ubah,
});

// --- Nomor referensi --------------------------------------------------------

test('KAIDAH: nomor referensi sama itu bukti kuat, berapa pun jarak tanggalnya', () => {
  // Satu invoice yang dibayar dua kali berbulan-bulan berjarak adalah pola
  // double count yang paling mahal.
  const hasil = cariKembar(
    calon({ no_referensi: 'INV/AAL/10/I/2025' }),
    [manual('2025-08-20', 'SUGENG RIYANTO', 28000000, 'INV/AAL/10/I/2025')]
  );
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].kekuatan, KUAT);
  assert.match(hasil[0].alasan.join(' '), /referensi sama/i);
});

test('pemisah pada nomor referensi diabaikan', () => {
  const hasil = cariKembar(
    calon({ no_referensi: 'INV/AAL/10/I/2025' }),
    [manual('2025-03-01', 'SUGENG RIYANTO', 28000000, 'INV-AAL-10-I-2025')]
  );
  assert.equal(hasil.length, 1, 'INV/AAL/10/I/2025 dan INV-AAL-10-I-2025 nomor yang sama');
});

test('referensi terlalu pendek tidak dijadikan bukti', () => {
  // Nomor tiga huruf gampang cocok kebetulan.
  const hasil = cariKembar(
    calon({ no_referensi: 'A1' }),
    [manual('2025-09-09', 'ORANG LAIN', 99000, 'A1')]
  );
  assert.equal(hasil.length, 0);
});

// --- Tanggal dan nominal ----------------------------------------------------

test('tanggal dan nominal sama persis itu kandidat kuat', () => {
  const hasil = cariKembar(calon(), [
    bank('2025-01-06', 'TRSF E-BANKING DB 0601 WSID:1 SUGENG RIYANTO', 28000000),
  ]);
  assert.equal(hasil[0].kekuatan, KUAT);
  assert.equal(hasil[0].sumber, 'BCA');
});

test('selisih beberapa hari dengan nominal sama itu kandidat lemah', () => {
  const hasil = cariKembar(calon(), [
    bank('2025-01-08', 'TRSF E-BANKING DB 0801 WSID:1 SUGENG RIYANTO', 28000000),
  ]);
  assert.equal(hasil[0].kekuatan, LEMAH);
});

test('beda tanggal jauh dan tanpa referensi bukan kandidat', () => {
  const hasil = cariKembar(calon(), [
    bank('2025-06-20', 'TRSF E-BANKING DB 2006 WSID:1 SUGENG RIYANTO', 28000000),
  ]);
  assert.equal(hasil.length, 0);
});

test('nama berbeda tidak dianggap kembar walau tanggal dan nominalnya sama', () => {
  const hasil = cariKembar(calon(), [
    bank('2025-01-06', 'TRSF E-BANKING DB 0601 WSID:1 BUDI SANTOSO', 28000000),
  ]);
  assert.equal(hasil.length, 0, 'dua supplier berbeda memang bisa dibayar sama besar di hari yang sama');
});

test('selisih nominal di bawah toleransi tetap dianggap transaksi yang sama', () => {
  const hasil = cariKembar(calon(), [
    bank('2025-01-06', 'TRSF E-BANKING DB 0601 WSID:1 SUGENG RIYANTO', 28000500),
  ]);
  assert.equal(hasil[0].kekuatan, KUAT);
});

// --- Sumber BCA -------------------------------------------------------------

test('KAIDAH: sumber BCA diperingatkan walau tidak ada kandidat', () => {
  // Rekening koran sudah jadi sumber kebenaran transaksi bank, jadi pembayaran
  // BCA yang diketik manual hampir selalu sudah ada di sana — hanya belum
  // diunggah. Ketiadaan kandidat di sini lebih sering berarti rekening korannya
  // belum masuk daripada berarti transaksinya memang belum tercatat.
  assert.equal(peringatanSumber('BCA').length, 1);
  assert.match(peringatanSumber('BCA')[0], /rekening koran/i);
  assert.equal(perluKonfirmasi([], 'BCA'), true);
});

test('sumber selain BCA tidak diperingatkan tanpa sebab', () => {
  for (const s of ['MEKARI_PAY', 'KAS', 'BANK_LAIN', 'LAINNYA']) {
    assert.deepEqual(peringatanSumber(s), [], s);
    assert.equal(perluKonfirmasi([], s), false, s);
  }
});

// --- Kapan menahan ----------------------------------------------------------

test('kandidat kuat menahan penyimpanan, kandidat lemah tidak', () => {
  assert.equal(perluKonfirmasi([{ kekuatan: KUAT }], 'MEKARI_PAY'), true);
  assert.equal(perluKonfirmasi([{ kekuatan: LEMAH }], 'MEKARI_PAY'), false);
});

test('KAIDAH: memperingatkan, bukan memblokir', () => {
  // Menolak otomatis akan membuat uang yang sungguhan keluar hilang dari
  // catatan. Yang diputuskan mesin hanya "ini perlu dilihat orang".
  const hasil = cariKembar(calon(), [
    bank('2025-01-06', 'TRSF E-BANKING DB 0601 WSID:1 SUGENG RIYANTO', 28000000),
  ]);
  assert.equal(hasil.length, 1, 'kandidatnya dilaporkan');
  assert.ok(hasil[0].alasan.length > 0, 'beserta alasannya, supaya bisa diputuskan manusia');
});

// --- Menyunting -------------------------------------------------------------

test('baris yang sedang disunting tidak melaporkan dirinya sendiri', () => {
  const sendiri = manual('2025-01-06', 'SUGENG RIYANTO', 28000000);
  assert.equal(cariKembar(calon(), [sendiri]).length, 1);
  assert.equal(cariKembar(calon(), [sendiri], { abaikanId: sendiri.id }).length, 0);
});

// --- Urutan -----------------------------------------------------------------

test('kandidat kuat ditampilkan lebih dulu', () => {
  const hasil = cariKembar(calon(), [
    bank('2025-01-08', 'TRSF DB 0801 SUGENG RIYANTO', 28000000),
    bank('2025-01-06', 'TRSF DB 0601 SUGENG RIYANTO', 28000000),
  ]);
  assert.equal(hasil[0].kekuatan, KUAT);
  assert.equal(hasil[1].kekuatan, LEMAH);
});

test('daftar pembanding kosong tidak melempar galat', () => {
  assert.deepEqual(cariKembar(calon(), []), []);
});

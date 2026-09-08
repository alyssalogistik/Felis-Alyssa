import test from 'node:test';
import assert from 'node:assert/strict';
import { uraiTabel, ringkasValidasi, GalatFormat } from '../src/rekonsiliasi/parser.js';

/** Rekening koran umumnya diawali kop sebelum tabel dimulai. */
const KOP = [
  ['BANK CONTOH'],
  ['Nomor Rekening', '1234567890'],
  ['Periode', 'Agustus 2026'],
  [],
];

test('header dikenali walau tabel tidak dimulai di baris pertama', () => {
  const { transaksi, barisHeader } = uraiTabel([
    ...KOP,
    ['Tanggal', 'Keterangan', 'Debit', 'Kredit', 'Saldo'],
    ['01/08/2026', 'PT TRIO PUTRA', '', '8.000.000', '18.000.000'],
  ]);
  assert.equal(barisHeader, 5);
  assert.equal(transaksi.length, 1);
  assert.equal(transaksi[0].kredit, 8000000);
});

test('header dengan nama kolom berbeda tetap terpetakan', () => {
  const { transaksi } = uraiTabel([
    ['Transaction Date', 'Description', 'Pengeluaran', 'Pemasukan', 'Balance'],
    ['01/08/2026', 'PT TRIO PUTRA', '1.000.000', '', '17.000.000'],
  ]);
  assert.equal(transaksi[0].debit, 1000000);
  assert.equal(transaksi[0].saldo, 17000000);
});

test('kolom dicocokkan lewat nama, bukan urutan', () => {
  const { transaksi } = uraiTabel([
    ['Saldo', 'Kredit', 'Tanggal', 'Debit', 'Keterangan'],
    ['9.000.000', '5.000.000', '02/08/2026', '', 'SETORAN TUNAI'],
  ]);
  assert.equal(transaksi[0].tanggal, '2026-08-02');
  assert.equal(transaksi[0].kredit, 5000000);
  assert.equal(transaksi[0].saldo, 9000000);
  assert.equal(transaksi[0].keterangan, 'SETORAN TUNAI');
});

test('satu kolom mutasi dengan penanda arah DB/CR', () => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Mutasi', 'DB/CR', 'Saldo'],
    ['01/08/2026', 'TRANSFER MASUK', '8.000.000', 'CR', '18.000.000'],
    ['02/08/2026', 'BIAYA ADMIN', '15.000', 'DB', '17.985.000'],
  ]);
  assert.equal(transaksi[0].kredit, 8000000);
  assert.equal(transaksi[0].debit, 0);
  assert.equal(transaksi[1].debit, 15000);
  assert.equal(transaksi[1].kredit, 0);
});

test('teks keterangan asli tidak diubah', () => {
  const asli = '  PT TRIO PUTRA TRANS MANDIRI / TRF  ';
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Kredit'],
    ['01/08/2026', asli, '8.000.000'],
  ]);
  // Hanya spasi tepi yang dirapikan; isi teksnya utuh.
  assert.equal(transaksi[0].keterangan, 'PT TRIO PUTRA TRANS MANDIRI / TRF');
});

test('format tidak dikenali menghasilkan galat yang jelas, bukan data ngawur', () => {
  assert.throws(
    () => uraiTabel([['Kolom A', 'Kolom B'], ['x', 'y']]),
    (e) => e instanceof GalatFormat && /belum dikenali/i.test(e.message)
  );
});

test('baris rusak ditandai, tidak dianggap valid', () => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Debit', 'Kredit'],
    ['01/08/2026', 'NORMAL', '', '8.000.000'],
    ['bukan tanggal', 'TANGGAL RUSAK', '', '1.000.000'],
    ['03/08/2026', '', '', '2.000.000'],
    ['04/08/2026', 'DUA KOLOM TERISI', '500.000', '500.000'],
    ['05/08/2026', 'TANPA NOMINAL', '', ''],
  ]);

  assert.equal(transaksi[0].status_data, 'valid');
  assert.equal(transaksi[1].status_data, 'perlu_diperiksa');
  assert.equal(transaksi[1].tanggal, null);
  assert.equal(transaksi[2].status_data, 'perlu_diperiksa');
  assert.equal(transaksi[3].status_data, 'perlu_diperiksa');
  assert.equal(transaksi[4].status_data, 'perlu_diperiksa');
});

test('duplikat ditandai tanpa dibuang', () => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Kredit'],
    ['01/08/2026', 'PT TRIO PUTRA', '8.000.000'],
    ['01/08/2026', 'PT TRIO PUTRA', '8.000.000'],
    ['02/08/2026', 'PT TRIO PUTRA', '8.000.000'],
  ]);

  assert.equal(transaksi.length, 3, 'baris duplikat tetap ada');
  assert.equal(transaksi[0].duplikat, false, 'kemunculan pertama bukan duplikat');
  assert.equal(transaksi[1].duplikat, true);
  assert.equal(transaksi[2].duplikat, false, 'tanggal berbeda bukan duplikat');

  assert.deepEqual(ringkasValidasi(transaksi), {
    total: 3, valid: 2, perlu_diperiksa: 1, duplikat: 1, tanggal_ambigu: 3,
  });
});

test('baris kosong di sela tabel dilewati', () => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Kredit'],
    ['01/08/2026', 'SATU', '1.000'],
    ['', '', ''],
    ['02/08/2026', 'DUA', '2.000'],
  ]);
  assert.equal(transaksi.length, 2);
});

test('nomor baris asli disimpan untuk penelusuran balik', () => {
  const { transaksi } = uraiTabel([
    ...KOP,
    ['Tanggal', 'Keterangan', 'Kredit'],
    ['01/08/2026', 'PT TRIO PUTRA', '8.000.000'],
  ]);
  assert.equal(transaksi[0].baris_sumber, 6);
});

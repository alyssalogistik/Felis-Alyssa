import test from 'node:test';
import assert from 'node:assert/strict';
import { uraiTabelTagihan, ringkasTagihan } from '../src/rekonsiliasi/tagihan.js';
import { GalatFormat } from '../src/rekonsiliasi/parser.js';

test('daftar tagihan lengkap terbaca, PPh dihormati', () => {
  const { tagihan } = uraiTabelTagihan([
    ['DAFTAR TAGIHAN SUPPLIER'],
    ['Periode', 'Agustus 2026'],
    [],
    ['Supplier', 'No Invoice', 'Tanggal', 'Gross', 'PPh', 'Net'],
    ['PT TRIO PUTRA', 'INV/2026/VIII/0042', '01/08/2026', '5.055.000', '100.000', '4.955.000'],
  ]);

  assert.equal(tagihan.length, 1);
  assert.equal(tagihan[0].gross, 5055000);
  assert.equal(tagihan[0].pph, 100000);
  assert.equal(tagihan[0].net_seharusnya, 4955000);
  assert.equal(tagihan[0].layak_simpan, true);
});

test('PPh diturunkan dari selisih gross dan net ketika kolomnya tidak ada', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Total Tagihan', 'Net Transfer'],
    ['PT TRIO PUTRA', 'INV-0042', '01/08/2026', '5.055.000', '4.955.000'],
  ]);

  assert.equal(tagihan[0].pph, 100000, 'selisihnya adalah potongan pajak');
  assert.equal(tagihan[0].net_seharusnya, 4955000);
});

test('gross diturunkan ketika hanya net dan PPh yang tersedia', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Net Transfer', 'PPh 23'],
    ['PT TRIO PUTRA', 'INV-0042', '01/08/2026', '4.955.000', '100.000'],
  ]);

  assert.equal(tagihan[0].gross, 5055000);
  assert.equal(tagihan[0].net_seharusnya, 4955000);
});

test('gross, PPh, dan net yang tidak konsisten ditandai, bukan dipilih diam-diam', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Gross', 'PPh', 'Net'],
    ['PT TRIO PUTRA', 'INV-0042', '01/08/2026', '5.055.000', '100.000', '4.000.000'],
  ]);

  assert.equal(tagihan[0].layak_simpan, false);
  assert.ok(tagihan[0].masalah.some((m) => /tidak sama dengan Net/i.test(m)), tagihan[0].masalah.join(' | '));
});

test('tagihan tanpa PPh tetap terbaca dengan net sama dengan gross', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Jumlah'],
    ['CV SUMBER REJEKI', 'INV-0100', '05/08/2026', '2.000.000'],
  ]);

  assert.equal(tagihan[0].gross, 2000000);
  assert.equal(tagihan[0].pph, 0);
  assert.equal(tagihan[0].net_seharusnya, 2000000);
});

test('nama kolom berbahasa Inggris tetap dikenali', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Vendor', 'Invoice No', 'Invoice Date', 'Amount', 'Withholding Tax'],
    ['PT TRIO PUTRA', 'INV-0042', '2026-08-01', 5055000, 100000],
  ]);

  assert.equal(tagihan[0].pemasok_nama, 'PT TRIO PUTRA');
  assert.equal(tagihan[0].tanggal_invoice, '2026-08-01');
  assert.equal(tagihan[0].net_seharusnya, 4955000);
});

test('baris tanpa supplier atau nomor invoice tidak layak disimpan', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Gross'],
    ['', 'INV-0001', '01/08/2026', '1.000.000'],
    ['PT ADA', '', '01/08/2026', '1.000.000'],
    ['PT ADA', 'INV-0002', 'tanggal rusak', '1.000.000'],
    ['PT ADA', 'INV-0003', '01/08/2026', '1.000.000'],
  ]);

  assert.deepEqual(tagihan.map((t) => t.layak_simpan), [false, false, false, true]);
});

test('PPh melebihi gross ditandai', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Gross', 'PPh'],
    ['PT ADA', 'INV-0001', '01/08/2026', '100.000', '500.000'],
  ]);

  assert.equal(tagihan[0].layak_simpan, false);
  assert.ok(tagihan[0].masalah.some((m) => /PPh lebih besar/i.test(m)));
});

test('berkas yang bukan daftar tagihan ditolak dengan pesan yang menyebut kolomnya', () => {
  assert.throws(
    () => uraiTabelTagihan([['Kolom A', 'Kolom B'], ['x', 'y']]),
    (e) => e instanceof GalatFormat && /Supplier, No Invoice/i.test(e.message)
  );
});

test('ringkasan menjumlahkan gross dan PPh', () => {
  const { tagihan } = uraiTabelTagihan([
    ['Supplier', 'No Invoice', 'Tanggal', 'Gross', 'PPh'],
    ['PT A', 'INV-1', '01/08/2026', '5.055.000', '100.000'],
    ['PT B', 'INV-2', '02/08/2026', '2.000.000', '0'],
  ]);
  const r = ringkasTagihan(tagihan);

  assert.equal(r.total, 2);
  assert.equal(r.layak, 2);
  assert.equal(r.total_gross, 7055000);
  assert.equal(r.total_pph, 100000);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { bacaRekeningKoran } from '../src/rekonsiliasi/baca.js';
import { GalatFormat } from '../src/rekonsiliasi/parser.js';
import { saring, ringkas } from '../src/rekonsiliasi/saringan.js';

/** Menyusun berkas xlsx sungguhan di memori, bukan tabel tiruan. */
async function berkasXlsx(baris, { namaSheet = 'Rekening Koran', sheetTambahan = null } = {}) {
  const buku = new ExcelJS.Workbook();
  if (sheetTambahan) {
    const depan = buku.addWorksheet(sheetTambahan.nama);
    sheetTambahan.baris.forEach((b) => depan.addRow(b));
  }
  const sheet = buku.addWorksheet(namaSheet);
  baris.forEach((b) => sheet.addRow(b));
  return Buffer.from(await buku.xlsx.writeBuffer());
}

test('unggah xlsx yang valid, dari berkas sampai hasil filter', async () => {
  const buffer = await berkasXlsx([
    ['BANK CONTOH - REKENING KORAN'],
    ['Periode', 'Agustus 2026'],
    [],
    ['Tanggal', 'Keterangan', 'Debit', 'Kredit', 'Saldo'],
    ['01/08/2026', 'PT TRIO PUTRA', null, 8000000, 18000000],
    ['15/08/2026', 'PT TRIO PUTRA TRANS', null, 5000000, 23000000],
    ['01/09/2026', 'PT TRIO PUTRA', null, 7000000, 30000000],
  ]);

  const { transaksi, sheet } = await bacaRekeningKoran(buffer, 'koran-agustus.xlsx');
  assert.equal(sheet, 'Rekening Koran');
  assert.equal(transaksi.length, 3);
  assert.equal(transaksi[0].berkas_sumber, 'koran-agustus.xlsx');

  const hasil = saring(transaksi, { cari: 'TRIO PUTRA', bulan: 8, tahun: 2026 });
  assert.equal(hasil.length, 2);
  assert.equal(ringkas(hasil).kredit, 13000000);
});

test('sel tanggal asli Excel tidak bergeser satu hari', async () => {
  const buku = new ExcelJS.Workbook();
  const sheet = buku.addWorksheet('Data');
  sheet.addRow(['Tanggal', 'Keterangan', 'Kredit']);
  const baris = sheet.addRow([new Date(Date.UTC(2026, 7, 1)), 'PT TRIO PUTRA', 8000000]);
  baris.getCell(1).numFmt = 'dd/mm/yyyy';

  const buffer = Buffer.from(await buku.xlsx.writeBuffer());
  const { transaksi } = await bacaRekeningKoran(buffer, 'tanggal.xlsx');
  assert.equal(transaksi[0].tanggal, '2026-08-01');
});

test('sheet ringkasan di depan dilewati, sheet bertabel yang dipakai', async () => {
  const buffer = await berkasXlsx(
    [
      ['Tanggal', 'Keterangan', 'Kredit'],
      ['01/08/2026', 'PT TRIO PUTRA', 8000000],
    ],
    { sheetTambahan: { nama: 'Ringkasan', baris: [['Nasabah', 'PT ALYSSA'], ['Saldo awal', 10000000]] } }
  );

  const { transaksi, sheet } = await bacaRekeningKoran(buffer, 'dua-sheet.xlsx');
  assert.equal(sheet, 'Rekening Koran');
  assert.equal(transaksi.length, 1);
});

test('csv terbaca sama seperti xlsx', async () => {
  const csv = [
    'Tanggal,Keterangan,Debit,Kredit,Saldo',
    '01/08/2026,PT TRIO PUTRA,,8000000,18000000',
    '15/08/2026,PT TRIO PUTRA TRANS,,5000000,23000000',
  ].join('\n');

  const { transaksi } = await bacaRekeningKoran(Buffer.from(csv, 'utf8'), 'koran.csv');
  assert.equal(transaksi.length, 2);
  assert.equal(transaksi[0].kredit, 8000000);
});

test('berkas .xls lama ditolak dengan petunjuk yang bisa ditindaklanjuti', async () => {
  // Tanda tangan wadah OLE2 yang dipakai Excel 97-2003.
  const xlsLama = Buffer.concat([
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.alloc(512),
  ]);

  await assert.rejects(
    () => bacaRekeningKoran(xlsLama, 'koran.xls'),
    (e) => e instanceof GalatFormat && /Save As/i.test(e.message)
  );
});

test('berkas rusak menghasilkan pesan jelas, bukan galat pustaka', async () => {
  const rusak = Buffer.from('PK ini bukan zip yang utuh', 'utf8');
  await assert.rejects(
    () => bacaRekeningKoran(rusak, 'rusak.xlsx'),
    (e) => e instanceof GalatFormat && /tidak bisa dibaca/i.test(e.message)
  );
});

test('berkas tanpa kolom yang dikenali ditolak, tidak diam-diam diterima', async () => {
  const buffer = await berkasXlsx([
    ['Kolom A', 'Kolom B', 'Kolom C'],
    ['x', 'y', 'z'],
  ]);
  await assert.rejects(
    () => bacaRekeningKoran(buffer, 'asing.xlsx'),
    (e) => e instanceof GalatFormat && /belum dikenali/i.test(e.message)
  );
});

test('berkas kosong ditolak', async () => {
  await assert.rejects(() => bacaRekeningKoran(Buffer.alloc(0), 'kosong.xlsx'), GalatFormat);
});

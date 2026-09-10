// Penguraian rekening koran BCA.
//
// Fungsi yang diuji di sini murni: menerima baris berkoordinat, mengembalikan
// tabel. PDF sungguhan diuji terpisah di test/pdf.test.js, karena yang paling
// mudah rusak justru penafsiran kolom dan tahunnya, bukan pembacaan berkasnya.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cariKolom, cariPeriode, tanggalPenuh, referensiDari, tabelDariBaris } from '../src/rekonsiliasi/bca.js';

/** Bangun satu baris berkoordinat: [teks, x, lebar]. */
const baris = (...potongan) => potongan.map(([teks, x, lebar = teks.length * 5]) => ({ teks, x, lebar }));

const HEADER = baris(['TANGGAL', 40], ['KETERANGAN', 95], ['CBG', 300], ['MUTASI', 345], ['SALDO', 460]);
const KOP = [
  baris(['PERIODE', 40], [':', 110], ['AGUSTUS', 121], ['2026', 164]),
  HEADER,
];

test('kolom dikenali dari baris header', () => {
  const kolom = cariKolom([baris(['apa saja', 10]), HEADER]);
  assert.equal(kolom.indeks, 1);
  assert.equal(kolom.tepi.TANGGAL, 40);
  assert.equal(kolom.tepi.MUTASI, 345);
});

test('header tanpa kolom mutasi tidak dianggap tabel', () => {
  const palsu = baris(['TANGGAL', 40], ['KETERANGAN', 95]);
  assert.equal(cariKolom([palsu]), null);
});

test('periode terbaca dari nama bulan', () => {
  assert.deepEqual(cariPeriode([KOP]), { bulan: 8, tahun: 2026 });
});

test('periode terbaca dari bentuk ringkas 08/2026', () => {
  const ringkas = [baris(['PERIODE', 40], [':', 110], ['08/2026', 121])];
  assert.deepEqual(cariPeriode([ringkas]), { bulan: 8, tahun: 2026 });
});

test('tanggal memakai tahun periode', () => {
  assert.equal(tanggalPenuh(11, 8, { bulan: 8, tahun: 2026 }), '2026-08-11');
});

test('Desember pada periode Januari jatuh ke tahun sebelumnya', () => {
  // Rekening koran Januari kerap memuat transaksi akhir Desember di baris awal.
  assert.equal(tanggalPenuh(31, 12, { bulan: 1, tahun: 2027 }), '2026-12-31');
});

test('Januari pada periode Desember jatuh ke tahun berikutnya', () => {
  assert.equal(tanggalPenuh(2, 1, { bulan: 12, tahun: 2026 }), '2027-01-02');
});

test('WSID ditarik keluar sebagai referensi', () => {
  assert.equal(referensiDari('TRSF E-BANKING DB 02/08 WSID:98212 PT TRIO PUTRA'), 'WSID:98212');
  assert.equal(referensiDari('BIAYA ADM'), null);
});

test('keterangan panjang tidak terpotong ke kolom sebelahnya', () => {
  // Kata terakhir berada jauh di kanan, hampir menyentuh kolom CBG. Kalau kolom
  // ditentukan dari titik tengah, nama supplier akan terpenggal.
  const halaman = [[
    ...KOP,
    baris(['02/08', 40], ['TRSF E-BANKING DB', 95], ['0000', 300], ['5.055.000,00 DB', 345], ['44.945.000,00', 460]),
    baris(['02/08 WSID:98212 PT TRIO', 95], ['PUTRA', 250, 30]),
  ]];
  const { tabel } = tabelDariBaris(halaman);
  assert.match(tabel[1][1], /PT TRIO PUTRA$/);
});

test('nominal rata kanan tetap masuk kolom mutasi', () => {
  // Angka panjang dimulai di kiri judul MUTASI; diukur dari tepi kiri, ia akan
  // terbaca sebagai isi kolom CBG.
  const halaman = [[
    ...KOP,
    baris(['05/08', 40], ['BIAYA ADM', 95], ['15.750.000,00 DB', 310, 90], ['4.235.000,00', 430, 80]),
  ]];
  const { tabel } = tabelDariBaris(halaman);
  assert.equal(tabel[1][3], '15.750.000,00 DB');
});

test('baris kaki bukan transaksi', () => {
  const halaman = [[
    ...KOP,
    baris(['02/08', 40], ['SETORAN TUNAI', 95], ['1.000,00', 345], ['2.000,00', 460]),
    baris(['SALDO AWAL', 95], ['50.000.000,00', 460]),
    baris(['MUTASI KREDIT', 95], ['1', 300]),
  ]];
  const { tabel } = tabelDariBaris(halaman);
  assert.equal(tabel.length, 2, 'hanya satu baris transaksi');
});

test('kop halaman lanjutan tidak tergabung ke keterangan', () => {
  // Tanpa pemrosesan per halaman, "NO. REKENING" halaman dua akan menempel
  // pada transaksi terakhir halaman satu.
  const halaman = [
    [...KOP, baris(['02/08', 40], ['SETORAN TUNAI', 95], ['1.000,00', 345], ['2.000,00', 460])],
    [
      baris(['NO. REKENING', 40], [':', 110], ['0123456789', 121]),
      baris(['05/08', 40], ['BIAYA ADM', 95], ['15.000,00 DB', 345], ['1.000,00', 460]),
    ],
  ];
  const { tabel } = tabelDariBaris(halaman);
  assert.equal(tabel[1][1], 'SETORAN TUNAI');
  assert.equal(tabel.length, 3);
});

test('tanpa periode ditolak, bukan ditebak tahunnya', () => {
  const halaman = [[HEADER, baris(['02/08', 40], ['APA SAJA', 95], ['1.000,00', 345])]];
  assert.throws(() => tabelDariBaris(halaman), /PERIODE/);
});

test('PDF yang bukan rekening koran ditolak dengan sebab yang jelas', () => {
  const halaman = [[baris(['BUKTI TRANSFER', 40]), baris(['Rp 1.000.000', 40])]];
  assert.throws(() => tabelDariBaris(halaman), /rekening koran BCA/);
});

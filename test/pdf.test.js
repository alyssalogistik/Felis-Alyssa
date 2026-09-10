// Membaca PDF sungguhan, bukan baris yang sudah dirapikan.
//
// Dua berkas contoh di test/berkas/ meniru dua tata letak yang benar-benar
// dipakai BCA: nominal rata kiri satu halaman, dan nominal rata kanan yang
// menyambung ke halaman kedua melewati pergantian tahun.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacaRekeningKoran, kenaliFormat } from '../src/rekonsiliasi/baca.js';

const berkas = (nama) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'berkas', nama));

test('PDF dikenali dari isinya, bukan dari nama berkasnya', () => {
  assert.equal(kenaliFormat(berkas('bca-agustus.pdf'), 'entah.txt'), 'pdf');
  assert.equal(kenaliFormat(Buffer.from('PKxx'), ''), 'xlsx');
});

test('rekening koran BCA satu halaman terbaca utuh', async () => {
  const hasil = await bacaRekeningKoran(berkas('bca-agustus.pdf'), 'bca-agustus.pdf');

  assert.equal(hasil.sheet, 'BCA 08/2026');
  assert.equal(hasil.transaksi.length, 6);

  const trio = hasil.transaksi[0];
  assert.equal(trio.tanggal, '2026-08-02');
  assert.equal(trio.debit, 5055000);
  assert.equal(trio.kredit, 0);
  assert.equal(trio.saldo, 44945000);
  assert.equal(trio.referensi, 'WSID:98212');
  // Nama supplier ada di baris sambungan; tanpa penggabungan itu, pencocokan
  // audit kehilangan satu-satunya petunjuk siapa yang dibayar.
  assert.match(trio.keterangan, /PT TRIO PUTRA/);
});

test('tanggal PDF tidak ditandai ambigu', async () => {
  // Tanggal BCA selalu DD/MM, dan itu sudah dipastikan saat penguraian, jadi
  // menandainya ambigu hanya akan membanjiri hasil dengan peringatan palsu.
  const hasil = await bacaRekeningKoran(berkas('bca-agustus.pdf'), 'x.pdf');
  assert.equal(hasil.transaksi.filter((t) => t.tanggal_ambigu).length, 0);
});

test('uang masuk terbaca sebagai kredit, uang keluar sebagai debit', async () => {
  const hasil = await bacaRekeningKoran(berkas('bca-agustus.pdf'), 'x.pdf');
  const masuk = hasil.transaksi.find((t) => t.keterangan.startsWith('SETORAN TUNAI'));
  assert.equal(masuk.kredit, 10000000);
  assert.equal(masuk.debit, 0);
});

test('semua baris lolos validasi tanpa masalah', async () => {
  const hasil = await bacaRekeningKoran(berkas('bca-agustus.pdf'), 'x.pdf');
  const bermasalah = hasil.transaksi.filter((t) => t.masalah.length > 0);
  assert.deepEqual(bermasalah.map((t) => [t.keterangan, t.masalah]), []);
});

test('dua halaman dan pergantian tahun', async () => {
  const hasil = await bacaRekeningKoran(berkas('bca-januari.pdf'), 'bca-januari.pdf');

  assert.equal(hasil.sheet, 'BCA 01/2027');
  assert.equal(hasil.transaksi.length, 5, 'halaman kedua ikut terbaca');

  // Periode Januari 2027, transaksi 31/12 jatuh ke Desember 2026.
  assert.equal(hasil.transaksi[0].tanggal, '2026-12-31');
  assert.equal(hasil.transaksi[1].tanggal, '2027-01-02');

  // Nominal rata kanan tetap masuk kolom mutasi, bukan kolom cabang.
  assert.equal(hasil.transaksi[1].debit, 15750000);

  // Kop halaman kedua tidak mencemari keterangan transaksi sebelumnya.
  assert.equal(hasil.transaksi[2].keterangan, 'BIAYA ADM');
});

test('berkas bukan PDF tetap lewat jalur lama', async () => {
  await assert.rejects(
    () => bacaRekeningKoran(Buffer.from('bukan berkas apa pun'), 'x.txt'),
    /tidak bisa dibaca|belum dikenali/
  );
});

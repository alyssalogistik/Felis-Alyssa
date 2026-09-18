// Entitas pemilik rekening.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTITAS, KODE_ENTITAS, kodeEntitas, labelEntitas, saringanEntitas } from '../src/rekonsiliasi/entitas.js';

test('kedua perusahaan punya kode dan label', () => {
  assert.deepEqual(KODE_ENTITAS, ['PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA']);
  assert.equal(labelEntitas('PT_ALYSSA_AUTO_LOGISTIK'), 'PT Alyssa Auto Logistik');
  assert.equal(labelEntitas('CV_ALYSSA_TRANS_UTAMA'), 'CV Alyssa Trans Utama');
});

test('kode diterima apa pun gaya penulisannya', () => {
  for (const bentuk of ['PT_ALYSSA_AUTO_LOGISTIK', 'pt_alyssa_auto_logistik', 'PT ALYSSA AUTO LOGISTIK', 'PT Alyssa Auto Logistik', '  pt-alyssa-auto-logistik  ']) {
    assert.equal(kodeEntitas(bentuk), 'PT_ALYSSA_AUTO_LOGISTIK', bentuk);
  }
  assert.equal(kodeEntitas('CV Alyssa Trans Utama'), 'CV_ALYSSA_TRANS_UTAMA');
});

test('KAIDAH: tidak ada entitas bawaan', () => {
  // Bawaan yang diam-diam dipakai ketika pilihannya lupa dikirim akan menandai
  // rekening koran CV sebagai milik PT. Kekeliruan itu tidak menimbulkan galat
  // apa pun dan baru ketahuan saat angka auditnya dipakai.
  for (const kosong of ['', '   ', null, undefined]) {
    assert.equal(kodeEntitas(kosong), null, String(kosong));
  }
});

test('entitas yang tidak dikenali ditolak, bukan dibiarkan lewat', () => {
  for (const asing of ['PT LAIN', 'FreightWise', 'pt', 'cv', 'semua', 42, {}]) {
    assert.equal(kodeEntitas(asing), null, String(asing));
  }
});

test('label kode asing tidak mengarang nama', () => {
  assert.equal(labelEntitas('ENTAH_APA'), 'ENTAH_APA');
  assert.equal(labelEntitas(null), '');
});

// --- Penyaringan ------------------------------------------------------------

test('penyaringan tanpa pilihan berarti seluruh entitas', () => {
  // Berbeda dari penyimpanan: di sini tidak memilih apa-apa adalah pilihan yang
  // sah, dan artinya "Semua".
  for (const semua of ['', '   ', 'semua', 'SEMUA', null, undefined]) {
    assert.deepEqual(saringanEntitas(semua), { ok: true, kode: null }, String(semua));
  }
});

test('penyaringan mengenali kedua entitas', () => {
  assert.deepEqual(saringanEntitas('CV_ALYSSA_TRANS_UTAMA'), { ok: true, kode: 'CV_ALYSSA_TRANS_UTAMA' });
  assert.deepEqual(saringanEntitas('PT Alyssa Auto Logistik'), { ok: true, kode: 'PT_ALYSSA_AUTO_LOGISTIK' });
});

test('KAIDAH: saringan yang tidak dikenali DITOLAK, bukan jatuh ke "semua"', () => {
  // Kalau nilai asing diam-diam berarti "semua", salah ketik pada satu tab akan
  // memunculkan transaksi perusahaan lain tanpa gejala apa pun — persis yang
  // seluruh pemisahan ini berusaha cegah.
  for (const asing of ['PT LAIN', 'FreightWise', 'pt', 'semuaa', 'CV']) {
    assert.deepEqual(saringanEntitas(asing), { ok: false, kode: null }, asing);
  }
});

// --- Terhadap berkas sungguhan ----------------------------------------------

test('SKENARIO: dua perusahaan, supplier yang sama, rekening berbeda', async () => {
  // Inilah keadaan yang ditangani pemisahan ini. Kedua berkas memuat transfer
  // ke SUGENG RIYANTO, tetapi dari rekening yang berbeda — dan nomor rekening
  // itulah yang dipakai menolak unggahan yang salah tanda.
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { bacaRekeningKoran } = await import('../src/rekonsiliasi/baca.js');

  const berkas = (n) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'berkas', n));
  const pt = await bacaRekeningKoran(berkas('lintas-mutasi.pdf'), 'pt.pdf');
  const cv = await bacaRekeningKoran(berkas('cv-estatement.pdf'), 'cv.pdf');

  assert.notEqual(pt.noRekening, cv.noRekening, 'rekeningnya harus berbeda');
  assert.ok(pt.transaksi.some((t) => t.keterangan.includes('SUGENG RIYANTO')));
  assert.ok(cv.transaksi.some((t) => t.keterangan.includes('SUGENG RIYANTO')));
  // Nominalnya berbeda, sehingga tercampur atau tidak langsung kelihatan.
  assert.notEqual(
    pt.transaksi.filter((t) => t.keterangan.includes('SUGENG')).reduce((s, t) => s + t.debit, 0),
    cv.transaksi.filter((t) => t.keterangan.includes('SUGENG')).reduce((s, t) => s + t.debit, 0)
  );
});

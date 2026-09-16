// Aturan isian pembayaran manual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SUMBER, labelSumber, saringPembayaran, saringPerubahan, uraiNominalIsian,
} from '../src/rekonsiliasi/pembayaran.js';

const isian = (ubah = {}) => ({
  tanggal: '2025-01-06',
  penerima: 'SUGENG RIYANTO',
  nominal: '28000000',
  sumber: 'MEKARI_PAY',
  dibuat_oleh: 'Sean',
  ...ubah,
});

// --- Nominal ----------------------------------------------------------------

test('nominal boleh diketik sebagaimana orang menulis rupiah', () => {
  assert.equal(uraiNominalIsian('28.000.000'), 28000000);
  assert.equal(uraiNominalIsian('28 000 000'), 28000000);
  assert.equal(uraiNominalIsian('28000000'), 28000000);
  assert.equal(uraiNominalIsian(28000000), 28000000);
});

test('nominal yang bukan angka ditolak, bukan diam-diam jadi nol', () => {
  // Nol yang lolos akan tersimpan sebagai pembayaran kosong dan mengurangi
  // total supplier tanpa gejala apa pun.
  for (const buruk of ['', '   ', 'dua puluh', 'Rp28jt', '-5000', null, undefined]) {
    assert.equal(uraiNominalIsian(buruk), null, `seharusnya ditolak: ${String(buruk)}`);
  }
});

// --- Label sumber -----------------------------------------------------------

test('pembayaran manual bersumber BCA ditandai MANUAL', () => {
  // Kalau ditulis "BCA" saja, ia tampak seolah baris rekening koran padahal
  // diketik orang — dan laporan kehilangan satu-satunya penandanya.
  assert.equal(labelSumber('BCA'), 'BCA (MANUAL)');
  assert.equal(labelSumber('MEKARI_PAY'), 'MEKARI PAY');
  assert.equal(labelSumber('BANK_LAIN'), 'BANK LAIN');
  assert.equal(labelSumber('KAS'), 'KAS');
});

test('seluruh sumber yang ditawarkan punya label', () => {
  for (const kunci of Object.keys(SUMBER)) {
    assert.ok(labelSumber(kunci).length > 0, kunci);
  }
});

// --- Penyaringan isian ------------------------------------------------------

test('isian lengkap diterima dan dirapikan', () => {
  const h = saringPembayaran(isian({ nominal: '28.000.000', memo: '  Termin 1  ' }));
  assert.equal(h.ok, true);
  assert.equal(h.nilai.nominal, 28000000);
  assert.equal(h.nilai.memo, 'Termin 1');
  assert.equal(h.nilai.bukti_url, null);
});

test('KAIDAH: spasi ganda di tengah nama dirapatkan, bukan hanya dipangkas', () => {
  // Pencarian di halaman audit harfiah. "SUGENG  RIYANTO" berspasi dua tidak
  // akan pernah ditemukan oleh pencarian "SUGENG RIYANTO" — pembayarannya ada
  // di database tetapi hilang dari layar, dan yang tampak belum dibayar akan
  // dibayar untuk kedua kalinya.
  const h = saringPembayaran(isian({ penerima: '  SUGENG   RIYANTO  ' }));
  assert.equal(h.nilai.penerima, 'SUGENG RIYANTO');
});

test('kolom wajib yang kosong dilaporkan satu per satu', () => {
  const h = saringPembayaran({ tanggal: '', penerima: '', nominal: '', sumber: '', dibuat_oleh: '' });
  assert.equal(h.ok, false);
  assert.equal(h.nilai, null);
  assert.equal(h.masalah.length, 5, h.masalah.join(' | '));
});

test('"Diinput oleh" wajib — audit trail tanpa nama cuma hiasan', () => {
  const h = saringPembayaran(isian({ dibuat_oleh: '   ' }));
  assert.equal(h.ok, false);
  assert.ok(h.masalah.some((m) => /Diinput oleh/.test(m)));
});

test('sumber di luar daftar ditolak', () => {
  assert.equal(saringPembayaran(isian({ sumber: 'GOPAY' })).ok, false);
  assert.equal(saringPembayaran(isian({ sumber: '' })).ok, false);
});

test('sumber diterima apa pun gaya penulisannya', () => {
  assert.equal(saringPembayaran(isian({ sumber: 'mekari pay' })).nilai.sumber, 'MEKARI_PAY');
  assert.equal(saringPembayaran(isian({ sumber: 'bank-lain' })).nilai.sumber, 'BANK_LAIN');
});

test('tanggal harus ISO, bentuk lain ditolak', () => {
  assert.equal(saringPembayaran(isian({ tanggal: '06/01/2025' })).ok, false);
  assert.equal(saringPembayaran(isian({ tanggal: '2025-13-40' })).ok, false);
  assert.equal(saringPembayaran(isian({ tanggal: '2025-01-06' })).ok, true);
});

test('nominal nol atau negatif ditolak', () => {
  assert.equal(saringPembayaran(isian({ nominal: '0' })).ok, false);
  assert.equal(saringPembayaran(isian({ nominal: '-100' })).ok, false);
});

// --- Tautan bukti -----------------------------------------------------------

test('link bukti kosong itu sah', () => {
  assert.equal(saringPembayaran(isian({ bukti_url: '' })).nilai.bukti_url, null);
});

test('KAIDAH: link bukti hanya boleh http/https', () => {
  // Nilainya ditempel sebagai href. Skema lain menjadikan satu isian teks
  // sebagai jalan menjalankan kode di peramban orang lain.
  assert.equal(saringPembayaran(isian({ bukti_url: 'https://drive.google.com/x' })).ok, true);
  assert.equal(saringPembayaran(isian({ bukti_url: 'http://mekari.test/a' })).ok, true);
  for (const jahat of ['javascript:alert(1)', 'data:text/html,<script>', 'file:///etc/passwd', 'bukan url']) {
    assert.equal(saringPembayaran(isian({ bukti_url: jahat })).ok, false, jahat);
  }
});

// --- Perubahan --------------------------------------------------------------

test('perubahan mencatat pengubahnya, bukan menimpa pembuatnya', () => {
  const h = saringPerubahan({ ...isian(), diubah_oleh: 'Admin' });
  assert.equal(h.ok, true);
  assert.equal(h.nilai.diubah_oleh, 'Admin');
  assert.equal(h.nilai.dibuat_oleh, undefined, 'pembuat asli tidak boleh ikut tertimpa');
  assert.ok(h.nilai.diubah_pada);
});

test('perubahan tanpa nama pengubah ditolak dengan pesan yang tepat', () => {
  const h = saringPerubahan({ ...isian(), diubah_oleh: '' });
  assert.equal(h.ok, false);
  assert.ok(h.masalah.some((m) => /Diubah oleh/.test(m)), h.masalah.join(' | '));
});

// Pesan yang muncul saat skema database tertinggal.
//
// Yang diuji di sini kalimatnya, bukan perbaikannya. Kalimat inilah yang dibaca
// pemilik database saat aplikasinya tiba-tiba mati — dan orang yang mengira
// datanya hilang akan melakukan hal-hal yang membuatnya benar-benar hilang.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namaRelasi, skemaBelumSiap } from '../src/skema.js';

// --- Membaca nama relasi dari pesan galat -----------------------------------

test('nama relasi terbaca dari pesan PostgREST', () => {
  assert.equal(
    namaRelasi("Could not find the table 'public.pembayaran_semua' in the schema cache"),
    'pembayaran_semua'
  );
});

test('nama relasi terbaca dari pesan PostgreSQL', () => {
  assert.equal(namaRelasi('relation "transaksi_bank" does not exist'), 'transaksi_bank');
});

test('awalan skema dibuang', () => {
  assert.equal(namaRelasi('relation "public.pembayaran_manual" does not exist'), 'pembayaran_manual');
});

test('pesan yang tidak menyebut relasi mengembalikan null', () => {
  assert.equal(namaRelasi('connection refused'), null);
  assert.equal(namaRelasi(''), null);
  assert.equal(namaRelasi(null), null);
});

// --- Membedakan database kosong dari skema tertinggal -----------------------

test('KAIDAH: tabel baru yang hilang TIDAK dibilang "tabelnya belum dibuat"', () => {
  // Inilah kasus yang terjadi sungguhan: pembayaran_semua belum ada karena
  // migration 0008 belum dijalankan, sementara transaksi_bank memuat 4.406
  // baris. Pesan lama membuatnya terbaca seperti seluruh database kosong.
  const sebab = skemaBelumSiap({
    code: 'PGRST205',
    message: "Could not find the table 'public.pembayaran_semua' in the schema cache",
  });
  assert.match(sebab, /tertinggal/);
  assert.match(sebab, /Data lama tetap utuh/);
  assert.doesNotMatch(sebab, /belum dibuat/);
});

test('tabel inti yang hilang memang berarti database belum dipasang', () => {
  for (const inti of ['pesanan', 'transaksi_bank', 'unggahan_rekening_koran']) {
    const sebab = skemaBelumSiap({ code: '42P01', message: `relation "${inti}" does not exist` });
    assert.match(sebab, /belum disiapkan/, inti);
  }
});

test('tabel pembayaran manual yang hilang dibaca sebagai skema tertinggal', () => {
  for (const baru of ['pembayaran_manual', 'pembayaran_manual_riwayat', 'pembayaran_semua']) {
    assert.match(skemaBelumSiap({ code: 'PGRST205', message:
      `Could not find the table 'public.${baru}' in the schema cache` }), /tertinggal/, baru);
  }
});

test('galat tabel hilang tanpa nama relasi tetap dijawab aman', () => {
  // Tidak bisa dipastikan yang mana yang hilang; jawaban lamanya dipertahankan.
  const sebab = skemaBelumSiap({ code: 'PGRST205', message: 'schema mismatch' });
  assert.ok(sebab !== null);
});

// --- Kolom dan fungsi -------------------------------------------------------

test('kolom atau fungsi yang belum ada selalu dibilang data lama utuh', () => {
  for (const galat of [
    { code: 'PGRST204', message: "Could not find the 'sumber' column" },
    { code: '42703', message: 'column "asal" does not exist' },
    { code: '42883', message: 'function ringkasan_pembayaran(text) does not exist' },
  ]) {
    assert.match(skemaBelumSiap(galat), /Data lama tetap utuh/, galat.code);
  }
});

// --- Yang bukan urusan skema ------------------------------------------------

test('galat lain tidak disalahartikan sebagai masalah skema', () => {
  // Kalau setiap galat menyuruh menjalankan setup-lengkap.sql, sebab yang
  // sebenarnya tidak akan pernah dicari.
  assert.equal(skemaBelumSiap({ code: '23505', message: 'duplicate key value' }), null);
  assert.equal(skemaBelumSiap({ message: 'fetch failed' }), null);
  assert.equal(skemaBelumSiap(null), null);
  assert.equal(skemaBelumSiap(undefined), null);
  assert.equal(skemaBelumSiap({}), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { uraiTanggal, uraiNominal } from '../src/rekonsiliasi/nilai.js';

test('tanggal: format Indonesia dibaca hari-dulu', () => {
  assert.equal(uraiTanggal('01/08/2026').tanggal, '2026-08-01');
  assert.equal(uraiTanggal('15/08/2026').tanggal, '2026-08-15');
  assert.equal(uraiTanggal('31-12-2026').tanggal, '2026-12-31');
  assert.equal(uraiTanggal('01.09.2026').tanggal, '2026-09-01');
});

test('tanggal: hari di atas 12 tidak mungkin bulan, jadi tidak ambigu', () => {
  const hasil = uraiTanggal('15/08/2026');
  assert.equal(hasil.ambigu, false);
  assert.equal(uraiTanggal('01/08/2026').ambigu, true, '1 Agustus vs 8 Januari');
});

test('tanggal: ISO dan nama bulan tidak pernah ambigu', () => {
  assert.equal(uraiTanggal('2026-08-01').tanggal, '2026-08-01');
  assert.equal(uraiTanggal('2026-08-01').ambigu, false);
  assert.equal(uraiTanggal('01 Agustus 2026').tanggal, '2026-08-01');
  assert.equal(uraiTanggal('1 Agu 2026').tanggal, '2026-08-01');
});

test('tanggal: angka serial Excel', () => {
  // 46235 = 1 Agustus 2026 pada penanggalan Excel.
  assert.equal(uraiTanggal(46235).tanggal, '2026-08-01');
  assert.equal(uraiTanggal(46235).ambigu, false);
});

test('tanggal: objek Date dibaca dalam UTC agar tidak mundur sehari', () => {
  assert.equal(uraiTanggal(new Date(Date.UTC(2026, 7, 1))).tanggal, '2026-08-01');
  // Tengah malam UTC adalah hari sebelumnya di zona barat; hasilnya harus tetap 1 Agustus.
  assert.equal(uraiTanggal(new Date('2026-08-01T00:00:00Z')).tanggal, '2026-08-01');
});

test('tanggal: nilai tidak valid ditolak, tidak ditebak', () => {
  assert.equal(uraiTanggal('31/02/2026').ok, false, '31 Februari tidak ada');
  assert.equal(uraiTanggal('bukan tanggal').ok, false);
  assert.equal(uraiTanggal('').ok, false);
  assert.equal(uraiTanggal(null).ok, false);
});

test('nominal: gaya Indonesia', () => {
  assert.equal(uraiNominal('8.000.000').nilai, 8000000);
  assert.equal(uraiNominal('1.234.567,89').nilai, 1234567.89);
  assert.equal(uraiNominal('Rp 8.000.000').nilai, 8000000);
  assert.equal(uraiNominal('8,50').nilai, 8.5);
});

test('nominal: gaya Inggris', () => {
  assert.equal(uraiNominal('1,234,567.89').nilai, 1234567.89);
  assert.equal(uraiNominal('8,000').nilai, 8000);
});

test('nominal: angka mentah dan sel kosong', () => {
  assert.equal(uraiNominal(8000000).nilai, 8000000);
  assert.equal(uraiNominal('').nilai, 0);
  assert.equal(uraiNominal('-').nilai, 0);
  assert.equal(uraiNominal(null).nilai, 0);
});

test('nominal: negatif lewat tanda kurung maupun minus', () => {
  assert.equal(uraiNominal('(500.000)').nilai, -500000);
  assert.equal(uraiNominal('-500.000').nilai, -500000);
});

test('nominal: teks yang bukan angka ditolak', () => {
  assert.equal(uraiNominal('abc').ok, false);
  assert.equal(uraiNominal('8.000 rupiah').ok, false);
});

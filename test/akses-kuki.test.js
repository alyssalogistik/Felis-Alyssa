import test from 'node:test';
import assert from 'node:assert/strict';
import { bacaKuki, rangkaiKuki, hapusKuki, NAMA_AKSES } from '../src/akses/kuki.js';

test('membaca beberapa cookie sekaligus', () => {
  const hasil = bacaKuki(`${NAMA_AKSES}=abc123; lain=xyz`);
  assert.equal(hasil[NAMA_AKSES], 'abc123');
  assert.equal(hasil.lain, 'xyz');
});

test('header kosong atau cacat tidak melempar', () => {
  assert.deepEqual(bacaKuki(''), {});
  assert.deepEqual(bacaKuki(undefined), {});
  assert.deepEqual(bacaKuki('tanpa-sama-dengan'), {});
  assert.deepEqual(bacaKuki('=kosong'), {});
});

test('nilai ber-persen yang cacat diperlakukan seperti tidak ada', () => {
  assert.deepEqual(bacaKuki('a=%E0%A4%A'), {});
});

test('cookie sesi selalu HttpOnly, SameSite Lax, dan Secure', () => {
  const kuki = rangkaiKuki(NAMA_AKSES, 'token', { maksUmur: 3600 });
  assert.match(kuki, /HttpOnly/);
  assert.match(kuki, /SameSite=Lax/);
  assert.match(kuki, /Secure/);
  assert.match(kuki, /Max-Age=3600/);
  assert.match(kuki, /Path=\//);
});

test('Secure hanya bisa dimatikan secara eksplisit untuk pengembangan lokal', () => {
  assert.doesNotMatch(rangkaiKuki(NAMA_AKSES, 't', { aman: false }), /Secure/);
  // HttpOnly tetap ada apa pun opsinya: token yang bisa dibaca JavaScript
  // berarti satu celah XSS cukup untuk mencurinya.
  assert.match(rangkaiKuki(NAMA_AKSES, 't', { aman: false }), /HttpOnly/);
});

test('cookie penghapus langsung kedaluwarsa', () => {
  assert.match(hapusKuki(NAMA_AKSES), /Max-Age=0/);
});

test('nilai cookie di-escape supaya tidak bisa menyuntik atribut', () => {
  const kuki = rangkaiKuki(NAMA_AKSES, 'a; Domain=jahat.com');
  assert.doesNotMatch(kuki, /Domain=jahat\.com/);
  assert.equal(bacaKuki(kuki.split(';')[0])[NAMA_AKSES], 'a; Domain=jahat.com');
});

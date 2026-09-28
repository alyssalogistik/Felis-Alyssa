import test from 'node:test';
import assert from 'node:assert/strict';
import { IZIN, izinDibutuhkan, memenuhi, rapikanJalur, perluSaringEntitas } from '../src/akses/kebijakan.js';

const owner = { peran: 'OWNER', status: 'AKTIF' };
const auditor = { peran: 'AUDITOR', status: 'AKTIF', boleh_periksa: false };
const auditorPeriksa = { peran: 'AUDITOR', status: 'AKTIF', boleh_periksa: true };
const nonaktif = { peran: 'OWNER', status: 'NONAKTIF' };

test('hanya pelacakan resi dan login yang terbuka tanpa sesi', () => {
  assert.equal(izinDibutuhkan('GET', '/lacak/AAL123'), IZIN.PUBLIK);
  assert.equal(izinDibutuhkan('POST', '/auth/masuk'), IZIN.PUBLIK);
  // Bukan pola luas /lacak/*: daftar pesanan tetap tertutup.
  assert.equal(izinDibutuhkan('GET', '/pesanan'), IZIN.BACA);
  assert.equal(izinDibutuhkan('GET', '/lacak'), IZIN.BACA);
});

test('bawaan menutup: yang bukan GET jatuh ke OWNER', () => {
  assert.equal(izinDibutuhkan('DELETE', '/endpoint/yang/belum/ada'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('POST', '/rekonsiliasi/unggah'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('DELETE', '/rekonsiliasi/unggahan/abc'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('DELETE', '/rekonsiliasi/pembayaran/abc'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('POST', '/rekonsiliasi/pembayaran'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('PATCH', '/rekonsiliasi/pembayaran/abc'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('POST', '/mekari/unggah'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('POST', '/mekari/hitung'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('POST', '/rekonsiliasi/audit/jalankan'), IZIN.OWNER);
});

test('hasil pemeriksaan adalah satu-satunya tulisan milik auditor', () => {
  assert.equal(izinDibutuhkan('POST', '/rekonsiliasi/transaksi/abc/rekon'), IZIN.PERIKSA);
  assert.equal(izinDibutuhkan('PUT', '/mekari/periksa/a|b'), IZIN.PERIKSA);
  assert.equal(izinDibutuhkan('POST', '/rekonsiliasi/audit/kecocokan/abc'), IZIN.PERIKSA);
});

test('pengguna dan jejak milik Owner walaupun GET', () => {
  for (const jalur of ['/pengguna', '/pengguna/abc', '/jejak', '/jejak/']) {
    assert.equal(izinDibutuhkan('GET', jalur), IZIN.OWNER, jalur);
  }
});

test('garis miring ganda tidak bisa dipakai melewati aturan', () => {
  assert.equal(rapikanJalur('//pengguna'), '/pengguna');
  assert.equal(rapikanJalur('/pengguna/'), '/pengguna');
  assert.equal(izinDibutuhkan('GET', '//pengguna'), IZIN.OWNER);
  assert.equal(izinDibutuhkan('GET', '/pengguna//'), IZIN.OWNER);
});

test('auditor tidak pernah memenuhi izin OWNER', () => {
  assert.equal(memenuhi(IZIN.OWNER, auditor), false);
  assert.equal(memenuhi(IZIN.OWNER, auditorPeriksa), false);
  assert.equal(memenuhi(IZIN.OWNER, owner), true);
});

test('menulis hasil pemeriksaan menuntut izin yang diberikan Owner', () => {
  assert.equal(memenuhi(IZIN.PERIKSA, auditor), false);
  assert.equal(memenuhi(IZIN.PERIKSA, auditorPeriksa), true);
  assert.equal(memenuhi(IZIN.PERIKSA, owner), true);
});

test('akun nonaktif tidak memenuhi apa pun, termasuk sebagai Owner', () => {
  for (const izin of [IZIN.SESI, IZIN.BACA, IZIN.PERIKSA, IZIN.OWNER]) {
    assert.equal(memenuhi(izin, nonaktif), false, izin);
  }
  // Tetapi pelacakan resi publik tidak terpengaruh sama sekali.
  assert.equal(memenuhi(IZIN.PUBLIK, nonaktif), true);
  assert.equal(memenuhi(IZIN.PUBLIK, null), true);
});

test('tanpa profil berarti tidak memenuhi apa pun selain publik', () => {
  assert.equal(memenuhi(IZIN.SESI, null), false);
  assert.equal(memenuhi(IZIN.BACA, undefined), false);
});

test('jalur publik dan sesi tidak ikut disaring entitas', () => {
  assert.equal(perluSaringEntitas(IZIN.PUBLIK), false);
  assert.equal(perluSaringEntitas(IZIN.SESI), false);
  assert.equal(perluSaringEntitas(IZIN.BACA), true);
  assert.equal(perluSaringEntitas(IZIN.OWNER), true);
});

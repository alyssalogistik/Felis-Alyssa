import test from 'node:test';
import assert from 'node:assert/strict';
import { KODE_ENTITAS } from '../src/rekonsiliasi/entitas.js';
import { entitasDiizinkan, saringanUntuk, bolehMenulis, melihatSemua } from '../src/akses/entitas-akses.js';

const PT = 'PT_ALYSSA_AUTO_LOGISTIK';
const CV = 'CV_ALYSSA_TRANS_UTAMA';

test('PENJAGA: penyaringan ini hanya benar selama entitasnya tepat dua', () => {
  // saringanUntuk() menerjemahkan "kosong" menjadi "tanpa filter" ketika
  // penggunanya boleh melihat SEMUA entitas, dan menjadi satu nilai ketika
  // hanya boleh melihat satu. Dengan tiga entitas, ada keadaan ketiga —
  // boleh melihat dua dari tiga — yang tidak bisa dinyatakan sebagai satu
  // nilai query, dan menjawabnya "tanpa filter" akan membocorkan perusahaan
  // yang bukan haknya. Uji ini gagal lebih dulu supaya itu tidak terjadi
  // diam-diam.
  assert.equal(KODE_ENTITAS.length, 2,
    'Entitas bertambah: saringanUntuk() harus diubah memakai daftar (.in), bukan satu nilai.');
});

test('Owner selalu mendapat seluruh perusahaan, apa pun isi kolomnya', () => {
  assert.deepEqual(entitasDiizinkan({ peran: 'OWNER', entitas_akses: [] }), KODE_ENTITAS);
  assert.deepEqual(entitasDiizinkan({ peran: 'OWNER', entitas_akses: [PT] }), KODE_ENTITAS);
});

test('auditor mendapat persis yang diberikan', () => {
  assert.deepEqual(entitasDiizinkan({ peran: 'AUDITOR', entitas_akses: [PT] }), [PT]);
  assert.deepEqual(entitasDiizinkan({ peran: 'AUDITOR', entitas_akses: [PT, CV] }), [PT, CV]);
  assert.deepEqual(entitasDiizinkan({ peran: 'AUDITOR', entitas_akses: ['NGAWUR'] }), []);
  assert.deepEqual(entitasDiizinkan(null), []);
});

test('filter kosong milik auditor PT menjadi PT, bukan seluruh perusahaan', () => {
  // Ini lubang yang ditutup lapisan ini: sebelumnya kosong berarti tanpa
  // filter, dan tanpa filter berarti CV ikut muncul.
  for (const kosong of ['', '   ', 'semua', 'Semua', undefined, null]) {
    const hasil = saringanUntuk(kosong, [PT]);
    assert.equal(hasil.ok, true);
    assert.equal(hasil.nilai, PT, `"${kosong}" seharusnya menjadi PT`);
  }
});

test('filter kosong milik pemegang dua entitas tetap berarti seluruhnya', () => {
  assert.deepEqual(saringanUntuk('', [PT, CV]), { ok: true, nilai: '' });
  assert.equal(melihatSemua([PT, CV]), true);
  assert.equal(melihatSemua([PT]), false);
});

test('meminta perusahaan di luar izin ditolak, bukan dibelokkan diam-diam', () => {
  const hasil = saringanUntuk(CV, [PT]);
  assert.equal(hasil.ok, false);
  assert.match(hasil.alasan, /tidak punya akses/i);
});

test('perusahaan yang tidak dikenali ditolak, bukan jatuh ke semua', () => {
  const hasil = saringanUntuk('PT_SALAH_KETIK', [PT, CV]);
  assert.equal(hasil.ok, false);
  assert.match(hasil.alasan, /tidak dikenali/i);
});

test('akun tanpa akses perusahaan ditolak dengan pesan yang bisa ditindaklanjuti', () => {
  const hasil = saringanUntuk('', []);
  assert.equal(hasil.ok, false);
  assert.match(hasil.alasan, /belum diberi akses/i);
});

test('menulis atas nama perusahaan lain ditolak', () => {
  assert.equal(bolehMenulis(CV, [PT]).ok, false);
  assert.equal(bolehMenulis(PT, [PT]).ok, true);
  assert.equal(bolehMenulis(PT, [PT, CV]).ok, true);
});

test('menulis tanpa menyebut perusahaan diserahkan ke aturan lama', () => {
  // Modul rekonsiliasi sudah menolak entitas kosong dengan pesan yang jauh
  // lebih berguna. Lapisan izin tidak perlu mendahuluinya.
  assert.deepEqual(bolehMenulis('', [PT]), { ok: true, nilai: null });
  assert.deepEqual(bolehMenulis('NGAWUR', [PT]), { ok: true, nilai: null });
});

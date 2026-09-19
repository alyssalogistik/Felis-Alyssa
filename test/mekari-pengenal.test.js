import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalkan, tokenBerangka, konteksToken, ambangJarang, bubuhiPengenal,
} from '../src/mekari/pengenal.js';

test('normalkan menyeragamkan huruf dan tanda baca', () => {
  assert.equal(normalkan('  Toyota-Avanza,  B 1054 DKN '), 'TOYOTA AVANZA B 1054 DKN');
  assert.equal(normalkan(null), '');
});

test('token berangka mengabaikan kata tanpa angka dan yang terlalu pendek', () => {
  assert.deepEqual(tokenBerangka('AVANZA B 1054 DKN'), ['1054']);
  assert.deepEqual(tokenBerangka('SEDAN MK2KRWPNURJ004740'), ['MK2KRWPNURJ004740']);
  // "B" berangka nol dan hanya satu huruf; "12" terlalu pendek.
  assert.deepEqual(tokenBerangka('MOBIL B 12 XY'), []);
});

test('konteks membedakan dua nomor yang angkanya kebetulan sama', () => {
  const a = konteksToken('AVANZA B 1104 DKN');
  const b = konteksToken('AVANZA B 1104 DKM');
  assert.equal(a.get('1104'), 'B 1104 DKN');
  assert.equal(b.get('1104'), 'B 1104 DKM');
  assert.notEqual(a.get('1104'), b.get('1104'));
});

test('ambang kejarangan ikut besar batch, dengan lantai 2', () => {
  assert.equal(ambangJarang(10), 2);
  assert.equal(ambangJarang(100), 2);
  assert.equal(ambangJarang(1000), 20);
});

test('token yang muncul di mana-mana bukan pengenal', () => {
  // "2025" ada di setiap baris: itu tahun, bukan penunjuk barang tertentu.
  const baris = Array.from({ length: 50 }, (_, i) => ({
    keterangan: `KONTRAK 2025 NOMOR SN${1000 + i}`,
  }));
  const hasil = bubuhiPengenal(baris);
  assert.ok(!hasil[0].pengenal.includes('2025'), '2025 seharusnya terlalu umum');
  assert.ok(hasil[0].pengenal.includes('SN1000'));
});

test('aturannya bekerja pada data yang bukan kendaraan', () => {
  const baris = [
    { keterangan: 'Servis genset SN GEN-77421 rutin 500 jam' },
    { keterangan: 'Lisensi ERP kontrak KTR/2025/0087' },
    { keterangan: 'Sewa gudang Blok C' },
  ];
  const hasil = bubuhiPengenal(baris);
  assert.ok(hasil[0].pengenal.includes('77421'), 'nomor seri genset harus terbaca');
  assert.ok(hasil[1].pengenal.includes('0087'), 'nomor kontrak harus terbaca');
  assert.deepEqual(hasil[2].pengenal, [], 'sewa gudang tidak punya penunjuk barang');
});

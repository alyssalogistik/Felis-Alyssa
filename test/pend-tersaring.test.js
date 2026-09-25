import test from 'node:test';
import assert from 'node:assert/strict';
import { menyaringTanggal } from '../src/rekonsiliasi/saringan.js';

test('kriteria bertanggal dikenali dari empat bentuknya', () => {
  assert.equal(menyaringTanggal({ dari: '2026-09-15' }), true);
  assert.equal(menyaringTanggal({ sampai: '2026-09-24' }), true);
  assert.equal(menyaringTanggal({ bulan: 9 }), true);
  assert.equal(menyaringTanggal({ tahun: 2026 }), true);
  assert.equal(menyaringTanggal({ dari: '2026-09-15', sampai: '2026-09-24', bulan: 9, tahun: 2026 }), true);
});

test('tanpa penyaringan tanggal, blok PEND terpisah tidak diperlukan', () => {
  // Baris PEND sudah ikut di daftar utama dan diurutkan paling atas; menarik
  // blok terpisah hanya akan menampilkannya dua kali.
  assert.equal(menyaringTanggal({}), false);
  assert.equal(menyaringTanggal({ cari: 'MARTHEN' }), false);
  assert.equal(menyaringTanggal({ dari: null, sampai: null, bulan: null, tahun: null }), false);
  assert.equal(menyaringTanggal({ entitas: 'PT_ALYSSA_AUTO_LOGISTIK', hanya_debit: true }), false);
});

test('bulan nol dihitung sebagai penyaringan, bukan diabaikan', () => {
  // Bulan 0 tidak sah sebagai bulan, tapi kalau sampai masuk, memperlakukannya
  // sebagai "tidak menyaring" akan menampilkan blok PEND yang dobel.
  assert.equal(menyaringTanggal({ bulan: 0 }), true);
  assert.equal(menyaringTanggal({ tahun: 0 }), true);
});

test('string kosong bukan penyaringan tanggal', () => {
  assert.equal(menyaringTanggal({ dari: '', sampai: '' }), false);
});

import { peringatanPending } from '../src/rekonsiliasi/laporan.js';

test('laporan tanpa transaksi belum-dibukukan tidak memuat peringatan', () => {
  assert.equal(peringatanPending(null), null);
  assert.equal(peringatanPending({ jumlah: 0, data: [], debit: 0 }), null);
});

test('peringatan menyebut jumlah dan nilainya, bukan sekadar "ada yang tidak termasuk"', () => {
  // Angka ini dari cetakan sungguhan: mutasi 17-24 September memuat 13
  // transaksi belum dibukukan senilai Rp 5.912.500.
  const pesan = peringatanPending({ jumlah: 13, debit: 5912500 });
  assert.match(pesan, /13 transaksi/);
  assert.match(pesan, /5\.912\.500/);
  assert.match(pesan, /TIDAK termasuk/);
});

test('jumlah bisa disimpulkan dari barisnya bila tidak dikirim terpisah', () => {
  const pesan = peringatanPending({ data: [{ debit: 1 }, { debit: 2 }], debit: 3 });
  assert.match(pesan, /2 transaksi/);
});

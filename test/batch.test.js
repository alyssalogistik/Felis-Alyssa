// Aturan satu batch impor rekening koran.
//
// Modulnya murni dan dipakai apa adanya oleh peramban, jadi yang diuji di sini
// benar-benar kode yang berjalan — bukan salinannya.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAKS_BERKAS, PESAN_TERLALU_PANJANG, namaPeriode, urutkanPeriode,
  rentangBulan, periksaBatch, ringkasBatch,
} from '../public/batch.js';

const berkas = (nama, bulan, tahun) => ({ nama, periode: bulan ? { bulan, tahun } : null });

/** April 2025 sampai Maret 2026. */
const DUA_BELAS = [
  berkas('apr.pdf', 4, 2025), berkas('mei.pdf', 5, 2025), berkas('jun.pdf', 6, 2025),
  berkas('jul.pdf', 7, 2025), berkas('agu.pdf', 8, 2025), berkas('sep.pdf', 9, 2025),
  berkas('okt.pdf', 10, 2025), berkas('nov.pdf', 11, 2025), berkas('des.pdf', 12, 2025),
  berkas('jan.pdf', 1, 2026), berkas('feb.pdf', 2, 2026), berkas('mar.pdf', 3, 2026),
];

test('periode ditulis dalam bahasa Indonesia', () => {
  assert.equal(namaPeriode({ bulan: 8, tahun: 2026 }), 'Agustus 2026');
  assert.equal(namaPeriode(null), 'Periode tidak dikenali');
});

test('SKENARIO: urutan pilih berkas tidak menentukan urutan proses', () => {
  const acak = [
    berkas('nov.pdf', 11, 2025),
    berkas('apr.pdf', 4, 2025),
    berkas('jan.pdf', 1, 2026),
    berkas('mei.pdf', 5, 2025),
  ];
  assert.deepEqual(
    urutkanPeriode(acak).map((b) => b.nama),
    ['apr.pdf', 'mei.pdf', 'nov.pdf', 'jan.pdf']
  );
});

test('pergantian tahun tetap urut, bukan diurutkan per bulan saja', () => {
  const lintas = [berkas('jan.pdf', 1, 2026), berkas('des.pdf', 12, 2025)];
  assert.deepEqual(urutkanPeriode(lintas).map((b) => b.nama), ['des.pdf', 'jan.pdf']);
});

test('berkas yang periodenya tidak terbaca diletakkan di belakang, bukan dibuang', () => {
  const campur = [berkas('rusak.pdf', null), berkas('apr.pdf', 4, 2025)];
  const urut = urutkanPeriode(campur);
  assert.equal(urut.length, 2, 'tidak ada yang hilang');
  assert.equal(urut[0].nama, 'apr.pdf');
  assert.equal(urut[1].nama, 'rusak.pdf');
});

test('rentang dihitung inklusif: April 2025 sampai Maret 2026 adalah 12 bulan', () => {
  const r = rentangBulan(DUA_BELAS);
  assert.equal(r.bulan, 12);
  assert.deepEqual(r.awal, { bulan: 4, tahun: 2025 });
  assert.deepEqual(r.akhir, { bulan: 3, tahun: 2026 });
});

test('satu berkas adalah satu bulan, bukan nol', () => {
  assert.equal(rentangBulan([berkas('agu.pdf', 8, 2026)]).bulan, 1);
});

test('SKENARIO A: dua belas bulan diterima', () => {
  const hasil = periksaBatch(DUA_BELAS);
  assert.equal(hasil.boleh, true);
  assert.equal(hasil.rentang.bulan, 12);
  assert.deepEqual(hasil.urut.map((b) => b.nama)[0], 'apr.pdf');
  assert.deepEqual(hasil.urut.map((b) => b.nama).at(-1), 'mar.pdf');
});

test('SKENARIO D: April 2025 sampai April 2026 ditolak karena 13 bulan', () => {
  // Hanya dua berkas, tetapi rentangnya tiga belas bulan. Yang dibatasi adalah
  // periodenya, bukan banyaknya berkas.
  const hasil = periksaBatch([berkas('apr25.pdf', 4, 2025), berkas('apr26.pdf', 4, 2026)]);
  assert.equal(hasil.boleh, false);
  assert.equal(hasil.alasan, PESAN_TERLALU_PANJANG);
  assert.equal(hasil.rentang.bulan, 13);
});

test('lebih dari dua belas berkas ditolak', () => {
  const banyak = [...DUA_BELAS, berkas('apr26.pdf', 4, 2026)];
  const hasil = periksaBatch(banyak);
  assert.equal(hasil.boleh, false);
  assert.match(hasil.alasan, new RegExp(String(MAKS_BERKAS)));
});

test('dua belas berkas untuk bulan yang sama tetap diterima', () => {
  // Batasnya rentang periode, bukan keragamannya. Satu bulan yang terpecah ke
  // beberapa berkas adalah hal yang wajar.
  const sama = Array.from({ length: 12 }, (_, i) => berkas(`bagian-${i}.pdf`, 8, 2026));
  assert.equal(periksaBatch(sama).boleh, true);
});

test('batch kosong ditolak dengan sebab yang jelas', () => {
  assert.equal(periksaBatch([]).boleh, false);
  assert.match(periksaBatch([]).alasan, /Tidak ada berkas/);
});

test('ringkasan batch menjumlahkan seluruh berkas', () => {
  const hasil = [
    { dibaca: 164, baru: 164, sudah_ada: 0, perlu_diperiksa: 0, status: 'selesai' },
    { dibaca: 172, baru: 170, sudah_ada: 2, perlu_diperiksa: 1, status: 'sebagian' },
    { dibaca: 164, baru: 0, sudah_ada: 164, perlu_diperiksa: 0, status: 'duplikat' },
  ];
  assert.deepEqual(ringkasBatch(hasil), {
    berkas: 3, dibaca: 500, baru: 334, sudah_ada: 166, perlu_diperiksa: 1, gagal: 0,
  });
});

test('berkas yang gagal ikut terhitung, tidak disembunyikan', () => {
  const hasil = [
    { dibaca: 10, baru: 10, sudah_ada: 0, perlu_diperiksa: 0, status: 'selesai' },
    { dibaca: 0, baru: 0, sudah_ada: 0, perlu_diperiksa: 0, status: 'gagal' },
  ];
  assert.equal(ringkasBatch(hasil).gagal, 1);
  assert.equal(ringkasBatch(hasil).berkas, 2);
});

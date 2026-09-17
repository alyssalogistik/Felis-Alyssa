// Pelunasan transaksi PEND.
//
// Yang diuji di sini keputusannya: baris PEND mana yang boleh diisi tanggalnya
// oleh berkas berikutnya. Salah memutuskan berarti menempelkan tanggal yang
// salah pada uang yang benar-benar keluar, atau membiarkan satu transfer
// terhitung dua kali.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cocokkanPending, pendingSudahDibukukan } from '../src/rekonsiliasi/pending.js';
import { bacaRekeningKoran } from '../src/rekonsiliasi/baca.js';

const berkas = (nama) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'berkas', nama));

const pend = (ubah = {}) => ({
  id: 'p1', tanggal: null, no_rekening: '0071234567',
  keterangan: 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB',
  debit: 700000, kredit: 0, saldo: 12892305, ...ubah,
});

const final = (ubah = {}) => ({
  tanggal: '2026-09-04', no_rekening: '0071234567',
  keterangan: 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB',
  debit: 700000, kredit: 0, saldo: 12892305, ...ubah,
});

// --- Pencocokan yang benar --------------------------------------------------

test('baris PEND dilunasi oleh versi bertanggalnya', () => {
  const { promosi, ragu } = cocokkanPending([pend()], [final()]);
  assert.deepEqual(promosi, [{ id: 'p1', tanggal: '2026-09-04' }]);
  assert.deepEqual(ragu, []);
});

test('huruf besar-kecil dan spasi ganda tidak menggagalkan pencocokan', () => {
  // Diseragamkan dengan cara yang sama persis dengan kolom `sidik` di database.
  const { promosi } = cocokkanPending(
    [pend({ keterangan: 'BI-FAST DB  TRANSFER KE 008   HERMANSYAH KBB' })],
    [final({ keterangan: 'bi-fast db transfer ke 008 hermansyah kbb' })]
  );
  assert.equal(promosi.length, 1);
});

test('baris PEND yang belum muncul lagi dibiarkan apa adanya', () => {
  const { promosi, ragu } = cocokkanPending([pend()], [final({ debit: 700001 })]);
  assert.deepEqual(promosi, []);
  assert.deepEqual(ragu, []);
});

// --- Yang tidak boleh dicocokkan --------------------------------------------

test('KAIDAH: nominal berbeda tidak pernah dianggap transaksi yang sama', () => {
  assert.equal(cocokkanPending([pend()], [final({ debit: 70000 })]).promosi.length, 0);
});

test('KAIDAH: rekening berbeda tidak pernah dicocokkan', () => {
  // Dua rekening bisa punya transfer serupa ke penerima yang sama.
  assert.equal(cocokkanPending([pend()], [final({ no_rekening: '0079999999' })]).promosi.length, 0);
});

test('KAIDAH: saldo berjalan berbeda tidak dicocokkan', () => {
  // Saldo berjalan satu-satunya pembeda dua transfer bernominal sama ke
  // penerima sama pada hari yang sama.
  assert.equal(cocokkanPending([pend()], [final({ saldo: 12892306 })]).promosi.length, 0);
});

test('KAIDAH: arah uang berbeda tidak dicocokkan', () => {
  assert.equal(
    cocokkanPending([pend()], [final({ debit: 0, kredit: 700000 })]).promosi.length,
    0
  );
});

test('transaksi baru yang juga tanpa tanggal tidak melunasi apa pun', () => {
  // Dua baris PEND dari dua unggahan bukan pelunasan; keduanya masih menunggu.
  assert.equal(cocokkanPending([pend()], [final({ tanggal: null })]).promosi.length, 0);
});

test('baris yang sudah bertanggal tidak pernah menjadi sasaran pelunasan', () => {
  // Tanggal yang sudah benar tidak boleh tertimpa oleh tebakan.
  assert.equal(cocokkanPending([pend({ tanggal: '2026-09-01' })], [final()]).promosi.length, 0);
});

// --- Yang meragukan ---------------------------------------------------------

test('KAIDAH: dua kandidat yang sama persis dilaporkan, bukan ditebak', () => {
  const { promosi, ragu } = cocokkanPending(
    [pend({ id: 'p1' }), pend({ id: 'p2' })],
    [final()]
  );
  assert.deepEqual(promosi, [], 'tidak ada yang boleh dilunasi saat ragu');
  assert.equal(ragu.length, 1);
  assert.equal(ragu[0].pending, 2);
  assert.equal(ragu[0].bertanggal, 1);
  assert.equal(ragu[0].debit, 700000);
});

test('satu PEND dengan dua transaksi baru yang identik juga dilaporkan', () => {
  const { promosi, ragu } = cocokkanPending(
    [pend()],
    [final({ tanggal: '2026-09-04' }), final({ tanggal: '2026-09-05' })]
  );
  assert.deepEqual(promosi, []);
  assert.equal(ragu[0].bertanggal, 2);
});

test('yang ragu tidak menghalangi yang jelas', () => {
  const jelas = pend({ id: 'jelas', debit: 250000, saldo: 8250000, keterangan: 'TRSF E-BANKING DB ULPAH' });
  const { promosi, ragu } = cocokkanPending(
    [pend({ id: 'a' }), pend({ id: 'b' }), jelas],
    [final(), final({ debit: 250000, saldo: 8250000, keterangan: 'TRSF E-BANKING DB ULPAH', tanggal: '2026-09-06' })]
  );
  assert.deepEqual(promosi, [{ id: 'jelas', tanggal: '2026-09-06' }]);
  assert.equal(ragu.length, 1);
});

// --- Terhadap berkas sungguhan ----------------------------------------------

test('SKENARIO: mutasi berikutnya membukukan transaksi PEND mutasi sebelumnya', async () => {
  // Inilah alur yang benar-benar terjadi: 1-3 September diunggah dengan satu
  // transaksi masih PEND, lalu 4-5 September memuat transaksi yang sama dengan
  // tanggal sungguhannya. Tanpa pelunasan ini keduanya tersimpan berdampingan
  // — sidik jarinya berbeda justru karena tanggalnya berbeda — dan satu
  // transfer 700.000 terhitung dua kali.
  const awal = await bacaRekeningKoran(berkas('bca-mutasi-harian.pdf'), 'harian.pdf');
  const lanjut = await bacaRekeningKoran(berkas('bca-mutasi-lanjutan.pdf'), 'lanjutan.pdf');

  const tersimpan = awal.transaksi
    .filter((t) => t.tanggal === null)
    .map((t, i) => ({ ...t, id: `x${i}`, no_rekening: awal.noRekening }));

  const bertanggal = lanjut.transaksi.map((t) => ({ ...t, no_rekening: lanjut.noRekening }));

  const { promosi, ragu } = cocokkanPending(tersimpan, bertanggal);
  assert.equal(promosi.length, 1);
  assert.equal(promosi[0].tanggal, '2026-09-04');
  assert.deepEqual(ragu, []);
});

test('transaksi lain pada berkas lanjutan tidak ikut melunasi apa pun', async () => {
  const awal = await bacaRekeningKoran(berkas('bca-mutasi-harian.pdf'), 'harian.pdf');
  const lanjut = await bacaRekeningKoran(berkas('bca-mutasi-lanjutan.pdf'), 'lanjutan.pdf');

  // Seluruh baris awal, termasuk yang sudah bertanggal, ditawarkan sebagai
  // kandidat. Hanya yang tanggalnya kosong yang boleh terpilih.
  const tersimpan = awal.transaksi.map((t, i) => ({ ...t, id: `x${i}`, no_rekening: awal.noRekening }));
  const { promosi } = cocokkanPending(tersimpan, lanjut.transaksi.map((t) => ({ ...t, no_rekening: lanjut.noRekening })));

  assert.equal(promosi.length, 1, 'hanya baris PEND yang dilunasi');
});

// --- Arah kebalikannya: baris PEND yang sudah telanjur dibukukan ------------

test('KAIDAH: baris PEND yang transaksinya sudah tersimpan bertanggal dilewati', () => {
  // Terjadi saat berkas lama diunggah lagi — misalnya satu PDF gabungan yang
  // memuat cetakan lama beserta baris PEND-nya. Sidik jari tidak menahannya,
  // karena yang tersimpan bertanggal dan yang baru tidak.
  const baruPend = { tanggal: null, keterangan: pend().keterangan, debit: 700000, kredit: 0, saldo: 12892305 };
  const dilewati = pendingSudahDibukukan([final()], [baruPend], '0071234567');
  assert.deepEqual(dilewati, [baruPend]);
});

test('objek yang dikembalikan objek aslinya, bukan salinannya', () => {
  // Pemanggilnya mengenali baris yang harus dilewati dari identitasnya; salinan
  // membuat penyaringnya diam-diam tidak melakukan apa-apa.
  const baruPend = { tanggal: null, keterangan: pend().keterangan, debit: 700000, kredit: 0, saldo: 12892305 };
  assert.equal(pendingSudahDibukukan([final()], [baruPend], '0071234567')[0], baruPend);
});

test('baris PEND yang belum pernah dibukukan tetap disisipkan', () => {
  const baruPend = { tanggal: null, keterangan: 'TRANSFER KE 002 ORANG LAIN', debit: 50000, kredit: 0, saldo: 99 };
  assert.deepEqual(pendingSudahDibukukan([final()], [baruPend], '0071234567'), []);
});

test('transaksi baru yang sudah bertanggal tidak pernah ikut dilewati', () => {
  // Melewatkan transaksi sungguhan jauh lebih berbahaya daripada menyisipkan
  // satu baris yang nanti ketahuan kembar.
  assert.deepEqual(pendingSudahDibukukan([final()], [final()], '0071234567'), []);
});

test('dua baris tersimpan yang sama persis membuat penyaringnya mengalah', () => {
  // Kalau tidak bisa dipastikan yang mana, barisnya tetap disisipkan dan
  // kembarnya terlihat — bukan dibuang diam-diam.
  const baruPend = { tanggal: null, keterangan: pend().keterangan, debit: 700000, kredit: 0, saldo: 12892305 };
  assert.deepEqual(
    pendingSudahDibukukan([final(), final({ tanggal: '2026-09-05' })], [baruPend], '0071234567'),
    []
  );
});

test('SKENARIO: PEND dan versi bukunya datang dalam satu berkas yang sama', async () => {
  const hasil = await bacaRekeningKoran(berkas('bca-mutasi-gabungan-pend.pdf'), 'gabungan.pdf');
  const dilewati = pendingSudahDibukukan(
    hasil.transaksi.filter((t) => t.tanggal),
    hasil.transaksi.filter((t) => !t.tanggal),
    hasil.noRekening
  );
  assert.equal(dilewati.length, 1);
  assert.equal(dilewati[0].debit, 700000);
});

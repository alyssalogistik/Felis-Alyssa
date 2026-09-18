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
import { cocokkanPending, intiKeterangan, sudahTersimpan } from '../src/rekonsiliasi/pending.js';
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

// --- Kalimat yang berbeda untuk transaksi yang sama --------------------------

test('KAIDAH: awalan jenis transaksi kedua cetakan diseragamkan', () => {
  // Inilah satu-satunya yang berbeda di antara kedua cetakan BCA; sisa
  // kalimatnya sama persis. Tanpa penyeragaman ini, transaksi yang sama dari
  // dua cetakan tidak pernah bisa dikenali sebagai satu transaksi.
  const sama = (a, b) => assert.equal(intiKeterangan(a), intiKeterangan(b), `${a}  !=  ${b}`);
  sama('BIF TRANSFER KE 008 HERMANSYAH KBB', 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB');
  sama('BIF BIAYA TXN KE 002 RUDI KBB', 'BI-FAST DB BIAYA TXN KE 002 RUDI KBB');
  sama('BIF TRANSFER DR 016 INMAG KONSTRUKSI I', 'BI-FAST CR TRANSFER DR 016 INMAG KONSTRUKSI I');
  sama('0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL',
       'TRSF E-BANKING DB 0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL');
});

test('yang bukan awalan jenis tidak ikut terkupas', () => {
  assert.equal(intiKeterangan('BIAYA ADM'), 'biaya adm');
  assert.notEqual(intiKeterangan('BIAYA ADM'), intiKeterangan('BIAYA ADMIN'));
  assert.equal(intiKeterangan('SETORAN TUNAI'), 'setoran tunai');
});

test('keterangan yang isinya hanya awalan tidak dikosongkan', () => {
  // Kunci berketerangan kosong akan cocok dengan sembarang baris lain yang juga
  // kosong, dan penahannya tinggal saldo saja.
  assert.equal(intiKeterangan('BIF'), 'bif');
  assert.equal(intiKeterangan('BI-FAST DB'), 'bi-fast db');
});

test('pencocokan PEND bekerja menyeberang format', () => {
  const tersimpan = [pend({ keterangan: 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB' })];
  const baru = [final({ keterangan: 'BIF TRANSFER KE 008 HERMANSYAH KBB' })];
  assert.deepEqual(cocokkanPending(tersimpan, baru), { promosi: [{ id: 'p1', tanggal: '2026-09-04' }], ragu: [] });
});

// --- Transaksi yang sudah tersimpan dari cetakan lain ------------------------

const barisBaru = (ubah = {}) => ({
  tanggal: '2026-09-04', keterangan: 'BIF TRANSFER KE 008 HERMANSYAH KBB',
  debit: 700000, kredit: 0, saldo: 12892305, ...ubah,
});

test('KAIDAH: baris bertanggal yang sudah tersimpan dari cetakan lain dilewati', () => {
  const b = barisBaru();
  assert.deepEqual(sudahTersimpan([final()], [b], '0071234567'), [b]);
});

test('KAIDAH: tanggal yang berbeda berarti transaksi yang berbeda', () => {
  // Dua transfer serupa pada dua hari berbeda adalah dua transaksi sungguhan.
  assert.deepEqual(sudahTersimpan([final()], [barisBaru({ tanggal: '2026-09-05' })], '0071234567'), []);
});

test('baris PEND baru dilewati bila versi bertanggalnya sudah tersimpan', () => {
  const b = barisBaru({ tanggal: null });
  assert.deepEqual(sudahTersimpan([final()], [b], '0071234567'), [b]);
});

test('objek yang dikembalikan objek aslinya, bukan salinannya', () => {
  // Pemanggilnya mengenali baris yang harus dilewati dari identitasnya; salinan
  // membuat penyaringnya diam-diam tidak melakukan apa-apa, dan seluruh
  // penjagaan ini berubah menjadi hiasan.
  const b = barisBaru();
  assert.equal(sudahTersimpan([final()], [b], '0071234567')[0], b);
});

test('KAIDAH: saldo berjalan yang berbeda tidak pernah dilewati', () => {
  // Saldo berjalan satu-satunya penahan kunci ini. Nominal dan penerima boleh
  // sama persis; saldo tidak pernah sama untuk dua transaksi berbeda.
  assert.deepEqual(sudahTersimpan([final()], [barisBaru({ saldo: 12892306 })], '0071234567'), []);
});

test('KAIDAH: baris tanpa saldo tidak pernah dilewati', () => {
  // Tanpa saldo penahannya hilang, dan dua transfer sungguhan yang mirip bisa
  // saling menghapus.
  assert.deepEqual(sudahTersimpan([final({ saldo: null })], [barisBaru({ saldo: null })], '0071234567'), []);
});

test('KAIDAH: baris tanpa nominal tidak pernah dilewati', () => {
  // Baris bernominal nol bukan uang melainkan sisa kop yang lolos penguraian;
  // dua di antaranya bisa tampak sama persis tanpa benar-benar transaksi sama.
  const kosong = { tanggal: '2026-04-01', keterangan: '', debit: 0, kredit: 0, saldo: 1190800 };
  assert.deepEqual(sudahTersimpan([kosong], [{ ...kosong }], '0072890271'), []);
});

test('KAIDAH: dua kandidat tersimpan yang sama persis membuat penyaringnya mengalah', () => {
  // Kalau tidak bisa dipastikan yang mana, barisnya tetap disisipkan dan
  // kembarnya terlihat — melewatkan transaksi sungguhan jauh lebih berbahaya.
  assert.deepEqual(
    sudahTersimpan([final(), final({ keterangan: 'BIF TRANSFER KE 008 HERMANSYAH KBB' })],
      [barisBaru()], '0071234567'),
    []
  );
});

test('rekening berbeda tidak pernah dilewati', () => {
  assert.deepEqual(
    sudahTersimpan([final({ no_rekening: '0079999999' })], [barisBaru()], '0071234567'),
    []
  );
});

// --- Terhadap berkas sungguhan ----------------------------------------------

test('SKENARIO: mutasi harian lalu e-statement, kalimatnya berbeda', async () => {
  const mutasi = await bacaRekeningKoran(berkas('lintas-mutasi.pdf'), 'mutasi.pdf');
  const est = await bacaRekeningKoran(berkas('lintas-estatement.pdf'), 'est.pdf');

  const tersimpan = mutasi.transaksi.map((t, i) => ({ ...t, id: `x${i}`, no_rekening: mutasi.noRekening }));

  // Dua baris PEND dilunasi oleh versi bertanggalnya di e-statement.
  const { promosi, ragu } = cocokkanPending(tersimpan, est.transaksi, est.noRekening);
  assert.equal(promosi.length, 2, 'kedua baris PEND terpasangkan');
  assert.deepEqual(ragu, []);

  // Dua baris yang sudah bertanggal dikenali sebagai transaksi yang sama.
  const dilewati = sudahTersimpan(tersimpan, est.transaksi, est.noRekening);
  assert.equal(dilewati.length, 2, 'dua baris bertanggal dikenali sudah ada');
});

test('SKENARIO: berkas yang tidak beririsan tidak kehilangan satu baris pun', async () => {
  // Penjaga arah sebaliknya. Penyaring yang terlalu rajin akan membuang
  // transaksi sungguhan, dan itu jauh lebih berbahaya daripada satu baris
  // kembar yang terlihat.
  const a = await bacaRekeningKoran(berkas('bca-mutasi-harian.pdf'), 'a.pdf');
  const b = await bacaRekeningKoran(berkas('bca-mutasi-lanjutan.pdf'), 'b.pdf');
  const tersimpan = a.transaksi.filter((t) => t.tanggal).map((t, i) => ({ ...t, id: `y${i}`, no_rekening: a.noRekening }));
  assert.deepEqual(sudahTersimpan(tersimpan, b.transaksi, b.noRekening), []);
});

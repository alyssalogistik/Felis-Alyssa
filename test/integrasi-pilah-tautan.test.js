import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sudahTertaut, pilahPilihan, ringkasTertaut, kalimatTertaut, layakDikoreksi,
  SEBAB_KOREKSI, LABEL_STATUS_TAUTAN,
} from '../src/integrasi/pilah-tautan.js';
import { STATUS } from '../src/integrasi/tautan.js';

const tautan = (id, status, supplier_id = '0c2408c0', supplier_nama = 'AHMAD TAUFDIQ') =>
  ({ transaksi_id: id, status, supplier_id, supplier_nama });

test('PENJAGA: teks status di pilah-tautan.js sama persis dengan STATUS di tautan.js', () => {
  // Berkas ini dimuat peramban tanpa mengimpor modul server, jadi statusnya
  // ditulis sebagai teks. Kalau STATUS berubah dan teks ini tidak, layar dan
  // server akan memutuskan hal berbeda tanpa satu pun galat.
  assert.equal(sudahTertaut({ status: STATUS.DIBATALKAN }), false);
  for (const s of [STATUS.SIAP, STATUS.DITARIK, STATUS.PERLU_KOREKSI_HILIR]) {
    assert.equal(sudahTertaut({ status: s }), true, s);
  }
  assert.deepEqual(
    Object.keys(LABEL_STATUS_TAUTAN).sort(),
    [STATUS.SIAP, STATUS.DITARIK, STATUS.PERLU_KOREKSI_HILIR, 'menunggu_lepas'].sort()
  );
  assert.equal(layakDikoreksi(tautan('a', STATUS.SIAP), { supplier_id: 'ffffffff' }).ok, true);
  assert.equal(layakDikoreksi(tautan('a', STATUS.DITARIK), { supplier_id: 'ffffffff' }).ok, true);
  assert.equal(layakDikoreksi(tautan('a', STATUS.DIBATALKAN), { supplier_id: 'ffffffff' }).sebab, SEBAB_KOREKSI.DIBATALKAN);
  assert.equal(layakDikoreksi(tautan('a', STATUS.PERLU_KOREKSI_HILIR), { supplier_id: 'ffffffff' }).sebab, SEBAB_KOREKSI.MENUNGGU_KOREKSI);
});

test('pilahPilihan: tanpa tautan atau dibatalkan = bebas; selain itu = tertaut', () => {
  const hasil = pilahPilihan(['a', 'b', 'c', 'd'], [
    tautan('a', 'ditarik'), tautan('b', 'dibatalkan'), tautan('c', 'siap'),
  ]);
  assert.deepEqual(hasil.bebas, ['b', 'd']);
  assert.deepEqual(hasil.tertaut.map((t) => t.transaksi_id), ['a', 'c']);
});

test('pilahPilihan: masukan kosong atau tidak ada tautan sama sekali', () => {
  assert.deepEqual(pilahPilihan([], []), { bebas: [], tertaut: [] });
  assert.deepEqual(pilahPilihan(['x'], undefined), { bebas: ['x'], tertaut: [] });
});

test('SATU kalimat untuk tiga belas yang sudah tertaut, bukan tiga belas galat', () => {
  const tertaut = Array.from({ length: 13 }, (_, i) => tautan(`id${i}`, 'ditarik'));
  const kalimat = kalimatTertaut(tertaut, 13);
  assert.match(kalimat, /^13 dari 13 transaksi terpilih sudah tertaut: /);
  assert.match(kalimat, /13 ke AHMAD TAUFDIQ \(0c2408c0\), sudah ditarik alyssa-dev\./);
  assert.equal(kalimat.split('\n').length, 1);
});

test('campuran bebas dan tertaut: yang tertaut dilewati dan disebut', () => {
  const kalimat = kalimatTertaut([tautan('a', 'ditarik')], 3);
  assert.match(kalimat, /^1 dari 3 transaksi terpilih sudah tertaut dan dilewati: /);
  assert.equal(kalimatTertaut([], 3), '');
});

test('ringkasTertaut mengelompokkan per supplier dan status, terbanyak dulu', () => {
  const r = ringkasTertaut([
    tautan('1', 'ditarik'), tautan('2', 'ditarik'), tautan('3', 'siap'),
    tautan('4', 'ditarik', '73e746fc', 'AHMAD T'),
  ]);
  assert.deepEqual(r.map((k) => [k.supplier_id, k.status, k.jumlah]), [
    ['0c2408c0', 'ditarik', 2], ['0c2408c0', 'siap', 1], ['73e746fc', 'ditarik', 1],
  ]);
});

test('koreksi ke supplier_id yang SAMA ditolak: bukan koreksi', () => {
  const h = layakDikoreksi(tautan('a', 'ditarik'), { supplier_id: '0c2408c0' });
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB_KOREKSI.SUDAH_SAMA);
  assert.match(h.pesan, /0c2408c0/);
  assert.match(h.pesan, /Tidak ada yang perlu dikoreksi/);
  // huruf besar dari isian tidak membuatnya lolos
  assert.equal(layakDikoreksi(tautan('a', 'ditarik'), { supplier_id: '0C2408C0' }).sebab, SEBAB_KOREKSI.SUDAH_SAMA);
});

test('koreksi kedua saat yang pertama BELUM diakui ditolak (tidak ada supplier perantara)', () => {
  const h = layakDikoreksi(tautan('a', 'perlu_koreksi_hilir', '73e746fc'), { supplier_id: 'aaaaaaaa' });
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB_KOREKSI.MENUNGGU_KOREKSI);
  assert.match(h.pesan, /perantara/);
});

test('koreksi: yang belum ditarik langsung, yang sudah ditarik lewat alyssa-dev', () => {
  assert.deepEqual(layakDikoreksi(tautan('a', 'siap'), { supplier_id: 'ffffffff' }), { ok: true, langsung: true });
  assert.deepEqual(layakDikoreksi(tautan('a', 'ditarik'), { supplier_id: 'ffffffff' }), { ok: true, langsung: false });
});

test('koreksi: tautan tidak ada dan sedang menunggu pelepasan', () => {
  assert.equal(layakDikoreksi(null, { supplier_id: 'ffffffff' }).sebab, SEBAB_KOREKSI.TIDAK_ADA);
  assert.equal(layakDikoreksi(tautan('a', 'menunggu_lepas'), { supplier_id: 'ffffffff' }).sebab, SEBAB_KOREKSI.MENUNGGU_LEPAS);
});

// --- satukanKembar: wakil yang hanya salinan -------------------------------

import { satukanKembar, kalimatKembar } from '../src/integrasi/pilah-tautan.js';

const tt = (id, status = 'ditarik') => ({ transaksi_id: id, supplier_id: '0c2408c0', supplier_nama: 'X', status });

test('satukanKembar: wakil yang kembarannya tertaut tidak lagi bebas, dan yang dikoreksi kembarannya', () => {
  const pilah = { bebas: ['w1', 'w2', 'baru'], tertaut: [tt('t1')] };
  const hasil = satukanKembar(pilah, [
    { transaksi_id: 'w1', tautan: tt('k1') },
    { transaksi_id: 'w2', tautan: tt('k2') },
  ]);
  assert.deepEqual(hasil.bebas, ['baru']);
  assert.deepEqual(hasil.lewatKembar.map((t) => t.transaksi_id), ['k1', 'k2']);
  assert.equal(hasil.diwakili, 2);
  assert.deepEqual(hasil.tertaut.map((t) => t.transaksi_id), ['t1']);
});

test('satukanKembar: tidak menggandakan tautan yang sudah ikut terpilih atau dipakai dua wakil', () => {
  const hasil = satukanKembar(
    { bebas: ['w1', 'w2'], tertaut: [tt('k1')] },
    [{ transaksi_id: 'w1', tautan: tt('k1') }, { transaksi_id: 'w2', tautan: tt('k1') }],
  );
  assert.deepEqual(hasil.lewatKembar, [], 'k1 sudah ada di tertaut');
  assert.equal(hasil.diwakili, 2);
  assert.deepEqual(hasil.bebas, []);
});

test('satukanKembar: tautan dibatalkan atau tanpa pasangan tidak mengubah apa pun', () => {
  const pilah = { bebas: ['a'], tertaut: [] };
  assert.deepEqual(satukanKembar(pilah, []), { bebas: ['a'], tertaut: [], lewatKembar: [], diwakili: 0 });
  assert.deepEqual(
    satukanKembar(pilah, [{ transaksi_id: 'a', tautan: tt('k', 'dibatalkan') }]).bebas, ['a'],
  );
});

test('kalimatKembar: kosong bila tidak ada, satu kalimat bila ada', () => {
  assert.equal(kalimatKembar(0), '');
  assert.match(kalimatKembar(3), /^3 transaksi terpilih adalah salinan/);
});

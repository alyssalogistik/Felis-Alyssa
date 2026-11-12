import test from 'node:test';
import assert from 'node:assert/strict';
import { kunciCetakan, cetakanLainSudahTertaut } from '../src/integrasi/kembar-cetakan.js';

const baris = (id, unggahan_id, keterangan, tanggal = '2026-10-01', debit = 10000000) =>
  ({ id, unggahan_id, keterangan, tanggal, debit });

const MUTASI = 'TRSF E-BANKING DB 0110/FTSCY/WS95051 10000000.00 Pembayaran AHMAD TAUFDIQ';
const ESTATEMENT = '0110/FTSCY/WS95051 10000000.00 Pembayaran AHMAD TAUFDIQ';

test('kunci mengabaikan awalan jenis, huruf, spasi, dan referensi', () => {
  assert.equal(kunciCetakan(baris('a', 'u1', MUTASI)), kunciCetakan(baris('b', 'u2', ESTATEMENT)));
  assert.equal(
    kunciCetakan(baris('a', 'u1', 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB')),
    kunciCetakan(baris('b', 'u2', 'BIF  TRANSFER KE 008 hermansyah kbb'))
  );
  // ada referensi atau tidak, kuncinya sama
  assert.equal(
    kunciCetakan({ ...baris('a', 'u1', ESTATEMENT), referensi: '0110/FTSCY/WS95051' }),
    kunciCetakan({ ...baris('b', 'u2', ESTATEMENT), referensi: null })
  );
});

test('KASUS NYATA: pasangan Mutasi + e-statement, Mutasi sudah tertaut -> e-statement habis', () => {
  const mutasi = baris('fc5e', 'U-MUTASI', MUTASI);
  const est = baris('db9b', 'U-EST', ESTATEMENT);
  const hasil = cetakanLainSudahTertaut(est, [mutasi, est], new Set(['fc5e']));
  assert.equal(hasil.berlaku, true);
  assert.equal(hasil.habis, true);
  assert.deepEqual(hasil.tertaut, ['fc5e']);
});

test('kebalikannya: e-statement tertaut lebih dulu -> Mutasi habis', () => {
  const mutasi = baris('fc5e', 'U-MUTASI', MUTASI);
  const est = baris('db9b', 'U-EST', ESTATEMENT);
  assert.equal(cetakanLainSudahTertaut(mutasi, [mutasi, est], new Set(['db9b'])).habis, true);
});

test('belum ada yang tertaut: tidak habis, boleh ditautkan', () => {
  const mutasi = baris('fc5e', 'U-MUTASI', MUTASI);
  const est = baris('db9b', 'U-EST', ESTATEMENT);
  const hasil = cetakanLainSudahTertaut(est, [mutasi, est], new Set());
  assert.equal(hasil.berlaku, true);
  assert.equal(hasil.habis, false);
});

test('KAIDAH MENGHITUNG: dua transfer nyata identik, tiap cetakan memuat keduanya', () => {
  // Dua penarikan Rp 5 juta pada hari yang sama. Mutasi dan e-statement
  // masing-masing mencetak DUA baris: empat baris fisik, dua transfer nyata.
  const t = 'TARIK TUNAI ATM 0123456 5000000.00';
  const m1 = baris('m1', 'U-M', `TRSF E-BANKING DB ${t}`, '2026-10-02', 5000000);
  const m2 = baris('m2', 'U-M', `TRSF E-BANKING DB ${t}`, '2026-10-02', 5000000);
  const e1 = baris('e1', 'U-E', t, '2026-10-02', 5000000);
  const e2 = baris('e2', 'U-E', t, '2026-10-02', 5000000);
  const semua = [m1, m2, e1, e2];

  // Satu tertaut: masih ada SATU transfer nyata yang belum dibayarkan.
  const satu = cetakanLainSudahTertaut(e1, semua, new Set(['m1']));
  assert.equal(satu.nyata, 2);
  assert.equal(satu.habis, false, 'transfer nyata yang kedua tidak boleh terblokir');

  // Dua tertaut: kedua transfer nyata sudah dibayarkan; sisanya salinan.
  const dua = cetakanLainSudahTertaut(e2, semua, new Set(['m1', 'e1']));
  assert.equal(dua.habis, true);
});

test('satu cetakan saja: bukan urusan penjaga ini (perilaku lama dibiarkan)', () => {
  const a = baris('a', 'U1', MUTASI);
  const b = baris('b', 'U1', MUTASI);
  const hasil = cetakanLainSudahTertaut(b, [a, b], new Set(['a']));
  assert.equal(hasil.berlaku, false);
  assert.equal(hasil.habis, false);
});

test('tanggal, nominal, atau penerima berbeda: bukan kembar', () => {
  const diri = baris('db9b', 'U-EST', ESTATEMENT);
  const lain = [
    baris('x1', 'U-M', MUTASI, '2026-10-02'),
    baris('x2', 'U-M', MUTASI, '2026-10-01', 9000000),
    baris('x3', 'U-M', MUTASI.replace('AHMAD TAUFDIQ', 'BUDI SANTOSO')),
  ];
  const hasil = cetakanLainSudahTertaut(diri, [diri, ...lain], new Set(['x1', 'x2', 'x3']));
  assert.equal(hasil.berlaku, false);
  assert.equal(hasil.habis, false);
});

test('tiga cetakan memuat transfer yang sama: satu tertaut sudah menghabiskannya', () => {
  const a = baris('a', 'U1', MUTASI);
  const b = baris('b', 'U2', ESTATEMENT);
  const c = baris('c', 'U3', ESTATEMENT);
  assert.equal(cetakanLainSudahTertaut(c, [a, b, c], new Set(['a'])).habis, true);
  assert.equal(cetakanLainSudahTertaut(c, [a, b, c], new Set(['a'])).nyata, 1);
});

test('diri belum ada di daftar: tetap dihitung', () => {
  const mutasi = baris('fc5e', 'U-MUTASI', MUTASI);
  const est = baris('db9b', 'U-EST', ESTATEMENT);
  assert.equal(cetakanLainSudahTertaut(est, [mutasi], new Set(['fc5e'])).habis, true);
});

test('masukan kosong tidak melempar', () => {
  const diri = baris('a', 'U1', MUTASI);
  assert.deepEqual(cetakanLainSudahTertaut(diri, undefined, new Set()), { berlaku: false, habis: false, nyata: 1, tertaut: [] });
});

// Migration 0018 diuji di Postgres sungguhan: pasangan Mutasi + e-statement
// yang sama dilipat di tampilan, yang berbeda tidak, dan fungsi SQL
// inti_keterangan() sama persis dengan intiKeterangan() di JavaScript.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { postgresTersedia, mulaiPostgres } from './pembantu-postgres.js';
import { intiKeterangan } from '../src/rekonsiliasi/pending.js';

const lewati = postgresTersedia ? false : 'Postgres tidak terpasang di mesin ini';
const PT = 'PT_ALYSSA_AUTO_LOGISTIK';
let pg;
before(() => { if (postgresTersedia) pg = mulaiPostgres(); });
after(() => { pg?.berhenti(); });

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
let n = 0;
const unggahan = () => pg.sql(
  `insert into unggahan_rekening_koran (nama_berkas, hash_berkas, entitas) values ('u${n}', 'h${n++}', '${PT}') returning id`
).split('\n')[0];

function baris({ unggah, tanggal = '2026-10-05', ket, debit = 3000000, ref = null, kembar = 0, noRek = '0072890271' }) {
  return pg.sql(
    `insert into transaksi_bank (unggahan_id, berkas_sumber, tanggal, keterangan, debit, referensi, no_rekening, entitas, kembar_ke)
     values ('${unggah}', 'b', '${tanggal}', ${q(ket)}, ${debit}, ${ref ? q(ref) : 'null'}, ${noRek ? q(noRek) : 'null'}, '${PT}', ${kembar})
     returning id`
  ).split('\n')[0];
}
const tampil = (...ids) => Number(pg.sql(`select count(*) from transaksi_bank_unik where id in (${ids.map(q).join(',')})`));

test('pasangan Mutasi (BI-FAST DB + referensi) dan e-statement (BIF) dilipat jadi satu', { skip: lewati }, () => {
  const a = unggahan(); const b = unggahan();
  const x = baris({ unggah: a, ket: 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB', ref: 'WS123' });
  const y = baris({ unggah: b, ket: 'BIF TRANSFER KE 008 HERMANSYAH KBB' });
  assert.equal(tampil(x, y), 1);
  assert.equal(pg.sql(`select count(distinct sidik_tampil) from transaksi_bank_kembar where id in ('${x}','${y}')`), '1');
});

test('TRSF E-BANKING DB vs tanpa awalan juga dilipat', { skip: lewati }, () => {
  const a = unggahan(); const b = unggahan();
  const x = baris({ unggah: a, ket: 'TRSF E-BANKING DB 0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL', debit: 10000000 });
  const y = baris({ unggah: b, ket: '0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL', debit: 10000000 });
  assert.equal(tampil(x, y), 1);
});

test('nominal, tanggal, atau nama berbeda TIDAK dilipat', { skip: lewati }, () => {
  const a = unggahan(); const b = unggahan();
  const dasar = 'TRANSFER KE 008 BUDI SANTOSO KBB';
  const x = baris({ unggah: a, ket: `BIF ${dasar}` });
  assert.equal(tampil(x, baris({ unggah: b, ket: `BI-FAST DB ${dasar}`, debit: 3000001 })), 2);
  assert.equal(tampil(x, baris({ unggah: b, ket: `BI-FAST DB ${dasar}`, tanggal: '2026-10-06' })), 2);
  assert.equal(tampil(x, baris({ unggah: b, ket: 'BI-FAST DB TRANSFER KE 008 BUDI HARTONO KBB' })), 2);
});

test('kembar di dalam SATU unggahan tetap dua baris', { skip: lewati }, () => {
  const a = unggahan();
  const x = baris({ unggah: a, ket: 'BI-FAST DB TARIK TUNAI', kembar: 0 });
  const y = baris({ unggah: a, ket: 'BI-FAST DB TARIK TUNAI', kembar: 1 });
  assert.equal(tampil(x, y), 2);
});

test('no_rekening NULL vs terisi tetap dilipat; keterangan asli tidak diubah', { skip: lewati }, () => {
  const a = unggahan(); const b = unggahan();
  const x = baris({ unggah: a, ket: 'BIF TRANSFER KE 002 RUDI KBB', noRek: null });
  const y = baris({ unggah: b, ket: 'BI-FAST DB TRANSFER KE 002 RUDI KBB' });
  assert.equal(tampil(x, y), 1);
  assert.equal(pg.sql(`select keterangan from transaksi_bank where id = '${y}'`), 'BI-FAST DB TRANSFER KE 002 RUDI KBB');
});

test('ringkasan_transaksi_bank menghitung pasangan sekali', { skip: lewati }, () => {
  const a = unggahan(); const b = unggahan();
  baris({ unggah: a, tanggal: '2026-12-01', ket: 'BI-FAST DB TRANSFER KE 008 UJI RINGKAS KBB', debit: 777000 });
  baris({ unggah: b, tanggal: '2026-12-01', ket: 'BIF TRANSFER KE 008 UJI RINGKAS KBB', debit: 777000 });
  // Pencarian memakai kata unik, jadi hanya pasangan ini yang terhitung.
  assert.equal(pg.sql(`select jumlah || '|' || debit from ringkasan_transaksi_bank('UJI RINGKAS')`), '1|777000.00');
});

test('inti_keterangan SQL sama dengan JavaScript pada korpus', { skip: lewati }, () => {
  const korpus = [
    'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB', 'BIF TRANSFER KE 008 HERMANSYAH KBB',
    'TRSF E-BANKING DB 0104/FTSCY/WS95051', 'TRSF E-BANKING CR 1', 'TRSF E-BANKING 2', 'BYR VIA E-BANKING X',
    'bi-fast', 'BIF', 'bif ', '  BIF   TRANSFER   A ', 'BIFAST TRANSFER', 'BIFURKASI', 'TARIK TUNAI', '',
    'BI-FAST CR  masuk', 'trsf e-banking db', 'BI-FAST DB   ',
  ];
  for (const k of korpus) {
    assert.equal(pg.sql(`select inti_keterangan(${q(k)})`), intiKeterangan(k), `korpus: ${JSON.stringify(k)}`);
  }
});

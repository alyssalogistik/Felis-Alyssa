// Premis di balik panel "Transaksi Siap Ditautkan", diuji di Postgres sungguhan.
//
// Rekening koran yang sama pernah terunggah dua kali: sekali sebelum nomor
// rekening disimpan (no_rekening NULL) dan sekali sesudahnya. Panel hanya benar
// bila keempat hal ini berlaku di database:
//
//   1. indeks unik TIDAK menahan salinan itu (`sidik` memuat no_rekening);
//   2. view transaksi_bank_unik melipatnya menjadi satu baris (seperti Audit);
//   3. view transaksi_bank_kembar memberi keduanya sidik_tampil yang SAMA;
//   4. dua transaksi kembar di dalam SATU unggahan tetap dua baris (uang nyata).
//
// Dan satu hal yang membuat penyaringan salinan WAJIB: baris wakil yang dipilih
// view bisa jatuh pada salinan yang TIDAK tertaut.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { postgresTersedia, mulaiPostgres } from './pembantu-postgres.js';

const lewati = postgresTersedia ? false : 'Postgres tidak terpasang di mesin ini';
const PT = 'PT_ALYSSA_AUTO_LOGISTIK';
let pg;

before(() => { if (postgresTersedia) pg = mulaiPostgres(); });
after(() => { pg?.berhenti(); });

const unggahan = (nama, hash) => pg.sql(
  `insert into unggahan_rekening_koran (nama_berkas, hash_berkas, entitas) values ('${nama}', '${hash}', '${PT}') returning id`
).split('\n')[0];

function transaksi({ unggah, berkas, noRek, tanggal = '2026-07-12', debit = 12000000, ket = 'TRSF AHMAD TAUFDIQ',
  dibuat = '2026-10-01 10:00:00+00', kembar = 0 }) {
  return pg.sql(
    `insert into transaksi_bank (unggahan_id, berkas_sumber, tanggal, keterangan, debit, no_rekening, entitas, dibuat_pada, kembar_ke)
     values ('${unggah}', '${berkas}', '${tanggal}', '${ket}', ${debit}, ${noRek ? `'${noRek}'` : 'null'}, '${PT}', '${dibuat}', ${kembar})
     returning id`
  ).split('\n')[0];
}

test('salinan dengan no_rekening berbeda: lolos indeks unik, dilipat view, sidik_tampil sama', { skip: lewati }, () => {
  const lama = unggahan('ESTATEMENT_202607.pdf', 'hash-lama');
  const baru = unggahan('ESTATEMENT_202607 (1).pdf', 'hash-baru');

  const a = transaksi({ unggah: lama, berkas: 'ESTATEMENT_202607.pdf', noRek: null, dibuat: '2026-09-01 10:00:00+00' });
  const b = transaksi({ unggah: baru, berkas: 'ESTATEMENT_202607 (1).pdf', noRek: '0072890271', dibuat: '2026-10-01 10:00:00+00' });

  // 1. indeks unik tidak menahan: sidik fisik berbeda.
  assert.equal(pg.sql(`select count(distinct sidik) from transaksi_bank where id in ('${a}','${b}')`), '2');

  // 2. view melipat menjadi satu baris wakil.
  assert.equal(pg.sql(`select count(*) from transaksi_bank_unik where id in ('${a}','${b}')`), '1');

  // 3. rumus kembar memberi sidik_tampil yang sama.
  assert.equal(pg.sql(`select count(distinct sidik_tampil) from transaksi_bank_kembar where id in ('${a}','${b}')`), '1');
});

test('baris wakil view bisa jatuh pada salinan yang TIDAK tertaut', { skip: lewati }, () => {
  const lama = unggahan('ESTATEMENT_202608.pdf', 'hash-lama-2');
  const baru = unggahan('ESTATEMENT_202608 (1).pdf', 'hash-baru-2');
  const dulu = transaksi({ unggah: lama, berkas: 'a', noRek: null, tanggal: '2026-08-09', debit: 8500000, dibuat: '2026-09-01 10:00:00+00' });
  const kemudian = transaksi({ unggah: baru, berkas: 'b', noRek: '0072890271', tanggal: '2026-08-09', debit: 8500000, dibuat: '2026-10-01 10:00:00+00' });

  // Yang ditautkan adalah salinan yang LEBIH BARU.
  pg.sql(`insert into tautan_pembayaran (transaksi_id, supplier_id, supplier_nama, entitas, tanggal, nominal, sidik, status, ditautkan_oleh)
          select id, '0c2408c0', 'AHMAD TAUFDIQ', entitas, tanggal, debit, sidik, 'ditarik', 'uji' from transaksi_bank where id = '${kemudian}'`);

  // View memilih yang paling dulu masuk — yang TIDAK tertaut. Layar Audit dan
  // panel yang naif sama-sama melihatnya sebagai "belum ditautkan".
  const wakil = pg.sql(`select id from transaksi_bank_unik where id in ('${dulu}','${kemudian}')`);
  assert.equal(wakil, dulu, 'wakil = salinan yang tidak tertaut');
  assert.equal(pg.sql(`select count(*) from tautan_pembayaran where transaksi_id = '${dulu}'`), '0');

  // Karena itu kembarnya harus dikenali lewat sidik_tampil, dan ketemu yang tertaut.
  assert.equal(
    pg.sql(`select count(*) from transaksi_bank_kembar k
              join tautan_pembayaran p on p.transaksi_id = k.id and p.status <> 'dibatalkan'
             where k.sidik_tampil = (select sidik_tampil from transaksi_bank_kembar where id = '${dulu}')`),
    '1'
  );
});

test('dua transaksi kembar di dalam SATU unggahan tetap dua baris (uang nyata)', { skip: lewati }, () => {
  const satu = unggahan('mutasi-satu-berkas.pdf', 'hash-kembar-1');
  const x = transaksi({ unggah: satu, berkas: 'm', noRek: '0072890271', tanggal: '2026-09-09', debit: 5000000, ket: 'TARIK TUNAI', kembar: 0 });
  const y = transaksi({ unggah: satu, berkas: 'm', noRek: '0072890271', tanggal: '2026-09-09', debit: 5000000, ket: 'TARIK TUNAI', kembar: 1 });
  assert.equal(pg.sql(`select count(*) from transaksi_bank_unik where id in ('${x}','${y}')`), '2');
});

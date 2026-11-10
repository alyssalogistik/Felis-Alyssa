// Fungsi lepas_tautan() (migration 0017), diuji di Postgres sungguhan.
//
// Dua janji yang dijaga di sini, dan keduanya tidak bisa dibuktikan dengan
// tiruan:
//
//   1. ATOMIK. Status dan jejak audit satu transaksi. Kalau penulisan jejak
//      gagal, status HARUS kembali seperti semula.
//   2. BERSAMAAN. Dua pelepasan pada transaksi yang sama: tepat satu berhasil,
//      yang lain mendapat nol baris (bukan galat) dan tidak menulis apa pun.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { postgresTersedia, mulaiPostgres } from './pembantu-postgres.js';

const lewati = postgresTersedia ? false : 'Postgres tidak terpasang di mesin ini';
let pg;

before(() => { if (postgresTersedia) pg = mulaiPostgres(); });
after(() => { pg?.berhenti(); });

let urut = 0;
/** Satu tautan berstatus `ditarik` dengan uuid baru. */
function siapkan(status = 'ditarik') {
  urut += 1;
  const id = `00000000-0000-4000-8000-${String(urut).padStart(12, '0')}`;
  pg.sql(`insert into tautan_pembayaran
            (transaksi_id, supplier_id, supplier_nama, entitas, tanggal, nominal, sidik, status, ditautkan_oleh)
          values ('${id}', '0c2408c0', 'AHMAD TAUFDIQ', 'PT_ALYSSA_AUTO_LOGISTIK',
                  '2026-10-01', 10000000, 'sidik-${urut}', '${status}', 'uji@contoh.test')`);
  return id;
}

const panggil = (id, { lama = 'ditarik', baru = 'menunggu_lepas', aksi = 'minta_lepas',
  alasan = 'salah supplier', riwayat = alasan, oleh = 'owner@contoh.test', batalkan = false } = {}) =>
  `select status, alasan, dibatalkan_oleh from lepas_tautan(
     '${id}', '${lama}', '${baru}', '${aksi}', '${alasan}', '${riwayat}', '${oleh}', ${batalkan})`;

const status = (id) => pg.sql(`select status from tautan_pembayaran where transaksi_id='${id}'`);
const jumlahRiwayat = (id) => Number(pg.sql(`select count(*) from tautan_pembayaran_riwayat where transaksi_id='${id}'`));

test('berhasil: status berubah DAN satu baris riwayat tertulis lengkap', { skip: lewati }, () => {
  const id = siapkan();
  const jawab = pg.sql(panggil(id));
  assert.equal(jawab, 'menunggu_lepas|salah supplier|');

  assert.equal(status(id), 'menunggu_lepas');
  assert.equal(
    pg.sql(`select aksi, supplier_id_lama, status_lama, status_baru, alasan, oleh
              from tautan_pembayaran_riwayat where transaksi_id='${id}'`),
    'minta_lepas|0c2408c0|ditarik|menunggu_lepas|salah supplier|owner@contoh.test'
  );
});

test('KAIDAH ATOMIK: jejak audit gagal -> status KEMBALI seperti semula', { skip: lewati }, () => {
  const id = siapkan();

  // Memaksa penulisan jejak gagal, persis keadaan yang ditakutkan: perintah
  // kedua gagal setelah perintah pertama berhasil.
  pg.sql(`create or replace function uji_gagalkan_riwayat() returns trigger language plpgsql as $$
          begin
            if new.alasan like 'GAGAL%' then raise exception 'riwayat ditolak (uji)'; end if;
            return new;
          end $$;
          create trigger uji_gagalkan before insert on tautan_pembayaran_riwayat
            for each row execute function uji_gagalkan_riwayat();`);

  const hasil = pg.coba(panggil(id, { riwayat: 'GAGAL-AUDIT', baru: 'dibatalkan', batalkan: true }));
  assert.equal(hasil.ok, false, 'fungsi harus melempar galat');
  assert.match(hasil.galat, /riwayat ditolak/);

  // Inti kaidahnya: TIDAK ADA yang berubah.
  assert.equal(status(id), 'ditarik', 'status tidak boleh berubah tanpa jejak');
  assert.equal(jumlahRiwayat(id), 0);
  assert.equal(
    pg.sql(`select dibatalkan_pada is null and dibatalkan_oleh is null from tautan_pembayaran where transaksi_id='${id}'`),
    't',
    'penanda pembatalan juga tidak boleh tertinggal'
  );

  // Setelah penyebabnya hilang, pelepasan yang sama berhasil utuh.
  pg.sql('drop trigger uji_gagalkan on tautan_pembayaran_riwayat');
  assert.equal(pg.coba(panggil(id)).ok, true);
  assert.equal(status(id), 'menunggu_lepas');
  assert.equal(jumlahRiwayat(id), 1);
});

test('status sudah berubah: NOL baris (bukan galat) dan tidak menulis apa pun', { skip: lewati }, () => {
  const id = siapkan();
  assert.equal(pg.coba(panggil(id)).ok, true);

  const kedua = pg.coba(panggil(id));            // masih mengaku status lama `ditarik`
  assert.equal(kedua.ok, true, 'benturan bukan galat database');
  assert.equal(kedua.keluar, '', 'nol baris');
  assert.equal(status(id), 'menunggu_lepas');
  assert.equal(jumlahRiwayat(id), 1, 'riwayat tidak bertambah');
});

test('transaksi yang tidak ada: nol baris, tidak ada riwayat yatim', { skip: lewati }, () => {
  const hantu = '99999999-9999-4999-8999-999999999999';
  const hasil = pg.coba(panggil(hantu));
  assert.equal(hasil.ok, true);
  assert.equal(hasil.keluar, '');
  assert.equal(jumlahRiwayat(hantu), 0);
});

test('KAIDAH BERSAMAAN: dua sesi berebut, tepat satu berhasil', { skip: lewati }, async () => {
  const id = siapkan();

  // Sesi A menahan kunci baris sebentar sebelum commit; sesi B mulai sesudah A
  // memegang kuncinya dan harus MENUNGGU, lalu mendapati statusnya sudah berubah.
  const a = pg.sesi(`begin; select count(*) from lepas_tautan('${id}','ditarik','menunggu_lepas','minta_lepas','dari A','dari A','a@contoh.test',false);
                     select pg_sleep(1.5); commit;`);
  await new Promise((r) => setTimeout(r, 500));
  const b = pg.sesi(`select count(*) from lepas_tautan('${id}','ditarik','menunggu_lepas','minta_lepas','dari B','dari B','b@contoh.test',false)`);

  const [hasilA, hasilB] = await Promise.all([a, b]);
  assert.ok(hasilA.ok && hasilB.ok, 'tidak ada yang boleh berakhir sebagai galat');

  const berhasil = [hasilA, hasilB].filter((h) => /(^|\n)1(\n|$)/.test(h.keluar.split('\n').filter(Boolean)[0] ?? h.keluar));
  assert.equal(hasilB.keluar, '0', 'sesi yang kalah mendapat nol baris');
  assert.equal(berhasil.length >= 1, true);
  assert.equal(jumlahRiwayat(id), 1, 'tepat SATU jejak, bukan dua');
  assert.equal(status(id), 'menunggu_lepas');
  assert.equal(pg.sql(`select alasan from tautan_pembayaran where transaksi_id='${id}'`), 'dari A');
});

test('pelepasan paksa mengisi penanda pembatalan, sekali', { skip: lewati }, () => {
  const id = siapkan();
  pg.sql(panggil(id, { baru: 'dibatalkan', aksi: 'lepas_paksa', batalkan: true, oleh: 'owner@contoh.test' }));
  assert.equal(status(id), 'dibatalkan');
  assert.equal(
    pg.sql(`select dibatalkan_oleh, dibatalkan_pada is not null from tautan_pembayaran where transaksi_id='${id}'`),
    'owner@contoh.test|t'
  );
  assert.equal(jumlahRiwayat(id), 1);
});

test('hanya service_role yang boleh memanggil fungsi ini', { skip: lewati }, () => {
  const id = siapkan();
  const sebagai = (peran) => pg.coba(`set role ${peran}; ${panggil(id)}`);

  for (const peran of ['anon', 'authenticated']) {
    const hasil = sebagai(peran);
    assert.equal(hasil.ok, false, `${peran} harus ditolak`);
    assert.match(hasil.galat, /permission denied/, peran);
  }
  assert.equal(status(id), 'ditarik', 'penolakan tidak mengubah apa pun');
  assert.equal(sebagai('service_role').ok, true);
});

test('riwayat tetap hanya-tambah: fungsi tidak membuka jalan menghapusnya', { skip: lewati }, () => {
  const id = siapkan();
  pg.sql(panggil(id));
  const hapus = pg.coba(`delete from tautan_pembayaran_riwayat where transaksi_id='${id}'`);
  assert.equal(hapus.ok, false);
  assert.equal(jumlahRiwayat(id), 1);
});

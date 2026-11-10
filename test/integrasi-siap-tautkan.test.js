import test from 'node:test';
import assert from 'node:assert/strict';

import {
  tanggalSah, periksaRentang, formatTanggal, hariIniWib, rentangPintasan,
  terapkanRentang, pilihBebas, kunciDobel, idKemungkinanDobel, ringkasHasil, teksRentang,
} from '../src/integrasi/siap-tautkan.js';
import { idTerpakai, STATUS } from '../src/integrasi/tautan.js';

// Kueri tiruan yang meniru perilaku PostgREST pada kolom `date`: perbandingan
// teks YYYY-MM-DD, urutan pemasangan dicatat, dan limit memotong SESUDAH
// seluruh penyaring yang sudah terpasang. Dipakai agar "filter sebelum batas"
// bisa diuji, bukan hanya diyakini.
function kueriTiruan(baris) {
  const saringan = [];
  let batas = Infinity;
  let urutan = null;
  const q = {
    catatan: [],
    gte(kolom, nilai) { this.catatan.push(['gte', kolom, nilai]); saringan.push((b) => b[kolom] >= nilai); return q; },
    lte(kolom, nilai) { this.catatan.push(['lte', kolom, nilai]); saringan.push((b) => b[kolom] <= nilai); return q; },
    ilike(kolom, pola) {
      this.catatan.push(['ilike', kolom, pola]);
      const kata = pola.replaceAll('%', '').toUpperCase();
      saringan.push((b) => String(b[kolom]).toUpperCase().includes(kata));
      return q;
    },
    order(kolom, { ascending }) { urutan = { kolom, ascending }; return q; },
    limit(n) { this.catatan.push(['limit', n]); batas = n; return q; },
    hasil() {
      let r = baris.filter((b) => saringan.every((f) => f(b)));
      if (urutan) {
        r = [...r].sort((a, b) => (a[urutan.kolom] < b[urutan.kolom] ? -1 : 1) * (urutan.ascending ? 1 : -1));
      }
      return r.slice(0, batas);
    },
  };
  return q;
}

const TRX = [
  { id: 'a1', tanggal: '2026-08-31', keterangan: 'TRSF AHMAD TAUFDIQ', debit: 1000000 },
  { id: 'a2', tanggal: '2026-09-01', keterangan: 'TRSF AHMAD TAUFDIQ', debit: 2000000 },
  { id: 'a3', tanggal: '2026-09-15', keterangan: 'TRSF AHMAD TAUFDIQ', debit: 3000000 },
  { id: 'a4', tanggal: '2026-09-30', keterangan: 'TRSF AHMAD TAUFDIQ', debit: 4000000 },
  { id: 'a5', tanggal: '2026-10-01', keterangan: 'TRSF AHMAD TAUFDIQ', debit: 5000000 },
  { id: 'b1', tanggal: '2026-09-15', keterangan: 'TRSF BUDI SANTOSO', debit: 600000 },
];

// Meniru jalur endpoint: rentang, lalu kata kunci, lalu batas.
function jalankan({ dari, sampai, cari, batas = 50, terpakai = new Set() }) {
  const r = periksaRentang(dari, sampai);
  assert.ok(r.ok, 'rentang seharusnya sah');
  let q = kueriTiruan(TRX).order('tanggal', { ascending: false });
  q = terapkanRentang(q, r.dari, r.sampai);
  if (cari) q = q.ilike('keterangan', `%${cari}%`);
  q = q.limit(batas + terpakai.size);
  return { q, hasil: pilihBebas(q.hasil(), terpakai, batas) };
}
const ids = (r) => r.hasil.map((t) => t.id).sort();

test('rentang dua sisi: kedua tanggal batas IKUT (inklusif)', () => {
  const r = jalankan({ dari: '2026-09-01', sampai: '2026-09-30' });
  assert.deepEqual(ids(r), ['a2', 'a3', 'a4', 'b1']);
  assert.ok(ids(r).includes('a2'), 'tepat pada Dari ikut');
  assert.ok(ids(r).includes('a4'), 'tepat pada Sampai ikut');
  assert.ok(!ids(r).includes('a1') && !ids(r).includes('a5'), 'sehari di luar tidak ikut');
});

test('hanya Dari: sejak tanggal itu, tanpa batas atas', () => {
  const r = jalankan({ dari: '2026-09-30' });
  assert.deepEqual(ids(r), ['a4', 'a5']);
  assert.ok(!r.q.catatan.some(([jenis]) => jenis === 'lte'), 'tidak memasang batas atas');
});

test('hanya Sampai: sampai tanggal itu, tanpa batas bawah', () => {
  const r = jalankan({ sampai: '2026-09-01' });
  assert.deepEqual(ids(r), ['a1', 'a2']);
  assert.ok(!r.q.catatan.some(([jenis]) => jenis === 'gte'), 'tidak memasang batas bawah');
});

test('tanpa rentang: tidak ada penyaring tanggal sama sekali', () => {
  const r = jalankan({});
  assert.equal(r.hasil.length, TRX.length);
  assert.ok(!r.q.catatan.some(([jenis]) => jenis === 'gte' || jenis === 'lte'));
});

test('Dari lebih besar dari Sampai ditolak dengan pesan yang menyebut kedua tanggal', () => {
  const r = periksaRentang('2026-09-30', '2026-09-01');
  assert.equal(r.ok, false);
  assert.match(r.pesan, /30\/09\/2026/);
  assert.match(r.pesan, /01\/09\/2026/);
});

test('Dari sama dengan Sampai sah: satu hari penuh', () => {
  const r = jalankan({ dari: '2026-09-15', sampai: '2026-09-15' });
  assert.deepEqual(ids(r), ['a3', 'b1']);
});

test('tanggal yang bukan tanggal ditolak, kosong dianggap tanpa batas', () => {
  for (const salah of ['2026-02-30', '2026-13-01', '15/09/2026', 'kemarin', '2026-9-1']) {
    assert.equal(periksaRentang(salah, '').ok, false, `Dari ${salah}`);
    assert.equal(periksaRentang('', salah).ok, false, `Sampai ${salah}`);
  }
  assert.deepEqual(periksaRentang('', ''), { ok: true, dari: null, sampai: null });
  assert.deepEqual(periksaRentang(undefined, null), { ok: true, dari: null, sampai: null });
  assert.equal(tanggalSah('2028-02-29'), '2028-02-29', 'tahun kabisat');
  assert.equal(tanggalSah('2026-02-29'), null);
});

test('rentang DIGABUNG dengan kata kunci (AND)', () => {
  const r = jalankan({ dari: '2026-09-01', sampai: '2026-09-30', cari: 'ahmad' });
  assert.deepEqual(ids(r), ['a2', 'a3', 'a4'], 'BUDI di rentang yang sama tidak ikut');

  const lain = jalankan({ dari: '2026-09-01', sampai: '2026-09-30', cari: 'budi' });
  assert.deepEqual(ids(lain), ['b1']);

  const luar = jalankan({ dari: '2026-11-01', sampai: '2026-11-30', cari: 'ahmad' });
  assert.deepEqual(ids(luar), [], 'kata kunci cocok tetapi di luar rentang');
});

test('rentang dipasang SEBELUM limit, sehingga batas tidak memotong hasil rentang', () => {
  // Batas 1 dan terurut dari terbaru: tanpa filter lebih dulu, yang terambil
  // a5 (Oktober) lalu dibuang oleh rentang September, dan hasilnya kosong.
  const r = jalankan({ dari: '2026-09-01', sampai: '2026-09-30', batas: 1 });
  assert.equal(r.hasil.length, 1);
  assert.equal(r.hasil[0].id, 'a4');

  const urutanPasang = r.q.catatan.map(([jenis]) => jenis);
  assert.ok(urutanPasang.indexOf('limit') > urutanPasang.lastIndexOf('lte'), 'limit sesudah lte');
  assert.ok(urutanPasang.indexOf('limit') > urutanPasang.lastIndexOf('gte'), 'limit sesudah gte');
});

test('baris yang sudah ditautkan tidak muncul, termasuk di dalam rentang', () => {
  const terpakai = idTerpakai([
    { transaksi_id: 'a3', status: STATUS.SIAP },
    { transaksi_id: 'a4', status: STATUS.DITARIK },
    { transaksi_id: 'a2', status: STATUS.DIBATALKAN },
  ]);
  const r = jalankan({ dari: '2026-09-01', sampai: '2026-09-30', terpakai });
  assert.ok(!ids(r).includes('a3'), 'siap sudah terpakai');
  assert.ok(!ids(r).includes('a4'), 'ditarik sudah terpakai');
  assert.ok(ids(r).includes('a2'), 'tautan dibatalkan membebaskan transaksinya lagi');
});

test('pembuangan yang tertaut tidak memperpendek halaman di bawah batas', () => {
  const terpakai = new Set(['a4', 'a3']);
  const r = jalankan({ dari: '2026-09-01', sampai: '2026-09-30', batas: 2, terpakai });
  assert.equal(r.hasil.length, 2, 'batas dinaikkan sebanyak tautan yang ada');
  assert.deepEqual(ids(r), ['a2', 'b1']);
});

test('pintasan dihitung dari tanggal WIB, tidak bergeser sehari', () => {
  // 20:00 UTC tanggal 10 = 03:00 WIB tanggal 11.
  assert.equal(hariIniWib(new Date('2026-11-10T20:00:00Z')), '2026-11-11');
  assert.equal(hariIniWib(new Date('2026-11-10T16:59:59Z')), '2026-11-10');

  assert.deepEqual(rentangPintasan('bulan_ini', '2026-11-10'), { dari: '2026-11-01', sampai: '2026-11-30' });
  assert.deepEqual(rentangPintasan('bulan_lalu', '2026-11-10'), { dari: '2026-10-01', sampai: '2026-10-31' });
  assert.deepEqual(rentangPintasan('30_hari', '2026-11-10'), { dari: '2026-10-12', sampai: '2026-11-10' });
});

test('pintasan melewati batas bulan dan tahun dengan benar', () => {
  assert.deepEqual(rentangPintasan('bulan_lalu', '2027-01-05'), { dari: '2026-12-01', sampai: '2026-12-31' });
  assert.deepEqual(rentangPintasan('bulan_lalu', '2026-03-31'), { dari: '2026-02-01', sampai: '2026-02-28' });
  assert.deepEqual(rentangPintasan('bulan_lalu', '2028-03-10'), { dari: '2028-02-01', sampai: '2028-02-29' });
  assert.deepEqual(rentangPintasan('30_hari', '2027-01-10'), { dari: '2026-12-12', sampai: '2027-01-10' });
  assert.equal(rentangPintasan('tidak_ada', '2026-11-10'), null);
});

test('tanggal ditampilkan DD/MM/YYYY dengan memotong teks, bukan lewat Date', () => {
  assert.equal(formatTanggal('2026-09-05'), '05/09/2026');
  assert.equal(formatTanggal('2026-12-31'), '31/12/2026');
  assert.equal(formatTanggal(null), '');
  assert.equal(formatTanggal(undefined), '');
});

test('ringkasan: jumlah dan total dijumlah dalam sen, tanpa selisih pecahan', () => {
  assert.deepEqual(ringkasHasil([]), { jumlah: 0, total: 0 });
  const r = ringkasHasil([{ nominal: 0.1 }, { nominal: 0.2 }, { nominal: 10000000 }]);
  assert.equal(r.jumlah, 3);
  assert.equal(r.total, 10000000.3, '0.1 + 0.2 tidak menjadi 0.30000000000000004');
});

test('teks rentang untuk ringkasan', () => {
  assert.equal(teksRentang('2026-09-01', '2026-09-30'), '01/09/2026 - 30/09/2026');
  assert.equal(teksRentang('2026-09-01', null), 'sejak 01/09/2026');
  assert.equal(teksRentang(null, '2026-09-30'), 'sampai 30/09/2026');
  assert.equal(teksRentang(null, null), 'semua tanggal');
});

// ---------------------------------------------------------------------------
// Kemungkinan dobel
// ---------------------------------------------------------------------------

const baris = (id, tanggal, nominal, keterangan) =>
  ({ bank_transaction_id: id, tanggal, nominal, keterangan });

test('tanggal + nominal + keterangan sama persis ditandai kemungkinan dobel', () => {
  const dobel = idKemungkinanDobel([
    baris('x1', '2026-09-15', 10000000, 'TRSF E-BANKING DB AHMAD TAUFDIQ'),
    baris('x2', '2026-09-15', 10000000, 'TRSF E-BANKING DB AHMAD TAUFDIQ'),
    baris('x3', '2026-09-15', 10000000, 'TRSF E-BANKING DB BUDI'),
  ]);
  assert.deepEqual([...dobel].sort(), ['x1', 'x2']);
});

test('salah satu dari tanggal, nominal, atau keterangan berbeda: bukan dobel', () => {
  const dobel = idKemungkinanDobel([
    baris('t1', '2026-09-15', 10000000, 'TRSF AHMAD'),
    baris('t2', '2026-09-16', 10000000, 'TRSF AHMAD'),
    baris('n1', '2026-09-15', 10000001, 'TRSF AHMAD'),
    baris('k1', '2026-09-15', 10000000, 'TRSF AHMAD TAUFIK'),
  ]);
  assert.equal(dobel.size, 0);
});

test('huruf dan spasi diseragamkan, sama seperti sidik di database', () => {
  assert.equal(
    kunciDobel(baris('a', '2026-09-15', 5, 'Trsf  Ahmad')),
    kunciDobel(baris('b', '2026-09-15', 5, ' TRSF AHMAD ')),
  );
});

test('tiga salinan semuanya tertandai; baris tunggal tidak', () => {
  const dobel = idKemungkinanDobel([
    baris('s1', '2026-09-15', 7, 'X'), baris('s2', '2026-09-15', 7, 'X'),
    baris('s3', '2026-09-15', 7, 'X'), baris('u1', '2026-09-15', 8, 'X'),
  ]);
  assert.deepEqual([...dobel].sort(), ['s1', 's2', 's3']);
  assert.equal(idKemungkinanDobel([]).size, 0);
  assert.equal(idKemungkinanDobel(undefined).size, 0);
});

test('penanda dobel hanya melaporkan: daftar masukan tidak berubah', () => {
  const masukan = [baris('d1', '2026-09-15', 1, 'X'), baris('d2', '2026-09-15', 1, 'X')];
  const salinan = JSON.parse(JSON.stringify(masukan));
  idKemungkinanDobel(masukan);
  ringkasHasil(masukan);
  assert.deepEqual(masukan, salinan);
});

// ---------------------------------------------------------------------------
// Kemungkinan dobel dari DUA CETAKAN BCA (e-statement vs Mutasi Rekening)
// ---------------------------------------------------------------------------

test('transfer yang sama dari e-statement dan Mutasi Rekening ditandai dobel', () => {
  // Kasus nyata: satu transfer tersimpan dua kali. Mutasi memakai awalan
  // "TRSF E-BANKING DB" (referensi terisi), e-statement tidak (referensi kosong).
  const dobel = idKemungkinanDobel([
    baris('mutasi', '2026-10-01', 10000000, 'TRSF E-BANKING DB 0110/FTSCY/WS95051 10000000.00 AHMAD TAUFDIQ'),
    baris('estatement', '2026-10-01', 10000000, '0110/FTSCY/WS95051 10000000.00 AHMAD TAUFDIQ'),
  ]);
  assert.deepEqual([...dobel].sort(), ['estatement', 'mutasi']);
});

test('awalan BI-FAST DB vs BIF juga dikenali sebagai transaksi yang sama', () => {
  const dobel = idKemungkinanDobel([
    baris('m', '2026-10-01', 500000, 'BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB'),
    baris('e', '2026-10-01', 500000, 'BIF TRANSFER KE 008 HERMANSYAH KBB'),
  ]);
  assert.deepEqual([...dobel].sort(), ['e', 'm']);
});

test('awalan yang sama tidak membuat dua transfer berbeda tertandai', () => {
  const dobel = idKemungkinanDobel([
    baris('a', '2026-10-01', 10000000, 'TRSF E-BANKING DB 0110/FTSCY/WS95051 AHMAD TAUFDIQ'),
    baris('b', '2026-10-01', 10000000, 'TRSF E-BANKING DB 0110/FTSCY/WS95051 BUDI SANTOSO'),
    baris('c', '2026-10-16', 10000000, 'TRSF E-BANKING DB 0110/FTSCY/WS95051 AHMAD TAUFDIQ'),
    baris('d', '2026-10-01', 9000000, 'TRSF E-BANKING DB 0110/FTSCY/WS95051 AHMAD TAUFDIQ'),
  ]);
  assert.equal(dobel.size, 0, 'beda penerima, tanggal, atau nominal bukan dobel');
});

test('kunci tidak memuat referensi: pasangan itu justru berbeda di referensi', () => {
  const a = { tanggal: '2026-10-01', nominal: 1, keterangan: 'X', referensi: '0110/FTSCY/WS95051' };
  const b = { tanggal: '2026-10-01', nominal: 1, keterangan: 'X', referensi: null };
  assert.equal(kunciDobel(a), kunciDobel(b));
});

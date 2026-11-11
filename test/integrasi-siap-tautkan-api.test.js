// GET /tautan/siap-tautkan, dijalankan SUNGGUHAN terhadap PostgREST palsu.
//
// Router dan klien supabase-js yang dipakai yang asli. Server palsunya
// menyaring seperti PostgREST (eq, gt, gte, lte, ilike, in, order, limit), jadi
// yang terbukti adalah apa yang dikirim endpoint dan apa yang dijawabnya.
//
// Kasus inti: rekening koran yang sama pernah terunggah dua kali, sehingga satu
// transfer punya dua baris fisik. Audit melipatnya, yang ditautkan hanya satu,
// dan salinan yang tidak tertaut TIDAK BOLEH tampil sebagai "belum ditautkan".

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const PT = 'PT_ALYSSA_AUTO_LOGISTIK';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// Baris WAKIL yang dikembalikan view transaksi_bank_unik.
const baris = (n, tanggal, debit, keterangan, sidik, ekstra = {}) =>
  ({ id: uuid(n), tanggal, debit, kredit: 0, keterangan, referensi: null, entitas: PT, sidik, ...ekstra });

let WAKIL;     // isi view transaksi_bank_unik
let KEMBAR;    // isi view transaksi_bank_kembar: {id, sidik_tampil}
let TAUTAN;    // isi tautan_pembayaran: {transaksi_id, status}
let hulu; let app; let catatan;

function cocok(b, [kolom, pola]) {
  const nilai = b[kolom];
  if (pola.startsWith('eq.')) return String(nilai) === pola.slice(3);
  if (pola.startsWith('gt.')) return Number(nilai) > Number(pola.slice(3));
  if (pola.startsWith('gte.')) return String(nilai) >= pola.slice(4);
  if (pola.startsWith('lte.')) return String(nilai) <= pola.slice(4);
  if (pola === 'not.is.null') return nilai !== null && nilai !== undefined;
  if (pola.startsWith('ilike.')) {
    const kata = pola.slice(6).replaceAll('%', '').replaceAll('*', '').toUpperCase();
    return String(nilai).toUpperCase().includes(kata);
  }
  if (pola.startsWith('in.(')) {
    const daftar = pola.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, ''));
    return daftar.includes(String(nilai));
  }
  throw new Error(`penyaring PostgREST belum ditiru: ${kolom}=${pola}`);
}

function layani(tabel, url) {
  let r = [...tabel];
  for (const [kolom, pola] of url.searchParams.entries()) {
    if (['select', 'order', 'limit'].includes(kolom)) continue;
    r = r.filter((b) => cocok(b, [kolom, pola]));
  }
  const urut = url.searchParams.get('order');
  if (urut) {
    const [kolom, arah] = urut.split('.');
    r.sort((a, b) => (a[kolom] < b[kolom] ? -1 : a[kolom] > b[kolom] ? 1 : 0) * (arah === 'desc' ? -1 : 1));
  }
  const batas = Number(url.searchParams.get('limit'));
  return batas ? r.slice(0, batas) : r;
}

before(async () => {
  hulu = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    catatan.push(`${req.method} ${url.pathname}`);
    const tabel = {
      '/rest/v1/transaksi_bank_unik': () => WAKIL,
      '/rest/v1/transaksi_bank_kembar': () => KEMBAR,
      '/rest/v1/tautan_pembayaran': () => TAUTAN,
    }[url.pathname];
    if (req.method !== 'GET' || !tabel) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ message: `tidak ditiru: ${req.method} ${url.pathname}` }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(layani(tabel(), url)));
  });
  await new Promise((r) => hulu.listen(0, '127.0.0.1', r));

  process.env.SUPABASE_URL = `http://127.0.0.1:${hulu.address().port}`;
  process.env.SUPABASE_ANON_KEY = 'anon-uji';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-uji';
  delete process.env.SUPABASE_PROJECT_REF;

  const { default: express } = await import('express');
  const { default: router } = await import('../src/integrasi/api.js');
  const api = express();
  api.use(express.json());
  api.use((req, _res, next) => { req.pengguna = { email: 'owner@contoh.test', peran: 'OWNER', status: 'AKTIF' }; next(); });
  api.use(router);
  app = createServer(api);
  await new Promise((r) => app.listen(0, '127.0.0.1', r));
});

after(() => { app?.close(); hulu?.close(); });
beforeEach(() => { catatan = []; });

const panel = async (kueri = '') => {
  const res = await fetch(`http://127.0.0.1:${app.address().port}/tautan/siap-tautkan${kueri}`);
  return { status: res.status, isi: await res.json() };
};
const ids = (isi) => isi.data.map((t) => t.bank_transaction_id).sort();

// Satu transfer dengan salinan: `asli` tertaut/ditarik, `salinan` tidak tertaut
// dan inilah yang dipilih view sebagai wakil (kasus yang menyesatkan di layar).
function skenarioSalinan() {
  WAKIL = [
    baris(2, '2026-07-12', 12000000, 'TRSF AHMAD TAUFDIQ A', 'S-A'),     // wakil = salinan tak tertaut
    baris(4, '2026-08-09', 8500000, 'TRSF AHMAD TAUFDIQ B', 'S-B'),      // wakil = salinan tak tertaut
    baris(6, '2026-08-20', 750000, 'TRSF AHMAD TAUFDIQ C', 'S-C'),       // bebas, tanpa kembar
    baris(7, '2026-09-01', 3000000, 'TRSF AHMAD TAUFDIQ D', 'S-D'),      // wakil = yang tertaut
    baris(9, '2026-09-15', 4000000, 'TRSF AHMAD TAUFDIQ E', 'S-E'),      // kembarnya tautan DIBATALKAN
    baris(11, '2026-09-20', 900000, 'TRSF BUDI SANTOSO', 'S-F'),         // supplier lain, bebas
  ];
  KEMBAR = [
    { id: uuid(1), sidik_tampil: 'S-A' }, { id: uuid(2), sidik_tampil: 'S-A' },
    { id: uuid(3), sidik_tampil: 'S-B' }, { id: uuid(4), sidik_tampil: 'S-B' },
    { id: uuid(6), sidik_tampil: 'S-C' },
    { id: uuid(7), sidik_tampil: 'S-D' }, { id: uuid(8), sidik_tampil: 'S-D' },
    { id: uuid(9), sidik_tampil: 'S-E' }, { id: uuid(10), sidik_tampil: 'S-E' },
    { id: uuid(11), sidik_tampil: 'S-F' },
  ];
  TAUTAN = [
    { transaksi_id: uuid(1), status: 'ditarik' },
    { transaksi_id: uuid(3), status: 'ditarik' },
    { transaksi_id: uuid(7), status: 'ditarik' },
    { transaksi_id: uuid(10), status: 'dibatalkan' },
  ];
}

test('KAIDAH: salinan yang kembarnya sudah ditarik TIDAK tampil sebagai belum tertaut', async () => {
  skenarioSalinan();
  const { status, isi } = await panel('?cari=AHMAD%20TAUFDIQ');
  assert.equal(status, 200);

  const tampil = ids(isi);
  assert.ok(!tampil.includes(uuid(2)), 'salinan A disembunyikan');
  assert.ok(!tampil.includes(uuid(4)), 'salinan B disembunyikan');
  assert.ok(!tampil.includes(uuid(7)), 'yang tertaut hilang sendiri');
  assert.deepEqual(tampil, [uuid(6), uuid(9)].sort(), 'hanya yang benar-benar bebas');
});

test('yang disembunyikan dihitung dan dinominalkan, terpisah dari yang bebas', async () => {
  skenarioSalinan();
  const { isi } = await panel('?cari=AHMAD%20TAUFDIQ');

  assert.deepEqual(isi.disembunyikan_kembar, { jumlah: 2, total: 20500000 });
  assert.equal(isi.jumlah, 2);
  assert.equal(isi.calon_terpotong, false);
});

test('tautan yang DIBATALKAN membebaskan transaksinya: kembarnya tidak mengunci', async () => {
  skenarioSalinan();
  const { isi } = await panel('?cari=AHMAD%20TAUFDIQ');
  assert.ok(ids(isi).includes(uuid(9)), 'S-E hanya punya kembar berstatus dibatalkan');
});

test('rentang tanggal ikut: inklusif dan digabung dengan penyaringan salinan', async () => {
  skenarioSalinan();
  const { isi } = await panel('?cari=AHMAD%20TAUFDIQ&dari=2026-08-20&sampai=2026-09-15');
  assert.deepEqual(ids(isi), [uuid(6), uuid(9)].sort(), 'ujung 20/08 dan 15/09 ikut');
  assert.deepEqual(isi.disembunyikan_kembar, { jumlah: 0, total: 0 }, 'salinan A dan B di luar rentang');

  const juli = await panel('?cari=AHMAD%20TAUFDIQ&dari=2026-07-01&sampai=2026-08-10');
  assert.deepEqual(ids(juli.isi), []);
  assert.deepEqual(juli.isi.disembunyikan_kembar, { jumlah: 2, total: 20500000 });
});

test('Dari > Sampai tetap ditolak 400 tanpa membaca database', async () => {
  skenarioSalinan();
  const { status, isi } = await panel('?dari=2026-09-30&sampai=2026-09-01');
  assert.equal(status, 400);
  assert.match(isi.pesan, /tidak boleh lebih besar/);
  assert.deepEqual(catatan, []);
});

test('tanpa kembar tertaut: tidak ada yang disembunyikan, perilaku lama tidak berubah', async () => {
  WAKIL = [baris(1, '2026-10-01', 10000000, 'TRSF AHMAD TAUFDIQ', 'S-1'), baris(2, '2026-10-16', 10000000, 'TRSF AHMAD TAUFDIQ', 'S-2')];
  KEMBAR = [{ id: uuid(1), sidik_tampil: 'S-1' }, { id: uuid(2), sidik_tampil: 'S-2' }];
  TAUTAN = [];
  const { isi } = await panel('?cari=AHMAD');
  assert.deepEqual(ids(isi), [uuid(1), uuid(2)].sort());
  assert.deepEqual(isi.disembunyikan_kembar, { jumlah: 0, total: 0 });
});

test('hanya TRANSAKSI PT dan uang keluar: CV, kredit, dan tanpa tanggal tidak ikut', async () => {
  WAKIL = [
    baris(1, '2026-10-01', 100, 'AHMAD', 'S-1'),
    baris(2, '2026-10-02', 100, 'AHMAD', 'S-2', { entitas: 'CV_ALYSSA_TRANS_UTAMA' }),
    baris(3, '2026-10-03', 0, 'AHMAD', 'S-3'),
    baris(4, null, 100, 'AHMAD', 'S-4'),
  ];
  KEMBAR = WAKIL.map((b) => ({ id: b.id, sidik_tampil: b.sidik }));
  TAUTAN = [];
  const { isi } = await panel('?cari=AHMAD');
  assert.deepEqual(ids(isi), [uuid(1)]);
});

test('pembacaan hanya GET ke tiga tabel: tidak ada penulisan apa pun', async () => {
  skenarioSalinan();
  await panel('?cari=AHMAD%20TAUFDIQ');
  assert.ok(catatan.length > 0);
  assert.ok(catatan.every((c) => c.startsWith('GET ')), catatan.join(' | '));
  assert.ok(catatan.some((c) => c.endsWith('/transaksi_bank_unik')), 'calon dari view yang melipat salinan');
  assert.ok(catatan.some((c) => c.endsWith('/transaksi_bank_kembar')), 'rumus kembar dibaca dari view, bukan disalin');
});

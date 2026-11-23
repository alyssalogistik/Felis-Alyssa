// GET /tautan/via-kembar, dijalankan SUNGGUHAN terhadap PostgREST palsu (router
// dan klien supabase-js yang asli).
//
// Kasus nyata: Audit menampilkan SATU baris wakil per transfer, dan wakil itu
// bisa salinan yang TIDAK tertaut sementara kembarannya yang tersembunyi sudah
// ditarik alyssa-dev. Ubah Supplier harus menemukan tautan kembaran itu; kalau
// tidak, pembayaran yang sudah ditarik tertinggal di supplier lama.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const PT = 'PT_ALYSSA_AUTO_LOGISTIK';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MUTASI = 'TRSF E-BANKING DB 0110/FTSCY/WS95051 10000000.00 Pembayaran AHMAD TAUFDIQ';
const ESTATEMENT = '0110/FTSCY/WS95051 10000000.00 Pembayaran AHMAD TAUFDIQ';

const fisik = (n, unggahan, keterangan, tanggal = '2026-10-01', debit = 10000000) => ({
  id: uuid(n), unggahan_id: `unggahan-${unggahan}`, tanggal, debit, kredit: 0, keterangan,
  referensi: keterangan.startsWith('TRSF') ? '0110/FTSCY/WS95051' : null,
  no_rekening: '0072890271', entitas: PT, sidik: `sidik-${n}`, dibuat_pada: `2026-10-0${n}T00:00:00Z`,
});
const tautanRow = (n, status = 'ditarik', tanggal = '2026-10-01', nominal = 10000000) => ({
  transaksi_id: uuid(n), supplier_id: '0c2408c0', supplier_nama: 'AHMAD TAUFDIQ', entitas: PT, tanggal,
  nominal, sidik: `sidik-${n}`, status, ditautkan_pada: '2026-10-02T00:00:00Z', ditautkan_oleh: 'uji',
  batch_tarik: null, ditarik_pada: null, dibatalkan_pada: null, dibatalkan_oleh: null, alasan: null,
});

let FISIK; let TAUTAN; let hulu; let app; let catatan;

function cocok(b, [kolom, pola]) {
  const nilai = b[kolom];
  if (pola.startsWith('eq.')) return String(nilai) === pola.slice(3);
  if (pola.startsWith('neq.')) return String(nilai) !== pola.slice(4);
  if (pola.startsWith('gt.')) return Number(nilai) > Number(pola.slice(3));
  if (pola.startsWith('gte.')) return String(nilai) >= pola.slice(4);
  if (pola.startsWith('lte.')) return String(nilai) <= pola.slice(4);
  if (pola === 'not.is.null') return nilai !== null && nilai !== undefined;
  if (pola.startsWith('ilike.')) return String(nilai).toUpperCase().includes(pola.slice(6).replaceAll('%', '').replaceAll('*', '').toUpperCase());
  if (pola.startsWith('in.(')) return pola.slice(4, -1).split(',').map((x) => x.replace(/^"|"$/g, '')).includes(String(nilai));
  throw new Error(`penyaring PostgREST belum ditiru: ${kolom}=${pola}`);
}
function layani(tabel, url) {
  let r = [...tabel];
  for (const [kolom, pola] of url.searchParams.entries()) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(kolom)) continue;
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
    let badan = '';
    req.on('data', (d) => { badan += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const isi = badan ? JSON.parse(badan) : null;
      catatan.push({ metode: req.method, jalur: url.pathname, badan: isi });
      const satu = (req.headers.accept ?? '').includes('pgrst.object');
      const kirim = (status, data) => {
        res.writeHead(status, { 'Content-Type': satu ? 'application/vnd.pgrst.object+json' : 'application/json' });
        res.end(JSON.stringify(data));
      };
      const tabel = {
        '/rest/v1/transaksi_bank': () => FISIK,
        '/rest/v1/transaksi_bank_unik': () => FISIK,
        '/rest/v1/transaksi_bank_kembar': () => FISIK.map((f) => ({ id: f.id, entitas: f.entitas, sidik_tampil: f.sidik })),
        '/rest/v1/tautan_pembayaran': () => TAUTAN,
        '/rest/v1/pemetaan_supplier': () => [],
        '/rest/v1/pemetaan_supplier_status': () => [],
      }[url.pathname];

      if (req.method === 'GET' && tabel) {
        const hasil = layani(tabel(), url);
        return kirim(200, satu ? (hasil[0] ?? null) : hasil);
      }
      if (req.method === 'POST' && url.pathname === '/rest/v1/tautan_pembayaran') {
        TAUTAN = TAUTAN.filter((t) => t.transaksi_id !== isi.transaksi_id).concat(isi);
        return kirim(201, isi);
      }
      if (req.method === 'POST') return kirim(201, isi);
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `tidak ditiru: ${req.method} ${url.pathname}` }));
    });
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
beforeEach(() => { catatan = []; FISIK = []; TAUTAN = []; });

const alamat = (jalur) => `http://127.0.0.1:${app.address().port}${jalur}`;

const penulisan = () => catatan.filter((c) => c.metode !== 'GET');
const via = async (...n) => (await fetch(alamat(`/tautan/via-kembar?transaksi_id=${n.map(uuid).join(',')}`))).json();

test('wakil yang tidak tertaut: tautan KEMBARAN yang ditarik ditemukan (sidik tampil sama)', async () => {
  FISIK = [fisik(1, 'a', 'M ALI RIDHO'), fisik(2, 'b', 'M ALI RIDHO')];
  FISIK[0].sidik = 'sama'; FISIK[1].sidik = 'sama';
  TAUTAN = [tautanRow(2, 'ditarik')];
  const { data } = await via(1);
  assert.equal(data.length, 1);
  assert.equal(data[0].transaksi_id, uuid(1), 'id yang dipilih');
  assert.equal(data[0].tautan.transaksi_id, uuid(2), 'tautan milik kembarannya');
  assert.equal(data[0].tautan.status, 'ditarik');
  assert.deepEqual(penulisan(), [], 'murni baca');
});

test('transfer yang sama dari DUA CETAKAN (sidik berbeda) juga ditemukan', async () => {
  FISIK = [fisik(1, 'a', MUTASI), fisik(2, 'b', ESTATEMENT)];
  TAUTAN = [tautanRow(1, 'ditarik')];
  const { data } = await via(2);
  assert.equal(data.length, 1);
  assert.equal(data[0].tautan.transaksi_id, uuid(1));
});

test('yang dirinya sendiri sudah tertaut tidak dilaporkan (sudah ditangani pilahan biasa)', async () => {
  FISIK = [fisik(1, 'a', 'X'), fisik(2, 'b', 'X')];
  FISIK[0].sidik = 'sama'; FISIK[1].sidik = 'sama';
  TAUTAN = [tautanRow(1, 'ditarik'), tautanRow(2, 'ditarik')];
  assert.deepEqual((await via(1)).data, []);
});

test('tanpa kembaran tertaut, atau kembarannya dibatalkan: kosong', async () => {
  FISIK = [fisik(1, 'a', 'Y'), fisik(2, 'b', 'Y'), fisik(3, 'c', 'LAIN', '2026-10-05', 777)];
  FISIK[0].sidik = 'sama'; FISIK[1].sidik = 'sama';
  assert.deepEqual((await via(1, 3)).data, []);
  TAUTAN = [tautanRow(2, 'dibatalkan')];
  assert.deepEqual((await via(1)).data, [], 'tautan dibatalkan tidak mengunci');
});

test('id yang bukan uuid diabaikan; tanpa id: kosong', async () => {
  assert.deepEqual((await (await fetch(alamat('/tautan/via-kembar?transaksi_id=bukan-uuid'))).json()).data, []);
  assert.deepEqual((await (await fetch(alamat('/tautan/via-kembar'))).json()).data, []);
});

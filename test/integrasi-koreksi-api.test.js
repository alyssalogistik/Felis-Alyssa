// PATCH /tautan/:id (koreksi supplier), dijalankan SUNGGUHAN terhadap PostgREST
// palsu. Router dan klien supabase-js yang dipakai yang asli.
//
// Yang dijaga: koreksi ke supplier yang sama dan koreksi kedua sebelum yang
// pertama diakui ditolak 409 TANPA menulis apa pun; koreksi sah menandai yang
// sudah ditarik `perlu_koreksi_hilir` dengan supplier_id_lama yang benar.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dasar = (n, status, supplier_id = '0c2408c0') => ({
  transaksi_id: uuid(n), supplier_id, supplier_nama: 'AHMAD TAUFDIQ', entitas: 'PT_ALYSSA_AUTO_LOGISTIK',
  tanggal: '2026-10-01', nominal: 10000000, sidik: `s${n}`, status,
  ditautkan_pada: '2026-10-02T00:00:00Z', ditautkan_oleh: 'uji',
  batch_tarik: null, ditarik_pada: null, dibatalkan_pada: null, dibatalkan_oleh: null, alasan: null,
});

let TAUTAN; let catatan; let hulu; let app;

before(async () => {
  hulu = createServer((req, res) => {
    let badan = '';
    req.on('data', (d) => { badan += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      const isi = badan ? JSON.parse(badan) : null;
      catatan.push({ metode: req.method, jalur: url.pathname, badan: isi });
      const id = (url.searchParams.get('transaksi_id') ?? '').replace('eq.', '');
      const kirim = (status, data) => {
        res.writeHead(status, { 'Content-Type': 'application/vnd.pgrst.object+json' });
        res.end(JSON.stringify(data));
      };

      if (url.pathname === '/rest/v1/tautan_pembayaran' && req.method === 'GET') {
        return kirim(200, TAUTAN.find((t) => t.transaksi_id === id) ?? null);
      }
      if (url.pathname === '/rest/v1/tautan_pembayaran' && req.method === 'PATCH') {
        const baris = TAUTAN.find((t) => t.transaksi_id === id);
        Object.assign(baris, isi);
        return kirim(200, baris);
      }
      if (url.pathname === '/rest/v1/tautan_pembayaran_riwayat' && req.method === 'POST') {
        return kirim(201, isi);
      }
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
beforeEach(() => { catatan = []; TAUTAN = []; });

const koreksi = async (n, isi) => {
  const res = await fetch(`http://127.0.0.1:${app.address().port}/tautan/${uuid(n)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isi),
  });
  return { status: res.status, isi: await res.json() };
};
const tulis = () => catatan.filter((c) => c.metode !== 'GET');
const BARU = { supplier_id: '73e746fc', supplier_nama: 'AHMAD TAUFDIQ BARU', alasan: 'id salah pilih' };

test('KAIDAH: koreksi ke supplier_id yang SAMA ditolak 409 dan tidak menulis apa pun', async () => {
  TAUTAN = [dasar(1, 'ditarik')];
  const { status, isi } = await koreksi(1, { ...BARU, supplier_id: '0c2408c0' });
  assert.equal(status, 409);
  assert.equal(isi.kode, 'sudah_supplier_itu');
  assert.match(isi.pesan, /Tidak ada yang perlu dikoreksi/);
  assert.deepEqual(tulis(), []);
  assert.equal(TAUTAN[0].status, 'ditarik', 'tidak menjadi perlu_koreksi_hilir tanpa perubahan');
});

test('huruf besar pada supplier_id yang sama tetap dikenali sebagai sama', async () => {
  TAUTAN = [dasar(1, 'ditarik')];
  const { status } = await koreksi(1, { ...BARU, supplier_id: '0C2408C0' });
  assert.equal(status, 409);
  assert.deepEqual(tulis(), []);
});

test('KAIDAH: koreksi kedua sebelum yang pertama diakui ditolak (tanpa supplier perantara)', async () => {
  TAUTAN = [dasar(1, 'perlu_koreksi_hilir', '73e746fc')];
  const { status, isi } = await koreksi(1, { ...BARU, supplier_id: 'aaaaaaaa' });
  assert.equal(status, 409);
  assert.equal(isi.kode, 'menunggu_koreksi');
  assert.deepEqual(tulis(), []);
  assert.equal(TAUTAN[0].supplier_id, '73e746fc', 'supplier yang diminta pertama tidak tertimpa');
});

test('sudah ditarik: menjadi perlu_koreksi_hilir, riwayat memuat supplier lama yang BENAR', async () => {
  TAUTAN = [dasar(1, 'ditarik')];
  const { status, isi } = await koreksi(1, BARU);
  assert.equal(status, 200);
  assert.equal(isi.status, 'perlu_koreksi_hilir');
  assert.equal(isi.menunggu_alyssa_dev, true);
  assert.equal(isi.supplier_id, '73e746fc');

  const riwayat = catatan.find((c) => c.jalur.endsWith('/tautan_pembayaran_riwayat'));
  assert.equal(riwayat.badan.supplier_id_lama, '0c2408c0', 'yang dipegang alyssa-dev');
  assert.equal(riwayat.badan.supplier_id_baru, '73e746fc');
  assert.equal(riwayat.badan.status_lama, 'ditarik');
  assert.equal(riwayat.badan.status_baru, 'perlu_koreksi_hilir');
  assert.equal(riwayat.badan.alasan, 'id salah pilih');
  assert.equal(riwayat.badan.oleh, 'owner@contoh.test', 'pelaku dari sesi');
});

test('belum ditarik: supplier berubah langsung, tanpa menunggu alyssa-dev', async () => {
  TAUTAN = [dasar(1, 'siap')];
  const { status, isi } = await koreksi(1, BARU);
  assert.equal(status, 200);
  assert.equal(isi.status, 'siap');
  assert.equal(isi.menunggu_alyssa_dev, false);
});

test('tautan dibatalkan: pesan lama dipertahankan (tautkan ulang saja)', async () => {
  TAUTAN = [dasar(1, 'dibatalkan')];
  const { status, isi } = await koreksi(1, BARU);
  assert.equal(status, 409);
  assert.equal(isi.pesan, 'Tautan ini sudah dibatalkan. Tautkan ulang saja.');
  assert.deepEqual(tulis(), []);
});

test('supplier_id yang bukan 8 hex ditolak 400, tautan tidak ditemukan 404', async () => {
  TAUTAN = [dasar(1, 'ditarik')];
  const salah = await koreksi(1, { ...BARU, supplier_id: 'zzzz' });
  assert.equal(salah.status, 400);
  const hantu = await koreksi(99, BARU);
  assert.equal(hantu.status, 404);
  assert.deepEqual(tulis(), []);
});

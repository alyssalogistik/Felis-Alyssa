// Endpoint POST /tautan/:id/lepas, dijalankan SUNGGUHAN terhadap PostgREST palsu.
//
// Router yang dipakai adalah router aslinya dan klien supabase-js yang asli;
// yang ditiru hanya server di ujungnya. Jadi yang terbukti adalah apa yang
// benar-benar dikirim endpoint dan apa yang dijawabnya, bukan hasil tiruan
// fungsi di dalamnya.
//
// Dua kaidah:
//   - benturan permintaan bersamaan dijawab 409 (bukan 500);
//   - status dan jejak audit TIDAK PERNAH ditulis sebagai dua perintah
//     terpisah dari aplikasi — hanya satu panggilan fungsi database yang atomik.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const ID = '11111111-1111-4111-8111-111111111111';

const TAUTAN = {
  transaksi_id: ID, supplier_id: '0c2408c0', supplier_nama: 'AHMAD TAUFDIQ',
  entitas: 'PT_ALYSSA_AUTO_LOGISTIK', tanggal: '2026-10-01', nominal: 10000000,
  sidik: 'x', status: 'ditarik', ditautkan_pada: '2026-10-02T00:00:00Z', ditautkan_oleh: 'uji',
  batch_tarik: '22222222-2222-4222-8222-222222222222', ditarik_pada: '2026-10-03T00:00:00Z',
  dibatalkan_pada: null, dibatalkan_oleh: null, alasan: null,
};

let hulu;            // PostgREST palsu
let app;             // server Express yang memuat router asli
let jawabRpc;        // perilaku fungsi lepas_tautan() yang ditiru: (badan) => {status, isi}
let catatan;         // semua permintaan yang diterima hulu

before(async () => {
  hulu = createServer((req, res) => {
    let badan = '';
    req.on('data', (d) => { badan += d; });
    req.on('end', () => {
      const url = new URL(req.url, 'http://x');
      catatan.push({ metode: req.method, jalur: url.pathname, badan: badan ? JSON.parse(badan) : null });

      if (req.method === 'GET' && url.pathname === '/rest/v1/tautan_pembayaran') {
        res.writeHead(200, { 'Content-Type': 'application/vnd.pgrst.object+json' });
        return res.end(JSON.stringify(TAUTAN));
      }
      if (req.method === 'POST' && url.pathname === '/rest/v1/rpc/lepas_tautan') {
        const { status, isi } = jawabRpc(JSON.parse(badan));
        res.writeHead(status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(isi));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'tidak ditiru' }));
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
beforeEach(() => { catatan = []; });

const lepas = (isi) => fetch(`http://127.0.0.1:${app.address().port}/tautan/${ID}/lepas`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(isi),
});

const panggilanRpc = () => catatan.filter((c) => c.jalur === '/rest/v1/rpc/lepas_tautan');

test('KAIDAH 409: permintaan bersamaan yang kalah dijawab 409, bukan 500', async () => {
  // Fungsi database mengembalikan NOL baris ketika status sudah berubah.
  jawabRpc = () => ({ status: 200, isi: [] });

  const res = await lepas({ alasan: 'salah supplier' });
  assert.equal(res.status, 409);
  const isi = await res.json();
  assert.equal(isi.kode, 'status_berubah');
  assert.match(isi.pesan, /baru saja berubah/);
  assert.match(isi.pesan, /Tidak ada yang diubah/);
});

test('berhasil: 200, dengan parameter yang benar dan SATU panggilan fungsi', async () => {
  jawabRpc = (b) => ({ status: 200, isi: [{ ...TAUTAN, status: b.p_status_baru, alasan: b.p_alasan }] });

  const res = await lepas({ alasan: 'salah supplier' });
  assert.equal(res.status, 200);
  const isi = await res.json();
  assert.equal(isi.status, 'menunggu_lepas');
  assert.equal(isi.dilepas_paksa, false);

  const [rpc] = panggilanRpc();
  assert.equal(panggilanRpc().length, 1);
  assert.equal(rpc.badan.p_transaksi_id, ID);
  assert.equal(rpc.badan.p_status_lama, 'ditarik', 'bersyarat status yang dibaca tadi');
  assert.equal(rpc.badan.p_status_baru, 'menunggu_lepas');
  assert.equal(rpc.badan.p_oleh, 'owner@contoh.test', 'pelaku diambil dari sesi, bukan dari isian');
  assert.equal(rpc.badan.p_batalkan, false);
});

test('KAIDAH ATOMIK: tidak ada penulisan terpisah ke tabel tautan maupun riwayat', async () => {
  jawabRpc = (b) => ({ status: 200, isi: [{ ...TAUTAN, status: b.p_status_baru }] });
  await lepas({ alasan: 'salah supplier' });

  const tulis = catatan.filter((c) => c.metode !== 'GET' && c.jalur !== '/rest/v1/rpc/lepas_tautan');
  assert.deepEqual(tulis, [], 'status dan jejak hanya boleh lewat fungsi atomik');
});

test('jejak audit gagal di database: 500 yang menyebut seluruhnya dibatalkan', async () => {
  // Galat dari DALAM fungsi berarti transaksinya sudah dibatalkan seluruhnya.
  jawabRpc = () => ({ status: 400, isi: { code: 'P0001', message: 'riwayat ditolak (uji)', details: null, hint: null } });

  const res = await lepas({ alasan: 'salah supplier' });
  assert.equal(res.status, 500);
  const isi = await res.json();
  assert.equal(isi.kode, 'pelepasan_gagal');
  assert.match(isi.pesan, /dibatalkan seluruhnya/);
  assert.match(isi.pesan, /tetap seperti semula/);
  assert.equal(panggilanRpc().length, 1, 'tidak mencoba ulang atau menulis jejak sendiri');
});

test('pelepasan paksa: meminta pembatalan dan mencatat pernyataan hilir di jejak', async () => {
  jawabRpc = (b) => ({ status: 200, isi: [{ ...TAUTAN, status: b.p_status_baru }] });

  const res = await lepas({ alasan: 'sudah dihapus', paksa: true, sudah_dihapus_di_hilir: true });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).dilepas_paksa, true);

  const [rpc] = panggilanRpc();
  assert.equal(rpc.badan.p_status_baru, 'dibatalkan');
  assert.equal(rpc.badan.p_batalkan, true);
  assert.match(rpc.badan.p_alasan_riwayat, /dinyatakan sudah dihapus di alyssa-dev/);
});

test('penolakan aturan (belum ditarik, alasan kosong) tidak menyentuh fungsi database', async () => {
  jawabRpc = () => { throw new Error('tidak boleh dipanggil'); };

  const tanpaAlasan = await lepas({ alasan: '' });
  assert.equal(tanpaAlasan.status, 409);
  assert.equal(panggilanRpc().length, 0);

  const paksaTanpaPernyataan = await lepas({ alasan: 'x', paksa: true });
  assert.equal(paksaTanpaPernyataan.status, 409);
  assert.equal(panggilanRpc().length, 0);
});

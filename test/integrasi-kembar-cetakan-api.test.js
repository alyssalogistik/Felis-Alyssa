// Penjaga transfer yang sama dari DUA CETAKAN BCA, dijalankan SUNGGUHAN
// terhadap PostgREST palsu (router dan klien supabase-js yang asli).
//
// Kasus nyata: satu transfer Rp 10.000.000 tersimpan dari Mutasi dan dari
// e-statement dengan keterangan dan referensi berbeda, sehingga `sidik_tampil`
// tidak mengenalinya. Keduanya tertaut dan ditarik ke alyssa-dev: dibayar dua kali.

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
const tautkan = async (n) => {
  const res = await fetch(alamat('/tautan'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaksi_id: uuid(n), supplier_id: '0c2408c0', supplier_nama: 'AHMAD TAUFDIQ' }),
  });
  return { status: res.status, isi: await res.json() };
};
const panel = async (kueri = '') => (await fetch(alamat(`/tautan/siap-tautkan${kueri}`))).json();
const penulisan = () => catatan.filter((c) => c.metode !== 'GET');
const pasanganNyata = () => { FISIK = [fisik(1, 'mutasi', MUTASI), fisik(2, 'estatement', ESTATEMENT)]; };

test('KASUS NYATA: Mutasi sudah tertaut, menautkan e-statement ditolak 409 dan tidak menulis apa pun', async () => {
  pasanganNyata();
  TAUTAN = [tautanRow(1)];
  const { status, isi } = await tautkan(2);
  assert.equal(status, 409);
  assert.equal(isi.kode, 'kembar_sudah_ditaut');
  assert.match(isi.pesan, /sudah ditautkan/);
  assert.deepEqual(isi.kembar.map((t) => t.transaksi_id), [uuid(1)]);
  assert.deepEqual(penulisan(), [], 'tidak ada tautan atau riwayat yang tertulis');
});

test('kebalikannya: e-statement tertaut lebih dulu, Mutasi ditolak', async () => {
  pasanganNyata();
  TAUTAN = [tautanRow(2)];
  assert.equal((await tautkan(1)).status, 409);
  assert.deepEqual(penulisan(), []);
});

test('belum ada yang tertaut: salah satunya boleh ditautkan, lalu yang lain ditolak', async () => {
  pasanganNyata();
  const pertama = await tautkan(1);
  assert.equal(pertama.status, 201);
  assert.ok(penulisan().length > 0);

  const kedua = await tautkan(2);
  assert.equal(kedua.status, 409, 'baris kedua dari transfer yang sama');
  assert.equal(kedua.isi.kode, 'kembar_sudah_ditaut');
});

test('KAIDAH MENGHITUNG: dua transfer nyata identik tidak terblokir keliru', async () => {
  const t = 'TARIK TUNAI ATM 0123456 5000000.00';
  FISIK = [
    fisik(1, 'mutasi', `TRSF E-BANKING DB ${t}`, '2026-10-02', 5000000),
    fisik(2, 'mutasi', `TRSF E-BANKING DB ${t}`, '2026-10-02', 5000000),
    fisik(3, 'estatement', t, '2026-10-02', 5000000),
    fisik(4, 'estatement', t, '2026-10-02', 5000000),
  ];
  TAUTAN = [tautanRow(1, 'ditarik', '2026-10-02', 5000000)];

  const kedua = await tautkan(3);
  assert.equal(kedua.status, 201, 'transfer nyata yang kedua masih harus bisa dibayarkan');

  const ketiga = await tautkan(4);
  assert.equal(ketiga.status, 409, 'kedua transfer nyata sudah tertaut; sisanya salinan');
});

test('transfer berbeda (nominal atau penerima) tidak terhalang', async () => {
  FISIK = [
    fisik(1, 'mutasi', MUTASI),
    fisik(2, 'estatement', ESTATEMENT.replace('AHMAD TAUFDIQ', 'BUDI SANTOSO')),
    fisik(3, 'estatement', ESTATEMENT.replace('10000000.00', '9000000.00'), '2026-10-01', 9000000),
  ];
  TAUTAN = [tautanRow(1)];
  assert.equal((await tautkan(2)).status, 201);
  assert.equal((await tautkan(3)).status, 201);
});

test('tautan DIBATALKAN membebaskan: kembar lintas cetakan tidak mengunci', async () => {
  pasanganNyata();
  TAUTAN = [tautanRow(1, 'dibatalkan')];
  assert.equal((await tautkan(2)).status, 201);
});

test('/tautan/saran melaporkan kembar lintas cetakan yang tertaut, supaya layar bisa menyebutnya', async () => {
  pasanganNyata();
  TAUTAN = [tautanRow(1)];
  const res = await fetch(alamat(`/tautan/saran?transaksi_id=${uuid(2)}`));
  const isi = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual(isi.kembar_sudah_ditaut.map((t) => t.transaksi_id), [uuid(1)]);
});

test('PANEL: salinan dari cetakan lain yang transfernya sudah tertaut disembunyikan dan dihitung', async () => {
  // Wakil view (satu baris per transfer unik di mata view) adalah e-statement,
  // sedangkan yang tertaut adalah Mutasi.
  FISIK = [
    fisik(1, 'mutasi', MUTASI), fisik(2, 'estatement', ESTATEMENT),
    fisik(7, 'mutasi', 'TRSF E-BANKING DB PEMBAYARAN BUDI SANTOSO', '2026-10-05', 750000),
  ];
  TAUTAN = [tautanRow(1)];
  const isi = await panel();
  assert.deepEqual(isi.data.map((t) => t.bank_transaction_id).sort(), [uuid(7)]);
  assert.deepEqual(isi.disembunyikan_cetakan_lain, { jumlah: 1, total: 10000000 });
});

test('PANEL: dua transfer nyata, satu tertaut: tidak ada yang disembunyikan keliru', async () => {
  const t = 'TARIK TUNAI ATM 0123456 5000000.00';
  FISIK = [
    fisik(1, 'mutasi', `TRSF E-BANKING DB ${t}`, '2026-10-02', 5000000),
    fisik(2, 'mutasi', `TRSF E-BANKING DB ${t}`, '2026-10-02', 5000000),
    fisik(3, 'estatement', t, '2026-10-02', 5000000),
    fisik(4, 'estatement', t, '2026-10-02', 5000000),
  ];
  TAUTAN = [tautanRow(1, 'ditarik', '2026-10-02', 5000000)];
  const isi = await panel();
  assert.equal(isi.disembunyikan_cetakan_lain.jumlah, 0, 'masih ada satu transfer nyata yang belum dibayarkan');
  assert.ok(isi.data.length >= 1);
});

test('PANEL: tanpa tautan sama sekali, perilaku lama tidak berubah', async () => {
  pasanganNyata();
  const isi = await panel();
  assert.equal(isi.data.length, 2);
  assert.deepEqual(isi.disembunyikan_cetakan_lain, { jumlah: 0, total: 0 });
});

test('PANEL: halaman tidak diperpendek oleh yang disembunyikan lintas cetakan', async () => {
  FISIK = [fisik(1, 'mutasi', MUTASI), fisik(2, 'estatement', ESTATEMENT)];
  for (let i = 10; i < 16; i++) {
    FISIK.push(fisik(i, 'mutasi', `TRSF E-BANKING DB PEMBAYARAN ${i}`, `2026-09-${i}`, 100000 + i));
  }
  TAUTAN = [tautanRow(1)];
  const isi = await panel('?batas=3');
  assert.equal(isi.data.length, 3, 'tiga baris bebas tetap tampil walau satu disembunyikan');
  assert.equal(isi.tercapai_batas, true);
});

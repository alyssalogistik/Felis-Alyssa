import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS, AKSI, SEBAB, layakDilepas, layakDitarik, idTerpakai } from '../src/integrasi/tautan.js';

const tautan = (tambahan = {}) => ({
  transaksi_id: 'aaaa0001-0000-4000-8000-000000000001',
  supplier_id: '091bc61d',
  supplier_nama: 'MARTHEN RUNTURAMBI',
  entitas: 'PT_ALYSSA_AUTO_LOGISTIK',
  tanggal: '2026-09-26',
  nominal: 2000000,
  status: STATUS.DITARIK,
  ...tambahan,
});

const ALASAN = { alasan: 'salah supplier saat uji coba' };

// --- Yang BELUM ditarik tidak lewat jalur ini -----------------------------

test('tautan siap ditolak: pembatalannya sudah punya tombol sendiri', () => {
  // Dua jalur untuk satu hal berarti dua tempat yang bisa menyimpang, dan yang
  // menyimpang di sini melepas pembayaran yang seharusnya tertahan.
  const h = layakDilepas(tautan({ status: STATUS.SIAP }), ALASAN);
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB.BELUM_DITARIK);
});

test('tautan yang sudah dibatalkan ditolak, bukan dilepas dua kali', () => {
  const h = layakDilepas(tautan({ status: STATUS.DIBATALKAN }), ALASAN);
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB.SUDAH_DILEPAS);
});

test('tautan tidak ditemukan ditolak', () => {
  assert.equal(layakDilepas(null, ALASAN).ok, false);
  assert.equal(layakDilepas(undefined, ALASAN).ok, false);
});

// --- Alasan wajib ----------------------------------------------------------

test('alasan kosong selalu ditolak, termasuk saat dipaksa', () => {
  // Alasan inilah satu-satunya keterangan yang tersisa saat angkanya diperiksa
  // berbulan kemudian.
  for (const opsi of [{}, { alasan: '   ' }, { alasan: '', paksa: true, sudah_dihapus_di_hilir: true }]) {
    const h = layakDilepas(tautan(), opsi);
    assert.equal(h.ok, false, JSON.stringify(opsi));
    assert.equal(h.sebab, SEBAB.ALASAN_KOSONG);
  }
});

test('alasan dirapikan spasinya sebelum disimpan', () => {
  const h = layakDilepas(tautan(), { alasan: '  salah supplier  ' });
  assert.equal(h.ok, true);
  assert.equal(h.alasan, 'salah supplier');
});

// --- Jalur AMAN adalah bawaannya ------------------------------------------

test('tanpa paksa, tautan ditarik menjadi MENUNGGU LEPAS, bukan dibatalkan', () => {
  // Keadaan yang dipegang dua sistem tidak boleh diubah sepihak.
  const h = layakDilepas(tautan(), ALASAN);
  assert.equal(h.ok, true);
  assert.equal(h.paksa, false);
  assert.equal(h.status_baru, STATUS.MENUNGGU_LEPAS);
  assert.equal(h.aksi, AKSI.MINTA_LEPAS);
});

test('koreksi yang belum diakui alyssa-dev juga lewat jalur aman', () => {
  const h = layakDilepas(tautan({ status: STATUS.PERLU_KOREKSI_HILIR }), ALASAN);
  assert.equal(h.ok, true);
  assert.equal(h.status_baru, STATUS.MENUNGGU_LEPAS);
});

test('yang sudah menunggu tidak boleh diminta dua kali', () => {
  const h = layakDilepas(tautan({ status: STATUS.MENUNGGU_LEPAS }), ALASAN);
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB.SUDAH_MENUNGGU_LEPAS);
});

// --- Jalur PAKSA menuntut pernyataan eksplisit ----------------------------

test('paksa TANPA pernyataan hilir ditolak', () => {
  // Yang dikunci bukan kebenarannya — Felis tidak punya cara memeriksanya —
  // melainkan siapa yang menyatakannya.
  const h = layakDilepas(tautan(), { ...ALASAN, paksa: true });
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB.HILIR_BELUM_DIPASTIKAN);
});

test('pernyataan hilir harus true, bukan sekadar bernilai benar', () => {
  for (const nilai of ['ya', 1, 'true', {}]) {
    const h = layakDilepas(tautan(), { ...ALASAN, paksa: true, sudah_dihapus_di_hilir: nilai });
    assert.equal(h.ok, false, String(nilai));
  }
});

test('paksa lengkap menjadi DIBATALKAN', () => {
  const h = layakDilepas(tautan(), { ...ALASAN, paksa: true, sudah_dihapus_di_hilir: true });
  assert.equal(h.ok, true);
  assert.equal(h.paksa, true);
  assert.equal(h.status_baru, STATUS.DIBATALKAN);
  assert.equal(h.aksi, AKSI.LEPAS_PAKSA);
});

test('yang menunggu lepas BOLEH dipaksa — itu jalan keluarnya', () => {
  // Kalau alyssa-dev ternyata tidak akan pernah mengaku, tanpa ini barisnya
  // terjebak selamanya di status antara.
  const h = layakDilepas(tautan({ status: STATUS.MENUNGGU_LEPAS }),
    { ...ALASAN, paksa: true, sudah_dihapus_di_hilir: true });
  assert.equal(h.ok, true);
  assert.equal(h.status_baru, STATUS.DIBATALKAN);
});

test('paksa tidak pernah dipakai untuk tautan siap', () => {
  const h = layakDilepas(tautan({ status: STATUS.SIAP }),
    { ...ALASAN, paksa: true, sudah_dihapus_di_hilir: true });
  assert.equal(h.ok, false);
  assert.equal(h.sebab, SEBAB.BELUM_DITARIK);
});

// --- Tidak boleh terkirim ulang tanpa ditautkan lagi ----------------------

test('MENUNGGU LEPAS tidak pernah ikut tertarik', () => {
  // Kalau ikut, transaksinya bisa tertarik lagi justru selagi pelepasannya
  // sedang diproses — persis pencatatan ganda yang hendak dicegah.
  const h = layakDitarik(tautan({ status: STATUS.MENUNGGU_LEPAS }));
  assert.equal(h.ok, false);
});

test('MENUNGGU LEPAS masih dianggap TERPAKAI, jadi belum bisa ditautkan ulang', () => {
  const terpakai = idTerpakai([
    { transaksi_id: 'a', status: STATUS.MENUNGGU_LEPAS },
    { transaksi_id: 'b', status: STATUS.DIBATALKAN },
  ]);
  assert.equal(terpakai.has('a'), true, 'yang menunggu belum bebas');
  assert.equal(terpakai.has('b'), false, 'yang sudah dilepas bebas');
});

test('hanya status DIBATALKAN yang benar-benar membebaskan transaksi', () => {
  for (const status of [STATUS.SIAP, STATUS.DITARIK, STATUS.PERLU_KOREKSI_HILIR, STATUS.MENUNGGU_LEPAS]) {
    assert.equal(idTerpakai([{ transaksi_id: 'x', status }]).has('x'), true, status);
  }
  assert.equal(idTerpakai([{ transaksi_id: 'x', status: STATUS.DIBATALKAN }]).has('x'), false);
});

// --- Alokasi PO ------------------------------------------------------------

test('pelepasan tidak menyentuh alokasi pekerjaan', () => {
  // layakDilepas memutuskan nasib TAUTAN saja. Alokasi disimpan di tabelnya
  // sendiri dan tidak pernah masuk ke keputusan ini — kalau suatu saat ikut,
  // pengujian ini yang jatuh lebih dulu.
  const dengan = layakDilepas(tautan({ alokasi: 'PO-2026-014' }), ALASAN);
  const tanpa = layakDilepas(tautan(), ALASAN);
  assert.deepEqual(dengan, tanpa);
});

test('nominal dan tanggal tidak pernah menggugurkan pelepasan', () => {
  // Yang dilepas catatan ikatannya, bukan uangnya. Baris bernominal berapa pun
  // dan bertanggal kapan pun tetap boleh dilepas kalau statusnya ditarik.
  const h = layakDilepas(tautan({ nominal: 0, tanggal: null }), ALASAN);
  assert.equal(h.ok, true);
});

// --- Penjaga nama status ---------------------------------------------------

test('menunggu_lepas terpisah dari perlu_koreksi_hilir', () => {
  // Keduanya sama-sama menunggu alyssa-dev, tetapi menuntut hal yang BERLAWANAN
  // di sana: yang satu memindahkan pembayaran, yang satu menghapusnya.
  assert.notEqual(STATUS.MENUNGGU_LEPAS, STATUS.PERLU_KOREKSI_HILIR);
  assert.equal(STATUS.MENUNGGU_LEPAS, 'menunggu_lepas');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS, SEBAB,
  kodeBankDari, kunciSaran, layakDitautkan, supplierValid, pilihSaran, layakDitarik, payloadPembayaran,
} from '../src/integrasi/tautan.js';

// --- Kode bank -------------------------------------------------------------

test('kode bank dikenali dari kedua bentuk yang dicetak BCA', () => {
  assert.equal(kodeBankDari('BI-FAST DB TRANSFER KE 002 MARTHEN RUNTURAMBI KBB'), '002');
  assert.equal(kodeBankDari('SWITCHING DB TRF SHEEHAN ALIF RAMAD 501 KBB'), '501');
  assert.equal(kodeBankDari('BI-FAST DB BIAYA TXN KE 022 JAKA SURYA LAKSANA KBB'), '022');
});

test('transfer sesama BCA tidak punya kode bank, dan itu bukan galat', () => {
  // Diukur pada data sungguhan: 235 dari 453 transaksi keluar seperti ini.
  // Kalau kode bank dijadikan syarat, separuh transaksi tidak pernah bisa
  // disarankan sama sekali.
  assert.equal(kodeBankDari('TRSF E-BANKING DB 1709/FTSCY/WS95051 300000.00 HERMANSYAH'), null);
});

// --- Kunci saran -----------------------------------------------------------

test('kunci saran menggabungkan nama dan kode bank', () => {
  // "KBB" ikut terbawa karena namaDariKeterangan() tidak mengupasnya, dan itu
  // DIBIARKAN: fungsi itu dipakai bersama daftar supplier di layar, jadi
  // mengubahnya akan mengubah nama yang dilihat orang di panel lain.
  //
  // Konsekuensinya satu supplier bisa punya beberapa kunci — satu dari
  // cetakan BI-FAST ("... KBB") dan satu dari e-banking (tanpa). Itu tidak
  // merugikan: semuanya menunjuk supplier_id yang sama, persis seperti aturan
  // "satu supplier boleh punya beberapa rekening/jalur".
  assert.equal(kunciSaran('BI-FAST DB TRANSFER KE 002 MARTHEN RUNTURAMBI KBB'), 'MARTHEN RUNTURAMBI KBB|002');
  assert.equal(kunciSaran('TRSF E-BANKING DB 1709/FTSCY/WS95051 300000.00 HERMANSYAH'), 'HERMANSYAH|');
});

test('kunci saran stabil: keterangan yang sama selalu menghasilkan kunci yang sama', () => {
  const a = kunciSaran('BI-FAST DB TRANSFER KE 002 MARTHEN RUNTURAMBI KBB');
  const b = kunciSaran('BI-FAST  DB  TRANSFER  KE  002  MARTHEN  RUNTURAMBI  KBB');
  assert.equal(a, b);
});

test('keterangan tanpa nama tidak menghasilkan kunci', () => {
  assert.equal(kunciSaran('BIAYA ADM'), null);
  assert.equal(kunciSaran(''), null);
});

// --- Kelayakan ditautkan ---------------------------------------------------

test('baris kredit tidak bisa menjadi pembayaran supplier', () => {
  const hasil = layakDitautkan({ debit: 0, kredit: 5000000, tanggal: '2026-09-24' });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.sebab, SEBAB.BUKAN_PENGELUARAN);
});

test('baris PEND ditolak karena belum punya tanggal buku', () => {
  // Tanggal karangan tidak menimbulkan galat apa pun dan baru ketahuan saat
  // angka auditnya dipakai.
  const hasil = layakDitautkan({ debit: 3000000, tanggal: null });
  assert.equal(hasil.ok, false);
  assert.equal(hasil.sebab, SEBAB.TANPA_TANGGAL);
});

test('transaksi pengeluaran bertanggal boleh ditautkan', () => {
  assert.equal(layakDitautkan({ debit: 3000000, tanggal: '2026-09-24' }).ok, true);
});

test('yang sudah ditautkan ditolak, dan yang sudah ditarik ditolak dengan sebab berbeda', () => {
  const siap = layakDitautkan({ debit: 1, tanggal: '2026-09-24' }, { status: STATUS.SIAP });
  assert.equal(siap.ok, false);
  assert.equal(siap.sebab, SEBAB.SUDAH_DITAUT);

  const ditarik = layakDitautkan({ debit: 1, tanggal: '2026-09-24' }, { status: STATUS.DITARIK });
  assert.equal(ditarik.ok, false);
  assert.equal(ditarik.sebab, SEBAB.SUDAH_DITARIK);
});

test('tautan yang sudah dibatalkan tidak menghalangi pengikatan ulang', () => {
  const hasil = layakDitautkan({ debit: 1, tanggal: '2026-09-24' }, { status: STATUS.DIBATALKAN });
  assert.equal(hasil.ok, true);
});

// --- Supplier --------------------------------------------------------------

test('supplier_id dan nama wajib keduanya', () => {
  assert.equal(supplierValid({ supplier_id: 'SUP-1', supplier_nama: 'X' }).ok, true);
  assert.equal(supplierValid({ supplier_id: '', supplier_nama: 'X' }).ok, false);
  assert.equal(supplierValid({ supplier_id: 'SUP-1', supplier_nama: '  ' }).ok, false);
  assert.equal(supplierValid({}).sebab, SEBAB.SUPPLIER_KOSONG);
});

// --- Saran dan konflik -----------------------------------------------------

test('tanpa pemetaan tidak ada saran', () => {
  const hasil = pilihSaran([]);
  assert.equal(hasil.saran, null);
  assert.equal(hasil.konflik, false);
});

test('satu supplier menghasilkan saran', () => {
  const hasil = pilihSaran([{ supplier_id: 'SUP-1', supplier_nama: 'A', status: 'aktif' }]);
  assert.equal(hasil.saran.supplier_id, 'SUP-1');
  assert.equal(hasil.konflik, false);
});

test('DUA SUPPLIER NAMA SAMA: tidak ada yang dipilihkan, keduanya dilaporkan', () => {
  // Inilah keadaan yang seluruh desain ini jaga. Menebak salah satunya berarti
  // membayar supplier yang salah, dan itu tidak menimbulkan galat apa pun.
  const hasil = pilihSaran([
    { supplier_id: 'SUP-1', supplier_nama: 'BUDI SANTOSO', status: 'aktif' },
    { supplier_id: 'SUP-2', supplier_nama: 'BUDI SANTOSO', status: 'aktif' },
  ]);
  assert.equal(hasil.saran, null);
  assert.equal(hasil.konflik, true);
  assert.equal(hasil.kandidat.length, 2);
});

test('pemetaan nonaktif tidak ikut menimbulkan konflik', () => {
  const hasil = pilihSaran([
    { supplier_id: 'SUP-1', supplier_nama: 'BUDI', status: 'aktif' },
    { supplier_id: 'SUP-2', supplier_nama: 'BUDI', status: 'nonaktif' },
  ]);
  assert.equal(hasil.konflik, false);
  assert.equal(hasil.saran.supplier_id, 'SUP-1');
});

test('satu supplier dengan beberapa pemetaan tetap satu saran', () => {
  // Rule: satu supplier boleh punya banyak rekening/nama, semuanya mengarah
  // ke supplier_id yang sama.
  const hasil = pilihSaran([
    { supplier_id: 'SUP-1', supplier_nama: 'BUDI', status: 'aktif' },
    { supplier_id: 'SUP-1', supplier_nama: 'BUDI S', status: 'aktif' },
  ]);
  assert.equal(hasil.konflik, false);
  assert.equal(hasil.saran.supplier_id, 'SUP-1');
});

// --- Kelayakan ditarik -----------------------------------------------------

test('hanya status siap yang boleh ditarik', () => {
  const dasar = { tanggal: '2026-09-24', nominal: 1000 };
  assert.equal(layakDitarik({ ...dasar, status: STATUS.SIAP }).ok, true);
  assert.equal(layakDitarik({ ...dasar, status: STATUS.DITARIK }).ok, false);
  assert.equal(layakDitarik({ ...dasar, status: STATUS.DIBATALKAN }).ok, false);
  assert.equal(layakDitarik({ ...dasar, status: STATUS.PERLU_KOREKSI_HILIR }).ok, false);
  assert.equal(layakDitarik(null).ok, false);
});

// --- Payload ---------------------------------------------------------------

const TAUTAN = {
  transaksi_id: '9b2e4f10-0000-4000-8000-000000000001',
  supplier_id: 'SUP-00123',
  supplier_nama: 'MARTHEN RUNTURAMBI',
  entitas: 'PT_ALYSSA_AUTO_LOGISTIK',
  tanggal: '2026-09-24',
  nominal: '3000000.00',
  sidik: 'a41f',
  status: STATUS.SIAP,
};
const TRX = {
  keterangan: 'BI-FAST DB TRANSFER KE 002 MARTHEN RUNTURAMBI KBB',
  no_rekening: '0072890271',
  referensi: null,
};

test('idempotency_key selalu id transaksi fisik', () => {
  const p = payloadPembayaran(TAUTAN, TRX, 'PT Alyssa Auto Logistik');
  assert.equal(p.idempotency_key, TAUTAN.transaksi_id);
  assert.equal(p.bank_transaction_id, TAUTAN.transaksi_id);
});

test('bank_account_number SELALU null, tidak pernah diisi dari master', () => {
  // BCA tidak mencetak nomor rekening tujuan pada transfer keluar: dari 453
  // transaksi keluar sungguhan, nol yang memuatnya. Mengisinya dari master
  // akan membuat payload tampak seolah bank mengonfirmasinya.
  const p = payloadPembayaran(TAUTAN, TRX, 'PT Alyssa Auto Logistik');
  assert.equal(p.bank_account_number, null);
  assert.equal(p.bank_account_name, null);
});

test('rekening sumber adalah rekening sendiri, diberi nama yang tidak bisa tertukar', () => {
  const p = payloadPembayaran(TAUTAN, TRX, 'PT Alyssa Auto Logistik');
  assert.equal(p.source_account_number, '0072890271');
  assert.equal(p.beneficiary_bank_code, '002');
  assert.equal(p.source_entity, 'PT_ALYSSA_AUTO_LOGISTIK');
  assert.equal(p.source_entity_label, 'PT Alyssa Auto Logistik');
});

test('nominal dikirim sebagai angka, bukan teks dari database', () => {
  const p = payloadPembayaran(TAUTAN, TRX, 'PT Alyssa Auto Logistik');
  assert.equal(p.nominal, 3000000);
  assert.equal(typeof p.nominal, 'number');
});

test('nama penerima diturunkan dari keterangan, untuk ditampilkan saja', () => {
  const p = payloadPembayaran(TAUTAN, TRX, 'PT Alyssa Auto Logistik');
  assert.equal(p.beneficiary_name_raw, 'MARTHEN RUNTURAMBI KBB');
  // Yang otoritatif tetap kalimat bank apa adanya.
  assert.equal(p.deskripsi_bank, TRX.keterangan);
});

test('keterangan yang tidak bernama menghasilkan null, bukan teks kosong', () => {
  const p = payloadPembayaran(TAUTAN, { keterangan: 'BIAYA ADM' }, 'PT');
  assert.equal(p.beneficiary_name_raw, null);
});

test('tanpa alokasi, larik KOSONG — bukan null', () => {
  // Kontrak menyatakan larik kosong adalah keadaan normal; null akan memaksa
  // penarik memeriksa dua bentuk untuk hal yang sama.
  const p = payloadPembayaran(TAUTAN, TRX, 'PT');
  assert.deepEqual(p.alokasi, []);
});

test('alokasi manual masuk sebagai satu elemen CATATAN', () => {
  const p = payloadPembayaran(TAUTAN, TRX, 'PT', { keterangan: 'Proyek 15 unit Surabaya-Kupang' });
  assert.equal(p.alokasi.length, 1);
  assert.deepEqual(p.alokasi[0], {
    tipe: 'CATATAN', ref: 'Proyek 15 unit Surabaya-Kupang', nominal: 3000000,
  });
});

test('alokasi tidak pernah lebih dari satu elemen', () => {
  // transaksi_id adalah primary key tautan, jadi satu transaksi hanya pernah
  // menunjuk satu PO. Bentuk larik dipertahankan untuk perluasan nanti.
  const p = payloadPembayaran(TAUTAN, TRX, 'PT', { keterangan: 'apa pun' });
  assert.ok(p.alokasi.length <= 1);
});

test('alokasi kosong atau hanya spasi tidak menghasilkan elemen', () => {
  assert.deepEqual(payloadPembayaran(TAUTAN, TRX, 'PT', { keterangan: '' }).alokasi, []);
  assert.deepEqual(payloadPembayaran(TAUTAN, TRX, 'PT', {}).alokasi, []);
});

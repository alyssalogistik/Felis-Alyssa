import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cocokkan, ringkasAudit, kemiripanNama, normalkanNama,
  nomorInvoiceDitemukan, selisihHari, statusDariSelisih, STATUS,
} from '../src/rekonsiliasi/pencocokan.js';

const tagihan = (isi) => ({
  id: 'inv-1', pemasok_id: 'p1', pemasok_nama: 'PT TRIO PUTRA',
  no_invoice: 'INV/2026/VIII/0042', tanggal_invoice: '2026-08-01',
  gross: 5055000, pph: 100000, ...isi,
});

const transaksi = (isi) => ({
  id: 'trx-1', tanggal: '2026-08-05',
  keterangan: 'TRANSFER KE PT TRIO PUTRA', debit: 4955000, kredit: 0, ...isi,
});

// --- Penyeragaman nama ------------------------------------------------------

test('bentuk badan usaha dan kata pembayaran tidak membedakan identitas', () => {
  assert.equal(normalkanNama('PT. Trio Putra Trans'), 'TRIO PUTRA TRANS');
  assert.equal(normalkanNama('CV Sumber Rejeki'), 'SUMBER REJEKI');
  assert.equal(normalkanNama('TRANSFER KE PT TRIO PUTRA'), 'TRIO PUTRA');
});

test('nama supplier yang termuat utuh di keterangan dianggap cocok penuh', () => {
  assert.equal(kemiripanNama('PT TRIO PUTRA', 'TRANSFER KE PT TRIO PUTRA TRANS MANDIRI'), 1);
  assert.equal(kemiripanNama('Trio Putra', 'trf pembayaran trio putra'), 1);
});

test('nama yang cocok sebagian bernilai di antara, nama beda bernilai nol', () => {
  const sebagian = kemiripanNama('PT TRIO PUTRA MANDIRI', 'TRF TRIO PUTRA');
  assert.ok(sebagian > 0 && sebagian < 1, `nilai ${sebagian}`);
  assert.equal(kemiripanNama('PT SUMBER REJEKI', 'TRANSFER KE PT TRIO PUTRA'), 0);
});

// --- Nomor invoice ----------------------------------------------------------

test('nomor invoice dikenali walau pemisahnya berbeda', () => {
  assert.ok(nomorInvoiceDitemukan('INV/2026/VIII/0042', 'BAYAR INV-2026-VIII-0042'));
  assert.ok(nomorInvoiceDitemukan('INV-0042', 'trf inv0042 trio putra'));
  assert.equal(nomorInvoiceDitemukan('INV/2026/VIII/0042', 'TRANSFER RUTIN'), false);
});

test('nomor terlalu pendek tidak dijadikan bukti', () => {
  assert.equal(nomorInvoiceDitemukan('42', 'transfer 42000000'), false);
});

test('selisih hari dihitung dari teks tanggal, tanpa objek Date', () => {
  assert.equal(selisihHari('2026-08-01', '2026-08-05'), 4);
  assert.equal(selisihHari('2026-08-05', '2026-08-01'), -4);
  assert.equal(selisihHari('2026-08-01', '2026-09-01'), 31);
});

// --- PPh: inti permintaan ---------------------------------------------------

test('SKENARIO SPESIFIKASI: gross 5.055.000 - PPh 100.000 = transfer 4.955.000 -> MATCH', () => {
  const { hasil } = cocokkan([tagihan()], [transaksi()]);

  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].status, STATUS.MATCH);
  assert.equal(hasil[0].net_seharusnya, 4955000);
  assert.equal(hasil[0].selisih, 0);
  assert.ok(hasil[0].alasan.some((a) => /net setelah PPh/i.test(a)), hasil[0].alasan.join(' | '));
});

test('tanpa PPh, transfer harus sama dengan gross', () => {
  const { hasil } = cocokkan(
    [tagihan({ gross: 5000000, pph: 0 })],
    [transaksi({ debit: 5000000 })]
  );
  assert.equal(hasil[0].status, STATUS.MATCH);
  assert.equal(hasil[0].net_seharusnya, 5000000);
});

test('membayar gross padahal ada PPh terbaca sebagai LEBIH BAYAR, bukan MATCH', () => {
  // Kesalahan lapangan yang lazim: PPh lupa dipotong saat transfer.
  const { hasil } = cocokkan([tagihan()], [transaksi({ debit: 5055000 })]);

  assert.equal(hasil[0].status, STATUS.LEBIH_BAYAR);
  assert.equal(hasil[0].selisih, 100000);
  assert.ok(hasil[0].alasan.some((a) => /PPh sepertinya belum dipotong/i.test(a)));
});

// --- Status -----------------------------------------------------------------

test('kurang bayar terdeteksi berikut nominal selisihnya', () => {
  const { hasil } = cocokkan([tagihan()], [transaksi({ debit: 4000000 })]);
  assert.equal(hasil[0].status, STATUS.KURANG_BAYAR);
  assert.equal(hasil[0].selisih, -955000);
});

test('selisih receh dianggap pembulatan bank, bukan kurang bayar', () => {
  const { hasil } = cocokkan([tagihan()], [transaksi({ debit: 4954500 })]);
  assert.equal(hasil[0].status, STATUS.MATCH, 'selisih Rp500 di bawah toleransi');
});

test('tagihan tanpa transfer ditandai INVOICE BELUM ADA TRANSFER', () => {
  const { hasil } = cocokkan([tagihan()], []);
  assert.equal(hasil[0].status, STATUS.INVOICE_BELUM_ADA_TRANSFER);
  assert.equal(hasil[0].transfer_bank, null);
});

test('uang keluar tanpa tagihan ditandai TRANSFER TANPA INVOICE', () => {
  const { tanpa_tagihan } = cocokkan([], [transaksi({ keterangan: 'BIAYA ADMIN BANK', debit: 15000 })]);
  assert.equal(tanpa_tagihan.length, 1);
  assert.equal(tanpa_tagihan[0].status, STATUS.TRANSFER_TANPA_INVOICE);
});

test('uang masuk tidak pernah dianggap pembayaran tagihan', () => {
  // Penerimaan dari customer tidak boleh menutup tagihan supplier.
  const { hasil, tanpa_tagihan } = cocokkan(
    [tagihan()],
    [transaksi({ debit: 0, kredit: 4955000 })]
  );
  assert.equal(hasil[0].status, STATUS.INVOICE_BELUM_ADA_TRANSFER);
  assert.equal(tanpa_tagihan.length, 0);
});

test('statusDariSelisih menghormati toleransi', () => {
  assert.equal(statusDariSelisih(0), STATUS.MATCH);
  assert.equal(statusDariSelisih(-500), STATUS.MATCH);
  assert.equal(statusDariSelisih(-50000), STATUS.KURANG_BAYAR);
  assert.equal(statusDariSelisih(50000), STATUS.LEBIH_BAYAR);
});

// --- Kelayakan kandidat -----------------------------------------------------

test('nominal tidak pernah menggugurkan kandidat, hanya menentukan status', () => {
  // Kalau nominal jadi syarat, kurang bayar akan lenyap dari hasil audit.
  const { hasil } = cocokkan([tagihan()], [transaksi({ debit: 1000 })]);
  assert.notEqual(hasil[0].status, STATUS.INVOICE_BELUM_ADA_TRANSFER);
  assert.equal(hasil[0].transfer_bank, 1000);
});

test('transfer di luar rentang tanggal tidak dianggap kandidat', () => {
  const { hasil } = cocokkan([tagihan()], [transaksi({ tanggal: '2027-06-01' })]);
  assert.equal(hasil[0].status, STATUS.INVOICE_BELUM_ADA_TRANSFER);
});

test('nomor invoice menyelamatkan pencocokan walau nama tidak terbaca', () => {
  const { hasil } = cocokkan(
    [tagihan()],
    [transaksi({ keterangan: 'TRF INV-2026-VIII-0042' })]
  );
  assert.equal(hasil[0].status, STATUS.MATCH);
  assert.ok(hasil[0].alasan.some((a) => /Nomor invoice/i.test(a)));
});

test('supplier berbeda tidak dicocokkan meski nominalnya sama persis', () => {
  const { hasil } = cocokkan(
    [tagihan()],
    [transaksi({ keterangan: 'TRANSFER KE PT SUMBER REJEKI ABADI' })]
  );
  assert.equal(hasil[0].status, STATUS.INVOICE_BELUM_ADA_TRANSFER,
    'nama sama sekali beda tidak boleh dicocokkan hanya karena nominalnya pas');
});

// --- Keyakinan dan kandidat cadangan ---------------------------------------

test('keyakinan rendah ditandai PERLU REVIEW, tidak diklaim MATCH', () => {
  // Nama cocok sebagian, nomor invoice tidak muncul, nominal jauh, dan
  // transfernya berbulan-bulan sesudah tanggal invoice.
  const { hasil } = cocokkan(
    [tagihan({ pemasok_nama: 'PT TRIO PUTRA MANDIRI' })],
    [transaksi({ keterangan: 'TRF KE TRIO PUTRA', debit: 1200000, tanggal: '2026-11-20' })]
  );
  assert.equal(hasil[0].status, STATUS.PERLU_REVIEW);
  assert.ok(hasil[0].keyakinan < 0.6, `keyakinan ${hasil[0].keyakinan}`);
});

test('kandidat yang kalah tetap ditawarkan untuk dinilai manusia', () => {
  const { hasil } = cocokkan(
    [tagihan()],
    [
      transaksi({ id: 'trx-1', debit: 4955000, tanggal: '2026-08-05' }),
      transaksi({ id: 'trx-2', debit: 4900000, tanggal: '2026-08-09' }),
    ]
  );
  assert.equal(hasil[0].transaksi_id, 'trx-1', 'yang nominalnya pas menang');
  assert.equal(hasil[0].kandidat_lain.length, 1);
  assert.equal(hasil[0].kandidat_lain[0].transaksi_id, 'trx-2');
});

test('satu transfer tidak boleh melunasi dua tagihan sekaligus', () => {
  const dua = [
    tagihan({ id: 'inv-1', no_invoice: 'INV-0001' }),
    tagihan({ id: 'inv-2', no_invoice: 'INV-0002' }),
  ];
  const { hasil } = cocokkan(dua, [transaksi()]);

  const terpakai = hasil.filter((h) => h.transaksi_id === 'trx-1');
  assert.equal(terpakai.length, 1, 'hanya satu tagihan yang boleh memakai transaksi itu');
  assert.equal(
    hasil.filter((h) => h.status === STATUS.INVOICE_BELUM_ADA_TRANSFER).length, 1
  );
});

// --- Ringkasan --------------------------------------------------------------

test('ringkasan menghitung per status dan total selisih', () => {
  const hasilAudit = cocokkan(
    [
      tagihan({ id: 'a', no_invoice: 'INV-0001' }),
      tagihan({ id: 'b', no_invoice: 'INV-0002', tanggal_invoice: '2026-08-10' }),
      tagihan({ id: 'c', no_invoice: 'INV-0003', tanggal_invoice: '2026-08-20' }),
    ],
    [
      transaksi({ id: 't1', debit: 4955000, tanggal: '2026-08-05' }),
      transaksi({ id: 't2', debit: 4000000, tanggal: '2026-08-12' }),
      transaksi({ id: 't3', keterangan: 'BIAYA ADMIN', debit: 15000, tanggal: '2026-08-25' }),
    ]
  );
  const r = ringkasAudit(hasilAudit);

  assert.equal(r.total_tagihan, 3);
  assert.equal(r.per_status[STATUS.MATCH], 1);
  assert.equal(r.per_status[STATUS.KURANG_BAYAR], 1);
  assert.equal(r.per_status[STATUS.INVOICE_BELUM_ADA_TRANSFER], 1);
  assert.equal(r.per_status[STATUS.TRANSFER_TANPA_INVOICE], 1);
  assert.equal(r.total_selisih, -955000);
  assert.equal(r.perlu_perhatian, 3, 'dua tagihan bermasalah + satu transfer tanpa dasar');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STATUS_BAYAR, statusPembayaran, sisaKewajiban, penerimaBerbeda, lengkapiRingkasan, lengkapiRincian,
} from '../src/integrasi/ringkas.js';

// --- Status terhadap kewajiban ---------------------------------------------

test('kewajiban yang belum ditetapkan TIDAK PERNAH dianggap lunas', () => {
  // Menebak "lunas" dari kewajiban yang tidak diketahui membuat orang berhenti
  // membayar yang belum lunas.
  assert.equal(statusPembayaran(5000000, null), STATUS_BAYAR.BELUM_DITETAPKAN);
  assert.equal(statusPembayaran(0, undefined), STATUS_BAYAR.BELUM_DITETAPKAN);
  assert.equal(statusPembayaran(5000000, ''), STATUS_BAYAR.BELUM_DITETAPKAN);
});

test('kewajiban yang belum ditetapkan juga tidak dianggap LEBIH BAYAR', () => {
  // Kebalikannya membuat orang menagih balik uang yang memang haknya.
  assert.notEqual(statusPembayaran(99000000, null), STATUS_BAYAR.LEBIH_BAYAR);
});

test('pembayaran sebagian', () => {
  assert.equal(statusPembayaran(3000000, 5000000), STATUS_BAYAR.SEBAGIAN);
});

test('KASUS MARTHEN + JAFAR TALI: dua transfer menjadi lunas', () => {
  // 3.000.000 ke MARTHEN + 2.000.000 ke JAFAR TALI, kewajiban 5.000.000.
  assert.equal(statusPembayaran(3000000 + 2000000, 5000000), STATUS_BAYAR.LUNAS);
});

test('selisih di bawah toleransi dianggap lunas, bukan kurang bayar', () => {
  assert.equal(statusPembayaran(4999500, 5000000), STATUS_BAYAR.LUNAS);
  assert.equal(statusPembayaran(4998000, 5000000), STATUS_BAYAR.SEBAGIAN);
});

test('lebih bayar dikenali', () => {
  assert.equal(statusPembayaran(6000000, 5000000), STATUS_BAYAR.LEBIH_BAYAR);
});

test('belum ada pembayaran sama sekali', () => {
  assert.equal(statusPembayaran(0, 5000000), STATUS_BAYAR.BELUM_BAYAR);
});

test('pecahan rupiah tidak menumpuk', () => {
  assert.equal(statusPembayaran(0.1 + 0.2, 0.3), STATUS_BAYAR.LUNAS);
});

// --- Sisa ------------------------------------------------------------------

test('sisa null bila kewajiban belum ditetapkan, BUKAN nol', () => {
  // Nol berarti lunas. Itu kesimpulan, bukan ketiadaan data.
  assert.equal(sisaKewajiban(3000000, null), null);
});

test('sisa dihitung dari kewajiban dikurangi total', () => {
  assert.equal(sisaKewajiban(3000000, 5000000), 2000000);
  assert.equal(sisaKewajiban(5000000, 5000000), 0);
  assert.equal(sisaKewajiban(6000000, 5000000), -1000000);
});

// --- Penerima berbeda ------------------------------------------------------

test('penerima yang namanya cocok tidak ditandai', () => {
  assert.equal(
    penerimaBerbeda('MARTHEN RUTURAMBE', 'BI-FAST DB TRANSFER KE 002 MARTHEN RUTURAMBE KBB'),
    false
  );
});

test('JAFAR TALI untuk supplier MARTHEN ditandai berbeda — tetapi hanya DITANDAI', () => {
  assert.equal(
    penerimaBerbeda('MARTHEN RUTURAMBE', 'BI-FAST DB TRANSFER KE 008 JAFAR TALI KBB'),
    true
  );
});

test('keterangan atau nama kosong tidak menimbulkan tanda palsu', () => {
  assert.equal(penerimaBerbeda('', 'apa pun'), false);
  assert.equal(penerimaBerbeda('MARTHEN', null), false);
});

// --- Pelengkap baris -------------------------------------------------------

test('nilai numeric dari database diubah menjadi angka, bukan teks', () => {
  const hasil = lengkapiRingkasan({
    supplier_id: 'SUP-1', entitas: 'PT_ALYSSA_AUTO_LOGISTIK',
    supplier_nama: 'MARTHEN RUTURAMBE', jumlah_ejaan_nama: 1,
    jumlah_pembayaran: 2, total_dibayar: '5000000.00', kewajiban: '5000000.00',
  });
  assert.equal(typeof hasil.total_dibayar, 'number');
  assert.equal(hasil.total_dibayar, 5000000);
  assert.equal(hasil.sisa, 0);
  assert.equal(hasil.status, STATUS_BAYAR.LUNAS);
  assert.equal(hasil.ejaan_tidak_seragam, false);
});

test('ejaan nama yang tidak seragam untuk satu supplier_id ditandai', () => {
  // Totalnya tetap benar karena dikelompokkan dari id, tetapi salah ketik yang
  // tidak pernah dilaporkan tidak akan pernah diperbaiki.
  const hasil = lengkapiRingkasan({ total_dibayar: '100', kewajiban: null, jumlah_ejaan_nama: 2 });
  assert.equal(hasil.ejaan_tidak_seragam, true);
});

test('rincian meneruskan keterangan bank APA ADANYA', () => {
  const ket = 'BI-FAST DB TRANSFER KE 008 JAFAR TALI KBB';
  const hasil = lengkapiRincian(
    { transaksi_id: 'id-1', supplier_id: 'SUP-1', supplier_nama: 'MARTHEN RUTURAMBE',
      entitas: 'PT_ALYSSA_AUTO_LOGISTIK', tanggal: '2026-09-25', nominal: '2000000.00',
      status: 'siap', sidik: 'abc' },
    { keterangan: ket, no_rekening: '0072890271', referensi: null },
    { keterangan: 'Proyek 15 unit' }
  );
  assert.equal(hasil.keterangan_bank, ket);
  assert.equal(hasil.penerima_berbeda, true);
  assert.equal(hasil.nominal, 2000000);
  assert.equal(hasil.alokasi_manual, 'Proyek 15 unit');
  assert.equal(hasil.transaksi_id, 'id-1');
});

test('tanpa alokasi manual, nilainya null — bukan teks kosong', () => {
  const hasil = lengkapiRincian(
    { transaksi_id: 'id-2', supplier_nama: 'X', nominal: 1 }, { keterangan: 'X' }, null
  );
  assert.equal(hasil.alokasi_manual, null);
});

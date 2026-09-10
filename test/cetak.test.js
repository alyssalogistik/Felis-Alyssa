// PDF laporan yang benar-benar dihasilkan, lalu dibaca ulang isinya.
//
// Menguji bahwa pembuatannya "tidak melempar galat" tidak membuktikan apa pun:
// PDF yang halamannya kosong atau nominalnya salah tetap terbentuk dengan
// tenang. Karena itu setiap berkas di sini dibongkar lagi dengan pdfjs dan
// diperiksa teksnya, halaman per halaman.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buatPdfLaporan } from '../src/rekonsiliasi/cetak.js';
import { A4 } from '../src/rekonsiliasi/laporan.js';

/** Baca kembali PDF menjadi teks per halaman. */
async function bacaBalik(berkas) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const dokumen = await getDocument({
    data: new Uint8Array(berkas), useSystemFonts: true, isEvalSupported: false,
  }).promise;

  const halaman = [];
  for (let n = 1; n <= dokumen.numPages; n += 1) {
    const lembar = await dokumen.getPage(n);
    const isi = await lembar.getTextContent();
    halaman.push({
      teks: isi.items.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim(),
      ukuran: lembar.getViewport({ scale: 1 }),
    });
    lembar.cleanup();
  }
  await dokumen.cleanup();
  return halaman;
}

const CONTOH = [
  { tanggal: '2026-08-02', keterangan: 'TRSF E-BANKING DB 02/08 WSID:98212 PT TRIO PUTRA', debit: 5055000, kredit: 0, referensi: 'WSID:98212' },
  { tanggal: '2026-08-05', keterangan: 'BIAYA ADM', debit: 15000, kredit: 0, referensi: null },
  { tanggal: '2026-08-12', keterangan: 'SETORAN TUNAI', debit: 0, kredit: 10000000, referensi: null },
];

const KRITERIA = { cari: 'TRIO PUTRA', bulan: 8, tahun: 2026, dari: '2026-08-01', sampai: '2026-08-31' };

test('ukuran kertas A4 potret', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  assert.ok(Math.abs(halaman.ukuran.width - A4.lebar) < 1, `lebar ${halaman.ukuran.width}`);
  assert.ok(Math.abs(halaman.ukuran.height - A4.tinggi) < 1, `tinggi ${halaman.ukuran.height}`);
  assert.ok(halaman.ukuran.height > halaman.ukuran.width, 'potret, bukan lanskap');
});

test('kop dokumen sesuai permintaan', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  assert.match(halaman.teks, /PT ALYSSA AUTO LOGISTIK/);
  assert.match(halaman.teks, /AUDIT PEMBAYARAN SUPPLIER \/ MUTASI REKENING/);
});

test('kop memuat seluruh keterangan filter dan hasilnya', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  for (const label of [
    'Kata Kunci', 'Bulan', 'Tahun', 'Dari Tanggal', 'Sampai Tanggal',
    'Tanggal Cetak', 'Jumlah Transaksi', 'Total Uang Keluar', 'Total Uang Masuk',
  ]) {
    assert.match(halaman.teks, new RegExp(label), `${label} tidak tercetak`);
  }
  assert.match(halaman.teks, /TRIO PUTRA/);
  assert.match(halaman.teks, /Agustus/);
});

test('total uang keluar dan masuk dihitung benar', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  assert.match(halaman.teks, /Rp 5\.070\.000/, 'total debit 5.055.000 + 15.000');
  assert.match(halaman.teks, /Rp 10\.000\.000/, 'total kredit');
  assert.match(halaman.teks, /3 transaksi/);
});

test('judul kolom sesuai permintaan', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  for (const judul of ['TANGGAL', 'KETERANGAN TRANSAKSI', 'DEBIT / KELUAR', 'KREDIT / MASUK', 'NOMINAL', 'REFERENSI']) {
    assert.match(halaman.teks, new RegExp(judul.replace(/\//g, '\\/')), `${judul} tidak tercetak`);
  }
});

test('nominal memakai format Rupiah Indonesia', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  assert.match(halaman.teks, /Rp 5\.055\.000/);
  // Bukan format Inggris.
  assert.ok(!/Rp 5,055,000/.test(halaman.teks));
});

test('keterangan panjang tetap utuh walau dibungkus beberapa baris', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  // Kata-katanya boleh terpisah antar baris, tetapi tidak boleh ada yang hilang.
  for (const kata of ['TRSF', 'E-BANKING', 'WSID:98212', 'PT', 'TRIO', 'PUTRA']) {
    assert.match(halaman.teks, new RegExp(kata.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${kata} hilang`);
  }
});

test('footer dan nomor halaman tercetak', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  assert.match(halaman.teks, /PT Alyssa Auto Logistik - Audit Pembayaran Supplier/);
  assert.match(halaman.teks, /Halaman 1 \/ 1/);
});

test('transaksi banyak dipecah ke beberapa halaman A4', async () => {
  const banyak = Array.from({ length: 200 }, (_, i) => ({
    tanggal: '2026-08-01',
    keterangan: `TRSF E-BANKING DB PEMBAYARAN SUPPLIER NOMOR ${i}`,
    debit: 1000000 + i, kredit: 0, referensi: `REF${i}`,
  }));

  const halaman = await bacaBalik(await buatPdfLaporan(banyak, {}));
  assert.ok(halaman.length > 1, `hanya ${halaman.length} halaman`);

  // Kepala tabel diulang di setiap halaman.
  for (const [i, h] of halaman.entries()) {
    assert.match(h.teks, /KETERANGAN TRANSAKSI/, `halaman ${i + 1} tanpa kepala tabel`);
    assert.match(h.teks, new RegExp(`Halaman ${i + 1} / ${halaman.length}`.replace(/\//g, '\\/')),
      `nomor halaman ${i + 1} salah`);
  }
});

test('tidak ada transaksi yang hilang saat dipecah', async () => {
  const banyak = Array.from({ length: 120 }, (_, i) => ({
    tanggal: '2026-08-01', keterangan: `BAYAR NOMOR ${i}`, debit: 1000, kredit: 0, referensi: null,
  }));

  const halaman = await bacaBalik(await buatPdfLaporan(banyak, {}));
  const seluruh = halaman.map((h) => h.teks).join(' ');
  for (let i = 0; i < 120; i += 1) {
    assert.match(seluruh, new RegExp(`BAYAR NOMOR ${i}\\b`), `transaksi ${i} hilang`);
  }
});

test('urutan transaksi dipertahankan lintas halaman', async () => {
  const banyak = Array.from({ length: 90 }, (_, i) => ({
    tanggal: '2026-08-01', keterangan: `URUT${String(i).padStart(3, '0')}`, debit: 1000, kredit: 0, referensi: null,
  }));

  const halaman = await bacaBalik(await buatPdfLaporan(banyak, {}));
  const seluruh = halaman.map((h) => h.teks).join(' ');
  const terlihat = [...seluruh.matchAll(/URUT(\d{3})/g)].map((m) => Number(m[1]));
  assert.deepEqual(terlihat, [...terlihat].sort((a, b) => a - b), 'urutan berubah');
});

test('hasil kosong tetap menghasilkan satu halaman berkop', async () => {
  const halaman = await bacaBalik(await buatPdfLaporan([], { cari: 'TIDAK ADA' }));
  assert.equal(halaman.length, 1);
  assert.match(halaman[0].teks, /PT ALYSSA AUTO LOGISTIK/);
  assert.match(halaman[0].teks, /Tidak ditemukan transaksi pembayaran/);
  assert.match(halaman[0].teks, /Halaman 1 \/ 1/);
});

test('transaksi tanpa tanggal tidak menggagalkan laporan', async () => {
  const halaman = await bacaBalik(await buatPdfLaporan(
    [{ tanggal: null, keterangan: 'BARIS RUSAK', debit: 0, kredit: 0, referensi: null }], {}
  ));
  assert.match(halaman[0].teks, /BARIS RUSAK/);
});

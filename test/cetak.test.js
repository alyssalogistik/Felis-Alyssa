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
    // Satu total gabungan diganti total per sumber: pembaca laporan harus bisa
    // melihat mana yang dari rekening koran dan mana yang diketik manual.
    'Tanggal Cetak', 'Jumlah Transaksi', 'Total BCA', 'TOTAL PEMBAYARAN', 'Total Uang Masuk',
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
  assert.match(halaman.teks, /Audit Pembayaran Supplier/);
  assert.match(halaman.teks, /Halaman 1 \/ 1/);
});

test('KAIDAH: kop dan kaki laporan menyebut entitas yang dipilih', async () => {
  // Laporan CV yang berkop PT akan salah diarsipkan oleh siapa pun yang
  // memegangnya. Ini bug yang benar-benar terjadi: nama perusahaannya
  // tertanam di kode, sehingga laporan CV tetap berstempel PT.
  const [cv] = await bacaBalik(await buatPdfLaporan(CONTOH, {
    ...KRITERIA, entitas: 'CV_ALYSSA_TRANS_UTAMA',
  }));
  assert.match(cv.teks, /CV ALYSSA TRANS UTAMA/);
  assert.doesNotMatch(cv.teks, /PT ALYSSA AUTO LOGISTIK/);
  assert.match(cv.teks, /Rekening/);
});

test('KAIDAH: laporan tanpa pilihan entitas mengaku memuat keduanya', async () => {
  // Angkanya tidak bisa dipakai atas nama salah satu perusahaan, jadi kopnya
  // tidak boleh menyebut salah satu saja.
  const [semua] = await bacaBalik(await buatPdfLaporan(CONTOH, KRITERIA));
  assert.match(semua.teks, /PT ALYSSA AUTO LOGISTIK/);
  assert.match(semua.teks, /CV ALYSSA TRANS UTAMA/);
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

// --- Kolom sumber dan total per sumber --------------------------------------

test('setiap baris mencantumkan sumbernya', async () => {
  const [halaman] = await bacaBalik(await buatPdfLaporan([
    { asal: 'bank', sumber: 'BCA', tanggal: '2025-05-06', keterangan: 'TRSF SUGENG RIYANTO', debit: 8800000, kredit: 0, referensi: null },
    { asal: 'manual', sumber: 'MEKARI PAY', tanggal: '2025-01-06', keterangan: 'SUGENG RIYANTO', debit: 28000000, kredit: 0, referensi: 'INV/AAL/10/I/2025' },
  ], {}));

  assert.match(halaman.teks, /SUMBER/, 'kolomnya ada di kepala tabel');
  assert.match(halaman.teks, /MEKARI PAY/, 'pembayaran manual tidak boleh terbaca seolah dari BCA');
  assert.match(halaman.teks, /BCA/);
});

test('KAIDAH: nomor invoice panjang tidak terpotong di kolom REFERENSI', async () => {
  // REFERENSI pernah hilang seluruhnya karena kolomnya lebih sempit dari
  // judulnya sendiri. Nomor invoice manual jauh lebih panjang dari referensi
  // bank, jadi lebarnya diukur ulang saat kolom SUMBER ditambahkan.
  const [halaman] = await bacaBalik(await buatPdfLaporan([
    { asal: 'manual', sumber: 'MEKARI PAY', tanggal: '2025-01-06', keterangan: 'SUGENG RIYANTO', debit: 28000000, kredit: 0, referensi: 'INV/AAL/10/I/2025' },
  ], {}));
  assert.match(halaman.teks, /INV\/AAL\/10\/I\/2025/);
});

test('KAIDAH: TOTAL PEMBAYARAN sama dengan penjumlahan baris di laporan', async () => {
  // Bukan diambil dari ringkasan yang dihitung terpisah. Total yang tidak sama
  // dengan penjumlahan baris di bawahnya menghancurkan kepercayaan pada
  // seluruh laporan.
  const [halaman] = await bacaBalik(await buatPdfLaporan([
    { asal: 'bank', sumber: 'BCA', tanggal: '2025-05-06', keterangan: 'TRSF SUGENG RIYANTO', debit: 8800000, kredit: 0, referensi: null },
    { asal: 'manual', sumber: 'MEKARI PAY', tanggal: '2025-01-06', keterangan: 'SUGENG RIYANTO', debit: 28000000, kredit: 0, referensi: null },
    { asal: 'manual', sumber: 'MEKARI PAY', tanggal: '2025-01-17', keterangan: 'SUGENG RIYANTO', debit: 28000000, kredit: 0, referensi: null },
    { asal: 'manual', sumber: 'KAS', tanggal: '2025-02-03', keterangan: 'SUGENG RIYANTO', debit: 1500000, kredit: 0, referensi: null },
  ], {}));

  assert.match(halaman.teks, /Total BCA Rp 8\.800\.000/);
  assert.match(halaman.teks, /Total MEKARI PAY Rp 56\.000\.000/);
  assert.match(halaman.teks, /Total MANUAL LAINNYA Rp 1\.500\.000/);
  // 8.800.000 + 56.000.000 + 1.500.000
  assert.match(halaman.teks, /TOTAL PEMBAYARAN Rp 66\.300\.000/);
});

test('kelompok yang kosong tidak dicetak sebagai Rp 0', async () => {
  // Baris "Total Mekari Pay: Rp 0" pada laporan yang memang tidak memuat
  // Mekari Pay hanya menambah keraguan.
  const [halaman] = await bacaBalik(await buatPdfLaporan([
    { asal: 'bank', sumber: 'BCA', tanggal: '2025-05-06', keterangan: 'TRSF SUGENG', debit: 8800000, kredit: 0, referensi: null },
  ], {}));
  assert.doesNotMatch(halaman.teks, /Total MEKARI PAY/);
  assert.doesNotMatch(halaman.teks, /Total MANUAL LAINNYA/);
});

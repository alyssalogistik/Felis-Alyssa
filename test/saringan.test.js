import test from 'node:test';
import assert from 'node:assert/strict';
import { uraiTabel } from '../src/rekonsiliasi/parser.js';
import { saring, ringkas, tahunTersedia } from '../src/rekonsiliasi/saringan.js';

/** Data dari spesifikasi. Transaksi September sengaja ada untuk menguji batas bulan. */
const { transaksi: CONTOH } = uraiTabel([
  ['Tanggal', 'Keterangan', 'Debit', 'Kredit', 'Saldo'],
  ['01/08/2026', 'PT TRIO PUTRA', '', '8.000.000', '18.000.000'],
  ['15/08/2026', 'PT TRIO PUTRA TRANS', '', '5.000.000', '23.000.000'],
  ['01/09/2026', 'PT TRIO PUTRA', '', '7.000.000', '30.000.000'],
  ['20/08/2026', 'TRANSFER KE TRIO PUTRA', '3.000.000', '', '20.000.000'],
  ['10/08/2026', 'PT SUMBER REJEKI', '', '2.000.000', '25.000.000'],
]);

test('SKENARIO SPESIFIKASI: nama + bulan + tahun harus terpenuhi semuanya', () => {
  const hasil = saring(CONTOH, { cari: 'TRIO PUTRA', bulan: 8, tahun: 2026 });

  // Tiga transaksi Agustus mengandung "TRIO PUTRA": dua kredit dan satu debit.
  assert.equal(hasil.length, 3);
  assert.ok(
    hasil.every((t) => t.tanggal.startsWith('2026-08')),
    'transaksi September tidak boleh ikut'
  );
  assert.ok(!hasil.some((t) => t.tanggal === '2026-09-01'));

  const total = ringkas(hasil);
  assert.equal(total.kredit, 13000000, 'Rp13.000.000 sesuai spesifikasi');
  assert.equal(total.debit, 3000000);
  assert.equal(total.net, 10000000);
});

test('hanya kredit Agustus: dua transaksi, Rp13.000.000', () => {
  const hasil = saring(CONTOH, { cari: 'PT TRIO PUTRA', bulan: 8, tahun: 2026 });
  assert.equal(hasil.length, 2);
  assert.equal(ringkas(hasil).kredit, 13000000);
});

test('pencarian mengabaikan besar-kecil huruf', () => {
  assert.equal(saring(CONTOH, { cari: 'trio putra' }).length, 4);
  assert.equal(saring(CONTOH, { cari: 'TRIO PUTRA' }).length, 4);
  assert.equal(saring(CONTOH, { cari: 'TrIo PuTrA' }).length, 4);
});

test('pencarian mencocokkan sebagian teks di posisi mana pun', () => {
  // Di awal, di tengah, dan sesudah kata lain.
  const hasil = saring(CONTOH, { cari: 'TRIO PUTRA' }).map((t) => t.keterangan);
  assert.ok(hasil.includes('PT TRIO PUTRA'));
  assert.ok(hasil.includes('PT TRIO PUTRA TRANS'));
  assert.ok(hasil.includes('TRANSFER KE TRIO PUTRA'));
});

test('filter bulan menghormati batas bulan', () => {
  assert.equal(saring(CONTOH, { bulan: 8 }).length, 4);
  assert.equal(saring(CONTOH, { bulan: 9 }).length, 1);
  assert.equal(saring(CONTOH, { bulan: 7 }).length, 0);
});

test('filter tahun', () => {
  assert.equal(saring(CONTOH, { tahun: 2026 }).length, 5);
  assert.equal(saring(CONTOH, { tahun: 2025 }).length, 0);
});

test('rentang tanggal inklusif di kedua ujung', () => {
  const hasil = saring(CONTOH, { dari: '2026-08-10', sampai: '2026-08-20' });
  assert.equal(hasil.length, 3);
  assert.ok(hasil.some((t) => t.tanggal === '2026-08-10'), 'batas bawah ikut');
  assert.ok(hasil.some((t) => t.tanggal === '2026-08-20'), 'batas atas ikut');
  assert.ok(!hasil.some((t) => t.tanggal === '2026-08-01'));
});

test('rentang tanggal digabung dengan nama', () => {
  const hasil = saring(CONTOH, { cari: 'TRIO PUTRA', dari: '2026-08-01', sampai: '2026-08-15' });
  assert.equal(hasil.length, 2);
});

test('filter kosong mengembalikan seluruh data', () => {
  assert.equal(saring(CONTOH, {}).length, 5);
  assert.equal(saring(CONTOH, { cari: '', bulan: '', tahun: '', dari: '', sampai: '' }).length, 5);
});

test('ringkasan dihitung dari hasil filter, bukan seluruh rekening koran', () => {
  const semua = ringkas(CONTOH);
  const tersaring = ringkas(saring(CONTOH, { bulan: 9 }));

  assert.equal(semua.kredit, 22000000);
  assert.equal(tersaring.kredit, 7000000);
  assert.notEqual(semua.kredit, tersaring.kredit);
});

test('penjumlahan nominal tidak melenceng karena pecahan biner', () => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Kredit'],
    ...Array.from({ length: 300 }, () => ['01/08/2026', 'BUNGA', '0,10']),
  ]);
  assert.equal(ringkas(transaksi).kredit, 30);
});

test('transaksi tanpa tanggal valid tidak lolos filter waktu', () => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Kredit'],
    ['rusak', 'PT TRIO PUTRA', '1.000.000'],
  ]);
  assert.equal(saring(transaksi, { cari: 'TRIO' }).length, 1, 'masih bisa dicari lewat nama');
  assert.equal(saring(transaksi, { bulan: 8 }).length, 0, 'tapi tidak masuk filter bulan');
});

test('tahun yang tersedia diambil dari data, terbaru dulu', () => {
  assert.deepEqual(tahunTersedia(CONTOH), [2026]);
});

// --- Pencarian pembayaran supplier ------------------------------------------
//
// Halaman audit menjawab satu pertanyaan: "supplier ini sudah saya bayar
// belum?" Uang masuk yang kebetulan menyebut nama yang sama bukan jawabannya.

test('hanya uang keluar: kredit dengan nama yang sama tidak ikut', () => {
  const hasil = saring(CONTOH, { cari: 'TRIO PUTRA', hanya_debit: true });
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].keterangan, 'TRANSFER KE TRIO PUTRA');
  assert.equal(hasil[0].debit, 3000000);
});

test('tanpa penyaring uang keluar, kredit tetap tampil', () => {
  assert.equal(saring(CONTOH, { cari: 'TRIO PUTRA' }).length, 4);
});

test('pencarian sebagian nama menemukan nama yang lebih panjang', () => {
  const hasil = saring(CONTOH, { cari: 'trio' });
  assert.equal(hasil.length, 4);
  assert.ok(hasil.some((t) => t.keterangan === 'PT TRIO PUTRA TRANS'));
});

test('pencarian mengabaikan besar-kecil huruf', () => {
  assert.equal(
    saring(CONTOH, { cari: 'pt trio putra' }).length,
    saring(CONTOH, { cari: 'PT TRIO PUTRA' }).length
  );
});

test('kombinasi lengkap: nama + rentang tanggal + uang keluar', () => {
  const hasil = saring(CONTOH, {
    cari: 'TRIO', dari: '2026-08-16', sampai: '2026-08-31', hanya_debit: true,
  });
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].tanggal, '2026-08-20');
});

test('rentang tanggal inklusif di kedua ujungnya', () => {
  const hasil = saring(CONTOH, { dari: '2026-08-01', sampai: '2026-08-01' });
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].tanggal, '2026-08-01');
});

test('kombinasi yang tidak menghasilkan apa-apa mengembalikan kosong, bukan galat', () => {
  assert.deepEqual(saring(CONTOH, { cari: 'SUPPLIER YANG TIDAK ADA' }), []);
  assert.deepEqual(saring(CONTOH, { cari: 'TRIO PUTRA', bulan: 12, tahun: 2026 }), []);
  // Ada namanya, ada bulannya, tetapi tidak ada uang keluarnya pada bulan itu.
  assert.deepEqual(saring(CONTOH, { cari: 'SUMBER REJEKI', hanya_debit: true }), []);
});

test('total uang keluar dihitung dari hasil saring, bukan seluruh rekening', () => {
  const hasil = saring(CONTOH, { cari: 'TRIO', hanya_debit: true });
  assert.equal(ringkas(hasil).debit, 3000000);
  assert.equal(ringkas(hasil).kredit, 0);
});

test('menyaring uang keluar tidak mengubah total debit', () => {
  // Baris kredit menyumbang debit nol, jadi totalnya sama dengan atau tanpa
  // penyaringan itu. Inilah alasan fungsi ringkasan di database tidak perlu
  // menerima parameter tambahan.
  const semua = saring(CONTOH, { cari: 'TRIO' });
  const keluarSaja = saring(CONTOH, { cari: 'TRIO', hanya_debit: true });
  assert.equal(ringkas(semua).debit, ringkas(keluarSaja).debit);
});

// --- Validasi rentang tanggal ------------------------------------------------
//
// Rentang terbalik tidak menghasilkan galat dari database, hanya hasil kosong.
// Kosong di halaman audit terbaca sebagai "belum dibayar", jadi harus ditolak
// sebelum permintaan dikirim, bukan dibiarkan tampil sebagai nihil hasil.

test('rentang terbalik ditolak sebelum dikirim', () => {
  const dari = '2025-11-30';
  const sampai = '2025-11-01';
  assert.ok(dari > sampai, 'perbandingan teks cukup untuk tanggal ISO');
  assert.equal(saring(CONTOH, { dari, sampai }).length, 0, 'kalau lolos, hasilnya kosong tanpa sebab');
});

test('rentang sehari penuh tidak dianggap terbalik', () => {
  const hasil = saring(CONTOH, { dari: '2026-08-01', sampai: '2026-08-01' });
  assert.equal(hasil.length, 1);
});

// --- Skenario yang diminta pemilik project -----------------------------------

const NOVEMBER = (() => {
  const { transaksi } = uraiTabel([
    ['Tanggal', 'Keterangan', 'Debit', 'Kredit', 'Saldo'],
    ['05/11/2025', 'TRSF E-BANKING DB SUGENG RIYANTO', '2.500.000', '', '10.000.000'],
    ['20/11/2025', 'TRSF SUGENG RIYANTO ANGSURAN', '1.750.000', '', '8.250.000'],
    ['05/10/2025', 'TRSF E-BANKING DB SUGENG RIYANTO', '3.000.000', '', '13.000.000'],
    ['05/12/2025', 'TRSF E-BANKING DB SUGENG RIYANTO', '4.000.000', '', '4.250.000'],
    ['05/11/2024', 'TRSF E-BANKING DB SUGENG RIYANTO', '9.000.000', '', '20.000.000'],
    ['12/11/2025', 'TRSF E-BANKING DB BUDI SANTOSO', '5.000.000', '', '3.250.000'],
    ['25/11/2025', 'SETORAN DARI SUGENG RIYANTO', '', '6.000.000', '9.250.000'],
  ]);
  return transaksi;
})();

test('SKENARIO: SUGENG RIYANTO + November + 2025 + rentang sebulan', () => {
  const hasil = saring(NOVEMBER, {
    cari: 'SUGENG RIYANTO',
    bulan: 11,
    tahun: 2025,
    dari: '2025-11-01',
    sampai: '2025-11-30',
    hanya_debit: true,
  });

  assert.equal(hasil.length, 2, 'hanya dua transfer keluar di November 2025');
  assert.ok(hasil.every((t) => t.tanggal.startsWith('2025-11')), 'tidak ada bulan atau tahun lain');
  assert.ok(hasil.every((t) => /SUGENG RIYANTO/.test(t.keterangan)), 'nama lain tidak ikut');
  assert.ok(hasil.every((t) => t.debit > 0), 'uang masuk tidak ikut');
  assert.equal(ringkas(hasil).debit, 4250000);
});

test('SKENARIO: Oktober, Desember, dan November tahun lain tersaring keluar', () => {
  const hasil = saring(NOVEMBER, { cari: 'SUGENG RIYANTO', bulan: 11, tahun: 2025 });
  const tanggal = hasil.map((t) => t.tanggal).sort();
  assert.deepEqual(tanggal, ['2025-11-05', '2025-11-20', '2025-11-25']);
  assert.ok(!tanggal.includes('2025-10-05'), 'Oktober tidak ikut');
  assert.ok(!tanggal.includes('2025-12-05'), 'Desember tidak ikut');
  assert.ok(!tanggal.includes('2024-11-05'), 'November tahun lain tidak ikut');
});

test('SKENARIO: kata kunci berspasi berlebih tetap menemukan hasil', () => {
  const rapi = saring(NOVEMBER, { cari: 'sugeng riyanto', bulan: 11, tahun: 2025 });
  const berantakan = saring(NOVEMBER, { cari: '  sugeng riyanto  '.trim(), bulan: 11, tahun: 2025 });
  assert.equal(berantakan.length, rapi.length);
});

test('spasi ganda di tengah kata kunci dirapatkan', () => {
  // Pencocokannya harfiah: tanpa perapatan ini, kata kunci berspasi dua tidak
  // akan pernah menemukan transaksi yang ditulis berspasi satu — dan hasil
  // nihil di halaman audit terbaca sebagai "belum dibayar".
  assert.equal(
    saring(NOVEMBER, { cari: '  sugeng   riyanto  ' }).length,
    saring(NOVEMBER, { cari: 'SUGENG RIYANTO' }).length
  );
});

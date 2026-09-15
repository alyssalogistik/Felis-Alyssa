// Aturan menghapus satu unggahan rekening koran.
//
// Yang diuji di sini keputusannya, bukan penghapusannya: penghapusan turunan
// dikerjakan rantai ON DELETE CASCADE di database dan diuji terpisah terhadap
// PostgreSQL sungguhan.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  labelPeriode,
  periksaHapus,
  rincianHapus,
  PERLU_KONFIRMASI_KECOCOKAN,
} from '../src/rekonsiliasi/hapus.js';

const dampak = (ubah = {}) => ({
  unggahan: { nama_berkas: 'Februari.pdf', periode_bulan: 2, periode_tahun: 2026, jumlah_transaksi: 40 },
  transaksi: 40,
  sudah_direkon: 0,
  kecocokan: 0,
  kecocokan_dikonfirmasi: 0,
  ...ubah,
});

const nilai = (rincian, label) => rincian.find((r) => r.label === label)?.nilai;

// --- Periode ----------------------------------------------------------------

test('periode ditampilkan dari kolomnya, bukan ditebak', () => {
  assert.equal(labelPeriode({ periode_bulan: 2, periode_tahun: 2026 }), 'Februari 2026');
  assert.equal(labelPeriode({ periode_bulan: 12, periode_tahun: 2025 }), 'Desember 2025');
});

test('unggahan lama tanpa periode mengaku tidak tahu', () => {
  // Menebak bulan dari nama berkas akan menampilkan periode yang salah di kotak
  // yang dipakai memutuskan penghapusan.
  assert.equal(labelPeriode({ periode_bulan: null, periode_tahun: null }), '-');
  assert.equal(labelPeriode({}), '-');
  assert.equal(labelPeriode(null), '-');
  assert.equal(labelPeriode({ periode_bulan: 13, periode_tahun: 2026 }), '-');
  assert.equal(labelPeriode({ periode_bulan: 0, periode_tahun: 2026 }), '-');
});

// --- Rincian yang dibacakan sebelum menghapus --------------------------------

test('kotak konfirmasi menyebut nama berkas, periode, dan jumlah transaksi', () => {
  const r = rincianHapus(dampak());
  assert.equal(nilai(r, 'Nama berkas'), 'Februari.pdf');
  assert.equal(nilai(r, 'Periode'), 'Februari 2026');
  assert.equal(nilai(r, 'Transaksi yang ikut terhapus'), '40 baris');
});

test('SKENARIO: unggahan ulang yang tidak memiliki satu transaksi pun', () => {
  // Rekening koran yang sama diunggah dua kali: yang kedua tercatat membaca 40
  // baris, tetapi seluruhnya sudah ada lebih dulu sehingga tidak ada yang
  // menjadi miliknya. Menghapusnya tidak menghilangkan transaksi apa pun — dan
  // justru inilah yang paling sering ingin dihapus.
  const r = rincianHapus(dampak({ transaksi: 0 }));
  assert.equal(nilai(r, 'Transaksi yang ikut terhapus'), '0 baris');
  assert.match(nilai(r, 'Dibaca dari berkas'), /^40 baris/);
  assert.match(nilai(r, 'Dibaca dari berkas'), /tidak ikut terhapus/);
});

test('selisih dibaca-versus-dimiliki tidak disebut bila memang sama', () => {
  assert.equal(nilai(rincianHapus(dampak()), 'Dibaca dari berkas'), undefined);
});

test('transaksi yang sudah direkonsiliasi ditandai berat', () => {
  const r = rincianHapus(dampak({ sudah_direkon: 7 }));
  const baris = r.find((b) => b.label === 'Sudah direkonsiliasi');
  assert.equal(baris.nilai, '7 baris');
  assert.equal(baris.berat, true);
});

test('hasil audit otomatis disebut tanpa ditandai berat', () => {
  const r = rincianHapus(dampak({ kecocokan: 5 }));
  const baris = r.find((b) => b.label === 'Hasil audit yang ikut terhapus');
  assert.equal(baris.nilai, '5 kecocokan otomatis');
  assert.ok(!baris.berat);
});

test('kecocokan yang sudah dikonfirmasi manusia disebut terpisah dan ditandai', () => {
  const r = rincianHapus(dampak({ kecocokan: 5, kecocokan_dikonfirmasi: 2 }));
  const baris = r.find((b) => b.label === 'Hasil audit yang ikut terhapus');
  assert.match(baris.nilai, /5 kecocokan/);
  assert.match(baris.nilai, /2 di antaranya sudah dikonfirmasi manusia/);
  assert.equal(baris.berat, true);
});

test('unggahan tanpa hasil audit tidak menakut-nakuti dengan baris kosong', () => {
  const r = rincianHapus(dampak());
  assert.equal(r.find((b) => b.label === 'Hasil audit yang ikut terhapus'), undefined);
  assert.equal(r.find((b) => b.label === 'Sudah direkonsiliasi'), undefined);
});

// --- Izin -------------------------------------------------------------------

test('unggahan biasa boleh langsung dihapus setelah dikonfirmasi', () => {
  assert.equal(periksaHapus(dampak()).boleh, true);
  assert.equal(periksaHapus(dampak({ transaksi: 0 })).boleh, true);
});

test('transaksi yang sudah direkon tidak menahan penghapusan', () => {
  // Status rekon adalah penanda kerja, bukan keputusan yang hilang selamanya:
  // rekening korannya bisa diunggah ulang lalu ditandai lagi.
  assert.equal(periksaHapus(dampak({ sudah_direkon: 40 })).boleh, true);
});

test('kecocokan otomatis tidak menahan penghapusan', () => {
  // Bisa dibuat ulang dengan menjalankan audit lagi.
  assert.equal(periksaHapus(dampak({ kecocokan: 5 })).boleh, true);
});

test('KAIDAH: kecocokan yang dikonfirmasi manusia ditolak tanpa persetujuan', () => {
  const hasil = periksaHapus(dampak({ kecocokan: 5, kecocokan_dikonfirmasi: 2 }));
  assert.equal(hasil.boleh, false);
  assert.equal(hasil.kode, PERLU_KONFIRMASI_KECOCOKAN);
  assert.match(hasil.pesan, /2 kecocokan/);
});

test('dengan persetujuan eksplisit, penghapusan diteruskan', () => {
  const hasil = periksaHapus(
    dampak({ kecocokan: 5, kecocokan_dikonfirmasi: 2 }),
    { konfirmasiKecocokan: true }
  );
  assert.equal(hasil.boleh, true);
});

test('persetujuan tidak diminta bila memang tidak ada yang dikonfirmasi', () => {
  // Kalau setiap penghapusan menuntut centang, centangnya berhenti dibaca.
  assert.equal(periksaHapus(dampak({ kecocokan: 9 })).boleh, true);
});

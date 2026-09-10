// Tata letak laporan A4.
//
// Yang diuji di sini murni: pembungkusan teks dan pemenggalan halaman, dua hal
// yang paling mudah salah dan paling merusak bila salah. PDF sungguhan diuji
// di test/cetak.test.js dengan cara dibaca ulang.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rupiah, tanggalPendek, keteranganFilter, namaBerkas, bungkus, susunHalaman, totalkan, KOLOM,
} from '../src/rekonsiliasi/laporan.js';

/** Pengukur palsu: setiap huruf selebar 5 pt. Cukup untuk menguji aturannya. */
const ukur = (teks) => teks.length * 5;

test('rupiah memakai titik sebagai pemisah ribuan', () => {
  assert.equal(rupiah(2500000), 'Rp 2.500.000');
  assert.equal(rupiah(0), 'Rp 0');
  assert.equal(rupiah(999), 'Rp 999');
  assert.equal(rupiah(1000), 'Rp 1.000');
});

test('rupiah tidak bergantung pada locale mesin', () => {
  // Intl di server bisa jatuh ke format Inggris dan mencetak "Rp 2,500,000",
  // yang salah baca di Indonesia. Formatnya dipasang sendiri.
  assert.match(rupiah(1234567), /^Rp 1\.234\.567$/);
});

test('tanggal dicetak pendek tanpa objek Date', () => {
  assert.equal(tanggalPendek('2026-08-02'), '02 Agu 2026');
  assert.equal(tanggalPendek(null), '-');
});

test('filter yang tidak diisi ditulis Semua, bukan dikosongkan', () => {
  const isi = Object.fromEntries(keteranganFilter({}));
  assert.equal(isi['Kata Kunci'], 'Semua transaksi');
  assert.equal(isi['Bulan'], 'Semua');
  assert.equal(isi['Tahun'], 'Semua');
});

test('filter yang diisi ditulis apa adanya', () => {
  const isi = Object.fromEntries(keteranganFilter({ cari: 'TRIO PUTRA', bulan: 8, tahun: 2026 }));
  assert.equal(isi['Kata Kunci'], 'TRIO PUTRA');
  assert.equal(isi['Bulan'], 'Agustus');
  assert.equal(isi['Tahun'], '2026');
});

test('nama berkas mengikuti supplier, bulan, dan tahun', () => {
  assert.equal(
    namaBerkas({ cari: 'PT TRIO PUTRA', bulan: 8, tahun: 2026 }),
    'Audit-Pembayaran-PT-TRIO-PUTRA-Agustus-2026.pdf'
  );
});

test('supplier kosong memakai Semua-Transaksi', () => {
  assert.equal(
    namaBerkas({ bulan: 2, tahun: 2026 }),
    'Audit-Pembayaran-Semua-Transaksi-Februari-2026.pdf'
  );
});

test('karakter yang tidak aman dibuang dari nama berkas', () => {
  const nama = namaBerkas({ cari: 'PT / MAJU \\ JAYA*?', tahun: 2026 });
  assert.ok(!/[/\\*?]/.test(nama), nama);
  assert.match(nama, /^Audit-Pembayaran-PT-MAJU-JAYA-Semua-Bulan-2026\.pdf$/);
});

test('teks panjang dibungkus per kata', () => {
  const baris = bungkus('TRSF E-BANKING DB PT TRIO PUTRA', 50, ukur);
  assert.ok(baris.length > 1);
  assert.ok(baris.every((b) => ukur(b) <= 50), baris.join(' | '));
});

test('kata yang lebih panjang dari kolomnya dipenggal, tidak meluber', () => {
  // Kalau dibiarkan utuh, kata ini akan menimpa kolom di sebelahnya.
  const baris = bungkus('WSIDXXXXXXXXXXXXXXXXXXXXXXXX', 30, ukur);
  assert.ok(baris.every((b) => ukur(b) <= 30), baris.join(' | '));
  assert.equal(baris.join(''), 'WSIDXXXXXXXXXXXXXXXXXXXXXXXX', 'tidak ada huruf yang hilang');
});

test('teks kosong tetap menghasilkan satu baris', () => {
  assert.deepEqual(bungkus('', 100, ukur), ['']);
  assert.deepEqual(bungkus(null, 100, ukur), ['']);
});

const transaksi = (n, keterangan = 'PEMBAYARAN') =>
  Array.from({ length: n }, (_, i) => ({
    tanggal: '2026-08-01', keterangan: `${keterangan} ${i}`, debit: 1000, kredit: 0, referensi: null,
  }));

test('baris tidak pernah terpenggal antar halaman', () => {
  const halaman = susunHalaman(transaksi(40), {
    ukur, tinggiBaris: 10, jarakBaris: 4,
    ruangHalamanPertama: 100, ruangHalamanBerikutnya: 200,
  });

  // Tinggi setiap halaman tidak boleh melebihi ruang yang tersedia untuknya.
  const tinggi = (h) => h.reduce((n, b) => n + b.tinggi, 0);
  assert.ok(tinggi(halaman[0]) <= 100, `halaman pertama ${tinggi(halaman[0])}`);
  for (const h of halaman.slice(1)) {
    assert.ok(tinggi(h) <= 200, `halaman lanjutan ${tinggi(h)}`);
  }
});

test('semua transaksi masuk, tidak ada yang hilang saat dipenggal', () => {
  const semua = transaksi(97);
  const halaman = susunHalaman(semua, {
    ukur, tinggiBaris: 10, jarakBaris: 4,
    ruangHalamanPertama: 90, ruangHalamanBerikutnya: 150,
  });
  assert.equal(halaman.flat().length, 97);
});

test('urutan transaksi dipertahankan', () => {
  const semua = transaksi(30);
  const halaman = susunHalaman(semua, {
    ukur, tinggiBaris: 10, jarakBaris: 4,
    ruangHalamanPertama: 60, ruangHalamanBerikutnya: 60,
  });
  const urut = halaman.flat().map((b) => b.transaksi.keterangan);
  assert.deepEqual(urut, semua.map((t) => t.keterangan));
});

test('halaman pertama lebih sempit karena memuat kop', () => {
  const halaman = susunHalaman(transaksi(20), {
    ukur, tinggiBaris: 10, jarakBaris: 4,
    ruangHalamanPertama: 28, ruangHalamanBerikutnya: 140,
  });
  assert.equal(halaman[0].length, 2, 'hanya dua baris yang muat di halaman pertama');
  assert.ok(halaman[1].length > 2);
});

test('tanpa transaksi tetap menghasilkan satu halaman', () => {
  const halaman = susunHalaman([], {
    ukur, ruangHalamanPertama: 500, ruangHalamanBerikutnya: 700,
  });
  assert.equal(halaman.length, 1);
  assert.equal(halaman[0].length, 0);
});

test('total dijumlahkan dalam sen agar tidak melenceng', () => {
  const seratus = Array.from({ length: 300 }, () => ({ debit: 0.1, kredit: 0 }));
  assert.equal(totalkan(seratus).debit, 30);
});

test('lebar kolom pas di dalam margin A4', () => {
  const total = KOLOM.reduce((n, k) => n + k.lebar, 0);
  const tersedia = 595.28 - 34 * 2;
  assert.ok(total <= tersedia, `${total} pt melebihi ${tersedia} pt`);
  assert.ok(total > tersedia - 20, `${total} pt menyisakan ruang terlalu banyak`);
});

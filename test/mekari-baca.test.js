import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacaMekari, uraiTabelMekari, ringkasMekari, nomoriKembar } from '../src/mekari/baca.js';
import { hitungTemuan } from '../src/mekari/temuan.js';

const berkas = join(dirname(fileURLToPath(import.meta.url)), 'berkas', 'mekari-contoh.xlsx');

test('membaca ekspor Mekari beserta nama supplier dari baris kelompok', async () => {
  const hasil = await bacaMekari(await readFile(berkas), 'mekari-contoh.xlsx');
  assert.equal(hasil.sheet, 'Purchases by Supplier');
  assert.equal(hasil.transaksi.length, 9);
  // Mekari hanya menulis nama supplier sekali di baris kelompok; tanpa
  // dibawa turun, seluruh baris di bawahnya kehilangan suppliernya.
  assert.ok(hasil.transaksi.every((t) => t.supplier === 'CV SUMBER UJI'));
});

test('baris kaki laporan tidak ikut tersimpan', async () => {
  const hasil = await bacaMekari(await readFile(berkas), 'mekari-contoh.xlsx');
  const r = ringkasMekari(hasil.transaksi);
  // Grand Total di berkas 42.000.000. Kalau baris kaki ikut terbaca,
  // jumlahnya akan menjadi tiga kali lipat.
  assert.equal(r.nilai, 42000000);
  assert.ok(!hasil.transaksi.some((t) => /total/i.test(t.supplier ?? '')));
});

test('nilai baris diambil dari Jumlah Tagihan, bukan kolom Total', async () => {
  const hasil = await bacaMekari(await readFile(berkas), 'mekari-contoh.xlsx');
  // Kolom Total pada ekspor Mekari kumulatif berjalan. Baris terakhir bernilai
  // 600.000; kalau kolom Total yang terpakai, nilainya akan 42.000.000.
  assert.equal(hasil.transaksi.at(-1).jumlah, 600000);
});

test('tanggal terbaca sebagai DD/MM/YYYY', async () => {
  const hasil = await bacaMekari(await readFile(berkas), 'mekari-contoh.xlsx');
  assert.equal(hasil.transaksi[0].tanggal, '2025-01-06');
});

test('baris identik dalam satu berkas dinomori, bukan dilebur', async () => {
  const hasil = await bacaMekari(await readFile(berkas), 'mekari-contoh.xlsx');
  // Dua baris pertama sama persis, dan JUSTRU itu temuannya. Meleburnya akan
  // menghapus barang buktinya sendiri.
  assert.equal(hasil.transaksi[0].kembar_ke, 1);
  assert.equal(hasil.transaksi[1].kembar_ke, 2);
  assert.equal(hasil.transaksi.filter((t) => t.kembar_ke > 1).length, 1);
});

test('penomoran kembar mengikuti urutan baris, jadi selalu sama', () => {
  const buat = () => [
    { supplier: 'A', tanggal: '2025-01-01', no_invoice: 'I', produk: 'P', keterangan: 'X', kuantitas: 1, harga: 1, jumlah: 1 },
    { supplier: 'A', tanggal: '2025-01-01', no_invoice: 'I', produk: 'P', keterangan: 'X', kuantitas: 1, harga: 1, jumlah: 1 },
    { supplier: 'A', tanggal: '2025-01-01', no_invoice: 'I', produk: 'P', keterangan: 'Y', kuantitas: 1, harga: 1, jumlah: 1 },
  ];
  assert.deepEqual(nomoriKembar(buat()).map((t) => t.kembar_ke), [1, 2, 1]);
  assert.deepEqual(nomoriKembar(buat()).map((t) => t.kembar_ke), [1, 2, 1]);
});

test('tabel tanpa kolom yang menentukan ditolak', () => {
  assert.throws(
    () => uraiTabelMekari([['Nama', 'Alamat'], ['Budi', 'Jakarta']]),
    /belum dikenali/i
  );
});

test('temuan dari berkas contoh sesuai yang dirancang', async () => {
  const hasil = await bacaMekari(await readFile(berkas), 'mekari-contoh.xlsx');
  const audit = hitungTemuan(hasil.transaksi);
  const pasangan = audit.temuan.map((t) => [t.a.baris_sumber, t.b.baris_sumber].join('-'));

  // Baris 8+9 identik persis, 10+11 pengenal sama invoice berbeda.
  assert.ok(pasangan.includes('8-9'), 'baris identik harus jadi temuan');
  assert.ok(pasangan.includes('10-11'), 'unit sama di dua invoice harus jadi temuan');

  // Baris 14+15 seluruh angkanya sama tetapi unitnya jelas berbeda.
  assert.ok(!pasangan.includes('14-15'), 'angka sama saja tidak boleh jadi temuan');

  // Baris 16 tidak punya pengenal dan deskripsinya unik: tidak berpasangan.
  assert.ok(!pasangan.some((p) => p.includes('16')), 'baris tanpa pengenal tidak berpasangan');
});

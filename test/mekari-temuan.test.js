import test from 'node:test';
import assert from 'node:assert/strict';
import { hitungTemuan, nilaiPasangan, kunciStabil, ringkasAlasan } from '../src/mekari/temuan.js';
import { bubuhiPengenal } from '../src/mekari/pengenal.js';

const baris = (n, ubah = {}) => ({
  baris_sumber: n,
  sidik: `sidik-${n}`,
  supplier: 'CV UJI',
  tanggal: '2025-01-06',
  no_invoice: 'INV/1',
  produk: 'KAPAL',
  keterangan: 'SEDAN MK9ABCDEFGH123456 SURABAYA KUPANG',
  kuantitas: 1,
  harga: 5000000,
  jumlah: 5000000,
  ...ubah,
});

test('kunci stabil tidak bergantung urutan', () => {
  const a = baris(1);
  const b = baris(2);
  assert.equal(kunciStabil(a, b), kunciStabil(b, a));
});

test('angka saja tidak pernah membuka gerbang', () => {
  // Dua pembelian yang seluruh angkanya sama tetapi barangnya jelas berbeda.
  // Inilah pola yang membuat versi berbasis nominal menandai 95% berkas.
  const hasil = hitungTemuan([
    baris(1, { keterangan: 'TRUK KT 9111 ZZ SBY LEMBAR' }),
    baris(2, { keterangan: 'TRUK KT 9222 YY SBY LEMBAR' }),
  ]);
  assert.equal(hasil.temuan.length, 0);
  assert.equal(hasil.diperiksa, 0, 'pasangannya tidak boleh sampai dibandingkan');
});

test('baris identik persis menjadi temuan berskor tinggi', () => {
  const hasil = hitungTemuan([baris(1), baris(2)]);
  assert.equal(hasil.temuan.length, 1);
  const t = hasil.temuan[0];
  assert.ok(t.skor >= 10, `skor ${t.skor} terlalu rendah untuk baris identik`);
  assert.ok(t.ringkasan_alasan.includes('Deskripsi sama ✓'));
  assert.equal(t.nilai_berisiko, 5000000);
});

test('invoice berbeda menaikkan skor pasangan yang sama persis', () => {
  const satu = hitungTemuan([baris(1), baris(2)]).temuan[0];
  const dua = hitungTemuan([baris(1), baris(2, { no_invoice: 'INV/2' })]).temuan[0];
  assert.ok(dua.skor > satu.skor);
  assert.ok(dua.ringkasan_alasan.includes('Invoice berbeda ⚠'));
});

test('nomor mirip berkonteks beda tetap muncul, tetapi skornya lebih rendah', () => {
  const cocok = hitungTemuan([
    baris(1, { keterangan: 'PICKUP KT 5678 AB KPG SBY' }),
    baris(2, { keterangan: 'PICKUP KT 5678 AB KPG SBY', no_invoice: 'INV/2' }),
  ]).temuan[0];

  const mirip = hitungTemuan([
    baris(1, { keterangan: 'PICKUP KT 5678 AB KPG SBY' }),
    baris(2, { keterangan: 'PICKUP KT 5678 CD KPG SBY', no_invoice: 'INV/2' }),
  ]).temuan;

  // Tidak dibuang: melewatkan tagihan ganda jauh lebih mahal daripada satu
  // baris yang perlu dilihat mata.
  assert.equal(mirip.length, 1);
  assert.ok(mirip[0].skor < cocok.skor);
  assert.ok(mirip[0].ringkasan_alasan.includes('konteks beda'));
});

test('tanggal jauh berbeda menurunkan skor, tidak menggugurkan', () => {
  const dekat = nilaiPasangan(...bubuhiPengenal([baris(1), baris(2)]));
  const jauh = nilaiPasangan(...bubuhiPengenal([baris(1), baris(2, { tanggal: '2025-09-30' })]));
  assert.ok(jauh.skor < dekat.skor);
});

test('nominal nol tidak dihitung sebagai kesamaan', () => {
  const hasil = nilaiPasangan(
    ...bubuhiPengenal([baris(1, { jumlah: 0, harga: 0 }), baris(2, { jumlah: 0, harga: 0 })])
  );
  assert.ok(!ringkasAlasan(hasil.alasan).includes('Nominal sama'));
  assert.ok(!ringkasAlasan(hasil.alasan).includes('Harga satuan sama'));
});

test('kelompok raksasa dilaporkan utuh, bukan dijabarkan jadi pasangan', () => {
  // 80 baris berdeskripsi sama persis: itu baris template, bukan 3.160 tagihan
  // ganda. Menjabarkannya akan mengubur temuan sungguhan.
  const banyak = Array.from({ length: 80 }, (_, i) =>
    baris(i + 1, { keterangan: 'BIAYA ADMIN BULANAN', no_invoice: `INV/${i}` })
  );
  const hasil = hitungTemuan(banyak, { batasKelompok: 60 });
  assert.equal(hasil.temuan.length, 0);
  assert.equal(hasil.kelompok.length, 1);
  assert.equal(hasil.kelompok[0].jumlah, 80);
});

test('gerbang memangkas jumlah pasangan yang diperiksa', () => {
  const banyak = Array.from({ length: 100 }, (_, i) =>
    baris(i + 1, { keterangan: `UNIT SN${5000 + i} RUTE A B`, no_invoice: `INV/${i}` })
  );
  const hasil = hitungTemuan(banyak);
  assert.equal(hasil.pasangan_mungkin, 4950);
  assert.ok(hasil.diperiksa < 100, `diperiksa ${hasil.diperiksa}, seharusnya jauh di bawah n²`);
});

test('mesin yang sama bekerja pada data non-kendaraan', () => {
  const hasil = hitungTemuan([
    { baris_sumber: 1, sidik: 'a', supplier: 'PT NUSA TEKNIK', tanggal: '2025-04-02',
      no_invoice: 'INV/101', produk: 'SERVIS', keterangan: 'Servis genset SN GEN-77421 rutin',
      kuantitas: 1, harga: 7500000, jumlah: 7500000 },
    { baris_sumber: 2, sidik: 'b', supplier: 'PT NUSA TEKNIK', tanggal: '2025-04-02',
      no_invoice: 'INV/108', produk: 'SERVIS', keterangan: 'Servis genset SN GEN-77421 rutin',
      kuantitas: 1, harga: 7500000, jumlah: 7500000 },
    { baris_sumber: 3, sidik: 'c', supplier: 'PT NUSA TEKNIK', tanggal: '2025-04-20',
      no_invoice: 'INV/133', produk: 'SERVIS', keterangan: 'Servis genset SN GEN-90114 rutin',
      kuantitas: 1, harga: 7500000, jumlah: 7500000 },
  ]);
  assert.equal(hasil.temuan.length, 1, 'hanya nomor seri yang sama yang jadi temuan');
  assert.ok(hasil.temuan[0].ringkasan_alasan.includes('77421'));
});

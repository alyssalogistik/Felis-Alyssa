// Membaca berkas ekspor Mekari Jurnal menjadi baris siap simpan.
//
// Memakai pembaca berkas dan pengurai nilai yang sama dengan modul
// Rekonsiliasi — hanya membaca, tanpa mengubah apa pun di sana. Menyalin
// logikanya akan membuat dua tempat bisa menyimpang dalam menafsirkan tanggal
// dan nominal, dan selisih tafsir tanggal tidak menimbulkan galat apa pun.

import { bukaBerkas } from '../rekonsiliasi/baca.js';
import { GalatFormat } from '../rekonsiliasi/parser.js';
import { uraiTanggal, uraiNominal } from '../rekonsiliasi/nilai.js';
import { normalkan } from './pengenal.js';

export { BATAS_UKURAN } from '../rekonsiliasi/baca.js';

const PESAN_TIDAK_DIKENALI =
  'Format ekspor Mekari belum dikenali. Pastikan berkasnya laporan ' +
  '"Purchases by Supplier" beserta baris judul kolomnya (Produk, Keterangan, ' +
  'Kuantitas, Harga Satuan, Jumlah Tagihan).';

/**
 * Judul kolom yang dikenali, diperiksa setelah huruf dan tanda bacanya
 * diseragamkan. Urutannya berarti: yang lebih khusus diperiksa lebih dulu,
 * supaya "JUMLAH TAGIHAN" tidak tertangkap sebagai "JUMLAH" (kuantitas).
 */
const KAMUS = [
  ['jumlah', ['JUMLAH TAGIHAN', 'JUMLAH TOTAL', 'AMOUNT', 'SUBTOTAL', 'NILAI TAGIHAN']],
  ['harga', ['HARGA SATUAN', 'UNIT PRICE', 'HARGA']],
  ['kuantitas', ['KUANTITAS', 'QUANTITY', 'QTY', 'JUMLAH UNIT', 'JUMLAH']],
  ['keterangan', ['KETERANGAN', 'DESKRIPSI', 'DESCRIPTION', 'MEMO', 'CATATAN']],
  ['produk', ['PRODUK', 'PRODUCT', 'ITEM', 'BARANG', 'AKUN']],
  ['satuan', ['SATUAN', 'UNIT']],
  ['no_invoice', ['NO INVOICE', 'NOMOR INVOICE', 'NO TRANSAKSI', 'INVOICE', 'NUMBER', 'NO', 'NOMOR']],
  ['transaksi', ['TRANSAKSI', 'TRANSACTION', 'TIPE TRANSAKSI', 'JENIS']],
  ['total', ['TOTAL BERJALAN', 'RUNNING TOTAL', 'TOTAL']],
  ['supplier_tanggal', ['SUPPLIER TANGGAL', 'SUPPLIER', 'VENDOR', 'PEMASOK', 'TANGGAL']],
];

/**
 * Baris kaki laporan. Angkanya sah tetapi bukan transaksi, dan kalau ikut
 * tersimpan, satu berkas akan tampak memuat pembelian dua kali lipat.
 */
const KAKI = /^(grand total|total pembelian|total|subtotal|jumlah keseluruhan)\b/i;

const rapikan = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const kunciJudul = (v) => normalkan(v).replace(/\s+/g, ' ');

function barisKosong(baris) {
  return (baris ?? []).every((sel) => rapikan(sel) === '');
}

/** Menemukan baris judul kolom dan peta kolomnya. */
export function cariHeaderMekari(baris) {
  for (let i = 0; i < Math.min(baris.length, 40); i += 1) {
    const b = baris[i] ?? [];
    const peta = {};
    const terpakai = new Set();

    for (const [bidang, judul] of KAMUS) {
      for (let k = 0; k < b.length; k += 1) {
        if (terpakai.has(k) || peta[bidang] !== undefined) continue;
        if (judul.includes(kunciJudul(b[k]))) {
          peta[bidang] = k;
          terpakai.add(k);
        }
      }
    }

    // Kolom yang benar-benar menentukan: tanpa keterangan tidak ada identitas
    // yang bisa dibandingkan, dan tanpa nilai tagihan tidak ada yang diaudit.
    if (peta.keterangan !== undefined && peta.jumlah !== undefined && peta.produk !== undefined) {
      return { peta, indeks: i };
    }
  }
  return null;
}

/**
 * Menguraikan tabel Mekari menjadi baris transaksi.
 *
 * Tiga bentuk baris yang harus dibedakan, dan salah satu pun keliru membuat
 * angkanya salah tanpa satu galat pun:
 *
 *   1. **Baris kelompok supplier** — hanya kolom pertama terisi. Nama supplier
 *      di situ berlaku untuk seluruh baris di bawahnya sampai kelompok
 *      berikutnya, karena Mekari tidak mengulangnya per baris.
 *   2. **Baris transaksi** — punya nilai tagihan.
 *   3. **Baris kaki** — Total Pembelian dan Grand Total. Nilainya sah tetapi
 *      merupakan penjumlahan baris di atasnya.
 */
export function uraiTabelMekari(baris, { berkasSumber = '' } = {}) {
  const header = cariHeaderMekari(baris);
  if (!header) throw new GalatFormat(PESAN_TIDAK_DIKENALI);

  const { peta, indeks: barisHeader } = header;
  const ambil = (b, bidang) => (peta[bidang] === undefined ? null : b[peta[bidang]] ?? null);

  const transaksi = [];
  let supplier = '';

  for (let i = barisHeader + 1; i < baris.length; i += 1) {
    const b = baris[i] ?? [];
    if (barisKosong(b)) continue;

    const kolomPertama = rapikan(b[0]);
    const sisaKosong = b.slice(1).every((sel) => rapikan(sel) === '');

    if (kolomPertama !== '' && sisaKosong) {
      supplier = kolomPertama;
      continue;
    }

    if (KAKI.test(kolomPertama) || KAKI.test(rapikan(ambil(b, 'transaksi')))) continue;
    // Kaki per supplier ditulis "(NAMA SUPPLIER) | Total Pembelian | angka".
    if (KAKI.test(rapikan(b[1]))) continue;

    const jumlah = uraiNominal(ambil(b, 'jumlah'));
    if (!jumlah.ok) continue;

    const masalah = [];

    // Kolom pertama memuat tanggal pada baris transaksi, nama supplier pada
    // baris kelompok. Keduanya kolom yang sama, dan itu bentuk laporannya.
    const tgl = uraiTanggal(kolomPertama);
    if (!tgl.ok) masalah.push('Tanggal tidak terbaca.');

    const keterangan = rapikan(ambil(b, 'keterangan'));
    if (keterangan === '') masalah.push('Keterangan kosong.');
    if (supplier === '') masalah.push('Supplier tidak diketahui.');

    const kuantitas = uraiNominal(ambil(b, 'kuantitas'));
    const harga = uraiNominal(ambil(b, 'harga'));

    transaksi.push({
      baris_sumber: i + 1,
      berkas_sumber: berkasSumber,
      supplier,
      tanggal: tgl.ok ? tgl.tanggal : null,
      tanggal_ambigu: Boolean(tgl.ambigu),
      jenis_transaksi: rapikan(ambil(b, 'transaksi')) || null,
      no_invoice: rapikan(ambil(b, 'no_invoice')) || null,
      produk: rapikan(ambil(b, 'produk')) || null,
      keterangan,
      kuantitas: kuantitas.ok ? Math.abs(kuantitas.nilai) : 0,
      satuan: rapikan(ambil(b, 'satuan')) || null,
      harga: harga.ok ? Math.abs(harga.nilai) : 0,
      // Nilai baris diambil dari Jumlah Tagihan, TIDAK PERNAH dari kolom Total.
      // Kolom Total pada ekspor Mekari adalah jumlah kumulatif berjalan, jadi
      // memakainya akan menggelembungkan nilai setiap baris mengikuti posisinya
      // di dalam berkas — dan baris terakhir akan bernilai seluruh laporan.
      jumlah: Math.abs(jumlah.nilai),
      masalah,
    });
  }

  if (transaksi.length === 0) throw new GalatFormat(PESAN_TIDAK_DIKENALI);

  nomoriKembar(transaksi);
  return { transaksi, peta, barisHeader: barisHeader + 1 };
}

/**
 * Menomori baris yang isinya sama persis di dalam satu berkas.
 *
 * **Ini bagian yang paling mudah dirusak.** Dua baris identik di dalam satu
 * ekspor Mekari JUSTRU temuannya — di berkas sungguhan, baris 120 dan 121 sama
 * persis dan itulah satu-satunya potensi duplikasi berskor tertinggi. Dedup
 * baris yang naif akan menghapus barang buktinya sendiri.
 *
 * Jadi barisnya tidak pernah dilebur; yang kedua diberi nomor urut supaya
 * keduanya bisa berdiri berdampingan di bawah indeks unik. Nomornya mengikuti
 * urutan baris di berkas, sehingga berkas yang sama selalu menghasilkan nomor
 * yang sama dan unggahan ulang tetap tertolak sebagai duplikat.
 */
export function nomoriKembar(transaksi) {
  const terlihat = new Map();
  for (const t of transaksi) {
    const kunci = [
      t.supplier, t.tanggal ?? '', t.no_invoice ?? '', t.produk ?? '',
      normalkan(t.keterangan), t.kuantitas, t.harga, t.jumlah,
    ].join('|');
    const sebelumnya = terlihat.get(kunci) ?? 0;
    t.kembar_ke = sebelumnya + 1;
    terlihat.set(kunci, t.kembar_ke);
  }
  return transaksi;
}

/** Membaca berkas Mekari, memakai sheet pertama yang tabelnya dikenali. */
export async function bacaMekari(buffer, namaBerkas = '') {
  const sheets = await bukaBerkas(buffer, namaBerkas);

  const galat = [];
  for (const sheet of sheets) {
    try {
      const hasil = uraiTabelMekari(sheet.baris, { berkasSumber: namaBerkas });
      return { ...hasil, sheet: sheet.nama };
    } catch (error) {
      if (!(error instanceof GalatFormat)) throw error;
      galat.push(error);
    }
  }

  throw galat[0] ?? new GalatFormat(PESAN_TIDAK_DIKENALI);
}

/** Ringkasan sebuah ekspor setelah diurai. */
export function ringkasMekari(transaksi) {
  const uang = (f) => transaksi.reduce((a, t) => a + Math.round((f(t) ?? 0) * 100), 0) / 100;
  return {
    total: transaksi.length,
    bermasalah: transaksi.filter((t) => t.masalah.length > 0).length,
    supplier: new Set(transaksi.map((t) => t.supplier).filter(Boolean)).size,
    produk: new Set(transaksi.map((t) => t.produk).filter(Boolean)).size,
    invoice: new Set(transaksi.map((t) => t.no_invoice).filter(Boolean)).size,
    nilai: uang((t) => t.jumlah),
  };
}

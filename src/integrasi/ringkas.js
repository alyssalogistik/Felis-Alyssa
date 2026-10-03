// Ringkasan pembayaran per supplier, per entitas.
//
// Murni: tanpa I/O, tanpa DOM, tanpa database. Yang diputuskan di sini adalah
// apakah seorang supplier sudah lunas, kurang bayar, atau kelebihan — jadi
// aturannya harus bisa diuji tanpa menyiapkan apa pun.
//
// ## Yang mengelompokkan adalah supplier_id, TIDAK PERNAH nama
//
// Satu supplier bisa dibayar lewat beberapa transfer dengan nama penerima yang
// berbeda-beda: pekerjaan atas MARTHEN RUTURAMBE dibayar sebagian ke MARTHEN
// dan sebagian ke JAFAR TALI. Nama penerima adalah informasi audit transaksi
// bank; yang menentukan pembayaran itu milik siapa adalah manusia, dan
// keputusannya tersimpan sebagai supplier_id.

import { kemiripanNama } from '../rekonsiliasi/pencocokan.js';

/** Sama dengan toleransi audit yang sudah dipakai: selisih di bawah ini pembulatan bank. */
export const TOLERANSI = 1000;

export const STATUS_BAYAR = {
  // Kewajibannya belum ditetapkan manusia. BUKAN berarti nol.
  BELUM_DITETAPKAN: 'BELUM_DITETAPKAN',
  BELUM_BAYAR: 'BELUM_BAYAR',
  SEBAGIAN: 'SEBAGIAN',
  LUNAS: 'LUNAS',
  LEBIH_BAYAR: 'LEBIH_BAYAR',
};

/** Uang dibandingkan dalam sen supaya pecahan biner tidak menumpuk. */
const sen = (n) => Math.round(Number(n ?? 0) * 100);

/**
 * Status pembayaran seorang supplier terhadap kewajibannya.
 *
 * Kewajiban yang belum ditetapkan menghasilkan BELUM_DITETAPKAN, bukan LUNAS
 * dan bukan LEBIH_BAYAR. Menebak "lunas" dari kewajiban yang tidak diketahui
 * adalah cara paling mudah membuat orang berhenti membayar yang belum lunas;
 * menebak "lebih bayar" membuat orang menagih balik uang yang memang haknya.
 */
export function statusPembayaran(totalDibayar, kewajiban, toleransi = TOLERANSI) {
  if (kewajiban === null || kewajiban === undefined || kewajiban === '') {
    return STATUS_BAYAR.BELUM_DITETAPKAN;
  }

  const bayar = sen(totalDibayar);
  const wajib = sen(kewajiban);
  const batas = sen(toleransi);

  if (bayar === 0) return STATUS_BAYAR.BELUM_BAYAR;
  if (Math.abs(bayar - wajib) <= batas) return STATUS_BAYAR.LUNAS;
  return bayar < wajib ? STATUS_BAYAR.SEBAGIAN : STATUS_BAYAR.LEBIH_BAYAR;
}

/**
 * Sisa kewajiban, atau null bila kewajibannya belum ditetapkan.
 *
 * null, bukan nol. Nol berarti "sudah lunas" dan itu kesimpulan.
 */
export function sisaKewajiban(totalDibayar, kewajiban) {
  if (kewajiban === null || kewajiban === undefined || kewajiban === '') return null;
  return (sen(kewajiban) - sen(totalDibayar)) / 100;
}

/**
 * Nama penerima di bank berbeda dari nama supplier administrasi?
 *
 * Dipakai HANYA untuk memberi tanda di layar, tidak pernah untuk menolak.
 * Transfer ke JAFAR TALI untuk pekerjaan MARTHEN RUTURAMBE adalah keadaan yang
 * sah; yang tidak sah adalah menyembunyikannya dari auditor.
 *
 * Memakai kemiripanNama() yang sama dengan mesin audit, bukan aturan kedua:
 * dua aturan yang berbeda akan memberi tanda yang berbeda untuk baris yang
 * sama di dua layar.
 */
export function penerimaBerbeda(supplierNama, keteranganBank) {
  if (!supplierNama || !keteranganBank) return false;
  return kemiripanNama(supplierNama, keteranganBank) === 0;
}

/**
 * Melengkapi satu baris riwayat dengan status dan sisanya.
 *
 * Nilai dari database datang sebagai teks pada kolom numeric; diubah ke angka
 * di satu tempat ini supaya tidak ada pemanggil yang menjumlahkan teks.
 */
export function lengkapiRingkasan(baris) {
  const total = Number(baris.total_dibayar ?? 0);
  const kewajiban = baris.kewajiban === null || baris.kewajiban === undefined
    ? null
    : Number(baris.kewajiban);

  return {
    ...baris,
    total_dibayar: total,
    kewajiban,
    sisa: sisaKewajiban(total, kewajiban),
    status: statusPembayaran(total, kewajiban),
    // Lebih dari satu ejaan untuk satu supplier_id berarti ada salah ketik.
    // Totalnya tetap benar karena dikelompokkan dari id, tetapi salah ketik
    // yang tidak pernah dilaporkan tidak akan pernah diperbaiki.
    ejaan_tidak_seragam: Number(baris.jumlah_ejaan_nama ?? 1) > 1,
  };
}

/**
 * Melengkapi satu baris rincian pembayaran.
 *
 * `keterangan` bank diteruskan APA ADANYA — itulah bukti siapa penerima
 * transfer yang sebenarnya, dan satu-satunya yang bisa dipertanggungjawabkan
 * ke mutasi bank saat audit.
 */
export function lengkapiRincian(tautan, transaksi, alokasi = null) {
  return {
    transaksi_id: tautan.transaksi_id,
    supplier_id: tautan.supplier_id,
    supplier_nama: tautan.supplier_nama,
    entitas: tautan.entitas,
    tanggal: tautan.tanggal,
    nominal: Number(tautan.nominal ?? 0),
    status: tautan.status,
    sidik: tautan.sidik,

    keterangan_bank: transaksi?.keterangan ?? null,
    no_rekening_sumber: transaksi?.no_rekening ?? null,
    referensi_bank: transaksi?.referensi ?? null,

    penerima_berbeda: penerimaBerbeda(tautan.supplier_nama, transaksi?.keterangan),
    alokasi_manual: alokasi?.keterangan ?? null,
  };
}

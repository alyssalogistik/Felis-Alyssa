// Penjaga double count untuk pembayaran manual.
//
// Murni: menerima calon pembayaran dan baris-baris yang sudah ada,
// mengembalikan kandidat yang mungkin transaksi yang sama. Tanpa I/O.
//
// KAIDAHNYA: memperingatkan, bukan memblokir. Transfer BCA dan pembayaran
// Mekari Pay pada hari yang sama dengan nominal yang sama bisa benar-benar dua
// pembayaran berbeda, dan menolaknya otomatis akan membuat uang yang sungguhan
// keluar hilang dari catatan. Yang diputuskan mesin hanya "ini perlu dilihat
// orang"; yang memutuskan itu pembayaran tambahan atau bukan tetap manusia.
//
// Memakai kemiripanNama() dan namaDariKeterangan() yang sudah ada — dibaca
// saja, tidak diubah. Menyalin aturannya akan membuat dua tempat bisa
// menyimpang dalam memutuskan dua nama itu orang yang sama atau bukan.

import { kemiripanNama } from './pencocokan.js';
import { namaDariKeterangan } from './nama.js';

export const KUAT = 'kuat';
export const LEMAH = 'lemah';

export const BAWAAN = {
  /** Selisih nominal yang masih dianggap transaksi yang sama. */
  toleransiNominal: 1000,
  /** Jarak hari yang masih layak dicurigai bila nominalnya sama persis. */
  jarakHari: 3,
  /** Di bawah ini nama dianggap bukan orang yang sama. */
  ambangNama: 0.5,
};

const sen = (n) => Math.round(Number(n ?? 0) * 100);

/** Referensi dibandingkan tanpa tanda baca: INV/AAL/10/I/2025 = INV-AAL-10-I-2025. */
const kunciReferensi = (teks) => String(teks ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const selisihHari = (a, b) => {
  if (!a || !b) return null;
  const hari = (t) => Date.UTC(...String(t).split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  return Math.round((hari(b) - hari(a)) / 86400000);
};

/**
 * Nama lawan transaksi pada satu baris yang sudah tersimpan.
 *
 * Baris rekening koran menyembunyikan namanya di dalam keterangan bersama kode
 * dan nominal, sedangkan pembayaran manual menyimpan penerimanya di depan.
 * Keduanya dilewatkan penarik nama yang sama supaya tidak ada cabang aturan.
 */
function namaBaris(baris) {
  return namaDariKeterangan(baris.keterangan) ?? String(baris.keterangan ?? '');
}

/**
 * Mencari baris yang mungkin pembayaran yang sama dengan calon.
 *
 * @param {{tanggal: string, penerima: string, nominal: number,
 *          no_referensi: string|null, sumber: string}} calon
 * @param {Array<object>} baris Baris dari pembayaran_semua (bank maupun manual).
 * @param {{abaikanId?: string}} opsi  Id yang dikecualikan, dipakai saat menyunting.
 * @returns {Array<object>} Kandidat, yang paling kuat lebih dulu.
 */
export function cariKembar(calon, baris, opsi = {}) {
  const o = { ...BAWAAN, ...opsi };
  const refCalon = kunciReferensi(calon.no_referensi);
  const nominalCalon = sen(calon.nominal);

  const hasil = [];

  for (const b of baris) {
    if (opsi.abaikanId && b.id === opsi.abaikanId) continue;

    const alasan = [];
    let kekuatan = null;

    const nominalBaris = sen(b.debit) > 0 ? sen(b.debit) : sen(b.kredit);
    const bedaNominal = Math.abs(nominalBaris - nominalCalon);
    const jarak = selisihHari(calon.tanggal, b.tanggal);
    const mirip = kemiripanNama(calon.penerima, namaBaris(b));

    // Nomor referensi adalah bukti terkuat: nomor invoice unik, nama tidak.
    // Berlaku berapa pun jarak tanggalnya — satu invoice yang dibayar dua kali
    // justru pola double count yang paling sering terjadi.
    const refBaris = kunciReferensi(b.referensi);
    if (refCalon.length >= 4 && refBaris === refCalon) {
      kekuatan = KUAT;
      alasan.push(`Nomor referensi sama: ${calon.no_referensi}.`);
    }

    if (jarak !== null && mirip >= o.ambangNama) {
      if (jarak === 0 && bedaNominal <= sen(o.toleransiNominal)) {
        kekuatan = KUAT;
        alasan.push('Tanggal dan nominalnya sama persis.');
      } else if (Math.abs(jarak) <= o.jarakHari && bedaNominal === 0) {
        kekuatan = kekuatan ?? LEMAH;
        alasan.push(`Nominalnya sama, selisih ${Math.abs(jarak)} hari.`);
      }
    }

    if (kekuatan === null) continue;

    if (mirip >= o.ambangNama) {
      alasan.push(mirip === 1 ? 'Nama penerima cocok penuh.' : `Nama penerima mirip (${Math.round(mirip * 100)}%).`);
    }

    hasil.push({
      id: b.id,
      asal: b.asal,
      sumber: b.sumber,
      tanggal: b.tanggal,
      keterangan: b.keterangan,
      nominal: nominalBaris / 100,
      referensi: b.referensi ?? null,
      kekuatan,
      alasan,
    });
  }

  const urutan = { [KUAT]: 0, [LEMAH]: 1 };
  return hasil.sort((a, b) => urutan[a.kekuatan] - urutan[b.kekuatan] || a.tanggal.localeCompare(b.tanggal));
}

/**
 * Peringatan yang tidak bergantung pada adanya kandidat.
 *
 * Sumber BCA berdiri sendiri: rekening korannya sudah menjadi sumber kebenaran
 * transaksi bank, jadi pembayaran BCA yang diketik manual hampir selalu sudah
 * ada di sana — hanya belum diunggah, atau tertulis dengan nama yang berbeda.
 * Memasukkannya sebagai pembayaran tambahan menggandakan uang keluar tanpa
 * gejala apa pun di layar.
 */
export function peringatanSumber(sumber) {
  if (sumber !== 'BCA') return [];
  return [
    'Sumber BCA dipilih. Transaksi bank seharusnya masuk lewat unggah rekening koran, ' +
    'bukan diketik manual — kemungkinan besar transfer ini sudah ada di e-statement. ' +
    'Pastikan rekening koran bulan itu sudah diunggah dan transaksinya benar-benar belum tercatat.',
  ];
}

/**
 * Apakah penyimpanan perlu ditahan sampai ada persetujuan.
 *
 * Sumber BCA selalu menuntut persetujuan, sekalipun tidak ada kandidat yang
 * ditemukan: ketiadaan kandidat di sini lebih sering berarti rekening korannya
 * belum diunggah daripada berarti transaksinya memang belum ada.
 */
export function perluKonfirmasi(kandidat, sumber) {
  return sumber === 'BCA' || kandidat.some((k) => k.kekuatan === KUAT);
}

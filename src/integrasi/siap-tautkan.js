// Aturan murni untuk panel "Transaksi Siap Ditautkan": rentang tanggal,
// pintasan, ringkasan hasil, dan penanda kemungkinan dobel.
//
// Tanpa I/O dan tanpa DOM, dipakai server (`/tautan/siap-tautkan`) maupun
// peramban. `src/server.js` menyajikannya di `/siap-tautkan.js` alih-alih
// menyalinnya ke `public/`: salinan yang tertinggal akan membuat aturan di
// layar berbeda dari yang diterapkan server tanpa satu pun galat.
//
// SEMUA TANGGAL DI SINI BERUPA TEKS `YYYY-MM-DD`, tidak pernah objek Date yang
// dibaca dengan zona waktu peramban. `transaksi_bank.tanggal` bertipe `date`;
// membandingkannya sebagai teks dan memformatnya dengan memotong teks adalah
// satu-satunya cara yang tidak bisa menggeser satu hari.

// Aturan "inti keterangan" dipakai bersama dengan penjaga unggahan (pending.js),
// bukan disalin: dua aturan berbeda akan menandai pasangan yang berbeda di dua
// tempat. Peramban memuatnya lewat `/rekonsiliasi/pending.js` (lihat server.js).
import { intiKeterangan } from '../rekonsiliasi/pending.js';

const POLA_TANGGAL = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_SEHARI = 24 * 60 * 60 * 1000;
const OFFSET_WIB_MS = 7 * 60 * 60 * 1000;

/** Teks `YYYY-MM-DD` yang benar-benar ada di kalender, atau null. */
export function tanggalSah(nilai) {
  if (typeof nilai !== 'string') return null;
  const m = POLA_TANGGAL.exec(nilai.trim());
  if (!m) return null;
  const [, t, b, h] = m;
  const d = new Date(Date.UTC(Number(t), Number(b) - 1, Number(h)));
  const sama = d.getUTCFullYear() === Number(t)
    && d.getUTCMonth() === Number(b) - 1
    && d.getUTCDate() === Number(h);
  return sama ? `${t}-${b}-${h}` : null;
}

/**
 * Memeriksa rentang "dari" dan "sampai". Salah satu boleh kosong.
 *
 * Kosong berarti tanpa batas di sisi itu, bukan galat. Dari > Sampai ditolak:
 * database tidak menganggapnya galat dan hanya mengembalikan daftar kosong, dan
 * kosong di panel ini terbaca "tidak ada transaksi" padahal pemakainya hanya
 * salah mengisi.
 *
 * @returns {{ok: true, dari: string|null, sampai: string|null}
 *         | {ok: false, pesan: string}}
 */
export function periksaRentang(dari, sampai) {
  const kosong = (x) => x === undefined || x === null || String(x).trim() === '';

  let d = null;
  let s = null;
  if (!kosong(dari)) {
    d = tanggalSah(String(dari));
    if (!d) return { ok: false, pesan: 'Tanggal "Dari" tidak valid. Pakai format tahun-bulan-hari.' };
  }
  if (!kosong(sampai)) {
    s = tanggalSah(String(sampai));
    if (!s) return { ok: false, pesan: 'Tanggal "Sampai" tidak valid. Pakai format tahun-bulan-hari.' };
  }
  if (d && s && d > s) {
    return {
      ok: false,
      pesan: `Tanggal "Dari" (${formatTanggal(d)}) tidak boleh lebih besar dari "Sampai" (${formatTanggal(s)}).`,
    };
  }
  return { ok: true, dari: d, sampai: s };
}

/** `2026-09-15` -> `15/09/2026`. Memotong teks, tidak lewat Date. */
export function formatTanggal(nilai) {
  const sah = tanggalSah(String(nilai ?? ''));
  if (!sah) return nilai ? String(nilai) : '';
  const [t, b, h] = sah.split('-');
  return `${h}/${b}/${t}`;
}

/** Tanggal hari ini menurut WIB (UTC+7), sebagai `YYYY-MM-DD`. */
export function hariIniWib(sekarang = new Date()) {
  return new Date(sekarang.getTime() + OFFSET_WIB_MS).toISOString().slice(0, 10);
}

function utc(tanggal) {
  const [t, b, h] = tanggal.split('-').map(Number);
  return Date.UTC(t, b - 1, h);
}

function teks(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export const PINTASAN = {
  bulan_ini: 'Bulan ini',
  bulan_lalu: 'Bulan lalu',
  '30_hari': '30 hari terakhir',
};

/**
 * Rentang untuk satu pintasan, dihitung dari tanggal WIB.
 *
 * - bulan_ini: tanggal 1 sampai tanggal terakhir bulan ini.
 * - bulan_lalu: tanggal 1 sampai tanggal terakhir bulan sebelumnya.
 * - 30_hari: 30 hari KALENDER termasuk hari ini (hari ini dikurangi 29 hari).
 */
export function rentangPintasan(nama, hariIni = hariIniWib()) {
  const sah = tanggalSah(hariIni);
  if (!sah) return null;
  const [t, b] = sah.split('-').map(Number);

  if (nama === 'bulan_ini') {
    return { dari: teks(Date.UTC(t, b - 1, 1)), sampai: teks(Date.UTC(t, b, 0)) };
  }
  if (nama === 'bulan_lalu') {
    return { dari: teks(Date.UTC(t, b - 2, 1)), sampai: teks(Date.UTC(t, b - 1, 0)) };
  }
  if (nama === '30_hari') {
    return { dari: teks(utc(sah) - 29 * MS_SEHARI), sampai: sah };
  }
  return null;
}

/**
 * Menerapkan rentang ke kueri Supabase. INKLUSIF di kedua ujung.
 *
 * Dipanggil SEBELUM `.limit()`: batas jumlah baris yang dipasang lebih dulu
 * memotong dulu lalu menyaring, sehingga rentang yang sempit bisa tampak kosong
 * padahal barisnya ada di luar potongan itu.
 */
export function terapkanRentang(kueri, dari, sampai) {
  let q = kueri;
  if (dari) q = q.gte('tanggal', dari);
  if (sampai) q = q.lte('tanggal', sampai);
  return q;
}

/**
 * Membuang transaksi yang sudah tertaut, lalu memotong ke batas.
 *
 * Murni supaya aturannya teruji: yang sudah ditautkan tidak pernah muncul di
 * daftar "siap ditautkan", dan pembuangannya terjadi SESUDAH pengambilan.
 */
export function pilihBebas(baris, terpakai, batas) {
  return (baris ?? []).filter((t) => !terpakai.has(t.id)).slice(0, batas);
}

/**
 * Kunci "kemungkinan dobel": tanggal + nominal + INTI keterangan.
 *
 * Inti keterangan, bukan keterangan mentah. E-statement dan Mutasi Rekening
 * menuliskan transfer yang sama dengan awalan jenis yang berbeda
 * (`TRSF E-BANKING DB 0110/FTSCY/...` vs `0110/FTSCY/...`), dan itulah persis
 * cara satu transfer tersimpan dua kali: sidik jari di database memuat
 * keterangan MAUPUN referensi, jadi keduanya dianggap dua transaksi. Kunci yang
 * membandingkan keterangan mentah akan melewatkan pasangan ini.
 *
 * Referensi sengaja TIDAK ikut: satu cetakan menariknya dari keterangan, yang
 * lain tidak, sehingga ia justru yang membedakan pasangan itu.
 */
export function kunciDobel(t) {
  const cent = Math.round(Number(t.nominal ?? 0) * 100);
  return `${t.tanggal ?? ''}|${cent}|${intiKeterangan(t.keterangan)}`;
}

/**
 * ID transaksi yang kemungkinan dobel: ada lebih dari satu baris dengan kunci
 * yang sama di daftar ini.
 *
 * HANYA PENANDA. Tidak menghapus, tidak menolak, tidak mencentang. Dua
 * penarikan bernominal sama pada hari yang sama bisa transaksi sungguhan yang
 * berbeda; yang memutuskan manusia, dengan mutasi bank di tangannya.
 */
export function idKemungkinanDobel(baris) {
  const kelompok = new Map();
  for (const t of baris ?? []) {
    const k = kunciDobel(t);
    if (!kelompok.has(k)) kelompok.set(k, []);
    kelompok.get(k).push(t.bank_transaction_id ?? t.id);
  }
  const hasil = new Set();
  for (const ids of kelompok.values()) {
    if (ids.length > 1) for (const id of ids) hasil.add(id);
  }
  return hasil;
}

/** Jumlah dan total nominal baris yang ditampilkan. Dijumlah dalam sen. */
export function ringkasHasil(baris) {
  let sen = 0;
  for (const t of baris ?? []) sen += Math.round(Number(t.nominal ?? 0) * 100);
  return { jumlah: (baris ?? []).length, total: sen / 100 };
}

/** Kalimat rentang untuk ringkasan: "15/09/2026 - 24/09/2026", "sejak ...", dst. */
export function teksRentang(dari, sampai) {
  if (dari && sampai) return `${formatTanggal(dari)} - ${formatTanggal(sampai)}`;
  if (dari) return `sejak ${formatTanggal(dari)}`;
  if (sampai) return `sampai ${formatTanggal(sampai)}`;
  return 'semua tanggal';
}

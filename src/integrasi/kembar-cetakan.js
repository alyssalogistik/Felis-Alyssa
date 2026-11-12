// Mengenali transfer yang sama dari DUA CETAKAN BCA berbeda (e-statement vs
// Mutasi Rekening), dan memutuskan apakah semua transfer nyatanya sudah tertaut.
//
// Murni, tanpa I/O. Dipakai server (`POST /tautan`, `/tautan/saran`, panel Siap
// Ditautkan) dan boleh dimuat peramban.
//
// Kenapa penjaga lama tidak cukup: `transaksi_bank_kembar` mengenali salinan
// lewat `sidik_tampil`, yang memuat keterangan DAN referensi. Kedua cetakan
// menulis keterangan dengan awalan jenis berbeda dan e-statement tidak
// menurunkan referensi, jadi transfer yang sama tampak sebagai dua transaksi:
//
//   Mutasi     : TRSF E-BANKING DB 0110/FTSCY/WS95051 10000000.00 ...   ref terisi
//   E-statement: 0110/FTSCY/WS95051 10000000.00 ...                     ref kosong
//
// Diukur pada data sungguhan: 43 pasangan seperti itu untuk 01-10 Oktober 2026,
// dan satu di antaranya sudah ditarik DUA KALI ke alyssa-dev (Rp 10.000.000).
//
// ATURANNYA MENGHITUNG, tidak sekadar "ada kembar tertaut". Dua transfer nyata
// yang kebetulan identik pada hari yang sama (dua penarikan tunai bernominal
// sama) dicetak dua kali oleh KEDUA cetakan. Jumlah transfer nyatanya sebanyak
// baris terbanyak yang dimuat satu cetakan; selama yang tertaut masih lebih
// sedikit dari itu, masih ada transfer nyata yang belum dibayarkan. Menolak
// begitu ada satu kembar tertaut akan memblokir transfer nyata yang kedua.

import { intiKeterangan } from '../rekonsiliasi/pending.js';

const sen = (n) => Math.round(Number(n ?? 0) * 100);

/**
 * Kunci transfer, tanpa awalan jenis dan tanpa referensi.
 *
 * Referensi sengaja tidak ikut: ia diturunkan dari keterangan, dan satu cetakan
 * menurunkannya sedangkan yang lain tidak — itulah yang membedakan pasangan itu.
 * Entitas tidak ada di sini; pemanggil selalu memilah per entitas lebih dulu.
 */
export function kunciCetakan(t) {
  return `${t.tanggal ?? ''}|${sen(t.debit ?? t.nominal)}|${intiKeterangan(t.keterangan)}`;
}

/**
 * Apakah transfer nyata dalam kelompok `diri` sudah tertaut semuanya?
 *
 * @param {{id: string, tanggal: string, debit: number|string, keterangan: string, unggahan_id: string}} diri
 * @param {Array<{id: string, tanggal: string, debit: number|string, keterangan: string, unggahan_id: string}>}
 *        baris SEMUA baris fisik pada hari dan nominal yang sama (termasuk `diri`)
 * @param {Set<string>} idTertaut id yang tautannya masih memegang transaksinya
 * @returns {{berlaku: boolean, habis: boolean, nyata: number, tertaut: string[]}}
 *   `berlaku` false bila kelompoknya hanya dari satu cetakan: itu bukan urusan
 *   penjaga ini, dan perilaku lama dibiarkan.
 */
export function cetakanLainSudahTertaut(diri, baris, idTertaut) {
  const kunci = kunciCetakan(diri);
  const kelompok = (baris ?? []).filter((r) => kunciCetakan(r) === kunci);
  if (!kelompok.some((r) => r.id === diri.id)) kelompok.push(diri);

  const perCetakan = new Map();
  for (const r of kelompok) perCetakan.set(r.unggahan_id, (perCetakan.get(r.unggahan_id) ?? 0) + 1);

  if (perCetakan.size < 2) return { berlaku: false, habis: false, nyata: perCetakan.size === 1 ? [...perCetakan.values()][0] : 0, tertaut: [] };

  const nyata = Math.max(...perCetakan.values());
  const tertaut = kelompok.filter((r) => r.id !== diri.id && idTertaut.has(r.id)).map((r) => r.id);
  return { berlaku: true, habis: tertaut.length >= nyata, nyata, tertaut };
}

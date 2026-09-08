// Mengubah tabel mentah rekening koran menjadi transaksi yang sudah tervalidasi.
//
// Murni: menerima larik baris, mengembalikan data. Tidak membaca berkas dan
// tidak menyentuh database, sehingga bisa diuji tanpa keduanya.

import { uraiTanggal, uraiNominal } from './nilai.js';
import { cariHeader } from './pemetaan.js';

export class GalatFormat extends Error {
  constructor(pesan) {
    super(pesan);
    this.name = 'GalatFormat';
  }
}

const PESAN_TIDAK_DIKENALI =
  'Format rekening koran belum dikenali. Periksa kolom Tanggal, Keterangan, ' +
  'Debit/Kredit, dan Saldo.';

/** Kunci duplikat: tanggal, keterangan, dan kedua nominal harus sama persis. */
function kunciDuplikat(t) {
  const keterangan = t.keterangan.toLowerCase().replace(/\s+/g, ' ').trim();
  return `${t.tanggal}|${keterangan}|${t.debit}|${t.kredit}`;
}

/** Baris kosong dan baris total di kaki tabel bukan transaksi. */
function barisKosong(baris) {
  return baris.every((sel) => sel === null || sel === undefined || String(sel).trim() === '');
}

/**
 * Membaca tabel mentah menjadi daftar transaksi.
 *
 * @param {Array<Array<*>>} baris  Isi sheet, satu larik per baris.
 * @param {object} opsi            { berkasSumber }
 * @throws {GalatFormat}           Bila baris header tidak ditemukan.
 */
export function uraiTabel(baris, { berkasSumber = '' } = {}) {
  const header = cariHeader(baris);
  if (!header) throw new GalatFormat(PESAN_TIDAK_DIKENALI);

  const { peta, indeks: barisHeader } = header;
  const ambil = (baris, bidang) => (peta[bidang] === undefined ? null : baris[peta[bidang]] ?? null);

  const transaksi = [];

  for (let i = barisHeader + 1; i < baris.length; i += 1) {
    const baris_ = baris[i] ?? [];
    if (barisKosong(baris_)) continue;

    const masalah = [];
    const hasilTanggal = uraiTanggal(ambil(baris_, 'tanggal'));
    if (!hasilTanggal.ok) masalah.push(hasilTanggal.alasan);

    // Keterangan disimpan apa adanya. Teks transaksi asli tidak boleh berubah,
    // karena itulah yang dicocokkan saat audit.
    const keterangan = String(ambil(baris_, 'keterangan') ?? '').trim();
    if (keterangan === '') masalah.push('Keterangan kosong.');

    let debit = 0;
    let kredit = 0;

    if (peta.debit !== undefined || peta.kredit !== undefined) {
      const d = uraiNominal(ambil(baris_, 'debit'));
      const k = uraiNominal(ambil(baris_, 'kredit'));
      if (!d.ok) masalah.push(d.alasan);
      if (!k.ok) masalah.push(k.alasan);
      debit = d.ok ? Math.abs(d.nilai) : 0;
      kredit = k.ok ? Math.abs(k.nilai) : 0;
    } else {
      // Sebagian bank memakai satu kolom nominal plus penanda arah (DB/CR).
      const mentah = ambil(baris_, 'mutasi');
      const m = uraiNominal(mentah);
      if (!m.ok) {
        masalah.push(m.alasan);
      } else {
        const penanda = String(ambil(baris_, 'arah') ?? mentah ?? '').toUpperCase();
        const keluar = /\b(DB|DR|D|DEBIT|DEBET)\b/.test(penanda) || m.nilai < 0;
        if (keluar) debit = Math.abs(m.nilai);
        else kredit = Math.abs(m.nilai);
      }
    }

    if (debit > 0 && kredit > 0) masalah.push('Debit dan kredit terisi bersamaan.');
    if (debit === 0 && kredit === 0) masalah.push('Tidak ada nominal debit maupun kredit.');

    const saldoMentah = ambil(baris_, 'saldo');
    const s = uraiNominal(saldoMentah);
    const saldo = saldoMentah === null || saldoMentah === '' || !s.ok ? null : s.nilai;

    transaksi.push({
      baris_sumber: i + 1,
      berkas_sumber: berkasSumber,
      tanggal: hasilTanggal.ok ? hasilTanggal.tanggal : null,
      tanggal_ambigu: Boolean(hasilTanggal.ambigu),
      keterangan,
      debit,
      kredit,
      saldo,
      referensi: String(ambil(baris_, 'referensi') ?? '').trim() || null,
      masalah,
      duplikat: false,
      status_data: masalah.length === 0 ? 'valid' : 'perlu_diperiksa',
    });
  }

  if (transaksi.length === 0) throw new GalatFormat(PESAN_TIDAK_DIKENALI);

  // Duplikat ditandai, bukan dibuang: dua transaksi identik pada hari yang sama
  // itu wajar, dan hanya orang yang tahu konteksnya bisa memutuskan.
  const terlihat = new Map();
  for (const t of transaksi) {
    if (!t.tanggal) continue;
    const kunci = kunciDuplikat(t);
    if (terlihat.has(kunci)) {
      t.duplikat = true;
      t.status_data = 'perlu_diperiksa';
      if (!t.masalah.includes('Duplikat.')) t.masalah.push('Duplikat.');
    } else {
      terlihat.set(kunci, t);
    }
  }

  return { transaksi, peta, barisHeader: barisHeader + 1 };
}

/** Ringkasan mutu data untuk ditampilkan setelah unggah. */
export function ringkasValidasi(transaksi) {
  return {
    total: transaksi.length,
    valid: transaksi.filter((t) => t.status_data === 'valid').length,
    perlu_diperiksa: transaksi.filter((t) => t.status_data === 'perlu_diperiksa').length,
    duplikat: transaksi.filter((t) => t.duplikat).length,
    tanggal_ambigu: transaksi.filter((t) => t.tanggal_ambigu).length,
  };
}

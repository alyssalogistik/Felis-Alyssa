// Membaca berkas rekening koran menjadi tabel mentah, lalu menyerahkannya ke parser.
//
// Hanya lapisan ini yang mengenal format berkas. Seluruh logika penguraian ada
// di parser.js dan tetap bisa diuji tanpa berkas sama sekali.

import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { GalatFormat, uraiTabel } from './parser.js';

/** Berkas rekening koran yang wajar jauh di bawah ini; batas ini menahan unggahan iseng. */
export const BATAS_UKURAN = 10 * 1024 * 1024;
const BATAS_BARIS = 50000;

/**
 * Kenali format dari isi berkas, bukan dari namanya, karena ekstensi bisa keliru.
 * xlsx adalah arsip ZIP; xls lama adalah wadah OLE2.
 */
function kenaliFormat(buffer, namaBerkas = '') {
  if (buffer.length >= 4) {
    if (buffer[0] === 0x50 && buffer[1] === 0x4b) return 'xlsx';
    if (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return 'xls';
  }
  return /\.csv$/i.test(namaBerkas) ? 'csv' : 'teks';
}

/** Ubah sheet exceljs menjadi larik baris biasa berindeks nol. */
export function barisDariSheet(sheet) {
  const baris = [];
  const batas = Math.min(sheet.rowCount, BATAS_BARIS);

  for (let i = 1; i <= batas; i += 1) {
    // values dari exceljs berindeks satu dan jarang; indeks 0 selalu kosong.
    const nilai = sheet.getRow(i).values ?? [];
    baris.push(
      Array.from({ length: Math.max(nilai.length - 1, 0) }, (_, k) => {
        const sel = nilai[k + 1];
        // Sel berformula dan rich text dibungkus objek; ambil hasil tampilannya.
        if (sel && typeof sel === 'object' && !(sel instanceof Date)) {
          if (sel.result !== undefined) return sel.result;
          if (sel.text !== undefined) return sel.text;
          if (Array.isArray(sel.richText)) return sel.richText.map((b) => b.text).join('');
          if (sel.hyperlink !== undefined) return sel.text ?? '';
          return '';
        }
        return sel ?? '';
      })
    );
  }
  return baris;
}

/**
 * Membaca berkas rekening koran.
 *
 * @param {Buffer} buffer
 * @param {string} namaBerkas
 * @returns {Promise<{transaksi: Array, peta: object, sheet: string, barisHeader: number}>}
 * @throws {GalatFormat} bila format tidak didukung atau tabelnya tidak dikenali.
 */
export async function bukaBerkas(buffer, namaBerkas = '') {
  if (!buffer || buffer.length === 0) throw new GalatFormat('Berkas kosong.');
  if (buffer.length > BATAS_UKURAN) {
    throw new GalatFormat(`Berkas melebihi ${BATAS_UKURAN / 1024 / 1024} MB.`);
  }

  const format = kenaliFormat(buffer, namaBerkas);
  if (format === 'xls') {
    throw new GalatFormat(
      'Berkas .xls format lama belum didukung. Buka di WPS atau Excel, ' +
      'pilih Save As / Simpan Sebagai .xlsx, lalu unggah ulang.'
    );
  }

  const buku = new ExcelJS.Workbook();
  try {
    if (format === 'xlsx') {
      await buku.xlsx.load(buffer);
    } else {
      await buku.csv.read(Readable.from(buffer.toString('utf8')));
    }
  } catch {
    // Pesan galat pustaka tidak membantu pengguna, dan bisa membocorkan isi berkas.
    throw new GalatFormat('Berkas tidak bisa dibaca. Pastikan formatnya .xlsx atau .csv dan tidak rusak.');
  }

  if (buku.worksheets.length === 0) throw new GalatFormat('Berkas tidak memuat sheet apa pun.');
  return buku.worksheets.map((sheet) => ({ nama: sheet.name, baris: barisDariSheet(sheet) }));
}

/**
 * Membaca berkas rekening koran.
 *
 * Sheet pertama yang tabelnya dikenali yang dipakai; rekening koran kerap
 * menyertakan sheet ringkasan atau catatan di depan.
 */
export async function bacaRekeningKoran(buffer, namaBerkas = '') {
  const sheets = await bukaBerkas(buffer, namaBerkas);

  const galat = [];
  for (const sheet of sheets) {
    try {
      const hasil = uraiTabel(sheet.baris, { berkasSumber: namaBerkas });
      return { ...hasil, sheet: sheet.nama };
    } catch (error) {
      if (!(error instanceof GalatFormat)) throw error;
      galat.push(error);
    }
  }

  throw galat[0] ?? new GalatFormat('Berkas tidak memuat tabel yang dikenali.');
}

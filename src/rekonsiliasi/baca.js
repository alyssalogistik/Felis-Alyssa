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
export function kenaliFormat(buffer, namaBerkas = '') {
  if (buffer.length >= 5) {
    if (buffer.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  }
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
 * Penanda transaksi yang belum dibukukan BCA.
 *
 * Cetakan Mutasi Rekening menuliskan "PEND" di kolom tanggal untuk transaksi
 * yang uangnya sudah keluar tetapi tanggal bukunya belum ditetapkan. Nominalnya
 * sudah ikut dihitung BCA pada total kaki halaman, jadi barisnya tetap
 * disimpan — dengan tanggal kosong, bukan tanggal karangan. Tanggal karangan
 * tidak menimbulkan galat apa pun dan baru ketahuan saat angka auditnya dipakai.
 *
 * Penandanya menumpang kolom `masalah` yang memang sudah ada dan memang sudah
 * ditampilkan, sehingga tidak menuntut migration untuk satu penanda.
 */
export const PENANDA_PENDING = 'Belum dibukukan BCA (PEND).';

function tandaiPending(transaksi) {
  for (const t of transaksi) {
    if (t.tanggal !== null) continue;
    // Pada tata letak ini tanggal hanya bisa kosong karena PEND: baris berangka
    // selalu memuat DD/MM/YYYY penuh atau kata PEND, tidak ada bentuk ketiga.
    if (!t.masalah.includes(PENANDA_PENDING)) t.masalah.push(PENANDA_PENDING);
    t.status_data = 'perlu_diperiksa';
  }
}

/**
 * Membaca berkas rekening koran.
 *
 * Sheet pertama yang tabelnya dikenali yang dipakai; rekening koran kerap
 * menyertakan sheet ringkasan atau catatan di depan.
 */
export async function bacaRekeningKoran(buffer, namaBerkas = '') {
  // PDF tidak punya sheet dan tabelnya harus disusun ulang dari koordinat teks,
  // jadi ditangani lebih dulu. Setelah menjadi tabel, jalurnya kembali menyatu:
  // uraiTabel() yang sama yang memvalidasi dan menandai duplikatnya.
  if (kenaliFormat(buffer, namaBerkas) === 'pdf') {
    if (!buffer || buffer.length === 0) throw new GalatFormat('Berkas kosong.');
    if (buffer.length > BATAS_UKURAN) {
      throw new GalatFormat(`Berkas melebihi ${BATAS_UKURAN / 1024 / 1024} MB.`);
    }

    const { bacaBarisPdf } = await import('./pdf.js');
    const { cariKolom, tabelDariBaris } = await import('./bca.js');
    const { formatMutasi, tabelDariMutasi } = await import('./bca-mutasi.js');

    const halaman = await bacaBarisPdf(buffer);

    // BCA mencetak dua tata letak yang sama sekali berbeda: e-statement bulanan
    // (TANGGAL / KETERANGAN / CBG / MUTASI / SALDO) dan Mutasi Rekening harian
    // dari KlikBCA (Tgl / Keterangan / Cabang / Jumlah / Saldo). Judul kolomnya
    // tidak beririsan sama sekali, jadi keduanya tidak bisa tertukar.
    //
    // E-statement diperiksa lebih dulu. Itu format yang sudah bertahun-tahun
    // masuk ke database ini; kalau suatu saat pengenalannya bertabrakan, yang
    // menang harus jalur yang lama.
    if (halaman.some((h) => cariKolom(h) !== null)) {
      const { tabel, periode, noRekening } = tabelDariBaris(halaman);
      const hasil = uraiTabel(tabel, { berkasSumber: namaBerkas });
      return {
        ...hasil,
        sheet: `BCA ${String(periode.bulan).padStart(2, '0')}/${periode.tahun}`,
        periode,
        noRekening,
      };
    }

    if (formatMutasi(halaman)) {
      const { tabel, rentang, noRekening, pending } = tabelDariMutasi(halaman);
      const hasil = uraiTabel(tabel, { berkasSumber: namaBerkas });
      tandaiPending(hasil.transaksi);

      // Kolom periode di riwayat unggahan menyimpan satu bulan, sedangkan
      // cetakan ini berupa rentang tanggal yang boleh melewati batas bulan.
      // Yang dicatat bulan awalnya, supaya pengurutan batch impor tetap
      // berjalan; rentang penuhnya ikut dikembalikan di samping.
      const periode = rentang
        ? { bulan: Number(rentang.mulai.slice(5, 7)), tahun: Number(rentang.mulai.slice(0, 4)) }
        : null;

      return {
        ...hasil,
        sheet: rentang ? `BCA Mutasi ${rentang.mulai} s/d ${rentang.selesai}` : 'BCA Mutasi',
        periode,
        rentang,
        noRekening,
        pending,
      };
    }

    // Tidak satu pun dikenali. Pesan galat jalur lama yang dipakai: itu yang
    // menyebut e-statement dan menjelaskan apa yang harus diunggah.
    tabelDariBaris(halaman);
    throw new GalatFormat('PDF ini tidak dikenali sebagai rekening koran BCA.');
  }

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

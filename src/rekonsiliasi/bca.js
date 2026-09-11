// Menafsirkan rekening koran BCA dalam bentuk PDF menjadi tabel biasa.
//
// Keluarannya sengaja berupa tabel bersama baris header, bukan transaksi jadi,
// supaya diteruskan ke uraiTabel() yang sama dengan jalur xlsx dan csv. Dengan
// begitu aturan validasi, penandaan duplikat, dan penanganan penanda DB/CR
// hanya ada satu tempat; PDF tidak boleh punya versi kebenarannya sendiri.

import { GalatFormat } from './parser.js';
import { teksBaris } from './pdf.js';

const BULAN_ID = [
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
];

/** Kolom rekening koran BCA, sesuai urutan cetaknya. */
const KOLOM = ['TANGGAL', 'KETERANGAN', 'CBG', 'MUTASI', 'SALDO'];

/**
 * Baris kaki yang bukan transaksi. Nilainya ikut tercetak di kolom saldo,
 * sehingga tanpa penyaringan ini saldo awal akan terbaca sebagai mutasi.
 */
const BARIS_KAKI = /^(saldo awal|saldo akhir|mutasi (debet|debit|kredit|cr|db)|bersambung|halaman)/i;

function normal(teks) {
  return String(teks ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Cari baris header tabel dan tetapkan tepi kiri setiap kolomnya.
 *
 * Yang dipakai tepi kiri header, bukan titik tengahnya. KETERANGAN adalah kolom
 * lebar berisi teks rata kiri yang kerap memanjang jauh melewati lebar judulnya
 * sendiri; diukur dari titik tengah, kata-kata terakhir nama supplier akan
 * dianggap lebih dekat ke kolom sebelahnya dan terpotong dari keterangan —
 * padahal justru nama itu yang menentukan hasil pencocokan.
 */
export function cariKolom(baris) {
  for (let i = 0; i < Math.min(baris.length, 60); i += 1) {
    const potong = baris[i];
    const teks = normal(teksBaris(potong));
    if (!teks.includes('tanggal') || !teks.includes('keterangan') || !teks.includes('mutasi')) {
      continue;
    }

    const pusat = {};
    for (const potongan of potong) {
      const nama = normal(potongan.teks);
      const cocok = KOLOM.find((k) => normal(k) === nama);
      if (cocok && pusat[cocok] === undefined) pusat[cocok] = potongan.x;
    }

    if (pusat.TANGGAL !== undefined && pusat.KETERANGAN !== undefined && pusat.MUTASI !== undefined) {
      return { indeks: i, tepi: pusat };
    }
  }
  return null;
}

/**
 * Nomor rekening dari kop halaman.
 *
 * Ikut menyusun sidik jari transaksi, sehingga dua rekening berbeda yang
 * kebetulan punya transaksi serupa tidak saling menganggap duplikat. Kalau
 * tidak ketemu, dikembalikan null dan sidik jarinya cukup dibentuk dari sisanya
 * — lebih baik daripada menolak berkasnya.
 */
export function cariNoRekening(halaman) {
  for (const potong of halaman.flat().slice(0, 60)) {
    const teks = teksBaris(potong);
    if (!/no\.?\s*rekening/i.test(teks)) continue;
    const cocok = teks.match(/no\.?\s*rekening\s*:?\s*([0-9][0-9\s-]{5,})/i);
    if (cocok) return cocok[1].replace(/[\s-]/g, '');
  }
  return null;
}

/** Periode menentukan tahun, yang tidak pernah dicetak di baris transaksi. */
export function cariPeriode(halaman) {
  const awal = halaman.flat().slice(0, 60);
  for (const potong of awal) {
    const teks = teksBaris(potong);
    if (!/periode/i.test(teks)) continue;

    const namaBulan = BULAN_ID.findIndex((b) => new RegExp(`\\b${b}\\b`, 'i').test(teks));
    const tahun = teks.match(/\b(20\d{2})\b/);
    if (namaBulan >= 0 && tahun) return { bulan: namaBulan + 1, tahun: Number(tahun[1]) };

    // Bentuk ringkas "PERIODE : 08/2026".
    const ringkas = teks.match(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(20\d{2})\b/);
    if (ringkas) return { bulan: Number(ringkas[1]), tahun: Number(ringkas[2]) };
  }
  return null;
}

/**
 * Satukan tanggal DD/MM dengan tahun periode.
 *
 * Rekening koran satu bulan bisa memuat transaksi bulan sebelumnya di awal
 * daftar. Ketika itu terjadi di pergantian tahun, memakai tahun periode
 * mentah-mentah akan melempar transaksi Desember ke tahun yang salah.
 */
export function tanggalPenuh(hari, bulan, periode) {
  let tahun = periode.tahun;
  const jarak = bulan - periode.bulan;
  if (jarak > 6) tahun -= 1;
  else if (jarak < -6) tahun += 1;

  const dd = String(hari).padStart(2, '0');
  const mm = String(bulan).padStart(2, '0');
  return `${tahun}-${mm}-${dd}`;
}

/** Nomor rujukan BCA menempel di keterangan; ditarik keluar agar bisa dicocokkan. */
export function referensiDari(keterangan) {
  const wsid = keterangan.match(/\bWSID[:\s]*([A-Z0-9]+)/i);
  if (wsid) return `WSID:${wsid[1]}`;
  const trx = keterangan.match(/\b(?:TRX|REF|NO)[:\s]*([A-Z0-9]{5,})/i);
  return trx ? trx[1] : null;
}


const ANGKA = /^[\d.,]+(\s*(db|cr|dr))?$/i;

/**
 * Bagi satu baris menjadi sel per kolom.
 *
 * Teks dinilai dari tepi kirinya karena kolom teks rata kiri. Angka dinilai
 * dari tepi kanannya: kolom MUTASI dan SALDO dicetak rata kanan, sehingga angka
 * panjang mulai jauh di kiri judul kolomnya dan akan terbaca sebagai milik
 * kolom sebelumnya bila diukur dari tepi kiri.
 */
function selDari(baris, urut, titik) {
  const sel = {};
  for (const potongan of baris) {
    const kanan = ANGKA.test(potongan.teks.trim());
    const acuan = kanan ? potongan.x + potongan.lebar : potongan.x;

    let pilih = 0;
    for (let i = 0; i < titik.length; i += 1) {
      if (acuan >= titik[i] + (kanan ? 1 : 0)) pilih = i;
    }
    const k = urut[pilih];
    sel[k] = sel[k] ? `${sel[k]} ${potongan.teks}` : potongan.teks;
  }
  return sel;
}

/** Apakah baris ini punya tanggal di kolom TANGGAL-nya. */
function bertanggal(baris, kolom) {
  const urut = KOLOM.filter((k) => kolom.tepi[k] !== undefined);
  const sel = selDari(baris, urut, urut.map((k) => kolom.tepi[k]));
  return /^\d{1,2}\s*\/\s*\d{1,2}/.test((sel.TANGGAL ?? '').trim());
}

/**
 * Ubah halaman berkoordinat menjadi tabel bersama header.
 *
 * @returns {{tabel: Array<Array<string>>, periode: {bulan: number, tahun: number}}}
 */
export function tabelDariBaris(halaman) {
  const kolomPertama = halaman.map(cariKolom).find(Boolean);
  if (!kolomPertama) {
    throw new GalatFormat(
      'PDF ini tidak dikenali sebagai rekening koran BCA \u2014 baris kolom ' +
      'TANGGAL / KETERANGAN / MUTASI tidak ditemukan. Pastikan yang diunggah ' +
      'e-statement dari myBCA atau KlikBCA, bukan bukti transfer satuan.'
    );
  }

  const periode = cariPeriode(halaman);
  if (!periode) {
    // Menebak tahun akan menghasilkan data audit yang salah tanpa gejala,
    // jadi lebih baik berhenti dan menyebut apa yang kurang.
    throw new GalatFormat(
      'Baris PERIODE tidak ditemukan, sehingga tahun transaksi tidak bisa ' +
      'dipastikan. Unggah e-statement BCA yang lengkap dengan kop halamannya.'
    );
  }

  const tabel = [[...KOLOM, 'REFERENSI']];
  let kolom = kolomPertama;

  for (const baris of halaman) {
    const header = cariKolom(baris);
    let mulai;

    if (header) {
      kolom = header;
      mulai = header.indeks + 1;
    } else {
      // Halaman lanjutan yang tidak mencetak ulang baris kolom: lewati kopnya
      // sampai baris pertama yang benar-benar bertanggal. Tanpa ini, "NO.
      // REKENING" dan "PERIODE" akan tergabung ke keterangan transaksi terakhir
      // halaman sebelumnya.
      mulai = baris.findIndex((b) => bertanggal(b, kolom));
      if (mulai < 0) continue;
    }

    const urut = KOLOM.filter((k) => kolom.tepi[k] !== undefined);
    const titik = urut.map((k) => kolom.tepi[k]);

    for (let i = mulai; i < baris.length; i += 1) {
      const sel = selDari(baris[i], urut, titik);

      const keterangan = (sel.KETERANGAN ?? '').trim();
      if (BARIS_KAKI.test(keterangan)) continue;

      const tanggal = (sel.TANGGAL ?? '').trim().match(/^(\d{1,2})\s*\/\s*(\d{1,2})/);

      if (!tanggal) {
        // Baris tanpa tanggal adalah sambungan keterangan transaksi sebelumnya.
        // Isinya sering memuat nama lawan transaksi \u2014 justru bagian yang
        // paling menentukan saat mencocokkan pembayaran supplier.
        const sebelumnya = tabel[tabel.length - 1];
        if (tabel.length > 1 && keterangan !== '') {
          sebelumnya[1] = `${sebelumnya[1]} ${keterangan}`.trim();
        }
        continue;
      }

      const iso = tanggalPenuh(Number(tanggal[1]), Number(tanggal[2]), periode);
      tabel.push([
        iso, keterangan, (sel.CBG ?? '').trim(),
        (sel.MUTASI ?? '').trim(), (sel.SALDO ?? '').trim(), '',
      ]);
    }
  }

  if (tabel.length === 1) {
    throw new GalatFormat('Tabel rekening koran ditemukan, tetapi tidak ada baris transaksi di dalamnya.');
  }

  // Rujukan diambil setelah sambungan keterangan tergabung: WSID BCA hampir
  // selalu berada di baris sambungan, bukan di baris berangka tanggal.
  for (let i = 1; i < tabel.length; i += 1) {
    tabel[i][5] = referensiDari(tabel[i][1]) ?? '';
  }

  return { tabel, periode, noRekening: cariNoRekening(halaman) };
}

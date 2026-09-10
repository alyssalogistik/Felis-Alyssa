// Menuliskan laporan mutasi ke PDF A4.
//
// Hanya berkas ini yang mengenal pdfkit. Aturan tata letaknya — lebar kolom,
// pembungkusan keterangan, pemenggalan halaman — ada di laporan.js dan diuji
// terpisah, sehingga yang tersisa di sini benar-benar hanya menggambar.
//
// Tampilannya sengaja meniru rekening koran bank: kertas putih, tulisan hitam,
// garis tipis, rapat. Tema gelap aplikasi tidak ikut tercetak.

import PDFDocument from 'pdfkit';
import { A4, MARGIN, KOLOM, rupiah, tanggalPendek, keteranganFilter, susunHalaman, totalkan } from './laporan.js';

const FONT = 'Helvetica';
const FONT_TEBAL = 'Helvetica-Bold';

const UKURAN_ISI = 8;
const UKURAN_HEADER = 8;
const TINGGI_BARIS = 9.5;
const JARAK_BARIS = 4.5;

const ABU = '#444444';
const GARIS = '#999999';
const GARIS_TIPIS = '#cccccc';

const LEBAR_ISI = A4.lebar - MARGIN * 2;

function kepalaDokumen(dok, kriteria, ringkasan, dicetakPada) {
  let y = MARGIN;

  dok.font(FONT_TEBAL).fontSize(12).fillColor('#000000')
    .text('PT ALYSSA AUTO LOGISTIK', MARGIN, y, { width: LEBAR_ISI, align: 'center' });
  y += 15;

  dok.font(FONT_TEBAL).fontSize(9)
    .text('AUDIT PEMBAYARAN SUPPLIER / MUTASI REKENING', MARGIN, y, { width: LEBAR_ISI, align: 'center' });
  y += 14;

  dok.moveTo(MARGIN, y).lineTo(MARGIN + LEBAR_ISI, y).lineWidth(1).strokeColor(GARIS).stroke();
  y += 8;

  // Filter di kiri, hasilnya di kanan: pembaca laporan perlu tahu keduanya
  // sekaligus — atas dasar apa disaring, dan berapa yang ketemu.
  const kolomKanan = MARGIN + LEBAR_ISI / 2 + 10;
  const kiri = keteranganFilter(kriteria);
  const kanan = [
    ['Tanggal Cetak', dicetakPada],
    ['Jumlah Transaksi', `${ringkasan.jumlah} transaksi`],
    ['Total Uang Keluar', rupiah(ringkasan.debit)],
    ['Total Uang Masuk', rupiah(ringkasan.kredit)],
  ];

  const gambarPasangan = (daftar, x, lebarLabel) => {
    let baris = y;
    for (const [label, nilai] of daftar) {
      dok.font(FONT).fontSize(7.5).fillColor(ABU).text(`${label}`, x, baris, { width: lebarLabel });
      dok.font(FONT_TEBAL).fontSize(7.5).fillColor('#000000')
        .text(String(nilai), x + lebarLabel, baris, { width: LEBAR_ISI / 2 - lebarLabel - 10 });
      baris += 11;
    }
    return baris;
  };

  const akhirKiri = gambarPasangan(kiri, MARGIN, 74);
  const akhirKanan = gambarPasangan(kanan, kolomKanan, 82);

  return Math.max(akhirKiri, akhirKanan) + 6;
}

function kepalaTabel(dok, y) {
  dok.rect(MARGIN, y, LEBAR_ISI, 14).fillColor('#eeeeee').fill();

  let x = MARGIN;
  dok.font(FONT_TEBAL).fontSize(UKURAN_HEADER).fillColor('#000000');
  for (const kolom of KOLOM) {
    dok.text(kolom.judul, x + 3, y + 4, {
      width: kolom.lebar - 6,
      align: kolom.kanan ? 'right' : 'left',
      lineBreak: false,
    });
    x += kolom.lebar;
  }

  const bawah = y + 14;
  dok.moveTo(MARGIN, bawah).lineTo(MARGIN + LEBAR_ISI, bawah).lineWidth(0.8).strokeColor(GARIS).stroke();
  return bawah + 3;
}

function kakiHalaman(dok, nomor, dari) {
  const y = A4.tinggi - MARGIN - 12;
  dok.moveTo(MARGIN, y - 4).lineTo(MARGIN + LEBAR_ISI, y - 4).lineWidth(0.5).strokeColor(GARIS_TIPIS).stroke();

  dok.font(FONT).fontSize(7).fillColor(ABU);
  dok.text('PT Alyssa Auto Logistik - Audit Pembayaran Supplier', MARGIN, y, {
    width: LEBAR_ISI / 2, lineBreak: false,
  });
  dok.text(`Halaman ${nomor} / ${dari}`, MARGIN + LEBAR_ISI / 2, y, {
    width: LEBAR_ISI / 2, align: 'right', lineBreak: false,
  });
}

function gambarBaris(dok, isi, y) {
  const { transaksi: t, barisKeterangan } = isi;
  const nominal = Number(t.debit ?? 0) + Number(t.kredit ?? 0);

  const nilai = {
    tanggal: tanggalPendek(t.tanggal),
    keterangan: null, // digambar sendiri karena bisa lebih dari satu baris
    debit: Number(t.debit ?? 0) > 0 ? rupiah(t.debit) : '-',
    kredit: Number(t.kredit ?? 0) > 0 ? rupiah(t.kredit) : '-',
    nominal: rupiah(nominal),
    referensi: t.referensi ?? '-',
  };

  let x = MARGIN;
  dok.font(FONT).fontSize(UKURAN_ISI).fillColor('#000000');

  for (const kolom of KOLOM) {
    if (kolom.kunci === 'keterangan') {
      barisKeterangan.forEach((baris, i) => {
        dok.text(baris, x + 3, y + i * TINGGI_BARIS, { width: kolom.lebar - 6, lineBreak: false });
      });
    } else {
      dok.text(nilai[kolom.kunci], x + 3, y, {
        width: kolom.lebar - 6,
        align: kolom.kanan ? 'right' : 'left',
        lineBreak: false,
      });
    }
    x += kolom.lebar;
  }

  const bawah = y + barisKeterangan.length * TINGGI_BARIS + JARAK_BARIS - 2;
  dok.moveTo(MARGIN, bawah).lineTo(MARGIN + LEBAR_ISI, bawah).lineWidth(0.4).strokeColor(GARIS_TIPIS).stroke();
}

/**
 * Menghasilkan PDF laporan mutasi.
 *
 * @param {Array<object>} transaksi  Seluruh hasil filter, bukan satu halaman layar.
 * @param {object} kriteria          Filter yang sedang aktif, untuk dicetak di kop.
 * @returns {Promise<Buffer>}
 */
export function buatPdfLaporan(transaksi, kriteria = {}, sekarang = new Date()) {
  const dok = new PDFDocument({ size: 'A4', layout: 'portrait', margin: MARGIN, autoFirstPage: false });

  // pdfkit mengukur teks memakai metrik font yang sedang dipasang, jadi ukuran
  // yang dipakai untuk membungkus harus sama persis dengan yang menggambar.
  dok.addPage();
  dok.font(FONT).fontSize(UKURAN_ISI);
  const ukur = (teks) => dok.widthOfString(teks);

  const ringkasan = totalkan(transaksi);
  const dicetakPada = new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Jakarta',
  }).format(sekarang);

  // Ruang yang tersisa untuk baris berbeda antara halaman pertama, yang memuat
  // kop lengkap, dan halaman berikutnya yang hanya memuat kepala tabel.
  const batasBawah = A4.tinggi - MARGIN - 22;
  const tinggiKop = 132;
  const tinggiKepalaTabel = 17;

  const halaman = susunHalaman(transaksi, {
    ukur,
    tinggiBaris: TINGGI_BARIS,
    jarakBaris: JARAK_BARIS,
    ruangHalamanPertama: batasBawah - (MARGIN + tinggiKop + tinggiKepalaTabel),
    ruangHalamanBerikutnya: batasBawah - (MARGIN + tinggiKepalaTabel),
  });

  const potongan = [];
  dok.on('data', (bagian) => potongan.push(bagian));
  const selesai = new Promise((tuntas) => dok.on('end', () => tuntas(Buffer.concat(potongan))));

  halaman.forEach((isiHalaman, indeks) => {
    if (indeks > 0) dok.addPage();

    let y = indeks === 0
      ? kepalaDokumen(dok, kriteria, ringkasan, dicetakPada)
      : MARGIN;

    y = kepalaTabel(dok, y);

    if (isiHalaman.length === 0) {
      dok.font(FONT).fontSize(UKURAN_ISI).fillColor(ABU)
        .text('Tidak ditemukan transaksi pembayaran untuk kata kunci ini pada periode yang dipilih.',
          MARGIN + 3, y + 6, { width: LEBAR_ISI - 6 });
    }

    for (const isi of isiHalaman) {
      gambarBaris(dok, isi, y);
      y += isi.tinggi;
    }

    kakiHalaman(dok, indeks + 1, halaman.length);
  });

  dok.end();
  return selesai;
}

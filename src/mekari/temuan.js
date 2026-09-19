// Mesin temuan audit pembelian.
//
// Murni: menerima baris, mengembalikan temuan. Tanpa I/O dan tidak ditulis
// ulang dalam SQL — kalau logikanya disalin ke database, dua tempat bisa
// menyimpang dalam memutuskan apa itu potensi duplikasi.
//
// Mesin ini TIDAK PERNAH menyatakan dobel bayar. Yang dihasilkannya adalah
// pasangan baris beserta alasan kenapa ditandai; keputusannya milik auditor.
//
// ## Kenapa angka tidak boleh membuka gerbang
//
// Godaan pertama adalah mengelompokkan baris yang "supplier sama + produk sama
// + nominal sama + tanggal sama". Itu diukur terhadap data sungguhan dan
// hasilnya tidak bisa dipakai: dari 116 baris, 775 pasangan tertandai dan 110
// baris (95%) terlibat.
//
// Sebabnya harga adalah DAFTAR TARIF, bukan sidik jari. Di berkas yang sama
// hanya ada 18 nilai nominal berbeda untuk 116 baris — Rp 6.500.000 muncul 44
// kali karena itu tarif satu rute, bukan karena dibayar 44 kali. Kuantitas
// bernilai 1 pada 91% baris, dan hanya ada 13 tanggal berbeda.
//
// Jadi yang boleh membuka gerbang hanya IDENTITAS: deskripsi yang sama persis,
// atau tanda pengenal yang sama (lihat pengenal.js). Supplier, produk, nominal,
// harga, kuantitas, dan tanggal tidak pernah membuat sepasang baris
// dibandingkan — mereka hanya menambah skor setelah gerbangnya terbuka.
//
// Dengan gerbang itu, berkas yang sama menghasilkan 13 temuan atas 26 baris.

import { bubuhiPengenal, ambangJarang } from './pengenal.js';

/** Skor minimal supaya sepasang baris dilaporkan. Bisa digeser dari layar. */
export const AMBANG_BAWAAN = 6;

/** Selisih hari yang masih dihitung "berdekatan". */
export const HARI_DEKAT = 7;

/**
 * Batas besar sebuah kelompok sebelum berhenti dijabarkan jadi pasangan.
 *
 * Deskripsi yang berulang ratusan kali adalah baris template ("Biaya admin"),
 * bukan seratus tagihan ganda. Menjabarkannya menghasilkan puluhan ribu
 * pasangan yang tidak akan dibaca siapa pun dan mengubur temuan sungguhan.
 * Kelompok sebesar itu dilaporkan utuh sebagai satu temuan kelompok.
 */
export const BATAS_KELOMPOK = 60;

/** Bobot tiap sinyal. Skor sebuah pasangan adalah jumlah bobot yang menyala. */
export const BOBOT = {
  pengenal_sama: 3,
  pengenal_mirip: 1,
  deskripsi_sama: 3,
  invoice_berbeda: 2,
  supplier_sama: 1,
  produk_sama: 1,
  nominal_sama: 1,
  harga_sama: 1,
  kuantitas_sama: 1,
  tanggal_sama: 1,
  tanggal_dekat: 1,
};

function selisihHari(a, b) {
  if (!a || !b) return null;
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return Math.round(Math.abs(x - y) / 86400000);
}

function sama(a, b) {
  return a !== null && a !== undefined && a !== '' && a === b;
}

/**
 * Kunci yang menghubungkan sebuah pasangan dengan keputusan manusia atasnya.
 *
 * Diturunkan dari sidik kedua barisnya dan diurutkan, sehingga tidak berubah
 * ketika mesin dijalankan ulang dengan ambang berbeda, ketika urutan barisnya
 * bertukar, atau ketika aturan skornya diperbaiki. Tanpa kunci yang stabil,
 * menjalankan ulang audit akan menghapus seluruh hasil pemeriksaan manusia —
 * dan itu kesalahan yang paling mahal di modul ini, karena yang hilang adalah
 * pekerjaan orang, bukan data yang bisa diurai ulang.
 */
export function kunciStabil(a, b) {
  const x = String(a?.sidik ?? a?.baris_sumber ?? '');
  const y = String(b?.sidik ?? b?.baris_sumber ?? '');
  return x <= y ? `${x}|${y}` : `${y}|${x}`;
}

/** Menilai sepasang baris: skor beserta alasan yang bisa dibaca orang. */
export function nilaiPasangan(a, b, { hariDekat = HARI_DEKAT } = {}) {
  const alasan = [];
  let skor = 0;

  const catat = (label, status, poin) => {
    skor += poin;
    alasan.push({ label, status, poin });
  };

  // --- Identitas -----------------------------------------------------------
  const bersama = (a.pengenal ?? []).filter((p) => (b.pengenal ?? []).includes(p));
  for (const p of bersama) {
    const ka = a.konteks?.get(p) ?? p;
    const kb = b.konteks?.get(p) ?? p;
    if (ka === kb) catat(`Pengenal sama (${ka})`, 'sama', BOBOT.pengenal_sama);
    else catat(`Pengenal mirip, konteks beda (${ka} vs ${kb})`, 'mirip', BOBOT.pengenal_mirip);
  }

  if (sama(a.deskripsi_normal, b.deskripsi_normal)) {
    catat('Deskripsi sama', 'sama', BOBOT.deskripsi_sama);
  }

  // --- Field transaksi -----------------------------------------------------
  if (sama(a.supplier, b.supplier)) catat('Supplier sama', 'sama', BOBOT.supplier_sama);
  if (sama(a.produk, b.produk)) catat('Produk sama', 'sama', BOBOT.produk_sama);
  if (a.jumlah > 0 && a.jumlah === b.jumlah) catat('Nominal sama', 'sama', BOBOT.nominal_sama);
  if (a.harga > 0 && a.harga === b.harga) catat('Harga satuan sama', 'sama', BOBOT.harga_sama);
  if (a.kuantitas > 0 && a.kuantitas === b.kuantitas) {
    catat('Kuantitas sama', 'sama', BOBOT.kuantitas_sama);
  }

  const jarak = selisihHari(a.tanggal, b.tanggal);
  if (jarak === 0) catat('Tanggal sama', 'sama', BOBOT.tanggal_sama);
  else if (jarak !== null && jarak <= hariDekat) {
    catat(`Tanggal berdekatan (${jarak} hari)`, 'sama', BOBOT.tanggal_dekat);
  }

  // Invoice berbeda menaikkan skor: satu barang yang sama ditagihkan lewat dua
  // invoice adalah bentuk duplikasi yang paling mahal. Invoice yang sama tetap
  // dilaporkan sebagai konteks, tanpa menambah skor.
  if (sama(a.no_invoice, b.no_invoice)) alasan.push({ label: 'Invoice sama', status: 'netral', poin: 0 });
  else catat('Invoice berbeda', 'beda', BOBOT.invoice_berbeda);

  return { skor, alasan };
}

/** Baris alasan seperti yang dibaca auditor di layar. */
export function ringkasAlasan(alasan) {
  const tanda = { sama: '✓', beda: '⚠', mirip: '⚠', netral: '=' };
  return alasan.map((a) => `${a.label} ${tanda[a.status] ?? ''}`.trim()).join(' | ');
}

/**
 * Menjalankan mesin atas sekumpulan baris.
 *
 * Mengembalikan pasangan (`temuan`) dan kelompok besar (`kelompok`), beserta
 * berapa pasangan yang benar-benar diperiksa — angka itu yang membuktikan
 * gerbangnya bekerja dan bukan sekadar n².
 */
export function hitungTemuan(barisMentah, opsi = {}) {
  const { ambang = AMBANG_BAWAAN, hariDekat = HARI_DEKAT, batasKelompok = BATAS_KELOMPOK } = opsi;

  const baris = bubuhiPengenal(barisMentah, (b) => b.keterangan);

  // Gerbang: hanya identitas yang mengelompokkan.
  const blok = new Map();
  const daftarkan = (kunci, i) => {
    if (!blok.has(kunci)) blok.set(kunci, []);
    blok.get(kunci).push(i);
  };
  baris.forEach((b, i) => {
    if (b.deskripsi_normal) daftarkan(`D|${b.deskripsi_normal}`, i);
    for (const p of b.pengenal) daftarkan(`P|${p}`, i);
  });

  const temuan = [];
  const kelompok = [];
  const sudah = new Set();

  for (const [kunci, anggota] of blok) {
    if (anggota.length < 2) continue;

    if (anggota.length > batasKelompok) {
      kelompok.push({
        kunci,
        jenis: kunci.startsWith('D|') ? 'deskripsi' : 'pengenal',
        nilai: kunci.slice(2),
        jumlah: anggota.length,
        nilai_rupiah: anggota.reduce((a, i) => a + (baris[i].jumlah ?? 0), 0),
        baris: anggota.map((i) => baris[i].baris_sumber ?? i),
      });
      continue;
    }

    for (let i = 0; i < anggota.length; i += 1) {
      for (let j = i + 1; j < anggota.length; j += 1) {
        const x = Math.min(anggota[i], anggota[j]);
        const y = Math.max(anggota[i], anggota[j]);
        const tanda = `${x}-${y}`;
        if (sudah.has(tanda)) continue;
        sudah.add(tanda);

        const hasil = nilaiPasangan(baris[x], baris[y], { hariDekat });
        if (hasil.skor < ambang) continue;

        temuan.push({
          kunci_stabil: kunciStabil(baris[x], baris[y]),
          a: baris[x],
          b: baris[y],
          skor: hasil.skor,
          alasan: hasil.alasan,
          ringkasan_alasan: ringkasAlasan(hasil.alasan),
          // Yang berisiko adalah nilai yang mungkin terbayar dua kali, yaitu
          // yang lebih kecil dari keduanya. Memakai yang lebih besar akan
          // melebih-lebihkan paparannya.
          nilai_berisiko: Math.min(baris[x].jumlah ?? 0, baris[y].jumlah ?? 0),
        });
      }
    }
  }

  temuan.sort((p, q) => q.skor - p.skor || q.nilai_berisiko - p.nilai_berisiko);

  return {
    temuan,
    kelompok,
    // Seluruh baris beserta pengenalnya, termasuk yang tidak masuk temuan mana
    // pun. Kejarangan hanya bisa dinilai atas seluruh batch, jadi di sinilah
    // satu-satunya tempat hasilnya lengkap — pemanggil yang menghitung ulang
    // sendiri akan memakai ambang kejarangan yang berbeda.
    baris,
    diperiksa: sudah.size,
    pasangan_mungkin: (baris.length * (baris.length - 1)) / 2,
    ambang,
    ambang_jarang: ambangJarang(baris.length),
  };
}

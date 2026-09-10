// Tata letak laporan mutasi untuk kertas A4.
//
// Murni: menerima transaksi dan lebar kolom, mengembalikan halaman siap cetak.
// Tidak menyentuh pdfkit maupun berkas, sehingga aturan yang paling mudah
// salah — pembungkusan keterangan dan pemenggalan halaman — bisa diuji tanpa
// membuat satu PDF pun.

/** Titik (pt) A4 potret. 1 pt = 1/72 inci. */
export const A4 = { lebar: 595.28, tinggi: 841.89 };
export const MARGIN = 34;

/**
 * Lebar kolom dalam pt; totalnya 527 pt, pas di dalam margin kiri-kanan A4.
 *
 * Angkanya diukur dari font yang benar-benar dipakai (Helvetica 8 pt), bukan
 * dikira-kira: setiap kolom harus memuat judulnya sendiri maupun isi terlebar
 * yang mungkin muncul, ditambah 6 pt jarak tepi. Kolom yang terlalu sempit
 * tidak membungkus melainkan terpotong diam-diam — REFERENSI pernah hilang
 * seluruhnya karena judulnya saja sudah lebih lebar dari kolomnya.
 *
 * Sisanya diberikan kepada KETERANGAN, satu-satunya kolom yang boleh membungkus.
 */
export const KOLOM = [
  { kunci: 'tanggal', judul: 'TANGGAL', lebar: 54 },
  { kunci: 'keterangan', judul: 'KETERANGAN TRANSAKSI', lebar: 207 },
  { kunci: 'debit', judul: 'DEBIT / KELUAR', lebar: 72, kanan: true },
  { kunci: 'kredit', judul: 'KREDIT / MASUK', lebar: 72, kanan: true },
  { kunci: 'nominal', judul: 'NOMINAL', lebar: 66, kanan: true },
  { kunci: 'referensi', judul: 'REFERENSI', lebar: 56 },
];

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/**
 * Rupiah tanpa bergantung pada locale mesin yang menjalankan.
 *
 * Intl di server bisa saja tidak memuat data locale id-ID, dan diam-diam
 * jatuh ke format Inggris — laporan lalu mencetak "Rp 2,500,000" yang salah
 * baca di Indonesia. Pemisah ribuan dipasang sendiri agar tidak bergantung.
 */
export function rupiah(nilai) {
  const angka = Math.round(Number(nilai ?? 0));
  const utuh = Math.abs(angka).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${angka < 0 ? '-' : ''}Rp ${utuh}`;
}

/** Tanggal ISO menjadi bentuk pendek Indonesia, tanpa objek Date. */
export function tanggalPendek(iso) {
  if (!iso) return '-';
  const [tahun, bulan, hari] = String(iso).split('-');
  const nama = NAMA_BULAN[Number(bulan) - 1];
  return nama ? `${hari} ${nama.slice(0, 3)} ${tahun}` : String(iso);
}

/**
 * Judul filter yang sedang berlaku, untuk dicetak di kepala laporan.
 * Nilai yang tidak diisi ditulis "Semua" alih-alih dikosongkan, supaya pembaca
 * laporan tahu bahwa filternya memang tidak dipasang.
 */
export function keteranganFilter(kriteria = {}) {
  return [
    ['Kata Kunci', kriteria.cari ? kriteria.cari : 'Semua transaksi'],
    ['Bulan', kriteria.bulan ? NAMA_BULAN[Number(kriteria.bulan) - 1] ?? String(kriteria.bulan) : 'Semua'],
    ['Tahun', kriteria.tahun ? String(kriteria.tahun) : 'Semua'],
    ['Dari Tanggal', kriteria.dari ? tanggalPendek(kriteria.dari) : '-'],
    ['Sampai Tanggal', kriteria.sampai ? tanggalPendek(kriteria.sampai) : '-'],
  ];
}

/**
 * Nama berkas unduhan.
 *
 * Karakter yang tidak aman bagi nama berkas dibuang, bukan diganti sandi
 * persen: nama yang muncul di folder unduhan harus tetap terbaca manusia.
 */
export function namaBerkas(kriteria = {}, sekarang = new Date()) {
  const bersih = (teks) => String(teks).trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-');

  const supplier = kriteria.cari ? bersih(kriteria.cari) : 'Semua-Transaksi';
  const bulan = kriteria.bulan ? NAMA_BULAN[Number(kriteria.bulan) - 1] ?? kriteria.bulan : 'Semua-Bulan';
  const tahun = kriteria.tahun ? String(kriteria.tahun) : String(sekarang.getFullYear());

  return `Audit-Pembayaran-${supplier}-${bulan}-${tahun}.pdf`;
}

/**
 * Membungkus teks menjadi beberapa baris yang muat dalam lebar tertentu.
 *
 * @param {string} teks
 * @param {number} lebar        Lebar kolom dalam pt.
 * @param {(t: string) => number} ukur  Lebar teks dalam pt menurut font yang dipakai.
 */
export function bungkus(teks, lebar, ukur) {
  const kata = String(teks ?? '').trim().split(/\s+/).filter(Boolean);
  if (kata.length === 0) return [''];

  const baris = [];
  let sekarang = '';

  for (const k of kata) {
    const gabung = sekarang === '' ? k : `${sekarang} ${k}`;
    if (ukur(gabung) <= lebar) {
      sekarang = gabung;
      continue;
    }

    if (sekarang !== '') baris.push(sekarang);

    // Satu kata yang lebih panjang dari kolomnya sendiri dipenggal per huruf,
    // karena kalau dibiarkan ia akan meluber menimpa kolom sebelahnya.
    if (ukur(k) > lebar) {
      let potong = '';
      for (const huruf of k) {
        if (ukur(potong + huruf) > lebar && potong !== '') {
          baris.push(potong);
          potong = huruf;
        } else {
          potong += huruf;
        }
      }
      sekarang = potong;
    } else {
      sekarang = k;
    }
  }

  if (sekarang !== '') baris.push(sekarang);
  return baris;
}

/**
 * Menyusun transaksi menjadi halaman-halaman A4.
 *
 * Satu baris tidak pernah dipenggal di antara dua halaman: bila sisa ruang
 * tidak cukup untuk seluruh tingginya, baris itu utuh pindah ke halaman
 * berikutnya. Laporan mutasi yang barisnya terbelah membuat nominal terbaca
 * milik tanggal yang salah.
 *
 * @returns {Array<Array<{transaksi: object, barisKeterangan: string[], tinggi: number}>>}
 */
export function susunHalaman(transaksi, opsi) {
  const {
    ukur,
    tinggiBaris = 11,
    jarakBaris = 4,
    ruangHalamanPertama,
    ruangHalamanBerikutnya,
  } = opsi;

  const lebarKeterangan = KOLOM.find((k) => k.kunci === 'keterangan').lebar - 6;

  const halaman = [];
  let sekarang = [];
  let terpakai = 0;
  let tersedia = ruangHalamanPertama;

  for (const t of transaksi) {
    const barisKeterangan = bungkus(t.keterangan, lebarKeterangan, ukur);
    const tinggi = barisKeterangan.length * tinggiBaris + jarakBaris;

    if (terpakai + tinggi > tersedia && sekarang.length > 0) {
      halaman.push(sekarang);
      sekarang = [];
      terpakai = 0;
      tersedia = ruangHalamanBerikutnya;
    }

    sekarang.push({ transaksi: t, barisKeterangan, tinggi });
    terpakai += tinggi;
  }

  // Halaman terakhir tetap dikeluarkan walau kosong, supaya laporan tanpa
  // hasil pun tetap punya satu halaman berkop dan berfooter.
  halaman.push(sekarang);
  return halaman;
}

/** Total yang dicetak di kepala laporan, dihitung dalam sen agar tidak melenceng. */
export function totalkan(transaksi) {
  let debitSen = 0;
  let kreditSen = 0;
  for (const t of transaksi) {
    debitSen += Math.round(Number(t.debit ?? 0) * 100);
    kreditSen += Math.round(Number(t.kredit ?? 0) * 100);
  }
  return { jumlah: transaksi.length, debit: debitSen / 100, kredit: kreditSen / 100 };
}

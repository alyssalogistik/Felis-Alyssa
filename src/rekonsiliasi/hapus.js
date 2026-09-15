// Aturan menghapus satu unggahan rekening koran.
//
// Murni: menerima hitungan dampak, mengembalikan keputusan dan rinciannya.
// Tanpa I/O, sehingga aturan "apa yang boleh dihapus" bisa diuji tanpa
// database — dan hanya ada satu tempat yang memutuskannya.
//
// Penghapusan di sini sengaja tidak menyentuh SQL sama sekali: rantai
// ON DELETE CASCADE yang sudah terpasang di skema (transaksi_bank.unggahan_id
// dan kecocokan.transaksi_id) yang mengerjakan penghapusan turunannya dalam
// satu perintah. Menirunya di aplikasi akan membuat keadaan setengah terhapus
// bila salah satu langkah gagal.

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Alasan penolakan yang bisa diperiksa mesin, bukan dicocokkan dari teksnya. */
export const PERLU_KONFIRMASI_KECOCOKAN = 'perlu_konfirmasi_kecocokan';

const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Apakah teks ini berbentuk id unggahan.
 *
 * Diperiksa sebelum menyentuh database, bukan sesudahnya. Tanpa ini, id cacat
 * diteruskan apa adanya lalu gagal di Postgres saat cast ke uuid — dan yang
 * sampai ke pemakainya adalah galat mentah "invalid input syntax for type
 * uuid" dengan status 500, seolah aplikasinya rusak.
 *
 * Ini bukan penjaga terhadap suntikan: nilai dikirim sebagai parameter
 * terpisah, sehingga teks seperti `.or(id.neq.null)` ikut dibandingkan sebagai
 * nilai dan tidak pernah melebarkan penyaringnya. Yang dijaga di sini adalah
 * kejelasan jawabannya.
 */
export function idUnggahanValid(id) {
  return typeof id === 'string' && POLA_UUID.test(id);
}

/**
 * "Februari 2026", atau "-" bila unggahannya dari sebelum kolom periode ada.
 *
 * Unggahan lama tidak menyimpan periode sama sekali. Menebaknya dari nama
 * berkas akan menampilkan bulan yang salah di kotak konfirmasi — dan kotak itu
 * dipakai memutuskan penghapusan, jadi lebih baik mengaku tidak tahu.
 */
export function labelPeriode(unggahan) {
  const bulan = Number(unggahan?.periode_bulan);
  const tahun = Number(unggahan?.periode_tahun);
  if (!Number.isInteger(bulan) || bulan < 1 || bulan > 12) return '-';
  if (!Number.isInteger(tahun)) return '-';
  return `${NAMA_BULAN[bulan - 1]} ${tahun}`;
}

/**
 * Baris-baris yang dibacakan di kotak konfirmasi.
 *
 * Disusun di sini, bukan di peramban, supaya angka yang dilihat pemakainya
 * sebelum menekan "Hapus" berasal dari sumber yang sama dengan yang menjadi
 * dasar keputusan server.
 *
 * @param {{unggahan: object, transaksi: number, sudah_direkon: number,
 *          kecocokan: number, kecocokan_dikonfirmasi: number}} dampak
 */
export function rincianHapus(dampak) {
  const u = dampak.unggahan ?? {};
  const rincian = [
    { label: 'Nama berkas', nilai: u.nama_berkas ?? '-' },
    { label: 'Periode', nilai: labelPeriode(u) },
    { label: 'Transaksi yang ikut terhapus', nilai: `${dampak.transaksi} baris`, berat: dampak.transaksi > 0 },
  ];

  // Yang dibaca dari berkas belum tentu yang tersimpan: penyisipan memakai
  // ON CONFLICT DO NOTHING, jadi transaksi yang sudah ada lebih dulu tetap
  // menjadi milik unggahan pertama. Selisihnya disebutkan supaya angka nol
  // pada unggahan ulang tidak terbaca sebagai kekeliruan.
  const dibaca = Number(u.jumlah_transaksi ?? 0);
  if (dibaca !== dampak.transaksi) {
    rincian.push({
      label: 'Dibaca dari berkas',
      nilai: `${dibaca} baris — sisanya sudah tersimpan dari unggahan lain dan tidak ikut terhapus`,
    });
  }

  if (dampak.sudah_direkon > 0) {
    rincian.push({
      label: 'Sudah direkonsiliasi',
      nilai: `${dampak.sudah_direkon} baris`,
      berat: true,
    });
  }

  if (dampak.kecocokan > 0) {
    rincian.push({
      label: 'Hasil audit yang ikut terhapus',
      nilai: dampak.kecocokan_dikonfirmasi > 0
        ? `${dampak.kecocokan} kecocokan, ${dampak.kecocokan_dikonfirmasi} di antaranya sudah dikonfirmasi manusia`
        : `${dampak.kecocokan} kecocokan otomatis`,
      berat: dampak.kecocokan_dikonfirmasi > 0,
    });
  }

  return rincian;
}

/**
 * Boleh dihapus atau tidak.
 *
 * Satu-satunya hal yang ditahan adalah kecocokan yang sudah dikonfirmasi
 * manusia. Kecocokan otomatis bisa dibuat ulang dengan menjalankan audit lagi;
 * keputusan manusia tidak — dan ia hilang tanpa bunyi lewat cascade. Karena
 * itu penolakannya ada di server, bukan hanya di kotak konfirmasi: kotak bisa
 * dilewati, endpoint tidak.
 *
 * @param {object} dampak Hasil hitungan dampak.
 * @param {{konfirmasiKecocokan?: boolean}} opsi
 * @returns {{boleh: boolean, kode?: string, pesan?: string}}
 */
export function periksaHapus(dampak, { konfirmasiKecocokan = false } = {}) {
  const dikonfirmasi = Number(dampak?.kecocokan_dikonfirmasi ?? 0);

  if (dikonfirmasi > 0 && !konfirmasiKecocokan) {
    return {
      boleh: false,
      kode: PERLU_KONFIRMASI_KECOCOKAN,
      pesan:
        `Unggahan ini memuat ${dikonfirmasi} kecocokan audit yang sudah dikonfirmasi manusia. ` +
        'Kecocokan itu akan ikut terhapus dan tidak bisa dibuat ulang oleh audit otomatis. ' +
        'Centang persetujuan lebih dulu bila memang ingin dilanjutkan.',
    };
  }

  return { boleh: true };
}

// Pembatasan percobaan masuk.
//
// Murni: menerima keadaan hitungan dan waktu, mengembalikan keputusan dan
// keadaan berikutnya. Tanpa I/O, sehingga seluruh aturannya — termasuk berapa
// lama seseorang terkunci — bisa diuji tanpa database dan tanpa menunggu waktu
// sungguhan berlalu.
//
// ## Dua ember, dan keduanya perlu
//
// **Per akun** menahan penebak yang membidik satu alamat email dari banyak
// tempat. **Per alamat IP** menahan penebak yang dari satu tempat mencoba
// banyak email. Yang satu saja selalu meninggalkan jalan bagi yang lain.
//
// Embernya dihitung terpisah dan cukup salah satu penuh untuk menolak.
//
// ## Kenapa embernya tidak boleh mengunci selamanya
//
// Pemilik project ini satu orang. Kalau akunnya bisa terkunci permanen karena
// salah ketik beberapa kali, satu-satunya jalan pulih adalah SQL Editor — dan
// itu keadaan yang jauh lebih buruk daripada risiko yang dicegahnya. Jadi
// setiap kuncian PASTI kedaluwarsa sendiri, dan lamanya dibatasi.

/** Ember per akun: yang membidik satu email tertentu. */
export const AKUN = {
  jenis: 'AKUN',
  batas: 5,
  jendelaDetik: 15 * 60,
  kunciDetik: 15 * 60,
  // Kuncian berikutnya lebih lama, tetapi berhenti naik di sini. Tanpa batas
  // atas, penebak yang gigih bisa mengunci akun Owner berhari-hari — jadi
  // serangannya berubah dari menebak password menjadi menutup akses, dan itu
  // berhasil tanpa dia perlu menebak apa pun.
  maksKunciDetik: 30 * 60,
};

/**
 * Ember per alamat IP: yang mencoba banyak email dari satu tempat.
 *
 * Batasnya jauh lebih longgar daripada per akun, dan itu disengaja. Satu
 * kantor keluar lewat satu alamat IP, sehingga Owner dan seluruh auditor
 * berbagi ember yang sama. Batas yang ketat di sini akan membuat satu orang
 * yang lupa passwordnya mengunci semua rekannya sekaligus.
 */
export const IP = {
  jenis: 'IP',
  batas: 20,
  jendelaDetik: 15 * 60,
  kunciDetik: 15 * 60,
  maksKunciDetik: 15 * 60,
};

/**
 * Kunci ember untuk sebuah email.
 *
 * Dihitung dari email yang DIKIRIM, bukan dari akun yang ditemukan — dan itu
 * penting. Kalau ember hanya dibuat untuk email yang benar-benar terdaftar,
 * penebak bisa membedakan email terdaftar dari yang tidak hanya dengan melihat
 * mana yang akhirnya terkunci. Itu membocorkan persis hal yang pesan galatnya
 * susah payah sembunyikan.
 */
export function kunciAkun(email) {
  return `akun:${String(email ?? '').trim().toLowerCase()}`;
}

export function kunciIp(ip) {
  return `ip:${String(ip ?? 'tidak-diketahui').trim()}`;
}

const detik = (a, b) => Math.round((new Date(a).getTime() - new Date(b).getTime()) / 1000);

/**
 * Apakah ember ini sedang terkunci.
 *
 * @returns {{terkunci: boolean, sisaDetik: number}}
 */
export function periksa(keadaan, sekarang = new Date()) {
  const sampai = keadaan?.terkunci_sampai;
  if (!sampai) return { terkunci: false, sisaDetik: 0 };

  const sisa = detik(sampai, sekarang);
  return sisa > 0 ? { terkunci: true, sisaDetik: sisa } : { terkunci: false, sisaDetik: 0 };
}

/**
 * Keadaan ember sesudah satu percobaan gagal.
 *
 * Hitungan dimulai ulang bila kegagalan terakhir sudah di luar jendela: lima
 * salah ketik yang tersebar sepanjang hari bukan serangan, dan memperlakukannya
 * sebagai serangan akan mengunci orang yang memang pelupa.
 */
export function sesudahGagal(keadaan, sekarang = new Date(), aturan = AKUN) {
  const waktu = new Date(sekarang).toISOString();
  const dalamJendela =
    keadaan?.pertama_gagal && detik(sekarang, keadaan.pertama_gagal) < aturan.jendelaDetik;

  const gagal = (dalamJendela ? keadaan.gagal ?? 0 : 0) + 1;
  const baru = {
    jenis: aturan.jenis,
    gagal,
    pertama_gagal: dalamJendela ? keadaan.pertama_gagal : waktu,
    terakhir_gagal: waktu,
    kunci_ke: keadaan?.kunci_ke ?? 0,
    terkunci_sampai: null,
  };

  if (gagal < aturan.batas) return baru;

  baru.kunci_ke = (keadaan?.kunci_ke ?? 0) + 1;
  const lama = Math.min(
    aturan.kunciDetik * 2 ** (baru.kunci_ke - 1),
    aturan.maksKunciDetik
  );
  baru.terkunci_sampai = new Date(new Date(sekarang).getTime() + lama * 1000).toISOString();

  // Hitungan gagal dinolkan bersamaan dengan terkunci, supaya sesudah kuncian
  // berakhir orangnya mendapat jatah penuh lagi — bukan langsung terkunci lagi
  // pada percobaan pertamanya.
  baru.gagal = 0;
  baru.pertama_gagal = null;
  return baru;
}

/** Lama kuncian berikutnya, dalam detik. Dipakai untuk menjelaskan ke pemakai. */
export function lamaKunci(kunciKe, aturan = AKUN) {
  return Math.min(aturan.kunciDetik * 2 ** (Math.max(1, kunciKe) - 1), aturan.maksKunciDetik);
}

/** Kalimat penolakan. Sama persis untuk email terdaftar maupun tidak. */
export function pesanTerkunci(sisaDetik) {
  const menit = Math.max(1, Math.ceil(sisaDetik / 60));
  return (
    `Terlalu banyak percobaan masuk yang gagal. Coba lagi dalam ${menit} menit. ` +
    'Kalau lupa password, minta Owner menyetel ulang password awal Anda.'
  );
}

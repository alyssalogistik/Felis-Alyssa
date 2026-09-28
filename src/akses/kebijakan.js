// Izin apa yang dibutuhkan sebuah permintaan.
//
// Murni: menerima metode dan jalur, mengembalikan kelas izin. Tanpa I/O,
// sehingga seluruh peta izin aplikasi ini bisa diuji tanpa database, tanpa
// server, dan tanpa sesi siapa pun.
//
// ## Bawaannya menutup, bukan membuka
//
// Endpoint yang tidak disebut di berkas ini TIDAK menjadi bebas. Yang bukan
// GET jatuh ke OWNER, dan GET jatuh ke BACA. Jadi ketika nanti ada endpoint
// baru ditambahkan — misalnya satu DELETE lagi — dan penulisnya lupa
// memikirkan izin, hasilnya adalah endpoint yang terlalu ketat dan langsung
// ketahuan saat dicoba. Kebalikannya, bawaan yang membuka, menghasilkan
// endpoint yang diam-diam bisa dipakai auditor untuk menghapus data, dan itu
// tidak menimbulkan gejala apa pun sampai ada yang memakainya.

/** Kelas izin, dari paling longgar ke paling ketat. */
export const IZIN = {
  PUBLIK: 'PUBLIK',
  SESI: 'SESI',
  BACA: 'BACA',
  PERIKSA: 'PERIKSA',
  OWNER: 'OWNER',
};

/**
 * Jalur yang tetap terbuka tanpa login.
 *
 * Hanya dua, dan keduanya disebut satu per satu — bukan pola luas seperti
 * `/lacak/*`. Pelacakan resi dipakai customer, jadi harus tetap publik;
 * tetapi endpoint-nya sendiri hanya mengembalikan kolom pengiriman dan
 * menuntut nomor resi yang persis, sehingga tidak bisa dipakai menyusuri
 * data rekonsiliasi, rekening koran, supplier, pembayaran, maupun audit.
 */
const PUBLIK = [
  ['GET', /^\/lacak\/[^/]+$/],
  ['POST', /^\/auth\/masuk$/],
];

/** Butuh sesi, tapi tidak butuh peran apa pun. */
const SESI = [
  ['GET', /^\/auth\/saya$/],
  ['POST', /^\/auth\/keluar$/],
  ['POST', /^\/auth\/ganti-password$/],
];

/**
 * Menulis hasil pemeriksaan: status rekon, status temuan, catatan auditor.
 *
 * Ini satu-satunya tulisan yang boleh dilakukan auditor, dan hanya bila
 * Owner memberinya izin `boleh_periksa`.
 */
const PERIKSA = [
  ['POST', /^\/rekonsiliasi\/transaksi\/[^/]+\/rekon$/],
  ['POST', /^\/rekonsiliasi\/audit\/kecocokan\/[^/]+$/],
  ['PUT', /^\/mekari\/periksa\/.+$/],
];

/**
 * Jalur milik Owner walaupun metodenya GET.
 *
 * Tanpa ini, daftar pengguna dan jejak aktivitas jatuh ke bawaan GET (BACA)
 * dan bisa dibaca auditor — termasuk email seluruh rekan kerjanya dan seluruh
 * riwayat siapa mengubah apa.
 */
const OWNER_WALAU_GET = [/^\/pengguna(\/|$)/, /^\/jejak(\/|$)/];

/**
 * Jalur dirapikan sebelum dicocokkan.
 *
 * Garis miring ganda dan garis miring di ujung dibersihkan supaya
 * `//pengguna` atau `/pengguna/` tidak meleset dari pola di atas lalu jatuh
 * ke bawaan yang lebih longgar.
 */
export function rapikanJalur(jalur) {
  const bersih = String(jalur ?? '/').split('?')[0].replace(/\/{2,}/g, '/');
  return bersih.length > 1 ? bersih.replace(/\/+$/, '') || '/' : bersih;
}

function cocok(daftar, metode, jalur) {
  return daftar.some(([m, pola]) => m === metode && pola.test(jalur));
}

/** Izin yang dibutuhkan sebuah permintaan ke /api. */
export function izinDibutuhkan(metode, jalurMentah) {
  const m = String(metode ?? 'GET').toUpperCase();
  const jalur = rapikanJalur(jalurMentah);

  if (cocok(PUBLIK, m, jalur)) return IZIN.PUBLIK;
  if (cocok(SESI, m, jalur)) return IZIN.SESI;
  if (OWNER_WALAU_GET.some((pola) => pola.test(jalur))) return IZIN.OWNER;
  if (cocok(PERIKSA, m, jalur)) return IZIN.PERIKSA;

  // Bawaan. GET membaca, sisanya mengubah — dan yang mengubah milik Owner
  // sampai disebut sebaliknya di atas.
  return m === 'GET' ? IZIN.BACA : IZIN.OWNER;
}

/** Apakah profil ini memenuhi izin yang dibutuhkan. */
export function memenuhi(izin, profil) {
  if (izin === IZIN.PUBLIK) return true;
  if (!profil) return false;
  if (profil.status !== 'AKTIF') return false;

  if (izin === IZIN.SESI) return true;
  if (profil.peran === 'OWNER') return true;

  if (izin === IZIN.BACA) return true;
  if (izin === IZIN.PERIKSA) return profil.boleh_periksa === true;
  return false; // OWNER
}

/** Permintaan ini menyentuh data yang harus tersaring per perusahaan? */
export function perluSaringEntitas(izin) {
  return izin !== IZIN.PUBLIK && izin !== IZIN.SESI;
}

/**
 * Nama aksi untuk jejak aktivitas, diturunkan dari metode dan jalur.
 *
 * Pencatatan dilakukan terpusat di middleware, bukan dengan menyisipkan satu
 * panggilan catat() ke dalam setiap endpoint. Sebabnya bukan kerapian: cara
 * yang menyisipkan menuntut setiap endpoint BARU ingat mencatat dirinya, dan
 * yang lupa tidak menimbulkan galat apa pun — aktivitasnya cuma tidak pernah
 * muncul di jejak, dan itu baru ketahuan saat jejaknya dibutuhkan.
 *
 * Mengembalikan null untuk jalur yang sudah dicatat sendiri dengan rincian
 * lebih lengkap (masuk, keluar, pengelolaan pengguna), supaya tidak dobel.
 */
export function aksiUntuk(metode, jalurMentah) {
  const m = String(metode ?? 'GET').toUpperCase();
  const jalur = rapikanJalur(jalurMentah);

  if (m === 'GET') return null;
  if (/^\/(auth|pengguna)(\/|$)/.test(jalur)) return null;

  if (/\/unggah$/.test(jalur)) return 'UNGGAH';
  if (m === 'DELETE') return 'HAPUS_DATA';
  if (/^\/rekonsiliasi\/transaksi\/[^/]+\/rekon$/.test(jalur)) return 'UBAH_STATUS_REKON';
  if (/^\/mekari\/periksa\//.test(jalur)) return 'UBAH_STATUS_TEMUAN';
  if (/^\/rekonsiliasi\/audit\/kecocokan\//.test(jalur)) return 'UBAH_STATUS_TEMUAN';
  if (/^\/rekonsiliasi\/audit\/jalankan$/.test(jalur) || /^\/mekari\/hitung$/.test(jalur)) {
    return 'JALANKAN_AUDIT';
  }
  if (/^\/rekonsiliasi\/pembayaran/.test(jalur)) return 'UBAH_PEMBAYARAN';
  return 'UBAH_DATA';
}

/** Membuang hal yang tidak boleh ikut tercatat dari badan permintaan. */
export function detailAman(body) {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body) || Array.isArray(body)) return {};
  const keluar = {};
  for (const [kunci, nilai] of Object.entries(body)) {
    if (/password|token|rahasia/i.test(kunci)) continue;
    if (typeof nilai === 'string' && nilai.length > 300) {
      keluar[kunci] = `${nilai.slice(0, 300)}…`;
      continue;
    }
    if (nilai === null || ['string', 'number', 'boolean'].includes(typeof nilai)) {
      keluar[kunci] = nilai;
    } else if (Array.isArray(nilai) && nilai.length <= 20) {
      keluar[kunci] = nilai.filter((x) => ['string', 'number', 'boolean'].includes(typeof x));
    }
  }
  return keluar;
}

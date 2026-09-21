// Membaca dan menulis cookie sesi.
//
// Murni, dan sengaja tanpa pustaka. Express 4 tidak membawa pengurai cookie,
// dan menambah satu dependensi untuk sepuluh baris ini berarti menambah satu
// lagi yang harus diawasi di `npm audit` untuk aplikasi yang memegang data
// keuangan.

/** Nama cookie. Dipisah supaya tidak tersebar sebagai teks di banyak berkas. */
export const NAMA_AKSES = 'alyssa_sesi';
export const NAMA_SEGAR = 'alyssa_segar';

/** Mengurai header Cookie menjadi objek biasa. */
export function bacaKuki(header) {
  const hasil = {};
  for (const bagian of String(header ?? '').split(';')) {
    const pisah = bagian.indexOf('=');
    if (pisah < 1) continue;
    const nama = bagian.slice(0, pisah).trim();
    if (nama === '') continue;
    try {
      hasil[nama] = decodeURIComponent(bagian.slice(pisah + 1).trim());
    } catch {
      // Cookie cacat diperlakukan seperti tidak ada.
    }
  }
  return hasil;
}

/**
 * Merangkai satu Set-Cookie.
 *
 * `httpOnly` wajib dan tidak bisa dimatikan lewat opsi: token sesi yang bisa
 * dibaca JavaScript berarti satu celah XSS cukup untuk mencurinya. `sameSite:
 * Lax` menahan permintaan tulis yang dipicu dari situs lain, sehingga tidak
 * perlu token CSRF terpisah untuk alur ini.
 *
 * `secure` menyala kecuali dimatikan eksplisit untuk pengembangan lokal:
 * cookie tanpa Secure ikut terkirim lewat http polos dan bisa disadap.
 */
export function rangkaiKuki(nama, nilai, { maksUmur = null, aman = true } = {}) {
  const bagian = [
    `${nama}=${encodeURIComponent(nilai ?? '')}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (aman) bagian.push('Secure');
  if (maksUmur !== null) bagian.push(`Max-Age=${Math.max(0, Math.floor(maksUmur))}`);
  return bagian.join('; ');
}

/** Cookie yang langsung kedaluwarsa, untuk keluar dan untuk sesi yang ditolak. */
export function hapusKuki(nama, { aman = true } = {}) {
  return rangkaiKuki(nama, '', { maksUmur: 0, aman });
}

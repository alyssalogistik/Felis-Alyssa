// Penulis jejak aktivitas.
//
// Identitas pelakunya DISALIN ke dalam baris, bukan dirujuk lewat kunci asing.
// Akun auditor memang dimaksudkan untuk dihapus setelah pekerjaannya selesai;
// kalau jejaknya bergantung pada baris profil, menghapus akunnya akan ikut
// menghapus catatan pekerjaannya — persis yang tidak boleh terjadi pada alat
// audit.

/** Nama aksi. Dikumpulkan di satu tempat supaya tidak ada salah ketik yang
 *  diam-diam membuat satu jenis aktivitas hilang dari penyaringan. */
export const AKSI = {
  LOGIN: 'LOGIN',
  LOGIN_GAGAL: 'LOGIN_GAGAL',
  LOGOUT: 'LOGOUT',
  GANTI_PASSWORD: 'GANTI_PASSWORD',

  UNGGAH: 'UNGGAH',
  HAPUS_DATA: 'HAPUS_DATA',
  UBAH_STATUS_REKON: 'UBAH_STATUS_REKON',
  UBAH_STATUS_TEMUAN: 'UBAH_STATUS_TEMUAN',
  JALANKAN_AUDIT: 'JALANKAN_AUDIT',
  UBAH_PEMBAYARAN: 'UBAH_PEMBAYARAN',

  BUAT_PENGGUNA: 'BUAT_PENGGUNA',
  UBAH_AKSES: 'UBAH_AKSES',
  NONAKTIFKAN_PENGGUNA: 'NONAKTIFKAN_PENGGUNA',
  AKTIFKAN_PENGGUNA: 'AKTIFKAN_PENGGUNA',
  HAPUS_PENGGUNA: 'HAPUS_PENGGUNA',
  RESET_PASSWORD: 'RESET_PASSWORD',

  DITOLAK: 'DITOLAK',
};

/** Alamat peminta, menembus proxy Railway. */
export function alamatIp(req) {
  const teruskan = req.get?.('x-forwarded-for');
  if (teruskan) return String(teruskan).split(',')[0].trim();
  return req.ip ?? req.socket?.remoteAddress ?? null;
}

export function buatPencatat(db) {
  /**
   * Menulis satu baris jejak.
   *
   * **Tidak pernah melempar.** Unggahan yang transaksinya sudah tersimpan
   * tidak boleh digagalkan hanya karena baris catatannya gagal ditulis —
   * kegagalan seperti itu akan membuat pemakainya mengunggah ulang, dan
   * pengulangan itu justru yang paling mahal di aplikasi ini.
   *
   * Sebagai gantinya kegagalannya dicetak keras ke log server, supaya tidak
   * hilang tanpa jejak sama sekali.
   */
  return async function catat(req, isi) {
    const p = req?.pengguna ?? null;
    try {
      const { error } = await db.from('jejak_aktivitas').insert({
        pengguna_id: isi.pengguna_id ?? p?.id ?? null,
        // Tanda hubung, bukan null: kolomnya not null supaya baris jejak tanpa
        // identitas apa pun tidak pernah ada.
        pengguna_email: isi.pengguna_email ?? p?.email ?? '-',
        pengguna_nama: isi.pengguna_nama ?? p?.nama ?? null,
        peran: isi.peran ?? p?.peran ?? null,
        aksi: isi.aksi,
        entitas: isi.entitas ?? null,
        objek: isi.objek ?? null,
        objek_id: isi.objek_id == null ? null : String(isi.objek_id),
        detail: isi.detail ?? {},
        ip: alamatIp(req ?? {}),
        peramban: req?.get?.('user-agent') ?? null,
      });
      if (error) throw error;
    } catch (galat) {
      console.error('[jejak] gagal mencatat aktivitas:', isi.aksi, galat.message);
    }
  };
}

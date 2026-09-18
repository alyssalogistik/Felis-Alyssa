// Entitas pemilik rekening.
//
// Murni: menerima teks, mengembalikan kode. Tanpa I/O, sehingga aturannya bisa
// diuji tanpa database — dan aturan inilah yang memutuskan transaksi siapa yang
// muncul saat seseorang bertanya "supplier ini sudah saya bayar belum".
//
// PT Alyssa Auto Logistik dan CV Alyssa Trans Utama membayar sebagian supplier
// yang sama. Tanpa pemisahan ini, mencari SUGENG RIYANTO dari rekening CV akan
// memunculkan transfer PT juga, dan yang tampak sudah dibayar sebenarnya
// dibayar oleh perusahaan yang lain.

/** Kode disimpan di database; labelnya yang dibaca orang. */
export const ENTITAS = {
  PT_ALYSSA_AUTO_LOGISTIK: 'PT Alyssa Auto Logistik',
  CV_ALYSSA_TRANS_UTAMA: 'CV Alyssa Trans Utama',
};

export const KODE_ENTITAS = Object.keys(ENTITAS);

/**
 * Kode entitas dari nilai apa pun yang dikirim, atau null bila tidak dikenali.
 *
 * Diterima apa adanya kode resminya, dan juga label yang dibaca orang, supaya
 * nilai dari formulir maupun dari database sama-sama masuk lewat satu pintu.
 *
 * **Tidak ada nilai bawaan, dan itu disengaja.** Bawaan yang diam-diam dipakai
 * ketika pilihannya lupa dikirim akan menandai rekening koran CV sebagai milik
 * PT. Kekeliruan itu tidak menimbulkan galat apa pun — baru ketahuan berbulan
 * kemudian ketika angka auditnya dipakai, dan saat itu tidak ada cara
 * membedakan lagi baris mana yang salah tanda.
 */
export function kodeEntitas(nilai) {
  const teks = String(nilai ?? '').trim();
  if (teks === '') return null;

  const rapi = teks.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (KODE_ENTITAS.includes(rapi)) return rapi;

  // Label yang dibaca orang, misalnya "PT Alyssa Auto Logistik".
  const cocok = KODE_ENTITAS.find(
    (kode) => ENTITAS[kode].toUpperCase().replace(/[^A-Z0-9]+/g, '_') === rapi
  );
  return cocok ?? null;
}

/** Nama yang ditampilkan. Kode yang tidak dikenali dikembalikan apa adanya. */
export function labelEntitas(kode) {
  return ENTITAS[kode] ?? String(kode ?? '');
}

/**
 * Menafsirkan pilihan entitas pada penyaringan.
 *
 * Mengembalikan `{ ok, kode }`. `kode` null berarti seluruh entitas, dan itu
 * pilihan yang sah — berbeda dari penyimpanan, di mana tidak memilih apa pun
 * harus ditolak.
 *
 * **Nilai yang tidak dikenali menghasilkan `ok: false`, bukan diam-diam
 * berarti "semua".** Kalau salah ketik jatuh ke "semua", satu tab yang keliru
 * akan memunculkan transaksi perusahaan lain tanpa gejala apa pun — dan
 * justru itu yang seluruh pemisahan ini berusaha cegah.
 */
export function saringanEntitas(nilai) {
  const teks = String(nilai ?? '').trim();
  if (teks === '' || teks.toLowerCase() === 'semua') return { ok: true, kode: null };

  const kode = kodeEntitas(teks);
  return kode === null ? { ok: false, kode: null } : { ok: true, kode };
}

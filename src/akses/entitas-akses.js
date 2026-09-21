// Membatasi akses PT/CV per pengguna.
//
// Murni: menerima profil dan pilihan yang diminta, mengembalikan pilihan yang
// boleh dipakai. Tanpa I/O, sehingga aturan yang memutuskan perusahaan mana
// yang terlihat bisa diuji tanpa database.
//
// ## Yang ditutup di sini
//
// Sebelum lapisan ini ada, penyaringan entitas yang kosong berarti "semua
// perusahaan" — `saringanEntitas('')` menghasilkan kode null, dan null berarti
// kueri berjalan tanpa filter. Itu benar ketika setiap pemakainya memang boleh
// melihat keduanya. Begitu ada auditor yang hanya boleh melihat PT, kolom
// filter yang dikosongkan akan memunculkan CV — tanpa satu pun galat, dan
// tanpa dia sadar sedang melihat perusahaan yang bukan haknya.
//
// Karena itu di sini "kosong" TIDAK diterjemahkan menjadi null, melainkan
// menjadi daftar milik pengguna itu sendiri.

import { KODE_ENTITAS, kodeEntitas } from '../rekonsiliasi/entitas.js';

/**
 * Perusahaan yang boleh dilihat sebuah profil.
 *
 * OWNER selalu mendapat seluruhnya; kolom `entitas_akses` miliknya tidak
 * dibaca sama sekali. Kalau dibaca, Owner yang lupa mengisi kolom itu untuk
 * dirinya sendiri akan kehilangan akses ke seluruh data, dan satu-satunya
 * jalan pulih adalah SQL Editor.
 */
export function entitasDiizinkan(profil) {
  if (!profil) return [];
  if (profil.peran === 'OWNER') return [...KODE_ENTITAS];
  return (profil.entitas_akses ?? []).filter((e) => KODE_ENTITAS.includes(e));
}

/** Pengguna ini boleh melihat seluruh perusahaan? */
export function melihatSemua(izin) {
  return izin.length === KODE_ENTITAS.length;
}

/**
 * Nilai filter entitas yang boleh dipakai, dari nilai yang diminta.
 *
 * Mengembalikan `{ ok, nilai, alasan }`. `nilai` adalah string yang akan
 * menggantikan `req.query.entitas`, dan string kosong berarti "tanpa filter" —
 * hanya sah bila penggunanya memang boleh melihat seluruh perusahaan.
 */
export function saringanUntuk(diminta, izin) {
  if (izin.length === 0) {
    return {
      ok: false,
      nilai: null,
      alasan: 'Akun ini belum diberi akses ke perusahaan mana pun. Hubungi Owner.',
    };
  }

  const teks = String(diminta ?? '').trim();
  const kosong = teks === '' || teks.toLowerCase() === 'semua';

  if (kosong) {
    if (melihatSemua(izin)) return { ok: true, nilai: '' };
    if (izin.length === 1) return { ok: true, nilai: izin[0] };

    // Tidak terjangkau selama hanya ada dua entitas: daftar izin pasti
    // berisi satu atau dua. Kalau suatu saat entitasnya bertambah, kondisi
    // ini menjadi mungkin — dan menjawab "tanpa filter" di sini akan
    // membocorkan perusahaan yang bukan haknya. Jadi ditolak keras, bukan
    // ditebak. Diikat oleh uji yang memeriksa jumlah KODE_ENTITAS.
    return {
      ok: false,
      nilai: null,
      alasan:
        'Akses sebagian perusahaan belum didukung penyaringan ini. ' +
        'Pilih satu perusahaan secara eksplisit.',
    };
  }

  const kode = kodeEntitas(teks);
  if (kode === null) {
    return { ok: false, nilai: null, alasan: `Perusahaan "${teks}" tidak dikenali.` };
  }
  if (!izin.includes(kode)) {
    return { ok: false, nilai: null, alasan: 'Akun ini tidak punya akses ke perusahaan tersebut.' };
  }
  return { ok: true, nilai: kode };
}

/**
 * Boleh menulis atas nama entitas ini?
 *
 * Dipakai untuk unggahan dan perubahan, di mana entitasnya datang lewat body
 * atau header. Nilai kosong dibiarkan lewat: aturan "tidak ada entitas bawaan"
 * yang sudah ada di modul rekonsiliasi yang akan menolaknya, dengan pesan yang
 * jauh lebih berguna daripada pesan izin.
 */
export function bolehMenulis(diminta, izin) {
  const teks = String(diminta ?? '').trim();
  if (teks === '') return { ok: true, nilai: null };

  const kode = kodeEntitas(teks);
  if (kode === null) return { ok: true, nilai: null };
  if (!izin.includes(kode)) {
    return { ok: false, nilai: kode, alasan: 'Akun ini tidak punya akses ke perusahaan tersebut.' };
  }
  return { ok: true, nilai: kode };
}

// Menerjemahkan kegagalan skema menjadi instruksi yang bisa dikerjakan.
//
// Murni: menerima objek galat, mengembalikan kalimat. Tanpa I/O, sehingga
// pesannya bisa diuji tanpa database — dan justru pesan inilah yang dibaca
// pemilik database saat panik.
//
// Tabel yang belum dibuat adalah satu-satunya kegagalan yang penyebabnya ada di
// luar aplikasi dan obatnya satu langkah pasti. Pesan mentah PostgREST untuk
// kasus ini ("Could not find the table ... in the schema cache") menyuruh
// pembacanya menebak, jadi diterjemahkan.

/**
 * Tabel yang sudah ada sejak pemasangan pertama dan memuat data sungguhan.
 *
 * Kalau salah satu dari ini yang dilaporkan hilang, databasenya memang belum
 * dipasang. Kalau yang hilang objek lain, tabel-tabel ini ada dan berisi —
 * yang tertinggal hanya migration terbaru.
 */
const TABEL_INTI = new Set([
  'pesanan',
  'transaksi_bank',
  'unggahan_rekening_koran',
]);

/**
 * Nama relasi yang disebut di dalam pesan galat, tanpa awalan skema.
 *
 * Dua bentuk yang mungkin muncul:
 *   PostgREST : Could not find the table 'public.pembayaran_semua' in the schema cache
 *   PostgreSQL: relation "pembayaran_semua" does not exist
 */
export function namaRelasi(pesan) {
  const teks = String(pesan ?? '');

  const postgrest = teks.match(/could not find the (?:table|view|relation) ['"]([^'"]+)['"]/i);
  if (postgrest) return postgrest[1].replace(/^[^.]+\./, '');

  const postgres = teks.match(/relation ["']([^"']+)["'] does not exist/i);
  if (postgres) return postgres[1].replace(/^[^.]+\./, '');

  return null;
}

/**
 * Kalimat penyebab, atau null bila galatnya bukan soal skema.
 *
 * Dibedakan antara database yang memang belum dipasang dan database berisi yang
 * skemanya tertinggal satu migration. Keduanya sama-sama disembuhkan oleh
 * setup-lengkap.sql, tetapi mengatakan "tabelnya belum dibuat" kepada pemilik
 * database yang memuat ribuan transaksi terbaca seperti datanya hilang — dan
 * orang yang mengira datanya hilang akan melakukan hal-hal yang membuatnya
 * benar-benar hilang.
 */
export function skemaBelumSiap(error) {
  const kode = error?.code;
  const pesan = String(error?.message ?? '');

  const TERTINGGAL =
    'Database belum diperbarui: skemanya tertinggal dari versi aplikasi ' +
    'yang sedang jalan. Data lama tetap utuh.';

  if (kode === 'PGRST205' || kode === '42P01' ||
      /relation ".*" does not exist/i.test(pesan) ||
      /could not find the (?:table|view|relation)/i.test(pesan)) {
    const relasi = namaRelasi(pesan);

    // Objek yang hilang bukan tabel inti: yang lama ada, hanya migration
    // terbarunya yang belum dijalankan.
    if (relasi !== null && !TABEL_INTI.has(relasi)) return TERTINGGAL;

    return 'Database belum disiapkan: tabelnya belum dibuat.';
  }

  // Kolom atau fungsi yang belum ada: tabelnya sudah berisi, hanya skemanya
  // yang tertinggal dari kode yang baru ter-deploy.
  if (kode === 'PGRST204' || kode === '42703' || kode === '42883' ||
      /schema cache/i.test(pesan) ||
      /column .* does not exist/i.test(pesan) ||
      /function .* does not exist/i.test(pesan)) {
    return TERTINGGAL;
  }

  return null;
}

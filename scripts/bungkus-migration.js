// Aturan pembungkusan migration menjadi SATU blok DO.
//
// Dipisah ke berkas sendiri karena dipakai dua pembangkit: setup-lengkap.sql
// (0001 sampai terakhir) dan setup sebagian (hanya migration yang belum
// terpasang). Dua salinan aturan yang sama akan menyimpang begitu salah satu
// disunting, dan yang menyimpang di sini memasang skema yang berbeda dari yang
// diuji — tanpa satu pun galat sampai kolomnya dipakai.
//
// Sumber kebenaran tetap berkas migration. Berkas ini hanya membungkus.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Komentar dibuang supaya yang harus disalin lewat layar sentuh sependek
// mungkin; penjelasannya tetap hidup di berkas migration aslinya.
export function ringkas(sql) {
  return sql
    .split('\n')
    .map((baris) => baris.replace(/(^|\s)--\s.*$/, '$1').trimEnd())
    .filter((baris) => baris.trim() !== '')
    .join('\n');
}

// Badan fungsi memakai $$; di dalam blok DO tag itu akan menutup blok luar
// terlalu cepat, jadi diberi tag sendiri.
export function tagUlang(sql) {
  return sql.replace(/\$\$/g, '$fn$');
}

// Migration yang berdiri sendiri memanggil pg_notify lewat SELECT di akhirnya.
// Di dalam blok DO, SELECT telanjang bukan perintah yang sah — plpgsql menuntut
// PERFORM. Barisnya dibuang di sini karena pembungkusnya sudah memanggilnya
// sendiri satu kali di akhir, sesudah seluruh migration dijalankan.
export function buangNotify(sql) {
  return sql.replace(/^\s*select\s+pg_notify\([^;]*\);\s*$/gim, '');
}

// Peringatan "destructive operations" di SQL Editor Supabase memindai teks
// mentah, komentar ikut terbaca. Kalimat yang menyebutkan operasi berbahaya
// untuk menyatakan bahwa operasi itu TIDAK ada justru memicu peringatannya
// sendiri, jadi kepala berkas sengaja tidak menyebut kata-kata tersebut.
export function bungkus({ akar, urutan, judul, selesai }) {
  const bagian = urutan.map((berkas) =>
    tagUlang(ringkas(buangNotify(readFileSync(join(akar, 'supabase/migrations', berkas), 'utf8'))))
  );

  return `-- ${judul}
-- Satu perintah. Salin seluruhnya, tempel, Run.
-- Hanya menambah tabel, fungsi, view, indeks, dan trigger baru.
-- Aman dijalankan berulang; data yang sudah ada tidak tersentuh.
do $migrasi$
begin
${bagian.join('\n')}

-- Setelah skema berubah, PostgREST masih memakai peta lama sampai diberi
-- tahu. Tanpa ini tabel baru tetap dilaporkan "not found in the schema
-- cache" walaupun sudah ada.
perform pg_notify('pgrst', 'reload schema');

raise notice '${selesai}';
end
$migrasi$;
`;
}

// Satu-satunya daftar urutan migration. Pembangkit mana pun membacanya dari
// sini, sehingga migration baru cukup didaftarkan satu kali.
export const URUTAN = [
  '0001_skema_awal.sql',
  '0002_otomatis_dan_keamanan.sql',
  '0003_rekonsiliasi_bank.sql',
  '0004_audit_pemasok.sql',
  '0005_filter_tanggal_audit.sql',
  '0006_sidik_transaksi.sql',
  '0007_tampilan_tanpa_ganda.sql',
  '0008_pembayaran_manual.sql',
  '0009_entitas_rekening.sql',
  '0010_audit_mekari.sql',
  '0011_pengguna_dan_jejak.sql',
  '0012_batas_percobaan_masuk.sql',
  '0013_integrasi_supplier.sql',
  '0014_riwayat_pembayaran_supplier.sql',
  '0015_supplier_id_canonical.sql',
  '0016_lepas_tautan.sql',
];

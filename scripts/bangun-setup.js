#!/usr/bin/env node
// Menggabungkan supabase/migrations/*.sql menjadi SATU perintah SQL.
//
// Alasannya bukan kerapian. SQL Editor Supabase menjalankan hanya teks yang
// sedang tersorot bila ada seleksi aktif — di layar sentuh seleksi liar mudah
// terjadi tanpa disadari. Ketika berkasnya berisi banyak perintah, sorotan
// yang meleset menjalankan sebagian skema dan menyisakan database setengah
// jadi. Sebagai satu blok DO, hasilnya hanya dua: seluruhnya masuk, atau
// tidak ada sama sekali yang berubah — sorotan yang meleset gagal dengan
// keras alih-alih diam-diam merusak.
//
// Sumber kebenaran tetap berkas migration. Berkas ini hanya membungkus.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const akar = join(dirname(fileURLToPath(import.meta.url)), '..');
const urutan = [
  '0001_skema_awal.sql',
  '0002_otomatis_dan_keamanan.sql',
  '0003_rekonsiliasi_bank.sql',
  '0004_audit_pemasok.sql',
];

// Komentar dibuang supaya yang harus disalin lewat layar sentuh sependek
// mungkin; penjelasannya tetap hidup di berkas migration aslinya.
function ringkas(sql) {
  return sql
    .split('\n')
    .map((baris) => baris.replace(/(^|\s)--\s.*$/, '$1').trimEnd())
    .filter((baris) => baris.trim() !== '')
    .join('\n');
}

// Badan fungsi memakai $$; di dalam blok DO tag itu akan menutup blok luar
// terlalu cepat, jadi diberi tag sendiri.
function tagUlang(sql) {
  return sql.replace(/\$\$/g, '$fn$');
}

const bagian = urutan.map((berkas) =>
  tagUlang(ringkas(readFileSync(join(akar, 'supabase/migrations', berkas), 'utf8')))
);

const isi = `-- SETUP DATABASE ALYSSA AUTO LOGISTIK
-- Satu perintah. Salin seluruhnya, tempel, Run.
-- Hanya membuat tabel/fungsi/view baru: tidak ada drop table, delete,
-- maupun penimpaan data yang sudah ada. Aman dijalankan berulang.
do $migrasi$
begin
${bagian.join('\n')}

-- Setelah skema berubah, PostgREST masih memakai peta lama sampai diberi
-- tahu. Tanpa ini tabel baru tetap dilaporkan "not found in the schema
-- cache" walaupun sudah ada.
perform pg_notify('pgrst', 'reload schema');

raise notice 'Setup Alyssa selesai. Tabel audit supplier siap dipakai.';
end
$migrasi$;
`;

writeFileSync(join(akar, 'supabase/setup-lengkap.sql'), isi);
console.log(`setup-lengkap.sql: ${isi.split('\n').length} baris, ${isi.length} karakter`);

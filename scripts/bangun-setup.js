#!/usr/bin/env node
// Menggabungkan SELURUH supabase/migrations/*.sql menjadi SATU perintah SQL.
//
// Alasannya bukan kerapian. SQL Editor Supabase menjalankan hanya teks yang
// sedang tersorot bila ada seleksi aktif — di layar sentuh seleksi liar mudah
// terjadi tanpa disadari. Ketika berkasnya berisi banyak perintah, sorotan
// yang meleset menjalankan sebagian skema dan menyisakan database setengah
// jadi. Sebagai satu blok DO, hasilnya hanya dua: seluruhnya masuk, atau
// tidak ada sama sekali yang berubah — sorotan yang meleset gagal dengan
// keras alih-alih diam-diam merusak.
//
// Aturan pembungkusannya ada di bungkus-migration.js, dipakai bersama
// bangun-sebagian.js. Sumber kebenaran tetap berkas migration.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bungkus, URUTAN } from './bungkus-migration.js';

const akar = join(dirname(fileURLToPath(import.meta.url)), '..');

const isi = bungkus({
  akar,
  urutan: URUTAN,
  judul: 'SETUP DATABASE ALYSSA AUTO LOGISTIK',
  selesai: 'Setup Alyssa selesai. Tabel audit supplier siap dipakai.',
});

writeFileSync(join(akar, 'supabase/setup-lengkap.sql'), isi);
console.log(`setup-lengkap.sql: ${isi.split('\n').length} baris, ${isi.length} karakter`);

#!/usr/bin/env node
// Membangun satu blok DO untuk SEBAGIAN migration saja.
//
//   node scripts/bangun-sebagian.js 0013 0014
//
// Gunanya: database yang sudah berisi 0001 sampai 0012 tidak perlu disalin
// seluruh setup-lengkap.sql (61 KB) lewat layar sentuh hanya untuk memasang
// dua migration terakhir. Keamanannya sama — satu blok DO, jadi seluruhnya
// masuk atau tidak ada yang berubah.
//
// Hasilnya ditulis ke supabase/setup-sebagian.sql, yang sengaja TIDAK
// di-commit: ia bergantung pada migration mana yang sudah terpasang di
// database tertentu, jadi menyimpannya di repo akan membuat berkas yang
// benar untuk satu database dan salah untuk yang lain.
//
// Aturan pembungkusannya dipakai bersama bangun-setup.js.

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bungkus, URUTAN } from './bungkus-migration.js';

const akar = join(dirname(fileURLToPath(import.meta.url)), '..');
const diminta = process.argv.slice(2);

if (diminta.length === 0) {
  console.error('Pakai: node scripts/bangun-sebagian.js 0013 0014');
  process.exit(1);
}

// Dicari dari URUTAN, bukan dari nama berkas yang diketik, supaya migration
// tetap terpasang menurut urutan nomornya walau argumennya terbalik — 0014
// memakai tabel yang dibuat 0013, jadi urutan yang salah gagal total.
const urutan = URUTAN.filter((berkas) => diminta.some((nomor) => berkas.startsWith(`${nomor}_`)));

const tidakKetemu = diminta.filter((nomor) => !URUTAN.some((b) => b.startsWith(`${nomor}_`)));
if (tidakKetemu.length > 0) {
  console.error(`Migration tidak ada: ${tidakKetemu.join(', ')}`);
  process.exit(1);
}

const nomor = urutan.map((b) => b.slice(0, 4));
const isi = bungkus({
  akar,
  urutan,
  judul: `SETUP TAMBAHAN ALYSSA AUTO LOGISTIK — bagian ${nomor.join(' dan ')}`,
  selesai: `Bagian ${nomor.join(' dan ')} selesai.`,
});

const tujuan = join(akar, 'supabase/setup-sebagian.sql');
writeFileSync(tujuan, isi);
console.log(`setup-sebagian.sql (${nomor.join(', ')}): ${isi.split('\n').length} baris, ${isi.length} karakter`);

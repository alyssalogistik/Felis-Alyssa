#!/usr/bin/env node
/**
 * Cek koneksi Supabase.
 *
 * Menjawab tiga hal:
 *   1. Kredensialnya kebaca nggak?
 *   2. Project-nya nyambung nggak, dan yang mana?
 *   3. Isinya tabel apa aja?
 *
 * Sengaja tanpa dependency apa pun, supaya bisa dijalankan sebelum npm install.
 * Pakai: npm run check   (atau: node scripts/health-check.js)
 */
import { readFileSync } from 'node:fs';

/** Baca .env sendiri, supaya script ini tidak butuh paket dotenv. */
function loadEnvFile(path = '.env') {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return; // Tidak apa-apa: nilainya mungkin sudah ada di environment (misal di Railway).
  }
  for (const line of raw.split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, '');
    if (value && !process.env[match[1]]) process.env[match[1]] = value;
  }
}

/** Tampilkan kunci tanpa membocorkan isinya. */
function mask(key) {
  if (!key) return '(kosong)';
  return `${key.slice(0, 6)}...${key.slice(-4)} (${key.length} karakter)`;
}

function fail(message, hint) {
  console.error(`\n  GAGAL: ${message}`);
  if (hint) console.error(`  -> ${hint}`);
  process.exit(1);
}

loadEnvFile();

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;

console.log('\n=== Cek Koneksi Supabase ===\n');

if (!url) {
  fail('SUPABASE_URL belum diisi.', 'Salin .env.example jadi .env, isi dari Dashboard -> Project Settings -> API.');
}
if (!anonKey) {
  fail('SUPABASE_ANON_KEY belum diisi.', 'Ambil "anon public" di Dashboard -> Project Settings -> API.');
}

const refMatch = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url);
if (!refMatch) {
  fail(`SUPABASE_URL formatnya tidak dikenali: ${url}`, 'Harusnya https://<project-ref>.supabase.co');
}

console.log(`  URL          : ${url}`);
console.log(`  Project ref  : ${refMatch[1]}`);
console.log(`  Anon key     : ${mask(anonKey)}`);
console.log(`  Service key  : ${mask(process.env.SUPABASE_SERVICE_ROLE_KEY)}`);
console.log('\n  Menghubungi project...\n');

let response;
try {
  response = await fetch(`${url}/rest/v1/`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
  });
} catch (error) {
  fail(`Tidak bisa menghubungi ${url} - ${error.message}`, 'Cek koneksi internet, atau project mungkin sedang di-pause.');
}

if (response.status === 401) {
  fail('Kunci ditolak (401).', 'SUPABASE_ANON_KEY tidak cocok dengan project ini. Ambil ulang dari dashboard.');
}
if (!response.ok) {
  fail(`Project membalas HTTP ${response.status}.`, 'Kalau 5xx, project mungkin sedang di-pause atau restart.');
}

const spec = await response.json();
const tables = Object.keys(spec.definitions ?? spec.components?.schemas ?? {}).sort();

console.log('  TERHUBUNG.\n');

if (tables.length === 0) {
  console.log('  Belum ada tabel yang di-expose lewat API.');
  console.log('  Kalau kamu yakin project ini ada isinya, cek dua hal:');
  console.log('    - Tabelnya ada di schema "public"?');
  console.log('    - Row Level Security-nya mengizinkan role anon?');
} else {
  console.log(`  Ada ${tables.length} tabel:`);
  for (const table of tables) console.log(`    - ${table}`);
}

console.log('\n  Cocokkan project ref di atas dengan project yang kamu tuju di dashboard.');
console.log('  Kalau refnya beda, berarti .env-mu menunjuk ke database yang salah.\n');

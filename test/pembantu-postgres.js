// Postgres sementara untuk tes yang harus menyentuh database sungguhan.
//
// Dipakai hanya oleh tes yang perilakunya milik DATABASE — transaksi, kunci
// baris, hak akses fungsi — dan tidak bisa dibuktikan dengan tiruan. Tiruan
// akan lulus walau fungsinya salah: yang diuji justru apa yang dilakukan
// Postgres saat perintah kedua gagal atau dua sesi berebut satu baris.
//
// Tanpa Postgres terpasang tesnya DILEWATI, bukan gagal.

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { URUTAN } from '../scripts/bungkus-migration.js';

const AKAR = new URL('..', import.meta.url).pathname;
const PORT = '5499';

function cariBin() {
  const induk = '/usr/lib/postgresql';
  if (!existsSync(induk)) return null;
  const versi = readdirSync(induk).sort((a, b) => Number(b) - Number(a));
  for (const v of versi) {
    const bin = join(induk, v, 'bin');
    if (existsSync(join(bin, 'initdb')) && existsSync(join(bin, 'psql'))) return bin;
  }
  return null;
}

const BIN = cariBin();
export const postgresTersedia = BIN !== null;

// initdb dan pg_ctl menolak berjalan sebagai root. Di kontainer yang memang
// berjalan sebagai root, pindah ke pengguna `postgres`.
const sebagaiRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const awalan = (bin, args) => (sebagaiRoot ? ['runuser', ['-u', 'postgres', '--', bin, ...args]] : [bin, args]);

function jalankan(bin, args) {
  const [perintah, argumen] = awalan(bin, args);
  return execFileSync(perintah, argumen, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
}

/**
 * Menyalakan cluster sementara dengan SELURUH migration terpasang.
 *
 * @returns {{sql: Function, sesi: Function, berhenti: Function}}
 */
export function mulaiPostgres() {
  const dir = mkdtempSync(join(tmpdir(), 'felis-pg-'));
  if (sebagaiRoot) execFileSync('chown', ['postgres:postgres', dir]);

  jalankan(join(BIN, 'initdb'), ['-D', join(dir, 'data'), '-A', 'trust', '-U', 'postgres']);
  jalankan(join(BIN, 'pg_ctl'), [
    '-D', join(dir, 'data'), '-l', join(dir, 'log'), '-w',
    '-o', `-k ${dir} -c listen_addresses='' -p ${PORT}`, 'start',
  ]);

  const dasar = ['-h', dir, '-p', PORT, '-U', 'postgres', '-X', '-q', '-d', 'postgres'];

  /** Menjalankan SQL; mengembalikan baris-baris `a|b|c`. Melempar bila galat. */
  const sql = (teks) =>
    execFileSync(join(BIN, 'psql'), [...dasar, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', teks],
      { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

  /** Seperti sql(), tetapi tidak melempar: {ok, keluar, galat}. */
  const coba = (teks) => {
    try { return { ok: true, keluar: sql(teks), galat: '' }; }
    catch (e) { return { ok: false, keluar: '', galat: String(e.stderr ?? e.message) }; }
  };

  /** Sesi psql sendiri yang berjalan di latar, untuk menguji dua sesi yang berebut. */
  const sesi = (teks) => new Promise((selesai) => {
    const p = spawn(join(BIN, 'psql'), [...dasar, '-v', 'ON_ERROR_STOP=1', '-At', '-F', '|', '-c', teks]);
    let keluar = ''; let galat = '';
    p.stdout.on('data', (d) => { keluar += d; });
    p.stderr.on('data', (d) => { galat += d; });
    p.on('close', (kode) => selesai({ ok: kode === 0, keluar: keluar.trim(), galat }));
  });

  // Meniru keadaan Supabase: tiga peran API, dan hak BAWAAN pada objek baru di
  // schema public — termasuk EXECUTE untuk anon dan authenticated pada fungsi
  // baru. Tanpa itu tes hak akses lulus karena cluster polos memang tidak
  // memberi apa-apa, bukan karena migration-nya benar.
  sql(`create role anon nologin; create role authenticated nologin;
       create role service_role nologin bypassrls; create role authenticator noinherit login;
       grant usage on schema public to anon, authenticated, service_role;
       alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
       alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
       alter default privileges in schema public grant all on functions to anon, authenticated, service_role;`);
  for (const berkas of URUTAN) {
    execFileSync(join(BIN, 'psql'), [...dasar, '-v', 'ON_ERROR_STOP=1', '-f', join(AKAR, 'supabase/migrations', berkas)],
      { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  const berhenti = () => {
    try { jalankan(join(BIN, 'pg_ctl'), ['-D', join(dir, 'data'), '-m', 'immediate', 'stop']); } catch { /* sudah mati */ }
    rmSync(dir, { recursive: true, force: true });
  };

  return { sql, coba, sesi, berhenti };
}

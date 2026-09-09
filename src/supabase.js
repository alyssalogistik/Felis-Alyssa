import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Project yang boleh disentuh. Diisi lewat env, bukan ditanam di kode. */
const refDiharapkan = process.env.SUPABASE_PROJECT_REF?.trim() || null;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(
      `${name} belum diisi. Salin .env.example jadi .env lalu isi dari Supabase Dashboard -> Project Settings -> API.`
    );
  }
  return value;
}

/** Ambil project ref dari URL, buat memastikan nyambung ke project yang benar. */
export function projectRef(alamat = url) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.(co|in)/.exec(alamat ?? '');
  return match ? match[1] : null;
}

/**
 * Memastikan kredensial yang terpasang menunjuk ke project yang diizinkan.
 *
 * Aturan isolasi project ini sebelumnya hanya berupa catatan yang harus diingat
 * manusia. Di sini aturan itu dijalankan mesin: begitu SUPABASE_PROJECT_REF
 * diisi, kredensial yang menunjuk ke project lain membuat aplikasi menolak
 * menyala, bukan diam-diam menulis ke database yang salah.
 *
 * Dibiarkan longgar ketika SUPABASE_PROJECT_REF kosong, supaya pengembangan
 * lokal dan pengujian tidak wajib menyebut project mana pun.
 *
 * @returns {{aman: boolean, alasan?: string, ref: string|null, diharapkan: string|null}}
 */
export function periksaProject() {
  const ref = projectRef();

  if (!refDiharapkan) {
    return { aman: true, ref, diharapkan: null };
  }
  if (!ref) {
    return {
      aman: false,
      ref,
      diharapkan: refDiharapkan,
      alasan:
        `SUPABASE_PROJECT_REF diisi "${refDiharapkan}", tetapi project ref tidak bisa ` +
        `dibaca dari SUPABASE_URL. Pastikan URL-nya berbentuk https://<ref>.supabase.co`,
    };
  }
  if (ref !== refDiharapkan) {
    return {
      aman: false,
      ref,
      diharapkan: refDiharapkan,
      alasan:
        `Kredensial menunjuk ke project "${ref}", padahal yang diizinkan hanya ` +
        `"${refDiharapkan}". Aplikasi dihentikan supaya tidak menulis ke database ` +
        `milik project lain. Periksa SUPABASE_URL di Railway -> Variables.`,
    };
  }
  return { aman: true, ref, diharapkan: refDiharapkan };
}

/** Berhenti keras bila project sasarannya salah. Dipanggil sebelum client dibuat. */
function wajibProjectBenar() {
  const hasil = periksaProject();
  if (!hasil.aman) throw new Error(hasil.alasan);
}

/** Client publik. Tunduk pada Row Level Security. Ini yang dipakai di sisi user. */
export function createPublicClient() {
  wajibProjectBenar();
  return createClient(
    requireEnv('SUPABASE_URL', url),
    requireEnv('SUPABASE_ANON_KEY', anonKey),
    { auth: { persistSession: false } }
  );
}

/**
 * Client admin. Menembus Row Level Security.
 * Hanya boleh dipanggil dari sisi server. Jangan pernah dibundle ke frontend.
 */
export function createAdminClient() {
  wajibProjectBenar();
  return createClient(
    requireEnv('SUPABASE_URL', url),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey),
    { auth: { persistSession: false } }
  );
}

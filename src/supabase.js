import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function requireEnv(name, value) {
  if (!value) {
    throw new Error(
      `${name} belum diisi. Salin .env.example jadi .env lalu isi dari Supabase Dashboard -> Project Settings -> API.`
    );
  }
  return value;
}

/** Client publik. Tunduk pada Row Level Security. Ini yang dipakai di sisi user. */
export function createPublicClient() {
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
  return createClient(
    requireEnv('SUPABASE_URL', url),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey),
    { auth: { persistSession: false } }
  );
}

/** Ambil project ref dari URL, buat memastikan nyambung ke project yang benar. */
export function projectRef() {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url ?? '');
  return match ? match[1] : null;
}

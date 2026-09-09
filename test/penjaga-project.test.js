// Penjaga sasaran Supabase: aplikasi harus menolak project selain yang diizinkan.
//
// Modul supabase.js membaca env saat dimuat, jadi tiap kasus memakai import
// dinamis dengan penanda unik agar mendapat salinan modul yang segar.

import test from 'node:test';
import assert from 'node:assert/strict';

let hitung = 0;

/** Memuat ulang supabase.js dengan environment yang ditentukan kasus uji. */
async function muatDengan(env) {
  const asli = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  hitung += 1;
  const modul = await import(`../src/supabase.js?uji=${hitung}`);
  process.env = asli;
  return modul;
}

const REF_ALYSSA = 'abcdefghijklmnopqrst';
const URL_ALYSSA = `https://${REF_ALYSSA}.supabase.co`;

test('project yang cocok dinyatakan aman', async () => {
  const { periksaProject } = await muatDengan({
    SUPABASE_URL: URL_ALYSSA,
    SUPABASE_PROJECT_REF: REF_ALYSSA,
  });

  const hasil = periksaProject();
  assert.equal(hasil.aman, true);
  assert.equal(hasil.ref, REF_ALYSSA);
});

test('project lain ditolak, dan alasannya menyebut kedua ref', async () => {
  const { periksaProject } = await muatDengan({
    SUPABASE_URL: 'https://projectlainlainlainxx.supabase.co',
    SUPABASE_PROJECT_REF: REF_ALYSSA,
  });

  const hasil = periksaProject();
  assert.equal(hasil.aman, false);
  assert.match(hasil.alasan, /projectlainlainlainxx/);
  assert.match(hasil.alasan, new RegExp(REF_ALYSSA));
});

test('client admin menolak dibuat untuk project lain', async () => {
  const { createAdminClient } = await muatDengan({
    SUPABASE_URL: 'https://projectlainlainlainxx.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'kunci-uji',
    SUPABASE_PROJECT_REF: REF_ALYSSA,
  });

  // Penolakan terjadi sebelum client terbentuk, jadi tidak ada satu pun query
  // yang sempat terkirim ke project yang salah.
  assert.throws(() => createAdminClient(), /hanya\s+"abcdefghijklmnopqrst"/);
});

test('client publik juga ditolak untuk project lain', async () => {
  const { createPublicClient } = await muatDengan({
    SUPABASE_URL: 'https://projectlainlainlainxx.supabase.co',
    SUPABASE_ANON_KEY: 'kunci-uji',
    SUPABASE_PROJECT_REF: REF_ALYSSA,
  });

  assert.throws(() => createPublicClient(), /project lain/);
});

test('URL yang tidak berbentuk project Supabase ditolak saat sasaran dikunci', async () => {
  const { periksaProject } = await muatDengan({
    SUPABASE_URL: 'https://contoh.example.com',
    SUPABASE_PROJECT_REF: REF_ALYSSA,
  });

  const hasil = periksaProject();
  assert.equal(hasil.aman, false);
  assert.match(hasil.alasan, /tidak bisa\s+dibaca/);
});

test('tanpa SUPABASE_PROJECT_REF sasaran tidak dikunci, supaya uji lokal tetap bisa jalan', async () => {
  const { periksaProject, createAdminClient } = await muatDengan({
    SUPABASE_URL: 'http://localhost:3010',
    SUPABASE_SERVICE_ROLE_KEY: 'kunci-uji',
    SUPABASE_PROJECT_REF: undefined,
  });

  assert.equal(periksaProject().aman, true);
  assert.doesNotThrow(() => createAdminClient());
});

test('project ref dibaca dari URL', async () => {
  const { projectRef } = await muatDengan({ SUPABASE_URL: URL_ALYSSA });
  assert.equal(projectRef(), REF_ALYSSA);
  assert.equal(projectRef('https://lainlainlainlainxxxx.supabase.co'), 'lainlainlainlainxxxx');
  assert.equal(projectRef('bukan url'), null);
});

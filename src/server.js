import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const akar = join(dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.use(express.json({ limit: '1mb' }));
app.use(express.static(join(akar, 'public')));

// Dipakai Railway untuk memastikan container sudah siap. Sengaja tidak
// menyentuh database supaya tetap menjawab walau Supabase sedang bermasalah.
app.get('/healthz', (_req, res) => res.json({ ok: true, waktu: new Date().toISOString() }));

// API dimuat belakangan supaya kredensial yang belum diisi menghasilkan pesan
// yang jelas, bukan tumpukan stack trace saat proses baru menyala.
const kurang = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !process.env[k]);
if (kurang.length > 0) {
  console.error(`\nKredensial belum lengkap: ${kurang.join(', ')}.`);
  console.error('Isi di file .env (lokal) atau Railway -> Variables (deploy).');
  console.error('Server tetap menyala, tapi semua endpoint /api akan menjawab 503.\n');

  app.use('/api', (_req, res) =>
    res.status(503).json({ pesan: `Kredensial Supabase belum diisi: ${kurang.join(', ')}.` })
  );
} else {
  // Sasaran diperiksa sebelum satu pun query dikirim. Kalau kredensialnya
  // menunjuk ke project lain, /api mati total dan alasannya dicetak — jauh
  // lebih baik daripada aplikasi menyala lalu menulis ke database yang salah.
  const { periksaProject } = await import('./supabase.js');
  const sasaran = periksaProject();

  if (!sasaran.aman) {
    console.error(`\nSASARAN SUPABASE SALAH: ${sasaran.alasan}\n`);
    app.use('/api', (_req, res) => res.status(503).json({ pesan: sasaran.alasan }));
  } else {
    console.log(
      sasaran.diharapkan
        ? `Supabase project: ${sasaran.ref} (cocok dengan SUPABASE_PROJECT_REF)`
        : `Supabase project: ${sasaran.ref ?? 'tidak dikenali'} ` +
          '(SUPABASE_PROJECT_REF belum diisi, sasaran tidak dikunci)'
    );
    const { default: api } = await import('./api.js');
    app.use('/api', api);
  }
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ pesan: error.message ?? 'Terjadi kesalahan di server.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Alyssa Auto Logistik jalan di port ${port}`));

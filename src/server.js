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

// Tabel yang belum dibuat adalah satu-satunya kegagalan yang penyebabnya ada di
// luar aplikasi dan obatnya satu langkah pasti. Pesan mentah PostgREST untuk
// kasus ini ("Could not find the table ... in the schema cache") menyuruh
// pembacanya menebak, jadi diterjemahkan menjadi instruksi.
//
// Dibedakan antara tabel yang memang belum ada dan skema yang tertinggal satu
// migration. Keduanya sama-sama disembuhkan oleh setup-lengkap.sql, tetapi
// mengatakan "tabelnya belum dibuat" kepada pemilik database yang berisi
// ribuan transaksi terbaca seperti datanya hilang.
function skemaBelumSiap(error) {
  const kode = error?.code;
  const pesan = String(error?.message ?? '');

  if (kode === 'PGRST205' || kode === '42P01' ||
      /relation ".*" does not exist/i.test(pesan)) {
    return 'Database belum disiapkan: tabelnya belum dibuat.';
  }

  // Kolom atau fungsi yang belum ada: tabelnya sudah berisi, hanya skemanya
  // yang tertinggal dari kode yang baru ter-deploy.
  if (kode === 'PGRST204' || kode === '42703' || kode === '42883' ||
      /schema cache/i.test(pesan) ||
      /column .* does not exist/i.test(pesan) ||
      /function .* does not exist/i.test(pesan)) {
    return 'Database belum diperbarui: skemanya tertinggal dari versi aplikasi ' +
           'yang sedang jalan. Data lama tetap utuh.';
  }

  return null;
}

app.use((error, _req, res, _next) => {
  console.error(error);

  const sebab = skemaBelumSiap(error);
  if (sebab) {
    return res.status(503).json({
      pesan:
        `${sebab} Jalankan isi berkas supabase/setup-lengkap.sql sekali di ` +
        'Supabase SQL Editor, lalu muat ulang halaman ini.',
      rincian: error.message,
    });
  }

  res.status(500).json({ pesan: error.message ?? 'Terjadi kesalahan di server.' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Alyssa Auto Logistik jalan di port ${port}`));

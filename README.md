# Felis-Alyssa

Koneksi Supabase untuk Alyssa Auto Logistik.

## Cara pakai

### 1. Isi kredensial

```bash
cp .env.example .env
```

Ambil nilainya dari **Supabase Dashboard → Project Settings → API**:

| Variabel | Ambil dari | Aman di browser? |
|---|---|---|
| `SUPABASE_URL` | Project URL | ya |
| `SUPABASE_ANON_KEY` | Project API keys → `anon` `public` | ya |
| `SUPABASE_SERVICE_ROLE_KEY` | Project API keys → `service_role` | **TIDAK** |

`service_role` menembus Row Level Security. Kunci ini hanya boleh ada di
server atau di env var Railway — jangan pernah masuk ke kode frontend.

`.env` sudah masuk `.gitignore`, jadi tidak akan ikut ter-commit.

### 2. Pastikan nyambung

```bash
npm run check
```

Script ini tidak butuh `npm install` dan tidak menulis apa pun ke database.
Outputnya:

- **project ref** yang sedang dituju — cocokkan dengan project di dashboard,
  supaya yakin tidak nembak database yang salah
- daftar tabel yang ter-expose lewat API

Kalau project ref-nya beda dari yang kamu maksud, berarti `.env`-nya salah
tunjuk. Betulkan dulu sebelum lanjut.

### 3. Pakai di kode

```bash
npm install
```

```js
import { createPublicClient } from './src/supabase.js';

const supabase = createPublicClient();
const { data, error } = await supabase.from('nama_tabel').select('*');
```

Untuk operasi yang butuh menembus RLS, pakai `createAdminClient()` — dan hanya
dari sisi server.

## Deploy ke Railway

Isi ketiga variabel di **Railway → project → Variables**. Jangan meng-commit
`.env`; Railway membaca dari Variables, bukan dari file.

## Struktur

```
.env.example           contoh kredensial (aman di-commit)
src/supabase.js        client publik & admin
scripts/health-check.js  cek koneksi, tanpa dependency
```

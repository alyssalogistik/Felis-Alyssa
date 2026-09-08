import { Router } from 'express';
import { createAdminClient } from './supabase.js';
import rekonsiliasi from './rekonsiliasi/api.js';

const db = createAdminClient();

const STATUS_PESANAN = ['baru', 'dispatched', 'on_trip', 'selesai', 'batal'];

/** Kolom yang boleh diisi klien. Sisanya (no_resi, stempel waktu) diatur database. */
const KOLOM_PESANAN = [
  'customer_nama', 'customer_telepon', 'penerima_nama', 'penerima_telepon',
  'unit_merk', 'unit_tipe', 'unit_nopol', 'unit_tahun', 'unit_warna',
  'asal', 'tujuan', 'status', 'trip_id', 'harga', 'catatan',
];

/** Ambil hanya kolom yang dikenal, supaya field asing dari klien tidak ikut tertulis. */
function saring(body, kolom) {
  const hasil = {};
  for (const nama of kolom) {
    if (body[nama] !== undefined) hasil[nama] = body[nama];
  }
  return hasil;
}

/** Bungkus handler async supaya error-nya sampai ke penanganan error Express. */
function jalur(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

const api = Router();

// --- Ringkasan untuk dashboard ---------------------------------------------

api.get('/ringkasan', jalur(async (_req, res) => {
  // Satu query kecil per status lebih murah daripada menarik semua baris hanya
  // untuk dihitung di aplikasi.
  const hitung = await Promise.all(
    STATUS_PESANAN.map(async (status) => {
      const { count, error } = await db
        .from('pesanan')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw error;
      return [status, count ?? 0];
    })
  );

  const per_status = Object.fromEntries(hitung);
  res.json({
    total: Object.values(per_status).reduce((a, b) => a + b, 0),
    per_status,
  });
}));

// --- Pesanan ----------------------------------------------------------------

api.get('/pesanan', jalur(async (req, res) => {
  const batas = Math.min(Number(req.query.batas) || 25, 100);
  const mulai = Math.max(Number(req.query.mulai) || 0, 0);

  let query = db
    .from('pesanan')
    .select('*', { count: 'exact' })
    .order('dibuat_pada', { ascending: false })
    .range(mulai, mulai + batas - 1);

  if (req.query.status) query = query.eq('status', req.query.status);

  if (req.query.cari) {
    const kata = `%${req.query.cari}%`;
    query = query.or(
      `no_resi.ilike.${kata},customer_nama.ilike.${kata},` +
      `unit_merk.ilike.${kata},unit_tipe.ilike.${kata},unit_nopol.ilike.${kata}`
    );
  }

  const { data, count, error } = await query;
  if (error) throw error;
  res.json({ data, total: count ?? 0, batas, mulai });
}));

api.get('/pesanan/:id', jalur(async (req, res) => {
  const { data, error } = await db
    .from('pesanan')
    .select('*, trip(*, kapal(*), driver(*)), tracking_event(*), invoice(*)')
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Pesanan tidak ditemukan.' });
  res.json(data);
}));

api.post('/pesanan', jalur(async (req, res) => {
  const baru = saring(req.body ?? {}, KOLOM_PESANAN);

  const wajib = ['customer_nama', 'unit_merk', 'asal', 'tujuan'];
  const kurang = wajib.filter((k) => !baru[k]);
  if (kurang.length > 0) {
    return res.status(400).json({ pesan: `Wajib diisi: ${kurang.join(', ')}.` });
  }
  if (baru.status && !STATUS_PESANAN.includes(baru.status)) {
    return res.status(400).json({ pesan: `Status harus salah satu dari: ${STATUS_PESANAN.join(', ')}.` });
  }

  const { data, error } = await db.from('pesanan').insert(baru).select().single();
  if (error) throw error;
  res.status(201).json(data);
}));

api.patch('/pesanan/:id', jalur(async (req, res) => {
  const ubahan = saring(req.body ?? {}, KOLOM_PESANAN);
  if (Object.keys(ubahan).length === 0) {
    return res.status(400).json({ pesan: 'Tidak ada kolom yang diubah.' });
  }
  if (ubahan.status && !STATUS_PESANAN.includes(ubahan.status)) {
    return res.status(400).json({ pesan: `Status harus salah satu dari: ${STATUS_PESANAN.join(', ')}.` });
  }

  const { data, error } = await db
    .from('pesanan')
    .update(ubahan)
    .eq('id', req.params.id)
    .select()
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Pesanan tidak ditemukan.' });
  res.json(data);
}));

// --- Lacak resi -------------------------------------------------------------

api.get('/lacak/:no_resi', jalur(async (req, res) => {
  const { data, error } = await db
    .from('pesanan')
    .select('no_resi, customer_nama, unit_merk, unit_tipe, asal, tujuan, status, tracking_event(status, lokasi, catatan, dibuat_pada)')
    .eq('no_resi', req.params.no_resi.toUpperCase())
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Nomor resi tidak ditemukan.' });

  data.tracking_event.sort((a, b) => new Date(b.dibuat_pada) - new Date(a.dibuat_pada));
  res.json(data);
}));

// --- Master data ------------------------------------------------------------

for (const tabel of ['kapal', 'driver']) {
  api.get(`/${tabel}`, jalur(async (_req, res) => {
    const { data, error } = await db.from(tabel).select('*').order('nama');
    if (error) throw error;
    res.json({ data });
  }));
}

api.get('/trip', jalur(async (_req, res) => {
  const { data, error } = await db
    .from('trip')
    .select('*, kapal(nama, kode), driver(nama)')
    .order('dibuat_pada', { ascending: false })
    .limit(50);
  if (error) throw error;
  res.json({ data });
}));

api.use('/rekonsiliasi', rekonsiliasi);

export default api;

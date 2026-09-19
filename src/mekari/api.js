// Endpoint Audit Data Mekari.
//
// Berkas yang diunggah diurai lalu dibuang; hanya hasil uraiannya yang
// disimpan, dan isinya tidak pernah ditulis ke log — log adalah tempat data
// pembelian paling mudah bocor tanpa disadari.
//
// Modul ini tidak menyentuh satu pun tabel rekonsiliasi. Yang dipakai bersama
// hanya pembaca berkas, pengurai nilai, dan aturan entitas — ketiganya dibaca,
// tidak diubah.

import { Router } from 'express';
import express from 'express';
import { createHash } from 'node:crypto';
import { createAdminClient } from '../supabase.js';
import { GalatFormat } from '../rekonsiliasi/parser.js';
import { kodeEntitas, labelEntitas, saringanEntitas } from '../rekonsiliasi/entitas.js';
import { bacaMekari, ringkasMekari, BATAS_UKURAN } from './baca.js';
import { hitungTemuan, AMBANG_BAWAAN } from './temuan.js';
import { pengenalTersimpan } from './pengenal.js';

const db = createAdminClient();

/** Jumlah baris per sekali insert; batch raksasa ditolak PostgREST. */
const UKURAN_BATCH = 500;

/** Kolom baris mentah yang dikirim ke layar. */
const KOLOM_BARIS =
  'id, impor_id, entitas, baris_sumber, berkas_sumber, supplier, tanggal, tanggal_ambigu, ' +
  'jenis_transaksi, no_invoice, produk, keterangan, kuantitas, satuan, harga, jumlah, ' +
  'masalah, kembar_ke, sidik';

const STATUS_PERIKSA = ['BELUM', 'WAJAR', 'PERLU_TINDAK_LANJUT', 'TERKONFIRMASI_DUPLIKAT'];

function jalur(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

/**
 * Entitas sebuah unggahan. WAJIB, tanpa nilai bawaan.
 *
 * Sama seperti rekening koran: bawaan yang diam-diam dipakai ketika pilihannya
 * lupa dikirim akan menandai pembelian CV sebagai milik PT, dan kekeliruan itu
 * tidak menimbulkan galat apa pun sampai angka auditnya dipakai.
 */
function entitasUnggahan(req) {
  return kodeEntitas(req.get('X-Entitas') ?? req.query.entitas ?? '');
}

/**
 * Entitas pada PENYARINGAN. Tidak memilih apa pun sah dan berarti "Semua",
 * tetapi nilai yang tidak dikenali ditolak 400 — salah ketik yang diam-diam
 * berarti seluruh perusahaan akan memunculkan pembelian perusahaan lain tanpa
 * gejala apa pun.
 */
function saringEntitas(req, res) {
  const hasil = saringanEntitas(req.query.entitas);
  if (!hasil.ok) {
    res.status(400).json({
      pesan: `Pilihan perusahaan "${req.query.entitas}" tidak dikenali.`,
      kode: 'entitas_tidak_dikenali',
    });
    return undefined;
  }
  return hasil.kode;
}

const api = Router();

// --- Unggah -----------------------------------------------------------------

api.post(
  '/unggah',
  express.raw({ type: () => true, limit: BATAS_UKURAN }),
  jalur(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ pesan: 'Tidak ada berkas yang diterima.' });
    }

    let namaBerkas = 'mekari';
    try {
      namaBerkas = decodeURIComponent(req.get('X-Nama-Berkas') ?? '') || namaBerkas;
    } catch {
      // Header cacat bukan alasan menggagalkan unggahan.
    }

    // Diperiksa SEBELUM berkasnya diurai: menolak sesudah penguraian hanya
    // membuang waktu pemakainya untuk kesalahan yang sudah bisa diketahui.
    const entitas = entitasUnggahan(req);
    if (entitas === null) {
      return res.status(400).json({
        pesan:
          'Pilih dulu pembelian ini milik siapa: PT Alyssa Auto Logistik atau ' +
          'CV Alyssa Trans Utama.',
        kode: 'entitas_wajib',
      });
    }

    let hasil;
    try {
      hasil = await bacaMekari(buffer, namaBerkas);
    } catch (error) {
      if (error instanceof GalatFormat) return res.status(422).json({ pesan: error.message });
      throw error;
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    const ringkasan = ringkasMekari(hasil.transaksi);

    const tanggal = hasil.transaksi.map((t) => t.tanggal).filter(Boolean).sort();

    // Berkas yang sama pernah diunggah? Beri tahu, jangan diam-diam menggandakan.
    const { data: sebelumnya, error: galatCek } = await db
      .from('mekari_impor')
      .select('id, nama_berkas, entitas, diunggah_pada')
      .eq('hash_berkas', hash)
      .limit(1);
    if (galatCek) throw galatCek;

    const { data: impor, error: galatImpor } = await db
      .from('mekari_impor')
      .insert({
        nama_berkas: namaBerkas,
        hash_berkas: hash,
        entitas,
        sheet: hasil.sheet,
        baris_header: hasil.barisHeader,
        periode_mulai: tanggal[0] ?? null,
        periode_selesai: tanggal.at(-1) ?? null,
        jumlah_baris: ringkasan.total,
        jumlah_bermasalah: ringkasan.bermasalah,
        nilai: ringkasan.nilai,
      })
      .select()
      .single();
    if (galatImpor) throw galatImpor;

    const baris = hasil.transaksi.map((t) => ({
      impor_id: impor.id,
      entitas,
      baris_sumber: t.baris_sumber,
      berkas_sumber: t.berkas_sumber,
      supplier: t.supplier,
      tanggal: t.tanggal,
      tanggal_ambigu: t.tanggal_ambigu,
      jenis_transaksi: t.jenis_transaksi,
      no_invoice: t.no_invoice,
      produk: t.produk,
      keterangan: t.keterangan,
      kuantitas: t.kuantitas,
      satuan: t.satuan,
      harga: t.harga,
      jumlah: t.jumlah,
      masalah: t.masalah,
      kembar_ke: t.kembar_ke,
    }));

    // upsert dengan ignoreDuplicates menghasilkan ON CONFLICT DO NOTHING: baris
    // yang sidiknya sudah ada dilewati, bukan ditimpa. Data Mekari yang sudah
    // tersimpan tidak pernah tertimpa unggahan berikutnya. Jumlah yang
    // benar-benar tersisip dibaca dari yang dikembalikan database.
    let jumlahBaru = 0;
    for (let i = 0; i < baris.length; i += UKURAN_BATCH) {
      const { data: tersisip, error } = await db
        .from('mekari_baris')
        .upsert(baris.slice(i, i + UKURAN_BATCH), { onConflict: 'sidik', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      jumlahBaru += tersisip?.length ?? 0;
    }

    const sudahAda = baris.length - jumlahBaru;
    const status = jumlahBaru === 0 ? 'duplikat' : sudahAda > 0 ? 'sebagian' : 'selesai';

    const { data: riwayat } = await db
      .from('mekari_impor')
      .update({ jumlah_baru: jumlahBaru, jumlah_sudah_ada: sudahAda, status })
      .eq('id', impor.id)
      .select()
      .maybeSingle();

    // Mesin dijalankan atas SELURUH baris entitas ini, bukan hanya unggahan
    // barusan. Sepasang tagihan ganda bisa terpisah di dua ekspor berbeda —
    // membandingkan unggahan baru dengan dirinya sendiri saja akan
    // melewatkannya sepenuhnya.
    const audit = await hitungUlang(entitas, ambangDari(req.query.ambang));

    res.status(201).json({
      impor: riwayat ?? impor,
      ringkasan: { ...ringkasan, baru: jumlahBaru, sudah_ada: sudahAda },
      sheet: hasil.sheet,
      status,
      entitas,
      entitas_label: labelEntitas(entitas),
      periode: { mulai: tanggal[0] ?? null, selesai: tanggal.at(-1) ?? null },
      kolom_terdeteksi: Object.keys(hasil.peta),
      pernah_diunggah: sebelumnya?.[0] ?? null,
      audit,
    });
  })
);

function ambangDari(nilai) {
  const n = Number(nilai);
  return Number.isFinite(n) && n > 0 ? n : AMBANG_BAWAAN;
}

/**
 * Menjalankan ulang ekstraksi dan mesin temuan untuk satu entitas.
 *
 * Ekstraksi dan temuan dihapus lalu ditulis ulang seluruhnya — keduanya bisa
 * dibangun ulang dari mekari_baris, jadi tidak ada yang hilang. Yang TIDAK
 * ikut terhapus adalah mekari_periksa: hasil pemeriksaan manusia dihubungkan
 * lewat kunci_stabil dan tidak punya kunci asing ke sini, justru supaya
 * perhitungan ulang tidak pernah menghapus pekerjaan orang.
 */
async function hitungUlang(entitas, ambang = AMBANG_BAWAAN) {
  const baris = [];
  const HALAMAN = 1000;
  for (let mulai = 0; ; mulai += HALAMAN) {
    const { data, error } = await db
      .from('mekari_baris')
      .select(KOLOM_BARIS)
      .eq('entitas', entitas)
      .order('baris_sumber', { ascending: true })
      .range(mulai, mulai + HALAMAN - 1);
    if (error) throw error;
    baris.push(...(data ?? []));
    if (!data || data.length < HALAMAN) break;
  }

  const hasil = hitungTemuan(baris, { ambang });

  const { error: galatHapusPengenal } = await db
    .from('mekari_pengenal')
    .delete()
    .eq('entitas', entitas);
  if (galatHapusPengenal) throw galatHapusPengenal;

  const { error: galatHapusTemuan } = await db
    .from('mekari_temuan')
    .delete()
    .eq('entitas', entitas);
  if (galatHapusTemuan) throw galatHapusTemuan;

  // Dipakai baris milik mesin, bukan baris mentah: kejarangan sebuah token
  // hanya bisa dinilai atas seluruh entitas sekaligus, dan mesinlah yang sudah
  // menilainya. Menghitung ulang di sini akan menghasilkan ambang yang sama
  // tetapi dua tempat yang bisa menyimpang.
  const pengenal = [];
  for (const b of hasil.baris) {
    for (const p of pengenalTersimpan(b)) {
      pengenal.push({ baris_id: b.id, entitas, nilai: p.nilai, konteks: p.konteks });
    }
  }
  for (let i = 0; i < pengenal.length; i += UKURAN_BATCH) {
    const { error } = await db.from('mekari_pengenal').insert(pengenal.slice(i, i + UKURAN_BATCH));
    if (error) throw error;
  }

  const temuan = hasil.temuan.map((t) => ({
    entitas,
    kunci_stabil: t.kunci_stabil,
    baris_a: t.a.id,
    baris_b: t.b.id,
    skor: t.skor,
    alasan: t.alasan,
    ringkasan_alasan: t.ringkasan_alasan,
    nilai_berisiko: t.nilai_berisiko,
  }));
  for (let i = 0; i < temuan.length; i += UKURAN_BATCH) {
    const { error } = await db.from('mekari_temuan').insert(temuan.slice(i, i + UKURAN_BATCH));
    if (error) throw error;
  }

  return {
    ambang,
    baris: baris.length,
    temuan: temuan.length,
    kelompok: hasil.kelompok,
    diperiksa: hasil.diperiksa,
    pasangan_mungkin: hasil.pasangan_mungkin,
    ambang_jarang: hasil.ambang_jarang,
  };
}

// --- Hitung ulang atas permintaan -------------------------------------------

api.post('/hitung', jalur(async (req, res) => {
  const entitas = kodeEntitas(req.body?.entitas ?? req.query.entitas ?? '');
  if (entitas === null) {
    return res.status(400).json({
      pesan: 'Pilih dulu perusahaan yang mau dihitung ulang.',
      kode: 'entitas_wajib',
    });
  }
  const hasil = await hitungUlang(entitas, ambangDari(req.body?.ambang ?? req.query.ambang));
  res.json({ entitas, entitas_label: labelEntitas(entitas), ...hasil });
}));

// --- Dasbor ------------------------------------------------------------------

api.get('/ringkasan', jalur(async (req, res) => {
  const entitas = saringEntitas(req, res);
  if (entitas === undefined) return undefined;

  const { data, error } = await db.rpc('ringkasan_mekari', { p_entitas: entitas });
  if (error) throw error;

  const r = Array.isArray(data) ? data[0] : data;
  res.json({
    entitas,
    entitas_label: entitas ? labelEntitas(entitas) : 'Semua perusahaan',
    transaksi: Number(r?.transaksi ?? 0),
    nilai: Number(r?.nilai ?? 0),
    supplier: Number(r?.supplier ?? 0),
    produk: Number(r?.produk ?? 0),
    invoice: Number(r?.invoice ?? 0),
    temuan: Number(r?.temuan ?? 0),
    nilai_berisiko: Number(r?.nilai_berisiko ?? 0),
    belum_diperiksa: Number(r?.belum_diperiksa ?? 0),
  });
}));

// --- Daftar temuan -----------------------------------------------------------

api.get('/temuan', jalur(async (req, res) => {
  const entitas = saringEntitas(req, res);
  if (entitas === undefined) return undefined;

  const batas = Math.min(Number(req.query.batas) || 50, 200);
  const mulai = Math.max(Number(req.query.mulai) || 0, 0);

  let query = db
    .from('mekari_temuan_periksa')
    .select('*', { count: 'exact' })
    .order('skor', { ascending: false })
    .order('nilai_berisiko', { ascending: false })
    .range(mulai, mulai + batas - 1);

  if (entitas) query = query.eq('entitas', entitas);

  if (req.query.status) {
    const status = String(req.query.status).toUpperCase();
    if (!STATUS_PERIKSA.includes(status)) {
      return res.status(400).json({ pesan: `Status "${req.query.status}" tidak dikenali.` });
    }
    query = query.eq('status', status);
  }

  const { data, count, error } = await query;
  if (error) throw error;

  // Kedua barisnya diambil sekaligus supaya layar tidak menembak satu
  // permintaan per temuan.
  const idBaris = [...new Set((data ?? []).flatMap((t) => [t.baris_a, t.baris_b]))];
  const peta = new Map();
  for (let i = 0; i < idBaris.length; i += UKURAN_BATCH) {
    const { data: baris, error: galatBaris } = await db
      .from('mekari_baris')
      .select(KOLOM_BARIS)
      .in('id', idBaris.slice(i, i + UKURAN_BATCH));
    if (galatBaris) throw galatBaris;
    for (const b of baris ?? []) peta.set(b.id, b);
  }

  res.json({
    data: (data ?? []).map((t) => ({ ...t, a: peta.get(t.baris_a) ?? null, b: peta.get(t.baris_b) ?? null })),
    total: count ?? 0,
    batas,
    mulai,
    entitas,
  });
}));

api.get('/temuan/:id', jalur(async (req, res) => {
  const { data: temuan, error } = await db
    .from('mekari_temuan_periksa')
    .select('*')
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) throw error;
  if (!temuan) return res.status(404).json({ pesan: 'Temuan tidak ditemukan.' });

  const { data: baris, error: galatBaris } = await db
    .from('mekari_baris')
    .select(KOLOM_BARIS)
    .in('id', [temuan.baris_a, temuan.baris_b]);
  if (galatBaris) throw galatBaris;

  const { data: pengenal } = await db
    .from('mekari_pengenal')
    .select('baris_id, nilai, konteks')
    .in('baris_id', [temuan.baris_a, temuan.baris_b]);

  const peta = new Map((baris ?? []).map((b) => [b.id, b]));
  res.json({
    ...temuan,
    a: peta.get(temuan.baris_a) ?? null,
    b: peta.get(temuan.baris_b) ?? null,
    pengenal: pengenal ?? [],
  });
}));

// --- Hasil pemeriksaan manusia ----------------------------------------------

api.put('/periksa/:kunci', jalur(async (req, res) => {
  const status = String(req.body?.status ?? '').toUpperCase();
  if (!STATUS_PERIKSA.includes(status)) {
    return res.status(400).json({
      pesan: `Status harus salah satu dari: ${STATUS_PERIKSA.join(', ')}.`,
    });
  }

  // Entitasnya diambil dari temuannya sendiri, tidak dari yang dikirim klien —
  // status yang tersimpan di bawah entitas yang salah akan hilang dari daftar
  // perusahaan yang benar tanpa satu pun galat.
  const { data: temuan, error } = await db
    .from('mekari_temuan')
    .select('entitas')
    .eq('kunci_stabil', req.params.kunci)
    .maybeSingle();
  if (error) throw error;
  if (!temuan) return res.status(404).json({ pesan: 'Temuan tidak ditemukan.' });

  const { data, error: galatSimpan } = await db
    .from('mekari_periksa')
    .upsert(
      {
        kunci_stabil: req.params.kunci,
        entitas: temuan.entitas,
        status,
        catatan: req.body?.catatan ?? null,
        diperiksa_oleh: req.body?.diperiksa_oleh ?? 'Admin',
        diperiksa_pada: new Date().toISOString(),
      },
      { onConflict: 'kunci_stabil' }
    )
    .select()
    .single();
  if (galatSimpan) throw galatSimpan;

  res.json(data);
}));

// --- Riwayat unggahan --------------------------------------------------------

api.get('/impor', jalur(async (req, res) => {
  const entitas = saringEntitas(req, res);
  if (entitas === undefined) return undefined;

  let query = db
    .from('mekari_impor')
    .select('*')
    .order('diunggah_pada', { ascending: false })
    .limit(50);
  if (entitas) query = query.eq('entitas', entitas);

  const { data, error } = await query;
  if (error) throw error;
  res.json({ data: data ?? [] });
}));

export default api;

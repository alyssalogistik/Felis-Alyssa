// Endpoint Rekonsiliasi Bank.
//
// Berkas yang diunggah diurai lalu dibuang; hanya hasil uraiannya yang
// disimpan. Isi rekening koran tidak pernah ditulis ke log, karena log adalah
// tempat data keuangan paling mudah bocor tanpa disadari.

import { Router } from 'express';
import express from 'express';
import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { createAdminClient } from '../supabase.js';
import { bacaRekeningKoran, BATAS_UKURAN } from './baca.js';
import { GalatFormat, ringkasValidasi } from './parser.js';
import audit from './audit.js';

const db = createAdminClient();

/** Jumlah baris per sekali insert; batch raksasa ditolak PostgREST. */
const UKURAN_BATCH = 500;

const KOLOM_TRANSAKSI =
  'id, unggahan_id, baris_sumber, berkas_sumber, tanggal, tanggal_ambigu, keterangan, ' +
  'debit, kredit, saldo, referensi, status_data, masalah, duplikat, status_rekon, ' +
  'referensi_rekon, catatan_rekon, nominal_pembanding, selisih, direkon_pada, direkon_oleh';

function jalur(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

/**
 * Membungkus nilai untuk dipakai di dalam or() PostgREST.
 *
 * Nilai di dalam or() dipisah koma, jadi kata kunci yang mengandung koma atau
 * tanda kurung akan memecah query kalau tidak dikutip. Yang dilindungi di sini
 * adalah sintaks filternya; % dan _ sengaja dibiarkan sebagai wildcard supaya
 * perilakunya sama dengan ringkasan_transaksi_bank() di database.
 */
function kutip(nilai) {
  return `"${String(nilai).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Membaca kriteria filter dari query string, mengabaikan yang kosong. */
function kriteriaDari(query) {
  const angka = (nilai, min, maks) => {
    const n = Number(nilai);
    return nilai === undefined || nilai === '' || !Number.isInteger(n) || n < min || n > maks
      ? null
      : n;
  };
  const tanggal = (nilai) => (/^\d{4}-\d{2}-\d{2}$/.test(nilai ?? '') ? nilai : null);

  return {
    cari: typeof query.cari === 'string' ? query.cari.trim() : '',
    bulan: angka(query.bulan, 1, 12),
    tahun: angka(query.tahun, 1900, 2200),
    dari: tanggal(query.dari),
    sampai: tanggal(query.sampai),
    // Pertanyaan yang dijawab halaman audit adalah "supplier ini sudah saya
    // bayar belum", dan jawabannya hanya ada di uang keluar. Uang masuk yang
    // kebetulan menyebut nama yang sama justru menyesatkan.
    hanya_debit: query.hanya_debit === '1' || query.hanya_debit === 'true',
  };
}

/**
 * Menerapkan kriteria ke query PostgREST.
 *
 * Bulan dan tahun disamakan terhadap kolom turunan `bulan` dan `tahun`, bukan
 * dihitung dari tanggal saat query: selain terindeks, LIKE atau extract() pada
 * kolom bertipe date ditolak Postgres. Syaratnya disusun sama dengan
 * ringkasan_transaksi_bank() supaya daftar dan ringkasan tidak pernah
 * menghitung himpunan yang berbeda.
 */
function terapkanKriteria(query, { cari, bulan, tahun, dari, sampai, hanya_debit }) {
  if (cari) {
    const pola = kutip(`%${cari}%`);
    query = query.or(`keterangan.ilike.${pola},referensi.ilike.${pola}`);
  }
  if (bulan !== null) query = query.eq('bulan', bulan);
  if (tahun !== null) query = query.eq('tahun', tahun);
  if (dari) query = query.gte('tanggal', dari);
  if (sampai) query = query.lte('tanggal', sampai);
  if (hanya_debit) query = query.gt('debit', 0);
  return query;
}

const api = Router();

// --- Unggah ----------------------------------------------------------------

// Berkas dikirim sebagai badan mentah, bukan multipart. Formatnya cukup untuk
// satu berkas dan tidak menambah pustaka pengurai multipart baru.
api.post(
  '/unggah',
  express.raw({ type: () => true, limit: BATAS_UKURAN }),
  jalur(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ pesan: 'Tidak ada berkas yang diterima.' });
    }

    let namaBerkas = 'rekening-koran';
    try {
      namaBerkas = decodeURIComponent(req.get('X-Nama-Berkas') ?? '') || namaBerkas;
    } catch {
      // Header cacat bukan alasan menggagalkan unggahan; nama bawaan sudah cukup.
    }

    let hasil;
    try {
      hasil = await bacaRekeningKoran(buffer, namaBerkas);
    } catch (error) {
      if (error instanceof GalatFormat) return res.status(422).json({ pesan: error.message });
      throw error;
    }

    const hash = createHash('sha256').update(buffer).digest('hex');
    const ringkasan = ringkasValidasi(hasil.transaksi);

    // Berkas yang sama pernah diunggah? Beri tahu, jangan diam-diam menggandakan.
    const { data: sebelumnya, error: galatCek } = await db
      .from('unggahan_rekening_koran')
      .select('id, nama_berkas, diunggah_pada')
      .eq('hash_berkas', hash)
      .limit(1);
    if (galatCek) throw galatCek;

    const { data: unggahan, error: galatUnggahan } = await db
      .from('unggahan_rekening_koran')
      .insert({
        nama_berkas: namaBerkas,
        hash_berkas: hash,
        sheet: hasil.sheet,
        baris_header: hasil.barisHeader,
        jumlah_transaksi: ringkasan.total,
        jumlah_valid: ringkasan.valid,
        jumlah_perlu_diperiksa: ringkasan.perlu_diperiksa,
        jumlah_duplikat: ringkasan.duplikat,
        jumlah_tanggal_ambigu: ringkasan.tanggal_ambigu,
      })
      .select()
      .single();
    if (galatUnggahan) throw galatUnggahan;

    const baris = hasil.transaksi.map((t) => ({
      unggahan_id: unggahan.id,
      baris_sumber: t.baris_sumber,
      berkas_sumber: t.berkas_sumber,
      tanggal: t.tanggal,
      tanggal_ambigu: t.tanggal_ambigu,
      keterangan: t.keterangan,
      debit: t.debit,
      kredit: t.kredit,
      saldo: t.saldo,
      referensi: t.referensi,
      status_data: t.status_data,
      masalah: t.masalah,
      duplikat: t.duplikat,
    }));

    for (let i = 0; i < baris.length; i += UKURAN_BATCH) {
      const { error } = await db.from('transaksi_bank').insert(baris.slice(i, i + UKURAN_BATCH));
      if (error) throw error;
    }

    // Buffer dilepas di sini; berkas aslinya tidak pernah ditulis ke disk.
    res.status(201).json({
      unggahan,
      ringkasan,
      sheet: hasil.sheet,
      kolom_terdeteksi: Object.keys(hasil.peta),
      pernah_diunggah: sebelumnya?.[0] ?? null,
    });
  })
);

// --- Daftar transaksi + ringkasan ------------------------------------------

api.get('/transaksi', jalur(async (req, res) => {
  const kriteria = kriteriaDari(req.query);
  const batas = Math.min(Math.max(Number(req.query.batas) || 50, 1), 200);
  const mulai = Math.max(Number(req.query.mulai) || 0, 0);

  let query = db
    .from('transaksi_bank')
    .select(KOLOM_TRANSAKSI, { count: 'exact' })
    .order('tanggal', { ascending: false, nullsFirst: false })
    .order('baris_sumber', { ascending: true })
    .range(mulai, mulai + batas - 1);

  const { data, count, error } = await terapkanKriteria(query, kriteria);
  if (error) throw error;

  // Ringkasan dihitung di database atas seluruh hasil filter, bukan atas satu
  // halaman yang sedang tampil.
  //
  // hanya_debit sengaja TIDAK diteruskan ke fungsi ringkasan, dan itu bukan
  // kelalaian: baris kredit menyumbang debit nol, sehingga total debitnya sama
  // persis dengan atau tanpa penyaringan itu. Jumlah barisnya berbeda, dan
  // untuk itu dipakai `total` dari hitungan kueri di atas yang memang sudah
  // tersaring. Menambah parameter ke fungsinya hanya akan menuntut migration
  // tanpa mengubah satu angka pun.
  const { data: ringkasan, error: galatRingkasan } = await db.rpc('ringkasan_transaksi_bank', {
    p_cari: kriteria.cari || null,
    p_bulan: kriteria.bulan,
    p_tahun: kriteria.tahun,
    p_dari: kriteria.dari,
    p_sampai: kriteria.sampai,
  });
  if (galatRingkasan) throw galatRingkasan;

  res.json({
    data,
    total: count ?? 0,
    batas,
    mulai,
    ringkasan: ringkasan?.[0] ?? { jumlah: 0, debit: 0, kredit: 0, net: 0 },
  });
}));

api.get('/transaksi/:id', jalur(async (req, res) => {
  const { data, error } = await db
    .from('transaksi_bank')
    .select(`${KOLOM_TRANSAKSI}, unggahan_rekening_koran(nama_berkas, sheet, diunggah_pada)`)
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });
  res.json(data);
}));

// --- Rekon -----------------------------------------------------------------

api.post('/transaksi/:id/rekon', jalur(async (req, res) => {
  const { referensi_rekon, catatan_rekon, nominal_pembanding, batalkan } = req.body ?? {};

  if (batalkan) {
    const { data, error } = await db
      .from('transaksi_bank')
      .update({
        status_rekon: 'belum',
        referensi_rekon: null,
        catatan_rekon: null,
        nominal_pembanding: null,
        direkon_oleh: null,
      })
      .eq('id', req.params.id)
      .select(KOLOM_TRANSAKSI)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });
    return res.json(data);
  }

  let pembanding = null;
  if (nominal_pembanding !== undefined && nominal_pembanding !== null && nominal_pembanding !== '') {
    pembanding = Number(nominal_pembanding);
    if (!Number.isFinite(pembanding) || pembanding < 0) {
      return res.status(400).json({ pesan: 'Nominal pembanding harus angka tidak negatif.' });
    }
  }

  const ubahan = {
    referensi_rekon: referensi_rekon?.trim() || null,
    catatan_rekon: catatan_rekon?.trim() || null,
    nominal_pembanding: pembanding,
    // Belum ada authentication, jadi pelakunya belum bisa dipastikan. Kolomnya
    // sudah disiapkan agar tidak perlu migrasi lagi saat login ditambahkan.
    direkon_oleh: null,
  };
  // Tanpa pembanding, kecocokan dinyatakan manusia. Dengan pembanding, trigger
  // di database yang memutuskan cocok atau selisih.
  if (pembanding === null) ubahan.status_rekon = 'sudah';

  const { data, error } = await db
    .from('transaksi_bank')
    .update(ubahan)
    .eq('id', req.params.id)
    .select(KOLOM_TRANSAKSI)
    .maybeSingle();

  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });
  res.json(data);
}));

// --- Riwayat unggahan ------------------------------------------------------

api.get('/unggahan', jalur(async (_req, res) => {
  const { data, error } = await db
    .from('unggahan_rekening_koran')
    .select('*')
    .order('diunggah_pada', { ascending: false })
    .limit(20);
  if (error) throw error;
  res.json({ data });
}));

// --- Ekspor ----------------------------------------------------------------

api.get('/ekspor', jalur(async (req, res) => {
  const kriteria = kriteriaDari(req.query);

  // Ekspor mengikuti filter yang sedang aktif, bukan seluruh rekening koran.
  let query = db
    .from('transaksi_bank')
    .select(KOLOM_TRANSAKSI)
    .order('tanggal', { ascending: true, nullsFirst: false })
    .order('baris_sumber', { ascending: true })
    .limit(20000);

  const { data, error } = await terapkanKriteria(query, kriteria);
  if (error) throw error;

  const buku = new ExcelJS.Workbook();
  const sheet = buku.addWorksheet('Rekonsiliasi');

  sheet.columns = [
    { header: 'Tanggal',      key: 'tanggal',      width: 12 },
    { header: 'Keterangan',   key: 'keterangan',   width: 46 },
    { header: 'Debit',        key: 'debit',        width: 16 },
    { header: 'Kredit',       key: 'kredit',       width: 16 },
    { header: 'Saldo',        key: 'saldo',        width: 16 },
    { header: 'Referensi',    key: 'referensi',    width: 18 },
    { header: 'Status Rekon', key: 'status_rekon', width: 14 },
    { header: 'Ref. Rekon',   key: 'referensi_rekon', width: 18 },
    { header: 'Pembanding',   key: 'nominal_pembanding', width: 16 },
    { header: 'Selisih',      key: 'selisih',      width: 16 },
    { header: 'Catatan',      key: 'catatan_rekon', width: 30 },
    { header: 'Mutu Data',    key: 'status_data',  width: 16 },
    { header: 'Berkas',       key: 'berkas_sumber', width: 24 },
    { header: 'Baris',        key: 'baris_sumber', width: 8 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const t of data) {
    sheet.addRow({ ...t, debit: Number(t.debit), kredit: Number(t.kredit) });
  }
  // Format ribuan Indonesia; nilainya tetap angka sungguhan agar bisa dijumlah.
  for (const kolom of ['C', 'D', 'E', 'I', 'J']) {
    sheet.getColumn(kolom).numFmt = '#,##0.00';
  }

  const bagian = ['rekonsiliasi'];
  if (kriteria.cari) bagian.push(kriteria.cari.replace(/[^a-zA-Z0-9]+/g, '-'));
  if (kriteria.bulan) bagian.push(String(kriteria.bulan).padStart(2, '0'));
  if (kriteria.tahun) bagian.push(String(kriteria.tahun));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${bagian.join('-').toLowerCase()}.xlsx"`);
  res.send(Buffer.from(await buku.xlsx.writeBuffer()));
}));

api.use('/audit', audit);

export default api;

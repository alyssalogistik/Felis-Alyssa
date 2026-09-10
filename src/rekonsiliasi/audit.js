// Endpoint audit pembayaran supplier.
//
// Pencocokan dijalankan di aplikasi memakai src/rekonsiliasi/pencocokan.js,
// lalu hasilnya disimpan. Aturannya tidak ditulis ulang dalam SQL supaya hanya
// ada satu tempat yang memutuskan apa itu MATCH.

import { Router } from 'express';
import express from 'express';
import ExcelJS from 'exceljs';
import { createAdminClient } from '../supabase.js';
import { BATAS_UKURAN } from './baca.js';
import { GalatFormat } from './parser.js';
import { bacaTagihan, ringkasTagihan } from './tagihan.js';
import { cocokkan, ringkasAudit, STATUS } from './pencocokan.js';

const db = createAdminClient();

const UKURAN_BATCH = 500;
/** Audit menahan seluruh data di memori; batas ini menjaga proses tetap sehat. */
const BATAS_AUDIT = 20000;

function jalur(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

function kutip(nilai) {
  return `"${String(nilai).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const api = Router();

// --- Unggah daftar tagihan supplier ----------------------------------------

api.post(
  '/tagihan/unggah',
  express.raw({ type: () => true, limit: BATAS_UKURAN }),
  jalur(async (req, res) => {
    const buffer = req.body;
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      return res.status(400).json({ pesan: 'Tidak ada berkas yang diterima.' });
    }

    let namaBerkas = 'tagihan-supplier';
    try {
      namaBerkas = decodeURIComponent(req.get('X-Nama-Berkas') ?? '') || namaBerkas;
    } catch { /* nama bawaan sudah cukup */ }

    let hasil;
    try {
      hasil = await bacaTagihan(buffer, namaBerkas);
    } catch (error) {
      if (error instanceof GalatFormat) return res.status(422).json({ pesan: error.message });
      throw error;
    }

    const layak = hasil.tagihan.filter((t) => t.layak_simpan);

    // Supplier dibuat sekali per nama. Nama dari berkas dipakai apa adanya;
    // pencocokan nanti yang menangani variasi penulisannya di rekening koran.
    const namaUnik = [...new Set(layak.map((t) => t.pemasok_nama))];
    const petaPemasok = new Map();

    for (const nama of namaUnik) {
      const { data: ada, error: galatCari } = await db
        .from('pemasok').select('id').eq('nama', nama).maybeSingle();
      if (galatCari) throw galatCari;

      if (ada) {
        petaPemasok.set(nama, ada.id);
        continue;
      }
      const { data: baru, error: galatBuat } = await db
        .from('pemasok').insert({ nama }).select('id').single();
      if (galatBuat) throw galatBuat;
      petaPemasok.set(nama, baru.id);
    }

    const baris = layak.map((t) => ({
      pemasok_id: petaPemasok.get(t.pemasok_nama),
      no_invoice: t.no_invoice,
      tanggal_invoice: t.tanggal_invoice,
      jatuh_tempo: t.jatuh_tempo,
      gross: t.gross,
      pph: t.pph,
      keterangan: t.keterangan,
      berkas_sumber: t.berkas_sumber,
    }));

    // Invoice yang sama diunggah ulang diperbarui, bukan digandakan.
    let tersimpan = 0;
    for (let i = 0; i < baris.length; i += UKURAN_BATCH) {
      const { data, error } = await db
        .from('tagihan_pemasok')
        .upsert(baris.slice(i, i + UKURAN_BATCH), { onConflict: 'pemasok_id,no_invoice' })
        .select('id');
      if (error) throw error;
      tersimpan += data?.length ?? 0;
    }

    res.status(201).json({
      sheet: hasil.sheet,
      kolom_terdeteksi: Object.keys(hasil.peta),
      ringkasan: ringkasTagihan(hasil.tagihan),
      tersimpan,
      supplier_baru: namaUnik.length,
      // Baris bermasalah dikembalikan agar bisa diperbaiki di berkas asal,
      // bukan dibuang tanpa jejak.
      bermasalah: hasil.tagihan
        .filter((t) => !t.layak_simpan)
        .slice(0, 50)
        .map((t) => ({ baris: t.baris_sumber, pemasok: t.pemasok_nama, no_invoice: t.no_invoice, masalah: t.masalah })),
    });
  })
);

// --- Jalankan pencocokan ----------------------------------------------------

api.post('/jalankan', jalur(async (req, res) => {
  const opsi = {};
  for (const kunci of ['toleransiNominal', 'hariSebelum', 'hariSesudah']) {
    const n = Number(req.body?.[kunci]);
    if (Number.isFinite(n) && n >= 0) opsi[kunci] = n;
  }

  const { data: tagihan, error: galatTagihan } = await db
    .from('tagihan_pemasok')
    .select('id, no_invoice, tanggal_invoice, gross, pph, pemasok_id, pemasok(nama)')
    .order('tanggal_invoice', { ascending: true })
    .limit(BATAS_AUDIT);
  if (galatTagihan) throw galatTagihan;

  const { data: transaksi, error: galatTransaksi } = await db
    .from('transaksi_bank')
    .select('id, tanggal, keterangan, debit, kredit')
    .gt('debit', 0)
    .order('tanggal', { ascending: true })
    .limit(BATAS_AUDIT);
  if (galatTransaksi) throw galatTransaksi;

  // Kecocokan yang sudah dikonfirmasi manusia dipertahankan: menjalankan ulang
  // audit tidak boleh menghapus keputusan yang sudah diperiksa orang.
  const { data: terkunci, error: galatTerkunci } = await db
    .from('kecocokan').select('tagihan_id, transaksi_id').eq('dikonfirmasi', true);
  if (galatTerkunci) throw galatTerkunci;

  const tagihanTerkunci = new Set(terkunci.map((k) => k.tagihan_id).filter(Boolean));
  const transaksiTerkunci = new Set(terkunci.map((k) => k.transaksi_id).filter(Boolean));

  const siapCocok = tagihan
    .filter((t) => !tagihanTerkunci.has(t.id))
    .map((t) => ({
      id: t.id,
      pemasok_id: t.pemasok_id,
      pemasok_nama: t.pemasok?.nama ?? '',
      no_invoice: t.no_invoice,
      tanggal_invoice: t.tanggal_invoice,
      gross: t.gross,
      pph: t.pph,
    }));

  const hasilCocok = cocokkan(
    siapCocok,
    transaksi.filter((t) => !transaksiTerkunci.has(t.id)),
    opsi
  );

  const { error: galatHapus } = await db.from('kecocokan').delete().eq('dikonfirmasi', false);
  if (galatHapus) throw galatHapus;

  const barisBaru = [
    ...hasilCocok.hasil.map((h) => ({
      tagihan_id: h.tagihan_id,
      transaksi_id: h.transaksi_id,
      status: h.status,
      keyakinan: h.keyakinan,
      selisih: h.selisih,
      alasan: h.alasan,
      otomatis: true,
      dikonfirmasi: false,
    })),
    ...hasilCocok.tanpa_tagihan.map((t) => ({
      tagihan_id: null,
      transaksi_id: t.transaksi_id,
      status: STATUS.TRANSFER_TANPA_INVOICE,
      keyakinan: 0,
      selisih: null,
      alasan: ['Uang keluar tanpa tagihan supplier yang cocok.'],
      otomatis: true,
      dikonfirmasi: false,
    })),
  ];

  for (let i = 0; i < barisBaru.length; i += UKURAN_BATCH) {
    const { error } = await db.from('kecocokan').insert(barisBaru.slice(i, i + UKURAN_BATCH));
    if (error) throw error;
  }

  res.json({
    dicocokkan: siapCocok.length,
    transaksi_diperiksa: transaksi.length,
    dipertahankan: terkunci.length,
    ringkasan: ringkasAudit(hasilCocok),
  });
}));

// --- Hasil audit ------------------------------------------------------------

function kriteriaAudit(query) {
  const angka = (n, min, maks) => {
    const v = Number(n);
    return n === undefined || n === '' || !Number.isInteger(v) || v < min || v > maks ? null : v;
  };
  // Tanggal diterima hanya dalam bentuk ISO. Bentuk lain ditolak diam-diam
  // menjadi "tanpa filter" alih-alih diteruskan ke database, karena tanggal
  // cacat yang lolos akan menyaring habis hasilnya tanpa alasan yang terlihat.
  const tanggal = (t) => (typeof t === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : '');

  return {
    pemasok: typeof query.pemasok === 'string' ? query.pemasok.trim() : '',
    bulan: angka(query.bulan, 1, 12),
    tahun: angka(query.tahun, 1900, 2200),
    dari: tanggal(query.dari),
    sampai: tanggal(query.sampai),
    status: Object.values(STATUS).includes(query.status) ? query.status : '',
    // "hanya yang bermasalah" adalah tampilan bawaan audit: yang sudah cocok
    // tidak perlu dilihat satu per satu.
    hanya_selisih: query.hanya_selisih === '1' || query.hanya_selisih === 'true',
  };
}

function terapkanAudit(query, k) {
  if (k.pemasok) query = query.ilike('pemasok', kutip(`%${k.pemasok}%`).slice(1, -1));
  if (k.bulan !== null) query = query.eq('bulan', k.bulan);
  if (k.tahun !== null) query = query.eq('tahun', k.tahun);
  // Rentang tanggal mengacu ke tanggal invoice, sama dengan kolom yang
  // diurutkan dan ditampilkan, supaya yang tersaring sama dengan yang terlihat.
  if (k.dari) query = query.gte('tanggal_invoice', k.dari);
  if (k.sampai) query = query.lte('tanggal_invoice', k.sampai);
  if (k.status) query = query.eq('status', k.status);
  if (k.hanya_selisih) query = query.neq('status', STATUS.MATCH);
  return query;
}

api.get('/hasil', jalur(async (req, res) => {
  const k = kriteriaAudit(req.query);
  const batas = Math.min(Math.max(Number(req.query.batas) || 50, 1), 200);
  const mulai = Math.max(Number(req.query.mulai) || 0, 0);

  let query = db
    .from('audit_pembayaran_pemasok')
    .select('*', { count: 'exact' })
    .order('tanggal_invoice', { ascending: false })
    .range(mulai, mulai + batas - 1);

  const { data, count, error } = await terapkanAudit(query, k);
  if (error) throw error;

  const { data: ringkasan, error: galatRingkasan } = await db.rpc('ringkasan_audit_pemasok', {
    p_pemasok: k.pemasok || null,
    p_bulan: k.bulan,
    p_tahun: k.tahun,
    p_dari: k.dari || null,
    p_sampai: k.sampai || null,
    p_status: k.status || null,
  });
  if (galatRingkasan) throw galatRingkasan;

  res.json({
    data, total: count ?? 0, batas, mulai,
    ringkasan: ringkasan?.[0] ?? null,
  });
}));

/** Uang keluar yang tidak terhubung tagihan mana pun. */
api.get('/tanpa-tagihan', jalur(async (_req, res) => {
  const { data, error } = await db
    .from('kecocokan')
    .select('id, status, alasan, transaksi_bank(id, tanggal, keterangan, debit)')
    .eq('status', STATUS.TRANSFER_TANPA_INVOICE)
    .limit(200);
  if (error) throw error;
  res.json({ data });
}));

api.get('/pemasok', jalur(async (_req, res) => {
  const { data, error } = await db.from('pemasok').select('*').order('nama');
  if (error) throw error;
  res.json({ data });
}));

// --- Koreksi manusia --------------------------------------------------------

api.post('/kecocokan/:tagihan_id', jalur(async (req, res) => {
  const { transaksi_id, catatan, lepas } = req.body ?? {};

  const { data: tagihan, error: galatTagihan } = await db
    .from('tagihan_pemasok').select('id, gross, pph').eq('id', req.params.tagihan_id).maybeSingle();
  if (galatTagihan) throw galatTagihan;
  if (!tagihan) return res.status(404).json({ pesan: 'Tagihan tidak ditemukan.' });

  await db.from('kecocokan').delete().eq('tagihan_id', tagihan.id);

  if (lepas) {
    const { data, error } = await db.from('kecocokan').insert({
      tagihan_id: tagihan.id, transaksi_id: null,
      status: STATUS.INVOICE_BELUM_ADA_TRANSFER, keyakinan: 0,
      alasan: ['Pasangan dilepas manual.'], otomatis: false, dikonfirmasi: true, catatan,
    }).select().single();
    if (error) throw error;
    return res.json(data);
  }

  const { data: trx, error: galatTrx } = await db
    .from('transaksi_bank').select('id, debit').eq('id', transaksi_id).maybeSingle();
  if (galatTrx) throw galatTrx;
  if (!trx) return res.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });

  // Status tetap diturunkan dari selisih, bukan ditentukan pengguna: manusia
  // memutuskan pasangannya, angka yang memutuskan statusnya.
  const net = Math.round(Number(tagihan.gross) * 100) - Math.round(Number(tagihan.pph) * 100);
  const selisih = (Math.round(Number(trx.debit) * 100) - net) / 100;
  const status = Math.abs(selisih) <= 1000
    ? STATUS.MATCH
    : selisih < 0 ? STATUS.KURANG_BAYAR : STATUS.LEBIH_BAYAR;

  const { data, error } = await db.from('kecocokan').insert({
    tagihan_id: tagihan.id, transaksi_id: trx.id, status,
    keyakinan: 1, selisih, alasan: ['Dipasangkan manual dan dikonfirmasi.'],
    otomatis: false, dikonfirmasi: true, catatan,
  }).select().single();
  if (error) throw error;

  res.json(data);
}));

// --- Ekspor -----------------------------------------------------------------

api.get('/ekspor', jalur(async (req, res) => {
  const k = kriteriaAudit(req.query);

  let query = db
    .from('audit_pembayaran_pemasok')
    .select('*')
    .order('pemasok', { ascending: true })
    .order('tanggal_invoice', { ascending: true })
    .limit(BATAS_AUDIT);

  const { data, error } = await terapkanAudit(query, k);
  if (error) throw error;

  const buku = new ExcelJS.Workbook();
  const sheet = buku.addWorksheet('Audit Pemasok');
  sheet.columns = [
    { header: 'Supplier',                key: 'pemasok',             width: 30 },
    { header: 'No Invoice',              key: 'no_invoice',          width: 22 },
    { header: 'Tanggal Invoice',         key: 'tanggal_invoice',     width: 15 },
    { header: 'Gross Tagihan',           key: 'gross',               width: 16 },
    { header: 'PPh',                     key: 'pph',                 width: 14 },
    { header: 'Net Transfer Seharusnya', key: 'net_seharusnya',      width: 20 },
    { header: 'Transfer Bank',           key: 'transfer_bank',       width: 16 },
    { header: 'Selisih',                 key: 'selisih',             width: 15 },
    { header: 'Status',                  key: 'status',              width: 26 },
    { header: 'Keyakinan',               key: 'keyakinan',           width: 11 },
    { header: 'Tanggal Transfer',        key: 'tanggal_transfer',    width: 15 },
    { header: 'Keterangan Transfer',     key: 'keterangan_transfer', width: 40 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const b of data) {
    sheet.addRow({
      ...b,
      gross: Number(b.gross),
      pph: Number(b.pph),
      net_seharusnya: Number(b.net_seharusnya),
      transfer_bank: b.transfer_bank === null ? null : Number(b.transfer_bank),
      selisih: b.selisih === null ? null : Number(b.selisih),
    });
  }
  for (const kolom of ['D', 'E', 'F', 'G', 'H']) sheet.getColumn(kolom).numFmt = '#,##0.00';

  const bagian = ['audit-pemasok'];
  if (k.pemasok) bagian.push(k.pemasok.replace(/[^a-zA-Z0-9]+/g, '-'));
  if (k.bulan) bagian.push(String(k.bulan).padStart(2, '0'));
  if (k.tahun) bagian.push(String(k.tahun));

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${bagian.join('-').toLowerCase()}.xlsx"`);
  res.send(Buffer.from(await buku.xlsx.writeBuffer()));
}));

export default api;

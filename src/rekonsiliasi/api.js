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
import { idUnggahanValid, periksaHapus, rincianHapus } from './hapus.js';
import { saringPembayaran, saringPerubahan } from './pembayaran.js';
import { cariKembar, peringatanSumber, perluKonfirmasi } from './kembar-bayar.js';
import audit from './audit.js';

const db = createAdminClient();

/** Jumlah baris per sekali insert; batch raksasa ditolak PostgREST. */
const UKURAN_BATCH = 500;

/** Laporan cetak dibatasi supaya satu permintaan tidak menghasilkan PDF ribuan halaman. */
const BATAS_CETAK = 5000;

/**
 * Sumber baca untuk layar, ekspor, dan laporan.
 *
 * View, bukan tabel. Rekening koran yang sama pernah diunggah lebih dari sekali
 * sebelum penjaga duplikat ada, sehingga satu transfer bisa tampil dan
 * terhitung berkali-kali. View melipat salinan yang datang dari unggahan
 * BERBEDA saja — dua transaksi bernominal sama pada hari yang sama di dalam
 * satu rekening koran tetap dua baris, karena keduanya uang sungguhan.
 *
 * Penulisan tidak pernah lewat sini: menyimpan dan memperbarui status rekon
 * tetap menembak transaksi_bank langsung.
 */
const TABEL_TAMPIL = 'transaksi_bank_unik';

const KOLOM_TRANSAKSI =
  'id, unggahan_id, baris_sumber, berkas_sumber, tanggal, tanggal_ambigu, keterangan, ' +
  'debit, kredit, saldo, referensi, status_data, masalah, duplikat, status_rekon, ' +
  'referensi_rekon, catatan_rekon, nominal_pembanding, selisih, direkon_pada, direkon_oleh';

/**
 * Tampilan gabungan: rekening koran ditambah pembayaran manual.
 *
 * View, bukan penggabungan di aplikasi. Halaman audit menarik hasilnya
 * berhalaman-halaman dengan range() dan count exact; dua sumber yang digabung
 * di peramban tidak bisa digeser terpisah lalu menghasilkan urutan tanggal
 * yang benar, dan auditor yang melihat sebagian daftar akan menyimpulkan
 * supplier kurang dibayar.
 */
const TABEL_GABUNGAN = 'pembayaran_semua';
const KOLOM_GABUNGAN = `asal, sumber, memo, bukti_url, dibuat_oleh, ${KOLOM_TRANSAKSI}`;

/**
 * Sumber baca untuk satu permintaan.
 *
 * Bawaannya rekening koran saja. Halaman Rekonsiliasi Bank memakai endpoint
 * yang sama dan tidak boleh ikut menampilkan pembayaran manual: di sana yang
 * dikerjakan adalah mencocokkan baris e-statement, dan baris Mekari Pay tidak
 * punya baris bank untuk dicocokkan.
 */
function sumberBaca(query) {
  const gabungan = query.termasuk_manual === '1' || query.termasuk_manual === 'true';
  return gabungan
    ? { tabel: TABEL_GABUNGAN, kolom: KOLOM_GABUNGAN, gabungan: true }
    : { tabel: TABEL_TAMPIL, kolom: KOLOM_TRANSAKSI, gabungan: false };
}

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
        no_rekening: hasil.noRekening ?? null,
        periode_bulan: hasil.periode?.bulan ?? null,
        periode_tahun: hasil.periode?.tahun ?? null,
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
      no_rekening: hasil.noRekening ?? null,
      kembar_ke: t.kembar_ke ?? 1,
    }));

    // upsert dengan ignoreDuplicates menghasilkan ON CONFLICT DO NOTHING:
    // transaksi yang sidik jarinya sudah ada dilewati, bukan ditimpa. Yang
    // kembali dari .select() hanyalah baris yang benar-benar tersisip, jadi
    // hitungannya datang dari database, bukan dari tebakan aplikasi.
    let jumlahBaru = 0;
    for (let i = 0; i < baris.length; i += UKURAN_BATCH) {
      const { data: tersisip, error } = await db
        .from('transaksi_bank')
        .upsert(baris.slice(i, i + UKURAN_BATCH), { onConflict: 'sidik', ignoreDuplicates: true })
        .select('id');
      if (error) throw error;
      jumlahBaru += tersisip?.length ?? 0;
    }

    const sudahAda = baris.length - jumlahBaru;
    const status = jumlahBaru === 0 ? 'duplikat' : sudahAda > 0 ? 'sebagian' : 'selesai';

    // Riwayatnya dilengkapi setelah penyisipan, karena hasilnya baru diketahui
    // di sini. Kegagalan memperbarui riwayat tidak boleh menggagalkan impor
    // yang transaksinya sudah tersimpan.
    const { data: riwayat } = await db
      .from('unggahan_rekening_koran')
      .update({ jumlah_baru: jumlahBaru, jumlah_sudah_ada: sudahAda, status })
      .eq('id', unggahan.id)
      .select()
      .maybeSingle();

    // Buffer dilepas di sini; berkas aslinya tidak pernah ditulis ke disk.
    res.status(201).json({
      unggahan: riwayat ?? unggahan,
      ringkasan: { ...ringkasan, baru: jumlahBaru, sudah_ada: sudahAda },
      sheet: hasil.sheet,
      periode: hasil.periode ?? null,
      no_rekening: hasil.noRekening ?? null,
      status,
      kolom_terdeteksi: Object.keys(hasil.peta),
      pernah_diunggah: sebelumnya?.[0] ?? null,
    });
  })
);

// --- Pemeriksaan periode sebelum impor --------------------------------------

// Membaca berkas tanpa menyimpan apa pun, hanya untuk mengetahui periodenya.
//
// Ada dua alasan langkah ini berdiri sendiri. Pertama, berkas harus diproses
// dari bulan terlama ke terbaru, sedangkan periodenya baru diketahui setelah
// diurai — urutan pemakai memilih berkas tidak bisa dipercaya. Kedua, batas
// dua belas bulan harus ditegakkan SEBELUM satu baris pun tersimpan; menolak
// di tengah jalan akan meninggalkan sebagian bulan sudah masuk dan sebagian
// belum.
api.post(
  '/periode',
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
      // Header cacat bukan alasan menggagalkan pemeriksaan.
    }

    let hasil;
    try {
      hasil = await bacaRekeningKoran(buffer, namaBerkas);
    } catch (error) {
      if (error instanceof GalatFormat) return res.status(422).json({ pesan: error.message });
      throw error;
    }

    res.json({
      nama_berkas: namaBerkas,
      periode: hasil.periode ?? null,
      no_rekening: hasil.noRekening ?? null,
      sheet: hasil.sheet,
      jumlah_transaksi: hasil.transaksi.length,
    });
  })
);

// --- Periode yang datanya sudah ada di database -----------------------------

api.get('/periode-tersimpan', jalur(async (_req, res) => {
  const { data, error } = await db.rpc('periode_tersimpan');
  if (error) throw error;
  res.json({ data: data ?? [] });
}));

// --- Daftar supplier dari rekening koran ------------------------------------

/**
 * Nama yang muncul di keterangan rekening koran, beserta rekap uang keluarnya.
 *
 * Tujuannya menghapus langkah "ingat lalu ketik nama supplier": daftar ini
 * cukup diklik. Namanya diturunkan dari keterangan bank, bukan dari daftar
 * supplier yang harus diisi lebih dulu.
 *
 * Seluruh baris ditarik, bukan satu halaman. Rekap yang dihitung dari sebagian
 * transaksi akan menampilkan total yang terlalu kecil, dan di halaman ini
 * angka yang terlalu kecil terbaca sebagai kurang bayar — lalu dibayar dua
 * kali. BATAS_PINDAI menahan kalau rekening korannya sudah bertahun-tahun;
 * bila tercapai, jawabannya menyebut bahwa rekapnya belum mencakup semua.
 */
const BATAS_PINDAI = 20000;
const UKURAN_PINDAI = 1000;

api.get('/supplier', jalur(async (_req, res) => {
  const { daftarSupplier } = await import('./nama.js');

  const baris = [];
  let lengkap = true;

  for (let mulai = 0; mulai < BATAS_PINDAI; mulai += UKURAN_PINDAI) {
    // Membaca tampilan gabungan, bukan rekening koran saja: supplier yang
    // dibayar hanya lewat Mekari Pay tidak punya satu pun baris di e-statement
    // dan tidak akan pernah muncul di daftar kalau sumbernya dibatasi ke bank.
    const { data, error } = await db
      .from(TABEL_GABUNGAN)
      .select('keterangan, debit, tanggal, kredit')
      .gt('debit', 0)
      .order('tanggal', { ascending: false, nullsFirst: false })
      .range(mulai, mulai + UKURAN_PINDAI - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;

    baris.push(...data);
    if (data.length < UKURAN_PINDAI) break;
    if (mulai + UKURAN_PINDAI >= BATAS_PINDAI) lengkap = false;
  }

  res.json({ data: daftarSupplier(baris), dipindai: baris.length, lengkap });
}));

// --- Daftar transaksi + ringkasan ------------------------------------------

api.get('/transaksi', jalur(async (req, res) => {
  const kriteria = kriteriaDari(req.query);
  const sumber = sumberBaca(req.query);
  const batas = Math.min(Math.max(Number(req.query.batas) || 50, 1), 200);
  const mulai = Math.max(Number(req.query.mulai) || 0, 0);

  let query = db
    .from(sumber.tabel)
    .select(sumber.kolom, { count: 'exact' })
    .order('tanggal', { ascending: false, nullsFirst: false })
    .order('baris_sumber', { ascending: true, nullsFirst: false })
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

  // Rincian per sumber hanya diambil saat tampilannya memang gabungan.
  // Fungsinya terpisah dari ringkasan_transaksi_bank(), bukan parameter
  // tambahan padanya: menambah parameter ke fungsi yang sudah ada membuat
  // versi lama dan baru berdampingan, lalu pemanggilan lama gagal dengan
  // "Could not choose a best candidate function".
  let ringkasanSumber = null;
  if (sumber.gabungan) {
    const { data: perSumber, error: galatSumber } = await db.rpc('ringkasan_pembayaran', {
      p_cari: kriteria.cari || null,
      p_bulan: kriteria.bulan,
      p_tahun: kriteria.tahun,
      p_dari: kriteria.dari,
      p_sampai: kriteria.sampai,
      p_hanya_debit: kriteria.hanya_debit,
    });
    if (galatSumber) throw galatSumber;
    ringkasanSumber = perSumber ?? [];
  }

  res.json({
    data,
    total: count ?? 0,
    batas,
    mulai,
    ringkasan: sumber.gabungan
      ? ringkasanGabungan(ringkasanSumber)
      : ringkasan?.[0] ?? { jumlah: 0, debit: 0, kredit: 0, net: 0 },
    ringkasan_sumber: ringkasanSumber,
  });
}));

/** Menjumlahkan rincian per sumber menjadi satu ringkasan berbentuk lama. */
function ringkasanGabungan(perSumber) {
  const total = (perSumber ?? []).reduce(
    (a, k) => ({
      jumlah: a.jumlah + Number(k.jumlah ?? 0),
      debit: a.debit + Number(k.debit ?? 0),
      kredit: a.kredit + Number(k.kredit ?? 0),
    }),
    { jumlah: 0, debit: 0, kredit: 0 }
  );
  return { ...total, net: total.kredit - total.debit };
}

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
    // Satu batch impor bisa berisi dua belas bulan sekaligus; dua puluh baris
    // akan langsung tertutup oleh satu kali impor saja.
    .limit(60);
  if (error) throw error;
  res.json({ data });
}));

// --- Hapus satu unggahan ----------------------------------------------------

/**
 * Apa saja yang akan ikut terhapus bila satu unggahan dihapus.
 *
 * Jumlah transaksinya DIHITUNG ULANG dari tabel, bukan dibaca dari kolom
 * `jumlah_transaksi`. Kolom itu mencatat berapa baris yang terbaca dari berkas,
 * sedangkan yang benar-benar terhapus hanyalah baris yang unggahan ini miliki.
 * Karena penyisipan memakai ON CONFLICT DO NOTHING, rekening koran yang sama
 * diunggah dua kali menghasilkan unggahan kedua yang tidak memiliki satu baris
 * pun — dan itulah yang paling sering ingin dihapus.
 */
async function dampakUnggahan(id) {
  // Bentuknya diperiksa lebih dulu supaya id cacat dijawab "tidak ditemukan"
  // alih-alih menjadi galat cast uuid dari Postgres yang bocor ke pemakainya.
  if (!idUnggahanValid(id)) return null;

  const { data: unggahan, error } = await db
    .from('unggahan_rekening_koran')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!unggahan) return null;

  const hitung = async (bangun) => {
    const { count, error: galat } = await bangun();
    if (galat) throw galat;
    return count ?? 0;
  };

  // Kecocokan dihitung lewat penyaringan pada relasi, bukan dengan menarik
  // seluruh id transaksi ke aplikasi lebih dulu: satu unggahan bisa memuat
  // ribuan baris, dan daftar id sepanjang itu tidak muat di satu URL.
  const kecocokanUnggahan = () => db
    .from('kecocokan')
    .select('id, transaksi_bank!inner(unggahan_id)', { count: 'exact', head: true })
    .eq('transaksi_bank.unggahan_id', id);

  return {
    unggahan,
    transaksi: await hitung(() => db
      .from('transaksi_bank')
      .select('id', { count: 'exact', head: true })
      .eq('unggahan_id', id)),
    sudah_direkon: await hitung(() => db
      .from('transaksi_bank')
      .select('id', { count: 'exact', head: true })
      .eq('unggahan_id', id)
      .neq('status_rekon', 'belum')),
    kecocokan: await hitung(kecocokanUnggahan),
    kecocokan_dikonfirmasi: await hitung(() => kecocokanUnggahan().eq('dikonfirmasi', true)),
  };
}

/** Hanya membaca. Dipakai kotak konfirmasi sebelum apa pun dihapus. */
api.get('/unggahan/:id/dampak', jalur(async (req, res) => {
  const dampak = await dampakUnggahan(req.params.id);
  if (!dampak) return res.status(404).json({ pesan: 'Unggahan tidak ditemukan.' });
  res.json({ ...dampak, rincian: rincianHapus(dampak) });
}));

api.delete('/unggahan/:id', jalur(async (req, res) => {
  const dampak = await dampakUnggahan(req.params.id);
  if (!dampak) return res.status(404).json({ pesan: 'Unggahan tidak ditemukan.' });

  const izin = periksaHapus(dampak, {
    konfirmasiKecocokan: req.query.konfirmasi_kecocokan === '1',
  });
  if (!izin.boleh) {
    return res.status(409).json({
      pesan: izin.pesan,
      kode: izin.kode,
      ...dampak,
      rincian: rincianHapus(dampak),
    });
  }

  // Satu perintah saja. Transaksi dan hasil auditnya ikut lewat rantai
  // ON DELETE CASCADE yang sudah ada di skema, sehingga tidak mungkin berhenti
  // di tengah dengan unggahan terhapus tetapi transaksinya tertinggal.
  // Penyaringan hanya pada id unggahan ini: baris milik berkas lain tidak
  // tersentuh sekalipun isinya identik.
  const { error } = await db.from('unggahan_rekening_koran').delete().eq('id', req.params.id);
  if (error) throw error;

  res.json({
    terhapus: {
      nama_berkas: dampak.unggahan.nama_berkas,
      transaksi: dampak.transaksi,
      kecocokan: dampak.kecocokan,
      kecocokan_dikonfirmasi: dampak.kecocokan_dikonfirmasi,
    },
  });
}));

// --- Cetak ------------------------------------------------------------------

// Laporan dibuat di server, bukan dari tabel yang sedang tampil di layar.
// Layar hanya memuat satu halaman hasil; laporan harus memuat seluruh transaksi
// yang cocok dengan filter, dan itu hanya bisa dijamin dari sisi ini.
api.get('/cetak', jalur(async (req, res) => {
  const kriteria = kriteriaDari(req.query);

  const sumber = sumberBaca(req.query);

  let query = db
    .from(sumber.tabel)
    .select(sumber.kolom)
    .order('tanggal', { ascending: true, nullsFirst: false })
    .order('baris_sumber', { ascending: true, nullsFirst: false })
    .limit(BATAS_CETAK);

  const { data, error } = await terapkanKriteria(query, kriteria);
  if (error) throw error;

  const { buatPdfLaporan } = await import('./cetak.js');
  const { namaBerkas } = await import('./laporan.js');

  const berkas = await buatPdfLaporan(data ?? [], kriteria);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${namaBerkas(kriteria)}"`);
  res.setHeader('Content-Length', String(berkas.length));
  res.end(berkas);
}));

// --- Ekspor ----------------------------------------------------------------

api.get('/ekspor', jalur(async (req, res) => {
  const kriteria = kriteriaDari(req.query);

  const sumber = sumberBaca(req.query);

  // Ekspor mengikuti filter yang sedang aktif, bukan seluruh rekening koran.
  let query = db
    .from(sumber.tabel)
    .select(sumber.kolom)
    .order('tanggal', { ascending: true, nullsFirst: false })
    .order('baris_sumber', { ascending: true, nullsFirst: false })
    .limit(20000);

  const { data, error } = await terapkanKriteria(query, kriteria);
  if (error) throw error;

  const buku = new ExcelJS.Workbook();
  const sheet = buku.addWorksheet('Rekonsiliasi');

  sheet.columns = [
    { header: 'Tanggal',      key: 'tanggal',      width: 12 },
    // Sumbernya wajib ikut supaya pembayaran manual di berkas ekspor tidak
    // terbaca seolah baris rekening koran.
    { header: 'Sumber',       key: 'sumber',       width: 14 },
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
    sheet.addRow({ ...t, sumber: t.sumber ?? 'BCA', debit: Number(t.debit), kredit: Number(t.kredit) });
  }
  // Format ribuan Indonesia; nilainya tetap angka sungguhan agar bisa dijumlah.
  // Hurufnya bergeser satu sejak kolom Sumber disisipkan di posisi kedua.
  for (const kolom of ['D', 'E', 'F', 'J', 'K']) {
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

// --- Pembayaran manual ------------------------------------------------------
//
// Uang keluar yang tidak lewat rekening koran: Mekari Pay, kas, bank lain.
// Disimpan di tabelnya sendiri; transaksi_bank tidak pernah disentuh dari sini.

const KOLOM_BAYAR =
  'id, tanggal, penerima, nominal, sumber, no_referensi, memo, bukti_url, ' +
  'dibuat_pada, dibuat_oleh, diubah_pada, diubah_oleh';

/** Baris pembanding untuk penjaga double count: rekening koran DAN manual. */
async function barisPembanding({ tanggal, penerima }) {
  // Disaring ke jendela waktu di sekitar tanggalnya saja. Menarik seluruh
  // rekening koran bertahun-tahun untuk memeriksa satu pembayaran akan membuat
  // formulirnya menggantung, dan kandidat di luar jendela itu memang tidak
  // pernah dianggap kembar kecuali nomor referensinya sama.
  const geser = (hari) => {
    const t = new Date(`${tanggal}T00:00:00Z`);
    t.setUTCDate(t.getUTCDate() + hari);
    return t.toISOString().slice(0, 10);
  };

  const { data: dekat, error } = await db
    .from(TABEL_GABUNGAN)
    .select('id, asal, sumber, tanggal, keterangan, debit, kredit, referensi')
    .gte('tanggal', geser(-7))
    .lte('tanggal', geser(7))
    .gt('debit', 0)
    .limit(2000);
  if (error) throw error;

  // Nomor referensi menembus jendela waktu: satu invoice yang dibayar dua kali
  // berbulan-bulan berjarak adalah pola double count yang paling mahal.
  const kata = String(penerima ?? '').trim();
  if (kata === '') return dekat ?? [];

  const { data: senama, error: galatNama } = await db
    .from(TABEL_GABUNGAN)
    .select('id, asal, sumber, tanggal, keterangan, debit, kredit, referensi')
    .ilike('keterangan', `%${kata}%`)
    .gt('debit', 0)
    .limit(2000);
  if (galatNama) throw galatNama;

  const gabung = new Map();
  for (const b of [...(dekat ?? []), ...(senama ?? [])]) gabung.set(b.id, b);
  return [...gabung.values()];
}

/** Hanya memeriksa. Dipakai formulir sebelum apa pun tersimpan. */
api.post('/pembayaran/periksa', jalur(async (req, res) => {
  const hasil = saringPembayaran(req.body ?? {});
  if (!hasil.ok) return res.status(422).json({ pesan: hasil.masalah.join(' '), masalah: hasil.masalah });

  const kandidat = cariKembar(hasil.nilai, await barisPembanding(hasil.nilai), {
    abaikanId: req.body?.abaikan_id,
  });

  res.json({
    kandidat,
    peringatan: peringatanSumber(hasil.nilai.sumber),
    perlu_konfirmasi: perluKonfirmasi(kandidat, hasil.nilai.sumber),
  });
}));

api.get('/pembayaran', jalur(async (req, res) => {
  const batas = Math.min(Math.max(Number(req.query.batas) || 100, 1), 500);
  const { data, count, error } = await db
    .from('pembayaran_manual')
    .select(KOLOM_BAYAR, { count: 'exact' })
    .order('tanggal', { ascending: false })
    .order('dibuat_pada', { ascending: false })
    .range(0, batas - 1);
  if (error) throw error;
  res.json({ data, total: count ?? 0 });
}));

api.get('/pembayaran/:id/riwayat', jalur(async (req, res) => {
  if (!idUnggahanValid(req.params.id)) return res.status(404).json({ pesan: 'Pembayaran tidak ditemukan.' });
  const { data, error } = await db
    .from('pembayaran_manual_riwayat')
    .select('id, aksi, data_lama, data_baru, oleh, pada')
    .eq('pembayaran_id', req.params.id)
    .order('pada', { ascending: false });
  if (error) throw error;
  res.json({ data });
}));

api.post('/pembayaran', jalur(async (req, res) => {
  const hasil = saringPembayaran(req.body ?? {});
  if (!hasil.ok) return res.status(422).json({ pesan: hasil.masalah.join(' '), masalah: hasil.masalah });

  const kandidat = cariKembar(hasil.nilai, await barisPembanding(hasil.nilai));
  const peringatan = peringatanSumber(hasil.nilai.sumber);
  const disetujui = req.query.konfirmasi_kembar === '1';

  // Memperingatkan, bukan memblokir: transfer BCA dan pembayaran Mekari Pay
  // pada hari yang sama dengan nominal sama bisa benar-benar dua pembayaran
  // berbeda, dan menolaknya otomatis membuat uang yang sungguhan keluar hilang
  // dari catatan. Yang diputuskan mesin hanya "ini perlu dilihat orang".
  if (perluKonfirmasi(kandidat, hasil.nilai.sumber) && !disetujui) {
    return res.status(409).json({
      pesan: 'Ada kemungkinan pembayaran ini sudah tercatat. Periksa dulu sebelum melanjutkan.',
      kode: 'perlu_konfirmasi_kembar',
      kandidat,
      peringatan,
    });
  }

  const { data, error } = await db
    .from('pembayaran_manual')
    .insert(hasil.nilai)
    .select(KOLOM_BAYAR)
    .single();
  if (error) throw error;

  res.status(201).json({ data, kandidat, peringatan });
}));

api.patch('/pembayaran/:id', jalur(async (req, res) => {
  if (!idUnggahanValid(req.params.id)) return res.status(404).json({ pesan: 'Pembayaran tidak ditemukan.' });

  const hasil = saringPerubahan(req.body ?? {});
  if (!hasil.ok) return res.status(422).json({ pesan: hasil.masalah.join(' '), masalah: hasil.masalah });

  // Barisnya sendiri dikecualikan dari pemeriksaan kembar; kalau tidak, setiap
  // penyuntingan akan melaporkan dirinya sendiri sebagai duplikat.
  const kandidat = cariKembar(
    { ...hasil.nilai, penerima: hasil.nilai.penerima },
    await barisPembanding(hasil.nilai),
    { abaikanId: req.params.id }
  );
  if (perluKonfirmasi(kandidat, hasil.nilai.sumber) && req.query.konfirmasi_kembar !== '1') {
    return res.status(409).json({
      pesan: 'Ada kemungkinan pembayaran ini sudah tercatat. Periksa dulu sebelum melanjutkan.',
      kode: 'perlu_konfirmasi_kembar',
      kandidat,
      peringatan: peringatanSumber(hasil.nilai.sumber),
    });
  }

  const { data, error } = await db
    .from('pembayaran_manual')
    .update(hasil.nilai)
    .eq('id', req.params.id)
    .select(KOLOM_BAYAR)
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Pembayaran tidak ditemukan.' });

  res.json({ data });
}));

api.delete('/pembayaran/:id', jalur(async (req, res) => {
  if (!idUnggahanValid(req.params.id)) return res.status(404).json({ pesan: 'Pembayaran tidak ditemukan.' });

  const oleh = String(req.query.oleh ?? '').trim();
  if (oleh === '') return res.status(422).json({ pesan: 'Kolom "Dihapus oleh" harus diisi.' });

  // Lewat fungsi database, bukan delete langsung: hanya di sana nama
  // penghapusnya bisa sampai ke trigger jejak perubahan. Baris yang dihapus
  // tidak menyisakan kolom untuk menuliskannya.
  const { data, error } = await db.rpc('hapus_pembayaran_manual', {
    p_id: req.params.id,
    p_oleh: oleh,
  });
  if (error) throw error;
  if (!data) return res.status(404).json({ pesan: 'Pembayaran tidak ditemukan.' });

  res.json({ terhapus: data });
}));

api.use('/audit', audit);

export default api;

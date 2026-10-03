// Integrasi Audit Rekon -> Supplier di alyssa-dev.
//
// Dua kelompok endpoint yang sengaja dipisah:
//
//   /tautan/*     dipakai LAYAR, dengan sesi Owner.
//   /integrasi/*  dipakai MESIN alyssa-dev, dengan token servis.
//
// Keduanya tidak pernah saling menerima autentikasi yang lain; aturannya ada
// di src/akses/kebijakan.js dan dijalankan middleware sebelum berkas ini.
//
// Seluruh pembacaan transaksi di sini menembak TABEL transaksi_bank, tidak
// pernah view transaksi_bank_unik. View itu melipat salinan, dan baris wakil
// yang muncul bisa berpindah ke uuid lain begitu salinan yang berbeda
// dikonfirmasi atau direkon — idempotency yang dikunci padanya akan
// meloloskan transaksi yang sama dua kali.

import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createAdminClient } from '../supabase.js';
import { ENTITAS, kodeEntitas } from '../rekonsiliasi/entitas.js';
import {
  STATUS, AKSI, SEBAB,
  kunciSaran, layakDitautkan, supplierValid, pilihSaran, layakDitarik, payloadPembayaran,
  normalSupplierId, POLA_SUPPLIER_ID,
} from './tautan.js';
import { lengkapiRingkasan, lengkapiRincian } from './ringkas.js';

const db = createAdminClient();
const api = Router();

const KOLOM_TRX = 'id, tanggal, keterangan, debit, kredit, referensi, no_rekening, entitas, sidik';
const KOLOM_TAUTAN =
  'transaksi_id, supplier_id, supplier_nama, entitas, tanggal, nominal, sidik, status, ' +
  'ditautkan_pada, ditautkan_oleh, batch_tarik, ditarik_pada, dibatalkan_pada, alasan';

const BATAS_TARIK = 500;
const POLA_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jalur(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

const pelaku = (req) => req.pengguna?.email ?? 'tidak diketahui';

/** Menulis satu baris riwayat. Tidak pernah menggagalkan permintaan. */
async function catatRiwayat(isi) {
  const { error } = await db.from('tautan_pembayaran_riwayat').insert(isi);
  if (error) console.error('[tautan] gagal menulis riwayat:', isi.aksi, error.message);
}

async function ambilTransaksi(id) {
  if (!POLA_UUID.test(String(id ?? ''))) return null;
  const { data, error } = await db.from('transaksi_bank').select(KOLOM_TRX).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

async function ambilTautan(id) {
  if (!POLA_UUID.test(String(id ?? ''))) return null;
  const { data, error } = await db
    .from('tautan_pembayaran').select(KOLOM_TAUTAN).eq('transaksi_id', id).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Salinan transaksi ini yang sudah ditautkan, selain dirinya sendiri.
 *
 * Satu transfer yang sama bisa punya DUA baris fisik di transaksi_bank ketika
 * ia masuk dari dua cetakan BCA yang berbeda — e-statement dan Mutasi menulis
 * kalimatnya berbeda, jadi sidik uniknya pun berbeda dan keduanya tersimpan.
 * Layar melipatnya, tetapi pengikatan menyimpan id fisik, sehingga tanpa
 * pemeriksaan ini satu transfer bisa ditautkan dua kali lewat dua id berbeda
 * dan dikirim dua kali ke alyssa-dev tanpa satu pun penjaga menyalak.
 *
 * Rumus sidik tampilannya dibaca dari view transaksi_bank_kembar, bukan
 * disalin ke JavaScript: salinan rumus yang menyimpang akan melewatkan kembar
 * yang seharusnya tertahan.
 */
async function kembarSudahDitaut(transaksiId) {
  const { data: diri, error: galatDiri } = await db
    .from('transaksi_bank_kembar').select('sidik_tampil').eq('id', transaksiId).maybeSingle();
  if (galatDiri) throw galatDiri;
  if (!diri?.sidik_tampil) return [];

  const { data: kembar, error: galatKembar } = await db
    .from('transaksi_bank_kembar').select('id').eq('sidik_tampil', diri.sidik_tampil).neq('id', transaksiId);
  if (galatKembar) throw galatKembar;

  const idLain = (kembar ?? []).map((k) => k.id);
  if (idLain.length === 0) return [];

  const { data: tautan, error } = await db
    .from('tautan_pembayaran').select(KOLOM_TAUTAN).in('transaksi_id', idLain).neq('status', STATUS.DIBATALKAN);
  if (error) throw error;
  return tautan ?? [];
}

// ===========================================================================
// LAYAR — sesi Owner
// ===========================================================================

/**
 * Saran supplier untuk satu transaksi.
 *
 * Tidak pernah memutuskan apa pun; ia hanya mengumpulkan bahan supaya manusia
 * memutuskan dengan cepat. Yang konflik dikembalikan apa adanya sebagai daftar
 * kandidat, tanpa satu pun dipilihkan.
 */
api.get('/tautan/saran', jalur(async (req, res) => {
  const transaksi = await ambilTransaksi(req.query.transaksi_id);
  if (!transaksi) return res.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });

  const tautan = await ambilTautan(transaksi.id);
  const kelayakan = layakDitautkan(transaksi, tautan);
  const kunci = kunciSaran(transaksi.keterangan);

  let kandidat = [];
  if (kunci) {
    const { data, error } = await db
      .from('pemetaan_supplier_status')
      .select('id, supplier_id, supplier_nama, no_rekening_tujuan, status, konflik')
      .eq('entitas', transaksi.entitas)
      .eq('kunci_saran', kunci);
    if (error) throw error;
    kandidat = data ?? [];
  }

  const { saran, konflik } = pilihSaran(kandidat);
  const kembar = await kembarSudahDitaut(transaksi.id);

  res.json({
    transaksi,
    tautan,
    kelayakan,
    kunci_saran: kunci,
    saran,
    konflik,
    kandidat,
    kembar_sudah_ditaut: kembar,
  });
}));

/** Daftar tautan, untuk lencana status di tabel. */
api.get('/tautan', jalur(async (req, res) => {
  let q = db.from('tautan_pembayaran').select(KOLOM_TAUTAN).order('ditautkan_pada', { ascending: false });

  if (req.query.status) q = q.eq('status', String(req.query.status));
  if (req.query.entitas) {
    const kode = kodeEntitas(req.query.entitas);
    if (!kode) return res.status(400).json({ pesan: 'Entitas tidak dikenali.' });
    q = q.eq('entitas', kode);
  }
  if (req.query.transaksi_id) {
    const daftar = String(req.query.transaksi_id).split(',').filter((x) => POLA_UUID.test(x));
    if (daftar.length === 0) return res.json({ data: [] });
    q = q.in('transaksi_id', daftar);
  }

  const { data, error } = await q.limit(2000);
  if (error) throw error;
  res.json({ data: data ?? [] });
}));

/** Pemetaan yang tersimpan, beserta tanda konfliknya. */
api.get('/tautan/pemetaan', jalur(async (req, res) => {
  const { data, error } = await db
    .from('pemetaan_supplier_status').select('*').order('dibuat_pada', { ascending: false }).limit(2000);
  if (error) throw error;

  const semua = data ?? [];
  const hanyaKonflik = String(req.query.status ?? '') === 'konflik';
  res.json({ data: hanyaKonflik ? semua.filter((p) => p.konflik) : semua });
}));

/**
 * Riwayat pembayaran per supplier, DIPISAH PER ENTITAS.
 *
 * PT dan CV membayar sebagian supplier yang sama dari rekening yang berbeda.
 * Menggabungkan totalnya membuat kewajiban satu perusahaan tampak terbayar
 * oleh uang perusahaan lain — kekeliruan yang tidak menimbulkan galat apa pun
 * dan baru ketahuan saat angkanya dipakai.
 */
api.get('/tautan/supplier', jalur(async (req, res) => {
  let q = db.from('riwayat_pembayaran_supplier').select('*');

  if (req.query.entitas) {
    const kode = kodeEntitas(req.query.entitas);
    if (!kode) return res.status(400).json({ pesan: 'Entitas tidak dikenali.' });
    q = q.eq('entitas', kode);
  }
  if (req.query.cari) {
    // Pencarian pada NAMA hanya jalan pintas untuk menemukan barisnya; yang
    // mengelompokkan tetap supplier_id.
    const kata = String(req.query.cari).trim().replace(/\s+/g, ' ');
    if (kata !== '') q = q.or(`supplier_nama.ilike.%${kata}%,supplier_id.ilike.%${kata}%`);
  }

  const { data, error } = await q.order('supplier_nama', { ascending: true }).limit(2000);
  if (error) throw error;

  res.json({ data: (data ?? []).map(lengkapiRingkasan) });
}));

/**
 * Rincian pembayaran satu supplier: tiap transaksi berdiri sendiri.
 *
 * Nama penerima bank diteruskan APA ADANYA. Itulah bukti siapa yang benar-benar
 * menerima transfer, dan satu-satunya yang bisa dicocokkan kembali ke mutasi
 * bank saat audit. Ia tidak pernah diganti dengan nama supplier administrasi.
 */
api.get('/tautan/supplier/:supplier_id', jalur(async (req, res) => {
  const kode = req.query.entitas ? kodeEntitas(req.query.entitas) : null;
  if (req.query.entitas && !kode) return res.status(400).json({ pesan: 'Entitas tidak dikenali.' });

  let q = db
    .from('tautan_pembayaran').select(KOLOM_TAUTAN)
    .eq('supplier_id', normalSupplierId(req.params.supplier_id))
    .neq('status', STATUS.DIBATALKAN);
  if (kode) q = q.eq('entitas', kode);

  const { data: tautan, error } = await q.order('tanggal', { ascending: true }).limit(2000);
  if (error) throw error;
  if ((tautan ?? []).length === 0) return res.json({ data: [], ringkasan: null });

  const idTrx = tautan.map((t) => t.transaksi_id);

  const { data: trx, error: galatTrx } = await db
    .from('transaksi_bank').select(KOLOM_TRX).in('id', idTrx);
  if (galatTrx) throw galatTrx;
  const petaTrx = new Map((trx ?? []).map((t) => [t.id, t]));

  const { data: alokasi, error: galatAlokasi } = await db
    .from('alokasi_pembayaran').select('transaksi_id, keterangan, dicatat_pada, dicatat_oleh')
    .in('transaksi_id', idTrx);
  if (galatAlokasi) throw galatAlokasi;
  const petaAlokasi = new Map((alokasi ?? []).map((a) => [a.transaksi_id, a]));

  let ringkasan = null;
  if (kode) {
    const { data: r, error: galatR } = await db
      .from('riwayat_pembayaran_supplier').select('*')
      .eq('supplier_id', normalSupplierId(req.params.supplier_id)).eq('entitas', kode).maybeSingle();
    if (galatR) throw galatR;
    ringkasan = r ? lengkapiRingkasan(r) : null;
  }

  res.json({
    ringkasan,
    data: tautan.map((t) => lengkapiRincian(t, petaTrx.get(t.transaksi_id), petaAlokasi.get(t.transaksi_id))),
  });
}));

/**
 * Menetapkan kewajiban supplier. OPSIONAL.
 *
 * Tanpa baris ini, sisa pembayaran dilaporkan TIDAK DIKETAHUI — bukan nol.
 * Nol berarti lunas, dan itu kesimpulan yang tidak boleh ditebak dari
 * kewajiban yang memang belum pernah ditetapkan.
 */
api.put('/tautan/kewajiban/:supplier_id', jalur(async (req, res) => {
  const { entitas, nilai, catatan } = req.body ?? {};

  // supplier_id datang dari URL, bukan dari body, jadi ia melewati
  // supplierValid() yang menjaga kedua jalur lainnya. Diperiksa di sini
  // dengan pola yang sama: tanpa ini, kewajiban bisa ditetapkan atas id yang
  // tidak pernah ada di alyssa-dev, dan barisnya tidak akan pernah berpasangan
  // dengan pembayaran mana pun — tampak sebagai supplier yang tidak pernah
  // dibayar sepeser pun.
  const supplierId = normalSupplierId(req.params.supplier_id);
  if (!POLA_SUPPLIER_ID.test(supplierId)) {
    return res.status(400).json({
      pesan: 'supplier_id harus tepat 8 digit heksadesimal dari Master Supplier alyssa-dev.',
      kode: SEBAB.SUPPLIER_TIDAK_CANONICAL,
    });
  }

  const kode = kodeEntitas(entitas);
  if (!kode) return res.status(400).json({ pesan: 'Entitas wajib disebut: PT atau CV.' });

  const angka = Number(nilai);
  if (!Number.isFinite(angka) || angka < 0) {
    return res.status(400).json({ pesan: 'Nilai kewajiban harus angka tidak negatif.' });
  }

  const { data, error } = await db
    .from('kewajiban_supplier')
    .upsert({
      supplier_id: supplierId,
      entitas: kode,
      nilai: angka,
      catatan: catatan?.trim() || null,
      ditetapkan_pada: new Date().toISOString(),
      ditetapkan_oleh: pelaku(req),
    }, { onConflict: 'supplier_id,entitas' })
    .select()
    .single();
  if (error) throw error;

  res.json(data);
}));

/**
 * Alokasi manual: catatan pekerjaan/proyek selama PO belum tertib.
 *
 * Teks bebas, dan TIDAK satu pun total dihitung darinya. Ia keterangan audit,
 * bukan penggerak angka — supaya catatan yang keliru tidak pernah bisa
 * menggeser jumlah uang.
 */
api.put('/tautan/alokasi/:transaksi_id', jalur(async (req, res) => {
  const keterangan = String(req.body?.keterangan ?? '').trim();
  if (!POLA_UUID.test(String(req.params.transaksi_id))) {
    return res.status(400).json({ pesan: 'transaksi_id tidak sah.' });
  }

  if (keterangan === '') {
    const { error } = await db.from('alokasi_pembayaran').delete().eq('transaksi_id', req.params.transaksi_id);
    if (error) throw error;
    return res.json({ transaksi_id: req.params.transaksi_id, keterangan: null });
  }

  const { data, error } = await db
    .from('alokasi_pembayaran')
    .upsert({
      transaksi_id: req.params.transaksi_id,
      keterangan,
      dicatat_pada: new Date().toISOString(),
      dicatat_oleh: pelaku(req),
    }, { onConflict: 'transaksi_id' })
    .select()
    .single();
  if (error) throw error;

  res.json(data);
}));

/**
 * Mengikat satu transaksi ke satu supplier.
 *
 * Penolakannya berlapis dan masing-masing menyebut sebabnya, bukan satu pesan
 * umum: yang ditolak di sini adalah uang, dan orang yang tidak tahu kenapa
 * ditolak akan mencari jalan lain.
 */
api.post('/tautan', jalur(async (req, res) => {
  const { transaksi_id, supplier_id, supplier_nama, no_rekening_tujuan, ingat = true } = req.body ?? {};

  const sah = supplierValid({ supplier_id, supplier_nama });
  if (!sah.ok) return res.status(400).json({ pesan: sah.pesan, kode: sah.sebab });

  const transaksi = await ambilTransaksi(transaksi_id);
  if (!transaksi) return res.status(404).json({ pesan: 'Transaksi tidak ditemukan.' });

  const tautanLama = await ambilTautan(transaksi.id);
  const kelayakan = layakDitautkan(transaksi, tautanLama);
  if (!kelayakan.ok) return res.status(409).json({ pesan: kelayakan.pesan, kode: kelayakan.sebab });

  const kembar = await kembarSudahDitaut(transaksi.id);
  if (kembar.length > 0) {
    return res.status(409).json({
      pesan: 'Salinan transaksi ini dari cetakan lain sudah ditautkan. '
        + 'Satu transfer hanya boleh dibayarkan sekali.',
      kode: SEBAB.KEMBAR_SUDAH_DITAUT,
      kembar,
    });
  }

  const baris = {
    transaksi_id: transaksi.id,
    supplier_id: sah.supplier_id,
    supplier_nama: sah.supplier_nama,
    entitas: transaksi.entitas,
    tanggal: transaksi.tanggal,
    nominal: transaksi.debit,
    sidik: transaksi.sidik,
    status: STATUS.SIAP,
    ditautkan_oleh: pelaku(req),
    // Tautan yang pernah dibatalkan boleh dipakai lagi; kolom pembatalannya
    // dikosongkan supaya tidak tertinggal menerangkan keadaan yang sudah lewat.
    dibatalkan_pada: null,
    dibatalkan_oleh: null,
    alasan: null,
    batch_tarik: null,
    ditarik_pada: null,
  };

  // upsert, bukan insert: baris berstatus 'dibatalkan' masih memegang kunci
  // primernya, dan insert biasa akan gagal dengan galat kunci ganda yang
  // membingungkan padahal keadaannya sah.
  const { data, error } = await db
    .from('tautan_pembayaran').upsert(baris, { onConflict: 'transaksi_id' }).select(KOLOM_TAUTAN).single();
  if (error) throw error;

  await catatRiwayat({
    transaksi_id: transaksi.id,
    aksi: AKSI.TAUTKAN,
    supplier_id_baru: data.supplier_id,
    status_lama: tautanLama?.status ?? null,
    status_baru: data.status,
    oleh: pelaku(req),
  });

  // Diingat untuk saran berikutnya. Kegagalannya tidak menggagalkan
  // pengikatan: yang penting sudah tersimpan, ingatan cuma pemanis.
  const kunci = kunciSaran(transaksi.keterangan);
  if (ingat && kunci) {
    const { error: galatPeta } = await db.from('pemetaan_supplier').insert({
      supplier_id: data.supplier_id,
      supplier_nama: data.supplier_nama,
      entitas: transaksi.entitas,
      kunci_saran: kunci,
      no_rekening_tujuan: no_rekening_tujuan ?? null,
      dibuat_oleh: pelaku(req),
    });
    if (galatPeta) console.error('[tautan] gagal menyimpan pemetaan:', galatPeta.message);
  }

  res.status(201).json(data);
}));

/**
 * Koreksi supplier.
 *
 * Dua keadaan yang sengaja diperlakukan sangat berbeda:
 *
 *   BELUM ditarik  -> diubah langsung. Tidak ada pihak lain yang sudah tahu.
 *   SUDAH ditarik  -> status menjadi 'perlu_koreksi_hilir'. alyssa-dev sudah
 *                     mencatat pembayaran ke supplier yang lama; mengubahnya
 *                     di sini tanpa memberi tahu akan membuat dua buku besar
 *                     berbeda tanpa satu pun galat, dan selisih itu baru
 *                     ketahuan saat saldonya dipakai.
 */
api.patch('/tautan/:transaksi_id', jalur(async (req, res) => {
  const { supplier_id, supplier_nama, alasan } = req.body ?? {};
  const sah = supplierValid({ supplier_id, supplier_nama });
  if (!sah.ok) return res.status(400).json({ pesan: sah.pesan, kode: sah.sebab });

  const tautan = await ambilTautan(req.params.transaksi_id);
  if (!tautan) return res.status(404).json({ pesan: 'Tautan tidak ditemukan.' });
  if (tautan.status === STATUS.DIBATALKAN) {
    return res.status(409).json({ pesan: 'Tautan ini sudah dibatalkan. Tautkan ulang saja.' });
  }

  const sudahKeluar = tautan.status === STATUS.DITARIK || tautan.status === STATUS.PERLU_KOREKSI_HILIR;
  const statusBaru = sudahKeluar ? STATUS.PERLU_KOREKSI_HILIR : STATUS.SIAP;

  const { data, error } = await db
    .from('tautan_pembayaran')
    .update({
      supplier_id: sah.supplier_id,
      supplier_nama: sah.supplier_nama,
      status: statusBaru,
      alasan: alasan ?? null,
    })
    .eq('transaksi_id', tautan.transaksi_id)
    .select(KOLOM_TAUTAN)
    .single();
  if (error) throw error;

  await catatRiwayat({
    transaksi_id: tautan.transaksi_id,
    aksi: sudahKeluar ? AKSI.KOREKSI_HILIR : AKSI.UBAH_SUPPLIER,
    supplier_id_lama: tautan.supplier_id,
    supplier_id_baru: data.supplier_id,
    status_lama: tautan.status,
    status_baru: data.status,
    alasan: alasan ?? null,
    oleh: pelaku(req),
  });

  res.json({
    ...data,
    menunggu_alyssa_dev: sudahKeluar,
    pesan: sudahKeluar
      ? 'Pembayaran ini sudah ditarik alyssa-dev. Koreksinya menunggu diakui di sana.'
      : null,
  });
}));

/**
 * Membatalkan tautan yang BELUM ditarik.
 *
 * Yang sudah ditarik tidak disediakan tombol batalnya. Uangnya sudah keluar
 * dari rekening; yang bisa dibatalkan hanya pencatatannya, dan itu keputusan
 * akuntansi di alyssa-dev, bukan di alat audit.
 */
api.delete('/tautan/:transaksi_id', jalur(async (req, res) => {
  const tautan = await ambilTautan(req.params.transaksi_id);
  if (!tautan) return res.status(404).json({ pesan: 'Tautan tidak ditemukan.' });

  if (tautan.status !== STATUS.SIAP) {
    return res.status(409).json({
      pesan: 'Hanya tautan yang belum ditarik yang bisa dibatalkan.',
      kode: SEBAB.SUDAH_DITARIK,
    });
  }

  const { data, error } = await db
    .from('tautan_pembayaran')
    .update({
      status: STATUS.DIBATALKAN,
      dibatalkan_pada: new Date().toISOString(),
      dibatalkan_oleh: pelaku(req),
      alasan: req.body?.alasan ?? null,
    })
    .eq('transaksi_id', tautan.transaksi_id)
    .eq('status', STATUS.SIAP)
    .select(KOLOM_TAUTAN)
    .single();
  if (error) throw error;

  await catatRiwayat({
    transaksi_id: tautan.transaksi_id,
    aksi: AKSI.BATAL,
    supplier_id_lama: tautan.supplier_id,
    status_lama: tautan.status,
    status_baru: data.status,
    alasan: req.body?.alasan ?? null,
    oleh: pelaku(req),
  });

  res.json(data);
}));

// ===========================================================================
// INTEGRASI — token servis, dipanggil alyssa-dev
// ===========================================================================

/**
 * Transaksi yang siap ditarik.
 *
 * MURNI BACA. Tidak menandai apa pun, dan itu wajib.
 *
 * Kalau pembacaan yang menandai, satu alyssa-dev yang mati di tengah jalan
 * akan membuat pembayaran hilang selamanya: Felis-Alyssa menganggap sudah
 * terkirim, alyssa-dev tidak pernah menyimpannya, dan tidak ada gejala apa pun
 * sampai saldonya dipakai. Dengan dua fase, kegagalan menghasilkan penarikan
 * ULANG — yang ditahan idempotency_key di kedua sisi.
 */
api.get('/integrasi/siap-tarik', jalur(async (req, res) => {
  let q = db.from('tautan_pembayaran').select(KOLOM_TAUTAN).eq('status', STATUS.SIAP);

  if (req.query.entitas) {
    const kode = kodeEntitas(req.query.entitas);
    if (!kode) return res.status(400).json({ pesan: 'Entitas tidak dikenali.' });
    q = q.eq('entitas', kode);
  }
  if (req.query.dari) q = q.gte('tanggal', String(req.query.dari));
  if (req.query.sampai) q = q.lte('tanggal', String(req.query.sampai));

  const batas = Math.min(Number(req.query.batas) || BATAS_TARIK, BATAS_TARIK);
  const { data, error } = await q.order('tanggal', { ascending: true }).limit(batas);
  if (error) throw error;

  const tautan = (data ?? []).filter((t) => layakDitarik(t).ok);
  if (tautan.length === 0) {
    return res.json({ batch: randomUUID(), dibuat_pada: new Date().toISOString(), jumlah: 0, data: [] });
  }

  const idTrx = tautan.map((t) => t.transaksi_id);

  const { data: trx, error: galatTrx } = await db
    .from('transaksi_bank').select(KOLOM_TRX).in('id', idTrx);
  if (galatTrx) throw galatTrx;
  const petaTrx = new Map((trx ?? []).map((t) => [t.id, t]));

  // Alokasi pekerjaan/proyek bila auditor sudah mencatatnya. Kegagalannya
  // tidak menggagalkan penarikan: alokasi adalah keterangan, sedangkan yang
  // dibawa payload ini uang. Larik kosong adalah keadaan yang sah menurut
  // kontrak, jadi ketiadaannya tidak pernah menjadi galat di sisi penarik.
  let petaAlokasi = new Map();
  const { data: alokasi, error: galatAlokasi } = await db
    .from('alokasi_pembayaran').select('transaksi_id, keterangan').in('transaksi_id', idTrx);
  if (galatAlokasi) console.error('[integrasi] gagal membaca alokasi:', galatAlokasi.message);
  else petaAlokasi = new Map((alokasi ?? []).map((a) => [a.transaksi_id, a]));

  res.json({
    batch: randomUUID(),
    dibuat_pada: new Date().toISOString(),
    jumlah: tautan.length,
    data: tautan.map((t) => payloadPembayaran(
      t, petaTrx.get(t.transaksi_id), ENTITAS[t.entitas], petaAlokasi.get(t.transaksi_id)
    )),
  });
}));

/**
 * Konfirmasi bahwa alyssa-dev sudah menyimpan batch ini.
 *
 * Idempoten: mengirim batch yang sama dua kali mengembalikan hasil yang sama
 * tanpa menulis apa pun pada kali kedua. Yang sudah ditarik batch LAIN
 * dilaporkan terpisah, tidak diam-diam ditimpa — itu tanda ada dua penarik
 * yang berjalan bersamaan, dan menimpanya akan menyembunyikan persis hal yang
 * harus terlihat.
 */
api.post('/integrasi/tandai-tertarik', jalur(async (req, res) => {
  const { batch, transaksi_id } = req.body ?? {};
  if (!POLA_UUID.test(String(batch ?? ''))) {
    return res.status(400).json({ pesan: 'batch wajib berupa uuid.' });
  }
  if (!Array.isArray(transaksi_id) || transaksi_id.length === 0) {
    return res.status(400).json({ pesan: 'transaksi_id wajib berupa daftar tidak kosong.' });
  }
  const daftar = transaksi_id.filter((x) => POLA_UUID.test(String(x)));
  if (daftar.length === 0) return res.status(400).json({ pesan: 'Tidak ada transaksi_id yang sah.' });

  const { data: sebelum, error: galatBaca } = await db
    .from('tautan_pembayaran').select(KOLOM_TAUTAN).in('transaksi_id', daftar);
  if (galatBaca) throw galatBaca;
  const peta = new Map((sebelum ?? []).map((t) => [t.transaksi_id, t]));

  // Penandaannya bersyarat status: dua penarik yang berjalan bersamaan tidak
  // bisa sama-sama berhasil menandai baris yang sama, karena yang kedua tidak
  // menemukan baris berstatus 'siap' lagi.
  const { data: ditandai, error } = await db
    .from('tautan_pembayaran')
    .update({ status: STATUS.DITARIK, batch_tarik: batch, ditarik_pada: new Date().toISOString() })
    .in('transaksi_id', daftar)
    .eq('status', STATUS.SIAP)
    .select(KOLOM_TAUTAN);
  if (error) throw error;

  const baru = ditandai ?? [];
  for (const t of baru) {
    await catatRiwayat({
      transaksi_id: t.transaksi_id,
      aksi: AKSI.TARIK,
      supplier_id_baru: t.supplier_id,
      status_lama: STATUS.SIAP,
      status_baru: STATUS.DITARIK,
      alasan: `batch ${batch}`,
      oleh: pelaku(req),
    });
  }

  const sudahBatchIni = [];
  const sudahBatchLain = [];
  const tidakDikenal = [];
  for (const id of daftar) {
    if (baru.some((t) => t.transaksi_id === id)) continue;
    const lama = peta.get(id);
    if (!lama) { tidakDikenal.push(id); continue; }
    if (lama.batch_tarik === batch) sudahBatchIni.push(id);
    else sudahBatchLain.push({ transaksi_id: id, status: lama.status, batch_tarik: lama.batch_tarik });
  }

  res.json({
    batch,
    ditandai: baru.length,
    sudah_batch_ini: sudahBatchIni.length,
    sudah_batch_lain: sudahBatchLain,
    tidak_dikenal: tidakDikenal,
  });
}));

/** Koreksi yang menunggu diproses alyssa-dev. */
api.get('/integrasi/koreksi', jalur(async (req, res) => {
  const { data, error } = await db
    .from('tautan_pembayaran').select(KOLOM_TAUTAN).eq('status', STATUS.PERLU_KOREKSI_HILIR).limit(BATAS_TARIK);
  if (error) throw error;

  const tautan = data ?? [];
  if (tautan.length === 0) return res.json({ jumlah: 0, data: [] });

  // supplier lama dibaca dari riwayat, bukan ditebak: barisnya sendiri sudah
  // memuat supplier yang BARU.
  const { data: riwayat, error: galatRiwayat } = await db
    .from('tautan_pembayaran_riwayat')
    .select('transaksi_id, supplier_id_lama, supplier_id_baru, alasan, pada')
    .eq('aksi', AKSI.KOREKSI_HILIR)
    .in('transaksi_id', tautan.map((t) => t.transaksi_id))
    .order('pada', { ascending: false });
  if (galatRiwayat) throw galatRiwayat;

  const terbaru = new Map();
  for (const r of riwayat ?? []) if (!terbaru.has(r.transaksi_id)) terbaru.set(r.transaksi_id, r);

  res.json({
    jumlah: tautan.length,
    data: tautan.map((t) => ({
      bank_transaction_id: t.transaksi_id,
      idempotency_key: t.transaksi_id,
      supplier_id_lama: terbaru.get(t.transaksi_id)?.supplier_id_lama ?? null,
      supplier_id_baru: t.supplier_id,
      supplier_name_baru: t.supplier_nama,
      nominal: Number(t.nominal),
      tanggal: t.tanggal,
      alasan: terbaru.get(t.transaksi_id)?.alasan ?? null,
    })),
  });
}));

/** alyssa-dev mengaku sudah memproses koreksinya. */
api.post('/integrasi/koreksi/akui', jalur(async (req, res) => {
  const { transaksi_id } = req.body ?? {};
  if (!Array.isArray(transaksi_id) || transaksi_id.length === 0) {
    return res.status(400).json({ pesan: 'transaksi_id wajib berupa daftar tidak kosong.' });
  }
  const daftar = transaksi_id.filter((x) => POLA_UUID.test(String(x)));
  if (daftar.length === 0) return res.status(400).json({ pesan: 'Tidak ada transaksi_id yang sah.' });

  const { data, error } = await db
    .from('tautan_pembayaran')
    .update({ status: STATUS.DITARIK })
    .in('transaksi_id', daftar)
    .eq('status', STATUS.PERLU_KOREKSI_HILIR)
    .select(KOLOM_TAUTAN);
  if (error) throw error;

  for (const t of data ?? []) {
    await catatRiwayat({
      transaksi_id: t.transaksi_id,
      aksi: AKSI.AKUI_KOREKSI,
      supplier_id_baru: t.supplier_id,
      status_lama: STATUS.PERLU_KOREKSI_HILIR,
      status_baru: STATUS.DITARIK,
      oleh: pelaku(req),
    });
  }

  res.json({ diakui: (data ?? []).length });
}));

export default api;

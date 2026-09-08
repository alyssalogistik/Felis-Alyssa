// Mesin pencocokan tagihan supplier dengan transaksi rekening koran.
//
// Murni: menerima data, mengembalikan hasil. Tidak menyentuh database maupun
// jaringan, sehingga seluruh aturan audit bisa diuji tanpa keduanya.
//
// Kaidah yang dipegang di sini: nominal tidak pernah menjadi syarat kelayakan,
// hanya penentu status. Kalau nominal dijadikan syarat, transfer yang kurang
// bayar akan hilang dari hasil — padahal justru itu yang paling perlu
// ketahuan saat audit.

/** Kata badan usaha dan awalan pembayaran yang tidak membedakan identitas supplier. */
const KATA_ABAIKAN = new Set([
  'pt', 'cv', 'ud', 'tbk', 'persero', 'pma', 'pmdn',
  'transfer', 'trf', 'trsf', 'pembayaran', 'bayar', 'pemb', 'payment', 'pay',
  'ke', 'kepada', 'to', 'dari', 'from', 'via', 'an', 'a', 'n',
  'inv', 'invoice', 'tagihan', 'no', 'nomor',
]);

export const STATUS = {
  MATCH: 'MATCH',
  KURANG_BAYAR: 'KURANG_BAYAR',
  LEBIH_BAYAR: 'LEBIH_BAYAR',
  INVOICE_BELUM_ADA_TRANSFER: 'INVOICE_BELUM_ADA_TRANSFER',
  TRANSFER_TANPA_INVOICE: 'TRANSFER_TANPA_INVOICE',
  PERLU_REVIEW: 'PERLU_REVIEW',
};

export const BAWAAN = {
  // Selisih di bawah ini dianggap pembulatan bank, bukan kurang bayar.
  toleransiNominal: 1000,
  // Transfer boleh mendahului tanggal invoice (uang muka) sampai sekian hari.
  hariSebelum: 7,
  // dan menyusul sampai sekian hari sesudahnya.
  hariSesudah: 120,
  // Di bawah ini kandidat tidak dianggap cocok sama sekali.
  ambangKemiripan: 0.34,
  // Di bawah ini hasilnya ditandai PERLU_REVIEW walau ada kandidat terbaik.
  ambangKeyakinan: 0.6,
};

/** Uang dibandingkan dalam satuan sen agar pecahan biner tidak menumpuk. */
const sen = (n) => Math.round(Number(n ?? 0) * 100);

/**
 * Menyeragamkan nama supplier supaya "PT. Trio Putra Trans" dan
 * "TRIO PUTRA TRANS MANDIRI" bisa dibandingkan.
 */
export function normalkanNama(teks) {
  return String(teks ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((kata) => kata !== '' && !KATA_ABAIKAN.has(kata.toLowerCase()))
    .join(' ')
    .trim();
}

/**
 * Kemiripan dua nama, 0 sampai 1.
 *
 * Memakai irisan kata, bukan jarak huruf: keterangan rekening koran biasanya
 * menambahkan kata ("PT TRIO PUTRA TRANS MANDIRI" untuk supplier "Trio Putra"),
 * dan jarak huruf menghukum penambahan itu terlalu keras. Nama yang seluruh
 * katanya termuat di keterangan dianggap cocok penuh.
 */
export function kemiripanNama(namaSupplier, keterangan) {
  const a = normalkanNama(namaSupplier);
  const b = normalkanNama(keterangan);
  if (a === '' || b === '') return 0;

  const kataA = a.split(' ');
  const kataB = new Set(b.split(' '));
  const cocok = kataA.filter((kata) => kataB.has(kata)).length;
  if (cocok === 0) return 0;

  // Seluruh kata supplier muncul di keterangan: identitasnya utuh, kata
  // tambahan di keterangan tidak mengurangi keyakinan.
  if (cocok === kataA.length) return 1;

  // Selain itu, proporsi kata supplier yang ditemukan.
  return cocok / kataA.length;
}

/**
 * Mencari nomor invoice di dalam keterangan transaksi.
 * Pemisah diabaikan supaya "INV/2026/VIII/0042" cocok dengan "INV-2026-VIII-0042".
 */
export function nomorInvoiceDitemukan(noInvoice, keterangan) {
  const bersih = (t) => String(t ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nomor = bersih(noInvoice);
  // Nomor terlalu pendek gampang cocok kebetulan; jangan dijadikan bukti.
  if (nomor.length < 4) return false;
  return bersih(keterangan).includes(nomor);
}

/** Selisih hari antara dua tanggal `YYYY-MM-DD`, positif bila b sesudah a. */
export function selisihHari(a, b) {
  if (!a || !b) return null;
  const ms = Date.UTC(...b.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)))
           - Date.UTC(...a.split('-').map(Number).map((n, i) => (i === 1 ? n - 1 : n)));
  return Math.round(ms / 86400000);
}

/**
 * Menilai satu pasangan tagihan-transaksi.
 *
 * Kelayakan ditentukan identitas (nama atau nomor invoice) dan waktu.
 * Nominal hanya menambah keyakinan, tidak pernah menggugurkan kandidat.
 */
export function nilaiKandidat(tagihan, transaksi, opsi = {}) {
  const o = { ...BAWAAN, ...opsi };
  const alasan = [];

  const jarak = selisihHari(tagihan.tanggal_invoice, transaksi.tanggal);
  if (jarak === null) return { layak: false, keyakinan: 0, alasan: ['Tanggal tidak lengkap.'] };
  if (jarak < -o.hariSebelum || jarak > o.hariSesudah) {
    return { layak: false, keyakinan: 0, alasan: [`Beda ${jarak} hari, di luar rentang.`] };
  }

  const adaNomor = nomorInvoiceDitemukan(tagihan.no_invoice, transaksi.keterangan);
  const mirip = kemiripanNama(tagihan.pemasok_nama, transaksi.keterangan);

  // Nomor invoice adalah bukti terkuat: nomor itu unik, nama tidak.
  if (!adaNomor && mirip < o.ambangKemiripan) {
    return { layak: false, keyakinan: 0, alasan: ['Nama supplier tidak cocok dan nomor invoice tidak ditemukan.'] };
  }

  let keyakinan = 0;
  if (adaNomor) {
    keyakinan += 0.45;
    alasan.push(`Nomor invoice ${tagihan.no_invoice} ada di keterangan.`);
  }
  if (mirip > 0) {
    keyakinan += 0.3 * mirip;
    alasan.push(
      mirip === 1
        ? 'Nama supplier cocok penuh.'
        : `Nama supplier cocok sebagian (${Math.round(mirip * 100)}%).`
    );
  }

  // Kedekatan nominal. Cocok dengan net (setelah PPh) adalah bukti paling kuat,
  // karena itulah yang benar-benar keluar dari rekening.
  const net = sen(tagihan.gross) - sen(tagihan.pph);
  const bayar = sen(transaksi.debit) > 0 ? sen(transaksi.debit) : sen(transaksi.kredit);
  const bedaNet = Math.abs(bayar - net);
  const bedaGross = Math.abs(bayar - sen(tagihan.gross));
  const toleransi = sen(o.toleransiNominal);

  if (bedaNet <= toleransi) {
    keyakinan += 0.35;
    alasan.push(sen(tagihan.pph) > 0 ? 'Nominal cocok dengan net setelah PPh.' : 'Nominal cocok.');
  } else if (bedaGross <= toleransi) {
    keyakinan += 0.2;
    alasan.push('Nominal cocok dengan gross — PPh sepertinya belum dipotong.');
  } else {
    // Makin dekat makin dipercaya, tapi tidak pernah menggugurkan.
    const rasio = net === 0 ? 1 : Math.min(bedaNet / Math.abs(net), 1);
    keyakinan += 0.15 * (1 - rasio);
  }

  // Pembayaran yang wajar terjadi tak lama sesudah tanggal invoice.
  const rentang = jarak >= 0 ? o.hariSesudah : o.hariSebelum;
  keyakinan += 0.2 * (1 - Math.min(Math.abs(jarak) / rentang, 1));
  alasan.push(`Transfer ${jarak >= 0 ? `${jarak} hari sesudah` : `${-jarak} hari sebelum`} tanggal invoice.`);

  return { layak: true, keyakinan: Math.min(keyakinan, 1), alasan, jarak_hari: jarak };
}

/** Status dari selisih antara yang ditransfer dan yang seharusnya. */
export function statusDariSelisih(selisih, toleransi = BAWAAN.toleransiNominal) {
  if (Math.abs(sen(selisih)) <= sen(toleransi)) return STATUS.MATCH;
  return sen(selisih) < 0 ? STATUS.KURANG_BAYAR : STATUS.LEBIH_BAYAR;
}

/**
 * Mencocokkan seluruh tagihan dengan seluruh transaksi.
 *
 * Penetapan dilakukan serakah dari keyakinan tertinggi, dan satu transaksi
 * hanya boleh membayar satu tagihan. Kalau dibiarkan banyak-ke-banyak, satu
 * transfer bisa membuat beberapa tagihan tampak lunas sekaligus — kesalahan
 * yang justru fatal dalam audit.
 *
 * @param {Array} tagihan   { id, pemasok_id, pemasok_nama, no_invoice, tanggal_invoice, gross, pph }
 * @param {Array} transaksi { id, tanggal, keterangan, debit, kredit }
 * @param {object} opsi     Menimpa BAWAAN.
 */
export function cocokkan(tagihan, transaksi, opsi = {}) {
  const o = { ...BAWAAN, ...opsi };

  // Pembayaran ke supplier adalah uang keluar. Transaksi masuk tidak ikut
  // dicocokkan supaya penerimaan dari customer tidak salah dibaca sebagai
  // pembayaran tagihan.
  const keluar = transaksi.filter((t) => Number(t.debit) > 0);

  const pasangan = [];
  for (const inv of tagihan) {
    for (const trx of keluar) {
      const nilai = nilaiKandidat(inv, trx, o);
      if (nilai.layak) pasangan.push({ inv, trx, ...nilai });
    }
  }
  pasangan.sort((a, b) => b.keyakinan - a.keyakinan);

  const tagihanTerpakai = new Map();
  const transaksiTerpakai = new Set();

  for (const p of pasangan) {
    if (tagihanTerpakai.has(p.inv.id) || transaksiTerpakai.has(p.trx.id)) continue;
    tagihanTerpakai.set(p.inv.id, p);
    transaksiTerpakai.add(p.trx.id);
  }

  // Kandidat yang kalah tetap ditawarkan, termasuk untuk tagihan yang sudah
  // dapat pasangan: justru di situ pengguna paling perlu bisa membantah pilihan
  // mesin ketika nama supplier tidak persis sama. Urutannya sudah dari
  // keyakinan tertinggi karena `pasangan` telah diurutkan.
  const kandidatLain = new Map();
  for (const p of pasangan) {
    if (tagihanTerpakai.get(p.inv.id)?.trx.id === p.trx.id) continue;
    const daftar = kandidatLain.get(p.inv.id) ?? [];
    if (daftar.length < 3) {
      daftar.push(p);
      kandidatLain.set(p.inv.id, daftar);
    }
  }

  const hasil = tagihan.map((inv) => {
    const net = (sen(inv.gross) - sen(inv.pph)) / 100;
    const menang = tagihanTerpakai.get(inv.id);
    const lain = (kandidatLain.get(inv.id) ?? []).map((p) => ({
      transaksi_id: p.trx.id,
      keterangan: p.trx.keterangan,
      tanggal: p.trx.tanggal,
      nominal: Number(p.trx.debit),
      keyakinan: Number(p.keyakinan.toFixed(3)),
    }));

    if (!menang) {
      return {
        tagihan_id: inv.id,
        pemasok_nama: inv.pemasok_nama,
        no_invoice: inv.no_invoice,
        tanggal_invoice: inv.tanggal_invoice,
        gross: Number(inv.gross),
        pph: Number(inv.pph ?? 0),
        net_seharusnya: net,
        transaksi_id: null,
        transfer_bank: null,
        selisih: null,
        status: STATUS.INVOICE_BELUM_ADA_TRANSFER,
        keyakinan: 0,
        alasan: ['Tidak ada transaksi keluar yang cocok dalam rentang tanggal.'],
        kandidat_lain: lain,
      };
    }

    const bayar = Number(menang.trx.debit);
    const selisih = (sen(bayar) - sen(net)) / 100;
    const status = menang.keyakinan < o.ambangKeyakinan
      ? STATUS.PERLU_REVIEW
      : statusDariSelisih(selisih, o.toleransiNominal);

    return {
      tagihan_id: inv.id,
      pemasok_nama: inv.pemasok_nama,
      no_invoice: inv.no_invoice,
      tanggal_invoice: inv.tanggal_invoice,
      gross: Number(inv.gross),
      pph: Number(inv.pph ?? 0),
      net_seharusnya: net,
      transaksi_id: menang.trx.id,
      transaksi_tanggal: menang.trx.tanggal,
      transaksi_keterangan: menang.trx.keterangan,
      transfer_bank: bayar,
      selisih,
      status,
      keyakinan: Number(menang.keyakinan.toFixed(3)),
      jarak_hari: menang.jarak_hari,
      alasan: menang.keyakinan < o.ambangKeyakinan
        ? [...menang.alasan, `Keyakinan ${Math.round(menang.keyakinan * 100)}% di bawah ambang, perlu diperiksa manusia.`]
        : menang.alasan,
      kandidat_lain: lain,
    };
  });

  // Uang keluar yang tidak terhubung tagihan mana pun. Ini sisi lain audit:
  // bukan tagihan yang belum dibayar, tapi pembayaran tanpa dasar tagihan.
  const tanpaTagihan = keluar
    .filter((t) => !transaksiTerpakai.has(t.id))
    .map((t) => ({
      transaksi_id: t.id,
      tanggal: t.tanggal,
      keterangan: t.keterangan,
      transfer_bank: Number(t.debit),
      status: STATUS.TRANSFER_TANPA_INVOICE,
    }));

  return { hasil, tanpa_tagihan: tanpaTagihan };
}

/** Ringkasan per status, untuk kepala halaman audit. */
export function ringkasAudit({ hasil, tanpa_tagihan }) {
  const per_status = Object.fromEntries(Object.values(STATUS).map((s) => [s, 0]));
  let selisihSen = 0;

  for (const h of hasil) {
    per_status[h.status] += 1;
    if (h.selisih !== null) selisihSen += sen(h.selisih);
  }
  per_status[STATUS.TRANSFER_TANPA_INVOICE] = tanpa_tagihan.length;

  const perluPerhatian =
    hasil.length - per_status[STATUS.MATCH] + tanpa_tagihan.length;

  return {
    total_tagihan: hasil.length,
    total_selisih: selisihSen / 100,
    perlu_perhatian: perluPerhatian,
    per_status,
  };
}

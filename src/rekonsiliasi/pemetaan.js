// Mengenali baris header rekening koran dan memetakan kolomnya ke struktur internal.
//
// Pemetaan dilakukan berdasarkan NAMA header, bukan posisi kolom, karena setiap
// bank menyusun kolomnya berbeda dan sebagian menyisipkan kolom kosong.

/** Kata kunci per bidang untuk rekening koran. Dicocokkan setelah nama header dinormalisasi. */
export const KAMUS_KORAN = {
  tanggal:    ['tanggal', 'tgl', 'date', 'tanggaltransaksi', 'transactiondate', 'postingdate', 'tgltransaksi', 'valuedate'],
  keterangan: ['keterangan', 'description', 'deskripsi', 'uraian', 'berita', 'remark', 'remarks', 'narasi', 'transactiondescription', 'transaksi'],
  debit:      ['debit', 'debet', 'pengeluaran', 'keluar', 'withdrawal', 'dr'],
  kredit:     ['kredit', 'credit', 'pemasukan', 'masuk', 'deposit', 'cr'],
  saldo:      ['saldo', 'balance', 'saldoakhir', 'endingbalance', 'runningbalance'],
  referensi:  ['referensi', 'reference', 'ref', 'noref', 'nobukti', 'kode', 'nomorreferensi', 'trxid'],
  mutasi:     ['mutasi', 'jumlah', 'nominal', 'amount', 'nilai'],
  arah:       ['dbcr', 'drcr', 'tipe', 'jenis', 'type', 'dk'],
};

/**
 * Kata kunci untuk daftar tagihan supplier.
 *
 * Kolom nominalnya sengaja dibedakan dari rekening koran: di sini yang dicari
 * nilai tagihan dan potongan pajaknya, bukan arah mutasi kas.
 */
export const KAMUS_TAGIHAN = {
  pemasok:    ['pemasok', 'supplier', 'vendor', 'namasupplier', 'namapemasok', 'namavendor', 'rekanan'],
  no_invoice: ['noinvoice', 'nomorinvoice', 'invoice', 'nofaktur', 'faktur', 'invoiceno', 'notagihan', 'nobukti'],
  tanggal:    ['tanggal', 'tanggalinvoice', 'tglinvoice', 'tgl', 'date', 'invoicedate', 'tanggalfaktur'],
  jatuh_tempo:['jatuhtempo', 'duedate', 'tempo', 'tgljatuhtempo'],
  gross:      ['gross', 'grosstagihan', 'total', 'totaltagihan', 'nilaitagihan', 'jumlah', 'bruto', 'dpp', 'nilai', 'amount'],
  pph:        ['pph', 'pph23', 'pph21', 'pajak', 'potonganpajak', 'withholding', 'wht', 'potongan'],
  net:        ['net', 'netto', 'nettransfer', 'dibayar', 'nilaitransfer', 'totalbayar'],
  keterangan: ['keterangan', 'deskripsi', 'description', 'uraian', 'catatan'],
};

/** Samakan bentuk header agar "No. Ref", "no ref", dan "NO_REF" dianggap sama. */
function normalkan(teks) {
  return String(teks ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bidangDari(header, kamus) {
  const bersih = normalkan(header);
  if (bersih === '') return null;

  for (const [bidang, kunci] of Object.entries(kamus)) {
    // Cocok persis lebih dipercaya daripada cocok sebagian.
    if (kunci.includes(bersih)) return bidang;
  }
  for (const [bidang, kunci] of Object.entries(kamus)) {
    // "tanggal transaksi" atau "debit (idr)" tetap terbaca.
    if (kunci.some((k) => k.length >= 4 && bersih.includes(k))) return bidang;
  }
  return null;
}

/**
 * Memetakan satu baris menjadi { bidang: indeksKolom }.
 * Kolom pertama yang cocok yang dipakai, supaya kolom ganda tidak saling menimpa.
 */
export function petakanHeader(baris, kamus = KAMUS_KORAN) {
  const peta = {};
  baris.forEach((sel, indeks) => {
    const bidang = bidangDari(sel, kamus);
    if (bidang && peta[bidang] === undefined) peta[bidang] = indeks;
  });
  return peta;
}

/** Pemetaan rekening koran cukup bila tanggal, keterangan, dan sumber nominal ada. */
export function pemetaanLengkap(peta) {
  const adaNominal = peta.debit !== undefined || peta.kredit !== undefined || peta.mutasi !== undefined;
  return peta.tanggal !== undefined && peta.keterangan !== undefined && adaNominal;
}

/** Pemetaan tagihan cukup bila supplier, tanggal, dan nilai tagihannya ada. */
export function pemetaanTagihanLengkap(peta) {
  const adaNilai = peta.gross !== undefined || peta.net !== undefined;
  return peta.pemasok !== undefined && peta.tanggal !== undefined && adaNilai;
}

/**
 * Mencari baris header di antara baris-baris awal.
 *
 * Rekening koran biasanya diawali kop, nomor rekening, dan periode sebelum tabel
 * dimulai, jadi header jarang berada di baris pertama. Baris dengan bidang
 * terkenali terbanyak yang dipilih.
 */
export function cariHeader(baris, opsi = {}) {
  const { kamus = KAMUS_KORAN, lengkap = pemetaanLengkap, batasPencarian = 30 } = opsi;
  let terbaik = null;

  const sampai = Math.min(baris.length, batasPencarian);
  for (let i = 0; i < sampai; i += 1) {
    const peta = petakanHeader(baris[i] ?? [], kamus);
    if (!lengkap(peta)) continue;

    const skor = Object.keys(peta).length;
    if (!terbaik || skor > terbaik.skor) terbaik = { indeks: i, peta, skor };
  }

  return terbaik;
}

// Mengenali baris header rekening koran dan memetakan kolomnya ke struktur internal.
//
// Pemetaan dilakukan berdasarkan NAMA header, bukan posisi kolom, karena setiap
// bank menyusun kolomnya berbeda dan sebagian menyisipkan kolom kosong.

/** Kata kunci per bidang. Dicocokkan setelah nama header dinormalisasi. */
const KATA_KUNCI = {
  tanggal:    ['tanggal', 'tgl', 'date', 'tanggaltransaksi', 'transactiondate', 'postingdate', 'tgltransaksi', 'valuedate'],
  keterangan: ['keterangan', 'description', 'deskripsi', 'uraian', 'berita', 'remark', 'remarks', 'narasi', 'transactiondescription', 'transaksi'],
  debit:      ['debit', 'debet', 'pengeluaran', 'keluar', 'withdrawal', 'dr'],
  kredit:     ['kredit', 'credit', 'pemasukan', 'masuk', 'deposit', 'cr'],
  saldo:      ['saldo', 'balance', 'saldoakhir', 'endingbalance', 'runningbalance'],
  referensi:  ['referensi', 'reference', 'ref', 'noref', 'nobukti', 'kode', 'nomorreferensi', 'trxid'],
  mutasi:     ['mutasi', 'jumlah', 'nominal', 'amount', 'nilai'],
  arah:       ['dbcr', 'drcr', 'tipe', 'jenis', 'type', 'dk'],
};

/** Samakan bentuk header agar "No. Ref", "no ref", dan "NO_REF" dianggap sama. */
function normalkan(teks) {
  return String(teks ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function bidangDari(header) {
  const bersih = normalkan(header);
  if (bersih === '') return null;

  for (const [bidang, kunci] of Object.entries(KATA_KUNCI)) {
    // Cocok persis lebih dipercaya daripada cocok sebagian.
    if (kunci.includes(bersih)) return bidang;
  }
  for (const [bidang, kunci] of Object.entries(KATA_KUNCI)) {
    // "tanggal transaksi" atau "debit (idr)" tetap terbaca.
    if (kunci.some((k) => k.length >= 4 && bersih.includes(k))) return bidang;
  }
  return null;
}

/**
 * Memetakan satu baris menjadi { bidang: indeksKolom }.
 * Kolom pertama yang cocok yang dipakai, supaya kolom ganda tidak saling menimpa.
 */
export function petakanHeader(baris) {
  const peta = {};
  baris.forEach((sel, indeks) => {
    const bidang = bidangDari(sel);
    if (bidang && peta[bidang] === undefined) peta[bidang] = indeks;
  });
  return peta;
}

/** Pemetaan dianggap cukup bila tanggal, keterangan, dan sumber nominal ada. */
export function pemetaanLengkap(peta) {
  const adaNominal = peta.debit !== undefined || peta.kredit !== undefined || peta.mutasi !== undefined;
  return peta.tanggal !== undefined && peta.keterangan !== undefined && adaNominal;
}

/**
 * Mencari baris header di antara baris-baris awal.
 *
 * Rekening koran biasanya diawali kop, nomor rekening, dan periode sebelum tabel
 * dimulai, jadi header jarang berada di baris pertama. Baris dengan bidang
 * terkenali terbanyak yang dipilih.
 */
export function cariHeader(baris, batasPencarian = 30) {
  let terbaik = null;

  const sampai = Math.min(baris.length, batasPencarian);
  for (let i = 0; i < sampai; i += 1) {
    const peta = petakanHeader(baris[i] ?? []);
    if (!pemetaanLengkap(peta)) continue;

    const skor = Object.keys(peta).length;
    if (!terbaik || skor > terbaik.skor) terbaik = { indeks: i, peta, skor };
  }

  return terbaik;
}

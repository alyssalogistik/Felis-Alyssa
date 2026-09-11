// Menarik nama lawan transaksi dari keterangan rekening koran.
//
// Dipakai untuk menyusun daftar supplier di halaman audit, supaya nama tidak
// perlu diketik dan diingat sendiri. Murni: tanpa I/O, tanpa DOM.
//
// Daftarnya jalan pintas, BUKAN sumber kebenaran. Angka yang ditampilkan tetap
// berasal dari pencarian yang sama dengan yang bisa dijalankan pemakainya
// sendiri, dan keterangan aslinya selalu ikut ditampilkan. Salah menebak nama
// akan membuat satu baris daftar tampak aneh — bukan membuat uang salah hitung.

/**
 * Kata yang dicetak bank, bukan nama orang atau perusahaan.
 *
 * Kalau seluruh sisa keterangan hanya terdiri dari kata-kata ini, transaksinya
 * dianggap tidak punya lawan transaksi bernama — biaya admin, tarikan tunai,
 * bunga, dan sejenisnya.
 */
const JARGON = new Set([
  'trsf', 'transfer', 'trf', 'ebanking', 'banking', 'internet', 'mobile',
  'db', 'cr', 'kr', 'debit', 'kredit', 'debet',
  'tarikan', 'tarik', 'tunai', 'atm', 'setoran', 'setor', 'gesek',
  'biaya', 'adm', 'admin', 'administrasi', 'bunga', 'pajak',
  'otomatis', 'switching', 'kartu', 'flazz', 'qris', 'qr',
  'saldo', 'awal', 'akhir', 'mutasi', 'transaksi', 'koreksi', 'batal',
  'pembayaran', 'pemb', 'byr', 'bayar', 'topup', 'top', 'up',
]);

/**
 * Kata keterangan yang menempel pada nama tetapi bukan bagian dari namanya.
 *
 * Menempelnya bisa di DEPAN ("DP KUSRIN YONOGI") maupun di BELAKANG
 * ("SUGENG RIYANTO PELUNASAN"), jadi dikupas dari kedua ujung. Mengupas satu
 * ujung saja pernah memecah satu orang menjadi tiga baris daftar — dan total
 * yang terpecah tampak lebih kecil daripada yang sebenarnya dibayar, yang di
 * halaman ini berarti membayar orang yang sama untuk kedua kalinya.
 *
 * Daftar ini pasti tumbuh seiring munculnya istilah baru di keterangan bank.
 * Karena itu ia bukan satu-satunya penjaga: penggabungan di petaKanonik()
 * menangani kata yang belum terdaftar, selama nama yang sama pernah muncul
 * juga tanpa kata itu.
 */
const KATA_KETERANGAN = new Set([
  'dp', 'pelunasan', 'lunas', 'sisa', 'kekurangan', 'tambahan',
  'angsuran', 'cicilan', 'termin', 'tahap', 'uang', 'muka',
  'towing', 'ongkos', 'kirim', 'angkut', 'muat', 'bongkar', 'unit',
  'sby', 'jkt', 'bpn', 'mks', 'kpg', 'lop', 'sub',
]);

const kataTempelan = (kata) => {
  const k = String(kata).toLowerCase();
  return JARGON.has(k) || KATA_KETERANGAN.has(k);
};

const bersih = (teks) =>
  String(teks ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((k) => k !== '');

/** Kata yang memuat angka adalah kode, tanggal, atau nominal — bukan nama. */
const berangka = (kata) => /[0-9]/.test(kata);

/**
 * Nama lawan transaksi, atau null bila keterangannya bukan transaksi bernama.
 *
 * Namanya diambil dari rentetan kata TERAKHIR yang sama sekali tidak memuat
 * angka. BCA menaruh kode, tanggal, dan nominal di depan — "TRSF E-BANKING DB
 * 0308 WSID:1042025 SUGENG RIYANTO" — sehingga bagian berhurufnya di ujung
 * justru yang paling bisa dipercaya sebagai nama.
 */
export function namaDariKeterangan(keterangan) {
  const kata = bersih(keterangan);
  if (kata.length === 0) return null;

  // Rentetan kata tanpa angka di ujung.
  let mulai = kata.length;
  while (mulai > 0 && !berangka(kata[mulai - 1])) mulai -= 1;
  let ekor = kata.slice(mulai);

  // Tidak ada satu pun angka di keterangan: seluruhnya kandidat nama.
  if (mulai === 0) ekor = kata;

  // Kupas kata tempelan dari kedua ujung, bukan hanya dari depan.
  while (ekor.length > 0 && kataTempelan(ekor[0])) ekor = ekor.slice(1);
  while (ekor.length > 0 && kataTempelan(ekor[ekor.length - 1])) ekor = ekor.slice(0, -1);

  // Sisa yang seluruhnya jargon bukan nama siapa pun.
  if (ekor.length === 0) return null;
  if (ekor.every((k) => JARGON.has(k.toLowerCase()))) return null;

  // Satu kata yang sangat pendek lebih mungkin singkatan sisa kode daripada nama.
  if (ekor.length === 1 && ekor[0].length < 3) return null;

  return ekor.join(' ');
}

/**
 * Menggabungkan nama yang sebenarnya satu orang.
 *
 * Keterangan bank menempelkan kata di kedua ujung nama — "DP KUSRIN YONOGI"
 * dan "SUGENG RIYANTO PELUNASAN" adalah orang yang sama dengan "KUSRIN YONOGI"
 * dan "SUGENG RIYANTO". Nama yang memuat nama lain yang lebih pendek, persis di
 * ujung depan atau belakangnya, dilipat ke nama pendek itu.
 *
 * Arahnya sengaja satu: yang panjang menyusut ke yang pendek. Nama pendek
 * adalah identitas yang benar-benar berulang di rekening koran, sedangkan kata
 * tempelannya berganti-ganti tiap transaksi.
 *
 * Nama pendek berkata tunggal TIDAK pernah menjadi sasaran. "BUDI" terlalu umum
 * dan akan menelan "BUDI SANTOSO" bersama "BUDI HARTONO" menjadi satu orang.
 *
 * Menggabungkan dua orang yang sebenarnya berbeda memang mungkin, dan itu
 * pilihan sadar: totalnya jadi terlalu besar, dan terlalu besar terbaca sebagai
 * "sudah dibayar". Kebalikannya — satu orang terpecah, totalnya terlalu kecil —
 * terbaca sebagai kurang bayar dan berakhir dengan pembayaran kedua. Semua yang
 * digabung ikut dilaporkan sebagai varian supaya bisa diperiksa mata.
 *
 * @param {Array<{nama: string}>} daftar
 * @returns {Map<string, string>} nama apa adanya -> nama kanonik
 */
export function petaKanonik(daftar) {
  const nama = [...new Set(daftar.map((d) => d.nama).filter(Boolean))];
  // Yang pendek diperiksa lebih dulu supaya menjadi sasaran pelipatan.
  const urut = [...nama]
    .filter((n) => n.includes(' '))
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  const peta = new Map();
  for (const n of nama) {
    const pendek = urut.find((k) => k !== n && (n.endsWith(` ${k}`) || n.startsWith(`${k} `)));
    peta.set(n, pendek ?? n);
  }
  return peta;
}

/**
 * Daftar supplier beserta rekapnya, disusun dari baris transaksi bank.
 *
 * Hanya uang keluar yang dihitung: pertanyaan halaman ini adalah "supplier ini
 * sudah saya bayar belum", dan uang masuk atas nama yang sama justru
 * menyesatkan bila ikut dijumlahkan.
 *
 * @param {Array<{keterangan: string, debit: number|string, tanggal: string|null}>} transaksi
 */
export function daftarSupplier(transaksi) {
  const mentah = [];
  for (const t of transaksi) {
    const nama = namaDariKeterangan(t.keterangan);
    if (nama === null) continue;
    mentah.push({ nama, t });
  }

  const peta = petaKanonik(mentah);
  const kumpulan = new Map();

  for (const { nama, t } of mentah) {
    const kunci = peta.get(nama) ?? nama;
    let baris = kumpulan.get(kunci);
    if (!baris) {
      baris = {
        nama: kunci,
        varian: new Set(),
        jumlah_transaksi: 0,
        total_debit: 0,
        pertama: null,
        terakhir: null,
      };
      kumpulan.set(kunci, baris);
    }

    baris.varian.add(nama);
    baris.jumlah_transaksi += 1;
    baris.total_debit += Number(t.debit ?? 0);

    // Tanggal disimpan sebagai YYYY-MM-DD, jadi perbandingan teks sudah benar
    // secara kronologis dan tidak menyentuh timezone sama sekali.
    const tgl = t.tanggal ?? null;
    if (tgl) {
      if (baris.pertama === null || tgl < baris.pertama) baris.pertama = tgl;
      if (baris.terakhir === null || tgl > baris.terakhir) baris.terakhir = tgl;
    }
  }

  return [...kumpulan.values()]
    .map((b) => ({ ...b, varian: [...b.varian].sort() }))
    .sort((a, b) => b.total_debit - a.total_debit || a.nama.localeCompare(b.nama));
}

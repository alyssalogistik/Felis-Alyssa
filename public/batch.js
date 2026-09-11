// Aturan satu batch impor rekening koran. Murni: tanpa DOM, tanpa jaringan.
//
// Dipisahkan dari impor.js supaya bagian yang paling mudah salah — pengurutan
// periode dan penghitungan rentang bulan — bisa diuji tanpa peramban maupun
// berkas PDF.

/** Berapa berkas dan berapa bulan yang boleh masuk dalam satu batch. */
export const MAKS_BERKAS = 12;
export const MAKS_BULAN = 12;

export const PESAN_TERLALU_PANJANG = 'Maksimal periode import adalah 12 bulan.';
export const PESAN_TERLALU_BANYAK = `Maksimal ${MAKS_BERKAS} file rekening koran dalam satu import.`;

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** "Agustus 2026". Periode yang tidak terbaca ditulis apa adanya, bukan ditebak. */
export function namaPeriode(periode) {
  if (!periode?.bulan || !periode?.tahun) return 'Periode tidak dikenali';
  return `${NAMA_BULAN[Number(periode.bulan) - 1] ?? periode.bulan} ${periode.tahun}`;
}

/** Nomor bulan mutlak sejak tahun nol, supaya periode bisa dibandingkan sebagai angka. */
export function nomorBulan(periode) {
  return Number(periode.tahun) * 12 + Number(periode.bulan);
}

/**
 * Urutkan dari periode terlama ke terbaru.
 *
 * Urutan pemakai memilih berkas tidak bisa dipercaya — di layar sentuh urutan
 * ketuk bahkan tidak selalu sama dengan urutan yang terlihat. Berkas yang
 * periodenya tidak terbaca diletakkan di belakang agar tidak menggeser yang
 * lain, dan tetap ikut diproses supaya kegagalannya terlihat.
 */
export function urutkanPeriode(daftar) {
  return [...daftar].sort((a, b) => {
    const adaA = Boolean(a.periode?.bulan && a.periode?.tahun);
    const adaB = Boolean(b.periode?.bulan && b.periode?.tahun);
    if (!adaA && !adaB) return 0;
    if (!adaA) return 1;
    if (!adaB) return -1;
    return nomorBulan(a.periode) - nomorBulan(b.periode);
  });
}

/**
 * Rentang bulan yang dicakup satu batch, dihitung inklusif.
 *
 * April 2025 sampai Maret 2026 adalah dua belas bulan, bukan sebelas: bulan
 * awal dan bulan akhir sama-sama ikut terhitung.
 */
export function rentangBulan(daftar) {
  const berperiode = daftar.filter((b) => b.periode?.bulan && b.periode?.tahun);
  if (berperiode.length === 0) return null;

  const nomor = berperiode.map((b) => nomorBulan(b.periode));
  const awal = berperiode[nomor.indexOf(Math.min(...nomor))].periode;
  const akhir = berperiode[nomor.indexOf(Math.max(...nomor))].periode;

  return { awal, akhir, bulan: Math.max(...nomor) - Math.min(...nomor) + 1 };
}

/**
 * Apakah batch ini boleh diproses.
 *
 * Diperiksa SEBELUM satu baris pun tersimpan. Menolak di tengah jalan akan
 * meninggalkan sebagian bulan sudah masuk dan sebagian belum, dan tidak ada
 * cara sederhana bagi pemakainya untuk tahu sampai mana.
 *
 * @returns {{boleh: boolean, alasan?: string, rentang?: object, urut?: Array}}
 */
export function periksaBatch(daftar) {
  if (daftar.length === 0) return { boleh: false, alasan: 'Tidak ada berkas yang dipilih.' };
  if (daftar.length > MAKS_BERKAS) return { boleh: false, alasan: PESAN_TERLALU_BANYAK };

  const urut = urutkanPeriode(daftar);
  const rentang = rentangBulan(urut);

  if (rentang && rentang.bulan > MAKS_BULAN) {
    return { boleh: false, alasan: PESAN_TERLALU_PANJANG, rentang, urut };
  }

  return { boleh: true, rentang, urut };
}

/** Menjumlahkan hasil seluruh berkas menjadi ringkasan satu batch. */
export function ringkasBatch(hasil) {
  const jumlahkan = (kunci) => hasil.reduce((n, h) => n + Number(h[kunci] ?? 0), 0);
  return {
    berkas: hasil.length,
    dibaca: jumlahkan('dibaca'),
    baru: jumlahkan('baru'),
    sudah_ada: jumlahkan('sudah_ada'),
    perlu_diperiksa: jumlahkan('perlu_diperiksa'),
    gagal: hasil.filter((h) => h.status === 'gagal').length,
  };
}

// Tanda pengenal di dalam teks bebas.
//
// Murni: menerima daftar teks, mengembalikan pengenal. Tanpa I/O, sehingga
// aturannya bisa diuji tanpa database maupun berkas Excel.
//
// Modul ini TIDAK TAHU APA-APA soal kendaraan, dan itu disengaja. Yang dicari
// bukan "nopol" atau "nomor rangka", melainkan pola yang membuat sepotong teks
// menjadi penunjuk satu barang tertentu: mengandung angka, cukup panjang, dan
// JARANG muncul di dalam batch yang sedang diperiksa. Nomor rangka, nomor
// seri mesin, nomor kontrak, nomor batch, dan nomor tiket semuanya lolos lewat
// aturan yang sama — sehingga besok, ketika yang diaudit bukan kendaraan,
// mesin temuannya tetap bekerja tanpa satu baris pun diubah.
//
// Kenapa kejarangan, bukan daftar pola: daftar pola harus ditambah setiap kali
// jenis data baru masuk, dan yang lupa ditambahkan gagal diam-diam — barisnya
// tidak pernah dibandingkan dengan apa pun, dan tagihan ganda di dalamnya
// tidak pernah muncul sebagai temuan.

/** Huruf besar, tanda baca menjadi spasi. Dipakai keterangan maupun token. */
export function normalkan(teks) {
  return String(teks ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** Panjang minimal sebuah token supaya layak jadi pengenal. */
const PANJANG_MINIMAL = 3;

/**
 * Seberapa sering sebuah token boleh muncul dan masih dianggap "jarang".
 *
 * Dinyatakan sebagai pecahan dari jumlah baris, bukan angka tetap: berkas 100
 * baris dan berkas 50.000 baris punya gagasan yang sangat berbeda tentang apa
 * itu langka. Lantai 2 menjaga batch kecil tetap bisa menemukan sesuatu —
 * tanpa itu, berkas 20 baris tidak akan punya satu pun pengenal.
 */
export const PECAHAN_JARANG = 0.02;

export function ambangJarang(jumlahBaris) {
  return Math.max(2, Math.ceil(jumlahBaris * PECAHAN_JARANG));
}

/** Token berangka yang cukup panjang, tanpa pengulangan, urut kemunculan. */
export function tokenBerangka(teks) {
  const kata = normalkan(teks).split(' ').filter(Boolean);
  const keluar = [];
  for (const t of kata) {
    if (t.length < PANJANG_MINIMAL) continue;
    if (!/\d/.test(t)) continue;
    if (!keluar.includes(t)) keluar.push(t);
  }
  return keluar;
}

/**
 * Token berangka beserta tetangga kiri-kanannya.
 *
 * Ini yang membedakan `B 1104 DKN` dari `B 1104 DKM`. Tanpa konteks, keduanya
 * bertemu di token `1104` dan dilaporkan sebagai barang yang sama — padahal
 * dua kendaraan berbeda. Diuji terhadap data sungguhan: dua pasang seperti itu
 * ada di dalam satu berkas Mekari yang sama.
 *
 * Konteksnya TIDAK dipakai untuk membuang pasangan, hanya untuk menurunkan
 * skornya. Melewatkan tagihan ganda jauh lebih mahal daripada satu baris yang
 * perlu dilihat mata.
 */
export function konteksToken(teks) {
  const kata = normalkan(teks).split(' ').filter(Boolean);
  const peta = new Map();
  kata.forEach((t, i) => {
    if (t.length < PANJANG_MINIMAL || !/\d/.test(t)) return;
    if (peta.has(t)) return;
    peta.set(t, [kata[i - 1] ?? '', t, kata[i + 1] ?? ''].filter(Boolean).join(' '));
  });
  return peta;
}

/**
 * Melengkapi setiap baris dengan deskripsi normal, pengenal, dan konteksnya.
 *
 * Kejarangan hanya bisa dinilai terhadap seluruh batch, jadi ini menerima
 * semua baris sekaligus — bukan satu per satu. `ambilTeks` menentukan kolom
 * mana yang dibaca, supaya modul ini tidak perlu tahu bentuk barisnya.
 */
export function bubuhiPengenal(baris, ambilTeks = (b) => b.keterangan) {
  const teks = baris.map((b) => String(ambilTeks(b) ?? ''));
  const hitung = new Map();

  const semuaToken = teks.map((t) => tokenBerangka(t));
  for (const token of semuaToken) {
    for (const t of token) hitung.set(t, (hitung.get(t) ?? 0) + 1);
  }

  const ambang = ambangJarang(baris.length);

  return baris.map((b, i) => ({
    ...b,
    deskripsi_normal: normalkan(teks[i]),
    pengenal: semuaToken[i].filter((t) => hitung.get(t) <= ambang),
    konteks: konteksToken(teks[i]),
  }));
}

/** Pengenal beserta konteksnya, siap disimpan sebagai baris database. */
export function pengenalTersimpan(baris) {
  const keluar = [];
  for (const p of baris.pengenal ?? []) {
    keluar.push({ nilai: p, konteks: baris.konteks?.get(p) ?? p });
  }
  return keluar;
}

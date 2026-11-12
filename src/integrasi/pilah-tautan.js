// Memilah transaksi terpilih menjadi "bebas" dan "sudah tertaut", serta aturan
// kelayakan koreksi supplier.
//
// Murni, tanpa I/O dan tanpa DOM: dipakai server (PATCH /tautan/:id) maupun
// peramban. `src/server.js` menyajikannya di `/pilah-tautan.js` alih-alih
// menyalinnya ke `public/`: salinan yang tertinggal akan membuat yang terbaca di
// layar berbeda dari yang diputuskan server tanpa satu pun galat.
//
// Nilai status ditulis sebagai teks di sini karena berkas ini harus bisa
// dimuat peramban tanpa mengimpor modul server. `test/integrasi-pilah-tautan`
// menjaga agar teks itu sama persis dengan STATUS di tautan.js.

const DIBATALKAN = 'dibatalkan';
const SIAP = 'siap';
const DITARIK = 'ditarik';
const MENUNGGU_KOREKSI = 'perlu_koreksi_hilir';
const MENUNGGU_LEPAS = 'menunggu_lepas';

export const SEBAB_KOREKSI = {
  TIDAK_ADA: 'tautan_tidak_ada',
  DIBATALKAN: 'tautan_dibatalkan',
  SUDAH_SAMA: 'sudah_supplier_itu',
  MENUNGGU_KOREKSI: 'menunggu_koreksi',
  MENUNGGU_LEPAS: 'menunggu_lepas',
};

/** Tautan yang masih memegang transaksinya. `dibatalkan` membebaskannya. */
export function sudahTertaut(tautan) {
  return Boolean(tautan) && tautan.status !== DIBATALKAN;
}

/**
 * Memisahkan id terpilih: yang bebas ditautkan, dan yang sudah punya tautan.
 *
 * @param {string[]} ids transaksi yang dicentang
 * @param {Array<{transaksi_id: string, status: string}>} tautan tautan yang ada untuk id itu
 */
export function pilahPilihan(ids, tautan) {
  const peta = new Map((tautan ?? []).map((t) => [t.transaksi_id, t]));
  const bebas = [];
  const tertaut = [];
  for (const id of ids ?? []) {
    const t = peta.get(id);
    if (sudahTertaut(t)) tertaut.push(t);
    else bebas.push(id);
  }
  return { bebas, tertaut };
}

/** Mengelompokkan yang sudah tertaut per supplier dan status, terbanyak dulu. */
export function ringkasTertaut(tertaut) {
  const kelompok = new Map();
  for (const t of tertaut ?? []) {
    const kunci = `${t.supplier_id}|${t.status}`;
    const ada = kelompok.get(kunci) ?? {
      supplier_id: t.supplier_id, supplier_nama: t.supplier_nama, status: t.status, jumlah: 0,
    };
    ada.jumlah += 1;
    kelompok.set(kunci, ada);
  }
  return [...kelompok.values()].sort((a, b) => b.jumlah - a.jumlah || a.supplier_id.localeCompare(b.supplier_id));
}

export const LABEL_STATUS_TAUTAN = {
  [SIAP]: 'siap ditarik',
  [DITARIK]: 'sudah ditarik alyssa-dev',
  [MENUNGGU_KOREKSI]: 'menunggu koreksi diakui alyssa-dev',
  [MENUNGGU_LEPAS]: 'menunggu pelepasan',
};

/**
 * Kalimat untuk transaksi terpilih yang sudah tertaut. SATU kalimat, bukan satu
 * galat per transaksi: tiga belas baris galat yang sama membuat orang mengira
 * sistemnya rusak, padahal tidak ada yang perlu dilakukan.
 *
 * @param {Array} tertaut
 * @param {number} dipilih jumlah seluruh transaksi yang dicentang
 */
export function kalimatTertaut(tertaut, dipilih) {
  const jumlah = (tertaut ?? []).length;
  if (jumlah === 0) return '';
  const rincian = ringkasTertaut(tertaut)
    .map((k) => `${k.jumlah} ke ${k.supplier_nama} (${k.supplier_id}), ${LABEL_STATUS_TAUTAN[k.status] ?? k.status}`)
    .join('; ');
  const awal = jumlah === dipilih
    ? `${jumlah} dari ${dipilih} transaksi terpilih sudah tertaut`
    : `${jumlah} dari ${dipilih} transaksi terpilih sudah tertaut dan dilewati`;
  return `${awal}: ${rincian}.`;
}

/**
 * Boleh tidaknya sebuah tautan dikoreksi ke supplier lain.
 *
 * - tidak ada / dibatalkan: tidak ada yang dikoreksi, tautkan saja;
 * - supplier_id yang sama: bukan koreksi. Mengirimnya menandai transaksi
 *   `perlu_koreksi_hilir` tanpa perubahan apa pun, dan alyssa-dev mendapat
 *   "pindah" ke supplier yang sama;
 * - SUDAH menunggu koreksi: koreksi kedua menimpa supplier yang diminta,
 *   sehingga supplier_id_lama di riwayat menjadi supplier PERANTARA yang tidak
 *   pernah dipegang alyssa-dev — padahal `/integrasi/koreksi` membacanya dari
 *   sana. Tunggu sampai koreksi pertama diakui;
 * - sudah ditarik: berubah menjadi perlu_koreksi_hilir (diproses manual di
 *   alyssa-dev); belum ditarik: berubah langsung.
 *
 * @returns {{ok: true, langsung: boolean} | {ok: false, sebab: string, pesan: string}}
 */
export function layakDikoreksi(tautan, supplierBaru) {
  if (!tautan) {
    return { ok: false, sebab: SEBAB_KOREKSI.TIDAK_ADA, pesan: 'Tautan tidak ditemukan.' };
  }
  if (tautan.status === DIBATALKAN) {
    return {
      ok: false,
      sebab: SEBAB_KOREKSI.DIBATALKAN,
      pesan: 'Tautan ini sudah dibatalkan. Tautkan ulang saja.',
    };
  }
  if (tautan.status === MENUNGGU_LEPAS) {
    return {
      ok: false,
      sebab: SEBAB_KOREKSI.MENUNGGU_LEPAS,
      pesan: 'Transaksi ini sedang menunggu pelepasan di alyssa-dev dan tidak bisa dikoreksi.',
    };
  }
  if (String(supplierBaru?.supplier_id ?? '').trim().toLowerCase() === tautan.supplier_id) {
    return {
      ok: false,
      sebab: SEBAB_KOREKSI.SUDAH_SAMA,
      pesan: `Transaksi ini sudah tertaut ke supplier_id ${tautan.supplier_id} (${tautan.supplier_nama}). `
        + 'Tidak ada yang perlu dikoreksi.',
    };
  }
  if (tautan.status === MENUNGGU_KOREKSI) {
    return {
      ok: false,
      sebab: SEBAB_KOREKSI.MENUNGGU_KOREKSI,
      pesan: 'Koreksi untuk transaksi ini masih menunggu diakui alyssa-dev. '
        + 'Tunggu sampai diakui, supaya yang dikoreksi di sana tidak menjadi supplier perantara.',
    };
  }
  return { ok: true, langsung: tautan.status === SIAP };
}

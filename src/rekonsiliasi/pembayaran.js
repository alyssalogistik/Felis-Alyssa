// Aturan isian pembayaran manual.
//
// Murni: menerima isian mentah, mengembalikan nilai siap simpan beserta
// daftar masalahnya. Tanpa I/O, sehingga aturannya bisa diuji tanpa database
// dan hanya ada satu tempat yang memutuskan apa itu isian yang sah.

/** Sumber dana yang boleh dipilih. Kunci disimpan, nilainya ditampilkan. */
export const SUMBER = {
  MEKARI_PAY: 'Mekari Pay',
  BCA: 'BCA',
  BANK_LAIN: 'Bank Lain',
  KAS: 'Kas',
  LAINNYA: 'Lainnya',
};

/**
 * Label yang dicetak di kolom SUMBER.
 *
 * Pembayaran manual bersumber BCA ditulis "BCA (MANUAL)". Kalau ditulis "BCA"
 * saja ia tampak seolah baris rekening koran padahal diketik orang, dan
 * laporan audit kehilangan satu-satunya penanda bahwa angkanya tidak berasal
 * dari e-statement. Database menghitung label yang sama di view
 * pembayaran_semua; yang di sini dipakai layar sebelum tersimpan.
 */
export function labelSumber(sumber) {
  if (sumber === 'MEKARI_PAY') return 'MEKARI PAY';
  if (sumber === 'BANK_LAIN') return 'BANK LAIN';
  if (sumber === 'BCA') return 'BCA (MANUAL)';
  return String(sumber ?? '').toUpperCase();
}

const POLA_TANGGAL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Merapatkan spasi berlebih, bukan sekadar memangkas ujungnya.
 *
 * Pencocokan nama di halaman audit harfiah. Nama yang tersimpan sebagai
 * "SUGENG  RIYANTO" berspasi dua tidak akan pernah ditemukan oleh pencarian
 * "SUGENG RIYANTO" — pembayarannya ada di database tetapi hilang dari layar,
 * dan yang tampak belum dibayar akan dibayar untuk kedua kalinya.
 */
const rapat = (teks) => String(teks ?? '').trim().replace(/\s+/g, ' ');

const kosong = (teks) => rapat(teks) === '';

/**
 * Tautan bukti hanya boleh http/https.
 *
 * Nilainya ditempel sebagai href di daftar pembayaran. Skema lain — terutama
 * javascript: — menjadikan satu isian teks sebagai jalan menjalankan kode di
 * peramban orang lain yang membuka halaman yang sama.
 */
function tautanAman(teks) {
  const t = rapat(teks);
  if (t === '') return { ok: true, nilai: null };
  try {
    const url = new URL(t);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false };
    return { ok: true, nilai: t };
  } catch {
    return { ok: false };
  }
}

/**
 * Nominal dari isian. Titik dan koma pemisah ribuan dibuang lebih dulu supaya
 * "28.000.000" yang diketik sebagaimana orang menulis rupiah tidak ditolak.
 */
export function uraiNominalIsian(nilai) {
  if (typeof nilai === 'number') return Number.isFinite(nilai) ? nilai : null;
  const teks = String(nilai ?? '').trim().replace(/[.\s]/g, '').replace(',', '.');
  if (teks === '' || !/^\d+(\.\d+)?$/.test(teks)) return null;
  const angka = Number(teks);
  return Number.isFinite(angka) ? angka : null;
}

/**
 * Memeriksa dan merapikan isian pembayaran manual.
 *
 * @param {object} masuk Isian mentah dari formulir.
 * @returns {{ok: boolean, nilai: object|null, masalah: string[]}}
 */
export function saringPembayaran(masuk = {}) {
  const masalah = [];

  const tanggal = rapat(masuk.tanggal);
  if (!POLA_TANGGAL.test(tanggal)) masalah.push('Tanggal pembayaran harus diisi (YYYY-MM-DD).');
  else if (Number.isNaN(Date.parse(`${tanggal}T00:00:00Z`))) masalah.push('Tanggal pembayaran tidak sah.');

  const penerima = rapat(masuk.penerima);
  if (penerima === '') masalah.push('Nama supplier/penerima harus diisi.');

  const nominal = uraiNominalIsian(masuk.nominal);
  if (nominal === null) masalah.push('Nominal tidak terbaca.');
  else if (nominal <= 0) masalah.push('Nominal harus lebih besar dari nol.');

  const sumber = rapat(masuk.sumber).toUpperCase().replace(/[\s-]+/g, '_');
  if (!Object.hasOwn(SUMBER, sumber)) masalah.push('Sumber pembayaran belum dipilih.');

  const oleh = rapat(masuk.dibuat_oleh);
  if (oleh === '') masalah.push('Kolom "Diinput oleh" harus diisi.');

  const bukti = tautanAman(masuk.bukti_url);
  if (!bukti.ok) masalah.push('Link bukti harus berupa alamat http:// atau https://.');

  if (masalah.length > 0) return { ok: false, nilai: null, masalah };

  return {
    ok: true,
    masalah: [],
    nilai: {
      tanggal,
      penerima,
      nominal,
      sumber,
      no_referensi: kosong(masuk.no_referensi) ? null : rapat(masuk.no_referensi),
      memo: kosong(masuk.memo) ? null : rapat(masuk.memo),
      bukti_url: bukti.nilai,
      dibuat_oleh: oleh,
    },
  };
}

/**
 * Isian untuk pembaruan. Hanya kolom yang benar-benar dikirim yang diubah,
 * supaya menyunting satu kolom tidak diam-diam mengosongkan kolom lain.
 */
export function saringPerubahan(masuk = {}) {
  const lengkap = saringPembayaran({
    tanggal: masuk.tanggal,
    penerima: masuk.penerima,
    nominal: masuk.nominal,
    sumber: masuk.sumber,
    no_referensi: masuk.no_referensi,
    memo: masuk.memo,
    bukti_url: masuk.bukti_url,
    // Perubahan mencatat pengubahnya, bukan pembuatnya; pembuat aslinya tidak
    // boleh ikut tertimpa.
    dibuat_oleh: masuk.diubah_oleh,
  });

  if (!lengkap.ok) {
    return {
      ok: false,
      nilai: null,
      masalah: lengkap.masalah.map((m) =>
        m === 'Kolom "Diinput oleh" harus diisi.' ? 'Kolom "Diubah oleh" harus diisi.' : m
      ),
    };
  }

  const { dibuat_oleh: diubahOleh, ...kolom } = lengkap.nilai;
  return {
    ok: true,
    masalah: [],
    nilai: { ...kolom, diubah_oleh: diubahOleh, diubah_pada: new Date().toISOString() },
  };
}

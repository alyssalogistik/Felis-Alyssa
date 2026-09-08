// Fungsi bantu yang dipakai bersama oleh seluruh tampilan.
// Diekstrak agar rekonsiliasi memakai pemformatan dan pengaman yang sama
// persis dengan halaman lain, bukan salinannya.

export const rupiah = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
});

export const tanggal = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta',
});

export const tanggalSaja = new Intl.DateTimeFormat('id-ID', {
  day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Jakarta',
});

/** Data dari database ditempel sebagai HTML, jadi harus dilucuti dulu. */
export function aman(nilai) {
  return String(nilai ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export async function ambil(jalur, opsi) {
  const respons = await fetch(`/api${jalur}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opsi,
  });
  const isi = await respons.json().catch(() => ({}));
  if (!respons.ok) throw new Error(isi.pesan ?? `Gagal memuat (HTTP ${respons.status}).`);
  return isi;
}

export const el = (id) => document.getElementById(id);

export function kosong(pesan) {
  return `<p class="kosong">${aman(pesan)}</p>`;
}

export function pasangan(label, nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return '';
  return `<div class="pasangan"><dt>${aman(label)}</dt><dd>${aman(nilai)}</dd></div>`;
}

/**
 * Tanggal dari database berbentuk `YYYY-MM-DD`. Diformat dari potongan teksnya
 * langsung, tanpa lewat objek Date, supaya timezone peramban tidak memundurkan
 * tanggal transaksi satu hari.
 */
export function formatTanggalPolos(iso) {
  if (!iso) return '-';
  const [tahun, bulan, hari] = iso.split('-').map(Number);
  return tanggalSaja.format(new Date(Date.UTC(tahun, bulan - 1, hari)));
}

/** Nominal nol ditampilkan redup supaya kolom yang terisi langsung menonjol. */
export function formatNominal(nilai) {
  const angka = Number(nilai ?? 0);
  return angka === 0
    ? '<span class="nol">-</span>'
    : aman(rupiah.format(angka));
}

// Mencocokkan keterangan bank dengan pemetaan supplier yang SUDAH tersimpan.
//
// Murni: tanpa I/O, tanpa DOM, tanpa database — dipakai server (saat menyusun
// saran) maupun peramban (saat mengetik di kotak nama). Berkasnya disajikan
// src/server.js di /cocok-nama.js alih-alih disalin ke public/, dengan alasan
// yang sama seperti entitas.js: salinan yang tertinggal akan membuat yang
// tampak di layar berbeda dari yang diputuskan server, tanpa satu pun galat.
//
// ## Kenapa bukan kunci_saran yang dipakai
//
// kunciSaran() menyusun kuncinya dari namaDariKeterangan(), dan nama turunan
// itu ikut menyerap kata di depan nama. Diukur pada tujuh keterangan BAGUS
// HARDIANTO sungguhan dari satu rekening PT, kuncinya pecah menjadi enam:
//
//   BAGUS HARDIANTO|            HIACE BAGUS HARDIANTO|
//   BOX IKT BAGUS HARDIANTO|    TRINTON BAGUS HARDIANTO|
//   ER TIGA BAGUS HARDIANTO|    BAGUS HARDIANTO KBB|002
//
// Enam kunci untuk satu supplier. Ingatan yang dikunci padanya hampir tidak
// pernah berbunyi: yang dipetakan kemarin lewat "HIACE BAGUS HARDIANTO" tidak
// dikenali besok saat banknya mencetak "TRINTON BAGUS HARDIANTO".
//
// Yang dipakai di sini sebaliknya: nama supplier yang DIKETIK MANUSIA dicari
// sebagai kata utuh di dalam keterangan bank. Nama itu tidak ikut berubah
// mengikuti kalimat banknya, jadi ketujuh keterangan di atas cocok semua.

/** Huruf dan spasi diseragamkan. Dipakai untuk MEMBANDINGKAN, tidak disimpan. */
export const rapiNama = (nilai) => String(nilai ?? '').toUpperCase().replace(/\s+/g, ' ').trim();

/**
 * Nama sependek ini tidak pernah dipakai mencocokkan.
 *
 * Bukan soal selera: nama pendek muncul di mana-mana sebagai potongan kata
 * lain, dan yang tercocok salah di sini berarti uang tercatat atas nama
 * supplier yang bukan penerimanya.
 */
export const PANJANG_NAMA_MINIMAL = 4;

/** Sekurang-kurangnya sekian huruf diketik sebelum daftar ingatan muncul. */
export const PANJANG_KETIK_MINIMAL = 2;

const lolosRegex = (teks) => teks.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Nama supplier ini muncul utuh di dalam keterangan bank?
 *
 * Dua pagar, dan keduanya menolak ke arah yang sama — lebih baik tidak
 * menyarankan apa-apa daripada menyarankan supplier yang keliru:
 *
 * - **Nama berkata tunggal tidak pernah cocok.** "BUDI" akan ikut cocok pada
 *   "BUDI SANTOSO" maupun "BUDI HARTONO", dan keduanya orang yang berbeda.
 *   Aturan yang sama sudah dipakai pelipatan nama di nama.js.
 * - **Batasnya batas kata, bukan substring mentah.** Tanpa itu "BAGUS
 *   HARDIANTO" ikut cocok pada "BAGUS HARDIANTOS" — satu huruf beda, orang
 *   yang berbeda. Yang dihitung sebagai pembatas adalah apa pun yang bukan
 *   huruf atau angka, sehingga nama yang menempel pada garis miring nomor
 *   rujukan tetap terbaca.
 */
export function cocokNamaPemetaan(keterangan, supplierNama) {
  const nama = rapiNama(supplierNama);
  if (nama.length < PANJANG_NAMA_MINIMAL) return false;
  if (nama.split(' ').length < 2) return false;

  const teks = rapiNama(keterangan);
  if (teks === '') return false;

  return new RegExp(`(^|[^A-Z0-9])${lolosRegex(nama)}([^A-Z0-9]|$)`).test(teks);
}

/**
 * Satu baris per supplier_id, dari daftar yang boleh memuat banyak baris untuk
 * supplier yang sama.
 *
 * Daftarnya diharapkan TERBARU DI DEPAN, dan yang pertama menjadi wakilnya.
 *
 * Nomor rekening diperlakukan berbeda dari kolom lain: ia diambil dari
 * pemetaan terbaru yang BENAR-BENAR punya, bukan dari baris wakilnya saja.
 * Kolom itu opsional, jadi pengikatan terakhir bisa saja dilakukan tanpa
 * mengisinya — dan kalau wakilnya yang dipakai mentah-mentah, nomor rekening
 * yang pernah diketik dengan susah payah menghilang dari layar justru pada
 * supplier yang paling sering dibayar.
 */
export function satukanPemetaan(daftar = []) {
  const peta = new Map();
  for (const p of daftar ?? []) {
    if (!p?.supplier_id) continue;
    const ada = peta.get(p.supplier_id);
    if (!ada) {
      peta.set(p.supplier_id, { ...p });
      continue;
    }
    if (!ada.no_rekening_tujuan && p.no_rekening_tujuan) {
      ada.no_rekening_tujuan = p.no_rekening_tujuan;
    }
  }
  return [...peta.values()];
}

/** Pemetaan aktif yang nama suppliernya muncul utuh di keterangan ini. */
export function cocokkanPemetaan(keterangan, daftar = []) {
  return (daftar ?? []).filter(
    (p) => p?.status === 'aktif' && cocokNamaPemetaan(keterangan, p.supplier_nama)
  );
}

/**
 * Pemetaan yang cocok dengan beberapa huruf yang sedang diketik.
 *
 * Sengaja JAUH lebih longgar daripada cocokNamaPemetaan(): di sini manusia
 * sedang melihat daftarnya dan memilih sendiri, jadi salah tebak tidak bisa
 * lolos tanpa dilihat. Yang ketat adalah yang MENGISI formulir sendiri.
 */
export function cariPemetaan(daftar = [], kata = '', batas = 8) {
  const q = rapiNama(kata);
  if (q.length < PANJANG_KETIK_MINIMAL) return [];
  const qid = String(kata ?? '').trim().toLowerCase();

  const cocok = (daftar ?? []).filter((p) => {
    if (p?.status !== 'aktif') return false;
    if (rapiNama(p.supplier_nama).includes(q)) return true;
    return String(p.supplier_id ?? '').toLowerCase().startsWith(qid);
  });

  return satukanPemetaan(cocok).slice(0, batas);
}

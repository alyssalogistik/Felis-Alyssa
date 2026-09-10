// Mengubah PDF menjadi baris teks berkoordinat.
//
// Lapisan ini tidak tahu apa pun tentang bank mana pun. Tugasnya hanya satu:
// mengembalikan posisi setiap potong teks, karena tabel di dalam PDF tidak
// punya konsep "kolom" — yang ada hanya teks yang kebetulan sejajar. Penafsiran
// kolomnya dikerjakan bca.js, dan pemisahan itu yang membuat dukungan bank lain
// nanti tidak perlu menyentuh pembacaan PDF sama sekali.

import { GalatFormat } from './parser.js';

/** Selisih tegak sekecil ini masih dianggap satu baris yang sama. */
const TOLERANSI_BARIS = 2.5;

/**
 * Batas halaman dipertahankan. Rekening koran BCA mencetak ulang kop dan baris
 * kolom di setiap halaman; kalau halaman digabung menjadi satu aliran, kop
 * halaman berikutnya akan terbaca sebagai sambungan keterangan transaksi
 * terakhir halaman sebelumnya.
 *
 * @param {Buffer} buffer
 * @returns {Promise<Array<Array<Array<{x: number, lebar: number, teks: string}>>>>}
 *          Satu larik per halaman, berisi larik baris, berisi potongan teks.
 */
export async function bacaBarisPdf(buffer) {
  // Impor ditunda sampai benar-benar ada PDF yang dibaca. Pustakanya besar, dan
  // sebagian besar unggahan berupa xlsx yang tidak memerlukannya sama sekali.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  let dokumen;
  try {
    dokumen = await getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      // Rekening koran tidak memuat skrip maupun font eksternal yang perlu
      // diambil dari jaringan; mematikannya menutup jalur itu sekalian.
      isEvalSupported: false,
      disableFontFace: true,
    }).promise;
  } catch {
    throw new GalatFormat(
      'PDF tidak bisa dibuka. Kalau berkasnya terkunci kata sandi, buka dulu ' +
      'proteksinya lalu unggah ulang.'
    );
  }

  const halaman = [];

  for (let n = 1; n <= dokumen.numPages; n += 1) {
    const lembar = await dokumen.getPage(n);
    const isi = await lembar.getTextContent();

    // Kelompokkan per posisi tegak. PDF memancarkan potongan teks tanpa urutan
    // yang bisa diandalkan, jadi baris harus disusun ulang dari koordinatnya.
    const perY = new Map();
    for (const item of isi.items) {
      const teks = String(item.str ?? '');
      if (teks.trim() === '') continue;

      const y = item.transform[5];
      let kunci = null;
      for (const adaY of perY.keys()) {
        if (Math.abs(adaY - y) <= TOLERANSI_BARIS) { kunci = adaY; break; }
      }
      if (kunci === null) { kunci = y; perY.set(kunci, []); }

      perY.get(kunci).push({ x: item.transform[4], lebar: item.width ?? 0, teks });
    }

    // y membesar ke atas pada PDF, jadi urutan bacanya menurun.
    const baris = [...perY.keys()]
      .sort((a, b) => b - a)
      .map((y) => perY.get(y).sort((a, b) => a.x - b.x));

    halaman.push(baris);
    lembar.cleanup();
  }

  await dokumen.cleanup();

  if (halaman.every((h) => h.length === 0)) {
    throw new GalatFormat(
      'PDF tidak memuat teks yang bisa dibaca. Kalau ini hasil pindaian atau ' +
      'foto, unduh ulang e-statement dari myBCA/KlikBCA — versi itu memuat teks.'
    );
  }

  return halaman;
}

/** Gabungkan satu baris menjadi teks biasa, untuk pencarian kata kunci. */
export function teksBaris(baris) {
  return baris.map((p) => p.teks).join(' ').replace(/\s+/g, ' ').trim();
}

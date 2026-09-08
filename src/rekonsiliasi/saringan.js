// Penyaringan dan peringkasan transaksi. Murni, tanpa I/O.
//
// Tanggal di sini selalu berbentuk `YYYY-MM-DD`, sehingga perbandingannya cukup
// perbandingan teks biasa. Tidak ada objek Date, jadi tidak ada timezone yang
// bisa menggeser transaksi ke hari sebelumnya.

/** Semua kriteria yang terisi harus terpenuhi sekaligus, bukan salah satu. */
export function saring(transaksi, kriteria = {}) {
  const { cari, bulan, tahun, dari, sampai } = kriteria;

  const kata = typeof cari === 'string' ? cari.trim().toLowerCase() : '';
  const bulanAngka = bulan === '' || bulan === null || bulan === undefined ? null : Number(bulan);
  const tahunAngka = tahun === '' || tahun === null || tahun === undefined ? null : Number(tahun);

  return transaksi.filter((t) => {
    // Pencarian mengabaikan besar-kecil huruf dan mencocokkan sebagian teks,
    // supaya "trio putra" menemukan "PT TRIO PUTRA TRANS MANDIRI".
    if (kata !== '') {
      const sasaran = `${t.keterangan ?? ''} ${t.referensi ?? ''}`.toLowerCase();
      if (!sasaran.includes(kata)) return false;
    }

    // Transaksi tanpa tanggal valid tidak bisa memenuhi kriteria waktu apa pun.
    const adaKriteriaWaktu = bulanAngka !== null || tahunAngka !== null || dari || sampai;
    if (adaKriteriaWaktu && !t.tanggal) return false;

    if (tahunAngka !== null && Number(t.tanggal.slice(0, 4)) !== tahunAngka) return false;
    if (bulanAngka !== null && Number(t.tanggal.slice(5, 7)) !== bulanAngka) return false;
    if (dari && t.tanggal < dari) return false;
    if (sampai && t.tanggal > sampai) return false;

    return true;
  });
}

/**
 * Meringkas himpunan transaksi yang diberikan — bukan seluruh rekening koran.
 * Pemanggil menyerahkan hasil saring(), sehingga ringkasan selalu mengikuti
 * filter yang sedang aktif.
 *
 * Penjumlahan dilakukan dalam satuan sen lalu dibagi di akhir, supaya
 * pembulatan pecahan biner tidak menumpuk pada ribuan baris.
 */
export function ringkas(transaksi) {
  let debitSen = 0;
  let kreditSen = 0;

  for (const t of transaksi) {
    debitSen += Math.round((t.debit ?? 0) * 100);
    kreditSen += Math.round((t.kredit ?? 0) * 100);
  }

  return {
    jumlah: transaksi.length,
    debit: debitSen / 100,
    kredit: kreditSen / 100,
    net: (kreditSen - debitSen) / 100,
  };
}

/** Tahun yang benar-benar ada pada data, untuk mengisi pilihan filter. */
export function tahunTersedia(transaksi) {
  const tahun = new Set();
  for (const t of transaksi) {
    if (t.tanggal) tahun.add(Number(t.tanggal.slice(0, 4)));
  }
  return [...tahun].sort((a, b) => b - a);
}

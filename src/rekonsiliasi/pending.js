// Mencocokkan transaksi PEND dengan versi finalnya.
//
// Murni: menerima dua daftar, mengembalikan keputusan. Tanpa I/O, sehingga
// aturannya bisa diuji tanpa database — dan aturan inilah yang menentukan
// apakah satu transfer terhitung sekali atau dua kali.
//
// Latar belakangnya: cetakan Mutasi Rekening menampilkan transaksi yang belum
// dibukukan dengan "PEND" di kolom tanggal. Nominalnya sudah ikut dihitung BCA
// pada total kaki halaman, jadi barisnya disimpan dengan tanggal kosong. Saat
// mutasi berikutnya diunduh, transaksi yang sama muncul lagi — kali ini dengan
// tanggal sungguhan. Tanpa pencocokan ini, keduanya tersimpan berdampingan:
// sidik jarinya berbeda justru karena tanggalnya berbeda, sehingga penjaga
// duplikat yang biasa tidak menahannya, dan satu transfer terhitung dua kali.

/** Huruf besar-kecil dan spasi berlebih diseragamkan, sama seperti kolom `sidik`. */
function seragam(teks) {
  return String(teks ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Kunci pencocokan.
 *
 * Saldo ikut dibandingkan, dan itu disengaja. Saldo berjalan adalah satu-satunya
 * nilai yang membedakan dua transfer bernominal sama ke penerima sama pada hari
 * yang sama — dan BCA tidak mengubahnya saat transaksi dibukukan, karena
 * urutannya sudah tetap sejak transaksi masuk antrean.
 */
function kunci(t, noRekening) {
  return [
    String(t.no_rekening ?? noRekening ?? ''),
    seragam(t.keterangan),
    Number(t.debit ?? 0).toFixed(2),
    Number(t.kredit ?? 0).toFixed(2),
    t.saldo === null || t.saldo === undefined ? '' : Number(t.saldo).toFixed(2),
  ].join('|');
}

/**
 * Tentukan baris PEND mana yang dilunasi oleh transaksi baru bertanggal.
 *
 * @param {Array} pendingTersimpan Baris `transaksi_bank` bertanggal kosong.
 * @param {Array} transaksiBaru    Hasil penguraian berkas yang baru diunggah.
 * @param {?string} noRekening     Nomor rekening berkas itu. Hasil penguraian
 *                                 tidak memuatnya per baris — nomornya dibaca
 *                                 dari kop — sedangkan baris tersimpan memuatnya.
 * @returns {{promosi: Array<{id: string, tanggal: string}>, ragu: Array, cocok: number}}
 *
 * `promosi` adalah baris PEND yang cocok dengan TEPAT SATU transaksi baru, dan
 * sebaliknya. `ragu` adalah yang cocok lebih dari satu di salah satu sisi:
 * dilaporkan untuk diperiksa manusia, tidak pernah ditebak. Menebak di sini
 * berarti menempelkan tanggal yang salah pada uang yang benar-benar keluar,
 * dan tanggal yang salah tidak menimbulkan galat apa pun — baru ketahuan saat
 * angka auditnya dipakai.
 */
export function cocokkanPending(pendingTersimpan, transaksiBaru, noRekening = null) {
  const perKunciBaru = new Map();
  for (const t of transaksiBaru) {
    if (!t.tanggal) continue;
    const k = kunci(t, noRekening);
    if (!perKunciBaru.has(k)) perKunciBaru.set(k, []);
    perKunciBaru.get(k).push(t);
  }

  const perKunciPending = new Map();
  for (const p of pendingTersimpan) {
    if (p.tanggal) continue;
    const k = kunci(p, noRekening);
    if (!perKunciPending.has(k)) perKunciPending.set(k, []);
    perKunciPending.get(k).push(p);
  }

  const promosi = [];
  const ragu = [];

  for (const [k, daftarPending] of perKunciPending) {
    const daftarBaru = perKunciBaru.get(k);
    if (!daftarBaru) continue;

    if (daftarPending.length === 1 && daftarBaru.length === 1) {
      promosi.push({ id: daftarPending[0].id, tanggal: daftarBaru[0].tanggal });
      continue;
    }

    ragu.push({
      keterangan: daftarPending[0].keterangan,
      debit: daftarPending[0].debit,
      kredit: daftarPending[0].kredit,
      pending: daftarPending.length,
      bertanggal: daftarBaru.length,
    });
  }

  return { promosi, ragu, cocok: promosi.length };
}

/**
 * Baris PEND baru yang transaksinya sudah tersimpan bertanggal.
 *
 * Arah kebalikan dari cocokkanPending(). Terjadi ketika berkas lama diunggah
 * lagi setelah transaksinya dibukukan — misalnya satu PDF gabungan yang memuat
 * cetakan lama beserta baris PEND-nya. Barisnya sudah ada di database dengan
 * tanggal sungguhan, dan menyisipkan versi PEND-nya sekali lagi akan membuat
 * satu transfer terhitung dua kali. Sidik jari tidak bisa menahannya: yang satu
 * bertanggal, yang satu tidak.
 *
 * Yang dikembalikan daftar transaksi baru yang HARUS DILEWATI. Hanya yang cocok
 * dengan tepat satu baris tersimpan yang dilewati; sisanya tetap disisipkan,
 * karena melewatkan transaksi sungguhan jauh lebih berbahaya daripada
 * menyisipkan satu baris yang nanti ketahuan kembar.
 */
export function pendingSudahDibukukan(tersimpanBertanggal, transaksiBaru, noRekening = null) {
  const perKunci = new Map();
  for (const t of tersimpanBertanggal) {
    if (!t.tanggal) continue;
    const k = kunci(t, noRekening);
    perKunci.set(k, (perKunci.get(k) ?? 0) + 1);
  }

  const dilewati = [];
  for (const t of transaksiBaru) {
    if (t.tanggal) continue;
    // Yang dikembalikan objek aslinya, bukan salinannya: pemanggilnya
    // mengenali baris yang harus dilewati dari identitasnya.
    if (perKunci.get(kunci(t, noRekening)) === 1) dilewati.push(t);
  }
  return dilewati;
}

// Mencocokkan transaksi yang sama dari dua cetakan BCA yang berbeda.
//
// Murni: menerima dua daftar, mengembalikan keputusan. Tanpa I/O, sehingga
// aturannya bisa diuji tanpa database — dan aturan inilah yang menentukan
// apakah satu transfer terhitung sekali atau dua kali.
//
// Dua hal yang membuat sidik jari di database tidak bisa menahannya sendiri:
//
//   1. Transaksi PEND belum punya tanggal. Saat mutasi berikutnya membukukannya,
//      tanggalnya terisi — dan sidik jari keduanya berbeda justru karena
//      tanggalnya berbeda.
//   2. E-statement bulanan dan Mutasi Rekening menuliskan transaksi yang sama
//      dengan kalimat yang berbeda. Sidik jari memuat keterangan, jadi berbeda.

/**
 * Awalan jenis transaksi yang ditulis berbeda oleh kedua cetakan.
 *
 * Yang membedakan keduanya hanya bagian ini; sisa kalimatnya sama persis.
 *
 *   E-statement : BIF TRANSFER KE 008 HERMANSYAH KBB
 *   Mutasi      : BI-FAST DB TRANSFER KE 008 HERMANSYAH KBB
 *
 *   E-statement : 0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL
 *   Mutasi      : TRSF E-BANKING DB 0104/FTSCY/WS95051 10000000.00 PINJAMAN AAL
 *
 * Yang panjang harus diperiksa lebih dulu: "BI-FAST DB" sebelum "BIF", dan
 * "TRSF E-BANKING DB" sebelum "TRSF E-BANKING".
 */
const AWALAN_JENIS = [
  'trsf e-banking db', 'trsf e-banking cr', 'trsf e-banking',
  'byr via e-banking',
  'bi-fast db', 'bi-fast cr', 'bi-fast',
  'bif',
];

/** Huruf besar-kecil dan spasi berlebih diseragamkan, sama seperti kolom `sidik`. */
function seragam(teks) {
  return String(teks ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Isi keterangan tanpa awalan jenis transaksinya.
 *
 * Dipakai HANYA untuk membandingkan dua baris yang nominal, saldo, dan
 * rekeningnya sudah sama persis. Teks aslinya tidak pernah diubah: yang
 * tersimpan di `keterangan` tetap kalimat apa adanya dari bank, karena itulah
 * yang dicocokkan saat audit.
 */
export function intiKeterangan(teks) {
  const rapi = seragam(teks);
  for (const awalan of AWALAN_JENIS) {
    if (rapi === awalan) return rapi;
    if (rapi.startsWith(`${awalan} `)) {
      const sisa = rapi.slice(awalan.length + 1).trim();
      // Kalau yang tersisa kosong, awalannya memang seluruh keterangannya.
      return sisa === '' ? rapi : sisa;
    }
  }
  return rapi;
}

/**
 * Kunci pembanding, tanpa tanggal.
 *
 * Saldo ikut dibandingkan, dan itu yang menahan seluruhnya. Saldo berjalan
 * tidak pernah berulang untuk dua transaksi berbeda pada hari yang sama —
 * setiap transaksi mengubahnya — sehingga saldo yang sama beserta nominal yang
 * sama berarti transaksi yang sama, bukan dua transaksi yang mirip.
 */
function kunci(t, noRekening, entitas) {
  return [
    // Entitas ikut menyusun kunci, dan itu yang memisahkan PT dari CV.
    // Nomor rekening saja tidak cukup: baris lama tidak menyimpannya, dan yang
    // menyimpannya pun tidak seragam (0072890271 maupun 00072890271 untuk
    // rekening yang sama), sehingga transfer CV bisa tampak melunasi baris
    // PEND milik PT.
    String(t.entitas ?? entitas ?? ''),
    String(t.no_rekening ?? noRekening ?? ''),
    intiKeterangan(t.keterangan),
    Number(t.debit ?? 0).toFixed(2),
    Number(t.kredit ?? 0).toFixed(2),
    Number(t.saldo).toFixed(2),
  ].join('|');
}

/**
 * Baris yang tidak boleh ikut dibandingkan.
 *
 * Tanpa saldo, satu-satunya penahan kunci ini hilang. Tanpa nominal, barisnya
 * bukan uang melainkan sisa baris kop yang lolos penguraian — dan dua di
 * antaranya bisa tampak sama persis tanpa benar-benar transaksi yang sama.
 */
function bisaDibandingkan(t) {
  if (t.saldo === null || t.saldo === undefined || t.saldo === '') return false;
  return Number(t.debit ?? 0) > 0 || Number(t.kredit ?? 0) > 0;
}

function kelompokkan(daftar, noRekening, entitas, saring) {
  const peta = new Map();
  for (const t of daftar) {
    if (!bisaDibandingkan(t) || !saring(t)) continue;
    const k = kunci(t, noRekening, entitas);
    if (!peta.has(k)) peta.set(k, []);
    peta.get(k).push(t);
  }
  return peta;
}

/**
 * Baris PEND tersimpan yang dilunasi oleh transaksi baru bertanggal.
 *
 * @param {Array} tersimpan    Baris `transaksi_bank` milik rekening ini.
 * @param {Array} transaksiBaru Hasil penguraian berkas yang baru diunggah.
 * @param {?string} noRekening  Nomor rekening berkas itu. Hasil penguraian tidak
 *                              memuatnya per baris — ia dibaca dari kop.
 * @returns {{promosi: Array<{id, tanggal}>, ragu: Array}}
 *
 * Hanya yang cocok dengan TEPAT SATU kandidat di kedua sisi yang dilunasi.
 * Yang meragukan dilaporkan untuk diperiksa mata, tidak pernah ditebak:
 * menebak di sini berarti menempelkan tanggal yang salah pada uang yang
 * benar-benar keluar, dan tanggal yang salah tidak menimbulkan galat apa pun.
 */
export function cocokkanPending(tersimpan, transaksiBaru, noRekening = null, entitas = null) {
  const pending = kelompokkan(tersimpan, noRekening, entitas, (t) => !t.tanggal);
  const baru = kelompokkan(transaksiBaru, noRekening, entitas, (t) => Boolean(t.tanggal));

  const promosi = [];
  const ragu = [];

  for (const [k, daftarPending] of pending) {
    const daftarBaru = baru.get(k);
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

  return { promosi, ragu };
}

/**
 * Transaksi pada berkas ini yang sudah tersimpan dari cetakan lain.
 *
 * Dua keadaan yang dijawab sekaligus:
 *
 *   - Baris PEND baru yang versi bertanggalnya sudah tersimpan. Terjadi saat
 *     berkas lama diunggah lagi, atau satu PDF gabungan memuat cetakan lama
 *     beserta baris PEND-nya.
 *   - Baris bertanggal baru yang transaksinya sudah tersimpan dari cetakan
 *     bentuk lain pada tanggal yang sama. Sidik jari tidak menahannya karena
 *     kedua cetakan menuliskan kalimatnya berbeda.
 *
 * Yang dikembalikan objek ASLINYA dari `transaksiBaru`, supaya pemanggilnya
 * bisa mengenali baris yang harus dilewati dari identitasnya.
 *
 * Hanya yang cocok dengan tepat satu baris tersimpan yang dilewati. Melewatkan
 * transaksi sungguhan jauh lebih berbahaya daripada menyisipkan satu baris yang
 * nanti ketahuan kembar, jadi begitu ada keraguan barisnya tetap disisipkan.
 */
export function sudahTersimpan(tersimpan, transaksiBaru, noRekening = null, entitas = null) {
  const lama = kelompokkan(tersimpan, noRekening, entitas, () => true);
  const dilewati = [];

  for (const t of transaksiBaru) {
    if (!bisaDibandingkan(t)) continue;

    const kandidat = lama.get(kunci(t, noRekening, entitas));
    if (!kandidat || kandidat.length !== 1) continue;
    const satu = kandidat[0];

    if (!t.tanggal) {
      // Baris PEND baru: dilewati bila versi bertanggalnya sudah tersimpan.
      if (satu.tanggal) dilewati.push(t);
      continue;
    }

    // Baris bertanggal baru: dilewati hanya bila yang tersimpan bertanggal SAMA.
    // Tanggal yang berbeda berarti transaksi yang berbeda, bukan cetakan ulang.
    if (satu.tanggal === t.tanggal) dilewati.push(t);
  }

  return dilewati;
}

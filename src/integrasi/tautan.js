// Aturan pengikatan transaksi bank ke supplier, dan kelayakannya ditarik.
//
// Murni: tanpa I/O, tanpa DOM, tanpa database. Aturan inilah yang memutuskan
// apakah sejumlah uang boleh mengalir menjadi pembayaran supplier di sistem
// lain, jadi ia harus bisa diuji tanpa menyiapkan apa pun.
//
// ## Nama tidak pernah menjadi identitas
//
// Nama di rekening koran adalah hasil tebakan dari teks bank. Diukur pada 453
// transaksi keluar sungguhan: 138 nama dihasilkan, 18 di antaranya menggabung
// beberapa ejaan, dan namanya dipotong 18 karakter. Tebakan itu boleh
// MENYARANKAN; yang MENGIKAT selalu supplier_id yang dipilih manusia.

import { namaDariKeterangan } from '../rekonsiliasi/nama.js';

export const STATUS = {
  SIAP: 'siap',
  DITARIK: 'ditarik',
  DIBATALKAN: 'dibatalkan',
  PERLU_KOREKSI_HILIR: 'perlu_koreksi_hilir',

  /**
   * Owner sudah minta tautannya dilepas; alyssa-dev belum mengaku.
   *
   * Bentuknya meniru PERLU_KOREKSI_HILIR, dan itu disengaja: dua sistem yang
   * harus sepakat tidak boleh diubah sepihak. Selama berstatus ini transaksinya
   * TIDAK bebas — idTerpakai() masih menghitungnya, dan layakDitarik() menolak
   * menariknya — sehingga tidak ada jendela waktu di mana ia bisa ditautkan
   * ulang lalu ikut tertarik sebelum pelepasannya tuntas.
   */
  MENUNGGU_LEPAS: 'menunggu_lepas',
};

export const AKSI = {
  TAUTKAN: 'TAUTKAN',
  UBAH_SUPPLIER: 'UBAH_SUPPLIER',
  BATAL: 'BATAL',
  TARIK: 'TARIK',
  KOREKSI_HILIR: 'KOREKSI_HILIR',
  AKUI_KOREKSI: 'AKUI_KOREKSI',

  MINTA_LEPAS: 'MINTA_LEPAS',
  LEPAS_PAKSA: 'LEPAS_PAKSA',
  AKUI_LEPAS: 'AKUI_LEPAS',
};

/** Sebab penolakan yang bisa diperiksa mesin, bukan dicocokkan dari teksnya. */
export const SEBAB = {
  BUKAN_PENGELUARAN: 'bukan_pengeluaran',
  TANPA_TANGGAL: 'tanpa_tanggal',
  SUDAH_DITAUT: 'sudah_ditaut',
  SUDAH_DITARIK: 'sudah_ditarik',
  KEMBAR_SUDAH_DITAUT: 'kembar_sudah_ditaut',
  SUPPLIER_KOSONG: 'supplier_kosong',
  SUPPLIER_TIDAK_CANONICAL: 'supplier_tidak_canonical',
  KONFLIK: 'konflik',

  BELUM_DITARIK: 'belum_ditarik',
  SUDAH_DILEPAS: 'sudah_dilepas',
  SUDAH_MENUNGGU_LEPAS: 'sudah_menunggu_lepas',
  ALASAN_KOSONG: 'alasan_kosong',
  HILIR_BELUM_DIPASTIKAN: 'hilir_belum_dipastikan',
};

/**
 * Bentuk canonical supplier_profiles.id milik alyssa-dev: tepat delapan digit
 * heksadesimal huruf kecil.
 *
 * Dikunci di sini, bukan disebar ke setiap pemanggil, karena inilah satu-
 * satunya hal yang membedakan supplier sungguhan dari ketikan manusia. Felis
 * tidak punya master supplier dan tidak pernah membuat id sendiri; yang
 * tersimpan harus benar-benar id yang ada di sana.
 *
 * alyssa-dev membandingkannya PERSIS, jadi 'A3F91B2C' gagal lookup walaupun
 * menunjuk supplier yang sama. Karena itu ketikan diseragamkan ke huruf kecil
 * sebelum disimpan, bukan ditolak: yang salah bukan niat orangnya, melainkan
 * huruf besar yang tidak kelihatan bedanya di layar.
 */
export const POLA_SUPPLIER_ID = /^[0-9a-f]{8}$/;

/**
 * Bentuk seragam sebuah supplier_id, apa pun yang diketik.
 *
 * toLowerCase() tanpa locale, bukan toLocaleLowerCase(): di locale Turki
 * 'I' menjadi 'ı' yang bukan heksadesimal, sehingga id sah akan tertolak di
 * komputer yang kebetulan berbahasa itu.
 */
export function normalSupplierId(nilai) {
  return String(nilai ?? '').trim().toLowerCase();
}

/**
 * Kode bank tujuan yang tercetak BCA, atau null.
 *
 * BCA menuliskannya dalam dua bentuk, dan keduanya harus dikenali:
 *
 *   BI-FAST DB TRANSFER KE 002 MARTHEN RUNTURAMBI KBB     -> "KE 002"
 *   SWITCHING DB TRF SHEEHAN ALIF RAMAD 501 KBB           -> "501 KBB"
 *
 * Diukur pada data sungguhan, 235 dari 453 transaksi keluar tidak memuat kode
 * ini sama sekali — transfer sesama BCA lewat e-banking tidak mencetaknya.
 * Karena itu kode bank MENYEMPITKAN saran bila ada, dan tidak pernah menjadi
 * syarat: menjadikannya syarat akan membuat separuh transaksi tidak pernah
 * bisa disarankan sama sekali.
 */
export function kodeBankDari(keterangan) {
  const teks = String(keterangan ?? '').toUpperCase();
  const keKode = /\bKE\s+(\d{3})\b/.exec(teks);
  if (keKode) return keKode[1];
  const kodeKbb = /\b(\d{3})\s+KBB\b/.exec(teks);
  if (kodeKbb) return kodeKbb[1];
  return null;
}

/**
 * Kunci saran untuk satu keterangan bank, atau null bila tak bernama.
 *
 * Bentuknya `NAMA|KODEBANK`, dengan kode bank boleh kosong. Nama diambil lewat
 * namaDariKeterangan() yang sama dengan daftar supplier di layar, bukan aturan
 * kedua — dua aturan yang berbeda akan membuat saran menunjuk supplier yang
 * berbeda dari yang tertulis di baris yang sedang dilihat orang.
 */
export function kunciSaran(keterangan) {
  const nama = namaDariKeterangan(keterangan);
  if (!nama) return null;
  return `${nama}|${kodeBankDari(keterangan) ?? ''}`;
}

/**
 * Boleh diikat ke supplier?
 *
 * Empat syarat, dan ketiganya menolak dengan sebab yang bisa ditampilkan.
 */
export function layakDitautkan(transaksi, tautanYangAda = null) {
  if (!(Number(transaksi?.debit ?? 0) > 0)) {
    return {
      ok: false,
      sebab: SEBAB.BUKAN_PENGELUARAN,
      pesan: 'Hanya transaksi uang keluar yang bisa menjadi pembayaran supplier.',
    };
  }

  // Baris PEND belum punya tanggal buku dari BCA. Mengirimnya dengan tanggal
  // karangan akan merusak Riwayat di alyssa-dev tanpa menimbulkan galat apa
  // pun, dan baru ketahuan saat angkanya dipakai.
  if (!transaksi?.tanggal) {
    return {
      ok: false,
      sebab: SEBAB.TANPA_TANGGAL,
      pesan: 'Transaksi ini belum dibukukan BCA (PEND) sehingga belum punya tanggal. '
        + 'Unggah mutasi berikutnya dulu supaya tanggalnya terisi.',
    };
  }

  if (tautanYangAda && tautanYangAda.status !== STATUS.DIBATALKAN) {
    const sudahTarik = tautanYangAda.status === STATUS.DITARIK
      || tautanYangAda.status === STATUS.PERLU_KOREKSI_HILIR;
    return {
      ok: false,
      sebab: sudahTarik ? SEBAB.SUDAH_DITARIK : SEBAB.SUDAH_DITAUT,
      pesan: sudahTarik
        ? 'Transaksi ini sudah ditarik alyssa-dev. Pakai koreksi, bukan tautan baru.'
        : 'Transaksi ini sudah ditautkan. Ubah suppliernya kalau keliru.',
    };
  }

  return { ok: true };
}

/** Supplier yang disebut cukup jelas untuk disimpan? */
export function supplierValid(supplier) {
  const id = normalSupplierId(supplier?.supplier_id);
  const nama = String(supplier?.supplier_nama ?? '').trim();
  if (id === '' || nama === '') {
    return {
      ok: false,
      sebab: SEBAB.SUPPLIER_KOSONG,
      pesan: 'supplier_id dan supplier_nama dari alyssa-dev wajib diisi.',
    };
  }
  if (!POLA_SUPPLIER_ID.test(id)) {
    return {
      ok: false,
      sebab: SEBAB.SUPPLIER_TIDAK_CANONICAL,
      pesan: 'supplier_id harus tepat 8 digit heksadesimal dari Master Supplier '
        + 'alyssa-dev, misalnya a3f91b2c. Salin dari kolom id, jangan diketik ulang '
        + 'dan jangan dikarang sendiri.',
    };
  }
  // Nilai yang sudah diseragamkan ikut dikembalikan supaya pemanggil menyimpan
  // yang INI, bukan yang diterimanya sendiri. Memulangkan hanya {ok:true}
  // membuat setiap pemanggil harus ingat menormalkan, dan yang lupa menyimpan
  // huruf besar yang gagal lookup di alyssa-dev tanpa satu pun galat di sini.
  return { ok: true, supplier_id: id, supplier_nama: nama };
}

/**
 * Saran supplier dari daftar pemetaan yang cocok.
 *
 * Mengembalikan { saran, konflik, kandidat }.
 *
 * Kalau kandidatnya menunjuk lebih dari satu supplier_id, TIDAK ADA saran yang
 * diberikan — hanya daftar kandidat beserta tanda konflik. Dua supplier
 * bernama sama adalah keadaan yang sah; yang tidak sah adalah menebak salah
 * satunya.
 */
export function pilihSaran(pemetaanCocok = []) {
  const aktif = pemetaanCocok.filter((p) => p.status === 'aktif');
  const unik = [...new Map(aktif.map((p) => [p.supplier_id, p])).values()];

  if (unik.length === 0) return { saran: null, konflik: false, kandidat: [] };
  if (unik.length === 1) return { saran: unik[0], konflik: false, kandidat: unik };
  return { saran: null, konflik: true, kandidat: unik };
}

/**
 * Boleh masuk daftar siap tarik?
 *
 * Sengaja terpisah dari layakDitautkan(): yang satu memutuskan boleh diikat,
 * yang satu memutuskan boleh mengalir keluar. Menggabungkannya membuat satu
 * perubahan aturan pengikatan diam-diam mengubah apa yang dikirim.
 */
/**
 * transaksi_id yang sedang TERPAKAI oleh sebuah tautan.
 *
 * Tautan berstatus 'dibatalkan' TIDAK menghitung: barisnya masih memegang
 * kunci primernya, tetapi transaksinya kembali bebas dan boleh ditautkan lagi —
 * aturan yang sama dipakai layakDitautkan(). Kalau yang dibatalkan ikut
 * dianggap terpakai, transaksi yang sengaja dilepas tidak akan pernah muncul
 * lagi sebagai pilihan, dan satu-satunya jalan memperbaikinya lewat SQL.
 *
 * @param {Array<{transaksi_id: string, status: string}>} daftar
 * @returns {Set<string>}
 */
export function idTerpakai(daftar) {
  return new Set(
    (daftar ?? [])
      .filter((t) => t?.transaksi_id && t.status !== STATUS.DIBATALKAN)
      .map((t) => t.transaksi_id)
  );
}

/**
 * Boleh dilepas dari supplier, dan dengan cara apa?
 *
 * ## Kenapa jalur ini ada
 *
 * `ditarik` sebelumnya adalah status TERMINAL: tidak satu pun endpoint bisa
 * memindahkannya. Aturannya benar untuk operasional — uangnya sudah keluar
 * dari rekening, dan yang bisa dibatalkan hanya pencatatannya di alyssa-dev.
 *
 * Tetapi pada masa uji coba, pemilik memang menghapus catatan di alyssa-dev
 * ketika pemetaannya keliru. Felis tidak pernah diberi tahu, sehingga barisnya
 * tertinggal `ditarik` selamanya dan transaksinya tidak bisa ditautkan ulang
 * lewat layar sama sekali. Diukur dari pemakaian sungguhan: satu percobaan
 * menautkan 16 transaksi MARTHEN RUNTURAMBI ditolak 16 dari 16.
 *
 * ## Dua jalan keluar, dan yang aman adalah bawaannya
 *
 * **Tanpa `paksa`** — barisnya menjadi `menunggu_lepas` dan muncul di
 * `GET /integrasi/lepas`. alyssa-dev yang menghapus catatannya lalu mengaku
 * lewat `POST /integrasi/lepas/akui`, dan barulah statusnya `dibatalkan`.
 * Bentuknya sama persis dengan alur koreksi yang sudah ada, dengan alasan yang
 * sama: keadaan yang dipegang dua sistem tidak boleh diubah sepihak.
 *
 * **Dengan `paksa`** — langsung `dibatalkan`, tanpa menunggu siapa pun. Ini
 * yang dipakai ketika pemiliknya SUDAH menghapus catatannya sendiri di
 * alyssa-dev, sehingga tidak ada lagi yang akan mengaku. Karena itu ia menuntut
 * pengakuan eksplisit lewat `sudah_dihapus_di_hilir`: yang dikunci bukan
 * kebenarannya — Felis tidak punya cara memeriksanya — melainkan **siapa yang
 * menyatakannya**, dan itu tersimpan permanen di riwayat.
 *
 * ## Yang tidak dilayani di sini
 *
 * Tautan `siap` TIDAK boleh lewat jalur ini. Pembatalannya sudah punya
 * endpoint sendiri yang tidak menyentuh alyssa-dev sama sekali, karena memang
 * belum pernah dikirim ke sana. Dua jalur untuk satu hal berarti dua tempat
 * yang bisa menyimpang, dan yang menyimpang di sini melepas pembayaran yang
 * seharusnya tertahan.
 *
 * @param {object|null} tautan baris tautan_pembayaran apa adanya
 * @param {{alasan?: string, paksa?: boolean, sudah_dihapus_di_hilir?: boolean}} opsi
 */
export function layakDilepas(tautan, opsi = {}) {
  if (!tautan) {
    return { ok: false, sebab: SEBAB.SUDAH_DITAUT, pesan: 'Tautan tidak ditemukan.' };
  }

  if (tautan.status === STATUS.SIAP) {
    return {
      ok: false,
      sebab: SEBAB.BELUM_DITARIK,
      pesan: 'Tautan ini belum ditarik alyssa-dev, jadi tidak perlu dilepas paksa. '
        + 'Batalkan saja lewat tombol pembatalan biasa.',
    };
  }

  if (tautan.status === STATUS.DIBATALKAN) {
    return {
      ok: false,
      sebab: SEBAB.SUDAH_DILEPAS,
      pesan: 'Tautan ini sudah dibatalkan. Transaksinya sudah bebas ditautkan lagi.',
    };
  }

  const alasan = String(opsi.alasan ?? '').trim();
  if (alasan === '') {
    return {
      ok: false,
      sebab: SEBAB.ALASAN_KOSONG,
      pesan: 'Alasan pelepasan wajib diisi. Inilah satu-satunya keterangan yang '
        + 'tersisa saat angkanya diperiksa nanti.',
    };
  }

  const paksa = opsi.paksa === true;

  // Yang sudah menunggu tidak boleh diminta lagi — tetapi BOLEH dipaksa, karena
  // itulah jalan keluarnya ketika alyssa-dev ternyata tidak akan pernah mengaku.
  if (tautan.status === STATUS.MENUNGGU_LEPAS && !paksa) {
    return {
      ok: false,
      sebab: SEBAB.SUDAH_MENUNGGU_LEPAS,
      pesan: 'Pelepasan tautan ini sudah diminta dan sedang menunggu pengakuan '
        + 'alyssa-dev.',
    };
  }

  if (paksa && opsi.sudah_dihapus_di_hilir !== true) {
    return {
      ok: false,
      sebab: SEBAB.HILIR_BELUM_DIPASTIKAN,
      pesan: 'Pelepasan paksa menuntut pernyataan bahwa catatan pembayarannya '
        + 'SUDAH dihapus di alyssa-dev. Tanpa itu satu transfer bisa tercatat '
        + 'dua kali di sana.',
    };
  }

  return {
    ok: true,
    paksa,
    alasan,
    status_baru: paksa ? STATUS.DIBATALKAN : STATUS.MENUNGGU_LEPAS,
    aksi: paksa ? AKSI.LEPAS_PAKSA : AKSI.MINTA_LEPAS,
  };
}

export function layakDitarik(tautan) {
  if (!tautan) return { ok: false, sebab: SEBAB.SUDAH_DITAUT, pesan: 'Belum ditautkan.' };
  if (tautan.status !== STATUS.SIAP) {
    return {
      ok: false,
      sebab: tautan.status === STATUS.DITARIK ? SEBAB.SUDAH_DITARIK : SEBAB.SUDAH_DITAUT,
      pesan: `Status tautan "${tautan.status}", hanya "siap" yang boleh ditarik.`,
    };
  }
  if (!tautan.tanggal) return { ok: false, sebab: SEBAB.TANPA_TANGGAL, pesan: 'Tanpa tanggal.' };
  if (!(Number(tautan.nominal) > 0)) {
    return { ok: false, sebab: SEBAB.BUKAN_PENGELUARAN, pesan: 'Nominal tidak positif.' };
  }
  return { ok: true };
}

/**
 * Payload satu pembayaran untuk alyssa-dev.
 *
 * Murni supaya bentuknya bisa diuji tanpa database — dan karena bentuk inilah
 * kontrak antara dua sistem, yang berubahnya harus terlihat di diff.
 *
 * `bank_account_number` SELALU null. Mengisinya dari master supplier akan
 * membuat payload tampak seolah bank mengonfirmasi rekening tujuan, padahal
 * BCA tidak mencetaknya sama sekali pada transfer keluar: dari 453 transaksi
 * keluar sungguhan, nol yang memuatnya. alyssa-dev membaca rekening tujuan
 * dari masternya sendiri, dan dengan begitu tahu dari mana asalnya.
 */
export function payloadPembayaran(tautan, transaksi, labelEntitas, alokasi = null) {
  return {
    idempotency_key: tautan.transaksi_id,
    bank_transaction_id: tautan.transaksi_id,
    bank_transaction_sidik: tautan.sidik,

    supplier_id: tautan.supplier_id,
    supplier_name: tautan.supplier_nama,

    source_entity: tautan.entitas,
    source_entity_label: labelEntitas ?? tautan.entitas,
    source_account_number: transaksi?.no_rekening ?? null,

    beneficiary_bank_code: kodeBankDari(transaksi?.keterangan),
    // Nama penerima yang DITURUNKAN dari keterangan bank. Untuk ditampilkan
    // saja — BCA tidak mencetak kolom nama penerima tersendiri, jadi ini hasil
    // penguraian kalimat dan bisa meleset. Yang otoritatif tetap
    // deskripsi_bank. JANGAN PERNAH dipakai sebagai identitas supplier.
    beneficiary_name_raw: namaDariKeterangan(transaksi?.keterangan) ?? null,
    bank_account_number: null,
    bank_account_name: null,

    tanggal: tautan.tanggal,
    nominal: Number(tautan.nominal),
    deskripsi_bank: transaksi?.keterangan ?? null,
    referensi_bank: transaksi?.referensi ?? null,

    // Alokasi pekerjaan/proyek bila auditor sudah mencatatnya. Selama
    // administrasi PO belum tertib, bentuknya CATATAN berisi teks bebas;
    // bentuk PO dan INVOICE memakai struktur yang sama persis sehingga
    // menambahkannya nanti tidak mengubah daftar field.
    //
    // Satu transaksi hanya pernah menunjuk satu PO karena transaksi_id adalah
    // primary key tautan, jadi larik ini berisi 0 atau 1 elemen.
    alokasi: alokasi?.keterangan
      ? [{ tipe: 'CATATAN', ref: alokasi.keterangan, nominal: Number(tautan.nominal) }]
      : [],
  };
}

// Menafsirkan cetakan "Informasi Rekening - Mutasi Rekening" dari KlikBCA.
//
// Berkas ini berdampingan dengan bca.js, tidak menggantikannya. Keduanya
// mengeluarkan bentuk yang sama persis — tabel bersama baris header — lalu
// diteruskan ke uraiTabel() yang sama dengan jalur xlsx dan csv. Validasi,
// penandaan duplikat, dan penomoran kembar_ke tetap hanya ada satu tempat.
//
// Tiga hal yang membedakannya dari e-statement bulanan:
//
//   1. Tanggalnya lengkap DD/MM/YYYY, sehingga tahun tidak pernah perlu
//      disimpulkan dari baris PERIODE. Sebaliknya, periodenya berupa rentang
//      tanggal, bukan satu bulan.
//   2. Keterangan satu transaksi tersebar di baris SEBELUM dan SESUDAH baris
//      berangka. Pada e-statement bulanan sambungannya selalu di bawah.
//   3. Transaksi yang belum dibukukan dicetak dengan "PEND" di kolom tanggal,
//      bukan tanggal. Nominalnya sudah ikut dihitung BCA pada total kaki
//      halaman, jadi barisnya tetap disimpan — dengan tanggal kosong, bukan
//      tanggal karangan.

import { GalatFormat } from './parser.js';
import { teksBaris } from './pdf.js';

/** Kolom cetakan Mutasi Rekening, sesuai urutan kirinya. */
const KOLOM = ['TGL', 'KETERANGAN', 'CABANG', 'JUMLAH', 'SALDO'];

/** Nominal di kolom JUMLAH selalu ditutup penanda arah; itulah penanda barisnya. */
const NOMINAL_BERARAH = /^[\d.,]+\s*(db|cr|dr)$/i;

/** Baris kaki dan tombol navigasi halaman web yang ikut tercetak ke PDF. */
const BUKAN_TRANSAKSI =
  /^(saldo awal|saldo akhir|mutasi (debet|debit|kredit|cr|db)|format download|csv|html|sebelumnya|berikutnya|cetak|download|kembali|©|informasi rekening|no\.? rekening|nama\b|periode|kode mata uang)/i;

function normal(teks) {
  return String(teks ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Cari baris judul kolom dan tetapkan tepi kiri setiap kolomnya.
 *
 * Judulnya "Tgl / Keterangan / Cabang / Jumlah / Saldo" — tidak satu pun sama
 * dengan judul e-statement bulanan ("TANGGAL / KETERANGAN / CBG / MUTASI /
 * SALDO"). Perbedaan itulah yang dipakai baca.js memilih penafsir, sehingga
 * kedua format tidak pernah bisa tertukar.
 */
export function cariKolomMutasi(baris) {
  for (let i = 0; i < Math.min(baris.length, 60); i += 1) {
    const potong = baris[i];
    const teks = normal(teksBaris(potong));
    if (!teks.includes('tgl') || !teks.includes('keterangan') || !teks.includes('jumlah')) continue;

    const tepi = {};
    for (const potongan of potong) {
      const nama = normal(potongan.teks);
      const cocok = KOLOM.find((k) => normal(k) === nama);
      if (cocok && tepi[cocok] === undefined) {
        // Kolom angka dicetak rata kanan, jadi tepi kanan judulnyalah yang
        // sejajar dengan tepi kanan nilainya.
        tepi[cocok] = cocok === 'JUMLAH' || cocok === 'SALDO'
          ? potongan.x + (potongan.lebar ?? 0)
          : potongan.x;
      }
    }

    if (tepi.TGL !== undefined && tepi.KETERANGAN !== undefined && tepi.JUMLAH !== undefined) {
      return { indeks: i, tepi };
    }
  }
  return null;
}

/** Apakah halaman ini memakai tata letak Mutasi Rekening? */
export function formatMutasi(halaman) {
  return halaman.some((h) => cariKolomMutasi(h) !== null);
}

/**
 * Bagi satu baris menjadi sel per kolom.
 *
 * Teks dinilai dari tepi kirinya, angka dari tepi kanannya — aturan yang sama
 * dengan e-statement bulanan, dan karena alasan yang sama: KETERANGAN memanjang
 * jauh melewati lebar judulnya, sedangkan JUMLAH dan SALDO dicetak rata kanan.
 */
function selDari(baris, kolom) {
  const sel = {};
  for (const potongan of baris) {
    const teks = potongan.teks.trim();
    const kanan = /^[\d.,]+(\s*(db|cr|dr))?$/i.test(teks);

    let pilih = 'KETERANGAN';
    if (kanan) {
      // Dicocokkan ke tepi kanan kolom terdekat, bukan ke kolom yang tepi
      // kirinya terlampaui: nominal panjang mulai jauh di kiri judulnya.
      const kananTeks = potongan.x + (potongan.lebar ?? 0);
      let terdekat = Infinity;
      for (const k of ['JUMLAH', 'SALDO']) {
        const jarak = Math.abs(kolom.tepi[k] - kananTeks);
        if (kolom.tepi[k] !== undefined && jarak < terdekat) { terdekat = jarak; pilih = k; }
      }
      // Angka yang tidak dekat kolom mana pun dinilai dari tepi kirinya —
      // nomor cabang dan angka yang menempel di keterangan jatuh ke sini.
      if (terdekat > 12) pilih = tepiKiri(potongan.x, kolom);
    } else {
      pilih = tepiKiri(potongan.x, kolom);
    }

    sel[pilih] = sel[pilih] ? `${sel[pilih]} ${potongan.teks}` : potongan.teks;
  }
  return sel;
}

function tepiKiri(x, kolom) {
  let pilih = KOLOM[0];
  for (const k of KOLOM) {
    if (kolom.tepi[k] !== undefined && x >= kolom.tepi[k] - 3) pilih = k;
  }
  // JUMLAH dan SALDO diukur dari tepi kanannya, jadi tepi kiri tidak berlaku
  // untuk keduanya; teks yang jatuh ke sana sebenarnya milik kolom sebelumnya.
  if (pilih === 'JUMLAH' || pilih === 'SALDO') pilih = 'CABANG';
  return pilih;
}

/** Baris berangka: satu-satunya baris yang benar-benar mewakili satu transaksi. */
function barisNominal(baris, kolom) {
  const sel = selDari(baris, kolom);
  return NOMINAL_BERARAH.test((sel.JUMLAH ?? '').trim()) ? sel : null;
}

/**
 * Nomor rekening dari kop.
 *
 * Dicetak "007-2890271"; pemisahnya dilepas supaya sebanding dengan nomor yang
 * tersimpan dari e-statement bulanan.
 */
export function noRekeningMutasi(halaman) {
  const ketemu = new Set();
  for (const h of halaman) {
    for (const potong of h.slice(0, 12)) {
      const teks = teksBaris(potong);
      const cocok = teks.match(/no\.?\s*rekening\s*:?\s*([0-9][0-9\s-]{5,})/i);
      if (cocok) ketemu.add(cocok[1].replace(/[\s-]/g, ''));
    }
  }

  // Beberapa berkas yang digabung menjadi satu PDF boleh saja, asal rekeningnya
  // satu. Dua rekening dalam satu unggahan akan menyandera sidik jari transaksi
  // pada nomor yang salah, dan salahnya tidak menimbulkan gejala apa pun.
  if (ketemu.size > 1) {
    throw new GalatFormat(
      `PDF ini memuat mutasi dari ${ketemu.size} nomor rekening berbeda ` +
      `(${[...ketemu].join(', ')}). Unggah satu rekening per berkas.`
    );
  }
  return ketemu.size === 1 ? [...ketemu][0] : null;
}

/**
 * Rentang tanggal dari kop, digabung dari seluruh halaman.
 *
 * Satu PDF bisa berisi beberapa cetakan yang disatukan, masing-masing dengan
 * kop dan rentangnya sendiri. Yang dilaporkan rentang terluarnya, sehingga
 * riwayat unggahan menyebut apa yang benar-benar ada di dalam berkas.
 */
export function periodeMutasi(halaman) {
  const tanggal = [];
  for (const h of halaman) {
    for (const potong of h.slice(0, 12)) {
      const teks = teksBaris(potong);
      if (!/periode/i.test(teks)) continue;
      for (const cocok of teks.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) {
        tanggal.push(iso(cocok[1], cocok[2], cocok[3]));
      }
    }
  }
  if (tanggal.length === 0) return null;
  tanggal.sort();
  return { mulai: tanggal[0], selesai: tanggal[tanggal.length - 1] };
}

function iso(hari, bulan, tahun) {
  return `${tahun}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
}

/**
 * Pisahkan baris keterangan di antara dua baris berangka.
 *
 * Inilah bagian yang paling mudah dirusak. Keterangan satu transaksi berada di
 * atas DAN di bawah baris berangkanya, sehingga rentetan baris di antara dua
 * transaksi harus dipotong di satu tempat: yang di atas potongan milik
 * transaksi sebelumnya, yang di bawah milik transaksi berikutnya.
 *
 * Titik potongnya jarak tegak terbesar. BCA mencetak baris dalam satu transaksi
 * lebih rapat daripada jarak antartransaksi, dan itu satu-satunya pemisah yang
 * ada — tidak ada garis, tidak ada spasi kosong, tidak ada nomor urut.
 *
 * Yang diukur perbandingan antarjarak di dalam berkas itu sendiri, bukan angka
 * tetap dalam poin. Ukuran huruf cetakan bisa berubah; urutan rapat-renggangnya
 * tidak.
 */
export function titikPotong(y) {
  let potong = 0;
  let terjauh = -Infinity;
  for (let i = 1; i < y.length; i += 1) {
    const jarak = y[i - 1] - y[i];
    if (jarak > terjauh) { terjauh = jarak; potong = i; }
  }
  return potong;
}

/**
 * Ubah halaman berkoordinat menjadi tabel bersama header.
 *
 * @returns {{tabel, rentang, noRekening, pending: number}}
 */
export function tabelDariMutasi(halaman) {
  const kolomPertama = halaman.map(cariKolomMutasi).find(Boolean);
  if (!kolomPertama) {
    throw new GalatFormat(
      'PDF ini tidak dikenali sebagai Mutasi Rekening BCA — baris kolom ' +
      'Tgl / Keterangan / Jumlah tidak ditemukan.'
    );
  }

  const rentang = periodeMutasi(halaman);
  const noRekening = noRekeningMutasi(halaman);
  const tabel = [['TANGGAL', 'KETERANGAN', 'CBG', 'MUTASI', 'SALDO', 'REFERENSI']];
  let pending = 0;
  let kolom = kolomPertama;

  for (const isiHalaman of halaman) {
    const header = cariKolomMutasi(isiHalaman);
    if (header) kolom = header;

    // Kop dan baris judul dilewati. Tanpa ini "NO. REKENING" halaman berikutnya
    // akan tergabung sebagai sambungan keterangan transaksi terakhir halaman
    // sebelumnya — halaman sesudah yang pertama pun mencetak ulang kopnya.
    const mulai = header ? header.indeks + 1 : 0;
    const baris = [];
    for (let i = mulai; i < isiHalaman.length; i += 1) {
      const teks = teksBaris(isiHalaman[i]);
      if (teks === '' || BUKAN_TRANSAKSI.test(teks)) continue;
      baris.push(isiHalaman[i]);
    }

    // Setiap baris berangka adalah tepat satu transaksi. Jumlah transaksi
    // karena itu tidak pernah bergantung pada benar-salahnya pemotongan
    // keterangan di bawah: yang bisa keliru hanya milik siapa satu baris teks,
    // tidak pernah berapa banyak uang yang keluar.
    const jangkar = [];
    for (let i = 0; i < baris.length; i += 1) {
      const sel = barisNominal(baris[i], kolom);
      if (sel) jangkar.push({ i, sel, kepala: [], ekor: [] });
    }
    if (jangkar.length === 0) continue;

    // Baris keterangan sebelum baris berangka pertama seluruhnya milik
    // transaksi pertama, dan yang sesudah baris berangka terakhir milik
    // transaksi terakhir. Halaman baru selalu dimulai kop, jadi tidak ada
    // transaksi yang terbelah di pergantian halaman.
    jangkar[0].kepala = baris.slice(0, jangkar[0].i);
    jangkar[jangkar.length - 1].ekor = baris.slice(jangkar[jangkar.length - 1].i + 1);

    // Setiap sela antara dua baris berangka dipotong SEKALI, lalu kedua
    // sisinya dibagikan dari potongan yang sama. Menghitungnya dua kali —
    // sekali dari sisi atas, sekali dari sisi bawah — bisa menghasilkan dua
    // jawaban berbeda, dan satu baris nama supplier bisa hilang atau terhitung
    // pada dua transaksi sekaligus.
    for (let n = 0; n < jangkar.length - 1; n += 1) {
      const antara = baris.slice(jangkar[n].i + 1, jangkar[n + 1].i);
      if (antara.length === 0) continue;

      const deret = [baris[jangkar[n].i], ...antara, baris[jangkar[n + 1].i]];
      const potong = titikPotong(deret.map((b) => b[0].y));

      // deret[0] adalah baris berangka atasnya sendiri, jadi indeks di `antara`
      // bergeser satu. Potongan di indeks 0 tidak mungkin terjadi karena jarak
      // pertama selalu ikut dibandingkan mulai dari i = 1.
      jangkar[n].ekor = antara.slice(0, potong - 1);
      jangkar[n + 1].kepala = antara.slice(potong - 1);
    }

    for (const { sel, kepala, ekor } of jangkar) {
      const keterangan = [
        ...kepala.map((b) => selDari(b, kolom).KETERANGAN ?? ''),
        sel.KETERANGAN ?? '',
        ...ekor.map((b) => selDari(b, kolom).KETERANGAN ?? ''),
      ].map((t) => t.trim()).filter(Boolean).join(' ');

      const tgl = (sel.TGL ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(20\d{2})/);
      if (!tgl) pending += 1;

      tabel.push([
        tgl ? iso(tgl[1], tgl[2], tgl[3]) : '',
        keterangan,
        (sel.CABANG ?? '').trim(),
        (sel.JUMLAH ?? '').trim(),
        (sel.SALDO ?? '').trim(),
        '',
      ]);
    }
  }

  if (tabel.length === 1) {
    throw new GalatFormat('Tabel Mutasi Rekening ditemukan, tetapi tidak ada baris transaksi di dalamnya.');
  }

  for (let i = 1; i < tabel.length; i += 1) tabel[i][5] = referensiMutasi(tabel[i][1]) ?? '';

  return { tabel, rentang, noRekening, pending };
}

/** Nomor rujukan yang menempel di keterangan, ditarik keluar agar bisa dicocokkan. */
export function referensiMutasi(keterangan) {
  const ref = keterangan.match(/\bREF[:\s]*([A-Z0-9]{5,})/i);
  if (ref) return ref[1];
  // Bentuk khas KlikBCA: 0109/FTSCY/WS95051.
  const ftscy = keterangan.match(/\b(\d{4}\/[A-Z]{4,6}\/[A-Z]{2}\d{4,6})\b/);
  if (ftscy) return ftscy[1];
  const wsid = keterangan.match(/\bWSID[:\s]*([A-Z0-9]+)/i);
  return wsid ? `WSID:${wsid[1]}` : null;
}

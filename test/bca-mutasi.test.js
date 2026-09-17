// Cetakan "Mutasi Rekening" dari KlikBCA.
//
// Berkas contoh di test/berkas/ meniru tata letaknya; isinya karangan.
// Rekening koran sungguhan tidak pernah masuk repositori — nama supplier dan
// nominal di dalamnya nyata.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bacaRekeningKoran, PENANDA_PENDING } from '../src/rekonsiliasi/baca.js';
import { bacaBarisPdf } from '../src/rekonsiliasi/pdf.js';
import {
  cariKolomMutasi, formatMutasi, noRekeningMutasi, periodeMutasi,
  referensiMutasi, tabelDariMutasi, titikPotong,
} from '../src/rekonsiliasi/bca-mutasi.js';

const berkas = (nama) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'berkas', nama));
const baca = (nama) => bacaRekeningKoran(berkas(nama), nama);
const cari = (transaksi, potongan) => transaksi.find((t) => t.keterangan.includes(potongan));

// --- Pengenalan format ------------------------------------------------------

test('cetakan Mutasi Rekening dikenali dari judul kolomnya', async () => {
  assert.equal(formatMutasi(await bacaBarisPdf(berkas('bca-mutasi-harian.pdf'))), true);
});

test('KAIDAH: e-statement bulanan tidak pernah tertangkap penafsir Mutasi', async () => {
  // Judul kolom keduanya tidak beririsan sama sekali: e-statement memakai
  // TANGGAL / KETERANGAN / CBG / MUTASI / SALDO, cetakan Mutasi memakai
  // Tgl / Keterangan / Cabang / Jumlah / Saldo. Kalau salah satu sampai
  // menangkap yang lain, seluruh angka satu berkas bisa masuk ke kolom yang
  // keliru tanpa satu pun galat muncul.
  for (const nama of ['bca-agustus.pdf', 'bca-januari.pdf']) {
    assert.equal(formatMutasi(await bacaBarisPdf(berkas(nama))), false, nama);
  }
});

test('KAIDAH: e-statement bulanan terbaca persis seperti sebelumnya', async () => {
  // Penjaga regresi. Format lama sudah bertahun-tahun masuk ke database ini;
  // penambahan format baru tidak boleh menggeser satu angka pun di dalamnya.
  const hasil = await baca('bca-agustus.pdf');
  assert.equal(hasil.sheet, 'BCA 08/2026');
  assert.equal(hasil.transaksi.length, 6);
  assert.equal(hasil.transaksi[0].debit, 5055000);
  assert.equal(hasil.rentang, undefined, 'jalur lama tidak ikut membawa rentang');
});

// --- Kop --------------------------------------------------------------------

test('nomor rekening dibaca tanpa pemisahnya', async () => {
  // Dicetak "007-1234567"; yang tersimpan dari e-statement tidak memuat tanda
  // hubung. Kalau keduanya tidak diseragamkan, sidik jari transaksi yang sama
  // dari dua format menjadi berbeda tanpa gejala apa pun.
  assert.equal(noRekeningMutasi(await bacaBarisPdf(berkas('bca-mutasi-harian.pdf'))), '0071234567');
});

test('periode dibaca sebagai rentang, bukan satu bulan', async () => {
  const rentang = periodeMutasi(await bacaBarisPdf(berkas('bca-mutasi-harian.pdf')));
  assert.deepEqual(rentang, { mulai: '2026-09-01', selesai: '2026-09-03' });
});

test('baris judul kolom ditemukan beserta tepi kanan kolom angkanya', async () => {
  const kolom = cariKolomMutasi((await bacaBarisPdf(berkas('bca-mutasi-harian.pdf')))[0]);
  assert.ok(kolom);
  // JUMLAH dan SALDO dicetak rata kanan, jadi yang disimpan tepi kanannya.
  assert.ok(kolom.tepi.JUMLAH > kolom.tepi.CABANG);
  assert.ok(kolom.tepi.SALDO > kolom.tepi.JUMLAH);
});

// --- Transaksi --------------------------------------------------------------

test('seluruh transaksi terbaca dengan nominal dan arah yang benar', async () => {
  const { transaksi } = await baca('bca-mutasi-harian.pdf');

  assert.equal(transaksi.length, 6);
  // Cocok dengan baris kaki cetakannya sendiri: DB 2.480.000 (4), CR 5.372.305 (2).
  assert.equal(transaksi.reduce((s, t) => s + t.debit, 0), 2480000);
  assert.equal(transaksi.reduce((s, t) => s + t.kredit, 0), 5372305);
  assert.equal(transaksi.filter((t) => t.debit > 0).length, 4);
  assert.equal(transaksi.filter((t) => t.kredit > 0).length, 2);
});

test('tanggal dibaca utuh dari barisnya, tidak disimpulkan dari periode', async () => {
  // Berbeda dari e-statement bulanan yang hanya mencetak DD/MM, cetakan ini
  // memuat tahunnya sendiri — jadi tidak ada tahun yang perlu ditebak.
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  assert.equal(transaksi[0].tanggal, '2026-09-01');
  assert.equal(transaksi[4].tanggal, '2026-09-03');
  assert.equal(transaksi.filter((t) => t.tanggal_ambigu).length, 0);
});

test('saldo berjalan ikut tersimpan', async () => {
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  assert.equal(transaksi[0].saldo, 8500000);
});

// --- Keterangan yang tersebar di atas dan di bawah --------------------------

test('KAIDAH: keterangan di ATAS baris berangka ikut tergabung', async () => {
  // Pada e-statement bulanan sambungan keterangan selalu di bawah. Di sini
  // jenis transaksinya justru dicetak di baris atas. Kalau hanya yang di bawah
  // yang digabung, seluruh transaksi kehilangan penanda jenisnya.
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  assert.match(transaksi[0].keterangan, /^BI-FAST DB/);
});

test('KAIDAH: keterangan di BAWAH baris berangka ikut tergabung', async () => {
  // Nama lawan transaksi kerap hanya ada di baris bawah — dan justru nama itu
  // yang menentukan hasil pencocokan saat audit.
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  assert.match(cari(transaksi, 'SUGENG RIYANTO').keterangan, /Dp SUGENG RIYANTO$/);
});

test('baris berangka tanpa keterangan tetap mendapat namanya dari baris bawah', async () => {
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  const masuk = transaksi.find((t) => t.kredit === 4000000);
  assert.equal(masuk.keterangan, 'BI-FAST CR TRANSFER DR 008 WAHYU. AS');
});

test('transaksi satu baris tidak menyerap keterangan tetangganya', () => {
  // Inilah kegagalan yang paling mahal: satu baris nama supplier yang tergeser
  // ke transaksi sebelahnya membuat dua transaksi sama-sama salah nama.
  const harian = () => baca('bca-mutasi-harian.pdf');
  return harian().then(({ transaksi }) => {
    const adm = transaksi.find((t) => t.debit === 30000);
    assert.equal(adm.keterangan, 'BIAYA ADM');
  });
});

test('keterangan tiga baris tergabung utuh dan berurutan', async () => {
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  const t = cari(transaksi, 'BRI MULTIFINANCE');
  assert.equal(
    t.keterangan,
    'TRSF E-BANKING CR 0309/ATSCY/WS95051 REF:26090300179832 ' +
    '143305250 BRIF Expedisi B1823DFB BRI MULTIFINANCE I'
  );
});

test('tidak ada baris keterangan yang hilang maupun terhitung dua kali', async () => {
  // Setiap potong teks di kolom keterangan harus muncul tepat sekali di
  // seluruh hasil. Pemotongan yang keliru bisa membuang satu baris diam-diam.
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  const gabungan = transaksi.map((t) => t.keterangan).join(' ');
  for (const potongan of ['BI-FAST DB', 'KBB', 'TRSF E-BANKING DB', 'Dp SUGENG RIYANTO',
    'TRANSFER DR 008 WAHYU. AS', 'BIAYA ADM', 'BRI MULTIFINANCE I']) {
    assert.ok(gabungan.includes(potongan), `hilang: ${potongan}`);
  }
  assert.equal(gabungan.match(/KBB/g).length, 2, 'KBB muncul pada dua transaksi, bukan lebih');
});

test('titik potong jatuh pada jarak tegak terbesar', () => {
  // y menurun ke bawah halaman. Deret ini meniru: baris berangka, satu
  // sambungannya (rapat), lalu transaksi berikutnya (renggang).
  assert.equal(titikPotong([700, 690.3, 678.3, 668.6]), 2);
  // Seluruh baris di antaranya milik transaksi bawah.
  assert.equal(titikPotong([700, 688, 678.3, 668.6]), 1);
});

// --- Transaksi yang belum dibukukan -----------------------------------------

test('KAIDAH: baris PEND disimpan dengan tanggal kosong, bukan tanggal karangan', async () => {
  // Tanggal karangan tidak menimbulkan galat apa pun dan baru ketahuan saat
  // angka auditnya dipakai.
  const { transaksi, pending } = await baca('bca-mutasi-harian.pdf');
  const pend = transaksi.filter((t) => t.tanggal === null);
  assert.equal(pending, 1);
  assert.equal(pend.length, 1);
  assert.equal(pend[0].debit, 700000);
});

test('baris PEND ditandai agar bisa dibedakan dari transaksi final', async () => {
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  const pend = transaksi.find((t) => t.tanggal === null);
  assert.ok(pend.masalah.includes(PENANDA_PENDING));
  assert.equal(pend.status_data, 'perlu_diperiksa');
});

test('nominal PEND tetap ikut dihitung, karena BCA pun menghitungnya', async () => {
  // Totalnya di kaki cetakan sudah memuat baris PEND. Membuangnya akan membuat
  // total aplikasi berbeda dari total banknya sendiri.
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  assert.equal(transaksi.reduce((s, t) => s + t.debit, 0), 2480000);
});

// --- Beberapa cetakan disatukan menjadi satu PDF ----------------------------

test('PDF gabungan terbaca seluruhnya, bukan hanya cetakan pertamanya', async () => {
  const { transaksi } = await baca('bca-mutasi-gabungan.pdf');
  assert.equal(transaksi.length, 8);
  assert.equal(transaksi.reduce((s, t) => s + t.debit, 0), 4480000);
  assert.equal(transaksi.reduce((s, t) => s + t.kredit, 0), 10372305);
});

test('KAIDAH: rentang PDF gabungan mencakup seluruh isinya', async () => {
  // Kop cetakan kedua memuat periodenya sendiri. Kalau hanya kop pertama yang
  // dibaca, riwayat unggahan menyebut rentang yang lebih sempit daripada isi
  // berkasnya — dan transaksi di luar rentang itu tampak tidak pernah diimpor.
  const hasil = await baca('bca-mutasi-gabungan.pdf');
  assert.deepEqual(hasil.rentang, { mulai: '2026-08-30', selesai: '2026-09-03' });
  // Kolom periode di riwayat menyimpan satu bulan; yang dipakai bulan awalnya.
  assert.deepEqual(hasil.periode, { bulan: 8, tahun: 2026 });
});

test('kop cetakan kedua tidak tergabung ke keterangan transaksi terakhir', async () => {
  const { transaksi } = await baca('bca-mutasi-gabungan.pdf');
  const akhirCetakanPertama = transaksi.find((t) => t.kredit === 5000000);
  assert.equal(akhirCetakanPertama.keterangan, 'SETORAN TUNAI');
});

test('transaksi yang melewati batas bulan tetap pada bulannya sendiri', async () => {
  const { transaksi } = await baca('bca-mutasi-gabungan.pdf');
  assert.equal(transaksi[0].tanggal, '2026-08-30');
  assert.equal(transaksi[2].tanggal, '2026-09-01');
});

test('dua rekening berbeda dalam satu PDF ditolak, bukan digabung diam-diam', async () => {
  const halaman = await bacaBarisPdf(berkas('bca-mutasi-gabungan.pdf'));
  // Kop halaman kedua diubah seolah rekening lain.
  const kop = halaman[1].find((b) => b.some((p) => /no\.?\s*rekening/i.test(p.teks)));
  const nomor = kop.find((p) => /^:?\s*[\d-]{6,}$/.test(p.teks));
  nomor.teks = ': 007-9999999';
  assert.throws(() => tabelDariMutasi(halaman), /nomor rekening berbeda/);
});

// --- Tombol navigasi halaman web --------------------------------------------

test('KAIDAH: tombol dan kaki halaman web tidak menjadi transaksi', async () => {
  // Cetakan ini berasal dari halaman web, sehingga "Format Download", "csv",
  // "Sebelumnya", "Cetak", dan baris hak cipta ikut tercetak ke PDF-nya.
  const { transaksi } = await baca('bca-mutasi-harian.pdf');
  const gabungan = transaksi.map((t) => t.keterangan).join(' ');
  for (const sampah of ['Format Download', 'csv', 'html', 'Sebelumnya',
    'Berikutnya', 'Cetak', 'Download', 'Kembali', 'Hak cipta', 'Saldo Awal',
    'Mutasi Debet', 'Mutasi Kredit', 'Saldo Akhir', 'ALYSSA AUTO LOGISTIK']) {
    assert.ok(!gabungan.includes(sampah), `ikut terbaca sebagai transaksi: ${sampah}`);
  }
});

// --- Nomor rujukan ----------------------------------------------------------

test('nomor rujukan ditarik dari keterangan', () => {
  assert.equal(referensiMutasi('TRSF E-BANKING DB 0109/FTSCY/WS95051 500000.00'), '0109/FTSCY/WS95051');
  assert.equal(referensiMutasi('REF:26090200179832 BRIF'), '26090200179832');
  assert.equal(referensiMutasi('BI-FAST DB TRANSFER KE 002 RUDI KBB'), null);
});

test('e-statement dan Mutasi menuliskan transaksi yang sama dengan kalimat berbeda', async () => {
  // Bukan dugaan: inilah yang membuat sidik jari di database tidak bisa
  // menahan transaksi ganda antarformat, dan sebab itu penyaringnya ada di
  // aplikasi. Berkas contoh ini meniru perbedaannya persis.
  const mutasi = await baca('lintas-mutasi.pdf');
  const est = await baca('lintas-estatement.pdf');

  assert.equal(mutasi.noRekening, est.noRekening, 'rekeningnya sama');
  assert.equal(
    mutasi.transaksi.reduce((s, t) => s + t.debit, 0),
    est.transaksi.reduce((s, t) => s + t.debit, 0),
    'uang yang sama'
  );

  const ketMutasi = mutasi.transaksi.find((t) => t.debit === 1000000).keterangan;
  const ketEst = est.transaksi.find((t) => t.debit === 1000000).keterangan;
  assert.notEqual(ketMutasi, ketEst, 'kalimatnya memang berbeda');
  assert.match(ketMutasi, /^BI-FAST DB /);
  assert.match(ketEst, /^BIF /);
});

test('SKENARIO: satu PDF memuat baris PEND sekaligus cetakan yang membukukannya', async () => {
  // Berkas gabungan seperti ini yang paling mudah membuat satu transfer
  // terhitung dua kali: baris PEND dan versi bertanggalnya masuk bersamaan
  // dalam satu unggahan, dan sidik jari tidak bisa menahannya karena yang satu
  // bertanggal dan yang satu tidak. Penyaringnya ada di jalur unggah; yang
  // dipastikan di sini keduanya memang terbaca sebagai dua baris dengan nilai
  // yang sama persis, sehingga bisa dikenali.
  const { transaksi } = await baca('bca-mutasi-gabungan-pend.pdf');
  assert.equal(transaksi.length, 8);

  const pend = transaksi.find((t) => t.tanggal === null);
  const dibukukan = transaksi.find((t) => t.tanggal === '2026-09-04');
  assert.equal(pend.keterangan, dibukukan.keterangan);
  assert.equal(pend.debit, dibukukan.debit);
  assert.equal(pend.saldo, dibukukan.saldo, 'saldo berjalan tidak berubah saat dibukukan');
});

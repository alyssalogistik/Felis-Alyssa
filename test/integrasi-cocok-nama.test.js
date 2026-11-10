import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cocokNamaPemetaan, cocokkanPemetaan, satukanPemetaan, cariPemetaan,
  PANJANG_KETIK_MINIMAL,
} from '../src/integrasi/cocok-nama.js';
import { kunciSaran, pilihSaran } from '../src/integrasi/tautan.js';

// Tujuh keterangan BAGUS HARDIANTO sungguhan dari satu rekening PT. Inilah
// bahan ukur seluruh berkas ini: bukan contoh karangan, melainkan kalimat yang
// benar-benar dicetak BCA untuk satu supplier yang sama.
const BAGUS = [
  'TRSF E-BANKING DB 2609/FTSCY/WS95051 550000.00 BAGUS HARDIANTO',
  'TRSF E-BANKING DB 2709/FTSCY/WS95051 550000.00 HIACE BAGUS HARDIANTO',
  'TRSF E-BANKING DB 2809/FTSCY/WS95051 1100000.00 BOX IKT BAGUS HARDIANTO',
  'TRSF E-BANKING DB 2909/FTSCY/WS95051 700000.00 TRINTON BAGUS HARDIANTO',
  'TRSF E-BANKING DB 3009/FTSCY/WS95051 800000.00 ER TIGA BAGUS HARDIANTO',
  'BI-FAST DB TRANSFER KE 002 BAGUS HARDIANTO KBB',
  'TRSF E-BANKING DB 0110/FTSCY/WS95051 550000.00 BAGUS HARDIANTO',
];

// --- Sebab aturannya diganti ----------------------------------------------

test('kunci_saran PECAH untuk satu supplier yang sama', () => {
  // Ini yang membuat ingatan berbasis kunci hampir tidak pernah berbunyi, dan
  // alasan seluruh berkas cocok-nama.js ada. Kalau suatu saat
  // namaDariKeterangan() diperbaiki sehingga pengujian ini gagal, pengisian
  // otomatis tetap benar — yang berubah hanya bahwa jalur kunci ikut
  // menolong. Jangan hapus pengujian ini tanpa membaca cocok-nama.js dulu.
  const kunci = new Set(BAGUS.map((k) => kunciSaran(k)));
  assert.ok(kunci.size > 1, `kunci seharusnya lebih dari satu, dapat ${kunci.size}`);
});

test('nama yang DIKETIK manusia cocok pada ketujuh keterangan itu', () => {
  for (const keterangan of BAGUS) {
    assert.equal(cocokNamaPemetaan(keterangan, 'BAGUS HARDIANTO'), true, keterangan);
  }
});

// --- Pagar -----------------------------------------------------------------

test('supplier yang tidak disebut tidak pernah cocok', () => {
  assert.equal(cocokNamaPemetaan(BAGUS[0], 'MARTHEN RUNTURAMBI'), false);
  assert.equal(cocokNamaPemetaan('TRSF E-BANKING DB 700000.00 ZULQIPLI AMIN', 'BAGUS HARDIANTO'), false);
});

test('nama berkata tunggal TIDAK PERNAH dipakai mencocokkan', () => {
  // "BUDI" akan ikut menelan BUDI SANTOSO dan BUDI HARTONO — dua orang yang
  // berbeda, dan uangnya tercatat atas nama yang bukan penerimanya.
  assert.equal(cocokNamaPemetaan('TRSF E-BANKING DB 500000.00 BUDI SANTOSO', 'BUDI'), false);
  assert.equal(cocokNamaPemetaan('TRSF E-BANKING DB 500000.00 BUDI', 'BUDI'), false);
});

test('nama lebih pendek dari batas tidak dipakai walau berkata dua', () => {
  assert.equal(cocokNamaPemetaan('TRSF DB 500000.00 A B LANJUT', 'A B'), false);
});

test('batasnya batas kata, bukan substring mentah', () => {
  assert.equal(
    cocokNamaPemetaan('TRSF E-BANKING DB 550000.00 BAGUS HARDIANTOS', 'BAGUS HARDIANTO'),
    false,
    'satu huruf di belakang berarti orang yang berbeda'
  );
  assert.equal(
    cocokNamaPemetaan('TRSF E-BANKING DB 550000.00 SUPERBAGUS HARDIANTO', 'BAGUS HARDIANTO'),
    false,
    'menempel di depan juga bukan nama yang sama'
  );
});

test('nama yang lebih panjang tetap cocok memuat nama yang lebih pendek', () => {
  // Arah kesalahan yang sama dengan pelipatan nama di nama.js: dua orang bisa
  // tergabung, dan itu terlihat; satu orang terpecah tidak terlihat.
  assert.equal(
    cocokNamaPemetaan('TRSF E-BANKING DB 500000.00 BUDI SANTOSO HARTONO', 'BUDI SANTOSO'),
    true
  );
});

test('huruf besar-kecil dan spasi ganda tidak membedakan', () => {
  assert.equal(cocokNamaPemetaan('trsf e-banking db bagus  hardianto', 'Bagus Hardianto'), true);
});

test('nama yang menempel pada tanda baca tetap terbaca', () => {
  // Keterangan BCA memuat garis miring pada nomor rujukan; nama yang jatuh
  // tepat di sebelahnya tidak boleh ikut hilang.
  assert.equal(cocokNamaPemetaan('TRSF DB 0104/FTSCY/BAGUS HARDIANTO/REF', 'BAGUS HARDIANTO'), true);
});

test('keterangan kosong tidak pernah cocok', () => {
  assert.equal(cocokNamaPemetaan('', 'BAGUS HARDIANTO'), false);
  assert.equal(cocokNamaPemetaan(null, 'BAGUS HARDIANTO'), false);
  assert.equal(cocokNamaPemetaan(BAGUS[0], null), false);
});

// --- Menyaring daftar pemetaan --------------------------------------------

const petaBagus = (tambahan = {}) => ({
  id: '1', supplier_id: '777ac479', supplier_nama: 'BAGUS HARDIANTO',
  entitas: 'PT_ALYSSA_AUTO_LOGISTIK', status: 'aktif', no_rekening_tujuan: null, ...tambahan,
});

test('hanya pemetaan aktif yang ikut dicocokkan', () => {
  const daftar = [petaBagus({ status: 'nonaktif' })];
  assert.equal(cocokkanPemetaan(BAGUS[1], daftar).length, 0);
  assert.equal(cocokkanPemetaan(BAGUS[1], [petaBagus()]).length, 1);
});

test('enam pemetaan satu supplier menyatu menjadi SATU saran, bukan konflik', () => {
  // Inilah keadaan sungguhan BAGUS HARDIANTO: satu supplier, banyak baris
  // pemetaan karena kuncinya pecah. Kalau ini terbaca sebagai konflik,
  // formulirnya tidak pernah terisi dan pekerjaannya kembali manual.
  const daftar = BAGUS.map((_, i) => petaBagus({ id: String(i), kunci_saran: `K${i}` }));
  const satu = satukanPemetaan(cocokkanPemetaan(BAGUS[3], daftar));
  assert.equal(satu.length, 1);

  const { saran, konflik } = pilihSaran(satu);
  assert.equal(konflik, false);
  assert.equal(saran.supplier_id, '777ac479');
});

test('dua supplier berbeda yang sama-sama disebut menjadi KONFLIK', () => {
  // Keadaan yang sah dan memang ambigu. Yang tidak sah adalah menebak salah
  // satunya; pilihSaran() menjawabnya dengan tidak memilih apa pun.
  const keterangan = 'TRSF E-BANKING DB 500000.00 BAGUS HARDIANTO QQ MARTHEN RUNTURAMBI';
  const daftar = [
    petaBagus(),
    petaBagus({ id: '2', supplier_id: 'a3f91b2c', supplier_nama: 'MARTHEN RUNTURAMBI' }),
  ];
  const { saran, konflik, kandidat } = pilihSaran(satukanPemetaan(cocokkanPemetaan(keterangan, daftar)));
  assert.equal(saran, null);
  assert.equal(konflik, true);
  assert.equal(kandidat.length, 2);
});

// --- Nomor rekening --------------------------------------------------------

test('nomor rekening diambil dari pemetaan terbaru yang PUNYA', () => {
  // Kolomnya opsional. Kalau hanya baris wakil yang dibaca, nomor rekening
  // yang pernah diketik hilang dari layar justru pada supplier yang paling
  // sering dibayar — yang pengikatan terakhirnya paling mungkin dilakukan
  // buru-buru tanpa mengisi kolom itu.
  const satu = satukanPemetaan([
    petaBagus({ id: 'baru', no_rekening_tujuan: null }),
    petaBagus({ id: 'lama', no_rekening_tujuan: '0072890271' }),
  ]);
  assert.equal(satu.length, 1);
  assert.equal(satu[0].id, 'baru', 'wakilnya tetap yang terbaru');
  assert.equal(satu[0].no_rekening_tujuan, '0072890271');
});

test('nomor rekening terbaru tidak ditimpa yang lama', () => {
  const satu = satukanPemetaan([
    petaBagus({ id: 'baru', no_rekening_tujuan: '1111111111' }),
    petaBagus({ id: 'lama', no_rekening_tujuan: '2222222222' }),
  ]);
  assert.equal(satu[0].no_rekening_tujuan, '1111111111');
});

test('supplier berbeda tidak pernah saling meminjam nomor rekening', () => {
  const satu = satukanPemetaan([
    petaBagus({ no_rekening_tujuan: null }),
    petaBagus({ id: '2', supplier_id: 'a3f91b2c', supplier_nama: 'MARTHEN RUNTURAMBI',
      no_rekening_tujuan: '2222222222' }),
  ]);
  assert.equal(satu.length, 2);
  assert.equal(satu.find((p) => p.supplier_id === '777ac479').no_rekening_tujuan, null);
});

test('baris tanpa supplier_id dibuang, tidak menjadi kandidat kosong', () => {
  assert.deepEqual(satukanPemetaan([{ supplier_nama: 'X Y', status: 'aktif' }, null]), []);
});

// --- Ketik beberapa huruf --------------------------------------------------

test('belum cukup huruf berarti belum ada daftar', () => {
  const daftar = [petaBagus()];
  assert.deepEqual(cariPemetaan(daftar, ''), []);
  assert.deepEqual(cariPemetaan(daftar, 'B'), []);
  assert.equal(PANJANG_KETIK_MINIMAL, 2);
});

test('dua huruf sudah memunculkan supplier yang pernah ditautkan', () => {
  const hasil = cariPemetaan([petaBagus()], 'ba');
  assert.equal(hasil.length, 1);
  assert.equal(hasil[0].supplier_id, '777ac479');
});

test('potongan di tengah nama ikut cocok saat mengetik', () => {
  // Jauh lebih longgar daripada pengisian otomatis, dan itu disengaja: di sini
  // manusia melihat daftarnya dan memilih sendiri.
  assert.equal(cariPemetaan([petaBagus()], 'hardi').length, 1);
});

test('supplier_id boleh diketik langsung', () => {
  assert.equal(cariPemetaan([petaBagus()], '777ac').length, 1);
  assert.equal(cariPemetaan([petaBagus()], '777AC').length, 1, 'huruf besar tetap cocok');
});

test('pemetaan nonaktif tidak pernah muncul saat mengetik', () => {
  assert.deepEqual(cariPemetaan([petaBagus({ status: 'nonaktif' })], 'bagus'), []);
});

test('satu supplier hanya muncul sekali walau punya banyak pemetaan', () => {
  const daftar = BAGUS.map((_, i) => petaBagus({ id: String(i) }));
  assert.equal(cariPemetaan(daftar, 'bagus').length, 1);
});

test('daftarnya dibatasi supaya tidak menutupi formulirnya sendiri', () => {
  const daftar = Array.from({ length: 30 }, (_, i) =>
    petaBagus({ id: String(i), supplier_id: String(i).padStart(8, '0'), supplier_nama: `BAGUS NOMOR ${i}` }));
  assert.equal(cariPemetaan(daftar, 'bagus').length, 8);
});

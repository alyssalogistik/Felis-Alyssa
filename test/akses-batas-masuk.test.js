import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AKUN, IP, kunciAkun, kunciIp, periksa, sesudahGagal, lamaKunci, pesanTerkunci,
} from '../src/akses/batas-masuk.js';

const T0 = new Date('2026-01-01T10:00:00Z');
const geser = (dasar, detik) => new Date(new Date(dasar).getTime() + detik * 1000);

/** Menggagalkan n kali berturut-turut, masing-masing berselang satu detik. */
function gagalBerkali(n, aturan = AKUN, mulai = T0) {
  let keadaan = null;
  let waktu = mulai;
  for (let i = 0; i < n; i += 1) {
    keadaan = sesudahGagal(keadaan, waktu, aturan);
    waktu = geser(waktu, 1);
  }
  return { keadaan, waktu };
}

test('ember kosong tidak pernah terkunci', () => {
  assert.deepEqual(periksa(null, T0), { terkunci: false, sisaDetik: 0 });
  assert.deepEqual(periksa({ terkunci_sampai: null }, T0), { terkunci: false, sisaDetik: 0 });
});

test('empat percobaan gagal belum mengunci', () => {
  const { keadaan } = gagalBerkali(4);
  assert.equal(keadaan.gagal, 4);
  assert.equal(periksa(keadaan, T0).terkunci, false);
});

test('percobaan kelima mengunci selama 15 menit', () => {
  const { keadaan, waktu } = gagalBerkali(5);
  const hasil = periksa(keadaan, waktu);
  assert.equal(hasil.terkunci, true);
  assert.ok(hasil.sisaDetik > 14 * 60 && hasil.sisaDetik <= 15 * 60, `sisa ${hasil.sisaDetik}`);
});

test('kuncian PASTI berakhir sendiri', () => {
  const { keadaan, waktu } = gagalBerkali(5);
  assert.equal(periksa(keadaan, geser(waktu, 15 * 60 + 1)).terkunci, false);
});

test('kuncian berikutnya lebih lama, tetapi berhenti di 30 menit', () => {
  // Tanpa batas atas, penebak yang gigih bisa mengunci akun Owner berhari-hari
  // tanpa pernah menebak passwordnya — serangannya berubah jadi menutup akses.
  assert.equal(lamaKunci(1), 15 * 60);
  assert.equal(lamaKunci(2), 30 * 60);
  assert.equal(lamaKunci(3), 30 * 60);
  assert.equal(lamaKunci(50), 30 * 60);
});

test('tidak ada nilai kunci_ke yang menghasilkan kuncian permanen', () => {
  for (const ke of [1, 2, 5, 10, 100, 1000]) {
    assert.ok(lamaKunci(ke) <= AKUN.maksKunciDetik, `kunci_ke ${ke}`);
  }
});

test('sesudah kuncian berakhir, jatahnya penuh lagi', () => {
  // Kalau hitungan gagalnya tidak ikut dinolkan, satu salah ketik sesudah
  // kuncian berakhir akan langsung mengunci lagi.
  const { keadaan, waktu } = gagalBerkali(5);
  assert.equal(keadaan.gagal, 0);

  const sesudah = geser(waktu, 16 * 60);
  let lanjut = keadaan;
  for (let i = 0; i < 4; i += 1) lanjut = sesudahGagal(lanjut, geser(sesudah, i), AKUN);
  assert.equal(periksa(lanjut, sesudah).terkunci, false, 'empat percobaan lagi harus masih boleh');
});

test('kegagalan yang tersebar di luar jendela tidak menumpuk', () => {
  // Lima salah ketik sepanjang hari bukan serangan.
  let keadaan = null;
  let waktu = T0;
  for (let i = 0; i < 5; i += 1) {
    keadaan = sesudahGagal(keadaan, waktu, AKUN);
    waktu = geser(waktu, 20 * 60); // lebih renggang daripada jendela 15 menit
  }
  assert.equal(keadaan.gagal, 1);
  assert.equal(keadaan.terkunci_sampai, null);
});

test('ember IP jauh lebih longgar daripada ember akun', () => {
  // Satu kantor keluar lewat satu IP; batas ketat di sana membuat satu orang
  // yang lupa password mengunci seluruh rekannya.
  assert.ok(IP.batas > AKUN.batas * 3);
  const { keadaan } = gagalBerkali(19, IP);
  assert.equal(periksa(keadaan, T0).terkunci, false);
  const penuh = sesudahGagal(keadaan, T0, IP);
  assert.equal(periksa(penuh, T0).terkunci, true);
});

test('kuncian IP tidak pernah bereskalasi', () => {
  assert.equal(lamaKunci(1, IP), 15 * 60);
  assert.equal(lamaKunci(9, IP), 15 * 60);
});

test('kunci ember akun dihitung dari email yang dikirim, bukan yang terdaftar', () => {
  // Kalau ember hanya dibuat untuk email terdaftar, penebak bisa membedakan
  // email terdaftar dari yang tidak hanya dengan melihat mana yang terkunci.
  assert.equal(kunciAkun(' Budi@Alyssa.ID '), 'akun:budi@alyssa.id');
  assert.equal(kunciAkun('tidak-terdaftar@mana.pun'), 'akun:tidak-terdaftar@mana.pun');
  assert.equal(kunciAkun(''), 'akun:');
  assert.equal(kunciAkun(null), 'akun:');
});

test('kunci ember IP menangani alamat yang tidak terbaca', () => {
  assert.equal(kunciIp('1.2.3.4'), 'ip:1.2.3.4');
  assert.equal(kunciIp(null), 'ip:tidak-diketahui');
});

test('pesan penolakan tidak menyebut apakah emailnya terdaftar', () => {
  const pesan = pesanTerkunci(600);
  assert.match(pesan, /10 menit/);
  assert.doesNotMatch(pesan, /terdaftar|tidak ditemukan|akun tidak ada/i);
});

test('sisa waktu dibulatkan ke atas supaya tidak pernah menjanjikan lebih cepat', () => {
  assert.match(pesanTerkunci(1), /1 menit/);
  assert.match(pesanTerkunci(61), /2 menit/);
});

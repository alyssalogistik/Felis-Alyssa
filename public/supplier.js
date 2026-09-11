// Daftar supplier yang muncul di rekening koran.
//
// Gunanya menghapus langkah "ingat lalu ketik nama". Nama-namanya diturunkan
// dari keterangan bank oleh server (src/rekonsiliasi/nama.js), jadi tidak ada
// daftar supplier yang harus diisi lebih dulu.
//
// Daftar ini jalan pintas, bukan sumber kebenaran. Mengklik satu nama hanya
// mengisi kotak pencarian lalu menjalankan pencarian yang sama persis dengan
// yang bisa diketik sendiri — tidak ada jalur data kedua yang bisa menyimpang
// dari tabel di bawahnya.

import { aman, ambil, el, kosong, rupiah } from './bantuan.js';

const NAMA_BULAN = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
];

let semua = [];

/** "Feb 2026". Tanggal disimpan YYYY-MM-DD, jadi tidak perlu Date sama sekali. */
function periodePendek(tanggal) {
  if (!tanggal) return '-';
  const [tahun, bulan] = tanggal.split('-');
  return `${NAMA_BULAN[Number(bulan) - 1] ?? bulan} ${tahun}`;
}

function rentang(s) {
  const awal = periodePendek(s.pertama);
  const akhir = periodePendek(s.terakhir);
  return awal === akhir ? awal : `${awal} – ${akhir}`;
}

function pesan(kelas, teks) {
  const kotak = el('pesan-supplier');
  if (!kotak) return;
  kotak.className = `pesan ${kelas}`;
  kotak.textContent = teks;
  kotak.hidden = teks === '';
}

function barisSupplier(s) {
  // Varian ditampilkan hanya bila memang ada lebih dari satu bentuk penulisan,
  // supaya pemakainya bisa melihat sendiri apa saja yang digabung — penggabungan
  // yang keliru harus kelihatan, bukan tersembunyi di balik satu angka.
  const varian = s.varian.length > 1
    ? `<small class="varian-nama">Termasuk: ${s.varian.map(aman).join(' · ')}</small>`
    : '';

  return `
    <button type="button" class="baris-supplier" data-nama="${aman(s.nama)}">
      <span class="nama-supplier">${aman(s.nama)}</span>
      <span class="angka-supplier">${aman(rupiah.format(s.total_debit))}</span>
      <small class="info-supplier">${s.jumlah_transaksi} transfer &middot; ${aman(rentang(s))}</small>
      ${varian}
    </button>`;
}

function gambar(daftar) {
  const kotak = el('daftar-supplier');
  if (!kotak) return;

  if (daftar.length === 0) {
    kotak.innerHTML = kosong('Tidak ada nama yang cocok dengan saringan itu.');
    return;
  }

  kotak.innerHTML = daftar.map(barisSupplier).join('');
}

function saring() {
  const kata = (el('saring-supplier')?.value ?? '').trim().toLowerCase();
  if (kata === '') return gambar(semua);
  gambar(semua.filter((s) =>
    s.nama.toLowerCase().includes(kata) ||
    s.varian.some((v) => v.toLowerCase().includes(kata))
  ));
}

export async function muatSupplier() {
  const kotak = el('daftar-supplier');
  if (!kotak) return;

  kotak.innerHTML = kosong('Membaca rekening koran…');
  pesan('', '');

  try {
    const { data, lengkap, dipindai } = await ambil('/rekonsiliasi/supplier');
    semua = data ?? [];

    if (semua.length === 0) {
      kotak.innerHTML = kosong(
        'Belum ada nama yang bisa dibaca. Unggah rekening koran BCA lebih dulu.'
      );
      return;
    }

    // Rekap yang dihitung dari sebagian transaksi menampilkan total yang terlalu
    // kecil, dan terlalu kecil di halaman ini terbaca sebagai kurang bayar.
    // Kalau pemindaiannya belum menyeluruh, itu harus dikatakan.
    if (lengkap === false) {
      pesan('peringatan',
        `Rekap ini baru mencakup ${dipindai} transaksi terbaru, belum seluruhnya. ` +
        'Angka per supplier bisa lebih kecil dari yang sebenarnya.');
    }

    saring();
  } catch (error) {
    kotak.innerHTML = kosong(error.message);
  }
}

/**
 * @param {(nama: string) => void} saatDipilih
 *   Dipanggil dengan nama supplier yang diklik. Pemanggilnya yang menjalankan
 *   pencarian, supaya modul ini tidak punya jalur data sendiri.
 */
export function pasangKendaliSupplier(saatDipilih) {
  const saringan = el('saring-supplier');
  if (saringan) saringan.addEventListener('input', saring);

  const kotak = el('daftar-supplier');
  if (!kotak) return;

  kotak.addEventListener('click', (peristiwa) => {
    const tombol = peristiwa.target.closest('.baris-supplier');
    if (!tombol) return;
    saatDipilih(tombol.dataset.nama ?? '');
  });
}

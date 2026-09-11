// Pencarian pembayaran supplier langsung di rekening koran.
//
// Pertanyaan yang dijawab halaman ini cuma satu: "supplier ini sudah saya
// transfer belum?" Jawabannya ada di mutasi bank, dan tidak menuntut daftar
// tagihan lebih dulu — karena itu pencarian berdiri sendiri dan pencocokan
// otomatis dengan tagihan menjadi pelengkap, bukan syarat.
//
// Datanya dibaca dari endpoint transaksi milik Rekonsiliasi Bank. Tidak ada
// penyimpanan tersendiri: rekening koran yang sudah diunggah kapan pun, lewat
// menu mana pun, langsung bisa dicari di sini.

import { aman, ambil, el, kosong, formatTanggalPolos, formatNominal, rupiah, tanggal } from './bantuan.js';

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

/** Baris per permintaan. 200 adalah batas atas yang diterima endpoint. */
const BATAS = 200;

/**
 * Pagar jumlah baris yang ditarik dalam satu pencarian.
 *
 * Hasil pencarian supplier harus tampil seluruhnya, bukan sepotong: auditor
 * yang melihat sebagian daftar akan menyimpulkan supplier kurang dibayar
 * padahal sisanya hanya belum dimuat. Karena itu halaman berikutnya diambil
 * otomatis sampai habis. Pagarnya tetap ada supaya pencarian tanpa kata kunci
 * di atas rekening koran bertahun-tahun tidak menarik puluhan ribu baris
 * sekaligus; sisanya diambil lewat tombol.
 */
const BATAS_MUATAN = 2000;

let mulai = 0;
let total = 0;

/** Isian formulir apa adanya — belum tentu sudah diterapkan. */
function kriteriaFormulir() {
  const parameter = new URLSearchParams();
  for (const [nama, nilai] of new FormData(el('cari-bayaran'))) {
    // Spasi dirapikan di sini sekali, sehingga seluruh jalur di bawahnya
    // menerima kata kunci yang sudah bersih.
    //
    // Bukan hanya ujungnya: spasi ganda di tengah pun dirapatkan. Pencarian
    // di database memakai pola harfiah, jadi "SUGENG  RIYANTO" berspasi dua
    // tidak akan pernah cocok dengan "SUGENG RIYANTO" di rekening koran —
    // dan hasil nihil di halaman ini terbaca sebagai "belum dibayar".
    const bersih = String(nilai).trim().replace(/\s+/g, ' ');
    if (bersih !== '') parameter.set(nama, bersih);
  }
  return parameter;
}

/**
 * Filter yang benar-benar sedang tampil di layar.
 *
 * Sejak pencarian hanya berjalan saat tombol ditekan, isian formulir bisa
 * berbeda dari hasil yang sedang tampak. Laporan PDF, cetak, dan ekspor
 * mengacu ke potret ini, bukan ke isian — kalau tidak, berkas yang diunduh
 * akan memuat filter yang belum pernah dijalankan dan berbeda dari tabel yang
 * dilihat pemakainya.
 */
let kriteriaBerlaku = new URLSearchParams();

function kriteria() {
  return kriteriaBerlaku;
}

/**
 * Rentang tanggal terbalik tidak akan menghasilkan galat dari database, hanya
 * hasil kosong — dan kosong di halaman ini terbaca sebagai "belum dibayar".
 * Karena itu diperiksa sebelum permintaan dikirim.
 */
export function periksaRentang(dari, sampai) {
  if (dari && sampai && dari > sampai) {
    return 'Dari Tanggal lebih besar dari Sampai Tanggal. Tukar keduanya lalu cari lagi.';
  }
  return null;
}

function pesanCari(kelas, teks) {
  const kotak = el('pesan-cari');
  if (!kotak) return;
  kotak.className = `pesan ${kelas}`;
  kotak.textContent = teks;
  kotak.hidden = teks === '';
}

function baris(t) {
  // Nominal transaksi: salah satu dari debit atau kredit selalu nol, jadi
  // jumlahnya adalah nilai transaksi itu sendiri terlepas dari arahnya.
  const nominal = Number(t.debit ?? 0) + Number(t.kredit ?? 0);
  const keluar = Number(t.debit ?? 0) > 0;

  return `
    <tr>
      <td>${aman(formatTanggalPolos(t.tanggal))}${t.tanggal_ambigu ? ' <span class="tanda" title="Tanggal ambigu">?</span>' : ''}</td>
      <td class="keterangan-sel">${aman(t.keterangan)}</td>
      <td class="angka-kolom${keluar ? ' keluar' : ''}">${formatNominal(t.debit)}</td>
      <td class="angka-kolom">${formatNominal(t.kredit)}</td>
      <td class="angka-kolom">${aman(rupiah.format(nominal))}</td>
      <td>${t.referensi ? aman(t.referensi) : '<span class="nol">-</span>'}</td>
    </tr>`;
}

function tampilRingkasan(jumlah, ringkasan, adaKataKunci, hanyaDebit) {
  const kotak = el('ringkasan-bayaran');

  if (jumlah === 0) {
    // Tidak ketemu bukan berarti belum dibayar. Nama di rekening koran sering
    // berbeda dari nama supplier, jadi menyimpulkan "belum dibayar" di sini
    // akan membuat orang membayar dua kali.
    kotak.innerHTML = `
      <p class="kosong">Tidak ditemukan transaksi pembayaran untuk kata kunci ini pada periode yang dipilih.</p>
      <p class="keterangan-panel">
        Ini belum tentu berarti supplier belum dibayar. Nama di keterangan bank
        sering berbeda dari nama resmi supplier &mdash; coba sebagian namanya saja,
        nama pemilik rekening, atau longgarkan filter tanggalnya.
      </p>`;
    return;
  }

  const keluar = Number(ringkasan?.debit ?? 0);
  const masuk = Number(ringkasan?.kredit ?? 0);

  // Memakai gaya ringkasan yang sama dengan halaman Rekonsiliasi Bank, bukan
  // gaya baru, supaya kedua halaman terbaca sebagai satu aplikasi.
  kotak.innerHTML = `
    <h3>Hasil Pencarian</h3>
    <div class="ringkas">
      <div><b>${jumlah}</b><small>Transaksi cocok</small></div>
      <div class="r-debit"><b>${aman(rupiah.format(keluar))}</b><small>Total uang keluar</small></div>
      ${hanyaDebit ? '' : `<div class="r-kredit"><b>${aman(rupiah.format(masuk))}</b><small>Total uang masuk</small></div>`}
    </div>
    ${adaKataKunci ? '' : '<p class="keterangan-panel">Menampilkan seluruh transaksi. Ketik nama supplier di atas untuk mempersempit.</p>'}`;
}

export async function cariBayaran(lanjut = false) {
  const kotak = el('isi-tabel-bayaran');
  if (!kotak) return;

  if (!lanjut) {
    mulai = 0;
    // Potret diambil sekali di sini. Halaman berikutnya memakai potret yang
    // sama, sehingga sambungan hasil tidak pernah bercampur dua filter.
    kriteriaBerlaku = kriteriaFormulir();

    // Pesan "hasil dikosongkan" milik pencarian sebelumnya tidak boleh
    // menempel di atas hasil yang baru.
    kotak.innerHTML = `<tr><td colspan="6">${kosong('Mencari…')}</td></tr>`;
    pesanCetak('', '');
  }

  const adaKataKunci = (kriteriaBerlaku.get('cari') ?? '') !== '';
  const hanyaDebit = kriteriaBerlaku.get('hanya_debit') === '1';

  const berhenti = mulai + BATAS_MUATAN;
  let pertama = !lanjut;
  let ringkasan = null;

  try {
    // Ditarik berulang sampai seluruh hasil yang cocok masuk ke tabel. Jumlah
    // dan totalnya sendiri datang dari database sejak permintaan pertama, jadi
    // angkanya sudah benar bahkan sebelum baris terakhir selesai dimuat.
    for (;;) {
      const parameter = new URLSearchParams(kriteriaBerlaku);
      parameter.set('batas', String(BATAS));
      parameter.set('mulai', String(mulai));

      const hasil = await ambil(`/rekonsiliasi/transaksi?${parameter}`);
      total = hasil.total ?? 0;
      ringkasan = hasil.ringkasan;

      const isi = hasil.data.map(baris).join('');
      if (pertama) {
        kotak.innerHTML = isi || `<tr><td colspan="6">${kosong('Tidak ada hasil.')}</td></tr>`;
        pertama = false;
      } else if (isi !== '') {
        kotak.insertAdjacentHTML('beforeend', isi);
      }

      mulai += hasil.data.length;

      // Halaman kosong menghentikan pengulangan walau hitungan mengatakan masih
      // ada sisa; tanpa penjaga ini satu hitungan yang meleset akan berputar
      // selamanya.
      if (hasil.data.length === 0 || mulai >= total || mulai >= berhenti) break;
    }

    tampilRingkasan(total, ringkasan, adaKataKunci, hanyaDebit);
    gambarKopCetak(total, ringkasan);
    el('muat-bayaran').hidden = mulai >= total;
  } catch (error) {
    kotak.innerHTML = `<tr><td colspan="6">${kosong(error.message)}</td></tr>`;
    el('ringkasan-bayaran').innerHTML = '';
    el('muat-bayaran').hidden = true;
  }
}

/**
 * Kop dokumen untuk pencetakan langsung dari peramban (Ctrl+P pada halaman).
 *
 * Tombol Cetak tidak memakai jalur ini — ia mencetak PDF resmi dari server yang
 * memuat seluruh transaksi. Kop ini jaring pengaman: tanpa ia, seseorang yang
 * menekan Ctrl+P akan mencetak tema gelap aplikasi beserta menunya.
 */
function gambarKopCetak(jumlah, ringkasan) {
  const kotak = el('kop-cetak');
  if (!kotak) return;

  // Mengikuti filter yang berlaku, bukan isian formulir: kop pada kertas harus
  // menerangkan tabel yang tercetak di bawahnya.
  const nilai = (nama) => kriteriaBerlaku.get(nama) ?? '';
  const namaBulan = nilai('bulan') ? NAMA_BULAN[Number(nilai('bulan')) - 1] : 'Semua';

  const pasangan = [
    ['Kata Kunci', nilai('cari') || 'Semua transaksi'],
    ['Bulan', namaBulan],
    ['Tahun', nilai('tahun') || 'Semua'],
    ['Dari Tanggal', nilai('dari') || '-'],
    ['Sampai Tanggal', nilai('sampai') || '-'],
    ['Tanggal Cetak', tanggal.format(new Date())],
    ['Jumlah Transaksi', `${jumlah} transaksi`],
    ['Total Uang Keluar', rupiah.format(Number(ringkasan?.debit ?? 0))],
    ['Total Uang Masuk', rupiah.format(Number(ringkasan?.kredit ?? 0))],
  ];

  kotak.innerHTML = `
    <h1>PT ALYSSA AUTO LOGISTIK</h1>
    <h2>AUDIT PEMBAYARAN SUPPLIER / MUTASI REKENING</h2>
    <dl>${pasangan.map(([k, v]) => `<div><dt>${aman(k)}</dt><dd>${aman(v)}</dd></div>`).join('')}</dl>`;
}

/** Alamat laporan PDF di server, mengikuti filter yang sedang aktif. */
function alamatLaporan() {
  return `/api/rekonsiliasi/cetak?${kriteria()}`;
}

function pesanCetak(kelas, teks) {
  const kotak = el('pesan-cetak');
  if (!kotak) return;
  kotak.className = `pesan ${kelas}`;
  kotak.textContent = teks;
  kotak.hidden = teks === '';
}

/**
 * Membuka dialog cetak untuk laporan PDF.
 *
 * Yang dicetak adalah PDF dari server, bukan tabel di layar. Layar hanya memuat
 * satu halaman hasil, sedangkan laporan harus memuat seluruh transaksi yang
 * cocok — dan hanya PDF itu yang bisa memastikan kepala tabel terulang di tiap
 * halaman, baris tidak terbelah, serta nomor "Halaman X / Y" benar. Peramban
 * tidak bisa menghitung nomor halaman lewat CSS.
 */
async function cetakLaporan() {
  const tombol = el('cetak-bayaran');
  tombol.disabled = true;
  pesanCetak('', 'Menyiapkan laporan…');

  let alamatObjek = null;
  try {
    const respons = await fetch(alamatLaporan());
    if (!respons.ok) throw new Error(`Gagal menyiapkan laporan (HTTP ${respons.status}).`);

    alamatObjek = URL.createObjectURL(await respons.blob());

    const bingkai = document.createElement('iframe');
    bingkai.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    bingkai.src = alamatObjek;

    const siap = new Promise((tuntas, tolak) => {
      bingkai.onload = tuntas;
      bingkai.onerror = () => tolak(new Error('Laporan tidak bisa dibuka di peramban ini.'));
    });

    document.body.append(bingkai);
    await siap;

    // Sebagian peramban seluler menolak mencetak dari bingkai tersembunyi;
    // kalau itu terjadi, laporannya dibuka di tab baru supaya tetap bisa
    // dicetak dari penampil PDF bawaan.
    try {
      bingkai.contentWindow.focus();
      bingkai.contentWindow.print();
      pesanCetak('', '');
    } catch {
      window.open(alamatObjek, '_blank');
      pesanCetak('', 'Laporan dibuka di tab baru — cetak dari sana.');
      alamatObjek = null;
    }

    // Bingkai dan alamat sementara dilepas setelah dialog cetak sempat terbuka.
    setTimeout(() => {
      bingkai.remove();
      if (alamatObjek) URL.revokeObjectURL(alamatObjek);
    }, 60000);
  } catch (error) {
    if (alamatObjek) URL.revokeObjectURL(alamatObjek);
    pesanCetak('gagal', error.message);
  } finally {
    tombol.disabled = false;
  }
}

/**
 * Nama berkas dari header Content-Disposition.
 *
 * Server tetap satu-satunya penentu nama berkas; unduhan lewat blob hanya
 * meneruskannya. Kalau headernya tidak terbaca, dipakai nama cadangan yang
 * masih jelas maksudnya alih-alih membiarkan peramban memberi nama acak.
 */
function namaDariHeader(header) {
  const cocok = /filename="?([^";]+)"?/i.exec(header ?? '');
  return cocok ? cocok[1] : 'Audit-Pembayaran-Supplier.pdf';
}

/**
 * Mengosongkan hasil yang sedang tampil.
 *
 * Hanya tampilan. Transaksi bank di database tidak disentuh sama sekali, dan
 * pengosongan ini bisa dibatalkan hanya dengan mencari lagi — karena itu
 * pesannya menyebutkan hal tersebut. Tanpa penjelasan itu, layar yang tiba-tiba
 * kosong sesudah menyimpan akan terbaca seperti datanya ikut terhapus.
 */
function kosongkanHasil() {
  mulai = 0;
  total = 0;

  el('isi-tabel-bayaran').innerHTML =
    `<tr><td colspan="6">${kosong('Hasil dikosongkan setelah PDF disimpan. Tekan Cari / Terapkan Filter untuk menampilkannya lagi.')}</td></tr>`;
  el('ringkasan-bayaran').innerHTML = '';
  el('muat-bayaran').hidden = true;

  const kop = el('kop-cetak');
  if (kop) kop.innerHTML = '';
}

/**
 * Mengunduh laporan PDF, lalu mengosongkan hasil di layar.
 *
 * Unduhannya lewat fetch, bukan navigasi biasa, justru karena syaratnya: hasil
 * hanya boleh dikosongkan bila penyimpanan berhasil. Navigasi biasa tidak
 * memberi tahu halaman apakah berkasnya jadi atau gagal, sehingga layar akan
 * ikut kosong walaupun laporannya tidak pernah terbentuk.
 */
async function simpanPdf() {
  const tombol = el('simpan-pdf');
  tombol.disabled = true;
  pesanCetak('', 'Menyiapkan PDF…');

  let alamatObjek = null;
  try {
    const respons = await fetch(alamatLaporan());
    if (!respons.ok) throw new Error(`Gagal menyimpan PDF (HTTP ${respons.status}).`);

    const berkas = await respons.blob();
    alamatObjek = URL.createObjectURL(berkas);

    const tautan = document.createElement('a');
    tautan.href = alamatObjek;
    tautan.download = namaDariHeader(respons.headers.get('Content-Disposition'));
    document.body.append(tautan);
    tautan.click();
    tautan.remove();

    kosongkanHasil();
    pesanCetak('berhasil', 'PDF berhasil disimpan. Hasil transaksi telah dikosongkan.');
  } catch (error) {
    // Gagal menyimpan berarti hasil di layar dibiarkan apa adanya.
    pesanCetak('gagal', error.message);
  } finally {
    if (alamatObjek) setTimeout(() => URL.revokeObjectURL(alamatObjek), 60000);
    tombol.disabled = false;
  }
}

/**
 * Menjalankan pencarian untuk satu supplier yang dipilih dari daftar.
 *
 * Filter lain sengaja dikosongkan lebih dulu. Kalau bulan atau rentang tanggal
 * dari pencarian sebelumnya masih menempel, hasilnya hanya sebagian transfer
 * supplier itu — dan sebagian di halaman ini terbaca sebagai kurang bayar,
 * lalu dibayar untuk kedua kalinya.
 *
 * Sesudahnya alurnya sama persis dengan mengetik nama lalu menekan tombol:
 * tidak ada jalur pengambilan data tersendiri untuk daftar supplier.
 */
export function cariSupplier(nama) {
  const formulir = el('cari-bayaran');
  if (!formulir) return;

  formulir.reset();
  formulir.elements.cari.value = nama;
  pesanCari('', '');
  cariBayaran();

  formulir.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function pasangKendaliBayaran() {
  const formulir = el('cari-bayaran');
  if (!formulir) return;

  formulir.bulan.append(...NAMA_BULAN.map((nama, i) => new Option(nama, String(i + 1))));
  const tahunIni = new Date().getFullYear();
  formulir.tahun.append(
    ...Array.from({ length: 7 }, (_, i) => String(tahunIni + 1 - i)).map((t) => new Option(t, t))
  );

  // Pencarian tidak berjalan sendiri saat isian berubah. Menyusun beberapa
  // filter sekaligus — nama, bulan, tahun, lalu rentang tanggal — akan memicu
  // beberapa permintaan setengah jadi, dan hasil antaranya sempat terlihat
  // seolah itu jawabannya. Satu tombol, satu pencarian.
  const terapkan = () => {
    const isian = kriteriaFormulir();
    const keliru = periksaRentang(isian.get('dari'), isian.get('sampai'));
    if (keliru) {
      pesanCari('gagal', keliru);
      return;
    }
    pesanCari('', '');
    cariBayaran();
  };

  // Menekan Enter di dalam formulir sama artinya dengan menekan tombolnya.
  formulir.addEventListener('submit', (peristiwa) => {
    peristiwa.preventDefault();
    terapkan();
  });

  el('terapkan-bayaran').addEventListener('click', (peristiwa) => {
    peristiwa.preventDefault();
    terapkan();
  });

  el('reset-bayaran').addEventListener('click', () => {
    formulir.reset();
    pesanCari('', '');
    cariBayaran();
  });

  el('ekspor-bayaran').addEventListener('click', () => {
    window.location.assign(`/api/rekonsiliasi/ekspor?${kriteria()}`);
  });

  el('muat-bayaran').addEventListener('click', () => cariBayaran(true));

  el('simpan-pdf').addEventListener('click', simpanPdf);
  el('cetak-bayaran').addEventListener('click', cetakLaporan);
}

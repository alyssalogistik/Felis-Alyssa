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

const BATAS = 50;
let mulai = 0;
let total = 0;

/** Filter yang sedang aktif, apa adanya dari formulir. */
function kriteria() {
  const parameter = new URLSearchParams();
  for (const [nama, nilai] of new FormData(el('cari-bayaran'))) {
    if (String(nilai).trim() !== '') parameter.set(nama, String(nilai).trim());
  }
  return parameter;
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

  if (!lanjut) mulai = 0;

  const parameter = kriteria();
  const adaKataKunci = (parameter.get('cari') ?? '') !== '';
  const hanyaDebit = parameter.get('hanya_debit') === '1';

  parameter.set('batas', String(BATAS));
  parameter.set('mulai', String(mulai));

  if (!lanjut) kotak.innerHTML = `<tr><td colspan="6">${kosong('Mencari…')}</td></tr>`;

  try {
    const hasil = await ambil(`/rekonsiliasi/transaksi?${parameter}`);
    total = hasil.total ?? 0;

    const isi = hasil.data.map(baris).join('');
    if (lanjut) kotak.insertAdjacentHTML('beforeend', isi);
    else kotak.innerHTML = isi || `<tr><td colspan="6">${kosong('Tidak ada hasil.')}</td></tr>`;

    tampilRingkasan(total, hasil.ringkasan, adaKataKunci, hanyaDebit);
    gambarKopCetak(total, hasil.ringkasan);

    mulai += hasil.data.length;
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

  const formulir = el('cari-bayaran');
  const nilai = (nama) => (formulir.elements[nama]?.value ?? '').trim();
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

export function pasangKendaliBayaran() {
  const formulir = el('cari-bayaran');
  if (!formulir) return;

  formulir.bulan.append(...NAMA_BULAN.map((nama, i) => new Option(nama, String(i + 1))));
  const tahunIni = new Date().getFullYear();
  formulir.tahun.append(
    ...Array.from({ length: 7 }, (_, i) => String(tahunIni + 1 - i)).map((t) => new Option(t, t))
  );

  let tunda;
  formulir.addEventListener('input', (peristiwa) => {
    clearTimeout(tunda);
    // Ketikan diberi jeda; pilihan tanggal dan centang langsung dijalankan.
    tunda = setTimeout(() => cariBayaran(), peristiwa.target.type === 'search' ? 350 : 0);
  });
  formulir.addEventListener('submit', (peristiwa) => peristiwa.preventDefault());

  el('reset-bayaran').addEventListener('click', () => {
    formulir.reset();
    cariBayaran();
  });

  el('ekspor-bayaran').addEventListener('click', () => {
    window.location.assign(`/api/rekonsiliasi/ekspor?${kriteria()}`);
  });

  el('muat-bayaran').addEventListener('click', () => cariBayaran(true));

  // Unduhan langsung: nama berkasnya ditentukan server lewat Content-Disposition.
  el('simpan-pdf').addEventListener('click', () => window.location.assign(alamatLaporan()));
  el('cetak-bayaran').addEventListener('click', cetakLaporan);
}

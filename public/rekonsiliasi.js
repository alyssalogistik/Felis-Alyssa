// Tampilan Rekonsiliasi Bank.
//
// Penyaringan dan penjumlahan dikerjakan di server: peramban hanya menerima satu
// halaman baris ditambah ringkasan yang sudah dihitung, sehingga rekening koran
// berisi ribuan transaksi tidak membuat halaman ini tersendat.

import {
  aman, ambil, el, kosong, formatTanggalPolos, formatNominal, rupiah, tanggal,
} from './bantuan.js';

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const LABEL_REKON = { belum: 'Belum Rekon', sudah: 'Sudah Rekon', selisih: 'Selisih' };

const BATAS = 50;
let mulai = 0;
let total = 0;
let idAktif = null;

/** Kriteria filter yang sedang aktif, dibaca dari formulir. */
function kriteria() {
  const isian = new FormData(el('filter-rekon'));
  const parameter = new URLSearchParams();
  for (const [nama, nilai] of isian) {
    if (String(nilai).trim() !== '') parameter.set(nama, String(nilai).trim());
  }
  return parameter;
}

function lencanaRekon(t) {
  // Mutu data ditampilkan lebih dulu: transaksi yang datanya meragukan tidak
  // pantas terlihat seolah sudah beres.
  if (t.status_data === 'perlu_diperiksa') {
    return '<span class="lencana l-periksa">Perlu Diperiksa</span>';
  }
  return `<span class="lencana l-${aman(t.status_rekon)}">${aman(LABEL_REKON[t.status_rekon] ?? t.status_rekon)}</span>`;
}

function barisTabel(t) {
  return `
    <tr data-id="${aman(t.id)}">
      <td>${aman(formatTanggalPolos(t.tanggal))}</td>
      <td class="keterangan" data-detail title="${aman(t.keterangan)}">${aman(t.keterangan)}</td>
      <td class="angka-kolom">${formatNominal(t.debit)}</td>
      <td class="angka-kolom">${formatNominal(t.kredit)}</td>
      <td class="angka-kolom">${t.saldo === null ? '<span class="nol">-</span>' : formatNominal(t.saldo)}</td>
      <td>${lencanaRekon(t)}</td>
      <td><button type="button" class="tombol-mini" data-rekon>
        ${t.status_rekon === 'belum' ? 'Rekon' : 'Ubah'}
      </button></td>
    </tr>`;
}

function gambarRingkasan(r) {
  el('ringkasan-rekon').innerHTML = `
    <h3>Ringkasan Hasil Filter</h3>
    <div class="ringkas">
      <div><b>${Number(r.jumlah ?? 0)}</b><small>Transaksi ditemukan</small></div>
      <div class="r-debit"><b>${aman(rupiah.format(Number(r.debit ?? 0)))}</b><small>Debit</small></div>
      <div class="r-kredit"><b>${aman(rupiah.format(Number(r.kredit ?? 0)))}</b><small>Kredit</small></div>
      <div class="r-net"><b>${aman(rupiah.format(Number(r.net ?? 0)))}</b><small>Net</small></div>
    </div>`;
}

async function muatTransaksi(tambah = false) {
  const badan = el('isi-tabel-rekon');
  if (!tambah) {
    mulai = 0;
    badan.innerHTML = `<tr><td colspan="7">${kosong('Memuat…')}</td></tr>`;
  }

  const parameter = kriteria();
  parameter.set('batas', String(BATAS));
  parameter.set('mulai', String(mulai));

  try {
    const hasil = await ambil(`/rekonsiliasi/transaksi?${parameter}`);
    total = hasil.total;
    gambarRingkasan(hasil.ringkasan);

    const html = hasil.data.map(barisTabel).join('');
    if (tambah) badan.insertAdjacentHTML('beforeend', html);
    else badan.innerHTML = html || `<tr><td colspan="7">${kosong(
      total === 0 && parameter.toString().includes('cari')
        ? 'Tidak ada transaksi yang cocok dengan filter.'
        : 'Belum ada transaksi. Upload rekening koran dulu.'
    )}</td></tr>`;

    mulai += hasil.data.length;
    el('muat-rekon').hidden = mulai >= total;
  } catch (error) {
    badan.innerHTML = `<tr><td colspan="7">${kosong(error.message)}</td></tr>`;
  }
}

async function muatStatusUnggahan() {
  try {
    const { data } = await ambil('/rekonsiliasi/unggahan');
    const kotak = el('status-unggah');
    if (data.length === 0) {
      kotak.textContent = 'Belum ada file';
      kotak.classList.remove('terisi');
      return;
    }
    const u = data[0];
    kotak.classList.add('terisi');
    kotak.innerHTML =
      `<strong>${aman(u.nama_berkas)}</strong><br>` +
      `${u.jumlah_transaksi} transaksi · ${u.jumlah_valid} valid` +
      (u.jumlah_perlu_diperiksa > 0 ? ` · ${u.jumlah_perlu_diperiksa} perlu diperiksa` : '') +
      `<br><small>${aman(tanggal.format(new Date(u.diunggah_pada)))}</small>`;
  } catch {
    // Status unggahan hanya pelengkap; kegagalannya tidak perlu menutupi tabel.
  }
}

async function unggahBerkas(berkas) {
  const kotak = el('pesan-unggah');
  const tampilkan = (kelas, teks) => {
    kotak.className = `pesan ${kelas}`;
    kotak.textContent = teks;
    kotak.hidden = false;
  };

  tampilkan('', `Mengunggah ${berkas.name}…`);

  try {
    const respons = await fetch('/api/rekonsiliasi/unggah', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Nama-Berkas': encodeURIComponent(berkas.name),
      },
      body: berkas,
    });
    const isi = await respons.json().catch(() => ({}));
    if (!respons.ok) throw new Error(isi.pesan ?? `Gagal mengunggah (HTTP ${respons.status}).`);

    const r = isi.ringkasan;
    const catatan = [];
    if (r.perlu_diperiksa > 0) catatan.push(`${r.perlu_diperiksa} perlu diperiksa`);
    if (r.duplikat > 0) catatan.push(`${r.duplikat} duplikat`);
    if (r.tanggal_ambigu > 0) catatan.push(`${r.tanggal_ambigu} tanggal ambigu`);
    if (isi.pernah_diunggah) catatan.push('berkas ini pernah diunggah sebelumnya');

    tampilkan('berhasil',
      `${r.total} transaksi terbaca dari sheet "${isi.sheet}". ${r.valid} valid` +
      (catatan.length > 0 ? ` — ${catatan.join(', ')}.` : '.'));

    await muatStatusUnggahan();
    await muatTransaksi();
  } catch (error) {
    tampilkan('gagal', error.message);
  }
}

// --- Modal rekon ------------------------------------------------------------

async function bukaModalRekon(id) {
  idAktif = id;
  const formulir = el('form-rekon');
  formulir.reset();
  el('pesan-rekon').hidden = true;

  try {
    const t = await ambil(`/rekonsiliasi/transaksi/${id}`);
    const nominal = Number(t.debit) + Number(t.kredit);

    el('ringkas-modal').innerHTML =
      `${aman(formatTanggalPolos(t.tanggal))} · ${aman(t.keterangan)}<br>` +
      `<strong>${aman(rupiah.format(nominal))}</strong> ` +
      `(${Number(t.debit) > 0 ? 'debit' : 'kredit'})`;

    formulir.referensi_rekon.value = t.referensi_rekon ?? '';
    formulir.catatan_rekon.value = t.catatan_rekon ?? '';
    formulir.nominal_pembanding.value = t.nominal_pembanding ?? '';

    el('modal-rekon').showModal();
  } catch (error) {
    alert(error.message);
  }
}

async function simpanRekon() {
  const formulir = el('form-rekon');
  const kotak = el('pesan-rekon');
  const tombol = el('simpan-rekon');

  tombol.disabled = true;
  try {
    const t = await ambil(`/rekonsiliasi/transaksi/${idAktif}/rekon`, {
      method: 'POST',
      body: JSON.stringify({
        referensi_rekon: formulir.referensi_rekon.value,
        catatan_rekon: formulir.catatan_rekon.value,
        nominal_pembanding: formulir.nominal_pembanding.value,
      }),
    });

    // Server yang memutuskan cocok atau selisih; peramban hanya melaporkannya.
    if (t.status_rekon === 'selisih') {
      kotak.className = 'pesan gagal';
      kotak.textContent = `Selisih ${rupiah.format(Math.abs(Number(t.selisih)))}. Status ditandai Selisih.`;
    } else {
      kotak.className = 'pesan berhasil';
      kotak.textContent = 'Cocok. Status menjadi Sudah Rekon.';
    }
    kotak.hidden = false;

    await muatTransaksi();
    setTimeout(() => el('modal-rekon').close(), 1200);
  } catch (error) {
    kotak.className = 'pesan gagal';
    kotak.textContent = error.message;
    kotak.hidden = false;
  } finally {
    tombol.disabled = false;
  }
}

// --- Modal detail -----------------------------------------------------------

function barisDetail(label, nilai) {
  if (nilai === null || nilai === undefined || nilai === '') return '';
  return `<div class="pasangan"><dt>${aman(label)}</dt><dd>${aman(nilai)}</dd></div>`;
}

async function bukaDetail(id) {
  const kotak = el('isi-modal-detail');
  kotak.innerHTML = kosong('Memuat…');
  el('modal-detail').showModal();

  try {
    const t = await ambil(`/rekonsiliasi/transaksi/${id}`);
    const uang = (n) => (n === null || n === undefined ? null : rupiah.format(Number(n)));

    kotak.innerHTML = `
      <h3>Detail Transaksi</h3>
      <dl>
        ${barisDetail('Tanggal', formatTanggalPolos(t.tanggal))}
        ${barisDetail('Debit', Number(t.debit) > 0 ? uang(t.debit) : null)}
        ${barisDetail('Kredit', Number(t.kredit) > 0 ? uang(t.kredit) : null)}
        ${barisDetail('Saldo', uang(t.saldo))}
        ${barisDetail('Referensi', t.referensi)}
        ${barisDetail('Status rekon', LABEL_REKON[t.status_rekon])}
        ${barisDetail('Ref. rekon', t.referensi_rekon)}
        ${barisDetail('Nominal pembanding', uang(t.nominal_pembanding))}
        ${barisDetail('Selisih', uang(t.selisih))}
        ${barisDetail('Catatan rekon', t.catatan_rekon)}
        ${barisDetail('Tanggal rekon', t.direkon_pada ? tanggal.format(new Date(t.direkon_pada)) : null)}
        ${barisDetail('User rekon', t.direkon_oleh ?? (t.direkon_pada ? 'tidak tercatat' : null))}
        ${barisDetail('Berkas sumber', t.berkas_sumber)}
        ${barisDetail('Baris di berkas', t.baris_sumber)}
      </dl>

      <div class="panel" style="margin-top:12px">
        <h3>Keterangan Lengkap</h3>
        <p style="margin:0;word-break:break-word">${aman(t.keterangan)}</p>
      </div>

      ${t.masalah?.length > 0
        ? `<p class="catatan-mutu">${t.masalah.map(aman).join('<br>')}</p>`
        : ''}
      ${t.tanggal_ambigu
        ? '<p class="catatan-mutu">Tanggal ditulis seperti 01/08 sehingga bisa dibaca dua arah. Dibaca hari-dulu; cocokkan dengan berkas asli bila ragu.</p>'
        : ''}`;
  } catch (error) {
    kotak.innerHTML = kosong(error.message);
  }
}

// --- Pemasangan kendali -----------------------------------------------------

/** Dipasang sekali saat halaman dimuat, bukan setiap kali tampilan dibuka. */
export function pasangKendaliRekonsiliasi() {
  const filter = el('filter-rekon');
  if (!filter) return;

  filter.bulan.append(...NAMA_BULAN.map((nama, i) => new Option(nama, String(i + 1))));

  const tahunIni = new Date().getFullYear();
  filter.tahun.append(
    ...Array.from({ length: 7 }, (_, i) => String(tahunIni + 1 - i)).map((t) => new Option(t, t))
  );

  el('berkas-koran').addEventListener('change', (peristiwa) => {
    const berkas = peristiwa.target.files?.[0];
    if (berkas) unggahBerkas(berkas);
    // Dikosongkan supaya memilih berkas yang sama dua kali tetap memicu unggahan.
    peristiwa.target.value = '';
  });

  // Ketikan pencarian ditunda sejenak agar tiap huruf tidak memicu satu query.
  let tunda;
  filter.addEventListener('input', (peristiwa) => {
    clearTimeout(tunda);
    tunda = setTimeout(() => muatTransaksi(), peristiwa.target.type === 'search' ? 350 : 0);
  });
  filter.addEventListener('submit', (peristiwa) => peristiwa.preventDefault());

  el('reset-filter').addEventListener('click', () => {
    filter.reset();
    muatTransaksi();
  });

  el('ekspor-rekon').addEventListener('click', () => {
    // Ekspor memakai kriteria yang sama dengan tabel, jadi isinya persis hasil
    // yang sedang terlihat.
    window.location.assign(`/api/rekonsiliasi/ekspor?${kriteria()}`);
  });

  el('muat-rekon').addEventListener('click', () => muatTransaksi(true));

  el('isi-tabel-rekon').addEventListener('click', (peristiwa) => {
    const baris = peristiwa.target.closest('tr[data-id]');
    if (!baris) return;
    if (peristiwa.target.closest('[data-rekon]')) bukaModalRekon(baris.dataset.id);
    else bukaDetail(baris.dataset.id);
  });

  el('simpan-rekon').addEventListener('click', simpanRekon);
  el('batal-modal').addEventListener('click', () => el('modal-rekon').close());
  el('tutup-detail').addEventListener('click', () => el('modal-detail').close());
}

export async function muatRekonsiliasi() {
  await muatStatusUnggahan();
  await muatTransaksi();
}

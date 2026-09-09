// Tampilan audit pembayaran supplier.
//
// Alur yang dituju: unggah tagihan, jalankan auto-match, lalu yang tampil
// pertama kali hanyalah pengecualiannya. Tagihan yang sudah cocok tidak perlu
// dilihat satu per satu — itu inti audit cepat.

import {
  aman, ambil, el, kosong, formatTanggalPolos, formatNominal, rupiah, tanggal,
} from './bantuan.js';

const NAMA_BULAN = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

const LABEL_STATUS = {
  MATCH: 'Match',
  KURANG_BAYAR: 'Kurang Bayar',
  LEBIH_BAYAR: 'Lebih Bayar',
  INVOICE_BELUM_ADA_TRANSFER: 'Belum Ada Transfer',
  TRANSFER_TANPA_INVOICE: 'Transfer Tanpa Invoice',
  PERLU_REVIEW: 'Perlu Review',
};

const BATAS = 50;
let mulai = 0;
let total = 0;

function kriteria() {
  const parameter = new URLSearchParams();
  for (const [nama, nilai] of new FormData(el('filter-audit'))) {
    if (String(nilai).trim() !== '') parameter.set(nama, String(nilai).trim());
  }
  return parameter;
}

function selSelisih(nilai) {
  if (nilai === null || nilai === undefined) return '<span class="nol">-</span>';
  const angka = Number(nilai);
  if (angka === 0) return '<span class="nol">0</span>';
  const kelas = angka < 0 ? 'selisih-kurang' : 'selisih-lebih';
  return `<span class="${kelas}">${aman(rupiah.format(angka))}</span>`;
}

/** Baris transfer tanpa invoice tidak punya sisi tagihan; kolomnya dikosongkan. */
const kolomKosong = '<span class="nol">-</span>';

function barisAudit(b) {
  const keyakinan = Number(b.keyakinan ?? 0);
  const adaTagihan = Boolean(b.tagihan_id);
  return `
    <tr${adaTagihan ? ` data-tagihan="${aman(b.tagihan_id)}"` : ''}>
      <td>${aman(b.pemasok)}</td>
      <td>${adaTagihan ? aman(b.no_invoice) : kolomKosong}</td>
      <td>${adaTagihan ? aman(formatTanggalPolos(b.tanggal_invoice)) : kolomKosong}</td>
      <td class="angka-kolom">${adaTagihan ? formatNominal(b.gross) : kolomKosong}</td>
      <td class="angka-kolom">${adaTagihan ? formatNominal(b.pph) : kolomKosong}</td>
      <td class="angka-kolom">${adaTagihan ? formatNominal(b.net_seharusnya) : kolomKosong}</td>
      <td class="angka-kolom">${b.transfer_bank === null ? '<span class="nol">-</span>' : formatNominal(b.transfer_bank)}</td>
      <td class="angka-kolom">${selSelisih(b.selisih)}</td>
      <td>
        <span class="lencana panjang l-${aman(b.status)}">${aman(LABEL_STATUS[b.status] ?? b.status)}</span>
        ${keyakinan > 0 ? `<span class="keyakinan">${Math.round(keyakinan * 100)}%</span>` : ''}
      </td>
    </tr>`;
}

function gambarRingkasan(r) {
  if (!r) {
    el('ringkasan-audit').innerHTML = kosong('Belum ada hasil audit.');
    return;
  }
  el('ringkasan-audit').innerHTML = `
    <h3>Ringkasan Audit</h3>
    <div class="ringkas">
      <div><b>${Number(r.total_tagihan ?? 0)}</b><small>Tagihan</small></div>
      <div class="r-debit"><b>${Number(r.perlu_perhatian ?? 0)}</b><small>Perlu perhatian</small></div>
      <div><b>${aman(rupiah.format(Number(r.total_gross ?? 0)))}</b><small>Total gross</small></div>
      <div><b>${aman(rupiah.format(Number(r.total_pph ?? 0)))}</b><small>Total PPh</small></div>
      <div class="r-kredit"><b>${aman(rupiah.format(Number(r.total_transfer ?? 0)))}</b><small>Total transfer</small></div>
      <div class="r-net"><b>${aman(rupiah.format(Number(r.total_selisih ?? 0)))}</b><small>Total selisih</small></div>
    </div>`;
}

async function muatHasil(tambah = false) {
  const badan = el('isi-tabel-audit');
  if (!tambah) {
    mulai = 0;
    badan.innerHTML = `<tr><td colspan="9">${kosong('Memuat…')}</td></tr>`;
  }

  const parameter = kriteria();
  parameter.set('batas', String(BATAS));
  parameter.set('mulai', String(mulai));

  try {
    const hasil = await ambil(`/rekonsiliasi/audit/hasil?${parameter}`);
    total = hasil.total;
    gambarRingkasan(hasil.ringkasan);

    const html = hasil.data.map(barisAudit).join('');
    if (tambah) badan.insertAdjacentHTML('beforeend', html);
    else badan.innerHTML = html || `<tr><td colspan="9">${kosong(
      parameter.get('hanya_selisih')
        ? 'Tidak ada pengecualian. Semua tagihan pada filter ini cocok.'
        : 'Belum ada tagihan. Upload daftar tagihan lalu jalankan auto-match.'
    )}</td></tr>`;

    mulai += hasil.data.length;
    el('muat-audit').hidden = mulai >= total;
  } catch (error) {
    badan.innerHTML = `<tr><td colspan="9">${kosong(error.message)}</td></tr>`;
  }
}

async function muatStatusTagihan() {
  try {
    const { data } = await ambil('/rekonsiliasi/audit/pemasok');
    const kotak = el('status-tagihan');
    if (data.length === 0) {
      kotak.textContent = 'Belum ada tagihan';
      kotak.classList.remove('terisi');
      return;
    }
    kotak.classList.add('terisi');
    kotak.textContent = `${data.length} supplier terdaftar`;
  } catch {
    // Status hanya pelengkap; kegagalannya tidak perlu menutupi tabel.
  }
}

async function unggahTagihan(berkas) {
  const kotak = el('pesan-tagihan');
  const tampil = (kelas, teks) => {
    kotak.className = `pesan ${kelas}`;
    kotak.textContent = teks;
    kotak.hidden = false;
  };
  tampil('', `Mengunggah ${berkas.name}…`);

  try {
    const respons = await fetch('/api/rekonsiliasi/audit/tagihan/unggah', {
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
    tampil('berhasil',
      `${r.total} tagihan terbaca, ${isi.tersimpan} tersimpan` +
      (r.bermasalah > 0 ? `, ${r.bermasalah} bermasalah dan dilewati.` : '.'));

    await muatStatusTagihan();
  } catch (error) {
    tampil('gagal', error.message);
  }
}

async function jalankanAudit() {
  const kotak = el('pesan-audit');
  const tombol = el('jalankan-audit');
  kotak.className = 'pesan';
  kotak.textContent = 'Mencocokkan tagihan dengan transaksi bank…';
  kotak.hidden = false;
  tombol.disabled = true;

  try {
    const hasil = await ambil('/rekonsiliasi/audit/jalankan', { method: 'POST', body: '{}' });
    const r = hasil.ringkasan;
    kotak.className = 'pesan berhasil';
    kotak.textContent =
      `${hasil.dicocokkan} tagihan diperiksa terhadap ${hasil.transaksi_diperiksa} transaksi keluar. ` +
      `${r.per_status.MATCH} cocok, ${r.perlu_perhatian} perlu perhatian.` +
      (hasil.dipertahankan > 0 ? ` ${hasil.dipertahankan} keputusan manual dipertahankan.` : '');
    await muatHasil();
  } catch (error) {
    kotak.className = 'pesan gagal';
    kotak.textContent = error.message;
  } finally {
    tombol.disabled = false;
  }
}

async function bukaDetail(tagihanId) {
  const kotak = el('isi-modal-audit');
  kotak.innerHTML = kosong('Memuat…');
  el('modal-audit').showModal();

  try {
    const { data } = await ambil(`/rekonsiliasi/audit/hasil?batas=200`);
    const b = data.find((x) => x.tagihan_id === tagihanId);
    if (!b) {
      kotak.innerHTML = kosong('Baris tidak ditemukan pada filter saat ini.');
      return;
    }

    const uang = (n) => (n === null || n === undefined ? null : rupiah.format(Number(n)));
    const baris = (label, nilai) =>
      nilai === null || nilai === undefined || nilai === ''
        ? ''
        : `<div class="pasangan"><dt>${aman(label)}</dt><dd>${aman(nilai)}</dd></div>`;

    kotak.innerHTML = `
      <h3>${aman(b.pemasok)}</h3>
      <p class="ringkas-modal">
        ${aman(b.no_invoice)} &middot; ${aman(formatTanggalPolos(b.tanggal_invoice))}<br>
        <span class="lencana panjang l-${aman(b.status)}">${aman(LABEL_STATUS[b.status] ?? b.status)}</span>
      </p>
      <dl>
        ${baris('Gross tagihan', uang(b.gross))}
        ${baris('PPh', uang(b.pph))}
        ${baris('Net transfer seharusnya', uang(b.net_seharusnya))}
        ${baris('Transfer bank', uang(b.transfer_bank))}
        ${baris('Selisih', uang(b.selisih))}
        ${baris('Tanggal transfer', b.tanggal_transfer ? formatTanggalPolos(b.tanggal_transfer) : null)}
        ${baris('Keyakinan', b.keyakinan ? `${Math.round(Number(b.keyakinan) * 100)}%` : null)}
        ${baris('Dikonfirmasi manusia', b.dikonfirmasi ? 'ya' : null)}
      </dl>
      ${b.keterangan_transfer
        ? `<div class="panel" style="margin-top:12px"><h3>Keterangan Transfer</h3>
           <p style="margin:0;word-break:break-word">${aman(b.keterangan_transfer)}</p></div>`
        : ''}
      ${b.alasan?.length > 0
        ? `<p style="margin:14px 0 0;color:var(--teks-redup);font-size:12px">Dasar pencocokan:</p>
           <ul class="alasan">${b.alasan.map((a) => `<li>${aman(a)}</li>`).join('')}</ul>`
        : ''}`;
  } catch (error) {
    kotak.innerHTML = kosong(error.message);
  }
}

export function pasangKendaliAudit() {
  const filter = el('filter-audit');
  if (!filter) return;

  filter.bulan.append(...NAMA_BULAN.map((nama, i) => new Option(nama, String(i + 1))));
  const tahunIni = new Date().getFullYear();
  filter.tahun.append(
    ...Array.from({ length: 7 }, (_, i) => String(tahunIni + 1 - i)).map((t) => new Option(t, t))
  );

  el('berkas-tagihan').addEventListener('change', (peristiwa) => {
    const berkas = peristiwa.target.files?.[0];
    if (berkas) unggahTagihan(berkas);
    peristiwa.target.value = '';
  });

  el('jalankan-audit').addEventListener('click', jalankanAudit);

  let tunda;
  filter.addEventListener('input', (peristiwa) => {
    clearTimeout(tunda);
    tunda = setTimeout(() => muatHasil(), peristiwa.target.type === 'search' ? 350 : 0);
  });
  filter.addEventListener('submit', (peristiwa) => peristiwa.preventDefault());

  el('reset-audit').addEventListener('click', () => {
    filter.reset();
    muatHasil();
  });

  el('ekspor-audit').addEventListener('click', () => {
    window.location.assign(`/api/rekonsiliasi/audit/ekspor?${kriteria()}`);
  });

  el('muat-audit').addEventListener('click', () => muatHasil(true));

  el('isi-tabel-audit').addEventListener('click', (peristiwa) => {
    const baris = peristiwa.target.closest('tr[data-tagihan]');
    if (baris) bukaDetail(baris.dataset.tagihan);
  });

  el('tutup-audit').addEventListener('click', () => el('modal-audit').close());
}

export async function muatAudit() {
  await muatStatusTagihan();
  await muatHasil();
}

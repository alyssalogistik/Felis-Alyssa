// Input pembayaran manual: uang keluar yang tidak lewat rekening koran BCA.
//
// Mekari Pay, kas, bank lain. Disimpan ke tabelnya sendiri lewat
// /api/rekonsiliasi/pembayaran; transaksi_bank tidak pernah disentuh dari sini.
//
// Penjaga double count tinggal di server (kembar-bayar.js). Modul ini hanya
// menampilkan kandidatnya dan meminta persetujuan — supaya tidak ada aturan
// kedua di peramban yang bisa menyimpang dari yang dijalankan saat menyimpan.

import { aman, ambil, el, kosong, rupiah, formatTanggalPolos } from './bantuan.js';

const SUMBER = {
  MEKARI_PAY: 'Mekari Pay',
  BCA: 'BCA',
  BANK_LAIN: 'Bank Lain',
  KAS: 'Kas',
  LAINNYA: 'Lainnya',
};

/** Dipanggil setelah daftar pembayaran berubah, untuk menyegarkan hasil audit. */
let sesudahBerubah = null;

/** Pembayaran yang sedang disunting; null berarti sedang membuat baru. */
let sedangDisunting = null;

/** Menahan pengiriman kedua selagi yang pertama belum selesai. */
let sedangKirim = false;

function pesan(kelas, teks) {
  const kotak = el('pesan-bayar-manual');
  if (!kotak) return;
  kotak.className = `pesan ${kelas}`;
  kotak.textContent = teks;
  kotak.hidden = teks === '';
}

function isian() {
  const f = el('form-bayar-manual');
  const ambilNilai = (nama) => String(new FormData(f).get(nama) ?? '').trim();
  return {
    tanggal: ambilNilai('tanggal'),
    penerima: ambilNilai('penerima'),
    nominal: ambilNilai('nominal'),
    sumber: ambilNilai('sumber'),
    no_referensi: ambilNilai('no_referensi'),
    memo: ambilNilai('memo'),
    bukti_url: ambilNilai('bukti_url'),
    dibuat_oleh: ambilNilai('dibuat_oleh'),
  };
}

// --- Daftar pembayaran manual ----------------------------------------------

function barisBayar(b) {
  const referensi = b.no_referensi ? `<small>${aman(b.no_referensi)}</small>` : '';
  const bukti = b.bukti_url
    ? ` &middot; <a href="${aman(b.bukti_url)}" target="_blank" rel="noopener noreferrer">bukti</a>`
    : '';

  return `
    <div class="baris-bayar" data-bayar="${aman(b.id)}">
      <div class="bayar-utama">
        <span class="lencana-sumber sumber-manual">${aman(SUMBER[b.sumber] ?? b.sumber)}</span>
        <strong>${aman(b.penerima)}</strong>
        <span class="angka-supplier">${aman(rupiah.format(Number(b.nominal)))}</span>
      </div>
      <small class="info-supplier">
        ${aman(formatTanggalPolos(b.tanggal))} &middot; diinput ${aman(b.dibuat_oleh)}${bukti}
      </small>
      ${referensi}
      ${b.memo ? `<small class="varian-nama">${aman(b.memo)}</small>` : ''}
      <div class="aksi-bayar">
        <button type="button" class="tombol-kecil" data-aksi="ubah">Ubah</button>
        <button type="button" class="tombol-kecil tombol-hapus-unggahan" data-aksi="hapus">Hapus</button>
      </div>
    </div>`;
}

export async function muatPembayaranManual() {
  const kotak = el('daftar-bayar-manual');
  if (!kotak) return;

  try {
    const { data } = await ambil('/rekonsiliasi/pembayaran');
    kotak.innerHTML = (data ?? []).length === 0
      ? kosong('Belum ada pembayaran manual.')
      : data.map(barisBayar).join('');
  } catch (error) {
    kotak.innerHTML = kosong(error.message);
  }
}

// --- Kotak peringatan kemungkinan kembar ------------------------------------

function gambarKandidat(isi) {
  const kandidat = isi.kandidat ?? [];
  const peringatan = isi.peringatan ?? [];

  const daftarPeringatan = peringatan
    .map((p) => `<p class="pesan peringatan">${aman(p)}</p>`)
    .join('');

  const daftarKandidat = kandidat.length === 0
    ? '<p class="keterangan-panel">Tidak ditemukan transaksi serupa di rekening koran maupun pembayaran manual.</p>'
    : kandidat.map((k) => `
        <div class="kandidat-kembar ${k.kekuatan === 'kuat' ? 'kembar-kuat' : ''}">
          <div class="bayar-utama">
            <span class="lencana-sumber${k.asal === 'manual' ? ' sumber-manual' : ''}">${aman(k.sumber)}</span>
            <strong>${aman(formatTanggalPolos(k.tanggal))}</strong>
            <span class="angka-supplier">${aman(rupiah.format(k.nominal))}</span>
          </div>
          <small class="info-supplier">${aman(k.keterangan)}</small>
          <small class="varian-nama">${aman(k.alasan.join(' '))}</small>
        </div>`).join('');

  el('isi-kembar').innerHTML = daftarPeringatan + daftarKandidat;
  el('setuju-kembar').checked = false;
  el('lanjut-kembar').disabled = true;
}

// --- Simpan -----------------------------------------------------------------

async function kirim(konfirmasi) {
  const data = isian();
  const jalur = sedangDisunting
    ? `/rekonsiliasi/pembayaran/${encodeURIComponent(sedangDisunting)}`
    : '/rekonsiliasi/pembayaran';
  const badan = sedangDisunting ? { ...data, diubah_oleh: data.dibuat_oleh } : data;

  return ambil(`${jalur}${konfirmasi ? '?konfirmasi_kembar=1' : ''}`, {
    method: sedangDisunting ? 'PATCH' : 'POST',
    body: JSON.stringify(badan),
  });
}

async function simpan(konfirmasi = false) {
  if (sedangKirim) return;
  sedangKirim = true;

  const tombol = el('simpan-bayar-manual');
  tombol.disabled = true;
  tombol.textContent = 'Menyimpan…';

  try {
    await kirim(konfirmasi);
    el('modal-kembar').close();
    batalSunting();
    pesan('berhasil', 'Pembayaran manual tersimpan.');
    await muatPembayaranManual();
    if (typeof sesudahBerubah === 'function') await sesudahBerubah();
  } catch (error) {
    // Kemungkinan kembar bukan kegagalan: pemakainya diberi daftar kandidatnya
    // lalu memutuskan sendiri. Penolakannya datang dari server, bukan dari
    // aturan kedua di peramban.
    if (error.kode === 'perlu_konfirmasi_kembar') {
      gambarKandidat(error.isi ?? {});
      el('modal-kembar').showModal();
      pesan('', '');
    } else {
      pesan('gagal', error.message);
    }
  } finally {
    sedangKirim = false;
    tombol.disabled = false;
    tombol.textContent = sedangDisunting ? 'Simpan perubahan' : 'Simpan pembayaran';
  }
}

// --- Sunting dan hapus ------------------------------------------------------

function batalSunting() {
  sedangDisunting = null;
  const f = el('form-bayar-manual');
  const oleh = f.dibuat_oleh.value;
  f.reset();
  // Nama penginput dibiarkan: satu orang biasanya memasukkan beberapa
  // pembayaran berturut-turut, dan mengosongkannya tiap kali hanya mengundang
  // kolom itu diisi asal-asalan.
  f.dibuat_oleh.value = oleh;
  el('judul-bayar-manual').textContent = 'Input Pembayaran Manual';
  el('simpan-bayar-manual').textContent = 'Simpan pembayaran';
  el('batal-bayar-manual').hidden = true;
}

async function mulaiSunting(id) {
  try {
    const { data } = await ambil('/rekonsiliasi/pembayaran');
    const b = (data ?? []).find((x) => x.id === id);
    if (!b) return pesan('gagal', 'Pembayaran tidak ditemukan.');

    const f = el('form-bayar-manual');
    f.tanggal.value = b.tanggal;
    f.penerima.value = b.penerima;
    f.nominal.value = String(Number(b.nominal));
    f.sumber.value = b.sumber;
    f.no_referensi.value = b.no_referensi ?? '';
    f.memo.value = b.memo ?? '';
    f.bukti_url.value = b.bukti_url ?? '';

    sedangDisunting = id;
    el('judul-bayar-manual').textContent = 'Ubah Pembayaran Manual';
    el('simpan-bayar-manual').textContent = 'Simpan perubahan';
    el('batal-bayar-manual').hidden = false;
    pesan('', '');
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    pesan('gagal', error.message);
  }
}

async function hapus(id) {
  const oleh = String(el('form-bayar-manual').dibuat_oleh.value ?? '').trim();
  if (oleh === '') {
    return pesan('gagal', 'Isi dulu kolom "Diinput oleh" — nama itu yang dicatat sebagai penghapus.');
  }

  const { data } = await ambil('/rekonsiliasi/pembayaran');
  const b = (data ?? []).find((x) => x.id === id);
  if (!b) return pesan('gagal', 'Pembayaran tidak ditemukan.');

  const setuju = window.confirm(
    `Hapus pembayaran ${b.penerima} ${rupiah.format(Number(b.nominal))} ` +
    `tanggal ${formatTanggalPolos(b.tanggal)}?\n\n` +
    'Transaksi rekening koran tidak tersentuh. Jejak penghapusan tetap tersimpan.'
  );
  if (!setuju) return;

  try {
    await ambil(`/rekonsiliasi/pembayaran/${encodeURIComponent(id)}?oleh=${encodeURIComponent(oleh)}`,
      { method: 'DELETE' });
    pesan('berhasil', 'Pembayaran manual dihapus.');
    if (sedangDisunting === id) batalSunting();
    await muatPembayaranManual();
    if (typeof sesudahBerubah === 'function') await sesudahBerubah();
  } catch (error) {
    pesan('gagal', error.message);
  }
}

// --- Pemasangan -------------------------------------------------------------

/**
 * @param {() => Promise<void>} [sesudah]
 *   Dijalankan setelah daftar pembayaran berubah, untuk menyegarkan hasil
 *   pencarian, ringkasan, dan daftar supplier.
 */
export function pasangKendaliPembayaran(sesudah) {
  sesudahBerubah = sesudah ?? null;

  const f = el('form-bayar-manual');
  if (!f) return;

  f.sumber.append(...Object.entries(SUMBER).map(([nilai, label]) => new Option(label, nilai)));

  f.addEventListener('submit', (peristiwa) => {
    peristiwa.preventDefault();
    simpan(false);
  });

  el('batal-bayar-manual').addEventListener('click', batalSunting);

  el('daftar-bayar-manual').addEventListener('click', (peristiwa) => {
    const tombol = peristiwa.target.closest('button[data-aksi]');
    if (!tombol) return;
    const id = tombol.closest('.baris-bayar')?.dataset.bayar;
    if (!id) return;
    if (tombol.dataset.aksi === 'ubah') mulaiSunting(id);
    else hapus(id);
  });

  el('setuju-kembar').addEventListener('change', (peristiwa) => {
    el('lanjut-kembar').disabled = !peristiwa.target.checked;
  });

  el('lanjut-kembar').addEventListener('click', () => simpan(true));
  el('batal-kembar').addEventListener('click', () => el('modal-kembar').close());
}

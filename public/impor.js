// Impor rekening koran bulanan secara berurutan.
//
// Alur yang dituju: pilih dua belas PDF sekaligus, lalu sistem yang mengurus
// sisanya — membaca periode masing-masing, mengurutkannya dari bulan terlama,
// menolak batch yang melebihi dua belas bulan sebelum apa pun tersimpan, lalu
// mengunggah satu per satu dan melaporkan hasil tiap berkas.
//
// Penyimpanannya tetap satu: endpoint unggah yang sama dengan Rekonsiliasi
// Bank. Yang ditambahkan di sini hanya pengaturan urutan dan pelaporan.

import { aman, ambil, el, kosong } from './bantuan.js';
import { MAKS_BERKAS, namaPeriode, periksaBatch, ringkasBatch } from './batch.js';

/**
 * Dipanggil setelah satu unggahan dihapus, untuk menyegarkan tampilan lain
 * yang ikut berubah: jumlah transaksi, daftar supplier, dan ringkasan rekon.
 * Diisi app.js supaya modul ini tidak perlu mengimpor keempatnya.
 */
let sesudahBerubah = null;

const LABEL_STATUS = {
  selesai: 'Tersimpan',
  sebagian: 'Sebagian sudah ada',
  duplikat: 'File/periode ini pernah diupload sebelumnya.',
  gagal: 'Gagal',
};

function pesanImpor(kelas, teks) {
  const kotak = el('pesan-koran-audit');
  if (!kotak) return;
  kotak.className = `pesan ${kelas}`;
  kotak.textContent = teks;
  kotak.hidden = teks === '';
}

/** Satu berkas dikirim sebagai badan mentah, sama seperti unggahan tunggal. */
async function kirim(jalur, berkas) {
  const respons = await fetch(`/api/rekonsiliasi/${jalur}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Nama-Berkas': encodeURIComponent(berkas.name),
    },
    body: berkas,
  });
  const isi = await respons.json().catch(() => ({}));
  if (!respons.ok) throw new Error(isi.pesan ?? `Gagal (HTTP ${respons.status}).`);
  return isi;
}

function barisHasil(h) {
  const catatan = [];
  if (h.status !== 'gagal') {
    catatan.push(`${h.dibaca} transaksi dibaca`);
    catatan.push(`${h.baru} transaksi baru`);
    catatan.push(`${h.sudah_ada} duplikat`);
    if (h.perlu_diperiksa > 0) catatan.push(`${h.perlu_diperiksa} perlu diperiksa`);
  }

  return `
    <li class="hasil-berkas status-${aman(h.status)}">
      <strong>${aman(h.judul)}</strong>
      <small>${aman(h.nama)}</small>
      ${catatan.length > 0 ? `<span>${catatan.map(aman).join(' &middot; ')}</span>` : ''}
      <em>${aman(h.pesan ?? LABEL_STATUS[h.status] ?? '')}</em>
    </li>`;
}

function gambarHasil(hasil, rentang, tersimpan) {
  const kotak = el('hasil-impor');
  if (!kotak) return;

  const r = ringkasBatch(hasil);
  const periode = rentang
    ? `${namaPeriode(rentang.awal)} &ndash; ${namaPeriode(rentang.akhir)}`
    : 'Periode tidak dikenali';

  kotak.innerHTML = `
    <h4>Import selesai</h4>
    <p class="keterangan-panel">Periode: ${periode}</p>
    <div class="ringkas">
      <div><b>${rentang?.bulan ?? hasil.length}</b><small>Bulan diproses</small></div>
      <div><b>${r.dibaca}</b><small>Transaksi dibaca</small></div>
      <div class="r-kredit"><b>${r.baru}</b><small>Transaksi baru</small></div>
      <div><b>${r.sudah_ada}</b><small>Duplikat</small></div>
      ${r.perlu_diperiksa > 0 ? `<div class="r-debit"><b>${r.perlu_diperiksa}</b><small>Perlu diperiksa</small></div>` : ''}
      ${r.gagal > 0 ? `<div class="r-debit"><b>${r.gagal}</b><small>Berkas gagal</small></div>` : ''}
      <div><b>${tersimpan}</b><small>Total tersimpan</small></div>
    </div>
    <ul class="daftar-hasil">${hasil.map(barisHasil).join('')}</ul>`;
}

/** Berapa transaksi yang benar-benar ada di database saat ini. */
async function jumlahTersimpan() {
  try {
    const { total } = await ambil('/rekonsiliasi/transaksi?batas=1');
    return total ?? 0;
  } catch {
    return 0;
  }
}

export async function muatRiwayatImpor() {
  const kotak = el('riwayat-impor');
  if (!kotak) return;

  try {
    const { data } = await ambil('/rekonsiliasi/unggahan');
    if (!data || data.length === 0) {
      kotak.innerHTML = kosong('Belum ada import.');
      return;
    }

    kotak.innerHTML = `
      <div class="gulir-mendatar">
        <table class="tabel">
          <thead>
            <tr>
              <th>Periode</th><th>Berkas</th><th>Waktu</th>
              <th class="angka-kolom">Dibaca</th>
              <th class="angka-kolom">Baru</th>
              <th class="angka-kolom">Duplikat</th>
              <th class="angka-kolom">Perlu Diperiksa</th>
              <th>Status</th>
              <th><span class="hanya-pembaca-layar">Tindakan</span></th>
            </tr>
          </thead>
          <tbody>
            ${data.map((u) => `
              <tr>
                <td>${aman(u.periode_bulan ? namaPeriode({ bulan: u.periode_bulan, tahun: u.periode_tahun }) : '-')}</td>
                <td class="keterangan-sel">${aman(u.nama_berkas)}</td>
                <td>${aman(new Date(u.diunggah_pada).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }))}</td>
                <td class="angka-kolom">${Number(u.jumlah_transaksi ?? 0)}</td>
                <td class="angka-kolom">${Number(u.jumlah_baru ?? 0)}</td>
                <td class="angka-kolom">${Number(u.jumlah_sudah_ada ?? 0)}</td>
                <td class="angka-kolom">${Number(u.jumlah_perlu_diperiksa ?? 0)}</td>
                <td>${aman(LABEL_STATUS[u.status] ?? u.status ?? '-')}</td>
                <td>
                  <button type="button" class="tombol-hapus-unggahan" data-unggahan="${aman(u.id)}"
                          title="Hapus unggahan ini"
                          aria-label="Hapus unggahan ${aman(u.nama_berkas)}">Hapus</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (error) {
    kotak.innerHTML = kosong(error.message);
  }
}

// --- Hapus satu unggahan ----------------------------------------------------
//
// Dipakai untuk membuang berkas yang salah upload atau ter-upload dua kali.
// Yang dihapus hanya unggahan itu beserta transaksi yang memang miliknya;
// transaksi dari berkas lain tidak tersentuh sekalipun isinya identik.

/** Unggahan yang sedang ditanyakan di kotak konfirmasi. */
let dampakTerpilih = null;

/**
 * Menahan permintaan kedua selagi yang pertama belum selesai.
 *
 * Tombolnya memang dimatikan saat penghapusan berjalan, tetapi itu saja tidak
 * cukup: menutup kotak dengan Escape di tengah jalan mengaktifkannya kembali,
 * dan klik ganda cepat pada baris daftar sempat menembakkan dua permintaan
 * sebelum kotaknya tergambar. Penghapusan kedua memang dijawab 404 dan tidak
 * merusak apa pun, tetapi pemakainya melihat galat setelah penghapusan yang
 * sebenarnya berhasil.
 */
let sedangMenghapus = false;

function pesanRiwayat(kelas, teks) {
  const kotak = el('pesan-riwayat-impor');
  if (!kotak) return;
  kotak.className = `pesan ${kelas}`;
  kotak.textContent = teks;
  kotak.hidden = teks === '';
}

function gambarRincian(dampak) {
  el('rincian-hapus').innerHTML = dampak.rincian
    .map((r) => `
      <div class="pasangan${r.berat ? ' pasangan-berat' : ''}">
        <dt>${aman(r.label)}</dt><dd>${aman(r.nilai)}</dd>
      </div>`)
    .join('');

  // Kecocokan yang sudah dikonfirmasi manusia tidak bisa dibuat ulang oleh
  // audit otomatis. Persetujuannya diminta terpisah, dan tombolnya tetap mati
  // sampai dicentang — server pun menolak tanpa centang itu.
  const perluCentang = Number(dampak.kecocokan_dikonfirmasi ?? 0) > 0;
  const blok = el('persetujuan-hapus');
  const centang = el('setuju-hapus-kecocokan');
  blok.hidden = !perluCentang;
  centang.checked = false;
  el('jumlah-kecocokan-dikonfirmasi').textContent = String(dampak.kecocokan_dikonfirmasi ?? 0);
  el('konfirmasi-hapus').disabled = perluCentang;
}

async function bukaKonfirmasiHapus(id) {
  const modal = el('modal-hapus-unggahan');
  if (!modal || modal.open || sedangMenghapus) return;

  pesanRiwayat('', '');
  try {
    dampakTerpilih = await ambil(`/rekonsiliasi/unggahan/${encodeURIComponent(id)}/dampak`);
    dampakTerpilih.id = id;
    gambarRincian(dampakTerpilih);
    modal.showModal();
  } catch (error) {
    dampakTerpilih = null;
    pesanRiwayat('gagal', error.message);
  }
}

async function jalankanHapus() {
  if (!dampakTerpilih || sedangMenghapus) return;
  sedangMenghapus = true;

  const tombol = el('konfirmasi-hapus');
  const { id } = dampakTerpilih;
  const setuju = el('setuju-hapus-kecocokan').checked;

  tombol.disabled = true;
  tombol.textContent = 'Menghapus…';

  try {
    const { terhapus } = await ambil(
      `/rekonsiliasi/unggahan/${encodeURIComponent(id)}${setuju ? '?konfirmasi_kecocokan=1' : ''}`,
      { method: 'DELETE' }
    );

    el('modal-hapus-unggahan').close();
    dampakTerpilih = null;

    const catatan = [`${terhapus.transaksi} transaksi ikut terhapus`];
    if (terhapus.kecocokan > 0) catatan.push(`${terhapus.kecocokan} hasil audit`);
    pesanRiwayat('berhasil', `"${terhapus.nama_berkas}" dihapus. ${catatan.join(', ')}.`);

    await muatRiwayatImpor();
    if (typeof sesudahBerubah === 'function') await sesudahBerubah();
  } catch (error) {
    // Kotaknya sengaja dibiarkan terbuka: pesannya menerangkan apa yang harus
    // dilakukan, dan menutupnya akan membuat sebabnya hilang dari layar.
    el('pesan-modal-hapus').textContent = error.message;
    el('pesan-modal-hapus').hidden = false;
  } finally {
    sedangMenghapus = false;
    tombol.textContent = 'Ya, hapus';
    tombol.disabled = Number(dampakTerpilih?.kecocokan_dikonfirmasi ?? 0) > 0
      && !el('setuju-hapus-kecocokan').checked;
  }
}

/**
 * @param {() => Promise<void>} [sesudah]
 *   Dijalankan setelah satu unggahan terhapus, untuk menyegarkan jumlah
 *   transaksi, daftar supplier, dan ringkasan rekonsiliasi.
 */
export function pasangKendaliImpor(sesudah) {
  sesudahBerubah = sesudah ?? null;

  const daftar = el('riwayat-impor');
  if (daftar) {
    daftar.addEventListener('click', (peristiwa) => {
      const tombol = peristiwa.target.closest('.tombol-hapus-unggahan');
      if (tombol) bukaKonfirmasiHapus(tombol.dataset.unggahan);
    });
  }

  const modal = el('modal-hapus-unggahan');
  if (!modal) return;

  el('setuju-hapus-kecocokan').addEventListener('change', (peristiwa) => {
    el('konfirmasi-hapus').disabled = !peristiwa.target.checked;
  });

  el('konfirmasi-hapus').addEventListener('click', jalankanHapus);
  el('batal-hapus').addEventListener('click', () => modal.close());

  // Escape saat penghapusan sedang berjalan akan membuat kotaknya tertutup
  // sebelum hasilnya diketahui, lalu tombolnya hidup lagi untuk unggahan yang
  // sudah tidak ada.
  modal.addEventListener('cancel', (peristiwa) => {
    if (sedangMenghapus) peristiwa.preventDefault();
  });

  modal.addEventListener('close', () => {
    dampakTerpilih = null;
    el('pesan-modal-hapus').hidden = true;
  });
}

/**
 * Memproses satu batch berkas.
 *
 * Periode dibaca lebih dulu untuk SELURUH berkas, tanpa menyimpan apa pun.
 * Baru setelah batasnya lolos, penyimpanan dimulai. Menolak di tengah jalan
 * akan meninggalkan sebagian bulan sudah masuk dan sebagian belum, dan tidak
 * ada cara sederhana bagi pemakainya untuk tahu sampai mana.
 */
export async function imporBerkas(berkasTerpilih, sesudah) {
  const daftar = [...berkasTerpilih];
  el('hasil-impor').innerHTML = '';

  if (daftar.length > MAKS_BERKAS) {
    pesanImpor('gagal', `Maksimal ${MAKS_BERKAS} file rekening koran dalam satu import.`);
    return;
  }

  // --- Membaca periode, belum menyimpan ------------------------------------

  pesanImpor('', `Membaca periode ${daftar.length} berkas…`);

  const diperiksa = [];
  for (const berkas of daftar) {
    try {
      const isi = await kirim('periode', berkas);
      diperiksa.push({ berkas, nama: berkas.name, periode: isi.periode });
    } catch (error) {
      // Berkas yang tidak terbaca tetap masuk daftar supaya kegagalannya
      // dilaporkan, bukan hilang diam-diam.
      diperiksa.push({ berkas, nama: berkas.name, periode: null, galat: error.message });
    }
  }

  const periksa = periksaBatch(diperiksa);
  if (!periksa.boleh) {
    const rentang = periksa.rentang
      ? ` Yang dipilih: ${namaPeriode(periksa.rentang.awal)} sampai ${namaPeriode(periksa.rentang.akhir)} (${periksa.rentang.bulan} bulan).`
      : '';
    pesanImpor('gagal', `${periksa.alasan}${rentang} Tidak ada transaksi yang disimpan.`);
    return;
  }

  // --- Menyimpan, dari bulan terlama ke terbaru ----------------------------

  const hasil = [];
  for (const [i, item] of periksa.urut.entries()) {
    const judul = namaPeriode(item.periode);
    pesanImpor('', `Memproses ${judul} (${i + 1} dari ${periksa.urut.length})…`);

    if (item.galat) {
      hasil.push({ judul, nama: item.nama, status: 'gagal', pesan: item.galat, dibaca: 0, baru: 0, sudah_ada: 0, perlu_diperiksa: 0 });
      continue;
    }

    try {
      const isi = await kirim('unggah', item.berkas);
      hasil.push({
        judul,
        nama: item.nama,
        status: isi.status ?? 'selesai',
        dibaca: isi.ringkasan?.total ?? 0,
        baru: isi.ringkasan?.baru ?? 0,
        sudah_ada: isi.ringkasan?.sudah_ada ?? 0,
        perlu_diperiksa: isi.ringkasan?.perlu_diperiksa ?? 0,
      });
    } catch (error) {
      hasil.push({ judul, nama: item.nama, status: 'gagal', pesan: error.message, dibaca: 0, baru: 0, sudah_ada: 0, perlu_diperiksa: 0 });
    }
  }

  pesanImpor('', '');
  gambarHasil(hasil, periksa.rentang, await jumlahTersimpan());
  await muatRiwayatImpor();
  if (typeof sesudah === 'function') await sesudah();
}

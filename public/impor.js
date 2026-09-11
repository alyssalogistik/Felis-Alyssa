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
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (error) {
    kotak.innerHTML = kosong(error.message);
  }
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

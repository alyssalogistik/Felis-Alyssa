// Halaman Audit Data Mekari.
//
// Modul ini tidak pernah menyatakan dobel bayar, dan itu bukan sekadar pilihan
// kata. Nama di deskripsi Mekari sering ditulis berbeda antar-invoice, dan satu
// barang yang sama bisa sah ditagihkan dua kali untuk dua kaki pengiriman.
// Menyimpulkan duplikat di layar ini akan membuat orang menahan pembayaran yang
// sebenarnya sah — jadi yang ditampilkan hanya kemiripannya beserta alasannya,
// dan yang memutuskan manusia.

import { aman, ambil, el, kosong, rupiah, formatTanggalPolos } from './bantuan.js';

const BATAS = 50;

const LABEL_STATUS = {
  BELUM: 'Belum diperiksa',
  WAJAR: 'Wajar',
  PERLU_TINDAK_LANJUT: 'Perlu tindak lanjut',
  TERKONFIRMASI_DUPLIKAT: 'Terkonfirmasi duplikat',
};

const LABEL_ENTITAS = {
  PT_ALYSSA_AUTO_LOGISTIK: 'PT Alyssa Auto Logistik',
  CV_ALYSSA_TRANS_UTAMA: 'CV Alyssa Trans Utama',
};

/**
 * Potret filter saat pencarian dijalankan.
 *
 * Isian formulir bisa berubah tanpa daftar ikut dimuat ulang. Membaca isian
 * langsung saat memuat halaman berikutnya akan menyambung hasil dari dua filter
 * berbeda ke dalam satu daftar, tanpa gejala apa pun.
 */
let berlaku = { entitas: '', status: 'BELUM' };
let dimuat = 0;
let total = 0;

function pesan(id, teks, jenis = 'gagal') {
  const kotak = el(id);
  if (!kotak) return;
  if (!teks) {
    kotak.hidden = true;
    kotak.textContent = '';
    return;
  }
  kotak.hidden = false;
  kotak.className = `pesan ${jenis}`;
  kotak.textContent = teks;
}

// --- Ringkasan ---------------------------------------------------------------

export async function muatRingkasanMekari() {
  const entitas = el('filter-entitas-mekari')?.value ?? '';
  try {
    const r = await ambil(`/mekari/ringkasan?entitas=${encodeURIComponent(entitas)}`);
    // Kartu rupiah ditandai supaya boleh memakai dua kolom. "Rp 667.200.000"
    // tidak muat di kolom selebar kartu jumlah, dan angka yang terpotong di
    // tengah terbaca sebagai dua angka berbeda sekilas pandang.
    const kartu = [
      [r.transaksi.toLocaleString('id-ID'), 'Transaksi', false],
      [rupiah.format(r.nilai), 'Total nilai', true],
      [r.supplier.toLocaleString('id-ID'), 'Supplier', false],
      [r.produk.toLocaleString('id-ID'), 'Produk', false],
      [r.temuan.toLocaleString('id-ID'), 'Potensi duplikasi', false],
      [r.invoice.toLocaleString('id-ID'), 'Invoice', false],
      [rupiah.format(r.nilai_berisiko), 'Nilai berisiko', true],
      [r.belum_diperiksa.toLocaleString('id-ID'), 'Belum diperiksa', false],
    ];
    el('ringkasan-mekari').innerHTML = kartu
      .map(([nilai, label, lebar]) => `
        <div class="angka-kartu${lebar ? ' kartu-rupiah' : ''}">
          <b>${aman(nilai)}</b>
          <small>${aman(label)}</small>
        </div>`)
      .join('');
  } catch (error) {
    el('ringkasan-mekari').innerHTML = kosong(error.message);
  }
}

// --- Daftar temuan -----------------------------------------------------------

/** Baris alasan: `Supplier sama ✓ | Produk sama ✓ | Invoice berbeda ⚠`. */
function barisAlasan(alasan) {
  if (!Array.isArray(alasan) || alasan.length === 0) return '';
  const tanda = { sama: '✓', beda: '⚠', mirip: '⚠', netral: '=' };
  return alasan
    .map((a) => `<span class="alasan alasan-${aman(a.status)}">${aman(a.label)} ${tanda[a.status] ?? ''}</span>`)
    .join('<span class="alasan-pisah">|</span>');
}

/** Satu sisi perbandingan berdampingan. */
function sisi(b, lawan) {
  if (!b) return '<div class="banding-sisi">Baris tidak ditemukan.</div>';
  const beda = (nilai, pembanding) => (String(nilai ?? '') === String(pembanding ?? '') ? '' : ' beda');
  return `
    <div class="banding-sisi">
      <div class="banding-baris"><span>Baris</span><b>#${aman(b.baris_sumber)}</b></div>
      <div class="banding-baris${beda(b.tanggal, lawan?.tanggal)}"><span>Tanggal</span><b>${aman(formatTanggalPolos(b.tanggal))}</b></div>
      <div class="banding-baris${beda(b.no_invoice, lawan?.no_invoice)}"><span>Invoice</span><b>${aman(b.no_invoice ?? '-')}</b></div>
      <div class="banding-baris${beda(b.supplier, lawan?.supplier)}"><span>Supplier</span><b>${aman(b.supplier ?? '-')}</b></div>
      <div class="banding-baris${beda(b.produk, lawan?.produk)}"><span>Produk</span><b>${aman(b.produk ?? '-')}</b></div>
      <div class="banding-baris${beda(b.kuantitas, lawan?.kuantitas)}"><span>Kuantitas</span><b>${aman(b.kuantitas)}</b></div>
      <div class="banding-baris${beda(b.harga, lawan?.harga)}"><span>Harga satuan</span><b>${aman(rupiah.format(b.harga ?? 0))}</b></div>
      <div class="banding-baris${beda(b.jumlah, lawan?.jumlah)}"><span>Jumlah tagihan</span><b>${aman(rupiah.format(b.jumlah ?? 0))}</b></div>
      <div class="banding-keterangan">${aman(b.keterangan ?? '')}</div>
    </div>`;
}

function kartuTemuan(t) {
  const status = t.status ?? 'BELUM';
  return `
    <details class="lipat temuan" data-kunci="${aman(t.kunci_stabil)}">
      <summary>
        <span class="temuan-skor">Skor ${aman(t.skor)}</span>
        <span class="temuan-nilai">${aman(rupiah.format(t.nilai_berisiko ?? 0))}</span>
        <span class="lencana st-${aman(status)}">${aman(LABEL_STATUS[status] ?? status)}</span>
        <span class="temuan-judul">${aman(t.a?.supplier ?? '')} &middot; baris #${aman(t.a?.baris_sumber ?? '?')} vs #${aman(t.b?.baris_sumber ?? '?')}
          <span class="temuan-petunjuk">&nbsp; Ketuk untuk membandingkan</span>
        </span>
      </summary>

      <p class="temuan-alasan">${barisAlasan(t.alasan)}</p>

      <div class="banding">
        ${sisi(t.a, t.b)}
        ${sisi(t.b, t.a)}
      </div>

      <div class="temuan-kendali">
        <label>Hasil pemeriksaan
          <select class="pilih-status">
            ${Object.entries(LABEL_STATUS)
              .map(([kode, label]) =>
                `<option value="${aman(kode)}"${kode === status ? ' selected' : ''}>${aman(label)}</option>`)
              .join('')}
          </select>
        </label>
        <label>Catatan
          <input class="catatan-periksa" type="text" value="${aman(t.catatan ?? '')}"
                 placeholder="Alasan keputusan ini" autocomplete="off">
        </label>
        <button type="button" class="tombol-lembut simpan-periksa">Simpan hasil</button>
        <p class="pesan hasil-periksa" hidden></p>
      </div>
    </details>`;
}

async function muatHalamanTemuan({ lanjut = false } = {}) {
  if (!lanjut) {
    berlaku = {
      entitas: el('filter-entitas-mekari')?.value ?? '',
      status: el('filter-status-mekari')?.value ?? '',
    };
    dimuat = 0;
    el('daftar-temuan-mekari').innerHTML = '';
  }

  pesan('pesan-temuan-mekari', '');
  try {
    const kueri = new URLSearchParams({ batas: String(BATAS), mulai: String(dimuat) });
    if (berlaku.entitas) kueri.set('entitas', berlaku.entitas);
    if (berlaku.status) kueri.set('status', berlaku.status);

    const hasil = await ambil(`/mekari/temuan?${kueri}`);
    total = hasil.total;
    dimuat += hasil.data.length;

    if (dimuat === 0) {
      // Nihil hasil TIDAK PERNAH dinyatakan sebagai "tidak ada duplikasi".
      // Mesin hanya membandingkan yang berbagi identitas; sepasang tagihan
      // ganda yang deskripsinya ditulis sama sekali berbeda tidak akan muncul
      // di sini, dan menyimpulkan bersih akan menghentikan pemeriksaan yang
      // seharusnya jalan terus.
      el('daftar-temuan-mekari').innerHTML = kosong(
        'Tidak ada pasangan yang melewati ambang skor pada filter ini. ' +
        'Itu bukan berarti datanya pasti bersih — turunkan ambang skor, atau ' +
        'ganti filter status, untuk melihat kemiripan yang lebih lemah.'
      );
    } else {
      el('daftar-temuan-mekari').insertAdjacentHTML(
        'beforeend',
        hasil.data.map(kartuTemuan).join('')
      );
    }

    el('muat-temuan-mekari').hidden = dimuat >= total;
    el('muat-temuan-mekari').textContent = `Muat lebih banyak (${dimuat} dari ${total})`;
  } catch (error) {
    pesan('pesan-temuan-mekari', error.message);
  }
}

// --- Riwayat impor -----------------------------------------------------------

async function muatRiwayatMekari() {
  try {
    const { data } = await ambil('/mekari/impor');
    el('riwayat-mekari').innerHTML = data.length > 0
      ? `<table class="tabel">
           <thead><tr><th>Berkas</th><th>Perusahaan</th><th class="angka-kolom">Baris</th><th class="angka-kolom">Baru</th></tr></thead>
           <tbody>${data.map((i) => `
             <tr>
               <td class="keterangan-sel">${aman(i.nama_berkas)}</td>
               <td>${aman(LABEL_ENTITAS[i.entitas] ?? i.entitas)}</td>
               <td class="angka-kolom">${aman(i.jumlah_baris)}</td>
               <td class="angka-kolom">${aman(i.jumlah_baru)}</td>
             </tr>`).join('')}
           </tbody>
         </table>`
      : kosong('Belum ada impor.');
  } catch (error) {
    el('riwayat-mekari').innerHTML = kosong(error.message);
  }
}

// --- Unggah ------------------------------------------------------------------

async function unggahMekari(berkas, entitas) {
  const respons = await fetch('/api/mekari/unggah', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Nama-Berkas': encodeURIComponent(berkas.name),
      'X-Entitas': encodeURIComponent(entitas),
    },
    body: berkas,
  });
  const isi = await respons.json().catch(() => ({}));
  if (!respons.ok) throw new Error(isi.pesan ?? `Gagal (HTTP ${respons.status}).`);
  return isi;
}

// --- Muat halaman ------------------------------------------------------------

export function muatMekari() {
  muatRingkasanMekari();
  muatRiwayatMekari();
  muatHalamanTemuan();
}

export function pasangKendaliMekari() {
  const pilihEntitas = el('entitas-mekari');
  const masukan = el('berkas-mekari');

  // Kotak berkas terkunci sampai perusahaannya dipilih. Menolak sesudah
  // berkasnya telanjur dipilih membuat langkah itu terasa seperti galat,
  // bukan bagian alurnya.
  pilihEntitas?.addEventListener('change', () => {
    masukan.disabled = pilihEntitas.value === '';
    el('status-mekari').textContent = pilihEntitas.value === ''
      ? 'Pilih perusahaan dulu'
      : 'Belum ada file';
  });

  masukan?.addEventListener('change', async () => {
    const berkas = masukan.files?.[0];
    if (!berkas) return;

    const entitas = pilihEntitas.value;
    if (entitas === '') {
      pesan('pesan-mekari', 'Pilih perusahaan dulu sebelum mengunggah.');
      masukan.value = '';
      return;
    }

    el('status-mekari').textContent = `Memproses ${berkas.name}…`;
    el('status-mekari').classList.add('terisi');
    pesan('pesan-mekari', '');

    try {
      const hasil = await unggahMekari(berkas, entitas);
      const r = hasil.ringkasan;
      const catatan = [
        `${r.total} baris dibaca`,
        `${r.baru} baru`,
        `${r.sudah_ada} sudah ada`,
        `${hasil.audit?.temuan ?? 0} potensi duplikasi`,
      ];
      if (hasil.pernah_diunggah) {
        catatan.push('berkas dengan isi sama pernah diunggah sebelumnya');
      }
      el('status-mekari').textContent = `${berkas.name} — ${catatan.join(', ')}`;
      pesan('pesan-mekari', `Selesai untuk ${hasil.entitas_label}.`, 'berhasil');

      muatRingkasanMekari();
      muatRiwayatMekari();
      muatHalamanTemuan();
    } catch (error) {
      el('status-mekari').textContent = 'Gagal';
      pesan('pesan-mekari', error.message);
    } finally {
      masukan.value = '';
    }
  });

  el('filter-entitas-mekari')?.addEventListener('change', () => {
    muatRingkasanMekari();
    muatHalamanTemuan();
  });

  el('filter-status-mekari')?.addEventListener('change', () => muatHalamanTemuan());

  el('muat-temuan-mekari')?.addEventListener('click', () => muatHalamanTemuan({ lanjut: true }));

  el('hitung-mekari')?.addEventListener('click', async () => {
    const entitas = el('filter-entitas-mekari')?.value ?? '';
    if (entitas === '') {
      // Menghitung ulang menulis ulang seluruh temuan satu perusahaan, jadi
      // perusahaannya harus disebut. "Semua" di sini akan menyentuh dua
      // perusahaan sekaligus dari satu klik yang tampak sempit.
      pesan('pesan-temuan-mekari', 'Pilih satu perusahaan dulu di Ringkasan sebelum menghitung ulang.');
      return;
    }
    const ambang = Number(el('ambang-mekari')?.value) || 6;
    pesan('pesan-temuan-mekari', 'Menghitung ulang…', 'berhasil');
    try {
      const hasil = await ambil('/mekari/hitung', {
        method: 'POST',
        body: JSON.stringify({ entitas, ambang }),
      });
      pesan(
        'pesan-temuan-mekari',
        `${hasil.temuan} potensi duplikasi dari ${hasil.baris} baris ` +
        `(${hasil.diperiksa} pasangan diperiksa, ambang skor ${hasil.ambang}).`,
        'berhasil'
      );
      muatRingkasanMekari();
      muatHalamanTemuan();
    } catch (error) {
      pesan('pesan-temuan-mekari', error.message);
    }
  });

  // Satu pendengar untuk seluruh daftar: kartunya dibuat ulang tiap pemuatan,
  // jadi pendengar per tombol akan hilang bersama kartunya.
  el('daftar-temuan-mekari')?.addEventListener('click', async (peristiwa) => {
    const tombol = peristiwa.target.closest('.simpan-periksa');
    if (!tombol) return;

    const kartu = tombol.closest('.temuan');
    const kunci = kartu?.dataset.kunci;
    if (!kunci) return;

    const kotak = kartu.querySelector('.hasil-periksa');
    tombol.disabled = true;
    try {
      await ambil(`/mekari/periksa/${encodeURIComponent(kunci)}`, {
        method: 'PUT',
        body: JSON.stringify({
          status: kartu.querySelector('.pilih-status').value,
          catatan: kartu.querySelector('.catatan-periksa').value.trim() || null,
        }),
      });
      kotak.hidden = false;
      kotak.className = 'pesan berhasil hasil-periksa';
      kotak.textContent = 'Hasil pemeriksaan tersimpan.';
      muatRingkasanMekari();
    } catch (error) {
      kotak.hidden = false;
      kotak.className = 'pesan gagal hasil-periksa';
      kotak.textContent = error.message;
    } finally {
      tombol.disabled = false;
    }
  });
}

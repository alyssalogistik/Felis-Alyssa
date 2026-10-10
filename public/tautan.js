// Mengikat transaksi bank terpilih ke supplier di alyssa-dev.
//
// Menempel DI ATAS halaman Cari Pembayaran Supplier, tidak masuk ke jalur
// pencariannya. cariBayaran(), kriteriaBerlaku, pelipatan tampilan, blok PEND,
// ringkasan, laporan PDF, dan ekspor tidak diubah satu baris pun — modul ini
// hanya membaca kotak centang yang sudah tergambar lalu mengisi lencana.
//
// Nama supplier TIDAK PERNAH menjadi identitas. Yang disimpan supplier_id dari
// alyssa-dev, diketik atau dipilih manusia. Saran boleh salah; yang tersimpan
// tidak boleh.

import { ambil, el, aman, rupiah } from './bantuan.js';
import { cariPemetaan, PANJANG_KETIK_MINIMAL } from '/cocok-nama.js';

const LABEL_ENTITAS = {
  PT_ALYSSA_AUTO_LOGISTIK: 'PT Alyssa Auto Logistik',
  CV_ALYSSA_TRANS_UTAMA: 'CV Alyssa Trans Utama',
};

const LENCANA = {
  siap: ['siap', 'Siap ditarik alyssa-dev'],
  ditarik: ['ditarik', 'Sudah ditarik alyssa-dev'],
  perlu_koreksi_hilir: ['koreksi', 'Menunggu koreksi diakui alyssa-dev'],
  dibatalkan: ['batal', 'Tautan dibatalkan'],
};

let terpilih = new Set();

// Entitas transaksi yang sedang dipilih. Dipakai menyaring ingatan supplier:
// PT dan CV membayar sebagian supplier yang sama dari rekening yang berbeda,
// jadi ingatan yang menyeberang akan mengisi rekening tujuan perusahaan lain.
let entitasAktif = null;

// Isian supplier di formulir berasal dari pengisian otomatis, bukan ketikan?
//
// Inilah yang memisahkan "boleh ditimpa" dari "jangan disentuh". Yang DIKETIK
// manusia tidak pernah ditimpa oleh saran — orang yang sedang menyalin
// supplier_id dari layar sebelah lalu mencentang baris berikutnya akan melihat
// ketikannya lenyap, dan yang tersimpan menjadi supplier yang tidak pernah
// dipilihnya.
let diisiOtomatis = false;

/** Ingatan pemetaan untuk kotak ketik-cari. Ditarik sekali, lalu disaring di layar. */
let cachePemetaan = null;

const kotakPilih = () => [...document.querySelectorAll('.pilih-transaksi')];

function perbaruiHitungan() {
  const kotak = el('tautan-terpilih');
  if (!kotak) return;
  kotak.textContent = terpilih.size === 0
    ? 'Belum ada transaksi dipilih.'
    : `${terpilih.size} transaksi dipilih.`;
  const tombol = el('tautan-simpan');
  if (tombol) tombol.disabled = terpilih.size === 0;
}

/** Mengisi lencana status pada baris yang sedang tergambar. */
async function gambarLencana() {
  const sel = [...document.querySelectorAll('[data-supplier-untuk]')];
  const id = sel.map((s) => s.dataset.supplierUntuk).filter((x) => x !== '');
  if (id.length === 0) return;

  let data = [];
  try {
    ({ data } = await ambil(`/tautan?transaksi_id=${encodeURIComponent(id.join(','))}`));
  } catch {
    // Lencana adalah pemanis. Gagal memuatnya tidak boleh membuat tabel
    // transaksi — yang dipakai memutuskan pembayaran — ikut tampak rusak.
    return;
  }

  const peta = new Map((data ?? []).map((t) => [t.transaksi_id, t]));
  for (const kolom of sel) {
    const t = peta.get(kolom.dataset.supplierUntuk);
    if (!t || t.status === 'dibatalkan') { kolom.innerHTML = ''; continue; }
    const [kelas, judul] = LENCANA[t.status] ?? ['siap', t.status];
    kolom.innerHTML =
      `<span class="lencana-tautan lencana-${aman(kelas)}" title="${aman(judul)}">${aman(t.supplier_nama)}</span>`;
  }
}

/** Saran supplier untuk SATU transaksi; dipakai saat tepat satu dipilih. */
async function muatSaran() {
  const kotak = el('tautan-saran');
  if (!kotak) return;

  if (terpilih.size !== 1) {
    entitasAktif = null;
    kotak.innerHTML = terpilih.size === 0
      ? ''
      : '<p class="keterangan-panel">Pengisian otomatis hanya berjalan bila satu transaksi dipilih. '
        + 'Beberapa transaksi sekaligus tetap bisa ditautkan ke supplier yang sama.</p>';
    return;
  }

  const satu = [...terpilih][0];
  let hasil;
  try {
    hasil = await ambil(`/tautan/saran?transaksi_id=${encodeURIComponent(satu)}`);
  } catch (galat) {
    kotak.innerHTML = `<p class="kosong">${aman(galat.message)}</p>`;
    return;
  }

  entitasAktif = hasil.transaksi?.entitas ?? null;

  if (!hasil.kelayakan?.ok) {
    kotak.innerHTML = `<p class="kosong">${aman(hasil.kelayakan?.pesan ?? 'Tidak bisa ditautkan.')}</p>`;
    return;
  }

  if (hasil.kembar_sudah_ditaut?.length) {
    kotak.innerHTML =
      '<p class="kosong">Salinan transaksi ini dari cetakan lain sudah ditautkan. '
      + 'Satu transfer hanya boleh dibayarkan sekali.</p>';
    return;
  }

  // Konflik tidak memblokir pekerjaan: yang hilang hanya sarannya. Memblokir
  // akan membuat orang mencari jalan pintas, dan jalan pintas di sini berarti
  // salah supplier.
  if (hasil.konflik) {
    kotak.innerHTML = `
      <p class="peringatan-konflik">⚠ Nama ini terpetakan ke lebih dari satu supplier.
      Pilih sendiri yang benar — jangan ditebak.</p>
      ${daftarKandidat(hasil.kandidat)}`;
    return;
  }

  if (hasil.saran) {
    const terisi = isiOtomatis(hasil.saran);
    kotak.innerHTML = `
      <p class="keterangan-panel">${terisi
        ? '✓ Terisi otomatis dari pemetaan yang pernah Anda simpan. '
          + '<b>Belum ada yang tersimpan</b> &mdash; periksa supplier_id-nya, lalu tekan Simpan Tautan.'
        : 'Pernah dipetakan ke supplier ini. Isian di bawah tidak diubah karena sudah Anda ketik sendiri; '
          + 'tekan tombolnya kalau ingin memakai yang ini.'}</p>
      ${daftarKandidat([hasil.saran])}`;
    return;
  }

  kotak.innerHTML =
    '<p class="keterangan-panel">Belum pernah dipetakan. Isi supplier_id dan nama dari alyssa-dev di bawah '
    + '&mdash; setelah tersimpan sekali, transaksi berikutnya atas nama yang sama akan terisi sendiri.</p>';
}

/**
 * Menaruh satu kandidat ke formulir. SATU-SATUNYA tempat ketiga kotak itu
 * diisi dari pemetaan, baik oleh pengisian otomatis maupun oleh klik manusia.
 *
 * Nomor rekening hanya ditimpa bila pemetaannya benar-benar punya. Pemetaan
 * tanpa nomor rekening berarti "tidak diketahui", bukan "kosongkan yang sudah
 * diketik" — dan mengosongkannya diam-diam membuat nomor yang benar hilang
 * tepat sebelum disimpan.
 */
function pakaiKandidat(k) {
  el('tautan-supplier-id').value = k.supplier_id ?? '';
  el('tautan-supplier-nama').value = k.supplier_nama ?? '';
  if (k.no_rekening_tujuan) el('tautan-rekening').value = k.no_rekening_tujuan;
  tutupKetik();
  // Ditandai SESUDAH nilainya ditaruh: menyetelnya lewat .value tidak memicu
  // peristiwa 'input', jadi penanda ketikan manusia di bawah tidak ikut jalan.
  diisiOtomatis = true;
}

/**
 * Mengisi formulir sendiri bila isinya memang boleh ditimpa.
 *
 * TIDAK PERNAH ikut menyimpan. Yang berpindah hanya isi kotak; tombol Simpan
 * Tautan tetap harus ditekan manusia, dan supplier_id-nya terlihat di layar
 * sebelum itu. Nama boleh menyarankan; yang mengikat tetap id yang dilihat
 * dan disetujui orangnya.
 */
function isiOtomatis(k) {
  const id = el('tautan-supplier-id');
  const nama = el('tautan-supplier-nama');
  if (!id || !nama) return false;

  const kosong = id.value.trim() === '' && nama.value.trim() === '';
  if (!kosong && !diisiOtomatis) return false;

  pakaiKandidat(k);
  return true;
}

/**
 * @param {boolean} sebutEntitas Menuliskan perusahaannya pada tiap tombol.
 *
 * Dipakai daftar ketik-cari, yang bisa memuat beberapa perusahaan sekaligus.
 * Tanpa itu, dua supplier_id yang berbeda tampil dengan nama yang sama persis
 * dan tidak ada apa pun di layar yang membedakannya — padahal yang satu
 * rekening PT dan yang satu rekening CV. Daftar saran tidak memerlukannya:
 * seluruh isinya memang sudah seentitas dengan transaksi yang dipilih.
 */
function daftarKandidat(kandidat, sebutEntitas = false) {
  return `<div class="kandidat-supplier">${kandidat.map((k) => `
    <button type="button" class="tombol-lembut pakai-kandidat"
            data-id="${aman(k.supplier_id)}" data-nama="${aman(k.supplier_nama)}"
            data-rekening="${aman(k.no_rekening_tujuan ?? '')}">
      ${aman(k.supplier_nama)} <small>${aman(k.supplier_id)}</small>${sebutEntitas
        ? ` <small>${aman(LABEL_ENTITAS[k.entitas] ?? k.entitas ?? '')}</small>`
        : ''}
    </button>`).join('')}</div>`;
}

// ---------------------------------------------------------------------------
// Ketik beberapa huruf, supplier yang pernah ditautkan muncul
//
// Pelengkap pengisian otomatis, untuk dua keadaan yang tidak terjangkau
// olehnya: keterangan bank yang menulis namanya berbeda sama sekali, dan
// transaksi yang memang belum pernah dipetakan atas nama itu.
//
// Daftarnya ingatan, BUKAN master supplier. Felis tidak punya master supplier
// dan tidak pernah membuat id sendiri; yang muncul di sini hanya supplier yang
// sudah pernah ditautkan manusia dari halaman ini.
// ---------------------------------------------------------------------------

function tutupKetik() {
  const kotak = el('tautan-ketik');
  if (!kotak) return;
  kotak.innerHTML = '';
  kotak.hidden = true;
}

/**
 * Ingatan pemetaan, ditarik sekali lalu disaring di layar.
 *
 * Satu permintaan per huruf akan membuat kotak ini berkedip mengikuti jaringan
 * dan menampilkan hasil ketikan yang sudah lewat. Daftarnya kecil dan berubah
 * hanya saat ada pengikatan baru, jadi menyimpannya di memori halaman aman —
 * dan simpanan itu dibuang setiap kali ada tautan baru tersimpan.
 */
async function daftarPemetaan() {
  if (cachePemetaan) return cachePemetaan;
  try {
    const { data } = await ambil('/tautan/pemetaan');
    cachePemetaan = data ?? [];
  } catch {
    // Ingatan adalah pemanis. Gagal memuatnya tidak boleh membuat panel yang
    // dipakai mengikat pembayaran ikut tampak rusak; kotaknya cuma tidak
    // memunculkan apa-apa, dan ketikan manualnya tetap jalan.
    cachePemetaan = [];
  }
  return cachePemetaan;
}

async function ketikCari() {
  const kotak = el('tautan-ketik');
  const isian = el('tautan-supplier-nama');
  if (!kotak || !isian) return;

  const kata = isian.value;
  if (kata.trim().length < PANJANG_KETIK_MINIMAL) { tutupKetik(); return; }

  const semua = await daftarPemetaan();
  // Disaring ke entitas transaksi yang sedang dipilih bila diketahui. Selama
  // belum ada yang dipilih, daftarnya dibiarkan utuh — menyaringnya ke PT
  // secara diam-diam akan menyembunyikan pemetaan CV dari layar yang sama.
  const sePerusahaan = entitasAktif ? semua.filter((p) => p.entitas === entitasAktif) : semua;
  const hasil = cariPemetaan(sePerusahaan, kata);

  // Isian bisa sudah berubah lagi selagi daftarnya ditunggu.
  if (isian.value !== kata) return;

  if (hasil.length === 0) { tutupKetik(); return; }

  kotak.hidden = false;
  kotak.innerHTML = `
    <p class="keterangan-panel">Pernah ditautkan sebelumnya &mdash; pilih untuk mengisi formulir:</p>
    ${daftarKandidat(hasil, !entitasAktif)}`;
}

// Bentuk canonical supplier_profiles.id milik alyssa-dev. Dicek juga di sini
// supaya salah ketik ketahuan sebelum permintaan berangkat; yang benar-benar
// menahan tetap server dan CHECK di database, karena layar bisa dilewati.
const POLA_SUPPLIER_ID = /^[0-9a-f]{8}$/;

async function simpanTautan() {
  // Huruf besar diseragamkan, tidak ditolak: alyssa-dev membandingkan persis,
  // tetapi 'A3F91B2C' dan 'a3f91b2c' tidak terlihat bedanya saat disalin dari
  // layar sebelah.
  const supplierId = el('tautan-supplier-id').value.trim().toLowerCase();
  const supplierNama = el('tautan-supplier-nama').value.trim();
  const rekening = el('tautan-rekening').value.trim();
  const pesan = el('tautan-pesan');

  if (supplierId === '' || supplierNama === '') {
    pesan.className = 'pesan gagal';
    pesan.textContent = 'supplier_id dan nama supplier dari alyssa-dev wajib diisi.';
    pesan.hidden = false;
    return;
  }

  if (!POLA_SUPPLIER_ID.test(supplierId)) {
    pesan.className = 'pesan gagal';
    pesan.textContent = 'supplier_id harus tepat 8 digit heksadesimal dari Master Supplier '
      + 'alyssa-dev, misalnya a3f91b2c. Salin dari kolom id, jangan diketik ulang.';
    pesan.hidden = false;
    return;
  }

  // Yang dikirim adalah bentuk yang sudah seragam, dan kotaknya ikut
  // diperbarui supaya yang dilihat orang sama dengan yang tersimpan.
  el('tautan-supplier-id').value = supplierId;

  const tombol = el('tautan-simpan');
  tombol.disabled = true;
  pesan.className = 'pesan';
  pesan.textContent = 'Menyimpan…';
  pesan.hidden = false;

  const berhasil = [];
  const gagal = [];
  for (const id of terpilih) {
    try {
      await ambil('/tautan', {
        method: 'POST',
        body: JSON.stringify({
          transaksi_id: id,
          supplier_id: supplierId,
          supplier_nama: supplierNama,
          no_rekening_tujuan: rekening || null,
        }),
      });
      berhasil.push(id);
    } catch (galat) {
      gagal.push(`${id.slice(0, 8)}: ${galat.message}`);
    }
  }

  pesan.className = `pesan ${gagal.length === 0 ? 'berhasil' : 'gagal'}`;
  pesan.textContent = gagal.length === 0
    ? `${berhasil.length} transaksi ditautkan ke ${supplierNama}.`
    : `${berhasil.length} berhasil, ${gagal.length} gagal — ${gagal.join(' | ')}`;

  // Pengikatan yang berhasil menambah satu pemetaan baru, jadi ingatan yang
  // tersimpan di halaman sudah basi. Dibuang, bukan ditambahi: yang tersimpan
  // di database adalah yang benar, dan menebak isinya dari sini akan membuat
  // daftar di layar berbeda dari yang dipakai server menyusun saran.
  if (berhasil.length > 0) cachePemetaan = null;
  tutupKetik();

  terpilih = new Set();
  for (const k of kotakPilih()) k.checked = false;
  perbaruiHitungan();
  await gambarLencana();
  await muatSaran();
  await muatRingkasanSiap();
  // Panel "Siap Ditautkan" disegarkan supaya baris yang baru saja tertaut
  // hilang dari daftar yang masih bebas. Tanpa ini, baris yang sudah terikat
  // tetap tampak sebagai pilihan dan percobaan kedua ditolak 409 tanpa sebab
  // yang terlihat di layar.
  if (berhasil.length > 0 && el('panel-siap-tautkan')) await muatSiapTautkan();
  tombol.disabled = terpilih.size === 0;
}

/** Berapa yang menunggu ditarik alyssa-dev. */
async function muatRingkasanSiap() {
  const kotak = el('tautan-ringkasan');
  if (!kotak) return;
  try {
    const { data } = await ambil('/tautan?status=siap');
    const nilai = (data ?? []).reduce((s, t) => s + Number(t.nominal ?? 0), 0);
    kotak.innerHTML = (data ?? []).length === 0
      ? '<p class="keterangan-panel">Tidak ada yang menunggu ditarik.</p>'
      : `<div class="ringkas">
           <div><b>${(data ?? []).length}</b><small>Siap ditarik</small></div>
           <div class="r-debit"><b>${aman(rupiah.format(nilai))}</b><small>Nilai</small></div>
         </div>`;
  } catch {
    kotak.innerHTML = '';
  }
}

export function pasangKendaliTautan() {
  const panel = el('panel-tautan');
  if (!panel) return;

  // Delegasi: barisnya digambar ulang setiap pencarian, jadi pendengar yang
  // dipasang pada tiap kotak akan hilang bersama barisnya.
  document.addEventListener('change', (ev) => {
    const kotak = ev.target.closest?.('.pilih-transaksi');
    if (!kotak) return;
    const kosongSebelumnya = terpilih.size === 0;
    if (kotak.checked) terpilih.add(kotak.value);
    else terpilih.delete(kotak.value);

    // Panelnya dibuka sendiri pada pilihan PERTAMA. Tanpa ini, mencentang baris
    // saat panel tertutup tampak tidak melakukan apa-apa — isian dan tombolnya
    // ada di dalam panel, jadi orangnya mencentang lalu menunggu sesuatu yang
    // sudah terjadi tetapi tidak terlihat.
    if (kosongSebelumnya && terpilih.size > 0) panel.open = true;

    perbaruiHitungan();
    muatSaran();
  });

  document.addEventListener('click', (ev) => {
    const tombol = ev.target.closest?.('.pakai-kandidat');
    if (!tombol) return;
    pakaiKandidat({
      supplier_id: tombol.dataset.id,
      supplier_nama: tombol.dataset.nama,
      no_rekening_tujuan: tombol.dataset.rekening || null,
    });
  });

  // Ketikan manusia melepas penanda pengisian otomatis, sehingga saran
  // berikutnya tidak menimpanya. Dipasang pada ketiga kotak, bukan hanya pada
  // nama: orang yang menempel supplier_id lebih dulu juga sedang mengetik.
  for (const nama of ['tautan-supplier-id', 'tautan-supplier-nama', 'tautan-rekening']) {
    el(nama)?.addEventListener('input', () => { diisiOtomatis = false; });
  }

  el('tautan-supplier-nama')?.addEventListener('input', ketikCari);
  el('tautan-supplier-nama')?.addEventListener('focus', ketikCari);
  el('tautan-supplier-nama')?.addEventListener('blur', () => {
    // Ditunda sesaat: klik pada kandidat terjadi SESUDAH blur, dan menutup
    // daftarnya seketika membuat tombolnya hilang sebelum kliknya sampai.
    setTimeout(tutupKetik, 150);
  });

  el('tautan-simpan')?.addEventListener('click', simpanTautan);

  // Setiap tabel selesai digambar, lencananya diisi ulang dan pilihan yang
  // menunjuk baris yang sudah tidak ada dibuang.
  document.addEventListener('bayaran-digambar', async () => {
    const ada = new Set(kotakPilih().map((k) => k.value));
    terpilih = new Set([...terpilih].filter((id) => ada.has(id)));
    for (const k of kotakPilih()) k.checked = terpilih.has(k.value);
    perbaruiHitungan();
    await gambarLencana();
  });

  perbaruiHitungan();
  muatRingkasanSiap();
}

// ---------------------------------------------------------------------------
// Riwayat pembayaran per supplier, DIPISAH per entitas
//
// PT dan CV membayar sebagian supplier yang sama dari rekening yang berbeda.
// Menggabungkan totalnya membuat kewajiban satu perusahaan tampak terbayar
// oleh uang perusahaan lain, tanpa satu pun galat.
// ---------------------------------------------------------------------------

const LABEL_STATUS = {
  BELUM_DITETAPKAN: ['netral', 'Kewajiban belum ditetapkan'],
  BELUM_BAYAR: ['koreksi', 'Belum dibayar'],
  SEBAGIAN: ['koreksi', 'Sebagian'],
  LUNAS: ['ditarik', 'Lunas'],
  LEBIH_BAYAR: ['batal', 'Lebih bayar'],
};

const rp = (n) => (n === null || n === undefined ? '-' : rupiah.format(Number(n)));

function kartuSupplier(s) {
  const [kelas, teks] = LABEL_STATUS[s.status] ?? ['netral', s.status];
  return `
    <article class="kartu-supplier" data-supplier="${aman(s.supplier_id)}" data-entitas="${aman(s.entitas)}">
      <header>
        <b>${aman(s.supplier_nama)}</b>
        <code>${aman(s.supplier_id)}</code>
        <span class="lencana-tautan lencana-${aman(kelas)}">${aman(teks)}</span>
      </header>
      <p class="keterangan-panel">${aman(LABEL_ENTITAS[s.entitas] ?? s.entitas)}</p>
      ${s.ejaan_tidak_seragam
        ? '<p class="peringatan-konflik">⚠ supplier_id ini tersimpan dengan lebih dari satu ejaan nama. '
          + 'Totalnya tetap benar karena dikelompokkan dari id, tetapi ejaannya perlu dirapikan.</p>'
        : ''}
      <div class="ringkas">
        <div><b>${s.jumlah_pembayaran}</b><small>Pembayaran</small></div>
        <div class="r-debit"><b>${aman(rp(s.total_dibayar))}</b><small>Total dibayar</small></div>
        <div><b>${aman(rp(s.kewajiban))}</b><small>Kewajiban</small></div>
        <div><b>${aman(rp(s.sisa))}</b><small>Sisa</small></div>
      </div>
      <button type="button" class="tombol-lembut lihat-rincian">Lihat rincian pembayaran</button>
      <div class="rincian-supplier"></div>
    </article>`;
}

function barisRincian(r) {
  return `
    <tr>
      <td>${aman(r.tanggal ?? '-')}</td>
      <td class="keterangan-sel">
        ${aman(r.keterangan_bank ?? '-')}
        ${r.penerima_berbeda
          ? ' <span class="tanda" title="Nama penerima transfer berbeda dari nama supplier administrasi">⚠ penerima berbeda</span>'
          : ''}
      </td>
      <td class="angka-kolom keluar">${aman(rp(r.nominal))}</td>
      <td>${aman(r.status)}</td>
      <td class="keterangan-sel">${r.alokasi_manual ? aman(r.alokasi_manual) : '<span class="nol">-</span>'}</td>
    </tr>`;
}

async function muatRincian(kartu) {
  const kotak = kartu.querySelector('.rincian-supplier');
  kotak.innerHTML = '<p class="kosong">Memuat…</p>';

  const parameter = new URLSearchParams({ entitas: kartu.dataset.entitas });
  let hasil;
  try {
    hasil = await ambil(`/tautan/supplier/${encodeURIComponent(kartu.dataset.supplier)}?${parameter}`);
  } catch (galat) {
    kotak.innerHTML = `<p class="kosong">${aman(galat.message)}</p>`;
    return;
  }

  kotak.innerHTML = `
    <div class="gulir-mendatar">
      <table class="tabel">
        <thead><tr>
          <th>Tanggal</th><th>Penerima / Keterangan Bank</th>
          <th class="angka-kolom">Nominal</th><th>Status</th><th>Alokasi</th>
        </tr></thead>
        <tbody>${hasil.data.map(barisRincian).join('')}</tbody>
      </table>
    </div>`;
}

export async function muatRiwayatSupplier() {
  const kotak = el('riwayat-isi');
  if (!kotak) return;

  kotak.innerHTML = '<p class="kosong">Memuat…</p>';
  const parameter = new URLSearchParams();
  const entitas = el('riwayat-entitas')?.value ?? '';
  const cari = (el('riwayat-cari')?.value ?? '').trim().replace(/\s+/g, ' ');
  if (entitas) parameter.set('entitas', entitas);
  if (cari) parameter.set('cari', cari);

  let hasil;
  try {
    hasil = await ambil(`/tautan/supplier?${parameter}`);
  } catch (galat) {
    kotak.innerHTML = `<p class="kosong">${aman(galat.message)}</p>`;
    return;
  }

  if ((hasil.data ?? []).length === 0) {
    // Nihil hasil TIDAK pernah dinyatakan sebagai "belum dibayar" — sama
    // seperti di pencarian transaksi. Yang kosong di sini adalah tautannya,
    // bukan pembayarannya.
    kotak.innerHTML =
      '<p class="kosong">Belum ada transaksi yang ditautkan ke supplier pada filter ini. '
      + 'Ini bukan berarti supplier belum dibayar — pembayarannya mungkin ada di rekening koran '
      + 'tetapi belum dihubungkan ke supplier_id.</p>';
    return;
  }

  kotak.innerHTML = hasil.data.map(kartuSupplier).join('');
}

export function pasangKendaliRiwayat() {
  if (!el('panel-riwayat-supplier')) return;

  el('riwayat-muat')?.addEventListener('click', muatRiwayatSupplier);
  el('riwayat-cari')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); muatRiwayatSupplier(); }
  });
  el('riwayat-entitas')?.addEventListener('change', muatRiwayatSupplier);

  // Delegasi: kartunya digambar ulang setiap pemuatan.
  document.addEventListener('click', (ev) => {
    const tombol = ev.target.closest?.('.lihat-rincian');
    if (!tombol) return;
    muatRincian(tombol.closest('.kartu-supplier'));
  });
}


// ---------------------------------------------------------------------------
// Panel "Transaksi Siap Ditautkan"
//
// Daftar transaksi yang MASIH BEBAS. Barisnya memakai kelas `.pilih-transaksi`
// yang sama dengan tabel Audit, sehingga pendengar pemilihan yang sudah ada
// langsung menanganinya — tidak ada jalur pemilihan kedua yang bisa menyimpang
// dari yang pertama.
// ---------------------------------------------------------------------------

/** Nomor giliran, supaya pemuatan lama tidak menimpa hasil pemuatan baru. */
let giliranSiap = 0;

function barisSiap(t) {
  return `
    <tr>
      <td class="pilih-kolom">
        <input type="checkbox" class="pilih-transaksi" value="${aman(t.bank_transaction_id)}"
               aria-label="Pilih transaksi ${aman(t.tanggal ?? '')}">
      </td>
      <td>${aman(t.tanggal ?? '')}</td>
      <td>${t.penerima ? aman(t.penerima) : '<span class="nol">-</span>'}</td>
      <td class="keterangan-sel">${aman(t.keterangan ?? '')}</td>
      <td class="angka-kolom keluar">${aman(rupiah.format(Number(t.nominal ?? 0)))}</td>
      <td class="keterangan-sel"><code>${aman(t.bank_transaction_id)}</code></td>
    </tr>`;
}

export async function muatSiapTautkan() {
  const kotak = el('siap-hasil');
  const pesan = el('siap-pesan');
  if (!kotak) return;

  const giliran = ++giliranSiap;
  const kata = el('siap-cari')?.value.trim().replace(/\s+/g, ' ') ?? '';

  pesan.className = 'pesan';
  pesan.textContent = 'Memuat…';
  pesan.hidden = false;

  let hasil;
  try {
    const parameter = new URLSearchParams({ batas: '50' });
    if (kata !== '') parameter.set('cari', kata);
    hasil = await ambil(`/tautan/siap-tautkan?${parameter}`);
  } catch (galat) {
    if (giliran !== giliranSiap) return;
    pesan.className = 'pesan gagal';
    pesan.textContent = galat.message;
    return;
  }
  if (giliran !== giliranSiap) return;

  pesan.hidden = true;

  if (hasil.jumlah === 0) {
    // Nihil di sini TIDAK berarti semua sudah dibayar atau sudah tertaut —
    // bisa juga transaksinya belum bertanggal (PEND) atau kata kuncinya tidak
    // cocok. Menyebutnya "semua sudah ditautkan" akan menyesatkan.
    kotak.innerHTML = kata === ''
      ? '<p class="kosong">Tidak ada transaksi PT yang bertanggal dan masih bebas ditautkan. '
        + 'Transaksi yang belum dibukukan BCA (PEND) tidak ikut di sini — unggah mutasi '
        + 'terbaru di <a href="#/rekonsiliasi">Rekon Bank</a> supaya tanggalnya terisi.</p>'
      : `<p class="kosong">Tidak ada transaksi bebas yang cocok dengan "${aman(kata)}". `
        + 'Coba kata kunci lain, atau nama penerima di rekening koran mungkin berbeda '
        + 'dari nama resmi suppliernya.</p>';
    return;
  }

  kotak.innerHTML = `
    <p class="keterangan-panel">
      ${hasil.jumlah} transaksi bebas${hasil.tercapai_batas ? ' (dibatasi 50 teratas, persempit dengan kata kunci)' : ''}
      &mdash; ${aman(hasil.entitas_label)}
    </p>
    <table class="tabel">
      <thead>
        <tr>
          <th class="pilih-kolom"><span class="sr-only">Pilih</span></th>
          <th>Tanggal</th>
          <th>Penerima (dari keterangan)</th>
          <th>Keterangan Transaksi</th>
          <th class="angka-kolom">Nominal</th>
          <th>bank_transaction_id</th>
        </tr>
      </thead>
      <tbody>${hasil.data.map(barisSiap).join('')}</tbody>
    </table>`;

  // Pilihan yang menunjuk baris yang sudah tidak ada dibuang, dan yang masih
  // ada dikembalikan centangnya — persis perlakuan tabel Audit.
  document.dispatchEvent(new CustomEvent('bayaran-digambar'));
}

export function pasangKendaliSiapTautkan() {
  if (!el('panel-siap-tautkan')) return;

  el('siap-muat')?.addEventListener('click', muatSiapTautkan);
  el('siap-cari')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); muatSiapTautkan(); }
  });
}

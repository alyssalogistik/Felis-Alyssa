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

const LENCANA = {
  siap: ['siap', 'Siap ditarik alyssa-dev'],
  ditarik: ['ditarik', 'Sudah ditarik alyssa-dev'],
  perlu_koreksi_hilir: ['koreksi', 'Menunggu koreksi diakui alyssa-dev'],
  dibatalkan: ['batal', 'Tautan dibatalkan'],
};

let terpilih = new Set();

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
    kotak.innerHTML = terpilih.size === 0
      ? ''
      : '<p class="keterangan-panel">Saran otomatis hanya muncul bila satu transaksi dipilih. '
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
    kotak.innerHTML = `
      <p class="keterangan-panel">Saran dari pemetaan sebelumnya:</p>
      ${daftarKandidat([hasil.saran])}`;
    return;
  }

  kotak.innerHTML =
    '<p class="keterangan-panel">Belum pernah dipetakan. Isi supplier_id dan nama dari alyssa-dev di bawah.</p>';
}

function daftarKandidat(kandidat) {
  return `<div class="kandidat-supplier">${kandidat.map((k) => `
    <button type="button" class="tombol-lembut pakai-kandidat"
            data-id="${aman(k.supplier_id)}" data-nama="${aman(k.supplier_nama)}">
      ${aman(k.supplier_nama)} <small>${aman(k.supplier_id)}</small>
    </button>`).join('')}</div>`;
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
    el('tautan-supplier-id').value = tombol.dataset.id;
    el('tautan-supplier-nama').value = tombol.dataset.nama;
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

const LABEL_ENTITAS = {
  PT_ALYSSA_AUTO_LOGISTIK: 'PT Alyssa Auto Logistik',
  CV_ALYSSA_TRANS_UTAMA: 'CV Alyssa Trans Utama',
};

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

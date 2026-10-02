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

async function simpanTautan() {
  const supplierId = el('tautan-supplier-id').value.trim();
  const supplierNama = el('tautan-supplier-nama').value.trim();
  const rekening = el('tautan-rekening').value.trim();
  const pesan = el('tautan-pesan');

  if (supplierId === '' || supplierNama === '') {
    pesan.className = 'pesan gagal';
    pesan.textContent = 'supplier_id dan nama supplier dari alyssa-dev wajib diisi.';
    pesan.hidden = false;
    return;
  }

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

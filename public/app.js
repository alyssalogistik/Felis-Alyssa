// Aplikasi satu halaman tanpa framework: cukup kecil untuk tidak butuh build step,
// jadi Railway bisa langsung menyajikannya apa adanya.

import {
  aman, ambil, el, kosong, pasangan, rupiah, tanggal, formatTanggalPolos,
} from './bantuan.js';
import { pasangKendaliRekonsiliasi, muatRekonsiliasi } from './rekonsiliasi.js';
import { pasangKendaliAudit, muatAudit } from './audit.js';

const STATUS = {
  baru:       'Baru',
  dispatched: 'Dispatched',
  on_trip:    'On-Trip',
  selesai:    'Selesai',
  batal:      'Batal',
};

function kartuPesanan(p) {
  const unit = [p.unit_merk, p.unit_tipe].filter(Boolean).join(' ');
  return `
    <a class="baris" href="#/detail/${aman(p.id)}">
      <div class="baris-atas">
        <span class="baris-unit">🚛 ${aman(unit || 'Unit')}</span>
        <span class="lencana l-${aman(p.status)}">${aman(STATUS[p.status] ?? p.status)}</span>
      </div>
      <div class="baris-info">${aman(p.customer_nama)} &middot; ${aman(p.asal)} → ${aman(p.tujuan)}</div>
      <div class="baris-resi">${aman(p.no_resi)}</div>
    </a>`;
}

// --- Beranda ----------------------------------------------------------------

async function muatBeranda() {
  const jam = new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hour12: false });
  const h = Number(jam);
  el('salam').textContent =
    `Selamat ${h < 11 ? 'pagi' : h < 15 ? 'siang' : h < 19 ? 'sore' : 'malam'}, Admin`;

  try {
    const ringkasan = await ambil('/ringkasan');
    const kartu = [['total', 'Total', ringkasan.total]];
    for (const [kunci, label] of Object.entries(STATUS)) {
      kartu.push([kunci, label, ringkasan.per_status[kunci] ?? 0]);
    }
    el('ringkasan').innerHTML = kartu.map(([kunci, label, nilai]) => `
      <div class="angka-kartu">
        <b class="w-${kunci}">${nilai}</b>
        <small>${label}</small>
      </div>`).join('');
  } catch (error) {
    el('ringkasan').innerHTML = kosong(error.message);
  }

  try {
    const { data } = await ambil('/pesanan?status=on_trip&batas=5');
    const aktif = data.length > 0 ? data : (await ambil('/pesanan?batas=5')).data;
    el('aktif').innerHTML = aktif.length > 0
      ? aktif.map(kartuPesanan).join('')
      : kosong('Belum ada pesanan. Tap tombol + untuk membuat yang pertama.');
  } catch (error) {
    el('aktif').innerHTML = kosong(error.message);
  }
}

// --- Daftar pesanan ---------------------------------------------------------

let konteks = { status: '', cari: '', mulai: 0 };

async function muatPesanan(tambah = false) {
  if (!tambah) {
    konteks.mulai = 0;
    el('daftar-pesanan').innerHTML = kosong('Memuat…');

    el('saring').innerHTML = [['', 'Semua'], ...Object.entries(STATUS)]
      .map(([nilai, label]) =>
        `<button data-status="${nilai}" aria-pressed="${konteks.status === nilai}">${label}</button>`)
      .join('');
  }

  const parameter = new URLSearchParams({ batas: '20', mulai: String(konteks.mulai) });
  if (konteks.status) parameter.set('status', konteks.status);
  if (konteks.cari) parameter.set('cari', konteks.cari);

  try {
    const { data, total } = await ambil(`/pesanan?${parameter}`);
    const html = data.map(kartuPesanan).join('');

    if (tambah) {
      el('daftar-pesanan').insertAdjacentHTML('beforeend', html);
    } else {
      el('daftar-pesanan').innerHTML = html || kosong(
        konteks.cari ? `Tidak ada hasil untuk "${konteks.cari}".` : 'Belum ada pesanan.'
      );
    }

    konteks.mulai += data.length;
    el('muat-lagi').hidden = konteks.mulai >= total;
    el('judul-pesanan').textContent = `Pesanan (${total})`;
  } catch (error) {
    el('daftar-pesanan').innerHTML = kosong(error.message);
  }
}

// --- Detail -----------------------------------------------------------------

async function muatDetail(id) {
  el('isi-detail').innerHTML = kosong('Memuat…');
  try {
    const p = await ambil(`/pesanan/${id}`);
    const unit = [p.unit_merk, p.unit_tipe, p.unit_tahun].filter(Boolean).join(' ');
    const jejak = [...(p.tracking_event ?? [])]
      .sort((a, b) => new Date(b.dibuat_pada) - new Date(a.dibuat_pada));

    el('isi-detail').innerHTML = `
      <h2 class="judul">${aman(unit)}
        <span class="lencana l-${aman(p.status)}">${aman(STATUS[p.status] ?? p.status)}</span>
      </h2>

      <div class="panel">
        <h3>Pengiriman</h3>
        <dl>
          ${pasangan('No. Resi', p.no_resi)}
          ${pasangan('Asal', p.asal)}
          ${pasangan('Tujuan', p.tujuan)}
          ${pasangan('Harga', p.harga ? rupiah.format(p.harga) : null)}
          ${pasangan('Dibuat', tanggal.format(new Date(p.dibuat_pada)))}
        </dl>
      </div>

      <div class="panel">
        <h3>Customer</h3>
        <dl>
          ${pasangan('Nama', p.customer_nama)}
          ${pasangan('Telepon', p.customer_telepon)}
          ${pasangan('Penerima', p.penerima_nama)}
          ${pasangan('Telepon penerima', p.penerima_telepon)}
        </dl>
      </div>

      <div class="panel">
        <h3>Unit</h3>
        <dl>
          ${pasangan('Merk', p.unit_merk)}
          ${pasangan('Tipe', p.unit_tipe)}
          ${pasangan('Nomor polisi', p.unit_nopol)}
          ${pasangan('Tahun', p.unit_tahun)}
          ${pasangan('Warna', p.unit_warna)}
        </dl>
      </div>

      ${p.catatan ? `<div class="panel"><h3>Catatan</h3><p>${aman(p.catatan)}</p></div>` : ''}

      <div class="panel">
        <h3>Ubah Status</h3>
        <select id="ubah-status">
          ${Object.entries(STATUS).map(([n, l]) =>
            `<option value="${n}"${n === p.status ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <p id="pesan-status" class="pesan" hidden></p>
      </div>

      <div class="panel">
        <h3>Riwayat</h3>
        <ul class="jejak">
          ${jejak.length > 0 ? jejak.map((t) => `
            <li>
              ${aman(STATUS[t.status] ?? t.status)}${t.lokasi ? ` — ${aman(t.lokasi)}` : ''}
              <time>${aman(tanggal.format(new Date(t.dibuat_pada)))}</time>
            </li>`).join('') : '<li>Belum ada riwayat.</li>'}
        </ul>
      </div>`;

    el('ubah-status').addEventListener('change', async (peristiwa) => {
      const kotak = el('pesan-status');
      const pilihan = peristiwa.target;
      pilihan.disabled = true;
      try {
        await ambil(`/pesanan/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ status: pilihan.value }),
        });
        kotak.className = 'pesan berhasil';
        kotak.textContent = 'Status tersimpan.';
        kotak.hidden = false;
        setTimeout(() => muatDetail(id), 700);
      } catch (error) {
        kotak.className = 'pesan gagal';
        kotak.textContent = error.message;
        kotak.hidden = false;
        pilihan.disabled = false;
      }
    });
  } catch (error) {
    el('isi-detail').innerHTML = kosong(error.message);
  }
}

// --- Trip -------------------------------------------------------------------

async function muatTrip() {
  el('daftar-trip').innerHTML = kosong('Memuat…');
  try {
    const { data } = await ambil('/trip');
    el('daftar-trip').innerHTML = data.length > 0 ? data.map((t) => `
      <div class="baris">
        <div class="baris-atas">
          <span class="baris-unit">🚢 ${aman(t.kapal?.nama ?? t.kode_trip)}</span>
          <span class="lencana l-dispatched">${aman(t.status)}</span>
        </div>
        <div class="baris-info">${aman(t.asal)} → ${aman(t.tujuan)}${
          t.driver?.nama ? ` &middot; ${aman(t.driver.nama)}` : ''}</div>
        <div class="baris-resi">${aman(t.kode_trip)}</div>
      </div>`).join('') : kosong('Belum ada trip.');
  } catch (error) {
    el('daftar-trip').innerHTML = kosong(error.message);
  }
}

// --- Router -----------------------------------------------------------------

const TAMPILAN = ['beranda', 'pesanan', 'detail', 'buat', 'lacak', 'trip', 'rekonsiliasi', 'audit'];

function arahkan() {
  const [jalur, kueri] = (location.hash.slice(2) || 'beranda').split('?');
  const bagian = jalur.split('/');
  const nama = TAMPILAN.includes(bagian[0]) ? bagian[0] : 'beranda';

  for (const t of TAMPILAN) el(`tampilan-${t}`).hidden = t !== nama;
  for (const tautan of document.querySelectorAll('.bawah a')) {
    const cocok = tautan.dataset.nav === nama || (nama === 'detail' && tautan.dataset.nav === 'pesanan');
    if (cocok) tautan.setAttribute('aria-current', 'page');
    else tautan.removeAttribute('aria-current');
  }
  window.scrollTo(0, 0);

  if (nama === 'beranda') muatBeranda();
  else if (nama === 'rekonsiliasi') muatRekonsiliasi();
  else if (nama === 'audit') muatAudit();
  else if (nama === 'trip') muatTrip();
  else if (nama === 'detail') muatDetail(bagian[1]);
  else if (nama === 'pesanan') {
    const parameter = new URLSearchParams(kueri ?? '');
    konteks.status = parameter.get('status') ?? '';
    konteks.cari = parameter.get('cari') ?? '';
    el('input-cari').value = konteks.cari;
    muatPesanan();
  }
}

// --- Peristiwa --------------------------------------------------------------

el('form-cari').addEventListener('submit', (peristiwa) => {
  peristiwa.preventDefault();
  const kata = el('input-cari').value.trim();
  location.hash = `#/pesanan?cari=${encodeURIComponent(kata)}`;
  if (location.hash.startsWith('#/pesanan')) arahkan();
});

el('saring').addEventListener('click', (peristiwa) => {
  const tombol = peristiwa.target.closest('button');
  if (!tombol) return;
  konteks.status = tombol.dataset.status;
  for (const lain of el('saring').querySelectorAll('button')) {
    lain.setAttribute('aria-pressed', String(lain === tombol));
  }
  konteks.mulai = 0;
  muatPesanan();
});

el('muat-lagi').addEventListener('click', () => muatPesanan(true));

el('form-buat').addEventListener('submit', async (peristiwa) => {
  peristiwa.preventDefault();
  const formulir = peristiwa.target;
  const kotak = el('pesan-buat');
  const tombol = formulir.querySelector('button[type="submit"]');

  const isian = Object.fromEntries(
    [...new FormData(formulir)].filter(([, nilai]) => String(nilai).trim() !== '')
  );
  if (isian.harga) isian.harga = Number(isian.harga);
  if (isian.unit_tahun) isian.unit_tahun = Number(isian.unit_tahun);

  tombol.disabled = true;
  try {
    const dibuat = await ambil('/pesanan', { method: 'POST', body: JSON.stringify(isian) });
    formulir.reset();
    kotak.className = 'pesan berhasil';
    kotak.textContent = `Tersimpan. Nomor resi: ${dibuat.no_resi}`;
    kotak.hidden = false;
    setTimeout(() => { location.hash = `#/detail/${dibuat.id}`; }, 900);
  } catch (error) {
    kotak.className = 'pesan gagal';
    kotak.textContent = error.message;
    kotak.hidden = false;
  } finally {
    tombol.disabled = false;
  }
});

el('form-lacak').addEventListener('submit', async (peristiwa) => {
  peristiwa.preventDefault();
  const resi = new FormData(peristiwa.target).get('no_resi').trim();
  const hasil = el('hasil-lacak');
  hasil.innerHTML = kosong('Mencari…');

  try {
    const p = await ambil(`/lacak/${encodeURIComponent(resi)}`);
    hasil.innerHTML = `
      <div class="panel">
        <h3>${aman(p.no_resi)}</h3>
        <dl>
          ${pasangan('Customer', p.customer_nama)}
          ${pasangan('Unit', [p.unit_merk, p.unit_tipe].filter(Boolean).join(' '))}
          ${pasangan('Rute', `${p.asal} → ${p.tujuan}`)}
          ${pasangan('Status', STATUS[p.status] ?? p.status)}
        </dl>
      </div>
      <div class="panel">
        <h3>Riwayat</h3>
        <ul class="jejak">
          ${p.tracking_event.map((t) => `
            <li>${aman(STATUS[t.status] ?? t.status)}${t.lokasi ? ` — ${aman(t.lokasi)}` : ''}
              <time>${aman(tanggal.format(new Date(t.dibuat_pada)))}</time>
            </li>`).join('') || '<li>Belum ada riwayat.</li>'}
        </ul>
      </div>`;
  } catch (error) {
    hasil.innerHTML = kosong(error.message);
  }
});

pasangKendaliRekonsiliasi();
pasangKendaliAudit();

window.addEventListener('hashchange', arahkan);
arahkan();

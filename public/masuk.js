// Gerbang masuk dan keadaan sesi di peramban.
//
// Penyembunyian layar di sini adalah kenyamanan, BUKAN pengamanan. Auditor
// yang mengetik #/pengguna langsung tetap sampai ke halamannya; yang menahan
// adalah server, yang menjawab 403 untuk setiap endpoint di baliknya. Kalau
// suatu saat berkas ini dihapus seluruhnya, data tetap tidak bocor.

import { aman, ambil, el } from './bantuan.js';

/** Halaman yang tetap boleh dilihat tanpa masuk. Dipakai customer. */
const PUBLIK = ['lacak'];

let sesi = { pengguna: null, proteksi: true };

export function penggunaSekarang() {
  return sesi.pengguna;
}

export function proteksiMenyala() {
  return sesi.proteksi;
}

/** Owner? Dipakai hanya untuk memutuskan menu mana yang ditampilkan. */
export function adalahOwner() {
  return sesi.pengguna?.peran === 'OWNER';
}

export async function periksaSesi() {
  try {
    sesi = await ambil('/auth/saya');
  } catch (error) {
    if (error.status === 401 || error.status === 403) sesi = { pengguna: null, proteksi: true };
    else throw error;
  }
  return sesi;
}

/** Halaman yang sedang dituju boleh dibuka tanpa masuk? */
export function jalurPublik() {
  const jalur = (location.hash.slice(2) || 'beranda').split('?')[0].split('/')[0];
  return PUBLIK.includes(jalur);
}

/**
 * Menampilkan atau menyembunyikan gerbang.
 *
 * Mengembalikan true bila aplikasinya boleh jalan.
 */
export function terapkanGerbang() {
  const bolehMasuk = sesi.pengguna !== null || sesi.proteksi === false;
  const publik = jalurPublik();

  el('gerbang').hidden = bolehMasuk || publik;
  document.body.classList.toggle('terkunci', !bolehMasuk && !publik);

  // Menu Owner. Sekali lagi: ini tampilan, penegakannya di server.
  for (const tautan of document.querySelectorAll('[data-owner]')) {
    tautan.hidden = !adalahOwner();
  }

  const kotak = el('sesi-pengguna');
  if (kotak) {
    kotak.hidden = sesi.pengguna === null;
    if (sesi.pengguna) {
      kotak.innerHTML =
        `<span>${aman(sesi.pengguna.nama)} &middot; ${aman(sesi.pengguna.peran)}</span>` +
        '<button type="button" id="tombol-keluar" class="tombol-kecil">Keluar</button>';
    }
  }

  el('wajib-ganti').hidden = !(sesi.pengguna?.harus_ganti_password === true);

  return bolehMasuk || publik;
}

function pesanGerbang(teks, jenis = 'gagal') {
  const kotak = el('pesan-masuk');
  kotak.hidden = !teks;
  kotak.className = `pesan ${jenis}`;
  kotak.textContent = teks ?? '';
}

export function pasangKendaliMasuk(sesudahMasuk) {
  el('form-masuk')?.addEventListener('submit', async (peristiwa) => {
    peristiwa.preventDefault();
    const tombol = el('form-masuk').querySelector('button[type=submit]');
    tombol.disabled = true;
    pesanGerbang('');

    try {
      const hasil = await ambil('/auth/masuk', {
        method: 'POST',
        body: JSON.stringify({
          email: el('masuk-email').value.trim(),
          password: el('masuk-password').value,
        }),
      });
      sesi = { pengguna: hasil.pengguna, proteksi: true };
      el('masuk-password').value = '';
      terapkanGerbang();
      await sesudahMasuk();
    } catch (error) {
      pesanGerbang(error.message);
    } finally {
      tombol.disabled = false;
    }
  });

  el('form-ganti-password')?.addEventListener('submit', async (peristiwa) => {
    peristiwa.preventDefault();
    const kotak = el('pesan-ganti');
    kotak.hidden = true;

    const baru = el('ganti-baru').value;
    if (baru !== el('ganti-ulang').value) {
      kotak.hidden = false;
      kotak.className = 'pesan gagal';
      kotak.textContent = 'Konfirmasi password tidak sama.';
      return;
    }

    try {
      await ambil('/auth/ganti-password', {
        method: 'POST',
        body: JSON.stringify({ password_lama: el('ganti-lama').value, password_baru: baru }),
      });
      for (const id of ['ganti-lama', 'ganti-baru', 'ganti-ulang']) el(id).value = '';
      await periksaSesi();
      terapkanGerbang();
      await sesudahMasuk();
    } catch (error) {
      kotak.hidden = false;
      kotak.className = 'pesan gagal';
      kotak.textContent = error.message;
    }
  });

  // Tombol keluar dibuat ulang tiap kali gerbang digambar, jadi pendengarnya
  // dipasang di induknya.
  el('sesi-pengguna')?.addEventListener('click', async (peristiwa) => {
    if (!peristiwa.target.closest('#tombol-keluar')) return;
    await ambil('/auth/keluar', { method: 'POST' }).catch(() => {});
    sesi = { pengguna: null, proteksi: true };
    terapkanGerbang();
    location.hash = '#/beranda';
  });
}

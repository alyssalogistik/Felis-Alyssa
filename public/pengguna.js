// Halaman Pengguna & Akses. Hanya berguna untuk Owner; auditor yang membukanya
// melihat halaman kosong karena setiap endpoint di baliknya menjawab 403.

import { aman, ambil, el, kosong, tanggal } from './bantuan.js';

const LABEL_ENTITAS = {
  PT_ALYSSA_AUTO_LOGISTIK: 'PT',
  CV_ALYSSA_TRANS_UTAMA: 'CV',
};

function pesan(teks, jenis = 'gagal') {
  const kotak = el('pesan-pengguna');
  kotak.hidden = !teks;
  kotak.className = `pesan ${jenis}`;
  kotak.textContent = teks ?? '';
}

function waktu(iso) {
  return iso ? tanggal.format(new Date(iso)) : '—';
}

function entitasTeks(daftar) {
  const kode = (daftar ?? []).map((e) => LABEL_ENTITAS[e] ?? e);
  if (kode.length === 0) return '—';
  return kode.length === 2 ? 'PT + CV' : kode.join(', ');
}

function baris(p) {
  // Owner utama tidak boleh punya tombol nonaktifkan maupun hapus sama sekali.
  // Server dan database juga menolaknya, tapi tombol yang selalu gagal hanya
  // membuat orang mengira aplikasinya rusak.
  const aksi = p.owner_utama
    ? '<span class="redup">Terkunci</span>'
    : `
      <button type="button" class="tombol-kecil" data-ubah="${aman(p.id)}">Edit Akses</button>
      <button type="button" class="tombol-kecil" data-status="${aman(p.id)}"
        data-ke="${p.status === 'AKTIF' ? 'NONAKTIF' : 'AKTIF'}">
        ${p.status === 'AKTIF' ? 'Nonaktifkan' : 'Aktifkan'}
      </button>
      <button type="button" class="tombol-kecil" data-sandi="${aman(p.id)}">Reset Password</button>
      <button type="button" class="tombol-kecil bahaya" data-hapus="${aman(p.id)}"
        data-email="${aman(p.email)}">Hapus</button>`;

  return `
    <tr>
      <td>${aman(p.nama)}${p.owner_utama ? ' <span class="lencana st-WAJAR">utama</span>' : ''}</td>
      <td>${aman(p.email)}</td>
      <td>${aman(p.peran)}${p.peran === 'AUDITOR' && p.boleh_periksa ? ' <small>+periksa</small>' : ''}</td>
      <td>${aman(entitasTeks(p.entitas_akses))}</td>
      <td><span class="lencana st-${p.status === 'AKTIF' ? 'WAJAR' : 'TERKONFIRMASI_DUPLIKAT'}">
        ${p.status === 'AKTIF' ? 'Aktif' : 'Dinonaktifkan'}</span></td>
      <td>${aman(waktu(p.terakhir_login))}</td>
      <td>${aman(waktu(p.dibuat_pada))}</td>
      <td class="aksi-pengguna">${aksi}</td>
    </tr>`;
}

export async function muatPengguna() {
  pesan('');
  try {
    const { data } = await ambil('/pengguna');
    el('tabel-pengguna').innerHTML = data.length > 0
      ? `<table class="tabel">
           <thead><tr>
             <th>Nama</th><th>Email</th><th>Role</th><th>Entitas</th>
             <th>Status</th><th>Terakhir Login</th><th>Dibuat</th><th>Aksi</th>
           </tr></thead>
           <tbody>${data.map(baris).join('')}</tbody>
         </table>`
      : kosong('Belum ada pengguna.');
  } catch (error) {
    el('tabel-pengguna').innerHTML = kosong(error.message);
  }
}

function bacaFormulir(formulir) {
  const data = new FormData(formulir);
  const entitas = data.getAll('entitas_akses');
  return {
    nama: data.get('nama')?.trim(),
    email: data.get('email')?.trim(),
    peran: data.get('peran'),
    entitas_akses: entitas,
    boleh_periksa: data.get('boleh_periksa') === 'on',
    password: data.get('password') || undefined,
  };
}

export function pasangKendaliPengguna() {
  el('form-pengguna')?.addEventListener('submit', async (peristiwa) => {
    peristiwa.preventDefault();
    const formulir = peristiwa.target;
    const isi = bacaFormulir(formulir);
    const id = formulir.dataset.ubah;

    try {
      if (id) {
        await ambil(`/pengguna/${encodeURIComponent(id)}`, {
          method: 'PUT',
          body: JSON.stringify(isi),
        });
        pesan('Akses tersimpan.', 'berhasil');
      } else {
        await ambil('/pengguna', { method: 'POST', body: JSON.stringify(isi) });
        pesan(
          `Akun dibuat. Berikan password awal ini ke ${isi.email} lewat jalur pribadi — ` +
          'dia wajib menggantinya saat login pertama.',
          'berhasil'
        );
      }
      formulir.reset();
      delete formulir.dataset.ubah;
      el('judul-form-pengguna').textContent = 'Tambah Pengguna';
      el('pengguna-email').disabled = false;
      el('pengguna-password').required = true;
      await muatPengguna();
    } catch (error) {
      pesan(error.message);
    }
  });

  el('tabel-pengguna')?.addEventListener('click', async (peristiwa) => {
    const tombol = peristiwa.target.closest('button');
    if (!tombol) return;

    try {
      if (tombol.dataset.status) {
        await ambil(`/pengguna/${encodeURIComponent(tombol.dataset.status)}/status`, {
          method: 'POST',
          body: JSON.stringify({ status: tombol.dataset.ke }),
        });
        pesan(
          tombol.dataset.ke === 'NONAKTIF'
            ? 'Akun dinonaktifkan. Akses berikutnya langsung ditolak.'
            : 'Akun diaktifkan kembali.',
          'berhasil'
        );
        await muatPengguna();
        return;
      }

      if (tombol.dataset.sandi) {
        const baru = prompt('Password awal baru (minimal 10 karakter):');
        if (!baru) return;
        await ambil(`/pengguna/${encodeURIComponent(tombol.dataset.sandi)}/password`, {
          method: 'POST',
          body: JSON.stringify({ password: baru }),
        });
        pesan('Password awal diganti. Dia wajib menggantinya lagi saat login berikutnya.', 'berhasil');
        return;
      }

      if (tombol.dataset.hapus) {
        // Penghapusan tidak bisa dibatalkan, jadi emailnya harus diketik ulang.
        const email = tombol.dataset.email;
        const ketik = prompt(`Hapus akun ${email}? Ketik ulang emailnya untuk memastikan:`);
        if (ketik !== email) {
          if (ketik !== null) pesan('Email tidak cocok. Penghapusan dibatalkan.');
          return;
        }
        await ambil(`/pengguna/${encodeURIComponent(tombol.dataset.hapus)}`, { method: 'DELETE' });
        pesan('Akun dihapus. Jejak auditnya tetap tersimpan lengkap.', 'berhasil');
        await muatPengguna();
        return;
      }

      if (tombol.dataset.ubah) {
        const { data } = await ambil('/pengguna');
        const p = data.find((x) => x.id === tombol.dataset.ubah);
        if (!p) return;
        const formulir = el('form-pengguna');
        formulir.dataset.ubah = p.id;
        formulir.nama.value = p.nama;
        formulir.email.value = p.email;
        formulir.peran.value = p.peran;
        formulir.boleh_periksa.checked = p.boleh_periksa;
        for (const kotak of formulir.querySelectorAll('[name=entitas_akses]')) {
          kotak.checked = (p.entitas_akses ?? []).includes(kotak.value);
        }
        el('judul-form-pengguna').textContent = `Edit Akses — ${p.nama}`;
        el('pengguna-email').disabled = true;
        el('pengguna-password').required = false;
        el('pengguna-password').value = '';
        formulir.scrollIntoView({ behavior: 'smooth' });
      }
    } catch (error) {
      pesan(error.message);
    }
  });

  el('batal-pengguna')?.addEventListener('click', () => {
    const formulir = el('form-pengguna');
    formulir.reset();
    delete formulir.dataset.ubah;
    el('judul-form-pengguna').textContent = 'Tambah Pengguna';
    el('pengguna-email').disabled = false;
    el('pengguna-password').required = true;
    pesan('');
  });
}

export async function muatJejak() {
  try {
    const { data, total } = await ambil('/jejak?batas=100');
    el('tabel-jejak').innerHTML = data.length > 0
      ? `<p class="keterangan-panel">${total} aktivitas tercatat, menampilkan ${data.length} terbaru.</p>
         <table class="tabel">
           <thead><tr><th>Waktu</th><th>Pengguna</th><th>Aksi</th><th>Entitas</th><th>Objek</th></tr></thead>
           <tbody>${data.map((j) => `
             <tr>
               <td>${aman(waktu(j.waktu))}</td>
               <td>${aman(j.pengguna_nama ?? j.pengguna_email)}<br><small>${aman(j.pengguna_email)}</small></td>
               <td>${aman(j.aksi)}</td>
               <td>${aman(LABEL_ENTITAS[j.entitas] ?? j.entitas ?? '—')}</td>
               <td class="keterangan-sel"><small>${aman(j.objek ?? '')}</small></td>
             </tr>`).join('')}
           </tbody>
         </table>`
      : kosong('Belum ada aktivitas tercatat.');
  } catch (error) {
    el('tabel-jejak').innerHTML = kosong(error.message);
  }
}

// Lapisan sesi: siapa yang meminta, dan boleh apa.
//
// Sesi dipegang server, bukan browser. Login menembak API kita, server yang
// memanggil Supabase Auth, lalu tokennya ditaruh di cookie HttpOnly.
// supabase-js tidak pernah ikut ke peramban.
//
// Alasannya dua. Pertama, project ini tanpa build step — memasukkan supabase-js
// ke halaman berarti menarik skrip pihak ketiga ke layar yang menampilkan
// angka keuangan. Kedua, supabase-js menyimpan token di localStorage, yang bisa
// dibaca JavaScript; cookie HttpOnly tidak bisa, sehingga satu celah XSS tidak
// otomatis berarti sesi tercuri.

import { createPublicClient } from '../supabase.js';
import {
  IZIN, izinDibutuhkan, memenuhi, perluSaringEntitas, rapikanJalur, aksiUntuk, detailAman,
} from './kebijakan.js';
import { entitasDiizinkan, saringanUntuk, bolehMenulis } from './entitas-akses.js';
import { bacaKuki, rangkaiKuki, hapusKuki, NAMA_AKSES, NAMA_SEGAR } from './kuki.js';

/** Cookie tanpa Secure hanya untuk pengembangan lokal tanpa HTTPS. */
const kukiAman = process.env.KUKI_TIDAK_AMAN !== '1';

const UMUR_SEGAR = 60 * 60 * 24 * 30;

const KOLOM_PROFIL =
  'id, email, nama, peran, entitas_akses, boleh_periksa, status, ' +
  'harus_ganti_password, owner_utama, terakhir_login, dibuat_pada';

/** Jalur yang tetap boleh diakses walau passwordnya wajib diganti dulu. */
const SAAT_WAJIB_GANTI = [/^\/auth\/(saya|keluar|ganti-password)$/];

export function pasangKuki(res, sesi) {
  const daftar = [
    rangkaiKuki(NAMA_AKSES, sesi.access_token, {
      maksUmur: sesi.expires_in ?? 3600,
      aman: kukiAman,
    }),
  ];
  if (sesi.refresh_token) {
    daftar.push(rangkaiKuki(NAMA_SEGAR, sesi.refresh_token, { maksUmur: UMUR_SEGAR, aman: kukiAman }));
  }
  res.append('Set-Cookie', daftar);
}

export function buangKuki(res) {
  res.append('Set-Cookie', [
    hapusKuki(NAMA_AKSES, { aman: kukiAman }),
    hapusKuki(NAMA_SEGAR, { aman: kukiAman }),
  ]);
}

/**
 * Menemukan pengguna dari cookie, memperbarui token bila perlu.
 *
 * Mengembalikan id pengguna Supabase, atau null. Tidak menyentuh peran sama
 * sekali — peran dibaca dari database di langkah berikutnya, tidak pernah
 * dari isi token.
 */
async function penggunaDariKuki(req, res, klienPublik) {
  const kuki = bacaKuki(req.get('cookie'));
  const publik = klienPublik();

  const akses = kuki[NAMA_AKSES];
  if (akses) {
    const { data, error } = await publik.auth.getUser(akses);
    if (!error && data?.user) return data.user;
  }

  const segar = kuki[NAMA_SEGAR];
  if (!segar) return null;

  const { data, error } = await publik.auth.refreshSession({ refresh_token: segar });
  if (error || !data?.session) {
    buangKuki(res);
    return null;
  }
  pasangKuki(res, data.session);
  return data.user ?? data.session.user ?? null;
}

/**
 * Apakah proteksi sudah menyala.
 *
 * Menyala sendiri begitu ada satu OWNER aktif di database. Ini yang membuat
 * urutan pemasangan aman: skema dipasang lebih dulu (aplikasi tetap terbuka
 * seperti sebelumnya), akun Owner dibuat, dan sejak saat itu seluruh halaman
 * internal langsung terkunci — tanpa env var yang bisa lupa diisi, dan tanpa
 * jendela waktu di mana Owner sendiri terkunci di luar.
 *
 * **Gagal membaca berarti menyala, bukan terbuka.** Kalau database sedang
 * bermasalah, menjawab "belum ada owner" akan membuka seluruh data keuangan
 * ke publik justru pada saat paling tidak terpantau.
 */
const cache = { aktif: false, sampai: 0 };

export async function proteksiAktif(db) {
  if (process.env.WAJIB_LOGIN === '1') return true;
  if (cache.aktif) return true; // sekali menyala tidak pernah padam
  if (Date.now() < cache.sampai) return false;

  try {
    const { count, error } = await db
      .from('profil_pengguna')
      .select('id', { count: 'exact', head: true })
      .eq('peran', 'OWNER')
      .eq('status', 'AKTIF');
    if (error) throw error;

    if ((count ?? 0) > 0) {
      cache.aktif = true;
      return true;
    }
    cache.sampai = Date.now() + 5000;
    return false;
  } catch (galat) {
    console.error('[akses] gagal memeriksa owner, proteksi dianggap menyala:', galat.message);
    return true;
  }
}

/** Hanya untuk pengujian: mengosongkan ingatan proteksi. */
export function lupakanProteksi() {
  cache.aktif = false;
  cache.sampai = 0;
}

/**
 * Menyaring entitas sebelum handler berjalan.
 *
 * Ditaruh di sini, bukan di dalam tiap endpoint, karena seluruh modul
 * rekonsiliasi dan Mekari sudah membaca `req.query.entitas`. Dengan menulis
 * ulang nilainya di depan, pembatasan PT/CV berlaku untuk dua belas titik
 * saring sekaligus tanpa satu baris pun logika rekon berubah.
 *
 * Yang paling penting: filter KOSONG milik auditor PT diubah menjadi PT.
 * Dibiarkan kosong, kueri berjalan tanpa filter dan CV ikut muncul — tanpa
 * satu pun galat.
 */
function saringEntitas(req, res, profil) {
  const izin = entitasDiizinkan(profil);

  const saringan = saringanUntuk(req.query?.entitas, izin);
  if (!saringan.ok) {
    res.status(403).json({ pesan: saringan.alasan, kode: 'entitas_tidak_diizinkan' });
    return false;
  }
  if (req.query) req.query.entitas = saringan.nilai;

  // Badan JSON dan header dipakai jalur penulisan. Keduanya diperiksa, bukan
  // ditulis ulang: menulis ulang entitas pada penyimpanan akan menghidupkan
  // kembali "entitas bawaan" yang justru dilarang modul rekonsiliasi.
  for (const diminta of [req.body?.entitas, req.get('X-Entitas')]) {
    const boleh = bolehMenulis(diminta, izin);
    if (!boleh.ok) {
      res.status(403).json({ pesan: boleh.alasan, kode: 'entitas_tidak_diizinkan' });
      return false;
    }
  }
  return true;
}

/**
 * Middleware akses untuk seluruh /api.
 *
 * Urutannya disengaja: izin ditentukan dari jalur lebih dulu, baru sesinya
 * dicari. Jalur publik tidak pernah menyentuh database sama sekali.
 */
/**
 * @param db            client service_role, untuk membaca profil
 * @param catat         pencatat jejak aktivitas
 * @param klienPublik   pembuat client anon, dipisah sebagai parameter supaya
 *                      lapisan ini bisa diuji terhadap database sungguhan
 *                      tanpa menjalankan Supabase Auth sendiri. Bawaannya
 *                      tetap client asli, jadi tidak ada jalur khusus
 *                      pengujian yang ikut hidup di produksi.
 */
export function middlewareAkses(db, catat, klienPublik = createPublicClient) {
  return async function akses(req, res, next) {
    const izin = izinDibutuhkan(req.method, req.path);
    if (izin === IZIN.PUBLIK) return next();

    if (!(await proteksiAktif(db))) {
      // Belum ada Owner: aplikasi berjalan seperti sebelum lapisan ini ada.
      req.pengguna = null;
      return next();
    }

    let pengguna;
    try {
      pengguna = await penggunaDariKuki(req, res, klienPublik);
    } catch (galat) {
      console.error('[akses] gagal memeriksa sesi:', galat.message);
      pengguna = null;
    }
    if (!pengguna) {
      return res.status(401).json({ pesan: 'Silakan masuk dulu.', kode: 'belum_masuk' });
    }

    // Peran dan status dibaca dari DATABASE pada SETIAP permintaan, tidak
    // pernah dari isi token. Ini yang membuat penonaktifan berlaku seketika:
    // kalau perannya dibaca dari token, auditor yang baru dinonaktifkan masih
    // bisa bekerja sampai tokennya kedaluwarsa — bisa satu jam penuh.
    const { data: profil, error } = await db
      .from('profil_pengguna')
      .select(KOLOM_PROFIL)
      .eq('id', pengguna.id)
      .maybeSingle();

    if (error) {
      console.error('[akses] gagal membaca profil:', error.message);
      return res.status(503).json({ pesan: 'Tidak bisa memeriksa hak akses saat ini.' });
    }

    if (!profil || profil.status !== 'AKTIF') {
      buangKuki(res);
      await catat(req, {
        aksi: 'DITOLAK',
        pengguna_id: pengguna.id,
        pengguna_email: profil?.email ?? pengguna.email ?? '-',
        pengguna_nama: profil?.nama ?? null,
        peran: profil?.peran ?? null,
        objek: 'sesi',
        detail: { jalur: rapikanJalur(req.path), sebab: profil ? 'nonaktif' : 'tanpa_profil' },
      });
      return res.status(401).json({
        pesan: profil
          ? 'Akun ini sudah dinonaktifkan. Hubungi Owner.'
          : 'Akun ini belum terdaftar di aplikasi. Hubungi Owner.',
        kode: 'akun_nonaktif',
      });
    }

    req.pengguna = profil;

    if (!memenuhi(izin, profil)) {
      await catat(req, {
        aksi: 'DITOLAK',
        objek: 'izin',
        detail: { jalur: rapikanJalur(req.path), metode: req.method, butuh: izin },
      });
      return res.status(403).json({
        pesan: 'Akun ini tidak punya izin untuk tindakan tersebut.',
        kode: 'tanpa_izin',
      });
    }

    // Password awal ditetapkan Owner, jadi Owner sempat mengetahuinya. Sampai
    // diganti, akunnya tidak boleh dipakai untuk apa pun selain menggantinya.
    if (profil.harus_ganti_password && !SAAT_WAJIB_GANTI.some((p) => p.test(rapikanJalur(req.path)))) {
      return res.status(403).json({
        pesan: 'Ganti password dulu sebelum memakai aplikasi.',
        kode: 'wajib_ganti_password',
      });
    }

    if (perluSaringEntitas(izin) && !saringEntitas(req, res, profil)) return undefined;

    catatPerubahan(req, res, catat);
    return next();
  };
}

/**
 * Mencatat setiap permintaan yang mengubah data, sesudah hasilnya diketahui.
 *
 * Dipasang di sini, bukan di dalam tiap endpoint, supaya endpoint baru yang
 * ditambahkan nanti ikut tercatat tanpa penulisnya harus ingat. Yang gagal
 * tidak dicatat sebagai perubahan — tidak ada yang berubah.
 */
function catatPerubahan(req, res, catat) {
  const aksi = aksiUntuk(req.method, req.path);
  if (!aksi) return;

  // Badan permintaan dipotret sekarang: penanganan unggahan mengganti
  // req.body dengan Buffer, dan beberapa endpoint menyuntingnya di tempat.
  const detail = detailAman(req.body);
  const berkas = req.get('X-Nama-Berkas');

  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    catat(req, {
      aksi,
      entitas: req.query?.entitas || req.body?.entitas || req.get('X-Entitas') || null,
      objek: rapikanJalur(req.path),
      objek_id: req.params?.id ?? null,
      detail: {
        metode: req.method,
        status: res.statusCode,
        ...(berkas ? { berkas } : {}),
        ...detail,
      },
    });
  });
}

// Endpoint masuk/keluar dan pengelolaan pengguna.
//
// Password tidak pernah menyentuh tabel aplikasi. Yang memeriksa dan menyimpan
// password adalah Supabase Auth; tabel `profil_pengguna` hanya memegang peran,
// akses entitas, dan status.

import { Router } from 'express';
import { createPublicClient, createAdminClient } from '../supabase.js';
import { KODE_ENTITAS } from '../rekonsiliasi/entitas.js';
import { AKSI, buatPencatat, alamatIp } from './jejak.js';
import {
  AKUN, IP, kunciAkun, kunciIp, periksa, sesudahGagal, pesanTerkunci,
} from './batas-masuk.js';
import { pasangKuki, buangKuki, proteksiAktif } from './sesi.js';

const db = createAdminClient();
const catat = buatPencatat(db);

const KOLOM_PROFIL =
  'id, email, nama, peran, entitas_akses, boleh_periksa, status, ' +
  'harus_ganti_password, owner_utama, terakhir_login, dibuat_pada';

/** Panjang minimal password. Supabase sendiri menuntut 6; ini lebih ketat. */
const PANJANG_PASSWORD = 10;

function jalur(handler) {
  return (req, res, next) => handler(req, res).catch(next);
}

const rapi = (v) => String(v ?? '').trim();

// --- Pembatasan percobaan masuk ---------------------------------------------
//
// Dua ember diperiksa bersama: per akun dan per alamat IP. Aturannya ada di
// batas-masuk.js (murni, teruji); di sini hanya penyimpanannya.
//
// Ini BERDAMPINGAN dengan pembatasan bawaan Supabase Auth, tidak
// menggantikannya. Supabase membatasi dari sisinya sendiri; lapisan ini yang
// tahu siapa yang sedang dicoba dan berapa lama harus menunggu.

/** Sesekali membuang hitungan yang sudah lewat, supaya tabelnya tidak menumpuk. */
let bersihBerikutnya = 0;
async function bersihkanSesekali() {
  if (Date.now() < bersihBerikutnya) return;
  bersihBerikutnya = Date.now() + 60 * 60 * 1000;
  // Pembangun kueri supabase-js hanya "thenable", bukan Promise penuh — ia
  // tidak punya .catch(). Memanggilnya melempar TypeError yang mengubah
  // penolakan 401 yang wajar menjadi 500 pada SETIAP percobaan masuk.
  try {
    const { error } = await db.rpc('bersihkan_percobaan_masuk');
    if (error) throw error;
  } catch (galat) {
    console.error('[batas-masuk] gagal membersihkan hitungan lama:', galat.message);
  }
}

/**
 * Isi satu ember, atau null bila embernya belum ada.
 *
 * Kegagalan membaca dianggap "belum ada", bukan "terkunci", dan itu pilihan
 * sadar. Gagal-menutup di sini berarti tabel hitungan yang bermasalah mengunci
 * SELURUH pemakai termasuk Owner, dari sebab yang sama sekali tidak ada
 * hubungannya dengan penebakan password — akibat yang jauh lebih buruk
 * daripada yang dicegahnya, dan persis keadaan yang paling sulit dipulihkan.
 *
 * Yang menahan saat itu terjadi adalah pembatasan bawaan Supabase Auth, yang
 * tetap berjalan di sisinya sendiri. Kegagalannya dicetak keras supaya tidak
 * berlalu tanpa jejak.
 */
async function emberDari(kunci) {
  const { data, error } = await db
    .from('percobaan_masuk').select('*').eq('kunci', kunci).maybeSingle();
  if (error) {
    console.error('[batas-masuk] gagal membaca hitungan percobaan:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Apakah percobaan ini harus ditolak sebelum passwordnya diperiksa.
 *
 * Diperiksa SEBELUM Supabase dihubungi: percobaan yang sudah pasti ditolak
 * tidak perlu ikut membebani penyedia identitas, dan tidak perlu memberi
 * penebak satu pun petunjuk waktu.
 */
async function terkunci(kunciList) {
  for (const kunci of kunciList) {
    const hasil = periksa(await emberDari(kunci));
    if (hasil.terkunci) return hasil;
  }
  return { terkunci: false, sisaDetik: 0 };
}

/**
 * Menaikkan hitungan kedua ember.
 *
 * Tidak pernah melempar: gagal mencatat percobaan yang memang sudah ditolak
 * tidak boleh mengubah penolakan 401 menjadi 500 — selain membingungkan,
 * bedanya memberi tahu penebak bahwa ada sesuatu yang berubah di sisi server.
 */
async function catatGagal(kunciList) {
  let kuncian = { terkunci: false, sisaDetik: 0 };
  for (const [kunci, aturan] of kunciList) {
    try {
      const baru = sesudahGagal(await emberDari(kunci), new Date(), aturan);
      const { error } = await db.from('percobaan_masuk').upsert(
        { kunci, ...baru, diubah_pada: new Date().toISOString() },
        { onConflict: 'kunci' }
      );
      if (error) throw error;

      const hasil = periksa(baru);
      if (hasil.terkunci && hasil.sisaDetik > kuncian.sisaDetik) kuncian = hasil;
    } catch (galat) {
      console.error('[batas-masuk] gagal menyimpan hitungan percobaan:', galat.message);
    }
  }
  return kuncian;
}

/**
 * Masuk yang berhasil menghapus hitungannya, supaya jatahnya penuh lagi.
 *
 * Juga tidak pernah melempar. Kalau melempar, tabel hitungan yang bermasalah
 * akan menggagalkan login yang passwordnya BENAR — mengunci semua orang.
 */
async function lupakanGagal(kunciList) {
  try {
    const { error } = await db.from('percobaan_masuk').delete().in('kunci', kunciList);
    if (error) throw error;
  } catch (galat) {
    console.error('[batas-masuk] gagal menghapus hitungan percobaan:', galat.message);
  }
}

function passwordLemah(kata) {
  if (rapi(kata).length < PANJANG_PASSWORD) {
    return `Password minimal ${PANJANG_PASSWORD} karakter.`;
  }
  return null;
}

const api = Router();

// --- Masuk, keluar, siapa saya ----------------------------------------------

api.post('/auth/masuk', jalur(async (req, res) => {
  const email = rapi(req.body?.email).toLowerCase();
  const password = String(req.body?.password ?? '');

  if (email === '' || password === '') {
    return res.status(400).json({ pesan: 'Email dan password wajib diisi.' });
  }

  await bersihkanSesekali();

  const kunciEmail = kunciAkun(email);
  const kunciAlamat = kunciIp(alamatIp(req));
  const kuncian = await terkunci([kunciEmail, kunciAlamat]);

  if (kuncian.terkunci) {
    await catat(req, {
      aksi: AKSI.LOGIN_GAGAL,
      pengguna_email: email,
      objek: 'sesi',
      detail: { sebab: 'terkunci', sisa_detik: kuncian.sisaDetik },
    });
    // Retry-After supaya klien tahu persis kapan boleh mencoba lagi, tanpa
    // harus menebak dari kalimatnya.
    res.set('Retry-After', String(kuncian.sisaDetik));
    return res.status(429).json({
      pesan: pesanTerkunci(kuncian.sisaDetik),
      kode: 'terlalu_banyak_percobaan',
      sisa_detik: kuncian.sisaDetik,
    });
  }

  const publik = createPublicClient();
  const { data, error } = await publik.auth.signInWithPassword({ email, password });

  if (error || !data?.session) {
    // Dihitung sebagai gagal APA PUN sebabnya — termasuk email yang memang
    // tidak terdaftar. Kalau hanya email terdaftar yang dihitung, penebak bisa
    // membedakan keduanya hanya dengan melihat mana yang akhirnya terkunci.
    const kuncianBaru = await catatGagal([[kunciEmail, AKUN], [kunciAlamat, IP]]);

    await catat(req, {
      aksi: AKSI.LOGIN_GAGAL,
      pengguna_email: email || '-',
      objek: 'sesi',
      detail: { sebab: error?.message ?? 'tanpa sesi', mengunci: kuncianBaru.terkunci },
    });

    // Percobaan yang MEMICU kuncian dijawab dengan kuncian itu juga, bukan
    // sekadar "password salah". Kalau tidak, orangnya baru tahu dirinya
    // terkunci pada percobaan berikutnya — dan sementara itu menyangka
    // passwordnya yang salah lalu mencoba terus.
    if (kuncianBaru.terkunci) {
      res.set('Retry-After', String(kuncianBaru.sisaDetik));
      return res.status(429).json({
        pesan: pesanTerkunci(kuncianBaru.sisaDetik),
        kode: 'terlalu_banyak_percobaan',
        sisa_detik: kuncianBaru.sisaDetik,
      });
    }

    // Pesannya sengaja tidak membedakan "email tidak ada" dari "password
    // salah". Membedakannya memberi tahu penebak bahwa sebuah email terdaftar,
    // dan itu separuh pekerjaannya.
    return res.status(401).json({ pesan: 'Email atau password salah.' });
  }

  const { data: profil } = await db
    .from('profil_pengguna')
    .select(KOLOM_PROFIL)
    .eq('id', data.user.id)
    .maybeSingle();

  if (!profil || profil.status !== 'AKTIF') {
    // Passwordnya benar, jadi ini bukan penebakan — hitungannya tidak dinaikkan.
    // Menaikkannya akan mengunci akun yang sekadar dinonaktifkan, dan membuat
    // Owner yang mengaktifkannya kembali mengira aplikasinya rusak.
    await catat(req, {
      aksi: AKSI.LOGIN_GAGAL,
      pengguna_id: data.user.id,
      pengguna_email: email,
      objek: 'sesi',
      detail: { sebab: profil ? 'nonaktif' : 'tanpa profil' },
    });
    return res.status(403).json({
      pesan: profil
        ? 'Akun ini sudah dinonaktifkan. Hubungi Owner.'
        : 'Akun ini belum terdaftar di aplikasi. Hubungi Owner.',
    });
  }

  pasangKuki(res, data.session);
  await lupakanGagal([kunciEmail, kunciAlamat]);

  await db.from('profil_pengguna')
    .update({ terakhir_login: new Date().toISOString() })
    .eq('id', profil.id);

  await catat({ ...req, pengguna: profil }, { aksi: AKSI.LOGIN, objek: 'sesi' });

  res.json({ pengguna: { ...profil, terakhir_login: new Date().toISOString() } });
}));

api.post('/auth/keluar', jalur(async (req, res) => {
  buangKuki(res);
  await catat(req, { aksi: AKSI.LOGOUT, objek: 'sesi' });
  res.json({ ok: true });
}));

api.get('/auth/saya', jalur(async (req, res) => {
  // Dipakai halaman untuk tahu harus menampilkan form masuk atau aplikasinya.
  // Saat proteksi belum menyala, dijawab apa adanya supaya layar tidak
  // menampilkan form masuk yang belum ada gunanya.
  if (!(await proteksiAktif(db))) {
    return res.json({ pengguna: null, proteksi: false });
  }
  res.json({ pengguna: req.pengguna ?? null, proteksi: true });
}));

api.post('/auth/ganti-password', jalur(async (req, res) => {
  const lama = String(req.body?.password_lama ?? '');
  const baru = String(req.body?.password_baru ?? '');

  const lemah = passwordLemah(baru);
  if (lemah) return res.status(400).json({ pesan: lemah });
  if (baru === lama) return res.status(400).json({ pesan: 'Password baru harus berbeda.' });

  // Password lama diperiksa dengan benar-benar mencoba masuk. Tanpa langkah
  // ini, siapa pun yang sempat memegang perangkat yang masih login bisa
  // mengunci pemilik aslinya keluar.
  //
  // Karena memeriksa password, jalur ini ikut dibatasi. Tanpa itu, perangkat
  // yang tertinggal terbuka menjadi tempat menebak password tanpa batas —
  // pintu belakang yang melewati seluruh pembatasan di form masuk.
  const kunciEmail = kunciAkun(req.pengguna.email);
  const kunciAlamat = kunciIp(alamatIp(req));
  const kuncian = await terkunci([kunciEmail, kunciAlamat]);
  if (kuncian.terkunci) {
    res.set('Retry-After', String(kuncian.sisaDetik));
    return res.status(429).json({
      pesan: pesanTerkunci(kuncian.sisaDetik),
      kode: 'terlalu_banyak_percobaan',
      sisa_detik: kuncian.sisaDetik,
    });
  }

  const publik = createPublicClient();
  const { error: galatLama } = await publik.auth.signInWithPassword({
    email: req.pengguna.email,
    password: lama,
  });
  if (galatLama) {
    await catatGagal([[kunciEmail, AKUN], [kunciAlamat, IP]]);
    return res.status(400).json({ pesan: 'Password lama salah.' });
  }
  await lupakanGagal([kunciEmail, kunciAlamat]);

  const { error } = await db.auth.admin.updateUserById(req.pengguna.id, { password: baru });
  if (error) return res.status(400).json({ pesan: error.message });

  await db.from('profil_pengguna')
    .update({ harus_ganti_password: false, diubah_pada: new Date().toISOString() })
    .eq('id', req.pengguna.id);

  // Sesi lama dibuang supaya perangkat lain yang masih memegang password lama
  // ikut terputus.
  const { data: sesiBaru } = await publik.auth.signInWithPassword({
    email: req.pengguna.email,
    password: baru,
  });
  if (sesiBaru?.session) pasangKuki(res, sesiBaru.session);

  await catat(req, { aksi: AKSI.GANTI_PASSWORD, objek: 'profil_pengguna', objek_id: req.pengguna.id });
  res.json({ ok: true });
}));

// --- Pengguna & Akses (Owner saja) ------------------------------------------
//
// Seluruh jalur di bawah ini sudah dijaga middleware: kebijakan.js
// mengembalikan OWNER untuk apa pun yang berawalan /pengguna, termasuk GET.
// Auditor tidak pernah sampai ke sini.

api.get('/pengguna', jalur(async (_req, res) => {
  const { data, error } = await db
    .from('profil_pengguna')
    .select(KOLOM_PROFIL)
    .order('owner_utama', { ascending: false })
    .order('dibuat_pada', { ascending: true });
  if (error) throw error;
  res.json({ data: data ?? [] });
}));

function masukanPengguna(body) {
  const nama = rapi(body?.nama);
  const email = rapi(body?.email).toLowerCase();
  const peran = rapi(body?.peran).toUpperCase();
  const entitas = Array.isArray(body?.entitas_akses) ? body.entitas_akses : [];

  if (nama === '') return { galat: 'Nama wajib diisi.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { galat: 'Email tidak valid.' };
  if (!['OWNER', 'AUDITOR'].includes(peran)) return { galat: 'Peran harus OWNER atau AUDITOR.' };

  const bersih = [...new Set(entitas.filter((e) => KODE_ENTITAS.includes(e)))];
  if (peran === 'AUDITOR' && bersih.length === 0) {
    return { galat: 'Pilih minimal satu perusahaan yang boleh diakses auditor.' };
  }

  return {
    nilai: {
      nama,
      email,
      peran,
      // Owner selalu melihat keduanya; menyimpan yang lain hanya akan
      // menyesatkan siapa pun yang membaca tabelnya nanti.
      entitas_akses: peran === 'OWNER' ? [...KODE_ENTITAS] : bersih,
      boleh_periksa: peran === 'OWNER' ? true : body?.boleh_periksa === true,
    },
  };
}

api.post('/pengguna', jalur(async (req, res) => {
  const { galat, nilai } = masukanPengguna(req.body);
  if (galat) return res.status(400).json({ pesan: galat });

  const password = String(req.body?.password ?? '');
  const lemah = passwordLemah(password);
  if (lemah) return res.status(400).json({ pesan: lemah });

  const { data: sudahAda } = await db
    .from('profil_pengguna').select('id').eq('email', nilai.email).maybeSingle();
  if (sudahAda) return res.status(409).json({ pesan: 'Email itu sudah terdaftar.' });

  const { data: dibuat, error: galatAuth } = await db.auth.admin.createUser({
    email: nilai.email,
    password,
    email_confirm: true,
  });
  if (galatAuth) return res.status(400).json({ pesan: galatAuth.message });

  const { data: profil, error } = await db
    .from('profil_pengguna')
    .insert({
      id: dibuat.user.id,
      ...nilai,
      status: 'AKTIF',
      // Password awal ditetapkan Owner, jadi Owner sempat mengetahuinya.
      // Wajib diganti supaya sesudah itu hanya penggunanya yang tahu.
      harus_ganti_password: true,
      owner_utama: false,
      dibuat_oleh: req.pengguna.id,
    })
    .select(KOLOM_PROFIL)
    .single();

  if (error) {
    // Akun auth yang telanjur dibuat dibersihkan, supaya tidak tertinggal
    // akun tanpa profil yang bisa masuk tetapi tidak dikenali aplikasi.
    await db.auth.admin.deleteUser(dibuat.user.id).catch(() => {});
    throw error;
  }

  await catat(req, {
    aksi: AKSI.BUAT_PENGGUNA,
    objek: 'profil_pengguna',
    objek_id: profil.id,
    detail: { email: profil.email, peran: profil.peran, entitas_akses: profil.entitas_akses },
  });
  res.status(201).json(profil);
}));

/** Baris sasaran beserta penolakan yang sudah siap dikirim. */
async function sasaran(req, res) {
  const { data, error } = await db
    .from('profil_pengguna').select(KOLOM_PROFIL).eq('id', req.params.id).maybeSingle();
  if (error) throw error;
  if (!data) {
    res.status(404).json({ pesan: 'Pengguna tidak ditemukan.' });
    return null;
  }
  return data;
}

api.put('/pengguna/:id', jalur(async (req, res) => {
  const lama = await sasaran(req, res);
  if (!lama) return undefined;

  const { galat, nilai } = masukanPengguna({ ...req.body, email: lama.email });
  if (galat) return res.status(400).json({ pesan: galat });

  if (lama.owner_utama && nilai.peran !== 'OWNER') {
    return res.status(403).json({ pesan: 'Owner utama tidak bisa diturunkan perannya.' });
  }

  const { data, error } = await db
    .from('profil_pengguna')
    .update({
      nama: nilai.nama,
      peran: nilai.peran,
      entitas_akses: nilai.entitas_akses,
      boleh_periksa: nilai.boleh_periksa,
      diubah_pada: new Date().toISOString(),
      diubah_oleh: req.pengguna.id,
    })
    .eq('id', lama.id)
    .select(KOLOM_PROFIL)
    .single();
  if (error) throw error;

  await catat(req, {
    aksi: AKSI.UBAH_AKSES,
    objek: 'profil_pengguna',
    objek_id: lama.id,
    detail: {
      email: lama.email,
      sebelum: { peran: lama.peran, entitas_akses: lama.entitas_akses, boleh_periksa: lama.boleh_periksa },
      sesudah: { peran: data.peran, entitas_akses: data.entitas_akses, boleh_periksa: data.boleh_periksa },
    },
  });
  res.json(data);
}));

api.post('/pengguna/:id/status', jalur(async (req, res) => {
  const lama = await sasaran(req, res);
  if (!lama) return undefined;

  const status = rapi(req.body?.status).toUpperCase();
  if (!['AKTIF', 'NONAKTIF'].includes(status)) {
    return res.status(400).json({ pesan: 'Status harus AKTIF atau NONAKTIF.' });
  }
  if (lama.owner_utama && status === 'NONAKTIF') {
    return res.status(403).json({ pesan: 'Owner utama tidak bisa dinonaktifkan.' });
  }
  if (lama.id === req.pengguna.id && status === 'NONAKTIF') {
    return res.status(400).json({ pesan: 'Tidak bisa menonaktifkan akun sendiri.' });
  }

  const { data, error } = await db
    .from('profil_pengguna')
    .update({ status, diubah_pada: new Date().toISOString(), diubah_oleh: req.pengguna.id })
    .eq('id', lama.id)
    .select(KOLOM_PROFIL)
    .single();
  if (error) return res.status(409).json({ pesan: error.message });

  // Sesi yang sedang berjalan ikut diputus. Middleware sudah membaca status
  // dari database di setiap permintaan, jadi aksesnya sebenarnya sudah mati
  // seketika; ini menutup tokennya di sisi Supabase juga.
  if (status === 'NONAKTIF') {
    await db.auth.admin.updateUserById(lama.id, { ban_duration: '876000h' }).catch(() => {});
  } else {
    await db.auth.admin.updateUserById(lama.id, { ban_duration: 'none' }).catch(() => {});
  }

  await catat(req, {
    aksi: status === 'AKTIF' ? AKSI.AKTIFKAN_PENGGUNA : AKSI.NONAKTIFKAN_PENGGUNA,
    objek: 'profil_pengguna',
    objek_id: lama.id,
    detail: { email: lama.email, sebelum: lama.status, sesudah: status },
  });
  res.json(data);
}));

api.post('/pengguna/:id/password', jalur(async (req, res) => {
  const lama = await sasaran(req, res);
  if (!lama) return undefined;

  const password = String(req.body?.password ?? '');
  const lemah = passwordLemah(password);
  if (lemah) return res.status(400).json({ pesan: lemah });

  const { error } = await db.auth.admin.updateUserById(lama.id, { password });
  if (error) return res.status(400).json({ pesan: error.message });

  // Ditandai wajib ganti lagi: Owner baru saja mengetahui password ini.
  await db.from('profil_pengguna')
    .update({ harus_ganti_password: true, diubah_pada: new Date().toISOString(), diubah_oleh: req.pengguna.id })
    .eq('id', lama.id);

  await catat(req, {
    aksi: AKSI.RESET_PASSWORD,
    objek: 'profil_pengguna',
    objek_id: lama.id,
    detail: { email: lama.email },
  });
  res.json({ ok: true });
}));

api.delete('/pengguna/:id', jalur(async (req, res) => {
  const lama = await sasaran(req, res);
  if (!lama) return undefined;

  if (lama.owner_utama) return res.status(403).json({ pesan: 'Owner utama tidak bisa dihapus.' });
  if (lama.id === req.pengguna.id) {
    return res.status(400).json({ pesan: 'Tidak bisa menghapus akun sendiri.' });
  }

  const { error } = await db.from('profil_pengguna').delete().eq('id', lama.id);
  if (error) return res.status(409).json({ pesan: error.message });

  await db.auth.admin.deleteUser(lama.id).catch(() => {});

  // Dicatat SESUDAH penghapusan, dan identitasnya disalin ke dalam baris
  // jejak. Seluruh pekerjaan audit yang pernah dia lakukan tetap terbaca
  // lengkap dengan nama dan emailnya walaupun akunnya sudah tidak ada.
  await catat(req, {
    aksi: AKSI.HAPUS_PENGGUNA,
    objek: 'profil_pengguna',
    objek_id: lama.id,
    detail: { email: lama.email, nama: lama.nama, peran: lama.peran },
  });
  res.json({ ok: true });
}));

// --- Kuncian percobaan masuk (Owner saja) -----------------------------------
//
// Jalur pulih lewat layar, supaya Owner tidak perlu membuka SQL Editor setiap
// kali ada auditor yang lupa passwordnya.
//
// Kalau yang terkunci justru Owner satu-satunya, layar ini tidak bisa dipakai —
// kuncian PASTI berakhir sendiri dalam 30 menit, dan
// `supabase/akses/pulihkan-akses.sql` menyediakan jalan yang lebih cepat.

api.get('/pengguna/kunci', jalur(async (_req, res) => {
  const { data, error } = await db
    .from('percobaan_masuk')
    .select('*')
    .gt('terkunci_sampai', new Date().toISOString())
    .order('terkunci_sampai', { ascending: false });
  if (error) throw error;
  res.json({ data: data ?? [] });
}));

api.post('/pengguna/buka-kunci', jalur(async (req, res) => {
  const kunci = rapi(req.body?.kunci);
  if (kunci === '') return res.status(400).json({ pesan: 'Kunci wajib disebut.' });

  const { error } = await db.from('percobaan_masuk').delete().eq('kunci', kunci);
  if (error) throw error;

  await catat(req, {
    aksi: AKSI.UBAH_AKSES,
    objek: 'percobaan_masuk',
    objek_id: kunci,
    detail: { tindakan: 'buka_kunci' },
  });
  res.json({ ok: true });
}));

// --- Jejak aktivitas (Owner saja, hanya baca) -------------------------------
//
// Tidak ada endpoint ubah maupun hapus, dan database pun menolaknya lewat
// trigger. Jejak yang bisa disunting bukan jejak.

api.get('/jejak', jalur(async (req, res) => {
  const batas = Math.min(Number(req.query.batas) || 100, 500);
  const mulai = Math.max(Number(req.query.mulai) || 0, 0);

  let query = db
    .from('jejak_aktivitas')
    .select('*', { count: 'exact' })
    .order('waktu', { ascending: false })
    .range(mulai, mulai + batas - 1);

  if (req.query.aksi) query = query.eq('aksi', rapi(req.query.aksi).toUpperCase());
  if (req.query.email) query = query.ilike('pengguna_email', `%${rapi(req.query.email)}%`);

  const { data, count, error } = await query;
  if (error) throw error;
  res.json({ data: data ?? [], total: count ?? 0, batas, mulai });
}));

export default api;

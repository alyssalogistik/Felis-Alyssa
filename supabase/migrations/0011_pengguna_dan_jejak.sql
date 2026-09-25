-- ---------------------------------------------------------------------------
-- Pengguna, peran, dan jejak aktivitas
--
-- Sampai migration ini, siapa pun yang tahu URL-nya bisa membaca seluruh data
-- lewat /api. Ini lapisan akses DI ATAS sistem yang sudah ada: tidak satu pun
-- tabel rekonsiliasi, pembayaran, atau Mekari disentuh, dan tidak satu baris
-- data pun berubah.
--
-- Password TIDAK disimpan di sini. Identitas dan password dipegang Supabase
-- Auth (auth.users); tabel ini hanya menyimpan peran, akses entitas, dan
-- status — hal-hal yang harus diputuskan aplikasi, bukan penyedia identitas.
-- ---------------------------------------------------------------------------

create table if not exists profil_pengguna (
  -- Sama dengan auth.users.id. Tanpa kunci asing ke auth.users supaya
  -- migration ini bisa dijalankan dan diuji di database mana pun, termasuk
  -- replika lokal yang tidak punya skema auth. Penghapusan akun tetap
  -- menghapus barisnya lewat endpoint, bukan lewat cascade.
  id             uuid primary key,

  email          text not null unique,
  nama           text not null check (length(trim(nama)) > 0),

  peran          text not null check (peran in ('OWNER', 'AUDITOR')),

  -- Perusahaan yang boleh dilihat. OWNER selalu dianggap punya keduanya,
  -- jadi kolom ini yang benar-benar dipakai hanya untuk AUDITOR.
  entitas_akses  text[] not null default '{}',

  -- Auditor yang boleh mengubah status dan catatan audit. Bawaannya tidak
  -- boleh: akses tulis diberikan secara sadar, bukan didapat otomatis.
  boleh_periksa  boolean not null default false,

  status         text not null default 'AKTIF' check (status in ('AKTIF', 'NONAKTIF')),

  -- Password awal ditetapkan Owner dan wajib diganti saat login pertama,
  -- supaya sesudahnya Owner tidak lagi mengetahui password auditornya.
  harus_ganti_password boolean not null default true,

  -- Pemilik utama. Tidak bisa dihapus, dinonaktifkan, atau diturunkan
  -- perannya oleh siapa pun — lihat trigger di bawah.
  owner_utama    boolean not null default false,

  terakhir_login timestamptz,
  dibuat_pada    timestamptz not null default now(),
  dibuat_oleh    uuid,
  diubah_pada    timestamptz,
  diubah_oleh    uuid,

  -- Entitas yang tidak dikenali akan diam-diam berarti "tidak punya akses
  -- apa-apa" di aplikasi, dan itu tampak seperti bug alih-alih salah isi.
  constraint entitas_akses_dikenali check (
    entitas_akses <@ array['PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA']::text[]
  )
);

create index if not exists idx_profil_email  on profil_pengguna (lower(email));
create index if not exists idx_profil_peran  on profil_pengguna (peran, status);

-- Hanya boleh ada satu owner utama.
create unique index if not exists idx_profil_owner_utama
  on profil_pengguna ((1)) where owner_utama;

-- ---------------------------------------------------------------------------
-- Jejak aktivitas
--
-- Identitas pelakunya DISALIN ke dalam baris, bukan di-join ke
-- profil_pengguna, dan sengaja tanpa kunci asing.
--
-- Alasannya inti: akun auditor memang dimaksudkan untuk dihapus setelah
-- pekerjaannya selesai. Kalau jejaknya bergantung pada baris profil, menghapus
-- auditor akan ikut menghapus atau mengosongkan catatan pekerjaannya — persis
-- yang tidak boleh terjadi pada alat audit. Dengan identitas disalin, akunnya
-- boleh hilang dan jejaknya tetap terbaca utuh bertahun-tahun kemudian.
-- ---------------------------------------------------------------------------

create table if not exists jejak_aktivitas (
  id             bigserial primary key,
  waktu          timestamptz not null default now(),

  pengguna_id    uuid,
  pengguna_email text not null default '-',
  pengguna_nama  text,
  peran          text,

  aksi           text not null,
  entitas        text,
  objek          text,
  objek_id       text,
  detail         jsonb not null default '{}'::jsonb,

  ip             text,
  peramban       text
);

create index if not exists idx_jejak_waktu    on jejak_aktivitas (waktu desc);
create index if not exists idx_jejak_pengguna on jejak_aktivitas (pengguna_id);
create index if not exists idx_jejak_aksi     on jejak_aktivitas (aksi);
create index if not exists idx_jejak_entitas  on jejak_aktivitas (entitas);

-- ---------------------------------------------------------------------------
-- Penjaga, dijalankan database
--
-- Ketiganya sengaja di sini, bukan hanya di aplikasi. Aturan yang hanya hidup
-- di kode akan hilang begitu ada satu jalur kode baru yang lupa memanggilnya;
-- aturan yang hidup di database berlaku untuk setiap jalur, termasuk SQL
-- Editor dan skrip sekali pakai.
-- ---------------------------------------------------------------------------

-- 1. Jejak aktivitas tidak bisa diubah maupun dihapus oleh siapa pun.
create or replace function jejak_hanya_tambah()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'jejak_aktivitas hanya bisa ditambah, tidak bisa diubah atau dihapus';
end
$$;

drop trigger if exists trg_jejak_hanya_tambah on jejak_aktivitas;
create trigger trg_jejak_hanya_tambah
  before update or delete on jejak_aktivitas
  for each row execute function jejak_hanya_tambah();

-- 2. Owner utama tidak bisa dihapus, dinonaktifkan, atau diturunkan perannya.
create or replace function lindungi_owner_utama()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if old.owner_utama then
      raise exception 'Owner utama tidak bisa dihapus';
    end if;
    return old;
  end if;

  if old.owner_utama then
    if new.owner_utama is distinct from true then
      raise exception 'Penanda owner utama tidak bisa dilepas';
    end if;
    if new.peran <> 'OWNER' then
      raise exception 'Owner utama tidak bisa diturunkan perannya';
    end if;
    if new.status <> 'AKTIF' then
      raise exception 'Owner utama tidak bisa dinonaktifkan';
    end if;
  end if;
  return new;
end
$$;

drop trigger if exists trg_lindungi_owner_utama on profil_pengguna;
create trigger trg_lindungi_owner_utama
  before update or delete on profil_pengguna
  for each row execute function lindungi_owner_utama();

-- 3. Owner aktif terakhir tidak boleh hilang.
--
-- Tanpa ini, satu klik yang keliru bisa meninggalkan aplikasi tanpa seorang pun
-- yang berhak mengelola pengguna, dan pulihnya hanya lewat SQL Editor.
-- Syaratnya diperiksa DI DALAM fungsi, bukan lewat klausa `when`: PostgreSQL
-- tidak menyediakan tg_op di klausa itu, dan `new` tidak ada sama sekali pada
-- DELETE. Menaruhnya di sana membuat seluruh migration gagal dipasang.
create or replace function sisakan_satu_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  tersisa int;
  masih_owner_aktif boolean;
begin
  if old.peran <> 'OWNER' or old.status <> 'AKTIF' then
    return coalesce(new, old);
  end if;

  masih_owner_aktif := tg_op = 'UPDATE'
    and new.peran = 'OWNER' and new.status = 'AKTIF';
  if masih_owner_aktif then
    return new;
  end if;

  select count(*) into tersisa
  from profil_pengguna
  where peran = 'OWNER' and status = 'AKTIF' and id <> old.id;

  if tersisa = 0 then
    raise exception 'Harus selalu ada minimal satu OWNER yang aktif';
  end if;
  return coalesce(new, old);
end
$$;

drop trigger if exists trg_sisakan_satu_owner on profil_pengguna;
create trigger trg_sisakan_satu_owner
  after update or delete on profil_pengguna
  for each row execute function sisakan_satu_owner();

-- ---------------------------------------------------------------------------
-- Keamanan
--
-- RLS menyala tanpa policy, sama seperti seluruh tabel lain: kunci anon tidak
-- bisa membaca profil, peran, maupun jejak siapa pun. Seluruh akses lewat API
-- server yang memegang service_role dan memeriksa sesi lebih dulu.
-- ---------------------------------------------------------------------------

alter table profil_pengguna enable row level security;
alter table jejak_aktivitas enable row level security;

select pg_notify('pgrst', 'reload schema');

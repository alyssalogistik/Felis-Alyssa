-- ---------------------------------------------------------------------------
-- Pembatasan percobaan masuk
--
-- Menahan penebakan password. Tabel ini hanya menyimpan hitungan percobaan;
-- tidak ada data pengguna, tidak ada data keuangan, dan tidak ada satu pun
-- tabel lain yang disentuh.
--
-- Isinya boleh dikosongkan kapan saja tanpa kehilangan apa pun — yang hilang
-- hanya hitungan yang sedang berjalan. Itulah jalan pulih Owner bila terkunci.
-- ---------------------------------------------------------------------------

create table if not exists percobaan_masuk (
  -- 'akun:budi@alyssa.id' atau 'ip:1.2.3.4'.
  --
  -- Untuk ember akun, kuncinya dihitung dari email yang DIKIRIM, bukan dari
  -- akun yang ditemukan. Kalau ember hanya dibuat untuk email yang benar-benar
  -- terdaftar, penebak bisa membedakan email terdaftar dari yang tidak hanya
  -- dengan melihat mana yang akhirnya terkunci — membocorkan persis hal yang
  -- pesan galatnya susah payah sembunyikan.
  kunci           text primary key,

  jenis           text not null check (jenis in ('AKUN', 'IP')),

  gagal           int not null default 0,
  pertama_gagal   timestamptz,
  terakhir_gagal  timestamptz,

  -- Berapa kali ember ini pernah terkunci. Menentukan lama kuncian berikutnya,
  -- yang naik tetapi berhenti di batas atas — lihat batas-masuk.js.
  kunci_ke        int not null default 0,

  -- SELALU terisi waktu yang pasti lewat. Tidak ada kuncian permanen: pemilik
  -- project ini satu orang, dan akun yang terkunci selamanya karena salah ketik
  -- jauh lebih buruk daripada risiko yang dicegahnya.
  terkunci_sampai timestamptz,

  diubah_pada     timestamptz not null default now()
);

create index if not exists idx_percobaan_terkunci on percobaan_masuk (terkunci_sampai)
  where terkunci_sampai is not null;
create index if not exists idx_percobaan_waktu    on percobaan_masuk (diubah_pada);

-- ---------------------------------------------------------------------------
-- Membuang hitungan yang sudah tidak berlaku
--
-- Dipanggil aplikasi sesekali. Tidak dijadwalkan lewat pg_cron supaya tidak
-- menuntut extension tambahan di project Supabase.
-- ---------------------------------------------------------------------------

drop function if exists bersihkan_percobaan_masuk();
create function bersihkan_percobaan_masuk()
returns integer
language sql
volatile
set search_path = public
as $$
  with dibuang as (
    delete from percobaan_masuk
    where diubah_pada < now() - interval '24 hours'
      and (terkunci_sampai is null or terkunci_sampai < now())
    returning 1
  )
  select count(*)::int from dibuang
$$;

-- RLS menyala tanpa policy, sama seperti seluruh tabel lain.
alter table percobaan_masuk enable row level security;

select pg_notify('pgrst', 'reload schema');

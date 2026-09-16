-- ---------------------------------------------------------------------------
-- Pembayaran manual: uang keluar yang tidak lewat rekening koran BCA
--
-- Mekari Pay, kas, bank lain. Pembayarannya sah tetapi tidak pernah muncul
-- sebagai baris mutasi di e-statement BCA, sehingga supplier yang dibayar
-- lewat jalur itu tampak belum dibayar sama sekali di halaman audit — dan yang
-- tampak belum dibayar akan dibayar untuk kedua kalinya.
--
-- TABELNYA TERPISAH PENUH. Tidak ada satu baris pun yang masuk transaksi_bank.
-- Rekening koran tetap satu-satunya sumber kebenaran transaksi bank; yang
-- digabung hanyalah TAMPILANNYA, lewat view di bawah.
-- ---------------------------------------------------------------------------

create table if not exists pembayaran_manual (
  id            uuid primary key default gen_random_uuid(),

  tanggal       date not null,
  penerima      text not null check (length(trim(penerima)) > 0),
  nominal       numeric(14, 2) not null check (nominal > 0),

  -- Sumber dana. Dibatasi daftar tertutup supaya ringkasan per sumber tidak
  -- pernah menghadapi nilai yang tidak dikenal dan diam-diam hilang dari total.
  sumber        text not null check (sumber in (
                  'MEKARI_PAY', 'BCA', 'BANK_LAIN', 'KAS', 'LAINNYA')),

  no_referensi  text,
  memo          text,

  -- Tautan bukti, bukan berkasnya. Aplikasi ini belum punya authentication,
  -- sehingga berkas yang diunggah ke bucket publik bisa dibaca siapa pun yang
  -- tahu URL-nya. Bucket privat menuntut signed URL, dan itu menuntut tahu
  -- siapa yang meminta — yang belum ada.
  bukti_url     text,

  -- Sejalan dengan transaksi_bank, supaya filter bulan/tahun memakai kolom
  -- yang sama persis dan terindeks di kedua sisi view gabungan.
  bulan int generated always as (extract(month from tanggal)) stored,
  tahun int generated always as (extract(year  from tanggal)) stored,

  dibuat_pada   timestamptz not null default now(),
  dibuat_oleh   text not null check (length(trim(dibuat_oleh)) > 0),
  diubah_pada   timestamptz,
  diubah_oleh   text
);

create index if not exists idx_bayar_manual_tanggal  on pembayaran_manual (tanggal desc);
create index if not exists idx_bayar_manual_periode  on pembayaran_manual (tahun, bulan);
create index if not exists idx_bayar_manual_penerima on pembayaran_manual (lower(penerima));

-- ---------------------------------------------------------------------------
-- Jejak perubahan
--
-- Penghapusan di sini hapus sungguhan, bukan penanda. Sebabnya: view gabungan
-- dibaca oleh pencarian, PDF, ekspor, dan ringkasan. Kalau memakai penanda
-- terhapus, keempat jalur itu harus ingat menyaringnya, dan satu yang lupa
-- membuat pembayaran yang sudah dibuang muncul lagi di total. Dengan hapus
-- sungguhan tidak ada yang perlu diingat, dan tabel inilah yang menyimpan
-- apa yang dibuang.
--
-- SENGAJA TANPA FOREIGN KEY ke pembayaran_manual: kunci asing apa pun dengan
-- cascade akan ikut menghapus jejaknya bersama barisnya — persis hal yang
-- harus diselamatkan.
-- ---------------------------------------------------------------------------

create table if not exists pembayaran_manual_riwayat (
  id             uuid primary key default gen_random_uuid(),
  pembayaran_id  uuid not null,
  aksi           text not null check (aksi in ('BUAT', 'UBAH', 'HAPUS')),
  data_lama      jsonb,
  data_baru      jsonb,
  oleh           text,
  pada           timestamptz not null default now()
);

create index if not exists idx_riwayat_bayar on pembayaran_manual_riwayat (pembayaran_id, pada desc);

create or replace function catat_riwayat_pembayaran()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- Pelaku yang ditetapkan pemanggil untuk transaksi ini. Dipakai terutama
  -- oleh penghapusan: baris yang dihapus tidak punya tempat lagi untuk
  -- menuliskan siapa yang menghapusnya.
  v_pelaku text := nullif(current_setting('app.pelaku', true), '');
begin
  if tg_op = 'INSERT' then
    insert into pembayaran_manual_riwayat (pembayaran_id, aksi, data_baru, oleh)
    values (new.id, 'BUAT', to_jsonb(new), coalesce(v_pelaku, new.dibuat_oleh));
    return new;
  elsif tg_op = 'UPDATE' then
    insert into pembayaran_manual_riwayat (pembayaran_id, aksi, data_lama, data_baru, oleh)
    values (new.id, 'UBAH', to_jsonb(old), to_jsonb(new),
            coalesce(v_pelaku, new.diubah_oleh, new.dibuat_oleh));
    return new;
  else
    insert into pembayaran_manual_riwayat (pembayaran_id, aksi, data_lama, oleh)
    values (old.id, 'HAPUS', to_jsonb(old), coalesce(v_pelaku, old.diubah_oleh, old.dibuat_oleh));
    return old;
  end if;
end;
$fn$;

drop trigger if exists trg_riwayat_pembayaran on pembayaran_manual;
create trigger trg_riwayat_pembayaran
  after insert or update or delete on pembayaran_manual
  for each row execute function catat_riwayat_pembayaran();

-- Penghapusan lewat fungsi ini, bukan DELETE langsung: hanya di sini nama
-- penghapusnya bisa sampai ke trigger. Baris yang dihapus tidak menyisakan
-- kolom untuk menuliskannya, dan jejak penghapusan tanpa pelaku tidak menjawab
-- pertanyaan yang membuat jejak itu dibuat.
create or replace function hapus_pembayaran_manual(p_id uuid, p_oleh text)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_jumlah int;
begin
  perform set_config('app.pelaku', coalesce(nullif(trim(p_oleh), ''), 'tidak diketahui'), true);
  delete from pembayaran_manual where id = p_id;
  get diagnostics v_jumlah = row_count;
  return v_jumlah;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Tampilan gabungan
--
-- Penggabungan dikerjakan DATABASE, bukan aplikasi. Halaman audit menarik
-- hasilnya berhalaman-halaman dengan range() dan count exact; dua sumber yang
-- digabung di peramban tidak bisa digeser terpisah lalu menghasilkan urutan
-- tanggal yang benar, dan auditor yang melihat sebagian daftar akan
-- menyimpulkan supplier kurang dibayar.
--
-- Nama kolomnya sengaja dibuat sama persis dengan transaksi_bank_unik supaya
-- terapkanKriteria() di api.js dan saring() di saringan.js berjalan apa adanya
-- pada kedua sumber — aturan cermin di CLAUDE.md tetap utuh.
--
-- LABEL SUMBER DIHITUNG DI SINI, bukan di peramban dan bukan di pdfkit,
-- supaya layar, PDF, dan ekspor tidak mungkin menyebut sumber yang berbeda
-- untuk baris yang sama. Pembayaran manual bersumber BCA ditulis
-- "BCA (MANUAL)" — kalau ditulis "BCA" saja, ia tampak seolah baris rekening
-- koran padahal diketik orang.
-- ---------------------------------------------------------------------------

create or replace view pembayaran_semua
with (security_invoker = true) as
select
  'bank'::text                as asal,
  'BCA'::text                 as sumber,
  t.id, t.unggahan_id, t.baris_sumber, t.berkas_sumber,
  t.tanggal, t.tanggal_ambigu, t.keterangan,
  t.debit, t.kredit, t.saldo, t.referensi,
  t.status_data, t.masalah, t.duplikat,
  t.status_rekon, t.referensi_rekon, t.catatan_rekon,
  t.nominal_pembanding, t.selisih, t.direkon_pada, t.direkon_oleh,
  t.dibuat_pada, t.bulan, t.tahun,
  null::text                  as memo,
  null::text                  as bukti_url,
  null::text                  as dibuat_oleh
from transaksi_bank_unik t

union all

select
  'manual'::text,
  case m.sumber
    when 'MEKARI_PAY' then 'MEKARI PAY'
    when 'BANK_LAIN'  then 'BANK LAIN'
    when 'BCA'        then 'BCA (MANUAL)'
    else m.sumber
  end,
  m.id, null::uuid, null::int, null::text,
  m.tanggal, false,
  -- Keterangan disusun dari penerima dan memo. Penerima selalu ada di depan
  -- supaya pencarian nama menemukannya dengan aturan yang sama seperti
  -- keterangan bank, tanpa cabang kode tersendiri.
  m.penerima || coalesce(' - ' || nullif(trim(m.memo), ''), ''),
  m.nominal, 0::numeric(14,2), null::numeric(14,2), m.no_referensi,
  'valid'::text, '{}'::text[], false,
  'belum'::text, null::text, null::text,
  null::numeric(14,2), null::numeric(14,2), null::timestamptz, null::text,
  m.dibuat_pada, m.bulan, m.tahun,
  m.memo, m.bukti_url, m.dibuat_oleh
from pembayaran_manual m;

-- ---------------------------------------------------------------------------
-- Ringkasan per sumber
--
-- Fungsi BARU, bukan parameter tambahan pada ringkasan_transaksi_bank().
-- Menambah parameter ke fungsi yang sudah ada membuat versi lama dan baru
-- berdampingan, lalu pemanggilan lama gagal dengan "Could not choose a best
-- candidate function" justru sesudah pemutakhiran yang tampak berhasil.
--
-- Pengelompokannya: BCA hanya baris rekening koran. Pembayaran manual yang
-- sumbernya BCA masuk MANUAL LAINNYA, bukan BCA — supaya "Total BCA" tetap
-- berarti "yang benar-benar ada di rekening koran" dan bisa dicocokkan dengan
-- e-statement tanpa selisih yang tidak bisa dijelaskan.
-- ---------------------------------------------------------------------------

create or replace function ringkasan_pembayaran(
  p_cari   text default null,
  p_bulan  int  default null,
  p_tahun  int  default null,
  p_dari   date default null,
  p_sampai date default null,
  p_hanya_debit boolean default false
)
returns table (kelompok text, jumlah bigint, debit numeric, kredit numeric)
language sql
stable
set search_path = public
as $$
  select
    case
      when p.asal = 'bank'          then 'BCA'
      when p.sumber = 'MEKARI PAY'  then 'MEKARI PAY'
      else 'MANUAL LAINNYA'
    end,
    count(*),
    coalesce(sum(p.debit), 0),
    coalesce(sum(p.kredit), 0)
  from pembayaran_semua p
  where (p_cari is null or p_cari = ''
         or p.keterangan ilike '%' || p_cari || '%'
         or coalesce(p.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan  is null or p.bulan = p_bulan)
    and (p_tahun  is null or p.tahun = p_tahun)
    and (p_dari   is null or p.tanggal >= p_dari)
    and (p_sampai is null or p.tanggal <= p_sampai)
    and (not p_hanya_debit or p.debit > 0)
  group by 1;
$$;

-- ---------------------------------------------------------------------------
-- Keamanan: sama seperti tabel lain, RLS menyala tanpa satu pun policy.
-- Seluruh akses wajib lewat API server yang memegang service_role.
-- ---------------------------------------------------------------------------

alter table pembayaran_manual          enable row level security;
alter table pembayaran_manual_riwayat  enable row level security;

grant select on pembayaran_semua to service_role;

-- PostgREST masih memakai peta skema lama tanpa ini, dan tetap melaporkan
-- tabel baru sebagai "Could not find the table ... in the schema cache".
select pg_notify('pgrst', 'reload schema');

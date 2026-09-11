-- Sidik jari transaksi, agar satu rekening koran tidak pernah masuk dua kali.
--
-- Sebelum ini, satu-satunya penjaga adalah hash berkas: unggahan kedua dari
-- berkas yang sama hanya dilaporkan "pernah diunggah", tetapi seluruh
-- transaksinya tetap disisipkan. Jumlah di database berlipat, dan total uang
-- keluar ikut berlipat — kesalahan yang tidak menimbulkan galat apa pun dan
-- baru ketahuan saat angkanya dipakai.
--
-- Hash berkas juga terlalu rapuh untuk dijadikan penjaga: mengganti nama PDF
-- tidak mengubah hash-nya, tetapi mengunduh ulang e-statement yang sama dari
-- myBCA bisa menghasilkan berkas berbeda byte walau isinya identik. Yang harus
-- dibandingkan adalah isi transaksinya.
--
-- Migration ini TIDAK menghapus maupun mengubah satu pun nilai transaksi.

-- ---------------------------------------------------------------------------
-- Kolom penyusun sidik jari
-- ---------------------------------------------------------------------------

alter table transaksi_bank
  -- Nomor rekening ikut menyusun sidik jari supaya dua rekening berbeda yang
  -- kebetulan punya transaksi serupa tidak saling menganggap duplikat.
  add column if not exists no_rekening text,

  -- Transaksi yang benar-benar kembar di dalam satu rekening koran itu wajar:
  -- dua penarikan bernominal sama pada hari yang sama, tanpa nomor rujukan.
  -- Tanpa penomoran ini, yang kedua akan ditolak sebagai duplikat dan uang
  -- yang benar-benar keluar hilang dari catatan. Urutannya ditetapkan saat
  -- penguraian dan selalu sama untuk berkas yang sama, sehingga unggahan ulang
  -- tetap terdeteksi sebagai duplikat.
  add column if not exists kembar_ke int not null default 1;

-- ---------------------------------------------------------------------------
-- Menomori baris yang sudah telanjur kembar
--
-- Database yang sudah dipakai bisa memuat transaksi ganda hasil unggahan
-- berulang sebelum penjaga ini ada. Indeks unik di bawah akan menolak dibuat
-- selama itu terjadi.
--
-- Menghapus yang ganda bukan pilihan: perintah ini tidak boleh menyentuh satu
-- pun baris transaksi. Karena itu baris kembar cukup DINOMORI — nilai
-- transaksinya tidak berubah sedikit pun, hanya kolom pembukuan yang baru
-- ditambahkan di atas. Setelah itu indeks bisa berdiri, dan unggahan
-- berikutnya terjaga.
--
-- Yang telanjur ganda tetap ada di database dan tetap terhitung. Pakai
-- periksa_transaksi_ganda() di bawah untuk melihatnya, lalu putuskan sendiri.
-- ---------------------------------------------------------------------------

update transaksi_bank t
set kembar_ke = u.urutan
from (
  select id,
         row_number() over (
           partition by
             coalesce(no_rekening, ''),
             tanggal,
             lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')),
             coalesce(debit, 0),
             coalesce(kredit, 0),
             lower(coalesce(referensi, ''))
           order by dibuat_pada, id
         ) as urutan
  from transaksi_bank
) u
where t.id = u.id and t.kembar_ke is distinct from u.urutan;

-- ---------------------------------------------------------------------------
-- Sidik jarinya
-- ---------------------------------------------------------------------------

alter table transaksi_bank
  add column if not exists sidik text generated always as (
    md5(
      coalesce(no_rekening, '') || '|' ||
      -- Tanggal diubah menjadi jumlah hari, bukan teks: pengubahan date ke teks
      -- bergantung pada DateStyle sehingga tidak boleh dipakai kolom generated.
      coalesce((tanggal - date '1970-01-01')::text, '') || '|' ||
      -- Huruf besar-kecil dan spasi berlebih diseragamkan: cetakan ulang
      -- e-statement kadang berbeda pada keduanya walau transaksinya sama.
      lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(debit, 0)::text || '|' ||
      coalesce(kredit, 0)::text || '|' ||
      lower(coalesce(referensi, '')) || '|' ||
      kembar_ke::text
    )
  ) stored;

-- Penjaga sesungguhnya. Tanpa indeks unik ini, penyisipan tetap bisa lolos
-- ketika dua permintaan berjalan bersamaan.
create unique index if not exists idx_transaksi_sidik on transaksi_bank (sidik);

-- ---------------------------------------------------------------------------
-- Riwayat impor
--
-- Tabelnya sudah ada; yang kurang hanyalah periode rekening korannya dan hasil
-- setiap unggahan. Menambah kolom di sini, bukan membuat tabel baru, karena
-- satu unggahan memang satu baris riwayat.
-- ---------------------------------------------------------------------------

alter table unggahan_rekening_koran
  add column if not exists no_rekening text,
  add column if not exists periode_bulan int,
  add column if not exists periode_tahun int,
  add column if not exists jumlah_baru int not null default 0,
  add column if not exists jumlah_sudah_ada int not null default 0,
  add column if not exists status text not null default 'selesai';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'status_unggahan_dikenali'
      and conrelid = 'unggahan_rekening_koran'::regclass
  ) then
    alter table unggahan_rekening_koran
      add constraint status_unggahan_dikenali
      check (status in ('selesai', 'sebagian', 'duplikat', 'gagal'));
  end if;
end
$$;

create index if not exists idx_unggahan_periode
  on unggahan_rekening_koran (periode_tahun, periode_bulan);

-- ---------------------------------------------------------------------------
-- Bulan mana saja yang datanya sudah ada
--
-- Dihitung dari transaksinya sendiri, bukan dari riwayat unggahan: yang ingin
-- diketahui pemakainya adalah bulan apa yang datanya benar-benar ada, dan itu
-- tetap benar walau baris riwayatnya hilang atau satu bulan diunggah terpisah
-- dalam beberapa berkas.
-- ---------------------------------------------------------------------------

create or replace function periode_tersimpan()
returns table (tahun int, bulan int, jumlah bigint, debit numeric, kredit numeric)
language sql
stable
set search_path = public
as $$
  select t.tahun, t.bulan, count(*),
         coalesce(sum(t.debit), 0), coalesce(sum(t.kredit), 0)
  from transaksi_bank t
  where t.tanggal is not null
  group by t.tahun, t.bulan
  order by t.tahun desc, t.bulan desc;
$$;

-- ---------------------------------------------------------------------------
-- Transaksi ganda yang sudah telanjur masuk
--
-- Hanya melaporkan, tidak menghapus. Yang dihitung ganda adalah transaksi
-- serupa yang datang dari unggahan BERBEDA — itu tanda berkas yang sama
-- diunggah dua kali. Transaksi kembar di dalam satu unggahan yang sama tidak
-- dilaporkan, karena dua penarikan bernominal sama pada hari yang sama memang
-- lazim dan keduanya uang sungguhan.
-- ---------------------------------------------------------------------------

create or replace function periksa_transaksi_ganda()
returns table (
  tanggal date, keterangan text, debit numeric, kredit numeric,
  jumlah_salinan bigint, jumlah_unggahan bigint
)
language sql
stable
set search_path = public
as $$
  select
    t.tanggal,
    max(t.keterangan),
    max(t.debit),
    max(t.kredit),
    count(*),
    count(distinct t.unggahan_id)
  from transaksi_bank t
  group by
    coalesce(t.no_rekening, ''),
    t.tanggal,
    lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')),
    coalesce(t.debit, 0),
    coalesce(t.kredit, 0),
    lower(coalesce(t.referensi, ''))
  having count(distinct t.unggahan_id) > 1
  order by t.tanggal desc;
$$;

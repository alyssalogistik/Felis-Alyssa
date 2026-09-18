-- ---------------------------------------------------------------------------
-- Pemisahan entitas pemilik rekening
--
-- PT Alyssa Auto Logistik dan CV Alyssa Trans Utama membayar sebagian supplier
-- yang sama. Tanpa penanda pemilik rekening, mencari SUGENG RIYANTO dari
-- rekening CV akan memunculkan transfer PT juga, dan yang tampak sudah dibayar
-- sebenarnya dibayar oleh perusahaan yang lain.
--
-- Nomor rekening TIDAK bisa dipakai sebagai penandanya. Baris lama belum
-- menyimpannya sama sekali, dan yang menyimpannya pun tidak seragam: satu
-- rekening PT yang sama tercatat sebagai 0072890271 maupun 00072890271.
-- Karena itu penandanya kolom tersendiri, dan seluruh data yang sudah ada
-- ditandai PT — seluruh rekening koran yang pernah diunggah memang milik PT.
--
-- Seluruhnya aditif. Tidak ada tabel maupun baris yang dilepas, dan tidak satu
-- nilai transaksi pun berubah: yang ditulis hanya kolom `entitas` yang baru.
-- ---------------------------------------------------------------------------

-- --- Kolom penanda ---------------------------------------------------------

alter table transaksi_bank          add column if not exists entitas text;
alter table unggahan_rekening_koran add column if not exists entitas text;
alter table pembayaran_manual       add column if not exists entitas text;
alter table tagihan_pemasok         add column if not exists entitas text;

-- Seluruh data yang sudah ada milik PT. Hanya baris yang penandanya masih
-- kosong yang disentuh, sehingga menjalankan ulang tidak pernah menimpa apa pun.
update transaksi_bank          set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
update unggahan_rekening_koran set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
update pembayaran_manual       set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;
update tagihan_pemasok         set entitas = 'PT_ALYSSA_AUTO_LOGISTIK' where entitas is null;

-- Baru sesudah terisi, kolomnya diwajibkan. Urutannya penting: mewajibkan
-- lebih dulu akan menolak seluruh baris yang sudah ada.
alter table transaksi_bank          alter column entitas set not null;
alter table unggahan_rekening_koran alter column entitas set not null;
alter table pembayaran_manual       alter column entitas set not null;
alter table tagihan_pemasok         alter column entitas set not null;

do $pagar$
begin
  if not exists (select 1 from pg_constraint where conname = 'transaksi_bank_entitas_sah') then
    alter table transaksi_bank add constraint transaksi_bank_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'unggahan_entitas_sah') then
    alter table unggahan_rekening_koran add constraint unggahan_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pembayaran_entitas_sah') then
    alter table pembayaran_manual add constraint pembayaran_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tagihan_entitas_sah') then
    alter table tagihan_pemasok add constraint tagihan_entitas_sah
      check (entitas in ('PT_ALYSSA_AUTO_LOGISTIK', 'CV_ALYSSA_TRANS_UTAMA'));
  end if;
end
$pagar$;

-- Nomor invoice hanya unik di dalam satu entitas. Kedua perusahaan bisa
-- menerima invoice bernomor sama dari supplier yang sama, dan aturan lama akan
-- menolak yang kedua sebagai unggahan ganda.
alter table tagihan_pemasok drop constraint if exists tagihan_pemasok_pemasok_id_no_invoice_key;
create unique index if not exists idx_tagihan_entitas_invoice
  on tagihan_pemasok (entitas, pemasok_id, no_invoice);

-- --- Sidik jari transaksi --------------------------------------------------
--
-- Tanpa entitas di dalamnya, transaksi CV yang kebetulan sama tanggal, nominal,
-- dan keterangannya dengan transaksi PT akan tertolak indeks unik sebagai
-- duplikat, dan uang yang benar-benar keluar hilang dari catatan.
--
-- PostgreSQL tidak bisa mengubah rumus kolom generated, jadi kolomnya dilepas
-- lalu dipasang lagi. Yang dilepas kolom TURUNAN: nilainya dihitung ulang dari
-- kolom yang sama, tidak ada data asli yang hilang. Kedua view ikut dilepas
-- lebih dulu karena keduanya bergantung padanya, lalu dipasang kembali di bawah.
--
-- Aman terhadap indeks uniknya: seluruh baris lama beroleh entitas yang sama,
-- sehingga rumus barunya tetap memetakan masukan berbeda ke sidik berbeda —
-- yang tadinya unik tetap unik.

drop view if exists pembayaran_semua;
drop view if exists transaksi_bank_unik;

alter table transaksi_bank drop column if exists sidik;
alter table transaksi_bank
  add column sidik text generated always as (
    md5(
      entitas || '|' ||
      coalesce(no_rekening, '') || '|' ||
      coalesce((tanggal - date '1970-01-01')::text, '') || '|' ||
      lower(regexp_replace(coalesce(keterangan, ''), '\s+', ' ', 'g')) || '|' ||
      coalesce(debit, 0)::text || '|' ||
      coalesce(kredit, 0)::text || '|' ||
      lower(coalesce(referensi, '')) || '|' ||
      kembar_ke::text
    )
  ) stored;

create unique index if not exists idx_transaksi_sidik on transaksi_bank (sidik);
create index if not exists idx_transaksi_entitas on transaksi_bank (entitas);

-- --- Tampilan --------------------------------------------------------------
--
-- Entitas ikut dibawa sebagai kolom DAN ikut menyusun kunci pelipatan. Tanpa
-- yang kedua, satu transfer PT dan satu transfer CV yang kebetulan sama
-- tanggal, nominal, dan keterangannya dilipat menjadi SATU baris di layar dan
-- salah satunya hilang dari hitungan. Di halaman ini kekurangan hitung lebih
-- berbahaya daripada kelebihan.
--
-- Nomor rekening tetap tidak ikut, dengan alasan yang sama seperti semula:
-- baris lama tidak menyimpannya, dan yang menyimpannya tidak seragam.

create view transaksi_bank_unik
with (security_invoker = true) as
with sidikkan as (
  select
    t.*,
    md5(
      t.entitas                                                           || '|' ||
      coalesce((t.tanggal - date '1970-01-01')::text, '')                 || '|' ||
      lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g'))  || '|' ||
      coalesce(t.debit,  0)::text                                         || '|' ||
      coalesce(t.kredit, 0)::text                                         || '|' ||
      lower(coalesce(t.referensi, ''))
    ) as sidik_tampil
  from transaksi_bank t
),
bernomor as (
  select s.*,
         row_number() over (partition by s.unggahan_id, s.sidik_tampil
                            order by s.dibuat_pada, s.id) as kembar_berkas
  from sidikkan s
)
select distinct on (b.sidik_tampil, b.kembar_berkas)
  b.id, b.unggahan_id, b.baris_sumber, b.berkas_sumber,
  b.tanggal, b.tanggal_ambigu, b.keterangan,
  b.debit, b.kredit, b.saldo, b.referensi,
  b.status_data, b.masalah, b.duplikat,
  b.status_rekon, b.referensi_rekon, b.catatan_rekon,
  b.nominal_pembanding, b.selisih, b.direkon_pada, b.direkon_oleh,
  b.dibuat_pada, b.bulan, b.tahun, b.entitas
from bernomor b
left join kecocokan k on k.transaksi_id = b.id
order by
  b.sidik_tampil, b.kembar_berkas,
  coalesce(k.dikonfirmasi, false) desc,
  (k.id is not null) desc,
  (b.status_rekon <> 'belum') desc,
  b.dibuat_pada, b.id;

create view pembayaran_semua
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
  null::text                  as dibuat_oleh,
  t.entitas
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
  m.penerima || coalesce(' - ' || nullif(trim(m.memo), ''), ''),
  m.nominal, 0::numeric(14,2), null::numeric(14,2), m.no_referensi,
  'valid'::text, '{}'::text[], false,
  'belum'::text, null::text, null::text,
  null::numeric(14,2), null::numeric(14,2), null::timestamptz, null::text,
  m.dibuat_pada, m.bulan, m.tahun,
  m.memo, m.bukti_url, m.dibuat_oleh,
  m.entitas
from pembayaran_manual m;

grant select on transaksi_bank_unik to service_role;
grant select on pembayaran_semua    to service_role;

-- --- Ringkasan ikut disaring per entitas ------------------------------------
--
-- Kalau ringkasannya tidak ikut disaring, layar menampilkan transaksi CV saja
-- sedangkan totalnya masih menjumlahkan PT dan CV sekaligus — kekeliruannya
-- hanya berpindah tempat alih-alih hilang.
--
-- Tanda tangan lama dilepas eksplisit lebih dulu. Menambah parameter dengan
-- create or replace saja akan membuat versi baru berdampingan dengan versi
-- lama, dan pemanggilan lama menjadi ambigu — gagal dengan "Could not choose a
-- best candidate function" justru sesudah pemutakhiran yang tampak berhasil.

drop function if exists ringkasan_transaksi_bank(text, int, int, date, date);

create or replace function ringkasan_transaksi_bank(
  p_cari    text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_dari    date default null,
  p_sampai  date default null,
  p_entitas text default null
)
returns table (jumlah bigint, debit numeric, kredit numeric, net numeric)
language sql
stable
set search_path = public
as $$
  select
    count(*),
    coalesce(sum(t.debit), 0),
    coalesce(sum(t.kredit), 0),
    coalesce(sum(t.kredit), 0) - coalesce(sum(t.debit), 0)
  from transaksi_bank_unik t
  where (p_cari is null or p_cari = ''
         or t.keterangan ilike '%' || p_cari || '%'
         or coalesce(t.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan   is null or t.bulan = p_bulan)
    and (p_tahun   is null or t.tahun = p_tahun)
    and (p_dari    is null or t.tanggal >= p_dari)
    and (p_sampai  is null or t.tanggal <= p_sampai)
    and (p_entitas is null or t.entitas = p_entitas);
$$;

drop function if exists ringkasan_pembayaran(text, int, int, date, date, boolean);

create or replace function ringkasan_pembayaran(
  p_cari       text    default null,
  p_bulan      int     default null,
  p_tahun      int     default null,
  p_dari       date    default null,
  p_sampai     date    default null,
  p_hanya_debit boolean default false,
  p_entitas    text    default null
)
returns table (sumber text, jumlah bigint, debit numeric, kredit numeric, net numeric)
language sql
stable
set search_path = public
as $$
  select
    case
      when p.asal = 'bank'        then 'BCA'
      when p.sumber = 'MEKARI PAY' then 'MEKARI PAY'
      else 'MANUAL LAINNYA'
    end as sumber,
    count(*),
    coalesce(sum(p.debit), 0),
    coalesce(sum(p.kredit), 0),
    coalesce(sum(p.kredit), 0) - coalesce(sum(p.debit), 0)
  from pembayaran_semua p
  where (p_cari is null or p_cari = ''
         or p.keterangan ilike '%' || p_cari || '%'
         or coalesce(p.referensi, '') ilike '%' || p_cari || '%')
    and (p_bulan   is null or p.bulan = p_bulan)
    and (p_tahun   is null or p.tahun = p_tahun)
    and (p_dari    is null or p.tanggal >= p_dari)
    and (p_sampai  is null or p.tanggal <= p_sampai)
    and (p_entitas is null or p.entitas = p_entitas)
    and (not p_hanya_debit or p.debit > 0)
  group by 1
  order by 1;
$$;

-- --- Periode tersimpan dan pemeriksa transaksi ganda ------------------------

drop function if exists periode_tersimpan();

create or replace function periode_tersimpan(p_entitas text default null)
returns table (tahun int, bulan int, jumlah bigint, debit numeric, kredit numeric)
language sql
stable
set search_path = public
as $$
  select t.tahun, t.bulan, count(*),
         coalesce(sum(t.debit), 0), coalesce(sum(t.kredit), 0)
  from transaksi_bank t
  where t.tanggal is not null
    and (p_entitas is null or t.entitas = p_entitas)
  group by t.tahun, t.bulan
  order by t.tahun desc, t.bulan desc;
$$;

-- Entitas ikut menyusun kelompoknya: transaksi serupa dari PT dan dari CV
-- adalah dua transaksi sungguhan, bukan satu berkas yang terunggah dua kali.
--
-- Dilepas dulu, bukan create or replace: bentuk kembaliannya bertambah satu
-- kolom, dan mengganti bentuk kembalian tidak bisa dengan replace saja.
drop function if exists periksa_transaksi_ganda();

create or replace function periksa_transaksi_ganda()
returns table (
  entitas text, tanggal date, keterangan text, debit numeric, kredit numeric,
  jumlah_salinan bigint, jumlah_unggahan bigint
)
language sql
stable
set search_path = public
as $$
  select
    t.entitas,
    t.tanggal,
    max(t.keterangan),
    max(t.debit),
    max(t.kredit),
    count(*),
    count(distinct t.unggahan_id)
  from transaksi_bank t
  group by
    t.entitas,
    coalesce(t.no_rekening, ''),
    t.tanggal,
    lower(regexp_replace(coalesce(t.keterangan, ''), '\s+', ' ', 'g')),
    coalesce(t.debit, 0),
    coalesce(t.kredit, 0),
    lower(coalesce(t.referensi, ''))
  having count(distinct t.unggahan_id) > 1
  order by t.tanggal desc;
$$;

-- --- Audit pembayaran supplier ikut dipisah ---------------------------------
--
-- Tanpa ini, tagihan PT bisa tampak lunas karena dibayar dari rekening CV.
-- Entitasnya diambil dari tagihannya sendiri untuk baris bertagihan, dan dari
-- transaksinya untuk baris "(tanpa tagihan)".

create or replace view audit_pembayaran_pemasok
with (security_invoker = true) as
select
  t.id                as tagihan_id,
  p.id                as pemasok_id,
  p.nama              as pemasok,
  t.no_invoice,
  t.tanggal_invoice,
  t.bulan,
  t.tahun,
  t.gross,
  t.pph,
  t.net_seharusnya,
  k.transaksi_id,
  b.tanggal           as tanggal_transfer,
  b.keterangan        as keterangan_transfer,
  b.debit             as transfer_bank,
  k.selisih,
  coalesce(k.status, 'INVOICE_BELUM_ADA_TRANSFER') as status,
  coalesce(k.keyakinan, 0) as keyakinan,
  coalesce(k.alasan, '{}') as alasan,
  coalesce(k.dikonfirmasi, false) as dikonfirmasi,
  k.catatan,
  t.entitas
from tagihan_pemasok t
join pemasok p        on p.id = t.pemasok_id
left join kecocokan k on k.tagihan_id = t.id
left join transaksi_bank b on b.id = k.transaksi_id

union all

select
  null::uuid, null::uuid, '(tanpa tagihan)',
  null::text, null::date,
  extract(month from b.tanggal)::int,
  extract(year  from b.tanggal)::int,
  null::numeric(14,2), null::numeric(14,2), null::numeric(14,2),
  k.transaksi_id, b.tanggal, b.keterangan, b.debit,
  k.selisih, k.status, k.keyakinan, k.alasan, k.dikonfirmasi, k.catatan,
  b.entitas
from kecocokan k
join transaksi_bank b on b.id = k.transaksi_id
where k.tagihan_id is null;

grant select on audit_pembayaran_pemasok to service_role;

drop function if exists ringkasan_audit_pemasok(text, int, int, text, date, date);

create or replace function ringkasan_audit_pemasok(
  p_pemasok text default null,
  p_bulan   int  default null,
  p_tahun   int  default null,
  p_status  text default null,
  p_dari    date default null,
  p_sampai  date default null,
  p_entitas text default null
)
returns table (
  total_tagihan bigint,
  total_gross numeric,
  total_pph numeric,
  total_transfer numeric,
  total_selisih numeric,
  jumlah_menyimpang bigint
)
language sql
stable
set search_path = public
as $$
  select
    count(*),
    coalesce(sum(a.gross), 0),
    coalesce(sum(a.pph), 0),
    coalesce(sum(a.transfer_bank), 0),
    coalesce(sum(a.selisih), 0),
    count(*) filter (where a.status <> 'MATCH')
  from audit_pembayaran_pemasok a
  where (p_pemasok is null or p_pemasok = '' or a.pemasok ilike '%' || p_pemasok || '%')
    and (p_bulan   is null or a.bulan = p_bulan)
    and (p_tahun   is null or a.tahun = p_tahun)
    and (p_status  is null or p_status = '' or a.status = p_status)
    and (p_dari    is null or a.tanggal_invoice >= p_dari)
    and (p_sampai  is null or a.tanggal_invoice <= p_sampai)
    and (p_entitas is null or a.entitas = p_entitas);
$$;

select pg_notify('pgrst', 'reload schema');

-- Otomatisasi penomoran, stempel waktu, dan penguncian akses.

-- ---------------------------------------------------------------------------
-- Penomoran resi dan invoice
--
-- Nomor dibuat di database, bukan di aplikasi, supaya dua request yang masuk
-- bersamaan tidak pernah menghasilkan nomor kembar.
-- ---------------------------------------------------------------------------

create sequence if not exists seq_no_resi;
create sequence if not exists seq_no_invoice;

create or replace function set_no_resi()
returns trigger
language plpgsql
as $$
begin
  if new.no_resi is null or new.no_resi = '' then
    -- Contoh: ALS-2609-0042
    new.no_resi := 'ALS-'
      || to_char(now() at time zone 'Asia/Jakarta', 'YYMM')
      || '-'
      || lpad(nextval('seq_no_resi')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function set_no_invoice()
returns trigger
language plpgsql
as $$
begin
  if new.no_invoice is null or new.no_invoice = '' then
    new.no_invoice := 'INV-'
      || to_char(now() at time zone 'Asia/Jakarta', 'YYMM')
      || '-'
      || lpad(nextval('seq_no_invoice')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace trigger trg_pesanan_no_resi
  before insert on pesanan
  for each row execute function set_no_resi();

create or replace trigger trg_invoice_no_invoice
  before insert on invoice
  for each row execute function set_no_invoice();

-- ---------------------------------------------------------------------------
-- Stempel waktu perubahan
-- ---------------------------------------------------------------------------

create or replace function sentuh_diubah_pada()
returns trigger
language plpgsql
as $$
begin
  new.diubah_pada := now();
  return new;
end;
$$;

create or replace trigger trg_pesanan_diubah
  before update on pesanan
  for each row execute function sentuh_diubah_pada();

create or replace trigger trg_trip_diubah
  before update on trip
  for each row execute function sentuh_diubah_pada();

create or replace trigger trg_invoice_diubah
  before update on invoice
  for each row execute function sentuh_diubah_pada();

-- ---------------------------------------------------------------------------
-- Jejak status pesanan
--
-- Setiap perubahan status otomatis tercatat di tracking_event, supaya riwayat
-- tidak bergantung pada aplikasi mengingat untuk mencatat.
-- ---------------------------------------------------------------------------

create or replace function catat_perubahan_status()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into tracking_event (pesanan_id, status, catatan)
    values (new.id, new.status, 'Status otomatis tercatat');
  end if;
  return new;
end;
$$;

create or replace trigger trg_pesanan_jejak_status
  after insert or update of status on pesanan
  for each row execute function catat_perubahan_status();

-- ---------------------------------------------------------------------------
-- Keamanan
--
-- RLS dinyalakan tanpa policy sama sekali. Efeknya: kunci anon (yang boleh ada
-- di browser) tidak bisa membaca maupun menulis apa pun. Semua akses wajib
-- lewat API server yang memegang service_role. Kalau nanti butuh akses
-- langsung dari browser, tambahkan policy secara eksplisit per tabel.
-- ---------------------------------------------------------------------------

alter table kapal          enable row level security;
alter table driver         enable row level security;
alter table trip           enable row level security;
alter table pesanan        enable row level security;
alter table tracking_event enable row level security;
alter table invoice        enable row level security;

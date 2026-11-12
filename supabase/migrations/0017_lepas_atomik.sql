-- Pelepasan tautan yang ATOMIK: perubahan status dan jejak auditnya dalam satu
-- transaksi database.
--
-- ## Kenapa harus di database
--
-- Sebelumnya endpoint menjalankan dua perintah terpisah dari aplikasi: ubah
-- status, lalu tulis ke tautan_pembayaran_riwayat. Kalau perintah kedua gagal,
-- statusnya sudah telanjur berubah dan jejaknya tidak ada — pelepasan tanpa
-- bukti, justru di jalur yang paling perlu dibuktikan. supabase-js tidak punya
-- transaksi yang membentang antar-panggilan, jadi satu-satunya cara yang benar
-- adalah satu fungsi: tubuh fungsi PL/pgSQL berjalan dalam satu transaksi, dan
-- galat di mana pun membatalkan SELURUHNYA.
--
-- ## Permintaan bersamaan
--
-- Perubahannya bersyarat status lama. Dua permintaan pada transaksi yang sama:
-- yang kedua menunggu kunci baris, lalu — setelah yang pertama selesai —
-- membaca ulang barisnya, tidak lagi berstatus itu, dan TIDAK mengubah apa pun.
-- Fungsi mengembalikan nol baris untuk keadaan ini (bukan galat), supaya
-- pemanggilnya bisa menjawab 409 yang jelas alih-alih 500.
--
-- Tidak ada yang dihapus dan tidak ada tabel atau kolom baru. Hanya satu
-- fungsi, yang hanya bisa dipanggil service_role.

create or replace function lepas_tautan(
  p_transaksi_id    uuid,
  p_status_lama     text,
  p_status_baru     text,
  p_aksi            text,
  p_alasan          text,
  p_alasan_riwayat  text,
  p_oleh            text,
  p_batalkan        boolean
)
returns setof tautan_pembayaran
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_baru tautan_pembayaran%rowtype;
begin
  update tautan_pembayaran t
     set status          = p_status_baru,
         alasan          = p_alasan,
         dibatalkan_pada = case when p_batalkan then now()    else t.dibatalkan_pada end,
         dibatalkan_oleh = case when p_batalkan then p_oleh   else t.dibatalkan_oleh end
   where t.transaksi_id = p_transaksi_id
     and t.status       = p_status_lama
  returning t.* into v_baru;

  -- Status sudah berubah di antara pembacaan dan perubahan ini. Tidak ada yang
  -- ditulis, baik status maupun riwayat.
  if not found then
    return;
  end if;

  -- Gagal di sini membatalkan UPDATE di atas: keduanya satu transaksi.
  insert into tautan_pembayaran_riwayat
    (transaksi_id, aksi, supplier_id_lama, status_lama, status_baru, alasan, oleh)
  values
    (p_transaksi_id, p_aksi, v_baru.supplier_id, p_status_lama, v_baru.status,
     p_alasan_riwayat, p_oleh);

  return next v_baru;
end;
$$;

-- Supabase memberi EXECUTE ke anon dan authenticated pada fungsi baru di schema
-- public secara bawaan. Fungsi ini mengubah status pembayaran: hanya server
-- (service_role) yang boleh memanggilnya.
revoke all on function lepas_tautan(uuid, text, text, text, text, text, text, boolean) from public;
revoke all on function lepas_tautan(uuid, text, text, text, text, text, text, boolean) from anon;
revoke all on function lepas_tautan(uuid, text, text, text, text, text, text, boolean) from authenticated;
grant execute on function lepas_tautan(uuid, text, text, text, text, text, text, boolean) to service_role;

select pg_notify('pgrst', 'reload schema');

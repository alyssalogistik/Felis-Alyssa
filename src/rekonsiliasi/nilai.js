// Pengurai nilai mentah dari sel spreadsheet menjadi tanggal dan nominal.
// Semua fungsi di sini murni: tidak menyentuh berkas, jaringan, maupun database.

const BULAN_ID = [
  'januari', 'februari', 'maret', 'april', 'mei', 'juni',
  'juli', 'agustus', 'september', 'oktober', 'november', 'desember',
];

/** Excel menghitung hari sejak 1899-12-30, termasuk tahun kabisat 1900 yang keliru. */
const EPOCH_EXCEL = Date.UTC(1899, 11, 30);

function dariBagian(tahun, bulan, hari) {
  if (bulan < 1 || bulan > 12 || hari < 1 || hari > 31) return null;
  // Konstruksi di UTC lalu dibandingkan kembali: menolak tanggal seperti 31 April
  // yang diam-diam digeser oleh Date.
  const d = new Date(Date.UTC(tahun, bulan - 1, hari));
  if (d.getUTCFullYear() !== tahun || d.getUTCMonth() !== bulan - 1 || d.getUTCDate() !== hari) {
    return null;
  }
  return `${String(tahun).padStart(4, '0')}-${String(bulan).padStart(2, '0')}-${String(hari).padStart(2, '0')}`;
}

/**
 * Mengurai sel tanggal menjadi string `YYYY-MM-DD`.
 *
 * Tidak pernah mengembalikan objek Date. Rekening koran hanya punya tanggal,
 * tidak punya jam, sehingga menyimpannya sebagai teks polos menghilangkan
 * seluruh kelas bug "bergeser satu hari" akibat timezone.
 *
 * Mengembalikan { ok, tanggal, ambigu, alasan }. `ambigu` menandai tanggal
 * seperti 01/08/2026 yang bisa dibaca 1 Agustus maupun 8 Januari; nilainya
 * tetap diurai sebagai hari-dulu (kebiasaan Indonesia), tetapi pemanggil bisa
 * meminta konfirmasi pengguna.
 */
export function uraiTanggal(nilai) {
  if (nilai === null || nilai === undefined || nilai === '') {
    return { ok: false, alasan: 'Tanggal kosong.' };
  }

  // exceljs mengembalikan Date untuk sel bertipe tanggal. Bagiannya harus dibaca
  // dalam UTC; getFullYear() lokal bisa memundurkan tanggal satu hari.
  if (nilai instanceof Date) {
    if (Number.isNaN(nilai.getTime())) return { ok: false, alasan: 'Tanggal tidak valid.' };
    const t = dariBagian(nilai.getUTCFullYear(), nilai.getUTCMonth() + 1, nilai.getUTCDate());
    return t ? { ok: true, tanggal: t, ambigu: false } : { ok: false, alasan: 'Tanggal tidak valid.' };
  }

  // Angka mentah dari Excel: hari sejak epoch. Tidak ambigu, jadi didahulukan.
  if (typeof nilai === 'number') {
    if (!Number.isFinite(nilai) || nilai < 1 || nilai > 2958465) {
      return { ok: false, alasan: 'Angka tanggal Excel di luar rentang wajar.' };
    }
    const d = new Date(EPOCH_EXCEL + Math.floor(nilai) * 86400000);
    const t = dariBagian(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    return t ? { ok: true, tanggal: t, ambigu: false } : { ok: false, alasan: 'Tanggal tidak valid.' };
  }

  const teks = String(nilai).trim();
  if (teks === '') return { ok: false, alasan: 'Tanggal kosong.' };

  // ISO (2026-08-01): urutan sudah pasti tahun-bulan-hari.
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(teks);
  if (iso) {
    const t = dariBagian(+iso[1], +iso[2], +iso[3]);
    return t ? { ok: true, tanggal: t, ambigu: false } : { ok: false, alasan: `Tanggal tidak valid: ${teks}` };
  }

  // Nama bulan (01 Agustus 2026, 1 Agu 26): tidak ambigu.
  const namaBulan = /^(\d{1,2})\s+([A-Za-z]+)\.?\s+(\d{2,4})$/.exec(teks);
  if (namaBulan) {
    const cocok = BULAN_ID.findIndex((b) => b.startsWith(namaBulan[2].toLowerCase().slice(0, 3)));
    if (cocok >= 0) {
      const tahun = namaBulan[3].length <= 2 ? 2000 + +namaBulan[3] : +namaBulan[3];
      const t = dariBagian(tahun, cocok + 1, +namaBulan[1]);
      if (t) return { ok: true, tanggal: t, ambigu: false };
    }
    return { ok: false, alasan: `Nama bulan tidak dikenali: ${teks}` };
  }

  // Berpemisah (01/08/2026, 01-08-2026, 01.08.2026): urutan hari-dulu.
  const pisah = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(teks);
  if (pisah) {
    const hari = +pisah[1];
    const bulan = +pisah[2];
    const tahun = pisah[3].length <= 2 ? 2000 + +pisah[3] : +pisah[3];
    const t = dariBagian(tahun, bulan, hari);
    if (!t) return { ok: false, alasan: `Tanggal tidak valid: ${teks}` };
    // Kalau hari juga <= 12, pembacaan bulan-dulu sama masuk akalnya.
    return { ok: true, tanggal: t, ambigu: hari <= 12 };
  }

  return { ok: false, alasan: `Format tanggal tidak dikenali: ${teks}` };
}

/**
 * Mengurai sel nominal menjadi angka.
 *
 * Menangani gaya Indonesia (1.234.567,89) maupun Inggris (1,234,567.89) tanpa
 * perlu tahu asal berkasnya: ketika kedua pemisah muncul, yang terakhir adalah
 * pemisah desimal. Ketika hanya satu jenis yang muncul sekali, tepat tiga digit
 * di belakangnya berarti pemisah ribuan — desimal rupiah lazimnya dua digit.
 *
 * Sel kosong dan tanda hubung dibaca sebagai 0, karena rekening koran
 * mengosongkan kolom yang tidak terpakai pada baris tersebut.
 */
export function uraiNominal(nilai) {
  if (nilai === null || nilai === undefined) return { ok: true, nilai: 0 };

  if (typeof nilai === 'number') {
    return Number.isFinite(nilai)
      ? { ok: true, nilai: Math.round(nilai * 100) / 100 }
      : { ok: false, alasan: 'Nominal bukan angka terhingga.' };
  }

  let teks = String(nilai).trim();
  if (teks === '' || teks === '-' || teks === '‑') return { ok: true, nilai: 0 };

  // (500.000) adalah notasi akuntansi untuk nilai negatif.
  let negatif = false;
  if (/^\(.*\)$/.test(teks)) {
    negatif = true;
    teks = teks.slice(1, -1).trim();
  }

  teks = teks.replace(/^(rp\.?|idr)\s*/i, '').replace(/\s/g, '');
  if (teks.startsWith('-')) {
    negatif = true;
    teks = teks.slice(1);
  }
  // Sebagian rekening koran menandai arah mutasi dengan akhiran DB/CR.
  teks = teks.replace(/(db|cr|d|k)$/i, '');

  if (!/^[\d.,]+$/.test(teks) || teks === '') {
    return { ok: false, alasan: `Nominal tidak dikenali: ${nilai}` };
  }

  const titik = teks.lastIndexOf('.');
  const koma = teks.lastIndexOf(',');
  let desimal = -1;

  if (titik >= 0 && koma >= 0) {
    desimal = Math.max(titik, koma);
  } else if (titik >= 0 || koma >= 0) {
    const posisi = Math.max(titik, koma);
    const simbol = titik >= 0 ? '.' : ',';
    const jumlahMuncul = teks.split(simbol).length - 1;
    const digitBelakang = teks.length - posisi - 1;
    // Muncul berkali-kali, atau tepat tiga digit di belakang: pemisah ribuan.
    if (jumlahMuncul === 1 && digitBelakang !== 3) desimal = posisi;
  }

  const bulat = (desimal >= 0 ? teks.slice(0, desimal) : teks).replace(/[.,]/g, '');
  const pecahan = desimal >= 0 ? teks.slice(desimal + 1).replace(/[.,]/g, '') : '';

  const angka = Number(`${bulat || '0'}.${pecahan || '0'}`);
  if (!Number.isFinite(angka)) return { ok: false, alasan: `Nominal tidak dikenali: ${nilai}` };

  return { ok: true, nilai: Math.round(angka * 100) / 100 * (negatif ? -1 : 1) };
}

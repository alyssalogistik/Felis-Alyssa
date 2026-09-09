// Membaca daftar tagihan supplier dari berkas XLSX/CSV.
//
// Memakai pembaca berkas, pengurai nilai, dan pendeteksi header yang sama
// dengan rekening koran — hanya kamus kolomnya yang berbeda. Menyalin logikanya
// akan membuat dua tempat bisa menyimpang dalam menafsirkan tanggal dan nominal.

import { uraiTanggal, uraiNominal } from './nilai.js';
import { cariHeader, KAMUS_TAGIHAN, pemetaanTagihanLengkap } from './pemetaan.js';
import { GalatFormat } from './parser.js';
import { bukaBerkas } from './baca.js';

const PESAN_TIDAK_DIKENALI =
  'Format daftar tagihan belum dikenali. Periksa kolom Supplier, No Invoice, ' +
  'Tanggal, Gross/Total, dan PPh.';

function barisKosong(baris) {
  return baris.every((sel) => sel === null || sel === undefined || String(sel).trim() === '');
}

/**
 * Menguraikan tabel tagihan menjadi baris siap simpan.
 *
 * Gross, PPh, dan Net saling berkaitan, dan berkas di lapangan jarang memuat
 * ketiganya. Yang hilang diturunkan dari dua lainnya, dan bila ketiganya ada
 * tetapi tidak konsisten, barisnya ditandai alih-alih dipilih diam-diam salah
 * satu — selisih pajak justru hal yang paling perlu ketahuan saat audit.
 */
export function uraiTabelTagihan(baris, { berkasSumber = '' } = {}) {
  const header = cariHeader(baris, {
    kamus: KAMUS_TAGIHAN,
    lengkap: pemetaanTagihanLengkap,
  });
  if (!header) throw new GalatFormat(PESAN_TIDAK_DIKENALI);

  const { peta, indeks: barisHeader } = header;
  const ambil = (b, bidang) => (peta[bidang] === undefined ? null : b[peta[bidang]] ?? null);

  const tagihan = [];

  for (let i = barisHeader + 1; i < baris.length; i += 1) {
    const b = baris[i] ?? [];
    if (barisKosong(b)) continue;

    const masalah = [];

    const pemasok = String(ambil(b, 'pemasok') ?? '').trim();
    if (pemasok === '') masalah.push('Nama supplier kosong.');

    const tgl = uraiTanggal(ambil(b, 'tanggal'));
    if (!tgl.ok) masalah.push(tgl.alasan);

    const noInvoice = String(ambil(b, 'no_invoice') ?? '').trim();

    const gRaw = uraiNominal(ambil(b, 'gross'));
    const pRaw = uraiNominal(ambil(b, 'pph'));
    const nRaw = uraiNominal(ambil(b, 'net'));

    const adaGross = peta.gross !== undefined && gRaw.ok && gRaw.nilai !== 0;
    const adaNet = peta.net !== undefined && nRaw.ok && nRaw.nilai !== 0;
    const adaPph = peta.pph !== undefined && pRaw.ok;

    let gross = adaGross ? Math.abs(gRaw.nilai) : null;
    let pph = adaPph ? Math.abs(pRaw.nilai) : 0;
    const net = adaNet ? Math.abs(nRaw.nilai) : null;

    if (gross === null && net !== null) {
      // Hanya net yang tersedia: PPh dianggap sudah tercermin di situ.
      gross = net + pph;
    } else if (gross !== null && net !== null && !adaPph) {
      // Gross dan net ada tanpa kolom PPh: selisihnya adalah potongannya.
      pph = Math.max(gross - net, 0);
    } else if (gross !== null && net !== null && adaPph) {
      const seharusnya = Math.round((gross - pph) * 100);
      if (Math.abs(seharusnya - Math.round(net * 100)) > 100) {
        masalah.push(
          `Gross ${gross} dikurangi PPh ${pph} tidak sama dengan Net ${net} di berkas.`
        );
      }
    }

    if (gross === null) masalah.push('Nilai tagihan tidak terbaca.');
    if (gross !== null && pph > gross) masalah.push('PPh lebih besar daripada gross.');

    const jatuhTempo = peta.jatuh_tempo !== undefined ? uraiTanggal(ambil(b, 'jatuh_tempo')) : null;

    tagihan.push({
      baris_sumber: i + 1,
      berkas_sumber: berkasSumber,
      pemasok_nama: pemasok,
      no_invoice: noInvoice,
      tanggal_invoice: tgl.ok ? tgl.tanggal : null,
      tanggal_ambigu: Boolean(tgl.ambigu),
      jatuh_tempo: jatuhTempo?.ok ? jatuhTempo.tanggal : null,
      gross: gross ?? 0,
      pph,
      net_seharusnya: gross === null ? 0 : Math.round((gross - pph) * 100) / 100,
      keterangan: String(ambil(b, 'keterangan') ?? '').trim() || null,
      masalah,
      layak_simpan: masalah.length === 0 && pemasok !== '' && noInvoice !== '' && tgl.ok,
    });
  }

  if (tagihan.length === 0) throw new GalatFormat(PESAN_TIDAK_DIKENALI);
  return { tagihan, peta, barisHeader: barisHeader + 1 };
}

/** Membaca berkas daftar tagihan, memakai sheet pertama yang tabelnya dikenali. */
export async function bacaTagihan(buffer, namaBerkas = '') {
  const sheets = await bukaBerkas(buffer, namaBerkas);

  const galat = [];
  for (const sheet of sheets) {
    try {
      const hasil = uraiTabelTagihan(sheet.baris, { berkasSumber: namaBerkas });
      return { ...hasil, sheet: sheet.nama };
    } catch (error) {
      if (!(error instanceof GalatFormat)) throw error;
      galat.push(error);
    }
  }

  throw galat[0] ?? new GalatFormat(PESAN_TIDAK_DIKENALI);
}

/** Ringkasan mutu daftar tagihan setelah diurai. */
export function ringkasTagihan(tagihan) {
  return {
    total: tagihan.length,
    layak: tagihan.filter((t) => t.layak_simpan).length,
    bermasalah: tagihan.filter((t) => !t.layak_simpan).length,
    total_gross: tagihan.reduce((a, t) => a + Math.round(t.gross * 100), 0) / 100,
    total_pph: tagihan.reduce((a, t) => a + Math.round(t.pph * 100), 0) / 100,
  };
}

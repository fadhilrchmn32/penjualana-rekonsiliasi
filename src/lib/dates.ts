const MONTHS_ID = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

export function todayISOJakarta(): string {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(now);
}

export function formatDateID(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const clean = isoDate.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length !== 3) return isoDate;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

export function formatDateTimeJakarta(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) return '-';
  const d = new Date(isoTimestamp);
  if (Number.isNaN(d.getTime())) return isoTimestamp;
  const datePart = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
  const timePart = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return `${datePart} ${timePart} WIB`;
}

export function computeISOWeek(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (!m) return '-';
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

export function computeMonthCode(isoDate: string | null | undefined): string {
  if (!isoDate) return '-';
  const m = /^(\d{4})-(\d{2})/.exec(isoDate);
  if (!m) return '-';
  return `${m[1]}-${m[2]}`;
}

export function formatMonthLabelID(isoMonthOrDate: string | null | undefined): string {
  if (!isoMonthOrDate) return '-';
  const m = /^(\d{4})-(\d{2})/.exec(isoMonthOrDate);
  if (!m) return isoMonthOrDate;
  const monthIdx = Number(m[2]) - 1;
  const name = MONTHS_ID[monthIdx] ?? m[2];
  return `${name} ${m[1]}`;
}

export type ExplicitDateFormat = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'UNCONFIRMED';

/**
 * Parsing tanggal yang ketat & deterministik:
 * String ambigu seperti "04/05/26" atau "5/4/2026" TIDAK pernah di-parse dengan locale browser.
 * Wajib mengonfirmasi format (DD/MM/YYYY vs MM/DD/YYYY vs YYYY-MM-DD) sebelum dikonversi ke ISO YYYY-MM-DD.
 */
export function parseExplicitDate(
  raw: unknown,
  confirmedFormat: ExplicitDateFormat
): { isoDate: string | null; error?: string } {
  if (raw === null || raw === undefined || String(raw).trim() === '') {
    return { isoDate: null, error: 'Tanggal kosong' };
  }

  // Excel serial number (only safe when explicitly numeric cell)
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 20000 && raw < 90000) {
    const utcDays = Math.floor(raw - 25569);
    const d = new Date(utcDays * 86400000);
    return { isoDate: d.toISOString().slice(0, 10) };
  }

  const s = String(raw).trim();
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (isoMatch) {
    return validateCalendarDate(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
  }

  if (confirmedFormat === 'UNCONFIRMED') {
    return {
      isoDate: null,
      error: `Format tanggal "${s}" belum dikonfirmasi (konfirmasi DD/MM/YYYY atau MM/DD/YYYY terlebih dahulu).`,
    };
  }

  const slashMatch = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(s);
  if (!slashMatch) {
    return { isoDate: null, error: `Format tanggal "${s}" tidak dikenali.` };
  }

  const p1 = Number(slashMatch[1]);
  const p2 = Number(slashMatch[2]);
  let yr = Number(slashMatch[3]);
  if (slashMatch[3].length === 2) {
    yr += yr >= 70 ? 1900 : 2000;
  }

  if (confirmedFormat === 'DD/MM/YYYY') {
    return validateCalendarDate(yr, p2, p1);
  }
  if (confirmedFormat === 'MM/DD/YYYY') {
    return validateCalendarDate(yr, p1, p2);
  }
  return { isoDate: null, error: `Tanggal "${s}" tidak sesuai format ${confirmedFormat}.` };
}

function validateCalendarDate(year: number, month: number, day: number): { isoDate: string | null; error?: string } {
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { isoDate: null, error: `Tanggal kalender tidak valid (${day}/${month}/${year}).` };
  }
  const d = new Date(Date.UTC(year, month - 1, day));
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return { isoDate: null, error: `Tanggal kalender tidak valid (${day}/${month}/${year}).` };
  }
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { isoDate: iso };
}

export function daysBetweenISO(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${toISO.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86400000);
}

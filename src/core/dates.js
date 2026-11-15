/**
 * Utilitários de datas (UTC midnight) para evitar desvios de fuso/horário de verão.
 */

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

export function makeUtcDate(year, month1Based, day) {
  if (!Number.isInteger(year) || !Number.isInteger(month1Based) || !Number.isInteger(day)) return null;
  if (year < 1901 || month1Based < 1 || month1Based > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month1Based - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month1Based - 1 || d.getUTCDate() !== day) {
    return null;
  }
  return d;
}

export function excelSerialToDate(serial) {
  const num = typeof serial === 'number' ? serial : Number(String(serial ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(num) || num < 1000) return null;
  const days = Math.floor(num);
  return new Date(EXCEL_EPOCH_MS + days * DAY_MS);
}

export function parseBRDate(str) {
  const s = String(str ?? '').trim();
  if (!s || s === '00/01/1900') return null;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;
  return makeUtcDate(year, month, day);
}

export function parseAnyDate(val) {
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    return makeUtcDate(val.getUTCFullYear(), val.getUTCMonth() + 1, val.getUTCDate());
  }
  if (typeof val === 'number') return excelSerialToDate(val);
  const s = String(val ?? '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return excelSerialToDate(Number(s));
  const br = parseBRDate(s);
  if (br) return br;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return makeUtcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  return null;
}

export function formatBRDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  return `${dd}/${mm}/${yyyy}`;
}

export function formatShortBRDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

export function toIsoKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = String(date.getUTCFullYear()).padStart(4, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function todayUtc(now = new Date()) {
  return makeUtcDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Equivalente a WORKDAY.INTL(startDate, businessDays, 1, holidays)
 * Finais de semana = Sábado (6) e Domingo (0).
 */
export function addWorkdays(startDate, businessDays, holidaySet = new Set()) {
  if (!(startDate instanceof Date) || Number.isNaN(startDate.getTime())) return null;
  let remaining = Math.trunc(Number(businessDays) || 0);
  const step = remaining >= 0 ? 1 : -1;
  remaining = Math.abs(remaining);

  let current = new Date(startDate.getTime());
  while (remaining > 0) {
    current = new Date(current.getTime() + step * DAY_MS);
    const dow = current.getUTCDay();
    if (dow === 0 || dow === 6) continue;
    if (holidaySet && holidaySet.size > 0 && holidaySet.has(toIsoKey(current))) continue;
    remaining--;
  }
  return current;
}

export function addCalendarDays(date, days) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + Math.trunc(days) * DAY_MS);
}

export function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a.getTime() >= b.getTime() ? a : b;
}

export function diffCalendarDays(a, b) {
  if (!a || !b) return NaN;
  return Math.round((a.getTime() - b.getTime()) / DAY_MS);
}

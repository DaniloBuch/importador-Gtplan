/**
 * utils.js
 * Funções puras (sem DOM) de normalização, números e datas.
 *
 * Convenção de datas: todas as datas do domínio são objetos Date em
 * MEIA-NOITE UTC. Isso elimina bugs de fuso/horário de verão ao comparar dias.
 */

const MS_DAY = 86_400_000;
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/* ----------------------------- Strings / códigos ---------------------------- */

/** Remove apóstrofo inicial, espaços e zeros à esquerda ("'000648" -> "648"). */
export function normalizeCode(value) {
  return String(value ?? '')
    .trim()
    .replace(/^'+/, '')
    .replace(/^0+(?=.)/, '');
}

/** Completa com zeros à esquerda ("462", 6 -> "000462"). */
export function padCode(value, size = 6) {
  const s = normalizeCode(value);
  return s ? s.padStart(size, '0') : '';
}

/** Normaliza texto para comparação: minúsculo, sem acento, sem espaços extras. */
export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Chave de cabeçalho tolerante: "Descr.Produt" == "descr produt" == "DESCR. PRODUT". */
export function headerKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

/* --------------------------------- Números --------------------------------- */

/**
 * Converte número em formato BR ou US para Number.
 * "0.54" -> 0.54 | "2,1" -> 2.1 | "1.234,56" -> 1234.56 | 12 -> 12 | "" -> NaN
 */
export function parseNumber(value) {
  if (typeof value === 'number') return value;
  let s = String(value ?? '').trim();
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  return Number(s);
}

/** Verifica se `qty` é múltiplo exato de `multiple` (tolerante a ponto flutuante). */
export function isMultiple(qty, multiple) {
  if (!Number.isFinite(qty) || !Number.isFinite(multiple) || multiple <= 0) return true;
  const ratio = qty / multiple;
  return Math.abs(ratio - Math.round(ratio)) < 1e-9;
}

/** 12.3 -> "12,3000" (formato pt-BR com casas fixas). */
export function formatDecimalBR(value, decimals = 2) {
  return Number(value).toFixed(decimals).replace('.', ',');
}

/* ---------------------------------- Datas ---------------------------------- */

export function makeDate(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day));
}

/** "Hoje" como meia-noite UTC baseada no calendário local. */
export function todayUTC(now = new Date()) {
  return makeDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/**
 * Aceita: serial do Excel (46262), Date, "dd/mm/aaaa[ hh:mm]", "aaaa-mm-dd".
 * Retorna Date (UTC 00:00) ou null.
 */
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : makeDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return new Date(EXCEL_EPOCH + Math.floor(value) * MS_DAY);
  }

  const s = String(value).trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return validDate(+m[3], +m[2], +m[1]);

  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validDate(+m[1], +m[2], +m[3]);

  // Serial do Excel vindo como texto ("46262")
  if (/^\d{5}(\.\d+)?$/.test(s)) return parseDate(Number(s));
  return null;
}

function validDate(y, mo, d) {
  const dt = makeDate(y, mo, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt : null;
}

const two = (n) => String(n).padStart(2, '0');

/** Date -> "dd/mm/aaaa" */
export function formatDate(date) {
  if (!date) return '';
  return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** Date -> "dd/mm" (prefixo das observações) */
export function formatDayMonth(date) {
  if (!date) return '';
  return `${two(date.getUTCDate())}/${two(date.getUTCMonth() + 1)}`;
}

/** Date -> "aaaammdd" (nomes de arquivo) */
export function formatCompact(date) {
  return `${date.getUTCFullYear()}${two(date.getUTCMonth() + 1)}${two(date.getUTCDate())}`;
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * MS_DAY);
}

/** Diferença em dias corridos (a - b). */
export function diffDays(a, b) {
  return Math.round((a.getTime() - b.getTime()) / MS_DAY);
}

const isWeekend = (d) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

/**
 * Equivalente ao WORKDAY.INTL do Excel (fim de semana = sáb/dom).
 * @param {Date} date
 * @param {number} days  dias úteis a somar (>= 0)
 * @param {Set<string>} [holidays] datas "dd/mm/aaaa" a ignorar
 */
export function addWorkdays(date, days, holidays = new Set()) {
  let d = date;
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    d = addDays(d, 1);
    if (!isWeekend(d) && !holidays.has(formatDate(d))) remaining--;
  }
  return d;
}

/** Maior data ignorando nulos. */
export function maxDate(...dates) {
  const valid = dates.filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((a, b) => (b.getTime() > a.getTime() ? b : a));
}

/** Remove o prefixo "dd/mm: " de uma observação (para comparar conteúdo). */
export function stripObsDatePrefix(obs) {
  return String(obs ?? '').replace(/^\s*\d{2}\/\d{2}\s*:\s*/, '').trim();
}

/** Duas observações dizem a mesma coisa (ignorando data do prefixo e acentos)? */
export function sameObservation(a, b) {
  return normalizeText(stripObsDatePrefix(a)) === normalizeText(stripObsDatePrefix(b));
}

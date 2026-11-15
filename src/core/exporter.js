/**
 * exporter.js
 * Monta o(s) CSV(s) de upload no GTplan. Funções puras: a serialização é
 * injetável (no navegador usamos Papa.unparse; nos testes, serializeCsv).
 */
import { CSV_DELIMITER, CSV_NEWLINE, EXPORT_CHUNK_SIZE, GTPLAN_HEADER, STATUS, UTF8_BOM } from '../config.js';
import { formatCompact, normalizeText } from './utils.js';

/** Garante UM apóstrofo no início do ID Ordem (o Excel não converte em número). */
export function ensureApostrophe(idOrdem) {
  const s = String(idOrdem ?? '').trim().replace(/^'+/, '');
  return s ? `'${s}` : '';
}

/** Linha final (array na ordem exata do cabeçalho) a partir de um resultado. */
export function toExportRecord(result) {
  const values = {
    ...result.row.original,
    'ID Ordem': ensureApostrophe(result.row.original['ID Ordem']),
    'Nova Prev. Entrega': result.novaPrevEntrega ?? '',
    'Núm. NF': result.numNF ?? '',
    'Dt. NF': result.dtNF ?? '',
    'Motivo': result.motivoCodigo ?? '',
    'Observação': result.observacao ?? '',
  };
  return GTPLAN_HEADER.map((h) => String(values[h] ?? ''));
}

/** A resposta é idêntica ao que já está gravado no GTplan? */
export function isUnchanged(result) {
  const o = result.row.original;
  const motivoIgual = [result.motivoCodigo, normalizeText(result.motivoDescricao)]
    .filter(Boolean)
    .some((v) => v === o['Motivo'] || v === normalizeText(o['Motivo']));
  return motivoIgual
    && (result.observacao ?? '') === o['Observação']
    && (result.novaPrevEntrega ?? '') === o['Nova Prev. Entrega']
    && (result.numNF ?? '') === o['Núm. NF']
    && (result.dtNF ?? '') === o['Dt. NF'];
}

/**
 * Linhas que vão para o arquivo: somente as resolvidas (🟢) e, opcionalmente,
 * apenas as que mudaram algo (o limite de 1000 conta linhas respondidas).
 */
export function selectExportable(results, { skipUnchanged = true } = {}) {
  return results.filter((r) => r.status === STATUS.PRONTO && r.motivoCodigo && !(skipUnchanged && isUnchanged(r)));
}

export function chunk(array, size = EXPORT_CHUNK_SIZE) {
  if (size <= 0) throw new Error('chunk size deve ser > 0');
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

/** Nome sem acentos/ç (exigência do GTplan): respostas_follow_up_20261115_parte01.csv */
export function buildFileName(date, part, total) {
  const suffix = total > 1 ? `_parte${String(part).padStart(2, '0')}` : '';
  return `respostas_follow_up_${formatCompact(date)}${suffix}.csv`;
}

/** Serializador CSV mínimo (RFC 4180) — fallback/testes. */
export function serializeCsv(matrix, delimiter = CSV_DELIMITER) {
  const esc = (v) => {
    const s = String(v ?? '');
    return /["\r\n]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return matrix.map((row) => row.map(esc).join(delimiter)).join(CSV_NEWLINE);
}

/** Matriz -> texto CSV com BOM UTF-8. */
export function toCsvString(matrix, unparse = serializeCsv) {
  return UTF8_BOM + unparse(matrix);
}

/**
 * Gera os lotes prontos para download.
 * @returns {{fileName:string, rowCount:number, matrix:string[][]}[]}
 */
export function buildExportBatches(results, { date, chunkSize = EXPORT_CHUNK_SIZE, skipUnchanged = true } = {}) {
  const rows = selectExportable(results, { skipUnchanged }).map(toExportRecord);
  const parts = chunk(rows, chunkSize);
  return parts.map((part, i) => ({
    fileName: buildFileName(date, i + 1, parts.length),
    rowCount: part.length,
    matrix: [[...GTPLAN_HEADER], ...part],
  }));
}

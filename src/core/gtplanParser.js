/**
 * gtplanParser.js
 * Valida e normaliza as linhas do CSV exportado pelo GTplan (layout novo, 24 colunas).
 * Função pura: recebe objetos já parseados (PapaParse com header:true).
 */
import { GTPLAN_HEADER } from '../config.js';
import { parseDate, parseNumber, normalizeCode } from './utils.js';

/** Colunas típicas do layout ANTIGO (para dar uma mensagem de erro útil). */
const LEGACY_MARKERS = ['Cod. Item', 'Cod. Estab.', 'Num. Ordem', 'Quantidade Pendente'];

const cleanHeader = (h) => String(h ?? '').replace(/^\uFEFF/, '').trim();

/**
 * @param {string[]} fields cabeçalho lido do arquivo
 * @returns {{ok:boolean, missing:string[], extra:string[], legacy:boolean}}
 */
export function validateGtplanHeader(fields) {
  const clean = (fields ?? []).map(cleanHeader);
  const set = new Set(clean);
  const missing = GTPLAN_HEADER.filter((h) => !set.has(h));
  const extra = clean.filter((h) => h && !GTPLAN_HEADER.includes(h));
  const legacy = LEGACY_MARKERS.some((m) => set.has(m));
  return { ok: missing.length === 0, missing, extra, legacy };
}

/**
 * Converte as linhas cruas do CSV em um modelo tipado, preservando o original
 * (o original é reescrito no export, apenas com as colunas de resposta alteradas).
 * @param {Record<string,string>[]} rawRows
 */
export function normalizeGtplanRows(rawRows) {
  return (rawRows ?? [])
    .map((raw) => {
      const original = {};
      for (const h of GTPLAN_HEADER) original[h] = String(raw[h] ?? raw[`\uFEFF${h}`] ?? '').trim();
      return original;
    })
    .filter((o) => o['Cód. Cliente'] || o['ID Ordem'])
    .map((original, index) => ({
      id: index,
      original,
      codCliente: normalizeCode(original['Cód. Cliente']),
      cliente: original['Cliente'],
      idOrdem: original['ID Ordem'],
      numOC: normalizeCode(original['Núm. OC']),
      codItem: original['Cód. Item'],
      descItem: original['Desc. Item'],
      estab: original['Estab.'],
      codItemFornecedor: original['Cód. Item Fornecedor'],
      unidade: original['Unidade'],
      valUnit: parseNumber(original['Val. Unit.']),
      qtdPendente: parseNumber(original['Qtd. Pendente']),
      dtOC: parseDate(original['Dt. OC']),
      dtEntregaOriginal: parseDate(original['Dt. Entrega Original']),
      prevEntregaAtual: parseDate(original['Prev. Entrega Atual']),
      motivoAtual: original['Motivo'],
      obsAtual: original['Observação'],
    }));
}

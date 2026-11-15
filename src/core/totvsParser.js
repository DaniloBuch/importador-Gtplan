/**
 * totvsParser.js
 * Transforma a planilha do TOTVS (aba "Dados Simplificados" do bimestre) em um
 * índice O(1) pela chave composta  cod_cbs + Núm. OC.
 * Função pura: recebe uma matriz (array de arrays) — quem lê o arquivo é a camada io/.
 */
import { headerKey, padCode, normalizeCode, parseDate, parseNumber } from './utils.js';

/** Campo interno -> nomes aceitos no cabeçalho (comparação tolerante via headerKey). */
export const TOTVS_COLUMNS = Object.freeze({
  pedido: ['Pedido'],
  cliente: ['Cliente'],
  loja: ['Loja'],
  produto: ['Produto', 'Cod CBS', 'Codigo'],
  descricao: ['Descr.Produt', 'Descricao', 'Descrição'],
  saldo: ['Saldo Disp.', 'Saldo'],
  bloqueio: ['Bloq.Estoque', 'Bloqueio'],
  emissaoNF: ['Emissao NF', 'Emissão NF'],
  notaFiscal: ['Nota Fiscal', 'NF'],
  dataEntrega: ['Data Entrega'],
  oc: ['OC', 'Ordem de Compra'],
  valorUnit: ['Valor Unit', 'Valor Unitario'],
  qtdEmbalagem: ['Qntd Embalagem', 'Qtd Embalagem'],
  ruptura: ['Ruptura'],
});

const REQUIRED = ['produto', 'oc'];

/** Chave composta usada no cruzamento GTplan x TOTVS. */
export const totvsKey = (codCbs, numOC) => `${padCode(codCbs, 6)}|${normalizeCode(numOC)}`;

/** Procura a linha de cabeçalho nas primeiras 15 linhas. */
export function findHeaderRow(matrix) {
  const wanted = REQUIRED.map((f) => TOTVS_COLUMNS[f].map(headerKey));
  for (let i = 0; i < Math.min(15, matrix.length); i++) {
    const keys = (matrix[i] ?? []).map(headerKey);
    if (wanted.every((aliases) => aliases.some((a) => keys.includes(a)))) return i;
  }
  return -1;
}

/**
 * @param {any[][]} matrix linhas da planilha (inclui cabeçalho)
 * @returns {{records: object[], columns: Record<string, number>}}
 */
export function mapTotvsRows(matrix) {
  const headerIdx = findHeaderRow(matrix);
  if (headerIdx < 0) {
    throw new Error('Planilha TOTVS inválida: cabeçalho com as colunas "Produto" e "OC" não encontrado.');
  }
  const header = matrix[headerIdx].map(headerKey);
  const columns = {};
  for (const [field, aliases] of Object.entries(TOTVS_COLUMNS)) {
    const idx = aliases.map(headerKey).map((a) => header.indexOf(a)).find((i) => i >= 0);
    if (idx !== undefined) columns[field] = idx;
  }

  const get = (row, field) => (columns[field] === undefined ? '' : row[columns[field]]);
  const records = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || !normalizeCode(get(row, 'produto'))) continue;
    const nf = normalizeCode(get(row, 'notaFiscal'));
    records.push({
      linha: i + 1,
      pedido: String(get(row, 'pedido') ?? '').trim(),
      cliente: String(get(row, 'cliente') ?? '').trim(),
      loja: String(get(row, 'loja') ?? '').trim(),
      produto: padCode(get(row, 'produto'), 6),
      descricao: String(get(row, 'descricao') ?? '').trim(),
      saldo: parseNumber(get(row, 'saldo')),
      bloqueio: padCode(get(row, 'bloqueio'), 2),
      emissaoNF: parseDate(get(row, 'emissaoNF')),
      notaFiscal: nf && Number(nf) !== 0 ? nf.padStart(9, '0') : '',
      dataEntrega: parseDate(get(row, 'dataEntrega')),
      oc: normalizeCode(get(row, 'oc')),
      valorUnit: parseNumber(get(row, 'valorUnit')),
      qtdEmbalagem: parseNumber(get(row, 'qtdEmbalagem')),
      ruptura: parseDate(get(row, 'ruptura')),
    });
  }
  return { records, columns };
}

/**
 * Índice por chave composta. Em chaves duplicadas, mantém o primeiro registro,
 * exceto quando um posterior tem NF e o atual não (a NF é a informação mais útil).
 * @returns {Map<string, object>}
 */
export function buildTotvsIndex(records) {
  const index = new Map();
  for (const r of records) {
    if (!r.oc) continue;
    const key = totvsKey(r.produto, r.oc);
    const current = index.get(key);
    if (!current || (!current.notaFiscal && r.notaFiscal)) index.set(key, r);
  }
  return index;
}

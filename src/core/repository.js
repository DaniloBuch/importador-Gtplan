/**
 * repository.js
 * Camada de acesso às tabelas de referência (Repository Pattern).
 * Hoje lê arrays mockados; amanhã pode ler de uma API sem alterar o motor de regras.
 */
import { normalizeCode, normalizeText } from './utils.js';

/**
 * @param {{estabelecimentos:any[], produtos_depara:any[], motivos_gtplan:any[], frases_resolucao:any[]}} db
 */
export function createRepository(db) {
  const estabelecimentos = new Map(
    (db.estabelecimentos ?? []).map((e) => [normalizeCode(e.cod_cliente), e]),
  );

  // De-para: chave "cliente|item" (específico) tem prioridade sobre "item" (genérico).
  const depara = new Map();
  for (const p of db.produtos_depara ?? []) {
    const item = normalizeCode(p.cod_item_gtplan);
    const key = p.cod_cliente ? `${normalizeCode(p.cod_cliente)}|${item}` : item;
    if (!depara.has(key)) depara.set(key, p);
  }

  const motivos = new Map();
  const motivosPorCliente = new Map();
  for (const m of db.motivos_gtplan ?? []) {
    const cli = normalizeCode(m.cod_cliente);
    motivos.set(`${cli}_${m.intent}`, m);
    if (!motivosPorCliente.has(cli)) motivosPorCliente.set(cli, []);
    motivosPorCliente.get(cli).push(m);
  }

  const frases = db.frases_resolucao ?? [];
  const frasesById = new Map(frases.map((f) => [f.id, f]));

  return {
    /** @returns {object|null} */
    getEstabelecimento(codCliente) {
      return estabelecimentos.get(normalizeCode(codCliente)) ?? null;
    },

    /** Busca o de-para do item, priorizando a regra específica do cliente. */
    getDePara(codCliente, codItem) {
      const item = normalizeCode(codItem);
      if (!item) return null;
      return depara.get(`${normalizeCode(codCliente)}|${item}`) ?? depara.get(item) ?? null;
    },

    /** Chave composta cliente + intenção -> motivo {codigo, descricao}. */
    getMotivo(codCliente, intent) {
      if (!intent) return null;
      return motivos.get(`${normalizeCode(codCliente)}_${intent}`) ?? null;
    },

    /**
     * Identifica um motivo já gravado no GTplan (o export traz a DESCRIÇÃO,
     * o import aceita código ou descrição).
     */
    findMotivoByValue(codCliente, value) {
      const v = normalizeText(value);
      if (!v) return null;
      const list = motivosPorCliente.get(normalizeCode(codCliente)) ?? [];
      return list.find((m) => m.codigo === String(value).trim() || normalizeText(m.descricao) === v) ?? null;
    },

    listFrases() {
      return frases;
    },

    getFrase(id) {
      return frasesById.get(id) ?? null;
    },
  };
}

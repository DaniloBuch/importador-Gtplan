/**
 * rulesEngine.js
 * Motor de decisão em CASCATA (Chain of Responsibility).
 *
 * Fluxo por linha do GTplan:
 *   1. Identifica o cliente (Cód. Cliente) e o SLA do estabelecimento.
 *   2. Busca o de-para (cod_item_gtplan -> cod_cbs, multiplicador). Sem de-para => 🔴.
 *   3. Cruza com o TOTVS pela chave composta cod_cbs + Núm. OC.
 *   4. Percorre RULES em ordem; a PRIMEIRA regra verdadeira define a "intenção".
 *   5. Intenção -> Observação "dd/mm: texto" + código do Motivo (por cliente).
 *
 * Para adicionar uma regra nova basta inserir um objeto em RULES na posição
 * de prioridade desejada — nenhuma outra parte do app precisa mudar.
 */
import { RULES_CONFIG, STATUS } from '../config.js';
import { totvsKey } from './totvsParser.js';
import {
  addDays, addWorkdays, formatDate, formatDayMonth, formatDecimalBR, isMultiple,
  maxDate, normalizeCode, normalizeText, padCode, sameObservation, stripObsDatePrefix, todayUTC,
} from './utils.js';

/* ------------------------------------------------------------------------- */
/* 1. Contexto: tudo que as regras precisam, calculado UMA vez por linha       */
/* ------------------------------------------------------------------------- */

/**
 * Nova previsão de entrega (porta da fórmula da coluna U do legado):
 *  - Com NF:            max(Emissão NF + SLA úteis, Data Entrega TOTVS)
 *  - Pedido sem NF:     max(Hoje + SLA úteis,       Data Entrega TOTVS)
 *  - Sem TOTVS:         Prev. Entrega Atual do GTplan
 */
export function calcNovaPrevEntrega({ row, totvs, today, slaDias }) {
  if (totvs?.notaFiscal) {
    const base = totvs.emissaoNF ? addWorkdays(totvs.emissaoNF, slaDias) : null;
    return maxDate(base, totvs.dataEntrega) ?? row.prevEntregaAtual;
  }
  if (totvs?.pedido) return maxDate(addWorkdays(today, slaDias), totvs.dataEntrega);
  return row.prevEntregaAtual;
}

/** Predicados de negócio pré-calculados (as regras só combinam flags). */
export function computeFlags(ctx) {
  const { row, totvs, mult, today, slaDias, config, temNF } = ctx;
  const hasTotvs = !!totvs;

  const divergenciaCaixa = !!ctx.depara && mult > 1 && !isMultiple(row.qtdPendente, mult);

  const valorDivergente = hasTotvs
    && Number.isFinite(totvs.valorUnit) && Number.isFinite(row.valUnit) && row.valUnit > 0
    && totvs.valorUnit > row.valUnit * (1 + config.TOLERANCIA_PRECO);

  const embalagemTotvs = Number.isFinite(totvs?.qtdEmbalagem) && totvs.qtdEmbalagem > 0 ? totvs.qtdEmbalagem : mult;
  const semSaldo = hasTotvs && Number.isFinite(totvs.saldo) && totvs.saldo < row.qtdPendente / embalagemTotvs;
  const bloqueado = hasTotvs && config.BLOQUEIOS_INDISPONIVEL.includes(totvs.bloqueio);
  const indisponivel = semSaldo && bloqueado;
  const faltaIndustria = indisponivel && /\((BO|CA)\)\s*$/i.test(totvs.descricao);

  const entregue = temNF && !!totvs.emissaoNF
    && today > addDays(addWorkdays(totvs.emissaoNF, slaDias), config.DIAS_FOLGA_ENTREGUE);

  // Legado: "no_prazo" = (Dt. OC + SLA úteis) < Prev. Entrega Atual. Fora do LT é o contrário.
  const foraLeadtime = temNF && !!row.dtOC && !!row.prevEntregaAtual
    && addWorkdays(row.dtOC, slaDias) >= row.prevEntregaAtual;

  // Especificação: NF = 0 e Hoje > Dt. OC + 12 dias (só se a OC existe no TOTVS).
  const naData = hasTotvs && !temNF && !!row.dtOC && today > addDays(row.dtOC, config.DIAS_NA_DATA);

  return { divergenciaCaixa, valorDivergente, semSaldo, bloqueado, indisponivel, faltaIndustria, entregue, foraLeadtime, naData };
}

/**
 * Monta o contexto de avaliação de uma linha.
 * @param {object} row linha normalizada (gtplanParser)
 * @param {{repo:object, totvsIndex:Map, today:Date, config:object}} deps
 */
export function buildContext(row, { repo, totvsIndex, today, config }) {
  const estab = repo.getEstabelecimento(row.codCliente);
  const slaDias = Number(estab?.sla_dias) || 1;

  let depara = repo.getDePara(row.codCliente, row.codItem);
  let deparaOrigem = depara ? 'tabela' : null;
  if (!depara && config.USAR_COD_FORNECEDOR_FALLBACK && normalizeCode(row.codItemFornecedor)) {
    depara = { cod_cbs: row.codItemFornecedor, multiplicador_caixa: 1 };
    deparaOrigem = 'cod_fornecedor';
  }

  const codCbs = depara ? padCode(depara.cod_cbs, 6) : '';
  const mult = Number(depara?.multiplicador_caixa) || 1;
  const totvs = codCbs ? totvsIndex.get(totvsKey(codCbs, row.numOC)) ?? null : null;

  const ctx = {
    row, estab, slaDias, depara, deparaOrigem, codCbs, mult, totvs, today, config,
    temNF: !!totvs?.notaFiscal,
    temPedido: !!totvs?.pedido,
    obsNorm: normalizeText(row.obsAtual),
  };
  ctx.novaPrevEntrega = calcNovaPrevEntrega(ctx);
  ctx.flags = computeFlags(ctx);
  return ctx;
}

/* ------------------------------------------------------------------------- */
/* 2. Regras em cascata (ordem = prioridade)                                   */
/* ------------------------------------------------------------------------- */

/**
 * @typedef {object} Rule
 * @property {string} id
 * @property {string} intent     slug da intenção (chave em motivos_gtplan)
 * @property {(ctx:object)=>boolean} when
 * @property {boolean} [keepObs] mantém a observação já gravada no GTplan
 */

/** @type {Rule[]} */
export const RULES = [
  // "Memória": respostas manuais de dias anteriores voltam na coluna Observação.
  { id: 'memoria_descontinuado', intent: 'desc_descontinuado', keepObs: true,
    when: (c) => /descontinuad/.test(c.obsNorm) },
  { id: 'memoria_cancelado', intent: 'desc_cancelado', keepObs: true,
    when: (c) => !c.temPedido && /(cancelad|fora de contrato|portfolio|fora de sp|formalizac|recusad)/.test(c.obsNorm) },
  { id: 'memoria_nao_migrou', intent: 'desc_nao_recebido',
    when: (c) => !c.temPedido && /migrou/.test(c.obsNorm) },
  { id: 'memoria_falta_fornecedor', intent: 'desc_falta', keepObs: true,
    when: (c) => !c.temNF && /falta no fornecedor/.test(c.obsNorm) },

  // Regras de dados
  { id: 'caixaria', intent: 'desc_embalagem', when: (c) => c.flags.divergenciaCaixa },
  { id: 'valor', intent: 'desc_valor', when: (c) => c.flags.valorDivergente },
  { id: 'falta_industria', intent: 'desc_falta', when: (c) => c.flags.faltaIndustria },
  { id: 'indisponivel', intent: 'desc_indisponivel', when: (c) => c.flags.indisponivel },
  { id: 'entregue', intent: 'desc_entregue', when: (c) => c.flags.entregue },
  { id: 'fora_leadtime', intent: 'desc_fora_lt', when: (c) => c.flags.foraLeadtime },
  { id: 'na_data', intent: 'desc_na_data', when: (c) => c.flags.naData },
  { id: 'faturado', intent: 'desc_faturado', when: (c) => c.temNF },
  { id: 'faturamento', intent: 'desc_faturamento', when: (c) => c.temPedido && !c.temNF },
];

/* ------------------------------------------------------------------------- */
/* 3. Templates de Observação                                                  */
/* ------------------------------------------------------------------------- */

const valorText = (c) => `Ajustar valor para R$ ${formatDecimalBR(c.totvs.valorUnit, 4)}`;
const previsaoText = (c) => `Entrega prevista para ${formatDayMonth(c.novaPrevEntrega)}`;
const faltaText = (c) => (c.totvs?.ruptura && c.totvs.ruptura >= c.today
  ? `Item em falta. Previsao de normalizacao para ${formatDate(c.totvs.ruptura)}`
  : 'Item em falta, sem previsao de normalizacao');

/** intent -> texto (sem o prefixo de data). */
export const OBS_TEMPLATES = {
  desc_embalagem: (c) => `Ajustar quantidade, item multiplo de ${c.mult} unidades`
    + (c.flags.valorDivergente ? ` e ${valorText(c)}` : ''),
  desc_valor: valorText,
  desc_falta: faltaText,
  desc_indisponivel: faltaText,
  desc_entregue: (c) => `Entregue, sob NF ${c.totvs.notaFiscal}`,
  desc_fora_lt: (c) => `OC fora do leadtime, entrega prevista para ${formatDayMonth(c.novaPrevEntrega)}`,
  desc_na_data: previsaoText,
  desc_faturado: previsaoText,
  desc_faturamento: previsaoText,
  desc_nao_recebido: () => 'Pedido nao migrou no ARIBA',
  desc_cancelado: (c) => stripObsDatePrefix(c.row.obsAtual) || 'Pedido cancelado',
  desc_descontinuado: (c) => stripObsDatePrefix(c.row.obsAtual) || 'Item descontinuado',
};

/** Observação final "dd/mm: texto". */
export function buildObservacao(intent, ctx) {
  const tpl = OBS_TEMPLATES[intent];
  return tpl ? `${formatDayMonth(ctx.today)}: ${tpl(ctx)}` : '';
}

/**
 * Se a nova observação diz o mesmo que a já gravada (ignorando a data),
 * mantém a antiga — o GTplan ignora linhas sem alteração.
 */
function dedupeObs(previous, next) {
  return previous && sameObservation(previous, next) ? previous : next;
}

/* ------------------------------------------------------------------------- */
/* 4. Avaliação                                                                */
/* ------------------------------------------------------------------------- */

function resolveMotivo(repo, row, intent) {
  const motivo = repo.getMotivo(row.codCliente, intent);
  return {
    motivoCodigo: motivo?.codigo ?? '',
    motivoDescricao: motivo?.descricao ?? '',
    status: motivo ? STATUS.PRONTO : STATUS.SEM_MOTIVO,
    pendencia: motivo ? '' : `Motivo "${intent}" não cadastrado para o cliente ${row.codCliente}`,
  };
}

const RESOLUTION_FIELDS = ['status', 'intent', 'regra', 'observacao', 'motivoCodigo', 'motivoDescricao', 'pendencia'];
const snapshot = (r) => Object.fromEntries(RESOLUTION_FIELDS.map((k) => [k, r[k]]));

/**
 * Avalia uma linha e devolve o resultado (imutável).
 * @returns {object} result
 */
export function evaluateRow(row, deps) {
  const ctx = buildContext(row, deps);
  const { totvs, config } = ctx;

  const base = {
    id: row.id,
    row,
    codCbs: ctx.codCbs,
    deparaOrigem: ctx.deparaOrigem,
    multiplicador: ctx.mult,
    slaDias: ctx.slaDias,
    totvsEncontrado: !!totvs,
    totvsLinha: totvs?.linha ?? null,
    pedido: totvs?.pedido ?? '',
    novaPrevEntrega: totvs ? formatDate(ctx.novaPrevEntrega) : row.original['Nova Prev. Entrega'],
    numNF: ctx.temNF ? totvs.notaFiscal : (config.NF_FALLBACK_PEDIDO && ctx.temPedido ? totvs.pedido : ''),
    dtNF: ctx.temNF ? formatDate(totvs.emissaoNF) : '',
    manual: null,
  };

  let resolution;
  if (!ctx.depara) {
    resolution = {
      status: STATUS.SEM_DEPARA, intent: '', regra: '', observacao: row.obsAtual,
      motivoCodigo: '', motivoDescricao: '', pendencia: 'Item sem de-para (Cód. Item GTplan → CBS)',
    };
  } else {
    const rule = RULES.find((r) => r.when(ctx));
    if (!rule) {
      resolution = {
        status: STATUS.SEM_MOTIVO, intent: '', regra: '', observacao: row.obsAtual,
        motivoCodigo: '', motivoDescricao: '',
        pendencia: totvs ? 'Nenhuma regra automática se aplica' : 'OC não localizada no TOTVS',
      };
    } else {
      const observacao = rule.keepObs ? row.obsAtual : dedupeObs(row.obsAtual, buildObservacao(rule.intent, ctx));
      resolution = { intent: rule.intent, regra: rule.id, observacao, ...resolveMotivo(deps.repo, row, rule.intent) };
    }
  }

  const result = { ...base, ...resolution };
  result.auto = snapshot(result);
  return result;
}

/**
 * Aplica (ou desfaz, com fraseId vazio) a escolha manual feita na Mesa de Triagem.
 * Retorna um NOVO objeto — o original não é mutado.
 */
export function applyManualResolution(result, fraseId, { repo, today = todayUTC() }) {
  if (!fraseId) return { ...result, ...result.auto, manual: null };

  const frase = repo.getFrase(fraseId);
  if (!frase) throw new Error(`Frase de resolução desconhecida: ${fraseId}`);

  const observacao = dedupeObs(result.row.obsAtual, `${formatDayMonth(today)}: ${frase.texto}`);
  return {
    ...result,
    manual: fraseId,
    intent: frase.intent,
    regra: 'manual',
    observacao,
    ...resolveMotivo(repo, result.row, frase.intent),
  };
}

/**
 * Processa todas as linhas.
 * @param {object[]} rows linhas normalizadas do GTplan
 * @param {{repo:object, totvsIndex:Map, today?:Date, config?:object}} deps
 */
export function processAll(rows, { repo, totvsIndex, today = todayUTC(), config = {} }) {
  const deps = { repo, totvsIndex, today, config: { ...RULES_CONFIG, ...config } };
  return rows.map((row) => evaluateRow(row, deps));
}

/** Contagens para os cards de KPI. */
export function summarize(results) {
  const summary = { total: results.length, [STATUS.PRONTO]: 0, [STATUS.SEM_MOTIVO]: 0, [STATUS.SEM_DEPARA]: 0, manual: 0 };
  for (const r of results) {
    summary[r.status]++;
    if (r.manual) summary.manual++;
  }
  return summary;
}

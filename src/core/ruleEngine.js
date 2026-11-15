/**
 * Motor de Regras de Negócio GTplan (Client-Side Pure Engine).
 * Refatora integralmente a lógica dos Botões 1-4 para processamento multi-cliente em memória.
 */

import {
  addWorkdays,
  addCalendarDays,
  diffCalendarDays,
  formatBRDate,
  formatShortBRDate,
  maxDate,
  parseAnyDate,
  todayUtc
} from './dates.js';
import { GTPLAN_COLUMNS } from './csv.js';
import { MotiveResolver, normalizeText } from './motiveResolver.js';

function parsePtBrNumber(val) {
  if (typeof val === 'number') return Number.isFinite(val) ? val : NaN;
  const s = String(val ?? '').trim();
  if (!s) return NaN;
  // Se tiver vírgula e ponto: decide qual é separador decimal
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      return Number(s.replace(/\./g, '').replace(',', '.'));
    }
    return Number(s.replace(/,/g, ''));
  }
  if (s.includes(',')) return Number(s.replace(',', '.'));
  return Number(s);
}

function formatMoney(num, decimals = 2) {
  if (!Number.isFinite(num)) return '';
  return num.toFixed(decimals).replace('.', ',');
}

function pad6(val) {
  const s = String(val ?? '').trim();
  if (!s) return '';
  if (/^\d+$/.test(s)) return s.padStart(6, '0');
  return s;
}

function stripLeadingZeros(val) {
  const s = String(val ?? '').trim();
  if (!s) return '';
  return s.replace(/^0+/, '') || '0';
}

function normalizeOcToken(val) {
  const s = String(val ?? '').trim();
  if (!s || s === '0') return '';
  return s;
}

function extractNumericTokens(text) {
  const s = String(text ?? '');
  const matches = s.match(/\d{5,12}/g);
  return matches || [];
}

/**
 * Extrai conteúdo da observação ignorando prefixo de data "dd/mm: " (ou primeiros 7 chars).
 */
export function stripDatePrefix(obs) {
  const s = String(obs ?? '').trim();
  if (!s) return '';
  const m = s.match(/^\d{2}\/\d{2}\s*:\s*(.*)$/);
  if (m) return m[1].trim();
  return s;
}

export function indexTotvsWorkbook(sheets) {
  const dadosSimp = sheets['Dados Simplificados'] || [];
  const ajusteRem = sheets['AjusteRemessa'] || [];
  const semContrato = sheets['SemContrato'] || [];
  const lojasGtplan = sheets['LojasNoGtplan'] || [];
  const leadtimeSheet = sheets['leadtime'] || [];

  const byProdOc = new Map();
  const byProdToken = new Map();

  for (const row of dadosSimp) {
    const pedido = String(row['Pedido'] ?? '').trim();
    const produto = pad6(row['Produto']);
    if (!pedido && !produto) continue;

    const oc = normalizeOcToken(row['OC']);
    const msgNota = String(row['Msg. Nota'] ?? '').trim();
    const parsedRow = {
      pedido,
      cliente: String(row['Cliente'] ?? '').trim(),
      loja: String(row['Loja'] ?? '').trim(),
      produto,
      descrProdut: String(row['Descr.Produt'] ?? '').trim(),
      saldoDisp: parsePtBrNumber(row['Saldo Disp.']),
      bloqEstoque: String(row['Bloq.Estoque'] ?? '').trim(),
      emissaoNf: parseAnyDate(row['Emissao NF']),
      notaFiscal: String(row['Nota Fiscal'] ?? '').trim(),
      dataEntrega: parseAnyDate(row['Data Entrega']),
      msgNota,
      estado: String(row['Estado'] ?? '').trim().toUpperCase(),
      oc,
      valorUnit: parsePtBrNumber(row['Valor Unit']),
      qntdEmbalagem: Math.max(1, parsePtBrNumber(row['Qntd Embalagem']) || 1),
      rupturaRaw: String(row['Ruptura'] ?? '').trim()
    };

    if (produto && oc) {
      const k = `${produto}|${oc}`;
      if (!byProdOc.has(k)) byProdOc.set(k, []);
      byProdOc.get(k).push(parsedRow);
    }

    // Indexa também tokens numéricos da Msg. Nota caso cliente (ex: DASA) não use prefixo 450/400 na coluna OC
    if (produto && msgNota) {
      for (const tok of extractNumericTokens(msgNota)) {
        const k = `${produto}|${tok}`;
        if (!byProdToken.has(k)) byProdToken.set(k, []);
        byProdToken.get(k).push(parsedRow);
      }
    }
  }

  const ajusteRemessaByNf = new Map();
  for (const row of ajusteRem) {
    const nfRaw = String(row['NOTA FISCAL'] ?? '').trim();
    const dataAj = parseAnyDate(row['DATA AJUSTADA']);
    if (!nfRaw || !dataAj) continue;
    const nfNoZero = stripLeadingZeros(nfRaw);
    const existing = ajusteRemessaByNf.get(nfNoZero);
    if (existing) {
      existing.duplicate = true;
    } else {
      ajusteRemessaByNf.set(nfNoZero, { date: dataAj, duplicate: false });
    }
  }

  const semContratoByCbs = new Map();
  for (const row of semContrato) {
    const cbs = pad6(row['MATERIAL_CBS']);
    const preco = parsePtBrNumber(row['PRECO_LISTA']);
    if (cbs && Number.isFinite(preco) && preco > 0) {
      semContratoByCbs.set(cbs, preco);
    }
  }

  const lojasByClienteLoja = new Map();
  for (const row of lojasGtplan) {
    const lk = String(row['LK'] ?? '').trim();
    const matriz = String(row['MATRIZ'] ?? '').trim();
    const loja = String(row['LOJA'] ?? '').trim();
    const estab = String(row['ESTAB'] ?? '').trim();
    const nomeCli = String(row['CLIENTE'] ?? '').trim();
    if (lk) lojasByClienteLoja.set(lk, { estab, nomeCli });
    if (matriz && loja) {
      lojasByClienteLoja.set(`${matriz.padStart(9, '0')}${loja.padStart(4, '0')}`, { estab, nomeCli });
      lojasByClienteLoja.set(`${stripLeadingZeros(matriz)}|${stripLeadingZeros(loja)}`, { estab, nomeCli });
    }
  }

  const leadtimeUF = {};
  for (const row of leadtimeSheet) {
    const uf = String(row['Estado'] ?? '').trim().toUpperCase();
    const sla = Number(row['SLA']);
    if (uf && Number.isFinite(sla)) leadtimeUF[uf] = sla;
  }

  return {
    byProdOc,
    byProdToken,
    ajusteRemessaByNf,
    semContratoByCbs,
    lojasByClienteLoja,
    leadtimeUF,
    stats: {
      dadosSimplificados: dadosSimp.length,
      ajusteRemessa: ajusteRem.length,
      semContrato: semContrato.length
    }
  };
}

export function buildDeParaIndex(todasBases = [], customDePara = []) {
  const byClientItem = new Map(); // codCliente|codItem -> item
  const byConcat = new Map();     // codItem+descItem -> item[]
  const byCodItem = new Map();    // codItem -> item[]
  const byDesc = new Map();       // normDesc -> item[]
  const byCbs = new Map();        // codCBS6 -> item
  const validCbsSet = new Set();

  const registerBase = (entry) => {
    const codCBS = pad6(entry.codCBS);
    if (!codCBS) return;
    const item = {
      codItem: String(entry.codItem ?? '').trim(),
      descItem: String(entry.descItem ?? '').trim(),
      normDesc: normalizeText(entry.descItem),
      codCBS,
      descCBS: String(entry.descCBS ?? '').trim(),
      mult: Math.max(1, Number(entry.mult) || 1),
      codCliente: entry.codCliente ? String(entry.codCliente).trim() : ''
    };
    validCbsSet.add(codCBS);
    if (!byCbs.has(codCBS)) byCbs.set(codCBS, item);

    if (item.codCliente && item.codItem) {
      byClientItem.set(`${item.codCliente}|${item.codItem}`, item);
    }

    if (item.codItem && item.descItem) {
      const cKey = `${item.codItem}|${item.normDesc}`;
      if (!byConcat.has(cKey)) byConcat.set(cKey, []);
      byConcat.get(cKey).push(item);
    }
    if (item.codItem) {
      if (!byCodItem.has(item.codItem)) byCodItem.set(item.codItem, []);
      byCodItem.get(item.codItem).push(item);
    }
    if (item.normDesc) {
      if (!byDesc.has(item.normDesc)) byDesc.set(item.normDesc, []);
      byDesc.get(item.normDesc).push(item);
    }
  };

  for (const b of todasBases) registerBase(b);
  // Custom De-Para do usuário sobrescreve/prioriza
  for (const c of customDePara) registerBase(c);

  return { byClientItem, byConcat, byCodItem, byDesc, byCbs, validCbsSet };
}

export function buildHospitalIndex(hospitais = [], customRules = {}) {
  const byClientLoja = new Map();
  const byEstab = new Map();

  for (const h of hospitais) {
    const entry = {
      estab: String(h.estab ?? '').trim(),
      nome: String(h.nome ?? '').trim(),
      uf: String(h.uf ?? '').trim().toUpperCase(),
      sla: Math.max(1, Number(h.sla) || 1)
    };
    if (h.concat2) byClientLoja.set(String(h.concat2).trim(), entry);
    if (h.codCliente && h.loja) {
      const k = `${stripLeadingZeros(h.codCliente)}|${stripLeadingZeros(h.loja)}`;
      byClientLoja.set(k, entry);
      byClientLoja.set(`${String(h.codCliente).padStart(9, '0')}${String(h.loja).padStart(4, '0')}`, entry);
    }
    if (entry.estab) byEstab.set(normalizeText(entry.estab), entry);
    if (entry.nome) byEstab.set(normalizeText(entry.nome), entry);
  }

  return { byClientLoja, byEstab, customRules };
}

function resolveSlaAndRule({ codCliente, estab, totvsRow, hospitalIdx, leadtimeUF, clientRules = {} }) {
  let sla = 1;
  let uf = totvsRow?.estado || '';
  let source = 'default';

  // 1. Tenta regra customizada por Cód. Cliente + Estab ou só Estab
  const estabNorm = normalizeText(estab);
  const cliKey = String(codCliente ?? '').trim();

  if (totvsRow) {
    const kPad = `${totvsRow.cliente.padStart(9, '0')}${totvsRow.loja.padStart(4, '0')}`;
    const kUnpad = `${stripLeadingZeros(totvsRow.cliente)}|${stripLeadingZeros(totvsRow.loja)}`;
    const hosp = hospitalIdx.byClientLoja.get(kPad) || hospitalIdx.byClientLoja.get(kUnpad);
    if (hosp) {
      sla = hosp.sla;
      uf = hosp.uf || uf;
      source = 'hospitais_cnpj';
    }
  }

  if (source === 'default' && estabNorm) {
    const hosp = hospitalIdx.byEstab.get(estabNorm);
    if (hosp) {
      sla = hosp.sla;
      uf = hosp.uf || uf;
      source = 'hospitais_estab';
    }
  }

  if (source === 'default' && uf && leadtimeUF[uf]) {
    sla = leadtimeUF[uf];
    source = 'leadtime_uf';
  }

  // Exceções configuráveis por estabelecimento/cliente (Decisão 5)
  const ruleEstab = clientRules?.byEstab?.[estabNorm] || null;
  const ruleClient = clientRules?.byClient?.[cliKey] || null;

  let extraSla = 0;
  let shortForaLtObs = false;

  // Defaults herdados (podem ser desligados/alterados pelo usuário em Configurações)
  const useLegacyExceptions = clientRules?.enableLegacyExceptions !== false;
  if (useLegacyExceptions) {
    if (estabNorm.includes('santa helena')) extraSla += 2;
    if (estabNorm.includes('santa joana')) shortForaLtObs = true;
  }

  if (ruleClient) {
    if (Number.isFinite(ruleClient.slaOverride)) sla = ruleClient.slaOverride;
    if (Number.isFinite(ruleClient.extraSla)) extraSla = ruleClient.extraSla;
    if (typeof ruleClient.shortForaLtObs === 'boolean') shortForaLtObs = ruleClient.shortForaLtObs;
  }
  if (ruleEstab) {
    if (Number.isFinite(ruleEstab.slaOverride)) sla = ruleEstab.slaOverride;
    if (Number.isFinite(ruleEstab.extraSla)) extraSla = ruleEstab.extraSla;
    if (typeof ruleEstab.shortForaLtObs === 'boolean') shortForaLtObs = ruleEstab.shortForaLtObs;
  }

  return { sla: Math.max(1, sla + extraSla), uf, shortForaLtObs };
}

function resolveDeParaAndTotvs({ raw, deParaIdx, totvsIdx }) {
  const codCliente = raw['Cód. Cliente'];
  const codItem = raw['Cód. Item'];
  const descItem = raw['Desc. Item'];
  const normDesc = normalizeText(descItem);
  const codItemForn = pad6(raw['Cód. Item Fornecedor']);

  // Ordem de candidatos De-Para
  const clientScoped = codItem ? deParaIdx.byClientItem.get(`${codCliente}|${codItem}`) : null;
  const concatMatches = codItem && normDesc ? (deParaIdx.byConcat.get(`${codItem}|${normDesc}`) || []) : [];
  const codItemMatches = codItem ? (deParaIdx.byCodItem.get(codItem) || []) : [];
  const descMatches = normDesc ? (deParaIdx.byDesc.get(normDesc) || []) : [];

  let primaryItem =
    clientScoped ||
    concatMatches[0] ||
    codItemMatches[0] ||
    descMatches[0] ||
    null;

  // Coleta todos os codCBS candidatos para buscar no TOTVS (espelhando FILTER + VSTACK do scripts.txt)
  const candidateCbs = [];
  const seenCbs = new Set();
  const pushCbs = (c) => {
    const p = pad6(c);
    if (p && !seenCbs.has(p)) {
      seenCbs.add(p);
      candidateCbs.push(p);
    }
  };

  if (clientScoped) pushCbs(clientScoped.codCBS);
  for (const m of concatMatches) pushCbs(m.codCBS);
  for (const m of codItemMatches) pushCbs(m.codCBS);
  for (const m of descMatches) pushCbs(m.codCBS);
  // Só aceita Cód. Item Fornecedor como candidato CBS se ele existir validado na lista CBS
  if (codItemForn && deParaIdx.validCbsSet.has(codItemForn)) {
    pushCbs(codItemForn);
    if (!primaryItem) primaryItem = deParaIdx.byCbs.get(codItemForn) || null;
  }

  // Ordem de OC: 1º Núm. OC -> 2º Cód. OC Externo (Decisão 2)
  const ocCandidates = [];
  const numOc = normalizeOcToken(raw['Núm. OC']);
  const extOc = normalizeOcToken(raw['Cód. OC Externo']);
  if (numOc) ocCandidates.push(numOc);
  if (extOc && extOc !== numOc) ocCandidates.push(extOc);

  let totvsRow = null;
  let matchedOc = '';

  // Busca exata (codCBS + OC na coluna OC do Dados Simplificados)
  outer: for (const oc of ocCandidates) {
    for (const cbs of candidateCbs) {
      const hits = totvsIdx.byProdOc.get(`${cbs}|${oc}`);
      if (hits && hits.length > 0) {
        totvsRow = hits[0];
        matchedOc = oc;
        break outer;
      }
    }
  }

  // Fallback para tokens em Msg. Nota (útil p/ DASA quando OC não está na coluna N)
  if (!totvsRow) {
    outer2: for (const oc of ocCandidates) {
      for (const cbs of candidateCbs) {
        const hits = totvsIdx.byProdToken.get(`${cbs}|${oc}`);
        if (hits && hits.length > 0) {
          totvsRow = hits[0];
          matchedOc = oc;
          break outer2;
        }
      }
    }
  }

  if (!primaryItem && totvsRow?.produto && deParaIdx.validCbsSet.has(totvsRow.produto)) {
    primaryItem = deParaIdx.byCbs.get(totvsRow.produto) || null;
  }

  return {
    primaryItem,
    codCBS: primaryItem?.codCBS || (totvsRow?.produto && deParaIdx.validCbsSet.has(totvsRow.produto) ? totvsRow.produto : ''),
    multiplicador: primaryItem?.mult || totvsRow?.qntdEmbalagem || 1,
    totvsRow,
    matchedOc
  };
}

function formatRupturaObs(rupturaRaw, today) {
  const s = String(rupturaRaw ?? '').trim();
  if (!s) return `${formatShortBRDate(today)}: Item em falta, sem previsao de normalizacao`;
  // Se rupturaRaw for data serial/BR ou texto dd/mmm
  const parsed = parseAnyDate(s);
  if (parsed && parsed.getTime() >= today.getTime()) {
    return `${formatShortBRDate(today)}: Item em falta. Previsao de normalizacao para ${formatShortBRDate(parsed)}`;
  }
  return `${formatShortBRDate(today)}: Item em falta. Previsao de normalizacao para ${s}`;
}

/**
 * Processa todo o lote CSV na memória aplicando o motor de regras completo.
 */
export function processFollowUpBatch(csvRows, context) {
  const {
    totvsIdx,
    deParaIdx,
    hospitalIdx,
    motiveResolver,
    holidays = [],
    clientRules = {},
    now = new Date()
  } = context;

  const today = todayUtc(now);
  const todayShort = formatShortBRDate(today);
  const holidaySet = new Set(holidays);
  const leadtimeUF = {
    SP: 1, RJ: 2, DF: 4, PE: 8, CE: 8, RN: 10, PR: 2,
    ...(totvsIdx?.leadtimeUF || {})
  };

  return csvRows.map(({ rowIndex, raw }) => {
    const codCliente = raw['Cód. Cliente'];
    const estab = raw['Estab.'];
    const qtdPendente = parsePtBrNumber(raw['Qtd. Pendente']) || 0;
    const valUnitGtplan = parsePtBrNumber(raw['Val. Unit.']);
    const dtOc = parseAnyDate(raw['Dt. OC']);
    const dtOrig = parseAnyDate(raw['Dt. Entrega Original']);
    const prevAtual = parseAnyDate(raw['Prev. Entrega Atual']);
    const obsAntiga = raw['Observação'] || '';
    const motivoAntigoRaw = raw['Motivo'] || '';

    const { primaryItem, codCBS, multiplicador, totvsRow } = resolveDeParaAndTotvs({
      raw,
      deParaIdx,
      totvsIdx
    });

    const hasDePara = Boolean(codCBS);
    const hasTotvs = Boolean(totvsRow);

    const { sla, shortForaLtObs } = resolveSlaAndRule({
      codCliente,
      estab,
      totvsRow,
      hospitalIdx,
      leadtimeUF,
      clientRules
    });

    // 1. Núm. NF / Pedido & Dt. NF
    let numNfNum = 0;
    let numNfOut = raw['Núm. NF'] || '';
    let dtNfDate = parseAnyDate(raw['Dt. NF']);

    if (totvsRow) {
      const nfDigits = stripLeadingZeros(totvsRow.notaFiscal);
      numNfNum = nfDigits && /^\d+$/.test(nfDigits) ? Number(nfDigits) : 0;
      if (numNfNum > 0) {
        numNfOut = String(numNfNum).padStart(9, '0');
      } else if (totvsRow.pedido) {
        numNfOut = totvsRow.pedido;
      }
      if (totvsRow.emissaoNf) dtNfDate = totvsRow.emissaoNf;
    }
    const dtNfOut = dtNfDate ? formatBRDate(dtNfDate) : (raw['Dt. NF'] || '');

    // 2. Nova Prev. Entrega
    let novaPrevDate = prevAtual;
    if (totvsRow) {
      const aj = numNfNum > 0 ? totvsIdx.ajusteRemessaByNf.get(String(numNfNum)) : null;
      if (aj) {
        novaPrevDate = aj.date;
      } else if (numNfNum > 0) {
        const dtTrab = dtNfDate ? addWorkdays(dtNfDate, sla, holidaySet) : null;
        novaPrevDate = maxDate(dtTrab, totvsRow.dataEntrega) || prevAtual;
      } else if (numNfOut !== '') {
        const dtFat = addWorkdays(today, sla, holidaySet);
        novaPrevDate = maxDate(dtFat, totvsRow.dataEntrega) || prevAtual;
      } else if (totvsRow.dataEntrega) {
        novaPrevDate = totvsRow.dataEntrega;
      }
    }
    const novaPrevOut = novaPrevDate ? formatBRDate(novaPrevDate) : (raw['Nova Prev. Entrega'] || '');
    const novaPrevShort = novaPrevDate ? formatShortBRDate(novaPrevDate) : '';

    // 3. Validação de Caixaria (obsCaixaria)
    let obsCaixaria = '';
    if (hasDePara && multiplicador > 0 && qtdPendente > 0) {
      const ratio = qtdPendente / multiplicador;
      // Tolerância de ponto flutuante
      if (Math.abs(ratio - Math.round(ratio)) > 1e-6) {
        obsCaixaria = `${todayShort}: Ajustar quantidade, item multiplo de ${multiplicador} unidades`;
      }
    }

    // 4. Validação de Valor e Spot SemContrato (obsValor)
    let obsValor = '';
    let isSpot = false;
    if (totvsRow && Number.isFinite(totvsRow.valorUnit) && Number.isFinite(valUnitGtplan) && valUnitGtplan > 0) {
      const valorMaxPermitido = valUnitGtplan * 1.03;
      if (totvsRow.valorUnit > valorMaxPermitido) {
        const valorAjustado = totvsRow.valorUnit * totvsRow.qntdEmbalagem;
        obsValor = `${todayShort}: Ajustar valor para R$ ${formatMoney(valorAjustado, 4)}`;
      }
    } else if (!totvsRow && codCBS) {
      const precoSpotRaw = totvsIdx.semContratoByCbs.get(codCBS);
      if (Number.isFinite(precoSpotRaw) && precoSpotRaw > 0) {
        isSpot = true;
        let valorSpot = Math.round(precoSpotRaw * 100) / 100;
        if (valorSpot < 1) valorSpot += 0.005;
        obsValor = `${todayShort}: Item fora de contrato, ajustar valor para R$ ${formatMoney(valorSpot, 2)}`;
      }
    }

    // 5. Indicadores de estoque e prazos
    const temPedidoOuNota = Boolean(numNfOut);
    const temSaldo = totvsRow
      ? totvsRow.saldoDisp >= (qtdPendente / (totvsRow.qntdEmbalagem || 1))
      : false;
    const saldoIndisponivel = totvsRow
      ? !temSaldo && (totvsRow.bloqEstoque === '02' || totvsRow.bloqEstoque === '03')
      : false;
    const descEndsBoCa = totvsRow
      ? /\((BO|CA)\)$/i.test(totvsRow.descrProdut.trim())
      : false;

    const obsLower = obsAntiga.toLowerCase();
    const obsNorm = normalizeText(obsAntiga);

    const descontinuado = obsLower.includes('descontinuado');
    const foiCancelado =
      !temPedidoOuNota &&
      (obsNorm.includes('fora de contrato') ||
        obsNorm.includes('portfolio') ||
        obsNorm.includes('fora de sp') ||
        obsNorm.includes('formalizacao') ||
        obsNorm.includes('cancelado'));
    const naoRecebido = !temPedidoOuNota && obsNorm.includes('migrou');
    const faltaIndustria = (descEndsBoCa && saldoIndisponivel) || obsNorm.includes('fornecedor');

    // no_prazo & foi_entregue
    let noPrazo = false;
    if (dtOc && prevAtual) {
      const dataMinima = addWorkdays(dtOc, sla, holidaySet);
      noPrazo = Boolean(dataMinima && dataMinima.getTime() < prevAtual.getTime());
    }

    let foiEntregue = false;
    if (numNfNum > 0 && dtNfDate) {
      const dataMaxima = addCalendarDays(addWorkdays(dtNfDate, sla, holidaySet), 3);
      foiEntregue = Boolean(dataMaxima && dataMaxima.getTime() < today.getTime());
    }

    // 6. Árvore de Decisão (12 prioridades)
    let slug = '';
    let generatedObs = '';

    if (descontinuado) {
      slug = 'desc_descontinuado';
      generatedObs = obsAntiga;
    } else if (foiCancelado) {
      slug = 'desc_cancelado';
      generatedObs = obsAntiga;
    } else if (naoRecebido) {
      slug = 'desc_nao_recebido';
      generatedObs = `${todayShort}: Pedido nao migrou no ARIBA`;
    } else if (obsCaixaria) {
      slug = 'desc_embalagem';
      generatedObs = obsValor ? `${obsCaixaria} e ${obsValor}` : obsCaixaria;
    } else if (obsValor.includes('valor')) {
      slug = 'desc_valor';
      generatedObs = obsValor;
    } else if (faltaIndustria) {
      slug = 'desc_falta';
      generatedObs = obsNorm.includes('falta')
        ? obsAntiga
        : formatRupturaObs(totvsRow?.rupturaRaw, today);
    } else if (saldoIndisponivel) {
      slug = 'desc_indisponivel';
      generatedObs = obsNorm.includes('falta')
        ? obsAntiga
        : formatRupturaObs(totvsRow?.rupturaRaw, today);
    } else if (numNfNum > 0 && foiEntregue) {
      slug = 'desc_entregue';
      generatedObs = `${todayShort}: Entregue, sob NF ${numNfOut}`;
    } else if (numNfNum > 0 && !noPrazo) {
      slug = 'desc_fora_lt';
      generatedObs = shortForaLtObs
        ? `${todayShort}: Entrega prevista para ${novaPrevShort}`
        : `${todayShort}: OC fora do leadtime, entrega prevista para ${novaPrevShort}`;
    } else if (numNfNum === 0 && dtOrig && diffCalendarDays(dtOrig, today) > 12) {
      slug = 'desc_na_data';
      generatedObs = `${todayShort}: Entrega prevista para ${novaPrevShort}`;
    } else if (numNfNum > 0) {
      slug = 'desc_faturado';
      generatedObs = `${todayShort}: Entrega prevista para ${novaPrevShort}`;
    } else if (temPedidoOuNota) {
      slug = 'desc_faturamento';
      generatedObs = `${todayShort}: Entrega prevista para ${novaPrevShort}`;
    }

    // 7. Regra Anti-Repetição (mantém data original se o texto pós-data não mudou)
    let finalObs = generatedObs;
    let unchanged = false;

    if (!slug) {
      // Sem decisão automática: preserva observação existente
      finalObs = obsAntiga;
      if (motivoAntigoRaw && obsAntiga) unchanged = true;
    } else if (obsAntiga) {
      const oldBody = stripDatePrefix(obsAntiga);
      const newBody = stripDatePrefix(generatedObs);
      if (oldBody && newBody && oldBody.toLowerCase() === newBody.toLowerCase()) {
        finalObs = obsAntiga;
        unchanged = true;
      }
    }

    // 8. Resolução dinâmica do Motivo para o Cód. Cliente
    let resolvedMotive = slug
      ? motiveResolver.resolve(codCliente, slug)
      : { codigo: '', desc: '', confidence: 'missing', candidates: [] };

    // Se já veio motivo no CSV e não houve alteração ou não achamos slug automático, preserva motivo existente
    let finalMotivo = resolvedMotive.codigo;
    let motiveConfidence = resolvedMotive.confidence;

    if (!slug && motivoAntigoRaw) {
      const existing = motiveResolver.findByCodeOrDesc(codCliente, motivoAntigoRaw);
      finalMotivo = existing ? existing.codigo : motivoAntigoRaw;
      motiveConfidence = existing ? 'confirmed' : 'manual';
    } else if (unchanged && motivoAntigoRaw) {
      const existing = motiveResolver.findByCodeOrDesc(codCliente, motivoAntigoRaw);
      if (existing) {
        finalMotivo = existing.codigo;
        motiveConfidence = 'confirmed';
      }
    }

    const needsMotivo = !finalMotivo;

    // Monta linha de saída com exatamente as 24 colunas
    const output = {};
    for (const col of GTPLAN_COLUMNS) {
      output[col] = raw[col] ?? '';
    }
    output['Nova Prev. Entrega'] = novaPrevOut;
    output['Núm. NF'] = numNfOut;
    output['Dt. NF'] = dtNfOut;
    output['Motivo'] = finalMotivo;
    output['Observação'] = finalObs;

    return {
      rowIndex,
      raw,
      output,
      meta: {
        codCliente,
        cliente: raw['Cliente'],
        estab,
        codCBS,
        multiplicador,
        hasDePara,
        hasTotvs,
        totvsPedido: totvsRow?.pedido || '',
        slug,
        resolvedMotiveDesc: resolvedMotive.desc || '',
        motiveConfidence, // 'confirmed' | 'exact' | 'review' | 'suggested' | 'missing' | 'manual'
        motiveCandidates: resolvedMotive.candidates || [],
        needsMotivo,
        hasCaixaria: Boolean(obsCaixaria),
        hasValor: Boolean(obsValor && !isSpot),
        hasSpot: isSpot,
        unchanged,
        editedByUser: false
      }
    };
  });
}

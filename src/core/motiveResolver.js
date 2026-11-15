/**
 * Resolvedor dinâmico de Motivos por Cód. Cliente + Sugestão Semântica + Revisão.
 */

export const INTENT_SLUGS = [
  { slug: 'desc_entregue', label: 'Pedido Entregue' },
  { slug: 'desc_faturado', label: 'Faturado / Em Rota' },
  { slug: 'desc_faturamento', label: 'Em Faturamento' },
  { slug: 'desc_na_data', label: 'Será Entregue na Data' },
  { slug: 'desc_embalagem', label: 'Ajuste de Quantidade / Embalagem' },
  { slug: 'desc_valor', label: 'Ajuste de Valor / Contrato' },
  { slug: 'desc_falta', label: 'Item em Falta (Fabricante)' },
  { slug: 'desc_indisponivel', label: 'Indisponibilidade de Estoque' },
  { slug: 'desc_cancelado', label: 'Pedido Cancelado / Recusado' },
  { slug: 'desc_nao_recebido', label: 'Pedido Não Recebido / Não Migrou' },
  { slug: 'desc_descontinuado', label: 'Item Descontinuado' },
  { slug: 'desc_fora_lt', label: 'Pedido Fora do Lead Time' }
];

export function normalizeText(str) {
  return String(str ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const KEYWORD_RULES = {
  desc_entregue: [
    ['produto entregue', 10],
    ['pedido entregue', 10],
    ['material entregue', 10],
    ['entrega realizada', 9],
    ['entrega no prazo', 7],
    ['ja entregue', 8],
    ['recebimento recebido', 5],
    ['recebido total', 6],
    ['entregue', 5]
  ],
  desc_faturado: [
    ['pedido faturado', 10],
    ['produto faturado', 10],
    ['em rota de entrega', 9],
    ['em rota', 8],
    ['transito', 7],
    ['transportadora', 5],
    ['faturado', 6]
  ],
  desc_faturamento: [
    ['processo de faturamento', 10],
    ['em faturamento', 9],
    ['entrega no prazo', 8],
    ['pedido confirmado', 7],
    ['entrega programada', 7],
    ['atraso da operacao interna', 5],
    ['atraso na entrega', 4]
  ],
  desc_na_data: [
    ['sera entregue na data', 10],
    ['entregue na data', 9],
    ['entrega no prazo', 8],
    ['pedido confirmado', 7],
    ['entrega programada', 7],
    ['na data acordada', 8]
  ],
  desc_embalagem: [
    ['ajuste de quantidade', 10],
    ['adequacao oc quantidade', 10],
    ['adequacao embalagem', 10],
    ['caixaria', 10],
    ['ajustar quantidade', 9],
    ['qtde', 6],
    ['quantidade', 5],
    ['embalagem', 6]
  ],
  desc_valor: [
    ['ajuste de valor', 10],
    ['adequacao oc preco', 10],
    ['adequacao preco', 10],
    ['divergencia de valor', 9],
    ['erro no contrato', 7],
    ['ajustar valor', 9],
    ['valor', 6],
    ['preco', 6]
  ],
  desc_falta: [
    ['falta no fabricante', 10],
    ['item em falta', 10],
    ['produto em falta', 10],
    ['em falta', 8],
    ['ruptura', 7],
    ['falta', 5]
  ],
  desc_indisponivel: [
    ['indisponibilidade de estoque', 10],
    ['indisponibilidade do produto', 9],
    ['sem estoque', 9],
    ['estoque insuficiente', 8],
    ['falta no estoque', 8],
    ['item em falta', 6],
    ['indisponib', 6]
  ],
  desc_cancelado: [
    ['pedido cancelado', 10],
    ['cancelar oc', 10],
    ['oc cancelada', 10],
    ['cancelar pedido', 9],
    ['cancelado', 7],
    ['erro no contrato', 6],
    ['recusa', 5]
  ],
  desc_nao_recebido: [
    ['nao recebemos o pedido', 10],
    ['nao recebeu o pedido', 10],
    ['ordem de compra nao recebida', 10],
    ['nao localizado', 9],
    ['nao recebido', 9],
    ['nao localiza a oc', 9],
    ['nao integrado', 8],
    ['falha no envio', 7]
  ],
  desc_descontinuado: [
    ['item descontinuado', 10],
    ['produto descontinuado', 10],
    ['descontinuado', 9]
  ],
  desc_fora_lt: [
    ['fora do lt', 10],
    ['fora do lead time', 10],
    ['fora do leadtime', 10],
    ['atraso da operacao interna', 6],
    ['fora da janela', 7],
    ['nova data de entrega', 6],
    ['atraso na entrega', 5]
  ]
};

/**
 * Detecta intenção/slug provável a partir de uma frase de observação (ex: digitada ou escolhida no combobox).
 */
export function inferSlugFromObservationText(text) {
  const norm = normalizeText(text);
  if (!norm) return null;
  if (norm.includes('descontinuado')) return 'desc_descontinuado';
  if (
    norm.includes('fora de contrato') ||
    norm.includes('portfolio') ||
    norm.includes('fora de sp') ||
    norm.includes('formalizacao') ||
    norm.includes('cancelado') ||
    norm.includes('recusado')
  ) {
    return 'desc_cancelado';
  }
  if (norm.includes('migrou') || norm.includes('nao recebido') || norm.includes('nao localizado')) {
    return 'desc_nao_recebido';
  }
  if (norm.includes('multiplo') || norm.includes('caixaria') || norm.includes('ajustar quantidade')) {
    return 'desc_embalagem';
  }
  if (norm.includes('ajustar valor') || norm.includes('valor correto')) {
    return 'desc_valor';
  }
  if (norm.includes('em falta') || norm.includes('sem previsao') || norm.includes('normalizacao')) {
    return 'desc_falta';
  }
  if (norm.includes('entregue')) return 'desc_entregue';
  if (norm.includes('fora do leadtime') || norm.includes('fora do lt')) return 'desc_fora_lt';
  if (norm.includes('entrega prevista')) return 'desc_faturamento';
  return null;
}

export class MotiveResolver {
  /**
   * @param {Object} params
   * @param {Array<{codCliente:string, cliente:string, codigo:string, desc:string}>} params.motivos
   * @param {Array<{desc:string, slug:string}>} params.motiveSlugMap
   * @param {Object<string, Object<string, string>>} params.overrides  // { [codCliente]: { [slug]: codigo } }
   */
  constructor({ motivos = [], motiveSlugMap = [], overrides = {} } = {}) {
    this.byClient = new Map();
    this.byClientCode = new Map();
    this.clientNames = new Map();
    this.overrides = overrides || {};

    // Mapa normalizado desc -> Set<slug> vindo da aba Parametros
    this.exactDescToSlugs = new Map();
    for (const item of motiveSlugMap) {
      const n = normalizeText(item.desc);
      if (!n || !item.slug) continue;
      if (!this.exactDescToSlugs.has(n)) this.exactDescToSlugs.set(n, new Set());
      this.exactDescToSlugs.get(n).add(item.slug);
    }

    for (const m of motivos) {
      const cli = String(m.codCliente ?? '').trim();
      const codigo = String(m.codigo ?? '').trim();
      const desc = String(m.desc ?? '').trim();
      if (!cli || !codigo) continue;

      if (!this.byClient.has(cli)) this.byClient.set(cli, []);
      if (!this.byClientCode.has(cli)) this.byClientCode.set(cli, new Map());
      if (m.cliente && !this.clientNames.has(cli)) this.clientNames.set(cli, m.cliente);

      const entry = {
        codCliente: cli,
        cliente: m.cliente || '',
        codigo,
        desc,
        normDesc: normalizeText(desc)
      };
      this.byClient.get(cli).push(entry);
      this.byClientCode.get(cli).set(codigo, entry);
      if (desc) {
        this.byClientCode.get(cli).set(entry.normDesc, entry);
      }
    }
  }

  getClientMotives(codCliente) {
    return this.byClient.get(String(codCliente ?? '').trim()) || [];
  }

  getClientName(codCliente) {
    return this.clientNames.get(String(codCliente ?? '').trim()) || '';
  }

  findByCodeOrDesc(codCliente, codeOrDesc) {
    const cli = String(codCliente ?? '').trim();
    const map = this.byClientCode.get(cli);
    if (!map) return null;
    const raw = String(codeOrDesc ?? '').trim();
    if (!raw) return null;
    const direct = map.get(raw) || map.get(normalizeText(raw));
    if (direct) return direct;
    const dashMatch = raw.match(/^(\d+)\s*-\s*(.+)$/);
    if (dashMatch) {
      return map.get(dashMatch[1]) || map.get(normalizeText(dashMatch[2])) || null;
    }
    return null;
  }

  /**
   * Resolve o motivo para `(codCliente, slug)`:
   * - 'confirmed': existe override salvo pelo usuário
   * - 'exact': correspondência exata pela tabela Parametros (única)
   * - 'review': correspondência exata porém com códigos duplicados no CSV do cliente
   * - 'suggested': sugestão semântica por palavras-chave (para o usuário revisar)
   * - 'missing': cliente ou motivo não encontrado
   */
  resolve(codCliente, slug) {
    const cli = String(codCliente ?? '').trim();
    if (!cli || !slug) {
      return { codigo: '', desc: '', confidence: 'missing', candidates: [] };
    }

    const clientMotives = this.getClientMotives(cli);
    if (clientMotives.length === 0) {
      return { codigo: '', desc: '', confidence: 'missing', candidates: [] };
    }

    // 1. Override confirmado pelo usuário
    const overrideCode = this.overrides?.[cli]?.[slug];
    if (overrideCode) {
      const found = clientMotives.find((m) => m.codigo === String(overrideCode));
      if (found) {
        return {
          codigo: found.codigo,
          desc: found.desc,
          confidence: 'confirmed',
          candidates: [found]
        };
      }
    }

    // 2. Match exato via Parametros
    const exactMatches = clientMotives.filter((m) => {
      const slugs = this.exactDescToSlugs.get(m.normDesc);
      return slugs && slugs.has(slug);
    });

    if (exactMatches.length === 1) {
      return {
        codigo: exactMatches[0].codigo,
        desc: exactMatches[0].desc,
        confidence: 'exact',
        candidates: exactMatches
      };
    }

    if (exactMatches.length > 1) {
      return {
        codigo: exactMatches[0].codigo,
        desc: exactMatches[0].desc,
        confidence: 'review',
        candidates: exactMatches
      };
    }

    // 3. Sugestão semântica por palavras-chave
    const rules = KEYWORD_RULES[slug] || [];
    const scored = [];
    for (const m of clientMotives) {
      let score = 0;
      for (const [kw, weight] of rules) {
        if (m.normDesc.includes(kw)) {
          score = Math.max(score, weight);
        }
      }
      if (score > 0) scored.push({ motive: m, score });
    }

    if (scored.length > 0) {
      scored.sort((a, b) => b.score - a.score || a.motive.desc.length - b.motive.desc.length);
      const best = scored[0].motive;
      return {
        codigo: best.codigo,
        desc: best.desc,
        confidence: 'suggested',
        candidates: scored.slice(0, 5).map((s) => s.motive)
      };
    }

    return { codigo: '', desc: '', confidence: 'missing', candidates: [] };
  }

  /**
   * Gera mapa de revisão por cliente para um conjunto de pares (codCliente, slug) usados no lote.
   */
  buildReviewMatrix(clientCodes) {
    const matrix = [];
    for (const cli of clientCodes) {
      const motives = this.getClientMotives(cli);
      if (motives.length === 0) continue;
      const clientName = this.getClientName(cli);
      const slugs = {};
      for (const { slug } of INTENT_SLUGS) {
        slugs[slug] = this.resolve(cli, slug);
      }
      matrix.push({ codCliente: cli, cliente: clientName, slugs, totalMotives: motives.length });
    }
    return matrix;
  }
}

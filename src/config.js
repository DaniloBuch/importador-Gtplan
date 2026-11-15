/**
 * config.js
 * Constantes globais e parâmetros de negócio ajustáveis.
 * Tudo que for "número mágico" do motor de regras deve morar aqui.
 */

/** Cabeçalho EXATO exigido pelo importador do GTplan (24 colunas, nesta ordem). */
export const GTPLAN_HEADER = Object.freeze([
  'Cód. Cliente', 'Cliente', 'ID Ordem', 'Núm. OC', 'Cód. Item', 'Desc. Item', 'Estab.',
  'Cód. Item Fornecedor', 'Unidade', 'Val. Unit.', 'Qtd. Total', 'Qtd. Recebida', 'Qtd. Pendente',
  'Dt. OC', 'Dt. Entrega Original', 'Prev. Entrega Atual', 'Nova Prev. Entrega', 'Núm. NF', 'Dt. NF',
  'Motivo', 'Observação', 'Estoque Total', 'Cód. OC Externo', 'Cód. Integração',
]);

/** Colunas que o GTplan aceita como "resposta" (as demais são somente identificação). */
export const RESPONSE_COLUMNS = Object.freeze([
  'Nova Prev. Entrega', 'Núm. NF', 'Dt. NF', 'Motivo', 'Observação',
]);

export const CSV_DELIMITER = ';';
export const CSV_NEWLINE = '\r\n';
export const UTF8_BOM = '\uFEFF';

/** O GTplan aceita no máximo 1000 linhas respondidas por arquivo. */
export const EXPORT_CHUNK_SIZE = 1000;

/** Itens por página na Mesa de Triagem. */
export const PAGE_SIZE = 25;

/** Status possíveis de uma linha após o processamento. */
export const STATUS = Object.freeze({
  PRONTO: 'pronto',          // 🟢 motivo + observação resolvidos
  SEM_MOTIVO: 'sem_motivo',  // 🔵 precisa de ação manual
  SEM_DEPARA: 'sem_depara',  // 🔴 item GTplan sem correspondência no CBS
});

/**
 * Parâmetros do motor de regras.
 * Podem ser sobrescritos por chamada (útil em testes e futuramente por cliente).
 */
export const RULES_CONFIG = Object.freeze({
  /** desc_na_data: NF = 0 e hoje > Dt. OC + N dias. */
  DIAS_NA_DATA: 12,
  /** desc_valor: preço TOTVS acima do preço GTplan + tolerância (3%). */
  TOLERANCIA_PRECO: 0.03,
  /** desc_entregue: hoje > (Emissão NF + SLA em dias úteis) + N dias corridos. */
  DIAS_FOLGA_ENTREGUE: 3,
  /** Códigos de bloqueio de estoque do TOTVS que indicam indisponibilidade. */
  BLOQUEIOS_INDISPONIVEL: ['02', '03'],
  /** Sem NF, o legado gravava o nº do pedido no campo "Núm. NF". */
  NF_FALLBACK_PEDIDO: true,
  /**
   * Se o item não tiver de-para, usar o "Cód. Item Fornecedor" que o próprio GTplan
   * já traz (multiplicador assumido = 1). Desligado por padrão para respeitar a regra
   * "sem de-para => 🔴".
   */
  USAR_COD_FORNECEDOR_FALLBACK: false,
});

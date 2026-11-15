/**
 * mockDb.js
 * Tabelas de referência MOCKADAS para o protótipo.
 * Futuramente virão de um banco (Supabase/Firebase/API) — o resto do app só
 * conversa com elas via `createRepository(db)`, então a troca é transparente.
 *
 * Origem dos dados (reais, extraídos dos anexos):
 *  - produtos_depara  -> aba "todasBases" do importador_gtplan.xlsm (B -> E, G)
 *  - motivos_gtplan   -> motivos_follow_up_todos_os_clientes.csv + coluna D
 *                        ("Descrição Simples") da aba "Motivos"
 *  - estabelecimentos -> aba "Hospitais" (coluna L = SLA)
 */

/** Catálogo de intenções (slugs herdados da planilha legada). */
export const INTENTS = Object.freeze({
  desc_embalagem: 'Ajuste de quantidade (caixaria)',
  desc_valor: 'Ajuste de valor',
  desc_falta: 'Item em falta',
  desc_indisponivel: 'Indisponibilidade de estoque',
  desc_entregue: 'Entregue',
  desc_fora_lt: 'Fora do leadtime',
  desc_na_data: 'Será entregue na data',
  desc_faturado: 'Faturado',
  desc_faturamento: 'Em faturamento',
  desc_nao_recebido: 'Pedido não recebido / não migrou',
  desc_cancelado: 'Cancelado / fora de contrato',
  desc_descontinuado: 'Item descontinuado',
});

/** cod_cliente (GTplan) -> regra de SLA em dias úteis. */
export const estabelecimentos = [
  { cod_cliente: '116', nome: 'H CLINICAS CAIEIRAS', rede: 'Amil', sla_dias: 1 },
  { cod_cliente: '113', nome: 'H IPIRANGA MOGI', rede: 'Amil', sla_dias: 1 },
  { cod_cliente: '33', nome: 'DASA Hospitais MV Soul', rede: 'Dasa', sla_dias: 2 },
];

/**
 * cod_item_gtplan -> cod_cbs + multiplicador_caixa.
 * `cod_cliente` é opcional: quando informado, o de-para vale só para aquele cliente
 * (útil quando redes diferentes usam o mesmo código GTplan para itens distintos).
 */
export const produtos_depara = [
  { cod_item_gtplan: "000648", cod_cbs: "005940", multiplicador_caixa: 1, descricao_cbs: "SONDA RETAL N 10 MARK MED" },
  { cod_item_gtplan: "000745", cod_cbs: "005955", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 10 MARK MED (10)" },
  { cod_item_gtplan: "001204", cod_cbs: "002738", multiplicador_caixa: 1, descricao_cbs: "HASTE FLEXIVEL COTONETE JOHNSONS C/75" },
  { cod_item_gtplan: "001241", cod_cbs: "000462", multiplicador_caixa: 1, descricao_cbs: "ABAIXADOR LINGUA ESTILO C100" },
  { cod_item_gtplan: "001253", cod_cbs: "002375", multiplicador_caixa: 1, descricao_cbs: "ESPECULO VAGINAL ESTERIL COM LUBRIFICACAO   P VAGISPEC" },
  { cod_item_gtplan: "001940", cod_cbs: "002376", multiplicador_caixa: 1, descricao_cbs: "ESPECULO VAGINAL ESTERIL COM LUBRIFICACAO  M VAGISPEC" },
  { cod_item_gtplan: "004651", cod_cbs: "000630", multiplicador_caixa: 12, descricao_cbs: "TALA METALICA MSO 12X250  (12)" },
  { cod_item_gtplan: "037758", cod_cbs: "000961", multiplicador_caixa: 1, descricao_cbs: "SUSPENSORIO ESCROTAL M 3981 TENSOR" },
  { cod_item_gtplan: "039521", cod_cbs: "008452", multiplicador_caixa: 1, descricao_cbs: "CURATIVO BLOOD STOP ADULTO AMP CAIXA C/500  (EXCLUSIVO AMIL)" },
  { cod_item_gtplan: "604029", cod_cbs: "000361", multiplicador_caixa: 20, descricao_cbs: "COLETOR PERFURO CORTANTE 03L DESCARPACK (20)" },
  { cod_item_gtplan: "677416", cod_cbs: "006990", multiplicador_caixa: 1, descricao_cbs: "MALHA TUBULAR ALGODAO 20CMX15M  MSO" },
  { cod_item_gtplan: "001164", cod_cbs: "000208", multiplicador_caixa: 1, descricao_cbs: "GEL PARA ECG  100G CARBOGEL" },
  { cod_item_gtplan: "709852", cod_cbs: "008417", multiplicador_caixa: 144, descricao_cbs: "PRESERVATIVO NAO LUBRIFICADO MADEITEX (144)" },
  { cod_item_gtplan: "715434", cod_cbs: "005898", multiplicador_caixa: 1, descricao_cbs: "SONDA ASPIRACAO TRAQUEAL C/VALVULA N 12 MARK MED" },
  { cod_item_gtplan: "731134", cod_cbs: "006985", multiplicador_caixa: 1, descricao_cbs: "MALHA TUBULAR ALGODAO 06CMX15M  MSO" },
  { cod_item_gtplan: "737411", cod_cbs: "005953", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 06 MARK MED (10)" },
  { cod_item_gtplan: "745286", cod_cbs: "005213", multiplicador_caixa: 1, descricao_cbs: "FRALDA ADULTO TENA CONFORT  G C/ 8" },
  { cod_item_gtplan: "677503", cod_cbs: "015128", multiplicador_caixa: 20, descricao_cbs: "COLETOR PERFURO CORTANTE C/AL 13L TOXIC LARANJ DESCARBOX(20)" },
  { cod_item_gtplan: "001196", cod_cbs: "001240", multiplicador_caixa: 20, descricao_cbs: "COLETOR PERFURO CORTANTE 07L DESCARPACK (20)" },
  { cod_item_gtplan: "605652", cod_cbs: "002777", multiplicador_caixa: 200, descricao_cbs: "LANCETA SAFE-T PRO UNO ACCU-CHEK (200)" },
  { cod_item_gtplan: "835556", cod_cbs: "012027", multiplicador_caixa: 1, descricao_cbs: "INFUSOR 2 VIAS C/CLAMP LUER LOCK INFUSAO HOSPITALAR (CA)" },
  { cod_item_gtplan: "013327", cod_cbs: "015128", multiplicador_caixa: 20, descricao_cbs: "COLETOR PERFURO CORTANTE C/AL 13L TOXIC LARANJ DESCARBOX(20)" },
  { cod_item_gtplan: "010104", cod_cbs: "002415", multiplicador_caixa: 12, descricao_cbs: "TALA METALICA MSO 19X250 (12)" },
  { cod_item_gtplan: "678028", cod_cbs: "006988", multiplicador_caixa: 1, descricao_cbs: "MALHA TUBULAR ALGODAO 12CMX15M  MSO" },
  { cod_item_gtplan: "678599", cod_cbs: "008452", multiplicador_caixa: 1, descricao_cbs: "CURATIVO BLOOD STOP ADULTO AMP CAIXA C/500  (EXCLUSIVO AMIL)" },
  { cod_item_gtplan: "678980", cod_cbs: "001349", multiplicador_caixa: 1, descricao_cbs: "AGULHA  SUTURA G-07 PROCARE C/12" },
  { cod_item_gtplan: "680004", cod_cbs: "005752", multiplicador_caixa: 50, descricao_cbs: "TIRAS P/ GLICEMIA ACTIVE (50) P.V.V - (NOVO)" },
  { cod_item_gtplan: "716485", cod_cbs: "005898", multiplicador_caixa: 1, descricao_cbs: "SONDA ASPIRACAO TRAQUEAL C/VALVULA N 12 MARK MED" },
  { cod_item_gtplan: "722261", cod_cbs: "005956", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 12 MARK MED (10)" },
  { cod_item_gtplan: "738511", cod_cbs: "005953", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 06 MARK MED (10)" },
  { cod_item_gtplan: "746573", cod_cbs: "008984", multiplicador_caixa: 1, descricao_cbs: "FRALDA ADULTO TENA CONFORT   M C/ 8   (NOVO)" },
  { cod_item_gtplan: "836661", cod_cbs: "005958", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 16 MARK MED (10)" },
  { cod_item_gtplan: "000518", cod_cbs: "000583", multiplicador_caixa: 1, descricao_cbs: "LUVA CIRURGICA SENSITEX 7,5 MUCAMBO 106" },
  { cod_item_gtplan: "001182", cod_cbs: "000361", multiplicador_caixa: 20, descricao_cbs: "COLETOR PERFURO CORTANTE 03L DESCARPACK (20)" },
  { cod_item_gtplan: "009844", cod_cbs: "000069", multiplicador_caixa: 1, descricao_cbs: "BANDAGEM ADESIVA ELASTICA TENSOPLAST 10 X 4,5 BSN" },
  { cod_item_gtplan: "010015", cod_cbs: "000580", multiplicador_caixa: 1, descricao_cbs: "LUVA CIRURGICA SENSITEX 6,5 MUCAMBO 106" },
  { cod_item_gtplan: "010100", cod_cbs: "001506", multiplicador_caixa: 10, descricao_cbs: "CLIP P/BOLSA SUR-FIT ACTIVE LIFE CONVATEC (10)" },
  { cod_item_gtplan: "000125", cod_cbs: "006186", multiplicador_caixa: 100, descricao_cbs: "TORNEIRA DESCARTAV 3 VIAS CONEXAO ROTATIVA MARK MED(100)(CA)" },
  { cod_item_gtplan: "606776", cod_cbs: "000866", multiplicador_caixa: 100, descricao_cbs: "INDICADOR DE LIMPEZA CLEAN-TRACE ATP AGUA (100)" },
  { cod_item_gtplan: "722246", cod_cbs: "005954", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 08 MARK MED (10)" },
  { cod_item_gtplan: "004251", cod_cbs: "000465", multiplicador_caixa: 1, descricao_cbs: "PINCA CHERON ESTERIL DESCARTAVEL KOLPLAST" },
  { cod_item_gtplan: "013312", cod_cbs: "006414", multiplicador_caixa: 20, descricao_cbs: "COLETOR PERFURO CORTANTE 03L LARANJA CLEAN BOX III (20)" },
  { cod_item_gtplan: "722355", cod_cbs: "005897", multiplicador_caixa: 1, descricao_cbs: "SONDA ASPIRACAO TRAQUEAL C/VALVULA N 10 MARK MED" },
  { cod_item_gtplan: "746615", cod_cbs: "005212", multiplicador_caixa: 1, descricao_cbs: "FRALDA ADULTO TENA CONFORT EG C/ 7" },
  { cod_item_gtplan: "837782", cod_cbs: "005957", multiplicador_caixa: 10, descricao_cbs: "SONDA URETRAL N 14 MARK MED (10)" },
  { cod_item_gtplan: "711959", cod_cbs: "006996", multiplicador_caixa: 1, descricao_cbs: "MALHA TUBULAR ALGODAO 10CMX25M  MSO" },
  { cod_item_gtplan: "000643", cod_cbs: "000584", multiplicador_caixa: 1, descricao_cbs: "LUVA CIRURGICA SENSITEX 8,0 MUCAMBO 106" },
  { cod_item_gtplan: "841422", cod_cbs: "010656", multiplicador_caixa: 1, descricao_cbs: "COMPRESSA CIRURGICA DE ALGODAO P/CURATIVO 10X50CM LUIZA AMED" },
  { cod_item_gtplan: "009987", cod_cbs: "000208", multiplicador_caixa: 1, descricao_cbs: "GEL PARA ECG  100G CARBOGEL" },
  { cod_item_gtplan: "013640", cod_cbs: "004835", multiplicador_caixa: 12, descricao_cbs: "FORMOL TAMPONADO 10 1000ML INDALABOR (12)" },
  { cod_item_gtplan: "006673", cod_cbs: "005944", multiplicador_caixa: 1, descricao_cbs: "SONDA RETAL N 18 MARK MED" },
  { cod_item_gtplan: "746574", cod_cbs: "005213", multiplicador_caixa: 1, descricao_cbs: "FRALDA ADULTO TENA CONFORT  G C/ 8" },
  { cod_item_gtplan: "677627", cod_cbs: "005640", multiplicador_caixa: 25, descricao_cbs: "SACO PARA OBITO GG 2,20X0,90M PLASTICOS JUREMA (25)" },
];

/** Chave composta `${cod_cliente}_${intent}` -> código numérico do motivo no GTplan. */
export const motivos_gtplan = [
  { chave: "116_desc_entregue", cod_cliente: "116", intent: "desc_entregue", codigo: "90340043", descricao: "1. Fornecedor: Entrega no prazo" },
  { chave: "116_desc_nao_recebido", cod_cliente: "116", intent: "desc_nao_recebido", codigo: "90340061", descricao: "19. Compras: Ordem de compra nao recebida" },
  { chave: "116_desc_embalagem", cod_cliente: "116", intent: "desc_embalagem", codigo: "90340062", descricao: "20. Compras: Pedido Aguardando Ajuste de Quantidade" },
  { chave: "116_desc_valor", cod_cliente: "116", intent: "desc_valor", codigo: "90340063", descricao: "21. Compras: Pedido Aguardando Ajuste de Valor" },
  { chave: "116_desc_falta", cod_cliente: "116", intent: "desc_falta", codigo: "90340045", descricao: "3. Fornecedor: Item em falta" },
  { chave: "116_desc_indisponivel", cod_cliente: "116", intent: "desc_indisponivel", codigo: "90340046", descricao: "4. Fornecedor: Indisponibilidade de estoque" },
  { chave: "116_desc_descontinuado", cod_cliente: "116", intent: "desc_descontinuado", codigo: "90340047", descricao: "5. Fornecedor: Item descontinuado" },
  { chave: "116_desc_fora_lt", cod_cliente: "116", intent: "desc_fora_lt", codigo: "90340049", descricao: "7. Planejamento: Pedido gerado fora do LT" },
  { chave: "116_desc_cancelado", cod_cliente: "116", intent: "desc_cancelado", codigo: "90340051", descricao: "9. FUP: Pedido Cancelado" },
  { chave: "116_desc_na_data", cod_cliente: "116", intent: "desc_na_data", codigo: "52934055", descricao: "Fornecedor: Pedido de Compras Será Entregue na Data" },
  { chave: "116_desc_faturamento", cod_cliente: "116", intent: "desc_faturamento", codigo: "52891287", descricao: "Fornecedor: Pedido em Processo de Faturamento (Informar o Prazo)" },
  { chave: "116_desc_faturado", cod_cliente: "116", intent: "desc_faturado", codigo: "52891318", descricao: "Fornecedor: Pedido faturado" },
  { chave: "113_desc_entregue", cod_cliente: "113", intent: "desc_entregue", codigo: "52889633", descricao: "Fornecedor: Pedido Entregue" },
  { chave: "113_desc_nao_recebido", cod_cliente: "113", intent: "desc_nao_recebido", codigo: "90340712", descricao: "19. Compras: Ordem de compra nao recebida" },
  { chave: "113_desc_embalagem", cod_cliente: "113", intent: "desc_embalagem", codigo: "90340713", descricao: "20. Compras: Pedido Aguardando Ajuste de Quantidade" },
  { chave: "113_desc_valor", cod_cliente: "113", intent: "desc_valor", codigo: "90340714", descricao: "21. Compras: Pedido Aguardando Ajuste de Valor" },
  { chave: "113_desc_falta", cod_cliente: "113", intent: "desc_falta", codigo: "90340696", descricao: "3. Fornecedor: Item em falta" },
  { chave: "113_desc_indisponivel", cod_cliente: "113", intent: "desc_indisponivel", codigo: "90340697", descricao: "4. Fornecedor: Indisponibilidade de estoque" },
  { chave: "113_desc_descontinuado", cod_cliente: "113", intent: "desc_descontinuado", codigo: "90340698", descricao: "5. Fornecedor: Item descontinuado" },
  { chave: "113_desc_fora_lt", cod_cliente: "113", intent: "desc_fora_lt", codigo: "90340700", descricao: "7. Planejamento: Pedido gerado fora do LT" },
  { chave: "113_desc_cancelado", cod_cliente: "113", intent: "desc_cancelado", codigo: "90340702", descricao: "9. FUP: Pedido Cancelado" },
  { chave: "113_desc_na_data", cod_cliente: "113", intent: "desc_na_data", codigo: "52934057", descricao: "Fornecedor: Pedido de Compras Será Entregue na Data" },
  { chave: "113_desc_faturamento", cod_cliente: "113", intent: "desc_faturamento", codigo: "52889618", descricao: "Fornecedor: Pedido em Processo de Faturamento (Informar o Prazo)" },
  { chave: "113_desc_faturado", cod_cliente: "113", intent: "desc_faturado", codigo: "52889649", descricao: "Fornecedor: Pedido faturado" },
  { chave: "33_desc_entregue", cod_cliente: "33", intent: "desc_entregue", codigo: "90339639", descricao: "1. Fornecedor: Entrega no prazo" },
  { chave: "33_desc_nao_recebido", cod_cliente: "33", intent: "desc_nao_recebido", codigo: "90339666", descricao: "19. Compras: Ordem de compra nao recebida" },
  { chave: "33_desc_embalagem", cod_cliente: "33", intent: "desc_embalagem", codigo: "90339665", descricao: "20. Compras: Pedido Aguardando Ajuste de Quantidade" },
  { chave: "33_desc_valor", cod_cliente: "33", intent: "desc_valor", codigo: "90339664", descricao: "21. Compras: Pedido Aguardando Ajuste de Valor" },
  { chave: "33_desc_falta", cod_cliente: "33", intent: "desc_falta", codigo: "90339643", descricao: "3. Fornecedor: Item em falta" },
  { chave: "33_desc_indisponivel", cod_cliente: "33", intent: "desc_indisponivel", codigo: "90339644", descricao: "4. Fornecedor: Indisponibilidade de estoque" },
  { chave: "33_desc_descontinuado", cod_cliente: "33", intent: "desc_descontinuado", codigo: "90339648", descricao: "5. Fornecedor: Item descontinuado" },
  { chave: "33_desc_fora_lt", cod_cliente: "33", intent: "desc_fora_lt", codigo: "90339646", descricao: "7. Planejamento: Pedido gerado fora do LT" },
  { chave: "33_desc_cancelado", cod_cliente: "33", intent: "desc_cancelado", codigo: "90339675", descricao: "9. FUP: Pedido Cancelado" },
];

/**
 * Frases do <select> da Mesa de Triagem. Cada frase aponta para uma intenção;
 * o código do motivo é resolvido por cliente em `motivos_gtplan`.
 * Obs.: as palavras-chave (migrou, cancelado, descontinuado, contrato...) são
 * reconhecidas pelas regras de "memória" no dia seguinte.
 */
export const frases_resolucao = [
  { id: 'nao_migrou', texto: 'Pedido nao migrou no ARIBA', intent: 'desc_nao_recebido' },
  { id: 'ajuste_valor', texto: 'Aguardando Ajuste de Valor', intent: 'desc_valor' },
  { id: 'ajuste_qtd', texto: 'Aguardando Ajuste de Quantidade', intent: 'desc_embalagem' },
  { id: 'formalizacao', texto: 'Pedido de formalizacao', intent: 'desc_cancelado' },
  { id: 'fora_contrato', texto: 'FORA DE CONTRATO, FAVOR REMANEJAR', intent: 'desc_cancelado' },
  { id: 'emergencial', texto: 'Pedido recusado: conforme acordado com o planejamento corporativo, nao atendemos pedidos emergenciais fora de SP ou RJ', intent: 'desc_cancelado' },
  { id: 'portfolio', texto: 'Item nao faz parte do portfolio', intent: 'desc_cancelado' },
  { id: 'cancelado_ariba', texto: 'Item cancelado no ARIBA', intent: 'desc_cancelado' },
  { id: 'descont_carta', texto: 'Item descontinuado pelo fabricante (tem carta)', intent: 'desc_descontinuado' },
  { id: 'descont', texto: 'Item descontinuado', intent: 'desc_descontinuado' },
  { id: 'falta_fornecedor', texto: 'Item em falta no fornecedor, sem previsao no momento', intent: 'desc_falta' },
];

/** Banco completo (formato esperado por createRepository). */
export const mockDb = { estabelecimentos, produtos_depara, motivos_gtplan, frases_resolucao };
export default mockDb;

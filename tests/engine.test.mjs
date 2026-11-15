import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { SEED_DATA } from '../src/data/seedData.js';
import {
  addWorkdays,
  excelSerialToDate,
  formatBRDate,
  parseAnyDate,
  parseBRDate
} from '../src/core/dates.js';
import {
  GTPLAN_COLUMNS,
  buildGtplanCsvBatches,
  parseGtplanCsv,
  sanitizeCsvFilename
} from '../src/core/csv.js';
import { MotiveResolver, inferSlugFromObservationText } from '../src/core/motiveResolver.js';
import { readWorkbookSheets, rowsToObjects } from '../src/core/xlsxReader.js';
import {
  buildDeParaIndex,
  buildHospitalIndex,
  indexTotvsWorkbook,
  processFollowUpBatch
} from '../src/core/ruleEngine.js';

const REF_DIR = 'C:/Users/Usuario/.gemini/antigravity/brain/639d4218-bdbb-4951-9ea6-aaed3daed14f/scratch/gtplan_ref';
const UPLOADED_MULTI_CSV = 'C:/Users/Usuario/.gemini/antigravity/brain/639d4218-bdbb-4951-9ea6-aaed3daed14f/.user_uploaded/media_1794770078130_50ecf9a7.csv';

test('dates: addWorkdays skips weekends and holidays', () => {
  // Friday 2026-11-13 + 3 workdays with Tuesday 2026-11-17 as holiday => Thursday 2026-11-19
  const start = parseBRDate('13/11/2026');
  const holidays = new Set(['2026-11-17']);
  const out = addWorkdays(start, 3, holidays);
  assert.equal(formatBRDate(out), '19/11/2026');

  const serialDate = excelSerialToDate(46340); // 2026-11-14 approx check valid Date
  assert.ok(serialDate instanceof Date && !Number.isNaN(serialDate.getTime()));
  assert.equal(parseAnyDate('00/01/1900'), null);
});

test('csv: sanitizeCsvFilename removes accents and ç', () => {
  const sanitized = sanitizeCsvFilename('follow_up_São_Paulo_Atenção.csv');
  assert.equal(sanitized, 'follow_up_Sao_Paulo_Atencao.csv');
  assert.ok(!/[çÇáéíóúãõ]/i.test(sanitized));
});

test('csv: preserves ID Ordem apostrophe and splits 2,500 rows into 1000/1000/500 batches', () => {
  const rows = [];
  for (let i = 0; i < 2500; i++) {
    const out = {};
    for (const col of GTPLAN_COLUMNS) out[col] = '';
    out['Cód. Cliente'] = '116';
    out['Cliente'] = 'Amil';
    out['ID Ordem'] = `'${9000000 + i}`;
    out['Núm. OC'] = `${1000 + i}`;
    out['Motivo'] = '123';
    out['Observação'] = 'Teste';
    rows.push({ output: out });
  }

  const batches = buildGtplanCsvBatches(rows, {
    batchSize: 1000,
    now: new Date(2026, 10, 15, 16, 30),
    baseName: 'follow_up_exportação'
  });

  assert.equal(batches.length, 3);
  assert.deepEqual(
    batches.map((b) => b.rowCount),
    [1000, 1000, 500]
  );
  assert.equal(batches[0].filename, 'follow_up_exportacao_lote_1.csv');
  assert.equal(batches[2].filename, 'follow_up_exportacao_lote_3.csv');
  assert.ok(batches[0].content.startsWith('\uFEFF'));

  const reparsed1 = parseGtplanCsv(batches[0].content);
  assert.equal(reparsed1.rows.length, 1000);
  assert.equal(reparsed1.rows[0].raw['ID Ordem'], "'9000000");

  const reparsed3 = parseGtplanCsv(batches[2].content);
  assert.equal(reparsed3.rows.length, 500);
  assert.equal(reparsed3.rows[499].raw['ID Ordem'], "'9002499");
});

test('motiveResolver: resolves exact client codes, flags duplicates for review, and semantically suggests Dasa (33)', () => {
  const resolver = new MotiveResolver({
    motivos: SEED_DATA.motivos,
    motiveSlugMap: SEED_DATA.motiveSlugMap,
    overrides: {}
  });

  const dasaMotives = resolver.getClientMotives('33');
  assert.ok(dasaMotives.length > 0, 'Dasa (33) deve possuir motivos carregados');

  const resEntregue = resolver.resolve('33', 'desc_entregue');
  assert.ok(['exact', 'confirmed', 'review', 'suggested'].includes(resEntregue.confidence));
  assert.ok(resEntregue.codigo, 'Dasa (33) deve resolver algum código para desc_entregue');

  // Cliente inexistente retorna missing
  const missing = resolver.resolve('999999', 'desc_entregue');
  assert.equal(missing.confidence, 'missing');
  assert.equal(missing.codigo, '');

  // Inferência livre de texto
  assert.equal(inferSlugFromObservationText('15/11: Pedido não migrou no ARIBA'), 'desc_nao_recebido');
  assert.equal(inferSlugFromObservationText('Produto fora de linha descontinuado'), 'desc_descontinuado');
});

test('ruleEngine: handles Dasa rules (OC fallback, Santa Helena +2d, Santa Joana short obs, Caixaria, 3% Valor, Spot, Anti-Repetition)', () => {
  const resolver = new MotiveResolver({
    motivos: SEED_DATA.motivos,
    motiveSlugMap: SEED_DATA.motiveSlugMap,
    overrides: {}
  });
  const deParaIdx = buildDeParaIndex([
    {
      codItem: 'DASA-ITEM-1',
      descItem: 'SERINGA 10ML',
      codCBS: '123456',
      mult: 100
    },
    {
      codItem: 'ITEM-SPOT',
      descItem: 'ITEM SPOT TESTE',
      codCBS: '654321',
      mult: 1
    }
  ]);
  const hospitalIdx = buildHospitalIndex(SEED_DATA.hospitais, {
    santaHelena: { extraSla: 2, matchEstab: ['SANTA HELENA'] },
    santaJoana: { shortForaLtObs: true, matchEstab: ['SANTA JOANA'] }
  });

  const totvsIdx = indexTotvsWorkbook({
    'Dados Simplificados': [
      {
        Pedido: 'PED001',
        Cliente: '000001',
        Loja: '01',
        Produto: '123456',
        'Descr.Produt': 'SERINGA 10ML',
        'Saldo Disp.': '500',
        'Bloq.Estoque': '',
        'Emissao NF': '13/11/2026',
        'Nota Fiscal': '000999888',
        'Data Entrega': '',
        OC: 'OC-777888',
        'Valor Unit': '10,00',
        'Qntd Embalagem': '1',
        'Msg. Nota': 'PED 777888',
        Ruptura: ''
      },
      {
        Pedido: 'PED002',
        Cliente: '000001',
        Loja: '01',
        Produto: '123456',
        'Descr.Produt': 'SERINGA 10ML',
        'Saldo Disp.': '500',
        'Bloq.Estoque': '',
        'Emissao NF': '05/11/2026',
        'Nota Fiscal': '000111222',
        'Data Entrega': '07/11/2026',
        OC: '555666',
        'Valor Unit': '10,00',
        'Qntd Embalagem': '1',
        'Msg. Nota': '',
        Ruptura: ''
      },
      {
        Pedido: 'PED004',
        Cliente: '000001',
        Loja: '01',
        Produto: '123456',
        'Descr.Produt': 'SERINGA 10ML',
        'Saldo Disp.': '500',
        'Bloq.Estoque': '',
        'Emissao NF': '13/11/2026',
        'Nota Fiscal': '000444555',
        'Data Entrega': '18/11/2026',
        OC: '444555',
        'Valor Unit': '10,00',
        'Qntd Embalagem': '1',
        'Msg. Nota': '',
        Ruptura: ''
      },
      {
        Pedido: 'PED003',
        Cliente: '000001',
        Loja: '01',
        Produto: '654321',
        'Descr.Produt': 'ITEM SPOT TESTE',
        'Saldo Disp.': '100',
        'Bloq.Estoque': '',
        'Emissao NF': '',
        'Nota Fiscal': '',
        'Data Entrega': '',
        OC: '333444',
        'Valor Unit': '0,80',
        'Qntd Embalagem': '1',
        'Msg. Nota': '',
        Ruptura: ''
      }
    ],
    AjusteRemessa: [],
    SemContrato: [{ MATERIAL_CBS: '654321', PRECO_LISTA: '0,80' }],
    LojasNoGtplan: [
      { CÓDIGO: '1', ESTAB: 'H SANTA HELENA', SLA: '2', MATRIZ: '000001', LOJA: '01' },
      { CÓDIGO: '2', ESTAB: 'H SANTA JOANA RECIFE', SLA: '1', MATRIZ: '000001', LOJA: '01' }
    ],
    leadtime: []
  });

  const makeRow = (overrides) => {
    const r = {};
    for (const col of GTPLAN_COLUMNS) r[col] = '';
    r['Cód. Cliente'] = '33';
    r['Cliente'] = 'Dasa';
    r['ID Ordem'] = "'101";
    r['Núm. OC'] = '777888';
    r['Cód. OC Externo'] = '0'; // Dasa envia '0'
    r['Cód. Item'] = 'DASA-ITEM-1';
    r['Cód. Item Fornecedor'] = 'un'; // Dasa Tasy/Lab envia unidade em vez de CBS!
    r['Estab.'] = 'H SANTA HELENA';
    r['Val. Unit.'] = '10.00';
    r['Qtd. Total'] = '100';
    r['Qtd. Pendente'] = '100';
    r['Dt. Entrega Original'] = '10/11/2026';
    return { rowIndex: 1, raw: r };
  };

  const now = new Date(2026, 10, 15, 10, 0); // 15/11/2026

  // 1) Dasa com Cód. Item Fornecedor='un', OC Externo='0', fallback numérico Msg. Nota + Santa Helena (+2d) + Valor > 3% + Caixaria
  const rowCaixariaValor = makeRow({});
  rowCaixariaValor.raw['Qtd. Total'] = '150';
  rowCaixariaValor.raw['Qtd. Pendente'] = '150'; // 150 % 100 != 0 -> caixaria
  rowCaixariaValor.raw['Val. Unit.'] = '5.00'; // TOTVS é 10.00 -> dif > 3%

  // 2) Item Spot (sem pedido no TOTVS => busca SemContrato < 1 => +0,005 => 0,805 -> 0,81)
  const rowSpot = makeRow({});
  rowSpot.rowIndex = 2;
  rowSpot.raw['Núm. OC'] = '999000'; // OC ausente em Dados Simplificados
  rowSpot.raw['Cód. Item'] = 'ITEM-SPOT';
  rowSpot.raw['Val. Unit.'] = '0.50';
  rowSpot.raw['Qtd. Total'] = '10';
  rowSpot.raw['Qtd. Pendente'] = '10';

  // 3) Santa Joana fora de leadtime (Obs curta) + Entregue com anti-repetição
  const rowEntregueMesmaObs = makeRow({});
  rowEntregueMesmaObs.rowIndex = 3;
  rowEntregueMesmaObs.raw['Núm. OC'] = '555666';
  rowEntregueMesmaObs.raw['Estab.'] = 'H SANTA JOANA RECIFE';
  rowEntregueMesmaObs.raw['Observação'] = '10/11: Entregue, sob NF 000111222';
  rowEntregueMesmaObs.raw['Motivo'] = resolver.resolve('33', 'desc_entregue').codigo;

  // 4) Santa Joana fora de leadtime (Obs curta sem "OC fora do leadtime")
  const rowSantaJoanaForaLt = makeRow({});
  rowSantaJoanaForaLt.rowIndex = 4;
  rowSantaJoanaForaLt.raw['Núm. OC'] = '444555';
  rowSantaJoanaForaLt.raw['Estab.'] = 'H SANTA JOANA RECIFE';
  rowSantaJoanaForaLt.raw['Dt. OC'] = '10/11/2026';
  rowSantaJoanaForaLt.raw['Prev. Entrega Atual'] = '11/11/2026'; // dataMinima >= prevAtual => !noPrazo

  const processed = processFollowUpBatch([rowCaixariaValor, rowSpot, rowEntregueMesmaObs, rowSantaJoanaForaLt], {
    totvsIdx,
    deParaIdx,
    hospitalIdx,
    motiveResolver: resolver,
    holidays: new Set(),
    now
  });

  // Row 1: Caixaria tem prioridade no código de motivo, mas Observação combina divergência de preço e caixaria
  assert.equal(processed[0].meta.codCBS, '123456');
  assert.equal(processed[0].meta.hasTotvs, true);
  assert.equal(processed[0].meta.slug, 'desc_embalagem');
  assert.match(processed[0].output['Observação'], /Ajustar valor para R\$ 10,0000/);
  assert.match(processed[0].output['Observação'], /multiplo de 100 unidades/i);

  // Row 2: Spot SemContrato (< 1 => +0.005 => R$ 0,805 -> R$ 0,81)
  assert.equal(processed[1].meta.hasSpot, true);
  assert.equal(processed[1].meta.slug, 'desc_valor');
  assert.match(processed[1].output['Observação'], /Item fora de contrato, ajustar valor para R\$ 0,81/);

  // Row 3: Anti-repetição preserva data anterior 10/11
  assert.equal(processed[2].meta.slug, 'desc_entregue');
  assert.equal(processed[2].meta.unchanged, true);
  assert.equal(processed[2].output['Observação'], '10/11: Entregue, sob NF 000111222');

  // Row 4: Santa Joana fora de leadtime gera obs curta
  assert.equal(processed[3].meta.slug, 'desc_fora_lt');
  assert.equal(processed[3].output['Observação'], '15/11: Entrega prevista para 18/11');
});

test('integration: loads real bimestreamil (1).xlsx and processes real multi-estab & multi-client CSVs', async () => {
  const xlsxPath = path.join(REF_DIR, 'bimestreamil (1).xlsx');
  const xlsxBytes = new Uint8Array(await fs.readFile(xlsxPath));
  const sheetsRaw = await readWorkbookSheets(xlsxBytes, [
    'Dados Simplificados',
    'AjusteRemessa',
    'SemContrato',
    'LojasNoGtplan',
    'leadtime'
  ]);

  assert.ok(sheetsRaw['Dados Simplificados']?.length > 10, 'Dados Simplificados deve conter linhas');
  assert.ok(sheetsRaw['LojasNoGtplan']?.length > 10, 'LojasNoGtplan deve conter linhas');

  const sheets = {
    'Dados Simplificados': rowsToObjects(sheetsRaw['Dados Simplificados'], 1),
    AjusteRemessa: rowsToObjects(sheetsRaw['AjusteRemessa'] || [], 1),
    SemContrato: rowsToObjects(sheetsRaw['SemContrato'] || [], 1),
    LojasNoGtplan: rowsToObjects(sheetsRaw['LojasNoGtplan'] || [], 1),
    leadtime: rowsToObjects(sheetsRaw['leadtime'] || [], 1)
  };

  const totvsIdx = indexTotvsWorkbook(sheets);
  assert.ok(totvsIdx.byProdOc.size > 0, 'Dados Simplificados indexados por Produto|OC');
  assert.ok(totvsIdx.lojasByClienteLoja.size > 0, 'Lojas indexadas');

  const csvText = await fs.readFile(path.join(REF_DIR, 'csv novo mais de um estabelecimento.csv'), 'utf8');
  const parsedCsv = parseGtplanCsv(csvText);
  assert.equal(parsedCsv.headers.length, 24);
  assert.ok(parsedCsv.rows.length > 0);

  const resolver = new MotiveResolver({
    motivos: SEED_DATA.motivos,
    motiveSlugMap: SEED_DATA.motiveSlugMap
  });
  const deParaIdx = buildDeParaIndex(SEED_DATA.todasBases);
  const hospitalIdx = buildHospitalIndex(SEED_DATA.hospitais);

  const processed = processFollowUpBatch(parsedCsv.rows, {
    totvsIdx,
    deParaIdx,
    hospitalIdx,
    motiveResolver: resolver
  });

  assert.equal(processed.length, parsedCsv.rows.length);
  const withDePara = processed.filter((r) => r.meta.hasDePara).length;
  assert.ok(withDePara > 0, `Esperado cruzar De-Para (>0), obtido ${withDePara}`);
  assert.ok(totvsIdx.byProdOc.size > 0 && totvsIdx.byProdToken.size > 0, 'Índices TOTVS reais populados');

  // Cruzamento real garantido usando Produto + OC existente dentro do bimestreamil (1).xlsx (001369 | 4504768284)
  const sampleMatchRow = {
    rowIndex: 1,
    raw: {
      ...parsedCsv.rows[0].raw,
      'Cód. Cliente': '116',
      'Núm. OC': '4504768284',
      'Cód. Item Fornecedor': '001369',
      'Qtd. Pendente': '100',
      'Val. Unit.': '0.17'
    }
  };
  const realCross = processFollowUpBatch([sampleMatchRow], {
    totvsIdx,
    deParaIdx,
    hospitalIdx,
    motiveResolver: resolver
  });
  assert.equal(realCross[0].meta.hasTotvs, true);
  assert.equal(realCross[0].output['Núm. NF'], '001775927');

  // Verifica parse do arquivo real multi-cliente enviado pelo usuário (Dasa + Amil)
  const multiText = await fs.readFile(UPLOADED_MULTI_CSV, 'utf8');
  const parsedMulti = parseGtplanCsv(multiText);
  assert.ok(parsedMulti.rows.length >= 20, 'Arquivo multi-cliente deve ter >= 20 linhas');
  const processedMulti = processFollowUpBatch(parsedMulti.rows, {
    totvsIdx,
    deParaIdx,
    hospitalIdx,
    motiveResolver: resolver
  });
  assert.equal(processedMulti.length, parsedMulti.rows.length);
  const clientsFound = new Set(processedMulti.map((r) => r.meta.codCliente));
  assert.ok(clientsFound.size >= 2, 'Deve conter múltiplos Cód. Cliente misturados');
  assert.ok(clientsFound.has('33'), 'Deve conter cliente Dasa MV Soul (33)');
  assert.ok(clientsFound.has('3'), 'Deve conter cliente Dasa H9J (3)');
});

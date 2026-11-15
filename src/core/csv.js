/**
 * Parser e Exportador para o layout oficial de 24 colunas do novo portal GTplan.
 */

export const GTPLAN_COLUMNS = [
  'Cód. Cliente',
  'Cliente',
  'ID Ordem',
  'Núm. OC',
  'Cód. Item',
  'Desc. Item',
  'Estab.',
  'Cód. Item Fornecedor',
  'Unidade',
  'Val. Unit.',
  'Qtd. Total',
  'Qtd. Recebida',
  'Qtd. Pendente',
  'Dt. OC',
  'Dt. Entrega Original',
  'Prev. Entrega Atual',
  'Nova Prev. Entrega',
  'Núm. NF',
  'Dt. NF',
  'Motivo',
  'Observação',
  'Estoque Total',
  'Cód. OC Externo',
  'Cód. Integração'
];

export const EDITABLE_COLUMNS = new Set([
  'Nova Prev. Entrega',
  'Núm. NF',
  'Dt. NF',
  'Motivo',
  'Observação'
]);

/**
 * Faz o parse de uma linha CSV respeitando aspas duplas e delimitador ';'.
 */
export function parseCsvLine(line, delimiter = ';') {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function normalizeHeader(h) {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

const NORMALIZED_EXPECTED = GTPLAN_COLUMNS.map(normalizeHeader);

export function parseGtplanCsv(text) {
  const clean = String(text ?? '').replace(/^\uFEFF/, '');
  const rawLines = clean.split(/\r?\n/);
  const nonEmpty = rawLines.filter((l) => l.trim().length > 0);

  if (nonEmpty.length === 0) {
    throw new Error('O arquivo CSV está vazio.');
  }

  const headerFields = parseCsvLine(nonEmpty[0], ';');
  if (headerFields.length < 24) {
    throw new Error(
      `Layout inválido: esperadas 24 colunas do novo GTplan, encontradas ${headerFields.length}.`
    );
  }

  const normHeaders = headerFields.map(normalizeHeader);
  const colIndex = {};
  for (let i = 0; i < GTPLAN_COLUMNS.length; i++) {
    const canonical = GTPLAN_COLUMNS[i];
    const targetNorm = NORMALIZED_EXPECTED[i];
    const foundIdx = normHeaders.indexOf(targetNorm);
    colIndex[canonical] = foundIdx >= 0 ? foundIdx : i;
  }

  const rows = [];
  for (let r = 1; r < nonEmpty.length; r++) {
    const fields = parseCsvLine(nonEmpty[r], ';');
    // Garante exatamente 24+ colunas mesmo se linha vier curta
    while (fields.length < headerFields.length) fields.push('');

    const record = {};
    for (let c = 0; c < GTPLAN_COLUMNS.length; c++) {
      const colName = GTPLAN_COLUMNS[c];
      record[colName] = (fields[colIndex[colName]] ?? '').trim();
    }
    // Preserva extras caso existam, mantendo o array original de 24 campos
    rows.push({
      rowIndex: r, // 1-based data row
      raw: record
    });
  }

  return {
    headers: GTPLAN_COLUMNS.slice(),
    rows
  };
}

/**
 * Escapa campo CSV para delimitador ';' caso contenha ';', '"' ou quebra de linha.
 */
export function formatCsvField(val) {
  const s = String(val ?? '').replace(/\r?\n/g, ' ');
  if (s.includes(';') || s.includes('"')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function sanitizeCsvFilename(name) {
  return String(name ?? 'respostas_follow_up')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[çÇ]/g, (m) => (m === 'ç' ? 'c' : 'C'))
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Gera lotes de CSV no layout exato de 24 colunas, fatiando em até `batchSize` linhas.
 * Mantém o apóstrofo inicial de `ID Ordem` intacto e inclui BOM UTF-8.
 */
export function buildGtplanCsvBatches(processedRows, options = {}) {
  const batchSize = Math.max(1, Math.min(1000, Number(options.batchSize) || 1000));
  const now = options.now instanceof Date ? options.now : new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-') + '_' + [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0')
  ].join('-');

  const baseName = sanitizeCsvFilename(options.baseName || `respostas_follow_up_${stamp}`);
  const headerLine = GTPLAN_COLUMNS.join(';');

  const dataLines = processedRows.map((row) => {
    const out = row.output || row.raw || row;
    return GTPLAN_COLUMNS.map((col) => {
      let val = out[col] ?? '';
      if (col === 'ID Ordem' && val && !String(val).startsWith("'")) {
        val = `'${val}`;
      }
      return formatCsvField(val);
    }).join(';');
  });

  const batches = [];
  const totalBatches = Math.max(1, Math.ceil(dataLines.length / batchSize));

  for (let b = 0; b < totalBatches; b++) {
    const start = b * batchSize;
    const slice = dataLines.slice(start, start + batchSize);
    const suffix = totalBatches > 1 ? `_lote_${b + 1}` : '';
    const filename = `${baseName}${suffix}.csv`;
    const content = '\uFEFF' + [headerLine, ...slice].join('\r\n');
    batches.push({
      batchNumber: b + 1,
      totalBatches,
      rowCount: slice.length,
      filename,
      content
    });
  }

  return batches;
}

/**
 * Leitor XLSX/XLSM zero-dependência para Browser (DecompressionStream) e Node.js (zlib).
 * Lê seletivamente apenas as abas solicitadas, evitando inflar/parsear abas gigantes não usadas
 * (como ListaDiaria / calcChain / pivotCache) e pulando fórmulas (<f>) para máxima velocidade.
 */

function decodeXmlEntities(str) {
  if (!str || !str.includes('&')) return str;
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)));
}

function readUint16LE(buf, off) {
  return buf[off] | (buf[off + 1] << 8);
}

function readUint32LE(buf, off) {
  return (buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16) | (buf[off + 3] << 24)) >>> 0;
}

/**
 * Faz o parse do Central Directory de um arquivo ZIP (suporta data descriptors bit-3 do Excel).
 */
export function indexZipEntries(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  // Procura End of Central Directory (PK\x05\x06) de trás para frente
  const minOffset = Math.max(0, u8.length - 65557);
  let eocdOffset = -1;
  for (let i = u8.length - 22; i >= minOffset; i--) {
    if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('Arquivo inválido: assinatura ZIP (XLSX/XLSM) não encontrada.');
  }

  const totalEntries = readUint16LE(u8, eocdOffset + 10);
  const cdOffset = readUint32LE(u8, eocdOffset + 16);
  const decoder = new TextDecoder('utf-8');
  const entries = new Map();

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (u8[ptr] !== 0x50 || u8[ptr + 1] !== 0x4b || u8[ptr + 2] !== 0x01 || u8[ptr + 3] !== 0x02) {
      break;
    }
    const method = readUint16LE(u8, ptr + 10);
    const compressedSize = readUint32LE(u8, ptr + 20);
    const uncompressedSize = readUint32LE(u8, ptr + 24);
    const nameLen = readUint16LE(u8, ptr + 28);
    const extraLen = readUint16LE(u8, ptr + 30);
    const commentLen = readUint16LE(u8, ptr + 32);
    const localHeaderOffset = readUint32LE(u8, ptr + 42);

    const name = decoder.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));
    entries.set(name, {
      name,
      method,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });
    ptr += 46 + nameLen + extraLen + commentLen;
  }

  return { u8, entries };
}

async function inflateRaw(compressedBytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();
    const buf = await new Response(ds.readable).arrayBuffer();
    return new Uint8Array(buf);
  }
  // Fallback Node.js
  const zlib = await import('node:zlib');
  return new Uint8Array(zlib.inflateRawSync(compressedBytes));
}

export async function readZipEntryText(zipIndex, entryName) {
  const entry = zipIndex.entries.get(entryName);
  if (!entry) return null;
  const { u8 } = zipIndex;
  const lh = entry.localHeaderOffset;
  const nameLen = readUint16LE(u8, lh + 26);
  const extraLen = readUint16LE(u8, lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const compressed = u8.subarray(dataStart, dataStart + entry.compressedSize);

  let rawBytes;
  if (entry.method === 0) {
    rawBytes = compressed;
  } else if (entry.method === 8) {
    rawBytes = await inflateRaw(compressed);
  } else {
    throw new Error(`Método de compressão ZIP não suportado (${entry.method}) em ${entryName}.`);
  }
  return new TextDecoder('utf-8').decode(rawBytes);
}

/**
 * Extrai sharedStrings.xml sem DOMParser (rápido e compatível com Node/Browser).
 */
export function parseSharedStrings(xml) {
  if (!xml) return [];
  const list = [];
  let pos = 0;
  while (true) {
    const siStart = xml.indexOf('<si', pos);
    if (siStart < 0) break;
    const siEnd = xml.indexOf('</si>', siStart);
    if (siEnd < 0) break;
    const chunk = xml.slice(siStart, siEnd);
    pos = siEnd + 5;

    let text = '';
    let tPos = 0;
    while (true) {
      const tStart = chunk.indexOf('<t', tPos);
      if (tStart < 0) break;
      const gt = chunk.indexOf('>', tStart);
      if (gt < 0) break;
      if (chunk[gt - 1] === '/') {
        tPos = gt + 1;
        continue;
      }
      const tEnd = chunk.indexOf('</t>', gt);
      if (tEnd < 0) break;
      text += decodeXmlEntities(chunk.slice(gt + 1, tEnd));
      tPos = tEnd + 4;
    }
    list.push(text);
  }
  return list;
}

function colLettersToIndex(letters) {
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

/**
 * Scanner rápido de worksheet XML.
 * - Pula tags <f>...</f>
 * - Para após `maxConsecutiveEmpty` linhas seguidas sem valores úteis (acelera muito Dados Simplificados 25k!)
 */
export function parseWorksheetRows(xml, sharedStrings, options = {}) {
  const maxRows = options.maxRows || Infinity;
  const maxCols = options.maxCols || 30;
  const maxConsecutiveEmpty = options.maxConsecutiveEmpty || 250;
  const headerRowIndex = options.headerRowIndex || 0; // 0-based dentro do resultado não é usado; retorna sparse por linha

  const rows = [];
  let pos = 0;
  let consecutiveEmpty = 0;

  while (rows.length < maxRows) {
    const rowStart = xml.indexOf('<row ', pos);
    if (rowStart < 0) break;
    const rowOpenEnd = xml.indexOf('>', rowStart);
    if (rowOpenEnd < 0) break;
    if (xml[rowOpenEnd - 1] === '/') {
      pos = rowOpenEnd + 1;
      continue;
    }
    const rowEnd = xml.indexOf('</row>', rowOpenEnd);
    if (rowEnd < 0) break;
    pos = rowEnd + 6;

    const rowChunk = xml.slice(rowOpenEnd + 1, rowEnd);
    const cells = [];
    let hasValue = false;
    let cPos = 0;

    while (true) {
      const cStart = rowChunk.indexOf('<c ', cPos);
      if (cStart < 0) break;
      const cOpenEnd = rowChunk.indexOf('>', cStart);
      if (cOpenEnd < 0) break;
      if (rowChunk[cOpenEnd - 1] === '/') {
        cPos = cOpenEnd + 1;
        continue;
      }
      const cEnd = rowChunk.indexOf('</c>', cOpenEnd);
      if (cEnd < 0) break;
      cPos = cEnd + 4;

      const cOpenTag = rowChunk.slice(cStart, cOpenEnd);
      const refMatch = cOpenTag.match(/r="([A-Z]+)\d+"/);
      if (!refMatch) continue;
      const colIdx = colLettersToIndex(refMatch[1]);
      if (colIdx >= maxCols) continue;

      const tMatch = cOpenTag.match(/t="([^"]+)"/);
      const cellType = tMatch ? tMatch[1] : '';

      const cellInner = rowChunk.slice(cOpenEnd + 1, cEnd);
      let val = '';

      if (cellType === 'inlineStr') {
        const tStart = cellInner.indexOf('<t');
        if (tStart >= 0) {
          const gt = cellInner.indexOf('>', tStart);
          const tEnd = cellInner.indexOf('</t>', gt);
          if (gt >= 0 && tEnd >= 0) {
            val = decodeXmlEntities(cellInner.slice(gt + 1, tEnd));
          }
        }
      } else {
        const vStart = cellInner.indexOf('<v>');
        if (vStart >= 0) {
          const vEnd = cellInner.indexOf('</v>', vStart + 3);
          if (vEnd >= 0) {
            const rawV = cellInner.slice(vStart + 3, vEnd);
            if (cellType === 's') {
              const sIdx = Number(rawV);
              val = sIdx >= 0 && sIdx < sharedStrings.length ? sharedStrings[sIdx] : '';
            } else if (cellType === 'str' || cellType === 'e') {
              val = decodeXmlEntities(rawV);
            } else {
              val = rawV;
            }
          }
        }
      }

      if (val !== '') {
        cells[colIdx] = val;
        hasValue = true;
      }
    }

    if (hasValue) {
      consecutiveEmpty = 0;
      const rAttr = xml.slice(rowStart, rowOpenEnd).match(/r="(\d+)"/);
      const excelRowNum = rAttr ? Number(rAttr[1]) : rows.length + 1;
      rows.push({ excelRowNum, cells });
    } else {
      consecutiveEmpty++;
      if (rows.length > headerRowIndex + 2 && consecutiveEmpty >= maxConsecutiveEmpty) {
        break;
      }
    }
  }

  return rows;
}

/**
 * Converte linhas esparsas em array de objetos usando uma linha de cabeçalho.
 */
export function rowsToObjects(parsedRows, headerExcelRow = 1) {
  const hdrIdx = parsedRows.findIndex((r) => r.excelRowNum === headerExcelRow);
  const actualHdrIdx = hdrIdx >= 0 ? hdrIdx : 0;
  if (!parsedRows[actualHdrIdx]) return [];

  const headers = parsedRows[actualHdrIdx].cells.map((h) => String(h ?? '').trim());
  const out = [];
  for (let i = actualHdrIdx + 1; i < parsedRows.length; i++) {
    const r = parsedRows[i];
    const obj = { __excelRow: r.excelRowNum };
    let nonEmpty = false;
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c];
      if (!h) continue;
      const v = r.cells[c] !== undefined ? String(r.cells[c]) : '';
      if (v !== '') nonEmpty = true;
      obj[h] = v;
    }
    if (nonEmpty) out.push(obj);
  }
  return out;
}

/**
 * Lê um workbook XLSX/XLSM carregando apenas as abas em `targetSheetNames` (case-insensitive).
 */
export async function readWorkbookSheets(arrayBufferOrUint8, targetSheetNames = []) {
  const zipIndex = indexZipEntries(arrayBufferOrUint8);
  const wbXml = await readZipEntryText(zipIndex, 'xl/workbook.xml');
  const relsXml = await readZipEntryText(zipIndex, 'xl/_rels/workbook.xml.rels');
  if (!wbXml || !relsXml) {
    throw new Error('Estrutura interna do arquivo Excel inválida (workbook.xml ausente).');
  }

  const relMap = new Map();
  const relMatches = relsXml.matchAll(/<Relationship[^>]+>/g);
  for (const m of relMatches) {
    const tag = m[0];
    const idM = tag.match(/Id="([^"]+)"/);
    const tgtM = tag.match(/Target="([^"]+)"/);
    if (idM && tgtM) {
      let target = tgtM[1].replace(/^\/+/, '');
      if (!target.startsWith('xl/')) target = `xl/${target}`;
      relMap.set(idM[1], target);
    }
  }

  const wanted = new Set(targetSheetNames.map((n) => n.toLowerCase()));
  const sheetMap = new Map();
  const sheetMatches = wbXml.matchAll(/<sheet\s+[^>]+>/g);
  for (const m of sheetMatches) {
    const tag = m[0];
    const nameM = tag.match(/name="([^"]+)"/);
    const ridM = tag.match(/r:id="([^"]+)"/);
    if (!nameM || !ridM) continue;
    const name = decodeXmlEntities(nameM[1]);
    if (wanted.size === 0 || wanted.has(name.toLowerCase())) {
      const target = relMap.get(ridM[1]);
      if (target) sheetMap.set(name, target);
    }
  }

  const ssXml = await readZipEntryText(zipIndex, 'xl/sharedStrings.xml');
  const sharedStrings = parseSharedStrings(ssXml);

  const result = {};
  for (const [name, entryPath] of sheetMap.entries()) {
    const sheetXml = await readZipEntryText(zipIndex, entryPath);
    if (sheetXml) {
      result[name] = parseWorksheetRows(sheetXml, sharedStrings);
    }
  }

  return result;
}

/**
 * fileReaders.js
 * Adaptadores de leitura de arquivos no navegador (dependem dos globais
 * Papa e XLSX carregados via CDN). Mantidos fora do core para que a lógica
 * de negócio seja testável em Node.
 */

const ext = (file) => file.name.split('.').pop().toLowerCase();

/**
 * Lê o CSV do GTplan (separador ";", UTF-8).
 * @returns {Promise<{fields:string[], data:Record<string,string>[], errors:any[]}>}
 */
export function readGtplanCsv(file) {
  return new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: true,
      delimiter: ';',
      skipEmptyLines: 'greedy',
      encoding: 'UTF-8',
      transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
      complete: (res) => resolve({ fields: res.meta.fields ?? [], data: res.data, errors: res.errors }),
      error: reject,
    });
  });
}

/** Lê um CSV genérico como matriz (array de arrays). */
function readCsvMatrix(file) {
  return new Promise((resolve, reject) => {
    window.Papa.parse(file, {
      header: false,
      skipEmptyLines: 'greedy',
      encoding: 'UTF-8',
      complete: (res) => resolve(res.data),
      error: reject,
    });
  });
}

/** Abas preferidas na planilha do bimestre (em ordem). */
const PREFERRED_SHEETS = ['Dados Simplificados', 'Bimestre'];

/**
 * Lê a planilha do TOTVS (.xlsx/.xlsm/.xls ou .csv) e devolve uma matriz.
 * Para planilhas grandes, primeiro lê só os nomes das abas e depois parseia
 * APENAS a aba escolhida (o bimestre tem 13 abas / 6 MB).
 * @returns {Promise<{matrix:any[][], sheetName:string}>}
 */
export async function readTotvsFile(file) {
  if (ext(file) === 'csv') return { matrix: await readCsvMatrix(file), sheetName: file.name };

  const XLSX = window.XLSX;
  const buffer = await file.arrayBuffer();
  const names = XLSX.read(buffer, { type: 'array', bookSheets: true }).SheetNames;
  const sheetName = PREFERRED_SHEETS.find((n) => names.includes(n)) ?? names[0];

  const wb = XLSX.read(buffer, { type: 'array', sheets: [sheetName], cellDates: false, dense: true });
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '', raw: true, blankrows: false });
  return { matrix, sheetName };
}

/** Busca um arquivo de exemplo (pasta /exemplos) e o transforma em File. */
export async function fetchAsFile(url, name, type = 'text/csv') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Não foi possível carregar ${url} (${res.status})`);
  return new File([await res.blob()], name, { type });
}

/**
 * download.js
 * Geração dos arquivos finais no navegador: 1 lote => .csv; N lotes => .zip
 * (JSZip). Sem JSZip disponível, faz downloads sequenciais.
 */
import { CSV_DELIMITER, CSV_NEWLINE } from '../config.js';
import { toCsvString } from '../core/exporter.js';
import { formatCompact } from '../core/utils.js';

/** Papa.unparse configurado para o GTplan. */
const papaUnparse = (matrix) => window.Papa.unparse(matrix, {
  delimiter: CSV_DELIMITER,
  newline: CSV_NEWLINE,
  quotes: false,          // aspas apenas quando necessário
  escapeFormulae: false,  // não mexer no apóstrofo do ID Ordem
});

const csvBlob = (text) => new Blob([text], { type: 'text/csv;charset=utf-8' });

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: fileName });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{fileName:string, matrix:string[][]}[]} batches
 * @param {Date} date
 * @returns {Promise<string>} descrição do que foi baixado
 */
export async function downloadBatches(batches, date) {
  if (!batches.length) throw new Error('Nenhuma linha resolvida para exportar.');

  const files = batches.map((b) => ({ name: b.fileName, text: toCsvString(b.matrix, papaUnparse) }));

  if (files.length === 1) {
    downloadBlob(csvBlob(files[0].text), files[0].name);
    return files[0].name;
  }

  if (window.JSZip) {
    const zip = new window.JSZip();
    files.forEach((f) => zip.file(f.name, f.text));
    const blob = await zip.generateAsync({ type: 'blob' });
    const zipName = `respostas_follow_up_${formatCompact(date)}.zip`;
    downloadBlob(blob, zipName);
    return `${zipName} (${files.length} arquivos)`;
  }

  for (const f of files) {
    downloadBlob(csvBlob(f.text), f.name);
    await sleep(400); // navegadores bloqueiam rajadas de downloads
  }
  return `${files.length} arquivos`;
}

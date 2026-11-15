import { SEED_DATA } from './data/seedData.js';
import { IndexedDbRepository } from './storage/repository.js';
import { buildGtplanCsvBatches, parseGtplanCsv } from './core/csv.js';
import { readWorkbookSheets, rowsToObjects } from './core/xlsxReader.js';
import { MotiveResolver } from './core/motiveResolver.js';
import {
  buildDeParaIndex,
  buildHospitalIndex,
  indexTotvsWorkbook,
  processFollowUpBatch
} from './core/ruleEngine.js';
import { TriageTableController } from './ui/triageTable.js';
import { AdminModalController } from './ui/adminModal.js';

const repo = new IndexedDbRepository(SEED_DATA);

const state = {
  config: null,
  motiveResolver: null,
  deParaIdx: null,
  hospitalIdx: null,
  totvsIdx: null,
  csvParsed: null,
  csvMeta: null,
  totvsMeta: null,
  processedRows: [],
  activeStatusFilter: 'all',
  clientFilter: '',
  estabFilter: '',
  searchQuery: ''
};

// Elements
const dzCsv = document.getElementById('dz-csv');
const inpCsv = document.getElementById('inp-csv');
const metaCsvEl = document.getElementById('meta-csv');

const dzTotvs = document.getElementById('dz-totvs');
const inpTotvs = document.getElementById('inp-totvs');
const metaTotvsEl = document.getElementById('meta-totvs');

const kpiGrid = document.getElementById('kpi-grid');
const selClient = document.getElementById('filter-client');
const selEstab = document.getElementById('filter-estab');
const inpSearch = document.getElementById('filter-search');
const toolbarStats = document.getElementById('toolbar-stats');

const btnReviewBadge = document.getElementById('btn-review-count');
const btnOpenReview = document.getElementById('btn-open-review');
const btnOpenAdmin = document.getElementById('btn-open-admin');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnReprocessForce = document.getElementById('btn-reprocess-force');

const exportBackdrop = document.getElementById('export-backdrop');
const exportListEl = document.getElementById('export-batch-list');
const btnExportAllSeq = document.getElementById('btn-export-all-seq');
const btnExportClose = document.getElementById('btn-export-close');

const toastEl = document.getElementById('toast');
let toastTimer = null;

function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 3600);
}

function rebuildIndexes() {
  const cfg = state.config;
  state.motiveResolver = new MotiveResolver({
    motivos: cfg.motivos,
    motiveSlugMap: cfg.motiveSlugMap,
    overrides: cfg.motiveOverrides || {}
  });
  state.deParaIdx = buildDeParaIndex(cfg.todasBases, cfg.customDePara);
  state.hospitalIdx = buildHospitalIndex(cfg.hospitais, cfg.clientRules);
}

function reprocessRows({ preserveEdited = true } = {}) {
  if (!state.csvParsed) {
    state.processedRows = [];
    renderAll();
    return;
  }

  const t0 = performance.now();
  const previousEdited = new Map();
  if (preserveEdited) {
    for (const r of state.processedRows) {
      if (r.meta.editedByUser) previousEdited.set(r.rowIndex, r);
    }
  }

  const fresh = processFollowUpBatch(state.csvParsed.rows, {
    totvsIdx: state.totvsIdx,
    deParaIdx: state.deParaIdx,
    hospitalIdx: state.hospitalIdx,
    motiveResolver: state.motiveResolver,
    holidays: new Set(state.config.holidays || []),
    clientRules: state.config.clientRules || {}
  });

  state.processedRows = fresh.map((row) => previousEdited.get(row.rowIndex) || row);
  const elapsed = Math.round(performance.now() - t0);

  populateFilterDropdowns();
  renderAll();
  showToast(`Processadas ${state.processedRows.length} linhas em ${elapsed} ms.`);
}

function populateFilterDropdowns() {
  const clients = new Map();
  const estabs = new Set();
  for (const r of state.processedRows) {
    if (r.meta.codCliente && !clients.has(r.meta.codCliente)) {
      clients.set(r.meta.codCliente, r.meta.cliente || r.meta.codCliente);
    }
    if (r.meta.estab) estabs.add(r.meta.estab);
  }

  const prevCli = state.clientFilter;
  selClient.innerHTML = [
    '<option value="">Todos os clientes</option>',
    ...Array.from(clients.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([cod, name]) => `<option value="${cod}">${cod} — ${name}</option>`)
  ].join('');
  selClient.value = clients.has(prevCli) ? prevCli : '';
  state.clientFilter = selClient.value;

  const prevEst = state.estabFilter;
  selEstab.innerHTML = [
    '<option value="">Todos os estabelecimentos</option>',
    ...Array.from(estabs)
      .sort()
      .map((est) => `<option value="${est}">${est}</option>`)
  ].join('');
  selEstab.value = estabs.has(prevEst) ? prevEst : '';
  state.estabFilter = selEstab.value;
}

function getKpiCounts(rows) {
  let ready = 0;
  let missingMotive = 0;
  let missingDePara = 0;
  let divergences = 0;
  let reviewMotive = 0;
  let unchanged = 0;

  for (const r of rows) {
    const m = r.meta;
    if (m.needsMotivo) missingMotive++;
    if (!m.hasDePara) missingDePara++;
    if (m.hasCaixaria || m.hasValor || m.hasSpot) divergences++;
    if (m.motiveConfidence === 'review' || m.motiveConfidence === 'suggested') reviewMotive++;
    if (m.unchanged) unchanged++;
    if (!m.unchanged && !m.needsMotivo && m.hasDePara) ready++;
  }

  return {
    all: rows.length,
    ready,
    missing_motive: missingMotive,
    missing_depara: missingDePara,
    divergences,
    review_motive: reviewMotive,
    unchanged
  };
}

function getFilteredRows() {
  const q = state.searchQuery.trim().toLowerCase();
  return state.processedRows.filter((r) => {
    const m = r.meta;
    const raw = r.raw;
    const out = r.output;

    if (state.activeStatusFilter === 'ready' && !(!m.unchanged && !m.needsMotivo && m.hasDePara)) return false;
    if (state.activeStatusFilter === 'missing_motive' && !m.needsMotivo) return false;
    if (state.activeStatusFilter === 'missing_depara' && m.hasDePara) return false;
    if (state.activeStatusFilter === 'divergences' && !(m.hasCaixaria || m.hasValor || m.hasSpot)) return false;
    if (
      state.activeStatusFilter === 'review_motive' &&
      !(m.motiveConfidence === 'review' || m.motiveConfidence === 'suggested')
    )
      return false;
    if (state.activeStatusFilter === 'unchanged' && !m.unchanged) return false;

    if (state.clientFilter && m.codCliente !== state.clientFilter) return false;
    if (state.estabFilter && m.estab !== state.estabFilter) return false;

    if (q) {
      const hay = [
        raw['Núm. OC'],
        raw['Cód. OC Externo'],
        raw['Cód. Item'],
        raw['Desc. Item'],
        raw['Cód. Item Fornecedor'],
        m.codCBS,
        m.totvsPedido,
        out['Núm. NF'],
        out['Observação'],
        out['Motivo'],
        m.cliente,
        m.estab
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }

    return true;
  });
}

const tableCtrl = new TriageTableController({
  tbodyEl: document.getElementById('triage-tbody'),
  paginationEl: document.getElementById('triage-pagination'),
  getRows: () => state.processedRows,
  getFrases: () => state.config?.frases || [],
  getMotiveResolver: () => state.motiveResolver,
  onRowUpdated: (_, { skipFullRender }) => {
    renderKpis();
    if (!skipFullRender) {
      tableCtrl.render(getFilteredRows(), tableCtrl.currentPage);
    }
  },
  onOpenDeParaModal: (row) => {
    adminModal.open('depara', {
      codCliente: row.meta.codCliente,
      codItem: row.raw['Cód. Item'],
      descItem: row.raw['Desc. Item']
    });
  }
});

const adminModal = new AdminModalController({
  backdropEl: document.getElementById('admin-backdrop'),
  titleEl: document.getElementById('admin-title'),
  tabsEl: document.getElementById('admin-tabs'),
  bodyEl: document.getElementById('admin-body'),
  closeBtn: document.getElementById('admin-close'),
  getConfig: () => state.config,
  getMotiveResolver: () => state.motiveResolver,
  getLoadedClients: () => {
    const s = new Set();
    for (const r of state.processedRows) {
      if (r.meta.codCliente) s.add(r.meta.codCliente);
    }
    return Array.from(s).sort((a, b) => Number(a) - Number(b));
  },
  onConfigChanged: async (nextConfig, shouldReprocess) => {
    state.config = await repo.save(nextConfig);
    rebuildIndexes();
    if (shouldReprocess && state.csvParsed) {
      reprocessRows({ preserveEdited: true });
    }
  },
  onResetConfig: async () => {
    state.config = await repo.reset();
    rebuildIndexes();
    if (state.csvParsed) {
      reprocessRows({ preserveEdited: true });
    }
  },
  showToast
});

function renderKpis() {
  const counts = getKpiCounts(state.processedRows);
  const cards = [
    { key: 'all', label: 'Total de Linhas', val: counts.all, cls: '' },
    { key: 'ready', label: 'Prontas / Alteradas', val: counts.ready, cls: 'success' },
    { key: 'missing_motive', label: 'Sem Motivo', val: counts.missing_motive, cls: 'warn' },
    { key: 'missing_depara', label: 'Sem De-Para', val: counts.missing_depara, cls: 'danger' },
    { key: 'divergences', label: 'Divergências', val: counts.divergences, cls: 'warn' },
    { key: 'review_motive', label: 'Motivos p/ Revisar', val: counts.review_motive, cls: 'info' },
    { key: 'unchanged', label: 'Sem Alteração', val: counts.unchanged, cls: '' }
  ];

  kpiGrid.innerHTML = cards
    .map(
      (c) => `
      <button type="button" class="kpi-card ${c.cls} ${state.activeStatusFilter === c.key ? 'active' : ''}" data-kpi="${c.key}">
        <span class="kpi-label">${c.label}</span>
        <span class="kpi-value">${c.val.toLocaleString('pt-BR')}</span>
      </button>`
    )
    .join('');

  kpiGrid.querySelectorAll('[data-kpi]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeStatusFilter = btn.dataset.kpi;
      renderAll();
    });
  });

  btnReviewBadge.textContent = String(counts.review_motive);
  btnReviewBadge.style.display = counts.review_motive > 0 ? 'inline-flex' : 'none';
  btnExportCsv.disabled = state.processedRows.length === 0;
  btnReprocessForce.disabled = !state.csvParsed;
}

function renderAll() {
  renderKpis();
  const filtered = getFilteredRows();
  toolbarStats.textContent = `${filtered.length.toLocaleString('pt-BR')} de ${state.processedRows.length.toLocaleString('pt-BR')} exibidas`;
  tableCtrl.render(filtered, 1);
}

// Drag & Drop handlers
async function handleCsvFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseGtplanCsv(text);
    state.csvParsed = parsed;
    state.csvMeta = `${file.name} (${parsed.rows.length} linhas)`;
    metaCsvEl.textContent = state.csvMeta;
    dzCsv.classList.add('loaded');
    reprocessRows({ preserveEdited: false });
  } catch (err) {
    showToast(`Erro ao ler CSV: ${err.message}`);
  }
}

async function handleTotvsFile(file) {
  if (!file) return;
  try {
    metaTotvsEl.textContent = `Lendo ${file.name}...`;
    const t0 = performance.now();
    const buf = new Uint8Array(await file.arrayBuffer());
    const sheetsRaw = await readWorkbookSheets(buf, [
      'Dados Simplificados',
      'AjusteRemessa',
      'SemContrato',
      'LojasNoGtplan',
      'leadtime'
    ]);

    const sheets = {
      'Dados Simplificados': rowsToObjects(sheetsRaw['Dados Simplificados'] || [], 1),
      AjusteRemessa: rowsToObjects(sheetsRaw['AjusteRemessa'] || [], 1),
      SemContrato: rowsToObjects(sheetsRaw['SemContrato'] || [], 1),
      LojasNoGtplan: rowsToObjects(sheetsRaw['LojasNoGtplan'] || [], 1),
      leadtime: rowsToObjects(sheetsRaw['leadtime'] || [], 1)
    };

    state.totvsIdx = indexTotvsWorkbook(sheets);
    const ms = Math.round(performance.now() - t0);
    state.totvsMeta = `${file.name} (${state.totvsIdx.byProdOc.size} itens/OC indexados em ${ms} ms)`;
    metaTotvsEl.textContent = state.totvsMeta;
    dzTotvs.classList.add('loaded');

    if (state.csvParsed) {
      reprocessRows({ preserveEdited: true });
    } else {
      showToast('Base TOTVS carregada! Agora arraste o CSV do GTplan.');
    }
  } catch (err) {
    metaTotvsEl.textContent = 'Falha ao ler Excel TOTVS';
    showToast(`Erro no XLSX TOTVS: ${err.message}`);
  }
}

function wireDropzone(dzEl, inputEl, onFile) {
  dzEl.addEventListener('click', () => inputEl.click());
  inputEl.addEventListener('change', (e) => {
    if (e.target.files?.[0]) onFile(e.target.files[0]);
    inputEl.value = '';
  });
  dzEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    dzEl.classList.add('drag-over');
  });
  dzEl.addEventListener('dragleave', () => dzEl.classList.remove('drag-over'));
  dzEl.addEventListener('drop', (e) => {
    e.preventDefault();
    dzEl.classList.remove('drag-over');
    if (e.dataTransfer?.files?.[0]) onFile(e.dataTransfer.files[0]);
  });
}

function triggerDownload(filename, content) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let currentExportBatches = [];

btnExportCsv.addEventListener('click', () => {
  if (state.processedRows.length === 0) return;
  const batches = buildGtplanCsvBatches(state.processedRows, { batchSize: 1000 });
  currentExportBatches = batches;

  if (batches.length === 1) {
    triggerDownload(batches[0].filename, batches[0].content);
    showToast(`Exportado ${batches[0].filename} (${batches[0].rowCount} linhas).`);
    return;
  }

  exportListEl.innerHTML = batches
    .map(
      (b, idx) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--border-soft);border-radius:7px;">
        <div>
          <strong class="mono">${b.filename}</strong>
          <div class="sub-line">Lote ${b.batchNumber} de ${b.totalBatches} — ${b.rowCount} linhas (24 colunas)</div>
        </div>
        <button type="button" class="btn btn-primary btn-xs" data-dl-batch="${idx}">Baixar Lote ${b.batchNumber}</button>
      </div>`
    )
    .join('');

  exportListEl.querySelectorAll('[data-dl-batch]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const b = currentExportBatches[Number(btn.dataset.dlBatch)];
      triggerDownload(b.filename, b.content);
    });
  });

  exportBackdrop.classList.remove('hidden');
});

btnExportAllSeq.addEventListener('click', () => {
  currentExportBatches.forEach((b, i) => {
    setTimeout(() => triggerDownload(b.filename, b.content), i * 350);
  });
  showToast(`Iniciando download de ${currentExportBatches.length} lotes.`);
});

btnExportClose.addEventListener('click', () => exportBackdrop.classList.add('hidden'));
exportBackdrop.addEventListener('click', (e) => {
  if (e.target === exportBackdrop) exportBackdrop.classList.add('hidden');
});

selClient.addEventListener('change', () => {
  state.clientFilter = selClient.value;
  renderAll();
});

selEstab.addEventListener('change', () => {
  state.estabFilter = selEstab.value;
  renderAll();
});

inpSearch.addEventListener('input', () => {
  state.searchQuery = inpSearch.value;
  renderAll();
});

btnOpenReview.addEventListener('click', () => adminModal.open('motives'));
btnOpenAdmin.addEventListener('click', () => adminModal.open('rules'));
btnReprocessForce.addEventListener('click', () => reprocessRows({ preserveEdited: false }));

wireDropzone(dzCsv, inpCsv, handleCsvFile);
wireDropzone(dzTotvs, inpTotvs, handleTotvsFile);

async function boot() {
  state.config = await repo.load();
  rebuildIndexes();
  renderAll();
}

boot();

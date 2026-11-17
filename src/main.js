import { SEED_DATA } from './data/seedData.js';
import { IndexedDbRepository, newId, normalizeFrases } from './storage/repository.js';
import { HAS_DEFAULT_CLOUD, HybridRepository, SupabaseClient, loadCloudConfig, saveCloudConfig } from './storage/cloudRepository.js';
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
import { icon } from './ui/icons.js';
import { enableColumnResize } from './ui/columnResize.js';

const cloudStatusEl = document.getElementById('cloud-status');
let cloudStatus = { mode: 'local' };

function renderCloudStatus() {
  if (!cloudStatusEl) return;
  const s = cloudStatus;
  const map = {
    local: HAS_DEFAULT_CLOUD
      ? ['is-local', 'Entrar na nuvem', 'Você ainda não entrou: vínculos e configurações estão só neste navegador. Clique para entrar com seu e-mail e senha.']
      : ['is-local', 'Salvo neste navegador', 'Vínculos e configurações ficam só neste computador. Configure a nuvem em Configurações → Nuvem para compartilhar com a equipe.'],
    cloud: ['is-cloud', 'Nuvem conectada', `Sincronizado com a equipe${s.user?.email ? ` · ${s.user.email}` : ''}`],
    error: ['is-error', 'Nuvem com erro', s.message || 'Falha ao falar com a nuvem. Os dados seguem salvos neste navegador.']
  };
  const [cls, label, title] = map[s.mode] || map.local;
  cloudStatusEl.className = `cloud-status ${cls}`;
  cloudStatusEl.textContent = label;
  cloudStatusEl.title = title;
}

function makeCloudClient() {
  const cfg = loadCloudConfig();
  return cfg.url && cfg.anonKey ? new SupabaseClient(cfg) : null;
}

const repo = new HybridRepository({
  local: new IndexedDbRepository(SEED_DATA),
  seedData: SEED_DATA,
  client: makeCloudClient(),
  onStatus: (s) => {
    const wasError = cloudStatus.mode === 'error';
    cloudStatus = s;
    renderCloudStatus();
    if (s.mode === 'error' && !wasError) showToast(s.message || 'Falha na nuvem.', 'error');
  }
});

/** Recarrega a configuração (ex.: depois de login/logout na nuvem) e reprocessa o lote. */
async function reloadConfig() {
  state.config = await repo.load();
  rebuildIndexes();
  if (state.csvParsed) reprocessRows({ preserveEdited: true, silent: true, keepPage: true });
  else renderAll();
}

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
const ingestGrid = document.getElementById('ingest-grid');
const dzCsv = document.getElementById('dz-csv');
const inpCsv = document.getElementById('inp-csv');
const metaCsvEl = document.getElementById('meta-csv');

const dzTotvs = document.getElementById('dz-totvs');
const inpTotvs = document.getElementById('inp-totvs');
const metaTotvsEl = document.getElementById('meta-totvs');

const summaryCard = document.getElementById('summary-card');
const progressText = document.getElementById('progress-text');
const progressFill = document.getElementById('progress-fill');
const progressTrack = document.getElementById('progress-track');
const kpiGrid = document.getElementById('kpi-grid');
const selClient = document.getElementById('filter-client');
const selEstab = document.getElementById('filter-estab');
const inpSearch = document.getElementById('filter-search');
const toolbarStats = document.getElementById('toolbar-stats');
const btnClearFilters = document.getElementById('btn-clear-filters');
const tableScroll = document.getElementById('table-scroll');

const btnReviewBadge = document.getElementById('btn-review-count');
const btnOpenReview = document.getElementById('btn-open-review');
const btnOpenAdmin = document.getElementById('btn-open-admin');
const btnExportCsv = document.getElementById('btn-export-csv');
const btnReprocessForce = document.getElementById('btn-reprocess-force');

const exportBackdrop = document.getElementById('export-backdrop');
const exportSummaryEl = document.getElementById('export-summary');
const exportListEl = document.getElementById('export-batch-list');
const btnExportAllSeq = document.getElementById('btn-export-all-seq');
const btnExportClose = document.getElementById('btn-export-close');
const btnExportCancel = document.getElementById('btn-export-cancel');

const toastEl = document.getElementById('toast');
let toastTimer = null;

const fmt = (n) => Number(n || 0).toLocaleString('pt-BR');

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} msg
 * @param {'info'|'success'|'error'} [type]
 */
function showToast(msg, type = 'info') {
  if (type === 'info' && /^(erro|falha)/i.test(msg)) type = 'error';
  toastEl.textContent = msg;
  toastEl.className = `toast toast-${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), type === 'error' ? 7000 : 3600);
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

function reprocessRows({ preserveEdited = true, silent = false, keepPage = false } = {}) {
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
  renderAll(keepPage ? tableCtrl.currentPage : 1);
  if (silent) return;
  const kept = previousEdited.size > 0 ? ` (${fmt(previousEdited.size)} edições manuais mantidas)` : '';
  if (!state.totvsIdx) {
    // Sem a base TOTVS o motor não acha pedido/NF: quase nada é preenchido. Deixa isso explícito.
    showToast('CSV carregado, mas falta a Base TOTVS (passo 2). Sem ela as respostas não são preenchidas.', 'error');
    return;
  }
  showToast(`${fmt(state.processedRows.length)} linhas preenchidas em ${elapsed} ms${kept}.`, 'success');
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
    `<option value="">Todos os clientes (${clients.size})</option>`,
    ...Array.from(clients.entries())
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([cod, name]) => `<option value="${esc(cod)}">${esc(cod)} — ${esc(name)}</option>`)
  ].join('');
  selClient.value = clients.has(prevCli) ? prevCli : '';
  state.clientFilter = selClient.value;

  const prevEst = state.estabFilter;
  selEstab.innerHTML = [
    `<option value="">Todos os estabelecimentos (${estabs.size})</option>`,
    ...Array.from(estabs)
      .sort()
      .map((est) => `<option value="${esc(est)}">${esc(est)}</option>`)
  ].join('');
  selEstab.value = estabs.has(prevEst) ? prevEst : '';
  state.estabFilter = selEstab.value;
}

const isReady = (m) => !m.unchanged && !m.needsMotivo && m.hasDePara;

function getKpiCounts(rows) {
  let ready = 0;
  let missingMotive = 0;
  let missingDePara = 0;
  let divergences = 0;
  let reviewMotive = 0;
  let unchanged = 0;
  let pending = 0;

  for (const r of rows) {
    const m = r.meta;
    if (m.needsMotivo) missingMotive++;
    if (!m.hasDePara) missingDePara++;
    if (m.needsMotivo || !m.hasDePara) pending++;
    if (m.hasCaixaria || m.hasValor || m.hasSpot) divergences++;
    if (m.motiveConfidence === 'review' || m.motiveConfidence === 'suggested') reviewMotive++;
    if (m.unchanged) unchanged++;
    if (isReady(m)) ready++;
  }

  return {
    all: rows.length,
    ready,
    pending,
    missing_motive: missingMotive,
    missing_depara: missingDePara,
    divergences,
    review_motive: reviewMotive,
    unchanged
  };
}

function hasActiveFilters() {
  return Boolean(
    state.activeStatusFilter !== 'all' || state.clientFilter || state.estabFilter || state.searchQuery.trim()
  );
}

function getFilteredRows() {
  const q = state.searchQuery.trim().toLowerCase();
  return state.processedRows.filter((r) => {
    const m = r.meta;
    const raw = r.raw;
    const out = r.output;

    if (state.activeStatusFilter === 'ready' && !isReady(m)) return false;
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

function clearFilters() {
  state.activeStatusFilter = 'all';
  state.clientFilter = '';
  state.estabFilter = '';
  state.searchQuery = '';
  selClient.value = '';
  selEstab.value = '';
  inpSearch.value = '';
  renderAll();
}

const tableCtrl = new TriageTableController({
  tbodyEl: document.getElementById('triage-tbody'),
  paginationEl: document.getElementById('triage-pagination'),
  scrollEl: tableScroll,
  getRows: () => state.processedRows,
  getFrases: () => state.config?.frases || [],
  getMotiveResolver: () => state.motiveResolver,
  getEmptyContext: () => ({ hasCsv: Boolean(state.csvParsed), hasFilters: hasActiveFilters() }),
  onClearFilters: clearFilters,
  onRowUpdated: (_, { skipFullRender }) => {
    renderKpis();
    if (!skipFullRender) {
      const filtered = getFilteredRows();
      renderToolbar(filtered.length);
      tableCtrl.render(filtered, tableCtrl.currentPage);
    }
  },
  onLinkCbs: async ({ codCliente, codItem, descItem, codes, mult }) => {
    const cfg = state.config;
    const list = cfg.customDePara || (cfg.customDePara = []);
    let added = 0;
    for (const codCBS of codes) {
      const dup = list.some((d) => d.codItem === codItem && d.codCBS === codCBS && (d.codCliente || '') === codCliente);
      if (dup) continue;
      list.push({ id: newId(), codCliente, codItem, descItem, codCBS, mult, createdAt: new Date().toISOString() });
      added++;
    }
    if (!added) {
      showToast('Esse vínculo já existia.', 'info');
      return;
    }
    const before = state.processedRows.filter((r) => r.meta.hasTotvs).length;
    state.config = await repo.save(cfg);
    rebuildIndexes();
    reprocessRows({ preserveEdited: true, silent: true, keepPage: true });
    const gained = state.processedRows.filter((r) => r.meta.hasTotvs).length - before;
    showToast(
      `Vinculado ${codItem} → ${codes.join(', ')}.${gained > 0 ? ` ${gained} linha(s) agora encontradas no TOTVS.` : ' Nenhuma linha nova cruzou com o TOTVS ainda.'}`,
      gained > 0 ? 'success' : 'info'
    );
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
    nextConfig.frases = normalizeFrases(nextConfig.frases);
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
  cloud: {
    getState: () => ({ cfg: loadCloudConfig(), user: repo.client?.user || null, status: cloudStatus, builtIn: HAS_DEFAULT_CLOUD }),
    connect: async ({ url, anonKey, email, password }) => {
      const cfg = { url: String(url).trim().replace(/\/+$/, ''), anonKey: String(anonKey).trim() };
      const client = new SupabaseClient(cfg);
      await client.signIn(String(email).trim(), password); // erro sobe para a tela
      saveCloudConfig(cfg);
      repo.setClient(client);
      await reloadConfig();
      return client.user;
    },
    reload: () => reloadConfig(),
    logout: async () => {
      repo.client?.signOut();
      repo.setClient(makeCloudClient());
      await reloadConfig();
    },
    forget: async () => {
      repo.client?.signOut();
      saveCloudConfig(null);
      repo.setClient(null);
      await reloadConfig();
    },
    uploadLocal: async () => {
      const res = await repo.uploadLocal();
      await reloadConfig();
      return res;
    }
  },
  showToast
});

const KPI_GROUPS = [
  {
    label: 'Visão geral',
    cards: [
      { key: 'all', label: 'Todas', cls: 'neutral', help: 'Todas as linhas do CSV carregado.' },
      { key: 'ready', label: 'Prontas', cls: 'success', help: 'Têm De-Para e Motivo e foram alteradas: serão enviadas como resposta.' },
      { key: 'unchanged', label: 'Sem alteração', cls: 'muted', help: 'A observação gerada é igual à que já estava no portal; nada novo a responder.' }
    ]
  },
  {
    label: 'Precisa de atenção',
    cards: [
      { key: 'missing_depara', label: 'Sem De-Para', cls: 'danger', help: 'Item do GTplan sem código CBS correspondente. Use "Vincular CBS" na linha.' },
      { key: 'missing_motive', label: 'Sem Motivo', cls: 'warn', help: 'O motor não conseguiu decidir um motivo. Escolha um na coluna Motivo.' },
      { key: 'review_motive', label: 'Motivo p/ revisar', cls: 'info', help: 'Motivo sugerido automaticamente ou ambíguo para o cliente. Confira antes de exportar.' },
      { key: 'divergences', label: 'Divergências', cls: 'warn', help: 'Caixaria (quantidade não múltipla), valor acima de 3% ou item Spot (fora de contrato).' }
    ]
  }
];

function renderKpis() {
  const counts = getKpiCounts(state.processedRows);
  const hasRows = state.processedRows.length > 0;
  summaryCard.hidden = !hasRows;

  // Progresso: linhas que já não exigem ação (prontas + sem alteração)
  const resolved = counts.all - counts.pending;
  const pct = counts.all ? Math.round((resolved / counts.all) * 100) : 0;
  progressFill.style.width = `${pct}%`;
  progressTrack.setAttribute('aria-valuenow', String(pct));
  progressText.innerHTML = counts.pending
    ? `<strong>${fmt(counts.pending)}</strong> pendente${counts.pending === 1 ? '' : 's'} · ${pct}% ok`
    : `<strong>${icon('circle-check')}</strong> Nenhuma pendência`;
  progressText.title = 'Pendentes = linhas sem De-Para ou sem Motivo';

  kpiGrid.innerHTML = KPI_GROUPS.map(
    (g) => `
      <div class="kpi-group">
        <span class="kpi-group-label">${g.label}</span>
        <div class="kpi-group-items">
          ${g.cards
            .map((c) => {
              const val = counts[c.key];
              const active = state.activeStatusFilter === c.key;
              return `
                <button type="button" class="kpi-card ${c.cls} ${active ? 'active' : ''} ${val === 0 && c.key !== 'all' ? 'is-zero' : ''}"
                  data-kpi="${c.key}" title="${esc(c.help)}" aria-pressed="${active}">
                  <span class="kpi-label">${c.label}</span>
                  <span class="kpi-value">${fmt(val)}</span>
                </button>`;
            })
            .join('')}
        </div>
      </div>`
  ).join('');

  btnReviewBadge.textContent = String(counts.review_motive);
  btnReviewBadge.hidden = counts.review_motive === 0;
  btnExportCsv.disabled = !hasRows;
  btnReprocessForce.disabled = !state.csvParsed;
}

kpiGrid.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-kpi]');
  if (!btn) return;
  // Clicar de novo no filtro ativo volta para "Todas"
  state.activeStatusFilter = state.activeStatusFilter === btn.dataset.kpi ? 'all' : btn.dataset.kpi;
  renderAll();
});

function renderToolbar(filteredCount) {
  const total = state.processedRows.length;
  toolbarStats.textContent =
    total === 0
      ? 'Nenhuma linha carregada'
      : filteredCount === total
        ? `${fmt(total)} linhas`
        : `${fmt(filteredCount)} de ${fmt(total)} linhas`;
  btnClearFilters.hidden = !hasActiveFilters();
  selClient.classList.toggle('is-active', Boolean(state.clientFilter));
  selEstab.classList.toggle('is-active', Boolean(state.estabFilter));
}

function renderIngest() {
  const hasCsv = Boolean(state.csvParsed);
  ingestGrid.classList.toggle('is-compact', hasCsv);

  const csvTag = dzCsv.querySelector('[data-dz-tag]');
  const csvAction = dzCsv.querySelector('[data-dz-action]');
  if (hasCsv) {
    csvTag.textContent = 'Carregado';
    csvTag.className = 'dz-tag dz-tag-done';
    csvAction.textContent = 'Trocar arquivo';
  }

  const totvsTag = dzTotvs.querySelector('[data-dz-tag]');
  const totvsAction = dzTotvs.querySelector('[data-dz-action]');
  if (state.totvsIdx) {
    totvsTag.textContent = 'Carregado';
    totvsTag.className = 'dz-tag dz-tag-done';
    totvsAction.textContent = 'Trocar arquivo';
    dzTotvs.classList.remove('missing');
  } else if (hasCsv) {
    totvsTag.textContent = 'Não carregada';
    totvsTag.className = 'dz-tag dz-tag-warn';
    totvsAction.textContent = 'Carregar XLSX';
    dzTotvs.classList.add('missing');
    metaTotvsEl.textContent = 'Falta este arquivo: sem ele as colunas Nova Prev., NF, Motivo e Observação não são preenchidas.';
  }
}

function renderAll(page = 1) {
  renderIngest();
  renderKpis();
  const filtered = getFilteredRows();
  renderToolbar(filtered.length);
  tableCtrl.render(filtered, page);
}

// Drag & Drop handlers
async function handleCsvFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name)) {
    showToast(`"${file.name}" não parece um CSV. Use o arquivo exportado do GTplan.`, 'error');
    return;
  }
  const editedCount = state.processedRows.filter((r) => r.meta.editedByUser).length;
  if (
    editedCount > 0 &&
    !window.confirm(`Você tem ${editedCount} linha(s) editada(s) manualmente. Carregar um novo CSV descarta essas edições. Continuar?`)
  ) {
    return;
  }
  try {
    const text = await file.text();
    const parsed = parseGtplanCsv(text);
    state.csvParsed = parsed;
    state.csvMeta = `${file.name} · ${fmt(parsed.rows.length)} linhas`;
    metaCsvEl.textContent = state.csvMeta;
    metaCsvEl.title = file.name;
    dzCsv.classList.add('loaded');
    state.activeStatusFilter = 'all';
    reprocessRows({ preserveEdited: false });
  } catch (err) {
    showToast(`Erro ao ler CSV: ${err.message}`, 'error');
  }
}

async function handleTotvsFile(file) {
  if (!file) return;
  if (!/\.xls[xm]$/i.test(file.name)) {
    showToast(`"${file.name}" não é um Excel .xlsx/.xlsm.`, 'error');
    return;
  }
  try {
    metaTotvsEl.textContent = `Lendo ${file.name}…`;
    dzTotvs.classList.add('is-loading');
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
    state.totvsMeta = `${file.name} · ${fmt(state.totvsIdx.byProdOc.size)} itens/OC indexados (${ms} ms)`;
    metaTotvsEl.textContent = state.totvsMeta;
    metaTotvsEl.title = file.name;
    dzTotvs.classList.add('loaded');

    if (state.csvParsed) {
      reprocessRows({ preserveEdited: true });
    } else {
      renderIngest();
      showToast('Base TOTVS carregada. Agora carregue o CSV do GTplan (passo 1).', 'success');
    }
  } catch (err) {
    metaTotvsEl.textContent = 'Falha ao ler o Excel TOTVS. Confira se é o bimestreamil.xlsx.';
    showToast(`Erro no XLSX TOTVS: ${err.message}`, 'error');
  } finally {
    dzTotvs.classList.remove('is-loading');
  }
}

function wireDropzone(dzEl, inputEl, onFile) {
  dzEl.addEventListener('click', () => inputEl.click());
  dzEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      inputEl.click();
    }
  });
  inputEl.addEventListener('click', (e) => e.stopPropagation());
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

// Evita que um arquivo solto fora das áreas abra no navegador e perca o trabalho
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => e.preventDefault());

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

function openExportModal() {
  if (state.processedRows.length === 0) return;
  const batches = buildGtplanCsvBatches(state.processedRows, { batchSize: 1000 });
  currentExportBatches = batches;
  const counts = getKpiCounts(state.processedRows);

  const warnings = [];
  if (counts.missing_depara) warnings.push(`<li><strong>${fmt(counts.missing_depara)}</strong> sem De-Para</li>`);
  if (counts.missing_motive) warnings.push(`<li><strong>${fmt(counts.missing_motive)}</strong> sem Motivo (vão com o campo Motivo vazio)</li>`);
  if (counts.review_motive) warnings.push(`<li><strong>${fmt(counts.review_motive)}</strong> com motivo sugerido/para revisar</li>`);

  exportSummaryEl.innerHTML = `
    <div class="callout ${warnings.length ? 'callout-warn' : 'callout-success'}">
      ${
        warnings.length
          ? `<strong>Atenção: ainda há linhas pendentes.</strong> O arquivo pode ser gerado mesmo assim, mas confira:<ul>${warnings.join('')}</ul>`
          : `<strong>Tudo certo.</strong> Nenhuma linha pendente de De-Para ou Motivo.`
      }
    </div>
    <p class="sub-line" style="margin:0;">
      ${fmt(counts.all)} linhas no layout oficial de 24 colunas (UTF-8, separador ";"), incluindo
      ${fmt(counts.unchanged)} sem alteração. O GTplan aceita até 1.000 linhas por arquivo${
        batches.length > 1 ? `, então o envio foi dividido em <strong>${batches.length} lotes</strong>` : ''
      }.
    </p>`;

  exportListEl.innerHTML = batches
    .map(
      (b, idx) => `
      <div class="batch-item">
        <div style="min-width:0;">
          <strong class="mono truncate" style="display:block;">${esc(b.filename)}</strong>
          <div class="sub-line">${b.totalBatches > 1 ? `Lote ${b.batchNumber} de ${b.totalBatches} · ` : ''}${fmt(b.rowCount)} linhas</div>
        </div>
        ${b.totalBatches > 1 ? `<button type="button" class="btn btn-sm" data-dl-batch="${idx}">Baixar lote ${b.batchNumber}</button>` : ''}
      </div>`
    )
    .join('');

  btnExportAllSeq.textContent = batches.length > 1 ? `Baixar os ${batches.length} lotes` : 'Baixar CSV';
  exportBackdrop.classList.remove('hidden');
  btnExportAllSeq.focus();
}

exportListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-dl-batch]');
  if (!btn) return;
  const b = currentExportBatches[Number(btn.dataset.dlBatch)];
  triggerDownload(b.filename, b.content);
  btn.innerHTML = `${icon('check')} Baixado`;
});

function closeExportModal() {
  exportBackdrop.classList.add('hidden');
}

btnExportCsv.addEventListener('click', openExportModal);

btnExportAllSeq.addEventListener('click', () => {
  currentExportBatches.forEach((b, i) => {
    setTimeout(() => triggerDownload(b.filename, b.content), i * 350);
  });
  showToast(
    currentExportBatches.length > 1
      ? `Baixando ${currentExportBatches.length} lotes…`
      : `Exportado ${currentExportBatches[0].filename}.`,
    'success'
  );
  closeExportModal();
});

btnExportClose.addEventListener('click', closeExportModal);
btnExportCancel.addEventListener('click', closeExportModal);
exportBackdrop.addEventListener('click', (e) => {
  if (e.target === exportBackdrop) closeExportModal();
});

selClient.addEventListener('change', () => {
  state.clientFilter = selClient.value;
  renderAll();
});

selEstab.addEventListener('change', () => {
  state.estabFilter = selEstab.value;
  renderAll();
});

let searchTimer = null;
inpSearch.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.searchQuery = inpSearch.value;
    renderAll();
  }, 150);
});

btnClearFilters.addEventListener('click', clearFilters);

btnOpenReview.addEventListener('click', () => adminModal.open('motives'));
btnOpenAdmin.addEventListener('click', () => adminModal.open('rules'));

btnReprocessForce.addEventListener('click', () => {
  const editedCount = state.processedRows.filter((r) => r.meta.editedByUser).length;
  if (editedCount > 0) {
    const discard = window.confirm(
      `Há ${editedCount} linha(s) editada(s) manualmente.\n\nOK = recalcular TUDO e descartar essas edições\nCancelar = recalcular mantendo as edições`
    );
    reprocessRows({ preserveEdited: !discard });
    return;
  }
  reprocessRows({ preserveEdited: false });
});

// Atalhos de teclado: Esc fecha popover/modal; Ctrl+F (ou /) foca a busca
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (tableCtrl.activePopover) {
      tableCtrl.closePopover();
      return;
    }
    if (!exportBackdrop.classList.contains('hidden')) {
      closeExportModal();
      return;
    }
    if (!adminModal.backdropEl.classList.contains('hidden')) {
      adminModal.close();
    }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
  const modalOpen = !exportBackdrop.classList.contains('hidden') || !adminModal.backdropEl.classList.contains('hidden');
  if (!modalOpen && state.processedRows.length && ((e.key === '/' && !typing) || ((e.ctrlKey || e.metaKey) && e.key === 'f'))) {
    e.preventDefault();
    inpSearch.focus();
    inpSearch.select();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.processedRows.some((r) => r.meta.editedByUser)) {
    e.preventDefault();
    e.returnValue = '';
  }
});

wireDropzone(dzCsv, inpCsv, handleCsvFile);
wireDropzone(dzTotvs, inpTotvs, handleTotvsFile);

async function boot() {
  renderCloudStatus();
  state.config = await repo.load();
  rebuildIndexes();
  renderAll();
}

boot();

document.getElementById('cloud-status')?.addEventListener('click', () => adminModal.open('cloud'));

// Colunas com largura ajustável (arrastar a borda do cabeçalho; duplo clique ajusta ao conteúdo)
const btnResetCols = document.getElementById('btn-reset-cols');
const colResizer = enableColumnResize(document.querySelector('table.triage-table.sheet'), {
  onChange: (customized) => {
    if (btnResetCols) btnResetCols.hidden = !customized;
  }
});
btnResetCols?.addEventListener('click', () => colResizer.reset());

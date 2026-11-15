/**
 * triageTable.js — Mesa de Triagem: tabela paginada com filtro, busca e o
 * <select> de resolução manual por linha.
 *
 * Uso:
 *   const table = createTriageTable(el, { frases, onResolve: (id, fraseId) => ... });
 *   table.setData(results); table.setFilter('sem_motivo');
 */
import { PAGE_SIZE, STATUS } from '../../config.js';
import { escapeHtml, formatBytes } from '../dom.js';
import { normalizeText } from '../../core/utils.js';

export const FILTERS = {
  problemas: 'Fila de exceções',
  [STATUS.PRONTO]: '🟢 Prontos',
  [STATUS.SEM_MOTIVO]: '🔵 Sem motivo',
  [STATUS.SEM_DEPARA]: '🔴 Sem de-para',
  todos: 'Todos',
};

const BADGE = {
  [STATUS.PRONTO]: '<span class="inline-flex px-2 py-0.5 rounded-full text-xs bg-emerald-500/15 text-emerald-300">🟢 Pronto</span>',
  [STATUS.SEM_MOTIVO]: '<span class="inline-flex px-2 py-0.5 rounded-full text-xs bg-sky-500/15 text-sky-300">🔵 Sem motivo</span>',
  [STATUS.SEM_DEPARA]: '<span class="inline-flex px-2 py-0.5 rounded-full text-xs bg-rose-500/15 text-rose-300">🔴 Sem de-para</span>',
};

/**
 * Filtro puro (testável). "problemas" = tudo que não foi resolvido automaticamente,
 * incluindo o que já foi resolvido manualmente (para continuar visível na fila).
 */
export function filterResults(results, { filter = 'problemas', search = '' } = {}) {
  const q = normalizeText(search);
  return results.filter((r) => {
    const passFilter = filter === 'todos'
      || (filter === 'problemas' ? (r.status !== STATUS.PRONTO || r.manual) : r.status === filter);
    if (!passFilter) return false;
    if (!q) return true;
    const hay = normalizeText([r.row.cliente, r.row.numOC, r.row.codItem, r.row.descItem, r.codCbs, r.row.idOrdem].join(' '));
    return hay.includes(q);
  });
}

export function createTriageTable(root, { frases, onResolve }) {
  const state = { results: [], filter: 'problemas', search: '', page: 1 };
  let onFilterChange = () => {};

  root.innerHTML = `
    <div class="flex flex-wrap items-center gap-3 mb-3">
      <div data-tabs class="flex flex-wrap gap-1"></div>
      <input data-search type="search" placeholder="Buscar OC, item, descrição, hospital…"
        class="ml-auto w-72 max-w-full px-3 py-2 rounded-lg bg-slate-800 border border-slate-600 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-sky-500">
    </div>
    <div class="overflow-x-auto rounded-xl border border-slate-700">
      <table class="min-w-full text-sm">
        <thead class="bg-slate-800 text-slate-400 text-xs uppercase tracking-wide">
          <tr>
            <th class="px-3 py-2 text-left">Status</th>
            <th class="px-3 py-2 text-left">Cliente</th>
            <th class="px-3 py-2 text-left">OC / Item</th>
            <th class="px-3 py-2 text-left">Descrição</th>
            <th class="px-3 py-2 text-right">Qtd. Pend.</th>
            <th class="px-3 py-2 text-left">CBS (cx)</th>
            <th class="px-3 py-2 text-left">TOTVS</th>
            <th class="px-3 py-2 text-left w-[28rem]">Observação</th>
            <th class="px-3 py-2 text-left">Motivo</th>
          </tr>
        </thead>
        <tbody data-body class="divide-y divide-slate-800"></tbody>
      </table>
    </div>
    <div class="flex items-center justify-between mt-3 text-sm text-slate-400">
      <span data-info></span>
      <div class="flex gap-2">
        <button data-prev class="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 hover:bg-slate-700 disabled:opacity-40">‹ Anterior</button>
        <button data-next class="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-600 hover:bg-slate-700 disabled:opacity-40">Próxima ›</button>
      </div>
    </div>`;

  const tabs = root.querySelector('[data-tabs]');
  const body = root.querySelector('[data-body]');
  const info = root.querySelector('[data-info]');
  const prev = root.querySelector('[data-prev]');
  const next = root.querySelector('[data-next]');
  const searchInput = root.querySelector('[data-search]');

  const options = (selected, hasAuto) => [
    `<option value="">${hasAuto ? '— Automático —' : '— Selecione a resolução —'}</option>`,
    ...frases.map((f) => `<option value="${escapeHtml(f.id)}" ${f.id === selected ? 'selected' : ''}>${escapeHtml(f.texto)}</option>`),
  ].join('');

  function rowHtml(r) {
    const totvs = r.totvsEncontrado
      ? `<span class="text-emerald-300">L${r.totvsLinha}</span>${r.numNF ? `<div class="text-xs text-slate-500">NF ${escapeHtml(r.numNF)}</div>` : ''}`
      : '<span class="text-slate-500">—</span>';
    const pend = r.pendencia
      ? `<div class="mt-1 text-xs ${r.status === STATUS.SEM_DEPARA ? 'text-rose-300' : 'text-sky-300'}">⚠ ${escapeHtml(r.pendencia)}</div>`
      : '';
    const regra = r.regra ? `<span class="text-[10px] uppercase tracking-wide text-slate-500">${escapeHtml(r.regra)}</span>` : '';
    return `
      <tr class="hover:bg-slate-800/50 align-top">
        <td class="px-3 py-2 whitespace-nowrap">${BADGE[r.status]}</td>
        <td class="px-3 py-2"><div class="text-slate-200">${escapeHtml(r.row.cliente)}</div><div class="text-xs text-slate-500">Cód. ${escapeHtml(r.row.codCliente)}</div></td>
        <td class="px-3 py-2 whitespace-nowrap"><div class="font-mono text-slate-200">${escapeHtml(r.row.numOC)}</div><div class="font-mono text-xs text-slate-500">${escapeHtml(r.row.codItem)}</div></td>
        <td class="px-3 py-2 text-slate-300 max-w-[16rem]">${escapeHtml(r.row.descItem)}</td>
        <td class="px-3 py-2 text-right font-mono text-slate-200">${escapeHtml(r.row.original['Qtd. Pendente'])}<div class="text-xs text-slate-500">${escapeHtml(r.row.unidade)}</div></td>
        <td class="px-3 py-2 font-mono text-slate-300 whitespace-nowrap">${r.codCbs ? `${escapeHtml(r.codCbs)} <span class="text-slate-500">×${r.multiplicador}</span>` : '<span class="text-rose-400">—</span>'}</td>
        <td class="px-3 py-2 whitespace-nowrap">${totvs}</td>
        <td class="px-3 py-2">
          <select data-id="${r.id}" class="w-full px-2 py-1.5 rounded-md bg-slate-800 border ${r.manual ? 'border-emerald-600' : 'border-slate-600'} text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500">
            ${options(r.manual, !!r.auto.intent)}
          </select>
          <div class="mt-1 text-xs text-slate-400">${escapeHtml(r.observacao) || '<span class="text-slate-600">(sem observação)</span>'}</div>
          ${pend}
        </td>
        <td class="px-3 py-2 whitespace-nowrap">
          ${r.motivoCodigo ? `<div class="font-mono text-emerald-300">${escapeHtml(r.motivoCodigo)}</div><div class="text-xs text-slate-500 max-w-[12rem] whitespace-normal">${escapeHtml(r.motivoDescricao)}</div>` : '<span class="text-slate-600">—</span>'}
          ${regra}
        </td>
      </tr>`;
  }

  function render() {
    const counts = Object.fromEntries(Object.keys(FILTERS).map((f) => [f, filterResults(state.results, { filter: f }).length]));
    tabs.innerHTML = Object.entries(FILTERS).map(([key, label]) => `
      <button data-filter="${key}" class="px-3 py-1.5 rounded-lg text-sm border ${state.filter === key
        ? 'bg-sky-600 border-sky-500 text-white' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}">
        ${label} <span class="opacity-70">(${counts[key]})</span></button>`).join('');

    const filtered = filterResults(state.results, state);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(start, start + PAGE_SIZE);

    body.innerHTML = pageRows.length
      ? pageRows.map(rowHtml).join('')
      : '<tr><td colspan="9" class="px-3 py-10 text-center text-slate-500">Nenhuma linha neste filtro 🎉</td></tr>';

    info.textContent = filtered.length
      ? `${start + 1}–${start + pageRows.length} de ${filtered.length} linhas · página ${state.page}/${pages}`
      : '0 linhas';
    prev.disabled = state.page <= 1;
    next.disabled = state.page >= pages;
  }

  // Delegação de eventos (um listener para a tabela inteira)
  body.addEventListener('change', (e) => {
    const sel = e.target.closest('select[data-id]');
    if (sel) onResolve(Number(sel.dataset.id), sel.value);
  });
  tabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (btn) api.setFilter(btn.dataset.filter);
  });
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.search = searchInput.value; state.page = 1; render(); }, 200);
  });
  prev.addEventListener('click', () => { state.page--; render(); });
  next.addEventListener('click', () => { state.page++; render(); });

  const api = {
    /** Substitui os dados mantendo filtro/página (ex.: após resolução manual). */
    setData(results) { state.results = results; render(); },
    setFilter(filter) { state.filter = filter; state.page = 1; render(); onFilterChange(filter); },
    getFilter: () => state.filter,
    onFilterChange(fn) { onFilterChange = fn; },
  };
  return api;
}

// Reexport para conveniência de quem só importa a tabela.
export { formatBytes };

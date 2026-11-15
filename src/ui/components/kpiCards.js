/**
 * kpiCards.js — cards de indicadores clicáveis (funcionam como filtro da tabela).
 */
import { STATUS } from '../../config.js';

export const KPI_CARDS = [
  { key: STATUS.PRONTO, emoji: '🟢', title: 'Prontos (Resolvidos)', hint: 'Vão para o CSV',
    ring: 'ring-emerald-500', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  { key: STATUS.SEM_MOTIVO, emoji: '🔵', title: 'Sem Motivo (Ação Necessária)', hint: 'Escolha a observação',
    ring: 'ring-sky-500', text: 'text-sky-400', bg: 'bg-sky-500/10' },
  { key: STATUS.SEM_DEPARA, emoji: '🔴', title: 'Item Sem De-Para', hint: 'Cadastrar no de-para',
    ring: 'ring-rose-500', text: 'text-rose-400', bg: 'bg-rose-500/10' },
];

/**
 * @param {HTMLElement} root
 * @param {object} summary  resultado de summarize()
 * @param {string} activeFilter
 * @param {(key:string)=>void} onSelect
 */
export function renderKpis(root, summary, activeFilter, onSelect) {
  root.innerHTML = KPI_CARDS.map((c) => {
    const value = summary[c.key] ?? 0;
    const pct = summary.total ? Math.round((value / summary.total) * 100) : 0;
    const active = activeFilter === c.key;
    return `
      <button type="button" data-kpi="${c.key}"
        class="text-left rounded-xl border border-slate-700 p-5 transition hover:border-slate-500
               ${c.bg} ${active ? `ring-2 ${c.ring}` : ''}">
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-300">${c.emoji} ${c.title}</span>
          <span class="text-xs text-slate-500">${pct}%</span>
        </div>
        <div class="mt-2 text-4xl font-bold ${c.text}">${value}</div>
        <div class="mt-1 text-xs text-slate-500">${c.hint}${c.key === STATUS.PRONTO && summary.manual ? ` · ${summary.manual} manuais` : ''}</div>
      </button>`;
  }).join('');

  root.querySelectorAll('[data-kpi]').forEach((btn) =>
    btn.addEventListener('click', () => onSelect(btn.dataset.kpi === activeFilter ? 'problemas' : btn.dataset.kpi)));
}

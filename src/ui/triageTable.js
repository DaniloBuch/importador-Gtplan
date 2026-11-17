import { formatShortBRDate, todayUtc } from '../core/dates.js';
import { INTENT_SLUGS, inferSlugFromObservationText } from '../core/motiveResolver.js';
import { stripDatePrefix } from '../core/ruleEngine.js';
import { icon } from './icons.js';

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const DATE_FIELDS = new Set(['Nova Prev. Entrega', 'Dt. NF']);
const BR_DATE_RE = /^\d{2}\/\d{2}\/\d{4}$/;

function isInvalidDate(field, value) {
  const v = String(value ?? '').trim();
  return DATE_FIELDS.has(field) && v !== '' && !BR_DATE_RE.test(v);
}

/** Classe de status da linha (barra colorida à esquerda). */
function rowStatusClass(meta) {
  if (!meta.hasDePara) return 'st-danger';
  if (meta.needsMotivo) return 'st-warn';
  if (meta.unchanged) return 'st-unchanged';
  return 'st-ready';
}

export class TriageTableController {
  constructor({
    tbodyEl,
    paginationEl,
    scrollEl,
    getRows,
    getFrases,
    getMotiveResolver,
    getEmptyContext,
    onClearFilters,
    onRowUpdated,
    onOpenDeParaModal,
    onLinkCbs
  }) {
    this.tbodyEl = tbodyEl;
    this.paginationEl = paginationEl;
    this.scrollEl = scrollEl || null;
    this.getRows = getRows;
    this.getFrases = getFrases;
    this.getMotiveResolver = getMotiveResolver;
    this.getEmptyContext = getEmptyContext || (() => ({ hasCsv: true, hasFilters: false }));
    this.onClearFilters = onClearFilters || (() => {});
    this.onRowUpdated = onRowUpdated;
    this.onOpenDeParaModal = onOpenDeParaModal;
    this.onLinkCbs = onLinkCbs;

    this.pageSize = 60;
    this.currentPage = 1;
    this.autoPrefixDate = true;
    this.activePopover = null;
    this.lastFilteredRows = [];

    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener('click', (e) => {
      if (this.activePopover && !this.activePopover.contains(e.target) && !e.target.closest('[data-popover-trigger]')) {
        this.closePopover();
      }
    });

    // Popover acompanha a rolagem? Mais simples e previsível: fecha ao rolar a tabela.
    if (this.scrollEl) {
      this.scrollEl.addEventListener('scroll', () => this.closePopover(), { passive: true });
    }

    // Navegação de planilha: Enter/↓ desce na mesma coluna, Shift+Enter/↑ sobe.
    // Na Observação, Enter também desce (o CSV não aceita quebra de linha).
    this.tbodyEl.addEventListener('keydown', (e) => {
      const target = e.target;
      const field = target.dataset?.field;
      if (!field) return;
      const isArea = target.tagName === 'TEXTAREA';
      let dir = 0;
      if (e.key === 'Enter') dir = e.shiftKey ? -1 : 1;
      else if (!isArea && e.key === 'ArrowDown') dir = 1;
      else if (!isArea && e.key === 'ArrowUp') dir = -1;
      if (!dir) return;
      e.preventDefault();
      const tr = target.closest('tr');
      const nextTr = dir > 0 ? tr?.nextElementSibling : tr?.previousElementSibling;
      const next = nextTr?.querySelector(`[data-field="${CSS.escape(field)}"]`);
      target.dispatchEvent(new Event('change', { bubbles: true }));
      if (next) {
        next.focus();
        if (typeof next.select === 'function') next.select();
      }
    });

    this.tbodyEl.addEventListener('input', (e) => {
      const target = e.target;
      const tr = target.closest('tr[data-row-index]');
      if (!tr) return;
      const rowIndex = Number(tr.dataset.rowIndex);
      const field = target.dataset.field;
      if (!field) return;

      const row = this._findRow(rowIndex);
      if (!row) return;

      row.output[field] = target.value;
      row.meta.editedByUser = true;
      row.meta.unchanged = false;

      if (field === 'Motivo') {
        row.meta.needsMotivo = !String(target.value).trim();
      }
      if (field === 'Observação') {
        this._autoGrow(target);
        this._refreshObsSuggestion(tr, row);
      }
      if (DATE_FIELDS.has(field) && target.classList.contains('is-invalid')) {
        target.classList.toggle('is-invalid', isInvalidDate(field, target.value));
      }

      this._refreshRowState(tr, row);
      this.onRowUpdated(row, { skipFullRender: true });
    });

    // Garante que qualquer observação editada manualmente mantenha o prefixo da data atual (dd/mm:)
    this.tbodyEl.addEventListener('change', (e) => {
      const target = e.target;
      const field = target.dataset.field;
      if (DATE_FIELDS.has(field)) {
        const invalid = isInvalidDate(field, target.value);
        target.classList.toggle('is-invalid', invalid);
        target.title = invalid ? 'Formato esperado: DD/MM/AAAA' : '';
        return;
      }
      if (field !== 'Observação') return;
      const tr = target.closest('tr[data-row-index]');
      if (!tr) return;
      const row = this._findRow(Number(tr.dataset.rowIndex));
      if (!row) return;

      const body = stripDatePrefix(target.value);
      if (!body) return;
      const todayShort = formatShortBRDate(todayUtc());
      const normalized = `${todayShort}: ${body}`;
      if (target.value !== normalized) {
        target.value = normalized;
        row.output['Observação'] = normalized;
        this._refreshObsSuggestion(tr, row);
        this.onRowUpdated(row, { skipFullRender: true });
      }
    });

    this.tbodyEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'clear-filters') {
        this.onClearFilters();
        return;
      }
      const tr = btn.closest('tr[data-row-index]');
      if (!tr) return;
      const rowIndex = Number(tr.dataset.rowIndex);
      const row = this._findRow(rowIndex);
      if (!row) return;

      const action = btn.dataset.action;
      if (action === 'open-frases') {
        this._togglePopover(btn, () => this._openFrasesPopover(btn, tr, row));
      } else if (action === 'prefix-today') {
        this._applyTodayPrefix(tr, row);
      } else if (action === 'open-motives') {
        this._togglePopover(btn, () => this._openMotivePopover(btn, tr, row));
      } else if (action === 'apply-suggested-motive') {
        const codigo = btn.dataset.codigo || '';
        const desc = btn.dataset.desc || '';
        row.output['Motivo'] = codigo;
        row.meta.resolvedMotiveDesc = desc;
        row.meta.motiveConfidence = 'confirmed';
        row.meta.needsMotivo = !codigo;
        row.meta.editedByUser = true;
        row.meta.unchanged = false;
        this.onRowUpdated(row, { skipFullRender: false });
      } else if (action === 'link-depara') {
        this._togglePopover(btn, () => this._openLinkPopover(btn, tr, row));
      }
    });
  }

  /**
   * Popover "Vincular CBS": permite ligar um ou mais códigos CBS ao item GTplan da linha.
   * Mostra primeiro o que o TOTVS faturou nessa mesma OC (ordenado por semelhança de descrição).
   */
  _openLinkPopover(anchorBtn, tr, row) {
    this.closePopover();
    const { raw, meta } = row;
    const pop = document.createElement('div');
    pop.className = 'floating-popover link-popover';
    pop.dataset.anchorId = anchorBtn.dataset.anchorId || '';
    const suggestions = meta.ocSuggestions || [];
    const likely = suggestions.filter((s) => s.score > 0);
    const others = suggestions.filter((s) => s.score <= 0);
    const linked = meta.candidateCbs || [];

    const sugItem = (s) => `
      <div class="link-sug ${s.score > 0 ? 'is-likely' : ''}">
        <div style="min-width:0;">
          <div><span class="mono strong">${esc(s.codCBS)}</span> ${s.score > 0 ? '<span class="chip chip-success">Provável</span>' : ''}</div>
          <div class="sub-line clamp-2" title="${esc(s.desc)}">${esc(s.desc)}</div>
          <div class="sub-line">Pedido <span class="mono">${esc(s.pedido || '—')}</span>${s.nf ? ` · NF <span class="mono">${esc(s.nf)}</span>` : ''}</div>
        </div>
        <button type="button" class="btn btn-xs btn-primary" data-link-code="${esc(s.codCBS)}">Vincular</button>
      </div>`;

    pop.innerHTML = `
      <div class="floating-popover-head">
        <strong>Vincular CBS ao item <span class="mono">${esc(raw['Cód. Item'])}</span></strong>
        <div class="sub-line clamp-2">${esc(raw['Desc. Item'])}</div>
        ${
          linked.length
            ? `<div class="sub-line">Já procurado no TOTVS como: ${linked.map((c) => `<span class="mono">${esc(c)}</span>`).join(', ')}</div>`
            : ''
        }
      </div>
      <div class="floating-popover-list">
        ${
          suggestions.length
            ? `<div class="link-sec">O TOTVS tem nesta OC e ainda sem par no CSV:</div>${likely.map(sugItem).join('')}${
                others.length
                  ? `<details class="link-others"><summary>Outros ${others.length} item(ns) desta OC</summary>${others.map(sugItem).join('')}</details>`
                  : ''
              }`
            : `<div class="popover-empty">${
                meta.hasTotvs ? 'Este item já foi encontrado no TOTVS.' : 'Nenhum item livre desta OC foi encontrado no TOTVS. Informe o código manualmente abaixo.'
              }</div>`
        }
      </div>
      <form class="floating-popover-foot link-form" data-link-form>
        <label class="field-label" style="grid-column:1/-1;">Ou digite um ou mais códigos CBS (separados por vírgula)</label>
        <input type="text" class="cell-input mono" name="codes" placeholder="Ex.: 000445, 005958" />
        <input type="number" class="cell-input mono" name="mult" min="1" value="1" title="Unidades por caixa" style="width:70px;" />
        <button type="submit" class="btn btn-xs btn-primary">Salvar</button>
        <label class="link-scope" style="grid-column:1/-1;">
          <input type="checkbox" name="onlyClient" checked /> Só para o cliente ${esc(meta.codCliente)} (${esc(meta.cliente)})
        </label>
      </form>
    `;

    document.body.appendChild(pop);
    this.activePopover = pop;
    const form = pop.querySelector('[data-link-form]');

    const submit = (codes, mult) => {
      const clean = codes
        .map((c) => String(c).replace(/\D/g, ''))
        .filter(Boolean)
        .map((c) => c.padStart(6, '0'));
      if (!clean.length) return;
      this.closePopover();
      this.onLinkCbs?.({
        codCliente: form.onlyClient.checked ? meta.codCliente : '',
        codItem: raw['Cód. Item'],
        descItem: raw['Desc. Item'],
        codes: clean,
        mult: Math.max(1, Number(mult) || 1)
      });
    };

    pop.querySelectorAll('[data-link-code]').forEach((b) => {
      b.addEventListener('click', () => submit([b.dataset.linkCode], form.mult.value));
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      submit(form.codes.value.split(/[,;\s]+/), form.mult.value);
    });

    this._positionPopover(pop, anchorBtn);
    (pop.querySelector('[data-link-code]') || form.codes).focus();
  }

  _findRow(rowIndex) {
    return this.getRows().find((r) => r.rowIndex === rowIndex) || null;
  }

  _togglePopover(anchor, openFn) {
    if (this.activePopover && this.activePopover.dataset.anchorId === anchor.dataset.anchorId && anchor.dataset.anchorId) {
      this.closePopover();
      return;
    }
    openFn();
  }

  closePopover() {
    if (this.activePopover) {
      this.activePopover.remove();
      this.activePopover = null;
    }
  }

  _autoGrow(el) {
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight + 2, 160)}px`;
  }

  /** Atualiza barra de status e chips da linha sem re-renderizar a tabela inteira. */
  _refreshRowState(tr, row) {
    tr.classList.remove('st-danger', 'st-warn', 'st-unchanged', 'st-ready');
    tr.classList.add(rowStatusClass(row.meta));
    tr.classList.toggle('row-edited', Boolean(row.meta.editedByUser));
    const statusCell = tr.querySelector('[data-status-cell]');
    if (statusCell) statusCell.innerHTML = this._statusCellHtml(row);
  }

  _applyTodayPrefix(tr, row) {
    const todayShort = formatShortBRDate(todayUtc());
    const current = String(row.output['Observação'] ?? '').trim();
    const body = stripDatePrefix(current);
    const next = body ? `${todayShort}: ${body}` : `${todayShort}: `;
    row.output['Observação'] = next;
    row.meta.editedByUser = true;
    row.meta.unchanged = false;
    const input = tr.querySelector('[data-field="Observação"]');
    if (input) {
      input.value = next;
      input.focus();
      input.setSelectionRange(next.length, next.length);
    }
    this._refreshRowState(tr, row);
    this.onRowUpdated(row, { skipFullRender: true });
  }

  _refreshObsSuggestion(tr, row) {
    const slot = tr.querySelector('[data-obs-suggestion]');
    if (!slot) return;
    const text = row.output['Observação'] || '';
    const inferredSlug = inferSlugFromObservationText(stripDatePrefix(text));
    if (!inferredSlug) {
      slot.innerHTML = '';
      return;
    }
    const resolver = this.getMotiveResolver();
    const res = resolver.resolve(row.meta.codCliente, inferredSlug);
    if (!res.codigo || res.codigo === String(row.output['Motivo'] ?? '').trim()) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = `
      <span class="suggest-pill" title="${esc(`${res.codigo} — ${res.desc}`)}">
        Motivo sugerido: <strong>${esc(res.codigo)}</strong> ${esc(res.desc.slice(0, 32))}${res.desc.length > 32 ? '…' : ''}
        <button type="button" class="btn btn-xs btn-primary"
          data-action="apply-suggested-motive"
          data-codigo="${esc(res.codigo)}"
          data-desc="${esc(res.desc)}">Aplicar</button>
      </span>
    `;
  }

  /**
   * Liga navegação por teclado (↑ ↓ Enter) entre a busca e os itens do popover.
   */
  _wireListKeyboard(searchInput, listEl) {
    let activeIdx = -1;
    const items = () => Array.from(listEl.querySelectorAll('.popover-item'));
    const setActive = (idx) => {
      const all = items();
      if (all.length === 0) return;
      activeIdx = (idx + all.length) % all.length;
      all.forEach((el, i) => el.classList.toggle('is-active', i === activeIdx));
      all[activeIdx].scrollIntoView({ block: 'nearest' });
    };
    searchInput.addEventListener('input', () => {
      activeIdx = -1;
    });
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive(activeIdx + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive(activeIdx - 1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const all = items();
        const target = all[activeIdx >= 0 ? activeIdx : 0];
        if (target) target.click();
      }
    });
  }

  _openFrasesPopover(anchorBtn, tr, row) {
    this.closePopover();
    const pop = document.createElement('div');
    pop.className = 'floating-popover';
    pop.dataset.anchorId = anchorBtn.dataset.anchorId || '';
    const frases = this.getFrases();
    const todayShort = formatShortBRDate(todayUtc());

    pop.innerHTML = `
      <div class="floating-popover-head">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>Inserir frase padrão</strong>
          <span class="chip chip-info">Entra como “${todayShort}: …”</span>
        </div>
        <input type="text" class="cell-input" placeholder="Buscar frase…" data-pop-search />
      </div>
      <div class="floating-popover-list" data-pop-list></div>
      <div class="floating-popover-foot">↑ ↓ para navegar · Enter para inserir · Esc para fechar</div>
    `;

    document.body.appendChild(pop);
    this.activePopover = pop;

    const searchInput = pop.querySelector('[data-pop-search]');
    const listEl = pop.querySelector('[data-pop-list]');

    const renderList = (query = '') => {
      const q = query.trim().toLowerCase();
      const filtered = frases.filter((f) => !q || f.frase.toLowerCase().includes(q) || (f.slug || '').includes(q));
      if (filtered.length === 0) {
        listEl.innerHTML = '<div class="popover-empty">Nenhuma frase encontrada. Você pode digitar livremente no campo Observação.</div>';
        return;
      }
      listEl.innerHTML = filtered
        .map(
          (f, idx) => `
          <button type="button" class="popover-item" data-frase-idx="${idx}">
            <span>${esc(f.frase)}</span>
            ${f.slug ? `<span class="popover-item-sub">Situação: ${esc(INTENT_SLUGS.find((s) => s.slug === f.slug)?.label || f.slug)}</span>` : ''}
          </button>`
        )
        .join('');

      listEl.querySelectorAll('[data-frase-idx]').forEach((itemBtn) => {
        itemBtn.addEventListener('click', () => {
          const picked = filtered[Number(itemBtn.dataset.fraseIdx)];
          const body = stripDatePrefix(picked.frase);
          const nextObs = `${todayShort}: ${body}`;

          row.output['Observação'] = nextObs;
          row.meta.editedByUser = true;
          row.meta.unchanged = false;
          if (picked.slug) {
            row.meta.slug = picked.slug;
          }

          const obsInput = tr.querySelector('[data-field="Observação"]');
          if (obsInput) {
            obsInput.value = nextObs;
            this._autoGrow(obsInput);
          }

          // Sugestão não-rígida: só preenche o motivo automaticamente se ele estava vazio
          if (picked.slug) {
            const resolver = this.getMotiveResolver();
            const res = resolver.resolve(row.meta.codCliente, picked.slug);
            if (res.codigo && !String(row.output['Motivo'] ?? '').trim()) {
              row.output['Motivo'] = res.codigo;
              row.meta.resolvedMotiveDesc = res.desc;
              row.meta.motiveConfidence = res.confidence;
              row.meta.needsMotivo = false;
              this.closePopover();
              this.onRowUpdated(row, { skipFullRender: false });
              return;
            }
          }

          this._refreshObsSuggestion(tr, row);
          this._refreshRowState(tr, row);
          this.closePopover();
          this.onRowUpdated(row, { skipFullRender: true });
        });
      });
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    this._wireListKeyboard(searchInput, listEl);
    renderList();
    this._positionPopover(pop, anchorBtn);
    searchInput.focus();
  }

  _openMotivePopover(anchorBtn, tr, row) {
    this.closePopover();
    const resolver = this.getMotiveResolver();
    const clientMotives = resolver.getClientMotives(row.meta.codCliente);
    const currentCode = String(row.output['Motivo'] ?? '').trim();

    const pop = document.createElement('div');
    pop.className = 'floating-popover';
    pop.dataset.anchorId = anchorBtn.dataset.anchorId || '';
    pop.innerHTML = `
      <div class="floating-popover-head">
        <strong>Motivos do cliente ${esc(row.meta.codCliente)} <span class="sub-line" style="display:inline;">(${clientMotives.length} disponíveis)</span></strong>
        <input type="text" class="cell-input" placeholder="Buscar código ou descrição…" data-pop-search />
      </div>
      <div class="floating-popover-list" data-pop-list></div>
      <div class="floating-popover-head" style="border-top:1px solid var(--border-soft);border-bottom:none;">
        <div class="combo-row">
          <input type="text" class="cell-input" placeholder="Outro código (manual)…" value="${esc(currentCode)}" data-pop-manual />
          <button type="button" class="btn btn-xs btn-primary" data-pop-apply-manual>Usar</button>
          ${currentCode ? '<button type="button" class="btn btn-xs btn-danger-ghost" data-pop-clear title="Deixar o motivo vazio">Limpar</button>' : ''}
        </div>
      </div>
    `;

    document.body.appendChild(pop);
    this.activePopover = pop;

    const searchInput = pop.querySelector('[data-pop-search]');
    const manualInput = pop.querySelector('[data-pop-manual]');
    const manualBtn = pop.querySelector('[data-pop-apply-manual]');
    const clearBtn = pop.querySelector('[data-pop-clear]');
    const listEl = pop.querySelector('[data-pop-list]');

    const applyManual = (val) => {
      row.output['Motivo'] = val;
      const found = resolver.findByCodeOrDesc(row.meta.codCliente, val);
      row.meta.resolvedMotiveDesc = found ? found.desc : '';
      row.meta.motiveConfidence = found ? 'confirmed' : val ? 'manual' : 'missing';
      row.meta.needsMotivo = !val;
      row.meta.editedByUser = true;
      row.meta.unchanged = false;
      this.closePopover();
      this.onRowUpdated(row, { skipFullRender: false });
    };

    manualBtn.addEventListener('click', () => applyManual(manualInput.value.trim()));
    manualInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        applyManual(manualInput.value.trim());
      }
    });
    if (clearBtn) clearBtn.addEventListener('click', () => applyManual(''));

    const renderList = (query = '') => {
      const q = query.trim().toLowerCase();
      const filtered = clientMotives.filter(
        (m) => !q || m.codigo.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      );
      if (filtered.length === 0) {
        listEl.innerHTML = `<div class="popover-empty">Nenhum motivo encontrado para o cliente ${esc(row.meta.codCliente)}. Use o campo manual abaixo ou importe o dicionário de motivos atualizado.</div>`;
        return;
      }
      listEl.innerHTML = filtered
        .map(
          (m) => `
          <button type="button" class="popover-item ${m.codigo === currentCode ? 'is-current' : ''}" data-code="${esc(m.codigo)}" data-desc="${esc(m.desc)}">
            <span><strong class="mono">${esc(m.codigo)}</strong> — ${esc(m.desc)}</span>
            ${m.codigo === currentCode ? '<span class="popover-item-sub">Selecionado atualmente</span>' : ''}
          </button>`
        )
        .join('');

      listEl.querySelectorAll('.popover-item').forEach((itemBtn) => {
        itemBtn.addEventListener('click', () => {
          row.output['Motivo'] = itemBtn.dataset.code;
          row.meta.resolvedMotiveDesc = itemBtn.dataset.desc;
          row.meta.motiveConfidence = 'confirmed';
          row.meta.needsMotivo = false;
          row.meta.editedByUser = true;
          row.meta.unchanged = false;
          this.closePopover();
          this.onRowUpdated(row, { skipFullRender: false });
        });
      });
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    this._wireListKeyboard(searchInput, listEl);
    renderList();
    this._positionPopover(pop, anchorBtn);
    searchInput.focus();
  }

  /** Posiciona abaixo do botão; se não couber, abre para cima. */
  _positionPopover(pop, anchor) {
    const rect = anchor.getBoundingClientRect();
    const h = pop.offsetHeight;
    const w = pop.offsetWidth;
    let top = rect.bottom + 4;
    if (top + h > window.innerHeight - 8 && rect.top - h - 4 > 8) {
      top = rect.top - h - 4;
    }
    top = Math.max(8, Math.min(top, window.innerHeight - h - 8));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    pop.style.top = `${top}px`;
    pop.style.left = `${left}px`;
  }

  _statusCellHtml(row) {
    const { meta } = row;
    const chips = [];
    if (!meta.hasDePara) chips.push('<span class="chip chip-danger">Sem De-Para</span>');
    if (meta.needsMotivo) chips.push('<span class="chip chip-warn">Sem Motivo</span>');
    if (meta.motiveConfidence === 'review' || meta.motiveConfidence === 'suggested') {
      chips.push(
        `<span class="chip chip-info" title="${meta.motiveConfidence === 'review' ? 'Mais de um motivo possível para este cliente' : 'Motivo sugerido por similaridade'}">${meta.motiveConfidence === 'review' ? 'Revisar motivo' : 'Motivo sugerido'}</span>`
      );
    }
    if (meta.hasCaixaria) chips.push(`<span class="chip chip-warn" title="Qtd. pendente não é múltipla da embalagem">Caixa ×${esc(meta.multiplicador)}</span>`);
    if (meta.hasValor) chips.push('<span class="chip chip-warn" title="Valor TOTVS mais de 3% acima do GTplan">Valor &gt;3%</span>');
    if (meta.hasSpot) chips.push('<span class="chip chip-info" title="Item fora de contrato (SemContrato)">Spot</span>');
    if (meta.unchanged) chips.push('<span class="chip chip-neutral" title="Observação igual à já enviada">Sem alteração</span>');
    if (!meta.unchanged && !meta.needsMotivo && meta.hasDePara) chips.push(`<span class="chip chip-success">${icon('check')} Pronta</span>`);

    // Grade compacta: mostra os 2 status mais importantes; o resto aparece no "+N" (tooltip)
    const shown = chips.slice(0, 2);
    const rest = chips.slice(2).map((c) => c.replace(/<[^>]+>/g, '').trim());
    return `
      <div class="chip-stack">${shown.join('')}${
        rest.length ? `<span class="chip chip-neutral" title="${esc(rest.join(' · '))}">+${rest.length}</span>` : ''
      }</div>
    `;
  }

  _renderEmpty() {
    const { hasCsv, hasFilters } = this.getEmptyContext();
    if (!hasCsv) {
      return `
        <tr>
          <td colspan="13" class="empty-state">
            <h3>Comece carregando os arquivos</h3>
            <p>Carregue os <strong>dois arquivos</strong> acima. O app cruza o CSV do portal com a base TOTVS, preenche previsão, NF, Motivo e Observação de cada linha e gera o arquivo de resposta.</p>
            <ol class="empty-steps">
              <li><span class="step-n">01.</span><span><strong>CSV do GTplan</strong><br><span class="sub-line">baixado do portal (pode ter vários clientes)</span></span></li>
              <li><span class="step-n">02.</span><span><strong>Base TOTVS</strong><br><span class="sub-line">bimestreamil.xlsx atualizada</span></span></li>
              <li><span class="step-n">03.</span><span><strong>Revise as pendências</strong><br><span class="sub-line">clique nos cartões em vermelho/amarelo</span></span></li>
              <li><span class="step-n">04.</span><span><strong>Exporte o CSV</strong><br><span class="sub-line">e importe no GTplan</span></span></li>
            </ol>
          </td>
        </tr>`;
    }
    return `
      <tr>
        <td colspan="13" class="empty-state">
          <h3>Nenhuma linha encontrada</h3>
          <p>${hasFilters ? 'Nenhuma linha corresponde aos filtros atuais.' : 'O CSV carregado não tem linhas.'}</p>
          ${hasFilters ? '<button type="button" class="btn btn-sm" data-action="clear-filters">Limpar filtros</button>' : ''}
        </td>
      </tr>`;
  }

  render(filteredRows, page = 1) {
    this.closePopover();
    this.lastFilteredRows = filteredRows;
    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    const prevPage = this.currentPage;
    this.currentPage = Math.max(1, Math.min(page, totalPages));

    if (total === 0) {
      this.tbodyEl.innerHTML = this._renderEmpty();
      this.paginationEl.innerHTML = '';
      return;
    }

    const start = (this.currentPage - 1) * this.pageSize;
    const pageRows = filteredRows.slice(start, start + this.pageSize);
    const resolver = this.getMotiveResolver();
    const todayShort = formatShortBRDate(todayUtc());

    const html = pageRows
      .map((row) => {
        const { raw, output, meta } = row;
        const motiveCode = output['Motivo'] || '';
        const matchedMotive = motiveCode ? resolver.findByCodeOrDesc(meta.codCliente, motiveCode) : null;
        const motiveLabel = matchedMotive
          ? `${matchedMotive.codigo} — ${matchedMotive.desc}`
          : meta.resolvedMotiveDesc && motiveCode
            ? `${motiveCode} — ${meta.resolvedMotiveDesc}`
            : motiveCode || 'Selecionar…';

        const ocExterno =
          raw['Cód. OC Externo'] && raw['Cód. OC Externo'] !== '0' ? ` · Ext. ${raw['Cód. OC Externo']}` : '';

        const trClasses = [rowStatusClass(meta), meta.editedByUser ? 'row-edited' : ''].filter(Boolean).join(' ');
        const anchor = `r${row.rowIndex}`;
        const invNova = isInvalidDate('Nova Prev. Entrega', output['Nova Prev. Entrega']);
        const invDtNf = isInvalidDate('Dt. NF', output['Dt. NF']);
        const likely = (meta.ocSuggestions || []).find((s) => s.score > 0);

        // Célula CBS: código encontrado + atalho para vincular outro quando não cruzou com o TOTVS
        let cbsCell;
        if (!meta.codCBS) {
          cbsCell = `<button type="button" class="btn btn-xs btn-link-cbs is-missing" data-action="link-depara" data-popover-trigger data-anchor-id="l-${anchor}" title="Item sem De-Para: escolher o código CBS">${icon('plus')} Vincular</button>`;
        } else if (!meta.hasTotvs) {
          cbsCell = `
            <span class="mono" title="Procurado no TOTVS como: ${esc((meta.candidateCbs || []).join(', '))}">${esc(meta.codCBS)}</span>
            <button type="button" class="btn btn-xs btn-link-cbs ${likely ? 'has-hint' : ''}" data-action="link-depara" data-popover-trigger data-anchor-id="l-${anchor}"
              title="${likely ? `O TOTVS faturou esta OC com ${esc(likely.codCBS)} — ${esc(likely.desc)}` : 'Não achado no TOTVS: vincular outro código CBS'}">${icon('plus')}${likely ? ` ${esc(likely.codCBS)}?` : ' CBS'}</button>`;
        } else {
          cbsCell = `<span class="mono" title="Pedido TOTVS ${esc(meta.totvsPedido)}">${esc(meta.codCBS)}</span>`;
        }

        return `
          <tr data-row-index="${row.rowIndex}" class="${trClasses}">
            <td class="gutter" title="${meta.editedByUser ? 'Linha editada por você' : `Linha ${row.rowIndex} do CSV`}">${row.rowIndex}</td>
            <td data-status-cell>${this._statusCellHtml(row)}</td>
            <td class="mono" title="${esc(`OC ${raw['Núm. OC']}${ocExterno}`)}">
              ${esc(raw['Núm. OC'])}
              <div class="cell-sub">${meta.hasTotvs ? `TOTVS ${esc(meta.totvsPedido)}` : '<span class="muted">sem pedido</span>'}</div>
            </td>
            <td title="${esc(`${meta.codCliente} — ${meta.cliente} · ${meta.estab}`)}">
              <div class="truncate"><span class="mono">${esc(meta.codCliente)}</span> ${esc(meta.cliente)}</div>
              <div class="cell-sub truncate">${esc(meta.estab)}</div>
            </td>
            <td title="${esc(`${raw['Cód. Item']} — ${raw['Desc. Item']}`)}">
              <div class="truncate"><span class="mono">${esc(raw['Cód. Item'])}</span> ${esc(raw['Desc. Item'])}</div>
              <div class="cell-sub">Atual: <span class="mono">${esc(raw['Prev. Entrega Atual'] || '—')}</span></div>
            </td>
            <td class="cbs-cell">${cbsCell}</td>
            <td class="num mono">${esc(raw['Qtd. Pendente'])}</td>
            <td class="num mono">${esc(raw['Val. Unit.'])}</td>
            <td class="edit"><input type="text" class="cell-input mono ${invNova ? 'is-invalid' : ''}" data-field="Nova Prev. Entrega" value="${esc(output['Nova Prev. Entrega'])}" placeholder="DD/MM/AAAA" inputmode="numeric" aria-label="Nova Prev. Entrega, linha ${row.rowIndex}" /></td>
            <td class="edit"><input type="text" class="cell-input mono" data-field="Núm. NF" value="${esc(output['Núm. NF'])}" placeholder="NF / pedido" aria-label="Núm. NF, linha ${row.rowIndex}" /></td>
            <td class="edit"><input type="text" class="cell-input mono ${invDtNf ? 'is-invalid' : ''}" data-field="Dt. NF" value="${esc(output['Dt. NF'])}" placeholder="DD/MM/AAAA" inputmode="numeric" aria-label="Dt. NF, linha ${row.rowIndex}" /></td>
            <td class="edit">
              <button type="button" class="motive-picker-btn ${meta.needsMotivo ? 'missing' : ''}" data-action="open-motives" data-popover-trigger data-anchor-id="m-${anchor}" title="${esc(motiveLabel)}">
                <span class="motive-picker-label">${esc(motiveLabel)}</span>
                <span class="motive-picker-caret">${icon('chevron-down')}</span>
              </button>
            </td>
            <td class="edit obs-cell">
              <textarea class="cell-input" rows="1" data-field="Observação" placeholder="dd/mm: texto…" aria-label="Observação, linha ${row.rowIndex}">${esc(output['Observação'])}</textarea>
              <div class="obs-actions">
                <button type="button" class="btn btn-xs" data-action="open-frases" data-popover-trigger data-anchor-id="f-${anchor}" title="Inserir frase padrão">Frases ${icon('chevron-down')}</button>
                <button type="button" class="btn btn-xs btn-ghost" data-action="prefix-today" title="Colocar o prefixo de hoje (${todayShort}:) no início">${todayShort}:</button>
                <span data-obs-suggestion></span>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    this.tbodyEl.innerHTML = html;
    this.tbodyEl.querySelectorAll('textarea[data-field="Observação"]').forEach((ta) => this._autoGrow(ta));

    this.paginationEl.innerHTML =
      totalPages > 1
        ? `
      <div>Exibindo <strong>${start + 1}</strong>–<strong>${Math.min(start + pageRows.length, total)}</strong> de <strong>${total.toLocaleString('pt-BR')}</strong></div>
      <div class="pager">
        <button type="button" class="btn btn-xs" data-page="1" ${this.currentPage <= 1 ? 'disabled' : ''} title="Primeira página" aria-label="Primeira página">${icon('chevron-left')}${icon('chevron-left', 'icon-tight')}</button>
        <button type="button" class="btn btn-xs" data-page="${this.currentPage - 1}" ${this.currentPage <= 1 ? 'disabled' : ''}>${icon('chevron-left')} Anterior</button>
        <span>Página <strong>${this.currentPage}</strong> de ${totalPages}</span>
        <button type="button" class="btn btn-xs" data-page="${this.currentPage + 1}" ${this.currentPage >= totalPages ? 'disabled' : ''}>Próxima ${icon('chevron-right')}</button>
        <button type="button" class="btn btn-xs" data-page="${totalPages}" ${this.currentPage >= totalPages ? 'disabled' : ''} title="Última página" aria-label="Última página">${icon('chevron-right', 'icon-tight')}${icon('chevron-right')}</button>
      </div>`
        : `<div>${total.toLocaleString('pt-BR')} linha${total === 1 ? '' : 's'}</div>`;

    this.paginationEl.querySelectorAll('[data-page]').forEach((pBtn) => {
      pBtn.addEventListener('click', () => {
        this.render(filteredRows, Number(pBtn.dataset.page));
      });
    });

    if (this.scrollEl && prevPage !== this.currentPage) {
      this.scrollEl.scrollTop = 0;
    }
  }
}

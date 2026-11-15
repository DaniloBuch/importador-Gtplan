import { formatShortBRDate, todayUtc } from '../core/dates.js';
import { inferSlugFromObservationText } from '../core/motiveResolver.js';
import { stripDatePrefix } from '../core/ruleEngine.js';

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class TriageTableController {
  constructor({
    tbodyEl,
    paginationEl,
    getRows,
    getFrases,
    getMotiveResolver,
    onRowUpdated,
    onOpenDeParaModal
  }) {
    this.tbodyEl = tbodyEl;
    this.paginationEl = paginationEl;
    this.getRows = getRows;
    this.getFrases = getFrases;
    this.getMotiveResolver = getMotiveResolver;
    this.onRowUpdated = onRowUpdated;
    this.onOpenDeParaModal = onOpenDeParaModal;

    this.pageSize = 60;
    this.currentPage = 1;
    this.autoPrefixDate = true;
    this.activePopover = null;

    this._bindEvents();
  }

  _bindEvents() {
    document.addEventListener('click', (e) => {
      if (this.activePopover && !this.activePopover.contains(e.target) && !e.target.closest('[data-popover-trigger]')) {
        this.closePopover();
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
        this._refreshObsSuggestion(tr, row);
      }

      tr.classList.add('row-edited');
      this.onRowUpdated(row, { skipFullRender: true });
    });

    // Garante que qualquer observação editada manualmente mantenha o prefixo da data atual (dd/mm:)
    this.tbodyEl.addEventListener('change', (e) => {
      const target = e.target;
      if (target.dataset.field !== 'Observação') return;
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
      const tr = btn.closest('tr[data-row-index]');
      if (!tr) return;
      const rowIndex = Number(tr.dataset.rowIndex);
      const row = this._findRow(rowIndex);
      if (!row) return;

      const action = btn.dataset.action;
      if (action === 'open-frases') {
        this._openFrasesPopover(btn, tr, row);
      } else if (action === 'prefix-today') {
        this._applyTodayPrefix(tr, row);
      } else if (action === 'open-motives') {
        this._openMotivePopover(btn, tr, row);
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
        this.onOpenDeParaModal(row);
      }
    });
  }

  _findRow(rowIndex) {
    return this.getRows().find((r) => r.rowIndex === rowIndex) || null;
  }

  closePopover() {
    if (this.activePopover) {
      this.activePopover.remove();
      this.activePopover = null;
    }
  }

  _applyTodayPrefix(tr, row) {
    const todayShort = formatShortBRDate(todayUtc());
    const current = String(row.output['Observação'] ?? '').trim();
    const body = stripDatePrefix(current);
    const next = body ? `${todayShort}: ${body}` : `${todayShort}: `;
    row.output['Observação'] = next;
    row.meta.editedByUser = true;
    row.meta.unchanged = false;
    const input = tr.querySelector('input[data-field="Observação"]');
    if (input) {
      input.value = next;
      input.focus();
    }
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
      <span class="suggest-pill">
        Motivo sugerido (${esc(res.codigo)} - ${esc(res.desc.slice(0, 32))})
        <button type="button" class="btn btn-xs btn-primary"
          data-action="apply-suggested-motive"
          data-codigo="${esc(res.codigo)}"
          data-desc="${esc(res.desc)}">Aplicar</button>
      </span>
    `;
  }

  _openFrasesPopover(anchorBtn, tr, row) {
    this.closePopover();
    const pop = document.createElement('div');
    pop.className = 'floating-popover';
    const frases = this.getFrases();

    pop.innerHTML = `
      <div class="floating-popover-head">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>Inserir Frase Padrão</strong>
          <span class="chip chip-info">Prefixo hoje: ${formatShortBRDate(todayUtc())}:</span>
        </div>
        <input type="text" class="cell-input" placeholder="Buscar frase padrão..." data-pop-search />
      </div>
      <div class="floating-popover-list" data-pop-list></div>
    `;

    document.body.appendChild(pop);
    this._positionPopover(pop, anchorBtn);
    this.activePopover = pop;

    const searchInput = pop.querySelector('[data-pop-search]');
    const listEl = pop.querySelector('[data-pop-list]');

    const renderList = (query = '') => {
      const q = query.trim().toLowerCase();
      const filtered = frases.filter((f) => !q || f.frase.toLowerCase().includes(q) || (f.slug || '').includes(q));
      if (filtered.length === 0) {
        listEl.innerHTML = '<div style="padding:12px;color:#64748b;">Nenhuma frase encontrada. Digite livremente no campo Observação.</div>';
        return;
      }
      listEl.innerHTML = filtered
        .map(
          (f, idx) => `
          <button type="button" class="popover-item" data-frase-idx="${idx}">
            <span>${esc(f.frase)}</span>
            ${f.slug ? `<span class="popover-item-sub">Intenção sugerida: ${esc(f.slug)}</span>` : ''}
          </button>`
        )
        .join('');

      listEl.querySelectorAll('[data-frase-idx]').forEach((itemBtn) => {
        itemBtn.addEventListener('click', () => {
          const picked = filtered[Number(itemBtn.dataset.fraseIdx)];
          const todayShort = formatShortBRDate(todayUtc());
          const body = stripDatePrefix(picked.frase);
          const nextObs = `${todayShort}: ${body}`;

          row.output['Observação'] = nextObs;
          row.meta.editedByUser = true;
          row.meta.unchanged = false;
          if (picked.slug) {
            row.meta.slug = picked.slug;
          }

          const obsInput = tr.querySelector('input[data-field="Observação"]');
          if (obsInput) {
            obsInput.value = nextObs;
          }

          // Sugestão não-rígida: se existir motivo mapeado e o campo atual estiver vazio ou sugestivo, oferece/aplica só se usuário clicar ou se estava vazio
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
          tr.classList.add('row-edited');
          this.closePopover();
          this.onRowUpdated(row, { skipFullRender: true });
        });
      });
    };

    searchInput.addEventListener('input', () => renderList(searchInput.value));
    renderList();
    searchInput.focus();
  }

  _openMotivePopover(anchorBtn, tr, row) {
    this.closePopover();
    const resolver = this.getMotiveResolver();
    const clientMotives = resolver.getClientMotives(row.meta.codCliente);

    const pop = document.createElement('div');
    pop.className = 'floating-popover';
    pop.innerHTML = `
      <div class="floating-popover-head">
        <strong>Motivos do Cliente ${esc(row.meta.codCliente)} (${clientMotives.length})</strong>
        <input type="text" class="cell-input" placeholder="Buscar código ou descrição..." data-pop-search />
        <div class="combo-row">
          <input type="text" class="cell-input" placeholder="Ou código/motivo manual..." value="${esc(row.output['Motivo'])}" data-pop-manual />
          <button type="button" class="btn btn-xs btn-primary" data-pop-apply-manual>Usar</button>
        </div>
      </div>
      <div class="floating-popover-list" data-pop-list></div>
    `;

    document.body.appendChild(pop);
    this._positionPopover(pop, anchorBtn);
    this.activePopover = pop;

    const searchInput = pop.querySelector('[data-pop-search]');
    const manualInput = pop.querySelector('[data-pop-manual]');
    const manualBtn = pop.querySelector('[data-pop-apply-manual]');
    const listEl = pop.querySelector('[data-pop-list]');

    manualBtn.addEventListener('click', () => {
      const val = manualInput.value.trim();
      row.output['Motivo'] = val;
      const found = resolver.findByCodeOrDesc(row.meta.codCliente, val);
      row.meta.resolvedMotiveDesc = found ? found.desc : '';
      row.meta.motiveConfidence = found ? 'confirmed' : val ? 'manual' : 'missing';
      row.meta.needsMotivo = !val;
      row.meta.editedByUser = true;
      row.meta.unchanged = false;
      this.closePopover();
      this.onRowUpdated(row, { skipFullRender: false });
    });

    const renderList = (query = '') => {
      const q = query.trim().toLowerCase();
      const filtered = clientMotives.filter(
        (m) => !q || m.codigo.toLowerCase().includes(q) || m.desc.toLowerCase().includes(q)
      );
      if (filtered.length === 0) {
        listEl.innerHTML = `<div style="padding:12px;color:#64748b;">Nenhum motivo encontrado no dicionário para o cliente ${esc(row.meta.codCliente)}. Use o campo manual acima ou importe motivos atualizados.</div>`;
        return;
      }
      listEl.innerHTML = filtered
        .map(
          (m) => `
          <button type="button" class="popover-item" data-code="${esc(m.codigo)}" data-desc="${esc(m.desc)}">
            <span><strong>${esc(m.codigo)}</strong> — ${esc(m.desc)}</span>
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
    renderList();
    searchInput.focus();
  }

  _positionPopover(pop, anchor) {
    const rect = anchor.getBoundingClientRect();
    const top = Math.min(window.innerHeight - 360, rect.bottom + 4);
    const left = Math.min(window.innerWidth - 380, Math.max(10, rect.left));
    pop.style.top = `${Math.max(10, top)}px`;
    pop.style.left = `${left}px`;
  }

  render(filteredRows, page = 1) {
    const total = filteredRows.length;
    const totalPages = Math.max(1, Math.ceil(total / this.pageSize));
    this.currentPage = Math.max(1, Math.min(page, totalPages));

    if (total === 0) {
      this.tbodyEl.innerHTML = `
        <tr>
          <td colspan="8" class="empty-state">
            Nenhuma linha corresponde ao filtro atual. Arraste seu CSV do GTplan (24 colunas) e o Excel do TOTVS acima para começar.
          </td>
        </tr>`;
      this.paginationEl.innerHTML = '';
      return;
    }

    const start = (this.currentPage - 1) * this.pageSize;
    const pageRows = filteredRows.slice(start, start + this.pageSize);
    const resolver = this.getMotiveResolver();

    const html = pageRows
      .map((row) => {
        const { raw, output, meta } = row;
        const motiveCode = output['Motivo'] || '';
        const matchedMotive = motiveCode ? resolver.findByCodeOrDesc(meta.codCliente, motiveCode) : null;
        const motiveLabel = matchedMotive
          ? `${matchedMotive.codigo} — ${matchedMotive.desc}`
          : meta.resolvedMotiveDesc && motiveCode
            ? `${motiveCode} — ${meta.resolvedMotiveDesc}`
            : motiveCode || 'Selecionar motivo...';

        const chips = [];
        if (!meta.hasDePara) {
          chips.push(`<span class="chip chip-danger">Sem De-Para</span>`);
        }
        if (meta.needsMotivo) {
          chips.push(`<span class="chip chip-warn">Sem Motivo</span>`);
        }
        if (meta.motiveConfidence === 'review' || meta.motiveConfidence === 'suggested') {
          chips.push(`<span class="chip chip-info">${meta.motiveConfidence === 'review' ? 'Revisar Motivo' : 'Sugestão'}</span>`);
        }
        if (meta.hasCaixaria) chips.push(`<span class="chip chip-warn">Caixaria ×${meta.multiplicador}</span>`);
        if (meta.hasValor) chips.push(`<span class="chip chip-warn">Valor >3%</span>`);
        if (meta.hasSpot) chips.push(`<span class="chip chip-info">Spot</span>`);
        if (meta.unchanged) chips.push(`<span class="chip chip-neutral">Sem Alt.</span>`);
        if (!meta.unchanged && !meta.needsMotivo && meta.hasDePara) {
          chips.push(`<span class="chip chip-success">Pronta</span>`);
        }

        const ocExterno = raw['Cód. OC Externo'] && raw['Cód. OC Externo'] !== '0'
          ? `<div class="sub-line mono">Ext: ${esc(raw['Cód. OC Externo'])}</div>`
          : '';

        const trClasses = [
          meta.needsMotivo || !meta.hasDePara ? 'row-needs-action' : '',
          meta.editedByUser ? 'row-edited' : ''
        ]
          .filter(Boolean)
          .join(' ');

        return `
          <tr data-row-index="${row.rowIndex}" class="${trClasses}">
            <td>
              <div class="mono">#${row.rowIndex}</div>
              <div class="chip-stack" style="margin-top:4px;">${chips.join('')}</div>
            </td>
            <td>
              <div><span class="chip chip-neutral mono">${esc(meta.codCliente)}</span> <strong>${esc(meta.cliente)}</strong></div>
              <div class="sub-line">${esc(meta.estab)}</div>
            </td>
            <td>
              <div class="mono"><strong>${esc(raw['Núm. OC'])}</strong></div>
              ${ocExterno}
              <div class="sub-line">${meta.hasTotvs ? `TOTVS: <span class="mono">${esc(meta.totvsPedido)}</span>` : '<span style="color:#94a3b8;">Sem pedido TOTVS</span>'}</div>
              <div class="sub-line">Prev. Atual: <span class="mono">${esc(raw['Prev. Entrega Atual'] || '-')}</span></div>
            </td>
            <td style="max-width:250px;">
              <div class="mono">${esc(raw['Cód. Item'])} ${meta.codCBS ? `<span class="chip chip-success">CBS ${esc(meta.codCBS)}</span>` : `<button type="button" class="btn btn-xs" data-action="link-depara">+ Vincular CBS</button>`}</div>
              <div class="sub-line" title="${esc(raw['Desc. Item'])}">${esc(raw['Desc. Item'])}</div>
              <div class="sub-line mono">Qtd: ${esc(raw['Qtd. Pendente'])} | R$ ${esc(raw['Val. Unit.'])}</div>
            </td>
            <td>
              <input type="text" class="cell-input cell-input-sm mono" data-field="Nova Prev. Entrega" value="${esc(output['Nova Prev. Entrega'])}" placeholder="DD/MM/AAAA" />
            </td>
            <td>
              <input type="text" class="cell-input cell-input-sm mono" data-field="Núm. NF" value="${esc(output['Núm. NF'])}" placeholder="NF" />
              <input type="text" class="cell-input cell-input-sm mono" style="margin-top:4px;" data-field="Dt. NF" value="${esc(output['Dt. NF'])}" placeholder="DD/MM/AAAA" />
            </td>
            <td>
              <button type="button" class="motive-picker-btn ${meta.needsMotivo ? 'missing' : ''}" data-action="open-motives" data-popover-trigger title="${esc(motiveLabel)}">
                <span class="motive-picker-label">${esc(motiveLabel)}</span>
                <span>▾</span>
              </button>
              <div class="sub-line">Cliente ${esc(meta.codCliente)}</div>
            </td>
            <td>
              <div class="combo-wrap">
                <div class="combo-row">
                  <input type="text" class="cell-input" data-field="Observação" value="${esc(output['Observação'])}" placeholder="Digite livremente ou escolha uma frase..." />
                  <button type="button" class="btn btn-xs" data-action="prefix-today" title="Inserir prefixo dd/mm:">${formatShortBRDate(todayUtc())}:</button>
                  <button type="button" class="btn btn-xs" data-action="open-frases" data-popover-trigger>Frases ▾</button>
                </div>
                <div data-obs-suggestion></div>
              </div>
            </td>
          </tr>
        `;
      })
      .join('');

    this.tbodyEl.innerHTML = html;

    this.paginationEl.innerHTML = `
      <div>Exibindo <strong>${start + 1}</strong>–<strong>${Math.min(start + pageRows.length, total)}</strong> de <strong>${total}</strong> linhas</div>
      <div style="display:flex;align-items:center;gap:6px;">
        <button type="button" class="btn btn-xs" data-page="${this.currentPage - 1}" ${this.currentPage <= 1 ? 'disabled' : ''}>← Anterior</button>
        <span>Página ${this.currentPage} de ${totalPages}</span>
        <button type="button" class="btn btn-xs" data-page="${this.currentPage + 1}" ${this.currentPage >= totalPages ? 'disabled' : ''}>Próxima →</button>
      </div>
    `;

    this.paginationEl.querySelectorAll('[data-page]').forEach((pBtn) => {
      pBtn.addEventListener('click', () => {
        this.render(filteredRows, Number(pBtn.dataset.page));
      });
    });
  }
}

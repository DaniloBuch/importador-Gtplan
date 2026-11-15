import { INTENT_SLUGS, normalizeText } from '../core/motiveResolver.js';
import { formatShortBRDate, todayUtc } from '../core/dates.js';
import { parseCsvLine } from '../core/csv.js';
import { readWorkbookSheets, rowsToObjects } from '../core/xlsxReader.js';

function esc(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class AdminModalController {
  constructor({
    backdropEl,
    titleEl,
    tabsEl,
    bodyEl,
    closeBtn,
    getConfig,
    getMotiveResolver,
    getLoadedClients,
    onConfigChanged,
    onResetConfig,
    showToast
  }) {
    this.backdropEl = backdropEl;
    this.titleEl = titleEl;
    this.tabsEl = tabsEl;
    this.bodyEl = bodyEl;
    this.closeBtn = closeBtn;
    this.getConfig = getConfig;
    this.getMotiveResolver = getMotiveResolver;
    this.getLoadedClients = getLoadedClients;
    this.onConfigChanged = onConfigChanged;
    this.onResetConfig = onResetConfig;
    this.showToast = showToast;

    this.activeTab = 'motives';
    this.prefillDePara = null;
    this.onlyReviewFilter = false;
    this.motiveClientFilter = '';
    this.motiveSearchQuery = '';
    this.explorerSubTab = 'itens';
    this.explorerSearch = '';
    this.explorerClientFilter = '';
    this.explorerPage = 1;

    this._bindEvents();
  }

  _bindEvents() {
    this.closeBtn.addEventListener('click', () => this.close());
    this.backdropEl.addEventListener('click', (e) => {
      if (e.target === this.backdropEl) this.close();
    });
    this.tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      this.activeTab = btn.dataset.tab;
      this.render();
    });
  }

  open(tab = 'motives', prefillDePara = null) {
    this.activeTab = tab;
    this.prefillDePara = prefillDePara;
    this.backdropEl.classList.remove('hidden');
    this.render();
  }

  close() {
    this.backdropEl.classList.add('hidden');
    this.prefillDePara = null;
  }

  render() {
    this.tabsEl.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === this.activeTab);
    });

    if (this.activeTab === 'motives') this._renderMotivesTab();
    else if (this.activeTab === 'rules') this._renderRulesTab();
    else if (this.activeTab === 'depara') this._renderDeParaFrasesTab();
    else if (this.activeTab === 'bases') this._renderBasesBackupTab();
    else if (this.activeTab === 'explorer') this._renderExplorerTab();
  }

  _renderMotivesTab() {
    const config = this.getConfig();
    const resolver = this.getMotiveResolver();
    const loadedClients = this.getLoadedClients();
    const allDictClients = Array.from(resolver.byClient.keys()).sort((a, b) => Number(a) - Number(b));
    const targetClients = loadedClients.length > 0 ? loadedClients : allDictClients.slice(0, 12);

    const flatRows = resolver.buildFlatReviewRows(targetClients);
    const frasesBySlug = new Map();
    for (const f of config.frases || []) {
      if (!f.slug) continue;
      if (!frasesBySlug.has(f.slug)) frasesBySlug.set(f.slug, []);
      frasesBySlug.get(f.slug).push(f.frase);
    }

    const q = this.motiveSearchQuery.trim().toLowerCase();
    const filtered = flatRows.filter((m) => {
      if (this.motiveClientFilter && m.codCliente !== this.motiveClientFilter) return false;
      if (this.onlyReviewFilter && !['review', 'suggested', 'missing'].includes(m.confidence)) return false;
      if (q) {
        const hay = `${m.codCliente} ${m.cliente} ${m.label} ${m.slug} ${m.trigger} ${m.obsExample} ${m.codigo} ${m.desc}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const todayShort = formatShortBRDate(todayUtc());
    const statusBadge = {
      confirmed: '<span class="chip chip-success">Confirmado</span>',
      exact: '<span class="chip chip-success">Exato</span>',
      review: '<span class="chip chip-warn">Revisar (Duplicado)</span>',
      suggested: '<span class="chip chip-info">Sugerido (Revisar)</span>',
      missing: '<span class="chip chip-danger">Ausente</span>'
    };

    const clientOptions = [
      `<option value="">Todos (${targetClients.length} clientes)</option>`,
      ...targetClients.map((c) => {
        const name = resolver.getClientName(c);
        return `<option value="${esc(c)}" ${c === this.motiveClientFilter ? 'selected' : ''}>${esc(c)} — ${esc(name || 'Cliente')}</option>`;
      })
    ].join('');

    this.bodyEl.innerHTML = `
      <div style="border:1px solid #bae6fd;background:#f0f9ff;padding:10px 12px;border-radius:8px;font-size:12px;">
        <strong>Como funciona a Revisão de Motivos:</strong> Para cada <strong>Situação</strong> abaixo, o motor verifica o pedido no TOTVS/CSV, gera a <strong>Observação</strong> padrão (sempre com o prefixo da data atual <span class="mono">${todayShort}:</span>) e aplica o código de <strong>Motivo</strong> do respectivo cliente. Alterações feitas aqui são salvas no IndexedDB local para os próximos envios.
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
          <select id="sel-motive-client" class="cell-input" style="width:230px;">${clientOptions}</select>
          <input type="text" id="inp-motive-search" class="cell-input" style="width:240px;" value="${esc(this.motiveSearchQuery)}" placeholder="Filtrar situação, observação ou motivo..." />
        </div>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="chk-only-review" ${this.onlyReviewFilter ? 'checked' : ''} />
          Mostrar apenas Revisão / Sugeridos / Ausentes
        </label>
      </div>

      <div style="max-height:430px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
        <table class="triage-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Situação / Regra</th>
              <th>Quando Aplica &amp; Observação Gerada</th>
              <th>Status</th>
              <th>Motivo Selecionado no Portal</th>
            </tr>
          </thead>
          <tbody>
            ${
              filtered.length === 0
                ? '<tr><td colspan="5" style="text-align:center;color:#64748b;padding:24px;">Nenhuma regra corresponde ao filtro atual.</td></tr>'
                : filtered
                    .map((item) => {
                      const clientMotives = resolver.getClientMotives(item.codCliente);
                      const frasesSlug = frasesBySlug.get(item.slug) || [];
                      const obsFormatted = item.obsExample.replace(/^dd\/mm:/, `${todayShort}:`);
                      const opts = [
                        '<option value="">-- Nenhum / Manual --</option>',
                        ...clientMotives.map(
                          (cm) =>
                            `<option value="${esc(cm.codigo)}" ${cm.codigo === item.codigo ? 'selected' : ''}>${esc(cm.codigo)} — ${esc(cm.desc)}</option>`
                        )
                      ].join('');
                      return `
                        <tr>
                          <td style="min-width:130px;">
                            <span class="chip chip-neutral mono">${esc(item.codCliente)}</span>
                            <div class="sub-line">${esc(item.cliente)}</div>
                          </td>
                          <td style="min-width:160px;">
                            <strong>${esc(item.label)}</strong>
                            <div class="sub-line mono">${esc(item.slug)}</div>
                          </td>
                          <td style="min-width:270px;max-width:340px;">
                            <div><strong>Quando:</strong> ${esc(item.trigger)}</div>
                            <div class="sub-line"><strong>Obs:</strong> <span class="mono">${esc(obsFormatted)}</span></div>
                            ${
                              frasesSlug.length > 0
                                ? `<div class="sub-line" title="${esc(frasesSlug.join(' | '))}"><strong>Frases vinculadas:</strong> ${esc(frasesSlug.slice(0, 2).join(' • '))}${frasesSlug.length > 2 ? ` (+${frasesSlug.length - 2})` : ''}</div>`
                                : ''
                            }
                          </td>
                          <td>${statusBadge[item.confidence] || ''}</td>
                          <td style="min-width:230px;">
                            <select class="cell-input" data-motive-override data-cli="${esc(item.codCliente)}" data-slug="${esc(item.slug)}">
                              ${opts}
                            </select>
                          </td>
                        </tr>`;
                    })
                    .join('')
            }
          </tbody>
        </table>
      </div>
    `;

    this.bodyEl.querySelector('#sel-motive-client').addEventListener('change', (e) => {
      this.motiveClientFilter = e.target.value;
      this.render();
    });

    this.bodyEl.querySelector('#inp-motive-search').addEventListener('input', (e) => {
      this.motiveSearchQuery = e.target.value;
      const caret = e.target.selectionStart;
      this.render();
      const el = this.bodyEl.querySelector('#inp-motive-search');
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });

    this.bodyEl.querySelector('#chk-only-review').addEventListener('change', (e) => {
      this.onlyReviewFilter = e.target.checked;
      this.render();
    });

    this.bodyEl.querySelectorAll('[data-motive-override]').forEach((sel) => {
      sel.addEventListener('change', async () => {
        const cli = sel.dataset.cli;
        const slug = sel.dataset.slug;
        const val = sel.value;
        if (!config.motiveOverrides[cli]) config.motiveOverrides[cli] = {};
        if (val) config.motiveOverrides[cli][slug] = val;
        else delete config.motiveOverrides[cli][slug];
        await this.onConfigChanged(config, true);
        this.showToast(`Motivo salvo para cliente ${cli} (${slug}).`);
        this.render();
      });
    });
  }

  _renderRulesTab() {
    const config = this.getConfig();
    const rules = config.clientRules || { enableLegacyExceptions: true, byClient: {}, byEstab: {} };
    const holidays = config.holidays || [];

    const clientEntries = Object.entries(rules.byClient || {});
    const estabEntries = Object.entries(rules.byEstab || {});

    this.bodyEl.innerHTML = `
      <div style="border:1px solid var(--border-soft);padding:12px;border-radius:8px;background:var(--surface-alt);">
        <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
          <input type="checkbox" id="chk-legacy-exc" ${rules.enableLegacyExceptions !== false ? 'checked' : ''} />
          Manter exceções legadas padrão (Santa Helena: +2 dias úteis no SLA; Santa Joana: texto curto em OC fora do leadtime)
        </label>
      </div>

      <div>
        <strong>Tempo de entrega e/ou agendamento por Cliente ou Estabelecimento</strong>
        <form id="form-add-rule" class="form-grid" style="margin-top:8px;">
          <div class="form-field">
            <label>Escopo</label>
            <select name="scope">
              <option value="estab">Estabelecimento (Estab.)</option>
              <option value="client">Cód. Cliente</option>
            </select>
          </div>
          <div class="form-field">
            <label>Chave (Ex: H PRO CARDIACO ou 33)</label>
            <input name="key" required placeholder="Nome do estab. ou código" />
          </div>
          <div class="form-field">
            <label>SLA Fixo (opcional)</label>
            <input name="slaOverride" type="number" min="1" placeholder="Ex: 3" />
          </div>
          <div class="form-field">
            <label>SLA Extra (+/- dias)</label>
            <input name="extraSla" type="number" placeholder="Ex: 2" />
          </div>
          <div class="form-field">
            <label>Obs curta fora LT?</label>
            <select name="shortForaLtObs">
              <option value="">Padrão</option>
              <option value="true">Sim (texto curto)</option>
              <option value="false">Não (texto completo)</option>
            </select>
          </div>
          <button type="submit" class="btn btn-primary">+ Adicionar Regra</button>
        </form>

        <div style="margin-top:10px;max-height:170px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
          <table class="triage-table">
            <thead>
              <tr><th>Tipo</th><th>Chave</th><th>SLA Fixo</th><th>Extra Dias</th><th>Obs Curta</th><th></th></tr>
            </thead>
            <tbody>
              ${
                clientEntries.length + estabEntries.length === 0
                  ? '<tr><td colspan="6" style="text-align:center;color:#64748b;">Nenhuma regra customizada além das legadas.</td></tr>'
                  : [
                      ...clientEntries.map(([k, v]) => `<tr><td>Cód. Cliente</td><td class="mono">${esc(k)}</td><td>${v.slaOverride ?? '-'}</td><td>${v.extraSla ?? 0}</td><td>${v.shortForaLtObs === true ? 'Sim' : v.shortForaLtObs === false ? 'Não' : 'Padrão'}</td><td><button type="button" class="btn btn-xs" data-del-rule="client:${esc(k)}">Remover</button></td></tr>`),
                      ...estabEntries.map(([k, v]) => `<tr><td>Estab.</td><td>${esc(k)}</td><td>${v.slaOverride ?? '-'}</td><td>${v.extraSla ?? 0}</td><td>${v.shortForaLtObs === true ? 'Sim' : v.shortForaLtObs === false ? 'Não' : 'Padrão'}</td><td><button type="button" class="btn btn-xs" data-del-rule="estab:${esc(k)}">Remover</button></td></tr>`)
                    ].join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <strong>Calendário de Feriados (ignorados no cálculo de dias úteis WORKDAY)</strong>
        <form id="form-add-holiday" class="combo-row" style="margin-top:8px;max-width:340px;">
          <input type="date" name="date" class="cell-input" required />
          <button type="submit" class="btn btn-primary">+ Feriado</button>
        </form>
        <div class="chip-stack" style="margin-top:8px;">
          ${holidays.length === 0 ? '<span class="sub-line">Nenhum feriado cadastrado.</span>' : holidays.map((h) => `<span class="chip chip-neutral mono">${esc(h)} <button type="button" style="border:none;background:none;cursor:pointer;font-weight:bold;" data-del-holiday="${esc(h)}">×</button></span>`).join('')}
        </div>
      </div>
    `;

    this.bodyEl.querySelector('#chk-legacy-exc').addEventListener('change', async (e) => {
      config.clientRules = config.clientRules || { enableLegacyExceptions: true, byClient: {}, byEstab: {} };
      config.clientRules.enableLegacyExceptions = e.target.checked;
      await this.onConfigChanged(config, true);
      this.showToast('Configuração de exceções legadas atualizada.');
    });

    this.bodyEl.querySelector('#form-add-rule').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const scope = fd.get('scope');
      const rawKey = String(fd.get('key') || '').trim();
      if (!rawKey) return;
      const ruleObj = {};
      if (fd.get('slaOverride')) ruleObj.slaOverride = Number(fd.get('slaOverride'));
      if (fd.get('extraSla')) ruleObj.extraSla = Number(fd.get('extraSla'));
      if (fd.get('shortForaLtObs') === 'true') ruleObj.shortForaLtObs = true;
      if (fd.get('shortForaLtObs') === 'false') ruleObj.shortForaLtObs = false;

      config.clientRules = config.clientRules || { enableLegacyExceptions: true, byClient: {}, byEstab: {} };
      if (scope === 'client') {
        config.clientRules.byClient[rawKey] = ruleObj;
      } else {
        config.clientRules.byEstab[normalizeText(rawKey)] = ruleObj;
      }
      await this.onConfigChanged(config, true);
      this.showToast('Regra salva e lote reprocessado.');
      this.render();
    });

    this.bodyEl.querySelectorAll('[data-del-rule]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const [scope, key] = btn.dataset.delRule.split(':');
        if (scope === 'client') delete config.clientRules.byClient[key];
        else delete config.clientRules.byEstab[key];
        await this.onConfigChanged(config, true);
        this.render();
      });
    });

    this.bodyEl.querySelector('#form-add-holiday').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dt = new FormData(e.target).get('date');
      if (!dt) return;
      if (!config.holidays.includes(dt)) {
        config.holidays.push(dt);
        config.holidays.sort();
        await this.onConfigChanged(config, true);
        this.render();
      }
    });

    this.bodyEl.querySelectorAll('[data-del-holiday]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        config.holidays = config.holidays.filter((h) => h !== btn.dataset.delHoliday);
        await this.onConfigChanged(config, true);
        this.render();
      });
    });
  }

  _renderDeParaFrasesTab() {
    const config = this.getConfig();
    const customDePara = config.customDePara || [];
    const frases = config.frases || [];
    const pre = this.prefillDePara || {};

    this.bodyEl.innerHTML = `
      <div style="border:1px solid #bae6fd;background:#f0f9ff;padding:10px 12px;border-radius:8px;font-size:12px;">
        <strong>Onde estes dados ficam salvos?</strong> Todos os vínculos de <strong>De-Para Customizado</strong>, <strong>Frases Padrão</strong>, <strong>Revisões de Motivos</strong> e <strong>Tempo de entrega/agendamento</strong> são gravados automaticamente no banco local do seu navegador (<strong>IndexedDB</strong> → banco <span class="mono">gtplan_followup_db</span>, store <span class="mono">kv_store</span>, chave <span class="mono">app_config_v1</span>) e já ficam prontos para migração futura para banco de dados via <span class="mono">repository.js</span>. Para copiar para outro PC, use <strong>Exportar Backup JSON</strong> na aba <em>Importar Bases &amp; Backup</em>.
      </div>

      <div>
        <strong>De-Para Customizado (Vínculo Rápido de Itens fora da planilha todasBases)</strong>
        <form id="form-add-depara" class="form-grid" style="margin-top:8px;">
          <div class="form-field">
            <label>Cód. Cliente (opcional)</label>
            <input name="codCliente" value="${esc(pre.codCliente || '')}" placeholder="Ex: 33 (ou vazio=todos)" />
          </div>
          <div class="form-field">
            <label>Cód. Item GTplan *</label>
            <input name="codItem" required value="${esc(pre.codItem || '')}" placeholder="Ex: 109596" />
          </div>
          <div class="form-field">
            <label>Desc. Item GTplan</label>
            <input name="descItem" value="${esc(pre.descItem || '')}" placeholder="Descrição no portal" />
          </div>
          <div class="form-field">
            <label>Cód. CBS (TOTVS) *</label>
            <input name="codCBS" required placeholder="Ex: 001369" />
          </div>
          <div class="form-field">
            <label>Multiplicador (Caixa)</label>
            <input name="mult" type="number" min="1" value="1" />
          </div>
          <button type="submit" class="btn btn-primary">+ Salvar Vínculo</button>
        </form>

        <div style="margin-top:8px;max-height:180px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
          <table class="triage-table">
            <thead><tr><th>Cliente</th><th>Cód. Item</th><th>Desc. Item</th><th>CBS</th><th>Mult.</th><th></th></tr></thead>
            <tbody>
              ${
                customDePara.length === 0
                  ? '<tr><td colspan="6" style="text-align:center;color:#64748b;">Nenhum De-Para customizado cadastrado.</td></tr>'
                  : customDePara
                      .map(
                        (d, idx) => `<tr><td class="mono">${esc(d.codCliente || 'Todos')}</td><td class="mono">${esc(d.codItem)}</td><td>${esc(d.descItem)}</td><td class="mono"><strong>${esc(d.codCBS)}</strong></td><td class="mono">${d.mult}</td><td><button type="button" class="btn btn-xs" data-del-depara="${idx}">Remover</button></td></tr>`
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <strong>Frases Padrão de Observação</strong>
        <form id="form-add-frase" class="form-grid" style="margin-top:8px;">
          <div class="form-field" style="grid-column:span 2;">
            <label>Texto da Frase *</label>
            <input name="frase" required placeholder="Ex: Pedido aguardando liberação comercial" />
          </div>
          <div class="form-field">
            <label>Intenção Sugerida (Opcional)</label>
            <select name="slug">
              <option value="">Sem vínculo automático (livre)</option>
              ${INTENT_SLUGS.map((s) => `<option value="${s.slug}">${s.label} (${s.slug})</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn btn-primary">+ Adicionar Frase</button>
        </form>

        <div style="margin-top:8px;max-height:170px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
          <table class="triage-table">
            <thead><tr><th>Frase</th><th>Intenção Sugerida</th><th></th></tr></thead>
            <tbody>
              ${frases
                .map(
                  (f, idx) => `<tr><td>${esc(f.frase)}</td><td class="mono">${esc(f.slug || '-')}</td><td><button type="button" class="btn btn-xs" data-del-frase="${idx}">Remover</button></td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;

    this.bodyEl.querySelector('#form-add-depara').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      config.customDePara.push({
        codCliente: String(fd.get('codCliente') || '').trim(),
        codItem: String(fd.get('codItem') || '').trim(),
        descItem: String(fd.get('descItem') || '').trim(),
        codCBS: String(fd.get('codCBS') || '').trim().padStart(6, '0'),
        mult: Math.max(1, Number(fd.get('mult')) || 1)
      });
      this.prefillDePara = null;
      await this.onConfigChanged(config, true);
      this.showToast('De-Para salvo e lote reprocessado.');
      this.render();
    });

    this.bodyEl.querySelectorAll('[data-del-depara]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        config.customDePara.splice(Number(btn.dataset.delDepara), 1);
        await this.onConfigChanged(config, true);
        this.render();
      });
    });

    this.bodyEl.querySelector('#form-add-frase').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const frase = String(fd.get('frase') || '').trim();
      const slug = String(fd.get('slug') || '').trim();
      if (!frase) return;
      config.frases.push({ frase, descSimples: frase, slug });
      await this.onConfigChanged(config, false);
      this.showToast('Frase padrão adicionada.');
      this.render();
    });

    this.bodyEl.querySelectorAll('[data-del-frase]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        config.frases.splice(Number(btn.dataset.delFrase), 1);
        await this.onConfigChanged(config, false);
        this.render();
      });
    });
  }

  _renderBasesBackupTab() {
    const config = this.getConfig();
    this.bodyEl.innerHTML = `
      <div class="sub-line">
        Estatísticas carregadas na memória/IndexedDB:
        <strong>${config.todasBases.length}</strong> itens em todasBases,
        <strong>${config.motivos.length}</strong> motivos multi-cliente,
        <strong>${config.hospitais.length}</strong> hospitais,
        <strong>${config.customDePara.length}</strong> De-Paras customizados.
      </div>

      <div class="ingest-grid">
        <div class="dropzone" style="cursor:default;flex-direction:column;align-items:flex-start;">
          <div class="dropzone-title">Atualizar Dicionário de Motivos (CSV)</div>
          <div class="dropzone-meta">Selecione motivos_follow_up_todos_os_clientes.csv atualizado</div>
          <input type="file" id="inp-import-motivos" accept=".csv" style="display:block;margin-top:6px;" />
        </div>
        <div class="dropzone" style="cursor:default;flex-direction:column;align-items:flex-start;">
          <div class="dropzone-title">Atualizar Bases do importador_gtplan.xlsm</div>
          <div class="dropzone-meta">Lê todasBases, Hospitais e leadtime diretamente no navegador</div>
          <input type="file" id="inp-import-xlsm" accept=".xlsm,.xlsx" style="display:block;margin-top:6px;" />
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;padding-top:8px;border-top:1px solid var(--border-soft);">
        <button type="button" class="btn btn-primary" id="btn-export-backup">Exportar Backup JSON</button>
        <label class="btn" style="cursor:pointer;">
          Restaurar Backup JSON
          <input type="file" id="inp-import-backup" accept=".json" style="display:none;" />
        </label>
        <button type="button" class="btn" id="btn-reset-seed" style="margin-left:auto;color:var(--danger);">Restaurar Dados de Fábrica</button>
      </div>
    `;

    this.bodyEl.querySelector('#inp-import-motivos').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((l) => l.trim());
      const nextMotivos = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i], ';');
        if (cols.length >= 4 && cols[0] && cols[2]) {
          nextMotivos.push({
            codCliente: cols[0].trim(),
            cliente: cols[1].trim(),
            codigo: cols[2].trim(),
            desc: cols[3].trim()
          });
        }
      }
      if (nextMotivos.length === 0) {
        this.showToast('Nenhum motivo válido encontrado no CSV.');
        return;
      }
      config.motivos = nextMotivos;
      await this.onConfigChanged(config, true);
      this.showToast(`${nextMotivos.length} motivos importados e salvos!`);
      this.render();
    });

    this.bodyEl.querySelector('#inp-import-xlsm').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const buf = new Uint8Array(await file.arrayBuffer());
      const sheetsRaw = await readWorkbookSheets(buf, ['todasBases', 'Hospitais']);
      if (sheetsRaw.todasBases?.length) {
        const objs = rowsToObjects(sheetsRaw.todasBases, 1);
        const mapped = objs
          .filter((r) => r['Cod CBS'])
          .map((r) => ({
            codSap: r['Cod Item C SAP'] || '',
            codItem: r['Cod Item C Gtplan'] || '',
            descItem: r['Desc Item C'] || '',
            codCBS: String(r['Cod CBS']).trim().padStart(6, '0'),
            descCBS: r['Desc CBS'] || '',
            mult: Math.max(1, Number(r['Multiplicador']) || 1)
          }));
        if (mapped.length) config.todasBases = mapped;
      }
      if (sheetsRaw.Hospitais?.length) {
        const hospObjs = rowsToObjects(sheetsRaw.Hospitais, 1);
        const mappedH = hospObjs
          .filter((r) => r['ESTAB'] || r['NOME'])
          .map((r) => ({
            estab: r['ESTAB'] || '',
            codCliente: r['CLIENTE'] || '',
            loja: r['LOJA'] || '',
            concat2: r['Concat2'] || '',
            nome: r['NOME'] || '',
            uf: r['UF'] || '',
            sla: Math.max(1, Number(r['SLA']) || 1)
          }));
        if (mappedH.length) config.hospitais = mappedH;
      }
      await this.onConfigChanged(config, true);
      this.showToast('Bases do XLSM atualizadas com sucesso!');
      this.render();
    });

    this.bodyEl.querySelector('#btn-export-backup').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gtplan_backup_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    this.bodyEl.querySelector('#inp-import-backup').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        await this.onConfigChanged(parsed, true);
        this.showToast('Backup JSON restaurado com sucesso!');
        this.render();
      } catch (err) {
        this.showToast(`Erro no backup: ${err.message}`);
      }
    });

    this.bodyEl.querySelector('#btn-reset-seed').addEventListener('click', async () => {
      await this.onResetConfig();
      this.showToast('Configurações restauradas ao padrão inicial.');
      this.render();
    });
  }

  _renderExplorerTab() {
    const config = this.getConfig();
    const customItems = (config.customDePara || []).map((d) => ({ ...d, source: 'Customizado' }));
    const baseItems = (config.todasBases || []).map((b) => ({ ...b, source: 'todasBases' }));
    const allItems = [...customItems, ...baseItems];

    const motivos = config.motivos || [];
    const hospitais = config.hospitais || [];
    const frases = config.frases || [];
    const leadtimeEntries = Object.entries(config.leadtimeUF || {});

    const clientMap = new Map();
    for (const m of motivos) {
      if (m.codCliente && !clientMap.has(m.codCliente)) {
        clientMap.set(m.codCliente, m.cliente || '');
      }
    }

    const q = this.explorerSearch.trim().toLowerCase();
    let rows = [];
    let columnsHtml = '';
    let renderRowHtml = () => '';

    if (this.explorerSubTab === 'itens') {
      rows = allItems.filter((it) => {
        if (!q) return true;
        return `${it.codCliente || ''} ${it.codSap || ''} ${it.codItem || ''} ${it.descItem || ''} ${it.codCBS || ''} ${it.descCBS || ''}`
          .toLowerCase()
          .includes(q);
      });
      columnsHtml = '<th>Origem</th><th>Cliente</th><th>Cód. GTplan / SAP</th><th>Desc. Item</th><th>Cód. CBS</th><th>Mult.</th>';
      renderRowHtml = (it) => `
        <tr>
          <td><span class="chip ${it.source === 'Customizado' ? 'chip-info' : 'chip-neutral'}">${esc(it.source)}</span></td>
          <td class="mono">${esc(it.codCliente || 'Todos')}</td>
          <td class="mono"><strong>${esc(it.codItem)}</strong>${it.codSap ? `<div class="sub-line">SAP: ${esc(it.codSap)}</div>` : ''}</td>
          <td>${esc(it.descItem)}${it.descCBS ? `<div class="sub-line">CBS: ${esc(it.descCBS)}</div>` : ''}</td>
          <td class="mono"><strong>${esc(it.codCBS)}</strong></td>
          <td class="mono">${it.mult ?? 1}</td>
        </tr>`;
    } else if (this.explorerSubTab === 'motivos') {
      rows = motivos.filter((m) => {
        if (this.explorerClientFilter && m.codCliente !== this.explorerClientFilter) return false;
        if (!q) return true;
        return `${m.codCliente} ${m.cliente} ${m.codigo} ${m.desc}`.toLowerCase().includes(q);
      });
      columnsHtml = '<th>Cód. Cliente</th><th>Cliente</th><th>Código GTplan</th><th>Descrição do Motivo no Portal</th>';
      renderRowHtml = (m) => `
        <tr>
          <td class="mono"><span class="chip chip-neutral">${esc(m.codCliente)}</span></td>
          <td>${esc(m.cliente)}</td>
          <td class="mono"><strong>${esc(m.codigo)}</strong></td>
          <td>${esc(m.desc)}</td>
        </tr>`;
    } else if (this.explorerSubTab === 'hospitais') {
      rows = hospitais.filter((h) => {
        if (!q) return true;
        return `${h.estab} ${h.nome} ${h.codCliente} ${h.loja} ${h.uf}`.toLowerCase().includes(q);
      });
      columnsHtml = '<th>Estabelecimento (Estab.)</th><th>Nome / Razão</th><th>Cliente | Loja TOTVS</th><th>UF</th><th>SLA (dias úteis)</th>';
      renderRowHtml = (h) => `
        <tr>
          <td><strong>${esc(h.estab)}</strong></td>
          <td>${esc(h.nome)}</td>
          <td class="mono">${esc(h.codCliente)} | ${esc(h.loja)}</td>
          <td class="mono">${esc(h.uf)}</td>
          <td class="mono"><strong>${esc(h.sla)}</strong></td>
        </tr>`;
    } else {
      rows = [
        ...frases.map((f) => ({ tipo: 'Frase Padrão', texto: f.frase, slug: f.slug || '(livre)' })),
        ...(config.motiveSlugMap || []).map((m) => ({ tipo: 'Mapa Parametros', texto: m.desc, slug: m.slug }))
      ].filter((r) => !q || `${r.tipo} ${r.texto} ${r.slug}`.toLowerCase().includes(q));
      columnsHtml = '<th>Tipo</th><th>Descrição / Frase</th><th>Intenção (Slug)</th>';
      renderRowHtml = (r) => `
        <tr>
          <td><span class="chip ${r.tipo === 'Frase Padrão' ? 'chip-info' : 'chip-neutral'}">${esc(r.tipo)}</span></td>
          <td>${esc(r.texto)}</td>
          <td class="mono">${esc(r.slug)}</td>
        </tr>`;
    }

    const pageSize = 50;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    this.explorerPage = Math.max(1, Math.min(this.explorerPage, totalPages));
    const start = (this.explorerPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    const clientOpts = this.explorerSubTab === 'motivos'
      ? `
        <select id="exp-client-filter" class="cell-input" style="width:230px;">
          <option value="">Todos os clientes (${clientMap.size})</option>
          ${Array.from(clientMap.entries())
            .sort((a, b) => Number(a[0]) - Number(b[0]))
            .map(([cod, nm]) => `<option value="${esc(cod)}" ${cod === this.explorerClientFilter ? 'selected' : ''}>${esc(cod)} — ${esc(nm)}</option>`)
            .join('')}
        </select>`
      : '';

    const ufSummary = this.explorerSubTab === 'hospitais'
      ? `<div class="chip-stack"><strong>Leadtime padrão por UF:</strong> ${leadtimeEntries.map(([uf, s]) => `<span class="chip chip-neutral mono">${esc(uf)}: ${s}d</span>`).join('')}</div>`
      : '';

    this.bodyEl.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;">
        <button type="button" class="btn btn-xs ${this.explorerSubTab === 'itens' ? 'btn-primary' : ''}" data-exp-sub="itens">Itens De-Para (${allItems.length})</button>
        <button type="button" class="btn btn-xs ${this.explorerSubTab === 'motivos' ? 'btn-primary' : ''}" data-exp-sub="motivos">Motivos por Cliente (${motivos.length})</button>
        <button type="button" class="btn btn-xs ${this.explorerSubTab === 'hospitais' ? 'btn-primary' : ''}" data-exp-sub="hospitais">Hospitais / Lojas (${hospitais.length})</button>
        <button type="button" class="btn btn-xs ${this.explorerSubTab === 'frases' ? 'btn-primary' : ''}" data-exp-sub="frases">Frases &amp; Mapeamentos (${frases.length + (config.motiveSlugMap?.length || 0)})</button>
      </div>

      ${ufSummary}

      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        <input type="text" id="exp-search" class="cell-input" style="flex:1;min-width:220px;" value="${esc(this.explorerSearch)}" placeholder="Pesquisar na base selecionada..." />
        ${clientOpts}
        <span class="sub-line">${rows.length.toLocaleString('pt-BR')} registro(s) encontrado(s)</span>
      </div>

      <div style="max-height:380px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
        <table class="triage-table">
          <thead><tr>${columnsHtml}</tr></thead>
          <tbody>
            ${
              pageRows.length === 0
                ? '<tr><td colspan="6" style="text-align:center;color:#64748b;padding:20px;">Nenhum registro encontrado.</td></tr>'
                : pageRows.map(renderRowHtml).join('')
            }
          </tbody>
        </table>
      </div>

      <div class="pagination-bar" style="border-radius:8px;border:1px solid var(--border-soft);">
        <div>Exibindo <strong>${rows.length === 0 ? 0 : start + 1}</strong>–<strong>${Math.min(start + pageRows.length, rows.length)}</strong> de <strong>${rows.length}</strong></div>
        <div style="display:flex;align-items:center;gap:6px;">
          <button type="button" class="btn btn-xs" id="exp-prev" ${this.explorerPage <= 1 ? 'disabled' : ''}>← Anterior</button>
          <span>Página ${this.explorerPage} de ${totalPages}</span>
          <button type="button" class="btn btn-xs" id="exp-next" ${this.explorerPage >= totalPages ? 'disabled' : ''}>Próxima →</button>
        </div>
      </div>
    `;

    this.bodyEl.querySelectorAll('[data-exp-sub]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.explorerSubTab = btn.dataset.expSub;
        this.explorerPage = 1;
        this.explorerSearch = '';
        this.render();
      });
    });

    this.bodyEl.querySelector('#exp-search').addEventListener('input', (e) => {
      this.explorerSearch = e.target.value;
      this.explorerPage = 1;
      const caret = e.target.selectionStart;
      this.render();
      const el = this.bodyEl.querySelector('#exp-search');
      if (el) {
        el.focus();
        el.setSelectionRange(caret, caret);
      }
    });

    const cliSel = this.bodyEl.querySelector('#exp-client-filter');
    if (cliSel) {
      cliSel.addEventListener('change', () => {
        this.explorerClientFilter = cliSel.value;
        this.explorerPage = 1;
        this.render();
      });
    }

    this.bodyEl.querySelector('#exp-prev').addEventListener('click', () => {
      this.explorerPage--;
      this.render();
    });
    this.bodyEl.querySelector('#exp-next').addEventListener('click', () => {
      this.explorerPage++;
      this.render();
    });
  }
}

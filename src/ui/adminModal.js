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
    showToast,
    cloud
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
    this.cloud = cloud || null;

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
      const active = btn.dataset.tab === this.activeTab;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    const titles = {
      motives: 'Motivos por cliente',
      rules: 'Prazos e feriados',
      depara: 'Vínculos de itens e frases',
      bases: 'Atualizar bases e backup',
      explorer: 'Consultar bases',
      cloud: 'Nuvem (equipe)'
    };
    if (this.titleEl) this.titleEl.textContent = titles[this.activeTab] || 'Configurações';

    if (this.activeTab === 'motives') this._renderMotivesTab();
    else if (this.activeTab === 'rules') this._renderRulesTab();
    else if (this.activeTab === 'depara') this._renderDeParaFrasesTab();
    else if (this.activeTab === 'bases') this._renderBasesBackupTab();
    else if (this.activeTab === 'explorer') this._renderExplorerTab();
    else if (this.activeTab === 'cloud') this._renderCloudTab();
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
      exact: '<span class="chip chip-success">Automático</span>',
      review: '<span class="chip chip-warn" title="O cliente tem mais de um código para esta situação">Revisar</span>',
      suggested: '<span class="chip chip-info" title="Escolhido por semelhança de texto">Sugerido</span>',
      missing: '<span class="chip chip-danger">Sem código</span>'
    };

    const clientOptions = [
      `<option value="">Todos (${targetClients.length} clientes)</option>`,
      ...targetClients.map((c) => {
        const name = resolver.getClientName(c);
        return `<option value="${esc(c)}" ${c === this.motiveClientFilter ? 'selected' : ''}>${esc(c)} — ${esc(name || 'Cliente')}</option>`;
      })
    ].join('');

    this.bodyEl.innerHTML = `
      <div class="callout">
        <strong>O que é esta tela:</strong> cada cliente do GTplan tem a própria lista de códigos de motivo. Aqui você confere qual código o app vai usar em cada situação (ex.: <em>Pedido entregue</em>). Linhas marcadas <strong>Revisar</strong> são as que o cliente tem mais de um código parecido — escolha o certo uma vez e ele fica salvo para as próximas importações. A observação sempre começa com a data de hoje (<span class="mono">${todayShort}:</span>).
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
          Manter as regras antigas da planilha (Santa Helena: +2 dias úteis no prazo; Santa Joana: texto curto quando a OC está fora do leadtime)
        </label>
      </div>

      <div>
        <strong>Prazo de entrega diferente para um cliente ou estabelecimento</strong>
        <div class="sub-line">O prazo normal vem da aba Hospitais (ou do estado: SP 1 dia útil, RJ 2…). Só cadastre aqui as exceções.</div>
        <form id="form-add-rule" class="form-grid" style="margin-top:8px;">
          <div class="form-field">
            <label>Escopo</label>
            <select name="scope">
              <option value="estab">Estabelecimento (Estab.)</option>
              <option value="client">Cód. Cliente</option>
            </select>
          </div>
          <div class="form-field">
            <label>Nome do estabelecimento ou Cód. Cliente</label>
            <input name="key" required placeholder="Nome do estab. ou código" />
          </div>
          <div class="form-field">
            <label>Prazo fixo em dias úteis (opcional)</label>
            <input name="slaOverride" type="number" min="1" placeholder="Ex: 3" />
          </div>
          <div class="form-field">
            <label>Somar/subtrair dias úteis</label>
            <input name="extraSla" type="number" placeholder="Ex: 2" />
          </div>
          <div class="form-field">
            <label>Texto curto fora do leadtime?</label>
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
              <tr><th>Tipo</th><th>Cliente / Estab.</th><th>Prazo fixo</th><th>+/- dias</th><th>Texto curto</th><th></th></tr>
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
        <strong>Feriados</strong> <span class="sub-line">(não contam como dia útil no cálculo da previsão de entrega)</span>
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
      <div class="callout">
        <strong>Para que serve:</strong> quando um item do GTplan aparece como <em>Sem De-Para</em>, informe aqui qual é o código CBS (TOTVS) dele.
        O vínculo vale nas próximas importações. Tudo fica salvo neste navegador — para levar para outro computador use
        <em>Atualizar bases &amp; backup → Baixar backup</em>.
      </div>

      <div>
        <strong>Vincular item do GTplan a um código CBS</strong>
        <form id="form-add-depara" class="form-grid" style="margin-top:8px;">
          <div class="form-field">
            <label>Cód. Cliente (deixe vazio = vale para todos)</label>
            <input name="codCliente" value="${esc(pre.codCliente || '')}" placeholder="Ex: 113" />
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
            <label>Cód. CBS (TOTVS) * — vários? separe por vírgula</label>
            <input name="codCBS" required placeholder="Ex: 005958, 000445" />

          </div>
          <div class="form-field">
            <label>Unidades por caixa</label>
            <input name="mult" type="number" min="1" value="1" />
          </div>
          <button type="submit" class="btn btn-primary">+ Salvar vínculo</button>
        </form>

        <div style="margin-top:8px;max-height:180px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
          <table class="triage-table">
            <thead><tr><th>Cliente</th><th>Cód. Item</th><th>Desc. Item</th><th>CBS</th><th>Mult.</th><th></th></tr></thead>
            <tbody>
              ${
                customDePara.length === 0
                  ? '<tr><td colspan="6" style="text-align:center;color:#64748b;">Nenhum vínculo manual ainda. Os itens da planilha todasBases já são reconhecidos automaticamente.</td></tr>'
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
        <strong>Frases prontas para a Observação</strong>
        <div class="sub-line">Aparecem no botão <em>Frases padrão</em> de cada linha da tabela. A data de hoje é colocada na frente automaticamente.</div>
        <form id="form-add-frase" class="form-grid" style="margin-top:8px;">
          <div class="form-field" style="grid-column:span 2;">
            <label>Texto da frase *</label>
            <input name="frase" required placeholder="Ex: Pedido aguardando liberação comercial" />
          </div>
          <div class="form-field">
            <label>Situação (opcional)</label>
            <select name="slug">
              <option value="">Nenhuma em especial</option>
              ${INTENT_SLUGS.map((s) => `<option value="${s.slug}">${esc(s.label)}</option>`).join('')}
            </select>
          </div>
          <button type="submit" class="btn btn-primary">+ Adicionar frase</button>
        </form>

        <div style="margin-top:8px;max-height:170px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
          <table class="triage-table">
            <thead><tr><th>Frase</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              ${frases
                .map(
                  (f, idx) => `<tr><td>${esc(f.frase)}</td><td>${esc(INTENT_SLUGS.find((s) => s.slug === f.slug)?.label || '—')}</td><td><button type="button" class="btn btn-xs" data-del-frase="${idx}">Remover</button></td></tr>`
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
      const codes = String(fd.get('codCBS') || '')
        .split(/[,;\s]+/)
        .map((c) => c.replace(/\D/g, ''))
        .filter(Boolean)
        .map((c) => c.padStart(6, '0'));
      if (!codes.length) return;
      const base = {
        codCliente: String(fd.get('codCliente') || '').trim(),
        codItem: String(fd.get('codItem') || '').trim(),
        descItem: String(fd.get('descItem') || '').trim(),
        mult: Math.max(1, Number(fd.get('mult')) || 1)
      };
      let added = 0;
      for (const codCBS of codes) {
        const dup = config.customDePara.some(
          (d) => d.codItem === base.codItem && d.codCBS === codCBS && (d.codCliente || '') === base.codCliente
        );
        if (dup) continue;
        config.customDePara.push({ ...base, codCBS, createdAt: new Date().toISOString() });
        added++;
      }
      this.prefillDePara = null;
      await this.onConfigChanged(config, true);
      this.showToast(added ? `${added} vínculo(s) salvo(s) e lote recalculado.` : 'Esses vínculos já existiam.');
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

  _renderCloudTab() {
    if (!this.cloud) {
      this.bodyEl.innerHTML = '<div class="callout">Nuvem indisponível nesta versão.</div>';
      return;
    }
    const { cfg, user, status, builtIn } = this.cloud.getState();
    const nVinculos = (this.getConfig().customDePara || []).length;

    const statusBox =
      status.mode === 'cloud'
        ? `<div class="callout callout-success"><strong>Conectado como ${esc(user?.email || '')}.</strong> Vínculos De-Para, motivos revisados, frases, feriados e prazos são compartilhados com a equipe.</div>`
        : status.mode === 'error'
          ? `<div class="callout callout-warn"><strong>Problema com a nuvem:</strong> ${esc(status.message || '')}. Os dados continuam salvos neste navegador.</div>`
          : `<div class="callout"><strong>Hoje tudo fica só neste navegador.</strong> Se limpar os dados do navegador ou trocar de computador, os ${nVinculos} vínculo(s) e as configurações se perdem (a não ser que tenha um backup). Conecte a nuvem para guardar com segurança e compartilhar com a equipe.</div>`;

    this.bodyEl.innerHTML = `
      ${statusBox}

      ${
        user
          ? `
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <button type="button" class="btn btn-primary" id="btn-cloud-upload" title="Envia para a nuvem os vínculos e configurações que existem só neste navegador (não apaga nada lá)">Enviar dados deste navegador para a nuvem</button>
          <button type="button" class="btn" id="btn-cloud-reload">Atualizar da nuvem</button>
          <button type="button" class="btn btn-danger-ghost" id="btn-cloud-logout" style="margin-left:auto;">Sair</button>
        </div>
        <div class="sub-line">Projeto: <span class="mono">${esc(cfg.url)}</span></div>`
          : `
        <form id="form-cloud" class="form-grid" autocomplete="on">
          ${
            builtIn
              ? `<input type="hidden" name="url" value="${esc(cfg.url)}" />
          <input type="hidden" name="anonKey" value="${esc(cfg.anonKey)}" />`
              : `<div class="form-field" style="grid-column:span 2;">
            <label>URL do projeto Supabase</label>
            <input name="url" required value="${esc(cfg.url)}" placeholder="https://xxxx.supabase.co" />
          </div>
          <div class="form-field" style="grid-column:span 2;">
            <label>Chave pública (anon key)</label>
            <input name="anonKey" required value="${esc(cfg.anonKey)}" placeholder="sb_publishable_…" />
          </div>`
          }
          <div class="form-field">
            <label>E-mail</label>
            <input name="email" type="email" required autocomplete="username" />
          </div>
          <div class="form-field">
            <label>Senha</label>
            <input name="password" type="password" required autocomplete="current-password" />
          </div>
          <button type="submit" class="btn btn-primary">Entrar</button>
        </form>
        ${
          builtIn
            ? '<div class="sub-line">Ainda não tem login? Peça para o administrador criar o seu no Supabase (Authentication → Users → Add user).</div>'
            : cfg.url
              ? '<button type="button" class="btn btn-xs btn-ghost" id="btn-cloud-forget">Esquecer este projeto</button>'
              : ''
        }`
      }

      ${
        builtIn
          ? '<div class="sub-line">Os arquivos CSV e a planilha TOTVS nunca vão para a nuvem: continuam sendo lidos só no seu navegador.</div>'
          : `<details>
        <summary><strong>Como configurar a nuvem (uma vez só)</strong></summary>
        <ol class="sub-line" style="line-height:1.6;">
          <li>Crie um projeto gratuito em supabase.com.</li>
          <li>No <em>SQL Editor</em>, rode o arquivo <span class="mono">supabase/schema.sql</span> deste projeto. Ele cria as tabelas e a regra de segurança que só libera usuários logados.</li>
          <li>Em <em>Authentication → Providers → Email</em>, desligue o cadastro aberto, e em <em>Users → Add user</em> crie um login para cada pessoa da equipe.</li>
          <li>Em <em>Project Settings → API</em>, copie a <em>Project URL</em> e a <em>anon public key</em> para os campos acima.</li>
          <li>Depois de entrar, clique em <em>Enviar dados deste navegador para a nuvem</em> para levar os vínculos que você já cadastrou.</li>
        </ol>
        <div class="sub-line">Os arquivos CSV e a planilha TOTVS nunca vão para a nuvem: continuam sendo lidos só no seu navegador.</div>
      </details>`
      }
    `;

    const run = async (btn, fn) => {
      const label = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Aguarde…';
      try {
        await fn();
      } catch (err) {
        this.showToast(`Nuvem: ${err.message}`, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = label;
        this.render();
      }
    };

    const form = this.bodyEl.querySelector('#form-cloud');
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      run(form.querySelector('button[type=submit]'), async () => {
        const u = await this.cloud.connect({
          url: fd.get('url'),
          anonKey: fd.get('anonKey'),
          email: fd.get('email'),
          password: fd.get('password')
        });
        this.showToast(`Conectado como ${u?.email || 'usuário'}.`, 'success');
      });
    });
    const on = (id, fn) => {
      const b = this.bodyEl.querySelector(id);
      b?.addEventListener('click', () => run(b, fn));
    };
    on('#btn-cloud-upload', async () => {
      const r = await this.cloud.uploadLocal();
      this.showToast(`Enviado: ${r.vinculos} vínculo(s) e ${r.configuracoes} configuração(ões) que faltavam na nuvem.`, 'success');
    });
    on('#btn-cloud-reload', async () => {
      await this.cloud.reload();
      this.showToast("Dados atualizados da nuvem.", "success");
    });
    on('#btn-cloud-logout', async () => {
      await this.cloud.logout();
      this.showToast('Você saiu da nuvem. Os dados seguem salvos neste navegador.');
    });
    on('#btn-cloud-forget', async () => {
      await this.cloud.forget();
    });
  }

  _renderBasesBackupTab() {
    const config = this.getConfig();
    this.bodyEl.innerHTML = `
      <div class="callout">
        <strong>Normalmente você não precisa mexer aqui.</strong> O app já vem com as bases de itens, hospitais e motivos.
        Use esta tela só quando cadastrar itens novos no <span class="mono">importador_gtplan.xlsm</span> ou quando o GTplan mudar a lista de motivos.
      </div>
      <div class="sub-line">
        Em uso agora: <strong>${config.todasBases.length.toLocaleString('pt-BR')}</strong> itens De-Para,
        <strong>${config.motivos.length.toLocaleString('pt-BR')}</strong> motivos de clientes,
        <strong>${config.hospitais.length}</strong> hospitais,
        <strong>${config.customDePara.length}</strong> vínculos manuais.
        ${config.basesImportedAt ? `Bases importadas por você em ${esc(new Date(config.basesImportedAt).toLocaleString('pt-BR'))}.` : 'Usando as bases que vêm com o app.'}
      </div>

      <div class="ingest-grid">
        <div class="dropzone" style="cursor:default;flex-direction:column;align-items:flex-start;">
          <div class="dropzone-title">Atualizar itens e hospitais</div>
          <div class="dropzone-meta">Selecione o <span class="mono">importador_gtplan.xlsm</span> (lê as abas todasBases e Hospitais)</div>
          <input type="file" id="inp-import-xlsm" accept=".xlsm,.xlsx" style="display:block;margin-top:6px;" />
        </div>
        <div class="dropzone" style="cursor:default;flex-direction:column;align-items:flex-start;">
          <div class="dropzone-title">Atualizar lista de motivos dos clientes</div>
          <div class="dropzone-meta">Selecione o <span class="mono">motivos_follow_up_todos_os_clientes.csv</span></div>
          <input type="file" id="inp-import-motivos" accept=".csv" style="display:block;margin-top:6px;" />
        </div>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:10px;padding-top:8px;border-top:1px solid var(--border-soft);">
        <button type="button" class="btn btn-primary" id="btn-export-backup" title="Salva vínculos, frases, motivos revisados e prazos num arquivo para levar a outro computador">Baixar backup</button>
        <label class="btn" style="cursor:pointer;">
          Carregar backup
          <input type="file" id="inp-import-backup" accept=".json" style="display:none;" />
        </label>
        <button type="button" class="btn btn-danger-ghost" id="btn-reset-seed" style="margin-left:auto;">Voltar ao padrão de fábrica…</button>
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
      config.basesImportedAt = new Date().toISOString();
      await this.onConfigChanged(config, true);
      this.showToast(`${nextMotivos.length} motivos importados e salvos!`);
      this.render();
    });

    this.bodyEl.querySelector('#inp-import-xlsm').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      let sheetsRaw;
      try {
        sheetsRaw = await readWorkbookSheets(new Uint8Array(await file.arrayBuffer()), ['todasBases', 'Hospitais']);
      } catch (err) {
        this.showToast(`Erro ao ler ${file.name}: ${err.message}`, 'error');
        return;
      }
      // Lê colunas pelo nome, ignorando acentos/maiúsculas/espaços ("Cód Cliente" = "COD CLIENTE")
      const pick = (row, ...names) => {
        const wanted = names.map(normalizeText);
        for (const [k, v] of Object.entries(row)) {
          if (wanted.includes(normalizeText(k)) && String(v ?? '').trim() !== '') return String(v).trim();
        }
        return '';
      };
      let nItens = 0;
      let nHosp = 0;
      if (sheetsRaw.todasBases?.length) {
        const mapped = rowsToObjects(sheetsRaw.todasBases, 1)
          .filter((r) => pick(r, 'Cod CBS'))
          .map((r) => ({
            codSap: pick(r, 'Cod Item C SAP'),
            codItem: pick(r, 'Cod Item C Gtplan'),
            descItem: pick(r, 'Desc Item C'),
            codCBS: pick(r, 'Cod CBS').padStart(6, '0'),
            descCBS: pick(r, 'Descrição CBS', 'Desc CBS'),
            mult: Math.max(1, Number(pick(r, 'Multiplicador')) || 1)
          }));
        if (mapped.length) {
          config.todasBases = mapped;
          nItens = mapped.length;
        }
      }
      if (sheetsRaw.Hospitais?.length) {
        const mappedH = rowsToObjects(sheetsRaw.Hospitais, 1)
          .map((r) => ({
            estab: pick(r, 'Estab'),
            codCliente: pick(r, 'Cód Cliente', 'Cliente'),
            loja: pick(r, 'Loja'),
            concat2: pick(r, 'Concatenar2', 'Concat2'),
            nome: pick(r, 'Nome Fantasia', 'Nome'),
            uf: pick(r, 'UF').toUpperCase(),
            sla: Math.max(1, Number(pick(r, 'SLA')) || 1)
          }))
          .filter((h) => h.estab || h.nome);
        if (mappedH.length) {
          config.hospitais = mappedH;
          nHosp = mappedH.length;
        }
      }
      if (!nItens && !nHosp) {
        this.showToast(`Não encontrei as abas todasBases/Hospitais em ${file.name}.`, 'error');
        return;
      }
      config.basesImportedAt = new Date().toISOString();
      await this.onConfigChanged(config, true);
      this.showToast(`Bases atualizadas: ${nItens.toLocaleString('pt-BR')} itens e ${nHosp} hospitais.`, 'success');
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
      const ok = window.confirm(
        'Restaurar os dados de fábrica apaga De-Paras customizados, frases, revisões de motivos, regras de prazo e feriados salvos neste navegador.\n\nRecomendado: exporte um Backup JSON antes.\n\nContinuar?'
      );
      if (!ok) return;
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

import { INTENT_SLUGS, normalizeText } from '../core/motiveResolver.js';
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
  }

  _renderMotivesTab() {
    const config = this.getConfig();
    const resolver = this.getMotiveResolver();
    const loadedClients = this.getLoadedClients();
    const targetClients = loadedClients.length > 0 ? loadedClients : Array.from(resolver.byClient.keys()).slice(0, 12);

    const matrix = resolver.buildReviewMatrix(targetClients);
    const filtered = this.onlyReviewFilter
      ? matrix.filter((m) => m.confidence === 'review' || m.confidence === 'suggested' || m.confidence === 'missing')
      : matrix;

    const statusBadge = {
      confirmed: '<span class="chip chip-success">Confirmado</span>',
      exact: '<span class="chip chip-success">Exato</span>',
      review: '<span class="chip chip-warn">Revisar (Duplicado)</span>',
      suggested: '<span class="chip chip-info">Sugerido (Revisar)</span>',
      missing: '<span class="chip chip-danger">Ausente</span>'
    };

    this.bodyEl.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
        <div>
          <strong>Matriz de Motivos por Cliente</strong>
          <div class="sub-line">
            ${loadedClients.length > 0 ? `Exibindo ${loadedClients.length} cliente(s) do CSV carregado.` : 'Nenhum CSV carregado: exibindo amostra de clientes do dicionário.'}
            Ao confirmar ou alterar um código, o sistema aprende permanentemente para esse cliente.
          </div>
        </div>
        <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
          <input type="checkbox" id="chk-only-review" ${this.onlyReviewFilter ? 'checked' : ''} />
          Mostrar apenas Sugestões / Revisão / Ausentes
        </label>
      </div>

      <div style="max-height:420px;overflow:auto;border:1px solid var(--border-soft);border-radius:8px;">
        <table class="triage-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Intenção (Slug)</th>
              <th>Status</th>
              <th>Motivo Selecionado no Cliente</th>
            </tr>
          </thead>
          <tbody>
            ${filtered
              .map((item) => {
                const clientMotives = resolver.getClientMotives(item.codCliente);
                const opts = [
                  '<option value="">-- Nenhum / Manual --</option>',
                  ...clientMotives.map(
                    (cm) =>
                      `<option value="${esc(cm.codigo)}" ${cm.codigo === item.codigo ? 'selected' : ''}>${esc(cm.codigo)} — ${esc(cm.desc)}</option>`
                  )
                ].join('');
                return `
                  <tr>
                    <td>
                      <span class="chip chip-neutral mono">${esc(item.codCliente)}</span>
                      <div class="sub-line">${esc(item.cliente)}</div>
                    </td>
                    <td>
                      <strong>${esc(item.label)}</strong>
                      <div class="sub-line mono">${esc(item.slug)}</div>
                    </td>
                    <td>${statusBadge[item.confidence] || ''}</td>
                    <td>
                      <select class="cell-input" data-motive-override data-cli="${esc(item.codCliente)}" data-slug="${esc(item.slug)}">
                        ${opts}
                      </select>
                    </td>
                  </tr>`;
              })
              .join('')}
          </tbody>
        </table>
      </div>
    `;

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
        <strong>Regras Personalizadas por Cód. Cliente ou Estabelecimento</strong>
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
}

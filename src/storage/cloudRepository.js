/**
 * Persistência na nuvem (Supabase) sem SDK: usa só fetch na API REST (PostgREST + GoTrue).
 *
 * Como funciona
 * - O navegador continua guardando tudo no IndexedDB (cache local / modo offline).
 * - Com a nuvem configurada e o usuário logado, os vínculos De-Para e as configurações
 *   (motivos revisados, frases, feriados, prazos) passam a vir da nuvem e a ser gravados nela,
 *   então toda a equipe enxerga a mesma coisa.
 * - Vínculos De-Para são gravados linha a linha (tabela depara_vinculos): duas pessoas podem
 *   cadastrar ao mesmo tempo sem uma apagar o trabalho da outra.
 * - Configurações ficam em app_settings (uma linha por chave, valor jsonb).
 *
 * Segurança: a "anon key" do Supabase é pública por design; quem protege os dados é o
 * Row Level Security (ver supabase/schema.sql), que só libera usuários autenticados.
 */

import { createDefaultConfig, ensureDeParaIds, normalizeFrases } from './repository.js';

/**
 * Para a equipe não precisar digitar URL/chave: preencha aqui e gere o build (node build.mjs).
 * Deixe vazio para configurar pela tela Configurações → Nuvem.
 */
export const DEFAULT_CLOUD = {
  url: '',
  anonKey: ''
};

const LS_CLOUD = 'gtplan_cloud_cfg';
const LS_SESSION = 'gtplan_cloud_session';

/** Chaves de configuração sincronizadas (além dos vínculos De-Para). */
export const SYNCED_SETTING_KEYS = ['motiveOverrides', 'frases', 'holidays', 'clientRules'];

function lsGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

function lsSet(key, val) {
  try {
    if (val == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(val));
  } catch {
    // storage bloqueado: segue só em memória
  }
}

export function loadCloudConfig() {
  const saved = lsGet(LS_CLOUD) || {};
  return {
    url: String(saved.url || DEFAULT_CLOUD.url || '').trim().replace(/\/+$/, ''),
    anonKey: String(saved.anonKey || DEFAULT_CLOUD.anonKey || '').trim()
  };
}

export function saveCloudConfig(cfg) {
  lsSet(LS_CLOUD, cfg ? { url: cfg.url, anonKey: cfg.anonKey } : null);
}

/** De/para entre o formato do app e as colunas do banco. */
export function deParaToDb(d) {
  return {
    id: d.id,
    cod_cliente: String(d.codCliente || ''),
    cod_item: String(d.codItem || ''),
    desc_item: String(d.descItem || ''),
    cod_cbs: String(d.codCBS || ''),
    mult: Math.max(1, Number(d.mult) || 1)
  };
}

export function deParaFromDb(r) {
  return {
    id: r.id,
    codCliente: r.cod_cliente || '',
    codItem: r.cod_item || '',
    descItem: r.desc_item || '',
    codCBS: r.cod_cbs || '',
    mult: Math.max(1, Number(r.mult) || 1),
    createdAt: r.created_at || ''
  };
}

/** Cliente mínimo da API do Supabase. `fetchImpl` permite testar sem rede. */
export class SupabaseClient {
  constructor({ url, anonKey, fetchImpl } = {}) {
    this.url = String(url || '').replace(/\/+$/, '');
    this.anonKey = anonKey || '';
    const rawFetch = fetchImpl || ((...a) => fetch(...a));
    // Erros de rede do navegador ("Failed to fetch") viram uma mensagem que o usuário entende
    this.fetch = async (...a) => {
      try {
        return await rawFetch(...a);
      } catch (err) {
        throw new Error('Não consegui acessar o Supabase. Confira a URL do projeto e a sua internet.');
      }
    };
    this.session = lsGet(LS_SESSION);
  }

  get configured() {
    return Boolean(this.url && this.anonKey);
  }

  get user() {
    return this.session?.user || null;
  }

  async _json(res) {
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const msg = body?.error_description || body?.msg || body?.message || body?.error || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  _storeSession(s) {
    if (!s?.access_token) throw new Error('Resposta de login inválida.');
    this.session = {
      access_token: s.access_token,
      refresh_token: s.refresh_token,
      expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
      user: s.user ? { id: s.user.id, email: s.user.email } : this.session?.user || null
    };
    lsSet(LS_SESSION, this.session);
  }

  async signIn(email, password) {
    const res = await this.fetch(`${this.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    this._storeSession(await this._json(res));
    return this.user;
  }

  signOut() {
    this.session = null;
    lsSet(LS_SESSION, null);
  }

  async _ensureFreshToken() {
    if (!this.session) throw new Error('Faça login na nuvem.');
    const now = Math.floor(Date.now() / 1000);
    if (this.session.expires_at - now > 60) return;
    const res = await this.fetch(`${this.url}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: this.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: this.session.refresh_token })
    });
    try {
      this._storeSession(await this._json(res));
    } catch (err) {
      this.signOut();
      throw new Error('Sessão expirada. Entre novamente na nuvem.');
    }
  }

  async rest(method, path, { body, prefer } = {}) {
    await this._ensureFreshToken();
    const headers = {
      apikey: this.anonKey,
      Authorization: `Bearer ${this.session.access_token}`,
      'Content-Type': 'application/json'
    };
    if (prefer) headers.Prefer = prefer;
    const res = await this.fetch(`${this.url}/rest/v1/${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    return this._json(res);
  }
}

/**
 * Repositório híbrido: IndexedDB sempre; nuvem quando configurada e logada.
 * Mantém a mesma interface (load/save/reset) usada pelo app.
 */
export class HybridRepository {
  /**
   * @param {object} p
   * @param {import('./repository.js').IndexedDbRepository} p.local
   * @param {object} p.seedData
   * @param {SupabaseClient} [p.client]
   * @param {(status:{mode:'local'|'cloud'|'error', message?:string, user?:object})=>void} [p.onStatus]
   */
  constructor({ local, seedData, client = null, onStatus = () => {} }) {
    this.local = local;
    this.seedData = seedData;
    this.client = client;
    this.onStatus = onStatus;
    this.snapshot = null; // o que sabemos que está na nuvem: { depara: Map<id,json>, settings: Map<key,json> }
  }

  get cloudActive() {
    return Boolean(this.client?.configured && this.client?.user);
  }

  setClient(client) {
    this.client = client;
    this.snapshot = null;
  }

  async _pull() {
    const [rows, settings] = await Promise.all([
      this.client.rest('GET', 'depara_vinculos?select=*&order=created_at.asc'),
      this.client.rest('GET', 'app_settings?select=key,value')
    ]);
    return {
      depara: (rows || []).map(deParaFromDb),
      settings: Object.fromEntries((settings || []).map((s) => [s.key, s.value]))
    };
  }

  _takeSnapshot(config) {
    this.snapshot = {
      depara: new Map((config.customDePara || []).map((d) => [d.id, JSON.stringify(deParaToDb(d))])),
      settings: new Map(SYNCED_SETTING_KEYS.map((k) => [k, JSON.stringify(config[k] ?? null)]))
    };
  }

  async load() {
    const localCfg = await this.local.load();
    if (!this.cloudActive) {
      this.onStatus({ mode: 'local' });
      return localCfg;
    }
    try {
      const remote = await this._pull();
      const merged = { ...localCfg, customDePara: remote.depara };
      for (const k of SYNCED_SETTING_KEYS) {
        if (remote.settings[k] !== undefined && remote.settings[k] !== null) merged[k] = remote.settings[k];
      }
      merged.frases = normalizeFrases(merged.frases);
      this._takeSnapshot(merged);
      await this.local.save(merged);
      this.onStatus({ mode: 'cloud', user: this.client.user });
      return merged;
    } catch (err) {
      this.onStatus({ mode: 'error', message: err.message, user: this.client.user });
      return localCfg;
    }
  }

  async save(config) {
    config.customDePara = ensureDeParaIds(config.customDePara);
    await this.local.save(config);
    if (!this.cloudActive) return config;
    if (!this.snapshot) {
      // Ainda não sincronizou nesta sessão: compara com o que está na nuvem agora
      const remote = await this._pull().catch(() => null);
      this.snapshot = {
        depara: new Map((remote?.depara || []).map((d) => [d.id, JSON.stringify(deParaToDb(d))])),
        settings: new Map(
          Object.entries(remote?.settings || {}).map(([k, v]) => [k, JSON.stringify(v ?? null)])
        )
      };
    }
    try {
      await this._pushDiff(config);
      this.onStatus({ mode: 'cloud', user: this.client.user });
    } catch (err) {
      // Fica salvo localmente; avisa para tentar de novo
      this.onStatus({ mode: 'error', message: `Salvo só neste navegador: ${err.message}`, user: this.client.user });
    }
    return config;
  }

  async _pushDiff(config) {
    const current = new Map((config.customDePara || []).map((d) => [d.id, JSON.stringify(deParaToDb(d))]));
    const upserts = [];
    for (const [id, json] of current) {
      if (this.snapshot.depara.get(id) !== json) upserts.push(JSON.parse(json));
    }
    const removed = [...this.snapshot.depara.keys()].filter((id) => !current.has(id));

    if (upserts.length) {
      await this.client.rest('POST', 'depara_vinculos?on_conflict=id', {
        body: upserts,
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }
    if (removed.length) {
      await this.client.rest('DELETE', `depara_vinculos?id=in.(${removed.map(encodeURIComponent).join(',')})`);
    }

    const settingRows = [];
    for (const k of SYNCED_SETTING_KEYS) {
      const json = JSON.stringify(config[k] ?? null);
      if (this.snapshot.settings.get(k) !== json) settingRows.push({ key: k, value: config[k] ?? null });
    }
    if (settingRows.length) {
      await this.client.rest('POST', 'app_settings?on_conflict=key', {
        body: settingRows,
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }
    this._takeSnapshot(config);
  }

  /** Envia para a nuvem o que existe neste navegador (primeira vez / migração). */
  async uploadLocal() {
    if (!this.cloudActive) throw new Error('Faça login na nuvem primeiro.');
    const localCfg = await this.local.load();
    const remote = await this._pull();
    const key = (d) => `${d.codCliente || ''}|${d.codItem}|${d.codCBS}`;
    const remoteKeys = new Set(remote.depara.map(key));
    const toSend = ensureDeParaIds(localCfg.customDePara).filter((d) => !remoteKeys.has(key(d)));
    if (toSend.length) {
      await this.client.rest('POST', 'depara_vinculos?on_conflict=id', {
        body: toSend.map(deParaToDb),
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }
    const settingRows = SYNCED_SETTING_KEYS.filter((k) => remote.settings[k] === undefined).map((k) => ({
      key: k,
      value: localCfg[k] ?? null
    }));
    if (settingRows.length) {
      await this.client.rest('POST', 'app_settings?on_conflict=key', {
        body: settingRows,
        prefer: 'resolution=merge-duplicates,return=minimal'
      });
    }
    this.snapshot = null;
    return { vinculos: toSend.length, configuracoes: settingRows.length };
  }

  /** "Voltar ao padrão" afeta só este navegador; a nuvem da equipe não é apagada. */
  async reset() {
    await this.local.reset();
    this.snapshot = null;
    return this.load().catch(() => createDefaultConfig(this.seedData));
  }
}

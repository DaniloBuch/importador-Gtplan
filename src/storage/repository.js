/**
 * Camada de Repositório / Persistência (DataRepository).
 * No protótipo usa IndexedDB (com fallback em memória para testes Node).
 * Futuramente basta trocar esta implementação por um adaptador HTTP/SQL sem alterar o motor.
 */

const DB_NAME = 'gtplan_followup_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv_store';
const STATE_KEY = 'app_config_v1';

/** Bases de referência embutidas no app. Só ficam salvas no navegador se o usuário importar versões novas. */
const BASE_KEYS = ['todasBases', 'hospitais', 'motivos', 'motiveSlugMap'];

/**
 * Frases podem vir como texto puro (seed) ou objeto { frase, slug }. Normaliza sempre para objeto.
 */
export function normalizeFrases(list) {
  const out = [];
  const seen = new Set();
  for (const f of list || []) {
    const frase = String(typeof f === 'string' ? f : f?.frase ?? '').trim();
    if (!frase || seen.has(frase.toLowerCase())) continue;
    seen.add(frase.toLowerCase());
    out.push({ frase, descSimples: frase, slug: (typeof f === 'object' && f?.slug) || '' });
  }
  return out;
}

export function createDefaultConfig(seedData) {
  return {
    version: 1,
    basesImportedAt: null, // preenchido só quando o usuário importa bases novas (XLSM / CSV de motivos)
    todasBases: seedData.todasBases || [],
    hospitais: seedData.hospitais || [],
    frases: normalizeFrases(seedData.frases),
    motiveSlugMap: seedData.motiveSlugMap || [],
    motivos: seedData.motivos || [],
    leadtimeUF: seedData.leadtimeUF || { SP: 1, RJ: 2, DF: 4, PE: 8, CE: 8, RN: 10, PR: 2 },
    // Dados personalizáveis pelo usuário (futuro Banco de Dados)
    customDePara: [],       // [{ codCliente, codItem, descItem, codCBS, mult }]
    motiveOverrides: {},    // { [codCliente]: { [slug]: codigo } }
    holidays: [],           // ['2026-11-20', '2026-12-25']
    clientRules: {
      enableLegacyExceptions: true,
      byClient: {},
      byEstab: {}
    }
  };
}

export class MemoryRepository {
  constructor(seedData) {
    this.seedData = seedData;
    this.state = createDefaultConfig(seedData);
  }
  async load() {
    return this.state;
  }
  async save(nextState) {
    this.state = nextState;
    return this.state;
  }
  async reset() {
    this.state = createDefaultConfig(this.seedData);
    return this.state;
  }
}

export class IndexedDbRepository {
  constructor(seedData) {
    this.seedData = seedData;
    this.dbPromise = null;
  }

  _openDb() {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB indisponível neste ambiente.'));
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.dbPromise;
  }

  async load() {
    try {
      const db = await this._openDb();
      const saved = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(STATE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      if (saved && saved.version === 1) {
        const merged = { ...createDefaultConfig(this.seedData), ...saved };
        // Versões antigas gravavam uma cópia das bases embutidas e ela "congelava" para sempre.
        // Agora só mantemos bases salvas se o usuário as importou explicitamente.
        if (!saved.basesImportedAt) {
          for (const k of BASE_KEYS) merged[k] = this.seedData[k] || [];
        }
        merged.frases = normalizeFrases(merged.frases);
        return merged;
      }
      const initial = createDefaultConfig(this.seedData);
      await this.save(initial);
      return initial;
    } catch {
      return createDefaultConfig(this.seedData);
    }
  }

  async save(state) {
    try {
      const db = await this._openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.put(state, STATE_KEY);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch {
      // Silencioso se storage estiver bloqueado
    }
    return state;
  }

  async reset() {
    const initial = createDefaultConfig(this.seedData);
    await this.save(initial);
    return initial;
  }
}

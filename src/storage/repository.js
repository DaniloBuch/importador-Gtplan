/**
 * Camada de Repositório / Persistência (DataRepository).
 * No protótipo usa IndexedDB (com fallback em memória para testes Node).
 * Futuramente basta trocar esta implementação por um adaptador HTTP/SQL sem alterar o motor.
 */

const DB_NAME = 'gtplan_followup_db';
const DB_VERSION = 1;
const STORE_NAME = 'kv_store';
const STATE_KEY = 'app_config_v1';

export function createDefaultConfig(seedData) {
  return {
    version: 1,
    todasBases: seedData.todasBases || [],
    hospitais: seedData.hospitais || [],
    frases: seedData.frases || [],
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
        return { ...createDefaultConfig(this.seedData), ...saved };
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

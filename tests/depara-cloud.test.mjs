import test from 'node:test';
import assert from 'node:assert/strict';

import { MotiveResolver } from '../src/core/motiveResolver.js';
import {
  buildDeParaIndex,
  buildHospitalIndex,
  descSimilarity,
  indexTotvsWorkbook,
  processFollowUpBatch
} from '../src/core/ruleEngine.js';
import { MemoryRepository } from '../src/storage/repository.js';
import { HybridRepository, SupabaseClient } from '../src/storage/cloudRepository.js';

// localStorage mínimo para o cliente Supabase rodar no Node
globalThis.localStorage ??= (() => {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k)
  };
})();

const NOW = new Date(Date.UTC(2026, 10, 17));

function csvRow(rowIndex, over = {}) {
  return {
    rowIndex,
    raw: {
      'Cód. Cliente': '113',
      Cliente: 'H TESTE',
      'ID Ordem': `'X.${rowIndex}`,
      'Núm. OC': '4504923713',
      'Cód. Item': '836661',
      'Desc. Item': 'sonda uretral n16',
      'Estab.': 'AMICO TESTE',
      'Cód. Item Fornecedor': '',
      'Val. Unit.': '1.10',
      'Qtd. Pendente': '90',
      'Dt. OC': '09/10/2026',
      'Dt. Entrega Original': '16/10/2026',
      'Prev. Entrega Atual': '16/10/2026',
      Observação: '',
      Motivo: '',
      'Cód. OC Externo': '',
      ...over
    }
  };
}

function totvs(rows) {
  return indexTotvsWorkbook({
    'Dados Simplificados': rows.map(([Produto, desc, OC]) => ({
      Pedido: 'A56283',
      Cliente: '051722957',
      Loja: '0001',
      Produto,
      'Descr.Produt': desc,
      'Saldo Disp.': '100',
      'Bloq.Estoque': '10',
      'Emissao NF': '19/10/2026',
      'Nota Fiscal': '001796629',
      'Data Entrega': '19/10/2026',
      OC,
      'Valor Unit': '1.10',
      'Qntd Embalagem': '1'
    }))
  });
}

const motiveResolver = new MotiveResolver({
  motivos: [{ codCliente: '113', cliente: 'H TESTE', codigo: '1', desc: 'Pedido entregue' }],
  motiveSlugMap: [{ desc: 'Pedido entregue', slug: 'desc_entregue' }]
});

const run = (rows, totvsIdx, custom) =>
  processFollowUpBatch(rows, {
    totvsIdx,
    deParaIdx: buildDeParaIndex(
      [{ codItem: '836661', descItem: 'sonda uretral n16', codCBS: '005958', mult: 1 }],
      custom
    ),
    hospitalIdx: buildHospitalIndex([]),
    motiveResolver,
    now: NOW
  });

test('depara: sem cruzamento, sugere o CBS que o TOTVS faturou na mesma OC (mais parecido primeiro)', () => {
  const idx = totvs([
    ['002375', 'ESPECULO VAGINAL ESTERIL P', '4504923713'],
    ['000445', 'SONDA URETRAL N 16 CPL', '4504923713']
  ]);
  const [row] = run([csvRow(1)], idx, []);
  assert.equal(row.meta.hasTotvs, false);
  assert.equal(row.meta.needsMotivo, true);
  assert.deepEqual(row.meta.ocSuggestions.map((s) => s.codCBS), ['000445', '002375']);
  assert.ok(row.meta.ocSuggestions[0].score > 0);
  assert.equal(row.meta.ocSuggestions[1].score, 0);
});

test('depara: vários CBS no mesmo item GTplan (por cliente) cruzam com o TOTVS e preenchem a linha', () => {
  const idx = totvs([['000445', 'SONDA URETRAL N 16 CPL', '4504923713']]);
  const custom = [
    { codCliente: '113', codItem: '836661', codCBS: '009991', mult: 1 },
    { codCliente: '113', codItem: '836661', codCBS: '000445', mult: 1 }
  ];
  const [row] = run([csvRow(1)], idx, custom);
  assert.equal(row.meta.hasTotvs, true);
  assert.equal(row.meta.codCBS, '000445', 'o CBS exibido é o que cruzou');
  assert.equal(row.output['Núm. NF'], '001796629');
  assert.ok(row.output['Motivo']);
  assert.ok(row.meta.candidateCbs.includes('005958') && row.meta.candidateCbs.includes('009991'));
});

test('depara: vínculo de outro cliente não vale para este', () => {
  const idx = totvs([['000445', 'SONDA URETRAL N 16 CPL', '4504923713']]);
  const [row] = run([csvRow(1)], idx, [{ codCliente: '999', codItem: '836661', codCBS: '000445', mult: 1 }]);
  assert.equal(row.meta.hasTotvs, false);
});

test('depara: sugestão não oferece item TOTVS que já cruzou com outra linha do CSV', () => {
  const idx = totvs([
    ['000445', 'SONDA URETRAL N 16 CPL', '4504923713'],
    ['002375', 'ESPECULO VAGINAL ESTERIL P', '4504923713']
  ]);
  const rows = [
    csvRow(1),
    csvRow(2, { 'Cód. Item': '001253', 'Desc. Item': 'especulo vaginal pequeno', 'Cód. Item Fornecedor': '' })
  ];
  const custom = [{ codItem: '001253', codCBS: '002375', mult: 1 }];
  const out = run(rows, idx, custom);
  assert.equal(out[1].meta.hasTotvs, true);
  assert.deepEqual(out[0].meta.ocSuggestions.map((s) => s.codCBS), ['000445']);
});

test('descSimilarity: palavras em comum', () => {
  assert.ok(descSimilarity('sonda uretral n16', 'SONDA URETRAL N 16 CPL') > 0.5);
  assert.equal(descSimilarity('lanceta accu-check', 'FRALDA ADULTO'), 0);
});

/** Supabase falso em memória: implementa só o que o app usa. */
function fakeSupabase() {
  const db = { depara_vinculos: new Map(), app_settings: new Map() };
  const calls = [];
  const json = (status, body) => ({ ok: status < 400, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    calls.push(`${opts.method || 'GET'} ${u.pathname}${u.search}`);
    if (u.pathname === '/auth/v1/token') {
      const body = JSON.parse(opts.body);
      if (body.password !== 'certa') return json(400, { error_description: 'Invalid login credentials' });
      return json(200, { access_token: 'tok', refresh_token: 'ref', expires_in: 3600, user: { id: 'u1', email: body.email } });
    }
    if (opts.headers?.Authorization !== 'Bearer tok') return json(401, { message: 'JWT inválido' });
    const table = u.pathname.replace('/rest/v1/', '');
    const store = db[table];
    const pk = table === 'app_settings' ? 'key' : 'id';
    if (opts.method === 'GET') return json(200, [...store.values()]);
    if (opts.method === 'POST') {
      for (const r of JSON.parse(opts.body)) store.set(r[pk], { ...store.get(r[pk]), ...r });
      return json(201);
    }
    if (opts.method === 'DELETE') {
      const ids = decodeURIComponent(u.searchParams.get('id')).replace(/^in\.\(|\)$/g, '').split(',');
      ids.forEach((id) => store.delete(id));
      return json(204);
    }
    return json(405, { message: 'método' });
  };
  return { db, calls, fetchImpl };
}

const SEED = { todasBases: [], hospitais: [], motivos: [], motiveSlugMap: [], frases: ['Frase A'] };

test('nuvem: login errado mostra a mensagem do Supabase', async () => {
  const sb = fakeSupabase();
  const client = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: sb.fetchImpl });
  await assert.rejects(client.signIn('a@b.com', 'errada'), /E-mail ou senha incorretos/);
});

test('nuvem: sem login funciona só local; com login grava vínculos e configurações e outro navegador recebe', async () => {
  const sb = fakeSupabase();
  const mk = () => new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: sb.fetchImpl });

  // Navegador 1: sem login → local
  const statuses = [];
  const repo1 = new HybridRepository({ local: new MemoryRepository(SEED), seedData: SEED, client: mk(), onStatus: (s) => statuses.push(s.mode) });
  repo1.client.signOut();
  let cfg = await repo1.load();
  assert.equal(statuses.at(-1), 'local');

  // Login e cadastro de 2 CBS para o mesmo item + um feriado
  await repo1.client.signIn('ana@cbs.com', 'certa');
  cfg = await repo1.load();
  assert.equal(statuses.at(-1), 'cloud');
  cfg.customDePara.push({ codCliente: '113', codItem: '836661', codCBS: '005958', mult: 1 });
  cfg.customDePara.push({ codCliente: '113', codItem: '836661', codCBS: '000445', mult: 1 });
  cfg.holidays = ['2026-11-20'];
  cfg = await repo1.save(cfg);
  assert.equal(sb.db.depara_vinculos.size, 2);
  assert.deepEqual(sb.db.app_settings.get('holidays').value, ['2026-11-20']);
  assert.ok(cfg.customDePara.every((d) => d.id), 'vínculos recebem id');

  // Salvar de novo sem mudanças não reenvia nada
  const before = sb.calls.length;
  await repo1.save(cfg);
  assert.equal(sb.calls.length, before);

  // Navegador 2 enxerga os mesmos dados
  const repo2 = new HybridRepository({ local: new MemoryRepository(SEED), seedData: SEED, client: mk() });
  const cfg2 = await repo2.load();
  assert.deepEqual(cfg2.customDePara.map((d) => d.codCBS).sort(), ['000445', '005958']);
  assert.deepEqual(cfg2.holidays, ['2026-11-20']);

  // Remover um vínculo no navegador 2 apaga só ele na nuvem
  cfg2.customDePara = cfg2.customDePara.filter((d) => d.codCBS !== '005958');
  await repo2.save(cfg2);
  assert.deepEqual([...sb.db.depara_vinculos.values()].map((r) => r.cod_cbs), ['000445']);
});

test('nuvem: "enviar dados deste navegador" sobe só o que falta', async () => {
  const sb = fakeSupabase();
  const local = new MemoryRepository(SEED);
  const localCfg = await local.load();
  localCfg.customDePara = [
    { id: 'a', codCliente: '', codItem: '1', codCBS: '000001', mult: 1 },
    { id: 'b', codCliente: '', codItem: '2', codCBS: '000002', mult: 1 }
  ];
  await local.save(localCfg);
  sb.db.depara_vinculos.set('z', { id: 'z', cod_cliente: '', cod_item: '1', cod_cbs: '000001', mult: 1 });

  const client = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: sb.fetchImpl });
  await client.signIn('ana@cbs.com', 'certa');
  const repo = new HybridRepository({ local, seedData: SEED, client });
  const r = await repo.uploadLocal();
  assert.equal(r.vinculos, 1);
  assert.equal(sb.db.depara_vinculos.size, 2);
});

test('nuvem: falha de rede não perde o dado (fica salvo localmente) e avisa', async () => {
  const sb = fakeSupabase();
  const client = new SupabaseClient({ url: 'https://x.supabase.co', anonKey: 'anon', fetchImpl: sb.fetchImpl });
  await client.signIn('ana@cbs.com', 'certa');
  const local = new MemoryRepository(SEED);
  const statuses = [];
  const repo = new HybridRepository({ local, seedData: SEED, client, onStatus: (s) => statuses.push(s) });
  const cfg = await repo.load();
  client.fetch = async () => {
    throw new Error('Failed to fetch');
  };
  cfg.customDePara.push({ codItem: '9', codCBS: '000009', mult: 1 });
  await repo.save(cfg);
  assert.equal((await local.load()).customDePara.length, 1);
  assert.equal(statuses.at(-1).mode, 'error');
});

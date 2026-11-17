# GTplan Follow-up Studio

Aplicação web client-side (HTML, CSS e JavaScript puro) para triagem, cruzamento e resposta de follow-up no novo layout de **24 colunas** do portal GTplan (multi-cliente: Amil, Dasa, etc.), substituindo o fluxo legado em Excel/VBA (`importador_gtplan.xlsm` + macros).

## Funcionalidades

- **Ingestão Drag & Drop em memória:** lê o CSV novo do GTplan (24 colunas) e a planilha `bimestreamil.xlsx` diretamente no navegador (leitor XLSX seletivo zero-dependência para `Dados Simplificados`, `AjusteRemessa`, `SemContrato`, `LojasNoGtplan` e `leadtime`).
- **Cruzamento multi-cliente:**
  - De-Para de itens em cascata (`customDePara` por cliente → `todasBases` → fallback de CBS de 6 dígitos).
  - Busca de OC no TOTVS priorizando `Núm. OC` → `Cód. OC Externo` (ignorando `0`/vazio) → tokens numéricos em `Msg. Nota`.
  - Validação de caixaria (múltiplo), divergência de valor (`> 3%`), itens Spot (`SemContrato`), ajuste de remessa e cálculo de dias úteis com feriados e exceções configuráveis por cliente/estabelecimento.
- **Triagem visual e edição não-rígida:**
  - Cards de filtro (`Total`, `Prontas / Alteradas`, `Sem Motivo`, `Sem De-Para`, `Divergências`, `Motivos p/ Revisar`, `Sem Alteração`).
  - Campo **Observação** totalmente editável (texto livre + inserção rápida de `dd/mm:` + popover de Frases Padrão).
  - Seletor pesquisável de **Motivo** filtrado dinamicamente pelo `Cód. Cliente` da linha, com sugestão semântica e matriz de revisão.
- **Exportação segura em lotes:** gera CSVs no layout exato de 24 colunas (`UTF-8 BOM`, `;`, `ID Ordem` com `'`, nome sem acentos/`ç`) fatiando automaticamente em arquivos de até **1.000 linhas**.

## Como executar

- **Modo offline (arquivo único):** abra `dist/gtplan-followup.html` diretamente no navegador.
- **Servidor local:** execute `start.bat` (ou `node server.mjs`) e acesse `http://127.0.0.1:4173/`.
- **Gerar bundle após alterações em `src/`:** `node build.mjs`
- **Rodar testes automatizados:** `node --test tests/engine.test.mjs`

## Vincular mais de um código CBS a um item

Quando uma linha fica **Sem Motivo** porque o TOTVS faturou a OC com outro código (produto substituto),
a coluna **CBS** mostra um botão `+ CBS` (verde com o código sugerido quando há um provável).
O popover lista o que o TOTVS tem naquela mesma OC e ainda não cruzou com nenhuma linha do CSV,
do mais parecido para o menos parecido. Um clique em **Vincular** salva o vínculo (por padrão só para aquele cliente)
e recalcula o lote. Também é possível digitar vários códigos separados por vírgula, aqui ou em
*Configurações → Vínculos de itens e frases*.

## Onde os dados ficam salvos

- **Sem nuvem (padrão):** vínculos, motivos revisados, frases, feriados e prazos ficam no IndexedDB do navegador.
  Somem se os dados do navegador forem limpos; use *Atualizar bases e backup → Baixar backup*.
- **Com nuvem (Supabase):** rode `supabase/schema.sql` no SQL Editor do projeto, desligue o cadastro aberto,
  crie os usuários da equipe e entre em *Configurações → Nuvem (equipe)* com a URL e a anon key.
  O projeto da CBS já vem configurado em `DEFAULT_CLOUD` (só é preciso o login). Para trocar de projeto, edite
  `src/storage/cloudRepository.js` e rode `node build.mjs`. A anon key é pública por design;
  quem protege os dados é o Row Level Security (só usuários logados).
  Os arquivos CSV e a planilha TOTVS nunca saem do navegador.

## Publicar no GitHub Pages

O app é um arquivo estático, então funciona no GitHub Pages. Em *Settings → Pages* escolha **GitHub Actions**
e rode manualmente o workflow **Publicar no GitHub Pages** (`.github/workflows/pages.yml`).
Atenção: o site publicado é público e leva junto as bases embutidas (`src/data/seedData.*`).

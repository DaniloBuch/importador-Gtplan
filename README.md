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

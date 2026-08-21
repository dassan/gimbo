# Performance — lentidão ao salvar transação (Firefox v154)

> Achado durante testes exploratórios de ajustes finos de interface (branch
> `dassan/visual-adjustments`), não relacionado às mudanças visuais dessa sessão. Documentado
> aqui à parte para não misturar os dois assuntos. Arquivo fora do controle de versão
> (`data/` está no `.gitignore`) — propositalmente, para não competir com o trabalho de UI em
> andamento.

> **Atualizado em 2026-08-20 (branch `dassan/monitoring-harness`):** o diagnóstico original
> abaixo (duas clonagens síncronas de `structuredClone`) foi **medido de verdade** com a camada
> de instrumentação criada nesta sessão (`M-71`, `plan/MONITORING.md`) e **descartado como causa
> principal** — as duas clonagens são rápidas (~163ms somadas). A causa real, confirmada por
> medição com o cofre real do usuário e validada num benchmark sintético reproduzível, está na
> seção "Medição real (2026-08-20)" abaixo. As seções originais ficam preservadas como registro
> do raciocínio inicial (só leitura de código, sem medição) — não apagadas, porque o processo de
> chegar à causa errada primeiro é parte útil do histórico.

## Sintoma relatado

Usuário atualizou o Firefox para a v154 e notou lentidão grande no Gimbo: adicionar uma nova
transação levou mais de 20 segundos.

Detalhamento coletado (perguntas de diagnóstico → respostas do usuário):

1. **A aba trava por completo** — ao clicar em salvar, o painel (`TransactionDrawer`) só some
   da tela depois de +20s. Não é só a lista/indicador de sync demorando a atualizar; é a UI
   inteira sem responder.
2. **Só reproduz no cofre real**, que é bem maior que um cofre recém-criado. Não reproduz em
   cofres pequenos/Modo Demonstração.
3. **No Chrome, com o mesmo cofre real, é mais rápido** (menos de 2s), mas ainda perceptível —
   ou seja, o problema existe nos dois browsers, só que o Firefox é ~10-15x pior.
4. **Sinal mais estranho**: a página "carrega" (rede/bundle/shell) em menos de 2s, mas o
   conteúdo só fica visível de novo quase 30s depois — indício de tarefa síncrona longa
   travando a thread principal *depois* do carregamento normal, não um problema de rede.

## Diagnóstico (via leitura de código, sem instrumentação ainda) — ⚠️ descartado como causa principal, ver medição real abaixo

### Cadeia de chamadas do "Salvar"

`TransactionDrawer.handleSave()` (`app/src/components/TransactionDrawer.tsx:258-315`) é
**100% síncrono**: chama `addTransaction(payload)` (ou `updateTransaction`) e, na sequência
imediata (linha 314), `onClose()`. Não existe `await` entre os dois. Logo, se o painel demora
para sumir, algo síncrono dentro dessa cadeia está bloqueando a thread principal.

### Dois pontos de `structuredClone` do cofre inteiro, por mutação

1. **`mutate()`** — `app/src/store/useDataStore.ts:924-938`, especificamente a linha:
   ```ts
   const data = structuredClone(state.data)
   ```
   Roda **na hora do clique**, antes de `fn(data)` aplicar a mudança e antes de `onClose()`.
   Clona o `DataFile` inteiro — todas as transações, categorias, tags, budgets, audit log, anos
   de histórico — para editar/adicionar **uma única transação**. Toda action do
   `useDataStore` (~15 actions: `addTransaction`, `updateTransaction`, `deleteTransaction`,
   etc.) passa por essa mesma função.

2. **`postMessage` para o Worker** — `app/src/services/storage/StorageService.ts:98-108`
   (`call<T>()`), chamado por `replaceAll()` (linha 664-665) dentro de
   `debouncedReplaceAll()` (`useDataStore.ts:79-85`, dispara 300ms depois da mutação). O
   `data` é passado como argumento comum ao `postMessage`, **sem** `transfer` (o array de
   `Transferable[]` fica vazio por padrão). `postMessage` de um objeto não-transferível roda o
   algoritmo de structured clone do lado de quem envia — ou seja, **o cofre inteiro é clonado
   de novo**, também de forma síncrona na thread principal, mesmo que a escrita real no SQLite
   aconteça no Worker.

Resultado: **duas clonagens completas do cofre por edição**, ambas bloqueantes.

### Por que isso explica as 4 pistas

- **Trava total (pista 1):** `structuredClone` é síncrono — o browser não consegue pintar tela
  nem responder a input enquanto ele roda. `onClose()` só executa depois que a clonagem de
  `mutate()` termina, daí o painel "preso" na tela.
- **Só com cofre real (pista 2):** o custo é O(tamanho do grafo de objetos). Um cofre pequeno
  clona quase instantaneamente nos dois browsers.
- **Chrome mais rápido mas perceptível (pista 3):** o V8 (Chrome) é historicamente bem mais
  otimizado que o SpiderMonkey (Firefox) para `structuredClone`/serialização de objetos
  grandes e heterogêneos — mesmo gargalo, constantes de tempo muito diferentes entre motores.
  Bate com a hipótese de que o problema **sempre existiu** em algum grau (por isso "ainda
  perceptível" no Chrome) e a v154 do Firefox só piorou a constante, tornando-o gritante.
- **"Carregou" rápido, conteúdo só depois de 30s (pista 4):** o carregamento de
  página/bundle/shell é normal e rápido; os ~30s são as duas clonagens síncronas (a de
  `mutate()` na hora do clique + a do `postMessage` do Worker, ~300ms depois) segurando a
  thread principal sem repintar nada nesse meio-tempo.

## Não investigado / não confirmado ainda (estado original, anterior à medição — ver abaixo)

- ~~Nenhuma medição real foi feita~~ — feita em 2026-08-20, ver seção seguinte.
- Tamanho exato do cofre real (nº de transações) **continua não informado** pelo usuário — só
  que é "bem maior" que um cofre inicial. O benchmark sintético (abaixo) testou até 40 mil
  transações sem atingir a magnitude observada no cofre real (~55s) — o cofre real
  provavelmente é maior que isso, ou tem mais tags/caixinhas por lançamento do que o sintético
  simulou (1-3 tags, 0-2 caixinhas por transação).
- ~~Não foi confirmado qual dos dois pontos de clonagem pesa mais~~ — pergunta obsoleta: **nenhum
  dos dois pesa** (ver medição real).
- ~~VFS do SQLite... descartada como causa principal~~ — **essa descartada estava errada.** A VFS
  assíncrona (`OriginPrivateFileSystemVFS`) de fato não bloqueia a thread principal (a lógica
  original estava certa nisso), mas o raciocínio parou aí — nunca avaliou se ela deixa o
  **worker** lento para uma query que precisa tocar muitas páginas (`GROUP BY`/`ORDER BY`/sort
  temporário). É exatamente isso que a medição real confirmou.

## Medição real (2026-08-20) — camada de instrumentação (M-71, `plan/MONITORING.md`)

Nesta sessão foi construída uma camada de instrumentação dev-only (`lib/perfMonitor.ts`,
`components/PerfPanel.tsx`, atalho `Alt+Shift+P` — ver `plan/MONITORING.md`) especificamente
para poder finalmente medir este bug em vez de só ler código. Processo, na ordem real:

### Captura 1 — descartada (artefato de medição)

Primeira captura, durante uma interação de salvar transação, mostrou um "buraco" de ~48s em
várias `worker.query`. Hipótese inicial: aba em segundo plano (o Firefox pode suspender
timers/worker quando a janela perde foco). Não confirmada nem descartada nessa rodada.

### Captura 2 — reload de `/dashboard`, aba sempre em primeiro plano

Usuário confirmou que o Firefox ficou em primeiro plano o tempo todo e reproduziu um padrão
quase idêntico (~48-53s) só com um `reload()` de `/dashboard` — **sem nenhuma ação de salvar
envolvida**. Isso já apontava para a hidratação inicial dos dados, não para o fluxo de salvar
especificamente, e descartava definitivamente a hipótese de aba em segundo plano.

Reconstruindo o horário de início de cada `worker.query` (`ts − ms`), todas as entradas lentas
começaram quase juntas, na mesma janela em que uma rajada de ~15 `storage.postMessage.query`
(baratas, 0-1ms) foi disparada — assinatura de **uma única query travando a fila serial do
worker** (`_queue` em `worker.ts`, encadeada via `.then()`), com tudo enfileirado atrás dela
esperando.

### Captura 3 — com o SQL no rótulo da métrica

`worker.ts` foi ajustado para incluir os primeiros 60 caracteres do SQL no nome da métrica
(`worker.query:<sql>` em vez de só `worker.query`). Nova captura confirmou o suspeito:

```
worker.query:SELECT t.*, GROUP_CONCAT(DISTINCT tt.tag_id) AS tag_ids,   → 55.737ms
worker.query:SELECT id, account_id, date, market_value FROM valuations → 55.992ms (fila atrás)
worker.query:SELECT * FROM audit_log ORDER BY timestamp ASC            → 55.998ms (fila atrás)
worker.query:SELECT id FROM deleted_ids                                → 56.001ms (fila atrás)
worker.query:SELECT id, name, start_date, end_date FROM saved_periods  → 56.005ms (fila atrás)
worker.query:SELECT * FROM budgets ORDER BY created_at                 → 56.010ms (fila atrás)
```

É `StorageService.getTransactions()` (`app/src/services/storage/StorageService.ts:341-384`),
chamada **sem filtro** na hidratação inicial do `useDataStore` — busca a tabela `transactions`
inteira, com dois `LEFT JOIN` (`transaction_tags`, `transaction_budgets`) + `GROUP_CONCAT(DISTINCT
...)` dos dois + `GROUP BY t.id` + `ORDER BY t.date DESC, t.created_at DESC`. `GROUP BY` e
`ORDER BY` usam chaves diferentes — o SQLite provavelmente precisa de uma b-tree temporária para
o agrupamento e um sort separado para a ordenação.

Ao mesmo tempo, `store.mutate.clone` (118ms) + `store.mutate.apply` (0ms) +
`storage.postMessage.replaceAll` (45ms) — os dois pontos do diagnóstico original — somam
**~163ms**. Não é o gargalo.

### Validação sintética (benchmark Playwright, descartável, não versionado)

Para confirmar a causa sem depender do cofre real do usuário: cofre sintético (mesma forma —
1-3 tags e 0-2 caixinhas por transação) em tamanhos crescentes, medindo `getTransactions()` via
`window.__storage` (exposto em DEV, mesmo padrão do `__storage`/`__secretStore` do SEC-04/06),
antes e depois de `PRAGMA temp_store = MEMORY` (nunca configurado em `worker.ts` — só
`journal_mode=WAL` está lá):

| N transações | Chromium, antes | Chromium, `temp_store=MEMORY` | Ganho |
|---|---|---|---|
| 5.000 | 382ms | 175ms | 2,2x |
| 10.000 | 2.622ms | 2.116ms | 1,2x |
| 20.000 | 4.608ms | 4.279ms | 1,1x |
| 40.000 | 9.104ms | 6.064ms | 1,5x |

`PRAGMA temp_store = MEMORY` ajuda de verdade, mas o ganho **encolhe** conforme o cofre cresce
— não é a correção completa sozinha. O salto de 5k→10k (2x os dados, 6,9x o tempo) sugere que a
query cruza algum limite (provavelmente o `cache_size` padrão do SQLite) a partir do qual passa
a espirrar página para fora do cache — e cada página extra vira uma operação assíncrona contra
o OPFS.

**O fator que faltava — o browser.** Mesmo teste (20.000 transações) no Firefox (binário
instalado via `npx playwright install firefox` só para este benchmark): **10.195ms** contra
4.608ms no Chromium do mesmo tamanho — **2,2x mais lento** — e o `replaceAll()` de seed, 4x mais
lento (30,4s vs. 7,6s). Mesma direção do gap já documentado no diagnóstico original para
`structuredClone`, agora confirmado também para execução de query real via a VFS assíncrona.

### Conclusão

`getTransactions()` sem filtro, chamada em toda hidratação inicial do app (não só ao salvar),
com um cofre real "bem maior" que os 40 mil sintéticos testados, rodando no Firefox — essa é a
combinação que produz os 48-56s medidos. Não é um bug pontual de uma query; é uma característica
estrutural: **o app carrega o histórico de lançamentos inteiro, sem paginação, toda vez que
inicia**, sobre uma VFS assíncrona cujo overhead por página é maior no Firefox que no Chromium.
`PRAGMA temp_store = MEMORY` ajuda (mais em cofres menores, menos em cofres grandes) mas não
resolve a característica estrutural sozinho.

## Drill-down no cofre real (2026-08-20) — isolando a variável

`PRAGMA temp_store = MEMORY` foi implementado e testado primeiro (ganho real no sintético, 1,1x
a 2,2x conforme o tamanho), mas contra o cofre real do usuário (**24.985 transações**, medido via
`SELECT COUNT(*)`) fez **diferença desprezível**: 52.788ms com o `PRAGMA`, contra ~55.737ms sem
— dentro da margem de ruído. Isso não batia com o sintético (40 mil linhas, Chromium, 9.1s) nem
com um teste em Firefox equivalente (20 mil linhas, 6.9s) — o cofre real, com **menos** linhas,
era **muito** mais lento. Duas hipóteses testadas e descartadas antes de achar a real:

1. **Inchaço/fragmentação do arquivo físico** — `PRAGMA page_count`/`freelist_count`/`page_size`
   no cofre real: **12MB total, 0,2% de páginas livres**. Arquivo pequeno e saudável — descartada.
2. **Fan-out de tags/caixinhas maior que o sintético** — `COUNT(*)` nas tabelas de junção:
   **24.985 transações, 3.728 vínculos de tag (0,15/transação), 0 vínculos de caixinha.** Fan-out
   real é **menor** que o sintético original (1-3 tags/transação) — descartada como causa de
   volume, mas acabou apontando para a causa certa (ver abaixo).

Isolando por partes, direto no console com `window.__storage.query()` (exposto em DEV) contra o
cofre real:

| Query | Tempo |
|---|---|
| `SELECT t.* FROM transactions t` (sem `ORDER BY`, sem `JOIN`) | 5.478ms |
| `SELECT t.* FROM transactions t ORDER BY t.date DESC` (1 coluna, bate com `idx_transactions_date`) | 5.772ms |
| `SELECT t.* FROM transactions t ORDER BY t.date DESC, t.created_at DESC` (2 colunas) | 20.037ms |
| + 1 `LEFT JOIN`/`GROUP BY t.id`/`GROUP_CONCAT(DISTINCT tag_id)` (fan-out quase nulo) | **244.109ms** |

`EXPLAIN QUERY PLAN` da query de 2 colunas: `SCAN t USING INDEX idx_transactions_date` +
`USE TEMP B-TREE FOR RIGHT PART OF ORDER BY` — o índice de uma coluna é usado para o scan, mas o
desempate de `created_at` dentro de cada dia exige uma b-tree temporária à parte. Isso explica os
+14s de (2) para (3), mas não o salto de +224s ao adicionar `GROUP BY`/`DISTINCT` — com fan-out
de 0,15 tag/transação, o volume de dado extra é desprezível. **Veredito:** o custo é do próprio
`GROUP BY t.id` + `GROUP_CONCAT(DISTINCT ...)` nesse ambiente (`wa-sqlite`/WASM sobre a VFS
assíncrona), proporcional ao **número de grupos** (25 mil, um por transação), não ao volume de
dado agregado — cada grupo parece carregar um custo fixo alto (≈9ms/grupo aqui), não os
microssegundos esperados de um SQLite nativo.

## Correção implementada (M-72, 2026-08-20)

1. **`StorageService.getTransactions()` reescrita** — sem `GROUP BY`/`GROUP_CONCAT(DISTINCT)`.
   Busca `transactions`, `transaction_tags` e `transaction_budgets` em paralelo (3 queries
   simples, sem `JOIN`) e junta tags/caixinhas em JS via `Map`. As tabelas de junção têm
   `PRIMARY KEY (transaction_id, tag_id/budget_id)` — nunca há duplicata, o `DISTINCT` original
   era redundante mesmo antes da reescrita.
2. **Índice composto `idx_transactions_date_created ON transactions(date DESC, created_at DESC)`**
   (`migrations/v13.sql`, `PRAGMA user_version` 12→13) — elimina a b-tree de desempate do
   `ORDER BY` de duas colunas.
3. `scripts/sync_gimbo.py` atualizado em paralelo (`SCHEMA_DDL` + `PRAGMA user_version = 13`) —
   a armadilha recorrente já documentada no `CLAUDE.md`.
4. `PRAGMA temp_store = MEMORY` mantido (ganho pequeno mas real, sem contraindicação).

**Resultado, medido de ponta a ponta com o painel `M-71` contra o cofre real do usuário:**
`worker.query:SELECT t.* FROM transactions t ORDER BY ...` caiu de **52-55s para 3,4s** (~15-16x).
Sintético (25k transações, fan-out baixo como o real): Chromium 1.303ms, Firefox 3.087ms — mesma
ordem de grandeza da medição real. `store.mutate.clone`/`apply`/`storage.postMessage.replaceAll`
confirmados rápidos na mesma captura (94+0+30ms), fechando de vez a suspeita original sobre as
duas clonagens.

**Padrão de "hidratação roda duas vezes" nas capturas**: `<StrictMode>` (`main.tsx`) monta/
desmonta efeitos de propósito, **só em desenvolvimento** — não afeta usuários em produção.

Ver `M-72` em `plan/BACKLOG.md` para o changelog completo (arquivos, testes, validação).

## Status: resolvido (2026-08-20)

Este arquivo permanece fora do controle de versão por decisão original — o registro definitivo
da correção está em `plan/BACKLOG.md` (`M-72`) e no commit correspondente. Se uma lentidão
parecida reaparecer no futuro (outra query com `GROUP BY`/`DISTINCT` grande, por exemplo), o
padrão de investigação aqui — isolar variável por variável direto no console com
`window.__storage.query()`, cofre real em mãos — é reaproveitável.

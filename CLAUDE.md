# Gimbo — CLAUDE.md

> Instruções permanentes para qualquer IA que trabalhe neste projeto.
> Leia este arquivo integralmente antes de propor ou implementar qualquer coisa.
> Em caso de conflito entre este arquivo e instruções verbais da sessão, questione antes de agir.

---

## Identidade do Projeto

**Gimbo** — app web de finanças pessoais **local-first**, instalável como PWA.
Toda a informação reside em um banco **SQLite** (`gimbo.db`, via `wa-sqlite` + OPFS) no próprio
browser do usuário, exportável como arquivo `.db` que ele controla — sem servidor, sem nuvem.
Workflow de desenvolvimento IA + humano definido em `plan/RULES.md`.

> A camada `data.json` + File System Access API foi **substituída** por SQLite/OPFS em
> 2026-05-26 (ver `plan/STORAGE.md`). Referências a `data.json` em documentos antigos são
> históricas — o formato canônico atual é o `.db`.

---

## Documentação Técnica

| Documento | Caminho | Conteúdo |
|-----------|---------|---------|
| Arquitetura | `plan/ARCHITECTURE.md` | Stack, estrutura de diretórios, modelo de dados, APIs, fluxos de persistência, testes |
| Requisitos de produto | `plan/PRD.md` | Features F-1 a F-30, critérios de aceite |
| Backlog | `plan/BACKLOG.md` | Bugs (B-XX), melhorias (M-XX), cartão (CC-XX), relatórios (R-XX), backup (BK-XX), sync (CS-XX), segurança (SEC-XX) |
| Especificação técnica | `plan/SPEC.md` | Tasks de implementação por fase (TASK-XX); Fase 16 = sync multi-dispositivo |
| Cartão de crédito | `plan/CREDIT_CARD.md` | Decisões de produto e desafios técnicos do módulo CC |
| Cenários de sync | `plan/SYNC_SCENARIOS.md` | 20 cenários: SQLite atual (S-01..07), multi-desktop por pasta (S-16..20), nuvem (S-08..15) |
| Brainstorm de sync | `plan/FABLE-BRAINSTORM.md` | Análise das 7 alternativas de sync multi-dispositivo, matriz de trade-offs, roadmap faseado e decisões |
| Histórico de storage | `plan/STORAGE.md` | Decisão e migração JSON/FSA → SQLite/OPFS |
| Telemetria e bug report | `plan/METRICS.md` | Decisões de privacidade, arquitetura do F-26 (Bug Report System), tasks TASK-BR-01 a BR-08 |
| Monitoramento de performance | `plan/MONITORING.md` | Camada dev-only de instrumentação (`lib/perfMonitor.ts`, `PerfPanel`), pontos instrumentados, por que não Prometheus/Grafana (M-71) |
| Relatórios avançados | `plan/REPORTS.md` | Épico do módulo analítico (5 views) |
| Saúde Financeira | `plan/FINANCIAL_HEALTH.md` | Decisões de produto/design da tela `/health` (F-29), conceitos, fórmulas e pontos em aberto |
| Caixinhas (budgets) | `plan/BUDGETS.md` | Decisões de produto/UX de `/budgets` (F-30, implementada — BX-01 a BX-11) |
| Sistema de design | `design/DESIGN.md` | Cores, tipografia, espaçamento, sombras, componentes (fonte única) |
| Workflow | `plan/RULES.md` | SDLC, cerimônias, divisão de responsabilidades |

---

## Padrões Críticos

### Parsing de datas — `parseDateLocal()`
Toda comparação de `tx.date` com mês/ano deve usar `parseDateLocal()` de `@/lib/utils`.
Nunca `new Date(tx.date)` para `.getMonth()`/`.getFullYear()` — causa bugs de fuso UTC.

### Saldo de conta — derivado de transações
O campo `Account.balance` representa o **saldo inicial** (editável no modal). O saldo exibido é
`balance + INCOME − EXPENSE − TRANSFER − CREDIT_PAYMENT` (o pagamento debita a conta pagadora via
`transferAccountId` — vale em Dashboard, Settings, Lançamentos **e** NetWorth/`applyTx`). Contas CREDIT
exibem **limite disponível** = `creditMetadata.limit − getOpenCreditBalance()`. Nunca exibir `acc.balance` diretamente.

### Motor de fatura virtual (B-16, Opção 2)
Funções puras em `lib/utils.ts`: `getInvoicePeriod`, `getInvoiceDueDate`, `getEffectiveCashFlowDate`,
`getInvoiceTotal` (charges − créditos do período), `getInvoicePaid` (Σ `CREDIT_PAYMENT` com
`referenceMonth` == período), `getInvoiceStatus` (aberta/parcial/paga), `getOpenCreditBalance`
(**fatura atual em aberto** = total do período corrente − pagamentos do período; base do limite
disponível e do passivo), `getCurrentInvoiceBalance` (fatura corrente, líquida), `getTotalCreditLiability`
(= open balance), `isCardCredit` (estorno = INCOME em conta CREDIT). Regras: `getEffectiveCashFlowDate`
só no gráfico de fluxo de caixa; categorias usam `tx.date`; `CREDIT_PAYMENT` excluído de Receitas×Despesas;
estornos abatem despesas (nunca contam como receita de caixa). **Escopo do passivo/limite = fatura atual**
(passado tratado como quitado; futuro excluído) — robusto a históricos longos e a snapshots com meses
de lançamentos futuros, onde "atual+futuras" estourava o limite.

### Tradução de tipos de conta
Sempre `t(\`accounts.${type.toLowerCase()}\`)`. Nunca exibir enum bruto.

### Caminhos de persistência (SQLite/OPFS)

> Corrigido em 2026-07-24: as funções `importFileToIdb()`/`syncToFile()` descritas aqui
> anteriormente **não existem mais no código** — pertenciam à camada IndexedDB/FSA removida em
> 2026-05-26. Os caminhos reais são:

> **Revisado em 2026-08-21 (M-73):** `replaceAll()` reescrevia a tabela `transactions` inteira —
> `DELETE`+`INSERT` linha a linha — em **toda** mutação, mesmo pra editar um campo. Pra um cofre
> real de ~25 mil transações isso chegava a ~1 minuto por salvamento (`plan/PERFORMANCE.md`,
> fora do controle de versão). `mutate()` agora chama `storage.applyMutation(data, delta)` via
> `debouncedApplyMutation()` — `delta` é o diff de transações (`lib/storage/transactionDiff.ts`)
> entre a última escrita bem-sucedida (`_lastPersisted`) e o estado atual; só as linhas que de
> fato mudaram viram `INSERT`/`UPDATE`/`DELETE`, em lotes multi-linha. `replaceAll()` continua
> existindo (import, restauração de backup, merge de sync) — o que mudou foi só deixar de ser o
> caminho comum de toda mutação.

| Caminho | Função | Quando |
|---------|--------|--------|
| Mutação normal | `storage.applyMutation(data, delta)` | Toda mutação, via `debouncedApplyMutation()` (300ms) dentro de `mutate()` — só as transações que mudaram (M-73); tabelas pequenas continuam reescritas por inteiro |
| Import de backup | `storage.importBlob(blob)` | Onboarding/Settings — **replace total**: fecha o DB, escreve os bytes no OPFS, reabre e roda `runMigrations()` |
| Export / backup | `storage.exportBlob()` | Botão "Exportar" e backup automático em pasta (WAL checkpoint antes de ler) |
| Backup em pasta | `writeBackupToDir(handle, blob)` | Após `applyMutation()`/`replaceAll()`, se houver pasta configurada (`lib/backupDir.ts`) |
| Merge de sync | `storage.replaceAll(merged)` | `lib/cloudSync/{syncService,folderSyncService}.ts` — direto, fora de `mutate()`. Exceção reconhecida: o resultado de um merge pode tocar uma fração não-limitada de entidades, o diff degradaria pro custo de reescrita total mesmo, e testar um caminho novo no fluxo de maior risco (merge multi-dispositivo) não valia — decisão registrada no M-73 |

**Nunca misturar os caminhos:** `importBlob()` é replace destrutivo e nunca deve ser usado num
fluxo recorrente; `replaceAll()`/`applyMutation()` nunca devem ser chamados fora de
`mutate()`/`debouncedApplyMutation()`, com a única exceção reconhecida do merge de sync acima.
Falha de backup em pasta jamais interrompe o fluxo principal.

---

## Convenções de Código

### TypeScript
- **Strict mode**: `noUnusedLocals`, `noUnusedParameters`, `noImplicitAny`
- Type imports: `import type { DataFile } from '@/types'`
- Alias `@/` para `src/`
- Enums como union types de string

### Formatação
- Prettier: 100 chars, sem ponto-e-vírgula, aspas simples, trailing commas, 2 espaços

### Componentes
- Funcionais com hooks, `useMemo` para dados derivados pesados
- Interface de props exportada acima do componente

### Nomenclatura
- Componentes: PascalCase | Páginas: `index.tsx` em pasta | Stores: `use` + PascalCase
- Testes: `*.test.ts` (unit), `*.spec.ts` (E2E) | Constantes: UPPER_SNAKE_CASE
- Handlers: `handle` prefix | Privados de módulo: `_` prefix

---

## Git

```
<tipo>: <descrição imperativa em minúsculas>
```

Tipos: `feat:` | `fix:` | `test:` | `style:` | `refactor:` | `docs:` | `chore:`
Referência obrigatória ao ID (M-XX, B-XX, CC-XX, R-XX, BK-XX, HE-XX, CS-XX, MB-XX, SEC-XX) quando aplicável.
CI verde obrigatório. Nenhum `TODO` no código.

### Branch por tópico (revisado em 2026-08-19)

**Uma branch por tópico**, não por feature — `dassan/<tópico>` (ex.: `dassan/security-audit`,
`dassan/landing-page`, `dassan/sync-mobile`). Um tópico agrupa todo um esforço relacionado e pode
acumular vários itens do backlog antes de virar PR; a branch só fecha quando o tópico fecha.

**Um item por commit continua valendo.** É o commit que carrega o ID (`SEC-03`, `MB-08`…) e o
"porquê" — a granularidade que dá rollback e leitura de histórico. O que mudou foi só o escopo da
branch, não o do commit.

> A regra anterior era "uma feature por commit/PR". Foi revisada porque, nesta fase de construção
> da aplicação, features isoladas raramente descrevem bem o trabalho real: um tópico como segurança
> ou responsividade mobile rende uma série de itens pequenos e interdependentes, que revisar juntos
> é mais barato do que abrir uma PR por item. Reavaliar quando o app estabilizar e as mudanças
> passarem a ser majoritariamente incrementais.

---

## Scripts de Qualidade

```bash
cd app && npm run format:check
cd app && npm run lint
cd app && npx tsc -b --noEmit
cd app && npx vitest run --coverage
cd app && npx playwright test      # opcional local, obrigatório no CI
```

---

## Restrições — O Que NUNCA Fazer

### Código
- **Nunca** usar `as SomeType` para contornar validação Zod
- **Nunca** mutar estado Zustand diretamente — sempre via `mutate()`
- **Nunca** chamar `storage.replaceAll()`/`storage.applyMutation()` fora de `mutate()`/`debouncedApplyMutation()` — exceção reconhecida: merge de sync (`lib/cloudSync/{syncService,folderSyncService}.ts`) chama `replaceAll()` direto, decisão registrada no M-73
- **Nunca** chamar `storage.importBlob()` em fluxo recorrente — é replace destrutivo (só import/onboarding)
- **Nunca** exibir `acc.balance` diretamente — o saldo é derivado das transações
- **Nunca** usar `new Date(tx.date)` para extrair mês/ano — sempre `parseDateLocal()`
- **Nunca** deixar falha de backup em pasta interromper o fluxo principal
- **Nunca** adicionar `TODO` no código — vai para `BACKLOG.md`
- **Nunca** usar `console.log` em produção
- **Nunca** disparar mais de uma chamada `wa-sqlite` concorrente (`Promise.all`/afins) contra o mesmo `dbPtr` direto dentro do worker (`services/storage/worker.ts`), fora da fila `enqueue()` — o build usado (`wa-sqlite-async`) é Asyncify e só suporta **uma chamada em voo por vez**; duas em paralelo corrompem o módulo WASM inteiro (`RuntimeError: unreachable executed`, irrecuperável sem reload). `StorageService.ts` pode usar `Promise.all` porque cada chamada passa por `postMessage`/`enqueue()` e é serializada antes de chegar no wasm; código que já roda **dentro** de uma task do worker (ex.: `readDataFileFromDb`) tem que ser sequencial (`await` um de cada vez). Causou o `CS-28` (2026-08-25) — crash real ao importar, introduzido pelo próprio `CS-26`.

### Testes
- **Nunca** substituir mock de FSA dos testes E2E por mocks em memória
- **Nunca** pular testes com `skip` sem registrar no BACKLOG

### Git/CI
- **Nunca** merge com CI vermelho
- **Nunca** `--no-verify` para pular hooks
- **Nunca** commits genéricos (`fix`, `ajuste`, `wip`)

### Dependências
- Não adicionar sem justificativa explícita
- Verificar `npm audit` a cada 3–5 features

---

## Início de Sessão — Checklist

1. Ler este arquivo (`CLAUDE.md`) integralmente
2. Ler `plan/BACKLOG.md` para estado atual de bugs e melhorias
3. Ler `plan/PRD.md` se a tarefa envolver produto/features novas
4. Ler `plan/ARCHITECTURE.md` se a tarefa envolver arquitetura/persistência/sync
5. Se a tarefa for do épico **CS (sync multi-dispositivo)**: ler também `plan/SPEC.md` (Fase 16),
   `plan/SYNC_SCENARIOS.md` e `plan/FABLE-BRAINSTORM.md` — as decisões já foram tomadas, não
   reabrir o leque de alternativas sem motivo novo
6. Ler os arquivos-fonte relevantes **antes** de propor mudanças
7. Confirmar escopo da sessão com o humano (1–3 itens, no máximo)

---

## Princípios do Workflow

1. **O CI é o árbitro** — se passa no pipeline, está pronto
2. **IA propõe, humano decide** — nunca o contrário
3. **Documentação ativa** — `BACKLOG.md` e `PRD.md` atualizados a cada ciclo
4. **CI falhou? Sessão para.** Não acumula dívida de pipeline
5. **Fim de sessão:** commit descritivo → `BACKLOG.md` atualizado → push

---

## Estado Atual (2026-08-22)

**Schema em memória v17** | **Schema físico SQLite v13** (`migrations/v1..v13.sql`) | Cobertura: ~96% statements
**890 testes unitários** (35 arquivos) + **84 testes E2E** (11 specs, perfis `chromium` e `mobile-chrome`)

> Os dois números de schema são independentes e **não coincidem**: `CURRENT_SCHEMA_VERSION` (v17,
> em `lib/storage/schema.ts`) versiona o `DataFile` em memória; `PRAGMA user_version` (v13)
> versiona o DDL físico. Bumps de campos opcionais não exigem DDL novo — por isso o schema em
> memória está à frente. Os bumps mais recentes vieram de F-30/Caixinhas: v14→v15 (entidade
> `Budget` + `Transaction.budgetIds`, `BX-03`, DDL novo em `migrations/v11.sql`) e v15→v16→v17
> (`Settings.quadrantesEnabled` + `Budget.createdAt`, `BX-07`/`BX-06`, DDL novo em
> `migrations/v12.sql`). `v12→v13` (M-72, 2026-08-20): só índice físico novo
> (`idx_transactions_date_created`), sem campo novo no `DataFile` — `CURRENT_SCHEMA_VERSION` não
> muda.

Todas as features do PRD (F-1 a F-30, com F-28 no Nível 1) implementadas. Módulo de Cartão de Crédito completo (CC-01 a CC-34 — CC-34 resolvido junto do M-64, via `created_at` do Organizze como chave de agrupamento). Melhorias M-01 a M-64 resolvidas (M-61 resolvido em 2026-08-18 — ver nota abaixo); M-65 registrado como futuro. Relatórios avançados R-01 a R-18 resolvidos.

Features concluídas desde 2026-05-27:
- **F-24** — Patrimônio Líquido: `/net-worth`, stat cards, breakdown por conta (NW-01 a NW-07). **Sem gráfico de evolução histórica** — apesar do que versões antigas desta nota diziam, nenhum `AreaChart`/série temporal existe no código; é exatamente o que `M-63b` (aberto, abaixo) pretende adicionar.
- **F-25** — Demo Mode: `lib/demo.ts`, dados sintéticos, banner, deploy público (DM-01 a DM-05; originalmente Vercel, migrado para **Cloudflare Pages** — ver nota abaixo)
- **F-26** — Bug Report System: `lib/telemetry.ts`, `BugReportDialog`, ErrorBoundary, Settings (TASK-BR-01 a BR-08)
- **F-27** — Mobile PWA: bottom nav, layouts responsivos, bottom sheet, manifest standalone, E2E mobile (MB-01 a MB-07). Bottom nav mobile atual: Dashboard, Lançamentos, Caixinhas e Relatórios (Configurações mudou para um menu no pill do nome do cofre, `MB-16`/`MB-17`). Analytics no mobile só tem a aba Categorias responsiva por ora (`MB-18`, parcial — ver `MB-08` abaixo).
- **F-28 Nível 1** — Backup Local: `lib/backupDir.ts`, aba "Backup & Sync", auto-backup, `WelcomeModal`, doc pages, sync manual (BK-01 a BK-03, BK-05 a BK-08; BK-04 aberto — banner de re-permissão)
- **F-29** — Saúde Financeira: tela `/health` **completa**, incluindo Reserva de Emergência (HE-01 a HE-16 resolvidos: entidade `LOAN`, motor de dívida total/comprometido/horizonte, renda híbrida com override editável, custo mensal médio, saldo de reserva por conta marcada, meta em meses configurável, detalhamento expansível real por cartão/`LOAN`/empréstimo em conta comum). Ver `plan/FINANCIAL_HEALTH.md` §6-8.
- **R-17/R-18** — View "Faturas" em Analytics: `FaturasView.tsx`, aba 5 na sub-nav, 14 testes unitários
- **B-16/M-22** — Ciclo de fatura de cartão (Opção 2): pagamento vinculado ao período (`referenceMonth`, schema v4→v5), `CREDIT_PAYMENT` debita a conta pagadora, fatura líquida de créditos + selo de status (aberta/parcial/paga), estornos como `INCOME` na conta CREDIT; sync preserva sinal e infere `referenceMonth`
- **M-62/B-22** — Camada de projeção de 10 anos no Fluxo de Caixa (Relatórios) + janela rolante de recorrências sem `endDate`
- **M-64/CC-34** — `Installment.purchaseDate` (data de compra original em todas as parcelas, schema v10→v11) + correção definitiva do agrupamento de parcelas no sync do Organizze via `created_at` como chave de série
- **F-30** — Caixinhas: entidade `Budget` real (N:N com `Transaction` via `budgetIds`), CRUD completo em `useDataStore`, motor de derivação (`budgetCurrent`/`budgetProgress`/`getBudgetStatus`), telas reais em `pages/Budgets/*` (sem `mock.ts`), receita automática "Quadrantes" (`lib/budgetRecipes.ts`, 4 caixinhas/mês por intervalo de dias), sync/merge multi-dispositivo, dados de demo e testes E2E (`BX-01` a `BX-11`, resolvido 2026-08-12). Bottom nav mobile tem slot próprio desde `MB-13`. Ver `plan/BUDGETS.md` e `plan/BACKLOG.md` seção "Caixinhas — F-30".
- **M-71/M-72/M-73** (2026-08-20/21) — investigação e correção de ponta a ponta da lentidão relatada num cofre real de ~25 mil transações (`plan/PERFORMANCE.md`, fora do controle de versão). **M-71**: camada de instrumentação dev-only (`lib/perfMonitor.ts`, `PerfPanel`, atalho `Alt+Shift+P` — ver `plan/MONITORING.md`), 100% ausente do build de produção. **M-72**: `getTransactions()` sem filtro travava 52-55s na hidratação inicial — `GROUP BY`/`GROUP_CONCAT(DISTINCT)` custava ~9ms por grupo nesse ambiente (`wa-sqlite`/WASM sobre a VFS assíncrona do OPFS); reescrita sem `JOIN`/`GROUP BY` (junta tags/caixinhas em JS) + índice composto `idx_transactions_date_created` (`migrations/v13.sql`) → ~3-6s. **M-73**: `replaceAll()` reescrevia a tabela `transactions` inteira (~29 mil `INSERT`s sequenciais) em **toda** mutação, não só na carga — até ~1 minuto por salvamento; `mutate()` agora persiste por diff (`lib/storage/transactionDiff.ts` + `worker.ts` `applyMutation()`), só as transações que mudaram viram `INSERT`/`UPDATE`/`DELETE`, em lotes multi-linha — validado contra o cofre real: **255ms** a primeira gravação, **79ms** as seguintes. Ver "Caminhos de persistência" acima.
- **M-75** (2026-08-22) — usuário reportou novo travamento (20-50s) ao criar/editar transação numa cópia do cofre real, mesmo depois do M-73. Diagnóstico (CPU profile real, não estimativa): **é um artefato exclusivo de `npm run dev`, não existe em produção** — build de produção medido em 819ms/479ms na mesma escala sintética (~25k transações). Causa: `Transactions/index.tsx` passava o `DataFile` inteiro (via `data`) como prop pra `DateGroup`/`TxRow`, uma vez por linha renderizada; como `mutate()` clona o `DataFile` inteiro a cada mutação (`structuredClone`, correto e já validado no M-73), cada linha recebia uma prop gigante com referência nova a cada save — e a instrumentação dev-only do React 19 pra track "Components ⚛" do DevTools (`addObjectDiffToProperties` em `react-dom_client.js`, roda incondicionalmente em dev, ausente em produção) faz um deep-diff dessa prop a cada linha. Corrigido substituindo a prop `data` por três `Map`s pequenos (`categoriesById`/`accountsById`/`tagsById`) resolvidos uma vez no componente pai. **Armadilha a evitar no futuro:** nunca passar o `DataFile` inteiro (ou qualquer array em escala de `transactions`) como prop pra um componente renderizado em lista — isso é caro tanto em dev (diff do React) quanto, em menor grau, na reconciliação real.
- **M-85** (2026-08-25) — usuário relatou dívida duplicada entre `/net-worth` e `/health`: ele criava contas `LOAN` manuais só para uma dívida aparecer no Patrimônio (que só enxergava passivo em contas `CREDIT`/`LOAN`, nunca em transações), mas a mesma dívida já estava lançada como série de parcelamento numa conta comum, que `/health` (HE-15) já contava — resultado, a mesma dívida contada duas vezes em `/health`, com valores divergentes (o `LOAN` fora arredondado). Descartada a alternativa de "soft link" entre `LOAN` e a transação (referência só de exibição não eliminava a duplicidade, já que suprimir um dos dois lados na soma é cálculo, não referência); corrigida a causa raiz — `/net-worth` passou a reaproveitar `getDebtBreakdown` (o mesmo motor de `/health`) para contar séries de parcelamento em conta comum como passivo, eliminando a necessidade do `LOAN` duplicado por construção. Novo card "Parcelamentos" em `pages/NetWorth/index.tsx`; hint explicativo em Configurações → Ativos e Passivos → Empréstimos (`settings.loansHint`) reforçando que `LOAN` é só para dívida sem lançamento correspondente. Efeito colateral aceito: Patrimônio Líquido cai para quem já tinha parcelamentos em conta comum (esse passivo era invisível antes) — leitura correta. Ver `plan/BACKLOG.md` M-85, `plan/FINANCIAL_HEALTH.md` (nota junto ao HE-15).
- **M-86** (2026-08-25) — continuação do M-85: o usuário notou que cartão de crédito parcelado continuava subestimado em `/net-worth`, já que "Total Comprometido" ainda vinha de `getTotalCreditLiability`/`getOpenCreditBalance` (fatura atual em aberto), a mesma limitação que o `HE-15` já havia resolvido para `/health`. Confirmado explicitamente com o usuário que o cabeçalho do card e os stat cards Passivos/Patrimônio Líquido deveriam acompanhar a nova definição (não só a coluna da linha), mesmo padrão de reconciliação já usado nos cards de Empréstimos/Parcelamentos. `totalCreditLiabilities` e "Total Comprometido" passaram a vir de `getDebtBreakdown` (`kind: 'card'`) — "Fatura atual" e o limite disponível (`getOpenCreditBalance`, `CreditCard`/Dashboard) ficam intocados. `getTotalCreditLiability` ficou sem call site em produção e foi **removido** de `lib/utils.ts` junto de seus testes (redundantes com os de `getOpenCreditBalance`, que ele só envelopava). Card "Parcelamentos" renomeado para "Parcelamentos em Contas" e reordenado (Parcela Mensal → Total Comprometido), pra ler na mesma ordem "do mês → do todo" do card de cartões. Ver `plan/BACKLOG.md` M-86.
- **CS-24/CS-20** (2026-08-25) — usuário relatou uso real do sync com Google Drive num cofre de ~25 mil transações/~14MB: primeiro sync no celular levou minutos, e um lançamento feito logo depois **sumiu** após um refresh na web. Causa raiz (`CS-24`): `runPeerSync` (`useDataStore.ts`) tirava um snapshot de `data` *antes* do pull (que pode levar minutos num Drive/wifi lento); uma mutação feita nesse meio-tempo sobrevivia à sua própria escrita, mas o `replaceAll(merged)` do `pullAndMerge` — calculado a partir do snapshot já desatualizado — reescrevia o banco inteiro sem ela, e o `set({ data: fresh })` final apagava também da store em memória. `mergeForSync` (CS-05) não tinha bug — a orquestração é que alimentava um snapshot velho. Corrigido religando `runPeerSync` para reler o estado atual após o pull e, só se ele divergiu do snapshot inicial, reconciliar com um segundo `mergeForSync` antes de publicar (no-op quando não há mutação concorrente); cobre as duas fases de sync (Drive e pasta compartilhada) pelo mesmo ponto. Na sequência (`CS-20`), instrumentado `lib/cloudSync/syncMetrics.ts` para medir cada etapa do transporte Drive (round-trips de metadados, duração/bytes de download e upload, tempo de merge e de escrita local) — **deliberadamente sempre ativo, inclusive em produção** (ao contrário do padrão dev-only de `lib/perfMonitor.ts`/M-71), porque a latência real da API do Drive só se manifesta no dispositivo real do usuário; consumido via o Bug Report System (F-26) já existente, sem UI nova. Investigação de causa (uso "não amigável" da API do Drive) segue em aberto — as métricas foram criadas justamente para responder isso com dados reais antes de decidir se vale considerar um transporte de sync alternativo. Ver `plan/BACKLOG.md` CS-24/CS-20 e `plan/MONITORING.md` §"Métricas de Sync".
- **CS-25** (2026-08-25) — primeira leva real de métricas do `CS-20` (cofre de ~25 mil transações/~13,18MB, browser desktop) já rendeu um achado de causa raiz concreto: o JSON exportado mostrou **duas janelas de `sync.pullAndMerge.total` sobrepostas** e **dois `sync.drive.upload.bytes` idênticos** numa única conexão ao Google Drive — não uma sincronização lenta, mas duas sincronizações completas e redundantes rodando ao mesmo tempo. Causa: `App.tsx` chama `runPeerSync()` incondicionalmente todo boot, e `Settings/index.tsx` chama sua própria `runPeerSync()` ao terminar o callback OAuth — os dois `useEffect` montam na mesma navegação (o redirect do Google cai em `/settings?code=&state=`), e o tempo que `App.tsx` gasta carregando dados locais antes de checar `isGoogleConnected()` deu tempo do callback do Settings conectar o Google *primeiro*, então quando a chamada atrasada do `App.tsx` rodou, as duas prosseguiram. Corrigido com uma guarda de reentrância em `runPeerSync()` (`if (get().syncStatus === 'syncing') return`, sem `await` antes, livre de race pela semântica run-to-completion do JS) — cobre esse par de disparos e qualquer futuro (poll periódico vs. botão manual, por exemplo). Efeito esperado: corta pela metade o tráfego da primeira conexão, mas não isola ainda quanto da lentidão restante no celular (relatada originalmente no `CS-24`) é latência genuína da API do Drive — mobile ainda não reconfigurado para gerar uma nova leva de métricas. Ver `plan/BACKLOG.md` CS-25.
- **CS-26/CS-27** (2026-08-25) — segunda rodada de teste real (dois browsers, Firefox escrevendo/Chrome lendo, ~26,5 mil transações/~14,83MB), já sem o double-sync do `CS-25`, revelou dois achados novos. **CS-26 (corrigido):** `sync.readPeerBlob` levou 17,8s pra dar parse no `.db` baixado — mais lento que os 10,8s gastos baixando os mesmos bytes pela rede. Causa: `readDataFileFromDb` (`worker.ts`, o leitor de `.db` de peer usado pelo merge, CS-15) nunca recebeu o fix de query do `M-72` — continuava com `LEFT JOIN` duplo + `GROUP_CONCAT(DISTINCT)` + `GROUP BY t.id` (a mesma forma que custou ~224s num cofre real antes do `M-72`), porque roda dentro do worker, direto contra um ponteiro de DB de peer, fora da RPC `this.query()` que `StorageService.getTransactions()` usa — ficou como o único call site que não migrou. Reescrito pro mesmo padrão de três queries simples + join em JS (`groupJoinIds()` local, espelha `StorageService.groupIds()`). Sem cobertura de teste automatizado — mesma limitação do `M-72`/`M-73` (wa-sqlite/OPFS real não roda em `vitest`, e não há E2E de sync multi-dispositivo) — validação é contra dado real. **Confirmado em 2026-08-25**, repetindo o teste de dois browsers já com o `CS-28` aplicado: `worker.readPeer` caiu de 17.823,9ms para **2.570,8ms** (~6,9x), e `sync.pullAndMerge.total` do lado que lê caiu de 48,1s para **11,4s** — fix validado contra dado real. **CS-27 (só instrumentado, causa raiz em aberto):** `sync.drive.getMetadata` levou 9,2s — 4-8x mais lento que as list-queries estruturalmente parecidas (`findFolderId`/`findFileId`, 1,2-2,1s) — pra uma chamada que deveria ser um `GET` trivial de um campo. Hipótese mais provável (não confirmada pelo trace): retry-por-401 em `authorizedFetch` (`fetch → refreshGoogleToken() → fetch de novo`, até 3 round-trips sequenciais). Adicionadas duas métricas de diagnóstico (`sync.drive.getValidAccessToken`, `sync.drive.fetch401Retry`). **Na repetição do teste, o sintoma não voltou** — `getMetadata` em 588,5ms, mesma ordem dos outros lookups, e `fetch401Retry` não apareceu em nenhuma das duas coletas — rebaixado a baixa prioridade, provável anomalia pontual de rede em vez de bug sistemático. Ver `plan/BACKLOG.md` CS-26/CS-27.
- **CS-28** (2026-08-25) — o `CS-26` acima, como implementado inicialmente, paralelizava as três queries de `readDataFileFromDb` com `Promise.all` — e isso corrompeu o módulo WASM do wa-sqlite: o build usado (`wa-sqlite-async`) é Asyncify e só suporta **uma chamada em voo por vez** contra a instância; duas concorrentes reentram no módulo em pleno unwind. Reportado minutos depois: uma tentativa real de importar `.db` (Configurações/Onboarding → Importar) crashou com `NotFoundError: Entry not found` → `RuntimeError: unreachable executed`/`index out of bounds` — o import chama a mesma `readDataFileFromDb` pra validar o arquivo recebido antes de promover a troca (SEC-05), então o bug não era exclusivo de sync. **Dado do usuário protegido pelo desenho existente:** o crash ocorre na fase de validação, antes de `importDb` tocar o `db` real — o cofre anterior nunca chegou a ser fechado/sobrescrito; só o módulo WASM ficou inutilizável até um reload da aba. Corrigido revertendo as três queries pra sequenciais (mesma forma de query rápida do `CS-26`, só sem o `Promise.all`). Diferença de segurança que causou a confusão: `StorageService.getTransactions()` (main thread) já usa `Promise.all` nesse mesmo padrão desde o `M-72`, mas com segurança, porque cada chamada passa por `postMessage` → a fila `enqueue()` do worker antes de chegar no wasm — `readDataFileFromDb` roda **dentro** de uma task já retirada dessa fila, sem mais nenhuma serialização abaixo. Regra nova em `CLAUDE.md` ("Restrições" → Código) para não repetir. Ver `plan/BACKLOG.md` CS-28.
- **CS-29** (2026-08-25) — teste real de dois browsers (Chrome cria uma transação, Firefox dá refresh e sincroniza) mostrou `sync.runPeerSync.total` (54,8s) 10,1s maior que `sync.pullAndMerge.total` (44,7s) sem nenhuma edição concorrente real ter acontecido no Firefox — a diferença batia exatamente com um `worker.replaceAll` extra de 7,4s mais uma releitura completa do cofre logo após o merge normal. Causa: a reconciliação do `CS-24` comparava `data` por **identidade de objeto** (`latestLocal !== data`), e `App.tsx` roda dentro de `<StrictMode>` (`main.tsx`), que duplica a invocação do `useEffect` de boot em dev — cada `loadData()` da segunda invocação troca `data` por um objeto recém-desserializado do OPFS, conteúdo idêntico mas referência nova, o que a comparação por identidade tratava como "uma edição concorrente aconteceu", rodando um `mergeForSync`+`replaceAll`+`pushIfNeeded` inteiro à toa. Não é exclusivo de StrictMode — qualquer `loadData()`/`clearData()` durante um sync dispararia o mesmo falso positivo em produção. Corrigido comparando `settings.fileUpdatedAt` (só `mutate()` avança esse valor, incondicionalmente, em toda mutação real) em vez de identidade — uma edição de verdade continua sendo recuperada, uma recarga de conteúdo idêntico não dispara mais nada. Decisão consciente: não "corrigir" o double-invoke do `App.tsx` em si (comportamento intencional do React em dev, mesmo espírito do `M-75` — artefato que não existe em produção); o fix certo é tornar a camada de sync robusta à troca de referência. Ver `plan/BACKLOG.md` CS-29.
- **CS-30** (2026-08-25) — usuário levantou que a complexidade/custo de manutenção da camada de sync estava crescendo demais (5 bugs reais numa sessão só, `CS-24` a `CS-29`); em vez de recuar pra um servidor de sync, decidiu investir em reduzir o próprio custo recorrente do sync local: por que `replaceAll()` (reescrita total do cofre) continuava sendo o write-path do merge, quando o `M-73` já tinha resolvido exatamente esse problema pra mutação normal via diff (`applyMutation`/`diffTransactions`)? A resposta original do `M-73` ("o merge pode tocar uma fração não-limitada, o diff degradaria pro custo de reescrita total mesmo") é um argumento de pior caso que a telemetria real desta sessão (`CS-20` a `CS-29`) mostrou não se sustentar pro caso comum — plano de 2 fases desenhado e aprovado (`/home/dassan/.claude/plans/crystalline-seeking-pearl.md`): **Fase 1 (implementada nesta sessão)** troca `replaceAll(merged)` por `applyMutation(merged, diffTransactions(baseline, merged.transactions))` nos três pontos de sync (`useDataStore.ts` reconciliação `CS-24`/`CS-29`, `folderSyncService.ts`, `syncService.ts`) — baseline sempre lido fresco do disco (`storage.loadDataFile()`), nunca o snapshot pré-pull, mesmo cuidado do `CS-24`. Zero mecanismo novo, 100% reaproveitamento do `M-73`. Testes novos: 3 cenários de merge em `transactionDiff.test.ts` e `e2e/syncApplyMutation.spec.ts` (primeira cobertura automatizada da combinação "delta de merge real aplicado via `applyMutation` contra wa-sqlite de verdade" — zero cobertura antes; achado incidental ao rodar pela primeira vez: fixture do teste sem `valuations` crashava `mergeForSync`, não bug de produto). Novo `window.__syncTest` (dev-only, `services/storage/index.ts`) expõe `mergeForSync`/`diffTransactions` pro spec, confirmado ausente do bundle de produção. **Fase 2 (não implementada ainda)** — tabela `table_hashes` por partição (por tabela pequena, por ano pra `transactions`), ideia do próprio usuário: comparar hashes antes de ler/parsear o `.db` do peer, pulando inteiramente as partições que baterem — ataca o custo de leitura (hoje 2,6-5s), que a Fase 1 não toca (só resolve o custo de escrita). Ver plano completo e riscos documentados (mesma classe de bug do `CS-24`/`CS-29`: sempre comparar contra o disco *agora*, nunca um snapshot pré-pull) no arquivo de plano. Pendente: confirmar Fase 1 contra dado real (mesmo ritual do `CS-26`/`CS-28`) antes de iniciar a Fase 2. Ver `plan/BACKLOG.md` CS-30.

> **Deploy migrado de Vercel para Cloudflare Pages (antes de 2026-08-13, data exata não registrada).**
> `app/wrangler.jsonc` é a config de deploy atual; produção serve em `https://gimbo.com.br`. A
> migração não foi propagada para nenhuma config externa que referencia o domínio — já causou um
> incidente real: as "Authorized redirect URIs"/"Authorized JavaScript origins" do OAuth client do
> Google Drive (CS-01/CS-02) ficaram apontando para o domínio antigo da Vercel, e conectar o sync a
> partir de `gimbo.com.br` falhava com `Error 400: redirect_uri_mismatch` até serem atualizadas
> manualmente no Google Cloud Console. Qualquer outra allowlist amarrada ao domínio (CORS, CSP
> `connect-src`, webhooks) merece a mesma checagem antes de assumir que aponta para o lugar certo.

> **Repositório migrado de `dassan/gimbo-app` (privado) para `dassan/gimbo` (público) em
> 2026-08-18.** O histórico de commits foi reescrito para remover dados financeiros pessoais reais
> (nome completo de familiar, saldos/faturas de cartão, nomes de empregadores, fragmento de
> endereço) que estavam espalhados em revisões antigas de `plan/BACKLOG.md` e em
> `scripts/sync_gimbo.py`. O repo novo foi criado **do zero, sem compartilhar objetos git** com o
> antigo — não é um `push --force` no mesmo repo — porque uma PR squash-merged (#1, nunca
> incorporada a `main`) continha extratos bancários OFX reais e permanece acessível via
> `refs/pull/1/head` no GitHub para sempre, fora do alcance de qualquer reescrita de histórico
> local. `dassan/gimbo-app` está **aposentado e deve permanecer privado para sempre** — não
> reabrir, não tornar público, não apontar deploy/CI para lá. Uma sessão futura que notar a
> divergência de histórico entre os dois repos (commits diferentes, sem ancestral comum) não deve
> tentar "reconciliar" ou reescrever nada — é o resultado esperado e intencional da migração.
> Deploy (Cloudflare Pages) e `app/wrangler.jsonc` referem-se ao projeto de deploy, não ao nome do
> repositório GitHub — os dois podem divergir (`gimbo` vs. `gimbo-app`) sem que isso seja um erro.

> **M-61 resolvido em 2026-08-18.** As 16 vulnerabilidades acumuladas desde a última passada (a
> premissa de que faltava um bump major do `vitest` estava desatualizada — o projeto já estava em
> `vite@8`/`vitest@3.2.x`) foram corrigidas com `npm audit fix --legacy-peer-deps`, 14/16 in-range
> sem tocar `package.json`. As 2 restantes não tinham fix upstream e vinham só de
> `@vite-pwa/assets-generator` (gerador de ícones PWA usado uma única vez no F-27, não referenciado
> em nenhum script/CI) — **removido** de `devDependencies`; os ícones já gerados continuam em
> `app/public/icons/`, e o pacote pode ser rodado sob demanda via `npx` se precisar regenerá-los.
> Resta 1 vulnerabilidade baixa de `esbuild` vendorizada internamente pelo próprio `vite@8.2.1`
> (Windows-only, dev server apenas, abaixo do gate `--audit-level=high` do CI) — sem como corrigir
> sem esperar um patch novo do Vite; não é um item de ação.

Itens em aberto:
- **SEC-01 a SEC-16** — Auditoria de segurança pré-open-source (2026-08-18/19, branch `dassan/security-audit`) — ver `plan/BACKLOG.md` seção "Segurança — Auditoria Pré-Open-Source (SEC)". **0 Critical, 2 High, 3 Medium, 4 Low, 5 Info**, mais `SEC-15`/`SEC-16` achados ao implementar e verificar as correções. Nenhum achado foi causado por tornar o código público (histórico git limpo de segredos, `.env` nunca versionado). **Resolvidos: SEC-01 a SEC-09, SEC-14 e SEC-15** — redirect URIs do OAuth verificadas, headers de segurança em produção (`app/public/_headers`, com CSP), `refresh_token` do Google fora do `localStorage` (cifrado em IndexedDB + teto de 30 dias), import que valida antes de destruir o cofre, migrations atômicas com resgate de boot, fonte Inter self-hospedada, actions fixadas por SHA, escopo do bug report reduzido, `legacy-peer-deps` removido e `THIRD-PARTY-NOTICES.md`. **Aceitos: SEC-10 a SEC-13.** **Em aberto: `SEC-16`** e **`SEC-17`** (beacon do Cloudflare Web Analytics injetado no proxy, não no build — a CSP já o bloqueia; falta desligar em Web Analytics → Manage site → Disable). **`SEC-16`** — separar o OAuth client de dev do de produção. Hoje há um só, acumulando as URIs de `localhost` e de `gimbo.com.br`, e o `npm run deploy` builda com o mesmo `.env` do desenvolvimento — dev e produção compartilham a credencial. A criação do segundo client é ação manual no Google Cloud Console; a divisão em `.env.development`/`.env.production` (o Vite carrega por modo) é a parte deste repositório. > **O `SEC-01` foi resolvido com ressalva:** as URIs de `localhost` seguem registradas por decisão do mantenedor, para não interromper o desenvolvimento — risco baixo (o redirect entrega o código na máquina da própria vítima, sob HTTPS autoassinado), e o `SEC-16` elimina o trade-off por construção. Confirmado que **não há resquício do domínio antigo da Vercel** na allowlist.
> **Nada disso está em produção até rodar `npm run deploy`** — os headers e a fonte self-hospedada só valem no build publicado.

- **Cofre protegido por senha** — épico separado, decidido em 2026-08-19: bloqueio por senha com expiração por inatividade, e criptografia em repouso. **Reverte parcialmente o `X-1` do `PRD.md`** ("Criptografia do arquivo local", hoje listado como fora de escopo permanente) e encosta no `CS-18`. Ainda não desenhado — decisão pendente: se o backup exportado continua abrível em qualquer ferramenta SQLite ou vira blob opaco.

- **M-74** — `TransactionDrawer` desvincula silenciosamente a Caixinha ao editar uma transação. Achado incidental ao validar o M-73 (`e2e/mutationDelta.spec.ts`): o formulário de edição carrega/resubmete `tags` corretamente, mas nunca leva `budgetIds` de volta — qualquer edição (mesmo só valor, sem mexer na data) apaga o vínculo com a Caixinha, silenciosamente. Bug de UI pré-existente, não relacionado a persistência; não corrigido nesta sessão (média prioridade).
- **MB-08** — Analytics responsivo para mobile (média prioridade; parcial — aba Categorias resolvida em `MB-18`, as outras 4 abas — CashFlow, Contas, Tags, Faturas — seguem sem versão mobile)
- **BK-04** — Banner de re-permissão da pasta de backup no startup (média prioridade)
- **M-63b** — Gráfico de tendência (passado real + futuro projetado) no Patrimônio Líquido (baixa; a fatia de Saúde Financeira do M-63 já foi resolvida)
- **M-65** — WebDAV como transporte de sync adicional (baixa, demand-driven — adiado em 2026-07-24)
- **F-28 Nível 2** — Sync multi-dispositivo (CS-01 a CS-20) — demand-driven, ver roadmap abaixo. **Fases 0, 1 e 2 resolvidas** (motor de merge + multi-desktop via pasta compartilhada em 2026-07-24, CS-19/CS-04/CS-05/CS-10a e CS-13 a CS-17; Google Drive em 2026-07-25, CS-01 a CS-03 e CS-06 a CS-09, validado ponta-a-ponta contra a API real). **Achado que corrigiu o design original:** clientes OAuth "Aplicativo da Web" do Google exigem `client_secret` mesmo com PKCE — não existe tipo de cliente que aceite `redirect_uri` HTTPS de produção **e** dispense o secret. `VITE_GOOGLE_CLIENT_SECRET` passou a ser bundlada no build público (ver comentário em `googleAuth.ts` sobre por que isso não compromete a segurança real do fluxo).

> `BK-09` (aviso de cópia-em-conflito do Nível 1 em `/docs/backup-local`) foi absorvido pelo `CS-17` acima e está resolvido — o modo multi-dispositivo elimina o conflito por construção, e a doc page agora explica os dois cenários.
- **B-21** — Fronteira do dia de fechamento de fatura: marcado como *won't fix* (aceito)

### Roadmap de Sync Multi-Dispositivo (F-28 Nível 2) — decidido em 2026-07-24

Princípio central: **motor de merge único, transporte plugável.** Análise completa das
alternativas em `plan/FABLE-BRAINSTORM.md`; cenários em `SYNC_SCENARIOS.md`; spec técnica na
Fase 16 de `SPEC.md`.

| Fase | Transporte | Entrega | Itens |
|------|-----------|---------|-------|
| **0** ✅ | — | Motor de merge (`updatedAt` + `merge.ts` + testes) — **resolvido 2026-07-24** | CS-19, CS-04, CS-05, CS-10a |
| **1** ✅ | Pasta compartilhada, **um `.db` por dispositivo** | Multi-desktop, sem OAuth — **resolvido 2026-07-24** | CS-13 a CS-17 |
| **2** ✅ | Google Drive API (OAuth2 + client secret bundlado — PKCE puro não é suportado pelo Google para clientes Web) | **Desbloqueia mobile** — **resolvido e validado em produção 2026-07-25** | CS-01..03, CS-06..09, CS-10b |
| **3** | Dropbox | 2º provider | CS-11, CS-12 |
| — | Transversal | Cifragem opcional, telemetria de sync | CS-18, CS-20 |

Decisões que qualquer IA deve respeitar ao implementar:
- **Um escritor por arquivo** (Fase 1): cada dispositivo grava só o seu `device-<uuid>.db`. É o
  que elimina a cópia-em-conflito do Nível 1 **por construção** — nunca escrever no arquivo alheio.
- **Merge idempotente** é requisito, não detalhe: é o que torna seguro pular um arquivo ilegível
  e retentar no boot seguinte.
- **Falha de peer é sempre não-fatal** — nunca bloquear o boot; o app hidrata do OPFS local primeiro.
- `deviceId` no **OPFS** (não `localStorage`); snapshot `.db` completo (não oplog); cifragem
  client-side **opcional e off por padrão**.
- Fase 1 é **desktop apenas** (File System Access API) — nenhuma superfície de UI pode sugerir
  sync com celular antes da Fase 2.
- **Verificação OAuth do Google (CS-01):** `drive.file` é escopo **não-sensível** → não exige a
  revisão completa. O necessário é publicar em *publishing status* "Production" (a premissa
  anterior, de que a verificação era um bloqueio duro, foi revisada em 2026-07-24).

Decisões arquiteturais (2026-05-27, mantidas):
- Estratégia mobile = PWA responsiva (não app nativo). X-3 do PRD atualizado.
- Política de conflito = merge aditivo por UUID + LWW por `updatedAt`; duplicatas offline sobrevivem, usuário remove manualmente; deleções protegidas por `deletedIds`.
- Nenhum servidor Gimbo em nenhuma fase — a camada de sync é sempre infraestrutura do próprio usuário.

Ferramentas de desenvolvimento (2026-06-08, atualizado em 2026-08-12):
- **Sync Organizze → Gimbo** (`scripts/sync_gimbo.py` — versionado desde 2026-08-10, antes vivia só em `data/`, gitignored): script de benchmark que lê a API do Organizze por demanda e gera um `gimbo.db` (`PRAGMA user_version = 12`) para importar. IDs determinísticos (`uuid5`), saldos iniciais zerados (preenchidos à mão), janela `--start`/`--end` (com `--end` futuro para lançamentos não pagos). **Dois modos**: snapshot (`--start`, replace total, `--base` preserva só saldos) e incremental (`--window-months N`, busca só os últimos N meses e funde transações por id no `--base` — para run 1x/dia, ~7 chamadas de API). A saída (`gimbo.db`) continua em `data/` por padrão (default de `--out`), mesmo o script morando em `scripts/`. Documentação completa em `ARCHITECTURE.md` → "Ferramenta de Benchmark: Sync Organizze → Gimbo".

> **Armadilha recorrente:** todo bump de schema físico do app exige atualizar o `SCHEMA_DDL` e o
> `PRAGMA user_version` do `sync_gimbo.py` **junto**. Senão o `runMigrations()` do app pula o
> `ALTER TABLE` ao importar o `.db` gerado. Já aconteceu em M-51 e M-64 — e vai voltar no CS-04.

> **Limitação conhecida (2026-08-12, F-30):** Caixinhas e a receita Quadrantes não têm equivalente
> no Organizze, então `sync_gimbo.py` nunca as popula — `budgets`/`transaction_budgets` saem
> sempre vazias e `settings.quadrantes_enabled` sai sempre `0` (o `DEFAULT` da coluna), **mesmo
> em modo incremental com `--base`** — `read_base_data()` não lê a tabela `settings`, então o
> toggle e as caixinhas do `--base` nunca são carregados de volta. Mesmo padrão que
> `audit_log_retention_limit` já tinha (sempre hardcoded, nunca preservado do `--base`), não é
> regressão da F-30. Como a importação em Configurações → Dados é **replace total**, rodar este
> script e importar o `.db` resultante **apaga qualquer caixinha criada manualmente no app e
> desliga a receita Quadrantes se estiver ligada**. Se algum dia isso virar problema real (ex.:
> sync incremental 1x/dia rodando junto de uso ativo de Caixinhas), a correção é estender
> `read_base_data`/`write_db` para preservar `budgets` e `quadrantes_enabled` do `--base`, no
> mesmo espírito de como `balance`/`include_in_balance`/`archived` já são preservados por id —
> ainda não implementado, decisão de produto em aberto.

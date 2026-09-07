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
| Cenários de sync | `plan/SYNC_SCENARIOS.md` | 20 cenários: SQLite atual (S-01..07), multi-desktop por pasta (S-16..20), nuvem (S-08..15); Parte 4 é o diário da sessão de otimização `CS-24..36` |
| Brainstorm de sync | `plan/FABLE-BRAINSTORM.md` | Análise das 7 alternativas de sync multi-dispositivo, matriz de trade-offs, roadmap faseado e decisões |
| Transporte particionado de sync | `plan/SYNC_PARTITIONED_TRANSPORT.md` | Proposta original que originou o épico. **Implementada em `CS-37..CS-51`** (2026-08-27) com dois desvios deliberados: manifesto na raiz (não dentro da pasta do dispositivo) e payload JSON gzipado (não `.db` por partição) — ver a entrada de estado abaixo |
| Hidratação por janela | `plan/BOOT_HYDRATION.md` | Desenho do épico `HY` (agregação em SQL + hidratação em duas ondas) — **proposta, nada implementado**; ler junto de `MONITORING.md` §"Onde estão os 2,3s do `loadDataFile`" |
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
- **Nunca** abrir um banco com `sqlite3.open_v2()` direto — usar `openDbExclusive()`
  (`services/storage/worker.ts`). O cofre é gravado em formato WAL desde o `HY-20`, e esta VFS não
  abre um arquivo WAL em modo de bloqueio normal (sem `xShmMap`/`xShmLock`, o SQLite recusa). O
  `locking_mode=EXCLUSIVE` tem que vir **antes de qualquer leitura**: um único `PRAGMA user_version`
  disparado antes dele derruba a abertura inteira — foi o que quebrou `readForeignDataFile` quando o
  WAL entrou. Exceção: o harness de benchmark (`withScratchDb`), que controla o modo de propósito e
  normaliza cada cópia para rollback antes de medir.
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

**Schema em memória v20** | **Schema físico SQLite v17** (`migrations/v1..v17.sql`) | Cobertura: ~96% statements
**1165 testes unitários** (45 arquivos) + **147 testes E2E** (perfis `chromium` e `mobile-chrome`)

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
- **CS-31** (2026-08-25) — a confirmação da Fase 1 do `CS-30` contra dado real veio junto de um achado novo: `sync.applyMutation` (a escrita) caiu pra **394ms** no Firefox — a Fase 1 funcionou —, mas `sync.loadBaseline` (a releitura local nova que o diff precisa) custou **7,3s**, quase 29% do tempo total, quase do tamanho do `replaceAll` que ela substituiu. Concentrado quase inteiro (~6,7s) numa única query, `SELECT t.* FROM transactions` contra o banco **local** — o mesmo fenômeno que o `CS-26` já tinha corrigido do lado da leitura do peer, agora também do lado local, porque a Fase 1 introduziu uma leitura completa que antes não existia (o `replaceAll` antigo sobrescrevia às cegas). Achado adicional: a mesma chamada custou só 52ms no Chrome, mesmo tamanho de cofre — um descompasso Firefox×Chrome que já aparecia em toda coleta desta sessão na hidratação de boot, só nunca nomeado explicitamente como padrão. Sem correção nesta sessão — a Fase 2 já planejada (hash por partição) resolve isso pelo mesmo mecanismo que resolve a leitura do peer, só que aplicado aos dois lados do merge (local e remoto), reforçando (não substituindo) seu valor. Causa raiz do descompasso Firefox×Chrome em si segue sem investigação dedicada. Ver `plan/BACKLOG.md` CS-31.
- **CS-32** (2026-08-25) — Fase 2a do plano de sync incremental (`/home/dassan/.claude/plans/crystalline-seeking-pearl.md`): tabela `table_hashes` (migration `v16.sql`, `MAX_KNOWN_DB_VERSION` 15→16, `scripts/sync_gimbo.py` atualizado no mesmo commit) e manutenção do hash por partição — FNV-1a de 32 bits + XOR-fold (`lib/storage/rowHash.ts`, novo; `row_count` guardado ao lado do hash reduz o risco teórico de falso positivo do XOR-fold), instrumentada nas 3 únicas funções que gravam nas tabelas físicas (`writeSmallTables`/`applyTransactionDelta`/`replaceAll` em `worker.ts`) — nenhuma das ~20 mutações de `useDataStore.ts` precisou mudar, todas já funilam por essas 3. Ainda **sem nenhuma mudança de leitura** (isso é a Fase 2b, próximo passo). **Achado real pego pelo e2e novo antes de qualquer leitura seletiva depender disso:** o hash de tabelas com campo `updatedAt` opcional (accounts/categories/tags/budgets/transactions) mudava sozinho no primeiro `applyMutation` depois de um `replaceAll`, sem edição real — a escrita persiste `x.updatedAt ?? ts` quando o objeto em memória não traz o campo, mas o hash usava o valor pré-fallback; um round-trip por `loadDataFile()` (que sempre volta com o fallback já gravado) mudava o hash sem o dado ter mudado. Corrigido normalizando os dois lados com o mesmo `?? ts` antes de hashear. `applyTransactionDelta` ganhou um `SELECT id, date` batelado dos ids tocados *antes* de qualquer escrita (pra saber o ano antigo de uma transação, cobrindo o caso de ela mudar de ano) e recomputa via `SELECT` só os anos afetados depois — nunca o histórico inteiro; um ano que esvazia por completo grava hash 0/contagem 0 em vez de deixar uma entrada órfã. Extraído `sqlRowToRawTransaction` (mapeamento SQL-row→`RawTransaction`, antes só dentro de `readDataFileFromDb`/CS-26) pra um helper compartilhado, única fonte de verdade. Testes: `rowHash.test.ts` (novo, unitário — determinismo, comutatividade do XOR-fold, equivalência incremental, teste-guarda por campo), `merge.test.ts` (acréscimo — fixa que `remote.transactions` parcial não altera entradas de `local` ausentes, propriedade da qual a Fase 2b vai depender), `e2e/tableHashSync.spec.ts` (novo, contra wa-sqlite real). Ver `plan/BACKLOG.md` CS-32.
- **CS-33** (2026-08-25) — Fase 2b do plano de sync incremental: leitura seletiva do peer usando os hashes do `CS-32`. `readDataFileFromDb` (`worker.ts`) refatorada em leitores por tabela (`readAccounts`/`readCategories`/.../`readTransactionsForYears`), reutilizados incondicionalmente pela leitura completa (mantida intacta — `importDb()` continua nela, validar um import não pode depender de hash) e condicionalmente pela função nova `readDataFileFromDbSelective(dbPtr, localHashes)`, que só chama o leitor de uma partição se `hashesMatch()` disser que ela diverge do local (ausente de qualquer lado = sempre diverge, nunca "igual" por omissão). `transactions`: descobre os anos que o peer de fato tem e lê só os que divergirem — um ano só-local nunca é sequer considerado. `readForeignDataFile` lê o hash local dentro da mesma invocação enfileirada que processa o peer, nunca um snapshot anterior (mesma disciplina do `CS-24`/`CS-29`). `mergeForSync` não mudou — um `remote.transactions` parcial já funciona porque a união é por id (fixado em teste no `CS-32`). **Teste crítico, contra wa-sqlite real:** `e2e/selectivePeerRead.spec.ts` usa **dois contextos de browser reais** (dois "dispositivos" de verdade) pra gerar um peer com hash de verdade, confirmando que partições idênticas voltam vazias e só o que diverge é lido. Validado explicitamente que o teste pega o pior caso possível: forçado `hashesMatch()` a sempre "bater" (pular tudo cegamente) — o teste falhou corretamente detectando a perda de dado do peer; revertido antes de commitar. É o risco mais sério que este mecanismo poderia introduzir (perda silenciosa, pior que o "sync lento" que motivou toda a Fase 2), e agora tem cobertura automatizada específica. Ver `plan/BACKLOG.md` CS-33.
- **CS-34** (2026-08-25) — usuário repetiu o teste de dois browsers depois do `CS-33` e reportou: nenhum ganho de velocidade, senão pareceu mais lento — `sync.readPeerBlob`/`worker.readPeer` seguiram em 13-14s, igual ou pior que antes da Fase 2. Causa raiz: `table_hashes` (v16) é mantida só *incrementalmente* — `applyTransactionDelta` (`CS-32`) recomputa o hash apenas dos anos que o delta de fato tocou, então um ano de histórico que nunca sofreu uma mutação diffada desde que a v16 existe **nunca ganha uma linha na tabela**; `hashesMatch()` o vê ausente dos dois lados e trata como "sempre diverge", pra sempre — o histórico inteiro continuava sendo lido a cada sync, com o custo extra da própria comparação de hash por cima. Vale tanto pro cofre local quanto pra cópia do peer recém-enviada — as duas pontas precisavam de backfill. `e2e/selectivePeerRead.spec.ts` (`CS-33`) não pegou isso porque semeia via `replaceAll()`, que já popula os hashes como efeito colateral — nunca exercitou "cofre com dado antigo, hashes vazias". Corrigido com `backfillTableHashesIfNeeded(dbPtr)` (novo): checagem barata (`COUNT(*)`), e se a tabela estiver vazia, lê o estado atual inteiro (via `readDataFileFromDb()` reaproveitado) e popula hash+contagem de tudo de uma vez, mesma normalização `updatedAt ?? ts` do `CS-32`. Chamada em `init()` (banco local, uma vez por boot — nunca mais depois de backfilled) e em `readForeignDataFile()` (cópia do peer, logo após migrar). Custo aceito: uma leitura completa por banco, uma única vez. Teste novo reproduz o cenário exato (semeia, apaga `table_hashes` manualmente, reload pra disparar o backfill, só então testa a leitura seletiva) — confirmado que falha sem a chamada em `init()` e passa com ela. **Extensão, achada ao esclarecer com o usuário o procedimento de reteste (ele propôs importar → esperar o backfill → exportar → reusar esse arquivo daí em diante):** `importDb()` reabre `db` fora do caminho de boot de `init()` — sem a mesma chamada ali, importar um `.db` antigo (sem `table_hashes`, ex. um backup de antes da v16) só ganharia o backfill no *próximo reload*, não no mesmo carregamento em que o import acontece, já que a UI (`handleImportDb`) segue usando o cofre importado sem pedir reload. Adicionada a mesma chamada ao final do caminho de sucesso de `importDb()`; teste novo confirma que importar sem reload já sai com hashes populados (falha sem a chamada, passa com ela); suíte `SEC-05`/`SEC-06` (`importSafety.spec.ts`) re-executada e verde. Ver `plan/BACKLOG.md` CS-34.
- **CS-35** (2026-08-25) — duas coletas reais (Chrome+Firefox) enviadas pra confirmar o fix do `CS-34` revelaram um segundo custo, independente do hash-skip: `worker.query:SELECT t.* FROM transactions` isolado, ~8,85s (Chrome)/~6,5s (Firefox), *depois* de `sync.pullAndMerge.total` já ter terminado — inclusive no Firefox, onde nenhuma reconciliação de edição concorrente sequer disparou. Causa: `pullAndMergeInner`/`syncFromPeers` (`syncService.ts`/`folderSyncService.ts`) já computam o `DataFile` mergeado inteiro em memória e o persistem via `applyMutation`, mas o `SyncResult` devolvido descartava esse valor (`{status:'merged', peersMerged}`) — `runPeerSync` (`useDataStore.ts`) precisava então chamar `storage.loadDataFile()` de novo só pra reconstruir uma cópia equivalente, pagando o mesmo custo de leitura completa do `M-72` a cada sync, usado ou não (a checagem de edição concorrente do `CS-29` descartava o valor lido sem uso real no caso comum). Corrigido devolvendo o `DataFile` já calculado em `result.data` (novo campo em `SyncResult`'s variante `'merged'`, `provider.ts`); a checagem do `CS-29` passou a comparar `get().data.settings.fileUpdatedAt` (cópia em memória do Zustand, atualizada de forma síncrona por `mutate()`, sem I/O) em vez de reler o disco — mais rápido e mais correto (não perde uma edição cujo `debouncedApplyMutation()` de 300ms ainda não tenha sido concluído). Zero mecanismo novo, só threading de um valor já calculado. Ver `plan/BACKLOG.md` CS-35.
- **CS-36** (2026-08-25) — telemetria nova pra a próxima coleta real distinguir, sem inferência, "o hash-skip da Fase 2b não está pulando nada" (bug) de "o par de dispositivos testado está genuinamente muito divergente nesta rodada" (primeiro sync de um histórico grande, custo conhecido e esperado desde o plano da Fase 2). `readDataFileFromDbSelective` (`worker.ts`) conta `tablesSkipped`/`tablesTotal` e `yearsSkipped`/`yearsTotal` enquanto decide o que ler e devolve os números junto do `RawDataFile`; `syncService.ts`/`folderSyncService.ts` publicam como `sync.readPeer.tablesSkipped`/`tablesTotal`/`yearsSkipped`/`yearsTotal` (sempre ativo, mesmo padrão de `sync.drive.*.bytes`). Zero mudança de comportamento. Ver `plan/BACKLOG.md` CS-36.
- **CS-37 a CS-51 — transporte particionado de sync no Drive (2026-08-26/27, branch `dassan/sync-partitioned-transport`).** Substitui o `gimbo.db` monolítico como unidade de transporte: cada dispositivo publica `Gimbo/manifest-<deviceId>.json` + `Gimbo/device-<deviceId>/<partição>.json.gz`, mantendo o invariante de escritor único por arquivo. Partição = a mesma chave de `table_hashes` (`CS-32`): 8 tabelas pequenas inteiras + `transactions` por ano. Payload é **JSON gzipado, não `.db`** — não existe export de subconjunto do SQLite no código, cada `.db` carregaria o DDL completo por arquivo, e ler N `.db` significaria N aberturas de wa-sqlite serializadas pela fila Asyncify; com JSON o peer é reconstruído inteiramente na main thread. **Corte seco**: nada lê ou escreve o `gimbo.db` legado; um dispositivo desatualizado não é lido e nada se perde (o merge é aditivo e idempotente), só atrasa. `syncService.ts` foi removido; `driveTreeSyncService.ts` o substitui. `pushIfNeeded` perdeu o parâmetro `DataFile` (era um snapshot capaz de envelhecer até o upload; a decisão vem dos hashes lidos frescos).

  **Resultados medidos contra o cofre real (~26,5 mil transações), 4 rodadas de telemetria:** push por salvamento de **~14MB para 137 KB** (~102x) — e esse era o maior sorvedouro, porque `_triggerLocalBackup` chama `pushIfNeeded` a cada mutação debounced; sync incremental de **12,3s para 7,5-8,3s** com ~270 KB por ciclo contra ~28 MB; chamadas por sync incremental **10 → 7**; `partitionsSkipped` 22 de 24 estável. Trabalho local caiu para **9%** do tempo — o restante é latência do Drive, que cobra ~1,1s por leitura e ~2s por escrita **independentemente do tamanho** (medido com um manifesto de 3,5 KB, idêntico em Chrome e Firefox). O transporte é hoje *latency-bound*: ganho futuro vem de cortar estágios sequenciais de rede, não bytes.

  **Duas armadilhas que este ciclo revelou e que valem para qualquer trabalho futuro de performance aqui:**
  1. `date LIKE '2026%'` **não usa índice** — `EXPLAIN QUERY PLAN` dá `SCAN`. A otimização de prefixo do SQLite não se aplica porque `LIKE` é case-insensitive por padrão e o índice usa colação BINARY. Use `date >= ? AND date < ?` (`yearRange()` em `worker.ts`). Estava em dois caminhos quentes desde o `CS-32`/`CS-33`, custando 10-17x (`CS-51`). Há teste e2e travando os planos de consulta.
  2. Otimizar acima de uma query que ignora o índice **mede o gargalo errado**: as três otimizações do `CS-50` estavam certas em desenho e, medidas antes do `CS-51`, pareceram pioras. Repetir a medição com os papéis dos dispositivos invertidos, e mais de uma vez, foi o que separou sinal de ruído.

  Em aberto: `CS-49` (e2e entre dois contextos de browser reais trocando uma árvore de partições — hoje há cobertura dos dois lados separadamente, não juntos). Ver `plan/BACKLOG.md` CS-37 a CS-51, `plan/MONITORING.md` §"Transporte particionado" e o changelog de lá.

- **M-91** (2026-08-28) — depois do `M-90`, o usuário reportou que agora o **esqueleto** fica em
  cena tempo demais: resolvida a percepção, o alvo voltou a ser tempo real. Primeiro achado, antes
  de qualquer código: a coleta que motivou o pedido (`loadDataFile` 10,4s) **não era comparável**
  com a anterior (2,3s) — todas as fases sem relação com o cofre estavam 2-3x mais lentas na mesma
  coleta (parse do bundle 3,3x, migrations 2,2x), sinal de máquina carregada, não de regressão; sem
  as métricas do `M-87` isso teria virado caça a um fantasma de 4,5x. 3 métricas novas sempre ativas
  em `StorageService.ts` abrem a fase que domina o boot. **Atribuição no cofre real:** SQLite
  materializando linhas dentro do worker ~95%, `postMessage` ~4%, montagem de objetos na thread
  principal ~5%. Drill-down: `SELECT COUNT(*)` 89ms, `SELECT id` 619ms, `SELECT t.*` 5.398ms,
  `SELECT t.*` de um ano só 654ms — **ler o arquivo não é o custo, materializar linha é**, e uma
  fatia sai proporcionalmente barata. **Hipótese descartada:** `json_group_array(json_object(…))`
  numa célula só (json1 existe no build) deu **1,03x** num A/B intercalado — o gargalo não é a
  fronteira JS↔WASM, não repetir sem hipótese nova. **Aviso de método:** a mesma consulta variou de
  4,0s a 8,0s na mesma sessão numa máquina carregada — comparar aqui exige rodadas intercaladas e
  mediana. Ver `M-88` (atualizado) para por que a fatia por janela esbarra num bloqueio de correção:
  saldos derivam do histórico completo, então uma fatia mostraria números errados, não incompletos.

- **Épico HY / M-88 resolvido** (2026-08-29) — boot lento de cofre grande, corrigido em **duas
  linhas**, depois de uma investigação que refutou três hipóteses antes da certa. O desenho original
  (`plan/BOOT_HYDRATION.md`: agregado por ano, hidratação em duas ondas, `hydration` no `DataFile`,
  `CompleteDataFile`, guarda de escrita — `HY-01` a `HY-12`) **nunca foi implementado e não deve
  ser**: atacava um gargalo que não era o gargalo.

  **A causa raiz (`HY-16`):** `OriginPrivateFileSystemVFS` só abre o `SyncAccessHandle` do OPFS sob
  lock **exclusivo** e o **fecha** quando o lock cai (`xLock`/`xUnlock`). Em modo de bloqueio normal
  — o de sempre — toda leitura de página caía no caminho lento: `getFile()` + `Blob.slice()` +
  `arrayBuffer()`, três operações assíncronas por página de 4KB, num arquivo de 3.489 páginas. E o
  `PRAGMA journal_mode=WAL` que o `worker.ts` rodava em toda abertura era **no-op silencioso**
  (`HY-19`): sem `xShmMap` na VFS o SQLite recusa WAL devolvendo o modo atual, sem erro — o cofre
  rodou em `delete` desde sempre, onde cada transação cria, escreve e apaga um arquivo de journal
  no OPFS.

  **A correção (`HY-20`):** `openDbExclusive()` retém `locking_mode=EXCLUSIVE` **antes de qualquer
  leitura**, e só então `runMigrationsOn` liga o WAL — que agora pega. Medido no cofre real (26.576
  transações): **leitura completa 1.974ms → 770ms (2,6x), update de linha única 24,3ms → 0,4ms
  (60x)**. O segundo número também explica retroativamente boa parte dos 79ms do `applyMutation`
  (`M-73`). Página ficou em 4KB: 64KB compraria só mais 1,24x e custaria 12,5x de WAL mais uma
  migration (`HY-17`; `HY-18` descartado).

  **O custo (`HY-21`):** o cofre virou de aba única, e sem tratamento a segunda aba **não falha —
  trava**. `lib/vaultOwnership.ts` + `components/VaultBusyScreen.tsx` trocam a trava por uma escolha
  ("Usar aqui"/"Cancelar", padrão do WhatsApp Web); o dono libera o lock só **depois** de
  `storage.close()` fechar o banco, então conseguir o lock é prova de que o cofre está livre.

  **`HY-14`, valioso por conta própria:** a regra de saldo existia em **cinco** cópias (Dashboard e
  Configurações literalmente idênticas, `getReserveBalance`, `applyTx` do Patrimônio, `balanceUpTo`
  de Lançamentos), três já divergentes entre si. Unificadas em `computeAccountBalances()`, com as
  antigas preservadas no teste para provar equivalência.

  **Três hipóteses refutadas, cada uma por uma coleta em vez de um épico:** poda de colunas
  (`HY-13`, 1,0-1,2x — dentro do ruído), leitura em lotes (`HY-15`, ficou **mais lenta**) e
  desfragmentação por `VACUUM` (`HY-17`, não rendeu nada). A ferramenta que refutou está no
  repositório sob `?bench` (`lib/storage/columnBench.ts`, `window.__bench`), deliberadamente fora do
  gate `DEV` — build de produção não tem nada atrás daquele gate, e o ritual do `M-87`/`M-91` exige
  medir em produção. Ver `plan/MONITORING.md` §"Benchmark de leitura" e o changelog de lá.

  **O que sobra:** o piso de materializar linha (671-950ms conforme a sessão), única coisa que uma
  janela ainda cortaria — reabrir o `BOOT_HYDRATION.md` só se ele voltar a incomodar, sabendo que
  rende menos do que aquele desenho estimava e que os riscos continuam os mesmos.

- **M-90 / M-89** (2026-08-28) — continuação direta do `M-87`. **M-90:** `App.tsx` deixou de
  renderizar nada enquanto hidrata — novo `components/BootSkeleton.tsx` (silhueta do app, medidas
  espelhando `Navbar`/`AppLayout` para não haver salto de layout) pinta imediatamente, porque a
  interface não depende do cofre, só os números dependem. Mesma manobra do `CS-52` no sync: tirar
  do caminho percebido o que não precisa estar nele. Métrica nova `boot.shellVisible`, e
  `boot.blankWindow` passou a fechar na primeira coisa que aparece. **Medido no mesmo cofre real:
  janela em branco 2.802ms → 88,8ms, com `boot.appVisible` inalterado em ~3s.** Lição para
  trabalhos futuros de percepção: **uma métrica de tempo total não enxerga um ganho de percepção** —
  sem o `shellVisible`, esta mudança apareceria como "nada mudou". **M-89:** `buildBugReportSnapshot()`
  lia `import.meta.env.VITE_APP_VERSION`, variável nunca definida em lugar nenhum — todo bug report
  saía com `"appVersion": "unknown"`, inclusive a telemetria de sync das sessões `CS-20` a `CS-55`.
  Passou a usar `__APP_VERSION__` (mesma fonte do rodapé de Configurações), com teste de regressão.

- **M-87** (2026-08-28) — usuário relatou que, ao recarregar a página, o app fica alguns segundos
  mostrando só o fundo da tela antes de a interface aparecer. O projeto não tinha **nenhuma**
  instrumentação de boot (o `M-71` é dev-only e por toggle; o `CS-20` só cobre sync), então o
  fenômeno era invisível. Nova camada `lib/bootMetrics.ts`, sempre ativa (mesma exceção do
  `syncMetrics.ts`), publicando a linha do tempo inteira do boot — marcos registrados uma vez só
  (imunes ao double-invoke do `<StrictMode>`) e durações de fase deliberadamente não deduplicadas;
  as 4 fases do `init()` do worker chegam por um canal novo `bootPerf` do `WorkerResponse`.
  **Leituras reais do mantenedor, em build de produção local (`npm run preview`) com o cofre real
  (26.576 transações): Chrome 151 — 2.802ms de tela vazia, `boot.loadDataFile` 2.311,4ms (80%);
  Firefox 153 — ~2.348ms, `loadDataFile` 2.028ms (87%).** O boot **é** a leitura completa do cofre
  no caminho crítico; nada do trabalho de sync desta semana está nele (a partida inteira do storage
  custa 59-103ms). Três avisos que valem para qualquer trabalho futuro aqui: (1) medir boot em
  `npm run dev` leva à conclusão errada — o mesmo ciclo deu 4,2s com o render em ~1.000ms em vez de
  ~340ms (`M-75` de novo), além das durações duplicadas pelo `<StrictMode>`; (2) o
  `first-contentful-paint` **não** marca o começo da tela vazia neste app — ele chega junto com a
  interface, e usá-lo como substituto do `first-paint` (que o Firefox não publica) produziu uma
  "janela em branco" de 20ms para um boot de ~2,3s; o substituto certo é o `boot.scriptStart`;
  (3) **o descompasso Firefox×Chrome do `CS-31` não se reproduziu** — aqui o Firefox foi 12% mais
  rápido; tratar aquele achado como não reproduzido até nova evidência.
  M-87 mede, não corrige — a correção está aberta no `M-88`. Ver `plan/BACKLOG.md` M-87/M-88 e
  `plan/MONITORING.md` §"Métricas de Boot".

- **CS-35 confirmado, CS-36 primeira leitura real (2026-08-26)** — nova rodada de dois browsers confirmou o `CS-35` de ponta a ponta: `sync.runPeerSync.total` ficou a ~280-300ms de `sync.pullAndMerge.total` nos dois lados (Chrome: 12.880,7ms vs. 12.603,3ms; Firefox: 9.794ms vs. 9.500ms) — antes do fix esse gap era de 7,5-9,8s. Tempo total do sync caiu de ~31,2s pros dois browsers pra **12,9s**/**9,8s** (2,4x/3,2x). `CS-36` deu sua primeira resposta real, e ela é reveladora: Firefox (só 1 transação nova desde a última convergência) pulou 19 dos 20 anos de `transactions` — `worker.readPeer` em 756ms, hash-skip funcionando exatamente como desenhado. Chrome, no mesmo teste, não pulou nenhum dos 20 anos, apesar do cofre já estar convergido nas rodadas anteriores. **Hipótese líder, ainda não confirmada com o usuário:** `scripts/sync_gimbo.py` carimba `updated_at` com o timestamp do *run* em toda transação, por decisão de projeto (B-32, é a chave LWW do merge) — se o `.db` usado pra semear o Chrome nesta rodada veio de uma execução do script diferente da que gerou o `.db` do Firefox, cada transação carrega um `updated_at` genuinamente distinto de um lado, mesmo com conteúdo financeiro idêntico, e o hash diverge corretamente (não seria bug do hash-skip, seria artefato de como o fixture de teste foi gerado/reimportado entre rodadas). Sem correção aplicada — pendente confirmar a causa antes de decidir se há algo a corrigir. Ver `plan/BACKLOG.md` CS-35/CS-36.

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
- **Relatório de uso real (2026-09-07)** — 11 itens mapeados pelo usuário usando o Gimbo no dia a dia,
  registrados em `plan/BACKLOG.md` (detalhes técnicos e decisões pendentes em cada entrada), branch
  `dassan/quick-fixes-uso-real`. **Resolvidos (lotes 1 a 4, escolhidos com o usuário): `B-34`**
  (autocomplete de descrição não seleciona mais conta/cartão arquivado como fonte — só o default
  ativo do M-42 sobrevive), **`M-94`/`M-95`** (lista de lançamentos do cartão: fonte redundante
  removida — só `CREDIT_PAYMENT` continua mostrando a conta pagadora —, data de compra original
  movida da lista para o detalhe do lançamento no `TransactionDrawer`), **`B-35`** (label "Minhas
  Contas" alinhado com a lista no Dashboard; os mesmos bugs nos painéis "Meus Cartões" e "Últimos
  Lançamentos", achados junto — o segundo apontado pelo próprio usuário numa revisão —, corrigidos
  no mesmo commit), **`MB-20`** (flag pago/não-pago oculta na lista de Lançamentos em mobile — só
  essa tela; o mesmo ícone no Dashboard não precisou de tratamento, o painel já é desktop-only),
  **`B-36`** (termo "Ledger" trocado por "Cofre"/"Vault" nas 5 strings de copy; a tagline de marca
  "The Fluid Ledger" virou "The Fluid Vault", preservando a decisão de mantê-la em inglês nos dois
  locales), **`M-99`** (Dashboard: clicar numa conta navega para `/transactions?account=<id>` já
  filtrado), **`M-96`/`M-97`** (lote 3 — Modificações Recentes ganha horário exato + dispositivo
  de origem; nova entidade sincronizada `DeviceInfo` para o nome de dispositivo, schema v19→v20,
  migration `v17.sql`, integrada ao transporte particionado — decisão confirmada com o usuário de
  sincronizar de verdade em vez de manter só localmente) e **`M-93`** (lote 4 — nova heurística de
  recorrência em `scripts/sync_gimbo.py`, reabre o `M-92` revertido em `70d36e3`; causa raiz
  investigada e confirmada contra o cofre real do usuário antes de reimplementar — sem exigir
  valor igual, a v1 confundia compras do dia a dia coincidindo numa banda de cadência com
  recorrência real, e cada falso positivo virava centenas de ocorrências fantasmas via
  `refreshRecurrenceHorizons()`; corrigido exigindo mesmo valor + 3+ ocorrências + só últimos 6
  meses, validado linha por linha pelo usuário e ponta-a-ponta via Playwright). Ver
  `plan/BACKLOG.md` para os detalhes técnicos completos de todos os lotes. **Achado incidental do
  M-93, virou item novo: `M-101`** (lançamento simulado/projetado com flag de contabilizar ou não
  no saldo — usuário usa uma conta real como hack pra simular saldo futuro; registrado para
  desenho futuro, não iniciado). **Em aberto:** `M-98` (categorias iniciais deixam de vir
  pré-criadas por padrão — **tensão com CS-23**, que fixou os ids justamente para convergência de
  merge; resolver sem quebrar essa garantia). **Fora do
  backlog, adiado pelo próprio usuário:** `M-100`, como medir quantas pessoas usam o Gimbo — em
  tensão direta com o posicionamento zero-coleta/local-first do projeto (`M-69`) e com o `SEC-17`
  em aberto (que pede para **desligar** o beacon do Cloudflare Web Analytics, não usá-lo).
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
| **3** ✅ | Google Drive **particionado** (manifesto + partições `.json.gz` por dispositivo) — **resolvido 2026-08-27** | Push por salvamento de ~14MB → 137 KB; sync incremental 12,3s → 7,5-8,3s | CS-37..CS-51 |
| **4** | Dropbox | 3º provider | CS-11, CS-12 |
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

# Gimbo — Arquitetura Técnica

> Documento de referência técnica completa. Para regras de desenvolvimento, veja `../CLAUDE.md`.
> Para decisões de cartão de crédito, veja `CREDIT_CARD.md`. Para cenários de sync, veja `SYNC_SCENARIOS.md`.
> Para o módulo de relatórios, veja `REPORTS.md`.
> Para telemetria local e sistema de reporte de bugs, veja `METRICS.md`.

---

## Stack Tecnológico

| Camada | Tecnologia | Versão |
|--------|-----------|--------|
| Framework UI | React | 19.x |
| Roteamento | React Router | 7.x |
| Build | Vite | 8.x |
| Linguagem | TypeScript | 6.x (strict) |
| Estilo | Tailwind CSS | 4.x |
| Estado | Zustand | 5.x |
| Validação | Zod | 4.x |
| Persistência (cache) | IndexedDB via `idb` | 8.x |
| Persistência (disco) | File System Access API | nativa |
| Gráficos | Recharts | 3.x |
| i18n | i18next + react-i18next | 26.x / 17.x |
| PWA | vite-plugin-pwa | 1.x |
| Ícones | Lucide React | 1.x |
| Utilitários CSS | clsx + tailwind-merge | — |
| Testes unitários | Vitest + Testing Library | 3.x / 16.x |
| Testes E2E | Playwright | 1.x (Chromium only) |
| Lint | ESLint (flat config) | 9.x |
| Formatter | Prettier | 3.x |
| Gerenciador de pacotes | npm | — |

**Node.js**: 22 (requerido pelo CI)

---

## Estrutura de Diretórios

```
MyFinanceApp/
├── .github/workflows/           # CI (ci.yml) + auditoria semanal (audit.yml)
├── plan/
│   ├── PRD.md                   # Requisitos de produto (features F-1 a F-23)
│   ├── SPEC.md                  # Especificação técnica
│   ├── BACKLOG.md               # Bugs (B-XX), melhorias (M-XX), relatórios (R-XX)
│   ├── RULES.md                 # Workflow IA + humano
│   ├── ARCHITECTURE.md          # Este arquivo
│   ├── CREDIT_CARD.md           # Decisões e arquitetura do módulo de cartão de crédito
│   ├── SYNC_SCENARIOS.md        # Cenários de sincronização e recuperação
│   └── REPORTS.md               # Épico do módulo analítico avançado
├── design/
│   ├── design_system.md         # Sistema de design "Fluid Ledger"
│   └── *.png                    # Mockups de telas
├── app/
│   ├── src/
│   │   ├── main.tsx             # Entry point (StrictMode + i18n)
│   │   ├── App.tsx              # Hidratação, route guard, error boundary
│   │   ├── types/index.ts       # Todas as entidades TypeScript
│   │   ├── lib/
│   │   │   ├── utils.ts         # cn(), uuid(), formatCurrency(), parseDateLocal(), motor de fatura virtual
│   │   │   ├── telemetry.ts     # Ring buffer de eventos seguros + buildBugReportSnapshot() (F-26)
│   │   │   ├── tabGuard.ts      # BroadcastChannel: múltiplas abas
│   │   │   ├── i18n/            # Config i18next + locales (pt-BR, en-US)
│   │   │   └── storage/
│   │   │       ├── schema.ts    # Schemas Zod + factories + applyRetention()
│   │   │       ├── fileSystem.ts # File System Access API + fallback
│   │   │       ├── indexedDb.ts  # CRUD IndexedDB
│   │   │       ├── merge.ts     # Merge por UUID (read-before-write)
│   │   │       └── sync.ts      # importFileToIdb() + syncToFile()
│   │   ├── store/
│   │   │   ├── useDataStore.ts  # Dados financeiros + persistência + sync
│   │   │   └── useWorkspaceStore.ts # Preferências UI (tema, locale, shadows)
│   │   ├── hooks/
│   │   │   └── useTrackNavigation.ts  # Registra rotas no ring buffer de telemetria (F-26)
│   │   ├── components/
│   │   │   ├── AppLayout.tsx    # Shell: Navbar + Outlet + FAB + modais + banners
│   │   │   ├── Navbar.tsx       # Nav + badge de sync + FSA guard
│   │   │   ├── FAB.tsx          # Botão de ação flutuante
│   │   │   ├── TransactionDrawer.tsx # Formulário de transação (drawer lateral)
│   │   │   ├── PeriodSelector.tsx    # Seletor de período compartilhado
│   │   │   ├── ConflictModal.tsx     # Resolução de conflito de arquivo
│   │   │   ├── BugReportDialog.tsx   # Reporte opt-in com snapshot seguro + link GitHub Issues (F-26)
│   │   │   ├── Toast.tsx        # Toast de erro
│   │   │   └── ErrorBoundary.tsx     # Captura exceções → trackError() + botão "Reportar" (F-26)
│   │   ├── pages/
│   │   │   ├── Onboarding/      # Criar perfil ou importar data.json
│   │   │   ├── Dashboard/       # Cards mensais + Minhas Contas + Meus Cartões + donut
│   │   │   ├── Transactions/    # Extrato de caixa (sem cartões) + resumo de gastos
│   │   │   ├── Analytics/       # Shell com 4 views: index.tsx + CashFlowView, CategoriasView, ContasView, TagsView
│   │   │   ├── CreditCard/      # Detalhe de fatura: lançamentos, período, "Pagar Agora"
│   │   │   └── Settings/        # Contas e Cartões, categorias, tags, perfil, preferências, dados, histórico
│   │   └── test/                # setup, fixtures, testes unitários
│   ├── e2e/                     # Testes E2E Playwright
│   ├── vite.config.ts
│   ├── vitest.config.ts
│   ├── playwright.config.ts
│   └── tsconfig*.json
└── CLAUDE.md                    # Regras de desenvolvimento
```

---

## Fluxo de Dados Principal

```
Ação do usuário
  → Método do store (ex: addTransaction())
  → mutate(): structuredClone + aplica mutação + incrementa unsyncedCount
  → debouncedSaveToIdb() em 300ms
  → Usuário clica em Sync (ou há auto-sync)
  → persist(): atualiza fileUpdatedAt, lê disco, detecta conflito,
               chama syncToFile() → mergeDataFiles() → saveDataFile()
               → atualiza store com merged + unsyncedCount = 0
```

---

## Camadas de Persistência

| Camada | Tecnologia | Escopo | Chave / Local |
|--------|-----------|--------|---------------|
| Memória | Zustand (`useDataStore.data`) | Sessão atual | — |
| Primária | SQLite via `wa-sqlite` + OPFS | Sobrevive reload, persistente no browser | `gimbo.db` no OPFS |
| Config UI | localStorage `nexus_workspace` | Sobrevive reload | theme, locale, defaultView, useAmbientShadows |

> **Decisão arquitetural (2026-05-26):** A camada FSA/JSON (File System Access API + `data.json`) foi removida em favor do SQLite/OPFS. Motivação: UX mais simples, confiabilidade ACID vs. JSON frágil, e fundação para sync nativo com app mobile futuro (SQLite é padrão em iOS/Android). O risco de perda de dados por limpeza de cache do browser é aceito como dívida temporária, mitigado pelo mecanismo de export/import do arquivo `.db` (ST-01). Detalhes do plano em `BACKLOG.md` épico ST.

> **Migração IDB legado (transitório):** `App.tsx` mantém um bloco de migração IDB→SQLite enquanto usuários com dados na versão anterior fazem a transição. Remover em ST-06 (~90 dias após deploy).

---

## Fluxo de Dados Principal

```
Ação do usuário
  → Método do store (ex: addTransaction())
  → mutate(): structuredClone + aplica mutação
  → debouncedReplaceAll() em 300ms
  → storage.replaceAll(data) — escreve SQLite via worker
```

---

## Sequência de Startup (`App.tsx`)

```
init():
  1. initWorkspace()              — carrega localStorage → useWorkspaceStore
  2. storage.loadDataFile()       — lê SQLite (OPFS) → DataFile | null
  3. [migração IDB→SQLite]        — transitório: se SQLite vazio e IDB tem dados,
                                    migra e limpa IDB. Remover em ST-06.
  4. Se há dados → loadData(saved)

  Route guard: data !== null → AppLayout, senão → /onboarding
```

---

## Arquitetura do Storage SQLite

```
Main Thread
  StorageService (src/services/storage/StorageService.ts)
    └── postMessage ──────────────────────────────────────────────► Worker
                                                          (storage/worker.ts)
                                                            wa-sqlite + OPFS VFS
                                                            gimbo.db (OPFS root)
    ◄── onmessage (result | error) ──────────────────────────────── Worker
```

- **Fila sequencial no worker**: cada mensagem é enfileirada via Promise chain — mutations nunca interleiam entre awaits.
- **WAL mode**: `PRAGMA journal_mode=WAL` — melhor concorrência de leitura; checkpoint antes de cada export.
- **`replaceAll()`**: operação atômica em transação SQL — substitui todas as tabelas de uma vez.
- **`exportBlob()`**: WAL checkpoint + leitura do arquivo OPFS → `ArrayBuffer` → transferido sem cópia.
- **`importBlob()`**: fecha DB, escreve bytes no OPFS, remove WAL/journal, reabre e re-executa migrations.

---

## Roadmap de Sync Multi-Dispositivo (F-27 + F-28)

> Planejado. Não implementado. Detalhes em `plan/SYNC_SCENARIOS.md` (S-08 a S-15) e épicos `MB`/`CS` em `plan/BACKLOG.md`.

### Premissa

A estratégia mobile é **PWA responsiva** (F-27) — mesmo codebase, layout adaptativo — sem app nativo separado.
O sync usa o **Google Drive / Dropbox do próprio usuário** como camada de sincronização.
Nenhum servidor Gimbo é introduzido; a arquitetura local-first é preservada.

### Arquitetura Planejada

```
Google Drive do usuário
  └── Gimbo/
        └── gimbo.db          ← fonte de verdade compartilhada entre devices

Desktop PWA (SQLite/OPFS)  ──pull/push──►  Drive
Mobile PWA  (SQLite/OPFS)  ──pull/push──►  Drive
```

- **OAuth2 PKCE** no browser — sem backend, sem servidor Gimbo.
- **Pull ao abrir** → comparar `modifiedTime` do Drive com timestamp local → merge se necessário.
- **Push após mutações** → debounce 5s → upload do estado local.
- **Merge:** aditivo por UUID. Edições: último `updatedAt` vence. Deleções: `deletedIds` (já no schema). Duplicatas offline: ambas sobrevivem, usuário remove manualmente.

### Módulos Planejados

```
src/lib/cloudSync/
  googleAuth.ts    — OAuth2 PKCE (initiateAuth, handleCallback, refreshToken, revoke)
  googleDrive.ts   — operações de arquivo (upload, download, getMetadata)
  dropboxAuth.ts   — (fase 2)
  dropboxDrive.ts  — (fase 2)
  merge.ts         — mergeForSync(local, remote): DataFile
  syncService.ts   — pullAndMerge(), pushIfNeeded(), SyncResult
```

### Dependência de Schema

O merge requer campo `updatedAt: string` em `Transaction`, `Account`, `Category` e `Tag` (CS-04 → schema v3).

---

## Backup e Restore (aba Dados em Configurações)

| Ação | Mecanismo |
|------|-----------|
| Exportar backup | `storage.exportBlob()` → download `gimbo-backup.db` |
| Importar backup | `input[accept=".db"]` → `storage.importBlob()` → `loadData()` |
| Importar JSON legado | `input[accept=".json"]` → `validateDataFile()` → `storage.replaceAll()` → `loadData()` |

---

## Modelo de Dados

### `DataFile` (`data.json`, schema v2)

```typescript
interface DataFile {
  schemaVersion: number        // atualmente 5
  user: User                   // { name, email, createdAt, updatedAt }
  settings: Settings           // { fileCreatedAt, fileUpdatedAt, auditLogRetentionLimit }
  accounts: Account[]          // { id, name, type, balance, includeInBalance, creditMetadata?, issuerIcon? }
  categories: Category[]       // { id, parentId, name, icon, color, type }
  tags: Tag[]                  // { id, name, color }
  transactions: Transaction[]  // { id, accountId, categoryId, amount, type, date, description, isPaid, tags, installment?, recurrence?, transferAccountId?, referenceMonth? }
  auditLog: AuditEntry[]       // { id, timestamp, action, entity, entityId, summary }
  deletedIds: string[]         // tombstones de entidades deletadas
}
```

Tipos completos em `src/types/index.ts`. Enums:
- `AccountType`: RETAIL | SAVINGS | CREDIT | CRYPTO | FOREX | ASSET | STOCKS | OTHER
- `TransactionType`: INCOME | EXPENSE | TRANSFER | CREDIT_PAYMENT
- `CategoryType`: INCOME | EXPENSE

### `WorkspaceFile` (localStorage `nexus_workspace`)

```typescript
{ theme: 'light' | 'dark' | 'system', locale: 'pt-BR' | 'en-US', defaultView: string, useAmbientShadows: boolean }
```

### Versionamento do Schema

- `CURRENT_SCHEMA_VERSION = 5` (em `schema.ts`)
- Arquivos sem `schemaVersion` tratados como v1, promovidos automaticamente
- Arquivos com versão futura lançam `SchemaVersionError`
- Migrações são bumps idempotentes (campos opcionais não exigem backfill): v1→v2 (`creditMetadata`,
  `installment`), v2→v3 (`valuations`), v3→v4 (`recurrence`), v4→v5 (`referenceMonth` p/ `CREDIT_PAYMENT`)
- Schema físico SQLite (`PRAGMA user_version`, migrações em `services/storage/migrations/*.sql`):
  `v3.sql` adiciona `recurrence_*`, `v4.sql` adiciona `reference_month` (user_version=4)

---

## API dos Módulos de Storage

### `schema.ts`

`CURRENT_SCHEMA_VERSION`, `AUDIT_RETENTION_DEFAULT` (200), `AUDIT_RETENTION_DAYS` (90), `SchemaVersionError`, `DataFileSchema`, `validateDataFile(data)`, `createEmptyDataFile(name, email)`, `createDefaultWorkspace()`, `applyRetention(log, limit)`

### `fileSystem.ts`

`isFsaSupported()`, `setDataHandle(handle)`, `checkHandlePermission(handle)`, `requestHandlePermission()`, `isPermissionNeeded()`, `isHandleLost()`, `getLastWrittenModified()`, `openDataFile()`, `createNewDataFile(data, name?)`, `readCurrentDataFile()`, `saveDataFile(data)`, `downloadDataFile(data, filename?)`, `loadWorkspace()`, `saveWorkspace(w)`

### `indexedDb.ts`

`saveToIdb(data)`, `loadFromIdb()`, `clearIdb()`, `saveSyncMeta(count)`, `loadSyncMeta()`, `saveFileHandle(handle)`, `loadFileHandle()`, `clearFileHandle()`

### `sync.ts`

`importFileToIdb(file)` (onboarding), `syncToFile(local, diskSnapshot)` (sync recorrente)

### `merge.ts`

`mergeDataFiles(local, disk)` — union por UUID, local wins, fileCreatedAt de disk

---

## `useDataStore` — Interface

### Estado

```typescript
data: DataFile | null          // null = sem onboarding
unsyncedCount: number          // badge da Navbar
conflictData: { local, disk } | null
fileHandleLost: boolean
permissionNeeded: boolean
isSecondaryTab: boolean
writeError: boolean
idbQuotaExceeded: boolean
```

### Mutações (via `mutate()` — structuredClone + unsyncedCount++)

`addAccount / updateAccount / deleteAccount`, `addCategory / updateCategory / deleteCategory`, `addTag / updateTag / deleteTag`, `addTransaction / updateTransaction / deleteTransaction`, `deleteInstallmentGroup(parentId)`, `updateUser(patch)`, `setRetentionLimit(limit)`

### `persist()` — Fluxo

1. `isSecondaryTab` → false  
2. `isPermissionNeeded()` → `requestHandlePermission()`  
3. `isHandleLost()` → `saveDataFile()` (picker)  
4. `readCurrentDataFile()` → diskSnapshot  
5. Conflito? → `conflictData`  
6. `syncToFile()` → merge + save → unsyncedCount = 0

---

## `useWorkspaceStore`

```typescript
workspace: WorkspaceFile  // theme, locale, defaultView, useAmbientShadows
init() / setTheme() / setLocale() / setDefaultView() / setAmbientShadows()
```

---

## Padrões Críticos de Implementação

### `parseDateLocal()` (`lib/utils.ts`)

Toda comparação de `tx.date` com mês/ano deve usar `parseDateLocal()`. Nunca `new Date(tx.date)` para `.getMonth()`/`.getFullYear()`.

```typescript
export function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}
```

### Motor de Fatura Virtual (`lib/utils.ts`)

Quatro funções puras — todas usam `parseDateLocal()` internamente:
- `getInvoicePeriod(txDate, closingDay)` — período da fatura (year, month)
- `getInvoiceDueDate(period, dueDay)` — data de vencimento "YYYY-MM-DD"
- `getCurrentInvoiceBalance(transactions, account)` — soma EXPENSE do período corrente
- `getEffectiveCashFlowDate(tx, accounts)` — data efetiva para gráfico de fluxo de caixa

**Regra de `getEffectiveCashFlowDate`:** usar **apenas** no gráfico de fluxo de caixa. Breakdown de categorias usa `tx.date`. `CREDIT_PAYMENT` excluído de Receitas × Despesas.

### Saldo de Conta — Derivado de Transações

Nunca usar `acc.balance` para exibição dinâmica — o campo representa o saldo inicial da conta. O saldo corrente é `balance + INCOME − EXPENSE − TRANSFER` (via `useMemo`). Contas CREDIT: `creditMetadata.limit − getCurrentInvoiceBalance()`.

### Tradução de Tipos de Conta

Sempre `t(\`accounts.${type.toLowerCase()}\`)`. Nunca exibir enum bruto.

---

## AppLayout — Banners e Estados

| Condição | UI |
|----------|----|
| `isSecondaryTab` | Banner fixo vermelho |
| `idbQuotaExceeded` | Banner com botão de export |
| `!fsaSupported && !dismissed` | Banner informativo |
| `writeError` | Toast temporário (5s) |
| `conflictData` | `ConflictModal` |

---

## Detalhes das Páginas

### Dashboard

- **Stat cards** (3 cols) — Receitas, Despesas, Saldo do mês (usa `getEffectiveCashFlowDate`)
- **Minhas Contas** (col-span-2) — contas com `includeInBalance`, saldo derivado
- **Meus Cartões** — seção separada, barra de utilização, link para `/credit-card/:id`
- **Donut** (col-span-1) — despesas do mês por categoria
- **Últimos Lançamentos** — 5 recentes, apenas 1ª parcela de parcelados (M-25)

### Transactions

- Extrato de caixa: exclui transações de contas CREDIT e CREDIT_PAYMENT (M-26)
- Seletor de período via `PeriodSelector` (M-27)
- Card "Resumo de Gastos" em coluna direita (M-32)

### Analytics (Relatórios)

Shell com 4 abas: Categorias | Cash Flow | Contas | Tags (R-01)
- `PeriodSelector` compartilhado (R-02)
- Toggle "Incluir não pagos" global
- **CashFlowView**: `ComposedChart` (barras + linha saldo acumulado) + data grid; usa `getEffectiveCashFlowDate`, exclui `CREDIT_PAYMENT`
- **CategoriasView**: donuts split 50/50 (Receitas/Despesas) + legend com valor e %; drill-down modal por categoria; usa `tx.date`
- **ContasView**: grid de cards por conta + resumo de período; drill-down inline com `CashFlowView` filtrado por conta
- **TagsView**: ranked horizontal bar chart; multi-tag filter com toggle OR/AND

### CreditCard (`/credit-card/:accountId`)

- Card de fatura com navegação por período
- Chips de categoria + lista de transações da fatura
- Resumo de gastos em coluna direita (M-31)
- Painel "Pagar Agora" dedicado (M-30)

### Settings

Abas: Contas e Cartões | Categorias | Tags | Perfil | Preferências | Dados | Histórico
- Contas e Cartões: seções separadas (M-24), saldo inicial editável (M-33)
- Preferências: toggle Ambient Shadows (R-06)

---

## Bug Report System (F-26)

> Documentação completa em `METRICS.md`. Resumo arquitetural abaixo.

### Princípio
Telemetria **zero transmissão automática**. Dados ficam em memória. Usuário aciona e confirma o envio.

### `lib/telemetry.ts`

Ring buffer em memória (`MAX_EVENTS = 100`). Tipos de evento:

```typescript
type SafeEvent =
  | { type: 'navigation'; route: string; ts: number }
  | { type: 'action'; name: string; ts: number }
  | { type: 'error'; message: string; stack: string; route: string; ts: number }
  | { type: 'performance'; metric: string; ms: number; ts: number }
```

API pública: `track()`, `trackNavigation()`, `trackAction()`, `trackError()`, `getSnapshot()`, `buildBugReportSnapshot(options)`.

**Regra de privacidade:** `buildBugReportSnapshot` nunca inclui valores financeiros, nomes, IDs de entidades ou parâmetros de rota — apenas contadores estruturais e metadados do ambiente.

### Fluxo de integração

```
AppLayout (mount)
  → useTrackNavigation()      — registra rotas automaticamente

useDataStore.mutate()
  → trackAction(name)         — registra tipo da ação (não o valor)

ErrorBoundary.componentDidCatch()
  → trackError(error)         — registra stack trace

[Usuário clica "Reportar problema"]
  → BugReportDialog abre
  → buildBugReportSnapshot(options)
  → URL GitHub Issues gerada e aberta em nova aba
```

### Destino do reporte

GitHub Issues via link pré-preenchido — zero backend, zero token:
```
https://github.com/dassan/MyFinanceApp/issues/new?title=...&body=...&labels=bug
```

---

## Testes

### Cobertura Atual (2026-05-24)

- **474 testes unitários passando** — 28 arquivos
- **19 testes E2E passando** — 4 specs
- Cobertura: ~97% statements

### Testes Unitários (Vitest)

- Ambiente: `jsdom`, setup: `src/test/setup.ts`
- Factories: `makeDataFile()` (schemaVersion 2), `makeCreditAccount()`, `makeInstallmentGroup()`
- Threshold: 80% linhas e funções para arquivos críticos

### Testes E2E (Playwright)

- Browser: Chromium only, base URL: `http://localhost:5173`
- Mock de FSA via `addInitScript` — nunca substituir por mocks em memória

### Scripts de Qualidade

```bash
cd app && npm run format:check
cd app && npm run lint
cd app && npx tsc -b --noEmit
cd app && npx vitest run --coverage
cd app && npx playwright test  # opcional local, obrigatório no CI
```

---

## Ferramenta de Benchmark: Sync Organizze → Gimbo

> Ferramenta de desenvolvimento (não faz parte do app). Mantém o Gimbo pareado com a
> conta real do Organizze, usada como benchmark de fidelidade. Arquivos em `data/`
> (diretório no `.gitignore` — dados e token nunca vão ao repositório).

### Arquivos

| Arquivo | Papel |
|---------|-------|
| `data/organizze.py` | Camada de leitura da API do Organizze (`/users`, `/categories`, `/accounts`, `/credit_cards`, `/transactions`), com paginação mensal que contorna o teto de 500 lançamentos/chamada |
| `data/sync_gimbo.py` | Script autossuficiente, executável por demanda: lê a API, converte e escreve um `gimbo.db` (schema SQLite v3) pronto para importar via Configurações → Dados → Importar backup |
| `data/convert_organizze.py` | Conversor offline legado (lê JSONs estáticos exportados). Superado por `sync_gimbo.py`; mantido por referência |

### Fluxo

```
sync_gimbo.py [--start <data> | --window-months N] [--end <data>] [--base gimbo.db] [--out gimbo.db]
  1. autentica (HTTP Basic; token via env ORGANIZZE_TOKEN, email via ORGANIZZE_EMAIL/--email)
  2. busca categorias, contas, cartões e lançamentos mês a mês no horizonte [start, end]
  3. converte em memória → (incremental: funde no --base) → escreve gimbo.db (user_version=4)
```

### Dois modos de operação

| Modo | Ativação | Horizonte | --base | Uso típico |
|------|----------|-----------|--------|-----------|
| **Snapshot** | `--start <data>` (default) | `[start, end]` explícito | preserva só saldos | carga inicial, reconciliação completa |
| **Incremental** | `--window-months N` | últimos N meses (+ futuros via `--end`) | funde transações por id | run diário (1x/dia) |

**Snapshot** reescreve o arquivo inteiro com exatamente a janela; não acumula histórico.

**Incremental** busca só os últimos N meses e faz **merge por id** sobre o `--base`
(default = `--out` se existir): substitui as transações **dentro** da janela `[start, end]`
(a API é autoridade no período → cobre edições *e* exclusões) e **preserva** as transações
fora dela vindas da base. Cadastros (contas/cartões/categorias/tags) são unidos `base ∪ fresco`
(fresco vence) para não quebrar referências de transações antigas. Custo por run:
~3 chamadas de cadastro + (N + meses futuros) de transações — viabiliza o uso diário.

> **Por que não um delta verdadeiro?** A API do Organizze filtra transações por *data do
> lançamento*, não por `updated_at` — não há como pedir "o que mudou desde ontem". Logo, o
> modo incremental **não captura** edições/exclusões de lançamentos *mais antigos que a janela*.
> Mitigação: rodar periodicamente (semanal/mensal) um **snapshot completo** para reconciliar.

### Decisões (acordadas)

- **Saldo inicial = 0.0** em todas as contas. O saldo real é preenchido manualmente no Gimbo (o app deriva o saldo exibido de `balance + transações`). Como o import é por janela de data, os saldos absolutos só batem com o Organizze se a janela cobrir o histórico completo.
- **IDs determinísticos via `uuid5`** (namespace fixo + chave de origem, ex. `organizze:account:{id}`). Re-execuções com a mesma janela geram o mesmo `gimbo.db` — idempotente.
- **Modo merge (`--base`)**: lê um `gimbo.db` anterior e preserva, por id, o `balance` e o `include_in_balance` editados à mão. No **snapshot** preserva só saldos; no **incremental** também funde transações/tags/cadastros (ver "Dois modos de operação").
- **Snapshot completo**: cada execução reescreve o arquivo inteiro com exatamente a janela `[start, end]`. Não acumula histórico — para manter histórico, usar sempre a data inicial mais antiga.
- **Acumulação controlada por janela** (incremental): transações apagadas no Organizze *dentro* da janela são removidas (a API é autoridade no período); fora da janela ficam "presas" até a próxima reconciliação por snapshot — trade-off aceito em troca do baixo custo de API no run diário.
- **`tag_color` determinístico**: cor derivada de `uuid5` do nome (não de `hash()`, que varia por `PYTHONHASHSEED`) — estável entre execuções e re-merges.
- **`--end` futuro** inclui lançamentos agendados/recorrentes e parcelas a vencer (chegam com `paid=false` → `isPaid=false` no Gimbo). Default = hoje.
- **Recorrência**: cada ocorrência do Organizze entra como transação avulsa (fiel ao extrato); as colunas `recurrence_*` ficam NULL. Não há reconstrução de séries M-35.
- **Estornos (B-16)**: valores positivos no cartão (crédito/estorno no Organizze) são gravados como `INCOME` na conta `CREDIT` (preserva o sinal), abatendo a fatura — não como `EXPENSE`.
- **Pagamento de fatura (B-16)**: `CREDIT_PAYMENT` recebe `reference_month` inferido como o mês do pagamento − 1 (o vencimento cai no mês seguinte ao período da fatura).

### Mapeamento Organizze → Gimbo

| Origem | Destino |
|--------|---------|
| `/accounts` (`checking`/`savings`/`other`/null) | `accounts` → `RETAIL`/`SAVINGS`/`OTHER`; `issuerIcon` por `institution_id` (mapa para `nubank`/`itau`/`bradesco`/`inter`/`santander`/`caixa`, senão NULL) |
| `/credit_cards` | `accounts` `type=CREDIT` + `creditMetadata {limit_cents/100, closing_day, due_day}` |
| `/categories` (`kind`, `parent_id`) | `categories` (`expenses→EXPENSE`, `earnings/none→INCOME/EXPENSE`, hierarquia, ícone inferido por nome, cor normalizada) + 2 categorias fallback |
| `paid_credit_card_id` | `CREDIT_PAYMENT` (account=cartão, `transferAccountId`=conta, sem categoria) |
| `oposite_transaction_id` + valor < 0 | `TRANSFER` (lado positivo espelhado é descartado) |
| `credit_card_id` | `EXPENSE` na conta do cartão |
| demais | `INCOME`/`EXPENSE` pelo sinal de `amount_cents` |
| `total_installments > 1` | `installment {parentId, currentIndex, total}` (parent agrupado por heurística description+source+valor+total) |
| `tags: [{name}]` | entidades `Tag` (uuid5 por nome + cor determinística) + `transaction_tags` |

### Uso

```bash
# token e email via ambiente (PowerShell)
$env:ORGANIZZE_TOKEN="..."; $env:ORGANIZZE_EMAIL="voce@mail.com"

python data/sync_gimbo.py --start 2020-01-01                      # snapshot até hoje
python data/sync_gimbo.py --start 2020-01-01 --end 2026-12-31     # inclui futuros/não pagos
python data/sync_gimbo.py --start 2015-01-01 --base data/gimbo.db --out data/gimbo.db  # preserva saldos

# Incremental (1x/dia): só os últimos 2 meses, funde no gimbo.db existente
python data/sync_gimbo.py --window-months 2 --base data/gimbo.db
python data/sync_gimbo.py --window-months 2 --end 2026-12-31 --base data/gimbo.db  # + agendados/futuros
```

O resumo final reporta contagens (contas, categorias, tags, transações + não pagas) e itens ignorados (espelhos de transferência, contas não encontradas).

# Gimbo — Arquitetura Técnica

> Documento de referência técnica completa. Para regras de desenvolvimento, veja `../CLAUDE.md`.
> Para decisões de cartão de crédito, veja `CREDIT_CARD.md`. Para cenários de sync, veja `SYNC_SCENARIOS.md`.
> Para o módulo de relatórios, veja `REPORTS.md`.

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
│   │   ├── components/
│   │   │   ├── AppLayout.tsx    # Shell: Navbar + Outlet + FAB + modais + banners
│   │   │   ├── Navbar.tsx       # Nav + badge de sync + FSA guard
│   │   │   ├── FAB.tsx          # Botão de ação flutuante
│   │   │   ├── TransactionDrawer.tsx # Formulário de transação (drawer lateral)
│   │   │   ├── PeriodSelector.tsx    # Seletor de período compartilhado
│   │   │   ├── ConflictModal.tsx     # Resolução de conflito de arquivo
│   │   │   ├── Toast.tsx        # Toast de erro
│   │   │   └── ErrorBoundary.tsx
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
| Cache | IndexedDB `nexus-db` v2 | Sobrevive reload | `ledger/'current'` |
| Sync meta | IndexedDB `nexus-db` v2 | Sobrevive reload | `ledger/'sync-meta'` |
| FileHandle | IndexedDB `nexus-db` v2 | Sobrevive reload | `handles/'data'` |
| Disco | File System Access API (`data.json`) | Portável, permanente | Escolhido pelo usuário |
| Config UI | localStorage `nexus_workspace` | Sobrevive reload | theme, locale, defaultView, useAmbientShadows |
| FSA notice | localStorage `nexus_fsa_notice_seen` | Sobrevive reload | banner dismissível |

---

## Sequência de Startup (`App.tsx`)

```
init() — executa em paralelo:
  1. initWorkspace()           — carrega localStorage → useWorkspaceStore
  2. loadFromIdb()             — carrega DataFile do IDB → useDataStore.loadData()
  3. loadFileHandle()          — carrega FileSystemFileHandle do IDB
  4. loadSyncMeta()            — carrega { unsyncedCount } do IDB

Após carregar:
  - Se IDB tem dados → loadData(saved) → restaura unsyncedCount
  - Se há handle → checkHandlePermission(handle)
      'granted' → _dataHandle injetado
      'prompt'  → permissionNeeded = true
      'denied'  → fileHandleLost = true
  - initTabGuard() — BroadcastChannel
  - Route guard: data !== null → AppLayout, senão → /onboarding
```

---

## Máquina de Estados do FileHandle

```
startup → checkHandlePermission(handle)
  ├── 'granted'  → _dataHandle injetado; sync pronto
  ├── 'prompt'   → _pendingHandle; ícone azul
  └── 'denied'   → fileHandleLost = true; ícone vermelho

persist() →
  ├── isPermissionNeeded() → requestHandlePermission()
  ├── isHandleLost() → saveDataFile() (picker)
  └── normal → readCurrentDataFile() → conflito? → syncToFile()
```

---

## Dois Caminhos de Persistência (`sync.ts`)

| Função | Uso | Comportamento |
|--------|-----|---------------|
| `importFileToIdb(file)` | Onboarding e Settings import | Valida Zod, limpa IDB, salva (replace total) |
| `syncToFile(local, diskSnapshot)` | `persist()` recorrente | Merge por UUID + write |

> **CRÍTICO**: nunca misturar os dois caminhos.

---

## Estratégia de Merge (`merge.ts`)

- `schemaVersion`: local wins
- `user`: local wins
- `settings`: local wins, **exceto `fileCreatedAt`** (vem do disco)
- `accounts`, `categories`, `tags`, `transactions`: union por `id` — local wins; itens só no disco são recuperados (exceto tombstones em `deletedIds`)
- `auditLog`: union por `id`, ordenado por `timestamp` ASC, retenção aplicada
- Detecção de conflito: `File.lastModified > _lastWrittenModified` → `ConflictModal`

---

## Modo Fallback sem FSA (Firefox/Safari)

Quando `typeof window?.showSaveFilePicker !== 'function'`:
- Navbar: ícone de sync oculto
- AppLayout: banner dismissível
- Onboarding "Novo Perfil": `downloadDataFile()` imediato
- Settings Import: `<input type="file">` em vez de `openDataFile()`
- Settings Export: `downloadDataFile()` (sem mudança)

---

## Modelo de Dados

### `DataFile` (`data.json`, schema v2)

```typescript
interface DataFile {
  schemaVersion: number        // atualmente 2
  user: User                   // { name, email, createdAt, updatedAt }
  settings: Settings           // { fileCreatedAt, fileUpdatedAt, auditLogRetentionLimit }
  accounts: Account[]          // { id, name, type, balance, includeInBalance, creditMetadata?, issuerIcon? }
  categories: Category[]       // { id, parentId, name, icon, color, type }
  tags: Tag[]                  // { id, name, color }
  transactions: Transaction[]  // { id, accountId, categoryId, amount, type, date, description, isPaid, tags, installment?, transferAccountId? }
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

- `CURRENT_SCHEMA_VERSION = 2` (em `schema.ts`)
- Arquivos sem `schemaVersion` tratados como v1, promovidos automaticamente
- Arquivos com versão futura lançam `SchemaVersionError`
- Migração v1→v2: promove `schemaVersion`; campos opcionais não exigem backfill

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

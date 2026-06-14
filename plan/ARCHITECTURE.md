# Gimbo — Arquitetura Técnica

> Documento de referência técnica completa. Para regras de desenvolvimento, veja `../CLAUDE.md`.
> Para decisões de cartão de crédito, veja `CREDIT_CARD.md`. Para cenários de sync, veja `SYNC_SCENARIOS.md`.
> Para o módulo de relatórios, veja `REPORTS.md`. Para o histórico da migração de storage, veja `STORAGE.md`.
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
| Persistência (banco) | SQLite via `wa-sqlite` (WASM) + OPFS | 1.x |
| Persistência (handle de pasta de backup) | IndexedDB via `idb` | 8.x |
| Backup em pasta local | File System Access API | nativa (Chrome/Edge) |
| Gráficos | Recharts | 3.x |
| i18n | i18next + react-i18next | 26.x / 17.x |
| PWA | vite-plugin-pwa | 1.x |
| Ícones | Lucide React | 1.x |
| Utilitários CSS | clsx + tailwind-merge | — |
| Testes unitários | Vitest + Testing Library | 3.x / 16.x |
| Testes E2E | Playwright | 1.x (Chromium desktop + mobile) |
| Lint | ESLint (flat config) | 9.x |
| Formatter | Prettier | 3.x |
| Gerenciador de pacotes | npm | — |

**Node.js**: 22 (requerido pelo CI)

> `idb` é usado apenas por `lib/backupDir.ts` para persistir o `FileSystemDirectoryHandle` da pasta
> de backup local (Nível 1) entre sessões — não é mais o motor de persistência principal. A
> migração transitória IDB→SQLite (mencionada em versões anteriores deste documento) já foi
> concluída e removida de `App.tsx`.

---

## Estrutura de Diretórios

```
MyFinanceApp/
├── .github/workflows/           # CI (ci.yml) + auditoria semanal (audit.yml)
├── plan/
│   ├── PRD.md                   # Requisitos de produto (features F-1 a F-28)
│   ├── BACKLOG.md               # Bugs (B-XX), melhorias (M-XX), cartão (CC-XX), relatórios (R-XX)
│   ├── RULES.md                 # Workflow IA + humano
│   ├── ARCHITECTURE.md          # Este arquivo
│   ├── CREDIT_CARD.md           # Decisões e arquitetura do módulo de cartão de crédito
│   ├── SYNC_SCENARIOS.md        # Cenários de sincronização e recuperação
│   ├── REPORTS.md               # Épico do módulo analítico avançado (Analytics)
│   ├── METRICS.md               # Telemetria local e Bug Report System (F-26)
│   ├── STORAGE.md               # Histórico da decisão JSON/FSA → SQLite/OPFS
│   └── NET_WORTH.md             # Handoff de implementação do Patrimônio Líquido (F-24)
├── design/
│   ├── DESIGN.md                 # Sistema de design "Fluid Ledger" (fonte única)
│   └── *.png                     # Mockups de telas
├── app/
│   ├── src/
│   │   ├── main.tsx              # Entry point (StrictMode + i18n)
│   │   ├── App.tsx               # Startup, hidratação, route guard, error boundary
│   │   ├── types/index.ts        # Todas as entidades TypeScript
│   │   ├── assets/
│   │   │   └── demo-data.json    # Dataset sintético do Demo Mode (F-25)
│   │   ├── lib/
│   │   │   ├── utils.ts          # cn(), uuid(), formatCurrency(), parseDateLocal(), motor de fatura virtual
│   │   │   ├── backupDir.ts      # File System Access: handle de pasta de backup local (BK-02/03)
│   │   │   ├── demo.ts           # isDemoMode() + loadDemoData() (F-25)
│   │   │   ├── telemetry.ts      # Ring buffer de eventos seguros + buildBugReportSnapshot() (F-26)
│   │   │   ├── i18n/             # Config i18next + locales (pt-BR, en-US)
│   │   │   └── storage/
│   │   │       └── schema.ts     # Schemas Zod + factories + applyRetention() + migrações em memória
│   │   ├── services/
│   │   │   └── storage/
│   │   │       ├── index.ts          # Singleton `storage` (StorageService)
│   │   │       ├── StorageService.ts # API tipada usada pela app (main thread)
│   │   │       ├── worker.ts         # Web Worker: wa-sqlite + OPFS, runMigrations()
│   │   │       └── migrations/       # v1.sql .. v7.sql — schema físico incremental
│   │   ├── store/
│   │   │   ├── useDataStore.ts  # Dados financeiros + mutações + persistência debounced
│   │   │   └── useWorkspaceStore.ts # Preferências UI (tema, locale, shadows, net worth)
│   │   ├── hooks/
│   │   │   └── useTrackNavigation.ts  # Registra rotas no ring buffer de telemetria (F-26)
│   │   ├── components/
│   │   │   ├── AppLayout.tsx     # Shell: Navbar + Outlet + FAB + TransactionDrawer + banners
│   │   │   ├── Navbar.tsx        # Nav superior (desktop) + nav inferior (mobile)
│   │   │   ├── FAB.tsx           # Botão de ação flutuante "novo lançamento"
│   │   │   ├── TransactionDrawer.tsx # Formulário de transação (drawer lateral)
│   │   │   ├── DatePicker.tsx    # Date picker custom (nativo em mobile, popup calendário em desktop — M-47)
│   │   │   ├── PeriodSelector.tsx    # Seletor de período (mês/custom) + períodos salvos (M-45)
│   │   │   ├── WelcomeModal.tsx  # Splash de primeira execução: privacidade + setup de backup
│   │   │   ├── BugReportDialog.tsx   # Reporte opt-in com snapshot seguro + link GitHub Issues (F-26)
│   │   │   ├── ErrorBoundary.tsx     # Captura exceções → trackError() + botão "Reportar" (F-26)
│   │   │   └── Toast.tsx         # Toast de notificação
│   │   ├── pages/
│   │   │   ├── Onboarding/      # Criar novo cofre ou importar backup .db
│   │   │   ├── Dashboard/       # Cards mensais + Minhas Contas + Meus Cartões + donut + recentes
│   │   │   ├── Transactions/    # Extrato de caixa (sem cartões) + resumo de gastos
│   │   │   ├── Analytics/       # Shell com 5 views: index.tsx + CategoriasView, CashFlowView, ContasView, TagsView, FaturasView
│   │   │   ├── CreditCard/      # Detalhe de fatura: período, lançamentos, filtro/busca, "Pagar Agora"
│   │   │   ├── NetWorth/        # Patrimônio líquido: ativos − passivos, valuations
│   │   │   ├── Settings/        # Contas e Cartões, Categorias, Tags, Perfil, Preferências, Backup & Sync, Histórico
│   │   │   ├── About/           # Sobre o Gimbo: cobertura de testes, arquitetura
│   │   │   ├── Docs/            # Páginas estáticas de ajuda (por que storage local, backup local, cloud sync)
│   │   │   └── Legal/           # Política de privacidade, termos de uso
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
  → mutate(): structuredClone(data) + aplica mutação + registra entrada no Audit Log
  → debouncedReplaceAll() em 300ms
       → storage.replaceAll(data)  — substitui todas as tabelas do SQLite numa transação
       → (se houver pasta de backup configurada) escreve uma cópia via File System Access API
  → store atualizado com o novo `data`
```

Não há "sync" no sentido de merge entre dispositivos — cada dispositivo tem seu próprio banco
SQLite local. Backup/restore é feito via export/import de um arquivo `.db` (ou automaticamente
para uma pasta local configurada). Sync multi-dispositivo via nuvem está no roadmap (ver
"Roadmap de Backup & Sync" abaixo).

---

## Camadas de Persistência

| Camada | Tecnologia | Escopo | Chave / Local |
|--------|-----------|--------|---------------|
| Memória | Zustand (`useDataStore.data`) | Sessão atual | — |
| Primária | SQLite via `wa-sqlite` + OPFS | Sobrevive a reload, persistente no browser | `gimbo.db` no OPFS |
| Backup local (opcional, Nível 1) | File System Access API | Pasta escolhida pelo usuário, escrita após cada mutação | `*.db` na pasta configurada |
| Config UI | localStorage `nexus_workspace` | Sobrevive a reload | theme, locale, defaultView, useAmbientShadows, netWorthIncludeHidden |
| Handle da pasta de backup | IndexedDB (via `idb`) | Sobrevive a reload | `FileSystemDirectoryHandle` serializado |

> **Decisão arquitetural (2026-05-26, ver `STORAGE.md`):** a camada FSA/JSON (`data.json` como
> arquivo principal, com merge por UUID) foi substituída por SQLite/OPFS. Motivação: UX mais
> simples (sem re-permissão constante para o arquivo principal), confiabilidade ACID vs. JSON
> frágil, e fundação para sync nativo com app mobile futuro (SQLite é padrão em iOS/Android). O
> risco de perda de dados por limpeza de cache do browser é mitigado por (a) export manual de
> backup `.db` e (b) backup automático opcional em pasta local (Nível 1, `BK-01..BK-07`).

---

## Sequência de Startup (`App.tsx`)

```
init() (useEffect on mount):
  1. Tema — aplica classe no <html> root (light/dark/system); se "system", escuta
     prefers-color-scheme e atualiza dinamicamente.
  2. initWorkspace()         — carrega localStorage → useWorkspaceStore
  3. isDemoMode()?           — se true, carrega lib/demo.ts → loadDemoData() e retorna
                                (mutações tornam-se no-op; ver F-25)
  4. [apenas em DEV] parâmetros de URL:
       ?devSeed   — busca public/dev/seed.json, valida, grava via storage.replaceAll(),
                     limpa o parâmetro da URL
       ?devReset  — limpa storage SQLite + localStorage + handle de backup, limpa a URL
  5. storage.loadDataFile()  — lê o SQLite (OPFS) → DataFile | null
  6. hydrated = true         — só após os passos acima (evita flash de conteúdo)
  7. Erros são capturados e exibidos numa tela de erro (initError)

Route guard:
  hydrated === false  → não renderiza nada
  initError !== null  → tela de erro com a mensagem
  data === null       → todas as rotas redirecionam para /onboarding
  data !== null       → AppLayout com as rotas protegidas

Rotas públicas (sempre acessíveis): /onboarding, /privacy, /terms
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

- **Fila sequencial no worker**: cada mensagem é enfileirada via Promise chain — mutações nunca interleiam entre awaits.
- **WAL mode**: `PRAGMA journal_mode=WAL` — melhor concorrência de leitura; checkpoint antes de cada export.
- **`replaceAll()`**: operação atômica em transação SQL — substitui todas as tabelas de uma vez.
- **`exportBlob()`**: WAL checkpoint + leitura do arquivo OPFS → `Blob` (usado tanto pelo botão "Exportar" quanto pelo backup automático em pasta local).
- **`importBlob()`**: fecha DB, escreve bytes no OPFS, remove WAL/journal, reabre e re-executa `runMigrations()`.
- Em modo `DEV`, o singleton `storage` é exposto em `window.__storage` para os testes E2E (Playwright) semearem o banco via `replaceAll()` antes de cada cenário.

### `StorageService` — API pública

| Grupo | Métodos |
|-------|---------|
| Usuário | `getUser()`, `upsertUser(user)` |
| Configurações | `getSettings()`, `upsertSettings(settings)` |
| Contas | `getAccounts()`, `createAccount(data)`, `updateAccount(id, data)`, `deleteAccount(id)` |
| Categorias | `getCategories()`, `createCategory(data)`, `updateCategory(id, data)`, `deleteCategory(id)` |
| Tags | `getTags()`, `createTag(data)`, `updateTag(id, data)`, `deleteTag(id)` |
| Transações | `getTransactions(filters?)`, `createTransaction(data)`, `updateTransaction(id, data)`, `deleteTransaction(id)`, `deleteTransactionGroup(parentId)` |
| Audit Log | `getAuditLog()`, `addAuditEntry(entry)`, `trimAuditLog(maxEntries)` |
| Tombstones | `getDeletedIds()`, `addDeletedId(id)` |
| Valuations | `getValuations()` |
| Períodos salvos | `getSavedPeriods()` (M-45) |
| Export/Import/Versão | `exportBlob()`, `importBlob(blob)`, `getDatabaseVersion()` |
| Bulk | `loadDataFile()` — monta um `DataFile` completo a partir de todas as tabelas; `replaceAll(data)` — substitui tudo numa transação; `clearAll()` |
| Lifecycle | `terminate()` |

---

## Roadmap de Backup & Sync (F-28)

### Nível 0 — Somente navegador (implementado)
SQLite/OPFS local (ver acima). Risco: limpeza de dados do browser (`Clear site data`) apaga o
cofre — mitigado pelos níveis abaixo.

### Nível 1 — Pasta local (implementado, `BK-01..BK-07`)
Settings → "Backup & Sync" permite escolher uma pasta via File System Access API
(`lib/backupDir.ts`). Após cada mutação (debounce de `useDataStore`), `storage.exportBlob()` é
gravado nessa pasta. O `FileSystemDirectoryHandle` é persistido via `idb` e re-validado
(`ensureBackupDirPermission`) a cada gravação; se a permissão expirar, `AppLayout` exibe um
banner de reconexão (`backupPermState === 'prompt' | 'denied'`).

> Se a pasta escolhida estiver dentro do Google Drive, Dropbox ou OneDrive, o sync para a nuvem
> ocorre automaticamente pelo cliente desktop instalado — sem OAuth, sem código adicional. Cobre
> a maioria dos usuários desktop sem precisar do Nível 2. Disponível apenas em Chrome/Edge (FSA).

### Nível 2 — Cloud Sync (planejado, `CS-01..CS-12`)
Sincronização ponta-a-ponta entre dispositivos via Google Drive ou Dropbox do próprio usuário,
sem servidor Gimbo:

```
Google Drive do usuário
  └── Gimbo/
        └── gimbo.db          ← fonte de verdade compartilhada entre devices

Desktop PWA (SQLite/OPFS)  ──pull/push──►  Drive
Mobile PWA  (SQLite/OPFS)  ──pull/push──►  Drive
```

- **OAuth2 PKCE** no browser — sem backend, sem servidor Gimbo.
- **Pull ao abrir** → comparar `modifiedTime` do Drive com timestamp local → merge se necessário.
- **Push após mutações** → debounce → upload do `.db`.
- **Merge:** aditivo por UUID. Edições: último `updatedAt` vence (requer adicionar `updatedAt` a
  `Transaction`/`Account`/`Category`/`Tag` — `CS-04`). Deleções: `deletedIds` (já no schema).
  Duplicatas offline: ambas sobrevivem, usuário remove manualmente.

Módulos planejados em `src/lib/cloudSync/` (googleAuth, googleDrive, dropboxAuth, dropboxDrive,
merge, syncService) — ver itens `CS-01` a `CS-12` em `plan/BACKLOG.md`.

---

## Backup e Restore (aba "Backup & Sync" em Configurações)

| Ação | Mecanismo |
|------|-----------|
| Exportar backup | `storage.exportBlob()` → download `gimbo-backup.db` |
| Importar backup | `input[accept=".db"]` → `storage.importBlob()` → `App` recarrega via `storage.loadDataFile()` |
| Configurar pasta de backup local | `showDirectoryPicker()` → `saveBackupDirHandle()` (idb) — escrita automática após cada mutação (Nível 1) |
| Restaurar de pasta | lê o `.db` mais recente da pasta configurada → `storage.importBlob()` |
| Remover pasta configurada | `clearBackupDirHandle()` |

---

## Modelo de Dados

### `DataFile` (schema v9)

```typescript
interface DataFile {
  schemaVersion: number        // atualmente 9
  user: User                    // { name, email, createdAt, updatedAt }
  settings: Settings            // { fileCreatedAt, fileUpdatedAt, auditLogRetentionLimit: number | null }
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  transactions: Transaction[]
  valuations: Valuation[]       // NW-08: snapshots de valor de mercado (STOCKS/CRYPTO/FOREX/ASSET)
  auditLog: AuditEntry[]
  deletedIds: string[]           // tombstones de entidades deletadas neste device (B-11)
  savedPeriods: SavedPeriod[]    // M-45: períodos customizados salvos no seletor de Relatórios
}
```

### Entidades

```typescript
interface Account {
  id: string
  name: string
  type: AccountType
  balance: number               // saldo inicial — nunca exibido diretamente
  includeInBalance: boolean
  creditMetadata?: CreditMetadata // apenas contas CREDIT
  issuerIcon?: string             // 'nubank' | 'itau' | 'bradesco' | 'inter' | 'santander' | 'caixa' | 'generic' | undefined (M-34)
  archived?: boolean               // M-42: oculta de seletores/listas, mas continua contando em saldos/totais
}

interface CreditMetadata {
  limit: number
  closingDay: number   // 1–31
  dueDay: number       // 1–31
}

interface Category {
  id: string
  parentId: string | null
  name: string
  icon: string
  color: string
  type: CategoryType
}

interface Tag {
  id: string
  name: string
  color: string
}

interface Installment {
  parentId: string     // UUID da primeira parcela do grupo
  currentIndex: number // 1-based
  total: number        // mínimo 2
}

type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly'

interface Recurrence {
  frequency: RecurrenceFrequency
  parentId: string     // UUID da primeira ocorrência da série
  endDate?: string     // ausente → gerado até horizonte de 12 meses (M-35)
}

interface Transaction {
  id: string
  accountId: string
  categoryId: string
  amount: number
  type: TransactionType
  date: string                  // ISO 8601 — sempre via parseDateLocal()
  description: string
  isPaid: boolean
  tags: string[]                 // UUID[]
  installment?: Installment       // apenas compras parceladas
  recurrence?: Recurrence          // M-35: séries recorrentes de INCOME/EXPENSE
  transferAccountId?: string       // TRANSFER: conta destino; CREDIT_PAYMENT: conta pagadora
  referenceMonth?: string          // "YYYY-MM" — fatura à qual o lançamento (em conta CREDIT) está associado (B-18)
  invoiceDueDate?: string           // "YYYY-MM-DD" — vencimento autoritativo da fatura, capturado na origem (CC-33)
}

interface Valuation {
  id: string
  accountId: string    // deve ser STOCKS | CRYPTO | FOREX | ASSET
  date: string         // ISO 8601 — data do snapshot de valor de mercado
  marketValue: number
}

interface SavedPeriod {           // M-45
  id: string
  name: string
  start: string        // YYYY-MM-DD
  end: string           // YYYY-MM-DD
}

interface AuditEntry {
  id: string
  timestamp: string     // ISO 8601
  action: AuditAction    // 'CREATE' | 'UPDATE' | 'DELETE'
  entity: AuditEntity     // 'account' | 'category' | 'tag' | 'transaction' | 'user' | 'savedPeriod'
  entityId: string
  summary: string        // texto legível, gerado no idioma ativo no momento da mutação
}
```

### Enums

- `AccountType`: `RETAIL | SAVINGS | CREDIT | CRYPTO | FOREX | ASSET | STOCKS | OTHER`
- `TransactionType`: `INCOME | EXPENSE | TRANSFER | CREDIT_PAYMENT`
- `CategoryType`: `INCOME | EXPENSE`

### `WorkspaceFile` (localStorage `nexus_workspace`)

```typescript
interface WorkspaceFile {
  theme: 'light' | 'dark' | 'system'
  locale: 'pt-BR' | 'en-US'
  defaultView: string
  useAmbientShadows: boolean
  netWorthIncludeHidden: boolean // inclui contas com includeInBalance=false no Patrimônio (default true)
}
```

### Versionamento do Schema

- `CURRENT_SCHEMA_VERSION = 9` (em `lib/storage/schema.ts`)
- Arquivos com versão antiga são migrados automaticamente; arquivos de versão futura lançam `SchemaVersionError`
- Migrações são bumps idempotentes (campos opcionais não exigem backfill):
  - **v1→v2**: `creditMetadata` (Account) e `installment` (Transaction)
  - **v2→v3**: `valuations: []` (NW-08)
  - **v3→v4**: `recurrence` (Transaction, M-35)
  - **v4→v5**: `referenceMonth` (Transaction, inicialmente só `CREDIT_PAYMENT`)
  - **v5→v6**: generaliza `referenceMonth` para qualquer transação de conta CREDIT (B-18)
  - **v6→v7**: `invoiceDueDate` (Transaction, CC-33)
  - **v7→v8**: `archived` (Account, M-42)
  - **v8→v9**: `savedPeriods: []` (M-45)
- Schema físico SQLite (`PRAGMA user_version`, migrações em `services/storage/migrations/*.sql`):
  - `v1.sql` — tabelas base (`users`, `settings`, `accounts`, `categories`, `tags`, `transactions`
    com colunas de parcelamento, `transaction_tags`, `audit_log`, `deleted_ids`)
  - `v2.sql` — tabela `valuations`
  - `v3.sql` — colunas `recurrence_*` em `transactions`
  - `v4.sql` — coluna `reference_month`
  - `v5.sql` — coluna `invoice_due_date`
  - `v6.sql` — coluna `archived` em `accounts` (default 0)
  - `v7.sql` — tabela `saved_periods`

  As migrações `v8`/`v9` do schema em memória não exigem alteração de DDL (campos já cobertos
  pelas colunas/tabelas acima), por isso não há `v8.sql`/`v9.sql`.

---

## `useDataStore` — Interface

### Estado

```typescript
data: DataFile | null   // null = sem cofre criado (route guard → /onboarding)
```

### Mutações (via `mutate()` — `structuredClone` + aplica + audit log + persistência debounced)

| Grupo | Ações |
|-------|-------|
| Ciclo de vida | `loadData(data)`, `clearData()` |
| Contas | `addAccount`, `updateAccount`, `deleteAccount` |
| Categorias | `addCategory`, `updateCategory`, `deleteCategory` |
| Tags | `addTag`, `updateTag`, `deleteTag` |
| Transações | `addTransaction`, `updateTransaction`, `deleteTransaction`, `deleteInstallmentGroup(parentId)`, `deleteRecurrenceFrom(parentId, fromDate)` (M-35) |
| Valuations | `addValuation`, `updateValuation`, `deleteValuation` |
| Períodos salvos | `addSavedPeriod`, `deleteSavedPeriod` (M-45) |
| Usuário/Config | `updateUser(patch)`, `setRetentionLimit(limit)` |

### `mutate()` / persistência

```typescript
function mutate(state, fn: (data: DataFile) => void, actionName?: string) {
  const data = structuredClone(state.data)
  fn(data)                       // aplica a mutação + addAudit()
  debouncedReplaceAll(data)       // 300ms debounce
  if (actionName) trackAction(actionName)
  return { data }
}

function debouncedReplaceAll(data: DataFile) {
  if (isDemoMode()) return       // F-25: mutações são no-op em modo demo
  // após 300ms sem novas mutações:
  storage.replaceAll(data).then(() => _triggerLocalBackup())
}
```

`_triggerLocalBackup()` (se houver pasta configurada): `storage.exportBlob()` →
`writeBackupToDir(handle, blob)` → grava timestamp em `localStorage['gimbo_backup_last_saved']`.
Falhas de backup nunca interrompem o fluxo principal.

---

## `useWorkspaceStore`

```typescript
workspace: WorkspaceFile
init()
setTheme(theme)
setLocale(locale)
setDefaultView(view)
setAmbientShadows(v)
setNetWorthIncludeHidden(v)  // D3
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

Funções puras — todas usam `parseDateLocal()` internamente:

- `getInvoicePeriod(txDate, closingDay)` — período (year, month) pela data + dia de fechamento
- `getTxInvoicePeriod(tx, account)` — `referenceMonth` se presente, senão `getInvoicePeriod` (B-18)
- `getInvoiceDueDate(period, dueDay, closingDay)` — data de vencimento "YYYY-MM-DD"
- `invoicePeriodKey(period)` — formata `{year, month}` como `"YYYY-MM"`
- `getInvoiceTotal(transactions, account, period)` — Σ EXPENSE − Σ INCOME (créditos/estornos) do período
- `getInvoicePaid(transactions, account, period)` — Σ `CREDIT_PAYMENT` cujo `referenceMonth` é o período
- `getInvoiceStatus(total, paid)` — `'open' | 'partial' | 'paid'`
- `getCurrentInvoiceBalance(transactions, account)` — total da fatura do período corrente
- `getOpenCreditBalance(transactions, account)` — fatura **atual** em aberto (total do período − pagamentos do período); base do limite disponível e do passivo (B-16)
- `getTotalCreditLiability(transactions, account)` — = `getOpenCreditBalance` (passivo total exibido no Patrimônio)
- `isCardCredit(tx, accounts)` — `true` se `tx` é um estorno/crédito (`INCOME`) numa conta CREDIT
- `getEffectiveCashFlowDate(tx, accounts)` — data efetiva para o gráfico de fluxo de caixa

**Regras:** `getEffectiveCashFlowDate` é usada **apenas** no gráfico de fluxo de caixa (e em
relatórios derivados dele). Breakdown de categorias usa `tx.date`. `CREDIT_PAYMENT` é excluído de
Receitas × Despesas (é liquidação de passivo, não fluxo). Estornos (`isCardCredit`) abatem
despesas — nunca contam como receita de caixa.

### Saldo de Conta — Derivado de Transações

Nunca usar `acc.balance` para exibição dinâmica — o campo representa o saldo inicial da conta. O
saldo corrente é `balance + INCOME − EXPENSE − TRANSFER − CREDIT_PAYMENT` (`CREDIT_PAYMENT` debita
a conta pagadora). Contas `CREDIT` exibem **limite disponível** =
`creditMetadata.limit − getOpenCreditBalance(transactions, account)`.

### Tradução de Tipos de Conta

Sempre `t(\`accounts.${type.toLowerCase()}\`)`. Nunca exibir enum bruto.

### Outros helpers de `lib/utils.ts`

- `filterArchivedAccounts(accounts, keepId?)` — M-42: oculta `archived: true` dos seletores, preservando a já selecionada
- `sortCategoriesHierarchical(categories)` — ordena categorias-raiz alfabeticamente, agrupando filhas após cada pai (M-46)
- `isCashRealized(tx)` — `true` para `TRANSFER`/`CREDIT_PAYMENT` (sempre realizados) ou `tx.isPaid`

---

## AppLayout — Banners e Modais

| Condição | UI |
|----------|----|
| `isDemoMode()` | Banner amarelo fixo: "Modo demonstração — alterações não são salvas" |
| `!isDemoMode() && backupPermState === 'prompt'` | Banner: permissão da pasta de backup precisa ser renovada |
| `!isDemoMode() && backupPermState === 'denied'` | Banner: permissão da pasta de backup foi negada |
| Primeira execução (`showWelcome`) | `WelcomeModal` — privacidade local-first + guia de setup de backup |
| Erro não tratado em qualquer página | `ErrorBoundary` → fallback UI + botão "Reportar problema" |

---

## Detalhes das Páginas

### Dashboard (`/dashboard`)

- **Stat cards** — Receitas, Despesas, Saldo Previstos do mês (pago + não-pago)
- **Minhas Contas** — contas não-CREDIT visíveis (não arquivadas), com "Saldo Geral" no
  cabeçalho (M-49) e saldo derivado por conta
- **Meus Cartões** — seção separada, "Faturas de {mês}" com soma das faturas abertas, barra de
  utilização, link para `/credit-card/:id`
- **Donut** — despesas do mês por categoria
- **Últimos Lançamentos** — 5 recentes; apenas a 1ª parcela de transações parceladas (M-25)
- **Valuations** — painel de ativos com cotação manual (STOCKS/CRYPTO/FOREX/ASSET), se existirem

### Transactions (`/transactions`)

- Extrato de caixa: exclui lançamentos de contas CREDIT (compras de cartão vivem em
  `/credit-card/:id`); `CREDIT_PAYMENT` aparece atribuído à conta pagadora (M-26)
- Seletor de período via `PeriodSelector` (mês ou intervalo customizado)
- Linha de metadados por lançamento: conta/transferência → categoria (chip sem `#`, M-60) →
  selo "(X/N)" para parcelas (M-50) → tags (chips com `#`)
- Filtros: conta, status (pago/pendente), tags, tipo, busca por texto
- Coluna lateral (desktop, `lg:`) com resumo "Saldo anterior · Saldo · Previsto" do período
  (M-40/M-48) e toggle "Incluir Não-Pagos"

### Analytics — Relatórios (`/analytics`)

Shell com 5 abas, `PeriodSelector` compartilhado (com suporte a períodos salvos — M-45) e toggle
global "Incluir não pagos":

- **Categorias** — donuts 50/50 (Receitas/Despesas) com legenda valor + %; drill-down modal por
  categoria; usa `tx.date`
- **Cash Flow** (Entradas x Saídas) — `ComposedChart` (barras Entradas/Saídas + linha Saldo
  acumulado, ancorada no saldo de abertura — M-40/M-41); usa `getEffectiveCashFlowDate`, exclui
  `CREDIT_PAYMENT`; eixo X usa `fullLabel` (único entre anos) para o tooltip não confundir meses
  repetidos em períodos > 12 meses (M-53)
- **Contas** — grid de cards por conta + resumo de período; drill-down inline com `CashFlowView`
  filtrado por conta
- **Tags** — ranked horizontal bar chart; multi-tag filter com toggle OR/AND
- **Faturas** (R-17/R-18) — resumo por período de fatura de cada cartão (`FaturasView`)

> No mobile, Analytics exibe um placeholder "em breve" (`MB-08`, aberto) — os 5 gráficos ainda
> não são responsivos para telas pequenas.

### CreditCard (`/credit-card/:accountId`)

- Cabeçalho: voltar + nome/ícone do cartão + navegação ‹ › entre faturas (M-56, movida do rodapé
  do card de período para o cabeçalho)
- Card "Período da Fatura": mês, Fechamento/Vencimento, Limite Disponível, valor da fatura + selo
  de status (aberta/parcial/paga), Pago/Restante; botão "Pagar Agora" **oculto** (não apenas
  desabilitado) quando a fatura já está paga (M-57)
- Lista de lançamentos da fatura: cada linha mostra categoria/conta, selo "(X/N)" para parcelas
  (M-59, espelha M-50)
- Coluna lateral: barra colapsável "Filtrar por..." (M-54) — expande em busca por texto (M-55)
  + `<select>` de categoria; abaixo, "Resumo de Gastos" por categoria
- Mover um lançamento para a fatura anterior/seguinte (CC-32/B-18) é feito dentro do
  `TransactionDrawer` (seção "Mover para outra fatura", abaixo das tags — M-58), não mais como
  botões inline na linha do extrato
- Painel "Pagar Agora" dedicado (M-30) — `CREDIT_PAYMENT` vinculado a um `referenceMonth`

### NetWorth (`/net-worth`, F-24)

- Patrimônio líquido = ativos (contas não-CREDIT com `includeInBalance`, + valuations de
  STOCKS/CRYPTO/FOREX/ASSET) − passivos (`getTotalCreditLiability` de cada conta CREDIT)
- Stat cards (total, ativos, passivos), breakdown por conta, gráfico de evolução (AreaChart)
- Toggle `netWorthIncludeHidden` (workspace) — inclui contas com `includeInBalance=false`

### Settings (`/settings`)

7 seções (sidebar no desktop, abas horizontais no mobile):

1. **Contas e Cartões** — duas listas (Contas / Cartões CREDIT), seções colapsáveis "Contas
   arquivadas" com reativação (M-42); modal de criação/edição com saldo inicial editável (M-33),
   `creditMetadata` para CREDIT, toggle "Ativa"
2. **Categorias** — hierárquica (pai/filha), tipo INCOME/EXPENSE, ícone e cor
3. **Tags** — paleta de cores
4. **Perfil** — nome, e-mail
5. **Preferências** — idioma, tema, retenção do Audit Log, botão de Bug Report
6. **Backup & Sync** — exportar/importar `.db`; configurar/remover pasta de backup local
   (Nível 1); seção "em breve" para Cloud Sync (Nível 2)
7. **Histórico** — Audit Log agrupado por data (CREATE/UPDATE/DELETE)

### About (`/gimbo`)

Página "Sobre": versão, filosofia local-first, contadores de uso (contas, transações, grupos de
parcelamento), cobertura de testes e resumo de arquitetura.

### Docs e Legal

- `/docs/why-browser-storage`, `/docs/backup-local`, `/docs/cloud-sync` — páginas estáticas
  (funcionam offline), linkadas do `WelcomeModal` e de Settings → Backup & Sync
- `/privacy`, `/terms` — rotas públicas (acessíveis sem cofre criado)

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

useDataStore mutate()
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
https://github.com/dassan/gimbo-app/issues/new?title=...&body=...&labels=bug
```

---

## Modo Demo (F-25)

`isDemoMode()` (`import.meta.env.VITE_DEMO_MODE === 'true'`) faz `App.tsx` carregar
`assets/demo-data.json` via `loadDemoData()` no boot, ignorando o SQLite. `debouncedReplaceAll`
torna-se no-op (`useDataStore`), e `AppLayout` exibe o banner amarelo de modo demonstração. Usado
para deploys públicos de demonstração (sem persistência).

---

## Testes

### Cobertura Atual

- **548 testes unitários** — 21 arquivos (`src/test/{components,lib,store}`)
- **44 testes E2E** — 5 specs (`e2e/*.spec.ts`), em dois perfis Playwright: `chromium` (desktop) e `mobile-chrome`
- Cobertura: ~97% statements

### Testes Unitários (Vitest)

- Ambiente: `jsdom`, setup: `src/test/setup.ts`
- Factories: `makeDataFile()` (schemaVersion 9), `makeCreditAccount()`, `makeInstallmentGroup()`
- Threshold: 80% linhas e funções para arquivos críticos

### Testes E2E (Playwright)

- Specs: `creditCard.spec.ts`, `mobile.spec.ts`, `onboarding.spec.ts`, `persistence.spec.ts`, `transaction.spec.ts`
- Em `DEV`, `window.__storage.replaceAll(data)` é usado para semear o SQLite antes de cada cenário (ver `services/storage/index.ts`)

### Scripts de Qualidade

```bash
cd app && npm run format:check
cd app && npm run lint
cd app && npx tsc -b --noEmit
cd app && npx vitest run --coverage
cd app && npx playwright test
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
| `data/sync_gimbo.py` | Script autossuficiente, executável por demanda: lê a API, converte e escreve um `gimbo.db` pronto para importar via Configurações → Dados → Importar backup |
| `data/convert_organizze.py` | Conversor offline legado (lê JSONs estáticos exportados). Superado por `sync_gimbo.py`; mantido por referência |

### Fluxo

```
sync_gimbo.py [--start <data> | --window-months N] [--end <data>] [--base gimbo.db] [--out gimbo.db]
  1. autentica (HTTP Basic; token via env ORGANIZZE_TOKEN, email via ORGANIZZE_EMAIL/--email)
  2. busca categorias, contas, cartões e lançamentos mês a mês no horizonte [start, end]
  3. converte em memória → (incremental: funde no --base) → escreve gimbo.db (user_version=7)
```

O `gimbo.db` gerado já inclui a coluna `accounts.archived` (M-42/M-51) e a tabela `saved_periods`
(M-45), alinhado ao schema atual do app — `runMigrations()` não precisa aplicar nenhuma migração
v6/v7 ao importar.

### Dois modos de operação

| Modo | Ativação | Horizonte | --base | Uso típico |
|------|----------|-----------|--------|-----------|
| **Snapshot** | `--start <data>` (default) | `[start, end]` explícito | preserva saldos, `archived` e `include_in_balance` | carga inicial, reconciliação completa |
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
- **Modo merge (`--base`)**: lê um `gimbo.db` anterior e preserva, por id, o `balance`, o
  `include_in_balance` e o `archived` editados à mão (M-51). No **snapshot** preserva saldos +
  `archived`; no **incremental** também funde transações/tags/cadastros (ver "Dois modos de operação").
- **Contas/cartões novos** (ausentes do `--base`) recebem `archived = 1` quando o Organizze os
  retorna como `archived` — espelha o status de arquivamento do Organizze na primeira migração
  (M-51).
- **Snapshot completo**: cada execução reescreve o arquivo inteiro com exatamente a janela `[start, end]`. Não acumula histórico — para manter histórico, usar sempre a data inicial mais antiga.
- **Acumulação controlada por janela** (incremental): transações apagadas no Organizze *dentro* da janela são removidas (a API é autoridade no período); fora da janela ficam "presas" até a próxima reconciliação por snapshot — trade-off aceito em troca do baixo custo de API no run diário.
- **`tag_color` determinístico**: cor derivada de `uuid5` do nome (não de `hash()`, que varia por `PYTHONHASHSEED`) — estável entre execuções e re-merges.
- **Nomes de tags normalizados**: o Organizze armazena o nome da tag com `#` embutido
  (`"#despesaFixa"`); o script remove esse prefixo (`.strip().lstrip("#")`) antes de gravar — a
  UI do Gimbo já prefixa `#` ao exibir tags (M-52).
- **`--end` futuro** inclui lançamentos agendados/recorrentes e parcelas a vencer (chegam com `paid=false` → `isPaid=false` no Gimbo). Default = hoje.
- **Recorrência**: cada ocorrência do Organizze entra como transação avulsa (fiel ao extrato); as colunas `recurrence_*` ficam NULL. Não há reconstrução de séries M-35.
- **Estornos (B-16/M-22)**: valores positivos no cartão (crédito/estorno no Organizze) são gravados como `INCOME` na conta `CREDIT` (preserva o sinal), abatendo a fatura — não como `EXPENSE`.
- **`referenceMonth`/`invoiceDueDate` (CC-31/CC-33)**: associação à fatura real do Organizze via
  `credit_card_invoice_id`/`paid_credit_card_invoice_id`, chaveada por `(card_id, invoice_id)`.

### Mapeamento Organizze → Gimbo

| Origem | Destino |
|--------|---------|
| `/accounts` (`checking`/`savings`/`other`/null) | `accounts` → `RETAIL`/`SAVINGS`/`OTHER`; `issuerIcon` por `institution_id`; `archived` espelhado da API (contas novas) |
| `/credit_cards` | `accounts` `type=CREDIT` + `creditMetadata {limit_cents/100, closing_day, due_day}`; `archived` espelhado da API (cartões novos) |
| `/categories` (`kind`, `parent_id`) | `categories` (`expenses→EXPENSE`, `earnings/none→INCOME/EXPENSE`, hierarquia, ícone inferido por nome, cor normalizada) + 2 categorias fallback |
| `paid_credit_card_id` + `paid_credit_card_invoice_id` | `CREDIT_PAYMENT` (account=cartão, `transferAccountId`=conta, `referenceMonth` exato) |
| `oposite_transaction_id` + valor < 0 | `TRANSFER` (lado positivo espelhado é descartado) |
| `credit_card_id` + `credit_card_invoice_id` | `EXPENSE`/`INCOME` na conta do cartão, com `referenceMonth`/`invoiceDueDate` da fatura real |
| demais | `INCOME`/`EXPENSE` pelo sinal de `amount_cents` |
| `total_installments > 1` | `installment {parentId, currentIndex, total}` (parent agrupado por heurística description+source+valor+total — agrupamento ainda incorreto entre parcelas, ver `CC-34` aberto) |
| `tags: [{name}]` | entidades `Tag` (nome sem `#`, uuid5 + cor determinística) + `transaction_tags` |

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

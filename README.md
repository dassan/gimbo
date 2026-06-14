# Gimbo

> Personal finance management — 100% local, zero cloud dependency.

Gimbo is a **local-first PWA** that runs entirely in the browser. Your financial ledger lives in a local SQLite database (via WebAssembly + the Origin Private File System), with one-click export/import of a portable `.db` backup file. No accounts, no servers, no subscription.

<img width="1858" height="959" alt="gimbo-dashboard" src="https://github.com/user-attachments/assets/a4ef1e12-d4ba-45af-bb19-14cb0069a1b9" />

---

## Why Gimbo

Most finance tools trade your privacy for convenience — storing transaction history on corporate servers and monetising your spending patterns. Gimbo rejects that model:

- **Local-first:** all data is stored on your device in a local SQLite database — nothing is sent anywhere
- **Portable:** export a single `.db` backup file and import it on any other device/browser to pick up where you left off
- **Optional local backup:** point Gimbo at a folder on disk (e.g. one synced by Google Drive/Dropbox/OneDrive) and it writes a backup there automatically after every change
- **Offline-capable:** works with no internet connection once installed as a PWA
- **No lock-in:** export your data at any time as a portable SQLite file

---

## Try it

A **demo mode** with synthetic data and persistence disabled is available — useful to explore the UI without creating a ledger. Build/run with `VITE_DEMO_MODE=true` (see [Getting Started](#getting-started)).

---

## Getting Started (feedback / testing)

> **Prerequisites:** Node.js 22 and npm.

```bash
# 1. Clone the repository
git clone git@github.com:dassan/gimbo-app.git
cd gimbo-app/app

# 2. Install dependencies
npm install

# 3. Start the dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) — the Onboarding screen will guide you through creating your first ledger or importing an existing `.db` backup.

### Demo mode

```bash
VITE_DEMO_MODE=true npm run dev
```

Loads a synthetic dataset on startup and disables persistence — every mutation is a no-op, so you can click around freely. A yellow banner indicates demo mode is active.

### Dev helpers (development only)

Two URL query parameters are available when running `npm run dev` (no-ops in production builds):

| URL | Effect |
|-----|--------|
| `http://localhost:5173/?devSeed` | Wipes the local database and loads the synthetic seed dataset (`public/dev/seed.json`). Lands on the dashboard. |
| `http://localhost:5173/?devReset` | Wipes the local database, clears the workspace settings and any configured backup folder, and redirects to Onboarding. |

After the action completes, the parameter is removed from the URL via `history.replaceState`.

### Reporting issues

Found a bug or have a suggestion? Open an issue on GitHub:

**[github.com/dassan/gimbo-app/issues](https://github.com/dassan/gimbo-app/issues)**

The app also has a built-in **bug report** dialog (Settings → Preferences) that attaches a privacy-safe snapshot — recent navigation, action types, and error stack traces, **never** financial values, names, or entity IDs — and opens a pre-filled GitHub issue for you.

### Build for production

```bash
npm run build      # outputs to app/dist/
npm run preview    # serve the production build locally
```

The `dist/` folder is a fully static PWA — serve it from any static host (GitHub Pages, Netlify, Cloudflare Pages, Vercel) or open `index.html` directly in a modern browser.

---

## Browser Compatibility

| Feature | Chrome / Edge | Firefox | Safari |
|---------|:---:|:---:|:---:|
| Core app (SQLite via OPFS) | ✅ | ✅ | ✅ |
| PWA install | ✅ | ✅ | ✅ |
| Automatic local-folder backup (File System Access API) | ✅ | ❌ | ❌ |

The core app stores its database in the browser's **Origin Private File System (OPFS)**, available in all modern browsers — no special permissions required.

The **optional** "Backup & Sync → local folder" feature (Settings) uses the **File System Access API** to write a backup file to a folder you choose every time data changes. This API is Chrome/Edge-only; on Firefox and Safari this option is hidden and you can still back up manually via **Export** (Settings → Data).

---

## Contributing

### Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | React | 19.x |
| Routing | React Router | 7.x |
| Build | Vite | 8.x |
| Language | TypeScript (strict) | 6.x |
| Styling | Tailwind CSS | 4.x |
| State | Zustand | 5.x |
| Validation | Zod | 4.x |
| Database | SQLite via `wa-sqlite` (WASM) + OPFS | 1.x |
| Charts | Recharts | 3.x |
| i18n | i18next + react-i18next | 26.x / 17.x |
| PWA | vite-plugin-pwa | 1.x |
| Icons | Lucide React | 1.x |
| Unit tests | Vitest + Testing Library | 3.x / 16.x |
| E2E tests | Playwright | 1.x (Chromium desktop + mobile) |
| Lint | ESLint (flat config) | 9.x |
| Formatter | Prettier | 3.x |

**Node.js 22** is required (matches CI).

### Project Structure

```
gimbo-app/
├── .github/
│   └── workflows/
│       ├── ci.yml          # type-check → lint → format → unit tests → build
│       └── audit.yml       # weekly dependency audit
├── plan/
│   ├── PRD.md              # Product Requirements Document
│   ├── ARCHITECTURE.md     # Stack, data model, persistence, storage architecture
│   ├── BACKLOG.md          # Bugs (B-XX), improvements (M-XX), credit card (CC-XX), reports (R-XX)
│   ├── REPORTS.md          # Advanced analytics epic (Categorias/CashFlow/Contas/Tags/Faturas)
│   ├── CREDIT_CARD.md       # Credit card module decisions and spec
│   ├── METRICS.md           # Telemetry & bug report system decisions
│   ├── SYNC_SCENARIOS.md    # Persistence / sync edge-case scenarios
│   └── RULES.md             # Human + AI development workflow
├── design/
│   ├── DESIGN.md            # "Fluid Ledger" design system (single source of truth)
│   └── *.png                # Screen mockups
└── app/
    ├── src/
    │   ├── App.tsx              # Startup, hydration, route guard, error boundary
    │   ├── types/index.ts        # All TypeScript entity definitions
    │   ├── lib/
    │   │   ├── utils.ts            # cn(), formatCurrency(), parseDateLocal(), invoice engine, balance helpers
    │   │   ├── backupDir.ts        # File System Access folder backup (handle persisted via idb)
    │   │   ├── demo.ts             # Demo mode flag + synthetic data loader
    │   │   ├── telemetry.ts        # In-memory event ring buffer + bug report snapshot builder
    │   │   └── i18n/                # i18next config + pt-BR / en-US locales
    │   ├── services/
    │   │   └── storage/
    │   │       ├── StorageService.ts   # Typed API used by the app (main thread)
    │   │       ├── worker.ts           # Web Worker: wa-sqlite + OPFS, runs migrations
    │   │       └── migrations/*.sql    # Incremental SQLite schema (v1.sql .. v7.sql)
    │   ├── store/
    │   │   ├── useDataStore.ts         # Ledger data + mutations + debounced persistence
    │   │   └── useWorkspaceStore.ts    # UI preferences (theme, locale, defaultView, shadows, net worth)
    │   ├── hooks/
    │   │   └── useTrackNavigation.ts   # Records route changes for telemetry
    │   ├── components/
    │   │   ├── AppLayout.tsx           # Shell: Navbar + Outlet + FAB + drawers + banners
    │   │   ├── Navbar.tsx               # Top nav (desktop) + bottom nav (mobile)
    │   │   ├── FAB.tsx                  # Floating "new transaction" button
    │   │   ├── TransactionDrawer.tsx    # Slide-in form for creating/editing transactions
    │   │   ├── DatePicker.tsx           # Custom date picker (native on mobile, calendar popup on desktop)
    │   │   ├── PeriodSelector.tsx       # Month / custom range picker with saved periods
    │   │   ├── WelcomeModal.tsx         # First-run privacy & backup explainer
    │   │   ├── BugReportDialog.tsx      # Opt-in bug report with telemetry snapshot
    │   │   ├── ErrorBoundary.tsx        # Catches render errors, offers bug report
    │   │   └── Toast.tsx                # Dismissible notification banner
    │   ├── pages/
    │   │   ├── Onboarding/      # Create a new ledger or import a .db backup
    │   │   ├── Dashboard/       # Monthly summary, accounts, cards, donut, recent transactions
    │   │   ├── Transactions/    # Cash-flow ledger (excludes credit-card charges)
    │   │   ├── Analytics/       # 5-tab shell: Categorias, CashFlow, Contas, Tags, Faturas
    │   │   ├── CreditCard/      # Invoice detail for one credit card account
    │   │   ├── NetWorth/        # Assets − liabilities, with valuation history
    │   │   ├── Settings/        # Accounts & Cards, Categories, Tags, Profile, Preferences, Backup & Sync, History
    │   │   ├── About/           # App info, test coverage, architecture summary
    │   │   ├── Docs/            # Static help pages (why local storage, local backup, cloud sync roadmap)
    │   │   └── Legal/           # Privacy policy, terms of service
    │   └── test/
    │       ├── fixtures/       # makeDataFile(), makeCreditAccount(), makeInstallmentGroup()
    │       ├── lib/             # Tests for utils + storage schema
    │       ├── store/           # Tests for useDataStore mutations
    │       └── components/      # Component tests
    └── e2e/                     # Playwright end-to-end specs
```

### Data Model

The ledger is stored in a local SQLite database (one table per entity). The same data is also represented in memory as a `DataFile` object, validated with Zod (`schemaVersion` currently **9**):

```typescript
interface DataFile {
  schemaVersion: number
  user: { name: string; email: string; createdAt: string; updatedAt: string }
  settings: { fileCreatedAt: string; fileUpdatedAt: string; auditLogRetentionLimit: number | null }
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  transactions: Transaction[]
  valuations: Valuation[]
  auditLog: AuditEntry[]
  deletedIds: string[]       // tombstones — entities explicitly deleted on this device
  savedPeriods: SavedPeriod[] // named custom date ranges saved from the Reports period picker
}

interface Account {
  id: string
  name: string
  type: 'RETAIL' | 'SAVINGS' | 'CREDIT' | 'CRYPTO' | 'FOREX' | 'ASSET' | 'STOCKS' | 'OTHER'
  balance: number            // opening balance — never shown directly, current balance is derived
  includeInBalance: boolean
  creditMetadata?: { limit: number; closingDay: number; dueDay: number } // CREDIT accounts only
  issuerIcon?: string         // institution key, e.g. 'nubank', 'itau', 'generic'
  archived?: boolean          // hidden from selectors/lists, still counted in balances and totals
}

interface Transaction {
  id: string
  accountId: string
  categoryId: string
  amount: number
  type: 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CREDIT_PAYMENT'
  date: string                // ISO 8601, always interpreted via parseDateLocal()
  description: string
  isPaid: boolean
  tags: string[]
  installment?: { parentId: string; currentIndex: number; total: number }
  recurrence?: { frequency: 'weekly' | 'biweekly' | 'monthly'; parentId: string; endDate?: string }
  transferAccountId?: string  // TRANSFER destination, or CREDIT_PAYMENT funding account
  referenceMonth?: string     // "YYYY-MM" — the invoice this CREDIT-account entry belongs to
  invoiceDueDate?: string     // "YYYY-MM-DD" — authoritative due date captured at sync time
}
```

`Category`, `Tag`, `Valuation`, `SavedPeriod` and `AuditEntry` are smaller supporting types — see `src/types/index.ts` for the full definitions.

`schemaVersion` is validated on every load. Files at older versions are migrated automatically (each step is an additive, idempotent change); files from a future version are rejected with a user-visible error.

**`nexus_workspace`** (localStorage) — UI preferences, never leaves the browser:

```jsonc
{
  "theme": "system | light | dark",
  "locale": "pt-BR | en-US",
  "defaultView": "dashboard",
  "useAmbientShadows": false,
  "netWorthIncludeHidden": true
}
```

### Architecture Highlights

**Data flow:**

```
User action
  → store mutation (e.g. addTransaction())
  → mutate(): structuredClone → apply change → push audit log entry
  → debounce 300ms → storage.replaceAll(data) — writes the whole SQLite DB via the worker
  → (if a backup folder is configured) write a copy via the File System Access API
```

**Storage:**

```
Main Thread
  StorageService (src/services/storage/StorageService.ts)
    └── postMessage ───────────────────────────────────► Worker
                                              (storage/worker.ts)
                                              wa-sqlite + OPFS VFS
                                              gimbo.db (OPFS root)
    ◄── onmessage (result | error) ──────────────────── Worker
```

- The worker keeps a sequential message queue — mutations never interleave.
- `replaceAll()` rewrites every table inside a single SQL transaction.
- Export → `exportBlob()` (WAL checkpoint, then read the OPFS file as a `Blob`).
- Import → `importBlob()` (closes the DB, overwrites the OPFS file, reopens, runs pending migrations).

**Date parsing — always use `parseDateLocal()`:**

`new Date("2026-04-01")` creates UTC midnight. In UTC− timezones, calling `.getMonth()` returns the previous day's month. Every date comparison against `tx.date` must go through `parseDateLocal(dateStr)` from `@/lib/utils`.

**Virtual invoice engine (`lib/utils.ts`):**

Credit card invoices are not stored as a separate entity — they are computed at runtime from `creditMetadata.closingDay`/`dueDay` plus each transaction's `referenceMonth`/`invoiceDueDate` (when set by sync). Key pure functions: `getInvoicePeriod`, `getTxInvoicePeriod`, `getInvoiceDueDate`, `getOpenCreditBalance`, `getInvoiceTotal`, `getInvoicePaid`, `getInvoiceStatus`, `getEffectiveCashFlowDate`. All use `parseDateLocal` internally.

`getEffectiveCashFlowDate` is used exclusively in cash-flow charts to shift credit-card expenses to the invoice due date. Category breakdowns always use `tx.date` directly. `CREDIT_PAYMENT` is excluded from Income × Expense totals (it's liability settlement, not cash flow).

### Quality Gates

Run all checks before opening a PR — CI executes the same commands:

```bash
cd app

npm run format:check       # Prettier
npm run lint                # ESLint
npx tsc -b --noEmit          # TypeScript strict
npx vitest run --coverage    # 548 unit tests (21 files) — threshold: 80% lines/functions
npx playwright test          # 44 E2E tests (5 specs) — desktop + mobile Chromium
```

Current coverage: **~97% statements**.

### Commit Convention

```
<type>: <imperative description in lowercase>
```

| Type | Use |
|------|-----|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `test:` | Tests only |
| `style:` | Formatting (no logic change) |
| `refactor:` | Refactor without behaviour change |
| `docs:` | Documentation |
| `chore:` | Config, CI, dependencies |

Reference the relevant ID when applicable: `feat: M-54 barra colapsável de filtro de categoria`. IDs are tracked in [`plan/BACKLOG.md`](plan/BACKLOG.md) (`M-XX` improvements, `B-XX` bugs, `CC-XX` credit card, `R-XX` reports).

### Development Rules (summary)

- **CI is the arbiter** — green pipeline = done; red pipeline = session stops
- **Read before proposing** — never suggest changes to files you haven't read
- **No `TODO` in code** — open a `BACKLOG.md` entry instead
- **One feature per PR** — makes review and rollback straightforward
- **No `console.log` in production code**
- Bugs and improvements are tracked in [`plan/BACKLOG.md`](plan/BACKLOG.md)
- Full workflow documented in [`plan/RULES.md`](plan/RULES.md)

---

## Roadmap

The current release is feature-complete for **single-device use** across desktop and mobile browsers (responsive PWA, installable, offline-capable). Optional local-folder backup (Chrome/Edge) covers most desktop users without any cloud account.

Planned next:

- **Cloud Sync (Nível 2)** — end-to-end, opaque sync of the SQLite database to the user's own Google Drive or Dropbox via OAuth2 PKCE (no Gimbo server). Additive merge by UUID; last-write-wins on edits. See `CS-XX` items in `plan/BACKLOG.md`.
- **Analytics on mobile** — the Reports section currently shows a "coming soon" placeholder on small screens (`MB-08`); full responsive charts are planned.

Out of scope for the current cycle:

- Automated Open Banking / bank import
- Native mobile app (iOS / Android) — the mobile strategy is a responsive PWA
- Chargebacks / reversals beyond the existing credit-card refund model

---

## Licence

MIT.

// ─── Enums ────────────────────────────────────────────────────────────────────

export type AccountType =
  | 'RETAIL'
  | 'SAVINGS'
  | 'CREDIT'
  | 'CRYPTO'
  | 'FOREX'
  | 'ASSET'
  | 'STOCKS'
  | 'LOAN'
  | 'OTHER'
export type CategoryType = 'INCOME' | 'EXPENSE'
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CREDIT_PAYMENT'

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE'
export type AuditEntity =
  | 'account'
  | 'category'
  | 'tag'
  | 'transaction'
  | 'user'
  | 'savedPeriod'
  | 'budget'

// ─── Entities ─────────────────────────────────────────────────────────────────

export interface User {
  name: string
  email: string
  createdAt: string // ISO 8601
  updatedAt: string // ISO 8601
}

export interface Settings {
  fileCreatedAt: string // ISO 8601
  fileUpdatedAt: string // ISO 8601
  auditLogRetentionLimit: number | null // null = unlimited (opt-in); default 200
}

export interface CreditMetadata {
  limit: number
  closingDay: number // 1–31
  dueDay: number // 1–31
}

// HE-04: non-card loans/financing as a first-class liability. outstandingBalance is
// maintained by the user (mirrors the Valuation pattern for STOCKS/CRYPTO/ASSET) — no
// automatic interest/principal amortization in v1.
export interface LoanMetadata {
  outstandingBalance: number
  monthlyPayment: number
  remainingInstallments: number
  interestRate?: number // % a.m., optional
}

// HE-14: marks a RETAIL/SAVINGS account as part of the user's emergency reserve. An object
// (not a boolean) by design — presence is the signal; no required fields in v1 (the target
// in months stays global, RESERVE_TARGET_MONTHS). See plan/FINANCIAL_HEALTH.md §8 D6/D8.
export type ReserveMetadata = Record<string, never>

export interface Account {
  id: string // UUID
  name: string
  type: AccountType
  balance: number
  includeInBalance: boolean
  creditMetadata?: CreditMetadata // only for CREDIT accounts
  loanMetadata?: LoanMetadata // only for LOAN accounts (HE-04)
  reserveMetadata?: ReserveMetadata // only for RETAIL/SAVINGS accounts (HE-14)
  issuerIcon?: string // institution key for any account type — e.g. 'nubank', 'itau', 'generic' (M-34)
  archived?: boolean // M-42: hidden from selectors/lists but still counted in balances/totals
  updatedAt?: string // ISO 8601 — last-write-wins timestamp for the cloud-sync merge engine (CS-04)
}

export interface Category {
  id: string // UUID
  parentId: string | null
  name: string
  icon: string
  color: string
  type: CategoryType
  updatedAt?: string // ISO 8601 — last-write-wins timestamp for the cloud-sync merge engine (CS-04)
}

export interface Tag {
  id: string // UUID
  name: string
  color: string
  updatedAt?: string // ISO 8601 — last-write-wins timestamp for the cloud-sync merge engine (CS-04)
}

export interface Installment {
  parentId: string // UUID of the first installment in the group
  currentIndex: number // 1-based
  total: number // minimum 2
  purchaseDate?: string // ISO date (YYYY-MM-DD) of the original purchase, shared by every installment in the group (M-64)
}

export type RecurrenceFrequency = 'weekly' | 'biweekly' | 'monthly'

export interface Recurrence {
  frequency: RecurrenceFrequency
  parentId: string // UUID of the first occurrence in the series
  endDate?: string // ISO date (YYYY-MM-DD); absent → generated up to a 12-month horizon (M-35)
}

export interface Transaction {
  id: string // UUID
  accountId: string
  categoryId: string
  amount: number
  type: TransactionType
  date: string // ISO 8601
  description: string
  isPaid: boolean
  tags: string[] // UUID[]
  installment?: Installment // only for installment purchases
  recurrence?: Recurrence // only for recurring INCOME/EXPENSE series (M-35)
  transferAccountId?: string // only for CREDIT_PAYMENT: the account that funds the payment
  referenceMonth?: string // CREDIT-account txs: the invoice period this entry is bound to, "YYYY-MM". For CREDIT_PAYMENT, the invoice being paid; for charges/credits, the invoice they post to (overrides the date-derived default) (B-18)
  invoiceDueDate?: string // CREDIT charges/credits: authoritative due date of the bound invoice, "YYYY-MM-DD", captured from the source. Used by getEffectiveCashFlowDate so historical invoices stay anchored even if the card's closing/due day later changes (CC-33)
  updatedAt?: string // ISO 8601 — last-write-wins timestamp for the cloud-sync merge engine (CS-04)
  createdAt?: string // ISO 8601 — when the entry was added, distinct from `date` (which the user can back/postdate). Drives "recently added" ordering (B-24)
  budgetIds?: string[] // UUID[] — Budget N:N link, mirrors `tags`. Optional (unlike `tags`) so the
  // many existing call sites that build a Transaction by hand don't all need updating (F-30, BX-03)
}

export interface Valuation {
  id: string // UUID
  accountId: string // must be STOCKS | CRYPTO | FOREX | ASSET
  date: string // ISO 8601 — date of the market-value snapshot
  marketValue: number // market value on that date
}

export interface AuditEntry {
  id: string // UUID
  timestamp: string // ISO 8601
  action: AuditAction
  entity: AuditEntity
  entityId: string
  summary: string // human-readable, generated in active locale at mutation time
}

// M-45: a named custom date range, saved from the Reports period picker for reuse.
export interface SavedPeriod {
  id: string // UUID
  name: string
  start: string // "YYYY-MM-DD"
  end: string // "YYYY-MM-DD"
}

// F-30 (Caixinhas): despesa = target is a ceiling; receita = target is a floor. See
// plan/BUDGETS.md §2 "Semântica do tipo".
export type BudgetKind = 'expense' | 'income'

// A single target date, or a closed [start, end] range. See plan/BUDGETS.md §2.
export type BudgetPeriod =
  | { mode: 'date'; date: string } // "YYYY-MM-DD"
  | { mode: 'range'; start: string; end: string } // "YYYY-MM-DD" each

export interface Budget {
  id: string // UUID
  name: string
  emoji: string
  color: string
  kind: BudgetKind
  target: number
  period: BudgetPeriod
  archivedAt?: string // ISO 8601 — absent = active. Set automatically (Quadrantes recipe) or by the
  // user (manual "Arquivar"). Visibility state only — linked transactions are untouched (plan/BUDGETS.md §5.8)
  recipeSlug?: string // 'quadrantes' — absent for manual budgets (plan/BUDGETS.md §5.6)
  recipeSlot?: number // 1-4 — only set alongside recipeSlug, identifies which slot in the monthly batch
  updatedAt?: string // ISO 8601 — last-write-wins timestamp for the cloud-sync merge engine (CS-04)
}

// ─── Root data.json shape ─────────────────────────────────────────────────────

export interface DataFile {
  schemaVersion: number
  user: User
  settings: Settings
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  transactions: Transaction[]
  valuations: Valuation[]
  auditLog: AuditEntry[]
  deletedIds: string[] // tombstone: IDs explicitly deleted on this device (B-11)
  savedPeriods: SavedPeriod[] // M-45: named custom date ranges saved from Reports
  budgets: Budget[] // F-30: caixinhas
}

// ─── workspace.json shape ─────────────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system'
export type Locale = 'pt-BR' | 'en-US'
export type Currency = 'BRL' | 'USD'
export type IncomeWindowMonths = 3 | 6 | 9 | 12

export interface WorkspaceFile {
  theme: Theme
  locale: Locale
  currency: Currency // B-25: independent from locale — defaults per-locale but user-overridable
  defaultView: string
  useAmbientShadows: boolean
  netWorthIncludeHidden: boolean // D3: include accounts with includeInBalance=false (default true)
  monthlyIncomeOverride?: number // HE-09/D1: user-confirmed income; always wins over the derived suggestion
  incomeWindowMonths: IncomeWindowMonths // HE-09: lookback window for the income suggestion (default 6)
  monthlyCostOverride?: number // HE-12/D7: user-confirmed monthly cost; always wins over the derived suggestion
  reserveTargetMonths: IncomeWindowMonths // HE-16: target months multiplier for the recommended reserve (default 6)
}

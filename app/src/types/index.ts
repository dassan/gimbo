// ─── Enums ────────────────────────────────────────────────────────────────────

export type AccountType =
  | 'RETAIL'
  | 'SAVINGS'
  | 'CREDIT'
  | 'CRYPTO'
  | 'FOREX'
  | 'ASSET'
  | 'STOCKS'
  | 'OTHER'
export type CategoryType = 'INCOME' | 'EXPENSE'
export type TransactionType = 'INCOME' | 'EXPENSE' | 'TRANSFER' | 'CREDIT_PAYMENT'

export type AuditAction = 'CREATE' | 'UPDATE' | 'DELETE'
export type AuditEntity = 'account' | 'category' | 'tag' | 'transaction' | 'user'

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

export interface Account {
  id: string // UUID
  name: string
  type: AccountType
  balance: number
  includeInBalance: boolean
  creditMetadata?: CreditMetadata // only for CREDIT accounts
  issuerIcon?: string // institution key for any account type — e.g. 'nubank', 'itau', 'generic' (M-34)
}

export interface Category {
  id: string // UUID
  parentId: string | null
  name: string
  icon: string
  color: string
  type: CategoryType
}

export interface Tag {
  id: string // UUID
  name: string
  color: string
}

export interface Installment {
  parentId: string // UUID of the first installment in the group
  currentIndex: number // 1-based
  total: number // minimum 2
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
}

// ─── workspace.json shape ─────────────────────────────────────────────────────

export type Theme = 'light' | 'dark' | 'system'
export type Locale = 'pt-BR' | 'en-US'

export interface WorkspaceFile {
  theme: Theme
  locale: Locale
  defaultView: string
  useAmbientShadows: boolean
  netWorthIncludeHidden: boolean // D3: include accounts with includeInBalance=false (default true)
}

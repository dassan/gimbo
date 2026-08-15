import { z } from 'zod'
import type { DataFile, WorkspaceFile } from '@/types'
import { now } from '@/lib/utils'
import { detectBrowserLocale, defaultCurrencyForLocale } from '@/lib/storage/workspace'

export const AUDIT_RETENTION_DEFAULT = 200
export const AUDIT_RETENTION_DAYS = 90
export const CURRENT_SCHEMA_VERSION = 17

/**
 * Thrown by validateDataFile() when the parsed file declares a schemaVersion
 * higher than CURRENT_SCHEMA_VERSION. Callers can use instanceof to distinguish
 * this from a generic Zod validation error.
 */
export class SchemaVersionError extends Error {
  readonly detectedVersion: number
  constructor(detectedVersion: number) {
    super(
      `Unsupported schema version ${detectedVersion} (app supports up to ${CURRENT_SCHEMA_VERSION})`
    )
    this.name = 'SchemaVersionError'
    this.detectedVersion = detectedVersion
  }
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const UserSchema = z.object({
  name: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const SettingsSchema = z.object({
  fileCreatedAt: z.string(),
  fileUpdatedAt: z.string(),
  auditLogRetentionLimit: z.number().nullable(),
  quadrantesEnabled: z.boolean().default(false), // F-30/BX-07; absent in older files defaults to false
})

const CreditMetadataSchema = z.object({
  limit: z.number(),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
})

// HE-04: non-card loans/financing as a first-class liability (Account.loanMetadata).
const LoanMetadataSchema = z.object({
  outstandingBalance: z.number(),
  monthlyPayment: z.number(),
  remainingInstallments: z.number().int().min(0),
  interestRate: z.number().optional(),
})

// HE-14: marks a RETAIL/SAVINGS account as part of the emergency reserve (Account.reserveMetadata).
const ReserveMetadataSchema = z.object({})

const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum([
    'RETAIL',
    'SAVINGS',
    'CREDIT',
    'CRYPTO',
    'FOREX',
    'ASSET',
    'STOCKS',
    'LOAN',
    'OTHER',
  ]),
  balance: z.number(),
  includeInBalance: z.boolean(),
  creditMetadata: CreditMetadataSchema.optional(),
  loanMetadata: LoanMetadataSchema.optional(), // only for LOAN accounts (HE-04)
  reserveMetadata: ReserveMetadataSchema.optional(), // only for RETAIL/SAVINGS accounts (HE-14)
  issuerIcon: z.string().optional(), // institution key for any account type — e.g. 'nubank', 'itau', 'generic' (M-34)
  archived: z.boolean().optional(), // M-42: hidden from selectors/lists but still counted in balances/totals
  updatedAt: z.string().optional(), // CS-04: last-write-wins timestamp for the cloud-sync merge engine
})

const CategorySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  type: z.enum(['INCOME', 'EXPENSE']),
  updatedAt: z.string().optional(), // CS-04: last-write-wins timestamp for the cloud-sync merge engine
})

const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
  updatedAt: z.string().optional(), // CS-04: last-write-wins timestamp for the cloud-sync merge engine
})

const InstallmentSchema = z.object({
  parentId: z.string(),
  currentIndex: z.number().int().min(1),
  total: z.number().int().min(2),
  purchaseDate: z.string().optional(), // M-64: original purchase date, shared by every installment in the group
})

// M-35: recurring INCOME/EXPENSE series
const RecurrenceSchema = z.object({
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  parentId: z.string(),
  endDate: z.string().optional(),
})

const TransactionSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  categoryId: z.string(),
  amount: z.number(),
  type: z.enum(['INCOME', 'EXPENSE', 'TRANSFER', 'CREDIT_PAYMENT']),
  date: z.string(),
  description: z.string(),
  isPaid: z.boolean(),
  tags: z.array(z.string()),
  installment: InstallmentSchema.optional(),
  recurrence: RecurrenceSchema.optional(),
  transferAccountId: z.string().optional(), // only for CREDIT_PAYMENT
  referenceMonth: z.string().optional(), // CREDIT-account txs: invoice period this entry is bound to, "YYYY-MM" (B-18)
  invoiceDueDate: z.string().optional(), // CREDIT charges/credits: authoritative invoice due date "YYYY-MM-DD" from the source (CC-33)
  updatedAt: z.string().optional(), // CS-04: last-write-wins timestamp for the cloud-sync merge engine
  createdAt: z.string().optional(), // B-24: when the entry was added, distinct from `date`
  budgetIds: z.array(z.string()).optional(), // F-30/BX-03: Budget N:N link, mirrors `tags`
})

const ValuationSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.string(),
  marketValue: z.number(),
})

// M-45: named custom date range saved from the Reports period picker for reuse.
const SavedPeriodSchema = z.object({
  id: z.string(),
  name: z.string(),
  start: z.string(),
  end: z.string(),
})

// F-30 (Caixinhas): a single target date, or a closed [start, end] range.
const BudgetPeriodSchema = z.union([
  z.object({ mode: z.literal('date'), date: z.string() }),
  z.object({ mode: z.literal('range'), start: z.string(), end: z.string() }),
])

const BudgetSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  color: z.string(),
  kind: z.enum(['expense', 'income']),
  target: z.number(),
  period: BudgetPeriodSchema,
  archivedAt: z.string().optional(), // absent = active (plan/BUDGETS.md §5.8)
  recipeSlug: z.string().optional(), // 'quadrantes' (plan/BUDGETS.md §5.6)
  recipeSlot: z.number().int().min(1).max(4).optional(),
  updatedAt: z.string().optional(), // CS-04: last-write-wins timestamp for the cloud-sync merge engine
  createdAt: z.string().optional(), // BX-06/U-3: drives the "Criação" sort, distinct from updatedAt
})

const AuditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  entity: z.enum(['account', 'category', 'tag', 'transaction', 'user', 'savedPeriod', 'budget']),
  entityId: z.string(),
  summary: z.string(),
})

export const DataFileSchema = z.object({
  schemaVersion: z.number().int().default(1), // legacy files without field default to v1
  user: UserSchema,
  settings: SettingsSchema,
  accounts: z.array(AccountSchema),
  categories: z.array(CategorySchema),
  tags: z.array(TagSchema),
  transactions: z.array(TransactionSchema),
  valuations: z.array(ValuationSchema).default([]), // NW-08; absent in v1/v2 files defaults to []
  auditLog: z.array(AuditEntrySchema),
  deletedIds: z.array(z.string()).default([]), // tombstone — B-11; absent in v1/v2 files defaults to []
  savedPeriods: z.array(SavedPeriodSchema).default([]), // M-45; absent in older files defaults to []
  budgets: z.array(BudgetSchema).default([]), // F-30/BX-03; absent in older files defaults to []
})

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate and cast an unknown JSON payload as DataFile. Throws if invalid.
 * Throws SchemaVersionError if the file was created by a newer app version.
 * Automatically migrates v1 files to the current schema version.
 */
export function validateDataFile(data: unknown): DataFile {
  const parsed = DataFileSchema.parse(data) as DataFile
  if (parsed.schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaVersionError(parsed.schemaVersion)
  }
  return migrateDataFile(parsed)
}

// ─── Migrations ───────────────────────────────────────────────────────────────

/**
 * Applies all pending migrations in order until the file reaches
 * CURRENT_SCHEMA_VERSION. Each migration step is idempotent.
 */
function migrateDataFile(data: DataFile): DataFile {
  if (data.schemaVersion === CURRENT_SCHEMA_VERSION) return data

  let migrated = data

  // v1 → v2: adds optional creditMetadata (Account) and installment (Transaction).
  // Both fields are optional — existing records need no changes beyond bumping the version.
  if (migrated.schemaVersion === 1) {
    migrated = { ...migrated, schemaVersion: 2 }
  }

  // v2 → v3: adds valuations array (NW-08). Absent in v1/v2 files; Zod default already
  // fills it via DataFileSchema.parse, so we only need to bump the version here.
  if (migrated.schemaVersion === 2) {
    migrated = { ...migrated, schemaVersion: 3, valuations: migrated.valuations ?? [] }
  }

  // v3 → v4: adds optional recurrence (Transaction) for recurring INCOME/EXPENSE series (M-35).
  // The field is optional — existing records need no changes beyond bumping the version.
  if (migrated.schemaVersion === 3) {
    migrated = { ...migrated, schemaVersion: 4 }
  }

  // v4 → v5: adds optional referenceMonth (Transaction) for CREDIT_PAYMENT → invoice period
  // binding (Option 2). The field is optional — existing records only need the version bump.
  if (migrated.schemaVersion === 4) {
    migrated = { ...migrated, schemaVersion: 5 }
  }

  // v5 → v6: generalises referenceMonth to any CREDIT-account transaction as the invoice
  // it is bound to (B-18). No shape change — the field already exists; bumping the version
  // makes older apps refuse files whose charges carry explicit invoice associations they
  // would otherwise ignore (and mis-total). Existing records only need the version bump.
  if (migrated.schemaVersion === 5) {
    migrated = { ...migrated, schemaVersion: 6 }
  }

  // v6 → v7: adds optional invoiceDueDate (Transaction) — the authoritative invoice due date
  // captured from the source for CREDIT charges/credits (CC-33). Optional field, no shape
  // change; bumping the version makes older apps refuse files whose charges carry a stored due
  // date they would ignore (and re-derive, drifting if the card's closing/due day changed).
  if (migrated.schemaVersion === 6) {
    migrated = { ...migrated, schemaVersion: 7 }
  }

  // v7 → v8: adds optional archived (Account) — hides the account from selectors/lists while
  // keeping it in balance/net-worth/liability totals (M-42). Optional field, no shape change;
  // existing records only need the version bump.
  if (migrated.schemaVersion === 7) {
    migrated = { ...migrated, schemaVersion: 8 }
  }

  // v8 → v9: adds savedPeriods array (M-45) — named custom date ranges saved from the Reports
  // period picker. Absent in older files; Zod default already fills it via DataFileSchema.parse,
  // so we only need to bump the version here.
  if (migrated.schemaVersion === 8) {
    migrated = { ...migrated, schemaVersion: 9, savedPeriods: migrated.savedPeriods ?? [] }
  }

  // v9 → v10: adds the LOAN account type and optional loanMetadata (Account), for non-card
  // loans/financing as a first-class liability (HE-04). Optional field, no shape change for
  // existing records; existing accounts only need the version bump.
  if (migrated.schemaVersion === 9) {
    migrated = { ...migrated, schemaVersion: 10 }
  }

  // v10 → v11: adds optional purchaseDate (Installment) — the original purchase date shared
  // by every installment in the group (M-64). Optional field, no shape change for existing
  // records; existing installments only need the version bump.
  if (migrated.schemaVersion === 10) {
    migrated = { ...migrated, schemaVersion: 11 }
  }

  // v11 → v12: adds optional reserveMetadata (Account) — marks a RETAIL/SAVINGS account as
  // part of the emergency reserve (HE-14). Optional field, no shape change for existing
  // records; existing accounts only need the version bump.
  if (migrated.schemaVersion === 11) {
    migrated = { ...migrated, schemaVersion: 12 }
  }

  // v12 → v13: adds optional updatedAt (Account, Category, Tag, Transaction) — last-write-wins
  // timestamp consumed by the cloud-sync merge engine (CS-04, Fase 0 of F-28 Nível 2). Entities
  // that predate this version receive the epoch, so they never outrank a real timestamp in LWW.
  if (migrated.schemaVersion === 12) {
    const epoch = new Date(0).toISOString()
    migrated = {
      ...migrated,
      schemaVersion: 13,
      accounts: migrated.accounts.map((a) => ({ ...a, updatedAt: a.updatedAt ?? epoch })),
      categories: migrated.categories.map((c) => ({ ...c, updatedAt: c.updatedAt ?? epoch })),
      tags: migrated.tags.map((t) => ({ ...t, updatedAt: t.updatedAt ?? epoch })),
      transactions: migrated.transactions.map((t) => ({ ...t, updatedAt: t.updatedAt ?? epoch })),
    }
  }

  // v13 → v14: adds optional createdAt (Transaction) — when the entry was actually added,
  // distinct from `date` (which the user can back/postdate), driving "recently added" ordering
  // in Dashboard (B-24). Transactions that predate this version fall back to their own `date`
  // (best available approximation) rather than "now", so a bulk-imported/synced history doesn't
  // suddenly all look like it was created today.
  if (migrated.schemaVersion === 13) {
    migrated = {
      ...migrated,
      schemaVersion: 14,
      transactions: migrated.transactions.map((t) => ({ ...t, createdAt: t.createdAt ?? t.date })),
    }
  }

  // v14 → v15: adds the Budget entity (F-30/BX-03) — a `budgets` array (DataFile) and the
  // `budgetIds` N:N link (Transaction), mirroring the existing `tags` pattern. Both are
  // Zod-defaulted to [] via DataFileSchema.parse, so existing records only need the version bump.
  if (migrated.schemaVersion === 14) {
    migrated = { ...migrated, schemaVersion: 15 }
  }

  // v15 → v16: adds optional quadrantesEnabled (Settings) — opt-in toggle for the "Quadrantes"
  // recipe (F-30/BX-07). Zod-defaulted to false via DataFileSchema.parse, so existing records
  // only need the version bump.
  if (migrated.schemaVersion === 15) {
    migrated = { ...migrated, schemaVersion: 16 }
  }

  // v16 → v17: removes email (User) — collected in Onboarding/Settings but never consumed by
  // any real flow (no recovery, no notifications, no export); flagged as a privacy inconsistency
  // in M-69 and removed in favor of a single vault name. No shape change beyond the bump — Zod
  // already strips the extra `email` key from older files during UserSchema.parse.
  if (migrated.schemaVersion === 16) {
    migrated = { ...migrated, schemaVersion: 17 }
  }

  return migrated
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function createEmptyDataFile(name: string): DataFile {
  const ts = now()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    user: { name, createdAt: ts, updatedAt: ts },
    settings: {
      fileCreatedAt: ts,
      fileUpdatedAt: ts,
      auditLogRetentionLimit: AUDIT_RETENTION_DEFAULT,
      quadrantesEnabled: false,
    },
    accounts: [],
    categories: getDefaultCategories(),
    tags: [],
    transactions: [],
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
    budgets: [],
  }
}

export function createDefaultWorkspace(): WorkspaceFile {
  const locale = detectBrowserLocale()
  return {
    theme: 'system',
    locale,
    currency: defaultCurrencyForLocale(locale),
    defaultView: 'dashboard',
    useAmbientShadows: false,
    netWorthIncludeHidden: true,
    incomeWindowMonths: 6,
    reserveTargetMonths: 6,
    budgetSortBy: 'createdAt',
  }
}

// Fixed ids (CS-23) — every fresh ledger seeds the same categories, and two devices that each
// ran "Criar novo" independently before ever syncing need those seeds to converge under
// mergeForSync's union-by-id (CS-05) instead of surviving as look-alike duplicates. Never change
// an existing id here: it would make every ledger already in the wild diverge from new ones.
function getDefaultCategories() {
  return [
    {
      id: 'd75314da-3745-4d3c-a275-849ec460d058',
      parentId: null,
      name: 'Salário',
      icon: 'briefcase',
      color: '#2D6A4F',
      type: 'INCOME' as const,
    },
    {
      id: 'f2f5e8c1-e69d-4297-986b-ab08e06c7540',
      parentId: null,
      name: 'Freelance',
      icon: 'laptop',
      color: '#2D6A4F',
      type: 'INCOME' as const,
    },
    {
      id: '1b8c7a34-8aca-4a5d-b31f-09210053e378',
      parentId: null,
      name: 'Alimentação',
      icon: 'utensils',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: '1bed865c-d442-4409-b7eb-421dd9592e1f',
      parentId: null,
      name: 'Transporte',
      icon: 'car',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: 'f0ac9909-cce0-4456-8f7b-cbe7ec36a800',
      parentId: null,
      name: 'Saúde',
      icon: 'heart-pulse',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: '9fe5cd5b-c6b2-458b-9311-21ed5910d3ed',
      parentId: null,
      name: 'Lazer',
      icon: 'smile',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: '12f6f151-5377-4e7b-ab04-194c21058a45',
      parentId: null,
      name: 'Moradia',
      icon: 'home',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
  ]
}

/** Apply retention policy to the audit log in-place. */
export function applyRetention(
  log: DataFile['auditLog'],
  limit: number | null
): DataFile['auditLog'] {
  if (limit === null) return log // unlimited opt-in

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - AUDIT_RETENTION_DAYS)

  const withinWindow = log.filter((e) => new Date(e.timestamp) >= cutoff)
  return withinWindow.slice(-limit)
}

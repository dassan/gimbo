import { z } from 'zod'
import type { DataFile, WorkspaceFile } from '@/types'
import { uuid, now } from '@/lib/utils'

export const AUDIT_RETENTION_DEFAULT = 200
export const AUDIT_RETENTION_DAYS = 90
export const CURRENT_SCHEMA_VERSION = 3

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
  email: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const SettingsSchema = z.object({
  fileCreatedAt: z.string(),
  fileUpdatedAt: z.string(),
  auditLogRetentionLimit: z.number().nullable(),
})

const CreditMetadataSchema = z.object({
  limit: z.number(),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
})

const AccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['RETAIL', 'SAVINGS', 'CREDIT', 'CRYPTO', 'FOREX', 'ASSET', 'STOCKS', 'OTHER']),
  balance: z.number(),
  includeInBalance: z.boolean(),
  creditMetadata: CreditMetadataSchema.optional(),
  issuerIcon: z.string().optional(), // only for CREDIT accounts — key like 'nubank', 'itau', 'generic'
})

const CategorySchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  type: z.enum(['INCOME', 'EXPENSE']),
})

const TagSchema = z.object({
  id: z.string(),
  name: z.string(),
  color: z.string(),
})

const InstallmentSchema = z.object({
  parentId: z.string(),
  currentIndex: z.number().int().min(1),
  total: z.number().int().min(2),
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
  transferAccountId: z.string().optional(), // only for CREDIT_PAYMENT
})

const ValuationSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  date: z.string(),
  marketValue: z.number(),
})

const AuditEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']),
  entity: z.enum(['account', 'category', 'tag', 'transaction', 'user']),
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

  return migrated
}

// ─── Factories ────────────────────────────────────────────────────────────────

export function createEmptyDataFile(name: string, email: string): DataFile {
  const ts = now()
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    user: { name, email, createdAt: ts, updatedAt: ts },
    settings: {
      fileCreatedAt: ts,
      fileUpdatedAt: ts,
      auditLogRetentionLimit: AUDIT_RETENTION_DEFAULT,
    },
    accounts: [],
    categories: getDefaultCategories(),
    tags: [],
    transactions: [],
    valuations: [],
    auditLog: [],
    deletedIds: [],
  }
}

export function createDefaultWorkspace(): WorkspaceFile {
  return {
    theme: 'system',
    locale: 'pt-BR',
    defaultView: 'dashboard',
    useAmbientShadows: false,
    netWorthIncludeHidden: true,
  }
}

function getDefaultCategories() {
  return [
    {
      id: uuid(),
      parentId: null,
      name: 'Salário',
      icon: 'briefcase',
      color: '#2D6A4F',
      type: 'INCOME' as const,
    },
    {
      id: uuid(),
      parentId: null,
      name: 'Freelance',
      icon: 'laptop',
      color: '#2D6A4F',
      type: 'INCOME' as const,
    },
    {
      id: uuid(),
      parentId: null,
      name: 'Alimentação',
      icon: 'utensils',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: uuid(),
      parentId: null,
      name: 'Transporte',
      icon: 'car',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: uuid(),
      parentId: null,
      name: 'Saúde',
      icon: 'heart-pulse',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: uuid(),
      parentId: null,
      name: 'Lazer',
      icon: 'smile',
      color: '#C0392B',
      type: 'EXPENSE' as const,
    },
    {
      id: uuid(),
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

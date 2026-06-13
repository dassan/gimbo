import { describe, it, expect } from 'vitest'
import {
  applyRetention,
  createEmptyDataFile,
  validateDataFile,
  DataFileSchema,
  AUDIT_RETENTION_DAYS,
  CURRENT_SCHEMA_VERSION,
  SchemaVersionError,
} from '@/lib/storage/schema'
import type { AuditEntry, DataFile } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(daysAgo: number): AuditEntry {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return {
    id: `id-${daysAgo}`,
    timestamp: d.toISOString(),
    action: 'CREATE',
    entity: 'account',
    entityId: 'acc-1',
    summary: 'test',
  }
}

const MINIMAL_VALID: DataFile = {
  schemaVersion: 9,
  user: { name: 'x', email: '', createdAt: '', updatedAt: '' },
  settings: { fileCreatedAt: '', fileUpdatedAt: '', auditLogRetentionLimit: 200 },
  accounts: [],
  categories: [],
  tags: [],
  transactions: [],
  valuations: [],
  auditLog: [],
  deletedIds: [],
  savedPeriods: [],
}

// ─── applyRetention ───────────────────────────────────────────────────────────

describe('applyRetention', () => {
  it('returns log unchanged when limit is null (unlimited)', () => {
    const log = [makeEntry(200), makeEntry(100), makeEntry(10)]
    expect(applyRetention(log, null)).toHaveLength(3)
  })

  it('filters entries older than AUDIT_RETENTION_DAYS', () => {
    const log = [makeEntry(AUDIT_RETENTION_DAYS + 1), makeEntry(10)]
    const result = applyRetention(log, 200)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('id-10')
  })

  it('slices to the last N entries when limit is exceeded', () => {
    const log = Array.from({ length: 10 }, (_, i) => makeEntry(i))
    const result = applyRetention(log, 3)
    expect(result).toHaveLength(3)
  })

  it('applies both date filter and limit together', () => {
    const log = [
      makeEntry(AUDIT_RETENTION_DAYS + 1),
      ...Array.from({ length: 5 }, (_, i) => makeEntry(i)),
    ]
    const result = applyRetention(log, 3)
    expect(result).toHaveLength(3)
    expect(result.every((e) => !e.id.startsWith(`id-${AUDIT_RETENTION_DAYS + 1}`))).toBe(true)
  })
})

// ─── createEmptyDataFile ──────────────────────────────────────────────────────

describe('createEmptyDataFile', () => {
  it('returns a valid DataFile shape', () => {
    const file = createEmptyDataFile('Ana', 'ana@example.com')
    expect(file.user.name).toBe('Ana')
    expect(file.user.email).toBe('ana@example.com')
    expect(Array.isArray(file.accounts)).toBe(true)
    expect(Array.isArray(file.transactions)).toBe(true)
    expect(Array.isArray(file.auditLog)).toBe(true)
    expect(typeof file.settings.auditLogRetentionLimit).toBe('number')
  })

  it('creates default categories', () => {
    const file = createEmptyDataFile('x', '')
    expect(file.categories.length).toBeGreaterThan(0)
  })

  it('produces a DataFile that passes Zod validation', () => {
    const file = createEmptyDataFile('Alice', 'alice@example.com')
    expect(() => DataFileSchema.parse(file)).not.toThrow()
  })

  it(`sets schemaVersion to CURRENT_SCHEMA_VERSION (${CURRENT_SCHEMA_VERSION})`, () => {
    const file = createEmptyDataFile('Dave', '')
    expect(file.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('starts with empty accounts, tags and transactions', () => {
    const file = createEmptyDataFile('Bob', '')
    expect(file.accounts).toHaveLength(0)
    expect(file.tags).toHaveLength(0)
    expect(file.transactions).toHaveLength(0)
  })

  it('pre-populates default categories that each pass the category schema', () => {
    const file = createEmptyDataFile('Charlie', '')
    expect(file.categories.length).toBeGreaterThan(0)
    for (const cat of file.categories) {
      expect(() => DataFileSchema.shape.categories.element.parse(cat)).not.toThrow()
    }
  })
})

// ─── validateDataFile ─────────────────────────────────────────────────────────

describe('validateDataFile', () => {
  it('accepts a valid DataFile object', () => {
    expect(() => validateDataFile(MINIMAL_VALID)).not.toThrow()
    expect(validateDataFile(MINIMAL_VALID)).toEqual(MINIMAL_VALID)
  })

  it('accepts a DataFile with full nested entities', () => {
    const data: DataFile = {
      ...MINIMAL_VALID,
      accounts: [
        { id: 'a1', name: 'Checking', type: 'RETAIL', balance: 1000, includeInBalance: true },
      ],
      categories: [
        {
          id: 'c1',
          parentId: null,
          name: 'Food',
          icon: 'utensils',
          color: '#FF8A83',
          type: 'EXPENSE',
        },
      ],
      tags: [{ id: 't1', name: 'urgent', color: '#FF0000' }],
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 50,
          type: 'EXPENSE',
          date: '2024-01-15',
          description: 'Lunch',
          isPaid: true,
          tags: ['t1'],
        },
      ],
      auditLog: [
        {
          id: 'au1',
          timestamp: '2024-01-15T12:00:00',
          action: 'CREATE',
          entity: 'transaction',
          entityId: 'tx1',
          summary: 'Created transaction Lunch',
        },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('accepts null auditLogRetentionLimit (unlimited opt-in)', () => {
    const data = {
      ...MINIMAL_VALID,
      settings: { ...MINIMAL_VALID.settings, auditLogRetentionLimit: null },
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('throws when root is not an object', () => {
    expect(() => validateDataFile('string')).toThrow()
    expect(() => validateDataFile(null)).toThrow()
    expect(() => validateDataFile(42)).toThrow()
    expect(() => validateDataFile([1, 2])).toThrow()
  })

  it('throws when "user" field is missing', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { user: _user, ...rest } = MINIMAL_VALID
    expect(() => validateDataFile(rest)).toThrow()
  })

  it('throws when "accounts" is not an array', () => {
    expect(() => validateDataFile({ ...MINIMAL_VALID, accounts: 'bad' })).toThrow()
  })

  it('throws when "transactions" is not an array', () => {
    expect(() => validateDataFile({ ...MINIMAL_VALID, transactions: null })).toThrow()
  })

  it('throws when an account has an invalid type enum', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        { id: 'a1', name: 'Bad', type: 'INVALID_TYPE', balance: 0, includeInBalance: false },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('throws when a transaction has an invalid type enum', () => {
    const data = {
      ...MINIMAL_VALID,
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 10,
          type: 'PAYMENT',
          date: '2024-01-01',
          description: 'x',
          isPaid: false,
          tags: [],
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('throws when an audit entry has an invalid action enum', () => {
    const data = {
      ...MINIMAL_VALID,
      auditLog: [
        {
          id: 'au1',
          timestamp: '2024-01-01T00:00:00',
          action: 'MODIFY',
          entity: 'account',
          entityId: 'a1',
          summary: 'test',
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('throws when auditLogRetentionLimit is a string instead of number or null', () => {
    const data = {
      ...MINIMAL_VALID,
      settings: { ...MINIMAL_VALID.settings, auditLogRetentionLimit: 'unlimited' },
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('throws when a category type is invalid', () => {
    const data = {
      ...MINIMAL_VALID,
      categories: [
        { id: 'c1', parentId: null, name: 'X', icon: 'x', color: '#000', type: 'OTHER' },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })
})

// ─── Schema version compatibility (M-01) ─────────────────────────────────────

describe('validateDataFile — schema version', () => {
  it('accepts a file without schemaVersion (legacy) and migrates it to CURRENT_SCHEMA_VERSION', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { schemaVersion: _schemaVersion, ...legacy } = MINIMAL_VALID
    const result = validateDataFile(legacy)
    expect(result.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('accepts a file with schemaVersion equal to CURRENT_SCHEMA_VERSION', () => {
    expect(() =>
      validateDataFile({ ...MINIMAL_VALID, schemaVersion: CURRENT_SCHEMA_VERSION })
    ).not.toThrow()
  })

  it('throws SchemaVersionError for a schemaVersion above CURRENT_SCHEMA_VERSION', () => {
    const future = { ...MINIMAL_VALID, schemaVersion: CURRENT_SCHEMA_VERSION + 1 }
    expect(() => validateDataFile(future)).toThrow(SchemaVersionError)
  })

  it('SchemaVersionError carries the detected version number', () => {
    const futureVersion = CURRENT_SCHEMA_VERSION + 5
    try {
      validateDataFile({ ...MINIMAL_VALID, schemaVersion: futureVersion })
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaVersionError)
      expect((err as SchemaVersionError).detectedVersion).toBe(futureVersion)
    }
  })
})

// ─── Migration v1 → v2 (CC-05) ───────────────────────────────────────────────

describe('validateDataFile — v1 → v2 migration', () => {
  const V1_FILE: DataFile = {
    schemaVersion: 1,
    user: { name: 'x', email: '', createdAt: '', updatedAt: '' },
    settings: { fileCreatedAt: '', fileUpdatedAt: '', auditLogRetentionLimit: 200 },
    accounts: [{ id: 'a1', name: 'Conta', type: 'RETAIL', balance: 0, includeInBalance: true }],
    categories: [],
    tags: [],
    transactions: [
      {
        id: 'tx1',
        accountId: 'a1',
        categoryId: 'c1',
        amount: 50,
        type: 'EXPENSE',
        date: '2024-01-15',
        description: 'Compra',
        isPaid: true,
        tags: [],
      },
    ],
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
  }

  it('migrates a v1 file to schemaVersion 9 (current)', () => {
    const result = validateDataFile(V1_FILE)
    expect(result.schemaVersion).toBe(9)
  })

  it('preserves all existing accounts during v1 → v2 migration', () => {
    const result = validateDataFile(V1_FILE)
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].id).toBe('a1')
    expect(result.accounts[0].creditMetadata).toBeUndefined()
  })

  it('preserves all existing transactions during v1 → v2 migration', () => {
    const result = validateDataFile(V1_FILE)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].id).toBe('tx1')
    expect(result.transactions[0].installment).toBeUndefined()
  })

  it('accepts a v2 file and migrates it to schemaVersion 9', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 2 })
    expect(result.schemaVersion).toBe(9)
  })

  it('migrates a v3 file to schemaVersion 9', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 3, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('migrates a v4 file to schemaVersion 9', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 4, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('migrates a v5 file to schemaVersion 9 (B-18, no-op shape change)', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 5, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('migrates a v6 file to schemaVersion 9 (CC-33, no-op shape change)', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 6, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('migrates a v7 file to schemaVersion 9 (M-42, no-op shape change)', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 7, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('migrates a v8 file to schemaVersion 9 (M-45, no-op shape change)', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 8, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('accepts a v9 file without running migration (idempotent)', () => {
    const result = validateDataFile({ ...V1_FILE, schemaVersion: 9, valuations: [] })
    expect(result.schemaVersion).toBe(9)
  })

  it('throws SchemaVersionError for a v10 file (future version)', () => {
    expect(() => validateDataFile({ ...V1_FILE, schemaVersion: 10, valuations: [] })).toThrow(
      SchemaVersionError
    )
  })
})

// ─── Schema v2 — new optional fields (CC-02, CC-03, CC-04) ───────────────────

describe('validateDataFile — schema v2 new fields', () => {
  it('accepts an Account with valid creditMetadata', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        {
          id: 'a1',
          name: 'Cartão',
          type: 'CREDIT',
          balance: 0,
          includeInBalance: false,
          creditMetadata: { limit: 5000, closingDay: 10, dueDay: 15 },
        },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('accepts an Account without creditMetadata (field is optional)', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        { id: 'a1', name: 'Corrente', type: 'RETAIL', balance: 0, includeInBalance: true },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('accepts creditMetadata with closingDay=31 and dueDay=31 (B-06)', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        {
          id: 'a1',
          name: 'Cartão',
          type: 'CREDIT',
          balance: 0,
          includeInBalance: false,
          creditMetadata: { limit: 1000, closingDay: 31, dueDay: 31 },
        },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('rejects creditMetadata with closingDay > 31 (B-06)', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        {
          id: 'a1',
          name: 'Cartão',
          type: 'CREDIT',
          balance: 0,
          includeInBalance: false,
          creditMetadata: { limit: 1000, closingDay: 32, dueDay: 10 },
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('rejects creditMetadata with dueDay > 31 (B-06)', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        {
          id: 'a1',
          name: 'Cartão',
          type: 'CREDIT',
          balance: 0,
          includeInBalance: false,
          creditMetadata: { limit: 1000, closingDay: 10, dueDay: 32 },
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('rejects creditMetadata with dueDay < 1', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        {
          id: 'a1',
          name: 'Cartão',
          type: 'CREDIT',
          balance: 0,
          includeInBalance: false,
          creditMetadata: { limit: 1000, closingDay: 10, dueDay: 0 },
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('accepts a Transaction with valid installment', () => {
    const data = {
      ...MINIMAL_VALID,
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 100,
          type: 'EXPENSE',
          date: '2024-01-01',
          description: 'Compra (1/3)',
          isPaid: false,
          tags: [],
          installment: { parentId: 'tx1', currentIndex: 1, total: 3 },
        },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('accepts a Transaction without installment (field is optional)', () => {
    const data = {
      ...MINIMAL_VALID,
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 50,
          type: 'EXPENSE',
          date: '2024-01-01',
          description: 'Compra',
          isPaid: true,
          tags: [],
        },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('accepts a Transaction of type CREDIT_PAYMENT', () => {
    const data = {
      ...MINIMAL_VALID,
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 500,
          type: 'CREDIT_PAYMENT',
          date: '2024-01-10',
          description: 'Pagamento fatura',
          isPaid: true,
          tags: [],
        },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('rejects installment with total < 2', () => {
    const data = {
      ...MINIMAL_VALID,
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 100,
          type: 'EXPENSE',
          date: '2024-01-01',
          description: 'x',
          isPaid: false,
          tags: [],
          installment: { parentId: 'tx1', currentIndex: 1, total: 1 },
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('rejects installment with currentIndex < 1', () => {
    const data = {
      ...MINIMAL_VALID,
      transactions: [
        {
          id: 'tx1',
          accountId: 'a1',
          categoryId: 'c1',
          amount: 100,
          type: 'EXPENSE',
          date: '2024-01-01',
          description: 'x',
          isPaid: false,
          tags: [],
          installment: { parentId: 'tx1', currentIndex: 0, total: 3 },
        },
      ],
    }
    expect(() => validateDataFile(data)).toThrow()
  })
})

// ─── deletedIds tombstone (B-11) ──────────────────────────────────────────────

describe('validateDataFile — deletedIds tombstone (B-11)', () => {
  it('accepts a file with deletedIds array', () => {
    const data = { ...MINIMAL_VALID, deletedIds: ['id-1', 'id-2'] }
    expect(() => validateDataFile(data)).not.toThrow()
    expect(validateDataFile(data).deletedIds).toEqual(['id-1', 'id-2'])
  })

  it('defaults deletedIds to [] when field is absent (legacy files)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deletedIds: _deletedIds, ...withoutField } = { ...MINIMAL_VALID, deletedIds: [] }
    const result = validateDataFile(withoutField)
    expect(result.deletedIds).toEqual([])
  })

  it('createEmptyDataFile includes deletedIds: []', () => {
    const file = createEmptyDataFile('Test', 'test@example.com')
    expect(file.deletedIds).toEqual([])
  })
})

// ─── Migration v2 → v3 (NW-08) ───────────────────────────────────────────────

describe('validateDataFile — v2 → v3 migration (NW-08)', () => {
  const V2_FILE: DataFile = {
    schemaVersion: 2,
    user: { name: 'x', email: '', createdAt: '', updatedAt: '' },
    settings: { fileCreatedAt: '', fileUpdatedAt: '', auditLogRetentionLimit: 200 },
    accounts: [{ id: 'a1', name: 'Stocks', type: 'STOCKS', balance: 5000, includeInBalance: true }],
    categories: [],
    tags: [],
    transactions: [],
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
  }

  it('migrates a v2 file to schemaVersion 9 (current)', () => {
    const result = validateDataFile(V2_FILE)
    expect(result.schemaVersion).toBe(9)
  })

  it('adds valuations: [] when field is absent in a v2 file', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { valuations: _v, ...withoutValuations } = V2_FILE
    const result = validateDataFile(withoutValuations)
    expect(result.valuations).toEqual([])
  })

  it('preserves existing accounts and transactions during v2 → v3 migration', () => {
    const result = validateDataFile(V2_FILE)
    expect(result.accounts).toHaveLength(1)
    expect(result.accounts[0].id).toBe('a1')
    expect(result.transactions).toHaveLength(0)
  })

  it('createEmptyDataFile includes valuations: []', () => {
    const file = createEmptyDataFile('Test', 'test@example.com')
    expect(file.valuations).toEqual([])
  })

  it('createEmptyDataFile sets schemaVersion to 9', () => {
    const file = createEmptyDataFile('Test', 'test@example.com')
    expect(file.schemaVersion).toBe(9)
  })

  it('createEmptyDataFile includes savedPeriods: []', () => {
    const file = createEmptyDataFile('Test', 'test@example.com')
    expect(file.savedPeriods).toEqual([])
  })
})

// ─── Schema v4 — recurrence (M-35) ────────────────────────────────────────────

describe('validateDataFile — recurrence field (M-35)', () => {
  function withTransaction(tx: Record<string, unknown>) {
    return {
      schemaVersion: 4,
      user: { name: 'x', email: '', createdAt: '', updatedAt: '' },
      settings: { fileCreatedAt: '', fileUpdatedAt: '', auditLogRetentionLimit: 200 },
      accounts: [
        { id: 'a1', name: 'Checking', type: 'RETAIL', balance: 0, includeInBalance: true },
      ],
      categories: [],
      tags: [],
      transactions: [tx],
      valuations: [],
      auditLog: [],
      deletedIds: [],
    }
  }

  const baseTx = {
    id: 'tx1',
    accountId: 'a1',
    categoryId: '',
    amount: 1000,
    type: 'INCOME',
    date: '2026-01-10',
    description: 'Salário',
    isPaid: true,
    tags: [],
  }

  it('accepts a transaction with a valid recurrence', () => {
    const result = validateDataFile(
      withTransaction({
        ...baseTx,
        recurrence: { frequency: 'monthly', parentId: 'tx1', endDate: '2026-12-10' },
      })
    )
    expect(result.transactions[0].recurrence?.frequency).toBe('monthly')
    expect(result.transactions[0].recurrence?.parentId).toBe('tx1')
  })

  it('accepts a transaction without recurrence (optional field)', () => {
    const result = validateDataFile(withTransaction(baseTx))
    expect(result.transactions[0].recurrence).toBeUndefined()
  })

  it('rejects an invalid recurrence frequency', () => {
    expect(() =>
      validateDataFile(
        withTransaction({ ...baseTx, recurrence: { frequency: 'daily', parentId: 'tx1' } })
      )
    ).toThrow()
  })

  it('accepts and preserves a transaction with invoiceDueDate (CC-33)', () => {
    const result = validateDataFile(
      withTransaction({ ...baseTx, referenceMonth: '2025-12', invoiceDueDate: '2025-12-07' })
    )
    expect(result.transactions[0].invoiceDueDate).toBe('2025-12-07')
  })

  it('accepts a transaction without invoiceDueDate (optional field)', () => {
    const result = validateDataFile(withTransaction(baseTx))
    expect(result.transactions[0].invoiceDueDate).toBeUndefined()
  })
})

// ─── Schema v3 — Valuation entity (NW-08) ────────────────────────────────────

describe('validateDataFile — schema v3 Valuation fields', () => {
  it('accepts a file with a valid Valuation entry', () => {
    const data = {
      ...MINIMAL_VALID,
      valuations: [{ id: 'v1', accountId: 'a1', date: '2026-01-31', marketValue: 12500 }],
    }
    expect(() => validateDataFile(data)).not.toThrow()
    expect(validateDataFile(data).valuations).toHaveLength(1)
  })

  it('accepts a file with an empty valuations array', () => {
    const data = { ...MINIMAL_VALID, valuations: [] }
    expect(() => validateDataFile(data)).not.toThrow()
  })

  it('defaults valuations to [] when field is absent (legacy v2 files post-migration)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { valuations: _v, ...withoutValuations } = MINIMAL_VALID
    const result = validateDataFile(withoutValuations)
    expect(result.valuations).toEqual([])
  })

  it('accepts multiple valuations for the same account on different dates', () => {
    const data = {
      ...MINIMAL_VALID,
      valuations: [
        { id: 'v1', accountId: 'a1', date: '2026-01-31', marketValue: 10000 },
        { id: 'v2', accountId: 'a1', date: '2026-02-28', marketValue: 11500 },
      ],
    }
    expect(() => validateDataFile(data)).not.toThrow()
    expect(validateDataFile(data).valuations).toHaveLength(2)
  })

  it('rejects a Valuation with missing marketValue', () => {
    const data = {
      ...MINIMAL_VALID,
      valuations: [{ id: 'v1', accountId: 'a1', date: '2026-01-31' }],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('rejects a Valuation with non-numeric marketValue', () => {
    const data = {
      ...MINIMAL_VALID,
      valuations: [{ id: 'v1', accountId: 'a1', date: '2026-01-31', marketValue: 'ten thousand' }],
    }
    expect(() => validateDataFile(data)).toThrow()
  })

  it('rejects a Valuation with missing accountId', () => {
    const data = {
      ...MINIMAL_VALID,
      valuations: [{ id: 'v1', date: '2026-01-31', marketValue: 5000 }],
    }
    expect(() => validateDataFile(data)).toThrow()
  })
})

// ─── Schema v8 — archived accounts (M-42) ────────────────────────────────────

describe('validateDataFile — archived field on Account (M-42)', () => {
  it('accepts an Account with archived: true', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        {
          id: 'a1',
          name: 'Conta antiga',
          type: 'RETAIL',
          balance: 0,
          includeInBalance: true,
          archived: true,
        },
      ],
    }
    const result = validateDataFile(data)
    expect(result.accounts[0].archived).toBe(true)
  })

  it('accepts an Account without archived (optional field)', () => {
    const data = {
      ...MINIMAL_VALID,
      accounts: [
        { id: 'a1', name: 'Corrente', type: 'RETAIL', balance: 0, includeInBalance: true },
      ],
    }
    const result = validateDataFile(data)
    expect(result.accounts[0].archived).toBeUndefined()
  })
})

// ─── Schema v9 — saved periods (M-45) ────────────────────────────────────────

describe('validateDataFile — savedPeriods (M-45)', () => {
  it('accepts a file with a valid SavedPeriod entry', () => {
    const data = {
      ...MINIMAL_VALID,
      savedPeriods: [{ id: 'p1', name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' }],
    }
    const result = validateDataFile(data)
    expect(result.savedPeriods).toEqual([
      { id: 'p1', name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' },
    ])
  })

  it('adds savedPeriods: [] when the field is absent (older files)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { savedPeriods: _sp, ...withoutSavedPeriods } = MINIMAL_VALID
    const result = validateDataFile(withoutSavedPeriods)
    expect(result.savedPeriods).toEqual([])
  })

  it('rejects a SavedPeriod with missing fields', () => {
    const data = {
      ...MINIMAL_VALID,
      savedPeriods: [{ id: 'p1', name: 'Q1 2026' }],
    }
    expect(() => validateDataFile(data)).toThrow()
  })
})

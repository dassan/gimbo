import { describe, it, expect } from 'vitest'
import { mergeForSync } from '@/lib/cloudSync/merge'
import type { Account, AuditEntry, Budget, DataFile, Transaction } from '@/types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDataFile(overrides: Partial<DataFile> = {}): DataFile {
  return {
    schemaVersion: 13,
    user: {
      name: 'Ana',
      email: 'ana@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    settings: {
      fileCreatedAt: '2026-01-01T00:00:00.000Z',
      fileUpdatedAt: '2026-01-01T00:00:00.000Z',
      auditLogRetentionLimit: 200,
      quadrantesEnabled: false,
    },
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
    budgets: [],
    ...overrides,
  }
}

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Conta',
    type: 'RETAIL',
    balance: 0,
    includeInBalance: true,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-01-10',
    description: 'Compra',
    isPaid: true,
    tags: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeBudget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'bx-1',
    name: 'Viagem',
    emoji: '✈️',
    color: '#1B4F72',
    kind: 'expense',
    target: 1000,
    period: { mode: 'range', start: '2026-01-01', end: '2026-12-31' },
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeAuditEntry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 'au-1',
    timestamp: '2026-01-01T00:00:00.000Z',
    action: 'CREATE',
    entity: 'account',
    entityId: 'acc-1',
    summary: 'test',
    ...overrides,
  }
}

// ─── mergeForSync ─────────────────────────────────────────────────────────────

describe('mergeForSync', () => {
  it('keeps a transaction that only exists in remote', () => {
    const local = makeDataFile()
    const remote = makeDataFile({ transactions: [makeTx({ id: 'tx-remote' })] })
    const result = mergeForSync(local, remote)
    expect(result.transactions.map((t) => t.id)).toEqual(['tx-remote'])
  })

  it('keeps a transaction that only exists in local', () => {
    const local = makeDataFile({ transactions: [makeTx({ id: 'tx-local' })] })
    const remote = makeDataFile()
    const result = mergeForSync(local, remote)
    expect(result.transactions.map((t) => t.id)).toEqual(['tx-local'])
  })

  it('on collision, the greater updatedAt wins (remote newer)', () => {
    const local = makeDataFile({
      transactions: [makeTx({ description: 'Antiga', updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const remote = makeDataFile({
      transactions: [makeTx({ description: 'Nova', updatedAt: '2026-02-01T00:00:00.000Z' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].description).toBe('Nova')
  })

  it('on collision, the greater updatedAt wins (local newer)', () => {
    const local = makeDataFile({
      transactions: [makeTx({ description: 'Nova', updatedAt: '2026-02-01T00:00:00.000Z' })],
    })
    const remote = makeDataFile({
      transactions: [makeTx({ description: 'Antiga', updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.transactions).toHaveLength(1)
    expect(result.transactions[0].description).toBe('Nova')
  })

  it('a legacy epoch updatedAt never wins over a real timestamp', () => {
    const epoch = new Date(0).toISOString()
    const local = makeDataFile({
      transactions: [makeTx({ description: 'Legada', updatedAt: epoch })],
    })
    const remote = makeDataFile({
      transactions: [makeTx({ description: 'Recente', updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.transactions[0].description).toBe('Recente')

    // and the reverse direction
    const result2 = mergeForSync(remote, local)
    expect(result2.transactions[0].description).toBe('Recente')
  })

  it('respects a deletion recorded via deletedIds on either side', () => {
    const local = makeDataFile({
      transactions: [makeTx({ id: 'tx-1' })],
      deletedIds: ['tx-2'],
    })
    const remote = makeDataFile({
      transactions: [makeTx({ id: 'tx-2' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.transactions.map((t) => t.id)).toEqual(['tx-1'])
    expect(result.deletedIds).toContain('tx-2')
  })

  it('removes an entity present on the other side when it is in deletedIds', () => {
    const local = makeDataFile({ deletedIds: ['acc-1'] })
    const remote = makeDataFile({ accounts: [makeAccount({ id: 'acc-1' })] })
    const result = mergeForSync(local, remote)
    expect(result.accounts).toHaveLength(0)
  })

  it('keeps both offline duplicates (same content, different ids)', () => {
    const local = makeDataFile({
      transactions: [makeTx({ id: 'tx-a', description: 'Almoço', amount: 40 })],
    })
    const remote = makeDataFile({
      transactions: [makeTx({ id: 'tx-b', description: 'Almoço', amount: 40 })],
    })
    const result = mergeForSync(local, remote)
    expect(result.transactions.map((t) => t.id).sort()).toEqual(['tx-a', 'tx-b'])
  })

  it('dedupes, orders and applies retention to the audit log', () => {
    // applyRetention also filters by AUDIT_RETENTION_DAYS, so use recent timestamps
    // (days-ago-from-now) rather than fixed dates that could fall outside the window.
    const daysAgo = (n: number) => {
      const d = new Date()
      d.setDate(d.getDate() - n)
      return d.toISOString()
    }
    const shared = makeAuditEntry({ id: 'au-shared', timestamp: daysAgo(2) })
    const local = makeDataFile({
      auditLog: [makeAuditEntry({ id: 'au-1', timestamp: daysAgo(1) }), shared],
      settings: {
        fileCreatedAt: daysAgo(3),
        fileUpdatedAt: daysAgo(3),
        auditLogRetentionLimit: 2,
        quadrantesEnabled: false,
      },
    })
    const remote = makeDataFile({
      auditLog: [makeAuditEntry({ id: 'au-2', timestamp: daysAgo(3) }), shared],
    })
    const result = mergeForSync(local, remote)
    // 3 distinct ids (au-1, au-2, au-shared) deduped, retention limit 2 keeps the last 2 by time
    expect(result.auditLog).toHaveLength(2)
    expect(result.auditLog.map((e) => e.id)).toEqual(['au-shared', 'au-1'])
  })

  it('takes the max fileUpdatedAt from both sides', () => {
    const local = makeDataFile({
      settings: {
        fileCreatedAt: '2026-01-01T00:00:00.000Z',
        fileUpdatedAt: '2026-01-01T00:00:00.000Z',
        auditLogRetentionLimit: 200,
        quadrantesEnabled: false,
      },
    })
    const remote = makeDataFile({
      settings: {
        fileCreatedAt: '2026-01-01T00:00:00.000Z',
        fileUpdatedAt: '2026-03-01T00:00:00.000Z',
        auditLogRetentionLimit: 200,
        quadrantesEnabled: false,
      },
    })
    const result = mergeForSync(local, remote)
    expect(result.settings.fileUpdatedAt).toBe('2026-03-01T00:00:00.000Z')
  })

  it('local settings (other than fileUpdatedAt) and user always win', () => {
    const local = makeDataFile({
      user: { name: 'Local User', email: 'l@x.com', createdAt: '', updatedAt: '' },
    })
    const remote = makeDataFile({
      user: { name: 'Remote User', email: 'r@x.com', createdAt: '', updatedAt: '' },
    })
    const result = mergeForSync(local, remote)
    expect(result.user.name).toBe('Local User')
  })

  it('valuations and savedPeriods union by id with local winning on collision', () => {
    const local = makeDataFile({
      valuations: [{ id: 'v-1', accountId: 'acc-1', date: '2026-01-01', marketValue: 100 }],
    })
    const remote = makeDataFile({
      valuations: [
        { id: 'v-1', accountId: 'acc-1', date: '2026-01-01', marketValue: 999 },
        { id: 'v-2', accountId: 'acc-1', date: '2026-02-01', marketValue: 200 },
      ],
    })
    const result = mergeForSync(local, remote)
    expect(result.valuations.find((v) => v.id === 'v-1')?.marketValue).toBe(100)
    expect(result.valuations.find((v) => v.id === 'v-2')?.marketValue).toBe(200)
  })

  // ─── BX-09: caixinhas (Budget) no motor de merge ─────────────────────────────
  // Mecânica resolvida em BX-03 como efeito colateral do bump de DataFile (budgets some
  // union por LWW igual a accounts/categories/tags) — faltava só este teste dedicado.

  it('keeps a budget that only exists in remote', () => {
    const local = makeDataFile()
    const remote = makeDataFile({ budgets: [makeBudget({ id: 'bx-remote' })] })
    const result = mergeForSync(local, remote)
    expect(result.budgets.map((b) => b.id)).toEqual(['bx-remote'])
  })

  it('keeps a budget that only exists in local', () => {
    const local = makeDataFile({ budgets: [makeBudget({ id: 'bx-local' })] })
    const remote = makeDataFile()
    const result = mergeForSync(local, remote)
    expect(result.budgets.map((b) => b.id)).toEqual(['bx-local'])
  })

  it('on collision, the greater updatedAt wins (remote newer)', () => {
    const local = makeDataFile({
      budgets: [makeBudget({ target: 1000, updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const remote = makeDataFile({
      budgets: [makeBudget({ target: 2000, updatedAt: '2026-02-01T00:00:00.000Z' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.budgets).toHaveLength(1)
    expect(result.budgets[0].target).toBe(2000)
  })

  it('on collision, the greater updatedAt wins (local newer)', () => {
    const local = makeDataFile({
      budgets: [makeBudget({ target: 2000, updatedAt: '2026-02-01T00:00:00.000Z' })],
    })
    const remote = makeDataFile({
      budgets: [makeBudget({ target: 1000, updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.budgets).toHaveLength(1)
    expect(result.budgets[0].target).toBe(2000)
  })

  it('removes a budget present on the other side when it is in deletedIds', () => {
    const local = makeDataFile({ deletedIds: ['bx-1'] })
    const remote = makeDataFile({ budgets: [makeBudget({ id: 'bx-1' })] })
    const result = mergeForSync(local, remote)
    expect(result.budgets).toHaveLength(0)
  })

  it('carries budgetIds along for free as part of the transaction merge (no dedicated logic)', () => {
    const local = makeDataFile({
      transactions: [
        makeTx({ id: 'tx-1', budgetIds: ['bx-1'], updatedAt: '2026-02-01T00:00:00.000Z' }),
      ],
    })
    const remote = makeDataFile({
      transactions: [makeTx({ id: 'tx-1', budgetIds: [], updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const result = mergeForSync(local, remote)
    expect(result.transactions[0].budgetIds).toEqual(['bx-1'])
  })

  it('is idempotent: merge(merge(a, b), b) equals merge(a, b)', () => {
    const a = makeDataFile({
      accounts: [makeAccount({ id: 'acc-1', updatedAt: '2026-01-01T00:00:00.000Z' })],
      transactions: [makeTx({ id: 'tx-1', updatedAt: '2026-01-01T00:00:00.000Z' })],
      deletedIds: ['ghost-1'],
      auditLog: [makeAuditEntry({ id: 'au-1' })],
    })
    const b = makeDataFile({
      accounts: [
        makeAccount({ id: 'acc-1', name: 'Renomeada', updatedAt: '2026-02-01T00:00:00.000Z' }),
      ],
      transactions: [makeTx({ id: 'tx-2', updatedAt: '2026-01-15T00:00:00.000Z' })],
      deletedIds: ['ghost-2'],
      auditLog: [makeAuditEntry({ id: 'au-2', timestamp: '2026-01-05T00:00:00.000Z' })],
    })

    const once = mergeForSync(a, b)
    const twice = mergeForSync(once, b)
    expect(twice).toEqual(once)
  })
})

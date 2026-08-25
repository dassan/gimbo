import { describe, it, expect } from 'vitest'
import {
  hashRow,
  combineHashes,
  accountRowKey,
  categoryRowKey,
  tagRowKey,
  budgetRowKey,
  valuationRowKey,
  savedPeriodRowKey,
  auditEntryRowKey,
  transactionRowKey,
} from '@/lib/storage/rowHash'
import type {
  RawAccount,
  RawCategory,
  RawTag,
  RawTransaction,
  RawBudget,
  RawValuation,
  RawSavedPeriod,
  RawAuditEntry,
} from '@/services/storage/worker'

function makeFullTransaction(overrides: Partial<RawTransaction> = {}): RawTransaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-01-15',
    description: 'Original',
    isPaid: true,
    tags: ['tag-a', 'tag-b'],
    budgetIds: ['bud-a'],
    installment: { parentId: 'parent-1', currentIndex: 1, total: 3, purchaseDate: '2026-01-01' },
    recurrence: { frequency: 'monthly', parentId: 'parent-2', endDate: '2026-12-31' },
    transferAccountId: 'acc-2',
    referenceMonth: '2026-01',
    invoiceDueDate: '2026-02-10',
    updatedAt: '2026-01-15T10:00:00.000Z',
    createdAt: '2026-01-15T09:00:00.000Z',
    ...overrides,
  }
}

function makeFullAccount(overrides: Partial<RawAccount> = {}): RawAccount {
  return {
    id: 'acc-1',
    name: 'Conta',
    type: 'RETAIL',
    balance: 100,
    includeInBalance: true,
    creditMetadata: { limit: 1000, closingDay: 10, dueDay: 20 },
    loanMetadata: {
      outstandingBalance: 500,
      monthlyPayment: 50,
      remainingInstallments: 10,
      interestRate: 1.5,
    },
    reserveMetadata: {},
    issuerIcon: 'nubank',
    archived: false,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('hashRow / combineHashes', () => {
  it('is deterministic', () => {
    expect(hashRow('abc')).toBe(hashRow('abc'))
  })

  it('is sensitive to any content difference', () => {
    expect(hashRow('abc')).not.toBe(hashRow('abd'))
    expect(hashRow('ab')).not.toBe(hashRow('abc'))
  })

  it('combineHashes is commutative — row visit order never matters', () => {
    const h1 = hashRow('row-1')
    const h2 = hashRow('row-2')
    const h3 = hashRow('row-3')
    expect(combineHashes([h1, h2, h3])).toBe(combineHashes([h3, h1, h2]))
    expect(combineHashes([h1, h2, h3])).toBe(combineHashes([h2, h3, h1]))
  })

  it('combineHashes([]) is 0 — an emptied partition hashes to a known, comparable value', () => {
    expect(combineHashes([])).toBe(0)
  })

  // Propriedade da qual toda a manutenção incremental (writeSmallTables/applyTransactionDelta)
  // depende: XOR-fold permite tirar/adicionar uma linha sem reler a partição inteira.
  it('XOR-fold is incrementally equivalent to recomputing from scratch', () => {
    const rows = ['row-a', 'row-b', 'row-c'].map(hashRow)
    const full = combineHashes(rows)

    // Remove 'row-b', add 'row-d' — incremental update via XOR.
    const removed = hashRow('row-b')
    const added = hashRow('row-d')
    const incremental = full ^ removed ^ added

    const recomputed = combineHashes(['row-a', 'row-c', 'row-d'].map(hashRow))
    expect(incremental).toBe(recomputed)
  })
})

// Guarda contra detecção silenciosa quebrada: se um campo novo entrar em Raw* e a função de
// serialização não for atualizada, o hash não muda quando deveria — mesmo padrão de
// transactionDiff.test.ts.
describe('row key functions detect a change in every field', () => {
  it('transactionRowKey', () => {
    const base = makeFullTransaction()
    const baseHash = hashRow(transactionRowKey(base))
    const overrides: Array<Partial<RawTransaction>> = [
      { accountId: 'acc-changed' },
      { categoryId: 'cat-changed' },
      { amount: 999 },
      { type: 'INCOME' },
      { description: 'Changed' },
      { date: '2026-02-01' },
      { isPaid: false },
      { tags: ['tag-changed'] },
      { budgetIds: ['bud-changed'] },
      { installment: { parentId: 'parent-changed', currentIndex: 2, total: 3 } },
      { recurrence: { frequency: 'weekly', parentId: 'parent-changed' } },
      { transferAccountId: 'acc-changed' },
      { referenceMonth: '2026-02' },
      { invoiceDueDate: '2026-03-10' },
      { updatedAt: '2026-01-16T10:00:00.000Z' },
      { createdAt: '2026-01-16T09:00:00.000Z' },
    ]
    for (const override of overrides) {
      const changed = makeFullTransaction(override)
      expect(
        hashRow(transactionRowKey(changed)),
        `field(s) ${Object.keys(override).join(',')} not detected`
      ).not.toBe(baseHash)
    }
  })

  it('transactionRowKey ignores tags/budgetIds reordering (same membership)', () => {
    const a = makeFullTransaction({ tags: ['a', 'b', 'c'], budgetIds: ['x', 'y'] })
    const b = makeFullTransaction({ tags: ['c', 'a', 'b'], budgetIds: ['y', 'x'] })
    expect(hashRow(transactionRowKey(a))).toBe(hashRow(transactionRowKey(b)))
  })

  it('accountRowKey', () => {
    const base = makeFullAccount()
    const baseHash = hashRow(accountRowKey(base))
    const overrides: Array<Partial<RawAccount>> = [
      { name: 'Changed' },
      { type: 'CREDIT' },
      { balance: 999 },
      { includeInBalance: false },
      { creditMetadata: { limit: 2000, closingDay: 10, dueDay: 20 } },
      { loanMetadata: { outstandingBalance: 999, monthlyPayment: 50, remainingInstallments: 10 } },
      { reserveMetadata: undefined },
      { issuerIcon: 'other' },
      { archived: true },
      { updatedAt: '2026-02-01T00:00:00.000Z' },
    ]
    for (const override of overrides) {
      const changed = makeFullAccount(override)
      expect(
        hashRow(accountRowKey(changed)),
        `field(s) ${Object.keys(override).join(',')} not detected`
      ).not.toBe(baseHash)
    }
  })

  it('categoryRowKey', () => {
    const base: RawCategory = {
      id: 'cat-1',
      parentId: null,
      name: 'Original',
      icon: 'circle',
      color: '#888',
      type: 'EXPENSE',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }
    const baseHash = hashRow(categoryRowKey(base))
    const overrides: Array<Partial<RawCategory>> = [
      { parentId: 'cat-parent' },
      { name: 'Changed' },
      { icon: 'square' },
      { color: '#fff' },
      { type: 'INCOME' },
      { updatedAt: '2026-02-01T00:00:00.000Z' },
    ]
    for (const override of overrides) {
      expect(hashRow(categoryRowKey({ ...base, ...override }))).not.toBe(baseHash)
    }
  })

  it('tagRowKey', () => {
    const base: RawTag = { id: 'tag-1', name: 'Original', color: '#888' }
    const baseHash = hashRow(tagRowKey(base))
    expect(hashRow(tagRowKey({ ...base, name: 'Changed' }))).not.toBe(baseHash)
    expect(hashRow(tagRowKey({ ...base, color: '#fff' }))).not.toBe(baseHash)
  })

  it('budgetRowKey', () => {
    const base: RawBudget = {
      id: 'bud-1',
      name: 'Original',
      emoji: '💰',
      color: '#888',
      kind: 'EXPENSE',
      target: 100,
      period: { mode: 'date', date: '2026-01' },
    }
    const baseHash = hashRow(budgetRowKey(base))
    const overrides: Array<Partial<RawBudget>> = [
      { name: 'Changed' },
      { target: 999 },
      { period: { mode: 'range', start: '2026-01-01', end: '2026-01-31' } },
      { archivedAt: '2026-02-01' },
      { targetSource: 'manual' },
    ]
    for (const override of overrides) {
      expect(hashRow(budgetRowKey({ ...base, ...override }))).not.toBe(baseHash)
    }
  })

  it('valuationRowKey', () => {
    const base: RawValuation = {
      id: 'val-1',
      accountId: 'acc-1',
      date: '2026-01-01',
      marketValue: 100,
    }
    const baseHash = hashRow(valuationRowKey(base))
    expect(hashRow(valuationRowKey({ ...base, marketValue: 200 }))).not.toBe(baseHash)
  })

  it('savedPeriodRowKey', () => {
    const base: RawSavedPeriod = {
      id: 'sp-1',
      name: 'Original',
      start: '2026-01-01',
      end: '2026-01-31',
    }
    const baseHash = hashRow(savedPeriodRowKey(base))
    expect(hashRow(savedPeriodRowKey({ ...base, name: 'Changed' }))).not.toBe(baseHash)
  })

  it('auditEntryRowKey', () => {
    const base: RawAuditEntry = {
      id: 'audit-1',
      timestamp: '2026-01-01T00:00:00.000Z',
      action: 'CREATE',
      entity: 'transaction',
      entityId: 'tx-1',
      summary: 'Original',
    }
    const baseHash = hashRow(auditEntryRowKey(base))
    expect(hashRow(auditEntryRowKey({ ...base, summary: 'Changed' }))).not.toBe(baseHash)
  })
})

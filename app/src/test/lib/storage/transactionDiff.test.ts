import { describe, it, expect } from 'vitest'
import { diffTransactions } from '@/lib/storage/transactionDiff'
import type { Transaction } from '@/types'

// Fixture com TODO campo opcional preenchido — necessário pro teste-guarda abaixo, que depende
// de conseguir mutar qualquer campo e observar uma mudança real de valor.
function makeFullTransaction(overrides: Partial<Transaction> = {}): Transaction {
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

describe('diffTransactions', () => {
  it('returns an empty delta for two empty arrays', () => {
    expect(diffTransactions([], [])).toEqual({ upserts: [], deletedIds: [] })
  })

  it('detects a pure add (single row)', () => {
    const tx = makeFullTransaction()
    const delta = diffTransactions([], [tx])
    expect(delta.upserts).toEqual([tx])
    expect(delta.deletedIds).toEqual([])
  })

  it('detects a pure add of many rows (installment/recurrence-style batch)', () => {
    const txs = Array.from({ length: 5 }, (_, i) => makeFullTransaction({ id: `tx-${i}` }))
    const delta = diffTransactions([], txs)
    expect(delta.upserts).toHaveLength(5)
    expect(delta.deletedIds).toEqual([])
  })

  it('detects a pure delete (single row)', () => {
    const tx = makeFullTransaction()
    const delta = diffTransactions([tx], [])
    expect(delta.upserts).toEqual([])
    expect(delta.deletedIds).toEqual(['tx-1'])
  })

  it('detects a pure delete of many rows (deleteInstallmentGroup/deleteRecurrenceFrom-style)', () => {
    const txs = Array.from({ length: 4 }, (_, i) => makeFullTransaction({ id: `tx-${i}` }))
    const delta = diffTransactions(txs, [])
    expect(delta.upserts).toEqual([])
    expect(delta.deletedIds).toHaveLength(4)
  })

  it('does not flag an untouched transaction as changed', () => {
    const tx = makeFullTransaction()
    const delta = diffTransactions([tx], [{ ...tx }])
    expect(delta.upserts).toEqual([])
    expect(delta.deletedIds).toEqual([])
  })

  it('tags/budgetIds reordered but same membership is NOT flagged as changed', () => {
    const before = makeFullTransaction({ tags: ['a', 'b', 'c'], budgetIds: ['x', 'y'] })
    const after = makeFullTransaction({ tags: ['c', 'a', 'b'], budgetIds: ['y', 'x'] })
    const delta = diffTransactions([before], [after])
    expect(delta.upserts).toEqual([])
  })

  it('tags with different membership IS flagged as changed', () => {
    const before = makeFullTransaction({ tags: ['a', 'b'] })
    const after = makeFullTransaction({ tags: ['a', 'c'] })
    const delta = diffTransactions([before], [after])
    expect(delta.upserts).toEqual([after])
  })

  it('a mixed batch (add + delete + update + untouched) is diffed correctly in one call', () => {
    const untouched = makeFullTransaction({ id: 'tx-untouched' })
    const toDelete = makeFullTransaction({ id: 'tx-delete' })
    const toUpdateBefore = makeFullTransaction({ id: 'tx-update', amount: 100 })
    const toUpdateAfter = makeFullTransaction({ id: 'tx-update', amount: 200 })
    const toAdd = makeFullTransaction({ id: 'tx-add' })

    const before = [untouched, toDelete, toUpdateBefore]
    const after = [{ ...untouched }, toUpdateAfter, toAdd]

    const delta = diffTransactions(before, after)
    expect(delta.deletedIds).toEqual(['tx-delete'])
    expect(delta.upserts).toHaveLength(2)
    expect(delta.upserts.map((t) => t.id).sort()).toEqual(['tx-add', 'tx-update'])
  })

  // Guarda contra detecção silenciosa quebrada: se Transaction ganhar um campo novo e
  // transactionsEqual() não for atualizado pra compará-lo, este teste falha alto.
  it('detects a change in every field of Transaction, one at a time', () => {
    const base = makeFullTransaction()
    const fieldOverrides: Array<Partial<Transaction>> = [
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

    for (const override of fieldOverrides) {
      const changed = makeFullTransaction(override)
      const delta = diffTransactions([base], [changed])
      expect(delta.upserts, `field(s) ${Object.keys(override).join(',')} not detected`).toEqual([
        changed,
      ])
    }
  })
})

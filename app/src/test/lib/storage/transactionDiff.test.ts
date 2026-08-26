import { describe, it, expect } from 'vitest'
import { diffTransactions } from '@/lib/storage/transactionDiff'
import { mergeForSync } from '@/lib/cloudSync/merge'
import { makeDataFile } from '../../fixtures/dataFile'
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

// CS-30 (Fase 1): diffTransactions() não muda — o que muda é o *tipo* de input que passa a
// alimentá-la, vindo de mergeForSync() em vez de uma edição manual via UI. Estes casos fixam que
// ela continua correta para as formas de "before"/"after" que um merge de sync realmente produz.
describe('diffTransactions fed by mergeForSync output (sync write-path)', () => {
  it('a tombstone merged in from the remote peer produces a deletedIds entry even though the local baseline still has the row', () => {
    const tx = makeFullTransaction()
    const local = makeDataFile({ transactions: [tx], deletedIds: [] })
    // Peer deleted this transaction — its tombstone arrives via deletedIds, not by simply
    // omitting the row (mirrors how a real remote delete propagates through mergeForSync).
    const remote = makeDataFile({ transactions: [tx], deletedIds: [tx.id] })

    const merged = mergeForSync(local, remote)
    const delta = diffTransactions(local.transactions, merged.transactions)

    expect(merged.transactions).toEqual([])
    expect(delta.upserts).toEqual([])
    expect(delta.deletedIds).toEqual([tx.id])
  })

  it('first sync of a brand-new device: near-empty baseline, delta is almost entirely upserts', () => {
    const seedTx = makeFullTransaction({ id: 'seed-1' })
    const local = makeDataFile({ transactions: [seedTx] }) // onboarding-seeded, near-empty
    const remoteTxs = Array.from({ length: 500 }, (_, i) =>
      makeFullTransaction({ id: `remote-${i}` })
    )
    const remote = makeDataFile({ transactions: remoteTxs })

    const merged = mergeForSync(local, remote)
    const delta = diffTransactions(local.transactions, merged.transactions)

    // No branch by size — every remote row is a genuine upsert, the local seed survives untouched.
    expect(delta.upserts).toHaveLength(500)
    expect(delta.deletedIds).toEqual([])
    expect(merged.transactions.map((t) => t.id)).toContain('seed-1')
  })

  it('LWW conflict on the same id: the remote row with a newer updatedAt is detected as an upsert', () => {
    const local = makeDataFile({
      transactions: [makeFullTransaction({ updatedAt: '2026-01-01T00:00:00.000Z' })],
    })
    const remoteTx = makeFullTransaction({
      amount: 999,
      updatedAt: '2026-06-01T00:00:00.000Z',
    })
    const remote = makeDataFile({ transactions: [remoteTx] })

    const merged = mergeForSync(local, remote)
    const delta = diffTransactions(local.transactions, merged.transactions)

    expect(delta.upserts).toEqual([remoteTx])
    expect(delta.deletedIds).toEqual([])
  })
})

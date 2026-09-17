import { describe, it, expect } from 'vitest'
import { searchTransactions, sumSignedAmount } from '@/lib/globalSearch'
import type { Transaction } from '@/types'

function mkTx(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-01-15',
    description: 'Compra genérica',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

describe('searchTransactions (M-105)', () => {
  it('returns nothing for an empty or whitespace-only query', () => {
    const txs = [mkTx({ id: '1', description: 'Magazine Luiza - TV' })]
    expect(searchTransactions(txs, { query: '', period: 'all' })).toEqual([])
    expect(searchTransactions(txs, { query: '   ', period: 'all' })).toEqual([])
  })

  it('matches the description case-insensitively and trims the query', () => {
    const txs = [mkTx({ id: '1', description: 'Magazine Luiza - Smart TV' })]
    expect(searchTransactions(txs, { query: 'magazine luiza', period: 'all' })).toHaveLength(1)
    expect(searchTransactions(txs, { query: '  SMART TV  ', period: 'all' })).toHaveLength(1)
    expect(searchTransactions(txs, { query: 'nao existe', period: 'all' })).toHaveLength(0)
  })

  it('excludes TRANSFER and CREDIT_PAYMENT even when the description matches', () => {
    const txs = [
      mkTx({ id: '1', type: 'TRANSFER', description: 'Reembolso viagem' }),
      mkTx({ id: '2', type: 'CREDIT_PAYMENT', description: 'Reembolso viagem' }),
      mkTx({ id: '3', type: 'EXPENSE', description: 'Reembolso viagem' }),
    ]
    const results = searchTransactions(txs, { query: 'reembolso', period: 'all' })
    expect(results.map((r) => r.id)).toEqual(['3'])
  })

  it('period "thisYear"/"lastYear" filter by tx.date, not by an unrelated date', () => {
    const thisYear = new Date().getFullYear()
    const txs = [
      mkTx({ id: 'this', description: 'Consulta médica', date: `${thisYear}-05-10` }),
      mkTx({ id: 'last', description: 'Consulta médica', date: `${thisYear - 1}-05-10` }),
      mkTx({ id: 'older', description: 'Consulta médica', date: `${thisYear - 2}-05-10` }),
    ]
    expect(
      searchTransactions(txs, { query: 'consulta', period: 'thisYear' }).map((r) => r.id)
    ).toEqual(['this'])
    expect(
      searchTransactions(txs, { query: 'consulta', period: 'lastYear' }).map((r) => r.id)
    ).toEqual(['last'])
    expect(searchTransactions(txs, { query: 'consulta', period: 'all' })).toHaveLength(3)
  })

  it('period "custom" filters inclusively by [customStart, customEnd]', () => {
    const txs = [
      mkTx({ id: 'before', description: 'Consulta', date: '2025-12-31' }),
      mkTx({ id: 'start', description: 'Consulta', date: '2026-01-01' }),
      mkTx({ id: 'inside', description: 'Consulta', date: '2026-06-15' }),
      mkTx({ id: 'end', description: 'Consulta', date: '2026-12-31' }),
      mkTx({ id: 'after', description: 'Consulta', date: '2027-01-01' }),
    ]
    const results = searchTransactions(txs, {
      query: 'consulta',
      period: 'custom',
      customStart: '2026-01-01',
      customEnd: '2026-12-31',
    })
    expect(results.map((r) => r.id).sort()).toEqual(['end', 'inside', 'start'])
  })

  it('falls back to no date filtering when period is "custom" but the range is incomplete', () => {
    const txs = [mkTx({ id: '1', description: 'Consulta', date: '2020-01-01' })]
    expect(searchTransactions(txs, { query: 'consulta', period: 'custom' })).toHaveLength(1)
  })

  it('sorts results by date, most recent first', () => {
    const txs = [
      mkTx({ id: 'oldest', description: 'Loja X', date: '2024-01-01' }),
      mkTx({ id: 'newest', description: 'Loja X', date: '2026-06-01' }),
      mkTx({ id: 'middle', description: 'Loja X', date: '2025-03-01' }),
    ]
    expect(searchTransactions(txs, { query: 'loja x', period: 'all' }).map((r) => r.id)).toEqual([
      'newest',
      'middle',
      'oldest',
    ])
  })
})

describe('sumSignedAmount (M-105)', () => {
  it('adds INCOME and subtracts EXPENSE (amount is always stored positive)', () => {
    const txs = [
      mkTx({ id: '1', type: 'INCOME', amount: 500 }),
      mkTx({ id: '2', type: 'EXPENSE', amount: 199.9 }),
    ]
    expect(sumSignedAmount(txs)).toBeCloseTo(300.1)
  })

  it('returns 0 for an empty list', () => {
    expect(sumSignedAmount([])).toBe(0)
  })
})

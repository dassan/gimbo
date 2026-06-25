import type { Account, DataFile, Transaction, Valuation } from '@/types'
import { uuid } from '@/lib/utils'

export function makeDataFile(overrides: Partial<DataFile> = {}): DataFile {
  return {
    schemaVersion: 4,
    user: {
      name: 'Test User',
      email: 'test@example.com',
      createdAt: '2024-01-01T00:00:00',
      updatedAt: '2024-01-01T00:00:00',
    },
    settings: {
      fileCreatedAt: '2024-01-01T00:00:00',
      fileUpdatedAt: '2024-01-01T00:00:00',
      auditLogRetentionLimit: 200,
    },
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
    ...overrides,
  }
}

/**
 * Returns a CREDIT Account with default creditMetadata.
 * Useful for tests that need a credit card account without building the full object.
 */
export function makeCreditAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: uuid(),
    name: 'Cartão Teste',
    type: 'CREDIT',
    balance: 0,
    includeInBalance: false,
    creditMetadata: {
      limit: 5000,
      closingDay: 20,
      dueDay: 10,
    },
    ...overrides,
  }
}

/**
 * Returns a LOAN Account with default loanMetadata.
 * Useful for tests that need a loan account without building the full object (HE-07).
 */
export function makeLoanAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: uuid(),
    name: 'Empréstimo Teste',
    type: 'LOAN',
    balance: 0,
    includeInBalance: false,
    loanMetadata: {
      outstandingBalance: 15000,
      monthlyPayment: 800,
      remainingInstallments: 18,
    },
    ...overrides,
  }
}

/**
 * Returns a Valuation snapshot for an investment account.
 * Eligible account types: STOCKS | CRYPTO | FOREX | ASSET.
 */
export function makeValuation(overrides: Partial<Valuation> = {}): Valuation {
  return {
    id: uuid(),
    accountId: 'acc-invest',
    date: '2026-01-31',
    marketValue: 10000,
    ...overrides,
  }
}

/**
 * Returns an array of N Transaction objects representing an installment group.
 * All share the same parentId; dates advance month by month from `startDate`.
 * Amount is distributed evenly; any rounding remainder goes to the first installment.
 *
 * @param n          Number of installments (minimum 2)
 * @param overrides  Fields applied to every installment (except id, installment, date, description, amount)
 */
export function makeInstallmentGroup(
  n: number,
  overrides: Partial<Transaction> & { amount: number; date: string; description: string } & Pick<
      Transaction,
      'accountId' | 'categoryId'
    >
): Transaction[] {
  const parentId = uuid()
  const total = overrides.amount
  const perInstallment = Math.round((total / n) * 100) / 100
  const remainder = Math.round((total - perInstallment * n) * 100) / 100

  const [y, m, d] = overrides.date.slice(0, 10).split('-').map(Number)

  return Array.from({ length: n }, (_, i) => {
    const index = i + 1
    const amount = index === 1 ? perInstallment + remainder : perInstallment

    // Advance month by i
    const rawMonth = m + i
    const txYear = y + Math.floor((rawMonth - 1) / 12)
    const txMonth = ((rawMonth - 1) % 12) + 1

    // Clamp day to last day of that month
    const lastDay = new Date(txYear, txMonth, 0).getDate()
    const txDay = Math.min(d, lastDay)

    const mm = String(txMonth).padStart(2, '0')
    const dd = String(txDay).padStart(2, '0')
    const txDate = `${txYear}-${mm}-${dd}`

    return {
      id: uuid(),
      type: 'EXPENSE' as const,
      isPaid: false,
      tags: [],
      ...overrides,
      amount,
      date: txDate,
      description: `${overrides.description} (${index}/${n})`,
      installment: {
        parentId,
        currentIndex: index,
        total: n,
      },
    }
  })
}

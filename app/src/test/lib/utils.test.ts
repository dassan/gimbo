import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  getCurrentInvoiceBalance,
  getCreditOutstanding,
  getEffectiveCashFlowDate,
  getInvoiceDueDate,
  getInvoicePaid,
  getInvoicePeriod,
  getInvoiceStatus,
  getInvoiceTotal,
  getTotalCreditLiability,
  invoicePeriodKey,
  isCardCredit,
  isCashRealized,
  now,
  parseDateLocal,
} from '@/lib/utils'
import type { Account, Transaction } from '@/types'

describe('formatCurrency', () => {
  it('formats BRL with comma decimal separator', () => {
    const result = formatCurrency(1500.5, 'pt-BR')
    expect(result).toContain('1.500')
    expect(result).toContain(',50')
  })

  it('formats USD with period decimal separator', () => {
    const result = formatCurrency(1500.5, 'en-US')
    expect(result).toContain('1,500')
    expect(result).toContain('.50')
  })

  it('formats zero correctly', () => {
    const result = formatCurrency(0)
    expect(result).toContain('0')
  })

  it('formats large values without overflow', () => {
    const result = formatCurrency(1_000_000)
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
  })
})

describe('now', () => {
  it('returns a valid ISO 8601 string', () => {
    const result = now()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    expect(() => new Date(result)).not.toThrow()
  })
})

describe('parseDateLocal', () => {
  it('returns a Date with the correct year, month and day in local time', () => {
    const d = parseDateLocal('2026-04-01')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(3) // April = 3 (0-indexed)
    expect(d.getDate()).toBe(1)
  })

  it('ignores any time component after the date part', () => {
    const d = parseDateLocal('2026-11-15T00:00:00.000Z')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(10) // November = 10
    expect(d.getDate()).toBe(15)
  })

  it('parses the last day of the year correctly', () => {
    const d = parseDateLocal('2025-12-31')
    expect(d.getFullYear()).toBe(2025)
    expect(d.getMonth()).toBe(11) // December = 11
    expect(d.getDate()).toBe(31)
  })
})

// ─── Invoice Engine ────────────────────────────────────────────────────────────

describe('getInvoicePeriod', () => {
  it('returns the current month when purchase day is before closing day', () => {
    // closingDay=20, purchase on day 15 → same month invoice
    expect(getInvoicePeriod('2026-04-15', 20)).toEqual({ year: 2026, month: 4 })
  })

  it('returns the current month when purchase day equals closing day', () => {
    // purchase on exactly the closing day belongs to the current month
    expect(getInvoicePeriod('2026-04-20', 20)).toEqual({ year: 2026, month: 4 })
  })

  it('returns the next month when purchase day is after closing day', () => {
    // closingDay=20, purchase on day 21 → next month invoice
    expect(getInvoicePeriod('2026-04-21', 20)).toEqual({ year: 2026, month: 5 })
  })

  it('rolls into January of the next year for December purchases after closing', () => {
    // closingDay=20, purchase on 25 December → January invoice
    expect(getInvoicePeriod('2026-12-25', 20)).toEqual({ year: 2027, month: 1 })
  })

  it('stays in December for purchases on or before closing day in December', () => {
    expect(getInvoicePeriod('2026-12-10', 20)).toEqual({ year: 2026, month: 12 })
  })
})

describe('getInvoiceDueDate', () => {
  it('returns the correct due date in the month following the invoice period', () => {
    // Invoice period April 2026, dueDay=10 → 2026-05-10
    expect(getInvoiceDueDate({ year: 2026, month: 4 }, 10)).toBe('2026-05-10')
  })

  it('rolls into January when invoice period is December', () => {
    // Invoice period December 2026, dueDay=5 → 2027-01-05
    expect(getInvoiceDueDate({ year: 2026, month: 12 }, 5)).toBe('2027-01-05')
  })

  it('clamps dueDay to the last day of the month when dueDay exceeds month length', () => {
    // Invoice period January 2026, dueDay=31 → February has 28 days in 2026 → 2026-02-28
    expect(getInvoiceDueDate({ year: 2026, month: 1 }, 31)).toBe('2026-02-28')
  })

  it('clamps dueDay=31 for a 30-day month', () => {
    // Invoice period March 2026 → due in April (30 days); dueDay=31 → 2026-04-30
    expect(getInvoiceDueDate({ year: 2026, month: 3 }, 31)).toBe('2026-04-30')
  })

  it('handles leap year February correctly (dueDay=29)', () => {
    // Invoice period January 2028 → February 2028 is a leap year (29 days)
    expect(getInvoiceDueDate({ year: 2028, month: 1 }, 29)).toBe('2028-02-29')
  })
})

// ─── helpers for getCurrentInvoiceBalance / getEffectiveCashFlowDate ──────────

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    name: 'Test',
    type: 'CREDIT',
    balance: 0,
    includeInBalance: false,
    creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
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
    date: new Date().toISOString().slice(0, 10), // today's date
    description: 'Test',
    isPaid: false,
    tags: [],
    ...overrides,
  }
}

describe('isCashRealized', () => {
  it('treats a paid INCOME/EXPENSE as realized', () => {
    expect(isCashRealized(makeTx({ type: 'EXPENSE', isPaid: true }))).toBe(true)
    expect(isCashRealized(makeTx({ type: 'INCOME', isPaid: true }))).toBe(true)
  })

  it('treats an unpaid INCOME/EXPENSE as not realized', () => {
    expect(isCashRealized(makeTx({ type: 'EXPENSE', isPaid: false }))).toBe(false)
    expect(isCashRealized(makeTx({ type: 'INCOME', isPaid: false }))).toBe(false)
  })

  it('always treats TRANSFER as realized regardless of isPaid', () => {
    expect(isCashRealized(makeTx({ type: 'TRANSFER', isPaid: false }))).toBe(true)
    expect(isCashRealized(makeTx({ type: 'TRANSFER', isPaid: true }))).toBe(true)
  })

  it('always treats CREDIT_PAYMENT as realized regardless of isPaid', () => {
    expect(isCashRealized(makeTx({ type: 'CREDIT_PAYMENT', isPaid: false }))).toBe(true)
  })
})

describe('getCurrentInvoiceBalance', () => {
  it('returns 0 when account has no creditMetadata', () => {
    const account = makeAccount({ creditMetadata: undefined, type: 'RETAIL' })
    expect(getCurrentInvoiceBalance([makeTx()], account)).toBe(0)
  })

  it('sums EXPENSE transactions in the current invoice period', () => {
    // Use closingDay=28 so that any day 1–28 stays in the current month's invoice
    // period. Using today's date for both the "current period" reference and the
    // transaction date guarantees they land in the same period, regardless of
    // what day the test runs.
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const tx1 = makeTx({ amount: 200, date: todayStr })
    const tx2 = makeTx({ id: 'tx-2', amount: 300, date: todayStr })
    expect(getCurrentInvoiceBalance([tx1, tx2], account)).toBe(500)
  })

  it('subtracts INCOME credits (estornos) from the net total and ignores TRANSFER', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const todayStr = new Date().toISOString().slice(0, 10)
    const charge = makeTx({ amount: 500, date: todayStr })
    const credit = makeTx({ id: 'tx-2', type: 'INCOME', amount: 200, date: todayStr })
    const transfer = makeTx({ id: 'tx-3', type: 'TRANSFER', amount: 999, date: todayStr })
    expect(getCurrentInvoiceBalance([charge, credit, transfer], account)).toBe(300)
  })

  it('ignores transactions from a different account', () => {
    const account = makeAccount()
    const today = new Date()
    const todayStr = today.toISOString().slice(0, 10)
    const tx = makeTx({ accountId: 'other-acc', amount: 999, date: todayStr })
    expect(getCurrentInvoiceBalance([tx], account)).toBe(0)
  })
})

describe('getTotalCreditLiability', () => {
  it('returns 0 when account has no creditMetadata', () => {
    const account = makeAccount({ creditMetadata: undefined, type: 'RETAIL' })
    expect(getTotalCreditLiability([makeTx()], account)).toBe(0)
  })

  it('returns 0 for an account with no transactions', () => {
    expect(getTotalCreditLiability([], makeAccount())).toBe(0)
  })

  it('includes current-period EXPENSE transactions', () => {
    // closingDay=28 ensures today (day 1–28) stays in the current invoice period
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const tx = makeTx({ amount: 500, date: today })
    expect(getTotalCreditLiability([tx], account)).toBe(500)
  })

  it('includes future-period EXPENSE transactions (parcelas futuras)', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } })
    const tx = makeTx({ amount: 300, date: '2099-12-01' })
    expect(getTotalCreditLiability([tx], account)).toBe(300)
  })

  it('includes past unpaid EXPENSE (still owed as outstanding debt)', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } })
    const tx = makeTx({ amount: 400, date: '2020-01-01' })
    expect(getTotalCreditLiability([tx], account)).toBe(400)
  })

  it('subtracts INCOME credits and CREDIT_PAYMENT, ignores TRANSFER', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const charge = makeTx({ amount: 500, date: today })
    const credit = makeTx({ id: 'tx-2', type: 'INCOME', amount: 200, date: today })
    const payment = makeTx({ id: 'tx-3', type: 'CREDIT_PAYMENT', amount: 100, date: today })
    const transfer = makeTx({ id: 'tx-4', type: 'TRANSFER', amount: 999, date: today })
    expect(getTotalCreditLiability([charge, credit, payment, transfer], account)).toBe(200)
  })

  it('ignores transactions from a different account', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const tx = makeTx({ accountId: 'other-acc', amount: 999, date: today })
    expect(getTotalCreditLiability([tx], account)).toBe(0)
  })

  it('sums current and future period expenses together', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const currentTx = makeTx({ amount: 200, date: today })
    const futureTx = makeTx({ id: 'tx-2', amount: 300, date: '2099-12-01' })
    expect(getTotalCreditLiability([currentTx, futureTx], account)).toBe(500)
  })
})

// ─── Option 2: invoice period total / paid / status ──────────────────────────

describe('invoicePeriodKey', () => {
  it('formats a period as zero-padded YYYY-MM', () => {
    expect(invoicePeriodKey({ year: 2026, month: 5 })).toBe('2026-05')
    expect(invoicePeriodKey({ year: 2026, month: 12 })).toBe('2026-12')
  })
})

describe('isCardCredit', () => {
  const credit = makeAccount({ id: 'cc', type: 'CREDIT' })
  const bank = makeAccount({ id: 'bk', type: 'RETAIL', creditMetadata: undefined })
  it('is true for INCOME on a CREDIT account', () => {
    expect(isCardCredit(makeTx({ accountId: 'cc', type: 'INCOME' }), [credit, bank])).toBe(true)
  })
  it('is false for INCOME on a non-CREDIT account', () => {
    expect(isCardCredit(makeTx({ accountId: 'bk', type: 'INCOME' }), [credit, bank])).toBe(false)
  })
  it('is false for EXPENSE on a CREDIT account', () => {
    expect(isCardCredit(makeTx({ accountId: 'cc', type: 'EXPENSE' }), [credit, bank])).toBe(false)
  })
})

describe('getInvoiceTotal', () => {
  const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } })
  const period = { year: 2026, month: 5 }
  it('nets charges minus credits in the period', () => {
    const charge = makeTx({ amount: 500, date: '2026-05-10' })
    const credit = makeTx({ id: 'tx-2', type: 'INCOME', amount: 80, date: '2026-05-12' })
    expect(getInvoiceTotal([charge, credit], account, period)).toBe(420)
  })
  it('ignores other periods and CREDIT_PAYMENT', () => {
    const other = makeTx({ amount: 100, date: '2026-06-10' })
    const payment = makeTx({ id: 'p', type: 'CREDIT_PAYMENT', amount: 999, date: '2026-05-10' })
    expect(getInvoiceTotal([other, payment], account, period)).toBe(0)
  })
})

describe('getInvoicePaid', () => {
  const account = makeAccount({ id: 'cc' })
  const period = { year: 2026, month: 5 }
  it('sums CREDIT_PAYMENT referencing the period', () => {
    const p1 = makeTx({
      id: 'p1',
      accountId: 'cc',
      type: 'CREDIT_PAYMENT',
      amount: 300,
      referenceMonth: '2026-05',
    })
    const p2 = makeTx({
      id: 'p2',
      accountId: 'cc',
      type: 'CREDIT_PAYMENT',
      amount: 100,
      referenceMonth: '2026-05',
    })
    const other = makeTx({
      id: 'p3',
      accountId: 'cc',
      type: 'CREDIT_PAYMENT',
      amount: 50,
      referenceMonth: '2026-04',
    })
    expect(getInvoicePaid([p1, p2, other], account, period)).toBe(400)
  })
})

describe('getInvoiceStatus', () => {
  it('open when nothing charged or paid', () => {
    expect(getInvoiceStatus(0, 0)).toBe('open')
  })
  it('open when charged but unpaid', () => {
    expect(getInvoiceStatus(500, 0)).toBe('open')
  })
  it('partial when paid less than total', () => {
    expect(getInvoiceStatus(500, 200)).toBe('partial')
  })
  it('paid when paid covers the total (within epsilon)', () => {
    expect(getInvoiceStatus(500, 500)).toBe('paid')
    expect(getInvoiceStatus(500, 500.004)).toBe('paid')
  })
})

describe('getCreditOutstanding', () => {
  const account = makeAccount({ id: 'cc' })
  it('is charges minus credits minus payments across all time', () => {
    const charge1 = makeTx({ accountId: 'cc', amount: 500, date: '2020-01-01' })
    const charge2 = makeTx({ id: 't2', accountId: 'cc', amount: 300, date: '2099-01-01' })
    const credit = makeTx({
      id: 't3',
      accountId: 'cc',
      type: 'INCOME',
      amount: 80,
      date: '2026-05-01',
    })
    const payment = makeTx({
      id: 't4',
      accountId: 'cc',
      type: 'CREDIT_PAYMENT',
      amount: 200,
      referenceMonth: '2020-01',
    })
    expect(getCreditOutstanding([charge1, charge2, credit, payment], account)).toBe(520)
  })
})

describe('getEffectiveCashFlowDate', () => {
  it('returns tx.date for a RETAIL account transaction', () => {
    const accounts: Account[] = [
      makeAccount({ id: 'acc-1', type: 'RETAIL', creditMetadata: undefined }),
    ]
    const tx = makeTx({ date: '2026-04-15', accountId: 'acc-1', type: 'EXPENSE' })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-04-15')
  })

  it('returns tx.date for a CREDIT_PAYMENT transaction regardless of account type', () => {
    const accounts: Account[] = [makeAccount({ id: 'acc-1' })]
    const tx = makeTx({ date: '2026-04-15', type: 'CREDIT_PAYMENT' })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-04-15')
  })

  it('returns tx.date for a CREDIT account without creditMetadata', () => {
    const accounts: Account[] = [makeAccount({ id: 'acc-1', creditMetadata: undefined })]
    const tx = makeTx({ date: '2026-04-15', accountId: 'acc-1', type: 'EXPENSE' })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-04-15')
  })

  it('returns the invoice due date for an EXPENSE on a CREDIT account with creditMetadata', () => {
    // closingDay=20, dueDay=10; purchase on 15 April → invoice period April 2026 → due 10 May 2026
    const accounts: Account[] = [
      makeAccount({ id: 'acc-1', creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } }),
    ]
    const tx = makeTx({ date: '2026-04-15', accountId: 'acc-1', type: 'EXPENSE' })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-05-10')
  })

  it('projects to next-month due date when purchase is after closing day', () => {
    // closingDay=20, dueDay=5; purchase on 25 April → invoice period May 2026 → due 5 June 2026
    const accounts: Account[] = [
      makeAccount({ id: 'acc-1', creditMetadata: { limit: 5000, closingDay: 20, dueDay: 5 } }),
    ]
    const tx = makeTx({ date: '2026-04-25', accountId: 'acc-1', type: 'EXPENSE' })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-06-05')
  })
})

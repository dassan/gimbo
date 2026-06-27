import { describe, it, expect } from 'vitest'
import {
  formatCurrency,
  getCurrentInvoiceBalance,
  getOpenCreditBalance,
  getEffectiveCashFlowDate,
  getInvoiceDueDate,
  getInvoicePaid,
  getInvoicePeriod,
  getInvoiceStatus,
  getInvoiceTotal,
  getTxInvoicePeriod,
  getTotalCreditLiability,
  getLoanLiability,
  getTotalCommittedDebt,
  getMonthlyCommitment,
  getDebtHorizon,
  getDebtBreakdown,
  deriveMonthlyIncome,
  invoicePeriodKey,
  filterArchivedAccounts,
  isCardCredit,
  isCashRealized,
  now,
  parseDateLocal,
  projectRecurringOccurrences,
  sortCategoriesHierarchical,
} from '@/lib/utils'
import type { Account, Category, Transaction } from '@/types'

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

  it('rolls to the next month when purchase day equals the closing day (B-18)', () => {
    // The closing day opens the new cycle: a charge dated on the closing day posts to the
    // following invoice (matches real card statements / Organizze). closingDay=20, day 20 → May.
    expect(getInvoicePeriod('2026-04-20', 20)).toEqual({ year: 2026, month: 5 })
  })

  it('stays in the current month for the day just before closing', () => {
    expect(getInvoicePeriod('2026-04-19', 20)).toEqual({ year: 2026, month: 4 })
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
  it('returns the due date in the following month when dueDay <= closingDay', () => {
    // closingDay=20, dueDay=10 → closes the 20th, due the 10th of the next month
    expect(getInvoiceDueDate({ year: 2026, month: 4 }, 10, 20)).toBe('2026-05-10')
  })

  it('returns the due date in the SAME month when dueDay > closingDay (B-19, e.g. Amazon)', () => {
    // closingDay=1, dueDay=7 → closes the 1st, due the 7th of the SAME month
    expect(getInvoiceDueDate({ year: 2026, month: 6 }, 7, 1)).toBe('2026-06-07')
  })

  it('rolls into January when invoice period is December and due is next month', () => {
    expect(getInvoiceDueDate({ year: 2026, month: 12 }, 5, 20)).toBe('2027-01-05')
  })

  it('clamps dueDay to the last day of the month when dueDay exceeds month length', () => {
    // period January, dueDay=31, closingDay=31 → due February (28 days in 2026) → 2026-02-28
    expect(getInvoiceDueDate({ year: 2026, month: 1 }, 31, 31)).toBe('2026-02-28')
  })

  it('clamps dueDay=31 for a 30-day due month', () => {
    expect(getInvoiceDueDate({ year: 2026, month: 3 }, 31, 31)).toBe('2026-04-30')
  })

  it('handles leap year February correctly (dueDay=29)', () => {
    expect(getInvoiceDueDate({ year: 2028, month: 1 }, 29, 30)).toBe('2028-02-29')
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

describe('getTxInvoicePeriod (B-18)', () => {
  it('honours an explicit referenceMonth over the date-derived default', () => {
    // Charge dated 30/05 (which the date rule would push to June) but bound to May's invoice.
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 30, dueDay: 7 } })
    const tx = makeTx({ date: '2026-05-30', referenceMonth: '2026-05' })
    expect(getTxInvoicePeriod(tx, account)).toEqual({ year: 2026, month: 5 })
  })

  it('falls back to the computed period when referenceMonth is absent', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 30, dueDay: 7 } })
    // 30/05 with no override → closingDay 30, day 30 >= 30 rolls to June.
    const tx = makeTx({ date: '2026-05-30' })
    expect(getTxInvoicePeriod(tx, account)).toEqual({ year: 2026, month: 6 })
  })

  it('ignores a malformed referenceMonth and uses the date', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } })
    const tx = makeTx({ date: '2026-04-10', referenceMonth: 'not-a-month' })
    expect(getTxInvoicePeriod(tx, account)).toEqual({ year: 2026, month: 4 })
  })
})

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

  it('excludes future-period EXPENSE (scoped to the current invoice)', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } })
    const tx = makeTx({ amount: 300, date: '2099-12-01' })
    expect(getTotalCreditLiability([tx], account)).toBe(0)
  })

  it('excludes past-period EXPENSE (past invoices assumed settled)', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } })
    const tx = makeTx({ amount: 400, date: '2015-01-01' })
    expect(getTotalCreditLiability([tx], account)).toBe(0)
  })

  it('subtracts INCOME credits and period-referenced CREDIT_PAYMENT, ignores TRANSFER', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const currentKey = invoicePeriodKey(getInvoicePeriod(today, 28))
    const charge = makeTx({ amount: 500, date: today })
    const credit = makeTx({ id: 'tx-2', type: 'INCOME', amount: 200, date: today })
    const payment = makeTx({
      id: 'tx-3',
      type: 'CREDIT_PAYMENT',
      amount: 100,
      referenceMonth: currentKey,
    })
    const transfer = makeTx({ id: 'tx-4', type: 'TRANSFER', amount: 999, date: today })
    expect(getTotalCreditLiability([charge, credit, payment, transfer], account)).toBe(200)
  })

  it('ignores transactions from a different account', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const tx = makeTx({ accountId: 'other-acc', amount: 999, date: today })
    expect(getTotalCreditLiability([tx], account)).toBe(0)
  })

  it('counts only the current period, not future installments', () => {
    const account = makeAccount({ creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 } })
    const today = new Date().toISOString().slice(0, 10)
    const currentTx = makeTx({ amount: 200, date: today })
    const futureTx = makeTx({ id: 'tx-2', amount: 300, date: '2099-12-01' })
    expect(getTotalCreditLiability([currentTx, futureTx], account)).toBe(200)
  })
})

describe('getLoanLiability (HE-07)', () => {
  it('returns the outstandingBalance for a LOAN account', () => {
    const account = makeAccount({
      type: 'LOAN',
      loanMetadata: { outstandingBalance: 15000, monthlyPayment: 800, remainingInstallments: 18 },
    })
    expect(getLoanLiability(account)).toBe(15000)
  })

  it('returns 0 when the account has no loanMetadata', () => {
    const account = makeAccount({ type: 'LOAN', loanMetadata: undefined })
    expect(getLoanLiability(account)).toBe(0)
  })

  it('returns 0 for a non-LOAN account', () => {
    expect(getLoanLiability(makeAccount({ type: 'RETAIL' }))).toBe(0)
  })
})

// ─── Financial Health — Debt Engine (HE-08) ──────────────────────────────────

/** Adds `n` months to a "YYYY-MM-DD" date string, returning a new "YYYY-MM-DD" string. */
function addMonths(dateStr: string, n: number): string {
  const d = parseDateLocal(dateStr)
  d.setMonth(d.getMonth() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Builds the N materialized installment transactions for a single purchase (mirrors the
 * CC-24/CC-25 expansion in useDataStore: one tx per month, sharing a parentId). */
function makeInstallmentGroup(
  accountId: string,
  parentId: string,
  total: number,
  monthly: number,
  firstDate: string,
  currentIndex = 1
): Transaction[] {
  return Array.from({ length: total - currentIndex + 1 }, (_, i) =>
    makeTx({
      id: `${parentId}-${currentIndex + i}`,
      accountId,
      amount: monthly,
      date: addMonths(firstDate, i),
      installment: { parentId, currentIndex: currentIndex + i, total },
    })
  )
}

describe('getTotalCommittedDebt / getMonthlyCommitment / getDebtHorizon (HE-08)', () => {
  it('returns 0 for accounts with no debt', () => {
    const accounts = [makeAccount({ type: 'RETAIL', creditMetadata: undefined })]
    expect(getTotalCommittedDebt([], accounts)).toBe(0)
    expect(getMonthlyCommitment([], accounts)).toBe(0)
    expect(getDebtHorizon([], accounts)).toBe(0)
  })

  it('ignores non-installment EXPENSE transactions on a CREDIT account', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const tx = makeTx({ accountId: 'acc-credit', amount: 500 })
    expect(getTotalCommittedDebt([tx], [account])).toBe(0)
    expect(getMonthlyCommitment([tx], [account])).toBe(0)
  })

  it('sums remaining occurrences of an open CREDIT installment group', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const today = new Date().toISOString().slice(0, 10)
    // 10x of 100, currently on installment 4 (today) — 7 remain (4..10).
    const group = makeInstallmentGroup('acc-credit', 'p1', 10, 100, today, 4)
    expect(getTotalCommittedDebt(group, [account])).toBe(700)
    expect(getMonthlyCommitment(group, [account])).toBe(100)
    expect(getDebtHorizon(group, [account])).toBe(7)
  })

  it('excludes past (already-settled) installment occurrences', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const pastTx = makeTx({
      id: 'p2-1',
      accountId: 'acc-credit',
      amount: 100,
      date: '2015-01-01',
      installment: { parentId: 'p2', currentIndex: 1, total: 3 },
    })
    expect(getTotalCommittedDebt([pastTx], [account])).toBe(0)
  })

  it('reconciles the total with the sum of individual open installment groups', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const today = new Date().toISOString().slice(0, 10)
    const groupA = makeInstallmentGroup('acc-credit', 'pA', 6, 200, today, 2) // 5 remain × 200 = 1000
    const groupB = makeInstallmentGroup('acc-credit', 'pB', 4, 150, today, 1) // 4 remain × 150 = 600
    const all = [...groupA, ...groupB]
    expect(getTotalCommittedDebt(all, [account])).toBe(1000 + 600)
  })

  it('mixes CREDIT installments and a LOAN balance', () => {
    const cardAccount = makeAccount({ id: 'acc-credit' })
    const loanAccount = makeAccount({
      id: 'acc-loan',
      type: 'LOAN',
      creditMetadata: undefined,
      loanMetadata: { outstandingBalance: 15000, monthlyPayment: 800, remainingInstallments: 18 },
    })
    const today = new Date().toISOString().slice(0, 10)
    const cardGroup = makeInstallmentGroup('acc-credit', 'p3', 5, 300, today, 1) // 5 remain × 300 = 1500

    expect(getTotalCommittedDebt(cardGroup, [cardAccount, loanAccount])).toBe(1500 + 15000)
    expect(getMonthlyCommitment(cardGroup, [cardAccount, loanAccount])).toBe(300 + 800)
    expect(getDebtHorizon(cardGroup, [cardAccount, loanAccount])).toBe(18)
  })

  it('counts an installment series booked on a regular (non-CREDIT) account', () => {
    // e.g. "Refinanciamento Itaú" — a financing logged parcela by parcela on a
    // checking account, not a card and not a LOAN entity. It must count as debt.
    const checking = makeAccount({ id: 'acc-retail', type: 'RETAIL', creditMetadata: undefined })
    const today = new Date().toISOString().slice(0, 10)
    const group = makeInstallmentGroup('acc-retail', 'fin', 84, 500, today, 70) // 15 remain × 500 = 7500
    expect(getTotalCommittedDebt(group, [checking])).toBe(7500)
    expect(getMonthlyCommitment(group, [checking])).toBe(500)
    expect(getDebtHorizon(group, [checking])).toBe(15)
  })
})

describe('getDebtBreakdown (HE-10)', () => {
  it('returns an empty list when there is no open debt', () => {
    const account = makeAccount({ type: 'RETAIL', creditMetadata: undefined })
    expect(getDebtBreakdown([], [account])).toEqual([])
  })

  it('builds an installment item from an open CREDIT group, with the suffix stripped', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const today = new Date().toISOString().slice(0, 10)
    const group = makeInstallmentGroup('acc-credit', 'p1', 10, 100, today, 4)
    group.forEach((tx) => {
      tx.description = `Notebook Dell (${tx.installment!.currentIndex}/10)`
    })

    const [debtGroup] = getDebtBreakdown(group, [account])
    expect(debtGroup.kind).toBe('card')
    expect(debtGroup.accountId).toBe('acc-credit')
    expect(debtGroup.items).toHaveLength(1)
    const [item] = debtGroup.items
    expect(item).toEqual({
      kind: 'installment',
      description: 'Notebook Dell',
      current: 4,
      total: 10,
      remaining: 7,
      monthly: 100,
      remainingTotal: 700,
    })
  })

  it('builds a loan item from loanMetadata', () => {
    const loanAccount = makeAccount({
      id: 'acc-loan',
      name: 'Empréstimo Pessoal',
      type: 'LOAN',
      creditMetadata: undefined,
      loanMetadata: { outstandingBalance: 15000, monthlyPayment: 800, remainingInstallments: 18 },
    })

    const [debtGroup] = getDebtBreakdown([], [loanAccount])
    expect(debtGroup.kind).toBe('loan')
    expect(debtGroup.items).toEqual([
      {
        kind: 'loan',
        description: 'Empréstimo Pessoal',
        remaining: 18,
        monthly: 800,
        remainingTotal: 15000,
        interestRate: undefined,
      },
    ])
  })

  it('reconciles each group total with the sum of its own items', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const today = new Date().toISOString().slice(0, 10)
    const groupA = makeInstallmentGroup('acc-credit', 'pA', 6, 200, today, 2) // 5 remain × 200 = 1000
    const groupB = makeInstallmentGroup('acc-credit', 'pB', 4, 150, today, 1) // 4 remain × 150 = 600

    const [debtGroup] = getDebtBreakdown([...groupA, ...groupB], [account])
    expect(debtGroup.items).toHaveLength(2)
    expect(debtGroup.remainingTotal).toBe(debtGroup.items.reduce((s, i) => s + i.remainingTotal, 0))
    expect(debtGroup.monthly).toBe(debtGroup.items.reduce((s, i) => s + i.monthly, 0))
    expect(debtGroup.remainingTotal).toBe(1000 + 600)
  })

  it('excludes a CREDIT account with no open installments from the result', () => {
    const account = makeAccount({ id: 'acc-credit' })
    const pastTx = makeTx({
      accountId: 'acc-credit',
      date: '2015-01-01',
      installment: { parentId: 'old', currentIndex: 1, total: 3 },
    })
    expect(getDebtBreakdown([pastTx], [account])).toEqual([])
  })

  it("tags a regular-account installment series as kind 'installments', not 'card'", () => {
    const checking = makeAccount({ id: 'acc-retail', type: 'RETAIL', creditMetadata: undefined })
    const today = new Date().toISOString().slice(0, 10)
    const group = makeInstallmentGroup('acc-retail', 'fin', 84, 500, today, 70)
    group.forEach((tx) => {
      tx.description = `Refinanciamento Itaú (${tx.installment!.currentIndex}/84)`
    })

    const [debtGroup] = getDebtBreakdown(group, [checking])
    expect(debtGroup.kind).toBe('installments')
    expect(debtGroup.accountId).toBe('acc-retail')
    expect(debtGroup.items).toHaveLength(1)
    expect(debtGroup.items[0]).toMatchObject({
      kind: 'installment',
      description: 'Refinanciamento Itaú',
      remaining: 15,
      monthly: 500,
      remainingTotal: 7500,
    })
  })
})

// ─── Financial Health — Income Engine (HE-09) ────────────────────────────────

describe('deriveMonthlyIncome (HE-09)', () => {
  const retail = makeAccount({ id: 'acc-retail', type: 'RETAIL', creditMetadata: undefined })
  const credit = makeAccount({ id: 'acc-credit', type: 'CREDIT' })
  const today = new Date().toISOString().slice(0, 10)

  it('returns null with 0 confidence when there is no qualified income', () => {
    const result = deriveMonthlyIncome([], [retail])
    expect(result).toEqual({ value: null, confidenceMonths: 0, isEstimate: false })
  })

  it('excludes INCOME on a CREDIT account (B-16 estornos) from qualified income', () => {
    const estorno = makeTx({
      accountId: 'acc-credit',
      type: 'INCOME',
      amount: 9999,
      date: addMonths(today, -1),
    })
    expect(deriveMonthlyIncome([estorno], [retail, credit]).value).toBeNull()
  })

  it('excludes the current (incomplete) month from the window', () => {
    const currentMonthIncome = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 5000,
      date: today,
    })
    expect(deriveMonthlyIncome([currentMonthIncome], [retail]).value).toBeNull()
  })

  it('uses the single available month as an estimate when there is only 1 month of data', () => {
    const tx = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 3000,
      date: addMonths(today, -1),
    })
    const result = deriveMonthlyIncome([tx], [retail])
    expect(result).toEqual({ value: 3000, confidenceMonths: 1, isEstimate: true })
  })

  it('averages 2 available months and labels it as an estimate', () => {
    const txA = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 3000,
      date: addMonths(today, -1),
    })
    const txB = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 5000,
      date: addMonths(today, -2),
    })
    const result = deriveMonthlyIncome([txA, txB], [retail])
    expect(result).toEqual({ value: 4000, confidenceMonths: 2, isEstimate: true })
  })

  it('uses the median (not the average) once the 3-month floor is met', () => {
    const transactions = [1000, 2000, 9000].map((amount, i) =>
      makeTx({
        accountId: 'acc-retail',
        type: 'INCOME',
        amount,
        date: addMonths(today, -(i + 1)),
      })
    )
    const result = deriveMonthlyIncome(transactions, [retail])
    expect(result).toEqual({ value: 2000, confidenceMonths: 3, isEstimate: false })
  })

  it('sums multiple qualified transactions within the same month', () => {
    const a = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 1000,
      date: addMonths(today, -1),
    })
    const b = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 500,
      date: addMonths(today, -1),
    })
    const result = deriveMonthlyIncome([a, b], [retail])
    expect(result).toEqual({ value: 1500, confidenceMonths: 1, isEstimate: true })
  })

  it('caps the lookback window at 6 complete months by default, ignoring older data', () => {
    const tooOld = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 99999,
      date: addMonths(today, -7),
    })
    const result = deriveMonthlyIncome([tooOld], [retail])
    expect(result).toEqual({ value: null, confidenceMonths: 0, isEstimate: false })
  })

  // ─── HE-09 follow-up: configurable lookback window (workspace.incomeWindowMonths) ──

  it('with windowMonths=3, ignores data from the 4th month back (outside the shorter window)', () => {
    const withinWindow = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 4000,
      date: addMonths(today, -2),
    })
    const outsideWindow = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 99999,
      date: addMonths(today, -4),
    })
    const result = deriveMonthlyIncome([withinWindow, outsideWindow], [retail], 3)
    expect(result).toEqual({ value: 4000, confidenceMonths: 1, isEstimate: true })
  })

  it('with windowMonths=3, the 3-month median floor still applies (uses all 3 months found)', () => {
    const transactions = [1000, 2000, 9000].map((amount, i) =>
      makeTx({
        accountId: 'acc-retail',
        type: 'INCOME',
        amount,
        date: addMonths(today, -(i + 1)),
      })
    )
    const result = deriveMonthlyIncome(transactions, [retail], 3)
    expect(result).toEqual({ value: 2000, confidenceMonths: 3, isEstimate: false })
  })

  it('with windowMonths=9, includes data from the 7th month back (excluded by the default 6-month window)', () => {
    const tx = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 5000,
      date: addMonths(today, -7),
    })
    expect(deriveMonthlyIncome([tx], [retail]).value).toBeNull()
    const result = deriveMonthlyIncome([tx], [retail], 9)
    expect(result).toEqual({ value: 5000, confidenceMonths: 1, isEstimate: true })
  })

  it('with windowMonths=12, includes data from the 11th month back but still ignores the 13th', () => {
    const withinWindow = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 6000,
      date: addMonths(today, -11),
    })
    const outsideWindow = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 99999,
      date: addMonths(today, -13),
    })
    const result = deriveMonthlyIncome([withinWindow, outsideWindow], [retail], 12)
    expect(result).toEqual({ value: 6000, confidenceMonths: 1, isEstimate: true })
  })

  it('ignores EXPENSE and TRANSFER transactions', () => {
    const expense = makeTx({
      accountId: 'acc-retail',
      type: 'EXPENSE',
      amount: 1000,
      date: addMonths(today, -1),
    })
    const transfer = makeTx({
      accountId: 'acc-retail',
      type: 'TRANSFER',
      amount: 1000,
      date: addMonths(today, -1),
      transferAccountId: 'acc-other',
    })
    expect(deriveMonthlyIncome([expense, transfer], [retail]).value).toBeNull()
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
  it('counts a charge by its referenceMonth, not its date (B-18)', () => {
    // Dated in June (would be June's invoice by the date rule) but bound to May's invoice.
    const moved = makeTx({ amount: 200, date: '2026-06-10', referenceMonth: '2026-05' })
    expect(getInvoiceTotal([moved], account, period)).toBe(200)
    // And it must NOT also count under June.
    expect(getInvoiceTotal([moved], account, { year: 2026, month: 6 })).toBe(0)
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

describe('getOpenCreditBalance', () => {
  const account = makeAccount({
    id: 'cc',
    creditMetadata: { limit: 5000, closingDay: 28, dueDay: 10 },
  })
  const today = new Date().toISOString().slice(0, 10)
  const currentKey = invoicePeriodKey(getInvoicePeriod(today, 28))
  it('is the current invoice remaining: current charges − credits − current payments', () => {
    const past = makeTx({ id: 'a', accountId: 'cc', amount: 999, date: '2015-01-01' })
    const current = makeTx({ id: 'b', accountId: 'cc', amount: 500, date: today })
    const future = makeTx({ id: 'c', accountId: 'cc', amount: 300, date: '2099-12-01' })
    const credit = makeTx({ id: 'd', accountId: 'cc', type: 'INCOME', amount: 80, date: today })
    const payCurrent = makeTx({
      id: 'e',
      accountId: 'cc',
      type: 'CREDIT_PAYMENT',
      amount: 100,
      referenceMonth: currentKey,
    })
    const payPast = makeTx({
      id: 'f',
      accountId: 'cc',
      type: 'CREDIT_PAYMENT',
      amount: 999,
      referenceMonth: '2015-01',
    })
    // 500 current − 80 credit − 100 current payment = 320 (past, future and past-payment ignored)
    expect(
      getOpenCreditBalance([past, current, future, credit, payCurrent, payPast], account)
    ).toBe(320)
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

  it('keeps the due date in the same month when dueDay > closingDay (B-19, Amazon)', () => {
    // closingDay=1, dueDay=7; purchase 15 May → invoice closes 1 Jun → due 7 Jun (same month)
    const accounts: Account[] = [
      makeAccount({ id: 'acc-1', creditMetadata: { limit: 5000, closingDay: 1, dueDay: 7 } }),
    ]
    const tx = makeTx({ date: '2026-05-15', accountId: 'acc-1', type: 'EXPENSE' })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-06-07')
  })

  it('uses the stored invoiceDueDate verbatim, overriding the computed due date (CC-33)', () => {
    // The computed path would give 2026-05-10; the authoritative stored due date wins.
    const accounts: Account[] = [
      makeAccount({ id: 'acc-1', creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 } }),
    ]
    const tx = makeTx({
      date: '2026-04-15',
      accountId: 'acc-1',
      type: 'EXPENSE',
      invoiceDueDate: '2026-04-26',
    })
    expect(getEffectiveCashFlowDate(tx, accounts)).toBe('2026-04-26')
  })

  it('stays anchored to invoiceDueDate even after the card closing/due day changes (CC-33)', () => {
    // A past invoice fell due 2025-12-07. The user later changes the card to closingDay=26/dueDay=10;
    // the computed path would now re-date it to 2026-01-10, but the stored due date keeps it put.
    const tx = makeTx({
      date: '2025-12-01',
      accountId: 'acc-1',
      type: 'EXPENSE',
      invoiceDueDate: '2025-12-07',
    })
    const before: Account[] = [
      makeAccount({ id: 'acc-1', creditMetadata: { limit: 5000, closingDay: 1, dueDay: 7 } }),
    ]
    const after: Account[] = [
      makeAccount({ id: 'acc-1', creditMetadata: { limit: 5000, closingDay: 26, dueDay: 10 } }),
    ]
    expect(getEffectiveCashFlowDate(tx, before)).toBe('2025-12-07')
    expect(getEffectiveCashFlowDate(tx, after)).toBe('2025-12-07')
  })
})

describe('sortCategoriesHierarchical (M-46)', () => {
  function makeCategory(overrides: Partial<Category> = {}): Category {
    return {
      id: 'cat-1',
      parentId: null,
      name: 'Cat',
      icon: 'circle',
      color: '#808080',
      type: 'EXPENSE',
      ...overrides,
    }
  }

  it('orders root categories alphabetically, with each one followed by its children (also alphabetical)', () => {
    const categories: Category[] = [
      makeCategory({ id: 'root-aluguel', name: 'Aluguel', parentId: null }),
      makeCategory({ id: 'root-alimentacao', name: 'Alimentação', parentId: null }),
      makeCategory({
        id: 'child-meninas',
        name: 'Alimentação Meninas',
        parentId: 'root-alimentacao',
      }),
      makeCategory({
        id: 'child-supermercado',
        name: 'Supermercado',
        parentId: 'root-alimentacao',
      }),
    ]

    const sorted = sortCategoriesHierarchical(categories)

    expect(sorted.map((c) => c.id)).toEqual([
      'root-alimentacao',
      'child-meninas',
      'child-supermercado',
      'root-aluguel',
    ])
  })
})

describe('filterArchivedAccounts (M-42)', () => {
  function makeAcc(overrides: Partial<Account> = {}): Account {
    return {
      id: 'acc-1',
      name: 'Conta',
      type: 'RETAIL',
      balance: 0,
      includeInBalance: true,
      ...overrides,
    }
  }

  it('hides archived accounts by default', () => {
    const accounts = [
      makeAcc({ id: 'active', archived: false }),
      makeAcc({ id: 'old', name: 'Conta antiga', archived: true }),
    ]
    expect(filterArchivedAccounts(accounts).map((a) => a.id)).toEqual(['active'])
  })

  it('keeps an archived account if its id matches keepId', () => {
    const accounts = [
      makeAcc({ id: 'active', archived: false }),
      makeAcc({ id: 'old', name: 'Conta antiga', archived: true }),
    ]
    expect(filterArchivedAccounts(accounts, 'old').map((a) => a.id)).toEqual(['active', 'old'])
  })

  it('returns all accounts when none are archived', () => {
    const accounts = [makeAcc({ id: 'a' }), makeAcc({ id: 'b' })]
    expect(filterArchivedAccounts(accounts)).toHaveLength(2)
  })
})

describe('projectRecurringOccurrences (M-62)', () => {
  function makeRecurringTx(overrides: Partial<Transaction> = {}): Transaction {
    return makeTx({
      id: 'rec-parent',
      type: 'INCOME',
      amount: 1000,
      date: '2028-01-10',
      isPaid: true,
      recurrence: { frequency: 'monthly', parentId: 'rec-parent' },
      ...overrides,
    })
  }

  it('projects monthly occurrences beyond the last materialized one, up to the horizon', () => {
    const projected = projectRecurringOccurrences([makeRecurringTx()], '2028-04-10')
    expect(projected.map((t) => t.date)).toEqual(['2028-02-10', '2028-03-10', '2028-04-10'])
    expect(projected.every((t) => t.isProjected === true)).toBe(true)
    expect(projected.every((t) => t.isPaid === false)).toBe(true)
  })

  it('never projects past an explicit endDate, even if the horizon is further out', () => {
    const bounded = makeTx({
      id: 'rec-bounded',
      type: 'EXPENSE',
      date: '2028-01-01',
      recurrence: { frequency: 'weekly', parentId: 'rec-bounded', endDate: '2028-01-15' },
    })
    const projected = projectRecurringOccurrences([bounded], '2028-06-01')
    expect(projected).toEqual([])
  })

  it('returns nothing when the last materialized occurrence already covers the horizon', () => {
    const projected = projectRecurringOccurrences([makeRecurringTx()], '2028-01-05')
    expect(projected).toEqual([])
  })

  it('does not mutate the input transactions array', () => {
    const real = [makeRecurringTx()]
    const snapshot = JSON.stringify(real)
    projectRecurringOccurrences(real, '2029-01-10')
    expect(JSON.stringify(real)).toBe(snapshot)
  })

  it('uses the latest occurrence of a multi-row series as the template, not the first', () => {
    const tx1 = makeRecurringTx({ id: 'rec-parent', date: '2028-01-10' })
    const tx2 = makeRecurringTx({ id: 'tx-2', date: '2028-02-10', isPaid: false, amount: 2000 })
    const projected = projectRecurringOccurrences([tx1, tx2], '2028-03-10')
    expect(projected).toHaveLength(1)
    expect(projected[0].date).toBe('2028-03-10')
    expect(projected[0].amount).toBe(2000) // templated off tx2 (the later occurrence)
  })

  it('ignores transactions without a recurrence', () => {
    const projected = projectRecurringOccurrences([makeTx({ recurrence: undefined })], '2030-01-01')
    expect(projected).toEqual([])
  })
})

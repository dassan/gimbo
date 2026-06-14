import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import CashFlowView from '@/pages/Analytics/CashFlowView'
import type { Account, Transaction } from '@/types'

// ─── Recharts mock — captures ComposedChart rows for assertions ───────────────

const capturedRows = vi.hoisted(() => ({
  data: [] as Array<{
    label: string
    fullLabel: string
    income: number
    expenses: number
    result: number
    balance: number
  }>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({
    children,
    data,
  }: {
    children: React.ReactNode
    data: Array<{
      label: string
      fullLabel: string
      income: number
      expenses: number
      result: number
      balance: number
    }>
  }) => {
    capturedRows.data = data ?? []
    return <div data-testid="cashflow-chart">{children}</div>
  },
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRetailAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-retail',
    name: 'Conta Corrente',
    type: 'RETAIL',
    balance: 0,
    includeInBalance: true,
    ...overrides,
  }
}

function makeCreditAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-credit',
    name: 'Cartão Teste',
    type: 'CREDIT',
    balance: 0,
    includeInBalance: false,
    creditMetadata: { limit: 5000, closingDay: 5, dueDay: 10 },
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-retail',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-04-15',
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

/** April 2026 period — matches the fixed system time used in other tests. */
const APR_START = new Date(2026, 3, 1)
const APR_END = new Date(2026, 3, 30)

/** Two-month period: April + May 2026 */
const APR_MAY_START = new Date(2026, 3, 1)
const APR_MAY_END = new Date(2026, 4, 31)

/** Multi-year period: January 2026 to March 2027 (15 months, same months repeat across years) */
const MULTI_YEAR_START = new Date(2026, 0, 1)
const MULTI_YEAR_END = new Date(2027, 2, 31)

const SHADOW = 'shadow-card'

beforeEach(() => {
  capturedRows.data = []
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-15'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── R-15: Monthly aggregation ────────────────────────────────────────────────

describe('CashFlowView — R-15: monthly aggregation', () => {
  it('aggregates INCOME and EXPENSE correctly for a single month', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-income', type: 'INCOME', amount: 500, date: '2026-04-01' }),
      makeTx({ id: 'tx-expense', type: 'EXPENSE', amount: 200, date: '2026-04-15' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // M-38: a single full month is split into weekly buckets, so the income (Apr 1) and
    // expense (Apr 15) land in different buckets — the month total is the sum across buckets.
    const totalIncome = capturedRows.data.reduce((s, r) => s + r.income, 0)
    const totalExpenses = capturedRows.data.reduce((s, r) => s + r.expenses, 0)
    expect(totalIncome).toBe(500)
    expect(totalExpenses).toBe(200)
  })

  it('separates transactions into the correct month bucket', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-apr', type: 'INCOME', amount: 400, date: '2026-04-10' }),
      makeTx({ id: 'tx-may', type: 'INCOME', amount: 600, date: '2026-05-10' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_MAY_START}
        endDate={APR_MAY_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // April bucket (index 0): 400; May bucket (index 1): 600
    expect(capturedRows.data[0]?.income).toBe(400)
    expect(capturedRows.data[1]?.income).toBe(600)
  })

  it('shows the "no data" message when there are no transactions in range', () => {
    render(
      <CashFlowView
        transactions={[]}
        accounts={[]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.getByText('common.noData')).toBeInTheDocument()
    expect(screen.queryByTestId('cashflow-chart')).not.toBeInTheDocument()
  })
})

// ─── R-15: Accumulated balance ────────────────────────────────────────────────

describe('CashFlowView — R-15: accumulated balance', () => {
  it('carries accumulated balance across months', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      // April: income 1000, expense 600 → result +400
      makeTx({ id: 'tx-apr-income', type: 'INCOME', amount: 1000, date: '2026-04-01' }),
      makeTx({ id: 'tx-apr-expense', type: 'EXPENSE', amount: 600, date: '2026-04-15' }),
      // May: income 200, expense 500 → result -300 → cumulative: +400 - 300 = +100
      makeTx({ id: 'tx-may-income', type: 'INCOME', amount: 200, date: '2026-05-01' }),
      makeTx({ id: 'tx-may-expense', type: 'EXPENSE', amount: 500, date: '2026-05-15' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_MAY_START}
        endDate={APR_MAY_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    const aprRow = capturedRows.data[0]
    const mayRow = capturedRows.data[1]

    expect(aprRow?.result).toBe(400)
    expect(aprRow?.balance).toBe(400)

    expect(mayRow?.result).toBe(-300)
    expect(mayRow?.balance).toBe(100) // 400 + (-300)
  })

  it('handles a negative accumulated balance', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-expense', type: 'EXPENSE', amount: 800, date: '2026-04-01' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(capturedRows.data[0]?.balance).toBe(-800)
  })
})

// ─── R-15: CREDIT_PAYMENT excluded ───────────────────────────────────────────

describe('CashFlowView — R-15: CREDIT_PAYMENT exclusion', () => {
  it('does not count CREDIT_PAYMENT as income', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-cp', type: 'CREDIT_PAYMENT', amount: 500, date: '2026-04-10' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // All values are zero → "no data" message shown
    expect(screen.getByText('common.noData')).toBeInTheDocument()
  })

  it('does not count CREDIT_PAYMENT as expense when mixed with real income', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-income', type: 'INCOME', amount: 300, date: '2026-04-01' }),
      makeTx({ id: 'tx-cp', type: 'CREDIT_PAYMENT', amount: 200, date: '2026-04-10' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    const row = capturedRows.data[0]
    // Only income 300 counted; CREDIT_PAYMENT not included
    expect(row?.income).toBe(300)
    expect(row?.expenses).toBe(0)
  })
})

// ─── R-15: includeUnpaid filter ───────────────────────────────────────────────

describe('CashFlowView — R-15: includeUnpaid filter', () => {
  it('includes unpaid transactions when includeUnpaid=true', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-unpaid', type: 'EXPENSE', amount: 150, isPaid: false, date: '2026-04-01' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(capturedRows.data[0]?.expenses).toBe(150)
  })

  it('excludes unpaid transactions when includeUnpaid=false', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-paid', type: 'EXPENSE', amount: 100, isPaid: true, date: '2026-04-01' }),
      makeTx({ id: 'tx-unpaid', type: 'EXPENSE', amount: 150, isPaid: false, date: '2026-04-05' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={false}
        shadowClass={SHADOW}
      />
    )
    // Only the paid transaction counts
    expect(capturedRows.data[0]?.expenses).toBe(100)
  })

  it('shows no data when all transactions are unpaid and includeUnpaid=false', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-unpaid', type: 'EXPENSE', amount: 999, isPaid: false, date: '2026-04-01' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={false}
        shadowClass={SHADOW}
      />
    )
    expect(screen.getByText('common.noData')).toBeInTheDocument()
  })
})

// ─── R-15: accountId drill-down filter ───────────────────────────────────────

describe('CashFlowView — R-15: accountId filter', () => {
  it('shows only transactions for the given accountId when prop is set', () => {
    const accounts = [
      makeRetailAccount({ id: 'acc-a', name: 'Conta A' }),
      makeRetailAccount({ id: 'acc-b', name: 'Conta B' }),
    ]
    const transactions = [
      makeTx({ id: 'tx-a', accountId: 'acc-a', type: 'INCOME', amount: 400, date: '2026-04-01' }),
      makeTx({
        id: 'tx-b',
        accountId: 'acc-b',
        type: 'INCOME',
        amount: 1000,
        date: '2026-04-01',
      }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
        accountId="acc-a"
      />
    )
    // Only acc-a income (400) should be aggregated
    expect(capturedRows.data[0]?.income).toBe(400)
  })

  it('shows all accounts when accountId is undefined', () => {
    const accounts = [makeRetailAccount({ id: 'acc-a' }), makeRetailAccount({ id: 'acc-b' })]
    const transactions = [
      makeTx({ id: 'tx-a', accountId: 'acc-a', type: 'INCOME', amount: 400, date: '2026-04-01' }),
      makeTx({ id: 'tx-b', accountId: 'acc-b', type: 'INCOME', amount: 600, date: '2026-04-01' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Both accounts included → 400 + 600 = 1000
    expect(capturedRows.data[0]?.income).toBe(1000)
  })

  it('uses getEffectiveCashFlowDate — credit expense projected to due-date month', () => {
    // Credit account: closingDay=5, dueDay=10
    // EXPENSE on 2026-04-06 → day > closingDay → invoice period = May → due = June 10
    // Viewing April period → the credit expense is outside the range
    const creditAccount = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 5, dueDay: 10 },
    })
    const retailAccount = makeRetailAccount({ id: 'acc-retail' })
    const transactions = [
      makeTx({
        id: 'tx-retail-income',
        accountId: 'acc-retail',
        type: 'INCOME',
        amount: 500,
        date: '2026-04-01',
      }),
      makeTx({
        id: 'tx-credit-expense',
        accountId: 'acc-credit',
        type: 'EXPENSE',
        amount: 300,
        date: '2026-04-06',
      }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={[retailAccount, creditAccount]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // April: retail income 500; credit expense displaced to June → expenses = 0
    expect(capturedRows.data[0]?.income).toBe(500)
    expect(capturedRows.data[0]?.expenses).toBe(0)
  })
})

// ─── M-38: weekly granularity for a single month ──────────────────────────────

describe('CashFlowView — M-38: weekly granularity', () => {
  it('splits a single full month into weekly buckets and places txs in the right week', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-wk1', type: 'INCOME', amount: 100, date: '2026-04-03' }), // 1–7
      makeTx({ id: 'tx-wk3', type: 'INCOME', amount: 200, date: '2026-04-17' }), // 15–21
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // April (30 days) → 5 weekly buckets: 1–7, 8–14, 15–21, 22–28, 29–30
    expect(capturedRows.data).toHaveLength(5)
    expect(capturedRows.data[0]?.label).toBe('1–7')
    expect(capturedRows.data[0]?.income).toBe(100)
    expect(capturedRows.data[2]?.income).toBe(200)
    // Accumulated balance carries across weeks: 100 then 100 + 200 = 300
    expect(capturedRows.data[2]?.balance).toBe(300)
  })

  it('keeps one bucket per month when the period spans more than one month', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-apr', type: 'INCOME', amount: 400, date: '2026-04-10' }),
      makeTx({ id: 'tx-may', type: 'INCOME', amount: 600, date: '2026-05-10' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_MAY_START}
        endDate={APR_MAY_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(capturedRows.data).toHaveLength(2)
  })
})

// ─── M-53: unique x-axis keys across years (tooltip indexing) ─────────────────

describe('CashFlowView — M-53: multi-year period bucket labels', () => {
  it('gives every bucket a unique fullLabel even when the short label (month) repeats across years', () => {
    const accounts = [makeRetailAccount()]
    const transactions = [
      makeTx({ id: 'tx-jan-2026', type: 'INCOME', amount: 100, date: '2026-01-10' }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={accounts}
        startDate={MULTI_YEAR_START}
        endDate={MULTI_YEAR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // 15 months (Jan/2026 .. Mar/2027) — "JAN"/"FEV"/"MAR" repeat, but fullLabel must not.
    expect(capturedRows.data).toHaveLength(15)
    const shortLabels = capturedRows.data.map((r) => r.label)
    const fullLabels = capturedRows.data.map((r) => r.fullLabel)
    expect(shortLabels.filter((l) => l === 'JAN')).toHaveLength(2)
    expect(new Set(fullLabels).size).toBe(fullLabels.length)
  })
})

// ─── Opening balance anchor (M-40): cumulative starts from the real opening ───

describe('CashFlowView — opening balance anchor', () => {
  it('starts the running balance from the cash accounts opening balance, not zero', () => {
    const account = makeRetailAccount({ balance: 1000 })
    const transactions = [
      // Realized pre-period income → part of the opening balance (date < April 1)
      makeTx({ id: 'tx-prior', type: 'INCOME', amount: 500, date: '2026-03-15', isPaid: true }),
      // In-period income → flows through the April result
      makeTx({ id: 'tx-apr', type: 'INCOME', amount: 300, date: '2026-04-10', isPaid: true }),
    ]
    render(
      <CashFlowView
        transactions={transactions}
        accounts={[account]}
        startDate={APR_MAY_START}
        endDate={APR_MAY_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Two-month period → monthly buckets. opening = 1000 initial + 500 prior realized;
    // April result = 300 → April balance = 1800.
    expect(capturedRows.data[0]?.result).toBe(300)
    expect(capturedRows.data[0]?.balance).toBe(1800)
  })
})

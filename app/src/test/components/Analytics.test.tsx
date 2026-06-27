import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Analytics from '@/pages/Analytics'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import type { Account, Category, Transaction } from '@/types'

// ─── Recharts mock — captures ComposedChart data for assertions ───────────────

const capturedChartProps = vi.hoisted(() => ({
  data: [] as Array<{
    label: string
    fullLabel: string
    income: number
    expenses: number
    result: number
    balance: number
    isProjected: boolean
  }>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
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
      isProjected: boolean
    }>
  }) => {
    capturedChartProps.data = data ?? []
    return <div data-testid="cashflow-chart">{children}</div>
  },
  Bar: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
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
    name: 'Nexus Visa Gold',
    type: 'CREDIT',
    balance: 0,
    includeInBalance: false,
    creditMetadata: { limit: 12000, closingDay: 5, dueDay: 10 },
    ...overrides,
  }
}

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-retail',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-04-01',
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    name: 'Outros',
    parentId: null,
    icon: 'Tag',
    color: '#888',
    type: 'EXPENSE',
    ...overrides,
  }
}

/** Click the "cashflow" tab so the ComposedChart is rendered */
function switchToCashFlowTab() {
  fireEvent.click(screen.getByText('analytics.tabs.cashflow'))
}

/** Opens the period dropdown, fills the custom range, and applies it. */
function applyCustomPeriod(start: string, end: string) {
  fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))
  fireEvent.change(screen.getByLabelText('custom-start-date'), { target: { value: start } })
  fireEvent.change(screen.getByLabelText('custom-end-date'), { target: { value: end } })
  fireEvent.click(screen.getByText('transactions.applyPeriod'))
}

// ─── Setup ────────────────────────────────────────────────────────────────────

// Fixed date: 2026-04-15 → default period mode is "month" (April 2026)
const FIXED_NOW = new Date('2026-04-15')

beforeEach(() => {
  useDataStore.setState({ data: null })
  capturedChartProps.data = []
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── CC-16: getEffectiveCashFlowDate applied to cash flow chart ───────────────

describe('Analytics — CC-16: getEffectiveCashFlowDate in cash flow chart', () => {
  it('renders cash flow chart when retail income is in the month range', () => {
    const retailAccount = makeRetailAccount()
    const income = makeTransaction({
      id: 'tx-income',
      type: 'INCOME',
      amount: 500,
      date: '2026-04-01',
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [income] }),
    })
    render(<Analytics />)
    switchToCashFlowTab()
    expect(screen.getByTestId('cashflow-chart')).toBeInTheDocument()
  })

  it('places retail EXPENSE in the tx.date month (unchanged behavior)', () => {
    // Retail account: getEffectiveCashFlowDate returns tx.date
    const retailAccount = makeRetailAccount()
    const expense = makeTransaction({
      id: 'tx-expense',
      accountId: 'acc-retail',
      type: 'EXPENSE',
      amount: 200,
      date: '2026-04-15', // April — only month in range (index 0)
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [expense] }),
    })
    render(<Analytics />)
    switchToCashFlowTab()
    // M-38: month mode splits April into weekly buckets; the retail expense (Apr 15) lands in
    // its own week. Summing across buckets, the month total stays expenses = 200, result = −200.
    const totalExpenses = capturedChartProps.data.reduce((s, r) => s + r.expenses, 0)
    const totalResult = capturedChartProps.data.reduce((s, r) => s + r.result, 0)
    expect(totalExpenses).toBe(200)
    expect(totalResult).toBe(-200)
  })

  it('projects credit card EXPENSE to the invoice due-date month, not the purchase month', () => {
    // System time: 2026-04-15 → month mode shows only April
    // Credit account: closingDay=5, dueDay=10
    // EXPENSE on 2026-04-06 → day 6 > closingDay 5
    //   → invoice period = May 2026
    //   → effective cash-flow date = 2026-06-10 (June, OUTSIDE April range)
    // Retail INCOME in April is added so the chart renders despite the credit
    // expense being displaced outside the visible range.
    const retailAccount = makeRetailAccount({ id: 'acc-retail' })
    const creditAccount = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 12000, closingDay: 5, dueDay: 10 },
    })
    const retailIncome = makeTransaction({
      id: 'tx-income',
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 500,
      date: '2026-04-01', // April → index 0
    })
    const creditExpense = makeTransaction({
      id: 'tx-credit-expense',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 300,
      date: '2026-04-06', // tx.date in April, but effective date = June (out of range)
    })
    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [retailIncome, creditExpense],
      }),
    })
    render(<Analytics />)
    switchToCashFlowTab()

    // April (index 0): retail income 500, credit expense displaced → income=500, expenses=0
    expect(capturedChartProps.data[0]?.income).toBe(500)
    expect(capturedChartProps.data[0]?.expenses).toBe(0)
  })

  it('shows "no data" when the only transaction is a credit expense displaced outside range', () => {
    // No retail income → if credit expense also moves outside range, no data is shown
    const creditAccount = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 12000, closingDay: 5, dueDay: 10 },
    })
    const creditExpense = makeTransaction({
      id: 'tx-credit-expense',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 300,
      date: '2026-04-06', // effective date = June (out of April range)
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [creditExpense] }),
    })
    render(<Analytics />)
    switchToCashFlowTab()
    // All income and expenses values are 0 → "no data" message shown instead of chart
    expect(screen.getByText('common.noData')).toBeInTheDocument()
    expect(screen.queryByTestId('cashflow-chart')).not.toBeInTheDocument()
  })
})

// ─── CC-17: CREDIT_PAYMENT excluded from income/expense charts ───────────────

describe('Analytics — CC-17: CREDIT_PAYMENT excluded from charts and categories', () => {
  it('shows "no data" in cash flow chart when only CREDIT_PAYMENT transactions exist', () => {
    // CREDIT_PAYMENT is not income or expense — chart should show no data
    const retailAccount = makeRetailAccount()
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      accountId: 'acc-retail',
      type: 'CREDIT_PAYMENT',
      amount: 1000,
      date: '2026-04-10',
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [creditPayment] }),
    })
    render(<Analytics />)
    switchToCashFlowTab()
    expect(screen.getByText('common.noData')).toBeInTheDocument()
    expect(screen.queryByTestId('cashflow-chart')).not.toBeInTheDocument()
  })

  it('does not include CREDIT_PAYMENT in income when mixed with INCOME', () => {
    // INCOME 500 + CREDIT_PAYMENT 300 → April income must be 500, not 800
    const retailAccount = makeRetailAccount()
    const income = makeTransaction({
      id: 'tx-income',
      type: 'INCOME',
      amount: 500,
      date: '2026-04-01',
    })
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      type: 'CREDIT_PAYMENT',
      amount: 300,
      date: '2026-04-10',
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [income, creditPayment] }),
    })
    render(<Analytics />)
    switchToCashFlowTab()
    // April (index 0): only income 500 contributes
    expect(capturedChartProps.data[0]?.income).toBe(500)
    expect(capturedChartProps.data[0]?.expenses).toBe(0)
  })

  it('does not count CREDIT_PAYMENT in income category breakdown', () => {
    // INCOME 500 + CREDIT_PAYMENT 300 in same period → income category total = 500
    const retailAccount = makeRetailAccount()
    const income = makeTransaction({
      id: 'tx-income',
      type: 'INCOME',
      amount: 500,
      date: '2026-04-01',
      categoryId: 'cat-income',
    })
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      type: 'CREDIT_PAYMENT',
      amount: 300,
      date: '2026-04-10',
    })
    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [income, creditPayment],
        categories: [makeCategory({ id: 'cat-income', name: 'Salário', type: 'INCOME' })],
      }),
    })
    render(<Analytics />)
    // Default tab is categorias — income category total = 500 (CREDIT_PAYMENT excluded)
    expect(screen.queryByText(/800/)).not.toBeInTheDocument()
  })

  it('does not count CREDIT_PAYMENT in expense category breakdown', () => {
    // EXPENSE 400 + CREDIT_PAYMENT 200 in same period → expense category total = 400
    const retailAccount = makeRetailAccount()
    const expense = makeTransaction({
      id: 'tx-expense',
      type: 'EXPENSE',
      amount: 400,
      date: '2026-04-01',
      categoryId: 'cat-expense',
    })
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      type: 'CREDIT_PAYMENT',
      amount: 200,
      date: '2026-04-10',
    })
    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [expense, creditPayment],
        categories: [makeCategory({ id: 'cat-expense', name: 'Alimentação', type: 'EXPENSE' })],
      }),
    })
    render(<Analytics />)
    // Default tab is categorias — expense total = 400 (CREDIT_PAYMENT excluded)
    expect(screen.queryByText(/600,00/)).not.toBeInTheDocument()
  })
})

// ─── CC-18: category breakdown uses tx.date (budget perspective) ──────────────

describe('Analytics — CC-18: category breakdown uses tx.date, not effective cash-flow date', () => {
  it('includes credit card expense in the purchase-date month for category breakdown', () => {
    // System time: 2026-04-15 → month mode shows April 2026
    // Credit account: closingDay=5, dueDay=10
    // EXPENSE on 2026-04-06:
    //   → tx.date (April 6) is INSIDE April range → appears in category breakdown
    //   → effective cash-flow date (June 10) is OUTSIDE range → absent from cash flow chart
    const creditAccount = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 12000, closingDay: 5, dueDay: 10 },
    })
    const expense = makeTransaction({
      id: 'tx-credit-expense',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 350,
      date: '2026-04-06',
      categoryId: 'cat-expense',
    })
    useDataStore.setState({
      data: makeDataFile({
        accounts: [creditAccount],
        transactions: [expense],
        categories: [makeCategory({ id: 'cat-expense', name: 'Restaurante', type: 'EXPENSE' })],
      }),
    })
    render(<Analytics />)

    // Default tab is categorias: category breakdown uses tx.date → expense IS in range
    expect(screen.getAllByText(/350/).length).toBeGreaterThanOrEqual(1)

    // Switch to cashflow tab: effective date = June, out of April range → no data
    switchToCashFlowTab()
    expect(screen.getByText('common.noData')).toBeInTheDocument()
  })

  it('excludes credit card expense from category breakdown when tx.date is also out of range', () => {
    // EXPENSE on a past date outside the month (Dec 2025)
    // Both tx.date and effective date are outside range → not in breakdown
    const creditAccount = makeCreditAccount()
    const expense = makeTransaction({
      id: 'tx-old',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 9999,
      date: '2025-12-01', // December 2025, before April 2026
    })
    useDataStore.setState({
      data: makeDataFile({
        accounts: [creditAccount],
        transactions: [expense],
        categories: [makeCategory({ id: 'cat-1', type: 'EXPENSE' })],
      }),
    })
    render(<Analytics />)
    // 9999 must not appear (outside range for category breakdown)
    expect(screen.queryByText(/9\.999/)).not.toBeInTheDocument()
  })
})

// ─── M-45: saved custom periods ──────────────────────────────────────────────

describe('Analytics — M-45: saved custom periods', () => {
  it('saving a custom period from the picker persists it to the store', () => {
    useDataStore.setState({ data: makeDataFile({ savedPeriods: [] }) })
    render(<Analytics />)

    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))

    fireEvent.change(screen.getByLabelText('custom-start-date'), {
      target: { value: '2026-01-01' },
    })
    fireEvent.change(screen.getByLabelText('custom-end-date'), {
      target: { value: '2026-03-31' },
    })
    fireEvent.change(screen.getByPlaceholderText('transactions.periodNamePlaceholder'), {
      target: { value: 'Q1 2026' },
    })
    fireEvent.click(screen.getByText('transactions.savePeriod'))

    const saved = useDataStore.getState().data?.savedPeriods
    expect(saved).toHaveLength(1)
    expect(saved?.[0]).toMatchObject({ name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' })
  })

  it('lists a saved period in the dropdown and applies it on click', () => {
    useDataStore.setState({
      data: makeDataFile({
        savedPeriods: [{ id: 'p1', name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' }],
      }),
    })
    render(<Analytics />)

    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    expect(screen.getByRole('menuitem', { name: 'Q1 2026' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Q1 2026' }))
    // Applying closes the dropdown
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('deleting a saved period removes it from the store', () => {
    useDataStore.setState({
      data: makeDataFile({
        savedPeriods: [{ id: 'p1', name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' }],
      }),
    })
    render(<Analytics />)

    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('button', { name: 'transactions.deletePeriod' }))

    expect(useDataStore.getState().data?.savedPeriods).toHaveLength(0)
  })
})

// ─── M-62: projection cutoff is the real-data horizon, not "today" ────────────

describe('Analytics — M-62: projection cutoff uses the real-data horizon', () => {
  it('does not mark buckets within the rolling-window real data as projected', () => {
    // Simulates B-22's rolling window: a monthly recurring series already materialized
    // as real Transaction rows from 2026-01-10 through 2028-01-10 (25 occurrences, no
    // endDate). "Today" is 2026-04-15 — every one of these 25 rows is real, not virtual.
    const account = makeRetailAccount()
    const transactions: Transaction[] = Array.from({ length: 25 }, (_, i) => {
      const month = i % 12
      const year = 2026 + Math.floor((0 + i) / 12)
      return makeTransaction({
        id: `rec-${i}`,
        type: 'INCOME',
        amount: 1000,
        date: `${year}-${String(month + 1).padStart(2, '0')}-10`,
        recurrence: { frequency: 'monthly', parentId: 'rec-parent' },
      })
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [account], transactions }) })
    render(<Analytics />)
    applyCustomPeriod('2026-01-01', '2028-01-31')
    switchToCashFlowTab()

    // The whole selected period (Jan/2026 .. Jan/2028) is covered by real materialized
    // data — none of it should render as projected.
    expect(capturedChartProps.data.length).toBeGreaterThan(0)
    expect(capturedChartProps.data.every((r) => r.isProjected === false)).toBe(true)
  })

  it('marks buckets beyond the last real transaction as projected', () => {
    const account = makeRetailAccount()
    const transactions: Transaction[] = Array.from({ length: 25 }, (_, i) => {
      const month = i % 12
      const year = 2026 + Math.floor(i / 12)
      return makeTransaction({
        id: `rec-${i}`,
        type: 'INCOME',
        amount: 1000,
        date: `${year}-${String(month + 1).padStart(2, '0')}-10`,
        recurrence: { frequency: 'monthly', parentId: 'rec-parent' },
      })
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [account], transactions }) })
    render(<Analytics />)
    // Last real occurrence is 2028-01-10 — extend well past it.
    applyCustomPeriod('2026-01-01', '2029-01-31')
    switchToCashFlowTab()

    const realBucket = capturedChartProps.data.find((r) => r.fullLabel === 'Janeiro de 2026')
    const projectedBucket = capturedChartProps.data.find((r) => r.fullLabel === 'Dezembro de 2028')
    expect(realBucket?.isProjected).toBe(false)
    expect(projectedBucket?.isProjected).toBe(true)
  })
})

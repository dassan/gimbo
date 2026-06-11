import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import FaturasView from '@/pages/Analytics/FaturasView'
import type { Account, Transaction } from '@/types'

// ─── Recharts mock — captures BarChart data rows for assertions ───────────────

const capturedRows = vi.hoisted(() => ({
  data: [] as Array<Record<string, number | string>>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({
    children,
    data,
  }: {
    children: React.ReactNode
    data: Array<Record<string, number | string>>
  }) => {
    capturedRows.data = data ?? []
    return <div data-testid="faturas-chart">{children}</div>
  },
  Bar: ({ dataKey }: { dataKey: string }) => <div data-testid={`bar-${dataKey}`} />,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

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

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-credit',
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

/** April 2026 period */
const APR_START = new Date(2026, 3, 1)
const APR_END = new Date(2026, 3, 30)

/** Two-month period: April + May 2026 */
const APR_MAY_START = new Date(2026, 3, 1)
const APR_MAY_END = new Date(2026, 4, 31)

const SHADOW = 'shadow-card'

beforeEach(() => {
  capturedRows.data = []
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-15'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── R-18 (a): Monthly aggregation by invoice period (closing month) ──────────

describe('FaturasView — R-18(a): aggregation by invoice period (closing month)', () => {
  it('excludes a charge whose invoice closes outside the viewed period', () => {
    // closingDay=5: a purchase on 2026-04-06 (day ≥ 5) closes in May, so it is NOT in
    // April's invoice — matching the Dashboard's per-card "Fatura" (closing period).
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 5, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-1', date: '2026-04-06', amount: 300, accountId: 'acc-credit' }),
    ]

    // Viewing April period — expense is due in June, so nothing in April
    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    // No data in April → empty state
    expect(screen.getByText('analytics.faturasView.noData')).toBeInTheDocument()
  })

  it('places a charge in its closing-month invoice', () => {
    // closingDay=20: a purchase on 2026-04-10 (day < 20) closes in April → April's invoice.
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-1', date: '2026-04-10', amount: 250, accountId: 'acc-credit' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByTestId('faturas-chart')).toBeInTheDocument()
    expect(capturedRows.data[0]?.['acc-credit']).toBe(250)
  })

  it('distributes charges to their closing-month invoices across a multi-month period', () => {
    // closingDay=20: 2026-04-10 closes in April; 2026-05-10 closes in May.
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-apr', date: '2026-04-10', amount: 100, accountId: 'acc-credit' }),
      makeTx({ id: 'tx-may', date: '2026-05-10', amount: 200, accountId: 'acc-credit' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_MAY_START}
        endDate={APR_MAY_END}
        shadowClass={SHADOW}
      />
    )

    expect(capturedRows.data[0]?.['acc-credit']).toBe(100) // April
    expect(capturedRows.data[1]?.['acc-credit']).toBe(200) // May
  })
})

// ─── R-18 (b): Multiple cards summed correctly per month ─────────────────────

describe('FaturasView — R-18(b): multiple cards', () => {
  it('renders a stacked bar for each credit account', () => {
    const card1 = makeCreditAccount({
      id: 'card-1',
      name: 'Nubank',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const card2 = makeCreditAccount({
      id: 'card-2',
      name: 'Itaú',
      creditMetadata: { limit: 3000, closingDay: 20, dueDay: 15 },
    })
    const transactions = [
      makeTx({ id: 'tx-c1', accountId: 'card-1', date: '2026-04-10', amount: 150 }),
      makeTx({ id: 'tx-c2', accountId: 'card-2', date: '2026-04-10', amount: 80 }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[card1, card2]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByTestId('bar-card-1')).toBeInTheDocument()
    expect(screen.getByTestId('bar-card-2')).toBeInTheDocument()
    expect(capturedRows.data[0]?.['card-1']).toBe(150)
    expect(capturedRows.data[0]?.['card-2']).toBe(80)
  })

  it('only totals same-month expenses per card independently', () => {
    const card1 = makeCreditAccount({
      id: 'card-1',
      name: 'Nubank',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const card2 = makeCreditAccount({
      id: 'card-2',
      name: 'Itaú',
      creditMetadata: { limit: 3000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      // card-1: two purchases in March → both due April
      makeTx({ id: 'tx-c1a', accountId: 'card-1', date: '2026-04-05', amount: 100 }),
      makeTx({ id: 'tx-c1b', accountId: 'card-1', date: '2026-04-10', amount: 200 }),
      // card-2: one charge in April's invoice (day < closingDay 20)
      makeTx({ id: 'tx-c2', accountId: 'card-2', date: '2026-04-10', amount: 50 }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[card1, card2]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(capturedRows.data[0]?.['card-1']).toBe(300) // 100 + 200
    expect(capturedRows.data[0]?.['card-2']).toBe(50)
  })
})

// ─── R-18 (c): CREDIT_PAYMENT excluded ───────────────────────────────────────

describe('FaturasView — R-18(c): CREDIT_PAYMENT excluded', () => {
  it('does not count CREDIT_PAYMENT as invoice expense', () => {
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-cp', type: 'CREDIT_PAYMENT', amount: 500, date: '2026-04-10' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByText('analytics.faturasView.noData')).toBeInTheDocument()
  })

  it('counts only EXPENSE when mixed with CREDIT_PAYMENT', () => {
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      // Purchase in March → due April
      makeTx({
        id: 'tx-exp',
        type: 'EXPENSE',
        amount: 200,
        date: '2026-04-10',
        accountId: 'acc-credit',
      }),
      // Payment in April → must be excluded
      makeTx({
        id: 'tx-pay',
        type: 'CREDIT_PAYMENT',
        amount: 200,
        date: '2026-04-10',
        accountId: 'acc-credit',
      }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(capturedRows.data[0]?.['acc-credit']).toBe(200)
  })

  it('does not count INCOME transactions', () => {
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({
        id: 'tx-inc',
        type: 'INCOME',
        amount: 1000,
        date: '2026-04-10',
        accountId: 'acc-credit',
      }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByText('analytics.faturasView.noData')).toBeInTheDocument()
  })
})

// ─── R-18 (d): Empty state ────────────────────────────────────────────────────

describe('FaturasView — R-18(d): empty state', () => {
  it('shows empty state when there are no CREDIT accounts', () => {
    const retailAcc = makeRetailAccount()
    const transactions = [
      makeTx({ id: 'tx-1', type: 'EXPENSE', amount: 100, accountId: 'acc-retail' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[retailAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByText('analytics.faturasView.noData')).toBeInTheDocument()
    expect(screen.queryByTestId('faturas-chart')).not.toBeInTheDocument()
  })

  it('shows empty state when there are CREDIT accounts but no EXPENSE in period', () => {
    const creditAcc = makeCreditAccount()

    render(
      <FaturasView
        transactions={[]}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByText('analytics.faturasView.noData')).toBeInTheDocument()
  })

  it('shows empty state when CREDIT accounts exist but expense is outside the period', () => {
    // Purchase on 2026-04-06 with closingDay=5 → due June 10 → outside April period
    const creditAcc = makeCreditAccount({
      creditMetadata: { limit: 5000, closingDay: 5, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-1', date: '2026-04-06', amount: 100, accountId: 'acc-credit' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByText('analytics.faturasView.noData')).toBeInTheDocument()
  })
})

// ─── R-18 (e): Data grid total row ───────────────────────────────────────────

describe('FaturasView — R-18(e): data grid total row', () => {
  it('shows a bold total row per month when there are multiple cards', () => {
    const card1 = makeCreditAccount({
      id: 'card-1',
      name: 'Nubank',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const card2 = makeCreditAccount({
      id: 'card-2',
      name: 'Itaú',
      creditMetadata: { limit: 3000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-c1', accountId: 'card-1', date: '2026-04-10', amount: 150 }),
      makeTx({ id: 'tx-c2', accountId: 'card-2', date: '2026-04-10', amount: 80 }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[card1, card2]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    // With two cards, the key appears twice: once in the column header and once in the bold total row
    expect(screen.getAllByText('analytics.faturasView.total')).toHaveLength(2)
  })

  it('does not show total row when there is only one card', () => {
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-1', date: '2026-04-10', amount: 100, accountId: 'acc-credit' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    // Only the column header contains the key — no bold total row
    expect(screen.getAllByText('analytics.faturasView.total')).toHaveLength(1)
  })

  it('shows card names in the grid rows', () => {
    const creditAcc = makeCreditAccount({
      id: 'acc-credit',
      name: 'Nubank Gold',
      creditMetadata: { limit: 5000, closingDay: 20, dueDay: 10 },
    })
    const transactions = [
      makeTx({ id: 'tx-1', date: '2026-04-10', amount: 100, accountId: 'acc-credit' }),
    ]

    render(
      <FaturasView
        transactions={transactions}
        accounts={[creditAcc]}
        startDate={APR_START}
        endDate={APR_END}
        shadowClass={SHADOW}
      />
    )

    expect(screen.getByText('Nubank Gold')).toBeInTheDocument()
  })
})

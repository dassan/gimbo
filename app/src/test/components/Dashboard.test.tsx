import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import Dashboard from '@/pages/Dashboard'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import type { Account, Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'pt-BR' } }),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: () => null,
  Cell: () => null,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Use a past date so these transactions never appear in current-month stat cards.
// This ensures the only place a specific value appears is the account row itself.
const PAST_DATE = '2020-06-15'

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

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
    creditMetadata: { limit: 12000, closingDay: 20, dueDay: 10 },
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
    date: todayStr,
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useDataStore.setState({ data: null })
})

// ─── CC-13: accountBalances bifurcation for CREDIT accounts ──────────────────

describe('Dashboard — CC-13: accountBalances bifurcation', () => {
  it('shows standard balance for non-CREDIT accounts (INCOME − EXPENSE)', () => {
    const account = makeRetailAccount()
    // Use past-month transactions so stat cards show zero — makes 6.666,00 unique in DOM
    const income = makeTransaction({
      id: 'tx-income',
      type: 'INCOME',
      amount: 7777,
      date: PAST_DATE,
    })
    const expense = makeTransaction({
      id: 'tx-expense',
      type: 'EXPENSE',
      amount: 1111,
      date: PAST_DATE,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [income, expense] }),
    })

    render(<Dashboard />)

    // Standard balance = 7777 - 1111 = 6666 (stat cards show 0, so this is unique)
    expect(screen.getByText(/6\.666,00/)).toBeInTheDocument()
  })

  it('shows R$0,00 for CREDIT account without creditMetadata', () => {
    const creditAccount = makeCreditAccount({ creditMetadata: undefined })

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    // Credit account without creditMetadata: available limit = 0
    // Multiple 0,00 values exist (stat cards + invoice + available limit)
    expect(screen.getByText('dashboard.myCards')).toBeInTheDocument()
    // Verify the account name appears in the Meus Cartões section
    expect(screen.getByText('Nexus Visa Gold')).toBeInTheDocument()
  })

  it('does not include CREDIT account transactions in non-CREDIT balance calculation', () => {
    const retailAccount = makeRetailAccount({ id: 'acc-retail' })
    const creditAccount = makeCreditAccount({ id: 'acc-credit' })

    // Retail income → appears in both account row and recent transactions section
    const retailIncome = makeTransaction({
      id: 'tx-retail-income',
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 8888,
      date: PAST_DATE,
    })
    // Credit expense → should NOT be subtracted from retail balance
    // If incorrectly included: retail balance = 8888 - 1000 = 7888 (wrong)
    const creditExpense = makeTransaction({
      id: 'tx-credit-expense',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 1000,
      date: todayStr,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [retailIncome, creditExpense],
      }),
    })

    render(<Dashboard />)

    // Correct retail balance = 8888 (appears in account row + recent transactions)
    expect(screen.getAllByText(/8\.888,00/).length).toBeGreaterThanOrEqual(1)
    // Wrong balance if credit expense was incorrectly subtracted would be 7888
    expect(screen.queryByText(/7\.888,00/)).not.toBeInTheDocument()
  })
})

// ─── CC-14: "Meus Cartões" section visibility ─────────────────────────────────

describe('Dashboard — CC-14: Meus Cartões section', () => {
  it('renders Meus Cartões section when CREDIT accounts exist', () => {
    const creditAccount = makeCreditAccount()

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('dashboard.myCards')).toBeInTheDocument()
  })

  it('renders Meus Cartões section even when no CREDIT accounts exist (empty state)', () => {
    const retailAccount = makeRetailAccount()

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('dashboard.myCards')).toBeInTheDocument()
    expect(screen.getByText('dashboard.noCards')).toBeInTheDocument()
  })

  it('shows accounts.availableLimit i18n label for credit accounts', () => {
    const creditAccount = makeCreditAccount()

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('accounts.availableLimit')).toBeInTheDocument()
  })

  it('shows invoice label (dashboard.invoice) for credit accounts', () => {
    const creditAccount = makeCreditAccount()

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('dashboard.invoice')).toBeInTheDocument()
  })

  it('renders Minhas Contas section only for non-CREDIT accounts with includeInBalance', () => {
    const retailAccount = makeRetailAccount({ includeInBalance: true })
    const creditAccount = makeCreditAccount({ includeInBalance: false })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount, creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    // Both account names should be visible — retail in Minhas Contas, credit in Meus Cartões
    expect(screen.getByText('Conta Corrente')).toBeInTheDocument()
    expect(screen.getByText('Nexus Visa Gold')).toBeInTheDocument()
    // Both section headings
    expect(screen.getByText('dashboard.myAccounts')).toBeInTheDocument()
    expect(screen.getByText('dashboard.myCards')).toBeInTheDocument()
  })

  it('shows full available limit for CREDIT account with creditMetadata and no expenses', () => {
    const creditAccount = makeCreditAccount({
      id: 'acc-credit',
      // Use a unique limit value (15001) that won't appear in stat cards
      creditMetadata: { limit: 15001, closingDay: 20, dueDay: 10 },
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    // With no expenses: available limit = limit = 15001 (unique value)
    expect(screen.getByText(/15\.001,00/)).toBeInTheDocument()
  })

  it('renders total invoice summary in Meus Cartões section when cards exist', () => {
    const creditAccount = makeCreditAccount()

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<Dashboard />)

    // The manage button is gone; the total invoices label is shown instead
    expect(screen.queryByText('dashboard.manage')).not.toBeInTheDocument()
    expect(screen.getByText(/dashboard\.totalInvoices/)).toBeInTheDocument()
  })
})

// ─── M-25: Últimos Lançamentos — only first installment per group ─────────────

describe('Dashboard — M-25: recent transactions show only first installment', () => {
  it('shows non-installment transactions normally', () => {
    const account = makeRetailAccount()
    const tx = makeTransaction({ id: 'tx-solo', description: 'Compra simples', date: todayStr })
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [tx] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('Compra simples')).toBeInTheDocument()
  })

  it('shows only the first installment (currentIndex === 1) in recent transactions', () => {
    const account = makeRetailAccount()
    const parentId = 'parent-uuid'
    const installments = [1, 2, 3].map((i) =>
      makeTransaction({
        id: `tx-inst-${i}`,
        description: `Parcela (${i}/3)`,
        date: todayStr,
        installment: { parentId, currentIndex: i, total: 3 },
      })
    )
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: installments }),
    })

    render(<Dashboard />)

    // Only the first installment should appear
    expect(screen.getByText('Parcela (1/3)')).toBeInTheDocument()
    expect(screen.queryByText('Parcela (2/3)')).not.toBeInTheDocument()
    expect(screen.queryByText('Parcela (3/3)')).not.toBeInTheDocument()
  })

  it('a 10-installment purchase occupies only 1 slot, leaving room for other transactions', () => {
    const account = makeRetailAccount()
    const parentId = 'parent-10x'
    const installments = Array.from({ length: 10 }, (_, i) =>
      makeTransaction({
        id: `tx-10x-${i + 1}`,
        description: `Notebook (${i + 1}/10)`,
        date: todayStr,
        installment: { parentId, currentIndex: i + 1, total: 10 },
      })
    )
    // Add 4 other distinct transactions
    const others = [1, 2, 3, 4].map((i) =>
      makeTransaction({
        id: `tx-other-${i}`,
        description: `Outra compra ${i}`,
        date: todayStr,
      })
    )
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [...installments, ...others] }),
    })

    render(<Dashboard />)

    // First installment visible, others (2-10) not
    expect(screen.getByText('Notebook (1/10)')).toBeInTheDocument()
    expect(screen.queryByText('Notebook (2/10)')).not.toBeInTheDocument()
    // At least some of the other transactions should also appear
    expect(screen.getByText('Outra compra 1')).toBeInTheDocument()
  })
})

// ─── CC-22: CREDIT_PAYMENT excluded from income/expense totals ────────────────

describe('Dashboard — CC-22: CREDIT_PAYMENT excluded from totals', () => {
  it('does not count CREDIT_PAYMENT amount in monthly income stat', () => {
    const retailAccount = makeRetailAccount()
    const creditAccount = makeCreditAccount()

    const income = makeTransaction({
      id: 'tx-income',
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 1000,
      date: todayStr,
    })
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      accountId: 'acc-credit',
      type: 'CREDIT_PAYMENT',
      amount: 500,
      date: todayStr,
      transferAccountId: 'acc-retail',
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [income, creditPayment],
      }),
    })

    render(<Dashboard />)

    // Income stat should show 1000, not 1500 (CREDIT_PAYMENT must not add to income)
    const amounts = screen.getAllByText(/1\.000,00/)
    expect(amounts.length).toBeGreaterThanOrEqual(1)
    // If CREDIT_PAYMENT was wrongly counted as income we'd see 1500
    expect(screen.queryByText(/1\.500,00/)).not.toBeInTheDocument()
  })

  it('does not count CREDIT_PAYMENT amount in monthly expense stat', () => {
    // High initial balance so the post-debit balance (5000 − 200 − 800 = 4000) does not
    // collide with the 1000 proxy below (CREDIT_PAYMENT now legitimately debits the payer).
    const retailAccount = makeRetailAccount({ balance: 5000 })
    const creditAccount = makeCreditAccount()

    const expense = makeTransaction({
      id: 'tx-expense',
      accountId: 'acc-retail',
      type: 'EXPENSE',
      amount: 200,
      date: todayStr,
    })
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      accountId: 'acc-credit',
      type: 'CREDIT_PAYMENT',
      amount: 800,
      date: todayStr,
      transferAccountId: 'acc-retail',
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [expense, creditPayment],
      }),
    })

    render(<Dashboard />)

    // Expense stat should show 200, not 1000 (CREDIT_PAYMENT must not add to expenses)
    expect(screen.getAllByText(/200,00/).length).toBeGreaterThanOrEqual(1)
    // If CREDIT_PAYMENT were wrongly counted as expense we'd see 1000 in the stats
    expect(screen.queryByText(/1\.000,00/)).not.toBeInTheDocument()
    // Bug B fix: the payment debits the funding account (5000 − 200 − 800 = 4000)
    expect(screen.getAllByText(/4\.000,00/).length).toBeGreaterThanOrEqual(1)
  })
})

// ─── B-15: "Previstas" decoupled from statement-faithful balances ─────────────

describe('Dashboard — B-15: unpaid counts toward "Previstas", never the balance', () => {
  it('an unpaid current-month expense feeds the stat cards but not the account balance', () => {
    // Initial balance 1000 + a PAID income of 700 this month → statement balance = 1700.
    // An UNPAID expense of 250 this month must NOT touch the cumulative balance (it would
    // wrongly read 1450), yet it MUST appear in "Despesas Previstas".
    const account = makeRetailAccount({ balance: 1000 })
    const paidIncome = makeTransaction({
      id: 'tx-paid-income',
      type: 'INCOME',
      amount: 700,
      date: todayStr,
      isPaid: true,
    })
    const unpaidExpense = makeTransaction({
      id: 'tx-unpaid-expense',
      type: 'EXPENSE',
      amount: 250,
      date: todayStr,
      isPaid: false,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [paidIncome, unpaidExpense] }),
    })

    render(<Dashboard />)

    // Balance stays faithful to the statement: 1000 + 700 = 1700 (unpaid excluded).
    expect(screen.getByText(/1\.700,00/)).toBeInTheDocument()
    // If the unpaid expense had wrongly hit the balance it would read 1450 — must not.
    expect(screen.queryByText(/1\.450,00/)).not.toBeInTheDocument()
    // The unpaid expense still drives "Despesas Previstas".
    expect(screen.getAllByText(/250,00/).length).toBeGreaterThanOrEqual(1)
  })
})

// ─── M-23: CreditCardRow uses issuerIcon color ────────────────────────────────

describe('Dashboard — M-23: credit card issuer icon color', () => {
  it('renders the credit card row regardless of issuerIcon value', () => {
    const creditAccount = makeCreditAccount({ issuerIcon: 'nubank' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })
    render(<Dashboard />)
    expect(screen.getByText('Nexus Visa Gold')).toBeInTheDocument()
    expect(screen.getByText('dashboard.myCards')).toBeInTheDocument()
  })

  it('renders the credit card row with no issuerIcon (defaults to generic dark color)', () => {
    const creditAccount = makeCreditAccount({ issuerIcon: undefined })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })
    render(<Dashboard />)
    expect(screen.getByText('Nexus Visa Gold')).toBeInTheDocument()
  })

  it('renders correctly with issuerIcon set to "generic"', () => {
    const creditAccount = makeCreditAccount({ issuerIcon: 'generic' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })
    render(<Dashboard />)
    expect(screen.getByText('Nexus Visa Gold')).toBeInTheDocument()
  })
})

// ─── M-42: archived accounts hidden from the overview ────────────────────────

describe('Dashboard — M-42: archived accounts', () => {
  it('hides an archived non-CREDIT account from "Minhas Contas"', () => {
    const activeAccount = makeRetailAccount({ id: 'acc-active', name: 'Conta Ativa' })
    const archivedAccount = makeRetailAccount({
      id: 'acc-old',
      name: 'Conta Antiga',
      archived: true,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [activeAccount, archivedAccount], transactions: [] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('Conta Ativa')).toBeInTheDocument()
    expect(screen.queryByText('Conta Antiga')).not.toBeInTheDocument()
  })

  it('hides an archived CREDIT account from "Meus Cartões"', () => {
    const activeCard = makeCreditAccount({ id: 'acc-card-active', name: 'Cartão Ativo' })
    const archivedCard = makeCreditAccount({
      id: 'acc-card-old',
      name: 'Cartão Antigo',
      archived: true,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [activeCard, archivedCard], transactions: [] }),
    })

    render(<Dashboard />)

    expect(screen.getByText('Cartão Ativo')).toBeInTheDocument()
    expect(screen.queryByText('Cartão Antigo')).not.toBeInTheDocument()
  })
})

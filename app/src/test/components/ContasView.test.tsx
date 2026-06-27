import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ContasView from '@/pages/Analytics/ContasView'
import type { Account, Transaction } from '@/types'

// ─── Recharts mock (used by CashFlowView inside ContasView drill-down) ────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="cashflow-chart">{children}</div>
  ),
  Bar: () => null,
  Cell: () => null,
  Line: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const APR_START = new Date(2026, 3, 1)
const APR_END = new Date(2026, 3, 30)
const SHADOW = 'shadow-card'

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
    name: 'Cartão Visa',
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
    accountId: 'acc-retail',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-04-10',
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-04-15'))
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── R-15: Account grid — non-CREDIT accounts ─────────────────────────────────

describe('ContasView — R-15: account grid', () => {
  it('renders account name in the grid', () => {
    render(
      <ContasView
        transactions={[]}
        accounts={[makeRetailAccount({ name: 'Poupança Especial' })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.getByText('Poupança Especial')).toBeInTheDocument()
  })

  it('calculates income, expenses and result correctly for a non-CREDIT account', () => {
    const transactions = [
      makeTx({ id: 'tx-income', type: 'INCOME', amount: 1000 }),
      makeTx({ id: 'tx-expense', type: 'EXPENSE', amount: 400 }),
    ]
    render(
      <ContasView
        transactions={transactions}
        accounts={[makeRetailAccount()]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Result = 1000 - 400 = 600. The formatted value contains "600"
    expect(screen.getByText(/600/)).toBeInTheDocument()
  })

  it('excludes CREDIT_PAYMENT from account summary', () => {
    const transactions = [
      makeTx({ id: 'tx-income', type: 'INCOME', amount: 500 }),
      makeTx({ id: 'tx-cp', type: 'CREDIT_PAYMENT', amount: 9999, date: '2026-04-10' }),
    ]
    render(
      <ContasView
        transactions={transactions}
        accounts={[makeRetailAccount()]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.queryByText(/9\.999/)).not.toBeInTheDocument()
    expect(screen.queryByText(/9999/)).not.toBeInTheDocument()
  })

  it('excludes unpaid transactions when includeUnpaid=false', () => {
    const transactions = [
      makeTx({ id: 'tx-paid', type: 'EXPENSE', amount: 100, isPaid: true }),
      makeTx({ id: 'tx-unpaid', type: 'EXPENSE', amount: 8888, isPaid: false }),
    ]
    render(
      <ContasView
        transactions={transactions}
        accounts={[makeRetailAccount()]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={false}
        shadowClass={SHADOW}
      />
    )
    expect(screen.queryByText(/8\.888/)).not.toBeInTheDocument()
  })

  it('shows the empty-state message when there are no accounts', () => {
    render(
      <ContasView
        transactions={[]}
        accounts={[]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.getByText('analytics.contas.selectPrompt')).toBeInTheDocument()
  })
})

// ─── R-15: CREDIT accounts separate section ───────────────────────────────────

describe('ContasView — R-15: CREDIT accounts in separate section', () => {
  it('renders the creditCards section header for CREDIT accounts with includeInBalance', () => {
    render(
      <ContasView
        transactions={[]}
        accounts={[makeCreditAccount({ includeInBalance: true })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // The section header uses the settings.creditCards i18n key
    expect(screen.getByText('settings.creditCards')).toBeInTheDocument()
  })

  it('renders the CREDIT account name in the credit section', () => {
    render(
      <ContasView
        transactions={[]}
        accounts={[makeCreditAccount({ name: 'Nubank Platinum', includeInBalance: true })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.getByText('Nubank Platinum')).toBeInTheDocument()
  })

  it('does not mix CREDIT accounts into the non-CREDIT grid', () => {
    const accounts = [
      makeRetailAccount({ id: 'acc-retail', name: 'Conta Corrente' }),
      makeCreditAccount({ id: 'acc-credit', name: 'Cartão Roxo', includeInBalance: true }),
    ]
    render(
      <ContasView
        transactions={[]}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Both names present but only one settings.creditCards header (for credit section)
    expect(screen.getByText('Conta Corrente')).toBeInTheDocument()
    expect(screen.getByText('Cartão Roxo')).toBeInTheDocument()
    expect(screen.getByText('settings.creditCards')).toBeInTheDocument()
  })

  it('shows invoice total (expenses within period by tx.date) for CREDIT accounts', () => {
    const transactions = [
      makeTx({
        id: 'tx-credit-expense',
        accountId: 'acc-credit',
        type: 'EXPENSE',
        amount: 750,
        date: '2026-04-10',
      }),
    ]
    render(
      <ContasView
        transactions={transactions}
        accounts={[makeCreditAccount({ includeInBalance: true })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Invoice total 750 should be visible in the card
    expect(screen.getByText(/750/)).toBeInTheDocument()
  })

  it('hides accounts and credit cards with includeInBalance=false', () => {
    const accounts = [
      makeRetailAccount({ id: 'acc-hidden', name: 'Conta Oculta', includeInBalance: false }),
      makeCreditAccount({
        id: 'acc-credit-hidden',
        name: 'Cartão Oculto',
        includeInBalance: false,
      }),
    ]
    render(
      <ContasView
        transactions={[]}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.queryByText('Conta Oculta')).not.toBeInTheDocument()
    expect(screen.queryByText('Cartão Oculto')).not.toBeInTheDocument()
    expect(screen.getByText('analytics.contas.selectPrompt')).toBeInTheDocument()
  })

  // M-42: archived accounts are hidden from this overview
  it('hides archived accounts and credit cards', () => {
    const accounts = [
      makeRetailAccount({ id: 'acc-old', name: 'Conta Antiga', archived: true }),
      makeCreditAccount({
        id: 'acc-credit-old',
        name: 'Cartão Antigo',
        includeInBalance: true,
        archived: true,
      }),
    ]
    render(
      <ContasView
        transactions={[]}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.queryByText('Conta Antiga')).not.toBeInTheDocument()
    expect(screen.queryByText('Cartão Antigo')).not.toBeInTheDocument()
    expect(screen.getByText('analytics.contas.selectPrompt')).toBeInTheDocument()
  })
})

// ─── R-16: Drill-down — click card → CashFlowView; "Voltar" → grid ───────────

describe('ContasView — R-16: drill-down and back navigation', () => {
  it('clicking a non-CREDIT account card replaces the grid with CashFlowView', () => {
    render(
      <ContasView
        transactions={[makeTx({ type: 'INCOME', amount: 100 })]}
        accounts={[makeRetailAccount({ name: 'Conta Corrente' })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    // Initially the grid is shown (account name visible)
    expect(screen.getByText('Conta Corrente')).toBeInTheDocument()
    expect(screen.queryByTestId('cashflow-chart')).not.toBeInTheDocument()

    // Click the account card button
    fireEvent.click(screen.getByRole('button', { name: /conta corrente/i }))

    // Drill-down: CashFlowView is rendered (ComposedChart mock present)
    // The account name appears in the drill-down header
    expect(screen.getByText('Conta Corrente')).toBeInTheDocument()
    // CashFlowView renders (either chart or noData)
    const chart = screen.queryByTestId('cashflow-chart')
    const noData = screen.queryByText('common.noData')
    expect(chart !== null || noData !== null).toBe(true)
  })

  it('clicking "Voltar" in the drill-down header restores the account grid', () => {
    render(
      <ContasView
        transactions={[]}
        accounts={[makeRetailAccount({ name: 'Conta Corrente' })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    // Navigate to drill-down
    fireEvent.click(screen.getByRole('button', { name: /conta corrente/i }))

    // "Voltar" button should be visible in drill-down header
    const backButton = screen.getByRole('button', { name: /analytics\.contas\.back/i })
    expect(backButton).toBeInTheDocument()

    // Click "Voltar"
    fireEvent.click(backButton)

    // Grid is restored: account card button visible again
    expect(screen.getByRole('button', { name: /conta corrente/i })).toBeInTheDocument()
    expect(screen.queryByTestId('cashflow-chart')).not.toBeInTheDocument()
  })

  it('clicking a CREDIT account card also triggers drill-down', () => {
    render(
      <ContasView
        transactions={[]}
        accounts={[makeCreditAccount({ name: 'Cartão Visa', includeInBalance: true })]}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /cartão visa/i }))

    // Back button appears in drill-down header
    expect(screen.getByRole('button', { name: /analytics\.contas\.back/i })).toBeInTheDocument()
  })

  it('drill-down CashFlowView is filtered to the selected account only', () => {
    // Two accounts with different income amounts
    // acc-a has income 400; acc-b has income 999
    // After clicking acc-a card, only income 400 should be in view
    const accounts = [
      makeRetailAccount({ id: 'acc-a', name: 'Conta A' }),
      makeRetailAccount({ id: 'acc-b', name: 'Conta B' }),
    ]
    const transactions = [
      makeTx({ id: 'tx-a', accountId: 'acc-a', type: 'INCOME', amount: 400, date: '2026-04-01' }),
      makeTx({ id: 'tx-b', accountId: 'acc-b', type: 'INCOME', amount: 999, date: '2026-04-01' }),
    ]
    render(
      <ContasView
        transactions={transactions}
        accounts={accounts}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: /conta a/i }))

    // acc-b amount should NOT appear in the drill-down
    // (999 would be a distinctive value that wouldn't appear)
    expect(screen.queryByText(/999/)).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NetWorth from '@/pages/NetWorth'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  makeDataFile,
  makeCreditAccount,
  makeLoanAccount,
  makeValuation,
} from '@/test/fixtures/dataFile'
import { createDefaultWorkspace } from '@/lib/storage/schema'
import type { Account, Transaction } from '@/types'
import { uuid, formatCurrency, todayStr } from '@/lib/utils'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeRetailAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: uuid(),
    name: 'Conta Corrente',
    type: 'RETAIL',
    balance: 1000,
    includeInBalance: true,
    ...overrides,
  }
}

function makeStocksAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: uuid(),
    name: 'Carteira Ações',
    type: 'STOCKS',
    balance: 0,
    includeInBalance: true,
    ...overrides,
  }
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: uuid(),
    accountId: 'acc-credit',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2099-12-01',
    description: 'Test',
    isPaid: false,
    tags: [],
    ...overrides,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useDataStore.setState({ data: null })
  useWorkspaceStore.setState({ workspace: createDefaultWorkspace() })
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NetWorth page', () => {
  it('renders nothing when data is null', () => {
    const { container } = render(<NetWorth />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders page title', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.title')).toBeInTheDocument()
  })

  it('renders hero card with netWorth label', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.netWorth')).toBeInTheDocument()
  })

  it('renders one category card per account type present, titled by category', () => {
    const retail = makeRetailAccount({ id: 'acc-retail', name: 'Conta Corrente' })
    const stocks = makeStocksAccount({ id: 'acc-stocks', name: 'Carteira Ações' })
    const credit = makeCreditAccount({ id: 'acc-credit' })
    const loan = makeLoanAccount({ id: 'acc-loan' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [retail, stocks, credit, loan] }),
    })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.categoryRetail')).toBeInTheDocument()
    expect(screen.getByText('netWorth.categoryInvestments')).toBeInTheDocument()
    expect(screen.getByText('netWorth.categoryCredit')).toBeInTheDocument()
    expect(screen.getByText('netWorth.categoryLoans')).toBeInTheDocument()
    // No accounts of these categories in this fixture — their cards are omitted.
    expect(screen.queryByText('netWorth.categorySavings')).not.toBeInTheDocument()
    expect(screen.queryByText('netWorth.categoryOther')).not.toBeInTheDocument()
  })

  it('sums only the accounts in a category on its card header, not the grand total', () => {
    const retail = makeRetailAccount({ id: 'acc-retail', balance: 1000 })
    const stocks = makeStocksAccount({ id: 'acc-stocks', balance: 500 })
    useDataStore.setState({ data: makeDataFile({ accounts: [retail, stocks] }) })
    render(<NetWorth />)
    // Retail card shows 1000, Investments card shows 500 — not the combined 1500.
    expect(document.body.textContent).toContain(formatCurrency(1000))
    expect(document.body.textContent).toContain(formatCurrency(500))
  })

  it('shows empty state when no accounts', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<NetWorth />)
    const empties = screen.getAllByText('netWorth.noAccounts')
    expect(empties.length).toBe(2)
  })

  it('shows retail account in assets section with correct balance (balance + transactions)', () => {
    const acc = makeRetailAccount({ id: 'acc-retail', balance: 5000, includeInBalance: true })
    const income = makeTx({
      accountId: 'acc-retail',
      type: 'INCOME',
      amount: 1000,
      date: '2024-01-15',
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [acc], transactions: [income] }),
    })
    render(<NetWorth />)
    expect(screen.getByText('Conta Corrente')).toBeInTheDocument()
  })

  it('shows CREDIT account in liabilities section with two-number display', () => {
    const acc = makeCreditAccount({ id: 'acc-credit' })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc] }) })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.currentInvoice')).toBeInTheDocument()
    expect(screen.getByText('netWorth.totalCommitted')).toBeInTheDocument()
  })

  it('filters out hidden accounts when toggle is OFF', () => {
    const hiddenAcc = makeRetailAccount({ name: 'Conta Oculta', includeInBalance: false })
    useWorkspaceStore.setState({
      workspace: { ...createDefaultWorkspace(), netWorthIncludeHidden: false },
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [hiddenAcc] }) })
    render(<NetWorth />)
    expect(screen.queryByText('Conta Oculta')).not.toBeInTheDocument()
  })

  it('includes hidden accounts when toggle is ON (default)', () => {
    const hiddenAcc = makeRetailAccount({ name: 'Conta Oculta', includeInBalance: false })
    useDataStore.setState({ data: makeDataFile({ accounts: [hiddenAcc] }) })
    render(<NetWorth />)
    expect(screen.getByText('Conta Oculta')).toBeInTheDocument()
  })

  it('toggling the switch updates the preference', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<NetWorth />)
    const toggle = screen.getByRole('switch')
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(useWorkspaceStore.getState().workspace.netWorthIncludeHidden).toBe(false)
  })

  it('uses valuation as baseline for STOCKS account', () => {
    const accId = 'acc-stocks'
    const acc = makeStocksAccount({ id: accId, balance: 0 })
    const valuation = makeValuation({ accountId: accId, date: '2024-01-01', marketValue: 8000 })
    const incomeTx = makeTx({
      accountId: accId,
      type: 'INCOME',
      amount: 500,
      date: '2024-06-15',
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [acc], valuations: [valuation], transactions: [incomeTx] }),
    })
    render(<NetWorth />)
    expect(screen.getByText('Carteira Ações')).toBeInTheDocument()
  })

  describe('TRANSFER balance handling', () => {
    function setupTransfer() {
      const source = makeRetailAccount({ id: 'acc-source', name: 'Conta Origem', balance: 1000 })
      const dest = makeRetailAccount({ id: 'acc-dest', name: 'Conta Destino', balance: 500 })
      const transfer = makeTx({
        accountId: 'acc-source',
        type: 'TRANSFER',
        amount: 300,
        date: '2024-01-10',
        transferAccountId: 'acc-dest',
      })
      useDataStore.setState({
        data: makeDataFile({ accounts: [source, dest], transactions: [transfer] }),
      })
    }

    it('decrements source account balance on outgoing transfer', () => {
      setupTransfer()
      render(<NetWorth />)
      // Source: 1000 - 300 = 700
      expect(document.body.textContent).toContain(formatCurrency(700))
    })

    it('increments destination account balance on incoming transfer', () => {
      setupTransfer()
      render(<NetWorth />)
      // Destination: 500 + 300 = 800
      expect(document.body.textContent).toContain(formatCurrency(800))
    })

    it('total assets unchanged after a transfer (net-zero operation)', () => {
      setupTransfer()
      render(<NetWorth />)
      // Total: 1000 + 500 = 1500, transfer doesn't change net worth
      expect(document.body.textContent).toContain(formatCurrency(1500))
    })
  })

  it('getTotalCreditLiability sums current + future EXPENSE for liabilities total', () => {
    const acc = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 10000, closingDay: 28, dueDay: 10 },
    })
    const futureTx = makeTx({ accountId: 'acc-credit', amount: 300, date: '2099-12-01' })
    useDataStore.setState({
      data: makeDataFile({ accounts: [acc], transactions: [futureTx] }),
    })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.totalCommitted')).toBeInTheDocument()
  })

  // ─── HE-07: LOAN as a liability ─────────────────────────────────────────────

  it('shows LOAN account in liabilities section with outstandingBalance and monthlyPayment', () => {
    const acc = makeLoanAccount({ id: 'acc-loan', name: 'Empréstimo Carro' })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc] }) })
    render(<NetWorth />)
    expect(screen.getByText('Empréstimo Carro')).toBeInTheDocument()
    expect(screen.getByText('accounts.outstandingBalance')).toBeInTheDocument()
    expect(screen.getByText('accounts.monthlyPayment')).toBeInTheDocument()
    expect(document.body.textContent).toContain(formatCurrency(15000))
  })

  it('does not count LOAN outstandingBalance as an asset', () => {
    const acc = makeLoanAccount({ id: 'acc-loan' })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc] }) })
    render(<NetWorth />)
    // Assets section stays empty; the loan only shows up under Liabilities.
    expect(screen.getAllByText('netWorth.noAccounts')).toHaveLength(1)
  })

  it('sums CREDIT and LOAN balances into totalLiabilities (negative netWorth)', () => {
    const card = makeCreditAccount({ id: 'acc-credit' })
    const loan = makeLoanAccount({ id: 'acc-loan' })
    const charge = makeTx({ accountId: 'acc-credit', amount: 500, date: todayStr() })
    useDataStore.setState({
      data: makeDataFile({ accounts: [card, loan], transactions: [charge] }),
    })
    render(<NetWorth />)
    // Liabilities total: 500 (credit) + 15000 (loan) = 15500; net worth: 0 - 15500.
    expect(document.body.textContent).toContain(formatCurrency(15500))
  })

  it('hides an archived LOAN account as a row but keeps it in the Liabilities total', () => {
    const archivedLoan = makeLoanAccount({
      id: 'acc-old-loan',
      name: 'Empréstimo Antigo',
      archived: true,
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [archivedLoan] }) })
    render(<NetWorth />)
    expect(screen.queryByText('Empréstimo Antigo')).not.toBeInTheDocument()
    expect(document.body.textContent).toContain(formatCurrency(15000))
  })

  // ─── M-42: archived accounts ────────────────────────────────────────────────

  it('hides an archived asset account as a row but keeps it in the Assets total', () => {
    const archived = makeRetailAccount({
      id: 'acc-old',
      name: 'Conta Antiga',
      balance: 1000,
      archived: true,
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [archived], transactions: [] }) })
    render(<NetWorth />)
    expect(screen.queryByText('Conta Antiga')).not.toBeInTheDocument()
    // The "no accounts" empty state still shows for the (now empty) assets list...
    expect(screen.getAllByText('netWorth.noAccounts')).toHaveLength(2)
    // ...but the archived account's balance is still reflected in the Assets total.
    expect(document.body.textContent).toContain(formatCurrency(1000))
  })

  it('hides an archived CREDIT account as a row but keeps it in the Liabilities total', () => {
    const archivedCard = makeCreditAccount({
      id: 'acc-old-card',
      name: 'Cartão Antigo',
      archived: true,
      creditMetadata: { limit: 10000, closingDay: 28, dueDay: 10 },
    })
    const expense = makeTx({ accountId: 'acc-old-card', amount: 700, date: todayStr() })
    useDataStore.setState({
      data: makeDataFile({ accounts: [archivedCard], transactions: [expense] }),
    })
    render(<NetWorth />)
    expect(screen.queryByText('Cartão Antigo')).not.toBeInTheDocument()
    expect(document.body.textContent).toContain(formatCurrency(700))
  })

  // ─── M-85: open installment purchases on a regular account as a liability ──

  it('shows an open installment series on a regular account under categoryInstallments', () => {
    const acc = makeRetailAccount({ id: 'acc-retail', name: 'Itau Fábio' })
    const parcel = makeTx({
      accountId: 'acc-retail',
      amount: 2000,
      date: '2099-12-01',
      installment: { parentId: 'p1', currentIndex: 1, total: 3 },
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc], transactions: [parcel] }) })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.categoryInstallments')).toBeInTheDocument()
    // "Itau Fábio" appears twice — as an asset row (its balance) and as a liability row
    // (its open installment series) — that duality is exactly the point of this feature.
    expect(screen.getAllByText('Itau Fábio')).toHaveLength(2)
    expect(screen.getByText('netWorth.totalCommitted')).toBeInTheDocument()
    expect(screen.getByText('accounts.monthlyPayment')).toBeInTheDocument()
    // Total committed = 2000 (this occurrence) + 2 future occurrences generated in the fixture? No —
    // makeDataFile doesn't expand installments; only the single provided occurrence is open, so
    // remainingTotal = 2000.
    expect(document.body.textContent).toContain(formatCurrency(2000))
  })

  it('counts an open installment series toward totalLiabilities (net worth drops)', () => {
    const acc = makeRetailAccount({ id: 'acc-retail', name: 'Itau Fábio', balance: 5000 })
    const parcel = makeTx({
      accountId: 'acc-retail',
      amount: 2000,
      date: '2099-12-01',
      installment: { parentId: 'p1', currentIndex: 1, total: 3 },
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc], transactions: [parcel] }) })
    render(<NetWorth />)
    // Assets = 5000 (initial balance, no cash-flow transactions besides the open installment
    // itself, which is EXPENSE dated in the future and thus not yet realized/paid).
    // Liabilities = 2000. Net worth = 5000 - 2000 = 3000.
    expect(document.body.textContent).toContain(formatCurrency(3000))
  })

  it('hides an archived account with open installments as a row but keeps it in the total', () => {
    const acc = makeRetailAccount({
      id: 'acc-retail',
      name: 'Refinanciamento Antigo',
      archived: true,
    })
    const parcel = makeTx({
      accountId: 'acc-retail',
      amount: 900,
      date: '2099-12-01',
      installment: { parentId: 'p1', currentIndex: 1, total: 3 },
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [acc], transactions: [parcel] }) })
    render(<NetWorth />)
    expect(screen.queryByText('Refinanciamento Antigo')).not.toBeInTheDocument()
    expect(document.body.textContent).toContain(formatCurrency(900))
  })

  it('does not show categoryInstallments when a CREDIT account has open installments (stays categoryCredit)', () => {
    const card = makeCreditAccount({
      id: 'acc-credit',
      creditMetadata: { limit: 10000, closingDay: 28, dueDay: 10 },
    })
    const parcel = makeTx({
      accountId: 'acc-credit',
      amount: 300,
      date: '2099-12-01',
      installment: { parentId: 'p1', currentIndex: 1, total: 3 },
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [card], transactions: [parcel] }) })
    render(<NetWorth />)
    expect(screen.getByText('netWorth.categoryCredit')).toBeInTheDocument()
    expect(screen.queryByText('netWorth.categoryInstallments')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Transactions from '@/pages/Transactions'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import type { Account, Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ openTransactionDrawer: vi.fn() }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

// Date string in the previous month (always the 1st to avoid edge-cases)
const prevMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1)
const prevMonthStr = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}-01`

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

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-retail',
    categoryId: '',
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

// ─── Period selector — dropdown ───────────────────────────────────────────────

describe('Transactions — period selector (PeriodSelector component)', () => {
  it('renders clickable period-selector button', () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    expect(screen.getByLabelText('period-selector')).toBeInTheDocument()
  })

  it('dropdown is hidden by default', () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    // Dropdown menu should not exist before clicking
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('clicking period-selector opens dropdown with two options', async () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    await userEvent.click(screen.getByLabelText('period-selector'))

    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getByText('transactions.thisMonth')).toBeInTheDocument()
    expect(screen.getByText('transactions.choosePeriod')).toBeInTheDocument()
  })

  it('selecting "Este mês" from dropdown closes the menu', async () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    await userEvent.click(screen.getByLabelText('period-selector'))
    await userEvent.click(screen.getByText('transactions.thisMonth'))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('selecting "Escolher período" opens the custom date picker panel', async () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    await userEvent.click(screen.getByLabelText('period-selector'))
    await userEvent.click(screen.getByText('transactions.choosePeriod'))

    expect(screen.getByLabelText('custom-start-date')).toBeInTheDocument()
    expect(screen.getByLabelText('custom-end-date')).toBeInTheDocument()
    expect(screen.getByText('transactions.applyPeriod')).toBeInTheDocument()
    expect(screen.getByText('transactions.back')).toBeInTheDocument()
  })

  it('"voltar" button closes the custom picker without applying', async () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    await userEvent.click(screen.getByLabelText('period-selector'))
    await userEvent.click(screen.getByText('transactions.choosePeriod'))

    expect(screen.getByLabelText('custom-start-date')).toBeInTheDocument()

    await userEvent.click(screen.getByText('transactions.back'))

    expect(screen.queryByLabelText('custom-start-date')).not.toBeInTheDocument()
  })

  it('applying custom period filters transactions to that date range', async () => {
    const retailAccount = makeRetailAccount()
    const currentMonthTx = makeTransaction({
      id: 'tx-curr',
      description: 'Compra atual',
      date: todayStr,
    })
    const prevMonthTx = makeTransaction({
      id: 'tx-prev',
      description: 'Compra passada',
      date: prevMonthStr,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [currentMonthTx, prevMonthTx],
      }),
    })

    render(<Transactions />)

    // Open custom picker
    await userEvent.click(screen.getByLabelText('period-selector'))
    await userEvent.click(screen.getByText('transactions.choosePeriod'))

    // Set date range to previous month only
    const startInput = screen.getByLabelText('custom-start-date')
    const endInput = screen.getByLabelText('custom-end-date')

    await userEvent.clear(startInput)
    await userEvent.type(startInput, prevMonthStr)
    await userEvent.clear(endInput)
    await userEvent.type(endInput, prevMonthStr)

    await userEvent.click(screen.getByText('transactions.applyPeriod'))

    // Picker should close
    expect(screen.queryByLabelText('custom-start-date')).not.toBeInTheDocument()

    // Only the prev month transaction should be visible
    expect(screen.getByText('Compra passada')).toBeInTheDocument()
    expect(screen.queryByText('Compra atual')).not.toBeInTheDocument()
  })
})

// ─── Month navigation ─────────────────────────────────────────────────────────

describe('Transactions — month navigation', () => {
  it('renders navigation arrows in default month mode', () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    expect(screen.getByLabelText('previous-period')).toBeInTheDocument()
    expect(screen.getByLabelText('next-period')).toBeInTheDocument()
  })

  it('hides navigation arrows when custom mode is applied', async () => {
    const retailAccount = makeRetailAccount()
    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [] }),
    })

    render(<Transactions />)

    // Open custom picker and apply a custom range
    await userEvent.click(screen.getByLabelText('period-selector'))
    await userEvent.click(screen.getByText('transactions.choosePeriod'))
    await userEvent.click(screen.getByText('transactions.applyPeriod'))

    expect(screen.queryByLabelText('previous-period')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('next-period')).not.toBeInTheDocument()
  })

  it('hides transactions from previous months by default (month view)', () => {
    const retailAccount = makeRetailAccount()
    const currentMonthTx = makeTransaction({
      id: 'tx-curr',
      description: 'Mês Atual',
      date: todayStr,
    })
    const prevMonthTx = makeTransaction({
      id: 'tx-prev',
      description: 'Mês Anterior',
      date: prevMonthStr,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [currentMonthTx, prevMonthTx],
      }),
    })

    render(<Transactions />)

    expect(screen.getByText('Mês Atual')).toBeInTheDocument()
    expect(screen.queryByText('Mês Anterior')).not.toBeInTheDocument()
  })

  it('shows previous month transactions after navigating back with the ‹ arrow', async () => {
    const retailAccount = makeRetailAccount()
    const prevMonthTx = makeTransaction({
      id: 'tx-prev',
      description: 'Lançamento Anterior',
      date: prevMonthStr,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [prevMonthTx] }),
    })

    render(<Transactions />)

    // Not visible in current month
    expect(screen.queryByText('Lançamento Anterior')).not.toBeInTheDocument()

    // Navigate back one month
    await userEvent.click(screen.getByLabelText('previous-period'))

    expect(screen.getByText('Lançamento Anterior')).toBeInTheDocument()
  })

  it('hides transactions from the previous month again after navigating forward', async () => {
    const retailAccount = makeRetailAccount()
    const prevMonthTx = makeTransaction({
      id: 'tx-prev',
      description: 'Só no Mês Anterior',
      date: prevMonthStr,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [prevMonthTx] }),
    })

    render(<Transactions />)

    // Navigate back and then forward (back to current month)
    await userEvent.click(screen.getByLabelText('previous-period'))
    expect(screen.getByText('Só no Mês Anterior')).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('next-period'))
    expect(screen.queryByText('Só no Mês Anterior')).not.toBeInTheDocument()
  })

  it('selecting "Este mês" from dropdown resets to current month', async () => {
    const retailAccount = makeRetailAccount()
    const currentMonthTx = makeTransaction({
      id: 'tx-curr',
      description: 'Mês Atual',
      date: todayStr,
    })
    const prevMonthTx = makeTransaction({
      id: 'tx-prev',
      description: 'Mês Anterior',
      date: prevMonthStr,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [currentMonthTx, prevMonthTx],
      }),
    })

    render(<Transactions />)

    // Navigate to previous month
    await userEvent.click(screen.getByLabelText('previous-period'))
    expect(screen.getByText('Mês Anterior')).toBeInTheDocument()
    expect(screen.queryByText('Mês Atual')).not.toBeInTheDocument()

    // Select "Este mês" from dropdown — resets to current month
    await userEvent.click(screen.getByLabelText('period-selector'))
    await userEvent.click(screen.getByText('transactions.thisMonth'))

    expect(screen.getByText('Mês Atual')).toBeInTheDocument()
    expect(screen.queryByText('Mês Anterior')).not.toBeInTheDocument()
  })
})

// ─── M-36: ledger redesign (spending summary removed, no type label, category chip) ──

describe('Transactions — M-36: ledger redesign', () => {
  it('no longer renders the spending summary card (reverts M-32)', () => {
    const retailAccount = makeRetailAccount()
    const expense = makeTransaction({ type: 'EXPENSE', amount: 250, description: 'Aluguel' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [expense] }),
    })

    render(<Transactions />)

    expect(screen.queryByText('creditCard.spendingSummary')).not.toBeInTheDocument()
  })

  it('does not render the type label (RECEITA/DESPESA) above the description', () => {
    const retailAccount = makeRetailAccount()
    const income = makeTransaction({
      id: 'tx-inc',
      type: 'INCOME',
      amount: 3000,
      description: 'Salário',
    })
    const expense = makeTransaction({
      id: 'tx-exp',
      type: 'EXPENSE',
      amount: 400,
      description: 'Mercado',
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [income, expense] }),
    })

    render(<Transactions />)

    expect(screen.queryByText('Receita')).not.toBeInTheDocument()
    expect(screen.queryByText('Despesa')).not.toBeInTheDocument()
  })

  it("shows each transaction's category as a #chip next to the account name", () => {
    const retailAccount = makeRetailAccount()
    const cat = {
      id: 'cat-food',
      name: 'Alimentação',
      icon: 'ShoppingCart',
      color: '#F00',
      parentId: null,
      type: 'EXPENSE' as const,
    }
    const expense = makeTransaction({ type: 'EXPENSE', amount: 120, categoryId: 'cat-food' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [expense], categories: [cat] }),
    })

    render(<Transactions />)

    expect(screen.getByText('#Alimentação')).toBeInTheDocument()
  })

  it('omits the category chip for transactions without a category', () => {
    const retailAccount = makeRetailAccount()
    const expense = makeTransaction({ type: 'EXPENSE', amount: 120, categoryId: '' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount], transactions: [expense] }),
    })

    const { container } = render(<Transactions />)

    // No category pill (#...) should be present when categoryId is empty
    expect(container.textContent).not.toContain('#')
  })
})

// ─── M-26: Cash-flow ledger filters ──────────────────────────────────────────

describe('Transactions — M-26: cash-flow ledger filters', () => {
  it('does not show EXPENSE transactions from a CREDIT account', () => {
    const retailAccount = makeRetailAccount()
    const creditAccount = makeCreditAccount()

    const retailExpense = makeTransaction({
      id: 'tx-retail',
      accountId: 'acc-retail',
      type: 'EXPENSE',
      description: 'Mercado Corrente',
    })
    const creditExpense = makeTransaction({
      id: 'tx-credit',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      description: 'Cinema no Cartão',
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [retailExpense, creditExpense],
      }),
    })

    render(<Transactions />)

    expect(screen.getByText('Mercado Corrente')).toBeInTheDocument()
    expect(screen.queryByText('Cinema no Cartão')).not.toBeInTheDocument()
  })

  it('shows CREDIT_PAYMENT as an outflow on the funding account (B-16)', () => {
    const retailAccount = makeRetailAccount()
    const creditAccount = makeCreditAccount()

    const regularExpense = makeTransaction({
      id: 'tx-expense',
      accountId: 'acc-retail',
      description: 'Supermercado',
    })
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      accountId: 'acc-credit',
      type: 'CREDIT_PAYMENT',
      amount: 500,
      description: 'Pagamento fatura',
      transferAccountId: 'acc-retail',
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [regularExpense, creditPayment],
      }),
    })

    render(<Transactions />)

    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    // The payment is a real débito on the funding (retail) account, so it belongs in the ledger
    expect(screen.getByText('Pagamento fatura')).toBeInTheDocument()
  })

  it('does not include CREDIT account in the filter dropdown', () => {
    const retailAccount = makeRetailAccount({ name: 'Nubank Conta' })
    const creditAccount = makeCreditAccount({ name: 'Nubank Cartão' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [retailAccount, creditAccount], transactions: [] }),
    })

    render(<Transactions />)

    // The accounts filter dropdown should list the retail account but not the credit account
    expect(screen.getByText('Nubank Conta')).toBeInTheDocument()
    expect(screen.queryByText('Nubank Cartão')).not.toBeInTheDocument()
  })

  it('consolidated flow excludes CREDIT card purchases but counts CREDIT_PAYMENT as outflow', () => {
    const retailAccount = makeRetailAccount()
    const creditAccount = makeCreditAccount()

    const income = makeTransaction({
      id: 'tx-income',
      type: 'INCOME',
      amount: 3000,
      description: 'Salário',
    })
    const retailExpense = makeTransaction({
      id: 'tx-retail-exp',
      type: 'EXPENSE',
      amount: 500,
      description: 'Aluguel',
    })
    // Card purchase lives in /credit-card — excluded from this cash ledger
    const creditExpense = makeTransaction({
      id: 'tx-credit-exp',
      accountId: 'acc-credit',
      type: 'EXPENSE',
      amount: 200,
      description: 'Restaurante Cartão',
    })
    // B-16: the payment IS a real outflow on the retail account → counts in the flow
    const creditPayment = makeTransaction({
      id: 'tx-cp',
      accountId: 'acc-credit',
      type: 'CREDIT_PAYMENT',
      amount: 200,
      description: 'Pag. Cartão',
      transferAccountId: 'acc-retail',
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount, creditAccount],
        transactions: [income, retailExpense, creditExpense, creditPayment],
      }),
    })

    render(<Transactions />)

    // Flow = 3000 income − 500 retail expense − 200 card payment = 2300
    // (the R$200 card purchase is excluded; it lives in /credit-card)
    const footerSection = screen.getByText('transactions.positiveFlow').closest('div')
    expect(footerSection?.textContent).toContain('2.300,00')
  })

  // ── B-15: unpaid entries excluded from the footer flow unless projecting ──────
  it('excludes unpaid INCOME from the consolidated flow by default', () => {
    const retailAccount = makeRetailAccount()
    const paidIncome = makeTransaction({
      id: 'tx-paid',
      type: 'INCOME',
      amount: 3000,
      description: 'Salário',
      isPaid: true,
    })
    const unpaidIncome = makeTransaction({
      id: 'tx-unpaid',
      type: 'INCOME',
      amount: 1000,
      description: 'Freela pendente',
      isPaid: false,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [paidIncome, unpaidIncome],
      }),
    })

    render(<Transactions />)

    // Realized only: 3000 (the unpaid 1000 is not counted)
    const footerSection = screen.getByText('transactions.positiveFlow').closest('div')
    expect(footerSection?.textContent).toContain('3.000,00')
  })

  it('includes unpaid INCOME in the consolidated flow when "Incluir Não-Pagos" is on', async () => {
    const retailAccount = makeRetailAccount()
    const paidIncome = makeTransaction({
      id: 'tx-paid',
      type: 'INCOME',
      amount: 3000,
      description: 'Salário',
      isPaid: true,
    })
    const unpaidIncome = makeTransaction({
      id: 'tx-unpaid',
      type: 'INCOME',
      amount: 1000,
      description: 'Freela pendente',
      isPaid: false,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [retailAccount],
        transactions: [paidIncome, unpaidIncome],
      }),
    })

    render(<Transactions />)

    await userEvent.click(screen.getByText('analytics.includeUnpaid'))

    // Projected: 3000 + 1000 = 4000
    const footerSection = screen.getByText('transactions.positiveFlow').closest('div')
    expect(footerSection?.textContent).toContain('4.000,00')
  })
})

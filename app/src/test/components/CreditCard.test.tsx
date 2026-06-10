import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CreditCardPage from '@/pages/CreditCard'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile, makeCreditAccount } from '@/test/fixtures/dataFile'
import { getInvoicePeriod, invoicePeriodKey } from '@/lib/utils'
import type { Account, Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ accountId: 'acc-credit' }),
  useOutletContext: () => ({ openTransactionDrawer: vi.fn() }),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const today = new Date()
const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

function makeCreditAccountFixed(overrides: Partial<Account> = {}): Account {
  return makeCreditAccount({ id: 'acc-credit', ...overrides })
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

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-credit',
    categoryId: '',
    amount: 100,
    type: 'EXPENSE',
    date: todayStr,
    description: 'Compra teste',
    isPaid: false,
    tags: [],
    ...overrides,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useDataStore.setState({ data: null })
  mockNavigate.mockReset()
})

// ─── M-31: Spending summary in right column ───────────────────────────────────

describe('CreditCardPage — M-31: spending summary in right column', () => {
  it('renders the spending summary when there are invoice transactions', () => {
    const creditAccount = makeCreditAccountFixed()
    const expense = makeTransaction({ amount: 200, description: 'Restaurante' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [expense] }),
    })

    render(<CreditCardPage />)

    expect(screen.getByText('creditCard.spendingSummary')).toBeInTheDocument()
    expect(screen.getByText('common.total')).toBeInTheDocument()
  })

  it('does not render the spending summary when there are no invoice transactions', () => {
    const creditAccount = makeCreditAccountFixed()

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<CreditCardPage />)

    expect(screen.queryByText('creditCard.spendingSummary')).not.toBeInTheDocument()
  })

  it('shows category breakdown in spending summary', () => {
    const creditAccount = makeCreditAccountFixed()
    const cat = {
      id: 'cat-food',
      name: 'Alimentação',
      icon: 'ShoppingCart',
      color: '#F00',
      parentId: null,
      type: 'EXPENSE' as const,
    }
    const expense = makeTransaction({ amount: 150, categoryId: 'cat-food' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [expense], categories: [cat] }),
    })

    render(<CreditCardPage />)

    // Category name appears in the spending summary breakdown
    expect(screen.getAllByText('Alimentação').length).toBeGreaterThan(0)
  })

  it('shows invoice total in spending summary', () => {
    const creditAccount = makeCreditAccountFixed()
    const expense1 = makeTransaction({ id: 'tx-1', amount: 100, description: 'Compra 1' })
    const expense2 = makeTransaction({ id: 'tx-2', amount: 200, description: 'Compra 2' })

    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [expense1, expense2] }),
    })

    render(<CreditCardPage />)

    // Invoice total (300) should appear in the spending summary total row
    const totalRow = screen.getByText('common.total').closest('div')
    expect(totalRow?.textContent).toContain('300,00')
  })
})

// ─── M-30: PayInvoiceModal ────────────────────────────────────────────────────

describe('CreditCardPage — M-30: PayInvoiceModal', () => {
  it('renders the "Pagar Agora" button', () => {
    const creditAccount = makeCreditAccountFixed()
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<CreditCardPage />)

    expect(screen.getByText('creditCard.payNow')).toBeInTheDocument()
  })

  it('opens PayInvoiceModal when "Pagar Agora" is clicked', () => {
    const creditAccount = makeCreditAccountFixed()
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<CreditCardPage />)

    // Modal should not be visible before click
    expect(screen.queryByText('creditCard.payInvoice')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('creditCard.payNow'))

    // Modal title and confirm button appear
    expect(screen.getAllByText('creditCard.payInvoice').length).toBeGreaterThanOrEqual(1)
  })

  it('shows the reference month label in the modal', () => {
    const creditAccount = makeCreditAccountFixed()
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<CreditCardPage />)
    fireEvent.click(screen.getByText('creditCard.payNow'))

    // Reference month label key is rendered in the modal
    expect(screen.getByText('creditCard.referenceMonth')).toBeInTheDocument()
    // A "Month YYYY" string is rendered (exact value depends on today's date vs closingDay)
    expect(screen.getAllByText(new RegExp(String(today.getFullYear()))).length).toBeGreaterThan(0)
  })

  it('only lists non-CREDIT accounts in the Conta selector', () => {
    const creditAccount = makeCreditAccountFixed()
    const retailAccount = makeRetailAccount({ name: 'NuConta' })
    const anotherCredit = makeCreditAccount({ id: 'acc-credit-2', name: 'Outro Cartão' })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [creditAccount, retailAccount, anotherCredit],
        transactions: [],
      }),
    })

    render(<CreditCardPage />)
    fireEvent.click(screen.getByText('creditCard.payNow'))

    // Retail account appears as an option
    expect(screen.getByText('NuConta')).toBeInTheDocument()
    // The other credit card does NOT appear in the payment account selector
    expect(screen.queryByText('Outro Cartão')).not.toBeInTheDocument()
  })

  it('closes the modal when backdrop is clicked', () => {
    const creditAccount = makeCreditAccountFixed()
    useDataStore.setState({
      data: makeDataFile({ accounts: [creditAccount], transactions: [] }),
    })

    render(<CreditCardPage />)
    fireEvent.click(screen.getByText('creditCard.payNow'))
    expect(screen.getAllByText('creditCard.payInvoice').length).toBeGreaterThanOrEqual(1)

    // Click the X close button
    fireEvent.click(screen.getByLabelText('common.close'))
    expect(screen.queryByText('creditCard.referenceMonth')).not.toBeInTheDocument()
  })

  it('calls addTransaction with CREDIT_PAYMENT when confirming payment', () => {
    const creditAccount = makeCreditAccountFixed()
    const retailAccount = makeRetailAccount()

    // Inject a known invoice total (one EXPENSE on the credit account for this period)
    const expense = makeTransaction({ amount: 500 })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [creditAccount, retailAccount],
        transactions: [expense],
      }),
    })

    const addTransactionSpy = vi.spyOn(useDataStore.getState(), 'addTransaction')

    render(<CreditCardPage />)
    fireEvent.click(screen.getByText('creditCard.payNow'))

    // Click the confirm button (same text as modal title)
    const confirmButtons = screen.getAllByText('creditCard.payInvoice')
    // The button is the last element with this text (title + button)
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(addTransactionSpy).toHaveBeenCalledOnce()
    const call = addTransactionSpy.mock.calls[0][0]
    expect(call.type).toBe('CREDIT_PAYMENT')
    expect(call.accountId).toBe('acc-credit')
    expect(call.transferAccountId).toBe('acc-retail')
    expect(call.isPaid).toBe(true)
  })
})

// ─── CC-32: move a charge between invoices (B-18) ─────────────────────────────

describe('CreditCardPage — CC-32: move charge to an adjacent invoice', () => {
  const closing = makeCreditAccountFixed().creditMetadata!.closingDay
  const periodKey = invoicePeriodKey(getInvoicePeriod(todayStr, closing))

  it('sets referenceMonth to the next period when clicking "next invoice"', () => {
    const base = getInvoicePeriod(todayStr, closing)
    let month = base.month + 1
    let year = base.year
    if (month > 12) {
      month = 1
      year += 1
    }
    const expectedKey = invoicePeriodKey({ year, month })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [makeCreditAccountFixed()],
        transactions: [makeTransaction({ id: 'c1', amount: 200 })],
      }),
    })

    const updateSpy = vi.spyOn(useDataStore.getState(), 'updateTransaction')
    render(<CreditCardPage />)

    fireEvent.click(screen.getByLabelText('creditCard.moveToNextInvoice'))

    expect(updateSpy).toHaveBeenCalledOnce()
    expect(updateSpy.mock.calls[0][0].id).toBe('c1')
    expect(updateSpy.mock.calls[0][0].referenceMonth).toBe(expectedKey)
  })

  it('does not render move buttons for a CREDIT_PAYMENT row', () => {
    const payment = makeTransaction({
      id: 'p1',
      type: 'CREDIT_PAYMENT',
      amount: 300,
      transferAccountId: 'acc-retail',
      referenceMonth: periodKey,
    })

    useDataStore.setState({
      data: makeDataFile({
        accounts: [makeCreditAccountFixed(), makeRetailAccount()],
        transactions: [payment],
      }),
    })

    render(<CreditCardPage />)

    expect(screen.queryByLabelText('creditCard.moveToNextInvoice')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('creditCard.moveToPrevInvoice')).not.toBeInTheDocument()
  })
})

// ─── Option 2: estornos (bug A) and payment-to-period binding (bug B) ──────────

describe('CreditCardPage — Option 2: credits and invoice payment cycle', () => {
  const periodKey = invoicePeriodKey(
    getInvoicePeriod(todayStr, makeCreditAccountFixed().creditMetadata!.closingDay)
  )

  it('shows a credit (estorno) and subtracts it from the invoice total', () => {
    const account = makeCreditAccountFixed()
    const charge = makeTransaction({ id: 'c1', amount: 200, description: 'Compra' })
    const credit = makeTransaction({
      id: 'r1',
      type: 'INCOME',
      amount: 50,
      description: 'Estorno Loja X',
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [charge, credit] }),
    })

    render(<CreditCardPage />)

    // Estorno row is listed and the net invoice total (200 − 50) shows up
    expect(screen.getByText('Estorno Loja X')).toBeInTheDocument()
    expect(screen.getAllByText(/150,00/).length).toBeGreaterThanOrEqual(1)
  })

  it('binds the payment to the displayed period via referenceMonth', () => {
    const account = makeCreditAccountFixed()
    const retail = makeRetailAccount()

    useDataStore.setState({
      data: makeDataFile({
        accounts: [account, retail],
        transactions: [makeTransaction({ amount: 500 })],
      }),
    })

    const addTransactionSpy = vi.spyOn(useDataStore.getState(), 'addTransaction')
    render(<CreditCardPage />)
    fireEvent.click(screen.getByText('creditCard.payNow'))
    const confirmButtons = screen.getAllByText('creditCard.payInvoice')
    fireEvent.click(confirmButtons[confirmButtons.length - 1])

    expect(addTransactionSpy).toHaveBeenCalledOnce()
    expect(addTransactionSpy.mock.calls[0][0].referenceMonth).toBe(periodKey)
  })

  it('marks the invoice as paid once a matching payment covers it', () => {
    const account = makeCreditAccountFixed()
    const retail = makeRetailAccount()
    const charge = makeTransaction({ amount: 500 })
    const payment = makeTransaction({
      id: 'pay-1',
      type: 'CREDIT_PAYMENT',
      amount: 500,
      transferAccountId: 'acc-retail',
      referenceMonth: periodKey,
    })

    useDataStore.setState({
      data: makeDataFile({ accounts: [account, retail], transactions: [charge, payment] }),
    })

    render(<CreditCardPage />)

    expect(screen.getByText('creditCard.statusPaid')).toBeInTheDocument()
    expect(screen.getByText(/creditCard\.paid/)).toBeInTheDocument()
    // Pay button is disabled when the invoice is fully settled
    expect(screen.getByText('creditCard.payNow').closest('button')).toBeDisabled()
  })
})

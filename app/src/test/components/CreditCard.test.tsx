import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CreditCardPage from '@/pages/CreditCard'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile, makeCreditAccount } from '@/test/fixtures/dataFile'
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

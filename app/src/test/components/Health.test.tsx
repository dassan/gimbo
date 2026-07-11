import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import Health from '@/pages/Health'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  makeDataFile,
  makeCreditAccount,
  makeLoanAccount,
  makeReserveAccount,
} from '@/test/fixtures/dataFile'
import { createDefaultWorkspace } from '@/lib/storage/schema'
import { formatCurrency, todayStr } from '@/lib/utils'
import type { Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'pt-BR' } }),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeIncomeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: crypto.randomUUID(),
    accountId: 'acc-retail',
    categoryId: 'cat-income',
    amount: 5000,
    type: 'INCOME',
    date: '2026-01-15',
    description: 'Salário',
    isPaid: true,
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

describe('Health page', () => {
  it('renders nothing when data is null', () => {
    const { container } = render(<Health />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the three summary cards', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Health />)
    expect(screen.getByText('health.budgetTitle')).toBeInTheDocument()
    expect(screen.getByText('health.emergencyTitle')).toBeInTheDocument()
    expect(screen.getByText('health.totalDebt')).toBeInTheDocument()
  })

  it('shows the manual entry CTA when there is no income history and no override', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Health />)
    expect(screen.getByText('health.setIncomeCta')).toBeInTheDocument()
  })

  it('shows "based on N months" once 3+ months of qualified income exist', () => {
    const account = {
      id: 'acc-retail',
      name: 'Conta',
      type: 'RETAIL' as const,
      balance: 0,
      includeInBalance: true,
    }
    // Last 3 complete calendar months before today (the current month is excluded by deriveMonthlyIncome).
    const today = new Date()
    const txs = [1, 2, 3].map((monthsAgo) => {
      const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 10)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`
      return makeIncomeTx({ date, amount: 4000 + monthsAgo * 100 })
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [account], transactions: txs }) })
    render(<Health />)
    expect(screen.getByText('health.basedOnMonths')).toBeInTheDocument()
  })

  // ─── HE-09 follow-up: configurable income lookback window ──────────────────

  it('respects a custom workspace.incomeWindowMonths=3, excluding data from the 4th month back', () => {
    const account = {
      id: 'acc-retail',
      name: 'Conta',
      type: 'RETAIL' as const,
      balance: 0,
      includeInBalance: true,
    }
    const today = new Date()
    function monthsAgoDate(monthsAgo: number) {
      const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 10)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`
    }
    const withinWindow = makeIncomeTx({ date: monthsAgoDate(2), amount: 5000 })
    const outsideWindow = makeIncomeTx({ date: monthsAgoDate(4), amount: 99999 })

    useWorkspaceStore.setState({
      workspace: { ...createDefaultWorkspace(), incomeWindowMonths: 3 },
    })
    useDataStore.setState({
      data: makeDataFile({ accounts: [account], transactions: [withinWindow, outsideWindow] }),
    })
    render(<Health />)

    expect(document.body.textContent).toContain(formatCurrency(5000))
    expect(document.body.textContent).not.toContain(formatCurrency(99999))
  })

  it('respects a custom workspace.incomeWindowMonths=12, including data from the 7th month back', () => {
    const account = {
      id: 'acc-retail',
      name: 'Conta',
      type: 'RETAIL' as const,
      balance: 0,
      includeInBalance: true,
    }
    const today = new Date()
    const d = new Date(today.getFullYear(), today.getMonth() - 7, 10)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`
    const tx = makeIncomeTx({ date, amount: 6000 })

    useWorkspaceStore.setState({
      workspace: { ...createDefaultWorkspace(), incomeWindowMonths: 12 },
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [account], transactions: [tx] }) })
    render(<Health />)

    expect(document.body.textContent).toContain(formatCurrency(6000))
  })

  it('shows the user override and lets the user revert it via "recalculate"', () => {
    useDataStore.setState({ data: makeDataFile() })
    useWorkspaceStore.setState({
      workspace: { ...createDefaultWorkspace(), monthlyIncomeOverride: 9000 },
    })
    render(<Health />)
    expect(document.body.textContent).toContain(formatCurrency(9000))
    expect(screen.getByText('health.confirmedByYou')).toBeInTheDocument()

    fireEvent.click(screen.getByText('health.recalculate'))
    expect(useWorkspaceStore.getState().workspace.monthlyIncomeOverride).toBeUndefined()
  })

  it('confirming the income input persists the override', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Health />)

    fireEvent.click(screen.getByLabelText('health.adjust'))
    const input = screen.getByPlaceholderText('health.incomePlaceholder')
    fireEvent.change(input, { target: { value: '8500' } })
    fireEvent.click(screen.getByLabelText('common.save'))

    expect(useWorkspaceStore.getState().workspace.monthlyIncomeOverride).toBe(8500)
  })

  it('shows the empty state when there is no open debt', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Health />)
    expect(screen.getByText('health.noDebt')).toBeInTheDocument()
  })

  it('renders a CREDIT account with an open installment as an expandable debt card', () => {
    const card = makeCreditAccount({ id: 'acc-credit', name: 'Nubank Platinum' })
    const today = todayStr()
    const [tx1, tx2] = [
      {
        id: 'i-1',
        accountId: 'acc-credit',
        categoryId: 'cat-1',
        amount: 420,
        type: 'EXPENSE' as const,
        date: today,
        description: 'Notebook Dell (4/10)',
        isPaid: false,
        tags: [],
        installment: { parentId: 'p1', currentIndex: 4, total: 10 },
      },
      {
        id: 'i-2',
        accountId: 'acc-credit',
        categoryId: 'cat-1',
        amount: 420,
        type: 'EXPENSE' as const,
        date: today,
        description: 'Notebook Dell (5/10)',
        isPaid: false,
        tags: [],
        installment: { parentId: 'p1', currentIndex: 5, total: 10 },
      },
    ]
    useDataStore.setState({
      data: makeDataFile({ accounts: [card], transactions: [tx1, tx2] }),
    })
    render(<Health />)

    expect(screen.getByText('Nubank Platinum')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Nubank Platinum'))
    expect(screen.getByText('Notebook Dell')).toBeInTheDocument()
  })

  it('renders a LOAN account as a debt card with its loan item', () => {
    const loan = makeLoanAccount({ id: 'acc-loan', name: 'Empréstimo Pessoal' })
    useDataStore.setState({ data: makeDataFile({ accounts: [loan] }) })
    render(<Health />)

    expect(screen.getByText('Empréstimo Pessoal')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Empréstimo Pessoal'))
    expect(document.body.textContent).toContain(formatCurrency(15000))
  })

  // ─── HE-12/HE-13/HE-14: emergency reserve card wired to real engines ───────

  it('shows the manual entry CTA for monthly cost when there is no expense history', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Health />)
    expect(screen.getByText('health.setCostCta')).toBeInTheDocument()
  })

  it('sums the balance of accounts marked with reserveMetadata into the reserve card', () => {
    const reserveAccount = makeReserveAccount({ id: 'acc-reserve', balance: 12000 })
    const otherAccount = {
      id: 'acc-other',
      name: 'Conta comum',
      type: 'RETAIL' as const,
      balance: 5000,
      includeInBalance: true,
    }
    useDataStore.setState({
      data: makeDataFile({ accounts: [reserveAccount, otherAccount] }),
    })
    render(<Health />)
    expect(document.body.textContent).toContain(formatCurrency(12000))
  })

  it('shows "based on N months" for monthly cost once 3+ months of EXPENSE history exist', () => {
    const account = {
      id: 'acc-retail',
      name: 'Conta',
      type: 'RETAIL' as const,
      balance: 0,
      includeInBalance: true,
    }
    const today = new Date()
    const txs = [1, 2, 3].map((monthsAgo) => {
      const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, 10)
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-10`
      return makeIncomeTx({ id: crypto.randomUUID(), type: 'EXPENSE', date, amount: 1000 })
    })
    useDataStore.setState({ data: makeDataFile({ accounts: [account], transactions: txs }) })
    render(<Health />)
    expect(screen.getAllByText('health.basedOnMonths').length).toBeGreaterThan(0)
  })

  it('confirming the monthly cost input persists the override', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Health />)

    fireEvent.click(screen.getByLabelText('health.adjustCost'))
    const input = screen.getByPlaceholderText('health.incomePlaceholder')
    fireEvent.change(input, { target: { value: '3500' } })
    fireEvent.click(screen.getByLabelText('common.save'))

    expect(useWorkspaceStore.getState().workspace.monthlyCostOverride).toBe(3500)
  })

  // ─── HE-16: configurable reserve target (months multiplier) ────────────────

  it('uses workspace.reserveTargetMonths as the recommended-reserve multiplier (independent of the cost override)', () => {
    useDataStore.setState({ data: makeDataFile() })
    useWorkspaceStore.setState({
      workspace: {
        ...createDefaultWorkspace(),
        monthlyCostOverride: 1000,
        reserveTargetMonths: 3,
      },
    })
    render(<Health />)
    // recommended = reserveTargetMonths (3) × monthlyCost (1000) = 3000, not the default 6×.
    expect(document.body.textContent).toContain(formatCurrency(3000))
    expect(document.body.textContent).not.toContain(formatCurrency(6000))
  })

  it('recalculates the recommended reserve when only reserveTargetMonths changes (cost unchanged)', () => {
    useDataStore.setState({ data: makeDataFile() })
    useWorkspaceStore.setState({
      workspace: { ...createDefaultWorkspace(), monthlyCostOverride: 2000 },
    })
    const { rerender } = render(<Health />)
    expect(document.body.textContent).toContain(formatCurrency(12000)) // 6 × 2000 (default)

    act(() => {
      useWorkspaceStore.setState({
        workspace: {
          ...useWorkspaceStore.getState().workspace,
          reserveTargetMonths: 9,
        },
      })
    })
    rerender(<Health />)
    expect(document.body.textContent).toContain(formatCurrency(18000)) // 9 × 2000
  })
})

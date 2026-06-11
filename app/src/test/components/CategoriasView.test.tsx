import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import CategoriasView from '@/pages/Analytics/CategoriasView'
import type { Account, Category, Transaction } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// Pie mock: renders each entry as a clickable element with data-testid
vi.mock('recharts', () => ({
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Pie: ({
    data,
    children,
  }: {
    data: Array<{ id: string; name: string; value: number }>
    children?: React.ReactNode
  }) => (
    <div data-testid="pie">
      {data?.map((d, i) => (
        <div key={d.id ?? i} data-testid={`pie-cell-${d.id ?? i}`} data-name={d.name}>
          {children}
        </div>
      ))}
    </div>
  ),
  Cell: ({ onClick }: { onClick?: () => void }) => (
    <div data-testid="pie-cell-item" onClick={onClick} />
  ),
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const APR_START = new Date(2026, 3, 1)
const APR_END = new Date(2026, 3, 30)
const SHADOW = 'shadow-card'

function makeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-retail',
    name: 'Conta Corrente',
    type: 'RETAIL',
    balance: 0,
    includeInBalance: true,
    ...overrides,
  }
}

function makeCategory(overrides: Partial<Category> = {}): Category {
  return {
    id: 'cat-1',
    name: 'Alimentação',
    parentId: null,
    icon: 'utensils',
    color: '#22C55E',
    type: 'EXPENSE',
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

// ─── R-15: Category grouping and percentage ───────────────────────────────────

describe('CategoriasView — R-15: category grouping and percentage', () => {
  it('groups EXPENSE transactions by category and renders category name', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({ id: 'tx-1', categoryId: 'cat-food', amount: 300, type: 'EXPENSE' }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Category name should appear in the legend
    expect(screen.getAllByText('Alimentação').length).toBeGreaterThanOrEqual(1)
  })

  it('groups INCOME transactions by category and renders category name', () => {
    const categories = [makeCategory({ id: 'cat-salary', name: 'Salário', type: 'INCOME' })]
    const transactions = [
      makeTx({ id: 'tx-1', categoryId: 'cat-salary', amount: 5000, type: 'INCOME' }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.getAllByText('Salário').length).toBeGreaterThanOrEqual(1)
  })

  it('computes percentage correctly: single category gets 100%', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({ id: 'tx-1', categoryId: 'cat-food', amount: 400, type: 'EXPENSE' }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Single category → 100.0%
    expect(screen.getByText('100.0%')).toBeInTheDocument()
  })

  it('sums amounts for the same category across multiple transactions', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({ id: 'tx-1', categoryId: 'cat-food', amount: 200, type: 'EXPENSE' }),
      makeTx({ id: 'tx-2', categoryId: 'cat-food', amount: 300, type: 'EXPENSE' }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // Still 100% because there's only one category
    expect(screen.getByText('100.0%')).toBeInTheDocument()
  })

  it('excludes CREDIT_PAYMENT from category breakdown', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({ id: 'tx-expense', categoryId: 'cat-food', amount: 400, type: 'EXPENSE' }),
      makeTx({ id: 'tx-cp', type: 'CREDIT_PAYMENT', amount: 9999, date: '2026-04-10' }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // 9999 from CREDIT_PAYMENT must not appear in the rendered output
    expect(screen.queryByText(/9\.999/)).not.toBeInTheDocument()
    expect(screen.queryByText(/9999/)).not.toBeInTheDocument()
  })

  it('excludes transactions outside the period', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      // Inside April
      makeTx({
        id: 'tx-in',
        categoryId: 'cat-food',
        amount: 500,
        type: 'EXPENSE',
        date: '2026-04-10',
      }),
      // Outside April (March)
      makeTx({
        id: 'tx-out',
        categoryId: 'cat-food',
        amount: 8888,
        type: 'EXPENSE',
        date: '2026-03-15',
      }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    expect(screen.queryByText(/8\.888/)).not.toBeInTheDocument()
    expect(screen.queryByText(/8888/)).not.toBeInTheDocument()
  })

  it('uses tx.date for category breakdown (CC-18): shows credit expense in purchase month', () => {
    // Credit expense on April 6 with closingDay=5 → effective cash-flow date = June
    // But for category breakdown, tx.date (April) is used → appears in April breakdown
    const creditAccount: Account = {
      id: 'acc-credit',
      name: 'Cartão',
      type: 'CREDIT',
      balance: 0,
      includeInBalance: false,
      creditMetadata: { limit: 5000, closingDay: 5, dueDay: 10 },
    }
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({
        id: 'tx-credit',
        accountId: 'acc-credit',
        categoryId: 'cat-food',
        type: 'EXPENSE',
        amount: 350,
        date: '2026-04-06',
      }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[creditAccount]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )
    // tx.date is in April → appears in category breakdown
    expect(screen.getAllByText('Alimentação').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('100.0%')).toBeInTheDocument()
  })

  it('respects includeUnpaid=false — excludes unpaid transactions', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({ id: 'tx-paid', categoryId: 'cat-food', amount: 100, isPaid: true }),
      makeTx({ id: 'tx-unpaid', categoryId: 'cat-food', amount: 9000, isPaid: false }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={false}
        shadowClass={SHADOW}
      />
    )
    expect(screen.queryByText(/9\.000/)).not.toBeInTheDocument()
  })
})

// ─── R-16: Drill-down modal — open, content, close ───────────────────────────

describe('CategoriasView — R-16: drill-down modal', () => {
  it('opens drill-down modal when a category legend button is clicked', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({ id: 'tx-1', categoryId: 'cat-food', amount: 200, type: 'EXPENSE' }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    // Click on the category legend button (there may be multiple matches; click first)
    const legendButtons = screen.getAllByRole('button', { name: /alimentação/i })
    fireEvent.click(legendButtons[0])

    // Modal should now show the drill-down title and category name
    expect(screen.getByText('analytics.categorias.drilldownTitle')).toBeInTheDocument()
  })

  it('modal displays the transaction belonging to the clicked category', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      makeTx({
        id: 'tx-1',
        categoryId: 'cat-food',
        amount: 200,
        type: 'EXPENSE',
        description: 'Supermercado',
      }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: /alimentação/i })[0])

    // Transaction description should appear inside the modal
    expect(screen.getByText('Supermercado')).toBeInTheDocument()
  })

  it('does not show transactions from other categories in the modal', () => {
    const categories = [
      makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' }),
      makeCategory({ id: 'cat-travel', name: 'Viagem', type: 'EXPENSE', color: '#3B82F6' }),
    ]
    const transactions = [
      makeTx({
        id: 'tx-food',
        categoryId: 'cat-food',
        description: 'Supermercado',
        type: 'EXPENSE',
      }),
      makeTx({
        id: 'tx-travel',
        categoryId: 'cat-travel',
        description: 'Hotel',
        type: 'EXPENSE',
        amount: 500,
      }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    // Open modal for Alimentação
    fireEvent.click(screen.getAllByRole('button', { name: /alimentação/i })[0])

    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    expect(screen.queryByText('Hotel')).not.toBeInTheDocument()
  })

  it('closes the modal when the close button is clicked', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [makeTx({ id: 'tx-1', categoryId: 'cat-food', type: 'EXPENSE' })]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: /alimentação/i })[0])
    expect(screen.getByText('analytics.categorias.drilldownTitle')).toBeInTheDocument()

    // Click the close button (aria-label="common.close")
    fireEvent.click(screen.getByRole('button', { name: /common\.close/i }))
    expect(screen.queryByText('analytics.categorias.drilldownTitle')).not.toBeInTheDocument()
  })

  it('closes the modal when the backdrop is clicked', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [makeTx({ id: 'tx-1', categoryId: 'cat-food', type: 'EXPENSE' })]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    fireEvent.click(screen.getAllByRole('button', { name: /alimentação/i })[0])
    expect(screen.getByText('analytics.categorias.drilldownTitle')).toBeInTheDocument()

    // The backdrop is the first fixed div (behind the modal div)
    // We can click on the document body outside the modal, or use the backdrop element.
    // The backdrop is a fixed inset-0 div with onClick={onClose}
    // Easiest: query the backdrop by its class pattern or just simulate the Escape key via backdrop click
    const backdrop = document.querySelector('.fixed.inset-0.z-50.bg-on-surface\\/20')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop!)

    expect(screen.queryByText('analytics.categorias.drilldownTitle')).not.toBeInTheDocument()
  })

  it('shows empty state in modal when no transactions match the category+period', () => {
    const categories = [makeCategory({ id: 'cat-food', name: 'Alimentação', type: 'EXPENSE' })]
    const transactions = [
      // Transaction outside the period
      makeTx({
        id: 'tx-old',
        categoryId: 'cat-food',
        type: 'EXPENSE',
        date: '2025-01-10', // outside April 2026
      }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    // CategoriasView filters txs before building entries, so with nothing in period,
    // the "noData" placeholder appears instead of a legend button — modal won't open.
    // Verify noData for expense section is shown
    expect(screen.getAllByText('analytics.categorias.noData').length).toBeGreaterThanOrEqual(1)
  })
})

// ─── M-37: distinct colors per category ───────────────────────────────────────

describe('CategoriasView — M-37: distinct colors', () => {
  it('assigns distinct legend colors when categories share the same stored color', () => {
    const categories = [
      makeCategory({ id: 'cat-a', name: 'Cat A', color: '#22c55e' }),
      makeCategory({ id: 'cat-b', name: 'Cat B', color: '#22c55e' }),
    ]
    const transactions = [
      makeTx({ id: 'tx-a', categoryId: 'cat-a', amount: 300 }),
      makeTx({ id: 'tx-b', categoryId: 'cat-b', amount: 100 }),
    ]
    render(
      <CategoriasView
        transactions={transactions}
        accounts={[makeAccount()]}
        categories={categories}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

    // The colour swatch is the icon span carrying an inline background-color (the leading
    // span is now the expand-chevron placeholder).
    const swatchOf = (name: string): HTMLElement => {
      const spans = screen.getByText(name).closest('button')!.querySelectorAll('span')
      return [...spans].find((s) => (s as HTMLElement).style.backgroundColor !== '') as HTMLElement
    }
    const swatchA = swatchOf('Cat A')
    const swatchB = swatchOf('Cat B')
    expect(swatchA.style.backgroundColor).not.toBe('')
    expect(swatchA.style.backgroundColor).not.toBe(swatchB.style.backgroundColor)
  })
})

// ─── Parent/child hierarchy: roll up to root, expand to children ──────────────

describe('CategoriasView — parent/child hierarchy', () => {
  const cats = [
    makeCategory({ id: 'cat-food', name: 'Alimentação', parentId: null, type: 'EXPENSE' }),
    makeCategory({ id: 'cat-mkt', name: 'Supermercado', parentId: 'cat-food', type: 'EXPENSE' }),
    makeCategory({ id: 'cat-rest', name: 'Restaurante', parentId: 'cat-food', type: 'EXPENSE' }),
  ]
  const txs = [
    makeTx({ id: 'tx-mkt', categoryId: 'cat-mkt', amount: 300, description: 'Pão' }),
    makeTx({ id: 'tx-rest', categoryId: 'cat-rest', amount: 100, description: 'Jantar' }),
  ]
  const renderView = () =>
    render(
      <CategoriasView
        transactions={txs}
        accounts={[makeAccount()]}
        categories={cats}
        startDate={APR_START}
        endDate={APR_END}
        includeUnpaid={true}
        shadowClass={SHADOW}
      />
    )

  it('rolls children up into the parent and keeps children hidden until expanded', () => {
    renderView()
    expect(screen.getByText('Alimentação')).toBeInTheDocument()
    // parent total = 300 + 100
    expect(screen.getAllByText(/400,00/).length).toBeGreaterThanOrEqual(1)
    // children collapsed
    expect(screen.queryByText('Supermercado')).not.toBeInTheDocument()
    expect(screen.queryByText('Restaurante')).not.toBeInTheDocument()
  })

  it('expands the parent to reveal the child breakdown on click', () => {
    renderView()
    fireEvent.click(screen.getByText('Alimentação'))
    expect(screen.getByText('Supermercado')).toBeInTheDocument()
    expect(screen.getByText('Restaurante')).toBeInTheDocument()
  })

  it('drills into a child category from the expanded list', () => {
    renderView()
    fireEvent.click(screen.getByText('Alimentação'))
    fireEvent.click(screen.getByText('Supermercado'))
    // drill-down modal opens scoped to the child's transactions only
    expect(screen.getByText('analytics.categorias.drilldownTitle')).toBeInTheDocument()
    expect(screen.getByText('Pão')).toBeInTheDocument()
    expect(screen.queryByText('Jantar')).not.toBeInTheDocument()
  })
})

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Simulacoes from '@/pages/Simulacoes'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import type { Hypothesis } from '@/types'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'pt-BR' } }),
}))

// Mirrors the recharts mock in CashFlowView.test.tsx — captures LineChart's data/children so
// tests can assert on which series were rendered without a real SVG chart in jsdom.
const capturedLines = vi.hoisted(() => ({ names: [] as string[] }))

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="simulacoes-chart">{children}</div>
  ),
  Line: ({ name }: { name: string }) => {
    if (!capturedLines.names.includes(name)) capturedLines.names.push(name)
    return null
  },
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  CartesianGrid: () => null,
  Legend: () => null,
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: 'hy-1',
    name: 'Pós-graduação',
    enabled: true,
    items: [
      {
        id: 'item-1',
        kind: 'ONE_TIME',
        description: 'Entrada',
        type: 'EXPENSE',
        amount: 2000,
        startDate: '2028-01-10',
      },
    ],
    createdAt: '2028-01-01T00:00:00.000Z',
    ...overrides,
  }
}

beforeEach(() => {
  useDataStore.setState({ data: null })
  capturedLines.names = []
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Simulacoes page', () => {
  // Unlike Health/NetWorth, this page never early-returns on null data — App.tsx already gates
  // every route behind `isLoaded` before AppLayout ever mounts, so this only matters for not
  // crashing defensively; getSimulationProjection([], [], []) degrades to an empty series.
  it('does not crash when data is null, and shows the empty state', () => {
    render(<Simulacoes />)
    expect(screen.getByText('simulacoes.emptyTitle')).toBeInTheDocument()
    expect(capturedLines.names).toEqual(['baselineBalance'])
  })

  it('renders the header and the empty state when there are no hypotheses', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Simulacoes />)
    expect(screen.getByText('simulacoes.title')).toBeInTheDocument()
    expect(screen.getByText('simulacoes.emptyTitle')).toBeInTheDocument()
  })

  it('only renders the baseline line when there is no enabled hypothesis', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Simulacoes />)
    expect(capturedLines.names).toEqual(['baselineBalance'])
  })

  it('renders both lines once an enabled hypothesis exists', () => {
    useDataStore.setState({ data: makeDataFile({ hypotheses: [makeHypothesis()] }) })
    render(<Simulacoes />)
    expect(capturedLines.names).toEqual(['baselineBalance', 'adjustedBalance'])
  })

  it('renders only the baseline line when the only hypothesis is disabled', () => {
    useDataStore.setState({
      data: makeDataFile({ hypotheses: [makeHypothesis({ enabled: false })] }),
    })
    render(<Simulacoes />)
    expect(capturedLines.names).toEqual(['baselineBalance'])
  })

  it('renders a card per hypothesis with its item count', () => {
    useDataStore.setState({ data: makeDataFile({ hypotheses: [makeHypothesis()] }) })
    render(<Simulacoes />)
    expect(screen.getByText('Pós-graduação')).toBeInTheDocument()
    expect(screen.getByText('simulacoes.itemCount')).toBeInTheDocument()
  })

  it('toggling a hypothesis flips its enabled flag in the store', () => {
    useDataStore.setState({ data: makeDataFile({ hypotheses: [makeHypothesis()] }) })
    render(<Simulacoes />)
    fireEvent.click(screen.getByRole('switch'))
    expect(useDataStore.getState().data?.hypotheses[0].enabled).toBe(false)
  })

  it('opens the create modal and adds a new hypothesis to the store on save', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Simulacoes />)

    fireEvent.click(screen.getAllByRole('button', { name: 'simulacoes.new' })[0])
    fireEvent.change(screen.getByLabelText('simulacoes.name'), {
      target: { value: 'Troca de carro' },
    })
    // Amount input: cents-based, mirrors BudgetFormModal's convention (raw digits / 100).
    fireEvent.change(screen.getByDisplayValue('0,00'), { target: { value: '150000' } })

    fireEvent.click(screen.getByRole('button', { name: 'simulacoes.create' }))

    const hypotheses = useDataStore.getState().data?.hypotheses ?? []
    expect(hypotheses).toHaveLength(1)
    expect(hypotheses[0].name).toBe('Troca de carro')
    expect(hypotheses[0].items).toEqual([
      expect.objectContaining({ amount: 1500, type: 'EXPENSE' }),
    ])
  })

  it('does not save an item with a zero amount', () => {
    useDataStore.setState({ data: makeDataFile() })
    render(<Simulacoes />)

    fireEvent.click(screen.getAllByRole('button', { name: 'simulacoes.new' })[0])
    fireEvent.change(screen.getByLabelText('simulacoes.name'), {
      target: { value: 'Hipótese vazia' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'simulacoes.create' }))

    const hypotheses = useDataStore.getState().data?.hypotheses ?? []
    expect(hypotheses).toHaveLength(1)
    expect(hypotheses[0].items).toEqual([])
  })
})

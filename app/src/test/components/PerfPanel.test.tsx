import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PerfPanel from '@/components/PerfPanel'
import { clearBuffer, trackPerformance } from '@/lib/telemetry'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('recharts', () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

Object.assign(navigator, { clipboard: { writeText: vi.fn() } })

beforeEach(() => {
  clearBuffer()
})

describe('PerfPanel', () => {
  it('shows an empty state with no events', () => {
    render(<PerfPanel onClose={vi.fn()} />)
    expect(screen.getByText(/nenhum evento ainda/i)).toBeInTheDocument()
  })

  it('aggregates count/avg/max per metric', () => {
    trackPerformance('store.mutate.clone', 10)
    trackPerformance('store.mutate.clone', 20)
    trackPerformance('worker.replaceAll', 5)

    render(<PerfPanel onClose={vi.fn()} />)

    expect(screen.getAllByText('store.mutate.clone').length).toBeGreaterThan(0)
    expect(screen.getAllByText('worker.replaceAll').length).toBeGreaterThan(0)
    // store.mutate.clone: n=2, avg=15.0, max=20.0
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('15.0')).toBeInTheDocument()
    expect(screen.getAllByText('20.0').length).toBeGreaterThan(0)
  })

  it('clears the buffer when the clear button is clicked', async () => {
    trackPerformance('store.mutate.clone', 10)
    render(<PerfPanel onClose={vi.fn()} />)
    expect(screen.getAllByText('store.mutate.clone').length).toBeGreaterThan(0)

    await userEvent.click(screen.getByRole('button', { name: 'clear' }))

    expect(screen.getByText(/nenhum evento ainda/i)).toBeInTheDocument()
  })

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn()
    render(<PerfPanel onClose={onClose} />)

    await userEvent.click(screen.getByRole('button', { name: 'close' }))

    expect(onClose).toHaveBeenCalledOnce()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import PeriodSelector from '@/components/PeriodSelector'
import type { PeriodValue } from '@/components/PeriodSelector'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

// ─── Fixed system time ────────────────────────────────────────────────────────

// 2026-04-15 → default period label should contain "Abril 2026" (pt-BR)
// Using en-US in jsdom, so the label will depend on the environment.
// We test behavior (onChange calls), not the exact label text.
const FIXED_NOW = new Date('2026-04-15')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function monthValue(offset = 0): PeriodValue {
  return { mode: 'month', monthOffset: offset }
}

// ─── R-16: Month navigation arrows ───────────────────────────────────────────

describe('PeriodSelector — R-16: month navigation arrows', () => {
  it('previous arrow calls onChange with monthOffset decremented by 1', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={monthValue(0)} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /previous-period/i }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'month', monthOffset: -1 })
  })

  it('next arrow calls onChange with monthOffset incremented by 1', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={monthValue(0)} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /next-period/i }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'month', monthOffset: 1 })
  })

  it('arrows navigate from a non-zero offset correctly', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={monthValue(-3)} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /next-period/i }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'month', monthOffset: -2 })

    fireEvent.click(screen.getByRole('button', { name: /previous-period/i }))
    expect(onChange).toHaveBeenCalledWith({ mode: 'month', monthOffset: -4 })
  })

  it('does not render navigation arrows in custom mode', () => {
    render(
      <PeriodSelector
        value={{
          mode: 'custom',
          monthOffset: 0,
          customStart: '2026-01-01',
          customEnd: '2026-03-31',
        }}
        onChange={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: /previous-period/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /next-period/i })).not.toBeInTheDocument()
  })
})

// ─── R-16: Dropdown opening ───────────────────────────────────────────────────

describe('PeriodSelector — R-16: dropdown', () => {
  it('clicking the period label opens the dropdown menu', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)

    // Dropdown menu not visible initially
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))

    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('clicking the period label again toggles the dropdown closed', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)

    const selector = screen.getByRole('button', { name: /period-selector/i })
    fireEvent.click(selector) // open
    expect(screen.getByRole('menu')).toBeInTheDocument()

    fireEvent.click(selector) // close
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('dropdown contains "Este Mês" (transactions.thisMonth) option', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))

    expect(screen.getByRole('menuitem', { name: 'transactions.thisMonth' })).toBeInTheDocument()
  })

  it('dropdown contains "Personalizado" (transactions.choosePeriod) option', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))

    expect(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' })).toBeInTheDocument()
  })

  it('clicking "Este Mês" calls onChange with mode: month and offset 0', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={monthValue(-2)} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.thisMonth' }))

    expect(onChange).toHaveBeenCalledWith({ mode: 'month', monthOffset: 0 })
  })

  it('clicking "Este Mês" closes the dropdown', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.thisMonth' }))

    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

// ─── R-16: Custom date range picker ──────────────────────────────────────────

describe('PeriodSelector — R-16: custom range picker', () => {
  it('clicking "Personalizado" opens the custom date picker', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))

    // Custom picker has start-date and end-date inputs
    expect(screen.getByLabelText('custom-start-date')).toBeInTheDocument()
    expect(screen.getByLabelText('custom-end-date')).toBeInTheDocument()
  })

  it('applying the custom range calls onChange with mode: custom', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={monthValue(0)} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))

    // Set start and end dates
    fireEvent.change(screen.getByLabelText('custom-start-date'), {
      target: { value: '2026-01-01' },
    })
    fireEvent.change(screen.getByLabelText('custom-end-date'), {
      target: { value: '2026-03-31' },
    })

    // Click the "apply" button (transactions.applyPeriod)
    fireEvent.click(screen.getByText('transactions.applyPeriod'))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'custom',
        customStart: '2026-01-01',
        customEnd: '2026-03-31',
      })
    )
  })

  it('applying the custom range closes the picker', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))

    fireEvent.change(screen.getByLabelText('custom-start-date'), {
      target: { value: '2026-01-01' },
    })
    fireEvent.change(screen.getByLabelText('custom-end-date'), {
      target: { value: '2026-03-31' },
    })
    fireEvent.click(screen.getByText('transactions.applyPeriod'))

    // Picker closed — input fields no longer visible
    expect(screen.queryByLabelText('custom-start-date')).not.toBeInTheDocument()
  })

  it('"Voltar" button in custom picker closes the picker without calling onChange', () => {
    const onChange = vi.fn()
    render(<PeriodSelector value={monthValue(0)} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))

    fireEvent.click(screen.getByText('transactions.back'))

    expect(screen.queryByLabelText('custom-start-date')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('clicking outside the component closes the dropdown', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    expect(screen.getByRole('menu')).toBeInTheDocument()

    // Simulate a mousedown event on the document body (outside the component)
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })
})

// ─── M-45: saved custom periods ──────────────────────────────────────────────

describe('PeriodSelector — M-45: saved custom periods', () => {
  function openCustomPicker(onSavePeriod = vi.fn(), onDeletePeriod = vi.fn(), savedPeriods = []) {
    const onChange = vi.fn()
    render(
      <PeriodSelector
        value={monthValue(0)}
        onChange={onChange}
        savedPeriods={savedPeriods}
        onSavePeriod={onSavePeriod}
        onDeletePeriod={onDeletePeriod}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))
    return { onChange }
  }

  it('does not show the "save period" UI when onSavePeriod is not provided', () => {
    render(<PeriodSelector value={monthValue(0)} onChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'transactions.choosePeriod' }))

    expect(screen.queryByText('transactions.savePeriod')).not.toBeInTheDocument()
  })

  it('shows the name input and "save period" button when onSavePeriod is provided', () => {
    openCustomPicker()
    expect(screen.getByPlaceholderText('transactions.periodNamePlaceholder')).toBeInTheDocument()
    expect(screen.getByText('transactions.savePeriod')).toBeInTheDocument()
  })

  it('clicking "save period" calls onSavePeriod with the pending range and typed name', () => {
    const onSavePeriod = vi.fn()
    openCustomPicker(onSavePeriod)

    fireEvent.change(screen.getByLabelText('custom-start-date'), {
      target: { value: '2026-01-01' },
    })
    fireEvent.change(screen.getByLabelText('custom-end-date'), {
      target: { value: '2026-03-31' },
    })
    fireEvent.change(screen.getByPlaceholderText('transactions.periodNamePlaceholder'), {
      target: { value: 'Q1 2026' },
    })
    fireEvent.click(screen.getByText('transactions.savePeriod'))

    expect(onSavePeriod).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' })
    )
  })

  it('falls back to a date-range name when no name is typed', () => {
    const onSavePeriod = vi.fn()
    openCustomPicker(onSavePeriod)

    fireEvent.change(screen.getByLabelText('custom-start-date'), {
      target: { value: '2026-01-01' },
    })
    fireEvent.change(screen.getByLabelText('custom-end-date'), {
      target: { value: '2026-03-31' },
    })
    fireEvent.click(screen.getByText('transactions.savePeriod'))

    expect(onSavePeriod).toHaveBeenCalledWith(
      expect.objectContaining({ name: '2026-01-01 – 2026-03-31' })
    )
  })

  it('lists saved periods in the dropdown and applies one on click', () => {
    const onChange = vi.fn()
    render(
      <PeriodSelector
        value={monthValue(0)}
        onChange={onChange}
        savedPeriods={[{ id: 'p1', name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' }]}
        onSavePeriod={vi.fn()}
        onDeletePeriod={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))

    fireEvent.click(screen.getByRole('menuitem', { name: 'Q1 2026' }))

    expect(onChange).toHaveBeenCalledWith({
      mode: 'custom',
      monthOffset: 0,
      customStart: '2026-01-01',
      customEnd: '2026-03-31',
    })
  })

  it('clicking the trash icon on a saved period calls onDeletePeriod with its id', () => {
    const onDeletePeriod = vi.fn()
    render(
      <PeriodSelector
        value={monthValue(0)}
        onChange={vi.fn()}
        savedPeriods={[{ id: 'p1', name: 'Q1 2026', start: '2026-01-01', end: '2026-03-31' }]}
        onSavePeriod={vi.fn()}
        onDeletePeriod={onDeletePeriod}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /period-selector/i }))

    fireEvent.click(screen.getByRole('button', { name: 'transactions.deletePeriod' }))

    expect(onDeletePeriod).toHaveBeenCalledWith('p1')
  })
})

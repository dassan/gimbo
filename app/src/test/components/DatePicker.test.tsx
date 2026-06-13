import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import DatePicker from '@/components/DatePicker'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const FIXED_NOW = new Date('2026-06-15T12:00:00')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

const CLASS_NAME = 'w-full rounded-xl bg-surface-container-low py-3 px-4 text-sm'

describe('DatePicker — M-47', () => {
  it('renders the native input with the given value and aria-label', () => {
    const onChange = vi.fn()
    render(
      <DatePicker
        value="2026-06-10"
        onChange={onChange}
        className={CLASS_NAME}
        ariaLabel="my-date"
      />
    )

    const input = screen.getByLabelText<HTMLInputElement>('my-date')
    expect(input.type).toBe('date')
    expect(input.value).toBe('2026-06-10')
  })

  it('calls onChange when the native input changes (mobile path)', () => {
    const onChange = vi.fn()
    render(
      <DatePicker
        value="2026-06-10"
        onChange={onChange}
        className={CLASS_NAME}
        ariaLabel="my-date"
      />
    )

    fireEvent.change(screen.getByLabelText('my-date'), { target: { value: '2026-06-20' } })
    expect(onChange).toHaveBeenCalledWith('2026-06-20')
  })

  it('desktop trigger shows the formatted date and opens the calendar popup', () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-06-10" onChange={onChange} className={CLASS_NAME} />)

    expect(screen.getByText('10/06/2026')).toBeInTheDocument()

    fireEvent.click(screen.getByText('10/06/2026'))
    expect(screen.getByText('Junho de 2026')).toBeInTheDocument()
  })

  it('selecting a day calls onChange with the new date and closes the popup', () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-06-10" onChange={onChange} className={CLASS_NAME} />)

    fireEvent.click(screen.getByText('10/06/2026'))
    fireEvent.click(screen.getByRole('button', { name: '20' }))

    expect(onChange).toHaveBeenCalledWith('2026-06-20')
    expect(screen.queryByText('Junho de 2026')).not.toBeInTheDocument()
  })

  it('navigates between months', () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-06-10" onChange={onChange} className={CLASS_NAME} />)

    fireEvent.click(screen.getByText('10/06/2026'))
    fireEvent.click(screen.getByRole('button', { name: 'next-month' }))
    expect(screen.getByText('Julho de 2026')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'previous-month' }))
    fireEvent.click(screen.getByRole('button', { name: 'previous-month' }))
    expect(screen.getByText('Maio de 2026')).toBeInTheDocument()
  })

  it('disables days before the min date', () => {
    const onChange = vi.fn()
    render(
      <DatePicker value="2026-06-10" onChange={onChange} min="2026-06-10" className={CLASS_NAME} />
    )

    fireEvent.click(screen.getByText('10/06/2026'))
    expect(screen.getByRole('button', { name: '9' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '10' })).not.toBeDisabled()
  })

  it('"Hoje" button selects today and closes the popup', () => {
    const onChange = vi.fn()
    render(<DatePicker value="2026-06-10" onChange={onChange} className={CLASS_NAME} />)

    fireEvent.click(screen.getByText('10/06/2026'))
    fireEvent.click(screen.getByText('transactions.today'))

    expect(onChange).toHaveBeenCalledWith('2026-06-15')
    expect(screen.queryByText('Junho de 2026')).not.toBeInTheDocument()
  })

  it('closes the popup on click outside', () => {
    const onChange = vi.fn()
    render(
      <div>
        <DatePicker value="2026-06-10" onChange={onChange} className={CLASS_NAME} />
        <button>outside</button>
      </div>
    )

    fireEvent.click(screen.getByText('10/06/2026'))
    expect(screen.getByText('Junho de 2026')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByText('Junho de 2026')).not.toBeInTheDocument()
  })
})

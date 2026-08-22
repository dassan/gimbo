import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Select from '@/components/Select'

const OPTIONS = [
  { value: 'a', label: 'Conta A' },
  { value: 'b', label: 'Conta B' },
  { value: 'c', label: 'Cartão X' },
]

const CLASS_NAME = 'rounded-xl bg-surface-container-low py-3 px-4 text-sm'

function mockMobileViewport() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Select — desktop (default jsdom viewport)', () => {
  it('renders a native select with the given options and value', () => {
    const onChange = vi.fn()
    render(
      <Select
        value="b"
        onChange={onChange}
        options={OPTIONS}
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    const select = screen.getByRole('combobox', { name: 'conta' })
    expect(select).toHaveDisplayValue('Conta B')
  })

  it('calls onChange when a native option is selected', async () => {
    const onChange = vi.fn()
    render(
      <Select
        value="a"
        onChange={onChange}
        options={OPTIONS}
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'conta' }), 'c')
    expect(onChange).toHaveBeenCalledWith('c')
  })

  it('shows a placeholder option when there are no options', () => {
    render(
      <Select value="" onChange={vi.fn()} options={[]} placeholder="Nada" className={CLASS_NAME} />
    )
    expect(screen.getByRole('combobox')).toHaveDisplayValue('Nada')
  })
})

describe('Select — mobile bottom sheet (dassan/ui-adjustments)', () => {
  it('renders a themed trigger button instead of the native select', () => {
    mockMobileViewport()
    render(
      <Select
        value="b"
        onChange={vi.fn()}
        options={OPTIONS}
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    const trigger = screen.getByRole('button', { name: 'conta' })
    expect(trigger).toHaveTextContent('Conta B')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('shows the placeholder when nothing is selected', () => {
    mockMobileViewport()
    render(
      <Select
        value=""
        onChange={vi.fn()}
        options={OPTIONS}
        placeholder="Escolha"
        className={CLASS_NAME}
      />
    )
    expect(screen.getByRole('button')).toHaveTextContent('Escolha')
  })

  it('opens a bottom sheet listing every option on tap', () => {
    mockMobileViewport()
    render(
      <Select
        value="a"
        onChange={vi.fn()}
        options={OPTIONS}
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'conta' }))
    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('selecting an option calls onChange and closes the sheet', () => {
    mockMobileViewport()
    const onChange = vi.fn()
    render(
      <Select
        value="a"
        onChange={onChange}
        options={OPTIONS}
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'conta' }))
    fireEvent.click(screen.getByRole('option', { name: 'Cartão X' }))

    expect(onChange).toHaveBeenCalledWith('c')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('tapping the backdrop closes the sheet without calling onChange', () => {
    mockMobileViewport()
    const onChange = vi.fn()
    const { container } = render(
      <Select
        value="a"
        onChange={onChange}
        options={OPTIONS}
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'conta' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    const backdrop = container.querySelector('.fixed.inset-0.z-40')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes the sheet on click outside', () => {
    mockMobileViewport()
    render(
      <div>
        <Select
          value="a"
          onChange={vi.fn()}
          options={OPTIONS}
          className={CLASS_NAME}
          ariaLabel="conta"
        />
        <button>outside</button>
      </div>
    )

    fireEvent.click(screen.getByRole('button', { name: 'conta' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('shows a placeholder message in the sheet when there are no options', () => {
    mockMobileViewport()
    render(
      <Select
        value=""
        onChange={vi.fn()}
        options={[]}
        placeholder="Nada"
        className={CLASS_NAME}
        ariaLabel="conta"
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'conta' }))
    expect(within(screen.getByRole('listbox')).getByText('Nada')).toBeInTheDocument()
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })
})

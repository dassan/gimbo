import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CategorySelect from '@/components/CategorySelect'
import type { Category } from '@/types'

// dassan/categorias-reestilizadas: CategorySelect replaces the old native <select> (labels like
// "— Delivery" to mark a subcategory) with a custom combobox — icon+color badge on root
// categories, plain indentation (no dash/bullet) on children, plus search. These tests mirror
// Select.test.tsx's desktop/mobile split.

const CATEGORIES: Category[] = [
  {
    id: 'root-a',
    parentId: null,
    name: 'Alimentação',
    icon: 'utensils',
    color: '#FF0000',
    type: 'EXPENSE',
  },
  {
    id: 'child-a1',
    parentId: 'root-a',
    name: 'Delivery',
    icon: 'tag',
    color: '#FF0000',
    type: 'EXPENSE',
  },
  {
    id: 'root-b',
    parentId: null,
    name: 'Transporte',
    icon: 'car',
    color: '#00FF00',
    type: 'EXPENSE',
  },
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

describe('CategorySelect — desktop (default jsdom viewport)', () => {
  it('shows the placeholder when nothing is selected', () => {
    render(
      <CategorySelect
        value=""
        onChange={vi.fn()}
        categories={CATEGORIES}
        placeholder="Categoria"
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    expect(screen.getByRole('button', { name: 'Categoria' })).toHaveTextContent('Categoria')
  })

  it('shows the selected category name', () => {
    render(
      <CategorySelect
        value="root-b"
        onChange={vi.fn()}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    expect(screen.getByRole('button', { name: 'Categoria' })).toHaveTextContent('Transporte')
  })

  it('opens the dropdown listing every category — icon badge on roots, plain indent on children', () => {
    render(
      <CategorySelect
        value=""
        onChange={vi.fn()}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getAllByRole('option')).toHaveLength(3)

    const rootOption = within(listbox).getByRole('option', { name: 'Alimentação' })
    expect(rootOption.querySelector('svg')).not.toBeNull()
    expect(rootOption.className).toMatch(/pl-2\.5/)

    const childOption = within(listbox).getByRole('option', { name: 'Delivery' })
    expect(childOption.querySelector('svg')).toBeNull()
    // pl-11 (44px) lines up with the root's text start: pl-2.5 (10px) + icon (24px) + gap-2.5 (10px).
    expect(childOption.className).toMatch(/pl-11/)
  })

  it('filters by search text, keeping the parent visible for context when only a child matches', async () => {
    render(
      <CategorySelect
        value=""
        onChange={vi.fn()}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))

    await userEvent.type(screen.getByRole('textbox'), 'deliv')

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).getByRole('option', { name: 'Delivery' })).toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: 'Alimentação' })).toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: 'Transporte' })).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches the search', async () => {
    render(
      <CategorySelect
        value=""
        onChange={vi.fn()}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    await userEvent.type(screen.getByRole('textbox'), 'zzzz')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('selecting an option calls onChange and closes the dropdown', () => {
    const onChange = vi.fn()
    render(
      <CategorySelect
        value=""
        onChange={onChange}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    fireEvent.click(screen.getByRole('option', { name: 'Transporte' }))

    expect(onChange).toHaveBeenCalledWith('root-b')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('ArrowDown + Enter from the search input selects the active option', () => {
    const onChange = vi.fn()
    render(
      <CategorySelect
        value=""
        onChange={onChange}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    const search = screen.getByRole('textbox')
    // Sorted order: Alimentação, Delivery, Transporte — three ArrowDowns land on Transporte.
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    fireEvent.keyDown(search, { key: 'Enter' })

    expect(onChange).toHaveBeenCalledWith('root-b')
  })

  it('Escape closes the dropdown without calling onChange', () => {
    const onChange = vi.fn()
    render(
      <CategorySelect
        value=""
        onChange={onChange}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('closes on click outside', () => {
    render(
      <div>
        <CategorySelect
          value=""
          onChange={vi.fn()}
          categories={CATEGORIES}
          className={CLASS_NAME}
          ariaLabel="Categoria"
        />
        <button>outside</button>
      </div>
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    fireEvent.mouseDown(screen.getByText('outside'))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('CategorySelect — mobile bottom sheet', () => {
  it('renders a themed trigger button instead of a native select', () => {
    mockMobileViewport()
    render(
      <CategorySelect
        value="root-b"
        onChange={vi.fn()}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    const trigger = screen.getByRole('button', { name: 'Categoria' })
    expect(trigger).toHaveTextContent('Transporte')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('opens a bottom sheet listing every category on tap', () => {
    mockMobileViewport()
    render(
      <CategorySelect
        value=""
        onChange={vi.fn()}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(3)
  })

  it('selecting a category in the sheet calls onChange and closes it', () => {
    mockMobileViewport()
    const onChange = vi.fn()
    render(
      <CategorySelect
        value=""
        onChange={onChange}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    fireEvent.click(screen.getByRole('option', { name: 'Delivery' }))

    expect(onChange).toHaveBeenCalledWith('child-a1')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('tapping the backdrop closes the sheet without calling onChange', () => {
    mockMobileViewport()
    const onChange = vi.fn()
    const { container } = render(
      <CategorySelect
        value=""
        onChange={onChange}
        categories={CATEGORIES}
        className={CLASS_NAME}
        ariaLabel="Categoria"
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Categoria' }))
    expect(screen.getByRole('listbox')).toBeInTheDocument()

    const backdrop = container.querySelector('.fixed.inset-0.z-40')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })
})

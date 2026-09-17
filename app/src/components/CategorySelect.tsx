import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search } from 'lucide-react'
import { cn, sortCategoriesHierarchical } from '@/lib/utils'
import { CategoryIcon } from '@/lib/categoryIcons'
import { useIsMobile } from '@/hooks/useIsMobile'
import MobileSheet from '@/components/MobileSheet'
import type { Category } from '@/types'

// Categorias — reestilização (dassan/categorias-reestilizadas): substitui o antigo `<select>`
// nativo (labels tipo "— Delivery" para indicar subcategoria) por um combobox dedicado que
// mostra o ícone/cor da categoria-raiz (mesmo badge que Settings/Analytics já usam) e recua as
// filhas sem bullet nem traço, seguindo o padrão do Organizze. Nativo não dava — nenhum browser
// estiliza o conteúdo de um <option>, então mostrar ícone força um dropdown custom em vez do
// <select> que o Select.tsx genérico usa no desktop.

export interface CategorySelectProps {
  categories: Category[]
  value: string
  onChange: (id: string) => void
  ariaLabel?: string
  placeholder?: string
  className: string
}

function normalize(s: string): string {
  return s.trim().toLowerCase()
}

function filterCategories(sorted: Category[], query: string): Category[] {
  const q = normalize(query)
  if (!q) return sorted
  const matchedIds = new Set(sorted.filter((c) => normalize(c.name).includes(q)).map((c) => c.id))
  const parentIdsToKeep = new Set(
    sorted.filter((c) => c.parentId && matchedIds.has(c.id)).map((c) => c.parentId as string)
  )
  return sorted.filter((c) => matchedIds.has(c.id) || parentIdsToKeep.has(c.id))
}

export default function CategorySelect({
  categories,
  value,
  onChange,
  ariaLabel,
  placeholder,
  className,
}: CategorySelectProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const sorted = useMemo(() => sortCategoriesHierarchical(categories), [categories])
  const filtered = useMemo(() => filterCategories(sorted, query), [sorted, query])
  const selected = sorted.find((c) => c.id === value)

  function openMenu() {
    setQuery('')
    setActiveIndex(-1)
    setOpen(true)
  }

  function closeMenu() {
    setOpen(false)
  }

  // Focusing the search input is a side effect on an external system (the DOM), unlike
  // resetting query/activeIndex — those are reset synchronously in openMenu() above instead of
  // here, since setState-in-effect triggers an avoidable extra render.
  useEffect(() => {
    if (open && !isMobile) searchInputRef.current?.focus()
  }, [open, isMobile])

  useEffect(() => {
    if (!open || isMobile) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        closeMenu()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, isMobile])

  function handleSelect(id: string) {
    onChange(id)
    closeMenu()
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % Math.max(filtered.length, 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (activeIndex >= 0 && filtered[activeIndex]) handleSelect(filtered[activeIndex].id)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeMenu()
    }
  }

  const list = (
    <div role="listbox" aria-label={ariaLabel}>
      {filtered.map((c, i) => (
        <button
          key={c.id}
          type="button"
          role="option"
          aria-selected={c.id === value}
          onClick={() => handleSelect(c.id)}
          onMouseEnter={() => setActiveIndex(i)}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition-colors',
            c.parentId && 'pl-9',
            c.id === value
              ? 'bg-primary/10 text-primary font-semibold'
              : i === activeIndex
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface hover:bg-surface-container-high'
          )}
        >
          {!c.parentId && (
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
              style={{ backgroundColor: c.color }}
            >
              <CategoryIcon name={c.icon} size={14} />
            </span>
          )}
          <span className="truncate">{c.name}</span>
        </button>
      ))}
      {filtered.length === 0 && (
        <p className="px-3 py-4 text-center text-sm text-on-surface/40">{t('common.noData')}</p>
      )}
    </div>
  )

  const searchInput = (
    <div className="relative">
      <Search
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
      />
      <input
        ref={searchInputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setActiveIndex(-1)
        }}
        onKeyDown={handleSearchKeyDown}
        placeholder={t('transactions.categorySearchPlaceholder')}
        className="w-full rounded-lg bg-surface-container-low pl-8 pr-3 py-2 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
      />
    </div>
  )

  if (isMobile) {
    return (
      <div className="relative">
        <button
          type="button"
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => (open ? closeMenu() : openMenu())}
          className={cn(className, 'w-full flex items-center justify-between gap-2 text-left')}
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected && !selected.parentId && (
              <span
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white"
                style={{ backgroundColor: selected.color }}
              >
                <CategoryIcon name={selected.icon} size={12} />
              </span>
            )}
            <span className={cn('truncate', !selected && 'text-on-surface/40')}>
              {selected ? selected.name : placeholder}
            </span>
          </span>
          <ChevronDown
            size={16}
            className={cn('shrink-0 text-on-surface/40 transition-transform', open && 'rotate-180')}
          />
        </button>

        <MobileSheet open={open} onClose={closeMenu} contentClassName="px-3 pb-2">
          <div className="sticky top-0 z-10 bg-surface-container-low pb-2">{searchInput}</div>
          {list}
        </MobileSheet>
      </div>
    )
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? closeMenu() : openMenu())}
        className={cn(className, 'w-full flex items-center justify-between gap-2 text-left')}
      >
        <span className="flex items-center gap-2 min-w-0">
          {selected && !selected.parentId && (
            <span
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-white"
              style={{ backgroundColor: selected.color }}
            >
              <CategoryIcon name={selected.icon} size={12} />
            </span>
          )}
          <span className={cn('truncate', !selected && 'text-on-surface/40')}>
            {selected ? selected.name : placeholder}
          </span>
        </span>
        <ChevronDown size={16} className="shrink-0 text-on-surface/40" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-xl bg-surface-container-high border border-outline-variant shadow-ambient p-1.5">
          <div className="sticky top-0 z-10 bg-surface-container-high pb-1.5">{searchInput}</div>
          {list}
        </div>
      )}
    </div>
  )
}

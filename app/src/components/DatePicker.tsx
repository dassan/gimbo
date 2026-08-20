import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, parseDateLocal, todayStr } from '@/lib/utils'

// M-47: drop-in replacement for <input type="date">. Mobile keeps the native picker
// (input stays visible/interactive below `lg`); desktop overlays a custom calendar
// popup styled per design/DESIGN.md, since the native picker can't be themed.

export interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  className: string
  ariaLabel?: string
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function formatDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const firstDay = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells: (Date | null)[] = Array.from({ length: firstDay.getDay() }, () => null)
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(new Date(year, month, day))
  }
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

// Parses the same dd/mm/yyyy format displayValue renders, so typed text always round-trips
// with what's shown. Rejects overflow like 31/02 instead of letting Date roll it into March.
function parseTypedDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim())
  if (!match) return null
  const day = Number(match[1])
  const month = Number(match[2])
  const year = Number(match[3])
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return formatDateStr(date)
}

export default function DatePicker({
  value,
  onChange,
  min,
  max,
  className,
  ariaLabel,
}: DatePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const reference = value ? parseDateLocal(value) : new Date()
  const [viewYear, setViewYear] = useState(reference.getFullYear())
  const [viewMonth, setViewMonth] = useState(reference.getMonth())
  const containerRef = useRef<HTMLDivElement>(null)

  const displayValue = value ? parseDateLocal(value).toLocaleDateString('pt-BR') : ''
  // Manual typing (desktop): free text while focused so partial input like "01/0" isn't
  // clobbered by the canonical displayValue on every keystroke — the input shows this buffer
  // only while focused, falling back to the always-fresh displayValue otherwise.
  const [isFocused, setIsFocused] = useState(false)
  const [text, setText] = useState(displayValue)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  function handleFocus() {
    const ref = value ? parseDateLocal(value) : new Date()
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
    setText(displayValue)
    setIsFocused(true)
    setOpen(true)
  }

  function handleTextChange(next: string) {
    setText(next)
    const iso = parseTypedDate(next)
    if (!iso) return
    if ((min !== undefined && iso < min) || (max !== undefined && iso > max)) return
    onChange(iso)
    const d = parseDateLocal(iso)
    setViewYear(d.getFullYear())
    setViewMonth(d.getMonth())
  }

  function handleSelectDay(date: Date) {
    onChange(formatDateStr(date))
    setOpen(false)
  }

  function handleSelectToday() {
    const now = new Date()
    setViewYear(now.getFullYear())
    setViewMonth(now.getMonth())
    onChange(todayStr())
    setOpen(false)
  }

  function handlePrevMonth() {
    const ref = new Date(viewYear, viewMonth - 1, 1)
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
  }

  function handleNextMonth() {
    const ref = new Date(viewYear, viewMonth + 1, 1)
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
  }

  const monthLabel = (() => {
    const raw = new Date(viewYear, viewMonth, 1).toLocaleDateString('pt-BR', {
      month: 'long',
      year: 'numeric',
    })
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  })()

  const todayDateStr = todayStr()
  const todayDisabled =
    (min !== undefined && todayDateStr < min) || (max !== undefined && todayDateStr > max)

  return (
    <div className="relative flex-1" ref={containerRef}>
      <input
        type="date"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cn(className, 'w-full', 'lg:opacity-0 lg:pointer-events-none')}
      />
      {/* Desktop-only overlay: a real text input (types in the same dd/mm/yyyy format it
          displays) instead of a read-only button, so far-off dates don't require paging
          through the calendar month by month. Focusing it also opens the calendar below,
          keeping click-to-pick available side by side with typing. */}
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel ? `${ariaLabel} manual` : undefined}
        value={isFocused ? text : displayValue}
        placeholder="dd/mm/aaaa"
        onFocus={handleFocus}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => handleTextChange(e.target.value)}
        className={cn(className, 'hidden lg:absolute lg:inset-0 lg:block')}
      />

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-30 w-72 rounded-2xl bg-surface-container-high border border-outline-variant p-4"
          style={{ boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' }}
        >
          <div className="flex items-center justify-between mb-3">
            <button
              type="button"
              onClick={handlePrevMonth}
              aria-label="previous-month"
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
            >
              <ChevronLeft size={16} strokeWidth={1.5} className="text-on-surface/60" />
            </button>
            <span className="text-sm font-semibold text-on-surface">{monthLabel}</span>
            <button
              type="button"
              onClick={handleNextMonth}
              aria-label="next-month"
              className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
            >
              <ChevronRight size={16} strokeWidth={1.5} className="text-on-surface/60" />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-1">
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={i}
                className="flex h-8 items-center justify-center text-[10px] font-semibold uppercase text-on-surface/40"
              >
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {buildMonthGrid(viewYear, viewMonth).map((date, i) => {
              if (!date) return <div key={i} className="h-8 w-8" />
              const dateStr = formatDateStr(date)
              const isSelected = dateStr === value
              const isToday = dateStr === todayDateStr
              const isDisabled =
                (min !== undefined && dateStr < min) || (max !== undefined && dateStr > max)
              return (
                <button
                  key={i}
                  type="button"
                  disabled={isDisabled}
                  onClick={() => handleSelectDay(date)}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full text-sm transition-colors',
                    isSelected
                      ? 'bg-primary text-white font-semibold'
                      : isToday
                        ? 'ring-1 ring-primary/40 text-on-surface'
                        : 'text-on-surface hover:bg-surface-container-low',
                    isDisabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                  )}
                >
                  {date.getDate()}
                </button>
              )
            })}
          </div>

          <button
            type="button"
            onClick={handleSelectToday}
            disabled={todayDisabled}
            className="mt-3 w-full rounded-xl bg-surface-container-low py-2.5 text-sm font-semibold text-on-surface/70 transition-all hover:bg-surface-container active:scale-[0.97] disabled:opacity-40"
          >
            {t('transactions.today')}
          </button>
        </div>
      )}
    </div>
  )
}

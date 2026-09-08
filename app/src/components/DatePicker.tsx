import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn, parseDateLocal, todayStr } from '@/lib/utils'
import { useIsMobile } from '@/hooks/useIsMobile'
import MobileSheet from '@/components/MobileSheet'

// M-47: drop-in replacement for <input type="date">. Desktop overlays a custom calendar
// popup styled per design/DESIGN.md, since the native picker can't be themed.
// dassan/ui-adjustments: mobile used to fall back to the native picker (its OS chrome — dark
// theme, red/orange accent — clashed with the rest of the app). Mobile now gets the same
// calendar grid as desktop, presented as a bottom sheet instead of a below-field popover.

export interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  className: string
  ariaLabel?: string
}

const WEEKDAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// Walks up from `el` looking for the nearest ancestor that would actually clip an overflowing
// absolutely-positioned child (any overflow other than the default 'visible' on either axis) —
// that ancestor's box is the real boundary the popup shouldn't cross, whether or not the browser
// actually clips to it in practice (see the comment on openUpward/alignRight above). Falls back
// to the viewport when nothing constrains it, which is the correct boundary in that case.
function getClippingBounds(el: HTMLElement): {
  top: number
  bottom: number
  left: number
  right: number
} {
  let node = el.parentElement
  while (node) {
    const style = getComputedStyle(node)
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      return node.getBoundingClientRect()
    }
    node = node.parentElement
  }
  return { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight }
}

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
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  // dassan/ui-adjustments: the popup is `position: absolute` inside whatever scroll container
  // hosts this field — `overflow: hidden/auto` on that ancestor only clips it when the
  // ancestor's height is a definite value, not when it's `auto` (a real CSS quirk: an
  // auto-height box's clip region isn't reliably applied to out-of-flow descendants that extend
  // past it). A field near an edge of a short/narrow modal has no room on one side, so the
  // calendar spills out past the modal's rounded edge onto the backdrop instead of being
  // clipped. Flipping to the side that has room sidesteps the problem instead of depending on a
  // container that may or may not actually clip — on both axes: a field in the right column of a
  // 2-col grid has the same problem horizontally as a field near the bottom has vertically.
  const [openUpward, setOpenUpward] = useState(false)
  const [alignRight, setAlignRight] = useState(false)
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

  // Generous estimate of the calendar's own rendered box (height varies ~340-360px across month
  // lengths; width is the fixed w-72 below) plus margin — only used to decide a direction, never
  // for layout, so an approximate constant is fine.
  const CALENDAR_HEIGHT_ESTIMATE = 380
  const CALENDAR_WIDTH_ESTIMATE = 300

  function handleFocus() {
    const ref = value ? parseDateLocal(value) : new Date()
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
    setText(displayValue)
    setIsFocused(true)
    setOpen(true)
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()
      // The real constraint is whatever ancestor would visually bound this popup (typically a
      // modal card), not the viewport — a field can have plenty of room to the viewport's edge
      // while still overflowing a narrower/shorter card centered on the page.
      const bounds = getClippingBounds(containerRef.current)
      const spaceBelow = bounds.bottom - rect.bottom
      const spaceAbove = rect.top - bounds.top
      setOpenUpward(spaceBelow < CALENDAR_HEIGHT_ESTIMATE && spaceAbove > spaceBelow)
      const spaceRight = bounds.right - rect.left
      const spaceLeft = rect.right - bounds.left
      setAlignRight(spaceRight < CALENDAR_WIDTH_ESTIMATE && spaceLeft > spaceRight)
    }
  }

  function handleOpenMobile() {
    const ref = value ? parseDateLocal(value) : new Date()
    setViewYear(ref.getFullYear())
    setViewMonth(ref.getMonth())
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

  // Kept present but invisible/non-interactive in both branches: a native date input backing
  // the same value, so consumers integrating outside the visible UI (a11y tooling, automation)
  // still have a standard type="date" element to target — the calendar/sheet below is the real
  // interaction surface.
  const hiddenNativeInput = (
    <input
      type="date"
      aria-label={ariaLabel}
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      className={cn(className, 'w-full opacity-0 pointer-events-none')}
    />
  )

  const calendarBody = (
    <>
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
    </>
  )

  if (isMobile) {
    return (
      <div className="relative flex-1" ref={containerRef}>
        {hiddenNativeInput}
        <button
          type="button"
          aria-label={ariaLabel ? `${ariaLabel} trigger` : undefined}
          onClick={handleOpenMobile}
          className={cn(className, 'absolute inset-0 w-full text-left')}
        >
          {displayValue || <span className="text-on-surface/40">dd/mm/aaaa</span>}
        </button>

        <MobileSheet open={open} onClose={() => setOpen(false)} contentClassName="px-4 pb-4">
          {calendarBody}
        </MobileSheet>
      </div>
    )
  }

  return (
    <div className="relative flex-1" ref={containerRef}>
      {hiddenNativeInput}
      {/* Real text input (types in the same dd/mm/yyyy format it displays) instead of a
          read-only button, so far-off dates don't require paging through the calendar month
          by month. Focusing it also opens the calendar below, keeping click-to-pick available
          side by side with typing. */}
      <input
        type="text"
        inputMode="numeric"
        aria-label={ariaLabel ? `${ariaLabel} trigger` : undefined}
        value={isFocused ? text : displayValue}
        placeholder="dd/mm/aaaa"
        onFocus={handleFocus}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => handleTextChange(e.target.value)}
        className={cn(className, 'absolute inset-0 w-full')}
      />

      {open && (
        <div
          className={cn(
            'absolute z-30 w-72 rounded-2xl bg-surface-container-high border border-outline-variant p-4',
            openUpward ? 'bottom-full mb-2' : 'top-full mt-2',
            alignRight ? 'right-0' : 'left-0'
          )}
          style={{ boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' }}
        >
          {calendarBody}
        </div>
      )}
    </div>
  )
}

import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, Calendar, Trash2 } from 'lucide-react'
import { cn, parseDateLocal, uuid } from '@/lib/utils'
import type { SavedPeriod } from '@/types'

// ── Public types ──────────────────────────────────────────────────────────────

export interface PeriodValue {
  mode: 'month' | 'custom'
  monthOffset: number
  customStart?: string
  customEnd?: string
}

interface PeriodSelectorProps {
  value: PeriodValue
  onChange: (v: PeriodValue) => void
  // M-45: saved custom periods — only populated by Reports (Analytics); when
  // omitted, the saved-periods list and "save period" UI are not shown.
  savedPeriods?: SavedPeriod[]
  onSavePeriod?: (period: SavedPeriod) => void
  onDeletePeriod?: (id: string) => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PeriodSelector({
  value,
  onChange,
  savedPeriods,
  onSavePeriod,
  onDeletePeriod,
}: PeriodSelectorProps) {
  const { t } = useTranslation()

  const [showMenu, setShowMenu] = useState(false)
  const [showCustomPicker, setShowCustomPicker] = useState(false)

  // Pending values inside the custom picker (applied only on Ok)
  const [pendingStart, setPendingStart] = useState(() => {
    const n = new Date()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [pendingEnd, setPendingEnd] = useState(() => {
    const n = new Date()
    const lastDay = new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  })
  // M-45: optional name for saving the pending custom range
  const [pendingName, setPendingName] = useState('')

  const containerRef = useRef<HTMLDivElement>(null)

  // ── Click-outside ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!showMenu && !showCustomPicker) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setShowCustomPicker(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMenu, showCustomPicker])

  // ── Period label ──────────────────────────────────────────────────────────
  const now = new Date()
  const periodLabel = (() => {
    if (value.mode === 'month') {
      const ref = new Date(now.getFullYear(), now.getMonth() + value.monthOffset, 1)
      const raw = ref.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      return raw.charAt(0).toUpperCase() + raw.slice(1)
    }
    // custom
    if (value.customStart && value.customEnd) {
      const fmt = (s: string) =>
        parseDateLocal(s).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        })
      return `${fmt(value.customStart)} – ${fmt(value.customEnd)}`
    }
    return t('transactions.custom')
  })()

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handleSelectMonth() {
    onChange({ mode: 'month', monthOffset: 0 })
    setShowMenu(false)
  }

  function handleOpenCustomPicker() {
    setShowMenu(false)
    setShowCustomPicker(true)
  }

  function handleApplyCustom() {
    if (!pendingStart || !pendingEnd) return
    onChange({
      mode: 'custom',
      monthOffset: value.monthOffset,
      customStart: pendingStart,
      customEnd: pendingEnd,
    })
    setShowCustomPicker(false)
  }

  // M-45: save the pending custom range for reuse
  function handleSavePeriod() {
    if (!pendingStart || !pendingEnd || !onSavePeriod) return
    onSavePeriod({
      id: uuid(),
      name: pendingName.trim() || `${pendingStart} – ${pendingEnd}`,
      start: pendingStart,
      end: pendingEnd,
    })
    setPendingName('')
  }

  // M-45: apply a saved period and close the menu
  function handleApplySavedPeriod(period: SavedPeriod) {
    onChange({
      mode: 'custom',
      monthOffset: value.monthOffset,
      customStart: period.start,
      customEnd: period.end,
    })
    setShowMenu(false)
  }

  return (
    <div className="relative" ref={containerRef}>
      {/* Label row: arrows (month mode only) + clickable period label */}
      <div className="flex items-center gap-1 justify-center sm:justify-start">
        {value.mode === 'month' && (
          <button
            onClick={() => onChange({ ...value, monthOffset: value.monthOffset - 1 })}
            aria-label="previous-period"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
          >
            <ChevronLeft size={18} strokeWidth={1.5} className="text-on-surface/60" />
          </button>
        )}

        <button
          aria-label="period-selector"
          onClick={() => {
            setShowCustomPicker(false)
            setShowMenu((v) => !v)
          }}
          className="flex items-center gap-1.5 rounded-xl px-2 py-1 hover:bg-surface-container-low transition-colors"
        >
          <span className="text-xl font-bold text-on-surface min-w-44 text-center">
            {periodLabel}
          </span>
        </button>

        {value.mode === 'month' && (
          <button
            onClick={() => onChange({ ...value, monthOffset: value.monthOffset + 1 })}
            aria-label="next-period"
            className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-container-low transition-colors"
          >
            <ChevronRight size={18} strokeWidth={1.5} className="text-on-surface/60" />
          </button>
        )}
      </div>

      {/* ── Period dropdown ──────────────────────────────────────────────── */}
      {showMenu && (
        <div
          className="absolute left-0 top-full mt-2 z-30 min-w-44 overflow-hidden rounded-2xl bg-surface-container-high border border-outline-variant py-1"
          style={{ boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' }}
          role="menu"
        >
          <button
            role="menuitem"
            onClick={handleSelectMonth}
            className={cn(
              'w-full px-5 py-3 text-left text-sm font-medium transition-colors hover:bg-surface-container-low',
              value.mode === 'month' ? 'text-primary' : 'text-on-surface'
            )}
          >
            {t('transactions.thisMonth')}
          </button>
          <button
            role="menuitem"
            onClick={handleOpenCustomPicker}
            className={cn(
              'w-full px-5 py-3 text-left text-sm font-medium transition-colors hover:bg-surface-container-low',
              value.mode === 'custom' ? 'text-primary' : 'text-on-surface'
            )}
          >
            {t('transactions.choosePeriod')}
          </button>

          {/* M-45: saved custom periods — only when the host page wires them up */}
          {savedPeriods?.map((period) => (
            <div
              key={period.id}
              className="group flex items-center hover:bg-surface-container-low transition-colors"
            >
              <button
                role="menuitem"
                onClick={() => handleApplySavedPeriod(period)}
                className={cn(
                  'flex-1 truncate px-5 py-3 text-left text-sm font-medium transition-colors',
                  value.mode === 'custom' &&
                    value.customStart === period.start &&
                    value.customEnd === period.end
                    ? 'text-primary'
                    : 'text-on-surface'
                )}
              >
                {period.name}
              </button>
              {onDeletePeriod && (
                <button
                  aria-label={t('transactions.deletePeriod')}
                  onClick={() => onDeletePeriod(period.id)}
                  className="pr-4 text-on-surface/30 hover:text-tertiary transition-colors"
                >
                  <Trash2 size={14} strokeWidth={2} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Custom date range picker ─────────────────────────────────────── */}
      {showCustomPicker && (
        <div
          className="absolute left-0 top-full mt-2 z-30 w-72 rounded-2xl bg-surface-container-high border border-outline-variant p-5"
          style={{ boxShadow: '0px 8px 24px rgba(0,0,0,0.3)' }}
        >
          <div className="space-y-3 mb-4">
            <div className="flex items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3">
              <input
                aria-label="custom-start-date"
                type="date"
                value={pendingStart}
                onChange={(e) => setPendingStart(e.target.value)}
                className="flex-1 bg-transparent text-sm font-medium text-on-surface outline-none"
              />
              <Calendar size={16} className="text-on-surface/40 shrink-0" />
            </div>
            <div className="flex items-center gap-3 rounded-xl bg-surface-container-low px-4 py-3">
              <input
                aria-label="custom-end-date"
                type="date"
                value={pendingEnd}
                onChange={(e) => setPendingEnd(e.target.value)}
                className="flex-1 bg-transparent text-sm font-medium text-on-surface outline-none"
              />
              <Calendar size={16} className="text-on-surface/40 shrink-0" />
            </div>
          </div>
          <button
            onClick={handleApplyCustom}
            disabled={!pendingStart || !pendingEnd}
            className="w-full rounded-xl bg-primary py-3 text-sm font-semibold text-white transition-all active:scale-[0.97] disabled:opacity-40"
          >
            {t('transactions.applyPeriod')}
          </button>

          {/* M-45: name + save the pending custom range — only when the host page wires it up */}
          {onSavePeriod && (
            <div className="mt-3 space-y-2">
              <input
                type="text"
                value={pendingName}
                onChange={(e) => setPendingName(e.target.value)}
                placeholder={t('transactions.periodNamePlaceholder')}
                className="w-full rounded-xl bg-surface-container-low px-4 py-2.5 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              />
              <button
                onClick={handleSavePeriod}
                disabled={!pendingStart || !pendingEnd}
                className="w-full rounded-xl bg-surface-container-low py-2.5 text-sm font-semibold text-on-surface/70 transition-all hover:bg-surface-container active:scale-[0.97] disabled:opacity-40"
              >
                {t('transactions.savePeriod')}
              </button>
            </div>
          )}

          <button
            onClick={() => setShowCustomPicker(false)}
            className="mt-3 w-full text-center text-sm text-on-surface/50 hover:text-on-surface/70 transition-colors"
          >
            {t('transactions.back')}
          </button>
        </div>
      )}
    </div>
  )
}

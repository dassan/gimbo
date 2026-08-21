import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  cn,
  parseDateLocal,
  formatDateLocal,
  advanceMonths,
  todayStr,
  projectRecurringOccurrences,
  PROJECTION_HORIZON_YEARS,
} from '@/lib/utils'
import { measure } from '@/lib/perfMonitor'
import PeriodSelector from '@/components/PeriodSelector'
import type { PeriodValue } from '@/components/PeriodSelector'
import CashFlowView from './CashFlowView'
import CategoriasView from './CategoriasView'
import ContasView from './ContasView'
import TagsView from './TagsView'
import FaturasView from './FaturasView'

type ActiveTab = 'categorias' | 'cashflow' | 'contas' | 'tags' | 'faturas'

const TABS: ActiveTab[] = ['categorias', 'cashflow', 'contas', 'tags', 'faturas']

export default function Analytics() {
  const { t } = useTranslation()
  const data = useDataStore((s) => s.data)
  const addSavedPeriod = useDataStore((s) => s.addSavedPeriod)
  const deleteSavedPeriod = useDataStore((s) => s.deleteSavedPeriod)
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )

  // ── Global period state (shared across all tabs) ────────────────────────
  const [period, setPeriod] = useState<PeriodValue>({ mode: 'month', monthOffset: 0 })
  const [includeUnpaid, setIncludeUnpaid] = useState(true)
  const [activeTab, setActiveTab] = useState<ActiveTab>('categorias')

  const now = useMemo(() => new Date(), [])

  // ── Mobile detection (SSR-safe) ────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? !window.matchMedia('(min-width: 640px)').matches : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  // ── Compute date range from PeriodSelector state ────────────────────────
  const { startDate, endDate } = useMemo(() => {
    if (period.mode === 'month') {
      const ref = new Date(now.getFullYear(), now.getMonth() + period.monthOffset, 1)
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
      return { startDate: ref, endDate: end }
    }
    // custom
    if (period.customStart && period.customEnd) {
      return {
        startDate: parseDateLocal(period.customStart),
        endDate: parseDateLocal(period.customEnd),
      }
    }
    // fallback: current month
    const ref = new Date(now.getFullYear(), now.getMonth(), 1)
    return { startDate: ref, endDate: new Date(ref.getFullYear(), ref.getMonth() + 1, 0) }
  }, [period, now])

  // M-62: when the selected period reaches into the future, extend the cash-flow chart's
  // transactions with virtual occurrences of open-ended recurring series beyond whatever is
  // already materialized (lib/utils.ts projectRecurringOccurrences), capped at a fixed
  // 10-year horizon. CashFlowView itself derives which buckets are actually "projected" from
  // the isProjected tag on these merged rows — it never has to guess from a date cutoff, so
  // a recurring series that already has real data further out than this call's horizon (e.g.
  // B-22's 24-month rolling window) simply gets nothing added and renders entirely as real.
  // Scoped to CashFlowView only — the other sub-tabs are about historical breakdown, not
  // trend, and stay real-data-only.
  const cashFlowTransactions = useMemo(
    () =>
      measure('analytics.cashFlowTransactions', () => {
        if (!data) return []
        const today = parseDateLocal(todayStr())
        if (endDate <= today) return data.transactions
        const cap = parseDateLocal(advanceMonths(todayStr(), PROJECTION_HORIZON_YEARS * 12))
        const horizon = formatDateLocal(endDate < cap ? endDate : cap)
        return [...data.transactions, ...projectRecurringOccurrences(data.transactions, horizon)]
      }),
    [data, endDate]
  )

  if (!data) return null

  // MB-18: mobile only has Categorias so far (the other 4 tabs aren't responsive yet,
  // MB-08) — force that tab regardless of activeTab's last desktop value, and hide the
  // now-pointless single-item tab switcher below.
  const effectiveTab = isMobile ? 'categorias' : activeTab

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Period selector ─────────────────────────────────────────────── */}
      {/* Same treatment as Transactions: sm:-ml-2 compensates the chevron button's own
          hit-area padding so the arrow tip lines up with the content below. */}
      <div className="sm:-ml-2">
        <PeriodSelector
          value={period}
          onChange={setPeriod}
          savedPeriods={data.savedPeriods}
          onSavePeriod={addSavedPeriod}
          onDeletePeriod={deleteSavedPeriod}
        />
      </div>

      {/* ── Sub-navigation tabs + include-unpaid toggle ──────────────────── */}
      {/* MB-18: hidden on mobile — the tab switcher is pointless with a single reachable tab,
          and the toggle didn't fit the narrow layout well. includeUnpaid keeps defaulting to
          true (its normal initial value), so mobile behaves as if it were always toggled on. */}
      <div className="hidden sm:flex items-center justify-between gap-3">
        <div className="flex gap-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                'rounded-full px-4 py-1.5 text-xs font-medium transition-all',
                activeTab === tab
                  ? 'bg-primary text-white'
                  : 'bg-surface-container-low text-on-surface/50 hover:text-on-surface/70'
              )}
            >
              {t(`analytics.tabs.${tab}`)}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIncludeUnpaid((v) => !v)}
          className={cn(
            'shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all',
            includeUnpaid
              ? 'bg-on-surface text-white'
              : 'bg-surface-container-low text-on-surface/50 hover:text-on-surface/70'
          )}
        >
          {t('analytics.includeUnpaid')}
        </button>
      </div>

      {/* ── Active view ──────────────────────────────────────────────────── */}
      {effectiveTab === 'categorias' && (
        <CategoriasView
          transactions={data.transactions}
          accounts={data.accounts}
          categories={data.categories}
          startDate={startDate}
          endDate={endDate}
          includeUnpaid={includeUnpaid}
          shadowClass={shadowClass}
        />
      )}

      {effectiveTab === 'cashflow' && (
        <CashFlowView
          transactions={cashFlowTransactions}
          accounts={data.accounts}
          startDate={startDate}
          endDate={endDate}
          includeUnpaid={includeUnpaid}
          shadowClass={shadowClass}
        />
      )}

      {effectiveTab === 'contas' && (
        <ContasView
          transactions={data.transactions}
          accounts={data.accounts}
          startDate={startDate}
          endDate={endDate}
          includeUnpaid={includeUnpaid}
          shadowClass={shadowClass}
        />
      )}

      {effectiveTab === 'tags' && (
        <TagsView
          transactions={data.transactions}
          tags={data.tags}
          startDate={startDate}
          endDate={endDate}
          includeUnpaid={includeUnpaid}
          shadowClass={shadowClass}
        />
      )}

      {effectiveTab === 'faturas' && (
        <FaturasView
          transactions={data.transactions}
          accounts={data.accounts}
          startDate={startDate}
          endDate={endDate}
          shadowClass={shadowClass}
        />
      )}
    </div>
  )
}

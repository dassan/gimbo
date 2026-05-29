import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn, formatCurrency, parseDateLocal } from '@/lib/utils'
import type { Transaction, Tag } from '@/types'

export interface TagsViewProps {
  transactions: Transaction[]
  tags: Tag[]
  startDate: Date
  endDate: Date
  includeUnpaid: boolean
  shadowClass: string
}

// ─── Data types ───────────────────────────────────────────────────────────────

interface TagEntry {
  tag: Tag
  value: number
  pct: number
}

type FilterMode = 'OR' | 'AND'

// ─── Main component ───────────────────────────────────────────────────────────

export default function TagsView({
  transactions,
  tags,
  startDate,
  endDate,
  includeUnpaid,
  shadowClass,
}: TagsViewProps) {
  const { t } = useTranslation()

  // ── Multi-tag filter state ─────────────────────────────────────────────────
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set())
  const [filterMode, setFilterMode] = useState<FilterMode>('OR')

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const clearFilter = () => setSelectedTagIds(new Set())

  // ── Filter transactions by period, unpaid, and selected tags ──────────────
  const filteredTxs = useMemo(() => {
    return transactions.filter((tx) => {
      if (tx.type === 'CREDIT_PAYMENT') return false
      const d = parseDateLocal(tx.date)
      const inPeriod = d >= startDate && d <= endDate
      const isPaidOk = includeUnpaid || tx.isPaid
      if (!inPeriod || !isPaidOk) return false

      if (selectedTagIds.size === 0) return true

      if (filterMode === 'OR') {
        // R-14: OR — at least one selected tag matches
        return tx.tags.some((tagId) => selectedTagIds.has(tagId))
      }
      // R-14: AND — all selected tags must be present
      return Array.from(selectedTagIds).every((tagId) => tx.tags.includes(tagId))
    })
  }, [transactions, startDate, endDate, includeUnpaid, selectedTagIds, filterMode])

  // ── Aggregate by tag for a given type ────────────────────────────────────
  const groupByTag = useMemo(() => {
    function compute(type: 'INCOME' | 'EXPENSE'): TagEntry[] {
      const map: Record<string, number> = {}
      filteredTxs
        .filter((tx) => tx.type === type && tx.tags.length > 0)
        .forEach((tx) => {
          tx.tags.forEach((tagId) => {
            map[tagId] = (map[tagId] ?? 0) + tx.amount
          })
        })
      const entries: TagEntry[] = Object.entries(map)
        .map(([tagId, value]) => {
          const tag = tags.find((t) => t.id === tagId)
          if (!tag) return null
          return { tag, value, pct: 0 }
        })
        .filter((e): e is TagEntry => e !== null)
        .sort((a, b) => b.value - a.value)

      const total = entries.reduce((s, e) => s + e.value, 0)
      if (total > 0) entries.forEach((e) => (e.pct = (e.value / total) * 100))
      return entries
    }
    return {
      expenseEntries: compute('EXPENSE'),
      incomeEntries: compute('INCOME'),
    }
  }, [filteredTxs, tags])

  const { expenseEntries, incomeEntries } = groupByTag

  const hasAnyData = expenseEntries.length > 0 || incomeEntries.length > 0
  const showModeToggle = selectedTagIds.size >= 2

  return (
    <div className="space-y-4">
      {/* ── Multi-tag filter bar ──────────────────────────────────────────── */}
      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((tag) => {
            const isSelected = selectedTagIds.has(tag.id)
            return (
              <button
                key={tag.id}
                onClick={() => toggleTag(tag.id)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium transition-all',
                  isSelected ? 'text-white' : 'text-on-surface/60 bg-surface-container-low'
                )}
                style={isSelected ? { backgroundColor: tag.color } : undefined}
              >
                #{tag.name}
              </button>
            )
          })}

          {/* OR/AND mode toggle — visible when ≥ 2 tags selected */}
          {showModeToggle && (
            <div className="flex rounded-full bg-surface-container-low overflow-hidden ml-1">
              <button
                onClick={() => setFilterMode('OR')}
                className={cn(
                  'px-3 py-1 text-xs font-medium transition-all',
                  filterMode === 'OR'
                    ? 'bg-on-surface text-white'
                    : 'text-on-surface/50 hover:text-on-surface/70'
                )}
              >
                {t('analytics.tags.orMode')}
              </button>
              <button
                onClick={() => setFilterMode('AND')}
                className={cn(
                  'px-3 py-1 text-xs font-medium transition-all',
                  filterMode === 'AND'
                    ? 'bg-on-surface text-white'
                    : 'text-on-surface/50 hover:text-on-surface/70'
                )}
              >
                {t('analytics.tags.andMode')}
              </button>
            </div>
          )}

          {/* Clear filter button */}
          {selectedTagIds.size > 0 && (
            <button
              onClick={clearFilter}
              className="rounded-full px-3 py-1 text-xs font-medium text-on-surface/40 hover:text-on-surface/70 transition-colors"
            >
              {t('analytics.tags.clearFilter')}
            </button>
          )}
        </div>
      )}

      {/* ── Content ──────────────────────────────────────────────────────── */}
      {!hasAnyData ? (
        <div className={cn('rounded-2xl bg-surface-container p-12 text-center', shadowClass)}>
          <p className="text-sm text-on-surface/30">{t('analytics.tags.noData')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {expenseEntries.length > 0 && (
            <TagSection
              title={t('analytics.tags.expensesTitle')}
              entries={expenseEntries}
              shadowClass={shadowClass}
              barColor={undefined}
            />
          )}
          {incomeEntries.length > 0 && (
            <TagSection
              title={t('analytics.tags.incomeTitle')}
              entries={incomeEntries}
              shadowClass={shadowClass}
              barColor={undefined}
            />
          )}
        </div>
      )}
    </div>
  )
}

// ─── TagSection ───────────────────────────────────────────────────────────────

interface TagSectionProps {
  title: string
  entries: TagEntry[]
  shadowClass: string
  barColor: string | undefined
}

function TagSection({ title, entries, shadowClass }: TagSectionProps) {
  const maxValue = entries[0]?.value ?? 0

  return (
    <div className={cn('rounded-2xl bg-surface-container p-6 space-y-4', shadowClass)}>
      <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
      <div className="space-y-3">
        {entries.map(({ tag, value, pct }) => {
          const barWidth = maxValue > 0 ? (value / maxValue) * 100 : 0
          return (
            <div key={tag.id} className="space-y-1.5">
              {/* Row: chip + value + pct */}
              <div className="flex items-center gap-2">
                <span
                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold text-white"
                  style={{ backgroundColor: tag.color }}
                >
                  #{tag.name}
                </span>
                <span className="flex-1" />
                <span className="text-[10px] text-on-surface/40">{pct.toFixed(1)}%</span>
                <span className="text-xs font-semibold text-on-surface w-24 text-right">
                  {formatCurrency(value)}
                </span>
              </div>
              {/* Horizontal bar */}
              <div className="h-1.5 w-full rounded-full bg-surface-container-low overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${barWidth}%`, backgroundColor: tag.color }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

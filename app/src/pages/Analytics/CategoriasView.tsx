import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Utensils,
  ShoppingCart,
  Car,
  Home,
  Heart,
  Plane,
  GraduationCap,
  Tv,
  Wrench,
  Briefcase,
  Gift,
  Tag as TagIcon,
  Circle,
  ChevronRight,
  ChevronDown,
  X,
  Landmark,
  PiggyBank,
  CreditCard,
  Bitcoin,
  ArrowLeftRight,
  TrendingUp,
  MoreHorizontal,
} from 'lucide-react'
import { PieChart, Pie, Cell } from 'recharts'
import { cn, formatCurrency, parseDateLocal } from '@/lib/utils'
import type { Transaction, Account, Category } from '@/types'

// M-37: fallback palette to keep donut slices distinct when categories share a stored
// color (legacy categories were all created with the same default green).
const CHART_FALLBACK_COLORS = [
  '#22c55e',
  '#3b82f6',
  '#f97316',
  '#a855f7',
  '#ef4444',
  '#06b6d4',
  '#eab308',
  '#ec4899',
]

export interface CategoriasViewProps {
  transactions: Transaction[]
  accounts: Account[]
  categories: Category[]
  startDate: Date
  endDate: Date
  includeUnpaid: boolean
  shadowClass: string
}

// ─── Category icon map (mirrors Settings/index.tsx) ───────────────────────────

const CATEGORY_ICON_MAP: Record<string, React.ReactNode> = {
  utensils: <Utensils size={14} strokeWidth={1.5} />,
  'shopping-cart': <ShoppingCart size={14} strokeWidth={1.5} />,
  car: <Car size={14} strokeWidth={1.5} />,
  home: <Home size={14} strokeWidth={1.5} />,
  heart: <Heart size={14} strokeWidth={1.5} />,
  plane: <Plane size={14} strokeWidth={1.5} />,
  'graduation-cap': <GraduationCap size={14} strokeWidth={1.5} />,
  tv: <Tv size={14} strokeWidth={1.5} />,
  wrench: <Wrench size={14} strokeWidth={1.5} />,
  briefcase: <Briefcase size={14} strokeWidth={1.5} />,
  gift: <Gift size={14} strokeWidth={1.5} />,
  tag: <TagIcon size={14} strokeWidth={1.5} />,
}

function categoryIcon(iconName: string): React.ReactNode {
  return CATEGORY_ICON_MAP[iconName] ?? <Circle size={14} strokeWidth={1.5} />
}

// ─── Account type icon map (for drill-down modal rows) ────────────────────────

const ACCOUNT_ICON_MAP: Record<string, React.ReactNode> = {
  RETAIL: <Landmark size={14} strokeWidth={1.5} />,
  SAVINGS: <PiggyBank size={14} strokeWidth={1.5} />,
  CREDIT: <CreditCard size={14} strokeWidth={1.5} />,
  CRYPTO: <Bitcoin size={14} strokeWidth={1.5} />,
  FOREX: <ArrowLeftRight size={14} strokeWidth={1.5} />,
  ASSET: <Home size={14} strokeWidth={1.5} />,
  STOCKS: <TrendingUp size={14} strokeWidth={1.5} />,
  OTHER: <MoreHorizontal size={14} strokeWidth={1.5} />,
}

function accountIcon(type: string): React.ReactNode {
  return ACCOUNT_ICON_MAP[type] ?? <Landmark size={14} strokeWidth={1.5} />
}

// ─── Period label for drill-down modal title ──────────────────────────────────

function formatPeriodLabel(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '')
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()
  return sameMonth ? fmt(start) : `${fmt(start)} – ${fmt(end)}`
}

// ─── Data types ───────────────────────────────────────────────────────────────

// A bucket is one row in the breakdown: a top-level (root) category or one of its
// children. `catIds` are all category ids it aggregates — used by the drill-down to
// pull every transaction under that node (parent rows include their whole subtree).
interface CategoryBucket {
  id: string
  name: string
  icon: string
  color: string
  value: number
  pct: number // share of the grand total
  catIds: string[]
}

interface RootEntry extends CategoryBucket {
  children: CategoryBucket[] // second-level breakdown; empty for a leaf root
}

interface DrilldownState {
  categoryIds: string[]
  categoryName: string
  type: 'INCOME' | 'EXPENSE'
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function CategoriasView({
  transactions,
  accounts,
  categories,
  startDate,
  endDate,
  includeUnpaid,
  shadowClass,
}: CategoriasViewProps) {
  const { t } = useTranslation()
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null)

  const { incomeRoots, expenseRoots } = useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]))

    // Ancestry chain for a category: [catId, parent, …, root]. Cycle-safe.
    const ancestry = (catId: string): string[] => {
      const chain: string[] = []
      const seen = new Set<string>()
      let cur: string | undefined = catId
      while (cur && catById.has(cur) && !seen.has(cur)) {
        chain.push(cur)
        seen.add(cur)
        cur = catById.get(cur)!.parentId ?? undefined
      }
      return chain
    }

    // Resolve, for every category, its root and its second-level node (the child of the
    // root on its path — grandchildren roll up to it). Also the catId set per bucket.
    const rootOf = new Map<string, string>()
    const secondOf = new Map<string, string>()
    const rootCatIds = new Map<string, Set<string>>()
    const secondCatIds = new Map<string, Set<string>>()
    for (const c of categories) {
      const chain = ancestry(c.id)
      const root = chain[chain.length - 1] ?? c.id
      const second = chain.length >= 2 ? chain[chain.length - 2] : root
      rootOf.set(c.id, root)
      secondOf.set(c.id, second)
      if (!rootCatIds.has(root)) rootCatIds.set(root, new Set())
      rootCatIds.get(root)!.add(c.id)
      if (!secondCatIds.has(second)) secondCatIds.set(second, new Set())
      secondCatIds.get(second)!.add(c.id)
    }

    const txs = transactions.filter((tx) => {
      // CC-17: CREDIT_PAYMENT is liability liquidation, not income/expense.
      if (tx.type === 'CREDIT_PAYMENT') return false
      // CC-18: category breakdown uses tx.date (budget perspective, not cash-flow date).
      const d = parseDateLocal(tx.date)
      return d >= startDate && d <= endDate && (includeUnpaid || tx.isPaid)
    })

    const build = (type: 'INCOME' | 'EXPENSE'): RootEntry[] => {
      const rootMap = new Map<string, { value: number; children: Map<string, number> }>()
      for (const tx of txs) {
        if (tx.type !== type) continue
        const cat = catById.get(tx.categoryId)
        const rootId = cat ? (rootOf.get(cat.id) ?? cat.id) : '__outros__'
        const secondId = cat ? (secondOf.get(cat.id) ?? rootId) : '__outros__'
        let r = rootMap.get(rootId)
        if (!r) {
          r = { value: 0, children: new Map() }
          rootMap.set(rootId, r)
        }
        r.value += tx.amount
        r.children.set(secondId, (r.children.get(secondId) ?? 0) + tx.amount)
      }

      const grandTotal = [...rootMap.values()].reduce((s, r) => s + r.value, 0) || 1
      const mkBucket = (
        id: string,
        value: number,
        ids: Set<string> | undefined
      ): CategoryBucket => {
        const cat = catById.get(id)
        return {
          id,
          name: cat?.name ?? 'Outros',
          icon: cat?.icon ?? 'tag',
          color: cat?.color ?? '#6B7280',
          value,
          pct: (value / grandTotal) * 100,
          catIds: id === '__outros__' ? [] : [...(ids ?? new Set([id]))],
        }
      }

      const roots: RootEntry[] = [...rootMap.entries()].map(([rootId, r]) => {
        const children = [...r.children.entries()]
          .map(([secondId, v]) => mkBucket(secondId, v, secondCatIds.get(secondId)))
          .sort((a, b) => b.value - a.value)
        // Expandable only when there's a real sub-category (a bucket other than the root
        // itself — the self-bucket is spending posted directly on the parent category).
        const hasRealChildren = children.some((c) => c.id !== rootId)
        return {
          ...mkBucket(rootId, r.value, rootCatIds.get(rootId)),
          children: hasRealChildren ? children : [],
        }
      })
      roots.sort((a, b) => b.value - a.value)

      // M-37: keep donut slices (roots) visually distinct when colors collide.
      const used = new Set<string>()
      roots.forEach((e, i) => {
        if (used.has(e.color)) e.color = CHART_FALLBACK_COLORS[i % CHART_FALLBACK_COLORS.length]
        used.add(e.color)
      })
      return roots
    }

    return { incomeRoots: build('INCOME'), expenseRoots: build('EXPENSE') }
  }, [transactions, categories, startDate, endDate, includeUnpaid])

  const periodLabel = formatPeriodLabel(startDate, endDate)

  const openDrilldown = (bucket: CategoryBucket, type: 'INCOME' | 'EXPENSE') => {
    if (bucket.catIds.length === 0) return // uncategorized "Outros" — nothing to drill into
    setDrilldown({ categoryIds: bucket.catIds, categoryName: bucket.name, type })
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {/* Income donut */}
        <CategoryDonut
          title={t('analytics.categorias.incomeTitle')}
          entries={incomeRoots}
          shadowClass={shadowClass}
          onBucketClick={(bucket) => openDrilldown(bucket, 'INCOME')}
        />

        {/* Expenses donut */}
        <CategoryDonut
          title={t('analytics.categorias.expensesTitle')}
          entries={expenseRoots}
          shadowClass={shadowClass}
          onBucketClick={(bucket) => openDrilldown(bucket, 'EXPENSE')}
        />
      </div>

      {/* R-10: Drill-down modal */}
      {drilldown && (
        <DrilldownModal
          categoryIds={drilldown.categoryIds}
          categoryName={drilldown.categoryName}
          transactionType={drilldown.type}
          transactions={transactions}
          accounts={accounts}
          startDate={startDate}
          endDate={endDate}
          includeUnpaid={includeUnpaid}
          periodLabel={periodLabel}
          drilldownTitle={t('analytics.categorias.drilldownTitle')}
          onClose={() => setDrilldown(null)}
        />
      )}
    </>
  )
}

// ─── CategoryDonut ────────────────────────────────────────────────────────────

interface CategoryDonutProps {
  title: string
  entries: RootEntry[]
  shadowClass: string
  onBucketClick: (bucket: CategoryBucket) => void
}

function CategoryDonut({ title, entries, shadowClass, onBucketClick }: CategoryDonutProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const total = entries.reduce((s, e) => s + e.value, 0)

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Clicking a root expands it (when it has children) or drills straight in (leaf root).
  const handleRoot = (root: RootEntry) => {
    if (root.children.length > 0) toggle(root.id)
    else onBucketClick(root)
  }

  return (
    <div className={cn('rounded-2xl bg-surface-container p-6', shadowClass)}>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        {entries.length > 0 && (
          <span className="text-sm font-bold tabular-nums text-on-surface">
            {formatCurrency(total)}
          </span>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface/30">
          {t('analytics.categorias.noData')}
        </p>
      ) : (
        <div className="flex gap-6">
          {/* Donut chart — one slice per root category */}
          <div className="relative shrink-0" style={{ width: 160, height: 160 }}>
            <PieChart width={160} height={160}>
              <Pie
                data={entries}
                cx={80}
                cy={80}
                innerRadius={53}
                outerRadius={74}
                paddingAngle={2}
                dataKey="value"
                strokeWidth={0}
              >
                {entries.map((entry, i) => (
                  <Cell
                    key={entry.id ?? i}
                    fill={entry.color}
                    className="cursor-pointer"
                    onClick={() => handleRoot(entry)}
                  />
                ))}
              </Pie>
            </PieChart>
          </div>

          {/* Legend — roots, expandable to their children (R-09: no item limit) */}
          <div className="flex-1 space-y-1">
            {entries.map((root) => {
              const isExpandable = root.children.length > 0
              const isOpen = expanded.has(root.id)
              return (
                <div key={root.id}>
                  <button
                    onClick={() => handleRoot(root)}
                    aria-expanded={isExpandable ? isOpen : undefined}
                    className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-container-low transition-colors text-left"
                  >
                    {/* Expand chevron (only for roots with children) */}
                    <span className="flex h-4 w-4 shrink-0 items-center justify-center text-on-surface/40">
                      {isExpandable &&
                        (isOpen ? (
                          <ChevronDown size={13} strokeWidth={2} />
                        ) : (
                          <ChevronRight size={13} strokeWidth={2} />
                        ))}
                    </span>

                    {/* Category icon */}
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
                      style={{ backgroundColor: root.color }}
                    >
                      {categoryIcon(root.icon)}
                    </span>

                    <span className="flex-1 min-w-0 text-xs text-on-surface/70 truncate">
                      {root.name}
                    </span>
                    <span className="text-[10px] text-on-surface/40 shrink-0">
                      {root.pct.toFixed(1)}%
                    </span>
                    <span className="text-xs font-semibold tabular-nums text-on-surface shrink-0 ml-1">
                      {formatCurrency(root.value)}
                    </span>
                  </button>

                  {/* Children breakdown */}
                  {isExpandable && isOpen && (
                    <div className="mt-0.5 space-y-0.5 border-l border-surface-container-high ml-3 pl-3">
                      {root.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => onBucketClick(child)}
                          className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-container-low transition-colors text-left"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: child.color }}
                          />
                          <span className="flex-1 min-w-0 text-xs text-on-surface/60 truncate">
                            {child.id === root.id
                              ? t('analytics.categorias.directSpending')
                              : child.name}
                          </span>
                          <span className="text-[10px] text-on-surface/40 shrink-0">
                            {child.pct.toFixed(1)}%
                          </span>
                          <span className="text-xs font-medium tabular-nums text-on-surface/80 shrink-0 ml-1">
                            {formatCurrency(child.value)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── DrilldownModal ───────────────────────────────────────────────────────────

interface DrilldownModalProps {
  categoryIds: string[]
  categoryName: string
  transactionType: 'INCOME' | 'EXPENSE'
  transactions: Transaction[]
  accounts: Account[]
  startDate: Date
  endDate: Date
  includeUnpaid: boolean
  periodLabel: string
  drilldownTitle: string
  onClose: () => void
}

function DrilldownModal({
  categoryIds,
  categoryName,
  transactionType,
  transactions,
  accounts,
  startDate,
  endDate,
  includeUnpaid,
  periodLabel,
  drilldownTitle,
  onClose,
}: DrilldownModalProps) {
  const { t } = useTranslation()

  const filtered = useMemo(() => {
    const idSet = new Set(categoryIds)
    return transactions.filter((tx) => {
      if (tx.type !== transactionType) return false
      if (!idSet.has(tx.categoryId)) return false
      // CC-18: use tx.date for category breakdown (budget perspective)
      const d = parseDateLocal(tx.date)
      const inPeriod = d >= startDate && d <= endDate
      const isPaidOk = includeUnpaid || tx.isPaid
      return inPeriod && isPaidOk
    })
  }, [transactions, categoryIds, transactionType, startDate, endDate, includeUnpaid])

  const total = filtered.reduce((s, tx) => s + tx.amount, 0)

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-on-surface/20 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-lg rounded-2xl bg-surface-container-low p-6 space-y-4 flex flex-col max-h-[85vh] shadow-card-ambient"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 shrink-0">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 mb-0.5">
                {drilldownTitle}
              </p>
              <h3 className="text-base font-semibold text-on-surface">
                {categoryName}
                <span className="ml-2 text-sm font-normal text-on-surface/40">{periodLabel}</span>
              </h3>
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-low transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Transaction list */}
          <div className="flex-1 overflow-y-auto space-y-0.5 min-h-0">
            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-on-surface/30">
                {t('analytics.categorias.noTransactions')}
              </p>
            ) : (
              filtered.map((tx) => {
                const account = accounts.find((a) => a.id === tx.accountId)
                return (
                  <div
                    key={tx.id}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors"
                  >
                    {/* Account icon */}
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-low text-on-surface/50">
                      {accountIcon(account?.type ?? 'OTHER')}
                    </span>

                    {/* Description + date */}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-on-surface truncate">
                        {tx.description}
                      </p>
                      <p className="text-[10px] text-on-surface/40">
                        {parseDateLocal(tx.date).toLocaleDateString('pt-BR')}
                      </p>
                    </div>

                    {/* Amount */}
                    <p
                      className={cn(
                        'text-xs font-semibold tabular-nums shrink-0',
                        transactionType === 'INCOME' ? 'text-primary' : 'text-tertiary'
                      )}
                    >
                      {formatCurrency(tx.amount)}
                    </p>
                  </div>
                )
              })
            )}
          </div>

          {/* Footer total */}
          {filtered.length > 0 && (
            <div className="shrink-0 flex items-center justify-between pt-3 border-t border-surface-container-high">
              <p className="text-xs font-semibold text-on-surface/60">{t('common.total')}</p>
              <p
                className={cn(
                  'text-sm font-bold tabular-nums',
                  transactionType === 'INCOME' ? 'text-primary' : 'text-tertiary'
                )}
              >
                {formatCurrency(total)}
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

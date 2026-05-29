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

interface CategoryEntry {
  id: string
  name: string
  icon: string
  color: string
  value: number
  pct: number
}

interface DrilldownState {
  categoryId: string
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

  const { incomeEntries, expenseEntries } = useMemo(() => {
    const txs = transactions.filter((tx) => {
      // CC-17: CREDIT_PAYMENT is liability liquidation, not income/expense
      if (tx.type === 'CREDIT_PAYMENT') return false
      // CC-18: category breakdown uses tx.date (budget perspective, not cash-flow date)
      const d = parseDateLocal(tx.date)
      const inPeriod = d >= startDate && d <= endDate
      const isPaidOk = includeUnpaid || tx.isPaid
      return inPeriod && isPaidOk
    })

    function groupByCategory(type: 'INCOME' | 'EXPENSE'): CategoryEntry[] {
      const map: Record<string, { cat: Category | undefined; amount: number }> = {}
      txs
        .filter((tx) => tx.type === type)
        .forEach((tx) => {
          const cat = categories.find((c) => c.id === tx.categoryId)
          const key = cat?.id ?? '__outros__'
          if (!map[key]) map[key] = { cat, amount: 0 }
          map[key].amount += tx.amount
        })
      const entries = Object.entries(map).map(([key, { cat, amount }]) => ({
        id: key === '__outros__' ? '__outros__' : cat!.id,
        name: cat?.name ?? 'Outros',
        icon: cat?.icon ?? 'tag',
        color: cat?.color ?? '#6B7280',
        value: amount,
        pct: 0,
      }))
      const total = entries.reduce((s, e) => s + e.value, 0)
      if (total > 0) entries.forEach((e) => (e.pct = (e.value / total) * 100))
      return entries.sort((a, b) => b.value - a.value)
    }

    return {
      incomeEntries: groupByCategory('INCOME'),
      expenseEntries: groupByCategory('EXPENSE'),
    }
  }, [transactions, categories, startDate, endDate, includeUnpaid])

  const periodLabel = formatPeriodLabel(startDate, endDate)

  const openDrilldown = (entry: CategoryEntry, type: 'INCOME' | 'EXPENSE') => {
    if (entry.id === '__outros__') return
    setDrilldown({ categoryId: entry.id, categoryName: entry.name, type })
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {/* Income donut */}
        <CategoryDonut
          title={t('analytics.categorias.incomeTitle')}
          entries={incomeEntries}
          type="INCOME"
          shadowClass={shadowClass}
          onEntryClick={(entry) => openDrilldown(entry, 'INCOME')}
        />

        {/* Expenses donut */}
        <CategoryDonut
          title={t('analytics.categorias.expensesTitle')}
          entries={expenseEntries}
          type="EXPENSE"
          shadowClass={shadowClass}
          onEntryClick={(entry) => openDrilldown(entry, 'EXPENSE')}
        />
      </div>

      {/* R-10: Drill-down modal */}
      {drilldown && (
        <DrilldownModal
          categoryId={drilldown.categoryId}
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
  entries: CategoryEntry[]
  type: 'INCOME' | 'EXPENSE'
  shadowClass: string
  onEntryClick: (entry: CategoryEntry) => void
}

function CategoryDonut({ title, entries, shadowClass, onEntryClick }: CategoryDonutProps) {
  const { t } = useTranslation()
  const total = entries.reduce((s, e) => s + e.value, 0)

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
          {/* Donut chart */}
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
                    onClick={() => onEntryClick(entry)}
                  />
                ))}
              </Pie>
            </PieChart>
          </div>

          {/* Legend — all categories, no 5-item limit (R-09) */}
          <div className="flex-1 space-y-2">
            {entries.map((entry) => (
              <button
                key={entry.id}
                onClick={() => onEntryClick(entry)}
                className="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 hover:bg-surface-container-low transition-colors text-left"
              >
                {/* Category icon */}
                <span
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
                  style={{ backgroundColor: entry.color }}
                >
                  {categoryIcon(entry.icon)}
                </span>

                {/* Name */}
                <span className="flex-1 min-w-0 text-xs text-on-surface/70 truncate">
                  {entry.name}
                </span>

                {/* Percentage */}
                <span className="text-[10px] text-on-surface/40 shrink-0">
                  {entry.pct.toFixed(1)}%
                </span>

                {/* Amount */}
                <span className="text-xs font-semibold tabular-nums text-on-surface shrink-0 ml-1">
                  {formatCurrency(entry.value)}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── DrilldownModal ───────────────────────────────────────────────────────────

interface DrilldownModalProps {
  categoryId: string
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
  categoryId,
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
    return transactions.filter((tx) => {
      if (tx.type !== transactionType) return false
      if (tx.categoryId !== categoryId) return false
      // CC-18: use tx.date for category breakdown (budget perspective)
      const d = parseDateLocal(tx.date)
      const inPeriod = d >= startDate && d <= endDate
      const isPaidOk = includeUnpaid || tx.isPaid
      return inPeriod && isPaidOk
    })
  }, [transactions, categoryId, transactionType, startDate, endDate, includeUnpaid])

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

import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { cn, formatCurrency, parseDateLocal, getEffectiveCashFlowDate } from '@/lib/utils'
import type { Transaction, Account } from '@/types'

export interface FaturasViewProps {
  transactions: Transaction[]
  accounts: Account[]
  startDate: Date
  endDate: Date
  shadowClass: string
}

const CARD_COLORS = ['#FF8A83', '#F59E0B', '#8B5CF6', '#06B6D4', '#10B981', '#F97316']

interface MonthBucket {
  label: string
  fullLabel: string
  [accountId: string]: number | string
}

interface GridRow {
  period: string
  cardName: string
  total: number
  isTotal: boolean
}

export default function FaturasView({
  transactions,
  accounts,
  startDate,
  endDate,
  shadowClass,
}: FaturasViewProps) {
  const { t } = useTranslation()

  const creditAccounts = useMemo(() => accounts.filter((a) => a.type === 'CREDIT'), [accounts])

  const { chartData, gridRows } = useMemo(() => {
    const months: { label: string; fullLabel: string; m: number; y: number }[] = []
    const cur = new Date(startDate)
    while (cur <= endDate) {
      const fullLabel = cur
        .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        .replace(/^(.)/, (c) => c.toUpperCase())
      months.push({
        label: cur.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
        fullLabel,
        m: cur.getMonth(),
        y: cur.getFullYear(),
      })
      cur.setMonth(cur.getMonth() + 1)
    }

    const chart: MonthBucket[] = months.map(({ label, fullLabel, m, y }) => {
      const bucket: MonthBucket = { label, fullLabel }
      for (const acc of creditAccounts) {
        const total = transactions
          .filter((tx) => {
            if (tx.type !== 'EXPENSE') return false
            if (tx.accountId !== acc.id) return false
            const d = parseDateLocal(getEffectiveCashFlowDate(tx, accounts))
            return d.getMonth() === m && d.getFullYear() === y
          })
          .reduce((s, tx) => s + tx.amount, 0)
        bucket[acc.id] = total
      }
      return bucket
    })

    const rows: GridRow[] = []
    for (const { fullLabel, m, y } of months) {
      let monthTotal = 0
      for (const acc of creditAccounts) {
        const total = transactions
          .filter((tx) => {
            if (tx.type !== 'EXPENSE') return false
            if (tx.accountId !== acc.id) return false
            const d = parseDateLocal(getEffectiveCashFlowDate(tx, accounts))
            return d.getMonth() === m && d.getFullYear() === y
          })
          .reduce((s, tx) => s + tx.amount, 0)
        if (total > 0 || creditAccounts.length === 1) {
          rows.push({ period: fullLabel, cardName: acc.name, total, isTotal: false })
        }
        monthTotal += total
      }
      if (creditAccounts.length > 1) {
        rows.push({
          period: fullLabel,
          cardName: t('analytics.faturasView.total'),
          total: monthTotal,
          isTotal: true,
        })
      }
    }

    return { chartData: chart, gridRows: rows }
  }, [transactions, accounts, creditAccounts, startDate, endDate, t])

  const hasData = chartData.some((row) => creditAccounts.some((a) => (row[a.id] as number) > 0))

  const tooltipFormatter = (value: number, name: string) => {
    const acc = accounts.find((a) => a.id === name)
    return [formatCurrency(value), acc?.name ?? name]
  }

  const legendFormatter = (value: string) => {
    const acc = accounts.find((a) => a.id === value)
    return acc?.name ?? value
  }

  if (creditAccounts.length === 0 || !hasData) {
    return (
      <div className={cn('rounded-2xl bg-surface-container p-6', shadowClass)}>
        <div className="flex h-40 items-center justify-center">
          <p className="text-sm text-on-surface/30">{t('analytics.faturasView.noData')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={cn('rounded-2xl bg-surface-container p-6 space-y-6', shadowClass)}>
      {/* Stacked bar chart — one bar per month, stacked by credit account */}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(25,28,29,0.04)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: '#9CA3AF' }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
            />
            <Tooltip
              contentStyle={{
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                fontSize: 12,
              }}
              formatter={(value, name) => tooltipFormatter(Number(value), String(name))}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
              formatter={legendFormatter}
            />
            {creditAccounts.map((acc, i) => (
              <Bar
                key={acc.id}
                dataKey={acc.id}
                stackId="invoices"
                fill={CARD_COLORS[i % CARD_COLORS.length]}
                radius={i === creditAccounts.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                maxBarSize={48}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Data grid — Período | Cartão | Total */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 mb-3">
          {t('analytics.faturasView.tableTitle')}
        </p>

        {/* Column headers */}
        <div className="grid grid-cols-3 px-2 pb-2">
          {[
            t('analytics.faturasView.period'),
            t('analytics.faturasView.card'),
            t('analytics.faturasView.total'),
          ].map((col, i) => (
            <p
              key={col}
              className={cn(
                'text-[10px] font-semibold uppercase tracking-wider text-on-surface/40',
                i === 2 && 'text-right'
              )}
            >
              {col}
            </p>
          ))}
        </div>

        {/* Data rows */}
        <div className="space-y-0.5">
          {gridRows.map((row, idx) => (
            <div
              key={`${row.period}-${row.cardName}-${idx}`}
              className={cn(
                'grid grid-cols-3 rounded-xl px-2 py-2',
                row.isTotal
                  ? 'bg-surface-container-low'
                  : 'hover:bg-surface-container-low transition-colors'
              )}
            >
              <p
                className={cn('text-xs text-on-surface', row.isTotal ? 'font-bold' : 'font-medium')}
              >
                {row.isTotal ? '' : row.period}
              </p>
              <p
                className={cn('text-xs text-on-surface', row.isTotal ? 'font-bold' : 'font-medium')}
              >
                {row.cardName}
              </p>
              <p
                className={cn(
                  'text-xs text-right tabular-nums text-tertiary',
                  row.isTotal ? 'font-bold' : 'font-medium'
                )}
              >
                {formatCurrency(row.total)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

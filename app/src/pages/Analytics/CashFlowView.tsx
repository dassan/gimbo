import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import {
  cn,
  formatCurrency,
  parseDateLocal,
  getEffectiveCashFlowDate,
  isCardCredit,
} from '@/lib/utils'
import type { Transaction, Account } from '@/types'

export interface CashFlowViewProps {
  transactions: Transaction[]
  accounts: Account[]
  startDate: Date
  endDate: Date
  includeUnpaid: boolean
  shadowClass: string
  accountId?: string
}

interface PeriodRow {
  label: string
  fullLabel: string
  income: number
  expenses: number
  result: number
  balance: number
}

export default function CashFlowView({
  transactions,
  accounts,
  startDate,
  endDate,
  includeUnpaid,
  shadowClass,
  accountId,
}: CashFlowViewProps) {
  const { t } = useTranslation()

  const rows = useMemo((): PeriodRow[] => {
    // M-38: when the selected period is exactly one full calendar month, break the axis into
    // weekly buckets (1–7, 8–14, …) for a richer view; otherwise keep one bucket per month.
    const lastOfMonth = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 0).getDate()
    const isFullMonth =
      startDate.getDate() === 1 &&
      startDate.getFullYear() === endDate.getFullYear() &&
      startDate.getMonth() === endDate.getMonth() &&
      endDate.getDate() === lastOfMonth

    type Bucket = { label: string; fullLabel: string; match: (d: Date) => boolean }
    const buckets: Bucket[] = []

    if (isFullMonth) {
      const y = startDate.getFullYear()
      const m = startDate.getMonth()
      const monthShort = new Date(y, m, 1)
        .toLocaleDateString('pt-BR', { month: 'short' })
        .replace('.', '')
      for (let lo = 1; lo <= lastOfMonth; lo += 7) {
        const hi = Math.min(lo + 6, lastOfMonth)
        buckets.push({
          label: `${lo}–${hi}`,
          fullLabel: `${lo}–${hi} ${monthShort}`,
          match: (d) =>
            d.getFullYear() === y && d.getMonth() === m && d.getDate() >= lo && d.getDate() <= hi,
        })
      }
    } else {
      const cur = new Date(startDate)
      while (cur <= endDate) {
        const y = cur.getFullYear()
        const m = cur.getMonth()
        const fullLabel = cur
          .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
          .replace(/^(.)/, (c) => c.toUpperCase())
        buckets.push({
          label: cur.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase(),
          fullLabel,
          match: (d) => d.getMonth() === m && d.getFullYear() === y,
        })
        cur.setMonth(cur.getMonth() + 1)
      }
    }

    let cumulative = 0
    return buckets.map(({ label, fullLabel, match }) => {
      const txs = transactions.filter((tx) => {
        // CC-17: CREDIT_PAYMENT is liability liquidation, not income/expense
        if (tx.type === 'CREDIT_PAYMENT') return false
        if (accountId !== undefined && tx.accountId !== accountId) return false
        // CC-16: project credit card expenses to invoice due date
        const d = parseDateLocal(getEffectiveCashFlowDate(tx, accounts))
        const isPaidOk = includeUnpaid || tx.isPaid
        return match(d) && isPaidOk
      })
      // Card credits (estornos) are INCOME on a CREDIT account — net them against expenses
      // rather than counting fake income (keeps the income bar honest).
      let income = 0
      let expenses = 0
      for (const t of txs) {
        if (t.type === 'INCOME') {
          if (isCardCredit(t, accounts)) expenses -= t.amount
          else income += t.amount
        } else if (t.type === 'EXPENSE') {
          expenses += t.amount
        }
      }
      const result = income - expenses
      cumulative += result
      return { label, fullLabel, income, expenses, result, balance: cumulative }
    })
  }, [transactions, accounts, startDate, endDate, includeUnpaid, accountId])

  const hasData = rows.some((r) => r.income !== 0 || r.expenses !== 0)

  const tooltipLabels: Record<string, string> = {
    income: t('analytics.cashflowView.income'),
    expenses: t('analytics.cashflowView.expenses'),
    balance: t('analytics.cashflowView.balance'),
  }

  return (
    <div className={cn('rounded-2xl bg-surface-container p-6 space-y-6', shadowClass)}>
      {/* R-07: ComposedChart — bars for income/expenses + line for accumulated balance */}
      <div className="h-56">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={rows} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
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
                formatter={(value, name) => [
                  formatCurrency(Number(value)),
                  tooltipLabels[name as string] ?? String(name),
                ]}
              />
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                formatter={(value) => tooltipLabels[String(value)] ?? String(value)}
              />
              <Bar dataKey="income" fill="#2D6A4F" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Bar dataKey="expenses" fill="#C0392B" radius={[4, 4, 0, 0]} maxBarSize={32} />
              <Line
                type="monotone"
                dataKey="balance"
                stroke="#1F4D38"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-on-surface/30">{t('common.noData')}</p>
          </div>
        )}
      </div>

      {/* R-08: Data grid table — one row per sub-period, no borders (No-Line Rule) */}
      {hasData && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 mb-3">
            {t('analytics.cashflowView.tableTitle')}
          </p>

          {/* Column headers */}
          <div className="grid grid-cols-5 px-2 pb-2">
            {[
              t('analytics.cashflowView.period'),
              t('analytics.cashflowView.income'),
              t('analytics.cashflowView.expenses'),
              t('analytics.cashflowView.result'),
              t('analytics.cashflowView.balance'),
            ].map((col, i) => (
              <p
                key={col}
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-wider text-on-surface/40',
                  i > 0 && 'text-right'
                )}
              >
                {col}
              </p>
            ))}
          </div>

          {/* Data rows */}
          <div className="space-y-0.5">
            {rows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-5 rounded-xl px-2 py-2 hover:bg-surface-container-low transition-colors"
              >
                <p className="text-xs font-medium text-on-surface">{row.fullLabel}</p>
                <p className="text-xs text-right text-primary font-medium tabular-nums">
                  {formatCurrency(row.income)}
                </p>
                <p className="text-xs text-right text-tertiary font-medium tabular-nums">
                  {formatCurrency(row.expenses)}
                </p>
                <p
                  className={cn(
                    'text-xs text-right font-medium tabular-nums',
                    row.result >= 0 ? 'text-primary' : 'text-tertiary'
                  )}
                >
                  {formatCurrency(row.result)}
                </p>
                <p
                  className={cn(
                    'text-xs text-right font-bold tabular-nums',
                    row.balance >= 0 ? 'text-primary' : 'text-tertiary'
                  )}
                >
                  {formatCurrency(row.balance)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

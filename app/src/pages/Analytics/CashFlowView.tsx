import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ComposedChart,
  Bar,
  Cell,
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
  isCashRealized,
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
  // M-62: true when at least one transaction aggregated into this bucket is virtual
  // (tagged isProjected by lib/utils.ts projectRecurringOccurrences, merged in by
  // Analytics/index.tsx) — driven by the actual transaction, not an inferred date cutoff,
  // so a sparse far-future real entry elsewhere in the dataset can't mask genuine guesses.
  isProjected: boolean
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

    // Anchor the running "Saldo" to the real opening balance (M-40): the cash accounts' balance
    // at the start of the period. Without it the line started from zero, diverging from the
    // statement by the whole opening balance. CREDIT accounts are excluded — their spending shows
    // up in the flow as EXPENSE by invoice due date, not as a cash balance. The opening uses the
    // payment model (tx.date, realized); a card charge across the boundary is counted once (by its
    // due date in the flow, never in this opening), so there is no double-count.
    const scopeIds = new Set(
      accounts
        .filter((a) => a.type !== 'CREDIT' && (accountId === undefined || a.id === accountId))
        .map((a) => a.id)
    )
    let opening = accounts.filter((a) => scopeIds.has(a.id)).reduce((s, a) => s + a.balance, 0)
    for (const tx of transactions) {
      if (parseDateLocal(tx.date) >= startDate) continue // strictly before the period
      if (!isCashRealized(tx)) continue
      if (tx.type === 'TRANSFER') {
        if (scopeIds.has(tx.accountId)) opening -= tx.amount
        if (tx.transferAccountId && scopeIds.has(tx.transferAccountId)) opening += tx.amount
      } else if (tx.type === 'CREDIT_PAYMENT') {
        if (tx.transferAccountId && scopeIds.has(tx.transferAccountId)) opening -= tx.amount
      } else if (scopeIds.has(tx.accountId)) {
        if (tx.type === 'INCOME') opening += tx.amount
        else if (tx.type === 'EXPENSE') opening -= tx.amount
      }
    }

    let cumulative = opening
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
      const isProjected = txs.some((tx) => 'isProjected' in tx)
      return { label, fullLabel, income, expenses, result, balance: cumulative, isProjected }
    })
  }, [transactions, accounts, startDate, endDate, includeUnpaid, accountId])

  const hasData = rows.some((r) => r.income !== 0 || r.expenses !== 0)

  // M-53: `label` (e.g. "MAR") repeats across years in multi-year periods. Recharts indexes
  // the active tooltip point by the XAxis dataKey value, so duplicated labels make it resolve
  // to the first matching bucket — the chart line/dot render at the right position, but the
  // tooltip shows the first year's values. `fullLabel` (e.g. "Março de 2026"/"Março de 2027")
  // is always unique, so use it as the dataKey and format the axis tick back to the short form.
  const shortLabelByFullLabel = useMemo(
    () => new Map(rows.map((r) => [r.fullLabel, r.label])),
    [rows]
  )

  const tooltipLabels: Record<string, string> = {
    income: t('analytics.cashflowView.income'),
    expenses: t('analytics.cashflowView.expenses'),
    balance: t('analytics.cashflowView.balance'),
  }

  // M-62: split "balance" into a solid (real) and dashed (projected) segment that share the
  // boundary point so the line reads as continuous — Recharts doesn't bridge across series,
  // so the boundary bucket's value is duplicated into both. Once a bucket contains a guessed
  // transaction the running cumulative is itself no longer purely real, so every bucket from
  // there on stays in the projected segment even if it has no projected tx of its own.
  const balanceLabel = t('analytics.cashflowView.balance')
  const balanceProjectedLabel = `${balanceLabel} (${t('analytics.cashflowView.projectedLabel')})`
  const firstProjectedIdx = rows.findIndex((r) => r.isProjected)
  const hasProjectedData = firstProjectedIdx !== -1
  const chartData = useMemo(() => {
    const lastRealIdx = hasProjectedData ? firstProjectedIdx - 1 : rows.length - 1
    return rows.map((r, i) => ({
      ...r,
      balanceReal: i <= lastRealIdx ? r.balance : null,
      balanceProjected: i >= lastRealIdx ? r.balance : null,
    }))
  }, [rows, firstProjectedIdx, hasProjectedData])

  return (
    <div className={cn('rounded-2xl bg-surface-container p-6 space-y-6', shadowClass)}>
      {/* R-07: ComposedChart — bars for income/expenses + line for accumulated balance */}
      <div className="h-56">
        {hasData ? (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(25,28,29,0.04)" vertical={false} />
              <XAxis
                dataKey="fullLabel"
                tickFormatter={(fullLabel: string) =>
                  shortLabelByFullLabel.get(fullLabel) ?? fullLabel
                }
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
              {/* M-62: projected buckets render with reduced opacity (no dash support on Bar) */}
              <Bar dataKey="income" fill="#2D6A4F" radius={[4, 4, 0, 0]} maxBarSize={32}>
                {chartData.map((r, i) => (
                  <Cell key={`income-${i}`} fillOpacity={r.isProjected ? 0.35 : 1} />
                ))}
              </Bar>
              <Bar dataKey="expenses" fill="#C0392B" radius={[4, 4, 0, 0]} maxBarSize={32}>
                {chartData.map((r, i) => (
                  <Cell key={`expenses-${i}`} fillOpacity={r.isProjected ? 0.35 : 1} />
                ))}
              </Bar>
              <Line
                type="monotone"
                dataKey="balanceReal"
                name={balanceLabel}
                stroke="#1F4D38"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
                connectNulls={false}
              />
              {/* Only rendered when this view actually has projected data — otherwise the
                  legend would promise a dashed segment that never appears (confusing). */}
              {hasProjectedData && (
                <Line
                  type="monotone"
                  dataKey="balanceProjected"
                  name={balanceProjectedLabel}
                  stroke="#1F4D38"
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls={false}
                />
              )}
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
                key={row.fullLabel}
                className={cn(
                  'grid grid-cols-5 rounded-xl px-2 py-2 hover:bg-surface-container-low transition-colors',
                  row.isProjected && 'opacity-60'
                )}
              >
                <p className="text-xs font-medium text-on-surface">
                  {row.fullLabel}
                  {row.isProjected && (
                    <span className="ml-1.5 text-[10px] font-normal italic text-on-surface/40">
                      ({t('analytics.cashflowView.projectedLabel')})
                    </span>
                  )}
                </p>
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

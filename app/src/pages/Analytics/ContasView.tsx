import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Landmark,
  PiggyBank,
  CreditCard,
  Bitcoin,
  ArrowLeftRight,
  Briefcase,
  TrendingUp,
  MoreHorizontal,
  ChevronLeft,
} from 'lucide-react'
import { cn, formatCurrency, parseDateLocal, getEffectiveCashFlowDate } from '@/lib/utils'
import type { Transaction, Account, AccountType } from '@/types'
import CashFlowView from './CashFlowView'

export interface ContasViewProps {
  transactions: Transaction[]
  accounts: Account[]
  startDate: Date
  endDate: Date
  includeUnpaid: boolean
  shadowClass: string
}

// ─── Account type icons (size 18, mirrors Dashboard) ─────────────────────────

const ACCOUNT_TYPE_ICONS: Record<AccountType, React.ReactNode> = {
  RETAIL: <Landmark size={18} strokeWidth={1.5} />,
  SAVINGS: <PiggyBank size={18} strokeWidth={1.5} />,
  CREDIT: <CreditCard size={18} strokeWidth={1.5} />,
  CRYPTO: <Bitcoin size={18} strokeWidth={1.5} />,
  FOREX: <ArrowLeftRight size={18} strokeWidth={1.5} />,
  ASSET: <Briefcase size={18} strokeWidth={1.5} />,
  STOCKS: <TrendingUp size={18} strokeWidth={1.5} />,
  OTHER: <MoreHorizontal size={18} strokeWidth={1.5} />,
}

const ACCOUNT_TYPE_COLORS: Record<AccountType, string> = {
  RETAIL: '#3B82F6',
  SAVINGS: '#3D9E82',
  CREDIT: '#1F2937',
  CRYPTO: '#F59E0B',
  FOREX: '#8B5CF6',
  ASSET: '#6B7280',
  STOCKS: '#2D6A4F',
  OTHER: '#9CA3AF',
}

// ─── Summary per non-CREDIT account ──────────────────────────────────────────

interface AccountSummary {
  account: Account
  income: number
  expenses: number
  result: number
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ContasView({
  transactions,
  accounts,
  startDate,
  endDate,
  includeUnpaid,
  shadowClass,
}: ContasViewProps) {
  const { t } = useTranslation()
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null)

  // ── Split accounts into non-CREDIT and CREDIT ─────────────────────────────
  const regularAccounts = useMemo(
    () => accounts.filter((a) => a.type !== 'CREDIT' && a.includeInBalance),
    [accounts]
  )
  const creditAccounts = useMemo(
    () => accounts.filter((a) => a.type === 'CREDIT' && a.includeInBalance),
    [accounts]
  )

  // ── Compute income/expenses/result per non-CREDIT account ─────────────────
  const summaries = useMemo((): AccountSummary[] => {
    return regularAccounts.map((account) => {
      const txs = transactions.filter((tx) => {
        if (tx.type === 'CREDIT_PAYMENT') return false
        if (tx.accountId !== account.id) return false
        // Use effective cash-flow date (CC-16)
        const d = parseDateLocal(getEffectiveCashFlowDate(tx, accounts))
        const inPeriod = d >= startDate && d <= endDate
        const isPaidOk = includeUnpaid || tx.isPaid
        return inPeriod && isPaidOk
      })
      const income = txs.filter((tx) => tx.type === 'INCOME').reduce((s, tx) => s + tx.amount, 0)
      const expenses = txs.filter((tx) => tx.type === 'EXPENSE').reduce((s, tx) => s + tx.amount, 0)
      return { account, income, expenses, result: income - expenses }
    })
  }, [regularAccounts, transactions, accounts, startDate, endDate, includeUnpaid])

  // ── Compute current invoice total per CREDIT account for the period ───────
  const creditSummaries = useMemo(() => {
    return creditAccounts.map((account) => {
      const txs = transactions.filter((tx) => {
        if (tx.type === 'CREDIT_PAYMENT') return false
        if (tx.type !== 'EXPENSE') return false
        if (tx.accountId !== account.id) return false
        const d = parseDateLocal(tx.date)
        const inPeriod = d >= startDate && d <= endDate
        const isPaidOk = includeUnpaid || tx.isPaid
        return inPeriod && isPaidOk
      })
      const total = txs.reduce((s, tx) => s + tx.amount, 0)
      return { account, invoiceTotal: total }
    })
  }, [creditAccounts, transactions, startDate, endDate, includeUnpaid])

  // ── Drill-down: show CashFlowView for selected account ────────────────────
  if (selectedAccountId !== null) {
    const account = accounts.find((a) => a.id === selectedAccountId)
    return (
      <div className="space-y-4">
        {/* Drill-down header */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedAccountId(null)}
            className="flex items-center gap-1.5 rounded-full bg-surface-container-low px-3 py-1.5 text-xs font-medium text-on-surface/70 hover:bg-surface-container-high transition-colors"
          >
            <ChevronLeft size={14} strokeWidth={2} />
            {t('analytics.contas.back')}
          </button>
          {account && <span className="text-sm font-semibold text-on-surface">{account.name}</span>}
        </div>

        {/* R-12: CashFlowView filtered to the selected account */}
        <CashFlowView
          transactions={transactions}
          accounts={accounts}
          startDate={startDate}
          endDate={endDate}
          includeUnpaid={includeUnpaid}
          shadowClass={shadowClass}
          accountId={selectedAccountId}
        />
      </div>
    )
  }

  // ── Grid view ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Non-CREDIT accounts grid */}
      {summaries.length === 0 && creditSummaries.length === 0 ? (
        <div className={cn('rounded-2xl bg-surface-container p-12 text-center', shadowClass)}>
          <p className="text-sm text-on-surface/30">{t('analytics.contas.selectPrompt')}</p>
        </div>
      ) : (
        <>
          {summaries.length > 0 && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summaries.map(({ account, income, expenses, result }) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  income={income}
                  expenses={expenses}
                  result={result}
                  shadowClass={shadowClass}
                  onClick={() => setSelectedAccountId(account.id)}
                  incomeLabel={t('analytics.cashflowView.income')}
                  expensesLabel={t('analytics.cashflowView.expenses')}
                  resultLabel={t('analytics.contas.result')}
                />
              ))}
            </div>
          )}

          {/* CREDIT accounts section */}
          {creditSummaries.length > 0 && (
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40">
                {t('settings.creditCards')}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {creditSummaries.map(({ account, invoiceTotal }) => (
                  <CreditAccountCard
                    key={account.id}
                    account={account}
                    invoiceTotal={invoiceTotal}
                    shadowClass={shadowClass}
                    onClick={() => setSelectedAccountId(account.id)}
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── AccountCard ──────────────────────────────────────────────────────────────

interface AccountCardProps {
  account: Account
  income: number
  expenses: number
  result: number
  shadowClass: string
  onClick: () => void
  incomeLabel: string
  expensesLabel: string
  resultLabel: string
}

function AccountCard({
  account,
  income,
  expenses,
  result,
  shadowClass,
  onClick,
  incomeLabel,
  expensesLabel,
  resultLabel,
}: AccountCardProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-surface-container p-5 text-left transition-all hover:scale-[1.02] active:scale-[0.97]',
        shadowClass
      )}
    >
      {/* Account icon + name */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: ACCOUNT_TYPE_COLORS[account.type] }}
        >
          {ACCOUNT_TYPE_ICONS[account.type]}
        </div>
        <p className="text-sm font-semibold text-on-surface truncate">{account.name}</p>
      </div>

      {/* Stats */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-on-surface/40">{incomeLabel}</p>
          <p className="text-xs font-medium tabular-nums text-primary">{formatCurrency(income)}</p>
        </div>
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-on-surface/40">{expensesLabel}</p>
          <p className="text-xs font-medium tabular-nums text-tertiary">
            {formatCurrency(expenses)}
          </p>
        </div>
        <div className="flex items-center justify-between pt-1 border-t border-surface-container-high">
          <p className="text-[10px] font-semibold text-on-surface/60 uppercase tracking-wide">
            {resultLabel}
          </p>
          <p
            className={cn(
              'text-sm font-bold tabular-nums',
              result >= 0 ? 'text-primary' : 'text-tertiary'
            )}
          >
            {formatCurrency(result)}
          </p>
        </div>
      </div>
    </button>
  )
}

// ─── CreditAccountCard ────────────────────────────────────────────────────────

interface CreditAccountCardProps {
  account: Account
  invoiceTotal: number
  shadowClass: string
  onClick: () => void
}

function CreditAccountCard({
  account,
  invoiceTotal,
  shadowClass,
  onClick,
}: CreditAccountCardProps) {
  const { t } = useTranslation()
  const available =
    account.creditMetadata != null ? account.creditMetadata.limit - invoiceTotal : null

  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-2xl bg-surface-container p-5 text-left transition-all hover:scale-[1.02] active:scale-[0.97]',
        shadowClass
      )}
    >
      {/* Account icon + name */}
      <div className="flex items-center gap-3 mb-4">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: ACCOUNT_TYPE_COLORS.CREDIT }}
        >
          {ACCOUNT_TYPE_ICONS.CREDIT}
        </div>
        <p className="text-sm font-semibold text-on-surface truncate">{account.name}</p>
      </div>

      {/* Stats */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-on-surface/40">{t('analytics.cashflowView.expenses')}</p>
          <p className="text-xs font-medium tabular-nums text-tertiary">
            {formatCurrency(invoiceTotal)}
          </p>
        </div>
        {available !== null && (
          <div className="flex items-center justify-between pt-1 border-t border-surface-container-high">
            <p className="text-[10px] font-semibold text-on-surface/60 uppercase tracking-wide">
              {t('accounts.availableLimit')}
            </p>
            <p
              className={cn(
                'text-sm font-bold tabular-nums',
                available >= 0 ? 'text-on-surface' : 'text-tertiary'
              )}
            >
              {formatCurrency(available)}
            </p>
          </div>
        )}
      </div>
    </button>
  )
}

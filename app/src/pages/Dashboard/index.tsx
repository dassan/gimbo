import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import {
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  Clock,
  Landmark,
  PiggyBank,
  CreditCard,
  Bitcoin,
  ArrowLeftRight,
  Briefcase,
  MoreHorizontal,
} from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  formatCurrency,
  cn,
  parseDateLocal,
  getCurrentInvoiceBalance,
  getEffectiveCashFlowDate,
} from '@/lib/utils'
import type { Account, Transaction, AccountType } from '@/types'

// ─── Account type config ──────────────────────────────────────────────────────

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

// ─── Credit issuer colors (M-23) ─────────────────────────────────────────────
const CREDIT_ISSUER_COLORS: Record<string, string> = {
  nubank: '#820AD1',
  itau: '#EC7000',
  bradesco: '#CC092F',
  inter: '#FF7A00',
  santander: '#EC0000',
  caixa: '#006CB4',
}
function getIssuerColor(issuerIcon?: string): string {
  if (!issuerIcon || issuerIcon === 'generic') return ACCOUNT_TYPE_COLORS.CREDIT
  return CREDIT_ISSUER_COLORS[issuerIcon] ?? ACCOUNT_TYPE_COLORS.CREDIT
}

// ─── Colour palette for donut chart ──────────────────────────────────────────
const DONUT_COLORS = ['#2D6A4F', '#1B4F72', '#D4A017', '#C0392B', '#3D9E82', '#A8AA9F']

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const data = useDataStore((s) => s.data)
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )

  const now = useMemo(() => new Date(), [])

  // ── Current month stats ───────────────────────────────────────────────────
  const { income, expenses, balance, recentTxs } = useMemo(() => {
    if (!data) return { income: 0, expenses: 0, balance: 0, recentTxs: [] }
    const m = now.getMonth(),
      y = now.getFullYear()
    // Use effective cash-flow date (B-09): CREDIT expenses land in the invoice due month,
    // not the purchase month. CREDIT_PAYMENT is excluded — it is liability settlement,
    // not income or expense (same rule applied in Analytics CC-17).
    const monthly = data.transactions.filter((tx) => {
      if (tx.type === 'CREDIT_PAYMENT') return false
      const effectiveDate = parseDateLocal(getEffectiveCashFlowDate(tx, data.accounts))
      return effectiveDate.getMonth() === m && effectiveDate.getFullYear() === y
    })
    const income = monthly.filter((tx) => tx.type === 'INCOME').reduce((s, tx) => s + tx.amount, 0)
    const expenses = monthly
      .filter((tx) => tx.type === 'EXPENSE')
      .reduce((s, tx) => s + tx.amount, 0)
    // M-25: for installment groups, show only the first installment (currentIndex === 1)
    // to prevent a single purchase split into N parts from flooding the list.
    const recentTxs = [...data.transactions]
      .filter((tx) => !tx.installment || tx.installment.currentIndex === 1)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 5)
    return { income, expenses, balance: income - expenses, recentTxs }
  }, [data, now])

  // ── Account balances (derived from transactions) ──────────────────────────
  // For CREDIT accounts with creditMetadata: available limit = limit − current invoice balance.
  // For CREDIT accounts without creditMetadata: 0.
  // For all other account types: standard flow (INCOME+, EXPENSE−, TRANSFER−).
  const accountBalances = useMemo<Record<string, number>>(() => {
    if (!data) return {}
    const map: Record<string, number> = {}

    // Standard flow for non-CREDIT accounts: seed with initialBalance (account.balance),
    // then apply transactions. This lets users set a starting balance at account creation.
    data.accounts
      .filter((a) => a.type !== 'CREDIT')
      .forEach((a) => {
        map[a.id] = a.balance
      })

    data.transactions.forEach((tx) => {
      const account = data.accounts.find((a) => a.id === tx.accountId)
      if (!account || account.type === 'CREDIT') return
      if (tx.type === 'INCOME') map[tx.accountId] = (map[tx.accountId] ?? 0) + tx.amount
      if (tx.type === 'EXPENSE') map[tx.accountId] = (map[tx.accountId] ?? 0) - tx.amount
      if (tx.type === 'TRANSFER') {
        map[tx.accountId] = (map[tx.accountId] ?? 0) - tx.amount
        if (tx.transferAccountId) {
          const dest = data.accounts.find((a) => a.id === tx.transferAccountId)
          if (dest && dest.type !== 'CREDIT') {
            map[tx.transferAccountId] = (map[tx.transferAccountId] ?? 0) + tx.amount
          }
        }
      }
    })

    // CREDIT accounts: available limit = creditMetadata.limit − current invoice balance
    data.accounts
      .filter((a) => a.type === 'CREDIT')
      .forEach((account) => {
        if (!account.creditMetadata) {
          map[account.id] = 0
          return
        }
        const invoiceBalance = getCurrentInvoiceBalance(data.transactions, account)
        map[account.id] = account.creditMetadata.limit - invoiceBalance
      })

    return map
  }, [data])

  // ── Total invoice balance across all CREDIT accounts ─────────────────────
  const totalInvoiceBalance = useMemo(() => {
    if (!data) return 0
    return data.accounts
      .filter((a) => a.type === 'CREDIT' && a.creditMetadata != null)
      .reduce((sum, acc) => sum + getCurrentInvoiceBalance(data.transactions, acc), 0)
  }, [data])

  // ── Expenses by category (donut) ──────────────────────────────────────────
  const donutData = useMemo(() => {
    if (!data) return []
    const m = now.getMonth(),
      y = now.getFullYear()
    const expTxs = data.transactions.filter((tx) => {
      const d = parseDateLocal(tx.date)
      return tx.type === 'EXPENSE' && d.getMonth() === m && d.getFullYear() === y
    })
    const byCategory: Record<string, number> = {}
    expTxs.forEach((tx) => {
      const cat = data.categories.find((c) => c.id === tx.categoryId)
      const name = cat?.name ?? 'Outros'
      byCategory[name] = (byCategory[name] ?? 0) + tx.amount
    })
    const total = Object.values(byCategory).reduce((s, v) => s + v, 0) || 1
    return Object.entries(byCategory)
      .map(([name, value]) => ({ name, value, pct: Math.round((value / total) * 100) }))
      .sort((a, b) => b.value - a.value)
  }, [data, now])

  if (!data) return null

  // Non-CREDIT accounts with includeInBalance: displayed in "Minhas Contas"
  const visibleAccounts = data.accounts.filter((a) => a.type !== 'CREDIT' && a.includeInBalance)
  // All CREDIT accounts: displayed in "Meus Cartões"
  const creditAccounts = data.accounts.filter((a) => a.type === 'CREDIT')

  const currentMonthName = (() => {
    const name = now.toLocaleString(i18n.language, { month: 'long' })
    return name.charAt(0).toUpperCase() + name.slice(1)
  })()

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Stat cards ─────────────────────────────────────────────────── */}
      {/* Mobile: single column. Desktop: 3-column. */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label={t('dashboard.income')}
          value={formatCurrency(income)}
          icon={<TrendingUp size={16} strokeWidth={1.5} />}
          variant="income"
          shadowClass={shadowClass}
        />
        <StatCard
          label={t('dashboard.expenses')}
          value={formatCurrency(expenses)}
          icon={<TrendingDown size={16} strokeWidth={1.5} />}
          variant="expense"
          shadowClass={shadowClass}
        />
        <StatCard
          label={t('dashboard.balance')}
          value={formatCurrency(balance)}
          variant="balance"
          shadowClass={shadowClass}
        />
      </div>

      {/* ── Minhas Contas + Meus Cartões ────────────────────────────────── */}
      {/* Mobile: Minhas Contas full-width only. Desktop: side-by-side. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {/* My Accounts — standard accounts with includeInBalance */}
        <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
          <h3 className="text-sm font-semibold text-on-surface mb-4">
            {t('dashboard.myAccounts')}
          </h3>

          {visibleAccounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-on-surface/40">{t('common.noData')}</p>
          ) : (
            <div className="space-y-1">
              {visibleAccounts.map((acc) => (
                <AccountRow
                  key={acc.id}
                  name={acc.name}
                  type={acc.type}
                  balance={accountBalances[acc.id] ?? 0}
                  typeLabel={t(`accounts.${acc.type.toLowerCase()}`)}
                />
              ))}
            </div>
          )}
        </div>

        {/* My Cards */}
        <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-on-surface">{t('dashboard.myCards')}</h3>
            {creditAccounts.length > 0 && (
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium leading-none mb-0.5">
                  {t('dashboard.totalInvoices', { month: currentMonthName })}
                </p>
                <p
                  className={cn(
                    'text-sm font-bold tabular-nums',
                    totalInvoiceBalance > 0 ? 'text-tertiary' : 'text-on-surface/40'
                  )}
                >
                  {totalInvoiceBalance > 0 ? '-\u00a0' : ''}
                  {formatCurrency(totalInvoiceBalance)}
                </p>
              </div>
            )}
          </div>

          {creditAccounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-on-surface/40">{t('dashboard.noCards')}</p>
          ) : (
            <div className="space-y-4">
              {creditAccounts.map((acc) => (
                <CreditCardRow
                  key={acc.id}
                  account={acc}
                  availableLimit={accountBalances[acc.id] ?? 0}
                  invoiceBalance={
                    acc.creditMetadata ? getCurrentInvoiceBalance(data.transactions, acc) : 0
                  }
                  invoiceLabel={t('dashboard.invoice')}
                  availableLimitLabel={t('accounts.availableLimit')}
                  onDetails={() => void navigate(`/credit-card/${acc.id}`)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Bottom row: Recent transactions + Donut — desktop only (MB-03) ── */}
      <div className="hidden sm:grid grid-cols-2 gap-4">
        {/* Recent transactions — 1/2 */}
        <div className={cn('rounded-2xl bg-surface-container p-6', shadowClass)}>
          <RecentTransactionsHeader t={t} onViewAll={() => void navigate('/transactions')} />
          <RecentTransactionsList recentTxs={recentTxs} data={data} t={t} />
        </div>

        {/* Expenses by category donut — 1/2 */}
        <div className={cn('rounded-2xl bg-surface-container p-6', shadowClass)}>
          <h3 className="text-sm font-semibold text-on-surface mb-4">
            {t('dashboard.byCategory')}
          </h3>
          <DonutSection donutData={donutData} t={t} />
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AccountRow({
  name,
  type,
  balance,
  typeLabel,
}: {
  name: string
  type: AccountType
  balance: number
  typeLabel: string
}) {
  const isNegative = balance < 0
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundColor: ACCOUNT_TYPE_COLORS[type] }}
      >
        {ACCOUNT_TYPE_ICONS[type]}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{name}</p>
        <p className="text-xs text-on-surface/40 mt-0.5">{typeLabel}</p>
      </div>
      <span
        className={cn(
          'text-sm font-semibold shrink-0 tabular-nums',
          isNegative ? 'text-tertiary' : 'text-on-surface'
        )}
      >
        {formatCurrency(balance)}
      </span>
    </div>
  )
}

function CreditCardRow({
  account,
  availableLimit,
  invoiceBalance,
  invoiceLabel,
  availableLimitLabel,
  onDetails,
}: {
  account: Account
  availableLimit: number
  invoiceBalance: number
  invoiceLabel: string
  availableLimitLabel: string
  onDetails?: () => void
}) {
  const limit = account.creditMetadata?.limit ?? 0
  const utilizationPct = limit > 0 ? Math.min((invoiceBalance / limit) * 100, 100) : 0
  const isOverLimit = availableLimit < 0

  return (
    <div
      role={onDetails ? 'button' : undefined}
      tabIndex={onDetails ? 0 : undefined}
      onClick={onDetails}
      onKeyDown={onDetails ? (e) => e.key === 'Enter' && onDetails() : undefined}
      className={cn(
        'rounded-xl border border-surface-container-low px-4 py-3 space-y-2',
        onDetails && 'cursor-pointer hover:bg-surface-container-low transition-colors'
      )}
    >
      {/* Card name + icon — M-23: color reflects issuer branding */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: getIssuerColor(account.issuerIcon) }}
        >
          <CreditCard size={18} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-on-surface truncate flex-1">{account.name}</p>
      </div>

      {/* Invoice + available limit */}
      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {invoiceLabel}
          </p>
          <p className="text-base font-bold tabular-nums text-on-surface">
            {formatCurrency(invoiceBalance)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {availableLimitLabel}
          </p>
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              isOverLimit ? 'text-tertiary' : 'text-primary'
            )}
          >
            {formatCurrency(availableLimit)}
          </p>
        </div>
      </div>

      {/* Utilization progress bar */}
      {limit > 0 && (
        <div className="h-1.5 w-full rounded-full bg-surface-container-low overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              utilizationPct >= 90
                ? 'bg-tertiary'
                : utilizationPct >= 70
                  ? 'bg-amber-400'
                  : 'bg-primary'
            )}
            style={{ width: `${utilizationPct}%` }}
          />
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  icon,
  variant,
  shadowClass,
}: {
  label: string
  value: string
  icon?: React.ReactNode
  variant: 'income' | 'expense' | 'balance'
  shadowClass: string
}) {
  const isBalance = variant === 'balance'
  return (
    <div
      className={cn(
        'rounded-2xl p-5',
        isBalance ? 'bg-primary text-white' : 'bg-surface-container',
        !isBalance && shadowClass
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <span className={cn('label', isBalance ? 'text-white/60' : 'text-on-surface/40')}>
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-full',
              variant === 'income'
                ? 'bg-primary/10 text-primary'
                : variant === 'expense'
                  ? 'bg-tertiary/10 text-tertiary'
                  : 'bg-white/20 text-white'
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          'text-2xl font-bold tabular-nums',
          isBalance ? 'text-white' : variant === 'income' ? 'text-primary' : 'text-tertiary'
        )}
      >
        {value}
      </p>
    </div>
  )
}

function RecentTransactionsHeader({
  t,
  onViewAll,
}: {
  t: (key: string) => string
  onViewAll: () => void
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h3 className="text-sm font-semibold text-on-surface">{t('dashboard.recentTransactions')}</h3>
      <button onClick={onViewAll} className="text-xs font-medium text-primary hover:underline">
        {t('dashboard.viewAll')}
      </button>
    </div>
  )
}

function RecentTransactionsList({
  recentTxs,
  data,
  t,
}: {
  recentTxs: Transaction[]
  data: NonNullable<ReturnType<typeof useDataStore.getState>['data']>
  t: (key: string) => string
}) {
  if (recentTxs.length === 0) {
    return <p className="py-8 text-center text-sm text-on-surface/40">{t('common.noData')}</p>
  }
  return (
    <div className="space-y-1">
      {recentTxs.map((tx) => (
        <TransactionRow key={tx.id} tx={tx} data={data} />
      ))}
    </div>
  )
}

function DonutSection({
  donutData,
  t,
}: {
  donutData: { name: string; value: number; pct: number }[]
  t: (key: string) => string
}) {
  if (donutData.length === 0) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center">
        <p className="text-sm text-on-surface/30">{t('common.noData')}</p>
      </div>
    )
  }

  const top5 = donutData.slice(0, 5)

  return (
    <div className="flex items-center gap-4">
      {/* Donut chart — no center label */}
      <div className="relative h-72 w-72 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={donutData}
              cx="50%"
              cy="50%"
              innerRadius={76}
              outerRadius={120}
              paddingAngle={2}
              dataKey="value"
              strokeWidth={0}
            >
              {donutData.map((_, i) => (
                <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Top 5 categories */}
      <div className="flex-1 space-y-2.5">
        {top5.map((d, i) => (
          <div key={d.name} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: DONUT_COLORS[i % DONUT_COLORS.length] }}
            />
            <span className="flex-1 text-xs text-on-surface/70 truncate">{d.name}</span>
            <span className="text-xs font-semibold text-on-surface shrink-0">
              {formatCurrency(d.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TransactionRow({
  tx,
  data,
}: {
  tx: Transaction
  data: NonNullable<ReturnType<typeof useDataStore.getState>['data']>
}) {
  const cat = data.categories.find((c) => c.id === tx.categoryId)
  const acc = data.accounts.find((a) => a.id === tx.accountId)
  const isIncome = tx.type === 'INCOME'
  const isCreditPayment = tx.type === 'CREDIT_PAYMENT'
  const dateStr = new Date(tx.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors">
      {/* Icon: CreditCard neutral for CREDIT_PAYMENT, category avatar otherwise */}
      {isCreditPayment ? (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface/50">
          <CreditCard size={16} strokeWidth={1.5} />
        </div>
      ) : (
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white text-sm"
          style={{ backgroundColor: cat?.color ?? '#6B7280' }}
        >
          {cat?.name?.[0] ?? '?'}
        </div>
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
          {tx.description || cat?.name || '—'}
        </p>
        <p className="text-xs text-on-surface/40 mt-0.5">
          {isCreditPayment ? acc?.name : `${cat?.name} · ${acc?.name}`} · {dateStr}
        </p>
      </div>

      {/* Amount + status — CREDIT_PAYMENT uses neutral colour */}
      <div className="flex items-center gap-2 shrink-0">
        <span
          className={cn(
            'text-sm font-semibold',
            isIncome ? 'text-primary' : isCreditPayment ? 'text-on-surface/60' : 'text-tertiary'
          )}
        >
          {isIncome ? '+' : '-'}
          {formatCurrency(tx.amount)}
        </span>
        {tx.isPaid ? (
          <CheckCircle2 size={16} className="text-primary" strokeWidth={1.5} />
        ) : (
          <Clock size={16} className="text-on-surface/20" strokeWidth={1.5} />
        )}
      </div>
    </div>
  )
}

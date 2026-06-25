import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TrendingUp,
  Landmark,
  PiggyBank,
  CreditCard,
  Bitcoin,
  ArrowLeftRight,
  Briefcase,
  MoreHorizontal,
  RefreshCw,
  Banknote,
} from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  formatCurrency,
  cn,
  parseDateLocal,
  getCurrentInvoiceBalance,
  getTotalCreditLiability,
  getLoanLiability,
  isCashRealized,
} from '@/lib/utils'
import type { Account, AccountType, Transaction, Valuation } from '@/types'

// ─── Account type config (reused from Dashboard) ──────────────────────────────

const ACCOUNT_TYPE_ICONS: Record<AccountType, React.ReactNode> = {
  RETAIL: <Landmark size={18} strokeWidth={1.5} />,
  SAVINGS: <PiggyBank size={18} strokeWidth={1.5} />,
  CREDIT: <CreditCard size={18} strokeWidth={1.5} />,
  CRYPTO: <Bitcoin size={18} strokeWidth={1.5} />,
  FOREX: <ArrowLeftRight size={18} strokeWidth={1.5} />,
  ASSET: <Briefcase size={18} strokeWidth={1.5} />,
  STOCKS: <TrendingUp size={18} strokeWidth={1.5} />,
  LOAN: <Banknote size={18} strokeWidth={1.5} />,
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
  LOAN: '#92400E',
  OTHER: '#9CA3AF',
}

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

// ─── Valuation-aware balance (§3.2 rule) ─────────────────────────────────────

const VALUATION_ELIGIBLE: AccountType[] = ['STOCKS', 'CRYPTO', 'FOREX', 'ASSET']

function applyTx(sum: number, tx: Transaction, accountId: string): number {
  if (tx.accountId === accountId) {
    // B-15: unpaid INCOME/EXPENSE are not realized; TRANSFER always counts (no isPaid toggle).
    if (tx.type === 'INCOME') return isCashRealized(tx) ? sum + tx.amount : sum
    if (tx.type === 'EXPENSE') return isCashRealized(tx) ? sum - tx.amount : sum
    if (tx.type === 'TRANSFER') return sum - tx.amount // outgoing
  } else if (tx.transferAccountId === accountId) {
    // Incoming transfer, or a CREDIT_PAYMENT funded from this account (cash leaves it). B-16.
    if (tx.type === 'TRANSFER') return sum + tx.amount
    if (tx.type === 'CREDIT_PAYMENT') return sum - tx.amount
  }
  return sum
}

function getAssetBalance(
  account: Account,
  transactions: Transaction[],
  valuations: Valuation[]
): number {
  const today = new Date()

  if (VALUATION_ELIGIBLE.includes(account.type)) {
    const accValuations = valuations
      .filter((v) => v.accountId === account.id && parseDateLocal(v.date) <= today)
      .sort((a, b) => parseDateLocal(b.date).getTime() - parseDateLocal(a.date).getTime())

    const latest = accValuations[0]
    if (latest) {
      const baseDate = parseDateLocal(latest.date)
      const delta = transactions
        .filter((tx) => {
          const d = parseDateLocal(tx.date)
          if (d <= baseDate || d > today) return false
          // Include txs on this account plus incoming transfers / outgoing card payments
          // funded from it (applyTx applies the right sign per type).
          return tx.accountId === account.id || tx.transferAccountId === account.id
        })
        .reduce((sum, tx) => applyTx(sum, tx, account.id), 0)
      return latest.marketValue + delta
    }
  }

  // No valuation (or non-eligible account): full replay from initial balance
  const delta = transactions
    .filter((tx) => {
      const d = parseDateLocal(tx.date)
      if (d > today) return false
      return (
        tx.accountId === account.id ||
        (tx.type === 'TRANSFER' && tx.transferAccountId === account.id)
      )
    })
    .reduce((sum, tx) => applyTx(sum, tx, account.id), 0)

  return account.balance + delta
}

/**
 * Balances for all asset accounts in a single pass over the transactions, to avoid the
 * O(accounts × transactions) cost of calling getAssetBalance per account (noticeable with
 * long histories). Valuation-eligible accounts keep their per-account replay (few of them).
 */
function computeAssetBalances(
  assetAccounts: Account[],
  transactions: Transaction[],
  valuations: Valuation[]
): Record<string, number> {
  const today = new Date()
  const result: Record<string, number> = {}
  const replayed = new Set<string>()
  for (const a of assetAccounts) {
    if (VALUATION_ELIGIBLE.includes(a.type)) {
      result[a.id] = getAssetBalance(a, transactions, valuations)
      replayed.add(a.id)
    } else {
      result[a.id] = a.balance // seed with initial balance
    }
  }
  for (const tx of transactions) {
    if (parseDateLocal(tx.date) > today) continue
    const a1 = tx.accountId
    if (a1 in result && !replayed.has(a1)) result[a1] = applyTx(result[a1], tx, a1)
    const a2 = tx.transferAccountId
    if (a2 && a2 !== a1 && a2 in result && !replayed.has(a2)) {
      result[a2] = applyTx(result[a2], tx, a2)
    }
  }
  return result
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function NetWorth() {
  const { t } = useTranslation()
  const data = useDataStore((s) => s.data)
  const includeHidden = useWorkspaceStore((s) => s.workspace.netWorthIncludeHidden)
  const setIncludeHidden = useWorkspaceStore((s) => s.setNetWorthIncludeHidden)
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )

  const {
    visibleAssetAccounts,
    visibleCreditAccounts,
    visibleLoanAccounts,
    assetBalances,
    totalAssets,
    totalLiabilities,
    netWorth,
  } = useMemo(() => {
    if (!data) {
      return {
        visibleAssetAccounts: [],
        visibleCreditAccounts: [],
        visibleLoanAccounts: [],
        assetBalances: {} as Record<string, number>,
        totalAssets: 0,
        totalLiabilities: 0,
        netWorth: 0,
      }
    }

    // HE-07: LOAN is a liability (saldo devedor), not an asset — excluded from assetAccounts.
    const assetAccounts = data.accounts.filter(
      (a) => a.type !== 'CREDIT' && a.type !== 'LOAN' && (includeHidden || a.includeInBalance)
    )
    const creditAccounts = data.accounts.filter(
      (a) => a.type === 'CREDIT' && (includeHidden || a.includeInBalance)
    )
    const loanAccounts = data.accounts.filter(
      (a) => a.type === 'LOAN' && (includeHidden || a.includeInBalance)
    )
    // M-42: archived accounts keep contributing to totals below, but are hidden as rows.
    const visibleAssetAccounts = assetAccounts.filter((a) => !a.archived)
    const visibleCreditAccounts = creditAccounts.filter((a) => !a.archived)
    const visibleLoanAccounts = loanAccounts.filter((a) => !a.archived)

    const assetBalances = computeAssetBalances(assetAccounts, data.transactions, data.valuations)

    const totalAssets = Object.values(assetBalances).reduce((s, v) => s + v, 0)
    const totalCreditLiabilities = creditAccounts.reduce(
      (s, acc) => s + getTotalCreditLiability(data.transactions, acc),
      0
    )
    const totalLoanLiabilities = loanAccounts.reduce((s, acc) => s + getLoanLiability(acc), 0)
    const totalLiabilities = totalCreditLiabilities + totalLoanLiabilities

    return {
      visibleAssetAccounts,
      visibleCreditAccounts,
      visibleLoanAccounts,
      assetBalances,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    }
  }, [data, includeHidden])

  if (!data) return null

  const isPositive = netWorth >= 0

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Page header + toggle ──────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-base font-semibold text-on-surface">{t('netWorth.title')}</h1>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <span className="text-xs text-on-surface/50">{t('netWorth.includeHidden')}</span>
          <button
            role="switch"
            aria-checked={includeHidden}
            onClick={() => setIncludeHidden(!includeHidden)}
            className={cn(
              'relative h-5 w-9 rounded-full transition-colors duration-200',
              includeHidden ? 'bg-primary' : 'bg-outline-variant'
            )}
          >
            <span
              className={cn(
                'absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform duration-200',
                includeHidden ? 'translate-x-4' : 'translate-x-0.5'
              )}
            />
          </button>
        </label>
      </div>

      {/* ── Hero: Net Worth + mini Ativos/Passivos ────────────────────────── */}
      <div className="space-y-3">
        {/* Primary hero card — full-width */}
        <div className="rounded-2xl bg-primary p-6 text-white">
          <p className="text-xs font-medium text-white/60 mb-1">{t('netWorth.netWorth')}</p>
          <p className="text-3xl font-bold tabular-nums">
            {isPositive ? '' : '- '}
            {formatCurrency(Math.abs(netWorth))}
          </p>
        </div>

        {/* Mini stat cards row */}
        <div className="grid grid-cols-2 gap-3">
          <div className={cn('rounded-2xl bg-surface-container p-4', shadowClass)}>
            <p className="text-xs font-medium text-on-surface/40 mb-1">{t('netWorth.assets')}</p>
            <p className="text-lg font-bold tabular-nums text-primary">
              {formatCurrency(totalAssets)}
            </p>
          </div>
          <div className={cn('rounded-2xl bg-surface-container p-4', shadowClass)}>
            <p className="text-xs font-medium text-on-surface/40 mb-1">
              {t('netWorth.liabilities')}
            </p>
            <p className="text-lg font-bold tabular-nums text-tertiary">
              {totalLiabilities > 0 ? '- ' : ''}
              {formatCurrency(totalLiabilities)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Breakdown ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Assets */}
        <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
          <h3 className="text-sm font-semibold text-on-surface mb-4">
            {t('netWorth.assetsSection')}
          </h3>

          {visibleAssetAccounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-on-surface/40">
              {t('netWorth.noAccounts')}
            </p>
          ) : (
            <div className="space-y-1">
              {[...visibleAssetAccounts]
                .sort((a, b) => (assetBalances[b.id] ?? 0) - (assetBalances[a.id] ?? 0))
                .map((acc) => (
                  <AssetRow
                    key={acc.id}
                    account={acc}
                    balance={assetBalances[acc.id] ?? 0}
                    totalAssets={totalAssets}
                    typeLabel={t(`accounts.${acc.type.toLowerCase()}`)}
                    updateLabel={t('netWorth.updateMarketValue')}
                    ofTotalLabel={t('netWorth.ofTotal')}
                  />
                ))}
            </div>
          )}
        </div>

        {/* Liabilities */}
        <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
          <h3 className="text-sm font-semibold text-on-surface mb-4">
            {t('netWorth.liabilitiesSection')}
          </h3>

          {visibleCreditAccounts.length === 0 && visibleLoanAccounts.length === 0 ? (
            <p className="py-8 text-center text-sm text-on-surface/40">
              {t('netWorth.noAccounts')}
            </p>
          ) : (
            <div className="space-y-3">
              {visibleCreditAccounts.map((acc) => (
                <LiabilityRow
                  key={acc.id}
                  account={acc}
                  currentInvoice={getCurrentInvoiceBalance(data.transactions, acc)}
                  totalCommitted={getTotalCreditLiability(data.transactions, acc)}
                  totalLiabilities={totalLiabilities}
                  currentInvoiceLabel={t('netWorth.currentInvoice')}
                  totalCommittedLabel={t('netWorth.totalCommitted')}
                  totalCommittedHint={t('netWorth.totalCommittedHint')}
                  ofTotalLabel={t('netWorth.ofTotal')}
                />
              ))}
              {visibleLoanAccounts.map((acc) => (
                <LoanLiabilityRow
                  key={acc.id}
                  account={acc}
                  outstandingBalance={getLoanLiability(acc)}
                  totalLiabilities={totalLiabilities}
                  outstandingBalanceLabel={t('accounts.outstandingBalance')}
                  monthlyPaymentLabel={t('accounts.monthlyPayment')}
                  remainingInstallmentsLabel={t('accounts.remainingInstallments')}
                  ofTotalLabel={t('netWorth.ofTotal')}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function AssetRow({
  account,
  balance,
  totalAssets,
  typeLabel,
  updateLabel,
  ofTotalLabel,
}: {
  account: Account
  balance: number
  totalAssets: number
  typeLabel: string
  updateLabel: string
  ofTotalLabel: string
}) {
  const pct = totalAssets > 0 ? Math.round((Math.max(balance, 0) / totalAssets) * 100) : 0
  const isEligible = VALUATION_ELIGIBLE.includes(account.type)
  const isNegative = balance < 0
  // M-34: institution brand color when an issuer is set; otherwise the account-type color.
  const issuerColor =
    account.issuerIcon && account.issuerIcon !== 'generic'
      ? CREDIT_ISSUER_COLORS[account.issuerIcon]
      : undefined
  const badgeColor = issuerColor ?? ACCOUNT_TYPE_COLORS[account.type]

  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors group">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundColor: badgeColor }}
      >
        {ACCOUNT_TYPE_ICONS[account.type]}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{account.name}</p>
        <p className="text-xs text-on-surface/40 mt-0.5">
          {typeLabel}
          {totalAssets > 0 && (
            <span className="ml-1 text-on-surface/30">
              · {pct}% {ofTotalLabel}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isEligible && (
          <button
            aria-label={updateLabel}
            className="opacity-0 group-hover:opacity-100 transition-opacity flex h-7 w-7 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-high hover:text-primary"
          >
            <RefreshCw size={14} strokeWidth={1.5} />
          </button>
        )}
        <span
          className={cn(
            'text-sm font-semibold tabular-nums',
            isNegative ? 'text-tertiary' : 'text-on-surface'
          )}
        >
          {formatCurrency(balance)}
        </span>
      </div>
    </div>
  )
}

function LiabilityRow({
  account,
  currentInvoice,
  totalCommitted,
  totalLiabilities,
  currentInvoiceLabel,
  totalCommittedLabel,
  totalCommittedHint,
  ofTotalLabel,
}: {
  account: Account
  currentInvoice: number
  totalCommitted: number
  totalLiabilities: number
  currentInvoiceLabel: string
  totalCommittedLabel: string
  totalCommittedHint: string
  ofTotalLabel: string
}) {
  const pct = totalLiabilities > 0 ? Math.round((totalCommitted / totalLiabilities) * 100) : 0

  return (
    <div className="rounded-xl border border-surface-container-low px-4 py-3 space-y-2">
      {/* Card name */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: getIssuerColor(account.issuerIcon) }}
        >
          <CreditCard size={18} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-on-surface truncate">{account.name}</p>
          {totalLiabilities > 0 && (
            <p className="text-xs text-on-surface/30 mt-0.5">
              {pct}% {ofTotalLabel}
            </p>
          )}
        </div>
      </div>

      {/* Two numbers */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {currentInvoiceLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-on-surface">
            {formatCurrency(currentInvoice)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {totalCommittedLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-tertiary">
            {formatCurrency(totalCommitted)}
          </p>
          <p className="text-[10px] text-on-surface/30 mt-0.5">{totalCommittedHint}</p>
        </div>
      </div>
    </div>
  )
}

function LoanLiabilityRow({
  account,
  outstandingBalance,
  totalLiabilities,
  outstandingBalanceLabel,
  monthlyPaymentLabel,
  remainingInstallmentsLabel,
  ofTotalLabel,
}: {
  account: Account
  outstandingBalance: number
  totalLiabilities: number
  outstandingBalanceLabel: string
  monthlyPaymentLabel: string
  remainingInstallmentsLabel: string
  ofTotalLabel: string
}) {
  const pct = totalLiabilities > 0 ? Math.round((outstandingBalance / totalLiabilities) * 100) : 0

  return (
    <div className="rounded-xl border border-surface-container-low px-4 py-3 space-y-2">
      {/* Loan name */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: ACCOUNT_TYPE_COLORS.LOAN }}
        >
          <Banknote size={18} strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-on-surface truncate">{account.name}</p>
          {totalLiabilities > 0 && (
            <p className="text-xs text-on-surface/30 mt-0.5">
              {pct}% {ofTotalLabel}
            </p>
          )}
        </div>
      </div>

      {/* Two numbers */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {outstandingBalanceLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-tertiary">
            {formatCurrency(outstandingBalance)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {monthlyPaymentLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-on-surface">
            {formatCurrency(account.loanMetadata?.monthlyPayment ?? 0)}
          </p>
          <p className="text-[10px] text-on-surface/30 mt-0.5">
            {remainingInstallmentsLabel}: {account.loanMetadata?.remainingInstallments ?? 0}
          </p>
        </div>
      </div>
    </div>
  )
}

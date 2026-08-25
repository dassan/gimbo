import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  TrendingUp,
  TrendingDown,
  Landmark,
  PiggyBank,
  CreditCard,
  Bitcoin,
  ArrowLeftRight,
  Briefcase,
  MoreHorizontal,
  RefreshCw,
  Banknote,
  Umbrella,
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
import StatCard from '@/components/StatCard'
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

// ─── Asset categories (M-XX: category cards replace the single Ativos/Passivos boxes) ─────

type AssetCategory = 'retail' | 'investments' | 'savings' | 'other'

const ASSET_CATEGORY_ORDER: AssetCategory[] = ['retail', 'investments', 'savings', 'other']

const ASSET_CATEGORY_LABEL_KEY: Record<AssetCategory, string> = {
  retail: 'netWorth.categoryRetail',
  investments: 'netWorth.categoryInvestments',
  savings: 'netWorth.categorySavings',
  other: 'netWorth.categoryOther',
}

function assetCategoryForType(type: AccountType): AssetCategory {
  switch (type) {
    case 'RETAIL':
      return 'retail'
    case 'SAVINGS':
      return 'savings'
    case 'ASSET':
    case 'STOCKS':
    case 'CRYPTO':
    case 'FOREX':
      return 'investments'
    default:
      return 'other'
  }
}

function emptyAssetsByCategory(): Record<AssetCategory, Account[]> {
  return { retail: [], investments: [], savings: [], other: [] }
}

function emptyAssetCategoryTotals(): Record<AssetCategory, number> {
  return { retail: 0, investments: 0, savings: 0, other: 0 }
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
    assetsByCategory,
    assetCategoryTotals,
    visibleCreditAccounts,
    visibleLoanAccounts,
    totalCreditLiabilities,
    totalLoanLiabilities,
    assetBalances,
    totalAssets,
    totalLiabilities,
    netWorth,
  } = useMemo(() => {
    if (!data) {
      return {
        assetsByCategory: emptyAssetsByCategory(),
        assetCategoryTotals: emptyAssetCategoryTotals(),
        visibleCreditAccounts: [],
        visibleLoanAccounts: [],
        totalCreditLiabilities: 0,
        totalLoanLiabilities: 0,
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

    // Group asset rows (visible only) and totals (all, incl. archived) by category.
    const assetsByCategory = emptyAssetsByCategory()
    for (const acc of visibleAssetAccounts) {
      assetsByCategory[assetCategoryForType(acc.type)].push(acc)
    }
    const assetCategoryTotals = emptyAssetCategoryTotals()
    for (const acc of assetAccounts) {
      assetCategoryTotals[assetCategoryForType(acc.type)] += assetBalances[acc.id] ?? 0
    }

    const totalAssets = Object.values(assetBalances).reduce((s, v) => s + v, 0)
    const totalCreditLiabilities = creditAccounts.reduce(
      (s, acc) => s + getTotalCreditLiability(data.transactions, acc),
      0
    )
    const totalLoanLiabilities = loanAccounts.reduce((s, acc) => s + getLoanLiability(acc), 0)
    const totalLiabilities = totalCreditLiabilities + totalLoanLiabilities

    return {
      assetsByCategory,
      assetCategoryTotals,
      visibleCreditAccounts,
      visibleLoanAccounts,
      totalCreditLiabilities,
      totalLoanLiabilities,
      assetBalances,
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    }
  }, [data, includeHidden])

  const hasAnyAsset = ASSET_CATEGORY_ORDER.some((cat) => assetsByCategory[cat].length > 0)

  if (!data) return null

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-4 sm:space-y-6">
      {/* ── Page header + toggle — same title/subtitle pattern as Caixinhas e Saúde ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold text-on-surface">
            {t('netWorth.title')}
          </h1>
          <p className="text-sm text-on-surface/50 mt-0.5">{t('netWorth.subtitle')}</p>
        </div>

        <label className="flex shrink-0 items-center gap-2 cursor-pointer select-none">
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

      {/* ── Stat cards — Ativos / Passivos / Patrimônio Líquido ────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <StatCard
          label={t('netWorth.assets')}
          value={formatCurrency(totalAssets)}
          icon={<TrendingUp size={16} strokeWidth={1.5} />}
          variant="income"
          shadowClass={shadowClass}
        />
        <StatCard
          label={t('netWorth.liabilities')}
          value={formatCurrency(totalLiabilities)}
          icon={<TrendingDown size={16} strokeWidth={1.5} />}
          variant="expense"
          shadowClass={shadowClass}
        />
        <StatCard
          label={t('netWorth.netWorth')}
          value={formatCurrency(netWorth)}
          variant="highlight"
          isNegative={netWorth < 0}
          shadowClass={shadowClass}
        />
      </div>

      {/* ── Breakdown — one card per account category, replaces the single
          Ativos/Passivos boxes (the stat cards above already own those labels) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Assets column */}
        <div className="space-y-4">
          {!hasAnyAsset ? (
            <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
              <p className="py-8 text-center text-sm text-on-surface/40">
                {t('netWorth.noAccounts')}
              </p>
            </div>
          ) : (
            ASSET_CATEGORY_ORDER.filter((cat) => assetsByCategory[cat].length > 0).map((cat) => (
              <CategoryCard
                key={cat}
                title={t(ASSET_CATEGORY_LABEL_KEY[cat])}
                total={assetCategoryTotals[cat]}
                shadowClass={shadowClass}
              >
                <div className="space-y-1">
                  {[...assetsByCategory[cat]]
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
              </CategoryCard>
            ))
          )}
        </div>

        {/* Liabilities column */}
        <div className="space-y-4">
          {visibleCreditAccounts.length === 0 && visibleLoanAccounts.length === 0 ? (
            <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
              <p className="py-8 text-center text-sm text-on-surface/40">
                {t('netWorth.noAccounts')}
              </p>
            </div>
          ) : (
            <>
              {visibleCreditAccounts.length > 0 && (
                <CategoryCard
                  title={t('netWorth.categoryCredit')}
                  total={totalCreditLiabilities}
                  shadowClass={shadowClass}
                >
                  <div className="space-y-1">
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
                  </div>
                </CategoryCard>
              )}
              {visibleLoanAccounts.length > 0 && (
                <CategoryCard
                  title={t('netWorth.categoryLoans')}
                  total={totalLoanLiabilities}
                  shadowClass={shadowClass}
                >
                  <div className="space-y-1">
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
                </CategoryCard>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function CategoryCard({
  title,
  total,
  shadowClass,
  children,
}: {
  title: string
  total: number
  shadowClass: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('rounded-2xl bg-surface-container p-5 sm:p-6', shadowClass)}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-on-surface">{title}</h3>
        <span
          className={cn(
            'text-sm font-bold tabular-nums pr-3',
            total < 0 ? 'text-tertiary' : 'text-on-surface'
          )}
        >
          {formatCurrency(total)}
        </span>
      </div>
      {children}
    </div>
  )
}

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
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-medium text-on-surface truncate">{account.name}</p>
          {account.reserveMetadata && (
            <Umbrella size={12} strokeWidth={1.5} className="shrink-0 text-on-surface/30" />
          )}
        </div>
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
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundColor: getIssuerColor(account.issuerIcon) }}
      >
        <CreditCard size={18} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{account.name}</p>
        {totalLiabilities > 0 && (
          <p className="text-xs text-on-surface/40 mt-0.5">
            {pct}% {ofTotalLabel}
          </p>
        )}
      </div>

      {/* M-67: current invoice + total committed inline, next to the name */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {currentInvoiceLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-on-surface">
            {formatCurrency(currentInvoice)}
          </p>
        </div>
        <div className="text-right" title={totalCommittedHint}>
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {totalCommittedLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-tertiary">
            {formatCurrency(totalCommitted)}
          </p>
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
    <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-surface-container-low transition-colors">
      <div
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
        style={{ backgroundColor: ACCOUNT_TYPE_COLORS.LOAN }}
      >
        <Banknote size={18} strokeWidth={1.5} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-on-surface truncate">{account.name}</p>
        {totalLiabilities > 0 && (
          <p className="text-xs text-on-surface/40 mt-0.5">
            {pct}% {ofTotalLabel} · {remainingInstallmentsLabel}:{' '}
            {account.loanMetadata?.remainingInstallments ?? 0}
          </p>
        )}
      </div>

      {/* Same layout as LiabilityRow: two right-aligned stat blocks next to the name,
          both a single label+value line so the two blocks share the same baseline. */}
      <div className="flex items-center gap-4 shrink-0">
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {outstandingBalanceLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-tertiary">
            {formatCurrency(outstandingBalance)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-widest text-on-surface/40 font-medium">
            {monthlyPaymentLabel}
          </p>
          <p className="text-sm font-bold tabular-nums text-on-surface">
            {formatCurrency(account.loanMetadata?.monthlyPayment ?? 0)}
          </p>
        </div>
      </div>
    </div>
  )
}

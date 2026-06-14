import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useOutletContext } from 'react-router-dom'
import { Search, CheckCircle2, Clock, ChevronDown, ArrowRightLeft, CreditCard } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import {
  formatCurrency,
  cn,
  parseDateLocal,
  isCashRealized,
  getTxInvoicePeriod,
  getInvoiceDueDate,
  getInvoicePaid,
  invoicePeriodKey,
  filterArchivedAccounts,
} from '@/lib/utils'
import PeriodSelector from '@/components/PeriodSelector'
import type { PeriodValue } from '@/components/PeriodSelector'
import type { AppLayoutContext } from '@/components/AppLayout'
import type { Transaction } from '@/types'

export default function Transactions() {
  const { t } = useTranslation()
  const data = useDataStore((s) => s.data)
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )
  const { openTransactionDrawer } = useOutletContext<AppLayoutContext>()

  // ── Period state (delegated to PeriodSelector) ───────────────────────────
  const [period, setPeriod] = useState<PeriodValue>({ mode: 'month', monthOffset: 0 })

  // ── Other filters ─────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterAccountId, setFilterAccountId] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<'all' | 'paid' | 'pending'>('all')
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense' | 'transfer'>('all')
  // B-15: footer totals reflect realized cash by default; toggle on to project unpaid entries.
  const [includeUnpaid, setIncludeUnpaid] = useState(false)

  const now = useMemo(() => new Date(), [])

  // M-26: Set of CREDIT account IDs — their transactions live in /credit-card/:id, not here
  const creditAccountIds = useMemo(() => {
    if (!data) return new Set<string>()
    return new Set(data.accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id))
  }, [data])

  // ── Compute date range from PeriodSelector state ────────────────────────
  const { startDate, endDate } = useMemo(() => {
    if (period.mode === 'month') {
      const ref = new Date(now.getFullYear(), now.getMonth() + period.monthOffset, 1)
      const end = new Date(ref.getFullYear(), ref.getMonth() + 1, 0)
      return { startDate: ref, endDate: end }
    }
    // custom
    if (period.customStart && period.customEnd) {
      return {
        startDate: parseDateLocal(period.customStart),
        endDate: parseDateLocal(period.customEnd),
      }
    }
    return { startDate: null, endDate: null }
  }, [period, now])

  // ── Transaction filtering ─────────────────────────────────────────────────
  const filtered = useMemo(() => {
    if (!data) return []
    let txs = [...data.transactions]

    // M-26: this is the cash ledger of non-CREDIT accounts — card purchases live in
    // /credit-card/:id and are excluded here. B-16: a CREDIT_PAYMENT IS a real cash outflow
    // on its funding (non-CREDIT) account, so it belongs in this ledger (attributed to
    // transferAccountId), even though its accountId is the CREDIT card.
    txs = txs.filter((tx) => {
      if (tx.type === 'CREDIT_PAYMENT') {
        return tx.transferAccountId != null && !creditAccountIds.has(tx.transferAccountId)
      }
      return !creditAccountIds.has(tx.accountId)
    })

    // Period filter using parseDateLocal (avoids UTC date parsing bug)
    if (startDate && endDate) {
      txs = txs.filter((tx) => {
        const d = parseDateLocal(tx.date)
        return d >= startDate && d <= endDate
      })
    }

    // Account filter — a CREDIT_PAYMENT belongs to its funding account (transferAccountId)
    if (filterAccountId !== 'all')
      txs = txs.filter((tx) => {
        const ledgerAccountId = tx.type === 'CREDIT_PAYMENT' ? tx.transferAccountId : tx.accountId
        return ledgerAccountId === filterAccountId
      })

    // Status filter
    if (filterStatus === 'paid') txs = txs.filter((tx) => tx.isPaid)
    if (filterStatus === 'pending') txs = txs.filter((tx) => !tx.isPaid)

    // Type filter
    if (filterType === 'income') txs = txs.filter((tx) => tx.type === 'INCOME')
    if (filterType === 'expense') txs = txs.filter((tx) => tx.type === 'EXPENSE')
    if (filterType === 'transfer') txs = txs.filter((tx) => tx.type === 'TRANSFER')

    // Search
    if (search.trim()) {
      const q = search.toLowerCase()
      txs = txs.filter((tx) => tx.description.toLowerCase().includes(q))
    }

    return txs.sort((a, b) => parseDateLocal(b.date).getTime() - parseDateLocal(a.date).getTime())
  }, [
    data,
    filterAccountId,
    filterStatus,
    filterType,
    search,
    creditAccountIds,
    startDate,
    endDate,
  ])

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, Transaction[]>()
    filtered.forEach((tx) => {
      const key = tx.date.slice(0, 10)
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tx)
    })
    return Array.from(map.entries())
  }, [filtered])

  // Summary — card purchases are excluded (live in /credit-card); a CREDIT_PAYMENT is a real
  // cash outflow on its funding account and counts as such (B-16).
  // B-15: unless "Incluir Não-Pagos" is on, unpaid INCOME/EXPENSE are excluded from totals.
  const realized = filtered.filter((tx) => includeUnpaid || isCashRealized(tx))
  const income = realized.filter((tx) => tx.type === 'INCOME').reduce((s, tx) => s + tx.amount, 0)
  const expenses = realized
    .filter((tx) => tx.type === 'EXPENSE')
    .reduce((s, tx) => s + tx.amount, 0)
  const payments = realized
    .filter((tx) => tx.type === 'CREDIT_PAYMENT')
    .reduce((s, tx) => s + tx.amount, 0)
  const consolidated = income - expenses - payments

  // Period balances (Organizze-style): saldo anterior → saldo → previsto. Replaces the old
  // all-time accumulated. Anchored to the real account balances (initial + realized flow) so it
  // always reconciles. Respects the account filter; ignores type/status/search (those only narrow
  // the listed rows, not the account's balance).
  const { saldoAnterior, saldoPeriodo, saldoPrevisto } = useMemo(() => {
    if (!data) return { saldoAnterior: 0, saldoPeriodo: 0, saldoPrevisto: 0 }
    const scopeIds = new Set(
      data.accounts
        .filter((a) => !creditAccountIds.has(a.id))
        .filter((a) => filterAccountId === 'all' || a.id === filterAccountId)
        .map((a) => a.id)
    )
    const initial = data.accounts
      .filter((a) => scopeIds.has(a.id))
      .reduce((s, a) => s + a.balance, 0)

    // Realized balance of the in-scope accounts up to and including `upTo` (null = all time).
    const balanceUpTo = (upTo: Date | null): number => {
      let total = initial
      for (const tx of data.transactions) {
        if (upTo && parseDateLocal(tx.date) > upTo) continue
        if (!isCashRealized(tx)) continue // realized cash only
        if (tx.type === 'TRANSFER') {
          if (scopeIds.has(tx.accountId)) total -= tx.amount
          if (tx.transferAccountId && scopeIds.has(tx.transferAccountId)) total += tx.amount
        } else if (tx.type === 'CREDIT_PAYMENT') {
          // Real outflow from the funding (non-CREDIT) account (B-16).
          if (tx.transferAccountId && scopeIds.has(tx.transferAccountId)) total -= tx.amount
        } else if (scopeIds.has(tx.accountId)) {
          if (tx.type === 'INCOME') total += tx.amount
          else if (tx.type === 'EXPENSE') total -= tx.amount
        }
      }
      return total
    }

    const dayBeforeStart = startDate
      ? new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - 1)
      : null
    const saldoAnterior = balanceUpTo(dayBeforeStart)
    const saldoPeriodo = balanceUpTo(endDate)

    // Previsto = realized end-of-period balance + the pending items still to settle by `end`:
    //  (a) unpaid cash INCOME/EXPENSE with date ≤ end (also captures overdue carryover); minus
    //  (b) unpaid card invoices coming due from today through `end`. The card lives off the cash
    //      ledger, so its bill only hits cash when paid via CREDIT_PAYMENT — for a future month no
    //      such payment exists yet, so the upcoming bill must be projected. The pending bills are
    //      CUMULATIVE: a July invoice still weighs on August's projection until paid, so the lower
    //      bound is *today*, not the period start. Invoices due before today are treated as settled
    //      (consistent with getOpenCreditBalance) — which also avoids summing long, imperfectly
    //      reconciled history. Only in the all-accounts view — a future invoice can't be attributed
    //      to one funding account.
    let unpaidCashNet = 0
    for (const tx of data.transactions) {
      if (isCashRealized(tx) || !scopeIds.has(tx.accountId)) continue
      if (endDate && parseDateLocal(tx.date) > endDate) continue
      if (tx.type === 'INCOME') unpaidCashNet += tx.amount
      else if (tx.type === 'EXPENSE') unpaidCashNet -= tx.amount
    }

    let cardOutstanding = 0
    if (filterAccountId === 'all' && endDate) {
      const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      for (const account of data.accounts) {
        if (account.type !== 'CREDIT' || !account.creditMetadata) continue
        const { dueDay, closingDay } = account.creditMetadata
        const periodNet = new Map<string, number>() // invoice periodKey → charges − credits
        for (const tx of data.transactions) {
          if (tx.accountId !== account.id) continue
          if (tx.type !== 'EXPENSE' && tx.type !== 'INCOME') continue
          const key = invoicePeriodKey(getTxInvoicePeriod(tx, account))
          const delta = tx.type === 'EXPENSE' ? tx.amount : -tx.amount
          periodNet.set(key, (periodNet.get(key) ?? 0) + delta)
        }
        for (const [key, net] of periodNet) {
          const [y, m] = key.split('-').map(Number)
          const due = parseDateLocal(getInvoiceDueDate({ year: y, month: m }, dueDay, closingDay))
          if (due < todayMidnight || due > endDate) continue
          const outstanding =
            net - getInvoicePaid(data.transactions, account, { year: y, month: m })
          if (outstanding > 0.005) cardOutstanding += outstanding
        }
      }
    }

    return {
      saldoAnterior,
      saldoPeriodo,
      saldoPrevisto: saldoPeriodo + unpaidCashNet - cardOutstanding,
    }
  }, [data, creditAccountIds, filterAccountId, startDate, endDate, now])

  if (!data) return null

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 pt-6 sm:pt-8 pb-24 lg:pb-8">
        {/* ── Period selector + Search ─────────────────────────────────────── */}
        {/* Mobile: stacked. Desktop: 3-col grid (period 2/3, search 1/3). */}
        <div className="flex flex-col sm:grid sm:grid-cols-3 gap-3 sm:gap-6 mb-4 sm:mb-6">
          <div className="sm:col-span-2">
            <PeriodSelector value={period} onChange={setPeriod} />
          </div>

          <div className="sm:col-span-1">
            <div className="relative">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface/40"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-full rounded-xl bg-surface-container-low py-2 pl-8 pr-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>
        </div>

        {/* ── Filter bar — wraps on mobile ─────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
          <FilterDropdown
            className="flex-1 min-w-[140px]"
            label={t('transactions.filterAccounts')}
            value={filterAccountId}
            onChange={setFilterAccountId}
            options={[
              { value: 'all', label: t('transactions.filterAccounts') },
              // M-26: CREDIT accounts are excluded — their transactions live in /credit-card/:id
              // M-42: archived accounts are hidden unless currently selected as the filter
              ...filterArchivedAccounts(
                data.accounts.filter((a) => a.type !== 'CREDIT'),
                filterAccountId
              ).map((a) => ({ value: a.id, label: a.name })),
            ]}
          />
          <FilterDropdown
            className="flex-1 min-w-[140px]"
            label={t('transactions.filterStatus')}
            value={filterStatus}
            onChange={(v) => setFilterStatus(v as typeof filterStatus)}
            options={[
              { value: 'all', label: t('transactions.filterStatus') },
              { value: 'paid', label: t('transactions.paid') },
              { value: 'pending', label: t('transactions.pending') },
            ]}
          />
          <FilterDropdown
            className="flex-1 min-w-[140px]"
            label={t('transactions.filterTags')}
            value="all"
            onChange={() => {}}
            options={[
              { value: 'all', label: t('transactions.filterTags') },
              ...data.tags.map((tag) => ({ value: tag.id, label: `#${tag.name}` })),
            ]}
          />
          <FilterDropdown
            className="flex-1 min-w-[140px]"
            label={t('transactions.filterType')}
            value={filterType}
            onChange={(v) => setFilterType(v as typeof filterType)}
            options={[
              { value: 'all', label: t('transactions.filterType') },
              { value: 'income', label: t('transactions.income') },
              { value: 'expense', label: t('transactions.expense') },
              { value: 'transfer', label: t('transactions.transfer') },
            ]}
          />
        </div>

        {/* ── M-36: full-width transaction list / M-48: lg sidebar for the summary ── */}
        <div className="lg:grid lg:grid-cols-[1fr_280px] lg:gap-6 lg:items-start">
          <div className="space-y-4 sm:space-y-6">
            {grouped.length === 0 ? (
              <div className={cn('rounded-2xl bg-surface-container p-12 text-center', shadowClass)}>
                <p className="text-sm text-on-surface/40">{t('common.noData')}</p>
              </div>
            ) : (
              grouped.map(([dateKey, txs]) => (
                <DateGroup
                  key={dateKey}
                  dateKey={dateKey}
                  txs={txs}
                  data={data}
                  onEditTx={openTransactionDrawer}
                  shadowClass={shadowClass}
                />
              ))
            )}
          </div>

          {/* ── Summary: fixed footer on mobile/tablet, sticky sidebar on lg (M-48) ── */}
          {filtered.length > 0 && (
            <div className="fixed bottom-6 left-0 right-0 z-30 pointer-events-none lg:static">
              <div className="mx-auto max-w-7xl px-6 lg:mx-0 lg:max-w-none lg:px-0 lg:sticky lg:top-6 lg:mt-6 pointer-events-auto space-y-3">
                <div
                  className={cn(
                    'flex items-center justify-between rounded-2xl bg-surface-container px-6 py-4',
                    'lg:flex-col lg:items-stretch lg:gap-4 lg:px-5 lg:py-5',
                    shadowClass
                  )}
                >
                  {/* Count */}
                  <p className="text-xs text-on-surface/40 shrink-0">
                    <span className="font-semibold text-on-surface">{filtered.length}</span>{' '}
                    {t('transactions.listed')}
                  </p>

                  <div className="h-4 w-px bg-surface-container-high mx-4 shrink-0 lg:h-px lg:w-full lg:mx-0" />

                  {/* Period flow */}
                  <div className="flex items-center gap-2 shrink-0 lg:justify-between">
                    <span
                      className={cn(
                        'label text-xs font-bold',
                        consolidated >= 0 ? 'text-primary' : 'text-tertiary'
                      )}
                    >
                      {consolidated >= 0
                        ? t('transactions.positiveFlow')
                        : t('transactions.negativeFlow')}
                    </span>
                    <span
                      className={cn(
                        'text-sm font-bold tabular-nums',
                        consolidated >= 0 ? 'text-primary' : 'text-tertiary'
                      )}
                    >
                      {consolidated >= 0 ? '+' : ''}
                      {formatCurrency(consolidated)}
                    </span>
                  </div>

                  <div className="h-4 w-px bg-surface-container-high mx-4 shrink-0 lg:h-px lg:w-full lg:mx-0" />

                  {/* Period balances (Organizze-style): saldo anterior → saldo → previsto */}
                  <div className="flex items-center gap-3 sm:gap-4 lg:flex-col lg:items-stretch lg:gap-2">
                    <div className="hidden sm:flex items-center gap-1.5 lg:justify-between">
                      <span className="label text-[10px] font-bold text-on-surface/40">
                        {t('transactions.previousBalance')}
                      </span>
                      <span className="text-xs font-semibold tabular-nums text-on-surface/50">
                        {formatCurrency(saldoAnterior)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 lg:justify-between">
                      <span className="label text-[10px] font-bold text-on-surface/40">
                        {t('transactions.periodBalance')}
                      </span>
                      <span
                        className={cn(
                          'text-sm font-bold tabular-nums',
                          saldoPeriodo >= 0 ? 'text-on-surface' : 'text-tertiary'
                        )}
                      >
                        {formatCurrency(saldoPeriodo)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 lg:justify-between">
                      <span className="label text-[10px] font-bold text-on-surface/40">
                        {t('transactions.projectedBalance')}
                      </span>
                      <span
                        className={cn(
                          'text-xs font-semibold tabular-nums',
                          saldoPrevisto >= 0 ? 'text-on-surface/50' : 'text-tertiary'
                        )}
                      >
                        {formatCurrency(saldoPrevisto)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* B-15: include unpaid entries in the summary totals (off = realized cash only) */}
                <button
                  role="switch"
                  aria-checked={includeUnpaid}
                  onClick={() => setIncludeUnpaid((v) => !v)}
                  className={cn(
                    'flex w-full items-center justify-between rounded-2xl bg-surface-container px-5 py-4',
                    shadowClass
                  )}
                >
                  <span className="text-sm font-medium text-on-surface">
                    {t('analytics.includeUnpaid')}
                  </span>
                  <span
                    className={cn(
                      'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                      includeUnpaid ? 'bg-primary' : 'bg-on-surface/20'
                    )}
                  >
                    <span
                      className={cn(
                        'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                        includeUnpaid ? 'translate-x-6' : 'translate-x-1'
                      )}
                    />
                  </span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── DateGroup ─────────────────────────────────────────────────────────────────

function DateGroup({
  dateKey,
  txs,
  data,
  onEditTx,
  shadowClass,
}: {
  dateKey: string
  txs: Transaction[]
  data: NonNullable<ReturnType<typeof useDataStore.getState>['data']>
  onEditTx: (tx: Transaction) => void
  shadowClass: string
}) {
  const date = new Date(dateKey + 'T12:00:00')
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)

  let label: string
  if (date.toDateString() === today.toDateString()) label = 'Hoje'
  else if (date.toDateString() === yesterday.toDateString()) label = 'Ontem'
  else label = date.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })

  const dateFormatted = date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <span className="label text-xs font-semibold text-on-surface/50 uppercase">{label}</span>
        <span className="text-xs text-on-surface/30">{dateFormatted}</span>
      </div>
      <div className={cn('rounded-2xl bg-surface-container overflow-hidden', shadowClass)}>
        {txs.map((tx, i) => (
          <TxRow key={tx.id} tx={tx} data={data} isLast={i === txs.length - 1} onEdit={onEditTx} />
        ))}
      </div>
    </div>
  )
}

// ─── TxRow ─────────────────────────────────────────────────────────────────────

function TxRow({
  tx,
  data,
  isLast,
  onEdit,
}: {
  tx: Transaction
  data: NonNullable<ReturnType<typeof useDataStore.getState>['data']>
  isLast: boolean
  onEdit: (tx: Transaction) => void
}) {
  const { t } = useTranslation()
  const cat = data.categories.find((c) => c.id === tx.categoryId)
  const acc = data.accounts.find((a) => a.id === tx.accountId)
  const isIncome = tx.type === 'INCOME'
  const isTransfer = tx.type === 'TRANSFER'
  const isCreditPayment = tx.type === 'CREDIT_PAYMENT'
  const txTags = data.tags.filter((tag) => tx.tags.includes(tag.id))
  // TRANSFER: destination account. CREDIT_PAYMENT: the funded card is `acc` and the money
  // comes from transferAccountId (shown as "<funding account> → <card>").
  const destAcc =
    isTransfer || isCreditPayment ? data.accounts.find((a) => a.id === tx.transferAccountId) : null

  const typeTitle = isTransfer
    ? t('transactions.transferTitle')
    : isCreditPayment
      ? t('transactions.creditPayment')
      : cat?.name
  // `||` (not `??`) is intentional: an empty-string description must fall through to the fallback.
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  const title = tx.description || typeTitle || '—'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onEdit(tx)}
      onKeyDown={(e) => e.key === 'Enter' && onEdit(tx)}
      className={cn(
        'flex items-center gap-4 px-5 py-4 hover:bg-surface-container-low transition-colors cursor-pointer',
        !isLast && 'border-b border-surface-container-low'
      )}
    >
      {/* Avatar — transfers and credit-card payments get a neutral icon */}
      {isTransfer || isCreditPayment ? (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-on-surface/40">
          {isCreditPayment ? (
            <CreditCard size={18} strokeWidth={1.5} />
          ) : (
            <ArrowRightLeft size={18} strokeWidth={1.5} />
          )}
        </div>
      ) : (
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white text-sm font-semibold"
          style={{ backgroundColor: cat?.color ?? '#6B7280' }}
        >
          {cat?.name?.[0] ?? '?'}
        </div>
      )}

      {/* Info — M-36: type label removed (color conveys it); category shown as a chip */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-on-surface truncate">{title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {/* M-43: account/transfer shown first, before category and tags */}
          {isTransfer ? (
            <span className="text-xs text-on-surface/30">
              {acc?.name ?? '—'} → {destAcc?.name ?? '—'}
            </span>
          ) : isCreditPayment ? (
            <span className="text-xs text-on-surface/30">
              {destAcc?.name ?? '—'} → {acc?.name ?? '—'}
            </span>
          ) : (
            acc && <span className="text-xs text-on-surface/30">{acc.name}</span>
          )}
          {/* M-36: category pill — neutral chip, only when the tx has a category */}
          {cat && (
            <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-medium text-on-surface/50">
              #{cat.name}
            </span>
          )}
          {/* M-50: installment badge — current/total parcel, only for installment purchases */}
          {tx.installment && (
            <span
              aria-label={t('transactions.installmentBadge', {
                current: tx.installment.currentIndex,
                total: tx.installment.total,
              })}
              className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-medium text-on-surface/50"
            >
              {tx.installment.currentIndex}/{tx.installment.total}
            </span>
          )}
          {txTags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full px-2 py-0.5 text-[10px] font-medium text-white"
              style={{ backgroundColor: tag.color }}
            >
              #{tag.name}
            </span>
          ))}
        </div>
      </div>

      {/* Amount + paid status */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="text-right">
          {isTransfer ? (
            <>
              <p className="text-sm font-bold tabular-nums text-on-surface/50">
                {formatCurrency(tx.amount)}
              </p>
              <p className="text-[10px] text-on-surface/30 mt-0.5">Transf.</p>
            </>
          ) : isCreditPayment ? (
            <>
              <p className="text-sm font-bold tabular-nums text-tertiary">
                -{formatCurrency(tx.amount)}
              </p>
              <p className="text-[10px] text-on-surface/30 mt-0.5">Pagamento</p>
            </>
          ) : (
            <>
              <p
                className={cn(
                  'text-sm font-bold tabular-nums',
                  isIncome ? 'text-primary' : 'text-tertiary'
                )}
              >
                {isIncome ? '+' : '-'}
                {formatCurrency(tx.amount)}
              </p>
              <p className="text-[10px] text-on-surface/30 mt-0.5">
                {isIncome ? 'Depósito' : 'Débito'}
              </p>
            </>
          )}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-full">
          {tx.isPaid ? (
            <CheckCircle2 size={20} className="text-primary" strokeWidth={1.5} />
          ) : (
            <Clock size={20} className="text-on-surface/20" strokeWidth={1.5} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── FilterDropdown ────────────────────────────────────────────────────────────

function FilterDropdown({
  value,
  onChange,
  options,
  className,
}: {
  label?: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none rounded-xl bg-surface-container-low py-2 pl-3 pr-7 text-sm font-medium text-on-surface/70 outline-none hover:bg-surface-container-high transition-colors cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
      />
    </div>
  )
}

import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, ChevronDown, CreditCard, X } from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import { useWorkspaceStore } from '@/store/useWorkspaceStore'
import { useOutletContext } from 'react-router-dom'
import {
  formatCurrency,
  cn,
  parseDateLocal,
  getInvoicePeriod,
  getInvoiceDueDate,
  getCurrentInvoiceBalance,
  uuid,
} from '@/lib/utils'
import type { AppLayoutContext } from '@/components/AppLayout'
import type { Account, Transaction } from '@/types'

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
  if (!issuerIcon || issuerIcon === 'generic') return '#1F2937'
  return CREDIT_ISSUER_COLORS[issuerIcon] ?? '#1F2937'
}

// Months labels in pt-BR for the invoice period heading
const MONTH_NAMES_PT = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
]

export default function CreditCardPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { accountId } = useParams<{ accountId: string }>()
  const data = useDataStore((s) => s.data)
  const addTransaction = useDataStore((s) => s.addTransaction)
  const shadowClass = useWorkspaceStore((s) =>
    s.workspace.useAmbientShadows ? 'shadow-card-ambient' : 'shadow-card'
  )
  const { openTransactionDrawer } = useOutletContext<AppLayoutContext>()

  // Invoice period navigation offset (0 = current, -1 = previous, etc.)
  const [periodOffset, setPeriodOffset] = useState(0)
  // Category filter
  const [filterCategory, setFilterCategory] = useState<string>('all')
  // M-30: Pay Invoice modal
  const [showPayModal, setShowPayModal] = useState(false)

  const account = useMemo(() => data?.accounts.find((a) => a.id === accountId), [data, accountId])

  // M-30: accounts that can be used to pay (non-CREDIT)
  const nonCreditAccounts = useMemo(
    () => (data?.accounts ?? []).filter((a) => a.type !== 'CREDIT'),
    [data]
  )

  // Resolve the invoice period (1-based month) for the current offset
  const resolvedPeriod = useMemo(() => {
    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    if (!account?.creditMetadata) {
      return { year: today.getFullYear(), month: today.getMonth() + 1 }
    }
    const base = getInvoicePeriod(todayStr, account.creditMetadata.closingDay)
    let m = base.month + periodOffset
    let y = base.year
    while (m < 1) {
      m += 12
      y--
    }
    while (m > 12) {
      m -= 12
      y++
    }
    return { year: y, month: m }
  }, [account, periodOffset])

  // Closing and due dates for the displayed period
  const { closingDateStr, dueDateStr } = useMemo(() => {
    if (!account?.creditMetadata) return { closingDateStr: '', dueDateStr: '' }
    const { closingDay, dueDay } = account.creditMetadata
    // Closing date: last day of the period month at closingDay
    const closingYear = resolvedPeriod.year
    const closingMonth = resolvedPeriod.month // 1-based
    const daysInClosingMonth = new Date(closingYear, closingMonth, 0).getDate()
    const actualClosingDay = Math.min(closingDay, daysInClosingMonth)
    const closingDateStr = `${closingYear}-${String(closingMonth).padStart(2, '0')}-${String(actualClosingDay).padStart(2, '0')}`

    const dueDateStr = getInvoiceDueDate(resolvedPeriod, dueDay)
    return { closingDateStr, dueDateStr }
  }, [account, resolvedPeriod])

  // Transactions belonging to this invoice period
  const invoiceTransactions = useMemo(() => {
    if (!data || !account?.creditMetadata) return []
    const { closingDay } = account.creditMetadata
    return data.transactions.filter((tx) => {
      if (tx.accountId !== account.id) return false
      if (tx.type !== 'EXPENSE') return false // only expenses belong to the invoice
      const period = getInvoicePeriod(tx.date, closingDay)
      return period.year === resolvedPeriod.year && period.month === resolvedPeriod.month
    })
  }, [data, account, resolvedPeriod])

  // Category totals for the spending summary
  const categoryTotals = useMemo(() => {
    const map: Record<string, number> = {}
    invoiceTransactions.forEach((tx) => {
      const catName = data?.categories.find((c) => c.id === tx.categoryId)?.name ?? 'Outros'
      map[catName] = (map[catName] ?? 0) + tx.amount
    })
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, total]) => ({ name, total }))
  }, [invoiceTransactions, data])

  // Category options for the filter chips
  const categoryOptions = useMemo(() => {
    const seen = new Set<string>()
    const cats: { id: string; name: string }[] = []
    invoiceTransactions.forEach((tx) => {
      const cat = data?.categories.find((c) => c.id === tx.categoryId)
      if (cat && !seen.has(cat.id)) {
        seen.add(cat.id)
        cats.push({ id: cat.id, name: cat.name })
      }
    })
    return cats
  }, [invoiceTransactions, data])

  // Filtered transactions by selected category
  const filteredTransactions = useMemo(() => {
    if (filterCategory === 'all') return invoiceTransactions
    return invoiceTransactions.filter((tx) => tx.categoryId === filterCategory)
  }, [invoiceTransactions, filterCategory])

  const invoiceTotal = invoiceTransactions.reduce((s, tx) => s + tx.amount, 0)
  const availableLimit =
    account?.creditMetadata && data
      ? account.creditMetadata.limit - getCurrentInvoiceBalance(data.transactions, account)
      : 0

  if (!data) return null

  if (!account || account.type !== 'CREDIT') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-sm text-on-surface/40">{t('common.noData')}</p>
      </div>
    )
  }

  const monthLabel = MONTH_NAMES_PT[(resolvedPeriod.month - 1 + 12) % 12]

  // M-30: handle payment confirmation — creates a CREDIT_PAYMENT transaction
  function handlePayConfirm(amount: number, date: string, fromAccountId: string) {
    addTransaction({
      id: uuid(),
      accountId: account!.id,
      transferAccountId: fromAccountId,
      type: 'CREDIT_PAYMENT',
      amount,
      date,
      description: '',
      categoryId: '',
      isPaid: true,
      tags: [],
    })
    setShowPayModal(false)
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      {/* ── Header: back + card name ──────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => void navigate('/dashboard')}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-low text-on-surface/60 hover:bg-surface-container-high transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex items-center gap-2">
          {/* M-23: header icon color reflects the card issuer */}
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: getIssuerColor(account.issuerIcon) }}
          >
            <CreditCard size={14} strokeWidth={1.5} />
          </div>
          <h1 className="text-base font-semibold text-on-surface">{account.name}</h1>
        </div>
      </div>

      {/* ── Invoice period + summary card (full width) ────────────────────── */}
      <div className={cn('rounded-2xl bg-surface-container p-6', shadowClass)}>
        <div className="flex items-start justify-between gap-4">
          {/* Left: period info */}
          <div className="flex-1">
            <p className="label text-xs text-on-surface/40 uppercase tracking-widest mb-1">
              {t('creditCard.invoicePeriod')}
            </p>
            <h2 className="text-3xl font-bold text-on-surface">{monthLabel}</h2>
            {closingDateStr && dueDateStr && (
              <div className="flex items-center gap-4 mt-2">
                <div>
                  <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">
                    {t('creditCard.closingDate')}
                  </p>
                  <p className="text-xs font-semibold text-on-surface">
                    {parseDateLocal(closingDateStr).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-on-surface/40 uppercase tracking-wider">
                    {t('creditCard.dueDate')}
                  </p>
                  <p className="text-xs font-semibold text-tertiary">
                    {parseDateLocal(dueDateStr).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right: balance + pay button */}
          <div className="text-right space-y-2">
            <div>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">
                {t('accounts.availableLimit')}
              </p>
              <p
                className={cn(
                  'text-sm font-semibold tabular-nums',
                  availableLimit < 0 ? 'text-tertiary' : 'text-primary'
                )}
              >
                {formatCurrency(availableLimit)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-on-surface/40 uppercase tracking-widest">
                {t('dashboard.invoice')}
              </p>
              <p className="text-2xl font-bold tabular-nums text-on-surface">
                {formatCurrency(invoiceTotal)}
              </p>
            </div>
            {/* M-30: opens dedicated PayInvoiceModal instead of generic TransactionDrawer */}
            <button
              onClick={() => setShowPayModal(true)}
              className="rounded-2xl bg-gradient-to-br from-primary to-primary-container px-5 py-2 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97]"
            >
              {t('creditCard.payNow')}
            </button>
          </div>
        </div>

        {/* Period navigation */}
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-surface-container-low">
          <button
            onClick={() => setPeriodOffset((o) => o - 1)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-low text-on-surface/60 hover:bg-surface-container-high transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-medium text-on-surface/60">
            {monthLabel} {resolvedPeriod.year}
          </span>
          <button
            onClick={() => setPeriodOffset((o) => o + 1)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-container-low text-on-surface/60 hover:bg-surface-container-high transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* ── M-31: Two-column layout: chips + list | spending summary ─────── */}
      <div className="grid grid-cols-3 gap-6 items-start">
        {/* Left column: category chips + transaction list */}
        <div className="col-span-2 space-y-4">
          {/* Category filter chips */}
          {categoryOptions.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setFilterCategory('all')}
                className={cn(
                  'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                  filterCategory === 'all'
                    ? 'bg-primary text-white'
                    : 'bg-surface-container-low text-on-surface/60 hover:text-on-surface/80'
                )}
              >
                {t('creditCard.allCategories')}
              </button>
              {categoryOptions.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setFilterCategory(cat.id)}
                  className={cn(
                    'shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-all',
                    filterCategory === cat.id
                      ? 'bg-primary text-white'
                      : 'bg-surface-container-low text-on-surface/60 hover:text-on-surface/80'
                  )}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}

          {/* Transaction list */}
          <div className={cn('rounded-2xl bg-surface-container overflow-hidden', shadowClass)}>
            {filteredTransactions.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-on-surface/40">{t('creditCard.noTransactions')}</p>
              </div>
            ) : (
              filteredTransactions.map((tx, i) => (
                <InvoiceTxRow
                  key={tx.id}
                  tx={tx}
                  data={data}
                  isLast={i === filteredTransactions.length - 1}
                  onEdit={openTransactionDrawer}
                />
              ))
            )}
          </div>
        </div>

        {/* Right column: spending summary (sticky) */}
        <div className="col-span-1 sticky top-8">
          {categoryTotals.length > 0 && (
            <div className={cn('rounded-2xl bg-surface-container p-6', shadowClass)}>
              <h3 className="text-sm font-semibold text-on-surface mb-4">
                {t('creditCard.spendingSummary')}
              </h3>
              <div className="space-y-3">
                {categoryTotals.map(({ name, total }) => {
                  const pct = invoiceTotal > 0 ? (total / invoiceTotal) * 100 : 0
                  return (
                    <div key={name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-on-surface/70">{name}</span>
                        <span className="text-xs font-semibold tabular-nums text-on-surface">
                          {formatCurrency(total)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-surface-container-low overflow-hidden">
                        <div
                          className="h-full rounded-full bg-tertiary transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-4 pt-4 border-t border-surface-container-low flex items-center justify-between">
                <span className="text-xs font-semibold text-on-surface">{t('common.total')}</span>
                <span className="text-sm font-bold tabular-nums text-tertiary">
                  {formatCurrency(invoiceTotal)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── M-30: Pay Invoice Modal ───────────────────────────────────────── */}
      {showPayModal && (
        <PayInvoiceModal
          onClose={() => setShowPayModal(false)}
          resolvedPeriod={resolvedPeriod}
          monthLabel={monthLabel}
          invoiceTotal={invoiceTotal}
          nonCreditAccounts={nonCreditAccounts}
          onConfirm={handlePayConfirm}
        />
      )}
    </div>
  )
}

// ─── InvoiceTxRow ─────────────────────────────────────────────────────────────

function InvoiceTxRow({
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
  const cat = data.categories.find((c) => c.id === tx.categoryId)
  const acc = data.accounts.find((a) => a.id === tx.accountId)

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
      {/* Category icon */}
      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white text-sm font-semibold"
        style={{ backgroundColor: cat?.color ?? '#6B7280' }}
      >
        {cat?.name?.[0] ?? '?'}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-on-surface truncate">
          {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing */}
          {tx.description || cat?.name || '—'}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {cat && <span className="text-xs text-on-surface/40">{cat.name}</span>}
          {acc && <span className="text-xs text-on-surface/30">· {acc.name}</span>}
        </div>
      </div>

      {/* Amount */}
      <div className="text-right shrink-0">
        <p className="text-sm font-bold tabular-nums text-tertiary">{formatCurrency(tx.amount)}</p>
        <p className="text-[10px] text-on-surface/30 mt-0.5">
          {parseDateLocal(tx.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
        </p>
      </div>
    </div>
  )
}

// ─── PayInvoiceModal ──────────────────────────────────────────────────────────

function PayInvoiceModal({
  onClose,
  resolvedPeriod,
  monthLabel,
  invoiceTotal,
  nonCreditAccounts,
  onConfirm,
}: {
  onClose: () => void
  resolvedPeriod: { year: number; month: number }
  monthLabel: string
  invoiceTotal: number
  nonCreditAccounts: Account[]
  onConfirm: (amount: number, date: string, fromAccountId: string) => void
}) {
  const { t } = useTranslation()

  const [amountStr, setAmountStr] = useState(invoiceTotal.toFixed(2).replace('.', ','))
  const [amount, setAmount] = useState(invoiceTotal)
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [fromAccountId, setFromAccountId] = useState(nonCreditAccounts[0]?.id ?? '')

  // Re-sync defaults if parent invoiceTotal changes (e.g. period offset navigated while modal open)
  useEffect(() => {
    setAmount(invoiceTotal)
    setAmountStr(invoiceTotal.toFixed(2).replace('.', ','))
  }, [invoiceTotal])

  function handleAmountInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '')
    const cents = parseInt(raw || '0', 10)
    setAmount(cents / 100)
    setAmountStr((cents / 100).toFixed(2).replace('.', ','))
  }

  const referenceLabel = `${monthLabel} ${resolvedPeriod.year}`

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-on-surface/20 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div
          className="w-full max-w-sm rounded-2xl bg-surface-container-low p-6 space-y-5 shadow-card-ambient"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-on-surface">
              {t('creditCard.payInvoice')}
            </h3>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="flex h-7 w-7 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-low transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Reference month (read-only) */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 mb-1">
              {t('creditCard.referenceMonth')}
            </p>
            <p className="text-sm font-medium text-on-surface">{referenceLabel}</p>
          </div>

          {/* Amount */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 block mb-2">
              {t('transactions.amount')}
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-on-surface/40 pointer-events-none">
                R$
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={amountStr}
                onChange={handleAmountInput}
                className="w-full rounded-xl bg-surface-container-low py-3 pl-9 pr-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          </div>

          {/* Date */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 block mb-2">
              {t('transactions.date')}
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* From account */}
          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-on-surface/40 block mb-2">
              {t('transactions.account')}
            </label>
            <div className="relative">
              <select
                value={fromAccountId}
                onChange={(e) => setFromAccountId(e.target.value)}
                className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              >
                {nonCreditAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                {nonCreditAccounts.length === 0 && <option value="">{t('common.noData')}</option>}
              </select>
              <ChevronDown
                size={16}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
              />
            </div>
          </div>

          {/* Confirm */}
          <button
            onClick={() => onConfirm(amount, date, fromAccountId)}
            disabled={amount === 0 || !fromAccountId}
            className="w-full rounded-2xl bg-gradient-to-br from-primary to-primary-container py-3.5 text-sm font-semibold text-white hover:brightness-110 transition-all active:scale-[0.97] disabled:opacity-40"
          >
            {t('creditCard.payInvoice')}
          </button>
        </div>
      </div>
    </>
  )
}

import { useState, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Calendar,
  Tag,
  Trash2,
  CreditCard,
} from 'lucide-react'
import { useDataStore } from '@/store/useDataStore'
import {
  cn,
  uuid,
  formatCurrency,
  getCurrentInvoiceBalance,
  getTxInvoicePeriod,
  invoicePeriodKey,
  todayStr,
  sortCategoriesHierarchical,
  filterArchivedAccounts,
} from '@/lib/utils'
import DatePicker from '@/components/DatePicker'
import Select from '@/components/Select'
import MobileSheet from '@/components/MobileSheet'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { Transaction, TransactionType, RecurrenceFrequency } from '@/types'

export interface TransactionDrawerProps {
  open: boolean
  onClose: () => void
  transaction?: Transaction
}

type TxType = TransactionType

// CC-23: installment count options, 2-480 (matches the Organizze benchmark's range,
// covers long financings such as mortgages).
const INSTALLMENT_COUNT_OPTIONS = Array.from({ length: 479 }, (_, i) => i + 2)

const TYPE_CONFIG: Record<TxType, { label: string; color: string; bg: string; btnClass: string }> =
  {
    EXPENSE: {
      label: 'transactions.expense',
      color: 'text-tertiary',
      bg: 'bg-tertiary/10',
      btnClass: 'bg-tertiary hover:brightness-110',
    },
    INCOME: {
      label: 'transactions.income',
      color: 'text-primary',
      bg: 'bg-primary/10',
      btnClass: 'bg-primary hover:brightness-110',
    },
    TRANSFER: {
      label: 'transactions.transfer',
      color: 'text-on-surface',
      bg: 'bg-surface-container-high',
      btnClass: 'bg-on-surface hover:brightness-110',
    },
    CREDIT_PAYMENT: {
      label: 'transactions.creditPayment',
      color: 'text-on-surface',
      bg: 'bg-surface-container-high',
      btnClass: 'bg-on-surface hover:brightness-110',
    },
  }

export default function TransactionDrawer({ open, onClose, transaction }: TransactionDrawerProps) {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const data = useDataStore((s) => s.data)
  const addTransaction = useDataStore((s) => s.addTransaction)
  const updateTransaction = useDataStore((s) => s.updateTransaction)
  const deleteTransaction = useDataStore((s) => s.deleteTransaction)
  const deleteInstallmentGroup = useDataStore((s) => s.deleteInstallmentGroup)
  const deleteRecurrenceFrom = useDataStore((s) => s.deleteRecurrenceFrom)

  const isEditMode = transaction !== undefined

  // M-20: ref for auto-focusing the amount field on open
  const amountInputRef = useRef<HTMLInputElement>(null)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const [showTagMenu, setShowTagMenu] = useState(false)

  const [type, setType] = useState<TxType>('EXPENSE')
  const [amount, setAmount] = useState(0)
  const [amountStr, setAmountStr] = useState('0,00')
  const [date, setDate] = useState(todayStr())
  const [accountId, setAccountId] = useState('')
  // transferAccountId: destination for TRANSFER, or "pay from" account for CREDIT_PAYMENT
  const [transferAccountId, setTransferAccountId] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  // ── B-10: isPaid toggle ───────────────────────────────────────────────────────
  const [isPaid, setIsPaid] = useState(false)

  // ── CC-23: Installment state ──────────────────────────────────────────────────
  const [installmentsEnabled, setInstallmentsEnabled] = useState(false)
  const [installmentCount, setInstallmentCount] = useState(2)

  // ── CC-26: Installment deletion modal state ───────────────────────────────────
  const [showInstallmentDeleteModal, setShowInstallmentDeleteModal] = useState(false)

  // ── M-35: Recurrence state ────────────────────────────────────────────────────
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false)
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('monthly')
  const [recurrenceEndDate, setRecurrenceEndDate] = useState('')
  const [showRecurrenceDeleteModal, setShowRecurrenceDeleteModal] = useState(false)

  // Derived account lists for CREDIT_PAYMENT selectors
  const creditAccounts = useMemo(
    () => (data?.accounts ?? []).filter((a) => a.type === 'CREDIT'),
    [data]
  )
  const nonCreditAccounts = useMemo(
    () => (data?.accounts ?? []).filter((a) => a.type !== 'CREDIT'),
    [data]
  )
  // M-42: defaults for new transactions must pick an active (non-archived) account.
  const activeAccounts = useMemo(() => filterArchivedAccounts(data?.accounts ?? []), [data])
  const activeCreditAccounts = useMemo(
    () => filterArchivedAccounts(creditAccounts),
    [creditAccounts]
  )
  const activeNonCreditAccounts = useMemo(
    () => filterArchivedAccounts(nonCreditAccounts),
    [nonCreditAccounts]
  )

  // Derived: selected account for standard (non-CREDIT_PAYMENT) mode
  const selectedAccount = useMemo(
    () =>
      type !== 'CREDIT_PAYMENT'
        ? (data?.accounts ?? []).find((a) => a.id === accountId)
        : undefined,
    [type, accountId, data]
  )

  // M-58: move-to-invoice section — editing a charge/credit (not a payment) on a CREDIT
  // account with creditMetadata. Moved here from CC-32's inline row buttons.
  const showMoveInvoiceSection =
    isEditMode &&
    (type === 'EXPENSE' || type === 'INCOME') &&
    selectedAccount?.type === 'CREDIT' &&
    !!selectedAccount.creditMetadata

  // CC-23/CC-35: installments apply to EXPENSE on any account type (not just CREDIT) — a
  // financing booked parcela by parcela on a regular account is just as valid as a card
  // purchase; the debt engine (getTotalCommittedDebt/getDebtBreakdown, HE-08/HE-10) already
  // treats any non-LOAN account's open installments the same way.
  const canToggleInstallments = !isEditMode && type === 'EXPENSE'

  // M-35: recurrence applies to INCOME/EXPENSE on create.
  const canToggleRecurrence = !isEditMode && (type === 'INCOME' || type === 'EXPENSE')

  // CC-35: both toggles always render together (side by side) when either applies — mutually
  // exclusive via auto-off-on-click instead of hiding the other's whole section.
  const showToggleRow = canToggleInstallments || canToggleRecurrence

  // CC-35: isPaid doesn't apply per-installment at creation time (same as it never applied to
  // CREDIT charges) — each generated occurrence is managed individually afterward.
  const showIsPaidToggle =
    (type === 'INCOME' || (type === 'EXPENSE' && selectedAccount?.type !== 'CREDIT')) &&
    !installmentsEnabled

  // Reset or pre-fill on open — intentional setState-in-effect to initialise form fields
  useEffect(() => {
    if (open) {
      if (transaction) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setType(transaction.type)
        setAmount(transaction.amount)
        setAmountStr(transaction.amount.toFixed(2).replace('.', ','))
        setDate(transaction.date.slice(0, 10))
        setAccountId(transaction.accountId)
        setTransferAccountId(transaction.transferAccountId ?? '')
        setCategoryId(transaction.categoryId)
        setDescription(transaction.description)
        setSelectedTags(transaction.tags)
        setIsPaid(transaction.isPaid)
      } else {
        setType('EXPENSE')
        setAmount(0)
        setAmountStr('0,00')
        setDate(todayStr())
        setAccountId(activeAccounts[0]?.id ?? '')
        setTransferAccountId(activeNonCreditAccounts[0]?.id ?? '')
        setCategoryId('')
        setDescription('')
        setSelectedTags([])
        setIsPaid(false)
      }
      setInstallmentsEnabled(false)
      setInstallmentCount(2)
      setShowInstallmentDeleteModal(false)
      setRecurrenceEnabled(false)
      setRecurrenceFrequency('monthly')
      setRecurrenceEndDate('')
      setShowRecurrenceDeleteModal(false)
      setShowTagMenu(false)
    }
  }, [open, transaction, data, activeAccounts, activeNonCreditAccounts])

  // M-20: auto-focus the amount field whenever the drawer opens
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => amountInputRef.current?.focus(), 0)
      return () => clearTimeout(id)
    }
  }, [open])

  // Close tag menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (tagMenuRef.current && !tagMenuRef.current.contains(e.target as Node)) {
        setShowTagMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // When switching type, auto-select sensible account defaults
  function handleTypeChange(newType: TxType) {
    setType(newType)
    if (newType === 'CREDIT_PAYMENT') {
      setAccountId(activeCreditAccounts[0]?.id ?? '')
      setTransferAccountId(activeNonCreditAccounts[0]?.id ?? '')
      setCategoryId('')
    } else if (newType === 'TRANSFER') {
      const first = activeNonCreditAccounts[0]?.id ?? ''
      const second = activeNonCreditAccounts[1]?.id ?? activeNonCreditAccounts[0]?.id ?? ''
      setAccountId(first)
      setTransferAccountId(second)
      setCategoryId('')
      setIsPaid(true)
    } else {
      setAccountId(activeAccounts[0]?.id ?? '')
    }
    // Reset installment + recurrence state when type changes
    setInstallmentsEnabled(false)
    setInstallmentCount(2)
    setRecurrenceEnabled(false)
  }

  function handleAmountInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '')
    const cents = parseInt(raw || '0', 10)
    setAmount(cents / 100)
    setAmountStr((cents / 100).toFixed(2).replace('.', ','))
  }

  function toggleTag(id: string) {
    setSelectedTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  function handleSave() {
    if (!data || amount === 0) return

    // CC-23/CC-35: Build installment metadata if applicable (create mode, EXPENSE, any account)
    const parentId = uuid()
    const hasInstallments =
      !isEditMode && installmentsEnabled && installmentCount >= 2 && type === 'EXPENSE'

    // M-35: build recurrence metadata when enabled (create mode, INCOME/EXPENSE)
    const hasRecurrence =
      !isEditMode && recurrenceEnabled && (type === 'INCOME' || type === 'EXPENSE')

    const txId = hasInstallments ? parentId : isEditMode ? transaction.id : uuid()

    const payload: Transaction = {
      id: txId,
      accountId: accountId || activeAccounts[0]?.id || '',
      categoryId: type === 'CREDIT_PAYMENT' ? '' : categoryId,
      amount,
      type,
      date,
      description,
      isPaid,
      tags: selectedTags,
      ...((type === 'CREDIT_PAYMENT' || type === 'TRANSFER') && transferAccountId
        ? { transferAccountId }
        : {}),
      // Preserve the invoice period a CREDIT_PAYMENT settles (Option 2) when editing it.
      ...(isEditMode && transaction.referenceMonth
        ? { referenceMonth: transaction.referenceMonth }
        : {}),
      // B-24: preserve the original creation timestamp across edits — updateTransaction
      // replaces the whole record, so without this an edit would wipe it and break
      // "recently added" ordering in Dashboard.
      ...(isEditMode && transaction.createdAt ? { createdAt: transaction.createdAt } : {}),
      ...(isEditMode && transaction.installment ? { installment: transaction.installment } : {}),
      ...(hasInstallments
        ? { installment: { parentId, currentIndex: 1, total: installmentCount } }
        : {}),
      // M-35: preserve recurrence when editing an occurrence; set it when creating a series.
      ...(isEditMode && transaction.recurrence ? { recurrence: transaction.recurrence } : {}),
      ...(hasRecurrence
        ? {
            recurrence: {
              frequency: recurrenceFrequency,
              parentId: txId,
              ...(recurrenceEndDate ? { endDate: recurrenceEndDate } : {}),
            },
          }
        : {}),
    }
    if (isEditMode) {
      updateTransaction(payload)
    } else {
      addTransaction(payload)
    }
    onClose()
  }

  // CC-26 / M-35: Intercept delete for installment and recurring transactions
  function handleDelete() {
    if (!transaction) return
    if (transaction.installment) {
      setShowInstallmentDeleteModal(true)
    } else if (transaction.recurrence) {
      setShowRecurrenceDeleteModal(true)
    } else {
      deleteTransaction(transaction.id)
      onClose()
    }
  }

  function handleDeleteOnlyThis() {
    if (!transaction) return
    deleteTransaction(transaction.id)
    setShowInstallmentDeleteModal(false)
    setShowRecurrenceDeleteModal(false)
    onClose()
  }

  // M-35: delete this occurrence and all later ones in the series
  function handleDeleteThisAndFuture() {
    if (!transaction?.recurrence) return
    deleteRecurrenceFrom(transaction.recurrence.parentId, transaction.date)
    setShowRecurrenceDeleteModal(false)
    onClose()
  }

  function handleDeleteAllInstallments() {
    if (!transaction?.installment) return
    deleteInstallmentGroup(transaction.installment.parentId)
    setShowInstallmentDeleteModal(false)
    onClose()
  }

  // M-58: move a CREDIT charge/credit to the previous/next invoice by setting its
  // referenceMonth (CC-32/B-18). Real closing dates are fuzzy, so the user gets the final
  // say — moving never touches tx.date, only the invoice it posts to.
  function handleMoveInvoice(direction: -1 | 1) {
    if (!transaction || !selectedAccount?.creditMetadata) return
    const period = getTxInvoicePeriod(transaction, selectedAccount)
    let month = period.month + direction
    let year = period.year
    if (month < 1) {
      month = 12
      year -= 1
    } else if (month > 12) {
      month = 1
      year += 1
    }
    updateTransaction({ ...transaction, referenceMonth: invoicePeriodKey({ year, month }) })
    onClose()
  }

  const categories = sortCategoriesHierarchical(
    (data?.categories ?? []).filter((c) =>
      type === 'INCOME' ? c.type === 'INCOME' : c.type === 'EXPENSE'
    )
  )

  // Selected credit account (for invoice balance hint — CC-20)
  const selectedCreditAccount = useMemo(
    () => (type === 'CREDIT_PAYMENT' ? data?.accounts.find((a) => a.id === accountId) : undefined),
    [type, accountId, data]
  )

  const cfg = TYPE_CONFIG[type]

  // CC-23: Per-installment amount for hint
  const perInstallmentAmount = installmentCount >= 2 ? amount / installmentCount : 0

  return (
    <>
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-50 bg-on-surface/20 backdrop-blur-sm transition-opacity duration-300',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        )}
        onClick={onClose}
      />

      {/* Sheet
          MB-04: Mobile = full-height bottom sheet (slides up from bottom, 100dvh, no gap at
                 the top — CC-35 follow-up). Desktop = right-side panel (slides in from right,
                 full height, max 480px).
          translate-y / translate-x toggled by the `open` state — responsive via Tailwind. */}
      <aside
        className={cn(
          'fixed z-50 flex flex-col bg-surface-container-low shadow-card-ambient transition-transform duration-300 ease-[var(--ease-fluid)]',
          // Mobile layout: full-height bottom sheet
          'max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:h-dvh max-sm:rounded-t-2xl',
          // Desktop layout: right-side panel
          'sm:right-0 sm:top-0 sm:h-full sm:w-full sm:max-w-[480px]',
          // Animation: slide direction differs per viewport
          open
            ? 'max-sm:translate-y-0 sm:translate-x-0'
            : 'max-sm:translate-y-full sm:translate-x-full'
        )}
      >
        {/* Mobile drag handle indicator */}
        <div className="sm:hidden flex justify-center pt-3 pb-1 shrink-0">
          <div className="h-1 w-10 rounded-full bg-on-surface/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5">
          <h2 className="text-base font-semibold text-on-surface">
            {isEditMode ? t('transactions.edit') : t('transactions.new')}
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full text-on-surface/40 hover:bg-surface-container-low transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-hide px-6 pb-6 space-y-6">
          {/* Amount */}
          <div className="text-center">
            <p className="label text-on-surface/40 mb-1">R$</p>
            <input
              ref={amountInputRef}
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={handleAmountInput}
              className="w-full text-center text-4xl sm:text-5xl font-bold text-on-surface outline-none bg-transparent"
              placeholder="0,00"
            />
          </div>

          {/* Type selector — M-28: CREDIT_PAYMENT removed from tabs (payment initiated via
              "Pagar Agora" on /credit-card/:id instead). When editing an existing
              CREDIT_PAYMENT the type is fixed, so the selector is hidden entirely. */}
          {!(isEditMode && type === 'CREDIT_PAYMENT') && (
            <div className="flex rounded-2xl bg-surface-container-low p-1 gap-1">
              {(['EXPENSE', 'INCOME', 'TRANSFER'] as TxType[]).map((key) => (
                <button
                  key={key}
                  onClick={() => handleTypeChange(key)}
                  className={cn(
                    'flex-1 rounded-xl py-2 text-sm font-medium transition-all',
                    type === key
                      ? cn('bg-surface-container-high shadow-ambient', TYPE_CONFIG[key].color)
                      : 'text-on-surface/40 hover:text-on-surface/60'
                  )}
                >
                  {t(TYPE_CONFIG[key].label)}
                </button>
              ))}
            </div>
          )}

          {/* Description */}
          <div>
            <label className="label text-on-surface/40 block mb-2">
              {t('transactions.description')}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('transactions.descriptionPlaceholder')}
              className="w-full rounded-xl bg-surface-container-low px-4 py-3 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Date + isPaid (isPaid shown inline for INCOME/EXPENSE only, hidden while
              installments are on — CC-35: same reason it never showed for CREDIT charges) */}
          <div>
            {showIsPaidToggle ? (
              <div className="flex items-center justify-between mb-2">
                <span className="label text-on-surface/40">{t('transactions.date')}</span>
                <span className="label text-on-surface/40">{t('transactions.isPaid')}</span>
              </div>
            ) : (
              <label className="label text-on-surface/40 block mb-2">
                {t('transactions.date')}
              </label>
            )}
            <div className="flex items-center gap-3">
              <div className="flex-1 relative">
                <Calendar
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 z-10 text-on-surface/40"
                />
                <DatePicker
                  value={date}
                  onChange={setDate}
                  className="w-full rounded-xl bg-surface-container-low py-3 pl-9 pr-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
              {showIsPaidToggle && (
                <button
                  role="switch"
                  aria-checked={isPaid}
                  onClick={() => setIsPaid((v) => !v)}
                  className={cn(
                    'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
                    isPaid ? 'bg-primary' : 'bg-on-surface/20'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                      isPaid ? 'translate-x-6' : 'translate-x-1'
                    )}
                  />
                </button>
              )}
            </div>
          </div>

          {/* ── CREDIT_PAYMENT: two-account layout ─────────────────────────── */}
          {type === 'CREDIT_PAYMENT' ? (
            <>
              {/* Card to pay */}
              <div>
                <label className="label text-on-surface/40 flex items-center gap-1.5 mb-2">
                  <CreditCard size={12} />
                  {t('transactions.cardToPay')}
                </label>
                <Select
                  value={accountId}
                  onChange={setAccountId}
                  ariaLabel={t('transactions.cardToPay')}
                  placeholder={t('common.noData')}
                  options={filterArchivedAccounts(creditAccounts, accountId).map((a) => ({
                    value: a.id,
                    label: a.name,
                  }))}
                  className="rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* Pay from */}
              <div>
                <label className="label text-on-surface/40 block mb-2">
                  {t('transactions.payFrom')}
                </label>
                <Select
                  value={transferAccountId}
                  onChange={setTransferAccountId}
                  ariaLabel={t('transactions.payFrom')}
                  placeholder={t('common.noData')}
                  options={filterArchivedAccounts(nonCreditAccounts, transferAccountId).map(
                    (a) => ({ value: a.id, label: a.name })
                  )}
                  className="rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </>
          ) : type === 'TRANSFER' ? (
            /* ── TRANSFER: origin + destination accounts ────────────────── */
            <>
              {/* From account */}
              <div>
                <label className="label text-on-surface/40 block mb-2">
                  {t('transactions.transferFrom')}
                </label>
                <Select
                  value={accountId}
                  onChange={setAccountId}
                  ariaLabel={t('transactions.transferFrom')}
                  placeholder={t('common.noData')}
                  options={filterArchivedAccounts(nonCreditAccounts, accountId).map((a) => ({
                    value: a.id,
                    label: a.name,
                  }))}
                  className="rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>

              {/* To account */}
              <div>
                <label className="label text-on-surface/40 block mb-2">
                  {t('transactions.transferTo')}
                </label>
                <Select
                  value={transferAccountId}
                  onChange={setTransferAccountId}
                  ariaLabel={t('transactions.transferTo')}
                  placeholder={t('common.noData')}
                  options={filterArchivedAccounts(
                    nonCreditAccounts.filter((a) => a.id !== accountId),
                    transferAccountId
                  ).map((a) => ({ value: a.id, label: a.name }))}
                  className="rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                />
              </div>
            </>
          ) : (
            /* ── Standard account selector ──────────────────────────────── */
            <div>
              <label className="label text-on-surface/40 block mb-2">
                {t('transactions.account')}
              </label>
              <Select
                value={accountId}
                onChange={(newAccountId) => {
                  setAccountId(newAccountId)
                  // Reset installment toggle when account changes
                  setInstallmentsEnabled(false)
                  setInstallmentCount(2)
                  // Hide isPaid when switching to a CREDIT account
                  const newAccount = (data?.accounts ?? []).find((a) => a.id === newAccountId)
                  if (newAccount?.type === 'CREDIT') setIsPaid(false)
                }}
                ariaLabel={t('transactions.account')}
                placeholder={t('common.noData')}
                options={filterArchivedAccounts(data?.accounts ?? [], accountId).map((a) => ({
                  value: a.id,
                  label: a.name,
                }))}
                className="rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          {/* ── CC-23/CC-35: Installments + M-35: Recurrence — side-by-side toggles (any
              account type since CC-35), mutually exclusive via auto-off-on-click instead of
              hiding the other's whole section, create mode only ── */}
          {showToggleRow && (
            <div className="rounded-xl bg-surface-container-low px-4 py-3 space-y-3">
              {/* Toggle row — 2 columns when both apply, 1 when only recurrence does (INCOME) */}
              <div
                className={cn(
                  'grid gap-4',
                  canToggleInstallments && canToggleRecurrence ? 'grid-cols-2' : 'grid-cols-1'
                )}
              >
                {canToggleInstallments && (
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-on-surface">
                      {t('transactions.installments')}
                    </label>
                    <button
                      role="switch"
                      aria-label={t('transactions.installments')}
                      aria-checked={installmentsEnabled}
                      onClick={() => {
                        setInstallmentsEnabled((v) => !v)
                        if (!installmentsEnabled) {
                          setInstallmentCount(2)
                          setRecurrenceEnabled(false)
                        }
                      }}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        installmentsEnabled ? 'bg-primary' : 'bg-on-surface/20'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                          installmentsEnabled ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>
                )}
                {canToggleRecurrence && (
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-on-surface">
                      {t('transactions.recurrence')}
                    </label>
                    <button
                      role="switch"
                      aria-label={t('transactions.recurrence')}
                      aria-checked={recurrenceEnabled}
                      onClick={() => {
                        setRecurrenceEnabled((v) => !v)
                        if (!recurrenceEnabled) setInstallmentsEnabled(false)
                      }}
                      className={cn(
                        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                        recurrenceEnabled ? 'bg-primary' : 'bg-on-surface/20'
                      )}
                    >
                      <span
                        className={cn(
                          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
                          recurrenceEnabled ? 'translate-x-6' : 'translate-x-1'
                        )}
                      />
                    </button>
                  </div>
                )}
              </div>

              {/* Count field + hint (installments) */}
              {installmentsEnabled && (
                <>
                  <div>
                    <label className="label text-on-surface/40 block mb-2">
                      {t('transactions.installmentCount')}
                    </label>
                    <Select
                      value={String(installmentCount)}
                      onChange={(v) => setInstallmentCount(parseInt(v, 10))}
                      ariaLabel={t('transactions.installmentCount')}
                      options={INSTALLMENT_COUNT_OPTIONS.map((n) => ({
                        value: String(n),
                        label: String(n),
                      }))}
                      className="rounded-xl bg-surface-container-high py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>
                  {amount > 0 && (
                    <p className="text-xs text-on-surface/50">
                      {t('transactions.installmentHint', {
                        count: installmentCount,
                        value: formatCurrency(perInstallmentAmount),
                      })}
                    </p>
                  )}
                </>
              )}

              {/* Frequency selector + end date + hint (recurrence) */}
              {recurrenceEnabled && (
                <>
                  <div>
                    <label className="label text-on-surface/40 block mb-2">
                      {t('transactions.recurrenceFrequency')}
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['weekly', 'biweekly', 'monthly'] as const).map((freq) => (
                        <button
                          key={freq}
                          type="button"
                          onClick={() => setRecurrenceFrequency(freq)}
                          className={cn(
                            'rounded-xl py-2.5 text-sm font-medium transition-colors',
                            recurrenceFrequency === freq
                              ? 'bg-primary text-white'
                              : 'bg-surface-container-high text-on-surface/60 hover:text-on-surface'
                          )}
                        >
                          {t(`transactions.recurrence_${freq}`)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Optional end date */}
                  <div>
                    <label className="label text-on-surface/40 block mb-2">
                      {t('transactions.recurrenceEndDate')}
                    </label>
                    <DatePicker
                      value={recurrenceEndDate}
                      min={date}
                      onChange={setRecurrenceEndDate}
                      className="w-full rounded-xl bg-surface-container-high py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                    />
                  </div>

                  <p className="text-xs text-on-surface/50">
                    {recurrenceEndDate
                      ? t('transactions.recurrenceHintEnd')
                      : t('transactions.recurrenceHintHorizon')}
                  </p>
                </>
              )}
            </div>
          )}

          {/* Category — hidden for TRANSFER and CREDIT_PAYMENT */}
          {type !== 'TRANSFER' && type !== 'CREDIT_PAYMENT' && (
            <div>
              <label className="label text-on-surface/40 block mb-2">
                {t('transactions.category')}
              </label>
              <Select
                value={categoryId}
                onChange={setCategoryId}
                ariaLabel={t('transactions.category')}
                options={[
                  { value: '', label: t('transactions.category') },
                  ...categories.map((c) => ({
                    value: c.id,
                    label: c.parentId ? `— ${c.name}` : c.name,
                  })),
                ]}
                className="rounded-xl bg-surface-container-low py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
              />
            </div>
          )}

          {/* Tags */}
          {(data?.tags ?? []).length > 0 && (
            <div>
              <label className="label text-on-surface/40 flex items-center gap-1 mb-2">
                <Tag size={12} />
                {t('transactions.tags')}
              </label>

              {/* Dropdown trigger + panel */}
              <div className="relative" ref={tagMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowTagMenu((v) => !v)}
                  className="w-full flex items-center justify-between rounded-xl bg-surface-container-low py-3 px-4 text-sm outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <span className="text-on-surface/40">{t('transactions.tagsPlaceholder')}</span>
                  <ChevronDown
                    size={16}
                    className={cn(
                      'text-on-surface/40 transition-transform',
                      showTagMenu && 'rotate-180'
                    )}
                  />
                </button>

                {(() => {
                  const availableTags = (data?.tags ?? []).filter(
                    (tag) => !selectedTags.includes(tag.id)
                  )
                  const tagOptions =
                    availableTags.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-center text-on-surface/40">
                        {t('transactions.tagsAllSelected')}
                      </p>
                    ) : (
                      availableTags.map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          className="flex w-full items-center gap-2.5 rounded-xl px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-high transition-colors"
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: tag.color }}
                          />
                          #{tag.name}
                        </button>
                      ))
                    )

                  return isMobile ? (
                    <MobileSheet
                      open={showTagMenu}
                      onClose={() => setShowTagMenu(false)}
                      role="group"
                      ariaLabel={t('transactions.tags')}
                      contentClassName="px-3 pb-2"
                    >
                      {tagOptions}
                    </MobileSheet>
                  ) : (
                    showTagMenu && (
                      <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-xl bg-surface-container-high border border-outline-variant shadow-ambient p-1.5">
                        {tagOptions}
                      </div>
                    )
                  )
                })()}
              </div>

              {/* Selected tags chips */}
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedTags.map((tagId) => {
                    const tag = (data?.tags ?? []).find((tg) => tg.id === tagId)
                    if (!tag) return null
                    return (
                      <span
                        key={tag.id}
                        className="flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium text-white"
                        style={{ backgroundColor: tag.color }}
                      >
                        #{tag.name}
                        <button
                          type="button"
                          onClick={() => toggleTag(tag.id)}
                          aria-label={`Remover ${tag.name}`}
                          className="flex items-center justify-center rounded-full hover:bg-white/20 transition-colors"
                        >
                          <X size={11} />
                        </button>
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── M-58: move charge/credit to previous/next invoice (CC-32/B-18) ── */}
          {showMoveInvoiceSection && (
            <div className="rounded-xl bg-surface-container-low px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-on-surface/50">{t('creditCard.moveInvoice')}</p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={t('creditCard.moveToPrevInvoice')}
                  title={t('creditCard.moveToPrevInvoice')}
                  onClick={() => handleMoveInvoice(-1)}
                  className="rounded-lg p-1.5 text-on-surface/40 hover:bg-surface-container-high hover:text-on-surface/70 transition-colors"
                >
                  <ChevronsLeft size={16} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  aria-label={t('creditCard.moveToNextInvoice')}
                  title={t('creditCard.moveToNextInvoice')}
                  onClick={() => handleMoveInvoice(1)}
                  className="rounded-lg p-1.5 text-on-surface/40 hover:bg-surface-container-high hover:text-on-surface/70 transition-colors"
                >
                  <ChevronsRight size={16} strokeWidth={1.5} />
                </button>
              </div>
            </div>
          )}

          {/* ── CC-20: current invoice balance hint for CREDIT_PAYMENT ────── */}
          {type === 'CREDIT_PAYMENT' && selectedCreditAccount?.creditMetadata && (
            <div className="rounded-xl bg-surface-container-low px-4 py-3 flex items-center justify-between">
              <p className="text-xs text-on-surface/50">{t('transactions.currentInvoice')}</p>
              <p className="text-sm font-semibold text-tertiary">
                {formatCurrency(
                  getCurrentInvoiceBalance(data?.transactions ?? [], selectedCreditAccount)
                )}
              </p>
            </div>
          )}
        </div>

        {/* Footer CTA
            max-sm:pb-20 (80px) only in edit mode: clears the delete button (rendered below
            the save button) above the fixed bottom nav. Create mode has no delete button, so
            it doesn't need that extra clearance — reclaiming it helps Tags fit above the fold. */}
        <div
          className={cn(
            'px-6 pb-8 pt-4 border-t border-surface-container-low space-y-3',
            isEditMode ? 'max-sm:pb-20' : 'max-sm:pb-6'
          )}
        >
          {!isEditMode && (
            // Keyboard shortcut hint is meaningless on mobile (no physical Enter key) — hiding
            // it there reclaims a full line of the sheet's permanently-visible footer.
            <p className="hidden sm:block text-center text-xs text-on-surface/30">
              {t('transactions.shortcutHint')}
            </p>
          )}
          <button
            onClick={handleSave}
            disabled={amount === 0}
            className={cn(
              'w-full rounded-2xl py-4 text-sm font-semibold text-white transition-all disabled:opacity-40',
              cfg.btnClass
            )}
          >
            {isEditMode
              ? `${t('transactions.saveUpdate')} →`
              : `${t(`transactions.save.${type.toLowerCase()}`)} →`}
          </button>
          {isEditMode && (
            <button
              onClick={handleDelete}
              className="w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-medium text-tertiary hover:bg-tertiary/5 transition-colors"
            >
              <Trash2 size={15} />
              {t('transactions.deleteTransaction')}
            </button>
          )}
        </div>

        {/* ── CC-26: Installment deletion modal ────────────────────────────── */}
        {showInstallmentDeleteModal && transaction?.installment && (
          <div className="absolute inset-0 z-10 flex items-end bg-on-surface/30 backdrop-blur-sm">
            <div className="w-full rounded-t-2xl bg-surface-container-low border-t border-outline-variant px-6 pb-8 pt-6 space-y-3">
              <h3 className="text-base font-semibold text-on-surface">
                {t('transactions.deleteInstallmentTitle')}
              </h3>
              <button
                onClick={handleDeleteOnlyThis}
                className="w-full rounded-2xl border border-tertiary/30 py-3 text-sm font-medium text-tertiary hover:bg-tertiary/5 transition-colors"
              >
                {t('transactions.deleteOnlyThis', {
                  current: transaction.installment.currentIndex,
                  total: transaction.installment.total,
                })}
              </button>
              <button
                onClick={handleDeleteAllInstallments}
                className="w-full rounded-2xl bg-tertiary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all"
              >
                {t('transactions.deleteAllInstallments', {
                  total: transaction.installment.total,
                })}
              </button>
              <button
                onClick={() => setShowInstallmentDeleteModal(false)}
                className="w-full rounded-2xl py-3 text-sm font-medium text-on-surface/50 hover:bg-surface-container-low transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}

        {/* ── M-35: Recurrence deletion modal ──────────────────────────────── */}
        {showRecurrenceDeleteModal && transaction?.recurrence && (
          <div className="absolute inset-0 z-10 flex items-end bg-on-surface/30 backdrop-blur-sm">
            <div className="w-full rounded-t-2xl bg-surface-container-low border-t border-outline-variant px-6 pb-8 pt-6 space-y-3">
              <h3 className="text-base font-semibold text-on-surface">
                {t('transactions.deleteRecurrenceTitle')}
              </h3>
              <button
                onClick={handleDeleteOnlyThis}
                className="w-full rounded-2xl border border-tertiary/30 py-3 text-sm font-medium text-tertiary hover:bg-tertiary/5 transition-colors"
              >
                {t('transactions.deleteRecurrenceOnlyThis')}
              </button>
              <button
                onClick={handleDeleteThisAndFuture}
                className="w-full rounded-2xl bg-tertiary py-3 text-sm font-semibold text-white hover:brightness-110 transition-all"
              >
                {t('transactions.deleteRecurrenceThisAndFuture')}
              </button>
              <button
                onClick={() => setShowRecurrenceDeleteModal(false)}
                className="w-full rounded-2xl py-3 text-sm font-medium text-on-surface/50 hover:bg-surface-container-low transition-colors"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  )
}

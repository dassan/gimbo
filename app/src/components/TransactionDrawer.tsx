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
import type { Transaction, TransactionType, RecurrenceFrequency } from '@/types'

export interface TransactionDrawerProps {
  open: boolean
  onClose: () => void
  transaction?: Transaction
}

type TxType = TransactionType

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

  // CC-23: Show installment section only when creating an EXPENSE on a CREDIT account.
  // M-35: installments and recurrence are mutually exclusive.
  const showInstallmentSection =
    !isEditMode && type === 'EXPENSE' && selectedAccount?.type === 'CREDIT' && !recurrenceEnabled

  // M-35: recurrence applies to INCOME/EXPENSE on create; hidden while installments are on.
  const showRecurrenceSection =
    !isEditMode && (type === 'INCOME' || type === 'EXPENSE') && !installmentsEnabled

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

    // CC-23: Build installment metadata if applicable (create mode, EXPENSE, CREDIT account)
    const parentId = uuid()
    const hasInstallments =
      !isEditMode &&
      installmentsEnabled &&
      installmentCount >= 2 &&
      type === 'EXPENSE' &&
      selectedAccount?.type === 'CREDIT'

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
          MB-04: Mobile = bottom sheet (slides up from bottom, 85dvh, rounded top corners).
                 Desktop = right-side panel (slides in from right, full height, max 480px).
          translate-y / translate-x toggled by the `open` state — responsive via Tailwind. */}
      <aside
        className={cn(
          'fixed z-50 flex flex-col bg-surface-container-low shadow-card-ambient transition-transform duration-300 ease-[var(--ease-fluid)]',
          // Mobile layout: bottom sheet
          'max-sm:bottom-0 max-sm:left-0 max-sm:right-0 max-sm:h-[85dvh] max-sm:rounded-t-2xl',
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

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
          {/* Amount */}
          <div className="text-center">
            <p className="label text-on-surface/40 mb-1">R$</p>
            <input
              ref={amountInputRef}
              type="text"
              inputMode="numeric"
              value={amountStr}
              onChange={handleAmountInput}
              className="w-full text-center text-5xl font-bold text-on-surface outline-none bg-transparent"
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

          {/* Date + isPaid (isPaid shown inline for INCOME/EXPENSE only) */}
          <div>
            {(type === 'INCOME' || (type === 'EXPENSE' && selectedAccount?.type !== 'CREDIT')) && (
              <div className="flex items-center justify-between mb-2">
                <span className="label text-on-surface/40">{t('transactions.date')}</span>
                <span className="label text-on-surface/40">{t('transactions.isPaid')}</span>
              </div>
            )}
            {!(type === 'INCOME' || (type === 'EXPENSE' && selectedAccount?.type !== 'CREDIT')) && (
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
              {(type === 'INCOME' ||
                (type === 'EXPENSE' && selectedAccount?.type !== 'CREDIT')) && (
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
                <div className="relative">
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {filterArchivedAccounts(creditAccounts, accountId).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                    {filterArchivedAccounts(creditAccounts, accountId).length === 0 && (
                      <option value="">{t('common.noData')}</option>
                    )}
                  </select>
                  <ChevronDown
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
                  />
                </div>
              </div>

              {/* Pay from */}
              <div>
                <label className="label text-on-surface/40 block mb-2">
                  {t('transactions.payFrom')}
                </label>
                <div className="relative">
                  <select
                    value={transferAccountId}
                    onChange={(e) => setTransferAccountId(e.target.value)}
                    className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {filterArchivedAccounts(nonCreditAccounts, transferAccountId).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                    {filterArchivedAccounts(nonCreditAccounts, transferAccountId).length === 0 && (
                      <option value="">{t('common.noData')}</option>
                    )}
                  </select>
                  <ChevronDown
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
                  />
                </div>
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
                <div className="relative">
                  <select
                    value={accountId}
                    onChange={(e) => setAccountId(e.target.value)}
                    className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {filterArchivedAccounts(nonCreditAccounts, accountId).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                    {filterArchivedAccounts(nonCreditAccounts, accountId).length === 0 && (
                      <option value="">{t('common.noData')}</option>
                    )}
                  </select>
                  <ChevronDown
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
                  />
                </div>
              </div>

              {/* To account */}
              <div>
                <label className="label text-on-surface/40 block mb-2">
                  {t('transactions.transferTo')}
                </label>
                <div className="relative">
                  <select
                    value={transferAccountId}
                    onChange={(e) => setTransferAccountId(e.target.value)}
                    className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                  >
                    {filterArchivedAccounts(
                      nonCreditAccounts.filter((a) => a.id !== accountId),
                      transferAccountId
                    ).map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                    {filterArchivedAccounts(
                      nonCreditAccounts.filter((a) => a.id !== accountId),
                      transferAccountId
                    ).length === 0 && <option value="">{t('common.noData')}</option>}
                  </select>
                  <ChevronDown
                    size={16}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
                  />
                </div>
              </div>
            </>
          ) : (
            /* ── Standard account selector ──────────────────────────────── */
            <div>
              <label className="label text-on-surface/40 block mb-2">
                {t('transactions.account')}
              </label>
              <div className="relative">
                <select
                  value={accountId}
                  onChange={(e) => {
                    const newAccountId = e.target.value
                    setAccountId(newAccountId)
                    // Reset installment toggle when account changes
                    setInstallmentsEnabled(false)
                    setInstallmentCount(2)
                    // Hide isPaid when switching to a CREDIT account
                    const newAccount = (data?.accounts ?? []).find((a) => a.id === newAccountId)
                    if (newAccount?.type === 'CREDIT') setIsPaid(false)
                  }}
                  className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {filterArchivedAccounts(data?.accounts ?? [], accountId).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                  {filterArchivedAccounts(data?.accounts ?? [], accountId).length === 0 && (
                    <option value="">{t('common.noData')}</option>
                  )}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
                />
              </div>
            </div>
          )}

          {/* ── CC-23: Installment section (EXPENSE on CREDIT account, create only) ── */}
          {showInstallmentSection && (
            <div className="rounded-xl bg-surface-container-low px-4 py-3 space-y-3">
              {/* Toggle row */}
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
                    if (!installmentsEnabled) setInstallmentCount(2)
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

              {/* Count field + hint */}
              {installmentsEnabled && (
                <>
                  <div>
                    <label className="label text-on-surface/40 block mb-2">
                      {t('transactions.installmentCount')}
                    </label>
                    <input
                      type="number"
                      min={2}
                      max={36}
                      value={installmentCount}
                      onChange={(e) => {
                        const v = Math.max(2, Math.min(36, parseInt(e.target.value, 10) || 2))
                        setInstallmentCount(v)
                      }}
                      className="w-full rounded-xl bg-surface-container-high py-3 px-4 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
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
            </div>
          )}

          {/* ── M-35: Recurrence section (INCOME/EXPENSE, create only) ──────────── */}
          {showRecurrenceSection && (
            <div className="rounded-xl bg-surface-container-low px-4 py-3 space-y-3">
              {/* Toggle row */}
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-on-surface">
                  {t('transactions.recurrence')}
                </label>
                <button
                  role="switch"
                  aria-label={t('transactions.recurrence')}
                  aria-checked={recurrenceEnabled}
                  onClick={() => setRecurrenceEnabled((v) => !v)}
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

              {recurrenceEnabled && (
                <>
                  {/* Frequency selector */}
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
              <div className="relative">
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="w-full appearance-none rounded-xl bg-surface-container-low py-3 pl-4 pr-9 text-sm text-on-surface outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">{t('transactions.category')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.parentId ? `— ${c.name}` : c.name}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  size={16}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface/40 pointer-events-none"
                />
              </div>
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

                {showTagMenu && (
                  <div className="absolute z-20 mt-1 w-full rounded-xl bg-surface-container-high border border-outline-variant shadow-ambient overflow-hidden">
                    {(data?.tags ?? []).filter((tag) => !selectedTags.includes(tag.id)).length ===
                    0 ? (
                      <p className="px-4 py-3 text-sm text-center text-on-surface/40">
                        {t('transactions.tagsAllSelected')}
                      </p>
                    ) : (
                      <div className="max-h-48 overflow-y-auto">
                        {(data?.tags ?? [])
                          .filter((tag) => !selectedTags.includes(tag.id))
                          .map((tag) => (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() => toggleTag(tag.id)}
                              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-on-surface hover:bg-surface-container-low transition-colors"
                            >
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: tag.color }}
                              />
                              #{tag.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                )}
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
            max-sm:pb-20: 80px bottom padding on mobile keeps the delete button above
            the fixed bottom nav (h-16 = 64px) — the extra 16px adds comfortable clearance. */}
        <div className="px-6 pb-8 max-sm:pb-20 pt-4 border-t border-surface-container-low space-y-3">
          {!isEditMode && (
            <p className="text-center text-xs text-on-surface/30">
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

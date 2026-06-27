import type {
  Account,
  Category,
  IncomeWindowMonths,
  RecurrenceFrequency,
  Transaction,
} from '@/types'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind classes safely. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Generate a UUID v4. */
export function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Fallback for non-secure contexts (e.g. http:// on local network)
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  return [...bytes]
    .map((b, i) =>
      [4, 6, 8, 10].includes(i)
        ? `-${b.toString(16).padStart(2, '0')}`
        : b.toString(16).padStart(2, '0')
    )
    .join('')
}

/** Return current ISO 8601 timestamp. */
export function now(): string {
  return new Date().toISOString()
}

/**
 * B-15: whether a transaction represents cash that has actually moved ("realized").
 * The `isPaid` toggle exists only for INCOME/EXPENSE; TRANSFER and CREDIT_PAYMENT
 * have no toggle and are always treated as realized (the cash movement is implicit).
 * Use this to keep realized balances/flows consistent — never gate TRANSFER on `isPaid`.
 */
export function isCashRealized(tx: Transaction): boolean {
  return tx.type === 'TRANSFER' || tx.type === 'CREDIT_PAYMENT' || tx.isPaid
}

/** Format a number as currency. */
export function formatCurrency(value: number, locale: string = 'pt-BR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: locale === 'pt-BR' ? 'BRL' : 'USD',
  }).format(value)
}

/**
 * M-46: order categories for selection UIs — root categories alphabetically, each
 * followed immediately by its children (also alphabetical). Assumes a single level
 * of nesting (root: parentId === null), consistent with the rest of the app.
 */
export function sortCategoriesHierarchical(categories: Category[]): Category[] {
  const collator = new Intl.Collator('pt-BR')
  const roots = categories
    .filter((c) => c.parentId === null)
    .sort((a, b) => collator.compare(a.name, b.name))
  const result: Category[] = []
  for (const root of roots) {
    result.push(root)
    const children = categories
      .filter((c) => c.parentId === root.id)
      .sort((a, b) => collator.compare(a.name, b.name))
    result.push(...children)
  }
  return result
}

/**
 * M-42: filter out archived accounts from selection UIs, except an account whose id matches
 * `keepId` (e.g. the account already selected on a transaction being edited, or the active
 * filter) — archiving only hides accounts from *new* selections, never breaks an existing one.
 */
export function filterArchivedAccounts<T extends { id: string; archived?: boolean }>(
  accounts: T[],
  keepId?: string
): T[] {
  return accounts.filter((a) => !a.archived || a.id === keepId)
}

/**
 * Parse a "YYYY-MM-DD" date string as local midnight.
 * Using new Date(str) with a date-only string creates a UTC midnight Date,
 * which causes getMonth()/getFullYear() to return wrong values in UTC- timezones.
 */
export function parseDateLocal(dateStr: string): Date {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Returns today's date as "YYYY-MM-DD" in local time (avoids UTC offset from toISOString). */
export function todayStr(): string {
  return formatDateLocal(new Date())
}

/** Inverse of parseDateLocal: formats a local Date as "YYYY-MM-DD". */
export function formatDateLocal(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// ─── Recurrence date arithmetic (M-35 / B-22) ─────────────────────────────────
// Shared by the store (materializing real occurrences) and the projection layer
// (computing virtual ones) — both need the exact same date-advancing rules.

/**
 * Advances a "YYYY-MM-DD" date string by the given number of months using local
 * date arithmetic (no UTC conversions). If the target month has fewer days than
 * the original day, the day is clamped to the last day of that month.
 */
export function advanceMonths(dateStr: string, months: number): string {
  if (months === 0) return dateStr.slice(0, 10)
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  let newMonth = m + months
  let newYear = y
  while (newMonth > 12) {
    newMonth -= 12
    newYear += 1
  }
  const lastDay = new Date(newYear, newMonth, 0).getDate()
  const clampedDay = Math.min(d, lastDay)
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
}

/** Advances a "YYYY-MM-DD" date string by the given number of days (local arithmetic). */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number)
  const dt = new Date(y, m - 1, d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

/** Advances a date by `n` recurrence periods according to the frequency. */
export function advanceByFrequency(
  dateStr: string,
  frequency: RecurrenceFrequency,
  n: number
): string {
  if (n === 0) return dateStr.slice(0, 10)
  if (frequency === 'weekly') return addDays(dateStr, 7 * n)
  if (frequency === 'biweekly') return addDays(dateStr, 14 * n)
  return advanceMonths(dateStr.slice(0, 10), n) // monthly
}

// ─── Projection layer (M-62) ───────────────────────────────────────────────────
// Long-range forecasting (e.g. Reports' cash-flow chart) needs to see recurring
// series beyond whatever is currently materialized as real Transaction rows
// (the rolling window from B-22/refreshRecurrenceHorizons). This computes those
// future occurrences purely in memory — never persisted, never validated by the
// DataFile schema, never touches the store. Capped at PROJECTION_HORIZON_YEARS so
// long-range views have a fixed, predictable ceiling regardless of selected period.
export const PROJECTION_HORIZON_YEARS = 10

export type ProjectedTransaction = Transaction & { isProjected: true }

/**
 * Computes virtual future occurrences of every open-ended recurring series
 * (no `recurrence.endDate`) beyond its last materialized occurrence, up to
 * `horizonEnd` ("YYYY-MM-DD"). Series with an explicit `endDate` are skipped —
 * they were already fully generated up to that date at creation/top-up time.
 * Pure function: never mutates `transactions`, never persists anything.
 */
export function projectRecurringOccurrences(
  transactions: Transaction[],
  horizonEnd: string
): ProjectedTransaction[] {
  const byParent = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    if (!tx.recurrence) continue
    const arr = byParent.get(tx.recurrence.parentId)
    if (arr) arr.push(tx)
    else byParent.set(tx.recurrence.parentId, [tx])
  }

  const MAX_OCCURRENCES_PER_SERIES = 1000 // safety cap (≈19 years of weekly)
  const projected: ProjectedTransaction[] = []
  for (const occurrences of byParent.values()) {
    const { frequency, parentId, endDate } = occurrences[0].recurrence!
    if (endDate) continue // bounded series — nothing beyond what's already materialized

    let maxDate = occurrences[0].date.slice(0, 10)
    let template = occurrences[0]
    for (const occ of occurrences) {
      const d = occ.date.slice(0, 10)
      if (d > maxDate) {
        maxDate = d
        template = occ
      }
    }
    if (maxDate >= horizonEnd) continue

    for (let i = 1; i <= MAX_OCCURRENCES_PER_SERIES; i++) {
      const occDate = advanceByFrequency(maxDate, frequency, i)
      if (occDate > horizonEnd) break
      projected.push({
        ...template,
        id: uuid(),
        date: occDate,
        isPaid: false,
        recurrence: { frequency, parentId },
        isProjected: true,
      })
    }
  }
  return projected
}

// ─── Credit Card — Invoice Engine ─────────────────────────────────────────────

/**
 * Computes the *default* invoice period (year/month) for a transaction from its
 * date — the fallback used when no explicit association is stored. Prefer
 * getTxInvoicePeriod, which honours a per-transaction override first (B-18).
 *
 * Rule: a purchase on or after `closingDay` falls into the *next* month's
 * invoice; before the closing day it belongs to the current month's invoice.
 * The closing day itself opens the new cycle (matches real card statements and
 * the Organizze export: a charge dated on the closing day appears on the
 * following invoice).
 *
 * Edge case: a purchase in December on/after the closing day rolls into January
 * of the following year.
 *
 * Note: this date rule is only a heuristic. Real closing dates drift (weekends,
 * holidays, bank processing) so the same calendar day can land on either
 * invoice; the authoritative association lives in Transaction.referenceMonth.
 */
export function getInvoicePeriod(
  txDate: string,
  closingDay: number
): { year: number; month: number } {
  const d = parseDateLocal(txDate)
  const day = d.getDate()
  const year = d.getFullYear()
  const month = d.getMonth() + 1 // 1-based

  if (day >= closingDay) {
    // Roll forward one month
    if (month === 12) {
      return { year: year + 1, month: 1 }
    }
    return { year, month: month + 1 }
  }

  return { year, month }
}

/**
 * Returns the due date string ("YYYY-MM-DD") for a given invoice period.
 *
 * The bill closes on `closingDay` of the period month; the due date follows.
 * When `dueDay > closingDay` the due date lands in the SAME month as the closing
 * (e.g. Amazon: closes on the 1st, due on the 7th); otherwise it falls in the
 * *following* month (e.g. Nubank: closes on the 30th, due on the 7th). If `dueDay`
 * exceeds the days in the due month, the last day is used (avoids February edges).
 */
export function getInvoiceDueDate(
  invoicePeriod: { year: number; month: number },
  dueDay: number,
  closingDay: number
): string {
  let dueYear = invoicePeriod.year
  let dueMonth = invoicePeriod.month // 1-based; same month when dueDay > closingDay
  if (dueDay <= closingDay) {
    dueMonth += 1
    if (dueMonth > 12) {
      dueMonth = 1
      dueYear += 1
    }
  }

  // Last day of the due month (day 0 of the following 0-based month)
  const lastDay = new Date(dueYear, dueMonth, 0).getDate()
  const clampedDay = Math.min(dueDay, lastDay)

  const mm = String(dueMonth).padStart(2, '0')
  const dd = String(clampedDay).padStart(2, '0')
  return `${dueYear}-${mm}-${dd}`
}

/**
 * True when a transaction is a card credit/refund (estorno): an INCOME posted on a
 * CREDIT account. Such entries are never real cash income — they reduce card spending
 * and the invoice of their period. Use this to keep income/expense headlines honest.
 */
export function isCardCredit(tx: Transaction, accounts: Account[]): boolean {
  if (tx.type !== 'INCOME') return false
  const acc = accounts.find((a) => a.id === tx.accountId)
  return acc?.type === 'CREDIT'
}

/** Invoice period as a "YYYY-MM" key (matches Transaction.referenceMonth for CREDIT_PAYMENT). */
export function invoicePeriodKey(period: { year: number; month: number }): string {
  return `${period.year}-${String(period.month).padStart(2, '0')}`
}

/** Rounding tolerance for currency comparisons (half a cent). */
const INVOICE_EPSILON = 0.005

export type InvoiceStatus = 'open' | 'partial' | 'paid'

/**
 * The invoice period a CREDIT-account transaction is associated to (B-18).
 *
 * Authoritative source is the stored association `referenceMonth` ("YYYY-MM"),
 * set by sync from the card issuer (Organizze invoice) or by the user moving a
 * charge between invoices — real closing dates are fuzzy, so no date rule is
 * universally correct. When absent (Gimbo-native entries), fall back to the
 * computed default `getInvoicePeriod(tx.date, closingDay)`.
 *
 * Use this — not getInvoicePeriod directly — whenever assigning an existing
 * transaction to an invoice. getInvoicePeriod stays for "today → current
 * period" lookups, where there is no transaction to override.
 */
export function getTxInvoicePeriod(
  tx: Transaction,
  account: Account
): { year: number; month: number } {
  if (tx.referenceMonth) {
    const [year, month] = tx.referenceMonth.split('-').map(Number)
    if (year && month >= 1 && month <= 12) return { year, month }
  }
  return getInvoicePeriod(tx.date, account.creditMetadata?.closingDay ?? 1)
}

/**
 * Net statement total for a card's invoice period: charges (EXPENSE) minus
 * credits/refunds (INCOME on the same CREDIT account, e.g. estornos). This mirrors
 * the closed amount printed on the bank statement. Returns 0 without creditMetadata.
 */
export function getInvoiceTotal(
  transactions: Transaction[],
  account: Account,
  period: { year: number; month: number }
): number {
  if (!account.creditMetadata) return 0
  let total = 0
  for (const tx of transactions) {
    if (tx.accountId !== account.id) continue
    if (tx.type !== 'EXPENSE' && tx.type !== 'INCOME') continue
    const p = getTxInvoicePeriod(tx, account)
    if (p.year !== period.year || p.month !== period.month) continue
    total += tx.type === 'EXPENSE' ? tx.amount : -tx.amount
  }
  return total
}

/**
 * Sum of payments (CREDIT_PAYMENT) that explicitly reference the given invoice
 * period of the card (Option 2: payment ↔ period binding via referenceMonth).
 */
export function getInvoicePaid(
  transactions: Transaction[],
  account: Account,
  period: { year: number; month: number }
): number {
  const key = invoicePeriodKey(period)
  return transactions
    .filter(
      (tx) =>
        tx.type === 'CREDIT_PAYMENT' && tx.accountId === account.id && tx.referenceMonth === key
    )
    .reduce((sum, tx) => sum + tx.amount, 0)
}

/** Settlement status of an invoice given its net total and the amount already paid. */
export function getInvoiceStatus(total: number, paid: number): InvoiceStatus {
  if (total <= INVOICE_EPSILON && paid <= INVOICE_EPSILON) return 'open'
  if (total - paid <= INVOICE_EPSILON) return 'paid'
  if (paid > INVOICE_EPSILON) return 'partial'
  return 'open'
}

/**
 * Net statement total of the *current* invoice period (charges − credits).
 * Returns 0 without creditMetadata. Used for the "current invoice" figure.
 */
export function getCurrentInvoiceBalance(transactions: Transaction[], account: Account): number {
  if (!account.creditMetadata) return 0
  const currentPeriod = getInvoicePeriod(todayStr(), account.creditMetadata.closingDay)
  return getInvoiceTotal(transactions, account, currentPeriod)
}

/**
 * Open balance owed on a CREDIT account = the *current* invoice still unpaid:
 * current-period charges − credits − payments that reference the current period.
 * Basis for the available limit (limit − open balance) and net-worth liability.
 * Returns 0 without creditMetadata.
 *
 * Scoped to the current invoice on purpose. Past invoices are treated as settled
 * (robust against long histories where captured charges/payments don't reconcile),
 * and *future* periods are excluded (a snapshot synced with a far-future horizon
 * carries months of scheduled/recurring entries that are not committed debt). This
 * keeps the figure within the real credit limit and matching the card statement.
 * Trade-off: future installments of past purchases are not reflected here.
 */
export function getOpenCreditBalance(transactions: Transaction[], account: Account): number {
  if (!account.creditMetadata) return 0
  const currentPeriod = getInvoicePeriod(todayStr(), account.creditMetadata.closingDay)
  return (
    getInvoiceTotal(transactions, account, currentPeriod) -
    getInvoicePaid(transactions, account, currentPeriod)
  )
}

/**
 * Total liability of a CREDIT account for net-worth purposes = current invoice
 * still owed (open balance). See getOpenCreditBalance for the scoping rationale.
 */
export function getTotalCreditLiability(transactions: Transaction[], account: Account): number {
  return getOpenCreditBalance(transactions, account)
}

/**
 * Total liability of a LOAN account for net-worth purposes = outstandingBalance,
 * the user-maintained figure (no transaction replay — HE-06).
 */
export function getLoanLiability(account: Account): number {
  return account.loanMetadata?.outstandingBalance ?? 0
}

// ─── Financial Health — Debt Engine (HE-08) ──────────────────────────────────
//
// Distinct from getTotalCreditLiability (current-invoice scope only, used by
// /net-worth): this engine answers "how much have I committed in total", the
// F-29 insight that an installment purchase is real debt, not just this
// month's parcela. Each installment occurrence is already a materialized
// Transaction (one per month, see useDataStore's CC-24/CC-25 expansion) — open
// ones are those dated today or later; past occurrences are treated as settled.

interface OpenInstallmentGroup {
  description: string // purchase description, with the "(X/N)" suffix stripped (HE-10)
  currentIndex: number // 1-based installment index of the next-due occurrence (HE-10)
  total: number // total installments in the group, e.g. 10 for a 10x purchase (HE-10)
  monthly: number // amount of the next-due occurrence (approximates the group's fixed parcela)
  remainingTotal: number // sum of all still-open occurrences in the group
  remainingCount: number // number of still-open occurrences (≈ remaining months)
}

/** Groups open installment-purchase transactions on an account by parentId. Works for any
 * account type — credit cards and regular accounts alike (e.g. a financing booked one
 * parcela per month on a checking account). */
function _getOpenInstallmentGroups(
  transactions: Transaction[],
  accountId: string
): OpenInstallmentGroup[] {
  const today = parseDateLocal(todayStr())
  const openByParent = new Map<string, Transaction[]>()
  for (const tx of transactions) {
    if (tx.accountId !== accountId || tx.type !== 'EXPENSE' || !tx.installment) continue
    if (parseDateLocal(tx.date) < today) continue
    const group = openByParent.get(tx.installment.parentId) ?? []
    group.push(tx)
    openByParent.set(tx.installment.parentId, group)
  }

  return [...openByParent.values()].map((group) => {
    const sorted = [...group].sort(
      (a, b) => parseDateLocal(a.date).getTime() - parseDateLocal(b.date).getTime()
    )
    const next = sorted[0]
    return {
      description: next.description.replace(/\s*\(\d+\/\d+\)$/, ''),
      currentIndex: next.installment?.currentIndex ?? 1,
      total: next.installment?.total ?? sorted.length,
      monthly: next.amount,
      remainingTotal: sorted.reduce((s, tx) => s + tx.amount, 0),
      remainingCount: sorted.length,
    }
  })
}

/**
 * Total committed debt = open (today-or-future) installment purchases on any
 * non-LOAN account (credit cards and regular accounts alike — e.g. a financing
 * booked parcela by parcela) + outstandingBalance of LOAN accounts. Always
 * reconciles with the sum of its underlying items (installment groups + loans).
 */
export function getTotalCommittedDebt(transactions: Transaction[], accounts: Account[]): number {
  const installmentTotal = accounts
    .filter((a) => a.type !== 'LOAN')
    .reduce(
      (s, acc) =>
        s +
        _getOpenInstallmentGroups(transactions, acc.id).reduce((gs, g) => gs + g.remainingTotal, 0),
      0
    )
  const loanTotal = accounts
    .filter((a) => a.type === 'LOAN')
    .reduce((s, a) => s + getLoanLiability(a), 0)
  return installmentTotal + loanTotal
}

/**
 * Monthly commitment = the next-due occurrence of each open installment group on
 * any non-LOAN account + the monthlyPayment of each LOAN account.
 */
export function getMonthlyCommitment(transactions: Transaction[], accounts: Account[]): number {
  const installmentMonthly = accounts
    .filter((a) => a.type !== 'LOAN')
    .reduce(
      (s, acc) =>
        s + _getOpenInstallmentGroups(transactions, acc.id).reduce((gs, g) => gs + g.monthly, 0),
      0
    )
  const loanMonthly = accounts
    .filter((a) => a.type === 'LOAN')
    .reduce((s, a) => s + (a.loanMetadata?.monthlyPayment ?? 0), 0)
  return installmentMonthly + loanMonthly
}

/**
 * Debt horizon, in months — the longest-running open commitment across all
 * installment groups (any non-LOAN account) and LOAN accounts (drives the
 * "impacts your budget for N months" framing).
 */
export function getDebtHorizon(transactions: Transaction[], accounts: Account[]): number {
  const installmentHorizon = accounts
    .filter((a) => a.type !== 'LOAN')
    .reduce(
      (m, acc) =>
        Math.max(
          m,
          ..._getOpenInstallmentGroups(transactions, acc.id).map((g) => g.remainingCount)
        ),
      0
    )
  const loanHorizon = accounts
    .filter((a) => a.type === 'LOAN')
    .reduce((m, a) => Math.max(m, a.loanMetadata?.remainingInstallments ?? 0), 0)
  return Math.max(installmentHorizon, loanHorizon)
}

// ─── Financial Health — Debt Breakdown (HE-10) ───────────────────────────────
//
// Per-account, per-item detail behind the aggregates above — feeds the expandable
// debt list on /health. Every group's monthly/remainingTotal/longestHorizon is the
// sum/max of its own items, so it always reconciles with getTotalCommittedDebt /
// getMonthlyCommitment / getDebtHorizon computed over the same accounts.

export interface DebtInstallmentItem {
  kind: 'installment'
  description: string
  current: number // 1-based index of the next-due occurrence
  total: number // total installments in the purchase
  remaining: number // still-open occurrences
  monthly: number
  remainingTotal: number
}

export interface DebtLoanItem {
  kind: 'loan'
  description: string
  remaining: number // remainingInstallments
  monthly: number
  remainingTotal: number // outstandingBalance
  interestRate?: number
}

export type DebtItem = DebtInstallmentItem | DebtLoanItem

export interface DebtGroup {
  accountId: string
  accountName: string
  kind: 'card' | 'loan' | 'installments'
  issuerIcon?: string
  monthly: number
  remainingTotal: number
  longestHorizon: number
  items: DebtItem[]
}

/**
 * Per-account breakdown of open committed debt — installment groups on any non-LOAN
 * account (credit cards → kind 'card'; regular accounts → kind 'installments', e.g. a
 * financing booked parcela by parcela) + LOAN balances.
 */
export function getDebtBreakdown(transactions: Transaction[], accounts: Account[]): DebtGroup[] {
  const installmentGroups = accounts
    .filter((a) => a.type !== 'LOAN')
    .map((acc): DebtGroup => {
      const items: DebtInstallmentItem[] = _getOpenInstallmentGroups(transactions, acc.id).map(
        (g) => ({
          kind: 'installment',
          description: g.description,
          current: g.currentIndex,
          total: g.total,
          remaining: g.remainingCount,
          monthly: g.monthly,
          remainingTotal: g.remainingTotal,
        })
      )
      return {
        accountId: acc.id,
        accountName: acc.name,
        kind: acc.type === 'CREDIT' ? 'card' : 'installments',
        issuerIcon: acc.issuerIcon,
        monthly: items.reduce((s, i) => s + i.monthly, 0),
        remainingTotal: items.reduce((s, i) => s + i.remainingTotal, 0),
        longestHorizon: items.reduce((m, i) => Math.max(m, i.remaining), 0),
        items,
      }
    })
    .filter((g) => g.items.length > 0)

  const loanGroups = accounts
    .filter((a) => a.type === 'LOAN' && a.loanMetadata)
    .map((acc): DebtGroup => {
      const lm = acc.loanMetadata!
      const item: DebtLoanItem = {
        kind: 'loan',
        description: acc.name,
        remaining: lm.remainingInstallments,
        monthly: lm.monthlyPayment,
        remainingTotal: lm.outstandingBalance,
        interestRate: lm.interestRate,
      }
      return {
        accountId: acc.id,
        accountName: acc.name,
        kind: 'loan',
        issuerIcon: acc.issuerIcon,
        monthly: lm.monthlyPayment,
        remainingTotal: lm.outstandingBalance,
        longestHorizon: lm.remainingInstallments,
        items: [item],
      }
    })

  return [...installmentGroups, ...loanGroups]
}

/**
 * Total expenses of the current calendar month — same definition as the Dashboard's
 * "Despesas" stat: CREDIT charges land in their invoice due month (cash-flow-effective
 * date), card credits (estornos) net against expenses rather than counting as income,
 * CREDIT_PAYMENT is liability settlement (excluded), and accounts excluded from balance
 * are excluded too. Used as the denominator for "parcelas do mês ÷ despesas do mês" (F-29).
 */
export function getMonthlyExpenses(transactions: Transaction[], accounts: Account[]): number {
  const today = parseDateLocal(todayStr())
  const m = today.getMonth()
  const y = today.getFullYear()
  let expenses = 0
  for (const tx of transactions) {
    if (tx.type === 'CREDIT_PAYMENT') continue
    const account = accounts.find((a) => a.id === tx.accountId)
    if (!account) continue
    if (account.type !== 'CREDIT' && !account.includeInBalance) continue
    const effectiveDate = parseDateLocal(getEffectiveCashFlowDate(tx, accounts))
    if (effectiveDate.getMonth() !== m || effectiveDate.getFullYear() !== y) continue
    if (tx.type === 'INCOME') {
      if (isCardCredit(tx, accounts)) expenses -= tx.amount
    } else if (tx.type === 'EXPENSE') {
      expenses += tx.amount
    }
  }
  return expenses
}

// ─── Financial Health — Income Engine (HE-09, D1) ────────────────────────────
//
// Suggests the denominator of "peso no orçamento" (F-29) from history. This is
// only a suggestion — the user's own confirmed value always wins and must never
// be silently recalculated over (workspace.monthlyIncomeOverride, set via the
// page's pencil — HE-10). See plan/FINANCIAL_HEALTH.md §6 D1.

export interface MonthlyIncomeEstimate {
  /** null when there's no qualified income in the lookback window — caller should prompt manual entry. */
  value: number | null
  /** How many of the last 6 complete calendar months had qualified income. */
  confidenceMonths: number
  /** True when confidenceMonths is 1–2 (below the 3-month median floor) — label as an estimate to confirm. */
  isEstimate: boolean
}

function _monthKey(dateStr: string): string {
  const d = parseDateLocal(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Returns the `n` calendar month keys immediately preceding `monthKey`, most recent first. */
function _monthsBefore(monthKey: string, n: number): string[] {
  const [y, m] = monthKey.split('-').map(Number)
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1 - (i + 1), 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
}

function _median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * Derives a suggested monthly income from up to the last `windowMonths` complete
 * calendar months (default 6, user-configurable via workspace.incomeWindowMonths —
 * the current month is excluded either way, since its income hasn't fully landed yet).
 * "Qualified" income = INCOME transactions on non-CREDIT accounts (B-16
 * estornos are INCOME on a card and would inflate this otherwise; TRANSFER
 * transactions are a different type and are already excluded).
 *
 * - ≥ 3 months with data → median of those months (resists an atypical month,
 *   e.g. a 13º salário). This 3-month floor is independent of `windowMonths`.
 * - 1–2 months → the median of what's available (== the value itself for 1,
 *   or the average of the two for 2), labelled as an estimate.
 * - 0 months → no number; the caller should fall back to manual entry.
 */
export function deriveMonthlyIncome(
  transactions: Transaction[],
  accounts: Account[],
  windowMonths: IncomeWindowMonths = 6
): MonthlyIncomeEstimate {
  const creditAccountIds = new Set(accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id))
  const currentMonthKey = _monthKey(todayStr())

  const sumsByMonth = new Map<string, number>()
  for (const tx of transactions) {
    if (tx.type !== 'INCOME' || creditAccountIds.has(tx.accountId)) continue
    const key = _monthKey(tx.date)
    if (key >= currentMonthKey) continue
    sumsByMonth.set(key, (sumsByMonth.get(key) ?? 0) + tx.amount)
  }

  const monthlyValues = _monthsBefore(currentMonthKey, windowMonths)
    .filter((key) => sumsByMonth.has(key))
    .map((key) => sumsByMonth.get(key) as number)

  if (monthlyValues.length === 0) {
    return { value: null, confidenceMonths: 0, isEstimate: false }
  }

  return {
    value: _median(monthlyValues),
    confidenceMonths: monthlyValues.length,
    isEstimate: monthlyValues.length < 3,
  }
}

/**
 * Returns the date that should be used when plotting a transaction on the
 * cash-flow chart.
 *
 * - CREDIT charges/credits with a stored invoiceDueDate (from the source) → that date,
 *   verbatim — authoritative and immune to later closing/due-day edits (CC-33).
 * - Transactions on CREDIT accounts with creditMetadata → projected due date
 *   of their invoice (so the cash impact shows up in the correct future month).
 * - All other cases (non-CREDIT, CREDIT without metadata, CREDIT_PAYMENT) →
 *   the raw transaction date.
 *
 * Apply this function ONLY in the cash-flow chart (Analytics). Category
 * breakdowns must continue using tx.date directly (budget perspective).
 */
export function getEffectiveCashFlowDate(tx: Transaction, accounts: Account[]): string {
  if (tx.type === 'CREDIT_PAYMENT') return tx.date

  const account = accounts.find((a) => a.id === tx.accountId)
  if (!account || account.type !== 'CREDIT') return tx.date

  // CC-33: the invoice due date captured from the source wins — it pins historical invoices to
  // the date they really fell due, so changing the card's closing/due day never re-dates the past.
  if (tx.invoiceDueDate) return tx.invoiceDueDate
  if (!account.creditMetadata) return tx.date

  const period = getTxInvoicePeriod(tx, account)
  return getInvoiceDueDate(period, account.creditMetadata.dueDay, account.creditMetadata.closingDay)
}

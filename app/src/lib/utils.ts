import type { Account, Transaction } from '@/types'
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
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ─── Credit Card — Invoice Engine ─────────────────────────────────────────────

/**
 * Returns the invoice period (year/month) to which a transaction belongs.
 *
 * Rule: if the transaction day is strictly greater than `closingDay`, the
 * transaction falls into the *next* month's invoice; otherwise it belongs to
 * the current month's invoice.
 *
 * Edge case: a purchase in December after the closing day rolls into January
 * of the following year.
 */
export function getInvoicePeriod(
  txDate: string,
  closingDay: number
): { year: number; month: number } {
  const d = parseDateLocal(txDate)
  const day = d.getDate()
  const year = d.getFullYear()
  const month = d.getMonth() + 1 // 1-based

  if (day > closingDay) {
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
 * The due date falls in the month *following* the invoice period.  If
 * `dueDay` exceeds the number of days in that month, the last day of the
 * month is used instead (conservative approach — avoids February edge cases).
 */
export function getInvoiceDueDate(
  invoicePeriod: { year: number; month: number },
  dueDay: number
): string {
  // Due month = month after the invoice period
  let dueYear = invoicePeriod.year
  let dueMonth = invoicePeriod.month + 1
  if (dueMonth > 12) {
    dueMonth = 1
    dueYear += 1
  }

  // Last day of the due month: day 0 of the following month
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
  const { closingDay } = account.creditMetadata
  let total = 0
  for (const tx of transactions) {
    if (tx.accountId !== account.id) continue
    if (tx.type !== 'EXPENSE' && tx.type !== 'INCOME') continue
    const p = getInvoicePeriod(tx.date, closingDay)
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
 * Outstanding debt on a CREDIT account across all time: all charges minus all
 * credits/refunds minus all payments. This is the true amount owed and the basis
 * for the available limit (limit − outstanding). Future installments count, since
 * they commit the limit at purchase time (CREDIT_CARD.md §2.4).
 * Returns 0 without creditMetadata.
 */
export function getCreditOutstanding(transactions: Transaction[], account: Account): number {
  if (!account.creditMetadata) return 0
  let outstanding = 0
  for (const tx of transactions) {
    if (tx.accountId !== account.id) continue
    if (tx.type === 'EXPENSE') outstanding += tx.amount
    else if (tx.type === 'INCOME') outstanding -= tx.amount
    else if (tx.type === 'CREDIT_PAYMENT') outstanding -= tx.amount
  }
  return outstanding
}

/**
 * Total liability of a CREDIT account for net-worth purposes = outstanding debt.
 * Previously "fatura atual + futuras"; now payments are tracked, so the liability
 * is what is actually still owed (unpaid past/current/future net of payments).
 */
export function getTotalCreditLiability(transactions: Transaction[], account: Account): number {
  return getCreditOutstanding(transactions, account)
}

/**
 * Returns the date that should be used when plotting a transaction on the
 * cash-flow chart.
 *
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
  if (!account || account.type !== 'CREDIT' || !account.creditMetadata) return tx.date

  const { closingDay, dueDay } = account.creditMetadata
  const period = getInvoicePeriod(tx.date, closingDay)
  return getInvoiceDueDate(period, dueDay)
}

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
 * Sums all EXPENSE transactions for the given account that belong to the
 * *current* invoice period.  Returns 0 if the account has no creditMetadata.
 */
export function getCurrentInvoiceBalance(transactions: Transaction[], account: Account): number {
  if (!account.creditMetadata) return 0

  const { closingDay } = account.creditMetadata
  const today = new Date()
  const currentPeriod = getInvoicePeriod(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    closingDay
  )

  return transactions
    .filter(
      (tx) =>
        tx.accountId === account.id &&
        tx.type === 'EXPENSE' &&
        (() => {
          const p = getInvoicePeriod(tx.date, closingDay)
          return p.year === currentPeriod.year && p.month === currentPeriod.month
        })()
    )
    .reduce((sum, tx) => sum + tx.amount, 0)
}

/**
 * Sums all EXPENSE transactions for the given CREDIT account whose invoice
 * period is the *current* period or later (fatura em aberto + parcelas futuras).
 * Returns 0 if the account has no creditMetadata.
 *
 * Decision D2 (NET_WORTH.md §4): passivo = fatura atual + todas as faturas futuras.
 */
export function getTotalCreditLiability(transactions: Transaction[], account: Account): number {
  if (!account.creditMetadata) return 0

  const { closingDay } = account.creditMetadata
  const today = new Date()
  const currentPeriod = getInvoicePeriod(
    `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
    closingDay
  )

  return transactions
    .filter((tx) => {
      if (tx.accountId !== account.id || tx.type !== 'EXPENSE') return false
      const p = getInvoicePeriod(tx.date, closingDay)
      return (
        p.year > currentPeriod.year ||
        (p.year === currentPeriod.year && p.month >= currentPeriod.month)
      )
    })
    .reduce((sum, tx) => sum + tx.amount, 0)
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

import type { Account, Category, Transaction } from '@/types'
import { formatCurrency, parseDateLocal } from '@/lib/utils'

export interface InvoiceExportLabels {
  date: string
  description: string
  category: string
  installment: string
  amount: string
  payment: string
  total: string
}

export interface InvoiceExportInput {
  cardName: string
  periodLabel: string
  closingDate: string
  dueDate: string
  closingLabel: string
  dueLabel: string
  transactions: Transaction[]
  categories: Category[]
  accounts: Account[]
  labels: InvoiceExportLabels
  locale: string
}

interface ExportRow {
  date: string
  description: string
  category: string
  installment: string
  amount: number
}

// Same sign convention as the on-screen statement: charges positive, credits/refunds and
// payments negative.
function buildRows(input: InvoiceExportInput): ExportRow[] {
  return input.transactions.map((tx) => {
    const isPayment = tx.type === 'CREDIT_PAYMENT'
    const cat = input.categories.find((c) => c.id === tx.categoryId)
    const description = isPayment
      ? input.labels.payment
      : // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
        tx.description || cat?.name || '—'
    return {
      date: tx.date,
      description,
      category: isPayment ? '' : (cat?.name ?? ''),
      installment: tx.installment ? `${tx.installment.currentIndex}/${tx.installment.total}` : '',
      amount: tx.type === 'EXPENSE' ? tx.amount : -tx.amount,
    }
  })
}

function sumRows(rows: ExportRow[]): number {
  return rows.reduce((s, r) => s + r.amount, 0)
}

function csvCell(value: string, isText = false): string {
  // Neutralize spreadsheet formula injection from user-typed text (never from numbers).
  const safe = isText && /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\n\r;]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** CSV (UTF-8, `,`-separated, ISO dates, plain decimal amounts) of the displayed lines. */
export function buildInvoiceCsv(input: InvoiceExportInput): string {
  const rows = buildRows(input)
  const l = input.labels
  const lines = [[l.date, l.description, l.category, l.installment, l.amount]]
  for (const r of rows) {
    lines.push([r.date, r.description, r.category, r.installment, r.amount.toFixed(2)])
  }
  lines.push(['', l.total, '', '', sumRows(rows).toFixed(2)])
  // Column 4 (amount) is numeric; everything else may carry user-typed text.
  return lines.map((cols) => cols.map((c, i) => csvCell(c, i !== 4)).join(',')).join('\r\n')
}

export function invoiceExportFilename(input: InvoiceExportInput, ext: 'csv' | 'pdf'): string {
  const slug = `${input.cardName}-${input.periodLabel}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return `fatura-${slug}.${ext}`
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadInvoiceCsv(input: InvoiceExportInput) {
  // BOM so Excel opens accented text as UTF-8.
  const blob = new Blob(['﻿' + buildInvoiceCsv(input)], { type: 'text/csv;charset=utf-8' })
  download(blob, invoiceExportFilename(input, 'csv'))
}

export async function downloadInvoicePdf(input: InvoiceExportInput) {
  // Lazy: jsPDF is only needed when the user actually exports.
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const rows = buildRows(input)
  const l = input.labels
  const pageW = doc.internal.pageSize.getWidth()
  const pageH = doc.internal.pageSize.getHeight()
  const margin = 40
  const right = pageW - margin
  const fmtDate = (d: string) =>
    parseDateLocal(d).toLocaleDateString(input.locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })

  let y = margin
  doc.setFont('helvetica', 'bold').setFontSize(16)
  doc.text(`${input.cardName} — ${input.periodLabel}`, margin, y)
  y += 18
  doc.setFont('helvetica', 'normal').setFontSize(10)
  doc.text(
    `${input.closingLabel}: ${fmtDate(input.closingDate)}    ${input.dueLabel}: ${fmtDate(input.dueDate)}`,
    margin,
    y
  )
  y += 24

  const colDate = margin
  const colDesc = margin + 70
  const colCat = margin + 270
  const colInst = margin + 390
  const header = () => {
    doc.setFont('helvetica', 'bold').setFontSize(9)
    doc.text(l.date, colDate, y)
    doc.text(l.description, colDesc, y)
    doc.text(l.category, colCat, y)
    doc.text(l.installment, colInst, y)
    doc.text(l.amount, right, y, { align: 'right' })
    y += 6
    doc.line(margin, y, right, y)
    y += 12
    doc.setFont('helvetica', 'normal')
  }
  const clip = (s: string, w: number) => {
    const lines = doc.splitTextToSize(s, w) as string[]
    return lines.length > 1 ? `${lines[0].slice(0, -1)}…` : (lines[0] ?? '')
  }

  header()
  for (const r of rows) {
    if (y > pageH - margin) {
      doc.addPage()
      y = margin
      header()
    }
    doc.text(fmtDate(r.date), colDate, y)
    doc.text(clip(r.description, 190), colDesc, y)
    doc.text(clip(r.category, 110), colCat, y)
    doc.text(r.installment, colInst, y)
    doc.text(formatCurrency(r.amount, undefined, input.locale), right, y, { align: 'right' })
    y += 16
  }

  if (y > pageH - margin - 20) {
    doc.addPage()
    y = margin
  }
  doc.line(margin, y - 8, right, y - 8)
  doc.setFont('helvetica', 'bold')
  doc.text(l.total, colDesc, y + 6)
  doc.text(formatCurrency(sumRows(rows), undefined, input.locale), right, y + 6, {
    align: 'right',
  })

  download(doc.output('blob'), invoiceExportFilename(input, 'pdf'))
}

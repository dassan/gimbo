import { describe, expect, it } from 'vitest'
import { buildInvoiceCsv, invoiceExportFilename } from '@/lib/invoiceExport'
import type { InvoiceExportInput } from '@/lib/invoiceExport'
import type { Transaction } from '@/types'

function tx(p: Partial<Transaction>): Transaction {
  return {
    id: 'x',
    accountId: 'a',
    type: 'EXPENSE',
    amount: 10,
    date: '2026-09-05',
    description: 'Compra',
    ...p,
  } as Transaction
}

function input(transactions: Transaction[]): InvoiceExportInput {
  return {
    cardName: 'Nubank Roxo',
    periodLabel: 'Setembro 2026',
    closingDate: '2026-09-10',
    dueDate: '2026-09-17',
    closingLabel: 'Fechamento',
    dueLabel: 'Vencimento',
    transactions,
    categories: [{ id: 'c', name: 'Mercado' } as never],
    accounts: [],
    locale: 'pt-BR',
    labels: {
      date: 'Data',
      description: 'Descrição',
      category: 'Categoria',
      installment: 'Parcela',
      amount: 'Valor',
      payment: 'Pagamento',
      total: 'Total',
    },
  }
}

describe('invoiceExport', () => {
  it('gera CSV com sinais da fatura, parcela e total', () => {
    const csv = buildInvoiceCsv(
      input([
        tx({ amount: 100, categoryId: 'c', installment: { currentIndex: 2, total: 3 } as never }),
        tx({ type: 'INCOME', amount: 30, description: 'Estorno' }),
        tx({ type: 'CREDIT_PAYMENT', amount: 20, description: '' }),
      ])
    )
    expect(csv.split('\r\n')).toEqual([
      'Data,Descrição,Categoria,Parcela,Valor',
      '2026-09-05,Compra,Mercado,2/3,100.00',
      '2026-09-05,Estorno,,,-30.00',
      '2026-09-05,Pagamento,,,-20.00',
      ',Total,,,50.00',
    ])
  })

  it('escapa aspas/vírgulas e neutraliza fórmulas', () => {
    const csv = buildInvoiceCsv(
      input([tx({ description: 'A, "B"' }), tx({ description: '=HYPERLINK("x")' })])
    )
    expect(csv).toContain('"A, ""B"""')
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`)
  })

  it('monta nome de arquivo sem acentos', () => {
    expect(invoiceExportFilename(input([]), 'pdf')).toBe('fatura-nubank-roxo-setembro-2026.pdf')
  })
})

import type { Transaction, Installment, Recurrence } from '@/types'

export interface TransactionDelta {
  upserts: Transaction[]
  deletedIds: string[]
}

function sameStringSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every((x) => s.has(x))
}

function installmentEqual(a: Installment | undefined, b: Installment | undefined): boolean {
  if (!a || !b) return a === b
  return (
    a.parentId === b.parentId &&
    a.currentIndex === b.currentIndex &&
    a.total === b.total &&
    a.purchaseDate === b.purchaseDate
  )
}

function recurrenceEqual(a: Recurrence | undefined, b: Recurrence | undefined): boolean {
  if (!a || !b) return a === b
  return a.frequency === b.frequency && a.parentId === b.parentId && a.endDate === b.endDate
}

/**
 * Comparação campo a campo (não JSON.stringify genérico) porque tags/budgetIds são conjuntos
 * semânticos, não arrays ordenados — reordenar não pode contar como mudança. Lista de campos
 * enumerada à mão: se Transaction ganhar um campo novo e esta função não for atualizada, a
 * detecção falha silenciosamente — coberto por um teste-guarda em transactionDiff.test.ts.
 */
function transactionsEqual(a: Transaction, b: Transaction): boolean {
  return (
    a.accountId === b.accountId &&
    a.categoryId === b.categoryId &&
    a.amount === b.amount &&
    a.type === b.type &&
    a.description === b.description &&
    a.date === b.date &&
    a.isPaid === b.isPaid &&
    a.transferAccountId === b.transferAccountId &&
    a.referenceMonth === b.referenceMonth &&
    a.invoiceDueDate === b.invoiceDueDate &&
    a.updatedAt === b.updatedAt &&
    a.createdAt === b.createdAt &&
    sameStringSet(a.tags, b.tags) &&
    sameStringSet(a.budgetIds ?? [], b.budgetIds ?? []) &&
    installmentEqual(a.installment, b.installment) &&
    recurrenceEqual(a.recurrence, b.recurrence)
  )
}

/**
 * M-73/PERFORMANCE.md: substitui o replaceAll() por mutação (que reescrevia as ~25 mil
 * transações inteiras a cada edição) por um diff — só as linhas realmente adicionadas,
 * alteradas ou removidas viram INSERT/DELETE no worker.
 */
export function diffTransactions(before: Transaction[], after: Transaction[]): TransactionDelta {
  const beforeById = new Map(before.map((t) => [t.id, t]))
  const afterIds = new Set<string>()
  const upserts: Transaction[] = []

  for (const tx of after) {
    afterIds.add(tx.id)
    const prev = beforeById.get(tx.id)
    if (!prev || !transactionsEqual(prev, tx)) upserts.push(tx)
  }

  const deletedIds = before.filter((t) => !afterIds.has(t.id)).map((t) => t.id)
  return { upserts, deletedIds }
}

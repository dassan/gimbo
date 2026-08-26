// CS-30/CS-31 (Fase 2) — hashing síncrono e barato para a tabela de controle `table_hashes`
// (migrations/v16.sql). Não usa `crypto.subtle`: é assíncrono, e chamá-lo por linha num loop de
// milhares de linhas reintroduziria o mesmo tipo de overhead-por-chamada que o M-72 já corrigiu
// para `GROUP_CONCAT` neste ambiente (wa-sqlite/WASM sobre a VFS assíncrona do OPFS). FNV-1a é
// determinístico, rápido e síncrono — resistência a colisão não é o objetivo aqui, é
// content-addressing pra decidir se vale a pena ler/mesclar/reescrever uma partição.

import type {
  RawAccount,
  RawCategory,
  RawTag,
  RawTransaction,
  RawBudget,
  RawValuation,
  RawSavedPeriod,
  RawAuditEntry,
} from '@/services/storage/worker'

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** FNV-1a, 32 bits. */
export function hashRow(canonicalString: string): number {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < canonicalString.length; i++) {
    hash ^= canonicalString.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/**
 * Combina hashes de linha num hash de partição via XOR-fold — comutativo e associativo, então a
 * ordem em que as linhas são visitadas nunca importa (writeSmallTables/applyTransactionDelta/
 * replaceAll tocam linhas em ordens diferentes), e a manutenção pode ser incremental: remover ou
 * adicionar uma linha é só um XOR do hash antigo/novo, sem reler a partição inteira.
 */
export function combineHashes(hashes: Iterable<number>): number {
  let acc = 0
  for (const h of hashes) acc ^= h
  return acc
}

// Separador de controle — nunca aparece em texto digitado pelo usuário, evita colisão do tipo
// ('ab','c') vs ('a','bc') que um join(',') simples entre campos sofreria.
const SEP = ''

export function accountRowKey(a: RawAccount): string {
  return [
    a.id,
    a.name,
    a.type,
    a.balance,
    a.includeInBalance ? 1 : 0,
    a.creditMetadata?.limit ?? '',
    a.creditMetadata?.closingDay ?? '',
    a.creditMetadata?.dueDay ?? '',
    a.loanMetadata?.outstandingBalance ?? '',
    a.loanMetadata?.monthlyPayment ?? '',
    a.loanMetadata?.remainingInstallments ?? '',
    a.loanMetadata?.interestRate ?? '',
    a.reserveMetadata ? 1 : 0,
    a.issuerIcon ?? '',
    a.archived ? 1 : 0,
    a.updatedAt ?? '',
  ].join(SEP)
}

export function categoryRowKey(c: RawCategory): string {
  return [c.id, c.parentId ?? '', c.name, c.icon, c.color, c.type, c.updatedAt ?? ''].join(SEP)
}

export function tagRowKey(t: RawTag): string {
  return [t.id, t.name, t.color, t.updatedAt ?? ''].join(SEP)
}

export function budgetRowKey(b: RawBudget): string {
  return [
    b.id,
    b.name,
    b.emoji,
    b.color,
    b.kind,
    b.target,
    b.period.mode,
    b.period.mode === 'date' ? b.period.date : '',
    b.period.mode === 'range' ? b.period.start : '',
    b.period.mode === 'range' ? b.period.end : '',
    b.archivedAt ?? '',
    b.recipeSlug ?? '',
    b.recipeSlot ?? '',
    b.updatedAt ?? '',
    b.createdAt ?? '',
    b.targetSource ?? '',
  ].join(SEP)
}

export function valuationRowKey(v: RawValuation): string {
  return [v.id, v.accountId, v.date, v.marketValue].join(SEP)
}

export function savedPeriodRowKey(p: RawSavedPeriod): string {
  return [p.id, p.name, p.start, p.end].join(SEP)
}

export function auditEntryRowKey(e: RawAuditEntry): string {
  return [e.id, e.timestamp, e.action, e.entity, e.entityId, e.summary].join(SEP)
}

export function deletedIdRowKey(id: string): string {
  return id
}

/**
 * Espelha a lista de campos de transactionsEqual() em transactionDiff.ts — mesmos campos, mesmo
 * cuidado (tags/budgetIds são conjuntos, não arrays ordenados — ordenar antes de juntar evita que
 * reordenar mude o hash). Manter as duas listas em sincronia importa: um campo novo que entre
 * numa mas não na outra quebra silenciosamente ou a detecção de mudança (diffTransactions) ou a
 * precisão do hash de partição (esta função) — ver o teste-guarda compartilhado em
 * rowHash.test.ts.
 */
export function transactionRowKey(t: RawTransaction): string {
  return [
    t.id,
    t.accountId,
    t.categoryId,
    t.amount,
    t.type,
    t.description,
    t.date,
    t.isPaid ? 1 : 0,
    [...t.tags].sort().join(','),
    [...(t.budgetIds ?? [])].sort().join(','),
    t.installment?.parentId ?? '',
    t.installment?.currentIndex ?? '',
    t.installment?.total ?? '',
    t.installment?.purchaseDate ?? '',
    t.recurrence?.frequency ?? '',
    t.recurrence?.parentId ?? '',
    t.recurrence?.endDate ?? '',
    t.transferAccountId ?? '',
    t.referenceMonth ?? '',
    t.invoiceDueDate ?? '',
    t.updatedAt ?? '',
    t.createdAt ?? '',
  ].join(SEP)
}

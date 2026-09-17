import { parseDateLocal } from '@/lib/utils'
import type { Transaction } from '@/types'

// M-105: motor de busca global — texto contra a descrição do lançamento, acento-sensível mas
// case/trim-insensível (mesmo nível do `normalize()` do CategorySelect/M-103; nenhum outro ponto
// do app faz accent-folding de verdade). Escopo v1 = só INCOME/EXPENSE: TRANSFER/CREDIT_PAYMENT
// são movimentação entre contas próprias, não "compras" no sentido em que a feature foi pensada
// ("quanto pagamos na compra da TV"), e o front-end (já aprovado à parte) não tem tratamento
// visual pra essas linhas ainda — limitação documentada no BACKLOG (M-105), não descartada em
// silêncio. Filtro de período usa `parseDateLocal` (nunca `new Date(tx.date)`, regra do
// CLAUDE.md) sobre `tx.date` bruto — mesma base que categorias usam (CC-16: só o gráfico de
// fluxo de caixa usa `getEffectiveCashFlowDate`, não uma busca por descrição).

// Perf (relatado pelo usuário em 2026-09-17): uma busca ampla contra um cofre real (~26,5 mil
// transações) casa dezenas de milhares de linhas — medido, "Compra" batia em 21.200 delas.
// Renderizar todas girava a UI em ~26s (`formatCurrency`/`toLocaleDateString` chamados uma vez
// por linha, cada um instanciando um `Intl.*` novo — o custo por chamada é pequeno, mas somado
// em dezenas de milhares de linhas gira a UI inteira). Não é só perf: uma lista de 21 mil linhas
// não é útil numa busca rápida de qualquer forma. `searchTransactions` continua devolvendo o
// conjunto completo (o "Total" agregado tem que somar tudo que bateu, não só o que aparece) — o
// corte é responsabilidade de quem renderiza.
export const GLOBAL_SEARCH_RESULT_LIMIT = 50

export type GlobalSearchPeriod = 'all' | 'thisYear' | 'lastYear' | 'custom'

export interface GlobalSearchFilters {
  query: string
  period: GlobalSearchPeriod
  customStart?: string
  customEnd?: string
}

export function searchTransactions(
  transactions: Transaction[],
  filters: GlobalSearchFilters
): Transaction[] {
  const q = filters.query.trim().toLowerCase()
  if (!q) return []

  let results = transactions.filter(
    (tx) =>
      (tx.type === 'INCOME' || tx.type === 'EXPENSE') && tx.description.toLowerCase().includes(q)
  )

  if (filters.period === 'thisYear' || filters.period === 'lastYear') {
    const year = new Date().getFullYear() - (filters.period === 'lastYear' ? 1 : 0)
    results = results.filter((tx) => parseDateLocal(tx.date).getFullYear() === year)
  } else if (filters.period === 'custom' && filters.customStart && filters.customEnd) {
    const start = parseDateLocal(filters.customStart)
    const end = parseDateLocal(filters.customEnd)
    results = results.filter((tx) => {
      const d = parseDateLocal(tx.date)
      return d >= start && d <= end
    })
  }

  return results.sort((a, b) => parseDateLocal(b.date).getTime() - parseDateLocal(a.date).getTime())
}

// Total líquido dos resultados — INCOME soma, EXPENSE subtrai (`Transaction.amount` é sempre
// positivo; o sinal vem de `type`, mesma convenção de todo cálculo de saldo do app).
export function sumSignedAmount(transactions: Transaction[]): number {
  return transactions.reduce((sum, tx) => sum + (tx.type === 'INCOME' ? tx.amount : -tx.amount), 0)
}

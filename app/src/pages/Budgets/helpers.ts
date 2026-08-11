// Lógica de apresentação das caixinhas (cores, período, ordenação da lista).
// Derivações de dado (progresso, status) vivem em lib/utils.ts desde a BX-05 —
// aqui fica só o que é puramente de UI.
import { parseDateLocal, budgetProgress, type BudgetStatus } from '@/lib/utils'
import type { Budget, BudgetPeriod, BudgetSortBy, Transaction } from '@/types'

export const GAUGE_GREEN = '#2D6A4F'
export const GAUGE_AMBER = '#D4A017'
export const GAUGE_RED = '#C0392B'

export const STATUS_COLOR: Record<BudgetStatus, string> = {
  onTrack: GAUGE_GREEN,
  reached: GAUGE_GREEN,
  warning: GAUGE_AMBER,
  exceeded: GAUGE_RED,
}

const SHORT_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' }

export function formatBudgetPeriod(period: BudgetPeriod, locale: string): string {
  if (period.mode === 'date') {
    return parseDateLocal(period.date).toLocaleDateString(locale, {
      ...SHORT_DATE,
      year: 'numeric',
    })
  }
  const start = parseDateLocal(period.start).toLocaleDateString(locale, SHORT_DATE)
  const end = parseDateLocal(period.end).toLocaleDateString(locale, {
    ...SHORT_DATE,
    year: 'numeric',
  })
  return `${start} – ${end}`
}

/** Dias restantes até o fim do período (negativo = já encerrado). */
export function daysRemaining(period: BudgetPeriod, today = new Date()): number {
  const target = parseDateLocal(period.mode === 'date' ? period.date : period.end)
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  return Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000)
}

/**
 * Ordenação configurável da lista (U-3). 'deadline' = prazo mais próximo primeiro
 * (inclusive os já encerrados, que ficam no topo); 'progress' = % decrescente;
 * 'name' = alfabética; 'createdAt' = criação mais recente primeiro (default).
 */
export function sortBudgets(
  budgets: Budget[],
  transactions: Transaction[],
  sortBy: BudgetSortBy
): Budget[] {
  const sorted = [...budgets]
  switch (sortBy) {
    case 'deadline':
      return sorted.sort((a, b) => daysRemaining(a.period) - daysRemaining(b.period))
    case 'progress':
      return sorted.sort(
        (a, b) => budgetProgress(b, transactions) - budgetProgress(a, transactions)
      )
    case 'name':
      return sorted.sort((a, b) => a.name.localeCompare(b.name))
    case 'createdAt':
    default:
      return sorted.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  }
}

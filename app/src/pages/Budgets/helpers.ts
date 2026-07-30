// Lógica de apresentação das caixinhas (cores, status, período).
// Protótipo de UI — ver nota em `mock.ts`.
import { parseDateLocal } from '@/lib/utils'
import { budgetProgress, type BudgetPeriod, type MockBudget } from './mock'

export const GAUGE_GREEN = '#2D6A4F'
export const GAUGE_AMBER = '#D4A017'
export const GAUGE_RED = '#C0392B'

export type BudgetStatus = 'onTrack' | 'warning' | 'exceeded' | 'reached'

/**
 * Despesa: quanto mais perto da meta, mais tenso — passar dela é estouro.
 * Receita: a meta é um piso, então só existe "em andamento" e "atingida".
 */
export function getBudgetStatus(budget: MockBudget): BudgetStatus {
  const p = budgetProgress(budget)
  if (budget.kind === 'income') return p >= 1 ? 'reached' : 'warning'
  if (p > 1) return 'exceeded'
  if (p >= 0.8) return 'warning'
  return 'onTrack'
}

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

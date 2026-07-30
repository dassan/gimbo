// ─── Caixinhas (budgets) — dados MOCKADOS ────────────────────────────────────
// Protótipo de UI: nada aqui toca o store, o SQLite ou o DataFile. Todo este
// arquivo será substituído pelas entidades reais quando a feature for aprovada.

export type BudgetKind = 'expense' | 'income'

/** Período: uma data-alvo única ("até 20/12") ou um intervalo fechado. */
export type BudgetPeriod =
  | { mode: 'date'; date: string }
  | { mode: 'range'; start: string; end: string }

export interface MockBudgetTx {
  id: string
  date: string
  description: string
  categoryName: string
  categoryColor: string
  accountName: string
  amount: number
}

export interface MockBudget {
  id: string
  name: string
  /** Emoji usado como avatar do card — placeholder para um seletor de ícone real. */
  emoji: string
  color: string
  kind: BudgetKind
  target: number
  period: BudgetPeriod
  transactions: MockBudgetTx[]
}

export const MOCK_BUDGETS: MockBudget[] = [
  {
    id: 'bx-viagem',
    name: 'Viagem para Portugal',
    emoji: '✈️',
    color: '#1B4F72',
    kind: 'expense',
    target: 18000,
    period: { mode: 'range', start: '2026-08-01', end: '2026-12-20' },
    transactions: [
      {
        id: 'bx-viagem-1',
        date: '2026-07-28',
        description: 'Passagens TAP — 2 adultos',
        categoryName: 'Viagem',
        categoryColor: '#1B4F72',
        accountName: 'Nubank',
        amount: 7420.9,
      },
      {
        id: 'bx-viagem-2',
        date: '2026-07-19',
        description: 'Reserva hotel Lisboa (sinal)',
        categoryName: 'Hospedagem',
        categoryColor: '#2D6A4F',
        accountName: 'Itaú',
        amount: 1890,
      },
      {
        id: 'bx-viagem-3',
        date: '2026-07-11',
        description: 'Seguro viagem anual',
        categoryName: 'Serviços',
        categoryColor: '#6B7280',
        accountName: 'Nubank',
        amount: 612.4,
      },
      {
        id: 'bx-viagem-4',
        date: '2026-07-02',
        description: 'Renovação de passaporte',
        categoryName: 'Documentos',
        categoryColor: '#92400E',
        accountName: 'Conta corrente',
        amount: 257.25,
      },
    ],
  },
  {
    id: 'bx-reforma',
    name: 'Reforma da cozinha',
    emoji: '🔨',
    color: '#92400E',
    kind: 'expense',
    target: 9000,
    period: { mode: 'range', start: '2026-06-01', end: '2026-09-30' },
    transactions: [
      {
        id: 'bx-reforma-1',
        date: '2026-07-24',
        description: 'Bancada de granito',
        categoryName: 'Casa',
        categoryColor: '#92400E',
        accountName: 'Cartão Inter',
        amount: 4300,
      },
      {
        id: 'bx-reforma-2',
        date: '2026-07-06',
        description: 'Mão de obra — 1ª parcela',
        categoryName: 'Serviços',
        categoryColor: '#6B7280',
        accountName: 'Conta corrente',
        amount: 2500,
      },
      {
        id: 'bx-reforma-3',
        date: '2026-06-21',
        description: 'Tintas e material',
        categoryName: 'Casa',
        categoryColor: '#92400E',
        accountName: 'Nubank',
        amount: 1180.6,
      },
    ],
  },
  {
    id: 'bx-natal',
    name: 'Presentes de Natal',
    emoji: '🎁',
    color: '#C0392B',
    kind: 'expense',
    target: 2500,
    period: { mode: 'date', date: '2026-12-24' },
    transactions: [
      {
        id: 'bx-natal-1',
        date: '2026-07-15',
        description: 'Fone bluetooth (antecipado)',
        categoryName: 'Presentes',
        categoryColor: '#C0392B',
        accountName: 'Cartão Inter',
        amount: 389.9,
      },
    ],
  },
  {
    id: 'bx-freela',
    name: 'Renda extra de freelas',
    emoji: '💼',
    color: '#2D6A4F',
    kind: 'income',
    target: 12000,
    period: { mode: 'range', start: '2026-01-01', end: '2026-12-31' },
    transactions: [
      {
        id: 'bx-freela-1',
        date: '2026-07-25',
        description: 'Consultoria — Acme Ltda',
        categoryName: 'Freelance',
        categoryColor: '#2D6A4F',
        accountName: 'Conta corrente',
        amount: 4800,
      },
      {
        id: 'bx-freela-2',
        date: '2026-05-30',
        description: 'Projeto landing page',
        categoryName: 'Freelance',
        categoryColor: '#2D6A4F',
        accountName: 'Conta corrente',
        amount: 3200,
      },
      {
        id: 'bx-freela-3',
        date: '2026-03-14',
        description: 'Mentoria avulsa',
        categoryName: 'Freelance',
        categoryColor: '#2D6A4F',
        accountName: 'Nubank',
        amount: 950,
      },
    ],
  },
  {
    id: 'bx-carro',
    name: 'Manutenção do carro',
    emoji: '🚗',
    color: '#1F3A5F',
    kind: 'expense',
    target: 3000,
    period: { mode: 'range', start: '2026-01-01', end: '2026-12-31' },
    transactions: [
      {
        id: 'bx-carro-1',
        date: '2026-07-09',
        description: 'Revisão 40.000 km',
        categoryName: 'Automóvel',
        categoryColor: '#1F3A5F',
        accountName: 'Cartão Inter',
        amount: 1840,
      },
      {
        id: 'bx-carro-2',
        date: '2026-04-18',
        description: 'Troca de pneus dianteiros',
        categoryName: 'Automóvel',
        categoryColor: '#1F3A5F',
        accountName: 'Nubank',
        amount: 1560,
      },
    ],
  },
  {
    id: 'bx-bonus',
    name: 'Bônus anual',
    emoji: '🎯',
    color: '#2D6A4F',
    kind: 'income',
    target: 5000,
    period: { mode: 'date', date: '2026-03-31' },
    transactions: [
      {
        id: 'bx-bonus-1',
        date: '2026-03-20',
        description: 'PLR 2025',
        categoryName: 'Bonificação',
        categoryColor: '#2D6A4F',
        accountName: 'Conta corrente',
        amount: 5240.75,
      },
    ],
  },
]

/** Soma dos lançamentos associados — o "valor atual" da caixinha. */
export function budgetCurrent(budget: MockBudget): number {
  return budget.transactions.reduce((sum, tx) => sum + tx.amount, 0)
}

/**
 * Diferença entre atual e meta, já orientada pelo tipo: positivo = folga
 * (sobrou orçamento numa caixinha de despesa, ou superou a meta numa de receita).
 */
export function budgetDelta(budget: MockBudget): number {
  const current = budgetCurrent(budget)
  return budget.kind === 'expense' ? budget.target - current : current - budget.target
}

export function budgetProgress(budget: MockBudget): number {
  if (budget.target <= 0) return 0
  return budgetCurrent(budget) / budget.target
}

export function findMockBudget(id: string | undefined): MockBudget | undefined {
  return MOCK_BUDGETS.find((b) => b.id === id)
}

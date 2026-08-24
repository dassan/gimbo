import { describe, it, expect } from 'vitest'
import {
  applyQuadrantesRecipe,
  refreshQuadrantesSuggestions,
  findQuadranteForDate,
  quadranteRanges,
  QUADRANTE_COLOR,
  QUADRANTE_SLUG,
} from '@/lib/budgetRecipes'
import type { Budget, Transaction } from '@/types'

function makeExpense(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-07-05',
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

function makeQuadrante(overrides: Partial<Budget> = {}): Budget {
  return {
    id: 'q-1',
    name: 'Quadrante 1',
    emoji: '1️⃣',
    color: QUADRANTE_COLOR,
    kind: 'expense',
    target: 500,
    period: { mode: 'range', start: '2026-06-01', end: '2026-06-08' },
    recipeSlug: QUADRANTE_SLUG,
    recipeSlot: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('quadranteRanges', () => {
  it('splits a 31-day month into the 4 fixed day ranges', () => {
    expect(quadranteRanges(2026, 8)).toEqual([
      ['2026-08-01', '2026-08-08'],
      ['2026-08-09', '2026-08-16'],
      ['2026-08-17', '2026-08-24'],
      ['2026-08-25', '2026-08-31'],
    ])
  })

  it('clamps the 4th range to the actual last day of a 28-day February', () => {
    expect(quadranteRanges(2026, 2)[3]).toEqual(['2026-02-25', '2026-02-28'])
  })

  it('clamps the 4th range to 30 for a 30-day month', () => {
    expect(quadranteRanges(2026, 4)[3]).toEqual(['2026-04-25', '2026-04-30'])
  })
})

describe('applyQuadrantesRecipe — geração (BX-07)', () => {
  it('generates 4 budgets on first activation, target 0, correct emoji/color/slot', () => {
    const budgets: Budget[] = []
    const { changed } = applyQuadrantesRecipe(
      budgets,
      [],
      false,
      '2026-08-05',
      '2026-08-05T10:00:00.000Z'
    )

    expect(changed).toBe(true)
    expect(budgets).toHaveLength(4)
    for (let slot = 1; slot <= 4; slot++) {
      const b = budgets.find((x) => x.recipeSlot === slot)
      expect(b).toBeDefined()
      expect(b!.name).toBe(`Quadrante ${slot}`)
      expect(b!.color).toBe(QUADRANTE_COLOR)
      expect(b!.kind).toBe('expense')
      expect(b!.target).toBe(0)
      expect(b!.targetSource).toBe('auto') // BX-12 revisão: geração de verdade nunca é 'manual'
      expect(b!.recipeSlug).toBe(QUADRANTE_SLUG)
      expect(b!.archivedAt).toBeUndefined()
    }
    expect(budgets.find((b) => b.recipeSlot === 4)?.period).toEqual({
      mode: 'range',
      start: '2026-08-25',
      end: '2026-08-31',
    })
  })

  it('is idempotent — a second call in the same month is a no-op', () => {
    const budgets: Budget[] = []
    applyQuadrantesRecipe(budgets, [], false, '2026-08-05', '2026-08-05T10:00:00.000Z')
    const { changed } = applyQuadrantesRecipe(
      budgets,
      [],
      false,
      '2026-08-20',
      '2026-08-20T10:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(budgets).toHaveLength(4)
  })

  it('inherits target from the last instance of each slot on month rollover', () => {
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jul-1',
        recipeSlot: 1,
        target: 800,
        period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      }),
      makeQuadrante({
        id: 'q-jul-2',
        recipeSlot: 2,
        target: 300,
        period: { mode: 'range', start: '2026-07-09', end: '2026-07-16' },
      }),
    ]
    const { changed } = applyQuadrantesRecipe(
      budgets,
      [],
      false,
      '2026-08-05',
      '2026-08-05T10:00:00.000Z'
    )

    expect(changed).toBe(true)
    const augBudgets = budgets.filter(
      (b) => b.period.mode === 'range' && b.period.start.startsWith('2026-08')
    )
    expect(augBudgets.find((b) => b.recipeSlot === 1)?.target).toBe(800)
    expect(augBudgets.find((b) => b.recipeSlot === 2)?.target).toBe(300)
    // Slots without a prior instance fall back to 0.
    expect(augBudgets.find((b) => b.recipeSlot === 3)?.target).toBe(0)
  })

  it('carries targetSource forward from the last instance (BX-12 revisão) — legacy data without the field defaults to manual', () => {
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jul-1',
        recipeSlot: 1,
        target: 800,
        targetSource: 'manual',
        period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      }),
      makeQuadrante({
        id: 'q-jul-2',
        recipeSlot: 2,
        target: 300,
        targetSource: undefined, // dado antigo, de antes do campo existir
        period: { mode: 'range', start: '2026-07-09', end: '2026-07-16' },
      }),
    ]
    applyQuadrantesRecipe(budgets, [], false, '2026-08-05', '2026-08-05T10:00:00.000Z')

    const augBudgets = budgets.filter(
      (b) => b.period.mode === 'range' && b.period.start.startsWith('2026-08')
    )
    expect(augBudgets.find((b) => b.recipeSlot === 1)?.targetSource).toBe('manual')
    expect(augBudgets.find((b) => b.recipeSlot === 2)?.targetSource).toBe('manual')
  })

  it('inherits from an archived instance, skipping months where the slot had no batch', () => {
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jun-1',
        recipeSlot: 1,
        target: 650,
        period: { mode: 'range', start: '2026-06-01', end: '2026-06-08' },
        archivedAt: '2026-07-01T00:00:00.000Z',
      }),
    ]
    // No July batch exists (simulates the app being closed for a month — no back-fill).
    const { changed } = applyQuadrantesRecipe(
      budgets,
      [],
      false,
      '2026-08-05',
      '2026-08-05T10:00:00.000Z'
    )

    expect(changed).toBe(true)
    const slot1Aug = budgets.find(
      (b) => b.recipeSlot === 1 && b.period.mode === 'range' && b.period.start.startsWith('2026-08')
    )
    expect(slot1Aug?.target).toBe(650)
  })

  it('archives the previous month batch in the same step it generates the new one', () => {
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jul-1',
        recipeSlot: 1,
        period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      }),
      makeQuadrante({
        id: 'q-jul-2',
        recipeSlot: 2,
        period: { mode: 'range', start: '2026-07-09', end: '2026-07-16' },
      }),
    ]
    applyQuadrantesRecipe(budgets, [], false, '2026-08-05', '2026-08-05T10:00:00.000Z')

    const july1 = budgets.find((b) => b.id === 'q-jul-1')
    const july2 = budgets.find((b) => b.id === 'q-jul-2')
    expect(july1?.archivedAt).toBe('2026-08-05T10:00:00.000Z')
    expect(july2?.archivedAt).toBe('2026-08-05T10:00:00.000Z')
  })

  it('recreates a slot the user deleted, once the following month rolls over', () => {
    // User deleted slot 2 mid-July — only slots 1/3/4 exist for that month.
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jul-1',
        recipeSlot: 1,
        target: 400,
        period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      }),
      makeQuadrante({
        id: 'q-jul-3',
        recipeSlot: 3,
        target: 200,
        period: { mode: 'range', start: '2026-07-17', end: '2026-07-24' },
      }),
      makeQuadrante({
        id: 'q-jul-4',
        recipeSlot: 4,
        target: 100,
        period: { mode: 'range', start: '2026-07-25', end: '2026-07-31' },
      }),
    ]
    applyQuadrantesRecipe(budgets, [], false, '2026-08-05', '2026-08-05T10:00:00.000Z')

    const augSlot2 = budgets.find(
      (b) => b.recipeSlot === 2 && b.period.mode === 'range' && b.period.start.startsWith('2026-08')
    )
    expect(augSlot2).toBeDefined()
    expect(augSlot2?.target).toBe(0) // never had a prior instance
  })

  it('does not touch the current month batch if the user deleted just one slot mid-month', () => {
    // Only 3 of the 4 slots exist for the current month — hasCurrentBatch must still short-circuit.
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-aug-1',
        recipeSlot: 1,
        period: { mode: 'range', start: '2026-08-01', end: '2026-08-08' },
      }),
      makeQuadrante({
        id: 'q-aug-3',
        recipeSlot: 3,
        period: { mode: 'range', start: '2026-08-17', end: '2026-08-24' },
      }),
      makeQuadrante({
        id: 'q-aug-4',
        recipeSlot: 4,
        period: { mode: 'range', start: '2026-08-25', end: '2026-08-31' },
      }),
    ]
    const { changed } = applyQuadrantesRecipe(
      budgets,
      [],
      false,
      '2026-08-20',
      '2026-08-20T10:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(budgets).toHaveLength(3)
  })

  it('does not archive or regenerate a manual (non-recipe) budget', () => {
    const manual: Budget = {
      id: 'manual-1',
      name: 'Viagem',
      emoji: '✈️',
      color: '#1B4F72',
      kind: 'expense',
      target: 5000,
      period: { mode: 'range', start: '2026-01-01', end: '2026-12-31' },
    }
    const budgets: Budget[] = [manual]
    applyQuadrantesRecipe(budgets, [], false, '2026-08-05', '2026-08-05T10:00:00.000Z')

    expect(budgets.find((b) => b.id === 'manual-1')?.archivedAt).toBeUndefined()
  })
})

describe('applyQuadrantesRecipe — sugestão de meta por histórico (BX-12)', () => {
  it('sugere a mediana dos últimos meses só na primeira geração de um slot, com a flag ligada', () => {
    const transactions: Transaction[] = [
      makeExpense({ id: 't1', date: '2026-05-03', amount: 200 }), // slot 1 (dia 1-8)
      makeExpense({ id: 't2', date: '2026-06-04', amount: 100 }),
      makeExpense({ id: 't3', date: '2026-07-05', amount: 300 }),
      makeExpense({ id: 't4', date: '2026-07-12', amount: 999 }), // fora do slot 1 (dia 9-16)
    ]
    const budgets: Budget[] = []
    applyQuadrantesRecipe(budgets, transactions, true, '2026-08-05', '2026-08-05T10:00:00.000Z')

    expect(budgets.find((b) => b.recipeSlot === 1)?.target).toBe(200) // mediana de 100/200/300
  })

  it('herança sempre vence a sugestão — não recalcula quando já existe lastInstance', () => {
    const transactions: Transaction[] = [
      makeExpense({ id: 't1', date: '2026-05-03', amount: 200 }),
      makeExpense({ id: 't2', date: '2026-06-04', amount: 100 }),
      makeExpense({ id: 't3', date: '2026-07-05', amount: 300 }),
    ]
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jul-1',
        recipeSlot: 1,
        target: 800,
        period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      }),
    ]
    applyQuadrantesRecipe(budgets, transactions, true, '2026-08-05', '2026-08-05T10:00:00.000Z')

    const augSlot1 = budgets.find(
      (b) => b.recipeSlot === 1 && b.period.mode === 'range' && b.period.start.startsWith('2026-08')
    )
    expect(augSlot1?.target).toBe(800) // herdado — a mediana (200) nunca entra em jogo
  })

  it('reporta o slot em suggestionFallbackSlots quando não há histórico, com a flag ligada', () => {
    const budgets: Budget[] = []
    const { suggestionFallbackSlots } = applyQuadrantesRecipe(
      budgets,
      [],
      true,
      '2026-08-05',
      '2026-08-05T10:00:00.000Z'
    )

    expect(suggestionFallbackSlots).toEqual([1, 2, 3, 4])
    for (const slot of [1, 2, 3, 4]) {
      expect(budgets.find((b) => b.recipeSlot === slot)?.target).toBe(0)
    }
  })

  it('não reporta fallback nem sugere nada quando a flag está desligada', () => {
    const budgets: Budget[] = []
    const { suggestionFallbackSlots } = applyQuadrantesRecipe(
      budgets,
      [],
      false,
      '2026-08-05',
      '2026-08-05T10:00:00.000Z'
    )

    expect(suggestionFallbackSlots).toEqual([])
  })
})

describe('refreshQuadrantesSuggestions (BX-12 revisão)', () => {
  it('recalcula uma caixinha ativa cujo targetSource ainda é auto', () => {
    const transactions: Transaction[] = [
      makeExpense({ id: 't1', date: '2026-05-03', amount: 200 }),
      makeExpense({ id: 't2', date: '2026-06-04', amount: 100 }),
      makeExpense({ id: 't3', date: '2026-07-05', amount: 300 }),
    ]
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-aug-1',
        recipeSlot: 1,
        target: 0,
        targetSource: 'auto',
        period: { mode: 'range', start: '2026-08-01', end: '2026-08-08' },
      }),
    ]
    const { changed, suggestionFallbackSlots } = refreshQuadrantesSuggestions(
      budgets,
      transactions,
      '2026-08-05',
      '2026-08-05T12:00:00.000Z'
    )

    expect(changed).toBe(true)
    expect(suggestionFallbackSlots).toEqual([])
    expect(budgets[0].target).toBe(200)
    expect(budgets[0].updatedAt).toBe('2026-08-05T12:00:00.000Z')
  })

  it('nunca mexe numa caixinha já confirmada manualmente (targetSource: manual)', () => {
    const transactions: Transaction[] = [makeExpense({ id: 't1', date: '2026-07-05', amount: 999 })]
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-aug-1',
        recipeSlot: 1,
        target: 123,
        targetSource: 'manual',
        period: { mode: 'range', start: '2026-08-01', end: '2026-08-08' },
      }),
    ]
    const { changed } = refreshQuadrantesSuggestions(
      budgets,
      transactions,
      '2026-08-05',
      '2026-08-05T12:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(budgets[0].target).toBe(123)
  })

  it('trata dado legado sem targetSource como manual — não recalcula', () => {
    const transactions: Transaction[] = [makeExpense({ id: 't1', date: '2026-07-05', amount: 999 })]
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-aug-1',
        recipeSlot: 1,
        target: 50,
        targetSource: undefined,
        period: { mode: 'range', start: '2026-08-01', end: '2026-08-08' },
      }),
    ]
    const { changed } = refreshQuadrantesSuggestions(
      budgets,
      transactions,
      '2026-08-05',
      '2026-08-05T12:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(budgets[0].target).toBe(50)
  })

  it('ignora caixinhas arquivadas mesmo com targetSource auto', () => {
    const transactions: Transaction[] = [makeExpense({ id: 't1', date: '2026-07-05', amount: 999 })]
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-jul-1',
        recipeSlot: 1,
        target: 0,
        targetSource: 'auto',
        archivedAt: '2026-08-01T00:00:00.000Z',
        period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      }),
    ]
    const { changed } = refreshQuadrantesSuggestions(
      budgets,
      transactions,
      '2026-08-05',
      '2026-08-05T12:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(budgets[0].target).toBe(0)
  })

  it('reporta fallback e não mexe no target quando não há histórico suficiente', () => {
    const budgets: Budget[] = [
      makeQuadrante({
        id: 'q-aug-1',
        recipeSlot: 1,
        target: 0,
        targetSource: 'auto',
        period: { mode: 'range', start: '2026-08-01', end: '2026-08-08' },
      }),
    ]
    const { changed, suggestionFallbackSlots } = refreshQuadrantesSuggestions(
      budgets,
      [],
      '2026-08-05',
      '2026-08-05T12:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(suggestionFallbackSlots).toEqual([1])
    expect(budgets[0].target).toBe(0)
  })

  it('ignora caixinhas manuais (sem recipeSlug)', () => {
    const manual: Budget = {
      id: 'manual-1',
      name: 'Viagem',
      emoji: '✈️',
      color: '#1B4F72',
      kind: 'expense',
      target: 5000,
      period: { mode: 'range', start: '2026-08-01', end: '2026-08-31' },
    }
    const { changed } = refreshQuadrantesSuggestions(
      [manual],
      [],
      '2026-08-05',
      '2026-08-05T12:00:00.000Z'
    )

    expect(changed).toBe(false)
    expect(manual.target).toBe(5000)
  })
})

describe('findQuadranteForDate (BX-08)', () => {
  const budgets: Budget[] = [
    makeQuadrante({
      id: 'q1',
      recipeSlot: 1,
      period: { mode: 'range', start: '2026-08-01', end: '2026-08-08' },
    }),
    makeQuadrante({
      id: 'q2',
      recipeSlot: 2,
      period: { mode: 'range', start: '2026-08-09', end: '2026-08-16' },
    }),
    makeQuadrante({
      id: 'q-archived',
      recipeSlot: 1,
      period: { mode: 'range', start: '2026-07-01', end: '2026-07-08' },
      archivedAt: '2026-08-01T00:00:00.000Z',
    }),
  ]

  it('finds the quadrante whose range contains the date', () => {
    expect(findQuadranteForDate(budgets, '2026-08-03')?.id).toBe('q1')
    expect(findQuadranteForDate(budgets, '2026-08-16')?.id).toBe('q2')
  })

  it('returns undefined when no quadrante covers the date', () => {
    expect(findQuadranteForDate(budgets, '2026-09-01')).toBeUndefined()
  })

  it('still matches an archived quadrante — a back-dated entry keeps its historical link', () => {
    expect(findQuadranteForDate(budgets, '2026-07-05')?.id).toBe('q-archived')
  })

  it('ignores manual (non-recipe) budgets even if their period overlaps the date', () => {
    const manual: Budget = {
      id: 'manual-1',
      name: 'Viagem',
      emoji: '✈️',
      color: '#1B4F72',
      kind: 'expense',
      target: 5000,
      period: { mode: 'range', start: '2026-08-01', end: '2026-08-31' },
    }
    expect(findQuadranteForDate([manual], '2026-08-05')).toBeUndefined()
  })
})

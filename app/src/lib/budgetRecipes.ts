// F-30/BX-07/BX-08 — Receita "Quadrantes" (plan/BUDGETS.md §5.6).
//
// Uma "receita" gera e mantém um lote de caixinhas automaticamente; Quadrantes é a única
// receita da v1 (hardcoded, não um framework). Este módulo concentra a lógica pura —
// geração idempotente do lote mensal, herança de meta e arquivamento automático — para que o
// store só orquestre a persistência (mutate/audit). `findQuadranteForDate` é o segundo pilar
// (BX-08): a varredura por data usada tanto na criação quanto na edição-qualificante de uma
// transação.
import type { Budget, Transaction } from '@/types'
import { uuid, suggestQuadranteTarget } from '@/lib/utils'

export const QUADRANTE_SLUG = 'quadrantes'
export const QUADRANTE_COLOR = '#6B7280' // Bambu 600 — cor única e neutra, distinta das cores escolhidas à mão (§5.6)
export const QUADRANTE_EMOJI: Record<1 | 2 | 3 | 4, string> = {
  1: '1️⃣',
  2: '2️⃣',
  3: '3️⃣',
  4: '4️⃣',
}

/** Os 4 intervalos fixos de dias do mês (dia 1–8 / 9–16 / 17–24 / 25–fim), em ordem de slot. */
export function quadranteRanges(year: number, month: number): [string, string][] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const mm = pad(month)
  const lastDay = new Date(year, month, 0).getDate()
  return [
    [`${year}-${mm}-01`, `${year}-${mm}-08`],
    [`${year}-${mm}-09`, `${year}-${mm}-16`],
    [`${year}-${mm}-17`, `${year}-${mm}-24`],
    [`${year}-${mm}-25`, `${year}-${mm}-${pad(lastDay)}`],
  ]
}

export interface QuadrantesRecipeResult {
  changed: boolean
  /** Slots (1-4) where inferFromHistory was on but there wasn't enough history to suggest a
   * target (BX-12) — the caller (useDataStore) turns this into a user-facing toast. Empty when
   * the flag is off, or when every first-generation slot got a suggestion (or wasn't a first
   * generation at all — herança always wins over a suggestion). */
  suggestionFallbackSlots: number[]
}

/**
 * Gera o lote de 4 caixinhas do mês corrente se ele ainda não existir, arquivando o lote
 * anterior no mesmo passo. Checagem por existência (não por tempo decorrido) — idempotente a
 * chamar em todo boot/mount. `changed` indica se `budgets` foi alterado (o chamador decide se
 * persiste). Não mexe em `transactions` além de lê-las para a sugestão de meta (BX-12) — a
 * associação automática (BX-08) continua responsabilidade de `findQuadranteForDate`, disparada
 * só na criação/edição de cada lançamento.
 *
 * `inferFromHistory` (BX-12, plan/BUDGETS.md §5.9.1): quando ligado, a meta de um slot que está
 * sendo gerado pela **primeira vez de verdade** (nenhuma instância anterior, `lastInstance`
 * undefined) vira uma sugestão — mediana dos últimos 6 meses de despesas realizadas nesse slot
 * (suggestQuadranteTarget) — em vez do 0 fixo de sempre. Nunca se aplica quando já existe
 * `lastInstance`: a herança de meta entre meses continua intocada, sem virar meta rolante.
 */
export function applyQuadrantesRecipe(
  budgets: Budget[],
  transactions: Transaction[],
  inferFromHistory: boolean,
  today: string,
  ts: string
): QuadrantesRecipeResult {
  const [y, m] = today.slice(0, 10).split('-').map(Number)
  const monthKey = `${y}-${String(m).padStart(2, '0')}`

  const quadrantes = budgets.filter((b) => b.recipeSlug === QUADRANTE_SLUG)
  const hasCurrentBatch = quadrantes.some(
    (b) => b.period.mode === 'range' && b.period.start.slice(0, 7) === monthKey
  )
  if (hasCurrentBatch) return { changed: false, suggestionFallbackSlots: [] } // já gerado neste mês

  let changed = false
  const suggestionFallbackSlots: number[] = []

  // Arquiva qualquer lote de mês anterior ainda ativo — "no mesmo passo em que gera o novo"
  // (§5.6). Cobre também meses pulados: não há back-fill, então tudo que não é do mês corrente
  // e ainda está ativo é encerrado de uma vez.
  for (const b of quadrantes) {
    if (!b.archivedAt && b.period.mode === 'range' && b.period.start.slice(0, 7) !== monthKey) {
      b.archivedAt = ts
      b.updatedAt = ts
      changed = true
    }
  }

  const ranges = quadranteRanges(y, m)
  for (let slot = 1; slot <= 4; slot++) {
    // Herança de meta: a última instância existente do slot, ativa ou arquivada — sem isso a
    // cadeia de herança quebraria a cada virada de mês (§5.6).
    const slotInstances = quadrantes.filter(
      (b): b is Budget & { period: { mode: 'range'; start: string; end: string } } =>
        b.recipeSlot === slot && b.period.mode === 'range'
    )
    const lastInstance = slotInstances.sort((a, b) =>
      b.period.start.localeCompare(a.period.start)
    )[0]

    let target = lastInstance?.target
    // BX-12 (revisão): dado antigo/desconhecido nunca é tratado como elegível a recálculo —
    // só marca 'auto' abaixo quando é uma geração de verdade nova.
    let targetSource: 'auto' | 'manual' = lastInstance?.targetSource ?? 'manual'
    if (target === undefined) {
      if (inferFromHistory) {
        const suggestion = suggestQuadranteTarget(transactions, slot as 1 | 2 | 3 | 4, today)
        target = suggestion.value ?? 0
        if (suggestion.value === null) suggestionFallbackSlots.push(slot)
      } else {
        target = 0
      }
      targetSource = 'auto'
    }

    const [start, end] = ranges[slot - 1]
    budgets.push({
      id: uuid(),
      name: `Quadrante ${slot}`,
      emoji: QUADRANTE_EMOJI[slot as 1 | 2 | 3 | 4],
      color: QUADRANTE_COLOR,
      kind: 'expense',
      target,
      targetSource,
      period: { mode: 'range', start, end },
      recipeSlug: QUADRANTE_SLUG,
      recipeSlot: slot,
      createdAt: ts,
      updatedAt: ts,
    })
    changed = true
  }

  return { changed, suggestionFallbackSlots }
}

export interface QuadrantesSuggestionRefreshResult {
  changed: boolean
  suggestionFallbackSlots: number[]
}

/**
 * BX-12 (revisão, plan/BUDGETS.md §5.9.1) — recalcula na hora as caixinhas Quadrantes **ativas**
 * cujo `targetSource` ainda não é `'manual'` (nunca confirmadas por um humano). Disparada só pelo
 * momento em que o usuário liga "Sugerir meta pelo histórico" em `RecipeSettings.tsx` — nunca pela
 * virada de mês (que continua herança pura, `applyQuadrantesRecipe` acima) — então não é meta
 * rolante: é uma ação pontual do usuário, não uma reavaliação automática mensal.
 */
export function refreshQuadrantesSuggestions(
  budgets: Budget[],
  transactions: Transaction[],
  today: string,
  ts: string
): QuadrantesSuggestionRefreshResult {
  const suggestionFallbackSlots: number[] = []
  let changed = false

  for (const b of budgets) {
    if (b.recipeSlug !== QUADRANTE_SLUG || b.archivedAt) continue
    if ((b.targetSource ?? 'manual') === 'manual') continue

    const suggestion = suggestQuadranteTarget(transactions, b.recipeSlot as 1 | 2 | 3 | 4, today)
    if (suggestion.value !== null) {
      b.target = suggestion.value
      b.updatedAt = ts
      changed = true
    } else {
      suggestionFallbackSlots.push(b.recipeSlot!)
    }
  }

  return { changed, suggestionFallbackSlots }
}

/**
 * Encontra a caixinha Quadrantes (ativa ou arquivada) cujo período cobre a data — usada pela
 * associação automática (BX-08) tanto na criação quanto na edição-qualificante de um
 * lançamento. Arquivada também conta: um lançamento pode ser lançado com data retroativa depois
 * da virada de mês, e o vínculo histórico precisa ficar correto mesmo assim (§5.6).
 */
export function findQuadranteForDate(budgets: Budget[], date: string): Budget | undefined {
  const d = date.slice(0, 10)
  return budgets.find(
    (b) =>
      b.recipeSlug === QUADRANTE_SLUG &&
      b.period.mode === 'range' &&
      d >= b.period.start &&
      d <= b.period.end
  )
}

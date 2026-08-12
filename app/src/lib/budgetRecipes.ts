// F-30/BX-07/BX-08 — Receita "Quadrantes" (plan/BUDGETS.md §5.6).
//
// Uma "receita" gera e mantém um lote de caixinhas automaticamente; Quadrantes é a única
// receita da v1 (hardcoded, não um framework). Este módulo concentra a lógica pura —
// geração idempotente do lote mensal, herança de meta e arquivamento automático — para que o
// store só orquestre a persistência (mutate/audit). `findQuadranteForDate` é o segundo pilar
// (BX-08): a varredura por data usada tanto na criação quanto na edição-qualificante de uma
// transação.
import type { Budget } from '@/types'
import { uuid } from '@/lib/utils'

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

/**
 * Gera o lote de 4 caixinhas do mês corrente se ele ainda não existir, arquivando o lote
 * anterior no mesmo passo. Checagem por existência (não por tempo decorrido) — idempotente a
 * chamar em todo boot/mount. Retorna `true` se `budgets` foi alterado (o chamador decide se
 * persiste). Não mexe em `transactions` — a associação automática (BX-08) é responsabilidade de
 * `findQuadranteForDate`, disparada só na criação/edição de cada lançamento.
 */
export function applyQuadrantesRecipe(budgets: Budget[], today: string, ts: string): boolean {
  const [y, m] = today.slice(0, 10).split('-').map(Number)
  const monthKey = `${y}-${String(m).padStart(2, '0')}`

  const quadrantes = budgets.filter((b) => b.recipeSlug === QUADRANTE_SLUG)
  const hasCurrentBatch = quadrantes.some(
    (b) => b.period.mode === 'range' && b.period.start.slice(0, 7) === monthKey
  )
  if (hasCurrentBatch) return false // já gerado — nada a fazer neste boot/mês

  let changed = false

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

    const [start, end] = ranges[slot - 1]
    budgets.push({
      id: uuid(),
      name: `Quadrante ${slot}`,
      emoji: QUADRANTE_EMOJI[slot as 1 | 2 | 3 | 4],
      color: QUADRANTE_COLOR,
      kind: 'expense',
      target: lastInstance?.target ?? 0,
      period: { mode: 'range', start, end },
      recipeSlug: QUADRANTE_SLUG,
      recipeSlot: slot,
      createdAt: ts,
      updatedAt: ts,
    })
    changed = true
  }

  return changed
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

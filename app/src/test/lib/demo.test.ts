import { describe, it, expect } from 'vitest'
import { loadDemoData } from '@/lib/demo'

describe('loadDemoData (F-25/BX-10)', () => {
  it('resolves a DataFile that passes schema validation', async () => {
    const data = await loadDemoData()
    expect(data.user.name).toBeTruthy()
    expect(data.transactions.length).toBeGreaterThan(0)
  })

  it('ships curated budgets so /budgets is not empty in the public demo', async () => {
    const data = await loadDemoData()
    expect(data.budgets.length).toBeGreaterThan(0)
  })

  it('links at least one budget to real, realized transactions (a populated example)', async () => {
    const data = await loadDemoData()
    const linkedTxIds = data.transactions.filter((t) => t.budgetIds?.length).map((t) => t.id)
    expect(linkedTxIds.length).toBeGreaterThan(0)
    const linkedBudgetId = data.transactions.find((t) => t.budgetIds?.length)?.budgetIds?.[0]
    expect(data.budgets.some((b) => b.id === linkedBudgetId)).toBe(true)
  })

  it('enables the Quadrantes recipe — self-generates a coherent batch every session', async () => {
    const data = await loadDemoData()
    expect(data.settings.quadrantesEnabled).toBe(true)
  })
})

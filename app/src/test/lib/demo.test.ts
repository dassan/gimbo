import { describe, it, expect } from 'vitest'
import { loadDemoData } from '@/lib/demo'

// Nomes de ícone que o app sabe desenhar (CATEGORY_ICONS em pages/Settings/index.tsx e
// CATEGORY_ICON_MAP em pages/Analytics/CategoriasView.tsx). Qualquer outro nome não é erro
// de validação — cai silenciosamente num círculo genérico na tela, que é pior.
const CATEGORY_ICONS = [
  'utensils',
  'shopping-cart',
  'car',
  'home',
  'heart',
  'plane',
  'graduation-cap',
  'tv',
  'wrench',
  'briefcase',
  'gift',
  'tag',
]

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

  it('has no dangling references between entities', async () => {
    const data = await loadDemoData()
    const accounts = new Set(data.accounts.map((a) => a.id))
    const categories = new Set(data.categories.map((c) => c.id))
    const tags = new Set(data.tags.map((t) => t.id))
    const budgets = new Set(data.budgets.map((b) => b.id))

    for (const tx of data.transactions) {
      expect(accounts, tx.description).toContain(tx.accountId)
      // TRANSFER/CREDIT_PAYMENT são gravados sem categoria pelo próprio app.
      if (tx.categoryId !== '') expect(categories, tx.description).toContain(tx.categoryId)
      if (tx.transferAccountId) expect(accounts, tx.description).toContain(tx.transferAccountId)
      for (const tag of tx.tags) expect(tags, tx.description).toContain(tag)
      for (const budget of tx.budgetIds ?? []) expect(budgets, tx.description).toContain(budget)
    }
    for (const c of data.categories)
      if (c.parentId) expect(categories, c.name).toContain(c.parentId)
    for (const v of data.valuations) expect(accounts).toContain(v.accountId)
  })

  it('only uses category icons the app can actually render', async () => {
    const data = await loadDemoData()
    for (const c of data.categories) expect(CATEGORY_ICONS, c.name).toContain(c.icon)
  })

  it("never moves cash in the future — the demo balance must be today's balance", async () => {
    // computeAccountBalances conta TRANSFER e CREDIT_PAYMENT independentemente da data e de
    // `isPaid`, e o Dashboard soma sem recorte de data. Um único deles com data futura
    // deslocaria o saldo exibido hoje.
    const data = await loadDemoData()
    const today = new Date().toISOString().slice(0, 10)
    for (const tx of data.transactions) {
      if (tx.date <= today) continue
      expect(['INCOME', 'EXPENSE'], `${tx.type} futuro: ${tx.description}`).toContain(tx.type)
      expect(tx.isPaid, `marcado como pago no futuro: ${tx.description}`).toBe(false)
    }
  })
})

import { test, expect, type Page } from '@playwright/test'

// M-73/PERFORMANCE.md — StorageService.applyMutation() substitui o replaceAll() por mutação:
// em vez de reescrever a tabela transactions inteira a cada edição, só as linhas que de fato
// mudaram viram INSERT/UPDATE/DELETE (lib/storage/transactionDiff.ts). Este spec cobre
// exatamente o que um diff com bug poderia errar e o replaceAll() antigo não erraria
// estruturalmente: linhas do seed não-tocadas sobrevivem intactas a uma edição em outra linha,
// e tags/budgetIds de uma transação sobrevivem a uma edição que não mexe neles.

const todayISO = new Date().toISOString().slice(0, 10)
const currentMonth = todayISO.slice(0, 7)

const fixture = {
  schemaVersion: 2,
  user: { name: 'E2E Delta', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' },
  settings: {
    fileCreatedAt: '2024-01-01T00:00:00.000Z',
    fileUpdatedAt: '2024-01-01T00:00:00.000Z',
    auditLogRetentionLimit: 200,
  },
  accounts: [
    { id: 'acc-delta-1', name: 'Conta Delta', type: 'RETAIL', balance: 1000, includeInBalance: true },
  ],
  categories: [
    {
      id: 'cat-delta-1',
      parentId: null,
      name: 'Categoria Delta',
      icon: 'circle',
      color: '#888888',
      type: 'EXPENSE',
    },
  ],
  tags: [{ id: 'tag-delta-1', name: 'tagdelta', color: '#888888' }],
  budgets: [
    {
      id: 'bud-delta-1',
      name: 'Caixinha Delta',
      emoji: '💰',
      color: '#888888',
      kind: 'EXPENSE',
      target: 1000,
      period: { mode: 'date', date: currentMonth },
    },
  ],
  transactions: [
    {
      id: 'tx-delta-tagged',
      accountId: 'acc-delta-1',
      categoryId: 'cat-delta-1',
      amount: 100,
      type: 'EXPENSE',
      date: todayISO,
      description: 'Seed com tag e caixinha',
      isPaid: true,
      tags: ['tag-delta-1'],
      budgetIds: ['bud-delta-1'],
    },
    {
      id: 'tx-delta-untouched',
      accountId: 'acc-delta-1',
      categoryId: 'cat-delta-1',
      amount: 50,
      type: 'EXPENSE',
      date: todayISO,
      description: 'Seed intocada',
      isPaid: true,
      tags: ['tag-delta-1'],
      budgetIds: ['bud-delta-1'],
    },
    {
      id: 'tx-delta-to-delete',
      accountId: 'acc-delta-1',
      categoryId: 'cat-delta-1',
      amount: 25,
      type: 'EXPENSE',
      date: todayISO,
      description: 'Seed a apagar',
      isPaid: true,
      tags: [],
    },
  ],
  auditLog: [],
  deletedIds: [],
}

async function seedSqlite(page: Page, data: unknown) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  await page.evaluate((d) => {
    return (window as Record<string, unknown>).__storage.replaceAll(d)
  }, data)
}

async function queryOne<T>(page: Page, sql: string, params: unknown[] = []): Promise<T> {
  return page.evaluate(
    async ([q, p]) => {
      const rows = await (window as Record<string, unknown>).__storage.query(q, p)
      return rows[0]
    },
    [sql, params] as const
  ) as Promise<T>
}

test.beforeEach(async ({ page }) => {
  await seedSqlite(page, fixture)
})

test('editar, criar e apagar transações persistem corretamente via applyMutation()', async ({
  page,
}) => {
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/transactions/)

  // ── UPDATE: mexe só no valor, tags/budgetIds da própria transação não são tocados na UI ──
  const taggedRow = page.locator('[role="button"]').filter({ hasText: 'Seed com tag e caixinha' })
  await taggedRow.waitFor({ state: 'visible', timeout: 5000 })
  await taggedRow.click()
  await expect(page.getByText('Editar Transação')).toBeVisible({ timeout: 3000 })
  const amountInput = page.locator('input[placeholder="0,00"]')
  await amountInput.clear()
  await amountInput.fill('999,00')
  await page.getByRole('button', { name: 'Salvar Alterações →' }).click()
  await expect(
    page.locator('.fixed.inset-0.z-50').first()
  ).toHaveClass(/pointer-events-none/, { timeout: 3000 })

  // ── DELETE ──
  const toDeleteRow = page.locator('[role="button"]').filter({ hasText: 'Seed a apagar' })
  await toDeleteRow.waitFor({ state: 'visible', timeout: 5000 })
  await toDeleteRow.click()
  await expect(page.getByText('Editar Transação')).toBeVisible({ timeout: 3000 })
  await page.getByRole('button', { name: 'Remover Transação' }).click()
  await expect(
    page.locator('.fixed.inset-0.z-50').first()
  ).toHaveClass(/pointer-events-none/, { timeout: 3000 })

  // ── ADD (via FAB) ──
  await page.getByRole('button', { name: 'Nova Transação' }).click()
  const newAmountInput = page.locator('input[placeholder="0,00"]')
  await newAmountInput.waitFor({ state: 'visible', timeout: 5000 })
  await newAmountInput.fill('321,00')
  await page.getByRole('button', { name: 'Salvar Despesa' }).click()
  await expect(
    page.locator('.fixed.inset-0.z-50').first()
  ).toHaveClass(/pointer-events-none/, { timeout: 3000 })

  // Espera a escrita direcionada (debounce de 300ms + applyMutation) realmente terminar antes
  // de recarregar — sem isso o reload poderia ler o SQLite ainda não atualizado.
  await expect
    .poll(async () => (await queryOne<{ n: number }>(page, 'SELECT COUNT(*) as n FROM transactions')).n, {
      timeout: 5000,
    })
    .toBe(3) // 3 seeds - 1 apagada + 1 nova = 3

  await page.reload()
  await page.waitForURL(/\/transactions/)

  // ── Linha editada: valor novo, tags preservadas (o form da TransactionDrawer carrega e
  // resubmete `tags`; `budgetIds` não tem esse tratamento na UI hoje — gap pré-existente,
  // fora do escopo do M-73, não testado aqui de propósito) ──
  const tagged = await queryOne<{ amount: number; tag_ids: string | null }>(
    page,
    `SELECT t.amount, GROUP_CONCAT(DISTINCT tt.tag_id) AS tag_ids
     FROM transactions t
     LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
     WHERE t.id = 'tx-delta-tagged'
     GROUP BY t.id`
  )
  expect(tagged.amount).toBe(999)
  expect(tagged.tag_ids).toBe('tag-delta-1')

  // ── Linha do seed nunca tocada por nenhuma mutação: sobrevive intacta, inclusive suas
  // linhas de junção (tag/caixinha) — é exatamente o que um diff com bug erraria e o
  // replaceAll() antigo não erraria estruturalmente ──
  const untouched = await queryOne<{
    amount: number
    description: string
    tag_ids: string | null
    budget_ids: string | null
  }>(
    page,
    `SELECT t.amount, t.description, GROUP_CONCAT(DISTINCT tt.tag_id) AS tag_ids,
            GROUP_CONCAT(DISTINCT tb.budget_id) AS budget_ids
     FROM transactions t
     LEFT JOIN transaction_tags tt ON t.id = tt.transaction_id
     LEFT JOIN transaction_budgets tb ON t.id = tb.transaction_id
     WHERE t.id = 'tx-delta-untouched'
     GROUP BY t.id`
  )
  expect(untouched.amount).toBe(50)
  expect(untouched.description).toBe('Seed intocada')
  expect(untouched.tag_ids).toBe('tag-delta-1')
  expect(untouched.budget_ids).toBe('bud-delta-1')

  // ── Linha apagada: some de verdade ──
  const deleted = await queryOne<Record<string, unknown> | undefined>(
    page,
    "SELECT id FROM transactions WHERE id = 'tx-delta-to-delete'"
  )
  expect(deleted).toBeUndefined()

  // ── Linha nova: existe com o valor certo ──
  const added = await queryOne<{ n: number }>(
    page,
    "SELECT COUNT(*) as n FROM transactions WHERE amount = 321"
  )
  expect(added.n).toBe(1)
})

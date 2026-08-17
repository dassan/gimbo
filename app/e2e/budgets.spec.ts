/**
 * E2E tests for Caixinhas (F-30, BX-11).
 *
 * All scenarios use the shared SQLite-seeded fixture (see creditCard.spec.ts for its shape)
 * extended inline with an EXPENSE transaction so there is something to associate. Covers the
 * manual-budget lifecycle (criar → associar → editar → arquivar/excluir) and, separately, the
 * Quadrantes recipe (toggle → lote do mês → associação automática por data, BX-07/BX-08).
 */

import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const baseFixture = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/dataFile.json'), 'utf-8')
) as Record<string, unknown>

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedSqlite(page: import('@playwright/test').Page, data: Record<string, unknown>) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  await page.evaluate((d) => {
    return (window as Record<string, unknown>).__storage.replaceAll(d)
  }, data)
}

// A hard page.goto (unavoidable on mobile — Caixinhas has no bottom-nav entry, see below)
// tears down the in-memory store and re-reads from OPFS on boot. Mutations persist via a
// 300ms-debounced write (useDataStore's debouncedReplaceAll); polling the real storage
// singleton — instead of a blind waitForTimeout — is what makes this deterministic under
// CI/worker contention rather than merely "usually long enough". Uses expect.poll (drives the
// retry loop from Node) rather than page.waitForFunction with an async in-page predicate — the
// latter resolved after a single poll on a `false` value in practice (its promise-unwrapping
// semantics don't play well with a predicate that awaits a worker postMessage round-trip).
async function waitForSettingsPersisted(page: import('@playwright/test').Page) {
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            (
              window as unknown as {
                __storage: { getSettings: () => Promise<{ quadrantesEnabled?: boolean }> }
              }
            ).__storage.getSettings()
          )
        )?.quadrantesEnabled,
      { timeout: 10000 }
    )
    .toBe(true)
}

async function waitForTransactionPersisted(
  page: import('@playwright/test').Page,
  description: string
) {
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            (
              window as unknown as {
                __storage: { getTransactions: () => Promise<{ description: string }[]> }
              }
            ).__storage.getTransactions()
          )
        ).some((t) => t.description === description),
      { timeout: 10000 }
    )
    .toBe(true)
}

// Fixture + one EXPENSE transaction (base fixture only ships an INCOME) so there is a real
// candidate for the "Associar lançamento" picker.
const fixtureWithExpense = {
  ...baseFixture,
  transactions: [
    ...(baseFixture.transactions as unknown[]),
    {
      id: 'tx-e2e-expense',
      accountId: 'acc-e2e-1',
      categoryId: 'cat-e2e-2',
      amount: 250,
      type: 'EXPENSE',
      date: '2024-01-20',
      description: 'Mercado E2E',
      isPaid: true,
      tags: [],
    },
  ],
}

// ─── Manual budget lifecycle ────────────────────────────────────────────────

test('caixinha manual: criar → associar lançamento → editar → arquivar', async ({ page }) => {
  await seedSqlite(page, fixtureWithExpense)
  await page.goto('/budgets')
  await expect(page).toHaveURL(/\/budgets/)

  // Criar
  await page.getByRole('button', { name: 'Nova caixinha' }).first().click()
  await page.locator('#budget-name').fill('Viagem E2E')
  await page.locator('#budget-amount').fill('100000') // R$ 1.000,00
  await page.getByRole('button', { name: 'Criar caixinha' }).click()

  const card = page.locator('a').filter({ hasText: 'Viagem E2E' })
  await expect(card).toBeVisible({ timeout: 5000 })
  // MB-14: the target value renders differently per viewport (desktop: its own "Meta" line;
  // mobile: combined into "Atual / Meta") — check presence, not a specific node's visibility.
  await expect(card).toContainText('R$ 1.000,00')

  // Associar
  await card.click()
  await expect(page.getByRole('heading', { name: 'Viagem E2E' })).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: 'Associar lançamento' }).click()
  await page.getByRole('button', { name: /Mercado E2E/ }).click()
  await page.getByRole('button', { name: 'Fechar' }).click()

  await expect(page.getByText('Mercado E2E')).toBeVisible({ timeout: 3000 })
  await expect(page.getByText('1', { exact: true }).first()).toBeVisible() // "1 associados a esta caixinha"

  // Editar
  await page.getByRole('button', { name: 'Editar' }).click()
  await page.locator('#budget-amount').fill('150000') // R$ 1.500,00
  await page.getByRole('button', { name: 'Salvar alterações' }).click()
  await expect(page.getByText('R$ 1.500,00')).toBeVisible({ timeout: 3000 })

  // Arquivar
  await page.getByRole('button', { name: 'Arquivar' }).click()
  await page.getByRole('button', { name: 'Arquivar', exact: true }).last().click()
  await expect(page).toHaveURL(/\/budgets$/, { timeout: 5000 })
  await expect(page.locator('a').filter({ hasText: 'Viagem E2E' })).toHaveCount(0)
})

test('caixinha manual: excluir redireciona para a lista', async ({ page }) => {
  await seedSqlite(page, baseFixture)
  await page.goto('/budgets')

  await page.getByRole('button', { name: 'Nova caixinha' }).first().click()
  await page.locator('#budget-name').fill('Reforma E2E')
  await page.locator('#budget-amount').fill('500000')
  await page.getByRole('button', { name: 'Criar caixinha' }).click()

  const card = page.locator('a').filter({ hasText: 'Reforma E2E' })
  await expect(card).toBeVisible({ timeout: 5000 })
  await card.click()

  await expect(page.getByRole('heading', { name: 'Reforma E2E' })).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: 'Editar' }).click()
  await page.getByRole('button', { name: 'Excluir caixinha' }).click()
  await page.getByRole('button', { name: 'Excluir', exact: true }).click()

  // T-1: a rota /budgets/:id deixa de existir depois da exclusão
  await expect(page).toHaveURL(/\/budgets$/, { timeout: 5000 })
  await expect(page.locator('a').filter({ hasText: 'Reforma E2E' })).toHaveCount(0)
})

// ─── Receita Quadrantes (BX-07/BX-08) ────────────────────────────────────────

test('Quadrantes: ligar em Preferências gera o lote do mês e associa uma despesa nova por data', async ({
  page,
}) => {
  await seedSqlite(page, baseFixture)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Preferências', exact: true }).click()

  const toggle = page.getByRole('button', { name: 'Receita Quadrantes' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')

  // Navegação direta por URL, não pelo nav — mais simples que clicar (Caixinhas já tem entrada
  // na bottom nav do mobile desde MB-13, mas isso é incidental aqui). page.goto é um hard
  // reload: espera o debounce de 300ms do toggle (debouncedReplaceAll) realmente chegar no OPFS
  // antes de recarregar, senão o boot lê o estado anterior (quadrantesEnabled: false) persistido.
  await waitForSettingsPersisted(page)
  await page.goto('/budgets')
  await page.waitForLoadState('networkidle')
  for (const slot of [1, 2, 3, 4]) {
    await expect(page.getByRole('heading', { name: `Quadrante ${slot}` })).toBeVisible({
      timeout: 10000,
    })
  }

  // Cria uma despesa nova — a data default do drawer é hoje, então ela sempre cai em algum
  // dos 4 slots, independente do dia do mês em que o teste rodar.
  const dayOfMonth = new Date().getDate()
  const expectedSlot = dayOfMonth <= 8 ? 1 : dayOfMonth <= 16 ? 2 : dayOfMonth <= 24 ? 3 : 4

  await page.getByRole('button', { name: 'Nova Transação' }).click()
  const amountInput = page.locator('input[placeholder="0,00"]')
  await amountInput.waitFor({ state: 'visible', timeout: 5000 })
  await amountInput.fill('4250')
  await page.locator('input[placeholder*="Descrição"]').fill('Compra E2E Quadrantes')
  await page.getByRole('button', { name: 'Salvar Despesa' }).click()

  await waitForTransactionPersisted(page, 'Compra E2E Quadrantes')
  await page.goto('/budgets')
  await page.waitForLoadState('networkidle')
  await page.getByRole('heading', { name: `Quadrante ${expectedSlot}` }).click()
  await expect(page.getByText('Compra E2E Quadrantes')).toBeVisible({ timeout: 10000 })
})

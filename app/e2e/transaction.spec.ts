import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataFile = JSON.parse(
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

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await seedSqlite(page, dataFile)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

test('add transaction: opens FAB drawer and saves', async ({ page }) => {
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  // Open FAB
  await page.getByRole('button', { name: 'Nova Transação' }).click()

  // Wait for drawer to open and fill amount input
  const amountInput = page.locator('input[placeholder="0,00"]')
  await amountInput.waitFor({ state: 'visible', timeout: 5000 })
  await amountInput.fill('15000') // R$ 150,00

  // Save as expense (default type)
  await page.getByRole('button', { name: 'Salvar Despesa' }).click()

  // Drawer slides out — backdrop gets pointer-events-none when closed
  const backdrop = page.locator('.fixed.inset-0.z-50').first()
  await expect(backdrop).toHaveClass(/pointer-events-none/, { timeout: 3000 })
})

test('edit transaction: opens drawer pre-filled on row click', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/transactions/)

  // The fixture has one transaction "Salário Janeiro" in January 2024 — switch to a custom range to see it
  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2024-01-01')
  await page.getByLabel('custom-end-date').fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  // Click the transaction row
  const txRow = page.locator('[role="button"]').filter({ hasText: 'Salário Janeiro' })
  await txRow.waitFor({ state: 'visible', timeout: 5000 })
  await txRow.click()

  // Drawer should open in edit mode
  await expect(page.getByText('Editar Transação')).toBeVisible({ timeout: 3000 })

  // Amount should be pre-filled (5000.00)
  await expect(page.locator('input[placeholder="0,00"]')).toHaveValue('5000,00')

  // Description should be pre-filled
  await expect(page.locator('input[placeholder*="Descrição"]')).toHaveValue('Salário Janeiro')

  // Save-update button should be visible
  await expect(page.getByRole('button', { name: 'Salvar Alterações →' })).toBeVisible()

  // Delete button should be visible
  await expect(page.getByRole('button', { name: 'Remover Transação' })).toBeVisible()
})

test('edit transaction: updates description and saves', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/transactions/)

  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2024-01-01')
  await page.getByLabel('custom-end-date').fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  const txRow = page.locator('[role="button"]').filter({ hasText: 'Salário Janeiro' })
  await txRow.waitFor({ state: 'visible', timeout: 5000 })
  await txRow.click()

  await expect(page.getByText('Editar Transação')).toBeVisible({ timeout: 3000 })

  // Edit description
  const descInput = page.locator('input[placeholder*="Descrição"]')
  await descInput.clear()
  await descInput.fill('Salário Fevereiro')

  await page.getByRole('button', { name: 'Salvar Alterações →' }).click()

  // Drawer closes
  const backdrop = page.locator('.fixed.inset-0.z-50').first()
  await expect(backdrop).toHaveClass(/pointer-events-none/, { timeout: 3000 })

  // Updated transaction appears in the list
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Salário Fevereiro' })
  ).toBeVisible()
})

test('delete transaction: removes the transaction from the list', async ({ page }) => {
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/transactions/)

  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2024-01-01')
  await page.getByLabel('custom-end-date').fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  const txRow = page.locator('[role="button"]').filter({ hasText: 'Salário Janeiro' })
  await txRow.waitFor({ state: 'visible', timeout: 5000 })
  await txRow.click()

  await expect(page.getByText('Editar Transação')).toBeVisible({ timeout: 3000 })

  await page.getByRole('button', { name: 'Remover Transação' }).click()

  // Drawer closes
  const backdrop = page.locator('.fixed.inset-0.z-50').first()
  await expect(backdrop).toHaveClass(/pointer-events-none/, { timeout: 3000 })

  // Transaction no longer in the list
  await expect(page.locator('[role="button"]').filter({ hasText: 'Salário Janeiro' })).toHaveCount(
    0
  )
})

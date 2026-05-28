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

// ─── Tests ────────────────────────────────────────────────────────────────────

test('data persists after page reload', async ({ page }) => {
  await seedSqlite(page, dataFile)

  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  // Reload — should stay on dashboard (not redirect to onboarding)
  await page.reload()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })

  // Navigate to /transactions with a wide date range to confirm data survived the reload.
  // We use /transactions instead of the dashboard "recent transactions" widget because
  // that widget is hidden on mobile viewports (MB-03 — desktop-only section).
  await page.goto('/transactions')
  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2024-01-01')
  await page.getByLabel('custom-end-date').fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()
  await expect(page.getByText('Salário Janeiro')).toBeVisible({ timeout: 5000 })
})

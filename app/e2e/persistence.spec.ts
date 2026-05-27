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

  // Fixture transaction description should appear in recent transactions
  await expect(page.getByText('Salário Janeiro')).toBeVisible({ timeout: 5000 })

  // Reload — should stay on dashboard (not redirect to onboarding)
  await page.reload()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })
  await expect(page.getByText('Salário Janeiro')).toBeVisible()
})

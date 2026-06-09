/**
 * E2E tests for mobile PWA layout and navigation (F-27 — MB-07).
 *
 * These tests verify the responsive behaviour introduced in the mobile phase:
 *   - Bottom navigation bar is visible and functional
 *   - Sections hidden on mobile (Meus Cartões, Recent Transactions, Spending
 *     Summary sidebar) are actually absent from view
 *   - The Transaction Drawer opens as a bottom sheet
 *   - The + button in the bottom nav wires to the same transaction drawer
 *
 * All tests run on BOTH chromium (desktop) and mobile-chrome projects.
 * Assertions that require a small viewport use `isMobile` to branch, so each
 * test remains valid — but the interesting assertions are the mobile ones.
 */

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

// ─── Bottom navigation ────────────────────────────────────────────────────────

test('bottom nav: visible on mobile, hidden on desktop', async ({ page, isMobile }) => {
  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' })

  if (isMobile) {
    await expect(bottomNav).toBeVisible()
  } else {
    // On desktop the nav is in the DOM but hidden via sm:hidden
    await expect(bottomNav).not.toBeVisible()
  }
})

test('bottom nav: navigates to Lançamentos', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Navigation via bottom nav only relevant on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  // Click the "Lançamentos" link in the bottom nav
  const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' })
  await bottomNav.getByText('Lançamentos').click()

  await expect(page).toHaveURL(/\/transactions/, { timeout: 5000 })
})

test('bottom nav: navigates to Visão Geral', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Navigation via bottom nav only relevant on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/transactions')

  const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' })
  await bottomNav.getByText('Visão Geral').click()

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })
})

test('bottom nav: + button opens transaction drawer', async ({ page, isMobile }) => {
  test.skip(!isMobile, '+ button in bottom nav only relevant on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  // The FAB is hidden; the + button lives in the bottom nav
  const bottomNav = page.getByRole('navigation', { name: 'Navegação principal' })
  await bottomNav.getByRole('button', { name: 'Nova Transação' }).click()

  // Drawer should open — amount input becomes visible
  const amountInput = page.locator('input[placeholder="0,00"]')
  await expect(amountInput).toBeVisible({ timeout: 5000 })
})

// ─── Dashboard layout ─────────────────────────────────────────────────────────

test('dashboard mobile: Meus Cartões section is hidden', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Meus Cartões is desktop-only — this test only makes sense on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  await expect(page.getByRole('heading', { name: 'Meus Cartões' })).not.toBeVisible()
})

test('dashboard mobile: Minhas Contas is visible', async ({ page }) => {
  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  // Minhas Contas is shown on both mobile and desktop
  await expect(page.getByRole('heading', { name: 'Minhas Contas' })).toBeVisible({ timeout: 5000 })
})

test('dashboard mobile: recent transactions section is hidden', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Recent transactions widget is desktop-only — only meaningful on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  await expect(page.getByRole('heading', { name: 'Últimos Lançamentos' })).not.toBeVisible()
})

// ─── FAB on desktop ───────────────────────────────────────────────────────────

test('desktop FAB: visible and opens drawer on desktop', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'FAB is desktop-only — replaced by bottom nav + on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  await page.getByRole('button', { name: 'Nova Transação' }).click()

  const amountInput = page.locator('input[placeholder="0,00"]')
  await expect(amountInput).toBeVisible({ timeout: 5000 })
})

// ─── Transaction drawer ───────────────────────────────────────────────────────

test('transaction drawer: opens and amount field is focusable', async ({ page }) => {
  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  // Opens via FAB on desktop, via bottom nav + on mobile — same aria-label
  await page.getByRole('button', { name: 'Nova Transação' }).click()

  const amountInput = page.locator('input[placeholder="0,00"]')
  await expect(amountInput).toBeVisible({ timeout: 5000 })
  await amountInput.fill('5000')
  await expect(amountInput).toHaveValue('50,00')
})

// ─── Transactions page ────────────────────────────────────────────────────────

test('transactions page: transaction list is always visible', async ({ page }) => {
  await seedSqlite(page, dataFile)
  await page.goto('/transactions')

  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2024-01-01')
  await page.getByLabel('custom-end-date').fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  // Transaction row should be visible on both mobile and desktop
  await expect(page.getByText('Salário Janeiro')).toBeVisible({ timeout: 5000 })
})

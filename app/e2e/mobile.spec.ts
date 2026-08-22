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
  await page.getByLabel('custom-start-date', { exact: true }).fill('2024-01-01')
  await page.getByLabel('custom-end-date', { exact: true }).fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  // Transaction row should be visible on both mobile and desktop
  await expect(page.getByText('Salário Janeiro')).toBeVisible({ timeout: 5000 })
})

// ─── Settings — mobile section list (MB-16) ───────────────────────────────────

test('settings mobile: list → section → back, and browser back also returns to the list', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The section-list screen only replaces the desktop sidebar on mobile')

  await seedSqlite(page, dataFile)
  await page.goto('/settings')
  await expect(page).toHaveURL(/\/settings$/)

  // Bare /settings shows the section list, not any section's content — the back link
  // (only rendered in the content pane) is a good proxy: absent until a section is open.
  await expect(page.getByRole('button', { name: 'Backup & Sync' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Voltar' })).not.toBeVisible()

  // Tapping a section navigates and shows its content + a back link.
  await page.getByRole('button', { name: 'Backup & Sync' }).click()
  await expect(page).toHaveURL(/\/settings\/backup$/)
  await expect(page.getByRole('link', { name: 'Voltar' })).toBeVisible()

  // The browser back button returns to the list, not out of Settings entirely.
  await page.goBack()
  await expect(page).toHaveURL(/\/settings$/)
  await expect(page.getByRole('button', { name: 'Backup & Sync' })).toBeVisible()

  // The in-app back link works too.
  await page.getByRole('button', { name: 'Backup & Sync' }).click()
  await expect(page).toHaveURL(/\/settings\/backup$/)
  await page.getByRole('link', { name: 'Voltar' }).click()
  await expect(page).toHaveURL(/\/settings$/)
})

// ─── Vault name menu — mobile-only entry point to Settings (MB-17) ────────────

test('vault menu: tapping the vault name pill opens a menu that links to Configurações', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'The vault pill only opens a menu below the sm breakpoint')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  const vaultPill = page.getByRole('button', { name: 'E2E User' })
  await vaultPill.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Configurações' }).click()

  await expect(page).toHaveURL(/\/settings$/)
  await expect(dialog).not.toBeVisible()
})

test('vault menu: tapping the vault name pill on desktop does not open a menu', async ({
  page,
  isMobile,
}) => {
  test.skip(!!isMobile, 'Desktop-only assertion — the gear icon already covers Settings there')

  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')

  await page.getByRole('button', { name: 'E2E User' }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

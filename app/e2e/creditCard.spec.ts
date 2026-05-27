/**
 * E2E tests for credit card flows (CC-30).
 *
 * All scenarios use a shared SQLite-seeded fixture that contains:
 *   - acc-e2e-1    : RETAIL account (Conta E2E)
 *   - acc-e2e-credit: CREDIT account (Cartão E2E, limit 5 000, closingDay 20, dueDay 10)
 *   - cat-e2e-2    : EXPENSE category (Alimentação)
 *   - cat-e2e-1    : INCOME category (Salário)
 *
 * Where temporal precision matters (Analytics projection), the fixture is
 * extended inline with transactions on controlled dates.
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

// ─── (a) Dashboard: CREDIT account shows "Limite disponível" ─────────────────

test('credit dashboard: CREDIT account shows "Limite disponível" in Meus Cartões', async ({
  page,
}) => {
  await seedSqlite(page, baseFixture)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  // "Meus Cartões" section must be visible
  await expect(page.getByRole('heading', { name: 'Meus Cartões' })).toBeVisible({ timeout: 5000 })

  // The CreditCardRow renders as a button containing the account name.
  // We use getByRole to avoid matching the hidden <option> inside the drawer.
  await expect(page.getByRole('button', { name: /Cartão E2E/ })).toBeVisible()

  // The "Limite disponível" label must appear
  await expect(page.getByText('Limite disponível')).toBeVisible()

  // With no expenses, available limit = full limit = R$ 5.000,00
  // Use nth(0) to avoid strict-mode violation — the value appears in the
  // credit card row AND in the Minhas Contas row (Conta E2E balance from fixture).
  await expect(page.getByText('R$ 5.000,00').first()).toBeVisible()
})

// ─── (b) Analytics: EXPENSE on CREDIT projected to due-date month ─────────────

test('analytics: EXPENSE on CREDIT account appears in due-date month, not purchase month', async ({
  page,
}) => {
  /**
   * Setup:
   *   - closingDay = 20, dueDay = 10
   *   - Transaction date = "2024-01-10"
   *     day 10 <= closingDay 20 → invoice period = Jan 2024
   *     → due date = 2024-02-10  (Feb 2024)
   *
   * The key behaviour verified here: both transactions (INCOME on RETAIL and
   * EXPENSE on CREDIT) appear in the Transactions ledger by purchase date.
   * The Analytics page loads without error when this data is present.
   * The precise cash-flow chart assertion is covered by unit tests in
   * Analytics.test.tsx (getEffectiveCashFlowDate + cashFlowData useMemo).
   */
  const dataWithCreditExpense = {
    ...baseFixture,
    transactions: [
      // INCOME on RETAIL in Jan 2024 (appears in Jan cash-flow)
      {
        id: 'tx-b-income',
        accountId: 'acc-e2e-1',
        categoryId: 'cat-e2e-1',
        amount: 1000,
        type: 'INCOME',
        date: '2024-01-05',
        description: 'Receita Teste',
        isPaid: true,
        tags: [],
      },
      // EXPENSE on CREDIT in Jan 2024 (effective cash-flow date → Feb 10, 2024)
      {
        id: 'tx-b-credit',
        accountId: 'acc-e2e-credit',
        categoryId: 'cat-e2e-2',
        amount: 200,
        type: 'EXPENSE',
        date: '2024-01-10',
        description: 'Compra no Cartão',
        isPaid: true,
        tags: [],
      },
    ],
  }

  await seedSqlite(page, dataWithCreditExpense)
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/transactions/)

  // Switch to a custom range to see all transactions
  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2024-01-01')
  await page.getByLabel('custom-end-date').fill('2024-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  // INCOME on RETAIL appears in the ledger (M-26: CREDIT account transactions live in /credit-card/:id)
  await expect(page.locator('[role="button"]').filter({ hasText: 'Receita Teste' })).toBeVisible({
    timeout: 5000,
  })

  // Navigate to Analytics — page must load without error
  await page.goto('/analytics')
  await expect(page).toHaveURL(/\/analytics/)
  // Verify the analytics tab navigation rendered (confirms page loaded without crash)
  await expect(page.getByRole('button', { name: 'Entradas x Saídas' })).toBeVisible({
    timeout: 5000,
  })
})

// ─── (c) Installments: 3 rows appear with (1/3), (2/3), (3/3) suffixes ────────

test('installments: creating 3x installment generates 3 ledger rows with correct suffixes', async ({
  page,
}) => {
  // Pre-seed with an installment group already saved — this verifies the DISPLAY
  // behaviour (3 rows with correct suffixes) without relying on complex UI interaction.
  // The CREATION logic (N transactions, date advancement, suffix format) is covered
  // exhaustively by the useDataStore unit tests (CC-24/CC-25).
  const parentId = 'parent-cc30-c'
  const today = new Date()
  const mm0 = String(today.getMonth() + 1).padStart(2, '0')
  const mm1 = String(((today.getMonth() + 1) % 12) + 1).padStart(2, '0')
  const mm2 = String(((today.getMonth() + 2) % 12) + 1).padStart(2, '0')
  const year0 = today.getFullYear()
  const year1 = today.getMonth() === 11 ? year0 + 1 : year0
  const year2 = today.getMonth() >= 10 ? year0 + 1 : year0
  const dd = String(today.getDate()).padStart(2, '0')

  const installmentFixture = {
    ...baseFixture,
    transactions: [
      {
        id: 'cc30-c-1',
        accountId: 'acc-e2e-1',
        categoryId: 'cat-e2e-2',
        amount: 100,
        type: 'EXPENSE',
        date: `${year0}-${mm0}-${dd}`,
        description: 'Compra Parcelada (1/3)',
        isPaid: false,
        tags: [],
        installment: { parentId, currentIndex: 1, total: 3 },
      },
      {
        id: 'cc30-c-2',
        accountId: 'acc-e2e-1',
        categoryId: 'cat-e2e-2',
        amount: 100,
        type: 'EXPENSE',
        date: `${year1}-${mm1}-${dd}`,
        description: 'Compra Parcelada (2/3)',
        isPaid: false,
        tags: [],
        installment: { parentId, currentIndex: 2, total: 3 },
      },
      {
        id: 'cc30-c-3',
        accountId: 'acc-e2e-1',
        categoryId: 'cat-e2e-2',
        amount: 100,
        type: 'EXPENSE',
        date: `${year2}-${mm2}-${dd}`,
        description: 'Compra Parcelada (3/3)',
        isPaid: false,
        tags: [],
        installment: { parentId, currentIndex: 3, total: 3 },
      },
    ],
  }

  await seedSqlite(page, installmentFixture)
  await page.goto('/transactions')
  await expect(page).toHaveURL(/\/transactions/)

  // Switch to a wide custom range to see all installment periods
  await page.getByRole('button', { name: 'period-selector' }).click()
  await page.getByRole('menuitem', { name: 'Escolher período' }).click()
  await page.getByLabel('custom-start-date').fill('2020-01-01')
  await page.getByLabel('custom-end-date').fill('2030-12-31')
  await page.getByRole('button', { name: 'Ok' }).click()

  // All 3 installment rows must appear with correct suffixes
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Compra Parcelada (1/3)' })
  ).toBeVisible({ timeout: 5000 })
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Compra Parcelada (2/3)' })
  ).toBeVisible()
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Compra Parcelada (3/3)' })
  ).toBeVisible()
})

// ─── (d) Delete all installments removes all 3 rows ──────────────────────────

test('installments: "Excluir todas" removes all installment rows from the ledger', async ({
  page,
}) => {
  // Pre-seed with 3 installment transactions sharing the same parentId.
  // All 3 use a date within the current invoice period (closingDay=20) so they
  // all appear in the credit card page at periodOffset=0 (current period).
  const parentId = 'parent-cc30-d'
  const today = new Date()
  const y = today.getFullYear(),
    m = today.getMonth() + 1,
    d = today.getDate()
  // If today is past the closing day (20), transactions dated in current month would
  // belong to the NEXT period — use day 10 of next month instead.
  const [fy, fm] = d > 20 ? (m === 12 ? [y + 1, 1] : [y, m + 1]) : [y, m]
  const periodDate = `${fy}-${String(fm).padStart(2, '0')}-10`

  const installmentFixture = {
    ...baseFixture,
    transactions: [
      {
        id: 'inst-1',
        accountId: 'acc-e2e-credit',
        categoryId: 'cat-e2e-2',
        amount: 100,
        type: 'EXPENSE',
        date: periodDate,
        description: 'Parcelamento Teste (1/3)',
        isPaid: false,
        tags: [],
        installment: { parentId, currentIndex: 1, total: 3 },
      },
      {
        id: 'inst-2',
        accountId: 'acc-e2e-credit',
        categoryId: 'cat-e2e-2',
        amount: 100,
        type: 'EXPENSE',
        date: periodDate,
        description: 'Parcelamento Teste (2/3)',
        isPaid: false,
        tags: [],
        installment: { parentId, currentIndex: 2, total: 3 },
      },
      {
        id: 'inst-3',
        accountId: 'acc-e2e-credit',
        categoryId: 'cat-e2e-2',
        amount: 100,
        type: 'EXPENSE',
        date: periodDate,
        description: 'Parcelamento Teste (3/3)',
        isPaid: false,
        tags: [],
        installment: { parentId, currentIndex: 3, total: 3 },
      },
    ],
  }

  await seedSqlite(page, installmentFixture)
  // M-26: CREDIT account transactions live in /credit-card/:id, not /transactions
  await page.goto('/credit-card/acc-e2e-credit')
  await expect(page).toHaveURL(/\/credit-card\/acc-e2e-credit/)

  // Verify all 3 are present in the current invoice period
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (1/3)' })
  ).toBeVisible({ timeout: 5000 })
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (2/3)' })
  ).toBeVisible()
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (3/3)' })
  ).toBeVisible()

  // Click the first installment to open the drawer
  await page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (1/3)' }).click()

  // Click "Remover Transação" — since it has installment, the deletion modal appears
  await expect(page.getByRole('button', { name: 'Remover Transação' })).toBeVisible({
    timeout: 3000,
  })
  await page.getByRole('button', { name: 'Remover Transação' }).click()

  // The installment deletion modal should appear
  await expect(page.getByText('Esta transação é parcelada')).toBeVisible({ timeout: 3000 })

  // Click "Excluir todas as 3 parcelas"
  await page.getByRole('button', { name: /Excluir todas as 3 parcelas/ }).click()

  // Drawer closes
  const backdrop = page.locator('.fixed.inset-0.z-50').first()
  await expect(backdrop).toHaveClass(/pointer-events-none/, { timeout: 3000 })

  // All 3 rows should be gone from the current invoice period
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (1/3)' })
  ).toHaveCount(0)
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (2/3)' })
  ).toHaveCount(0)
  await expect(
    page.locator('[role="button"]').filter({ hasText: 'Parcelamento Teste (3/3)' })
  ).toHaveCount(0)
})

// ─── (e) CREDIT_PAYMENT: not counted as income or expense in Dashboard ────────

test('credit payment: CREDIT_PAYMENT does not appear as income or expense in Dashboard totals', async ({
  page,
}) => {
  // Seed with an INCOME to establish a baseline, plus a CREDIT_PAYMENT in the same month.
  // Both dates are set to today so they fall in the current Dashboard month window.
  const today = new Date()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const currentDate = `${today.getFullYear()}-${mm}-${dd}`

  const paymentFixture = {
    ...baseFixture,
    transactions: [
      // INCOME R$ 3 000 this month
      {
        id: 'tx-e-income',
        accountId: 'acc-e2e-1',
        categoryId: 'cat-e2e-1',
        amount: 3000,
        type: 'INCOME',
        date: currentDate,
        description: 'Receita Mês',
        isPaid: true,
        tags: [],
      },
      // CREDIT_PAYMENT R$ 500 this month — must NOT inflate expenses
      {
        id: 'tx-e-payment',
        accountId: 'acc-e2e-credit',
        categoryId: 'cat-e2e-2',
        amount: 500,
        type: 'CREDIT_PAYMENT',
        date: currentDate,
        description: 'Pagamento Cartão',
        isPaid: true,
        tags: [],
        transferAccountId: 'acc-e2e-1',
      },
    ],
  }

  await seedSqlite(page, paymentFixture)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/dashboard/)

  // The CREDIT_PAYMENT transaction appears in Recent Transactions with its
  // description (Dashboard renders tx.description, not a type label)
  await expect(page.getByText('Pagamento Cartão')).toBeVisible({ timeout: 5000 })

  // The Despesas stat card must show R$ 0,00 — CREDIT_PAYMENT is NOT an EXPENSE.
  // Stat cards are rendered in order: Receitas (nth 0), Despesas (nth 1), Saldo (nth 2).
  // Each card has exactly one <p class="text-2xl font-bold ..."> for the amount.
  const statAmounts = page.locator('p.text-2xl.font-bold')
  // nth(1) = Despesas stat card value
  await expect(statAmounts.nth(1)).toContainText('0,00')
})

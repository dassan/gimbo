import { test, expect } from '@playwright/test'
import { fileURLToPath } from 'url'
import { readFileSync } from 'fs'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── Setup ────────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
  })
})

// ─── New profile flow ─────────────────────────────────────────────────────────

test('new profile: fills name and navigates to dashboard', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/onboarding/)

  await page.getByPlaceholder('Ex: Arthur Dent').fill('Test User')
  await page.getByRole('button', { name: 'Criar Cofre de Dados' }).click()

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })
})

// ─── Import flow (drag-and-drop / file input) ─────────────────────────────────

test('import JSON: uploads fixture file and navigates to dashboard', async ({ page }) => {
  await page.goto('/onboarding')

  await page.getByRole('button', { name: 'Importar Dados' }).click()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.locator('input[type="file"]').dispatchEvent('click')
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles(path.join(__dirname, 'fixtures/dataFile.json'))

  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })
})

test('import JSON: invalid file shows error and stays on onboarding', async ({ page }) => {
  await page.goto('/onboarding')
  await page.getByRole('button', { name: 'Importar Dados' }).click()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.locator('input[type="file"]').dispatchEvent('click')
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{ not valid json !!!'),
  })

  await expect(page).toHaveURL(/\/onboarding/)
  await expect(page.getByText('Arquivo inválido ou corrompido.')).toBeVisible({ timeout: 3000 })
})

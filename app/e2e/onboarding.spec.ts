import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataFile = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/dataFile.json'), 'utf-8')
) as Record<string, unknown>

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

test('import backup: uploads exported .db file and navigates to dashboard', async ({ page }) => {
  // Seed a session with fixture data, then export it as a SQLite backup (.db)
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  await page.evaluate((d) => {
    return (window as Record<string, unknown>).__storage.replaceAll(d)
  }, dataFile)

  const base64 = await page.evaluate(async () => {
    const blob: Blob = await (window as Record<string, unknown>).__storage.exportBlob()
    const buffer = await blob.arrayBuffer()
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
    }
    return btoa(binary)
  })

  await page.goto('/onboarding')
  await page.getByRole('button', { name: 'Importar Dados' }).click()

  const fileChooserPromise = page.waitForEvent('filechooser')
  await page.locator('input[type="file"]').dispatchEvent('click')
  const fileChooser = await fileChooserPromise
  await fileChooser.setFiles({
    name: 'gimbo-backup.db',
    mimeType: 'application/x-sqlite3',
    buffer: Buffer.from(base64, 'base64'),
  })

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

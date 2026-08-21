import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dataFile = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/dataFile.json'), 'utf-8')
) as Record<string, unknown>

// M-71 — painel de performance dev-only (lib/perfMonitor.ts, components/PerfPanel.tsx).
// A ausência total no build de produção já é verificada manualmente via
// `grep gimbo:perfMonitor dist/assets/*.js` (documentado em plan/MONITORING.md); este spec só
// cobre o comportamento visível em dev, que é o que o webServer deste projeto roda (`npm run dev`).

async function seedSqlite(page: import('@playwright/test').Page, data: Record<string, unknown>) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  await page.evaluate(() => localStorage.removeItem('gimbo:perfMonitor'))
  await page.evaluate((d) => {
    return (window as Record<string, unknown>).__storage.replaceAll(d)
  }, data)
}

test('Alt+Shift+P liga e desliga o painel de performance', async ({ page }) => {
  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Nova Transação' }).waitFor({ state: 'visible' })

  await expect(page.getByText('Perf Monitor')).not.toBeVisible()

  await page.keyboard.press('Alt+Shift+P')
  await expect(page.getByText('Perf Monitor')).toBeVisible()

  await page.keyboard.press('Alt+Shift+P')
  await expect(page.getByText('Perf Monitor')).not.toBeVisible()
})

// @desktop-only — o painel (w-96, fixed bottom-6 left-6) cobre o botão "+" da bottom nav em
// viewports mobile, deixando o clique inalcançável. É ferramenta de dev usada no desktop, onde o
// bug de PERFORMANCE.md foi reportado — não vale redesenhar o posicionamento para mobile agora.
test('salvar uma transação registra métricas de mutate/postMessage no painel @desktop-only', async ({
  page,
}) => {
  await seedSqlite(page, dataFile)
  await page.goto('/dashboard')
  await page.getByRole('button', { name: 'Nova Transação' }).waitFor({ state: 'visible' })
  await page.keyboard.press('Alt+Shift+P')
  await expect(page.getByText('Perf Monitor')).toBeVisible()

  await page.getByRole('button', { name: 'Nova Transação' }).click()
  const amountInput = page.locator('input[placeholder="0,00"]')
  await amountInput.waitFor({ state: 'visible', timeout: 5000 })
  await amountInput.fill('1000')
  await page.getByRole('button', { name: 'Salvar Despesa' }).click()

  await expect(page.getByRole('cell', { name: 'store.mutate.clone' })).toBeVisible({
    timeout: 5000,
  })
  await expect(page.getByRole('cell', { name: /storage\.postMessage\.replaceAll/ })).toBeVisible()
})

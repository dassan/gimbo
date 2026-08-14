import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear()
  })
})

test('no local vault yet: root URL shows the landing page', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL('/')
  await expect(page.getByRole('heading', { name: /Organize seu dinheiro/ })).toBeVisible()

  await page
    .getByRole('link', { name: 'Criar Cofre de Dados' })
    .click()
  await expect(page).toHaveURL(/\/onboarding/)
})

test('existing local vault: root URL redirects straight to the dashboard', async ({ page }) => {
  await page.goto('/onboarding')
  await page.getByRole('button', { name: 'Entendi, vamos começar' }).click()
  await page.getByPlaceholder('Ex: Arthur Dent').fill('Test User')
  await page.getByRole('button', { name: 'Criar Cofre de Dados' }).click()
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })

  await page.goto('/')
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 5000 })
})

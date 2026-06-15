import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'https://localhost:5173',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry',
  },
  projects: [
    // Desktop — runs all specs
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },

    // Mobile Chrome (Pixel 5, 393 × 851 px, isMobile: true).
    // Uses the same Chromium install — no extra browser download needed.
    // Tests tagged @desktop-only are excluded: they assert on sections that are
    // intentionally hidden on mobile (Meus Cartões, Recent Transactions on dashboard).
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
      grepInvert: /@desktop-only/,
    },
  ],
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI,
  },
})

import { StorageService } from './StorageService'

export const storage = new StorageService()

// Expose the storage singleton on window in dev mode so Playwright E2E tests
// can call `window.__storage.replaceAll(data)` to seed SQLite before each test.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__storage = storage
}

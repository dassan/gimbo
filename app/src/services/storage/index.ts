import { StorageService } from './StorageService'
import { mergeForSync } from '@/lib/cloudSync/merge'
import { diffTransactions } from '@/lib/storage/transactionDiff'

export const storage = new StorageService()

// Expose the storage singleton on window in dev mode so Playwright E2E tests
// can call `window.__storage.replaceAll(data)` to seed SQLite before each test.
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).__storage = storage
  // CS-30: exposes the pure sync merge/diff functions (already bundled regardless — both are
  // used by syncService.ts/folderSyncService.ts/useDataStore.ts in production, so this adds no
  // new code to the prod bundle, only this assignment, which DEV-gating strips same as
  // __storage above) so e2e specs can build a realistic merged DataFile + delta exactly the way
  // the real sync write-path does, instead of duplicating that logic in the spec file.
  ;(window as unknown as Record<string, unknown>).__syncTest = { mergeForSync, diffTransactions }
}

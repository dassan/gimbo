import { test, expect, type Page } from '@playwright/test'

// CS-30 (Fase 1) — pullAndMergeInner/syncFromPeers trocaram replaceAll() por applyMutation()
// alimentado por um diff calculado a partir do resultado de mergeForSync(). Diferente de
// mutationDelta.spec.ts (M-73, que exercita o caminho de mutação via UI), este spec exercita
// exatamente a combinação nova: merge de sync -> diff -> applyMutation, sem UI no meio — a mesma
// sequência que syncService.ts/folderSyncService.ts realmente fazem. Usa window.__syncTest
// (dev-only, services/storage/index.ts) para rodar mergeForSync()/diffTransactions() de verdade,
// em vez de duplicar essa lógica aqui.

const fixture = {
  schemaVersion: 4,
  user: {
    name: 'E2E Sync',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  settings: {
    fileCreatedAt: '2024-01-01T00:00:00.000Z',
    fileUpdatedAt: '2024-01-01T00:00:00.000Z',
    auditLogRetentionLimit: 200,
    quadrantesEnabled: false,
    quadrantesInferFromHistory: false,
  },
  accounts: [
    { id: 'acc-sync-1', name: 'Conta Sync', type: 'RETAIL', balance: 1000, includeInBalance: true },
  ],
  categories: [
    {
      id: 'cat-sync-1',
      parentId: null,
      name: 'Categoria Sync',
      icon: 'circle',
      color: '#888888',
      type: 'EXPENSE',
    },
  ],
  tags: [],
  budgets: [],
  devices: [],
  hypotheses: [],
  valuations: [],
  transactions: [
    {
      id: 'tx-local-only',
      accountId: 'acc-sync-1',
      categoryId: 'cat-sync-1',
      amount: 10,
      type: 'EXPENSE',
      date: '2026-01-10',
      description: 'Só local',
      isPaid: true,
      tags: [],
      updatedAt: '2026-01-10T00:00:00.000Z',
    },
    {
      id: 'tx-tombstoned-by-remote',
      accountId: 'acc-sync-1',
      categoryId: 'cat-sync-1',
      amount: 20,
      type: 'EXPENSE',
      date: '2026-01-11',
      description: 'Remoto vai apagar essa',
      isPaid: true,
      tags: [],
      updatedAt: '2026-01-11T00:00:00.000Z',
    },
    {
      id: 'tx-lww-conflict',
      accountId: 'acc-sync-1',
      categoryId: 'cat-sync-1',
      amount: 30,
      type: 'EXPENSE',
      date: '2026-01-12',
      description: 'Versão local (mais antiga)',
      isPaid: true,
      tags: [],
      updatedAt: '2026-01-12T00:00:00.000Z',
    },
  ],
  auditLog: [],
  deletedIds: [],
  savedPeriods: [],
}

async function seedSqlite(page: Page, data: unknown) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  await page.evaluate((d) => {
    return (window as Record<string, unknown>).__storage.replaceAll(d)
  }, data)
}

async function queryOne<T>(page: Page, sql: string, params: unknown[] = []): Promise<T> {
  return page.evaluate(
    async ([q, p]) => {
      const rows = await (window as Record<string, unknown>).__storage.query(q, p)
      return rows[0]
    },
    [sql, params] as const
  ) as Promise<T>
}

test.beforeEach(async ({ page }) => {
  await seedSqlite(page, fixture)
})

test('merge de sync -> diff -> applyMutation() preserva linhas intocadas, aplica tombstone e resolve conflito LWW', async ({
  page,
}) => {
  // Um "remoto" sintético: não tem a transação local-only (nunca a viu), tem uma tombstone pra
  // tx-tombstoned-by-remote, e uma versão mais nova de tx-lww-conflict.
  const remote = {
    ...fixture,
    transactions: [
      {
        ...fixture.transactions[2],
        amount: 999,
        description: 'Versão remota (mais nova)',
        updatedAt: '2026-06-01T00:00:00.000Z',
      },
    ],
    deletedIds: ['tx-tombstoned-by-remote'],
  }

  await page.evaluate(async (remoteData) => {
    const w = window as unknown as {
      __storage: {
        loadDataFile(): Promise<unknown>
        applyMutation(d: unknown, delta: unknown): Promise<void>
      }
      __syncTest: {
        mergeForSync(local: unknown, remote: unknown): { transactions: { id: string }[] }
        diffTransactions(before: unknown[], after: unknown[]): unknown
      }
    }
    const local = (await w.__storage.loadDataFile()) as { transactions: unknown[] }
    const merged = w.__syncTest.mergeForSync(local, remoteData)
    const delta = w.__syncTest.diffTransactions(local.transactions, merged.transactions)
    await w.__storage.applyMutation(merged, delta)
  }, remote)

  await page.reload()
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)

  // Linha só local: o "remoto" nunca a mencionou — sobrevive intacta.
  const localOnly = await queryOne<{ amount: number } | undefined>(
    page,
    "SELECT amount FROM transactions WHERE id = 'tx-local-only'"
  )
  expect(localOnly?.amount).toBe(10)

  // Tombstone do remoto: a linha some.
  const tombstoned = await queryOne<Record<string, unknown> | undefined>(
    page,
    "SELECT id FROM transactions WHERE id = 'tx-tombstoned-by-remote'"
  )
  expect(tombstoned).toBeUndefined()

  // Conflito LWW: o remoto tinha updatedAt mais novo, vence.
  const lww = await queryOne<{ amount: number; description: string }>(
    page,
    "SELECT amount, description FROM transactions WHERE id = 'tx-lww-conflict'"
  )
  expect(lww.amount).toBe(999)
  expect(lww.description).toBe('Versão remota (mais nova)')
})

import { test, expect, type Page } from '@playwright/test'

// CS-30/CS-31 (Fase 2a) — table_hashes (migrations/v16.sql) precisa ser mantida corretamente por
// writeSmallTables()/replaceAll()/applyTransactionDelta() dentro do worker real (wa-sqlite/OPFS),
// não reproduzível em vitest/jsdom — mesma limitação já documentada pro M-72/M-73/CS-26/CS-28.
// Esta é a única cobertura automatizada desta camada antes de qualquer leitura seletiva (Fase 2b)
// passar a confiar nela.

const fixture = {
  schemaVersion: 4,
  user: {
    name: 'E2E Hash',
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
    { id: 'acc-hash-1', name: 'Conta Hash', type: 'RETAIL', balance: 1000, includeInBalance: true },
  ],
  categories: [
    {
      id: 'cat-hash-1',
      parentId: null,
      name: 'Categoria Hash',
      icon: 'circle',
      color: '#888888',
      type: 'EXPENSE',
    },
  ],
  tags: [],
  budgets: [],
  valuations: [],
  transactions: [
    {
      id: 'tx-2025-a',
      accountId: 'acc-hash-1',
      categoryId: 'cat-hash-1',
      amount: 10,
      type: 'EXPENSE',
      date: '2025-06-01',
      description: '2025 A',
      isPaid: true,
      tags: [],
      updatedAt: '2025-06-01T00:00:00.000Z',
    },
    {
      id: 'tx-2025-b',
      accountId: 'acc-hash-1',
      categoryId: 'cat-hash-1',
      amount: 20,
      type: 'EXPENSE',
      date: '2025-07-01',
      description: '2025 B',
      isPaid: true,
      tags: [],
      updatedAt: '2025-07-01T00:00:00.000Z',
    },
    {
      id: 'tx-2026-a',
      accountId: 'acc-hash-1',
      categoryId: 'cat-hash-1',
      amount: 30,
      type: 'EXPENSE',
      date: '2026-01-01',
      description: '2026 A',
      isPaid: true,
      tags: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
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

type HashRow = { table_name: string; partition_key: string; hash_value: number; row_count: number }

async function getTableHashes(page: Page): Promise<HashRow[]> {
  return page.evaluate(async () => {
    return (window as Record<string, unknown>).__storage.query(
      'SELECT table_name, partition_key, hash_value, row_count FROM table_hashes ORDER BY table_name, partition_key'
    )
  }) as Promise<HashRow[]>
}

function findHash(hashes: HashRow[], tableName: string, partitionKey = ''): HashRow | undefined {
  return hashes.find((h) => h.table_name === tableName && h.partition_key === partitionKey)
}

test.beforeEach(async ({ page }) => {
  await seedSqlite(page, fixture)
})

test('replaceAll() popula uma linha de hash por tabela pequena e uma por ano de transação', async ({
  page,
}) => {
  const hashes = await getTableHashes(page)

  for (const table of [
    'accounts',
    'categories',
    'tags',
    'budgets',
    'valuations',
    'saved_periods',
    'audit_log',
    'deleted_ids',
  ]) {
    const row = findHash(hashes, table)
    expect(row, `missing hash row for ${table}`).toBeDefined()
  }

  const year2025 = findHash(hashes, 'transactions', '2025')
  const year2026 = findHash(hashes, 'transactions', '2026')
  expect(year2025?.row_count).toBe(2)
  expect(year2026?.row_count).toBe(1)
  expect(year2025?.hash_value).not.toBe(year2026?.hash_value)
})

test('editar uma transação de 2026 via applyMutation muda só o hash de 2026', async ({ page }) => {
  const before = await getTableHashes(page)
  const before2025 = findHash(before, 'transactions', '2025')
  const before2026 = findHash(before, 'transactions', '2026')
  const beforeAccounts = findHash(before, 'accounts')

  await page.evaluate(async () => {
    const w = window as unknown as {
      __storage: {
        loadDataFile(): Promise<{ transactions: { id: string }[] }>
        applyMutation(d: unknown, delta: unknown): Promise<void>
      }
      __syncTest: { diffTransactions(before: unknown[], after: unknown[]): unknown }
    }
    const data = (await w.__storage.loadDataFile()) as {
      transactions: { id: string; amount: number }[]
    }
    const before = data.transactions
    const after = data.transactions.map((t) => (t.id === 'tx-2026-a' ? { ...t, amount: 999 } : t))
    const delta = w.__syncTest.diffTransactions(before, after)
    await w.__storage.applyMutation({ ...data, transactions: after }, delta)
  })

  const after = await getTableHashes(page)
  const after2025 = findHash(after, 'transactions', '2025')
  const after2026 = findHash(after, 'transactions', '2026')
  const afterAccounts = findHash(after, 'accounts')

  expect(after2025?.hash_value).toBe(before2025?.hash_value)
  expect(after2025?.row_count).toBe(before2025?.row_count)
  expect(after2026?.hash_value).not.toBe(before2026?.hash_value)
  expect(after2026?.row_count).toBe(before2026?.row_count) // update, não add/remove
  // Tabelas pequenas não tocadas por esta mutação: hash idêntico.
  expect(afterAccounts?.hash_value).toBe(beforeAccounts?.hash_value)
})

test('mover uma transação de 2025 pra 2026 (editar a data) muda os dois hashes de ano', async ({
  page,
}) => {
  const before = await getTableHashes(page)
  const before2025 = findHash(before, 'transactions', '2025')
  const before2026 = findHash(before, 'transactions', '2026')

  await page.evaluate(async () => {
    const w = window as unknown as {
      __storage: {
        loadDataFile(): Promise<{ transactions: { id: string; date: string }[] }>
        applyMutation(d: unknown, delta: unknown): Promise<void>
      }
      __syncTest: { diffTransactions(before: unknown[], after: unknown[]): unknown }
    }
    const data = (await w.__storage.loadDataFile()) as {
      transactions: { id: string; date: string }[]
    }
    const before = data.transactions
    const after = data.transactions.map((t) =>
      t.id === 'tx-2025-a' ? { ...t, date: '2026-03-01' } : t
    )
    const delta = w.__syncTest.diffTransactions(before, after)
    await w.__storage.applyMutation({ ...data, transactions: after }, delta)
  })

  const after = await getTableHashes(page)
  const after2025 = findHash(after, 'transactions', '2025')
  const after2026 = findHash(after, 'transactions', '2026')

  expect(after2025?.row_count).toBe((before2025?.row_count ?? 0) - 1)
  expect(after2026?.row_count).toBe((before2026?.row_count ?? 0) + 1)
  expect(after2025?.hash_value).not.toBe(before2025?.hash_value)
  expect(after2026?.hash_value).not.toBe(before2026?.hash_value)
})

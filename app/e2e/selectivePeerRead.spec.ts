import { test, expect, type Page, type BrowserContext } from '@playwright/test'

// CS-30/CS-31/CS-32 (Fase 2b) — readDataFileFromDbSelective()/readForeignDataFile() compara
// table_hashes antes de ler qualquer tabela do peer, pulando as que baterem hash com o local.
// Esta é a única cobertura automatizada desse caminho novo — sem ela, um bug de comparação de
// hash aqui poderia descartar silenciosamente dados legítimos de um peer (a classe de bug mais
// grave possível: pior que o "sync previsivelmente lento" que motivou toda a Fase 2). Usa dois
// contextos de browser (dois "dispositivos" reais, cada um com seu próprio OPFS) pra gerar um
// peer de verdade, com hashes de verdade — não um mock.

const sharedAccounts = [
  {
    id: 'acc-shared',
    name: 'Conta Compartilhada',
    type: 'RETAIL',
    balance: 100,
    includeInBalance: true,
  },
]
const sharedCategories = [
  {
    id: 'cat-shared',
    parentId: null,
    name: 'Categoria Compartilhada',
    icon: 'circle',
    color: '#888',
    type: 'EXPENSE',
  },
]
// Idêntica nos dois lados — a tabela accounts/categories deve bater por hash e nunca aparecer no
// resultado de readPeerBlob().
const sharedTx2026 = {
  id: 'tx-shared-2026',
  accountId: 'acc-shared',
  categoryId: 'cat-shared',
  amount: 50,
  type: 'EXPENSE',
  date: '2026-01-01',
  description: 'Compartilhada 2026',
  isPaid: true,
  tags: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function baseFixture(extraTransactions: unknown[]) {
  return {
    schemaVersion: 4,
    user: {
      name: 'E2E Selective',
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
    accounts: sharedAccounts,
    categories: sharedCategories,
    tags: [],
    budgets: [],
    valuations: [],
    transactions: [sharedTx2026, ...extraTransactions],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
  }
}

async function seedAndGetBlobBase64(page: Page, data: unknown): Promise<string> {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  return page.evaluate(async (d) => {
    const storage = (window as Record<string, unknown>).__storage as {
      replaceAll(data: unknown): Promise<void>
      exportBlob(): Promise<Blob>
    }
    await storage.replaceAll(d)
    const blob = await storage.exportBlob()
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }, data)
}

test('readPeerBlob() pula tabelas/anos que batem hash e só traz o que de fato diverge', async ({
  page,
  browser,
}) => {
  // "Local": conta/categoria compartilhadas + a transação de 2026 compartilhada + uma transação
  // só local em 2025 (o peer nunca viu esse ano — não deve aparecer em lugar nenhum do resultado).
  await seedAndGetBlobBase64(
    page,
    baseFixture([
      {
        id: 'tx-local-2025',
        accountId: 'acc-shared',
        categoryId: 'cat-shared',
        amount: 10,
        type: 'EXPENSE',
        date: '2025-06-01',
        description: 'Só local 2025',
        isPaid: true,
        tags: [],
        updatedAt: '2025-06-01T00:00:00.000Z',
      },
    ])
  )

  // "Peer": mesma conta/categoria/tx-2026 (deve bater hash), mas uma transação extra em 2027 que
  // o local nunca viu (deve divergir e ser lida).
  const peerContext: BrowserContext = await browser.newContext()
  const peerPage = await peerContext.newPage()
  const peerBlobBase64 = await seedAndGetBlobBase64(
    peerPage,
    baseFixture([
      {
        id: 'tx-peer-2027',
        accountId: 'acc-shared',
        categoryId: 'cat-shared',
        amount: 20,
        type: 'EXPENSE',
        date: '2027-03-01',
        description: 'Só peer 2027',
        isPaid: true,
        tags: [],
        updatedAt: '2027-03-01T00:00:00.000Z',
      },
    ])
  )
  await peerContext.close()

  const result = await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const storage = (window as Record<string, unknown>).__storage as {
      readPeerBlob(blob: Blob): Promise<
        | {
            status: 'ok'
            data: { accounts: unknown[]; categories: unknown[]; transactions: { id: string }[] }
          }
        | { status: 'skipped'; reason: string }
      >
    }
    return storage.readPeerBlob(new Blob([bytes], { type: 'application/x-sqlite3' }))
  }, peerBlobBase64)

  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return

  // Tabelas pequenas idênticas dos dois lados: hash bate, leitura pulada — vêm vazias.
  expect(result.data.accounts).toEqual([])
  expect(result.data.categories).toEqual([])

  // transactions: só o que diverge (2027, peer-only) volta. 2026 (idêntica) e 2025 (só local,
  // nunca existiu no peer) não aparecem.
  const ids = result.data.transactions.map((t) => t.id)
  expect(ids).toEqual(['tx-peer-2027'])
})

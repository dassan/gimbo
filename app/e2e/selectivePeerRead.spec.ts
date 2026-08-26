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

// Achado real ao validar a Fase 2b contra dado real (CS-34): `table_hashes` só é mantida
// *incrementalmente* (applyTransactionDelta só recomputa os anos que o delta tocou) — um cofre
// que existia antes desta feature nunca ganha hash pros anos que nunca mais foram editados, e
// hashesMatch() os trata como "sempre diverge" pra sempre, nunca entregando o ganho de
// velocidade. O teste acima não pegou isso porque semear via replaceAll() já popula os hashes
// como efeito colateral — este simula o cenário real: dado existente, table_hashes vazia (como um
// cofre pré-v16), reload (dispara o backfill em init()), e só então o teste de leitura seletiva.
test('backfillTableHashesIfNeeded() recupera um cofre com table_hashes vazia (estilo pré-v16)', async ({
  page,
  browser,
}) => {
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

  // Simula um cofre que nunca passou por writeSmallTables/applyTransactionDelta/replaceAll desde
  // que table_hashes existe — apaga as linhas direto, sem tocar no dado de verdade. query() é
  // privado na classe TS, mas isso não existe em runtime — mesmo truque já usado nos specs
  // vizinhos (tableHashSync.spec.ts) pra ler table_hashes direto.
  await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query(sql: string): Promise<unknown[]>
    }
    await storage.query('DELETE FROM table_hashes')
  })

  const before = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query(sql: string): Promise<unknown[]>
    }
    return storage.query('SELECT COUNT(*) as n FROM table_hashes')
  })
  expect((before[0] as { n: number }).n).toBe(0)

  // Reload dispara init() -> runMigrationsOn (no-op, já em v16) -> backfillTableHashesIfNeeded,
  // que deve detectar a tabela vazia e recalcular a partir do conteúdo atual.
  await page.reload()
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)

  const after = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query(sql: string): Promise<{ table_name: string; partition_key: string }[]>
    }
    return storage.query('SELECT table_name, partition_key FROM table_hashes')
  })
  expect(after.length).toBeGreaterThan(0)
  expect(after.some((h) => h.table_name === 'transactions' && h.partition_key === '2025')).toBe(
    true
  )
  expect(after.some((h) => h.table_name === 'transactions' && h.partition_key === '2026')).toBe(
    true
  )

  // Agora o teste de verdade: com os hashes backfilled, um peer com o mesmo 2026 deve ser
  // reconhecido como igual (pulado) — a razão de ser desta correção.
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
      readPeerBlob(
        blob: Blob
      ): Promise<
        | { status: 'ok'; data: { transactions: { id: string }[] } }
        | { status: 'skipped'; reason: string }
      >
    }
    return storage.readPeerBlob(new Blob([bytes], { type: 'application/x-sqlite3' }))
  }, peerBlobBase64)

  expect(result.status).toBe('ok')
  if (result.status !== 'ok') return
  expect(result.data.transactions.map((t) => t.id)).toEqual(['tx-peer-2027'])
})

// CS-34 continuação: importDb() reabre `db` fora do caminho de boot de init() — sem um backfill
// próprio ali, um .db importado sem table_hashes (ex.: um backup antigo, de antes da v16) só
// ganharia o backfill no *próximo reload*, não neste mesmo carregamento — e a UI de import
// (handleImportDb em Settings/Onboarding) segue usando o cofre importado sem pedir reload.
test('importar um .db sem table_hashes já sai com os hashes populados, sem precisar de reload', async ({
  page,
}) => {
  await seedAndGetBlobBase64(page, baseFixture([]))

  // Simula um backup antigo: mesmo conteúdo, mas sem nenhuma linha de hash.
  const staleBlobBase64 = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query(sql: string): Promise<unknown[]>
      exportBlob(): Promise<Blob>
    }
    await storage.query('DELETE FROM table_hashes')
    const blob = await storage.exportBlob()
    const buffer = await blob.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  })

  // Reimporta esse "backup antigo" de volta, no mesmo carregamento de página — sem reload.
  await page.evaluate(async (base64) => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const storage = (window as Record<string, unknown>).__storage as {
      importBlob(blob: Blob): Promise<void>
    }
    await storage.importBlob(new Blob([bytes], { type: 'application/x-sqlite3' }))
  }, staleBlobBase64)

  const after = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query(sql: string): Promise<unknown[]>
    }
    return storage.query('SELECT COUNT(*) as n FROM table_hashes')
  })
  expect((after[0] as { n: number }).n).toBeGreaterThan(0)
})

import { test, expect, type Page } from '@playwright/test'

// CS-41 — superfície de leitura por partição do worker, contra wa-sqlite real.
//
// Estes leitores só existem dentro do worker, sobre a VFS do OPFS: nenhum deles roda em vitest.
// O que este spec protege, além de "a função devolve linhas", é a propriedade da qual o transporte
// particionado inteiro depende:
//
//   o hash que o publicador anuncia no manifesto (vindo de `table_hashes`) tem que ser exatamente
//   o hash das linhas que ele serializa naquela partição.
//
// Se as duas coisas divergirem, todo peer que baixar o arquivo vai reportar corrupção — ou pior,
// nunca vai conseguir pular a partição, porque o hash publicado jamais bate com o que o outro lado
// calcula do próprio banco. É onde a normalização `updatedAt ?? ts` do CS-32 é verificada de ponta
// a ponta, e nenhum teste unitário consegue cobrir isso (o `ts` vem do banco).

const fixture = {
  schemaVersion: 4,
  user: {
    name: 'Fábio',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  settings: {
    fileCreatedAt: '2026-01-01T00:00:00.000Z',
    fileUpdatedAt: '2026-01-02T00:00:00.000Z',
    auditLogRetentionLimit: 200,
  },
  accounts: [
    {
      id: 'acc-1',
      name: 'Conta Corrente',
      type: 'RETAIL',
      balance: 1000,
      includeInBalance: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'acc-2',
      name: 'Poupança',
      type: 'SAVINGS',
      balance: 5000,
      includeInBalance: true,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  categories: [
    {
      id: 'cat-1',
      name: 'Mercado',
      icon: 'cart',
      color: '#f00',
      type: 'EXPENSE',
      parentId: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  tags: [{ id: 'tag-1', name: 'Casa', color: '#0f0' }],
  transactions: [
    {
      id: 'tx-2025-a',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: 50,
      type: 'EXPENSE',
      date: '2025-06-10',
      description: 'Compra 2025',
      isPaid: true,
      tags: ['tag-1'],
      budgetIds: [],
      updatedAt: '2025-06-10T10:00:00.000Z',
      createdAt: '2025-06-10T09:00:00.000Z',
    },
    {
      id: 'tx-2026-a',
      accountId: 'acc-1',
      categoryId: 'cat-1',
      amount: 80,
      type: 'EXPENSE',
      date: '2026-03-15',
      description: 'Compra 2026',
      isPaid: true,
      tags: [],
      budgetIds: [],
      updatedAt: '2026-03-15T10:00:00.000Z',
      createdAt: '2026-03-15T09:00:00.000Z',
    },
    {
      id: 'tx-2026-b',
      accountId: 'acc-2',
      categoryId: 'cat-1',
      amount: 120,
      type: 'EXPENSE',
      date: '2026-07-20',
      description: 'Outra 2026',
      isPaid: false,
      tags: ['tag-1'],
      budgetIds: [],
      updatedAt: '2026-07-20T10:00:00.000Z',
      createdAt: '2026-07-20T09:00:00.000Z',
    },
  ],
  valuations: [],
  auditLog: [],
  deletedIds: [],
  savedPeriods: [],
  budgets: [],
}

type Win = Record<string, unknown>

async function seedSqlite(page: Page, data: unknown) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Win).__storage)
  await page.evaluate((d) => (window as Win).__storage.replaceAll(d), data)
}

test.beforeEach(async ({ page }) => {
  await seedSqlite(page, fixture)
})

test('CS-41: getSyncManifestBase devolve singletons e hashes, sem a sentinela __meta', async ({
  page,
}) => {
  const base = await page.evaluate(async () => (window as Win).__storage.getSyncManifestBase())

  expect(base.user.name).toBe('Fábio')
  expect(base.settings.fileUpdatedAt).toBe('2026-01-02T00:00:00.000Z')

  const keys = base.hashes.map((h: { key: string }) => h.key).sort()
  expect(keys).toContain('accounts:')
  expect(keys).toContain('transactions:2025')
  expect(keys).toContain('transactions:2026')
  // A sentinela do CS-39 é metadado do esquema de hash, não uma partição publicável.
  expect(keys.filter((k: string) => k.startsWith('__meta'))).toEqual([])
})

test('CS-41: readPartitions lê tabela pequena e ano de transações, sem vazar outros anos', async ({
  page,
}) => {
  const result = await page.evaluate(async () =>
    (window as Win).__storage.readPartitions(['accounts:', 'transactions:2026'])
  )

  expect(result['accounts:'].map((a: { id: string }) => a.id).sort()).toEqual(['acc-1', 'acc-2'])
  expect(result['transactions:2026'].map((t: { id: string }) => t.id).sort()).toEqual([
    'tx-2026-a',
    'tx-2026-b',
  ])
  // O ano pedido não pode arrastar o vizinho junto.
  expect(result['transactions:2026'].some((t: { id: string }) => t.id === 'tx-2025-a')).toBe(false)
})

test('CS-41: readPartitions preserva as tags da transação (junção vai junto da partição)', async ({
  page,
}) => {
  const result = await page.evaluate(async () =>
    (window as Win).__storage.readPartitions(['transactions:2026'])
  )

  const tagged = result['transactions:2026'].find((t: { id: string }) => t.id === 'tx-2026-b')
  expect(tagged.tags).toEqual(['tag-1'])
})

// A propriedade central. Se falhar, o transporte particionado publica manifestos que ninguém
// consegue casar — nem para pular, nem para verificar.
test('CS-41: o hash do manifesto bate com o hash das linhas que a partição serializa', async ({
  page,
}) => {
  const verdicts = await page.evaluate(async () => {
    const win = window as Win
    const base = await win.__storage.getSyncManifestBase()
    const keys = base.hashes
      .map((h: { key: string; count: number }) => h)
      .filter((h: { count: number }) => h.count > 0)

    const rowsByKey = await win.__storage.readPartitions(keys.map((h: { key: string }) => h.key))

    return keys.map((h: { key: string; hash: number; count: number }) => ({
      key: h.key,
      ok: win.__syncTest.partitions.verifyPartition(h.key, rowsByKey[h.key], {
        hash: h.hash,
        count: h.count,
      }),
    }))
  })

  expect(verdicts.length).toBeGreaterThan(0)
  for (const v of verdicts) {
    expect(v.ok, `hash do manifesto não bate com as linhas de ${v.key}`).toBe(true)
  }
})

test('CS-41: round-trip completo — publicar partições e remontar o DataFile do peer', async ({
  page,
}) => {
  const peer = await page.evaluate(async () => {
    const win = window as Win
    const { partitions } = win.__syncTest

    // Lado publicador: manifesto + partições codificadas, exatamente como o CS-45 fará.
    const base = await win.__storage.getSyncManifestBase()
    const localHashes = new Map(
      base.hashes.map((h: { key: string; hash: number; count: number }) => [
        h.key,
        { hash: h.hash, count: h.count },
      ])
    )
    const manifest = partitions.buildManifest({
      deviceId: 'device-a',
      user: base.user,
      settings: base.settings,
      localHashes,
      fileIdsByName: new Map(),
      publishedAt: new Date().toISOString(),
    })

    const keys = Object.keys(manifest.partitions)
    const rowsByKey = await win.__storage.readPartitions(keys)
    const wire = new Map()
    for (const key of keys) {
      const { bytes } = await partitions.encodePartition(rowsByKey[key])
      wire.set(key, bytes)
    }

    // Lado leitor: decodifica e remonta, como o CS-44 fará.
    const fetched = new Map()
    for (const [key, bytes] of wire) {
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
      fetched.set(key, await partitions.decodePartition(buffer, manifest.partitions[key].file))
    }

    const assembled = partitions.assemblePeerDataFile(manifest, fetched)
    return {
      accountIds: assembled.accounts.map((a: { id: string }) => a.id).sort(),
      txIds: assembled.transactions.map((t: { id: string }) => t.id).sort(),
      fileUpdatedAt: assembled.settings.fileUpdatedAt,
      taggedTx: assembled.transactions.find((t: { id: string }) => t.id === 'tx-2026-b'),
    }
  })

  expect(peer.accountIds).toEqual(['acc-1', 'acc-2'])
  // Os dois anos remontados juntos, sem um sobrescrever o outro.
  expect(peer.txIds).toEqual(['tx-2025-a', 'tx-2026-a', 'tx-2026-b'])
  expect(peer.fileUpdatedAt).toBe('2026-01-02T00:00:00.000Z')
  expect(peer.taggedTx.tags).toEqual(['tag-1'])
})

// CS-50 (A) — a leitura batelada, e em especial o caminho de leitura completa.
//
// Acima de 4 anos pedidos, `readPartitions` deixa de montar um `WHERE date LIKE ? OR …` e lê
// `transactions` inteiro, agrupando por ano em JS. É uma query estruturalmente diferente da usada
// para poucos anos, então precisa da própria cobertura: um erro de agrupamento aqui misturaria
// transações entre partições — e o hash da partição deixaria de bater para todos os peers.
test('CS-50: acima do limiar, a leitura completa agrupa por ano sem misturar partições', async ({
  page,
}) => {
  const years = ['2019', '2020', '2021', '2022', '2023', '2024']
  await seedSqlite(page, {
    ...fixture,
    transactions: years.map((year, i) => ({
      ...fixture.transactions[0],
      id: `tx-${year}`,
      date: `${year}-06-1${i}`,
      amount: 100 + i,
      tags: i % 2 === 0 ? ['tag-1'] : [],
      updatedAt: `${year}-06-10T10:00:00.000Z`,
      createdAt: `${year}-06-10T09:00:00.000Z`,
    })),
  })

  const result = await page.evaluate(
    async (keys) => (window as Win).__storage.readPartitions(keys),
    years.map((y) => `transactions:${y}`)
  )

  for (const year of years) {
    const rows = result[`transactions:${year}`]
    expect(rows, `partição de ${year}`).toHaveLength(1)
    expect(rows[0].id).toBe(`tx-${year}`)
  }
  // As tags da junção sobrevivem ao agrupamento em JS.
  expect(result['transactions:2019'][0].tags).toEqual(['tag-1'])
  expect(result['transactions:2020'][0].tags).toEqual([])
})

test('CS-50: pedir um subconjunto pela leitura completa não devolve os anos não pedidos', async ({
  page,
}) => {
  const years = ['2019', '2020', '2021', '2022', '2023', '2024']
  await seedSqlite(page, {
    ...fixture,
    transactions: years.map((year) => ({
      ...fixture.transactions[0],
      id: `tx-${year}`,
      date: `${year}-06-10`,
      tags: [],
      updatedAt: `${year}-06-10T10:00:00.000Z`,
      createdAt: `${year}-06-10T09:00:00.000Z`,
    })),
  })

  const asked = ['2019', '2020', '2021', '2022', '2023']
  const result = await page.evaluate(
    async (keys) => (window as Win).__storage.readPartitions(keys),
    asked.map((y) => `transactions:${y}`)
  )

  expect(Object.keys(result).sort()).toEqual(asked.map((y) => `transactions:${y}`).sort())
  expect(result['transactions:2024']).toBeUndefined()
})

// O hash do manifesto tem que continuar batendo quando as partições vêm da leitura completa —
// é a mesma propriedade do teste acima, agora exercitando o outro caminho de query.
test('CS-50: o hash do manifesto bate também no caminho de leitura completa', async ({ page }) => {
  const years = ['2019', '2020', '2021', '2022', '2023', '2024']
  await seedSqlite(page, {
    ...fixture,
    transactions: years.map((year, i) => ({
      ...fixture.transactions[0],
      id: `tx-${year}`,
      date: `${year}-06-10`,
      amount: 100 + i,
      tags: [],
      updatedAt: `${year}-06-10T10:00:00.000Z`,
      createdAt: `${year}-06-10T09:00:00.000Z`,
    })),
  })

  const verdicts = await page.evaluate(async () => {
    const win = window as Win
    const base = await win.__storage.getSyncManifestBase()
    const keys = base.hashes.filter((h: { count: number }) => h.count > 0)
    const rowsByKey = await win.__storage.readPartitions(keys.map((h: { key: string }) => h.key))
    return keys.map((h: { key: string; hash: number; count: number }) => ({
      key: h.key,
      ok: win.__syncTest.partitions.verifyPartition(h.key, rowsByKey[h.key], {
        hash: h.hash,
        count: h.count,
      }),
    }))
  })

  expect(verdicts.filter((v) => v.key.startsWith('transactions:')).length).toBe(6)
  for (const v of verdicts) expect(v.ok, `hash não bate em ${v.key}`).toBe(true)
})

// CS-51 — o filtro por ano tem que usar o índice, não varrer a tabela.
//
// `date LIKE '2026%'` parece um filtro de prefixo mas o plano real é `SCAN t`: a otimização de
// prefixo do SQLite não vale aqui porque `LIKE` é case-insensitive por padrão e o índice usa
// colação BINARY. Isso estava em dois caminhos quentes — o recálculo de hash por ano (a cada
// mutação) e a leitura de partição —, cada um varrendo as 26 mil linhas por ano tocado.
//
// Este teste falha se alguém voltar a escrever o filtro com LIKE. É barato e a diferença é
// invisível em qualquer asserção funcional: as duas formas devolvem exatamente as mesmas linhas.
test('CS-51: o filtro por ano usa o índice em vez de varrer a tabela', async ({ page }) => {
  const plans = await page.evaluate(async () => {
    const q = (sql: string, params: unknown[] = []) => (window as Win).__storage.query(sql, params)
    return {
      hashRefresh: await q(
        'EXPLAIN QUERY PLAN SELECT * FROM transactions WHERE date >= ? AND date < ?',
        ['2026-01-01', '2027-01-01']
      ),
      partitionRead: await q(
        'EXPLAIN QUERY PLAN SELECT t.* FROM transactions t WHERE (t.date >= ? AND t.date < ?) ORDER BY t.date DESC, t.created_at DESC',
        ['2026-01-01', '2027-01-01']
      ),
      // A forma antiga, para o teste documentar o porquê em vez de só afirmar o resultado.
      legacyLike: await q('EXPLAIN QUERY PLAN SELECT * FROM transactions WHERE date LIKE ?', [
        '2026%',
      ]),
    }
  })

  const detail = (rows: { detail: string }[]) => rows.map((r) => r.detail).join(' | ')
  expect(detail(plans.hashRefresh)).toContain('USING INDEX')
  expect(detail(plans.partitionRead)).toContain('USING INDEX')
  expect(detail(plans.legacyLike)).toContain('SCAN')
})

test('CS-51: o intervalo por ano devolve exatamente as mesmas linhas que o LIKE', async ({
  page,
}) => {
  await seedSqlite(page, {
    ...fixture,
    transactions: [
      { ...fixture.transactions[0], id: 'jan', date: '2026-01-01' },
      { ...fixture.transactions[0], id: 'dez', date: '2026-12-31' },
      { ...fixture.transactions[0], id: 'antes', date: '2025-12-31' },
      { ...fixture.transactions[0], id: 'depois', date: '2027-01-01' },
    ].map((t) => ({
      ...t,
      tags: [],
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
  })

  const rows = await page.evaluate(async () =>
    (window as Win).__storage.readPartitions(['transactions:2026'])
  )

  // As bordas do ano são o que um intervalo semiaberto pode errar: 01-01 entra, 12-31 entra,
  // e nem 2025-12-31 nem 2027-01-01 vazam.
  expect(rows['transactions:2026'].map((t: { id: string }) => t.id).sort()).toEqual(['dez', 'jan'])
})

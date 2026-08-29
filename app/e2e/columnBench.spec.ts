import { test, expect, type Page } from '@playwright/test'

// HY/Fase 0 — o benchmark de colunas (`lib/storage/columnBench.ts`) é uma ferramenta de medição
// disparada à mão contra o cofre real do mantenedor, num build de produção. O risco que este spec
// cobre não é o número que ela produz — é a consulta ficar errada e isso só aparecer minutos
// depois, no meio de uma coleta que leva minutos: uma coluna com nome trocado, um `SELECT *` que
// não traz 20 colunas, ou (o erro caro do CS-51) uma janela que não filtra o que promete.
//
// Roda contra o wa-sqlite de verdade, que é o único lugar onde isso pode ser verificado.

const year = new Date().getFullYear()
const IN_WINDOW = 6 // 3 no ano corrente + 3 no anterior
const OUT_OF_WINDOW = 4 // ano antigo, fora da janela de 2 anos

function tx(id: string, date: string) {
  return {
    id,
    accountId: 'acc-bench',
    categoryId: 'cat-bench',
    amount: 10,
    type: 'EXPENSE',
    date,
    description: `bench ${id}`,
    isPaid: true,
    tags: [],
  }
}

const fixture = {
  schemaVersion: 2,
  user: {
    name: 'E2E Bench',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  settings: {
    fileCreatedAt: '2024-01-01T00:00:00.000Z',
    fileUpdatedAt: '2024-01-01T00:00:00.000Z',
    auditLogRetentionLimit: 200,
  },
  accounts: [
    { id: 'acc-bench', name: 'Conta Bench', type: 'RETAIL', balance: 0, includeInBalance: true },
  ],
  categories: [
    {
      id: 'cat-bench',
      parentId: null,
      name: 'Categoria Bench',
      icon: 'circle',
      color: '#888888',
      type: 'EXPENSE',
    },
  ],
  tags: [],
  budgets: [],
  transactions: [
    tx('bench-cur-1', `${year}-01-15`),
    tx('bench-cur-2', `${year}-06-15`),
    tx('bench-cur-3', `${year}-12-31`),
    // 28/12 do ano anterior: a compra que, num cartão que fecha dia 25, cai na fatura de janeiro —
    // é por causa dela que a janela da onda 1 inclui o ano anterior inteiro.
    tx('bench-prev-1', `${year - 1}-12-28`),
    tx('bench-prev-2', `${year - 1}-01-01`),
    tx('bench-prev-3', `${year - 1}-07-04`),
    tx('bench-old-1', `${year - 6}-03-10`),
    tx('bench-old-2', `${year - 6}-04-10`),
    tx('bench-old-3', `${year - 7}-05-10`),
    tx('bench-old-4', `${year - 8}-06-10`),
  ],
  auditLog: [],
  deletedIds: [],
}

interface BenchSample {
  name: string
  columns: number
  scope: 'full' | 'window' | 'chunked'
  chunks: number
  rows: number
  samples: number[]
  medianMs: number
}

interface BenchResult {
  rows: number
  rounds: number
  yearSpan: [number, number]
  worker: BenchSample[]
  endToEnd: BenchSample[]
  model: { fixedMs: number; perCellUs: number; perRowUs: number } | null
  linearity: { rowRatio: number; timeRatio: number; exponent: number } | null
}

async function seedSqlite(page: Page, data: unknown) {
  await page.goto('/onboarding')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)
  await page.evaluate((d) => {
    return (window as Record<string, unknown>).__storage.replaceAll(d)
  }, data)
}

test.beforeEach(async ({ page }) => {
  await seedSqlite(page, fixture)
})

test('o gancho __bench só existe sob ?bench', async ({ page }) => {
  await page.goto('/')
  expect(await page.evaluate(() => '__bench' in window)).toBe(false)

  await page.goto('/?bench')
  await page.waitForFunction(() => '__bench' in window)
  expect(await page.evaluate(() => '__bench' in window)).toBe(true)
})

test('todas as variantes rodam contra o wa-sqlite real e leem o recorte que prometem', async ({
  page,
}) => {
  await page.goto('/?bench')
  await page.waitForFunction(() => '__bench' in window)

  const result = (await page.evaluate(async () => {
    const bench = (window as Record<string, unknown>).__bench as {
      columns: (rounds?: number) => Promise<unknown>
    }
    return bench.columns(2)
  })) as BenchResult

  const total = IN_WINDOW + OUT_OF_WINDOW
  expect(result.rows).toBe(total)
  expect(result.rounds).toBe(2)
  expect(result.yearSpan).toEqual([year - 8, year])

  for (const half of [result.worker, result.endToEnd]) {
    const byName = new Map(half.map((s) => [s.name, s]))

    // Toda variante rodou o número de rodadas pedido.
    for (const sample of half) expect(sample.samples).toHaveLength(2)

    // O recorte é o que decide o valor da medição: as variantes de tabela inteira têm que ver
    // todas as linhas, e as de janela só as dos dois anos recentes. Uma janela que na verdade
    // varresse tudo devolveria números bonitos e uma conclusão errada.
    expect(byName.get('id')?.rows).toBe(total)
    expect(byName.get('core9')?.rows).toBe(total)
    expect(byName.get('all20')?.rows).toBe(total)
    expect(byName.get('core9win')?.rows).toBe(IN_WINDOW)
    expect(byName.get('all20win')?.rows).toBe(IN_WINDOW)
    // COUNT(*) devolve uma linha só — é o piso de "varrer sem materializar".
    expect(byName.get('count')?.rows).toBe(1)

    // O ponto da hipótese dos lotes: ler fatiado tem que devolver **exatamente** o mesmo cofre que
    // a leitura única. Um lote a menos, ou uma fronteira sobreposta, e a comparação de tempo
    // estaria medindo duas leituras diferentes — sem falhar nada visivelmente.
    const chunked = half.filter((s) => s.scope === 'chunked')
    expect(chunked.length).toBeGreaterThan(0)
    for (const sample of chunked) {
      expect(sample.rows).toBe(total)
      expect(sample.chunks).toBeGreaterThan(1)
      expect(sample.columns).toBe(20)
    }
    // Mais lotes têm que significar mais consultas, senão a curva medida é uma só variante repetida.
    const chunkCounts = chunked.map((s) => s.chunks)
    expect(new Set(chunkCounts).size).toBe(chunkCounts.length)
  }

  // O ajuste precisa dos três pontos de tabela inteira; a linearidade, dos dois recortes.
  expect(result.model).not.toBeNull()
  expect(result.linearity).not.toBeNull()
})

test('as colunas declaradas batem com as que o SQLite devolve', async ({ page }) => {
  await page.goto('/?bench')
  await page.waitForFunction(() => !!(window as Record<string, unknown>).__storage)

  const columnCounts = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query: (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>
    }
    const all = await storage.query('SELECT * FROM transactions LIMIT 1')
    const core = await storage.query(
      'SELECT id, account_id, category_id, amount, type, date, is_paid, transfer_account_id, reference_month FROM transactions LIMIT 1'
    )
    return { all: Object.keys(all[0]).length, core: Object.keys(core[0]).length }
  })

  // `columns: 20` e `columns: 9` em benchVariants() alimentam o ajuste de custo por célula — se a
  // tabela ganhar uma coluna num schema futuro e este número não acompanhar, o µs/célula sai
  // errado sem nada quebrar.
  expect(columnCounts.all).toBe(20)
  expect(columnCounts.core).toBe(9)
})

test('o experimento de página roda sobre cópias e não toca o cofre real', async ({ page }) => {
  await page.goto('/?bench')
  await page.waitForFunction(() => '__bench' in window)

  const before = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query: (sql: string) => Promise<Record<string, unknown>[]>
    }
    const size = await storage.query('PRAGMA page_size')
    const count = await storage.query('SELECT COUNT(*) AS n FROM transactions')
    return { pageSize: Object.values(size[0])[0], rows: Object.values(count[0])[0] }
  })

  const result = (await page.evaluate(async () => {
    const bench = (window as Record<string, unknown>).__bench as {
      pages: () => Promise<unknown>
    }
    return bench.pages()
  })) as {
    entries: {
      label: string
      pageSize: number
      pageCount: number
      cacheSizeKb: number
      coldMs: number
      warmMs: number
      rows: number
    }[]
    vacuumMs: number
  }

  expect(result.entries.map((e) => e.label)).toEqual(['p4096', 'p4096+cache', 'p65536'])

  const total = IN_WINDOW + OUT_OF_WINDOW
  for (const entry of result.entries) {
    // Toda variante tem que ler o mesmo cofre — se o VACUUM ou a cópia perdessem linha, a
    // comparação de tempo estaria medindo bancos diferentes sem nada falhar.
    expect(entry.rows).toBe(total)
    expect(entry.pageCount).toBeGreaterThan(0)
  }

  // A variante de página grande tem que de fato ter reescrito o banco.
  const big = result.entries.find((e) => e.label === 'p65536')
  expect(big?.pageSize).toBe(65536)
  expect(result.entries.find((e) => e.label === 'p4096')?.pageSize).toBe(4096)
  // Cache grande é pedido em KiB via valor negativo de PRAGMA cache_size.
  expect(result.entries.find((e) => e.label === 'p4096+cache')?.cacheSizeKb).toBe(65536)

  // O cofre real ficou intacto: mesma página, mesmas linhas. É a garantia que separa uma
  // ferramenta de medição de um acidente.
  const after = await page.evaluate(async () => {
    const storage = (window as Record<string, unknown>).__storage as {
      query: (sql: string) => Promise<Record<string, unknown>[]>
    }
    const size = await storage.query('PRAGMA page_size')
    const count = await storage.query('SELECT COUNT(*) AS n FROM transactions')
    return { pageSize: Object.values(size[0])[0], rows: Object.values(count[0])[0] }
  })
  expect(after).toEqual(before)
})

test('o benchmark de escrita varre os tamanhos de página sem tocar o cofre real', async ({
  page,
}) => {
  await page.goto('/?bench')
  await page.waitForFunction(() => '__bench' in window)

  const readVault = () =>
    page.evaluate(async () => {
      const storage = (window as Record<string, unknown>).__storage as {
        query: (sql: string) => Promise<Record<string, unknown>[]>
      }
      const size = await storage.query('PRAGMA page_size')
      const rows = await storage.query('SELECT id, updated_at FROM transactions ORDER BY id')
      return { pageSize: Object.values(size[0])[0], rows }
    })

  const before = await readVault()

  const result = (await page.evaluate(async () => {
    const bench = (window as Record<string, unknown>).__bench as {
      writes: (rounds?: number) => Promise<unknown>
    }
    return bench.writes(3)
  })) as {
    rounds: number
    entries: {
      label: string
      vacuumed: boolean
      pageSize: number
      pageCount: number
      journalMode: string
      lockingMode: string
      coldReadMs: number
      yearRehashMs: number
      update1Ms: number
      update50Ms: number
      walBytes: number
      checkpointMs: number
      vacuumMs: number
    }[]
  }

  expect(result.rounds).toBe(3)
  expect(result.entries.map((e) => e.label)).toEqual([
    'p4096 (como está)',
    'p4096 + VACUUM',
    'p16384',
    'p32768',
    'p65536',
    'p4096 + WAL',
    'p65536 + WAL',
  ])
  expect(result.entries.map((e) => e.pageSize)).toEqual([
    4096, 4096, 16384, 32768, 65536, 4096, 65536,
  ])

  for (const entry of result.entries) {
    // Se o VACUUM não tivesse aplicado o page_size pedido, a varredura mediria cinco vezes o
    // mesmo banco e a curva seria ruído apresentado como decisão.
    expect(entry.pageCount).toBeGreaterThan(0)
    expect(entry.update1Ms).toBeGreaterThanOrEqual(0)
    expect(entry.coldReadMs).toBeGreaterThan(0)
    // O journal mode efetivo tem que bater com o pedido. Esta asserção existe porque o app pede
    // `journal_mode=WAL` em toda abertura e recebe `delete` caladamente: sem `xShmMap` na VFS o
    // SQLite recusa WAL devolvendo o modo atual, sem erro. WAL só pega com locking exclusivo.
    expect(entry.journalMode).toBe(entry.lockingMode === 'exclusive' ? 'wal' : 'delete')
  }
  // Mais bytes por página, menos páginas para o mesmo conteúdo.
  const counts = result.entries.map((e) => e.pageCount)
  expect(counts[4]).toBeLessThan(counts[1])
  // O controle sem VACUUM é o único não desfragmentado — é o que separa desfragmentar de trocar
  // o tamanho de página.
  expect(result.entries.filter((e) => !e.vacuumed).map((e) => e.label)).toEqual([
    'p4096 (como está)',
  ])

  // O cofre real sai intacto — inclusive os `updated_at`, que é justamente a coluna que o
  // benchmark reescreve nas cópias.
  expect(await readVault()).toEqual(before)
})

import { describe, expect, it } from 'vitest'
import {
  PARTITION_FORMAT_VERSION,
  SMALL_TABLES,
  assemblePeerDataFile,
  buildManifest,
  decodePartition,
  encodePartition,
  partitionFileName,
  partitionKey,
  partitionKeyFromFileName,
  planFetch,
  planPublish,
  verifyPartition,
  encodeManifestProperties,
  decodeManifestProperties,
  type HashEntry,
  type PartitionEntry,
  type PartitionKey,
  type SyncManifest,
} from '@/lib/cloudSync/partitions'
import { HASH_VERSION, combineHashes, hashRow, transactionRowKey } from '@/lib/storage/rowHash'
import { CURRENT_SCHEMA_VERSION, SchemaVersionError } from '@/lib/storage/schema'
import type { Transaction } from '@/types'

const USER = {
  name: 'E2E User',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const SETTINGS = {
  fileCreatedAt: '2026-01-01T00:00:00.000Z',
  fileUpdatedAt: '2026-08-26T00:00:00.000Z',
  auditLogRetentionLimit: 200,
  quadrantesEnabled: false,
  quadrantesInferFromHistory: false,
}

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2026-03-10',
    description: 'Mercado',
    isPaid: true,
    tags: [],
    budgetIds: [],
    updatedAt: '2026-03-10T10:00:00.000Z',
    createdAt: '2026-03-10T09:00:00.000Z',
    ...overrides,
  } as Transaction
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function hashesOf(rows: Transaction[]): HashEntry {
  return {
    hash: combineHashes(rows.map((t) => hashRow(transactionRowKey(t as never)))),
    count: rows.length,
  }
}

function makeManifest(overrides: Partial<SyncManifest> = {}): SyncManifest {
  return {
    formatVersion: PARTITION_FORMAT_VERSION,
    hashVersion: HASH_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deviceId: 'device-a',
    publishedAt: '2026-08-26T00:00:00.000Z',
    user: USER,
    settings: SETTINGS,
    partitions: {},
    ...overrides,
  } as SyncManifest
}

// ─── Nomes de arquivo ─────────────────────────────────────────────────────────

describe('nomes de arquivo de partição', () => {
  it('faz round-trip de toda tabela pequena e de anos de transações', () => {
    const keys: PartitionKey[] = [
      ...SMALL_TABLES.map((t) => partitionKey(t)),
      partitionKey('transactions', '2024'),
      partitionKey('transactions', '2026'),
    ]
    for (const key of keys) {
      expect(partitionKeyFromFileName(partitionFileName(key)), key).toBe(key)
      expect(partitionKeyFromFileName(partitionFileName(key, false)), key).toBe(key)
    }
  })

  it('é injetivo — nenhum par de chaves compartilha nome de arquivo', () => {
    const keys: PartitionKey[] = [
      ...SMALL_TABLES.map((t) => partitionKey(t)),
      ...['2023', '2024', '2025', '2026'].map((y) => partitionKey('transactions', y)),
    ]
    const names = keys.map((k) => partitionFileName(k))
    expect(new Set(names).size).toBe(names.length)
  })

  it('rejeita particionar uma tabela que não é transactions', () => {
    expect(() => partitionFileName(partitionKey('accounts', '2026'))).toThrow(/unsupported/)
  })

  it('devolve null para nomes que não são partições', () => {
    expect(partitionKeyFromFileName('manifest.json')).toBeNull()
    expect(partitionKeyFromFileName('gimbo.db')).toBeNull()
    expect(partitionKeyFromFileName('transactions-20xx.json.gz')).toBeNull()
  })
})

// ─── planFetch ────────────────────────────────────────────────────────────────

describe('planFetch', () => {
  const localHashes = new Map<PartitionKey, HashEntry>([
    ['accounts:', { hash: 111, count: 3 }],
    ['transactions:2026', { hash: 222, count: 10 }],
  ])

  function manifestWith(partitions: Record<string, HashEntry>): SyncManifest {
    return makeManifest({
      partitions: Object.fromEntries(
        Object.entries(partitions).map(([k, v]) => [
          k,
          { ...v, file: partitionFileName(k), fileId: `fid-${k}` },
        ])
      ),
    })
  }

  it('pula partições cujo hash e contagem batem', () => {
    const plan = planFetch(manifestWith({ 'accounts:': { hash: 111, count: 3 } }), localHashes)
    expect(plan.keys).toEqual([])
    expect(plan.skipped).toBe(1)
    expect(plan.total).toBe(1)
  })

  it('busca quando o hash diverge', () => {
    const plan = planFetch(manifestWith({ 'accounts:': { hash: 999, count: 3 } }), localHashes)
    expect(plan.keys).toEqual(['accounts:'])
  })

  it('busca quando a contagem diverge, mesmo com hash igual (guarda do XOR-fold)', () => {
    const plan = planFetch(manifestWith({ 'accounts:': { hash: 111, count: 4 } }), localHashes)
    expect(plan.keys).toEqual(['accounts:'])
  })

  it('busca partição ausente do lado local — nunca "igual por omissão"', () => {
    const plan = planFetch(
      manifestWith({ 'transactions:2019': { hash: 5, count: 2 } }),
      localHashes
    )
    expect(plan.keys).toEqual(['transactions:2019'])
  })

  // A regra do ano esvaziado: table_hashes acumula entradas {0,0} permanentes
  // (upsertTransactionYearHash), e o publicador não publica arquivo para elas.
  it('ignora partições que o peer declara vazias', () => {
    const plan = planFetch(
      manifestWith({ 'transactions:2019': { hash: 0, count: 0 } }),
      localHashes
    )
    expect(plan.keys).toEqual([])
    expect(plan.total).toBe(0)
  })

  it('não busca chave que só existe localmente — o peer não tem nada ali', () => {
    const plan = planFetch(manifestWith({}), localHashes)
    expect(plan.keys).toEqual([])
    expect(plan.total).toBe(0)
  })

  it('busca tudo quando o esquema de hash do peer é outro', () => {
    const manifest = manifestWith({
      'accounts:': { hash: 111, count: 3 },
      'transactions:2026': { hash: 222, count: 10 },
    })
    manifest.hashVersion = HASH_VERSION + 1

    const plan = planFetch(manifest, localHashes)

    expect(plan.hashVersionMismatch).toBe(true)
    expect(plan.keys.sort()).toEqual(['accounts:', 'transactions:2026'])
    expect(plan.skipped).toBe(0)
  })
})

// ─── planPublish ──────────────────────────────────────────────────────────────

describe('planPublish', () => {
  const localHashes = new Map<PartitionKey, HashEntry>([
    ['accounts:', { hash: 111, count: 3 }],
    ['transactions:2026', { hash: 222, count: 10 }],
  ])
  const allFiles = new Set(['accounts.json.gz', 'transactions-2026.json.gz'])

  it('não publica nada quando tudo bate com o último publicado', () => {
    const published = {
      'accounts:': { hash: 111, count: 3 },
      'transactions:2026': { hash: 222, count: 10 },
    }
    expect(planPublish(localHashes, published, allFiles)).toEqual([])
  })

  it('publica só a partição que mudou', () => {
    const published = {
      'accounts:': { hash: 111, count: 3 },
      'transactions:2026': { hash: 999, count: 10 },
    }
    expect(planPublish(localHashes, published, allFiles)).toEqual(['transactions:2026'])
  })

  it('publica tudo quando o cache de último publicado sumiu', () => {
    expect(planPublish(localHashes, {}, allFiles).sort()).toEqual([
      'accounts:',
      'transactions:2026',
    ])
  })

  it('republica um arquivo que sumiu do Drive, mesmo com o hash batendo (auto-cura)', () => {
    const published = {
      'accounts:': { hash: 111, count: 3 },
      'transactions:2026': { hash: 222, count: 10 },
    }
    expect(planPublish(localHashes, published, new Set(['accounts.json.gz']))).toEqual([
      'transactions:2026',
    ])
  })

  // Sem a guarda de count>0, uma partição vazia (que nunca é publicada) apareceria como
  // "faltando no Drive" a cada sync, para sempre.
  it('nunca publica partição vazia, nem quando o arquivo está ausente', () => {
    const withEmpty = new Map(localHashes).set('transactions:2019', { hash: 0, count: 0 })
    const published = {
      'accounts:': { hash: 111, count: 3 },
      'transactions:2026': { hash: 222, count: 10 },
    }
    expect(planPublish(withEmpty, published, allFiles)).toEqual([])
  })
})

// ─── Codec ────────────────────────────────────────────────────────────────────

describe('codec de partição', () => {
  it('faz round-trip de linhas via gzip', async () => {
    const rows = [makeTx(), makeTx({ id: 'tx-2', amount: 250 })]
    const { bytes, gzip } = await encodePartition(rows)
    expect(gzip).toBe(true)

    const decoded = await decodePartition(toArrayBuffer(bytes), 'transactions-2026.json.gz')

    expect(decoded).toEqual(rows)
  })

  it('faz round-trip sem compressão quando o nome não é .gz', async () => {
    const rows = [{ id: 'a' }]
    const json = new TextEncoder().encode(JSON.stringify(rows))
    expect(await decodePartition(toArrayBuffer(json), 'accounts.json')).toEqual(rows)
  })

  it('comprime de verdade — payload repetitivo fica menor que o JSON cru', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => makeTx({ id: `tx-${i}` }))
    const raw = new TextEncoder().encode(JSON.stringify(rows)).byteLength
    const { bytes } = await encodePartition(rows)
    expect(bytes.byteLength).toBeLessThan(raw / 2)
  })

  it('rejeita um payload que não é array', async () => {
    const json = new TextEncoder().encode(JSON.stringify({ nope: true }))
    await expect(decodePartition(toArrayBuffer(json), 'accounts.json')).rejects.toThrow(
      /not a JSON array/
    )
  })
})

// ─── verifyPartition ──────────────────────────────────────────────────────────

describe('verifyPartition', () => {
  const rows = [makeTx(), makeTx({ id: 'tx-2', amount: 250 })]

  it('aceita linhas que batem com o hash prometido', () => {
    expect(verifyPartition('transactions:2026', rows, hashesOf(rows))).toBe(true)
  })

  it('rejeita quando o conteúdo foi adulterado', () => {
    const tampered = [makeTx({ amount: 1 }), rows[1]]
    expect(verifyPartition('transactions:2026', tampered, hashesOf(rows))).toBe(false)
  })

  it('rejeita quando a contagem não bate', () => {
    expect(verifyPartition('transactions:2026', [rows[0]], hashesOf(rows))).toBe(false)
  })
})

// ─── assemblePeerDataFile ─────────────────────────────────────────────────────

describe('assemblePeerDataFile', () => {
  it('deixa vazias as partições não baixadas e preenche as que vieram', () => {
    const rows = [makeTx()]
    const peer = assemblePeerDataFile(
      makeManifest(),
      new Map([['transactions:2026', rows as unknown[]]])
    )

    expect(peer.transactions).toHaveLength(1)
    expect(peer.accounts).toEqual([])
    expect(peer.deletedIds).toEqual([])
    expect(peer.settings.fileUpdatedAt).toBe(SETTINGS.fileUpdatedAt)
  })

  it('acumula várias partições de anos em transactions, sem sobrescrever', () => {
    const y2025 = [makeTx({ id: 'tx-2025', date: '2025-05-01' })]
    const y2026 = [makeTx({ id: 'tx-2026', date: '2026-05-01' })]

    const peer = assemblePeerDataFile(
      makeManifest(),
      new Map([
        ['transactions:2025', y2025 as unknown[]],
        ['transactions:2026', y2026 as unknown[]],
      ])
    )

    expect(peer.transactions.map((t) => t.id).sort()).toEqual(['tx-2025', 'tx-2026'])
  })

  it('valida a partição e rejeita linha malformada', () => {
    expect(() =>
      assemblePeerDataFile(makeManifest(), new Map([['accounts:', [{ id: 'a' }]]]))
    ).toThrow()
  })

  it('migra um peer de schema anterior para a versão corrente', () => {
    const peer = assemblePeerDataFile(makeManifest({ schemaVersion: 12 }), new Map())
    expect(peer.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  it('lança SchemaVersionError para peer à frente — o chamador pula em vez de mesclar', () => {
    expect(() =>
      assemblePeerDataFile(makeManifest({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 }), new Map())
    ).toThrow(SchemaVersionError)
  })
})

// ─── buildManifest ────────────────────────────────────────────────────────────

describe('buildManifest', () => {
  it('omite partições vazias e carrega o fileId conhecido de cada arquivo', () => {
    const manifest = buildManifest({
      deviceId: 'device-a',
      user: USER,
      settings: SETTINGS,
      localHashes: new Map([
        ['accounts:', { hash: 111, count: 3 }],
        ['transactions:2019', { hash: 0, count: 0 }],
        ['transactions:2026', { hash: 222, count: 10 }],
      ]),
      fileIdsByName: new Map([['accounts.json.gz', 'fid-accounts']]),
      publishedAt: '2026-08-26T00:00:00.000Z',
    })

    expect(Object.keys(manifest.partitions).sort()).toEqual(['accounts:', 'transactions:2026'])
    expect(manifest.partitions['accounts:'].fileId).toBe('fid-accounts')
    expect(manifest.partitions['transactions:2026'].fileId).toBeUndefined()
    expect(manifest.hashVersion).toBe(HASH_VERSION)
    expect(manifest.schemaVersion).toBe(CURRENT_SCHEMA_VERSION)
  })

  // Fecha o laço: o que buildManifest publica é exatamente o que planFetch consegue pular.
  it('um manifesto construído dos mesmos hashes não gera nenhuma busca', () => {
    const localHashes = new Map<PartitionKey, HashEntry>([
      ['accounts:', { hash: 111, count: 3 }],
      ['transactions:2026', { hash: 222, count: 10 }],
    ])
    const manifest = buildManifest({
      deviceId: 'device-a',
      user: USER,
      settings: SETTINGS,
      localHashes,
      fileIdsByName: new Map(),
      publishedAt: '2026-08-26T00:00:00.000Z',
    })

    const plan = planFetch(manifest, localHashes)

    expect(plan.keys).toEqual([])
    expect(plan.skipped).toBe(2)
  })
})

// ─── CS-53: manifesto embarcado em appProperties ─────────────────────────────

describe('CS-53 — manifesto em appProperties', () => {
  function manifestWithYears(years: string[]): SyncManifest {
    const partitions: Record<string, PartitionEntry> = {
      'accounts:': {
        hash: 111,
        count: 3,
        file: 'accounts.json.gz',
        fileId: '1AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      },
    }
    for (const year of years) {
      partitions[`transactions:${year}`] = {
        hash: -161555390, // hashes de partição são XOR-fold: podem ser negativos
        count: 1312,
        file: `transactions-${year}.json.gz`,
        fileId: `1AbCdEfGhIjKlMnOpQrStUvWxYz0${year}`,
      }
    }
    return makeManifest({ partitions })
  }

  it('faz round-trip de hashes, contagens e fileIds', () => {
    const manifest = manifestWithYears(['2025', '2026'])
    const props = encodeManifestProperties(manifest)!
    expect(props).toBeTruthy()

    const decoded = decodeManifestProperties(props, 'device-a')!

    expect(decoded.hashVersion).toBe(manifest.hashVersion)
    expect(decoded.schemaVersion).toBe(manifest.schemaVersion)
    expect(decoded.fileUpdatedAt).toBe(SETTINGS.fileUpdatedAt)
    expect(Object.keys(decoded.partitions).sort()).toEqual(Object.keys(manifest.partitions).sort())
    for (const [key, entry] of Object.entries(manifest.partitions)) {
      expect(decoded.partitions[key].hash, key).toBe(entry.hash)
      expect(decoded.partitions[key].count, key).toBe(entry.count)
      expect(decoded.partitions[key].fileId, key).toBe(entry.fileId)
      expect(decoded.partitions[key].file, key).toBe(entry.file)
    }
  })

  // Os limites da API são o que decide se esta otimização vale: 30 propriedades privadas por app,
  // 124 bytes cada (chave + valor).
  it('respeita os limites da API para um cofre de 20 anos', () => {
    const years = Array.from({ length: 20 }, (_, i) => String(2007 + i))
    const props = encodeManifestProperties(manifestWithYears(years))!

    expect(props).toBeTruthy()
    expect(Object.keys(props).length).toBeLessThanOrEqual(30)
    for (const [key, value] of Object.entries(props)) {
      const bytes = new TextEncoder().encode(key + value).byteLength
      expect(bytes, `propriedade ${key}`).toBeLessThanOrEqual(124)
    }
  })

  it('desiste (null) quando o histórico é longo demais para caber', () => {
    const years = Array.from({ length: 120 }, (_, i) => String(1950 + i))
    expect(encodeManifestProperties(manifestWithYears(years))).toBeNull()
  })

  it('desiste quando alguma partição não tem fileId — o leitor não conseguiria buscá-la', () => {
    const manifest = manifestWithYears(['2026'])
    delete manifest.partitions['transactions:2026'].fileId
    expect(encodeManifestProperties(manifest)).toBeNull()
  })

  it('devolve null para propriedades ausentes ou de outro formato', () => {
    expect(decodeManifestProperties(undefined, 'device-a')).toBeNull()
    expect(decodeManifestProperties({}, 'device-a')).toBeNull()
    expect(decodeManifestProperties({ m: 'lixo' }, 'device-a')).toBeNull()
  })

  // A codificação comprime a chave de partição; se dois códigos colidissem, um peer leria a
  // partição errada — falha silenciosa e grave.
  it('os códigos de tabela são injetivos e nunca colidem com um ano', () => {
    const manifest = manifestWithYears(['2026'])
    const withAll: Record<string, PartitionEntry> = { ...manifest.partitions }
    for (const table of SMALL_TABLES) {
      withAll[partitionKey(table)] = {
        hash: 1,
        count: 1,
        file: partitionFileName(partitionKey(table)),
        fileId: `id-${table}`,
      }
    }
    const props = encodeManifestProperties(makeManifest({ partitions: withAll }))!
    const decoded = decodeManifestProperties(props, 'device-a')!

    expect(Object.keys(decoded.partitions).sort()).toEqual(Object.keys(withAll).sort())
  })
})

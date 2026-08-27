import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDrive } from './fakeDrive'
import { makeDataFile } from '../../fixtures/dataFile'
import type { DataFile, Transaction } from '@/types'
// Tipos por import estático (apagados na compilação, então não atrapalham o hoisting do vi.mock);
// os *valores* seguem vindo do await import() abaixo, depois dos mocks.
import type { PartitionEntry, SyncManifest } from '@/lib/cloudSync/partitions'

const {
  getValidAccessTokenMock,
  refreshGoogleTokenMock,
  isGoogleConnectedMock,
  trackPerformanceMock,
  getDeviceIdMock,
  storageMock,
} = vi.hoisted(() => ({
  getValidAccessTokenMock: vi.fn(),
  refreshGoogleTokenMock: vi.fn(),
  isGoogleConnectedMock: vi.fn(),
  trackPerformanceMock: vi.fn(),
  getDeviceIdMock: vi.fn(),
  storageMock: {
    getSyncManifestBase: vi.fn(),
    readPartitions: vi.fn(),
    loadDataFile: vi.fn(),
    applyMutation: vi.fn(),
  },
}))

vi.mock('@/lib/telemetry', () => ({ trackPerformance: trackPerformanceMock }))
vi.mock('@/lib/cloudSync/googleAuth', () => ({
  getValidAccessToken: getValidAccessTokenMock,
  refreshGoogleToken: refreshGoogleTokenMock,
  isGoogleConnected: isGoogleConnectedMock,
}))
vi.mock('@/lib/cloudSync/deviceId', () => ({ getDeviceId: getDeviceIdMock }))
vi.mock('@/services/storage', () => ({ storage: storageMock }))

const { pullAndMerge, pushIfNeeded, clearDriveTreeSyncState } =
  await import('@/lib/cloudSync/driveTreeSyncService')
const { clearGoogleDriveCache } = await import('@/lib/cloudSync/googleDrive')
const partitions = await import('@/lib/cloudSync/partitions')
const { HASH_VERSION, combineHashes, hashRow, transactionRowKey, accountRowKey } =
  await import('@/lib/storage/rowHash')
const { CURRENT_SCHEMA_VERSION } = await import('@/lib/storage/schema')

const OWN_DEVICE = 'dev-own'
const PEER_DEVICE = 'dev-peer'

let drive: FakeDrive

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

const ACCOUNT = {
  id: 'acc-1',
  name: 'Conta',
  type: 'RETAIL',
  balance: 0,
  includeInBalance: true,
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function hashOf(rows: unknown[], keyFn: (row: never) => string) {
  return { hash: combineHashes(rows.map((r) => hashRow(keyFn(r as never)))), count: rows.length }
}

/** Estado local simulado: o que `getSyncManifestBase`/`readPartitions` devolveriam. */
function setLocalVault(params: { accounts?: unknown[]; txByYear?: Record<string, Transaction[]> }) {
  const accounts = params.accounts ?? [ACCOUNT]
  const txByYear = params.txByYear ?? {}

  const hashes = [
    { key: 'accounts:', ...hashOf(accounts, accountRowKey) },
    ...Object.entries(txByYear).map(([year, rows]) => ({
      key: `transactions:${year}`,
      ...hashOf(rows, transactionRowKey),
    })),
  ]

  storageMock.getSyncManifestBase.mockResolvedValue({
    user: makeDataFile().user,
    settings: makeDataFile().settings,
    hashes,
  })
  storageMock.readPartitions.mockImplementation((keys: string[]) => {
    const out: Record<string, unknown[]> = {}
    for (const key of keys) {
      if (key === 'accounts:') out[key] = accounts
      else out[key] = txByYear[key.split(':')[1]] ?? []
    }
    return Promise.resolve(out)
  })
}

/** Publica no fake uma árvore de peer completa, como o CS-45 faria. */
async function seedPeerTree(params: {
  rootId: string
  accounts?: unknown[]
  txByYear?: Record<string, Transaction[]>
  manifestOverrides?: Partial<SyncManifest>
}): Promise<string> {
  const accounts = params.accounts ?? [ACCOUNT]
  const txByYear = params.txByYear ?? {}
  const folderId = drive.seedFolder(`device-${PEER_DEVICE}`, params.rootId)

  const entries: Record<string, PartitionEntry> = {}

  const add = async (key: string, rows: unknown[], keyFn: (row: never) => string) => {
    if (rows.length === 0) return
    const encoded = await partitions.encodePartition(rows)
    const file = partitions.partitionFileName(key, encoded.gzip)
    const fileId = drive.seedFile(file, folderId, encoded.bytes)
    entries[key] = { ...hashOf(rows, keyFn), file, fileId }
  }

  await add('accounts:', accounts, accountRowKey)
  for (const [year, rows] of Object.entries(txByYear)) {
    await add(`transactions:${year}`, rows, transactionRowKey)
  }

  const manifest: SyncManifest = {
    formatVersion: partitions.PARTITION_FORMAT_VERSION,
    hashVersion: HASH_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    deviceId: PEER_DEVICE,
    publishedAt: '2026-08-26T00:00:00.000Z',
    user: makeDataFile().user,
    settings: makeDataFile().settings,
    partitions: entries,
    ...params.manifestOverrides,
  }

  return drive.seedFile(`manifest-${PEER_DEVICE}.json`, params.rootId, JSON.stringify(manifest))
}

function metricValue(name: string): number | undefined {
  const call = [...trackPerformanceMock.mock.calls].reverse().find((c) => c[0] === name)
  return call ? (call[1] as number) : undefined
}

beforeEach(() => {
  localStorage.clear()
  clearGoogleDriveCache()
  clearDriveTreeSyncState()
  getValidAccessTokenMock.mockReset().mockResolvedValue('token-1')
  refreshGoogleTokenMock.mockReset().mockResolvedValue('token-2')
  isGoogleConnectedMock.mockReset().mockReturnValue(true)
  getDeviceIdMock.mockReset().mockResolvedValue(OWN_DEVICE)
  trackPerformanceMock.mockReset()
  storageMock.getSyncManifestBase.mockReset()
  storageMock.readPartitions.mockReset()
  storageMock.loadDataFile.mockReset().mockResolvedValue(makeDataFile())
  storageMock.applyMutation.mockReset().mockResolvedValue(undefined)
  drive = new FakeDrive()
  drive.install()
})

afterEach(() => drive.restore())

describe('pullAndMerge — publicação', () => {
  it('publica a árvore completa no primeiro sync e o manifesto por último', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })

    await pullAndMerge(makeDataFile())

    const root = drive.byName('Gimbo')!
    const folder = drive.byName(`device-${OWN_DEVICE}`, root.id)
    expect(folder).toBeDefined()
    expect(
      drive
        .childrenOf(folder!.id)
        .map((f) => f.name)
        .sort()
    ).toEqual(['accounts.json.gz', 'transactions-2026.json.gz'])

    const manifestFile = drive.byName(`manifest-${OWN_DEVICE}.json`, root.id)
    expect(manifestFile).toBeDefined()

    // Barreira dura: o manifesto é o commit. Se ele subisse antes das partições e a conexão
    // caísse no meio, um leitor veria um manifesto apontando para arquivos que não existem.
    const uploads = drive.calls().filter((c) => c.url.includes('/upload/'))
    expect(uploads).toHaveLength(3) // 2 partições + manifesto
    expect(uploads[uploads.length - 1].name).toBe(`manifest-${OWN_DEVICE}.json`)
    expect(
      uploads
        .slice(0, -1)
        .map((c) => c.name)
        .sort()
    ).toEqual(['accounts.json.gz', 'transactions-2026.json.gz'])
  })

  it('em regime permanente não publica nada e gasta uma única chamada', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })
    await pullAndMerge(makeDataFile()) // primeiro sync: publica

    drive.callLog.length = 0
    trackPerformanceMock.mockReset()
    await pullAndMerge(makeDataFile())

    // É a pergunta do "orçamento de chamadas à API" virada em teste: se um dia isto regredir,
    // falha aqui em vez de aparecer numa coleta de telemetria semanas depois.
    expect(drive.calls()).toHaveLength(1)
    expect(metricValue('sync.drive.apiCalls')).toBe(1)
    expect(metricValue('sync.drive.publish.partitionsUploaded')).toBeUndefined()
  })

  it('republica só a partição que mudou', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })
    await pullAndMerge(makeDataFile())

    drive.callLog.length = 0
    setLocalVault({ txByYear: { '2026': [makeTx({ amount: 999 })] } })
    await pullAndMerge(makeDataFile())

    const uploads = drive.calls().filter((c) => c.url.includes('/upload/'))
    // partição de 2026 + manifesto; accounts não mudou e não sobe.
    expect(uploads).toHaveLength(2)
    expect(metricValue('sync.drive.publish.partitionsUploaded')).toBe(1)
  })
})

describe('pullAndMerge — leitura de peer', () => {
  it('busca só a partição divergente e pula as que batem', async () => {
    const local2026 = [makeTx()]
    setLocalVault({ txByYear: { '2026': local2026 } })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({
      rootId: root,
      accounts: [ACCOUNT], // idêntico ao local → deve ser pulado
      txByYear: { '2026': local2026, '2025': [makeTx({ id: 'tx-2025', date: '2025-05-01' })] },
    })

    const result = await pullAndMerge(makeDataFile({ transactions: local2026 }))

    expect(result.status).toBe('merged')
    expect(metricValue('sync.drive.partitionsSkipped')).toBe(2) // accounts e 2026
    expect(metricValue('sync.drive.partitionsFetched')).toBe(1) // só 2025
    expect(metricValue('sync.drive.peersTotal')).toBe(1)

    const merged = (result as { data: DataFile }).data
    expect(merged.transactions.map((t) => t.id).sort()).toEqual(['tx-1', 'tx-2025'])
  })

  it('nunca baixa uma partição que bate — o arquivo não é sequer requisitado', async () => {
    const local2026 = [makeTx()]
    setLocalVault({ txByYear: { '2026': local2026 } })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({ rootId: root, txByYear: { '2026': local2026 } })
    const skipped = drive.byName('transactions-2026.json.gz')!

    drive.callLog.length = 0
    await pullAndMerge(makeDataFile({ transactions: local2026 }))

    expect(drive.calls().some((c) => c.url.includes(skipped.id))).toBe(false)
  })

  it('pula o peer inteiro quando o manifesto não mudou desde a última vez', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })
    const root = drive.seedFolder('Gimbo')
    const manifestId = await seedPeerTree({
      rootId: root,
      txByYear: { '2025': [makeTx({ id: 'tx-2025', date: '2025-05-01' })] },
    })
    await pullAndMerge(makeDataFile())

    drive.callLog.length = 0
    trackPerformanceMock.mockReset()
    await pullAndMerge(makeDataFile())

    expect(metricValue('sync.drive.peersSkippedByWatermark')).toBe(1)
    expect(drive.calls().some((c) => c.url.includes(manifestId))).toBe(false)
  })

  it('conta hashVersion divergente e busca tudo', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({
      rootId: root,
      txByYear: { '2026': [makeTx()] },
      manifestOverrides: { hashVersion: HASH_VERSION + 99 },
    })

    await pullAndMerge(makeDataFile())

    expect(metricValue('sync.drive.hashVersionMismatch')).toBe(1)
    expect(metricValue('sync.drive.partitionsSkipped')).toBe(0)
  })

  it('reporta divergência de hash mas mescla assim mesmo', async () => {
    setLocalVault({ txByYear: {} })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({ rootId: root, txByYear: { '2026': [makeTx({ id: 'tx-peer' })] } })
    // Adultera o conteúdo depois de o manifesto ter sido escrito.
    const file = drive.byName('transactions-2026.json.gz')!
    const { bytes } = await partitions.encodePartition([makeTx({ id: 'tx-peer', amount: 7 })])
    drive.files.get(file.id)!.bytes = bytes

    const result = await pullAndMerge(makeDataFile())

    expect(metricValue('sync.drive.partitionHashMismatch')).toBe(1)
    // O dado real nunca é descartado por um checksum de camada de otimização.
    expect(result.status).toBe('merged')
    expect((result as { data: DataFile }).data.transactions.map((t) => t.id)).toContain('tx-peer')
  })

  it('pula peer com formatVersion à frente, sem abortar o sync', async () => {
    setLocalVault({ txByYear: {} })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({
      rootId: root,
      txByYear: { '2026': [makeTx({ id: 'tx-peer' })] },
      manifestOverrides: { formatVersion: partitions.PARTITION_FORMAT_VERSION + 1 },
    })

    const result = await pullAndMerge(makeDataFile())

    expect(result.status).toBe('skipped')
    expect((result as { reason: string }).reason).toBe('newer-schema')
  })

  it('falha de download não avança a marca d’água — o peer é retentado', async () => {
    setLocalVault({ txByYear: {} })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({ rootId: root, txByYear: { '2026': [makeTx({ id: 'tx-peer' })] } })
    const partitionFile = drive.byName('transactions-2026.json.gz')!
    drive.failNext(new RegExp(partitionFile.id), 500, 99)

    const first = await pullAndMerge(makeDataFile())
    expect(first.status).toBe('synced') // nada mesclado

    // Segunda tentativa, agora sem falha injetada: o peer tem que ser reprocessado.
    drive['_failRules'] = []
    const second = await pullAndMerge(makeDataFile())

    expect(second.status).toBe('merged')
    expect((second as { data: DataFile }).data.transactions.map((t) => t.id)).toContain('tx-peer')
  })
})

describe('pushIfNeeded', () => {
  it('publica sem precisar de um DataFile, lendo o estado fresco do banco', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })

    expect(await pushIfNeeded()).toBe(true)

    const root = drive.byName('Gimbo')!
    expect(drive.byName(`manifest-${OWN_DEVICE}.json`, root.id)).toBeDefined()
  })

  it('é barato quando nada mudou', async () => {
    setLocalVault({ txByYear: { '2026': [makeTx()] } })
    await pushIfNeeded()

    drive.callLog.length = 0
    await pushIfNeeded()

    // Sem listagem de pasta, sem upload: o caminho rápido decide pelo cache de hashes.
    expect(drive.calls()).toHaveLength(0)
  })

  it('devolve false quando não há conexão, sem lançar', async () => {
    isGoogleConnectedMock.mockReturnValue(false)
    expect(await pushIfNeeded()).toBe(false)
  })
})

describe('clearDriveTreeSyncState', () => {
  it('limpa marcas d’água para que um cofre substituído releia todos os peers', async () => {
    setLocalVault({ txByYear: {} })
    const root = drive.seedFolder('Gimbo')
    await seedPeerTree({ rootId: root, txByYear: { '2026': [makeTx({ id: 'tx-peer' })] } })
    await pullAndMerge(makeDataFile())

    clearDriveTreeSyncState()
    trackPerformanceMock.mockReset()
    const again = await pullAndMerge(makeDataFile())

    // Sem isto, importar um backup antigo faria o app pular para sempre o peer que tem justamente
    // o dado recém-descartado.
    expect(again.status).toBe('merged')
    expect(metricValue('sync.drive.peersSkippedByWatermark')).toBe(0)
  })
})

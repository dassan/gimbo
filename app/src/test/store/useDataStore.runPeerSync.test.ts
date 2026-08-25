// Regression test for the runPeerSync race: pullAndMerge/syncFromPeers snapshot `data` before
// their (possibly slow, network-bound) pull, then overwrite the whole DB via replaceAll(merged)
// once it resolves. Any local edit made in between survived its own debounced write only until
// that replaceAll clobbered it. See useDataStore.ts `runPeerSync` for the reconciliation fix.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataFile, Transaction } from '@/types'

const { isGoogleConnectedMock } = vi.hoisted(() => ({ isGoogleConnectedMock: vi.fn() }))
vi.mock('@/lib/cloudSync/googleAuth', () => ({ isGoogleConnected: isGoogleConnectedMock }))

const { isMultiDeviceEnabledMock } = vi.hoisted(() => ({ isMultiDeviceEnabledMock: vi.fn() }))
vi.mock('@/lib/cloudSync/multiDeviceMode', () => ({
  isMultiDeviceEnabled: isMultiDeviceEnabledMock,
}))

const { getDeviceIdMock } = vi.hoisted(() => ({ getDeviceIdMock: vi.fn() }))
vi.mock('@/lib/cloudSync/deviceId', () => ({ getDeviceId: getDeviceIdMock }))

const { syncFromPeersMock } = vi.hoisted(() => ({ syncFromPeersMock: vi.fn() }))
vi.mock('@/lib/cloudSync/folderSyncService', () => ({ syncFromPeers: syncFromPeersMock }))

const { pullAndMergeMock, pushIfNeededMock } = vi.hoisted(() => ({
  pullAndMergeMock: vi.fn(),
  pushIfNeededMock: vi.fn(),
}))
vi.mock('@/lib/cloudSync/syncService', () => ({
  pullAndMerge: pullAndMergeMock,
  pushIfNeeded: pushIfNeededMock,
}))

const { loadDataFileMock, replaceAllMock, applyMutationMock, exportBlobMock } = vi.hoisted(() => ({
  loadDataFileMock: vi.fn(),
  replaceAllMock: vi.fn().mockResolvedValue(undefined),
  applyMutationMock: vi.fn().mockResolvedValue(undefined),
  exportBlobMock: vi.fn().mockResolvedValue(new Blob()),
}))
vi.mock('@/services/storage', () => ({
  storage: {
    loadDataFile: loadDataFileMock,
    replaceAll: replaceAllMock,
    applyMutation: applyMutationMock,
    exportBlob: exportBlobMock,
  },
}))

const { useDataStore, __resetPersistenceBaselineForTests } = await import('@/store/useDataStore')
const { makeDataFile } = await import('../fixtures/dataFile')

function makeTx(overrides: Partial<Transaction> & Pick<Transaction, 'id'>): Transaction {
  return {
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 10,
    type: 'EXPENSE',
    date: '2026-01-01',
    description: 'tx',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  replaceAllMock.mockResolvedValue(undefined)
  applyMutationMock.mockResolvedValue(undefined)
  exportBlobMock.mockResolvedValue(new Blob())
  __resetPersistenceBaselineForTests()
  useDataStore.setState({ data: null, syncStatus: 'idle', lastSyncedAt: null })
  isGoogleConnectedMock.mockReturnValue(true)
  isMultiDeviceEnabledMock.mockReturnValue(false)
})

describe('runPeerSync — local edit during pull (race regression)', () => {
  it('recovers a local edit made while pullAndMerge is in flight instead of silently dropping it', async () => {
    const initial = makeDataFile({ transactions: [] })
    useDataStore.getState().loadData(initial)

    const remoteTx = makeTx({
      id: 'remote-1',
      description: 'From peer',
      updatedAt: '2020-01-01T00:00:00.000Z',
    })
    // What pullAndMerge's own replaceAll would have written: merged against the *stale*
    // pre-edit snapshot it started from, so it never saw the local edit below.
    loadDataFileMock.mockResolvedValue({ ...initial, transactions: [remoteTx] } as DataFile)

    pullAndMergeMock.mockImplementation(() => {
      // Simulate a mutation landing after runPeerSync's initial get().data snapshot but before
      // it re-reads the store — the exact window a slow Drive round-trip opens up.
      useDataStore.getState().addTransaction(makeTx({ id: 'local-1', description: 'Local edit' }))
      return Promise.resolve({ status: 'merged', peersMerged: 1 })
    })

    await useDataStore.getState().runPeerSync()

    const ids = useDataStore.getState().data!.transactions.map((t) => t.id)
    expect(ids).toContain('remote-1')
    expect(ids).toContain('local-1')
  })

  it('persists the reconciled result so disk/Drive do not regress behind the in-memory store', async () => {
    const initial = makeDataFile({ transactions: [] })
    useDataStore.getState().loadData(initial)

    loadDataFileMock.mockResolvedValue({ ...initial, transactions: [] } as DataFile)
    pullAndMergeMock.mockImplementation(() => {
      useDataStore.getState().addTransaction(makeTx({ id: 'local-1' }))
      return Promise.resolve({ status: 'merged', peersMerged: 1 })
    })

    await useDataStore.getState().runPeerSync()

    expect(replaceAllMock).toHaveBeenCalled()
    const persisted = replaceAllMock.mock.calls[replaceAllMock.mock.calls.length - 1][0] as DataFile
    expect(persisted.transactions.map((t) => t.id)).toContain('local-1')
    expect(pushIfNeededMock).toHaveBeenCalled()
  })

  it('does not re-merge/re-persist when nothing changed locally during the sync', async () => {
    const initial = makeDataFile({ transactions: [] })
    useDataStore.getState().loadData(initial)

    const remoteTx = makeTx({ id: 'remote-1' })
    const fresh = { ...initial, transactions: [remoteTx] } as DataFile
    loadDataFileMock.mockResolvedValue(fresh)
    pullAndMergeMock.mockResolvedValue({ status: 'merged', peersMerged: 1 })

    await useDataStore.getState().runPeerSync()

    expect(useDataStore.getState().data!.transactions.map((t) => t.id)).toEqual(['remote-1'])
    expect(replaceAllMock).not.toHaveBeenCalled()
    expect(pushIfNeededMock).not.toHaveBeenCalled()
  })

  it('does not re-merge/re-persist when data is replaced by an equivalent object with no real edit (CS-29 regression)', async () => {
    // Reproduces a false positive found in production metrics: React StrictMode double-invokes
    // App.tsx's init() effect in dev, so loadData() can re-run with a freshly deserialized (but
    // content-identical) DataFile while a sync is in flight. That's a brand-new object reference
    // but not a real edit — comparing by reference (the original CS-24 fix) treated it as a
    // concurrent mutation and paid for a whole extra mergeForSync+replaceAll+pushIfNeeded cycle
    // for nothing (an unnecessary ~7.4s replaceAll observed live). Only mutate() bumps
    // fileUpdatedAt, so comparing that instead of `!==` correctly ignores this case.
    const initial = makeDataFile({ transactions: [] })
    useDataStore.getState().loadData(initial)

    const remoteTx = makeTx({ id: 'remote-1' })
    const fresh = { ...initial, transactions: [remoteTx] } as DataFile
    loadDataFileMock.mockResolvedValue(fresh)
    pullAndMergeMock.mockImplementation(() => {
      // Same content, same fileUpdatedAt, but a brand-new object — not a real edit.
      useDataStore.getState().loadData({ ...initial })
      return Promise.resolve({ status: 'merged', peersMerged: 1 })
    })

    await useDataStore.getState().runPeerSync()

    expect(useDataStore.getState().data!.transactions.map((t) => t.id)).toEqual(['remote-1'])
    expect(replaceAllMock).not.toHaveBeenCalled()
    expect(pushIfNeededMock).not.toHaveBeenCalled()
  })
})

describe('runPeerSync — concurrent invocation (CS-25 regression)', () => {
  it('ignores a second call while the first is still in flight', async () => {
    // Reproduces the production finding (CS-20 sync metrics): App.tsx's boot-time runPeerSync()
    // and Settings' OAuth-callback runPeerSync() both fire on the same page load, and each
    // independently drove its own full pullAndMerge — visible as two overlapping
    // sync.pullAndMerge.total windows and two separate sync.drive.upload.bytes events for the
    // same ~13MB vault.
    const initial = makeDataFile({ transactions: [] })
    useDataStore.getState().loadData(initial)

    let resolvePull!: (value: { status: 'synced' }) => void
    pullAndMergeMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = resolve
        })
    )

    const first = useDataStore.getState().runPeerSync()
    expect(useDataStore.getState().syncStatus).toBe('syncing')

    const second = useDataStore.getState().runPeerSync()
    resolvePull({ status: 'synced' })
    await Promise.all([first, second])

    expect(pullAndMergeMock).toHaveBeenCalledTimes(1)
  })

  it('allows a new sync once the in-flight one has finished', async () => {
    const initial = makeDataFile({ transactions: [] })
    useDataStore.getState().loadData(initial)
    pullAndMergeMock.mockResolvedValue({ status: 'synced' })

    await useDataStore.getState().runPeerSync()
    await useDataStore.getState().runPeerSync()

    expect(pullAndMergeMock).toHaveBeenCalledTimes(2)
  })
})

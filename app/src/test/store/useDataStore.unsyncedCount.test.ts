/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'
import type { Transaction } from '@/types'

// ─── Module-level mocks (hoisted by Vitest) ───────────────────────────────────

vi.mock('@/lib/storage/fileSystem', () => ({
  saveDataFile: vi.fn(),
  readCurrentDataFile: vi.fn(),
  getLastWrittenModified: vi.fn(),
  isHandleLost: vi.fn(),
  isPermissionNeeded: vi.fn(),
  requestHandlePermission: vi.fn(),
  setDataHandle: vi.fn(),
  checkHandlePermission: vi.fn(),
  openDataFile: vi.fn(),
  createNewDataFile: vi.fn(),
  downloadDataFile: vi.fn(),
  loadWorkspace: vi.fn(),
  saveWorkspace: vi.fn(),
}))

vi.mock('@/lib/storage/indexedDb', () => ({
  saveToIdb: vi.fn(),
  loadFromIdb: vi.fn(),
  clearIdb: vi.fn(),
  saveFileHandle: vi.fn(),
  loadFileHandle: vi.fn(),
  saveSyncMeta: vi.fn(),
}))

vi.mock('@/lib/storage/sync', () => ({
  syncToFile: vi.fn(),
}))

vi.mock('@/services/storage', () => ({
  storage: { replaceAll: vi.fn().mockResolvedValue(undefined) },
}))

import { syncToFile } from '@/lib/storage/sync'
import {
  isHandleLost,
  isPermissionNeeded,
  readCurrentDataFile,
  getLastWrittenModified,
} from '@/lib/storage/fileSystem'
import { storage } from '@/services/storage'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    accountId: 'acc-1',
    categoryId: 'cat-1',
    amount: 100,
    type: 'EXPENSE',
    date: '2024-01-01',
    description: 'Test',
    isPaid: true,
    tags: [],
    ...overrides,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  useDataStore.setState({
    data: makeDataFile(),
    unsyncedCount: 0,
    fileHandleLost: false,
    permissionNeeded: false,
    writeError: false,
    conflictData: null,
  })
  vi.resetAllMocks()
  vi.mocked(isHandleLost).mockReturnValue(false)
  vi.mocked(isPermissionNeeded).mockReturnValue(false)
  vi.mocked(readCurrentDataFile).mockResolvedValue(null)
  vi.mocked(getLastWrittenModified).mockReturnValue(null)
  vi.mocked(storage).replaceAll.mockResolvedValue(undefined)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('debouncedReplaceAll — persists mutations to SQLite (M-19)', () => {
  it('calls storage.replaceAll after a mutation', async () => {
    useDataStore.getState().addTransaction(makeTx({ id: 'tx-1' }))

    await vi.runAllTimersAsync()

    const { replaceAll } = vi.mocked(storage)
    expect(replaceAll).toHaveBeenCalledTimes(1)
  })

  it('debounces rapid mutations into a single replaceAll call', async () => {
    useDataStore.getState().addTransaction(makeTx({ id: 'tx-1' }))
    useDataStore.getState().addTransaction(makeTx({ id: 'tx-2' }))
    useDataStore.getState().addTransaction(makeTx({ id: 'tx-3' }))

    await vi.runAllTimersAsync()

    const { replaceAll } = vi.mocked(storage)
    expect(replaceAll).toHaveBeenCalledTimes(1)
  })

  it('in-memory data and unsyncedCount are updated even before SQLite write completes', () => {
    const before = useDataStore.getState().data!.transactions.length

    useDataStore.getState().addTransaction(makeTx({ id: 'tx-1' }))

    expect(useDataStore.getState().data!.transactions.length).toBe(before + 1)
    expect(useDataStore.getState().unsyncedCount).toBe(1)
  })
})

describe('persist — SQLite sync after successful disk write (M-19)', () => {
  it('calls storage.replaceAll with merged data after a successful sync', async () => {
    const merged = makeDataFile()
    vi.mocked(syncToFile).mockResolvedValue(merged)

    await useDataStore.getState().persist()

    const { replaceAll } = vi.mocked(storage)
    expect(replaceAll).toHaveBeenCalledWith(merged)
  })

  it('does not call storage.replaceAll when the disk write fails', async () => {
    vi.mocked(syncToFile).mockResolvedValue(null)
    vi.mocked(isHandleLost).mockReturnValue(false)

    await useDataStore.getState().persist()

    const { replaceAll } = vi.mocked(storage)
    expect(replaceAll).not.toHaveBeenCalled()
  })
})

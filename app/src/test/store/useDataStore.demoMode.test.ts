import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useDataStore } from '@/store/useDataStore'
import { makeDataFile } from '@/test/fixtures/dataFile'

vi.mock('@/lib/demo', () => ({
  isDemoMode: vi.fn(),
  loadDemoData: vi.fn(),
}))

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

import { isDemoMode } from '@/lib/demo'
import {
  saveDataFile,
  readCurrentDataFile,
  isHandleLost,
  isPermissionNeeded,
} from '@/lib/storage/fileSystem'
import { saveToIdb, saveSyncMeta } from '@/lib/storage/indexedDb'

beforeEach(() => {
  useDataStore.setState({
    data: null,
    unsyncedCount: 0,
    conflictData: null,
    fileHandleLost: false,
    permissionNeeded: false,
    isSecondaryTab: false,
  })
  vi.resetAllMocks()
  vi.mocked(isHandleLost).mockReturnValue(false)
  vi.mocked(isPermissionNeeded).mockReturnValue(false)
})

describe('persist — demo mode', () => {
  it('returns false immediately in demo mode without touching the filesystem', async () => {
    vi.mocked(isDemoMode).mockReturnValue(true)
    useDataStore.setState({ data: makeDataFile(), unsyncedCount: 3 })

    const ok = await useDataStore.getState().persist()

    expect(ok).toBe(false)
    expect(saveDataFile).not.toHaveBeenCalled()
    expect(readCurrentDataFile).not.toHaveBeenCalled()
  })

  it('does not reset unsyncedCount in demo mode', async () => {
    vi.mocked(isDemoMode).mockReturnValue(true)
    useDataStore.setState({ data: makeDataFile(), unsyncedCount: 5 })

    await useDataStore.getState().persist()

    expect(useDataStore.getState().unsyncedCount).toBe(5)
  })

  it('executes normally and resets unsyncedCount when not in demo mode', async () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    vi.mocked(readCurrentDataFile).mockResolvedValue(null)
    vi.mocked(saveDataFile).mockResolvedValue(true)

    useDataStore.setState({ data: makeDataFile(), unsyncedCount: 2 })
    const ok = await useDataStore.getState().persist()

    expect(ok).toBe(true)
    expect(useDataStore.getState().unsyncedCount).toBe(0)
  })
})

describe('mutate — demo mode', () => {
  it('applies data changes in memory without incrementing unsyncedCount', () => {
    vi.mocked(isDemoMode).mockReturnValue(true)
    const data = makeDataFile({ accounts: [] })
    useDataStore.setState({ data, unsyncedCount: 0 })

    useDataStore.getState().addAccount({
      id: 'acc-demo',
      name: 'Demo Account',
      type: 'RETAIL',
      balance: 0,
      includeInBalance: true,
    })

    expect(useDataStore.getState().data?.accounts).toHaveLength(1)
    expect(useDataStore.getState().unsyncedCount).toBe(0)
  })

  it('does not call IDB save in demo mode', () => {
    vi.mocked(isDemoMode).mockReturnValue(true)
    useDataStore.setState({ data: makeDataFile({ accounts: [] }), unsyncedCount: 0 })

    useDataStore.getState().addAccount({
      id: 'acc-demo',
      name: 'Demo Account',
      type: 'RETAIL',
      balance: 0,
      includeInBalance: true,
    })

    expect(saveToIdb).not.toHaveBeenCalled()
    expect(saveSyncMeta).not.toHaveBeenCalled()
  })

  it('increments unsyncedCount and calls IDB save when not in demo mode', () => {
    vi.mocked(isDemoMode).mockReturnValue(false)
    useDataStore.setState({ data: makeDataFile({ accounts: [] }), unsyncedCount: 0 })

    useDataStore.getState().addAccount({
      id: 'acc-real',
      name: 'Real Account',
      type: 'RETAIL',
      balance: 0,
      includeInBalance: true,
    })

    expect(useDataStore.getState().unsyncedCount).toBe(1)
  })
})

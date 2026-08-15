import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataFile } from '@/types'

const { listPeersMock, uploadMock, createFolderProviderMock } = vi.hoisted(() => ({
  listPeersMock: vi.fn(),
  uploadMock: vi.fn(),
  createFolderProviderMock: vi.fn(),
}))

vi.mock('@/lib/cloudSync/folderProvider', () => ({
  createFolderProvider: createFolderProviderMock,
}))

const { readPeerBlobMock, replaceAllMock, exportBlobMock } = vi.hoisted(() => ({
  readPeerBlobMock: vi.fn(),
  replaceAllMock: vi.fn(),
  exportBlobMock: vi.fn(),
}))

vi.mock('@/services/storage', () => ({
  storage: {
    readPeerBlob: readPeerBlobMock,
    replaceAll: replaceAllMock,
    exportBlob: exportBlobMock,
  },
}))

const { syncFromPeers } = await import('@/lib/cloudSync/folderSyncService')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDataFile(overrides: Partial<DataFile> = {}): DataFile {
  return {
    schemaVersion: 13,
    user: {
      name: 'Ana',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    settings: {
      fileCreatedAt: '2026-01-01',
      fileUpdatedAt: '2026-01-01',
      auditLogRetentionLimit: 200,
      quadrantesEnabled: false,
    },
    accounts: [],
    categories: [],
    tags: [],
    transactions: [],
    valuations: [],
    auditLog: [],
    deletedIds: [],
    savedPeriods: [],
    budgets: [],
    ...overrides,
  }
}

function makePeer(deviceId: string, lastModified: number) {
  return {
    deviceId,
    lastModified,
    handle: { getFile: vi.fn().mockResolvedValue(new File(['x'], `device-${deviceId}.db`)) },
  }
}

beforeEach(() => {
  localStorage.clear()
  listPeersMock.mockReset()
  uploadMock.mockReset()
  createFolderProviderMock.mockReset()
  createFolderProviderMock.mockReturnValue({ listPeers: listPeersMock, upload: uploadMock })
  readPeerBlobMock.mockReset()
  replaceAllMock.mockReset()
  exportBlobMock.mockReset()
  exportBlobMock.mockResolvedValue(new Blob(['export']))
})

describe('syncFromPeers', () => {
  it('returns synced when there are no peers', async () => {
    listPeersMock.mockResolvedValue([])
    const result = await syncFromPeers(makeDataFile(), 'local-device')
    expect(result).toEqual({ status: 'synced' })
    expect(replaceAllMock).not.toHaveBeenCalled()
  })

  it('merges a newer peer and republishes the local file', async () => {
    const peer = makePeer('peer-1', 1000)
    listPeersMock.mockResolvedValue([peer])
    readPeerBlobMock.mockResolvedValue({ status: 'ok', data: makeDataFile() })

    const result = await syncFromPeers(makeDataFile(), 'local-device')

    expect(result).toEqual({ status: 'merged', peersMerged: 1 })
    expect(replaceAllMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('ignores a peer that has not changed since the last recorded merge', async () => {
    localStorage.setItem('gimbo_sync_last_merged_peer-1', '1000')
    const peer = makePeer('peer-1', 1000) // same lastModified as last merge
    listPeersMock.mockResolvedValue([peer])

    const result = await syncFromPeers(makeDataFile(), 'local-device')

    expect(result).toEqual({ status: 'synced' })
    expect(readPeerBlobMock).not.toHaveBeenCalled()
  })

  it('skips an unreadable peer without throwing, and does not persist', async () => {
    const peer = makePeer('peer-1', 1000)
    listPeersMock.mockResolvedValue([peer])
    readPeerBlobMock.mockResolvedValue({ status: 'skipped', reason: 'unreadable' })

    const result = await syncFromPeers(makeDataFile(), 'local-device')

    expect(result).toEqual({ status: 'synced' })
    expect(replaceAllMock).not.toHaveBeenCalled()
  })

  it('skips and signals a peer with a newer schema', async () => {
    const peer = makePeer('peer-1', 1000)
    listPeersMock.mockResolvedValue([peer])
    readPeerBlobMock.mockResolvedValue({ status: 'skipped', reason: 'newer-schema' })

    const result = await syncFromPeers(makeDataFile(), 'local-device')

    expect(result).toEqual({ status: 'skipped', reason: 'newer-schema' })
    expect(replaceAllMock).not.toHaveBeenCalled()
  })

  it('a peer file that disappears mid-read (getFile throws) is skipped, not fatal', async () => {
    const peer = makePeer('peer-1', 1000)
    peer.handle.getFile = vi.fn().mockRejectedValue(new Error('NotFoundError'))
    listPeersMock.mockResolvedValue([peer])

    const result = await syncFromPeers(makeDataFile(), 'local-device')

    expect(result).toEqual({ status: 'synced' })
    expect(readPeerBlobMock).not.toHaveBeenCalled()
  })

  it('an unreachable folder (listPeers throws) reports offline', async () => {
    listPeersMock.mockRejectedValue(new Error('permission denied'))
    const result = await syncFromPeers(makeDataFile(), 'local-device')
    expect(result).toEqual({ status: 'offline' })
  })

  it('merges multiple stale peers and counts them', async () => {
    const peerA = makePeer('peer-a', 1000)
    const peerB = makePeer('peer-b', 2000)
    listPeersMock.mockResolvedValue([peerA, peerB])
    readPeerBlobMock.mockResolvedValue({ status: 'ok', data: makeDataFile() })

    const result = await syncFromPeers(makeDataFile(), 'local-device')

    expect(result).toEqual({ status: 'merged', peersMerged: 2 })
  })

  it('records lastMergedAt per peer after a successful merge', async () => {
    const peer = makePeer('peer-1', 1234)
    listPeersMock.mockResolvedValue([peer])
    readPeerBlobMock.mockResolvedValue({ status: 'ok', data: makeDataFile() })

    await syncFromPeers(makeDataFile(), 'local-device')

    expect(localStorage.getItem('gimbo_sync_last_merged_peer-1')).toBe('1234')
  })
})

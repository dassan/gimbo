import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataFile } from '@/types'

const { isGoogleConnectedMock } = vi.hoisted(() => ({ isGoogleConnectedMock: vi.fn() }))
vi.mock('@/lib/cloudSync/googleAuth', () => ({ isGoogleConnected: isGoogleConnectedMock }))

const { fileExistsMock, uploadMock, getMetadataMock, downloadMock, createGoogleDriveProviderMock } =
  vi.hoisted(() => ({
    fileExistsMock: vi.fn(),
    uploadMock: vi.fn(),
    getMetadataMock: vi.fn(),
    downloadMock: vi.fn(),
    createGoogleDriveProviderMock: vi.fn(),
  }))
vi.mock('@/lib/cloudSync/googleDrive', () => ({
  createGoogleDriveProvider: createGoogleDriveProviderMock,
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

const { pullAndMerge, pushIfNeeded } = await import('@/lib/cloudSync/syncService')

function makeDataFile(overrides: Partial<DataFile> = {}): DataFile {
  return {
    schemaVersion: 13,
    user: { name: 'Ana', email: 'a@x.com', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    settings: {
      fileCreatedAt: '2026-01-01T00:00:00.000Z',
      fileUpdatedAt: '2026-01-01T00:00:00.000Z',
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

beforeEach(() => {
  isGoogleConnectedMock.mockReset().mockReturnValue(true)
  fileExistsMock.mockReset()
  uploadMock.mockReset()
  getMetadataMock.mockReset()
  downloadMock.mockReset().mockResolvedValue(new ArrayBuffer(4))
  createGoogleDriveProviderMock.mockReset().mockReturnValue({
    fileExists: fileExistsMock,
    upload: uploadMock,
    getMetadata: getMetadataMock,
    download: downloadMock,
  })
  readPeerBlobMock.mockReset()
  replaceAllMock.mockReset()
  exportBlobMock.mockReset().mockResolvedValue(new Blob(['x']))
})

describe('pullAndMerge', () => {
  it('returns offline when not connected', async () => {
    isGoogleConnectedMock.mockReturnValue(false)
    const result = await pullAndMerge(makeDataFile())
    expect(result).toEqual({ status: 'offline' })
  })

  it('uploads the local vault as-is on first connection (no file on Drive yet)', async () => {
    fileExistsMock.mockResolvedValue(false)
    const result = await pullAndMerge(makeDataFile())
    expect(result).toEqual({ status: 'synced' })
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('does nothing when local is already at least as new as Drive', async () => {
    fileExistsMock.mockResolvedValue(true)
    getMetadataMock.mockResolvedValue({ modifiedTime: '2026-01-01T00:00:00.000Z' })
    const result = await pullAndMerge(
      makeDataFile({
        settings: {
          fileCreatedAt: '',
          fileUpdatedAt: '2026-02-01T00:00:00.000Z',
          auditLogRetentionLimit: 200,
          quadrantesEnabled: false,
        },
      })
    )
    expect(result).toEqual({ status: 'synced' })
    expect(downloadMock).not.toHaveBeenCalled()
  })

  it('downloads, merges, and republishes when Drive is newer', async () => {
    fileExistsMock.mockResolvedValue(true)
    getMetadataMock.mockResolvedValue({ modifiedTime: '2026-03-01T00:00:00.000Z' })
    readPeerBlobMock.mockResolvedValue({ status: 'ok', data: makeDataFile() })

    const result = await pullAndMerge(makeDataFile())

    expect(result).toEqual({ status: 'merged', peersMerged: 1 })
    expect(replaceAllMock).toHaveBeenCalledTimes(1)
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('returns skipped when the downloaded file is unreadable', async () => {
    fileExistsMock.mockResolvedValue(true)
    getMetadataMock.mockResolvedValue({ modifiedTime: '2026-03-01T00:00:00.000Z' })
    readPeerBlobMock.mockResolvedValue({ status: 'skipped', reason: 'unreadable' })

    const result = await pullAndMerge(makeDataFile())
    expect(result).toEqual({ status: 'skipped', reason: 'unreadable' })
    expect(replaceAllMock).not.toHaveBeenCalled()
  })

  it('returns offline (never throws) when the provider fails', async () => {
    fileExistsMock.mockRejectedValue(new Error('network error'))
    const result = await pullAndMerge(makeDataFile())
    expect(result).toEqual({ status: 'offline' })
  })
})

describe('pushIfNeeded', () => {
  it('does nothing when not connected', async () => {
    isGoogleConnectedMock.mockReturnValue(false)
    await expect(pushIfNeeded(makeDataFile())).resolves.toBe(false)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('uploads when no file exists on Drive yet', async () => {
    fileExistsMock.mockResolvedValue(false)
    await expect(pushIfNeeded(makeDataFile())).resolves.toBe(true)
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('uploads when local is newer than the Drive file', async () => {
    fileExistsMock.mockResolvedValue(true)
    getMetadataMock.mockResolvedValue({ modifiedTime: '2026-01-01T00:00:00.000Z' })
    await expect(
      pushIfNeeded(
        makeDataFile({
          settings: {
            fileCreatedAt: '',
            fileUpdatedAt: '2026-02-01T00:00:00.000Z',
            auditLogRetentionLimit: 200,
            quadrantesEnabled: false,
          },
        })
      )
    ).resolves.toBe(true)
    expect(uploadMock).toHaveBeenCalledTimes(1)
  })

  it('does not upload when local is not newer than the Drive file, but reports in sync', async () => {
    fileExistsMock.mockResolvedValue(true)
    getMetadataMock.mockResolvedValue({ modifiedTime: '2026-05-01T00:00:00.000Z' })
    await expect(
      pushIfNeeded(
        makeDataFile({
          settings: {
            fileCreatedAt: '',
            fileUpdatedAt: '2026-01-01T00:00:00.000Z',
            auditLogRetentionLimit: 200,
            quadrantesEnabled: false,
          },
        })
      )
    ).resolves.toBe(true)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it('reports failure (not swallows-as-success) on provider errors (B-23)', async () => {
    fileExistsMock.mockRejectedValue(new Error('offline'))
    await expect(pushIfNeeded(makeDataFile())).resolves.toBe(false)
  })
})

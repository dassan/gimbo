import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getValidAccessTokenMock, refreshGoogleTokenMock, isGoogleConnectedMock } = vi.hoisted(
  () => ({
    getValidAccessTokenMock: vi.fn(),
    refreshGoogleTokenMock: vi.fn(),
    isGoogleConnectedMock: vi.fn(),
  })
)

vi.mock('@/lib/cloudSync/googleAuth', () => ({
  getValidAccessToken: getValidAccessTokenMock,
  refreshGoogleToken: refreshGoogleTokenMock,
  isGoogleConnected: isGoogleConnectedMock,
}))

const { createGoogleDriveProvider, clearGoogleDriveCache } =
  await import('@/lib/cloudSync/googleDrive')

function jsonResponse(body: unknown, ok = true, status = ok ? 200 : 400): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as Response
}

beforeEach(() => {
  localStorage.clear()
  clearGoogleDriveCache()
  getValidAccessTokenMock.mockReset().mockResolvedValue('token-1')
  refreshGoogleTokenMock.mockReset().mockResolvedValue('token-2')
  isGoogleConnectedMock.mockReset().mockReturnValue(true)
})

describe('createGoogleDriveProvider', () => {
  it('isConnected delegates to googleAuth.isGoogleConnected', () => {
    const provider = createGoogleDriveProvider()
    expect(provider.isConnected()).toBe(true)
    expect(isGoogleConnectedMock).toHaveBeenCalled()
  })

  it('fileExists is false when no folder and no file exist yet, and creates the folder', async () => {
    const fetchMock = vi
      .fn()
      // findFolderId: list -> empty, then create
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 'folder-1' }))
      // findFileId: list -> empty
      .mockResolvedValueOnce(jsonResponse({ files: [] }))
    global.fetch = fetchMock

    const provider = createGoogleDriveProvider()
    const exists = await provider.fileExists()

    expect(exists).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('uploads via multipart create when no file exists yet, and caches the returned id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ files: [{ id: 'folder-1' }] })) // findFolderId (list hit)
      .mockResolvedValueOnce(jsonResponse({ files: [] })) // findFileId (no file yet)
      .mockResolvedValueOnce(jsonResponse({ id: 'file-1' })) // multipart create
    global.fetch = fetchMock

    const provider = createGoogleDriveProvider()
    await provider.upload(new Blob(['x']))

    const createCall = fetchMock.mock.calls[2]
    expect(createCall[0] as string).toContain('uploadType=multipart')
    expect((createCall[1] as RequestInit).method).toBe('POST')
  })

  it('uploads via PATCH media update when the file id is already cached', async () => {
    localStorage.setItem('gimbo_google_drive_folder_id', 'folder-1')
    localStorage.setItem('gimbo_google_drive_file_id', 'file-1')
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({}))
    global.fetch = fetchMock

    const provider = createGoogleDriveProvider()
    await provider.upload(new Blob(['x']))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/file-1')
    expect(url).toContain('uploadType=media')
    expect(init.method).toBe('PATCH')
  })

  it('download throws when no file exists on Drive yet', async () => {
    localStorage.setItem('gimbo_google_drive_folder_id', 'folder-1')
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({ files: [] }))

    const provider = createGoogleDriveProvider()
    await expect(provider.download()).rejects.toThrow()
  })

  it('download returns the file bytes when it exists', async () => {
    localStorage.setItem('gimbo_google_drive_folder_id', 'folder-1')
    localStorage.setItem('gimbo_google_drive_file_id', 'file-1')
    global.fetch = vi.fn().mockResolvedValueOnce(jsonResponse({}))

    const provider = createGoogleDriveProvider()
    const buffer = await provider.download()
    expect(buffer.byteLength).toBe(8)
  })

  it('getMetadata returns modifiedTime', async () => {
    localStorage.setItem('gimbo_google_drive_folder_id', 'folder-1')
    localStorage.setItem('gimbo_google_drive_file_id', 'file-1')
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ modifiedTime: '2026-07-24T00:00:00Z' }))

    const provider = createGoogleDriveProvider()
    const meta = await provider.getMetadata()
    expect(meta.modifiedTime).toBe('2026-07-24T00:00:00Z')
  })

  it('retries once after a 401 by refreshing the token', async () => {
    localStorage.setItem('gimbo_google_drive_folder_id', 'folder-1')
    localStorage.setItem('gimbo_google_drive_file_id', 'file-1')
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, false, 401))
      .mockResolvedValueOnce(jsonResponse({ modifiedTime: '2026-07-24T00:00:00Z' }))
    global.fetch = fetchMock

    const provider = createGoogleDriveProvider()
    const meta = await provider.getMetadata()

    expect(meta.modifiedTime).toBe('2026-07-24T00:00:00Z')
    expect(refreshGoogleTokenMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

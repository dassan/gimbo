import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDrive } from './fakeDrive'

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

const FOLDER_MIME = 'application/vnd.google-apps.folder'
let drive: FakeDrive

beforeEach(() => {
  localStorage.clear()
  clearGoogleDriveCache()
  getValidAccessTokenMock.mockReset().mockResolvedValue('token-1')
  refreshGoogleTokenMock.mockReset().mockResolvedValue('token-2')
  isGoogleConnectedMock.mockReset().mockReturnValue(true)
  drive = new FakeDrive()
  drive.install()
})

afterEach(() => {
  drive.restore()
})

/** Seeds `Gimbo/` with an existing gimbo.db, the steady state of a device that has synced before. */
function seedVault(content = 'sqlite-bytes'): { folderId: string; fileId: string } {
  const folderId = drive.seedFolder('Gimbo')
  const fileId = drive.seedFile('gimbo.db', folderId, content)
  return { folderId, fileId }
}

describe('createGoogleDriveProvider', () => {
  it('isConnected delegates to googleAuth.isGoogleConnected', () => {
    const provider = createGoogleDriveProvider()
    expect(provider.isConnected()).toBe(true)
    expect(isGoogleConnectedMock).toHaveBeenCalled()
  })

  it('fileExists is false on a fresh Drive, and creates the Gimbo folder', async () => {
    const provider = createGoogleDriveProvider()

    expect(await provider.fileExists()).toBe(false)
    const folder = drive.byName('Gimbo')
    expect(folder?.mimeType).toBe(FOLDER_MIME)
  })

  it('fileExists is true once gimbo.db is there', async () => {
    seedVault()
    const provider = createGoogleDriveProvider()
    expect(await provider.fileExists()).toBe(true)
  })

  it('creates gimbo.db inside the Gimbo folder when it does not exist yet', async () => {
    const folderId = drive.seedFolder('Gimbo')
    const provider = createGoogleDriveProvider()

    await provider.upload(new Blob(['first-write']))

    const file = drive.byName('gimbo.db', folderId)
    expect(file).toBeDefined()
    expect(drive.textOf(file!.id)).toBe('first-write')
    expect(drive.childrenOf(folderId)).toHaveLength(1)
  })

  it('updates the existing gimbo.db in place instead of creating a second one', async () => {
    const { folderId, fileId } = seedVault('old')
    const provider = createGoogleDriveProvider()

    await provider.upload(new Blob(['new']))

    expect(drive.textOf(fileId)).toBe('new')
    expect(drive.childrenOf(folderId)).toHaveLength(1)
  })

  it('download throws when no file exists on Drive yet', async () => {
    drive.seedFolder('Gimbo')
    const provider = createGoogleDriveProvider()
    await expect(provider.download()).rejects.toThrow()
  })

  it('download returns the stored bytes', async () => {
    seedVault('hello')
    const provider = createGoogleDriveProvider()

    const buffer = await provider.download()

    expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe('hello')
  })

  it('getMetadata returns the current modifiedTime, and it advances on upload', async () => {
    const { fileId } = seedVault()
    const provider = createGoogleDriveProvider()

    const before = await provider.getMetadata()
    expect(before.modifiedTime).toBe(drive.files.get(fileId)!.modifiedTime)

    await provider.upload(new Blob(['x']))
    const after = await provider.getMetadata()
    expect(after.modifiedTime > before.modifiedTime).toBe(true)
  })

  it('serializes concurrent uploads so only one file is ever created (race found in production)', async () => {
    const provider = createGoogleDriveProvider()

    await Promise.all([provider.upload(new Blob(['a'])), provider.upload(new Blob(['b']))])

    // The assertion that matters is about resulting state, not call ordering: before enqueue()
    // both calls saw "no file yet" and each created one.
    expect(drive.allNamed('Gimbo')).toHaveLength(1)
    expect(drive.allNamed('gimbo.db')).toHaveLength(1)
  })

  it('retries once after a 401 by refreshing the token, and the retry uses the new token', async () => {
    const { folderId, fileId } = seedVault()
    // Pre-cache the ids so getMetadata is exactly one request — otherwise the folder/file lookups
    // each 401 and refresh on their own, and the count says nothing about the retry itself.
    localStorage.setItem('gimbo_google_drive_folder_id', folderId)
    localStorage.setItem('gimbo_google_drive_file_id', fileId)
    // The provider starts with token-1; only token-2 (what refreshGoogleToken returns) is accepted.
    drive.setValidToken('token-2')
    const provider = createGoogleDriveProvider()

    const meta = await provider.getMetadata()

    expect(meta.modifiedTime).toBeDefined()
    expect(refreshGoogleTokenMock).toHaveBeenCalledTimes(1)
    expect(drive.calls().map((c) => c.url)).toHaveLength(2) // original + retry, never a third
  })

  it('gives up after a single 401 retry rather than looping', async () => {
    const { folderId, fileId } = seedVault()
    localStorage.setItem('gimbo_google_drive_folder_id', folderId)
    localStorage.setItem('gimbo_google_drive_file_id', fileId)
    drive.setValidToken('token-never-issued')
    const provider = createGoogleDriveProvider()

    await expect(provider.getMetadata()).rejects.toThrow()
    expect(refreshGoogleTokenMock).toHaveBeenCalledTimes(1)
    expect(drive.calls()).toHaveLength(2)
  })

  it('reuses the cached folder/file ids instead of re-listing on the next call', async () => {
    seedVault()
    const provider = createGoogleDriveProvider()
    await provider.getMetadata()
    const listsAfterFirst = drive.calls(/files\?q=/).length

    await provider.getMetadata()

    expect(drive.calls(/files\?q=/).length).toBe(listsAfterFirst)
    expect(listsAfterFirst).toBeGreaterThan(0)
  })

  it('picks the most recently modified gimbo.db when duplicates exist', async () => {
    const folderId = drive.seedFolder('Gimbo')
    drive.seedFile('gimbo.db', folderId, 'older')
    const newerId = drive.seedFile('gimbo.db', folderId, 'newer')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const provider = createGoogleDriveProvider()

    const buffer = await provider.download()

    expect(new TextDecoder().decode(new Uint8Array(buffer))).toBe('newer')
    expect(localStorage.getItem('gimbo_google_drive_file_id')).toBe(newerId)
  })

  it('surfaces a failed list as an error instead of silently treating it as empty', async () => {
    drive.failNext(/files\?q=/, 500)
    const provider = createGoogleDriveProvider()

    await expect(provider.fileExists()).rejects.toThrow()
  })
})

// O harness é carga-portante para os testes do transporte particionado (CS-44/CS-45), que afirmam
// coisas do tipo "esta partição nunca foi baixada". Se o fake for permissivo onde a API real é
// estrita, esses testes passam por engano. Estas asserções fixam os três pontos estritos.
describe('FakeDrive — contrato do harness', () => {
  async function get(url: string): Promise<Record<string, unknown>> {
    const res = await fetch(url)
    return (await res.json()) as Record<string, unknown>
  }

  it('pagina em pageSize e só devolve nextPageToken se `fields` pedir', async () => {
    const folderId = drive.seedFolder('Gimbo')
    for (let i = 0; i < 101; i++) drive.seedFile(`part-${i}.json.gz`, folderId, 'x')
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`)

    const withToken = await get(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name)`
    )
    expect((withToken.files as unknown[]).length).toBe(100)
    expect(withToken.nextPageToken).toBe('100')

    const page2 = await get(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name)&pageToken=100`
    )
    expect((page2.files as unknown[]).length).toBe(1)
    expect(page2.nextPageToken).toBeUndefined()

    // A pegadinha real: sem nextPageToken em `fields`, o Drive trunca em silêncio.
    const truncated = await get(
      `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`
    )
    expect((truncated.files as unknown[]).length).toBe(100)
    expect(truncated.nextPageToken).toBeUndefined()
  })

  it('projeta `fields=files(...)` de verdade — campo não pedido volta undefined', async () => {
    const folderId = drive.seedFolder('Gimbo')
    drive.seedFile('gimbo.db', folderId, 'x')
    const q = encodeURIComponent(`'${folderId}' in parents`)

    const json = await get(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)
    const [file] = json.files as Record<string, unknown>[]

    expect(file.id).toBeDefined()
    expect(file.modifiedTime).toBeUndefined()
  })

  it('lança numa cláusula `q` desconhecida em vez de casar com tudo', async () => {
    const q = encodeURIComponent("bogusField='x'")
    await expect(get(`https://www.googleapis.com/drive/v3/files?q=${q}`)).rejects.toThrow(
      /unsupported q clause/
    )
  })
})

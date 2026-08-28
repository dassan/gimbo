import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDrive } from './fakeDrive'

const {
  getValidAccessTokenMock,
  refreshGoogleTokenMock,
  isGoogleConnectedMock,
  trackPerformanceMock,
} = vi.hoisted(() => ({
  getValidAccessTokenMock: vi.fn(),
  refreshGoogleTokenMock: vi.fn(),
  isGoogleConnectedMock: vi.fn(),
  trackPerformanceMock: vi.fn(),
}))

vi.mock('@/lib/telemetry', () => ({ trackPerformance: trackPerformanceMock }))

vi.mock('@/lib/cloudSync/googleAuth', () => ({
  getValidAccessToken: getValidAccessTokenMock,
  refreshGoogleToken: refreshGoogleTokenMock,
  isGoogleConnected: isGoogleConnectedMock,
}))

const {
  createGoogleDriveProvider,
  clearGoogleDriveCache,
  listFolderChildren,
  getRootFolderId,
  ensureSubfolder,
  uploadFileToFolder,
  downloadFileById,
  resetDriveApiCallCount,
  reportDriveApiCallCount,
  mapWithConcurrency,
  DRIVE_CONCURRENCY,
} = await import('@/lib/cloudSync/googleDrive')

const FOLDER_MIME = 'application/vnd.google-apps.folder'
let drive: FakeDrive

beforeEach(() => {
  localStorage.clear()
  clearGoogleDriveCache()
  getValidAccessTokenMock.mockReset().mockResolvedValue('token-1')
  refreshGoogleTokenMock.mockReset().mockResolvedValue('token-2')
  isGoogleConnectedMock.mockReset().mockReturnValue(true)
  trackPerformanceMock.mockReset()
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

// ─── CS-42: primitivas de árvore ──────────────────────────────────────────────

describe('primitivas de árvore (CS-42)', () => {
  it('lista todos os filhos de uma pasta, seguindo nextPageToken até o fim', async () => {
    const folderId = drive.seedFolder('Gimbo')
    // Acima do pageSize=1000 que a implementação pede, para o laço de paginação rodar de verdade.
    for (let i = 0; i < 1200; i++) drive.seedFile(`part-${i}.json.gz`, folderId, 'x')

    const children = await listFolderChildren(folderId)

    // O bug que isto pega: sem nextPageToken em `fields` (ou sem iterar), viria só a primeira
    // página, e a ausência do resto seria lida como "arquivos faltando" → re-upload a cada sync.
    expect(children).toHaveLength(1200)
    expect(new Set(children.map((c) => c.id)).size).toBe(1200)
    expect(drive.calls(/files\?q=/).length).toBeGreaterThan(1)
  })

  it('não devolve filhos de outra pasta', async () => {
    const mine = drive.seedFolder('device-a')
    const theirs = drive.seedFolder('device-b')
    drive.seedFile('accounts.json.gz', mine, 'a')
    drive.seedFile('accounts.json.gz', theirs, 'b')

    const children = await listFolderChildren(mine)

    expect(children.map((c) => c.name)).toEqual(['accounts.json.gz'])
    expect(drive.textOf(children[0].id)).toBe('a')
  })

  it('ensureSubfolder cria uma vez e reusa depois', async () => {
    const root = await getRootFolderId()

    const first = await ensureSubfolder(root, 'device-a1b2c3')
    const second = await ensureSubfolder(root, 'device-a1b2c3')

    expect(second).toBe(first)
    expect(drive.allNamed('device-a1b2c3')).toHaveLength(1)
  })

  it('ensureSubfolder concorrente nunca cria duas pastas', async () => {
    const root = await getRootFolderId()

    const ids = await Promise.all([
      ensureSubfolder(root, 'device-a1b2c3'),
      ensureSubfolder(root, 'device-a1b2c3'),
      ensureSubfolder(root, 'device-a1b2c3'),
    ])

    expect(new Set(ids).size).toBe(1)
    expect(drive.allNamed('device-a1b2c3')).toHaveLength(1)
  })

  it('uploadFileToFolder cria e depois atualiza no lugar', async () => {
    const folderId = drive.seedFolder('device-a')

    const created = await uploadFileToFolder({
      parentId: folderId,
      name: 'accounts.json.gz',
      blob: new Blob(['v1']),
    })
    const again = await uploadFileToFolder({
      parentId: folderId,
      name: 'accounts.json.gz',
      blob: new Blob(['v2']),
      fileId: created.id,
    })

    expect(again.id).toBe(created.id)
    expect(again.recreated).toBe(false)
    expect(created.recreated).toBe(false) // criação nova não é divergência
    expect(drive.textOf(created.id)).toBe('v2')
    expect(drive.childrenOf(folderId)).toHaveLength(1)
  })

  // Auto-cura: um id guardado pode ter sido apagado no Drive entre dois syncs.
  it('uploadFileToFolder recria quando o fileId guardado sumiu (404)', async () => {
    const folderId = drive.seedFolder('device-a')

    const recreated = await uploadFileToFolder({
      parentId: folderId,
      name: 'accounts.json.gz',
      blob: new Blob(['v1']),
      fileId: 'id-que-nao-existe',
    })

    expect(recreated.id).not.toBe('id-que-nao-existe')
    // O sinal explícito é o que o publicador usa para invalidar o cache de ids (CS-50 C).
    expect(recreated.recreated).toBe(true)
    expect(drive.textOf(recreated.id)).toBe('v1')
  })

  it('downloadFileById devolve os bytes, e null quando o id sumiu', async () => {
    const folderId = drive.seedFolder('device-a')
    const fileId = drive.seedFile('accounts.json.gz', folderId, 'conteúdo')

    const buffer = await downloadFileById(fileId)
    expect(new TextDecoder().decode(new Uint8Array(buffer!))).toBe('conteúdo')

    // null, não exceção: o manifesto do peer pode anunciar um id obsoleto, e o leitor recupera
    // caindo para uma listagem da pasta em vez de abortar o sync inteiro.
    expect(await downloadFileById('id-que-nao-existe')).toBeNull()
  })

  it('escapa aspas simples na query em vez de concatenar cru', async () => {
    const root = await getRootFolderId()
    await ensureSubfolder(root, "device-o'brien")

    expect(drive.allNamed("device-o'brien")).toHaveLength(1)
  })
})

// ─── CS-43: concorrência, backoff e contador de chamadas ──────────────────────

describe('concorrência e rate limit (CS-43)', () => {
  it('conta cada round-trip disparado, retries inclusive', async () => {
    seedVault()
    resetDriveApiCallCount()
    const provider = createGoogleDriveProvider()

    await provider.getMetadata()

    // O contador é a resposta à pergunta "trocamos bytes por chamadas demais?" — tem que bater
    // com o número real de requisições, não com o número de operações lógicas.
    reportDriveApiCallCount()
    expect(trackPerformanceMock).toHaveBeenCalledWith('sync.drive.apiCalls', drive.calls().length)
  })

  it('zera o contador depois de reportar, para o próximo sync medir só a si mesmo', async () => {
    seedVault()
    resetDriveApiCallCount()
    const provider = createGoogleDriveProvider()
    await provider.getMetadata()
    reportDriveApiCallCount()
    trackPerformanceMock.mockClear()

    reportDriveApiCallCount()

    expect(trackPerformanceMock).toHaveBeenCalledWith('sync.drive.apiCalls', 0)
  })

  it('espera e repete depois de um 403 de rate limit, e emite a métrica', async () => {
    const { folderId, fileId } = seedVault()
    localStorage.setItem('gimbo_google_drive_folder_id', folderId)
    localStorage.setItem('gimbo_google_drive_file_id', fileId)
    drive.failNextWithRateLimit(/files\//)
    const provider = createGoogleDriveProvider()

    const meta = await provider.getMetadata()

    expect(meta.modifiedTime).toBeDefined()
    expect(drive.calls()).toHaveLength(2)
    const metricNames = trackPerformanceMock.mock.calls.map((call) => String(call[0]))
    expect(metricNames).toContain('sync.drive.fetch429Retry')
  })

  it('não repete um 403 de permissão — esperar não conserta autorização', async () => {
    const { folderId, fileId } = seedVault()
    localStorage.setItem('gimbo_google_drive_folder_id', folderId)
    localStorage.setItem('gimbo_google_drive_file_id', fileId)
    drive.failNext(/files\//, 403) // sem reason de rate limit
    const provider = createGoogleDriveProvider()

    await expect(provider.getMetadata()).rejects.toThrow()
    expect(drive.calls()).toHaveLength(1)
  })

  it('desiste depois do teto de tentativas em vez de repetir para sempre', async () => {
    const { folderId, fileId } = seedVault()
    localStorage.setItem('gimbo_google_drive_folder_id', folderId)
    localStorage.setItem('gimbo_google_drive_file_id', fileId)
    drive.failNextWithRateLimit(/files\//, 99)
    const provider = createGoogleDriveProvider()

    await expect(provider.getMetadata()).rejects.toThrow()
    expect(drive.calls()).toHaveLength(4) // original + 3 retries
  })

  it('mapWithConcurrency preserva a ordem e respeita o teto', async () => {
    const items = Array.from({ length: 12 }, (_, i) => i)
    let inFlight = 0
    let peak = 0

    const results = await mapWithConcurrency(items, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return n * 2
    })

    expect(results).toEqual(items.map((n) => n * 2))
    expect(peak).toBeLessThanOrEqual(DRIVE_CONCURRENCY)
    expect(peak).toBeGreaterThan(1) // e de fato paralelizou
  })

  it('mapWithConcurrency propaga a falha de um item', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], (n) =>
        n === 2 ? Promise.reject(new Error('boom')) : Promise.resolve(n)
      )
    ).rejects.toThrow('boom')
  })
})

// ─── CS-53: appProperties ────────────────────────────────────────────────────

describe('appProperties (CS-53)', () => {
  it('grava appProperties na criação e as devolve no files.list', async () => {
    const folderId = drive.seedFolder('Gimbo')

    const created = await uploadFileToFolder({
      parentId: folderId,
      name: 'manifest-a.json',
      blob: new Blob(['{}']),
      appProperties: { m: '1|1|19|2026-08-27T00:00:00.000Z', q0: 'a,1,1,id-x' },
    })

    expect(drive.files.get(created.id)?.appProperties).toEqual({
      m: '1|1|19|2026-08-27T00:00:00.000Z',
      q0: 'a,1,1,id-x',
    })

    const children = await listFolderChildren(folderId)
    expect(children[0].appProperties?.q0).toBe('a,1,1,id-x')
  })

  it('atualiza appProperties e conteúdo numa única chamada', async () => {
    const folderId = drive.seedFolder('Gimbo')
    const created = await uploadFileToFolder({
      parentId: folderId,
      name: 'manifest-a.json',
      blob: new Blob(['v1']),
      appProperties: { m: 'antigo' },
    })

    drive.callLog.length = 0
    await uploadFileToFolder({
      parentId: folderId,
      name: 'manifest-a.json',
      blob: new Blob(['v2']),
      fileId: created.id,
      appProperties: { m: 'novo' },
    })

    // Uma chamada só: separar conteúdo e metadados dobraria o round-trip mais caro (~2s medidos).
    expect(drive.calls()).toHaveLength(1)
    expect(drive.textOf(created.id)).toBe('v2')
    expect(drive.files.get(created.id)?.appProperties?.m).toBe('novo')
  })

  it('sem appProperties, o update segue pelo caminho de mídia simples', async () => {
    const folderId = drive.seedFolder('Gimbo')
    const created = await uploadFileToFolder({
      parentId: folderId,
      name: 'accounts.json.gz',
      blob: new Blob(['v1']),
    })

    drive.callLog.length = 0
    await uploadFileToFolder({
      parentId: folderId,
      name: 'accounts.json.gz',
      blob: new Blob(['v2']),
      fileId: created.id,
    })

    expect(drive.calls()[0].url).toContain('uploadType=media')
    expect(drive.textOf(created.id)).toBe('v2')
  })
})

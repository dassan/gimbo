// F-28 Nível 2, Fase 2 — CS-03: Google Drive file operations behind the CloudProvider interface
// (CS-19, Fase 0). Only `merge.ts`/`driveTreeSyncService.ts` orchestration talks to this module directly —
// everything above the transport layer depends on `CloudProvider`, never on Drive specifics.
//
// **Race fixed 2026-07-25 (found in production testing):** find-or-create isn't atomic — two
// operations that both call upload()/fileExists() close together (e.g. the sync triggered right
// after connecting and another sync from a near-simultaneous mutation) could each see "no file
// yet" and each create one, producing two gimbo.db in the Gimbo/ folder. `enqueue()` below
// serializes every Drive operation within this tab so the second call always sees the first
// one's cached file id. This does NOT cover two separate tabs/devices racing to connect at the
// exact same instant — that residual window is real but far rarer than the single-tab case that
// actually happened; closing it would need server-side atomicity Drive's API doesn't offer.

import { getValidAccessToken, isGoogleConnected, refreshGoogleToken } from './googleAuth'
import type { CloudProvider } from './provider'
import { measureSync, trackSyncBytes } from './syncMetrics'

let _queue: Promise<unknown> = Promise.resolve()
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const task = _queue.then(fn, fn)
  _queue = task.then(
    () => undefined,
    () => undefined
  )
  return task
}

const FILES_ENDPOINT = 'https://www.googleapis.com/drive/v3/files'
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const DB_FILENAME = 'gimbo.db'
const FOLDER_NAME = 'Gimbo'

// Cached ids avoid a files.list round-trip on every sync — cheap to invalidate (just IDs, no
// financial data) if the user ever renames/moves things by hand in Drive.
const FOLDER_ID_KEY = 'gimbo_google_drive_folder_id'
const FILE_ID_KEY = 'gimbo_google_drive_file_id'

function getCachedId(key: string): string | null {
  return localStorage.getItem(key)
}
function setCachedId(key: string, id: string): void {
  localStorage.setItem(key, id)
}

/** Clears the cached folder/file ids — call on disconnect so a future reconnect re-discovers them. */
export function clearGoogleDriveCache(): void {
  localStorage.removeItem(FOLDER_ID_KEY)
  localStorage.removeItem(FILE_ID_KEY)
}

// Adds the bearer token; on a 401 (expired/revoked access token) refreshes once and retries —
// per CS-03, never more than one retry.
//
// CS-26: `sync.drive.getMetadata` was measured at 9.2s in production for what should be a trivial
// `?fields=modifiedTime` GET (vs. 1-2s for the structurally similar findFolderId/findFileId list
// queries) — plausibly a 401-triggered refresh-and-retry (up to 3 sequential network round-trips
// for what looks like one call), but the trace alone can't confirm it. These two metrics isolate
// it directly: `sync.drive.getValidAccessToken` should be ~0 (cached token, no network) unless a
// proactive refresh fired, and `sync.drive.fetch401Retry` only exists in a trace at all when the
// retry branch actually ran, so its presence/duration answers the question outright next time.
// CS-43: contador de chamadas à API, sempre ativo.
//
// É a resposta direta à pergunta em aberto do plano de transporte particionado ("orçamento de
// chamadas à API"): o desenho novo troca *poucas chamadas com muitos bytes* por *muitos bytes a
// menos, em mais chamadas*, e dado o CS-27 (uma única chamada de metadados variou de 0,4s a 9,2s)
// essa troca pode sair pela culatra numa conexão de alta latência. Sem medir, seria palpite.
//
// Conta cada `fetch` de fato disparado, retries inclusive — o número honesto de round-trips.
let _apiCalls = 0

export function resetDriveApiCallCount(): void {
  _apiCalls = 0
}

/** Publica o total acumulado e zera. Chamado uma vez por sync pelo orquestrador. */
export function reportDriveApiCallCount(metric = 'sync.drive.apiCalls'): void {
  trackSyncBytes(metric, _apiCalls)
  _apiCalls = 0
}

const MAX_RATE_LIMIT_RETRIES = 3
const RATE_LIMIT_BASE_DELAY_MS = 400

/**
 * 429 sempre; 403 só quando o motivo é de fato limite de taxa — um 403 de permissão não melhora
 * com espera, e repetir três vezes só atrasaria a falha.
 */
async function isRateLimited(res: Response): Promise<boolean> {
  if (res.status === 429) return true
  if (res.status !== 403) return false
  try {
    // clone() para não consumir o corpo que o chamador ainda pode querer ler no caminho de erro.
    const source = typeof res.clone === 'function' ? res.clone() : res
    const body = (await source.json()) as { error?: { errors?: { reason?: string }[] } }
    const reason = body.error?.errors?.[0]?.reason
    return reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded'
  } catch {
    return false
  }
}

function backoffDelay(attempt: number): number {
  // Exponencial com jitter — sem o jitter, N requisições paralelas que tomam 429 juntas voltariam
  // todas no mesmo instante e tomariam 429 de novo, em sincronia.
  const base = RATE_LIMIT_BASE_DELAY_MS * 2 ** attempt
  return base / 2 + Math.random() * base
}

async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await measureSync('sync.drive.getValidAccessToken', () => getValidAccessToken())
  const withAuth = (t: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
  })

  _apiCalls++
  let res = await fetch(url, withAuth(token))

  if (res.status === 401) {
    res = await measureSync('sync.drive.fetch401Retry', async () => {
      const refreshed = await refreshGoogleToken()
      _apiCalls++
      return fetch(url, withAuth(refreshed))
    })
  }

  // CS-43: backoff de rate limit. Não existia porque o transporte monolítico fazia ~5 chamadas por
  // sync; o particionado faz dezenas na primeira publicação, e a presença desta métrica num trace
  // responde de imediato se trocamos "muitos bytes" por "chamadas demais".
  for (let attempt = 0; attempt < MAX_RATE_LIMIT_RETRIES && (await isRateLimited(res)); attempt++) {
    res = await measureSync('sync.drive.fetch429Retry', async () => {
      await new Promise((resolve) => setTimeout(resolve, backoffDelay(attempt)))
      const current = await getValidAccessToken()
      _apiCalls++
      return fetch(url, withAuth(current))
    })
  }

  return res
}

/**
 * Teto de I/O simultâneo contra o Drive.
 *
 * A justificativa está na primeira publicação: ~30 uploads. Em 5G, 30 × 400ms sequenciais são 12s
 * contra ~3s a 4 vias — e foi exatamente um teste em 5G que motivou todo o transporte particionado.
 * O teto existe para não trocar latência por rate limit.
 *
 * **CS-28 não se aplica aqui.** Aquela regra é sobre chamadas concorrentes ao wa-sqlite dentro do
 * worker; isto é `fetch` na main thread, sem nenhum wasm envolvido. O reflexo de serializar por
 * segurança seria custo puro.
 */
export const DRIVE_CONCURRENCY = 4

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  fn: (item: T) => Promise<R>,
  limit = DRIVE_CONCURRENCY
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index])
    }
  })

  await Promise.all(workers)
  return results
}

// Wrapped as a single metric (cache hit and miss alike): a near-zero value confirms the
// FOLDER_ID_KEY/FILE_ID_KEY cache is being hit on repeat syncs, a large one isolates the cold-cache
// list-query round-trip a brand-new device (e.g. first mobile connect) always pays.
async function findFolderId(): Promise<string> {
  return measureSync('sync.drive.findFolderId', async () => {
    const cached = getCachedId(FOLDER_ID_KEY)
    if (cached) return cached

    const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`
    const res = await authorizedFetch(
      `${FILES_ENDPOINT}?q=${encodeURIComponent(q)}&fields=files(id)`
    )
    if (!res.ok) throw new Error('Failed to list Drive folders')
    const json = (await res.json()) as { files: { id: string }[] }
    if (json.files.length > 0) {
      setCachedId(FOLDER_ID_KEY, json.files[0].id)
      return json.files[0].id
    }

    const created = await authorizedFetch(FILES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    })
    if (!created.ok) throw new Error('Failed to create the Gimbo Drive folder')
    const folder = (await created.json()) as { id: string }
    setCachedId(FOLDER_ID_KEY, folder.id)
    return folder.id
  })
}

async function findFileId(folderId: string): Promise<string | null> {
  return measureSync('sync.drive.findFileId', async () => {
    const cached = getCachedId(FILE_ID_KEY)
    if (cached) return cached

    const q = `name='${DB_FILENAME}' and '${folderId}' in parents and trashed=false`
    const res = await authorizedFetch(
      `${FILES_ENDPOINT}?q=${encodeURIComponent(q)}&orderBy=modifiedTime desc&fields=files(id,modifiedTime)`
    )
    if (!res.ok) throw new Error('Failed to list files in the Gimbo Drive folder')
    const json = (await res.json()) as { files: { id: string; modifiedTime: string }[] }
    if (json.files.length === 0) return null
    if (json.files.length > 1) {
      // Pre-existing duplicate (e.g. from before this race was fixed, or a cross-device race this
      // module can't prevent) — deterministically pick the most recently modified one rather than
      // flapping between ids on every sync. Doesn't delete the others; that's a manual cleanup.
      // eslint-disable-next-line no-console
      console.warn(
        `[googleDrive] Found ${json.files.length} gimbo.db files in the Gimbo/ folder — using the most recently modified one. Remove the extras manually in Drive.`
      )
    }
    setCachedId(FILE_ID_KEY, json.files[0].id)
    return json.files[0].id
  })
}

// ─── CS-42: primitivas de árvore, para o transporte particionado ──────────────
//
// O provider acima é amarrado a *um* arquivo (`Gimbo/gimbo.db`): não existe nenhuma primitiva de
// enumeração de diretório nem de acesso por id. O transporte particionado precisa das duas — listar
// o que cada dispositivo publicou e baixar partições direto pelo id que o manifesto anuncia.

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
}

/**
 * Escapa um literal para dentro de uma query `q` do Drive. Os ids que interpolamos hoje são UUIDs,
 * então não há injeção possível — mas a query é montada por concatenação e essa propriedade não é
 * garantida por nada, então escapar é mais barato que confiar.
 */
function quoteQ(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * `files.list` com paginação de verdade.
 *
 * `pageSize` do Drive é 100 por padrão e — a pegadinha — **`nextPageToken` só vem se for pedido em
 * `fields`**. Sem as duas coisas, uma pasta com mais de 100 arquivos é truncada em silêncio, e num
 * transporte particionado truncar a listagem seria lido como "arquivo faltando", disparando
 * re-upload da partição a cada sync.
 */
async function listFiles(query: string): Promise<DriveFile[]> {
  const out: DriveFile[] = []
  let pageToken: string | undefined

  do {
    const params = new URLSearchParams({
      q: query,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)',
      pageSize: '1000',
    })
    if (pageToken) params.set('pageToken', pageToken)

    const res = await authorizedFetch(`${FILES_ENDPOINT}?${params.toString()}`)
    if (!res.ok) throw new Error('Failed to list files on Drive')
    const json = (await res.json()) as { files: DriveFile[]; nextPageToken?: string }
    out.push(...json.files)
    pageToken = json.nextPageToken
  } while (pageToken)

  return out
}

/** Filhos diretos e não-descartados de uma pasta. */
export function listFolderChildren(folderId: string): Promise<DriveFile[]> {
  return listFiles(`'${quoteQ(folderId)}' in parents and trashed=false`)
}

/** Id da pasta `Gimbo/` (cria se não existir). */
export function getRootFolderId(): Promise<string> {
  return enqueue(() => findFolderId())
}

/**
 * Find-or-create de subpasta. **Serializado pelo `enqueue()`** — é a única operação com corrida
 * real (duas chamadas concorrentes veem "não existe" e cada uma cria a sua); tudo o mais opera
 * sobre ids já conhecidos e é seguro em paralelo.
 */
export function ensureSubfolder(parentId: string, name: string): Promise<string> {
  return enqueue(async () => {
    const existing = await listFiles(
      `name='${quoteQ(name)}' and '${quoteQ(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`
    )
    if (existing.length > 0) {
      // Duplicata (corrida entre dispositivos, que a API não permite evitar) — escolhe
      // deterministicamente a mais recente, em vez de alternar entre ids a cada sync.
      return existing.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime))[0].id
    }

    const created = await authorizedFetch(FILES_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId] }),
    })
    if (!created.ok) throw new Error(`Failed to create the ${name} folder on Drive`)
    return ((await created.json()) as { id: string }).id
  })
}

/** Bytes de um arquivo pelo id. Devolve null em 404 — id obsoleto de manifesto é recuperável. */
export async function downloadFileById(fileId: string): Promise<ArrayBuffer | null> {
  const res = await authorizedFetch(`${FILES_ENDPOINT}/${fileId}?alt=media`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error('Failed to download a file from Drive')
  const buffer = await res.arrayBuffer()
  trackSyncBytes('sync.drive.download.bytes', buffer.byteLength)
  return buffer
}

/**
 * Cria ou atualiza um arquivo, devolvendo o id.
 *
 * Sem `enqueue()` de propósito: o alvo é sempre um nome único dentro da pasta deste dispositivo
 * (escritor único por arquivo, o invariante da Fase 1), então não há find-or-create nem corrida.
 * É o que permite ao CS-43 paralelizar a publicação.
 */
export async function uploadFileToFolder(params: {
  parentId: string
  name: string
  blob: Blob
  fileId?: string
}): Promise<string> {
  trackSyncBytes('sync.drive.upload.bytes', params.blob.size)

  if (params.fileId) {
    const res = await authorizedFetch(
      `${UPLOAD_ENDPOINT}/${params.fileId}?uploadType=media&fields=id`,
      { method: 'PATCH', headers: { 'Content-Type': params.blob.type }, body: params.blob }
    )
    if (res.ok) return params.fileId
    // 404: o arquivo foi apagado no Drive desde que guardamos o id — recria em vez de falhar.
    if (res.status !== 404) throw new Error(`Failed to update ${params.name} on Drive`)
  }

  const metadata = { name: params.name, parents: [params.parentId] }
  const form = new FormData()
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
  form.append('file', params.blob)
  const res = await authorizedFetch(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error(`Failed to create ${params.name} on Drive`)
  return ((await res.json()) as { id: string }).id
}

export function createGoogleDriveProvider(): CloudProvider & {
  fileExists(): Promise<boolean>
} {
  return {
    isConnected(): boolean {
      return isGoogleConnected()
    },

    fileExists(): Promise<boolean> {
      return enqueue(async () => {
        const folderId = await findFolderId()
        return (await findFileId(folderId)) !== null
      })
    },

    upload(blob: Blob): Promise<void> {
      trackSyncBytes('sync.drive.upload.bytes', blob.size)
      return enqueue(() =>
        measureSync('sync.drive.upload', async () => {
          const folderId = await findFolderId()
          const fileId = await findFileId(folderId)

          if (fileId) {
            const res = await authorizedFetch(`${UPLOAD_ENDPOINT}/${fileId}?uploadType=media`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/x-sqlite3' },
              body: blob,
            })
            if (!res.ok) throw new Error('Failed to update gimbo.db on Drive')
            return
          }

          const metadata = { name: DB_FILENAME, parents: [folderId] }
          const form = new FormData()
          form.append(
            'metadata',
            new Blob([JSON.stringify(metadata)], { type: 'application/json' })
          )
          form.append('file', blob)
          const res = await authorizedFetch(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
            method: 'POST',
            body: form,
          })
          if (!res.ok) throw new Error('Failed to create gimbo.db on Drive')
          const created = (await res.json()) as { id: string }
          setCachedId(FILE_ID_KEY, created.id)
        })
      )
    },

    download(): Promise<ArrayBuffer> {
      return enqueue(() =>
        measureSync('sync.drive.download', async () => {
          const folderId = await findFolderId()
          const fileId = await findFileId(folderId)
          if (!fileId) throw new Error('gimbo.db not found on Drive')
          const res = await authorizedFetch(`${FILES_ENDPOINT}/${fileId}?alt=media`)
          if (!res.ok) throw new Error('Failed to download gimbo.db from Drive')
          const buffer = await res.arrayBuffer()
          trackSyncBytes('sync.drive.download.bytes', buffer.byteLength)
          return buffer
        })
      )
    },

    getMetadata(): Promise<{ modifiedTime: string }> {
      return enqueue(() =>
        measureSync('sync.drive.getMetadata', async () => {
          const folderId = await findFolderId()
          const fileId = await findFileId(folderId)
          if (!fileId) throw new Error('gimbo.db not found on Drive')
          const res = await authorizedFetch(`${FILES_ENDPOINT}/${fileId}?fields=modifiedTime`)
          if (!res.ok) throw new Error('Failed to read gimbo.db metadata from Drive')
          return (await res.json()) as { modifiedTime: string }
        })
      )
    },
  }
}

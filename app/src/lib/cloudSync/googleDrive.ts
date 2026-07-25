// F-28 Nível 2, Fase 2 — CS-03: Google Drive file operations behind the CloudProvider interface
// (CS-19, Fase 0). Only `merge.ts`/`syncService.ts` orchestration talks to this module directly —
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
async function authorizedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken()
  const withAuth = (t: string): RequestInit => ({
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${t}` },
  })

  const first = await fetch(url, withAuth(token))
  if (first.status !== 401) return first

  const refreshed = await refreshGoogleToken()
  return fetch(url, withAuth(refreshed))
}

async function findFolderId(): Promise<string> {
  const cached = getCachedId(FOLDER_ID_KEY)
  if (cached) return cached

  const q = `name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`
  const res = await authorizedFetch(`${FILES_ENDPOINT}?q=${encodeURIComponent(q)}&fields=files(id)`)
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
}

async function findFileId(folderId: string): Promise<string | null> {
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
      return enqueue(async () => {
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
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }))
        form.append('file', blob)
        const res = await authorizedFetch(`${UPLOAD_ENDPOINT}?uploadType=multipart&fields=id`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) throw new Error('Failed to create gimbo.db on Drive')
        const created = (await res.json()) as { id: string }
        setCachedId(FILE_ID_KEY, created.id)
      })
    },

    download(): Promise<ArrayBuffer> {
      return enqueue(async () => {
        const folderId = await findFolderId()
        const fileId = await findFileId(folderId)
        if (!fileId) throw new Error('gimbo.db not found on Drive')
        const res = await authorizedFetch(`${FILES_ENDPOINT}/${fileId}?alt=media`)
        if (!res.ok) throw new Error('Failed to download gimbo.db from Drive')
        return res.arrayBuffer()
      })
    },

    getMetadata(): Promise<{ modifiedTime: string }> {
      return enqueue(async () => {
        const folderId = await findFolderId()
        const fileId = await findFileId(folderId)
        if (!fileId) throw new Error('gimbo.db not found on Drive')
        const res = await authorizedFetch(`${FILES_ENDPOINT}/${fileId}?fields=modifiedTime`)
        if (!res.ok) throw new Error('Failed to read gimbo.db metadata from Drive')
        return (await res.json()) as { modifiedTime: string }
      })
    },
  }
}

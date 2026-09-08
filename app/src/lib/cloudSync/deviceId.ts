// F-28 Nível 2, Fase 1 — CS-13: persistent device identity for the "one file per device"
// multi-desktop sync invariant (S-16..S-20).
//
// Stored in OPFS (not localStorage) alongside gimbo.db: OPFS survives partial browser data
// clears, while localStorage would mint a new id on every clear — and, with it, a new orphaned
// device-<id>.db accumulating in the user's shared folder forever.

import { uuid } from '@/lib/utils'

const DEVICE_ID_FILENAME = 'device-id'

let cached: string | null = null

async function readExisting(root: FileSystemDirectoryHandle): Promise<string | null> {
  try {
    const fileHandle = await root.getFileHandle(DEVICE_ID_FILENAME)
    const file = await fileHandle.getFile()
    const text = (await file.text()).trim()
    return text || null
  } catch {
    return null
  }
}

async function persist(root: FileSystemDirectoryHandle, id: string): Promise<void> {
  const fileHandle = await root.getFileHandle(DEVICE_ID_FILENAME, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(id)
  await writable.close()
}

/** Returns this device's persistent UUID, generating and persisting one on first call. */
export async function getDeviceId(): Promise<string> {
  if (cached) return cached

  const root = await navigator.storage.getDirectory()
  const existing = await readExisting(root)
  if (existing) {
    cached = existing
    return cached
  }

  const id = uuid()
  await persist(root, id)
  cached = id
  return id
}

/** First 6 characters of the device id — for compact display in Settings (CS-16). */
export async function getShortDeviceId(): Promise<string> {
  const id = await getDeviceId()
  return id.slice(0, 6)
}

/**
 * M-96: synchronous read of whatever `getDeviceId()` has already resolved — `null` if nothing
 * has called it yet in this session. Exists because `useDataStore.ts`'s `makeEntry()` tags every
 * new `AuditEntry` with the device id, and that call site is synchronous (inside `mutate()`),
 * while OPFS access is inherently async. `App.tsx` warms this up unconditionally at boot (fire
 * and forget, before any mutation can happen), so in practice this is only ever null in the
 * narrow window between script start and that warm-up resolving.
 */
export function getCachedDeviceId(): string | null {
  return cached
}

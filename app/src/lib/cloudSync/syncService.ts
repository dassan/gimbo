// F-28 Nível 2, Fase 2 — CS-06: orchestrates pull+merge and push for the Google Drive transport.
// Unlike Fase 1's folderSyncService (one file per device), Drive holds a single shared gimbo.db —
// so instead of a per-peer lastMergedAt cache, staleness is judged by comparing timestamps:
// `settings.fileUpdatedAt` (local) against the Drive file's own `modifiedTime` (S-09).

import { storage } from '@/services/storage'
import type { DataFile } from '@/types'
import { isGoogleConnected } from './googleAuth'
import { createGoogleDriveProvider } from './googleDrive'
import { mergeForSync } from './merge'
import type { SyncResult } from './provider'

/**
 * Pulls the Drive file (if newer than local), merges it in, and pushes the result back. First
 * connection ever (no file on Drive yet) just uploads the local vault as-is.
 */
export async function pullAndMerge(local: DataFile): Promise<SyncResult> {
  if (!isGoogleConnected()) return { status: 'offline' }
  const provider = createGoogleDriveProvider()

  try {
    const exists = await provider.fileExists()
    if (!exists) {
      await provider.upload(await storage.exportBlob())
      return { status: 'synced' }
    }

    const meta = await provider.getMetadata()
    if (meta.modifiedTime <= local.settings.fileUpdatedAt) {
      return { status: 'synced' } // local is already at least as new — nothing to pull
    }

    const buffer = await provider.download()
    const result = await storage.readPeerBlob(new Blob([buffer]))
    if (result.status === 'skipped') {
      return { status: 'skipped', reason: result.reason }
    }

    const merged = mergeForSync(local, result.data)
    await storage.replaceAll(merged)
    await provider.upload(await storage.exportBlob())
    return { status: 'merged', peersMerged: 1 }
  } catch {
    // Network/API failure (offline, revoked access, Drive outage...) — never fatal, the app
    // keeps working off the local OPFS copy and retries on the next boot/poll tick/mutation.
    return { status: 'offline' }
  }
}

/** Uploads the local vault to Drive if it changed since the last known Drive state. */
export async function pushIfNeeded(local: DataFile): Promise<void> {
  if (!isGoogleConnected()) return
  const provider = createGoogleDriveProvider()

  try {
    const exists = await provider.fileExists()
    if (!exists) {
      await provider.upload(await storage.exportBlob())
      return
    }
    const meta = await provider.getMetadata()
    if (local.settings.fileUpdatedAt > meta.modifiedTime) {
      await provider.upload(await storage.exportBlob())
    }
  } catch {
    // non-fatal — retried on the next mutation debounce or poll tick
  }
}

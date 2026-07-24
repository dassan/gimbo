// F-28 Nível 2, Fase 1 — CS-15: orchestrates the multi-desktop merge on top of `folderProvider`
// (CS-14) and `mergeForSync` (CS-05). Never blocks the boot and never treats a bad peer file as
// fatal — S-20 requires that skipping an unreadable/mid-write/newer-schema peer and retrying on
// the next boot is always safe, which holds because `mergeForSync` is idempotent.

import { storage } from '@/services/storage'
import type { DataFile } from '@/types'
import { createFolderProvider, type PeerFile } from './folderProvider'
import { mergeForSync } from './merge'
import type { SyncResult } from './provider'

const LAST_MERGED_KEY_PREFIX = 'gimbo_sync_last_merged_'

function getLastMergedAt(peerDeviceId: string): number {
  const raw = localStorage.getItem(LAST_MERGED_KEY_PREFIX + peerDeviceId)
  const parsed = raw ? Number(raw) : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function setLastMergedAt(peerDeviceId: string, lastModified: number): void {
  // Cache only — never financial data, safe in localStorage (unlike deviceId, doesn't need to
  // survive a partial browser-data clear: worst case is re-merging an already-merged peer, which
  // mergeForSync's idempotency makes harmless).
  localStorage.setItem(LAST_MERGED_KEY_PREFIX + peerDeviceId, String(lastModified))
}

/**
 * Reads every peer device file newer than the last recorded merge, folds it into `local` via
 * `mergeForSync`, and — if anything actually merged — persists the result locally and republishes
 * this device's own file. Read-only towards peers; this device's file is the only one it writes.
 */
export async function syncFromPeers(local: DataFile, deviceId: string): Promise<SyncResult> {
  const provider = createFolderProvider(deviceId)

  let peers: PeerFile[]
  try {
    peers = await provider.listPeers()
  } catch {
    return { status: 'offline' }
  }

  const stale = peers.filter((peer) => peer.lastModified > getLastMergedAt(peer.deviceId))
  if (stale.length === 0) return { status: 'synced' }

  let merged = local
  let peersMerged = 0
  let sawNewerSchema = false

  for (const peer of stale) {
    let file: File
    try {
      file = await peer.handle.getFile()
    } catch {
      continue // mid-write by the peer's cloud client, or removed — retry next boot
    }

    const result = await storage.readPeerBlob(file)
    if (result.status === 'skipped') {
      if (result.reason === 'newer-schema') sawNewerSchema = true
      continue
    }

    merged = mergeForSync(merged, result.data)
    peersMerged++
    setLastMergedAt(peer.deviceId, peer.lastModified)
  }

  if (peersMerged === 0) {
    return sawNewerSchema ? { status: 'skipped', reason: 'newer-schema' } : { status: 'synced' }
  }

  await storage.replaceAll(merged)
  await provider.upload(await storage.exportBlob())

  return { status: 'merged', peersMerged }
}
